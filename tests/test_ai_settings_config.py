import unittest
from unittest.mock import patch

from core.config import DEFAULT_CONFIG, load_config, patch_config, save_config


class AiSettingsConfigTests(unittest.TestCase):
    def test_default_config_exposes_1xm_keys_without_real_secret_values(self):
        one_xm = DEFAULT_CONFIG["ai"]["1xm"]

        self.assertEqual(one_xm["gpt_image_2k_key"], "")
        self.assertEqual(one_xm["gpt_image_4k_key"], "")
        self.assertEqual(one_xm["gemini_3_1_flash_image_preview_key"], "")
        self.assertEqual(one_xm["gemini_3_pro_image_preview_key"], "")
        self.assertEqual(one_xm["base_url"], "https://api.1xm.ai/v1")
        self.assertEqual(DEFAULT_CONFIG["notify"]["dingtalk_secret"], "")

    def test_default_config_exposes_video_provider_fields_without_secret_values(self):
        video = DEFAULT_CONFIG["ai"]["video"]

        self.assertEqual(video["seedance_api_key"], "")
        self.assertEqual(video["bailian_api_key"], "")
        self.assertEqual(video["bailian_workspace_id"], "")
        self.assertEqual(video["bailian_region"], "cn-beijing")

    def test_save_config_expands_dotted_settings_keys(self):
        with patch("core.config._config_path") as config_path:
            import tempfile
            from pathlib import Path

            with tempfile.TemporaryDirectory() as tmpdir:
                path = Path(tmpdir) / "config.json"
                config_path.return_value = path
                save_config({
                    "ai.1xm.gpt_image_2k_key": "unit-2k",
                    "ai.1xm.gemini_3_1_flash_image_preview_key": "unit-flash",
                    "ai.1xm.gemini_3_pro_image_preview_key": "unit-pro",
                    "notify.dingtalk_webhook": "https://example.test/hook",
                    "notify.dingtalk_secret": "unit-secret",
                })
                loaded = load_config()

        self.assertEqual(loaded["ai"]["1xm"]["gpt_image_2k_key"], "unit-2k")
        self.assertEqual(loaded["ai"]["1xm"]["gemini_3_1_flash_image_preview_key"], "unit-flash")
        self.assertEqual(loaded["ai"]["1xm"]["gemini_3_pro_image_preview_key"], "unit-pro")
        self.assertEqual(loaded["notify"]["dingtalk_webhook"], "https://example.test/hook")
        self.assertEqual(loaded["notify"]["dingtalk_secret"], "unit-secret")

    def test_patch_config_updates_only_targeted_settings(self):
        with patch("core.config._config_path") as config_path:
            import tempfile
            from pathlib import Path

            with tempfile.TemporaryDirectory() as tmpdir:
                path = Path(tmpdir) / "config.json"
                config_path.return_value = path
                save_config({
                    "notify.dingtalk_webhook": "https://example.test/old",
                    "notify.feishu_webhook": "https://open.feishu.cn/old",
                    "data_dir": "/tmp/crawshrimp-data",
                })
                patch_config({
                    "notify.dingtalk_webhook": "https://example.test/new",
                })
                loaded = load_config()

        self.assertEqual(loaded["notify"]["dingtalk_webhook"], "https://example.test/new")
        self.assertEqual(loaded["notify"]["feishu_webhook"], "https://open.feishu.cn/old")
        self.assertEqual(loaded["data_dir"], "/tmp/crawshrimp-data")


if __name__ == "__main__":
    unittest.main()
