"""Observe each source once, then assign all slots under shared source constraints.

Observations propose candidates. Only the exported-file reviewer can approve them.
"""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import os
from PIL import Image

VERSION = 'shoe-observations-v2'
PROMPT = '''逐张观察商品素材，不匹配任何模板、不选图、不沿用文件名猜姿势。每张图片对应提供的编号。
返回JSON candidates数组，每个编号恰好一项：candidate_id、kind、complete(bool)、shoe_count(int)、side_zipper(bool或null)、side_marks(简短文字)、evidence(简短可见依据)、facts对象。
kind取pair_grounded(完整双鞋并排落地斜前展示)、pair_front_sole(前鞋正常展示且后鞋完整鞋底朝镜头)、pair_floating(双鞋上下分离)、single_upright_outer(完整单鞋纵向外侧)、single_rear(完整单鞋侧后)、single_rear_sole(单鞋侧后露底)、single_oblique(单鞋斜前/前/俯视)、single_outer_flat(水平外侧)、single_inner_flat(水平内侧)、outsole_flat(完整外底朝镜头)、opening_lining(鞋口内里及鞋帮)、shoe_with_card(实物鞋与独立功能卡同框)、shoe_box、insole、other。
高筒靴的鞋轴是鞋底脚尖到脚跟的方向，不是靴筒方向。侧后必须鞋跟近、鞋头远、可见朝后的后跟弧面；仅见后半段侧面不是侧后。鞋子固定装饰不算独立功能卡。被卡遮挡的实物鞋仍属于shoe_with_card。
扣在鞋带、魔术贴或鞋面上的卡通挂饰、毛绒吊饰、IP徽章属于鞋身装饰；即使悬垂也不能仅凭形状或挂法判成独立功能卡。功能卡是独立商品说明载体，展示功能、材质文字、参数或示意图；不要把装饰图案臆测成性能说明。
facts字段：background_kind=plain_white/plain_gray/studio_gradient/scene/unclear；independent_cards(bool)；toe和heel为鞋底最前和最后端的归一化[x,y]，非实物鞋可为null；near_end=heel/toe/neither/unclear；heel_back_visible(bool)；view=side/rear_oblique/rear/front_oblique/front/top/bottom/unclear；outsole_tread_visible、upper_side_visible、lining_visible均bool。触地鞋底花纹面和鞋底侧墙不同。背景允许局部落地阴影，大片摄影棚光斑或渐变不算纯底。看不清就记录unclear，不编造。'''
INDEPENDENT = ('tmz1','tmz2','tmz3','tmz4','tmz5','yq2','yq3','yx')


def validate_rows(payload, keys):
    from core.shenhui_shoe_fast import KINDS
    from core.shenhui_shoe_packaging import ShoeSelectionError
    rows = payload.get('candidates') if isinstance(payload,dict) else None
    if (not isinstance(rows,list) or len(rows)!=len(keys)
            or any(not isinstance(r,dict) or not isinstance(r.get('candidate_id'),str) for r in rows)
            or {r['candidate_id'] for r in rows} != set(keys)):
        raise ShoeSelectionError('候选观察遗漏、重复或虚构编号')
    for row in rows:
        facts=row.get('facts')
        if (row.get('kind') not in KINDS or type(row.get('complete')) is not bool
                or type(row.get('shoe_count')) is not int or row['shoe_count']<0
                or not isinstance(row.get('evidence'),str) or not row['evidence'].strip()
                or not isinstance(facts,dict)):
            raise ShoeSelectionError('候选观察缺少完整事实')
        if any(type(facts.get(k)) is not bool for k in ('independent_cards','heel_back_visible',
                'outsole_tread_visible','upper_side_visible','lining_visible')):
            raise ShoeSelectionError('候选观察布尔事实无效')
    return rows


