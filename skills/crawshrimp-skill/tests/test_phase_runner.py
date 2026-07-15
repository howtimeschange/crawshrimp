import json
import tempfile
import unittest
from pathlib import Path

from scripts.browser_executor import BrowserResult
from scripts.phase_runner import RunAbortedError, WebPhaseRunner


def _extract_assignment(expression: str, key: str):
    prefix = f"window.{key} = "
    for line in expression.splitlines():
        stripped = line.strip()
        if stripped.startswith(prefix):
            return stripped.split("=", 1)[1].strip().rstrip(";")
    return None


class PhaseBackend:
    def __init__(self):
        self.actions = []
        self.eval_calls = []

    def execute(self, action):
        self.actions.append(action)
        if action.kind == "eval":
            page = int(_extract_assignment(action.script, "__CRAWSHRIMP_PAGE__") or 0)
            phase = json.loads(_extract_assignment(action.script, "__CRAWSHRIMP_PHASE__") or '"main"')
            shared = json.loads(_extract_assignment(action.script, "__CRAWSHRIMP_SHARED__") or "{}")
            self.eval_calls.append({"page": page, "phase": phase, "shared": shared})
            if page == 1 and phase == "main":
                return BrowserResult(
                    ok=True,
                    action="eval",
                    data={
                        "value": {
                            "success": True,
                            "data": [{"phase": "main"}],
                            "meta": {
                                "action": "next_phase",
                                "next_phase": "open_detail",
                                "shared": {"current_id": "A1"},
                                "sleep_ms": 0,
                            },
                        }
                    },
                )
            if phase == "open_detail":
                return BrowserResult(
                    ok=True,
                    action="eval",
                    data={
                        "value": {
                            "success": True,
                            "data": [],
                            "meta": {
                                "action": "cdp_clicks",
                                "clicks": [{"x": 10, "y": 20}],
                                "next_phase": "capture",
                                "shared": shared,
                                "sleep_ms": 0,
                            },
                        }
                    },
                )
            if phase == "capture":
                return BrowserResult(
                    ok=True,
                    action="eval",
                    data={
                        "value": {
                            "success": True,
                            "data": [],
                            "meta": {
                                "action": "capture_wheel_requests",
                                "wheels": [{"x": 10, "y": 20, "delta_y": 600}],
                                "matches": [{"url_contains": "/api/detail"}],
                                "min_matches": 1,
                                "include_response_body": True,
                                "shared_key": "wheel_capture",
                                "next_phase": "download",
                                "sleep_ms": 0,
                            },
                        }
                    },
                )
            if phase == "download":
                return BrowserResult(
                    ok=True,
                    action="eval",
                    data={
                        "value": {
                            "success": True,
                            "data": [{"phase": "download"}],
                            "meta": {
                                "action": "download_clicks",
                                "items": [{"clicks": [{"x": 1, "y": 2}], "filename": "clicked.xlsx", "expected_name_regex": r"clicked\\.xlsx"}],
                                "shared_key": "click_downloads",
                                "next_phase": "url_download",
                                "sleep_ms": 0,
                            },
                        }
                    },
                )
            if phase == "url_download":
                return BrowserResult(
                    ok=True,
                    action="eval",
                    data={
                        "value": {
                            "success": True,
                            "data": [{"phase": "url_download"}],
                            "meta": {
                                "action": "download_urls",
                                "items": [{"url": "data:text/plain;base64,b2s=", "filename": "ok.txt"}],
                                "concurrency": 2,
                                "shared_key": "downloads",
                                "next_phase": "browser_session_download",
                                "sleep_ms": 0,
                            },
                        }
                    },
                )
            if phase == "browser_session_download":
                return BrowserResult(
                    ok=True,
                    action="eval",
                    data={
                        "value": {
                            "success": True,
                            "data": [{"phase": "browser_session_download"}],
                            "meta": {
                                "action": "download_urls",
                                "items": [{"url": "https://example.test/export", "filename": "browser.xlsx", "browser_session": True}],
                                "shared_key": "browser_downloads",
                                "next_phase": "done",
                                "sleep_ms": 0,
                            },
                        }
                    },
                )
            return BrowserResult(
                ok=True,
                action="eval",
                data={"value": {"success": True, "data": [{"phase": phase, "shared": shared}], "meta": {"action": "complete", "has_more": False, "shared": shared}}},
            )
        if action.kind == "capture":
            self.last_capture_action = action
            return BrowserResult(ok=True, action="capture", data={"mode": action.capture_mode, "matches": [{"url": "https://example.test/api/detail"}]})
        if action.kind == "click":
            artifact_dir = Path(getattr(self, "artifact_dir", tempfile.gettempdir()))
            downloads = artifact_dir / "downloads"
            downloads.mkdir(parents=True, exist_ok=True)
            (downloads / "clicked.xlsx").write_bytes(b"clicked")
            return BrowserResult(ok=True, action="click", data={})
        return BrowserResult(ok=True, action=action.kind, data={})

    async def download_browser_session(self, item, target_path, timeout_seconds):
        Path(target_path).write_bytes(b"browser")
        return {"success": True, "path": str(target_path), "browserSession": True, "bytes": 7}


