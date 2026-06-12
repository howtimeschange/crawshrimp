"""
FastAPI service - complete task execution pipeline
Electron spawns this process; all GUI calls go through HTTP on localhost:18765

Bundling notes (for electron-builder / python-build-standalone):
  - All deps (fastapi, uvicorn, apscheduler, openpyxl, websockets, pyyaml) must be
    pre-installed in the bundled Python env (see app/scripts/bundle-python.sh)
  - Built-in adapters (adapters/) are shipped as extraResources alongside Python scripts
  - User-installed adapters live in ~/.crawshrimp/adapters/
"""
import asyncio
import base64
import hmac
import json
import logging
import os
import re
import secrets
import shutil
import tempfile
import time
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional
from urllib.parse import urlencode, parse_qs, urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from core import runtime_paths
from core.config import load_config, save_config
from core import adapter_loader
from core import data_sink
from core import notifier
from core import odps_sync
from core import scheduler as sched_module
from core.cdp_bridge import CDPBridge, get_bridge, reset_bridge
from core.browser_session import open_browser_session
from core.dev_harness import run_harness_capture, run_harness_eval, run_harness_snapshot
from core.dev_harness_models import DevHarnessCaptureRequest, DevHarnessEvalRequest, DevHarnessSnapshotRequest
from core.knowledge_service import ensure_knowledge_index, rebuild_knowledge_index, search_knowledge
from core.probe_models import ProbeRequest
from core.probe_service import read_probe_bundle, read_probe_bundle_full, run_probe_request
from core.shenhui_pdf_screenshot import finalize_pdf_batch_screenshot_outputs, convert_pdf_rows_to_yq_output_root
from core.amazon_label_splitter import (
    copy_amazon_label_outputs_to_export_folder,
    split_amazon_label_rows,
)

logger = logging.getLogger(__name__)

API_VERSION = "1.4.16"
API_TOKEN_HEADER = "x-crawshrimp-token"
PUBLIC_API_PATHS = {"/health", "/docs", "/openapi.json", "/redoc", "/docs/oauth2-redirect"}

# In-memory task run state for live status / logs
_run_logs: dict = {}   # job_id -> list[str]
_run_status: dict = {} # job_id -> {'status', 'run_id', 'records'}
_run_controls: dict = {}  # job_id -> {'task', 'pause_requested', 'stop_requested', 'resume_event', ...}
_task_locks: dict[str, asyncio.Lock] = {}

ACTIVE_LIVE_STATUSES = {"running", "pausing", "paused", "stopping"}

RUNTIME_CLEANUP_TASKS = {
    ("amazon-ops-assistant", "amazon_label_batch_process"),
    ("semir-cloud-drive", "batch_ai_generate"),
    ("semir-cloud-drive", "batch_image_download"),
    ("semir-cloud-drive", "tmall_material_match_buy"),
    ("shenhui-new-arrival", "prepare_upload_package"),
    ("tiktok-ops-assistant", "creator_video_download"),
}

def _backend_lock_dir() -> Path:
    explicit = str(os.environ.get("CRAWSHRIMP_BACKEND_LOCK_DIR") or "").strip()
    if explicit:
        path = Path(explicit).expanduser()
        path.mkdir(parents=True, exist_ok=True)
        return path
    return runtime_paths.data_root()


def _backend_lock_path() -> Path:
    return _backend_lock_dir() / "backend.lock"


def _get_api_token() -> str:
    env_token = str(os.environ.get("CRAWSHRIMP_API_TOKEN") or "").strip()
    if env_token:
        return env_token

    token_path = _backend_lock_dir() / "api-token"
    try:
        if token_path.exists():
            return token_path.read_text(encoding="utf-8").strip()
        token_path.parent.mkdir(parents=True, exist_ok=True)
        token = secrets.token_hex(32)
        token_path.write_text(token, encoding="utf-8")
        try:
            token_path.chmod(0o600)
        except OSError:
            pass
        return token
    except Exception:
        logger.exception("Failed to read or create crawshrimp API token")
        return ""


def _api_auth_required() -> bool:
    return os.environ.get("CRAWSHRIMP_ALLOW_UNAUTHENTICATED") != "1"


def _allowed_cors_origins() -> list[str]:
    raw = str(os.environ.get("CRAWSHRIMP_ALLOWED_ORIGINS") or "").strip()
    if raw:
        origins = [item.strip() for item in raw.split(",") if item.strip()]
        if origins:
            return origins
    return [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ]


def _task_lock(jid: str) -> asyncio.Lock:
    lock = _task_locks.get(jid)
    if lock is None:
        lock = asyncio.Lock()
        _task_locks[jid] = lock
    return lock


def _task_is_active(jid: str) -> bool:
    live = _run_status.get(jid) or {}
    control = _run_controls.get(jid)
    task = control.get("task") if control else None
    if task and not task.done():
        return True
    if _task_lock(jid).locked():
        return True
    return live.get("status") in ACTIVE_LIVE_STATUSES and ((task and not task.done()) or not control)


def _task_has_live_control(jid: str) -> bool:
    live = _run_status.get(jid) or {}
    control = _run_controls.get(jid)
    task = control.get("task") if control else None
    if task and not task.done():
        return True
    return live.get("status") in ACTIVE_LIVE_STATUSES and not control


class BackendInstanceLock:
    def __init__(self, file_path: Path):
        self.file_path = file_path
        self.handle = None
        self.acquired = False

    def acquire(self) -> bool:
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.file_path.open("a+")
        if os.name == "nt":
            try:
                import msvcrt

                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                self.acquired = False
                try:
                    self.handle.close()
                finally:
                    self.handle = None
                return False
        else:
            try:
                import fcntl

                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                self.acquired = False
                try:
                    self.handle.close()
                finally:
                    self.handle = None
                return False
            except OSError:
                self.acquired = False
                try:
                    self.handle.close()
                finally:
                    self.handle = None
                return False
        try:
            self.handle.seek(0)
            self.handle.truncate()
            self.handle.write(str(os.getpid()))
            self.handle.flush()
        except Exception:
            logger.debug("Failed to write backend instance lock metadata", exc_info=True)
            self.acquired = False
            try:
                self.handle.close()
            finally:
                self.handle = None
            return False
        self.acquired = True
        return True

    def close(self) -> None:
        if not self.handle:
            return
        try:
            if self.acquired:
                if os.name == "nt":
                    import msvcrt

                    self.handle.seek(0)
                    msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        except Exception:
            logger.debug("Failed to release backend instance lock", exc_info=True)
        try:
            self.handle.close()
        finally:
            self.handle = None
            self.acquired = False


def _acquire_backend_instance_lock() -> BackendInstanceLock:
    lock = BackendInstanceLock(_backend_lock_path())
    lock.acquire()
    return lock


def _backend_runtime_kind() -> str:
    explicit = str(os.environ.get("CRAWSHRIMP_BACKEND_KIND") or "").strip()
    if explicit:
        return explicit
    scripts_dir = Path(__file__).resolve().parent.parent
    return "packaged" if scripts_dir.name == "python-scripts" else "source"


def _backend_runtime_info() -> dict:
    data_dir = runtime_paths.data_root()
    lock_dir = _backend_lock_dir()
    return {
        "kind": _backend_runtime_kind(),
        "pid": os.getpid(),
        "scripts_dir": str(Path(__file__).resolve().parent.parent),
        "data_dir": str(data_dir.resolve() if data_dir.exists() else data_dir),
        "lock_dir": str(lock_dir.expanduser().resolve() if lock_dir.exists() else lock_dir),
        "owns_backend_instance": bool(getattr(app.state, "owns_backend_instance", False)) if "app" in globals() else False,
    }


def _build_run_control() -> dict:
    resume_event = asyncio.Event()
    resume_event.set()
    return {
        "task": None,
        "pause_requested": False,
        "stop_requested": False,
        "stop_reason": "任务已停止",
        "resume_event": resume_event,
        "pause_logged": False,
        "last_progress_exec_no": 0,
        "total_rows": 0,
    }


def _int_from_mapping(source: Optional[dict], key: str, default: int = 0) -> int:
    if not source:
        return default
    try:
        return int(source.get(key) or default)
    except (TypeError, ValueError):
        return default


def _str_from_mapping(source: Optional[dict], key: str) -> str:
    if not source:
        return ""
    return str(source.get(key) or "").strip()


def _build_live_progress(payload: Optional[dict] = None, run_control: Optional[dict] = None) -> dict:
    payload = dict(payload or {})
    shared_state = dict(payload.get('shared') or {})
    total_rows = _int_from_mapping(shared_state, 'total_rows', _int_from_mapping(run_control, 'total_rows') if run_control else 0)
    current_exec_no = _int_from_mapping(shared_state, 'current_exec_no')
    current_row_no = _int_from_mapping(shared_state, 'current_row_no')
    batch_no = _int_from_mapping(shared_state, 'batch_no')
    total_batches = _int_from_mapping(shared_state, 'total_batches')
    search_total_codes = _int_from_mapping(shared_state, 'search_total_codes')
    search_completed_codes = _int_from_mapping(shared_state, 'search_completed_codes')
    generation_total_jobs = _int_from_mapping(shared_state, 'generation_total_jobs')
    generation_completed_jobs = _int_from_mapping(shared_state, 'generation_completed_jobs')
    buyer_id = _str_from_mapping(shared_state, 'current_buyer_id')
    store = _str_from_mapping(shared_state, 'current_store')
    current_source_filename = _str_from_mapping(shared_state, 'current_source_filename')
    phase_name = str(payload.get('phase') or '').strip()
    records = _int_from_mapping(payload, 'records')

    download_total = _int_from_mapping(run_control, 'download_total') if run_control else _int_from_mapping(payload, 'download_total', _int_from_mapping(payload, 'download_item_total'))
    download_completed = _int_from_mapping(run_control, 'download_completed') if run_control else _int_from_mapping(payload, 'download_completed')
    download_success = _int_from_mapping(run_control, 'download_success') if run_control else _int_from_mapping(payload, 'download_success')
    download_failed = _int_from_mapping(run_control, 'download_failed') if run_control else _int_from_mapping(payload, 'download_failed')
    download_concurrency = _int_from_mapping(run_control, 'download_concurrency') if run_control else _int_from_mapping(payload, 'download_concurrency')
    download_retry_attempts = _int_from_mapping(run_control, 'download_retry_attempts') if run_control else _int_from_mapping(payload, 'download_retry_attempts')
    download_started = bool(run_control.get('download_started')) if run_control else bool(download_total > 0)
    download_active = bool(run_control.get('download_active')) if run_control else bool(payload.get('download_active'))
    download_last_label = str((run_control.get('download_last_label') if run_control else payload.get('download_last_label')) or '').strip()
    download_current_label = str((run_control.get('download_current_label') if run_control else payload.get('download_current_label')) or '').strip()
    download_active_labels = run_control.get('download_active_labels') if run_control else payload.get('download_active_labels')
    if not isinstance(download_active_labels, list):
        download_active_labels = []
    download_active_labels = [str(item or '').strip() for item in download_active_labels if str(item or '').strip()]
    download_active_count = _int_from_mapping(run_control, 'download_active_count') if run_control else _int_from_mapping(payload, 'download_active_count')
    download_speed_bps = _int_from_mapping(run_control, 'download_speed_bps') if run_control else _int_from_mapping(payload, 'download_speed_bps')
    download_bytes_completed = _int_from_mapping(run_control, 'download_bytes_completed') if run_control else _int_from_mapping(payload, 'download_bytes_completed')
    download_total_bytes = _int_from_mapping(run_control, 'download_total_bytes') if run_control else _int_from_mapping(payload, 'download_total_bytes')

    if run_control and total_rows:
        run_control['total_rows'] = total_rows

    percent = 0.0
    if total_rows > 0 and current_exec_no > 0:
        percent = min(100.0, round((current_exec_no / total_rows) * 100, 1))

    progress_text = ""
    if current_exec_no > 0 and total_rows > 0:
        progress_text = f"{current_exec_no}/{total_rows}"

    return {
        "current": current_exec_no,
        "total": total_rows,
        "row_no": current_row_no,
        "batch_no": batch_no,
        "total_batches": total_batches,
        "search_total_codes": search_total_codes,
        "search_completed_codes": search_completed_codes,
        "generation_total_jobs": generation_total_jobs,
        "generation_completed_jobs": generation_completed_jobs,
        "buyer_id": buyer_id,
        "store": store,
        "current_source_filename": current_source_filename,
        "phase": phase_name,
        "completed": records,
        "percent": percent,
        "progress_text": progress_text,
        "download_total": download_total,
        "download_completed": download_completed,
        "download_success": download_success,
        "download_failed": download_failed,
        "download_concurrency": download_concurrency,
        "download_retry_attempts": download_retry_attempts,
        "download_started": download_started,
        "download_active": download_active,
        "download_last_label": download_last_label,
        "download_current_label": download_current_label,
        "download_active_labels": download_active_labels,
        "download_active_count": download_active_count,
        "download_speed_bps": download_speed_bps,
        "download_bytes_completed": download_bytes_completed,
        "download_total_bytes": download_total_bytes,
        "list_total_rows": _int_from_mapping(shared_state, 'list_total_rows'),
        "list_completed_rows": _int_from_mapping(shared_state, 'list_completed_rows'),
        "list_total_batches": _int_from_mapping(shared_state, 'list_total_batches'),
        "list_completed_batches": _int_from_mapping(shared_state, 'list_completed_batches'),
        "detail_total_targets": _int_from_mapping(shared_state, 'detail_total_targets'),
        "detail_completed_targets": _int_from_mapping(shared_state, 'detail_completed_targets'),
        "detail_current_target_index": _int_from_mapping(shared_state, 'detail_current_target_index'),
        "detail_current_target": _str_from_mapping(shared_state, 'detail_current_target'),
        "detail_dimension_total": _int_from_mapping(shared_state, 'detail_dimension_total'),
        "detail_dimension_index": _int_from_mapping(shared_state, 'detail_dimension_index'),
        "detail_dimension_label": _str_from_mapping(shared_state, 'detail_dimension_label'),
        "detail_current_page": _int_from_mapping(shared_state, 'detail_current_page'),
        "detail_total_pages": _int_from_mapping(shared_state, 'detail_total_pages'),
        "detail_total_rows": _int_from_mapping(shared_state, 'detail_total_rows'),
        "detail_request_count": _int_from_mapping(shared_state, 'detail_request_count'),
        "detail_records_collected": _int_from_mapping(shared_state, 'detail_records_collected'),
        "doudian_stage": _str_from_mapping(shared_state, 'doudian_stage'),
        "doudian_activity_total": _int_from_mapping(shared_state, 'doudian_activity_total'),
        "doudian_activity_completed": _int_from_mapping(shared_state, 'doudian_activity_completed'),
        "doudian_current_activity": _str_from_mapping(shared_state, 'doudian_current_activity'),
        "doudian_current_product_total": _int_from_mapping(shared_state, 'doudian_current_product_total'),
        "doudian_current_product_completed": _int_from_mapping(shared_state, 'doudian_current_product_completed'),
        "doudian_detail_rows": _int_from_mapping(shared_state, 'doudian_detail_rows'),
        "doudian_signup_total": _int_from_mapping(shared_state, 'doudian_signup_total'),
        "doudian_signup_completed": _int_from_mapping(shared_state, 'doudian_signup_completed'),
        "doudian_order_window_total": _int_from_mapping(shared_state, 'doudian_order_window_total'),
        "doudian_order_window_completed": _int_from_mapping(shared_state, 'doudian_order_window_completed'),
        "doudian_mixed_rows": _int_from_mapping(shared_state, 'doudian_mixed_rows'),
    }


def _extract_candidate_urls_from_text(value: object) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    matches = re.findall(r"https?://[\s\S]*?(?=https?://|$)", text, flags=re.IGNORECASE)
    if matches:
        return [item.rstrip("、，,;；").strip() for item in matches if item.strip()]
    return [
        item.strip()
        for item in re.split(r"[\n\r\t 、，,;；]+", text)
        if item.strip()
    ]


def _normalize_tmall_item_link(raw_url: object) -> str:
    text = str(raw_url or "").strip().rstrip("、，,;；")
    if not text:
        return ""
    try:
        parsed = urlparse(text)
    except Exception:
        return ""
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    query = parse_qs(parsed.query or "", keep_blank_values=False)
    item_id = ""
    for key in ("id", "itemId", "item_id", "itemNumId", "item_num_id"):
        candidate = (query.get(key) or [""])[0].strip()
        if candidate:
            item_id = candidate
            break
    if not re.fullmatch(r"\d{6,}", item_id):
        return ""
    sku_id = ""
    for key in ("skuId", "sku_id"):
        candidate = (query.get(key) or [""])[0].strip()
        if candidate:
            sku_id = candidate
            break
    params = {"id": item_id}
    if re.fullmatch(r"\d{6,}", sku_id):
        params["skuId"] = sku_id
    return f"https://detail.tmall.com/item.htm?{urlencode(params)}"


def _resolve_tmall_buyer_review_item_urls(run_params: dict) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for key in ("item_links", "item_url", "links"):
        for candidate in _extract_candidate_urls_from_text(run_params.get(key)):
            normalized = _normalize_tmall_item_link(candidate)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            urls.append(normalized)
    return urls


def _normalize_amazon_reviews_url(raw_url: object) -> str:
    text = str(raw_url or "").strip().rstrip("、，,;；")
    if not text:
        return ""
    if text.startswith("//"):
        text = f"https:{text}"
    if not re.match(r"^https?://", text, flags=re.IGNORECASE):
        text = f"https://{text.lstrip('/')}"
    try:
        parsed = urlparse(text)
    except Exception:
        return ""
    host = (parsed.netloc or "").lower()
    if "amazon." not in host:
        return ""
    match = re.search(r"/(?:dp|gp/product|product-reviews)/([A-Z0-9]{10})(?:[/?#]|$)", parsed.path or "", flags=re.IGNORECASE)
    if not match:
        query = parse_qs(parsed.query or "", keep_blank_values=False)
        asin = (query.get("asin") or query.get("ASIN") or [""])[0].strip().upper()
    else:
        asin = match.group(1).upper()
    if not re.fullmatch(r"[A-Z0-9]{10}", asin or ""):
        return ""
    origin = "https://www.amazon.com" if host == "amazon.com" else f"{parsed.scheme or 'https'}://{parsed.netloc}"
    return f"{origin}/product-reviews/{asin}?sortBy=recent"


def _resolve_amazon_review_urls(run_params: dict) -> list[str]:
    urls: list[str] = []
    seen_asins: set[str] = set()
    for key in ("review_urls", "product_urls", "item_links", "links"):
        for candidate in _extract_candidate_urls_from_text(run_params.get(key)):
            normalized = _normalize_amazon_reviews_url(candidate)
            if not normalized:
                continue
            asin_match = re.search(r"/product-reviews/([A-Z0-9]{10})(?:[/?#]|$)", normalized, flags=re.IGNORECASE)
            asin = asin_match.group(1).upper() if asin_match else normalized
            if asin in seen_asins:
                continue
            seen_asins.add(asin)
            urls.append(normalized)
    return urls


