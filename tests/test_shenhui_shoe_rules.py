from dataclasses import replace
from unittest.mock import patch

import pytest

from core import shenhui_shoe_packaging as packaging
from core import shenhui_shoe_rules as rules


def candidate(**overrides):
    values = {
        "candidate_id": "I01",
        "filename": "candidate.jpg",
        "asset_type": "shoe",
        "shoe_count": "single",
        "pose": "other",
        "background": "gray",
        "complete": True,
        "side": "outer",
        "outsole_visible": False,
        "feature_card": False,
        "confidence": 0.99,
        "matched_slots": (),
    }
    values.update(overrides)
    return rules.CandidateFacts(**values)


def test_yq3_rejects_feature_card_even_when_pose_hint_matches():
    fact = candidate(
        filename="tag-over-shoe.jpg",
        pose="yq3",
        feature_card=True,
        matched_slots=("yq3",),
    )

    valid, reason = rules.candidate_is_valid_for_slot(fact, "yq3", "婴童")

    assert valid is False
    assert "feature card" in reason


def test_baby_tmz4_requires_rear_or_side_rear_semantics():
    outer = candidate(
        filename="outer.jpg",
        pose="yq3",
        side="outer",
        matched_slots=("tmz4",),
    )
    rear = replace(outer, filename="rear.jpg", pose="tmz4", side="rear")

    assert rules.candidate_is_valid_for_slot(outer, "tmz4", "婴童")[0] is False
    assert rules.candidate_is_valid_for_slot(rear, "tmz4", "婴童")[0] is True


def test_yx_requires_complete_shoe_and_feature_card_together():
    clean_shoe = candidate(filename="clean-shoe.jpg", pose="yq3")
    feature_detail = candidate(
        filename="card-detail.jpg",
        asset_type="feature_card",
        complete=False,
        feature_card=True,
    )
    complete_with_card = candidate(
        filename="shoe-with-card.jpg",
        pose="yx",
        feature_card=True,
        matched_slots=("yx",),
    )

    assert rules.candidate_is_valid_for_slot(clean_shoe, "yx", "婴童")[0] is False
    assert rules.candidate_is_valid_for_slot(feature_detail, "yx", "婴童")[0] is False
    assert rules.candidate_is_valid_for_slot(complete_with_card, "yx", "婴童")[0] is True


def test_slot_payload_cannot_lock_invalid_yq3_from_explicit_hint():
    payload = {
        "shoe_category": "婴童",
        "candidates": [
            {
                "candidate_id": "I01",
                "filename": "tag-over-shoe.jpg",
                "asset_type": "shoe",
                "shoe_count": "single",
                "pose": "yq3",
                "background": "gray",
                "complete": True,
                "side": "outer",
                "feature_card": True,
                "matched_slots": ["yq3"],
                "confidence": 0.99,
            }
        ],
    }

    result = rules.slot_payload_from_candidate_facts(
        payload,
        {"I01": "tag-over-shoe.jpg"},
        shoe_category="婴童",
    )

    assert result["slots"]["yq"][2] == ""


def test_same_copy_family_does_not_block_unique_slot_lock():
    payload = {
        "shoe_category": "婴童",
        "candidates": [
            {
                "candidate_id": "I01",
                "filename": "GUDO7242.jpg",
                "asset_type": "shoe",
                "shoe_count": "pair",
                "pose": "tmz1",
                "background": "gray",
                "complete": True,
                "matched_slots": ["tmz1"],
                "confidence": 0.99,
            },
            {
                "candidate_id": "I02",
                "filename": "GUDO7242 拷贝.jpg",
                "asset_type": "shoe",
                "shoe_count": "pair",
                "pose": "tmz1",
                "background": "gray",
                "complete": True,
                "matched_slots": ["tmz1"],
                "confidence": 0.99,
            },
        ],
    }

    result = rules.slot_payload_from_candidate_facts(
        payload,
        {"I01": "GUDO7242.jpg", "I02": "GUDO7242 拷贝.jpg"},
        shoe_category="婴童",
    )

    assert result["slots"]["tmz1"] == "I01"
    tmz1_decision = next(item for item in result["_slot_decisions"] if item["slot"] == "tmz1")
    assert tmz1_decision["status"] == "locked"
    assert tmz1_decision["second_score"] == 0.0


