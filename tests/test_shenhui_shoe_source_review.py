from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from types import SimpleNamespace
import threading

import pytest
from PIL import Image
from core import shenhui_shoe_source_review as source, shenhui_shoe_board_review as board
from core import shenhui_shoe_models as models, shenhui_shoe_fast as fast


def facts(**changes):
    return dict(id='S1', description='观察原图', shoe_count=1, view='side', foot_axis='vertical',
        outsole_face='none', pair_arrangement='not_pair', lining_closeup=False,
        independent_function_card=False, **changes)


def row(tmp_path, slot='tmz3'):
    path=tmp_path/'source.jpg'
    if not path.exists(): Image.new('RGB',(1600,1600),'white').save(path)
    return {'row_id':'secret-template-slot', 'source_path':str(path), 'semantic':slot, 'category':'雪地',
        'ctx':{'style':'123456789012','color':'10001','routes':['deepseek-official-flash'],
        'model_state':models.ShoeModelState(), 'log':lambda _:None}}


@pytest.mark.parametrize('slot,changes,status', [
    ('tmz2', {'shoe_count':2,'pair_arrangement':'floating'},'source_invalid'),
    ('tmz2', {'shoe_count':2,'outsole_face':'full','pair_arrangement':'one_sole_facing_camera'},'consistent'),
    ('tmz2', {'shoe_count':2,'outsole_face':'full','pair_arrangement':'floating'},'source_invalid'),
    ('tmz3', {'view':'top'},'source_invalid'),
    ('tmz3', {'view':'front_oblique'},'source_invalid'),
    ('tmz3', {'foot_axis':'diagonal'},'consistent'),
    ('tmz3', {'view':'unclear'},'review_unknown'),
    ('yq3', {'view':'front_oblique'},'source_invalid'),
    ('tmz4', {},'source_invalid'),
    ('tmz4', {'lining_closeup':True},'consistent'),
    ('yx', {'independent_function_card':True},'consistent'),
    ('yq2', {'outsole_face':'unclear'},'review_unknown'),
])
def test_coarse_observations_retain_good_views_and_reject_contradictions(tmp_path,slot,changes,status):
    observation=facts();observation.update(changes)
    assert source.assess(row(tmp_path,slot),observation)[0]==status


def test_single_source_only_and_concurrent_alias_cache(tmp_path,monkeypatch):
    item=row(tmp_path);calls=[];entered=threading.Event();release=threading.Event()
    def request(ctx,model,prompt,images,phase):
        calls.append(model);entered.set();assert release.wait(2)
        assert len(images)==1
        assert 'secret-template-slot' not in prompt and '123456789012' not in prompt
        assert 'SOURCE' not in prompt and 'EXPORT' not in prompt
        with Image.open(images[0]) as image: assert image.size==(1200,1200)
        assert ctx['request_purpose']=='source_fact_guard'
        return {'images':[facts()]},SimpleNamespace(model_id=model)
    monkeypatch.setattr(fast,'_request',request)
    with ThreadPoolExecutor(max_workers=2) as executor:
        first=executor.submit(source.observe,item,tmp_path)
        assert entered.wait(2)
        second=executor.submit(source.observe,{**item,'row_id':'alias'},tmp_path)
        release.set();a,b=first.result(),second.result()
    assert calls==['deepseek-official-flash']
    assert a['observation']==b['observation']
    assert source.observe(item,tmp_path)['reused_source_observation']
    Image.new('RGB',(1600,1600),'black').save(item['source_path'])
    source.observe(item,tmp_path)
    assert len(calls)==2


def test_malformed_observation_unknown_and_retryable(tmp_path,monkeypatch):
    item=row(tmp_path);calls=[]
    def request(*args):
        calls.append(1)
        return ({'images':[]} if len(calls)==1 else {'images':[facts()]}),SimpleNamespace(model_id='x')
    monkeypatch.setattr(fast,'_request',request)
    result={item['row_id']:{'accepted':True,'status':'accepted'}}
    source.guard_accepted([item],result,tmp_path)
    assert result[item['row_id']]['status']=='review_unknown'
    assert source.observe(item,tmp_path)['observation']['view']=='side'
    assert len(calls)==2


def test_board_true_cannot_override_blind_negative(tmp_path,monkeypatch):
    item=row(tmp_path,'tmz2');item.update(style='123456789012',color='10001',source_id='I1',
        slots=['tmz2'],template=item['source_path'],export_path=item['source_path'],
        source_size=(1600,1600),perimeter=None,required_checks=board.sequence.contract('tmz2','雪地'))
    payload={'row_id':item['row_id'],'candidate_observation':'两鞋带外底','template_observation':'双鞋',
        'candidate_shoe_count':2,'template_shoe_count':2,'candidate_pose':'pair_front_sole',
        'source_checks':dict.fromkeys(item['required_checks'],True),'source_match':True,'export_match':True,
        'reason':'通过','candidate_facts':{'background_kind':'plain_white','independent_cards':False,
        'view':'front_oblique','outsole_tread_visible':True,'upper_side_visible':True}}
    calls=[]
    def request(ctx,*args):
        calls.append(ctx['request_purpose'])
        observed=facts();observed.update(shoe_count=2,view='front_oblique',pair_arrangement='floating')
        return ({'images':[observed]} if ctx['request_purpose']=='source_fact_guard' else {'rows':[payload]}),SimpleNamespace(model_id='test')
    monkeypatch.setattr(fast,'_request',request)
    result=board.audit_page([item],tmp_path,'page')
    assert result[item['row_id']]['status']=='source_invalid'
    assert calls==['board_review','source_fact_guard']


