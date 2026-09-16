import json
import pytest
from core import shenhui_shoe_sequential as q, shenhui_shoe_packaging as s


def test_rear_contract_checks_visible_heel_not_a_viewpoint_enum():
    ctx = {"category": "婴童", "ids": {"I24": "rear.jpg"}}
    response = {
        "candidate_id": "I24",
        "accepted": True,
        "checks": {
            "single_complete_shoe": True,
            "heel_back_visible": True,
            "not_vertical_side": True,
        },
        "evidence": "后跟后面及外侧同时可见",
        "side": "mixed",
    }
    assert q.validate(response, "tmz4", ["I24"], ctx) == "I24"
    response["checks"]["heel_back_visible"] = False
    with pytest.raises(s.ShoeSelectionError):
        q.validate(response, "tmz4", ["I24"], ctx)


def test_snow_rear_requires_lining_and_upper_side():
    assert set(q.contract("tmz4", "雪地")) == {
        "shoe_opening_detail",
        "lining_detail_prominent",
        "opening_lining_visible",
        "upper_side_visible",
    }


def test_floating_pair_never_passes_with_positive_accepted_flag():
    checks = {k: True for k in q.contract("tmz1", "运动")}
    checks["no_floating"] = False
    with pytest.raises(s.ShoeSelectionError):
        q.validate(
            dict(candidate_id="I1", accepted=True, checks=checks, evidence="悬空"),
            "tmz1",
            ["I1"],
            {"category": "运动"},
        )


def test_removed_candidate_cannot_be_selected_in_next_slot():
    checks = {k: True for k in q.contract("tmz4", "婴童")}
    with pytest.raises(s.ShoeSelectionError):
        q.validate(
            dict(candidate_id="removed", accepted=True, checks=checks, evidence="后侧"),
            "tmz4",
            ["I24"],
            {"category": "婴童"},
        )


def test_boolean_lookalikes_and_missing_evidence_do_not_pass():
    checks = {k: 1 for k in q.contract("tmz5", "婴童")}
    with pytest.raises(s.ShoeSelectionError):
        q.validate(
            dict(candidate_id="I01", accepted=True, checks=checks, evidence="单鞋"),
            "tmz5",
            ["I01"],
            {"category": "婴童"},
        )


def test_vertical_outer_cannot_fill_rear_even_with_visible_heel():
    response = dict(
        candidate_id="I20",
        accepted=True,
        checks={k: True for k in q.contract("tmz4", "婴童")},
        evidence="纵向外侧",
    )
    response["checks"]["not_vertical_side"] = False
    with pytest.raises(s.ShoeSelectionError):
        q.validate(response, "tmz4", ["I20"], {"category": "婴童"})


def test_repair_releases_wrong_rear_lock_when_vertical_slot_is_missing():
    assert q.repair_scope({"tmz3"}) == {"tmz3", "tmz4", "yq3"}
    assert q.repair_scope({"yx"}) == {"yx"}
    assert q.repair_scope({"tmz2"}) == {"tmz2", "yq1"}


def test_card_absence_requires_all_chunks_but_later_positive_wins(
    monkeypatch, tmp_path
):
    ctx = {"root": str(tmp_path), "ids": {f"I{i}": f"{i}.jpg" for i in range(33)}}
    calls = []

    def review(c, *args):
        calls.append(list(c["ids"]))
        return (
            ("yx", None, "uncertain", {})
            if len(calls) == 1
            else ("yx", "32.jpg", "", {})
        )

    monkeypatch.setattr(q.fast, "_review_card_absence", review)
    assert q.inspect_card_pool(ctx, "test")[0] == "32.jpg"
    assert sum(map(len, calls)) == 33
    monkeypatch.setattr(
        q.fast, "_review_card_absence", lambda *a: ("yx", None, "uncertain", {})
    )
    with pytest.raises(s.ShoeSelectionError):
        q.inspect_card_pool(ctx, "test")
    monkeypatch.setattr(q.fast, "_review_card_absence", lambda *a: ("yx", "", "", {}))
    assert q.inspect_card_pool(ctx, "test")[0] == ""


