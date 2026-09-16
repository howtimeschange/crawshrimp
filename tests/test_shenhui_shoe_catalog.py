import json
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from PIL import Image
import pytest
from core import shenhui_shoe_catalog as catalog, shenhui_shoe_models as models
from core import shenhui_shoe_template_match as direct, shenhui_shoe_packaging as shoe
from core import shenhui_shoe_quality as quality


def fact(key='I1'):
    return {'candidate_id':key,'kind':'single_rear','complete':True,'shoe_count':1,
            'side_zipper':False,'evidence':'heel faces camera','facts':{
            'background_kind':'plain_gray','independent_cards':False,'toe':[.2,.4],'heel':[.8,.6],
            'near_end':'heel','heel_back_visible':True,'view':'rear_oblique',
            'outsole_tread_visible':False,'upper_side_visible':True,'lining_visible':False}}


def context(tmp_path):
    image=tmp_path/'source.png';Image.new('RGB',(80,80),'white').save(image)
    return {'root':str(tmp_path),'style':'123456789012','color':'90001','category':'休闲',
            'ids':{'I1':'source.png'},'previews':{'source.png':str(image)},
            'entries':{},'routes':['deepseek-official-flash'],'log':lambda _:None}


def test_observations_reused_by_bytes_and_invalidated_by_changed_input(tmp_path,monkeypatch):
    ctx=context(tmp_path);calls=[]
    monkeypatch.setattr(catalog,'PROMPT','stable fact prompt')
    monkeypatch.setattr(models.gateway,
                        'route_for_model',lambda *a:SimpleNamespace(model_id='flash',base_url='https://route.test'))
    def request(*a):calls.append(1);return {'candidates':[fact()]},SimpleNamespace(model_id='flash')
    monkeypatch.setattr(direct.fast,'_request',request)
    assert catalog.observe(ctx)['I1']['kind']=='single_rear'
    catalog.observe(ctx);assert len(calls)==1
    Image.new('RGB',(80,80),'gray').save(ctx['previews']['source.png'])
    catalog.observe(ctx);assert len(calls)==2
    monkeypatch.setattr(catalog,'PROMPT','changed policy');catalog.observe(ctx);assert len(calls)==3


def test_unknown_observations_are_not_cached_as_missing_sources(tmp_path,monkeypatch):
    ctx=context(tmp_path)
    monkeypatch.setattr(direct.fast,'_request',lambda *a:(_ for _ in ()).throw(shoe.ShoeSelectionError('HTTP 503')))
    assert catalog.observe(ctx)=={}
    assert ctx['observation_errors']['I1']=='HTTP 503'
    assert not list((tmp_path/'candidate-catalog').glob('[0-9a-f]'*64+'.json'))


def test_shortlist_deferred_images_are_observed_only_when_pool_expands(tmp_path, monkeypatch):
    ctx=context(tmp_path)
    second=tmp_path/'second.png';Image.new('RGB',(80,80),'gray').save(second)
    ctx['ids']['I2']='second.png';ctx['previews']['second.png']=str(second)
    calls=[]
    def request(context, model, prompt, images, phase):
        key='I2' if images[0]==str(second) else 'I1'
        calls.append(key)
        return {'candidates':[dict(fact(),candidate_id=key)]},SimpleNamespace(model_id='flash')
    monkeypatch.setattr(direct.fast,'_request',request)
    assert set(catalog.observe(ctx,keys=['I1'])) == {'I1'}
    assert ctx['deferred_observation_ids']==['I2'] and not ctx['observation_errors']
    assert set(catalog.observe(ctx))=={'I1','I2'}
    assert calls==['I1','I2'] and not ctx['deferred_observation_ids']
    Image.new('RGB',(80,80),'red').save(second)
    monkeypatch.setattr(direct.fast,'_request',lambda *a:(_ for _ in ()).throw(shoe.ShoeSelectionError('HTTP 503')))
    assert set(catalog.observe(ctx))=={'I1'}
    assert 'I2' in ctx['observation_errors']


def test_whole_assignment_avoids_greedy_starvation_and_retains_all_candidates():
    options={'tmz1':[('shared',20),('alternative',10)],'tmz2':[('shared',10)]}
    selected=catalog.assign(options,{'shared':'a','alternative':'b'})
    assert selected=={'tmz2':'shared','tmz1':'alternative'}
    options={'tmz1':[(str(i),10-i) for i in range(8)],'tmz2':[('0',100)]}
    assert catalog.assign(options,{str(i):str(i) for i in range(8)})['tmz1']=='1'


