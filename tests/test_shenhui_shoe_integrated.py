import threading
from types import SimpleNamespace
from unittest.mock import patch
import pytest
from PIL import Image
from core import shenhui_shoe_packaging as s, shenhui_shoe_sequential as q


def test_label_readers_overlap_and_preserve_independent_votes(tmp_path):
    barrier = threading.Barrier(2)

    def request(**kw):
        barrier.wait(timeout=3)
        assert kw["image_inputs"] == [str(tmp_path / "crop.jpg")]
        return dict(
            style_code="204426146118",
            color_code="00319",
            product_name="婴童稳步鞋",
            color_name="白黑色调00319",
        ), SimpleNamespace(model_id=kw["model_id"])

    with patch.object(
        s, "_create_focused_label_preview", return_value=tmp_path / "crop.jpg"
    ), patch.object(s.llm_gateway, "generate_multimodal_json", side_effect=request):
        out = s._verify_label_identity_from_crop(
            {},
            source=tmp_path / "source.jpg",
            target=tmp_path / "crop.jpg",
            style_code="204426146118",
            color_code="00319",
            model_ids=["deepseek-official-flash", "gpt-5.6-sol"],
            config=None,
            log=lambda _: None,
        )
    assert len(out["_label_identity_votes"]) == 2
    assert out["_label_category"] == "婴童"


def test_wpt_impossible_bound_retains_readable_image_and_reports_manual_processing(
    tmp_path,
):
    src = tmp_path / "input.png"
    target = tmp_path / "output.png"
    Image.new("RGBA", (800, 800), (10, 20, 30, 0)).save(src)
    assert s._save_wpt_original_png(src, target, max_bytes=1) == target
    assert target.exists() and src.exists()
    with Image.open(target) as result:
        assert result.size == (800, 800)
        assert result.convert("RGBA").getchannel("A").getextrema() == (0, 0)
    with patch.object(s, "SHOE_WPT_MAX_BYTES", 1):
        report = s._wpt_size_report(target)
    assert "需人工处理" in report["规则告警"]
    assert "图片已保留" in report["规则告警"]
    assert str(target.stat().st_size) in report["备注"]


@pytest.mark.parametrize(
    "size,warning", [(599999, False), (600000, True), (600001, True)]
)
def test_wpt_result_table_size_boundary(tmp_path, size, warning):
    target = tmp_path / "output.png"
    target.write_bytes(b"x" * size)
    report = s._wpt_size_report(target)
    assert bool(report["规则告警"]) is warning
    assert str(size) in report["备注"]


def test_wpt_noise_keeps_quality_and_reports_unattainable_size(tmp_path, monkeypatch):
    """With scaling disabled the product keeps quality and asks for a human."""
    import random

    monkeypatch.setattr(s, 'SHOE_WPT_ALLOW_SCALE', False)
    src = tmp_path / "input.png"
    target = tmp_path / "output.png"
    im = Image.frombytes(
        "RGB", (700, 700), random.Random(42).randbytes(700 * 700 * 3)
    ).convert("RGBA")
    im.putpixel((0, 0), (0, 0, 0, 0))
    im.save(src)
    assert src.stat().st_size > 600000
    s._save_wpt_original_png(src, target)
    assert target.stat().st_size >= 600000
    assert '人工处理' in s._wpt_size_report(target)['规则告警']
    with Image.open(target) as result:
        assert result.size == (700, 700)
        assert result.convert("RGBA").getchannel("A").getextrema() == (0, 255)


def test_wpt_scale_policy_fits_the_byte_cap_and_records_the_trade(tmp_path):
    """业务口径（2026-09-16）允许缩放换取 <600KB；缩放与画质要写进备注。"""
    import random

    src = tmp_path / "input.png"
    target = tmp_path / "output.png"
    im = Image.frombytes("RGB", (900, 900), random.Random(7).randbytes(900 * 900 * 3)).convert("RGBA")
    im.putpixel((0, 0), (0, 0, 0, 0))
    im.save(src)
    assert s.SHOE_WPT_ALLOW_SCALE is True
    s._save_wpt_original_png(src, target)
    note = s._wpt_size_report(target)['备注']
    with Image.open(target) as result:
        # 产品校验口径：必须有「有效」alpha（不是全不透明，也不是全透明）。
        alpha_min, alpha_max = result.convert("RGBA").getchannel("A").getextrema()
        assert alpha_min != 255 and alpha_max != 0
        if target.stat().st_size < s.SHOE_WPT_MAX_BYTES:
            assert result.size[0] <= 900 and result.size[1] <= 900
            assert '线性缩放' in note or '调色板' in note


def test_default_production_dispatches_to_sequential():
    assert s.SHOE_POSE_DEFAULT_STRATEGY == q.STRATEGY
    with patch.object(q, "analyze", return_value={"reached": True}) as call:
        assert s._default_analyze_color(pose_strategy=s.SHOE_POSE_DEFAULT_STRATEGY) == {
            "reached": True
        }
    call.assert_called_once()


def test_final_review_reads_post_rule_names_not_stale_proposals(tmp_path):
    ctx = {
        "style": "S",
        "color": "C",
        "category": "婴童",
        "root": str(tmp_path),
        "proposal": {"selected": {"tmz1": "old.jpg"}},
    }
    slots = {
        "_sequential_context": ctx,
        "tmz1": "gray.jpg",
        "tmz5": "standard.jpg",
        "wpz": ["gray.jpg", "", "", "", "gray-standard.jpg", "box.jpg"],
        "yq": ["pair.jpg", "sole.jpg", "outer.jpg"],
        "yx": "card.jpg",
    }

    def review(c, result):
        assert result["selected"]["tmz1"] == "gray.jpg"
        return {
            **result,
            "verified": True,
            "audits": [{"approved": list(q.ORDER), "rejected": {}}],
        }

    with patch.object(q, "run_verified", side_effect=review):
        out = q.verify_packaged_selection(slots)
    assert out["wpz"][5] == "box.jpg" and out["tms"] == "standard.jpg"