def test_default_yx_reference_is_a_real_packaged_image():
    from PIL import Image

    assert s.SHOE_YX_REFERENCE_IMAGE.parent.name == "assets"
    with Image.open(s.SHOE_YX_REFERENCE_IMAGE) as im:
        assert min(im.size) > 500


def test_standard_sources_reserved_before_other_slots(monkeypatch, tmp_path):
    from types import SimpleNamespace
    from PIL import Image

    ids = {"I01": "S-C.jpg", "I02": "gray.jpg", "I03": "rear.jpg"}
    previews = {}
    for name in ids.values():
        path = tmp_path / name
        Image.new("RGB", (20, 20), "white").save(path)
        previews[name] = str(path)
    ctx = {
        "style": "S",
        "color": "C",
        "category": "婴童",
        "root": str(tmp_path),
        "ids": ids,
        "previews": previews,
        "routes": ["test"],
        "main_refs": ["ref"] * 5,
        "slot_order": ["tmz4"],
    }
    monkeypatch.setattr(q.shoe, "_is_tms_source_filename", lambda n, *a: n == "S-C.jpg")
    monkeypatch.setattr(q.fast, "_gray_mates", lambda *a: ["I02"])

    def request(c, m, p, images, phase):
        assert '"I01"' not in p and '"I02"' not in p
        return dict(
            candidate_id="I03",
            accepted=True,
            checks={k: True for k in q.contract("tmz4", "婴童")},
            evidence="后面可见",
        ), SimpleNamespace(model_id="test")

    monkeypatch.setattr(q.fast, "_request", request)
    assert q.run(ctx)["selected"] == {"tmz4": "rear.jpg"}


def test_named_coordinates_can_be_read_without_mutating_raw_evidence():
    raw = {"evidence": "toe_center约为[0.31,0.76]，heel_center约为(0.69,0.25)"}
    got = q.normalize_landmarks(raw)
    assert got["toe_center"] == [0.31, 0.76] and got["heel_center"] == [0.69, 0.25]
    assert "toe_center" not in raw
    assert q.normalize_landmarks(
        {"evidence": raw["evidence"] + " toe_center=[0.4,0.9]"}
    ) == {"evidence": raw["evidence"] + " toe_center=[0.4,0.9]"}
    assert q.normalize_landmarks({"evidence": "上面和下面"}) == {
        "evidence": "上面和下面"
    }


@pytest.mark.parametrize("reference_changed", [False, True])
def test_repair_reuses_approved_image_only_with_unchanged_reference(
    monkeypatch, tmp_path, reference_changed
):
    selected = {slot: slot + ".jpg" for slot in q.ORDER}
    revised = {**selected, "tmz4": "rear-fixed.jpg"}
    if reference_changed:
        revised["tmz3"] = "outer-fixed.jpg"
    names = set(selected.values()) | set(revised.values())
    ctx = {
        "root": str(tmp_path),
        "ids": {f"I{i}": name for i, name in enumerate(sorted(names))},
        "routes": ["primary", "review"],
    }
    first = {
        "approved": [slot for slot in q.ORDER if slot != "tmz4"],
        "rejected": {"tmz4": "wrong rear"},
    }
    targets = []

    def audit(c, result, slots=None):
        if slots is None:
            return first
        targets.extend(slots)
        return {"approved": slots, "rejected": {}}

    monkeypatch.setattr(q, "audit", audit)
    monkeypatch.setattr(
        q,
        "run",
        lambda c: {"selected": revised, "records": [], "card_absence_verified": False},
    )
    result = q.run_verified(ctx, {"selected": selected})
    assert result["verified"]
    assert "tmz4" in targets
    assert ("yq3" in targets) == reference_changed
    assert ("yq3" in result["audits"][1]["reused_approved"]) != reference_changed


def test_sports_rear_requires_oblique_outsole_not_baby_grounded_pose():
    response = dict(
        candidate_id="rear",
        accepted=True,
        checks={k: True for k in q.contract("tmz4", "婴童")},
        evidence="平放后侧",
    )
    with pytest.raises(s.ShoeSelectionError):
        q.validate(response, "tmz4", ["rear"], {"category": "运动"})
    response["checks"] = {k: True for k in q.contract("tmz4", "运动")}
    assert q.validate(response, "tmz4", ["rear"], {"category": "运动"}) == "rear"
    response["checks"]["outsole_visible_obliquely"] = False
    with pytest.raises(s.ShoeSelectionError):
        q.validate(response, "tmz4", ["rear"], {"category": "运动"})


