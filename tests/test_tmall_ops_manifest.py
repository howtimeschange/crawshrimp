from pathlib import Path
import unittest

import yaml


MANIFEST_PATH = Path("adapters/tmall-ops-assistant/manifest.yaml")
TEMPLATE_PATH = Path("adapters/tmall-ops-assistant/templates/tmall-packaging-upload-template.csv")


class TmallOpsManifestTests(unittest.TestCase):
    def test_manifest_declares_packaging_upload_task_under_tmall_ops(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
        task = next(item for item in manifest["tasks"] if item["id"] == "tmall_packaging_upload")
        params = {item["id"]: item for item in task["params"]}
        output_columns = task["output"][0]["columns"]

        self.assertEqual(manifest["id"], "tmall-ops-assistant")
        self.assertEqual(manifest["version"], "0.1.1")
        self.assertEqual(task["name"], "天猫包装图片上传")
        self.assertEqual(task["script"], "tmall-packaging-upload.js")
        self.assertEqual(task["entry_url"], "https://fmp.semirapp.com/web/index#/home/file")
        self.assertTrue(task["skip_auth"])
        self.assertIn("https://fmp.semirapp.com/", task["tab_match_prefixes"])
        self.assertIn("https://sell.publish.tmall.com/", task["tab_match_prefixes"])
        self.assertEqual(params["execute_mode"]["default"], "plan")
        execute_options = {item["value"]: item["label"] for item in params["execute_mode"]["options"]}
        self.assertIn("upload_draft", execute_options)
        self.assertIn("publish_and_sync_mobile", execute_options)
        self.assertIn("完整发布", execute_options["publish_and_sync_mobile"])
        self.assertIn("优先通过天猫页面 API", params["execute_mode"]["hint"])
        self.assertEqual(params["input_file"]["type"], "file_excel")
        self.assertTrue(params["input_file"]["required"])
        self.assertNotIn("style_code", params)
        self.assertNotIn("item_id", params)
        self.assertEqual(
            params["input_file"]["templates"][0]["file"],
            "templates/tmall-packaging-upload-template.csv",
        )
        self.assertTrue(TEMPLATE_PATH.exists())
        self.assertIn("巴拉巴拉品牌事业部-市场系统//品牌视觉部", params["cloud_path"]["default"])
        self.assertEqual(params["block_on_style_mismatch"]["type"], "checkbox")
        self.assertTrue(params["block_on_style_mismatch"]["default"])
        self.assertEqual(params["package_name"]["default"], "天猫包装图片包")
        self.assertEqual(output_columns[0], "表格行号")
        self.assertIn("上传结果", output_columns)
        self.assertIn("天猫货号", output_columns)


if __name__ == "__main__":
    unittest.main()
