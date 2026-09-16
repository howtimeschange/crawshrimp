"""2026-09-16 pose-recognition hardening.

Covers the four changes requested after the v12 audit:
1. pair slots must be landed; an explicit floating classification is a hard veto
   and a floating rule fact can never score tmz1/tmz2.
2. acceptance of tmz3/tmz4/yq3/yq2 must be backed by the reviewer's pixel facts
   (toe/heel axis, near_end, heel_back_visible, tread view), mismatches go to an
   enlarged re-review instead of acceptance.
3. the board offers A/B/C candidates and the repair round honours the picked one.
4. side-identity slots (tmz3/tmz4/yq2/yq3) are ranked without horizontal mirror.
"""
from copy import deepcopy
from types import SimpleNamespace

import pytest
from PIL import Image

from core import shenhui_shoe_board_review as board
from core import shenhui_shoe_mask_rank as mask
from core import shenhui_shoe_packaging as shoe
from core import shenhui_shoe_rules as rules


def _facts(**overrides):
    row = {'candidate_id': 'I1', 'filename': 'a.jpg', 'asset_type': 'shoe', 'shoe_count': 'pair',
           'complete': True, 'pose': 'tmz1', 'side': 'outer', 'confidence': 0.9}
    row.update(overrides)
    return rules.parse_candidate_facts({'candidates': [row]}, {'I1': row['filename']})[0]


def test_floating_pair_never_scores_tmz1():
    floating = _facts(pair_arrangement='floating')
    assert rules.candidate_is_valid_for_slot(floating, 'tmz1')[0] is False
    assert rules.candidate_is_valid_for_slot(floating, 'tmz2')[0] is False
    assert rules._candidate_score(floating, 'tmz1') == 0.0


def test_grounded_or_silent_pair_still_scores_tmz1():
    assert rules.candidate_is_valid_for_slot(_facts(pair_arrangement='grounded'), 'tmz1')[0] is True
    assert rules.candidate_is_valid_for_slot(_facts(), 'tmz1')[0] is True


def test_one_sole_pair_is_not_a_tmz1_pair():
    front_sole = _facts(pose='pair_front_sole', pair_arrangement='one_sole_facing_camera')
    assert rules.candidate_is_valid_for_slot(front_sole, 'tmz1')[0] is False


def item(tmp_path, semantic='tmz3', alternates=()):
    source = tmp_path / 'source.jpg'
    Image.new('RGB', (200, 200), 'white').save(source)
    return {'row_id': 'r1', 'style': '123456789012', 'color': '10001', 'semantic': semantic,
            'category': '休闲', 'template': str(source), 'source_path': str(source),
            'export_path': str(source), 'source_id': 'I1', 'source_size': (200, 200),
            'perimeter': None, 'slots': [semantic],
            'alternates': [(label, key, str(source)) for label, key in [('B', 'I9')][:len(alternates)]],
            'required_checks': board.sequence.contract(semantic, '休闲')}


def response(row, **overrides):
    payload = {'row_id': row['row_id'], 'template_observation': '一只完整鞋',
               'candidate_observation': '一只完整鞋', 'anchor_side_readable': True,
               'anchor_side_observation': '同侧缝线可辨',
               'candidate_pose': {'tmz1': 'pair_grounded', 'tmz2': 'pair_front_sole',
                                  'tmz3': 'side_upright', 'yq3': 'side_horizontal'}.get(row['semantic'], 'other'),
               'template_shoe_count': 1, 'candidate_shoe_count': 1, 'source_match': True,
               'export_match': True, 'source_checks': dict.fromkeys(row['required_checks'], True),
               'reason': '完整且与原图内容一致', 'repair_target': '',
               'candidate_facts': {'background_kind': 'plain_white', 'independent_cards': False,
                                   'view': 'side', 'toe': [0.1, 0.5], 'heel': [0.9, 0.5],
                                   'near_end': 'heel', 'heel_back_visible': True,
                                   'outsole_tread_visible': False, 'upper_side_visible': True,
                                   'lining_visible': False}}
    payload.update(overrides)
    return payload


