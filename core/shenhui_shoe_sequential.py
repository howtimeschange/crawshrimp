"""Opt-in sequential template matching with slot-specific visual contracts.

This module is experimental until full-batch acceptance. One primary request per
slot; an alternate route is used only when a slot cannot be accepted. Confirmed
image families leave the pool. Standard white/gray identity is constrained by the
existing source and foreground-equivalence rules.
"""

from __future__ import annotations
import json, re
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from core import (
    shenhui_shoe_fast as fast,
    shenhui_shoe_packaging as shoe,
    llm_gateway as gateway,
)

STRATEGY = "mask_board_review"
ORDER = ("tmz1", "tmz2", "tmz3", "tmz4", "tmz5", "wpz5", "yq1", "yq2", "yq3", "yx")
CHECKS = {
    "tmz1": {
        "two_complete_shoes": "两只鞋都完整",
        "side_by_side_grounded": "双鞋并列落地斜前方展示",
        "no_floating": "不是上下分离悬空",
        "no_sole_facing_camera": "没有一只鞋的外底正对镜头",
    },
    "tmz2": {
        "two_complete_shoes": "两只鞋都完整",
        "front_shoe_normal": "前鞋正常展示",
        "rear_outsole_complete": "后鞋的完整外底朝镜头",
        "no_floating": "不是上下分离悬空",
    },
    "tmz3": {
        "single_complete_shoe": "一只完整鞋",
        "outer_side_visible": "主要展示从鞋头至鞋跟的完整外侧鞋帮，外侧侧面是画面主体",
        "not_top_or_front_view": "不是俯视鞋口/鞋舌/鞋头正面的构图；鞋身纵向不等于外侧图，主要看到鞋口内部或鞋头正面必须拒绝",
        "vertical_toe_heel_axis": "鞋头到鞋跟连线主要沿画面纵向，水平着地不算",
    },
    "tmz4": {
        "single_complete_shoe": "一只完整鞋",
        "heel_back_visible": "后斜侧视：鞋跟处于近侧、鞋头处于远侧，可见后跟包边或后侧弧面；允许鞋身外侧占较大面积，不要求正后方直拍；鞋头近侧的斜前视不符合",
        "not_vertical_side": "不是鞋头朝上或朝下的竖立侧面构图，必须是平放后侧视",
    },
    "tmz5": {
        "single_complete_shoe": "一只完整鞋",
        "clean_white_background": "干净白底",
        "no_card_occlusion": "没有独立功能说明卡遮挡鞋身；固定在鞋面上的IP装饰、字母徽章、魔术贴和商标不属于功能卡",
    },
    "yq2": {
        "complete_outsole_facing_camera": "完整外底正对镜头",
        "not_insole": "不是鞋垫或局部鞋底",
    },
    "yq3": {
        "single_complete_shoe": "一只完整鞋",
        "outer_side_visible": "可见无遮挡外侧",
        "same_outer_side_as_anchor": "必须与本款已选竖立外侧图展示同一侧：侧面拉链、图案、扣带端头和拼片应对应；不能把内侧当外侧",
        "horizontal_side_view": "鞋身水平平放侧视",
        "not_front_oblique": "不是斜前方三分之四，不能大面积看见鞋头正面",
        "no_card_occlusion": "没有独立功能说明卡遮挡鞋身；固定在鞋面上的IP装饰、字母徽章、魔术贴和商标不属于功能卡",
    },
    "yx": {
        "physical_shoe_visible": "能看到实物鞋，允许功能卡挡住部分鞋身",
        "functional_card_visible": "功能卡与鞋同框，不能只有卡片/吊饰/鞋盒标签",
    },
}


def contract(slot, category, gray_standard=False):
    if slot == "tmz5" and gray_standard:
        checks = dict(CHECKS[slot])
        checks.pop("clean_white_background")
        checks["clean_gray_background"] = (
            "无合格白底候选时使用干净灰底原图，仍须完整单鞋无功能卡遮挡"
        )
        return checks
    if slot == "yq1":
        slot = "tmz2"
    if slot == "wpz5":
        return {
            "single_complete_shoe": "一只完整鞋",
            "same_pose_as_standard": "与标准白底完全相同姿势",
            "gray_background": "灰底原图",
        }
    if slot == "tmz4" and category == "雪地":
        return {
            "shoe_opening_detail": "单只鞋的鞋口/绒毛内里近景，允许模板式局部细节，不要求整只鞋完整入镜",
            "opening_lining_visible": "鞋口内里清晰可见",
            "lining_detail_prominent": "内里必须像模板一样突出，占据主要展示区域；完整鞋俯斜图只露少量内里不能替代内里特写",
            "upper_side_visible": "同时可见鞋口周围鞋帮，证明是实物鞋内里而非独立绒布或鞋垫",
        }
    if slot == "tmz4" and category == "运动":
        return {
            "single_complete_shoe": "一只完整鞋",
            "heel_back_visible": "后斜视，可见后跟后侧与鞋帮侧面，鞋跟较近、鞋头较远",
            "outsole_visible_obliquely": "鞋身倾斜，外底底面有明显可见面积，且同时展示鞋帮；只有侧墙或平放后侧视不符合；完整外底正对镜头的纯鞋底图也不符合",
        }
    return CHECKS[slot]


def _pose3_source_valid(ctx, key):
    entry = ctx.get("entries", {}).get(ctx["ids"][key])
    if not entry:
        return True
    feature = shoe._binary_pose_feature(entry["path"])
    baby = ctx["category"] == "婴童"
    return bool(
        feature.valid
        and 0.45 <= feature.aspect_ratio <= (0.95 if baby else 0.82)
        and feature.bounding_coverage <= (0.145 if baby else 0.16)
    )