def observe(ctx, keys=None):
    from core import shenhui_shoe_fast as fast, llm_gateway as gateway, shenhui_shoe_template_match as direct
    from core.shenhui_shoe_packaging import ShoeSelectionError
    root=Path(ctx.setdefault('catalog_root',str(Path(ctx['root'])/'candidate-catalog')))
    root.mkdir(parents=True,exist_ok=True)
    route=ctx['routes'][0]
    # Route identity excludes credentials. Config changes to a different endpoint invalidate facts.
    try:
        actual=gateway.route_for_model(route,ctx.get('config'))
        from urllib.parse import urlsplit
        endpoint=urlsplit(actual.base_url)
        identity=[route,actual.model_id,endpoint.scheme,endpoint.hostname,endpoint.port,endpoint.path]
    except gateway.LlmConfigurationError:
        identity=[route]
    requested = set(ctx['ids'] if keys is None else keys)
    by_hash={};result={key:value for key,value in (ctx.get('candidate_observations') or {}).items() if key not in requested};missing=[]
    for key,name in ctx['ids'].items():
        if key not in requested:continue
        path=Path(ctx['previews'][name]);digest=hashlib.sha256(path.read_bytes()).hexdigest()
        cache_key=hashlib.sha256(json.dumps([VERSION,PROMPT,digest,identity],ensure_ascii=False).encode()).hexdigest()
        by_hash.setdefault(cache_key,[]).append(key)
    for cache_key,keys in by_hash.items():
        target=root/(cache_key+'.json')
        try:
            saved=json.loads(target.read_text())
            validate_rows({'candidates':[dict(saved['observation'],candidate_id=keys[0])]},[keys[0]])
            for key in keys:result[key]=dict(saved['observation'],candidate_id=key,actual_model=saved.get('actual_model'))
        except (OSError,ValueError,KeyError,ShoeSelectionError):
            missing.append((cache_key,keys[0]))
    def batch(items):
        keys=[key for _,key in items]
        prompt=(f"款号：{ctx['style']}\n色码：{ctx['color']}\n阶段：候选独立观察\n图片按顺序对应编号："
                +json.dumps(keys)+'\n'+PROMPT)
        prompt += '\n各图上沿及侧边背景像素实测：'+json.dumps({
            key:direct.background_perimeter_evidence(ctx['previews'][ctx['ids'][key]]) for key in keys
        },ensure_ascii=False)+'。边缘均匀且内部仅有局部落地阴影时，属于纯底；实测不代替内部场景观察。'
        payload,actual=fast._request({**ctx,'pipeline_stage':'candidate_observation'},route,prompt,
            [ctx['previews'][ctx['ids'][key]] for key in keys],'候选独立观察')
        rows=validate_rows(payload,keys);lookup={r['candidate_id']:{**r,'actual_model':actual.model_id} for r in rows}
        for cache_key,key in items:
            record={'version':VERSION,'requested_route':identity,'actual_model':actual.model_id,'observation':lookup[key]}
            temp=root/(cache_key+'.tmp');temp.write_text(json.dumps(record,ensure_ascii=False,indent=2));os.replace(temp,root/(cache_key+'.json'))
        return {key:lookup[representative] for cache_key,representative in items for key in by_hash[cache_key]}
    chunks=[missing[i:i+4] for i in range(0,len(missing),4)]
    errors={key:value for key,value in ctx.get('observation_errors',{}).items() if key not in requested}
    def bounded_batch(items):
        try:return batch(items),{}
        except (ShoeSelectionError,gateway.LlmGatewayError) as exc:
            return {},{key:str(exc) for cache_key,_ in items for key in by_hash[cache_key]}
    with ThreadPoolExecutor(max_workers=min(4,max(1,len(chunks)))) as pool:
        for fresh,failed in pool.map(bounded_batch,chunks):
            result.update({key:dict(value,candidate_id=key) for key,value in fresh.items()});errors.update(failed)
    ctx['candidate_observations']=result
    ctx['observation_errors']=errors
    ctx['deferred_observation_ids'] = [key for key in ctx['ids'] if key not in result and key not in errors]
    (root/'index.json').write_text(json.dumps({'version':VERSION,'observed':result,'unknown':errors,
        'deferred':ctx['deferred_observation_ids']},ensure_ascii=False,indent=2))
    return result


