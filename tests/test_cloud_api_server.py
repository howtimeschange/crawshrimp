import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import data_sink
from core import api_server
from core.config import DEFAULT_CONFIG, save_config


class FakeCloudMachineAgent:
    enroll_calls = []
    run_calls = []

    def __init__(self, client, **kwargs):
        self.client = client
        self.kwargs = kwargs

    def enroll(self, registration_token, machine_name, capabilities):
        self.__class__.enroll_calls.append((registration_token, machine_name, capabilities))
        data_sink.save_cloud_machine_credentials(
            machine_id="machine-cloud-1",
            machine_token="csr_machine_secret",
            machine_name=machine_name,
            capabilities=capabilities,
        )
        return {
            "ok": True,
            "machine_id": "machine-cloud-1",
            "auth_status": "active",
            "machine_token": "csr_machine_secret",
        }

    def run_forever(self, stop_event):
        self.__class__.run_calls.append(stop_event)
        while not stop_event.is_set():
            stop_event.wait(0.01)


class CloudApiServerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        runtime_patcher = patch("core.runtime_paths.data_root", return_value=self.root)
        runtime_patcher.start()
        self.addCleanup(runtime_patcher.stop)
        data_sink.init_db()
        save_config(DEFAULT_CONFIG)
        api_server.cloud_machine_controller.stop()
        self.addCleanup(api_server.cloud_machine_controller.stop)
        FakeCloudMachineAgent.enroll_calls = []
        FakeCloudMachineAgent.run_calls = []

    def assertRouteRegistered(self, path, method):
        routes = [
            route for route in api_server.app.routes
            if getattr(route, "path", "") == path and method in getattr(route, "methods", set())
        ]
        self.assertTrue(routes, f"{method} {path} is not registered")

    def test_cloud_approval_routes_are_registered(self):
        for method, path in [
            ("GET", "/cloud-approval/status"),
            ("POST", "/cloud-approval/config"),
            ("POST", "/cloud-approval/enroll-machine"),
            ("POST", "/cloud-approval/sync-batch"),
            ("POST", "/cloud-approval/machine/start"),
            ("POST", "/cloud-approval/machine/stop"),
        ]:
            self.assertRouteRegistered(path, method)

    def test_status_returns_safe_cloud_machine_state_without_token(self):
        data_sink.save_cloud_machine_credentials(
            machine_id="machine-cloud-1",
            machine_token="csr_machine_secret",
            machine_name="设计部任务机",
            capabilities=["regenerate_ai_image"],
        )
        save_config({
            **DEFAULT_CONFIG,
            "cloud_approval": {
                **DEFAULT_CONFIG["cloud_approval"],
                "base_url": "https://approval.example.test",
                "machine_name": "设计部任务机",
                "machine_enabled": True,
            },
        })

        payload = api_server.get_cloud_approval_status()

        self.assertTrue(payload["configured"])
        self.assertFalse(payload["running"])
        self.assertEqual(payload["base_url"], "https://approval.example.test")
        self.assertEqual(payload["machine_name"], "设计部任务机")
        self.assertEqual(payload["machine_id"], "machine-cloud-1")
        self.assertTrue(payload["token_present"])
        self.assertEqual(payload["auth"], "enrolled")
        self.assertEqual(payload["health"], "stopped")
        self.assertEqual(payload["capabilities"], ["regenerate_ai_image"])
        self.assertNotIn("machine_token", payload)
        self.assertNotIn("csr_machine_secret", str(payload))

    def test_status_defaults_to_v1_capabilities_without_saved_list(self):
        payload = api_server.get_cloud_approval_status()

        self.assertEqual(payload["capabilities"], ["regenerate_ai_image", "submit_tmall_material_test"])
        self.assertNotIn("generate_ai_image", payload["capabilities"])
        self.assertNotIn("machine_token", payload)

    def test_config_route_persists_cloud_approval_settings_without_credentials(self):
        result = api_server.configure_cloud_approval(api_server.CloudApprovalConfigRequest(
            base_url="https://approval.example.test/",
            registration_token="registration-secret",
            machine_name="设计部任务机",
            machine_enabled=True,
            capabilities=["regenerate_ai_image", "submit_tmall_material_test"],
        ))

        self.assertTrue(result["ok"])
        self.assertEqual(result["status"]["base_url"], "https://approval.example.test")
        self.assertEqual(result["status"]["machine_name"], "设计部任务机")
        self.assertEqual(result["status"]["capabilities"], ["regenerate_ai_image", "submit_tmall_material_test"])
        self.assertNotIn("machine_token", result["status"])

    def test_enroll_machine_uses_registration_token_and_hides_machine_token(self):
        save_config({
            **DEFAULT_CONFIG,
            "cloud_approval": {
                **DEFAULT_CONFIG["cloud_approval"],
                "base_url": "https://approval.example.test",
                "registration_token": "registration-secret",
                "machine_name": "设计部任务机",
            },
        })

        with patch("core.api_server.CloudMachineAgent", FakeCloudMachineAgent):
            payload = api_server.enroll_cloud_machine(api_server.CloudApprovalEnrollRequest(
                capabilities=["regenerate_ai_image", "submit_tmall_material_test"],
            ))

        self.assertEqual(FakeCloudMachineAgent.enroll_calls, [
            ("registration-secret", "设计部任务机", ["regenerate_ai_image", "submit_tmall_material_test"]),
        ])
        self.assertEqual(payload["machine_id"], "machine-cloud-1")
        self.assertTrue(payload["status"]["token_present"])
        self.assertEqual(payload["status"]["capabilities"], ["regenerate_ai_image", "submit_tmall_material_test"])
        self.assertNotIn("machine_token", payload)
        self.assertNotIn("csr_machine_secret", str(payload))
        self.assertEqual(api_server._cloud_approval_config().get("registration_token"), "")
        self.assertNotIn("registration-secret", str(payload))

    def test_sync_batch_validates_local_token_and_calls_cloud_sync(self):
        batch = {"batch_id": "batch-1", "approval_token": "local-token", "items": []}
        save_config({
            **DEFAULT_CONFIG,
            "cloud_approval": {
                **DEFAULT_CONFIG["cloud_approval"],
                "base_url": "https://approval.example.test",
            },
        })

        with patch("core.api_server._load_tmall_approval_batch", return_value=batch) as load_batch, \
                patch("core.api_server._validate_tmall_approval_token") as validate_token, \
                patch("core.api_server.sync_local_approval_batch", return_value={"ok": True, "batch_uid": "batch-1"}) as sync_batch:
            payload = api_server.sync_cloud_approval_batch(api_server.CloudApprovalSyncBatchRequest(
                batch_id="batch-1",
                token="local-token",
            ))

        self.assertEqual(payload, {"ok": True, "result": {"ok": True, "batch_uid": "batch-1"}})
        load_batch.assert_called_once_with("batch-1")
        validate_token.assert_called_once_with(batch, "local-token")
        sync_batch.assert_called_once()

    def test_machine_start_runs_one_controller_thread_and_status_reports_running(self):
        data_sink.save_cloud_machine_credentials("machine-cloud-1", "csr_machine_secret", "任务机", ["cap"])
        save_config({
            **DEFAULT_CONFIG,
            "cloud_approval": {
                **DEFAULT_CONFIG["cloud_approval"],
                "base_url": "https://approval.example.test",
                "machine_name": "任务机",
            },
        })

        with patch("core.api_server.CloudMachineAgent", FakeCloudMachineAgent):
            first = api_server.start_cloud_machine()
            second = api_server.start_cloud_machine()

        self.assertTrue(first["status"]["running"])
        self.assertTrue(second["status"]["running"])
        self.assertEqual(len(FakeCloudMachineAgent.run_calls), 1)

    def test_machine_stop_stops_controller_thread(self):
        data_sink.save_cloud_machine_credentials("machine-cloud-1", "csr_machine_secret", "任务机", ["cap"])
        save_config({
            **DEFAULT_CONFIG,
            "cloud_approval": {
                **DEFAULT_CONFIG["cloud_approval"],
                "base_url": "https://approval.example.test",
                "machine_name": "任务机",
            },
        })
        with patch("core.api_server.CloudMachineAgent", FakeCloudMachineAgent):
            api_server.start_cloud_machine()
            payload = api_server.stop_cloud_machine()

        self.assertFalse(payload["status"]["running"])
        self.assertTrue(FakeCloudMachineAgent.run_calls[0].is_set())


if __name__ == "__main__":
    unittest.main()