def validate(payload, slot, allowed, ctx):
    if not isinstance(payload, dict):
        raise shoe.ShoeSelectionError("逐坑位复核没有JSON对象")
    key = payload.get("candidate_id")
    if payload.get("accepted") is not True or key not in allowed:
        raise shoe.ShoeSelectionError("未找到明确匹配图")
    if ctx.get("direct_template_match"):
        if (
            not isinstance(payload.get("evidence"), str)
            or not payload["evidence"].strip()
        ):
            raise shoe.ShoeSelectionError("缺少直接模板比对依据")
        return key
    checks = payload.get("checks")
    if not isinstance(checks, dict) or any(
        checks.get(k) is not True
        for k in contract(slot, ctx["category"], ctx.get("gray_standard", False))
    ):
        raise shoe.ShoeSelectionError("可见特征未满足当前坑位")
    if not payload.get("evidence"):
        raise shoe.ShoeSelectionError("缺少可见匹配依据")
    if slot == "tmz3" and not fast._vertical_landmarks(
        normalize_landmarks(payload), ctx["previews"][ctx["ids"][key]]
    ):
        raise shoe.ShoeSelectionError("鞋头鞋跟定位不支持纵向")
    if slot == "tmz3" and not _pose3_source_valid(ctx, key):
        raise shoe.ShoeSelectionError("主图3原图比例或主体占比不符合现有输出规则")
    if slot == "yq3":
        observed = payload.get("side_observations") or {}
        if not isinstance(observed, dict):
            raise shoe.ShoeSelectionError("侧面结构观察必须是JSON对象")
        if ctx.get("require_side_observations") and (
            not {
                "anchor_zipper",
                "candidate_zipper",
                "anchor_marks",
                "candidate_marks",
            }.issubset(observed)
            or not observed.get("anchor_marks")
            or not observed.get("candidate_marks")
        ):
            raise shoe.ShoeSelectionError("缺少本款外侧参照和候选的独立结构观察")
        anchor_zipper, candidate_zipper = observed.get("anchor_zipper"), observed.get(
            "candidate_zipper"
        )
        if (
            isinstance(anchor_zipper, bool)
            and isinstance(candidate_zipper, bool)
            and anchor_zipper != candidate_zipper
        ):
            raise shoe.ShoeSelectionError("本款外侧参照与候选图的侧面拉链结构不一致")
    return key


def normalize_landmarks(payload):
    """Recover only two unambiguous explicitly named coordinate pairs.

    Keep raw model evidence untouched. Missing, repeated or conflicting points
    still fail the same geometry gate; no pose is inferred from prose here.
    """
    if "toe_center" in payload or "heel_center" in payload:
        return payload
    evidence = payload.get("evidence", "")
    if not isinstance(evidence, str):
        return payload
    coordinates = {}
    for name in ("toe_center", "heel_center"):
        matches = re.findall(
            r"\b"
            + name
            + r"\s*(?:约为|为|[:=])?\s*[\[(]\s*([0-9.]+)\s*[,，]\s*([0-9.]+)\s*[\])]",
            evidence,
        )
        if len(matches) != 1:
            return payload
        try:
            coordinates[name] = [float(v) for v in matches[0]]
        except ValueError:
            return payload
    return {**payload, **coordinates}


