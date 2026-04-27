"""
JS 注入执行器
特性：超时控制 / 错误捕获 / 分页支持 / 多阶段重入支持
"""
import base64
import asyncio
import hashlib
import json
import logging
import mimetypes
import re
import secrets
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

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

    def _next_id(self) -> int:
        self._msg_id += 1
        return self._msg_id

    async def _evaluate_raw(self, expression: str) -> dict:
        msg_id = self._next_id()
        payload = json.dumps({
            "id": msg_id,
            "method": "Runtime.evaluate",
            "params": {
                "expression": expression,
                "awaitPromise": True,
                "returnByValue": True,
                "timeout": self.timeout * 1000,
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

    async def inject_files(self, items: list[dict], retry_with_full_seed: bool = True) -> JSResult:
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

                previous = baseline.get(str(path))
                if previous and stat.st_mtime_ns <= previous[0] and stat.st_size == previous[1]:
                    continue
                if stat.st_mtime_ns < threshold_ns:
                    continue
                if newest is None or stat.st_mtime_ns > newest[0]:
                    newest = (stat.st_mtime_ns, path)

        return newest[1] if newest else None

    def _build_artifact_target_path(self, filename: str = "", source_url: str = "") -> Path:
        raw_name = str(filename or "").strip() or self._derive_url_filename(source_url)
        clean_name = self._sanitize_artifact_filename(raw_name)
        source_suffix = ""
        if source_url:
            try:
                source_suffix = Path(urlsplit(source_url).path).suffix
            except Exception:
                source_suffix = ""
        if source_suffix and not Path(clean_name).suffix:
            clean_name = f"{clean_name}{source_suffix}"
        return self._ensure_unique_artifact_path(self.artifact_dir / clean_name)

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
        url: str = "",
        matches: Optional[list[dict]] = None,
        timeout_ms: int = 8000,
        settle_ms: int = 1000,
        min_matches: int = 1,
        include_response_body: bool = True,
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
        }

    async def capture_click_requests(
        self,
        clicks: list[dict],
        *,
        matches: Optional[list[dict]] = None,
        timeout_ms: int = 8000,
        settle_ms: int = 1000,
        min_matches: int = 1,
        include_response_body: bool = True,
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

    async def capture_passive_requests(
        self,
        *,
        matches: Optional[list[dict]] = None,
        timeout_ms: int = 5000,
        settle_ms: int = 800,
        include_response_body: bool = True,
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
        include_response_body: bool = True,
    ) -> dict:
        from core.cdp_bridge import get_bridge

        bridge = get_bridge()
        temp_tab = bridge.new_tab("about:blank")
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
                    bridge.close_tab(temp_tab_id)
                except Exception:
                    logger.debug("Failed to close temporary capture tab %s", temp_tab_id, exc_info=True)

    def _download_url_sync(self, url: str, target_path: Path, headers: Optional[dict[str, str]] = None, timeout: int = 60) -> dict:
        request = Request(url, headers=headers or {})
        partial_path = target_path.with_name(f"{target_path.name}.part")

        def cleanup_partial() -> None:
            try:
                if partial_path.exists() and partial_path.is_file():
                    partial_path.unlink()
            except Exception:
                logger.debug("Failed to clean partial url download %s", partial_path, exc_info=True)

        try:
            with urlopen(request, timeout=max(timeout, 1)) as response:
                target_path.parent.mkdir(parents=True, exist_ok=True)
                cleanup_partial()
                with partial_path.open("wb") as handle:
                    shutil.copyfileobj(response, handle, length=1024 * 1024)
                partial_path.replace(target_path)
                content_type = response.headers.get("Content-Type", "")
                return {
                    "success": True,
                    "path": str(target_path),
                    "finalUrl": response.geturl(),
                    "contentType": content_type,
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
        except Exception as e:
            cleanup_partial()
            return {
                "success": False,
                "error": f"下载异常: {e}",
                "path": str(target_path),
            }

    async def _download_via_browser_session(self, url: str, target_path: Path, timeout_ms: int = 15000) -> dict:
        from core.cdp_bridge import get_bridge

        bridge = get_bridge()
        temp_tab = bridge.new_tab("about:blank")
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
                    bridge.close_tab(temp_tab_id)
                except Exception:
                    logger.debug("Failed to close temporary browser download tab %s", temp_tab_id, exc_info=True)
            shutil.rmtree(temp_download_dir, ignore_errors=True)

    def _list_page_tab_ids(self) -> set[str]:
        from core.cdp_bridge import get_bridge

        bridge = get_bridge()
        return {
            str(tab.get("id") or "")
            for tab in bridge.get_tabs()
            if tab.get("type") == "page" and str(tab.get("id") or "")
        }

    def _close_new_page_tabs(self, baseline_tab_ids: set[str]) -> None:
        from core.cdp_bridge import get_bridge

        bridge = get_bridge()
        for tab in bridge.get_tabs():
            if tab.get("type") != "page":
                continue
            tab_id = str(tab.get("id") or "")
            if not tab_id or tab_id in baseline_tab_ids or tab_id == str(self.tab_id or ""):
                continue
            url = str(tab.get("url") or "")
            if "bill-download-with-detail" not in url and "agentseller" not in url and url != "about:blank":
                continue
            try:
                bridge.close_tab(tab_id)
            except Exception:
                logger.debug("Failed to close click-opened tab %s", tab_id, exc_info=True)

    def _close_transient_download_tabs(self) -> None:
        from core.cdp_bridge import get_bridge

        bridge = get_bridge()
        for tab in bridge.get_tabs():
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
                bridge.close_tab(tab_id)
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
        from core.cdp_bridge import get_bridge

        bridge = get_bridge()
        actions: list[dict] = []
        expression = self._build_region_switch_confirm_expression()

        for tab in bridge.get_tabs():
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
        downloads_dir = Path.home() / "Downloads"
        fallback_xlsx_pattern = re.compile(r".+\.xlsx$", re.IGNORECASE)

        for item in items or []:
            clicks = (item or {}).get("clicks") or []
            filename = str((item or {}).get("filename") or "").strip()
            label = str((item or {}).get("label") or filename or "download").strip()
            expected_url = str((item or {}).get("expected_url") or (item or {}).get("url") or "").strip()
            timeout_ms = int((item or {}).get("timeout_ms") or max(self.timeout, 30) * 1000)
            regex_text = str((item or {}).get("expected_name_regex") or "").strip()

            if regex_text:
                try:
                    name_pattern = re.compile(regex_text, re.IGNORECASE)
                except re.error:
                    name_pattern = None
            else:
                name_pattern = self._build_download_candidate_regex(expected_url)
            if name_pattern is None:
                name_pattern = re.compile(r".+\.xlsx$", re.IGNORECASE)

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

            if not downloads_dir.exists():
                result = {
                    "success": False,
                    "label": label,
                    "filename": filename,
                    "error": f"系统下载目录不存在: {downloads_dir}",
                }
                results.append(result)
                if strict:
                    raise RuntimeError(result["error"])
                continue

            self._close_transient_download_tabs()
            baseline = self._snapshot_download_state([downloads_dir], name_pattern)
            fallback_baseline = self._snapshot_download_state([downloads_dir], fallback_xlsx_pattern)
            baseline_tab_ids = self._list_page_tab_ids()
            started_at_ns = time.time_ns()
            transient_actions: list[dict] = []
            transient_action_keys: set[str] = set()
            matched_by = "expected_name"

            try:
                await self._refresh_ws_url()
            except Exception:
                logger.debug("refresh_ws_url skipped before download_clicks", exc_info=True)

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
                        [downloads_dir],
                        baseline,
                        name_pattern,
                        started_at_ns,
                    )
                    if not downloaded:
                        downloaded = self._find_new_downloaded_file(
                            [downloads_dir],
                            fallback_baseline,
                            fallback_xlsx_pattern,
                            started_at_ns,
                        )
                        if downloaded:
                            matched_by = "fallback_any_xlsx"
                    if downloaded:
                        break
                    await asyncio.sleep(0.5)
            finally:
                self._close_new_page_tabs(baseline_tab_ids)

            if downloaded:
                target_path = self._build_artifact_target_path(filename, expected_url)
                final_path = self._ensure_unique_artifact_path(target_path)
                final_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(downloaded), str(final_path))
                saved_path = str(final_path)
                if saved_path not in self.runtime_output_files:
                    self.runtime_output_files.append(saved_path)
                results.append({
                    "success": True,
                    "label": label,
                    "filename": final_path.name,
                    "path": saved_path,
                    "url": expected_url,
                    "sourcePath": str(downloaded),
                    "matchedBy": matched_by,
                    "transientActions": transient_actions,
                })
                continue

            result = {
                "success": False,
                "label": label,
                "filename": filename,
                "url": expected_url,
                "error": "点击后未检测到新下载文件",
                "transientActions": transient_actions,
            }
            results.append(result)
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
    ) -> dict:
        url = str((item or {}).get("url") or "").strip()
        filename = str((item or {}).get("filename") or "").strip()
        label = str((item or {}).get("label") or filename or self._derive_url_filename(url)).strip()
        browser_session = bool((item or {}).get("browser_session") or (item or {}).get("browserSession"))
        headers_raw = (item or {}).get("headers") or {}
        headers = {
            str(key): str(value)
            for key, value in headers_raw.items()
            if str(key or "").strip() and value is not None
        } if isinstance(headers_raw, dict) else {}

        if not url:
            return {
                "success": False,
                "label": label or "download",
                "filename": filename,
                "error": "download_urls 缺少 url",
                "attempts": 0,
            }

        target_path = self._build_artifact_target_path(filename, url)
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
                    result = await asyncio.to_thread(
                        self._download_url_sync,
                        url,
                        target_path,
                        headers,
                        timeout_seconds,
                    )
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

            if result.get("success"):
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
        timeout_seconds: Optional[int] = None,
        progress_callback: Optional[Callable[[dict], Awaitable[None]]] = None,
    ) -> dict:
        normalized_items = list(items or [])
        if not normalized_items:
            return {"ok": True, "items": []}

        concurrency = max(1, int(concurrency or 1))
        retry_attempts = max(1, int(retry_attempts or 1))
        retry_delay_ms = max(0, int(retry_delay_ms or 0))
        if timeout_seconds is not None:
            timeout_seconds = max(1, int(timeout_seconds or 1))
        results: list[Optional[dict]] = [None] * len(normalized_items)
        semaphore = asyncio.Semaphore(concurrency)
        progress_lock = asyncio.Lock()
        progress_state = {
            "completed": 0,
            "success": 0,
            "failed": 0,
            "total": len(normalized_items),
        }

        async def worker(index: int, item: dict) -> None:
            async with semaphore:
                result = await self._download_url_item(
                    item,
                    default_retry_attempts=retry_attempts,
                    default_retry_delay_ms=retry_delay_ms,
                    default_timeout_seconds=timeout_seconds,
                )
            results[index] = result

            if progress_callback is not None:
                async with progress_lock:
                    progress_state["completed"] += 1
                    if result.get("success"):
                        progress_state["success"] += 1
                    else:
                        progress_state["failed"] += 1
                    snapshot = {
                        "download_total": progress_state["total"],
                        "download_completed": progress_state["completed"],
                        "download_success": progress_state["success"],
                        "download_failed": progress_state["failed"],
                        "download_active": progress_state["completed"] < progress_state["total"],
                        "download_last_label": str(result.get("label") or result.get("filename") or result.get("url") or "").strip(),
                        "download_last_success": bool(result.get("success")),
                    }
                await progress_callback(snapshot)

        await asyncio.gather(*(worker(index, item) for index, item in enumerate(normalized_items)))
        finalized = [dict(item or {}) for item in results]
        if strict:
            first_error = next((item for item in finalized if not item.get("success")), None)
            if first_error:
                raise RuntimeError(str(first_error.get("error") or f"下载失败: {first_error.get('label') or first_error.get('url') or ''}"))
        return {
            "ok": all(bool(item.get("success")) for item in finalized) if finalized else True,
            "items": finalized,
        }

    async def evaluate(self, expression: str) -> JSResult:
        try:
            msg = await self._evaluate_raw(expression)
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

    async def _refresh_ws_url(self) -> None:
        from core.cdp_bridge import get_bridge
        bridge = get_bridge()
        tab = None
        if self.tab_id:
            tab = bridge.get_tab(self.tab_id)
        if not tab and self.tab_url:
            prefix = str(self.tab_url).strip()
            if prefix:
                candidates = [
                    candidate for candidate in bridge.get_tabs()
                    if candidate.get("type") == "page" and str(candidate.get("url", "")).startswith(prefix)
                ]
                if len(candidates) == 1:
                    tab = candidates[0]
                elif len(candidates) > 1:
                    tab = candidates[0]
        if not tab and self.tab_url:
            try:
                tab = bridge.new_tab(str(self.tab_url).strip())
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
        result = await self.evaluate_with_reconnect(expression)
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
        from core.cdp_bridge import get_bridge

        bridge = get_bridge()
        tab = None
        if self.tab_id:
            try:
                tab = bridge.get_tab(self.tab_id)
            except Exception:
                tab = None

        if not tab and self.tab_url:
            prefix = str(self.tab_url).strip()
            if prefix:
                candidates = [
                    candidate for candidate in bridge.get_tabs()
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

        await self._persist_run_params(run_token, params_json)

        async def cooperate(kind: str, page: int, phase: str, shared: Optional[dict] = None, extra: Optional[dict] = None) -> None:
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
                            result = await self.evaluate_with_reconnect(payload, allow_navigation_retry=(phase != "main"))
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
                            logger.error(f"脚本执行失败 (page={page}, phase={phase}): {result.error}")
                            raise RuntimeError(result.error)

                        meta = result.meta or {}
                        action = meta.get("action") or "complete"
                        if "shared" in meta:
                            shared = meta.get("shared")

                        if result.data:
                            all_data.extend(result.data)

                        if action == "cdp_clicks":
                            # JS 脚本请求用 CDP 真实鼠标点击一组坐标，然后继续当前 phase
                            # meta.clicks = [{x, y, delay_ms?}, ...]
                            # meta.next_phase (可选) = 点完后切换到哪个 phase
                            clicks = meta.get("clicks") or []
                            for idx, c in enumerate(clicks):
                                await cooperate("before_click", page, phase, shared, {
                                    "click_index": idx,
                                    "click_total": len(clicks),
                                })
                                await self.cdp_mouse_click(float(c["x"]), float(c["y"]), int(c.get("delay_ms", 80)))
                            post_sleep = float(meta.get("sleep_ms", 300)) / 1000.0
                            await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(post_sleep * 1000)})
                            await asyncio.sleep(post_sleep)
                            next_phase = meta.get("next_phase") or phase
                            logger.info(f"cdp_clicks: page={page} phase={phase} 点击 {len(clicks)} 个坐标 -> {next_phase}")
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
                                include_response_body=bool(meta.get("include_response_body", True)),
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
                                include_response_body=bool(meta.get("include_response_body", True)),
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

                        if action == "download_urls":
                            items = meta.get("items") or []
                            strict = bool(meta.get("strict"))
                            shared_key = str(meta.get("shared_key") or "").strip()
                            shared_append = bool(meta.get("shared_append"))
                            concurrency = int(meta.get("concurrency") or meta.get("max_concurrency") or 1)
                            retry_attempts = int(meta.get("retry_attempts") or meta.get("retryAttempts") or meta.get("retries") or 1)
                            retry_delay_ms = int(meta.get("retry_delay_ms") or meta.get("retryDelayMs") or 0)
                            timeout_seconds_raw = meta.get("timeout_seconds") or meta.get("timeoutSeconds") or meta.get("timeout")
                            timeout_seconds = int(timeout_seconds_raw) if timeout_seconds_raw else None

                            await cooperate("before_download_urls", page, phase, shared, {
                                "download_item_total": len(items),
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
                                timeout_seconds=timeout_seconds,
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
                            page_shared = dict(shared or {})
                            logger.info(f"分页: 已获取 {len(all_data)} 条，继续第 {page + 1} 页...")
                            break

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