def _first_url_from_value(value) -> str:
    values = value if isinstance(value, list) else [value]
    for item in values:
        if isinstance(item, dict):
            for key in ("url", "link", "product_url", "productUrl", "goods_url", "goodsUrl", "item_url", "itemUrl"):
                found = _first_url_from_value(item.get(key))
                if found:
                    return found
            for key in ("rows", "urls", "links", "product_urls", "productUrls"):
                found = _first_url_from_value(item.get(key))
                if found:
                    return found
            continue
        text = str(item or "").strip()
        if not text:
            continue
        match = re.search(r"https?://[^\s,，;；、]+", text)
        if match:
            return match.group(0).rstrip(",，;；、")
        return text
    return ""


def _resolve_task_target_entry_url(adapter_id: str, task_id: str, run_params: dict, fallback_url: str) -> str:
    fallback = str(fallback_url or "").strip()
    if (adapter_id, task_id) == ("temu", "single_product_reviews"):
        product_url = _first_url_from_value(
            run_params.get("product_url")
            or run_params.get("product_urls")
            or run_params.get("productUrls")
            or run_params.get("goods_url")
            or run_params.get("item_url")
            or run_params.get("url")
            or ""
        )
        if product_url:
            return product_url
        return fallback
    if (adapter_id, task_id) == ("shopify-ops-assistant", "traffic_data"):
        parsed = urlparse(fallback or "https://admin.shopify.com/store/balabala-global/analytics/reports/sessions_over_time")
        query = parse_qs(parsed.query or "", keep_blank_values=False)
        store_key = str(run_params.get("store_key") or run_params.get("store") or "").strip()
        if not store_key:
            match = re.search(r"/store/([^/]+)", parsed.path or "")
            store_key = match.group(1) if match else "balabala-global"
        ql = (query.get("ql") or [""])[0].strip()
        if not ql:
            ql = "\n".join([
                "FROM sessions",
                "SHOW online_store_visitors,",
                "  sessions",
                "WHERE human_or_bot_session IN ('human', 'bot')",
                "TIMESERIES day",
                "WITH TOTALS, PERCENT_CHANGE",
                "SINCE startOfDay(-7d)",
                "UNTIL today",
                "COMPARE TO previous_period",
                "ORDER BY day ASC",
                "LIMIT 1000",
                "VISUALIZE sessions TYPE line",
            ])
        params = urlencode({"ql": ql})
        return f"https://admin.shopify.com/store/{store_key}/analytics/reports/sessions_over_time?{params}"
    if adapter_id == "tiktok-ops-assistant" and task_id in {"product_analytics", "product_rating", "product_management_export", "creator_video_download"}:
        raw_regions = run_params.get("shop_regions") or run_params.get("regions")
        if isinstance(raw_regions, list):
            selected_regions = [str(item) for item in raw_regions]
        else:
            selected_regions = _extract_candidate_urls_from_text(raw_regions)
        region = ""
        for candidate in selected_regions:
            normalized = str(candidate or "").strip().upper()
            if normalized == "ALL":
                continue
            if re.fullmatch(r"[A-Z]{2}", normalized):
                region = normalized
                break
        if not region:
            region = "US"
        parsed = urlparse(fallback)
        query = parse_qs(parsed.query or "", keep_blank_values=False)
        shop_id = (query.get("shop_id") or [""])[0].strip()
        if task_id == "creator_video_download":
            suffix = f"?shop_region={region}"
            if shop_id:
                suffix += f"&shop_id={shop_id}"
            return f"https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis{suffix}"
        host = "seller.us.tiktokshopglobalselling.com" if region == "US" else "seller.eu.tiktokshopglobalselling.com"
        suffix = f"?shop_region={region}"
        if shop_id:
            suffix += f"&shop_id={shop_id}"
        path_map = {
            "product_analytics": "/compass/product-traffic-analysis",
            "product_management_export": "/product/manage",
            "product_rating": "/product/rating",
        }
        path = path_map.get(task_id, "/product/rating")
        return f"https://{host}{path}{suffix}"
    if (adapter_id, task_id) == ("amazon-ops-assistant", "amazon_reviews_full_export"):
        urls = _resolve_amazon_review_urls(run_params)
        if urls:
            return urls[0]
        raise ValueError("请先填写有效的 Amazon 商品链接或评论页链接")
    if (adapter_id, task_id) != ("tmall-ops-assistant", "buyer_reviews"):
        return fallback
    urls = _resolve_tmall_buyer_review_item_urls(run_params)
    if urls:
        return urls[0]
    raise ValueError("请先填写有效的天猫商品链接")


def _resolve_task_open_mode(adapter_id: str, task_id: str, run_params: dict, task_param_ids: set[str]) -> str:
    if (adapter_id, task_id) == ("tmall-ops-assistant", "buyer_reviews"):
        return "new"
    return str(run_params.get('mode') or ('new' if 'mode' not in task_param_ids else 'current')).strip().lower()


async def _evaluate_filename_context(runner, expression: str) -> dict:
    try:
        result = await runner.evaluate(expression)
    except Exception:
        return {}
    if not result.success or not result.data or not isinstance(result.data, list):
        return {}
    row = result.data[0] or {}
    return row if isinstance(row, dict) else {}


async def _build_export_filename_context(adapter_id: str, task_id: str, run_params: dict, runner) -> dict:
    def normalize_range_text(value: str) -> str:
        return str(value or '').strip().replace(' ~ ', '~')

    def normalize_list_scope(value, empty_label: str) -> str:
        if not isinstance(value, list):
            return empty_label
        clean_values = [str(item).strip() for item in value if str(item).strip()]
        return '+'.join(clean_values) if clean_values else empty_label

    def extract_temu_goods_id(value) -> str:
        text = str(value or '').strip()
        if not text:
            return ''
        try:
            parsed = urlparse(text)
            query = parse_qs(parsed.query)
            for key in ('goods_id', 'goodsId', 'goodsid', 'product_id'):
                candidate = str((query.get(key) or [''])[0]).strip()
                if re.fullmatch(r'\d{8,}', candidate):
                    return candidate
        except Exception:
            pass
        match = (
            re.search(r'(?:^|[?&#])goods[_-]?id=(\d{8,})', text, re.I)
            or re.search(r'-g-(\d{8,})(?:[./?#]|$)', text, re.I)
        )
        return match.group(1) if match else ''

    if adapter_id == 'shein-helper':
        shein_context_js = r"""
(() => {
  const textOf = el => (el?.textContent || '').replace(/\s+/g, ' ').trim()
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
  const normalizeHyphenDate = value => {
    const match = clean(value).match(/\d{4}[-/]\d{2}[-/]\d{2}/)
    return match ? match[0].replace(/\//g, '-') : ''
  }
  const normalizeCompactDate = value => {
    const digits = clean(value).replace(/[^\d]/g, '')
    return digits.length >= 8
      ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
      : ''
  }
  const formatRange = (start, end) => {
    if (start && end) return `${start}~${end}`
    return start || end || ''
  }
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const feedbackTemplate = shared.api_template && typeof shared.api_template === 'object'
    ? shared.api_template
    : {}
  const feedbackFilter = feedbackTemplate.filter_payload && typeof feedbackTemplate.filter_payload === 'object'
    ? feedbackTemplate.filter_payload
    : (feedbackTemplate.payload && typeof feedbackTemplate.payload === 'object' ? feedbackTemplate.payload : {})
  const feedbackStart = normalizeHyphenDate(feedbackFilter.startCommentTime || feedbackFilter.commentStartTime || '')
  const feedbackEnd = normalizeHyphenDate(feedbackFilter.commentEndTime || feedbackFilter.endCommentTime || '')

  const templateQueue = Array.isArray(shared.api_templates)
    ? shared.api_templates.filter(item => item && typeof item === 'object')
    : []
  const merchandiseTemplate = templateQueue[0]
    || (shared.api_template && typeof shared.api_template === 'object' ? shared.api_template : {})
  const merchandiseFilter = merchandiseTemplate.filter_payload && typeof merchandiseTemplate.filter_payload === 'object'
    ? merchandiseTemplate.filter_payload
    : (merchandiseTemplate.payload && typeof merchandiseTemplate.payload === 'object' ? merchandiseTemplate.payload : {})
  const merchandiseStart = normalizeCompactDate(merchandiseFilter.startDate || merchandiseFilter.dt || '')
  const merchandiseEnd = normalizeCompactDate(merchandiseFilter.endDate || merchandiseFilter.dt || merchandiseFilter.startDate || '')

  const isCheckedButton = button => {
    if (!button) return false
    const className = String(button.className || '')
    if (/checked|Checked|active|Active/.test(className)) return true
    const ariaPressed = String(button.getAttribute?.('aria-pressed') || '').toLowerCase()
    if (ariaPressed === 'true') return true
    const radio = button.querySelector?.('input[type="radio"], input')
    return !!radio?.checked
  }
  const merchTimeScope = [...document.querySelectorAll('button')]
    .map(button => ({ button, label: clean(textOf(button)) }))
    .find(item => ['昨天', '近7天', '近30天', '自定义'].includes(item.label) && isCheckedButton(item.button))
    ?.label || ''

  return {
    success: true,
    data: [{
      review_date_range: formatRange(feedbackStart, feedbackEnd),
      merch_time_scope: merchTimeScope,
      merch_date_range: formatRange(merchandiseStart, merchandiseEnd),
    }],
    meta: { has_more: false }
  }
})()
"""

        page_ctx = await _evaluate_filename_context(runner, shein_context_js)
        ctx = {'shop_name': 'Shein'}

        if task_id == 'product_feedback':
            custom_range = run_params.get('review_date_range') or {}
            start = str(custom_range.get('start') or '').strip()
            end = str(custom_range.get('end') or '').strip()
            if start and end:
                ctx.update({
                    'time_scope': '自定义',
                    'date_range': f"{start}~{end}",
                })
            else:
                ctx.update({
                    'time_scope': '当前筛选',
                    'date_range': normalize_range_text(page_ctx.get('review_date_range') or '') or '当前筛选',
                })
            return ctx

        if task_id == 'merchandise_details':
            time_mode = str(run_params.get('time_mode') or '').strip().lower()
            scope_map = {
                'yesterday': '昨天',
                'last7': '近7天',
                'last30': '近30天',
                'custom': '自定义',
            }
            custom_range = run_params.get('custom_date_range') or {}
            start = str(custom_range.get('start') or '').strip()
            end = str(custom_range.get('end') or '').strip()
            if time_mode == 'custom' and start and end:
                ctx.update({
                    'time_scope': '自定义',
                    'date_range': f"{start}~{end}",
                })
            else:
                ctx.update({
                    'time_scope': scope_map.get(time_mode) or str(page_ctx.get('merch_time_scope') or '').strip() or '当前筛选',
                    'date_range': normalize_range_text(page_ctx.get('merch_date_range') or '') or '当前筛选',
                })
            return ctx

        ctx.setdefault('time_scope', '当前筛选')
        ctx.setdefault('date_range', '当前筛选')
        return ctx

    if adapter_id == 'tiktok-ops-assistant':
        ctx = {
            'time_scope': '当前筛选',
            'date_range': '当前筛选',
        }
        tiktok_regions = run_params.get('shop_regions') or run_params.get('regions') or []
        ctx['region_scope'] = normalize_list_scope(tiktok_regions, '全部地区')
        if task_id == 'product_management_export':
            status_label_map = {
                'all': '全部',
                'active': '在售',
                'reviewing': '审核中',
                'violation': '需要关注',
                'deactivate': '已下架',
                'draft': '草稿',
                'deleted': '已删除',
                'sold-out': '售罄',
                'listing-failed': '审核失败',
                'suspended': '平台下架',
                'frozen': '已冻结',
                'traffic-deboost': '流量管控',
            }
            statuses = run_params.get('product_statuses') or run_params.get('statuses') or []
            if isinstance(statuses, list):
                clean_statuses = [
                    status_label_map.get(str(item).strip(), str(item).strip())
                    for item in statuses
                    if str(item).strip()
                ]
                ctx['status_scope'] = '+'.join(clean_statuses) if clean_statuses else '默认状态'
            else:
                raw_status = str(statuses or '').strip()
                ctx['status_scope'] = status_label_map.get(raw_status, raw_status) or '默认状态'
        return ctx

    if adapter_id == 'aliexpress-ops-assistant':
        ctx = {
            'time_scope': '当前筛选',
            'date_range': '当前筛选',
        }
        date_context_js = r"""
(() => {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
  const normalizeDate = value => {
    const match = clean(value).match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
    if (!match) return ''
    return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`
  }
  const dates = [...document.querySelectorAll('input')]
    .map(input => normalizeDate(input.value || input.getAttribute('value') || ''))
    .filter(Boolean)
  return {
    success: true,
    data: [{
      stat_date: dates[0] || '',
      end_date: dates[1] || dates[0] || '',
    }],
    meta: { has_more: false }
  }
})()
"""
        page_ctx = await _evaluate_filename_context(runner, date_context_js)
        time_label_map = {
            'page': '当前筛选',
            'recent1': '最近1天',
            'recent7': '最近7天',
            'recent30': '最近30天',
            'day': '自然日',
            'week': '自然周',
            'month': '自然月',
        }
        time_range = str(run_params.get('time_range') or '').strip()
        if time_range:
            ctx['time_scope'] = time_label_map.get(time_range, time_range)
        stat_date = str(run_params.get('stat_date') or run_params.get('date') or '').strip()
        start = stat_date or str(page_ctx.get('stat_date') or '').strip()
        end = stat_date or str(page_ctx.get('end_date') or start).strip()
        if start and end:
            ctx['date_range'] = f"{start}~{end}"
        elif start:
            ctx['date_range'] = start
        if task_id == 'product_ranking':
            rank_label_map = {
                'pay_amt': '支付榜',
                'uv': '访客榜',
                'wishlist': '收藏量',
                'cart': '加购榜',
            }
            rank_type = str(run_params.get('rank_type') or '').strip()
            ctx['rank_scope'] = rank_label_map.get(rank_type, rank_type) or '支付榜'
        return ctx

    if adapter_id != 'temu':
        return {}

    backend_context_js = r"""
(() => {
  const textOf = el => (el?.textContent || '').replace(/\s+/g, ' ').trim()
  const normalizeShopName = value => String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+\d+\s*人关注.*$/, '')
    .trim()
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const root = document.querySelector('[class*="userInfo"], [class*="seller-name"], [class*="account-info_userInfo"]')
  const blacklist = new Set(['服务市场', '履约中心', '学习', '运营对接', '规则中心', '消息', '客服', '反馈', '99+', '首页', '数据中心', '商品数据', 'TEMU Agent Center', 'Beta', 'Seller Central'])
  const seen = new Set()
  const candidates = []
  const push = text => {
    const clean = normalizeShopName(text)
    if (!clean || seen.has(clean)) return
    seen.add(clean)
    candidates.push(clean)
  }
  const sharedShopName = normalizeShopName(shared.shopName || shared.shop_name || '')
  const strictShopName = [...document.querySelectorAll('[class*="account-info_mallInfo__"], [class*="account-info_accountInfo__"]')]
    .map(el => normalizeShopName(textOf(el)))
    .find(text => text && text.length <= 80 && !blacklist.has(text)) || ''
  if (root) {
    push(textOf(root.querySelector('[class*="elli_outerWrapper"], [class*="seller-name"], [class*="shopName"], [class*="userName"]')))
    for (const el of root.querySelectorAll('*')) {
      const text = textOf(el)
      if (!text || text.length > 80) continue
      if ([...el.children].some(c => textOf(c) === text)) continue
      push(text)
    }
  }
  for (const el of document.querySelectorAll(
    '[class*="elli_outerWrapper"], [class*="mallInfo"], [class*="accountInfo"], [class*="account-info_mallInfo"], [class*="account-info_accountInfo"]'
  )) {
    const text = textOf(el)
    if (!text || text.length > 80) continue
    push(text)
  }
  const shopName =
    sharedShopName ||
    strictShopName ||
    candidates.find(text => /shop/i.test(text)) ||
    candidates.find(text => /[A-Za-z]/.test(text) && !blacklist.has(text)) ||
    candidates.find(text => !blacklist.has(text)) ||
    ''
  const rowContainsLabel = (row, label) => {
    if (!row || !label) return false
    if (textOf(row).includes(label)) return true
    return [...row.querySelectorAll('div, label, span, td, th, button, a')]
      .some(node => textOf(node).includes(label))
  }
  const timeRow = [...document.querySelectorAll('[class*="index-module__row___"]')].find(row => {
    const label = textOf(row.querySelector('[class*="index-module__row_label___"]'))
    if (label === '时间区间') return true
    if (label === '时间' && row.querySelector('input[data-testid="beast-core-rangePicker-htmlInput"]')) return true
    return false
  }) || null
  const reviewTimeRow = [...document.querySelectorAll('[class*="flat-field_item__"]')]
    .find(row => rowContainsLabel(row, '评价时间')) || null
  const timeScope = textOf(timeRow?.querySelector('input[data-testid="beast-core-select-htmlInput"]'))
  const dateRange = textOf(timeRow?.querySelector('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]'))
  const reviewActive = [...(reviewTimeRow?.querySelectorAll('[class*="flat-field_capsule__"]') || [])]
    .find(el => String(el.className || '').includes('flat-field_active__')) || null
  const reviewTimeScope = textOf(reviewActive)
  const reviewInput = reviewTimeRow?.querySelector('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]') || null
  const reviewDateRange = String(reviewInput?.value || '').trim() || (/^\d{4}-\d{2}-\d{2}\s*~\s*\d{4}-\d{2}-\d{2}$/.test(reviewTimeScope) ? reviewTimeScope : '')
  const activeOuterSite = textOf(
    [...document.querySelectorAll('a[class*="index-module__drItem___"]')]
      .find(el => String(el.className || '').includes('index-module__active___')) || null
  )
  return {
    success: true,
    data: [{
      shared_shop_name: sharedShopName,
      strict_shop_name: strictShopName,
      shop_name: shopName,
      time_scope: timeScope,
      date_range: dateRange,
      review_time_scope: reviewTimeScope,
      review_date_range: reviewDateRange,
      active_outer_site: activeOuterSite,
    }],
    meta: { has_more: false }
  }
})()
"""

    storefront_context_js = r"""
(() => {
  const textOf = el => (el?.textContent || '').replace(/\s+/g, ' ').trim()
  const h1 = textOf(document.querySelector('h1'))
  const title = String(document.title || '').replace(/\s*-\s*Great Offers.*$/i, '').trim()
  const goodsMatch = String(location.href || '').match(/(?:[?&]goods[_-]?id=|-g-)(\d{8,})/i)
  return {
    success: true,
    data: [{
      shop_name: h1 || title || '',
      current_url: String(location.href || ''),
      goods_id: goodsMatch ? goodsMatch[1] : '',
    }],
    meta: { has_more: false }
  }
})()
"""

    page_ctx = {}
    if task_id not in {'reviews', 'store_items', 'single_product_reviews'}:
        page_ctx = await _evaluate_filename_context(runner, backend_context_js)
    elif task_id in {'reviews', 'store_items', 'single_product_reviews'}:
        page_ctx = await _evaluate_filename_context(runner, storefront_context_js)

    shared_shop_name = str(page_ctx.get('shared_shop_name') or '').strip()
    strict_shop_name = str(page_ctx.get('strict_shop_name') or '').strip()
    shop_name = shared_shop_name or strict_shop_name or str(page_ctx.get('shop_name') or '').strip()
    if not shop_name and task_id in {'reviews', 'store_items'}:
        shop_url = str(run_params.get('shop_url') or '').strip()
        if shop_url:
            try:
                parsed = urlparse(shop_url)
                shop_name = parse_qs(parsed.query).get('mall_id', [''])[0].strip()
            except Exception:
                shop_name = ''

    ctx = {'shop_name': shop_name or 'Temu店铺'}

    if task_id == 'single_product_reviews':
        product_url_for_filename = _first_url_from_value(
            run_params.get('product_url')
            or run_params.get('product_urls')
            or run_params.get('productUrls')
            or ''
        )
        goods_url_for_filename = _first_url_from_value(
            run_params.get('goods_url')
            or run_params.get('goodsUrl')
            or run_params.get('item_url')
            or run_params.get('itemUrl')
            or run_params.get('url')
            or ''
        )
        goods_id = (
            extract_temu_goods_id(run_params.get('goods_id'))
            or extract_temu_goods_id(product_url_for_filename)
            or extract_temu_goods_id(goods_url_for_filename)
            or extract_temu_goods_id(page_ctx.get('goods_id'))
            or extract_temu_goods_id(page_ctx.get('current_url'))
        )
        ctx['goods_id'] = goods_id or '未知商品'

    def normalize_temporal_value(value) -> str:
        if isinstance(value, str):
            return str(value or '').strip()
        if not value or not isinstance(value, dict):
            return ''
        direct = str(value.get('value') or '').strip()
        start = str(value.get('start') or '').strip()
        end = str(value.get('end') or '').strip()
        if direct:
            return direct
        if start and end:
            return f"{start}~{end}"
        return start or end

    def resolve_relative_range(label: str, mapping: dict[str, int]) -> str:
        label = str(label or '').strip()
        if not label:
            return ''
        today = datetime.now().date()
        if label == '今日':
            return f"{today.isoformat()}~{today.isoformat()}"
        if label == '昨日':
            day = today - timedelta(days=1)
            return f"{day.isoformat()}~{day.isoformat()}"
        if label == '本周':
            start_day = today - timedelta(days=today.weekday())
            return f"{start_day.isoformat()}~{today.isoformat()}"
        if label == '本月':
            start_day = today.replace(day=1)
            return f"{start_day.isoformat()}~{today.isoformat()}"
        days = mapping.get(label)
        if not days:
            return ''
        start_day = today - timedelta(days=days - 1)
        return f"{start_day.isoformat()}~{today.isoformat()}"

    def resolve_time_filename_context() -> dict:
        candidates = [
            {
                'time_param': 'review_time_range',
                'custom_param': 'custom_review_time_range',
                'page_scope_key': 'review_time_scope',
                'page_range_key': 'review_date_range',
                'relative_map': {'近30天': 30, '近60天': 60, '近90天': 90},
                'custom_scope_key': '',
                'custom_scope_label': '自定义',
            },
            {
                'time_param': 'time_range',
                'custom_param': 'custom_range',
                'page_scope_key': 'time_scope',
                'page_range_key': 'date_range',
                'relative_map': {'昨日': 1, '近7日': 7, '近30日': 30},
                'custom_scope_key': '',
                'custom_scope_label': '自定义',
            },
            {
                'time_param': 'return_time_range',
                'custom_param': 'custom_return_time_range',
                'page_scope_key': 'time_scope',
                'page_range_key': 'date_range',
                'relative_map': {'今日': 0, '昨日': 1, '近7日': 7, '近30日': 30},
                'custom_scope_key': 'return_time_field',
                'custom_scope_label': '自定义',
            },
            {
                'time_param': 'qc_time_range',
                'custom_param': 'custom_qc_time_range',
                'page_scope_key': 'time_scope',
                'page_range_key': 'date_range',
                'relative_map': {'今日': 0, '昨日': 1, '近7日': 7, '近30日': 30},
                'custom_scope_key': '',
                'custom_scope_label': '最新抽检时间',
            },
            {
                'time_param': '',
                'custom_param': 'custom_qc_time_range',
                'page_scope_key': '',
                'page_range_key': '',
                'relative_map': {},
                'custom_scope_key': '',
                'custom_scope_label': '最新抽检时间',
            },
            {
                'time_param': '',
                'custom_param': 'custom_return_time_range',
                'page_scope_key': '',
                'page_range_key': '',
                'relative_map': {},
                'custom_scope_key': 'return_time_field',
                'custom_scope_label': '自定义',
            },
            {
                'time_param': 'list_time_range',
                'custom_param': None,
                'page_scope_key': '',
                'page_range_key': '',
                'relative_map': {'近7日': 7, '近30日': 30},
                'custom_scope_key': '',
                'custom_scope_label': '自定义',
            },
            {
                'time_param': 'detail_time_range',
                'custom_param': None,
                'page_scope_key': '',
                'page_range_key': '',
                'relative_map': {'近7日': 7, '近30日': 30},
                'custom_scope_key': '',
                'custom_scope_label': '自定义',
            },
        ]

        for spec in candidates:
            time_param = spec['time_param']
            custom_param = spec['custom_param']
            if time_param not in run_params and custom_param not in run_params:
                continue

            time_range = str(run_params.get(time_param) or '').strip() if time_param else ''
            custom_range = run_params.get(custom_param) or {}
            start = str(custom_range.get('start') or '').strip()
            end = str(custom_range.get('end') or '').strip()
            page_time_scope = str(page_ctx.get(spec['page_scope_key']) or '').strip()
            page_date_range = normalize_range_text(page_ctx.get(spec['page_range_key']) or '')
            custom_scope = str(run_params.get(spec.get('custom_scope_key') or '') or '').strip()

            if start and end:
                return {
                    'time_scope': custom_scope or page_time_scope or spec.get('custom_scope_label') or '自定义',
                    'date_range': f"{start}~{end}",
                }

            if time_range == '自定义':
                return {
                    'time_scope': custom_scope or page_time_scope or spec.get('custom_scope_label') or '自定义',
                    'date_range': f"{start}~{end}" if start and end else (page_date_range or '自定义'),
                }
            if time_range:
                return {
                    'time_scope': time_range,
                    'date_range': page_date_range or resolve_relative_range(time_range, spec['relative_map']) or time_range,
                }
            return {
                'time_scope': page_time_scope or '当前筛选',
                'date_range': page_date_range or resolve_relative_range(page_time_scope, spec['relative_map']) or page_time_scope or '当前筛选',
            }

        date_range_specs = [
            ('stat_date_range', '统计日期'),
            ('stat_week', '按周'),
            ('stat_month', '按月'),
            ('bill_date_range', '对账日期'),
        ]
        for param_key, scope_label in date_range_specs:
            if param_key not in run_params:
                continue
            value = normalize_temporal_value(run_params.get(param_key))
            if not value:
                continue
            return {'time_scope': scope_label, 'date_range': normalize_range_text(value)}

        return {}

    ctx.update(resolve_time_filename_context())
    ctx.setdefault('time_scope', '当前筛选')
    ctx.setdefault('date_range', '当前筛选')

    regions = run_params.get('regions') or []
    ctx['region_scope'] = normalize_list_scope(regions, '全部地区')
    ctx['site_scope'] = normalize_list_scope(run_params.get('outer_sites') or [], '全部站点')
    ctx['detail_site_scope'] = normalize_list_scope(run_params.get('detail_sites') or [], '全部详情站点')
    ctx['detail_grain_scope'] = normalize_list_scope(run_params.get('detail_grains') or [], '全部粒度')

    stat_grain = str(run_params.get('stat_grain') or '').strip()
    if stat_grain:
        ctx['grain_scope'] = stat_grain
    elif 'stat_grain' in run_params:
        ctx['grain_scope'] = '当前粒度'
    else:
        ctx['grain_scope'] = '当前粒度'

    goods_statuses = run_params.get('goods_statuses') or []
    ctx['goods_status_scope'] = normalize_list_scope(goods_statuses, '全部状态')
    qc_statuses = run_params.get('qc_statuses') or []
    ctx['qc_status_scope'] = normalize_list_scope(qc_statuses, '全部结果')
    if task_id == 'recommended_retail_price':
        ctx['status_scope'] = '全部状态'
    if task_id == 'quality_dashboard':
        ctx['quality_tab_scope'] = '品质分析+品质优化'

    return ctx


