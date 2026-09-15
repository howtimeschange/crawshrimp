"""Opt-in single-reader batches followed by bounded independent final review.

Batch facts are proposals, never consensus votes. Final review happens after the
packager's local corrections and label resolution, before output is accepted.
"""

from __future__ import annotations

import json
from functools import partial
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from pathlib import Path

from core import llm_gateway as gateway, shenhui_shoe_rules as rules
from core import shenhui_shoe_models as shoe_models

STRATEGY = "single_model_verified"
BATCH_SIZE = 12
REQUEST_TIMEOUT = 90
SLOTS = ("tmz1", "tmz2", "tmz3", "tmz4", "tmz5", "wpz5", "yq1", "yq2", "yq3", "yx")
RULES = """tmz1: 双鞋并列斜前方3/4完整展示；禁止上下分开悬空或一鞋底朝镜头。
tmz2/yq1: 前方完整鞋正常展示，后方另一完整鞋的鞋底朝镜头；并排同向、上下悬空、单鞋均不合格。
tmz3: 单鞋竖立/悬立，纵向完整外侧轮廓；普通平放侧面或鞋头正对镜头不合格。
tmz4: 非雪地为完整单鞋后侧/侧后；雪地必须同时看见鞋口内里和鞋帮侧面，普通后侧不合格。
tmz5: 白底完整单只鞋斜向展示，不能双鞋。优先本款色标准白底图。
wpz5: 与tmz5相同姿势的灰底完整单鞋原图；不能近似角度替代。
yq2: 完整鞋底平铺朝镜头，不能鞋垫、局部鞋底或斜向侧身露底。
yq3: 无遮挡完整外侧平放侧面，不能内侧、竖立或功能卡遮挡图。
yx: 实物鞋与功能卡同框，允许卡片遮挡部分鞋身；不能把被卡片挡住的鞋误判成只有卡片。吊饰、鞋垫、鞋盒或只有卡片均不合格。确实不存在可留空。
所有选择必须目视对照模板，不能根据文件名或初选信心判断；存疑须拒绝。"""


def _shoe():
    from core import shenhui_shoe_packaging

    return shenhui_shoe_packaging


KINDS = {
    "pair_grounded": ("pair", "mixed", ("tmz1",)),
    "pair_front_sole": ("pair", "mixed", ("tmz2", "yq1")),
    "pair_floating": ("pair", "mixed", ()),
    "single_upright_outer": ("single", "outer", ("tmz3",)),
    "single_rear": ("single", "side_rear", ("tmz4",)),
    "single_rear_sole": ("single", "side_rear", ("tmz4",)),
    "single_oblique": ("single", "front", ("tmz5", "wpz5")),
    "single_outer_flat": ("single", "outer", ("yq3",)),
    "single_inner_flat": ("single", "inner", ()),
    "outsole_flat": ("single", "sole", ("yq2",)),
    "opening_lining": ("single", "mixed", ("tmz4",)),
    "shoe_with_card": ("single", "outer", ("yx",)),
    "shoe_box": ("other", "unknown", ("wpz6",)),
    "insole": ("other", "sole", ()),
    "other": ("other", "unknown", ()),
}
KIND_GUIDE = """pair_grounded=两只完整鞋并列落地、斜前方3/4；
pair_front_sole=前方完整鞋正常展示，后方另一鞋鞋底完整朝镜头；
pair_floating=两鞋上下分离/悬空（不要误认为后鞋底）；
single_upright_outer=完整单鞋近纵向悬立并展示外侧；
single_rear=完整单鞋后侧或侧后；single_rear_sole=完整单鞋后侧露底；
single_oblique=单鞋斜向展示（含俯视），非后侧或纵向外侧；
single_outer_flat=完整外侧平放侧视；single_inner_flat=完整内侧平放侧视；
outsole_flat=完整外底平铺朝镜头（不是鞋垫）；opening_lining=鞋口内里与鞋帮侧面同框；
shoe_with_card=实物鞋与功能卡同框（允许卡片遮挡部分鞋身）；shoe_box=实物鞋盒与标签；
insole=鞋垫；other=局部细节、单独卡片或无法确定。"""


def _fact_from_kind(key, name, kind, background, confidence):
    if kind not in KINDS:
        raise _shoe().ShoeSelectionError("未知姿势观察类型：" + str(kind))
    count, side, slots = KINDS[kind]
    return dict(
        candidate_id=key,
        filename=name,
        observed_kind=kind,
        asset_type=(
            "shoe_box"
            if kind == "shoe_box"
            else "other" if kind in {"insole", "other"} else "shoe"
        ),
        shoe_count=count,
        pose=slots[0] if slots else "other",
        background=background,
        complete=kind not in {"insole", "other"},
        side=side,
        outsole_visible=kind in {"pair_front_sole", "outsole_flat", "single_rear_sole"},
        feature_card=kind == "shoe_with_card",
        matched_slots=list(slots),
        confidence=confidence,
        pair_layout=(
            "grounded_pair"
            if kind == "pair_grounded"
            else (
                "front_and_sole"
                if kind == "pair_front_sole"
                else "floating_pair" if kind == "pair_floating" else "na"
            )
        ),
        upright=kind == "single_upright_outer",
        lining_visible=kind == "opening_lining",
        insole_only=kind == "insole",
    )


