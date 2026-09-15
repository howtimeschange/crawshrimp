from types import SimpleNamespace
from PIL import Image
from core import shenhui_shoe_template_match as direct
from core import shenhui_shoe_sequential as sequence
from artifacts import shenhui_shoe_rerun_validator as validator
import json
import pytest


def test_direct_selection_has_no_handwritten_pose_checklist():
    text = direct.selection_prompt({"style": "S", "color": "C"}, "tmz3", ["I1"])
    assert "checks" not in text
    assert "outer_side_visible" not in text
    assert "toe_center" not in text
    assert "模板" in text
    assert "左右镜像" in text


def test_yq_template_repeats_first_example_as_two_independent_rows(tmp_path):
    source = tmp_path / "examples.jpg"
    image = Image.new("RGB", (100, 200), "red")
    image.paste("blue", (0, 100, 100, 200))
    image.save(source)
    path = direct.reference(
        {"root": str(tmp_path), "yq_refs": {"yq3": str(source)}}, "yq3"
    )
    with Image.open(path) as im:
        assert im.height == 200
        assert im.getpixel((50, 150))[0] > 200
        assert im.getpixel((50, 50))[0] > 200


def test_direct_review_retains_real_comparison_without_inventing_checks(
    tmp_path, monkeypatch
):
    path = tmp_path / "shoe.jpg"
    Image.new("RGB", (100, 100), "white").save(path)
    ctx = {
        "root": str(tmp_path),
        "style": "S",
        "color": "C",
        "ids": {"I1": "shoe"},
        "previews": {"shoe": str(path)},
        "main_refs": [str(path)] * 5,
        "routes": ["deepseek-official-flash"],
        "direct_template_match": True,
        "log": lambda _: None,
    }
    calls = []

    def request(ctx, model, prompt, images, phase):
        calls.append((model, prompt, images))
        return {
            "match": True,
            "visible_differences": [],
            "reason": "同类构图",
            "template_shoe_count": 1, "candidate_shoe_count": 1,
            "arrangement_matches": True, "camera_view_matches": True,
        }, SimpleNamespace(model_id="deepseek-flash")

    monkeypatch.setattr(direct.fast, "_request", request)
    audit = sequence.audit(ctx, {"selected": {"tmz3": "shoe"}}, ["tmz3"])
    row = audit["response"]["reviews"][0]
    assert row["accepted"] is True
    assert row["response"]["candidate_shoe_count"] == 1
    assert row["structural_checks"]["count_allowed"] is True
    assert "checks" not in row
    assert len(row["comparison_sha256"]) == 64
    assert len(calls) == 1
    selection = {
        "_sequential_context": ctx,
        "_sequential_audits": [audit],
        "shoe_category": "运动",
    }
    ctx["category"] = "运动"
    evidence = sequence.report_evidence(selection, "tmz3", "shoe")
    assert evidence["accepted"] is True
    assert "required_checks" not in evidence
    report = [
        {
            "规则槽位": "tmz3",
            "原文件名": "shoe",
            "逐坑位复核": json.dumps(evidence),
            "下载结果": "已下载",
        }
    ]
    assert (
        validator.validate_semantic_rows(report, category="运动", require_evidence=True)
        == []
    )
    evidence["comparison_sha256"] = ""
    report[0]["逐坑位复核"] = json.dumps(evidence)
    assert validator.validate_semantic_rows(
        report, category="运动", require_evidence=True
    )


def test_side_comparison_needs_same_style_anchor(tmp_path, monkeypatch):
    monkeypatch.setattr(
        direct.fast,
        "_request",
        lambda *a: pytest.fail("no image request without anchor"),
    )
    ctx = {"root": str(tmp_path), "ids": {"I1": "shoe"}}
    audit = direct.audit(ctx, {"selected": {"yq3": "shoe"}}, ["yq3"])
    assert audit["approved"] == []
    assert "yq3" in audit["rejected"]


