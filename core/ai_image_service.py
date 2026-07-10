"""Local AI image workbench service helpers."""
from __future__ import annotations

import base64
import binascii
import hashlib
import mimetypes
import re
import shutil
import ssl
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.parse import urlparse
from uuid import uuid4

from core import data_sink, runtime_paths
from core.one_xm_image import (
    DEFAULT_BASE_URL,
    FAILED_STATUSES,
    SUCCESS_STATUSES,
    OneXMImageClient,
    extract_image_urls,
    file_to_data_url,
    run_image_task_until_done,
)


GPT_2K_CONFIG_ID = "ai.1xm.gpt_image_2k_key"
GPT_4K_CONFIG_ID = "ai.1xm.gpt_image_4k_key"
GEMINI_FLASH_CONFIG_ID = "ai.1xm.gemini_3_1_flash_image_preview_key"
GEMINI_PRO_CONFIG_ID = "ai.1xm.gemini_3_pro_image_preview_key"
MAX_MATERIALIZED_DATA_URL_BYTES = 25 * 1024 * 1024
WORKBENCH_TRANSIENT_RETRY_LIMIT = 2
NANO_BANANA_MODELS = {
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image-preview",
}
GPT_IMAGE_QUALITIES = {"auto", "low", "medium", "high"}
NANO_BANANA_RESOLUTIONS = {"1K", "2K", "4K"}
_WORKBENCH_JOB_LOCKS: dict[str, threading.RLock] = {}
_WORKBENCH_JOB_LOCKS_GUARD = threading.Lock()
_WORKBENCH_POLL_EXECUTOR = ThreadPoolExecutor(max_workers=100, thread_name_prefix="ai-image-poll")


class MissingModelKeyError(ValueError):
    def __init__(self, message: str, *, config_id: str):
        super().__init__(message)
        self.config_id = config_id


class DownloadOutputsError(RuntimeError):
    def __init__(self, message: str, output_files: list[str]):
        super().__init__(message)
        self.output_files = output_files


class ActiveAiImageJobError(RuntimeError):
    """Raised when a queued or running workbench task cannot be deleted safely."""


def _compact(value: Any) -> str:
    return str(value or "").strip()


def default_output_dir(job: Mapping[str, Any]) -> Path:
    output_dir = _compact(job.get("output_dir"))
    if output_dir:
        return Path(output_dir).expanduser()
    return Path.home() / "Downloads" / "抓虾导出" / "AI生图"


def _params(job: Mapping[str, Any]) -> dict:
    value = job.get("params")
    return dict(value) if isinstance(value, Mapping) else {}


def _requested_image_count(source: Mapping[str, Any], *, default: int = 1, max_count: int = 8) -> int:
    params = _params(source)
    raw = source.get("n")
    if raw is None or raw == "":
        raw = params.get("n")
    if raw is None or raw == "":
        raw = params.get("count")
    if raw is None or raw == "":
        raw = default
    try:
        count = int(float(str(raw).strip()))
    except Exception:
        count = default
    return max(1, min(int(max_count), count))


def _normalized_batch_requested_count(source: Mapping[str, Any], model: str) -> int:
    if _compact(model) in NANO_BANANA_MODELS:
        return 1
    return _requested_image_count({"n": source.get("count")}, default=1, max_count=8)


def _size_tier(size: str) -> str:
    match = re.match(r"^(\d+)x(\d+)$", _compact(size), flags=re.IGNORECASE)
    if match and max(int(match.group(1)), int(match.group(2))) > 2048:
        return "4k"
    return "2k"


def _parse_pixel_size(size: Any) -> tuple[int, int] | None:
    value = _compact(size)
    match = re.match(r"^(\d+)x(\d+)$", value, flags=re.IGNORECASE)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def _validated_gpt_image_size(size: Any) -> str:
    value = _compact(size) or "1024x1024"
    if value.lower() == "auto":
        return "auto"
    dimensions = _parse_pixel_size(value)
    if not dimensions:
        raise ValueError(f"GPT-Image-2 尺寸格式无效: {value}")
    width, height = dimensions
    pixels = width * height
    ratio = max(width, height) / float(min(width, height) or 1)
    if (
        max(width, height) > 3840
        or width % 16 != 0
        or height % 16 != 0
        or ratio > 3
        or pixels < 655_360
        or pixels > 8_294_400
    ):
        raise ValueError(
            "GPT-Image-2 尺寸必须满足：最大边不超过 3840、宽高为 16 的倍数、"
            "长宽比不超过 3:1、总像素为 655360–8294400"
        )
    return f"{width}x{height}"


def _nano_resolution(params: Mapping[str, Any]) -> str:
    for raw in (params.get("resolution"), params.get("size"), params.get("quality")):
        value = _compact(raw).upper()
        if value in NANO_BANANA_RESOLUTIONS:
            return value
    dimensions = _parse_pixel_size(params.get("size"))
    if dimensions:
        longest = max(dimensions)
        if longest > 2048:
            return "4K"
        if longest > 1024:
            return "2K"
    return "1K"


def _settings_value(settings: Mapping[str, Any], config_id: str, alias: str = "") -> str:
    return _compact(settings.get(config_id) or (settings.get(alias) if alias else ""))


def select_model_key(job_or_params: Mapping[str, Any], settings: Mapping[str, Any]) -> tuple[str, str]:
    params = _params(job_or_params)
    model = _compact(job_or_params.get("model_key") or params.get("model") or params.get("model_key") or "gpt-image-2")
    if model == "gemini-3.1-flash-image-preview":
        key = _settings_value(settings, GEMINI_FLASH_CONFIG_ID)
        if not key:
            raise MissingModelKeyError(
                f"设置菜单未配置 1XM 图片模型 API Key: {GEMINI_FLASH_CONFIG_ID}",
                config_id=GEMINI_FLASH_CONFIG_ID,
            )
        return GEMINI_FLASH_CONFIG_ID, key
    if model == "gemini-3-pro-image-preview":
        key = _settings_value(settings, GEMINI_PRO_CONFIG_ID)
        if not key:
            raise MissingModelKeyError(
                f"设置菜单未配置 1XM 图片模型 API Key: {GEMINI_PRO_CONFIG_ID}",
                config_id=GEMINI_PRO_CONFIG_ID,
            )
        return GEMINI_PRO_CONFIG_ID, key
    explicit = _compact(job_or_params.get("model_key_tier") or params.get("model_key_tier") or params.get("key_tier")).lower()
    tier = explicit if explicit in {"2k", "4k"} else _size_tier(_compact(job_or_params.get("size") or params.get("size")))
    config_id = GPT_4K_CONFIG_ID if tier == "4k" else GPT_2K_CONFIG_ID
    key = _settings_value(settings, config_id, tier)
    if not key:
        raise MissingModelKeyError(
            f"设置菜单未配置 1XM 图片模型 API Key: {config_id} (1XM GPT Image {tier.upper()} Key)",
            config_id=config_id,
        )
    return tier, key