def test_no_guard_calls_for_rejected_or_auxiliary(tmp_path,monkeypatch):
    a=row(tmp_path);b={**a,'row_id':'aux','semantic':'tmz5'}
    results={a['row_id']:{'accepted':False,'status':'source_invalid'},'aux':{'accepted':True,'status':'accepted'}}
    monkeypatch.setattr(source,'observe',lambda *args:pytest.fail('not an accepted pose'))
    source.guard_accepted([a,b],results,tmp_path)


def test_guard_effort_is_scoped_to_official_selected_source():
    m={'stage':'export_review','request_purpose':'source_fact_guard'}
    assert models.reasoning_effort_for('deepseek-official-flash',m)=='high'
    assert models.reasoning_effort_for('gpt-6-astra',m)=='low'
    assert models.reasoning_effort_for('deepseek-official-flash',{'stage':'export_review'})=='low'


def test_malformed_enum_is_validation_error_not_unhandled_typeerror():
    data=facts();data['view']=[]
    with pytest.raises(ValueError,match='事实缺失'):
        source.validate({'images':[data]})


@pytest.mark.parametrize('sole', ['partial', 'none'])
def test_full_sole_arrangement_conflicting_with_sole_fact_is_unknown(tmp_path, monkeypatch, sole):
    item=row(tmp_path,'tmz2')
    observed=facts(); observed.update(shoe_count=2, pair_arrangement='one_sole_facing_camera', outsole_face=sole)
    monkeypatch.setattr(fast,'_request',lambda *args:({'images':[observed]},SimpleNamespace(model_id='test')))
    result=source.observe(item,tmp_path)
    assert 'error' in result
    assert not item['ctx']['model_state'].source_review_cache


def test_blind_observation_corroborates_failed_check_but_never_approves_unknown(tmp_path,monkeypatch):
    item=row(tmp_path,'tmz4');item['category']='休闲'
    monkeypatch.setattr(source,'observe',lambda *args:{'observation':facts()})
    result={item['row_id']:{'accepted':False,'status':'review_unknown',
        'response':{'source_match':True,'source_checks':{'heel_back_visible':False}}}}
    source.guard_accepted([item],result,tmp_path)
    assert result[item['row_id']]['status']=='source_invalid'
    item['semantic']='tmz3'
    result[item['row_id']].update(status='review_unknown',accepted=False)
    source.guard_accepted([item],result,tmp_path)
    assert result[item['row_id']]['status']=='review_unknown'


def test_sole_pair_conflicting_floating_judgment_keeps_source(tmp_path,monkeypatch):
    item=row(tmp_path,'tmz2')
    observed=facts();observed.update(shoe_count=2,outsole_face='full',pair_arrangement='one_sole_facing_camera')
    monkeypatch.setattr(source,'observe',lambda *args:{'observation':observed})
    result={item['row_id']:{'accepted':False,'status':'source_invalid',
        'response':{'source_match':False,'source_checks':{
            'two_complete_shoes':True,'rear_outsole_complete':True,'no_floating':False}}}}
    source.guard_accepted([item],result,tmp_path)
    assert result[item['row_id']]['status']=='review_unknown'
    assert not result[item['row_id']]['accepted']


def test_export_invalid_still_needs_source_fact_check(tmp_path,monkeypatch):
    item=row(tmp_path,'tmz3')
    observed=facts()
    monkeypatch.setattr(source,'observe',lambda *args:{'observation':observed})
    result={item['row_id']:{'accepted':False,'status':'export_invalid'}}
    source.guard_accepted([item],result,tmp_path)
    assert result[item['row_id']]['status']=='export_invalid'
    assert 'source_observation' in result[item['row_id']]
    observed['view']='front_oblique'
    source.guard_accepted([item],result,tmp_path)
    assert result[item['row_id']]['status']=='source_invalid'


def test_reconsideration_revision_requires_fresh_blind_observation(tmp_path, monkeypatch):
    item = row(tmp_path)
    calls = []
    def request(*args):
        calls.append(1)
        return {'images': [facts()]}, SimpleNamespace(model_id='test')
    monkeypatch.setattr(fast, '_request', request)
    source.observe(item, tmp_path)
    source.observe(item, tmp_path)
    source.observe({**item, 'source_review_revision': 1}, tmp_path)
    assert len(calls) == 2


def test_axis_only_rejection_is_rechecked_when_blind_axis_disagrees(tmp_path, monkeypatch):
    item = row(tmp_path)
    monkeypatch.setattr(source, 'observe', lambda *args: {'observation': facts()})
    results = {item['row_id']: {'status': 'source_invalid', 'accepted': False,
        'response': {'source_checks': {'single_complete_shoe': True, 'outer_side_visible': True,
                                     'vertical_toe_heel_axis': False}}}}
    source.guard_accepted([item], results, tmp_path)
    assert results[item['row_id']]['status'] == 'review_unknown'
    assert not results[item['row_id']]['accepted']
