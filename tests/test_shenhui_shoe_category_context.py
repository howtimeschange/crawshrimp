import json
from pathlib import Path
from types import SimpleNamespace
from PIL import Image
import pytest
from core import shenhui_shoe_packaging as original




def setup(shoe,tmp_path,monkeypatch,names):
    source=tmp_path/'box.jpg';Image.new('RGB',(100,100),'white').save(source)
    route=SimpleNamespace(model_id='official');verified=[];inferred=[]
    monkeypatch.setattr(shoe,'_create_contact_sheets',lambda *a:([source],{'I1':'box.jpg'}))
    def request(**kwargs):
        return ({'candidate_ids':['I1']} if 'candidate_ids' in kwargs['user_prompt'] else {'label_bbox':[0,0,1000,1000],'style_code_bbox':[100,100,800,200]}),route
    monkeypatch.setattr(shoe,'_label_model_request',request)
    def verify(payload,**kwargs):
        color=kwargs['color_code'];verified.append(color)
        return {**payload,'style_code':kwargs['style_code'],'color_code':color,'product_name':names[color],
                'color_name':color,'_label_identity_verified':True,
                '_label_category':shoe._category_from_label_product_name(names[color])}
    monkeypatch.setattr(shoe,'_verify_label_identity_from_crop',verify)
    monkeypatch.setattr(shoe,'_create_contact_sheet',lambda *a,**kw:None)
    monkeypatch.setattr(shoe,'_create_tmq_asset',lambda **kw:source)
    def infer(payload,**kwargs):inferred.append(kwargs['color_code']);return '运动'
    monkeypatch.setattr(shoe,'_infer_category_from_verified_label',infer)
    def run(color,context,forced=''):
        return shoe._prepare_label_before_pose(entries=[{'filename':'box.jpg','path':source}],analysis_root=tmp_path,
            style_code='208426141006',color_code=color,model_id='official',label_model_id='official',
            fallback_model_ids=[],label_fallback_model_ids=[],config=None,log=lambda _:None,
            category_context=context,shoe_category=forced)
    return run,verified,inferred


def test_same_name_reuses_category_only_after_each_color_label_verified(tmp_path,monkeypatch):
    shoe=original;run,verified,inferred=setup(shoe,tmp_path,monkeypatch,{'50901':'儿童时尚生活鞋','90001':'儿童时尚生活鞋'})
    context={};first=run('50901',context);second=run('90001',context)
    assert verified==['50901','90001'] and inferred==['50901']
    assert first['payload']['_label_category']==second['payload']['_label_category']=='运动'
    assert second['payload']['color_code']=='90001'
    assert second['payload']['_label_category_reference_color']=='50901'


def test_explicit_different_name_conflict_preserves_label_evidence(tmp_path,monkeypatch):
    shoe=original;run,verified,inferred=setup(shoe,tmp_path,monkeypatch,{'50901':'儿童板鞋','90001':'儿童皮鞋'})
    context={};run('50901',context);second=run('90001',context)
    assert second['payload']['_label_category_conflict']
    assert second['payload']['product_name']=='儿童皮鞋'
    assert context['category']=='运动'
    saved=json.loads((tmp_path/'208426141006/90001-label-first.json').read_text())
    assert saved['payload']['_label_category_conflict']
    assert not inferred and verified==['50901','90001']


def test_excel_override_keeps_precedence_and_still_verifies_every_label(tmp_path,monkeypatch):
    shoe=original;run,verified,inferred=setup(shoe,tmp_path,monkeypatch,{'50901':'儿童时尚生活鞋','90001':'儿童时尚生活鞋'})
    context={};run('50901',context,'休闲');run('90001',context,'休闲')
    assert not context and not inferred and verified==['50901','90001']


def test_failed_color_retry_receives_previously_verified_style_category(tmp_path,monkeypatch):
    shoe=original
    source=tmp_path/'208426141006-90001.jpg';Image.new('RGB',(100,100),'white').save(source)
    monkeypatch.setattr(shoe,'_create_model_input_preview',lambda path,*a:path)
    monkeypatch.setattr(shoe,'_create_main_pose_reference_cells',lambda *a:{'运动':[source]*5})
    monkeypatch.setattr(shoe,'_create_main_pose_reference_sheet',lambda *a:source)
    monkeypatch.setattr(shoe,'_create_yq_reference_cells',lambda *a:{'yq2':source,'yq3':source})
    previous={'style_code':'208426141006','color_code':'50901',
              'product_name':'儿童时尚生活鞋','category':'运动'}
    cache={('208426141006','50901'):{'category_context':previous}}
    received=[]
    def label(**kwargs):
        received.append(kwargs['category_context'])
        raise RuntimeError('stop before paid model calls')
    monkeypatch.setattr(shoe,'_prepare_label_before_pose',label)
    with pytest.raises(RuntimeError,match='stop before paid'):
        shoe.prepare_shoe_packages(data_rows=[{'下载结果':'已下载','本地文件':str(source),
            '输入款号':'208426141006','颜色':'90001','原文件名':source.name}],
            output_root=tmp_path/'out',pose_strategy='sequential_templates',
            _prepared_colors=cache,_reuse_prepared=True,
            reference_image=source,poster_reference_image=source,yq_reference_image=source)
    assert received==[previous]
    assert received[0] is not previous
