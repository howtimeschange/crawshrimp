"""
CDP 连接管理 — 复用自 temu-assistant，抽象泛化
Chrome 启动参数：--remote-debugging-port=9222
"""
import json
import logging
from typing import Optional
from urllib.request import urlopen
from urllib.error import URLError
from urllib.parse import quote

logger = logging.getLogger(__name__)


class CDPBridge:
    def __init__(self, cdp_url: str = "http://localhost:9222"):
        self.cdp_url = cdp_url.rstrip("/")
        self._tabs: list = []

    def get_tabs(self) -> list:
        try:
            resp = urlopen(f"{self.cdp_url}/json", timeout=5)
            self._tabs = json.loads(resp.read())
            return self._tabs
        except URLError as e:
            raise ConnectionError(
                f"无法连接 Chrome CDP ({self.cdp_url}). "
                f"请以 --remote-debugging-port=9222 启动 Chrome. 详情: {e}"
            )

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
        try:
            resp = urlopen(f"{self.cdp_url}/json/new?{quote(url, safe=':/?&=_-%#')}", timeout=8)
            return json.loads(resp.read())
        except URLError as e:
            raise ConnectionError(f"新建 Chrome tab 失败: {e}")


_bridge: Optional[CDPBridge] = None


def get_bridge() -> CDPBridge:
    global _bridge
    from core.config import get
    if _bridge is None:
        _bridge = CDPBridge(get("chrome.remote_debugging_url", "http://localhost:9222"))
    return _bridge


def reset_bridge() -> None:
    global _bridge
    _bridge = None
