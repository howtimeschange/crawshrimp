import unittest
from unittest.mock import AsyncMock, patch

from core import api_server


class DummyRunner:
    pass


class ExportFilenameContextTests(unittest.IsolatedAsyncioTestCase):
    async def _build_ctx(self, task_id: str, run_params: dict, page_ctx: dict | None = None):
        mocked_page_ctx = {"shop_name": "SEMIR Official Shop"}
        if page_ctx:
            mocked_page_ctx.update(page_ctx)
        with patch(
            "core.api_server._evaluate_filename_context",
            new=AsyncMock(return_value=mocked_page_ctx),
        ):
            return await api_server._build_export_filename_context(
                "temu",
                task_id,
                run_params,
                DummyRunner(),
            )

    async def test_tax_free_return_context_uses_requested_time_field_and_range(self):
        ctx = await self._build_ctx(
            "tax_free_return_confirm",
            {
                "return_time_field": "发起确认时间",
                "custom_return_time_range": {"start": "2026-04-09", "end": "2026-04-15"},
            },
        )

        self.assertEqual(ctx["shop_name"], "SEMIR Official Shop")
        self.assertEqual(ctx["time_scope"], "发起确认时间")
        self.assertEqual(ctx["date_range"], "2026-04-09~2026-04-15")

    async def test_qc_detail_context_uses_custom_range_label(self):
        ctx = await self._build_ctx(
            "qc_detail",
            {
                "custom_qc_time_range": {"start": "2026-04-01", "end": "2026-04-15"},
                "qc_statuses": ["抽检不合格", "抽检完成"],
            },
        )

        self.assertEqual(ctx["time_scope"], "最新抽检时间")
        self.assertEqual(ctx["date_range"], "2026-04-01~2026-04-15")
        self.assertEqual(ctx["qc_status_scope"], "抽检不合格+抽检完成")

    async def test_region_and_task_specific_scopes_for_new_temu_tasks(self):
        fund_ctx = await self._build_ctx(
            "fund_limited_list",
            {"regions": ["全球", "美国"]},
        )
        retail_ctx = await self._build_ctx(
            "recommended_retail_price",
            {"regions": ["欧区"]},
        )
        quality_ctx = await self._build_ctx(
            "quality_dashboard",
            {"regions": ["全球", "欧区"]},
        )

        self.assertEqual(fund_ctx["region_scope"], "全球+美国")
        self.assertEqual(retail_ctx["region_scope"], "欧区")
        self.assertEqual(retail_ctx["status_scope"], "全部状态")
        self.assertEqual(quality_ctx["region_scope"], "全球+欧区")
        self.assertEqual(quality_ctx["quality_tab_scope"], "品质分析+品质优化")


if __name__ == "__main__":
    unittest.main()
