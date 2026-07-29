import unittest
import json
from pathlib import Path

import yaml

from core.models import ParamType


def _manifest_param_type_enum():
    schema = json.loads(Path("sdk/manifest.schema.json").read_text(encoding="utf-8"))
    return schema["definitions"]["param"]["properties"]["type"]["enum"]


class TemuManifestTests(unittest.TestCase):
    def test_manifest_schema_param_types_match_core_param_type_enum(self):
        schema_types = set(_manifest_param_type_enum())
        core_types = {item.value for item in ParamType}

        self.assertEqual(schema_types, core_types)

    def test_storefront_single_product_reviews_is_first_and_accepts_multi_links(self):
        manifest = yaml.safe_load(Path("adapters/temu/manifest.yaml").read_text(encoding="utf-8"))
        first_task = manifest["tasks"][0]

        self.assertEqual(first_task["id"], "single_product_reviews")
        self.assertEqual(first_task["name"], "商城-单款商品评价")

        product_param = next(item for item in first_task["params"] if item["id"] == "product_url")
        self.assertEqual(product_param["type"], "line_list")
        self.assertIn("每行", product_param.get("hint", ""))

        output_filename = first_task["output"][0]["filename"]
        self.assertEqual(output_filename, "单款商品评价_{goods_id}_{timestamp}.xlsx")
        self.assertNotIn("{shop_name}", output_filename)

    def test_compliant_live_photos_target_spu_params_are_mode_scoped(self):
        manifest = yaml.safe_load(Path("adapters/temu/manifest.yaml").read_text(encoding="utf-8"))
        task = next(item for item in manifest["tasks"] if item["id"] == "compliant_live_photos_label")
        params = {item["id"]: item for item in task["params"]}

        self.assertEqual(
            params["retry_result_file"]["visible_when"],
            {"field": "compensation_mode", "equals": "retry_failed_from_file"},
        )
        self.assertEqual(params["target_spus"]["type"], "textarea")
        self.assertEqual(params["target_spus"]["visible_when"], {"field": "compensation_mode", "equals": "target_spus"})
        self.assertEqual(params["goods_statuses"]["visible_when"], {"field": "compensation_mode", "not_equals": "target_spus"})
        self.assertIn("换行", params["target_spus"]["hint"])

    def test_wash_label_official_pdf_download_is_api_first_and_official_only(self):
        manifest = yaml.safe_load(Path("adapters/temu/manifest.yaml").read_text(encoding="utf-8"))
        task = next(item for item in manifest["tasks"] if item["id"] == "wash_label_official_pdf_download")
        params = {item["id"]: item for item in task["params"]}

        self.assertEqual(manifest["version"], "1.5.8")
        self.assertEqual(task["script"], "wash-label-official-pdf-download.js")
        self.assertEqual(task["entry_url"], "https://agentseller.temu.com/goods/label")
        self.assertIn("已制作", task["description"])
        self.assertIn("全部", task["description"])
        self.assertIn("不会制作、编辑或保存", task["description"])
        self.assertEqual(params["store_name"]["type"], "select")
        self.assertEqual(params["store_name"]["default"], "balabala Official Shop")
        self.assertEqual(
            [option["value"] for option in params["store_name"]["options"]],
            [
                "minibala Kids Shop",
                "SEMIR Official Shop",
                "balabala Official Shop",
                "Balabala Shoes",
            ],
        )
        self.assertNotIn("sku_code", params)
        self.assertNotIn("sku_no", params)
        self.assertEqual(params["input_file"]["type"], "file_excel")
        self.assertIn("洗唛需求", params["input_file"]["hint"])
        self.assertEqual(params["pilot_style"]["default"], "209225117208")
        self.assertEqual(params["max_skc"]["default"], 0)
        self.assertEqual(params["max_downloads"]["default"], 0)
        self.assertIn("0", params["max_downloads"]["hint"])
        self.assertEqual(params["timeout_seconds"]["default"], 60)
        self.assertEqual(task["output"][0]["filename"], "wash-label-download-diagnostic_{timestamp}.json")

    def test_wash_label_create_and_download_is_guarded_full_chain(self):
        manifest = yaml.safe_load(Path("adapters/temu/manifest.yaml").read_text(encoding="utf-8"))
        task = next(item for item in manifest["tasks"] if item["id"] == "wash_label_create_and_download")
        params = {item["id"]: item for item in task["params"]}

        self.assertEqual(task["script"], "wash-label-create-and-download.js")
        self.assertEqual(task["entry_url"], "https://agentseller.temu.com/goods/label")
        self.assertIn("默认 dry-run 不保存", task["description"])
        self.assertIn("回读", task["description"])
        self.assertEqual(params["input_file"]["type"], "file_excel")
        self.assertTrue(params["input_file"]["required"])
        self.assertEqual(params["max_skc"]["default"], 1)
        self.assertEqual(params["execute_mode"]["default"], "dry_run")
        self.assertEqual(
            [option["value"] for option in params["execute_mode"]["options"]],
            ["dry_run", "create_and_download"],
        )
        self.assertEqual(params["allow_save"]["type"], "checkbox")
        self.assertFalse(params["allow_save"]["default"])
        self.assertEqual(params["download_after_save"]["default"], True)
        self.assertEqual(params["skip_already_made"]["default"], True)
        self.assertEqual(params["care_symbols_mode"]["default"], "pilot_defaults")
        self.assertEqual(params["care_symbols_json"]["visible_when"], {"field": "care_symbols_mode", "equals": "manual_json"})
        self.assertEqual(params["manufacturer_name"]["default"], "Zhejiang Semir Garment Co.,Ltd.")
        self.assertEqual(params["production_date"]["default"], "2026-06-01")
        self.assertEqual(params["batch_number"]["default"], "PC260601")
        self.assertEqual(params["label_width_mm"]["default"], 35)
        self.assertEqual(params["label_length_mm"]["default"], 235)
        self.assertEqual(params["label_padding_mm"]["default"], 10)
        self.assertEqual(task["output"][0]["filename"], "wash-label-create-and-download-diagnostic_{timestamp}.json")


if __name__ == "__main__":
    unittest.main()
