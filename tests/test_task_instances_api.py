import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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


if __name__ == "__main__":
    unittest.main()
