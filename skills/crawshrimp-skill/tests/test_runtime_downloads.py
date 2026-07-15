import asyncio
import tempfile
import time
import unittest
from pathlib import Path

from scripts.browser_executor import BrowserResult
from scripts.runtime_downloads import DownloadManager


class RuntimeDownloadsTest(unittest.IsolatedAsyncioTestCase):
    async def test_download_urls_supports_data_urls_and_concurrency(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager = DownloadManager(Path(tmp))
            result = await manager.download_urls(
                [
                    {"url": "data:text/plain;base64,Zmlyc3Q=", "filename": "first.txt"},
                    {"url": "data:text/plain;base64,c2Vjb25k", "filename": "second.txt"},
                ],
                concurrency=2,
            )

            self.assertTrue(result["ok"])
            self.assertEqual((Path(tmp) / "first.txt").read_text(encoding="utf-8"), "first")
            self.assertEqual((Path(tmp) / "second.txt").read_text(encoding="utf-8"), "second")

    async def test_download_urls_retries_and_reports_progress(self):
        calls = {"count": 0}
        progress = []

        async def fake_fetch(url, target_path, headers, timeout_seconds, no_proxy, progress_callback):
            calls["count"] += 1
            if calls["count"] < 2:
                return {"success": False, "path": str(target_path), "error": "temporary"}
            Path(target_path).write_bytes(b"ok")
            if progress_callback:
                progress_callback({"bytes_downloaded": 2, "bytes_total": 2})
            return {"success": True, "path": str(target_path), "bytes": 2}

        with tempfile.TemporaryDirectory() as tmp:
            manager = DownloadManager(Path(tmp), fetcher=fake_fetch)
            result = await manager.download_urls(
                [{"url": "https://example.test/a.txt", "filename": "a.txt"}],
                retry_attempts=2,
                progress_callback=lambda payload: progress.append(payload),
            )

            self.assertTrue(result["ok"])
            self.assertEqual(result["items"][0]["attempts"], 2)
            self.assertTrue(progress)

    async def test_download_urls_can_delegate_browser_session_items_to_hook(self):
        browser_calls = []

        async def fake_browser_session_download(item, target_path, timeout_seconds):
            browser_calls.append((dict(item), Path(target_path), timeout_seconds))
            Path(target_path).write_bytes(b"browser")
            return {"success": True, "path": str(target_path), "browserSession": True, "bytes": 7}

        with tempfile.TemporaryDirectory() as tmp:
            manager = DownloadManager(Path(tmp), browser_session_downloader=fake_browser_session_download)

            result = await manager.download_urls(
                [
                    {
                        "url": "https://example.test/export",
                        "filename": "export.xlsx",
                        "browser_session": True,
                        "timeout_seconds": 12,
                    }
                ]
            )

            self.assertTrue(result["ok"])
            self.assertTrue(result["items"][0]["browserSession"])
            self.assertEqual(browser_calls[0][0]["url"], "https://example.test/export")
            self.assertEqual(browser_calls[0][1].name, "export.xlsx")
            self.assertEqual(browser_calls[0][2], 12)

    async def test_download_urls_reports_malformed_data_url_as_item_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager = DownloadManager(Path(tmp))

            result = await manager.download_urls(
                [
                    {"url": "data:text/plain;base64,abc", "filename": "bad.txt", "label": "bad data"},
                    {"url": "data:text/plain;base64,b2s=", "filename": "ok.txt", "label": "good data"},
                ],
                concurrency=2,
            )

            self.assertFalse(result["ok"])
            self.assertFalse(result["items"][0]["success"])
            self.assertIn("Incorrect padding", result["items"][0]["error"])
            self.assertTrue(result["items"][1]["success"])
            self.assertEqual((Path(tmp) / "ok.txt").read_text(encoding="utf-8"), "ok")

    async def test_download_urls_reports_throwing_fetcher_as_item_failure(self):
        async def fake_fetch(url, target_path, headers, timeout_seconds, no_proxy, progress_callback):
            if url.endswith("bad.txt"):
                raise RuntimeError("fetch exploded")
            Path(target_path).write_bytes(b"ok")
            return {"success": True, "path": str(target_path), "bytes": 2}

        with tempfile.TemporaryDirectory() as tmp:
            manager = DownloadManager(Path(tmp), fetcher=fake_fetch)

            result = await manager.download_urls(
                [
                    {"url": "https://example.test/bad.txt", "filename": "bad.txt", "label": "bad fetch"},
                    {"url": "https://example.test/ok.txt", "filename": "ok.txt", "label": "good fetch"},
                ],
                concurrency=2,
            )

            self.assertFalse(result["ok"])
            self.assertFalse(result["items"][0]["success"])
            self.assertIn("fetch exploded", result["items"][0]["error"])
            self.assertTrue(result["items"][1]["success"])

    async def test_download_clicks_moves_detected_file_and_records_transient_actions(self):
        class ClickBackend:
            def __init__(self, download_dir):
                self.download_dir = Path(download_dir)
                self.actions = []
                self.transient_actions = [{"handled": True, "tabId": "tmp"}]

            def execute(self, action):
                self.actions.append(action)
                if action.kind == "click":
                    (self.download_dir / "export.xlsx").write_bytes(b"xlsx")
                return BrowserResult(ok=True, action=action.kind, data={})

            def handle_transient_download_tabs(self):
                return self.transient_actions

            def close_new_tabs(self, baseline_tab_ids):
                self.closed_baseline = baseline_tab_ids

        with tempfile.TemporaryDirectory() as downloads, tempfile.TemporaryDirectory() as artifacts:
            backend = ClickBackend(downloads)
            manager = DownloadManager(Path(artifacts))

            result = await manager.download_clicks(
                [{"clicks": [{"x": 10, "y": 20}], "filename": "report.xlsx", "expected_name_regex": r"export\\.xlsx"}],
                backend=backend,
                download_dir=Path(downloads),
                timeout_ms=1000,
            )

            self.assertTrue(result["ok"])
            self.assertEqual(Path(result["items"][0]["path"]).name, "report.xlsx")
            self.assertEqual(Path(result["items"][0]["path"]).read_bytes(), b"xlsx")
            self.assertEqual(result["items"][0]["transientActions"][0]["tabId"], "tmp")
            self.assertIn("click", [action.kind for action in backend.actions])

    async def test_download_clicks_reports_click_failure_before_polling(self):
        class FailingBackend:
            def execute(self, action):
                return BrowserResult(ok=False, action=action.kind, error="click failed")

        with tempfile.TemporaryDirectory() as downloads, tempfile.TemporaryDirectory() as artifacts:
            manager = DownloadManager(Path(artifacts))

            result = await manager.download_clicks(
                [{"clicks": [{"x": 10, "y": 20}], "filename": "report.xlsx"}],
                backend=FailingBackend(),
                download_dir=Path(downloads),
                timeout_ms=1000,
            )

            self.assertFalse(result["ok"])
            self.assertIn("click failed", result["items"][0]["error"])

    async def test_download_clicks_prefers_async_backend_execute(self):
        class AsyncClickBackend:
            def __init__(self, download_dir):
                self.download_dir = Path(download_dir)

            def execute(self, action):
                raise RuntimeError("sync execute should not be used for click downloads")

            async def execute_async(self, action):
                if action.kind == "click":
                    (self.download_dir / "export.xlsx").write_bytes(b"xlsx")
                return BrowserResult(ok=True, action=action.kind, data={})

        with tempfile.TemporaryDirectory() as downloads, tempfile.TemporaryDirectory() as artifacts:
            manager = DownloadManager(Path(artifacts))

            result = await manager.download_clicks(
                [{"clicks": [{"x": 10, "y": 20}], "filename": "report.xlsx", "expected_name_regex": r"export\\.xlsx"}],
                backend=AsyncClickBackend(downloads),
                download_dir=Path(downloads),
                timeout_ms=1000,
            )

            self.assertTrue(result["ok"])
            self.assertEqual(Path(result["items"][0]["path"]).read_bytes(), b"xlsx")

    async def test_download_clicks_enforces_min_bytes_and_expected_size(self):
        class SmallDownloadBackend:
            def __init__(self, download_dir):
                self.download_dir = Path(download_dir)

            def execute(self, action):
                if action.kind == "click":
                    (self.download_dir / "small.csv").write_bytes(b"x")
                return BrowserResult(ok=True, action=action.kind, data={})

        with tempfile.TemporaryDirectory() as downloads, tempfile.TemporaryDirectory() as artifacts:
            manager = DownloadManager(Path(artifacts))

            result = await manager.download_clicks(
                [
                    {
                        "clicks": [{"x": 10, "y": 20}],
                        "filename": "report.csv",
                        "expected_name_regex": r"small\\.csv",
                        "min_bytes": 2,
                    }
                ],
                backend=SmallDownloadBackend(downloads),
                download_dir=Path(downloads),
                timeout_ms=1000,
            )

            self.assertFalse(result["ok"])
            self.assertIn("smaller than min_bytes", result["items"][0]["error"])
            self.assertFalse((Path(artifacts) / "report.csv").exists())

        with tempfile.TemporaryDirectory() as downloads, tempfile.TemporaryDirectory() as artifacts:
            manager = DownloadManager(Path(artifacts))

            result = await manager.download_clicks(
                [
                    {
                        "clicks": [{"x": 10, "y": 20}],
                        "filename": "report.csv",
                        "expected_name_regex": r"small\\.csv",
                        "expected_size": 2,
                    }
                ],
                backend=SmallDownloadBackend(downloads),
                download_dir=Path(downloads),
                timeout_ms=1000,
            )

            self.assertFalse(result["ok"])
            self.assertIn("does not match expected_size", result["items"][0]["error"])


if __name__ == "__main__":
    unittest.main()
