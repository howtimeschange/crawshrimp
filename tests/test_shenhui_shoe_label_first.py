import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from PIL import Image
from core import shenhui_shoe_packaging as shoe


def test_printed_name_mapping_is_conservative():
    assert shoe._category_from_label_product_name("婴童稳步鞋") == "婴童"
    assert shoe._category_from_label_product_name("儿童板鞋") == "运动"
    assert shoe._category_from_label_product_name("儿童雪地靴") == "雪地"
    assert shoe._category_from_label_product_name("儿童鞋") == ""


@pytest.mark.parametrize("color_value", ["梦幻粉60301", "梦幻粉"])
def test_crop_votes_correct_wrong_nonempty_product_and_color(tmp_path, color_value):
    calls = []
    payload = dict(
        product_name="婴童凉拖鞋", color_name="粉色60301", label_bbox=[0, 0, 1000, 1000]
    )

    def generate(**kwargs):
        calls.append(kwargs["model_id"])
        assert "婴童凉拖鞋" not in kwargs["user_prompt"]
        return dict(
            style_code="204426146037",
            color_code="60301",
            product_name="婴童稳步鞋",
            color_name=color_value,
        ), SimpleNamespace(model_id=kwargs["model_id"])

    with patch.object(
        shoe, "_create_focused_label_preview", return_value=tmp_path / "crop.jpg"
    ), patch.object(shoe.llm_gateway, "generate_multimodal_json", side_effect=generate):
        result = shoe._verify_label_identity_from_crop(
            payload,
            source=tmp_path / "original.jpg",
            target=tmp_path / "crop.jpg",
            style_code="204426146037",
            color_code="60301",
            model_ids=["gpt-5.6-sol", "gpt-5.6-terra", "deepseek-official-flash"],
            config=None,
            log=lambda _: None,
        )
    assert calls == ["gpt-5.6-sol", "deepseek-official-flash"]
    assert result["product_name"] == "婴童稳步鞋"
    assert result["color_name"] == "梦幻粉60301"
    assert result["_label_category"] == "婴童"
    assert payload["product_name"] == "婴童凉拖鞋"


@pytest.mark.parametrize("mode", ["same_family", "wrong_style", "disagreement"])
def test_crop_does_not_accept_unverified_identity(tmp_path, mode):
    def generate(**kwargs):
        other = kwargs["model_id"].startswith("deepseek")
        return dict(
            style_code="000000000000" if mode == "wrong_style" else "204426146037",
            color_code="60301",
            product_name=(
                "婴童稳步鞋" if not other or mode != "disagreement" else "婴童凉拖鞋"
            ),
            color_name="梦幻粉60301",
        ), SimpleNamespace(model_id=kwargs["model_id"])

    models = (
        ["gpt-5.6-sol", "gpt-5.6-terra"]
        if mode == "same_family"
        else ["gpt-5.6-sol", "deepseek-official-flash"]
    )
    with patch.object(
        shoe, "_create_focused_label_preview", return_value=tmp_path / "crop.jpg"
    ), patch.object(
        shoe.llm_gateway, "generate_multimodal_json", side_effect=generate
    ), pytest.raises(
        shoe.ShoeSelectionError, match="独立模型家族"
    ):
        shoe._verify_label_identity_from_crop(
            {},
            source=tmp_path / "original.jpg",
            target=tmp_path / "crop.jpg",
            style_code="204426146037",
            color_code="60301",
            model_ids=models,
            config=None,
            log=lambda _: None,
        )


@pytest.mark.parametrize(
    "configured,expected", [({}, "婴童"), ({"204426146037": "雪地"}, "雪地")]
)
def test_label_is_confirmed_before_pose_and_excel_has_priority(
    tmp_path, configured, expected
):
    image = tmp_path / "source.jpg"
    Image.new("RGB", (80, 80), "white").save(image)
    rows = [
        {
            "输入款号": "204426146037",
            "颜色": "60301",
            "__shoe_color_code": "60301",
            "原文件名": "GUDO001.jpg",
            "本地文件": str(image),
            "下载结果": "已下载",
        }
    ]
    order = []

    class Captured(Exception):
        pass

    def label(**kwargs):
        order.append("label")
        return {
            "filename": "GUDO001.jpg",
            "payload": {"product_name": "婴童稳步鞋", "_label_category": "婴童"},
            "tmq_path": str(tmp_path / "circle.jpg"),
        }

    def pose(**kwargs):
        order.append("pose")
        assert kwargs["shoe_category"] == expected
        assert (
            kwargs["main_pose_reference_images"]
            == kwargs["main_pose_references_by_category"][expected]
        )
        raise Captured()

    with patch.object(
        shoe, "_prepare_label_before_pose", side_effect=label
    ), patch.object(shoe, "_default_analyze_color", side_effect=pose), pytest.raises(
        Captured
    ):
        shoe.prepare_shoe_packages(
            data_rows=rows,
            output_root=tmp_path / "out",
            shoe_categories=configured,
            preserve_analysis_artifacts=True,
        )
    assert order == ["label", "pose"]


