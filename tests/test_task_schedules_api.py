import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from core import api_server, data_sink
from fastapi import HTTPException


class TaskSchedulesApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        patcher = patch("core.runtime_paths.data_root", return_value=root)
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()

    def test_create_list_patch_and_delete_schedule(self):
        with patch("core.api_server.sched_module.register_task_schedule") as register:
            created = api_server.create_task_schedule_endpoint(api_server.TaskScheduleCreateRequest(
                title="每日数据抓取",
                frequency="daily",
                time_of_day="09:30",
                sync_to_cloud=True,
            ))

        self.assertEqual(created["adapter_id"], "tmall-ops-assistant")
        self.assertEqual(created["task_id"], "tmall_material_test_data_export")
        self.assertEqual(created["params"]["mode"], "new")
        self.assertEqual(created["params"]["sync_to_cloud"], ["enabled"])
        self.assertIn("抓虾导出", created["params"]["output_dir"])
        register.assert_called_once()

        listed = api_server.list_task_schedules_endpoint()
        self.assertEqual(len(listed["items"]), 1)

        with patch("core.api_server.sched_module.register_task_schedule") as register_again:
            patched = api_server.patch_task_schedule_endpoint(
                created["schedule_uid"],
                api_server.TaskSchedulePatchRequest(enabled=True, frequency="weekly", weekday=3, time_of_day="21:00"),
            )

        self.assertEqual(patched["frequency"], "weekly")
        self.assertEqual(patched["weekday"], 3)
        register_again.assert_called_once()

        with patch("core.api_server.sched_module.unregister_task_schedule") as unregister:
            deleted = api_server.delete_task_schedule_endpoint(created["schedule_uid"])

        self.assertEqual(deleted["ok"], True)
        unregister.assert_called_once_with(created["schedule_uid"])
        self.assertEqual(api_server.list_task_schedules_endpoint()["items"], [])

    def test_create_schedule_can_disable_cloud_sync(self):
        created = api_server.create_task_schedule_endpoint(api_server.TaskScheduleCreateRequest(
            title="只本地导出",
            frequency="daily",
            time_of_day="09:30",
            params={"sync_to_cloud": ["enabled"]},
            sync_to_cloud=False,
        ))

        self.assertNotIn("sync_to_cloud", created["params"])

    async def test_run_now_creates_instance_and_starts_saved_task(self):
        created = data_sink.create_task_schedule(
            adapter_id="tmall-ops-assistant",
            task_id="tmall_material_test_data_export",
            title="立刻跑一次",
            frequency="daily",
            time_of_day="09:30",
            weekday=None,
            params={"mode": "new", "output_dir": "/tmp/export", "sync_to_cloud": ["enabled"]},
            notify_template="完成 {{records}}",
        )

        with patch("core.api_server._start_task_run", new=AsyncMock(return_value={"ok": True})):
            result = await api_server.run_task_schedule_now_endpoint(created["schedule_uid"])

        self.assertTrue(result["ok"])
        self.assertTrue(result["instance_uid"])
        detail = data_sink.get_task_instance_detail(result["instance_uid"])
        self.assertEqual(detail["adapter_id"], "tmall-ops-assistant")
        self.assertEqual(detail["task_id"], "tmall_material_test_data_export")
        self.assertEqual(detail["params"]["__task_schedule_uid"], created["schedule_uid"])
        self.assertEqual(detail["params"]["__task_instance_uid"], result["instance_uid"])
        self.assertEqual(detail["params"]["sync_to_cloud"], ["enabled"])

    async def test_run_now_rejects_active_task_before_creating_instance(self):
        created = data_sink.create_task_schedule(
            adapter_id="tmall-ops-assistant",
            task_id="tmall_material_test_data_export",
            title="运行中拒绝",
            frequency="daily",
            time_of_day="09:30",
            weekday=None,
            params={"mode": "new"},
        )

        with patch("core.api_server._task_is_active", return_value=True):
            with self.assertRaises(HTTPException) as raised:
                await api_server.run_task_schedule_now_endpoint(created["schedule_uid"])

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(data_sink.list_task_instances(), [])


if __name__ == "__main__":
    unittest.main()
