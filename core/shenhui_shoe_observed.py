"""Experimental single-reader physical observations with one final template audit.

Every candidate is read once in small original-image batches. Slot assignment is
local and reuses those observations; model routes are fallbacks, never votes.
"""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from core import shenhui_shoe_fast as fast, llm_gateway as gateway

STRATEGY='single_model_observed'
BATCH_SIZE=6
SLOTS=fast.SLOTS
SCHEMA='''每个候选的字段：candidate_id；asset（shoe/box/insole/detail）；count（single/pair/none）；side（outer/inner/rear/front/sole/mixed/unknown）；axis（vertical/horizontal/diagonal/na，指画面鞋头到鞋跟连线方向，不是鞋底能否站住）；layout（grounded/front_sole/floating/na）；complete（布尔）；sole_full（布尔，完整外底正朝镜头）；lining（布尔，鞋口内里清晰可见）；card（布尔，实物鞋与功能卡同框，允许卡片遮住部分鞋身）；confidence（0到1）；evidence（25字内具体可见依据）。
outer/inner必须比较可见结构，不能只看鞋头向左还是向右。rear必须看见鞋跟后面。grounded=两完整鞋并列斜前方落地；front_sole=前鞋正常展示且后鞋完整鞋底朝镜头；floating=双鞋上下分离悬空。鞋垫不是鞋的完整外底。竖向外侧图的鞋头和鞋跟主要沿纵向排列，水平侧面鞋底着地仍是horizontal。'''
ENUMS={'asset':{'shoe','box','insole','detail'},'count':{'single','pair','none'},'side':{'outer','inner','rear','front','sole','mixed','unknown'},'axis':{'vertical','horizontal','diagonal','na'},'layout':{'grounded','front_sole','floating','na'}}
FLAGS=('complete','sole_full','lining','card')


def _shoe():return fast._shoe()


def validate_observation(row):
    s=_shoe()
    if not isinstance(row,dict):raise s.ShoeSelectionError('图片观察缺少对象')
    for key,values in ENUMS.items():
        if row.get(key) not in values:raise s.ShoeSelectionError('图片观察类型不合法：'+key)
    if any(type(row.get(k)) is not bool for k in FLAGS):raise s.ShoeSelectionError('图片观察缺少明确布尔特征')
    c=row.get('confidence')
    if type(c) not in (float,int) or not 0<=c<=1 or not row.get('evidence'):raise s.ShoeSelectionError('图片观察缺少置信度或可见依据')
    return dict(row)


def matches(row,slot,category):
    if row['asset']!='shoe':return False
    single=row['count']=='single';pair=row['count']=='pair'
    if slot=='yx':return (single or pair) and row['card']
    if not row['complete'] or row['card']:return False
    return {
        'tmz1':pair and row['layout']=='grounded',
        'tmz2':pair and row['layout']=='front_sole' and row['sole_full'],
        'yq1':pair and row['layout']=='front_sole' and row['sole_full'],
        'tmz3':single and row['side']=='outer' and row['axis']=='vertical',
        'tmz4':single and (row['lining'] and row['side'] in {'rear','outer','inner','mixed'} if category=='雪地' else row['side']=='rear'),
        # The standard's front/oblique view can have a vertical toe/heel axis.
        # Only tmz3 requires vertical *outer-side* presentation. The source
        # constraints and direct template match establish tmz5/wpz5 identity.
        'tmz5':single and row['side'] in {'outer','front','mixed'},
        'wpz5':single and row['side'] in {'outer','front','mixed'},
        # Existing yq2 contract requires a complete outsole, not one-shoe count.
        'yq2':(single or pair) and row['side']=='sole' and row['sole_full'],
        'yq3':single and row['side']=='outer' and row['axis']=='horizontal',
    }.get(slot,False)


def _request(ctx,prompt,images,phase):
    s=_shoe();errors=[]
    # Only transport/schema extraction failure can change routes here. No votes
    # and no repeated call to the same route in one operation.
    for model in ctx['routes'][:2]:
        try:return fast._request(ctx,model,prompt,images,phase)
        except s.ShoeSelectionError as exc:errors.append(str(exc))
    raise s.ShoeSelectionError('单次观察及备用路由失败：'+'；'.join(errors))


def _initial_rows(response,keys):
    mapping={str(i+1):k for i,k in enumerate(keys)}
    response=fast._normalize_image_ids(response,mapping)
    rows=response.get('candidates') if isinstance(response,dict) else None
    if not isinstance(rows,list) or len(rows)!=len(keys) or {r.get('candidate_id') for r in rows if isinstance(r,dict)}!=set(keys):
        raise _shoe().ShoeSelectionError('分批观察遗漏或虚构图片编号')
    return [validate_observation(r) for r in rows]