def test_excel_can_mix_explicit_and_label_inferred_categories():
    assert shoe.parse_shoe_category_rows(
        [
            {"款号": "204426146037", "品类": ""},
            {"款号": "204426141029", "品类": "运动"},
        ]
    ) == {"204426141029": "运动"}
    assert shoe.parse_shoe_category_rows([{"款号": "204426146037", "品类": ""}]) == {}
    with pytest.raises(shoe.ShoeSelectionError, match="缺少"):
        shoe.parse_shoe_category_rows([{"款号": "", "品类": "运动"}])


def test_unreadable_crop_requests_repair_before_exhausting_same_family(tmp_path):
    calls = []

    def generate(**kwargs):
        calls.append(kwargs["model_id"])
        return {
            "style_code": "204426146037",
            "color_code": "60301",
            "product_name": "",
            "color_name": "",
        }, SimpleNamespace(model_id=kwargs["model_id"])

    with patch.object(
        shoe, "_create_focused_label_preview", return_value=tmp_path / "crop.jpg"
    ), patch.object(
        shoe.llm_gateway, "generate_multimodal_json", side_effect=generate
    ), pytest.raises(
        shoe.ShoeLabelCropError, match="修复标签裁切范围"
    ):
        shoe._verify_label_identity_from_crop(
            {},
            source=tmp_path / "original.jpg",
            target=tmp_path / "crop.jpg",
            style_code="204426146037",
            color_code="60301",
            model_ids=["gpt-5.6-sol", "gpt-5.6-terra", "deepseek-official-flash"],
            config=None,
            log=lambda _: None,
        )
    assert calls == ["gpt-5.6-sol", "deepseek-official-flash"]


def test_category_inference_cannot_rewrite_verified_product_name(tmp_path):
    payload = {"product_name": "儿童时尚生活鞋"}
    calls = []

    def generate(**kwargs):
        calls.append(kwargs["model_id"])
        return {
            "shoe_category": "休闲",
            "product_name": "错误改写",
            "evidence": "普通皮靴",
        }, SimpleNamespace(model_id=kwargs["model_id"])

    with patch.object(
        shoe.llm_gateway, "generate_multimodal_json", side_effect=generate
    ):
        category = shoe._infer_category_from_verified_label(
            payload,
            crop=tmp_path / "crop.jpg",
            model_ids=["gpt-5.6-sol", "gpt-5.6-terra", "deepseek-official-flash"],
            config=None,
            style_code="204426141027",
            color_code="10301",
            log=lambda _: None,
        )
    assert category == "休闲"
    assert payload["product_name"] == "儿童时尚生活鞋"
    assert calls == ["gpt-5.6-sol"]


def test_specific_product_name_needs_no_extra_category_request(tmp_path):
    with patch.object(shoe.llm_gateway, "generate_multimodal_json") as request:
        assert (
            shoe._infer_category_from_verified_label(
                {"product_name": "儿童板鞋"},
                crop=tmp_path / "crop.jpg",
                model_ids=["gpt-5.6-sol"],
                config=None,
                style_code="204426141029",
                color_code="00316",
                log=lambda _: None,
            )
            == "运动"
        )
    request.assert_not_called()


def test_slice_prompt_does_not_point_yq_at_the_fourth_image():
    prompt = shoe._shoe_selection_prompt(
        "204426141029",
        "00316",
        {"I01": "shoe.jpg"},
        "运动",
        main_pose_reference_count=5,
        overview_sheet_count=1,
        candidate_scope="batch_overview",
    )
    assert "第9张图是 yq 三姿势参考模板" in prompt
    assert "按第四张参考模板" not in prompt
    assert "本款已核验品类为“运动”" in prompt


