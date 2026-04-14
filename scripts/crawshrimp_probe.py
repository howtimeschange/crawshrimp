#!/usr/bin/env python3
"""Convenience wrapper for crawshrimp probe APIs.

Examples:
  ./venv/bin/python scripts/crawshrimp_probe.py run --adapter temu --task goods_traffic_detail --goal "识别详情抽屉"
  ./venv/bin/python scripts/crawshrimp_probe.py show --probe-id 2026-04-14T10-00-00Z-current
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
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
        clean = parsed._replace(fragment="")
        return clean.geturl()
    except Exception:
        return str(raw or "").strip()


def _api_request(api_base: str, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    url = api_base.rstrip("/") + path
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(url, data=data, headers=headers, method=method.upper())
    try:
        with urlopen(request, timeout=30) as response:
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
            output = subprocess.check_output(
                ["osascript", "-e", script],
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
        except Exception:
            continue
        if not output:
            continue
        url, *title_lines = output.splitlines()
        url = url.strip()
        if not url:
            continue
        return {
            "app_name": app_name,
            "url": url,
            "title": "\n".join(title_lines).strip(),
        }
    return None


def _resolve_current_tab_id(api_base: str) -> str:
    front_tab = _front_chrome_tab_meta()
    tabs = _api_request(api_base, "GET", "/settings/chrome-tabs")
    if not isinstance(tabs, list) or not tabs:
        return ""
    if not front_tab or not front_tab.get("url"):
        return ""

    normalized_url = _normalize_url(front_tab["url"])
    normalized_title = str(front_tab.get("title") or "").strip()

    by_url = [tab for tab in tabs if _normalize_url(str(tab.get("url") or "")) == normalized_url]
    if normalized_title:
        for tab in by_url:
            if str(tab.get("title") or "").strip() == normalized_title:
                return str(tab.get("id") or "")
    if len(by_url) == 1:
        return str(by_url[0].get("id") or "")

    if normalized_title:
        by_title = [tab for tab in tabs if str(tab.get("title") or "").strip() == normalized_title]
        if len(by_title) == 1:
            return str(by_title[0].get("id") or "")
    return ""


def _print_summary(payload: dict[str, Any]) -> None:
    print(f"probe_id: {payload.get('probe_id', '')}")
    print(f"bundle_dir: {payload.get('bundle_dir', '')}")
    summary = payload.get("summary") or {}
    if summary:
        print(f"page_strategy: {summary.get('page_strategy', '')}")
        print(f"auth_strategy: {summary.get('auth_strategy', '')}")
        if summary.get("endpoint_count") is not None:
            print(f"endpoint_count: {summary.get('endpoint_count')}")
        if summary.get("interaction_count") is not None:
            print(f"interaction_count: {summary.get('interaction_count')}")


def run_command(args: argparse.Namespace) -> int:
    current_tab_id = args.current_tab_id or _resolve_current_tab_id(args.api)
    payload = {
        "adapter_id": args.adapter,
        "task_id": args.task,
        "goal": args.goal,
        "mode": args.mode,
        "current_tab_id": current_tab_id or None,
        "profile": args.profile,
        "safe_auto": args.safe_auto,
        "safe_click_labels": args.safe_click_labels,
        "safe_click_selectors": args.safe_click_selectors,
        "safe_click_limit": args.safe_click_limit,
        "capture_response_body": not args.no_response_body,
    }
    result = _api_request(args.api, "POST", "/probe/run", payload)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        _print_summary(result)
        if current_tab_id:
            print(f"current_tab_id: {current_tab_id}")
    return 0


def show_command(args: argparse.Namespace) -> int:
    path = f"/probe/{args.probe_id}"
    if args.bundle:
        path += "/bundle"
    result = _api_request(args.api, "GET", path)
    if args.json or args.bundle:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        _print_summary(result)
        print("files:", ", ".join(result.get("files") or []))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run or inspect crawshrimp probe bundles.")
    parser.add_argument("--api", default=DEFAULT_API, help=f"crawshrimp API base URL (default: {DEFAULT_API})")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="Run a probe")
    run.add_argument("--adapter", required=True, help="adapter id")
    run.add_argument("--task", required=True, help="task id")
    run.add_argument("--goal", default="", help="probe goal")
    run.add_argument("--mode", default="current", choices=["current", "new"], help="probe mode")
    run.add_argument("--current-tab-id", default="", help="current chrome tab id; omit to auto-detect")
    run.add_argument("--profile", default="", help="probe profile name override")
    run.add_argument("--safe-auto", action="store_true", help="force safe auto interactions on")
    run.add_argument("--safe-click-labels", nargs="*", default=[], help="extra safe click labels")
    run.add_argument("--safe-click-selectors", nargs="*", default=[], help="extra safe click selectors")
    run.add_argument("--safe-click-limit", type=int, default=3, help="safe click target limit")
    run.add_argument("--no-response-body", action="store_true", help="skip response body capture")
    run.add_argument("--json", action="store_true", help="print JSON response")
    run.set_defaults(func=run_command)

    show = sub.add_parser("show", help="Show a probe result")
    show.add_argument("--probe-id", required=True, help="probe id")
    show.add_argument("--bundle", action="store_true", help="print full bundle")
    show.add_argument("--json", action="store_true", help="print JSON response")
    show.set_defaults(func=show_command)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
