import asyncio
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from core.js_runner import JSRunner
from core.models import JSResult


class SharedCarryRunner(JSRunner):
    def __init__(self):
        super().__init__("ws://example.invalid")
        self.calls = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        page = None
        phase = None
        shared = None
        for line in expression.splitlines():
            if line.startswith("window.__CRAWSHRIMP_PAGE__ = "):
                page = int(line.split("=", 1)[1].strip().rstrip(";"))
            elif line.startswith("window.__CRAWSHRIMP_PHASE__ = "):
                phase = json.loads(line.split("=", 1)[1].strip().rstrip(";"))
            elif line.startswith("window.__CRAWSHRIMP_SHARED__ = "):
                shared = json.loads(line.split("=", 1)[1].strip().rstrip(";"))

        self.calls.append({
            "page": page,
            "phase": phase,
            "shared": shared,
        })

        if len(self.calls) == 1:
            return JSResult(
                success=True,
                data=[{"page": 1}],
                meta={
                    "action": "complete",
                    "has_more": True,
                    "shared": {
                        "requestedOuterSites": ["全球", "美国", "欧区"],
                        "requestedStatDateRange": {
                            "start": "2026-04-01",
                            "end": "2026-04-07",
                        },
                    },
                },
            )

        return JSResult(
            success=True,
            data=[{"page": 2}],
            meta={
                "action": "complete",
                "has_more": False,
                "shared": shared or {},
            },
        )


class RuntimeActionRunner(JSRunner):
    def __init__(self, artifact_dir: str):
        super().__init__("ws://example.invalid", artifact_dir=artifact_dir)
        self.calls = []
        self.capture_click_payloads = []
        self.download_payloads = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        page = None
        phase = None
        shared = None
        for line in expression.splitlines():
            if line.startswith("window.__CRAWSHRIMP_PAGE__ = "):
                page = int(line.split("=", 1)[1].strip().rstrip(";"))
            elif line.startswith("window.__CRAWSHRIMP_PHASE__ = "):
                phase = json.loads(line.split("=", 1)[1].strip().rstrip(";"))
            elif line.startswith("window.__CRAWSHRIMP_SHARED__ = "):
                shared = json.loads(line.split("=", 1)[1].strip().rstrip(";"))

        self.calls.append({
            "page": page,
            "phase": phase,
            "shared": shared,
        })

        if phase == "main":
            return JSResult(
                success=True,
                data=[],
                meta={
                    "action": "capture_click_requests",
                    "clicks": [{"x": 1, "y": 2}],
                    "matches": [{"url_contains": "/download"}],
                    "shared_key": "captured",
                    "next_phase": "after_capture",
                    "shared": shared or {},
                },
            )

        if phase == "after_capture":
            return JSResult(
                success=True,
                data=[],
                meta={
                    "action": "download_urls",
                    "items": [{
                        "url": "https://example.com/demo.xlsx",
                        "filename": "demo.xlsx",
                        "label": "Demo",
                    }],
                    "shared_key": "downloads",
                    "next_phase": "after_download",
                    "shared": shared or {},
                },
            )

        return JSResult(
            success=True,
            data=[{"phase": phase}],
            meta={
                "action": "complete",
                "has_more": False,
                "shared": shared or {},
            },
        )

    async def capture_click_requests(self, clicks, **kwargs):
        self.capture_click_payloads.append({
            "clicks": clicks,
            "kwargs": kwargs,
        })
        return {
            "ok": True,
            "matches": [{
                "url": "https://example.com/api/download",
                "body": '{"result":{"fileUrl":"https://example.com/demo.xlsx"}}',
            }],
        }

    async def download_urls(self, items, strict: bool = False):
        self.download_payloads.append({
            "items": items,
            "strict": strict,
        })
        path = self.artifact_dir / "demo.xlsx"
        path.write_text("ok", encoding="utf-8")
        saved_path = str(path)
        if saved_path not in self.runtime_output_files:
            self.runtime_output_files.append(saved_path)
        return {
            "ok": True,
            "items": [{
                "success": True,
                "label": "Demo",
                "filename": path.name,
                "path": saved_path,
                "url": "https://example.com/demo.xlsx",
            }],
        }


