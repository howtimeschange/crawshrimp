import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from core.js_runner import JSRunner


class _ChunkedResponse:
    def __init__(self, chunks):
        self._chunks = list(chunks)
        self.headers = {"Content-Type": "image/jpeg"}

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self, size=-1):
        if not self._chunks:
            return b""
        return self._chunks.pop(0)

    def geturl(self):
        return "https://example.com/final.jpg"


class JSRunnerDownloadUrlsTests(unittest.IsolatedAsyncioTestCase):
    async def test_download_url_sync_streams_to_target_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = JSRunner("ws://unused", artifact_dir=tmpdir)
            target = Path(tmpdir) / "large.jpg"

            with patch("core.js_runner.urlopen", return_value=_ChunkedResponse([b"large-", b"image"])):
                result = runner._download_url_sync("https://example.com/large.jpg", target, timeout=5)

            self.assertTrue(result["success"])
            self.assertEqual(target.read_bytes(), b"large-image")
            self.assertFalse(target.with_name("large.jpg.part").exists())

    async def test_download_urls_retries_until_success(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = JSRunner("ws://unused", artifact_dir=tmpdir)
            attempts = {"https://example.com/a.jpg": 0}

            def fake_download(url, target_path, headers=None, timeout=60, no_proxy=False, progress_callback=None):
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

            def fake_download(url, target_path, headers=None, timeout=60, no_proxy=False, progress_callback=None):
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

    async def test_download_urls_passes_configured_timeout_to_url_download(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = JSRunner("ws://unused", artifact_dir=tmpdir)
            seen_timeouts = []

            def fake_download(url, target_path, headers=None, timeout=60, no_proxy=False, progress_callback=None):
                seen_timeouts.append(timeout)
                Path(target_path).parent.mkdir(parents=True, exist_ok=True)
                Path(target_path).write_bytes(b"ok")
                return {"success": True, "path": str(target_path)}

            runner._download_url_sync = fake_download  # type: ignore[method-assign]

            result = await runner.download_urls(
                [{"url": "https://example.com/a.jpg", "filename": "a.jpg"}],
                concurrency=1,
                retry_attempts=1,
                timeout_seconds=120,
            )

            self.assertTrue(result["ok"])
            self.assertEqual(seen_timeouts, [120])

    async def test_download_urls_skips_existing_target_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = JSRunner("ws://unused", artifact_dir=tmpdir)
            target = Path(tmpdir) / "a.jpg"
            target.write_bytes(b"already")
            calls = 0

            def fake_download(url, target_path, headers=None, timeout=60, no_proxy=False, progress_callback=None):
                nonlocal calls
                calls += 1
                return {"success": False, "path": str(target_path), "error": "should not download"}

            runner._download_url_sync = fake_download  # type: ignore[method-assign]

            result = await runner.download_urls(
                [{"url": "https://example.com/a.jpg", "filename": "a.jpg"}],
                concurrency=1,
            )

            self.assertTrue(result["ok"])
            self.assertEqual(calls, 0)
            self.assertTrue(result["items"][0]["skipped_existing"])

    async def test_download_urls_reports_progress_callback_snapshots(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = JSRunner("ws://unused", artifact_dir=tmpdir)
            snapshots = []

            def fake_download(url, target_path, headers=None, timeout=60, no_proxy=False, progress_callback=None):
                Path(target_path).parent.mkdir(parents=True, exist_ok=True)
                Path(target_path).write_bytes(url.encode("utf-8"))
                return {"success": True, "path": str(target_path), "bytes": target_path.stat().st_size}

            runner._download_url_sync = fake_download  # type: ignore[method-assign]

            async def on_progress(payload):
                snapshots.append(dict(payload))

            items = [
                {"url": f"https://example.com/{index}.jpg", "filename": f"{index}.jpg"}
                for index in range(3)
            ]
            result = await runner.download_urls(items, concurrency=2, progress_callback=on_progress)

            self.assertTrue(result["ok"])
            self.assertGreaterEqual(len(snapshots), 3)
            self.assertEqual([snap["download_completed"] for snap in snapshots if snap.get("download_last_label")], [1, 2, 3])
            self.assertEqual(snapshots[-1]["download_total"], 3)
            self.assertEqual(snapshots[-1]["download_success"], 3)
            self.assertEqual(snapshots[-1]["download_failed"], 0)
            self.assertFalse(snapshots[-1]["download_active"])
            self.assertIn("download_current_label", snapshots[0])
            self.assertGreater(snapshots[-1]["download_bytes_completed"], 0)

    async def test_download_urls_reports_cumulative_progress_offsets(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = JSRunner("ws://unused", artifact_dir=tmpdir)
            snapshots = []

            def fake_download(url, target_path, headers=None, timeout=60, no_proxy=False, progress_callback=None):
                Path(target_path).parent.mkdir(parents=True, exist_ok=True)
                Path(target_path).write_bytes(b"ok")
                return {"success": True, "path": str(target_path), "bytes": 2}

            runner._download_url_sync = fake_download  # type: ignore[method-assign]

            async def on_progress(payload):
                snapshots.append(dict(payload))

            result = await runner.download_urls(
                [
                    {"url": "https://example.com/a.jpg", "filename": "a.jpg"},
                    {"url": "https://example.com/b.jpg", "filename": "b.jpg"},
                ],
                concurrency=1,
                progress_total=5,
                progress_completed_offset=3,
                progress_success_offset=2,
                progress_failed_offset=1,
                progress_callback=on_progress,
            )

            self.assertTrue(result["ok"])
            completion = [snap for snap in snapshots if snap.get("download_last_label")]
            self.assertEqual([snap["download_completed"] for snap in completion], [4, 5])
            self.assertEqual(snapshots[-1]["download_total"], 5)
            self.assertEqual(snapshots[-1]["download_success"], 4)
            self.assertEqual(snapshots[-1]["download_failed"], 1)


if __name__ == "__main__":
    unittest.main()
