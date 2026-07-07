import contextlib
import io
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts import cloud_approval_dry_run


class CloudApprovalDryRunTests(unittest.TestCase):
    def test_fake_dry_run_covers_seed_enroll_sync_regenerate_and_submit(self):
        output = io.StringIO()

        with contextlib.redirect_stdout(output):
            result = cloud_approval_dry_run.main([])

        text = output.getvalue()
        self.assertEqual(result, 0)
        self.assertIn("Phase 1: seed first admin", text)
        self.assertIn("Phase 2: create machine enrollment token", text)
        self.assertIn("Phase 3: enroll fake task machine", text)
        self.assertIn("Phase 4: sync fake local AI batch", text)
        self.assertIn("Phase 5: reject image and create regeneration job", text)
        self.assertIn("Phase 6: approve image and create submit job", text)
        self.assertIn("DRY RUN PASS", text)

    def test_run_fake_dry_run_returns_structured_summary(self):
        summary = cloud_approval_dry_run.run_fake_dry_run(printer=lambda _line: None)

        self.assertIn("seed_admin", summary["instructions"])
        self.assertEqual(summary["enrollment_token"]["enrollment_token"]["status"], "issued")
        self.assertEqual(summary["machine"]["auth_status"], "active")
        self.assertEqual(summary["sync"]["status"], "pending_review")
        self.assertEqual(summary["regeneration_job"]["job_type"], "regenerate_ai_image")
        self.assertEqual(summary["regeneration_job"]["status"], "queued")
        self.assertEqual(summary["submit_job"]["job_type"], "submit_tmall_material_test")
        self.assertEqual(summary["submit_job"]["status"], "queued")

    def test_live_mode_requires_explicit_live_cloud_url(self):
        parser = cloud_approval_dry_run.build_parser()

        args = parser.parse_args([])
        self.assertFalse(args.live_cloud_url)
        self.assertEqual(args.machine_id, "")
        self.assertEqual(args.batch_id, "")

    def test_assertion_failure_returns_non_zero_and_prints_failure(self):
        class BrokenTransport(cloud_approval_dry_run.FakeCloudApprovalTransport):
            def _handle_json(self, method, path, body, token_type):
                if path == "/api/machines/enroll":
                    return 201, {"machine_id": "machine-dry-run-1", "auth_status": "pending_approval", "machine_token": "csr_machine_fake"}
                return super()._handle_json(method, path, body, token_type)

        output = io.StringIO()

        with contextlib.redirect_stdout(output):
            result = cloud_approval_dry_run.run_dry_run(
                transport=BrokenTransport(),
                batch_factory=cloud_approval_dry_run.build_fake_local_batch,
                printer=print,
                machine_id=cloud_approval_dry_run.MACHINE_ID,
                batch_id=cloud_approval_dry_run.DEFAULT_BATCH_ID,
            )

        self.assertEqual(result, 1)
        self.assertIn("DRY RUN FAIL", output.getvalue())

    def test_build_fake_local_batch_creates_uploadable_source_and_ai_assets(self):
        with TemporaryDirectory() as temp_dir:
            batch = cloud_approval_dry_run.build_fake_local_batch(Path(temp_dir))

            self.assertEqual(batch["batch_id"], "cloud-dry-run-batch")
            assets = batch["items"][0]["assets"]
            self.assertEqual([asset["id"] for asset in assets], ["source-main-1", "ai-reject-1", "ai-approve-1"])
            self.assertTrue(Path(assets[0]["path"]).is_file())
            self.assertTrue(Path(assets[1]["path"]).is_file())
            self.assertTrue(Path(assets[2]["path"]).is_file())


if __name__ == "__main__":
    unittest.main()