def _param_input_assets(params: Mapping[str, Any]) -> list[dict[str, Any]]:
    assets: list[dict[str, Any]] = []
    main_path = _compact(params.get("main_image_path"))
    if main_path:
        assets.append({"kind": "main", "path": main_path, "sort_order": 0})
    references = params.get("reference_image_paths")
    if isinstance(references, str):
        references = [references]
    if isinstance(references, list):
        for index, path in enumerate(references, start=1):
            value = _compact(path)
            if value:
                assets.append({"kind": "reference", "path": value, "sort_order": index})
    return assets


def build_workbench_one_xm_payload(
    job: Mapping[str, Any],
    assets: list[Mapping[str, Any]] | None = None,
    *,
    file_to_data_url_fn: Callable[[str], str] = file_to_data_url,
) -> dict:
    params = _params(job)
    model = _compact(job.get("model_key") or params.get("model") or "gpt-image-2") or "gpt-image-2"
    prompt = _compact(job.get("prompt") or params.get("prompt"))
    if model in NANO_BANANA_MODELS:
        payload: dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "size": _compact(params.get("ratio")) or "1:1",
            "quality": _nano_resolution(params),
        }
    else:
        quality = _compact(params.get("quality") or "auto").lower()
        if quality == "standard":
            quality = "medium"
        if quality not in GPT_IMAGE_QUALITIES:
            quality = "auto"
        output_format = _compact(
            params.get("output_format")
            or params.get("response_format")
            or params.get("format")
            or "png"
        ).lower() or "png"
        if output_format == "jpg":
            output_format = "jpeg"
        if output_format not in {"png", "jpeg", "webp"}:
            output_format = "png"
        payload = {
            "model": model,
            "prompt": prompt,
            "size": _validated_gpt_image_size(params.get("size") or "1024x1024"),
            "quality": quality,
            "output_format": output_format,
            "n": _requested_image_count(job),
        }
    for optional_key in ("webhook_url", "webhook_secret", "mask"):
        if params.get(optional_key):
            payload[optional_key] = params.get(optional_key)

    input_assets = _param_input_assets(params) or list(assets or [])
    ordered_assets = sorted(input_assets, key=lambda item: (int(item.get("sort_order") or 0), int(item.get("id") or 0)))
    images = []
    for asset in ordered_assets:
        if _compact(asset.get("kind")).lower() != "main":
            continue
        path = _compact(asset.get("path"))
        if path:
            images.append(file_to_data_url_fn(path))
    for asset in ordered_assets:
        if _compact(asset.get("kind")).lower() != "reference":
            continue
        path = _compact(asset.get("path"))
        if path:
            images.append(file_to_data_url_fn(path))
    if images:
        payload["image"] = images[:10]
    return payload


def build_one_xm_payload(
    job: Mapping[str, Any],
    assets: list[Mapping[str, Any]] | None = None,
    *,
    file_to_data_url_fn: Callable[[str], str] = file_to_data_url,
) -> dict:
    """Compatibility wrapper for the AI image workbench payload builder."""
    return build_workbench_one_xm_payload(
        job,
        assets,
        file_to_data_url_fn=file_to_data_url_fn,
    )


def _default_downloader(url: str, target: Path) -> None:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 Crawshrimp/AIImageWorkbench",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        target.write_bytes(response.read())


def _is_transient_download_error(exc: Exception) -> bool:
    if isinstance(exc, urllib.error.HTTPError):
        return int(exc.code or 0) in {408, 425, 429, 500, 502, 503, 504}
    if isinstance(exc, (TimeoutError, ConnectionError, ssl.SSLError)):
        return True
    if isinstance(exc, urllib.error.URLError):
        reason = exc.reason
        if isinstance(reason, (TimeoutError, ConnectionError, OSError, ssl.SSLError)):
            return True
    return bool(re.search(
        r"unexpected_eof|eof occurred|connection (?:reset|aborted)|"
        r"timed out|timeout|temporary failure|(?:status code|http)\s*(?:502|503|504)\b",
        _compact(exc).lower(),
    ))


def _download_cache_image(
    url: str,
    target: Path,
    downloader: Callable[[str, Path], None],
) -> None:
    retry_delays = (0.25, 0.75)
    for attempt in range(len(retry_delays) + 1):
        try:
            downloader(url, target)
            return
        except Exception as exc:
            target.unlink(missing_ok=True)
            if attempt >= len(retry_delays) or not _is_transient_download_error(exc):
                raise
            time.sleep(retry_delays[attempt])


def _extension_from_url(url: str, fallback: str = ".png") -> str:
    suffix = Path(urlparse(url).path).suffix.lower()
    if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
        return suffix
    guessed = mimetypes.guess_extension(mimetypes.guess_type(url)[0] or "")
    return guessed if guessed in {".png", ".jpg", ".jpeg", ".webp"} else fallback


def _download_outputs(image_urls: list[str], output_dir: Path, downloader: Callable[[str, Path], None]) -> list[str]:
    files: list[str] = []
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        raise DownloadOutputsError(str(exc), files) from exc
    for index, url in enumerate(image_urls, start=1):
        suffix = _extension_from_url(url)
        target: Path | None = None
        try:
            target = _unique_path(output_dir / f"result-{index:02d}{suffix}")
            downloader(url, target)
            _validate_downloaded_image(target)
        except Exception as exc:
            if target is not None and target.exists():
                target.unlink()
            raise DownloadOutputsError(str(exc), files) from exc
        files.append(str(target))
    return files


