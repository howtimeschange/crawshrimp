from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import threading
import time

import pytest
from PIL import Image, ImageDraw

from core.shenhui_apparel_label_processing import (
    _candidate_from_payload,
    _canonical_yq_filename,
    LabelCandidate,
    ApparelLabelProcessingResult,
    RenderedPage,
    ReviewJob,
    candidate_rejection_reason,
    crop_candidate_to_canvas,
    detect_yq_role,
    extract_scope,
    is_waste_path,
    merge_page_reviews,
    preferred_size,
    prepare_review_image,
    process_prepare_upload_package_labels,
    recover_page_reviews_with_sol,
    review_inputs_concurrently,
    select_candidates,
    validate_existing_yq,
    verify_crop,
)


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("yq1.jpg", "hang_tag"),
        ("yq(1)-2.jpg", "hang_tag"),
        ("yq(1).png", "hang_tag"),
        ("yq 1.jpeg", "hang_tag"),
        ("yq一.webp", "hang_tag"),
        ("202426107206-70013_yq2.jpg", "wash_label"),
        ("yq(2)-2.jpg", "wash_label"),
        ("202426107206-70013-yq(2).png", "wash_label"),
        ("yq二.jpg", "wash_label"),
        ("yq20.jpg", ""),
        ("myq1-copy.jpg", ""),
        ("yq.jpg", ""),
    ],
)
def test_detect_yq_role_uses_complete_marker_boundaries(filename, expected):
    assert detect_yq_role(filename) == expected


@pytest.mark.parametrize(
    ("role", "sequence", "expected"),
    [
        ("hang_tag", 1, "yq(1).jpg"),
        ("hang_tag", 2, "yq(1)-2.jpg"),
        ("wash_label", 1, "yq(2).jpg"),
        ("wash_label", 2, "yq(2)-2.jpg"),
    ],
)
def test_canonical_yq_filename_numbers_related_styles_after_the_role(role, sequence, expected):
    assert _canonical_yq_filename(role, sequence=sequence) == expected


def test_extract_scope_distinguishes_style_and_style_color_locks():
    style = "202426107206"
    assert extract_scope(style, {}, "yq1.jpg") == (style, "")
    assert extract_scope(
        style,
        {"__style_color_code": "202426107206-70013"},
        "yq2.jpg",
    ) == (style, "70013")
    assert extract_scope(
        style,
        {},
        "202426107206-81322_yq1.jpg",
    ) == (style, "81322")


@pytest.mark.parametrize(
    ("sizes", "expected"),
    [
        (["90", "100", "110", "120"], 110),
        (["90", "120", "130"], 120),
        (["90", "100"], 100),
        (["110/56", "90-175"], 110),
        (["150/76", "160/80", "170/84"], 150),
        (["90-175"], None),
        ([], None),
    ],
)
def test_preferred_size_applies_confirmed_110_order(sizes, expected):
    assert preferred_size(sizes) == expected


@pytest.mark.parametrize(
    "value",
    [
        "平拍/无吊牌/IMG_1.jpg",
        "202426107206无水洗.jpg",
        "作废_标签.png",
        "没有合格证/标签.jpg",
    ],
)
def test_is_waste_path_rejects_explicit_negative_markers(value):
    assert is_waste_path(value)


def test_is_waste_path_does_not_reject_normal_care_copy():
    assert not is_waste_path("洗唛/请不要长时间浸泡.jpg")


def test_candidate_rejection_reason_fails_closed_on_waste_or_wrong_style():
    base = LabelCandidate(
        kind="hang_tag",
        style_code="202426107206",
        color_code="70013",
        sizes=("110/56",),
        bbox=(0.1, 0.2, 0.3, 0.8),
        confidence=0.98,
        printed_label=True,
        handwritten_placeholder=False,
        negative_text="",
        source_path=Path("page.png"),
        page_index=0,
        model_id="gpt-5.6-terra",
    )

    assert candidate_rejection_reason(base, "202426107206") == ""
    assert "款号" in candidate_rejection_reason(
        base.__class__(**{**base.__dict__, "style_code": "201426122101"}),
        "202426107206",
    )
    assert "手写" in candidate_rejection_reason(
        base.__class__(**{**base.__dict__, "handwritten_placeholder": True}),
        "202426107206",
    )
    assert "否定" in candidate_rejection_reason(
        base.__class__(**{**base.__dict__, "negative_text": "无吊牌"}),
        "202426107206",
    )
    assert "印刷" in candidate_rejection_reason(
        base.__class__(**{**base.__dict__, "printed_label": False}),
        "202426107206",
    )


def test_candidate_rejection_reason_allows_normal_wash_care_negative_text():
    candidate = LabelCandidate(
        kind="wash_label",
        style_code="201426105102",
        color_code="00415",
        sizes=("110/56",),
        bbox=(0.1, 0.2, 0.3, 0.8),
        confidence=0.98,
        printed_label=True,
        handwritten_placeholder=False,
        negative_text="不可干洗",
        source_path=Path("yq2.jpg"),
        page_index=-1,
        model_id="gpt-5.6-terra",
    )

    assert candidate_rejection_reason(candidate, "201426105102") == ""


def _candidate(model_id: str, **overrides) -> LabelCandidate:
    candidate = LabelCandidate(
        kind="hang_tag",
        style_code="202426107206",
        color_code="70013",
        sizes=("110/56",),
        bbox=(0.1, 0.2, 0.3, 0.8),
        confidence=0.98,
        printed_label=True,
        handwritten_placeholder=False,
        negative_text="",
        source_path=Path("yq1.jpg"),
        page_index=-1,
        model_id=model_id,
    )
    return replace(candidate, **overrides)


def test_review_inputs_concurrently_starts_terra_and_luna_together():
    barrier = threading.Barrier(2, timeout=2)
    lock = threading.Lock()
    active = 0
    max_active = 0

    def reviewer(job, model_id):
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)
        barrier.wait()
        time.sleep(0.01)
        with lock:
            active -= 1
        return [_candidate(model_id, source_path=job.image_path)]

    result = review_inputs_concurrently(
        [ReviewJob("existing-1", Path("yq1.jpg"), "202426107206", "hang_tag", -1)],
        reviewer=reviewer,
        max_workers=2,
    )

    assert max_active == 2
    assert {item.model_id for item in result["existing-1"]} == {
        "gpt-5.6-terra",
        "gpt-5.6-luna",
    }


def test_validate_existing_yq_accepts_two_matching_printed_label_votes():
    decision = validate_existing_yq(
        {"__yq_kind": "hang_tag", "__style_color_code": ""},
        Path("yq1.jpg"),
        "202426107206",
        reviews=[_candidate("gpt-5.6-terra"), _candidate("gpt-5.6-luna")],
    )

    assert decision.accepted
    assert decision.role == "hang_tag"
    assert decision.color_code == ""
    assert decision.model_ids == ("gpt-5.6-luna", "gpt-5.6-terra")