def test_sequential_report_uses_actual_source_and_actual_review():
    from artifacts.shenhui_shoe_rerun_validator import validate_semantic_rows

    checks = {k: True for k in q.contract("tmz1", "婴童")}
    selection = {
        "shoe_category": "婴童",
        "_sequential_context": {"category": "婴童", "ids": {"I1": "gray.jpg"}},
        "_sequential_audits": [
            {
                "model": "gpt-6-astra",
                "approved": ["tmz1"],
                "response": {
                    "reviews": [
                        {
                            "slot": "tmz1",
                            "candidate_id": "I1",
                            "accepted": True,
                            "checks": checks,
                            "evidence": "两只完整鞋并列落地",
                        }
                    ]
                },
            }
        ],
    }
    row = {
        "规则槽位": "wpz1",
        "原文件名": "gray.jpg",
        "下载结果": "已下载",
        **s._semantic_report_fields(selection, slot="wpz1", source_name="gray.jpg"),
    }
    assert "模型共识" not in row
    assert validate_semantic_rows([row], category="婴童", require_evidence=True) == []
    row["原文件名"] = "wrong.jpg"
    assert validate_semantic_rows([row], category="婴童", require_evidence=True)
    rejected = s._semantic_report_fields(
        selection, slot="wpz1", source_name="wrong.jpg"
    )
    assert "false" in rejected["逐坑位复核"]


def test_two_incomplete_crop_readers_skip_third_model(tmp_path):
    models = []

    def request(**kw):
        models.append(kw["model_id"])
        return {
            "style_code": "",
            "color_code": "00319",
            "product_name": "婴童稳步鞋",
            "color_name": "白黑色调",
            "label_complete": False,
        }, SimpleNamespace(model_id=kw["model_id"])

    with patch.object(
        s, "_create_focused_label_preview", return_value=tmp_path / "crop.jpg"
    ), patch.object(s.llm_gateway, "generate_multimodal_json", side_effect=request):
        with pytest.raises(s.ShoeLabelCropError):
            s._verify_label_identity_from_crop(
                {},
                source=tmp_path / "source.jpg",
                target=tmp_path / "crop.jpg",
                style_code="204426146118",
                color_code="00319",
                model_ids=["deepseek-official-flash", "gpt-5.6-sol", "gpt-6-astra"],
                config=None,
                log=lambda _: None,
            )
    assert set(models) == {"deepseek-official-flash", "gpt-5.6-sol"}


def test_batch_parallelism_is_bounded_and_keeps_order_and_failures_isolated(tmp_path):
    from pathlib import Path

    barrier = threading.Barrier(2)
    lock = threading.Lock()
    active = 0
    peak = 0
    calls = 0
    styles = ["204426146118", "204426146037", "204426141117"]
    events = []

    def prepare(**kw):
        nonlocal active, peak, calls
        style = kw["data_rows"][0]["输入款号"]
        with lock:
            active += 1
            peak = max(peak, active)
            calls += 1
            index = calls
        try:
            if index <= 2:
                barrier.wait(timeout=3)
            if style == styles[1]:
                raise s.ShoeSelectionError(style + " test rejected pose")
            kw["progress"]({"organize_completed": 1, "organize_active": False})
            return [{"输入款号": style}], {style: Path(tmp_path) / style}
        finally:
            with lock:
                active -= 1

    with patch.object(s, "prepare_shoe_packages", side_effect=prepare):
        rows, packages = s.prepare_shoe_packages_skip_failed_styles(
            data_rows=[{"输入款号": style} for style in styles],
            output_root=tmp_path,
            pose_strategy="sequential_templates",
            progress=events.append,
            log=lambda _: None,
        )
    assert peak == 2
    assert [r["输入款号"] for r in rows] == styles
    assert set(packages) == {styles[0], styles[2]}
    assert "test rejected pose" in str(rows[1])
    assert [e["organize_completed"] for e in events] == sorted(
        e["organize_completed"] for e in events
    )
    assert events[-1]["organize_completed"] == 3


@pytest.mark.parametrize('requested_workers', [8, 99])
def test_explicit_style_workers_clamp_at_eight_and_log_actual_limit(tmp_path, requested_workers):
    barrier = threading.Barrier(8)
    lock = threading.Lock()
    active = peak = calls = 0
    logs = []
    styles = [str(100000000000 + i) for i in range(10)]

    def prepare(**kwargs):
        nonlocal active, peak, calls
        style = kwargs['data_rows'][0]['输入款号']
        with lock:
            active += 1
            peak = max(peak, active)
            calls += 1
            index = calls
        try:
            if index <= 8:
                barrier.wait(timeout=3)
            return [{'输入款号':style}], {style:tmp_path/style}
        finally:
            with lock:
                active -= 1

    with patch.object(s, 'prepare_shoe_packages', side_effect=prepare):
        rows, packages = s.prepare_shoe_packages_skip_failed_styles(
            data_rows=[{'输入款号':style} for style in styles], output_root=tmp_path,
            pose_strategy='sequential_templates', style_workers=requested_workers, log=logs.append)
    assert peak == 8
    assert [r['输入款号'] for r in rows] == styles
    assert set(packages) == set(styles)
    assert any('并行 8 款' in message for message in logs)
