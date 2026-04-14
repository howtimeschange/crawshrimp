import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core.probe_models import ProbeRequest
from core.probe_service import read_probe_bundle, read_probe_bundle_full, run_probe_request
from core import api_server


class FakeRunner:
    def __init__(self):
        self.tab_id = "tab-123"
        self.tab_url = "https://example.com/app/probe"
        self.runtime_output_files = []

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False):
        if "crawshrimp-probe:dom-snapshot" in expression:
            return type("Result", (), {
                "success": True,
                "data": [{
                    "url": "https://example.com/app/probe",
                    "title": "Probe Page",
                    "headings": ["Probe Page", "Detail Drawer"],
                    "buttons": [{"text": "查看详情", "selector": "button[data-testid=\"detail\"]", "tag": "button"}],
                    "inputs": [{"selector": "input.keyword", "type": "text", "value": "", "placeholder": "keyword"}],
                    "selects": [{"selector": "select.site", "text": "全部", "value": "all"}],
                    "drawer_roots": ["div.drawer"],
                    "modal_roots": [],
                    "active_containers": ["div.drawer", "main.content"],
                    "body_text_sample": "商品数据分析 查看详情",
                    "table_count": 1,
                }],
                "meta": {"has_more": False},
                "error": None,
            })()
        if "crawshrimp-probe:framework-snapshot" in expression:
            return type("Result", (), {
                "success": True,
                "data": [{
                    "framework": {"react": True, "vue3": False, "nextjs": False},
                    "stores": [],
                }],
                "meta": {"has_more": False},
                "error": None,
            })()
        if "crawshrimp-probe:safe-targets" in expression:
            return type("Result", (), {
                "success": True,
                "data": [{
                    "targets": [{
                        "text": "查看详情",
                        "selector": "button[data-testid=\"detail\"]",
                        "reason": "label",
                        "matched": "查看详情",
                        "x": 120,
                        "y": 240,
                    }],
                }],
                "meta": {"has_more": False},
                "error": None,
            })()
        return type("Result", (), {
            "success": False,
            "data": None,
            "meta": None,
            "error": "unexpected expression",
        })()

    async def capture_passive_requests(self, **kwargs):
        return {
            "ok": True,
            "mode": "passive",
            "matches": [{
                "url": "https://example.com/api/items?page=1&limit=20",
                "method": "GET",
                "status": 200,
                "mimeType": "application/json",
                "headers": {"Cookie": "sid=abc"},
                "responseHeaders": {"content-type": "application/json"},
                "body": json.dumps({"data": {"items": [{"title": "Item A", "url": "/a", "author": "shop"}]}}),
            }],
        }

    async def capture_click_requests(self, clicks, **kwargs):
        return {
            "ok": True,
            "mode": "click",
            "matches": [{
                "url": "https://example.com/api/export/download?id=1",
                "method": "GET",
                "status": 200,
                "mimeType": "application/json",
                "headers": {"Cookie": "sid=abc"},
                "responseHeaders": {"content-type": "application/json"},
                "body": json.dumps({"result": {"fileUrl": "https://example.com/file.xlsx"}}),
            }],
        }


class FakeSession:
    def __init__(self):
        self.adapter = type("Adapter", (), {"name": "DemoAdapter"})()
        self.task = type("Task", (), {"name": "ProbeTask"})()
        self.adapter_dir = Path("/tmp/demo-adapter")
        self.target_entry_url = "https://example.com/app/probe"
        self.mode = "current"
        self.tab = {"id": "tab-123", "url": "https://example.com/app/probe"}
        self.runner = FakeRunner()


class ProbeServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_probe_persists_bundle(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.dict(os.environ, {"CRAWSHRIMP_DATA": tmpdir}, clear=False):
                with patch("core.probe_service.open_browser_session", return_value=FakeSession()):
                    req = ProbeRequest(
                        adapter_id="demo",
                        task_id="probe_task",
                        goal="识别详情抽屉和导出请求",
                        safe_auto=True,
                        safe_click_labels=["查看详情"],
                    )
                    result = await run_probe_request(req)
                    self.assertTrue(result.ok)
                    bundle_dir = Path(result.bundle_dir)
                    self.assertTrue(bundle_dir.exists())
                    self.assertTrue((bundle_dir / "manifest.json").exists())
                    self.assertTrue((bundle_dir / "dom.json").exists())
                    self.assertTrue((bundle_dir / "framework.json").exists())
                    self.assertTrue((bundle_dir / "network.json").exists())
                    self.assertTrue((bundle_dir / "endpoints.json").exists())
                    self.assertTrue((bundle_dir / "strategy.json").exists())
                    self.assertTrue((bundle_dir / "recommendations.json").exists())
                    self.assertTrue((bundle_dir / "report.md").exists())

                    strategy = json.loads((bundle_dir / "strategy.json").read_text(encoding="utf-8"))
                    self.assertEqual(strategy["page_strategy"], "mixed")
                    self.assertEqual(strategy["auth_strategy"], "cookie")

                    recommendations = json.loads((bundle_dir / "recommendations.json").read_text(encoding="utf-8"))
                    self.assertIn("trigger_export", recommendations["phase_candidates"])
                    self.assertIn("capture_click_requests", recommendations["runtime_actions"])

    async def test_probe_api_route_returns_bundle_summary(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.dict(os.environ, {"CRAWSHRIMP_DATA": tmpdir}, clear=False):
                with patch("core.probe_service.open_browser_session", return_value=FakeSession()):
                    payload = await api_server.run_probe(
                        ProbeRequest(
                            adapter_id="demo",
                            task_id="probe_task",
                            goal="检查 API 路径",
                        )
                    )

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["summary"]["page_strategy"], "mixed")
        self.assertGreaterEqual(payload["summary"]["endpoint_count"], 1)

    async def test_probe_bundle_readers_return_saved_bundle(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.dict(os.environ, {"CRAWSHRIMP_DATA": tmpdir}, clear=False):
                with patch("core.probe_service.open_browser_session", return_value=FakeSession()):
                    result = await run_probe_request(
                        ProbeRequest(
                            adapter_id="demo",
                            task_id="probe_task",
                            goal="检查读取接口",
                        )
                    )
                    summary_payload = read_probe_bundle(result.probe_id).model_dump()
                    full_payload = read_probe_bundle_full(result.probe_id).model_dump()
                    probe_payload = api_server.get_probe(result.probe_id)
                    probe_bundle_payload = api_server.get_probe_bundle(result.probe_id)

        self.assertTrue(summary_payload["ok"])
        self.assertEqual(summary_payload["probe_id"], result.probe_id)
        self.assertIn("manifest.json", summary_payload["files"])
        self.assertEqual(full_payload["bundle"]["strategy"]["page_strategy"], "mixed")
        self.assertIn("Probe Report", full_payload["bundle"]["report_markdown"])
        self.assertEqual(probe_payload["probe_id"], result.probe_id)
        self.assertEqual(probe_bundle_payload["bundle"]["strategy"]["page_strategy"], "mixed")

    async def test_profile_auto_applies_safe_click_labels(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            profile_dir = Path(tmpdir) / "demo"
            (profile_dir / "probe").mkdir(parents=True, exist_ok=True)
            (profile_dir / "probe" / "probe_task.json").write_text(
                json.dumps({
                    "safe_click_labels": ["查看详情"],
                    "safe_click_limit": 1,
                }, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            with patch.dict(os.environ, {"CRAWSHRIMP_DATA": tmpdir}, clear=False):
                with patch("core.probe_profiles.adapter_loader.get_adapter_dir", return_value=profile_dir):
                    with patch("core.probe_service.open_browser_session", return_value=FakeSession()):
                        result = await run_probe_request(
                            ProbeRequest(
                                adapter_id="demo",
                                task_id="probe_task",
                                goal="不手填 safe_click_labels 也要自动探查",
                            )
                        )
                        bundle_dir = Path(result.bundle_dir)
                        manifest = json.loads((bundle_dir / "manifest.json").read_text(encoding="utf-8"))
                        self.assertEqual(manifest["profile"], "probe_task")
                        self.assertTrue(manifest["profile_applied"]["safe_auto"])
                        self.assertIn("查看详情", manifest["profile_applied"]["safe_click_labels"])
                        self.assertEqual(result.summary["interaction_count"], 1)


if __name__ == "__main__":
    unittest.main()
