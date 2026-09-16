from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
import json
import threading

import pytest
from PIL import Image

from core import shenhui_shoe_board_review as board
from core import shenhui_shoe_mask_rank as mask
from core import shenhui_shoe_catalog as catalog
from core import shenhui_shoe_template_match as direct
from core import shenhui_shoe_fast as fast
from core import shenhui_shoe_packaging as shoe


@pytest.fixture(autouse=True)
def neutral_source_fixture(monkeypatch):
    # These board unit fixtures are white squares, not photographs. Blind
    # source transport and board integration are covered in source_review tests.
    def observed(row, root):
        slot = row['semantic']
        return {'observation': {'id': 'S1', 'description': 'fixture source',
            'shoe_count': 2 if slot in {'tmz1', 'tmz2'} else 1,
            'view': 'side', 'foot_axis': 'diagonal',
            'outsole_face': 'full' if slot in {'tmz2', 'yq2'} else 'none',
            'pair_arrangement': 'grounded', 'lining_closeup': True,
            'independent_function_card': slot == 'yx'}, 'model': 'fixture'}
    monkeypatch.setattr(board.source_review, 'observe', observed)


def item(tmp_path, row_id='r1', semantic='tmz5'):
    source = tmp_path / 'source.jpg'
    Image.new('RGB', (200, 200), 'white').save(source)
    ctx = {'root': str(tmp_path), 'style': '123456789012', 'color': '10001', 'category': '休闲',
           'routes': ['deepseek-official-flash'], 'direct_review_routes': ['deepseek-official-flash', 'gpt-6-astra'],
           'log': lambda _: None}
    return {'row_id': row_id, 'style': ctx['style'], 'color': ctx['color'], 'semantic': semantic,
            'category': '休闲', 'template': str(source), 'source_path': str(source), 'export_path': str(source),
            'source_id': 'I1', 'source_size': (200, 200), 'perimeter': None, 'slots': [semantic],
            'required_checks': board.sequence.contract(semantic, '休闲'), 'ctx': ctx}


def response(row):
    return {'row_id': row['row_id'], 'template_observation': '一只完整鞋', 'candidate_observation': '一只完整鞋',
            'anchor_side_readable': True, 'anchor_side_observation': '相同侧板缝线和固定端头可辨',
            'candidate_pose': {'tmz1':'pair_grounded','tmz2':'pair_front_sole','tmz3':'side_upright','yq3':'side_horizontal'}.get(row['semantic'],'other'),
            'template_shoe_count': 1, 'candidate_shoe_count': 1, 'source_match': True, 'export_match': True,
            'source_checks': dict.fromkeys(row['required_checks'], True), 'reason': '完整且与原图内容一致',
            'repair_target': '', 'candidate_facts': {'background_kind': 'plain_white', 'independent_cards': False,
                'view': 'side', 'toe': [0.1, 0.5], 'heel': [0.9, 0.5], 'near_end': 'neither',
                'heel_back_visible': False, 'outsole_tread_visible': False, 'upper_side_visible': True,
                'lining_visible': False}}


def test_actual_board_only_sent_and_partial_valid_rows_preserved(tmp_path, monkeypatch):
    items = [item(tmp_path, 'r1'), item(tmp_path, 'r2'), item(tmp_path, 'r3')]
    calls = []
    def request(ctx, model, prompt, images, phase):
        calls.append(model)
        assert len(images) == 1 and images[0].endswith('.jpg')
        with Image.open(images[0]) as im:
            assert im.width == (1864 if len(calls) == 1 else 2764)
        assert 'candidate_options' not in prompt and 'prior_selection_evidence' not in prompt
        if len(calls) == 1:
            rejected = response(items[1]); rejected['source_match'] = False
            rejected['source_checks'][next(iter(items[1]['required_checks']))] = False
            return {'rows': [response(items[0]), rejected]}, SimpleNamespace(model_id=model)
        assert 'r1' not in prompt and 'r2' not in prompt and 'r3' in prompt
        return {'rows': [response(items[2])]}, SimpleNamespace(model_id=model)
    monkeypatch.setattr(fast, '_request', request)
    result = board.audit_page(items, tmp_path, 'test')
    assert result['r1']['accepted'] and result['r3']['accepted']
    assert result['r2']['status'] == 'source_invalid'
    assert calls == ['deepseek-official-flash', 'gpt-6-astra']


def test_zero_shoes_is_valid_negative_and_bad_template_is_unknown(tmp_path):
    row = item(tmp_path, semantic='tmz2'); payload = response(row)
    payload.update(template_shoe_count=2, candidate_shoe_count=0, candidate_facts=None)
    assert board.row_verdict(row, payload)[0] == 'source_invalid'
    payload['template_shoe_count'] = 4
    with pytest.raises(shoe.ShoeSelectionError, match='模板鞋数'):
        board.row_verdict(row, payload)