def options(ctx, observations):
    from core import shenhui_shoe_packaging as shoe, shenhui_shoe_template_match as direct
    choices={slot:[] for slot in INDEPENDENT}
    exact=next((key for key,name in ctx['ids'].items() if shoe._is_tms_source_filename(name,ctx['style'],ctx['color'])),None)
    for key,row in observations.items():
        name=ctx['ids'][key];facts=row['facts'];kind=row['kind'];count=row['shoe_count']
        if name == ctx.get('verified_label_filename'):
            continue
        with Image.open(ctx['previews'][name]) as image:size=image.size
        perimeter=direct.background_perimeter_evidence(ctx['previews'][name])
        possible={
            'tmz1':kind=='pair_grounded' and count==2 and row['complete'],
            'tmz2':kind=='pair_front_sole' and count==2 and row['complete'],
            'tmz3':count==1 and row['complete'] and kind!='single_inner_flat',
            'tmz4':count==1 and row['complete'],
            'tmz5':count==1 and row['complete'] and kind not in {'outsole_flat','insole','shoe_box','other'},
            # A sole-only photograph may report zero visible shoe bodies.
            'yq2':kind=='outsole_flat' and row['complete'],
            'yq3':count==1 and row['complete'] and kind!='single_inner_flat',
            'yx':kind=='shoe_with_card' and count>=1,
        }
        for slot,allowed in possible.items():
            if not allowed:continue
            failures=direct.visual_fact_failures(slot,facts,size,ctx['category'],perimeter)
            # Observation is retrieval evidence, not the final verdict. An uncertain
            # background must not hide the only usable pose from the real reviewer.
            uncertain_background=(facts.get('background_kind') in {'studio_gradient','unclear'}
                and perimeter['luminance_p05'] >= 175
                and perimeter['luminance_p95']-perimeter['luminance_p05'] <= 20
                and perimeter['neutral_fraction'] >= .95)
            if uncertain_background:
                failures=[f for f in failures if f!='背景不是均匀纯白或纯灰底']
            if failures:continue
            score=10.0
            if uncertain_background:score-=3
            if slot=='yq2':
                score+=5 if facts.get('view')=='bottom' else 0
                score+=5 if facts.get('upper_side_visible') is False else 0
            if slot=='tmz5':
                score+=30 if key==exact else 0
                score+=5 if facts['background_kind']=='plain_white' else 0
                score+=6 if facts.get('view') in {'front','front_oblique','top'} else 0
            expected={'tmz3':'single_upright_outer','yq3':'single_outer_flat'}
            if slot=='tmz4':
                expected['tmz4']=('single_rear_sole' if ctx['category']=='运动' else
                                  'opening_lining' if ctx['category']=='雪地' else 'single_rear')
            if kind==expected.get(slot):score+=2
            mask_rows = ctx.get('mask_plan',{}).get('by_slot',{}).get(slot,{}).get('ranked',[])
            score += 4 * next((r['score'] for r in mask_rows if r['candidate_id']==key),0)
            choices[slot].append((key,score))
    # Independent observations can mislabel a visible outer side as a sole.
    # Keep the geometric top three in the list so only the real template reviewer
    # can eliminate them, but geometry only orders inside its own tier now:
    # the previous 20 + 6*score outranked every semantic observation (10-12) and
    # silently replaced a model-backed choice with a silhouette look-alike.
    # Geometry therefore adds no score to candidates that already have evidence.
    for slot in ('tmz1','tmz2','tmz3','tmz4','yq2','yq3'):
        known = dict(choices[slot])
        ranked = [row for row in ctx.get('mask_plan',{}).get('by_slot',{}).get(slot,{}).get('ranked',[])
                  if ctx['ids'].get(row['candidate_id']) != ctx.get('verified_label_filename')]
        for row in ranked[:3]:
            key = row['candidate_id']
            if key not in ctx['ids'] or not row.get('mask_valid') or row.get('score',0) <= 0:
                continue
            if key not in known:
                known[key] = 6.0 + min(1.0, row['score'])
        choices[slot] = list(known.items())
    # Keep the known standard and strict foreground mates for their source contract.
    if exact and any(k==exact for k,_ in choices['tmz5']):
        from core.shenhui_shoe_fast import _gray_mates
        reserved={exact,*_gray_mates(ctx,ctx['ids'][exact])}
        for slot in INDEPENDENT:
            if slot!='tmz5':choices[slot]=[(k,v) for k,v in choices[slot] if k not in reserved]
    return {slot:sorted(values,key=lambda kv:(-kv[1],kv[0])) for slot,values in choices.items()}


def assign(choices, families, locked=None, observations=None):
    """Beam search prioritizes coverage, then evidence score; empty is always legal."""
    locked=dict(locked or {});observations=observations or {}
    used={families[key] for key in locked.values() if key}
    states=[(0,0.0,locked,used)]
    pending=sorted((slot for slot in choices if slot not in locked),key=lambda s:len(choices[s]))
    for slot in pending:
        expanded=[]
        for count,score,selected,taken in states:
            for key,value in [*choices[slot],('',0)]:
                if key and families[key] in taken:continue
                proposal={**selected,slot:key}
                a,b=proposal.get('tmz3'),proposal.get('yq3')
                # Accepted locked slots take precedence over old retrieval
                # observations. Check this dependency only when adding a
                # side slot; otherwise conflicting old facts can remove even
                # every empty branch for an unrelated slot.
                if slot in {'tmz3', 'yq3'} and a and b:
                    za=observations.get(a,{}).get('side_zipper');zb=observations.get(b,{}).get('side_zipper')
                    if type(za) is bool and type(zb) is bool and za!=zb:continue
                expanded.append((count+bool(key),score+value,proposal,taken|({families[key]} if key else set())))
        expanded.sort(key=lambda item:(-item[0],-item[1],tuple(sorted(item[2].items()))))
        states=expanded[:512]
    return states[0][2]


