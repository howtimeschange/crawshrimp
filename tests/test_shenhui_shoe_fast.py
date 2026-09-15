from types import SimpleNamespace
from unittest.mock import patch
import pytest
from core import shenhui_shoe_fast as f, shenhui_shoe_packaging as s


def fact(slot='yq3', side='outer'):
    return dict(asset_type='shoe',shoe_count='single',pose=slot,background='gray',
        complete=True,side=side,outsole_visible=False,feature_card=False,
        matched_slots=[slot],confidence=.98,pair_layout='na',upright=False,
        lining_visible=False,insole_only=False)


def test_batch_requires_all_ids_and_exact_filename_mapping():
    ids={'I01':'a.jpg','I02':'b.jpg'}
    with pytest.raises(s.ShoeSelectionError):f.validate_batch({'candidates':[dict(candidate_id='I01',filename='a.jpg')]},ids)
    with pytest.raises(s.ShoeSelectionError):f.validate_batch({'candidates':[dict(candidate_id='I01',filename='b.jpg'),dict(candidate_id='I02',filename='a.jpg')]},ids)


def test_final_review_rejects_inner_side_despite_positive_verdict():
    payload={'reviews':[dict(slot='yq3',accepted=True,candidate_id='I01',facts=fact(side='inner'))]}
    good,bad=f.validate_review(payload,{'yq3':['I01']},{'ids':{'I01':'a.jpg'},'category':'运动'})
    assert not good and 'yq3' in bad


def test_final_review_rejects_floating_pair_despite_positive_verdict():
    facts={**fact('tmz1','mixed'),'shoe_count':'pair','pair_layout':'floating_pair'}
    payload={'reviews':[dict(slot='tmz1',accepted=True,candidate_id='I01',facts=facts)]}
    good,bad=f.validate_review(payload,{'tmz1':['I01']},{'ids':{'I01':'a.jpg'},'category':'运动'})
    assert not good and 'tmz1' in bad


def test_final_review_cannot_choose_unshown_image_or_omit_slot():
    ctx={'ids':{'I01':'a.jpg','I02':'b.jpg'},'category':'运动'}
    with pytest.raises(s.ShoeSelectionError):f.validate_review({'reviews':[dict(slot='yq3',accepted=True,candidate_id='I02',facts=fact())]}, {'yq3':['I01']},ctx)
    with pytest.raises(s.ShoeSelectionError):f.validate_review({'reviews':[]},{'yq3':['I01']},ctx)


def test_optional_absence_requires_explicit_review():
    ctx={'ids':{},'category':'运动','yx_full_pool_shown':True}
    assert f.validate_review({'reviews':[dict(slot='yx',accepted=False,absent=True,candidate_id='')]},{'yx':[]},ctx)==({'yx':''},{})
    assert 'yx' in f.validate_review({'reviews':[dict(slot='yx',accepted=False,candidate_id='')]},{'yx':[]},ctx)[1]


def test_final_review_failure_stops_after_one_repair(tmp_path):
    ctx=dict(ids={'I01':'a.jpg'},category='运动',style='123456789012',color='12345',
        reviewers=['gpt-6-astra','gpt-5.6-sol'],primary='deepseek-official-flash',
        log=lambda x:None,batches=[{'image':'page.jpg'}],main_sheet='main.jpg',yq_sheet='yq.jpg',facts=[])
    calls=[]
    def request(ctx,model,prompt,images,phase):
        calls.append((model,phase));return {},SimpleNamespace(model_id=model)
    with patch.object(f,'SLOTS',('yq3',)),patch.object(f,'_options',return_value={'yq3':['I01']}),patch.object(f,'_review_panels',return_value=['panel.jpg']),patch.object(f,'_request',side_effect=request),patch.object(f,'validate_review',return_value=({}, {'yq3':'wrong side'})),patch.object(f,'validate_batch',return_value=[]):
        with pytest.raises(s.ShoeSelectionError,match='未通过'):
            f.verify_selection(ctx,{'wpz':['']*6,'yq':['','','a.jpg']})
    assert calls==[('gpt-6-astra','集中复核1'),('deepseek-official-flash','一次集中补判'),('gpt-6-astra','集中复核2')]