def test_visible_bottom_failure_overrides_positive_vote_and_unclear_stays_unknown(tmp_path):
    row = item(tmp_path, semantic='yq2'); payload = response(row)
    assert board.row_verdict(row, payload)[0] == 'source_invalid'
    payload['source_checks']['complete_outsole_facing_camera'] = None
    assert board.row_verdict(row, payload)[0] == 'review_unknown'


def test_one_broken_export_never_rejects_good_source(tmp_path):
    row = item(tmp_path); payload = response(row); payload['export_match'] = False
    assert board.row_verdict(row, payload)[0] == 'export_invalid'


def test_exact_original_identity_resolves_only_export_content(tmp_path):
    row = item(tmp_path)
    row['export_identity_sha256'] = board.digest(row['source_path'])
    payload = response(row)
    payload['export_match'] = False
    assert board.row_verdict(row, payload)[0] == 'accepted'
    payload['source_match'] = False
    assert board.row_verdict(row, payload)[0] == 'review_unknown'
    payload['source_checks']['horizontal_side_view'] = None
    assert board.row_verdict(row, payload)[0] == 'review_unknown'
    payload['source_checks'][next(iter(row['required_checks']))] = False
    assert board.row_verdict(row, payload)[0] == 'source_invalid'


def test_export_identity_uses_original_not_cropped_preview_and_invalidates_on_change(tmp_path, monkeypatch):
    row = item(tmp_path)
    raw, exported = tmp_path / 'original.jpg', tmp_path / 'export.jpg'
    Image.new('RGB', (400, 400), 'gray').save(raw)
    exported.write_bytes(raw.read_bytes())
    ctx = row['ctx']
    ctx.update(board_review=True, previews={'a': row['source_path']}, ids={'I1': 'a'},
               export_source_paths={'a': str(raw)})
    selection = {'_sequential_context': ctx, 'tmz5': 'a'}
    rows = [{'规则槽位': 'tmz5', '原文件名': 'a', '本地文件': str(exported)}]
    monkeypatch.setattr(direct, 'reference', lambda *args: row['source_path'])
    proofs = []
    def audit(items, *args):
        proofs.extend(r['export_identity_sha256'] for r in items)
        return {r['row_id']: {'status': 'accepted', 'accepted': True, 'reason': 'fixture'} for r in items}
    monkeypatch.setattr(board, 'audit_page', audit)
    board.review_style({'10001': (selection, rows)})
    expected = board.digest(raw)
    assert expected != board.digest(row['source_path'])
    Image.new('RGB', (400, 400), 'black').save(raw)
    board.review_style({'10001': (selection, rows)})
    assert proofs == [expected, '']


def test_negative_total_without_failed_rule_preserves_source_for_recheck(tmp_path):
    row = item(tmp_path, semantic='yq3')
    payload = response(row)
    payload['source_match'] = False
    assert board.row_verdict(row, payload)[0] == 'review_unknown'


def test_checklist_schema_does_not_require_ambiguous_total_match(tmp_path):
    row = item(tmp_path)
    payload = response(row)
    payload.pop('source_match')
    assert board.row_verdict(row, payload)[0] == 'accepted'
    payload['source_checks']['single_complete_shoe'] = False
    assert board.row_verdict(row, payload)[0] == 'source_invalid'


def test_rear_slot_checks_cannot_override_observed_side_pose(tmp_path):
    row = item(tmp_path, semantic='tmz4')
    payload = response(row)
    payload['candidate_pose'] = 'side_horizontal'
    payload['candidate_facts'].update(view='rear_oblique', near_end='heel', heel_back_visible=True)
    assert board.row_verdict(row, payload)[0] != 'accepted'
    payload['candidate_pose'] = 'rear_oblique'
    assert board.row_verdict(row, payload)[0] == 'accepted'


@pytest.mark.parametrize('readable,expected', [(True, 'accepted'), (False, 'review_unknown')])
def test_anchor_side_evidence_is_independent_of_anchor_pose(tmp_path, monkeypatch, readable, expected):
    row = item(tmp_path)
    ctx = row['ctx']
    ctx.update(board_review=True, previews={'a': row['source_path'], 'b': row['source_path']}, ids={'I1':'a','I2':'b'})
    selection = {'_sequential_context': ctx, 'tmz3': 'a', 'yq': ['', '', 'b']}
    rows = [{'规则槽位': slot, '原文件名': name, '本地文件': row['source_path']}
            for slot, name in [('tmz3','a'), ('yq3','b')]]
    monkeypatch.setattr(direct, 'reference', lambda *args: row['source_path'])
    def audit(items, *args):
        return {r['row_id']: {'status': 'source_invalid' if r['semantic']=='tmz3' else 'accepted',
            'accepted': r['semantic']=='yq3', 'reason': 'anchor pose is oblique',
            'response': {'anchor_side_readable': readable, 'anchor_side_observation': 'Same outer panel seam and strap fastening visible'}} for r in items}
    monkeypatch.setattr(board, 'audit_page', audit)
    _, records = board.review_style({'10001': (selection, rows)})['10001']
    assert records[0]['status'] == 'source_invalid'
    assert records[1]['status'] == expected


