#!/usr/bin/env python3
"""Browser execution backends for the crawshrimp web-agent protocol.

The supported runtime backend is direct Chrome CDP: connect to a Chrome
instance with remote debugging enabled and run observation, action, and
network-capture primitives without depending on the crawshrimp app backend.
"""

from __future__ import annotations

import argparse
import asyncio
import inspect
import json
import re
import shutil
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, ProxyHandler

try:
    from scripts.web_agent_protocol import PageState
except ModuleNotFoundError:
    from web_agent_protocol import PageState


JsonPayload = dict[str, Any] | list[Any] | str | int | float | bool | None


@dataclass(frozen=True)
class BrowserAction:
    kind: str
    script: str = ""
    selector: str = ""
    text: str = ""
    value: str | None = None
    files: list[str] = field(default_factory=list)
    clicks: list[dict[str, Any]] = field(default_factory=list)
    wheels: list[dict[str, Any]] = field(default_factory=list)
    url: str = ""
    x: float | None = None
    y: float | None = None
    capture_mode: str = "passive"
    matches: list[dict[str, Any]] = field(default_factory=list)
    min_matches: int = 0
    include_response_body: bool = False
    timeout_ms: int = 8000
    settle_ms: int = 1000
    user_gesture: bool = False


@dataclass(frozen=True)
class BrowserResult:
    ok: bool
    action: str
    data: dict[str, Any] = field(default_factory=dict)
    error: str = ""

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, indent=2)


def snapshot_download_dir(download_dir: Path | str) -> dict[str, dict[str, int]]:
    directory = Path(download_dir).expanduser()
    snapshot: dict[str, dict[str, int]] = {}
    if not directory.exists() or not directory.is_dir():
        return snapshot
    for path in directory.iterdir():
        if not path.is_file() or path.name.endswith(".crdownload"):
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        snapshot[str(path)] = {"mtime_ns": stat.st_mtime_ns, "size": stat.st_size}
    return snapshot


def find_new_download(
    download_dir: Path | str,
    baseline: dict[str, dict[str, int]],
    *,
    expected_file: str = "",
    started_at_ns: int | None = None,
) -> dict[str, Any] | None:
    directory = Path(download_dir).expanduser()
    if not directory.exists() or not directory.is_dir():
        return None
    expected_name = Path(str(expected_file or "")).name
    threshold_ns = max(int(started_at_ns or 0) - 2_000_000_000, 0)
    newest: tuple[int, Path, int] | None = None
    for path in directory.iterdir():
        if not path.is_file() or path.name.endswith(".crdownload"):
            continue
        if expected_name and path.name != expected_name:
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        previous = baseline.get(str(path))
        if previous and stat.st_mtime_ns <= int(previous.get("mtime_ns") or 0) and stat.st_size == int(previous.get("size") or 0):
            continue
        if stat.st_mtime_ns < threshold_ns:
            continue
        if newest is None or stat.st_mtime_ns > newest[0]:
            newest = (stat.st_mtime_ns, path, stat.st_size)
    if newest is None:
        return None
    _, path, size = newest
    return {
        "path": str(path),
        "filename": path.name,
        "bytes": size,
        "download_dir": str(directory),
    }


def _resolve_existing_files(files: list[str]) -> tuple[list[str], str]:
    resolved: list[str] = []
    for raw_path in files or []:
        path = Path(str(raw_path or "")).expanduser()
        if not path.is_file():
            return [], f"upload file not found: {raw_path}"
        resolved.append(str(path.resolve()))
    return resolved, ""


