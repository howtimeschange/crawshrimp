import asyncio
import unittest

from core import scheduler as sched_module
from core.models import AdapterManifest, TaskDefinition, TaskTrigger, TriggerType


class TaskSchedulesSchedulerTests(unittest.TestCase):
    def setUp(self):
        try:
            if sched_module._scheduler and sched_module._scheduler.running:
                sched_module._scheduler.shutdown(wait=False)
        except Exception:
            pass
        sched_module.set_runtime_operation_hooks()
        sched_module._scheduler = None
        sched_module._task_callbacks.clear()

    def tearDown(self):
        try:
            if sched_module._scheduler and sched_module._scheduler.running:
                sched_module._scheduler.shutdown(wait=False)
        except Exception:
            pass
        sched_module.set_runtime_operation_hooks()
        sched_module._scheduler = None
        sched_module._task_callbacks.clear()

    def _scheduler_wrapper_cases(self, callback):
        manifest = AdapterManifest(
            id="demo-adapter",
            name="Demo Adapter",
            entry_url="https://example.test",
            tasks=[
                TaskDefinition(
                    id="scheduled-task",
                    name="Scheduled Task",
                    script="run.js",
                    trigger=TaskTrigger(type=TriggerType.interval, interval_minutes=5),
                )
            ],
        )
        sched_module.register_adapter(manifest, callback)
        manifest_job = sched_module.get_scheduler().get_job("demo-adapter::scheduled-task")

        schedule = {
            "schedule_uid": "sched-runtime-hook",
            "frequency": "daily",
            "time_of_day": "09:30",
            "enabled": 1,
            "archived": 0,
        }
        sched_module.register_task_schedule(schedule, callback)
        task_schedule_job = sched_module.get_scheduler().get_job("schedule::sched-runtime-hook")
        return [
            ("manifest", manifest_job),
            ("task_schedule", task_schedule_job),
        ]

    def _run_scheduler_job(self, job):
        result = job.func(*job.args, **job.kwargs)
        if asyncio.iscoroutine(result):
            asyncio.run(result)

    def test_runtime_operation_hook_absent_runs_scheduled_callbacks_normally(self):
        calls = []

        async def callback(*args):
            calls.append(args)

        for name, job in self._scheduler_wrapper_cases(callback):
            with self.subTest(wrapper=name):
                self._run_scheduler_job(job)

        self.assertEqual(
            calls,
            [
                ("demo-adapter", "scheduled-task"),
                ("sched-runtime-hook",),
            ],
        )

    def test_runtime_operation_empty_begin_token_skips_callback_without_end(self):
        calls = []
        begin_calls = []
        end_calls = []

        async def callback(*args):
            calls.append(args)

        def begin_operation(*args):
            begin_calls.append(args)
            return ""

        sched_module.set_runtime_operation_hooks(begin_operation=begin_operation, end_operation=end_calls.append)

        for name, job in self._scheduler_wrapper_cases(callback):
            with self.subTest(wrapper=name):
                self._run_scheduler_job(job)

        self.assertEqual(calls, [])
        self.assertEqual(end_calls, [])
        self.assertEqual(
            begin_calls,
            [
                ("scheduled_task", "demo-adapter::scheduled-task", "demo-adapter::scheduled-task", "running"),
                ("task_schedule", "schedule::sched-runtime-hook", "schedule::sched-runtime-hook", "running"),
            ],
        )

    def test_runtime_operation_non_empty_token_runs_callback_and_releases(self):
        calls = []
        begin_calls = []
        end_calls = []

        async def callback(*args):
            calls.append(args)

        def begin_operation(kind, operation_id, label, status):
            begin_calls.append((kind, operation_id, label, status))
            return f"token:{operation_id}"

        sched_module.set_runtime_operation_hooks(begin_operation=begin_operation, end_operation=end_calls.append)

        for name, job in self._scheduler_wrapper_cases(callback):
            with self.subTest(wrapper=name):
                self._run_scheduler_job(job)

        self.assertEqual(
            calls,
            [
                ("demo-adapter", "scheduled-task"),
                ("sched-runtime-hook",),
            ],
        )
        self.assertEqual(
            end_calls,
            [
                "token:demo-adapter::scheduled-task",
                "token:schedule::sched-runtime-hook",
            ],
        )
        self.assertEqual(len(begin_calls), 2)

    def test_runtime_operation_token_releases_when_callback_errors_and_error_is_logged(self):
        end_calls = []

        async def callback(*_args):
            raise RuntimeError("scheduled boom")

        def begin_operation(_kind, operation_id, _label, _status):
            return f"token:{operation_id}"

        sched_module.set_runtime_operation_hooks(begin_operation=begin_operation, end_operation=end_calls.append)

        for name, job in self._scheduler_wrapper_cases(callback):
            with self.subTest(wrapper=name):
                with self.assertLogs("core.scheduler", level="ERROR") as logs:
                    self._run_scheduler_job(job)
                self.assertIn("scheduled boom", "\n".join(logs.output))

        self.assertEqual(
            end_calls,
            [
                "token:demo-adapter::scheduled-task",
                "token:schedule::sched-runtime-hook",
            ],
        )

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