def test_export_failure_does_not_invalidate_verified_source_anchor(tmp_path, monkeypatch):
    row = item(tmp_path)
    ctx = row['ctx']
    ctx.update(board_review=True, previews={'a': row['source_path'], 'b': row['source_path']},
               ids={'I1': 'a', 'I2': 'b'})
    selection = {'_sequential_context': ctx, 'tmz3': 'a', 'yq': ['', '', 'b']}
    rows = [{'规则槽位': slot, '原文件名': name, '本地文件': row['source_path']}
            for slot, name in [('tmz3', 'a'), ('yq3', 'b')]]
    monkeypatch.setattr(direct, 'reference', lambda *args: row['source_path'])
    monkeypatch.setattr(board, 'audit_page', lambda items, *args: {
        r['row_id']: {'status': 'export_invalid' if r['semantic'] == 'tmz3' else 'accepted',
                     'accepted': r['semantic'] != 'tmz3', 'reason': 'source verified, export damaged',
                     'response': {'anchor_side_readable': True, 'anchor_side_observation': 'same panel seam visible'}}
        for r in items})
    _, records = board.review_style({'10001': (selection, rows)})['10001']
    assert records[0]['status'] == 'export_invalid'
    assert records[1]['status'] == 'accepted'


def test_board_cache_only_rechecks_changed_row(tmp_path, monkeypatch):
    ctx = item(tmp_path)['ctx']
    ctx.update(board_review=True, previews={'source.jpg': str(tmp_path/'source.jpg')}, ids={'I1':'source.jpg'})
    selection = {'_sequential_context':ctx, 'tmz5':'source.jpg', 'tms':'source.jpg'}
    a, b = tmp_path/'a.jpg', tmp_path/'b.jpg'
    Image.new('RGB', (200, 200), 'white').save(a)
    Image.new('RGB', (200, 200), 'gray').save(b)
    rows = [{'规则槽位':slot, '原文件名':'source.jpg', '本地文件':str(path)} for slot,path in [('tmz5',a),('tms',b)]]
    monkeypatch.setattr(direct, 'reference', lambda *args: str(tmp_path/'source.jpg'))
    reviewed = []
    def audit(items, *args):
        reviewed.append(len(items))
        return {r['row_id']:{'status':'accepted','accepted':True,'reason':'good','model':'test'} for r in items}
    monkeypatch.setattr(board, 'audit_page', audit)
    for _ in range(2):
        assert not board.review_style({'10001':(selection,rows)})['10001'][0]
    Image.new('RGB', (200, 200), 'black').save(b)
    board.review_style({'10001':(selection,rows)})
    assert reviewed == [2,1]


def test_initial_mask_does_not_call_model_and_excludes_label(tmp_path, monkeypatch):
    ctx = item(tmp_path)['ctx']
    names = ['s'+str(i)+'.jpg' for i in range(9)]
    ctx.update(ids={f'I{i}':name for i,name in enumerate(names)}, previews={n:str(tmp_path/'source.jpg') for n in names},
               verified_label_filename=names[-1])
    ranked = {slot:{'ranked':[{'candidate_id':f'I{i}', 'score':.8,'mask_valid':True}]}
              for i,slot in enumerate(catalog.INDEPENDENT) if slot != 'tmz5'}
    ctx['mask_plan'] = {'by_slot':ranked,'standard_identity_ids':['I4']}
    monkeypatch.setattr(catalog,'candidate_families',lambda c:{k:k for k in c['ids']})
    monkeypatch.setattr(fast,'_gray_mates',lambda *args:[])
    monkeypatch.setattr(fast,'_request',lambda *args:pytest.fail('initial model request'))
    monkeypatch.setattr(catalog,'observe',lambda *args:pytest.fail('initial observation'))
    monkeypatch.setattr(shoe,'_binary_pose_feature',lambda *args:SimpleNamespace(background_luma=255))
    result=mask.propose_without_model(ctx)
    assert result['model_selection_calls']==0
    assert names[-1] not in result['selected'].values()
    assert result['selected']['yq1']==result['selected']['tmz2']
    assert all(not r['accepted'] for r in result['records'])


