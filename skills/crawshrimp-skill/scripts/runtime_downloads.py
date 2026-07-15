#!/usr/bin/env python3
"""Runtime artifact downloads inspired by crawshrimp JSRunner."""

from __future__ import annotations

import asyncio
import base64
import json
import mimetypes
import re
import shutil
import time
from pathlib import Path
from typing import Any, Awaitable, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import unquote_to_bytes, urlsplit
from urllib.request import Request, build_opener, urlopen, ProxyHandler


ProgressCallback = Callable[[dict[str, Any]], None]
AsyncProgressCallback = Callable[[dict[str, Any]], Awaitable[None]]


def sanitize_filename(raw_name: str, fallback: str = "download.bin") -> str:
    name = Path(str(raw_name or "")).name
    name = re.sub(r"[\x00-\x1f]+", "", name)
    name = re.sub(r'[\\/:*?"<>|]+', "_", name).strip(" .")
    return name or fallback


def derive_url_filename(source_url: str, fallback: str = "download.bin") -> str:
    try:
        candidate = Path(urlsplit(str(source_url or "")).path).name
    except Exception:
        candidate = ""
    return sanitize_filename(candidate or fallback, fallback)


def _ensure_unique(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    index = 2
    while True:
        candidate = path.with_name(f"{stem}_{index}{suffix}")
        if not candidate.exists():
            return candidate
        index += 1


def _data_url_payload(url: str) -> tuple[bytes, str]:
    header, _, body = url.partition(",")
    mime = header[5:].split(";", 1)[0] or "application/octet-stream"
    if ";base64" in header:
        return base64.b64decode(body), mime
    return unquote_to_bytes(body), mime


class DownloadManager:
    def __init__(
        self,
        artifact_dir: Path | str,
        *,
        fetcher: Callable[[str, Path, dict[str, str], int, bool, ProgressCallback | None], Awaitable[dict[str, Any]]] | None = None,
        browser_session_downloader: Callable[[dict[str, Any], Path, int], Awaitable[dict[str, Any]] | dict[str, Any]] | None = None,
    ) -> None:
        self.artifact_dir = Path(artifact_dir).expanduser()
        self.artifact_dir.mkdir(parents=True, exist_ok=True)
        self.runtime_output_files: list[str] = []
        self._fetcher = fetcher
        self._browser_session_downloader = browser_session_downloader

    def target_path(self, filename: str = "", source_url: str = "", *, reuse_existing: bool = False) -> Path:
        raw_name = str(filename or "").strip() or derive_url_filename(source_url)
        clean_name = sanitize_filename(raw_name)
        source_suffix = ""
        if source_url:
            try:
                source_suffix = Path(urlsplit(source_url).path).suffix
            except Exception:
                source_suffix = ""
        if source_suffix and not Path(clean_name).suffix:
            clean_name = f"{clean_name}{source_suffix}"
        target = self.artifact_dir / clean_name
        if reuse_existing and target.exists():
            return target
        return _ensure_unique(target)

    async def _fetch_url(
        self,
        url: str,
        target_path: Path,
        headers: dict[str, str],
        timeout_seconds: int,
        no_proxy: bool,
        progress_callback: ProgressCallback | None,
    ) -> dict[str, Any]:
        if self._fetcher:
            return await self._fetcher(url, target_path, headers, timeout_seconds, no_proxy, progress_callback)
        if url.startswith("data:"):
            payload, content_type = _data_url_payload(url)
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_bytes(payload)
            if progress_callback:
                progress_callback({"bytes_downloaded": len(payload), "bytes_total": len(payload), "bytes_delta": len(payload)})
            return {
                "success": True,
                "path": str(target_path),
                "finalUrl": url[:80],
                "contentType": content_type,
                "bytes": len(payload),
                "contentLength": len(payload),
            }
        return await asyncio.to_thread(
            self._download_url_sync,
            url,
            target_path,
            headers,
            timeout_seconds,
            no_proxy,
            progress_callback,
        )

    def _download_url_sync(
        self,
        url: str,
        target_path: Path,
        headers: dict[str, str],
        timeout_seconds: int,
        no_proxy: bool,
        progress_callback: ProgressCallback | None,
    ) -> dict[str, Any]:
        request = Request(url, headers=headers or {})
        partial_path = target_path.with_name(f"{target_path.name}.part")
        deadline = time.monotonic() + max(timeout_seconds, 1)

        def cleanup_partial() -> None:
            try:
                if partial_path.exists() and partial_path.is_file():
                    partial_path.unlink()
            except Exception:
                pass

        def assert_deadline() -> None:
            if time.monotonic() >= deadline:
                raise TimeoutError(f"download timeout: {url} ({timeout_seconds}s)")

        try:
            opener = build_opener(ProxyHandler({})) if no_proxy else None
            open_url = opener.open if opener else urlopen
            assert_deadline()
            with open_url(request, timeout=max(timeout_seconds, 1)) as response:
                target_path.parent.mkdir(parents=True, exist_ok=True)
                cleanup_partial()
                with partial_path.open("wb") as handle:
                    bytes_written = 0
                    total_bytes = int(response.headers.get("Content-Length") or 0) if str(response.headers.get("Content-Length") or "").isdigit() else 0
                    while True:
                        assert_deadline()
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        handle.write(chunk)
                        bytes_written += len(chunk)
                        if progress_callback:
                            progress_callback({"bytes_downloaded": bytes_written, "bytes_delta": len(chunk), "bytes_total": total_bytes})
                partial_path.replace(target_path)
                return {
                    "success": True,
                    "path": str(target_path),
                    "finalUrl": response.geturl(),
                    "contentType": response.headers.get("Content-Type", ""),
                    "bytes": target_path.stat().st_size if target_path.exists() else 0,
                    "contentLength": total_bytes,
                }
        except HTTPError as exc:
            cleanup_partial()
            body = exc.read().decode("utf-8", "ignore")[:500]
            return {"success": False, "path": str(target_path), "status": exc.code, "error": f"HTTP {exc.code}: {body or exc.reason}"}
        except URLError as exc:
            cleanup_partial()
            return {"success": False, "path": str(target_path), "error": f"URL error: {exc.reason}"}
        except Exception as exc:
            cleanup_partial()
            return {"success": False, "path": str(target_path), "error": str(exc)}

    async def _download_one(
        self,
        item: dict[str, Any],
        *,
        retry_attempts: int,
        retry_delay_ms: int,
        timeout_seconds: int,
        progress_callback: ProgressCallback | None,
    ) -> dict[str, Any]:
        url = str(item.get("url") or "").strip()
        filename = str(item.get("filename") or "").strip()
        label = str(item.get("label") or filename or derive_url_filename(url)).strip()
        headers_raw = item.get("headers") if isinstance(item.get("headers"), dict) else {}
        headers = {str(key): str(value) for key, value in headers_raw.items() if str(key or "").strip() and value is not None}
        no_proxy = bool(item.get("no_proxy") or item.get("noProxy"))
        browser_session = bool(item.get("browser_session") or item.get("browserSession"))
        if not url:
            return {"success": False, "label": label or "download", "filename": filename, "error": "download url is empty", "attempts": 0}
        target = self.target_path(filename, url, reuse_existing=True)
        if target.is_file() and target.stat().st_size > 0:
            saved = str(target)
            if saved not in self.runtime_output_files:
                self.runtime_output_files.append(saved)
            return {
                "success": True,
                "path": saved,
                "label": label or target.name,
                "filename": target.name,
                "url": url,
                "attempts": 0,
                "skipped_existing": True,
                "bytes": target.stat().st_size,
            }
        last_result: dict[str, Any] | None = None
        for attempt in range(1, max(retry_attempts, 1) + 1):
            item_timeout = int(item.get("timeout_seconds") or item.get("timeoutSeconds") or item.get("timeout") or timeout_seconds)
            try:
                if browser_session:
                    if self._browser_session_downloader is None:
                        result = {
                            "success": False,
                            "path": str(target),
                            "error": "browser_session download requires a browser_session_downloader hook",
                            "browserSession": True,
                        }
                    else:
                        result = self._browser_session_downloader(item, target, item_timeout)
                        if hasattr(result, "__await__"):
                            result = await result
                        result = result if isinstance(result, dict) else {"success": False, "path": str(target), "error": "browser_session downloader returned invalid result"}
                        result.setdefault("browserSession", True)
                else:
                    result = await self._fetch_url(
                        url,
                        target,
                        headers,
                        item_timeout,
                        no_proxy,
                        progress_callback,
                    )
                result = result if isinstance(result, dict) else {"success": False, "path": str(target), "error": "download returned invalid result"}
            except Exception as exc:
                result = {"success": False, "path": str(target), "error": str(exc)}
            result["label"] = label or Path(str(result.get("path") or target)).name
            result["filename"] = Path(str(result.get("path") or target)).name
            result["url"] = url
            result["attempts"] = attempt
            if result.get("success"):
                saved = str(result.get("path") or target)
                if saved not in self.runtime_output_files:
                    self.runtime_output_files.append(saved)
                return result
            last_result = result
            failed_path = Path(str(result.get("path") or target))
            if failed_path.exists() and failed_path.is_file():
                try:
                    failed_path.unlink()
                except Exception:
                    pass
            if attempt < retry_attempts and retry_delay_ms > 0:
                await asyncio.sleep(retry_delay_ms / 1000.0)
        final = dict(last_result or {"success": False, "label": label or target.name, "filename": target.name, "url": url, "error": "download failed"})
        final["attempts"] = max(retry_attempts, 1)
        return final

    async def download_urls(
        self,
        items: list[dict[str, Any]],
        *,
        strict: bool = False,
        concurrency: int = 1,
        retry_attempts: int = 1,
        retry_delay_ms: int = 0,
        timeout_seconds: int = 30,
        progress_callback: Callable[[dict[str, Any]], Any] | None = None,
    ) -> dict[str, Any]:
        normalized = list(items or [])
        if not normalized:
            return {"ok": True, "items": []}
        semaphore = asyncio.Semaphore(max(1, int(concurrency or 1)))
        results: list[dict[str, Any] | None] = [None] * len(normalized)
        state = {"completed": 0, "success": 0, "failed": 0, "total": len(normalized)}
        loop = asyncio.get_running_loop()

        async def emit(payload: dict[str, Any]) -> None:
            if progress_callback is None:
                return
            value = progress_callback(payload)
            if hasattr(value, "__await__"):
                await value

        async def worker(index: int, item: dict[str, Any]) -> None:
            async with semaphore:
                await emit({"download_active": True, "download_current_label": item.get("label") or item.get("filename") or item.get("url"), **state})

                def stream(progress: dict[str, Any]) -> None:
                    snapshot = {"download_active": True, "download_current_label": item.get("label") or item.get("filename") or item.get("url"), **progress, **state}
                    loop.call_soon_threadsafe(lambda: asyncio.create_task(emit(snapshot)))

                result = await self._download_one(
                    item,
                    retry_attempts=max(1, int(retry_attempts or 1)),
                    retry_delay_ms=max(0, int(retry_delay_ms or 0)),
                    timeout_seconds=max(1, int(timeout_seconds or 30)),
                    progress_callback=stream if progress_callback else None,
                )
            results[index] = result
            state["completed"] += 1
            if result.get("success"):
                state["success"] += 1
            else:
                state["failed"] += 1
            await emit({"download_active": state["completed"] < state["total"], "download_last_label": result.get("label"), "download_last_success": bool(result.get("success")), **state})

        await asyncio.gather(*(worker(index, item) for index, item in enumerate(normalized)))
        finalized = [dict(item or {}) for item in results]
        if strict:
            failed = next((item for item in finalized if not item.get("success")), None)
            if failed:
                raise RuntimeError(str(failed.get("error") or failed.get("label") or "download failed"))
        return {"ok": all(bool(item.get("success")) for item in finalized), "items": finalized}

    @staticmethod
    def snapshot_download_dir(download_dir: Path | str, pattern: re.Pattern[str] | None = None) -> dict[str, tuple[int, int]]:
        directory = Path(download_dir).expanduser()
        snapshot: dict[str, tuple[int, int]] = {}
        if not directory.exists() or not directory.is_dir():
            return snapshot
        for path in directory.iterdir():
            if not path.is_file() or path.name.endswith(".crdownload"):
                continue
            if pattern and not pattern.match(path.name):
                continue
            stat = path.stat()
            snapshot[str(path)] = (stat.st_mtime_ns, stat.st_size)
        return snapshot

    @staticmethod
    def find_new_downloaded_file(
        download_dir: Path | str,
        baseline: dict[str, tuple[int, int]],
        *,
        pattern: re.Pattern[str] | None = None,
        started_at_ns: int = 0,
    ) -> Path | None:
        directory = Path(download_dir).expanduser()
        newest: tuple[int, Path] | None = None
        threshold_ns = max(int(started_at_ns or 0) - 2_000_000_000, 0)
        if not directory.exists() or not directory.is_dir():
            return None
        for path in directory.iterdir():
            if not path.is_file() or path.name.endswith(".crdownload"):
                continue
            if pattern and not pattern.match(path.name):
                continue
            stat = path.stat()
            previous = baseline.get(str(path))
            if previous and stat.st_mtime_ns <= previous[0] and stat.st_size == previous[1]:
                continue
            if stat.st_mtime_ns < threshold_ns:
                continue
            if newest is None or stat.st_mtime_ns > newest[0]:
                newest = (stat.st_mtime_ns, path)
        return newest[1] if newest else None

    def move_download_artifact(self, source: Path | str, filename: str = "") -> dict[str, Any]:
        source_path = Path(source).expanduser()
        target = self.target_path(filename or source_path.name)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source_path), str(target))
        saved = str(target)
        if saved not in self.runtime_output_files:
            self.runtime_output_files.append(saved)
        return {"success": True, "path": saved, "filename": target.name, "bytes": target.stat().st_size}

    async def _maybe_call_backend_hook(self, backend: Any, name: str, *args: Any) -> Any:
        async_hook = getattr(backend, f"{name}_async", None)
        if callable(async_hook):
            result = async_hook(*args)
            if hasattr(result, "__await__"):
                return await result
            return result
        hook = getattr(backend, name, None)
        if not callable(hook):
            return None
        result = hook(*args)
        if hasattr(result, "__await__"):
            return await result
        return result

    async def _execute_backend(self, backend: Any, action: Any) -> Any:
        execute_async = getattr(backend, "execute_async", None)
        if callable(execute_async):
            result = execute_async(action)
        else:
            result = backend.execute(action)
        if hasattr(result, "__await__"):
            return await result
        return result

    async def download_clicks(
        self,
        items: list[dict[str, Any]],
        *,
        backend: Any,
        download_dir: Path | str | None = None,
        timeout_ms: int = 30000,
        strict: bool = False,
    ) -> dict[str, Any]:
        try:
            from scripts.browser_executor import BrowserAction
        except ModuleNotFoundError:
            from browser_executor import BrowserAction

        directory = Path(download_dir).expanduser() if download_dir else Path.home() / "Downloads"
        results: list[dict[str, Any]] = []
        fallback_pattern = re.compile(r".+\.(xlsx|xls|csv|zip|pdf|json|txt)$", re.IGNORECASE)
        for item in items or []:
            clicks = item.get("clicks") or []
            filename = str(item.get("filename") or "").strip()
            label = str(item.get("label") or filename or "download").strip()
            regex_text = str(item.get("expected_name_regex") or "").strip()
            expected_url = str(item.get("expected_url") or item.get("url") or "").strip()
            item_timeout_ms = int(item.get("timeout_ms") or timeout_ms or 30000)
            min_bytes = int(item.get("min_bytes") or item.get("minBytes") or 0)
            expected_size_raw = item.get("expected_size", item.get("expectedSize"))
            expected_size = int(expected_size_raw) if expected_size_raw not in (None, "") else 0
            try:
                pattern = re.compile(regex_text, re.IGNORECASE) if regex_text else None
            except re.error:
                pattern = None
            if pattern is None and expected_url:
                derived = derive_url_filename(expected_url, "")
                pattern = re.compile(rf"^{re.escape(Path(derived).stem)}.*{re.escape(Path(derived).suffix)}$", re.IGNORECASE) if derived else None
            pattern = pattern or fallback_pattern
            if not clicks:
                failure = {"success": False, "label": label, "filename": filename, "error": "download_clicks requires clicks", "transientActions": []}
                results.append(failure)
                if strict:
                    raise RuntimeError(failure["error"])
                continue
            if not directory.exists() or not directory.is_dir():
                failure = {"success": False, "label": label, "filename": filename, "error": f"download directory does not exist: {directory}", "transientActions": []}
                results.append(failure)
                if strict:
                    raise RuntimeError(failure["error"])
                continue
            baseline = self.snapshot_download_dir(directory, pattern)
            fallback_baseline = self.snapshot_download_dir(directory, fallback_pattern)
            baseline_tabs = await self._maybe_call_backend_hook(backend, "list_page_tab_ids")
            if baseline_tabs is None:
                baseline_tabs = set()
            started_at_ns = time.time_ns()
            transient_actions: list[dict[str, Any]] = []
            seen_transient: set[str] = set()

            for click in clicks:
                result = await self._execute_backend(backend, BrowserAction(kind="click", x=float(click["x"]), y=float(click["y"])))
                if not getattr(result, "ok", False):
                    failure = {
                        "success": False,
                        "label": label,
                        "filename": filename,
                        "url": expected_url,
                        "error": getattr(result, "error", "") or "click failed before download",
                        "transientActions": transient_actions,
                    }
                    results.append(failure)
                    if strict:
                        raise RuntimeError(failure["error"])
                    break
            if results and results[-1].get("success") is False and results[-1].get("label") == label:
                continue

            deadline = time.monotonic() + max(item_timeout_ms, 1000) / 1000.0
            downloaded: Path | None = None
            matched_by = "expected_name"
            try:
                while time.monotonic() < deadline:
                    hook_actions = await self._maybe_call_backend_hook(backend, "handle_transient_download_tabs")
                    for action in hook_actions or []:
                        key = json.dumps(action, ensure_ascii=False, sort_keys=True)
                        if key in seen_transient:
                            continue
                        seen_transient.add(key)
                        transient_actions.append(dict(action))
                    downloaded = self.find_new_downloaded_file(directory, baseline, pattern=pattern, started_at_ns=started_at_ns)
                    if not downloaded:
                        downloaded = self.find_new_downloaded_file(directory, fallback_baseline, pattern=fallback_pattern, started_at_ns=started_at_ns)
                        if downloaded:
                            matched_by = "fallback_any_artifact"
                    if downloaded:
                        break
                    await asyncio.sleep(0.1)
            finally:
                await self._maybe_call_backend_hook(backend, "close_new_tabs", baseline_tabs)

            if downloaded:
                size = downloaded.stat().st_size if downloaded.exists() else 0
                if min_bytes and size < min_bytes:
                    try:
                        downloaded.unlink()
                    except Exception:
                        pass
                    failure = {
                        "success": False,
                        "label": label,
                        "filename": filename,
                        "url": expected_url,
                        "error": f"downloaded file is smaller than min_bytes: {size} < {min_bytes}",
                        "transientActions": transient_actions,
                        "bytes": size,
                    }
                    results.append(failure)
                    if strict:
                        raise RuntimeError(failure["error"])
                    continue
                if expected_size and size != expected_size:
                    try:
                        downloaded.unlink()
                    except Exception:
                        pass
                    failure = {
                        "success": False,
                        "label": label,
                        "filename": filename,
                        "url": expected_url,
                        "error": f"downloaded file size does not match expected_size: {size} != {expected_size}",
                        "transientActions": transient_actions,
                        "bytes": size,
                    }
                    results.append(failure)
                    if strict:
                        raise RuntimeError(failure["error"])
                    continue
                artifact = self.move_download_artifact(downloaded, filename or downloaded.name)
                results.append(
                    {
                        **artifact,
                        "success": True,
                        "label": label,
                        "url": expected_url,
                        "sourcePath": str(downloaded),
                        "matchedBy": matched_by,
                        "transientActions": transient_actions,
                    }
                )
                continue

            failure = {
                "success": False,
                "label": label,
                "filename": filename,
                "url": expected_url,
                "error": "no downloaded file detected after click",
                "transientActions": transient_actions,
            }
            results.append(failure)
            if strict:
                raise RuntimeError(failure["error"])
        return {"ok": all(bool(item.get("success")) for item in results) if results else True, "items": results}
