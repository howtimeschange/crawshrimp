import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import data_sink


class DataSinkLifecycleTests(unittest.TestCase):
    def test_stop_orphaned_active_runs_marks_only_active_runs(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.dict(os.environ, {"CRAWSHRIMP_DATA": tmpdir}, clear=False):
                data_sink.init_db()
                active_id = data_sink.begin_run("adapter", "active")
                done_id = data_sink.begin_run("adapter", "done")
                data_sink.finish_run(done_id, 2, [])

                updated = data_sink.stop_orphaned_active_runs("backend restarted")

                self.assertEqual(updated, 1)
                active = data_sink.get_latest_run("adapter", "active")
                done = data_sink.get_latest_run("adapter", "done")
                self.assertEqual(active["id"], active_id)
                self.assertEqual(active["status"], "stopped")
                self.assertEqual(active["error"], "backend restarted")
                self.assertEqual(done["status"], "done")

    def test_finish_run_clears_stale_error_from_orphan_marker(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.dict(os.environ, {"CRAWSHRIMP_DATA": tmpdir}, clear=False):
                data_sink.init_db()
                run_id = data_sink.begin_run("adapter", "task")
                data_sink.stop_orphaned_active_runs("backend restarted")

                data_sink.finish_run(run_id, 3, ["/tmp/result.xlsx"])

                run = data_sink.get_latest_run("adapter", "task")
                self.assertEqual(run["status"], "done")
                self.assertEqual(run["records_count"], 3)
                self.assertFalse(run["error"])

    def test_export_excel_shortens_long_temu_product_title_filename(self):
        long_title = (
            "Balabala Kids' Shoes Children's Sports Sandals, Boys' Summer New Closed-Toe "
            "Comfort & Soft Sole Toddlers Shoes, Cute LittleOcto First Walkers for "
            "Everyday Beach Casual Wear"
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.dict(os.environ, {"CRAWSHRIMP_DATA": tmpdir}, clear=False):
                output_path = data_sink.export_excel(
                    [{"商品ID": "601102594063699", "评价内容": "ok"}],
                    "temu",
                    "single_product_reviews",
                    filename_template="{shop_name}_单款商品评价_{goods_id}_{timestamp}.xlsx",
                    filename_vars={
                        "shop_name": long_title,
                        "goods_id": "601102594063699",
                    },
                )

        output_name = Path(output_path).name
        self.assertLessEqual(len(output_name), 140)
        self.assertTrue(output_name.endswith(".xlsx"))
        self.assertIn("601102594063699", output_name)

    def test_init_db_uses_local_app_data_default_root(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            home_dir = Path(tmpdir) / "home"
            local_app_data = Path(tmpdir) / "local-app-data"
            runtime_root = local_app_data / "crawshrimp"

            with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data)}, clear=False):
                os.environ.pop("CRAWSHRIMP_DATA", None)
                with patch("pathlib.Path.home", return_value=home_dir):
                    with patch("sys.platform", "win32"):
                        data_sink.init_db()

            self.assertTrue((runtime_root / "crawshrimp.db").exists())


if __name__ == "__main__":
    unittest.main()