def run(ctx, *, fallback=True):
    ids = ctx["ids"]
    selected = dict(ctx.get("locked_selections", {}))
    used = {shoe._copy_variant_key(ids[k]) for k in selected.values() if k}
    remaining = [k for k in ids if shoe._copy_variant_key(ids[k]) not in used]
    records = []
    exact = next(
        (
            k
            for k, n in ids.items()
            if shoe._is_tms_source_filename(n, ctx["style"], ctx["color"])
        ),
        "",
    )
    absence_verified = bool(ctx.get("card_absence_verified"))
    mates = fast._gray_mates(ctx, ids[exact]) if exact else []
    backgrounds = {}
    for key, name in ids.items():
        entry = ctx.get("entries", {}).get(name)
        if entry:
            feature = shoe._binary_pose_feature(entry["path"])
            if feature.valid:
                backgrounds[key] = feature.background_luma
    for slot in ctx.get("slot_order", ORDER):
        if slot == "yq1" and selected.get("tmz2"):
            selected[slot] = selected["tmz2"]
            records.append(
                dict(
                    slot=slot,
                    selected=selected[slot],
                    source="equivalent_tmz2",
                    calls=0,
                )
            )
            continue
        # The standard white image and its strict gray mate have fixed destinations.
        # Reserve them before greedy matching so an earlier pose cannot consume them.
        pool = [
            k for k in remaining if slot in {"tmz5", "wpz5"} or k not in {exact, *mates}
        ]
        if slot == "tmz3" and not ctx.get("direct_template_match"):
            pool = [key for key in pool if _pose3_source_valid(ctx, key)]
        if slot == "tmz5":
            if backgrounds:
                white = [
                    k
                    for k in pool
                    if backgrounds.get(k, 0) >= shoe.SHOE_WHITE_BACKGROUND_LUMA
                ]
                if not white:
                    ctx["gray_standard"] = True
                pool = (
                    [
                        k
                        for k in pool
                        if 235
                        <= backgrounds.get(k, 0)
                        < shoe.SHOE_WHITE_BACKGROUND_LUMA
                    ]
                    if ctx.get("gray_standard")
                    else white
                )
            if exact in pool:
                pool = [exact]
        if slot == "wpz5":
            standard = selected.get("tmz5", "")
            mates = fast._gray_mates(ctx, ids[standard]) if standard else []
            pool = [k for k in pool if k in mates]
            if standard and not pool:
                selected[slot] = standard
                records.append(
                    dict(
                        slot=slot,
                        selected=standard,
                        source="standard_source_fallback_no_gray_pair",
                        calls=0,
                    )
                )
                continue
            # An independently accepted standard plus strict unchanged foreground is
            # stronger than another approximate pose classification on the same pixels.
            if standard and pool:
                key = pool[0]
                selected[slot] = key
                family = shoe._copy_variant_key(ids[key])
                remaining = [
                    k for k in remaining if shoe._copy_variant_key(ids[k]) != family
                ]
                records.append(
                    dict(
                        slot=slot,
                        selected=key,
                        source="verified_standard_foreground_mate",
                        calls=0,
                    )
                )
                continue
        rejected_name = ctx.get("rejected_sources", {}).get(slot)
        if rejected_name:
            rejected_family = shoe._copy_variant_key(rejected_name)
            pool = [k for k in pool if shoe._copy_variant_key(ids[k]) != rejected_family]
        record = dict(slot=slot, attempts=[])
        records.append(record)
        if not pool:
            record["error"] = "无剩余候选满足来源约束"
            continue
        if slot.startswith("tmz"):
            ref = ctx["main_refs"][int(slot[-1]) - 1]
        elif slot == "wpz5":
            ref = ctx["previews"][ids[exact]] if exact else None
        elif slot.startswith("yq"):
            ref = ctx["yq_refs"].get(slot)
        elif slot == "yx":
            ref = ctx.get("yx_ref") or str(shoe.SHOE_YX_REFERENCE_IMAGE)
        else:
            ref = None
        if ctx.get("direct_template_match"):
            from core import shenhui_shoe_template_match as direct

            ref = direct.reference(ctx, slot)
        images = [ref] if ref else []
        if slot == "tmz3" and not ctx.get("direct_template_match"):
            images.append(ctx["main_refs"][4])
        same_shoe_side = slot == "yq3" and bool(selected.get("tmz3"))
        if same_shoe_side:
            images.append(ctx["previews"][ids[selected["tmz3"]]])
        chunk = max(
            6,
            (len(pool) + shoe.SHOE_MULTIMODAL_IMAGE_INPUT_LIMIT - len(images) - 1)
            // (shoe.SHOE_MULTIMODAL_IMAGE_INPUT_LIMIT - len(images)),
        )
        for start in range(0, len(pool), chunk):
            keys = pool[start : start + chunk]
            p = Path(ctx["root"]) / f"{slot}-remaining-{start//chunk}.jpg"
            shoe._create_contact_sheet(
                [{"filename": ids[k], "path": ctx["previews"][ids[k]]} for k in keys],
                p,
                candidate_labels=keys,
                columns=2,
                tile_width=600,
                image_height=540,
                quality=90,
            )
            images.append(str(p))
        details = contract(slot, ctx["category"], ctx.get("gray_standard", False))
        prompt = (
            f"款号：{ctx['style']}\n色码：{ctx['color']}\n品类：{ctx['category']}\n本次只匹配坑位 {slot}。"
            + (
                "第1张为不可选模板，其余为剩余候选。"
                if ref
                else "所有图片都是剩余候选。"
            )
            + f"\n只匹配拍摄构图类型；不要求颜色、图案、鞋型品牌或左右方向与示例完全一致。之前已选图已移除。观察后选择唯一最符合模板的一张，不能近似凑齐。允许编号：{json.dumps(pool)}。\n本坑位必须具备的可见特征：{json.dumps(details,ensure_ascii=False)}。\n只返回一个JSON对象，禁止数组或逐图列表。对象字段candidate_id、accepted(bool)、checks（以上键逐项bool）、evidence（30字内可见依据）。没有明确匹配则accepted=false，不编造编号。"
        )
        if slot == "tmz5":
            prompt += (
                "无合格白底候选，本轮按原有业务规则选择灰底原图。"
                if ctx.get("gray_standard")
                else "优先选择标准白底源图。"
            ) + "核实完整单鞋、纯净底色、无卡遮挡；姿势允许正面/斜向展示，鞋头鞋跟连线纵向不构成否定条件。"
        if slot == "tmz3":
            prompt += "另返回toe_center与heel_center，各为[x,y]，相对候选单张图的鞋头尖端和鞋跟后端中心0..1坐标。左上[0,0]。"
            prompt += "图片顺序补充：第1张是要匹配的纵向外侧模板；第2张是正面/俯视反例模板，也不可选。第3张起才是候选。不能因鞋身同样竖向，就选择第2张这种主要看到鞋舌和鞋口内部的视面。"
        if slot == "yx":
            prompt += "特别留意功能卡背后的鞋头/鞋跟/鞋口，卡片遮挡部分鞋身仍符合要求；单独卡片不符合。"
        if same_shoe_side:
            prompt += "图片顺序补充：第2张也是不可选参照，是本款已选的竖立外侧图；第3张起才是候选面板。请比对本款鞋的侧面装饰、拼片、扣带和鞋底侧墙，yq3必须与第2张展示同一外侧，不能只凭鞋头朝左或朝右判断内外侧。无法确认同侧则拒绝。"
        if ctx.get("repair_rejections"):
            prompt += (
                "这是一次有界修复：已释放可能冲突的坑位，其他通过图保持锁定。此前未通过的检查为："
                + json.dumps(ctx["repair_rejections"], ensure_ascii=False)
                + "。重新观察剩余原图，不沿用此前的候选编号或结论。"
            )
        if ctx.get("direct_template_match"):
            prompt = direct.selection_prompt(ctx, slot, pool, same_shoe_side)
        for model in ctx["routes"][: (2 if fallback else 1)]:
            response = None
            try:
                if ctx.get("direct_template_match"):
                    refs = [ref] if ref else []
                    if same_shoe_side:
                        refs.append(ctx["previews"][ids[selected["tmz3"]]])
                    response, route, batches = direct.select_inventory({**ctx, "side_anchor": ids[selected["tmz3"]] if same_shoe_side else ""}, model, slot, pool, same_shoe_side, refs)
                    record["small_batch_attempts"] = batches
                else:
                    response, route = fast._request(
                        ctx, model, prompt, images, "逐坑位匹配 " + slot
                    )
                if (
                    slot == "yx"
                    and isinstance(response, dict)
                    and response.get("accepted") is not True
                ):
                    name, absence_evidence = inspect_card_pool(ctx, model)
                    record.setdefault("card_presence_checks", []).extend(
                        absence_evidence
                    )
                    key = (
                        next((k for k, n in ids.items() if n == name), "")
                        if name
                        else ""
                    )
                    if key and key not in pool:
                        raise shoe.ShoeSelectionError(
                            "功能卡图被此前坑位占用，不能重复放行"
                        )
                    absence_verified = not name
                else:
                    key = validate(response, slot, pool, ctx)
                selected[slot] = key
                if key:
                    family = shoe._copy_variant_key(ids[key])
                    remaining = [
                        k for k in remaining if shoe._copy_variant_key(ids[k]) != family
                    ]
                record.update(selected=key, model=route.model_id)
                record["attempts"].append(
                    dict(model=model, response=response, accepted=True)
                )
                break
            except shoe.ShoeSelectionError as exc:
                record["attempts"].append(
                    dict(model=model, response=response, error=str(exc))
                )
        if (
            slot == "tmz5"
            and slot not in selected
            and not ctx.get("gray_standard")
            and any(
                235 <= v < shoe.SHOE_WHITE_BACKGROUND_LUMA for v in backgrounds.values()
            )
        ):
            ctx["gray_standard"] = True
            fallback_result = run(
                {**ctx, "slot_order": ["tmz5"], "locked_selections": selected}
            )
            selected.update(
                {
                    k: next(i for i, n in ids.items() if n == v) if v else ""
                    for k, v in fallback_result["selected"].items()
                }
            )
            record["gray_fallback"] = fallback_result["records"]
            if selected.get(slot):
                family = shoe._copy_variant_key(ids[selected[slot]])
                remaining = [
                    k for k in remaining if shoe._copy_variant_key(ids[k]) != family
                ]
        record["request"] = dict(user_prompt=prompt, image_inputs=images)
        record["remaining_ids"] = list(remaining)
        (Path(ctx["root"]) / (slot + ".json")).write_text(
            json.dumps(record, ensure_ascii=False, indent=2)
        )
        if ctx.get("on_slot"):
            ctx["on_slot"](record)
    return dict(
        selected={slot: ids[k] if k else "" for slot, k in selected.items()},
        records=records,
        mechanical_complete=set(selected) == set(ORDER),
        remaining=remaining,
        card_absence_verified=absence_verified,
    )