def test_validate_existing_yq_treats_blank_and_wash_care_text_as_same_semantics():
    calls = []

    def sol_reviewer(job, model_id):
        calls.append((job.job_id, model_id))
        return []

    decision = validate_existing_yq(
        {"__yq_kind": "wash_label", "__style_color_code": "201426105102-00415"},
        Path("201426105102-00415_yq2.jpg"),
        "201426105102",
        reviews=[
            _candidate(
                "gpt-5.6-terra",
                kind="wash_label",
                style_code="201426105102",
                color_code="00415",
                negative_text="",
            ),
            _candidate(
                "gpt-5.6-luna",
                kind="wash_label",
                style_code="201426105102",
                color_code="00415",
                negative_text="不可干洗",
            ),
        ],
        sol_reviewer=sol_reviewer,
    )

    assert decision.accepted
    assert calls == []
    assert decision.role == "wash_label"


def test_validate_existing_yq_ignores_unscoped_name_strip_role_distractor():
    reviews = []
    for model_id in ("gpt-5.6-terra", "gpt-5.6-luna"):
        reviews.extend([
            _candidate(
                model_id,
                kind="wash_label",
                style_code="202426107206",
                color_code="",
                sizes=(),
            ),
            _candidate(
                model_id,
                kind="hang_tag",
                style_code="",
                color_code="",
                sizes=(),
            ),
        ])

    decision = validate_existing_yq(
        {"__yq_kind": "wash_label"},
        Path("yq2.jpg"),
        "202426107206",
        reviews=reviews,
    )

    assert decision.accepted
    assert decision.role == "wash_label"
    assert decision.style_code == "202426107206"
    assert decision.model_ids == ("gpt-5.6-luna", "gpt-5.6-terra")


def test_validate_existing_yq_keeps_true_waste_text_fail_closed():
    decision = validate_existing_yq(
        {"__yq_kind": "wash_label", "__style_color_code": "201426105102-00415"},
        Path("201426105102-00415_yq2.jpg"),
        "201426105102",
        reviews=[
            _candidate(
                "gpt-5.6-terra",
                kind="wash_label",
                style_code="201426105102",
                color_code="00415",
                negative_text="无水洗",
            ),
            _candidate(
                "gpt-5.6-luna",
                kind="wash_label",
                style_code="201426105102",
                color_code="00415",
                negative_text="无水洗",
            ),
        ],
    )

    assert not decision.accepted
    assert "否定" in decision.reason


def test_validate_existing_yq_accepts_two_matching_related_component_votes():
    decision = validate_existing_yq(
        {"__yq_kind": "wash_label"},
        Path("yq2.jpg"),
        "201426105102",
        reviews=[
            _candidate(
                "gpt-5.6-terra",
                kind="wash_label",
                style_code="201426122101",
                color_code="",
                sizes=(),
            ),
            _candidate(
                "gpt-5.6-luna",
                kind="wash_label",
                style_code="201426122101",
                color_code="",
                sizes=(),
            ),
        ],
    )

    assert decision.accepted
    assert decision.style_code == "201426122101"
    assert "关联部件" in decision.reason


@pytest.mark.parametrize(
    ("reviews", "reason_fragment"),
    [
        (
            [_candidate("gpt-5.6-terra"), _candidate("gpt-5.6-luna", kind="wash_label")],
            "分歧",
        ),
        (
            [_candidate("gpt-5.6-terra", handwritten_placeholder=True), _candidate("gpt-5.6-luna", handwritten_placeholder=True)],
            "手写",
        ),
        (
            [_candidate("gpt-5.6-terra", negative_text="无吊牌"), _candidate("gpt-5.6-luna", negative_text="无吊牌")],
            "否定",
        ),
        (
            [_candidate("gpt-5.6-terra")],
            "不足",
        ),
    ],
)
def test_validate_existing_yq_fails_closed_without_two_valid_matching_votes(reviews, reason_fragment):
    decision = validate_existing_yq(
        {"__yq_kind": "hang_tag"},
        Path("yq1.jpg"),
        "202426107206",
        reviews=reviews,
    )

    assert not decision.accepted
    assert reason_fragment in decision.reason


def test_validate_existing_yq_calls_sol_once_only_for_model_disagreement():
    calls = []

    def sol_reviewer(job, model_id):
        calls.append((job.job_id, model_id))
        return [_candidate(model_id)]

    decision = validate_existing_yq(
        {"__yq_kind": "hang_tag"},
        Path("yq1.jpg"),
        "202426107206",
        reviews=[
            _candidate("gpt-5.6-terra"),
            _candidate("gpt-5.6-luna", kind="wash_label"),
        ],
        sol_reviewer=sol_reviewer,
    )

    assert decision.accepted
    assert calls == [("existing:yq1.jpg", "gpt-5.6-sol")]
    assert decision.model_ids == ("gpt-5.6-sol", "gpt-5.6-terra")


def test_validate_existing_yq_accepts_only_when_sol_matches_one_initial_vote():
    calls = []

    def sol_reviewer(job, model_id):
        calls.append((job.job_id, model_id))
        return [_candidate(model_id, kind="wash_label", color_code="81322", sizes=("110/56",))]

    decision = validate_existing_yq(
        {"__yq_kind": "hang_tag"},
        Path("yq1.jpg"),
        "202426107206",
        reviews=[
            _candidate("gpt-5.6-terra", kind="hang_tag", color_code="70013", sizes=("110/56",)),
            _candidate("gpt-5.6-luna", kind="wash_label", color_code="81322", sizes=("110/56",)),
        ],
        sol_reviewer=sol_reviewer,
    )

    assert decision.accepted
    assert calls == [("existing:yq1.jpg", "gpt-5.6-sol")]
    assert decision.role == "wash_label"
    assert decision.model_ids == ("gpt-5.6-luna", "gpt-5.6-sol")


def test_validate_existing_yq_uses_exact_yq_name_as_guarded_tiebreaker():
    decision = validate_existing_yq(
        {"__yq_kind": "wash_label"},
        Path("yq2.jpg"),
        "202426107206",
        reviews=[
            _candidate(
                "gpt-5.6-terra",
                kind="wash_label",
                style_code="202426107206",
                color_code="",
                sizes=(),
            ),
            _candidate(
                "gpt-5.6-luna",
                kind="non_label",
                style_code="",
                color_code="",
                sizes=(),
                printed_label=False,
                negative_text="无水洗",
            ),
        ],
        sol_reviewer=lambda *_args, **_kwargs: [],
    )

    assert decision.accepted
    assert decision.role == "wash_label"
    assert decision.style_code == "202426107206"
    assert "精确 yq" in decision.reason


def test_validate_existing_yq_exact_name_still_rejects_two_waste_votes():
    decision = validate_existing_yq(
        {"__yq_kind": "wash_label"},
        Path("yq2.jpg"),
        "202426107206",
        reviews=[
            _candidate(
                "gpt-5.6-terra",
                kind="wash_label",
                style_code="202426107206",
                color_code="",
                sizes=(),
                negative_text="无水洗",
            ),
            _candidate(
                "gpt-5.6-luna",
                kind="wash_label",
                style_code="202426107206",
                color_code="",
                sizes=(),
                negative_text="无水洗",
            ),
        ],
    )

    assert not decision.accepted
    assert "否定" in decision.reason


def test_validate_existing_yq_does_not_use_filename_tiebreaker_for_descriptive_name():
    decision = validate_existing_yq(
        {"__yq_kind": "wash_label"},
        Path("202426107206 洗唛.png"),
        "202426107206",
        reviews=[
            _candidate(
                "gpt-5.6-terra",
                kind="wash_label",
                style_code="202426107206",
                color_code="",
                sizes=(),
            ),
            _candidate(
                "gpt-5.6-luna",
                kind="non_label",
                style_code="",
                color_code="",
                sizes=(),
                printed_label=False,
            ),
        ],
        sol_reviewer=lambda *_args, **_kwargs: [],
    )

    assert not decision.accepted
    assert "分歧" in decision.reason


