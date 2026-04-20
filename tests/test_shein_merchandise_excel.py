import os
import tempfile
import unittest
import zipfile
from importlib.util import find_spec
from pathlib import Path
from unittest.mock import patch
from xml.etree import ElementTree as ET

import yaml

from core import data_sink


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "adapters" / "shein-helper" / "manifest.yaml"


class SheinMerchandiseExcelTest(unittest.TestCase):
    def _read_sheet_cells(self, xlsx_path: str, sheet_name: str) -> dict[str, str]:
        ns = {
            "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
            "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
        }
        with zipfile.ZipFile(xlsx_path) as archive:
            shared_strings = []
            if "xl/sharedStrings.xml" in archive.namelist():
                shared_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
                for item in shared_root.findall("main:si", ns):
                    text = "".join(node.text or "" for node in item.findall(".//main:t", ns))
                    shared_strings.append(text)

            workbook_root = ET.fromstring(archive.read("xl/workbook.xml"))
            rel_root = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
            rel_map = {
                rel.attrib["Id"]: rel.attrib["Target"]
                for rel in rel_root.findall("rel:Relationship", ns)
            }
            target = ""
            for sheet in workbook_root.findall("main:sheets/main:sheet", ns):
                if sheet.attrib.get("name") != sheet_name:
                    continue
                rel_id = sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
                target = rel_map.get(rel_id, "")
                break
            self.assertTrue(target, f"missing worksheet target for {sheet_name}")
            sheet_path = target.lstrip("/")
            if not sheet_path.startswith("xl/"):
                sheet_path = f"xl/{sheet_path}"

            sheet_root = ET.fromstring(archive.read(sheet_path))
            cells: dict[str, str] = {}
            for cell in sheet_root.findall(".//main:c", ns):
                ref = cell.attrib.get("r", "")
                if not ref:
                    continue
                if cell.attrib.get("t") == "inlineStr":
                    value = "".join(node.text or "" for node in cell.findall(".//main:is//main:t", ns))
                else:
                    value_node = cell.find("main:v", ns)
                    if value_node is None:
                        continue
                    value = value_node.text or ""
                    if cell.attrib.get("t") == "s":
                        value = shared_strings[int(value)]
                cells[ref] = value
            return cells

    def test_skc_sheet_uses_split_goods_fields_group(self):
        if find_spec("openpyxl") is None:
            self.skipTest("openpyxl is required for export_excel in this environment")

        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
        task = next(item for item in manifest["tasks"] if item["id"] == "merchandise_details")
        output = next(item for item in task["output"] if item["type"] == "excel")

        rows = [{
            "__sheet_name": "SKC列表",
            "商品字段/商品名称": "100%纯棉儿童字母印花T恤柔软透气轻便短袖休闲夏季上衣2-6岁",
            "商品字段/SKC": "sa260303103351937770319",
            "商品字段/SPU": "a2603031033519377",
            "商品字段/货号": "23022611720710501",
            "商品字段/品类": "婴儿 / 婴童（男）服装 / 婴童（男）上衣",
            "商品字段/标签": "新品畅销 / 备货款A / 在售 / 上架",
            "商品基本信息/活动标签": "活动中 / 即将开始活动",
            "商品基本信息/是否35天转备货": "是",
            "交易/销量": 23,
            "交易/支付订单数": 20,
            "流量/商品访客数": 572,
            "流量/支付人数": 18,
            "备货/备货订单数": 8,
            "备货/备货件数": 273,
            "操作": "查看趋势 / 质量分析",
            "筛选摘要": "站点=shein-all; 统计区间=20260413~20260419",
        }]

        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.dict(os.environ, {"CRAWSHRIMP_DATA": tmpdir}, clear=False):
                out_path = data_sink.export_excel(
                    rows,
                    adapter_id="shein-helper",
                    task_id="merchandise_details",
                    filename_template="test.xlsx",
                    sheet_key=output["sheet_key"],
                    sheet_configs=output["sheets"],
                )

            cells = self._read_sheet_cells(out_path, "SKC列表")
            self.assertEqual(cells["A1"], "商品字段")
            self.assertEqual(cells["G1"], "商品基本信息")
            self.assertEqual(cells["I1"], "交易")
            self.assertEqual(cells["K1"], "流量")
            self.assertEqual(cells["M1"], "备货")
            self.assertEqual(cells["O1"], "操作")
            self.assertEqual(cells["P1"], "筛选摘要")

            self.assertEqual(cells["A2"], "商品名称")
            self.assertEqual(cells["B2"], "SKC")
            self.assertEqual(cells["C2"], "SPU")
            self.assertEqual(cells["D2"], "货号")
            self.assertEqual(cells["E2"], "品类")
            self.assertEqual(cells["F2"], "标签")
            self.assertEqual(cells["G2"], "活动标签")
            self.assertEqual(cells["H2"], "是否35天转备货")
            self.assertEqual(cells["N2"], "备货件数")

            self.assertEqual(cells["A3"], "100%纯棉儿童字母印花T恤柔软透气轻便短袖休闲夏季上衣2-6岁")
            self.assertEqual(cells["B3"], "sa260303103351937770319")
            self.assertEqual(cells["F3"], "新品畅销 / 备货款A / 在售 / 上架")
            self.assertNotIn("Q1", cells)


if __name__ == "__main__":
    unittest.main()