def test_distinct_families_with_tied_score_stay_empty():
    payload = {
        "shoe_category": "婴童",
        "candidates": [
            {
                "candidate_id": "I01",
                "filename": "GUDO7242.jpg",
                "asset_type": "shoe",
                "shoe_count": "pair",
                "pose": "tmz1",
                "background": "gray",
                "complete": True,
                "matched_slots": ["tmz1"],
                "confidence": 0.99,
            },
            {
                "candidate_id": "I02",
                "filename": "GUDO7243.jpg",
                "asset_type": "shoe",
                "shoe_count": "pair",
                "pose": "tmz1",
                "background": "gray",
                "complete": True,
                "matched_slots": ["tmz1"],
                "confidence": 0.99,
            },
        ],
    }

    result = rules.slot_payload_from_candidate_facts(
        payload,
        {"I01": "GUDO7242.jpg", "I02": "GUDO7243.jpg"},
        shoe_category="婴童",
    )

    assert result["slots"]["tmz1"] == ""
    tmz1_decision = next(item for item in result["_slot_decisions"] if item["slot"] == "tmz1")
    assert tmz1_decision["status"] == "empty_low_confidence"
    assert tmz1_decision["score"] == tmz1_decision["second_score"]


def test_same_copy_family_cannot_fill_two_exclusive_main_slots():
    payload = {
        "shoe_category": "婴童",
        "candidates": [
            {
                "candidate_id": "I01",
                "filename": "GUDO7242.jpg",
                "asset_type": "shoe",
                "shoe_count": "pair",
                "pose": "tmz1",
                "background": "gray",
                "complete": True,
                "matched_slots": ["tmz1"],
                "confidence": 0.99,
            },
            {
                "candidate_id": "I02",
                "filename": "GUDO7242 副本.jpg",
                "asset_type": "shoe",
                "shoe_count": "pair",
                "pose": "tmz2",
                "background": "gray",
                "complete": True,
                "outsole_visible": True,
                "matched_slots": ["tmz2"],
                "confidence": 0.99,
            },
        ],
    }

    result = rules.slot_payload_from_candidate_facts(
        payload,
        {"I01": "GUDO7242.jpg", "I02": "GUDO7242 副本.jpg"},
        shoe_category="婴童",
    )

    assert result["slots"]["tmz1"] == "I01"
    assert result["slots"]["tmz2"] == ""


def test_yq1_locks_independently_from_tmz2():
    payload = {
        "shoe_category": "婴童",
        "candidates": [
            {
                "candidate_id": "I01",
                "filename": "main-pose2.jpg",
                "asset_type": "shoe",
                "shoe_count": "pair",
                "pose": "tmz2",
                "background": "gray",
                "complete": True,
                "outsole_visible": True,
                "matched_slots": ["tmz2"],
                "confidence": 0.99,
            },
            {
                "candidate_id": "I02",
                "filename": "angle-yq1.jpg",
                "asset_type": "shoe",
                "shoe_count": "single",
                "pose": "yq1 oblique front",
                "background": "gray",
                "complete": True,
                "matched_slots": ["yq1"],
                "confidence": 0.99,
            },
        ],
    }

    result = rules.slot_payload_from_candidate_facts(
        payload,
        {"I01": "main-pose2.jpg", "I02": "angle-yq1.jpg"},
        shoe_category="婴童",
    )

    assert result["slots"]["tmz2"] == "I01"
    assert result["slots"]["wpz"][1] == "I01"
    assert result["slots"]["yq"][0] == "I02"