def _validate_downloaded_image(path: Path) -> None:
    try:
        header = path.read_bytes()[:16]
    except FileNotFoundError as exc:
        raise ValueError(f"downloaded image file is missing: {path.name}") from exc
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return
    if header.startswith(b"\xff\xd8\xff"):
        return
    if header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return
    raise ValueError(f"downloaded file is not a supported image: {path.name}")


def _unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    for index in range(1, 10_000):
        candidate = path.with_name(f"{path.stem}-{index}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"Cannot allocate unique file name for {path.name}")


def _sanitize_error(value: Any, secrets: list[str] | None = None) -> str:
    text = _compact(value)
    for secret in secrets or []:
        if secret:
            text = text.replace(secret, "[redacted]")
    text = re.sub(r"data:image/[^,\s]+,[^\s]+", "[data-url-redacted]", text, flags=re.IGNORECASE)
    text = re.sub(r"(?i)api[_-]?key\s*=\s*[^\s,;]+", "[api-key-redacted]", text)
    text = re.sub(r"(?i)webhook[_-]?secret\s*=\s*[^\s,;]+", "[webhook-secret-redacted]", text)
    text = re.sub(r"(?i)webhook[_-]?secret", "webhook-secret-redacted", text)
    return text[:500]


def _safe_summary(result: Mapping[str, Any], output_files: list[str], tier: str) -> dict:
    return {
        "ok": bool(result.get("ok")),
        "run_uid": _compact(result.get("run_uid")),
        "model_key_tier": tier,
        "task_id": _compact(result.get("task_id")),
        "poll_url": _compact(result.get("poll_url")),
        "image_urls": [str(url) for url in result.get("image_urls") or []],
        "output_files": output_files,
        "error": _sanitize_error(result.get("error")),
        "warning": "",
        "create_attempts": int(result.get("create_attempts") or 0),
        "poll_attempts": int(result.get("poll_attempts") or 0),
        "compensation_attempts": int(result.get("compensation_attempts") or 0),
    }


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item or "").strip()]


