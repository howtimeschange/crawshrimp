import json
import sys
from pathlib import Path

from artifacts import shenhui_shoe_rerun_validator as validator
from core import shenhui_shoe_packaging as packaging
from PIL import Image, ImageDraw
import pytest


def semantic_row(slot, facts, *, votes=2, required_votes=2):
    return {
        "规则槽位": slot,
        "原文件名": facts[0]["filename"] if facts else "",
        "语义属性": json.dumps(
            {
                "models": [
                    {"model_id": f"model-{index}", "fact": fact}
                    for index, fact in enumerate(facts, start=1)
                ]
            },
            ensure_ascii=False,
        ),
        "模型共识": json.dumps(
            {
                "status": "locked" if votes >= required_votes else "insufficient_votes",
                "selected_family": (
                    packaging._copy_variant_key(facts[0]["filename"])
                    if facts
                    else ""
                ),
                "votes": votes,
                "required_votes": required_votes,
                "models": [f"model-{index}" for index in range(1, votes + 1)],
            },
            ensure_ascii=False,
        ),
    }


def fact(filename="candidate.jpg", **overrides):
    values = {
        "candidate_id": "I01",
        "filename": filename,
        "asset_type": "shoe",
        "shoe_count": "single",
        "pose": "yq3",
        "background": "gray",
        "complete": True,
        "side": "outer",
        "outsole_visible": False,
        "feature_card": False,
        "confidence": 0.99,
        "matched_slots": ["yq3"],
    }
    values.update(overrides)
    return values


def test_validator_rejects_yq3_semantics_with_feature_card():
    obstructed = fact("tag-over-shoe.jpg", feature_card=True)

    issues = validator.validate_semantic_rows(
        [semantic_row("yq3", [obstructed, obstructed])],
        category="婴童",
    )

    assert any("yq3" in issue and "feature card" in issue for issue in issues)


def test_validator_rejects_baby_tmz4_without_rear_semantics():
    outer = fact(
        "outer.jpg",
        pose="yq3",
        side="outer",
        matched_slots=["tmz4"],
    )

    issues = validator.validate_semantic_rows(
        [semantic_row("tmz4", [outer, outer])],
        category="婴童",
    )

    assert any("tmz4" in issue and "rear" in issue for issue in issues)


def test_validator_rejects_one_model_vote_even_when_fact_is_valid():
    valid = fact("outer.jpg")

    issues = validator.validate_semantic_rows(
        [semantic_row("yq3", [valid], votes=1, required_votes=2)],
        category="婴童",
    )

    assert any("yq3" in issue and "1/2" in issue for issue in issues)


def test_validator_accepts_two_valid_yq3_model_facts():
    valid = fact("outer.jpg")

    issues = validator.validate_semantic_rows(
        [semantic_row("yq3", [valid, valid])],
        category="婴童",
    )

    assert issues == []


def test_validator_rejects_semantic_evidence_for_a_different_source_image():
    valid = fact("voted-outer.jpg")
    row = semantic_row("yq3", [valid, valid])
    row["原文件名"] = "actual-output-source.jpg"

    issues = validator.validate_semantic_rows([row], category="婴童")

    assert any("actual source" in issue and "yq3" in issue for issue in issues)


def test_label_ocr_payload_requires_verified_color_name_and_codes():
    payload = {
        "style_code": "204426146036",
        "color_name": "",
        "color_code": "60301",
        "label_bbox": [100, 100, 900, 900],
        "style_code_bbox": [200, 200, 600, 300],
    }

    with pytest.raises(packaging.llm_gateway.LlmResponseError, match="颜色名称"):
        packaging._validate_label_ocr_payload(
            payload,
            style_code="204426146036",
            color_code="60301",
        )


