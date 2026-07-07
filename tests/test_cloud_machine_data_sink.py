import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import data_sink


class CloudMachineDataSinkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = patch("core.runtime_paths.data_root", return_value=Path(self.tmp.name))
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()

    def test_save_and_load_cloud_machine_credentials(self):
        saved = data_sink.save_cloud_machine_credentials(
            machine_id="machine-1",
            machine_token="csr_machine_secret",
            machine_name="任务机 1",
            capabilities=["regenerate_ai_image"],
        )
        loaded = data_sink.get_cloud_machine_credentials()

        self.assertEqual(saved["machine_id"], "machine-1")
        self.assertEqual(loaded["machine_token"], "csr_machine_secret")
        self.assertEqual(loaded["capabilities"], ["regenerate_ai_image"])

    def test_record_cloud_job_event(self):
        data_sink.record_cloud_job_event(
            job_uid="job-1",
            event_type="progress",
            message="执行到第 1 款",
            payload={"style_code": "208326105206"},
        )
        events = data_sink.list_cloud_job_events("job-1")

        self.assertEqual(events[0]["event_type"], "progress")
        self.assertEqual(events[0]["payload"]["style_code"], "208326105206")