def test_validate_existing_yq_rejects_when_sol_matches_no_initial_vote():
    def sol_reviewer(job, model_id):
        return [_candidate(model_id, kind="wash_label", color_code="99999", sizes=("120/60",))]

    decision = validate_existing_yq(
        {"__yq_kind": "hang_tag"},
        Path("yq1.jpg"),
        "202426107206",
        reviews=[
            _candidate("gpt-5.6-terra", kind="hang_tag", color_code="70013", sizes=("110/56",)),
            _candidate("gpt-5.6-luna", kind="wash_label", color_code="81322", sizes=("110/56",)),
        ],
        sol_reviewer=sol_reviewer,
    )

    assert not decision.accepted
    assert "分歧" in decision.reason


def test_merge_page_reviews_merges_same_page_model_bbox_variation_without_conflict():
    reviews = []
    for index, size in enumerate((90, 100, 110, 120, 130, 140)):
        left = 0.02 + index * 0.14
        reviews.extend([
            _candidate(
                "gpt-5.6-terra",
                sizes=(f"{size}/56",),
                bbox=(left, 0.24, left + 0.13, 0.74),
                source_path=Path("page-1.png"),
                page_index=0,
            ),
            _candidate(
                "gpt-5.6-luna",
                sizes=(f"{size}/56", "90-175"),
                bbox=(left + 0.002, 0.238, left + 0.132, 0.738),
                source_path=Path("page-1.png"),
                page_index=0,
            ),
        ])

    merged = merge_page_reviews(reviews)

    assert len(merged) == 6
    assert [preferred_size(item.sizes) for item in merged] == [90, 100, 110, 120, 130, 140]
    assert all(item.model_id == "gpt-5.6-luna+gpt-5.6-terra" for item in merged)


def test_merge_page_reviews_rejects_single_model_and_conflicting_main_size():
    single = _candidate(
        "gpt-5.6-terra",
        bbox=(0.1, 0.2, 0.3, 0.8),
        source_path=Path("page.png"),
        page_index=0,
    )
    conflict = _candidate(
        "gpt-5.6-luna",
        sizes=("120/60",),
        bbox=(0.101, 0.201, 0.301, 0.801),
        source_path=Path("page.png"),
        page_index=0,
    )

    assert merge_page_reviews([single]) == []
    assert merge_page_reviews([single, conflict]) == []


@pytest.mark.parametrize("bbox", [None, [], ["bad", 0.1, 0.9, 0.9]])
def test_merge_page_reviews_rejects_missing_or_malformed_model_bbox(tmp_path, bbox):
    page = tmp_path / "page.png"
    _save_label_image(page)
    job = ReviewJob("pdf:0:page:0", page, "202426107206", "hang_tag", 0, page)
    payload = {
        "kind": "hang_tag",
        "printed_label": True,
        "handwritten_placeholder": False,
        "style_code": "202426107206",
        "color_code": "70013",
        "sizes": ["110/56"],
        "confidence": 0.99,
    }
    if bbox is not None:
        payload["bbox"] = bbox
    reviews = [
        _candidate_from_payload(payload, job=job, model_id=model_id)
        for model_id in ("gpt-5.6-terra", "gpt-5.6-luna")
    ]

    assert merge_page_reviews(reviews) == []


def test_recover_page_reviews_with_sol_recovers_when_one_initial_model_empty():
    job = ReviewJob("pdf:0:page:0", Path("page-review.jpg"), "202426107206", "hang_tag", 0, Path("page.png"))
    terra_reviews = [
        _candidate(
            "gpt-5.6-terra",
            sizes=(f"{size}/56",),
            bbox=(0.1 + index * 0.2, 0.2, 0.22 + index * 0.2, 0.8),
            source_path=Path("page.png"),
            page_index=0,
        )
        for index, size in enumerate((90, 100, 110))
    ]
    calls = []

    def sol_reviewer(call_job, model_id):
        calls.append((call_job.job_id, model_id))
        return [
            replace(candidate, model_id=model_id, bbox=(
                candidate.bbox[0] + 0.002,
                candidate.bbox[1],
                candidate.bbox[2] + 0.002,
                candidate.bbox[3],
            ))
            for candidate in terra_reviews
        ]

    recovered = recover_page_reviews_with_sol(
        job,
        terra_reviews,
        style_code="202426107206",
        sol_reviewer=sol_reviewer,
    )

    assert calls == [("pdf:0:page:0", "gpt-5.6-sol")]
    assert [preferred_size(candidate.sizes) for candidate in recovered] == [90, 100, 110]
    assert all("gpt-5.6-sol" in candidate.model_id for candidate in recovered)


def test_recover_page_reviews_with_sol_recovers_partial_missing_110_only():
    job = ReviewJob("pdf:0:page:0", Path("page-review.jpg"), "202426107206", "hang_tag", 0, Path("page.png"))
    reviews = []
    for index, size in enumerate((90, 100, 120)):
        left = 0.05 + index * 0.2
        reviews.extend([
            _candidate("gpt-5.6-terra", sizes=(f"{size}/56",), bbox=(left, 0.2, left + 0.12, 0.8), source_path=Path("page.png"), page_index=0),
            _candidate("gpt-5.6-luna", sizes=(f"{size}/56",), bbox=(left + 0.002, 0.2, left + 0.122, 0.8), source_path=Path("page.png"), page_index=0),
        ])
    terra_110 = _candidate(
        "gpt-5.6-terra",
        sizes=("110/56",),
        bbox=(0.65, 0.2, 0.77, 0.8),
        source_path=Path("page.png"),
        page_index=0,
    )
    reviews.append(terra_110)

    def sol_reviewer(_job, model_id):
        return [
            replace(
                terra_110,
                model_id=model_id,
                bbox=(0.652, 0.2, 0.772, 0.8),
            )
        ]

    recovered = recover_page_reviews_with_sol(
        job,
        reviews,
        style_code="202426107206",
        sol_reviewer=sol_reviewer,
    )

    assert [preferred_size(candidate.sizes) for candidate in recovered] == [90, 100, 120, 110]
    assert len([candidate for candidate in recovered if preferred_size(candidate.sizes) == 110]) == 1


def test_recover_page_reviews_with_sol_rejects_unmatched_third_opinion():
    job = ReviewJob("pdf:0:page:0", Path("page-review.jpg"), "202426107206", "hang_tag", 0, Path("page.png"))
    initial = [
        _candidate("gpt-5.6-terra", sizes=("110/56",), bbox=(0.1, 0.2, 0.3, 0.8), source_path=Path("page.png"), page_index=0),
    ]

    def sol_reviewer(_job, model_id):
        return [
            _candidate(model_id, sizes=("120/60",), bbox=(0.6, 0.2, 0.8, 0.8), source_path=Path("page.png"), page_index=0),
        ]

    assert recover_page_reviews_with_sol(
        job,
        initial,
        style_code="202426107206",
        sol_reviewer=sol_reviewer,
    ) == []


