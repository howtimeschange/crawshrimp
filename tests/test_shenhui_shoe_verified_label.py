from core import shenhui_shoe_catalog as catalog, shenhui_shoe_mask_rank as masks
from pathlib import Path

from PIL import Image




def test_verified_label_cannot_be_restored_by_mask_even_with_wrong_observation(tmp_path):
    from tests.test_shenhui_shoe_catalog import context, fact
    ctx = context(tmp_path)
    ctx['verified_label_filename'] = 'source.png'
    ctx['ids']['I2'] = 'real-shoe.png'
    ctx['previews']['real-shoe.png'] = ctx['previews']['source.png']
    ctx['mask_plan'] = {'by_slot': {'tmz4': {'ranked': [
        {'candidate_id': 'I1', 'score': .99, 'mask_valid': True},
        {'candidate_id': 'I2', 'score': .8, 'mask_valid': True},
    ]}}}
    observations = {'I1': fact(), 'I2': {**fact('I2'), 'kind': 'insole', 'shoe_count': 0}}
    choices = catalog.options(ctx, observations)
    assert all(key != 'I1' for values in choices.values() for key, _ in values)
    assert 'I2' in dict(choices['tmz4'])
    assert ctx['ids']['I1'] == 'source.png'


def test_invalid_mask_fallback_excludes_only_verified_label(tmp_path, monkeypatch):
    from core import ocr_service
    monkeypatch.setattr(ocr_service, 'recognize_image_with_tesseract_js', lambda *a, **kw: {'words': []})
    source = tmp_path / 'blank.jpg'
    Image.new('RGB', (100, 100), 'white').save(source)
    ctx = {'root': str(tmp_path), 'style': '123456789012', 'color': '00001',
        'ids': {'I1': 'box', 'I2': 'shoe'}, 'previews': {'box': str(source), 'shoe': str(source)},
        'main_refs': [str(source)] * 5, 'yq_refs': {'yq2': str(source), 'yq3': str(source)},
        'verified_label_filename': 'box'}
    plan = masks.prepare_shortlists(ctx)
    assert plan['initial_ids'] == ['I2']
    assert plan['candidate_count'] == 2 and plan['pose_candidate_count'] == 1
    assert plan['excluded_verified_label_ids'] == ['I1']
    assert set(ctx['ids']) == {'I1', 'I2'}
    assert all(row['initial_ids'] == ['I2'] for row in plan['by_slot'].values())
