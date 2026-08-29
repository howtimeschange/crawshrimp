from pathlib import Path
import unittest

import yaml


MANIFEST_PATH = Path("adapters/semir-cloud-drive/manifest.yaml")


class SemirCloudDriveManifestTests(unittest.TestCase):
    def test_manifest_declares_buyer_show_ai_generate_task(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
        self.assertEqual(manifest["version"], "0.1.4")
        task = next(item for item in manifest["tasks"] if item["id"] == "buyer_show_ai_generate")
        params = {item["id"]: item for item in task["params"]}
        output_columns = task["output"][0]["columns"]

        self.assertEqual(task["name"], "AI 买家秀全链路 MVP")
        self.assertEqual(task["script"], "buyer-show-ai-generate.js")
        self.assertFalse(task["skip_auth"])
        self.assertEqual(params["input_file"]["type"], "file_excel")
        self.assertTrue(params["input_file"]["required"])
        self.assertEqual(params["flat_cloud_path"]["default"], "巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/")
        self.assertEqual(params["mode"]["default"], "new")
        mode_labels = {item["value"]: item["label"] for item in params["mode"]["options"]}
        self.assertEqual(mode_labels["new"], "全新页面（推荐）")
        self.assertEqual(mode_labels["current"], "当前页面")
        self.assertEqual(params["execute_mode"]["default"], "generate")
        self.assertIn({"value": "resume", "label": "续跑原图包"}, params["execute_mode"]["options"])
        self.assertEqual(params["resume_package_dir"]["type"], "directory")
        self.assertEqual(params["model_id"]["label"], "生图模型")
        self.assertEqual(params["model_id"]["default"], "gpt-image-4k")
        self.assertEqual(
            [item["value"] for item in params["model_id"]["options"]],
            [
                "gpt-image-2k",
                "gpt-image-4k",
                "gemini-3.1-flash-image-preview",
                "gemini-3-pro-image-preview",
            ],
        )
        self.assertEqual(params["max_generate_jobs"]["default"], 0)
        self.assertTrue(params["max_generate_jobs"]["hidden"])
        self.assertEqual(params["max_model_images_per_row"]["default"], 500)
        self.assertTrue(params["max_model_images_per_row"]["hidden"])
        self.assertEqual(params["image_size"]["default"], "source_ratio")
        self.assertTrue(params["image_size"]["hidden"])
        self.assertEqual(params["ai_generation_concurrency"]["default"], 5)
        self.assertTrue(params["ai_generation_concurrency"]["hidden"])
        self.assertEqual(params["ai_result_download_concurrency"]["default"], 10)
        self.assertEqual(params["ai_result_download_concurrency"]["max"], 20)
        self.assertTrue(params["ai_result_download_concurrency"]["hidden"])
        self.assertIn("~/Downloads/AI 买家秀全量测试", params["export_folder"]["hint"])
        self.assertEqual(params["input_file"]["templates"][0]["file"], "templates/buyer-show-ai-template.csv")
        self.assertIn("模拍云盘路径", output_columns)
        self.assertIn("模拍细分文件夹", output_columns)
        self.assertIn("平铺云盘路径", output_columns)
        self.assertIn("生图结果", output_columns)

    def test_manifest_declares_tmall_material_new_624_task(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
        task = next(item for item in manifest["tasks"] if item["id"] == "tmall_material_new_624")
        params = {item["id"]: item for item in task["params"]}

        self.assertEqual(task["name"], "森马-天猫AI生图参考素材准备")
        self.assertEqual(task["script"], "tmall-material-match-buy.js")
        self.assertEqual(params["asset_rule"]["default"], "new_624")
        self.assertTrue(params["asset_rule"]["hidden"])
        self.assertEqual(params["skc_codes"]["type"], "textarea")
        self.assertTrue(params["skc_codes"]["required"])
        self.assertNotIn("input_file", params)
        self.assertNotIn("match_dimension", params)
        self.assertIn("26Q3/模特/服饰/AI", params["cloud_path"]["default"])
        self.assertEqual(params["package_name"]["default"], "天猫素材新624图片包")



if __name__ == "__main__":
    unittest.main()