@pytest.mark.parametrize("complete", [True, False])
def test_absent_product_name_requires_two_independent_complete_label_observations(
    tmp_path, complete
):
    def generate(**kwargs):
        return {
            "style_code": "204426140052",
            "color_code": "60001",
            "color_name": "粉红60001",
            "product_name": "",
            "product_name_present": False,
            "label_complete": complete,
        }, SimpleNamespace(model_id=kwargs["model_id"])

    with patch.object(
        shoe, "_create_focused_label_preview", return_value=tmp_path / "crop.jpg"
    ), patch.object(shoe.llm_gateway, "generate_multimodal_json", side_effect=generate):
        args = dict(
            source=tmp_path / "source.jpg",
            target=tmp_path / "crop.jpg",
            style_code="204426140052",
            color_code="60001",
            model_ids=["gpt-5.6-sol", "deepseek-official-flash"],
            config=None,
            log=lambda _: None,
        )
        if not complete:
            with pytest.raises(shoe.ShoeLabelCropError):
                shoe._verify_label_identity_from_crop({}, **args)
        else:
            result = shoe._verify_label_identity_from_crop({}, **args)
            assert result["product_name"] == ""
            assert result["_label_product_name_absent"] is True
            assert result["_product_name_source"] == "标签未印刷"


def test_disagreement_retries_once_with_image_details_and_still_requires_two_families(
    tmp_path,
):
    crop = tmp_path / "crop.jpg"
    Image.new("RGB", (800, 500), "white").save(crop)
    calls = []

    def generate(**kwargs):
        detailed = len(kwargs["image_inputs"]) == 5
        calls.append((kwargs["model_id"], detailed))
        color = (
            "花黑色调"
            if detailed or kwargs["model_id"] == "deepseek-official-flash"
            else "花栗色调"
        )
        return dict(
            style_code="204426140135",
            color_code="00309",
            product_name="儿童户外鞋",
            color_name=color,
        ), SimpleNamespace(model_id=kwargs["model_id"])

    with patch.object(
        shoe, "_create_focused_label_preview", return_value=crop
    ), patch.object(shoe.llm_gateway, "generate_multimodal_json", side_effect=generate):
        result = shoe._verify_label_identity_from_crop(
            {},
            source=crop,
            target=crop,
            style_code="204426140135",
            color_code="00309",
            model_ids=["deepseek-official-flash", "gpt-5.6-sol"],
            config=None,
            log=lambda _: None,
        )
    assert result["color_name"] == "花黑色调00309"
    assert result["_label_detail_retry"] is True
    assert len(result["_label_identity_votes"]) == 2
    assert len(calls) == 4


def test_category_missing_evidence_uses_fallback(tmp_path):
    calls = []

    def generate(**kwargs):
        calls.append(kwargs["model_id"])
        return dict(
            shoe_category="休闲", evidence="皮质高帮及侧拉链" if len(calls) > 1 else ""
        ), SimpleNamespace(model_id=kwargs["model_id"])

    with patch.object(
        shoe.llm_gateway, "generate_multimodal_json", side_effect=generate
    ):
        assert (
            shoe._infer_category_from_verified_label(
                {"product_name": "儿童时尚生活鞋"},
                crop=tmp_path / "label.jpg",
                model_ids=["deepseek-official-flash", "gpt-6-astra"],
                config=None,
                style_code="S",
                color_code="C",
                log=lambda _: None,
            )
            == "休闲"
        )
    assert calls == ["deepseek-official-flash", "gpt-6-astra"]


def test_label_crop_includes_separately_located_code_before_ocr(tmp_path):
    source = tmp_path / "box.jpg"
    Image.new("RGB", (800, 800), "white").save(source)
    route = SimpleNamespace(model_id="deepseek-flash")
    captured = []

    def verify(payload, **kwargs):
        captured.append(payload["label_bbox"])
        return {
            **payload,
            "product_name": "儿童板鞋",
            "color_name": "白色00301",
            "_label_category": "运动",
        }

    with patch.object(
        shoe, "_create_contact_sheets", return_value=([source], {"I01": "box.jpg"})
    ), patch.object(
        shoe.llm_gateway,
        "generate_multimodal_json",
        side_effect=[
            ({"candidate_ids": ["I01"]}, route),
            (
                {
                    "label_bbox": [100, 400, 900, 900],
                    "style_code_bbox": [150, 100, 800, 200],
                },
                route,
            ),
        ],
    ), patch.object(
        shoe, "_verify_label_identity_from_crop", side_effect=verify
    ), patch.object(
        shoe, "_create_tmq_asset", return_value=tmp_path / "circled.jpg"
    ):
        shoe._prepare_label_before_pose(
            entries=[{"filename": "box.jpg", "path": source}],
            analysis_root=tmp_path,
            style_code="204426141029",
            color_code="00301",
            model_id="deepseek-official-flash",
            label_model_id="",
            fallback_model_ids=[],
            label_fallback_model_ids=[],
            config=None,
            log=lambda _: None,
        )
    assert captured == [[100, 100, 900, 900]]

