import tempfile
import unittest
from pathlib import Path

import yaml

from core.api_server import _finalize_plm_size_chart_downloader_outputs


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "adapters" / "plm-ops-assistant" / "manifest.yaml"


class PlmSizeChartExportDirTests(unittest.TestCase):
    def test_manifest_declares_optional_output_directory(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
        task = next(item for item in manifest["tasks"] if item["id"] == "size_chart_downloader")
        params = {item["id"]: item for item in task["params"]}

        self.assertEqual(params["output_dir"]["type"], "directory")
        self.assertIn("导出目录", params["output_dir"]["label"])
        self.assertIn("最终 Excel", params["output_dir"]["hint"])

    def test_finalize_copies_exported_excel_to_selected_output_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            export_dir = base / "exports"
            runtime_dir.mkdir()
            exported = runtime_dir / "PLM尺码表下载_大货.xlsx"
            exported.write_bytes(b"excel")

            result = _finalize_plm_size_chart_downloader_outputs(
                runtime_files=[],
                exported_files=[str(exported)],
                run_params={"output_dir": str(export_dir)},
                log=lambda _: None,
            )

            copied = export_dir / exported.name
            self.assertEqual(result, [str(copied)])
            self.assertTrue(copied.is_file())
            self.assertTrue(exported.is_file())

    def test_finalize_keeps_runtime_export_when_output_dir_is_blank(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            exported = Path(tmpdir) / "PLM尺码表下载_大货.xlsx"
            exported.write_bytes(b"excel")

            result = _finalize_plm_size_chart_downloader_outputs(
                runtime_files=[],
                exported_files=[str(exported)],
                run_params={},
                log=lambda _: None,
            )

            self.assertEqual(result, [str(exported)])

    def test_finalize_uses_unique_name_when_selected_dir_has_existing_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            export_dir = base / "exports"
            runtime_dir.mkdir()
            export_dir.mkdir()
            exported = runtime_dir / "PLM尺码表下载_大货.xlsx"
            exported.write_bytes(b"excel")
            existing = export_dir / exported.name
            existing.write_bytes(b"old")

            result = _finalize_plm_size_chart_downloader_outputs(
                runtime_files=[],
                exported_files=[str(exported)],
                run_params={"output_dir": str(export_dir)},
                log=lambda _: None,
            )

            copied = export_dir / "PLM尺码表下载_大货_2.xlsx"
            self.assertEqual(result, [str(copied)])
            self.assertEqual(existing.read_bytes(), b"old")
            self.assertEqual(copied.read_bytes(), b"excel")


if __name__ == "__main__":
    unittest.main()