def test_direct_repair_only_reselects_failed_slot(monkeypatch, tmp_path):
    selected = {slot: slot + '.jpg' for slot in sequence.ORDER}
    ctx = dict(root=str(tmp_path), ids={str(i): name for i,name in enumerate(selected.values())}, routes=['deepseek-official-flash'], direct_template_match=True)
    seen = []
    def run(c):
        seen.append(c)
        assert c['slot_order'] == ['tmz3']
        assert 'tmz4' in c['locked_selections']
        assert 'yq3' in c['locked_selections']
        return dict(selected=selected, records=[], card_absence_verified=False)
    def audit(c, result, slots=None):
        if slots is None:
            return dict(approved=[s for s in sequence.ORDER if s != 'tmz3'], rejected={'tmz3':'mismatch'})
        assert slots == ['tmz3']
        return dict(approved=slots, rejected={})
    monkeypatch.setattr(sequence, 'run', run)
    monkeypatch.setattr(sequence, 'audit', audit)
    result = sequence.run_verified(ctx, {'selected':selected})
    assert result['verified']
    assert len(seen) == 1


def test_rejected_only_candidate_does_not_call_model(monkeypatch, tmp_path):
    monkeypatch.setattr(sequence.fast, '_gray_mates', lambda *args: [])
    monkeypatch.setattr(sequence.fast, '_request', lambda *args: pytest.fail('no valid candidate'))
    ctx = dict(root=str(tmp_path), ids={'I1':'bad.jpg'}, style='S',color='C',category='婴童',routes=['deepseek-official-flash'], slot_order=['tmz4'], rejected_sources={'tmz4':'bad.jpg'})
    result = sequence.run(ctx)
    assert not result['selected'].get('tmz4')
    assert result['records'][0]['error'] == '无剩余候选满足来源约束'


def test_standard_and_card_selection_do_not_inherit_strict_view_rule():
    for slot in ('tmz5', 'yx'):
        prompt = direct.selection_prompt({'style':'S','color':'C'}, slot, ['I1'])
        assert direct.MATCH_RULE not in prompt
        assert '模板' in prompt


def test_direct_template_does_not_reject_larger_boot_before_visual_review(monkeypatch):
    monkeypatch.setattr(sequence, '_pose3_source_valid', lambda *args: False)
    result = sequence.validate({'candidate_id':'I1','accepted':True,'evidence':'符合模板竖向外侧姿势'}, 'tmz3', ['I1'], {'direct_template_match':True})
    assert result == 'I1'


def _pair_review(slot, key, accepted):
    return {'approved':[slot] if accepted else [],
            'rejected':{} if accepted else {slot:'wrong view'},
            'response':{'reviews':[{'slot':slot,'candidate_id':key,'accepted':accepted,
                                   'model':'deepseek-flash','evidence':'actual image comparison'}]}}


def test_repair_checks_ranked_candidates_without_accepting_similarity(monkeypatch,tmp_path):
    ctx=dict(root=str(tmp_path),ids={'I1':'bad','I2':'good'})
    monkeypatch.setattr(direct,'_repair_visual_order',lambda *a:(['I1','I2'],[('I1',.99),('I2',.5)]))
    calls=[]
    def review(c,result,slots):
        name=result['selected']['tmz4'];calls.append(name)
        assert 45<c['request_timeout']<=90
        return _pair_review('tmz4','I1' if name=='bad' else 'I2',name=='good')
    monkeypatch.setattr(direct,'audit',review)
    response,route,attempts=direct.select_repair(ctx,'official','tmz4',['I1','I2'],False,[])
    assert calls==['bad','good']
    assert response['candidate_id']=='I2'
    assert route.model_id=='deepseek-flash'
    assert attempts[0]['pair_review']['rejected']


