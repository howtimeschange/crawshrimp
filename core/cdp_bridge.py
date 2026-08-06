"""
CDP 连接管理 — 复用自 temu-assistant，抽象泛化
Chrome 启动参数：--remote-debugging-port=9222
"""
import json
import logging
import asyncio
import socket
import time
from typing import Optional
from urllib.request import build_opener, ProxyHandler, Request
from urllib.error import HTTPError, URLError
from urllib.parse import quote

logger = logging.getLogger(__name__)

_NO_PROXY_OPENER = build_opener(ProxyHandler({}))


def cdp_urlopen(url_or_request, timeout: int = 5):
    """Open Chrome CDP management URLs without honoring process proxy env vars."""
    return _NO_PROXY_OPENER.open(url_or_request, timeout=timeout)


def _cdp_retry_attempts(timeout: float) -> int:
    # Very small timeouts are health probes; keep them fast and single-shot.
    if timeout < 1:
        return 1
    if timeout < 3:
        return 2
    return 3


def _is_retryable_cdp_error(exc: BaseException) -> bool:
    if isinstance(exc, HTTPError):
        return 500 <= int(getattr(exc, "code", 0) or 0) < 600
    if isinstance(exc, (TimeoutError, socket.timeout, ConnectionResetError, ConnectionAbortedError)):
        return True
    if isinstance(exc, URLError):
        reason = getattr(exc, "reason", None)
        if isinstance(reason, (TimeoutError, socket.timeout, ConnectionResetError, ConnectionAbortedError)):
            return True
        text = f"{exc} {reason}".lower()
        return any(marker in text for marker in (
            "timed out",
            "timeout",
            "connection reset",
            "connection aborted",
            "temporarily unavailable",
            "remote end closed",
        ))
    return False


class CDPBridge:
    def __init__(self, cdp_url: str = "http://127.0.0.1:9222"):
        self.cdp_url = cdp_url.rstrip("/")
        self._tabs: list = []

    def _request_json(self, url_or_request, *, timeout: float, action: str, retry_attempts: Optional[int] = None):
        attempts = max(1, int(retry_attempts or _cdp_retry_attempts(timeout)))
        started = time.monotonic()
        last_error: Optional[BaseException] = None
        for attempt in range(1, attempts + 1):
            try:
                resp = cdp_urlopen(url_or_request, timeout=timeout)
                return json.loads(resp.read())
            except (URLError, TimeoutError, socket.timeout, OSError, json.JSONDecodeError) as exc:
                last_error = exc
                retryable = isinstance(exc, json.JSONDecodeError) or _is_retryable_cdp_error(exc)
                if attempt >= attempts or not retryable:
                    break
                delay = min(0.35 * attempt, 1.0)
                logger.info(
                    "Chrome CDP %s失败，%.1fs 后重试 (%s/%s): %s",
                    action,
                    delay,
                    attempt,
                    attempts,
                    exc,
                )
                time.sleep(delay)
        elapsed = time.monotonic() - started
        raise ConnectionError(
            f"{action}失败：无法连接 Chrome CDP ({self.cdp_url})，"
            f"已尝试 {attempts} 次，耗时 {elapsed:.1f}s。"
            f"请确认 Chrome 仍以 --remote-debugging-port=9222 启动。详情: {last_error}"
        )

    def _open_with_retry(self, url_or_request, *, timeout: float, action: str, retry_attempts: Optional[int] = None):
        attempts = max(1, int(retry_attempts or _cdp_retry_attempts(timeout)))
        started = time.monotonic()
        last_error: Optional[BaseException] = None
        for attempt in range(1, attempts + 1):
            try:
                return cdp_urlopen(url_or_request, timeout=timeout)
            except (URLError, TimeoutError, socket.timeout, OSError) as exc:
                last_error = exc
                if attempt >= attempts or not _is_retryable_cdp_error(exc):
                    break
                delay = min(0.35 * attempt, 1.0)
                logger.info(
                    "Chrome CDP %s失败，%.1fs 后重试 (%s/%s): %s",
                    action,
                    delay,
                    attempt,
                    attempts,
                    exc,
                )
                time.sleep(delay)
        elapsed = time.monotonic() - started
        raise ConnectionError(
            f"{action}失败：无法连接 Chrome CDP ({self.cdp_url})，"
            f"已尝试 {attempts} 次，耗时 {elapsed:.1f}s。"
            f"请确认 Chrome 仍以 --remote-debugging-port=9222 启动。详情: {last_error}"
        )

    def get_tabs(self, timeout: float = 5) -> list:
        tabs = self._request_json(f"{self.cdp_url}/json", timeout=timeout, action="读取标签页列表")
        if not isinstance(tabs, list):
            raise ConnectionError(f"读取标签页列表失败：Chrome CDP ({self.cdp_url}) 返回非列表数据")
        self._tabs = tabs
        return self._tabs

    def get_tab(self, tab_id: str) -> Optional[dict]:
        for tab in self.get_tabs():
            if str(tab.get("id")) == str(tab_id):
                return tab
        return None

    def find_tab(self, url_pattern: str) -> Optional[dict]:
        for tab in self.get_tabs():
            if tab.get("type") == "page" and tab.get("url", "").startswith(url_pattern):
                return tab
        return None

    def get_tab_ws_url(self, tab: dict) -> str:
        return tab.get("webSocketDebuggerUrl", "")

    async def get_tabs_async(self, timeout: float = 5) -> list:
        return await asyncio.to_thread(self.get_tabs, timeout)

    async def get_tab_async(self, tab_id: str) -> Optional[dict]:
        return await asyncio.to_thread(self.get_tab, tab_id)

    async def find_tab_async(self, url_pattern: str) -> Optional[dict]:
        return await asyncio.to_thread(self.find_tab, url_pattern)

    async def new_tab_async(self, url: str) -> dict:
        return await asyncio.to_thread(self.new_tab, url)

    async def close_tab_async(self, tab_id: str) -> None:
        return await asyncio.to_thread(self.close_tab, tab_id)

    def is_available(self, timeout: float = 5) -> bool:
        try:
            self.get_tabs(timeout=timeout)
            return True
        except ConnectionError:
            return False

    def new_tab(self, url: str) -> dict:
        encoded = quote(url, safe='')
        req = Request(f"{self.cdp_url}/json/new?{encoded}", method="PUT")
        tab = self._request_json(req, timeout=8, action="新建标签页")
        if not isinstance(tab, dict):
            raise ConnectionError(f"新建标签页失败：Chrome CDP ({self.cdp_url}) 返回非对象数据")
        return tab

    def close_tab(self, tab_id: str) -> None:
        safe_tab_id = str(tab_id or "").strip()
        if not safe_tab_id:
            return
        self._open_with_retry(
            f"{self.cdp_url}/json/close/{quote(safe_tab_id, safe='')}",
            timeout=3,
            action="关闭标签页",
        )


_bridge: Optional[CDPBridge] = None


def get_bridge() -> CDPBridge:
    global _bridge
    from core.config import get
    if _bridge is None:
        cdp_url = get("chrome.remote_debugging_url", "http://127.0.0.1:9222")
        if isinstance(cdp_url, str) and "://localhost:" in cdp_url:
            cdp_url = cdp_url.replace("://localhost:", "://127.0.0.1:")
        _bridge = CDPBridge(cdp_url)
    return _bridge


def reset_bridge() -> None:
    global _bridge
    _bridge = None
