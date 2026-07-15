import json
import tempfile
import unittest
from pathlib import Path

from scripts.browser_executor import BrowserResult
from scripts.web_operator import (
    DOM_SNAPSHOT_SCRIPT,
    WebOperator,
    build_snapshot,
    distill_workflow,
    load_journal,
    make_action_script,
)


class FakeBackend:
    def __init__(self):
        self.actions = []

    def execute(self, action):
        self.actions.append(action)
        if action.kind == "eval" and action.script == DOM_SNAPSHOT_SCRIPT:
            return BrowserResult(
                ok=True,
                action="eval",
                data={
                    "value": {
                        "url": "https://example.test/orders",
                        "title": "Orders",
                        "headings": ["Orders"],
                        "buttons": [{"text": "Export", "selector": "button.export"}],
                        "inputs": [{"placeholder": "Search", "selector": "input.search"}],
                        "tables": [{"caption": "Orders", "rows": 2}],
                    }
                },
            )
        if action.kind == "eval" and "window.__webAgentVerify" in action.script:
            return BrowserResult(ok=True, action="eval", data={"value": {"passed": True, "evidence": "Export visible"}})
        return BrowserResult(ok=True, action=action.kind, data={"value": True})


class WebOperatorTest(unittest.TestCase):
    def test_observe_uses_dom_snapshot_and_normalizes_page_state(self):
        operator = WebOperator(backend=FakeBackend(), task="抓取订单表格")

        page = operator.observe()

        self.assertEqual(page.url, "https://example.test/orders")
        self.assertEqual(page.controls[0]["name"], "Export")
        self.assertEqual(page.controls[1]["role"], "input")
        self.assertEqual(page.tables[0]["rows"], 2)
        self.assertIn("Orders", page.visible_text)

    def test_make_action_script_supports_click_type_select_upload_download_wait(self):
        cases = {
            "click": {"selector": "button.export"},
            "type": {"selector": "input.search", "value": "sku123"},
            "select": {"selector": "select.status", "value": "active"},
            "upload": {"selector": "input[type=file]", "value": "/tmp/a.csv"},
            "download": {"selector": "a.download"},
            "wait": {"selector": ".ready", "timeout_ms": 2000},
        }
        for kind, kwargs in cases.items():
            with self.subTest(kind=kind):
                script = make_action_script(kind, **kwargs)
                self.assertIn("window.__webAgentAct", script)
                self.assertIn(kind, script)

    def test_act_verify_and_journal_record_evidence_chain(self):
        backend = FakeBackend()
        operator = WebOperator(backend=backend, task="下载订单")

        operator.observe()
        action_result = operator.act("click", selector="button.export", reason="open export menu")
        verification = operator.verify("document.body.innerText.includes('Export')", "Export visible")

        self.assertTrue(action_result.ok)
        self.assertTrue(verification.passed)
        self.assertEqual(operator.journal.actions[0].kind, "click")
        self.assertEqual(operator.journal.verifications[0].evidence, "Export visible")

    def test_save_journal_and_distill_workflow(self):
        operator = WebOperator(backend=FakeBackend(), task="下载订单")
        operator.observe()
        operator.act("click", selector="button.export", reason="open export menu")
        operator.verify("document.body.innerText.includes('Export')", "Export visible")

        with tempfile.TemporaryDirectory() as tmp:
            journal_path = operator.save_journal(Path(tmp) / "journal.json")
            loaded = json.loads(journal_path.read_text(encoding="utf-8"))
            workflow = distill_workflow(loaded)

        self.assertEqual(loaded["task"], "下载订单")
        self.assertIn("## Workflow Draft", workflow)
        self.assertIn("open export menu", workflow)
        self.assertIn("Export visible", workflow)

    def test_load_existing_journal_and_append_next_step(self):
        operator = WebOperator(backend=FakeBackend(), task="下载订单")
        operator.observe()

        with tempfile.TemporaryDirectory() as tmp:
            journal_path = operator.save_journal(Path(tmp) / "journal.json")
            resumed = WebOperator(
                backend=FakeBackend(),
                task="ignored default task",
                journal=load_journal(journal_path),
            )
            resumed.act("click", selector="button.export", reason="open export menu")
            resumed.save_journal(journal_path)
            loaded = json.loads(journal_path.read_text(encoding="utf-8"))

        self.assertEqual(loaded["task"], "下载订单")
        self.assertEqual(len(loaded["observations"]), 1)
        self.assertEqual(len(loaded["actions"]), 1)

    def test_upload_action_uses_backend_file_upload(self):
        class UploadBackend(FakeBackend):
            def execute(self, action):
                self.actions.append(action)
                if action.kind == "upload":
                    return BrowserResult(
                        ok=True,
                        action="upload",
                        data={"selector": action.selector, "files": action.files, "fileCount": len(action.files)},
                    )
                return super().execute(action)

        with tempfile.TemporaryDirectory() as tmp:
            upload_file = Path(tmp) / "sample.txt"
            upload_file.write_text("hello", encoding="utf-8")
            backend = UploadBackend()
            operator = WebOperator(backend=backend, task="上传文件")

            result = operator.act("upload", selector="input[type=file]", files=[str(upload_file)])

        self.assertTrue(result.ok)
        self.assertEqual(backend.actions[-1].kind, "upload")
        self.assertEqual(backend.actions[-1].files[0], str(upload_file))
        self.assertTrue(operator.journal.verifications[-1].passed)

    def test_upload_chooser_and_capture_wheel_actions_reach_backend(self):
        class RichActionBackend(FakeBackend):
            def execute(self, action):
                self.actions.append(action)
                if action.kind == "upload_chooser":
                    return BrowserResult(ok=True, action="upload_chooser", data={"fileCount": len(action.files)})
                if action.kind == "capture":
                    return BrowserResult(ok=True, action="capture", data={"matches": [{"url": "https://example.test/api"}]})
                return super().execute(action)

        with tempfile.TemporaryDirectory() as tmp:
            upload_file = Path(tmp) / "sample.txt"
            upload_file.write_text("hello", encoding="utf-8")
            backend = RichActionBackend()
            operator = WebOperator(backend=backend, task="上传并捕获")

            chooser = operator.act("upload-chooser", files=[str(upload_file)], clicks=[{"x": 1, "y": 2}])
            capture = operator.act("capture-wheel", wheels=[{"x": 3, "y": 4, "delta_y": 600}], value='[{"url_contains":"/api"}]')

        self.assertTrue(chooser.ok)
        self.assertTrue(capture.ok)
        self.assertEqual(backend.actions[-2].kind, "upload_chooser")
        self.assertEqual(backend.actions[-1].capture_mode, "wheel")

    def test_download_action_waits_for_new_file_and_records_artifact(self):
        class DownloadBackend(FakeBackend):
            def __init__(self, download_dir):
                super().__init__()
                self.download_dir = Path(download_dir)

            def execute(self, action):
                self.actions.append(action)
                if action.kind == "eval" and "window.__webAgentAct" in action.script:
                    (self.download_dir / "orders.csv").write_text("id,total\n1,9\n", encoding="utf-8")
                    return BrowserResult(ok=True, action="eval", data={"value": {"ok": True}})
                return super().execute(action)

        with tempfile.TemporaryDirectory() as tmp:
            backend = DownloadBackend(tmp)
            operator = WebOperator(backend=backend, task="下载订单", download_dir=Path(tmp))

            result = operator.act("download", selector="a.export", expected_file="orders.csv", timeout_ms=1000)

        self.assertTrue(result.ok)
        self.assertEqual(result.data["download"]["filename"], "orders.csv")
        self.assertGreater(result.data["download"]["bytes"], 0)
        self.assertIn("Downloaded file", operator.journal.verifications[-1].evidence)

    def test_structured_verify_file_and_text_checks(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "report.csv"
            report.write_text("ok", encoding="utf-8")
            operator = WebOperator(backend=FakeBackend(), task="校验下载", download_dir=Path(tmp))

            file_check = operator.verify_check("file-exists", target="report.csv", evidence="report exists")
            text_check = operator.verify_check("text", target="Export", evidence="export visible")

        self.assertTrue(file_check.passed)
        self.assertTrue(text_check.passed)
        self.assertEqual(operator.journal.verifications[-2].check["kind"], "file-exists")

    def test_observe_includes_environment_model_fields(self):
        class RichBackend(FakeBackend):
            def execute(self, action):
                if action.kind == "eval" and action.script == DOM_SNAPSHOT_SCRIPT:
                    return BrowserResult(
                        ok=True,
                        action="eval",
                        data={
                            "value": {
                                "url": "https://example.test/orders",
                                "title": "Orders",
                                "headings": ["Orders"],
                                "buttons": [{"text": "Delete", "selector": "button.delete"}],
                                "inputs": [],
                                "resources": [{"url": "https://example.test/api/orders", "initiatorType": "fetch"}],
                                "blocking_states": [{"kind": "dangerous-control", "text": "Delete"}],
                                "context": {"origin": "https://example.test", "path": "/orders"},
                                "active_regions": [{"kind": "dialog", "selector": "[role=dialog]", "text": "Confirm"}],
                                "accessibility": [{"role": "button", "name": "Delete", "selector": "button.delete"}],
                            }
                        },
                    )
                return super().execute(action)

        page = WebOperator(backend=RichBackend(), task="观察页面").observe()

        self.assertEqual(page.context["origin"], "https://example.test")
        self.assertEqual(page.blocking_states[0]["kind"], "dangerous-control")
        self.assertEqual(page.active_regions[0]["kind"], "dialog")
        self.assertEqual(page.accessibility[0]["role"], "button")
        self.assertEqual(page.network[0]["kind"], "resource")

    def test_observe_includes_framework_snapshot(self):
        class FrameworkBackend(FakeBackend):
            def execute(self, action):
                if action.kind == "eval" and action.script == DOM_SNAPSHOT_SCRIPT:
                    return BrowserResult(
                        ok=True,
                        action="eval",
                        data={
                            "value": {
                                "url": "https://example.test/app",
                                "title": "App",
                                "headings": ["App"],
                                "buttons": [],
                                "framework": {"react": True, "vue3": False, "nextjs": True},
                                "stores": [{"type": "pinia", "id": "orders", "actions": ["load"], "stateKeys": ["rows"]}],
                            }
                        },
                    )
                return super().execute(action)

        page = WebOperator(backend=FrameworkBackend(), task="观察框架").observe()

        self.assertTrue(page.context["framework"]["react"])
        self.assertEqual(page.context["stores"][0]["id"], "orders")

    def test_build_snapshot_returns_dom_framework_and_network_model(self):
        operator = WebOperator(backend=FakeBackend(), task="观察页面")

        snapshot = build_snapshot(operator)

        self.assertEqual(snapshot["dom"]["url"], "https://example.test/orders")
        self.assertIn("framework", snapshot)
        self.assertIn("network", snapshot)
        self.assertEqual(snapshot["framework"], snapshot["dom"]["context"].get("framework", {}))

    def test_upload_action_rejects_missing_local_files_before_backend_call(self):
        class UploadBackend(FakeBackend):
            def execute(self, action):
                self.actions.append(action)
                if action.kind == "upload":
                    return BrowserResult(ok=True, action="upload", data={})
                return super().execute(action)

        backend = UploadBackend()
        operator = WebOperator(backend=backend, task="上传文件")

        result = operator.act("upload", selector="input[type=file]", files=["/tmp/not-present-crawshrimp.csv"])

        self.assertFalse(result.ok)
        self.assertIn("upload file not found", result.error)
        self.assertNotIn("upload", [action.kind for action in backend.actions])

    def test_distill_workflow_includes_adapter_draft_details(self):
        journal = {
            "task": "下载订单报表",
            "plan": {"kind": "operate"},
            "observations": [
                {
                    "page": {
                        "url": "https://example.test/orders",
                        "controls": [{"role": "input", "name": "Search", "selector": "input[name=\"q\"]"}],
                        "network": [{"kind": "resource", "url": "https://example.test/api/orders"}],
                    }
                }
            ],
            "actions": [{"kind": "click", "target": "#export", "reason": "open export"}],
            "verifications": [{"passed": True, "evidence": "Downloaded file orders.csv"}],
            "failures": [{"action": "click .old", "evidence": "target not found", "recovery": "use #export"}],
        }

        workflow = distill_workflow(journal)

        self.assertIn("Selector Confidence", workflow)
        self.assertIn("Field Mapping Hints", workflow)
        self.assertIn("Failure Branches", workflow)
        self.assertIn("Crawshrimp Adapter Draft", workflow)


if __name__ == "__main__":
    unittest.main()