def test_problem_slots_retrieve_in_parallel_without_observing_whole_pool(tmp_path,monkeypatch):
    ctx = item(tmp_path)['ctx']
    ctx.update(ids={'I1':'a','I2':'b','I3':'c','I4':'box'},previews=dict.fromkeys(['a','b','c','box'],str(tmp_path/'source.jpg')),
               verified_label_filename='box')
    selection={'_pending_slots':{'tmz1':'wrong','tmz2':'wrong'},'_invalid_sources':['tmz1','tmz2'],
               '_sequential_result':{'selected':{'tmz1':'a','tmz2':'b','tmz5':'c'}}}
    monkeypatch.setattr(catalog,'candidate_families',lambda c:{k:k for k in c['ids']})
    monkeypatch.setattr(catalog,'observe',lambda *args:pytest.fail('whole pool observation'))
    monkeypatch.setattr(fast,'_gray_mates',lambda *args:[])
    monkeypatch.setattr(shoe,'_binary_pose_feature',lambda *args:SimpleNamespace(background_luma=255))
    monkeypatch.setattr(direct,'reference',lambda *args:str(tmp_path/'source.jpg'))
    barrier=threading.Barrier(2); seen=[]
    def retrieve(ctx,model,slot,pool,*args):
        seen.append(slot);assert 'I4' not in pool and 'I3' not in pool
        barrier.wait(timeout=2)
        return {'accepted':True,'candidate_id':pool[0]},SimpleNamespace(model_id=model),[]
    monkeypatch.setattr(direct,'select_inventory',retrieve)
    result=mask.repair_from_board(ctx,selection)
    assert set(seen)=={'tmz1','tmz2'} and result['selected']['tmz5']=='c'


def test_board_strategy_default_routes_and_manifest():
    import yaml
    manifest=yaml.safe_load(Path('adapters/shenhui-new-arrival/manifest.yaml').read_text())
    text=json.dumps(manifest,ensure_ascii=False)
    assert shoe.SHOE_POSE_DEFAULT_STRATEGY=='mask_board_review'
    assert shoe.normalize_shoe_pose_strategy('mask_board_review') in shoe.SHOE_REVIEW_STRATEGIES
    assert '蒙版直接初选' in text


def test_irrelevant_heel_field_does_not_retry_valid_outsole(tmp_path):
    row=item(tmp_path,semantic='yq2'); payload=response(row)
    payload['candidate_facts'].update(view='bottom',outsole_tread_visible=True,upper_side_visible=False)
    payload['candidate_facts'].pop('heel_back_visible')
    assert board.row_verdict(row,payload)[0]=='accepted'
    row=item(tmp_path,semantic='yq3');payload=response(row)
    payload['candidate_facts']['toe']=None
    assert board.row_verdict(row,payload)[0]=='review_unknown'


def test_wrong_anchor_cannot_blacklist_rejected_side_candidate(tmp_path,monkeypatch):
    row=item(tmp_path);ctx=row['ctx']
    ctx.update(board_review=True,previews={'a':row['source_path'],'b':row['source_path']},ids={'I1':'a','I2':'b'})
    selection={'_sequential_context':ctx,'tmz3':'a','yq':['','','b']}
    rows=[{'规则槽位':slot,'原文件名':source,'本地文件':row['source_path']} for slot,source in [('tmz3','a'),('yq3','b')]]
    monkeypatch.setattr(direct,'reference',lambda *args:row['source_path'])
    monkeypatch.setattr(board,'audit_page',lambda items,*args:{r['row_id']:{'status':'source_invalid',
        'accepted':False,'reason':'wrong anchor' if r['semantic']=='tmz3' else 'opposite side'} for r in items})
    _,records=board.review_style({'10001':(selection,rows)})['10001']
    assert records[0]['status']=='source_invalid'
    assert records[1]['status']=='review_unknown'
    assert not records[1]['accepted']
    index=json.loads((tmp_path.parent/'style-review-boards/latest-index.json').read_text())
    assert next(r for r in index if r['semantic']=='yq3')['verdict']['status']=='review_unknown'


def test_same_source_conflicting_rows_never_leave_approved_sibling(tmp_path,monkeypatch):
    row=item(tmp_path);ctx=row['ctx'];ctx.update(board_review=True,previews={'a':row['source_path']},ids={'I1':'a'})
    selection={'_sequential_context':ctx,'tmz5':'a','tms':'a'}
    second=tmp_path/'second.jpg';Image.new('RGB',(200,200),'gray').save(second)
    rows=[{'规则槽位':slot,'原文件名':'a','本地文件':str(path)} for slot,path in [('tmz5',row['source_path']),('tms',second)]]
    monkeypatch.setattr(direct,'reference',lambda *args:row['source_path'])
    calls=[]
    def audit(items,*args):
        calls.append(1)
        return {r['row_id']:{'status':'source_invalid' if r['export_path']==str(second) else 'accepted',
            'accepted':r['export_path']!=str(second),'reason':'dispute'} for r in items}
    monkeypatch.setattr(board,'audit_page',audit)
    for _ in range(4):
        _,records=board.review_style({'10001':(selection,rows)})['10001']
        assert all(r['status']=='review_unknown' and not r['accepted'] for r in records)
    assert len(calls)==3  # first page, then one enlarged page per disputed row