def _url_matches_prefix(url: str, prefix: str) -> bool:
    if not url or not prefix:
        return False
    if url.startswith(prefix):
        return True

    try:
        url_p = urlparse(url)
        prefix_p = urlparse(prefix)
    except Exception:
        return False

    url_host = (url_p.hostname or '').lower()
    prefix_host = (prefix_p.hostname or '').lower()
    url_path = url_p.path or '/'
    prefix_path = prefix_p.path or '/'

    if not url_host or not prefix_host:
        return False

    if url_host == prefix_host:
        return url_path.startswith(prefix_path)

    # Temu seller 现在会按区域切到 agentseller-us.temu.com / agentseller-xx.temu.com
    if prefix_host == 'agentseller.temu.com' and url_host.endswith('.temu.com') and url_host.startswith('agentseller'):
        normalized_prefix = prefix_path if prefix_path.endswith('/') else prefix_path + '/'
        normalized_url = url_path if url_path.endswith('/') else url_path + '/'
        return normalized_url.startswith(normalized_prefix) or normalized_prefix == '//'

    return False


def _is_temu_agentseller_url(url: str) -> bool:
    try:
        parsed = urlparse(str(url or ""))
    except Exception:
        return False
    host = (parsed.hostname or "").lower()
    return host == "agentseller.temu.com" or (
        host.endswith(".temu.com") and host.startswith("agentseller-")
    )


def _is_temu_kuajingmaihuo_url(url: str) -> bool:
    try:
        parsed = urlparse(str(url or ""))
    except Exception:
        return False
    return (parsed.hostname or "").lower() == "seller.kuajingmaihuo.com"


def _is_temu_backend_url(url: str) -> bool:
    return _is_temu_agentseller_url(url) or _is_temu_kuajingmaihuo_url(url)


def _is_temu_no_auth_url(url: str) -> bool:
    try:
        parsed = urlparse(str(url or ""))
    except Exception:
        return False
    host = (parsed.hostname or "").lower()
    path = parsed.path or ""
    return host == "seller.temu.com" and path == "/no-auth.html"


def _temu_new_tab_entry_url(target_entry_url: str) -> str:
    """Open Temu backend from its shell first; direct protected deep links can hit no-auth."""
    if not _is_temu_backend_url(target_entry_url):
        return target_entry_url
    try:
        parsed = urlparse(str(target_entry_url or ""))
    except Exception:
        return "https://agentseller.temu.com"
    host = (parsed.hostname or "agentseller.temu.com").lower()
    if host == "agentseller.temu.com" or (host.endswith(".temu.com") and host.startswith("agentseller-")):
        return f"{parsed.scheme or 'https'}://{host}/"
    if host == "seller.kuajingmaihuo.com":
        return "https://seller.kuajingmaihuo.com/main/order-manager/shipping-list"
    return "https://agentseller.temu.com"


def _is_temu_opener_tab_url(url: str) -> bool:
    return _is_temu_backend_url(url) and not _is_temu_no_auth_url(url)


def _is_doudian_fxg_url(url: str) -> bool:
    try:
        parsed = urlparse(str(url or ""))
    except Exception:
        return False
    return (parsed.hostname or "").lower() == "fxg.jinritemai.com"


def _is_doudian_backend_url(url: str) -> bool:
    if not _is_doudian_fxg_url(url):
        return False
    try:
        parsed = urlparse(str(url or ""))
    except Exception:
        return False
    return (parsed.path or "").startswith("/ffa/")


def _is_doudian_opener_tab_url(url: str) -> bool:
    return _is_doudian_backend_url(url)


def _doudian_opener_tab_sort_key(target_entry_url: str, tab_url: str) -> tuple[int, int]:
    try:
        target_path = urlparse(str(target_entry_url or "")).path or ""
        tab_path = urlparse(str(tab_url or "")).path or ""
    except Exception:
        return (2, 0)
    target_section = "/".join(target_path.strip("/").split("/")[:2])
    tab_section = "/".join(tab_path.strip("/").split("/")[:2])
    return (
        0 if target_section and target_section == tab_section else 1,
        0 if "/campaign" in tab_path or "/merchant" in tab_path else 1,
    )


def _temu_opener_tab_sort_key(target_entry_url: str, tab_url: str) -> tuple[int, int]:
    if _is_temu_kuajingmaihuo_url(target_entry_url):
        return (0 if _is_temu_kuajingmaihuo_url(tab_url) else 1, 0)
    if _is_temu_agentseller_url(target_entry_url):
        return (0 if _is_temu_agentseller_url(tab_url) else 1, 0)
    return (0, 0)


def _is_compatible_current_tab_for_task(adapter_id: str, task_id: str, target_entry_url: str, tab_url: str) -> bool:
    if adapter_id != "temu":
        return False
    if _is_temu_agentseller_url(target_entry_url):
        return _is_temu_agentseller_url(tab_url)
    if _is_temu_kuajingmaihuo_url(target_entry_url):
        return _is_temu_kuajingmaihuo_url(tab_url)
    return False


def _normalize_export_guard_value(value) -> str:
    return str(value or '').strip()


def _dedupe_temu_goods_traffic_detail_rows(data_rows):
    if not isinstance(data_rows, list):
        return data_rows

    deduped = []
    seen = set()

    for row in data_rows:
        if not isinstance(row, dict):
            deduped.append(row)
            continue

        if _normalize_export_guard_value(row.get('记录类型')) != '明细':
            deduped.append(row)
            continue

        outer_site = _normalize_export_guard_value(row.get('外层站点'))
        spu = _normalize_export_guard_value(row.get('SPU'))
        detail_site = _normalize_export_guard_value(row.get('详情站点筛选'))
        detail_grain = _normalize_export_guard_value(row.get('详情时间粒度'))
        date = _normalize_export_guard_value(row.get('日期'))
        site = _normalize_export_guard_value(row.get('站点'))

        # 仅对明细行做最终去重保险，避免误伤异常行或上下文不完整的记录。
        if not all([spu, detail_site, detail_grain, date, site]):
            deduped.append(row)
            continue

        key = (outer_site, spu, detail_site, detail_grain, date, site)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)

    return deduped


def _dedupe_amazon_reviews_full_export_rows(data_rows):
    if not isinstance(data_rows, list):
        return data_rows

    deduped = []
    seen = set()

    for row in data_rows:
        if not isinstance(row, dict):
            deduped.append(row)
            continue

        asin = _normalize_export_guard_value(row.get('ASIN'))
        review_id = _normalize_export_guard_value(row.get('评价ID'))
        if asin and review_id:
            key = (asin, review_id)
        else:
            key_parts = [
                asin,
                _normalize_export_guard_value(row.get('买家昵称')),
                _normalize_export_guard_value(row.get('评价时间')),
                _normalize_export_guard_value(row.get('评分')),
                _normalize_export_guard_value(row.get('评价标题')),
                _normalize_export_guard_value(row.get('评价内容')),
            ]
            if not asin or not any(key_parts[1:]):
                deduped.append(row)
                continue
            key = tuple(key_parts)

        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)

    return deduped


def _apply_final_export_guards(adapter_id: str, task_id: str, data_rows):
    guarded = data_rows if isinstance(data_rows, list) else list(data_rows or [])
    if adapter_id == 'temu' and task_id == 'goods_traffic_detail':
        guarded = _dedupe_temu_goods_traffic_detail_rows(guarded)
    if adapter_id == 'amazon-ops-assistant' and task_id == 'amazon_reviews_full_export':
        guarded = _dedupe_amazon_reviews_full_export_rows(guarded)
    return guarded


def _safe_local_name(value: str, fallback: str = "item") -> str:
    text = str(value or "").strip()
    text = re.sub(r'[\x00-\x1f]+', '', text)
    text = re.sub(r'[\\/:*?"<>|]+', '_', text)
    text = re.sub(r'\s+', ' ', text).strip(' ._')
    return text or fallback


def _ensure_unique_local_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    index = 2
    while True:
        candidate = path.with_name(f"{stem}_{index}{suffix}")
        if not candidate.exists():
            return candidate
        index += 1


def _ensure_unique_local_dir(path: Path) -> Path:
    if not path.exists():
        return path
    index = 2
    while True:
        candidate = path.with_name(f"{path.name}_{index}")
        if not candidate.exists():
            return candidate
        index += 1


def _parse_semir_cloud_path(raw_value: str) -> dict:
    raw = str(raw_value or "").strip()
    divider = raw.find("//")
    if divider < 0:
      return {"mount_name": "", "relative_path": "", "relative_prefix": ""}
    mount_name = str(raw[:divider]).strip()
    relative_path = "/".join(
        part.strip()
        for part in raw[divider + 2:].replace("\\", "/").split("/")
        if str(part or "").strip()
    )
    return {
        "mount_name": mount_name,
        "relative_path": relative_path,
        "relative_prefix": f"{relative_path}/" if relative_path else "",
    }


def _normalize_semir_package_layout(raw_value: str) -> str:
    return "flat" if str(raw_value or "").strip().lower() == "flat" else "by_code"


