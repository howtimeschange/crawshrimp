"""
Shared browser-session helpers for task execution and probe flows.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from core import adapter_loader
from core.cdp_bridge import get_bridge
from core.js_runner import JSRunner


@dataclass
class BrowserSessionContext:
    adapter: object
    task: object
    adapter_dir: Path
    target_entry_url: str
    mode: str
    tab: dict
    runner: JSRunner


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

    url_host = (url_p.hostname or "").lower()
    prefix_host = (prefix_p.hostname or "").lower()
    url_path = url_p.path or "/"
    prefix_path = prefix_p.path or "/"

    if not url_host or not prefix_host:
        return False

    if url_host == prefix_host:
        return url_path.startswith(prefix_path)

    if prefix_host == "agentseller.temu.com" and url_host.endswith(".temu.com") and url_host.startswith("agentseller"):
        normalized_prefix = prefix_path if prefix_path.endswith("/") else prefix_path + "/"
        normalized_url = url_path if url_path.endswith("/") else url_path + "/"
        return normalized_url.startswith(normalized_prefix) or normalized_prefix == "//"

    return False


def _is_logged_in(auth_result) -> bool:
    logged_in = False
    if auth_result.success:
        if isinstance(auth_result.meta, dict):
            logged_in = bool(auth_result.meta.get("logged_in"))
        if not logged_in and auth_result.data and isinstance(auth_result.data, list):
            first_row = auth_result.data[0] or {}
            if isinstance(first_row, dict):
                logged_in = bool(first_row.get("logged_in"))
    return logged_in


async def open_browser_session(
    adapter_id: str,
    task_id: str,
    *,
    mode: str = "current",
    current_tab_id: str = "",
    entry_url_override: str = "",
    tab_match_prefixes_override: Optional[list[str]] = None,
    artifact_dir: Optional[str] = None,
) -> BrowserSessionContext:
    adapter = adapter_loader.get_adapter(adapter_id)
    if not adapter:
        raise ValueError(f"Adapter not found: {adapter_id}")

    task = next((item for item in adapter.tasks if item.id == task_id), None)
    if not task:
        raise ValueError(f"Task not found: {task_id}")

    adapter_dir = adapter_loader.get_adapter_dir(adapter_id)
    if not adapter_dir:
        raise ValueError(f"Adapter directory not found: {adapter_id}")

    target_entry_url = str(entry_url_override or task.entry_url or adapter.entry_url or "").strip()
    if not target_entry_url:
        raise ValueError(f"Probe target entry URL is empty for {adapter_id}/{task_id}")

    bridge = get_bridge()
    selected_mode = str(mode or "current").strip().lower() or "current"
    configured_match_prefixes = list(tab_match_prefixes_override or task.tab_match_prefixes or adapter.tab_match_prefixes or [])
    preferred_prefixes = configured_match_prefixes or [target_entry_url]

    tab = None
    if selected_mode == "current":
        all_tabs = [item for item in bridge.get_tabs() if item.get("type") == "page"]
        if current_tab_id:
            tab = next((item for item in all_tabs if str(item.get("id")) == str(current_tab_id)), None)
            if not tab:
                raise RuntimeError("未找到当前页面对应的 Chrome 标签页。")
            tab_url = str(tab.get("url") or "")
            if not any(_url_matches_prefix(tab_url, prefix) for prefix in preferred_prefixes):
                raise RuntimeError(f"当前页面不是目标业务页：{tab_url[:120]}")
        else:
            candidate_tabs = [
                item for item in all_tabs
                if any(_url_matches_prefix(str(item.get("url") or ""), prefix) for prefix in preferred_prefixes)
            ]
            if len(candidate_tabs) == 1:
                tab = candidate_tabs[0]
            elif len(candidate_tabs) > 1:
                raise RuntimeError(
                    "probe current 模式检测到多个目标页面，无法判断当前标签页。请聚焦目标业务页面后重试。"
                )
            else:
                raise RuntimeError(f"未找到已打开的目标页面：{target_entry_url}")
    else:
        try:
            tab = bridge.new_tab(target_entry_url)
        except Exception as exc:
            fallback_tab = bridge.find_tab(target_entry_url)
            if fallback_tab:
                tab = fallback_tab
            else:
                raise RuntimeError(f"无法打开或找到目标页面：{target_entry_url}") from exc

    if not tab:
        raise RuntimeError(f"无法解析目标标签页：{target_entry_url}")

    runner = JSRunner(
        bridge.get_tab_ws_url(tab),
        tab_id=str(tab.get("id") or ""),
        tab_url=str(tab.get("url") or ""),
        artifact_dir=artifact_dir,
    )

    if not task.skip_auth and adapter.auth and adapter.auth.check_script:
        auth_path = Path(adapter_dir) / str(adapter.auth.check_script)
        if auth_path.exists():
            auth_result = await runner.evaluate(auth_path.read_text(encoding="utf-8"))
            if not _is_logged_in(auth_result):
                raise RuntimeError(f"当前页面未登录 {adapter.name or adapter_id}，请先登录后再运行 probe。")

    return BrowserSessionContext(
        adapter=adapter,
        task=task,
        adapter_dir=Path(adapter_dir),
        target_entry_url=target_entry_url,
        mode=selected_mode,
        tab=tab,
        runner=runner,
    )
