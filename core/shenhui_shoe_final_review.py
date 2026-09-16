"""One independent review of source semantics and all derived files, in parallel."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
import hashlib
import json
import copy
from pathlib import Path
from PIL import Image

REVIEW_VERSION = 'grouped-export-v5'
MAX_UNCHANGED_UNKNOWN_ATTEMPTS = 2


def prepare_export_records(selection, rows):
    from core import shenhui_shoe_packaging as shoe
    from core import shenhui_shoe_template_match as direct
    from core import shenhui_shoe_sequential as sequence

    ctx = {**selection['_sequential_context'], 'pipeline_stage':'export_review',
           'prior_selection_evidence':{'selected':selection.get('_sequential_result', {}).get('selected', {}),
             'records':selection.get('_sequential_result', {}).get('records', [])}}
    root = Path(ctx['root']) / 'export-review'
    root.mkdir(parents=True, exist_ok=True)
    (root/'review-context.json').write_text(json.dumps({
        'version':REVIEW_VERSION, 'category':ctx['category'],
        'templates':{'main':ctx.get('main_refs', []), 'detail':ctx.get('yq_refs', {})},
        'candidate_pool':ctx.get('ids', {}), 'candidate_images':ctx.get('previews', {}),
        'previous_selection':ctx['prior_selection_evidence'],
        'exports':[{k:r.get(k) for k in ('规则槽位','原文件名','本地文件')} for r in rows],
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    rejected, records, groups = {}, [], {}
    if not rows:
        rejected['_manifest'] = '该款色缺少导出清单，不能判定成品通过'
    for row in rows:
        slot, source = row.get('规则槽位',''), row.get('原文件名','')
        if slot in {'原始素材','鞋盒OCR'}:
            continue
        semantic = shoe._semantic_vote_slot(slot, ctx['category'])
        semantic = {'wpz5':'tmz5', 'yq1':'tmz2'}.get(semantic, semantic)
        path = Path(row['本地文件']) if row.get('本地文件') else None
        record = {'slot':slot, 'semantic':semantic, 'path':str(path) if path else '',
                  'source':source, 'accepted':False, 'status':'export_invalid'}
        records.append(record)
        if path is None:
            if semantic == 'yx' and selection.get('_sequential_result',{}).get('card_absence_verified'):
                record.update(status='optional_absent',reason='完整候选池已核验无功能卡素材；固定图位统计保留该缺失项')
                continue
            # Absence of a proposal is different from a broken derived file.
            if semantic in sequence.ORDER:
                record['status'] = 'source_missing'
            record['reason'] = row.get('规则告警') or '图位没有导出文件'
            rejected[semantic] = record['reason']
            continue
        try:
            record['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
            if slot == 'wpt30' and path.stat().st_size >= shoe.SHOE_WPT_MAX_BYTES:
                raise ValueError('WPT 保留画质后超过600KB，文件已保留，需人工处理')
            with Image.open(path) as image:
                image.load()
                if slot in {'tmq','tmt','jdt'} and image.size != (800,800):
                    raise ValueError('渠道图必须为800x800')
                if slot in {'tmt','jdt','wpt30'}:
                    alpha_min, alpha_max = image.convert('RGBA').getchannel('A').getextrema()
                    if alpha_min == 255 or alpha_max == 0:
                        raise ValueError('渠道图缺少有效透明通道')
            if semantic in sequence.ORDER:
                if shoe._consensus_slot_value(selection, slot) != source:
                    raise ValueError('导出源图与最终选择不一致')
                canonical = shoe._consensus_slot_value(selection, semantic)
                if canonical not in ctx['previews'] or source not in ctx['previews']:
                    raise ValueError('缺少原图证据')
                groups.setdefault((semantic,canonical), []).append(record)
            elif ctx.get('board_review'):
                if source not in ctx['previews'] and source not in ctx.get('export_source_paths', {}):
                    raise ValueError('缺少派生文件的原图证据')
                groups.setdefault((semantic, source), []).append(record)
            else:
                record.update(accepted=True, status='accepted')
        except (OSError, ValueError) as exc:
            record['reason'] = str(exc)
            rejected[semantic] = str(exc)

    return ctx, root, rejected, records, groups


def review_exports(selection, rows):
    from core import shenhui_shoe_packaging as shoe
    from core import shenhui_shoe_template_match as direct
    from core import shenhui_shoe_sequential as sequence
    ctx, root, rejected, records, groups = prepare_export_records(selection, rows)
    cache = selection.setdefault('_export_review_cache', {})
    attempts = selection.setdefault('_export_review_attempts', {})

    def review_group(item):
        (semantic, original), members = item
        # Identical bytes shared by channels require only one visual input.
        unique = {m['sha256']:m for m in members}
        try:
            anchor = shoe._consensus_slot_value(selection, 'tmz3')
            anchor_hash = (hashlib.sha256(Path(ctx['previews'][anchor]).read_bytes()).hexdigest()
                           if semantic == 'yq3' and anchor in ctx['previews'] else '')
            local_root = root / semantic
            local_root.mkdir(exist_ok=True)
            local = {**ctx, 'root':str(local_root), 'reuse_inventory_reviews':False,
                     'export_original':ctx['previews'][original]}
            reference = direct.reference(local, semantic)
            key = hashlib.sha256(json.dumps([REVIEW_VERSION, semantic, sorted(unique),
                ctx.get('candidate_observations', {}).get(next((k for k,v in ctx['ids'].items() if v == original), None)),
                hashlib.sha256(Path(reference).read_bytes()).hexdigest(), anchor_hash,
                hashlib.sha256(Path(ctx['previews'][original]).read_bytes()).hexdigest(),
                ctx['category'], bool(ctx.get('gray_standard')) if semantic == 'tmz5' else None, ctx.get('routes'),
                hashlib.sha256((direct.HUMAN_REVIEW_METHOD+direct.VISUAL_FACTS_PROMPT+direct.TEMPLATE_LAYOUT_GUIDE).encode()).hexdigest(),
                sequence.contract(semantic,ctx['category'],bool(ctx.get('gray_standard')) if semantic=='tmz5' else False)
            ], sort_keys=True).encode()).hexdigest()
            if key not in cache:
                previews = []
                gate = getattr(ctx.get('model_state'), 'image_work', None)
                with gate if gate is not None else nullcontext():
                    for index, member in enumerate(unique.values()):
                        preview = local_root / f'{key[:16]}-{index}.jpg'
                        with Image.open(member['path']) as image:
                            image = image.convert('RGB'); image.thumbnail((1600,1600))
                            image.save(preview, quality=95)
                        previews.append(str(preview))
                local['export_images'] = previews
                result = {'selected':{semantic:original, **({'tmz3':anchor} if semantic != 'tmz3' else {})}}
                verdict = direct.audit(local, result, [semantic])
                attempts[key] = attempts.get(key, 0) + 1
                if (verdict.get('outcomes', {}).get(semantic) != 'review_unknown'
                        or attempts[key] >= MAX_UNCHANGED_UNKNOWN_ATTEMPTS):
                    # Preserve unknown as unknown after one bounded retry. New
                    # source, export, template or observed facts produce a new key.
                    cache[key] = verdict
            else:
                verdict = cache[key]
            status = verdict.get('outcomes', {}).get(semantic,
                'source_invalid' if verdict.get('rejected') else 'accepted')
            indices = {digest:index for index,digest in enumerate(unique)}
            reviews = (verdict.get('response') or {}).get('reviews',[])
            checked = next((r for r in reviews if r.get('slot') == semantic),{})
            export_checks = {r['index']:r for r in (checked.get('response') or {}).get('export_checks',[])}
            for member in members:
                own_check = export_checks.get(indices[member['sha256']],{})
                own_status = 'accepted' if status == 'export_invalid' and own_check.get('accepted') is True else status
                member['review'] = verdict
                if own_status == 'accepted' and status == 'export_invalid':
                    individual = copy.deepcopy(verdict)
                    individual.update(approved=[semantic], rejected={}, outcomes={semantic:'accepted'})
                    for record in individual.get('response',{}).get('reviews',[]):
                        if record.get('slot') == semantic:
                            record.update(accepted=True, status='accepted',export_sha256=member['sha256'])
                    member['review'] = individual
                member['status'] = own_status
                member['accepted'] = own_status == 'accepted'
                if not member['accepted']:
                    source_reason = verdict.get('rejected', {}).get(semantic)
                    # A correctly exported wrong pose still needs a new source.
                    # Do not replace that rejection with "export is complete".
                    member['reason'] = str((own_check.get('reason') if own_status == 'export_invalid' else source_reason)
                                           or source_reason or '成品审核未通过')
        except (OSError, ValueError, shoe.llm_gateway.LlmGatewayError, shoe.ShoeSelectionError) as exc:
            for member in members:
                member.update(status='review_unknown', accepted=False, reason=str(exc))
        return members

    with ThreadPoolExecutor(max_workers=min(8,max(1,int(ctx.get('review_workers',4))))) as executor:
        for members in executor.map(review_group, groups.items()):
            for member in members:
                if not member['accepted']:
                    rejected[member['semantic']] = member['reason']
    (root/'results.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
    return rejected, records