def test_repair_moves_on_after_timeout(monkeypatch,tmp_path):
    ctx=dict(root=str(tmp_path),ids={'I1':'slow','I2':'good'})
    monkeypatch.setattr(direct,'_repair_visual_order',lambda *a:(['I1','I2'],[]))
    calls=[]
    def review(c,result,slots):
        name=result['selected']['tmz4'];calls.append(name)
        if name=='slow':return {'approved':[],'rejected':{'tmz4':'timeout'},'errors':['timeout']}
        return _pair_review('tmz4','I2',True)
    monkeypatch.setattr(direct,'audit',review)
    assert direct.select_repair(ctx,'official','tmz4',['I1','I2'],False,[])[0]['candidate_id']=='I2'
    assert calls==['slow','good']


def test_repair_90_second_request_preserves_slot_deadline(monkeypatch, tmp_path):
    ctx = dict(root=str(tmp_path), ids={'I1': 'bad', 'I2': 'good'})
    monkeypatch.setattr(direct, '_repair_visual_order', lambda *a: (['I1', 'I2'], []))
    clock = iter([100.0, 101.0, 190.1])
    monkeypatch.setattr(direct.time, 'monotonic', lambda: next(clock))
    calls = []
    def review(c, result, slots):
        calls.append(result['selected']['tmz4'])
        assert c['request_timeout'] == 90.0
        return _pair_review('tmz4', 'I1', False)
    monkeypatch.setattr(direct, 'audit', review)
    direct.select_repair(ctx, 'official', 'tmz4', ['I1', 'I2'], False, [])
    assert calls == ['bad']


def test_repair_side_check_preserves_same_shoe_anchor(monkeypatch,tmp_path):
    ctx=dict(root=str(tmp_path),ids={'I1':'side'},side_anchor='outer')
    monkeypatch.setattr(direct,'_repair_visual_order',lambda *a:(['I1'],[]))
    def review(c,result,slots):
        assert result['selected']['tmz3']=='outer'
        assert slots==['yq3']
        assert 45<c['request_timeout']<=90
        return _pair_review('yq3','I1',True)
    monkeypatch.setattr(direct,'audit',review)
    assert direct.select_repair(ctx,'official','yq3',['I1'],True,[])[0]['accepted']


def test_visual_order_keeps_all_candidates_and_handles_missing_image(tmp_path):
    ctx={'root':str(tmp_path),'main_refs':['missing']*5,'ids':{'A':'a','B':'b'},'previews':{'a':'missing','b':'missing'}}
    assert direct._repair_visual_order(ctx,'tmz4',['B','A'])==(['B','A'],[])


def test_main_and_card_templates_repeat_without_mutating_original(tmp_path):
    for slot in ('tmz1', 'yx'):
        root=tmp_path/slot
        root.mkdir()
        source=root/'source.jpg'
        Image.new('RGB',(80,100),'red').save(source)
        original=source.read_bytes()
        ctx={'root':str(root),'main_refs':[str(source)]*5,'yx_ref':str(source)}
        path=direct.reference(ctx,slot)
        assert 'stacked-v1' in path
        with Image.open(path) as im:
            assert im.size==(80,200)
            assert im.getpixel((40,30))==im.getpixel((40,130))
        assert source.read_bytes()==original
        assert direct.TEMPLATE_LAYOUT_GUIDE in direct.selection_prompt({'style':'S','color':'C'},slot,['I1'])