def _append_unique(existing: list[str], additions: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in [*existing, *additions]:
        value = str(item or "").strip()
        if not value or value in seen:
            continue
        result.append(value)
        seen.add(value)
    return result


def _normalized_edit_source(params: Mapping[str, Any]) -> dict[str, str]:
    source = params.get("edit_source")
    if not isinstance(source, Mapping):
        return {}
    result = {
        "job_uid": _compact(source.get("job_uid")),
        "run_uid": _compact(source.get("run_uid")),
        "result_key": _compact(source.get("result_key")),
    }
    return result if result["result_key"] else {}


def _workbench_input_snapshot(params: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "main_image_path": _compact(params.get("main_image_path")),
        "reference_image_paths": _string_list(params.get("reference_image_paths")),
    }


def _legacy_run_from_summary(job: Mapping[str, Any], summary: Mapping[str, Any]) -> dict | None:
    output_files = _string_list(summary.get("output_files"))
    image_urls = _string_list(summary.get("image_urls"))
    if not output_files and not image_urls:
        return None
    params = _params(job)
    return {
        "run_uid": "legacy",
        "created_at": _compact(job.get("updated_at") or job.get("created_at")),
        "prompt": _compact(job.get("prompt") or params.get("prompt")),
        "model_key": _compact(job.get("model_key") or params.get("model") or "gpt-image-2"),
        "model_key_tier": _compact(summary.get("model_key_tier")),
        "size": _compact(params.get("size")),
        "ratio": _compact(params.get("ratio")),
        "status": _compact(job.get("status") or "completed"),
        "task_id": _compact(summary.get("task_id")),
        "poll_url": _compact(summary.get("poll_url")),
        "image_urls": image_urls,
        "output_files": output_files,
        "warning": _compact(summary.get("warning")),
        "error": _compact(summary.get("error")),
    }


def _merge_run_summary(job: Mapping[str, Any], latest_summary: Mapping[str, Any], *, status: str) -> dict:
    previous_summary = job.get("summary") if isinstance(job.get("summary"), Mapping) else {}
    previous_runs = [
        dict(run)
        for run in previous_summary.get("runs") or []
        if isinstance(run, Mapping)
    ]
    if not previous_runs:
        legacy_run = _legacy_run_from_summary(job, previous_summary)
        if legacy_run:
            previous_runs.append(legacy_run)

    params = _params(job)
    output_files = _string_list(latest_summary.get("output_files"))
    image_urls = _string_list(latest_summary.get("image_urls"))
    run_record = {
        "run_uid": _compact(latest_summary.get("run_uid") or latest_summary.get("task_id")) or f"run-{len(previous_runs) + 1}",
        "created_at": _now_iso(),
        "prompt": _compact(job.get("prompt") or params.get("prompt")),
        "model_key": _compact(job.get("model_key") or params.get("model") or "gpt-image-2"),
        "model_key_tier": _compact(latest_summary.get("model_key_tier")),
        "size": _compact(params.get("size")),
        "ratio": _compact(params.get("ratio")),
        "input_params": _workbench_input_snapshot(params),
        "status": status,
        "task_id": _compact(latest_summary.get("task_id")),
        "poll_url": _compact(latest_summary.get("poll_url")),
        "image_urls": image_urls,
        "output_files": output_files,
        "warning": _compact(latest_summary.get("warning")),
        "error": _compact(latest_summary.get("error")),
    }
    edit_source = _normalized_edit_source(params)
    if edit_source:
        run_record["edit_source"] = edit_source

    merged = {
        **dict(latest_summary),
        "image_urls": _append_unique(_string_list(previous_summary.get("image_urls")), image_urls),
        "output_files": _append_unique(_string_list(previous_summary.get("output_files")), output_files),
        "runs": [*previous_runs, run_record],
    }
    if isinstance(previous_summary.get("result_cache"), Mapping):
        merged["result_cache"] = dict(previous_summary["result_cache"])
    return merged


def _workbench_job_lock(job_uid: str) -> threading.RLock:
    uid = _compact(job_uid)
    with _WORKBENCH_JOB_LOCKS_GUARD:
        lock = _WORKBENCH_JOB_LOCKS.get(uid)
        if lock is None:
            lock = threading.RLock()
            _WORKBENCH_JOB_LOCKS[uid] = lock
        return lock


def _workbench_job_is_active(job: Mapping[str, Any]) -> bool:
    active_statuses = {"queued", "running"}
    if _compact(job.get("status")).lower() in active_statuses:
        return True
    summary = job.get("summary") if isinstance(job.get("summary"), Mapping) else {}
    return any(
        _compact(run.get("status")).lower() in active_statuses
        for run in summary.get("runs") or []
        if isinstance(run, Mapping)
    )


def _nested_string_values(value: Any):
    if isinstance(value, str):
        yield value
        return
    if isinstance(value, Mapping):
        for item in value.values():
            yield from _nested_string_values(item)
        return
    if isinstance(value, (list, tuple, set)):
        for item in value:
            yield from _nested_string_values(item)


def _workbench_job_cache_files(job: Mapping[str, Any]) -> list[Path]:
    uid = _compact(job.get("job_uid"))
    cache_root = runtime_paths.child_dir("ai-image-cache").resolve(strict=False)
    uid_prefix = uid[:8]
    marker = f"-{uid_prefix}-" if uid_prefix else ""
    payload = {
        "job": dict(job),
        "assets": data_sink.list_ai_image_assets(uid),
        "canvases": data_sink.list_ai_image_canvases(uid),
    }
    candidates: set[Path] = set()
    for raw_value in _nested_string_values(payload):
        value = _compact(raw_value)
        if not value or value.startswith(("http://", "https://", "data:")):
            continue
        candidate = Path(value).expanduser().resolve(strict=False)
        if marker and marker in candidate.name and candidate.is_relative_to(cache_root) and (candidate.is_file() or candidate.is_symlink()):
            candidates.add(candidate)

    if marker:
        for candidate in cache_root.iterdir():
            resolved = candidate.resolve(strict=False)
            if marker in candidate.name and resolved.is_relative_to(cache_root) and (candidate.is_file() or candidate.is_symlink()):
                candidates.add(resolved)
    return sorted(candidates, key=lambda path: str(path))


def delete_workbench_job(job_uid: str) -> dict:
    uid = _compact(job_uid)
    if not uid:
        raise ValueError("AI image job not found")
    with _workbench_job_lock(uid):
        job = data_sink.get_ai_image_job(uid)
        if not job:
            raise ValueError(f"AI image job not found: {uid}")
        if _workbench_job_is_active(job):
            raise ActiveAiImageJobError("任务生成中，完成或失败后可删除")

        cache_files = _workbench_job_cache_files(job)
        failed: list[str] = []
        deleted = 0
        for path in cache_files:
            existed = path.exists() or path.is_symlink()
            try:
                path.unlink(missing_ok=True)
                if existed:
                    deleted += 1
            except OSError as exc:
                failed.append(f"{path.name}: {exc}")
        if failed:
            raise RuntimeError("本地图片缓存清理失败，请稍后重试")
        if not data_sink.delete_ai_image_job(uid):
            raise ValueError(f"AI image job not found: {uid}")
        return {
            "ok": True,
            "job_uid": uid,
            "deleted_cache_files": deleted,
        }


def _provider_error(task: Mapping[str, Any], fallback: str) -> str:
    error = task.get("error") if isinstance(task, Mapping) else None
    if isinstance(error, Mapping):
        return _compact(error.get("message") or error.get("code")) or fallback
    return _compact(task.get("message") if isinstance(task, Mapping) else "") or fallback


def _workbench_run_patch(
    task: Mapping[str, Any],
    *,
    fallback_status: str = "queued",
    requested_count: int = 1,
) -> dict[str, Any]:
    provider_status = _compact(task.get("status")).lower() or fallback_status
    task_id = _compact(task.get("task_id") or task.get("id"))
    poll_url = _compact(task.get("poll_url")) or (f"/images/tasks/{task_id}" if task_id else "")
    try:
        poll_after = float(task.get("poll_after") or 5)
    except (TypeError, ValueError):
        poll_after = 5.0
    patch: dict[str, Any] = {
        "provider_status": provider_status,
        "poll_after": max(0.0, poll_after),
    }
    if task_id:
        patch["task_id"] = task_id
    if poll_url:
        patch["poll_url"] = poll_url
    if provider_status in SUCCESS_STATUSES:
        patch.update({
            "status": "completed",
            "image_urls": extract_image_urls(task)[:max(1, int(requested_count or 1))],
            "error": "",
        })
    elif provider_status in FAILED_STATUSES:
        patch.update({
            "status": "failed",
            "image_urls": [],
            "error": _provider_error(task, f"1XM task {provider_status}"),
        })
    else:
        patch["status"] = "running" if provider_status == "running" else "queued"
    return patch


def _is_transient_workbench_failure(error: Any) -> bool:
    value = _compact(error).lower()
    return bool(re.search(
        r"(?:status code|http)\s*(?:502|503|504)\b|"
        r"bad gateway|service unavailable|gateway timeout|upstream timeout|timed out|timeout",
        value,
    ))


def _workbench_retry_payload(job: Mapping[str, Any], run: Mapping[str, Any]) -> dict[str, Any]:
    current_params = _params(job)
    input_params = run.get("input_params") if isinstance(run.get("input_params"), Mapping) else {}
    params = {
        **current_params,
        "size": _compact(run.get("size")) or current_params.get("size"),
        "ratio": _compact(run.get("ratio")) or current_params.get("ratio"),
        "quality": _compact(run.get("quality")) or current_params.get("quality"),
        "response_format": _compact(run.get("response_format")) or current_params.get("response_format"),
        "n": int(run.get("requested_count") or 1),
        "model_key_tier": _compact(run.get("model_key_tier")) or current_params.get("model_key_tier"),
        "main_image_path": _compact(input_params.get("main_image_path")),
        "reference_image_paths": _string_list(input_params.get("reference_image_paths")),
    }
    model = _compact(run.get("model_key") or job.get("model_key") or params.get("model") or "gpt-image-2")
    payload = build_workbench_one_xm_payload(
        {
            **dict(job),
            "model_key": model,
            "prompt": _compact(run.get("prompt")),
            "params": params,
        },
        data_sink.list_ai_image_assets(_compact(job.get("job_uid"))),
    )
    if model in NANO_BANANA_MODELS:
        payload.pop("n", None)
    else:
        payload["n"] = int(run.get("requested_count") or 1)
    return payload


def _workbench_transient_retry_patch(
    job: Mapping[str, Any],
    run: Mapping[str, Any],
    failure_patch: Mapping[str, Any],
    client: OneXMImageClient,
) -> dict[str, Any]:
    error = _compact(failure_patch.get("error"))
    try:
        retry_count = max(0, int(run.get("retry_count") or 0))
    except (TypeError, ValueError):
        retry_count = 0
    if not _is_transient_workbench_failure(error) or retry_count >= WORKBENCH_TRANSIENT_RETRY_LIMIT:
        return dict(failure_patch)

    next_retry_count = retry_count + 1
    history = [
        dict(item)
        for item in (run.get("retry_history") or [])
        if isinstance(item, Mapping)
    ]
    history.append({
        "retry_index": next_retry_count,
        "task_id": _compact(failure_patch.get("task_id") or run.get("task_id")),
        "poll_url": _compact(failure_patch.get("poll_url") or run.get("poll_url")),
        "provider_status": _compact(failure_patch.get("provider_status") or run.get("provider_status")),
        "error": error,
        "failed_at": _now_iso(),
    })
    try:
        task = client.create_task(
            _workbench_retry_payload(job, run),
            idempotency_key=(
                f"ai_image_{_compact(job.get('job_uid'))}_{_compact(run.get('run_uid'))}"
                f"_retry_{next_retry_count}"
            ),
            timeout=30,
            request_retries=3,
        )
        patch = _workbench_run_patch(
            task,
            requested_count=int(run.get("requested_count") or 1),
        )
        patch.update({
            "retry_count": next_retry_count,
            "retry_history": history,
            "last_retry_error": error,
        })
        if patch.get("status") in {"queued", "running", "completed"}:
            patch["error"] = ""
        return patch
    except Exception as exc:
        retry_error = _sanitize_error(exc, [client.api_key])
        return {
            **dict(failure_patch),
            "retry_count": next_retry_count,
            "retry_history": history,
            "last_retry_error": error,
            "error": f"{error}; 自动重试提交失败: {retry_error}"[:500],
        }


def _rebuild_workbench_summary(summary: Mapping[str, Any], runs: list[dict[str, Any]]) -> tuple[dict, str]:
    image_urls: list[str] = []
    output_files: list[str] = []
    for run in runs:
        image_urls = _append_unique(image_urls, _string_list(run.get("image_urls")))
        output_files = _append_unique(output_files, _string_list(run.get("output_files")))
    statuses = {_compact(run.get("status")).lower() for run in runs}
    if statuses & {"queued", "running"}:
        job_status = "running"
    elif "completed" in statuses:
        job_status = "completed"
    elif runs:
        job_status = "failed"
    else:
        job_status = "draft"
    latest_handle = next((run for run in reversed(runs) if run.get("task_id") or run.get("poll_url")), {})
    rebuilt = {
        **dict(summary),
        "ok": "completed" in statuses,
        "runs": runs,
        "image_urls": image_urls,
        "output_files": output_files,
        "task_id": _compact(latest_handle.get("task_id")),
        "poll_url": _compact(latest_handle.get("poll_url")),
    }
    return rebuilt, job_status


def _update_workbench_run(job_uid: str, run_uid: str, patch: Mapping[str, Any]) -> dict:
    with _workbench_job_lock(job_uid):
        job = data_sink.get_ai_image_job(job_uid)
        if not job:
            raise ValueError(f"AI image job not found: {job_uid}")
        summary = dict(job.get("summary") or {})
        runs = [dict(run) for run in summary.get("runs") or [] if isinstance(run, Mapping)]
        run_index = next((index for index, run in enumerate(runs) if _compact(run.get("run_uid")) == run_uid), -1)
        if run_index < 0:
            raise ValueError(f"AI image run not found: {run_uid}")
        runs[run_index] = {**runs[run_index], **dict(patch)}
        rebuilt, job_status = _rebuild_workbench_summary(summary, runs)
        return data_sink.update_ai_image_job(job_uid, {"status": job_status, "summary": rebuilt})


def poll_workbench_run(
    job_uid: str,
    run_uid: str,
    client: OneXMImageClient,
    *,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> dict:
    while True:
        job = data_sink.get_ai_image_job(job_uid)
        if not job:
            return {"ok": False, "job_uid": job_uid, "run_uid": run_uid, "error": "AI image job not found"}
        run = next((
            dict(item)
            for item in (job.get("summary") or {}).get("runs") or []
            if isinstance(item, Mapping) and _compact(item.get("run_uid")) == run_uid
        ), None)
        if not run:
            return {"ok": False, "job_uid": job_uid, "run_uid": run_uid, "error": "AI image run not found"}
        if _compact(run.get("status")).lower() in {"completed", "failed"}:
            return {"ok": run.get("status") == "completed", "job_uid": job_uid, "run_uid": run_uid, "run": run}
        poll_url = _compact(run.get("poll_url") or run.get("task_id"))
        if not poll_url:
            updated = _update_workbench_run(job_uid, run_uid, {
                "status": "failed",
                "provider_status": "failed",
                "error": "1XM task did not return poll_url",
            })
            return {"ok": False, "job_uid": job_uid, "run_uid": run_uid, "job": updated}
        try:
            wait_seconds = max(0.0, float(run.get("poll_after") or 5))
        except (TypeError, ValueError):
            wait_seconds = 5.0
        sleep_fn(wait_seconds)
        try:
            current = client.get_task(poll_url)
            patch = _workbench_run_patch(
                current,
                fallback_status=_compact(run.get("provider_status")) or "queued",
                requested_count=int(run.get("requested_count") or 1),
            )
            if patch.get("status") == "failed":
                patch = _workbench_transient_retry_patch(job, run, patch, client)
        except Exception as exc:
            patch = {
                "status": "failed",
                "provider_status": "failed",
                "error": _sanitize_error(exc, [client.api_key]),
            }
        updated = _update_workbench_run(job_uid, run_uid, patch)
        latest_run = next(
            (item for item in (updated.get("summary") or {}).get("runs") or [] if item.get("run_uid") == run_uid),
            {},
        )
        if latest_run.get("status") in {"completed", "failed"}:
            return {
                "ok": latest_run.get("status") == "completed",
                "job_uid": job_uid,
                "run_uid": run_uid,
                "run": latest_run,
                "job": updated,
            }


def retry_workbench_run(
    job_uid: str,
    run_uid: str,
    *,
    settings: Mapping[str, Any] | None = None,
    client_factory: Callable[..., OneXMImageClient] = OneXMImageClient,
    poll_submitter: Callable[..., Any] | None = None,
) -> dict:
    job = data_sink.get_ai_image_job(job_uid)
    if not job:
        raise ValueError(f"AI image job not found: {job_uid}")
    run = next((
        dict(item)
        for item in (job.get("summary") or {}).get("runs") or []
        if isinstance(item, Mapping) and _compact(item.get("run_uid")) == run_uid
    ), None)
    if not run:
        raise ValueError(f"AI image run not found: {run_uid}")
    if _compact(run.get("status")).lower() != "failed":
        raise ValueError("只有失败的生图队列可以重试")

    resolved_settings = dict(settings or {})
    if not resolved_settings:
        from core.api_server import _resolve_one_xm_settings

        resolved_settings = _resolve_one_xm_settings()
    retry_job = {
        **dict(job),
        "model_key": _compact(run.get("model_key") or job.get("model_key")),
        "params": {
            **_params(job),
            "model_key_tier": _compact(run.get("model_key_tier")) or _params(job).get("model_key_tier"),
        },
    }
    _, api_key = select_model_key(retry_job, resolved_settings)
    client = client_factory(api_key, base_url=_compact(resolved_settings.get("base_url")) or DEFAULT_BASE_URL)
    manual_retry_count = max(0, int(run.get("manual_retry_count") or 0)) + 1
    manual_retry_history = [
        dict(item)
        for item in (run.get("manual_retry_history") or [])
        if isinstance(item, Mapping)
    ]
    manual_retry_history.append({
        "retry_index": manual_retry_count,
        "task_id": _compact(run.get("task_id")),
        "error": _compact(run.get("error")),
        "retried_at": _now_iso(),
    })

    try:
        task = client.create_task(
            _workbench_retry_payload(job, run),
            idempotency_key=f"ai_image_{job_uid}_{run_uid}_manual_retry_{manual_retry_count}",
            timeout=30,
            request_retries=3,
        )
        patch = _workbench_run_patch(
            task,
            requested_count=int(run.get("requested_count") or 1),
        )
        patch.update({
            "retry_count": 0,
            "manual_retry_count": manual_retry_count,
            "manual_retry_history": manual_retry_history,
            "last_retry_error": _compact(run.get("error")),
        })
        if patch.get("status") in {"queued", "running", "completed"}:
            patch["error"] = ""
    except Exception as exc:
        patch = {
            "manual_retry_count": manual_retry_count,
            "manual_retry_history": manual_retry_history,
            "error": f"手动重试提交失败: {_sanitize_error(exc, [api_key])}"[:500],
        }

    updated = _update_workbench_run(job_uid, run_uid, patch)
    latest_run = next(
        (item for item in (updated.get("summary") or {}).get("runs") or [] if item.get("run_uid") == run_uid),
        {},
    )
    accepted = latest_run.get("status") in {"queued", "running", "completed"}
    if latest_run.get("status") in {"queued", "running"}:
        poller = poll_submitter or _WORKBENCH_POLL_EXECUTOR.submit
        poller(poll_workbench_run, job_uid, run_uid, client)
    return {
        "ok": accepted,
        "accepted": accepted,
        "job_uid": job_uid,
        "run_uid": run_uid,
        "run": latest_run,
        "job": updated,
    }


def submit_workbench_batch(
    job_uid: str,
    prompts: list[Mapping[str, Any] | str],
    *,
    request_uid: str = "",
    settings: Mapping[str, Any] | None = None,
    client_factory: Callable[..., OneXMImageClient] = OneXMImageClient,
    executor_factory: Callable[..., ThreadPoolExecutor] = ThreadPoolExecutor,
    poll_submitter: Callable[..., Any] | None = None,
) -> dict:
    job = data_sink.get_ai_image_job(job_uid)
    if not job:
        raise ValueError(f"AI image job not found: {job_uid}")
    model = _compact(job.get("model_key") or _params(job).get("model") or "gpt-image-2")

    normalized_prompts: list[dict[str, Any]] = []
    for index, item in enumerate(prompts or []):
        source = item if isinstance(item, Mapping) else {"prompt": item}
        prompt = _compact(source.get("prompt"))
        if prompt:
            normalized_prompts.append({
                "title": _compact(source.get("title")) or f"Prompt {index + 1}",
                "prompt": prompt,
                "count": _normalized_batch_requested_count(source, model),
            })
    if not normalized_prompts:
        raise ValueError("请至少提交 1 条 Prompt")
    if len(normalized_prompts) > 100:
        raise ValueError("单次最多提交 100 条 Prompt")

    request_key = _compact(request_uid) or uuid4().hex
    existing_runs = [
        dict(run)
        for run in (job.get("summary") or {}).get("runs") or []
        if isinstance(run, Mapping)
    ]
    duplicate_runs = [run for run in existing_runs if _compact(run.get("request_uid")) == request_key]
    if duplicate_runs:
        batch_uid = _compact(duplicate_runs[0].get("batch_uid"))
        return {
            "ok": True,
            "accepted": True,
            "deduplicated": True,
            "job_uid": job_uid,
            "batch_uid": batch_uid,
            "runs": sorted(duplicate_runs, key=lambda run: int(run.get("batch_index") or 0)),
            "job": job,
        }

    resolved_settings = dict(settings or {})
    if not resolved_settings:
        from core.api_server import _resolve_one_xm_settings

        resolved_settings = _resolve_one_xm_settings()
    _, api_key = select_model_key(job, resolved_settings)
    client = client_factory(api_key, base_url=_compact(resolved_settings.get("base_url")) or DEFAULT_BASE_URL)
    assets = data_sink.list_ai_image_assets(job_uid)
    params = {**_params(job), "n": 1}
    base_payload = build_workbench_one_xm_payload(
        {**job, "prompt": normalized_prompts[0]["prompt"], "params": params},
        assets,
    )
    batch_uid = uuid4().hex
    created_at = _now_iso()
    batch_runs = []
    for index, prompt_item in enumerate(normalized_prompts):
        batch_runs.append({
            "run_uid": uuid4().hex,
            "batch_uid": batch_uid,
            "batch_index": index,
            "request_uid": request_key,
            "title": prompt_item["title"],
            "prompt": prompt_item["prompt"],
            "requested_count": prompt_item["count"],
            "created_at": created_at,
            "model_key": _compact(job.get("model_key") or base_payload.get("model")),
            "model_key_tier": _compact(params.get("model_key_tier")),
            "size": _compact(params.get("size")),
            "ratio": _compact(params.get("ratio")),
            "quality": _compact(params.get("quality")),
            "response_format": _compact(params.get("response_format") or params.get("output_format")),
            "input_params": _workbench_input_snapshot(params),
            "status": "queued",
            "provider_status": "pending_submission",
            "task_id": "",
            "poll_url": "",
            "poll_after": 5,
            "retry_count": 0,
            "retry_history": [],
            "image_urls": [],
            "output_files": [],
            "warning": "",
            "error": "",
        })

    with _workbench_job_lock(job_uid):
        latest_job = data_sink.get_ai_image_job(job_uid)
        latest_summary = dict((latest_job or {}).get("summary") or {})
        previous_runs = [dict(run) for run in latest_summary.get("runs") or [] if isinstance(run, Mapping)]
        if not previous_runs:
            legacy_run = _legacy_run_from_summary(latest_job or job, latest_summary)
            if legacy_run:
                previous_runs.append(legacy_run)
        rebuilt, _ = _rebuild_workbench_summary(latest_summary, [*previous_runs, *batch_runs])
        data_sink.update_ai_image_job(job_uid, {"status": "running", "summary": rebuilt})

    poller = poll_submitter or _WORKBENCH_POLL_EXECUTOR.submit

    def create_one(run: Mapping[str, Any]) -> tuple[str, dict[str, Any]]:
        payload = {**base_payload, "prompt": run["prompt"]}
        if model in NANO_BANANA_MODELS:
            payload.pop("n", None)
        else:
            payload["n"] = int(run.get("requested_count") or 1)
        task = client.create_task(
            payload,
            idempotency_key=f"ai_image_{job_uid}_{run['run_uid']}",
            timeout=30,
            request_retries=3,
        )
        return _compact(run.get("run_uid")), dict(task or {})

    with executor_factory(max_workers=min(len(batch_runs), 100)) as executor:
        future_to_run = {executor.submit(create_one, run): run for run in batch_runs}
        for future in as_completed(future_to_run):
            run = future_to_run[future]
            run_uid = _compact(run.get("run_uid"))
            try:
                _, task = future.result()
                patch = _workbench_run_patch(
                    task,
                    requested_count=int(run.get("requested_count") or 1),
                )
            except Exception as exc:
                patch = {
                    "status": "failed",
                    "provider_status": "failed",
                    "error": _sanitize_error(exc, [api_key]),
                }
            updated = _update_workbench_run(job_uid, run_uid, patch)
            latest_run = next(
                (item for item in (updated.get("summary") or {}).get("runs") or [] if item.get("run_uid") == run_uid),
                {},
            )
            if latest_run.get("status") in {"queued", "running"}:
                poller(poll_workbench_run, job_uid, run_uid, client)

    final_job = data_sink.get_ai_image_job(job_uid) or job
    final_runs = [
        dict(run)
        for run in (final_job.get("summary") or {}).get("runs") or []
        if isinstance(run, Mapping) and _compact(run.get("batch_uid")) == batch_uid
    ]
    return {
        "ok": any(run.get("status") != "failed" for run in final_runs),
        "accepted": True,
        "deduplicated": False,
        "job_uid": job_uid,
        "batch_uid": batch_uid,
        "runs": sorted(final_runs, key=lambda run: int(run.get("batch_index") or 0)),
        "job": final_job,
    }


def run_job_with_one_xm(
    job_uid: str,
    *,
    settings: Mapping[str, Any] | None = None,
    runner: Callable[..., dict[str, Any]] = run_image_task_until_done,
    downloader: Callable[[str, Path], None] = _default_downloader,
    file_to_data_url_fn: Callable[[str], str] = file_to_data_url,
) -> dict:
    job = data_sink.get_ai_image_job(job_uid)
    if not job:
        raise ValueError(f"AI image job not found: {job_uid}")
    resolved_settings = dict(settings or {})
    if not resolved_settings:
        from core.api_server import _resolve_one_xm_settings

        resolved_settings = _resolve_one_xm_settings()
    tier, api_key = select_model_key(job, resolved_settings)
    assets = data_sink.list_ai_image_assets(job_uid)
    payload = build_one_xm_payload(job, assets, file_to_data_url_fn=file_to_data_url_fn)
    if not payload.get("prompt"):
        raise ValueError("AI image job prompt is required")
    requested_count = _requested_image_count(payload)

    client = OneXMImageClient(api_key, base_url=_compact(resolved_settings.get("base_url")) or DEFAULT_BASE_URL)
    run_uid = uuid4().hex
    data_sink.update_ai_image_job(job_uid, {"status": "running"})
    try:
        result = runner(
            client,
            payload,
            idempotency_key=f"ai_image_{job_uid}_{run_uid}",
            task_attempts=1,
            request_retries=3,
            request_timeout_seconds=120,
            poll_timeout_seconds=600,
        )
    except Exception as exc:
        summary = _safe_summary(
            {"ok": False, "run_uid": run_uid, "error": _sanitize_error(exc, [api_key])},
            [],
            tier,
        )
        summary = _merge_run_summary(job, summary, status="failed")
        data_sink.update_ai_image_job(job_uid, {"status": "failed", "summary": summary})
        return {"ok": False, "job_uid": job_uid, "summary": summary}

    normalized_result = dict(result or {})
    if normalized_result.get("ok"):
        normalized_result["image_urls"] = [
            str(url)
            for url in (normalized_result.get("image_urls") or [])
            if str(url or "").strip()
        ][:requested_count]

    summary = _safe_summary({**normalized_result, "run_uid": run_uid}, [], tier)
    if normalized_result.get("ok") and not summary["image_urls"]:
        summary["ok"] = False
        summary["error"] = "生成任务成功返回，但没有图片地址"
    status = "completed" if summary.get("ok") else "failed"
    summary = _merge_run_summary(job, summary, status=status)
    data_sink.update_ai_image_job(job_uid, {
        "status": status,
        "summary": summary,
    })
    return {"ok": bool(summary.get("ok")), "job_uid": job_uid, "summary": summary}


def _known_result_urls(job: Mapping[str, Any]) -> list[str]:
    summary = job.get("summary") if isinstance(job.get("summary"), Mapping) else {}
    urls = _string_list(summary.get("image_urls"))
    for run in summary.get("runs") or []:
        if isinstance(run, Mapping):
            urls.extend(_string_list(run.get("image_urls")))
    for asset in data_sink.list_ai_image_assets(_compact(job.get("job_uid"))) if job.get("job_uid") else []:
        if _compact(asset.get("kind")).lower() in {"output", "result"}:
            urls.extend(_string_list([asset.get("url")]))
    return _append_unique([], urls)


def materialize_remote_image(
    job_uid: str,
    url: str,
    *,
    allow_unlisted: bool = False,
    downloader: Callable[[str, Path], None] = _default_downloader,
) -> dict:
    job = data_sink.get_ai_image_job(job_uid)
    if not job:
        if not allow_unlisted:
            raise ValueError(f"AI image job not found: {job_uid}")
        job = {"job_uid": job_uid}
    source_url = _compact(url)
    if not source_url:
        raise ValueError("图片地址不能为空")
    if not (source_url.startswith("http://") or source_url.startswith("https://")):
        raise ValueError("仅支持物化远程图片地址")
    if not allow_unlisted and source_url not in _known_result_urls(job):
        raise ValueError("图片 URL 不属于当前任务结果")

    cache_dir = runtime_paths.child_dir("ai-image-cache")
    suffix = _extension_from_url(source_url)
    cache_key = hashlib.sha256(source_url.encode("utf-8")).hexdigest()[:16]
    target = cache_dir / f"result-{_compact(job_uid)[:8] or 'job'}-{cache_key}{suffix}"
    if target.exists():
        try:
            _validate_downloaded_image(target)
        except Exception:
            target.unlink(missing_ok=True)
    if not target.exists():
        temporary = cache_dir / f".{target.name}-{uuid4().hex[:8]}.tmp"
        try:
            _download_cache_image(source_url, temporary, downloader)
            _validate_downloaded_image(temporary)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)

    latest_job = data_sink.get_ai_image_job(job_uid)
    if latest_job:
        latest_summary = dict(latest_job.get("summary") or {})
        result_cache = dict(latest_summary.get("result_cache") or {})
        if result_cache.get(source_url) != str(target):
            result_cache[source_url] = str(target)
            data_sink.update_ai_image_job(job_uid, {
                "summary": {**latest_summary, "result_cache": result_cache},
            })
    return {"ok": True, "job_uid": job_uid, "url": source_url, "path": str(target)}


def _extension_from_mime(mime_type: str) -> str:
    normalized = _compact(mime_type).lower()
    if normalized == "image/png":
        return ".png"
    if normalized in {"image/jpg", "image/jpeg"}:
        return ".jpg"
    if normalized == "image/webp":
        return ".webp"
    return ".png"


def _safe_stem(filename: str, fallback: str = "annotation-edit") -> str:
    stem = Path(_compact(filename)).stem or fallback
    value = re.sub(r"[^a-zA-Z0-9._-]+", "-", stem).strip(".-_")
    return value[:80] or fallback


def materialize_data_url_image(
    job_uid: str,
    data_url: str,
    *,
    filename: str = "",
    allow_unlisted: bool = False,
    max_bytes: int = MAX_MATERIALIZED_DATA_URL_BYTES,
) -> dict:
    job = data_sink.get_ai_image_job(job_uid)
    if not job:
        if not allow_unlisted:
            raise ValueError(f"AI image job not found: {job_uid}")
        job = {"job_uid": job_uid}
    source = _compact(data_url)
    if not source:
        raise ValueError("图片 data URL 不能为空")
    match = re.match(r"^data:(image/(?:png|jpe?g|webp));base64,(.+)$", source, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        raise ValueError("仅支持 PNG、JPG 或 WEBP 图片 data URL")
    mime_type = match.group(1).lower()
    if mime_type == "image/jpg":
        mime_type = "image/jpeg"
    encoded = re.sub(r"\s+", "", match.group(2))
    if len(encoded) * 3 // 4 > max_bytes:
        raise ValueError(f"图片超过 {max_bytes // (1024 * 1024)}MB，无法保存")
    try:
        payload = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("图片 data URL 编码无效") from exc
    if len(payload) > max_bytes:
        raise ValueError(f"图片超过 {max_bytes // (1024 * 1024)}MB，无法保存")

    cache_dir = runtime_paths.child_dir("ai-image-cache")
    suffix = _extension_from_mime(mime_type)
    stem = _safe_stem(filename)
    target = _unique_path(cache_dir / f"{stem}-{_compact(job_uid)[:8] or 'job'}-{uuid4().hex[:8]}{suffix}")
    try:
        target.write_bytes(payload)
        _validate_downloaded_image(target)
    except Exception:
        if target.exists():
            target.unlink()
        raise
    return {"ok": True, "job_uid": job_uid, "mime_type": mime_type, "path": str(target)}


def copy_assets_to_directory(
    assets: list[Mapping[str, Any]],
    directory: str | Path,
    *,
    downloader: Callable[[str, Path], None] = _default_downloader,
) -> list[str]:
    target_dir = Path(directory).expanduser()
    target_dir.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    for asset in assets or []:
        source_url = _compact(asset.get("url"))
        source_path = _compact(asset.get("path"))
        if source_url.startswith("http://") or source_url.startswith("https://"):
            suffix = _extension_from_url(source_url)
            target = _unique_path(target_dir / f"result-{len(copied) + 1:02d}{suffix}")
            downloader(source_url, target)
            copied.append(str(target))
            continue
        source = Path(source_path).expanduser()
        if not source_path or not source.is_file():
            continue
        target = _unique_path(target_dir / source.name)
        shutil.copy2(source, target)
        copied.append(str(target))
    return copied
