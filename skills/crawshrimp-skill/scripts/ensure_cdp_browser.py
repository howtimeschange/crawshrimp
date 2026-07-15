#!/usr/bin/env python3
"""Ensure a local Chrome CDP endpoint exists for connection-refused recovery."""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import socket
import subprocess
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, build_opener, ProxyHandler


JsonPayload = dict[str, Any] | list[Any] | str | int | float | bool | None


@dataclass(frozen=True)
class ProbeResult:
    status: str
    detail: str
    version: dict[str, Any] | None = None
    tabs_count: int | None = None


@dataclass(frozen=True)
class EnsureResult:
    status: str
    detail: str
    cdp_url: str
    launched: bool = False
    chrome_path: str = ""
    profile_dir: str = ""
    log_file: str = ""
    probe: ProbeResult | None = None

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, indent=2)


def _json_request(url: str, *, timeout: float) -> JsonPayload:
    request = Request(url)
    opener = build_opener(ProxyHandler({}))
    with opener.open(request, timeout=timeout) as response:
        body = response.read().decode("utf-8")
        return json.loads(body) if body else None


def _is_connection_refused(error: BaseException) -> bool:
    if isinstance(error, ConnectionRefusedError):
        return True
    reason = getattr(error, "reason", None)
    if isinstance(reason, ConnectionRefusedError):
        return True
    if isinstance(reason, OSError) and getattr(reason, "errno", None) in {61, 111, 10061}:
        return True
    text = f"{reason or error}".lower()
    return "connection refused" in text or "errno 61" in text or "errno 111" in text or "10061" in text


def _is_timeout(error: BaseException) -> bool:
    if isinstance(error, (TimeoutError, socket.timeout)):
        return True
    reason = getattr(error, "reason", None)
    if isinstance(reason, (TimeoutError, socket.timeout)):
        return True
    return "timed out" in f"{reason or error}".lower()


def _fetch_json_status(url: str, *, timeout: float) -> tuple[str, JsonPayload | None, str]:
    try:
        return "ok", _json_request(url, timeout=timeout), ""
    except HTTPError as exc:
        return "http_error", None, f"HTTP {exc.code}: {exc.reason}"
    except (URLError, OSError, TimeoutError, json.JSONDecodeError) as exc:
        if _is_connection_refused(exc):
            return "connection_refused", None, str(getattr(exc, "reason", exc))
        if _is_timeout(exc):
            return "timeout", None, str(getattr(exc, "reason", exc))
        if isinstance(exc, json.JSONDecodeError):
            return "malformed_json", None, str(exc)
        return "url_error", None, str(getattr(exc, "reason", exc))


def probe_cdp(cdp_url: str, *, timeout: float = 2.0) -> ProbeResult:
    base = cdp_url.rstrip("/")
    version_status, version_payload, version_detail = _fetch_json_status(f"{base}/json/version", timeout=timeout)
    tabs_status, tabs_payload, tabs_detail = _fetch_json_status(f"{base}/json", timeout=timeout)

    if version_status == "connection_refused" and tabs_status == "connection_refused":
        return ProbeResult("connection_refused", "both /json/version and /json refused connection")

    if version_status != "ok" or tabs_status != "ok":
        detail = "; ".join(
            item
            for item in [
                f"/json/version={version_status} {version_detail}".strip(),
                f"/json={tabs_status} {tabs_detail}".strip(),
            ]
            if item
        )
        return ProbeResult("blocked", detail)

    if not isinstance(version_payload, dict) or not str(version_payload.get("Browser") or "").strip():
        return ProbeResult("blocked", "/json/version did not return a Browser object")
    if not isinstance(tabs_payload, list):
        return ProbeResult("blocked", "/json did not return a tab array")
    return ProbeResult(
        "ready",
        "CDP endpoint is healthy",
        version=dict(version_payload),
        tabs_count=len(tabs_payload),
    )


