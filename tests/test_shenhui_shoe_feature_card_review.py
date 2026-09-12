import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import shenhui_shoe_packaging as shoe


class ShoeFeatureCardReviewTests(unittest.TestCase):
    def review(self, responses, *, nominated=True, selected="", models=None):
        fact = {
            "candidate_id": "I01", "filename": "with-card.jpg",
            "asset_type": "feature_card", "shoe_count": "single",
            "pose": "yx", "background": "gray", "complete": True,
            "side": "outer", "feature_card": nominated,
            "outsole_visible": False, "confidence": 0.95, "matched_slots": ["yx"],
        }
        payload = {
            "slots": {"tmz1": "I02", "yx": selected},
            "_candidate_facts_by_model": [{"model_id": "old", "candidate_facts": [fact]}],
            "_model_votes": {"tmz1": {"status": "locked"}},
            "_consensus_issues": [{"slot": "yx", "status": "insufficient_votes"}],
        }
        calls = []

        def invoke(batch, model):
            calls.append(model)
            response = responses[model]
            if response == "timeout":
                return {"ok": False, "error": "timeout"}
            route, asset_type, complete, feature_card = response
            return {
                "ok": True, "route_model_id": route,
                "payload": {"candidates": [{**fact, "asset_type": asset_type,
                                           "complete": complete, "feature_card": feature_card}]},
            }

        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(shoe, "_create_targeted_slot_contact_sheets", return_value=(
                [Path(tmp) / "review.jpg"], {"I01": "with-card.jpg"},
            )) as sheets:
                result = shoe._review_missing_shoe_feature_card(
                    payload, candidate_ids={"I01": "with-card.jpg", "I02": "clean.jpg"},
                    candidate_entries=[{"filename": "with-card.jpg", "path": Path(tmp) / "original.jpg"}],
                    contact_sheet=str(Path(tmp) / "contact.jpg"), style_code="204426141029",
                    color_code="00316", shoe_category="运动", model_ids=models or list(responses),
                    required_votes=2, invoke=invoke, log=lambda _: None,
                )
        self.assertEqual(payload["slots"]["yx"], selected)
        self.assertEqual(result["slots"]["tmz1"], "I02")
        return result, calls, sheets

    def test_two_independent_reviews_recover_nominated_card_without_changing_main_slots(self):
        result, calls, sheets = self.review({
            "a": ("route-a", "shoe", True, True), "b": ("route-b", "shoe", True, True),
        })
        self.assertEqual(result["slots"]["yx"], "I01")
        self.assertEqual(result["_model_votes"]["yx"]["votes"], 2)
        self.assertEqual(result["_targeted_slot_consensus"]["yx"]["status"], "locked")
        self.assertEqual(result["_consensus_issues"], [])
        self.assertEqual(set(calls), {"a", "b"})
        sheets.assert_called_once()

    def test_missing_candidate_or_existing_selection_does_not_call_models(self):
        for options in ({"nominated": False}, {"selected": "I01"}):
            with self.subTest(options=options):
                _, calls, sheets = self.review({}, **options)
                self.assertEqual(calls, [])
                sheets.assert_not_called()

    def test_route_aliases_cannot_supply_two_independent_votes(self):
        result, _, _ = self.review({
            "a": ("same-route", "shoe", True, True), "alias": ("same-route", "shoe", True, True),
        })
        self.assertEqual(result["slots"]["yx"], "")
        self.assertEqual(result["_targeted_slot_consensus"]["yx"]["status"], "unresolved_optional")

    def test_timeout_uses_next_independent_model(self):
        result, calls, _ = self.review({
            "a": ("route-a", "shoe", True, True), "b": "timeout",
            "c": ("route-c", "shoe", True, True),
        })
        self.assertEqual(result["slots"]["yx"], "I01")
        self.assertEqual(set(calls), {"a", "b", "c"})

    def test_card_alone_crop_and_clean_shoe_cannot_pass_review(self):
        for asset, complete, card in (("feature_card", True, True), ("shoe", False, True), ("shoe", True, False)):
            with self.subTest(asset=asset, complete=complete, card=card):
                result, _, _ = self.review({
                    "a": ("route-a", asset, complete, card), "b": ("route-b", asset, complete, card),
                })
                self.assertEqual(result["slots"]["yx"], "")

    def test_yx_prompt_requires_shoe_and_card_together(self):
        prompt = shoe._shoe_targeted_slot_prompt(
            "204426141029", "00316", {"I01": "with-card.jpg"}, "运动",
            target_slot="yx", candidate_sheet_count=1, has_reference_image=False,
        )
        self.assertIn("完整鞋子主体与功能吊牌或功能卡同框", prompt)
        self.assertIn("只有卡片而没有完整鞋子", prompt)


if __name__ == "__main__":
    unittest.main()