def validate_batch(payload, ids):
    s = _shoe()
    if not isinstance(payload, dict) or not isinstance(payload.get("candidates"), list):
        raise s.ShoeSelectionError("单模型分批未返回完整候选事实")
    rows = payload["candidates"]
    compact = all(isinstance(r, dict) and "kind" in r for r in rows)
    actual = [r.get("candidate_id") for r in rows if isinstance(r, dict)]
    if len(actual) != len(ids) or set(actual) != set(ids):
        raise s.ShoeSelectionError("单模型分批遗漏、重复或虚构候选编号")
    if all("kind" in r for r in rows):
        rows = [
            _fact_from_kind(
                r["candidate_id"],
                ids[r["candidate_id"]],
                r["kind"],
                r.get("background", "other"),
                r.get("confidence", 0),
            )
            for r in rows
        ]
        payload = {"candidates": rows}
    if any(r.get("filename") != ids.get(r.get("candidate_id")) for r in rows):
        raise s.ShoeSelectionError("单模型分批候选编号和文件名不一致")
    return (
        rows
        if compact
        else [asdict(f) for f in rules.parse_candidate_facts(payload, ids)]
    )


def _request(ctx, model, prompt, images, phase):
    s = _shoe()
    timeout = ctx.get("request_timeout", REQUEST_TIMEOUT)
    s._ensure_pose_image_input_limit(
        images, style_code=ctx["style"], color_code=ctx["color"], pose_strategy=STRATEGY
    )
    ctx["log"](
        f"鞋品单模型分批：{ctx['style']}-{ctx['color']} · {phase} · {model} · 无有效输出{timeout:g}秒超时 · 502/503/504最多重试2次"
    )
    s._notify_shoe_model_progress(
        ctx.get("progress"),
        phase + " " + model,
        style_code=ctx["style"],
        color_code=ctx["color"],
    )
    try:
        def stream_progress(state):
            message = (f"{phase} · {model} · 已等待{state['elapsed_seconds']:g}秒 · "
                       f"思考片段{state['reasoning_chars']}字 / 答案{state['content_chars']}字")
            ctx['log'](message)
            s._notify_shoe_model_progress(ctx.get('progress'), message,
                                         style_code=ctx['style'], color_code=ctx['color'])
        return shoe_models.generate_json(
            models=[model, *ctx.get('transport_fallback_routes', [])],
            state=ctx.get('model_state'), log=ctx['log'],
            system_prompt=ctx.get("system_prompt", s.SHOE_SELECTION_SYSTEM_PROMPT),
            user_prompt=prompt,
            image_inputs=images,
            config=ctx.get("config"),
            timeout_seconds=timeout,
            request_openai=partial(shoe_models.stream_request, progress=stream_progress),
        )
    except gateway.LlmGatewayError as exc:
        # The batch runner isolates ShoeSelectionError per style. Normalize all
        # network failures, including the single repair, to that public contract.
        raise s.ShoeSelectionError(
            f"{ctx['style']}-{ctx['color']} {phase}：{exc}"
        ) from exc


def _ranked(ctx, slot):
    facts = rules.parse_candidate_facts({"candidates": ctx["facts"]}, ctx["ids"])
    ranked = sorted(
        facts,
        key=lambda f: (
            -rules._candidate_score(f, slot, ctx["category"]),
            -f.confidence,
            f.candidate_id,
        ),
    )
    result, seen = [], set()
    for f in ranked:
        raw = next((r for r in ctx["facts"] if r["candidate_id"] == f.candidate_id), {})
        if (
            slot == "tmz4"
            and ctx["category"] == "雪地"
            and raw.get("lining_visible") is False
        ):
            continue
        if rules._candidate_score(f, slot, ctx["category"]) <= 0:
            continue
        family = _shoe()._copy_variant_key(f.filename)
        if family not in seen:
            result.append(f.candidate_id)
            seen.add(family)
    return result


def _readable_preview(source, target):
    """Detect whitespace cheaply, but crop native pixels before resizing.

    A small subject in a large studio canvas must not become a tiny model
    input after whitespace removal. Keep separated objects and source intact.
    """
    from PIL import Image, ImageOps, ImageChops

    with Image.open(source) as raw:
        original = ImageOps.exif_transpose(raw).convert("RGB")
        im = original.copy()
        im.thumbnail((1000, 1000), Image.Resampling.LANCZOS)
        w, h = im.size
        corners = [
            im.getpixel(p) for p in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
        ]
        background = tuple(sorted(p[c] for p in corners)[1] for c in range(3))
        a, b, c = ImageChops.difference(im, Image.new("RGB", im.size, background)).split()
        mask = ImageChops.lighter(ImageChops.lighter(a, b), c).point(
            lambda x: 255 if x > 12 else 0
        )
        box = mask.getbbox()
        if box and box[0] > 0 and box[1] > 0 and box[2] < w and box[3] < h:
            pad = max(12, int(max(box[2] - box[0], box[3] - box[1]) * 0.12))
            sx, sy = original.width / w, original.height / h
            original = original.crop((
                int(max(0, box[0] - pad) * sx),
                int(max(0, box[1] - pad) * sy),
                int(min(w, box[2] + pad) * sx),
                int(min(h, box[3] + pad) * sy),
            ))
        original.thumbnail((1000, 1000), Image.Resampling.LANCZOS)
        Path(target).parent.mkdir(parents=True, exist_ok=True)
        original.save(target, quality=95)
    return str(target)