def _candidate_chrome_paths() -> list[str]:
    candidates: list[str] = []
    system = platform.system()
    if system == "Darwin":
        candidates.extend(
            [
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                str(Path.home() / "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
                "/Applications/Chromium.app/Contents/MacOS/Chromium",
            ]
        )
    elif system == "Windows":
        for root in [
            os.environ.get("PROGRAMFILES"),
            os.environ.get("PROGRAMFILES(X86)"),
            os.environ.get("LOCALAPPDATA"),
        ]:
            if not root:
                continue
            candidates.extend(
                [
                    str(Path(root) / "Google/Chrome/Application/chrome.exe"),
                    str(Path(root) / "Chromium/Application/chrome.exe"),
                ]
            )
    else:
        candidates.extend(["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"])
    return candidates


def find_chrome(chrome_path: str = "") -> str:
    if chrome_path:
        path = Path(chrome_path).expanduser()
        if path.is_file():
            return str(path)
        resolved = shutil.which(chrome_path)
        if resolved:
            return resolved
        raise FileNotFoundError(f"Chrome executable not found: {chrome_path}")

    for candidate in _candidate_chrome_paths():
        path = Path(candidate).expanduser()
        if path.is_file():
            return str(path)
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise FileNotFoundError("Chrome or Chromium executable not found")


def _cdp_host_port(cdp_url: str) -> tuple[str, int]:
    parsed = urlparse(cdp_url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 9222
    if host not in {"127.0.0.1", "localhost"}:
        raise ValueError("automatic browser recovery only supports loopback CDP URLs")
    return "127.0.0.1", port


def launch_chrome(
    *,
    cdp_url: str,
    chrome_path: str,
    profile_dir: Path,
    log_file: Path,
    start_url: str,
) -> None:
    host, port = _cdp_host_port(cdp_url)
    profile_dir.mkdir(parents=True, exist_ok=True)
    log_file.parent.mkdir(parents=True, exist_ok=True)
    args = [
        chrome_path,
        f"--remote-debugging-address={host}",
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile_dir}",
        "--no-first-run",
        "--no-default-browser-check",
        "--new-window",
        start_url,
    ]
    with log_file.open("ab") as out:
        subprocess.Popen(args, stdout=out, stderr=subprocess.STDOUT, start_new_session=True)


def ensure_cdp_browser(
    *,
    cdp_url: str,
    profile_dir: Path,
    log_file: Path,
    timeout_seconds: float,
    poll_interval: float,
    start_url: str,
    chrome_path: str = "",
    probe: Callable[[str], ProbeResult] | None = None,
    launcher: Callable[[str], None] | None = None,
    sleeper: Callable[[float], None] = time.sleep,
    monotonic: Callable[[], float] = time.monotonic,
) -> EnsureResult:
    probe_func = probe or (lambda url: probe_cdp(url))
    first = probe_func(cdp_url)
    if first.status == "ready":
        return EnsureResult("ready", first.detail, cdp_url, profile_dir=str(profile_dir), log_file=str(log_file), probe=first)
    if first.status != "connection_refused":
        return EnsureResult("blocked", first.detail, cdp_url, profile_dir=str(profile_dir), log_file=str(log_file), probe=first)

    second = probe_func(cdp_url)
    if second.status == "ready":
        return EnsureResult("ready", second.detail, cdp_url, profile_dir=str(profile_dir), log_file=str(log_file), probe=second)
    if second.status != "connection_refused":
        return EnsureResult("blocked", second.detail, cdp_url, profile_dir=str(profile_dir), log_file=str(log_file), probe=second)

    try:
        resolved_chrome = find_chrome(chrome_path)
        if launcher is None:
            launch_chrome(
                cdp_url=cdp_url,
                chrome_path=resolved_chrome,
                profile_dir=profile_dir,
                log_file=log_file,
                start_url=start_url,
            )
        else:
            launcher(resolved_chrome)
    except (FileNotFoundError, OSError, ValueError) as exc:
        return EnsureResult(
            "failed",
            f"could not launch dedicated Chrome: {exc}",
            cdp_url,
            profile_dir=str(profile_dir),
            log_file=str(log_file),
            probe=second,
        )

    deadline = monotonic() + timeout_seconds
    last_probe = second
    while monotonic() <= deadline:
        current = probe_func(cdp_url)
        last_probe = current
        if current.status == "ready":
            return EnsureResult(
                "launched",
                current.detail,
                cdp_url,
                launched=True,
                chrome_path=resolved_chrome,
                profile_dir=str(profile_dir),
                log_file=str(log_file),
                probe=current,
            )
        sleeper(max(poll_interval, 0.0))

    return EnsureResult(
        "failed",
        f"Chrome was launched but CDP was not ready within {timeout_seconds:g}s: {last_probe.detail}",
        cdp_url,
        launched=True,
        chrome_path=resolved_chrome,
        profile_dir=str(profile_dir),
        log_file=str(log_file),
        probe=last_probe,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Open a dedicated local Chrome CDP browser only after 9222 connection refused.")
    parser.add_argument("--cdp-url", default="http://127.0.0.1:9222")
    parser.add_argument("--profile-dir", default=str(Path.home() / ".crawshrimp-skill/chrome-profile"))
    parser.add_argument("--log-file", default=str(Path.home() / ".crawshrimp-skill/chrome-9222.log"))
    parser.add_argument("--timeout-seconds", type=float, default=30.0)
    parser.add_argument("--poll-interval", type=float, default=0.5)
    parser.add_argument("--start-url", default="about:blank")
    parser.add_argument("--chrome-path", default="")
    args = parser.parse_args(argv)

    result = ensure_cdp_browser(
        cdp_url=args.cdp_url,
        profile_dir=Path(args.profile_dir).expanduser(),
        log_file=Path(args.log_file).expanduser(),
        timeout_seconds=args.timeout_seconds,
        poll_interval=args.poll_interval,
        start_url=args.start_url,
        chrome_path=args.chrome_path,
    )
    print(result.to_json())
    return 0 if result.status in {"ready", "launched"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
