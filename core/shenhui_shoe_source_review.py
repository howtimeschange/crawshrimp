"""Blind observations of selected sources, isolated from the comparison board.

Only the current selected image is sent. A cached observation never approves an
export: the board must also pass. Clear source-fact failures trigger repair;
missing/ambiguous observations stay unknown and preserve the source.
"""
from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import nullcontext
from pathlib import Path
from urllib.parse import urlsplit
import hashlib
import json

from PIL import Image, ImageOps
from core import llm_gateway as gateway, shenhui_shoe_fast as fast

VERSION = 'selected-source-blind-v4'
PROMPT = '''请仅描述所附这张商品原图实际可见内容，不评判合格与否，不猜文件名、款号或目标图位。
返回JSON {"images":[{"id":"S1","description":"简述鞋子数量、朝向、主要可见面","shoe_count":1,"view":"side|front_oblique|front|rear_oblique|rear|top|bottom|detail|unclear","foot_axis":"horizontal|vertical|diagonal|unclear","outsole_face":"full|partial|none|unclear","pair_arrangement":"grounded|floating|one_sole_facing_camera|not_pair|unclear","lining_closeup":false,"independent_function_card":false}]}。
view描述主要视面；明显俯看鞋口/鞋面上表面时为top或front_oblique，即使看见部分侧面也不能叫side。鞋轴为脚尖到脚跟，不是高靴靴筒方向。outsole_face只统计触地的大块花纹面，窄薄鞋底侧墙不算。lining_closeup只在鞋口内里是局部近景主体时true。
功能说明卡指有功能/材质/参数文字或示意图的独立纸卡，可以用绳挂在鞋上或摆在旁边；连接在鞋上不使它变成鞋身装饰。多张印有功能示意的吊卡也算。只有条码/尺码的小标签和固定在鞋面的IP饰物不算功能卡。
pair_arrangement中，one_sole_facing_camera表示一只正常展示、另一只露出完整外底，可以倾斜或靠在前鞋上；此分类必须与outsole_face=full一致。若只能看到局部外底就用pair_arrangement=unclear，不输出自相矛盾的观察。floating只表示明确上下分离、没有支撑的悬浮组合。不因后鞋露底或未平踩地面就说floating；无法辨认支撑和空间关系时为unclear。'''
SLOTS = {'tmz1', 'tmz2', 'tmz3', 'tmz4', 'yq2', 'yq3', 'yx'}
ENUMS = {'view': {'side', 'front_oblique', 'front', 'rear_oblique', 'rear', 'top', 'bottom', 'detail', 'unclear'},
         'foot_axis': {'horizontal', 'vertical', 'diagonal', 'unclear'},
         'outsole_face': {'full', 'partial', 'none', 'unclear'},
         'pair_arrangement': {'grounded', 'floating', 'one_sole_facing_camera', 'not_pair', 'unclear'}}


def validate(payload):
    rows = payload.get('images') if isinstance(payload, dict) else None
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        raise ValueError('原图盲审缺少唯一观察')
    row = rows[0]
    if (row.get('id') != 'S1' or not isinstance(row.get('description'), str) or not row['description'].strip()
            or type(row.get('shoe_count')) is not int or row['shoe_count'] < 0
            or any(not isinstance(row.get(k), str) or row[k] not in values for k, values in ENUMS.items())
            or any(type(row.get(k)) is not bool for k in ('lining_closeup', 'independent_function_card'))):
        raise ValueError('原图盲审事实缺失或格式错误')
    if row['pair_arrangement'] == 'one_sole_facing_camera' and row['outsole_face'] != 'full':
        raise ValueError('原图观察自身矛盾：双鞋完整外底构图与外底可见范围不一致，保留原图待复核')
    return row


