from pathlib import Path
import unittest

import yaml


MANIFEST_PATH = Path("adapters/semir-cloud-drive/manifest.yaml")


class SemirCloudDriveManifestTests(unittest.TestCase):
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
