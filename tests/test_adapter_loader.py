import json
import os
import tempfile
import unittest
import unittest.mock
from pathlib import Path

from core import adapter_loader


def _write_adapter(root: Path, adapter_id: str = "demo-adapter", version: str = "1.0.0") -> Path:
    adapter_dir = root / adapter_id
    adapter_dir.mkdir(parents=True, exist_ok=True)
    (adapter_dir / "manifest.yaml").write_text(
        "\n".join([
            f"id: {adapter_id}",
            "name: Demo Adapter",
            f"version: {version}",
            "entry_url: https://example.com/app",
            "tasks:",
            "  - id: demo_task",
            "    name: Demo Task",
            "    script: demo.js",
            "    trigger:",
            "      type: manual",
        ]),
        encoding="utf-8",
    )
    (adapter_dir / "demo.js").write_text(";(async () => ({ success: true, data: [], meta: { has_more: false } }))()", encoding="utf-8")
    return adapter_dir


class AdapterLoaderTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.env = {"CRAWSHRIMP_DATA": self.tmpdir.name}
        self._clear_loader_state()

    def tearDown(self):
        self._clear_loader_state()

    def _clear_loader_state(self):
        adapter_loader._adapters.clear()
        adapter_loader._adapter_dirs.clear()
        adapter_loader._enabled.clear()
        adapter_loader._install_meta.clear()

    def test_install_from_dir_copy_persists_metadata(self):
        with unittest.mock.patch.dict(os.environ, self.env, clear=False):
            src_root = Path(self.tmpdir.name) / "src"
            src_root.mkdir(parents=True, exist_ok=True)
            adapter_dir = _write_adapter(src_root)

            manifest = adapter_loader.install_from_dir(str(adapter_dir), install_mode="copy")

            runtime_dir = Path(self.tmpdir.name) / "adapters" / manifest.id
            metadata_path = Path(self.tmpdir.name) / "adapter-meta" / f"{manifest.id}.json"
            self.assertTrue(runtime_dir.exists())
            self.assertFalse(runtime_dir.is_symlink())
            self.assertTrue((runtime_dir / "manifest.yaml").exists())
            self.assertTrue(metadata_path.exists())

            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            self.assertEqual(metadata["install_mode"], "copy")
            self.assertEqual(metadata["source_path"], str(adapter_dir.resolve()))
            self.assertEqual(metadata["runtime_path"], str(runtime_dir.resolve()))

    def test_install_from_dir_link_keeps_source_and_lists_mode(self):
        with unittest.mock.patch.dict(os.environ, self.env, clear=False):
            src_root = Path(self.tmpdir.name) / "src"
            src_root.mkdir(parents=True, exist_ok=True)
            adapter_dir = _write_adapter(src_root, adapter_id="linked-adapter")

            manifest = adapter_loader.install_from_dir(str(adapter_dir), install_mode="link")
            listed = adapter_loader.list_all()
            runtime_dir = Path(self.tmpdir.name) / "adapters" / manifest.id

            self.assertTrue(runtime_dir.is_symlink())
            self.assertEqual(runtime_dir.resolve(), adapter_dir.resolve())
            self.assertEqual(listed[0]["install_mode"], "link")
            self.assertEqual(listed[0]["source_path"], str(adapter_dir.resolve()))

            adapter_loader.uninstall(manifest.id)
            self.assertFalse(runtime_dir.exists())
            self.assertTrue(adapter_dir.exists(), "源码目录不应在卸载 link 安装时被删除")

    def test_install_from_zip_rejects_link_mode(self):
        with unittest.mock.patch.dict(os.environ, self.env, clear=False):
            src_root = Path(self.tmpdir.name) / "src"
            src_root.mkdir(parents=True, exist_ok=True)
            adapter_dir = _write_adapter(src_root, adapter_id="zip-adapter")
            zip_path = Path(self.tmpdir.name) / "zip-adapter.zip"
            import zipfile

            with zipfile.ZipFile(zip_path, "w") as zf:
                for path in adapter_dir.rglob("*"):
                    zf.write(path, arcname=f"{adapter_dir.name}/{path.relative_to(adapter_dir)}")

            with self.assertRaisesRegex(ValueError, "ZIP 安装暂不支持 link"):
                adapter_loader.install_from_zip(str(zip_path), install_mode="link")

    def test_preserve_existing_link_skips_copy_overwrite(self):
        with unittest.mock.patch.dict(os.environ, self.env, clear=False):
            src_root = Path(self.tmpdir.name) / "src"
            src_root.mkdir(parents=True, exist_ok=True)
            adapter_dir = _write_adapter(src_root, adapter_id="preserve-adapter", version="1.0.0")

            adapter_loader.install_from_dir(str(adapter_dir), install_mode="link")
            adapter_dir.joinpath("manifest.yaml").write_text(
                adapter_dir.joinpath("manifest.yaml").read_text(encoding="utf-8").replace("version: 1.0.0", "version: 2.0.0"),
                encoding="utf-8",
            )

            manifest = adapter_loader.install_from_dir(str(adapter_dir), install_mode="copy", preserve_existing_link=True)
            runtime_dir = Path(self.tmpdir.name) / "adapters" / manifest.id

            self.assertTrue(runtime_dir.is_symlink())
            self.assertEqual(manifest.version, "2.0.0")
            self.assertEqual(adapter_loader.get_install_metadata(manifest.id)["install_mode"], "link")

    def test_preserve_existing_link_uses_linked_manifest_not_packaged_manifest(self):
        with unittest.mock.patch.dict(os.environ, self.env, clear=False):
            src_root = Path(self.tmpdir.name) / "src"
            src_root.mkdir(parents=True, exist_ok=True)
            linked_dir = _write_adapter(src_root, adapter_id="linked-manifest-adapter", version="4.0.0")
            packaged_dir = _write_adapter(src_root, adapter_id="packaged-linked-manifest-adapter", version="1.0.0")
            packaged_manifest = packaged_dir / "manifest.yaml"
            packaged_manifest.write_text(
                packaged_manifest.read_text(encoding="utf-8").replace(
                    "id: packaged-linked-manifest-adapter",
                    "id: linked-manifest-adapter",
                ),
                encoding="utf-8",
            )

            adapter_loader.install_from_dir(str(linked_dir), install_mode="link")
            manifest = adapter_loader.install_from_dir(str(packaged_dir), install_mode="copy", preserve_existing_link=True)

            self.assertEqual(manifest.version, "4.0.0")
            self.assertEqual(adapter_loader.get_adapter(manifest.id).version, "4.0.0")
            self.assertTrue((Path(self.tmpdir.name) / "adapters" / manifest.id).is_symlink())

    def test_stale_link_metadata_does_not_preserve_regular_directory(self):
        with unittest.mock.patch.dict(os.environ, self.env, clear=False):
            src_root = Path(self.tmpdir.name) / "src"
            src_root.mkdir(parents=True, exist_ok=True)
            packaged_dir = _write_adapter(src_root, adapter_id="stale-link-adapter", version="2.0.0")

            runtime_dir = Path(self.tmpdir.name) / "adapters" / "stale-link-adapter"
            runtime_dir.mkdir(parents=True, exist_ok=True)
            (runtime_dir / "manifest.yaml").write_text(
                packaged_dir.joinpath("manifest.yaml").read_text(encoding="utf-8").replace("version: 2.0.0", "version: 1.0.0"),
                encoding="utf-8",
            )
            (runtime_dir / "demo.js").write_text("old", encoding="utf-8")
            metadata_path = Path(self.tmpdir.name) / "adapter-meta" / "stale-link-adapter.json"
            metadata_path.parent.mkdir(parents=True, exist_ok=True)
            metadata_path.write_text(
                json.dumps({
                    "adapter_id": "stale-link-adapter",
                    "install_mode": "link",
                    "runtime_path": str(runtime_dir),
                    "source_path": "/missing/source",
                }),
                encoding="utf-8",
            )

            manifest = adapter_loader.install_from_dir(str(packaged_dir), install_mode="copy", preserve_existing_link=True)

            self.assertFalse(runtime_dir.is_symlink())
            self.assertEqual(manifest.version, "2.0.0")
            self.assertIn("success: true", (runtime_dir / "demo.js").read_text(encoding="utf-8"))
            self.assertEqual(adapter_loader.get_install_metadata(manifest.id)["install_mode"], "copy")

    def test_packaged_copy_does_not_downgrade_newer_installed_copy(self):
        with unittest.mock.patch.dict(os.environ, self.env, clear=False):
            src_root = Path(self.tmpdir.name) / "src"
            src_root.mkdir(parents=True, exist_ok=True)
            old_packaged_dir = _write_adapter(src_root, adapter_id="newer-copy-adapter", version="1.0.0")
            newer_user_dir = _write_adapter(src_root, adapter_id="newer-copy-adapter-user", version="3.0.0")
            newer_user_dir.rename(src_root / "newer-copy-adapter-user-src")
            newer_user_dir = src_root / "newer-copy-adapter-user-src"
            newer_manifest = newer_user_dir / "manifest.yaml"
            newer_manifest.write_text(
                newer_manifest.read_text(encoding="utf-8").replace("id: newer-copy-adapter-user", "id: newer-copy-adapter"),
                encoding="utf-8",
            )

            adapter_loader.install_from_dir(str(newer_user_dir), install_mode="copy")
            runtime_dir = Path(self.tmpdir.name) / "adapters" / "newer-copy-adapter"
            (runtime_dir / "demo.js").write_text("newer", encoding="utf-8")

            manifest = adapter_loader.install_from_dir(str(old_packaged_dir), install_mode="copy", preserve_existing_link=True)

            self.assertEqual(manifest.version, "3.0.0")
            self.assertEqual((runtime_dir / "demo.js").read_text(encoding="utf-8"), "newer")


if __name__ == "__main__":
    unittest.main()
