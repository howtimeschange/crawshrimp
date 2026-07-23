import asyncio
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from core import api_server, data_sink


class TaskInstancesApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        patcher = patch("core.runtime_paths.data_root", return_value=root)
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()

    def test_create_list_and_get_instance(self):
        created = api_server.create_task_instance_endpoint(api_server.TaskInstanceCreateRequest(
            adapter_id="tmall-ops-assistant",
            task_id="tmall_ai_image_test_chain",
            title="AI测图任务",
            params={"execute_mode": "approval_then_create"},
        ))

        self.assertTrue(created["instance_uid"])
        listed = api_server.list_task_instances_endpoint(status_group="current")
        self.assertEqual([item["instance_uid"] for item in listed["items"]], [created["instance_uid"]])

        detail = api_server.get_task_instance_endpoint(created["instance_uid"])
        self.assertEqual(detail["title"], "AI测图任务")
        self.assertEqual(detail["params"]["execute_mode"], "approval_then_create")

    def test_patch_archive_instance(self):
        created = api_server.create_task_instance_endpoint(api_server.TaskInstanceCreateRequest(
            adapter_id="tmall-ops-assistant",
            task_id="tmall_ai_image_test_chain",
            title="AI测图任务",
            params={},
        ))

        updated = api_server.patch_task_instance_endpoint(
            created["instance_uid"],
            api_server.TaskInstancePatchRequest(archived=True),
        )

        self.assertEqual(updated["status"], "archived")
        self.assertEqual(updated["archived"], 1)

    def test_direct_tmall_chain_status_fails_closed_when_no_measurement_task_was_created(self):
        missing = api_server._summarize_tmall_ai_chain_create_outcomes([
            {
                "款号": "208426106201",
                "阶段": "森马云盘找图",
                "执行结果": "参考图不完整",
                "备注": "缺少橱窗1/yz(1)主图原图",
            },
        ], execute_mode="direct_create")
        created = api_server._summarize_tmall_ai_chain_create_outcomes([
            {
                "款号": "208426106201",
                "阶段": "天猫上传/创建测图任务",
                "任务ID": "41716301",
                "上线结果": "已上线",
                "页面回读": "status=1",
                "执行结果": "已创建/加素材/已上线",
            },
        ], execute_mode="direct_create")

        self.assertEqual(missing["status"], "failed")
        self.assertEqual(missing["attempted"], 1)
        self.assertEqual(missing["failed"], 1)
        self.assertIn("未创建测图任务", missing["error"])
        self.assertEqual(created["status"], "completed")
        self.assertEqual(created["succeeded"], 1)
        self.assertEqual(created["failed"], 0)

    def test_direct_generation_background_job_creates_real_measurement_tasks(self):
        batch = {
            "batch_id": "batch-direct",
            "execution_mode": "direct_create",
            "status": "generating",
            "items": [],
        }
        generation_result = {
            "ok": True,
            "generated": 2,
            "failed": 0,
            "status": "pending_approval",
            "batch": batch,
        }
        create_result = {
            "ok": True,
            "status": "created",
            "attempted": 1,
            "succeeded": 1,
            "failed": 0,
            "rows": [{"任务ID": "41716301"}],
        }
        module = SimpleNamespace(
            submit_generation_confirmation_batch=Mock(return_value=generation_result),
            approve_generated_assets_for_direct_create=Mock(return_value=2),
            upload_approved_tmall_batch=AsyncMock(return_value=create_result),
            save_approval_batch=Mock(),
        )

        with patch.object(api_server, "_load_tmall_ai_image_chain_module", return_value=module), \
             patch.object(api_server, "_update_tmall_generation_task_instance") as update_generation, \
             patch.object(api_server, "_update_tmall_submission_task_instance") as update_submission:
            asyncio.run(api_server._run_tmall_generation_confirmation_job("batch-direct", batch))

        module.approve_generated_assets_for_direct_create.assert_called_once_with(batch)
        module.upload_approved_tmall_batch.assert_awaited_once()
        update_submission.assert_called_once_with("batch-direct", create_result)
        update_generation.assert_not_called()

    def test_direct_generation_keeps_generation_success_when_task_creation_fails(self):
        batch = {
            "batch_id": "batch-direct-failed",
            "execution_mode": "direct_create",
            "status": "pending_approval",
            "generation_status": "succeeded",
            "items": [],
        }
        generation_result = {
            "ok": True,
            "generated": 2,
            "failed": 0,
            "status": "pending_approval",
            "batch": batch,
        }
        module = SimpleNamespace(
            submit_generation_confirmation_batch=Mock(return_value=generation_result),
            approve_generated_assets_for_direct_create=Mock(return_value=2),
            upload_approved_tmall_batch=AsyncMock(side_effect=RuntimeError("天猫创建接口超时")),
            save_approval_batch=Mock(),
        )

        with patch.object(api_server, "_load_tmall_ai_image_chain_module", return_value=module), \
             patch.object(api_server, "_update_tmall_generation_task_instance") as update_generation, \
             patch.object(api_server, "_update_tmall_submission_task_instance") as update_submission:
            asyncio.run(api_server._run_tmall_generation_confirmation_job("batch-direct-failed", batch))

        self.assertEqual(batch["status"], "create_failed")
        self.assertEqual(batch["generation_status"], "succeeded")
        self.assertEqual(batch["approval_status"], "not_required")
        self.assertEqual(batch["test_task_status"], "failed")
        module.save_approval_batch.assert_called_once_with(batch)
        update_generation.assert_not_called()
        failure_result = update_submission.call_args.args[1]
        self.assertEqual(failure_result["status"], "create_failed")
        self.assertEqual(failure_result["failed"], 1)
        self.assertIn("天猫创建接口超时", failure_result["error"])


if __name__ == "__main__":
    unittest.main()
