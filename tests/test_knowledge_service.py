import json
import os
import tempfile
import unittest
from pathlib import Path

from core import adapter_loader, knowledge_service


def _write_adapter_with_notes(root: Path) -> Path:
    adapter_dir = root / "demo"
    notes_dir = adapter_dir / "notes"
    notes_dir.mkdir(parents=True, exist_ok=True)
    (adapter_dir / "manifest.yaml").write_text(
        "\n".join([
            "id: demo",
            "name: Demo",
            "version: 1.0.0",
            "entry_url: https://example.com/app",
            "tasks:",
            "  - id: goods_traffic_detail",
            "    name: Goods Traffic Detail",
            "    script: goods-traffic-detail.js",
            "    trigger:",
            "      type: manual",
        ]),
        encoding="utf-8",
    )
    (adapter_dir / "goods-traffic-detail.js").write_text(";(async () => ({ success: true, data: [], meta: { has_more: false } }))()", encoding="utf-8")
    (notes_dir / "goods-traffic-detail-dom-findings-2026-04-13.md").write_text(
        "\n".join([
            "# Goods Traffic Detail DOM Findings",
            "",
            "## Stable selectors",
            "",
            "- button[data-testid=\"detail\"]",
            "- div.drawer",
            "",
            "## Interaction notes",
            "",
            "- 打开抽屉前先等待表格稳定",
            "- 页面 URL: https://example.com/app/detail",
        ]),
        encoding="utf-8",
    )
    return adapter_dir


def _write_probe_bundle(base: Path) -> None:
    bundle_dir = base / "probes" / "demo" / "goods_traffic_detail" / "2026-04-21T10-00-00Z-current"
    bundle_dir.mkdir(parents=True, exist_ok=True)
    (bundle_dir / "manifest.json").write_text(json.dumps({
        "probe_id": "2026-04-21T10-00-00Z-current",
        "adapter_id": "demo",
        "task_id": "goods_traffic_detail",
        "goal": "识别抽屉与导出请求",
        "target_url": "https://example.com/app/detail",
        "final_url": "https://example.com/app/detail?drawer=1",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    (bundle_dir / "strategy.json").write_text(json.dumps({
        "page_strategy": "mixed",
        "auth_strategy": "cookie",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    (bundle_dir / "recommendations.json").write_text(json.dumps({
        "phase_candidates": ["open_detail", "trigger_export"],
        "runtime_actions": ["capture_click_requests"],
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    (bundle_dir / "endpoints.json").write_text(json.dumps([
        {
            "pattern": "https://example.com/api/export?id=1",
            "method": "GET",
            "item_path": "data.items",
            "runtime_action": "capture_click_requests",
            "auth_indicators": ["cookie"],
            "sample_fields": ["title", "url", "seller"],
        }
    ], ensure_ascii=False, indent=2), encoding="utf-8")
    (bundle_dir / "report.md").write_text("# Probe Report\n\ncontent", encoding="utf-8")


class KnowledgeServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.env = {"CRAWSHRIMP_DATA": self.tmpdir.name}
        adapter_loader._adapters.clear()
        adapter_loader._adapter_dirs.clear()
        adapter_loader._enabled.clear()
        adapter_loader._install_meta.clear()

    def tearDown(self):
        adapter_loader._adapters.clear()
        adapter_loader._adapter_dirs.clear()
        adapter_loader._enabled.clear()
        adapter_loader._install_meta.clear()

    def test_rebuild_knowledge_index_materializes_notes_and_probe_cards(self):
        with unittest.mock.patch.dict(os.environ, self.env, clear=False):
            adapter_dir = _write_adapter_with_notes(Path(self.tmpdir.name) / "src")
            adapter_loader.install_from_dir(str(adapter_dir), install_mode="copy")
            _write_probe_bundle(Path(self.tmpdir.name))

            result = knowledge_service.rebuild_knowledge_index()

            self.assertTrue(result["ok"])
            cards = json.loads((Path(self.tmpdir.name) / "knowledge" / "cards.json").read_text(encoding="utf-8"))
            titles = [card["title"] for card in cards]
            self.assertTrue(any("Stable selectors" in title for title in titles))
            self.assertTrue(any("Probe 2026-04-21T10-00-00Z-current" in title for title in titles))
            skill_path = Path(self.tmpdir.name) / "knowledge" / "skills" / "demo" / "goods_traffic_detail.md"
            self.assertTrue(skill_path.exists())

    def test_search_knowledge_filters_by_task_and_url(self):
        with unittest.mock.patch.dict(os.environ, self.env, clear=False):
            adapter_dir = _write_adapter_with_notes(Path(self.tmpdir.name) / "src")
            adapter_loader.install_from_dir(str(adapter_dir), install_mode="copy")
            _write_probe_bundle(Path(self.tmpdir.name))
            knowledge_service.rebuild_knowledge_index()

            result = knowledge_service.search_knowledge(
                "drawer export",
                adapter_id="demo",
                task_id="goods_traffic_detail",
                url="https://example.com/app/detail?drawer=1",
                limit=5,
            )

            self.assertTrue(result["ok"])
            self.assertGreaterEqual(result["total"], 1)
            self.assertEqual(result["cards"][0]["adapter_id"], "demo")
            self.assertEqual(result["cards"][0]["task_id"], "goods_traffic_detail")


if __name__ == "__main__":
    unittest.main()
