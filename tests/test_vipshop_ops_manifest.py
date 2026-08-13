from pathlib import Path
import zipfile
import unittest

import yaml


MANIFEST_PATH = Path("adapters/vipshop-ops-assistant/manifest.yaml")
PACKAGE_MAIN_TEMPLATE_XLSX_PATH = Path("adapters/vipshop-ops-assistant/templates/vipshop-package-main-image-replace-template.xlsx")
PACKAGE_MAIN_TEMPLATE_CSV_PATH = Path("adapters/vipshop-ops-assistant/templates/vipshop-package-main-image-replace-template.csv")
VIPSHOP_TESSERACT_VENDOR_PATH = Path("adapters/vipshop-ops-assistant/vendor/tesseract")


class VipshopOpsManifestTests(unittest.TestCase):
    def test_manifest_declares_light_supply_goods_report(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
        tasks = {item["id"]: item for item in manifest["tasks"]}
        task = tasks["light_supply_goods_report"]
        params = {item["id"]: item for item in task["params"]}
        output_columns = task["output"][0]["columns"]

        self.assertEqual(manifest["id"], "vipshop-ops-assistant")
        self.assertEqual(manifest["name"], "唯品会运营助手")
        self.assertEqual(manifest["version"], "0.2.3")
        self.assertEqual(task["name"], "轻供款商品报表")
        self.assertEqual(task["script"], "light-supply-goods-report.js")
        self.assertEqual(task["entry_url"], "https://compass.vip.com/frontend/index.html#/product/details")
        self.assertIn("https://compass.vip.com/", task["tab_match_prefixes"])
        self.assertEqual(params["input_file"]["type"], "file_excel")
        self.assertTrue(params["input_file"]["required"])
        self.assertIn("大货款号", params["input_file"]["hint"])
        self.assertIn("类别", params["input_file"]["hint"])
        self.assertEqual(params["target_category"]["default"], "轻供")
        self.assertEqual(params["page_size"]["default"], 500)
        self.assertIn("merchandise_info", params["report_scope"]["default"])
        self.assertIn("goods_detail", params["report_scope"]["default"])
        self.assertEqual(task["output"][0]["filename"], "唯品会轻供款商品报表_{timestamp}.xlsx")
        self.assertEqual(output_columns[0], "报表来源")
        self.assertIn("区分", output_columns)
        self.assertIn("款号", output_columns)
        self.assertIn("数据来源接口", output_columns)

    def test_manifest_declares_package_main_image_replace(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
        tasks = {item["id"]: item for item in manifest["tasks"]}
        task = tasks["package_main_image_replace"]
        params = {item["id"]: item for item in task["params"]}
        output_columns = task["output"][0]["columns"]

        self.assertEqual(task["name"], "【巴拉】包装+主图替换")
        self.assertEqual(task["script"], "vipshop-package-main-image-replace.js")
        self.assertEqual(task["entry_url"], "https://nov-admin.vip.com/admin/index.html#/normal/normalMerchandise")
        self.assertIn("https://pdc-portal.vip.com/", task["tab_match_prefixes"])
        self.assertEqual(params["mode"]["default"], "new")
        self.assertIn("推荐", params["mode"]["options"][1]["label"])
        self.assertEqual(params["execute_mode"]["default"], "plan")
        execute_options = {item["value"]: item["label"] for item in params["execute_mode"]["options"]}
        self.assertEqual(execute_options["plan"], "预检（不执行真实上传）")
        self.assertEqual(execute_options["live"], "找图并且真实上传")
        self.assertIn("不执行真实上传", params["execute_mode"]["hint"])
        self.assertIn("找图并且真实上传", params["execute_mode"]["hint"])
        self.assertEqual(params["input_file"]["type"], "file_excel")
        self.assertTrue(params["input_file"]["required"])
        self.assertEqual(params["input_file"]["templates"][0]["file"], "templates/vipshop-package-main-image-replace-template.xlsx")
        self.assertEqual(params["input_file"]["templates"][0]["version"], "2026.08.04.2")
        self.assertTrue(zipfile.is_zipfile(PACKAGE_MAIN_TEMPLATE_XLSX_PATH))
        with zipfile.ZipFile(PACKAGE_MAIN_TEMPLATE_XLSX_PATH) as workbook:
            self.assertIn("xl/worksheets/sheet1.xml", workbook.namelist())
            self.assertIn("xl/workbook.xml", workbook.namelist())
        template_header = PACKAGE_MAIN_TEMPLATE_CSV_PATH.read_text(encoding="utf-8").splitlines()[0]
        self.assertEqual(template_header, "款号,货号,包装图云盘主路径,打标图云盘根路径,备注")
        self.assertNotIn("候选云盘路径", PACKAGE_MAIN_TEMPLATE_CSV_PATH.read_text(encoding="utf-8"))
        self.assertEqual(
            params["cloud_path"]["default"],
            "巴拉巴拉品牌事业部-市场系统//品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/",
        )
        self.assertIn("商品展示图第3/4/5张", params["cloud_path"]["hint"])
        self.assertEqual(params["main_image_cloud_root"]["label"], "打标图云盘根路径")
        self.assertEqual(params["main_image_path_features"]["label"], "打标图路径特征")
        self.assertIn("页面 colourGSN", params["main_image_cloud_root"]["hint"])
        self.assertEqual(params["cloud_download_dir"]["type"], "directory")
        self.assertNotIn("include_file_listing", params["cloud_download_dir"])
        self.assertTrue(params["phase_eval_timeout_ms"]["hidden"])
        self.assertEqual(params["phase_eval_timeout_ms"]["default"], 180000)
        for hidden_id in [
            "allow_live",
            "enable_ocr_anchor_detection",
            "ocr_max_images",
            "use_semir_cloud",
            "material_root",
            "material_images",
            "page_size",
            "max_pages",
            "vendor_type",
            "candidate_cloud_paths",
            "main_image_candidate_cloud_paths",
        ]:
            self.assertNotIn(hidden_id, params)
        self.assertNotIn("operation_scope", params)
        self.assertEqual(params["upload_scope"]["label"], "上传功能")
        self.assertEqual(params["upload_scope"]["default"], ["full"])
        upload_options = {item["value"]: item["label"] for item in params["upload_scope"]["options"]}
        self.assertEqual(upload_options["full"], "完整上传")
        self.assertEqual(upload_options["main_image"], "只传打标图")
        self.assertEqual(upload_options["package"], "只传包装图（商详页+商品展示345）")
        self.assertIn("打标图包含商品展示图第1张", params["upload_scope"]["hint"])
        self.assertIn("包装图包含商详页图与商品展示图第3/4/5张", params["upload_scope"]["hint"])
        self.assertEqual(task["output"][0]["filename"], "唯品会包装主图替换预检_{timestamp}.xlsx")
        self.assertIn("V_SPU", output_columns)
        self.assertIn("P_SPU", output_columns)
        self.assertIn("目标颜色", output_columns)
        self.assertIn("接口路径", output_columns)

    def test_package_main_image_replace_bundles_own_tesseract_assets(self):
        expected_files = [
            "tesseract.min.js",
            "worker.min.js",
            "tesseract-core.js",
            "tesseract-core.wasm",
            "tesseract-core.wasm.js",
            "tesseract-core-simd.js",
            "tesseract-core-simd.wasm",
            "tesseract-core-simd.wasm.js",
            "tesseract-core-lstm.js",
            "tesseract-core-lstm.wasm",
            "tesseract-core-lstm.wasm.js",
            "tesseract-core-simd-lstm.js",
            "tesseract-core-simd-lstm.wasm",
            "tesseract-core-simd-lstm.wasm.js",
            "lang/chi_sim.traineddata.gz",
            "lang/eng.traineddata.gz",
        ]

        for relative_path in expected_files:
            self.assertTrue(
                (VIPSHOP_TESSERACT_VENDOR_PATH / relative_path).is_file(),
                f"missing bundled Vipshop OCR asset: {relative_path}",
            )

        self.assertGreater(
            (VIPSHOP_TESSERACT_VENDOR_PATH / "lang/chi_sim.traineddata.gz").stat().st_size,
            10 * 1024 * 1024,
            "Vipshop OCR should keep the complete Chinese traineddata package",
        )

    def test_manifest_declares_hot_strategy_tracking_report(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
        tasks = {item["id"]: item for item in manifest["tasks"]}
        task = tasks["hot_strategy_tracking_report"]
        params = {item["id"]: item for item in task["params"]}
        output = task["output"][0]
        sheet_names = [item["name"] for item in output["sheets"]]

        self.assertEqual(task["name"], "【巴拉】爆款策略追踪报表")
        self.assertEqual(task["script"], "hot-strategy-tracking-report.js")
        self.assertEqual(task["entry_url"], "https://compass.vip.com/frontend/index.html#/product/details")
        self.assertIn("https://bct.vip.com/", task["tab_match_prefixes"])
        self.assertIn("https://e.vip.com/", task["tab_match_prefixes"])
        self.assertEqual(params["mode"]["default"], "new")
        self.assertIn("compass_sales_detail", params["report_scope"]["default"])
        self.assertIn("vipdirect_ads", params["report_scope"]["default"])
        self.assertIn("tmax_goods", params["report_scope"]["default"])
        self.assertIn("bct_gift", params["report_scope"]["default"])
        self.assertIn("bct_scene", params["report_scope"]["default"])
        self.assertEqual(params["brand_keyword"]["default"], "巴拉巴拉")
        for date_param in [
            "start_date",
            "end_date",
            "vipdirect_start_date",
            "vipdirect_end_date",
            "tmax_start_date",
            "tmax_end_date",
            "bct_activity_start",
            "bct_activity_end",
        ]:
            self.assertEqual(params[date_param]["type"], "date")
        self.assertEqual(params["tmax_start_date"]["label"], "T-max开始日期")
        self.assertEqual(params["tmax_end_date"]["label"], "T-max结束日期")
        self.assertEqual(params["page_size"]["default"], 300)
        self.assertEqual(output["filename"], "唯品会爆款策略追踪报表_{timestamp}.xlsx")
        self.assertEqual(output["sheet_key"], "__sheet_name")
        self.assertIn("魔方罗盘销售明细", sheet_names)
        self.assertIn("唯直达投放效果", sheet_names)
        self.assertIn("T-max效果", sheet_names)
        self.assertIn("中台礼金", sheet_names)
        self.assertIn("中台购物车跨品类券", sheet_names)
        self.assertIn("数据来源接口", output["columns"])
        self.assertIn("加购成本", output["columns"])
        tmax_sheet = next(item for item in output["sheets"] if item["name"] == "T-max效果")
        self.assertIn("商品ID", tmax_sheet["columns"])
        self.assertIn("加购成本", tmax_sheet["columns"])
        self.assertIn("销售额", tmax_sheet["columns"])

    def test_manifest_declares_mop_sop_workflows(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
        tasks = {item["id"]: item for item in manifest["tasks"]}

        online = tasks["mop_online_status_statistics"]
        info = tasks["mop_info_table_download_upload"]
        new_arrival = tasks["mop_new_arrival_material_check"]

        self.assertEqual(online["name"], "MOP-唯品商品在线情况统计")
        self.assertEqual(online["script"], "MOP-vipshop-online-status-statistics.js")
        self.assertIn("https://nov-admin.vip.com/", online["tab_match_prefixes"])
        self.assertEqual(online["output"][1]["type"], "notify")
        self.assertEqual(online["output"][1]["channel"], "dingtalk")
        self.assertIn("上线数量环比", online["output"][0]["columns"])
        self.assertIn("下线数量环比", online["output"][0]["columns"])
        self.assertEqual(online["output"][0]["sheets"][0]["name"], "商品状态明细")
        self.assertEqual(online["output"][0]["sheets"][1]["name"], "执行摘要")

        self.assertEqual(info["name"], "MOP-唯品商品信息表下载并上传云盘")
        self.assertEqual(info["script"], "MOP-vipshop-info-table-download-upload.js")
        info_params = {item["id"]: item for item in info["params"]}
        self.assertIn("https://fmp.semirapp.com/", info["tab_match_prefixes"])
        self.assertIn("MOP品牌/4.运营/02-唯品", info_params["semir_cloud_path"]["default"])
        self.assertIn("网页上传状态", info["output"][0]["columns"])
        self.assertEqual(info["output"][1]["type"], "notify")
        self.assertIn("网页 API 上传完成接口读回", info["output"][1]["condition"])

        self.assertEqual(new_arrival["name"], "MOP-唯品商品上新资料检查")
        self.assertEqual(new_arrival["script"], "MOP-vipshop-new-arrival-material-check.js")
        new_params = {item["id"]: item for item in new_arrival["params"]}
        self.assertEqual(new_params["input_file"]["type"], "file_excel")
        self.assertTrue(new_params["input_file"]["required"])
        self.assertIn("禁售", new_params["forbidden_keywords"]["default"])
        self.assertIn("问题说明", new_arrival["output"][0]["columns"])
        self.assertEqual(new_arrival["output"][0]["sheets"][0]["name"], "上新资料检查明细")
        self.assertEqual(new_arrival["output"][0]["sheets"][1]["name"], "执行摘要")
        self.assertEqual(new_arrival["output"][1]["channel"], "dingtalk")


if __name__ == "__main__":
    unittest.main()
