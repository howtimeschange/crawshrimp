import unittest

from core import api_server


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