def analyze(**kwargs):
    s=_shoe();ids=kwargs['candidate_ids'];models=s._shoe_pose_model_ids(kwargs.get('model_id'),kwargs.get('config'),kwargs.get('fallback_model_ids'))
    routes=list(dict.fromkeys(models))
    ctx=dict(observed_strategy=True,style=kwargs['style_code'],color=kwargs['color_code'],category=kwargs['shoe_category'],
        ids=ids,entries={e['filename']:e for e in kwargs['candidate_entries']},routes=routes,primary=routes[0],
        config=kwargs.get('config'),log=kwargs.get('log') or (lambda x:None),progress=kwargs.get('progress'),root=str(Path(kwargs['contact_sheet']).parent),
        main_refs=kwargs['main_pose_reference_images'],yq_refs=kwargs['yq_reference_images'],main_sheet=kwargs['main_pose_reference_sheet'],
        yq_sheet=kwargs['yq_reference_image'],evidence_path=kwargs.get('pose_evidence_path'),observations={},batches=[])
    ctx['previews']={name:fast._readable_preview(ctx['entries'][name]['path'],Path(ctx['root'])/f'{ctx["color"]}-observed-{key}.jpg') for key,name in ids.items()}
    def batch(item):
        number,keys=item;images=[ctx['previews'][ids[k]] for k in keys]
        prompt=f"款号：{ctx['style']}\n色码：{ctx['color']}\n品类：{ctx['category']}\n逐张观察候选原图，不分配槽位。图片顺序与候选编号对应：{json.dumps({str(i+1):k for i,k in enumerate(keys)})}。只观察实际图片，不按文件名猜测。\n{SCHEMA}\n返回JSON candidates列表，每个编号一次，禁止漏项。"
        response,route=_request(ctx,prompt,images,f'原图观察批次{number}')
        return dict(index=number,ids={k:ids[k] for k in keys},images=images,response=response,observations=_initial_rows(response,keys),model=route.model_id)
    keys=list(ids);work=[(i//BATCH_SIZE+1,keys[i:i+BATCH_SIZE]) for i in range(0,len(keys),BATCH_SIZE)]
    with ThreadPoolExecutor(max_workers=2) as pool:ctx['batches']=list(pool.map(batch,work))
    ctx['observations']={r['candidate_id']:r for b in ctx['batches'] for r in b['observations']}
    # Complete compact pages are kept for a missed-candidate search in final
    # review, but initial observations see individual originals at full scale.
    ctx['pages']=[]
    for start in range(0,len(keys),12):
        subset=keys[start:start+12];p=Path(ctx['root'])/f'{ctx["color"]}-observed-pool-{start//12}.jpg'
        s._create_contact_sheet([{'filename':ids[k],'path':ctx['previews'][ids[k]]} for k in subset],p,candidate_labels=subset,columns=4,tile_width=360,image_height=320,quality=88)
        ctx['pages'].append(str(p))
    exact=next((k for k,n in ids.items() if s._is_tms_source_filename(n,ctx['style'],ctx['color'])),'')
    ctx['standard']=exact;ctx['mates']=fast._gray_mates(ctx,ids[exact]) if exact else []
    slots={'wpz':['']*6,'yq':['']*3}
    options=_choices(ctx)
    for slot in SLOTS:s._replace_consensus_slot_value(slots,slot,options[slot][0] if options[slot] else '')
    box=kwargs.get('verified_label_filename')
    if box:slots['wpz'][5]=next((k for k,n in ids.items() if n==box),'')
    return dict(color_name=ctx['color'],shoe_category=ctx['category'],slots=slots,_model_id=routes[0],_fast_context=ctx)


def _choices(ctx):
    s=_shoe();reserved={ctx.get('standard',''),*ctx.get('mates',[])}
    reserved_families={s._copy_variant_key(ctx['ids'][k]) for k in reserved if k}
    choices={}
    for slot in SLOTS:
        if slot=='tmz5' and ctx.get('standard'):choices[slot]=[ctx['standard']];continue
        if slot=='wpz5' and ctx.get('mates'):choices[slot]=ctx['mates'];continue
        ranked=sorted(ctx['observations'].items(),key=lambda kv:-kv[1]['confidence']);seen=set();options=[]
        for key,row in ranked:
            family=s._copy_variant_key(ctx['ids'][key])
            if family in reserved_families or family in seen or not matches(row,slot,ctx['category']):continue
            seen.add(family);options.append(key)
        choices[slot]=options[:3]
    return choices


def _validate_final(response,allowed,ctx):
    rows=response.get('reviews') if isinstance(response,dict) else None
    if not isinstance(rows,list) or any(not isinstance(r,dict) for r in rows):raise _shoe().ShoeSelectionError('终审没有槽位列表')
    names=[r.get('slot') for r in rows]
    if len(names)!=len(set(names)) or not set(allowed).issubset(names) or not set(names).issubset(SLOTS):raise _shoe().ShoeSelectionError('终审遗漏或重复槽位')
    approved={};rejected={}
    for row in rows:
        slot=row['slot']
        if slot not in allowed:continue  # Extra known slots cannot overwrite locked selections.
        key=row.get('candidate_id','')
        if slot=='yx' and row.get('absent') is True and not key and ctx.get('full_pool_shown'):
            approved[slot]='';continue
        if row.get('accepted') is not True or key not in allowed[slot]:rejected[slot]='无明确合格候选';continue
        observation=validate_observation(row.get('observation'))
        if observation.get('candidate_id')!=key:raise _shoe().ShoeSelectionError('终审事实与选择编号不一致')
        if not matches(observation,slot,ctx['category']) or observation['confidence']<.8:
            rejected[slot]='可见特征不满足姿势';continue
        if slot=='tmz3' and not fast._vertical_landmarks(observation,ctx['previews'][ctx['ids'][key]]):
            rejected[slot]='鞋头鞋跟不支持纵向展示';continue
        approved[slot]=ctx['ids'][key]
    return approved,rejected


def verify_selection(ctx,slots):
    s=_shoe();current={**slots,'wpz':list(slots['wpz']),'yq':list(slots['yq'])};pending=list(SLOTS);records=[];choices=_choices(ctx)
    for round_index in (1,2):
        target={slot:choices[slot] for slot in pending};panels=fast._review_panels(ctx,target,'observed-'+str(round_index),current)
        images=panels+ctx['pages'];ctx['full_pool_shown']=True
        reserved={ctx.get('standard',''),*ctx.get('mates',[])}
        reserved_families={s._copy_variant_key(ctx['ids'][k]) for k in reserved if k}
        locked={s._copy_variant_key(s._consensus_slot_value(current,slot)) for slot in SLOTS if slot not in pending and s._consensus_slot_value(current,slot)}
        allowed={slot:(choices[slot] if slot in {'tmz5','wpz5'} else [k for k,n in ctx['ids'].items() if s._copy_variant_key(n) not in reserved_families and (s._copy_variant_key(n) not in locked or slot in {'tmz2','yq1'})]) for slot in pending}
        prompt=f"款号：{ctx['style']}\n色码：{ctx['color']}\n品类：{ctx['category']}\n终审只处理：{json.dumps(pending)}。前{len(panels)}张图每行左侧REFERENCE是不可选模板，其余是初选；后{len(ctx['pages'])}张是完整候选。初选可能错误，允许从完整候选纠正，必须目视与模板逐项核对。\n{fast.RULES}\n每槽允许编号：{json.dumps(allowed)}\n{SCHEMA}\n返回JSON reviews，每个请求槽位一项：slot、candidate_id、accepted(bool)、absent(bool，仅yx可在核查全池确实无鞋加功能卡时为true)、observation（上述该图全部可见特征字段，含相同candidate_id）。主图3的observation另须提供toe_center和heel_center，各为[x,y]，是该候选单张原图内鞋头尖端及鞋跟后端的中心归一化坐标0..1，左上[0,0]。无法确定则拒绝。不要把正常着地水平侧面当作纵向图。只有tmz2与yq1可复用同图，其余不可复用。"
        response,route=_request(ctx,prompt,images,f'选图终审{round_index}')
        good,bad=_validate_final(response,allowed,ctx)
        # Resolve duplicates as rejected slots within the one remaining review,
        # rather than finishing the whole expensive pipeline then throwing.
        used={}
        for slot in SLOTS:
            name=good.get(slot,s._consensus_slot_value(current,slot) if slot not in pending else '')
            if not name:continue
            family=s._copy_variant_key(name)
            if family in used and {slot,used[family]}!={'tmz2','yq1'}:
                for conflict in (slot,used[family]):
                    if conflict in pending:good.pop(conflict,None);bad[conflict]='跨槽重复，需选择对应独立原图'
            used[family]=slot
        for slot,name in good.items():s._replace_consensus_slot_value(current,slot,name)
        records.append(dict(round=round_index,allowed=allowed,choices=target,response=response,approved=good,rejected=bad,model=route.model_id))
        if not bad:break
        pending=list(bad)
        # No repeated primary scan. Correct only failed slots on enlarged images.
        for slot in pending:
            keys=list(dict.fromkeys(choices[slot]+[k for k in allowed[slot] if ctx['observations'][k]['asset']=='shoe']))
            choices[slot]=keys[:4]
    if ctx.get('evidence_path'):Path(ctx['evidence_path']).write_text(json.dumps(dict(strategy=STRATEGY,style_code=ctx['style'],color_code=ctx['color'],batches=ctx['batches'],final_review=records),ensure_ascii=False,indent=2))
    if bad:raise s.ShoeSelectionError('单模型观察终审未通过：'+json.dumps(bad,ensure_ascii=False))
    if ctx.get('mates') and s._consensus_slot_value(current,'wpz5') not in {ctx['ids'][k] for k in ctx['mates']}:raise s.ShoeSelectionError('灰底没有匹配标准白底姿势')
    current['tms']=current['tmz5'];current,_=s._sync_wpz_main_slots(current);current=s._apply_o_category_rule(ctx['category'],current)
    current['_final_single_model_review']=dict(strategy=STRATEGY,rounds=len(records),rule_checks_passed=True)
    current.pop('_fast_context',None)
    return current
