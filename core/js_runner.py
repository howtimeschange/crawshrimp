"""
JS 注入执行器
特性：超时控制 / 错误捕获 / 分页支持 / 多阶段重入支持
"""
import base64
import asyncio
import hashlib
import inspect
import json
import logging
import mimetypes
import re
import secrets
import shutil
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.request import Request, build_opener, urlopen, ProxyHandler

import websockets

from core.models import JSResult

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 60
MAX_TIMEOUT = 120
MAX_PAGES = 1000
MAX_PHASES = 9999
NAVIGATION_ERROR_MARKERS = (
    "Inspected target navigated or closed",
    "Cannot find context with specified id",
    "Promise was collected",
    "Execution context was destroyed",
)
WASH_CARE_FIELDS = ("washing", "bleaching", "drying", "ironing", "dryCleaning")
WASH_CARE_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
WASH_CARE_TEMU_SYMBOL_OPTIONS = {
    "washing": [
        (1, "W12", "maximum temperature 95 ℃, normal process", "最高洗涤温度95℃ 常规程序"),
        (2, "W11", "maximum temperature 70 ℃, normal process", "最高洗涤温度70℃ 常规程序"),
        (3, "W09", "maximum temperature 60 ℃, normal process", "最高洗涤温度60℃ 常规程序"),
        (4, "W10", "maximum temperature 60 ℃, mild process", "最高洗涤温度60℃ 缓和程序"),
        (5, "W13", "maximum temperature 50 ℃, normal process", "最高洗涤温度50℃ 常规程序"),
        (6, "W14", "maximum temperature 50 ℃, mild process", "最高洗涤温度50℃ 缓和程序"),
        (7, "W06", "maximum temperature 40 ℃, normal process", "最高洗涤温度40℃ 常规程序"),
        (8, "W07", "maximum temperature 40 ℃, mild process", "最高洗涤温度40℃ 缓和程序"),
        (9, "W08", "maximum temperature 40 ℃, very mild process", "最高洗涤温度40℃ 非常缓和程序"),
        (10, "W03", "maximum temperature 30 ℃, normal process", "最高洗涤温度30℃ 常规程序"),
        (11, "W04", "maximum temperature 30 ℃, mild process", "最高洗涤温度30℃ 缓和程序"),
        (12, "W05", "maximum temperature 30 ℃, very mild process", "最高洗涤温度30℃ 非常缓和程序"),
        (13, "W01", "hand wash, maximum temperature 40 ℃", "最高洗涤温度 40°C 手洗"),
        (15, "W15", "hand wash, ambient temperature", "常温 手洗"),
        (14, "W02", "do not wash", "不可水洗"),
    ],
    "bleaching": [
        (1, "B01", "any bleaching agent allowed", "允许任何漂白剂"),
        (2, "B02", "only oxygen /non-chlorine bleach allowed", "仅允许氧漂/非氯漂"),
        (3, "B03", "do not bleach", "不可漂白"),
    ],
    "drying": [
        (1, "D09", "tumble drying possible, normal temperature, exhaust temperature max. 80 ℃", "可使用翻转干燥，常规温度，排气口最高温度80°C"),
        (2, "D10", "tumble drying possible, normal temperature, exhaust temperature max. 60 ℃", "可使用翻转干燥，较低温度，排气口最高温度60°C"),
        (3, "D11", "do not tumble dry", "不可翻转干燥"),
        (4, "D01", "line drying", "悬挂晾干"),
        (5, "D05", "line drying in the shade", "在阴凉处悬挂晾干"),
        (6, "D02", "drip line drying", "悬挂滴干"),
        (7, "D06", "drip line drying in the shade", "在阴凉处悬挂滴干"),
        (8, "D03", "flat drying", "平摊晾干"),
        (9, "D07", "flat drying in the shade", "在阴凉处平摊晾干"),
        (10, "D04", "drip flat drying", "平摊滴干"),
        (11, "D08", "drip flat drying in the shade", "在阴凉处平摊滴干"),
    ],
    "ironing": [
        (1, "I05", "iron at a maximal sole plate temperature of 210 ℃", "熨烫底板最高温度210℃"),
        (2, "I06", "iron at a maximal sole plate temperature of 160 ℃", "熨斗底板最高温度160 ℃"),
        (3, "I07", "iron at a maximal sole plate temperature of 120 ℃, steam iron may cause irreversible damage", "熨斗底板最高温度120℃，蒸汽熨烫可能造成不可回复的损伤"),
        (4, "I04", "do not iron", "不可熨烫"),
        (5, "I08", "iron at a maximum sole plate temperature of 120 ℃ without steam", "熨斗底板最高温度120℃，不可蒸汽熨烫"),
    ],
    "dryCleaning": [
        (1, "P01", "professional dry cleaning in tetrachloroethene, DBM and F solvents, normal process", "P类专业干洗，常规程序"),
        (2, "P02", "professional dry cleaning in tetrachloroethene, DBM and F solvents, mild process", "P类专业干洗，缓和程序"),
        (21, "P10", "professional dry cleaning in tetrachloroethene, DBM and F solvents, very mild process", "P类专业干洗，非常缓和程序"),
        (3, "P03", "professional dry cleaning in hydrocarbons, normal process", "F类专业干洗，常规程序"),
        (4, "P04", "professional dry cleaning in hydrocarbons, mild process", "F类专业干洗，缓和程序"),
        (5, "P05", "do not dry clean, No professional dry cleaning allowed", "不可干洗，不可专业干洗"),
        (6, "P06", "professional wet cleaning, normal process", "专业湿洗，常规湿洗"),
        (7, "P07", "professional wet cleaning, mild process", "专业湿洗，缓和湿洗"),
        (8, "P08", "professional wet cleaning, very mild process", "专业湿洗，非常缓和湿洗"),
        (9, "P09", "do not wet clean, no professional wet cleaning allowed", "不可湿洗，不可专业湿洗"),
    ],
}
WASH_CARE_LZH_MANUAL_CALIBRATION_EXAMPLES = [
    ("washing", 13, "W01", "最高洗涤温度 40°C 手洗 / hand wash, maximum temperature 40 ℃"),
    ("washing", 10, "W03", "最高洗涤温度30℃ 常规程序 / maximum temperature 30 ℃, normal process"),
    ("bleaching", 3, "B03", "不可漂白 / do not bleach"),
    ("drying", 4, "D01", "悬挂晾干 / line drying"),
    ("drying", 8, "D03", "平摊晾干 / flat drying"),
    ("drying", 5, "D05", "在阴凉处悬挂晾干 / line drying in the shade"),
    (
        "ironing",
        3,
        "I07",
        "熨斗底板最高温度120℃，蒸汽熨烫可能造成不可回复的损伤 / "
        "iron at a maximal sole plate temperature of 120 ℃, steam iron may cause irreversible damage",
    ),
    ("ironing", 4, "I04", "不可熨烫 / do not iron"),
    ("dryCleaning", 5, "P05", "不可干洗，不可专业干洗 / do not dry clean, No professional dry cleaning allowed"),
]


def _encode_request_url(url: str) -> str:
    raw_url = str(url or "")
    try:
        parts = urlsplit(raw_url)
    except Exception:
        return raw_url
    if not parts.scheme or not parts.netloc:
        return raw_url
    try:
        netloc = parts.netloc.encode("idna").decode("ascii")
    except Exception:
        netloc = parts.netloc
    return urlunsplit((
        parts.scheme,
        netloc,
        quote(parts.path, safe="/%"),
        quote(parts.query, safe="=&%/:;+?,"),
        quote(parts.fragment, safe="%/:;+?,"),
    ))


def _clean_runtime_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _wash_care_media_paths(items: list[dict]) -> list[Path]:
    paths: list[Path] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        raw_path = (
            item.get("path")
            or item.get("file")
            or item.get("filename")
            or item.get("target")
            or ""
        )
        path = Path(str(raw_path or "")).expanduser()
        if path.is_file() and path not in paths:
            paths.append(path)
    return paths


def _wash_care_calibration_prompt() -> str:
    lines = [
        "TEMU五类洗护符号枚举表，返回careSymbols时必须只使用这些数字值：",
    ]
    for field in WASH_CARE_FIELDS:
        option_text = "；".join(
            f"{value}={standard_id} {english} / {chinese}"
            for value, standard_id, english, chinese in WASH_CARE_TEMU_SYMBOL_OPTIONS[field]
        )
        lines.append(f"- {field}: {option_text}")
    lines.extend([
        "人工校准梳理-LZH0812 高频样例，看到同类商家/TEMU图标或字段时按这些值返回：",
        *(
            f"- {field}: {value}={standard_id} {text}"
            for field, value, standard_id, text in WASH_CARE_LZH_MANUAL_CALIBRATION_EXAMPLES
        ),
        "关键纠偏：drying=4是悬挂晾干/line drying；drying=8是平摊晾干/flat drying。",
        "关键纠偏：ironing=3是低温熨烫；ironing=4是不可熨烫/do not iron。",
        "如果某一类看不清，不要猜测；该字段返回null，并在uncertainFields中列出。",
    ])
    return "\n".join(lines)


