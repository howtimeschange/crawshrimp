from pathlib import Path
import unittest

import yaml


MANIFESTS = {
    "vipshop-ops-assistant": Path("adapters/vipshop-ops-assistant/manifest.yaml"),
    "weimob-ops-assistant": Path("adapters/weimob-ops-assistant/manifest.yaml"),
    "mop-ops-assistant": Path("adapters/mop-ops-assistant/manifest.yaml"),
}


EXPECTED_TASKS = [
    ("vipshop-ops-assistant", "light_supply_goods_report"),
    ("weimob-ops-assistant", "goods_new_arrival_automation"),
    ("mop-ops-assistant", "cloud_folder_download"),
    ("mop-ops-assistant", "search_recommend_material_publish"),
    ("mop-ops-assistant", "kol_material_img2video_batch"),
]


def _mode_param(adapter_id: str, task_id: str) -> dict:
    manifest = yaml.safe_load(MANIFESTS[adapter_id].read_text(encoding="utf-8"))
    tasks = {task["id"]: task for task in manifest["tasks"]}
    params = {param["id"]: param for param in tasks[task_id].get("params", [])}
    return params["mode"]


class RecommendedNewPageOpenModesTests(unittest.TestCase):
    def test_selected_ops_scripts_default_to_recommended_new_page_mode(self):
        for adapter_id, task_id in EXPECTED_TASKS:
            with self.subTest(adapter_id=adapter_id, task_id=task_id):
                mode = _mode_param(adapter_id, task_id)
                labels = {option["value"]: option["label"] for option in mode["options"]}

                self.assertEqual(mode["default"], "new")
                self.assertIn("推荐", labels["new"])
                self.assertNotIn("推荐", labels["current"])


if __name__ == "__main__":
    unittest.main()
