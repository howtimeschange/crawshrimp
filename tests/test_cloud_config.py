import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core.config import DEFAULT_CONFIG, load_config, patch_config


class CloudConfigTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = patch("core.runtime_paths.data_root", return_value=Path(self.tmp.name))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_default_cloud_approval_config_is_empty_and_disabled(self):
        cloud = DEFAULT_CONFIG["cloud_approval"]
        self.assertEqual(cloud["base_url"], "")
        self.assertEqual(cloud["machine_name"], "")
        self.assertFalse(cloud["machine_enabled"])
        self.assertEqual(cloud["capabilities"], ["generate_ai_image", "regenerate_ai_image", "submit_tmall_material_test"])

    def test_patch_config_expands_cloud_approval_keys(self):
        cfg = patch_config({
            "cloud_approval.base_url": "https://ai-review.example.com",
            "cloud_approval.machine_name": "设计部任务机01",
            "cloud_approval.machine_enabled": True,
        })
        self.assertEqual(cfg["cloud_approval"]["base_url"], "https://ai-review.example.com")
        self.assertEqual(load_config()["cloud_approval"]["machine_name"], "设计部任务机01")
        self.assertTrue(load_config()["cloud_approval"]["machine_enabled"])