class PhaseRunnerTest(unittest.IsolatedAsyncioTestCase):
    async def test_phase_runner_preserves_shared_and_handles_runtime_actions(self):
        with tempfile.TemporaryDirectory() as tmp:
            backend = PhaseBackend()
            backend.artifact_dir = tmp
            runner = WebPhaseRunner(backend=backend, artifact_dir=Path(tmp), max_pages=3, max_phases=20)
            runner.download_dir = Path(tmp) / "downloads"

            result = await runner.run_script("return window.__CRAWSHRIMP_PHASE__")

            self.assertEqual([row["phase"] for row in result.data], ["main", "download", "url_download", "browser_session_download", "done"])
            self.assertEqual(result.shared["current_id"], "A1")
            self.assertEqual(result.shared["wheel_capture"]["matches"][0]["url"], "https://example.test/api/detail")
            self.assertEqual(backend.last_capture_action.min_matches, 1)
            self.assertTrue(backend.last_capture_action.include_response_body)
            self.assertTrue(Path(result.shared["downloads"]["items"][0]["path"]).is_file())
            self.assertTrue(Path(result.shared["browser_downloads"]["items"][0]["path"]).is_file())
            self.assertTrue(result.shared["browser_downloads"]["items"][0]["browserSession"])
            self.assertTrue(Path(result.shared["click_downloads"]["items"][0]["path"]).is_file())
            self.assertIn("click", [action.kind for action in backend.actions])
            business_eval_calls = [item for item in backend.eval_calls if item["shared"].get("current_id")]
            self.assertEqual(business_eval_calls[-1]["shared"]["current_id"], "A1")

    async def test_phase_runner_reload_recovery_for_timeout_once(self):
        class RecoverBackend(PhaseBackend):
            def __init__(self):
                super().__init__()
                self.timeout_seen = False

            def execute(self, action):
                self.actions.append(action)
                if action.kind == "eval" and not self.timeout_seen:
                    self.timeout_seen = True
                    return BrowserResult(ok=False, action="eval", error="timeout")
                if action.kind == "reload":
                    return BrowserResult(ok=True, action="reload", data={})
                return BrowserResult(ok=True, action="eval", data={"value": {"success": True, "data": [], "meta": {"action": "complete", "has_more": False}}})

        backend = RecoverBackend()
        runner = WebPhaseRunner(backend=backend, max_pages=1, max_phases=3)

        result = await runner.run_script("return true")

        self.assertEqual(result.data, [])
        self.assertIn("reload", [action.kind for action in backend.actions])

    async def test_phase_runner_abort_preserves_partial_data(self):
        class AbortBackend(PhaseBackend):
            def execute(self, action):
                if action.kind == "eval":
                    return BrowserResult(
                        ok=True,
                        action="eval",
                        data={"value": {"success": True, "data": [{"id": 1}], "meta": {"action": "abort", "reason": "stopped"}}},
                    )
                return BrowserResult(ok=True, action=action.kind, data={})

        runner = WebPhaseRunner(backend=AbortBackend())

        with self.assertRaises(RunAbortedError) as ctx:
            await runner.run_script("return true")

        self.assertEqual(ctx.exception.partial_data, [{"id": 1}])

    async def test_phase_runner_prefers_async_backend_execute(self):
        class AsyncOnlyBackend:
            def execute(self, action):
                raise RuntimeError("sync execute should not be called inside phase runner")

            async def execute_async(self, action):
                return BrowserResult(
                    ok=True,
                    action=action.kind,
                    data={"value": {"success": True, "data": [{"ok": True}], "meta": {"action": "complete", "has_more": False}}},
                )

        runner = WebPhaseRunner(backend=AsyncOnlyBackend(), max_pages=1, max_phases=1)

        result = await runner.run_script("return true")

        self.assertEqual(result.data, [{"ok": True}])

    async def test_phase_runner_cleans_runtime_params_after_completion(self):
        class CleanupBackend:
            def __init__(self):
                self.actions = []

            def execute(self, action):
                self.actions.append(action)
                if action.kind == "eval" and "sessionStorage.removeItem" in action.script:
                    return BrowserResult(ok=True, action="eval", data={"value": True})
                return BrowserResult(
                    ok=True,
                    action="eval",
                    data={"value": {"success": True, "data": [], "meta": {"action": "complete", "has_more": False}}},
                )

        backend = CleanupBackend()
        runner = WebPhaseRunner(backend=backend, max_pages=1, max_phases=1)

        await runner.run_script("return true")

        cleanup_scripts = [action.script for action in backend.actions if action.kind == "eval" and "sessionStorage.removeItem" in action.script]
        self.assertEqual(len(cleanup_scripts), 1)
        self.assertIn("delete window.__CRAWSHRIMP_PARAMS__", cleanup_scripts[0])


if __name__ == "__main__":
    unittest.main()