def test_recover_page_reviews_with_sol_skips_sol_when_initial_agreement_complete():
    job = ReviewJob("pdf:0:page:0", Path("page-review.jpg"), "202426107206", "hang_tag", 0, Path("page.png"))
    reviews = []
    for index, size in enumerate((90, 100, 110)):
        left = 0.1 + index * 0.2
        reviews.extend([
            _candidate("gpt-5.6-terra", sizes=(f"{size}/56",), bbox=(left, 0.2, left + 0.12, 0.8), source_path=Path("page.png"), page_index=0),
            _candidate("gpt-5.6-luna", sizes=(f"{size}/56",), bbox=(left + 0.002, 0.2, left + 0.122, 0.8), source_path=Path("page.png"), page_index=0),
        ])

    def sol_reviewer(_job, _model_id):
        pytest.fail("Sol should not run when Terra/Luna already cover the page")

    recovered = recover_page_reviews_with_sol(
        job,
        reviews,
        style_code="202426107206",
        sol_reviewer=sol_reviewer,
    )

    assert [preferred_size(candidate.sizes) for candidate in recovered] == [90, 100, 110]
    assert all(candidate.model_id == "gpt-5.6-luna+gpt-5.6-terra" for candidate in recovered)


def test_select_candidates_keeps_one_best_hang_tag_per_style_across_colors():
    candidates = [
        _candidate("m1+m2", color_code="70013", sizes=("90/52",), page_index=0),
        _candidate("m1+m2", color_code="70013", sizes=("110/56",), page_index=0),
        _candidate("m1+m2", color_code="81322", sizes=("90/52",), page_index=2),
        _candidate("m1+m2", color_code="81322", sizes=("120/60",), page_index=2),
        _candidate("m1+m2", color_code="99999", sizes=("90/52",), page_index=4),
        _candidate("m1+m2", color_code="99999", sizes=("100/52",), page_index=4),
    ]

    selected = select_candidates(
        candidates,
        "202426107206",
        {"hang_tag"},
    )

    assert [(item.color_code, preferred_size(item.sizes)) for item in selected] == [
        ("70013", 110),
    ]


def test_crop_candidate_to_canvas_preserves_aspect_and_uses_white_800_canvas(tmp_path):
    page = tmp_path / "page.png"
    output = tmp_path / "yq1.jpg"
    image = Image.new("RGB", (1000, 600), "white")
    ImageDraw.Draw(image).rectangle((200, 100, 399, 499), fill=(20, 80, 160))
    image.save(page)

    crop_candidate_to_canvas(page, (0.2, 1 / 6, 0.4, 5 / 6), output)

    with Image.open(output) as result:
        assert result.size == (800, 800)
        assert result.mode == "RGB"
        assert result.getpixel((0, 0)) == (255, 255, 255)
        pixels = result.load()
        points = [
            (x, y)
            for y in range(result.height)
            for x in range(result.width)
            if min(pixels[x, y]) < 240
        ]
        left, top = min(x for x, _ in points), min(y for _, y in points)
        right, bottom = max(x for x, _ in points), max(y for _, y in points)
        assert 365 <= right - left <= 390
        assert 730 <= bottom - top <= 745


@pytest.mark.parametrize(
    "bbox",
    [
        (-0.1, 0.2, 0.3, 0.8),
        (0.1, 0.2, 1.1, 0.8),
        (0.3, 0.2, 0.1, 0.8),
        (0.1, 0.2, 0.11, 0.21),
    ],
)
def test_crop_candidate_to_canvas_rejects_invalid_bbox(tmp_path, bbox):
    page = tmp_path / "page.png"
    Image.new("RGB", (400, 400), "white").save(page)
    with pytest.raises(ValueError, match="裁框"):
        crop_candidate_to_canvas(page, bbox, tmp_path / "out.jpg")


def test_verify_crop_rejects_blank_and_wrong_ocr_but_accepts_consensus_without_ocr(tmp_path):
    blank = tmp_path / "blank.jpg"
    valid = tmp_path / "valid.jpg"
    Image.new("RGB", (800, 800), "white").save(blank)
    image = Image.new("RGB", (800, 800), "white")
    ImageDraw.Draw(image).rectangle((250, 50, 550, 750), fill="black")
    image.save(valid)
    candidate = _candidate(
        "gpt-5.6-luna+gpt-5.6-terra",
        sizes=("110/56",),
        confidence=0.98,
    )

    assert not verify_crop(candidate, blank, ocr_fn=None).accepted
    wrong = verify_crop(
        candidate,
        valid,
        ocr_fn=lambda _path: {"text": "款号 201426122101 尺码 110"},
    )
    assert not wrong.accepted
    assert "款号" in wrong.reason
    accepted = verify_crop(candidate, valid, ocr_fn=None)
    assert accepted.accepted
    assert "双模型" in accepted.reason


def _save_label_image(path: Path, color: str = "black") -> None:
    image = Image.new("RGB", (500, 700), "white")
    ImageDraw.Draw(image).rectangle((100, 50, 400, 650), outline=color, width=12)
    image.save(path)


def test_process_labels_recovers_pages_concurrently_but_outputs_one_style_level_yq1(tmp_path):
    style = "202426107206"
    package_root = tmp_path / "package"
    pdf = tmp_path / "tag.pdf"
    pdf.write_bytes(b"%PDF-fake")
    pages = []
    for index, color in enumerate(("blue", "red")):
        page = tmp_path / f"page-{index}.png"
        _save_label_image(page, color)
        pages.append(RenderedPage(index, page, 500, 700))
    pdf_row = {
        "输入款号": style,
        "本地文件": str(pdf),
        "下载结果": "已下载",
        "__pdf_type": "hang_tag",
    }

    def reviewer(job, model_id):
        if model_id == "gpt-5.6-luna":
            return []
        return [
            _candidate(
                model_id,
                style_code=style,
                color_code=("70013" if job.page_index == 0 else "81322"),
                sizes=("110/56",),
                bbox=(0.2, 0.05, 0.8, 0.95),
                source_path=job.source_path or job.image_path,
                page_index=job.page_index,
            )
        ]

    barrier = threading.Barrier(2, timeout=0.5)
    lock = threading.Lock()
    active = 0
    max_active = 0

    def sol_reviewer(job, model_id):
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)
        try:
            barrier.wait()
            return reviewer(job, model_id)
        finally:
            with lock:
                active -= 1

    result = process_prepare_upload_package_labels(
        data_rows=[],
        package_root=package_root,
        pdf_rows=[(pdf_row, pdf, style)],
        work_dir=tmp_path / "work",
        run_params={},
        log=lambda _message: None,
        reviewer=reviewer,
        sol_reviewer=sol_reviewer,
        render_pages_fn=lambda *_args, **_kwargs: pages,
        ocr_fn=None,
    )

    assert result.generated_count == 1
    assert max_active == 2
    assert (package_root / style / "yq(1).jpg").is_file()
    assert not list((package_root / style).glob(f"{style}-*_yq1.jpg"))


def test_prepare_review_image_bounds_large_source_without_modifying_original(tmp_path):
    source = tmp_path / "large.png"
    Image.effect_noise((3200, 2400), 80).convert("RGB").save(source)
    before_size = source.stat().st_size

    preview = prepare_review_image(source, tmp_path / "previews")

    assert preview != source
    assert source.stat().st_size == before_size
    assert preview.stat().st_size < 10 * 1024 * 1024
    with Image.open(preview) as image:
        assert max(image.size) <= 2048
        assert image.width / image.height == pytest.approx(4 / 3, rel=0.01)


