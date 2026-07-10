import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import data_sink
from core.cloud_approval_client import CloudApprovalError
from core.cloud_machine_agent import CloudMachineAgent


class FakeClient:
    def __init__(self, responses=None):
        self.responses = list(responses or [])
        self.calls = []
        self.machine_token = ""

    def request_json(self, method, path, body=None, *, token_type="machine"):
        self.calls.append(
            {
                "method": method,
                "path": path,
                "body": dict(body or {}),
                "token_type": token_type,
                "machine_token": self.machine_token,
            }
        )
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class StopAfterSleeps:
    def __init__(self, sleep_log, limit):
        self.sleep_log = sleep_log
        self.limit = limit

    def is_set(self):
        return len(self.sleep_log) >= self.limit


class CloudMachineAgentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = patch("core.runtime_paths.data_root", return_value=Path(self.tmp.name))
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()

    def test_enrollment_stores_returned_machine_credentials(self):
        client = FakeClient(
            [
                {
                    "machine_id": "machine-cloud-1",
                    "auth_status": "active",
                    "machine_token": "csr_machine_secret",
                }
            ]
        )
        agent = CloudMachineAgent(
            client,
            app_version="1.4.38",
            machine_id_factory=lambda: "local-machine-1",
            fingerprint_factory=lambda: "fingerprint-1",
        )

        result = agent.enroll(
            registration_token="admin-issued-token",
            machine_name="设计部任务机",
            capabilities=["regenerate_ai_image"],
        )
        saved = data_sink.get_cloud_machine_credentials()

        self.assertEqual(result["machine_id"], "machine-cloud-1")
        self.assertEqual(saved["machine_id"], "machine-cloud-1")
        self.assertEqual(saved["machine_token"], "csr_machine_secret")
        self.assertEqual(saved["machine_name"], "设计部任务机")
        self.assertEqual(saved["capabilities"], ["regenerate_ai_image"])
        self.assertEqual(client.machine_token, "csr_machine_secret")
        self.assertEqual(
            client.calls[0]["body"],
            {
                "enrollment_token": "admin-issued-token",
                "machine_id": "local-machine-1",
                "machine_name": "设计部任务机",
                "fingerprint": "fingerprint-1",
                "app_version": "1.4.38",
                "capabilities": ["regenerate_ai_image"],
            },
        )

    def test_enrollment_is_skipped_when_client_already_has_credentials(self):
        data_sink.save_cloud_machine_credentials(
            machine_id="machine-existing",
            machine_token="csr_machine_existing",
            machine_name="既有任务机",
            capabilities=["regenerate_ai_image"],
        )
        client = FakeClient([])
        agent = CloudMachineAgent(client)

        result = agent.enroll(
            registration_token="new-admin-token",
            machine_name="重复任务机",
            capabilities=["regenerate_ai_image"],
        )

        self.assertEqual(result["machine_id"], "machine-existing")
        self.assertTrue(result["already_enrolled"])
        self.assertEqual(client.machine_token, "csr_machine_existing")
        self.assertEqual(client.calls, [])

    def test_default_machine_id_is_stable_for_the_same_fingerprint(self):
        with patch.object(CloudMachineAgent, "_default_fingerprint", return_value="host:arm64:Darwin:123"):
            first = CloudMachineAgent._default_machine_id()
            second = CloudMachineAgent._default_machine_id()

        self.assertEqual(first, second)
        self.assertTrue(first.startswith("csr-machine-"))
        self.assertNotEqual(first, "host:arm64:Darwin:123")

    def test_heartbeat_sends_app_health_capabilities_and_current_job_id(self):
        data_sink.save_cloud_machine_credentials(
            machine_id="machine-1",
            machine_token="csr_machine_secret",
            machine_name="任务机",
            capabilities=["tmall_ai_image_test"],
        )
        health_updates = []
        client = FakeClient([{"ok": True, "machine_id": "machine-1", "auth_status": "active", "health": "ok"}])
        agent = CloudMachineAgent(client, app_version="1.4.38", heartbeat_callback=health_updates.append)

        result = agent.heartbeat(health="ok", current_job_id="job-1")

        self.assertTrue(result["ok"])
        self.assertEqual(health_updates, ["ok"])
        self.assertEqual(client.calls[0]["path"], "/api/machines/heartbeat")
        self.assertEqual(client.calls[0]["machine_token"], "csr_machine_secret")
        self.assertEqual(
            client.calls[0]["body"],
            {
                "health": "ok",
                "current_job_id": "job-1",
                "app_version": "1.4.38",
                "capabilities": ["tmall_ai_image_test"],
            },
        )

    def test_claim_once_normalizes_idle_sleep_from_server(self):
        data_sink.save_cloud_machine_credentials("machine-1", "csr_machine_secret", "任务机", ["cap"])
        client = FakeClient([{"job": None, "next_poll_after_seconds": 10}])
        agent = CloudMachineAgent(client)

        result = agent.claim_once()

        self.assertIsNone(result["job"])
        self.assertEqual(result["next_poll_after_seconds"], 10.0)
        self.assertEqual(result["idle_sleep_seconds"], 10.0)
        self.assertEqual(client.calls[0]["path"], "/api/machines/jobs/claim")

    def test_claimed_job_updates_local_busy_idle_callback(self):
        class SucceedingExecutor:
            def __init__(self, _client):
                pass

            def execute(self, _job):
                return {"status": "succeeded", "result": {"ok": True}}

        data_sink.save_cloud_machine_credentials("machine-1", "csr_machine_secret", "任务机", ["regenerate_ai_image"])
        health_updates = []
        client = FakeClient([
            {
                "job": {
                    "job_uid": "job-1",
                    "batch_uid": "batch-1",
                    "job_type": "regenerate_ai_image",
                    "lease_id": "lease-1",
                    "payload": {},
                },
                "next_poll_after_seconds": 0,
            },
            {"ok": True, "status": "succeeded"},
        ])
        agent = CloudMachineAgent(client, job_executor_factory=SucceedingExecutor, heartbeat_callback=health_updates.append)

        result = agent.claim_once()

        self.assertEqual(result["job_result"]["status"], "succeeded")
        self.assertEqual(health_updates, ["online_busy", "online_idle"])

    def test_complete_failure_is_flushed_after_restart_before_heartbeat_or_claim(self):
        class CountingExecutor:
            def __init__(self):
                self.calls = 0

            def execute(self, _job):
                self.calls += 1
                return {"status": "succeeded", "result": {"submitted": 1, "status": "created"}}

        data_sink.save_cloud_machine_credentials("machine-1", "csr_machine_secret", "任务机", ["submit_tmall_material_test"])
        first_client = FakeClient([
            {
                "job": {
                    "job_uid": "job-submit-once",
                    "batch_uid": "batch-1",
                    "job_type": "submit_tmall_material_test",
                    "lease_id": "lease-1",
                    "payload": {},
                },
                "next_poll_after_seconds": 0,
            },
            CloudApprovalError(
                "cloud request failed: HTTP 502; gateway timeout",
                status=502,
                payload={"error": "gateway timeout"},
            ),
        ])
        second_client = FakeClient([
            {"ok": True, "status": "succeeded"},
            {"ok": True, "machine_id": "machine-1", "health": "online_idle"},
            {"job": None, "next_poll_after_seconds": 10},
        ])
        executor = CountingExecutor()
        first_agent = CloudMachineAgent(first_client, job_executor_factory=lambda _client: executor)

        first = first_agent.claim_once()
        pending = data_sink.list_pending_cloud_job_completions()[0]
        sleeps = []
        restarted_agent = CloudMachineAgent(second_client, sleep=sleeps.append)
        restarted_agent.run_forever(StopAfterSleeps(sleeps, 1))

        self.assertEqual(first["job_result"]["status"], "completion_pending")
        self.assertEqual(pending["lease_id"], "lease-1")
        self.assertEqual(pending["result"], {"submitted": 1, "status": "created"})
        self.assertEqual(executor.calls, 1)
        self.assertEqual(
            [call["path"] for call in second_client.calls],
            [
                "/api/jobs/job-submit-once/complete",
                "/api/machines/heartbeat",
                "/api/machines/jobs/claim",
            ],
        )
        self.assertEqual(second_client.calls[0]["body"]["lease_id"], "lease-1")
        self.assertEqual(second_client.calls[0]["body"]["result"], {"submitted": 1, "status": "created"})
        self.assertEqual(data_sink.list_pending_cloud_job_completions(), [])

    def test_stale_completion_is_cleared_without_rebinding_to_a_new_lease(self):
        data_sink.save_pending_cloud_job_completion("job-stale", "lease-old", {"ok": True})
        client = FakeClient([
            CloudApprovalError(
                "cloud request failed: HTTP 403; Stale lease",
                status=403,
                payload={"error": "Stale lease", "code": "stale_lease"},
            ),
        ])
        agent = CloudMachineAgent(client)

        result = agent.flush_pending_completions()

        self.assertEqual(result["stale"], 1)
        self.assertEqual(data_sink.list_pending_cloud_job_completions(), [])
        self.assertEqual(data_sink.list_cloud_job_events("job-stale")[-1]["event_type"], "completion_stale_lease")
        self.assertEqual(client.calls[0]["body"]["lease_id"], "lease-old")

    def test_legacy_completion_without_lease_is_discarded_without_network_replay(self):
        data_sink.save_pending_cloud_job_completion("job-legacy", "", {"ok": True})
        client = FakeClient([])
        agent = CloudMachineAgent(client)

        result = agent.flush_pending_completions()

        self.assertEqual(result["discarded"], 1)
        self.assertEqual(client.calls, [])
        self.assertEqual(data_sink.list_pending_cloud_job_completions(), [])
        self.assertEqual(data_sink.list_cloud_job_events("job-legacy")[-1]["event_type"], "completion_unreplayable")

    def test_transient_completion_failure_is_rescheduled_with_bounded_backoff(self):
        data_sink.save_pending_cloud_job_completion("job-retry", "lease-1", {"ok": True})
        client = FakeClient([
            CloudApprovalError(
                "cloud request failed: HTTP 502; gateway timeout",
                status=502,
                payload={"error": "gateway timeout"},
            ),
        ])
        agent = CloudMachineAgent(client, now=lambda: 1_800_000_000.0)

        result = agent.flush_pending_completions()

        self.assertEqual(result["rescheduled"], 1)
        self.assertEqual(data_sink.list_pending_cloud_job_completions(), [])
        with patch("core.data_sink._utc_now_iso", return_value="2100-01-01T00:00:00+00:00"):
            pending = data_sink.list_pending_cloud_job_completions()[0]
        self.assertEqual(pending["attempt_count"], 1)
        self.assertEqual(pending["last_error"], "cloud request failed: HTTP 502; gateway timeout")
        self.assertTrue(pending["next_attempt_at"].endswith("+00:00"))

    def test_idle_loop_uses_server_next_poll_after_seconds(self):
        client = FakeClient(
            [
                {"ok": True, "machine_id": "machine-1", "health": "online_idle"},
                {"job": None, "next_poll_after_seconds": 10},
                {"ok": True, "machine_id": "machine-1", "health": "online_idle"},
                {"job": None, "next_poll_after_seconds": 12},
            ]
        )
        sleeps = []
        agent = CloudMachineAgent(client, sleep=sleeps.append)

        agent.run_forever(StopAfterSleeps(sleeps, 2))

        self.assertEqual(sleeps, [10.0, 12.0])
        self.assertEqual(
            [call["path"] for call in client.calls],
            [
                "/api/machines/heartbeat",
                "/api/machines/jobs/claim",
                "/api/machines/heartbeat",
                "/api/machines/jobs/claim",
            ],
        )

    def test_failures_back_off_in_sequence_and_cap_at_120(self):
        client = FakeClient([CloudApprovalError("network down")] * 5)
        sleeps = []
        agent = CloudMachineAgent(client, sleep=sleeps.append)

        agent.run_forever(StopAfterSleeps(sleeps, 5))

        self.assertEqual(sleeps, [10.0, 30.0, 60.0, 120.0, 120.0])
        self.assertIsNone(data_sink.get_cloud_machine_credentials())

    def test_no_job_claim_with_zero_next_poll_uses_default_idle_sleep(self):
        client = FakeClient([{"job": None, "next_poll_after_seconds": 0}])
        agent = CloudMachineAgent(client)

        result = agent.claim_once()

        self.assertIsNone(result["job"])
        self.assertEqual(result["idle_sleep_seconds"], 45.0)

    def test_revoked_token_clears_credentials_only_for_401_revoked_signal(self):
        data_sink.save_cloud_machine_credentials("machine-1", "csr_machine_secret", "任务机", ["cap"])
        revoked_client = FakeClient([CloudApprovalError("cloud request failed: HTTP 401; machine_token_revoked")])
        sleeps = []
        revoked_agent = CloudMachineAgent(revoked_client, sleep=sleeps.append)

        revoked_agent.run_forever(StopAfterSleeps(sleeps, 1))

        self.assertIsNone(data_sink.get_cloud_machine_credentials())

        data_sink.save_cloud_machine_credentials("machine-1", "csr_machine_secret", "任务机", ["cap"])
        network_client = FakeClient([CloudApprovalError("cloud request failed: TimeoutError")])
        network_sleeps = []
        network_agent = CloudMachineAgent(network_client, sleep=network_sleeps.append)

        network_agent.run_forever(StopAfterSleeps(network_sleeps, 1))

        self.assertEqual(data_sink.get_cloud_machine_credentials()["machine_token"], "csr_machine_secret")

    def test_heartbeat_revoked_token_clears_credentials_before_reraising(self):
        data_sink.save_cloud_machine_credentials("machine-1", "csr_machine_secret", "任务机", ["cap"])
        client = FakeClient([CloudApprovalError("cloud request failed: HTTP 401; detail=machine_token_revoked")])
        agent = CloudMachineAgent(client)

        with self.assertRaises(CloudApprovalError):
            agent.heartbeat("ok")

        self.assertIsNone(data_sink.get_cloud_machine_credentials())

    def test_stable_invalid_machine_token_code_clears_saved_and_in_memory_credentials(self):
        data_sink.save_cloud_machine_credentials("machine-1", "csr_machine_secret", "任务机", ["cap"])
        client = FakeClient([
            CloudApprovalError(
                "cloud request failed: HTTP 401; Invalid machine token",
                status=401,
                payload={"error": "Invalid machine token", "code": "machine_token_invalid"},
            ),
        ])
        agent = CloudMachineAgent(client)

        with self.assertRaises(CloudApprovalError):
            agent.heartbeat("ok")

        self.assertIsNone(data_sink.get_cloud_machine_credentials())
        self.assertEqual(client.machine_token, "")

    def test_claimed_job_cancellation_is_reported_as_cancelled(self):
        from core.cloud_job_executors import CloudJobCancelled

        class CancellingExecutor:
            def __init__(self, _client):
                pass

            def execute(self, _job):
                raise CloudJobCancelled("stop requested")

        data_sink.save_cloud_machine_credentials("machine-1", "csr_machine_secret", "任务机", ["regenerate_ai_image"])
        client = FakeClient([
            {
                "job": {
                    "job_uid": "job-cancel",
                    "batch_uid": "batch-1",
                    "job_type": "regenerate_ai_image",
                    "lease_id": "lease-cancel",
                    "payload": {},
                },
                "next_poll_after_seconds": 0,
            },
            {"ok": True, "status": "cancelled"},
        ])
        agent = CloudMachineAgent(client, job_executor_factory=CancellingExecutor)

        result = agent.claim_once()

        self.assertEqual(result["job_result"]["status"], "cancelled")
        self.assertEqual(client.calls[1]["path"], "/api/jobs/job-cancel/fail")
        self.assertEqual(client.calls[1]["body"]["status"], "cancelled")
        self.assertTrue(client.calls[1]["body"]["terminal"])


if __name__ == "__main__":
    unittest.main()
