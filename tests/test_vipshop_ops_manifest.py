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
        self.assertEqual(manifest["version"], "0.1.0")
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


if __name__ == "__main__":
    unittest.main()