def _coerce_wash_care_symbol_value(field: str, value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
        if not value or value.lower() in {"unknown", "unclear", "n/a", "na", "null", "none"}:
            return None
    try:
        number = int(value)
    except Exception:
        return None
    allowed = {option[0] for option in WASH_CARE_TEMU_SYMBOL_OPTIONS.get(field, [])}
    return number if number in allowed else None


def _care_symbols_from_wash_payload(payload: Any) -> dict:
    if not isinstance(payload, dict):
        return {}
    containers = [
        payload.get("careSymbols"),
        payload.get("temuCareSymbols"),
        payload.get("symbolValues"),
        payload,
    ]
    symbols: dict[str, int] = {}
    for container in containers:
        if not isinstance(container, dict):
            continue
        for field in WASH_CARE_FIELDS:
            if field in symbols:
                continue
            value = _coerce_wash_care_symbol_value(field, container.get(field))
            if value is not None:
                symbols[field] = value
    return symbols


def _instruction_from_wash_payload(payload: Any) -> str:
    if not isinstance(payload, dict):
        return ""
    direct = _clean_runtime_text(
        payload.get("instructionText")
        or payload.get("careInstructionText")
        or payload.get("washCareInstruction")
        or payload.get("洗涤说明")
        or ""
    )
    if direct:
        return direct
    parts = [
        _clean_runtime_text(payload.get(field) or payload.get(field.lower()) or "")
        for field in WASH_CARE_FIELDS
    ]
    parts = [part for part in parts if part and part.lower() not in {"unknown", "unclear", "n/a", "na"}]
    return "，".join(parts)


def _instruction_from_plain_text(text: str) -> str:
    normalized = (
        _clean_runtime_text(text)
        .replace("° C", "℃")
        .replace("°C", "℃")
        .replace("ºC", "℃")
    )
    if not normalized:
        return ""
    lower = normalized.lower()

    parts: list[str] = []
    if "do not wash" in lower or "不可水洗" in normalized:
        parts.append("不可水洗")
    elif "hand wash" in lower or "手洗" in normalized:
        parts.append("手洗")
    elif "30℃" in normalized or "30 ℃" in normalized:
        parts.append("30℃水洗")
    elif "40℃" in normalized or "40 ℃" in normalized:
        parts.append("40℃水洗")

    if "do not bleach" in lower or "不可漂白" in normalized:
        parts.append("不可漂白")

    if "flat drying" in lower or any(token in normalized for token in ("平摊", "平坦", "平放")):
        parts.append("平坦")
    elif "line drying in the shade" in lower or any(token in normalized for token in ("阴凉处悬挂", "阴干")):
        parts.append("阴凉处悬挂晾干")
    elif "line drying" in lower or any(token in normalized for token in ("悬挂晾干", "悬挂晾晒", "挂晾")):
        parts.append("悬挂晾晒")
    elif "do not tumble dry" in lower or "不可翻转干燥" in normalized:
        parts.append("不可翻转干燥")

    if "do not iron" in lower or "不可熨烫" in normalized:
        parts.append("不可熨烫")
    elif "iron" in lower or "熨烫" in normalized:
        parts.append("可熨烫")

    if "do not dry clean" in lower or "不可干洗" in normalized:
        parts.append("不可干洗")

    return "，".join(parts) if len(parts) >= 3 else ""


def _recognize_wash_care_media_sync(
    *,
    items: list[dict],
    artifact_dir: Path,
    model_id: str = "",
    fallback_model_ids: list[str] | None = None,
) -> dict:
    paths = _wash_care_media_paths(items)
    if not paths:
        return {"ok": False, "error": "未提供可识别的 SCM 洗唛附件本地路径", "items": []}

    images: list[str] = []
    text_chunks: list[str] = []
    errors: list[str] = []
    rendered_dir = artifact_dir / "scm-wash-attachment-rendered"

    for path in paths:
        suffix = path.suffix.lower()
        if suffix == ".pdf":
            try:
                from core import shenhui_pdf_screenshot

                text = shenhui_pdf_screenshot.extract_pdf_text(path)
                if text:
                    text_chunks.append(text)
                pages, render_error = shenhui_pdf_screenshot.render_pdf_pages_with_pymupdf_result(path, rendered_dir / path.stem)
                if not pages:
                    pages, quicklook_error = shenhui_pdf_screenshot.render_pdf_pages_with_quicklook_result(path, rendered_dir / f"{path.stem}-quicklook")
                    if render_error and quicklook_error:
                        errors.append(f"{path.name}: {render_error}; {quicklook_error}")
                images.extend(str(page) for page in pages[:3])
            except Exception as exc:
                errors.append(f"{path.name}: PDF处理失败 {exc}")
            continue

        guessed_type = mimetypes.guess_type(path.name)[0] or ""
        if suffix in WASH_CARE_IMAGE_SUFFIXES or guessed_type.startswith("image/"):
            images.append(str(path))
            continue

        try:
            text = path.read_text(encoding="utf-8", errors="replace")
            if text:
                text_chunks.append(text)
        except Exception as exc:
            errors.append(f"{path.name}: 不支持的附件格式 {suffix or 'unknown'} ({exc})")

    plain_text = "\n".join(text_chunks).strip()
    inferred_text = _instruction_from_plain_text(plain_text)
    prompt_context = plain_text[:4000]

    if images:
        try:
            from core import llm_gateway

            payload, route = llm_gateway.generate_multimodal_json(
                system_prompt=(
                    "你是服装洗唛洗护符号识别助手。只依据图片或PDF渲染页中可见的一组洗涤说明符号识别，"
                    "多个重复排列时只取其中一组。不要猜测看不清的符号。必须按给定TEMU枚举返回 JSON。"
                ),
                user_prompt=(
                    f"{_wash_care_calibration_prompt()}\n"
                    "识别洗唛附件中的洗涤说明，返回 JSON："
                    '{"instructionText":"手洗，不可漂白，平摊晾干，不可熨烫，不可干洗",'
                    '"careSymbols":{"washing":13,"bleaching":3,"drying":8,"ironing":4,"dryCleaning":5},'
                    '"washing":"hand wash, maximum temperature 40 ℃","bleaching":"do not bleach",'
                    '"drying":"flat drying","ironing":"do not iron","dryCleaning":"do not dry clean",'
                    '"uncertainFields":[],"confidence":0.0}。'
                    "instructionText 需要便于人工核查；careSymbols 必须按TEMU枚举填写。"
                    f"\nPDF可提取文字片段：{prompt_context}"
                ),
                image_inputs=images[:5],
                model_id=str(model_id or ""),
                fallback_model_ids=fallback_model_ids or [],
            )
            instruction = _instruction_from_wash_payload(payload) or inferred_text
            care_symbols = _care_symbols_from_wash_payload(payload)
            if instruction or care_symbols:
                return {
                    "ok": True,
                    "source": "scm_wash_attachment_multimodal",
                    "instructionText": instruction,
                    "careSymbols": care_symbols,
                    "payload": payload if isinstance(payload, dict) else {},
                    "model": route.model_id,
                    "images": images[:5],
                    "items": [str(path) for path in paths],
                    "errors": errors,
                }
            errors.append("多模态模型未返回可映射的洗护说明")
        except Exception as exc:
            errors.append(f"多模态识别失败: {_clean_runtime_text(exc)}")

    if inferred_text:
        return {
            "ok": True,
            "source": "scm_wash_attachment_text_rules",
            "instructionText": inferred_text,
            "items": [str(path) for path in paths],
            "images": images[:5],
            "errors": errors,
        }

    return {
        "ok": False,
        "error": "；".join(errors) or "未识别到完整洗护说明",
        "items": [str(path) for path in paths],
        "images": images[:5],
    }


class RunAbortedError(RuntimeError):
    def __init__(self, reason: str = "任务已停止", partial_data: Optional[List[dict]] = None):
        super().__init__(reason)
        self.reason = reason
        self.partial_data = list(partial_data or [])


class JSRunner:
    def __init__(
        self,
        ws_url: str,
        timeout: int = DEFAULT_TIMEOUT,
        tab_id: Optional[str] = None,
        tab_url: Optional[str] = None,
        artifact_dir: Optional[str] = None,
    ):
        self.ws_url = ws_url
        self.timeout = min(timeout, MAX_TIMEOUT)
        self.tab_id = tab_id
        self.tab_url = tab_url
        self._msg_id = 0
        self._file_payload_cache: dict[str, dict] = {}
        self._page_file_cache_keys: set[str] = set()
        self.artifact_dir = Path(artifact_dir).expanduser() if artifact_dir else Path(tempfile.mkdtemp(prefix="crawshrimp-runtime-"))
        self.artifact_dir.mkdir(parents=True, exist_ok=True)
        self.runtime_output_files: list[str] = []
        self._click_download_ws = None
        self.last_runtime_shared: dict = {}
        self.last_runtime_page: int = 0
        self.last_runtime_phase: str = ""

    def _next_id(self) -> int:
        self._msg_id += 1
        return self._msg_id

    async def _bridge_call_async(self, async_name: str, sync_name: str, *args):
        from core.cdp_bridge import get_bridge

        bridge = get_bridge()
        async_method = getattr(bridge, async_name, None)
        if async_method:
            return await async_method(*args)
        return await asyncio.to_thread(getattr(bridge, sync_name), *args)

    async def _bridge_get_tabs(self) -> list:
        return await self._bridge_call_async("get_tabs_async", "get_tabs")

    async def _bridge_get_tab(self, tab_id: str) -> Optional[dict]:
        return await self._bridge_call_async("get_tab_async", "get_tab", tab_id)

    async def _bridge_new_tab(self, url: str) -> dict:
        return await self._bridge_call_async("new_tab_async", "new_tab", url)

    async def _bridge_close_tab(self, tab_id: str) -> None:
        return await self._bridge_call_async("close_tab_async", "close_tab", tab_id)

    async def _evaluate_raw(self, expression: str, user_gesture: bool = False) -> dict:
        msg_id = self._next_id()
        payload = json.dumps({
            "id": msg_id,
            "method": "Runtime.evaluate",
            "params": {
                "expression": expression,
                "awaitPromise": True,
                "returnByValue": True,
                "timeout": self.timeout * 1000,
                "userGesture": bool(user_gesture),
            }
        })
        async with websockets.connect(self.ws_url, max_size=50 * 1024 * 1024, proxy=None) as ws:
            await ws.send(payload)
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=self.timeout + 5)
                msg = json.loads(raw)
                if msg.get("id") == msg_id:
                    return msg

    async def _cdp_send(self, method: str, params: dict) -> dict:
        """直接通过 CDP WebSocket 发送任意命令（非 Runtime.evaluate）"""
        msg_id = self._next_id()
        payload = json.dumps({"id": msg_id, "method": method, "params": params})
        async with websockets.connect(self.ws_url, max_size=50 * 1024 * 1024, proxy=None) as ws:
            await ws.send(payload)
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=10)
                msg = json.loads(raw)
                if msg.get("id") == msg_id:
                    return msg

    async def evaluate_cdp_target(
        self,
        expression: str,
        *,
        target_url_contains: Optional[list[str]] = None,
        target_url_regex: Optional[str] = None,
        target_types: Optional[list[str]] = None,
        user_gesture: bool = False,
        open_url_if_missing: str = "",
        open_wait_ms: int = 0,
    ) -> dict:
        """Evaluate JavaScript in another CDP target, such as a cross-origin iframe."""
        expression = str(expression or "").strip()
        if not expression:
            return {"ok": False, "error": "cdp_target_eval 缺少 expression"}

        contains = [
            str(item or "").strip()
            for item in (target_url_contains or [])
            if str(item or "").strip()
        ]
        type_set = {
            str(item or "").strip()
            for item in (target_types or ["page", "iframe"])
            if str(item or "").strip()
        }
        regex = None
        if target_url_regex:
            try:
                regex = re.compile(str(target_url_regex))
            except re.error as e:
                return {"ok": False, "error": f"cdp_target_eval target_url_regex 无效: {e}"}

        async def matching_tabs() -> tuple[list, list[str]]:
            tabs = await self._bridge_get_tabs()
            matches = []
            for tab in tabs or []:
                tab_url = str(tab.get("url") or "")
                tab_type = str(tab.get("type") or "")
                if type_set and tab_type not in type_set:
                    continue
                if contains and not all(part in tab_url for part in contains):
                    continue
                if regex and not regex.search(tab_url):
                    continue
                if not tab.get("webSocketDebuggerUrl"):
                    continue
                matches.append(tab)
            sample_urls = [
                str(tab.get("url") or "")[:180]
                for tab in (tabs or [])
                if str(tab.get("type") or "") in (type_set or {"page", "iframe"})
            ][:8]
            return matches, sample_urls

        matches, sample_urls = await matching_tabs()
        opened_target = False
        opened_url = str(open_url_if_missing or "").strip()
        if not matches and opened_url and (not type_set or "page" in type_set):
            try:
                from core.cdp_bridge import get_bridge

                bridge = get_bridge()
                target = await self._bridge_new_tab(opened_url)
                target_ws = str(target.get("webSocketDebuggerUrl") or bridge.get_tab_ws_url(target) or "")
                if not target_ws:
                    return {
                        "ok": False,
                        "error": "cdp_target_eval 打开的标签页缺少 webSocketDebuggerUrl",
                        "opened_url": opened_url,
                    }
                target = {
                    **target,
                    "webSocketDebuggerUrl": target_ws,
                    "url": str(target.get("url") or opened_url),
                    "type": str(target.get("type") or "page"),
                }
                matches = [target]
                opened_target = True
                if open_wait_ms and open_wait_ms > 0:
                    await asyncio.sleep(min(float(open_wait_ms) / 1000.0, 10.0))
            except Exception as e:
                return {
                    "ok": False,
                    "error": f"cdp_target_eval 打开目标页失败: {e}",
                    "target_url_contains": contains,
                    "target_url_regex": str(target_url_regex or ""),
                    "open_url_if_missing": opened_url,
                    "sample_urls": sample_urls,
                }

        if not matches:
            return {
                "ok": False,
                "error": "cdp_target_eval 未找到匹配 target",
                "target_url_contains": contains,
                "target_url_regex": str(target_url_regex or ""),
                "open_url_if_missing": opened_url,
                "sample_urls": sample_urls,
            }

        target = matches[0]
        target_runner = JSRunner(
            str(target.get("webSocketDebuggerUrl") or ""),
            timeout=self.timeout,
            tab_id=str(target.get("id") or ""),
            tab_url=str(target.get("url") or ""),
            artifact_dir=str(self.artifact_dir),
        )
        try:
            response = await target_runner._evaluate_raw(expression, user_gesture=user_gesture)
        except Exception as e:
            return {
                "ok": False,
                "error": str(e),
                "opened_target": opened_target,
                "target": {
                    "id": target.get("id"),
                    "url": target.get("url"),
                    "type": target.get("type"),
                    "title": target.get("title"),
                },
            }

        if "error" in response:
            return {
                "ok": False,
                "error": str(response.get("error") or "Runtime.evaluate failed"),
                "opened_target": opened_target,
                "target": {
                    "id": target.get("id"),
                    "url": target.get("url"),
                    "type": target.get("type"),
                    "title": target.get("title"),
                },
            }
        if response.get("result", {}).get("exceptionDetails"):
            exception = response.get("result", {}).get("exceptionDetails") or {}
            return {
                "ok": False,
                "error": str(exception.get("text") or exception.get("exception", {}).get("description") or "Runtime exception"),
                "exception": exception,
                "opened_target": opened_target,
                "target": {
                    "id": target.get("id"),
                    "url": target.get("url"),
                    "type": target.get("type"),
                    "title": target.get("title"),
                },
            }

        result_payload = response.get("result", {}).get("result", {}) or {}
        value = result_payload.get("value")
        if value is None and "description" in result_payload:
            value = result_payload.get("description")
        return {
            "ok": True,
            "value": value,
            "opened_target": opened_target,
            "target": {
                "id": target.get("id"),
                "url": target.get("url"),
                "type": target.get("type"),
                "title": target.get("title"),
            },
        }

    async def navigate(self, url: str, wait_seconds: float = 2.0) -> JSResult:
        target_url = str(url or "").strip()
        if not target_url:
            return JSResult(success=False, error="导航 URL 为空")
        try:
            await self._cdp_send("Page.enable", {})
        except Exception:
            logger.debug("Page.enable failed before navigate", exc_info=True)
        try:
            response = await self._cdp_send("Page.navigate", {"url": target_url})
        except Exception as e:
            return JSResult(success=False, error=str(e))
        if "error" in response:
            return JSResult(success=False, error=str(response.get("error") or "Page.navigate failed"))
        if wait_seconds > 0:
            await asyncio.sleep(wait_seconds)
        try:
            await self._refresh_ws_url()
        except Exception:
            logger.debug("refresh ws url failed after navigate", exc_info=True)
        return JSResult(success=True, data=[], meta={"has_more": False})

    async def capture_screenshot(
        self,
        *,
        filename: str = "",
        label: str = "",
        full_page: bool = True,
        scroll_before_capture: bool = True,
        settle_ms: int = 800,
        scroll_step: int = 650,
        scroll_delay_ms: int = 120,
        scroll_rounds: int = 1,
        target_dir: str = "",
        target_relative_path: str = "",
        neutralize_fixed: bool = False,
    ) -> dict:
        """Capture the current CDP page as a PNG runtime artifact."""
        raw_filename = str(filename or "").strip() or "screenshot.png"
        if Path(raw_filename).suffix.lower() != ".png":
            raw_filename = f"{raw_filename}.png"
        relative_path = str(target_relative_path or "").strip()
        if relative_path and Path(relative_path).suffix.lower() != ".png":
            relative_path = f"{relative_path}.png"
        target_path = self._build_artifact_target_path(
            filename=raw_filename,
            target_dir=str(target_dir or "").strip(),
            target_relative_path=relative_path,
        )

        info: dict[str, Any] = {}
        try:
            async with websockets.connect(self.ws_url, max_size=80 * 1024 * 1024, proxy=None) as ws:
                await self._cdp_send_on_ws("Page.enable", {}, ws=ws, timeout=10)
                await self._cdp_send_on_ws("Runtime.enable", {}, ws=ws, timeout=10)
                await self._cdp_send_on_ws("Page.bringToFront", {}, ws=ws, timeout=10)

                settle = max(0, int(settle_ms or 0))
                step = max(100, int(scroll_step or 650))
                delay = max(0, int(scroll_delay_ms or 0))
                rounds = max(0, int(scroll_rounds or 0)) if scroll_before_capture else 0
                neutralize_fixed_js = "true" if neutralize_fixed else "false"
                cleanup_expression = (
                    "(() => {\n"
                    "  const style = document.getElementById('__crawshrimp_capture_neutralize_fixed__');\n"
                    "  if (style) style.remove();\n"
                    "  document.querySelectorAll('[data-crawshrimp-capture-neutralized=\"1\"]').forEach(el => {\n"
                    "    el.removeAttribute('data-crawshrimp-capture-neutralized');\n"
                    "  });\n"
                    "})()"
                )
                expression = (
                    "(async () => {\n"
                    "  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));\n"
                    f"  const rounds = {rounds};\n"
                    f"  const step = {step};\n"
                    f"  const delay = {delay};\n"
                    f"  const settle = {settle};\n"
                    f"  const neutralizeFixed = {neutralize_fixed_js};\n"
                    "  const cleanupCaptureStyle = () => {\n"
                    "    const style = document.getElementById('__crawshrimp_capture_neutralize_fixed__');\n"
                    "    if (style) style.remove();\n"
                    "    document.querySelectorAll('[data-crawshrimp-capture-neutralized=\"1\"]').forEach(el => {\n"
                    "      el.removeAttribute('data-crawshrimp-capture-neutralized');\n"
                    "    });\n"
                    "  };\n"
                    "  for (let round = 0; round < rounds; round += 1) {\n"
                    "    const maxY = Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0, window.innerHeight || 0);\n"
                    "    for (let y = 0; y <= maxY; y += step) {\n"
                    "      window.scrollTo(0, y);\n"
                    "      if (delay > 0) await sleep(delay);\n"
                    "    }\n"
                    "  }\n"
                    "  window.scrollTo(0, 0);\n"
                    "  if (settle > 0) await sleep(settle);\n"
                    "  let neutralizedFixedCount = 0;\n"
                    "  cleanupCaptureStyle();\n"
                    "  if (neutralizeFixed) {\n"
                    "    const style = document.createElement('style');\n"
                    "    style.id = '__crawshrimp_capture_neutralize_fixed__';\n"
                    "    style.textContent = '[data-crawshrimp-capture-neutralized=\"1\"]{position:static!important;top:auto!important;right:auto!important;bottom:auto!important;left:auto!important;transform:none!important;will-change:auto!important;}';\n"
                    "    document.head.appendChild(style);\n"
                    "    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);\n"
                    "    for (const el of Array.from(document.body?.querySelectorAll('*') || [])) {\n"
                    "      const computed = window.getComputedStyle(el);\n"
                    "      if (computed.position !== 'fixed' && computed.position !== 'sticky') continue;\n"
                    "      const rect = el.getBoundingClientRect();\n"
                    "      if (rect.width <= 0 || rect.height <= 0) continue;\n"
                    "      if ((rect.width * rect.height) > viewportArea * 0.95) continue;\n"
                    "      el.setAttribute('data-crawshrimp-capture-neutralized', '1');\n"
                    "      neutralizedFixedCount += 1;\n"
                    "    }\n"
                    "    window.scrollTo(0, 0);\n"
                    "    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));\n"
                    "    await sleep(Math.min(800, Math.max(250, settle)));\n"
                    "  }\n"
                    "  const width = Math.max(document.documentElement?.clientWidth || 0, document.body?.clientWidth || 0, window.innerWidth || 0, 1);\n"
                    "  const height = Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0, document.documentElement?.clientHeight || 0, window.innerHeight || 0, 1);\n"
                    "  return {\n"
                    "    width,\n"
                    "    height,\n"
                    "    devicePixelRatio: window.devicePixelRatio || 1,\n"
                    "    title: document.title || '',\n"
                    "    url: location.href || '',\n"
                    "    neutralizedFixedCount,\n"
                    "    textSample: String(document.body?.innerText || '').slice(0, 200),\n"
                    "  };\n"
                    "})()"
                )
                try:
                    eval_response = await self._cdp_send_on_ws(
                        "Runtime.evaluate",
                        {
                            "expression": expression,
                            "awaitPromise": True,
                            "returnByValue": True,
                            "timeout": max(1000, settle + (rounds * 30000)),
                        },
                        ws=ws,
                        timeout=max(15, (settle / 1000.0) + 30),
                    )
                    info = dict(
                        ((eval_response.get("result") or {}).get("result") or {}).get("value")
                        or {}
                    )

                    capture_params: dict[str, Any] = {
                        "format": "png",
                        "fromSurface": True,
                        "captureBeyondViewport": bool(full_page),
                    }
                    if full_page:
                        width = max(1, int(round(float(info.get("width") or 1))))
                        height = max(1, int(round(float(info.get("height") or 1))))
                        capture_params["clip"] = {
                            "x": 0,
                            "y": 0,
                            "width": width,
                            "height": height,
                            "scale": 1,
                        }

                    response = await self._cdp_send_on_ws(
                        "Page.captureScreenshot",
                        capture_params,
                        ws=ws,
                        timeout=60,
                    )
                    image_data = str((response.get("result") or {}).get("data") or "")
                    if not image_data:
                        raise RuntimeError("Page.captureScreenshot 未返回图片数据")
                finally:
                    if neutralize_fixed:
                        try:
                            await self._cdp_send_on_ws(
                                "Runtime.evaluate",
                                {
                                    "expression": cleanup_expression,
                                    "awaitPromise": True,
                                    "returnByValue": True,
                                },
                                ws=ws,
                                timeout=10,
                            )
                        except Exception:
                            logger.debug("cleanup neutralized screenshot styles failed", exc_info=True)

            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_bytes(base64.b64decode(image_data))
            saved_path = str(target_path)
            if saved_path not in self.runtime_output_files:
                self.runtime_output_files.append(saved_path)

            item = {
                "success": True,
                "label": str(label or raw_filename),
                "filename": target_path.name,
                "path": saved_path,
                "bytes": target_path.stat().st_size,
                "width": info.get("width"),
                "height": info.get("height"),
                "devicePixelRatio": info.get("devicePixelRatio"),
                "pageTitle": info.get("title") or "",
                "pageUrl": info.get("url") or "",
            }
            return {"ok": True, "items": [item], "info": info}
        except Exception as e:
            item = {
                "success": False,
                "label": str(label or raw_filename),
                "filename": Path(raw_filename).name,
                "path": str(target_path),
                "error": str(e),
                "pageTitle": info.get("title") or "",
                "pageUrl": info.get("url") or "",
            }
            return {"ok": False, "items": [item], "info": info, "error": str(e)}

    async def recognize_wash_care_media(
        self,
        items: list[dict],
        *,
        model_id: str = "",
        fallback_model_ids: Optional[list[str]] = None,
    ) -> dict:
        """Recognize one SCM wash-care instruction set from downloaded local media."""
        return await asyncio.to_thread(
            _recognize_wash_care_media_sync,
            items=items,
            artifact_dir=self.artifact_dir,
            model_id=model_id,
            fallback_model_ids=fallback_model_ids or [],
        )

    def _host_ocr_filename(self, item: dict, index: int) -> str:
        raw = (
            (item or {}).get("filename")
            or (item or {}).get("label")
            or self._derive_url_filename(str((item or {}).get("url") or ""), "")
            or f"ocr-image-{index + 1}.jpg"
        )
        name = self._sanitize_artifact_filename(str(raw), f"ocr-image-{index + 1}.jpg")
        if not Path(name).suffix:
            name = f"{name}.jpg"
        return name

    async def recognize_ocr_images(
        self,
        items: list[dict],
        *,
        lang: str = "chi_sim",
        strict: bool = False,
        timeout_seconds: int = 30,
        download_timeout_seconds: int = 30,
        retry_attempts: int = 1,
        use_browser_session: bool = False,
    ) -> dict:
        """Download remote images in the host process and run local Tesseract OCR."""
        normalized_items = [dict(item or {}) for item in (items or []) if isinstance(item, dict)]
        if not normalized_items:
            return {"ok": False, "error": "recognize_ocr_images 缺少图片列表", "items": []}

        status: dict[str, Any] = {}
        try:
            from core import ocr_service

            status = ocr_service.project_tesseract_status()
            if not status.get("available"):
                return {
                    "ok": False,
                    "error": "宿主端 OCR 不可用：未找到 tesseract.js 或 Node 运行时",
                    "items": [],
                    "runtime": status,
                }
        except Exception as exc:
            return {
                "ok": False,
                "error": f"宿主端 OCR 初始化失败: {_clean_runtime_text(exc)}",
                "items": [],
                "runtime": status,
            }

        ocr_dir = self.artifact_dir / "host-ocr" / uuid.uuid4().hex
        ocr_dir.mkdir(parents=True, exist_ok=True)
        results: list[dict] = []
        per_image_timeout = max(1, int(timeout_seconds or 30))
        download_timeout = max(1, int(download_timeout_seconds or 30))
        attempts = max(1, int(retry_attempts or 1))

        for index, item in enumerate(normalized_items):
            url = str(item.get("url") or item.get("src") or item.get("imageUrl") or "").strip()
            global_index = item.get("globalIndex", item.get("global_index", index))
            image_index = item.get("imageIndex", item.get("image_index"))
            result = {
                "globalIndex": global_index,
                "imageIndex": image_index,
                "src": url,
                "url": url,
                "text": "",
                "confidence": 0,
            }
            if not url:
                result.update({"success": False, "error": "图片 URL 为空"})
                results.append(result)
                continue

            filename = self._host_ocr_filename(item, index)
            target_path = ocr_dir / filename
            download_item = {
                "url": url,
                "filename": filename,
                "label": str(item.get("label") or filename),
                "target_dir": str(ocr_dir),
                "retry_attempts": attempts,
                "timeout_seconds": download_timeout,
                "browser_session": bool(use_browser_session or item.get("browser_session") or item.get("browserSession")),
            }
            try:
                download = await self._download_url_item(
                    download_item,
                    default_retry_attempts=attempts,
                    default_timeout_seconds=download_timeout,
                )
            except Exception as exc:
                download = {
                    "success": False,
                    "path": str(target_path),
                    "error": f"下载异常: {_clean_runtime_text(exc)}",
                }

            result["download"] = {
                key: value
                for key, value in (download or {}).items()
                if key in {"success", "path", "filename", "url", "status", "error", "bytes", "contentType", "attempts", "browserSession"}
            }
            if not download.get("success"):
                result.update({
                    "success": False,
                    "error": str(download.get("error") or "图片下载失败"),
                })
                results.append(result)
                continue

            image_path = Path(str(download.get("path") or target_path)).expanduser()
            try:
                recognized = await asyncio.to_thread(
                    ocr_service.recognize_image_with_tesseract_js,
                    image_path,
                    lang=str(lang or "chi_sim"),
                    timeout_seconds=per_image_timeout,
                )
                result.update({
                    "success": True,
                    "text": _clean_runtime_text(recognized.get("text") or ""),
                    "confidence": float(recognized.get("confidence") or 0),
                    "path": str(image_path),
                })
            except Exception as exc:
                result.update({
                    "success": False,
                    "error": f"OCR识别失败: {_clean_runtime_text(exc)}",
                    "path": str(image_path),
                })
            results.append(result)

        ok = all(bool(item.get("success")) for item in results) if strict else any(
            bool(item.get("success")) for item in results
        )
        payload = {
            "ok": ok,
            "engine": "tesseract.js-host",
            "lang": str(lang or "chi_sim"),
            "scanned": len([item for item in results if item.get("success")]),
            "items": results,
            "results": results,
            "runtime": status,
        }
        if not ok:
            first_error = next((item.get("error") for item in results if item.get("error")), "")
            payload["error"] = first_error or "宿主端 OCR 未识别到任何图片"
            if strict:
                raise RuntimeError(str(payload["error"]))
        return payload

    async def cdp_mouse_click(self, x: float, y: float, delay_ms: int = 50) -> None:
        """用 CDP Input.dispatchMouseEvent 在真实坐标上执行鼠标点击。
        这能触发 React 合成事件，而 JS dispatchEvent 无法做到。
        """
        try:
            await self._cdp_send("Page.bringToFront", {})
        except Exception:
            logger.debug("Page.bringToFront failed before cdp_mouse_click", exc_info=True)
        for evt_type in ("mouseMoved", "mousePressed", "mouseReleased"):
            params: dict = {"type": evt_type, "x": x, "y": y, "modifiers": 0}
            if evt_type == "mouseMoved":
                params.update({"button": "none", "clickCount": 0})
            elif evt_type == "mousePressed":
                params.update({"button": "left", "clickCount": 1, "buttons": 1})
            else:
                params.update({"button": "left", "clickCount": 1, "buttons": 0})
            await self._cdp_send("Input.dispatchMouseEvent", params)
        await asyncio.sleep(delay_ms / 1000.0)

    async def cdp_mouse_move(self, x: float, y: float, delay_ms: int = 50) -> None:
        """用 CDP 移动鼠标但不点击，用于 hover 级联菜单。"""
        try:
            await self._cdp_send("Page.bringToFront", {})
        except Exception:
            logger.debug("Page.bringToFront failed before cdp_mouse_move", exc_info=True)
        await self._cdp_send("Input.dispatchMouseEvent", {
            "type": "mouseMoved",
            "x": x,
            "y": y,
            "button": "none",
            "clickCount": 0,
            "modifiers": 0,
        })
        await asyncio.sleep(delay_ms / 1000.0)

    def _resolve_local_file(self, raw_path: str) -> Path:
        path = Path(str(raw_path or "")).expanduser()
        if not path.is_absolute():
            path = path.resolve()
        if not path.exists() or not path.is_file():
            raise FileNotFoundError(f"文件不存在：{path}")
        return path

    def _build_file_payload(self, raw_path: str) -> dict:
        path = self._resolve_local_file(raw_path)
        cache_key = str(path)
        cached = self._file_payload_cache.get(cache_key)
        stat = path.stat()
        version = f"{stat.st_size}:{stat.st_mtime_ns}"
        if cached and cached.get("version") == version:
            return cached

        digest = hashlib.sha1(f"{path}:{version}".encode("utf-8")).hexdigest()[:20]
        payload = {
            "path": str(path),
            "version": version,
            "cache_key": f"file:{digest}",
            "name": path.name,
            "mime": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
            "b64": base64.b64encode(path.read_bytes()).decode("ascii"),
        }
        self._file_payload_cache[cache_key] = payload
        return payload

    def _prepare_safe_three_four_images(self, items: list[dict]) -> dict:
        try:
            from PIL import Image, ImageFilter, ImageOps
        except Exception as e:
            return {"ok": False, "items": [], "error": f"prepare_image_files 需要 Pillow: {e}"}

        target_width = 750
        target_height = 1000
        output_dir = self.artifact_dir / "prepared-images"
        output_dir.mkdir(parents=True, exist_ok=True)
        results: list[dict] = []
        for index, item in enumerate(items or []):
            raw_path = str((item or {}).get("path") or (item or {}).get("file") or "").strip()
            if not raw_path:
                results.append({"success": False, "error": "缺少图片路径", "index": index})
                continue
            try:
                source = self._resolve_local_file(raw_path)
                image = Image.open(source)
                image = ImageOps.exif_transpose(image).convert("RGB")
                source_width, source_height = image.size
                contain_scale = min(target_width / source_width, target_height / source_height)
                draw_width = max(1, round(source_width * contain_scale))
                draw_height = max(1, round(source_height * contain_scale))
                offset_x = round((target_width - draw_width) / 2)
                offset_y = round((target_height - draw_height) / 2)

                cover_scale = max(target_width / source_width, target_height / source_height)
                cover_width = max(1, round(source_width * cover_scale))
                cover_height = max(1, round(source_height * cover_scale))
                background = image.resize((cover_width, cover_height), Image.Resampling.LANCZOS)
                left = round((cover_width - target_width) / 2)
                top = round((cover_height - target_height) / 2)
                background = background.crop((left, top, left + target_width, top + target_height))
                background = background.filter(ImageFilter.GaussianBlur(radius=18))
                overlay = Image.new("RGB", (target_width, target_height), (255, 255, 255))
                background = Image.blend(background, overlay, 0.16)

                foreground = image.resize((draw_width, draw_height), Image.Resampling.LANCZOS)
                background.paste(foreground, (offset_x, offset_y))
                digest = hashlib.sha1(f"{source}:{source.stat().st_size}:{source.stat().st_mtime_ns}".encode("utf-8")).hexdigest()[:12]
                output_path = output_dir / f"{source.stem[:48]}-{digest}-3x4-safe.jpg"
                background.save(output_path, format="JPEG", quality=92, optimize=True)
                output_bytes = output_path.read_bytes()
                saved_path = str(output_path)
                if saved_path not in self.runtime_output_files:
                    self.runtime_output_files.append(saved_path)
                source_ratio = source_width / max(source_height, 1)
                results.append({
                    "success": True,
                    "index": index,
                    "sourcePath": str(source),
                    "path": saved_path,
                    "name": output_path.name,
                    "mime": mimetypes.guess_type(output_path.name)[0] or "image/jpeg",
                    "size": len(output_bytes),
                    "dataUrl": "data:image/jpeg;base64," + base64.b64encode(output_bytes).decode("ascii"),
                    "width": target_width,
                    "height": target_height,
                    "sourceWidth": source_width,
                    "sourceHeight": source_height,
                    "cropStatus": "matched" if abs(source_ratio - 0.75) < 0.01 else "contain-with-soft-background",
                    "preservesFullSubject": True,
                    "drawWidth": draw_width,
                    "drawHeight": draw_height,
                    "offsetX": offset_x,
                    "offsetY": offset_y,
                })
            except Exception as e:
                results.append({"success": False, "index": index, "sourcePath": raw_path, "error": str(e)})
        return {"ok": all(item.get("success") for item in results), "items": results}

    def _build_file_inject_expression(self, items: list[dict], seed_payloads: list[dict]) -> str:
        seed = {
            item["cache_key"]: {
                "name": item["name"],
                "mime": item["mime"],
                "b64": item["b64"],
            }
            for item in seed_payloads
        }
        return (
            "(() => {\n"
            "  try {\n"
            "    if (typeof DataTransfer === 'undefined') {\n"
            "      return { success: false, error: '当前页面环境不支持 DataTransfer 文件注入' };\n"
            "    }\n"
            "    window.__CRAWSHRIMP_FILE_CACHE__ = window.__CRAWSHRIMP_FILE_CACHE__ || Object.create(null);\n"
            f"    const seed = {json.dumps(seed, ensure_ascii=False)};\n"
            "    for (const [key, meta] of Object.entries(seed)) {\n"
            "      if (!window.__CRAWSHRIMP_FILE_CACHE__[key]) {\n"
            "        window.__CRAWSHRIMP_FILE_CACHE__[key] = meta;\n"
            "      }\n"
            "    }\n"
            "    const items = " + json.dumps(items, ensure_ascii=False) + ";\n"
            "    const decode = (b64) => {\n"
            "      const binary = atob(String(b64 || ''));\n"
            "      const bytes = new Uint8Array(binary.length);\n"
            "      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);\n"
            "      return bytes;\n"
            "    };\n"
            "    const results = [];\n"
            "    for (const item of items) {\n"
            "      const input = document.querySelector(item.selector);\n"
            "      if (!input) {\n"
            "        return { success: false, error: `文件输入不存在: ${item.selector}` };\n"
            "      }\n"
            "      const dt = new DataTransfer();\n"
            "      for (const cacheKey of item.cache_keys || []) {\n"
            "        const meta = window.__CRAWSHRIMP_FILE_CACHE__[cacheKey];\n"
            "        if (!meta) {\n"
            "          return { success: false, error: `文件缓存不存在: ${cacheKey}` };\n"
            "        }\n"
            "        const file = new File([decode(meta.b64)], meta.name || 'upload.bin', { type: meta.mime || 'application/octet-stream' });\n"
            "        dt.items.add(file);\n"
            "      }\n"
            "      input.files = dt.files;\n"
            "      if (!input.files || input.files.length !== dt.files.length) {\n"
            "        return { success: false, error: `文件注入后页面只识别到 ${input.files ? input.files.length : 0}/${dt.files.length} 个文件: ${item.selector}` };\n"
            "      }\n"
            "      input.dispatchEvent(new Event('input', { bubbles: true }));\n"
            "      input.dispatchEvent(new Event('change', { bubbles: true }));\n"
            "      results.push({ selector: item.selector, count: dt.files.length });\n"
            "    }\n"
            "    return { success: true, data: results, meta: { has_more: false } };\n"
            "  } catch (error) {\n"
            "    return { success: false, error: String(error?.message || error) };\n"
            "  }\n"
            "})()\n"
        )

    async def _inject_files_via_cdp(self, items: list[dict]) -> JSResult:
        normalized_items: list[dict] = []
        for item in items or []:
            selector = str(item.get("selector") or "").strip()
            raw_files = item.get("files") or []
            if not selector:
                return JSResult(success=False, error="inject_files 缺少 selector")
            if not isinstance(raw_files, list) or not raw_files:
                return JSResult(success=False, error=f"inject_files 缺少文件列表: {selector}")
            try:
                file_paths = [str(self._resolve_local_file(str(raw_path))) for raw_path in raw_files]
            except Exception as e:
                return JSResult(success=False, error=str(e))
            normalized_items.append({
                "selector": selector,
                "files": file_paths,
            })

        if not normalized_items:
            return JSResult(success=True, data=[], meta={"has_more": False})

        try:
            async with websockets.connect(
                self.ws_url,
                max_size=50 * 1024 * 1024,
                proxy=None,
                ping_interval=None,
            ) as ws:
                for method, params in (
                    ("Page.enable", {}),
                    ("DOM.enable", {}),
                    ("Runtime.enable", {}),
                    ("Page.bringToFront", {}),
                ):
                    response = await self._cdp_send_on_ws(method, params, ws=ws, timeout=10)
                    if response.get("error"):
                        return JSResult(success=False, error=json.dumps(response.get("error"), ensure_ascii=False))

                document_response = await self._cdp_send_on_ws(
                    "DOM.getDocument",
                    {"depth": -1, "pierce": True},
                    ws=ws,
                    timeout=10,
                )
                if document_response.get("error"):
                    return JSResult(success=False, error=json.dumps(document_response.get("error"), ensure_ascii=False))
                root_id = ((document_response.get("result") or {}).get("root") or {}).get("nodeId")
                if not root_id:
                    return JSResult(success=False, error="DOM.getDocument 未返回 root nodeId")

                results: list[dict] = []
                for item in normalized_items:
                    selector = item["selector"]
                    query_response = await self._cdp_send_on_ws(
                        "DOM.querySelector",
                        {"nodeId": root_id, "selector": selector},
                        ws=ws,
                        timeout=10,
                    )
                    if query_response.get("error"):
                        return JSResult(success=False, error=json.dumps(query_response.get("error"), ensure_ascii=False))
                    node_id = (query_response.get("result") or {}).get("nodeId")
                    if not node_id:
                        return JSResult(success=False, error=f"文件输入不存在: {selector}")

                    set_response = await self._cdp_send_on_ws(
                        "DOM.setFileInputFiles",
                        {"nodeId": node_id, "files": item["files"]},
                        ws=ws,
                        timeout=30,
                    )
                    if set_response.get("error"):
                        return JSResult(success=False, error=json.dumps(set_response.get("error"), ensure_ascii=False))
                    results.append({
                        "selector": selector,
                        "count": len(item["files"]),
                        "method": "DOM.setFileInputFiles",
                    })

                dispatch_expression = (
                    "(() => {\n"
                    "  try {\n"
                    f"    const items = {json.dumps(normalized_items, ensure_ascii=False)};\n"
                    "    const results = [];\n"
                    "    for (const item of items) {\n"
                    "      const input = document.querySelector(item.selector);\n"
                    "      if (!input) {\n"
                    "        return { success: false, error: `文件输入不存在: ${item.selector}` };\n"
                    "      }\n"
                    "      input.dispatchEvent(new Event('input', { bubbles: true }));\n"
                    "      input.dispatchEvent(new Event('change', { bubbles: true }));\n"
                    "      results.push({ selector: item.selector, count: item.files.length, method: 'DOM.setFileInputFiles' });\n"
                    "    }\n"
                    "    return { success: true, data: results, meta: { has_more: false } };\n"
                    "  } catch (error) {\n"
                    "    return { success: false, error: String(error?.message || error) };\n"
                    "  }\n"
                    "})()\n"
                )
                dispatch_response = await self._cdp_send_on_ws(
                    "Runtime.evaluate",
                    {
                        "expression": dispatch_expression,
                        "awaitPromise": True,
                        "returnByValue": True,
                        "timeout": min(self.timeout, 30) * 1000,
                    },
                    ws=ws,
                    timeout=min(self.timeout, 30) + 5,
                )
                if dispatch_response.get("error"):
                    return JSResult(success=False, error=json.dumps(dispatch_response.get("error"), ensure_ascii=False))
                payload = dispatch_response.get("result", {})
                exception = payload.get("exceptionDetails") or {}
                if exception:
                    description = (
                        str((exception.get("exception") or {}).get("description") or "").strip()
                        or str(exception.get("text") or "").strip()
                        or "文件输入事件派发失败"
                    )
                    return JSResult(success=False, error=description)
                value = (payload.get("result") or {}).get("value")
                if isinstance(value, dict):
                    return JSResult(
                        success=bool(value.get("success")),
                        data=value.get("data") if value.get("data") is not None else results,
                        meta=value.get("meta") or {"has_more": False},
                        error=value.get("error"),
                    )
                return JSResult(success=True, data=results, meta={"has_more": False})
        except Exception as e:
            return JSResult(success=False, error=str(e))

    async def inject_files(
        self,
        items: list[dict],
        retry_with_full_seed: bool = True,
    ) -> JSResult:
        cdp_result = await self._inject_files_via_cdp(items)
        if cdp_result.success:
            return cdp_result

        logger.info("CDP 原生文件注入失败，回退 DataTransfer 注入: %s", cdp_result.error or "unknown")

        normalized_items: list[dict] = []
        seed_payloads: list[dict] = []

        for item in items or []:
            selector = str(item.get("selector") or "").strip()
            raw_files = item.get("files") or []
            if not selector:
                return JSResult(success=False, error="inject_files 缺少 selector")
            if not isinstance(raw_files, list) or not raw_files:
                return JSResult(success=False, error=f"inject_files 缺少文件列表: {selector}")

            cache_keys = []
            for raw_path in raw_files:
                payload = self._build_file_payload(str(raw_path))
                cache_keys.append(payload["cache_key"])
                if payload["cache_key"] not in self._page_file_cache_keys:
                    seed_payloads.append(payload)

            normalized_items.append({
                "selector": selector,
                "cache_keys": cache_keys,
            })

        expression = self._build_file_inject_expression(normalized_items, seed_payloads)
        result = await self.evaluate_with_reconnect(expression, allow_navigation_retry=True)
        if result.success:
            for payload in seed_payloads:
                self._page_file_cache_keys.add(payload["cache_key"])
            return result

        missing_cache = "文件缓存不存在" in (result.error or "")
        if retry_with_full_seed and missing_cache:
            fallback_seed = [self._build_file_payload(path) for item in items or [] for path in (item.get("files") or [])]
            expression = self._build_file_inject_expression(normalized_items, fallback_seed)
            retry_result = await self.evaluate_with_reconnect(expression, allow_navigation_retry=True)
            if retry_result.success:
                for payload in fallback_seed:
                    self._page_file_cache_keys.add(payload["cache_key"])
            return retry_result

        return result

    async def _cdp_send_on_ws(
        self,
        method: str,
        params: dict,
        *,
        ws,
        timeout: float = 10.0,
        event_handler: Optional[Callable[[dict], None]] = None,
    ) -> dict:
        msg_id = self._next_id()
        await ws.send(json.dumps({
            "id": msg_id,
            "method": method,
            "params": params,
        }))

        while True:
            raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
            msg = json.loads(raw)
            if msg.get("id") == msg_id:
                return msg
            if event_handler is not None and isinstance(msg, dict):
                try:
                    event_handler(msg)
                except Exception:
                    logger.debug("file chooser event handler failed", exc_info=True)

    async def _upload_via_file_chooser_item(self, item: dict) -> dict:
        clicks = (item or {}).get("clicks") or []
        raw_files = (item or {}).get("files") or []
        label = str((item or {}).get("label") or "file_chooser_upload").strip() or "file_chooser_upload"
        timeout_ms = max(int((item or {}).get("timeout_ms") or 12000), 1000)
        settle_ms = max(int((item or {}).get("settle_ms") or 500), 0)

        if not clicks:
            return {
                "success": False,
                "label": label,
                "error": "file_chooser_upload 缺少 clicks",
            }
        if not isinstance(raw_files, list) or not raw_files:
            return {
                "success": False,
                "label": label,
                "error": "file_chooser_upload 缺少文件列表",
            }

        files = [str(self._resolve_local_file(path)) for path in raw_files]
        chooser_event: dict[str, Any] = {}

        def capture_event(message: dict) -> None:
            nonlocal chooser_event
            if message.get("method") == "Page.fileChooserOpened" and not chooser_event:
                chooser_event = dict(message.get("params") or {})

        async with websockets.connect(self.ws_url, max_size=50 * 1024 * 1024, proxy=None) as ws:
            await self._cdp_send_on_ws("Page.enable", {}, timeout=10, ws=ws, event_handler=capture_event)
            await self._cdp_send_on_ws("DOM.enable", {}, timeout=10, ws=ws, event_handler=capture_event)
            await self._cdp_send_on_ws("Runtime.enable", {}, timeout=10, ws=ws, event_handler=capture_event)
            await self._cdp_send_on_ws("Page.bringToFront", {}, timeout=10, ws=ws, event_handler=capture_event)
            await self._cdp_send_on_ws(
                "Page.setInterceptFileChooserDialog",
                {"enabled": True},
                timeout=10,
                ws=ws,
                event_handler=capture_event,
            )

            try:
                for click in clicks:
                    x = float(click["x"])
                    y = float(click["y"])
                    delay_ms = int(click.get("delay_ms", 120))
                    for evt_type in ("mouseMoved", "mousePressed", "mouseReleased"):
                        params: dict[str, Any] = {"type": evt_type, "x": x, "y": y, "modifiers": 0}
                        if evt_type == "mouseMoved":
                            params.update({"button": "none", "clickCount": 0})
                        elif evt_type == "mousePressed":
                            params.update({"button": "left", "clickCount": 1, "buttons": 1})
                        else:
                            params.update({"button": "left", "clickCount": 1, "buttons": 0})
                        await self._cdp_send_on_ws(
                            "Input.dispatchMouseEvent",
                            params,
                            timeout=10,
                            ws=ws,
                            event_handler=capture_event,
                        )
                    if delay_ms > 0:
                        await asyncio.sleep(delay_ms / 1000.0)

                deadline = time.monotonic() + (timeout_ms / 1000.0)
                while not chooser_event and time.monotonic() < deadline:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=0.25)
                    except asyncio.TimeoutError:
                        continue
                    capture_event(json.loads(raw))

                backend_node_id = int(chooser_event.get("backendNodeId") or 0)
                if backend_node_id <= 0:
                    return {
                        "success": False,
                        "label": label,
                        "error": "未捕获到原生文件选择器",
                    }

                response = await self._cdp_send_on_ws(
                    "DOM.setFileInputFiles",
                    {
                        "files": files,
                        "backendNodeId": backend_node_id,
                    },
                    timeout=10,
                    ws=ws,
                    event_handler=capture_event,
                )
                if "error" in response:
                    return {
                        "success": False,
                        "label": label,
                        "error": str(response.get("error") or "DOM.setFileInputFiles 失败"),
                    }

                if settle_ms > 0:
                    await asyncio.sleep(settle_ms / 1000.0)

                return {
                    "success": True,
                    "label": label,
                    "files": files,
                    "fileCount": len(files),
                    "mode": str(chooser_event.get("mode") or "").strip(),
                    "backendNodeId": backend_node_id,
                }
            finally:
                try:
                    await self._cdp_send_on_ws(
                        "Page.setInterceptFileChooserDialog",
                        {"enabled": False},
                        timeout=5,
                        ws=ws,
                        event_handler=capture_event,
                    )
                except Exception:
                    logger.debug("failed to disable file chooser interception", exc_info=True)

    async def upload_via_file_chooser(self, items: list[dict], strict: bool = False) -> dict:
        results: list[dict] = []
        for item in items or []:
            result = await self._upload_via_file_chooser_item(item or {})
            results.append(result)
            if strict and not result.get("success"):
                raise RuntimeError(str(result.get("error") or "file chooser upload failed"))
        return {
            "ok": all(bool(item.get("success")) for item in results) if results else True,
            "items": results,
        }

    def _sanitize_artifact_filename(self, raw_name: str, fallback: str = "download.bin") -> str:
        name = Path(str(raw_name or "")).name
        name = re.sub(r"[\x00-\x1f]+", "", name)
        name = re.sub(r'[\\/:*?"<>|]+', "_", name).strip(" .")
        return name or fallback

    def _derive_url_filename(self, source_url: str, fallback: str = "download.bin") -> str:
        try:
            candidate = Path(urlsplit(str(source_url or "")).path).name
        except Exception:
            candidate = ""
        return self._sanitize_artifact_filename(candidate or fallback, fallback)

    def _ensure_unique_artifact_path(self, path: Path) -> Path:
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

    def _ensure_unique_artifact_dir(self, path: Path) -> Path:
        if not path.exists():
            return path
        index = 2
        while True:
            candidate = path.with_name(f"{path.name}_{index}")
            if not candidate.exists():
                return candidate
            index += 1

    def _sanitize_artifact_relative_parts(self, raw_path: str, fallback: str = "download.bin") -> list[str]:
        parts = []
        for raw_part in str(raw_path or "").replace("\\", "/").split("/"):
            clean = self._sanitize_artifact_filename(raw_part, "")
            if clean and clean not in {".", ".."}:
                parts.append(clean)
        return parts or [self._sanitize_artifact_filename(fallback, fallback)]

    def _build_download_candidate_regex(self, source_url: str) -> Optional[re.Pattern[str]]:
        original_name = self._derive_url_filename(source_url, "")
        if not original_name:
            return None

        original_path = Path(original_name)
        stem = original_path.stem
        suffix = original_path.suffix
        if not stem:
            return None

        if suffix:
            pattern = rf"^{re.escape(stem)}(?: \(\d+\))?{re.escape(suffix)}$"
        else:
            pattern = rf"^{re.escape(original_name)}(?: \(\d+\))?$"
        return re.compile(pattern, re.IGNORECASE)

    def _build_download_extension_regex(self, filename: str = "", source_url: str = "") -> Optional[re.Pattern[str]]:
        raw_name = str(filename or "").strip() or self._derive_url_filename(source_url, "")
        suffix = Path(raw_name).suffix.lower()
        if not suffix:
            return None
        return re.compile(rf".+{re.escape(suffix)}$", re.IGNORECASE)

    async def _prepare_click_download(self, download_dir: Path) -> dict:
        download_dir.mkdir(parents=True, exist_ok=True)
        if self._click_download_ws is not None:
            await self._restore_click_download()
        ws = await websockets.connect(self.ws_url, max_size=50 * 1024 * 1024, proxy=None)
        self._click_download_ws = ws
        response = await self._cdp_send_on_ws(
            "Page.setDownloadBehavior",
            {
                "behavior": "allow",
                "downloadPath": str(download_dir),
            },
            ws=ws,
        )
        error = response.get("error") if isinstance(response, dict) else None
        if error:
            await ws.close()
            self._click_download_ws = None
            return {
                "configured": False,
                "method": "Page.setDownloadBehavior",
                "error": json.dumps(error, ensure_ascii=False),
            }
        return {
            "configured": True,
            "method": "Page.setDownloadBehavior",
            "downloadPath": str(download_dir),
        }

    async def _restore_click_download(self) -> None:
        ws = self._click_download_ws
        self._click_download_ws = None
        if ws is None:
            return
        try:
            await self._cdp_send_on_ws(
                "Page.setDownloadBehavior",
                {"behavior": "default"},
                ws=ws,
            )
        finally:
            await ws.close()

    def _validate_click_download(
        self,
        path: Path,
        item: dict,
        filename: str = "",
    ) -> tuple[bool, str, dict]:
        try:
            stat = path.stat()
            size = stat.st_size
        except OSError as exc:
            return False, f"下载文件无法读取: {exc}", {"bytes": 0}

        min_mtime_ns = self._runtime_file_min_mtime_ns(item or {})
        if min_mtime_ns and stat.st_mtime_ns < min_mtime_ns:
            return False, "文件早于本次任务启动时间", {
                "bytes": size,
                "mtimeNs": stat.st_mtime_ns,
                "minMtimeNs": min_mtime_ns,
            }

        min_bytes = int((item or {}).get("min_bytes") or (item or {}).get("minBytes") or 1)
        if size < max(min_bytes, 1):
            return False, f"下载文件小于 min_bytes: {size} < {max(min_bytes, 1)}", {"bytes": size}

        expected_size_raw = (item or {}).get("expected_size", (item or {}).get("expectedSize"))
        expected_size = int(expected_size_raw) if expected_size_raw not in (None, "") else 0
        if expected_size and size != expected_size:
            return False, f"下载文件大小不匹配: {size} != {expected_size}", {"bytes": size}

        raw_magic = (item or {}).get("expected_magic", (item or {}).get("expectedMagic"))
        if isinstance(raw_magic, str):
            expected_magic = raw_magic.encode("utf-8")
        elif isinstance(raw_magic, (bytes, bytearray)):
            expected_magic = bytes(raw_magic)
        else:
            expected_magic = b""

        expected_name = str(filename or "").strip() or path.name
        if not expected_magic and Path(expected_name).suffix.lower() == ".pdf":
            expected_magic = b"%PDF-"

        signature_validated = False
        if expected_magic:
            try:
                with path.open("rb") as handle:
                    actual_magic = handle.read(len(expected_magic))
            except OSError as exc:
                return False, f"下载文件签名无法读取: {exc}", {"bytes": size}
            if actual_magic != expected_magic:
                return False, "下载文件签名不匹配", {
                    "bytes": size,
                    "expectedMagic": expected_magic.decode("utf-8", "replace"),
                }
            signature_validated = True

        return True, "", {
            "bytes": size,
            "mtimeNs": stat.st_mtime_ns,
            "signatureValidated": signature_validated,
            "expectedMagic": expected_magic.decode("utf-8", "replace") if expected_magic else "",
        }

    def _runtime_file_min_mtime_ns(self, item: dict) -> int:
        raw = (
            item.get("not_before_ns")
            or item.get("notBeforeNs")
            or item.get("min_mtime_ns")
            or item.get("minMtimeNs")
        )
        if raw not in (None, ""):
            try:
                return max(0, int(float(raw)))
            except (TypeError, ValueError):
                return 0

        raw_ms = (
            item.get("not_before_ms")
            or item.get("notBeforeMs")
            or item.get("min_mtime_ms")
            or item.get("minMtimeMs")
        )
        if raw_ms not in (None, ""):
            try:
                return max(0, int(float(raw_ms) * 1_000_000))
            except (TypeError, ValueError):
                return 0

        raw_seconds = (
            item.get("not_before_epoch")
            or item.get("notBeforeEpoch")
            or item.get("min_mtime_epoch")
            or item.get("minMtimeEpoch")
        )
        if raw_seconds not in (None, ""):
            try:
                return max(0, int(float(raw_seconds) * 1_000_000_000))
            except (TypeError, ValueError):
                return 0

        raw_iso = (
            item.get("not_before_iso")
            or item.get("notBeforeIso")
            or item.get("not_before")
            or item.get("notBefore")
            or item.get("min_mtime_iso")
            or item.get("minMtimeIso")
        )
        text = str(raw_iso or "").strip()
        if not text:
            return 0
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.astimezone()
            else:
                parsed = parsed.astimezone(timezone.utc)
            return max(0, int(parsed.timestamp() * 1_000_000_000))
        except (TypeError, ValueError, OSError):
            return 0

    def _snapshot_download_state(
        self,
        directories: list[Path],
        name_pattern: Optional[re.Pattern[str]],
    ) -> dict[str, tuple[int, int]]:
        snapshot: dict[str, tuple[int, int]] = {}
        for directory in directories:
            if not directory.exists() or not directory.is_dir():
                continue
            for path in directory.iterdir():
                if not path.is_file() or path.name.endswith(".crdownload"):
                    continue
                if name_pattern and not name_pattern.match(path.name):
                    continue
                try:
                    stat = path.stat()
                except OSError:
                    continue
                snapshot[str(path)] = (stat.st_mtime_ns, stat.st_size)
        return snapshot

    def _find_new_downloaded_file(
        self,
        directories: list[Path],
        baseline: dict[str, tuple[int, int]],
        name_pattern: Optional[re.Pattern[str]],
        started_at_ns: int,
    ) -> Optional[Path]:
        newest: Optional[tuple[int, Path]] = None
        threshold_ns = max(started_at_ns - 2_000_000_000, 0)

        for directory in directories:
            if not directory.exists() or not directory.is_dir():
                continue
            for path in directory.iterdir():
                if not path.is_file() or path.name.endswith(".crdownload"):
                    continue
                if name_pattern and not name_pattern.match(path.name):
                    continue
                try:
                    stat = path.stat()
                except OSError:
                    continue
                if stat.st_size <= 0:
                    continue

                previous = baseline.get(str(path))
                if previous and stat.st_mtime_ns <= previous[0] and stat.st_size == previous[1]:
                    continue
                if stat.st_mtime_ns < threshold_ns:
                    continue
                if newest is None or stat.st_mtime_ns > newest[0]:
                    newest = (stat.st_mtime_ns, path)

        return newest[1] if newest else None

    def _blob_download_capture_install_expression(
        self,
        capture_id: str,
        expected_filename: str = "",
        expected_magic: str = "",
    ) -> str:
        capture_id_json = json.dumps(str(capture_id), ensure_ascii=False)
        expected_filename_json = json.dumps(str(expected_filename or ""), ensure_ascii=False)
        expected_magic_json = json.dumps(str(expected_magic or ""), ensure_ascii=False)
        return f"""
(() => {{
  const captureId = {capture_id_json};
  const expectedFilename = {expected_filename_json};
  const expectedMagic = {expected_magic_json};
  const state = window.__CRAWSHRIMP_BLOB_DOWNLOAD_CAPTURE__ = window.__CRAWSHRIMP_BLOB_DOWNLOAD_CAPTURE__ || {{
    captures: [],
    events: [],
  }};
  state.active = {{
    id: captureId,
    expectedFilename,
    expectedMagic,
    installedAt: new Date().toISOString(),
  }};
  const compact = value => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 500);
  const record = (type, payload = {{}}) => {{
    state.events.push({{ t: new Date().toISOString(), type, ...payload }});
    if (state.events.length > 100) state.events.splice(0, state.events.length - 100);
  }};
  const toBase64 = bytes => {{
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {{
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }}
    return btoa(binary);
  }};
  const suffixOf = value => {{
    const clean = String(value || '').split('?')[0].trim();
    const index = clean.lastIndexOf('.');
    return index >= 0 ? clean.slice(index).toLowerCase() : '';
  }};
  const shouldCapture = anchor => {{
    const active = state.active || {{}};
    if (!active.id) return false;
    const href = String(anchor?.href || '');
    if (!href.startsWith('blob:')) return false;
    const download = String(anchor?.download || '');
    const expectedSuffix = suffixOf(active.expectedFilename);
    if (expectedSuffix && suffixOf(download) === expectedSuffix) return true;
    if (String(active.expectedMagic || '') === '%PDF-' && /pdf/i.test(download || href)) return true;
    return !download;
  }};
  if (!window.__CRAWSHRIMP_BLOB_DOWNLOAD_CAPTURE_ORIGINALS__) {{
    window.__CRAWSHRIMP_BLOB_DOWNLOAD_CAPTURE_ORIGINALS__ = {{}};
  }}
  const originals = window.__CRAWSHRIMP_BLOB_DOWNLOAD_CAPTURE_ORIGINALS__;
  const patchVersion = 'jsrunner-anchor-dispatch-v1';
  if (originals.anchorDispatchEvent && state.dispatchPatchVersion !== patchVersion) {{
    window.HTMLAnchorElement.prototype.dispatchEvent = originals.anchorDispatchEvent;
    delete originals.anchorDispatchEvent;
  }}
  if (!originals.anchorDispatchEvent) {{
    originals.anchorDispatchEvent = window.HTMLAnchorElement.prototype.dispatchEvent;
    window.HTMLAnchorElement.prototype.dispatchEvent = function crawshrimpAnchorDispatchEvent(event) {{
      const eventType = String(event?.type || '');
      if (eventType === 'click' && shouldCapture(this)) {{
        const active = state.active || {{}};
        const capture = {{
          id: active.id,
          href: compact(this.href),
          download: compact(this.download),
          startedAt: new Date().toISOString(),
          ok: false,
          done: false,
          bytes: 0,
          type: '',
          magic: '',
          base64: '',
          error: '',
        }};
        state.captures.push(capture);
        record('anchor.dispatchEvent.capture-start', {{
          id: capture.id,
          href: capture.href,
          download: capture.download,
        }});
        fetch(this.href)
          .then(response => response.blob())
          .then(blob => blob.arrayBuffer().then(buffer => ({{ blob, buffer }})))
          .then(({{ blob, buffer }}) => {{
            const bytes = new Uint8Array(buffer);
            capture.bytes = bytes.length;
            capture.type = compact(blob.type);
            capture.magic = String.fromCharCode(...bytes.slice(0, 5));
            capture.base64 = toBase64(bytes);
            capture.ok = !active.expectedMagic || capture.magic === active.expectedMagic;
            capture.done = true;
            capture.finishedAt = new Date().toISOString();
            record('anchor.dispatchEvent.capture-done', {{
              id: capture.id,
              download: capture.download,
              bytes: capture.bytes,
              type: capture.type,
              magic: capture.magic,
              ok: capture.ok,
            }});
          }})
          .catch(error => {{
            capture.error = compact(error?.message || error);
            capture.done = true;
            capture.finishedAt = new Date().toISOString();
            record('anchor.dispatchEvent.capture-error', {{
              id: capture.id,
              download: capture.download,
              error: capture.error,
            }});
          }});
      }}
      return originals.anchorDispatchEvent.apply(this, arguments);
    }};
  }}
  state.dispatchPatchVersion = patchVersion;
  return {{
    success: true,
    data: [{{
      installed: true,
      captureId,
      expectedFilename,
      expectedMagic,
    }}],
  }};
}})()
""".strip()

    def _blob_download_capture_read_expression(
        self,
        capture_id: str,
        include_base64: bool = False,
    ) -> str:
        capture_id_json = json.dumps(str(capture_id), ensure_ascii=False)
        include_base64_json = "true" if include_base64 else "false"
        return f"""
(() => {{
  const captureId = {capture_id_json};
  const includeBase64 = {include_base64_json};
  const state = window.__CRAWSHRIMP_BLOB_DOWNLOAD_CAPTURE__ || {{}};
  const captures = Array.isArray(state.captures) ? state.captures : [];
  const capture = [...captures].reverse().find(item => item && item.id === captureId) || null;
  const clean = capture ? {{
    id: capture.id || '',
    href: capture.href || '',
    download: capture.download || '',
    startedAt: capture.startedAt || '',
    finishedAt: capture.finishedAt || '',
    ok: !!capture.ok,
    done: !!capture.done,
    bytes: Number(capture.bytes || 0),
    type: capture.type || '',
    magic: capture.magic || '',
    error: capture.error || '',
    base64: includeBase64 ? (capture.base64 || '') : '',
  }} : null;
  return {{
    success: true,
    data: [{{
      found: !!capture,
      capture: clean,
      eventCount: Array.isArray(state.events) ? state.events.length : 0,
    }}],
  }};
}})()
""".strip()

    async def _install_blob_download_capture(
        self,
        capture_id: str,
        expected_filename: str = "",
        expected_magic: str = "",
    ) -> dict:
        result = await self.evaluate_with_reconnect(
            self._blob_download_capture_install_expression(capture_id, expected_filename, expected_magic),
            allow_navigation_retry=True,
        )
        if not result.success:
            return {
                "installed": False,
                "captureId": capture_id,
                "error": str(result.error or "blob download capture install failed"),
            }
        if isinstance(result.data, list) and result.data and isinstance(result.data[0], dict):
            data = result.data[0]
        elif isinstance(result.data, dict):
            data = result.data
        else:
            data = {}
        return {
            "installed": bool(data.get("installed", True)),
            "captureId": capture_id,
            "expectedFilename": str(data.get("expectedFilename") or expected_filename or ""),
            "expectedMagic": str(data.get("expectedMagic") or expected_magic or ""),
        }

    async def _read_blob_download_capture(
        self,
        capture_id: str,
        *,
        include_base64: bool = False,
    ) -> dict:
        result = await self.evaluate_with_reconnect(
            self._blob_download_capture_read_expression(capture_id, include_base64=include_base64),
            allow_navigation_retry=True,
        )
        if not result.success:
            return {
                "found": False,
                "error": str(result.error or "blob download capture read failed"),
            }
        if isinstance(result.data, list) and result.data and isinstance(result.data[0], dict):
            return result.data[0]
        if isinstance(result.data, dict):
            return result.data
        return {"found": False}

    async def _download_page_blob_expression(
        self,
        expression: str,
        capture_dir: Path,
        filename: str = "",
    ) -> dict:
        result = await self.evaluate_with_reconnect(expression, allow_navigation_retry=True)
        if not result.success:
            return {
                "success": False,
                "error": str(result.error or "page blob expression failed"),
            }
        if isinstance(result.data, list) and result.data and isinstance(result.data[0], dict):
            data = result.data[0]
        elif isinstance(result.data, dict):
            data = result.data
        else:
            data = {}
        encoded = str(data.get("base64") or "")
        if not encoded:
            return {
                "success": False,
                "error": str(data.get("error") or "page blob expression did not return base64"),
                "pageBlob": {key: value for key, value in data.items() if key != "base64"},
            }
        try:
            payload = base64.b64decode(encoded)
        except Exception as exc:
            return {
                "success": False,
                "error": f"page blob base64 decode failed: {exc}",
                "pageBlob": {key: value for key, value in data.items() if key != "base64"},
            }
        raw_name = filename or str(data.get("filename") or data.get("download") or "page-blob-download.bin")
        captured_path = capture_dir / self._sanitize_artifact_filename(raw_name)
        captured_path.write_bytes(payload)
        return {
            "success": True,
            "path": str(captured_path),
            "pageBlob": {key: value for key, value in data.items() if key != "base64"},
        }

    def _build_artifact_target_path(
        self,
        filename: str = "",
        source_url: str = "",
        reuse_existing: bool = False,
        target_dir: str = "",
        target_relative_path: str = "",
    ) -> Path:
        raw_name = str(filename or "").strip() or self._derive_url_filename(source_url)
        clean_name = self._sanitize_artifact_filename(raw_name)
        source_suffix = ""
        if source_url:
            try:
                source_suffix = Path(urlsplit(source_url).path).suffix
            except Exception:
                source_suffix = ""
        root_dir = Path(str(target_dir or "")).expanduser() if str(target_dir or "").strip() else self.artifact_dir
        if target_relative_path:
            relative_parts = self._sanitize_artifact_relative_parts(target_relative_path, clean_name)
            if source_suffix and not Path(relative_parts[-1]).suffix:
                relative_parts[-1] = f"{relative_parts[-1]}{source_suffix}"
            target = root_dir.joinpath(*relative_parts)
        else:
            if source_suffix and not Path(clean_name).suffix:
                clean_name = f"{clean_name}{source_suffix}"
            target = root_dir / clean_name
        if reuse_existing and target.exists():
            return target
        return self._ensure_unique_artifact_path(target)

    def _merge_runtime_shared(self, shared: Optional[dict], shared_key: str, value: Any, append: bool = False) -> dict:
        merged = dict(shared or {})
        if not shared_key:
            return merged
        if not append:
            merged[shared_key] = value
            return merged

        existing = merged.get(shared_key)
        if isinstance(existing, list):
            base = list(existing)
        elif existing is None:
            base = []
        else:
            base = [existing]

        if isinstance(value, list):
            base.extend(value)
        else:
            base.append(value)
        merged[shared_key] = base
        return merged

    def check_runtime_files(self, items: list[dict]) -> dict:
        results: list[dict] = []
        for item in items or []:
            label = str((item or {}).get("label") or "").strip()
            filename = str((item or {}).get("filename") or "").strip()
            target_dir = str((item or {}).get("target_dir") or (item or {}).get("targetDir") or "").strip()
            target_relative_path = str(
                (item or {}).get("target_relative_path")
                or (item or {}).get("targetRelativePath")
                or (item or {}).get("relative_path")
                or (item or {}).get("relativePath")
                or ""
            ).strip()
            raw_path = str((item or {}).get("path") or "").strip()
            path = Path(raw_path).expanduser() if raw_path else self._build_artifact_target_path(
                filename=filename,
                reuse_existing=True,
                target_dir=target_dir,
                target_relative_path=target_relative_path,
            )

            result = {
                "success": False,
                "exists": path.is_file(),
                "label": label or filename or path.name,
                "filename": filename or path.name,
                "path": str(path),
            }
            if target_dir:
                result["target_dir"] = target_dir
            if target_relative_path:
                result["target_relative_path"] = target_relative_path

            if not path.is_file():
                result["error"] = "文件不存在"
                results.append(result)
                continue

            valid, validation_error, validation = self._validate_click_download(
                path,
                item or {},
                filename or path.name,
            )
            result.update(validation)
            if valid:
                result["success"] = True
                result["skipped_existing"] = True
                saved_path = str(path)
                if saved_path not in self.runtime_output_files:
                    self.runtime_output_files.append(saved_path)
            else:
                result["error"] = validation_error
            results.append(result)

        return {
            "ok": all(item.get("success") for item in results) if results else False,
            "items": results,
        }

    def _request_matches(self, meta: dict, matches: Optional[list[dict]]) -> bool:
        if not matches:
            return True

        url = str(meta.get("url") or meta.get("responseUrl") or "")
        method = str(meta.get("method") or "").upper()
        mime_type = str(meta.get("mimeType") or "")
        body = str(meta.get("body") or "")
        status = meta.get("status")

        for matcher in matches:
            if not isinstance(matcher, dict):
                continue

            url_contains = str(matcher.get("url_contains") or "").strip()
            if url_contains and url_contains not in url:
                continue

            url_regex = str(matcher.get("url_regex") or "").strip()
            if url_regex:
                try:
                    if not re.search(url_regex, url):
                        continue
                except re.error:
                    continue

            expected_method = str(matcher.get("method") or "").strip().upper()
            if expected_method and method != expected_method:
                continue

            expected_status = matcher.get("status")
            if expected_status is not None:
                try:
                    if int(status) != int(expected_status):
                        continue
                except Exception:
                    continue

            mime_contains = str(matcher.get("mime_type_contains") or "").strip()
            if mime_contains and mime_contains not in mime_type:
                continue

            body_contains = str(matcher.get("body_contains") or "").strip()
            if body_contains and body_contains not in body:
                continue

            return True

        return False

    def _snapshot_captured_request(self, meta: dict) -> dict:
        snapshot = {
            "url": str(meta.get("url") or ""),
            "responseUrl": str(meta.get("responseUrl") or meta.get("url") or ""),
            "method": str(meta.get("method") or ""),
            "status": meta.get("status"),
            "mimeType": str(meta.get("mimeType") or ""),
            "postData": meta.get("postData"),
            "headers": dict(meta.get("headers") or {}),
            "responseHeaders": dict(meta.get("responseHeaders") or {}),
            "body": meta.get("body"),
            "base64Encoded": bool(meta.get("base64Encoded")),
        }
        if meta.get("error"):
            snapshot["error"] = str(meta.get("error"))
        return snapshot

    async def _capture_requests_on_ws(
        self,
        ws_url: str,
        *,
        clicks: Optional[list[dict]] = None,
        wheels: Optional[list[dict]] = None,
        url: str = "",
        matches: Optional[list[dict]] = None,
        timeout_ms: int = 8000,
        settle_ms: int = 1000,
        min_matches: int = 1,
        include_response_body: bool = False,
    ) -> dict:
        requests_by_id: dict[str, dict] = {}
        captured_request_ids: set[str] = set()
        matched_requests: list[dict] = []
        last_match_at = 0.0
        message_id = 0
        response_buffer: dict[int, dict] = {}

        async with websockets.connect(ws_url, max_size=50 * 1024 * 1024, proxy=None) as ws:
            async def process_event(message: dict) -> None:
                nonlocal last_match_at

                method = message.get("method")
                params = message.get("params", {})

                if method == "Network.requestWillBeSent":
                    request_id = str(params.get("requestId") or "")
                    request = params.get("request", {}) or {}
                    meta = requests_by_id.setdefault(request_id, {})
                    meta.update({
                        "requestId": request_id,
                        "url": request.get("url"),
                        "method": request.get("method"),
                        "postData": request.get("postData"),
                        "headers": request.get("headers", {}),
                    })
                    return

                if method == "Network.responseReceived":
                    request_id = str(params.get("requestId") or "")
                    response = params.get("response", {}) or {}
                    meta = requests_by_id.setdefault(request_id, {})
                    meta.update({
                        "requestId": request_id,
                        "status": response.get("status"),
                        "mimeType": response.get("mimeType"),
                        "responseHeaders": response.get("headers", {}),
                        "responseUrl": response.get("url"),
                    })
                    return

                if method == "Network.loadingFailed":
                    request_id = str(params.get("requestId") or "")
                    meta = requests_by_id.setdefault(request_id, {})
                    meta["error"] = str(params.get("errorText") or "Network.loadingFailed")
                    return

                if method != "Network.loadingFinished":
                    return

                request_id = str(params.get("requestId") or "")
                meta = requests_by_id.get(request_id) or {}
                if request_id in captured_request_ids or not meta.get("url") or not self._request_matches(meta, matches):
                    return

                if include_response_body:
                    try:
                        body_result = await send("Network.getResponseBody", {"requestId": request_id}, timeout_seconds=5.0)
                        body_payload = body_result.get("result", {}) if isinstance(body_result, dict) else {}
                        body = body_payload.get("body")
                        if isinstance(body, str) and len(body) > 2_000_000:
                            body = body[:2_000_000]
                        meta["body"] = body
                        meta["base64Encoded"] = bool(body_payload.get("base64Encoded"))
                    except Exception as e:
                        meta["error"] = str(e)

                captured_request_ids.add(request_id)
                matched_requests.append(self._snapshot_captured_request(meta))
                last_match_at = time.monotonic()

            async def send(method: str, params: Optional[dict] = None, timeout_seconds: float = 10.0) -> dict:
                nonlocal message_id
                message_id += 1
                current_id = message_id
                await ws.send(json.dumps({
                    "id": current_id,
                    "method": method,
                    "params": params or {},
                }))

                deadline = time.monotonic() + max(timeout_seconds, 0.1)
                while True:
                    buffered = response_buffer.pop(current_id, None)
                    if buffered is not None:
                        return buffered

                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise asyncio.TimeoutError(f"CDP command timeout: {method}")

                    raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                    message = json.loads(raw)
                    if message.get("id") == current_id:
                        return message
                    if message.get("id") is not None:
                        response_buffer[int(message["id"])] = message
                        continue
                    if message.get("method"):
                        await process_event(message)

            try:
                await send("Page.enable")
            except Exception:
                logger.debug("Page.enable failed during request capture", exc_info=True)
            await send("Network.enable", {"maxPostDataSize": 1024 * 1024})

            try:
                await send("Page.bringToFront")
            except Exception:
                logger.debug("Page.bringToFront failed during request capture", exc_info=True)

            if url:
                await send("Page.navigate", {"url": str(url)})
            elif clicks:
                await asyncio.sleep(0.3)
                for click in clicks:
                    x = float(click["x"])
                    y = float(click["y"])
                    delay_ms = int(click.get("delay_ms", 80))
                    for evt_type in ("mouseMoved", "mousePressed", "mouseReleased"):
                        params = {"type": evt_type, "x": x, "y": y, "modifiers": 0}
                        if evt_type == "mouseMoved":
                            params.update({"button": "none", "clickCount": 0})
                        elif evt_type == "mousePressed":
                            params.update({"button": "left", "clickCount": 1, "buttons": 1})
                        else:
                            params.update({"button": "left", "clickCount": 1, "buttons": 0})
                        await send("Input.dispatchMouseEvent", params)
                    await asyncio.sleep(delay_ms / 1000.0)
            elif wheels:
                await asyncio.sleep(0.3)
                for wheel in wheels:
                    x = float(wheel["x"])
                    y = float(wheel["y"])
                    delta_x = float(wheel.get("delta_x", wheel.get("deltaX", 0)) or 0)
                    delta_y = float(wheel.get("delta_y", wheel.get("deltaY", 0)) or 0)
                    delay_ms = int(wheel.get("delay_ms", 80))
                    await send("Input.dispatchMouseEvent", {
                        "type": "mouseMoved",
                        "x": x,
                        "y": y,
                        "button": "none",
                        "clickCount": 0,
                        "modifiers": 0,
                    })
                    await send("Input.dispatchMouseEvent", {
                        "type": "mouseWheel",
                        "x": x,
                        "y": y,
                        "deltaX": delta_x,
                        "deltaY": delta_y,
                        "modifiers": 0,
                    })
                    await asyncio.sleep(delay_ms / 1000.0)

            deadline = time.monotonic() + max(timeout_ms, 1000) / 1000.0
            settle_seconds = max(settle_ms, 0) / 1000.0
            required_matches = max(int(min_matches or 0), 1) if matches else 0

            while time.monotonic() < deadline:
                if (
                    required_matches
                    and len(matched_requests) >= required_matches
                    and last_match_at
                    and time.monotonic() - last_match_at >= settle_seconds
                ):
                    break

                wait_timeout = min(1.0, max(0.05, deadline - time.monotonic()))
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=wait_timeout)
                except asyncio.TimeoutError:
                    continue

                message = json.loads(raw)
                if message.get("method"):
                    await process_event(message)
                elif message.get("id") is not None:
                    response_buffer[int(message["id"])] = message

        ok = len(matched_requests) >= required_matches if required_matches else True
        return {
            "ok": ok,
            "matches": matched_requests,
            "requestedUrl": str(url or ""),
            "clickTotal": len(clicks or []),
            "wheelTotal": len(wheels or []),
        }

    async def capture_click_requests(
        self,
        clicks: list[dict],
        *,
        matches: Optional[list[dict]] = None,
        timeout_ms: int = 8000,
        settle_ms: int = 1000,
        min_matches: int = 1,
        include_response_body: bool = False,
    ) -> dict:
        try:
            await self._refresh_ws_url()
        except Exception:
            logger.debug("refresh_ws_url skipped before capture_click_requests", exc_info=True)
        result = await self._capture_requests_on_ws(
            self.ws_url,
            clicks=clicks,
            matches=matches,
            timeout_ms=timeout_ms,
            settle_ms=settle_ms,
            min_matches=min_matches,
            include_response_body=include_response_body,
        )
        result["mode"] = "click"
        return result

    async def capture_wheel_requests(
        self,
        wheels: list[dict],
        *,
        matches: Optional[list[dict]] = None,
        timeout_ms: int = 8000,
        settle_ms: int = 1000,
        min_matches: int = 1,
        include_response_body: bool = False,
    ) -> dict:
        try:
            await self._refresh_ws_url()
        except Exception:
            logger.debug("refresh_ws_url skipped before capture_wheel_requests", exc_info=True)
        result = await self._capture_requests_on_ws(
            self.ws_url,
            wheels=wheels,
            matches=matches,
            timeout_ms=timeout_ms,
            settle_ms=settle_ms,
            min_matches=min_matches,
            include_response_body=include_response_body,
        )
        result["mode"] = "wheel"
        return result

    async def capture_passive_requests(
        self,
        *,
        matches: Optional[list[dict]] = None,
        timeout_ms: int = 5000,
        settle_ms: int = 800,
        include_response_body: bool = False,
    ) -> dict:
        try:
            await self._refresh_ws_url()
        except Exception:
            logger.debug("refresh_ws_url skipped before capture_passive_requests", exc_info=True)
        result = await self._capture_requests_on_ws(
            self.ws_url,
            matches=matches,
            timeout_ms=timeout_ms,
            settle_ms=settle_ms,
            min_matches=0,
            include_response_body=include_response_body,
        )
        result["mode"] = "passive"
        return result

    async def capture_url_requests(
        self,
        url: str,
        *,
        matches: Optional[list[dict]] = None,
        timeout_ms: int = 12000,
        settle_ms: int = 1000,
        min_matches: int = 1,
        include_response_body: bool = False,
    ) -> dict:
        from core.cdp_bridge import get_bridge

        bridge = get_bridge()
        temp_tab = await self._bridge_new_tab("about:blank")
        temp_tab_id = str(temp_tab.get("id") or "")
        temp_ws_url = bridge.get_tab_ws_url(temp_tab)
        if not temp_ws_url:
            raise RuntimeError("capture_url_requests 打开的标签页缺少 webSocketDebuggerUrl")

        try:
            result = await self._capture_requests_on_ws(
                temp_ws_url,
                url=str(url or ""),
                matches=matches,
                timeout_ms=timeout_ms,
                settle_ms=settle_ms,
                min_matches=min_matches,
                include_response_body=include_response_body,
            )
            result["mode"] = "url"
            result["openedTabId"] = temp_tab_id
            return result
        finally:
            if temp_tab_id:
                try:
                    await self._bridge_close_tab(temp_tab_id)
                except Exception:
                    logger.debug("Failed to close temporary capture tab %s", temp_tab_id, exc_info=True)

    def _download_url_sync(
        self,
        url: str,
        target_path: Path,
        headers: Optional[dict[str, str]] = None,
        timeout: int = 60,
        no_proxy: bool = False,
        progress_callback: Optional[Callable[[dict], None]] = None,
        deadline: Optional[float] = None,
    ) -> dict:
        request = Request(_encode_request_url(url), headers=headers or {})
        partial_path = target_path.with_name(f"{target_path.name}.part")
        deadline = time.monotonic() + max(timeout, 1) if deadline is None else deadline

        def cleanup_partial() -> None:
            try:
                if partial_path.exists() and partial_path.is_file():
                    partial_path.unlink()
            except Exception:
                logger.debug("Failed to clean partial url download %s", partial_path, exc_info=True)

        def assert_deadline() -> None:
            if time.monotonic() >= float(deadline or 0):
                raise TimeoutError(f"下载超时: {url}（超过 {max(timeout, 1)}s）")

        try:
            opener = build_opener(ProxyHandler({})) if no_proxy else None
            open_url = opener.open if opener else urlopen
            assert_deadline()
            with open_url(request, timeout=max(timeout, 1)) as response:
                target_path.parent.mkdir(parents=True, exist_ok=True)
                cleanup_partial()
                with partial_path.open("wb") as handle:
                    bytes_written = 0
                    total_bytes = 0
                    try:
                        total_bytes = int(response.headers.get("Content-Length") or 0)
                    except Exception:
                        total_bytes = 0
                    while True:
                        assert_deadline()
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        handle.write(chunk)
                        bytes_written += len(chunk)
                        if progress_callback is not None:
                            progress_callback({
                                "bytes_downloaded": bytes_written,
                                "bytes_delta": len(chunk),
                                "bytes_total": total_bytes,
                            })
                        assert_deadline()
                partial_path.replace(target_path)
                content_type = response.headers.get("Content-Type", "")
                return {
                    "success": True,
                    "path": str(target_path),
                    "finalUrl": response.geturl(),
                    "contentType": content_type,
                    "bytes": target_path.stat().st_size if target_path.exists() else 0,
                    "contentLength": int(response.headers.get("Content-Length") or 0) if str(response.headers.get("Content-Length") or "").isdigit() else 0,
                }
        except HTTPError as e:
            cleanup_partial()
            body = ""
            try:
                body = e.read().decode("utf-8", "ignore")[:500]
            except Exception:
                body = ""
            return {
                "success": False,
                "error": f"HTTP {e.code}: {body or e.reason}",
                "status": e.code,
                "path": str(target_path),
            }
        except URLError as e:
            cleanup_partial()
            return {
                "success": False,
                "error": f"URL error: {e.reason}",
                "path": str(target_path),
            }
        except TimeoutError as e:
            cleanup_partial()
            return {
                "success": False,
                "error": str(e),
                "path": str(target_path),
            }
        except Exception as e:
            cleanup_partial()
            return {
                "success": False,
                "error": f"下载异常: {e}",
                "path": str(target_path),
            }

    async def _download_url_sync_with_deadline(
        self,
        url: str,
        target_path: Path,
        headers: dict[str, str],
        timeout_seconds: int,
        no_proxy: bool,
        progress_callback: Optional[Callable[[dict], None]],
    ) -> dict:
        deadline = time.monotonic() + timeout_seconds

        def run_download() -> dict:
            try:
                signature = inspect.signature(self._download_url_sync)
            except (TypeError, ValueError):
                signature = None
            if signature and "deadline" in signature.parameters:
                return self._download_url_sync(
                    url,
                    target_path,
                    headers,
                    timeout_seconds,
                    no_proxy,
                    progress_callback,
                    deadline,
                )
            return self._download_url_sync(
                url,
                target_path,
                headers,
                timeout_seconds,
                no_proxy,
                progress_callback,
            )

        return await asyncio.to_thread(run_download)

    def _url_download_requires_validation(self, item: dict) -> bool:
        if not isinstance(item, dict):
            return False
        return any(
            key in item
            for key in (
                "expected_magic",
                "expectedMagic",
                "expected_size",
                "expectedSize",
                "min_bytes",
                "minBytes",
                "validate_signature",
                "validateSignature",
            )
        )

    async def _download_via_browser_session(self, url: str, target_path: Path, timeout_ms: int = 15000) -> dict:
        from core.cdp_bridge import get_bridge

        bridge = get_bridge()
        temp_tab = await self._bridge_new_tab("about:blank")
        temp_tab_id = str(temp_tab.get("id") or "")
        temp_ws_url = bridge.get_tab_ws_url(temp_tab)
        if not temp_ws_url:
            raise RuntimeError("browser session download 打开的标签页缺少 webSocketDebuggerUrl")

        temp_download_dir = Path(tempfile.mkdtemp(prefix="browser-download-", dir=str(self.artifact_dir)))
        watch_dirs = [temp_download_dir]
        default_download_dir = Path.home() / "Downloads"
        if default_download_dir != temp_download_dir:
            watch_dirs.append(default_download_dir)
        name_pattern = self._build_download_candidate_regex(url)
        baseline = self._snapshot_download_state(watch_dirs, name_pattern)

        try:
            async with websockets.connect(temp_ws_url, max_size=50 * 1024 * 1024, proxy=None) as ws:
                message_id = 0

                async def send(method: str, params: Optional[dict] = None, timeout_seconds: float = 10.0) -> dict:
                    nonlocal message_id
                    message_id += 1
                    current_id = message_id
                    await ws.send(json.dumps({
                        "id": current_id,
                        "method": method,
                        "params": params or {},
                    }))
                    deadline = time.monotonic() + max(timeout_seconds, 0.1)
                    while True:
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            raise asyncio.TimeoutError(f"CDP command timeout: {method}")
                        raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                        message = json.loads(raw)
                        if message.get("id") == current_id:
                            return message

                await send("Page.enable")
                await send("Page.setDownloadBehavior", {
                    "behavior": "allow",
                    "downloadPath": str(temp_download_dir),
                })
                started_at_ns = time.time_ns()
                await send("Page.navigate", {"url": str(url)})

                deadline = time.monotonic() + max(timeout_ms, 5000) / 1000.0
                while time.monotonic() < deadline:
                    downloaded = self._find_new_downloaded_file(
                        watch_dirs,
                        baseline,
                        name_pattern,
                        started_at_ns,
                    )
                    if downloaded:
                        final_path = self._ensure_unique_artifact_path(target_path)
                        final_path.parent.mkdir(parents=True, exist_ok=True)
                        shutil.move(str(downloaded), str(final_path))
                        return {
                            "success": True,
                            "path": str(final_path),
                            "finalUrl": str(url),
                            "contentType": "",
                            "browserSession": True,
                        }
                    await asyncio.sleep(0.5)

            return {
                "success": False,
                "error": "浏览器会话下载超时",
                "path": str(target_path),
            }
        finally:
            if temp_tab_id:
                try:
                    await self._bridge_close_tab(temp_tab_id)
                except Exception:
                    logger.debug("Failed to close temporary browser download tab %s", temp_tab_id, exc_info=True)
            shutil.rmtree(temp_download_dir, ignore_errors=True)

    async def _list_page_tab_ids(self) -> set[str]:
        return {
            str(tab.get("id") or "")
            for tab in await self._bridge_get_tabs()
            if tab.get("type") == "page" and str(tab.get("id") or "")
        }

    async def _close_new_page_tabs(self, baseline_tab_ids: set[str]) -> None:
        for tab in await self._bridge_get_tabs():
            if tab.get("type") != "page":
                continue
            tab_id = str(tab.get("id") or "")
            if not tab_id or tab_id in baseline_tab_ids or tab_id == str(self.tab_id or ""):
                continue
            url = str(tab.get("url") or "")
            if "bill-download-with-detail" not in url and "agentseller" not in url and url != "about:blank":
                continue
            try:
                await self._bridge_close_tab(tab_id)
            except Exception:
                logger.debug("Failed to close click-opened tab %s", tab_id, exc_info=True)

    async def _close_transient_download_tabs(self) -> None:
        for tab in await self._bridge_get_tabs():
            if tab.get("type") != "page":
                continue
            tab_id = str(tab.get("id") or "")
            if not tab_id or tab_id == str(self.tab_id or ""):
                continue
            url = str(tab.get("url") or "")
            if (
                "link-agent-seller" not in url
                and "bill-download-with-detail" not in url
                and "/main/authentication" not in url
            ):
                continue
            try:
                await self._bridge_close_tab(tab_id)
            except Exception:
                logger.debug("Failed to close transient download tab %s", tab_id, exc_info=True)

    def _build_region_switch_confirm_expression(self) -> str:
        return """
(() => {
  try {
    const textOf = (el) => String(el?.innerText || el?.textContent || '').replace(/\\s+/g, ' ').trim();
    const isVisible = (el) => !!(el && typeof el.getClientRects === 'function' && el.getClientRects().length > 0);
    const bodyText = textOf(document.body);
    const modalPresent = /即将前往\\s*Seller\\s*Central/i.test(bodyText) || bodyText.includes('确认授权并前往');
    const url = String(location.href || '');
    const title = String(document.title || '');

    const clickLike = (el) => {
      if (!el) return false;
      try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
      try { el.focus?.(); } catch (e) {}
      try { el.click?.(); } catch (e) {}
      for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
        try {
          const Ctor = type.startsWith('pointer') && typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
          el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true }));
        } catch (e) {}
      }
      return true;
    };

    const resolveCheckboxNode = (node) => {
      if (!node) return null;
      if (node.matches?.('input[type="checkbox"], [role="checkbox"]')) return node;
      return node.querySelector?.('input[type="checkbox"], [role="checkbox"]') || null;
    };

    const isChecked = (node) => {
      const checkbox = resolveCheckboxNode(node) || node;
      if (!checkbox) return false;
      if (checkbox.matches?.('input[type="checkbox"]')) return !!checkbox.checked;
      const aria = String(checkbox.getAttribute?.('aria-checked') || '').toLowerCase();
      return aria === 'true' || aria === 'checked';
    };

    const resolveCheckboxTarget = (pattern) => {
      const selectors = 'label, div, span, p, li, section, article, [role="checkbox"], input[type="checkbox"]';
      const candidates = [...document.querySelectorAll(selectors)]
        .filter(isVisible)
        .filter((el) => pattern.test(textOf(el)));
      for (const candidate of candidates) {
        const checkbox = resolveCheckboxNode(candidate);
        if (checkbox) return checkbox;
        const label = candidate.closest?.('label');
        if (label) return label;
        if (candidate.matches?.('[role="checkbox"]')) return candidate;
      }
      return null;
    };

    const ensureChecked = (pattern) => {
      const target = resolveCheckboxTarget(pattern);
      if (!target) return { found: false, checked: false };
      if (!isChecked(target)) {
        clickLike(target);
      }
      if (!isChecked(target)) {
        const wrapper = target.closest?.('label, [role="checkbox"], div, span, p, li') || target.parentElement || target;
        if (wrapper && wrapper !== target) clickLike(wrapper);
      }
      return { found: true, checked: isChecked(target) };
    };

    if (!modalPresent) {
      return {
        success: true,
        data: [{
          handled: false,
          modalPresent: false,
          title,
          url,
        }],
        meta: { has_more: false },
      };
    }

    const share = ensureChecked(/账号ID.*店铺名称.*隐私政策/);
    const remind = ensureChecked(/今日不再提醒/);
    const confirmButton = [...document.querySelectorAll('button, a, [role="button"]')]
      .filter(isVisible)
      .find((el) => /确认授权并前往/.test(textOf(el)) || /确认授权/.test(textOf(el)));

    let confirmClicked = false;
    if (confirmButton) {
      confirmClicked = clickLike(confirmButton);
    }

    return {
      success: true,
      data: [{
        handled: true,
        modalPresent: true,
        title,
        url,
        shareChecked: !!share.checked,
        remindChecked: !!remind.checked,
        confirmClicked,
      }],
      meta: { has_more: false },
    };
  } catch (error) {
    return { success: false, error: String(error?.message || error) };
  }
})()
"""

    async def _handle_transient_download_tabs(self) -> list[dict]:
        actions: list[dict] = []
        expression = self._build_region_switch_confirm_expression()

        for tab in await self._bridge_get_tabs():
            if tab.get("type") != "page":
                continue
            tab_id = str(tab.get("id") or "")
            if not tab_id or tab_id == str(self.tab_id or ""):
                continue

            url = str(tab.get("url") or "")
            if (
                "link-agent-seller" not in url
                and "bill-download-with-detail" not in url
                and "/main/authentication" not in url
            ):
                continue

            ws_url = str(tab.get("webSocketDebuggerUrl") or "").strip()
            if not ws_url:
                continue

            tab_runner = JSRunner(
                ws_url,
                timeout=self.timeout,
                tab_id=tab_id,
                tab_url=url,
                artifact_dir=str(self.artifact_dir),
            )
            try:
                result = await tab_runner.evaluate_with_reconnect(expression, allow_navigation_retry=True)
            except Exception:
                logger.debug("Failed to inspect transient download tab %s", tab_id, exc_info=True)
                continue

            if not result.success or not result.data:
                continue

            payload = dict(result.data[0] or {})
            payload["tabId"] = tab_id
            if payload.get("handled") or payload.get("modalPresent"):
                actions.append(payload)

        return actions

    async def download_clicks(self, items: list[dict], strict: bool = False) -> dict:
        results: list[dict] = []
        system_downloads_dir = Path.home() / "Downloads"

        for item in items or []:
            clicks = (item or {}).get("clicks") or []
            filename = str((item or {}).get("filename") or "").strip()
            label = str((item or {}).get("label") or filename or "download").strip()
            expected_url = str((item or {}).get("expected_url") or (item or {}).get("url") or "").strip()
            timeout_ms = int((item or {}).get("timeout_ms") or max(self.timeout, 30) * 1000)
            regex_text = str((item or {}).get("expected_name_regex") or "").strip()
            page_blob_expression = str(
                (item or {}).get("page_blob_expression")
                or (item or {}).get("pageBlobExpression")
                or ""
            ).strip()
            capture_blob_download = bool(
                (item or {}).get("capture_blob_download")
                or (item or {}).get("captureBlobDownload")
                or (item or {}).get("capture_blob")
            )
            raw_magic = (item or {}).get("expected_magic", (item or {}).get("expectedMagic"))
            expected_magic_text = raw_magic.decode("utf-8", "replace") if isinstance(raw_magic, (bytes, bytearray)) else str(raw_magic or "")
            target_dir = str((item or {}).get("target_dir") or (item or {}).get("targetDir") or "").strip()
            target_relative_path = str(
                (item or {}).get("target_relative_path")
                or (item or {}).get("targetRelativePath")
                or (item or {}).get("relative_path")
                or (item or {}).get("relativePath")
                or ""
            ).strip()

            if regex_text:
                try:
                    name_pattern = re.compile(regex_text, re.IGNORECASE)
                except re.error:
                    name_pattern = None
            else:
                name_pattern = self._build_download_candidate_regex(expected_url or filename)
            if name_pattern is None:
                name_pattern = self._build_download_extension_regex(filename, expected_url)
            fallback_pattern = self._build_download_extension_regex(filename, expected_url)
            if fallback_pattern is None:
                fallback_pattern = re.compile(r".+\.xlsx$", re.IGNORECASE)

            if not clicks and page_blob_expression:
                capture_dir = Path(tempfile.mkdtemp(prefix="page-blob-download-", dir=str(self.artifact_dir)))
                page_blob_result = await self._download_page_blob_expression(page_blob_expression, capture_dir, filename)
                if page_blob_result.get("success") and page_blob_result.get("path"):
                    downloaded = Path(str(page_blob_result["path"]))
                    valid, validation_error, validation = self._validate_click_download(downloaded, item, filename)
                    if valid:
                        target_path = self._build_artifact_target_path(
                            filename=filename,
                            source_url=expected_url,
                            target_dir=target_dir,
                            target_relative_path=target_relative_path,
                        )
                        final_path = self._ensure_unique_artifact_path(target_path)
                        final_path.parent.mkdir(parents=True, exist_ok=True)
                        source_path = str(downloaded)
                        shutil.move(source_path, str(final_path))
                        saved_path = str(final_path)
                        if saved_path not in self.runtime_output_files:
                            self.runtime_output_files.append(saved_path)
                        results.append({
                            "success": True,
                            "label": label,
                            "filename": final_path.name,
                            "path": saved_path,
                            "url": expected_url,
                            "sourcePath": source_path,
                            "source": str((item or {}).get("source") or "page_blob_download"),
                            "matchedBy": "page_blob_expression",
                            "targetDir": target_dir,
                            "targetRelativePath": target_relative_path,
                            "pageBlob": page_blob_result.get("pageBlob") or {},
                            **validation,
                        })
                        shutil.rmtree(capture_dir, ignore_errors=True)
                        continue
                    result = {
                        "success": False,
                        "label": label,
                        "filename": filename,
                        "url": expected_url,
                        "error": validation_error,
                        "matchedBy": "page_blob_expression",
                        "pageBlob": page_blob_result.get("pageBlob") or {},
                        **validation,
                    }
                    results.append(result)
                    shutil.rmtree(capture_dir, ignore_errors=True)
                    if strict:
                        raise RuntimeError(result["error"])
                    continue
                result = {
                    "success": False,
                    "label": label,
                    "filename": filename,
                    "url": expected_url,
                    "error": str(page_blob_result.get("error") or "page blob download failed"),
                    "matchedBy": "page_blob_expression",
                    "pageBlob": page_blob_result.get("pageBlob") or {},
                }
                results.append(result)
                shutil.rmtree(capture_dir, ignore_errors=True)
                if strict:
                    raise RuntimeError(result["error"])
                continue

            if not clicks:
                result = {
                    "success": False,
                    "label": label,
                    "filename": filename,
                    "error": "download_clicks 缺少 clicks",
                }
                results.append(result)
                if strict:
                    raise RuntimeError(result["error"])
                continue

            await self._close_transient_download_tabs()
            capture_dir = Path(tempfile.mkdtemp(prefix="click-download-", dir=str(self.artifact_dir)))

            try:
                await self._refresh_ws_url()
            except Exception:
                logger.debug("refresh_ws_url skipped before download_clicks", exc_info=True)

            download_control = {
                "configured": False,
                "method": "Page.setDownloadBehavior",
                "downloadPath": str(capture_dir),
            }
            try:
                download_control = await self._prepare_click_download(capture_dir)
            except Exception as exc:
                download_control["error"] = str(exc)

            watch_dirs = [capture_dir]
            if (
                not download_control.get("configured")
                and system_downloads_dir.exists()
                and system_downloads_dir.is_dir()
            ):
                watch_dirs.append(system_downloads_dir)
            baseline = self._snapshot_download_state(watch_dirs, name_pattern)
            fallback_baseline = self._snapshot_download_state(watch_dirs, fallback_pattern)
            baseline_tab_ids = await self._list_page_tab_ids()
            started_at_ns = time.time_ns()
            transient_actions: list[dict] = []
            transient_action_keys: set[str] = set()
            matched_by = "expected_name"
            blob_capture_control: dict = {}
            blob_capture: dict = {}
            blob_capture_done = False
            if capture_blob_download:
                try:
                    blob_capture_id = f"{int(time.time() * 1000)}-{secrets.token_hex(4)}"
                    blob_capture_control = await self._install_blob_download_capture(
                        blob_capture_id,
                        expected_filename=filename,
                        expected_magic=expected_magic_text,
                    )
                except Exception as exc:
                    blob_capture_control = {
                        "installed": False,
                        "error": str(exc),
                    }

            for click in clicks:
                await self.cdp_mouse_click(
                    float(click["x"]),
                    float(click["y"]),
                    int(click.get("delay_ms", 120)),
                )

            deadline = time.monotonic() + max(timeout_ms, 5000) / 1000.0
            downloaded: Optional[Path] = None
            try:
                while time.monotonic() < deadline:
                    for action in await self._handle_transient_download_tabs():
                        action_key = json.dumps(action, ensure_ascii=False, sort_keys=True)
                        if action_key in transient_action_keys:
                            continue
                        transient_action_keys.add(action_key)
                        transient_actions.append(action)
                    downloaded = self._find_new_downloaded_file(
                        watch_dirs,
                        baseline,
                        name_pattern,
                        started_at_ns,
                    )
                    if not downloaded:
                        downloaded = self._find_new_downloaded_file(
                            watch_dirs,
                            fallback_baseline,
                            fallback_pattern,
                            started_at_ns,
                        )
                        if downloaded:
                            suffix = Path(downloaded).suffix.lower().lstrip(".") or "file"
                            matched_by = f"fallback_any_{suffix}"
                    if (
                        not downloaded
                        and capture_blob_download
                        and blob_capture_control.get("installed")
                        and blob_capture_control.get("captureId")
                        and not blob_capture_done
                    ):
                        try:
                            capture_state = await self._read_blob_download_capture(
                                str(blob_capture_control.get("captureId") or ""),
                                include_base64=False,
                            )
                        except Exception as exc:
                            capture_state = {"found": False, "error": str(exc)}
                        capture = capture_state.get("capture") if isinstance(capture_state, dict) else None
                        if isinstance(capture, dict) and capture.get("done"):
                            blob_capture_done = True
                            blob_capture = {key: value for key, value in capture.items() if key != "base64"}
                            if capture.get("ok"):
                                try:
                                    capture_payload = await self._read_blob_download_capture(
                                        str(blob_capture_control.get("captureId") or ""),
                                        include_base64=True,
                                    )
                                    full_capture = capture_payload.get("capture") if isinstance(capture_payload, dict) else None
                                    if isinstance(full_capture, dict):
                                        blob_capture = {key: value for key, value in full_capture.items() if key != "base64"}
                                        encoded = str(full_capture.get("base64") or "")
                                        if encoded:
                                            capture_bytes = base64.b64decode(encoded)
                                            captured_name = filename or str(full_capture.get("download") or "blob-download.bin")
                                            captured_path = capture_dir / self._sanitize_artifact_filename(captured_name)
                                            captured_path.write_bytes(capture_bytes)
                                            downloaded = captured_path
                                            matched_by = "captured_blob_anchor"
                                except Exception as exc:
                                    blob_capture = {
                                        **blob_capture,
                                        "error": str(exc),
                                    }
                    if downloaded:
                        break
                    await asyncio.sleep(0.5)
            finally:
                await self._close_new_page_tabs(baseline_tab_ids)
                try:
                    await self._restore_click_download()
                except Exception:
                    logger.debug("failed to restore default click download behavior", exc_info=True)

            if downloaded:
                valid, validation_error, validation = self._validate_click_download(downloaded, item, filename)
                if valid:
                    target_path = self._build_artifact_target_path(
                        filename=filename,
                        source_url=expected_url,
                        target_dir=target_dir,
                        target_relative_path=target_relative_path,
                    )
                    final_path = self._ensure_unique_artifact_path(target_path)
                    final_path.parent.mkdir(parents=True, exist_ok=True)
                    source_path = str(downloaded)
                    shutil.move(source_path, str(final_path))
                    saved_path = str(final_path)
                    if saved_path not in self.runtime_output_files:
                        self.runtime_output_files.append(saved_path)
                    results.append({
                        "success": True,
                        "label": label,
                        "filename": final_path.name,
                        "path": saved_path,
                        "url": expected_url,
                        "sourcePath": source_path,
                        "source": str((item or {}).get("source") or "browser_native_download"),
                        "matchedBy": matched_by,
                        "targetDir": target_dir,
                        "targetRelativePath": target_relative_path,
                        "browserDownloadControl": download_control,
                        "blobDownloadCapture": {
                            "control": blob_capture_control,
                            "capture": blob_capture,
                        } if blob_capture_control or blob_capture else {},
                        "transientActions": transient_actions,
                        **validation,
                    })
                    shutil.rmtree(capture_dir, ignore_errors=True)
                    continue

                result = {
                    "success": False,
                    "label": label,
                    "filename": filename,
                    "url": expected_url,
                    "error": validation_error,
                    "matchedBy": matched_by,
                    "browserDownloadControl": download_control,
                    "blobDownloadCapture": {
                        "control": blob_capture_control,
                        "capture": blob_capture,
                    } if blob_capture_control or blob_capture else {},
                    "transientActions": transient_actions,
                    **validation,
                }
                results.append(result)
                shutil.rmtree(capture_dir, ignore_errors=True)
                if strict:
                    raise RuntimeError(result["error"])
                continue

            result = {
                "success": False,
                "label": label,
                "filename": filename,
                "url": expected_url,
                "error": "点击后未检测到新下载文件",
                "browserDownloadControl": download_control,
                "blobDownloadCapture": {
                    "control": blob_capture_control,
                    "capture": blob_capture,
                } if blob_capture_control or blob_capture else {},
                "transientActions": transient_actions,
            }
            results.append(result)
            shutil.rmtree(capture_dir, ignore_errors=True)
            if strict:
                raise RuntimeError(result["error"])

        return {
            "ok": all(bool(item.get("success")) for item in results) if results else True,
            "items": results,
        }

    async def _download_url_item(
        self,
        item: dict,
        default_retry_attempts: int = 1,
        default_retry_delay_ms: int = 0,
        default_timeout_seconds: Optional[int] = None,
        progress_callback: Optional[Callable[[dict], None]] = None,
    ) -> dict:
        url = str((item or {}).get("url") or "").strip()
        filename = str((item or {}).get("filename") or "").strip()
        label = str((item or {}).get("label") or filename or self._derive_url_filename(url)).strip()
        browser_session = bool((item or {}).get("browser_session") or (item or {}).get("browserSession"))
        no_proxy = bool((item or {}).get("no_proxy") or (item or {}).get("noProxy"))
        headers_raw = (item or {}).get("headers") or {}
        headers = {
            str(key): str(value)
            for key, value in headers_raw.items()
            if str(key or "").strip() and value is not None
        } if isinstance(headers_raw, dict) else {}
        target_dir = str((item or {}).get("target_dir") or (item or {}).get("targetDir") or "").strip()
        target_relative_path = str(
            (item or {}).get("target_relative_path")
            or (item or {}).get("targetRelativePath")
            or (item or {}).get("relative_path")
            or (item or {}).get("relativePath")
            or ""
        ).strip()

        if not url:
            return {
                "success": False,
                "label": label or "download",
                "filename": filename,
                "error": "download_urls 缺少 url",
                "attempts": 0,
            }

        target_path = self._build_artifact_target_path(
            filename,
            url,
            reuse_existing=True,
            target_dir=target_dir,
            target_relative_path=target_relative_path,
        )
        if target_path.is_file() and target_path.stat().st_size > 0:
            saved_path = str(target_path)
            if saved_path not in self.runtime_output_files:
                self.runtime_output_files.append(saved_path)
            return {
                "success": True,
                "path": saved_path,
                "label": label or target_path.name,
                "filename": target_path.name,
                "url": url,
                "attempts": 0,
                "skipped_existing": True,
                "bytes": target_path.stat().st_size,
                "target_dir": target_dir,
                "target_relative_path": target_relative_path,
            }
        retry_attempts = int((item or {}).get("retry_attempts") or (item or {}).get("retryAttempts") or default_retry_attempts or 1)
        retry_attempts = max(retry_attempts, 1)
        retry_delay_ms = int((item or {}).get("retry_delay_ms") or (item or {}).get("retryDelayMs") or default_retry_delay_ms or 0)
        retry_delay_ms = max(retry_delay_ms, 0)
        item_timeout = (
            (item or {}).get("timeout_seconds")
            or (item or {}).get("timeoutSeconds")
            or (item or {}).get("timeout")
            or default_timeout_seconds
            or max(self.timeout, 30)
        )
        try:
            timeout_seconds = max(1, int(item_timeout))
        except Exception:
            timeout_seconds = max(self.timeout, 30)
        last_result: Optional[dict] = None

        for attempt in range(1, retry_attempts + 1):
            try:
                if browser_session:
                    result = await self._download_via_browser_session(
                        url,
                        target_path,
                        timeout_ms=timeout_seconds * 1000,
                    )
                else:
                    result = await self._download_url_sync_with_deadline(
                        url,
                        target_path,
                        headers,
                        timeout_seconds,
                        no_proxy,
                        progress_callback,
                    )
            except asyncio.TimeoutError:
                result = {
                    "success": False,
                    "path": str(target_path),
                    "error": f"下载超时: {label or url}（超过 {timeout_seconds}s）",
                }
            except Exception as e:
                result = {
                    "success": False,
                    "path": str(target_path),
                    "error": f"下载异常: {e}",
                }

            result["label"] = label or target_path.name
            result["filename"] = Path(str(result.get("path") or target_path)).name
            result["url"] = url
            result["attempts"] = attempt
            if target_dir:
                result["target_dir"] = target_dir
            if target_relative_path:
                result["target_relative_path"] = target_relative_path

            if result.get("success"):
                if self._url_download_requires_validation(item):
                    downloaded_path = Path(str(result.get("path") or target_path)).expanduser()
                    valid, validation_error, validation = self._validate_click_download(
                        downloaded_path,
                        item,
                        str(result.get("filename") or filename or downloaded_path.name),
                    )
                    result.update(validation)
                    if not valid:
                        result["success"] = False
                        result["error"] = validation_error
                        last_result = result
                        try:
                            if downloaded_path.exists() and downloaded_path.is_file():
                                downloaded_path.unlink()
                        except Exception:
                            logger.debug("Failed to clean invalid download %s", downloaded_path, exc_info=True)
                        if attempt < retry_attempts and retry_delay_ms > 0:
                            await asyncio.sleep(retry_delay_ms / 1000.0)
                        continue
                saved_path = str(result.get("path") or target_path)
                if saved_path not in self.runtime_output_files:
                    self.runtime_output_files.append(saved_path)
                return result

            last_result = result
            failed_path = Path(str(result.get("path") or target_path)).expanduser()
            try:
                if failed_path.exists() and failed_path.is_file():
                    failed_path.unlink()
            except Exception:
                logger.debug("Failed to clean partial download %s", failed_path, exc_info=True)

            if attempt < retry_attempts and retry_delay_ms > 0:
                await asyncio.sleep(retry_delay_ms / 1000.0)

        final_result = dict(last_result or {
            "success": False,
            "label": label or target_path.name,
            "filename": target_path.name,
            "url": url,
            "error": f"下载失败: {label or url}",
        })
        final_result["attempts"] = retry_attempts
        if retry_attempts > 1 and final_result.get("error"):
            final_result["error"] = f"{final_result['error']}（已重试 {retry_attempts} 次）"
        return final_result

    async def download_urls(
        self,
        items: list[dict],
        strict: bool = False,
        concurrency: int = 1,
        retry_attempts: int = 1,
        retry_delay_ms: int = 0,
        recovery_retry_attempts: int = 0,
        recovery_retry_delay_ms: int = 0,
        recovery_concurrency: int = 1,
        timeout_seconds: Optional[int] = None,
        progress_total: Optional[int] = None,
        progress_completed_offset: int = 0,
        progress_success_offset: int = 0,
        progress_failed_offset: int = 0,
        progress_callback: Optional[Callable[[dict], Awaitable[None]]] = None,
    ) -> dict:
        normalized_items = [dict(item or {}) for item in (items or [])]
        if not normalized_items:
            return {"ok": True, "items": []}

        target_dir_cache: dict[str, str] = {}
        for item in normalized_items:
            raw_target_dir = str(item.get("target_dir") or item.get("targetDir") or "").strip()
            if not raw_target_dir:
                continue
            use_unique_dir = bool(
                item.get("target_dir_unique")
                or item.get("targetDirUnique")
                or item.get("unique_target_dir")
                or item.get("uniqueTargetDir")
            )
            if use_unique_dir:
                cache_key = raw_target_dir
                if cache_key not in target_dir_cache:
                    target_root = self._ensure_unique_artifact_dir(Path(raw_target_dir).expanduser())
                    target_root.mkdir(parents=True, exist_ok=True)
                    target_dir_cache[cache_key] = str(target_root)
                item["target_dir"] = target_dir_cache[cache_key]
                item["targetDir"] = target_dir_cache[cache_key]
            else:
                Path(raw_target_dir).expanduser().mkdir(parents=True, exist_ok=True)

        concurrency = max(1, int(concurrency or 1))
        retry_attempts = max(1, int(retry_attempts or 1))
        retry_delay_ms = max(0, int(retry_delay_ms or 0))
        recovery_retry_attempts = max(0, int(recovery_retry_attempts or 0))
        recovery_retry_delay_ms = max(0, int(recovery_retry_delay_ms or 0))
        recovery_concurrency = max(1, int(recovery_concurrency or 1))
        if timeout_seconds is not None:
            timeout_seconds = max(1, int(timeout_seconds or 1))
        results: list[Optional[dict]] = [None] * len(normalized_items)
        semaphore = asyncio.Semaphore(concurrency)
        progress_lock = asyncio.Lock()
        loop = asyncio.get_running_loop()
        started_at = time.monotonic()
        last_speed_sample = {"time": started_at, "bytes": 0}
        current_speed_bps = 0
        active_items: dict[int, dict] = {}
        progress_state = {
            "completed": max(0, int(progress_completed_offset or 0)),
            "success": max(0, int(progress_success_offset or 0)),
            "failed": max(0, int(progress_failed_offset or 0)),
            "total": max(int(progress_total or 0), len(normalized_items) + max(0, int(progress_completed_offset or 0))),
            "completed_bytes": 0,
        }

        def build_progress_snapshot(result: Optional[dict] = None) -> dict:
            nonlocal current_speed_bps
            now = time.monotonic()
            active_bytes = sum(int(item.get("bytes_downloaded") or 0) for item in active_items.values())
            observed_bytes = int(progress_state["completed_bytes"]) + active_bytes
            elapsed = max(now - started_at, 0.001)
            sample_elapsed = now - float(last_speed_sample["time"])
            if sample_elapsed >= 0.5:
                delta = max(0, observed_bytes - int(last_speed_sample["bytes"]))
                current_speed_bps = int(delta / sample_elapsed) if sample_elapsed > 0 else 0
                last_speed_sample["time"] = now
                last_speed_sample["bytes"] = observed_bytes
            active_labels = [
                str(item.get("label") or item.get("filename") or item.get("url") or "").strip()
                for item in active_items.values()
                if str(item.get("label") or item.get("filename") or item.get("url") or "").strip()
            ]
            active_total_bytes = sum(int(item.get("bytes_total") or 0) for item in active_items.values())
            snapshot = {
                "download_total": progress_state["total"],
                "download_completed": progress_state["completed"],
                "download_success": progress_state["success"],
                "download_failed": progress_state["failed"],
                "download_active": progress_state["completed"] < progress_state["total"] or bool(active_items),
                "download_current_label": active_labels[0] if active_labels else "",
                "download_active_labels": active_labels[:6],
                "download_active_count": len(active_items),
                "download_bytes_completed": observed_bytes,
                "download_total_bytes": int(progress_state["completed_bytes"]) + active_total_bytes if active_total_bytes else int(progress_state["completed_bytes"]),
                "download_speed_bps": current_speed_bps if active_items else 0,
                "download_elapsed_seconds": round(elapsed, 3),
            }
            if result is not None:
                snapshot.update({
                    "download_last_label": str(result.get("label") or result.get("filename") or result.get("url") or "").strip(),
                    "download_last_success": bool(result.get("success")),
                })
            return snapshot

        async def emit_progress(snapshot: dict) -> None:
            if progress_callback is not None:
                await progress_callback(snapshot)

        async def mark_started(index: int, item: dict) -> None:
            async with progress_lock:
                active_items[index] = {
                    "label": str((item or {}).get("label") or (item or {}).get("filename") or (item or {}).get("url") or "").strip(),
                    "filename": str((item or {}).get("filename") or "").strip(),
                    "url": str((item or {}).get("url") or "").strip(),
                    "bytes_downloaded": 0,
                    "bytes_total": 0,
                }
                snapshot = build_progress_snapshot()
            await emit_progress(snapshot)

        async def mark_stream(index: int, progress: dict) -> None:
            async with progress_lock:
                active = active_items.get(index)
                if not active:
                    return
                active["bytes_downloaded"] = max(int(active.get("bytes_downloaded") or 0), int(progress.get("bytes_downloaded") or 0))
                if int(progress.get("bytes_total") or 0) > 0:
                    active["bytes_total"] = int(progress.get("bytes_total") or 0)
                snapshot = build_progress_snapshot()
            await emit_progress(snapshot)

        def make_thread_progress(index: int) -> Callable[[dict], None]:
            last_emit = {"time": 0.0, "bytes": 0}

            def report(progress: dict) -> None:
                now = time.monotonic()
                downloaded = int((progress or {}).get("bytes_downloaded") or 0)
                if now - float(last_emit["time"]) < 0.75 and downloaded - int(last_emit["bytes"]) < 1024 * 1024:
                    return
                last_emit["time"] = now
                last_emit["bytes"] = downloaded
                loop.call_soon_threadsafe(
                    lambda: asyncio.create_task(mark_stream(index, dict(progress or {})))
                )

            return report

        async def worker(index: int, item: dict) -> None:
            async with semaphore:
                await mark_started(index, item)
                result = await self._download_url_item(
                    item,
                    default_retry_attempts=retry_attempts,
                    default_retry_delay_ms=retry_delay_ms,
                    default_timeout_seconds=timeout_seconds,
                    progress_callback=make_thread_progress(index) if progress_callback is not None else None,
                )
            results[index] = result

            async with progress_lock:
                active_items.pop(index, None)
                progress_state["completed"] += 1
                if result.get("success"):
                    progress_state["success"] += 1
                else:
                    progress_state["failed"] += 1
                progress_state["completed_bytes"] += int(result.get("bytes") or 0)
                snapshot = build_progress_snapshot(result)
            await emit_progress(snapshot)

        await asyncio.gather(*(worker(index, item) for index, item in enumerate(normalized_items)))

        if recovery_retry_attempts > 0:
            failed_indexes = [
                index
                for index, result in enumerate(results)
                if not bool((result or {}).get("success"))
            ]
            if failed_indexes:
                recovery_semaphore = asyncio.Semaphore(recovery_concurrency)

                async def recovery_worker(index: int) -> None:
                    item = normalized_items[index]
                    previous_result = dict(results[index] or {})
                    async with recovery_semaphore:
                        await mark_started(index, item)
                        recovered_result = await self._download_url_item(
                            item,
                            default_retry_attempts=recovery_retry_attempts,
                            default_retry_delay_ms=recovery_retry_delay_ms,
                            default_timeout_seconds=timeout_seconds,
                            progress_callback=make_thread_progress(index) if progress_callback is not None else None,
                        )
                    recovered_result["recovery_attempts"] = int(recovered_result.get("attempts") or 0)
                    recovered_result["recovered"] = bool(recovered_result.get("success"))
                    if previous_result.get("error"):
                        recovered_result["initial_error"] = str(previous_result.get("error"))
                    results[index] = recovered_result

                    async with progress_lock:
                        active_items.pop(index, None)
                        if recovered_result.get("success"):
                            progress_state["success"] += 1
                            progress_state["failed"] = max(0, int(progress_state["failed"]) - 1)
                        progress_state["completed_bytes"] += int(recovered_result.get("bytes") or 0)
                        snapshot = build_progress_snapshot(recovered_result)
                    await emit_progress(snapshot)

                await asyncio.gather(*(recovery_worker(index) for index in failed_indexes))

        finalized = [dict(item or {}) for item in results]
        if strict:
            first_error = next((item for item in finalized if not item.get("success")), None)
            if first_error:
                raise RuntimeError(str(first_error.get("error") or f"下载失败: {first_error.get('label') or first_error.get('url') or ''}"))
        return {
            "ok": all(bool(item.get("success")) for item in finalized) if finalized else True,
            "items": finalized,
        }

    async def evaluate(self, expression: str, user_gesture: bool = False) -> JSResult:
        try:
            msg = await self._evaluate_raw(expression, user_gesture=user_gesture)
        except asyncio.TimeoutError:
            return JSResult(success=False, error="timeout")
        except Exception as e:
            return JSResult(success=False, error=str(e))

        if "error" in msg:
            return JSResult(success=False, error=str(msg["error"]))

        payload = msg.get("result", {})
        exception = payload.get("exceptionDetails") or {}
        if exception:
            description = (
                str((exception.get("exception") or {}).get("description") or "").strip()
                or str(exception.get("text") or "").strip()
                or "JavaScript execution failed"
            )
            return JSResult(success=False, error=description)

        result = payload.get("result", {})
        if result.get("type") == "undefined":
            return JSResult(success=False, error="脚本未返回值（忘记 return？）")

        val = result.get("value")
        if not isinstance(val, dict):
            return JSResult(success=False, error=f"返回值类型错误: {type(val)}")

        return JSResult(
            success=val.get("success", False),
            data=val.get("data"),
            meta=val.get("meta"),
            error=val.get("error"),
        )

    async def evaluate_user_gesture(self, expression: str) -> JSResult:
        return await self.evaluate(expression, user_gesture=True)

    async def _refresh_ws_url(self) -> None:
        try:
            tab = None
            if self.tab_id:
                tab = await self._bridge_get_tab(self.tab_id)
            if not tab and self.tab_url:
                prefix = str(self.tab_url).strip()
                if prefix:
                    candidates = [
                        candidate for candidate in await self._bridge_get_tabs()
                        if candidate.get("type") == "page" and str(candidate.get("url", "")).startswith(prefix)
                    ]
                    if len(candidates) == 1:
                        tab = candidates[0]
                    elif len(candidates) > 1:
                        tab = candidates[0]
            if not tab and self.tab_url:
                try:
                    tab = await self._bridge_new_tab(str(self.tab_url).strip())
                    logger.info("运行中的 Chrome 标签页已丢失，重新打开入口页恢复连接: %s", self.tab_url)
                except Exception as e:
                    logger.info("重新打开入口页失败: %s", e)
            if not tab:
                raise RuntimeError(f"导航后找不到原标签页: {self.tab_id}")
            ws_url = tab.get("webSocketDebuggerUrl", "")
            if not ws_url:
                raise RuntimeError(f"标签页缺少 webSocketDebuggerUrl: {self.tab_id}")
            self.tab_id = str(tab.get("id") or self.tab_id or "")
            self.ws_url = ws_url
        except ConnectionError as e:
            if self.ws_url:
                logger.info("刷新 Chrome CDP 标签列表失败，继续使用当前 WebSocket: %s", e)
                return
            raise

    def _is_navigation_error(self, error: str) -> bool:
        return any(marker in (error or "") for marker in NAVIGATION_ERROR_MARKERS)

    def _params_storage_key(self, run_token: str) -> str:
        return f"__CRAWSHRIMP_PARAMS__:{run_token}"

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        storage_key = self._params_storage_key(run_token)
        expression = (
            "(() => {\n"
            "  try {\n"
            f"    const storageKey = {json.dumps(storage_key, ensure_ascii=False)};\n"
            f"    const payload = {json.dumps(params_json, ensure_ascii=False)};\n"
            "    try {\n"
            "      window.sessionStorage.setItem(storageKey, payload);\n"
            "    } catch (storageError) {\n"
            "      window.name = storageKey + '\\n' + payload;\n"
            "    }\n"
            "    window.__CRAWSHRIMP_PARAMS__ = JSON.parse(payload);\n"
            "    return { success: true, data: [], meta: { has_more: false } };\n"
            "  } catch (error) {\n"
            "    return { success: false, error: String(error?.message || error) };\n"
            "  }\n"
            "})()\n"
        )
        result = await self.evaluate_with_reconnect(expression, allow_navigation_retry=True)
        if not result.success:
            raise RuntimeError(result.error or "failed to persist run params")

    def _build_phase_preamble(self, page: int, phase: str, run_token: str, shared: dict, params_json: str) -> str:
        storage_key = json.dumps(self._params_storage_key(run_token), ensure_ascii=False)
        payload_json = json.dumps(params_json, ensure_ascii=False)
        return (
            "(() => {\n"
            f"  window.__CRAWSHRIMP_PAGE__ = {page};\n"
            f"  window.__CRAWSHRIMP_PHASE__ = {json.dumps(phase, ensure_ascii=False)};\n"
            f"  window.__CRAWSHRIMP_RUN_TOKEN__ = {json.dumps(run_token, ensure_ascii=False)};\n"
            f"  window.__CRAWSHRIMP_SHARED__ = {json.dumps(shared, ensure_ascii=False)};\n"
            f"  const __crawshrimpStorageKey = {storage_key};\n"
            f"  const __crawshrimpParamsPayload = {payload_json};\n"
            "  try {\n"
            "    try {\n"
            "      window.sessionStorage.setItem(__crawshrimpStorageKey, __crawshrimpParamsPayload);\n"
            "    } catch (storageError) {\n"
            "      window.name = __crawshrimpStorageKey + '\\n' + __crawshrimpParamsPayload;\n"
            "    }\n"
            "    window.__CRAWSHRIMP_PARAMS__ = JSON.parse(__crawshrimpParamsPayload);\n"
            "  } catch (e) {\n"
            "    if (!window.__CRAWSHRIMP_PARAMS__) {\n"
            "      let raw = null;\n"
            "      try { raw = window.sessionStorage.getItem(__crawshrimpStorageKey); } catch (storageError) {}\n"
            "      if (!raw && typeof window.name === 'string' && window.name.startsWith(__crawshrimpStorageKey + '\\n')) {\n"
            "        raw = window.name.slice(__crawshrimpStorageKey.length + 1);\n"
            "      }\n"
            "      if (raw) window.__CRAWSHRIMP_PARAMS__ = JSON.parse(raw);\n"
            "    }\n"
            "  }\n"
            "})();\n"
        )

    async def _clear_run_params(self, run_token: str) -> None:
        storage_key = json.dumps(self._params_storage_key(run_token), ensure_ascii=False)
        expression = (
            "(() => {\n"
            "  try {\n"
            f"    const storageKey = {storage_key};\n"
            "    try { window.sessionStorage.removeItem(storageKey); } catch (e) {}\n"
            "    if (typeof window.name === 'string' && window.name.startsWith(storageKey + '\\n')) {\n"
            "      window.name = '';\n"
            "    }\n"
            "  } catch (e) {}\n"
            "  return { success: true, data: [], meta: { has_more: false } };\n"
            "})()\n"
        )
        try:
            await self.evaluate_with_reconnect(expression)
        except Exception:
            logger.debug("Failed to clear persisted run params", exc_info=True)

    async def _reload_current_page(self) -> None:
        tab = None
        if self.tab_id:
            try:
                tab = await self._bridge_get_tab(self.tab_id)
            except Exception:
                tab = None

        if not tab and self.tab_url:
            prefix = str(self.tab_url).strip()
            if prefix:
                candidates = [
                    candidate for candidate in await self._bridge_get_tabs()
                    if candidate.get("type") == "page" and str(candidate.get("url", "")).startswith(prefix)
                ]
                if candidates:
                    tab = candidates[0]

        logger.info(
            "页面超时，尝试刷新当前标签页: tab=%s url=%s",
            self.tab_id or "(unknown)",
            str((tab or {}).get("url") or self.tab_url or "(unknown)"),
        )

        try:
            await self._cdp_send("Page.reload", {"ignoreCache": True})
        except Exception as e:
            logger.info(f"Page.reload 失败，继续尝试恢复连接: {e}")

        await asyncio.sleep(2.0)
        await self._refresh_ws_url()

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        result = await self.evaluate(expression)
        if not allow_navigation_retry:
            return result

        retry = 0
        while not result.success and self._is_navigation_error(result.error or "") and retry < 4:
            retry += 1
            delay = min(0.8 * retry + 0.4, 3.0)
            logger.info(f"导航/重载中，等待 {delay:.1f}s 后重试 (attempt {retry}/4)")
            await asyncio.sleep(delay)
            try:
                await self._refresh_ws_url()
            except Exception as e:
                logger.info(f"刷新标签页连接失败，继续等待: {e}")
                continue
            result = await self.evaluate(expression)
        return result

    async def run_script_file(self, script_path: Path, params: dict = None, control_hook=None) -> List[dict]:
        """执行脚本文件，支持自动分页 + 多阶段重入，返回合并后的所有 data 记录
        params: 用户填写的参数，注入为 window.__CRAWSHRIMP_PARAMS__
        """
        script = script_path.read_text(encoding="utf-8")
        all_data: List[dict] = []
        params_json = json.dumps(params or {}, ensure_ascii=False)
        run_token = f"{int(time.time() * 1000)}-{secrets.token_hex(4)}"
        self._file_payload_cache = {}
        self._page_file_cache_keys = set()
        self.last_runtime_shared = {}
        self.last_runtime_page = 0
        self.last_runtime_phase = ""

        await self._persist_run_params(run_token, params_json)

        async def cooperate(kind: str, page: int, phase: str, shared: Optional[dict] = None, extra: Optional[dict] = None) -> None:
            self.last_runtime_page = int(page or 0)
            self.last_runtime_phase = str(phase or "")
            if isinstance(shared, dict):
                self.last_runtime_shared = dict(shared)
            if control_hook is None:
                return
            payload = {
                "kind": kind,
                "page": page,
                "phase": phase,
                "shared": shared or {},
                "records": len(all_data),
            }
            if extra:
                payload.update(extra)
            await control_hook(payload)

        try:
            try:
                page_shared: dict = {}
                for page in range(1, MAX_PAGES + 1):
                    phase = "main"
                    shared = dict(page_shared)

                    for phase_index in range(1, MAX_PHASES + 1):
                        await cooperate("before_phase", page, phase, shared)
                        preamble = self._build_phase_preamble(page, phase, run_token, shared, params_json)
                        payload = preamble + script
                        timeout_retry = False
                        while True:
                            result = await self.evaluate_with_reconnect(payload, allow_navigation_retry=True)
                            if result.success:
                                break
                            if result.error != "timeout" or timeout_retry:
                                break
                            timeout_retry = True
                            logger.info(f"脚本超时，先刷新当前页面后重试 (page={page}, phase={phase})")
                            try:
                                await self._reload_current_page()
                            except Exception as e:
                                logger.info(f"刷新当前页面失败，放弃本次超时重试: {e}")
                                break

                        if not result.success:
                            error_message = str(result.error or "").strip() or "脚本执行失败：未返回错误详情"
                            logger.error(f"脚本执行失败 (page={page}, phase={phase}): {error_message}")
                            raise RuntimeError(error_message)

                        meta = result.meta or {}
                        action = meta.get("action") or "complete"
                        if "shared" in meta:
                            shared = meta.get("shared") if isinstance(meta.get("shared"), dict) else {}
                        self.last_runtime_page = int(page or 0)
                        self.last_runtime_phase = str(phase or "")
                        self.last_runtime_shared = dict(shared or {})

                        if result.data:
                            all_data.extend(result.data)

                        if action == "cdp_clicks":
                            # JS 脚本请求用 CDP 真实鼠标点击一组坐标，然后继续当前 phase
                            # meta.clicks = [{x, y, delay_ms?, type?: "click"|"move"|"hover"}, ...]
                            # meta.next_phase (可选) = 点完后切换到哪个 phase
                            clicks = meta.get("clicks") or []
                            for idx, c in enumerate(clicks):
                                await cooperate("before_click", page, phase, shared, {
                                    "click_index": idx,
                                    "click_total": len(clicks),
                                })
                                event_type = str(c.get("type") or c.get("action") or "click").strip().lower()
                                if event_type in {"move", "hover", "mousemove", "mouse_moved"}:
                                    await self.cdp_mouse_move(float(c["x"]), float(c["y"]), int(c.get("delay_ms", 80)))
                                else:
                                    await self.cdp_mouse_click(float(c["x"]), float(c["y"]), int(c.get("delay_ms", 80)))
                            post_sleep = float(meta.get("sleep_ms", 300)) / 1000.0
                            await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(post_sleep * 1000)})
                            await asyncio.sleep(post_sleep)
                            next_phase = meta.get("next_phase") or phase
                            logger.info(f"cdp_clicks: page={page} phase={phase} 点击 {len(clicks)} 个坐标 -> {next_phase}")
                            phase = str(next_phase)
                            await self._refresh_ws_url()
                            continue

                        if action == "cdp_target_eval":
                            eval_result = await self.evaluate_cdp_target(
                                str(meta.get("expression") or ""),
                                target_url_contains=meta.get("target_url_contains") or meta.get("targetUrlContains") or [],
                                target_url_regex=meta.get("target_url_regex") or meta.get("targetUrlRegex"),
                                target_types=meta.get("target_types") or meta.get("targetTypes") or ["page", "iframe"],
                                user_gesture=bool(meta.get("user_gesture") or meta.get("userGesture")),
                                open_url_if_missing=str(meta.get("open_url_if_missing") or meta.get("openUrlIfMissing") or ""),
                                open_wait_ms=int(meta.get("open_wait_ms") or meta.get("openWaitMs") or 0),
                            )
                            shared_key = str(meta.get("shared_key") or meta.get("sharedKey") or "").strip()
                            if shared_key:
                                shared = self._merge_runtime_shared(shared, shared_key, eval_result)
                            post_sleep = float(meta.get("sleep_ms", 300)) / 1000.0
                            await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(post_sleep * 1000)})
                            await asyncio.sleep(post_sleep)
                            next_phase = meta.get("next_phase") or phase
                            logger.info(
                                f"cdp_target_eval: page={page} phase={phase} ok={bool(eval_result.get('ok'))} -> {next_phase}"
                            )
                            phase = str(next_phase)
                            await self._refresh_ws_url()
                            continue

                        if action == "inject_files":
                            items = meta.get("items") or []
                            await cooperate("before_file_inject", page, phase, shared, {
                                "file_item_total": len(items),
                            })
                            inject_result = await self.inject_files(items)
                            if not inject_result.success:
                                raise RuntimeError(inject_result.error or "文件注入失败")
                            post_sleep = float(meta.get("sleep_ms", 500)) / 1000.0
                            await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(post_sleep * 1000)})
                            await asyncio.sleep(post_sleep)
                            next_phase = meta.get("next_phase") or phase
                            logger.info(f"inject_files: page={page} phase={phase} 注入 {len(items)} 个文件输入 -> {next_phase}")
                            phase = str(next_phase)
                            await self._refresh_ws_url()
                            continue

                        if action == "file_chooser_upload":
                            items = meta.get("items") or []
                            strict = bool(meta.get("strict"))
                            shared_key = str(meta.get("shared_key") or "").strip()
                            shared_append = bool(meta.get("shared_append"))

                            await cooperate("before_file_chooser_upload", page, phase, shared, {
                                "file_item_total": len(items),
                            })
                            upload_result = await self.upload_via_file_chooser(items, strict=strict)
                            shared = self._merge_runtime_shared(shared, shared_key, upload_result, append=shared_append)
                            post_sleep = float(meta.get("sleep_ms", 500)) / 1000.0
                            await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(post_sleep * 1000)})
                            await asyncio.sleep(post_sleep)
                            next_phase = meta.get("next_phase") or phase
                            logger.info(
                                "file_chooser_upload: page=%s phase=%s 上传 %s 组文件 -> %s",
                                page,
                                phase,
                                len(items),
                                next_phase,
                            )
                            phase = str(next_phase)
                            await self._refresh_ws_url()
                            continue

                        if action == "prepare_image_files":
                            items = meta.get("items") or []
                            shared_key = str(meta.get("shared_key") or "prepared_image_files").strip()
                            prepare_result = self._prepare_safe_three_four_images(items)
                            if meta.get("strict") and not prepare_result.get("ok"):
                                errors = [
                                    str(item.get("error") or "")
                                    for item in prepare_result.get("items", [])
                                    if not item.get("success")
                                ]
                                raise RuntimeError("prepare_image_files failed: " + "；".join(filter(None, errors)))
                            shared = self._merge_runtime_shared(shared, shared_key, prepare_result)
                            post_sleep = float(meta.get("sleep_ms", 0)) / 1000.0
                            await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(post_sleep * 1000)})
                            await asyncio.sleep(post_sleep)
                            next_phase = meta.get("next_phase") or phase
                            logger.info(
                                "prepare_image_files: page=%s phase=%s 处理 %s 张图片 -> %s",
                                page,
                                phase,
                                len(items),
                                next_phase,
                            )
                            phase = str(next_phase)
                            continue

                        if action == "capture_click_requests":
                            clicks = meta.get("clicks") or []
                            matches = meta.get("matches") or []
                            timeout_ms = int(meta.get("timeout_ms") or 8000)
                            settle_ms = int(meta.get("settle_ms") or 1000)
                            min_matches = int(meta.get("min_matches") or 1)
                            shared_key = str(meta.get("shared_key") or "").strip()
                            shared_append = bool(meta.get("shared_append"))
                            strict = bool(meta.get("strict"))

                            await cooperate("before_capture_click_requests", page, phase, shared, {
                                "click_total": len(clicks),
                                "match_total": len(matches),
                            })
                            capture_result = await self.capture_click_requests(
                                clicks,
                                matches=matches,
                                timeout_ms=timeout_ms,
                                settle_ms=settle_ms,
                                min_matches=min_matches,
                                include_response_body=bool(meta.get("include_response_body", False)),
                            )
                            if strict and not capture_result.get("ok"):
                                raise RuntimeError(f"capture_click_requests 未捕获到匹配请求: {matches}")

                            shared = self._merge_runtime_shared(shared, shared_key, capture_result, append=shared_append)
                            next_phase = meta.get("next_phase") or phase
                            sleep_ms = float(meta.get("sleep_ms", 0))
                            if sleep_ms > 0:
                                await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(sleep_ms)})
                                await asyncio.sleep(sleep_ms / 1000.0)
                            logger.info(
                                "capture_click_requests: page=%s phase=%s 匹配 %s 条 -> %s",
                                page,
                                phase,
                                len(capture_result.get("matches") or []),
                                next_phase,
                            )
                            phase = str(next_phase)
                            await self._refresh_ws_url()
                            continue

                        if action == "capture_url_requests":
                            target_url = str(meta.get("url") or "").strip()
                            matches = meta.get("matches") or []
                            timeout_ms = int(meta.get("timeout_ms") or 12000)
                            settle_ms = int(meta.get("settle_ms") or 1000)
                            min_matches = int(meta.get("min_matches") or 1)
                            shared_key = str(meta.get("shared_key") or "").strip()
                            shared_append = bool(meta.get("shared_append"))
                            strict = bool(meta.get("strict"))
                            if not target_url:
                                raise RuntimeError("capture_url_requests 缺少 url")

                            await cooperate("before_capture_url_requests", page, phase, shared, {
                                "target_url": target_url,
                                "match_total": len(matches),
                            })
                            capture_result = await self.capture_url_requests(
                                target_url,
                                matches=matches,
                                timeout_ms=timeout_ms,
                                settle_ms=settle_ms,
                                min_matches=min_matches,
                                include_response_body=bool(meta.get("include_response_body", False)),
                            )
                            if strict and not capture_result.get("ok"):
                                raise RuntimeError(f"capture_url_requests 未捕获到匹配请求: {matches}")

                            shared = self._merge_runtime_shared(shared, shared_key, capture_result, append=shared_append)
                            next_phase = meta.get("next_phase") or phase
                            sleep_ms = float(meta.get("sleep_ms", 0))
                            if sleep_ms > 0:
                                await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(sleep_ms)})
                                await asyncio.sleep(sleep_ms / 1000.0)
                            logger.info(
                                "capture_url_requests: page=%s phase=%s 匹配 %s 条 -> %s",
                                page,
                                phase,
                                len(capture_result.get("matches") or []),
                                next_phase,
                            )
                            phase = str(next_phase)
                            await self._refresh_ws_url()
                            continue

                        if action == "capture_wheel_requests":
                            wheels = meta.get("wheels") or []
                            matches = meta.get("matches") or []
                            timeout_ms = int(meta.get("timeout_ms") or 8000)
                            settle_ms = int(meta.get("settle_ms") or 1000)
                            min_matches = int(meta.get("min_matches") or 1)
                            shared_key = str(meta.get("shared_key") or "").strip()
                            shared_append = bool(meta.get("shared_append"))
                            strict = bool(meta.get("strict"))

                            await cooperate("before_capture_wheel_requests", page, phase, shared, {
                                "wheel_total": len(wheels),
                                "match_total": len(matches),
                            })
                            capture_result = await self.capture_wheel_requests(
                                wheels,
                                matches=matches,
                                timeout_ms=timeout_ms,
                                settle_ms=settle_ms,
                                min_matches=min_matches,
                                include_response_body=bool(meta.get("include_response_body", False)),
                            )
                            if strict and not capture_result.get("ok"):
                                raise RuntimeError(f"capture_wheel_requests 未捕获到匹配请求: {matches}")

                            shared = self._merge_runtime_shared(shared, shared_key, capture_result, append=shared_append)
                            next_phase = meta.get("next_phase") or phase
                            sleep_ms = float(meta.get("sleep_ms", 0))
                            if sleep_ms > 0:
                                await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(sleep_ms)})
                                await asyncio.sleep(sleep_ms / 1000.0)
                            logger.info(
                                "capture_wheel_requests: page=%s phase=%s 匹配 %s 条 -> %s",
                                page,
                                phase,
                                len(capture_result.get("matches") or []),
                                next_phase,
                            )
                            phase = str(next_phase)
                            await self._refresh_ws_url()
                            continue

                        if action == "download_urls":
                            items = meta.get("items") or []
                            strict = bool(meta.get("strict"))
                            shared_key = str(meta.get("shared_key") or "").strip()
                            shared_append = bool(meta.get("shared_append"))
                            concurrency = int(meta.get("concurrency") or meta.get("max_concurrency") or 1)
                            retry_attempts = int(meta.get("retry_attempts") or meta.get("retryAttempts") or meta.get("retries") or 1)
                            retry_delay_ms = int(meta.get("retry_delay_ms") or meta.get("retryDelayMs") or 0)
                            recovery_retry_attempts = int(meta.get("recovery_retry_attempts") or meta.get("recoveryRetryAttempts") or 0)
                            recovery_retry_delay_ms = int(meta.get("recovery_retry_delay_ms") or meta.get("recoveryRetryDelayMs") or 0)
                            recovery_concurrency = int(meta.get("recovery_concurrency") or meta.get("recoveryConcurrency") or 1)
                            timeout_seconds_raw = meta.get("timeout_seconds") or meta.get("timeoutSeconds") or meta.get("timeout")
                            timeout_seconds = int(timeout_seconds_raw) if timeout_seconds_raw else None
                            progress_total_raw = meta.get("progress_total") or meta.get("download_progress_total")
                            progress_completed_offset = int(meta.get("progress_completed_offset") or meta.get("download_completed_offset") or 0)
                            progress_success_offset = int(meta.get("progress_success_offset") or meta.get("download_success_offset") or 0)
                            progress_failed_offset = int(meta.get("progress_failed_offset") or meta.get("download_failed_offset") or 0)
                            progress_total = int(progress_total_raw) if progress_total_raw else len(items) + progress_completed_offset

                            await cooperate("before_download_urls", page, phase, shared, {
                                "download_item_total": progress_total,
                                "download_batch_total": len(items),
                                "download_completed": progress_completed_offset,
                                "download_success": progress_success_offset,
                                "download_failed": progress_failed_offset,
                                "download_concurrency": concurrency,
                                "download_retry_attempts": retry_attempts,
                            })

                            async def report_download_progress(progress_payload: dict) -> None:
                                await cooperate("download_urls_progress", page, phase, shared, progress_payload)

                            download_result = await self.download_urls(
                                items,
                                strict=strict,
                                concurrency=concurrency,
                                retry_attempts=retry_attempts,
                                retry_delay_ms=retry_delay_ms,
                                recovery_retry_attempts=recovery_retry_attempts,
                                recovery_retry_delay_ms=recovery_retry_delay_ms,
                                recovery_concurrency=recovery_concurrency,
                                timeout_seconds=timeout_seconds,
                                progress_total=progress_total,
                                progress_completed_offset=progress_completed_offset,
                                progress_success_offset=progress_success_offset,
                                progress_failed_offset=progress_failed_offset,
                                progress_callback=report_download_progress,
                            )
                            shared = self._merge_runtime_shared(shared, shared_key, download_result, append=shared_append)
                            next_phase = meta.get("next_phase") or phase
                            sleep_ms = float(meta.get("sleep_ms", 0))
                            if sleep_ms > 0:
                                await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(sleep_ms)})
                                await asyncio.sleep(sleep_ms / 1000.0)
                            logger.info(
                                "download_urls: page=%s phase=%s 成功 %s/%s -> %s",
                                page,
                                phase,
                                len([item for item in download_result.get("items", []) if item.get("success")]),
                                len(download_result.get("items", [])),
                                next_phase,
                            )
                            phase = str(next_phase)
                            await self._refresh_ws_url()
                            continue

                        if action == "download_clicks":
                            items = meta.get("items") or []
                            strict = bool(meta.get("strict"))
                            shared_key = str(meta.get("shared_key") or "").strip()
                            shared_append = bool(meta.get("shared_append"))

                            await cooperate("before_download_clicks", page, phase, shared, {
                                "download_click_item_total": len(items),
                            })
                            download_result = await self.download_clicks(items, strict=strict)
                            shared = self._merge_runtime_shared(shared, shared_key, download_result, append=shared_append)
                            next_phase = meta.get("next_phase") or phase
                            sleep_ms = float(meta.get("sleep_ms", 0))
                            if sleep_ms > 0:
                                await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(sleep_ms)})
                                await asyncio.sleep(sleep_ms / 1000.0)
                            logger.info(
                                "download_clicks: page=%s phase=%s 成功 %s/%s -> %s",
                                page,
                                phase,
                                len([item for item in download_result.get("items", []) if item.get("success")]),
                                len(download_result.get("items", [])),
                                next_phase,
                            )
                            phase = str(next_phase)
                            await self._refresh_ws_url()
                            continue

                        if action == "check_files":
                            items = meta.get("items") or []
                            strict = bool(meta.get("strict"))
                            shared_key = str(meta.get("shared_key") or "").strip()
                            shared_append = bool(meta.get("shared_append"))
                            await cooperate("before_check_files", page, phase, shared, {
                                "file_item_total": len(items),
                            })
                            check_result = self.check_runtime_files(items)
                            if strict and not check_result.get("ok"):
                                raise RuntimeError(str(check_result.get("error") or "check_files 未找到有效文件"))

                            shared = self._merge_runtime_shared(shared, shared_key, check_result, append=shared_append)
                            next_phase = meta.get("next_phase") or phase
                            sleep_ms = float(meta.get("sleep_ms", 0))
                            if sleep_ms > 0:
                                await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(sleep_ms)})
                                await asyncio.sleep(sleep_ms / 1000.0)
                            logger.info(
                                "check_files: page=%s phase=%s 成功 %s/%s -> %s",
                                page,
                                phase,
                                len([item for item in check_result.get("items", []) if item.get("success")]),
                                len(check_result.get("items", [])),
                                next_phase,
                            )
                            phase = str(next_phase)
                            await self._refresh_ws_url()
                            continue

                        if action == "capture_screenshot":
                            filename = str(meta.get("filename") or "").strip()
                            label = str(meta.get("label") or "").strip()
                            strict = bool(meta.get("strict"))
                            shared_key = str(meta.get("shared_key") or "").strip()
                            shared_append = bool(meta.get("shared_append"))
                            await cooperate("before_capture_screenshot", page, phase, shared, {
                                "filename": filename,
                                "label": label,
                            })
                            screenshot_result = await self.capture_screenshot(
                                filename=filename,
                                label=label,
                                full_page=bool(meta.get("full_page", True)),
                                scroll_before_capture=bool(meta.get("scroll_before_capture", True)),
                                settle_ms=int(meta.get("settle_ms") or 800),
                                scroll_step=int(meta.get("scroll_step") or 650),
                                scroll_delay_ms=int(meta.get("scroll_delay_ms") or 120),
                                scroll_rounds=int(meta.get("scroll_rounds") or 1),
                                target_dir=str(meta.get("target_dir") or "").strip(),
                                target_relative_path=str(meta.get("target_relative_path") or "").strip(),
                                neutralize_fixed=bool(meta.get("neutralize_fixed")),
                            )
                            if strict and not screenshot_result.get("ok"):
                                raise RuntimeError(str(screenshot_result.get("error") or "capture_screenshot 失败"))

                            shared = self._merge_runtime_shared(shared, shared_key, screenshot_result, append=shared_append)
                            next_phase = meta.get("next_phase") or phase
                            sleep_ms = float(meta.get("sleep_ms", 0))
                            if sleep_ms > 0:
                                await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(sleep_ms)})
                                await asyncio.sleep(sleep_ms / 1000.0)
                            logger.info(
                                "capture_screenshot: page=%s phase=%s ok=%s -> %s",
                                page,
                                phase,
                                bool(screenshot_result.get("ok")),
                                next_phase,
                            )
                            phase = str(next_phase)
                            await self._refresh_ws_url()
                            continue

                        if action == "recognize_wash_care_media":
                            items = meta.get("items") or []
                            shared_key = str(meta.get("shared_key") or "").strip()
                            strict = bool(meta.get("strict"))
                            await cooperate("before_recognize_wash_care_media", page, phase, shared, {
                                "media_item_total": len(items),
                            })
                            fallback_model_ids_raw = meta.get("fallback_model_ids") or meta.get("fallbackModelIds") or []
                            if isinstance(fallback_model_ids_raw, str):
                                fallback_model_ids = [
                                    item.strip()
                                    for item in re.split(r"[\s,，;；、]+", fallback_model_ids_raw)
                                    if item.strip()
                                ]
                            elif isinstance(fallback_model_ids_raw, list):
                                fallback_model_ids = [str(item).strip() for item in fallback_model_ids_raw if str(item).strip()]
                            else:
                                fallback_model_ids = []
                            recognition_result = await self.recognize_wash_care_media(
                                items,
                                model_id=str(meta.get("model_id") or meta.get("modelId") or "").strip(),
                                fallback_model_ids=fallback_model_ids,
                            )
                            if strict and not recognition_result.get("ok"):
                                raise RuntimeError(str(recognition_result.get("error") or "洗护说明识别失败"))

                            shared = self._merge_runtime_shared(shared, shared_key, recognition_result)
                            next_phase = meta.get("next_phase") or phase
                            sleep_ms = float(meta.get("sleep_ms", 0))
                            if sleep_ms > 0:
                                await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(sleep_ms)})
                                await asyncio.sleep(sleep_ms / 1000.0)
                            logger.info(
                                "recognize_wash_care_media: page=%s phase=%s ok=%s -> %s",
                                page,
                                phase,
                                bool(recognition_result.get("ok")),
                                next_phase,
                            )
                            phase = str(next_phase)
                            await self._refresh_ws_url()
                            continue

                        if action == "recognize_ocr_images":
                            items = meta.get("items") or []
                            shared_key = str(meta.get("shared_key") or "").strip()
                            shared_append = bool(meta.get("shared_append"))
                            strict = bool(meta.get("strict"))
                            await cooperate("before_recognize_ocr_images", page, phase, shared, {
                                "ocr_image_total": len(items),
                            })
                            ocr_result = await self.recognize_ocr_images(
                                items,
                                lang=str(meta.get("lang") or meta.get("ocr_lang") or meta.get("ocrLang") or "chi_sim").strip(),
                                strict=strict,
                                timeout_seconds=int(meta.get("timeout_seconds") or meta.get("timeoutSeconds") or 30),
                                download_timeout_seconds=int(
                                    meta.get("download_timeout_seconds")
                                    or meta.get("downloadTimeoutSeconds")
                                    or 30
                                ),
                                retry_attempts=int(meta.get("retry_attempts") or meta.get("retryAttempts") or 1),
                                use_browser_session=bool(meta.get("browser_session") or meta.get("browserSession")),
                            )
                            if strict and not ocr_result.get("ok"):
                                raise RuntimeError(str(ocr_result.get("error") or "宿主端 OCR 失败"))

                            shared = self._merge_runtime_shared(shared, shared_key, ocr_result, append=shared_append)
                            next_phase = meta.get("next_phase") or phase
                            sleep_ms = float(meta.get("sleep_ms", 0))
                            if sleep_ms > 0:
                                await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(sleep_ms)})
                                await asyncio.sleep(sleep_ms / 1000.0)
                            logger.info(
                                "recognize_ocr_images: page=%s phase=%s ok=%s scanned=%s/%s -> %s",
                                page,
                                phase,
                                bool(ocr_result.get("ok")),
                                int(ocr_result.get("scanned") or 0),
                                len(items),
                                next_phase,
                            )
                            phase = str(next_phase)
                            await self._refresh_ws_url()
                            continue

                        if action == "reload_page":
                            next_phase = meta.get("next_phase") or phase
                            sleep_ms = float(meta.get("sleep_ms", 1000))
                            logger.info(f"reload_page: page={page} phase={phase} -> {next_phase}")
                            await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(sleep_ms)})
                            try:
                                await self._cdp_send("Page.reload", {"ignoreCache": True})
                            except Exception as e:
                                logger.info(f"Page.reload 失败，尝试继续等待页面重载: {e}")
                            await asyncio.sleep(sleep_ms / 1000.0)
                            phase = str(next_phase)
                            await self._refresh_ws_url()
                            continue

                        if action == "next_phase":
                            next_phase = meta.get("next_phase")
                            if not next_phase:
                                raise RuntimeError(f"脚本返回 next_phase 但缺少 next_phase 值 (page={page}, phase={phase})")
                            if next_phase == "wait_verification" and phase == "wait_verification":
                                rounds = int((shared or {}).get("captcha_wait_rounds") or 0)
                                if rounds <= 1 or rounds % 3 == 0:
                                    reason = (shared or {}).get("captcha_reason") or "captcha"
                                    logger.info(f"等待用户验证码验证中: page={page} rounds={rounds} reason={reason}")
                            else:
                                logger.info(f"阶段切换: page={page} {phase} -> {next_phase}")
                            phase = str(next_phase)
                            sleep_ms = float(meta.get("sleep_ms", 1200))
                            await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(sleep_ms)})
                            await asyncio.sleep(sleep_ms / 1000.0)
                            await self._refresh_ws_url()
                            continue

                        if action == "complete":
                            if not meta.get("has_more", False):
                                return all_data
                            sleep_ms = float(meta.get("sleep_ms") or 0)
                            if sleep_ms > 0:
                                await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(sleep_ms)})
                                await asyncio.sleep(sleep_ms / 1000.0)
                            page_shared = dict(shared or {})
                            logger.info(f"分页: 已获取 {len(all_data)} 条，继续第 {page + 1} 页...")
                            break

                        if action == "abort":
                            reason = str(meta.get("reason") or meta.get("error") or "任务已停止").strip() or "任务已停止"
                            raise RunAbortedError(reason, partial_data=list(all_data))

                        raise RuntimeError(f"未知脚本阶段动作: {action}")
                    else:
                        raise RuntimeError(f"脚本阶段执行超过上限 ({MAX_PHASES})，page={page}")

                raise RuntimeError(f"脚本分页超过上限 ({MAX_PAGES})，最近一页仍返回 has_more=true")
            except RunAbortedError as e:
                if not e.partial_data:
                    e.partial_data = list(all_data)
                raise
            except asyncio.CancelledError:
                raise RunAbortedError("任务已停止", partial_data=list(all_data))
        finally:
            await self._clear_run_params(run_token)
            self._page_file_cache_keys = set()
