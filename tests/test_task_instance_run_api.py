import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from core import api_server, data_sink


class TaskInstanceRunApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        patcher = patch("core.runtime_paths.data_root", return_value=root)
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()

    async def test_run_instance_injects_instance_uid(self):
        created = api_server.create_task_instance_endpoint(api_server.TaskInstanceCreateRequest(
            adapter_id="tmall-ops-assistant",
            task_id="tmall_ai_image_test_chain",
            title="AI测图任务",
            params={"execute_mode": "approval_then_create"},
        ))

        fake_adapter = type("FakeAdapter", (), {
            "tasks": [type("FakeTask", (), {"id": "tmall_ai_image_test_chain"})()],
        })()

        with patch("core.api_server.adapter_loader.scan_all"):
            with patch("core.api_server.adapter_loader.get_adapter", return_value=fake_adapter):
                with patch("core.api_server._run_task_background", new_callable=AsyncMock) as bg:
                    result = await api_server.run_task_instance(
                        created["instance_uid"],
                        api_server.RunTaskRequest(
                            params={"mode": "current"},
                            current_tab_id="tab-123",
                        ),
                    )
                    await asyncio.sleep(0)

        self.assertTrue(result["ok"])
        args = bg.call_args.args
        self.assertEqual(args[0], "tmall-ops-assistant")
        self.assertEqual(args[1], "tmall_ai_image_test_chain")
        self.assertEqual(args[2]["__task_instance_uid"], created["instance_uid"])
        self.assertEqual(args[2]["mode"], "current")
        self.assertEqual(args[3]["current_tab_id"], "tab-123")

    async def test_run_instance_conflict_does_not_mark_instance_failed(self):
        created = api_server.create_task_instance_endpoint(api_server.TaskInstanceCreateRequest(
            adapter_id="tmall-ops-assistant",
            task_id="tmall_ai_image_test_chain",
            title="AI测图任务",
            params={"execute_mode": "approval_then_create"},
        ))

        with patch(
            "core.api_server._start_task_run",
            new=AsyncMock(side_effect=api_server.HTTPException(409, "任务正在运行中")),
        ):
            with self.assertRaises(api_server.HTTPException):
                await api_server.run_task_instance(created["instance_uid"])

        detail = api_server.get_task_instance_endpoint(created["instance_uid"])
        self.assertEqual(detail["status"], "draft")
        self.assertIn("任务正在运行中", detail["summary"]["error"])


if __name__ == "__main__":
    unittest.main()
