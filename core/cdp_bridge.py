"""
CDP 连接管理 — 复用自 temu-assistant，抽象泛化
Chrome 启动参数：--remote-debugging-port=9222
"""
import json
import logging
from typing import Optional
from urllib.request import build_opener, ProxyHandler, Request
from urllib.error import URLError
from urllib.parse import quote

logger = logging.getLogger(__name__)

_NO_PROXY_OPENER = build_opener(ProxyHandler({}))


def cdp_urlopen(url_or_request, timeout: int = 5):
    """Open Chrome CDP management URLs without honoring process proxy env vars."""
    return _NO_PROXY_OPENER.open(url_or_request, timeout=timeout)


class CDPBridge:
    def __init__(self, cdp_url: str = "http://127.0.0.1:9222"):
        self.cdp_url = cdp_url.rstrip("/")
        self._tabs: list = []

    def get_tabs(self) -> list:
        try:
            resp = cdp_urlopen(f"{self.cdp_url}/json", timeout=5)
            self._tabs = json.loads(resp.read())
            return self._tabs
        except URLError as e:
            raise ConnectionError(
                f"无法连接 Chrome CDP ({self.cdp_url}). "
                f"请以 --remote-debugging-port=9222 启动 Chrome. 详情: {e}"
            )

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

    def is_available(self) -> bool:
        try:
            self.get_tabs()
            return True
        except ConnectionError:
            return False

    def new_tab(self, url: str) -> dict:
        encoded = quote(url, safe=':/?&=_-%#')
        req = Request(f"{self.cdp_url}/json/new?{encoded}", method="PUT")
        try:
            resp = cdp_urlopen(req, timeout=8)
            return json.loads(resp.read())
        except URLError as e:
            raise ConnectionError(f"新建 Chrome tab 失败: {e}")

    def close_tab(self, tab_id: str) -> None:
        safe_tab_id = str(tab_id or "").strip()
        if not safe_tab_id:
            return
        cdp_urlopen(f"{self.cdp_url}/json/close/{quote(safe_tab_id, safe='')}", timeout=3)


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
