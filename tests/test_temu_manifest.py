import unittest
from pathlib import Path

import yaml


class TemuManifestTests(unittest.TestCase):
    def test_storefront_single_product_reviews_is_first_and_accepts_multi_links(self):
        manifest = yaml.safe_load(Path("adapters/temu/manifest.yaml").read_text(encoding="utf-8"))
        first_task = manifest["tasks"][0]

        self.assertEqual(first_task["id"], "single_product_reviews")
        self.assertEqual(first_task["name"], "商城-单款商品评价")

        product_param = next(item for item in first_task["params"] if item["id"] == "product_url")
        self.assertEqual(product_param["type"], "line_list")
        self.assertIn("每行", product_param.get("hint", ""))


if __name__ == "__main__":
    unittest.main()