def propose(ctx):
    from core import shenhui_shoe_packaging as shoe, shenhui_shoe_fast as fast
    observations=ctx.get('candidate_observations')
    if observations is None:
        if ctx.get('mask_shortlist'):
            from core.shenhui_shoe_mask_rank import prepare_shortlists
            plan=ctx.get('mask_plan') or prepare_shortlists(ctx)
            observations=observe(ctx,plan['initial_ids'])
        else:observations=observe(ctx)
    choices=options(ctx,observations)
    for slot,rejected_names in ctx.get('rejected_candidates',{}).items():
        rejected_families={shoe._copy_variant_key(name) for name in rejected_names}
        if slot in choices:choices[slot]=[(k,v) for k,v in choices[slot] if shoe._copy_variant_key(ctx['ids'][k]) not in rejected_families]
    locked={slot:key for slot,key in ctx.get('locked_selections',{}).items() if slot in INDEPENDENT and key}
    families=candidate_families(ctx)
    selected=assign(choices,families,locked,observations)
    if ctx.get('mask_shortlist') and not selected.get('yx'):
        # A shortlist cannot prove a card is absent. Inspect every original in
        # compact pages once; a found card still needs the exported reviewer.
        from core.shenhui_shoe_sequential import inspect_card_pool
        presence=ctx.get('card_presence')
        if presence is None:
            try:
                name,evidence=inspect_card_pool(ctx,ctx['routes'][0])
                presence={'filename':name,'all_candidates_inspected':True,'evidence':evidence}
                ctx['card_presence']=presence
                (Path(ctx['root'])/'card-presence.json').write_text(json.dumps(presence,ensure_ascii=False,indent=2))
            except shoe.ShoeSelectionError as exc:
                ctx['card_presence_error']=str(exc)
        if presence and presence['all_candidates_inspected']:
            name=presence['filename']
            if name:
                key=next((key for key,value in ctx['ids'].items() if value==name),None)
                used={families[k] for k in selected.values() if k}
                bad={shoe._copy_variant_key(n) for n in ctx.get('rejected_candidates',{}).get('yx',[])}
                if key and families[key] not in used and shoe._copy_variant_key(name) not in bad:
                    selected['yx']=key
            else:ctx['card_absence_verified']=True
    records=[];missing={}
    for slot in INDEPENDENT:
        key=selected.get(slot,'')
        record={'slot':slot,'selected':key,'source':'catalog_global_assignment','model':observations.get(key,{}).get('actual_model') or ctx['routes'][0],
                'candidate_options':[{'id':k,'score':v} for k,v in choices[slot]],'attempts':[]}
        if key:record['observation']=observations.get(key,{})
        elif not (slot=='yx' and ctx.get('card_absence_verified')):
            reason='候选观察未完成' if ctx.get('observation_errors') else ('候选分配冲突' if choices[slot] else '当前观察未找到匹配，需补充检索')
            missing[slot]=reason;record['error']=reason
        records.append(record)
    if selected.get('tmz2'):selected['yq1']=selected['tmz2']
    if selected.get('tmz5'):
        standard=ctx['ids'][selected['tmz5']];mates=fast._gray_mates(ctx,standard)
        selected['wpz5']=mates[0] if mates else selected['tmz5']
        # White and pale gray are easily confused by the model. Record the
        # numeric source background policy before the independent review.
        ctx['gray_standard']=shoe._binary_pose_feature(ctx['previews'][standard]).background_luma < shoe.SHOE_WHITE_BACKGROUND_LUMA
    result={'selected':{slot:ctx['ids'][key] if key else '' for slot,key in selected.items()},
            'records':records,'mechanical_complete':not missing,'remaining':[],
            'card_absence_verified':bool(ctx.get('card_absence_verified')),'proposal_missing':missing,'catalog_version':VERSION,
            'mask_shortlist':{'initial_count':len(ctx.get('mask_plan',{}).get('initial_ids',[])),
                              'observed_count':len(observations),'total_count':len(ctx['ids'])} if ctx.get('mask_shortlist') else None}
    (Path(ctx['root'])/'global-assignment.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    return result


def candidate_families(ctx):
    from core import shenhui_shoe_packaging as shoe, shenhui_shoe_fast as fast
    families={key:shoe._copy_variant_key(name) for key,name in ctx['ids'].items()}
    for key,name in ctx['ids'].items():
        for mate in fast._gray_mates(ctx,name):
            old,new=families[mate],families[key]
            families={k:new if value==old else value for k,value in families.items()}
    return families


def repair(ctx, selection):
    """Reassign or retrieve proposals only; the exported reviewer owns all verdicts."""
    from core import shenhui_shoe_packaging as shoe, shenhui_shoe_template_match as direct
    previous=selection['_sequential_result']['selected']
    pending=set(selection.get('_pending_slots',{}))
    if 'tmz3' in pending:pending.add('yq3')
    if 'tmz2' in pending:pending.add('yq1')
    if 'tmz5' in pending:pending.add('wpz5')
    reverse={name:key for key,name in ctx['ids'].items()}
    rejected={slot:list(names) for slot,names in ctx.get('rejected_candidates',{}).items()}
    for slot in selection.get('_invalid_sources',set()):
        name=previous.get(slot)
        if name and name not in rejected.setdefault(slot,[]):rejected[slot].append(name)
    root=Path(ctx['root'])/('repair-'+str(len(selection.get('_repair_history',[]))+1));root.mkdir(exist_ok=True)
    local={**ctx,'root':str(root),'pipeline_stage':'repair','proposal_only':True,
           'rejected_candidates':rejected,'locked_selections':{
             slot:reverse[name] for slot,name in previous.items() if slot not in pending and name in reverse}}
    # Retry only observations that previously had no complete response, preserving known facts.
    if ctx.get('observation_errors') or (ctx.get('deferred_observation_ids') and any(slot in INDEPENDENT for slot in pending)):
        # Expand only when unresolved slots require it. Cache reuses every
        # completed first-pass observation; deferred images are not missing.
        local['candidate_observations']=observe(local)
    result=propose(local)
    for slot in INDEPENDENT:
        if slot not in pending or result['selected'].get(slot):continue
        used={shoe._copy_variant_key(name) for name in result['selected'].values() if name}
        bad={shoe._copy_variant_key(name) for name in rejected.get(slot,[])}
        pool=[key for key,name in ctx['ids'].items() if shoe._copy_variant_key(name) not in used|bad]
        anchor=result['selected'].get('tmz3') if slot=='yq3' else None
        if slot=='yq3' and not anchor:continue
        refs=[direct.reference(local,slot)]
        if anchor:refs.append(ctx['previews'][anchor])
        if not pool:continue
        try:
            payload,route,attempts=direct.select_inventory({**local,'side_anchor':anchor,
                'repair_rejections':selection.get('_pending_slots',{})},ctx['routes'][0],slot,pool,bool(anchor),refs)
            key=payload.get('candidate_id')
            if payload.get('accepted') is True and key in pool:
                result['selected'][slot]=ctx['ids'][key]
                result['proposal_missing'].pop(slot,None)
            result['records'].append({'slot':slot,'source':'expanded_pool_retrieval','model':route.model_id,
                                      'selected':key,'attempts':attempts})
        except shoe.ShoeSelectionError as exc:
            result['proposal_missing'][slot]='补充检索未完成：'+str(exc)
    if result['selected'].get('tmz2'):result['selected']['yq1']=result['selected']['tmz2']
    if result['selected'].get('tmz5'):
        from core.shenhui_shoe_fast import _gray_mates
        standard=result['selected']['tmz5'];mates=_gray_mates(ctx,standard)
        result['selected']['wpz5']=ctx['ids'][mates[0]] if mates else standard
        local['gray_standard']=shoe._binary_pose_feature(ctx['previews'][standard]).background_luma < shoe.SHOE_WHITE_BACKGROUND_LUMA
    ctx.update(rejected_candidates=rejected,candidate_observations=local.get('candidate_observations',{}),
               observation_errors=local.get('observation_errors',{}),gray_standard=local.get('gray_standard',False),
               deferred_observation_ids=local.get('deferred_observation_ids',[]),
               card_presence=local.get('card_presence'),card_absence_verified=local.get('card_absence_verified',False))
    selection.setdefault('_repair_history',[]).append({'pending':sorted(pending),'root':str(root)})
    (root/'repair-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    return result