@pytest.mark.parametrize("gray", [False, True])
def test_standard_without_gray_mate_is_kept_and_gray_standard_is_reviewed(
    monkeypatch, tmp_path, gray
):
    from PIL import Image, ImageDraw
    from types import SimpleNamespace

    path = tmp_path / "S-C.jpg"
    im = Image.new("RGB", (200, 200), (242, 242, 242) if gray else "white")
    ImageDraw.Draw(im).rectangle((70, 50, 130, 150), fill="brown")
    im.save(path)
    ctx = dict(
        style="S",
        color="C",
        category="婴童",
        root=str(tmp_path),
        ids={"I1": "S-C.jpg"},
        entries={"S-C.jpg": {"path": str(path)}},
        previews={"S-C.jpg": str(path)},
        routes=["primary"],
        main_refs=[str(path)] * 5,
        slot_order=["tmz5", "wpz5"],
    )
    monkeypatch.setattr(q.fast, "_gray_mates", lambda *a: [])

    def request(c, *args):
        checks = q.contract("tmz5", c["category"], c.get("gray_standard", False))
        assert ("clean_gray_background" in checks) == gray
        return dict(
            candidate_id="I1",
            accepted=True,
            checks={k: True for k in checks},
            evidence="完整单鞋纯色背景",
        ), SimpleNamespace(model_id="primary")

    monkeypatch.setattr(q.fast, "_request", request)
    result = q.run(ctx)
    assert result["selected"] == {"tmz5": "S-C.jpg", "wpz5": "S-C.jpg"}
    assert result["records"][-1]["source"] == "standard_source_fallback_no_gray_pair"


def test_same_side_gate_rejects_zipper_mismatch_despite_positive_model_flag():
    row = dict(
        candidate_id="I1",
        accepted=True,
        checks={k: True for k in q.contract("yq3", "休闲")},
        evidence="同一侧",
        side_observations=dict(
            anchor_zipper=False,
            candidate_zipper=True,
            anchor_marks="外侧图案",
            candidate_marks="内侧拉链",
        ),
    )
    with pytest.raises(s.ShoeSelectionError, match="拉链"):
        q.validate(
            row, "yq3", ["I1"], {"category": "休闲", "require_side_observations": True}
        )

    row.pop("side_observations")
    with pytest.raises(s.ShoeSelectionError, match="结构观察"):
        q.validate(
            row, "yq3", ["I1"], {"category": "休闲", "require_side_observations": True}
        )


def test_malformed_side_observation_is_selection_failure():
    row = dict(
        candidate_id="I1",
        accepted=True,
        checks={k: True for k in q.contract("yq3", "休闲")},
        evidence="可见结构",
        side_observations=["unexpected array"],
    )
    with pytest.raises(s.ShoeSelectionError, match="JSON对象"):
        q.validate(row, "yq3", ["I1"], {"category": "休闲"})


def test_empty_semantic_review_does_not_request_models():
    result = q.audit({"ids": {}}, {"selected": {}}, [])
    assert result["approved"] == []
    assert result["rejected"] == {}


def test_final_side_review_is_isolated_parallel_and_retains_actual_model(
    monkeypatch, tmp_path
):
    import threading

    barrier = threading.Barrier(2)

    def review(ctx, result, slots):
        barrier.wait(timeout=2)
        side = slots == ["yq3"]
        model = "side-fallback" if side else "main-reviewer"
        return dict(
            model=model,
            response={
                "reviews": [
                    {"slot": slot, "candidate_id": slot, "accepted": True}
                    for slot in slots
                ]
            },
            approved=slots,
            rejected={},
            errors=[],
        )

    monkeypatch.setattr(q, "_audit_selected", review)
    result = q.audit({"root": str(tmp_path)}, {}, ["tmz3", "yq3"])
    assert set(result["approved"]) == {"tmz3", "yq3"}
    assert result["review_models"] == {"tmz3": "main-reviewer", "yq3": "side-fallback"}
    assert len(result["partitions"]) == 2


