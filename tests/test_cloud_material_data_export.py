import tempfile
import unittest
from pathlib import Path

import openpyxl

from core.cloud_job_executors import parse_tmall_material_test_workbook


class MaterialDataExportTests(unittest.TestCase):
    def test_parse_tmall_material_test_workbook_normalizes_percent_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "天猫测图数据抓取导出.xlsx"
            workbook = openpyxl.Workbook()
            overview = workbook.active
            overview.title = "概览"
            overview.append(["记录类型", "表格行号", "款号", "商品ID", "商品标题", "任务ID", "测试状态", "测试渠道", "测试素材数", "最优素材", "执行结果", "备注"])
            overview.append(["概览", 2, "208326", "1001", "标题", "T1", "完成", "搜索", 2, "M1", "成功", ""])
            detail = workbook.create_sheet("明细")
            detail.append(["记录类型", "表格行号", "款号", "商品ID", "商品标题", "任务ID", "测试状态", "测试渠道", "测试素材数", "统计口径", "统计日期", "图片类型", "素材ID", "素材比例", "素材占比", "素材URL", "搜索曝光", "搜索点击", "搜索点击率", "详情曝光", "详情点击", "详情点击率", "详情加购", "详情支付转化", "详情支付转化率", "数据下载链接", "执行结果", "备注"])
            detail.append(["明细", 2, "208326", "1001", "标题", "T1", "完成", "搜索", 2, "ACCUMULATE_30_DAYS", "2026-07-01", "主图", "M1", "1:1", "7.79%", "https://img.test/1.jpg", 1000, 77, "7.79%", 500, 40, "8%", 12, 3, "2.50%", "", "成功", ""])
            workbook.save(path)

            parsed = parse_tmall_material_test_workbook(path)

        self.assertEqual(len(parsed["overview_rows"]), 1)
        self.assertEqual(len(parsed["detail_rows"]), 1)
        self.assertAlmostEqual(parsed["detail_rows"][0]["search_ctr"], 0.0779)
        self.assertAlmostEqual(parsed["detail_rows"][0]["detail_pay_conversion_rate"], 0.025)


if __name__ == "__main__":
    unittest.main()