def _semir_output_folder_and_filename(
    fullpath: str,
    relative_path: str,
    fallback_name: str,
    preferred_filename: str = "",
) -> tuple[str, str]:
    normalized_fullpath = str(fullpath or "").replace("\\", "/").strip("/")
    normalized_base = str(relative_path or "").replace("\\", "/").strip("/")
    preferred_clean_name = (
        _safe_local_name(preferred_filename, "")
        if str(preferred_filename or "").strip()
        else ""
    )

    if normalized_fullpath:
        tail = normalized_fullpath
    elif normalized_base:
        tail = f"{normalized_base}/{fallback_name}"
    else:
        tail = fallback_name

    safe_parts = [_safe_local_name(part, "item") for part in tail.split("/") if str(part or "").strip()]
    if not safe_parts:
        clean_name = preferred_clean_name or _safe_local_name(fallback_name, "file")
        return ("未分类路径", clean_name)

    if len(safe_parts) == 1:
        clean_name = preferred_clean_name or _safe_local_name(safe_parts[0], _safe_local_name(fallback_name, "file"))
        return ("未分类路径", clean_name)

    clean_name = preferred_clean_name or _safe_local_name(safe_parts[-1], _safe_local_name(fallback_name, "file"))
    folder_name = "__".join(part for part in safe_parts[:-1] if str(part or "").strip()) or "未分类路径"
    return (_safe_local_name(folder_name, "未分类路径"), clean_name)


def _build_semir_package_target(
    package_root: Path,
    input_code: str,
    folder_name: str,
    clean_filename: str,
    *,
    package_layout: str,
    preserve_path: bool,
) -> Path:
    if _normalize_semir_package_layout(package_layout) == "flat":
        return package_root / clean_filename
    if preserve_path:
        return package_root / input_code / folder_name / clean_filename
    return package_root / input_code / clean_filename


def _copy_file_to_unique_target(source: Path, target: Path) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    unique_target = _ensure_unique_local_path(target)
    shutil.copy2(source, unique_target)
    return unique_target


def _move_file_to_unique_target(source: Path, target: Path) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    unique_target = _ensure_unique_local_path(target)
    try:
        shutil.move(str(source), str(unique_target))
    except Exception:
        shutil.copy2(source, unique_target)
        try:
            source.unlink()
        except Exception:
            logger.debug("Failed to clean source after fallback copy %s", source, exc_info=True)
    return unique_target


def _move_dir_to_unique_target(source: Path, target: Path) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    unique_target = _ensure_unique_local_dir(target)
    try:
        shutil.move(str(source), str(unique_target))
    except Exception:
        shutil.copytree(source, unique_target)
        shutil.rmtree(source, ignore_errors=True)
    return unique_target


def _relocate_runtime_file_to_unique_target(source: Path, target: Path, runtime_dir: Path) -> Path:
    try:
        if _is_within_directory(source, runtime_dir):
            return _move_file_to_unique_target(source, target)
    except Exception:
        logger.debug("Failed to decide runtime file relocation for %s", source, exc_info=True)
    return _copy_file_to_unique_target(source, target)


def _cleanup_semir_runtime_artifacts(runtime_files: list, package_root: Optional[Path]) -> None:
    for file_path in runtime_files or []:
        source = Path(str(file_path or "")).expanduser()
        try:
            if source.exists() and source.is_file():
                source.unlink()
        except Exception:
            logger.debug("Failed to clean semir runtime file %s", source, exc_info=True)

    try:
        if package_root and package_root.exists() and package_root.is_dir():
            shutil.rmtree(package_root)
    except Exception:
        logger.debug("Failed to clean semir package root %s", package_root, exc_info=True)


def _cleanup_shenhui_runtime_artifacts(runtime_files: list, package_root: Optional[Path], work_dir: Optional[Path]) -> None:
    _cleanup_semir_runtime_artifacts(runtime_files, package_root)
    try:
        if work_dir and work_dir.exists() and work_dir.is_dir():
            shutil.rmtree(work_dir)
    except Exception:
        logger.debug("Failed to clean shenhui work dir %s", work_dir, exc_info=True)


def _is_within_directory(path: Path, directory: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(directory.resolve(strict=False))
        return True
    except Exception:
        return False


def _cleanup_runtime_artifact_dir(runtime_artifact_dir: str, preserve_paths: Optional[list] = None) -> None:
    runtime_dir = Path(str(runtime_artifact_dir or "")).expanduser()
    if not runtime_dir.exists() or not runtime_dir.is_dir():
        return

    preserved: set[Path] = set()
    for raw_path in preserve_paths or []:
        if not str(raw_path or "").strip():
            continue
        try:
            path = Path(str(raw_path)).expanduser().resolve(strict=False)
        except Exception:
            continue
        if _is_within_directory(path, runtime_dir):
            preserved.add(path)

    for path in sorted(runtime_dir.rglob("*"), key=lambda item: len(item.parts), reverse=True):
        path_resolved = path.resolve(strict=False)
        if path_resolved in preserved:
            continue
        if path.is_dir() and any(_is_within_directory(preserved_path, path_resolved) for preserved_path in preserved):
            try:
                next(path.iterdir())
            except StopIteration:
                try:
                    path.rmdir()
                except Exception:
                    logger.debug("Failed to remove empty runtime dir %s", path, exc_info=True)
            except Exception:
                logger.debug("Failed to inspect runtime dir %s", path, exc_info=True)
            continue

        try:
            if path.is_dir():
                path.rmdir()
            else:
                path.unlink(missing_ok=True)
        except Exception:
            logger.debug("Failed to clean runtime artifact %s", path, exc_info=True)

    try:
        next(runtime_dir.iterdir())
    except StopIteration:
        try:
            runtime_dir.rmdir()
        except Exception:
            logger.debug("Failed to remove empty runtime dir %s", runtime_dir, exc_info=True)
    except Exception:
        logger.debug("Failed to inspect runtime dir %s", runtime_dir, exc_info=True)


def _cleanup_orphaned_runtime_artifacts(runs: Optional[list] = None) -> None:
    for run in runs or []:
        adapter_id = str((run or {}).get("adapter_id") or "").strip()
        task_id = str((run or {}).get("task_id") or "").strip()
        run_id = (run or {}).get("id")
        if (adapter_id, task_id) not in RUNTIME_CLEANUP_TASKS or run_id is None:
            continue
        try:
            runtime_dir = data_sink.artifact_dir_path(adapter_id, task_id, int(run_id), "runtime")
        except Exception:
            continue
        _cleanup_runtime_artifact_dir(str(runtime_dir), preserve_paths=[])


def _append_note(existing: object, note: str) -> str:
    current = str(existing or "").strip()
    clean_note = str(note or "").strip()
    if not current:
        return clean_note
    if not clean_note or clean_note in current:
        return current
    return f"{current}; {clean_note}"


def _truthy_param(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (list, tuple, set)):
        return any(_truthy_param(item) for item in value)
    normalized = str(value or "").strip().lower()
    return normalized in {"1", "true", "yes", "y", "on", "zip", "auto_zip", "auto_zip_package", "是", "压缩"}


def _shenhui_auto_zip_enabled(run_params: Optional[dict]) -> bool:
    return _truthy_param((run_params or {}).get("auto_zip_package"))


def _verify_tiktok_creator_video_download_rows(data_rows: list, log=None) -> list:
    success_total = 0
    missing_rows = []
    for row in data_rows or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("下载结果") or "").strip() != "已下载":
            continue
        success_total += 1
        local_path_text = str(row.get("本地文件") or "").strip()
        local_path = Path(local_path_text).expanduser() if local_path_text else None
        if local_path and local_path.is_file() and local_path.stat().st_size > 0:
            continue
        missing_rows.append(row)

    for row in missing_rows:
        row["下载结果"] = "下载失败"
        row["下载备注"] = _append_note(row.get("下载备注"), "下载完成后本地文件缺失，未打包")
        row["本地文件"] = ""

    if missing_rows and log:
        available = success_total - len(missing_rows)
        log(
            "TikTok creator video local file check: "
            f"{available}/{success_total} downloaded files still exist; "
            f"{len(missing_rows)} missing rows marked failed before export"
        )
    return data_rows


def _default_output_root_for_runtime(runtime_dir: Path, exported_files: list) -> Path:
    exported_refs = [str(path or "").strip() for path in exported_files or [] if str(path or "").strip()]
    if exported_refs:
        return Path(exported_refs[0]).expanduser().parent
    if runtime_dir.parent.name == "runtime":
        return runtime_dir.parent.parent
    return runtime_dir.parent


def _semir_output_roots(runtime_dir: Path, exported_files: list, run_params: dict) -> tuple[Path, Optional[Path], list[str]]:
    exported_refs = [str(path) for path in exported_files or [] if str(path or "").strip()]
    default_root = _default_output_root_for_runtime(runtime_dir, exported_refs)
    export_folder = str((run_params or {}).get("export_folder") or "").strip()
    export_root = Path(export_folder).expanduser() if export_folder else None
    if export_root:
        export_root.mkdir(parents=True, exist_ok=True)
    return default_root, export_root, exported_refs


def _finalize_shenhui_new_arrival_outputs(
    task_id: str,
    data_rows: list,
    runtime_files: list,
    exported_files: list,
    run_params: dict,
    runtime_artifact_dir: str,
    log,
) -> list[str]:
    if task_id == "pdf_batch_screenshot":
        return finalize_pdf_batch_screenshot_outputs(
            data_rows=data_rows,
            exported_files=exported_files,
            run_params=run_params,
            runtime_artifact_dir=runtime_artifact_dir,
            log=log,
        )

    if task_id != "prepare_upload_package":
        return [str(path) for path in (runtime_files or []) + (exported_files or []) if str(path or "").strip()]

    runtime_dir = Path(runtime_artifact_dir)
    runtime_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    package_base = _safe_local_name(
        run_params.get("package_name") or f"深绘上新图包_{timestamp}",
        f"深绘上新图包_{timestamp}",
    )
    package_root = _ensure_unique_local_dir(runtime_dir / package_base)
    pdf_work_dir = _ensure_unique_local_dir(runtime_dir / "_pdf_work")
    auto_zip_package = _shenhui_auto_zip_enabled(run_params)

    successful_rows = []
    for row in data_rows or []:
        if not isinstance(row, dict):
            continue
        local_path = Path(str(row.get("本地文件") or "")).expanduser()
        if str(row.get("下载结果") or "").strip() != "已下载" or not local_path.is_file():
            continue
        successful_rows.append((row, local_path))

    style_zip_paths = []
    if successful_rows:
        finalize_started_at = time.monotonic()
        pdf_rows = []
        image_count = 0
        pdf_count = 0
        log(
            "Shenhui package finalize started: "
            f"{len(successful_rows)} downloaded files, auto_zip={auto_zip_package}"
        )
        for row, local_path in successful_rows:
            group_code = _safe_local_name(
                row.get("__shenhui_group_code") or row.get("输入款号") or row.get("输入编码") or "未分类",
                "未分类",
            )
            role = str(row.get("__shenhui_asset_role") or "").strip().lower()

            if role == "pdf_yq" or local_path.suffix.lower() == ".pdf":
                row["__pdf_path"] = str(local_path)
                row["原始路径"] = row.get("原始路径") or str(local_path)
                row["__shenhui_group_code"] = group_code
                pdf_rows.append((row, local_path, group_code))
                pdf_count += 1
                continue

            clean_filename = _safe_local_name(
                row.get("__package_filename") or row.get("文件名") or local_path.name,
                local_path.name,
            )
            target = package_root / group_code / clean_filename
            relocated = _relocate_runtime_file_to_unique_target(local_path, target, runtime_dir)
            row["本地文件"] = str(relocated)
            image_count += 1
        log(
            "Shenhui package files arranged: "
            f"{image_count} image/material files, {pdf_count} PDF files, "
            f"{time.monotonic() - finalize_started_at:.1f}s"
        )

        if pdf_rows:
            pdf_data_rows = [row for row, _local_path, _group_code in pdf_rows]
            pdf_started_at = time.monotonic()
            converted_count = convert_pdf_rows_to_yq_output_root(
                data_rows=pdf_data_rows,
                output_root=package_root,
                pdf_work_dir=pdf_work_dir,
                run_params=run_params or {},
                log=log,
            )
            if converted_count:
                log(f"Shenhui downloaded PDF screenshots added to style packages: {converted_count}")
            for row, local_path, group_code in pdf_rows:
                if str(row.get("处理动作") or "").strip() != "截图失败":
                    continue
                pending_target = package_root / group_code / "_PDF待裁图" / _safe_local_name(
                    row.get("__package_filename") or row.get("文件名") or local_path.name,
                    local_path.name,
                )
                if local_path.is_file():
                    preserved = _copy_file_to_unique_target(local_path, pending_target)
                    row["本地文件"] = str(preserved)
                    row["备注"] = _append_note(row.get("备注"), f"原 PDF 已保留：{preserved.name}")
            log(
                "Shenhui package PDF processing finished: "
                f"{converted_count} generated images from {len(pdf_rows)} PDF files, "
                f"{time.monotonic() - pdf_started_at:.1f}s"
            )

        if auto_zip_package:
            zip_started_at = time.monotonic()
            style_zip_dir = _ensure_unique_local_dir(runtime_dir / f"{package_root.name}_deepdraw_zips")
            style_zip_dir.mkdir(parents=True, exist_ok=True)
            for style_dir in sorted(path for path in package_root.iterdir() if path.is_dir()):
                if style_dir.name.startswith("_"):
                    continue
                style_zip_path = _ensure_unique_local_path(style_zip_dir / f"{style_dir.name}.zip")
                with zipfile.ZipFile(style_zip_path, "w", compression=zipfile.ZIP_STORED) as archive:
                    for file_path in sorted(style_dir.rglob("*")):
                        if not file_path.is_file():
                            continue
                        archive.write(file_path, arcname=str(file_path.relative_to(style_dir)))
                style_zip_paths.append(style_zip_path)
            if style_zip_paths:
                log(
                    "Shenhui DeepDraw style ZIPs created: "
                    f"{len(style_zip_paths)} in {time.monotonic() - zip_started_at:.1f}s"
                )
        else:
            log(
                "Shenhui package folder prepared without ZIP compression: "
                f"{package_root} ({time.monotonic() - finalize_started_at:.1f}s)"
            )

    export_folder = str(run_params.get("export_folder") or "").strip()
    exported_refs = [str(path) for path in exported_files or [] if str(path or "").strip()]
    final_refs = [*([str(path) for path in style_zip_paths if str(path or "").strip()]), *exported_refs]

    if export_folder:
        target_root = Path(export_folder).expanduser()
        target_root.mkdir(parents=True, exist_ok=True)
        external_refs = []

        if successful_rows and auto_zip_package:
            for style_zip_path in style_zip_paths:
                if style_zip_path.exists():
                    copied_style_zip = _copy_file_to_unique_target(style_zip_path, target_root / style_zip_path.name)
                    external_refs.append(str(copied_style_zip))
            if style_zip_paths:
                log(f"Shenhui style ZIPs copied to export folder: {target_root}")
        elif successful_rows and package_root.exists():
            external_dir = _move_dir_to_unique_target(package_root, target_root / package_root.name)
            external_refs.append(str(external_dir))
            log(f"Shenhui package folder copied to export folder: {external_dir}")

        for file_path in exported_files or []:
            source = Path(str(file_path or "")).expanduser()
            if not source.is_file():
                continue
            copied = _copy_file_to_unique_target(source, target_root / source.name)
            external_refs.append(str(copied))

        if external_refs:
            final_refs = external_refs
    elif style_zip_paths:
        target_root = _default_output_root_for_runtime(runtime_dir, exported_files)
        target_root.mkdir(parents=True, exist_ok=True)
        default_refs = []
        for style_zip_path in style_zip_paths:
            if style_zip_path.exists():
                copied_style_zip = _copy_file_to_unique_target(style_zip_path, target_root / style_zip_path.name)
                default_refs.append(str(copied_style_zip))
        if default_refs:
            log(f"Shenhui style ZIPs moved to default output folder: {target_root}")
            final_refs = [*default_refs, *exported_refs]
    elif successful_rows and package_root.exists():
        target_root = _default_output_root_for_runtime(runtime_dir, exported_files)
        target_root.mkdir(parents=True, exist_ok=True)
        external_dir = _move_dir_to_unique_target(package_root, target_root / package_root.name)
        log(f"Shenhui package folder moved to default output folder: {external_dir}")
        final_refs = [str(external_dir), *exported_refs]

    if successful_rows:
        _cleanup_shenhui_runtime_artifacts(runtime_files, package_root, pdf_work_dir)
    else:
        if package_root.exists():
            shutil.rmtree(package_root, ignore_errors=True)
        if pdf_work_dir.exists():
            shutil.rmtree(pdf_work_dir, ignore_errors=True)

    _cleanup_runtime_artifact_dir(str(runtime_dir), preserve_paths=final_refs)

    return final_refs


def _build_semir_ai_material_entries(data_rows: list) -> list[dict]:
    entries = []
    for row in data_rows or []:
        if not isinstance(row, dict):
            continue
        input_code = _safe_local_name(str(row.get("输入编码") or "").strip(), "未分类")
        materials = row.get("__素材明细") or []
        if not isinstance(materials, list):
            continue
        for material in materials:
            if not isinstance(material, dict):
                continue
            local_path = Path(str(material.get("local_path") or "")).expanduser()
            if not local_path.is_file():
                continue
            entries.append({
                "input_code": input_code,
                "filename": str(material.get("filename") or local_path.name).strip() or local_path.name,
                "cloud_path": str(material.get("cloud_path") or "").strip(),
                "local_path": local_path,
                "preserve_path": True,
            })
    return entries


def _build_semir_ai_generated_entries(data_rows: list) -> list[dict]:
    entries = []
    for row in data_rows or []:
        if not isinstance(row, dict):
            continue
        input_code = _safe_local_name(str(row.get("输入编码") or "").strip(), "未分类")
        generated = row.get("__生成图明细") or []
        if not isinstance(generated, list):
            continue
        for item in generated:
            if not isinstance(item, dict):
                continue
            local_path = Path(str(item.get("local_path") or "")).expanduser()
            if not local_path.is_file():
                continue
            entries.append({
                "input_code": input_code,
                "filename": str(item.get("filename") or local_path.name).strip() or local_path.name,
                "cloud_path": "",
                "local_path": local_path,
                "preserve_path": False,
            })
    return entries


def _create_semir_ai_zip(
    entries: list[dict],
    *,
    runtime_dir: Path,
    output_root: Path,
    package_base: str,
    relative_path: str,
    flatten_code_folder: bool,
    log,
) -> Optional[str]:
    if not entries:
        return None

    package_root = _ensure_unique_local_dir(runtime_dir / package_base)
    for entry in entries:
        folder_name, clean_filename = _semir_output_folder_and_filename(
            entry.get("cloud_path") or "",
            relative_path,
            entry.get("filename") or entry["local_path"].name,
        )
        target = _build_semir_package_target(
            package_root,
            entry["input_code"],
            folder_name,
            clean_filename,
            package_layout="by_code",
            preserve_path=bool(entry.get("preserve_path")) and not flatten_code_folder,
        )
        _copy_file_to_unique_target(entry["local_path"], target)

    output_root.mkdir(parents=True, exist_ok=True)
    zip_path = _ensure_unique_local_path(output_root / f"{package_root.name}.zip")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file_path in package_root.rglob("*"):
            if not file_path.is_file():
                continue
            archive.write(file_path, arcname=str(file_path.relative_to(package_root.parent)))
    shutil.rmtree(package_root, ignore_errors=True)
    log(f"Semir AI package created: {zip_path}")
    return str(zip_path)


