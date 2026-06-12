import unittest

from core import api_server


class TemuCurrentTabMatchingTests(unittest.TestCase):
    def test_agentseller_root_current_tab_can_recover_to_mall_flux_task(self):
        self.assertTrue(
            api_server._is_compatible_current_tab_for_task(
                "temu",
                "mall_flux",
                "https://agentseller.temu.com/main/mall-flux-analysis-full",
                "https://agentseller.temu.com/",
            )
        )

    def test_agentseller_region_current_tab_can_recover_to_canonical_task_url(self):
        self.assertTrue(
            api_server._is_compatible_current_tab_for_task(
                "temu",
                "goods_traffic_list",
                "https://agentseller.temu.com/main/flux-analysis-full",
                "https://agentseller-us.temu.com/main/quality/dashboard",
            )
        )

    def test_temu_current_tab_matching_does_not_cross_backend_families(self):
        self.assertFalse(
            api_server._is_compatible_current_tab_for_task(
                "temu",
                "mall_flux",
                "https://agentseller.temu.com/main/mall-flux-analysis-full",
                "https://seller.kuajingmaihuo.com/main/order-manager/shipping-list",
            )
        )
        self.assertFalse(
            api_server._is_compatible_current_tab_for_task(
                "temu",
                "qc_detail",
                "https://seller.kuajingmaihuo.com/wms/qc-detail",
                "https://agentseller-eu.temu.com/main/quality/dashboard",
            )
        )

    def test_temu_new_tab_entry_uses_agentseller_shell_before_business_route(self):
        self.assertEqual(
            api_server._temu_new_tab_entry_url(
                "https://agentseller.temu.com/main/mall-flux-analysis-full"
            ),
            "https://agentseller.temu.com/",
        )
        self.assertEqual(
            api_server._temu_new_tab_entry_url(
                "https://agentseller-us.temu.com/main/flux-analysis-full"
            ),
            "https://agentseller-us.temu.com/",
        )

    def test_temu_new_tab_entry_uses_kuajingmaihuo_shell_before_seller_center_deep_link(self):
        self.assertEqual(
            api_server._temu_new_tab_entry_url(
                "https://seller.kuajingmaihuo.com/wms/tax-free-return-mgt/return-confirm"
            ),
            "https://seller.kuajingmaihuo.com/main/order-manager/shipping-list",
        )

    def test_temu_single_product_reviews_new_page_opens_product_url_directly(self):
        product_url = "https://www.temu.com/de-en/example-g-606106067809179.html"

        self.assertEqual(
            api_server._resolve_task_target_entry_url(
                "temu",
                "single_product_reviews",
                {"product_url": product_url},
                "https://www.temu.com",
            ),
            product_url,
        )
        self.assertEqual(api_server._temu_new_tab_entry_url(product_url), product_url)

    def test_temu_single_product_reviews_new_page_uses_first_product_url_for_multi_links(self):
        first_url = "https://www.temu.com/de-en/example-g-606517898129873.html?_oak_mp_inf=x"
        second_url = "https://www.temu.com/de-en/example-g-606106067809179.html?_oak_mp_inf=y"

        self.assertEqual(
            api_server._resolve_task_target_entry_url(
                "temu",
                "single_product_reviews",
                {"product_url": f"{first_url}\n{second_url}"},
                "https://www.temu.com",
            ),
            first_url,
        )

    def test_temu_no_auth_url_is_detected(self):
        self.assertTrue(api_server._is_temu_no_auth_url("https://seller.temu.com/no-auth.html"))
        self.assertFalse(api_server._is_temu_no_auth_url("https://seller.temu.com/login"))

    def test_non_temu_adapter_keeps_strict_current_tab_matching(self):
        self.assertFalse(
            api_server._is_compatible_current_tab_for_task(
                "shopify-ops-assistant",
                "traffic_data",
                "https://admin.shopify.com/store/demo/analytics/reports/sessions_over_time",
                "https://admin.shopify.com/store/demo",
            )
        )


class TiktokEntryUrlSelectionTests(unittest.TestCase):
    def test_product_rating_new_page_uses_selected_eu_region_url(self):
        selected = api_server._resolve_task_target_entry_url(
            "tiktok-ops-assistant",
            "product_rating",
            {"shop_regions": ["FR"]},
            "https://seller.us.tiktokshopglobalselling.com/product/rating",
        )

        self.assertEqual(
            selected,
            "https://seller.eu.tiktokshopglobalselling.com/product/rating?shop_region=FR",
        )

    def test_product_rating_new_page_uses_selected_us_region_url(self):
        selected = api_server._resolve_task_target_entry_url(
            "tiktok-ops-assistant",
            "product_rating",
            {"shop_regions": ["US"]},
            "https://seller.us.tiktokshopglobalselling.com/product/rating",
        )

        self.assertEqual(
            selected,
            "https://seller.us.tiktokshopglobalselling.com/product/rating?shop_region=US",
        )

    def test_product_management_new_page_uses_selected_eu_region_url(self):
        selected = api_server._resolve_task_target_entry_url(
            "tiktok-ops-assistant",
            "product_management_export",
            {"shop_regions": ["GB"]},
            "https://seller.us.tiktokshopglobalselling.com/product/manage",
        )

        self.assertEqual(
            selected,
            "https://seller.eu.tiktokshopglobalselling.com/product/manage?shop_region=GB",
        )

    def test_creator_video_download_new_page_uses_affiliate_region_url(self):
        selected = api_server._resolve_task_target_entry_url(
            "tiktok-ops-assistant",
            "creator_video_download",
            {"shop_regions": ["FR"]},
            "https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis",
        )

        self.assertEqual(
            selected,
            "https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis?shop_region=FR",
        )

    def test_product_analytics_new_page_uses_selected_region_and_preserves_shop_id(self):
        selected = api_server._resolve_task_target_entry_url(
            "tiktok-ops-assistant",
            "product_analytics",
            {"shop_regions": ["GB"]},
            "https://seller.us.tiktokshopglobalselling.com/compass/product-traffic-analysis?shop_id=7496042382582647544",
        )

        self.assertEqual(
            selected,
            "https://seller.eu.tiktokshopglobalselling.com/compass/product-traffic-analysis?shop_region=GB&shop_id=7496042382582647544",
        )

    def test_shopify_traffic_data_new_page_uses_selected_store_key(self):
        selected = api_server._resolve_task_target_entry_url(
            "shopify-ops-assistant",
            "traffic_data",
            {"store_key": "semir-global"},
            "https://admin.shopify.com/store/balabala-global/analytics/reports/sessions_over_time?ql=FROM+sessions",
        )

        self.assertTrue(
            selected.startswith("https://admin.shopify.com/store/semir-global/analytics/reports/sessions_over_time?ql="),
        )
        self.assertIn("FROM+sessions", selected)


if __name__ == "__main__":
    unittest.main()