def test_assignment_respects_family_lock_and_same_side_dependency():
    options={'tmz3':[('outer',10)],'yq3':[('inner',20),('outerflat',10)]}
    observations={'outer':{'side_zipper':False},'inner':{'side_zipper':True},'outerflat':{'side_zipper':False}}
    assert catalog.assign(options,{k:k for k in observations},observations=observations)['yq3']=='outerflat'
    assert catalog.assign({'tmz4':[('copy',10)]},{'original':'same','copy':'same'},locked={'tmz3':'original'})['tmz4']==''


def test_verified_side_locks_survive_conflicting_old_observations():
    locked = {'tmz3': 'upright', 'yq3': 'horizontal'}
    observations = {'upright': {'side_zipper': False}, 'horizontal': {'side_zipper': True}}
    selected = catalog.assign({'tmz1': [('pair', 10)], 'tmz4': []},
                              {key: key for key in ('upright', 'horizontal', 'pair')},
                              locked=locked, observations=observations)
    assert selected == {**locked, 'tmz1': 'pair', 'tmz4': ''}


def test_fact_rules_do_not_confuse_vertical_boot_height_and_rear(tmp_path):
    ctx=context(tmp_path);row=fact();row['kind']='single_upright_outer'
    row['facts'].update(view='side',near_end='neither',heel_back_visible=False)
    options=catalog.options(ctx,{'I1':row})
    assert not options['tmz3'] and not options['tmz4']
    assert options['yq3']


def test_uncertain_uniform_background_remains_proposal_but_not_approved(tmp_path):
    ctx=context(tmp_path);row=fact();row.update(kind='pair_front_sole',shoe_count=2)
    row['facts'].update(outsole_tread_visible=True,upper_side_visible=True)
    row['facts']['background_kind']='studio_gradient'
    assert catalog.options(ctx,{'I1':row})['tmz2']
    assert direct.visual_fact_failures('tmz2',row['facts'],(80,80),'休闲')
    row['facts']['background_kind']='scene'
    assert not catalog.options(ctx,{'I1':row})['tmz2']


def test_full_outsole_ranks_above_oblique_shoe_with_visible_upper(tmp_path):
    ctx=context(tmp_path);ctx['ids']['I2']='second.png';ctx['previews']['second.png']=ctx['previews']['source.png']
    tilted=fact();tilted['kind']='outsole_flat';tilted['facts'].update(view='bottom',upper_side_visible=True,outsole_tread_visible=True)
    flat=json.loads(json.dumps(tilted));flat['facts']['upper_side_visible']=False
    assert catalog.options(ctx,{'I1':tilted,'I2':flat})['yq2'][0][0]=='I2'


def test_gray_source_policy_uses_pixels_despite_white_model_label(tmp_path,monkeypatch):
    ctx=context(tmp_path);row=fact();row['facts']['background_kind']='plain_white'
    ctx['candidate_observations']={'I1':row}
    monkeypatch.setattr(catalog,'options',lambda *a:{slot:([('I1',10)] if slot=='tmz5' else []) for slot in catalog.INDEPENDENT})
    monkeypatch.setattr(catalog,'candidate_families',lambda *a:{'I1':'family'})
    monkeypatch.setattr(direct.fast,'_gray_mates',lambda *a:[])
    monkeypatch.setattr(shoe,'_binary_pose_feature',lambda *a:SimpleNamespace(background_luma=242))
    catalog.propose(ctx)
    assert ctx['gray_standard'] is True


def test_thirteen_styles_really_run_eight_at_once(tmp_path,monkeypatch):
    active=0;peak=0;entered=set();lock=threading.Lock();first_eight=threading.Event()
    styles=[str(100000000000+i) for i in range(13)]
    def prepare(**kw):
        nonlocal active,peak
        style=kw['data_rows'][0]['输入款号']
        with lock:
            active+=1;peak=max(peak,active);entered.add(style)
            if active==8:first_eight.set()
        assert first_eight.wait(timeout=3),'13 styles were serialized before eight could start'
        with lock:active-=1
        return [{'输入款号':style}],{style:tmp_path/style}
    monkeypatch.setattr(shoe,'prepare_shoe_packages',prepare)
    reports,packages=shoe.prepare_shoe_packages_skip_failed_styles(
        data_rows=[{'输入款号':style} for style in styles],output_root=tmp_path,
        pose_strategy='sequential_templates',request_workers=8)
    assert peak==8 and entered==set(styles) and len(packages)==13