def inspect_card_pool(ctx, model):
    """Absence needs all original candidates, including previously removed ones."""
    keys = list(ctx["ids"])
    evidence = []
    errors = []
    for start in range(0, len(keys), 32):
        root = Path(ctx["root"]) / f"card-presence-{start//32}"
        root.mkdir(exist_ok=True)
        subset = {k: ctx["ids"][k] for k in keys[start : start + 32]}
        _, name, error, record = fast._review_card_absence(
            {**ctx, "root": str(root), "ids": subset},
            model,
            "未匹配功能卡，核查完整原图池",
        )
        evidence.append(record)
        if name is None:
            errors.append(error)
            continue
        if name:
            return name, evidence
    if not keys:
        raise shoe.ShoeSelectionError("空候选池不能证明功能卡缺失")
    if errors:
        raise shoe.ShoeSelectionError("；".join(errors))
    return "", evidence


def audit(ctx, result, slots=None):
    if ctx.get("direct_template_match"):
        from core import shenhui_shoe_template_match as direct

        return direct.audit(ctx, result, slots)
    targets = [
        slot
        for slot in (ORDER if slots is None else slots)
        if slot not in {"wpz5", "yq1"}
        and not (slot == "yx" and result.get("card_absence_verified"))
    ]
    if "yq3" not in targets or len(targets) == 1:
        return _audit_selected(ctx, result, targets)
    # Side identity is easier to miss in a mixed sheet of eight pose tasks.
    # Keep the same independent reviewer, but isolate the two same-shoe views.
    round_id = ctx.get("audit_round", 1)
    partitions = [("main", [s for s in targets if s != "yq3"]), ("side", ["yq3"])]
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(
                _audit_selected,
                {**ctx, "audit_round": f"{round_id}-{name}"},
                result,
                selected,
            )
            for name, selected in partitions
        ]
        parts = [future.result() for future in futures]
    reviews = [
        row for part in parts for row in (part.get("response") or {}).get("reviews", [])
    ]
    evidence = dict(
        model=parts[0]["model"],
        review_models={
            row["slot"]: part["model"]
            for part in parts
            for row in (part.get("response") or {}).get("reviews", [])
            if isinstance(row, dict) and row.get("slot")
        },
        response={"reviews": reviews},
        partitions=parts,
        approved=[slot for part in parts for slot in part["approved"]],
        rejected={
            slot: reason for part in parts for slot, reason in part["rejected"].items()
        },
        errors=[error for part in parts for error in part["errors"]],
    )
    (Path(ctx["root"]) / f"audit-{round_id}.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2)
    )
    return evidence


