import json
from pathlib import Path
from PIL import Image
from core import shenhui_shoe_final_review as final
from core import shenhui_shoe_template_match as direct


def fixture(tmp_path):
    original = tmp_path/'source.jpg'
    exported = tmp_path/'export.jpg'
    template = tmp_path/'template.jpg'
    for p in (original,exported,template):
        Image.new('RGB',(100,100),'white').save(p)
    ctx = dict(root=str(tmp_path),style='123456789012',category='休闲',
               previews={'source.jpg':str(original)}, ids={'I1':'source.jpg'})
    selection = {'_sequential_context':ctx,'tmz4':'source.jpg'}
    rows = [{'规则槽位':'tmz4','原文件名':'source.jpg','本地文件':str(exported)}]
    return selection, rows, template


def test_actual_export_is_audited_and_changed_bytes_invalidate_cache(monkeypatch,tmp_path):
    selection, rows, template = fixture(tmp_path)
    monkeypatch.setattr(direct,'reference',lambda *a:str(template))
    calls=[]
    def audit(ctx,result,targets):
        calls.append(ctx)
        assert ctx['reuse_inventory_reviews'] is False
        assert ctx['export_original'] == str(tmp_path/'source.jpg')
        assert ctx['previews']['source.jpg'] == ctx['export_original']
        assert len(ctx['export_images']) == 1
        assert ctx['export_images'][0] != ctx['export_original']
        return {'rejected':{},'approved':['tmz4']}
    monkeypatch.setattr(direct,'audit',audit)
    assert final.review_exports(selection,rows)[0] == {}
    assert final.review_exports(selection,rows)[0] == {}
    assert len(calls)==1
    Image.new('RGB',(100,100),'gray').save(tmp_path/'export.jpg')
    final.review_exports(selection,rows)
    assert len(calls)==2


def test_export_rejection_is_returned_despite_prior_acceptance(monkeypatch,tmp_path):
    selection, rows, template = fixture(tmp_path)
    selection['_sequential_audits']=[{'approved':['tmz4']}]
    monkeypatch.setattr(direct,'reference',lambda *a:str(template))
    monkeypatch.setattr(direct,'audit',lambda *a:{'rejected':{'tmz4':'正侧不是侧后方'}})
    rejected, records=final.review_exports(selection,rows)
    assert 'tmz4' in rejected and not records[0]['accepted']


def test_bad_alpha_and_missing_file_are_unresolved(tmp_path):
    selection, rows, _ = fixture(tmp_path)
    rows[0]['规则槽位']='jdt'
    rejected,_=final.review_exports(selection,rows)
    assert '800x800' in rejected['jdt']
    Image.new('RGB',(800,800),'white').save(tmp_path/'export.jpg')
    assert '透明' in final.review_exports(selection,rows)[0]['jdt']
    (tmp_path/'export.jpg').unlink()
    assert 'jdt' in final.review_exports(selection,rows)[0]


def test_oversize_quality_preserved_wpt_is_not_marked_accepted(tmp_path, monkeypatch):
    from core import shenhui_shoe_packaging as shoe
    selection, rows, _ = fixture(tmp_path)
    rows[0]['规则槽位'] = 'wpt30'
    monkeypatch.setattr(shoe, 'SHOE_WPT_MAX_BYTES', 64)
    rejected, records = final.review_exports(selection, rows)
    assert '人工处理' in rejected['wpt30']
    assert records[0]['status'] == 'export_invalid'
    assert not records[0]['accepted']
    assert Path(rows[0]['本地文件']).exists()


def test_absence_requires_full_pool_evidence_and_never_counts_as_delivered(tmp_path):
    selection, rows, _ = fixture(tmp_path)
    rows=[{'规则槽位':'yx','原文件名':'','本地文件':''}]
    assert 'yx' in final.review_exports(selection,rows)[0]
    selection['_sequential_result']={'card_absence_verified':True}
    rejected,records=final.review_exports(selection,rows)
    assert 'yx' not in rejected
    assert records[0]['status']=='optional_absent' and not records[0]['accepted']


def test_palette_png_transparency_is_valid(tmp_path):
    selection,rows,_=fixture(tmp_path)
    p=tmp_path/'palette.png'
    image=Image.new('P',(800,800),0)
    image.putpalette([255,255,255,0,0,0]+[0]*762)
    image.paste(1,(200,200,600,600))
    image.save(p,transparency=0)
    rows[0].update({'规则槽位':'wpt30','本地文件':str(p)})
    assert final.review_exports(selection,rows)[0]=={}


def test_independent_slots_are_reviewed_concurrently(tmp_path,monkeypatch):
    import threading
    selection,rows,template=fixture(tmp_path)
    selection['tmz3']='source.jpg'
    rows.append({**rows[0],'规则槽位':'tmz3'})
    barrier=threading.Barrier(2)
    monkeypatch.setattr(direct,'reference',lambda *a:str(template))
    def audit(ctx,result,targets):
        barrier.wait(timeout=2)
        return {'rejected':{},'approved':targets}
    monkeypatch.setattr(direct,'audit',audit)
    assert final.review_exports(selection,rows)[0]=={}