def test_process_labels_skips_all_pdf_work_when_valid_yq1_and_yq2_exist(tmp_path):
    style = "202426107206"
    package_root = tmp_path / "package"
    style_dir = package_root / style
    style_dir.mkdir(parents=True)
    yq1 = style_dir / "yq1.jpg"
    yq2 = style_dir / "yq2.jpg"
    _save_label_image(yq1)
    _save_label_image(yq2)
    pdf = tmp_path / "tag.pdf"
    pdf.write_bytes(b"%PDF-fake")
    rows = [
        {
            "输入款号": style,
            "本地文件": str(yq1),
            "下载结果": "已下载",
            "__shenhui_group_code": style,
            "__shenhui_asset_role": "yq",
            "__yq_kind": "hang_tag",
        },
        {
            "输入款号": style,
            "本地文件": str(yq2),
            "下载结果": "已下载",
            "__shenhui_group_code": style,
            "__shenhui_asset_role": "yq",
            "__yq_kind": "wash_label",
        },
    ]
    pdf_row = {
        "输入款号": style,
        "本地文件": str(pdf),
        "下载结果": "已下载",
        "__pdf_type": "hang_tag",
    }

    def reviewer(job, model_id):
        return [
            _candidate(
                model_id,
                kind=job.expected_role,
                color_code="",
                source_path=job.image_path,
            )
        ]

    result = process_prepare_upload_package_labels(
        data_rows=rows,
        package_root=package_root,
        pdf_rows=[(pdf_row, pdf, style)],
        work_dir=tmp_path / "work",
        run_params={},
        log=lambda _message: None,
        reviewer=reviewer,
        sol_reviewer=reviewer,
        render_pages_fn=lambda *_args, **_kwargs: pytest.fail("PDF should be skipped"),
        ocr_fn=None,
    )

    assert isinstance(result, ApparelLabelProcessingResult)
    assert result.generated_count == 0
    assert {path.name for path in result.accepted_existing} == {"yq(1).jpg", "yq(2).jpg"}
    assert pdf_row["处理动作"] == "现成 yq 已锁定，跳过对应 PDF"


def test_process_labels_corrects_existing_yq_role_after_deleting_invalid_collision(tmp_path):
    style = "201426105102"
    package_root = tmp_path / "package"
    style_dir = package_root / style
    style_dir.mkdir(parents=True)
    yq1 = style_dir / "yq1.jpg"
    yq2 = style_dir / "yq2.jpg"
    _save_label_image(yq1, "blue")
    _save_label_image(yq2, "red")
    pdf = tmp_path / "hang_tag.pdf"
    pdf.write_bytes(b"%PDF-fake")
    page = tmp_path / "hang_tag_page.png"
    _save_label_image(page, "green")
    rows = [
        {
            "输入款号": style,
            "本地文件": str(yq1),
            "下载结果": "已下载",
            "__shenhui_group_code": style,
            "__shenhui_asset_role": "yq",
            "__yq_kind": "hang_tag",
        },
        {
            "输入款号": style,
            "本地文件": str(yq2),
            "下载结果": "已下载",
            "__shenhui_group_code": style,
            "__shenhui_asset_role": "yq",
            "__yq_kind": "wash_label",
        },
    ]
    pdf_row = {
        "输入款号": style,
        "文件名": "合格证.pdf",
        "本地文件": str(pdf),
        "下载结果": "已下载",
        "__pdf_type": "hang_tag",
    }
    rendered_pdfs = []

    def reviewer(job, model_id):
        source_name = (job.source_path or job.image_path).name
        if source_name == "yq1.jpg":
            return [
                _candidate(
                    model_id,
                    kind="wash_label",
                    style_code=style,
                    color_code="",
                    sizes=(),
                    source_path=job.source_path or job.image_path,
                )
            ]
        if source_name == "yq2.jpg":
            return [
                _candidate(
                    model_id,
                    kind="wash_label",
                    style_code="201426122101",
                    color_code="",
                    sizes=(),
                    source_path=job.source_path or job.image_path,
                )
            ]
        return []

    def render_pages_fn(pdf_path, *_args, **_kwargs):
        rendered_pdfs.append(pdf_path)
        return [RenderedPage(0, page, 500, 700)]

    result = process_prepare_upload_package_labels(
        data_rows=rows,
        package_root=package_root,
        pdf_rows=[(pdf_row, pdf, style)],
        work_dir=tmp_path / "work",
        run_params={},
        log=lambda _message: None,
        reviewer=reviewer,
        sol_reviewer=reviewer,
        render_pages_fn=render_pages_fn,
        ocr_fn=None,
    )

    assert [path.name for path in result.accepted_existing] == [
        "yq(2).jpg",
        "yq(2)-2.jpg",
    ]
    assert result.rejected_paths == ()
    assert not yq1.exists()
    assert not yq2.exists()
    main_wash = style_dir / "yq(2).jpg"
    related_wash = style_dir / "yq(2)-2.jpg"
    assert main_wash.is_file()
    assert related_wash.is_file()
    assert rows[0]["本地文件"] == str(main_wash)
    assert rows[0]["文件名"] == "yq(2).jpg"
    assert rows[0]["__yq_kind"] == "wash_label"
    assert rows[0]["标签角色"] == "洗唛"
    assert "已从 yq1.jpg 更正为 yq(2).jpg" in rows[0]["备注"]
    assert "吊牌图片" not in rows[0]["备注"]
    assert rows[1]["下载结果"] == "已下载"
    assert rows[1]["本地文件"] == str(related_wash)
    assert rows[1]["最终裁图"] == str(related_wash)
    assert rows[1]["识别款号"] == "201426122101"
    assert rows[1]["标签判定"] == "关联部件标签有效"
    assert "关联部件" in rows[1]["标签证据"]
    assert rendered_pdfs == [pdf]
    assert result.missing_roles == (f"{style}:hang_tag",)


def test_process_labels_prefers_explicit_yq_name_over_duplicate_descriptive_label(tmp_path):
    style = "202426107206"
    package_root = tmp_path / "package"
    style_dir = package_root / style
    style_dir.mkdir(parents=True)
    descriptive = style_dir / f"{style} 洗唛.png"
    explicit = style_dir / "yq2.jpg"
    _save_label_image(descriptive, "blue")
    _save_label_image(explicit, "red")
    rows = [
        {
            "输入款号": style,
            "文件名": descriptive.name,
            "本地文件": str(descriptive),
            "下载结果": "已下载",
            "__shenhui_group_code": style,
            "__shenhui_asset_role": "yq",
            "__yq_kind": "wash_label",
        },
        {
            "输入款号": style,
            "文件名": explicit.name,
            "本地文件": str(explicit),
            "下载结果": "已下载",
            "__shenhui_group_code": style,
            "__shenhui_asset_role": "yq",
            "__yq_kind": "wash_label",
        },
    ]

    def reviewer(job, model_id):
        return [
            _candidate(
                model_id,
                kind="wash_label",
                style_code=style,
                color_code="",
                sizes=(),
                source_path=job.source_path or job.image_path,
            )
        ]

    result = process_prepare_upload_package_labels(
        data_rows=rows,
        package_root=package_root,
        pdf_rows=[],
        work_dir=tmp_path / "work",
        run_params={},
        log=lambda _message: None,
        reviewer=reviewer,
        sol_reviewer=reviewer,
        ocr_fn=None,
    )

    canonical = style_dir / "yq(2).jpg"
    assert result.accepted_existing == (canonical,)
    assert not descriptive.exists()
    assert canonical.is_file()
    assert rows[0]["下载结果"] == "已剔除"
    assert rows[0]["本地文件"] == ""
    assert "明确 yq(2)" in rows[0]["标签证据"]
    assert rows[1]["标签角色"] == "洗唛"


