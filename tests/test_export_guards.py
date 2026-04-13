import unittest

from core.api_server import _apply_final_export_guards


class ExportGuardTests(unittest.TestCase):
    def test_temu_goods_traffic_detail_dedupes_detail_rows_before_export(self):
        rows = [
            {
                "记录类型": "明细",
                "外层站点": "全球",
                "SPU": "965450603",
                "详情站点筛选": "澳大利亚",
                "详情时间粒度": "按日",
                "日期": "2026-03-30",
                "站点": "澳大利亚站",
                "详情页码": "1",
            },
            {
                "记录类型": "明细",
                "外层站点": "全球",
                "SPU": "965450603",
                "详情站点筛选": "澳大利亚",
                "详情时间粒度": "按日",
                "日期": "2026-03-30",
                "站点": "澳大利亚站",
                "详情页码": "3",
            },
            {
                "记录类型": "异常",
                "外层站点": "全球",
                "SPU": "965450603",
                "详情站点筛选": "澳大利亚",
                "详情时间粒度": "按日",
                "日期": "",
                "站点": "",
                "原因": "详情翻页失败",
            },
        ]

        result = _apply_final_export_guards("temu", "goods_traffic_detail", rows)

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["详情页码"], "1")
        self.assertEqual(result[1]["记录类型"], "异常")

    def test_export_guard_does_not_affect_other_tasks(self):
        rows = [
            {
                "记录类型": "明细",
                "外层站点": "全球",
                "SPU": "965450603",
                "详情站点筛选": "澳大利亚",
                "详情时间粒度": "按日",
                "日期": "2026-03-30",
                "站点": "澳大利亚站",
            },
            {
                "记录类型": "明细",
                "外层站点": "全球",
                "SPU": "965450603",
                "详情站点筛选": "澳大利亚",
                "详情时间粒度": "按日",
                "日期": "2026-03-30",
                "站点": "澳大利亚站",
            },
        ]

        result = _apply_final_export_guards("temu", "goods_traffic_list", rows)
        self.assertEqual(len(result), 2)


if __name__ == "__main__":
    unittest.main()