def test_derived_standard_exports_share_one_visual_request(tmp_path,monkeypatch):
    selection,rows,template=fixture(tmp_path);selection['tmz5']='source.jpg';selection['tms']='source.jpg'
    selection['wpz']=['']*4+['source.jpg','']
    for slot,color in [('tmz5','white'),('tms','gray'),('wpz5','black')]:
        p=tmp_path/(slot+'.jpg');Image.new('RGB',(100,100),color).save(p)
        rows.append({'规则槽位':slot,'原文件名':'source.jpg','本地文件':str(p)})
    rows=rows[1:];calls=[]
    monkeypatch.setattr(direct,'reference',lambda *a:str(template))
    def audit(ctx,result,targets):calls.append(ctx);return {'rejected':{},'approved':targets}
    monkeypatch.setattr(direct,'audit',audit)
    assert final.review_exports(selection,rows)[0]=={}
    assert len(calls)==1 and len(calls[0]['export_images'])==3


def test_transport_unknown_is_not_cached_as_source_rejection(tmp_path,monkeypatch):
    from core.llm_gateway import LlmGatewayError
    selection,rows,template=fixture(tmp_path);calls=[]
    monkeypatch.setattr(direct,'reference',lambda *a:str(template))
    def audit(*a):calls.append(1);raise LlmGatewayError('HTTP 503')
    monkeypatch.setattr(direct,'audit',audit)
    for _ in range(2):
        _,records=final.review_exports(selection,rows)
        assert records[0]['status']=='review_unknown'
    assert len(calls)==2 and selection['tmz4']=='source.jpg'


def test_standard_background_policy_change_does_not_reaudit_other_slots(tmp_path,monkeypatch):
    selection,rows,template=fixture(tmp_path);calls=[]
    monkeypatch.setattr(direct,'reference',lambda *a:str(template))
    monkeypatch.setattr(direct,'audit',lambda *a:(calls.append(1) or {'rejected':{},'approved':['tmz4']}))
    final.review_exports(selection,rows)
    selection['_sequential_context']['gray_standard']=True
    final.review_exports(selection,rows)
    assert len(calls)==1
    monkeypatch.setattr(direct,'VISUAL_FACTS_PROMPT',direct.VISUAL_FACTS_PROMPT+' Changed rule.')
    final.review_exports(selection,rows)
    assert len(calls)==2


def test_one_bad_derivative_preserves_good_members(tmp_path,monkeypatch):
    selection,rows,template=fixture(tmp_path)
    selection.update(tmz5='source.jpg',tms='source.jpg')
    second=tmp_path/'second.jpg';Image.new('RGB',(100,100),'gray').save(second)
    rows=[{**rows[0],'规则槽位':'tmz5'}, {**rows[0],'规则槽位':'tms','本地文件':str(second)}]
    monkeypatch.setattr(direct,'reference',lambda *a:str(template))
    monkeypatch.setattr(direct,'audit',lambda *a:{'approved':[],'rejected':{'tmz5':'one export cropped'},
        'outcomes':{'tmz5':'export_invalid'},'response':{'reviews':[{'slot':'tmz5','accepted':False,
            'response':{'export_checks':[{'index':0,'accepted':True,'reason':'complete'},
                                         {'index':1,'accepted':False,'reason':'cropped'}]}}]}})
    rejected,records=final.review_exports(selection,rows)
    assert records[0]['accepted'] and records[0]['review']['approved']==['tmz5']
    assert records[1]['status']=='export_invalid' and records[1]['reason']=='cropped'
    assert 'tmz5' in rejected


def test_source_repair_receives_wrong_pose_reason_despite_intact_export(tmp_path, monkeypatch):
    selection, rows, template = fixture(tmp_path)
    monkeypatch.setattr(direct, 'reference', lambda *a: str(template))
    monkeypatch.setattr(direct, 'audit', lambda *a: {
        'approved': [], 'rejected': {'tmz4': '正侧不是侧后，需要看见后跟弧面'},
        'outcomes': {'tmz4': 'source_invalid'}, 'response': {'reviews': [
            {'slot': 'tmz4', 'response': {'export_checks': [
                {'index': 0, 'accepted': True, 'reason': '成品完整，没有截断或损坏'}
            ]}}
        ]}
    })
    rejected, records = final.review_exports(selection, rows)
    assert rejected['tmz4'] == '正侧不是侧后，需要看见后跟弧面'
    assert records[0]['status'] == 'source_invalid'


def test_ocr_note_does_not_trigger_reexport_but_missing_image_does(tmp_path,monkeypatch):
    selection,rows,template=fixture(tmp_path)
    monkeypatch.setattr(direct,'reference',lambda *a:str(template))
    monkeypatch.setattr(direct,'audit',lambda *a:{'rejected':{},'approved':['tmz4']})
    rows.append({'规则槽位':'鞋盒OCR','规则告警':'标签未印产品名，品类按实图复核','本地文件':''})
    rejected,records=final.review_exports(selection,rows)
    assert not rejected and len(records)==1
    (tmp_path/'export.jpg').unlink()
    assert 'tmz4' in final.review_exports(selection,rows)[0]
