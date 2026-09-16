from core import shenhui_shoe_template_match as direct
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image




@pytest.mark.parametrize('slot,count', [('tmz1', 2), ('tmz2', 2), ('tmz3', 1)])
def test_zero_shoe_candidate_is_rejected_without_fallback(tmp_path, monkeypatch, slot, count):
    source = tmp_path / 'box.jpg'
    Image.new('RGB', (100, 100), 'white').save(source)
    context = {
        'root': str(tmp_path), 'ids': {'I1': 'box'}, 'category': '休闲',
        'previews': {'box': str(source)}, 'main_refs': [str(source)] * 5,
        'routes': ['official', 'astra', 'terra'],
    }
    calls = []
    def request(ctx, model, *args):
        calls.append(model)
        return {
            'match': False, 'reason': 'Only a shoe box, no physical shoes',
            'template_shoe_count': count, 'candidate_shoe_count': 0,
            'arrangement_matches': False, 'camera_view_matches': False,
            'candidate_facts': {'background_kind': 'plain_gray',
                'independent_cards': False, 'toe': None, 'heel': None, 'view': 'unclear'},
        }, SimpleNamespace(model_id=model)
    monkeypatch.setattr(direct.fast, '_request', request)
    result = direct.audit(context, {'selected': {slot: 'box'}}, [slot])
    assert calls == ['official']
    assert result['outcomes'][slot] == 'source_invalid'
    assert not result['approved']


@pytest.mark.parametrize('template,candidate', [(0, 0), (1, -1), (1, False), (True, 1)])
def test_invalid_counts_remain_review_unknown(tmp_path, monkeypatch, template, candidate):
    source = tmp_path / 'shoe.jpg'
    Image.new('RGB', (100, 100), 'white').save(source)
    context = {'root': str(tmp_path), 'ids': {'I1': 'shoe'},
        'previews': {'shoe': str(source)}, 'main_refs': [str(source)] * 5,
        'routes': ['official']}
    monkeypatch.setattr(direct.fast, '_request', lambda *args: ({
        'match': False, 'reason': 'bad counts', 'template_shoe_count': template,
        'candidate_shoe_count': candidate, 'arrangement_matches': False,
        'camera_view_matches': False,
    }, SimpleNamespace(model_id='official')))
    result = direct.audit(context, {'selected': {'tmz3': 'shoe'}}, ['tmz3'])
    assert result['outcomes']['tmz3'] == 'review_unknown'


def test_zero_shoe_consensus_ignores_irrelevant_card_dispute():
    ctx = {'ids': {'I1': 'insole'}, 'candidate_observations': {'I1': {
        'shoe_count': 0, 'facts': {'independent_cards': False}}}}
    payload = {'candidate_shoe_count': 0, 'candidate_facts': {'independent_cards': True}}
    assert direct.observation_conflicts(ctx, 'insole', 'tmz3', payload) == []
    ctx['candidate_observations']['I1']['shoe_count'] = 1
    assert any(r['fact'] == 'shoe_count' for r in direct.observation_conflicts(ctx, 'insole', 'tmz3', payload))