class RuntimeUrlCaptureRunner(JSRunner):
    def __init__(self):
        super().__init__("ws://example.invalid")
        self.calls = []
        self.capture_url_payloads = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        phase = None
        shared = None
        for line in expression.splitlines():
            if line.startswith("window.__CRAWSHRIMP_PHASE__ = "):
                phase = json.loads(line.split("=", 1)[1].strip().rstrip(";"))
            elif line.startswith("window.__CRAWSHRIMP_SHARED__ = "):
                shared = json.loads(line.split("=", 1)[1].strip().rstrip(";"))

        self.calls.append({
            "phase": phase,
            "shared": shared,
        })

        if phase == "main":
            return JSResult(
                success=True,
                data=[],
                meta={
                    "action": "capture_url_requests",
                    "url": "https://example.com/landing",
                    "matches": [{"url_contains": "/api/merchant/file/export/download"}],
                    "shared_key": "captured_url",
                    "next_phase": "after_capture_url",
                    "shared": shared or {},
                },
            )

        return JSResult(
            success=True,
            data=[shared or {}],
            meta={
                "action": "complete",
                "has_more": False,
                "shared": shared or {},
            },
        )

    async def capture_url_requests(self, url, **kwargs):
        self.capture_url_payloads.append({
            "url": url,
            "kwargs": kwargs,
        })
        return {
            "ok": True,
            "requestedUrl": url,
            "matches": [{
                "url": "https://example.com/api/merchant/file/export/download",
                "body": '{"result":{"fileUrl":"https://example.com/generated.xlsx"}}',
            }],
        }


class RuntimeClickDownloadRunner(JSRunner):
    def __init__(self, artifact_dir: str):
        super().__init__("ws://example.invalid", artifact_dir=artifact_dir)
        self.calls = []
        self.download_click_payloads = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        phase = None
        shared = None
        for line in expression.splitlines():
            if line.startswith("window.__CRAWSHRIMP_PHASE__ = "):
                phase = json.loads(line.split("=", 1)[1].strip().rstrip(";"))
            elif line.startswith("window.__CRAWSHRIMP_SHARED__ = "):
                shared = json.loads(line.split("=", 1)[1].strip().rstrip(";"))

        self.calls.append({
            "phase": phase,
            "shared": shared,
        })

        if phase == "main":
            return JSResult(
                success=True,
                data=[],
                meta={
                    "action": "download_clicks",
                    "items": [{
                        "clicks": [{"x": 12, "y": 34}],
                        "filename": "clicked.xlsx",
                        "label": "Clicked",
                        "expected_url": "https://example.com/FundDetail-demo.xlsx",
                    }],
                    "shared_key": "click_downloads",
                    "next_phase": "after_click_download",
                    "shared": shared or {},
                },
            )

        return JSResult(
            success=True,
            data=[shared or {}],
            meta={
                "action": "complete",
                "has_more": False,
                "shared": shared or {},
            },
        )

    async def download_clicks(self, items, strict: bool = False):
        self.download_click_payloads.append({
            "items": items,
            "strict": strict,
        })
        path = self.artifact_dir / "clicked.xlsx"
        path.write_text("ok", encoding="utf-8")
        saved_path = str(path)
        if saved_path not in self.runtime_output_files:
            self.runtime_output_files.append(saved_path)
        return {
            "ok": True,
            "items": [{
                "success": True,
                "label": "Clicked",
                "filename": path.name,
                "path": saved_path,
                "url": "https://example.com/FundDetail-demo.xlsx",
            }],
        }