def test_pixel_axis_must_support_tmz3_and_yq3(tmp_path):
    tmz3 = item(tmp_path, 'tmz3')
    vertical = response(tmz3, candidate_facts={**response(tmz3)['candidate_facts'],
                                               'toe': [0.5, 0.1], 'heel': [0.5, 0.9]})
    assert board.row_verdict(tmz3, vertical)[0] == 'accepted'
    assert board.pixel_evidence_gap('tmz3', tmz3, vertical) == ''
    # horizontal coordinates cannot substantiate a vertical single shoe
    horizontal = response(tmz3, candidate_facts={**response(tmz3)['candidate_facts'],
                                                 'toe': [0.1, 0.5], 'heel': [0.9, 0.5]})
    assert '脚掌轴为水平' in board.pixel_evidence_gap('tmz3', tmz3, horizontal)
    assert board.row_verdict(tmz3, horizontal)[0] == 'review_unknown'

    yq3 = item(tmp_path, 'yq3')
    flat = response(yq3, candidate_facts={**response(yq3)['candidate_facts'],
                                          'toe': [0.1, 0.5], 'heel': [0.9, 0.5]})
    assert board.row_verdict(yq3, flat)[0] == 'accepted'
    assert '脚掌轴为纵向' in board.pixel_evidence_gap(
        'yq3', yq3, response(yq3, candidate_facts={**response(yq3)['candidate_facts'],
                                                   'toe': [0.5, 0.1], 'heel': [0.5, 0.9]}))


def test_missing_pixel_facts_block_acceptance(tmp_path):
    row = item(tmp_path, 'tmz3')
    payload = response(row, candidate_facts={'background_kind': 'plain_white', 'independent_cards': False,
                                             'view': 'side', 'toe': None, 'heel': None,
                                             'near_end': 'unclear', 'heel_back_visible': False,
                                             'outsole_tread_visible': False, 'upper_side_visible': True,
                                             'lining_visible': False})
    assert board.row_verdict(row, payload)[0] == 'review_unknown'
    assert '像素坐标' in board.pixel_evidence_gap('tmz3', row, payload)


def test_tmz4_needs_heel_back_pixel_evidence(tmp_path):
    row = item(tmp_path, 'tmz4')
    payload = response(row, candidate_facts={**response(row)['candidate_facts'],
                                             'view': 'side', 'near_end': 'toe', 'heel_back_visible': False})
    # 现有 visual_fact_failures 通道已能判定；双重保险不得放行。
    assert board.row_verdict(row, payload)[0] in {'review_unknown', 'source_invalid'}
    assert '后跟' in board.pixel_evidence_gap('tmz4', row, payload)
    rear = response(row, candidate_pose='rear_oblique',
                    candidate_facts={**response(row)['candidate_facts'], 'view': 'rear_oblique',
                                     'near_end': 'heel', 'heel_back_visible': True})
    assert board.pixel_evidence_gap('tmz4', row, rear) == ''


def test_board_alternate_choice_is_carried_to_repair(tmp_path):
    row = item(tmp_path, 'tmz3', alternates=[True])
    payload = response(row, chosen_source='B')
    payload['source_checks'] = {name: True for name in row['required_checks']}
    payload['source_checks'][list(row['required_checks'])[0]] = False
    payload['chosen_checks'] = {name: True for name in row['required_checks']}
    status, reason, choice = board.row_verdict(row, payload)
    assert status == 'source_invalid' and choice == 'I9' and '改选' in reason


def test_board_none_choice_demands_full_pool_retrieval(tmp_path):
    row = item(tmp_path, 'tmz3', alternates=[True])
    payload = response(row, chosen_source='none', export_match=None, source_match=None)
    status, reason, choice = board.row_verdict(row, payload)
    assert status == 'source_invalid' and choice == '' and '完整素材重选' in reason


