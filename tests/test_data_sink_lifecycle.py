import os
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