def test_invalid_review_never_reuses_previous_success():
    ctx=dict(ids={'I01':'a.jpg'},category='运动',style='123456789012',color='12345',
        reviewers=['gpt-6-astra'],primary='deepseek-official-flash',log=lambda x:None,
        batches=[{'image':'page.jpg'}],main_sheet='main.jpg',yq_sheet='yq.jpg',facts=[])
    with patch.object(f,'SLOTS',('yq3',)),patch.object(f,'_options',return_value={'yq3':['I01']}),patch.object(f,'_review_panels',return_value=['panel.jpg']),patch.object(f,'_request',return_value=({},SimpleNamespace(model_id='gpt-6-astra'))),patch.object(f,'validate_review',side_effect=[({}, {'yq3':'wrong'}),s.ShoeSelectionError('malformed')]),patch.object(f,'validate_batch',return_value=[]):
        with pytest.raises(s.ShoeSelectionError,match='不可用'):
            f.verify_selection(ctx,{'wpz':['']*6,'yq':['','','a.jpg']})


def test_single_reader_proposals_are_not_overwritten_by_legacy_geometry():
    slots={'tmz5':'standard.jpg','_fast_context':{'pending':True}}
    with patch.object(s,'_apply_selection_quality_rules',side_effect=AssertionError('legacy rewrite')):
        assert s._apply_post_selection_quality_rules('婴童',slots,{}) == (slots,[])


def test_readable_preview_keeps_separated_objects_and_source_unchanged(tmp_path):
    from PIL import Image,ImageDraw
    source=tmp_path/'source.png';im=Image.new('RGB',(800,1000),'white');d=ImageDraw.Draw(im)
    d.rectangle((200,150,300,350),fill='red');d.rectangle((500,650,600,850),fill='blue');im.save(source)
    original=source.read_bytes();target=tmp_path/'preview.jpg';f._readable_preview(source,target)
    with Image.open(target) as out:
        colors=list(out.getdata())
        assert any(r>220 and b<35 for r,g,b in colors)
        assert any(b>220 and r<35 for r,g,b in colors)
        assert out.width<800 and out.height<=1000
    assert source.read_bytes()==original


def test_compact_observation_projects_equivalent_slots_without_a_vote():
    result=f.validate_batch({'candidates':[dict(candidate_id='I01',kind='pair_front_sole',background='gray',confidence=.98)]},{'I01':'a.jpg'})
    assert result[0]['matched_slots']==['tmz2','yq1']
    assert result[0]['pair_layout']=='front_and_sole'
    assert '_model_votes' not in result[0]
    with pytest.raises(s.ShoeSelectionError):
        f.validate_batch({'candidates':[dict(candidate_id='I01',kind='made_up')]},{'I01':'a.jpg'})


def test_compact_final_review_uses_observed_kind_not_requested_slot():
    ctx={'ids':{'I01':'a.jpg'},'category':'运动'}
    row=dict(slot='yq3',candidate_id='I01',observed_kind='single_inner_flat',background='gray',confidence=.99,accepted=True)
    assert 'yq3' in f.validate_review({'reviews':[row]},{'yq3':['I01']},ctx)[1]
    row['observed_kind']='single_outer_flat'
    assert f.validate_review({'reviews':[row]},{'yq3':['I01']},ctx)==({'yq3':'a.jpg'},{})


def test_request_timeout_is_a_style_failure_and_next_style_continues(tmp_path):
    ctx=dict(style='204426146118',color='00319',log=lambda x:None)
    with patch.object(f.gateway,'generate_multimodal_json',side_effect=f.gateway.LlmGatewayError('request timeout')):
        with pytest.raises(s.ShoeSelectionError,match='request timeout'):
            f._request(ctx,'deepseek-official-flash','prompt',[],'repair')
        def prepare(**kwargs):
            if kwargs['data_rows'][0]['输入款号']=='204426146118':
                f._request(ctx,'deepseek-official-flash','prompt',[],'repair')
            return [], {'204426146037':tmp_path/'204426146037'}
        with patch.object(s,'prepare_shoe_packages',side_effect=prepare):
            reports,packages=s.prepare_shoe_packages_skip_failed_styles(data_rows=[{'输入款号':'204426146118'},{'输入款号':'204426146037'}],output_root=tmp_path)
    assert '204426146037' in packages
    assert any(r['输入款号']=='204426146118' and r['下载结果']=='已跳过' for r in reports)