def analyze(**kwargs):
    s = _shoe()
    ids = kwargs["candidate_ids"]
    models = s._shoe_pose_model_ids(
        kwargs.get("model_id"), kwargs.get("config"), kwargs.get("fallback_model_ids")
    )
    # Distinct canonical routes, not two aliases for one official model.
    main = gateway.route_for_model(models[0], kwargs.get("config")).model_id
    reviewers = [
        m
        for m in models[1:]
        if gateway.route_for_model(m, kwargs.get("config")).model_id != main
    ][:2]
    if not reviewers:
        raise s.ShoeSelectionError("单模型分批需要配置一个不同模型作为最终复核")
    ctx = dict(
        style=kwargs["style_code"],
        color=kwargs["color_code"],
        category=kwargs["shoe_category"],
        ids=ids,
        entries={e["filename"]: e for e in kwargs["candidate_entries"]},
        primary=models[0],
        reviewers=reviewers,
        config=kwargs.get("config"),
        log=kwargs.get("log") or (lambda x: None),
        progress=kwargs.get("progress"),
        root=str(Path(kwargs["contact_sheet"]).parent),
        main_refs=kwargs["main_pose_reference_images"],
        yq_refs=kwargs["yq_reference_images"],
        main_sheet=kwargs["main_pose_reference_sheet"],
        yq_sheet=kwargs["yq_reference_image"],
        evidence_path=kwargs.get("pose_evidence_path"),
        facts=[],
        batches=[],
    )
    ctx["previews"] = {
        name: _readable_preview(
            e["path"], Path(ctx["root"]) / f"{ctx['color']}-readable-{key}.jpg"
        )
        for key, name in ids.items()
        for e in [ctx["entries"][name]]
    }

    def batch(item):
        number, pairs = item
        subset = dict(pairs)
        path = Path(ctx["root"]) / f"{ctx['color']}-single-batch-{number}.jpg"
        s._create_contact_sheet(
            [{"filename": n, "path": ctx["previews"][n]} for n in subset.values()],
            path,
            candidate_labels=list(subset),
            columns=4,
            tile_width=320,
            image_height=260,
            quality=80,
        )
        prompt = f"款号：{ctx['style']}\n色码：{ctx['color']}\n品类：{ctx['category']}\n只观察本页每张候选原图的真实构图，不要分配主图序号，不要根据编号猜姿势。每个编号必须恰好返回一次。重点分清悬空双鞋与前鞋加后鞋底、内侧与外侧、鞋垫与外底。\n{KIND_GUIDE}\n候选编号：{json.dumps(subset,ensure_ascii=False)}\n返回JSON：{{\"candidates\":[{{\"candidate_id\":\"I01\",\"kind\":\"pair_grounded\",\"background\":\"white|gray|other\",\"confidence\":0.95}}]}}。类型只能来自上述列表，不确定用other。"
        response, route = _request(
            ctx, ctx["primary"], prompt, [str(path)], f"初判批次{number}"
        )
        return dict(
            index=number,
            ids=subset,
            image=str(path),
            response=response,
            facts=validate_batch(response, subset),
            route=route.model_id,
        )

    pairs = list(ids.items())
    work = [
        (i // BATCH_SIZE + 1, pairs[i : i + BATCH_SIZE])
        for i in range(0, len(pairs), BATCH_SIZE)
    ]
    # Same model only, at most two page requests; image decoding is bounded too.
    with ThreadPoolExecutor(max_workers=2) as pool:
        ctx["batches"] = list(pool.map(batch, work))
    ctx["facts"] = [f for b in ctx["batches"] for f in b["facts"]]
    slots = {"wpz": [""] * 6, "yq": [""] * 3}
    for slot in SLOTS:
        ranked = _ranked(ctx, slot)
        s._replace_consensus_slot_value(slots, slot, ranked[0] if ranked else "")
    box = kwargs.get("verified_label_filename")
    if box:
        slots["wpz"][5] = next((k for k, v in ids.items() if v == box), "")
    else:
        ranked = _ranked(ctx, "wpz6")
        slots["wpz"][5] = ranked[0] if ranked else ""
    exact = next(
        (
            k
            for k, v in ids.items()
            if s._is_tms_source_filename(v, ctx["style"], ctx["color"])
        ),
        "",
    )
    if exact:
        slots["tmz5"] = exact
    return dict(
        color_name=ctx["color"],
        shoe_category=ctx["category"],
        slots=slots,
        _model_id=main,
        _fast_context=ctx,
    )


def _gray_mates(ctx, anchor_name):
    """Propose background mates; the anchor and mate still need final review."""
    s = _shoe()
    entry = ctx["entries"].get(anchor_name)
    if not entry:
        return []
    feature = s._binary_pose_feature(entry["path"])
    if not feature.valid or feature.background_luma < s.SHOE_WHITE_BACKGROUND_LUMA:
        return []
    signature = None
    found = []
    for key, name in ctx["ids"].items():
        path = ctx["entries"][name]["path"]
        other = s._binary_pose_feature(path)
        if not (
            other.valid
            and 235 <= other.background_luma < s.SHOE_WHITE_BACKGROUND_LUMA
            and abs(feature.aspect_ratio - other.aspect_ratio) <= 0.05
            and abs(feature.bounding_coverage - other.bounding_coverage) <= 0.05
            and s._binary_pose_distance(feature, other)
            <= s.SHOE_VISUAL_VARIANT_MAX_DISTANCE
        ):
            continue
        if signature is None:
            signature = s._same_background_visual_signature(entry["path"])
        if (
            s._same_background_foreground_pixel_match(
                signature, s._same_background_visual_signature(path)
            )
            >= s.SHOE_SAME_BACKGROUND_VISUAL_MIN_PIXEL_MATCH
        ):
            found.append(key)
    return found


def _options(ctx, slots, pending, expanded=False):
    s = _shoe()
    reverse = {v: k for k, v in ctx["ids"].items()}
    choices = {}
    for slot in pending:
        current = reverse.get(s._consensus_slot_value(slots, slot), "")
        options = list(
            dict.fromkeys(([current] if current else []) + _ranked(ctx, slot))
        )
        if slot == "yq1":
            equivalent = reverse.get(s._consensus_slot_value(slots, "tmz2"))
            if equivalent:
                options = list(dict.fromkeys([equivalent] + options))
        if slot == "tmz5":
            exact = [
                k
                for k, n in ctx["ids"].items()
                if s._is_tms_source_filename(n, ctx["style"], ctx["color"])
            ]
            if exact:
                options = exact
        if slot == "wpz5":
            mates = _gray_mates(ctx, s._consensus_slot_value(slots, "tmz5"))
            if mates:
                options = mates
        choices[slot] = options[: (4 if expanded else 2)]
    return choices


def _review_panels(ctx, choices, round_index, slots):
    from PIL import Image, ImageOps, ImageDraw, ImageFont

    s = _shoe()
    paths = []
    slot_list = list(choices)
    for start in range(0, len(slot_list), 3):
        page_slots = slot_list[start : start + 3]
        cols = max(2, 1 + max(len(choices[k]) for k in page_slots))
        canvas = Image.new("RGB", (cols * 360, len(page_slots) * 310), "white")
        draw = ImageDraw.Draw(canvas)
        for row, slot in enumerate(page_slots):
            if slot.startswith("tmz"):
                ref = ctx["main_refs"][int(slot[-1]) - 1]
            elif slot == "wpz5":
                ref = ctx["previews"].get(s._consensus_slot_value(slots, "tmz5"))
            elif slot == "yx":
                ref = ctx.get("yx_ref") or str(s.SHOE_YX_REFERENCE_IMAGE)
            else:
                ref = ctx["yq_refs"].get(slot)
            cells = [("REFERENCE " + slot, ref)] + [
                (k, ctx["previews"][ctx["ids"][k]]) for k in choices[slot]
            ]
            for col, (label, path) in enumerate(cells):
                x, y = col * 360, row * 310
                draw.text((x + 8, y + 6), label, fill="black")
                if path:
                    with Image.open(path) as raw:
                        im = ImageOps.exif_transpose(raw).convert("RGB")
                        im.thumbnail((348, 275))
                        canvas.paste(
                            im,
                            (
                                x + (360 - im.width) // 2,
                                y + 28 + (275 - im.height) // 2,
                            ),
                        )
                draw.rectangle((x, y, x + 359, y + 309), outline="#888888")
        path = (
            Path(ctx["root"])
            / f"{ctx['color']}-single-review-{round_index}-{start//3+1}.jpg"
        )
        canvas.save(path, quality=88)
        paths.append(str(path))
    return paths


def _physical_rejection(slot, facts, category):
    """Shared acceptance contract for ordinary and enlarged visual review."""
    checks = {
        "tmz1": (
            facts.get("pair_layout") == "grounded_pair",
            "双鞋必须并列落地，不能悬空",
        ),
        "tmz2": (
            facts.get("pair_layout") == "front_and_sole",
            "前鞋正常展示且后鞋完整外底朝镜头",
        ),
        "yq1": (
            facts.get("pair_layout") == "front_and_sole",
            "前鞋正常展示且后鞋完整外底朝镜头",
        ),
        "tmz3": (
            facts.get("upright") is True and facts.get("side") == "outer",
            "必须纵向竖立并展示外侧",
        ),
        "tmz4": (
            (
                facts.get("lining_visible") is True
                if category == "雪地"
                else facts.get("side") == "side_rear"
            ),
            "雪地须可见内里；其他品类须为后侧",
        ),
        "yq2": (
            facts.get("insole_only") is False and facts.get("side") == "sole",
            "必须完整外底，不能鞋垫",
        ),
        "yq3": (
            facts.get("side") == "outer"
            and facts.get("upright") is False
            and facts.get("feature_card") is False,
            "必须无遮挡外侧平放",
        ),
        "wpz5": (facts.get("background") == "gray", "必须灰底原图"),
        "yx": (
            facts.get("feature_card") is True
            and facts.get("shoe_count") in {"single", "pair"},
            "必须有实物鞋及功能卡",
        ),
    }
    passed, reason = checks.get(slot, (True, ""))
    return "" if passed else reason


def validate_review(payload, choices, ctx):
    s = _shoe()
    rows = payload.get("reviews") if isinstance(payload, dict) else None
    if (
        not isinstance(rows, list)
        or len(rows) != len(choices)
        or {r.get("slot") for r in rows if isinstance(r, dict)} != set(choices)
    ):
        raise s.ShoeSelectionError("集中复核遗漏、重复或新增槽位")
    approved, rejected = {}, {}
    for row in rows:
        slot = row["slot"]
        selected = row.get("candidate_id", "")
        if row.get("accepted") is not True:
            if (
                slot == "yx"
                and not selected
                and row.get("absent") is True
                and ctx.get("yx_full_pool_shown")
            ):
                approved[slot] = ""
            else:
                rejected[slot] = str(row.get("reason") or "复核拒绝")
            continue
        if selected not in choices[slot]:
            raise s.ShoeSelectionError(f"{slot} 集中复核引用了未展示的候选")
        facts = row.get("facts")
        if "observed_kind" in row:
            facts = _fact_from_kind(
                selected,
                ctx["ids"][selected],
                row["observed_kind"],
                row.get("background", "other"),
                row.get("confidence", 0),
            )
        if isinstance(facts, dict):
            facts = dict(facts)
            facts["side"] = {
                "outsole": "sole",
                "rear_outer": "side_rear",
                "rear_lateral": "side_rear",
            }.get(facts.get("side"), facts.get("side"))
            facts["asset_type"] = {
                "shoe_with_feature_card": "shoe",
                "shoe_with_card": "shoe",
            }.get(facts.get("asset_type"), facts.get("asset_type"))
        if not isinstance(facts, dict):
            raise s.ShoeSelectionError(f"{slot} 集中复核缺少事实")
        # Check the actual returned facts. Never manufacture a positive fact/vote.
        physical_error = _physical_rejection(slot, facts, ctx["category"])
        if physical_error:
            rejected[slot] = physical_error
            continue
        fact_rows = rules.parse_candidate_facts(
            {
                "candidates": [
                    {
                        **facts,
                        "candidate_id": selected,
                        "filename": ctx["ids"][selected],
                    }
                ]
            },
            ctx["ids"],
        )
        if (
            len(fact_rows) != 1
            or slot not in fact_rows[0].matched_slots
            or rules._candidate_score(fact_rows[0], slot, ctx["category"])
            < rules.LOCK_SCORE_THRESHOLD
        ):
            rejected[slot] = "复核事实未通过本地槽位硬规则"
        else:
            approved[slot] = ctx["ids"][selected]
    return approved, rejected


def review_conflicts(payload, approved, ctx):
    """Disagreement/low confidence is a reason to inspect, never another vote."""
    initial = {f["candidate_id"]: f for f in ctx.get("facts", [])}
    conflicts = {}
    for row in payload.get("reviews", []):
        slot = row.get("slot")
        if slot not in approved:
            continue
        if slot == "yx" and not approved[slot]:
            conflicts[slot] = "功能卡缺失须放大排查，避免卡片遮挡鞋身造成漏检"
            continue
        key = row.get("candidate_id")
        first = initial.get(key)
        if first is None:
            continue
        final = row.get("facts", {})
        if row.get("observed_kind") in KINDS:
            final = _fact_from_kind(
                key,
                ctx["ids"][key],
                row["observed_kind"],
                row.get("background"),
                row.get("confidence", 0),
            )
        differing = [
            k
            for k in (
                "shoe_count",
                "side",
                "pair_layout",
                "upright",
                "lining_visible",
                "feature_card",
            )
            if k in first and k in final and first[k] != final[k]
        ]
        if (
            differing
            or min(float(first.get("confidence", 0)), float(final.get("confidence", 0)))
            < 0.8
        ):
            conflicts[slot] = (
                "初筛与终审可见特征冲突：" + ",".join(differing)
                if differing
                else "观察置信度不足，需看放大图"
            )
    return conflicts


def _enlarged_review(ctx, slots, approved, conflicts, reviewer):
    """At most four disputed slots, two in flight; no same-model retries.

    Ask for observable attributes on enlarged originals, not an accepted flag or
    a slot-shaped kind. The same local contract then evaluates these attributes.
    """
    s = _shoe()
    reverse = {v: k for k, v in ctx["ids"].items()}
    if len(conflicts) > 4:
        return {}, {slot: "争议超过局部复核预算，需人工确认" for slot in conflicts}, []

    def inspect(slot):
        picked = reverse.get(approved[slot], "")
        if slot == "yx" and not picked:
            return _review_card_absence(ctx, reviewer, conflicts[slot])
        keys = list(
            dict.fromkeys(
                ([picked] if picked else []) + _options(ctx, slots, [slot], True)[slot]
            )
        )[:4]
        if slot == "tmz3" and ctx.get("entries"):
            # Geometry proposes additional originals that a mistaken initial
            # classifier missed. It never approves or overwrites a selection.
            reference = s._binary_pose_feature(ctx["main_refs"][2])
            alternatives = []
            for fact in ctx.get("facts", []):
                if fact.get("shoe_count") != "single":
                    continue
                key = fact["candidate_id"]
                feature = s._binary_pose_feature(ctx["previews"][ctx["ids"][key]])
                if feature.valid:
                    alternatives.append(
                        (abs(feature.aspect_ratio - reference.aspect_ratio), key)
                    )
            geometric = [key for _, key in sorted(alternatives)[:2]]
            keys = list(dict.fromkeys(([picked] if picked else []) + geometric + keys))[
                :4
            ]
        ref = (
            ctx["main_refs"][int(slot[-1]) - 1]
            if slot.startswith("tmz")
            else (
                ctx["previews"].get(s._consensus_slot_value(slots, "tmz5"))
                if slot == "wpz5"
                else ctx["yq_refs"].get(slot)
            )
        )
        images = ([ref] if ref else []) + [ctx["previews"][ctx["ids"][k]] for k in keys]
        mapping = {str(i + 1 + (1 if ref else 0)): k for i, k in enumerate(keys)}
        prompt = (
            f"款号：{ctx['style']} 色码：{ctx['color']} 品类：{ctx['category']}。局部放大核对。"
            + ("第1张是不可选参考模板。" if ref else "")
            + f"其余每张是同款色独立放大原图，图片序号对应候选：{json.dumps(mapping)}。\n"
            + RULES
            + """
不要输出通过/不通过，也不要用目标姿势名代替观察。逐张描述可见事实，不能迎合模板。
外侧/内侧必须说明可见结构依据；后侧必须看见鞋跟后面；竖立须区别平放斜拍；双鞋须分别观察前后两鞋及鞋底。功能卡可遮挡部分鞋身，注意卡片后方是否还有实物鞋。
返回JSON candidates，每个编号恰好一次，包含candidate_id、evidence（具体可见依据），facts包含以下全部字段：asset_type(shoe/shoe_box/other)、shoe_count(single/pair/other)、side(outer/inner/side_rear/front/sole/mixed/unknown)、background(white/gray/other)、complete(bool，功能卡遮挡部分鞋可为true)、pair_layout(grounded_pair/front_and_sole/floating_pair/na)、upright(bool)、lining_visible(bool)、outsole_visible(bool)、insole_only(bool)、feature_card(bool)、confidence(0到1)。不能确认就用unknown/other和低confidence。"""
        )
        prompt += "\nupright专指画面中鞋头到鞋跟连线主要沿纵向；鞋底着地、鞋身水平的侧面图必须为false。"
        if slot == "tmz3":
            prompt += "每张facts还须包含toe_center与heel_center，各为[x,y]，是可见鞋头尖端及鞋跟后端的中心位置，坐标相对本张图归一化到0..1，左上为[0,0]。无法定位填null。"
        response = None
        try:
            response, route = _request(
                ctx, reviewer, prompt, images, "局部放大核对 " + slot
            )
            response = _normalize_image_ids(response, mapping)
            rows = response.get("candidates") if isinstance(response, dict) else None
            if (
                not isinstance(rows, list)
                or len(rows) != len(keys)
                or {r.get("candidate_id") for r in rows if isinstance(r, dict)}
                != set(keys)
            ):
                raise s.ShoeSelectionError("放大核对遗漏或虚构候选")
            passing = []
            facts_seen = []
            required = {
                "asset_type",
                "shoe_count",
                "side",
                "background",
                "complete",
                "pair_layout",
                "upright",
                "lining_visible",
                "outsole_visible",
                "insole_only",
                "feature_card",
                "confidence",
            }
            for row in rows:
                facts = row.get("facts")
                if (
                    not row.get("evidence")
                    or not isinstance(facts, dict)
                    or not required.issubset(facts)
                ):
                    raise s.ShoeSelectionError("放大核对缺少可见事实或依据")
                for flag in (
                    "complete",
                    "upright",
                    "lining_visible",
                    "outsole_visible",
                    "insole_only",
                    "feature_card",
                ):
                    if type(facts[flag]) is not bool:
                        raise s.ShoeSelectionError("放大核对布尔事实格式错误")
                if (
                    type(facts["confidence"]) not in (int, float)
                    or not 0 <= facts["confidence"] <= 1
                ):
                    raise s.ShoeSelectionError("放大核对置信度格式错误")
                facts_seen.append(facts)
                if slot == "tmz3" and not _vertical_landmarks(
                    facts, ctx["previews"][ctx["ids"][row["candidate_id"]]]
                ):
                    continue
                normalized = dict(facts, pose=slot, matched_slots=[slot])
                good, _ = validate_review(
                    {
                        "reviews": [
                            dict(
                                slot=slot,
                                accepted=True,
                                candidate_id=row["candidate_id"],
                                facts=normalized,
                            )
                        ]
                    },
                    {slot: keys},
                    ctx,
                )
                if slot in good and facts["confidence"] >= 0.8:
                    passing.append((row["candidate_id"], good[slot]))
            selected = next(
                (name for key, name in passing if key == picked),
                passing[0][1] if passing else None,
            )
            if (
                slot == "yx"
                and not passing
                and all(
                    f["feature_card"] is False and f["confidence"] >= 0.8
                    for f in facts_seen
                )
                and set(keys) == set(ctx["ids"])
            ):
                selected = ""
            ev = dict(
                slot=slot,
                reason=conflicts[slot],
                model=route.model_id,
                request=dict(user_prompt=prompt, image_inputs=images),
                response=response,
                selected=selected,
            )
            return (
                slot,
                selected,
                "" if selected is not None else "放大核对仍无确定合格图",
                ev,
            )
        except (s.ShoeSelectionError, gateway.LlmGatewayError) as exc:
            return (
                slot,
                None,
                str(exc),
                dict(
                    slot=slot,
                    error=str(exc),
                    request=dict(user_prompt=prompt, image_inputs=images),
                    response=response,
                ),
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(inspect, conflicts))
    return (
        {slot: name for slot, name, error, ev in results if name is not None},
        {slot: error for slot, name, error, ev in results if name is None},
        [ev for slot, name, error, ev in results if ev],
    )


def _vertical_landmarks(facts, image_path):
    from PIL import Image

    points = [facts.get("toe_center"), facts.get("heel_center")]
    if any(
        not isinstance(p, list)
        or len(p) != 2
        or any(type(v) not in (int, float) or not 0 <= v <= 1 for v in p)
        for p in points
    ):
        return False
    with Image.open(image_path) as im:
        w, h = im.size
    dx = abs(points[0][0] - points[1][0]) * w
    dy = abs(points[0][1] - points[1][1]) * h
    return dy >= 0.15 * h and dy >= 1.2 * dx


def _normalize_image_ids(payload, mapping):
    """Accept complete image-index replies only through the exact shown map.

    A reference index, mixed ID/index reply, missing index or duplicate remains
    invalid. This is transport normalization, not a guessed image identity.
    """
    rows = payload.get("candidates") if isinstance(payload, dict) else None
    if (
        isinstance(rows, list)
        and len(rows) == len(mapping)
        and all(isinstance(r, dict) for r in rows)
        and {r.get("candidate_id") for r in rows} == set(mapping)
    ):
        return {
            **payload,
            "candidates": [
                {**r, "candidate_id": mapping[r["candidate_id"]]} for r in rows
            ],
        }
    return payload


def _review_card_absence(ctx, reviewer, reason):
    s = _shoe()
    keys = list(ctx["ids"])
    images = [ctx.get("yx_ref") or str(_shoe().SHOE_YX_REFERENCE_IMAGE)]
    if not keys or len(keys) > 40:
        return "yx", None, "功能卡全图核查超过本次放大预算，需人工确认", None
    per_page = max(
        4,
        (len(keys) + s.SHOE_MULTIMODAL_IMAGE_INPUT_LIMIT - 2)
        // (s.SHOE_MULTIMODAL_IMAGE_INPUT_LIMIT - 1),
    )
    for start in range(0, len(keys), per_page):
        page_keys = keys[start : start + per_page]
        path = Path(ctx["root"]) / f"{ctx['color']}-card-check-{start//per_page}.jpg"
        s._create_contact_sheet(
            [
                {"filename": ctx["ids"][k], "path": ctx["previews"][ctx["ids"][k]]}
                for k in page_keys
            ],
            path,
            candidate_labels=page_keys,
            columns=2,
            tile_width=640,
            image_height=600,
            quality=90,
        )
        images.append(str(path))
    prompt = (
        "第一张是不可选的 yx 模板：实物鞋与功能卡同框。只参照鞋与卡的组合，不要求文字、颜色、鞋型或卡片数量相同。其余为候选。逐图放大排查实物鞋和功能卡。卡片可遮挡部分鞋身，注意卡片背后是否有实物鞋。功能卡须区别吊饰、鞋盒标签和单独卡片。不要做姿势选择。每个编号恰好返回一次："
        + json.dumps(keys)
        + """。
返回JSON candidates，每项candidate_id、shoe_present(bool)、function_card_present(bool)、confidence(0到1)、evidence(具体可见依据)。"""
    )
    response = None
    try:
        response, route = _request(ctx, reviewer, prompt, images, "功能卡缺失放大排查")
        rows = response.get("candidates") if isinstance(response, dict) else None
        if (
            not isinstance(rows, list)
            or len(rows) != len(keys)
            or {r.get("candidate_id") for r in rows if isinstance(r, dict)} != set(keys)
        ):
            raise s.ShoeSelectionError("功能卡排查未覆盖全部候选")
        passing = []
        uncertain = False
        for row in rows:
            if (
                not row.get("evidence")
                or any(
                    type(row.get(k)) is not bool
                    for k in ("shoe_present", "function_card_present")
                )
                or type(row.get("confidence")) not in (int, float)
                or not 0 <= row["confidence"] <= 1
            ):
                raise s.ShoeSelectionError("功能卡排查缺少明确可见事实")
            if row["confidence"] < 0.8:
                uncertain = True
            elif row["shoe_present"] and row["function_card_present"]:
                passing.append(ctx["ids"][row["candidate_id"]])
        selected = passing[0] if passing else None if uncertain else ""
        return (
            "yx",
            selected,
            "" if selected is not None else "功能卡缺失仍不确定",
            dict(
                slot="yx",
                reason=reason,
                model=route.model_id,
                request=dict(user_prompt=prompt, image_inputs=images),
                response=response,
                selected=selected,
            ),
        )
    except (s.ShoeSelectionError, gateway.LlmGatewayError) as exc:
        return (
            "yx",
            None,
            str(exc),
            dict(
                slot="yx",
                error=str(exc),
                request=dict(user_prompt=prompt, image_inputs=images),
                response=response,
            ),
        )


def verify_selection(ctx, slots):
    s = _shoe()
    current = dict(slots)
    current["wpz"] = list(slots["wpz"])
    current["yq"] = list(slots["yq"])
    pending = list(SLOTS)
    evidence = []
    reviewer_used = ""
    errors = []
    enlarged_done = set()
    for round_index in (1, 2):
        choices = _options(ctx, current, pending, expanded=round_index == 2)
        panels = _review_panels(ctx, choices, round_index, current)
        # The final reader can recover a primary miss from the complete input,
        # not just rubber-stamp a shortlist. Keep strict standard/background
        # constraints while allowing every actually displayed source elsewhere.
        panels += [b["image"] for b in ctx["batches"]]
        allowed = {
            slot: (choices[slot] if slot in {"tmz5", "wpz5"} else list(ctx["ids"]))
            for slot in pending
        }
        ctx["yx_full_pool_shown"] = "yx" in pending
        prompt = f"款号：{ctx['style']}\n色码：{ctx['color']}\n品类：{ctx['category']}\n最终姿势复核。前{len(panels)-len(ctx['batches'])}张图每行左侧REFERENCE为不可选模板，其余是初选建议；后{len(ctx['batches'])}张图为完整编号候选。初选可能错误或遗漏正确图，需要时从完整候选中纠正。只接受完全匹配者，不要近似凑齐。\n{RULES}\n构图类型定义：{KIND_GUIDE}\n每槽允许编号：{json.dumps(allowed)}\n若没有鞋加功能卡，核查完整候选后yx可返回absent=true。\n返回JSON reviews列表，每槽一项：{{\"slot\":\"tmz1\",\"accepted\":true,\"candidate_id\":\"I01\",\"observed_kind\":\"pair_grounded\",\"background\":\"gray\",\"confidence\":0.95,\"absent\":false,\"reason\":\"简短可见依据\"}}。observed_kind只能用定义的英文类型，必须描述真实构图；存疑或不匹配accepted=false,candidate_id为空。除了tmz2和yq1允许同图，其他槽位不能复用同张或拷贝图片。"
        result = None
        validated = False
        for reviewer in ([reviewer_used] if reviewer_used else ctx["reviewers"]):
            try:
                result, route = _request(
                    ctx, reviewer, prompt, panels, f"集中复核{round_index}"
                )
                approved, rejected = validate_review(result, allowed, ctx)
                reviewer_used = reviewer
                validated = True
                break
            except (gateway.LlmGatewayError, s.ShoeSelectionError) as exc:
                errors.append(str(exc)[:350])
                ctx["log"]("集中复核请求失败：" + str(exc)[:200])
        if not validated:
            raise s.ShoeSelectionError("集中复核不可用，未导出：" + "；".join(errors))
        conflicts = review_conflicts(result, approved, ctx)
        enlarged_evidence = []
        # A second global pass cannot silently overrule an unresolved physical
        # conflict. Each disputed slot gets at most one enlarged inspection.
        repeated = set(conflicts) & enlarged_done
        for slot in repeated:
            approved.pop(slot, None)
            rejected[slot] = "局部核对后仍有观察冲突，需人工确认"
        conflicts = {
            slot: why for slot, why in conflicts.items() if slot not in repeated
        }
        if conflicts:
            good, bad, enlarged_evidence = _enlarged_review(
                ctx, current, approved, conflicts, reviewer_used
            )
            for slot in conflicts:
                approved.pop(slot, None)
            approved.update(good)
            rejected.update(bad)
            enlarged_done.update(conflicts)
        for slot, name in approved.items():
            s._replace_consensus_slot_value(current, slot, name)
        evidence.append(
            dict(
                round=round_index,
                choices=allowed,
                shortlist=choices,
                response=result,
                approved=approved,
                rejected=rejected,
                model=route.model_id,
                enlarged_review=enlarged_evidence,
            )
        )
        if any(slot in rejected for slot in enlarged_done):
            # Do not erase an unresolved conflict by refreshing the primary
            # facts and then obtaining another approving kind label.
            break
        if not rejected:
            break
        if round_index == 2:
            break
        # One primary repair request for the failed slots together, not a model
        # list times slot list. Previously approved slots are not re-opened.
        prompt = f"款号：{ctx['style']}\n色码：{ctx['color']}\n品类：{ctx['category']}\n复核否定了这些槽位：{json.dumps(rejected,ensure_ascii=False)}。重新观察全部候选构图，尤其区分前鞋加后鞋底与悬空双鞋。\n{KIND_GUIDE}\n候选编号：{json.dumps(ctx['ids'],ensure_ascii=False)}\n每编号返回一次，JSON candidates列表，每项candidate_id、kind（上述英文类型）、background（white/gray/other）、confidence。不要返回槽位或迎合初选。"
        response, route = _request(
            ctx,
            ctx["primary"],
            prompt,
            [b["image"] for b in ctx["batches"]],
            "一次集中补判",
        )
        ctx["facts"] = validate_batch(response, ctx["ids"])
        pending = list(rejected)
    if ctx.get("evidence_path"):
        Path(ctx["evidence_path"]).write_text(
            json.dumps(
                dict(
                    strategy=STRATEGY,
                    style_code=ctx["style"],
                    color_code=ctx["color"],
                    batches=ctx["batches"],
                    final_review=evidence,
                    errors=errors,
                ),
                ensure_ascii=False,
                indent=2,
            )
        )
    if rejected:
        raise s.ShoeSelectionError(
            "单模型集中复核未通过：" + json.dumps(rejected, ensure_ascii=False)
        )
    # Reject accidental reuse; only tmz2/yq1 is an explicitly equivalent pair.
    used = {}
    for slot in SLOTS:
        name = s._consensus_slot_value(current, slot)
        if not name:
            continue
        key = s._copy_variant_key(name)
        if key in used and {slot, used[key]} != {"tmz2", "yq1"}:
            raise s.ShoeSelectionError(f"集中复核产生跨槽重复：{used[key]}/{slot}")
        used[key] = slot
    if ctx.get("entries"):
        mates = _gray_mates(ctx, current["tmz5"])
        if mates and s._consensus_slot_value(current, "wpz5") not in {
            ctx["ids"][k] for k in mates
        }:
            raise s.ShoeSelectionError("最终灰底图未匹配最终tmz5姿势")
    current["tms"] = current["tmz5"]
    current, _ = s._sync_wpz_main_slots(current)
    current = s._apply_o_category_rule(ctx["category"], current)
    current["_final_single_model_review"] = {
        "model": reviewer_used,
        "rounds": len(evidence),
        "rule_checks_passed": True,
        "enlarged_slots": len(enlarged_done),
    }
    current.pop("_fast_context", None)
    return current