def test_red_box_must_contain_style_text_bbox(tmp_path: Path):
    path = tmp_path / "tmq.jpg"
    image = Image.new("RGB", (100, 100), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((10, 10, 60, 40), outline=(255, 0, 0), width=3)
    image.save(path, quality=100, subsampling=0)

    assert validator.red_box_contains_bbox(path, (0.20, 0.18, 0.50, 0.32)) is True
    assert validator.red_box_contains_bbox(path, (0.70, 0.70, 0.90, 0.90)) is False


def test_color_folder_must_use_verified_shoe_box_color_name(tmp_path: Path):
    wrong_folder = tmp_path / "1.WHITE_BLACK 60301"
    wrong_folder.mkdir()
    rows = [{
        "颜色": "梦幻粉60301",
        "鞋盒款色名": "梦幻粉60301",
        "鞋盒命名已验证": "是",
        "下载结果": "已下载",
    }]

    issues = validator.validate_color_folder_names([wrong_folder], rows)

    assert any("梦幻粉60301" in issue and "WHITE_BLACK" in issue for issue in issues)


def test_color_folder_accepts_verified_shoe_box_color_name(tmp_path: Path):
    folder = tmp_path / "1.梦幻粉60301"
    folder.mkdir()
    rows = [{
        "颜色": "梦幻粉60301",
        "鞋盒款色名": "梦幻粉60301",
        "鞋盒命名已验证": "是",
        "下载结果": "已下载",
    }]

    assert validator.validate_color_folder_names([folder], rows) == []


def test_channel_file_names_must_match_verified_shoe_box_color_names(tmp_path: Path):
    style_root = tmp_path / "204426146036"
    color_dir = style_root / "1.梦幻粉60301"
    color_dir.mkdir(parents=True)
    (style_root / "jdt.粉色60301.png").write_bytes(b"wrong-name")
    (style_root / "wpt30.粉色60301.png").write_bytes(b"wrong-name")
    rows = [{
        "颜色": "梦幻粉60301",
        "鞋盒款色名": "梦幻粉60301",
        "鞋盒命名已验证": "是",
        "下载结果": "已下载",
    }]

    issues = validator.validate_channel_file_names(style_root, [color_dir], rows)

    assert any("jdt.梦幻粉60301.png" in issue for issue in issues)
    assert any("wpt30.梦幻粉60301.png" in issue for issue in issues)
    assert any("jdt.粉色60301.png" in issue for issue in issues)
    assert any("wpt30.粉色60301.png" in issue for issue in issues)


def test_wpt_transparency_requires_actual_transparent_pixels(tmp_path: Path):
    path = tmp_path / "wpt30.梦幻粉60301.png"
    Image.new("RGBA", (100, 100), (255, 255, 255, 255)).save(path)

    assert validator.image_has_transparent_pixels(path) is False


def test_validate_style_rejects_wpt_without_original_dimensions(tmp_path: Path):
    style_root = tmp_path / "204426146036"
    color_dir = style_root / "1.梦幻粉60301"
    color_dir.mkdir(parents=True)
    wpt = style_root / "wpt30.梦幻粉60301.png"
    Image.new("RGBA", (100, 100), (0, 0, 0, 0)).save(wpt)
    rows = [{
        "颜色": "梦幻粉60301",
        "原文件名": "204426146036-60301+Ai角度图1.png",
        "规则槽位": "wpt30",
        "输出文件名": wpt.name,
        "下载结果": "已下载",
        "鞋盒款色名": "梦幻粉60301",
        "鞋盒命名已验证": "是",
    }]

    issues, _warnings = validator.validate_style(
        style="204426146036",
        style_root=style_root,
        report_rows=rows,
        category="婴童",
    )

    assert any(
        "wpt30 cannot verify original dimensions" in issue
        for issue in issues
    )


def test_tms_must_use_same_source_family_as_tmz5():
    rows = [
        {
            "颜色": "梦幻粉60301",
            "规则槽位": "tmz5",
            "原文件名": "correct-pose.jpg",
            "下载结果": "已下载",
        },
        {
            "颜色": "梦幻粉60301",
            "规则槽位": "tms",
            "原文件名": "different-pose.jpg",
            "下载结果": "已下载",
        },
    ]

    issues = validator.validate_tms_tmz5_source_families(rows)

    assert any("tms source does not match tmz5" in issue for issue in issues)


def test_tmq_validator_requires_red_box_to_contain_ocr_style_code(
    tmp_path: Path,
    monkeypatch,
):
    path = tmp_path / "tmq.jpg"
    image = Image.new("RGB", (100, 100), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((10, 10, 60, 40), outline=(255, 0, 0), width=3)
    image.save(path, quality=100, subsampling=0)
    monkeypatch.setattr(
        validator.shoe.ocr_service,
        "recognize_image_with_tesseract_js",
        lambda *_args, **_kwargs: {
            "words": [
                validator.shoe.ocr_service.OcrWord(
                    text="204426146036",
                    bbox=(70, 70, 95, 90),
                    confidence=99,
                )
            ]
        },
    )

    issues = validator.validate_tmq_style_code(path, "204426146036")

    assert any("red box" in issue for issue in issues)


def test_tmq_validator_accepts_full_style_code_inside_red_box(
    tmp_path: Path,
    monkeypatch,
):
    path = tmp_path / "tmq.jpg"
    image = Image.new("RGB", (100, 100), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((10, 10, 60, 40), outline=(255, 0, 0), width=3)
    image.save(path, quality=100, subsampling=0)
    monkeypatch.setattr(
        validator.shoe.ocr_service,
        "recognize_image_with_tesseract_js",
        lambda *_args, **_kwargs: {
            "words": [
                validator.shoe.ocr_service.OcrWord(
                    text="204426146036",
                    bbox=(20, 18, 50, 32),
                    confidence=99,
                )
            ]
        },
    )

    assert validator.validate_tmq_style_code(path, "204426146036") == []


def test_wpz5_and_box_must_not_be_near_duplicates(tmp_path: Path):
    color_dir = tmp_path / "1.梦幻粉60301"
    color_dir.mkdir()
    image = Image.new("RGB", (240, 180), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse((40, 50, 200, 130), fill=(100, 120, 180))
    image.save(color_dir / "wpz (15).jpg")
    image.save(color_dir / "wpz (16).jpg")

    issues = validator.validate_wpz5_box_distinct(color_dir)

    assert any("wpz (15)" in issue and "wpz (16)" in issue for issue in issues)


def test_channel_validator_requires_real_transparent_padding_when_source_is_small(
    tmp_path: Path,
):
    path = tmp_path / "jdt.png"
    Image.new("RGBA", (800, 800), (255, 255, 255, 255)).save(path)

    issues = validator.validate_transparent_padding(path, (420, 600))

    assert any("transparent padding" in issue for issue in issues)


def test_channel_validator_accepts_transparent_padding_when_source_is_small(
    tmp_path: Path,
):
    path = tmp_path / "tmt.png"
    image = Image.new("RGBA", (800, 800), (0, 0, 0, 0))
    image.alpha_composite(Image.new("RGBA", (420, 600), (255, 255, 255, 255)), (190, 100))
    image.save(path)

    assert validator.validate_transparent_padding(path, (420, 600)) == []


def test_visual_review_sheet_is_created_from_attempt_outputs(tmp_path: Path):
    style_root = tmp_path / "204426146036"
    color_dir = style_root / "1.梦幻粉60301"
    color_dir.mkdir(parents=True)
    Image.new("RGB", (320, 240), "white").save(style_root / "tmz (1).jpg")
    Image.new("RGBA", (800, 800), (0, 0, 0, 0)).save(color_dir / "yq (3).png")
    target = tmp_path / "attempt" / "visual-review.jpg"
    rows = [
        {
            "规则槽位": "tmz1",
            "输出文件名": "tmz (1).jpg",
            "下载结果": "已下载",
        },
        {
            "规则槽位": "yq3",
            "输出文件名": "1.梦幻粉60301/yq (3).png",
            "下载结果": "已下载",
        },
        {
            "规则槽位": "原始素材",
            "输出文件名": "1.梦幻粉60301/source.jpg",
            "下载结果": "已下载",
        },
    ]

    result = validator.create_visual_review_sheet(style_root, rows, target)

    assert result == target
    with Image.open(target) as image:
        assert image.size == (1100, 206)


def test_copy_final_artifacts_syncs_package_report_and_visual_evidence(tmp_path: Path):
    output_root = tmp_path / "run"
    attempt_root = output_root / "_attempts" / "204426146036" / "attempt-1"
    style_root = attempt_root / "204426146036"
    style_root.mkdir(parents=True)
    Image.new("RGB", (100, 100), "white").save(style_root / "tmz (1).jpg")
    (attempt_root / "report.xlsx").write_bytes(b"report")
    (attempt_root / "report_rows.json").write_text("[]", encoding="utf-8")
    (attempt_root / "logs.txt").write_text("log", encoding="utf-8")
    Image.new("RGB", (100, 100), "white").save(attempt_root / "visual-review.jpg")
    contact_sheet = attempt_root / "_shoe_analysis" / "204426146036" / "00317-all.jpg"
    contact_sheet.parent.mkdir(parents=True)
    Image.new("RGB", (100, 100), "white").save(contact_sheet)
    selection_evidence = (
        attempt_root
        / "_shoe_analysis"
        / "204426146036"
        / "00317-selection-evidence.json"
    )
    selection_evidence.write_text(
        json.dumps({"style_code": "204426146036"}, ensure_ascii=False),
        encoding="utf-8",
    )

    copied = validator.copy_final_artifacts(
        output_root=output_root,
        attempt_root=attempt_root,
        style="204426146036",
        style_root=style_root,
        contact_sheets=[contact_sheet],
        analysis_artifacts=validator.collect_analysis_artifacts(attempt_root),
    )

    final_style_root = output_root / "final" / "204426146036"
    evidence_root = output_root / "final" / "evidence" / "204426146036"
    assert Path(copied["final_style_root"]) == final_style_root
    assert (final_style_root / "tmz (1).jpg").is_file()
    assert (output_root / "final" / "204426146036-report.xlsx").is_file()
    assert (evidence_root / "report.xlsx").is_file()
    assert (evidence_root / "report_rows.json").is_file()
    assert (evidence_root / "logs.txt").is_file()
    assert (evidence_root / "visual-review.jpg").is_file()
    assert (
        evidence_root
        / "contact-sheets"
        / "_shoe_analysis"
        / "204426146036"
        / "00317-all.jpg"
    ).is_file()
    assert (
        evidence_root
        / "analysis-artifacts"
        / "_shoe_analysis"
        / "204426146036"
        / "00317-selection-evidence.json"
    ).is_file()
    assert copied["final_analysis_artifacts"]


def test_collect_contact_sheet_artifacts_ignores_non_contact_analysis_images(
    tmp_path: Path,
):
    attempt_root = tmp_path / "attempt"
    analysis_dir = attempt_root / "_shoe_analysis" / "204426146036"
    analysis_dir.mkdir(parents=True)
    for name in ("00317-label.jpg", "00317-preview.png", "00317-source.jpeg"):
        Image.new("RGB", (100, 100), "white").save(analysis_dir / name)

    assert validator.collect_contact_sheet_artifacts(attempt_root) == []

    expected_names = {
        "00317-1.jpg",
        "00317-all.jpg",
        "00317-global-1.jpg",
        "00317-overview.jpg",
    }
    for name in expected_names:
        Image.new("RGB", (100, 100), "white").save(analysis_dir / name)

    collected = {
        path.name
        for path in validator.collect_contact_sheet_artifacts(attempt_root)
    }

    assert collected == expected_names


def test_validator_preserves_and_collects_contact_sheet_artifacts(
    tmp_path: Path,
    monkeypatch,
):
    output_root = tmp_path / "run"
    preserve_values = []

    def fake_prepare(**kwargs):
        preserve_values.append(kwargs.get("preserve_analysis_artifacts"))
        attempt_root = Path(kwargs["output_root"])
        style_root = attempt_root / "204426146036"
        style_root.mkdir(parents=True)
        Image.new("RGB", (100, 100), "white").save(style_root / "tmz (1).jpg")
        contact_sheet = (
            attempt_root
            / "_shoe_analysis"
            / "204426146036"
            / "00317-all.jpg"
        )
        contact_sheet.parent.mkdir(parents=True)
        Image.new("RGB", (100, 100), "white").save(contact_sheet)
        (contact_sheet.parent / "00317-selection-evidence.json").write_text(
            json.dumps({"style_code": "204426146036"}, ensure_ascii=False),
            encoding="utf-8",
        )
        return (
            [
                {
                    "规则槽位": "tmz1",
                    "输出文件名": "tmz (1).jpg",
                    "下载结果": "已下载",
                }
            ],
            {"204426146036": style_root},
        )

    monkeypatch.setattr(validator.shoe, "prepare_shoe_packages", fake_prepare)
    monkeypatch.setattr(validator, "rows_from_xlsx", lambda _path: [])
    monkeypatch.setattr(validator, "prepared_rows", lambda *_args: [{"x": "y"}])
    monkeypatch.setattr(validator.shoe, "parse_shoe_category_rows", lambda _rows: {})
    monkeypatch.setattr(validator, "validate_style", lambda **_kwargs: ([], []))
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "validator",
            "204426146036",
            "--attempt",
            "1",
            "--output-root",
            str(output_root),
        ],
    )

    assert validator.main() == 0
    validation = json.loads(
        (
            output_root
            / "_attempts"
            / "204426146036"
            / "attempt-1"
            / "validation.json"
        ).read_text(encoding="utf-8")
    )
    assert preserve_values == [True]
    assert validation["issues"] == []
    assert validation["visual_review"].endswith("visual-review.jpg")
    assert len(validation["contact_sheets"]) == 1
    assert any(path.endswith("00317-selection-evidence.json") for path in validation["analysis_artifacts"])


def test_validator_fails_when_visual_or_contact_evidence_is_missing(
    tmp_path: Path,
    monkeypatch,
):
    output_root = tmp_path / "run"

    def fake_prepare(**kwargs):
        attempt_root = Path(kwargs["output_root"])
        style_root = attempt_root / "204426146036"
        style_root.mkdir(parents=True)
        return ([], {"204426146036": style_root})

    monkeypatch.setattr(validator.shoe, "prepare_shoe_packages", fake_prepare)
    monkeypatch.setattr(validator, "rows_from_xlsx", lambda _path: [])
    monkeypatch.setattr(validator, "prepared_rows", lambda *_args: [{"x": "y"}])
    monkeypatch.setattr(validator.shoe, "parse_shoe_category_rows", lambda _rows: {})
    monkeypatch.setattr(validator, "validate_style", lambda **_kwargs: ([], []))
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "validator",
            "204426146036",
            "--attempt",
            "1",
            "--output-root",
            str(output_root),
        ],
    )

    assert validator.main() == 2
    validation = json.loads(
        (
            output_root
            / "_attempts"
            / "204426146036"
            / "attempt-1"
            / "validation.json"
        ).read_text(encoding="utf-8")
    )
    assert "visual-review evidence missing" in validation["issues"]
    assert "contact sheet evidence missing" in validation["issues"]


