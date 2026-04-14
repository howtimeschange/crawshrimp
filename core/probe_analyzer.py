"""Helpers for turning probe captures into stable bundle artifacts."""
from __future__ import annotations

import json
import re
from typing import Any, Optional
from urllib.parse import parse_qsl, urlparse


VOLATILE_PARAMS = {
    "_", "_t", "_ts", "_timestamp", "_time", "t", "ts", "timestamp",
    "traceid", "trace_id", "request_id", "requestId", "token", "sign", "signature",
}
SEARCH_PARAMS = {"q", "query", "keyword", "search", "wd", "word"}
PAGINATION_PARAMS = {"page", "page_no", "pageNum", "pageIndex", "pn", "offset", "cursor"}
LIMIT_PARAMS = {"limit", "page_size", "pageSize", "size", "ps"}
NOISE_PATTERNS = (".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".woff", ".woff2")


def _extract_content_type(entry: dict) -> str:
    content_type = str(entry.get("mimeType") or "")
    if content_type:
        return content_type.lower()
    response_headers = entry.get("responseHeaders") or {}
    if isinstance(response_headers, dict):
        for key, value in response_headers.items():
            if str(key).lower() == "content-type":
                return str(value or "").lower()
    return ""


def _is_json_like(content_type: str, body: Any) -> bool:
    if "json" in content_type:
        return True
    if isinstance(body, (dict, list)):
        return True
    if isinstance(body, str):
        stripped = body.strip()
        return stripped.startswith("{") or stripped.startswith("[")
    return False


def _parse_body(body: Any) -> Any:
    if isinstance(body, (dict, list)):
        return body
    if not isinstance(body, str):
        return None
    stripped = body.strip()
    if not stripped:
        return None
    try:
        return json.loads(stripped)
    except Exception:
        return None


def _find_array_path(node: Any, path: str = "") -> Optional[tuple[str, list[Any]]]:
    if isinstance(node, list):
        if node and all(not isinstance(item, (str, int, float, bool)) for item in node[:3]):
            return path or "$", node
        return None
    if isinstance(node, dict):
        for key, value in node.items():
            child_path = f"{path}.{key}" if path else key
            found = _find_array_path(value, child_path)
            if found:
                return found
    return None


def _flatten_fields(node: Any, prefix: str = "", depth: int = 0, max_depth: int = 2) -> list[str]:
    if depth > max_depth or not isinstance(node, dict):
        return []
    fields: list[str] = []
    for key, value in node.items():
        child = f"{prefix}.{key}" if prefix else key
        fields.append(child)
        if isinstance(value, dict):
            fields.extend(_flatten_fields(value, child, depth + 1, max_depth))
    return fields


def _detect_field_roles(fields: list[str]) -> dict[str, str]:
    normalized = {field.lower(): field for field in fields}
    role_patterns = {
        "title": ("title", "name", "subject"),
        "url": ("url", "link", "href"),
        "author": ("author", "seller", "user", "shop"),
        "time": ("time", "date", "created", "updated"),
        "score": ("score", "amount", "count", "value", "price"),
        "id": ("id", "spu", "sku"),
    }
    detected: dict[str, str] = {}
    for role, patterns in role_patterns.items():
        for field_lower, original in normalized.items():
            if any(token in field_lower for token in patterns):
                detected[role] = original
                break
    return detected


def _strip_volatile_query(url: str) -> tuple[str, list[str]]:
    parsed = urlparse(url)
    query_pairs = []
    query_keys = []
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        query_keys.append(key)
        if key in VOLATILE_PARAMS:
            continue
        if key in SEARCH_PARAMS:
            query_pairs.append((key, "{keyword}"))
        elif key in PAGINATION_PARAMS:
            query_pairs.append((key, "{page}"))
        elif key in LIMIT_PARAMS:
            query_pairs.append((key, "{limit}"))
        else:
            query_pairs.append((key, value))
    query = "&".join(f"{key}={value}" for key, value in query_pairs)
    pattern = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
    if query:
        pattern = f"{pattern}?{query}"
    return pattern, query_keys


def _detect_auth_indicators(entry: dict, framework_snapshot: Optional[dict] = None) -> list[str]:
    indicators: set[str] = set()
    headers = entry.get("headers") or {}
    response_headers = entry.get("responseHeaders") or {}
    for source in (headers, response_headers):
        if not isinstance(source, dict):
            continue
        lowered = {str(key).lower(): str(value or "") for key, value in source.items()}
        if "cookie" in lowered:
            indicators.add("cookie")
        if any(token in lowered for token in ("authorization", "x-csrf-token", "x-xsrf-token")):
            indicators.add("header")
        if any("bearer" in value.lower() for value in lowered.values()):
            indicators.add("bearer")
        if any("sign" in key or "signature" in key for key in lowered):
            indicators.add("signature")
    if framework_snapshot:
        stores = framework_snapshot.get("stores") or []
        if stores and "signature" in indicators:
            indicators.add("store_action")
    return sorted(indicators)


def _recommend_runtime_action(entry: dict) -> str:
    url = str(entry.get("url") or "").lower()
    content_type = _extract_content_type(entry)
    response_headers = entry.get("responseHeaders") or {}
    content_disposition = ""
    if isinstance(response_headers, dict):
        content_disposition = str(
            response_headers.get("content-disposition")
            or response_headers.get("Content-Disposition")
            or ""
        ).lower()
    if "attachment" in content_disposition or "download" in url:
        return "capture_click_requests"
    if "octet-stream" in content_type or "excel" in content_type or "spreadsheet" in content_type:
        return "download_urls"
    return "none"


def analyze_endpoints(network_entries: list[dict], framework_snapshot: Optional[dict] = None) -> list[dict]:
    deduped: dict[str, dict] = {}
    for entry in network_entries or []:
        url = str(entry.get("url") or entry.get("responseUrl") or "").strip()
        if not url:
            continue
        lowered_url = url.lower()
        if any(pattern in lowered_url for pattern in NOISE_PATTERNS):
            continue
        content_type = _extract_content_type(entry)
        body_payload = _parse_body(entry.get("body"))
        runtime_action = _recommend_runtime_action(entry)
        if runtime_action == "none" and not _is_json_like(content_type, body_payload):
            continue

        pattern, query_keys = _strip_volatile_query(url)
        method = str(entry.get("method") or "GET").upper()
        key = f"{method}:{pattern}"
        auth_indicators = _detect_auth_indicators(entry, framework_snapshot)
        response_analysis = _find_array_path(body_payload) if body_payload is not None else None

        detected_fields = {}
        item_path = None
        item_count = 0
        sample_fields: list[str] = []
        if response_analysis:
            item_path, items = response_analysis
            item_count = len(items)
            sample = items[0] if items else None
            sample_fields = _flatten_fields(sample, "", 0, 2) if isinstance(sample, dict) else []
            detected_fields = _detect_field_roles(sample_fields)

        candidate = {
            "pattern": pattern,
            "method": method,
            "url": url,
            "status": entry.get("status"),
            "content_type": content_type,
            "query_params": query_keys,
            "item_path": item_path,
            "item_count": item_count,
            "detected_fields": detected_fields,
            "sample_fields": sample_fields,
            "auth_indicators": auth_indicators,
            "runtime_action": runtime_action,
        }
        existing = deduped.get(key)
        if not existing:
            deduped[key] = candidate
            continue
        existing_score = int(existing.get("item_count") or 0) + len(existing.get("detected_fields") or {})
        candidate_score = int(candidate.get("item_count") or 0) + len(candidate.get("detected_fields") or {})
        if candidate_score > existing_score:
            deduped[key] = candidate

    return sorted(
        deduped.values(),
        key=lambda item: (
            int(item.get("item_count") or 0),
            len(item.get("detected_fields") or {}),
            1 if item.get("runtime_action") != "none" else 0,
        ),
        reverse=True,
    )


def build_page_map(dom_snapshot: dict, interactions: Optional[list[dict]] = None) -> dict:
    states: list[dict] = []
    visible_states = []
    if dom_snapshot.get("drawer_roots"):
        visible_states.append("drawer")
    if dom_snapshot.get("modal_roots"):
        visible_states.append("modal")
    if dom_snapshot.get("table_count", 0) > 0:
        visible_states.append("list")
    if not visible_states:
        visible_states.append("page")

    states.append({
        "name": "initial",
        "visible_states": visible_states,
        "active_containers": dom_snapshot.get("active_containers") or [],
        "signals": {
            "heading": dom_snapshot.get("headings", [])[:3],
            "drawer_roots": dom_snapshot.get("drawer_roots") or [],
            "modal_roots": dom_snapshot.get("modal_roots") or [],
        },
    })

    for item in interactions or []:
        after_dom = item.get("after_dom") or {}
        states.append({
            "name": str(item.get("trigger_label") or item.get("trigger_selector") or "interaction"),
            "visible_states": [
                value for value in (
                    "drawer" if after_dom.get("drawer_roots") else "",
                    "modal" if after_dom.get("modal_roots") else "",
                    "list" if after_dom.get("table_count", 0) > 0 else "",
                ) if value
            ] or ["page"],
            "active_containers": after_dom.get("active_containers") or [],
            "signals": {
                "heading": after_dom.get("headings", [])[:3],
                "button_sample": after_dom.get("buttons", [])[:5],
            },
        })
    return {"states": states}


def infer_strategy(dom_snapshot: dict, endpoints: list[dict], framework_snapshot: Optional[dict] = None) -> dict:
    interactive_count = len(dom_snapshot.get("buttons") or []) + len(dom_snapshot.get("inputs") or []) + len(dom_snapshot.get("selects") or [])
    useful_endpoints = [item for item in endpoints if int(item.get("item_count") or 0) > 0 or item.get("runtime_action") != "none"]
    page_strategy = "dom_first"
    reasons = []
    if useful_endpoints:
        if interactive_count > 0:
            page_strategy = "mixed"
            reasons.append("页面存在明显交互控件，同时也抓到了可用 endpoint")
        else:
            page_strategy = "api_first"
            reasons.append("页面交互线索较少，但抓到了可用 endpoint")
    else:
        reasons.append("当前探查尚未发现稳定 endpoint，优先保留 DOM-first")

    indicator_set = {indicator for item in endpoints for indicator in (item.get("auth_indicators") or [])}
    auth_strategy = "public"
    if "store_action" in indicator_set:
        auth_strategy = "store_action"
    elif "signature" in indicator_set or "bearer" in indicator_set or "header" in indicator_set:
        auth_strategy = "header"
    elif "cookie" in indicator_set:
        auth_strategy = "cookie"
    elif useful_endpoints:
        auth_strategy = "unclear"

    confidence = "medium"
    if page_strategy == "dom_first" and not useful_endpoints:
        confidence = "medium"
    elif useful_endpoints and any(int(item.get("item_count") or 0) > 0 for item in useful_endpoints):
        confidence = "high"

    if framework_snapshot and framework_snapshot.get("stores"):
        reasons.append("页面存在 store 指纹，可为后续 state injection / store-action 留线索")

    return {
        "page_strategy": page_strategy,
        "auth_strategy": auth_strategy,
        "confidence": confidence,
        "reasons": reasons,
    }


def build_recommendations(page_map: dict, dom_snapshot: dict, endpoints: list[dict], strategy: dict) -> dict:
    runtime_actions = sorted({item.get("runtime_action") for item in endpoints if item.get("runtime_action") and item.get("runtime_action") != "none"})
    active_containers = dom_snapshot.get("active_containers") or []
    transition_evidence = []
    if dom_snapshot.get("drawer_roots"):
        transition_evidence.append("drawer root visible")
    if dom_snapshot.get("modal_roots"):
        transition_evidence.append("modal root visible")
    if dom_snapshot.get("table_count", 0) > 0:
        transition_evidence.append("table count / row signature changed")
    if dom_snapshot.get("headings"):
        transition_evidence.append(f"heading: {dom_snapshot['headings'][0]}")

    phase_candidates = []
    state_names = {state_name for state in (page_map.get("states") or []) for state_name in (state.get("visible_states") or [])}
    if "list" in state_names:
        phase_candidates.append("prepare_scope")
    if "drawer" in state_names:
        phase_candidates.extend(["open_detail", "collect_detail"])
    if any(action in runtime_actions for action in ("capture_click_requests", "download_urls")):
        phase_candidates.extend(["trigger_export", "fetch_artifact"])
    if not phase_candidates:
        phase_candidates.append("main")

    return {
        "active_container_selectors": active_containers[:5],
        "readback_targets": {
            "inputs": [item.get("selector") for item in (dom_snapshot.get("inputs") or [])[:5]],
            "selects": [item.get("selector") for item in (dom_snapshot.get("selects") or [])[:5]],
        },
        "transition_evidence": transition_evidence,
        "runtime_actions": runtime_actions,
        "phase_candidates": phase_candidates,
        "strategy_alignment": strategy,
    }


def render_report(
    *,
    adapter_id: str,
    task_id: str,
    goal: str,
    manifest: dict,
    dom_snapshot: dict,
    framework_snapshot: dict,
    endpoints: list[dict],
    strategy: dict,
    recommendations: dict,
) -> str:
    lines = [
        f"# Probe Report - {adapter_id}/{task_id}",
        "",
        "## Context",
        "",
        f"- Probe ID: `{manifest.get('probe_id')}`",
        f"- Mode: `{manifest.get('mode')}`",
        f"- Target URL: `{manifest.get('target_url')}`",
        f"- Final URL: `{manifest.get('final_url')}`",
        f"- Goal: {goal or '未填写'}",
        "",
        "## Page Snapshot",
        "",
        f"- Title: {dom_snapshot.get('title') or '(empty)'}",
        f"- Headings: {', '.join(dom_snapshot.get('headings')[:5]) or '(none)'}",
        f"- Active Containers: {', '.join(dom_snapshot.get('active_containers')[:5]) or '(none)'}",
        f"- Drawer Roots: {', '.join(dom_snapshot.get('drawer_roots')[:5]) or '(none)'}",
        f"- Modal Roots: {', '.join(dom_snapshot.get('modal_roots')[:5]) or '(none)'}",
        "",
        "## Framework",
        "",
        f"- Flags: {', '.join(key for key, value in (framework_snapshot.get('framework') or {}).items() if value) or '(none)'}",
        f"- Stores: {', '.join(item.get('id') for item in (framework_snapshot.get('stores') or [])[:5]) or '(none)'}",
        "",
        "## Endpoint Summary",
        "",
    ]
    if endpoints:
        for item in endpoints[:8]:
            lines.append(
                f"- `{item.get('method')} {item.get('pattern')}` · items={item.get('item_count', 0)}"
                f" · auth={','.join(item.get('auth_indicators') or []) or 'none'}"
                f" · action={item.get('runtime_action') or 'none'}"
            )
    else:
        lines.append("- 未发现稳定 endpoint")

    lines.extend([
        "",
        "## Strategy",
        "",
        f"- Page Strategy: `{strategy.get('page_strategy')}`",
        f"- Auth Strategy: `{strategy.get('auth_strategy')}`",
        f"- Confidence: `{strategy.get('confidence')}`",
    ])
    for reason in strategy.get("reasons") or []:
        lines.append(f"- Reason: {reason}")

    lines.extend([
        "",
        "## Recommendations",
        "",
        f"- Phase Candidates: {', '.join(recommendations.get('phase_candidates') or []) or '(none)'}",
        f"- Runtime Actions: {', '.join(recommendations.get('runtime_actions') or []) or '(none)'}",
        f"- Transition Evidence: {', '.join(recommendations.get('transition_evidence') or []) or '(none)'}",
        "",
    ])
    return "\n".join(lines) + "\n"