def test_rules_and_packaging_use_the_same_copy_family_key():
    assert rules._candidate_family_key("GUDO7242 拷贝.jpg") == packaging._copy_variant_key(
        "GUDO7242 副本.jpg"
    )


def test_wpz6_rejects_complete_shoe_even_with_explicit_box_hint():
    shoe = candidate(
        filename="shoe.jpg",
        pose="wpz6",
        matched_slots=("wpz6",),
    )

    valid, reason = rules.candidate_is_valid_for_slot(shoe, "wpz6", "运动")

    assert valid is False
    assert "box" in reason


def test_wpz6_locks_unique_high_confidence_shoe_box_without_slot_hint():
    payload = {
        "shoe_category": "运动",
        "candidates": [
            {
                "candidate_id": "I22",
                "filename": "GUDO7401.jpg",
                "asset_type": "shoe_box",
                "confidence": 0.95,
            }
        ],
    }

    result = rules.slot_payload_from_candidate_facts(
        payload,
        {"I22": "GUDO7401.jpg"},
        shoe_category="运动",
    )

    assert result["slots"]["wpz"][5] == "I22"
    wpz6_decision = next(item for item in result["_slot_decisions"] if item["slot"] == "wpz6")
    assert wpz6_decision["status"] == "locked"


def test_wpz6_stays_empty_for_unique_non_box_candidate_without_hint():
    payload = {
        "shoe_category": "运动",
        "candidates": [
            {
                "candidate_id": "I22",
                "filename": "GUDO7401.jpg",
                "asset_type": "shoe",
                "complete": True,
                "confidence": 0.99,
            }
        ],
    }

    result = rules.slot_payload_from_candidate_facts(
        payload,
        {"I22": "GUDO7401.jpg"},
        shoe_category="运动",
    )

    assert result["slots"]["wpz"][5] == ""


def test_wpz6_stays_empty_when_box_candidates_are_close_without_hint():
    payload = {
        "shoe_category": "运动",
        "candidates": [
            {
                "candidate_id": "I22",
                "filename": "GUDO7401.jpg",
                "asset_type": "shoe_box",
                "confidence": 0.95,
            },
            {
                "candidate_id": "I23",
                "filename": "GUDO7402.jpg",
                "asset_type": "label",
                "confidence": 0.92,
            },
        ],
    }

    result = rules.slot_payload_from_candidate_facts(
        payload,
        {"I22": "GUDO7401.jpg", "I23": "GUDO7402.jpg"},
        shoe_category="运动",
    )

    assert result["slots"]["wpz"][5] == ""
    wpz6_decision = next(item for item in result["_slot_decisions"] if item["slot"] == "wpz6")
    assert wpz6_decision["status"] == "empty_low_confidence"


def slot_payload(model_id, **slots):
    values = {
        "tmz1": "",
        "tmz2": "",
        "tmz3": "",
        "tmz4": "",
        "tmz5": "",
        "o": "",
        "wpz": ["", "", "", "", "", ""],
        "yq": ["", "", ""],
        "yx": "",
    }
    values.update(slots)
    return {
        "color_name": "梦幻粉60301",
        "shoe_category": "婴童",
        "slots": values,
        "_model_id": model_id,
    }


def candidate_fact_payload(model_id, candidate_id, filename):
    return {
        "color_name": "梦幻粉60301",
        "shoe_category": "婴童",
        "candidates": [
            {
                "candidate_id": candidate_id,
                "filename": filename,
                "asset_type": "shoe",
                "shoe_count": "single",
                "pose": "tmz4",
                "background": "gray",
                "complete": True,
                "side": "rear",
                "outsole_visible": False,
                "feature_card": False,
                "matched_slots": ["tmz4", "wpz4"],
                "confidence": 0.99,
            }
        ],
        "_model_id": model_id,
    }


def test_consensus_rejects_legacy_slots_without_candidate_facts():
    with pytest.raises(packaging.ShoeSelectionError, match="candidates"):
        packaging._consensus_pose_payload(
            [slot_payload("model-a", tmz4="I01")],
            {"I01": "rear.jpg"},
            "婴童",
            required_votes=1,
        )