def _finalize_semir_tmall_material_match_buy_outputs(
    data_rows: list,
    runtime_files: list,
    exported_files: list,
    run_params: dict,
    runtime_artifact_dir: str,
    log,
) -> list[str]:
    runtime_dir = Path(runtime_artifact_dir)
    runtime_dir.mkdir(parents=True, exist_ok=True)
    output_root, target_root, exported_refs = _semir_output_roots(runtime_dir, exported_files, run_params)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    package_base = _safe_local_name(
        run_params.get("package_name") or f"搭配购素材包_{timestamp}",
        f"搭配购素材包_{timestamp}",
    )
    package_root = _ensure_unique_local_dir(runtime_dir / package_base)

    successful_rows = []
    for row in data_rows or []:
        if not isinstance(row, dict):
            continue
        local_path = Path(str(row.get("本地文件") or "")).expanduser()
        if str(row.get("下载结果") or "").strip() != "已下载" or not local_path.is_file():
            continue
        successful_rows.append((row, local_path))

    zip_path = None
    if successful_rows:
        package_started_at = time.monotonic()
        for row, local_path in successful_rows:
            clean_filename = _safe_local_name(
                row.get("__package_filename") or row.get("文件名") or local_path.name,
                local_path.name,
            )
            target = package_root / clean_filename
            # A matched material can be reused by multiple target IDs, so keep the
            # runtime source in place until the final cleanup step.
            _copy_file_to_unique_target(local_path, target)

        zip_output_root = target_root or output_root
        zip_output_root.mkdir(parents=True, exist_ok=True)
        zip_path = _ensure_unique_local_path(zip_output_root / f"{package_root.name}.zip")
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED) as archive:
            for file_path in package_root.rglob("*"):
                if not file_path.is_file():
                    continue
                archive.write(file_path, arcname=str(file_path.relative_to(package_root.parent)))
        log(
            "Semir Tmall match-buy package created: "
            f"{zip_path} ({len(successful_rows)} files, {time.monotonic() - package_started_at:.1f}s)"
        )

    runtime_refs = [*exported_refs]
    if zip_path:
        runtime_refs.insert(0, str(zip_path))
    final_refs = runtime_refs

    if target_root:
        external_refs = []

        if successful_rows and zip_path and zip_path.exists():
            if _is_within_directory(zip_path, target_root):
                external_refs.append(str(zip_path))
            else:
                copied_zip = _copy_file_to_unique_target(zip_path, target_root / zip_path.name)
                external_refs.append(str(copied_zip))
            log(f"Semir Tmall match-buy ZIP ready in export folder: {target_root}")

        for file_path in exported_files or []:
            source = Path(str(file_path or "")).expanduser()
            if not source.is_file():
                continue
            copied = _copy_file_to_unique_target(source, target_root / source.name)
            external_refs.append(str(copied))

        if external_refs:
            final_refs = external_refs

    _cleanup_semir_runtime_artifacts(runtime_files, package_root)
    _cleanup_runtime_artifact_dir(str(runtime_dir), preserve_paths=final_refs)

    return final_refs


def _finalize_semir_cloud_drive_outputs(
    task_id: str,
    data_rows: list,
    runtime_files: list,
    exported_files: list,
    run_params: dict,
    runtime_artifact_dir: str,
    log,
) -> list[str]:
    if task_id != "batch_image_download":
        if task_id == "tmall_material_match_buy":
            return _finalize_semir_tmall_material_match_buy_outputs(
                data_rows=data_rows,
                runtime_files=runtime_files,
                exported_files=exported_files,
                run_params=run_params,
                runtime_artifact_dir=runtime_artifact_dir,
                log=log,
            )

        if task_id == "batch_ai_generate":
            runtime_dir = Path(runtime_artifact_dir)
            runtime_dir.mkdir(parents=True, exist_ok=True)
            output_root, _, exported_refs = _semir_output_roots(runtime_dir, exported_files, run_params)
            cloud = _parse_semir_cloud_path(run_params.get("cloud_path"))
            relative_path = cloud.get("relative_path") or ""
            duplicate_mode = str(run_params.get("duplicate_mode") or "first_per_stem").strip().lower()
            flatten_code_folder = duplicate_mode != "all"
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            final_refs: list[str] = []

            generated_zip = _create_semir_ai_zip(
                _build_semir_ai_generated_entries(data_rows),
                runtime_dir=runtime_dir,
                output_root=output_root,
                package_base=_safe_local_name(
                    run_params.get("generated_package_name") or f"森马云盘AI生成图包_{timestamp}",
                    f"森马云盘AI生成图包_{timestamp}",
                ),
                relative_path="",
                flatten_code_folder=True,
                log=log,
            )
            if generated_zip:
                final_refs.append(generated_zip)

            package_mode = str(run_params.get("material_package_mode") or "discard").strip().lower()
            if package_mode == "zip":
                material_zip = _create_semir_ai_zip(
                    _build_semir_ai_material_entries(data_rows),
                    runtime_dir=runtime_dir,
                    output_root=output_root,
                    package_base=_safe_local_name(
                        run_params.get("material_package_name") or f"森马云盘AI素材包_{timestamp}",
                        f"森马云盘AI素材包_{timestamp}",
                    ),
                    relative_path=relative_path,
                    flatten_code_folder=flatten_code_folder,
                    log=log,
                )
                if material_zip:
                    final_refs.append(material_zip)

            final_refs = [*final_refs, *exported_refs]
            _cleanup_semir_runtime_artifacts(runtime_files, None)
            _cleanup_runtime_artifact_dir(str(runtime_dir), preserve_paths=final_refs)
            return final_refs

        return [str(path) for path in (runtime_files or []) + (exported_files or []) if str(path or "").strip()]

    runtime_dir = Path(runtime_artifact_dir)
    runtime_dir.mkdir(parents=True, exist_ok=True)

    output_root, target_root, exported_refs = _semir_output_roots(runtime_dir, exported_files, run_params)

    cloud = _parse_semir_cloud_path(run_params.get("cloud_path"))
    relative_path = cloud.get("relative_path") or ""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    package_base = _safe_local_name(
        run_params.get("package_name") or f"森马云盘图片包_{timestamp}",
        f"森马云盘图片包_{timestamp}",
    )
    package_root = _ensure_unique_local_dir(runtime_dir / package_base)
    duplicate_mode = str(run_params.get("duplicate_mode") or "first_per_stem").strip().lower()
    package_layout = _normalize_semir_package_layout(run_params.get("package_layout"))
    preserve_path = duplicate_mode == "all"

    successful_rows = []
    for row in data_rows or []:
        if not isinstance(row, dict):
            continue
        local_path = Path(str(row.get("本地文件") or "")).expanduser()
        if str(row.get("下载结果") or "").strip() != "已下载" or not local_path.is_file():
            continue
        successful_rows.append((row, local_path))

    zip_path = None
    if successful_rows:
        for row, local_path in successful_rows:
            input_code = _safe_local_name(row.get("输入编码") or "未分类", "未分类")
            folder_name, clean_filename = _semir_output_folder_and_filename(
                row.get("云盘路径") or "",
                relative_path,
                row.get("文件名") or local_path.name,
                row.get("__package_filename") or "",
            )
            target = _build_semir_package_target(
                package_root,
                input_code,
                folder_name,
                clean_filename,
                package_layout=package_layout,
                preserve_path=preserve_path,
            )
            _copy_file_to_unique_target(local_path, target)

        zip_output_root = target_root or output_root
        zip_output_root.mkdir(parents=True, exist_ok=True)
        zip_path = _ensure_unique_local_path(zip_output_root / f"{package_root.name}.zip")
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for file_path in package_root.rglob("*"):
                if not file_path.is_file():
                    continue
                archive.write(file_path, arcname=str(file_path.relative_to(package_root.parent)))
        log(f"Semir package created: {zip_path}")

    runtime_refs = [*exported_refs]
    if zip_path:
        runtime_refs.insert(0, str(zip_path))
    final_refs = runtime_refs

    if target_root:
        external_refs = []

        if successful_rows and package_root.exists():
            external_dir = _ensure_unique_local_dir(target_root / package_root.name)
            shutil.copytree(package_root, external_dir)
            if zip_path and zip_path.exists() and _is_within_directory(zip_path, target_root):
                external_refs.append(str(zip_path))
            elif zip_path and zip_path.exists():
                copied_zip = _copy_file_to_unique_target(zip_path, target_root / zip_path.name)
                external_refs.append(str(copied_zip))
            log(f"Semir package copied to export folder: {external_dir}")

        for file_path in exported_files or []:
            source = Path(str(file_path or "")).expanduser()
            if not source.is_file():
                continue
            copied = _copy_file_to_unique_target(source, target_root / source.name)
            external_refs.append(str(copied))

        if external_refs:
            final_refs = external_refs

    _cleanup_semir_runtime_artifacts(runtime_files, package_root)
    _cleanup_runtime_artifact_dir(str(runtime_dir), preserve_paths=final_refs)

    return final_refs


def _finalize_tiktok_creator_video_outputs(
    data_rows: list,
    runtime_files: list,
    exported_files: list,
    run_params: dict,
    runtime_artifact_dir: str,
    log,
) -> list[str]:
    runtime_dir = Path(runtime_artifact_dir)
    runtime_dir.mkdir(parents=True, exist_ok=True)

    exported_refs = [str(path) for path in exported_files or [] if str(path or "").strip()]
    default_root = _default_output_root_for_runtime(runtime_dir, exported_files)
    output_dir = str(run_params.get("output_dir") or "").strip()
    target_root = Path(output_dir).expanduser() if output_dir else None
    if target_root:
        target_root.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    package_base = _safe_local_name(
        run_params.get("package_name") or f"达人视频下载_{timestamp}",
        f"达人视频下载_{timestamp}",
    )
    package_root = _ensure_unique_local_dir(runtime_dir / package_base)

    successful_rows = []
    downloaded_total = 0
    missing_rows = []
    for row in data_rows or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("下载结果") or "").strip() == "已下载":
            downloaded_total += 1
        local_path = Path(str(row.get("本地文件") or "")).expanduser()
        if str(row.get("下载结果") or "").strip() != "已下载":
            continue
        if not local_path.is_file():
            missing_rows.append(row)
            continue
        successful_rows.append((row, local_path))

    if downloaded_total:
        log(f"TikTok creator video package includes {len(successful_rows)}/{downloaded_total} downloaded files")
    if missing_rows:
        log(f"[warn] TikTok creator video package skipped {len(missing_rows)} rows because local files were missing")

    zip_path = None
    if successful_rows:
        for row, local_path in successful_rows:
            filename = _safe_local_name(
                row.get("计划文件名") or row.get("视频ID") or local_path.name,
                local_path.name,
            )
            _copy_file_to_unique_target(local_path, package_root / filename)

        zip_output_root = target_root or default_root
        zip_output_root.mkdir(parents=True, exist_ok=True)
        zip_path = _ensure_unique_local_path(zip_output_root / f"{package_root.name}.zip")
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for file_path in package_root.rglob("*"):
                if not file_path.is_file():
                    continue
                archive.write(file_path, arcname=str(file_path.relative_to(package_root.parent)))
        log(f"TikTok creator video package created: {zip_path}")

    final_refs = [*([str(zip_path)] if zip_path else []), *exported_refs]

    if target_root:
        external_refs = []
        if zip_path and zip_path.exists() and _is_within_directory(zip_path, target_root):
            external_refs.append(str(zip_path))
        elif zip_path and zip_path.exists():
            external_refs.append(str(_copy_file_to_unique_target(zip_path, target_root / zip_path.name)))
        for file_path in exported_files or []:
            source = Path(str(file_path or "")).expanduser()
            if not source.is_file():
                continue
            copied = _copy_file_to_unique_target(source, target_root / source.name)
            external_refs.append(str(copied))
        if external_refs:
            final_refs = external_refs

    _cleanup_semir_runtime_artifacts(runtime_files, package_root)
    _cleanup_runtime_artifact_dir(str(runtime_dir), preserve_paths=final_refs)

    return final_refs


def _rows_raw_to_table(rows_raw, header_row: int = 1):
    if not rows_raw:
        return {"headers": [], "rows": [], "total": 0}

    hi = header_row - 1
    if hi < 0 or hi >= len(rows_raw):
        return {"error": f"Header row index {hi} out of range", "headers": [], "rows": [], "total": 0}

    def _stringify_row(raw_row):
        return [str(c) if c is not None else '' for c in raw_row]

    def _dedupe_headers(raw_headers):
        used = {}
        headers = []
        for index, raw_header in enumerate(raw_headers):
            header = str(raw_header or '').strip() or f"列{index + 1}"
            if header not in used:
                used[header] = 1
                headers.append(header)
                continue
            used[header] += 1
            headers.append(f"{header}_{used[header]}")
        return headers

    def _build_headers():
        primary = _stringify_row(rows_raw[hi])
        if hi + 1 >= len(rows_raw):
            return _dedupe_headers(primary), hi + 1

        secondary = _stringify_row(rows_raw[hi + 1])
        width = max(len(primary), len(secondary))
        # Only collapse when row 2 is clearly filling blanks from row 1.
        # Trailing blank header cells in wide templates should not treat row 2 as another header row.
        has_grouped_children = any(
            not str(primary[index] if index < len(primary) else '').strip()
            and str(secondary[index] if index < len(secondary) else '').strip()
            for index in range(width)
        )
        if not has_grouped_children:
            return _dedupe_headers(primary), hi + 1

        merged_headers = []
        last_parent = ''
        for index in range(width):
            parent = str(primary[index] if index < len(primary) else '').strip()
            child = str(secondary[index] if index < len(secondary) else '').strip()
            if parent:
                last_parent = parent
            effective_parent = parent or (last_parent if child else '')
            if child and effective_parent and child != effective_parent:
                merged_headers.append(f"{effective_parent}/{child}")
            else:
                merged_headers.append(effective_parent or child or f"列{index + 1}")

        return _dedupe_headers(merged_headers), hi + 2

    headers, data_start_index = _build_headers()
    rows = []
    for raw in rows_raw[data_start_index:]:
        if all(c is None or str(c).strip() == '' for c in raw):
            continue
        row = {}
        for i, h in enumerate(headers):
            v = raw[i] if i < len(raw) else None
            row[h] = str(v) if v is not None else ''
        rows.append(row)

    return {"headers": headers, "rows": rows, "total": len(rows)}


def _read_local_excel(path: str, sheet: Optional[str] = None, header_row: int = 1):
    """Internal helper to read Excel/CSV without raising HTTPExceptions"""
    p = Path(path)
    if not p.exists():
        return {"error": f"File not found: {path}", "headers": [], "rows": [], "total": 0}

    suffix = p.suffix.lower()
    try:
        if suffix in ('.xlsx', '.xls', '.xlsm'):
            import openpyxl

            wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
            try:
                if sheet:
                    ws = wb[sheet]
                    table = _rows_raw_to_table(list(ws.iter_rows(values_only=True)), header_row)
                    table["sheet_name"] = ws.title
                    table["sheets"] = {
                        ws.title: {
                            "headers": table.get("headers", []),
                            "rows": table.get("rows", []),
                            "total": table.get("total", 0),
                        }
                    }
                    return table

                workbook_tables = {}
                for ws in wb.worksheets:
                    workbook_tables[ws.title] = _rows_raw_to_table(list(ws.iter_rows(values_only=True)), header_row)

                active_name = wb.active.title if wb.active else (wb.sheetnames[0] if wb.sheetnames else "Sheet1")
                active_table = workbook_tables.get(active_name) or {"headers": [], "rows": [], "total": 0}
                return {
                    "headers": active_table.get("headers", []),
                    "rows": active_table.get("rows", []),
                    "total": active_table.get("total", 0),
                    "sheet_name": active_name,
                    "sheets": workbook_tables,
                }
            finally:
                wb.close()

        if suffix == '.csv':
            import csv

            with open(p, newline='', encoding='utf-8-sig') as f:
                rows_raw = list(csv.reader(f))
            table = _rows_raw_to_table(rows_raw, header_row)
            table["sheet_name"] = "Sheet1"
            table["sheets"] = {
                "Sheet1": {
                    "headers": table.get("headers", []),
                    "rows": table.get("rows", []),
                    "total": table.get("total", 0),
                }
            }
            return table

        return {"error": f"Unsupported format: {suffix}", "headers": [], "rows": [], "total": 0}
    except Exception as e:
        return {"error": str(e), "headers": [], "rows": [], "total": 0}


def _template_search_roots(adapter_id: str) -> List[Path]:
    roots: List[Path] = []

    adapter_dir = adapter_loader.get_adapter_dir(adapter_id)
    if adapter_dir:
        roots.append(adapter_dir.resolve())

    built_in_dir = (Path(__file__).parent.parent / "adapters" / adapter_id).resolve()
    if built_in_dir.exists():
        roots.append(built_in_dir)

    seen = set()
    deduped = []
    for root in roots:
        marker = str(root)
        if marker in seen:
            continue
        seen.add(marker)
        deduped.append(root)
    return deduped


def _resolve_template_path(adapter_id: str, template_file: Optional[str]) -> Optional[str]:
    if not template_file:
        return None

    for base_dir in _template_search_roots(adapter_id):
        try:
            candidate = (base_dir / template_file).resolve()
            candidate.relative_to(base_dir)
        except Exception:
            continue

        if candidate.exists() and candidate.is_file():
            return str(candidate)

    return None


def _serialize_task_param(adapter_id: str, param) -> dict:
    data = param.model_dump()
    templates = []
    for template in data.get("templates") or []:
        t = dict(template)
        t["path"] = _resolve_template_path(adapter_id, t.get("file"))
        templates.append(t)

    if not templates and data.get("template_file"):
        templates.append({
            "file": data.get("template_file"),
            "label": data.get("template_label"),
            "description": None,
            "version": None,
            "path": _resolve_template_path(adapter_id, data.get("template_file")),
        })

    data["templates"] = templates
    data["template_path"] = next((t.get("path") for t in templates if t.get("path")), None)
    return data