def test_real_inventory_path_with_repair_flag_never_calls_reviewer(tmp_path,monkeypatch):
    ctx=context(tmp_path);ctx['repair_only']=True
    monkeypatch.setattr(shoe,'_create_contact_sheet',lambda *a,**kw:None)
    monkeypatch.setattr(direct.fast,'_request',lambda *a:({'accepted':True,'candidate_id':'I1'},SimpleNamespace(model_id='flash')))
    monkeypatch.setattr(direct,'audit',lambda *a:pytest.fail('nested repair review'))
    payload,_,_=direct.select_inventory(ctx,'flash','tmz4',['I1'],False,[])
    assert payload['candidate_id']=='I1'


def test_global_shared_request_bound_applies_across_thread_pools(monkeypatch):
    state=models.ShoeModelState(request_workers=2);barrier=threading.Barrier(2);active=0;peak=0;lock=threading.Lock()
    monkeypatch.setattr(models.gateway,'route_for_model',lambda *a:SimpleNamespace(model_id='flash',base_url='https://test'))
    def generate(**kw):
        nonlocal active,peak
        with lock:active+=1;peak=max(peak,active)
        barrier.wait(timeout=2)
        with lock:active-=1
        return {},SimpleNamespace(model_id='flash')
    monkeypatch.setattr(models.gateway,'generate_multimodal_json',generate)
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda _:models.generate_json(models=['flash'],state=state),range(6)))
    assert peak==2


def test_quality_metrics_keep_unknown_and_missing_in_denominators():
    rows=[{'truth':True,'accepted':True,'delivered':True,'visual_verdict':'correct'},
          {'truth':False,'accepted':True,'delivered':True,'visual_verdict':'wrong'},
          {'truth':True,'accepted':False,'status':'review_unknown'},
          {'truth':True,'accepted':False,'status':'source_invalid'}]
    result=quality.summarize(rows,expected_outputs=4)
    assert result['false_accepts']==1 and result['false_rejects']==1 and result['unknown_cases']==1
    assert result['delivered_accuracy']==.5 and result['correct_coverage']==.25


def test_mask_proposal_survives_wrong_bottom_observation(tmp_path):
    ctx=context(tmp_path);row=fact()
    row.update(kind='outsole_flat',shoe_count=0)
    row['facts'].update(view='bottom',upper_side_visible=False,outsole_tread_visible=True)
    assert not catalog.options(ctx,{'I1':row})['tmz3']
    ctx['mask_plan']={'by_slot':{'tmz3':{'ranked':[
        {'candidate_id':'I1','score':.92,'mask_valid':True}]}}}
    assert catalog.options(ctx,{'I1':row})['tmz3'][0][0]=='I1'
    assert direct.visual_fact_failures('tmz3',row['facts'],(80,80),'休闲')
    ctx['mask_plan']['by_slot']['tmz3']['ranked'][0]['mask_valid']=False
    assert not catalog.options(ctx,{'I1':row})['tmz3']


def test_mask_proposals_obey_reserved_standard_and_rejected_sources(tmp_path,monkeypatch):
    ctx=context(tmp_path);row=fact()
    ctx['mask_plan']={'by_slot':{'tmz4':{'ranked':[
        {'candidate_id':'I1','score':.95,'mask_valid':True}]}}}
    monkeypatch.setattr(shoe,'_is_tms_source_filename',lambda *a:True)
    monkeypatch.setattr(direct.fast,'_gray_mates',lambda *a:[])
    choices=catalog.options(ctx,{'I1':row})
    assert choices['tmz5'] and not choices['tmz4']
    monkeypatch.setattr(shoe,'_is_tms_source_filename',lambda *a:False)
    ctx.update(candidate_observations={'I1':row},rejected_candidates={'tmz4':['source.png']})
    result=catalog.propose(ctx)
    assert not result['selected']['tmz4']
    assert not any(r.get('accepted') for r in result['records'])
