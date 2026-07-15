#!/usr/bin/env python3
"""Build probe bundles from page, framework, and network captures."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


SENSITIVE_HEADER_KEYS = {
    "authorization",
    "cookie",
    "set-cookie",
    "x-csrf-token",
    "x-xsrf-token",
    "x-api-key",
    "x-auth-token",
    "x-access-token",
}
SENSITIVE_FIELD_FRAGMENTS = (
    "token",
    "secret",
    "password",
    "passwd",
    "authorization",
    "cookie",
    "session",
    "csrf",
    "xsrf",
    "access_key",
    "accesskey",
    "signature",
    "ticket",
)
SENSITIVE_FIELD_NAMES = {"sign", "sig"}
REDACTED = "[REDACTED]"
NOISE_PATTERNS = (".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".woff", ".woff2")
VOLATILE_PARAMS = {
    "_",
    "_t",
    "_ts",
    "_timestamp",
    "_time",
    "t",
    "ts",
    "timestamp",
    "traceid",
    "trace_id",
    "request_id",
    "requestId",
    "token",
    "sign",
    "signature",
}
SEARCH_PARAMS = {"q", "query", "keyword", "search", "wd", "word"}
PAGINATION_PARAMS = {"page", "page_no", "pageNum", "pageIndex", "pn", "offset", "cursor"}
LIMIT_PARAMS = {"limit", "page_size", "pageSize", "size", "ps"}


def _is_sensitive_key(key: Any) -> bool:
    normalized = str(key or "").strip().lower().replace("-", "_")
    return bool(normalized) and (normalized in SENSITIVE_FIELD_NAMES or any(fragment in normalized for fragment in SENSITIVE_FIELD_FRAGMENTS))


def _redact_headers(headers: Any) -> Any:
    if not isinstance(headers, dict):
        return headers
    redacted = {}
    for key, value in headers.items():
        if str(key or "").strip().lower() in SENSITIVE_HEADER_KEYS or _is_sensitive_key(key):
            redacted[key] = REDACTED
        else:
            redacted[key] = value
    return redacted


def _redact_url(raw_url: Any) -> str:
    text = str(raw_url or "")
    if not text:
        return text
    try:
        parts = urlsplit(text)
        query = urlencode(
            [
                (key, REDACTED if _is_sensitive_key(key) else value)
                for key, value in parse_qsl(parts.query, keep_blank_values=True)
            ],
            doseq=True,
        )
        return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))
    except Exception:
        return text


def _redact_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: (REDACTED if _is_sensitive_key(key) else _redact_value(item)) for key, item in value.items()}
    if isinstance(value, list):
        return [_redact_value(item) for item in value]
    return value


def _redact_body(value: Any) -> Any:
    if not isinstance(value, str):
        return _redact_value(value)
    text = value.strip()
    if not text:
        return value
    try:
        parsed = json.loads(text)
    except Exception:
        return REDACTED if any(fragment in text.lower() for fragment in SENSITIVE_FIELD_FRAGMENTS) else value
    return json.dumps(_redact_value(parsed), ensure_ascii=False)


def redact_network_entry(entry: Any) -> Any:
    if not isinstance(entry, dict):
        return entry
    redacted = dict(entry)
    for key in ("url", "responseUrl"):
        if key in redacted:
            redacted[key] = _redact_url(redacted[key])
    for key in ("headers", "responseHeaders"):
        if key in redacted:
            redacted[key] = _redact_headers(redacted[key])
    for key in ("postData", "body"):
        if key in redacted:
            redacted[key] = _redact_body(redacted[key])
    return redacted


def redact_capture_payload(payload: Any) -> Any:
    if isinstance(payload, dict):
        redacted = {}
        for key, value in payload.items():
            if key == "matches" and isinstance(value, list):
                redacted[key] = [redact_network_entry(item) for item in value]
            else:
                redacted[key] = redact_capture_payload(value)
        return redacted
    if isinstance(payload, list):
        return [redact_capture_payload(item) for item in payload]
    return payload


def _content_type(entry: dict[str, Any]) -> str:
    content_type = str(entry.get("mimeType") or entry.get("content_type") or "")
    if content_type:
        return content_type.lower()
    headers = entry.get("responseHeaders") or {}
    if isinstance(headers, dict):
        for key, value in headers.items():
            if str(key).lower() == "content-type":
                return str(value or "").lower()
    return ""


def _parse_body(body: Any) -> Any:
    if isinstance(body, (dict, list)):
        return body
    if not isinstance(body, str):
        return None
    text = body.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        return None


def _find_array_path(node: Any, path: str = "") -> tuple[str, list[Any]] | None:
    if isinstance(node, list):
        if node and all(not isinstance(item, (str, int, float, bool)) for item in node[:3]):
            return path or "$", node
        return None
    if isinstance(node, dict):
        for key, value in node.items():
            found = _find_array_path(value, f"{path}.{key}" if path else key)
            if found:
                return found
    return None


def _flatten_fields(node: Any, prefix: str = "", depth: int = 0) -> list[str]:
    if depth > 2 or not isinstance(node, dict):
        return []
    fields: list[str] = []
    for key, value in node.items():
        child = f"{prefix}.{key}" if prefix else str(key)
        fields.append(child)
        if isinstance(value, dict):
            fields.extend(_flatten_fields(value, child, depth + 1))
    return fields


def _strip_volatile_query(url: str) -> tuple[str, list[str]]:
    parts = urlsplit(url)
    query_pairs = []
    query_keys = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
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
    pattern = f"{parts.scheme}://{parts.netloc}{parts.path}"
    if query:
        pattern = f"{pattern}?{query}"
    return pattern, query_keys


def _auth_indicators(entry: dict[str, Any], framework_snapshot: dict[str, Any] | None = None) -> list[str]:
    indicators: set[str] = set()
    for source in (entry.get("headers") or {}, entry.get("responseHeaders") or {}):
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
    if framework_snapshot and framework_snapshot.get("stores") and "signature" in indicators:
        indicators.add("store_action")
    return sorted(indicators)


def _runtime_action(entry: dict[str, Any]) -> str:
    url = str(entry.get("url") or entry.get("responseUrl") or "").lower()
    content_type = _content_type(entry)
    headers = entry.get("responseHeaders") or {}
    disposition = ""
    if isinstance(headers, dict):
        disposition = str(headers.get("content-disposition") or headers.get("Content-Disposition") or "").lower()
    if "attachment" in disposition or "download" in url:
        return "capture_click_requests"
    if "octet-stream" in content_type or "excel" in content_type or "spreadsheet" in content_type:
        return "download_urls"
    return "none"


def analyze_endpoints(entries: list[dict[str, Any]], framework_snapshot: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    for entry in entries or []:
        url = str(entry.get("url") or entry.get("responseUrl") or "").strip()
        if not url:
            continue
        if any(pattern in url.lower() for pattern in NOISE_PATTERNS):
            continue
        content_type = _content_type(entry)
        body = _parse_body(entry.get("body"))
        runtime_action = _runtime_action(entry)
        json_like = "json" in content_type or body is not None
        if runtime_action == "none" and not json_like:
            continue
        pattern, query_keys = _strip_volatile_query(url)
        method = str(entry.get("method") or "GET").upper()
        key = f"{method}:{pattern}"
        response_analysis = _find_array_path(body) if body is not None else None
        item_path = None
        item_count = 0
        sample_fields: list[str] = []
        if response_analysis:
            item_path, items = response_analysis
            item_count = len(items)
            if items and isinstance(items[0], dict):
                sample_fields = _flatten_fields(items[0])
        candidate = {
            "pattern": pattern,
            "method": method,
            "url": url,
            "status": entry.get("status"),
            "content_type": content_type,
            "query_params": query_keys,
            "item_path": item_path,
            "item_count": item_count,
            "sample_fields": sample_fields,
            "auth_indicators": _auth_indicators(entry, framework_snapshot),
            "runtime_action": runtime_action,
        }
        existing = deduped.get(key)
        if not existing or int(candidate.get("item_count") or 0) > int(existing.get("item_count") or 0):
            deduped[key] = candidate
    return sorted(deduped.values(), key=lambda item: (int(item.get("item_count") or 0), item.get("runtime_action") != "none"), reverse=True)


def build_page_map(dom_snapshot: dict[str, Any], interactions: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    visible = []
    if dom_snapshot.get("drawer_roots") or dom_snapshot.get("active_regions"):
        visible.append("drawer")
    if dom_snapshot.get("modal_roots"):
        visible.append("modal")
    if int(dom_snapshot.get("table_count") or 0) > 0 or dom_snapshot.get("tables"):
        visible.append("list")
    if not visible:
        visible.append("page")
    states = [
        {
            "name": "initial",
            "visible_states": visible,
            "active_containers": dom_snapshot.get("active_containers") or [],
            "signals": {"heading": dom_snapshot.get("headings", [])[:3]},
        }
    ]
    for item in interactions or []:
        after = item.get("after_dom") or {}
        states.append({"name": str(item.get("trigger_label") or item.get("trigger_selector") or "interaction"), "visible_states": ["page"], "active_containers": after.get("active_containers") or []})
    return {"states": states}


def infer_strategy(dom_snapshot: dict[str, Any], endpoints: list[dict[str, Any]], framework_snapshot: dict[str, Any] | None = None) -> dict[str, Any]:
    control_count = len(dom_snapshot.get("buttons") or []) + len(dom_snapshot.get("inputs") or []) + len(dom_snapshot.get("selects") or [])
    useful = [item for item in endpoints if int(item.get("item_count") or 0) > 0 or item.get("runtime_action") != "none"]
    page_strategy = "dom_first"
    reasons = []
    if useful:
        page_strategy = "mixed" if control_count else "api_first"
        reasons.append("captured useful endpoints")
    else:
        reasons.append("no stable endpoint captured")
    indicators = {indicator for item in endpoints for indicator in (item.get("auth_indicators") or [])}
    auth_strategy = "public"
    if "store_action" in indicators:
        auth_strategy = "store_action"
    elif {"signature", "bearer", "header"} & indicators:
        auth_strategy = "header"
    elif "cookie" in indicators:
        auth_strategy = "cookie"
    elif useful:
        auth_strategy = "unclear"
    if framework_snapshot and framework_snapshot.get("stores"):
        reasons.append("framework store clues available")
    return {"page_strategy": page_strategy, "auth_strategy": auth_strategy, "confidence": "high" if useful else "medium", "reasons": reasons}


def build_recommendations(page_map: dict[str, Any], dom_snapshot: dict[str, Any], endpoints: list[dict[str, Any]], strategy: dict[str, Any]) -> dict[str, Any]:
    runtime_actions = sorted({item.get("runtime_action") for item in endpoints if item.get("runtime_action") and item.get("runtime_action") != "none"})
    phase_candidates = []
    if any("drawer" in state.get("visible_states", []) for state in page_map.get("states", [])):
        phase_candidates.append("open_detail")
    if runtime_actions:
        phase_candidates.append("trigger_export")
    return {
        "runtime_actions": runtime_actions,
        "phase_candidates": phase_candidates,
        "selector_hints": dom_snapshot.get("buttons", [])[:8],
        "strategy": strategy.get("page_strategy"),
    }


def render_report(
    *,
    adapter_id: str,
    task_id: str,
    goal: str,
    manifest: dict[str, Any],
    dom_snapshot: dict[str, Any],
    framework_snapshot: dict[str, Any],
    endpoints: list[dict[str, Any]],
    strategy: dict[str, Any],
    recommendations: dict[str, Any],
) -> str:
    lines = [
        "# Probe Report",
        "",
        f"- Adapter: `{adapter_id}`",
        f"- Task: `{task_id}`",
        f"- Goal: {goal or '(none)'}",
        f"- Target URL: {manifest.get('target_url') or ''}",
        f"- Final URL: {manifest.get('final_url') or ''}",
        f"- Page strategy: {strategy.get('page_strategy') or ''}",
        f"- Auth strategy: {strategy.get('auth_strategy') or ''}",
        "",
        "## Page",
        "",
        f"- Title: {dom_snapshot.get('title') or ''}",
        f"- URL: {dom_snapshot.get('url') or ''}",
        "",
        "## Endpoints",
        "",
    ]
    if endpoints:
        for endpoint in endpoints:
            lines.append(f"- `{endpoint.get('method')}` {endpoint.get('pattern')} ({endpoint.get('runtime_action')})")
    else:
        lines.append("- No endpoint candidates captured.")
    lines.extend(["", "## Recommendations", ""])
    for action in recommendations.get("runtime_actions") or []:
        lines.append(f"- Runtime action: `{action}`")
    for phase in recommendations.get("phase_candidates") or []:
        lines.append(f"- Phase candidate: `{phase}`")
    return "\n".join(lines).rstrip() + "\n"


def _flatten_network(passive_capture: dict[str, Any], interaction_captures: list[dict[str, Any]]) -> list[dict[str, Any]]:
    entries = [dict(item, capture_mode="passive") for item in passive_capture.get("matches") or [] if isinstance(item, dict)]
    for capture in interaction_captures or []:
        trigger = str(capture.get("trigger_label") or capture.get("trigger_selector") or "")
        for item in (capture.get("capture") or {}).get("matches") or []:
            if isinstance(item, dict):
                entries.append(dict(item, capture_mode="click", trigger=trigger))
    return entries


def build_probe_bundle(
    *,
    output_dir: Path | str,
    adapter_id: str,
    task_id: str,
    goal: str = "",
    dom_snapshot: dict[str, Any],
    framework_snapshot: dict[str, Any] | None = None,
    passive_capture: dict[str, Any] | None = None,
    interaction_captures: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    framework = framework_snapshot or {}
    passive = redact_capture_payload(passive_capture or {"matches": []})
    interactions = redact_capture_payload(interaction_captures or [])
    captured = _flatten_network(passive, interactions)
    endpoints = analyze_endpoints(captured, framework)
    page_map = build_page_map(dom_snapshot, interactions)
    strategy = infer_strategy(dom_snapshot, endpoints, framework)
    recommendations = build_recommendations(page_map, dom_snapshot, endpoints, strategy)
    now = datetime.now(timezone.utc).isoformat()
    probe_id = output.name
    manifest = {
        "probe_id": probe_id,
        "adapter_id": adapter_id,
        "task_id": task_id,
        "goal": goal,
        "target_url": dom_snapshot.get("url") or "",
        "final_url": dom_snapshot.get("url") or "",
        "started_at": now,
        "finished_at": now,
    }
    report = render_report(
        adapter_id=adapter_id,
        task_id=task_id,
        goal=goal,
        manifest=manifest,
        dom_snapshot=dom_snapshot,
        framework_snapshot=framework,
        endpoints=endpoints,
        strategy=strategy,
        recommendations=recommendations,
    )
    files = {
        "manifest.json": manifest,
        "page-map.json": page_map,
        "dom.json": dom_snapshot,
        "framework.json": framework,
        "network.json": {"passive_capture": passive, "interaction_captures": interactions, "captured_requests": captured},
        "endpoints.json": endpoints,
        "strategy.json": strategy,
        "recommendations.json": recommendations,
    }
    for filename, payload in files.items():
        (output / filename).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (output / "report.md").write_text(report, encoding="utf-8")
    return {
        "ok": True,
        "probe_id": probe_id,
        "bundle_dir": str(output),
        "summary": {
            "final_url": manifest["final_url"],
            "page_strategy": strategy["page_strategy"],
            "auth_strategy": strategy["auth_strategy"],
            "endpoint_count": len(endpoints),
            "captured_request_count": len(captured),
            "interaction_count": len(interactions),
        },
    }
