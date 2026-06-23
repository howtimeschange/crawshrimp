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


if __name__ == "__main__":
    unittest.main()
