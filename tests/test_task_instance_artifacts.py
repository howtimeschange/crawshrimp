import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import data_sink


class TaskInstanceArtifactsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        patcher = patch("core.runtime_paths.data_root", return_value=root)
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()

    def test_artifact_summary_counts_files(self):
        instance = data_sink.create_task_instance("tmall-ops-assistant", "tmall_ai_image_test_chain", "AI测图任务", {})
        data_sink.add_task_instance_artifact(instance["instance_uid"], "excel", "执行证据", "/tmp/a.xlsx")
        data_sink.add_task_instance_artifact(instance["instance_uid"], "image", "AI图", "/tmp/a.png")
        data_sink.add_task_instance_artifact(instance["instance_uid"], "directory", "导出目录", "/tmp/export")

        detail = data_sink.get_task_instance_detail(instance["instance_uid"])
        kinds = [row["kind"] for row in detail["artifacts"]]
        self.assertEqual(kinds, ["excel", "image", "directory"])


if __name__ == "__main__":
    unittest.main()
