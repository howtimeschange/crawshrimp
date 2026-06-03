import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openpyxl import Workbook

from core import odps_sync


class OdpsSyncTest(unittest.TestCase):
    def test_build_payload_maps_temu_mall_flux_excel_to_task_table(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "mall_flux.xlsx"
            wb = Workbook()
            ws = wb.active
            ws.append(["平台名称", "店铺名称", "店铺ID", "日期", "总数据/总浏览量"])
            ws.append(["Temu", "balabala Official Shop", "D80421", "2026-05-18", "4414"])
            wb.save(path)

            payload = odps_sync.build_sync_payload(
                adapter_id="temu",
                task_id="mall_flux",
                file_path=str(path),
            )

        self.assertEqual(payload["table_name"], "imp_ods_temu_mall_flux")
        self.assertEqual(payload["write_mode"], "append")
        self.assertEqual(payload["partition_spec"], {"dt": "2026-05-18"})
        self.assertEqual(payload["data"][0]["shop_id"], "D80421")
        self.assertEqual(payload["data"][0]["total_views"], 4414)
        field_names = [field["name"] for field in payload["fields"]]
        self.assertEqual(field_names[:5], ["platform_name", "shop_name", "shop_id", "stat_date", "total_views"])
        field_types = {field["name"]: field["type"] for field in payload["fields"]}
        self.assertEqual(field_types["shop_id"], "string")
        self.assertEqual(field_types["total_views"], "bigint")
        self.assertEqual(payload["fields"][4]["comment"], "总数据/总浏览量")

    def test_sync_file_posts_write_odps_payload_to_gateway_endpoint_with_app_code(self):
        captured = {}

        def fake_post_json(url, payload, timeout=30, headers=None):
            captured["url"] = url
            captured["payload"] = payload
            captured["timeout"] = timeout
            captured["headers"] = headers
            return {"success": True, "count": 1}

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "mall_flux.xlsx"
            wb = Workbook()
            ws = wb.active
            ws.append(["平台名称", "店铺名称", "店铺ID", "日期"])
            ws.append(["Temu", "balabala Official Shop", "D80421", "2026-05-18"])
            wb.save(path)

            with patch.object(odps_sync, "_post_json", side_effect=fake_post_json):
                result = odps_sync.sync_file(
                    adapter_id="temu",
                    task_id="mall_flux",
                    file_path=str(path),
                    endpoint="http://dataworksapi.semirapp.com",
                    app_code="secret-code",
                )

        self.assertTrue(result["ok"])
        self.assertEqual(captured["url"], "http://dataworksapi.semirapp.com/api/v1/dataworks/write_odps")
        self.assertEqual(captured["headers"]["Authorization"], "APPCODE secret-code")
        self.assertEqual(captured["headers"]["Content-Type"], "application/json")
        self.assertEqual(captured["payload"]["table_name"], "imp_ods_temu_mall_flux")
        self.assertEqual(captured["payload"]["data"][0]["platform_name"], "Temu")

    def test_full_write_odps_url_is_preserved(self):
        url = odps_sync.resolve_write_odps_url("http://dataworksapi.semirapp.com/api/v1/dataworks/write_odps")
        self.assertEqual(url, "http://dataworksapi.semirapp.com/api/v1/dataworks/write_odps")

    def test_default_dataworks_endpoint_is_the_semir_gateway(self):
        self.assertEqual(
            odps_sync.DEFAULT_DATAWORKS_ENDPOINT,
            "http://dataworksapi.semirapp.com/api/v1/dataworks/write_odps",
        )

    def test_sync_file_requires_app_code(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "mall_flux.xlsx"
            wb = Workbook()
            ws = wb.active
            ws.append(["平台名称", "店铺名称", "店铺ID", "日期"])
            ws.append(["Temu", "balabala Official Shop", "D80421", "2026-05-18"])
            wb.save(path)

            with self.assertRaisesRegex(odps_sync.OdpsSyncError, "ODPS AppCode"):
                odps_sync.sync_file(
                    adapter_id="temu",
                    task_id="mall_flux",
                    file_path=str(path),
                    endpoint=odps_sync.DEFAULT_DATAWORKS_ENDPOINT,
                    app_code="",
                )

    def test_stat_date_range_is_synced_as_string_not_datetime(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "mall_flux.xlsx"
            wb = Workbook()
            ws = wb.active
            ws.append(["统计日期范围", "日期", "抓取时间"])
            ws.append(["2026-05-13 ~ 2026-05-19", "2026-05-18", "2026-05-19 12:34:56"])
            wb.save(path)

            payload = odps_sync.build_sync_payload(
                adapter_id="temu",
                task_id="mall_flux",
                file_path=str(path),
            )

        field_types = {field["name"]: field["type"] for field in payload["fields"]}
        self.assertEqual(field_types["stat_date_range"], "string")
        self.assertEqual(field_types["stat_date"], "string")
        self.assertEqual(field_types["captured_at"], "datetime")

    def test_build_payload_maps_tiktok_product_analytics_excel_to_task_table(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "tiktok_product_analytics.xlsx"
            wb = Workbook()
            ws = wb.active
            ws.append(["平台名称", "区域", "店铺ID", "统计日期范围", "抓取时间", "订单数", "商品曝光次数", "商品点击量"])
            ws.append(["TikTok", "US", "7496042382582647544", "2026-05-27 ~ 2026-06-02", "2026-06-03 12:00:00", "295", "751050", "23884"])
            wb.save(path)

            payload = odps_sync.build_sync_payload(
                adapter_id="tiktok-ops-assistant",
                task_id="product_analytics",
                file_path=str(path),
            )

        self.assertEqual(payload["table_name"], "imp_ods_tiktok_product_analytics")
        self.assertEqual(payload["partition_spec"], {"dt": "2026-05-27"})
        self.assertEqual(payload["data"][0]["platform_name"], "TikTok")
        self.assertEqual(payload["data"][0]["region"], "US")
        self.assertEqual(payload["data"][0]["shop_id"], "7496042382582647544")
        self.assertEqual(payload["data"][0]["orders"], 295)
        self.assertEqual(payload["data"][0]["product_impressions"], 751050)
        self.assertEqual(payload["data"][0]["product_clicks"], 23884)
        field_types = {field["name"]: field["type"] for field in payload["fields"]}
        self.assertEqual(field_types["stat_date_range"], "string")
        self.assertEqual(field_types["captured_at"], "datetime")
        self.assertEqual(field_types["orders"], "bigint")

    def test_build_payload_maps_aliexpress_deal_analysis_excel_to_task_table(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "aliexpress_deal_analysis.xlsx"
            wb = Workbook()
            ws = wb.active
            ws.append(["平台名称", "店铺名称", "channelId", "数据类型", "统计日期", "统计日期范围", "指标编码", "指标名称", "指标值", "环比值", "同比值", "抓取时间"])
            ws.append(["AliExpress", "Semir Official Store", "125417", "核心指标", "2026-06-01", "2026-06-01 ~ 2026-06-01", "payAmt", "支付金额", "18811.33", "7.5362", "4.2461", "2026-06-03 18:20:30"])
            wb.save(path)

            payload = odps_sync.build_sync_payload(
                adapter_id="aliexpress-ops-assistant",
                task_id="deal_analysis",
                file_path=str(path),
            )

        self.assertEqual(payload["table_name"], "imp_ods_aliexpress_deal_analysis")
        self.assertEqual(payload["partition_spec"], {"dt": "2026-06-01"})
        self.assertEqual(payload["data"][0]["platform_name"], "AliExpress")
        self.assertEqual(payload["data"][0]["channel_id"], "125417")
        self.assertEqual(payload["data"][0]["metric_code"], "payAmt")
        self.assertEqual(payload["data"][0]["metric_value"], 18811.33)
        field_types = {field["name"]: field["type"] for field in payload["fields"]}
        self.assertEqual(field_types["stat_date"], "string")
        self.assertEqual(field_types["stat_date_range"], "string")
        self.assertEqual(field_types["metric_value"], "double")
        self.assertEqual(field_types["captured_at"], "datetime")

    def test_build_payload_maps_aliexpress_product_ranking_excel_to_task_table(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "aliexpress_product_ranking.xlsx"
            wb = Workbook()
            ws = wb.active
            ws.append(["平台名称", "店铺名称", "channelId", "榜单类型", "统计日期", "商品ID", "排行", "商品名称", "支付金额", "支付金额环比", "商品访客数", "抓取时间"])
            ws.append(["AliExpress", "Semir Official Store", "125417", "支付榜", "2026-06-01", "1005000000000000", "1", "Semir item", "100.5", "12.00%", "50", "2026-06-03 18:20:30"])
            wb.save(path)

            payload = odps_sync.build_sync_payload(
                adapter_id="aliexpress-ops-assistant",
                task_id="product_ranking",
                file_path=str(path),
            )

        self.assertEqual(payload["table_name"], "imp_ods_aliexpress_product_ranking")
        self.assertEqual(payload["partition_spec"], {"dt": "2026-06-01"})
        self.assertEqual(payload["data"][0]["platform_name"], "AliExpress")
        self.assertEqual(payload["data"][0]["item_id"], "1005000000000000")
        self.assertEqual(payload["data"][0]["rank_no"], 1)
        self.assertEqual(payload["data"][0]["pay_amt"], 100.5)
        field_types = {field["name"]: field["type"] for field in payload["fields"]}
        self.assertEqual(field_types["stat_date"], "string")
        self.assertEqual(field_types["item_id"], "string")
        self.assertEqual(field_types["rank_no"], "bigint")
        self.assertEqual(field_types["pay_amt"], "double")


if __name__ == "__main__":
    unittest.main()
