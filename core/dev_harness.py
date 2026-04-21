"""Thin developer-facing harness built on top of browser_session, probe, and JSRunner primitives."""
from __future__ import annotations

from typing import Any

from core.browser_session import open_browser_session
from core.dev_harness_models import (
    DevHarnessCaptureRequest,
    DevHarnessEvalRequest,
    DevHarnessSnapshotRequest,
)
from core.knowledge_service import search_knowledge
from core.probe_service import DOM_SNAPSHOT_EXPR, FRAMEWORK_SNAPSHOT_EXPR, _evaluate_row


async def run_harness_snapshot(req: DevHarnessSnapshotRequest) -> dict[str, Any]:
    session = await open_browser_session(
        req.adapter_id,
        req.task_id,
        mode=req.mode,
        current_tab_id=str(req.current_tab_id or ""),
        entry_url_override=str(req.entry_url or ""),
    )
    dom = await _evaluate_row(session.runner, DOM_SNAPSHOT_EXPR)
    payload: dict[str, Any] = {
        "ok": True,
        "adapter_id": req.adapter_id,
        "task_id": req.task_id,
        "mode": session.mode,
        "tab": session.tab,
        "dom": dom,
    }
    if req.include_framework:
        payload["framework"] = await _evaluate_row(session.runner, FRAMEWORK_SNAPSHOT_EXPR)
    if req.include_knowledge:
        payload["knowledge"] = search_knowledge(
            str(req.knowledge_query or ""),
            adapter_id=req.adapter_id,
            task_id=req.task_id,
            url=str(dom.get("url") or session.tab.get("url") or ""),
            limit=req.knowledge_limit,
        )
    return payload


async def run_harness_eval(req: DevHarnessEvalRequest) -> dict[str, Any]:
    session = await open_browser_session(
        req.adapter_id,
        req.task_id,
        mode=req.mode,
        current_tab_id=str(req.current_tab_id or ""),
        entry_url_override=str(req.entry_url or ""),
    )
    result = await session.runner.evaluate_with_reconnect(
        req.expression,
        allow_navigation_retry=bool(req.allow_navigation_retry),
    )
    return {
        "ok": bool(result.success),
        "adapter_id": req.adapter_id,
        "task_id": req.task_id,
        "tab": session.tab,
        "result": result.model_dump(),
    }


async def run_harness_capture(req: DevHarnessCaptureRequest) -> dict[str, Any]:
    session = await open_browser_session(
        req.adapter_id,
        req.task_id,
        mode=req.mode,
        current_tab_id=str(req.current_tab_id or ""),
        entry_url_override=str(req.entry_url or ""),
    )
    capture_mode = str(req.capture_mode or "passive").strip().lower() or "passive"
    if capture_mode == "passive":
        result = await session.runner.capture_passive_requests(
            matches=req.matches or None,
            timeout_ms=max(int(req.timeout_ms or 5000), 1000),
            settle_ms=max(int(req.settle_ms or 0), 0),
            include_response_body=bool(req.include_response_body),
        )
    elif capture_mode == "click":
        if not req.clicks:
            raise RuntimeError("click 模式需要提供 clicks")
        result = await session.runner.capture_click_requests(
            req.clicks,
            matches=req.matches or None,
            timeout_ms=max(int(req.timeout_ms or 8000), 1000),
            settle_ms=max(int(req.settle_ms or 0), 0),
            min_matches=max(int(req.min_matches or 1), 1),
            include_response_body=bool(req.include_response_body),
        )
    elif capture_mode == "url":
        if not str(req.url or "").strip():
            raise RuntimeError("url 模式需要提供 url")
        result = await session.runner.capture_url_requests(
            str(req.url or "").strip(),
            matches=req.matches or None,
            timeout_ms=max(int(req.timeout_ms or 12000), 1000),
            settle_ms=max(int(req.settle_ms or 0), 0),
            min_matches=max(int(req.min_matches or 1), 1),
            include_response_body=bool(req.include_response_body),
        )
    else:
        raise RuntimeError(f"不支持的 capture_mode: {req.capture_mode}")
    return {
        "ok": True,
        "adapter_id": req.adapter_id,
        "task_id": req.task_id,
        "capture_mode": capture_mode,
        "tab": session.tab,
        "capture": result,
    }