def _audit_selected(ctx, result, slots=None):
    """Review only the selected images, with no unused candidate distraction."""
    reverse = {n: k for k, n in ctx["ids"].items()}
    selected = result["selected"]
    targets = [
        slot
        for slot in (ORDER if slots is None else slots)
        if slot not in {"wpz5", "yq1"}
        and not (slot == "yx" and result.get("card_absence_verified"))
    ]
    if not targets:
        return dict(
            model="", response={"reviews": []}, approved=[], rejected={}, errors=[]
        )
    choices = {
        slot: [reverse[selected[slot]]] if selected.get(slot) else []
        for slot in targets
    }
    shaped = {"wpz": [""] * 6, "yq": [""] * 3}
    for slot, name in selected.items():
        shoe._replace_consensus_slot_value(shaped, slot, name)
    panels = fast._review_panels(
        ctx, choices, "sequence-audit-" + str(ctx.get("audit_round", 1)), shaped
    )
    if "yq3" in targets and selected.get("tmz3"):
        panels.append(ctx["previews"][selected["tmz3"]])
    prompt = f"款号：{ctx['style']}\n色码：{ctx['color']}\n品类：{ctx['category']}\n最终核对已选图。每行左侧REFERENCE是模板，右侧是待检查原图。本次不要选新图，只检查右图是否符合本坑位的构图。模板不要求颜色图案、鞋型品牌、左右方向一致。\n各坑位唯一允许的候选编号：{json.dumps(choices)}\n各坑位检查项：{json.dumps({slot:contract(slot,ctx['category'],ctx.get('gray_standard',False)) for slot in targets},ensure_ascii=False)}\n返回JSON reviews，每个坑位一项slot、candidate_id、accepted(bool)、checks(该坑位各项bool)、evidence(具体可见依据)。空坑位不能通过。tmz5按本次检查项核查完整单鞋、纯净底色和无卡遮挡；无白底时允许已明确标出的灰底fallback。tmz3另给toe_center与heel_center，相对候选单张图的鞋头尖端/鞋跟后端中心0..1坐标。yq3须是外侧水平侧视，斜前方不通过。功能卡可遮挡部分鞋身。"
    prompt += '返回结构示例：{"reviews":[{"slot":"tmz3","candidate_id":"I01","accepted":true,"checks":{},"toe_center":[0.5,0.85],"heel_center":[0.5,0.15],"evidence":"可见依据"}]}。tmz3的坐标必须是该review对象内独立的数组字段，不能写在evidence文字中；示例坐标不能照抄。'
    if "yq3" in targets and selected.get("tmz3"):
        prompt += "最后一张是本款已选的竖立外侧参照，不是额外候选。yq3须与这张展示同一鞋外侧：检查侧面装饰、拼片、扣带和鞋底侧墙；内侧即使水平完整也必须拒绝。左右朝向本身不能证明内外侧。"
    if targets == ["yq3"] and selected.get("tmz3") and selected.get("yq3"):
        panels = [ctx["previews"][selected["tmz3"]], ctx["previews"][selected["yq3"]]]
        prompt = (
            f"款号：{ctx['style']}\n色码：{ctx['color']}\n只审核同一款鞋的内外侧是否一致。第1张是已选的竖立外侧参照；第2张是待核对的水平侧视图。不要按左右朝向判断。"
            "逐项比较鞋帮侧面拉链、印刷图案、扣带端头和拼片。第1张没有侧面拉链、第2张有明显侧面拉链时必须拒绝；第1张有装饰图案而第2张的对应部位没有时也必须拒绝。"
            f"第2张唯一编号：{choices['yq3'][0]}。检查项：{json.dumps(contract('yq3',ctx['category']),ensure_ascii=False)}。"
            '返回JSON {"reviews":[{"slot":"yq3","candidate_id":"编号","accepted":true或false,"checks":{逐项检查bool},"side_observations":{"anchor_zipper":true或false或null,"candidate_zipper":true或false或null,"anchor_marks":"第1张可见结构和图案","candidate_marks":"第2张对应部位可见结构和图案"},"evidence":"相同或不同侧的具体依据"}]}。无法看清不能假定一致。'
        )
    response = None
    errors = []
    model = ""
    for route in ctx["routes"][1:3] or ctx["routes"][:1]:
        try:
            response, actual = fast._request(
                ctx, route, prompt, panels, "已选图最终核对"
            )
            model = actual.model_id
            break
        except shoe.ShoeSelectionError as exc:
            errors.append(str(exc))
    good = []
    bad = {}
    if isinstance(response, dict) and isinstance(response.get("reviews"), list):
        records = response["reviews"]
        names = [r.get("slot") for r in records if isinstance(r, dict)]
        if (
            len(names) != len(records)
            or len(names) != len(set(names))
            or not set(targets).issubset(names)
        ):
            bad = {slot: "终审缺少完整槽位列表" for slot in targets}
        else:
            for row in records:
                slot = row["slot"]
                if slot not in choices:
                    continue
                try:
                    validate(
                        row,
                        slot,
                        choices[slot],
                        {**ctx, "require_side_observations": targets == ["yq3"]},
                    )
                    good.append(slot)
                except shoe.ShoeSelectionError as exc:
                    bad[slot] = str(exc)
    else:
        bad = {slot: "终审请求未完成" for slot in targets}
    evidence = dict(
        model=model,
        request=dict(user_prompt=prompt, image_inputs=panels),
        response=response,
        approved=good,
        rejected=bad,
        errors=errors,
    )
    (Path(ctx["root"]) / f'audit-{ctx.get("audit_round",1)}.json').write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2)
    )
    return evidence


