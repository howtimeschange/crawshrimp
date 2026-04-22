import tempfile
import threading
import time
import unittest
from pathlib import Path

from core.js_runner import JSRunner


class JSRunnerDownloadUrlsTests(unittest.IsolatedAsyncioTestCase):
    async def test_download_urls_retries_until_success(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = JSRunner("ws://unused", artifact_dir=tmpdir)
            attempts = {"https://example.com/a.jpg": 0}

            def fake_download(url, target_path, headers=None, timeout=60):
                attempts[url] += 1
                if attempts[url] < 3:
                    return {"success": False, "error": "temporary failure", "path": str(target_path)}
                Path(target_path).parent.mkdir(parents=True, exist_ok=True)
                Path(target_path).write_bytes(b"ok")
                return {"success": True, "path": str(target_path)}

            runner._download_url_sync = fake_download  # type: ignore[method-assign]

            result = await runner.download_urls(
                [{"url": "https://example.com/a.jpg", "filename": "a.jpg"}],
                concurrency=1,
                retry_attempts=3,
                retry_delay_ms=1,
            )

            self.assertTrue(result["ok"])
            self.assertEqual(result["items"][0]["attempts"], 3)
            self.assertTrue(result["items"][0]["success"])
            self.assertEqual(attempts["https://example.com/a.jpg"], 3)

    async def test_download_urls_honors_concurrency_limit(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = JSRunner("ws://unused", artifact_dir=tmpdir)
            state = {
                "active": 0,
                "max_active": 0,
            }
            lock = threading.Lock()

            def fake_download(url, target_path, headers=None, timeout=60):
                with lock:
                    state["active"] += 1
                    state["max_active"] = max(state["max_active"], state["active"])
                time.sleep(0.08)
                Path(target_path).parent.mkdir(parents=True, exist_ok=True)
                Path(target_path).write_bytes(url.encode("utf-8"))
                with lock:
                    state["active"] -= 1
                return {"success": True, "path": str(target_path)}

            runner._download_url_sync = fake_download  # type: ignore[method-assign]

            items = [
                {"url": f"https://example.com/{index}.jpg", "filename": f"{index}.jpg"}
                for index in range(4)
            ]
            result = await runner.download_urls(items, concurrency=2, retry_attempts=1)

            self.assertTrue(result["ok"])
            self.assertEqual(len(result["items"]), 4)
            self.assertGreaterEqual(state["max_active"], 2)
            self.assertLessEqual(state["max_active"], 2)

    async def test_download_urls_reports_progress_callback_snapshots(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = JSRunner("ws://unused", artifact_dir=tmpdir)
            snapshots = []

            def fake_download(url, target_path, headers=None, timeout=60):
                Path(target_path).parent.mkdir(parents=True, exist_ok=True)
                Path(target_path).write_bytes(url.encode("utf-8"))
                return {"success": True, "path": str(target_path)}

            runner._download_url_sync = fake_download  # type: ignore[method-assign]

            async def on_progress(payload):
                snapshots.append(dict(payload))

            items = [
                {"url": f"https://example.com/{index}.jpg", "filename": f"{index}.jpg"}
                for index in range(3)
            ]
            result = await runner.download_urls(items, concurrency=2, progress_callback=on_progress)

            self.assertTrue(result["ok"])
            self.assertEqual(len(snapshots), 3)
            self.assertEqual([snap["download_completed"] for snap in snapshots], [1, 2, 3])
            self.assertEqual(snapshots[-1]["download_total"], 3)
            self.assertEqual(snapshots[-1]["download_success"], 3)
            self.assertEqual(snapshots[-1]["download_failed"], 0)
            self.assertFalse(snapshots[-1]["download_active"])


if __name__ == "__main__":
    unittest.main()