def test_consensus_leaves_slot_empty_when_models_disagree():
    result = packaging._consensus_pose_payload(
        [
            candidate_fact_payload("model-a", "I01", "rear-a.jpg"),
            candidate_fact_payload("model-b", "I02", "rear-b.jpg"),
        ],
        {"I01": "rear-a.jpg", "I02": "rear-b.jpg"},
        "婴童",
        required_votes=2,
    )

    assert result["slots"]["tmz4"] == ""
    assert any(item["slot"] == "tmz4" for item in result["_consensus_issues"])


def test_consensus_locks_slot_when_two_distinct_models_agree():
    result = packaging._consensus_pose_payload(
        [
            candidate_fact_payload("model-a", "I02", "rear.jpg"),
            candidate_fact_payload("model-b", "I02", "rear.jpg"),
        ],
        {"I02": "rear.jpg"},
        "婴童",
        required_votes=2,
    )

    assert result["slots"]["tmz4"] == "I02"
    assert result["_model_votes"]["tmz4"]["votes"] == 2


def test_consensus_does_not_count_retries_from_same_model_twice():
    result = packaging._consensus_pose_payload(
        [
            candidate_fact_payload("model-a", "I02", "rear.jpg"),
            candidate_fact_payload("model-a", "I02", "rear.jpg"),
        ],
        {"I02": "rear.jpg"},
        "婴童",
        required_votes=2,
    )

    assert result["slots"]["tmz4"] == ""
    assert result["_model_votes"]["tmz4"]["votes"] == 1


def test_consensus_selection_is_not_rewritten_by_geometry():
    slots = {
        "tmz4": "rear.jpg",
        "wpz": ["", "", "", "rear.jpg", "", ""],
        "_model_votes": {"tmz4": {"status": "locked", "votes": 2}},
    }

    with patch.object(
        packaging,
        "_apply_selection_quality_rules",
        side_effect=AssertionError("geometry replacement must not run"),
    ):
        result, corrections = packaging._apply_post_selection_quality_rules(
            "婴童",
            slots,
            {},
            outsole_entries_by_name={},
        )

    assert result["tmz4"] == "rear.jpg"
    assert result["wpz"][3] == "rear.jpg"
    assert corrections == []


def test_single_sheet_prompt_requires_structured_candidate_facts():
    prompt = packaging._shoe_selection_prompt(
        "204426146036",
        "60301",
        {"I01": "candidate.jpg"},
        "婴童",
        candidate_scope=packaging.SHOE_POSE_STRATEGY_SINGLE_SHEET,
    )

    assert "不要直接填写完整 slots" in prompt
    assert '"candidates"' in prompt
    assert '"feature_card"' in prompt