def test_finalize_existing_copies_approved_attempt_without_rerunning_models(
    tmp_path: Path,
    monkeypatch,
):
    output_root = tmp_path / "run"
    attempt_root = output_root / "_attempts" / "204426146036" / "attempt-7"
    style_root = attempt_root / "204426146036"
    style_root.mkdir(parents=True)
    Image.new("RGB", (100, 100), "white").save(style_root / "tmz (1).jpg")
    (attempt_root / "report.xlsx").write_bytes(b"report")
    (attempt_root / "report_rows.json").write_text("[]", encoding="utf-8")
    (attempt_root / "logs.txt").write_text("log", encoding="utf-8")
    Image.new("RGB", (100, 100), "white").save(attempt_root / "visual-review.jpg")
    contact_sheet = attempt_root / "_shoe_analysis" / "204426146036" / "00317-all.jpg"
    contact_sheet.parent.mkdir(parents=True)
    Image.new("RGB", (100, 100), "white").save(contact_sheet)
    selection_evidence = (
        contact_sheet.parent / "00317-selection-evidence.json"
    )
    selection_evidence.write_text(
        json.dumps({"style_code": "204426146036"}, ensure_ascii=False),
        encoding="utf-8",
    )
    (attempt_root / "validation.json").write_text(
        json.dumps(
            {
                "style": "204426146036",
                "attempt": "7",
                "style_root": str(style_root),
                "report_xlsx": str(attempt_root / "report.xlsx"),
                "visual_review": str(attempt_root / "visual-review.jpg"),
                "contact_sheets": [str(contact_sheet)],
                "analysis_artifacts": [str(contact_sheet), str(selection_evidence)],
                "issues": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    def fail_prepare(**_kwargs):
        raise AssertionError("finalize-existing must not rerun packaging")

    monkeypatch.setattr(validator.shoe, "prepare_shoe_packages", fail_prepare)
    monkeypatch.setattr(validator, "validate_style", lambda **_kwargs: ([], []))
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "validator",
            "204426146036",
            "--attempt",
            "7",
            "--output-root",
            str(output_root),
            "--finalize-existing",
            "--visual-review-note",
            "人工逐图通过",
        ],
    )

    assert validator.main() == 0
    attempt_validation = json.loads(
        (attempt_root / "validation.json").read_text(encoding="utf-8")
    )
    evidence_root = output_root / "final" / "evidence" / "204426146036"
    final_validation = json.loads(
        (evidence_root / "validation.json").read_text(encoding="utf-8")
    )
    assert attempt_validation["visual_review_status"] == "approved"
    assert attempt_validation["visual_review_note"] == "人工逐图通过"
    assert final_validation["visual_review_status"] == "approved"
    assert (output_root / "final" / "204426146036" / "tmz (1).jpg").is_file()
    assert (evidence_root / "visual-review.jpg").is_file()
    assert (
        evidence_root
        / "contact-sheets"
        / "_shoe_analysis"
        / "204426146036"
        / "00317-all.jpg"
    ).is_file()
    assert (
        evidence_root
        / "analysis-artifacts"
        / "_shoe_analysis"
        / "204426146036"
        / "00317-selection-evidence.json"
    ).is_file()


def test_finalize_existing_reruns_current_local_validation_before_copy(
    tmp_path: Path,
    monkeypatch,
):
    output_root = tmp_path / "run"
    attempt_root = output_root / "_attempts" / "204426146036" / "attempt-7"
    style_root = attempt_root / "204426146036"
    style_root.mkdir(parents=True)
    (style_root / "placeholder.txt").write_text("current package", encoding="utf-8")
    (attempt_root / "report.xlsx").write_bytes(b"report")
    report_rows = [{"规则槽位": "tmz1", "输出文件名": "tmz (1).jpg"}]
    (attempt_root / "report_rows.json").write_text(
        json.dumps(report_rows, ensure_ascii=False),
        encoding="utf-8",
    )
    (attempt_root / "logs.txt").write_text("log", encoding="utf-8")
    Image.new("RGB", (100, 100), "white").save(attempt_root / "visual-review.jpg")
    contact_sheet = attempt_root / "_shoe_analysis" / "204426146036" / "00317-all.jpg"
    contact_sheet.parent.mkdir(parents=True)
    Image.new("RGB", (100, 100), "white").save(contact_sheet)
    (attempt_root / "validation.json").write_text(
        json.dumps(
            {
                "style": "204426146036",
                "attempt": "7",
                "style_root": str(style_root),
                "report_xlsx": str(attempt_root / "report.xlsx"),
                "visual_review": str(attempt_root / "visual-review.jpg"),
                "contact_sheets": [str(contact_sheet)],
                "issues": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    seen = {}

    def fake_validate_style(**kwargs):
        seen.update(kwargs)
        return ["current validation failed"], []

    monkeypatch.setattr(validator, "validate_style", fake_validate_style)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "validator",
            "204426146036",
            "--attempt",
            "7",
            "--output-root",
            str(output_root),
            "--finalize-existing",
        ],
    )

    assert validator.main() == 2
    assert seen["report_rows"] == report_rows
    failed = json.loads((attempt_root / "validation.json").read_text(encoding="utf-8"))
    assert "current validation failed" in failed["issues"]
    assert not (output_root / "final").exists()


def test_finalize_existing_fails_closed_when_existing_attempt_has_issues(
    tmp_path: Path,
    monkeypatch,
):
    output_root = tmp_path / "run"
    attempt_root = output_root / "_attempts" / "204426146036" / "attempt-7"
    style_root = attempt_root / "204426146036"
    style_root.mkdir(parents=True)
    (attempt_root / "report.xlsx").write_bytes(b"report")
    Image.new("RGB", (100, 100), "white").save(attempt_root / "visual-review.jpg")
    contact_sheet = attempt_root / "_shoe_analysis" / "204426146036" / "00317-all.jpg"
    contact_sheet.parent.mkdir(parents=True)
    Image.new("RGB", (100, 100), "white").save(contact_sheet)
    (attempt_root / "validation.json").write_text(
        json.dumps(
            {
                "style_root": str(style_root),
                "report_xlsx": str(attempt_root / "report.xlsx"),
                "visual_review": str(attempt_root / "visual-review.jpg"),
                "contact_sheets": [str(contact_sheet)],
                "issues": ["pose mismatch"],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "validator",
            "204426146036",
            "--attempt",
            "7",
            "--output-root",
            str(output_root),
            "--finalize-existing",
        ],
    )

    assert validator.main() == 2
    assert not (output_root / "final").exists()
