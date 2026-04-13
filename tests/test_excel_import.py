import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

from core.api_server import _read_local_excel, _rows_raw_to_table


class ExcelImportTests(unittest.TestCase):
    def test_rows_raw_to_table_keeps_single_header_layout(self):
        table = _rows_raw_to_table([
            ["SPU", "外层站点", "列表时间范围"],
            ["123", "全球", "近7日"],
        ])

        self.assertEqual(table["headers"], ["SPU", "外层站点", "列表时间范围"])
        self.assertEqual(table["rows"][0]["SPU"], "123")
        self.assertEqual(table["rows"][0]["外层站点"], "全球")

    def test_rows_raw_to_table_collapses_grouped_headers(self):
        table = _rows_raw_to_table([
            ["外层站点", "SPU", "流量情况", None, "搜索数据", None],
            [None, None, "曝光量", "点击量", "支付订单数", "支付件数"],
            ["全球", "123", "100", "10", "2", "3"],
        ])

        self.assertEqual(
            table["headers"],
            [
                "外层站点",
                "SPU",
                "流量情况/曝光量",
                "流量情况/点击量",
                "搜索数据/支付订单数",
                "搜索数据/支付件数",
            ],
        )
        self.assertEqual(table["rows"][0]["SPU"], "123")
        self.assertEqual(table["rows"][0]["流量情况/点击量"], "10")

    def test_read_local_excel_round_trips_grouped_header_workbook(self):
        wb = Workbook()
        ws = wb.active
        ws.title = "列表数据"
        ws.merge_cells("A1:A2")
        ws.merge_cells("B1:B2")
        ws.merge_cells("C1:F1")
        ws["A1"] = "外层站点"
        ws["B1"] = "SPU"
        ws["C1"] = "流量情况"
        ws["C2"] = "曝光量"
        ws["D2"] = "点击量"
        ws["E2"] = "支付订单数"
        ws["F2"] = "支付件数"
        ws.append(["全球", "123", "100", "10", "2", "3"])

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "grouped.xlsx"
            wb.save(path)
            result = _read_local_excel(str(path))

        self.assertEqual(result["sheet_name"], "列表数据")
        self.assertEqual(result["headers"][:4], ["外层站点", "SPU", "流量情况/曝光量", "流量情况/点击量"])
        self.assertEqual(result["rows"][0]["SPU"], "123")
        self.assertEqual(result["rows"][0]["流量情况/支付件数"], "3")


if __name__ == "__main__":
    unittest.main()