def test_unanswered_choice_falls_back_to_a(tmp_path):
    row = item(tmp_path, 'tmz3')
    payload = response(row, candidate_facts={**response(row)['candidate_facts'],
                                             'toe': [0.5, 0.1], 'heel': [0.5, 0.9]})
    status, reason, choice = board.row_verdict(row, payload)
    assert status == 'accepted' and choice is None


def test_unanswered_choice_on_alt_row_is_reported(tmp_path):
    row = item(tmp_path, 'tmz3', alternates=[True])
    payload = response(row, candidate_facts={**response(row)['candidate_facts'],
                                             'toe': [0.5, 0.1], 'heel': [0.5, 0.9]})
    status, reason, choice = board.row_verdict(row, payload)
    assert status == 'accepted' and '未说明 A/B/C 选择' in reason


def test_side_identity_slots_are_not_mirror_matched():
    assert mask.SIDE_IDENTITY_SLOTS == ('tmz3', 'tmz4', 'yq2', 'yq3')
    assert mask.similarity.__doc__ and 'mirror' in mask.similarity.__doc__.lower()


def _cache(passed, current, statuses):
    """Minimal cache row shaped like the real prepared-color payload."""
    slots = {'tmz1': current.get('tmz1', ''), 'tmz3': current.get('tmz3', ''),
             'wpz': ['', '', '', '', '', ''], 'yq': ['', '', '']}
    for slot, name in current.items():
        shoe._replace_consensus_slot_value(slots, slot, name)
    return {'slots': slots,
            'export_review': [{'semantic': slot, 'accepted': status == 'accepted', 'status': status,
                               'slot': slot} for slot, status in statuses.items()],
            'export_errors': {slot: 'rejected' for slot, status in statuses.items() if status != 'accepted'}}


def test_approved_sources_are_not_left_worse_by_a_repair_round():
    cache = {('204426146118', '00399'): _cache({}, {'tmz1': 'new-1.jpg', 'tmz3': 'old-3.jpg'},
                                               {'tmz1': 'source_invalid', 'tmz3': 'accepted'})}
    snapshot = {('204426146118', '00399'): {'tmz1': 'old-1.jpg', 'tmz3': 'old-3.jpg'}}
    log = []
    restored = shoe.shoe_restore_approved_sources(cache, snapshot, log.append)
    slots = cache[('204426146118', '00399')]['slots']
    assert restored == {'204426146118'}
    assert shoe._consensus_slot_value(slots, 'tmz1') == 'old-1.jpg'
    assert shoe._consensus_slot_value(slots, 'tmz3') == 'old-3.jpg'
    assert 'tmz1' not in slots.get('_pending_slots', {})
    assert cache[('204426146118', '00399')]['export_errors'] == {}
    assert log and '回退' in log[0]


def test_repair_that_keeps_the_new_source_passing_needs_no_rollback():
    cache = {('204426146118', '00319'): _cache({}, {'tmz1': 'new-1.jpg'}, {'tmz1': 'accepted'})}
    snapshot = {('204426146118', '00319'): {'tmz1': 'old-1.jpg'}}
    assert shoe.shoe_restore_approved_sources(cache, snapshot, None) == set()
    assert shoe._consensus_slot_value(cache[('204426146118', '00319')]['slots'], 'tmz1') == 'new-1.jpg'


def test_snapshot_only_records_approved_slots():
    cache = {('S', 'C'): _cache({}, {'tmz1': 'a.jpg', 'tmz3': 'b.jpg'},
                                {'tmz1': 'accepted', 'tmz3': 'review_unknown'})}
    assert shoe.shoe_accepted_sources_snapshot(cache) == {('S', 'C'): {'tmz1': 'a.jpg'}}