def repair_scope(rejected):
    """Reopen confusable slots together so a wrong lock cannot consume a repair.

    This is one bounded retry, not another whole-pool multi-model vote. Single
    outer upright, rear and horizontal side views are the observed conflict set.
    """
    reopened = set(rejected)
    if reopened & {"tmz3", "yq3"}:
        reopened.update({"tmz3", "tmz4", "yq3"})
    if "tmz2" in reopened:
        reopened.add("yq1")
    if "tmz5" in reopened:
        reopened.add("wpz5")
    return reopened


def run_verified(ctx, result=None):
    result = run(ctx) if result is None else result
    first = ({'approved':[], 'rejected':dict(ctx['known_rejections']), 'deferred_review':True}
             if ctx.get('repair_only') else audit(ctx, result, ctx.get('audit_slots')))
    result["audits"] = [first]
    if first["rejected"] and not ctx.get('audit_only'):
        if ctx.get("direct_template_match"):
            rejected = set(first["rejected"])
            # Derived copies follow a changed source; approved independent slots
            # stay locked and are never rerun merely because a neighbour failed.
            if "tmz2" in rejected:
                rejected.add("yq1")
            if "tmz5" in rejected:
                rejected.add("wpz5")
        else:
            rejected = repair_scope(first["rejected"])
        reverse = {n: k for k, n in ctx["ids"].items()}
        root = Path(ctx["root"]) / "one-repair"
        root.mkdir(exist_ok=True)
        repair_ctx = {
            **ctx,
            "root": str(root),
            "slot_order": [slot for slot in ORDER if slot in rejected],
            "locked_selections": {
                slot: reverse[name] if name else ""
                for slot, name in result["selected"].items()
                if slot not in rejected
            },
            "routes": ctx["routes"],
            "repair_rejections": first["rejected"],
            "rejected_sources": {slot: result["selected"].get(slot) for slot in first["rejected"]},
            "audit_round": 2,
            "card_absence_verified": result.get("card_absence_verified", False),
        }
        repaired = run(repair_ctx)
        # Reapply gray-source preferences before reviewing the repaired filenames.
        if ctx.get("preserve_background_pairs"):
            shaped = {"_sequential_context": ctx, "wpz": [""] * 6, "yq": [""] * 3}
            for slot, name in repaired["selected"].items():
                shoe._replace_consensus_slot_value(shaped, slot, name)
            shaped, _ = preserve_background_pairs(shaped)
            repaired["selected"] = {
                slot: shoe._consensus_slot_value(shaped, slot)
                for slot in repaired["selected"]
            }
        # Reopening a pool does not invalidate an approved image if both it and its
        # same-style reference are unchanged. Rechecking those introduces conflicting
        # random verdicts without adding independent evidence.
        changed = {
            slot
            for slot in ORDER
            if repaired["selected"].get(slot) != result["selected"].get(slot)
        }
        if "tmz3" in changed:
            changed.add("yq3")
        targets = [
            slot for slot in ORDER if slot in changed or slot in first["rejected"]
        ]
        second = ({'approved':[], 'rejected':{
            slot:'补齐后仍缺少候选' for slot in targets if not repaired['selected'].get(slot)
        }, 'deferred_review':True} if ctx.get('repair_only') else
            audit({**repair_ctx, "routes": ctx["routes"]}, repaired, targets))
        second["reused_approved"] = [
            slot for slot in first["approved"] if slot not in targets
        ]
        result["initial_selected"] = result["selected"]
        result["selected"] = repaired["selected"]
        result["repair"] = repaired["records"]
        result["reopened_slots"] = [slot for slot in ORDER if slot in rejected]
        result["card_absence_verified"] = repaired["card_absence_verified"]
        result["audits"].append(second)
    result["verified"] = not ctx.get("repair_only") and not result["audits"][-1]["rejected"] and set(
        result["selected"]
    ) == set(ORDER)
    return result


def analyze(**kwargs):
    """Propose sequential slots; final review runs after packaging corrections."""
    from core import shenhui_shoe_models as shoe_models
    execution = shoe_models.execution_models(kwargs.get('execution_model_ids'))
    root = Path(kwargs["contact_sheet"]).parent / (kwargs["color_code"] + "-sequential")
    root.mkdir(parents=True, exist_ok=True)
    ids = kwargs["candidate_ids"]
    ctx = dict(
        style=kwargs["style_code"],
        color=kwargs["color_code"],
        category=kwargs["shoe_category"],
        ids=ids,
        entries={e["filename"]: e for e in kwargs["candidate_entries"]},
        root=str(root),
        main_refs=kwargs["main_pose_reference_images"],
        yq_refs=kwargs["yq_reference_images"],
        routes=execution[:1],
        direct_review_routes=execution,
        transport_fallback_routes=execution[1:],
        model_state=kwargs.get('model_state') or shoe_models.ShoeModelState(),
        direct_template_match=True,
        catalog_assignment=True,
        mask_shortlist=True,
        mask_direct=kwargs.get("pose_strategy") == "mask_board_review",
        board_review=True,
        verified_label_filename=kwargs.get('verified_label_filename', ''),
        allow_partial=True,
        config=kwargs.get("config"),
        log=kwargs.get("log") or (lambda message: None),
        progress=kwargs.get("progress"),
    )
    # The designated pose-board reviewer must not silently degrade, so a missing
    # route would turn every pose slot into review_unknown after a full paid run.
    # Fail fast with the concrete cause instead.
    from core import llm_gateway as gateway
    board_model = getattr(ctx.get("model_state"), "board_review_model_id", "")
    if ctx["board_review"] and board_model:
        try:
            gateway.route_for_model(board_model, kwargs.get("config"))
        except gateway.LlmConfigurationError as exc:
            raise shoe.ShoeSelectionError(
                "姿势看板指定模型不可用：" + str(board_model) + "（" + str(exc) + "）；"
                "请先在设置→AI能力中配置该模型，或改用 --board-review-model 指定已配置的模型"
            ) from exc
    ctx["previews"] = {
        name: fast._readable_preview(
            ctx["entries"][name]["path"], root / (key + ".jpg")
        )
        for key, name in ids.items()
    }
    from core.shenhui_shoe_catalog import propose
    if ctx["mask_direct"]:
        from core.shenhui_shoe_mask_rank import propose_without_model
        result = propose_without_model(ctx)
    else:
        result = propose(ctx)
    ctx["proposal"] = result
    slots = {"wpz": [""] * 6, "yq": [""] * 3}
    for slot, name in result["selected"].items():
        shoe._replace_consensus_slot_value(slots, slot, name)
    slots["wpz"][5] = kwargs.get("verified_label_filename", "")
    if not slots["wpz"][5]:
        raise shoe.ShoeSelectionError("逐坑位流程缺少前置核验的鞋盒标签")
    return dict(
        color_name=ctx["color"],
        shoe_category=ctx["category"],
        slots=slots,
        _model_id='local-mask' if ctx['mask_direct'] else (','.join(dict.fromkeys(r['model'] for r in result['records'] if r.get('model'))) or execution[0]),
        _sequential_context=ctx,
    )


