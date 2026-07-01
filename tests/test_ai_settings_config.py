import unittest
from unittest.mock import patch

from core.config import DEFAULT_CONFIG, load_config, save_config


class AiSettingsConfigTests(unittest.TestCase):
    def test_default_config_exposes_1xm_keys_without_real_secret_values(self):
        one_xm = DEFAULT_CONFIG["ai"]["1xm"]

        self.assertEqual(one_xm["gpt_image_2k_key"], "")
        self.assertEqual(one_xm["gpt_image_4k_key"], "")
        self.assertEqual(one_xm["base_url"], "https://api.1xm.ai/v1")
        self.assertEqual(DEFAULT_CONFIG["notify"]["dingtalk_secret"], "")

    def test_save_config_expands_dotted_settings_keys(self):
        with patch("core.config._config_path") as config_path:
            import tempfile
            from pathlib import Path

            with tempfile.TemporaryDirectory() as tmpdir:
                path = Path(tmpdir) / "config.json"
                config_path.return_value = path
                save_config({
                    "ai.1xm.gpt_image_2k_key": "unit-2k",
                    "notify.dingtalk_webhook": "https://example.test/hook",
                    "notify.dingtalk_secret": "unit-secret",
                })
                loaded = load_config()

        self.assertEqual(loaded["ai"]["1xm"]["gpt_image_2k_key"], "unit-2k")
        self.assertEqual(loaded["notify"]["dingtalk_webhook"], "https://example.test/hook")
        self.assertEqual(loaded["notify"]["dingtalk_secret"], "unit-secret")


if __name__ == "__main__":
    unittest.main()