async def _execute_task(adapter_id: str, task_id: str, params: Optional[dict] = None, runtime_options: Optional[dict] = None, run_control: Optional[dict] = None):
    """
    Core task execution pipeline:
    1. Find / create matching Chrome tab via CDP
    2. Optional auth check + login wait
    3. Inject + execute JS script
    4. Persist results (Excel/JSON)
    5. Send notifications if configured
    6. Record run state in SQLite
    """
    from core.js_runner import JSRunner, RunAbortedError
    from core.models import OutputType

    jid = f"{adapter_id}::{task_id}"
    # 保留历史日志，新一轮运行用分隔线追加（不覆盖）
    from datetime import datetime as _dt
    _sep = f"─── 新运行 {_dt.now().strftime('%m-%d %H:%M:%S')} ───────────────────────"
    if jid not in _run_logs:
        _run_logs[jid] = []
    else:
        _run_logs[jid].append('')
        _run_logs[jid].append(_sep)
    _run_status[jid] = {'status': 'running', 'run_id': None, 'records': 0}

    def log(msg: str):
        logger.info(msg)
        _run_logs[jid].append(msg)

    def build_progress(payload: Optional[dict] = None) -> dict:
        return _build_live_progress(payload, run_control=run_control)

    async def wait_for_control(payload: Optional[dict] = None):
        if not run_control:
            return

        payload = dict(payload or {})
        kind = str(payload.get('kind') or '').strip()

        if kind == 'before_download_urls':
            download_total = int(payload.get('download_item_total') or 0)
            run_control['download_total'] = download_total
            run_control['download_completed'] = int(payload.get('download_completed') or 0)
            run_control['download_success'] = int(payload.get('download_success') or 0)
            run_control['download_failed'] = int(payload.get('download_failed') or 0)
            run_control['download_concurrency'] = int(payload.get('download_concurrency') or 0)
            run_control['download_retry_attempts'] = int(payload.get('download_retry_attempts') or 0)
            run_control['download_started'] = download_total > 0
            run_control['download_active'] = download_total > 0
            run_control['download_last_label'] = ''
            run_control['download_current_label'] = ''
            run_control['download_active_labels'] = []
            run_control['download_active_count'] = 0
            run_control['download_speed_bps'] = 0
            run_control['download_bytes_completed'] = int(payload.get('download_bytes_completed') or 0)
            run_control['download_total_bytes'] = int(payload.get('download_total_bytes') or 0)
        elif kind == 'download_urls_progress':
            if 'download_total' in payload:
                run_control['download_total'] = int(payload.get('download_total') or 0)
            if 'download_completed' in payload:
                run_control['download_completed'] = int(payload.get('download_completed') or 0)
            if 'download_success' in payload:
                run_control['download_success'] = int(payload.get('download_success') or 0)
            if 'download_failed' in payload:
                run_control['download_failed'] = int(payload.get('download_failed') or 0)
            if 'download_active' in payload:
                run_control['download_active'] = bool(payload.get('download_active'))
            if 'download_last_label' in payload:
                run_control['download_last_label'] = str(payload.get('download_last_label') or '').strip()
            if 'download_current_label' in payload:
                run_control['download_current_label'] = str(payload.get('download_current_label') or '').strip()
            if 'download_active_labels' in payload:
                labels = payload.get('download_active_labels') or []
                run_control['download_active_labels'] = [str(item or '').strip() for item in labels if str(item or '').strip()] if isinstance(labels, list) else []
            if 'download_active_count' in payload:
                run_control['download_active_count'] = int(payload.get('download_active_count') or 0)
            if 'download_speed_bps' in payload:
                run_control['download_speed_bps'] = int(payload.get('download_speed_bps') or 0)
            if 'download_bytes_completed' in payload:
                run_control['download_bytes_completed'] = int(payload.get('download_bytes_completed') or 0)
            if 'download_total_bytes' in payload:
                run_control['download_total_bytes'] = int(payload.get('download_total_bytes') or 0)
            run_control['download_started'] = bool(run_control.get('download_total') or run_control.get('download_completed'))
        elif kind == 'before_phase' and str(payload.get('phase') or '').strip() == 'finalize_all':
            download_total = int(run_control.get('download_total') or 0)
            if download_total > 0:
                run_control['download_completed'] = download_total
            run_control['download_active'] = False
            run_control['download_current_label'] = ''
            run_control['download_active_labels'] = []
            run_control['download_active_count'] = 0
            run_control['download_speed_bps'] = 0

        records = int(payload.get('records') or 0)
        progress = build_progress(payload)
        base_status = {
            'run_id': run_id,
            'records': records,
            'current': progress['current'],
            'total': progress['total'],
            'row_no': progress['row_no'],
            'batch_no': progress['batch_no'],
            'total_batches': progress['total_batches'],
            'search_total_codes': progress['search_total_codes'],
            'search_completed_codes': progress['search_completed_codes'],
            'generation_total_jobs': progress['generation_total_jobs'],
            'generation_completed_jobs': progress['generation_completed_jobs'],
            'buyer_id': progress['buyer_id'],
            'store': progress['store'],
            'current_source_filename': progress['current_source_filename'],
            'phase': progress['phase'],
            'completed': progress['completed'],
            'percent': progress['percent'],
            'progress_text': progress['progress_text'],
            'download_total': progress['download_total'],
            'download_completed': progress['download_completed'],
            'download_success': progress['download_success'],
            'download_failed': progress['download_failed'],
            'download_concurrency': progress['download_concurrency'],
            'download_retry_attempts': progress['download_retry_attempts'],
            'download_started': progress['download_started'],
            'download_active': progress['download_active'],
            'download_last_label': progress['download_last_label'],
            'download_current_label': progress['download_current_label'],
            'download_active_labels': progress['download_active_labels'],
            'download_active_count': progress['download_active_count'],
            'download_speed_bps': progress['download_speed_bps'],
            'download_bytes_completed': progress['download_bytes_completed'],
            'download_total_bytes': progress['download_total_bytes'],
            'list_total_rows': progress['list_total_rows'],
            'list_completed_rows': progress['list_completed_rows'],
            'list_total_batches': progress['list_total_batches'],
            'list_completed_batches': progress['list_completed_batches'],
            'detail_total_targets': progress['detail_total_targets'],
            'detail_completed_targets': progress['detail_completed_targets'],
            'detail_current_target_index': progress['detail_current_target_index'],
            'detail_current_target': progress['detail_current_target'],
            'detail_dimension_total': progress['detail_dimension_total'],
            'detail_dimension_index': progress['detail_dimension_index'],
            'detail_dimension_label': progress['detail_dimension_label'],
            'detail_current_page': progress['detail_current_page'],
            'detail_total_pages': progress['detail_total_pages'],
            'detail_total_rows': progress['detail_total_rows'],
            'detail_request_count': progress['detail_request_count'],
            'detail_records_collected': progress['detail_records_collected'],
            'doudian_stage': progress['doudian_stage'],
            'doudian_activity_total': progress['doudian_activity_total'],
            'doudian_activity_completed': progress['doudian_activity_completed'],
            'doudian_current_activity': progress['doudian_current_activity'],
            'doudian_current_product_total': progress['doudian_current_product_total'],
            'doudian_current_product_completed': progress['doudian_current_product_completed'],
            'doudian_detail_rows': progress['doudian_detail_rows'],
            'doudian_signup_total': progress['doudian_signup_total'],
            'doudian_signup_completed': progress['doudian_signup_completed'],
            'doudian_order_window_total': progress['doudian_order_window_total'],
            'doudian_order_window_completed': progress['doudian_order_window_completed'],
            'doudian_mixed_rows': progress['doudian_mixed_rows'],
        }

        # 通用批处理进度：只要行号前进，就打印一次，不绑定具体 adapter / phase。
        if (
            payload.get('kind') == 'before_phase' and
            progress['current'] > 0 and
            progress['total'] > 0 and
            progress['current'] != int(run_control.get('last_progress_exec_no') or 0)
        ):
            extra_parts = []
            if progress['batch_no'] > 0 and progress['total_batches'] > 0:
                extra_parts.append(f"批次 {progress['batch_no']}/{progress['total_batches']}")
            if progress['row_no'] > 0:
                extra_parts.append(f"源表行 {progress['row_no']}")
            if progress['buyer_id']:
                extra_parts.append(f"目标 {progress['buyer_id']}")
            suffix = f" · {' · '.join(extra_parts)}" if extra_parts else ""
            log(f"[progress] 第 {progress['current']}/{progress['total']} 条 · 已完成 {records} 条{suffix}")
            run_control['last_progress_exec_no'] = progress['current']

        if (
            payload.get('kind') == 'before_download_urls' and
            progress['current'] > 0 and
            progress['total'] > 0
        ):
            download_total = int(payload.get('download_item_total') or 0)
            download_batch_total = int(payload.get('download_batch_total') or 0)
            concurrency = int(payload.get('download_concurrency') or 0)
            retry_attempts = int(payload.get('download_retry_attempts') or 0)
            marker = f"{progress['current']}::{download_total}::{download_batch_total}::{concurrency}::{retry_attempts}"
            if marker != str(run_control.get('last_download_marker') or ''):
                target_text = f" · 目标 {progress['buyer_id']}" if progress['buyer_id'] else ""
                count_text = (
                    f" · 本批 {download_batch_total} 个文件 · 累计 {download_total} 个文件"
                    if download_batch_total > 0 and download_total > download_batch_total
                    else (f" · {download_total} 个文件" if download_total > 0 else "")
                )
                concurrency_text = f" · 并发 {concurrency}" if concurrency > 0 else ""
                retry_text = f" · 重试 {retry_attempts} 次" if retry_attempts > 1 else ""
                log(f"[download] 第 {progress['current']}/{progress['total']} 条{target_text}{count_text}{concurrency_text}{retry_text}，开始下载")
                run_control['last_download_marker'] = marker

        if run_control.get('stop_requested'):
            raise RunAbortedError(str(run_control.get('stop_reason') or '任务已停止'))

        if run_control.get('pause_requested'):
            _run_status[jid] = {'status': 'paused', **base_status}
            if not run_control.get('pause_logged'):
                log("[control] 任务已暂停，等待继续…")
                run_control['pause_logged'] = True
            while run_control.get('pause_requested'):
                if run_control.get('stop_requested'):
                    raise RunAbortedError(str(run_control.get('stop_reason') or '任务已停止'))
                try:
                    await asyncio.wait_for(run_control['resume_event'].wait(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
            if run_control.get('pause_logged'):
                log("[control] 任务已继续")
                run_control['pause_logged'] = False

        _run_status[jid] = {'status': 'running', **base_status}

    # 任务执行前重扫一次适配包，确保磁盘上的 manifest 改动立即生效
    adapter_loader.scan_all()
    m = adapter_loader.get_adapter(adapter_id)
    if not m:
        raise ValueError(f"Adapter not found: {adapter_id}")

    task = next((t for t in m.tasks if t.id == task_id), None)
    if not task:
        raise ValueError(f"Task not found: {task_id}")

    run_id = data_sink.begin_run(adapter_id, task_id)
    _run_status[jid]['run_id'] = run_id
    runner = None
    data = []
    output_files = []
    runtime_artifact_dir = data_sink.prepare_artifact_dir(adapter_id, task_id, run_id, "runtime")

    try:
        log(f"[{adapter_id}/{task_id}] Starting...")

        bridge = get_bridge()
        run_params = dict(params or {})
        per_item_review_urls = _resolve_tmall_buyer_review_item_urls(run_params) if (adapter_id, task_id) == ("tmall-ops-assistant", "buyer_reviews") else []
        runtime_options = runtime_options or {}
        task_param_ids = {p.id for p in task.params}
        for p in task.params:
            if p.id not in run_params and p.default is not None:
                run_params[p.id] = p.default

        mode = _resolve_task_open_mode(adapter_id, task_id, run_params, task_param_ids)
        current_tab_id = str(runtime_options.get('current_tab_id') or '').strip()
        shop_url = str(run_params.get('shop_url') or '').strip()
        configured_entry_url = shop_url or str(task.entry_url or m.entry_url or '').strip()
        target_entry_url = _resolve_task_target_entry_url(adapter_id, task_id, run_params, configured_entry_url)
        configured_match_prefixes = list(task.tab_match_prefixes or m.tab_match_prefixes or [])
        platform_name = m.name or adapter_id

        # 自动解析 file_excel 参数：如果传了 path 但没有 rows，就在后台读出来注入
        for pk, pv in run_params.items():
            if isinstance(pv, dict) and pv.get('path') and not pv.get('rows'):
                log(f"Resolving Excel rows for param '{pk}' from path: {pv['path']}")
                resolved = _read_local_excel(pv['path'])
                if "error" in resolved:
                    log(f"[warn] Failed to resolve Excel rows: {resolved['error']}")
                else:
                    pv['rows'] = resolved['rows']
                    pv['headers'] = resolved['headers']
                    if resolved.get('sheet_name') is not None:
                        pv['sheet_name'] = resolved['sheet_name']
                    if resolved.get('sheets') is not None:
                        pv['sheets'] = resolved['sheets']
                    log(f"Successfully resolved {len(pv['rows'])} rows.")

        is_shopee_marketing_adapter = target_entry_url.startswith('https://seller.shopee.cn/portal/marketing')

        tab = None
        if mode == 'current':
            all_tabs = [t for t in bridge.get_tabs() if t.get('type') == 'page']
            preferred_prefixes = configured_match_prefixes or [
                'https://seller.shopee.cn/portal/marketing',
                'https://seller.shopee.cn/portal/marketing/vouchers/list',
                'https://seller.shopee.cn/portal/marketing/vouchers/new',
                'https://seller.shopee.cn/portal/marketing/follow-prize/new',
            ] if is_shopee_marketing_adapter else configured_match_prefixes or [target_entry_url]
            if adapter_id == 'temu' and shop_url:
                preferred_prefixes = list(dict.fromkeys([
                    *preferred_prefixes,
                    'https://www.temu.com/bgn_verification.html',
                ]))

            if current_tab_id:
                tab = next((t for t in all_tabs if str(t.get('id')) == current_tab_id), None)
                if not tab:
                    raise RuntimeError("未找到当前页面对应的 Chrome 标签页。请重新聚焦目标业务页面后重试。")
                tab_url = str(tab.get('url', ''))
                if not any(_url_matches_prefix(tab_url, prefix) for prefix in preferred_prefixes) and not _is_compatible_current_tab_for_task(adapter_id, task_id, target_entry_url, tab_url):
                    raise RuntimeError(f"当前页面不是目标业务页：{tab_url[:120]}")
            else:
                candidate_tabs = [
                    t for t in all_tabs
                    if any(_url_matches_prefix(str(t.get('url', '')), prefix) for prefix in preferred_prefixes)
                    or _is_compatible_current_tab_for_task(adapter_id, task_id, target_entry_url, str(t.get('url', '')))
                ]
                if len(candidate_tabs) == 1:
                    tab = candidate_tabs[0]
                elif len(candidate_tabs) > 1:
                    raise RuntimeError(
                        "current 模式检测到多个目标页面，无法判断当前标签页。"
                        "请关闭多余相关标签页后重试，或改用“新页面开启（重新导航）”。"
                    )
                else:
                    raise RuntimeError(f"未找到已打开的目标页面：{target_entry_url}。请选择“新页面开启（重新导航）”或先手动打开并登录。")
        else:
            open_entry_url = _temu_new_tab_entry_url(target_entry_url) if adapter_id == 'temu' else target_entry_url
            if open_entry_url != target_entry_url:
                log(f"mode=new，Temu 使用后台入口新建页面：{open_entry_url}，稍后导航业务页：{target_entry_url}")
            else:
                log(f"mode=new，尝试新建页面：{target_entry_url}")
            if adapter_id == 'doudian-ops-assistant' and _is_doudian_backend_url(target_entry_url):
                opener_candidates = [
                    item for item in bridge.get_tabs()
                    if item.get('type') == 'page' and _is_doudian_opener_tab_url(str(item.get('url') or ''))
                ]
                opener_candidates.sort(key=lambda item: _doudian_opener_tab_sort_key(target_entry_url, str(item.get('url') or '')))
                opener_tab = opener_candidates[0] if opener_candidates else None
                if opener_tab:
                    log(f"抖店复用已登录后台页打开新标签：{str(opener_tab.get('url') or '')[:120]}")
                    opener_runner = JSRunner(
                        bridge.get_tab_ws_url(opener_tab),
                        tab_id=str(opener_tab.get('id') or ''),
                        tab_url=str(opener_tab.get('url') or ''),
                        artifact_dir=runtime_artifact_dir,
                    )
                    before_ids = {
                        str(item.get('id') or '')
                        for item in bridge.get_tabs()
                        if item.get('type') == 'page'
                    }
                    open_expr = (
                        "(() => {\n"
                        f"  const url = {json.dumps(open_entry_url, ensure_ascii=False)};\n"
                        "  const win = window.open(url, '_blank');\n"
                        "  return { success: !!win, data: [], meta: { has_more: false } };\n"
                        "})()\n"
                    )
                    open_result = await opener_runner.evaluate_user_gesture(open_expr)
                    if open_result.success:
                        await asyncio.sleep(1.5)
                        new_tabs = [
                            item for item in bridge.get_tabs()
                            if item.get('type') == 'page' and str(item.get('id') or '') not in before_ids
                        ]
                        tab = next((item for item in new_tabs if _is_doudian_fxg_url(str(item.get('url') or ''))), None)
                        if not tab and new_tabs:
                            tab = new_tabs[-1]
                    else:
                        log(f"抖店页面上下文打开新标签失败，回退 CDP 新建：{open_result.error or 'unknown'}")
            if adapter_id == 'temu' and _is_temu_backend_url(target_entry_url):
                opener_candidates = [
                    item for item in bridge.get_tabs()
                    if item.get('type') == 'page' and _is_temu_opener_tab_url(str(item.get('url') or ''))
                ]
                opener_candidates.sort(key=lambda item: _temu_opener_tab_sort_key(target_entry_url, str(item.get('url') or '')))
                opener_tab = opener_candidates[0] if opener_candidates else None
                if opener_tab:
                    log(f"Temu 复用已登录后台页打开新标签：{str(opener_tab.get('url') or '')[:120]}")
                    opener_runner = JSRunner(
                        bridge.get_tab_ws_url(opener_tab),
                        tab_id=str(opener_tab.get('id') or ''),
                        tab_url=str(opener_tab.get('url') or ''),
                        artifact_dir=runtime_artifact_dir,
                    )
                    before_ids = {
                        str(item.get('id') or '')
                        for item in bridge.get_tabs()
                        if item.get('type') == 'page'
                    }
                    open_expr = (
                        "(() => {\n"
                        f"  const url = {json.dumps(open_entry_url, ensure_ascii=False)};\n"
                        "  const win = window.open(url, '_blank');\n"
                        "  return { success: !!win, data: [], meta: { has_more: false } };\n"
                        "})()\n"
                    )
                    open_result = await opener_runner.evaluate_user_gesture(open_expr)
                    if open_result.success:
                        await asyncio.sleep(1.5)
                        new_tabs = [
                            item for item in bridge.get_tabs()
                            if item.get('type') == 'page' and str(item.get('id') or '') not in before_ids
                        ]
                        tab = next((item for item in new_tabs if _is_temu_opener_tab_url(str(item.get('url') or ''))), None)
                        if not tab and new_tabs:
                            tab = new_tabs[-1]
                    else:
                        log(f"Temu 页面上下文打开新标签失败，回退 CDP 新建：{open_result.error or 'unknown'}")
            if not tab:
                try:
                    tab = bridge.new_tab(open_entry_url)
                except Exception as e:
                    log(f"新建 tab 失败，尝试复用现有 tab: {e}")
                    tab = bridge.find_tab(open_entry_url) or bridge.find_tab(target_entry_url)
            if not tab:
                raise RuntimeError(f"无法打开或找到目标页面：{target_entry_url}")

        log(f"Found tab: {tab.get('url', '')[:120]}")
        runner = JSRunner(
            bridge.get_tab_ws_url(tab),
            tab_id=str(tab.get('id') or ''),
            tab_url=str(tab.get('url') or ''),
            artifact_dir=runtime_artifact_dir,
        )

        async def navigate_runner_to(url: str, wait_seconds: float = 2.0, via_page: bool = False):
            if via_page:
                expression = (
                    "(() => {\n"
                    f"  location.href = {json.dumps(str(url or ''), ensure_ascii=False)};\n"
                    "  return { success: true, data: [], meta: { has_more: false } };\n"
                    "})()\n"
                )
                nav_result = await runner.evaluate(expression)
                if nav_result.success and wait_seconds > 0:
                    await asyncio.sleep(wait_seconds)
                    try:
                        await runner._refresh_ws_url()
                    except Exception:
                        logger.debug("refresh ws url failed after page-context navigate", exc_info=True)
            else:
                nav_result = await runner.navigate(url, wait_seconds=wait_seconds)
            if nav_result.success:
                runner.tab_url = str(url or runner.tab_url or '')
            return nav_result

        async def recover_temu_no_auth(stage: str = "入口"):
            if adapter_id != 'temu':
                return
            current_tab = bridge.get_tab(str(tab.get('id') or runner.tab_id or '')) if (tab or runner.tab_id) else None
            current_url = str((current_tab or {}).get('url') or '')
            if not _is_temu_no_auth_url(current_url):
                return
            shell_url = _temu_new_tab_entry_url(target_entry_url)
            log(f"检测到 Temu 反爬/无授权页（{stage}）：{current_url}，改从后台入口恢复：{shell_url}")
            nav_result = await navigate_runner_to(shell_url, wait_seconds=3)
            if not nav_result.success:
                raise RuntimeError(nav_result.error or f"无法从 Temu no-auth 恢复到后台入口：{shell_url}")

        def merge_output_file_refs(*groups):
            merged = []
            seen = set()
            for group in groups:
                for item in group or []:
                    path = str(item or '').strip()
                    if not path or path in seen:
                        continue
                    seen.add(path)
                    merged.append(path)
            return merged

        async def export_outputs(data_rows):
            files = []
            filename_vars = await _build_export_filename_context(adapter_id, task_id, run_params, runner)
            for out in task.output:
                if out.type == OutputType.excel:
                    if not data_rows:
                        log("No data rows returned, skip Excel export")
                        continue
                    fname = out.filename or "{task_id}_{date}.xlsx"
                    path = await asyncio.to_thread(
                        data_sink.export_excel,
                        data_rows,
                        adapter_id,
                        task_id,
                        fname,
                        filename_vars=filename_vars,
                        column_order=getattr(out, 'columns', None),
                        column_groups=getattr(out, 'column_groups', None),
                        sheet_key=getattr(out, 'sheet_key', None),
                        sheet_configs=getattr(out, 'sheets', None),
                    )
                    files.append(path)
                    log(f"Excel exported: {path}")

                elif out.type == OutputType.json:
                    fname = out.filename or "{task_id}_{date}.json"
                    path = await asyncio.to_thread(
                        data_sink.export_json,
                        data_rows,
                        adapter_id,
                        task_id,
                        fname,
                        filename_vars=filename_vars,
                    )
                    files.append(path)
                    log(f"JSON exported: {path}")

                elif out.type == OutputType.notify:
                    if notifier.should_notify(out.condition, data_rows):
                        try:
                            notifier.send(
                                channel=out.channel or 'dingtalk',
                                title=f"{m.name} - {task.name}",
                                records=len(data_rows),
                                adapter_name=m.name,
                                task_name=task.name,
                                sample_rows=data_rows[:3] if data_rows else None,
                            )
                            log(f"Notification sent via {out.channel}")
                        except Exception as e:
                            log(f"Notification failed: {e}")
                    else:
                        log(f"Notification skipped (condition not met: {out.condition})")
            return files

        async def finalize_output_files(data_rows, runtime_files, exported_files):
            if adapter_id == 'amazon-ops-assistant' and task_id == 'amazon_label_batch_process':
                try:
                    generated_refs = list(run_params.get("__amazon_generated_refs") or [])
                    packaged_refs = await asyncio.to_thread(
                        copy_amazon_label_outputs_to_export_folder,
                        generated_refs=generated_refs,
                        exported_files=exported_files,
                        run_params=run_params,
                        log=log,
                    )
                    return merge_output_file_refs(packaged_refs)
                except Exception as package_error:
                    log(f"[warn] 亚马逊标签后处理输出失败，回退到原始输出: {package_error}")
                    return merge_output_file_refs(runtime_files, exported_files)

            if adapter_id == 'semir-cloud-drive':
                try:
                    packaged_refs = await asyncio.to_thread(
                        _finalize_semir_cloud_drive_outputs,
                        task_id=task_id,
                        data_rows=data_rows,
                        runtime_files=runtime_files,
                        exported_files=exported_files,
                        run_params=run_params,
                        runtime_artifact_dir=runtime_artifact_dir,
                        log=log,
                    )
                    return merge_output_file_refs(packaged_refs)
                except Exception as package_error:
                    log(f"[warn] semir 后处理失败，回退到原始输出: {package_error}")
                    return merge_output_file_refs(runtime_files, exported_files)

            if adapter_id == 'shenhui-new-arrival':
                try:
                    packaged_refs = await asyncio.to_thread(
                        _finalize_shenhui_new_arrival_outputs,
                        task_id=task_id,
                        data_rows=data_rows,
                        runtime_files=runtime_files,
                        exported_files=exported_files,
                        run_params=run_params,
                        runtime_artifact_dir=runtime_artifact_dir,
                        log=log,
                    )
                    return merge_output_file_refs(packaged_refs)
                except Exception as package_error:
                    log(f"[warn] 深绘图包后处理失败，回退到原始输出: {package_error}")
                    return merge_output_file_refs(runtime_files, exported_files)

            if adapter_id == 'tiktok-ops-assistant' and task_id == 'creator_video_download':
                try:
                    packaged_refs = await asyncio.to_thread(
                        _finalize_tiktok_creator_video_outputs,
                        data_rows=data_rows,
                        runtime_files=runtime_files,
                        exported_files=exported_files,
                        run_params=run_params,
                        runtime_artifact_dir=runtime_artifact_dir,
                        log=log,
                    )
                    return merge_output_file_refs(packaged_refs)
                except Exception as package_error:
                    log(f"[warn] TikTok 视频打包后处理失败，回退到原始输出: {package_error}")
                    return merge_output_file_refs(runtime_files, exported_files)

            return merge_output_file_refs(runtime_files, exported_files)

        # 可选登录检测：若 manifest 配置了 auth.check_script，则最多等 5 分钟
        if not task.skip_auth and m.auth and m.auth.check_script:
            try:
                auth_path = adapter_loader.resolve_adapter_file(adapter_id, m.auth.check_script)
            except FileNotFoundError:
                auth_path = None
            if auth_path:
                await recover_temu_no_auth("登录检测前")
                await wait_for_control()
                log(f"运行登录检测：{m.auth.check_script}")
                auth_result = await runner.evaluate(auth_path.read_text(encoding='utf-8'))
                logged_in = False
                if auth_result.success:
                    if isinstance(auth_result.meta, dict):
                        logged_in = bool(auth_result.meta.get('logged_in'))
                    if not logged_in and auth_result.data and isinstance(auth_result.data, list):
                        logged_in = bool((auth_result.data[0] or {}).get('logged_in'))

                if not logged_in:
                    login_url = (m.auth.login_url or target_entry_url)
                    if mode == 'new':
                        await wait_for_control()
                        log(f"检测到未登录，跳转登录页：{login_url}")
                        login_nav = await navigate_runner_to(login_url, wait_seconds=2)
                        if not login_nav.success:
                            raise RuntimeError(login_nav.error or f"无法跳转登录页：{login_url}")
                        await asyncio.sleep(2)
                    else:
                        log(f"检测到未登录，请在当前页面完成 {platform_name} 登录…")
                    wait_seconds = 300
                    for i in range(wait_seconds):
                        await wait_for_control({"records": 0})
                        auth_result = await runner.evaluate(auth_path.read_text(encoding='utf-8'))
                        ok = False
                        if auth_result.success:
                            if isinstance(auth_result.meta, dict):
                                ok = bool(auth_result.meta.get('logged_in'))
                            if not ok and auth_result.data and isinstance(auth_result.data, list):
                                ok = bool((auth_result.data[0] or {}).get('logged_in'))
                        if ok:
                            log("用户已完成登录，继续执行任务")
                            break
                        if i in (0, 4) or (i + 1) % 15 == 0:
                            log(f"等待用户登录 {platform_name}… {i + 1}/{wait_seconds}s")
                        await asyncio.sleep(1)
                    else:
                        raise RuntimeError(f"等待登录超时（5分钟）。请完成 {platform_name} 登录后重试。")

                if mode == 'new':
                    # 登录完成后，重新导航回业务入口页
                    await wait_for_control()
                    await recover_temu_no_auth("导航业务入口前")
                    log(f"导航回业务入口：{target_entry_url}")
                    entry_nav = await navigate_runner_to(
                        target_entry_url,
                        wait_seconds=3,
                        via_page=adapter_id == 'temu' and _is_temu_backend_url(target_entry_url),
                    )
                    if not entry_nav.success:
                        raise RuntimeError(entry_nav.error or f"无法导航回业务入口：{target_entry_url}")
                    await asyncio.sleep(3)
                    await recover_temu_no_auth("导航业务入口后")
        elif adapter_id == 'temu' and mode == 'new' and _is_temu_backend_url(target_entry_url):
            await recover_temu_no_auth("跳过登录检测后")
            log(f"导航回业务入口：{target_entry_url}")
            entry_nav = await navigate_runner_to(
                target_entry_url,
                wait_seconds=3,
                via_page=_is_temu_backend_url(target_entry_url),
            )
            if not entry_nav.success:
                raise RuntimeError(entry_nav.error or f"无法导航回业务入口：{target_entry_url}")
            await asyncio.sleep(3)
            await recover_temu_no_auth("导航业务入口后")

        script_path = adapter_loader.resolve_adapter_file(adapter_id, task.script)

        await wait_for_control({"records": 0})
        log(f"Injecting script: {task.script}")
        if (adapter_id, task_id) == ("tmall-ops-assistant", "buyer_reviews") and per_item_review_urls:
            aggregated_data = []
            total_item_count = len(per_item_review_urls)
            for item_index, item_url in enumerate(per_item_review_urls, start=1):
                item_params = dict(run_params)
                item_params["item_links"] = item_url
                item_params["__item_index__"] = item_index
                item_params["__item_total__"] = total_item_count
                log(f"抓取商品 {item_index}/{total_item_count}: {item_url}")
                item_nav = await runner.navigate(item_url, wait_seconds=2 if item_index == 1 else 1.5)
                if not item_nav.success:
                    raise RuntimeError(item_nav.error or f"无法导航到商品页：{item_url}")
                item_rows = await runner.run_script_file(script_path, params=item_params, control_hook=wait_for_control)
                aggregated_data.extend(item_rows)
            data = aggregated_data
        else:
            data = await runner.run_script_file(script_path, params=run_params, control_hook=wait_for_control)
        raw_count = len(data)
        data = _apply_final_export_guards(adapter_id, task_id, data)
        if adapter_id == 'tiktok-ops-assistant' and task_id == 'creator_video_download':
            data = _verify_tiktok_creator_video_download_rows(data, log=log)
        if adapter_id == 'amazon-ops-assistant' and task_id == 'amazon_label_batch_process':
            data, amazon_generated_refs = split_amazon_label_rows(
                data_rows=data,
                run_params=run_params,
                runtime_artifact_dir=runtime_artifact_dir,
                log=log,
            )
            run_params["__amazon_generated_refs"] = amazon_generated_refs
            raw_count = len(data)
        deduped_count = len(data)
        log(f"Script complete. Records: {raw_count}")
        if deduped_count != raw_count:
            log(f"Final export guard removed {raw_count - deduped_count} duplicate rows before export")

        runtime_files = list(getattr(runner, 'runtime_output_files', []) or [])
        exported_files = await export_outputs(data)
        output_files = await finalize_output_files(data, runtime_files, exported_files)
        data_sink.finish_run(run_id, len(data), output_files)
        _run_status[jid] = {'status': 'done', 'run_id': run_id, 'records': len(data)}
        log(f"[{adapter_id}/{task_id}] Done. {len(data)} records.")

    except RunAbortedError as e:
        err = e.reason or str(e)
        data = list(e.partial_data or data or [])
        raw_count = len(data)
        data = _apply_final_export_guards(adapter_id, task_id, data)
        if adapter_id == 'tiktok-ops-assistant' and task_id == 'creator_video_download':
            data = _verify_tiktok_creator_video_download_rows(data, log=log)
        deduped_count = len(data)
        if deduped_count != raw_count:
            log(f"Final export guard removed {raw_count - deduped_count} duplicate rows before partial export")
        if run_control:
            run_control['pause_requested'] = False
            run_control['stop_requested'] = False
            run_control['resume_event'].set()
            run_control['pause_logged'] = False

        try:
            runtime_files = list(getattr(runner, 'runtime_output_files', []) or []) if runner else []
            exported = await export_outputs(data) if runner else []
            output_files = await finalize_output_files(data, runtime_files, exported) if runner else []
        except Exception as export_error:
            output_files = []
            log(f"[warn] 停止任务时导出部分结果失败: {export_error}")

        data_sink.stop_run(run_id, len(data), output_files, err)
        _run_status[jid] = {'status': 'stopped', 'run_id': run_id, 'records': len(data), 'error': err}
        log(f"[{adapter_id}/{task_id}] Stopped. {len(data)} records.")

    except asyncio.CancelledError:
        err = "任务已停止"
        if run_control:
            run_control['pause_requested'] = False
            run_control['stop_requested'] = False
            run_control['resume_event'].set()
            run_control['pause_logged'] = False
        raw_count = len(data)
        data = _apply_final_export_guards(adapter_id, task_id, data)
        if adapter_id == 'tiktok-ops-assistant' and task_id == 'creator_video_download':
            data = _verify_tiktok_creator_video_download_rows(data, log=log)
        deduped_count = len(data)
        if deduped_count != raw_count:
            log(f"Final export guard removed {raw_count - deduped_count} duplicate rows before partial export")
        try:
            runtime_files = list(getattr(runner, 'runtime_output_files', []) or []) if runner else []
            exported = await export_outputs(data) if runner else []
            output_files = await finalize_output_files(data, runtime_files, exported) if runner else []
        except Exception as export_error:
            output_files = []
            log(f"[warn] 停止任务时导出部分结果失败: {export_error}")
        data_sink.stop_run(run_id, len(data), output_files, err)
        _run_status[jid] = {'status': 'stopped', 'run_id': run_id, 'records': len(data), 'error': err}
        log(f"[{adapter_id}/{task_id}] Stopped. {len(data)} records.")

    except Exception as e:
        err = str(e)
        log(f"[{adapter_id}/{task_id}] ERROR: {err}")
        data_sink.fail_run(run_id, err)
        _run_status[jid] = {'status': 'error', 'run_id': run_id, 'records': 0, 'error': err}
        raise
    finally:
        if run_control is not None:
            run_control['task'] = None
            run_control['pause_requested'] = False
            run_control['stop_requested'] = False
            run_control['resume_event'].set()
            run_control['pause_logged'] = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    instance_lock = _acquire_backend_instance_lock()
    if _api_auth_required():
        _get_api_token()
    # Init DB
    data_sink.init_db()
    owns_backend_instance = bool(instance_lock.acquired)
    app.state.owns_backend_instance = owns_backend_instance
    if not owns_backend_instance:
        logger.warning("Another crawshrimp backend instance is already active; skip startup side effects in this process")

    if owns_backend_instance:
        orphaned_active_runs = data_sink.list_active_runs(ACTIVE_LIVE_STATUSES)
        orphaned_runs = data_sink.stop_orphaned_active_runs()
        if orphaned_active_runs:
            _cleanup_orphaned_runtime_artifacts(orphaned_active_runs)
        if orphaned_runs:
            logger.warning("Marked %s orphaned active task run(s) as stopped after backend startup", orphaned_runs)

    # Install built-in adapters
    if owns_backend_instance:
        built_in = Path(__file__).parent.parent / "adapters"
        if built_in.exists():
            for d in adapter_loader.iter_manifest_dirs(built_in):
                try:
                    adapter_loader.install_from_dir(str(d), install_mode="copy", preserve_existing_link=True)
                except Exception as e:
                    logger.warning(f"Built-in adapter failed {d.name}: {e}")

        adapter_loader.scan_all()
        try:
            ensure_knowledge_index()
        except Exception:
            logger.exception("knowledge index initialization failed; continuing without prebuilt index")

    # Register scheduled tasks
    if owns_backend_instance:
        try:
            for item in adapter_loader.list_all():
                if item['enabled']:
                    m = adapter_loader.get_adapter(item['id'])
                    if m:
                        sched_module.register_adapter(m, _run_scheduled_task)

            sched_module.start()
        except Exception:
            logger.exception("scheduler startup failed; continuing without scheduled jobs")
    logger.info("crawshrimp core started")
    try:
        yield
    finally:
        try:
            if owns_backend_instance:
                sched_module.shutdown()
        except Exception:
            logger.exception("scheduler shutdown failed")
        app.state.owns_backend_instance = False
        instance_lock.close()


app = FastAPI(title="crawshrimp", version=API_VERSION, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_cors_origins(),
    allow_methods=["*"],
    allow_headers=["Content-Type", "X-Crawshrimp-Token"],
)


@app.middleware("http")
async def require_local_api_token(request: Request, call_next):
    if request.method == "OPTIONS" or request.url.path in PUBLIC_API_PATHS:
        return await call_next(request)

    expected = _get_api_token()
    if not expected:
        if _api_auth_required():
            return JSONResponse(
                {"detail": "CRAWSHRIMP_API_TOKEN is required before using crawshrimp API"},
                status_code=503,
            )
        return await call_next(request)

    supplied = str(request.headers.get(API_TOKEN_HEADER) or "").strip()
    if not supplied or not hmac.compare_digest(supplied, expected):
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)

    return await call_next(request)


# ─── Health ───

@app.get("/health")
def health():
    warnings = []
    try:
        chrome_ok = CDPBridge().is_available(timeout=0.2)
    except Exception as e:
        logger.debug("health chrome probe failed", exc_info=True)
        warnings.append(str(e))
        chrome_ok = False

    try:
        adapters_count = len(adapter_loader.list_all())
    except Exception as e:
        logger.debug("health adapter status failed", exc_info=True)
        warnings.append(str(e))
        adapters_count = 0

    try:
        scheduled_jobs_count = len(sched_module.list_jobs())
    except Exception as e:
        logger.debug("health scheduler status failed", exc_info=True)
        warnings.append(str(e))
        scheduled_jobs_count = 0

    return {
        "status": "ok",
        "chrome": chrome_ok,
        "adapters": adapters_count,
        "scheduled_jobs": scheduled_jobs_count,
        "warnings": warnings,
        "runtime": _backend_runtime_info(),
    }


# ─── Adapters ───

@app.get("/adapters")
def list_adapters():
    return adapter_loader.list_all()


class InstallRequest(BaseModel):
    path: Optional[str] = None
    zip_base64: Optional[str] = None
    install_mode: Optional[str] = None


@app.post("/adapters/install")
def install_adapter(req: InstallRequest):
    try:
        if req.path:
            m = adapter_loader.install_from_dir(req.path, install_mode=str(req.install_mode or "copy"))
        elif req.zip_base64:
            raw = base64.b64decode(req.zip_base64)
            with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as f:
                f.write(raw)
                tmp = f.name
            try:
                m = adapter_loader.install_from_zip(tmp, install_mode=str(req.install_mode or "copy"))
            finally:
                os.unlink(tmp)
        else:
            raise HTTPException(400, "Provide 'path' or 'zip_base64'")

        # Register scheduler jobs for newly installed adapter
        sched_module.register_adapter(m, _run_scheduled_task)
        adapter_meta = adapter_loader.get_install_metadata(m.id)
        return {
            "ok": True,
            "adapter": {
                "id": m.id,
                "name": m.name,
                "version": m.version,
                "install_mode": adapter_meta.get("install_mode", "copy"),
                "source_path": adapter_meta.get("source_path", ""),
                "runtime_path": adapter_meta.get("runtime_path", ""),
            }
        }
    except Exception as e:
        raise HTTPException(400, str(e))


@app.delete("/adapters/{adapter_id}")
def uninstall_adapter(adapter_id: str):
    if not adapter_loader.get_adapter(adapter_id):
        raise HTTPException(404, f"Adapter not found: {adapter_id}")
    sched_module.unregister_adapter(adapter_id)
    adapter_loader.uninstall(adapter_id)
    return {"ok": True}


class EnableRequest(BaseModel):
    enabled: bool


@app.patch("/adapters/{adapter_id}/enable")
def enable_adapter(adapter_id: str, req: EnableRequest):
    m = adapter_loader.get_adapter(adapter_id)
    if not m:
        raise HTTPException(404, f"Adapter not found: {adapter_id}")
    adapter_loader.set_enabled(adapter_id, req.enabled)
    if req.enabled:
        sched_module.register_adapter(m, _run_scheduled_task)
    else:
        sched_module.unregister_adapter(adapter_id)
    return {"ok": True, "enabled": req.enabled}


# ─── Tasks ───

@app.get("/tasks")
def list_tasks():
    adapter_loader.scan_all()
    result = []
    scheduled = {j['job_id']: j for j in sched_module.list_jobs()}
    for item in adapter_loader.list_all():
        m = adapter_loader.get_adapter(item['id'])
        if not m:
            continue
        for task in m.tasks:
            jid = f"{m.id}::{task.id}"
            last_run = data_sink.get_latest_run(m.id, task.id)
            result.append({
                "adapter_id": m.id,
                "adapter_name": m.name,
                "adapter_version": m.version,
                "task_id": task.id,
                "task_name": task.name,
                "description": task.description,
                "param_probe_script": task.param_probe_script,
                "execution_ui_mode": task.execution_ui_mode,
                "validation_only_label": task.validation_only_label,
                "auto_precheck_note": task.auto_precheck_note,
                "params": [_serialize_task_param(m.id, p) for p in task.params],
                "trigger": task.trigger.model_dump(),
                "enabled": item['enabled'],
                "next_run": scheduled.get(jid, {}).get('next_run'),
                "last_run": last_run,
                "live": _run_status.get(jid),
            })
    return result


class RunTaskRequest(BaseModel):
    params: Optional[dict] = None
    current_tab_id: Optional[str] = None


class ProbeTaskParamsRequest(BaseModel):
    params: Optional[dict] = None
    current_tab_id: Optional[str] = None


@app.post("/probe/run")
async def run_probe(req: ProbeRequest):
    try:
        result = await run_probe_request(req)
        try:
            rebuild_knowledge_index()
        except Exception as knowledge_error:
            logger.warning("probe 完成后重建知识索引失败: %s", knowledge_error)
        return result.model_dump()
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))


