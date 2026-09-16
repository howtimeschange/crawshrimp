"""Regressions found in the real eight-style baseline."""
from pathlib import Path
from types import SimpleNamespace

from PIL import Image, ImageDraw
import pytest

from core import shenhui_shoe_models as models, shenhui_shoe_fast as fast
from core import shenhui_shoe_packaging as shoe


def test_impossible_png_budget_keeps_color_detail_and_dimensions(tmp_path):
    from PIL import ImageChops, ImageStat
    source = tmp_path / 'gradient.png'
    target = tmp_path / 'compressed.png'
    image = Image.new('RGBA', (96, 96))
    image.putdata([(x*2,y*2,(x+y)%256,255) for y in range(96) for x in range(96)])
    image.save(source)
    shoe._save_wpt_original_png(source,target,max_bytes=32)
    with Image.open(target) as output:
        assert output.size == image.size
        difference = ImageChops.difference(image.convert('RGB'),output.convert('RGB'))
        assert max(ImageStat.Stat(difference).rms) <= 6
    assert target.stat().st_size > 32


def route(model):
    return SimpleNamespace(model_id=model, base_url='https://' + model + '.test/v1')


def test_one_silent_stream_does_not_redirect_next_style(monkeypatch):
    calls = []
    state = models.ShoeModelState()
    monkeypatch.setattr(models.gateway, 'route_for_model', lambda model, config=None: route(model))
    def request(**kw):
        calls.append(kw['model_id'])
        if len(calls) == 1:
            raise models.gateway.LlmGatewayError('流式模型超时：连续90秒没有有效思考或答案片段')
        return {}, route(kw['model_id'])
    monkeypatch.setattr(models.gateway, 'generate_multimodal_json', request)
    models.generate_json(models=['official', 'backup'], state=state)
    models.generate_json(models=['official', 'backup'], state=state)
    assert calls == ['official', 'backup', 'official']


def test_repeated_silence_cools_down_until_live_success():
    state = models.ShoeModelState()
    error = models.gateway.LlmGatewayError('连续90秒没有有效输出')
    state.failed('official', route('official'), error)
    assert not state.unavailable('official', route('official'))
    state.failed('official', route('official'), error)
    assert state.unavailable('official', route('official'))
    state.succeeded('official', route('official'))
    assert not state.unavailable('official', route('official'))


@pytest.mark.parametrize('status', [401, 402, 403, 429])
def test_inflight_success_does_not_erase_explicit_provider_rejection(status):
    state = models.ShoeModelState()
    state.failed('official', route('official'), models.gateway.LlmGatewayError(f'HTTP {status}'))
    state.succeeded('official', route('official'))
    assert state.unavailable('official', route('official'))


def test_white_gray_pair_features_are_reused_and_changed_file_invalidates(tmp_path, monkeypatch):
    def write(name, background, shifted=False):
        image = Image.new('RGB', (200, 160), background)
        ImageDraw.Draw(image).polygon([(30, 60), (150, 60), (170, 95), (30, 95)], fill='black')
        if shifted:
            ImageDraw.Draw(image).rectangle((20, 20, 70, 100), fill='red')
        image.save(tmp_path / name)
    write('white.png', 'white')
    write('gray.png', (242, 242, 242))
    (tmp_path / 'same-white.png').write_bytes((tmp_path / 'white.png').read_bytes())
    ctx = {'ids': {'W': 'white.png', 'G': 'gray.png', 'W2': 'same-white.png'},
           'entries': {name: {'path': tmp_path / name} for name in ('white.png', 'gray.png', 'same-white.png')}}
    original = shoe._binary_pose_feature
    calls = []
    def counted(path):
        calls.append(str(path))
        return original(path)
    monkeypatch.setattr(shoe, '_binary_pose_feature', counted)
    assert fast._gray_mates(ctx, 'white.png') == ['G']
    assert fast._gray_mates(ctx, 'same-white.png') == ['G']
    assert fast._gray_mates(ctx, 'white.png') == ['G']
    assert len(calls) == 2
    write('gray.png', (242, 242, 242), shifted=True)
    assert fast._gray_mates(ctx, 'white.png') == []
    assert len(calls) == 3


@pytest.mark.parametrize('first_valid', [True, False])
def test_label_pages_stop_only_after_identity_is_verified(tmp_path, monkeypatch, first_valid):
    for name in ('one.jpg', 'two.jpg'):
        Image.new('RGB', (100, 100), 'white').save(tmp_path / name)
    pages = [tmp_path / 'page1.jpg', tmp_path / 'page2.jpg', tmp_path / 'unneeded.jpg']
    monkeypatch.setattr(shoe, '_create_contact_sheets', lambda *args: (pages, {'I1': 'one.jpg', 'I2': 'two.jpg'}))
    monkeypatch.setattr(shoe, '_shoe_label_model_ids', lambda *args: ['official'])
    monkeypatch.setattr(shoe, '_create_label_preview', lambda *args: None)
    monkeypatch.setattr(shoe, '_refine_label_paper_bbox', lambda *args: None)
    monkeypatch.setattr(shoe, '_create_tmq_asset', lambda **kw: tmp_path / 'circled.jpg')
    locator_calls, verified = [], []
    def request(**kw):
        if kw['system_prompt'].startswith('你是商品图片定位员'):
            page = Path(kw['image_inputs'][0]).name
            locator_calls.append(page)
            if page == 'unneeded.jpg':
                pytest.fail('Verified identity should stop scanning later pages')
            return {'candidate_ids': ['I1' if page == 'page1.jpg' else 'I2']}, route('official')
        return {'label_bbox': [0, 0, 1000, 1000], 'style_code_bbox': [100, 100, 800, 200]}, route('official')
    monkeypatch.setattr(shoe, '_label_model_request', request)
    def verify(payload, **kw):
        verified.append(kw['source'].name)
        if not first_valid and kw['source'].name == 'one.jpg':
            raise shoe.ShoeSelectionError('标签款色不一致')
        return {**payload, '_label_category': '运动'}
    monkeypatch.setattr(shoe, '_verify_label_identity_from_crop', verify)
    evidence = shoe._prepare_label_before_pose(
        entries=[{'filename': name, 'path': tmp_path / name} for name in ('one.jpg', 'two.jpg')],
        analysis_root=tmp_path, style_code='123456789012', color_code='00001',
        model_id='official', label_model_id='official', fallback_model_ids=[],
        label_fallback_model_ids=[], config=None, log=lambda _: None,
    )
    assert locator_calls == (['page1.jpg'] if first_valid else ['page1.jpg', 'page2.jpg'])
    assert verified == (['one.jpg'] if first_valid else ['one.jpg', 'two.jpg'])
    assert evidence['filename'] == ('one.jpg' if first_valid else 'two.jpg')