def test_partial_result_preserves_good_slots_and_clears_untrusted_dependencies(monkeypatch, tmp_path):
    selected = {slot:slot+'.jpg' for slot in q.ORDER}
    slots = {'_sequential_context':{'root':str(tmp_path), 'style':'123456789012',
             'color':'12345', 'category':'运动', 'allow_partial':True,
             'proposal':{}, 'ids':{}}, 'wpz':['tmz'+str(i)+'.jpg' for i in range(1,7)],
             'yq':['yq1.jpg','yq2.jpg','yq3.jpg']}
    slots.update({slot:name for slot,name in selected.items() if not slot.startswith(('wpz','yq'))})
    monkeypatch.setattr(q, 'run_verified', lambda *a: {'selected':selected,
        'verified':False, 'audits':[{'rejected':{'tmz3':'wrong view'}}]})
    result = q.verify_packaged_selection(slots)
    assert result['tmz1'] == 'tmz1.jpg'
    assert result['tmz3'] == '' and result['wpz'][2] == '' and result['yq'][2] == ''
    assert result['_pending_slots']['yq3']
    assert result['_sequential_result']['selected']['tmz3'] == 'tmz3.jpg'
    assert (tmp_path/'final-selection.json').is_file()


def test_batch_recovery_runs_after_all_initial_work_and_only_reexports_changed_style(monkeypatch, tmp_path):
    events=[]
    progress=[]
    def initial(**kw):
        if not kw.get('_reuse_prepared'):
            events.extend(['style-A-initial','style-B-initial'])
            kw['progress']({'organize_total':2,'organize_completed':2,'organize_active':False})
            kw['_prepared_colors'][('123456789012','12345')]={'slots':{'_pending_slots':{'tmz2':'missing'}}}
            kw['_prepared_colors'][('223456789012','12345')]={'slots':{'_pending_slots':{}}}
            return [{'输入款号':'123456789012'},{'输入款号':'223456789012'}], {}
        events.append('reexport-A')
        kw['progress']({'organize_total':1,'organize_completed':1,'organize_active':False})
        assert {r['输入款号'] for r in kw['data_rows']} == {'123456789012'}
        root=kw['output_root']/'123456789012'
        root.mkdir()
        (root/'good.jpg').write_bytes(b'preserved')
        return [{'输入款号':'123456789012','本地文件':str(root/'good.jpg')}], {'123456789012':root}
    def recover(slots, *, recovery, repair_only):
        assert recovery and repair_only and events == ['style-A-initial','style-B-initial']
        events.append('recover-A')
        return {'tmz2':'good.jpg', '_pending_slots':{}}
    monkeypatch.setattr(s, '_prepare_shoe_packages_initial', initial)
    monkeypatch.setattr(q, 'verify_packaged_selection', recover)
    rows=[{'输入款号':'123456789012'},{'输入款号':'223456789012'}]
    report, packages=s.prepare_shoe_packages_skip_failed_styles(data_rows=rows, output_root=tmp_path,
                                                               pose_strategy='sequential_templates',progress=progress.append)
    assert events == ['style-A-initial','style-B-initial','recover-A','reexport-A']
    assert len(report)==2 and all('部分完成' not in r['验收状态'] for r in report)
    assert (tmp_path/'123456789012/good.jpg').read_bytes() == b'preserved'
    assert next(r['本地文件'] for r in report if r.get('本地文件')) == str(tmp_path/'123456789012/good.jpg')

    assert all(e['organize_completed'] == 2 and e['organize_total'] == 2 for e in progress)
    assert all(e['organize_active'] for e in progress[:-1])
    assert progress[-1]['organize_active'] is False