def test_initial_inner_side_final_rear_conflict_requires_enlargement():
    ctx={'ids':{'I12':'GUDO1600.jpg'},'category':'婴童',
        'facts':[f._fact_from_kind('I12','GUDO1600.jpg','single_inner_flat','white',.5)]}
    payload={'reviews':[dict(slot='tmz4',candidate_id='I12',accepted=True,observed_kind='single_rear',background='white',confidence=.91)]}
    good,bad=f.validate_review(payload,{'tmz4':['I12']},ctx)
    assert good=={'tmz4':'GUDO1600.jpg'} and not bad
    assert 'tmz4' in f.review_conflicts(payload,good,ctx)


def test_low_confidence_agreement_is_not_independent_evidence():
    ctx={'ids':{'I19':'yk1.jpg'},'category':'婴童',
        'facts':[f._fact_from_kind('I19','yk1.jpg','single_upright_outer','white',.6)]}
    payload={'reviews':[dict(slot='tmz3',candidate_id='I19',observed_kind='single_upright_outer',background='white',confidence=.7)]}
    assert 'tmz3' in f.review_conflicts(payload,{'tmz3':'yk1.jpg'},ctx)


def test_card_absence_is_rechecked_even_when_initial_calls_it_other():
    payload={'reviews':[dict(slot='yx',candidate_id='',accepted=False,absent=True)]}
    assert 'yx' in f.review_conflicts(payload,{'yx':''},{'facts':[]})


def test_enlarged_review_rejects_inner_despite_target_slot(tmp_path):
    ctx=dict(style='s',color='c',category='婴童',ids={'I12':'inner.jpg'},root=str(tmp_path),
        main_refs=['ref.jpg']*5,yq_refs={},previews={'inner.jpg':'large.jpg'})
    observation=dict(candidate_id='I12',evidence='鞋身水平且只能看见内侧',facts=fact('tmz4','inner'))
    with patch.object(f,'_options',return_value={'tmz4':['I12']}),patch.object(f,'_request',return_value=({'candidates':[observation]},SimpleNamespace(model_id='review'))):
        good,bad,evidence=f._enlarged_review(ctx,{}, {'tmz4':'inner.jpg'}, {'tmz4':'conflict'}, 'review')
    assert not good and 'tmz4' in bad
    assert evidence[0]['request']['image_inputs']==['ref.jpg','large.jpg']


def test_card_absence_requires_full_coverage_and_accepts_partial_occlusion(tmp_path):
    ctx=dict(style='s',color='c',ids={'I01':'card.jpg','I02':'shoe.jpg'},root=str(tmp_path),
        previews={'card.jpg':'large-card.jpg','shoe.jpg':'large-shoe.jpg'})
    response={'candidates':[dict(candidate_id='I01',shoe_present=True,function_card_present=True,confidence=.95,evidence='卡片后方可见鞋头鞋跟'),
        dict(candidate_id='I02',shoe_present=True,function_card_present=False,confidence=.95,evidence='单鞋无遮挡')]}
    with patch.object(s,'_create_contact_sheet'),patch.object(f,'_request',return_value=(response,SimpleNamespace(model_id='review'))):
        assert f._review_card_absence(ctx,'review','absence')[1]=='card.jpg'
    response['candidates'].pop()
    with patch.object(s,'_create_contact_sheet'),patch.object(f,'_request',return_value=(response,SimpleNamespace(model_id='review'))):
        assert f._review_card_absence(ctx,'review','absence')[1] is None


