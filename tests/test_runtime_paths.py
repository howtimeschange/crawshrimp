import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import runtime_paths


class RuntimePathsTests(unittest.TestCase):
    def tearDown(self):
        runtime_paths.reset_runtime_data_root_cache()

    def test_default_data_root_prefers_local_app_data_when_available(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            home_dir = Path(tmpdir) / "home"
            local_app_data = Path(tmpdir) / "local-app-data"

            with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data)}, clear=False):
                os.environ.pop("CRAWSHRIMP_DATA", None)
                with patch("pathlib.Path.home", return_value=home_dir):
                    with patch("sys.platform", "win32"):
                        root = runtime_paths.data_root()

            self.assertEqual(root, local_app_data / "crawshrimp")
            self.assertTrue(root.exists())

    def test_windows_preserves_existing_legacy_runtime_root(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            home_dir = Path(tmpdir) / "home"
            local_app_data = Path(tmpdir) / "local-app-data"
            legacy_root = home_dir / ".crawshrimp"
            (legacy_root / "adapters" / "temu").mkdir(parents=True)

            with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data)}, clear=False):
                os.environ.pop("CRAWSHRIMP_DATA", None)
                with patch("pathlib.Path.home", return_value=home_dir):
                    with patch("sys.platform", "win32"):
                        root = runtime_paths.data_root()

            self.assertEqual(root, legacy_root)
            self.assertFalse((local_app_data / "crawshrimp").exists())

    def test_windows_falls_back_to_local_app_data_when_legacy_root_is_not_writable(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            home_dir = Path(tmpdir) / "home"
            local_app_data = Path(tmpdir) / "local-app-data"
            legacy_root = home_dir / ".crawshrimp"
            preferred_root = local_app_data / "crawshrimp"
            (legacy_root / "adapters" / "temu").mkdir(parents=True)
            original_write_text = Path.write_text

            def guarded_write_text(path, *args, **kwargs):
                if str(path).startswith(str(legacy_root)):
                    raise PermissionError("[WinError 5] Access is denied")
                return original_write_text(path, *args, **kwargs)

            with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data)}, clear=False):
                os.environ.pop("CRAWSHRIMP_DATA", None)
                with patch("pathlib.Path.home", return_value=home_dir):
                    with patch("sys.platform", "win32"):
                        with patch.object(Path, "write_text", guarded_write_text):
                            root = runtime_paths.data_root()

            self.assertEqual(root, preferred_root)

    def test_default_data_root_prefers_macos_application_support_when_local_app_data_is_absent(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            home_dir = Path(tmpdir) / "home"

            with patch.dict(os.environ, {}, clear=True):
                with patch("pathlib.Path.home", return_value=home_dir):
                    with patch("sys.platform", "darwin"):
                        root = runtime_paths.data_root()

            self.assertEqual(root, home_dir / "Library" / "Application Support" / "crawshrimp")
            self.assertTrue(root.exists())

    def test_macos_preserves_existing_legacy_runtime_root(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            home_dir = Path(tmpdir) / "home"
            legacy_root = home_dir / ".crawshrimp"
            (legacy_root / "adapters" / "temu").mkdir(parents=True)

            with patch.dict(os.environ, {}, clear=True):
                with patch("pathlib.Path.home", return_value=home_dir):
                    with patch("sys.platform", "darwin"):
                        root = runtime_paths.data_root()

            self.assertEqual(root, legacy_root)

    def test_macos_falls_back_to_application_support_when_legacy_root_is_not_writable(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            home_dir = Path(tmpdir) / "home"
            legacy_root = home_dir / ".crawshrimp"
            preferred_root = home_dir / "Library" / "Application Support" / "crawshrimp"
            (legacy_root / "adapters" / "temu").mkdir(parents=True)
            original_write_text = Path.write_text

            def guarded_write_text(path, *args, **kwargs):
                if str(path).startswith(str(legacy_root)):
                    raise PermissionError("[Errno 13] Permission denied")
                return original_write_text(path, *args, **kwargs)

            with patch.dict(os.environ, {}, clear=True):
                with patch("pathlib.Path.home", return_value=home_dir):
                    with patch("sys.platform", "darwin"):
                        with patch.object(Path, "write_text", guarded_write_text):
                            root = runtime_paths.data_root()

            self.assertEqual(root, preferred_root)

    def test_default_data_root_uses_home_dot_dir_on_non_macos_without_local_app_data(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            home_dir = Path(tmpdir) / "home"

            with patch.dict(os.environ, {}, clear=True):
                with patch("pathlib.Path.home", return_value=home_dir):
                    with patch("sys.platform", "linux"):
                        root = runtime_paths.data_root()

            self.assertEqual(root, home_dir / ".crawshrimp")
            self.assertTrue(root.exists())

    def test_default_data_root_ignores_local_app_data_on_non_windows(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            home_dir = Path(tmpdir) / "home"
            local_app_data = Path(tmpdir) / "local-app-data"

            with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data)}, clear=False):
                os.environ.pop("CRAWSHRIMP_DATA", None)
                with patch("pathlib.Path.home", return_value=home_dir):
                    with patch("sys.platform", "darwin"):
                        root = runtime_paths.data_root()

            self.assertEqual(root, home_dir / "Library" / "Application Support" / "crawshrimp")
            self.assertFalse((local_app_data / "crawshrimp").exists())

    def test_default_data_root_falls_back_to_home_when_macos_application_support_is_not_writable(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            home_dir = Path(tmpdir) / "home"
            preferred_root = home_dir / "Library" / "Application Support" / "crawshrimp"
            fallback_root = home_dir / ".crawshrimp"
            original_mkdir = Path.mkdir

            def guarded_mkdir(path, *args, **kwargs):
                if path == preferred_root:
                    raise PermissionError("[Errno 13] Permission denied")
                return original_mkdir(path, *args, **kwargs)

            with patch.dict(os.environ, {}, clear=True):
                with patch("pathlib.Path.home", return_value=home_dir):
                    with patch("sys.platform", "darwin"):
                        with patch.object(Path, "mkdir", guarded_mkdir):
                            root = runtime_paths.data_root()

            self.assertEqual(root, fallback_root)
            self.assertTrue(fallback_root.exists())

    def test_default_data_root_falls_back_to_home_when_local_app_data_is_not_writable(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            home_dir = Path(tmpdir) / "home"
            local_app_data = Path(tmpdir) / "local-app-data"
            preferred_root = local_app_data / "crawshrimp"
            fallback_root = home_dir / ".crawshrimp"
            original_mkdir = Path.mkdir

            def guarded_mkdir(path, *args, **kwargs):
                if path == preferred_root:
                    raise PermissionError("[WinError 5] Access is denied")
                return original_mkdir(path, *args, **kwargs)

            with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data)}, clear=False):
                os.environ.pop("CRAWSHRIMP_DATA", None)
                with patch("pathlib.Path.home", return_value=home_dir):
                    with patch("sys.platform", "win32"):
                        with patch.object(Path, "mkdir", guarded_mkdir):
                            root = runtime_paths.data_root()

            self.assertEqual(root, fallback_root)
            self.assertTrue(fallback_root.exists())

    def test_default_data_root_falls_back_when_existing_local_app_data_root_is_not_writable(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            home_dir = Path(tmpdir) / "home"
            local_app_data = Path(tmpdir) / "local-app-data"
            preferred_root = local_app_data / "crawshrimp"
            fallback_root = home_dir / ".crawshrimp"
            preferred_root.mkdir(parents=True)
            original_write_text = Path.write_text

            def guarded_write_text(path, *args, **kwargs):
                if str(path).startswith(str(preferred_root)):
                    raise PermissionError("[WinError 5] Access is denied")
                return original_write_text(path, *args, **kwargs)

            with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data)}, clear=False):
                os.environ.pop("CRAWSHRIMP_DATA", None)
                with patch("pathlib.Path.home", return_value=home_dir):
                    with patch("sys.platform", "win32"):
                        with patch.object(Path, "write_text", guarded_write_text):
                            root = runtime_paths.data_root()

            self.assertEqual(root, fallback_root)
            self.assertTrue(fallback_root.exists())

    def test_explicit_data_root_failure_does_not_silently_fallback(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            explicit_root = Path(tmpdir) / "configured"
            local_app_data = Path(tmpdir) / "local-app-data"
            original_mkdir = Path.mkdir

            def guarded_mkdir(path, *args, **kwargs):
                if path == explicit_root:
                    raise PermissionError("[WinError 5] Access is denied")
                return original_mkdir(path, *args, **kwargs)

            with patch.dict(os.environ, {"CRAWSHRIMP_DATA": str(explicit_root), "LOCALAPPDATA": str(local_app_data)}, clear=False):
                with patch.object(Path, "mkdir", guarded_mkdir):
                    with self.assertRaisesRegex(PermissionError, "CRAWSHRIMP_DATA"):
                        runtime_paths.data_root()

            self.assertFalse((local_app_data / "crawshrimp").exists())

    def test_child_dir_reuses_selected_local_app_data_root(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            home_dir = Path(tmpdir) / "home"
            local_app_data = Path(tmpdir) / "local-app-data"
            runtime_root = local_app_data / "crawshrimp"

            with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data)}, clear=False):
                os.environ.pop("CRAWSHRIMP_DATA", None)
                with patch("pathlib.Path.home", return_value=home_dir):
                    with patch("sys.platform", "win32"):
                        adapters = runtime_paths.child_dir("adapters")
                        metadata = runtime_paths.child_dir("adapter-meta")

            self.assertEqual(adapters, runtime_root / "adapters")
            self.assertEqual(metadata, runtime_root / "adapter-meta")

    def test_child_dir_falls_back_to_home_when_local_app_data_child_is_not_writable(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            home_dir = Path(tmpdir) / "home"
            local_app_data = Path(tmpdir) / "local-app-data"
            preferred_child = local_app_data / "crawshrimp" / "adapters"
            fallback_child = home_dir / ".crawshrimp" / "adapters"
            original_mkdir = Path.mkdir

            def guarded_mkdir(path, *args, **kwargs):
                if path == preferred_child:
                    raise PermissionError("[WinError 5] Access is denied")
                return original_mkdir(path, *args, **kwargs)

            with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data)}, clear=False):
                os.environ.pop("CRAWSHRIMP_DATA", None)
                with patch("pathlib.Path.home", return_value=home_dir):
                    with patch("sys.platform", "win32"):
                        with patch.object(Path, "mkdir", guarded_mkdir):
                            adapters = runtime_paths.child_dir("adapters")

            self.assertEqual(adapters, fallback_child)
            self.assertTrue(fallback_child.exists())

    def test_child_dir_can_resolve_without_creating_child(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.dict(os.environ, {"CRAWSHRIMP_DATA": tmpdir}, clear=False):
                probes = runtime_paths.child_dir("probes", create=False)

            self.assertEqual(probes, Path(tmpdir) / "probes")
            self.assertFalse(probes.exists())

    def test_cache_refreshes_when_environment_changes(self):
        with tempfile.TemporaryDirectory() as first:
            with tempfile.TemporaryDirectory() as second:
                with patch.dict(os.environ, {"CRAWSHRIMP_DATA": first}, clear=False):
                    self.assertEqual(runtime_paths.data_root(), Path(first))
                with patch.dict(os.environ, {"CRAWSHRIMP_DATA": second}, clear=False):
                    self.assertEqual(runtime_paths.data_root(), Path(second))


if __name__ == "__main__":
    unittest.main()