def test_process_labels_deduplicates_rows_sharing_one_physical_yq_without_deleting_winner(tmp_path):
    style = "202426107206"
    package_root = tmp_path / "package"
    style_dir = package_root / style
    style_dir.mkdir(parents=True)
    yq2 = style_dir / "yq2.jpg"
    _save_label_image(yq2)
    rows = [
        {
            "输入款号": style,
            "文件名": yq2.name,
            "本地文件": str(yq2),
            "下载结果": "已下载",
            "__shenhui_group_code": style,
            "__shenhui_asset_role": "yq",
            "__yq_kind": "wash_label",
        }
        for _index in range(2)
    ]

    def reviewer(job, model_id):
        return [
            _candidate(
                model_id,
                kind="wash_label",
                style_code=style,
                color_code="",
                sizes=(),
                source_path=job.source_path or job.image_path,
            )
        ]

    result = process_prepare_upload_package_labels(
        data_rows=rows,
        package_root=package_root,
        pdf_rows=[],
        work_dir=tmp_path / "work",
        run_params={},
        log=lambda _message: None,
        reviewer=reviewer,
        sol_reviewer=reviewer,
        ocr_fn=None,
    )

    canonical = style_dir / "yq(2).jpg"
    assert result.accepted_existing == (canonical,)
    assert canonical.is_file()
    assert sorted(row["下载结果"] for row in rows) == ["已下载", "已剔除"]


def test_process_labels_preserves_two_valid_yq_files_when_roles_swap(tmp_path):
    style = "201426105102"
    package_root = tmp_path / "package"
    style_dir = package_root / style
    style_dir.mkdir(parents=True)
    yq1 = style_dir / "yq1.jpg"
    yq2 = style_dir / "yq2.jpg"
    _save_label_image(yq1, "blue")
    _save_label_image(yq2, "red")
    rows = [
        {
            "输入款号": style,
            "本地文件": str(yq1),
            "下载结果": "已下载",
            "__shenhui_group_code": style,
            "__shenhui_asset_role": "yq",
            "__yq_kind": "hang_tag",
        },
        {
            "输入款号": style,
            "本地文件": str(yq2),
            "下载结果": "已下载",
            "__shenhui_group_code": style,
            "__shenhui_asset_role": "yq",
            "__yq_kind": "wash_label",
        },
    ]

    def reviewer(job, model_id):
        source_name = (job.source_path or job.image_path).name
        role = "wash_label" if source_name == "yq1.jpg" else "hang_tag"
        return [
            _candidate(
                model_id,
                kind=role,
                style_code=style,
                color_code="",
                sizes=(),
                source_path=job.source_path or job.image_path,
            )
        ]

    result = process_prepare_upload_package_labels(
        data_rows=rows,
        package_root=package_root,
        pdf_rows=[],
        work_dir=tmp_path / "work",
        run_params={},
        log=lambda _message: None,
        reviewer=reviewer,
        sol_reviewer=reviewer,
        ocr_fn=None,
    )

    assert sorted(path.name for path in result.accepted_existing) == ["yq(1).jpg", "yq(2).jpg"]
    assert result.rejected_paths == ()
    assert not yq1.exists()
    assert not yq2.exists()
    assert (style_dir / "yq(1).jpg").is_file()
    assert (style_dir / "yq(2).jpg").is_file()
    assert rows[0]["本地文件"] == str(style_dir / "yq(2).jpg")
    assert rows[0]["__yq_kind"] == "wash_label"
    assert rows[0]["标签角色"] == "洗唛"
    assert rows[1]["本地文件"] == str(style_dir / "yq(1).jpg")
    assert rows[1]["__yq_kind"] == "hang_tag"
    assert rows[1]["标签角色"] == "吊牌"


def test_process_labels_rolls_back_visible_files_when_first_stage_rename_fails(tmp_path, monkeypatch):
    style = "201426105102"
    package_root = tmp_path / "package"
    style_dir = package_root / style
    style_dir.mkdir(parents=True)
    yq1 = style_dir / "yq1.jpg"
    yq2 = style_dir / "yq2.jpg"
    _save_label_image(yq1, "blue")
    _save_label_image(yq2, "red")
    before = {yq1: yq1.read_bytes(), yq2: yq2.read_bytes()}
    rows = [
        {
            "输入款号": style,
            "本地文件": str(yq1),
            "下载结果": "已下载",
            "__shenhui_group_code": style,
            "__shenhui_asset_role": "yq",
            "__yq_kind": "hang_tag",
        },
        {
            "输入款号": style,
            "本地文件": str(yq2),
            "下载结果": "已下载",
            "__shenhui_group_code": style,
            "__shenhui_asset_role": "yq",
            "__yq_kind": "wash_label",
        },
    ]

    def reviewer(job, model_id):
        source_name = (job.source_path or job.image_path).name
        role = "wash_label" if source_name == "yq1.jpg" else "hang_tag"
        return [_candidate(model_id, kind=role, style_code=style, color_code="", sizes=())]

    original_rename = Path.rename
    rename_calls = []
    failed = False

    def failing_rename(self, target):
        nonlocal failed
        rename_calls.append((self.name, Path(target).name))
        if (
            not failed
            and self == yq2
            and Path(target).name.startswith(".yq2.jpg.shenhui-tmp-")
        ):
            failed = True
            raise OSError("injected first-stage rename failure")
        return original_rename(self, target)

    monkeypatch.setattr(Path, "rename", failing_rename)

    with pytest.raises(RuntimeError, match="injected first-stage rename failure"):
        process_prepare_upload_package_labels(
            data_rows=rows,
            package_root=package_root,
            pdf_rows=[],
            work_dir=tmp_path / "work",
            run_params={},
            log=lambda _message: None,
            reviewer=reviewer,
            sol_reviewer=reviewer,
            ocr_fn=None,
        )

    assert any(name.startswith(".yq1.jpg.shenhui-tmp-") for _src, name in rename_calls)
    assert yq1.read_bytes() == before[yq1]
    assert yq2.read_bytes() == before[yq2]
    assert not list(style_dir.glob(".*.shenhui-tmp-*"))


