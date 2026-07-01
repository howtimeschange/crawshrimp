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

    def test_ai_image_test_chain_exposes_only_approval_and_direct_create_modes(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
        tasks_by_id = {item["id"]: item for item in manifest["tasks"]}
        task = tasks_by_id["tmall_ai_image_test_chain"]
        data_export_task = tasks_by_id["tmall_material_test_data_export"]
        params = {item["id"]: item for item in task["params"]}
        execute_mode = params["execute_mode"]
        options = {item["value"]: item["label"] for item in execute_mode["options"]}
        output_columns = task["output"][0]["columns"]

        self.assertNotIn("tmall_ai_image_generation", tasks_by_id)
        self.assertNotIn("tmall_material_test_pipeline", tasks_by_id)
        self.assertEqual(task["name"], "巴拉-AI测图全链路")
        self.assertEqual(data_export_task["name"], "巴拉-AI测图数据抓取导出")
        self.assertEqual(task["entry_url"], "https://fmp.semirapp.com/web/index#/home/file")
        self.assertIn("https://fmp.semirapp.com/", task["tab_match_prefixes"])
        self.assertIn("https://iam.semirapp.com/", task["tab_match_prefixes"])
        self.assertNotIn("https://myseller.taobao.com/", task["tab_match_prefixes"])
        self.assertEqual(task["output"][0]["filename"], "巴拉-AI测图全链路执行证据_{timestamp}.xlsx")
        self.assertEqual(data_export_task["output"][0]["filename"], "巴拉-AI测图数据抓取导出_{timestamp}.xlsx")
        self.assertEqual(params["output_dir"]["type"], "directory")
        self.assertIn("本地导出目录", params["output_dir"]["label"])
        self.assertIn("网盘素材图", params["output_dir"]["hint"])
        self.assertIn("AI生成图", params["output_dir"]["hint"])
        self.assertIn(r"%USERPROFILE%\Downloads", params["output_dir"]["hint"])
        self.assertNotIn("~/Downloads", params["output_dir"]["hint"])
        data_export_params = {item["id"]: item for item in data_export_task["params"]}
        self.assertEqual(data_export_params["output_dir"]["type"], "directory")
        self.assertIn("本地导出目录", data_export_params["output_dir"]["label"])
        self.assertIn("数据表格", data_export_params["output_dir"]["hint"])
        self.assertIn(r"%USERPROFILE%\Downloads", data_export_params["output_dir"]["hint"])
        self.assertNotIn("~/Downloads", data_export_params["output_dir"]["hint"])
        self.assertEqual(execute_mode["default"], "approval_then_create")
        self.assertEqual(list(options), ["approval_then_create", "direct_create"])
        self.assertIn("审批", options["approval_then_create"])
        self.assertIn("直接创建", options["direct_create"])
        self.assertNotIn("plan", options)
        self.assertNotIn("generate", options)
        self.assertNotIn("live_online", options)
        self.assertNotIn("limit", params)
        self.assertEqual(params["ai_image_count"]["label"], "每款Prompt生图数")
        self.assertIn("不同提示词", params["ai_image_count"]["hint"])
        self.assertIn("每条 prompt 生成 1 张", params["ai_image_count"]["hint"])
        self.assertIn("钉钉", params["approval_message_template"]["label"])
        self.assertIn("审批看板", output_columns)
        self.assertIn("审批批次ID", output_columns)
        self.assertIn("审批状态", output_columns)


if __name__ == "__main__":
    unittest.main()