def test_batch_retries_failed_color_once_and_atomically_replaces_old_names(monkeypatch, tmp_path):
    style='123456789012'
    old=tmp_path/style;old.mkdir();(old/'old-color.jpg').write_bytes(b'old')
    calls=[]
    good={'slots':{'_pending_slots':{}},'color_name':'good'}
    def initial(**kw):
        cache=kw['_prepared_colors'];calls.append(bool(kw.get('_reuse_prepared')))
        if not kw.get('_reuse_prepared'):
            cache[(style,'1')]=good
            cache[(style,'2')]={'error':'label unreadable','report_rows':[]}
            return [{'输入款号':style,'处理动作':'失败款色跳过'}],{style:old}
        assert cache[(style,'1')] is good
        assert (style,'2') not in cache
        assert (old/'old-color.jpg').is_file()
        assert kw['_analysis_root'].is_relative_to(tmp_path/'_shoe_analysis')
        cache[(style,'2')]={'slots':{'_pending_slots':{}}}
        new=kw['output_root']/style;new.mkdir();(new/'new-color.jpg').write_bytes(b'new')
        return [{'输入款号':style,'本地文件':str(new/'new-color.jpg')}],{style:new}
    monkeypatch.setattr(s,'_prepare_shoe_packages_initial',initial)
    report,packages=s.prepare_shoe_packages_skip_failed_styles(
        data_rows=[{'输入款号':style}],output_root=tmp_path,pose_strategy='sequential_templates')
    assert calls==[False,True]
    assert not (old/'old-color.jpg').exists()
    assert (old/'new-color.jpg').read_bytes()==b'new'
    assert report[0]['验收状态']=='程序复核完成，待逐图验收'


def test_global_audit_is_fresh_and_does_not_select(monkeypatch, tmp_path):
    selected = {slot: slot + '.jpg' for slot in q.ORDER}
    ctx = {'root':str(tmp_path), 'style':'123456789012', 'color':'12345',
           'category':'运动', 'allow_partial':True, 'proposal':{}, 'ids':{},
           'audit_slots':['tmz2'], 'reuse_inventory_reviews':True}
    slots = {'_sequential_context':ctx, 'wpz':['']*6, 'yq':['']*3}
    for slot, name in selected.items():
        s._replace_consensus_slot_value(slots, slot, name)
    def audit(context, result, targets):
        assert context['reuse_inventory_reviews'] is False
        assert context['audit_only'] is True
        assert targets is None
        return {'approved':['tmz1'], 'rejected':{'tmz3':'正侧面不能替代目标姿势'}}
    monkeypatch.setattr(q, 'audit', audit)
    monkeypatch.setattr(q, 'run', lambda *a: pytest.fail('global audit must not select'))
    result = q.verify_packaged_selection(slots, final_audit=True)
    assert result['tmz1'] == 'tmz1.jpg'
    assert not result['tmz3']
    assert result['_pending_slots']['tmz3']


def test_global_review_barrier_precedes_parallel_repairs(monkeypatch, tmp_path):
    import threading
    from core import shenhui_shoe_final_review as final
    styles = ['123456789012','223456789012']
    reviewed = set()
    barrier = threading.Barrier(2)
    repairs = []
    def initial(**kw):
        if not kw.get('_reuse_prepared'):
            for style in styles:
                kw['_prepared_colors'][(style,'1')] = {'slots':{
                    '_sequential_context':{'test':True}, 'style':style, '_pending_slots':{}}}
            return [{'输入款号':style} for style in styles], {}
        style = kw['data_rows'][0]['输入款号']
        root = kw['output_root']/style
        root.mkdir()
        return [{'输入款号':style}], {style:root}
    def verify(slots, *, final_audit=False, recovery=False, repair_only=False):
        style = slots['style']
        assert recovery and reviewed == set(styles)
        repairs.append(style)
        barrier.wait(timeout=3)
        return {**slots, '_pending_slots':{}}
    def review(slots, rows):
        style = slots['style']
        first = style not in reviewed
        reviewed.add(style)
        barrier.wait(timeout=3)
        return ({'tmz4':'wrong rear'} if first else {}), []
    monkeypatch.setattr(final, 'review_exports', review)
    monkeypatch.setattr(s, '_prepare_shoe_packages_initial', initial)
    monkeypatch.setattr(q, 'verify_packaged_selection', verify)
    reports, _ = s.prepare_shoe_packages_skip_failed_styles(
        data_rows=[{'输入款号':style} for style in styles], output_root=tmp_path,
        pose_strategy='sequential_templates', style_workers=2)
    assert set(repairs) == set(styles)
    assert all('部分完成' not in row['验收状态'] for row in reports)