def test_auxiliary_source_is_audited_without_joining_pose_pool(tmp_path,monkeypatch):
    row=item(tmp_path);ctx=row['ctx'];ctx.update(board_review=True,previews={},ids={},export_source_paths={'ai-angle.png':row['source_path']})
    selection={'_sequential_context':ctx}
    source=tmp_path/'channel.png';im=Image.new('RGBA',(800,800),(255,255,255,0));im.paste((20,20,20,255),(200,200,600,600));im.save(source)
    rows=[{'规则槽位':'jdt','原文件名':'ai-angle.png','本地文件':str(source)}];calls=[]
    def audit(items,*args):
        calls.extend(items)
        return {r['row_id']:{'status':'accepted','accepted':True,'reason':'content matches'} for r in items}
    monkeypatch.setattr(board,'audit_page',audit)
    assert not board.review_style({'10001':(selection,rows)})['10001'][0]
    assert len(calls)==1 and calls[0]['source_id'].startswith('AUX-') and not ctx['ids']


def test_collision_retrieves_next_source_with_frozen_occupied_set(tmp_path,monkeypatch):
    ctx=item(tmp_path)['ctx'];ctx.update(ids={'I1':'a','I2':'b','I3':'c','I4':'d'},
        previews=dict.fromkeys(['a','b','c','d'],str(tmp_path/'source.jpg')))
    selection={'_pending_slots':{'tmz1':'wrong','tmz2':'wrong'},'_invalid_sources':['tmz1','tmz2'],
        '_sequential_result':{'selected':{'tmz1':'a','tmz2':'b'}}}
    monkeypatch.setattr(catalog,'candidate_families',lambda c:{k:k for k in c['ids']})
    monkeypatch.setattr(direct,'reference',lambda *args:str(tmp_path/'source.jpg'))
    barrier=threading.Barrier(2);calls=[];lock=threading.Lock()
    def retrieve(ctx,model,slot,pool,*args):
        with lock:calls.append((slot,list(pool)));n=len(calls)
        if n<=2:
            barrier.wait(timeout=2);key='I3'
        else:
            assert 'I3' not in pool;key='I4'
        return {'accepted':True,'candidate_id':key},SimpleNamespace(model_id=model),[]
    monkeypatch.setattr(direct,'select_inventory',retrieve)
    result=mask.repair_from_board(ctx,selection)
    assert len(calls)==3 and {result['selected']['tmz1'],result['selected']['tmz2']}=={'c','d'}


def test_contradictory_total_and_checkbox_is_unknown_then_correctable(tmp_path, monkeypatch):
    row = item(tmp_path, semantic='tmz2')
    good = response(row)
    good.update(template_shoe_count=2, candidate_shoe_count=2)
    good['candidate_facts'].update(outsole_tread_visible=True, upper_side_visible=True)
    bad = deepcopy(good)
    bad['source_checks']['no_floating'] = False
    assert board.row_verdict(row, bad)[0] == 'review_unknown'
    calls = []
    def request(ctx, model, *args):
        calls.append(model)
        return {'rows':[bad if len(calls)==1 else good]}, SimpleNamespace(model_id=model)
    monkeypatch.setattr(fast, '_request', request)
    result = board.audit_page([row], tmp_path, 'contradiction')
    assert result[row['row_id']]['accepted']
    assert calls == ['deepseek-official-flash','gpt-6-astra']


@pytest.mark.parametrize('slot', ['tmz4','tmz5','yq3'])
def test_single_shoe_slots_reject_two_shoes(tmp_path,slot):
    row=item(tmp_path,semantic=slot);payload=response(row)
    payload['candidate_shoe_count']=2
    assert board.row_verdict(row,payload)[0]=='source_invalid'


@pytest.mark.parametrize('slot,pose,expected', [
    ('tmz2','pair_floating','source_invalid'),   # 悬空是双鞋图位的硬否决
    ('tmz3','top_opening','review_unknown'),
    ('yq3','front_oblique','review_unknown')])
def test_observed_pose_cannot_be_overruled_by_all_true_checks(tmp_path,slot,pose,expected):
    row=item(tmp_path,semantic=slot);payload=response(row)
    if slot=='tmz2':payload.update(template_shoe_count=2,candidate_shoe_count=2)
    payload['candidate_pose']=pose
    assert board.row_verdict(row,payload)[0]==expected
    payload.pop('candidate_pose')
    assert board.row_verdict(row,payload)[0]=='review_unknown'


def test_missing_anchor_export_invalidates_side_verdict(tmp_path,monkeypatch):
    row=item(tmp_path);ctx=row['ctx']
    ctx.update(board_review=True,previews={'a':row['source_path'],'b':row['source_path']},ids={'I1':'a','I2':'b'})
    selection={'_sequential_context':ctx,'tmz3':'a','yq':['','','b']}
    rows=[{'规则槽位':slot,'原文件名':source,'本地文件':str(path)} for slot,source,path in
          [('tmz3','a',tmp_path/'missing.jpg'),('yq3','b',row['source_path'])]]
    monkeypatch.setattr(direct,'reference',lambda *args:row['source_path'])
    monkeypatch.setattr(board,'audit_page',lambda items,*args:{r['row_id']:{'status':'accepted',
        'accepted':True,'reason':'same side'} for r in items})
    _,records=board.review_style({'10001':(selection,rows)})['10001']
    assert records[0]['status']=='export_invalid'
    assert records[1]['status']=='review_unknown'