def test_process_labels_rolls_back_visible_files_when_second_stage_rename_fails(tmp_path, monkeypatch):
    style = "201426105102"
    package_root = tmp_path / "package"
    style_dir = package_root / style
    style_dir.mkdir(parents=True)
    yq1 = style_dir / "yq1.jpg"
    yq2 = style_dir / "yq2.jpg"
    _save_label_image(yq1, "blue")
    _save_label_image(yq2, "red")
    before = {yq1: yq1.read_bytes(), yq2: yq2.read_bytes()}
    rows = [
        {
            "输入款号": style,
            "本地文件": str(yq1),
            "下载结果": "已下载",
            "__shenhui_group_code": style,
            "__shenhui_asset_role": "yq",
            "__yq_kind": "hang_tag",
        },
        {
            "输入款号": style,
            "本地文件": str(yq2),
            "下载结果": "已下载",
            "__shenhui_group_code": style,
            "__shenhui_asset_role": "yq",
            "__yq_kind": "wash_label",
        },
    ]

    def reviewer(job, model_id):
        source_name = (job.source_path or job.image_path).name
        role = "wash_label" if source_name == "yq1.jpg" else "hang_tag"
        return [_candidate(model_id, kind=role, style_code=style, color_code="", sizes=())]

    original_rename = Path.rename
    failed = False

    def failing_rename(self, target):
        nonlocal failed
        target_path = Path(target)
        if (
            not failed
            and self.name.startswith(".yq2.jpg.shenhui-tmp-")
            and target_path.name == "yq(1).jpg"
        ):
            failed = True
            raise OSError("injected second-stage rename failure")
        return original_rename(self, target)

    monkeypatch.setattr(Path, "rename", failing_rename)

    with pytest.raises(RuntimeError, match="injected second-stage rename failure"):
        process_prepare_upload_package_labels(
            data_rows=rows,
            package_root=package_root,
            pdf_rows=[],
            work_dir=tmp_path / "work",
            run_params={},
            log=lambda _message: None,
            reviewer=reviewer,
            sol_reviewer=reviewer,
            ocr_fn=None,
        )

    assert yq1.read_bytes() == before[yq1]
    assert yq2.read_bytes() == before[yq2]
    assert not list(style_dir.glob(".*.shenhui-tmp-*"))


def test_process_labels_only_fills_missing_hang_tag_with_110_crop(tmp_path):
    style = "202426107206"
    package_root = tmp_path / "package"
    style_dir = package_root / style
    style_dir.mkdir(parents=True)
    yq2 = style_dir / "yq2.jpg"
    _save_label_image(yq2)
    pdf = tmp_path / "tag.pdf"
    pdf.write_bytes(b"%PDF-fake")
    page = tmp_path / "page.png"
    _save_label_image(page, "blue")
    rows = [{
        "输入款号": style,
        "本地文件": str(yq2),
        "下载结果": "已下载",
        "__shenhui_group_code": style,
        "__shenhui_asset_role": "yq",
        "__yq_kind": "wash_label",
    }, {
        "输入款号": style,
        "文件名": f"{style}-70013.jpg",
        "下载结果": "已下载",
        "__shenhui_group_code": style,
        "__shenhui_asset_role": "product",
    }]
    pdf_row = {
        "输入款号": style,
        "文件名": "合格证.pdf",
        "本地文件": str(pdf),
        "下载结果": "已下载",
        "__pdf_type": "hang_tag",
    }

    def reviewer(job, model_id):
        if job.job_id.startswith("existing:"):
            return [
                _candidate(
                    model_id,
                    kind="wash_label",
                    color_code="",
                    sizes=(),
                    source_path=job.image_path,
                )
            ]
        return [
            _candidate(
                    model_id,
                    kind="hang_tag",
                    color_code="",
                sizes=("110/56",),
                bbox=(0.1, 0.05, 0.9, 0.95),
                source_path=job.image_path,
                page_index=job.page_index,
            )
        ]

    result = process_prepare_upload_package_labels(
        data_rows=rows,
        package_root=package_root,
        pdf_rows=[(pdf_row, pdf, style)],
        work_dir=tmp_path / "work",
        run_params={},
        log=lambda _message: None,
        reviewer=reviewer,
        sol_reviewer=reviewer,
        render_pages_fn=lambda *_args, **_kwargs: [
            RenderedPage(0, page, 500, 700)
        ],
        ocr_fn=None,
    )

    output = style_dir / "yq(1).jpg"
    assert result.generated_count == 1
    assert output.is_file()
    with Image.open(output) as image:
        assert image.size == (800, 800)
        assert image.mode == "RGB"
    assert not yq2.exists()
    assert (style_dir / "yq(2).jpg").is_file()
    assert pdf_row["处理动作"] == "AI 识别裁图完成"
    generated_row = next(row for row in rows if row.get("最终裁图") == str(output))
    assert generated_row["识别色号"] == "70013"
    assert "唯一款色文件名证据" in generated_row["标签证据"]
    assert generated_row["识别尺码"] == "110"
    assert generated_row["标签角色"] == "吊牌"


def test_process_labels_reports_missing_wash_label_when_only_hang_tag_succeeds(tmp_path):
    style = "201426105102"
    package_root = tmp_path / "package"
    style_dir = package_root / style
    style_dir.mkdir(parents=True)
    yq2 = style_dir / "yq2.jpg"
    _save_label_image(yq2, "red")
    pdf = tmp_path / "hang_tag.pdf"
    pdf.write_bytes(b"%PDF-fake")
    page = tmp_path / "page.png"
    _save_label_image(page, "blue")
    rows = [{
        "输入款号": style,
        "本地文件": str(yq2),
        "下载结果": "已下载",
        "__shenhui_group_code": style,
        "__shenhui_asset_role": "yq",
        "__yq_kind": "wash_label",
    }]
    pdf_row = {
        "输入款号": style,
        "文件名": "合格证.pdf",
        "本地文件": str(pdf),
        "下载结果": "已下载",
        "__pdf_type": "hang_tag",
    }

    def reviewer(job, model_id):
        if job.job_id.startswith("existing:"):
            return [
                _candidate(
                    model_id,
                    kind="wash_label",
                    style_code=style,
                    color_code="",
                    sizes=(),
                    negative_text="无水洗",
                    source_path=job.source_path or job.image_path,
                )
            ]
        return [
            _candidate(
                model_id,
                kind="hang_tag",
                style_code=style,
                color_code="00415",
                sizes=("110/56",),
                bbox=(0.1, 0.05, 0.9, 0.95),
                source_path=job.source_path or job.image_path,
                page_index=job.page_index,
            )
        ]

    result = process_prepare_upload_package_labels(
        data_rows=rows,
        package_root=package_root,
        pdf_rows=[(pdf_row, pdf, style)],
        work_dir=tmp_path / "work",
        run_params={},
        log=lambda _message: None,
        reviewer=reviewer,
        sol_reviewer=reviewer,
        render_pages_fn=lambda *_args, **_kwargs: [
            RenderedPage(0, page, 500, 700)
        ],
        ocr_fn=None,
    )

    assert result.generated_count == 1
    assert (style_dir / "yq(1).jpg").is_file()
    assert result.missing_roles == (f"{style}:wash_label",)