@app.get("/probe/{probe_id}")
def get_probe(probe_id: str):
    try:
        result = read_probe_bundle(probe_id)
        return result.model_dump()
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))


@app.get("/probe/{probe_id}/bundle")
def get_probe_bundle(probe_id: str):
    try:
        result = read_probe_bundle_full(probe_id)
        return result.model_dump()
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))


@app.post("/knowledge/rebuild")
def rebuild_knowledge():
    try:
        return rebuild_knowledge_index()
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))


@app.get("/knowledge/search")
def get_knowledge(
    q: str = "",
    adapter_id: str = "",
    task_id: str = "",
    url: str = "",
    limit: int = 8,
):
    try:
        return search_knowledge(q, adapter_id=adapter_id, task_id=task_id, url=url, limit=limit)
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))


@app.post("/dev-harness/snapshot")
async def dev_harness_snapshot(req: DevHarnessSnapshotRequest):
    try:
        return await run_harness_snapshot(req)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))


@app.post("/dev-harness/eval")
async def dev_harness_eval(req: DevHarnessEvalRequest):
    try:
        return await run_harness_eval(req)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))


@app.post("/dev-harness/capture")
async def dev_harness_capture(req: DevHarnessCaptureRequest):
    try:
        return await run_harness_capture(req)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))