def test_default_analyzer_collects_two_distinct_model_votes_before_returning():
    calls = []

    def fake_multimodal_json(**kwargs):
        calls.append(kwargs["model_id"])
        return (
            {
                "color_name": "梦幻粉60301",
                "shoe_category": "婴童",
                "candidates": [
                    {
                        "candidate_id": "I01",
                        "filename": "tmz1.jpg",
                        "asset_type": "shoe",
                        "shoe_count": "pair",
                        "pose": "tmz1",
                        "background": "gray",
                        "complete": True,
                        "matched_slots": ["tmz1"],
                        "confidence": 0.99,
                    },
                    {
                        "candidate_id": "I02",
                        "filename": "tmz2.jpg",
                        "asset_type": "shoe",
                        "shoe_count": "pair",
                        "pose": "tmz2",
                        "background": "gray",
                        "complete": True,
                        "outsole_visible": True,
                        "matched_slots": ["tmz2"],
                        "confidence": 0.99,
                    },
                    {
                        "candidate_id": "I03",
                        "filename": "tmz3.jpg",
                        "asset_type": "shoe",
                        "shoe_count": "single",
                        "pose": "tmz3",
                        "background": "gray",
                        "complete": True,
                        "matched_slots": ["tmz3"],
                        "confidence": 0.99,
                    },
                    {
                        "candidate_id": "I04",
                        "filename": "rear.jpg",
                        "asset_type": "shoe",
                        "shoe_count": "single",
                        "pose": "tmz4",
                        "background": "gray",
                        "complete": True,
                        "side": "rear",
                        "matched_slots": ["tmz4", "wpz4"],
                        "confidence": 0.99,
                    },
                    {
                        "candidate_id": "I05",
                        "filename": "tmz5.jpg",
                        "asset_type": "shoe",
                        "shoe_count": "single",
                        "pose": "tmz5",
                        "background": "white",
                        "complete": True,
                        "matched_slots": ["tmz5"],
                        "confidence": 0.99,
                    },
                    {
                        "candidate_id": "I06",
                        "filename": "wpz5.jpg",
                        "asset_type": "shoe",
                        "shoe_count": "single",
                        "pose": "wpz5",
                        "background": "gray",
                        "complete": True,
                        "matched_slots": ["wpz5"],
                        "confidence": 0.99,
                    },
                    {
                        "candidate_id": "I07",
                        "filename": "wpz6.jpg",
                        "asset_type": "shoe_box",
                        "pose": "wpz6",
                        "matched_slots": ["wpz6"],
                        "confidence": 0.99,
                    },
                    {
                        "candidate_id": "I08",
                        "filename": "yq2.jpg",
                        "asset_type": "shoe",
                        "shoe_count": "single",
                        "pose": "yq2",
                        "background": "gray",
                        "complete": True,
                        "side": "sole",
                        "outsole_visible": True,
                        "matched_slots": ["yq2"],
                        "confidence": 0.99,
                    },
                    {
                        "candidate_id": "I09",
                        "filename": "yq3.jpg",
                        "asset_type": "shoe",
                        "shoe_count": "single",
                        "pose": "yq3",
                        "background": "gray",
                        "complete": True,
                        "side": "outer",
                        "outsole_visible": False,
                        "feature_card": False,
                        "matched_slots": ["yq3"],
                        "confidence": 0.99,
                    },
                    {
                        "candidate_id": "I10",
                        "filename": "yq1.jpg",
                        "asset_type": "shoe",
                        "shoe_count": "pair",
                        "pose": "yq1 oblique front with rear outsole",
                        "background": "gray",
                        "complete": True,
                        "outsole_visible": True,
                        "matched_slots": ["yq1"],
                        "confidence": 0.99,
                    },
                ],
            },
            type("Route", (), {"model_id": kwargs["model_id"]})(),
        )

    with patch.object(
        packaging.llm_gateway,
        "generate_multimodal_json",
        side_effect=fake_multimodal_json,
    ):
        result = packaging._default_analyze_color(
            style_code="204426146036",
            color_code="60301",
            contact_sheet="all.jpg",
            contact_sheets=["all.jpg"],
            pose_strategy=packaging.SHOE_POSE_STRATEGY_SINGLE_SHEET,
            reference_image="main-template.jpg",
            poster_reference_image="poster-template.jpg",
            yq_reference_image="yq-template.jpg",
            candidate_ids={
                "I01": "tmz1.jpg",
                "I02": "tmz2.jpg",
                "I03": "tmz3.jpg",
                "I04": "rear.jpg",
                "I05": "tmz5.jpg",
                "I06": "wpz5.jpg",
                "I07": "wpz6.jpg",
                "I08": "yq2.jpg",
                "I09": "yq3.jpg",
                "I10": "yq1.jpg",
            },
            candidate_names=[],
            shoe_category="婴童",
            model_id="model-a",
            fallback_model_ids=["model-b", "model-c"],
            config={"ai": {"llm": {"api_key": "test-key"}}},
        )

    assert calls == ["model-a", "model-b"]
    assert result["slots"]["tmz4"] == "I04"
    assert result["_model_votes"]["tmz4"]["votes"] == 2