def assess(item, observation):
    """Coarse contradictions only; perspective/axis precision stays on the board."""
    row = validate({'images': [observation]})
    slot, category = item['semantic'], item['category']
    count, view = row['shoe_count'], row['view']
    expected = {'tmz1': 2, 'tmz2': 2, 'tmz3': 1, 'tmz4': 1, 'yq3': 1}.get(slot)
    failures, unknown = [], []
    if (expected is not None and count != expected) or (slot == 'yx' and count < 1):
        failures.append('原图鞋只数不符合图位')
    if row['independent_function_card'] != (slot == 'yx'):
        failures.append('原图功能卡与实物鞋同框情况不符合图位')
    if slot in {'tmz3', 'yq3'}:
        if view == 'unclear':
            unknown.append('主要视面不明')
        elif view not in ({'side', 'rear_oblique'} if slot == 'tmz3' else {'side'}):
            failures.append('原图主要是' + view + '，不是完整鞋侧面')
    if slot in {'tmz2', 'yq2'}:
        if row['outsole_face'] == 'unclear':
            unknown.append('完整外底不明')
        elif row['outsole_face'] != 'full':
            failures.append('原图没有完整朝向镜头的外底触地花纹面')
    if slot == 'tmz2':
        if row['pair_arrangement'] == 'floating':
            failures.append('原图双鞋为上下分离悬浮组合')
        elif row['pair_arrangement'] == 'unclear':
            unknown.append('双鞋支撑与空间关系不明')
    if slot == 'tmz1':
        if row['pair_arrangement'] == 'unclear':
            unknown.append('双鞋摆放不明')
        elif row['pair_arrangement'] != 'grounded':
            failures.append('原图不是双鞋并列落地')
    if slot == 'tmz4' and category == '雪地' and not row['lining_closeup']:
        failures.append('原图不是鞋口内里占主体的局部近景')
    reason = row['description']
    if failures:
        return 'source_invalid', reason + '；独立原图事实：' + '；'.join(failures)
    if unknown:
        return 'review_unknown', reason + '；' + '；'.join(unknown)
    return 'consistent', reason


def observe(item, root):
    ctx = item['ctx']
    routes = list(ctx.get('direct_review_routes') or ctx['routes'])
    identities = []
    for model in routes:
        try:
            route = gateway.route_for_model(model, ctx.get('config'))
            endpoint = urlsplit(route.base_url)
            identities.append([model, route.model_id, endpoint.scheme, endpoint.hostname, endpoint.port, endpoint.path])
        except gateway.LlmConfigurationError:
            identities.append([model])
    source_hash = hashlib.sha256(Path(item['source_path']).read_bytes()).hexdigest()
    key = hashlib.sha256(json.dumps([VERSION, PROMPT, source_hash, identities,
                                    item.get('source_review_revision', 0)], ensure_ascii=False).encode()).hexdigest()
    state = ctx.get('model_state')
    cache = getattr(state, 'source_review_cache', None)
    lock = getattr(state, 'lock', None)
    owner = True
    future = Future()
    if cache is not None:
        with lock:
            if key in cache:
                future, owner = cache[key], False
            else:
                cache[key] = future
    if not owner:
        return {**future.result(), 'reused_source_observation': True}
    root = Path(root) / 'source-facts'
    root.mkdir(parents=True, exist_ok=True)
    evidence_path = root / (key + '.json')
    evidence = {'version': VERSION, 'source_sha256': source_hash, 'requested_routes': identities,
                'source_review_revision': item.get('source_review_revision', 0)}
    try:
        image_path = root / (key + '.jpg')
        gate = getattr(state, 'image_work', None)
        with gate if gate is not None else nullcontext():
            with Image.open(item['source_path']) as image:
                image = ImageOps.exif_transpose(image).convert('RGB')
                image.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
                image.save(image_path, quality=94)
        evidence['request'] = {'prompt': PROMPT, 'images': [str(image_path)],
            'input_sha256': hashlib.sha256(image_path.read_bytes()).hexdigest()}
        payload, route = fast._request({**ctx, 'pipeline_stage': 'export_review',
            'request_purpose': 'source_fact_guard', 'system_prompt': '你是图像观察员，只描述单张原图可见事实并输出JSON。',
            'transport_fallback_routes': routes[1:]}, routes[0], PROMPT, [str(image_path)], '已选原图独立事实核验')
        observation = validate(payload)
        evidence.update(response=payload, actual_model=route.model_id)
        result = {'observation': observation, 'model': route.model_id, 'evidence_path': str(evidence_path)}
        # Unknown observations are retryable. Known observations are shared by
        # all alias exports, even when their board rows were on separate pages.
        cacheable = all(observation[k] != 'unclear' for k in ENUMS)
    except (OSError, ValueError, gateway.LlmGatewayError) as exc:
        evidence['error'] = str(exc)
        result, cacheable = {'error': str(exc), 'evidence_path': str(evidence_path)}, False
    except BaseException:
        if cache is not None:
            with lock:
                cache.pop(key, None)
        future.set_exception(RuntimeError('原图观察任务中断'))
        raise
    try:
        evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
    finally:
        if not cacheable and cache is not None:
            with lock:
                cache.pop(key, None)
        future.set_result(result)
    return result