@pytest.mark.parametrize('same_side', [True, False])
def test_integrated_side_review_separates_pose_and_keeps_evidence(tmp_path, monkeypatch, same_side):
    source = tmp_path / 'source.png'
    Image.new('RGB', (80, 160), 'red').save(source)
    original = source.read_bytes()
    ctx = dict(root=str(tmp_path), style='S', color='C', category='婴童',
               ids={'I1':'anchor','I2':'candidate'}, previews={'anchor':str(source),'candidate':str(source)},
               yq_refs={'yq3':str(source)}, routes=['deepseek-official-flash'], request_timeout=45)
    calls=[]
    def request(c, model, prompt, images, phase):
        calls.append((c, images))
        if len(calls)==1:
            assert len(images)==2
            return {'match':True,'reason':'pose matches'}, SimpleNamespace(model_id=model)
        assert c['request_timeout'] == 90
        assert 'system_prompt' in c
        with Image.open(images[0]) as board:
            assert board.size == (1400,1400)
        return {'same_side':same_side,'reason':'visible side structure'}, SimpleNamespace(model_id=model)
    monkeypatch.setattr(direct.fast,'_request',request)
    audit=direct.audit(ctx, {'selected':{'tmz3':'anchor','yq3':'candidate'}}, ['yq3'])
    assert ('yq3' in audit['approved']) is same_side
    row=audit['response']['reviews'][0]
    assert row['side_identity']['same_side'] is same_side
    assert len(row['side_identity']['input_sha256'])==2
    assert len(calls)==2
    assert source.read_bytes()==original
    if same_side:
        selection={'_sequential_context':ctx,'_sequential_audits':[audit],'shoe_category':'婴童'}
        evidence=sequence.report_evidence(selection,'yq3','candidate')
        assert evidence['side_identity']==row['side_identity']
        report=[{'规则槽位':'yq3','原文件名':'candidate','逐坑位复核':json.dumps(evidence),'下载结果':'已下载'}]
        assert not validator.validate_semantic_rows(report,category='婴童',require_evidence=True)
        evidence.pop('side_identity')
        report[0]['逐坑位复核']=json.dumps(evidence)
        assert validator.validate_semantic_rows(report,category='婴童',require_evidence=True)


def test_completed_long_stream_still_gets_independent_side_review(tmp_path, monkeypatch):
    source=tmp_path/'shoe.png';Image.new('RGB',(80,160),'white').save(source)
    ctx=dict(root=str(tmp_path),ids={'I1':'shoe'},previews={'shoe':str(source)},
             yq_refs={'yq3':str(source)},routes=['deepseek-official-flash'],request_timeout=1)
    monkeypatch.setattr(direct.fast,'_request',lambda *a:({'match':True,'reason':'pose'},SimpleNamespace(model_id='flash')))
    def side(c, *args):
        assert c['request_timeout'] == 90
        return {'same_side':True,'response':{'reason':'same visible side'}}
    monkeypatch.setattr(direct,'review_shoe_side',side)
    result=direct.audit(ctx,{'selected':{'tmz3':'shoe','yq3':'shoe'}},['yq3'])
    assert result['approved'] == ['yq3']


def test_repair_stops_at_total_budget_without_rechecking_failed_image(monkeypatch,tmp_path):
    ctx=dict(root=str(tmp_path),ids={'I1':'bad','I2':'unvisited'})
    monkeypatch.setattr(direct,'_repair_visual_order',lambda *a:(['I1','I2'],[]))
    ticks=iter([0,1,91]);monkeypatch.setattr(direct.time,'monotonic',lambda:next(ticks))
    calls=[]
    def review(c,result,slots):
        calls.append(result['selected']['tmz4'])
        return _pair_review('tmz4','I1',False)
    monkeypatch.setattr(direct,'audit',review)
    response,_,attempts=direct.select_repair(ctx,'official','tmz4',['I1','I2'],False,[])
    assert not response['accepted']
    assert calls==['bad']
    assert len(attempts)==1


def test_visual_order_preserves_candidates_and_original_pixels(tmp_path):
    ctx=dict(root=str(tmp_path),ids={},previews={},main_refs=[])
    for i,color in enumerate(['red','blue','green']):
        p=tmp_path/f'{i}.png';Image.new('RGB',(80+i*10,100),color).save(p)
        ctx['ids'][str(i)]=str(i);ctx['previews'][str(i)]=str(p)
    ctx['main_refs']=[ctx['previews']['0']]*5
    originals={k:open(v,'rb').read() for k,v in ctx['previews'].items()}
    order,scores=direct._repair_visual_order(ctx,'tmz4',['2','0','1'])
    assert sorted(order)==['0','1','2']
    assert len(scores)==3
    assert all(open(ctx['previews'][k],'rb').read()==v for k,v in originals.items())
