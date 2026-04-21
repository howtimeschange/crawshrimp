#!/usr/bin/env python3
"""Primary developer-facing harness for crawshrimp.

Examples:
  ./venv/bin/python scripts/crawshrimp_dev_harness.py snapshot --adapter temu --task goods_traffic_detail
  ./venv/bin/python scripts/crawshrimp_dev_harness.py eval --adapter temu --task goods_traffic_detail --file /tmp/check.js --allow-navigation-retry
  ./venv/bin/python scripts/crawshrimp_dev_harness.py knowledge --adapter temu --task goods_traffic_detail --query drawer
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen


DEFAULT_API = "http://127.0.0.1:18765"


def _normalize_url(raw: str) -> str:
    try:
        parsed = urlparse(str(raw or "").strip())
        if not parsed.scheme or not parsed.netloc:
            return str(raw or "").strip()
        return parsed._replace(fragment="").geturl()
    except Exception:
        return str(raw or "").strip()


def _api_request(api_base: str, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    url = api_base.rstrip("/") + path
    headers: dict[str, str] = {}
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(url, data=data, headers=headers, method=method.upper())
    try:
        with urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", "ignore")
        raise RuntimeError(f"HTTP {exc.code}: {body or exc.reason}") from exc
    except URLError as exc:
        raise RuntimeError(f"无法连接 crawshrimp API: {exc.reason}") from exc


def _front_chrome_tab_meta() -> dict[str, str] | None:
    if sys.platform != "darwin":
        return None
    chrome_apps = ["Google Chrome", "Chromium", "Google Chrome for Testing"]
    for app_name in chrome_apps:
        script = "\n".join([
            f'tell application "{app_name}"',
            "  if not running then return \"\"",
            "  if (count of windows) = 0 then return \"\"",
            "  set activeTab to active tab of front window",
            "  return (URL of activeTab as text) & linefeed & (title of activeTab as text)",
            "end tell",
        ])
        try:
            output = subprocess.check_output(["osascript", "-e", script], text=True, stderr=subprocess.DEVNULL).strip()
        except Exception:
            continue
        if not output:
            continue
        url, *title_lines = output.splitlines()
        if not url.strip():
            continue
        return {
            "url": url.strip(),
            "title": "\n".join(title_lines).strip(),
        }
    return None


def _resolve_current_tab_id(api_base: str) -> str:
    front_tab = _front_chrome_tab_meta()
    tabs = _api_request(api_base, "GET", "/settings/chrome-tabs")
    if not isinstance(tabs, list) or not tabs or not front_tab:
        return ""
    normalized_url = _normalize_url(front_tab.get("url") or "")
    normalized_title = str(front_tab.get("title") or "").strip()
    by_url = [tab for tab in tabs if _normalize_url(str(tab.get("url") or "")) == normalized_url]
    if normalized_title:
        for tab in by_url:
            if str(tab.get("title") or "").strip() == normalized_title:
                return str(tab.get("id") or "")
    if len(by_url) == 1:
        return str(by_url[0].get("id") or "")
    return ""


def _base_payload(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "adapter_id": args.adapter,
        "task_id": args.task,
        "mode": args.mode,
        "current_tab_id": args.current_tab_id or _resolve_current_tab_id(args.api) or None,
        "entry_url": args.entry_url or None,
    }


def _print_json(payload: Any) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def snapshot_command(args: argparse.Namespace) -> int:
    payload = {
        **_base_payload(args),
        "include_framework": args.include_framework,
        "include_knowledge": not args.no_knowledge,
        "knowledge_query": args.knowledge_query,
        "knowledge_limit": args.knowledge_limit,
    }
    result = _api_request(args.api, "POST", "/dev-harness/snapshot", payload)
    if args.json:
        _print_json(result)
        return 0
    dom = result.get("dom") or {}
    print(f"url: {dom.get('url') or ''}")
    print(f"title: {dom.get('title') or ''}")
    print("headings:", ", ".join(dom.get("headings") or []))
    knowledge = result.get("knowledge") or {}
    if knowledge.get("cards"):
        print("knowledge:")
        for card in knowledge["cards"]:
            print(f"- [{card.get('kind')}] {card.get('title')}")
    return 0


def eval_command(args: argparse.Namespace) -> int:
    expression = args.expr or ""
    if args.file:
        expression = Path(args.file).read_text(encoding="utf-8")
    payload = {
        **_base_payload(args),
        "expression": expression,
        "allow_navigation_retry": args.allow_navigation_retry,
    }
    result = _api_request(args.api, "POST", "/dev-harness/eval", payload)
    _print_json(result)
    return 0


def _parse_clicks(raw_clicks: list[str]) -> list[dict[str, Any]]:
    clicks: list[dict[str, Any]] = []
    for raw in raw_clicks:
        x_text, _, y_text = str(raw or "").partition(",")
        clicks.append({"x": float(x_text.strip()), "y": float(y_text.strip())})
    return clicks


def _parse_matches(raw: str) -> list[dict[str, Any]]:
    if not raw:
        return []
    payload = json.loads(raw)
    if not isinstance(payload, list):
        raise RuntimeError("--matches-json 必须是 JSON 数组")
    return payload


def capture_command(args: argparse.Namespace) -> int:
    payload = {
        **_base_payload(args),
        "capture_mode": args.capture_mode,
        "clicks": _parse_clicks(args.click or []),
        "url": args.url,
        "matches": _parse_matches(args.matches_json),
        "timeout_ms": args.timeout_ms,
        "settle_ms": args.settle_ms,
        "min_matches": args.min_matches,
        "include_response_body": not args.no_response_body,
    }
    result = _api_request(args.api, "POST", "/dev-harness/capture", payload)
    _print_json(result)
    return 0


def knowledge_command(args: argparse.Namespace) -> int:
    path = "/knowledge/search?" + urlencode({
        "q": args.query,
        "adapter_id": args.adapter or "",
        "task_id": args.task or "",
        "url": args.url or "",
        "limit": args.limit,
    })
    result = _api_request(args.api, "GET", path)
    if args.json:
        _print_json(result)
        return 0
    for card in result.get("cards") or []:
        print(f"- [{card.get('kind')}] {card.get('title')}")
        print(f"  {card.get('excerpt')}")
        if card.get("skill_path"):
            print(f"  skill: {card['skill_path']}")
    return 0


def rebuild_knowledge_command(args: argparse.Namespace) -> int:
    result = _api_request(args.api, "POST", "/knowledge/rebuild")
    _print_json(result)
    return 0


def probe_command(args: argparse.Namespace) -> int:
    payload = {
        **_base_payload(args),
        "goal": args.goal,
        "profile": args.profile,
        "safe_auto": args.safe_auto,
        "safe_click_labels": args.safe_click_labels,
        "safe_click_selectors": args.safe_click_selectors,
        "safe_click_limit": args.safe_click_limit,
        "capture_response_body": not args.no_response_body,
    }
    result = _api_request(args.api, "POST", "/probe/run", payload)
    _print_json(result if args.json else {
        "probe_id": result.get("probe_id"),
        "bundle_dir": result.get("bundle_dir"),
        "summary": result.get("summary"),
    })
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Primary dev harness for crawshrimp adapter development.")
    parser.add_argument("--api", default=DEFAULT_API, help=f"crawshrimp API base URL (default: {DEFAULT_API})")
    sub = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--adapter", required=True, help="adapter id")
    common.add_argument("--task", required=True, help="task id")
    common.add_argument("--mode", default="current", choices=["current", "new"], help="session mode")
    common.add_argument("--current-tab-id", default="", help="current chrome tab id; omit to auto-detect")
    common.add_argument("--entry-url", default="", help="override task entry url")

    snapshot = sub.add_parser("snapshot", parents=[common], help="Get DOM snapshot plus relevant knowledge hits")
    snapshot.add_argument("--include-framework", action="store_true", help="include framework snapshot")
    snapshot.add_argument("--no-knowledge", action="store_true", help="skip knowledge search")
    snapshot.add_argument("--knowledge-query", default="", help="explicit knowledge search query")
    snapshot.add_argument("--knowledge-limit", type=int, default=5, help="knowledge result limit")
    snapshot.add_argument("--json", action="store_true", help="print JSON response")
    snapshot.set_defaults(func=snapshot_command)

    evaluate = sub.add_parser("eval", parents=[common], help="Evaluate JS in the current browser session")
    source = evaluate.add_mutually_exclusive_group(required=True)
    source.add_argument("--expr", default="", help="inline JS expression")
    source.add_argument("--file", default="", help="path to JS file")
    evaluate.add_argument("--allow-navigation-retry", action="store_true", help="retry through navigation/context resets")
    evaluate.set_defaults(func=eval_command)

    capture = sub.add_parser("capture", parents=[common], help="Capture passive/click/url requests via JSRunner primitives")
    capture.add_argument("--capture-mode", default="passive", choices=["passive", "click", "url"], help="capture mode")
    capture.add_argument("--click", action="append", help="click coordinate as x,y; repeatable")
    capture.add_argument("--url", default="", help="target url for url capture mode")
    capture.add_argument("--matches-json", default="", help="JSON array of request matchers")
    capture.add_argument("--timeout-ms", type=int, default=8000, help="capture timeout in ms")
    capture.add_argument("--settle-ms", type=int, default=1000, help="settle wait in ms")
    capture.add_argument("--min-matches", type=int, default=1, help="minimum expected matches")
    capture.add_argument("--no-response-body", action="store_true", help="skip response body capture")
    capture.set_defaults(func=capture_command)

    knowledge = sub.add_parser("knowledge", help="Search generated adapter knowledge cards")
    knowledge.add_argument("--query", default="", help="search query")
    knowledge.add_argument("--adapter", default="", help="adapter id filter")
    knowledge.add_argument("--task", default="", help="task id filter")
    knowledge.add_argument("--url", default="", help="current page url filter")
    knowledge.add_argument("--limit", type=int, default=8, help="result limit")
    knowledge.add_argument("--json", action="store_true", help="print JSON response")
    knowledge.set_defaults(func=knowledge_command)

    rebuild = sub.add_parser("rebuild-knowledge", help="Regenerate knowledge cards and grouped skill docs")
    rebuild.set_defaults(func=rebuild_knowledge_command)

    probe = sub.add_parser("probe", parents=[common], help="Run the existing structured probe flow from the dev harness entrypoint")
    probe.add_argument("--goal", default="", help="probe goal")
    probe.add_argument("--profile", default="", help="probe profile name override")
    probe.add_argument("--safe-auto", action="store_true", help="force safe auto interactions on")
    probe.add_argument("--safe-click-labels", nargs="*", default=[], help="extra safe click labels")
    probe.add_argument("--safe-click-selectors", nargs="*", default=[], help="extra safe click selectors")
    probe.add_argument("--safe-click-limit", type=int, default=3, help="safe click target limit")
    probe.add_argument("--no-response-body", action="store_true", help="skip response body capture")
    probe.add_argument("--json", action="store_true", help="print JSON response")
    probe.set_defaults(func=probe_command)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
