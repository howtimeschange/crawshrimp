from pathlib import Path
import unittest

import yaml


MANIFEST_PATH = Path("adapters/vipshop-ops-assistant/manifest.yaml")


class VipshopOpsManifestTests(unittest.TestCase):
    def test_manifest_declares_light_supply_goods_report(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
        tasks = {item["id"]: item for item in manifest["tasks"]}
        task = tasks["light_supply_goods_report"]
        params = {item["id"]: item for item in task["params"]}
        output_columns = task["output"][0]["columns"]

        self.assertEqual(manifest["id"], "vipshop-ops-assistant")
        self.assertEqual(manifest["name"], "唯品会运营助手")
        self.assertEqual(manifest["version"], "0.2.0")
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

        self.assertEqual(task["name"], "包装+主图替换")
        self.assertEqual(task["script"], "vipshop-package-main-image-replace.js")
        self.assertEqual(task["entry_url"], "https://nov-admin.vip.com/admin/index.html#/normal/normalMerchandise")
        self.assertIn("https://pdc-portal.vip.com/", task["tab_match_prefixes"])
        self.assertEqual(params["mode"]["default"], "new")
        self.assertIn("推荐", params["mode"]["options"][1]["label"])
        self.assertEqual(params["execute_mode"]["default"], "plan")
        self.assertEqual(params["input_file"]["type"], "file_excel")
        self.assertTrue(params["input_file"]["required"])
        self.assertEqual(params["input_file"]["templates"][0]["file"], "templates/vipshop-package-main-image-replace-template.csv")
        self.assertEqual(params["material_root"]["type"], "directory")
        self.assertTrue(params["material_root"]["include_file_listing"])
        self.assertEqual(params["material_images"]["type"], "file_images")
        self.assertNotIn("operation_scope", params)
        self.assertEqual(params["upload_scope"]["label"], "上传功能")
        self.assertEqual(params["upload_scope"]["default"], ["full"])
        upload_options = {item["value"]: item["label"] for item in params["upload_scope"]["options"]}
        self.assertEqual(upload_options["full"], "完整上传")
        self.assertEqual(upload_options["main_image"], "只传主图")
        self.assertEqual(upload_options["detail_image"], "只传商详页")
        self.assertEqual(task["output"][0]["filename"], "唯品会包装主图替换预检_{timestamp}.xlsx")
        self.assertIn("V_SPU", output_columns)
        self.assertIn("P_SPU", output_columns)
        self.assertIn("目标颜色", output_columns)
        self.assertIn("接口路径", output_columns)

    def test_manifest_declares_hot_strategy_tracking_report(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
        tasks = {item["id"]: item for item in manifest["tasks"]}
        task = tasks["hot_strategy_tracking_report"]
        params = {item["id"]: item for item in task["params"]}
        output = task["output"][0]
        sheet_names = [item["name"] for item in output["sheets"]]

        self.assertEqual(task["name"], "爆款策略追踪报表")
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


if __name__ == "__main__":
    unittest.main()
