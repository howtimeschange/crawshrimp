import pytest
from core.shenhui_shoe_template_match import visual_fact_failures


def facts(**changes):
    return dict(background_kind='plain_gray', independent_cards=False,
                toe=[.7,.2], heel=[.7,.8], near_end='neither',
                heel_back_visible=False, view='side', **{}) | changes


def test_vertical_axis_uses_foot_not_boot_height():
    assert visual_fact_failures('tmz3', facts(), (1000, 1000)) == []
    assert '鞋头鞋跟轴线方向不符' in visual_fact_failures(
        'tmz3', facts(toe=[.2,.7], heel=[.8,.7]), (1000,1000))


def test_coordinates_respect_actual_image_aspect_ratio():
    assert '鞋头鞋跟轴线方向不符' in visual_fact_failures(
        'tmz3', facts(toe=[.2,.2], heel=[.6,.8]), (2000,500))


@pytest.mark.parametrize('points', [None, [True, .5], [float('nan'), .5], [1.2,.5], [.5]])
def test_invalid_measurements_do_not_pass(points):
    assert visual_fact_failures('tmz3', facts(toe=points), (1000,1000))


def test_rear_requires_observable_depth_not_side_vote():
    assert visual_fact_failures('tmz4', facts(), (1000,1000), '休闲')
    rear = facts(near_end='heel', heel_back_visible=True, view='rear_oblique')
    assert visual_fact_failures('tmz4', rear, (1000,1000), '休闲') == []
    assert visual_fact_failures('tmz4', rear | {'near_end':'toe'}, (1000,1000), '休闲')
    assert visual_fact_failures('tmz4', rear | {'heel_back_visible':False}, (1000,1000), '休闲')


def test_snow_keeps_separate_template_contract():
    assert visual_fact_failures('tmz4', facts(view='top',lining_visible=True,upper_side_visible=True), (1000,1000), '雪地') == []


def test_background_and_pose_are_independent_failures():
    errors = visual_fact_failures('tmz4', facts(background_kind='studio_gradient'), (1000,1000))
    assert len(errors) == 2
    assert visual_fact_failures('tmz5', facts(background_kind='unclear'), (1000,1000))


def test_function_cards_cannot_be_consumed_by_plain_side_slot():
    side = facts(toe=[.2,.7], heel=[.8,.7])
    assert visual_fact_failures('yq3', side, (1000,1000)) == []
    assert visual_fact_failures('yq3', side | {'independent_cards':True}, (1000,1000))
    assert visual_fact_failures('yx', side | {'independent_cards':True}, (1000,1000)) == []
    assert visual_fact_failures('yx', side, (1000,1000))


def test_no_observations_fail_closed():
    assert visual_fact_failures('tmz1', None, (1000,1000))


def test_measured_background_gradient_overrules_model_plain_vote(tmp_path):
    from PIL import Image
    from core.shenhui_shoe_template_match import background_perimeter_evidence
    path = tmp_path / 'gradient.png'
    image = Image.new('RGB', (100,100))
    for y in range(100):
        for x in range(100):
            v = 190 + round(x * .4)
            image.putpixel((x,y),(v,v,v))
    image.save(path)
    measured = background_perimeter_evidence(path)
    assert visual_fact_failures('tmz5', facts(), (100,100), perimeter=measured)
    Image.new('RGB',(100,100),(242,242,242)).save(path)
    assert visual_fact_failures('tmz5', facts(), (100,100),
                                perimeter=background_perimeter_evidence(path)) == []


def test_upright_side_allows_small_rear_perspective_but_not_front_or_top():
    assert visual_fact_failures('tmz3', facts(view='rear_oblique'), (1000,1000)) == []
    for view in ('front','front_oblique','top','bottom','rear','unclear'):
        assert visual_fact_failures('tmz3', facts(view=view), (1000,1000))


def test_tinted_studio_gradient_is_not_exempt_from_measurement():
    measured = {"luminance_p05":200, "luminance_p95":229.67, "neutral_fraction":.566}
    assert any('背景边缘' in error for error in visual_fact_failures(
        'tmz5', facts(), (1000,1000), perimeter=measured))


def test_sports_rear_needs_tread_and_upper_not_just_sidewall():
    rear = facts(near_end='heel', heel_back_visible=True, view='rear_oblique',
                 upper_side_visible=True, outsole_tread_visible=True)
    assert not visual_fact_failures('tmz4', rear, (1000,1000), '运动')
    assert visual_fact_failures('tmz4', rear | {'outsole_tread_visible':False}, (1000,1000), '运动')
    assert visual_fact_failures('tmz4', rear | {'upper_side_visible':False,'view':'bottom'}, (1000,1000), '运动')
    assert visual_fact_failures('tmz4', facts(), (1000,1000), '雪地')
