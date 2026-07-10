import tempfile
import unittest
import os
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

    @unittest.skipIf(os.name != "posix", "POSIX file modes only")
    def test_cloud_credentials_database_is_owner_only(self):
        data_sink.save_cloud_machine_credentials(
            machine_id="machine-1",
            machine_token="csr_machine_secret",
            machine_name="任务机 1",
            capabilities=["regenerate_ai_image"],
        )
        db_path = Path(self.tmp.name) / "crawshrimp.db"

        self.assertEqual(db_path.stat().st_mode & 0o777, 0o600)

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

    def test_completion_outbox_round_trips_lease_result_and_retry_state(self):
        saved = data_sink.save_pending_cloud_job_completion(
            "job-1",
            "lease-1",
            {"submitted": 1},
            last_error="gateway timeout",
        )

        self.assertEqual(saved["job_uid"], "job-1")
        self.assertEqual(saved["lease_id"], "lease-1")
        self.assertEqual(saved["result"], {"submitted": 1})
        self.assertEqual(saved["last_error"], "gateway timeout")
        self.assertEqual(saved["attempt_count"], 0)
        self.assertEqual(saved["next_attempt_at"], "")
        self.assertEqual(data_sink.list_pending_cloud_job_completions(), [saved])

        data_sink.mark_pending_cloud_job_completion_attempt(
            "job-1",
            "still unavailable",
            "2099-01-01T00:00:00+00:00",
        )

        self.assertEqual(data_sink.list_pending_cloud_job_completions(), [])
        with patch("core.data_sink._utc_now_iso", return_value="2100-01-01T00:00:00+00:00"):
            retried = data_sink.list_pending_cloud_job_completions()[0]
        self.assertEqual(retried["attempt_count"], 1)
        self.assertEqual(retried["last_error"], "still unavailable")
        self.assertEqual(retried["next_attempt_at"], "2099-01-01T00:00:00+00:00")

    def test_completion_outbox_migrates_legacy_rows_without_rebinding_a_lease(self):
        with data_sink._get_conn() as conn:
            conn.execute("DROP TABLE cloud_job_completion_results")
            conn.execute(
                """
                CREATE TABLE cloud_job_completion_results (
                    job_uid TEXT PRIMARY KEY,
                    result_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                INSERT INTO cloud_job_completion_results (job_uid, result_json, created_at, updated_at)
                VALUES ('legacy-job', '{"ok": true}', '2026-01-01T00:00:00', '2026-01-01T00:00:00')
                """
            )
            conn.commit()

        data_sink.init_db()

        with data_sink._get_conn() as conn:
            columns = {row["name"] for row in conn.execute("PRAGMA table_info(cloud_job_completion_results)")}
        self.assertTrue({"lease_id", "last_error", "attempt_count", "next_attempt_at"}.issubset(columns))
        legacy = data_sink.list_pending_cloud_job_completions()[0]
        self.assertEqual(legacy["job_uid"], "legacy-job")
        self.assertEqual(legacy["lease_id"], "")
        self.assertEqual(legacy["result"], {"ok": True})
