import unittest
from pathlib import Path
from unittest.mock import patch

from core.dev_harness import run_harness_capture, run_harness_eval, run_harness_snapshot
from core.dev_harness_models import DevHarnessCaptureRequest, DevHarnessEvalRequest, DevHarnessSnapshotRequest


class FakeRunner:
    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False):
        if "crawshrimp-probe:dom-snapshot" in expression:
            return type("Result", (), {
                "success": True,
                "data": [{
                    "url": "https://example.com/app/detail",
                    "title": "Detail Page",
                    "headings": ["Detail Page"],
                    "buttons": [],
                    "inputs": [],
                    "selects": [],
                    "drawer_roots": ["div.drawer"],
                    "modal_roots": [],
                    "active_containers": ["main.content"],
                    "body_text_sample": "drawer export",
                    "table_count": 1,
                }],
                "meta": {"has_more": False},
                "error": None,
            })()
        if "crawshrimp-probe:framework-snapshot" in expression:
            return type("Result", (), {
                "success": True,
                "data": [{"framework": {"react": True}, "stores": []}],
                "meta": {"has_more": False},
                "error": None,
            })()
        return type("Result", (), {
            "success": True,
            "data": [{"ok": True}],
            "meta": {"has_more": False},
            "error": None,
            "model_dump": lambda self=None: {
                "success": True,
                "data": [{"ok": True}],
                "meta": {"has_more": False},
                "error": None,
            },
        })()

    async def capture_passive_requests(self, **kwargs):
        return {"mode": "passive", "matches": [{"url": "https://example.com/api"}]}

    async def capture_click_requests(self, clicks, **kwargs):
        return {"mode": "click", "clicks": clicks, "matches": [{"url": "https://example.com/api/export"}]}

    async def capture_url_requests(self, url, **kwargs):
        return {"mode": "url", "url": url, "matches": [{"url": url}]}


class FakeSession:
    def __init__(self):
        self.adapter = type("Adapter", (), {"name": "Demo"})()
        self.task = type("Task", (), {"name": "Task"})()
        self.adapter_dir = Path("/tmp/demo")
        self.target_entry_url = "https://example.com/app/detail"
        self.mode = "current"
        self.tab = {"id": "tab-1", "url": "https://example.com/app/detail"}
        self.runner = FakeRunner()


class DevHarnessTests(unittest.IsolatedAsyncioTestCase):
    async def test_snapshot_returns_dom_and_knowledge(self):
        with patch("core.dev_harness.open_browser_session", return_value=FakeSession()):
            with patch("core.dev_harness.search_knowledge", return_value={"ok": True, "cards": [{"title": "Known Drawer Trap"}]}):
                payload = await run_harness_snapshot(
                    DevHarnessSnapshotRequest(adapter_id="demo", task_id="task", include_knowledge=True)
                )

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["dom"]["title"], "Detail Page")
        self.assertEqual(payload["knowledge"]["cards"][0]["title"], "Known Drawer Trap")

    async def test_eval_returns_runner_result(self):
        with patch("core.dev_harness.open_browser_session", return_value=FakeSession()):
            payload = await run_harness_eval(
                DevHarnessEvalRequest(adapter_id="demo", task_id="task", expression="(() => ({ success: true, data: [], meta: { has_more: false } }))()")
            )

        self.assertTrue(payload["ok"])
        self.assertIn("result", payload)

    async def test_capture_dispatches_to_click_mode(self):
        with patch("core.dev_harness.open_browser_session", return_value=FakeSession()):
            payload = await run_harness_capture(
                DevHarnessCaptureRequest(
                    adapter_id="demo",
                    task_id="task",
                    capture_mode="click",
                    clicks=[{"x": 120, "y": 240}],
                )
            )

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["capture"]["mode"], "click")
        self.assertEqual(payload["capture"]["clicks"][0]["x"], 120)


if __name__ == "__main__":
    unittest.main()
