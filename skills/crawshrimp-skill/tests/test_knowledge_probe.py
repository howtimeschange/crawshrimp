import json
import tempfile
import unittest
from pathlib import Path

from scripts.knowledge_service import KnowledgeService
from scripts.probe_bundle import build_probe_bundle, redact_capture_payload


class KnowledgeProbeTest(unittest.TestCase):
    def test_rebuild_indexes_notes_and_probe_bundles_then_searches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            adapters = root / "adapters"
            demo = adapters / "demo"
            notes = demo / "notes"
            notes.mkdir(parents=True)
            (demo / "manifest.yaml").write_text(
                "id: demo\nname: Demo\nentry_url: https://example.test\ntasks:\n  - id: orders\n    name: Orders\n    script: orders.js\n",
                encoding="utf-8",
            )
            (notes / "orders-dom-findings-2026-06-14.md").write_text(
                "# Orders Findings\n\n## Endpoint\n- GET https://example.test/api/orders\n- selector button.export\n",
                encoding="utf-8",
            )
            probe = root / "probes" / "demo" / "orders" / "2026-06-14-current"
            probe.mkdir(parents=True)
            (probe / "manifest.json").write_text(
                json.dumps(
                    {
                        "probe_id": "2026-06-14-current",
                        "adapter_id": "demo",
                        "task_id": "orders",
                        "goal": "find export",
                        "target_url": "https://example.test/orders",
                        "final_url": "https://example.test/orders",
                    }
                ),
                encoding="utf-8",
            )
            (probe / "strategy.json").write_text(json.dumps({"page_strategy": "mixed", "auth_strategy": "cookie"}), encoding="utf-8")
            (probe / "recommendations.json").write_text(json.dumps({"runtime_actions": ["capture_click_requests"]}), encoding="utf-8")
            (probe / "endpoints.json").write_text(
                json.dumps([{"pattern": "https://example.test/api/orders", "method": "GET", "runtime_action": "none"}]),
                encoding="utf-8",
            )

            service = KnowledgeService(adapters_root=adapters, data_root=root / "knowledge", probes_root=root / "probes")
            result = service.rebuild()
            search = service.search("orders export", adapter_id="demo", task_id="orders", url="https://example.test/orders")

            self.assertGreaterEqual(result["card_count"], 2)
            self.assertTrue((root / "knowledge" / "cards.json").is_file())
            self.assertTrue((root / "knowledge" / "skills" / "demo" / "orders.md").is_file())
            self.assertTrue(search["cards"])
            self.assertTrue(all(card["adapter_id"] == "demo" for card in search["cards"]))

    def test_probe_bundle_redacts_sensitive_capture_and_builds_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "bundle"
            network = {
                "matches": [
                    {
                        "url": "https://example.test/api/orders?token=abc&page=1",
                        "method": "POST",
                        "headers": {"cookie": "secret", "x-safe": "ok"},
                        "postData": "{\"password\":\"secret\",\"page\":1}",
                        "body": "{\"items\":[{\"id\":1,\"title\":\"Order\"}]}",
                        "mimeType": "application/json",
                    }
                ]
            }

            redacted = redact_capture_payload(network)
            bundle = build_probe_bundle(
                output_dir=out,
                adapter_id="demo",
                task_id="orders",
                goal="find orders",
                dom_snapshot={"url": "https://example.test/orders", "title": "Orders", "buttons": [], "table_count": 1},
                framework_snapshot={"framework": {"react": True}, "stores": []},
                passive_capture=redacted,
                interaction_captures=[],
            )

            self.assertEqual(redacted["matches"][0]["headers"]["cookie"], "[REDACTED]")
            self.assertIn("token=%5BREDACTED%5D", redacted["matches"][0]["url"])
            self.assertEqual(bundle["summary"]["endpoint_count"], 1)
            self.assertTrue((out / "manifest.json").is_file())
            self.assertTrue((out / "report.md").read_text(encoding="utf-8").startswith("# Probe Report"))

    def test_probe_bundle_always_redacts_raw_sensitive_capture_before_writing_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "bundle"
            raw_network = {
                "matches": [
                    {
                        "url": "https://example.test/api/orders?token=abc&page=1",
                        "headers": {"Cookie": "session=secret", "x-safe": "ok"},
                        "postData": "{\"csrf\":\"secret\",\"page\":1}",
                        "body": "{\"items\":[{\"id\":1}],\"token\":\"response-secret\"}",
                        "mimeType": "application/json",
                    }
                ]
            }

            build_probe_bundle(
                output_dir=out,
                adapter_id="demo",
                task_id="orders",
                dom_snapshot={"url": "https://example.test/orders", "title": "Orders", "buttons": []},
                passive_capture=raw_network,
                interaction_captures=[],
            )

            network_text = (out / "network.json").read_text(encoding="utf-8")
            self.assertNotIn("session=secret", network_text)
            self.assertNotIn("response-secret", network_text)
            self.assertNotIn("\"token\": \"abc\"", network_text)
            self.assertIn("[REDACTED]", network_text)

    def test_search_rebuilds_when_source_notes_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            adapters = root / "adapters"
            notes = adapters / "demo" / "notes"
            notes.mkdir(parents=True)
            (adapters / "demo" / "manifest.yaml").write_text(
                "id: demo\nname: Demo\nentry_url: https://example.test\ntasks:\n  - id: orders\n    name: Orders\n    script: orders.js\n",
                encoding="utf-8",
            )
            note = notes / "orders-dom-findings-2026-06-14.md"
            note.write_text("# Orders Findings\n\n## Endpoint\n- old endpoint\n", encoding="utf-8")
            service = KnowledgeService(adapters_root=adapters, data_root=root / "knowledge", probes_root=root / "probes")
            service.rebuild()

            note.write_text("# Orders Findings\n\n## Endpoint\n- new fresh endpoint\n", encoding="utf-8")
            search = service.search("fresh", adapter_id="demo", task_id="orders")

            self.assertTrue(search["cards"])
            self.assertIn("new fresh endpoint", search["cards"][0]["content"])


if __name__ == "__main__":
    unittest.main()