@pytest.mark.parametrize('disagree', [False, True])
def test_official_only_ocr_uses_distinct_views_and_rejects_disagreement(tmp_path, disagree):
    crop = tmp_path / 'crop.jpg'
    Image.new('RGB', (300, 240), 'white').save(crop)
    calls = []
    def generate(**kw):
        calls.append(kw)
        assert kw['model_id'] == 'deepseek-official-flash'
        assert kw['fallback_model_ids'] == []
        return dict(style_code='204426146037', color_code='60301',
                    product_name='婴童稳步鞋',
                    color_name='粉色60301' if disagree and len(kw['image_inputs']) > 1 else '梦幻粉60301',
                    label_complete=True), SimpleNamespace(model_id='deepseek-flash')
    with patch.object(shoe, '_create_focused_label_preview', return_value=crop), patch.object(shoe.llm_gateway, 'generate_multimodal_json', side_effect=generate):
        kwargs = dict(source=crop, target=crop, style_code='204426146037', color_code='60301', model_ids=['deepseek-official-flash'], config=None, log=lambda _: None)
        if disagree:
            with pytest.raises(shoe.ShoeSelectionError, match='裁片同票'):
                shoe._verify_label_identity_from_crop({}, **kwargs)
        else:
            result = shoe._verify_label_identity_from_crop({}, **kwargs)
            assert shoe._label_votes_agree(result['_label_identity_votes'])
            assert {v['view'] for v in result['_label_identity_votes']} == {'full', 'details'}
    assert sorted(len(c['image_inputs']) for c in calls) == [1, 2]


def test_partial_style_code_triggers_crop_repair_not_identity_guess(tmp_path):
    crop=tmp_path/'crop.jpg';Image.new('RGB',(300,240),'white').save(crop)
    def generate(**kw):
        return dict(style_code='204426',color_code='00355',product_name='儿童时尚生活鞋',color_name='咖色调00355',label_complete=True),SimpleNamespace(model_id='deepseek-flash')
    with patch.object(shoe,'_create_focused_label_preview',return_value=crop),patch.object(shoe.llm_gateway,'generate_multimodal_json',side_effect=generate),pytest.raises(shoe.ShoeLabelCropError):
        shoe._verify_label_identity_from_crop({},source=crop,target=crop,style_code='204426141013',color_code='00355',model_ids=['deepseek-official-flash'],config=None,log=lambda _:None)


def test_paper_refinement_preserves_code_and_ignores_external_white_background(tmp_path):
    from PIL import Image, ImageDraw
    source = tmp_path / 'box.jpg'
    image = Image.new('RGB', (500, 400), 'white')
    draw = ImageDraw.Draw(image)
    draw.rectangle((50, 70, 450, 330), fill=(155, 110, 65))
    draw.rectangle((220, 100, 410, 250), fill=(235, 235, 235))
    image.save(source)
    result = shoe._refine_label_paper_bbox(source, [0, 0, 1000, 1000], [500, 280, 720, 320])
    assert result is not None
    x1, y1, x2, y2 = result
    assert x1 < 500 < 720 < x2 and y1 < 280 < 320 < y2
    assert 400 < x1 < 460 and 800 < x2 < 850
    assert y2 < 700


def test_paper_refinement_never_uses_edge_connected_background_as_label(tmp_path):
    from PIL import Image
    source = tmp_path / 'plain.jpg'
    Image.new('RGB', (500, 400), 'white').save(source)
    assert shoe._refine_label_paper_bbox(source, [0, 0, 1000, 1000], [500, 280, 720, 320]) is None
    assert shoe._refine_label_paper_bbox(source, [], []) is None