def test_card_repair_checks_complete_pool_once_without_duplicate_picker(tmp_path,monkeypatch):
    ctx=item(tmp_path)['ctx'];ctx.update(ids={'I1':'a'},previews={'a':str(tmp_path/'source.jpg')})
    selection={'_pending_slots':{'yx':'needs card'},'_sequential_result':{'selected':{}}}
    monkeypatch.setattr(catalog,'candidate_families',lambda c:{k:k for k in c['ids']})
    monkeypatch.setattr(direct,'reference',lambda *args:str(tmp_path/'source.jpg'))
    monkeypatch.setattr(direct,'select_inventory',lambda *args:pytest.fail('duplicate card selection'))
    calls=[]
    monkeypatch.setattr(board.sequence,'inspect_card_pool',lambda *args:(calls.append(1) or '',{'confirmed':True}))
    result=mask.repair_from_board(ctx,selection)
    assert calls==[1] and result['card_absence_verified'] and not result['proposal_missing']


def test_new_card_evidence_reconsiders_rejected_source_once_without_approving(tmp_path,monkeypatch):
    ctx=item(tmp_path)['ctx'];ctx.update(ids={'I1':'a'},previews={'a':str(tmp_path/'source.jpg')})
    selection={'_pending_slots':{'yx':'prior rejection'},'_invalid_sources':['yx'],
               '_sequential_result':{'selected':{'yx':'a'}}}
    monkeypatch.setattr(catalog,'candidate_families',lambda c:{'I1':'family-a'})
    monkeypatch.setattr(direct,'reference',lambda *args:str(tmp_path/'source.jpg'))
    monkeypatch.setattr(board.sequence,'inspect_card_pool',lambda *args:('a',{'found':'I1'}))
    first=mask.repair_from_board(ctx,selection)
    assert first['selected']['yx']=='a'
    assert first['records'][-1]['reconsidered_source']=='a'
    assert not first['records'][-1].get('accepted')
    assert ctx['source_review_revisions']=={'a':1}
    selection['_sequential_result']=first
    second=mask.repair_from_board(ctx,selection)
    assert not second['selected']['yx']
    assert ctx['source_review_revisions']=={'a':1}


def test_exhausted_remaining_pool_can_reconsider_one_rejected_pose(tmp_path, monkeypatch):
    ctx=item(tmp_path)['ctx'];ctx.update(ids={'I1':'a','I2':'b'},previews=dict.fromkeys(['a','b'],str(tmp_path/'source.jpg')))
    selection={'_pending_slots':{'tmz1':'prior rejection'},'_invalid_sources':['tmz1'],
               '_sequential_result':{'selected':{'tmz1':'a'}}}
    monkeypatch.setattr(catalog,'candidate_families',lambda c:{k:k for k in c['ids']})
    monkeypatch.setattr(direct,'reference',lambda *args:str(tmp_path/'source.jpg'))
    pools=[]
    def retrieve(ctx,model,slot,pool,*args):
        pools.append(pool)
        return {'accepted':pool==['I1'],'candidate_id':'I1' if pool==['I1'] else ''},SimpleNamespace(model_id=model),[]
    monkeypatch.setattr(direct,'select_inventory',retrieve)
    result=mask.repair_from_board(ctx,selection)
    assert pools==[['I2'],['I1']]
    assert result['selected']['tmz1']=='a'
    assert ctx['source_review_revisions']=={'a':1}
    assert not result['records'][-1].get('accepted')


def test_pose_reviewer_has_own_routes_and_never_degrades_silently(tmp_path,monkeypatch):
    from core.shenhui_shoe_models import ShoeModelState
    ctx=item(tmp_path)['ctx'];ctx['model_state']=ShoeModelState()
    assert board.review_routes(ctx,'tmz2')==['gpt-6-astra']
    assert board.review_routes(ctx,'tmz5')==ctx['direct_review_routes']
    assert board.review_routes(ctx,'jdt')==ctx['direct_review_routes']
    row=item(tmp_path,semantic='tmz2');row['ctx']=ctx;calls=[]
    def request(ctx,model,*args):
        calls.append(model);raise shoe.ShoeSelectionError('no valid response')
    monkeypatch.setattr(fast,'_request',request)
    assert board.audit_page([row],tmp_path,'no-fallback')['r1']['status']=='review_unknown'
    assert calls==['gpt-6-astra']
    ctx['model_state']=ShoeModelState(board_review_model_id='')
    assert board.review_routes(ctx,'tmz2')==ctx['direct_review_routes']


