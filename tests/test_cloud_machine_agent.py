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

    def test_heartbeat_sends_app_health_capabilities_and_current_job_id(self):
        data_sink.save_cloud_machine_credentials(
            machine_id="machine-1",
            machine_token="csr_machine_secret",
            machine_name="任务机",
            capabilities=["tmall_ai_image_test"],
        )
        client = FakeClient([{"ok": True, "machine_id": "machine-1", "auth_status": "active", "health": "ok"}])
        agent = CloudMachineAgent(client, app_version="1.4.38")

        result = agent.heartbeat(health="ok", current_job_id="job-1")

        self.assertTrue(result["ok"])
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

    def test_idle_loop_uses_server_next_poll_after_seconds(self):
        client = FakeClient(
            [
                {"job": None, "next_poll_after_seconds": 10},
                {"job": None, "next_poll_after_seconds": 12},
            ]
        )
        sleeps = []
        agent = CloudMachineAgent(client, sleep=sleeps.append)

        agent.run_forever(StopAfterSleeps(sleeps, 2))

        self.assertEqual(sleeps, [10.0, 12.0])

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


if __name__ == "__main__":
    unittest.main()
