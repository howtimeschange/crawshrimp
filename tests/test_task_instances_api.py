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


if __name__ == "__main__":
    unittest.main()