def test_export_failure_stops_without_progress_and_quarantines_file(monkeypatch,tmp_path):
    from core import shenhui_shoe_final_review as final
    style='123456789012'
    repairs=[]
    def initial(**kw):
        cache=kw['_prepared_colors']
        if not kw.get('_reuse_prepared'):
            cache[(style,'12345')]={'slots':{'_sequential_context':{'test':True},
                '_pending_slots':{},'_sequential_result':{'selected':{'tmz4':'bad.jpg'}}}}
        root=kw['output_root']/style;root.mkdir(exist_ok=True)
        path=root/'bad.jpg';path.write_bytes(b'bad export')
        return [{'输入款号':style,'颜色':'12345','规则槽位':'tmz4','本地文件':str(path)}],{style:root}
    def verify(slots,*,final_audit=False,recovery=False,repair_only=False):
        if recovery:repairs.append(1)
        return slots
    def review(slots,rows):
        return {'tmz4':'wrong rear'},[{'path':rows[0]['本地文件'],'accepted':False,'reason':'wrong rear'}]
    monkeypatch.setattr(s,'_prepare_shoe_packages_initial',initial)
    monkeypatch.setattr(q,'verify_packaged_selection',verify)
    monkeypatch.setattr(final,'review_exports',review)
    reports,_=s.prepare_shoe_packages_skip_failed_styles(data_rows=[{'输入款号':style}],
        output_root=tmp_path,pose_strategy='sequential_templates')
    assert len(repairs)==1
    assert not (tmp_path/style/'bad.jpg').exists()
    assert (tmp_path/'_unresolved_exports'/style/'12345'/'bad.jpg').is_file()
    assert reports[0]['处理动作']=='待补齐/人工核验'
    assert json.loads((tmp_path/'unresolved-selections.json').read_text())['items']


def test_repair_worker_does_not_repeat_reviewer_calls(monkeypatch,tmp_path):
    selected={slot:slot+'.jpg' for slot in q.ORDER}
    ctx={'root':str(tmp_path),'ids':{slot:name for slot,name in selected.items()},
         'routes':[], 'direct_template_match':True, 'repair_only':True,
         'known_rejections':{'tmz4':'wrong rear'}}
    monkeypatch.setattr(q,'audit',lambda *a:pytest.fail('repair must not invoke final reviewer'))
    monkeypatch.setattr(q,'run',lambda c:{'selected':selected,'records':[],
                                         'card_absence_verified':False})
    result=q.run_verified(ctx,{'selected':selected})
    assert result['verified'] is False
    assert result['audits'][-1]['deferred_review'] is True
    assert result['audits'][-1]['approved']==[]


@pytest.mark.parametrize('failure_status', ['review_unknown','export_invalid'])
def test_review_failure_type_does_not_replace_valid_source(monkeypatch,tmp_path,failure_status):
    from core import shenhui_shoe_final_review as final
    style='123456789012';calls=[];exports=[]
    def initial(**kw):
        if kw.get('_reuse_prepared'):
            exports.append(1)
        else:
            kw['_prepared_colors'][(style,'90001')]={'slots':{'_sequential_context':{'test':True},
                '_pending_slots':{},'_sequential_result':{'selected':{'tmz4':'good.jpg'}}}}
        root=kw['output_root']/style;root.mkdir(exist_ok=True);p=root/'out.jpg';p.write_bytes(b'original')
        return [{'输入款号':style,'颜色':'90001','规则槽位':'tmz4','本地文件':str(p)}],{style:root}
    def review(slots,rows):
        calls.append(1);bad=len(calls)==1
        return ({'tmz4':'temporary error'} if bad else {}),[
            {'slot':'tmz4','semantic':'tmz4','path':rows[0]['本地文件'],'accepted':not bad,
             'status':failure_status if bad else 'accepted','reason':'temporary error'}]
    monkeypatch.setattr(s,'_prepare_shoe_packages_initial',initial)
    monkeypatch.setattr(final,'review_exports',review)
    monkeypatch.setattr(q,'verify_packaged_selection',lambda *a,**kw:pytest.fail('must retain source'))
    reports,_=s.prepare_shoe_packages_skip_failed_styles(data_rows=[{'输入款号':style}],output_root=tmp_path,
                                                        pose_strategy='sequential_templates')
    assert len(calls)==2
    assert len(exports)==(failure_status=='export_invalid')
    assert reports[0]['验收状态']=='程序复核完成，待逐图验收'
