import unittest

from core import api_server


class TmallEntryUrlSelectionTests(unittest.TestCase):
    def test_extracts_all_tmall_item_links_from_chinese_delimited_input(self):
        selected = api_server._resolve_tmall_buyer_review_item_urls({
            "item_links": "、".join([
                "https://detail.tmall.com/item.htm?ali_refid=a3_demo&id=919643072179&skuId=5789814873879&spm=a21n57.1.hoverItem.1",
                "https://detail.tmall.com/item.htm?ali_refid=a3_demo&id=1023254962064&skuId=6034929285662&xxc=ad_ztc",
                "https://detail.tmall.com/item.htm?ali_refid=a3_demo&id=732533512173&skuId=6038497472965&utparam=%7B%7D",
            ]),
        })

        self.assertEqual(
            selected,
            [
                "https://detail.tmall.com/item.htm?id=919643072179&skuId=5789814873879",
                "https://detail.tmall.com/item.htm?id=1023254962064&skuId=6034929285662",
                "https://detail.tmall.com/item.htm?id=732533512173&skuId=6038497472965",
            ],
        )

    def test_prefers_first_valid_item_link_for_tmall_buyer_reviews(self):
        run_params = {
            "mode": "new",
            "item_links": "\n".join([
                "ali_refid=a3_bad_fragment_without_scheme",
                "https://detail.tmall.com/item.htm?id=919643072179&skuId=5789814873879&spm=a21n57.1.hoverItem.1",
                "https://detail.tmall.com/item.htm?id=1023254962064&skuId=6034929285662",
            ]),
        }

        selected = api_server._resolve_task_target_entry_url(
            "tmall-ops-assistant",
            "buyer_reviews",
            run_params,
            "https://detail.tmall.com/item.htm",
        )

        self.assertEqual(
            selected,
            "https://detail.tmall.com/item.htm?id=919643072179&skuId=5789814873879",
        )

    def test_tmall_buyer_reviews_strips_ad_tracking_params_from_long_item_link(self):
        selected = api_server._resolve_task_target_entry_url(
            "tmall-ops-assistant",
            "buyer_reviews",
            {
                "item_links": (
                    "https://detail.tmall.com/item.htm?"
                    "ali_refid=a3_430582_1006%3A2538299721%3AH%3AnRermbLQ7BCZavGPLCDqOw%3D%3D%3A9f37130647858d75ee5528af81d29cf3"
                    "&benefitReciveParams=%7B%22toast%22%3A%22true%22%7D"
                    "&id=919643072179"
                    "&mi_id=0000AnWcQ1qymO-3oXj-0qGlmsiGAyKE6Aa2PeL-xBBRa5U"
                    "&skuId=5789814873879"
                    "&spm=a21n57.1.hoverItem.1"
                    "&utparam=%7B%22aplus_abtest%22%3A%221ede64f4287186dd75e8c0f375e054d2%22%7D"
                    "&xxc=ad_ztc"
                ),
            },
            "https://detail.tmall.com/item.htm",
        )

        self.assertEqual(
            selected,
            "https://detail.tmall.com/item.htm?id=919643072179&skuId=5789814873879",
        )

    def test_requires_valid_item_link_for_tmall_buyer_reviews(self):
        with self.assertRaisesRegex(ValueError, "天猫商品链接"):
            api_server._resolve_task_target_entry_url(
                "tmall-ops-assistant",
                "buyer_reviews",
                {"item_links": "not-a-link\nalso-not-a-link"},
                "https://detail.tmall.com/item.htm",
            )

    def test_tmall_buyer_reviews_uses_link_driven_new_page_even_with_stale_mode(self):
        selected = api_server._resolve_task_open_mode(
            "tmall-ops-assistant",
            "buyer_reviews",
            {"mode": "current"},
            {"mode", "item_links"},
        )

        self.assertEqual(selected, "new")


class TiktokEntryUrlSelectionTests(unittest.TestCase):
    def test_product_rating_new_page_uses_selected_eu_region_url(self):
        selected = api_server._resolve_task_target_entry_url(
            "tiktok-ops-assistant",
            "product_rating",
            {
                "shop_regions": ["FR"],
            },
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
            {
                "shop_regions": ["US"],
            },
            "https://seller.us.tiktokshopglobalselling.com/product/rating",
        )

        self.assertEqual(
            selected,
            "https://seller.us.tiktokshopglobalselling.com/product/rating?shop_region=US",
        )

    def test_creator_video_download_new_page_uses_affiliate_region_url(self):
        selected = api_server._resolve_task_target_entry_url(
            "tiktok-ops-assistant",
            "creator_video_download",
            {
                "shop_regions": ["FR"],
            },
            "https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis",
        )

        self.assertEqual(
            selected,
            "https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis?shop_region=FR",
        )


class AmazonReviewsEntryUrlSelectionTests(unittest.TestCase):
    def test_amazon_reviews_opens_product_link_directly_on_reviews_page(self):
        selected = api_server._resolve_task_target_entry_url(
            "amazon-ops-assistant",
            "amazon_reviews_full_export",
            {
                "review_urls": "https://www.amazon.com/Weestep-Toddler-Little-Lightweight-Sneaker/dp/B0D2CQ62DX",
            },
            "https://www.amazon.com/",
        )

        self.assertEqual(
            selected,
            "https://www.amazon.com/product-reviews/B0D2CQ62DX?sortBy=recent",
        )

    def test_amazon_reviews_normalizes_product_reviews_link_for_entry(self):
        selected = api_server._resolve_task_target_entry_url(
            "amazon-ops-assistant",
            "amazon_reviews_full_export",
            {
                "review_urls": "https://www.amazon.com/product-reviews/B0D2CQ62DX/ref=cm_cr_dp_d_show_all_btm?ie=UTF8",
            },
            "https://www.amazon.com/",
        )

        self.assertEqual(
            selected,
            "https://www.amazon.com/product-reviews/B0D2CQ62DX?sortBy=recent",
        )

    def test_amazon_reviews_final_export_guard_dedupes_by_asin_and_review_id(self):
        guarded = api_server._apply_final_export_guards(
            "amazon-ops-assistant",
            "amazon_reviews_full_export",
            [
                {"ASIN": "B0D2CQ62DX", "评价ID": "R1", "评价内容": "first"},
                {"ASIN": "B0D2CQ62DX", "评价ID": "R1", "评价内容": "duplicate"},
                {"ASIN": "B0D2CQ62DX", "评价ID": "R2", "评价内容": "second"},
                {"ASIN": "B0OTHER123", "评价ID": "R1", "评价内容": "other asin"},
            ],
        )

        self.assertEqual(
            guarded,
            [
                {"ASIN": "B0D2CQ62DX", "评价ID": "R1", "评价内容": "first"},
                {"ASIN": "B0D2CQ62DX", "评价ID": "R2", "评价内容": "second"},
                {"ASIN": "B0OTHER123", "评价ID": "R1", "评价内容": "other asin"},
            ],
        )


if __name__ == "__main__":
    unittest.main()
