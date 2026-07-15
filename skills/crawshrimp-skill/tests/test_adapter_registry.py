import json
import tempfile
import unittest
from pathlib import Path

from scripts.adapter_registry import AdapterRegistry, run_auth_check
from scripts.browser_executor import BrowserResult


class FakeBackend:
    def __init__(self, result=None):
        self.actions = []
        self.result = result or BrowserResult(
            ok=True,
            action="eval",
            data={"value": {"success": True, "data": [{"logged_in": True}], "meta": {"has_more": False}}},
        )

    def execute(self, action):
        self.actions.append(action)
        return self.result


class AdapterRegistryTest(unittest.TestCase):
    def test_scans_manifest_tasks_and_auth_script(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            adapter = root / "demo"
            adapter.mkdir()
            (adapter / "auth_check.js").write_text("return { success: true, data: [] }", encoding="utf-8")
            (adapter / "orders.js").write_text("return { success: true, data: [] }", encoding="utf-8")
            (adapter / "manifest.yaml").write_text(
                "\n".join(
                    [
                        "id: demo",
                        "name: Demo Adapter",
                        "version: 1.2.3",
                        "entry_url: https://seller.example.test",
                        "auth:",
                        "  check_script: auth_check.js",
                        "  login_url: https://seller.example.test/login",
                        "tasks:",
                        "  - id: orders",
                        "    name: Orders",
                        "    script: orders.js",
                        "    entry_url: https://seller.example.test/orders",
                    ]
                ),
                encoding="utf-8",
            )

            registry = AdapterRegistry(root)
            registry.scan()

            self.assertEqual([item["id"] for item in registry.list_adapters()], ["demo"])
            self.assertEqual(registry.get_task("demo", "orders")["script"], "orders.js")
            self.assertEqual(registry.resolve_task_script("demo", "orders"), (adapter / "orders.js").resolve())
            self.assertEqual(registry.resolve_auth_script("demo"), (adapter / "auth_check.js").resolve())

    def test_rejects_adapter_file_path_escape(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            adapter = root / "demo"
            adapter.mkdir()
            (adapter / "manifest.yaml").write_text(
                "id: demo\nname: Demo\nentry_url: https://example.test\ntasks:\n  - id: bad\n    name: Bad\n    script: ../bad.js\n",
                encoding="utf-8",
            )
            registry = AdapterRegistry(root)
            registry.scan()

            with self.assertRaises(ValueError):
                registry.resolve_task_script("demo", "bad")

    def test_run_auth_check_executes_manifest_auth_script(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            adapter = root / "demo"
            adapter.mkdir()
            (adapter / "auth_check.js").write_text("return { success: true, data: [{ logged_in: true }] }", encoding="utf-8")
            (adapter / "manifest.yaml").write_text(
                "id: demo\nname: Demo\nentry_url: https://example.test\nauth:\n  check_script: auth_check.js\n",
                encoding="utf-8",
            )
            registry = AdapterRegistry(root)
            registry.scan()
            backend = FakeBackend()

            result = run_auth_check(registry, "demo", backend=backend)

            self.assertTrue(result["ok"])
            self.assertEqual(result["adapter_id"], "demo")
            self.assertEqual(backend.actions[0].kind, "eval")
            self.assertIn("__CRAWSHRIMP_AUTH_CHECK__", backend.actions[0].script)

    def test_run_auth_check_requires_logged_in_true(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            adapter = root / "demo"
            adapter.mkdir()
            (adapter / "auth_check.js").write_text("return { success: true, data: [{ logged_in: false }] }", encoding="utf-8")
            (adapter / "manifest.yaml").write_text(
                "id: demo\nname: Demo\nentry_url: https://example.test\nauth:\n  check_script: auth_check.js\n",
                encoding="utf-8",
            )
            registry = AdapterRegistry(root)
            registry.scan()
            backend = FakeBackend(
                BrowserResult(
                    ok=True,
                    action="eval",
                    data={"value": {"success": True, "data": [{"logged_in": False}], "meta": {"logged_in": False}}},
                )
            )

            result = run_auth_check(registry, "demo", backend=backend)

            self.assertFalse(result["ok"])
            self.assertIn("not logged in", result["error"])

    def test_persists_enabled_state_and_install_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "adapters"
            source = Path(tmp) / "source"
            source.mkdir()
            (source / "orders.js").write_text("return { success: true, data: [] }", encoding="utf-8")
            (source / "manifest.yaml").write_text(
                "id: demo\nname: Demo\nversion: 2.0.0\nentry_url: https://example.test\ntasks:\n  - id: orders\n    name: Orders\n    script: orders.js\n",
                encoding="utf-8",
            )
            registry = AdapterRegistry(root)

            installed = registry.install_from_dir(source, mode="copy")
            registry.set_enabled("demo", False)
            reloaded = AdapterRegistry(root)

            adapters = reloaded.list_adapters()
            state = json.loads((root / "registry_state.json").read_text(encoding="utf-8"))

            self.assertEqual(installed["id"], "demo")
            self.assertFalse(adapters[0]["enabled"])
            self.assertEqual(adapters[0]["install_mode"], "copy")
            self.assertEqual(adapters[0]["installed_version"], "2.0.0")
            self.assertEqual(state["adapters"]["demo"]["source_path"], str(source.resolve()))


if __name__ == "__main__":
    unittest.main()