def preserve_background_pairs(slots):
    """Preserve existing gray-first main1-4 policy without changing their pose."""
    ruled = dict(slots)
    ctx = slots["_sequential_context"]
    corrections = []
    for i in range(1, 5):
        slot = f"tmz{i}"
        name = ruled.get(slot)
        if not name:
            continue
        mates = fast._gray_mates(ctx, name)
        if mates:
            gray = ctx["ids"][mates[0]]
            shoe._replace_consensus_slot_value(ruled, slot, gray)
            corrections.append(
                f"{slot}/wpz{i} 已使用相同前景的灰底原图：{name} -> {gray}"
            )
    if ctx.get("gray_standard"):
        corrections.append(
            "tmz5 无合格白底候选，保留已复核的灰底原图；tms 仍转换为白底"
        )
    if (
        ruled.get("tmz5")
        and shoe._consensus_slot_value(ruled, "wpz5") == ruled["tmz5"]
        and not fast._gray_mates(ctx, ruled["tmz5"])
    ):
        corrections.append("wpz5 无合格灰底配对，按原规则保留与 tmz5 同源的原图")
    return ruled, corrections


def verify_packaged_selection(slots, *, recovery=False, final_audit=False, repair_only=False):
    """Check exact filenames after local rules/label reuse, before file export."""
    ctx = dict(slots["_sequential_context"])
    ctx["preserve_background_pairs"] = True
    ctx['reuse_inventory_reviews'] = not (recovery or final_audit)
    ctx['audit_only'] = final_audit
    ctx['repair_only'] = repair_only
    if ctx.get('catalog_assignment') and not final_audit:
        # Proposals stay provisional until the one exported-file reviewer decides.
        from core.shenhui_shoe_catalog import repair
        if ctx.get('mask_direct'):
            from core.shenhui_shoe_mask_rank import repair_from_board as repair
        result = repair(ctx, slots) if recovery else {**ctx['proposal'], 'selected':{
            slot:shoe._consensus_slot_value(slots, slot) for slot in ORDER}}
        result['audits'] = []
        result['verified'] = False
        output = dict(slots)
        for slot,name in result['selected'].items():
            shoe._replace_consensus_slot_value(output,slot,name)
        output['tms'] = output.get('tmz5','')
        output['_sequential_context'] = ctx
        output['_sequential_result'] = result
        output['_pending_slots'] = {slot:result.get('proposal_missing',{}).get(slot,'补齐后仍缺少候选')
                                    for slot in ORDER if not result['selected'].get(slot)
                                    and not (slot=='yx' and result.get('card_absence_verified'))}
        output['_sequential_audits'] = slots.get('_sequential_audits',[])
        (Path(ctx['root'])/'final-selection.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
        return shoe._apply_o_category_rule(ctx['category'],output)
    if repair_only:
        ctx['known_rejections'] = dict(slots.get('_pending_slots', {}))
    if final_audit:
        ctx.pop('audit_slots', None)
        ctx['root'] = str(Path(ctx['root']) / 'batch-global-audit')
        Path(ctx['root']).mkdir(parents=True, exist_ok=True)
        ctx['prior_selection_evidence'] = {
            'selected': slots.get('_sequential_result', {}).get('selected', {}),
            'records': slots.get('_sequential_result', {}).get('records', []),
        }
        # Deliberately project only image evidence, never provider configuration.
        (Path(ctx['root']) / 'review-context.json').write_text(json.dumps({
            'style':ctx['style'], 'color':ctx['color'], 'category':ctx['category'],
            'templates':{'main':ctx.get('main_refs', []), 'detail':ctx.get('yq_refs', {})},
            'candidate_pool':ctx.get('ids', {}), 'candidate_images':ctx.get('previews', {}),
            'previous_selection':ctx['prior_selection_evidence'],
            'policy':'Previous acceptance is not ground truth; audit every slot independently.',
        }, ensure_ascii=False, indent=2), encoding='utf-8')
    selected = {slot: shoe._consensus_slot_value(slots, slot) for slot in ORDER}
    if recovery:
        selected = dict(slots['_sequential_result']['selected'])
        ctx['audit_slots'] = list(slots.get('_pending_slots', {}))
        ctx['root'] = str(Path(ctx['root']) / 'batch-recovery')
        Path(ctx['root']).mkdir(parents=True, exist_ok=True)
        ctx['inventory_chunk_size'] = 4
        ctx['inventory_tile_width'] = 900
    result = {**ctx["proposal"], "selected": selected}
    if final_audit:
        # Absence is also a prior model decision; reopen the pool when needed.
        result['card_absence_verified'] = False
    result = run_verified(ctx, result)
    (Path(ctx["root"]) / "final-selection.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2)
    )
    if not result["verified"] and not ctx.get('allow_partial'):
        raise shoe.ShoeSelectionError(
            f"{ctx['style']}-{ctx['color']} 逐坑位最终复核未通过："
            + json.dumps(result["audits"][-1]["rejected"], ensure_ascii=False)
        )
    output = dict(slots)
    for slot, name in result["selected"].items():
        shoe._replace_consensus_slot_value(output, slot, name)
    output["tms"] = output["tmz5"]
    output = shoe._apply_o_category_rule(ctx["category"], output)
    output['_sequential_context'] = ctx
    output['_sequential_result'] = result
    output['_pending_slots'] = dict(result['audits'][-1]['rejected'])
    if 'tmz3' in output['_pending_slots']:
        output['_pending_slots'].setdefault('yq3', '本款外侧参照未通过，待参照补齐后核验同侧')
    # Unaccepted proposals remain in evidence, never in the usable image package.
    for slot in output['_pending_slots']:
        shoe._replace_consensus_slot_value(output, slot, '')
        if slot.startswith('tmz'):
            shoe._replace_consensus_slot_value(output, 'wpz' + slot[-1], '')
        if slot == 'tmz2':
            shoe._replace_consensus_slot_value(output, 'yq1', '')
        if slot == 'tmz5':
            output['tms'] = ''
    output = shoe._apply_o_category_rule(ctx['category'], output)
    output["_sequential_audits"] = (slots.get('_sequential_audits', []) if recovery or final_audit else []) + result["audits"]
    return output


def report_evidence(selection, slot, source_name):
    """Report actual final review evidence, never fabricate legacy model votes."""
    ctx = selection["_sequential_context"]
    category = selection.get("shoe_category") or ctx["category"]
    evidence = {
        "strategy": STRATEGY if ctx.get('mask_direct') else 'sequential_templates',
        "slot": slot,
        "source": source_name,
        "accepted": False,
    }
    if slot == "wpz6":
        votes = selection.get("_label_identity_votes", [])
        families = {shoe._label_model_family(v.get("model_id", "")) for v in votes}
        evidence.update(
            kind="label_identity",
            votes=votes,
            accepted=bool(
                selection.get("_label_verified")
                and shoe._label_votes_agree(votes)
                and shoe._consensus_slot_value(selection, "wpz6") == source_name
            ),
        )
        return evidence
    review_slot = shoe._semantic_vote_slot(slot, category)
    if review_slot == "yq1":
        review_slot = "tmz2"
    review_source = source_name
    relation = "same_source"
    if review_slot == "wpz5":
        review_slot = "tmz5"
        review_source = selection["tmz5"]
        relation = "foreground_pair"
        mates = fast._gray_mates(ctx, review_source)
        if source_name == review_source and not mates:
            relation = "standard_source_fallback_no_gray_pair"
        elif source_name not in [ctx["ids"][key] for key in mates]:
            return evidence
    for audit_record in reversed(selection.get("_sequential_audits", [])):
        if review_slot not in audit_record.get("approved", []):
            continue
        for row in (audit_record.get("response") or {}).get("reviews", []):
            if (
                row.get("slot") != review_slot
                or ctx["ids"].get(row.get("candidate_id")) != review_source
            ):
                continue
            checks = row.get("checks") or {}
            if row.get('comparison') == 'style_comparison_board':
                evidence.update(kind=relation, comparison='style_comparison_board',
                    row_id=row.get('row_id'), comparison_image=row.get('comparison_image'),
                    model=row.get('model'), visual_evidence=row.get('evidence'),
                    candidate_facts=(row.get('response') or {}).get('candidate_facts'),
                    accepted=row.get('accepted') is True and bool(row.get('comparison_image')))
                return evidence
            if row.get("comparison") == "direct_template_pair":
                evidence.update(
                    kind=relation,
                    comparison="direct_template_pair",
                    review_slot=review_slot,
                    review_source=review_source,
                    model=row.get("model"),
                    visual_evidence=row.get("evidence"),
                    visible_differences=row.get("visible_differences"),
                    comparison_sha256=row.get("comparison_sha256"),
                    background_policy=(
                        "gray_fallback" if ctx.get("gray_standard") else "white_standard"
                    ) if review_slot == "tmz5" else None,
                    same_side=row.get("same_side"),
                    side_identity=row.get("side_identity"),
                    review_version=row.get("review_version"),
                    candidate_facts=(row.get("response") or {}).get("candidate_facts"),
                    fact_failures=row.get("fact_failures"),
                    background_perimeter=row.get("background_perimeter"),
                    accepted=row.get("accepted") is True
                    and bool(row.get("comparison_sha256"))
                    and (review_slot != "yq3" or row.get("same_side") is True),
                )
                return evidence
            required = list(
                contract(review_slot, category, ctx.get("gray_standard", False))
            )
            evidence.update(
                kind=relation,
                review_slot=review_slot,
                review_source=review_source,
                model=audit_record.get("review_models", {}).get(review_slot)
                or audit_record.get("model"),
                checks=checks,
                required_checks=required,
                visual_evidence=row.get("evidence"),
                side_observations=row.get("side_observations"),
                accepted=row.get("accepted") is True
                and all(checks.get(k) is True for k in required),
            )
            return evidence
    return evidence