def test_mixed_exports_are_grouped_by_effective_reviewer_and_unknown_is_enlarged(tmp_path,monkeypatch):
    from core.shenhui_shoe_models import ShoeModelState
    row=item(tmp_path);ctx=row['ctx']
    ctx.update(model_state=ShoeModelState(),board_review=True,previews={'a':row['source_path']},ids={'I1':'a'})
    selection={'_sequential_context':ctx,'tmz5':'a','tmz2':'a'}
    rows=[{'规则槽位':slot,'原文件名':'a','本地文件':row['source_path']} for slot in ['tmz5','tmz2']]
    monkeypatch.setattr(direct,'reference',lambda *args:row['source_path'])
    seen=[]
    def audit(items,*args):
        assert len({tuple(r['ctx']['board_page_routes']) for r in items})==1
        seen.extend((r['semantic'],r['ctx']['board_page_routes'],r['ctx']['board_detail']) for r in items)
        return {r['row_id']:{'status':'review_unknown' if r['semantic']=='tmz2' else 'accepted',
            'accepted':r['semantic']!='tmz2','reason':'not clear'} for r in items}
    monkeypatch.setattr(board,'audit_page',audit)
    board.review_style({'10001':(selection,rows)})
    board.review_style({'10001':(selection,rows)})
    assert ('tmz5',ctx['direct_review_routes'],False) in seen
    assert ('tmz2',['gpt-6-astra'],False) in seen
    assert ('tmz2',['gpt-6-astra'],True) in seen
    assert len(seen)==3


def test_approved_anchor_records_are_not_mistaken_for_pending_technical_failures(tmp_path,monkeypatch):
    row=item(tmp_path);ctx=row['ctx']
    ctx.update(board_review=True,previews={'a':row['source_path'],'b':row['source_path']},ids={'I1':'a','I2':'b'})
    selection={'_sequential_context':ctx,'tmz3':'a','yq':['','','b']}
    rows=[{'规则槽位':slot,'原文件名':source,'本地文件':row['source_path']} for slot,source in [('tmz3','a'),('yq3','b')]]
    monkeypatch.setattr(direct,'reference',lambda *args:row['source_path'])
    monkeypatch.setattr(board,'audit_page',lambda items,*args:{r['row_id']:{'status':'accepted','accepted':True,'reason':'correct',
        'response': {'anchor_side_readable': True, 'anchor_side_observation': 'same panel seam visible'}} for r in items})
    rejected,records=board.review_style({'10001':(selection,rows)})['10001']
    assert not rejected and all(r['accepted'] for r in records)
    index=json.loads((tmp_path.parent/'style-review-boards/latest-index.json').read_text())
    assert all(r['verdict']['accepted'] for r in index)


def test_extra_checks_are_ignored_but_required_checks_must_exist(tmp_path):
    row=item(tmp_path);payload=response(row)
    payload['source_checks']['no_floating']=False
    assert board.row_verdict(row,payload)[0]=='accepted'
    payload['source_checks'].pop('single_complete_shoe')
    with pytest.raises(shoe.ShoeSelectionError):board.row_verdict(row,payload)


def test_axis_observation_conflict_preserves_original_for_large_recheck(tmp_path):
    row=item(tmp_path,semantic='tmz3');payload=response(row)
    payload['candidate_facts'].update(toe=[.34,.72],heel=[.69,.24])
    payload['source_checks']['vertical_toe_heel_axis']=False
    payload['source_match']=False
    assert board.row_verdict(row,payload)[0]=='review_unknown'


@pytest.mark.parametrize('second_status', ['accepted', 'export_invalid'])
def test_same_export_rejection_gets_one_detail_review_without_repeating_good_rows(tmp_path, monkeypatch, second_status):
    ctx = item(tmp_path)['ctx']
    ctx.update(board_review=True, previews={'a': str(tmp_path / 'source.jpg')}, ids={'I1': 'a'})
    selection = {'_sequential_context': ctx, 'tmz5': 'a', 'tms': 'a'}
    good, disputed = tmp_path / 'good.jpg', tmp_path / 'disputed.jpg'
    Image.new('RGB', (200, 200), 'white').save(good)
    Image.new('RGB', (200, 200), 'gray').save(disputed)
    rows = [{'规则槽位': slot, '原文件名': 'a', '本地文件': str(path)}
            for slot, path in [('tmz5', good), ('tms', disputed)]]
    monkeypatch.setattr(direct, 'reference', lambda *args: str(tmp_path / 'source.jpg'))
    calls = []
    def audit(items, *args):
        calls.append([(r['export_path'], r['ctx']['board_detail']) for r in items])
        results = {}
        for r in items:
            status = ('accepted' if r['export_path'] == str(good)
                      else 'export_invalid' if len(calls) == 1 else second_status)
            results[r['row_id']] = {'status': status, 'accepted': status == 'accepted',
                                    'reason': 'independent visible export check'}
        return results
    monkeypatch.setattr(board, 'audit_page', audit)
    board.review_style({'10001': (selection, rows)})
    # The fresh row receives its full budget even if the caller has no next
    # repair round. Later invocations reuse both final decisions.
    assert len(calls) == 2
    for _ in range(3):
        board.review_style({'10001': (selection, rows)})
    assert calls == [[(str(good), False), (str(disputed), False)], [(str(disputed), True)]]