def test_unresolved_enlargement_cannot_be_erased_by_another_initial_pass():
    ctx=dict(ids={'I01':'a.jpg'},category='运动',style='s',color='c',reviewers=['review'],primary='primary',
        log=lambda x:None,batches=[{'image':'page.jpg'}],facts=[])
    calls=[]
    def request(*args):calls.append(args[-1]);return {},SimpleNamespace(model_id='review')
    with patch.object(f,'SLOTS',('yq3',)),patch.object(f,'_options',return_value={'yq3':['I01']}),patch.object(f,'_review_panels',return_value=['panel.jpg']),patch.object(f,'_request',side_effect=request),patch.object(f,'validate_review',return_value=({'yq3':'a.jpg'},{})),patch.object(f,'review_conflicts',return_value={'yq3':'conflict'}),patch.object(f,'_enlarged_review',return_value=({}, {'yq3':'uncertain'}, [])):
        with pytest.raises(s.ShoeSelectionError,match='未通过'):f.verify_selection(ctx,{'wpz':['']*6,'yq':['','','a.jpg']})
    assert calls==['集中复核1']


def test_upright_claim_cannot_overrule_horizontal_toe_heel_positions(tmp_path):
    from PIL import Image
    path=tmp_path/'wide.jpg';Image.new('RGB',(1000,500),'white').save(path)
    assert not f._vertical_landmarks({'upright':True,'toe_center':[.1,.5],'heel_center':[.9,.5]},path)
    assert not f._vertical_landmarks({'upright':True,'toe_center':[.1,.2],'heel_center':[.5,.8]},path)
    assert f._vertical_landmarks({'upright':True,'toe_center':[.5,.1],'heel_center':[.55,.9]},path)
    assert not f._vertical_landmarks({'upright':True,'toe_center':None,'heel_center':[.5,.9]},path)


def test_image_position_reply_resolves_only_through_complete_shown_map():
    mapping={'2':'I12','3':'I24'}
    raw={'candidates':[{'candidate_id':'2'},{'candidate_id':'3'}]}
    assert f._normalize_image_ids(raw,mapping)=={'candidates':[{'candidate_id':'I12'},{'candidate_id':'I24'}]}
    assert raw['candidates'][0]['candidate_id']=='2'
    for ids in [('1','2'),('2','2'),('2','I24'),('2',)]:
        payload={'candidates':[{'candidate_id':k} for k in ids]}
        assert f._normalize_image_ids(payload,mapping)==payload


def test_card_template_stays_within_gateway_limit_at_full_pool(tmp_path,monkeypatch):
    from types import SimpleNamespace
    keys={f'I{i:02}':f'{i}.jpg' for i in range(40)}
    ctx={'root':str(tmp_path),'color':'C','ids':keys,'previews':{n:'source.jpg' for n in keys.values()}}
    monkeypatch.setattr(f._shoe(),'_create_contact_sheet',lambda *a,**k:None)
    def request(c,reviewer,prompt,images,phase):
        assert len(images)<=f._shoe().SHOE_MULTIMODAL_IMAGE_INPUT_LIMIT
        assert images[0]==str(f._shoe().SHOE_YX_REFERENCE_IMAGE)
        assert '不可选' in prompt
        return {'candidates':[dict(candidate_id=k,shoe_present=True,function_card_present=False,confidence=.9,evidence='无卡') for k in keys]},SimpleNamespace(model_id='test')
    monkeypatch.setattr(f,'_request',request)
    assert f._review_card_absence(ctx,'test','missing')[1]==''


def test_readable_preview_crops_native_subject_before_downsampling(tmp_path):
    from PIL import Image,ImageDraw
    source=tmp_path/'large.png'
    im=Image.new('RGB',(4000,4000),'white')
    ImageDraw.Draw(im).rectangle((1800,1800,2200,2200),fill='red')
    im.save(source);original=source.read_bytes()
    target=tmp_path/'preview.jpg';f._readable_preview(source,target)
    with Image.open(target) as out:
        assert 400 <= out.width <= 1000
        assert 400 <= out.height <= 1000
        assert out.getpixel((out.width//2,out.height//2))[0]>220
    assert source.read_bytes()==original