def _json_request(url: str, *, method: str = "GET", payload: dict[str, Any] | None = None, headers: dict[str, str] | None = None, timeout: float = 30) -> JsonPayload:
    request_headers = dict(headers or {})
    data = None
    if payload is not None:
        request_headers["Content-Type"] = "application/json"
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(url, data=data, headers=request_headers, method=method)
    opener = build_opener(ProxyHandler({}))
    try:
        with opener.open(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else None
    except HTTPError as exc:
        body = exc.read().decode("utf-8", "ignore")
        raise RuntimeError(f"HTTP {exc.code}: {body or exc.reason}") from exc
    except URLError as exc:
        raise RuntimeError(str(exc.reason)) from exc


async def _websocket_send(ws_url: str, message: dict[str, Any], timeout: float = 10) -> dict[str, Any]:
    try:
        import websockets
    except ImportError as exc:
        raise RuntimeError("Chrome CDP WebSocket support requires the 'websockets' package.") from exc

    async with websockets.connect(ws_url, max_size=50 * 1024 * 1024, proxy=None) as ws:
        await ws.send(json.dumps(message))
        while True:
            raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
            payload = json.loads(raw)
            if payload.get("id") == message.get("id"):
                return payload


def request_matches(entry: dict[str, Any], matches: list[dict[str, Any]] | None, *, ignore_body_contains: bool = False) -> bool:
    if not matches:
        return True
    url = str(entry.get("url") or "")
    method = str(entry.get("method") or "").upper()
    mime_type = str(entry.get("mimeType") or entry.get("mime_type") or "")
    body = str(entry.get("body") or "")
    status = entry.get("status")
    for rule in matches:
        if not isinstance(rule, dict):
            continue
        url_contains = str(rule.get("url_contains") or rule.get("contains") or "").strip()
        url_equals = str(rule.get("url") or rule.get("url_equals") or "").strip()
        url_regex = str(rule.get("url_regex") or "").strip()
        method_equals = str(rule.get("method") or "").strip().upper()
        expected_status = rule.get("status")
        mime_contains = str(rule.get("mime_type_contains") or rule.get("mime_contains") or "").strip()
        body_contains = str(rule.get("body_contains") or "").strip()
        if url_contains and url_contains not in url:
            continue
        if url_equals and url_equals != url:
            continue
        if url_regex:
            try:
                if not re.search(url_regex, url):
                    continue
            except re.error:
                continue
        if method_equals and method_equals != method:
            continue
        if expected_status is not None:
            try:
                if int(status) != int(expected_status):
                    continue
            except Exception:
                continue
        if mime_contains and mime_contains not in mime_type:
            continue
        if body_contains and not ignore_body_contains and body_contains not in body:
            continue
        return True
    return False


def _request_matches(entry: dict[str, Any], matches: list[dict[str, Any]] | None) -> bool:
    return request_matches(entry, matches)


def _click_messages(x: float, y: float) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    for event_type in ("mouseMoved", "mousePressed", "mouseReleased"):
        params: dict[str, Any] = {"type": event_type, "x": x, "y": y, "modifiers": 0}
        if event_type == "mouseMoved":
            params.update({"button": "none", "clickCount": 0})
        elif event_type == "mousePressed":
            params.update({"button": "left", "clickCount": 1, "buttons": 1})
        else:
            params.update({"button": "left", "clickCount": 1, "buttons": 0})
        messages.append({"method": "Input.dispatchMouseEvent", "params": params})
    return messages


async def _websocket_capture(
    ws_url: str,
    setup_messages: list[dict[str, Any]],
    timeout_ms: int,
    trigger: list[dict[str, Any]] | None = None,
    matches: list[dict[str, Any]] | None = None,
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    try:
        import websockets
    except ImportError as exc:
        raise RuntimeError("Chrome CDP WebSocket support requires the 'websockets' package.") from exc

    next_id = 0
    matched: list[dict[str, Any]] = []
    requests_by_id: dict[str, dict[str, Any]] = {}
    seen: set[str] = set()
    response_buffer: dict[int, dict[str, Any]] = {}
    options = options or {}
    min_matches = int(options.get("min_matches") or options.get("minMatches") or 0)
    settle_ms = int(options.get("settle_ms") or options.get("settleMs") or 0)
    include_response_body = bool(options.get("include_response_body") or options.get("includeResponseBody"))
    body_match_requested = any(isinstance(rule, dict) and str(rule.get("body_contains") or "").strip() for rule in matches or [])
    last_match_at = 0.0

    async with websockets.connect(ws_url, max_size=50 * 1024 * 1024, proxy=None) as ws:
        async def send(method: str, params: dict[str, Any] | None = None, timeout_seconds: float = 10.0) -> dict[str, Any]:
            nonlocal next_id
            next_id += 1
            current_id = next_id
            await ws.send(json.dumps({"id": current_id, "method": method, "params": params or {}}))
            deadline = asyncio.get_event_loop().time() + max(timeout_seconds, 0.1)
            while True:
                buffered = response_buffer.pop(current_id, None)
                if buffered is not None:
                    return buffered
                remaining = deadline - asyncio.get_event_loop().time()
                if remaining <= 0:
                    raise asyncio.TimeoutError(f"CDP command timeout: {method}")
                raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                payload = json.loads(raw)
                if payload.get("id") == current_id:
                    return payload
                if payload.get("id") is not None:
                    response_buffer[int(payload["id"])] = payload
                    continue
                if payload.get("method"):
                    await process_event(payload)

        async def process_event(payload: dict[str, Any]) -> None:
            nonlocal last_match_at
            method = payload.get("method")
            params = payload.get("params") or {}
            if method == "Network.requestWillBeSent":
                request_id = str(params.get("requestId") or "")
                request = params.get("request") or {}
                entry = requests_by_id.setdefault(request_id, {})
                entry.update(
                    {
                        "requestId": request_id,
                        "url": request.get("url") or "",
                        "method": request.get("method") or "",
                        "postData": request.get("postData"),
                        "headers": request.get("headers") or {},
                    }
                )
                return
            if method == "Network.responseReceived":
                request_id = str(params.get("requestId") or "")
                response = params.get("response") or {}
                entry = requests_by_id.setdefault(request_id, {})
                entry.update(
                    {
                        "requestId": request_id,
                        "responseUrl": response.get("url") or entry.get("url") or "",
                        "url": entry.get("url") or response.get("url") or "",
                        "status": response.get("status"),
                        "mimeType": response.get("mimeType") or "",
                        "responseHeaders": response.get("headers") or {},
                    }
                )
                return
            if method == "Network.loadingFailed":
                request_id = str(params.get("requestId") or "")
                entry = requests_by_id.setdefault(request_id, {})
                entry["error"] = str(params.get("errorText") or "Network.loadingFailed")
                return
            if method != "Network.loadingFinished":
                return
            request_id = str(params.get("requestId") or "")
            entry = requests_by_id.get(request_id) or {}
            if request_id in seen or not entry.get("url"):
                return
            if not request_matches(entry, matches, ignore_body_contains=True):
                return
            if include_response_body or body_match_requested:
                try:
                    body_result = await send("Network.getResponseBody", {"requestId": request_id}, timeout_seconds=5.0)
                    body_payload = body_result.get("result") or {}
                    if isinstance(body_payload.get("body"), str):
                        body = body_payload.get("body")
                        entry["body"] = body[:2_000_000] if len(body) > 2_000_000 else body
                        entry["base64Encoded"] = bool(body_payload.get("base64Encoded"))
                except Exception:
                    pass
            if not request_matches(entry, matches):
                return
            seen.add(request_id)
            last_match_at = time.monotonic()
            matched.append(
                {
                    "requestId": request_id,
                    "url": entry.get("url") or "",
                    "responseUrl": entry.get("responseUrl") or entry.get("url") or "",
                    "method": entry.get("method") or "",
                    "status": entry.get("status"),
                    "mimeType": entry.get("mimeType") or "",
                    "postData": entry.get("postData"),
                    "headers": entry.get("headers") or {},
                    "responseHeaders": entry.get("responseHeaders") or {},
                    "body": entry.get("body"),
                    "base64Encoded": bool(entry.get("base64Encoded")),
                    "error": entry.get("error") or "",
                }
            )

        for message in setup_messages:
            await send(str(message.get("method")), message.get("params") or {})
        if trigger:
            for message in trigger:
                if message.get("method") == "__sleep":
                    await asyncio.sleep(float((message.get("params") or {}).get("ms") or 0) / 1000.0)
                    continue
                await send(str(message.get("method")), message.get("params") or {})

        deadline = asyncio.get_event_loop().time() + max(timeout_ms, 1000) / 1000
        required_matches = max(min_matches, 1) if matches else max(min_matches, 0)
        settle_seconds = max(settle_ms, 0) / 1000.0
        while asyncio.get_event_loop().time() < deadline:
            if required_matches and len(matched) >= required_matches and last_match_at and time.monotonic() - last_match_at >= settle_seconds:
                break
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
            except asyncio.TimeoutError:
                continue
            payload = json.loads(raw)
            if payload.get("method"):
                await process_event(payload)
            elif payload.get("id") is not None:
                response_buffer[int(payload["id"])] = payload
    ok = len(matched) >= required_matches if required_matches else True
    return {"ok": ok, "matches": matched, "total": len(matched), "minMatches": required_matches}


async def _websocket_file_chooser(
    ws_url: str,
    clicks: list[dict[str, Any]],
    files: list[str],
    timeout_ms: int,
) -> dict[str, Any]:
    try:
        import websockets
    except ImportError as exc:
        raise RuntimeError("Chrome CDP WebSocket support requires the 'websockets' package.") from exc

    next_id = 0
    chooser_event: dict[str, Any] = {}
    response_buffer: dict[int, dict[str, Any]] = {}

    async with websockets.connect(ws_url, max_size=50 * 1024 * 1024, proxy=None) as ws:
        async def send(method: str, params: dict[str, Any] | None = None, timeout: float = 10.0) -> dict[str, Any]:
            nonlocal next_id, chooser_event
            next_id += 1
            current_id = next_id
            await ws.send(json.dumps({"id": current_id, "method": method, "params": params or {}}))
            deadline = asyncio.get_event_loop().time() + max(timeout, 0.1)
            while True:
                buffered = response_buffer.pop(current_id, None)
                if buffered is not None:
                    return buffered
                remaining = deadline - asyncio.get_event_loop().time()
                if remaining <= 0:
                    raise asyncio.TimeoutError(f"CDP command timeout: {method}")
                raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                payload = json.loads(raw)
                if payload.get("id") == current_id:
                    return payload
                if payload.get("method") == "Page.fileChooserOpened" and not chooser_event:
                    chooser_event = dict(payload.get("params") or {})
                elif payload.get("id") is not None:
                    response_buffer[int(payload["id"])] = payload

        await send("Page.enable")
        await send("DOM.enable")
        await send("Runtime.enable")
        await send("Page.bringToFront")
        await send("Page.setInterceptFileChooserDialog", {"enabled": True})
        try:
            for click in clicks:
                x = float(click["x"])
                y = float(click["y"])
                delay_ms = int(click.get("delay_ms", 120))
                for message in _click_messages(x, y):
                    await send(message["method"], message["params"])
                if delay_ms > 0:
                    await asyncio.sleep(delay_ms / 1000.0)
            deadline = asyncio.get_event_loop().time() + max(timeout_ms, 1000) / 1000.0
            while not chooser_event and asyncio.get_event_loop().time() < deadline:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=0.25)
                except asyncio.TimeoutError:
                    continue
                payload = json.loads(raw)
                if payload.get("method") == "Page.fileChooserOpened" and not chooser_event:
                    chooser_event = dict(payload.get("params") or {})
                elif payload.get("id") is not None:
                    response_buffer[int(payload["id"])] = payload
            backend_node_id = int(chooser_event.get("backendNodeId") or 0)
            if backend_node_id <= 0:
                return {"success": False, "error": "file chooser not captured"}
            response = await send("DOM.setFileInputFiles", {"backendNodeId": backend_node_id, "files": files})
            if response.get("error"):
                return {"success": False, "error": json.dumps(response["error"], ensure_ascii=False)}
            return {"success": True, "backendNodeId": backend_node_id, "fileCount": len(files), "mode": chooser_event.get("mode") or ""}
        finally:
            try:
                await send("Page.setInterceptFileChooserDialog", {"enabled": False}, timeout=5.0)
            except Exception:
                pass


async def _websocket_browser_session_download(ws_url: str, url: str, download_path: Path, timeout_seconds: int) -> dict[str, Any]:
    try:
        import websockets
    except ImportError as exc:
        raise RuntimeError("Chrome CDP WebSocket support requires the 'websockets' package.") from exc

    next_id = 0
    response_buffer: dict[int, dict[str, Any]] = {}

    async with websockets.connect(ws_url, max_size=50 * 1024 * 1024, proxy=None) as ws:
        async def send(method: str, params: dict[str, Any] | None = None, timeout: float = 10.0) -> dict[str, Any]:
            nonlocal next_id
            next_id += 1
            current_id = next_id
            await ws.send(json.dumps({"id": current_id, "method": method, "params": params or {}}))
            deadline = asyncio.get_event_loop().time() + max(timeout, 0.1)
            while True:
                buffered = response_buffer.pop(current_id, None)
                if buffered is not None:
                    return buffered
                remaining = deadline - asyncio.get_event_loop().time()
                if remaining <= 0:
                    raise asyncio.TimeoutError(f"CDP command timeout: {method}")
                raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                payload = json.loads(raw)
                if payload.get("id") == current_id:
                    return payload
                if payload.get("id") is not None:
                    response_buffer[int(payload["id"])] = payload

        await send("Page.enable")
        await send("Page.setDownloadBehavior", {"behavior": "allow", "downloadPath": str(download_path)})
        return await send("Page.navigate", {"url": url}, timeout=max(float(timeout_seconds), 10.0))


def _safe_list(raw: Any) -> list[Any]:
    return raw if isinstance(raw, list) else []


def _control_name(item: dict[str, Any]) -> str:
    for key in ("name", "text", "label", "placeholder", "title", "ariaLabel", "selector"):
        value = str(item.get(key) or "").strip()
        if value:
            return value
    return ""


def normalize_crawshrimp_snapshot(snapshot: dict[str, Any]) -> PageState:
    dom = snapshot.get("dom") or snapshot
    controls: list[dict[str, Any]] = []

    for item in _safe_list(dom.get("buttons")):
        if isinstance(item, dict):
            controls.append({"role": "button", "name": _control_name(item), **item})
    for item in _safe_list(dom.get("inputs")):
        if isinstance(item, dict):
            controls.append({"role": "input", "name": _control_name(item), **item})
    for key, role in (("selects", "select"), ("links", "link"), ("tabs", "tab"), ("menus", "menu")):
        for item in _safe_list(dom.get(key)):
            if isinstance(item, dict):
                controls.append({"role": role, "name": _control_name(item), **item})

    visible_text: list[str] = []
    for key in ("headings", "visible_text", "texts"):
        for value in _safe_list(dom.get(key)):
            if isinstance(value, str) and value.strip():
                visible_text.append(value.strip())

    network: list[dict[str, Any]] = []
    knowledge = snapshot.get("knowledge") or {}
    for card in _safe_list(knowledge.get("cards")):
        if isinstance(card, dict):
            network.append({"kind": "knowledge", **card})
    for item in _safe_list(dom.get("resources")):
        if isinstance(item, dict):
            network.append({"kind": "resource", **item})
    for item in _safe_list(dom.get("network")):
        if isinstance(item, dict):
            network.append(item)

    context = dom.get("context") if isinstance(dom.get("context"), dict) else {}
    if isinstance(dom.get("framework"), dict):
        context = {**context, "framework": dom.get("framework")}
    if isinstance(dom.get("stores"), list):
        context = {**context, "stores": [item for item in dom.get("stores") if isinstance(item, dict)]}

    return PageState(
        url=str(dom.get("url") or ""),
        title=str(dom.get("title") or ""),
        visible_text=visible_text,
        controls=controls,
        tables=[item for item in _safe_list(dom.get("tables")) if isinstance(item, dict)],
        downloads=[item for item in _safe_list(dom.get("downloads")) if isinstance(item, dict)],
        network=network,
        blocking_states=[item for item in _safe_list(dom.get("blocking_states")) if isinstance(item, dict)],
        context=context,
        active_regions=[item for item in _safe_list(dom.get("active_regions")) if isinstance(item, dict)],
        accessibility=[item for item in _safe_list(dom.get("accessibility")) if isinstance(item, dict)],
    )


class ChromeCDPBackend:
    def __init__(
        self,
        *,
        cdp_url: str = "http://127.0.0.1:9222",
        tab_id: str = "",
        url_prefix: str = "",
        get_json: Callable[[str], JsonPayload] | None = None,
        send_ws: Callable[[str, dict[str, Any], float], Any] | None = None,
        capture_ws: Callable[..., Any] | None = None,
        file_chooser_ws: Callable[[str, list[dict[str, Any]], list[str], int], Any] | None = None,
        browser_download_ws: Callable[[str, str, Path, int], Any] | None = None,
        new_tab: Callable[[str], Any] | None = None,
        close_tab: Callable[[str], Any] | None = None,
    ) -> None:
        self.cdp_url = cdp_url.rstrip("/")
        self.tab_id = tab_id
        self.url_prefix = url_prefix
        self._get_json = get_json
        self._send_ws = send_ws or _websocket_send
        self._capture_ws = capture_ws or _websocket_capture
        self._file_chooser_ws = file_chooser_ws or _websocket_file_chooser
        self._browser_download_ws = browser_download_ws or _websocket_browser_session_download
        self._new_tab = new_tab
        self._close_tab = close_tab
        self._message_id = 0

    def _next_id(self) -> int:
        self._message_id += 1
        return self._message_id

    def _get(self, path: str) -> JsonPayload:
        if self._get_json:
            return self._get_json(path)
        return _json_request(self.cdp_url + path)

    def new_tab(self, url: str) -> dict[str, Any]:
        if self._new_tab:
            result = self._new_tab(url)
            if isinstance(result, dict):
                return result
            raise RuntimeError("new_tab hook must return a tab dictionary")
        payload = _json_request(f"{self.cdp_url}/json/new?{quote(str(url or ''), safe='')}", method="PUT")
        if not isinstance(payload, dict):
            raise RuntimeError("Chrome /json/new did not return a tab object")
        return payload

    def close_tab(self, tab_id: str) -> None:
        safe_tab_id = str(tab_id or "").strip()
        if not safe_tab_id:
            return
        if self._close_tab:
            self._close_tab(safe_tab_id)
            return
        try:
            self._get(f"/json/close/{quote(safe_tab_id, safe='')}")
        except Exception:
            pass

    async def _call_capture_ws(
        self,
        ws_url: str,
        setup: list[dict[str, Any]],
        action: BrowserAction,
        trigger: list[dict[str, Any]] | None,
    ) -> dict[str, Any]:
        options = {
            "settle_ms": action.settle_ms,
            "min_matches": action.min_matches,
            "include_response_body": action.include_response_body,
        }
        try:
            signature = inspect.signature(self._capture_ws)
            params = signature.parameters
            supports_options = (
                "options" in params
                or any(param.kind == inspect.Parameter.VAR_KEYWORD for param in params.values())
                or len(params) >= 6
            )
        except (TypeError, ValueError):
            supports_options = True
        if supports_options:
            capture = self._capture_ws(ws_url, setup, action.timeout_ms, trigger, action.matches, options)
        else:
            capture = self._capture_ws(ws_url, setup, action.timeout_ms, trigger, action.matches)
        if hasattr(capture, "__await__"):
            capture = await capture
        return capture if isinstance(capture, dict) else {"capture": capture}

    def list_tabs(self) -> list[dict[str, Any]]:
        tabs = self._get("/json")
        return [tab for tab in _safe_list(tabs) if isinstance(tab, dict) and tab.get("type") == "page"]

    def select_tab(self) -> dict[str, Any]:
        tabs = self.list_tabs()
        if self.tab_id:
            for tab in tabs:
                if str(tab.get("id")) == self.tab_id:
                    return tab
            raise RuntimeError(f"Chrome tab not found: {self.tab_id}")
        if self.url_prefix:
            candidates = [tab for tab in tabs if str(tab.get("url") or "").startswith(self.url_prefix)]
            if len(candidates) == 1:
                return candidates[0]
            if not candidates:
                raise RuntimeError(f"No Chrome tab matches URL prefix: {self.url_prefix}")
            raise RuntimeError(f"Multiple Chrome tabs match URL prefix: {self.url_prefix}")
        if len(tabs) == 1:
            return tabs[0]
        raise RuntimeError("Specify --tab-id or --url-prefix when multiple Chrome tabs are open.")

    def list_page_tab_ids(self) -> set[str]:
        return {str(tab.get("id") or "") for tab in self.list_tabs() if str(tab.get("id") or "")}

    def _is_transient_download_tab(self, tab: dict[str, Any]) -> bool:
        url = str(tab.get("url") or "")
        return (
            "link-agent-seller" in url
            or "bill-download-with-detail" in url
            or "/main/authentication" in url
            or (url == "about:blank" and str(tab.get("id") or "") != str(self.tab_id or ""))
        )

    def _download_name_pattern(self, url: str, fallback: str = "") -> re.Pattern[str] | None:
        raw = Path(str(fallback or "")).name
        if not raw:
            try:
                raw = Path(url.split("?", 1)[0]).name
            except Exception:
                raw = ""
        if not raw:
            return None
        stem = Path(raw).stem
        suffix = Path(raw).suffix
        if not stem:
            return None
        if suffix:
            return re.compile(rf"^{re.escape(stem)}(?: \(\d+\))?{re.escape(suffix)}$", re.IGNORECASE)
        return re.compile(rf"^{re.escape(raw)}(?: \(\d+\))?$", re.IGNORECASE)

    def _snapshot_files(self, directories: list[Path], pattern: re.Pattern[str] | None = None) -> dict[str, tuple[int, int]]:
        snapshot: dict[str, tuple[int, int]] = {}
        for directory in directories:
            if not directory.exists() or not directory.is_dir():
                continue
            for path in directory.iterdir():
                if not path.is_file() or path.name.endswith(".crdownload"):
                    continue
                if pattern and not pattern.match(path.name):
                    continue
                try:
                    stat = path.stat()
                except OSError:
                    continue
                snapshot[str(path)] = (stat.st_mtime_ns, stat.st_size)
        return snapshot

    def _find_new_file(
        self,
        directories: list[Path],
        baseline: dict[str, tuple[int, int]],
        pattern: re.Pattern[str] | None,
        started_at_ns: int,
    ) -> Path | None:
        newest: tuple[int, Path] | None = None
        threshold_ns = max(int(started_at_ns or 0) - 2_000_000_000, 0)
        for directory in directories:
            if not directory.exists() or not directory.is_dir():
                continue
            for path in directory.iterdir():
                if not path.is_file() or path.name.endswith(".crdownload"):
                    continue
                if pattern and not pattern.match(path.name):
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

    async def _send_to_ws(self, ws_url: str, method: str, params: dict[str, Any] | None = None, *, timeout: float = 10) -> dict[str, Any]:
        message = {"id": self._next_id(), "method": method, "params": params or {}}
        result = self._send_ws(ws_url, message, timeout)
        if hasattr(result, "__await__"):
            return await result
        return result

    async def download_browser_session(self, item: dict[str, Any], target_path: Path | str, timeout_seconds: int) -> dict[str, Any]:
        url = str((item or {}).get("url") or "").strip()
        if not url:
            return {"success": False, "path": str(target_path), "error": "browser session download requires url", "browserSession": True}
        target = Path(target_path).expanduser()
        temp_tab_id = ""
        temp_dir = Path(tempfile.mkdtemp(prefix="crawshrimp-skill-browser-download-"))
        default_download_dir = Path.home() / "Downloads"
        watch_dirs = [temp_dir]
        if default_download_dir != temp_dir:
            watch_dirs.append(default_download_dir)
        pattern = self._download_name_pattern(url, str((item or {}).get("expected_file") or (item or {}).get("filename") or ""))
        fallback_pattern = re.compile(r".+\.(xlsx|xls|csv|zip|pdf|json|txt)$", re.IGNORECASE)
        baseline = self._snapshot_files(watch_dirs, pattern)
        fallback_baseline = self._snapshot_files(watch_dirs, fallback_pattern)
        started_at_ns = time.time_ns()
        try:
            temp_tab = self.new_tab("about:blank")
            temp_tab_id = str(temp_tab.get("id") or "")
            ws_url = str(temp_tab.get("webSocketDebuggerUrl") or "")
            if not ws_url:
                return {"success": False, "path": str(target), "error": "temporary browser download tab has no websocket", "browserSession": True}
            response = self._browser_download_ws(ws_url, url, temp_dir, int(timeout_seconds or 1))
            if hasattr(response, "__await__"):
                response = await response
            response = response if isinstance(response, dict) else {}
            if response.get("error"):
                return {"success": False, "path": str(target), "error": json.dumps(response["error"], ensure_ascii=False), "browserSession": True}
            deadline = time.monotonic() + max(int(timeout_seconds or 1), 1)
            downloaded: Path | None = None
            matched_by = "expected_name"
            while time.monotonic() < deadline:
                downloaded = self._find_new_file(watch_dirs, baseline, pattern, started_at_ns)
                if not downloaded:
                    downloaded = self._find_new_file(watch_dirs, fallback_baseline, fallback_pattern, started_at_ns)
                    if downloaded:
                        matched_by = "fallback_any_artifact"
                if downloaded:
                    break
                await asyncio.sleep(0.2)
            if not downloaded:
                return {"success": False, "path": str(target), "error": "browser session download timed out", "browserSession": True}
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                stem = target.stem
                suffix = target.suffix
                index = 2
                while target.exists():
                    target = target.with_name(f"{stem}_{index}{suffix}")
                    index += 1
            shutil.move(str(downloaded), str(target))
            return {
                "success": True,
                "path": str(target),
                "filename": target.name,
                "url": url,
                "sourcePath": str(downloaded),
                "bytes": target.stat().st_size if target.exists() else 0,
                "matchedBy": matched_by,
                "browserSession": True,
            }
        finally:
            if temp_tab_id:
                self.close_tab(temp_tab_id)
            shutil.rmtree(temp_dir, ignore_errors=True)

    def close_new_tabs(self, baseline_tab_ids: set[str]) -> None:
        for tab in self.list_tabs():
            tab_id = str(tab.get("id") or "")
            if not tab_id or tab_id in baseline_tab_ids or tab_id == str(self.tab_id or ""):
                continue
            if not self._is_transient_download_tab(tab):
                continue
            if self._close_tab:
                self.close_tab(tab_id)
            else:
                self.close_tab(tab_id)

    def _build_transient_confirm_script(self) -> str:
        return """
(() => {
  const textOf = (el) => String(el?.innerText || el?.textContent || '').replace(/\\s+/g, ' ').trim();
  const visible = (el) => !!(el && typeof el.getClientRects === 'function' && el.getClientRects().length > 0);
  const clickLike = (el) => {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
    try { el.click?.(); } catch (e) {}
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
      try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })); } catch (e) {}
    }
    return true;
  };
  const bodyText = textOf(document.body);
  const modalPresent = /确认授权|确认并前往|Seller\\s*Central|authentication/i.test(bodyText);
  let confirmClicked = false;
  if (modalPresent) {
    const checkbox = [...document.querySelectorAll('input[type=checkbox],[role=checkbox]')].filter(visible)[0];
    if (checkbox && !checkbox.checked) clickLike(checkbox);
    const button = [...document.querySelectorAll('button,a,[role=button]')]
      .filter(visible)
      .find((el) => /确认|前往|授权|continue|confirm/i.test(textOf(el)));
    confirmClicked = clickLike(button);
  }
  return { success: true, data: [{ handled: confirmClicked, modalPresent, title: document.title, url: location.href, confirmClicked }], meta: { has_more: false } };
})()
""".strip()

    def handle_transient_download_tabs(self) -> list[dict[str, Any]]:
        actions: list[dict[str, Any]] = []
        current_tab_id = str(self.tab_id or "")
        original_tab_id = self.tab_id
        original_url_prefix = self.url_prefix
        try:
            for tab in self.list_tabs():
                tab_id = str(tab.get("id") or "")
                if not tab_id or tab_id == current_tab_id or not self._is_transient_download_tab(tab):
                    continue
                self.tab_id = tab_id
                self.url_prefix = ""
                try:
                    result = self.execute(BrowserAction(kind="eval", script=self._build_transient_confirm_script(), user_gesture=True))
                except Exception:
                    continue
                value = result.data.get("value") if isinstance(result.data, dict) else {}
                if result.ok and isinstance(value, dict):
                    rows = value.get("data") if isinstance(value.get("data"), list) else []
                    for row in rows:
                        if isinstance(row, dict) and (row.get("handled") or row.get("modalPresent")):
                            actions.append({**row, "tabId": tab_id})
        finally:
            self.tab_id = original_tab_id
            self.url_prefix = original_url_prefix
        return actions

    async def handle_transient_download_tabs_async(self) -> list[dict[str, Any]]:
        actions: list[dict[str, Any]] = []
        current_tab_id = str(self.tab_id or "")
        original_tab_id = self.tab_id
        original_url_prefix = self.url_prefix
        try:
            for tab in self.list_tabs():
                tab_id = str(tab.get("id") or "")
                if not tab_id or tab_id == current_tab_id or not self._is_transient_download_tab(tab):
                    continue
                self.tab_id = tab_id
                self.url_prefix = ""
                try:
                    result = await self.execute_async(BrowserAction(kind="eval", script=self._build_transient_confirm_script(), user_gesture=True))
                except Exception:
                    continue
                value = result.data.get("value") if isinstance(result.data, dict) else {}
                if result.ok and isinstance(value, dict):
                    rows = value.get("data") if isinstance(value.get("data"), list) else []
                    for row in rows:
                        if isinstance(row, dict) and (row.get("handled") or row.get("modalPresent")):
                            actions.append({**row, "tabId": tab_id})
        finally:
            self.tab_id = original_tab_id
            self.url_prefix = original_url_prefix
        return actions

    def observe(self) -> PageState:
        tab = self.select_tab()
        return PageState(
            url=str(tab.get("url") or ""),
            title=str(tab.get("title") or ""),
            visible_text=[str(tab.get("title") or "").strip()] if str(tab.get("title") or "").strip() else [],
        )

    async def _send(self, method: str, params: dict[str, Any] | None = None, *, timeout: float = 10) -> dict[str, Any]:
        tab = self.select_tab()
        ws_url = str(tab.get("webSocketDebuggerUrl") or "")
        if not ws_url:
            raise RuntimeError("Selected Chrome tab does not expose webSocketDebuggerUrl.")
        message = {"id": self._next_id(), "method": method, "params": params or {}}
        result = self._send_ws(ws_url, message, timeout)
        if hasattr(result, "__await__"):
            return await result
        return result

    async def execute_async(self, action: BrowserAction) -> BrowserResult:
        kind = action.kind.strip().lower()
        if kind == "eval":
            response = await self._send(
                "Runtime.evaluate",
                {
                    "expression": action.script,
                    "awaitPromise": True,
                    "returnByValue": True,
                    "userGesture": bool(action.user_gesture),
                    "timeout": action.timeout_ms,
                },
                timeout=max(action.timeout_ms / 1000 + 5, 10),
            )
            if response.get("error"):
                return BrowserResult(ok=False, action=kind, error=json.dumps(response["error"], ensure_ascii=False))
            result = ((response.get("result") or {}).get("result") or {})
            exception = (response.get("result") or {}).get("exceptionDetails")
            if exception:
                return BrowserResult(ok=False, action=kind, data=result, error=json.dumps(exception, ensure_ascii=False))
            return BrowserResult(ok=True, action=kind, data=result)
        if kind == "click":
            if action.x is None or action.y is None:
                raise ValueError("CDP click requires x and y coordinates.")
            try:
                await self._send("Page.bringToFront", {})
            except Exception:
                pass
            for message in _click_messages(action.x, action.y):
                await self._send(message["method"], message["params"])
            return BrowserResult(ok=True, action=kind, data={"x": action.x, "y": action.y})
        if kind == "navigate":
            if not action.url:
                raise ValueError("CDP navigate requires url.")
            try:
                await self._send("Page.enable", {})
            except Exception:
                pass
            response = await self._send("Page.navigate", {"url": action.url})
            if response.get("error"):
                return BrowserResult(ok=False, action=kind, error=json.dumps(response["error"], ensure_ascii=False))
            return BrowserResult(ok=True, action=kind, data={"url": action.url})
        if kind == "reload":
            try:
                await self._send("Page.enable", {})
            except Exception:
                pass
            response = await self._send("Page.reload", {"ignoreCache": True})
            if response.get("error"):
                return BrowserResult(ok=False, action=kind, error=json.dumps(response["error"], ensure_ascii=False))
            return BrowserResult(ok=True, action=kind, data={"reloaded": True})
        if kind == "upload":
            if not action.files:
                raise ValueError("CDP upload requires files.")
            files, file_error = _resolve_existing_files(action.files)
            if file_error:
                return BrowserResult(ok=False, action=kind, error=file_error)
            tab = self.select_tab()
            ws_url = str(tab.get("webSocketDebuggerUrl") or "")
            if not ws_url:
                raise RuntimeError("Selected Chrome tab does not expose webSocketDebuggerUrl.")
            selector = action.selector.strip()
            if not selector:
                raise ValueError("CDP upload requires selector.")
            expression = f"""
(() => {{
  const input = document.querySelector({json.dumps(selector)});
  if (!input) return {{ ok: false, error: 'file input not found', selector: {json.dumps(selector)} }};
  return {{ ok: true, selector: {json.dumps(selector)} }};
}})()
""".strip()
            locate = await self._send(
                "Runtime.evaluate",
                {"expression": expression, "awaitPromise": True, "returnByValue": True},
            )
            value = (((locate.get("result") or {}).get("result") or {}).get("value") or {})
            if not value.get("ok"):
                return BrowserResult(ok=False, action=kind, error=str(value.get("error") or "file input not found"))
            describe = await self._send("DOM.getDocument", {"depth": -1, "pierce": True})
            root_id = (((describe.get("result") or {}).get("root") or {}).get("nodeId"))
            query = await self._send("DOM.querySelector", {"nodeId": root_id, "selector": selector})
            node_id = (query.get("result") or {}).get("nodeId")
            if not node_id:
                return BrowserResult(ok=False, action=kind, error=f"file input not found: {selector}")
            response = await self._send("DOM.setFileInputFiles", {"nodeId": node_id, "files": files})
            if response.get("error"):
                return BrowserResult(ok=False, action=kind, error=json.dumps(response["error"], ensure_ascii=False))
            return BrowserResult(ok=True, action=kind, data={"selector": selector, "files": files, "fileCount": len(files)})
        if kind == "upload_chooser":
            if not action.files:
                raise ValueError("CDP file chooser upload requires files.")
            if not action.clicks:
                raise ValueError("CDP file chooser upload requires clicks.")
            files, file_error = _resolve_existing_files(action.files)
            if file_error:
                return BrowserResult(ok=False, action=kind, error=file_error)
            tab = self.select_tab()
            ws_url = str(tab.get("webSocketDebuggerUrl") or "")
            if not ws_url:
                raise RuntimeError("Selected Chrome tab does not expose webSocketDebuggerUrl.")
            result = self._file_chooser_ws(ws_url, list(action.clicks), files, action.timeout_ms)
            if hasattr(result, "__await__"):
                result = await result
            data = result if isinstance(result, dict) else {"result": result}
            if data.get("success") is False:
                return BrowserResult(ok=False, action=kind, data=data, error=str(data.get("error") or "file chooser upload failed"))
            data.setdefault("files", files)
            return BrowserResult(ok=True, action=kind, data=data)
        if kind == "capture":
            trigger: list[dict[str, Any]] | None = None
            if action.capture_mode == "click":
                if action.x is None or action.y is None:
                    if not action.clicks:
                        raise ValueError("CDP capture click requires x and y coordinates or clicks.")
                    trigger = [message for click in action.clicks for message in _click_messages(float(click["x"]), float(click["y"]))]
                else:
                    trigger = _click_messages(action.x, action.y)
            elif action.capture_mode == "wheel":
                wheels = list(action.wheels)
                if not wheels and action.x is not None and action.y is not None:
                    wheels = [{"x": action.x, "y": action.y, "delta_y": 600}]
                if not wheels:
                    raise ValueError("CDP capture wheel requires wheels or x/y coordinates.")
                trigger = []
                for wheel in wheels:
                    x = float(wheel["x"])
                    y = float(wheel["y"])
                    trigger.append({"method": "Input.dispatchMouseEvent", "params": {"type": "mouseMoved", "x": x, "y": y, "button": "none", "clickCount": 0, "modifiers": 0}})
                    trigger.append(
                        {
                            "method": "Input.dispatchMouseEvent",
                            "params": {
                                "type": "mouseWheel",
                                "x": x,
                                "y": y,
                                "deltaX": float(wheel.get("delta_x", wheel.get("deltaX", 0)) or 0),
                                "deltaY": float(wheel.get("delta_y", wheel.get("deltaY", 0)) or 0),
                                "modifiers": 0,
                            },
                        }
                    )
            elif action.capture_mode == "url":
                if not action.url:
                    raise ValueError("CDP capture url mode requires url.")
                trigger = [{"method": "Page.navigate", "params": {"url": action.url}}]
            elif action.capture_mode != "passive":
                raise ValueError(f"Unsupported CDP capture mode: {action.capture_mode}")
            tab = self.select_tab()
            ws_url = str(tab.get("webSocketDebuggerUrl") or "")
            if not ws_url:
                raise RuntimeError("Selected Chrome tab does not expose webSocketDebuggerUrl.")
            setup = [
                {"method": "Network.enable", "params": {}},
                {"method": "Page.enable", "params": {}},
                {"method": "Runtime.enable", "params": {}},
            ]
            opened_tab_id = ""
            if action.capture_mode == "url":
                temp_tab = self.new_tab("about:blank")
                opened_tab_id = str(temp_tab.get("id") or "")
                ws_url = str(temp_tab.get("webSocketDebuggerUrl") or "")
                if not ws_url:
                    if opened_tab_id:
                        self.close_tab(opened_tab_id)
                    raise RuntimeError("Temporary capture tab does not expose webSocketDebuggerUrl.")
                try:
                    capture = await self._call_capture_ws(ws_url, setup, action, trigger)
                finally:
                    if opened_tab_id:
                        self.close_tab(opened_tab_id)
                capture.setdefault("mode", "url")
                capture["openedTabId"] = opened_tab_id
                return BrowserResult(ok=bool(capture.get("ok", True)), action=kind, data=capture, error="" if capture.get("ok", True) else "capture did not reach required matches")
            capture = await self._call_capture_ws(ws_url, setup, action, trigger)
            capture.setdefault("mode", action.capture_mode)
            return BrowserResult(ok=bool(capture.get("ok", True)), action=kind, data=capture, error="" if capture.get("ok", True) else "capture did not reach required matches")
        raise ValueError(f"Unsupported CDP action: {action.kind}")

    def execute(self, action: BrowserAction) -> BrowserResult:
        return asyncio.run(self.execute_async(action))


def _print_json(payload: Any) -> None:
    if hasattr(payload, "to_json"):
        print(payload.to_json())
    else:
        print(json.dumps(payload, ensure_ascii=False, indent=2))


def _build_action(args: argparse.Namespace) -> BrowserAction:
    matches = json.loads(args.matches_json) if getattr(args, "matches_json", "") else []
    if not isinstance(matches, list):
        raise ValueError("--matches-json must be a JSON array")
    return BrowserAction(
        kind=args.action,
        script=getattr(args, "script", "") or "",
        url=getattr(args, "url", "") or "",
        x=getattr(args, "x", None),
        y=getattr(args, "y", None),
        wheels=[{"x": getattr(args, "x", None), "y": getattr(args, "y", None), "delta_y": getattr(args, "delta_y", 0)}] if getattr(args, "action", "") == "capture" and getattr(args, "capture_mode", "") == "wheel" and getattr(args, "x", None) is not None and getattr(args, "y", None) is not None else [],
        capture_mode=getattr(args, "capture_mode", "passive"),
        matches=matches,
        min_matches=getattr(args, "min_matches", 0),
        include_response_body=bool(getattr(args, "include_response_body", False)),
        timeout_ms=getattr(args, "timeout_ms", 8000),
        settle_ms=getattr(args, "settle_ms", 1000),
    )


def _command_cdp(args: argparse.Namespace) -> int:
    backend = ChromeCDPBackend(cdp_url=args.cdp_url, tab_id=args.tab_id, url_prefix=args.url_prefix)
    if args.action == "observe":
        _print_json(asdict(backend.observe()))
        return 0
    _print_json(backend.execute(_build_action(args)))
    return 0


def _add_action_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("action", choices=["observe", "eval", "click", "navigate", "reload", "capture"])
    parser.add_argument("--script", default="", help="JavaScript expression for eval")
    parser.add_argument("--url", default="", help="URL for navigate or capture-url mode")
    parser.add_argument("--x", type=float, default=None, help="X coordinate for CDP click or capture click")
    parser.add_argument("--y", type=float, default=None, help="Y coordinate for CDP click or capture click")
    parser.add_argument("--capture-mode", default="passive", choices=["passive", "click", "url", "wheel"])
    parser.add_argument("--delta-y", type=float, default=600)
    parser.add_argument("--matches-json", default="", help="JSON array of request matchers")
    parser.add_argument("--min-matches", type=int, default=0)
    parser.add_argument("--include-response-body", action="store_true")
    parser.add_argument("--timeout-ms", type=int, default=8000)
    parser.add_argument("--settle-ms", type=int, default=1000)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Execute web-agent protocol actions through direct Chrome CDP.")
    subparsers = parser.add_subparsers(dest="backend", required=True)

    cdp = subparsers.add_parser("cdp", help="Use direct Chrome CDP")
    cdp.add_argument("--cdp-url", default="http://127.0.0.1:9222")
    cdp.add_argument("--tab-id", default="")
    cdp.add_argument("--url-prefix", default="")
    _add_action_arguments(cdp)
    cdp.set_defaults(func=_command_cdp)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
