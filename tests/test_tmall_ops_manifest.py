from pathlib import Path
import unittest

import yaml

from core.models import AdapterManifest


MANIFEST_PATH = Path("adapters/tmall-ops-assistant/manifest.yaml")
TEMPLATE_PATH = Path("adapters/tmall-ops-assistant/templates/tmall-packaging-upload-template.csv")


class TmallOpsManifestTests(unittest.TestCase):
    def test_manifest_parses_through_backend_schema(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
        parsed = AdapterManifest(**manifest)

        self.assertEqual(parsed.id, "tmall-ops-assistant")
        task = next(item for item in parsed.tasks if item.id == "tmall_ai_image_test_chain")
        params = {item.id: item for item in task.params}
        ratio_labels = [item.label for item in params["ratio"].options or []]
        self.assertEqual(ratio_labels, ["1:1", "3:4", "4:3", "4:5", "3:2", "2:3", "16:9", "9:16"])

    def test_manifest_declares_packaging_upload_task_under_tmall_ops(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
        task = next(item for item in manifest["tasks"] if item["id"] == "tmall_packaging_upload")
        params = {item["id"]: item for item in task["params"]}
        output_columns = task["output"][0]["columns"]

        self.assertEqual(manifest["id"], "tmall-ops-assistant")
        self.assertEqual(manifest["version"], "0.1.3")
        self.assertEqual(task["name"], "天猫包装图片上传")
        self.assertEqual(task["script"], "tmall-packaging-upload.js")
        self.assertEqual(task["entry_url"], "https://fmp.semirapp.com/web/index#/home/file")
        self.assertTrue(task["skip_auth"])
        self.assertIn("https://fmp.semirapp.com/", task["tab_match_prefixes"])
        self.assertIn("https://sell.publish.tmall.com/", task["tab_match_prefixes"])
        self.assertEqual(params["execute_mode"]["default"], "plan")
        execute_options = {item["value"]: item["label"] for item in params["execute_mode"]["options"]}
        self.assertEqual(list(execute_options), ["plan", "publish_and_sync_mobile"])
        self.assertIn("只下载图包", execute_options["plan"])
        self.assertIn("完整发布", execute_options["publish_and_sync_mobile"])
        self.assertIn("不进入天猫发布页", params["execute_mode"]["hint"])
        self.assertIn("同步手机端详情", params["execute_mode"]["hint"])
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
        self.assertFalse(params["block_on_style_mismatch"]["default"])
        self.assertEqual(params["candidate_cloud_paths"]["type"], "textarea")
        self.assertEqual(params["package_name"]["default"], "天猫包装图片包")
        self.assertEqual(output_columns[0], "表格行号")
        self.assertIn("上传结果", output_columns)
        self.assertIn("天猫货号", output_columns)

    def test_manifest_declares_compete_paid_monitor_task(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
        task = next(item for item in manifest["tasks"] if item["id"] == "tmall_compete_paid_monitor")
        params = {item["id"]: item for item in task["params"]}
        output = task["output"][0]
        sheets = {item["name"]: item for item in output["sheets"]}

        self.assertEqual(task["name"], "天猫-竞品付费投放数据监控")
        self.assertEqual(task["script"], "tmall-compete-paid-monitor.js")
        self.assertIn("dmp.taobao.com/index_new.html", task["entry_url"])
        self.assertIn("https://dmp.taobao.com/index_new.html", task["tab_match_prefixes"])
        self.assertTrue(task["skip_auth"])
        self.assertEqual(params["mode"]["default"], "new")
        self.assertIn("全新页面", params["mode"]["options"][0]["label"])
        self.assertNotIn("stat_week_mode", params)
        self.assertIn("巴拉巴拉官方旗舰", params["shop_list"]["default"])
        self.assertIn("moodytiger旗舰店", params["shop_list"]["default"])
        self.assertNotIn("店铺定位", params["shop_list"]["default"])
        self.assertNotIn("\t", params["shop_list"]["default"])
        self.assertEqual(params["max_competitors_per_batch"]["default"], 3)
        self.assertTrue(params["max_competitors_per_batch"]["hidden"])
        self.assertEqual(output["sheet_key"], "__sheet_name")
        self.assertEqual(output["filename"], "天猫竞品付费投放数据监控_{timestamp}.xlsx")
        self.assertIn("汇总", sheets)
        self.assertIn("工具汇总", sheets)
        self.assertIn("明细", sheets)
        self.assertIn("店铺解析", sheets)
        self.assertIn("采集日志", sheets)
        self.assertIn("投放费用", sheets["汇总"]["columns"])
        self.assertIn("分工具PPC", sheets["工具汇总"]["columns"])
        self.assertIn("数据来源", sheets["明细"]["columns"])

    def test_manifest_declares_compete_member_monitor_task(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
        task = next(item for item in manifest["tasks"] if item["id"] == "tmall_compete_member_monitor")
        params = {item["id"]: item for item in task["params"]}
        output_columns = task["output"][0]["columns"]

        self.assertEqual(task["name"], "天猫-竞品会员页面监控")
        self.assertEqual(task["script"], "tmall-compete-member-monitor.js")
        self.assertIn("market.m.taobao.com/app/sj/member-center-rax", task["entry_url"])
        self.assertIn("https://market.m.taobao.com/app/sj/member-center-rax/pages/pages_index_index", task["tab_match_prefixes"])
        self.assertFalse(task["skip_auth"])
        self.assertEqual(params["mode"]["default"], "new")
        self.assertIn("全新页面", params["mode"]["options"][0]["label"])
        self.assertEqual(params["input_file"]["type"], "file_excel")
        self.assertEqual(params["member_urls"]["type"], "textarea")
        self.assertEqual(params["output_dir"]["type"], "directory")
        self.assertNotIn("screenshot_limit", params)
        self.assertTrue(params["scroll_rounds"]["hidden"])
        self.assertEqual(task["output"][0]["filename"], "天猫竞品会员页面监控_{timestamp}.xlsx")
        self.assertIn("截图文件", output_columns)
        self.assertIn("截图高度", output_columns)

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
        self.assertEqual(
            params["cloud_path"]["default"],
            "巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/",
        )
        data_export_params = {item["id"]: item for item in data_export_task["params"]}
        self.assertEqual(data_export_params["output_dir"]["type"], "directory")
        self.assertIn("本地导出目录", data_export_params["output_dir"]["label"])
        self.assertIn("数据表格", data_export_params["output_dir"]["hint"])
        self.assertIn(r"%USERPROFILE%\Downloads", data_export_params["output_dir"]["hint"])
        self.assertNotIn("~/Downloads", data_export_params["output_dir"]["hint"])
        self.assertEqual(data_export_params["sync_to_cloud"]["type"], "checkbox")
        self.assertEqual(data_export_params["sync_to_cloud"]["default"], [])
        self.assertEqual(data_export_params["sync_to_cloud"]["options"][0]["value"], "enabled")
        self.assertIn("云端测图数据看板", data_export_params["sync_to_cloud"]["hint"])
        self.assertEqual(params["mode"]["default"], "new")
        mode_options = {item["value"]: item["label"] for item in params["mode"]["options"]}
        self.assertEqual(list(mode_options), ["new", "current"])
        self.assertIn("全新页面", mode_options["new"])
        self.assertEqual(execute_mode["default"], "approval_then_create")
        self.assertEqual(list(options), ["approval_then_create", "direct_create"])
        self.assertIn("审批", options["approval_then_create"])
        self.assertIn("直接创建", options["direct_create"])
        self.assertNotIn("plan", options)
        self.assertNotIn("generate", options)
        self.assertNotIn("live_online", options)
        self.assertNotIn("limit", params)
        self.assertEqual(params["prompt_source"]["type"], "radio")
        self.assertEqual(params["prompt_source"]["default"], "local_excel")
        prompt_source_options = {item["value"]: item["label"] for item in params["prompt_source"]["options"]}
        self.assertEqual(list(prompt_source_options), ["local_excel", "cloud_prompt_library"])
        self.assertIn("线下表格", prompt_source_options["local_excel"])
        self.assertIn("线上 Prompt 库", prompt_source_options["cloud_prompt_library"])
        self.assertEqual(params["prompt_file"]["visible_when"], {"field": "prompt_source", "equals": "local_excel"})
        self.assertTrue(params["prompt_file"]["required"])
        self.assertEqual(params["cloud_prompt_library_id"]["type"], "text")
        self.assertTrue(params["cloud_prompt_library_id"]["required"])
        self.assertEqual(params["cloud_prompt_library_id"]["visible_when"], {"field": "prompt_source", "equals": "cloud_prompt_library"})
        self.assertEqual(params["model_id"]["label"], "生图模型")
        self.assertEqual(params["model_id"]["default"], "gpt-image-4k")
        model_options = {item["value"]: item["label"] for item in params["model_id"]["options"]}
        self.assertEqual(
            list(model_options),
            [
                "gpt-image-2k",
                "gpt-image-4k",
                "gemini-3.1-flash-image-preview",
                "gemini-3-pro-image-preview",
            ],
        )
        self.assertEqual(model_options["gpt-image-4k"], "GPT Image 4K")
        self.assertEqual(params["ratio"]["label"], "比例")
        self.assertEqual(params["ratio"]["default"], "3:4")
        self.assertIn("9:16", [item["value"] for item in params["ratio"]["options"]])
        self.assertEqual(params["image_size"]["label"], "尺寸")
        self.assertEqual(params["image_size"]["default"], "1536x2048")
        self.assertIn("1536x2048", [item["value"] for item in params["image_size"]["options"]])
        self.assertEqual(params["ai_image_count"]["label"], "每款挑选 Prompt 条数")
        self.assertIn("每款选择多少条不同提示词", params["ai_image_count"]["hint"])
        self.assertIn("单 prompt 生图张数在确认提交页选择", params["ai_image_count"]["hint"])
        for hidden_param in [
            "allow_global_semir_fallback",
            "generation_concurrency",
            "one_xm_key_tier",
            "retry_attempts",
            "compensate_attempts",
            "poll_timeout_minutes",
        ]:
            self.assertTrue(params[hidden_param]["hidden"], hidden_param)
        self.assertEqual(params["one_xm_key_tier"]["default"], "4k")
        self.assertIn("钉钉", params["approval_message_template"]["label"])
        self.assertIn("审批看板", output_columns)
        self.assertIn("审批批次ID", output_columns)
        self.assertIn("审批状态", output_columns)


if __name__ == "__main__":
    unittest.main()