def test_process_labels_one_valid_color_scoped_wash_label_satisfies_style(tmp_path):
    style = "202426107206"
    package_root = tmp_path / "package"
    style_dir = package_root / style
    style_dir.mkdir(parents=True)
    yq1 = style_dir / "yq1.jpg"
    yq2_70013 = style_dir / f"{style}-70013_yq2.jpg"
    yq2_81322 = style_dir / f"{style}-81322_yq2.jpg"
    for path in (yq1, yq2_70013, yq2_81322):
        _save_label_image(path)
    rows = [
        {
            "输入款号": style,
            "本地文件": str(yq1),
            "下载结果": "已下载",
            "__shenhui_group_code": style,
            "__shenhui_asset_role": "yq",
            "__yq_kind": "hang_tag",
        },
        {
            "输入款号": style,
            "输入编码": f"{style}-70013",
            "本地文件": str(yq2_70013),
            "下载结果": "已下载",
            "__shenhui_group_code": style,
            "__shenhui_asset_role": "yq",
            "__yq_kind": "wash_label",
            "__style_color_code": f"{style}-70013",
        },
        {
            "输入款号": style,
            "输入编码": f"{style}-81322",
            "本地文件": str(yq2_81322),
            "下载结果": "已下载",
            "__shenhui_group_code": style,
            "__shenhui_asset_role": "yq",
            "__yq_kind": "wash_label",
            "__style_color_code": f"{style}-81322",
        },
    ]

    def reviewer(job, model_id):
        source_name = (job.source_path or job.image_path).name
        if source_name == "yq1.jpg":
            return [_candidate(model_id, kind="hang_tag", style_code=style, color_code="", sizes=())]
        color_code = "70013" if "70013" in source_name else "81322"
        negative_text = "" if color_code == "70013" else "无水洗"
        return [
            _candidate(
                model_id,
                kind="wash_label",
                style_code=style,
                color_code=color_code,
                sizes=(),
                negative_text=negative_text,
            )
        ]

    result = process_prepare_upload_package_labels(
        data_rows=rows,
        package_root=package_root,
        pdf_rows=[],
        work_dir=tmp_path / "work",
        run_params={},
        log=lambda _message: None,
        reviewer=reviewer,
        sol_reviewer=reviewer,
        ocr_fn=None,
    )

    assert sorted(path.name for path in result.accepted_existing) == [
        "yq(1).jpg",
        "yq(2).jpg",
    ]
    assert result.missing_roles == ()
    assert not yq2_81322.exists()


def test_process_labels_deduplicates_color_scoped_hang_tags_to_one_style_yq1(tmp_path):
    style = "202426107206"
    package_root = tmp_path / "package"
    style_dir = package_root / style
    style_dir.mkdir(parents=True)
    yq1_70013 = style_dir / f"{style}-70013_yq1.jpg"
    yq1_81322 = style_dir / f"{style}-81322_yq1.jpg"
    yq2 = style_dir / "yq2.jpg"
    for path in (yq1_70013, yq1_81322, yq2):
        _save_label_image(path)
    rows = [
        {
            "输入款号": style,
            "输入编码": f"{style}-70013",
            "本地文件": str(yq1_70013),
            "下载结果": "已下载",
            "__shenhui_group_code": style,
            "__shenhui_asset_role": "yq",
            "__yq_kind": "hang_tag",
            "__style_color_code": f"{style}-70013",
        },
        {
            "输入款号": style,
            "输入编码": f"{style}-81322",
            "本地文件": str(yq1_81322),
            "下载结果": "已下载",
            "__shenhui_group_code": style,
            "__shenhui_asset_role": "yq",
            "__yq_kind": "hang_tag",
            "__style_color_code": f"{style}-81322",
        },
        {
            "输入款号": style,
            "本地文件": str(yq2),
            "下载结果": "已下载",
            "__shenhui_group_code": style,
            "__shenhui_asset_role": "yq",
            "__yq_kind": "wash_label",
        },
    ]

    def reviewer(job, model_id):
        source_name = (job.source_path or job.image_path).name
        if source_name == "yq2.jpg":
            return [_candidate(model_id, kind="wash_label", style_code=style, color_code="", sizes=())]
        color_code = "70013" if "70013" in source_name else "81322"
        return [
            _candidate(
                model_id,
                kind="hang_tag",
                style_code=style,
                color_code=color_code,
                sizes=(),
            )
        ]

    result = process_prepare_upload_package_labels(
        data_rows=rows,
        package_root=package_root,
        pdf_rows=[],
        work_dir=tmp_path / "work",
        run_params={},
        log=lambda _message: None,
        reviewer=reviewer,
        sol_reviewer=reviewer,
        ocr_fn=None,
    )

    assert sorted(path.name for path in result.accepted_existing) == ["yq(1).jpg", "yq(2).jpg"]
    assert sorted(row["下载结果"] for row in rows) == ["已下载", "已下载", "已剔除"]
    assert (style_dir / "yq(1).jpg").is_file()
    assert not list(style_dir.glob(f"{style}-*_yq1.jpg"))
    assert result.missing_roles == ()


def test_process_labels_does_not_report_missing_roles_for_plain_product_images(tmp_path):
    style = "202426107206"
    package_root = tmp_path / "package"
    style_dir = package_root / style
    style_dir.mkdir(parents=True)
    image_path = style_dir / f"{style}-70013_model.jpg"
    _save_label_image(image_path)
    rows = [{
        "输入款号": style,
        "输入编码": f"{style}-70013",
        "本地文件": str(image_path),
        "下载结果": "已下载",
        "__shenhui_group_code": style,
        "__shenhui_asset_role": "image",
        "__style_color_code": f"{style}-70013",
    }]

    result = process_prepare_upload_package_labels(
        data_rows=rows,
        package_root=package_root,
        pdf_rows=[],
        work_dir=tmp_path / "work",
        run_params={},
        log=lambda _message: None,
        reviewer=lambda _job, _model_id: pytest.fail("plain image should not be reviewed"),
        sol_reviewer=lambda _job, _model_id: pytest.fail("plain image should not be reviewed"),
        ocr_fn=None,
    )

    assert result.generated_count == 0
    assert result.missing_roles == ()


def test_process_labels_reports_style_scoped_missing_when_pdf_candidate_verification_fails(tmp_path):
    style = "202426107206"
    package_root = tmp_path / "package"
    style_dir = package_root / style
    style_dir.mkdir(parents=True)
    pdf = tmp_path / "hang_tag.pdf"
    pdf.write_bytes(b"%PDF-fake")
    page = tmp_path / "page.png"
    _save_label_image(page, "blue")
    pdf_row = {
        "输入款号": style,
        "文件名": "合格证.pdf",
        "本地文件": str(pdf),
        "下载结果": "已下载",
        "__pdf_type": "hang_tag",
    }

    def reviewer(job, model_id):
        return [
            _candidate(
                model_id,
                kind="hang_tag",
                style_code=style,
                color_code="00415",
                sizes=("110/56",),
                bbox=(0.1, 0.05, 0.9, 0.95),
                source_path=job.source_path or job.image_path,
                page_index=job.page_index,
            )
        ]

    result = process_prepare_upload_package_labels(
        data_rows=[],
        package_root=package_root,
        pdf_rows=[(pdf_row, pdf, style)],
        work_dir=tmp_path / "work",
        run_params={},
        log=lambda _message: None,
        reviewer=reviewer,
        sol_reviewer=reviewer,
        render_pages_fn=lambda *_args, **_kwargs: [
            RenderedPage(0, page, 500, 700)
        ],
        ocr_fn=lambda _path: {"text": "款号 201426122101 尺码 110"},
    )

    assert result.generated_count == 0
    assert pdf_row["处理动作"] == "截图失败"
    assert pdf_row["标签判定"] == "待人工确认"
    assert "款号" in pdf_row["备注"]
    assert result.missing_roles == (
        f"{style}:hang_tag",
        f"{style}:wash_label",
    )