def test_export_column_stays_on_canvas_without_alternates(tmp_path):
    """A 3-column page must still show EXPORT; padding used to push it off-canvas."""
    source = tmp_path / 'source.jpg'
    Image.new('RGB', (120, 120), 'navy').save(source)
    row = {'row_id': 'aux-1', 'key': 'k', 'style': 'S', 'color': 'C', 'semantic': 'yk1', 'slots': ['yk1'],
           'template': str(source), 'source_path': str(source), 'export_path': str(source),
           'source_id': 'I1', 'anchor': None, 'alternates': []}
    path = board.render_board([row], tmp_path / 'board3.jpg')
    with Image.open(path) as image:
        assert image.size == (2 * 16 + 3 * 600 + 2 * 16, image.size[1])
        # last (EXPORT) cell must contain the dark source pixels
        cell = image.convert('L').crop((2 * 16 + 2 * (600 + 16) + 60, 200,
                                        2 * 16 + 2 * (600 + 16) + 500, 400))
        assert min(cell.getdata()) < 100


def test_five_column_page_pads_missing_alternates_inside_canvas(tmp_path):
    source = tmp_path / 'source.jpg'
    Image.new('RGB', (120, 120), 'navy').save(source)
    rows = [
        {'row_id': 'pose-1', 'key': 'k1', 'style': 'S', 'color': 'C', 'semantic': 'tmz1', 'slots': ['tmz1'],
         'template': str(source), 'source_path': str(source), 'export_path': str(source),
         'source_id': 'I1', 'anchor': None, 'alternates': [('B', 'I2', str(source))]},
        {'row_id': 'pose-2', 'key': 'k2', 'style': 'S', 'color': 'C', 'semantic': 'tmz1', 'slots': ['tmz1'],
         'template': str(source), 'source_path': str(source), 'export_path': str(source),
         'source_id': 'I3', 'anchor': None, 'alternates': []},
    ]
    path = board.render_board(rows, tmp_path / 'board5.jpg')
    with Image.open(path) as image:
        # one alternate on the page -> TEMPLATE / A / B / EXPORT, 560px cells
        assert image.size == (2 * 16 + 4 * 560 + 3 * 16, image.size[1])
        last = 2 * 16 + 3 * (560 + 16)          # EXPORT column of the padded second row
        cell = image.convert('L').crop((last + 60, 200 + 540, last + 460, 400 + 540))
        assert min(cell.getdata()) < 100


def test_alternate_pick_needs_a_contract_failure(tmp_path):
    """模型偏好不足以换源：必须给出 A 的契约失败依据，否则放大复核。"""
    row = item(tmp_path, 'tmz3', alternates=[True])
    payload = response(row, chosen_source='B')
    status, reason, choice = board.row_verdict(row, payload)
    assert status == 'review_unknown' and choice is None and '未给出 A 的契约失败依据' in reason


def test_alternate_pick_is_honoured_when_a_fails_and_choice_passes(tmp_path):
    row = item(tmp_path, 'tmz3', alternates=[True])
    payload = response(row, chosen_source='B')
    payload['source_checks'] = {name: False for name in row['required_checks']}
    payload['chosen_checks'] = {name: True for name in row['required_checks']}
    status, reason, choice = board.row_verdict(row, payload)
    assert status == 'source_invalid' and choice == 'I9' and 'A 不满足' in reason


def test_explicit_null_total_match_does_not_block_an_all_true_checklist(tmp_path):
    row = item(tmp_path, 'tmz3')
    payload = response(row, source_match=None,
                       candidate_facts={**response(row)['candidate_facts'],
                                        'toe': [0.5, 0.1], 'heel': [0.5, 0.9]})
    status, _reason, _choice = board.row_verdict(row, payload)
    assert status == 'accepted'


def test_null_check_still_blocks_acceptance(tmp_path):
    row = item(tmp_path, 'tmz3')
    payload = response(row, source_match=None,
                       candidate_facts={**response(row)['candidate_facts'],
                                        'toe': [0.5, 0.1], 'heel': [0.5, 0.9]})
    payload['source_checks'][list(row['required_checks'])[0]] = None
    assert board.row_verdict(row, payload)[0] == 'review_unknown'