@app.post("/tasks/{adapter_id}/{task_id}/params/probe")
async def probe_task_params(adapter_id: str, task_id: str, req: ProbeTaskParamsRequest):
    adapter_loader.scan_all()
    adapter = adapter_loader.get_adapter(adapter_id)
    if not adapter:
        raise HTTPException(404, f"Adapter not found: {adapter_id}")

    task = next((item for item in adapter.tasks if item.id == task_id), None)
    if not task:
        raise HTTPException(404, f"Task not found: {task_id}")

    probe_script = str(task.param_probe_script or "").strip()
    if not probe_script:
        raise HTTPException(404, f"Task does not declare param_probe_script: {adapter_id}/{task_id}")

    try:
        script_path = adapter_loader.resolve_adapter_file(adapter_id, probe_script)
    except FileNotFoundError:
        raise HTTPException(404, f"Param probe script not found: {probe_script}")
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    run_params = dict(req.params or {})
    current_tab_id = str(req.current_tab_id or "").strip()

    try:
        session = await open_browser_session(
            adapter_id,
            task_id,
            mode=str(run_params.get("mode") or "current").strip().lower() or "current",
            current_tab_id=current_tab_id,
        )
        prelude = (
            f"window.__CRAWSHRIMP_PARAMS__ = {json.dumps(run_params, ensure_ascii=False)};\n"
            f"window.__CRAWSHRIMP_PARAM_PROBE__ = true;\n"
        )
        result = await session.runner.evaluate_with_reconnect(
            prelude + script_path.read_text(encoding="utf-8"),
            allow_navigation_retry=True,
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(500, str(exc))

    if not result.success:
        raise HTTPException(400, result.error or "task param probe failed")

    return {
        "ok": True,
        "patches": result.data if isinstance(result.data, list) else [],
        "meta": result.meta or {},
    }


async def _run_scheduled_task(adapter_id: str, task_id: str):
    jid = f"{adapter_id}::{task_id}"
    if _task_is_active(jid):
        logger.warning("Skip scheduled task %s because a run is already active", jid)
        return

    lock = _task_lock(jid)
    async with lock:
        if _task_has_live_control(jid):
            logger.warning("Skip scheduled task %s because a manual run is already active", jid)
            return
        await _execute_task(adapter_id, task_id, {}, {}, run_control=None)


async def _run_task_background(adapter_id: str, task_id: str, params: dict, runtime_options: dict, run_control: Optional[dict]):
    jid = f"{adapter_id}::{task_id}"
    lock = _task_lock(jid)
    try:
        async with lock:
            await _execute_task(adapter_id, task_id, params, runtime_options, run_control=run_control)
    except Exception as exc:
        live = dict(_run_status.get(jid) or {})
        if live.get('status') in ACTIVE_LIVE_STATUSES or not live:
            _run_status[jid] = {
                'status': 'error',
                'run_id': live.get('run_id'),
                'records': int(live.get('records') or 0),
                'error': str(exc),
            }
        _run_logs.setdefault(jid, []).append(f"[{adapter_id}/{task_id}] FATAL: {exc}")
        logger.exception("Background task crashed before cleanup: %s", jid)
    finally:
        _run_controls.pop(jid, None)


@app.post("/tasks/{adapter_id}/{task_id}/run")
async def run_task(adapter_id: str, task_id: str, req: RunTaskRequest = RunTaskRequest()):
    adapter_loader.scan_all()
    m = adapter_loader.get_adapter(adapter_id)
    if not m:
        raise HTTPException(404, f"Adapter not found: {adapter_id}")
    if not any(t.id == task_id for t in m.tasks):
        raise HTTPException(404, f"Task not found: {task_id}")

    jid = f"{adapter_id}::{task_id}"
    if _task_is_active(jid):
        raise HTTPException(409, "任务正在运行中，请先暂停/继续/停止当前任务")

    run_control = _build_run_control()
    task_handle = asyncio.create_task(
        _run_task_background(
            adapter_id,
            task_id,
            req.params or {},
            {"current_tab_id": req.current_tab_id},
            run_control,
        )
    )
    run_control['task'] = task_handle
    _run_controls[jid] = run_control
    return {"ok": True, "message": "Task started in background"}


@app.post("/tasks/{adapter_id}/{task_id}/pause")
async def pause_task(adapter_id: str, task_id: str):
    jid = f"{adapter_id}::{task_id}"
    control = _run_controls.get(jid)
    live = _run_status.get(jid) or {}
    task = control.get('task') if control else None
    if not control or not task or task.done() or live.get('status') not in ACTIVE_LIVE_STATUSES:
        raise HTTPException(409, "任务当前未在运行，无法暂停")
    if live.get('status') in {'paused', 'pausing'}:
        return {"ok": True, "status": live.get('status')}

    control['pause_requested'] = True
    control['resume_event'].clear()
    _run_status[jid] = {**live, 'status': 'pausing'}
    _run_logs.setdefault(jid, []).append('[control] 收到暂停指令')
    return {"ok": True, "status": "pausing"}


@app.post("/tasks/{adapter_id}/{task_id}/resume")
async def resume_task(adapter_id: str, task_id: str):
    jid = f"{adapter_id}::{task_id}"
    control = _run_controls.get(jid)
    live = _run_status.get(jid) or {}
    task = control.get('task') if control else None
    if not control or not task or task.done() or live.get('status') not in {'paused', 'pausing'}:
        raise HTTPException(409, "任务当前未暂停，无法继续")

    control['pause_requested'] = False
    control['resume_event'].set()
    control['pause_logged'] = False
    _run_status[jid] = {**live, 'status': 'running'}
    _run_logs.setdefault(jid, []).append('[control] 收到继续指令')
    return {"ok": True, "status": "running"}


@app.post("/tasks/{adapter_id}/{task_id}/stop")
async def stop_task(adapter_id: str, task_id: str):
    jid = f"{adapter_id}::{task_id}"
    control = _run_controls.get(jid)
    live = _run_status.get(jid) or {}
    task = control.get('task') if control else None
    if not control or not task or task.done() or live.get('status') not in ACTIVE_LIVE_STATUSES:
        raise HTTPException(409, "任务当前未在运行，无法停止")

    control['stop_requested'] = True
    control['pause_requested'] = False
    control['resume_event'].set()
    _run_status[jid] = {**live, 'status': 'stopping'}
    _run_logs.setdefault(jid, []).append('[control] 收到停止指令')
    task.cancel()
    return {"ok": True, "status": "stopping"}


@app.get("/tasks/{adapter_id}/{task_id}/status")
def task_status(adapter_id: str, task_id: str):
    jid = f"{adapter_id}::{task_id}"
    live = _run_status.get(jid)
    last = data_sink.get_latest_run(adapter_id, task_id)
    return {"live": live, "last_run": last}


@app.get("/tasks/{adapter_id}/{task_id}/logs")
def task_logs(adapter_id: str, task_id: str):
    jid = f"{adapter_id}::{task_id}"
    return {"logs": _run_logs.get(jid, [])}


@app.delete("/tasks/{adapter_id}/{task_id}/logs")
def clear_task_logs(adapter_id: str, task_id: str):
    jid = f"{adapter_id}::{task_id}"
    _run_logs[jid] = []
    return {"ok": True}


# ─── Data ───

@app.get("/data/{adapter_id}/{task_id}")
def get_data(adapter_id: str, task_id: str, limit: int = 20):
    runs = data_sink.list_runs(adapter_id, task_id, limit=limit)
    return {"runs": runs}


@app.get("/data/{adapter_id}/{task_id}/export")
def export_data(adapter_id: str, task_id: str, format: str = "excel"):
    last = data_sink.get_latest_run(adapter_id, task_id)
    if not last or not last.get('output_files'):
        raise HTTPException(404, "No exported data found. Run the task first.")
    import json as _json
    files = _json.loads(last['output_files']) if isinstance(last['output_files'], str) else last['output_files']
    for f in files:
        if format == 'excel' and f.endswith('.xlsx'):
            return FileResponse(f, filename=Path(f).name)
        if format == 'json' and f.endswith('.json'):
            return FileResponse(f, filename=Path(f).name)
    raise HTTPException(404, f"No {format} export found")



# ─── File utilities ───

class ReadExcelRequest(BaseModel):
    path: str
    sheet: Optional[str] = None   # 不传则读第一个 sheet
    header_row: int = 1           # 第几行作为表头（1-indexed）


class DeleteFilesRequest(BaseModel):
    paths: List[str]


class SyncDataFilesRequest(BaseModel):
    adapter_id: str
    task_id: str
    paths: List[str]
    endpoint: Optional[str] = None
    app_code: Optional[str] = None




@app.post("/files/read-excel")
def read_excel(req: ReadExcelRequest):
    """读取本地 Excel / CSV 文件，返回 headers + rows 数组，供 JS 脚本批量处理"""
    res = _read_local_excel(req.path, req.sheet, req.header_row)
    if "error" in res:
        raise HTTPException(400, res["error"])
    return res


@app.post("/files/delete")
def delete_files(req: DeleteFilesRequest):
    raw_paths = [str(path).strip() for path in (req.paths or []) if str(path).strip()]
    if not raw_paths:
        return {"ok": False, "error": "No file paths provided"}

    seen = set()
    normalized_paths = []
    for raw in raw_paths:
        try:
            normalized = str(Path(raw).expanduser().resolve(strict=False))
        except Exception:
            normalized = raw
        if normalized in seen:
            continue
        seen.add(normalized)
        normalized_paths.append(normalized)

    deleted_paths = []
    missing_paths = []
    failed_paths = []

    for item in normalized_paths:
        path = Path(item)
        try:
            if not path.exists():
                missing_paths.append(item)
                continue
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
            deleted_paths.append(item)
        except Exception as e:
            failed_paths.append({"path": item, "error": str(e)})

    prune_targets = deleted_paths + missing_paths
    prune_result = data_sink.remove_output_files(prune_targets) if prune_targets else {"updated_runs": 0, "removed_refs": 0}

    return {
        "ok": bool(deleted_paths or missing_paths),
        "deleted_count": len(deleted_paths),
        "missing_count": len(missing_paths),
        "failed_count": len(failed_paths),
        "deleted_paths": deleted_paths,
        "missing_paths": missing_paths,
        "failed": failed_paths,
        "updated_runs": prune_result.get("updated_runs", 0),
        "removed_refs": prune_result.get("removed_refs", 0),
    }


@app.post("/data-sync/odps")
def sync_data_files_to_odps(req: SyncDataFilesRequest):
    cfg = load_config()
    odps_cfg = cfg.get("odps") if isinstance(cfg.get("odps"), dict) else {}
    endpoint = str(
        req.endpoint
        or os.environ.get("CRAWSHRIMP_ODPS_ENDPOINT")
        or odps_sync.DEFAULT_DATAWORKS_ENDPOINT
    ).strip()
    app_code = str(
        req.app_code
        or odps_cfg.get("app_code")
        or cfg.get("odps.app_code")
        or os.environ.get("CRAWSHRIMP_ODPS_APP_CODE")
        or ""
    ).strip()
    try:
        return odps_sync.sync_files(
            adapter_id=req.adapter_id,
            task_id=req.task_id,
            file_paths=req.paths,
            endpoint=endpoint,
            app_code=app_code,
        )
    except odps_sync.OdpsSyncError as e:
        raise HTTPException(400, str(e))


# ─── Settings ───

@app.get("/settings")
def get_settings():
    return load_config()


@app.put("/settings")
def put_settings(cfg: dict):
    save_config(cfg)
    reset_bridge()
    return {"ok": True}


class TestNotifyRequest(BaseModel):
    channel: str  # dingtalk | feishu | webhook


@app.post("/settings/test-notify")
def test_notify(req: TestNotifyRequest):
    try:
        notifier.send(
            channel=req.channel,
            title="🦐 抓虾通知测试",
            records=0,
            adapter_name="crawshrimp",
            task_name="测试通知",
            sample_rows=[{"状态": "✅ 通知配置正常", "渠道": req.channel}],
        )
        return {"ok": True, "msg": f"{req.channel} 通知发送成功"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/settings/chrome-tabs")
def chrome_tabs():
    try:
        tabs = get_bridge().get_tabs()
        return [{'id': t.get('id'), 'url': t.get('url'), 'title': t.get('title')}
                for t in tabs if t.get('type') == 'page']
    except ConnectionError as e:
        raise HTTPException(503, str(e))


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("CRAWSHRIMP_PORT", 18765))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    )
    uvicorn.run(app, host="127.0.0.1", port=port)
