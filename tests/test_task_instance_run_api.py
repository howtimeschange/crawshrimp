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
        api_server._run_logs.clear()
        api_server._run_status.clear()
        api_server._run_controls.clear()
        api_server._task_locks.clear()
        api_server._task_run_queues.clear()
        original_guard = api_server.runtime_install_guard
        api_server.runtime_install_guard = api_server.RuntimeInstallGuard()
        self.addCleanup(lambda: setattr(api_server, "runtime_install_guard", original_guard))

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

    async def test_two_instances_of_same_task_cannot_run_concurrently(self):
        first = api_server.create_task_instance_endpoint(api_server.TaskInstanceCreateRequest(
            adapter_id="tmall-ops-assistant",
            task_id="tmall_ai_image_test_chain",
            title="AI测图任务 1",
            params={},
        ))
        second = api_server.create_task_instance_endpoint(api_server.TaskInstanceCreateRequest(
            adapter_id="tmall-ops-assistant",
            task_id="tmall_ai_image_test_chain",
            title="AI测图任务 2",
            params={},
        ))
        fake_adapter = type("FakeAdapter", (), {
            "tasks": [type("FakeTask", (), {"id": "tmall_ai_image_test_chain"})()],
        })()
        release = asyncio.Event()

        async def hold_background_run(*_args, **_kwargs):
            await release.wait()

        try:
            with patch("core.api_server.adapter_loader.scan_all"):
                with patch("core.api_server.adapter_loader.get_adapter", return_value=fake_adapter):
                    with patch("core.api_server._run_task_background", side_effect=hold_background_run):
                        first_result = await api_server.run_task_instance(first["instance_uid"])
                        self.assertTrue(first_result["ok"])

                        with self.assertRaises(api_server.HTTPException) as raised:
                            await api_server.run_task_instance(second["instance_uid"])

            self.assertEqual(raised.exception.status_code, 409)
            second_detail = api_server.get_task_instance_endpoint(second["instance_uid"])
            self.assertEqual(second_detail["status"], "draft")
            self.assertIn("任务正在运行中", second_detail["summary"]["error"])
        finally:
            release.set()
            await asyncio.sleep(0)
            for control in list(api_server._run_controls.values()):
                task = control.get("task") if isinstance(control, dict) else None
                if task and not task.done():
                    task.cancel()
            api_server._run_controls.clear()
            api_server._run_status.clear()
            api_server._run_logs.clear()

    async def test_bala_qn_video_task_queues_while_previous_run_is_active(self):
        fake_adapter = type("FakeAdapter", (), {
            "tasks": [type("FakeTask", (), {"id": api_server.BALA_QN_VIDEO_TASK_ID})()],
        })()
        first_can_finish = asyncio.Event()
        second_started = asyncio.Event()
        seen_params = []

        async def fake_execute(_adapter_id, _task_id, params, *_args, **_kwargs):
            seen_params.append(dict(params or {}))
            if len(seen_params) == 1:
                await first_can_finish.wait()
            else:
                second_started.set()

        with patch("core.api_server.adapter_loader.scan_all"):
            with patch("core.api_server.adapter_loader.get_adapter", return_value=fake_adapter):
                with patch("core.api_server._execute_task", side_effect=fake_execute):
                    first = await api_server._start_task_run(
                        api_server.BALA_AI_VIDEO_ADAPTER_ID,
                        api_server.BALA_QN_VIDEO_TASK_ID,
                        {"style_code": "208326100001"},
                        {},
                    )
                    self.assertTrue(first["ok"])
                    await asyncio.sleep(0)

                    queued = await api_server._start_task_run(
                        api_server.BALA_AI_VIDEO_ADAPTER_ID,
                        api_server.BALA_QN_VIDEO_TASK_ID,
                        {"style_code": "208326100002"},
                        {},
                    )
                    self.assertTrue(queued["ok"])
                    self.assertTrue(queued["queued"])
                    self.assertEqual(queued["status"], "queued")
                    self.assertEqual(queued["queue_position"], 1)
                    self.assertEqual(len(api_server._task_run_queues[api_server._task_jid(
                        api_server.BALA_AI_VIDEO_ADAPTER_ID,
                        api_server.BALA_QN_VIDEO_TASK_ID,
                    )]), 1)

                    first_can_finish.set()
                    await asyncio.wait_for(second_started.wait(), timeout=1)
                    await asyncio.sleep(0)

        self.assertEqual([item.get("style_code") for item in seen_params], [
            "208326100001",
            "208326100002",
        ])
        self.assertEqual(seen_params[1].get("__task_queue_request_id"), queued["queued_request_id"])
        self.assertEqual(api_server.task_status(
            api_server.BALA_AI_VIDEO_ADAPTER_ID,
            api_server.BALA_QN_VIDEO_TASK_ID,
        )["queue"], [])

    async def test_bala_ai_image_task_queues_while_previous_run_is_active(self):
        fake_adapter = type("FakeAdapter", (), {
            "tasks": [type("FakeTask", (), {"id": api_server.BALA_AI_FACE_BACKGROUND_TASK_ID})()],
        })()
        first_can_finish = asyncio.Event()
        second_started = asyncio.Event()
        seen_params = []

        async def fake_execute(_adapter_id, _task_id, params, *_args, **_kwargs):
            seen_params.append(dict(params or {}))
            if len(seen_params) == 1:
                await first_can_finish.wait()
            else:
                second_started.set()

        with patch("core.api_server.adapter_loader.scan_all"):
            with patch("core.api_server.adapter_loader.get_adapter", return_value=fake_adapter):
                with patch("core.api_server._execute_task", side_effect=fake_execute):
                    first = await api_server._start_task_run(
                        api_server.BALA_AI_VIDEO_ADAPTER_ID,
                        api_server.BALA_AI_FACE_BACKGROUND_TASK_ID,
                        {"source_limit": 1},
                        {},
                    )
                    self.assertTrue(first["ok"])
                    await asyncio.sleep(0)

                    queued = await api_server._start_task_run(
                        api_server.BALA_AI_VIDEO_ADAPTER_ID,
                        api_server.BALA_AI_FACE_BACKGROUND_TASK_ID,
                        {"source_limit": 1, "style_code": "208326100002"},
                        {},
                    )
                    self.assertTrue(queued["ok"])
                    self.assertTrue(queued["queued"])
                    self.assertEqual(queued["status"], "queued")
                    self.assertEqual(queued["queue_position"], 1)

                    first_can_finish.set()
                    await asyncio.wait_for(second_started.wait(), timeout=1)
                    await asyncio.sleep(0)

        self.assertEqual([item.get("style_code") for item in seen_params], [
            None,
            "208326100002",
        ])
        self.assertEqual(seen_params[1].get("__task_queue_request_id"), queued["queued_request_id"])
        self.assertEqual(api_server.task_status(
            api_server.BALA_AI_VIDEO_ADAPTER_ID,
            api_server.BALA_AI_FACE_BACKGROUND_TASK_ID,
        )["queue"], [])

    async def test_active_tasks_deduplicates_task_and_instance_control_aliases(self):
        task = asyncio.create_task(asyncio.sleep(60))
        control = {"task": task}
        task_jid = api_server._task_jid("tmall-ops-assistant", "tmall_ai_image_test_chain")
        instance_jid = api_server._instance_jid("instance-1")
        live = {
            "status": "running",
            "adapter_id": "tmall-ops-assistant",
            "task_id": "tmall_ai_image_test_chain",
            "instance_uid": "instance-1",
            "run_id": 123,
            "records": 0,
        }
        try:
            api_server._run_controls[task_jid] = control
            api_server._run_controls[instance_jid] = control
            api_server._run_status[task_jid] = dict(live)
            api_server._run_status[instance_jid] = dict(live)

            active = api_server.active_tasks()

            self.assertTrue(active["active"])
            self.assertEqual(len(active["tasks"]), 1)
            self.assertEqual(active["tasks"][0]["jid"], task_jid)
            self.assertEqual(active["tasks"][0]["instance_uid"], "instance-1")
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            api_server._run_controls.clear()
            api_server._run_status.clear()
            api_server._run_logs.clear()


if __name__ == "__main__":
    unittest.main()
