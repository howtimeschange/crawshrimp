import unittest

from core import scheduler as sched_module


class TaskSchedulesSchedulerTests(unittest.TestCase):
    def setUp(self):
        try:
            if sched_module._scheduler and sched_module._scheduler.running:
                sched_module._scheduler.shutdown(wait=False)
        except Exception:
            pass
        sched_module._scheduler = None
        sched_module._task_callbacks.clear()

    def tearDown(self):
        try:
            if sched_module._scheduler and sched_module._scheduler.running:
                sched_module._scheduler.shutdown(wait=False)
        except Exception:
            pass
        sched_module._scheduler = None
        sched_module._task_callbacks.clear()

    def test_register_daily_task_schedule(self):
        schedule = {
            "schedule_uid": "sched-daily",
            "frequency": "daily",
            "time_of_day": "09:30",
            "enabled": 1,
            "archived": 0,
        }

        count = sched_module.register_task_schedule(schedule, lambda uid: None)
        jobs = sched_module.list_jobs()

        self.assertEqual(count, 1)
        self.assertEqual(jobs[0]["job_id"], "schedule::sched-daily")
        self.assertEqual(jobs[0]["kind"], "task_schedule")
        self.assertEqual(jobs[0]["schedule_uid"], "sched-daily")
        self.assertIn("hour='9'", str(sched_module.get_scheduler().get_job("schedule::sched-daily").trigger))
        self.assertIn("minute='30'", str(sched_module.get_scheduler().get_job("schedule::sched-daily").trigger))

    def test_register_weekly_task_schedule_maps_weekday(self):
        schedule = {
            "schedule_uid": "sched-weekly",
            "frequency": "weekly",
            "time_of_day": "21:05",
            "weekday": 1,
            "enabled": 1,
            "archived": 0,
        }

        sched_module.register_task_schedule(schedule, lambda uid: None)
        trigger = str(sched_module.get_scheduler().get_job("schedule::sched-weekly").trigger)

        self.assertIn("day_of_week='mon'", trigger)
        self.assertIn("hour='21'", trigger)
        self.assertIn("minute='5'", trigger)

    def test_unregister_task_schedule(self):
        schedule = {
            "schedule_uid": "sched-remove",
            "frequency": "daily",
            "time_of_day": "07:00",
            "enabled": 1,
            "archived": 0,
        }

        sched_module.register_task_schedule(schedule, lambda uid: None)
        self.assertIsNotNone(sched_module.get_scheduler().get_job("schedule::sched-remove"))

        removed = sched_module.unregister_task_schedule("sched-remove")

        self.assertEqual(removed, 1)
        self.assertIsNone(sched_module.get_scheduler().get_job("schedule::sched-remove"))


if __name__ == "__main__":
    unittest.main()