def guard_accepted(items, results, root):
    def contradictory(verdict):
        response = verdict.get('response') or {}
        checks = response.get('source_checks') or {}
        return (verdict['status'] == 'review_unknown' and response.get('source_match') is True
                and any(value is False for value in checks.values()))
    def disputed_pair(item):
        verdict = results[item['row_id']]
        response = verdict.get('response') or {}
        checks = response.get('source_checks') or {}
        return (item['semantic'] == 'tmz2' and verdict['status'] == 'source_invalid'
                and checks.get('no_floating') is False
                and all(value is True for key, value in checks.items() if key != 'no_floating'))
    def pose_conflict(item):
        from core.shenhui_shoe_board_review import POSE_REQUIREMENTS
        verdict = results[item['row_id']]
        response = verdict.get('response') or {}
        allowed = POSE_REQUIREMENTS.get(item['semantic'])
        if item['semantic'] == 'tmz4':
            allowed = {'lining_detail'} if item['category'] == '雪地' else {'rear_oblique'}
        return (verdict['status'] == 'review_unknown' and allowed
                and isinstance(response.get('candidate_pose'), str)
                and response['candidate_pose'] not in allowed | {'unclear'}
                and all(value is True for value in (response.get('source_checks') or {}).values()))
    def disputed_axis(item):
        axis = {'tmz3': 'vertical_toe_heel_axis', 'yq3': 'horizontal_side_view'}.get(item['semantic'])
        verdict = results[item['row_id']]
        checks = (verdict.get('response') or {}).get('source_checks') or {}
        response = verdict.get('response') or {}
        axis_only = (item['semantic'] != 'yq3' or (response.get('candidate_pose') == 'side_horizontal'
                     and (response.get('candidate_facts') or {}).get('view') == 'side'))
        return (axis and axis_only and verdict['status'] == 'source_invalid' and checks.get(axis) is False
                and all(value is True for key, value in checks.items() if key != axis))
    targets = [item for item in items if item['semantic'] in SLOTS
               and (results[item['row_id']]['status'] in {'accepted', 'export_invalid'} or contradictory(results[item['row_id']])
                    or disputed_pair(item) or pose_conflict(item) or disputed_axis(item))]
    def work(item):
        observed = observe(item, root)
        if 'error' in observed:
            return item, observed, 'review_unknown', '独立原图观察未完成：' + observed['error']
        status, reason = assess(item, observed['observation'])
        verdict = results[item['row_id']]
        if (status == 'consistent' and disputed_axis(item)
                and observed['observation']['foot_axis'] == ('vertical' if item['semantic'] == 'tmz3' else 'horizontal')):
            status = 'review_unknown'
            reason += '；独立原图鞋轴与看板方向拒绝冲突，保留原图放大复核'
        if (status == 'consistent' and disputed_pair(item)
                and observed['observation']['pair_arrangement'] == 'one_sole_facing_camera'):
            status = 'review_unknown'
            reason += '；独立原图与看板的悬浮判断冲突，保留候选并放大复核'
        # A total "match" can mean template similarity while a required pose
        # check explicitly fails. Resolve only when blind source facts also
        # substantiate that failure; a second positive never promotes unknown.
        if (status == 'consistent' and contradictory(verdict) and item['semantic'] == 'tmz4'
                and item['category'] != '雪地'
                and verdict['response']['source_checks'].get('heel_back_visible') is False
                and observed['observation']['view'] in {'side', 'front', 'front_oblique', 'top'}):
            status = 'source_invalid'
            reason += '；看板后跟检查未满足，独立原图也未观察到后侧视面'
        if (status == 'consistent' and pose_conflict(item) and item['semantic'] == 'tmz4'
                and item['category'] != '雪地'
                and verdict['response'].get('candidate_pose') in {'side_horizontal', 'side_upright', 'front_oblique', 'top_opening'}
                and observed['observation']['view'] in {'side', 'front', 'front_oblique', 'top'}):
            status = 'source_invalid'
            reason += '；看板拍摄类型与独立原图均不支持后侧视角'
        return item, observed, status, reason
    with ThreadPoolExecutor(max_workers=min(8, max(1, len(targets)))) as executor:
        for item, observed, status, reason in executor.map(work, targets):
            verdict = results[item['row_id']]
            verdict['source_observation'] = observed
            if status != 'consistent':
                verdict.update(status=status, accepted=False, reason=reason)
    return results
