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

        self.assertEqual(manifest["version"], "1.5.14")
        self.assertTrue(task["hidden"])
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
        self.assertTrue(task["hidden"])
        self.assertEqual(task["entry_url"], "https://agentseller.temu.com/goods/label")
        self.assertIn("默认 dry-run 不保存", task["description"])
        self.assertIn("企业码", task["description"])
        self.assertIn("SCM", task["description"])
        self.assertIn("回读", task["description"])
        self.assertIn("成分只记录证据", task["description"])
        self.assertEqual(params["input_file"]["type"], "file_excel")
        self.assertFalse(params["input_file"]["required"])
        self.assertEqual(
            params["input_file"]["templates"][0]["file"],
            "templates/temu-wash-label-demand-template.csv",
        )
        self.assertEqual(params["input_file"]["templates"][0]["label"], "洗唛需求导入模板")
        template_path = Path("adapters/temu") / params["input_file"]["templates"][0]["file"]
        self.assertTrue(template_path.exists())
        template_header = template_path.read_text(encoding="utf-8").splitlines()[0]
        template_example = template_path.read_text(encoding="utf-8").splitlines()[1]
        self.assertEqual(
            template_header.split(","),
            ["款号", "制造商名称", "制造商地址", "生产日期", "批次号", "洗水唛宽度mm", "洗水唛长度mm", "上下预留mm"],
        )
        for deprecated_column in ("颜色", "尺码", "SKC", "SKU编码", "SKU货号", "洗唛成分", "产品线"):
            self.assertNotIn(deprecated_column, template_header)
        self.assertTrue(template_example.endswith(",,2024-10-01,PC241016,45,230,10"))
        self.assertIn("制造商名称", params["input_file"]["hint"])
        self.assertIn("制造商地址", params["input_file"]["hint"])
        self.assertEqual(params["enterprise_codes"]["type"], "textarea")
        self.assertIn("企业码", params["enterprise_codes"]["label"])
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
        self.assertEqual(params["scm_lookup"]["type"], "checkbox")
        self.assertEqual(params["scm_lookup"]["default"], True)
        self.assertEqual(params["scm_brand"]["default"], "auto")
        self.assertIn("20", [option["value"] for option in params["scm_brand"]["options"]])
        self.assertEqual(params["scm_only_completed"]["default"], True)
        self.assertEqual(params["scm_composition_mode"]["default"], "evidence_only")
        self.assertEqual(params["care_symbols_mode"]["default"], "scm_or_fixed")
        self.assertIn("fixed_defaults", [option["value"] for option in params["care_symbols_mode"]["options"]])
        self.assertIn("scm_confirmed_json", [option["value"] for option in params["care_symbols_mode"]["options"]])
        self.assertEqual(params["care_symbols_json"]["default"], '{"washing":10,"bleaching":3,"drying":5,"ironing":3,"dryCleaning":5}')
        self.assertEqual(params["care_symbols_json"]["visible_when"], {"field": "care_symbols_mode", "not_equals": "scm_or_fixed"})
        self.assertEqual(params["manufacturer_name"]["default"], "Zhejiang Semir Garment Co.,Ltd.")
        self.assertEqual(params["production_date"]["default"], "2026-06-01")
        self.assertEqual(params["batch_number"]["default"], "PC260601")
        self.assertEqual(params["label_width_mm"]["default"], 45)
        self.assertEqual(params["label_length_mm"]["default"], 235)
        self.assertEqual(params["label_padding_mm"]["default"], 10)
        self.assertEqual(task["output"][0]["filename"], "wash-label-create-and-download-diagnostic_{timestamp}.json")

    def test_ai_wash_label_create_is_style_first_ai_entry(self):
        manifest = yaml.safe_load(Path("adapters/temu/manifest.yaml").read_text(encoding="utf-8"))
        task = next(item for item in manifest["tasks"] if item["id"] == "ai_wash_label_create")
        params = {item["id"]: item for item in task["params"]}

        self.assertEqual(task["name"], "AI洗唛制作")
        self.assertEqual(task["script"], "wash-label-create-and-download.js")
        self.assertEqual(
            task["description"],
            "上传洗唛需求表后，自动读取 SCM 洗唛资料，批量制作 TEMU 洗水唛，并导出带尺码的官方 PDF。",
        )
        self.assertEqual(params["input_file"]["type"], "file_excel")
        self.assertTrue(params["input_file"]["required"])
        self.assertEqual(
            params["input_file"]["templates"][0]["file"],
            "templates/temu-wash-label-demand-template.csv",
        )
        self.assertIn("洗水唛宽度mm", params["input_file"]["hint"])
        self.assertIn("洗水唛长度mm", params["input_file"]["hint"])
        self.assertIn("上下预留mm", params["input_file"]["hint"])
        self.assertIn("生产日期", params["input_file"]["hint"])
        self.assertIn("具体日期", params["input_file"]["hint"])
        self.assertEqual(task["params"][0]["id"], "mode")
        self.assertEqual(task["params"][1]["id"], "execute_mode")
        self.assertEqual(task["params"][2]["id"], "store_name")
        self.assertEqual(task["params"][3]["id"], "input_file")
        self.assertEqual(task["params"][4]["id"], "output_dir")
        self.assertEqual(params["mode"]["default"], "new")
        self.assertEqual(params["output_dir"]["type"], "directory")
        self.assertIn("PDF 导出目录", params["output_dir"]["label"])
        self.assertIn("官方洗水唛 PDF", params["output_dir"]["hint"])
        self.assertEqual(params["style_codes"]["type"], "textarea")
        self.assertTrue(params["style_codes"]["hidden"])
        self.assertIn("208326104207", params["style_codes"]["hint"])
        self.assertEqual(params["enterprise_codes"]["type"], "textarea")
        self.assertTrue(params["enterprise_codes"]["hidden"])
        self.assertNotIn("max_skc", params)
        self.assertEqual(params["execute_mode"]["default"], "create_and_download")
        self.assertTrue(params["allow_save"]["default"])
        self.assertTrue(params["allow_save"]["hidden"])
        self.assertTrue(params["download_after_save"]["hidden"])
        self.assertTrue(params["skip_already_made"]["hidden"])
        self.assertTrue(params["scm_lookup"]["hidden"])
        self.assertTrue(params["scm_brand"]["hidden"])
        self.assertTrue(params["scm_only_completed"]["hidden"])
        self.assertTrue(params["care_symbols_mode"]["hidden"])
        self.assertEqual(params["ai_wash_instruction_recognition"]["default"], True)
        self.assertTrue(params["ai_wash_instruction_recognition"]["hidden"])
        self.assertEqual(params["ai_wash_instruction_model_id"]["default"], "gpt-5.5")
        self.assertTrue(params["ai_wash_instruction_model_id"]["hidden"])
        self.assertEqual(params["care_symbols_json"]["default"], '{"washing":13,"bleaching":3,"drying":4,"ironing":3,"dryCleaning":5}')
        self.assertTrue(params["care_symbols_json"]["hidden"])
        self.assertEqual(params["fixed_care_symbols_profile"]["default"], "dingtalk_sop")
        self.assertTrue(params["fixed_care_symbols_profile"]["hidden"])
        self.assertEqual(params["manufacturer_name"]["default"], "")
        self.assertEqual(params["manufacturer_address"]["default"], "")
        self.assertTrue(params["manufacturer_name"]["hidden"])
        self.assertTrue(params["manufacturer_address"]["hidden"])
        self.assertEqual(params["production_date"]["default"], "2024-10-01")
        self.assertTrue(params["production_date"]["hidden"])
        self.assertEqual(params["batch_number"]["default"], "PC241016")
        self.assertTrue(params["batch_number"]["hidden"])
        self.assertEqual(params["label_width_mm"]["default"], 45)
        self.assertTrue(params["label_width_mm"]["hidden"])
        self.assertEqual(params["label_length_mm"]["default"], 230)
        self.assertTrue(params["label_length_mm"]["hidden"])
        self.assertIn("20mm", params["label_length_mm"]["hint"])
        self.assertTrue(params["label_padding_mm"]["hidden"])
        self.assertEqual(params["timeout_seconds"]["default"], 60)
        self.assertTrue(params["timeout_seconds"]["hidden"])
        output_filenames = [item["filename"] for item in task["output"]]
        self.assertIn("ai-wash-label-create-result_{timestamp}.xlsx", output_filenames)
        self.assertIn("ai-wash-label-create-diagnostic_{timestamp}.json", output_filenames)
        excel_output = next(item for item in task["output"] if item["type"] == "excel")
        self.assertEqual(excel_output["columns"][0:5], ["店铺", "批量序号", "批量总数", "款号", "SKC"])
        self.assertIn("文件路径", excel_output["columns"])
        self.assertIn("SCM查询状态", excel_output["columns"])
        self.assertIn("安全打印区最终长度mm", excel_output["columns"])
        self.assertIn("原因", excel_output["columns"])


if __name__ == "__main__":
    unittest.main()