@pytest.mark.parametrize('readable', [False, None, 'true'])
def test_unreadable_anchor_never_accepted_even_if_checks_true(tmp_path, readable):
    row = item(tmp_path, semantic='yq3'); payload = response(row)
    payload.update(anchor_side_readable=readable, anchor_side_observation='side panel is obstructed')
    assert board.row_verdict(row, payload)[0] == 'review_unknown'


def test_unknown_anchor_observation_uses_same_budget_and_invalidates_with_anchor_bytes(tmp_path, monkeypatch):
    row = item(tmp_path); ctx = row['ctx']
    anchor = tmp_path / 'anchor.jpg'; Image.new('RGB',(200,200),'gray').save(anchor)
    ctx.update(board_review=True, previews={'a': str(anchor), 'b': row['source_path']}, ids={'I1':'a','I2':'b'})
    selection={'_sequential_context':ctx, 'tmz3':'a', 'yq':['','','b']}
    rows=[{'规则槽位':'yq3','原文件名':'b','本地文件':row['source_path']}]
    monkeypatch.setattr(direct,'reference',lambda *args:row['source_path'])
    calls=[]
    def audit(items,*args):
        calls.extend(r['ctx']['board_detail'] for r in items)
        return {r['row_id']:{'status':'accepted','accepted':True,'reason':'conflicting side checks',
            'response':{'anchor_side_readable':False,'anchor_side_observation':'obstructed'}} for r in items}
    monkeypatch.setattr(board,'audit_page',audit)
    for _ in range(4):
        _,records=board.review_style({'10001':(selection,rows)})['10001']
        assert records[0]['status']=='review_unknown'
    assert calls==[False,True]
    Image.new('RGB',(200,200),'black').save(anchor)
    board.review_style({'10001':(selection,rows)})
    assert calls==[False,True,False,True]


def test_rear_oblique_yq3_cannot_use_horizontal_axis_to_erase_pose_failure(tmp_path):
    row=item(tmp_path,semantic='yq3');payload=response(row)
    payload['source_match']=False
    payload['source_checks']['horizontal_side_view']=False
    payload['candidate_pose']='rear_oblique'
    payload['candidate_facts']['view']='rear_oblique'
    assert board.row_verdict(row,payload)[0]=='source_invalid'


def test_positive_axis_checks_with_opposite_coordinates_do_not_blacklist_source(tmp_path):
    row=item(tmp_path,semantic='tmz3');payload=response(row)
    payload['candidate_facts'].update(toe=[.3,.57],heel=[.7,.43])
    assert board.row_verdict(row,payload)[0]=='review_unknown'
    payload['candidate_pose']='side_horizontal'
    payload['source_checks']['vertical_toe_heel_axis']=False
    payload['source_match']=False
    assert board.row_verdict(row,payload)[0]=='source_invalid'


def test_new_anchor_invalidates_yq3_old_reference_exclusions(tmp_path, monkeypatch):
    ctx=item(tmp_path)['ctx']
    ctx.update(ids={'I1':'old-anchor','I2':'side','I3':'new-anchor'},
        previews=dict.fromkeys(['old-anchor','side','new-anchor'],str(tmp_path/'source.jpg')),
        rejected_candidates={'yq3':['side']})
    selection={'_pending_slots':{'tmz3':'wrong','yq3':'opposite old anchor'},
        '_invalid_sources':['tmz3','yq3'], '_sequential_result':{'selected':{'tmz3':'old-anchor','yq3':'side'}}}
    monkeypatch.setattr(catalog,'candidate_families',lambda c:{k:k for k in c['ids']})
    monkeypatch.setattr(direct,'reference',lambda *args:str(tmp_path/'source.jpg'))
    def retrieve(ctx,model,slot,pool,*args):
        if slot=='tmz3':
            assert 'I1' not in pool
            key='I3'
        else:
            assert ctx['side_anchor']=='new-anchor' and 'I2' in pool
            key='I2'
        return {'accepted':True,'candidate_id':key},SimpleNamespace(model_id=model),[]
    monkeypatch.setattr(direct,'select_inventory',retrieve)
    result=mask.repair_from_board(ctx,selection)
    assert result['selected']['yq3']=='side'
    assert ctx['rejected_candidates']['yq3']==[]
    assert any(r.get('source')=='changed_side_anchor' for r in result['records'])
