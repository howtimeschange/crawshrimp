"""Mask shortlist used before the shoe pipeline's independent visual reading.

Scores rank shape/layout similarity, not semantic validity or probabilities.
Keep the remaining pool available when the model rejects the shortlist.
Only Pillow and the standard library are needed on Windows and macOS.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from pathlib import Path
import hashlib
import math
import json
import time
from contextlib import nullcontext
from PIL import Image, ImageDraw, ImageFilter, ImageOps

VERSION = 'shoe-mask-shortlist-v1'
SIZE = 96


def _components(bits, width, height):
    remaining = bytearray(bits)
    groups = []
    for start in range(len(remaining)):
        if not remaining[start]:
            continue
        remaining[start] = 0
        stack, group = [start], []
        while stack:
            index = stack.pop()
            group.append(index)
            y, x = divmod(index, width)
            for ny, nx in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
                if 0 <= nx < width and 0 <= ny < height:
                    other = ny * width + nx
                    if remaining[other]:
                        remaining[other] = 0
                        stack.append(other)
        groups.append(group)
    return sorted(groups, key=len, reverse=True)


def _fill_holes(bits, width, height):
    outside = bytearray(len(bits))
    queue = deque()
    for i in range(len(bits)):
        y, x = divmod(i, width)
        if (x in (0, width-1) or y in (0, height-1)) and not bits[i]:
            outside[i] = 1
            queue.append(i)
    while queue:
        i = queue.popleft()
        y, x = divmod(i, width)
        for ny, nx in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
            if 0 <= nx < width and 0 <= ny < height:
                j = ny * width + nx
                if not bits[j] and not outside[j]:
                    outside[j] = 1
                    queue.append(j)
    return bytearray(not value for value in outside)


def _edge_distance(bits):
    edge = []
    distances = [SIZE * 2] * len(bits)
    queue = deque()
    for i, value in enumerate(bits):
        if not value:
            continue
        y, x = divmod(i, SIZE)
        if x in (0, SIZE-1) or y in (0, SIZE-1) or any(not bits[j] for j in (i-1, i+1, i-SIZE, i+SIZE)):
            edge.append(i)
            distances[i] = 0
            queue.append(i)
    while queue:
        i = queue.popleft()
        y, x = divmod(i, SIZE)
        for ny, nx in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
            if 0 <= nx < SIZE and 0 <= ny < SIZE:
                j = ny * SIZE + nx
                if distances[j] > distances[i] + 1:
                    distances[j] = distances[i] + 1
                    queue.append(j)
    return edge, distances


@dataclass
class MaskFeatures:
    mask: Image.Image
    bits: bytearray
    edge: list
    distances: list
    projection: list
    aspect_ratio: float
    components: int
    foreground_fraction: float
    border_fraction: float
    valid: bool


def describe(path, *, text_boxes=()):
    """Discard small detached marks and template OCR boxes, then normalize scale."""
    with Image.open(path) as opened:
        image = ImageOps.exif_transpose(opened).convert('RGB')
        original_size = image.size
        image.thumbnail((192, 192), Image.Resampling.LANCZOS)
    width, height = image.size
    pixels = list(image.getdata())
    border = [pixels[y*width+x] for y in range(height) for x in range(width)
              if x in (0, width-1) or y in (0, height-1)]
    background = tuple(sorted(p[c] for p in border)[len(border)//2] for c in range(3))
    raw = Image.new('L', image.size)
    raw.putdata([255 if max(abs(p[c]-background[c]) for c in range(3)) > 18 else 0 for p in pixels])
    if text_boxes:
        draw = ImageDraw.Draw(raw)
        sx, sy = width / original_size[0], height / original_size[1]
        for x1, y1, x2, y2 in text_boxes:
            draw.rectangle((x1*sx-2, y1*sy-2, x2*sx+2, y2*sy+2), fill=0)
    raw = raw.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    bits = bytearray(v > 0 for v in raw.getdata())
    groups = _components(bits, width, height)
    keep = [g for g in groups if len(g) >= max(8, len(groups[0]) * .08)] if groups else []
    kept = bytearray(width * height)
    for group in keep:
        for i in group:
            kept[i] = 1
    foreground = sum(kept) / max(1, len(kept))
    border_ids = [y*width+x for y in range(height) for x in range(width)
                  if x in (0, width-1) or y in (0, height-1)]
    border_fraction = sum(kept[i] for i in border_ids) / max(1, len(border_ids))
    kept = _fill_holes(kept, width, height)
    mask = Image.new('L', image.size)
    mask.putdata([255 * v for v in kept])
    box = mask.getbbox()
    aspect = (box[2]-box[0]) / (box[3]-box[1]) if box else 1.0
    canvas = Image.new('L', (SIZE, SIZE), 0)
    if box:
        cropped = ImageOps.contain(mask.crop(box), (SIZE-8, SIZE-8), Image.Resampling.NEAREST)
        canvas.paste(cropped, ((SIZE-cropped.width)//2, (SIZE-cropped.height)//2))
    return _features(canvas, aspect, len(keep), foreground, border_fraction,
                     bool(box) and .01 < foreground < .85 and border_fraction < .12)


def _features(mask, aspect, components, foreground, border, valid):
    bits = bytearray(v > 127 for v in mask.getdata())
    edge, distances = _edge_distance(bits)
    mass = max(1, sum(bits))
    projection = [sum(bits[y*SIZE+x] for y in range(SIZE))/mass for x in range(SIZE)]
    projection += [sum(bits[y*SIZE:(y+1)*SIZE])/mass for y in range(SIZE)]
    return MaskFeatures(mask, bits, edge, distances, projection, aspect, components,
                        foreground, border, valid and bool(edge))


def _similarity(first, second):
    if not first.valid or not second.valid:
        return {'score': 0.0, 'iou': 0.0, 'projection': 0.0, 'outline': 0.0}
    overlap = sum(a and b for a, b in zip(first.bits, second.bits))
    union = sum(a or b for a, b in zip(first.bits, second.bits))
    iou = overlap / max(1, union)
    a, b = first.projection, second.projection
    projection = sum(x*y for x, y in zip(a,b)) / max(1e-9, math.sqrt(sum(x*x for x in a)*sum(x*x for x in b)))
    distance = (sum(second.distances[i] for i in first.edge)/len(first.edge)
                + sum(first.distances[i] for i in second.edge)/len(second.edge)) / 2
    outline = math.exp(-distance / 6)
    aspect = math.exp(-abs(math.log(first.aspect_ratio / second.aspect_ratio)))
    parts = 1 / (1 + abs(first.components-second.components))
    return {'score': .45*iou + .20*projection + .20*outline + .10*aspect + .05*parts,
            'iou': iou, 'projection': projection, 'outline': outline,
            'aspect': aspect, 'component_similarity': parts}


def similarity(template, candidate, *, allow_mirror=True):
    """Geometry similarity of two silhouettes.

    Mirroring is harmless for pair/standard slots, but for slots that carry a
    side identity (tmz3/tmz4/yq2/yq3 must show the outer side) a mirrored match
    makes 内侧 and 外侧 score identically. Those slots must match in the same
    orientation, so callers pass allow_mirror=False.
    """
    if not allow_mirror:
        result = _similarity(template, candidate)
        return {**{k: round(v, 6) for k, v in result.items()}, 'mirror': False}
    mirrored = _features(ImageOps.mirror(candidate.mask), candidate.aspect_ratio, candidate.components,
                         candidate.foreground_fraction, candidate.border_fraction, candidate.valid)
    variants = [(False, _similarity(template, candidate)), (True, _similarity(template, mirrored))]
    flip, result = max(variants, key=lambda item: item[1]['score'])
    return {**{k: round(v, 6) for k, v in result.items()}, 'mirror': flip}


SIDE_IDENTITY_SLOTS = ('tmz3', 'tmz4', 'yq2', 'yq3')
# Calibrated 2026-09-16 on the 22 real tmz1 sources of full13-clear-grid-v12-final:
# silhouette "ground line" metrics (bottom-plateau gap, raised-column share) do NOT
# separate the audit's wrong pair poses (gap 0.205-0.268) from correct ones
# (0.17-0.256), so no geometric 落地 hard veto is shipped here. Landing is decided
# by explicit model facts (pair_arrangement) and requires both reviewers to agree.


class MaskIndex:
    def __init__(self):
        self.cache = {}

    def get(self, path, *, text_boxes=()):
        key = (hashlib.sha256(Path(path).read_bytes()).hexdigest(), tuple(tuple(b) for b in text_boxes))
        if key not in self.cache:
            self.cache[key] = describe(path, text_boxes=text_boxes)
        return self.cache[key]

    def rank(self, template, candidates, *, text_boxes=(), allow_mirror=True):
        reference = self.get(template, text_boxes=text_boxes)
        rows = []
        for key, path in candidates.items():
            candidate = self.get(path)
            rows.append({'candidate_id': key, **similarity(reference, candidate, allow_mirror=allow_mirror),
                         'mask_valid': candidate.valid, 'large_components': candidate.components})
        return sorted(rows, key=lambda row: (-row['score'], row['candidate_id']))


POSE_SLOTS = ('tmz1','tmz2','tmz3','tmz4','yq2','yq3','yx')


def prepare_shortlists(ctx, top_k=3):
    """Rank all originals locally; preserve the whole pool for later expansion."""
    from core import shenhui_shoe_template_match as direct, ocr_service
    started = time.monotonic()
    root = Path(ctx['root']) / 'mask-shortlist'
    root.mkdir(parents=True, exist_ok=True)
    state = ctx.get('model_state')
    gate = getattr(state, 'image_work', None)
    ocr_cache = getattr(state, 'mask_ocr_cache', {})
    ocr_lock = getattr(state, 'mask_ocr_lock', None)
    # A verified shoebox label is retained in the complete pool for wpz6/tmq,
    # but cannot occupy a physical-shoe pose in the geometric shortlist.
    candidates = {key:ctx['previews'][name] for key,name in ctx['ids'].items()
                  if name != ctx.get('verified_label_filename')}
    plan = {'version':VERSION, 'top_k':top_k, 'by_slot':{}, 'initial_ids':[],
            'candidate_count':len(ctx['ids']), 'pose_candidate_count':len(candidates),
            'excluded_verified_label_ids':[key for key in ctx['ids'] if key not in candidates],
            'candidate_sha256':{
                key:hashlib.sha256(Path(path).read_bytes()).hexdigest() for key,path in candidates.items()},
            'rule':'Mask scores only prioritize original photographs; no score approves an image or proves absence.'}
    with gate if gate is not None else nullcontext():
        index = MaskIndex()
        for slot in POSE_SLOTS:
            try:
                stacked = Path(direct.reference(ctx,slot))
                template = stacked.with_name(slot+'-single-v1.jpg')
                digest = hashlib.sha256(template.read_bytes()).hexdigest()
                with ocr_lock if ocr_lock is not None else nullcontext():
                    if digest not in ocr_cache:
                        try:
                            response = ocr_service.recognize_image_with_tesseract_js(template,timeout_seconds=20)
                            with Image.open(template) as image:height=image.height
                            words = [w for w in response['words'] if w.confidence>=55 and w.bbox[3]<height*.3]
                            ocr_cache[digest] = {'boxes':[list(w.bbox) for w in words], 'words':[w.text for w in words]}
                        except Exception as exc:
                            ocr_cache[digest] = {'boxes':[], 'error':str(exc)[:240]}
                    ocr = ocr_cache[digest]
                # Slots that must show the outer side are ranked without mirroring:
                # a mirrored match cannot tell 内侧 from 外侧.
                ranked = index.rank(template,candidates,text_boxes=ocr['boxes'],
                                    allow_mirror=slot not in SIDE_IDENTITY_SLOTS)
                reliable_mask = index.get(template,text_boxes=ocr['boxes']).valid and any(r['mask_valid'] and r['score']>0 for r in ranked)
                chosen = [r['candidate_id'] for r in ranked[:top_k]] if reliable_mask else list(candidates)
                plan['by_slot'][slot] = {'template':str(template),'template_sha256':digest,
                    'ocr':ocr,'ranked':ranked,'initial_ids':chosen,'fallback_full_pool':not reliable_mask}
            except (OSError, ValueError, KeyError) as exc:
                plan['by_slot'][slot] = {'initial_ids':list(candidates),'ranked':[],
                    'fallback_full_pool':True,'error':str(exc)[:240]}
    selected = {key for row in plan['by_slot'].values() for key in row['initial_ids']}
    # Identity-defined standard source is never hidden by a geometric ranking.
    from core import shenhui_shoe_packaging as shoe
    standards = [key for key,name in ctx['ids'].items() if key in candidates and shoe._is_tms_source_filename(name,ctx['style'],ctx['color'])]
    selected.update(standards)
    plan['standard_identity_ids'] = standards
    plan['standard_rule'] = 'Standard source identity is retained independently of pose masks; without an exact identity, a complete single shoe from observed originals is proposed under the existing standard rule.'
    plan['initial_ids'] = [key for key in candidates if key in selected]
    plan['elapsed_seconds'] = time.monotonic()-started
    (root/'plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2))
    ctx['mask_plan'] = plan
    ctx.get('log',lambda _:None)(f"蒙版预筛选：{ctx['style']}-{ctx['color']} · {len(plan['initial_ids'])}/{len(ctx['ids'])}张进入首次预选 · {plan['elapsed_seconds']:.2f}秒；完整原图池保留")
    return plan


def propose_without_model(ctx):
    """Local proposals only. Every selected photograph still needs board review."""
    from core import shenhui_shoe_catalog as catalog, shenhui_shoe_fast as fast
    from core import shenhui_shoe_packaging as shoe, shenhui_shoe_template_match as direct

    plan = ctx.get('mask_plan') or prepare_shortlists(ctx)
    choices = {slot: [(r['candidate_id'], r['score'])
                     for r in plan['by_slot'].get(slot, {}).get('ranked', [])[:3]
                     if r.get('mask_valid') and r.get('score', 0) > 0]
               for slot in catalog.INDEPENDENT}
    candidates = {key: ctx['previews'][name] for key, name in ctx['ids'].items()
                  if name != ctx.get('verified_label_filename')}
    identities = [key for key in plan.get('standard_identity_ids', []) if key in candidates]
    if identities:
        choices['tmz5'] = [(key, 2.0) for key in identities]
    else:
        ranked = MaskIndex().rank(direct.reference(ctx, 'tmz5'), candidates)
        choices['tmz5'] = [(r['candidate_id'], r['score']) for r in ranked[:3]
                           if r['mask_valid'] and r['score'] > 0]
    selected = catalog.assign(choices, catalog.candidate_families(ctx))
    names = {slot: ctx['ids'][key] if key else '' for slot, key in selected.items()}
    records = [{'slot': slot, 'selected': selected.get(slot, ''), 'model': '',
                'source': 'local_mask_proposal', 'accepted': False,
                'candidate_options': [{'id': key, 'score': score} for key, score in choices[slot]]}
               for slot in catalog.INDEPENDENT]
    missing = {slot: '本地蒙版未能提出候选，等待问题图位AI检索' for slot in catalog.INDEPENDENT
               if not names.get(slot)}
    if names.get('tmz2'):
        names['yq1'] = names['tmz2']
    if names.get('tmz5'):
        standard = names['tmz5']
        mates = fast._gray_mates(ctx, standard)
        names['wpz5'] = ctx['ids'][mates[0]] if mates else standard
        ctx['gray_standard'] = shoe._binary_pose_feature(ctx['previews'][standard]).background_luma < shoe.SHOE_WHITE_BACKGROUND_LUMA
    result = {'selected': names, 'records': records, 'mechanical_complete': not missing,
              'proposal_missing': missing, 'card_absence_verified': False, 'remaining': [],
              'initial_selection': 'mask_without_model', 'model_selection_calls': 0,
              'mask_version': VERSION}
    (Path(ctx['root']) / 'global-assignment.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    ctx.get('log', lambda _: None)(f"蒙版直接初选：{ctx['style']}-{ctx['color']}；初选模型请求0次，所有提议等待看板审核")
    return result


def repair_from_board(ctx, selection):
    """AI retrieval is limited to the board's failing slots; approvals stay locked."""
    from concurrent.futures import ThreadPoolExecutor
    from core import shenhui_shoe_catalog as catalog, shenhui_shoe_fast as fast
    from core import shenhui_shoe_packaging as shoe, shenhui_shoe_template_match as direct
    from core.shenhui_shoe_sequential import inspect_card_pool

    previous = selection['_sequential_result']
    selected = dict(previous['selected'])
    # Choices named by the board are consumed by this repair round only.
    forced_choices = dict(selection.get('_repair_choice') or {})
    selection['_repair_choice'] = {}
    previous_anchor = selected.get('tmz3')
    pending = set(selection.get('_pending_slots', {})) & set(catalog.INDEPENDENT)
    if 'tmz3' in pending:
        pending.add('yq3')
    rejected = {slot: list(names) for slot, names in ctx.get('rejected_candidates', {}).items()}
    for slot in selection.get('_invalid_sources', []):
        name = selected.get(slot)
        if name and name not in rejected.setdefault(slot, []):
            rejected[slot].append(name)
    root = Path(ctx['root']) / ('board-repair-' + str(len(selection.get('_repair_history', [])) + 1))
    root.mkdir(parents=True, exist_ok=True)
    families = catalog.candidate_families(ctx)
    reverse = {name: key for key, name in ctx['ids'].items()}
    used = {families[reverse[name]] for slot, name in selected.items()
            if slot in catalog.INDEPENDENT and slot not in pending and name in reverse}
    local = {**ctx, 'root': str(root), 'pipeline_stage': 'repair', 'proposal_only': True,
             'request_purpose': 'board_problem_retrieval', 'repair_rejections': selection.get('_pending_slots', {})}
    records, missing = list(previous.get('records', [])), {}
    absence = previous.get('card_absence_verified', False)

    locked_used = frozenset(used)
    def retrieve(slot, occupied=None):
        occupied = locked_used if occupied is None else occupied
        bad = {families[reverse[n]] for n in rejected.get(slot, []) if n in reverse}
        pool = [key for key, name in ctx['ids'].items() if families[key] not in occupied | bad
                and name != ctx.get('verified_label_filename')]
        # The board compared A/B/C and named the candidate itself; honour that
        # choice instead of paying for another retrieval over the whole pool.
        forced = reverse.get(forced_choices.get(slot, ''))
        if forced and forced in pool:
            return slot, forced, {'slot': slot, 'source': 'board_alt_choice',
                                  'selected': forced, 'candidate': selection['_repair_choice'][slot],
                                  'reason': selection.get('_pending_slots', {}).get(slot, '看板对比后改选该备选')}
        anchor = selected.get('tmz3') if slot == 'yq3' else None
        slot_root = root / slot
        slot_root.mkdir(exist_ok=True)
        slot_ctx = {**local, 'root': str(slot_root), 'side_anchor': anchor}
        reconsidered = set(selection.get('_board_reconsidered_families', {}).get(slot, []))
        reconsider_pool = [key for key, name in ctx['ids'].items()
                           if families[key] in bad and families[key] not in occupied | reconsidered
                           and name != ctx.get('verified_label_filename')]
        (slot_root / 'candidate-pool.json').write_text(json.dumps({
            'slot': slot, 'eligible_ids': pool, 'reconsiderable_ids': reconsider_pool,
            'excluded': {key: ('verified_label' if name == ctx.get('verified_label_filename')
                              else 'occupied_family' if families[key] in occupied
                              else 'rejected_source_family' if families[key] in bad else '')
                         for key, name in ctx['ids'].items() if key not in pool},
            'prior_rejection': selection.get('_pending_slots', {}).get(slot),
        }, ensure_ascii=False, indent=2))
        if (not pool and not reconsider_pool and slot != 'yx') or (slot == 'yq3' and not anchor):
            return slot, '', {'reason': '缺少剩余候选或鞋侧参照'}
        refs = [direct.reference(slot_ctx, slot)]
        if anchor:
            refs.append(ctx['previews'][anchor])
        try:
            if slot == 'yx':
                # The full-pool presence check both finds a card proposal and
                # proves absence. Do not first run an identical full-pool picker.
                name, evidence = inspect_card_pool(slot_ctx, ctx['routes'][0])
                record = {'slot': slot, 'source': 'board_problem_card_search',
                          'full_pool_card_check': evidence, 'absence_verified': not name}
                if name in reverse and reverse[name] in pool:
                    return slot, reverse[name], record
                if name in reverse:
                    family = families[reverse[name]]
                    reconsidered = selection.get('_board_reconsidered_families', {}).get(slot, [])
                    if family in bad and family not in occupied and family not in reconsidered:
                        # New full-pool evidence disputes the earlier negative.
                        # Reintroduce one proposal for a fresh review; this is
                        # neither approval nor permission to cycle indefinitely.
                        record['reconsidered_source'] = name
                        record['reason'] = '全池功能卡观察与先前拒绝冲突，保留原图重新审核一次'
                        return slot, reverse[name], record
                record['reason'] = '完整素材未发现功能卡' if not name else '功能卡候选与已占用图位冲突或此前已拒绝'
                return slot, '', record
            search_pool = pool or reconsider_pool
            payload, route, attempts = direct.select_inventory(slot_ctx, ctx['routes'][0], slot, search_pool, bool(anchor), refs)
            key = payload.get('candidate_id')
            record = {'slot': slot, 'source': 'board_problem_retrieval', 'model': route.model_id,
                      'selected': key, 'attempts': attempts}
            if payload.get('accepted') is True and key in search_pool:
                if key in reconsider_pool:
                    record['reconsidered_source'] = ctx['ids'][key]
                return slot, key, record
            if pool and reconsider_pool:
                # Exhaustion is not proof of missing input if a single earlier
                # model judgment removed the remaining originals. One bounded
                # fresh retrieval can propose them for a new independent audit.
                recovery_root = slot_root / 'reconsider-rejected'
                recovery_root.mkdir(exist_ok=True)
                payload, route, attempts = direct.select_inventory({**slot_ctx, 'root': str(recovery_root)},
                    ctx['routes'][0], slot, reconsider_pool, bool(anchor), refs)
                key = payload.get('candidate_id')
                record['reconsideration'] = {'selected': key, 'model': route.model_id, 'attempts': attempts}
                if payload.get('accepted') is True and key in reconsider_pool:
                    record['reconsidered_source'] = ctx['ids'][key]
                    return slot, key, record
            record['reason'] = payload.get('evidence') or '完整候选未找到匹配'
            return slot, '', record
        except shoe.ShoeSelectionError as exc:
            return slot, '', {'slot': slot, 'reason': str(exc)}

    def apply(results):
        nonlocal absence
        collisions = []
        for slot, key, record in results:
            records.append(record)
            if key and families[key] not in used:
                selected[slot] = ctx['ids'][key]
                used.add(families[key])
                if record.get('reconsidered_source'):
                    selection.setdefault('_board_reconsidered_families', {}).setdefault(slot, []).append(families[key])
                    revisions = ctx.setdefault('source_review_revisions', {})
                    revisions[ctx['ids'][key]] = revisions.get(ctx['ids'][key], 0) + 1
            else:
                if key:
                    collisions.append(slot)
                selected[slot] = ''
                missing[slot] = record.get('reason') or '补选候选与其他图位重复，保留待补齐'
                if slot == 'yx' and record.get('absence_verified'):
                    absence = True
                    missing.pop(slot, None)
        return collisions

    # yq3 depends on the new tmz3. The other problem slots run concurrently.
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(retrieve, [slot for slot in catalog.INDEPENDENT if slot in pending and slot != 'yq3']))
    collisions = apply(results)
    # Each collision gets one targeted retrieval with all newly occupied
    # families excluded. Unrelated slots never re-enter the model pipeline.
    for slot in collisions:
        missing.pop(slot, None)
        apply([retrieve(slot, frozenset(used))])
    if 'yq3' in pending:
        if selected.get('tmz3') != previous_anchor:
            # "Opposite side" only has meaning relative to the old anchor.
            # A new anchor invalidates that exclusion; the new pair still has
            # to pass its own source and board review with an anchor-hashed key.
            records.append({'slot': 'yq3', 'source': 'changed_side_anchor',
                            'previous_anchor': previous_anchor, 'anchor': selected.get('tmz3'),
                            'cleared_rejections': list(rejected.get('yq3', []))})
            rejected['yq3'] = []
        apply([retrieve('yq3', frozenset(used))])
    selected['yq1'] = selected.get('tmz2', '')
    standard = selected.get('tmz5', '')
    mates = fast._gray_mates(ctx, standard) if standard else []
    selected['wpz5'] = ctx['ids'][mates[0]] if mates else standard
    if standard:
        ctx['gray_standard'] = shoe._binary_pose_feature(ctx['previews'][standard]).background_luma < shoe.SHOE_WHITE_BACKGROUND_LUMA
    ctx['rejected_candidates'] = rejected
    selection.setdefault('_repair_history', []).append({'pending': sorted(pending), 'root': str(root)})
    result = {**previous, 'selected': selected, 'records': records, 'proposal_missing': missing,
              'card_absence_verified': absence, 'mechanical_complete': not missing}
    (root / 'repair-result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    return result
