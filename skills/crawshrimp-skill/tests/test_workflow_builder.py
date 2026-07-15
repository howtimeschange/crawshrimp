import json
import tempfile
import unittest
from pathlib import Path

from scripts.workflow_builder import build_reusable_workflow


class WorkflowBuilderTest(unittest.TestCase):
    def _journal(self):
        return {
            "task": "下载订单报表",
            "plan": {"kind": "operate"},
            "observations": [
                {
                    "summary": "orders page observed",
                    "page": {
                        "url": "https://example.test/orders",
                        "title": "Orders",
                        "visible_text": ["Orders"],
                        "controls": [{"role": "button", "name": "Export", "selector": "button.export"}],
                        "tables": [{"caption": "Orders", "rows": 2}],
                    },
                }
            ],
            "actions": [
                {
                    "kind": "click",
                    "target": "button.export",
                    "value": None,
                    "risk": "safe",
                    "reason": "open export menu",
                },
                {
                    "kind": "download",
                    "target": "a.download",
                    "value": None,
                    "risk": "safe",
                    "reason": "download report",
                },
            ],
            "verifications": [
                {"passed": True, "evidence": "Export menu visible"},
                {"passed": True, "evidence": "Downloaded report file exists"},
            ],
        }

    def test_builds_reusable_workflow_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            journal_path = Path(tmp) / "journal.json"
            journal_path.write_text(json.dumps(self._journal(), ensure_ascii=False), encoding="utf-8")
            output_dir = Path(tmp) / "orders-workflow"

            result = build_reusable_workflow(
                journal_path=journal_path,
                output_dir=output_dir,
                name="orders-report",
                include_skill=True,
            )

            workflow = (output_dir / "workflow.md").read_text(encoding="utf-8")
            commands = json.loads((output_dir / "commands.json").read_text(encoding="utf-8"))
            runner = (output_dir / "run_workflow.py").read_text(encoding="utf-8")
            skill = (output_dir / "SKILL.md").read_text(encoding="utf-8")

        self.assertEqual(result["name"], "orders-report")
        self.assertIn("下载订单报表", workflow)
        self.assertEqual(commands["name"], "orders-report")
        self.assertEqual(commands["actions"][0]["kind"], "click")
        self.assertIn("web_operator.py", runner)
        self.assertIn("name: orders-report", skill)
        self.assertIn("Use when", skill)

    def test_reusable_workflow_preserves_navigation_upload_and_verify_checks(self):
        journal = self._journal()
        journal["actions"].extend([
            {
                "kind": "navigate",
                "target": "https://example.test/report",
                "value": "https://example.test/report",
                "risk": "safe",
                "reason": "open report",
            },
            {
                "kind": "upload",
                "target": "input[type=file]",
                "value": "/tmp/report.csv",
                "risk": "safe",
                "reason": "attach report",
            },
        ])
        journal["verifications"].append({
            "passed": True,
            "evidence": "report file exists",
            "check": {"kind": "file-exists", "target": "report.csv"},
        })
        with tempfile.TemporaryDirectory() as tmp:
            journal_path = Path(tmp) / "journal.json"
            journal_path.write_text(json.dumps(journal, ensure_ascii=False), encoding="utf-8")
            output_dir = Path(tmp) / "orders-workflow"

            build_reusable_workflow(
                journal_path=journal_path,
                output_dir=output_dir,
                name="orders-report",
                include_skill=False,
            )

            commands = json.loads((output_dir / "commands.json").read_text(encoding="utf-8"))
            runner = (output_dir / "run_workflow.py").read_text(encoding="utf-8")

        self.assertEqual(commands["actions"][-2]["url"], "https://example.test/report")
        self.assertEqual(commands["actions"][-1]["files"], ["/tmp/report.csv"])
        self.assertIn("--check", runner)
        self.assertIn("--file", runner)

    def test_reusable_workflow_preserves_non_selector_runtime_metadata(self):
        journal = self._journal()
        journal["actions"] = [
            {
                "kind": "upload-chooser",
                "target": "file chooser",
                "value": "/tmp/a.csv,/tmp/b.csv",
                "risk": "safe",
                "reason": "upload via chooser",
                "metadata": {
                    "clicks": [{"x": 10, "y": 20}],
                    "files": ["/tmp/a.csv", "/tmp/b.csv"],
                    "timeout_ms": 15000,
                },
            },
            {
                "kind": "capture-wheel",
                "target": "",
                "value": '[{"url_contains":"/api/orders"}]',
                "risk": "safe",
                "reason": "capture scroll request",
                "metadata": {
                    "wheels": [{"x": 30, "y": 40, "delta_y": 700}],
                    "matches": [{"url_contains": "/api/orders"}],
                },
            },
            {
                "kind": "download",
                "target": "a.export",
                "risk": "safe",
                "reason": "download report",
                "metadata": {"expected_file": "orders.csv", "timeout_ms": 9000},
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            journal_path = Path(tmp) / "journal.json"
            journal_path.write_text(json.dumps(journal, ensure_ascii=False), encoding="utf-8")
            output_dir = Path(tmp) / "orders-workflow"

            build_reusable_workflow(journal_path=journal_path, output_dir=output_dir, name="orders-report")

            commands = json.loads((output_dir / "commands.json").read_text(encoding="utf-8"))
            runner = (output_dir / "run_workflow.py").read_text(encoding="utf-8")

        self.assertEqual(commands["actions"][0]["clicks"], [{"x": 10, "y": 20}])
        self.assertEqual(commands["actions"][0]["files"], ["/tmp/a.csv", "/tmp/b.csv"])
        self.assertEqual(commands["actions"][1]["wheels"], [{"x": 30, "y": 40, "delta_y": 700}])
        self.assertEqual(commands["actions"][1]["matchers"], [{"url_contains": "/api/orders"}])
        self.assertEqual(commands["actions"][2]["expected_file"], "orders.csv")
        self.assertIn("--clicks-json", runner)
        self.assertIn("--wheels-json", runner)
        self.assertIn("--expected-file", runner)

    def test_reusable_workflow_can_generate_adapter_draft_package(self):
        with tempfile.TemporaryDirectory() as tmp:
            journal_path = Path(tmp) / "journal.json"
            journal_path.write_text(json.dumps(self._journal(), ensure_ascii=False), encoding="utf-8")
            output_dir = Path(tmp) / "orders-workflow"

            result = build_reusable_workflow(
                journal_path=journal_path,
                output_dir=output_dir,
                name="orders-report",
                include_adapter_draft=True,
            )

            manifest = (output_dir / "adapter-draft" / "manifest.yaml").read_text(encoding="utf-8")
            script = (output_dir / "adapter-draft" / "orders-report.js").read_text(encoding="utf-8")
            notes = (output_dir / "adapter-draft" / "README.md").read_text(encoding="utf-8")

        self.assertIn("adapter-draft/manifest.yaml", result["files"])
        self.assertIn("id: orders-report", manifest)
        self.assertIn("script: orders-report.js", manifest)
        self.assertIn("success: true", script)
        self.assertIn("Review before installing", notes)


if __name__ == "__main__":
    unittest.main()