class FallbackFilenameDownloadRunner(JSRunner):
    def __init__(self, artifact_dir: str, downloads_dir: Path):
        super().__init__("ws://example.invalid", artifact_dir=artifact_dir)
        self.downloads_dir = downloads_dir

    async def _refresh_ws_url(self) -> None:
        return None

    def _close_transient_download_tabs(self) -> None:
        return None

    def _list_page_tab_ids(self) -> set[str]:
        return set()

    async def _handle_transient_download_tabs(self) -> list[dict]:
        return []

    def _close_new_page_tabs(self, baseline_tab_ids: set[str]) -> None:
        return None

    async def cdp_mouse_click(self, x: float, y: float, delay_ms: int = 50) -> None:
        target = self.downloads_dir / "FundDetail-actual-name.xlsx"
        target.write_text("eu", encoding="utf-8")
        await asyncio.sleep(0)


class FakeCDPWebSocket:
    def __init__(self, messages):
        self.messages = [json.dumps(item) for item in messages]
        self.sent = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def send(self, payload):
        self.sent.append(json.loads(payload))

    async def recv(self):
        if self.messages:
            return self.messages.pop(0)
        await asyncio.sleep(3600)


class JSRunnerTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_script_file_carries_shared_across_pages(self):
        runner = SharedCarryRunner()

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            data = await runner.run_script_file(script_path, params={"outer_sites": ["全球", "美国"]})

        self.assertEqual(data, [{"page": 1}, {"page": 2}])
        self.assertEqual(len(runner.calls), 2)
        self.assertEqual(runner.calls[0]["page"], 1)
        self.assertEqual(runner.calls[0]["shared"], {})
        self.assertEqual(runner.calls[1]["page"], 2)
        self.assertEqual(
            runner.calls[1]["shared"],
            {
                "requestedOuterSites": ["全球", "美国", "欧区"],
                "requestedStatDateRange": {
                    "start": "2026-04-01",
                    "end": "2026-04-07",
                },
            },
        )

    async def test_run_script_file_handles_runtime_capture_and_download_actions(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = RuntimeActionRunner(tmpdir)
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            data = await runner.run_script_file(script_path, params={})

        self.assertEqual(data, [{"phase": "after_download"}])
        self.assertEqual([call["phase"] for call in runner.calls], ["main", "after_capture", "after_download"])
        self.assertEqual(len(runner.capture_click_payloads), 1)
        self.assertEqual(runner.capture_click_payloads[0]["clicks"], [{"x": 1, "y": 2}])
        self.assertIn("captured", runner.calls[1]["shared"])
        self.assertTrue(runner.calls[1]["shared"]["captured"]["ok"])
        self.assertEqual(len(runner.download_payloads), 1)
        self.assertIn("downloads", runner.calls[2]["shared"])
        self.assertEqual(len(runner.runtime_output_files), 1)
        self.assertEqual(Path(runner.runtime_output_files[0]).name, "demo.xlsx")

    async def test_run_script_file_handles_runtime_url_capture_action(self):
        runner = RuntimeUrlCaptureRunner()

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            data = await runner.run_script_file(script_path, params={})

        self.assertEqual(len(data), 1)
        self.assertEqual(len(runner.capture_url_payloads), 1)
        self.assertEqual(runner.capture_url_payloads[0]["url"], "https://example.com/landing")
        self.assertEqual(runner.calls[1]["phase"], "after_capture_url")
        self.assertIn("captured_url", runner.calls[1]["shared"])
        self.assertEqual(
            runner.calls[1]["shared"]["captured_url"]["requestedUrl"],
            "https://example.com/landing",
        )

    async def test_capture_requests_on_ws_buffers_out_of_order_command_responses(self):
        runner = JSRunner("ws://example.invalid")
        fake_ws = FakeCDPWebSocket([
            {"id": 1, "result": {}},
            {"id": 2, "result": {}},
            {"id": 3, "result": {}},
            {
                "method": "Network.requestWillBeSent",
                "params": {
                    "requestId": "req-1",
                    "request": {
                        "url": "https://example.com/api/merchant/file/export/download",
                        "method": "POST",
                        "headers": {"content-type": "application/json"},
                    },
                },
            },
            {
                "method": "Network.responseReceived",
                "params": {
                    "requestId": "req-1",
                    "response": {
                        "status": 200,
                        "mimeType": "application/json",
                        "headers": {"content-type": "application/json"},
                        "url": "https://example.com/api/merchant/file/export/download",
                    },
                },
            },
            {
                "method": "Network.loadingFinished",
                "params": {"requestId": "req-1"},
            },
            {"id": 4, "result": {"frameId": "frame-1"}},
            {
                "id": 5,
                "result": {
                    "body": '{"result":{"fileUrl":"https://example.com/generated.xlsx"}}',
                    "base64Encoded": False,
                },
            },
        ])

        with patch("core.js_runner.websockets.connect", return_value=fake_ws):
            result = await runner._capture_requests_on_ws(
                "ws://example.invalid/capture",
                url="https://example.com/landing",
                matches=[{"url_contains": "/api/merchant/file/export/download", "method": "POST"}],
                timeout_ms=1000,
                settle_ms=0,
                min_matches=1,
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["requestedUrl"], "https://example.com/landing")
        self.assertEqual(len(result["matches"]), 1)
        self.assertIn("generated.xlsx", result["matches"][0]["body"])
        self.assertEqual(
            [item["method"] for item in fake_ws.sent],
            [
                "Page.enable",
                "Network.enable",
                "Page.bringToFront",
                "Page.navigate",
                "Network.getResponseBody",
            ],
        )

    async def test_run_script_file_handles_runtime_click_download_action(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = RuntimeClickDownloadRunner(tmpdir)
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            data = await runner.run_script_file(script_path, params={})

        self.assertEqual(len(data), 1)
        self.assertEqual(len(runner.download_click_payloads), 1)
        self.assertEqual(runner.download_click_payloads[0]["items"][0]["filename"], "clicked.xlsx")
        self.assertIn("click_downloads", runner.calls[1]["shared"])
        self.assertEqual(len(runner.runtime_output_files), 1)
        self.assertEqual(Path(runner.runtime_output_files[0]).name, "clicked.xlsx")

    def test_find_new_downloaded_file_detects_default_downloads_fallback(self):
        runner = JSRunner("ws://example.invalid")

        with tempfile.TemporaryDirectory() as tmpdir:
            runtime_dir = Path(tmpdir) / "runtime"
            downloads_dir = Path(tmpdir) / "Downloads"
            runtime_dir.mkdir()
            downloads_dir.mkdir()

            old_file = downloads_dir / "FundDetail-1776051005012-bc5d.xlsx"
            old_file.write_text("old", encoding="utf-8")

            pattern = runner._build_download_candidate_regex(
                "https://agentseller.temu.com/labor-tag-u/FundDetail-1776051005012-bc5d.xlsx?sign=demo"
            )
            baseline = runner._snapshot_download_state([runtime_dir, downloads_dir], pattern)
            started_at_ns = time.time_ns()

            fresh_file = downloads_dir / "FundDetail-1776051005012-bc5d (1).xlsx"
            fresh_file.write_text("new", encoding="utf-8")

            detected = runner._find_new_downloaded_file(
                [runtime_dir, downloads_dir],
                baseline,
                pattern,
                started_at_ns,
            )

            self.assertEqual(detected, fresh_file)

    async def test_download_clicks_falls_back_to_any_new_xlsx_when_filename_drifts(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            home_dir = Path(tmpdir)
            downloads_dir = home_dir / "Downloads"
            downloads_dir.mkdir()
            runner = FallbackFilenameDownloadRunner(tmpdir, downloads_dir)

            with patch("pathlib.Path.home", return_value=home_dir):
                result = await runner.download_clicks([{
                    "clicks": [{"x": 12, "y": 34}],
                    "filename": "eu.xlsx",
                    "label": "欧区",
                    "expected_url": "https://example.com/FundDetail-expected-name.xlsx",
                    "timeout_ms": 1500,
                }])

            self.assertTrue(result["ok"])
            self.assertEqual(len(result["items"]), 1)
            self.assertTrue(result["items"][0]["success"])
            self.assertEqual(result["items"][0]["matchedBy"], "fallback_any_xlsx")
            self.assertTrue(Path(result["items"][0]["path"]).exists())
            self.assertEqual(Path(result["items"][0]["path"]).name, "eu.xlsx")


if __name__ == "__main__":
    unittest.main()
