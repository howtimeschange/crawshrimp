import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import data_sink


class TaskSchedulesDataSinkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        patcher = patch("core.runtime_paths.data_root", return_value=root)
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()

    def test_create_and_get_daily_schedule(self):
        schedule = data_sink.create_task_schedule(
            adapter_id="tmall-ops-assistant",
            task_id="tmall_material_test_data_export",
            title="每日数据抓取",
            frequency="daily",
            time_of_day="09:30",
            weekday=None,
            params={"output_dir": "/tmp/export"},
            notify_channel="dingtalk",
            notify_template="完成 {{records}}",
        )

        loaded = data_sink.get_task_schedule(schedule["schedule_uid"])
        self.assertEqual(loaded["title"], "每日数据抓取")
        self.assertEqual(loaded["frequency"], "daily")
        self.assertEqual(loaded["time_of_day"], "09:30")
        self.assertIsNone(loaded["weekday"])
        self.assertEqual(json.loads(loaded["params_json"])["output_dir"], "/tmp/export")
        self.assertEqual(loaded["notify_template"], "完成 {{records}}")

    def test_weekly_update_and_record_run(self):
        schedule = data_sink.create_task_schedule(
            adapter_id="tmall-ops-assistant",
            task_id="tmall_material_test_data_export",
            title="每周数据抓取",
            frequency="weekly",
            time_of_day="21:15",
            weekday=5,
            params={},
        )

        updated = data_sink.update_task_schedule(
            schedule["schedule_uid"],
            enabled=False,
            time_of_day="22:00",
            weekday=6,
            params={"mode": "new"},
            notify_template="失败 {{error}}",
        )
        data_sink.record_task_schedule_run(
            schedule["schedule_uid"],
            run_id=12,
            instance_uid="inst-1",
            status="completed",
            error="",
        )
        detail = data_sink.get_task_schedule_detail(schedule["schedule_uid"])

        self.assertEqual(updated["enabled"], 0)
        self.assertEqual(detail["time_of_day"], "22:00")
        self.assertEqual(detail["weekday"], 6)
        self.assertEqual(detail["last_run_id"], 12)
        self.assertEqual(detail["last_instance_uid"], "inst-1")
        self.assertEqual(detail["last_status"], "completed")
        self.assertEqual(detail["params"]["mode"], "new")

    def test_archive_hides_schedule_from_default_list(self):
        schedule = data_sink.create_task_schedule(
            adapter_id="tmall-ops-assistant",
            task_id="tmall_material_test_data_export",
            title="待归档",
            frequency="daily",
            time_of_day="08:00",
            weekday=None,
            params={},
        )

        self.assertEqual(len(data_sink.list_task_schedules()), 1)
        data_sink.archive_task_schedule(schedule["schedule_uid"])

        self.assertEqual(data_sink.list_task_schedules(), [])
        archived = data_sink.list_task_schedules(include_archived=True)
        self.assertEqual(archived[0]["archived"], 1)


if __name__ == "__main__":
    unittest.main()
