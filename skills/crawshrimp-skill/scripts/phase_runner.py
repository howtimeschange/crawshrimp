#!/usr/bin/env python3
"""Crawshrimp-style multi-phase runtime for agent web workflows."""

from __future__ import annotations

import argparse
import asyncio
import json
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable

try:
    from scripts.browser_executor import BrowserAction, BrowserResult, ChromeCDPBackend
    from scripts.runtime_downloads import DownloadManager
except ModuleNotFoundError:
    from browser_executor import BrowserAction, BrowserResult, ChromeCDPBackend
    from runtime_downloads import DownloadManager


MAX_PAGES = 1000
MAX_PHASES = 9999
NAVIGATION_ERROR_MARKERS = (
    "Inspected target navigated or closed",
    "Cannot find context with specified id",
    "Promise was collected",
    "Execution context was destroyed",
)


class RunAbortedError(RuntimeError):
    def __init__(self, reason: str = "run aborted", partial_data: list[dict[str, Any]] | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.partial_data = list(partial_data or [])


@dataclass
class PhaseRunResult:
    data: list[dict[str, Any]] = field(default_factory=list)
    shared: dict[str, Any] = field(default_factory=dict)
    output_files: list[str] = field(default_factory=list)
    pages: int = 0
    phases: int = 0


def _merge_runtime_shared(shared: dict[str, Any] | None, shared_key: str, value: Any, append: bool = False) -> dict[str, Any]:
    merged = dict(shared or {})
    if not shared_key:
        return merged
    if not append:
        merged[shared_key] = value
        return merged
    existing = merged.get(shared_key)
    if isinstance(existing, list):
        base = list(existing)
    elif existing is None:
        base = []
    else:
        base = [existing]
    if isinstance(value, list):
        base.extend(value)
    else:
        base.append(value)
    merged[shared_key] = base
    return merged


class WebPhaseRunner:
    """Interpret the crawshrimp JSResult meta protocol over a BrowserBackend."""

    def __init__(
        self,
        *,
        backend: Any,
        artifact_dir: Path | str | None = None,
        max_pages: int = MAX_PAGES,
        max_phases: int = MAX_PHASES,
        sleep: Callable[[float], Awaitable[None]] | None = None,
    ) -> None:
        self.backend = backend
        self.max_pages = max_pages
        self.max_phases = max_phases
        self.artifact_dir = Path(artifact_dir).expanduser() if artifact_dir else Path.cwd() / "artifacts"
        self.downloader = DownloadManager(self.artifact_dir, browser_session_downloader=self._download_browser_session)
        self.download_dir: Path = Path.home() / "Downloads"
        self._sleep = sleep or asyncio.sleep

    def _params_storage_key(self, run_token: str) -> str:
        return f"__CRAWSHRIMP_PARAMS__:{run_token}"

    def _build_phase_preamble(self, page: int, phase: str, run_token: str, shared: dict[str, Any], params_json: str) -> str:
        storage_key = json.dumps(self._params_storage_key(run_token), ensure_ascii=False)
        payload_json = json.dumps(params_json, ensure_ascii=False)
        return (
            "(() => {\n"
            f"  window.__CRAWSHRIMP_PAGE__ = {page};\n"
            f"  window.__CRAWSHRIMP_PHASE__ = {json.dumps(phase, ensure_ascii=False)};\n"
            f"  window.__CRAWSHRIMP_RUN_TOKEN__ = {json.dumps(run_token, ensure_ascii=False)};\n"
            f"  window.__CRAWSHRIMP_SHARED__ = {json.dumps(shared, ensure_ascii=False)};\n"
            f"  const __crawshrimpStorageKey = {storage_key};\n"
            f"  const __crawshrimpParamsPayload = {payload_json};\n"
            "  try {\n"
            "    try { window.sessionStorage.setItem(__crawshrimpStorageKey, __crawshrimpParamsPayload); }\n"
            "    catch (storageError) { window.name = __crawshrimpStorageKey + '\\n' + __crawshrimpParamsPayload; }\n"
            "    window.__CRAWSHRIMP_PARAMS__ = JSON.parse(__crawshrimpParamsPayload);\n"
            "  } catch (e) {}\n"
            "})();\n"
        )

    def _build_cleanup_script(self, run_token: str) -> str:
        storage_key = json.dumps(self._params_storage_key(run_token), ensure_ascii=False)
        return (
            "(() => {\n"
            f"  const __crawshrimpStorageKey = {storage_key};\n"
            "  try { window.sessionStorage.removeItem(__crawshrimpStorageKey); } catch (e) {}\n"
            "  try {\n"
            "    delete window.__CRAWSHRIMP_PARAMS__;\n"
            "    delete window.__CRAWSHRIMP_PAGE__;\n"
            "    delete window.__CRAWSHRIMP_PHASE__;\n"
            "    delete window.__CRAWSHRIMP_RUN_TOKEN__;\n"
            "    delete window.__CRAWSHRIMP_SHARED__;\n"
            "  } catch (e) {}\n"
            "})();\n"
        )

    async def _execute(self, action: BrowserAction) -> BrowserResult:
        execute_async = getattr(self.backend, "execute_async", None)
        if callable(execute_async):
            result = execute_async(action)
        else:
            result = self.backend.execute(action)
        if hasattr(result, "__await__"):
            result = await result
        return result

    async def _download_browser_session(self, item: dict[str, Any], target_path: Path, timeout_seconds: int) -> dict[str, Any]:
        for hook_name in ("download_browser_session", "download_via_browser_session"):
            hook = getattr(self.backend, hook_name, None)
            if hook is None:
                continue
            result = hook(item, target_path, timeout_seconds)
            if hasattr(result, "__await__"):
                result = await result
            return result if isinstance(result, dict) else {"success": False, "path": str(target_path), "error": f"{hook_name} returned invalid result"}
        return {
            "success": False,
            "path": str(target_path),
            "error": "browser_session download requires backend.download_browser_session hook",
            "browserSession": True,
        }

    def _is_navigation_error(self, error: str) -> bool:
        return any(marker in (error or "") for marker in NAVIGATION_ERROR_MARKERS)

    async def _eval_with_reconnect(self, script: str) -> BrowserResult:
        result = await self._execute(BrowserAction(kind="eval", script=script, user_gesture=True))
        retry = 0
        while not result.ok and self._is_navigation_error(result.error) and retry < 4:
            retry += 1
            await self._sleep(min(0.8 * retry + 0.4, 3.0))
            result = await self._execute(BrowserAction(kind="eval", script=script, user_gesture=True))
        return result

    def _coerce_js_result(self, result: BrowserResult) -> tuple[bool, list[dict[str, Any]], dict[str, Any], str]:
        if not result.ok:
            return False, [], {}, result.error or "browser action failed"
        value = result.data.get("value") if isinstance(result.data, dict) else result.data
        if not isinstance(value, dict):
            return False, [], {}, f"script returned invalid value: {type(value).__name__}"
        data = value.get("data") or []
        if not isinstance(data, list):
            data = []
        rows = [item for item in data if isinstance(item, dict)]
        meta = value.get("meta") if isinstance(value.get("meta"), dict) else {}
        return bool(value.get("success", False)), rows, meta, str(value.get("error") or "")

    async def run_script(
        self,
        script: str,
        *,
        params: dict[str, Any] | None = None,
        control_hook: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> PhaseRunResult:
        params_json = json.dumps(params or {}, ensure_ascii=False)
        run_token = f"{int(time.time() * 1000)}-{secrets.token_hex(4)}"
        all_data: list[dict[str, Any]] = []
        page_shared: dict[str, Any] = {}
        final_shared: dict[str, Any] = {}
        phase_count = 0

        async def cleanup() -> None:
            try:
                await self._execute(BrowserAction(kind="eval", script=self._build_cleanup_script(run_token)))
            except Exception:
                pass

        async def cooperate(kind: str, page: int, phase: str, shared: dict[str, Any], extra: dict[str, Any] | None = None) -> None:
            if control_hook is None:
                return
            payload = {"kind": kind, "page": page, "phase": phase, "shared": shared, "records": len(all_data)}
            if extra:
                payload.update(extra)
            await control_hook(payload)

        try:
            for page in range(1, self.max_pages + 1):
                phase = "main"
                shared = dict(page_shared)
                for phase_index in range(1, self.max_phases + 1):
                    phase_count += 1
                    await cooperate("before_phase", page, phase, shared)
                    payload = self._build_phase_preamble(page, phase, run_token, shared, params_json) + script
                    timeout_retry = False
                    while True:
                        raw_result = await self._eval_with_reconnect(payload)
                        success, rows, meta, error = self._coerce_js_result(raw_result)
                        if success:
                            break
                        if error != "timeout" or timeout_retry:
                            raise RuntimeError(error or "script execution failed")
                        timeout_retry = True
                        await self._execute(BrowserAction(kind="reload"))
                        await self._sleep(2.0)

                    action = str(meta.get("action") or "complete")
                    if "shared" in meta and isinstance(meta.get("shared"), dict):
                        shared = dict(meta.get("shared") or {})
                    if rows:
                        all_data.extend(rows)
                    final_shared = dict(shared or {})

                    if action == "cdp_clicks":
                        clicks = meta.get("clicks") or []
                        for index, click in enumerate(clicks):
                            await cooperate("before_click", page, phase, shared, {"click_index": index, "click_total": len(clicks)})
                            await self._execute(BrowserAction(kind="click", x=float(click["x"]), y=float(click["y"])))
                        await self._sleep(float(meta.get("sleep_ms", 300)) / 1000.0)
                        phase = str(meta.get("next_phase") or phase)
                        continue

                    if action == "inject_files":
                        items = meta.get("items") or []
                        for item in items:
                            await self._execute(BrowserAction(kind="upload", selector=str(item.get("selector") or ""), files=list(item.get("files") or [])))
                        await self._sleep(float(meta.get("sleep_ms", 500)) / 1000.0)
                        phase = str(meta.get("next_phase") or phase)
                        continue

                    if action == "file_chooser_upload":
                        items = meta.get("items") or []
                        results = []
                        for item in items:
                            result = await self._execute(
                                BrowserAction(
                                    kind="upload_chooser",
                                    clicks=list(item.get("clicks") or []),
                                    files=list(item.get("files") or []),
                                    timeout_ms=int(item.get("timeout_ms") or 12000),
                                )
                            )
                            results.append({"success": result.ok, **result.data, "error": result.error})
                        upload_result = {"ok": all(item.get("success") for item in results), "items": results}
                        if meta.get("strict") and not upload_result["ok"]:
                            raise RuntimeError("file chooser upload failed")
                        shared = _merge_runtime_shared(shared, str(meta.get("shared_key") or ""), upload_result, bool(meta.get("shared_append")))
                        await self._sleep(float(meta.get("sleep_ms", 500)) / 1000.0)
                        phase = str(meta.get("next_phase") or phase)
                        continue

                    if action in {"capture_click_requests", "capture_url_requests", "capture_wheel_requests"}:
                        min_matches = int(meta.get("min_matches") or meta.get("minMatches") or 0)
                        include_response_body = bool(meta.get("include_response_body") or meta.get("includeResponseBody"))
                        if action == "capture_click_requests":
                            capture_action = BrowserAction(kind="capture", capture_mode="click", clicks=list(meta.get("clicks") or []), matches=list(meta.get("matches") or []), min_matches=min_matches, include_response_body=include_response_body, timeout_ms=int(meta.get("timeout_ms") or 8000), settle_ms=int(meta.get("settle_ms") or 1000))
                        elif action == "capture_wheel_requests":
                            capture_action = BrowserAction(kind="capture", capture_mode="wheel", wheels=list(meta.get("wheels") or []), matches=list(meta.get("matches") or []), min_matches=min_matches, include_response_body=include_response_body, timeout_ms=int(meta.get("timeout_ms") or 8000), settle_ms=int(meta.get("settle_ms") or 1000))
                        else:
                            capture_action = BrowserAction(kind="capture", capture_mode="url", url=str(meta.get("url") or ""), matches=list(meta.get("matches") or []), min_matches=min_matches, include_response_body=include_response_body, timeout_ms=int(meta.get("timeout_ms") or 12000), settle_ms=int(meta.get("settle_ms") or 1000))
                        result = await self._execute(capture_action)
                        if meta.get("strict") and not result.ok:
                            raise RuntimeError(result.error or f"{action} failed")
                        shared = _merge_runtime_shared(shared, str(meta.get("shared_key") or ""), result.data, bool(meta.get("shared_append")))
                        await self._sleep(float(meta.get("sleep_ms", 0)) / 1000.0)
                        phase = str(meta.get("next_phase") or phase)
                        continue

                    if action == "download_urls":
                        async def report(progress_payload: dict[str, Any]) -> None:
                            await cooperate("download_urls_progress", page, phase, shared, progress_payload)

                        download_result = await self.downloader.download_urls(
                            list(meta.get("items") or []),
                            strict=bool(meta.get("strict")),
                            concurrency=int(meta.get("concurrency") or meta.get("max_concurrency") or 1),
                            retry_attempts=int(meta.get("retry_attempts") or meta.get("retryAttempts") or meta.get("retries") or 1),
                            retry_delay_ms=int(meta.get("retry_delay_ms") or meta.get("retryDelayMs") or 0),
                            timeout_seconds=int(meta.get("timeout_seconds") or meta.get("timeoutSeconds") or meta.get("timeout") or 30),
                            progress_callback=report,
                        )
                        shared = _merge_runtime_shared(shared, str(meta.get("shared_key") or ""), download_result, bool(meta.get("shared_append")))
                        await self._sleep(float(meta.get("sleep_ms", 0)) / 1000.0)
                        phase = str(meta.get("next_phase") or phase)
                        continue

                    if action == "download_clicks":
                        download_result = await self.downloader.download_clicks(
                            list(meta.get("items") or []),
                            backend=self.backend,
                            download_dir=self.download_dir,
                            timeout_ms=int(meta.get("timeout_ms") or 30000),
                            strict=bool(meta.get("strict")),
                        )
                        shared = _merge_runtime_shared(shared, str(meta.get("shared_key") or ""), download_result, bool(meta.get("shared_append")))
                        await self._sleep(float(meta.get("sleep_ms", 0)) / 1000.0)
                        phase = str(meta.get("next_phase") or phase)
                        continue

                    if action == "reload_page":
                        await self._execute(BrowserAction(kind="reload"))
                        await self._sleep(float(meta.get("sleep_ms", 1000)) / 1000.0)
                        phase = str(meta.get("next_phase") or phase)
                        continue

                    if action == "next_phase":
                        next_phase = str(meta.get("next_phase") or "")
                        if not next_phase:
                            raise RuntimeError(f"next_phase action missing next_phase value (page={page}, phase={phase})")
                        phase = next_phase
                        await self._sleep(float(meta.get("sleep_ms", 1200)) / 1000.0)
                        continue

                    if action == "complete":
                        if not meta.get("has_more", False):
                            return PhaseRunResult(data=all_data, shared=shared, output_files=list(self.downloader.runtime_output_files), pages=page, phases=phase_count)
                        await self._sleep(float(meta.get("sleep_ms") or 0) / 1000.0)
                        page_shared = dict(shared or {})
                        break

                    if action == "abort":
                        raise RunAbortedError(str(meta.get("reason") or meta.get("error") or "run aborted"), partial_data=list(all_data))

                    raise RuntimeError(f"unknown phase action: {action}")
                else:
                    raise RuntimeError(f"phase execution exceeded limit ({self.max_phases}) on page {page}")
            raise RuntimeError(f"pagination exceeded limit ({self.max_pages})")
        finally:
            await cleanup()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a crawshrimp-style phase/shared JS workflow over CDP.")
    parser.add_argument("--cdp-url", default="http://127.0.0.1:9222")
    parser.add_argument("--tab-id", default="")
    parser.add_argument("--url-prefix", default="")
    parser.add_argument("--file", required=True)
    parser.add_argument("--params-json", default="{}")
    parser.add_argument("--artifact-dir", default="artifacts")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    params = json.loads(args.params_json)
    backend = ChromeCDPBackend(cdp_url=args.cdp_url, tab_id=args.tab_id, url_prefix=args.url_prefix)
    runner = WebPhaseRunner(backend=backend, artifact_dir=args.artifact_dir)
    result = asyncio.run(runner.run_script(Path(args.file).read_text(encoding="utf-8"), params=params))
    print(json.dumps({"data": result.data, "shared": result.shared, "output_files": result.output_files}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
