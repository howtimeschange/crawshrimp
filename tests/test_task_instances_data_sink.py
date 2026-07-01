import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import data_sink


class TaskInstancesDataSinkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        patcher = patch("core.runtime_paths.data_root", return_value=self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()

    def test_create_and_get_task_instance(self):
        instance = data_sink.create_task_instance(
            adapter_id="tmall-ops-assistant",
            task_id="tmall_ai_image_test_chain",
            title="AI测图任务",
            params={"execute_mode": "approval_then_create"},
        )

        loaded = data_sink.get_task_instance(instance["instance_uid"])
        self.assertEqual(loaded["title"], "AI测图任务")
        self.assertEqual(loaded["status"], "draft")
        self.assertEqual(json.loads(loaded["params_json"])["execute_mode"], "approval_then_create")

    def test_link_run_and_artifact(self):
        instance = data_sink.create_task_instance("tmall-ops-assistant", "tmall_ai_image_test_chain", "AI测图任务", {})
        run_id = data_sink.begin_run("tmall-ops-assistant", "tmall_ai_image_test_chain")

        data_sink.link_task_instance_run(instance["instance_uid"], run_id, purpose="main")
        data_sink.add_task_instance_artifact(instance["instance_uid"], kind="excel", label="执行证据", path="/tmp/a.xlsx")

        detail = data_sink.get_task_instance_detail(instance["instance_uid"])
        self.assertEqual(detail["runs"][0]["run_id"], run_id)
        self.assertEqual(detail["artifacts"][0]["path"], "/tmp/a.xlsx")
        self.assertEqual(detail["last_run_id"], run_id)

    def test_list_task_instances_status_group(self):
        waiting = data_sink.create_task_instance("tmall-ops-assistant", "tmall_ai_image_test_chain", "待审批", {})
        done = data_sink.create_task_instance("tmall-ops-assistant", "tmall_ai_image_test_chain", "完成", {})
        data_sink.update_task_instance(waiting["instance_uid"], status="waiting_approval")
        data_sink.update_task_instance(done["instance_uid"], status="completed")

        current = data_sink.list_task_instances(status_group="current")
        pending = data_sink.list_task_instances(status_group="pending")
        history = data_sink.list_task_instances(status_group="history")

        self.assertEqual([row["title"] for row in current], ["待审批"])
        self.assertEqual([row["title"] for row in pending], ["待审批"])
        self.assertEqual([row["title"] for row in history], ["完成"])

    def test_draft_instances_are_current_tasks(self):
        draft = data_sink.create_task_instance("tmall-ops-assistant", "tmall_ai_image_test_chain", "草稿任务", {})

        current = data_sink.list_task_instances(status_group="current")

        self.assertEqual([row["instance_uid"] for row in current], [draft["instance_uid"]])


if __name__ == "__main__":
    unittest.main()
