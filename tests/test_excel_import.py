import tempfile
import unittest
import zipfile
import re
from pathlib import Path

from openpyxl import Workbook, load_workbook

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

    def test_rows_raw_to_table_keeps_trailing_unnamed_data_column(self):
        table = _rows_raw_to_table([
            ["ID", "标题", "视频", "文案", None],
            ["1068531817393", "短视频标题", "C:/video.mp4", "模板文案", "毛衫"],
            ["1068531817394", "短视频标题2", "C:/video2.mp4", "模板文案2", "T恤"],
        ])

        self.assertEqual(table["headers"], ["ID", "标题", "视频", "文案", "列5"])
        self.assertEqual(table["total"], 2)
        self.assertEqual(table["rows"][0]["ID"], "1068531817393")
        self.assertEqual(table["rows"][0]["列5"], "毛衫")
        self.assertEqual(table["rows"][1]["ID"], "1068531817394")

    def test_rows_raw_to_table_collapses_trailing_grouped_header_with_identity_columns(self):
        table = _rows_raw_to_table([
            ["外层站点", "SPU", "流量情况", None, None, None],
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
                "流量情况/支付订单数",
                "流量情况/支付件数",
            ],
        )
        self.assertEqual(table["rows"][0]["流量情况/支付件数"], "3")

    def test_rows_raw_to_table_keeps_blank_optional_fields_before_unnamed_column(self):
        table = _rows_raw_to_table([
            ["款号", "ID", "定时/日", "定时/具体时间", "上传情况", "内容ID"],
            ["208426103206", "1068531817393", 46307, None, "", "", "毛衫"],
            ["208426106205", "1057751785354", 46307, None, "", "", "棉服"],
        ])

        self.assertEqual(table["total"], 2)
        self.assertEqual(table["headers"][-1], "列7")
        self.assertEqual(table["rows"][0]["ID"], "1068531817393")
        self.assertEqual(table["rows"][0]["列7"], "毛衫")

    def test_read_local_excel_preserves_text_number_and_general_ids(self):
        wb = Workbook()
        ws = wb.active
        ws.append(["款号", "ID", "内容ID"])
        expected_ids = ["1068531817393", "1057751785354", "1072125749433"]
        for row_no, (item_id, number_format) in enumerate(zip(expected_ids, ["@", "0", "General"]), 2):
            value = item_id if number_format == "@" else int(item_id)
            ws.append(["208426103206", value, None, "毛衫"])
            ws.cell(row_no, 2).number_format = number_format

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "id-formats.xlsx"
            wb.save(path)
            result = _read_local_excel(str(path))

        self.assertEqual(result["total"], 3)
        self.assertEqual([row["ID"] for row in result["rows"]], expected_ids)
        self.assertEqual(result["rows"][0]["列4"], "毛衫")

    def test_read_local_excel_keeps_unmerged_trailing_grouped_header_compatible(self):
        wb = Workbook()
        ws = wb.active
        ws.append(["SPU", "流量情况", None])
        ws.append([None, "曝光量", "点击量"])
        ws.append(["123", 100, 10])

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "unmerged-grouped.xlsx"
            wb.save(path)
            result = _read_local_excel(str(path))

        self.assertEqual(result["headers"], ["SPU", "流量情况/曝光量", "流量情况/点击量"])
        self.assertEqual(result["rows"], [{"SPU": "123", "流量情况/曝光量": "100", "流量情况/点击量": "10"}])

    def test_read_local_excel_recognizes_merged_group_without_identity_columns(self):
        wb = Workbook()
        ws = wb.active
        ws.merge_cells("A1:B1")
        ws["A1"] = "流量情况"
        ws.append(["曝光量", "点击量"])
        ws.append([100, 10])

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "merged-only-group.xlsx"
            wb.save(path)
            result = _read_local_excel(str(path))

        self.assertEqual(result["headers"], ["流量情况/曝光量", "流量情况/点击量"])
        self.assertEqual(result["rows"], [{"流量情况/曝光量": "100", "流量情况/点击量": "10"}])

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

    def test_read_local_excel_keeps_trailing_unnamed_data_column(self):
        wb = Workbook()
        ws = wb.active
        ws.title = "短视频上传"
        ws.append(["ID", "标题", "视频", "文案", None])
        ws.append(["1068531817393", "短视频标题", "C:/video.mp4", "模板文案", "毛衫"])
        ws.append(["1068531817394", "短视频标题2", "C:/video2.mp4", "模板文案2", "T恤"])

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "short-video.xlsx"
            wb.save(path)
            result = _read_local_excel(str(path))

        self.assertEqual(result["headers"], ["ID", "标题", "视频", "文案", "列5"])
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["rows"][0]["ID"], "1068531817393")
        self.assertEqual(result["rows"][0]["列5"], "毛衫")

    def test_read_local_excel_ignores_stale_worksheet_dimension(self):
        wb = Workbook()
        ws = wb.active
        ws.append(["款号", "ID（用于测图的ID）", "品类（后期匹配）", "模特性别"])
        ws.append(["208326100202", "1002178235142", "长袖T恤", "中性"])
        ws.append(["208426107201", "1051803908260", "羽绒服", "男"])

        with tempfile.TemporaryDirectory() as tmpdir:
            original_path = Path(tmpdir) / "source.xlsx"
            broken_path = Path(tmpdir) / "stale-dimension.xlsx"
            wb.save(original_path)

            with zipfile.ZipFile(original_path, "r") as source, zipfile.ZipFile(broken_path, "w") as target:
                for info in source.infolist():
                    payload = source.read(info.filename)
                    if info.filename == "xl/worksheets/sheet1.xml":
                        payload, count = re.subn(
                            rb'<dimension ref="[^"]+"',
                            b'<dimension ref="A1"',
                            payload,
                            count=1,
                        )
                        self.assertEqual(count, 1)
                        self.assertIn(b'<dimension ref="A1"', payload)
                    target.writestr(info, payload)

            result = _read_local_excel(str(broken_path))

        self.assertEqual(result["headers"], ["款号", "ID（用于测图的ID）", "品类（后期匹配）", "模特性别"])
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["rows"][1]["款号"], "208426107201")

    def test_rows_raw_to_table_ignores_trailing_blank_header_cells(self):
        table = _rows_raw_to_table([
            ["站点", "店铺", "优惠券品类", None, None],
            ["越南", "balabala2023.vn", "商店优惠券", None, None],
            ["泰国", "semir2022.th", "关注礼优惠券", None, None],
        ])

        self.assertEqual(table["headers"], ["站点", "店铺", "优惠券品类", "列4", "列5"])
        self.assertEqual(table["rows"][0]["站点"], "越南")
        self.assertEqual(table["rows"][0]["店铺"], "balabala2023.vn")
        self.assertEqual(table["rows"][1]["优惠券品类"], "关注礼优惠券")

    def test_shopee_template_exposes_custom_name_and_code_after_store(self):
        path = Path("adapters/shopee-plus-v2/Shopee优惠券批量设置模板（26.4.1）.xlsx")
        wb = load_workbook(path, read_only=True, data_only=True)
        try:
            ws = wb[wb.sheetnames[0]]
            headers = [cell for cell in next(ws.iter_rows(values_only=True))]
        finally:
            wb.close()

        self.assertEqual(headers[:6], [
            "站点",
            "店铺",
            "优惠券名称（可选）",
            "优惠码（可选，最多5位 A-Z/0-9）",
            "优惠券领取期限（开始）精确到分",
            "优惠券领取期限（结束）精确到分",
        ])
        self.assertEqual(
            headers,
            [
                "站点",
                "店铺",
                "优惠券名称（可选）",
                "优惠码（可选，最多5位 A-Z/0-9）",
                "优惠券领取期限（开始）精确到分",
                "优惠券领取期限（结束）精确到分",
                "是否提前显示\n优惠券（是：1/否：0）",
                "优惠券品类",
                "奖励类型",
                "折扣类型",
                "优惠限额",
                "最高优惠金额(无限制填：nocap)",
                "最低消费金额",
                "可使用总数",
                "每个买家可用的优惠券数量上限",
                "是否覆盖已有券（如果有冲突日期券，则取消旧券以这次新建的为准；是：1/否：0）",
            ],
        )


if __name__ == "__main__":
    unittest.main()
