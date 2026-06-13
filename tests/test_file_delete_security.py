import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from core import api_server


class FileDeleteSecurityTests(unittest.TestCase):
    def test_delete_files_rejects_paths_outside_runtime_data_root(self):
        with tempfile.TemporaryDirectory() as data_dir:
            with tempfile.TemporaryDirectory() as outside_dir:
                outside_file = Path(outside_dir) / "keep.txt"
                outside_file.write_text("important", encoding="utf-8")

                with patch("core.api_server.runtime_paths.data_root", return_value=Path(data_dir)):
                    with self.assertRaises(HTTPException) as ctx:
                        api_server.delete_files(api_server.DeleteFilesRequest(paths=[str(outside_file)]))

                self.assertEqual(ctx.exception.status_code, 400)
                self.assertTrue(outside_file.exists())

    def test_delete_files_allows_paths_inside_runtime_data_root(self):
        with tempfile.TemporaryDirectory() as data_dir:
            target = Path(data_dir) / "exports" / "old.xlsx"
            target.parent.mkdir(parents=True)
            target.write_text("old", encoding="utf-8")

            with patch("core.api_server.runtime_paths.data_root", return_value=Path(data_dir)):
                with patch("core.api_server.data_sink.is_output_file_path", return_value=True):
                    with patch("core.api_server.data_sink.remove_output_files", return_value={"updated_runs": 0, "removed_refs": 1}):
                        result = api_server.delete_files(api_server.DeleteFilesRequest(paths=[str(target)]))

            self.assertTrue(result["ok"])
            self.assertFalse(target.exists())

    def test_delete_files_rejects_unregistered_file_inside_runtime_data_root(self):
        with tempfile.TemporaryDirectory() as data_dir:
            target = Path(data_dir) / "config.json"
            target.write_text("important", encoding="utf-8")

            with patch("core.api_server.runtime_paths.data_root", return_value=Path(data_dir)):
                with patch("core.api_server.data_sink.is_output_file_path", return_value=False):
                    with self.assertRaises(HTTPException) as ctx:
                        api_server.delete_files(api_server.DeleteFilesRequest(paths=[str(target)]))

            self.assertEqual(ctx.exception.status_code, 400)
            self.assertTrue(target.exists())

    def test_delete_files_rejects_runtime_data_root_itself(self):
        with tempfile.TemporaryDirectory() as data_dir:
            marker = Path(data_dir) / "keep.txt"
            marker.write_text("important", encoding="utf-8")

            with patch("core.api_server.runtime_paths.data_root", return_value=Path(data_dir)):
                with self.assertRaises(HTTPException) as ctx:
                    api_server.delete_files(api_server.DeleteFilesRequest(paths=[str(data_dir)]))

            self.assertEqual(ctx.exception.status_code, 400)
            self.assertTrue(marker.exists())


if __name__ == "__main__":
    unittest.main()
