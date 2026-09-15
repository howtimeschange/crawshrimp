"""Direct template comparisons. No per-pose prose checklist or invented votes."""

from __future__ import annotations

import hashlib
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

from core import shenhui_shoe_fast as fast

MATCH_RULE = (
    "直接按模板比较拍摄构图类型，不要求像素相同。忽略鞋款、配色、材质、品牌、"
    "鞋帮高低、背景色和主体大小；允许左右镜像和小幅拍摄角度差异，"
    "但不能把候选旋转或想象成另一个拍摄视面后才算匹配。"
)


TEMPLATE_LAYOUT_GUIDE = "第1张是模板参考；若包含上下多个格，每格都是独立参考示例，不代表候选必须在同一画面重复摆放多组鞋。"

def reference(ctx, slot):
    from core import shenhui_shoe_packaging as shoe

    root = Path(ctx["root"]) / "direct-references"
    root.mkdir(exist_ok=True)
    target = root / (slot + "-stacked-v1.jpg")
    single = root / (slot + "-single-v1.jpg")
    if target.exists():
        return str(target)
    if slot.startswith("tmz"):
        source = ctx["main_refs"][int(slot[-1]) - 1]
    elif slot == "yx":
        source = ctx.get("yx_ref") or str(shoe.SHOE_YX_REFERENCE_IMAGE)
    else:
        source = ctx["yq_refs"][slot]
    # Use the same single example twice, matching the controlled A/B treatment.
    # Original yq assets contain two different examples: take the first one.
    if slot.startswith("yq"):
        with Image.open(source) as opened:
            cell = ImageOps.exif_transpose(opened).convert("RGB")
            cell.crop((0, 0, cell.width, round(cell.height / 2))).save(
                single, quality=92
            )
        source = str(single)
    fast._readable_preview(source, single)
    with Image.open(single) as opened:
        cell = opened.convert("RGB")
        stacked = Image.new("RGB", (cell.width, cell.height * 2), "white")
        stacked.paste(cell, (0, 0))
        stacked.paste(cell, (0, cell.height))
        stacked.save(target, quality=95)
    return str(target)


def selection_prompt(ctx, slot, pool, same_side=False):
    rule = MATCH_RULE
    if slot == "tmz5":
        rule = "此坑位是标准单鞋源图。模板仅示例完整单鞋；正面或斜向角度、悬挂或平放允许不同。只核验完整单鞋、无独立功能卡遮挡，不套用其他坑位的精确视面要求。"
    elif slot == "yx":
        rule = "此坑位模板示例鞋与独立功能卡同框。鞋子角度及功能卡数量允许不同，必须同时看见实物鞋和独立功能卡；鞋身装饰不算独立卡。"
    prompt = (
        f"款号：{ctx['style']}\n色码：{ctx['color']}\n本次匹配坑位 {slot}。"
        "第1张是不可选的业务模板。"
        + (
            "第2张是本款已确认的外侧参照，也不可选；后续图片才是候选。候选须与本款参照展示同一鞋侧。"
            if same_side
            else "后续图片是剩余候选。"
        )
        + rule
        + f"已选图片已移除。选一张明确匹配的候选，允许编号：{json.dumps(pool)}。"
        '返回JSON {"candidate_id":"编号或空", "accepted":true或false, "evidence":"直接对照模板的简短依据"}。不能近似凑齐。'
    )
    if slot == "tmz5":
        prompt += "此坑位使用标准单鞋源图，按业务规则不要求与示例精确同角度；须保留完整单鞋且没有独立功能卡遮挡。"
    if slot == "yx":
        prompt += "功能卡数量不要求与模板一致，但必须是鞋与独立功能卡同框。"
    if ctx.get("repair_rejections"):
        prompt += "这是一次修复，之前未通过的图像比对结果：" + json.dumps(
            ctx["repair_rejections"], ensure_ascii=False
        )
    return prompt + "\n" + TEMPLATE_LAYOUT_GUIDE


def pair_panel(ctx, slot, name, root):
    paths = [reference(ctx, slot), ctx["previews"][name]]
    labels = ["REFERENCE", "CANDIDATE"]
    if slot == "yq3" and ctx.get("side_anchor"):
        paths.append(ctx["previews"][ctx["side_anchor"]])
        labels.append("SAME SHOE OUTER SIDE")
    width = 800 * len(paths)
    panel = Image.new("RGB", (width, 850), "white")
    draw = ImageDraw.Draw(panel)
    for index, path in enumerate(paths):
        with Image.open(path) as opened:
            fitted = ImageOps.contain(opened.convert("RGB"), (760, 780))
        panel.paste(
            fitted,
            (index * 800 + (800 - fitted.width) // 2, 50 + (780 - fitted.height) // 2),
        )
        draw.text((index * 800 + 15, 15), labels[index], fill="black")
    target = root / f"{slot}-pair.jpg"
    panel.save(target, quality=92)
    return target



def review_shoe_side(ctx, model, anchor, candidate):
    """Compare physical shoe sides with orientation changes shown explicitly."""
    root = Path(ctx["root"]) / "side-identity"
    root.mkdir(parents=True, exist_ok=True)
    source = Path(ctx["previews"][anchor])
    target = root / (hashlib.sha256(source.read_bytes()).hexdigest()[:16] + "-rotations.jpg")
    if not target.exists():
        with Image.open(source) as opened:
            im = opened.convert("RGB")
            board = Image.new("RGB", (1400, 1400), "white")
            for index, angle in enumerate((0, 90, 180, 270)):
                cell = ImageOps.contain(im.rotate(angle, expand=True), (680, 680))
                board.paste(cell, ((index % 2) * 700 + (700-cell.width)//2,
                                   (index // 2) * 700 + (700-cell.height)//2))
            board.save(target, quality=95)
    images = [str(target), ctx["previews"][candidate]]
    prompt = ('第1张是同一张已确认外侧照片的四种旋转方向，四格均为同一鞋侧；第2张是待检查照片。'
              '忽略朝向，检查第2张是否展示与第1张相同的鞋侧。内侧与外侧不可互换。'
              '按侧面图案与实际结构比较，不按鞋头左右位置。'
              '只返回JSON {"same_side":true或false,"reason":"直接可见的共同结构或差异"}。')
    payload, route = fast._request(
        {**ctx, "system_prompt":"你是商品图片核对员。只按实拍图回答JSON。"},
        model, prompt, images, "同款鞋侧身份复核",
    )
    if (not isinstance(payload, dict) or not isinstance(payload.get("same_side"), bool)
            or not isinstance(payload.get("reason"), str) or not payload["reason"].strip()):
        from core import shenhui_shoe_packaging as shoe
        raise shoe.ShoeSelectionError("鞋侧核验缺少有效结论与实际图像依据")
    return {"same_side":payload["same_side"], "response":payload, "model":route.model_id,
            "request":{"prompt":prompt,"images":images},
            "input_sha256":[hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in images]}

def audit(ctx, result, slots=None):
    from core import shenhui_shoe_sequential as sequence
    from core import shenhui_shoe_packaging as shoe

    targets = [
        slot
        for slot in (sequence.ORDER if slots is None else slots)
        if slot not in {"wpz5", "yq1"}
        and not (slot == "yx" and result.get("card_absence_verified"))
    ]
    root = Path(ctx["root"]) / f"direct-audit-{ctx.get('audit_round', 1)}"
    root.mkdir(exist_ok=True)
    reverse = {name: key for key, name in ctx["ids"].items()}
    local = {**ctx, "side_anchor": result["selected"].get("tmz3")}

    def review(slot):
        name = result["selected"].get(slot)
        if slot == "yq3" and not local.get("side_anchor"):
            return {
                "slot": slot,
                "accepted": False,
                "evidence": "缺少本款外侧参照",
                "model": "",
            }
        if not name or name not in reverse:
            return {
                "slot": slot,
                "accepted": False,
                "evidence": "缺少候选",
                "model": "",
            }
        panel = pair_panel(local, slot, name, root)
        images = [reference(ctx, slot), ctx["previews"][name]]
        prompt = (
            '第1张是模板，第2张是候选。先分别看两张实图中朝向镜头的鞋子部位与摆放，再判断是否同类拍摄视面。'
            '左右镜像只改变左右方向，不能把鞋头视面变成鞋跟视面，也不能把鞋面变成鞋底。忽略鞋款配色材质和鞋帮高低。'
            '不要根据两张轮廓相似直接判断。返回JSON {"template_view":"模板实际可见视面", '
            '"candidate_view":"候选实际可见视面", "match":true或false,"reason":"决定性可见依据"}。'
        )
        if slot == "tmz5":
            prompt = ('第1张为标准源图示例，第2张为待核验标准源图。此坑位业务上允许正面和斜向角度、悬挂和平放方式不同，不按前述其他坑位的精确视面规则拒绝。'
                      '直接核验候选是否完整单鞋且没有独立功能卡遮挡；鞋身自身装饰不是独立功能卡。'
                      '返回JSON {"match":true或false,"reason":"简短图像依据"}。')
        if slot == "yx":
            prompt = ('第1张为功能卡模板，第2张为候选。此坑位允许鞋子角度及功能卡数量不同，'
                      '只判断实物鞋和独立功能卡是否同框；鞋身装饰不是独立功能卡。'
                      '返回JSON {"match":true或false,"reason":"简短图像依据"}。')
        if slot in {"tmz1", "tmz3"}:
            prompt = (
                '第1张为上下重复的同一模板，第2张为候选。逐项看实际图片：'
                '先数每一格模板里的鞋只数（含鞋底和局部鞋，重复格不重复计数），再数候选里的鞋只数；'
                '接着比较鞋之间的摆放关系，包括相靠摆放还是上下分离；最后比较相机朝向鞋的实际视面。'
                '忽略鞋款配色材质鞋帮高低；允许左右镜像，但不能把鞋头视面换成鞋跟视面，也不能旋转候选来凑模板。'
                '返回JSON {"template_shoe_count":整数,"candidate_shoe_count":整数,'
                '"template_arrangement":"实际摆放","candidate_arrangement":"实际摆放",'
                '"arrangement_matches":true或false,"camera_view_matches":true或false,'
                '"match":true或false,"reason":"决定性可见依据"}。'
            )
        if slot == "yq2":
            prompt += "完整鞋底坑位允许一只或两只鞋底平铺朝向镜头，数量差异本身不算摆放不匹配。"
        prompt += "\n" + TEMPLATE_LAYOUT_GUIDE
        errors = []
        for model in ctx.get("direct_review_routes", ctx["routes"]):
            try:
                payload, route = fast._request(
                    {**ctx, "system_prompt": "你是商品图片核对员。只按实拍图回答JSON。"},
                    model, prompt, images, "模板与已选图直接复核 " + slot
                )
                if (
                    not isinstance(payload, dict)
                    or not isinstance(payload.get("match"), bool)
                    or not isinstance(payload.get("reason"), str)
                    or not payload["reason"].strip()
                ):
                    raise shoe.ShoeSelectionError("模板比对缺少有效结论与图像依据")
                structure_matches = True
                structural_checks = None
                if slot in {"tmz1", "tmz3"}:
                    counts = [payload.get("template_shoe_count"), payload.get("candidate_shoe_count")]
                    if (any(type(n) is not int or n < 1 for n in counts)
                            or not isinstance(payload.get("arrangement_matches"), bool)
                            or not isinstance(payload.get("camera_view_matches"), bool)):
                        raise shoe.ShoeSelectionError("缺少逐项构图核验结论")
                    # Existing outsole policy permits one or two full soles.
                    count_ok = counts[0] == counts[1] or (slot == "yq2" and counts[1] in (1, 2))
                    structure_matches = (count_ok and payload["arrangement_matches"]
                                         and payload["camera_view_matches"])
                    structural_checks = {"count_allowed":count_ok,
                        "arrangement_matches":payload["arrangement_matches"],
                        "camera_view_matches":payload["camera_view_matches"]}
                side = None
                if slot == "yq3" and payload["match"] and structure_matches:
                    # A successful stream may legitimately exceed 90 seconds
                    # while producing content. The next check gets its own
                    # inactivity deadline rather than inheriting elapsed time.
                    side = review_shoe_side({**ctx, "request_timeout":fast.REQUEST_TIMEOUT},
                                            model, local["side_anchor"], name)
                approved = payload["match"] and structure_matches and (slot != "yq3" or bool(side and side["same_side"]))
                record = {
                    "slot": slot,
                    "candidate_id": reverse[name],
                    "accepted": approved,
                    "evidence": payload["reason"] + (("；鞋侧：" + side["response"]["reason"]) if side else ""),
                    "side_identity": side,
                    "structural_checks": structural_checks,
                    "review_version": "pose_then_side_v1",
                    "visible_differences": payload.get("visible_differences", []),
                    "same_side": side["same_side"] if side else None,
                    "model": route.model_id,
                    "comparison": "direct_template_pair",
                    "template_source": reference(ctx, slot),
                    "comparison_image": str(panel),
                    "comparison_sha256": hashlib.sha256(panel.read_bytes()).hexdigest(),
                    "request": {"prompt": prompt, "images": images},
                    "input_sha256": [hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in images],
                    "response": payload,
                    "errors": errors,
                }
                (root / f"{slot}.json").write_text(
                    json.dumps(record, ensure_ascii=False, indent=2)
                )
                return record
            except shoe.ShoeSelectionError as exc:
                errors.append(str(exc))
        return {
            "slot": slot,
            "candidate_id": reverse[name],
            "accepted": False,
            "evidence": "模板比对请求未完成",
            "model": "",
            "errors": errors,
        }

    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(review, targets))
    evidence = {
        "model": "+".join(sorted({row["model"] for row in rows if row["model"]})),
        "review_models": {r["slot"]: r["model"] for r in rows},
        "response": {"reviews": rows},
        "approved": [r["slot"] for r in rows if r["accepted"]],
        "rejected": {r["slot"]: r["evidence"] for r in rows if not r["accepted"]},
        "errors": [error for row in rows for error in row.get("errors", [])],
        "comparison": "direct_template_pair",
    }
    (Path(ctx["root"]) / f"audit-{ctx.get('audit_round', 1)}.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2)
    )
    return evidence


def _repair_visual_order(ctx, slot, pool):
    """Cheap gradient ordering only; every candidate still needs model review.

    Uses Pillow and the standard library so packaged Windows needs no OpenCV,
    NumPy, or downloaded embedding model. Scores never filter candidates.
    """
    import math

    def descriptor(path, template=False):
        with Image.open(path) as opened:
            im = opened.convert("RGB")
            if template:
                im = im.crop((0, 0, im.width, im.height // 2))
            im.thumbnail((256, 256), Image.Resampling.LANCZOS)
        w, h = im.size
        pixels = list(im.getdata())
        corners = [pixels[i] for i in (0, w-1, (h-1)*w, h*w-1)]
        bg = [sum(sorted(p[c] for p in corners)[1:3])/2 for c in range(3)]
        mask = bytearray(max(abs(p[c]-bg[c]) for c in range(3)) > 15 for p in pixels)
        components = []
        for start in range(w*h):
            if not mask[start]:
                continue
            mask[start] = 0
            stack = [start]
            size = 0
            left, top, right, bottom = w, h, 0, 0
            while stack:
                i = stack.pop()
                y, x = divmod(i, w)
                size += 1
                left, top = min(left, x), min(top, y)
                right, bottom = max(right, x), max(bottom, y)
                for ny in range(max(0, y-1), min(h, y+2)):
                    for nx in range(max(0, x-1), min(w, x+2)):
                        j = ny*w+nx
                        if mask[j]:
                            mask[j] = 0
                            stack.append(j)
            components.append((size, left, top, right+1, bottom+1))
        if components:
            threshold = max(c[0] for c in components)*.08
            keep = [c for c in components if c[0] >= threshold]
            im = im.crop((min(c[1] for c in keep), min(c[2] for c in keep),
                          max(c[3] for c in keep), max(c[4] for c in keep)))
        pic = ImageOps.contain(im.convert("L"), (116, 116), Image.Resampling.BILINEAR)
        canvas = Image.new("L", (128, 128), 255)
        canvas.paste(pic, ((128-pic.width)//2, (128-pic.height)//2))
        descriptors = []
        for image in (canvas, ImageOps.mirror(canvas)):
            values = list(image.getdata())
            cells = [[0.0]*9 for _ in range(64)]
            for y in range(128):
                for x in range(128):
                    dx = (values[y*128+min(127,x+1)]-values[y*128+max(0,x-1)])/(1 if x in (0,127) else 2)
                    dy = (values[min(127,y+1)*128+x]-values[max(0,y-1)*128+x])/(1 if y in (0,127) else 2)
                    cells[(y//16)*8+x//16][int((math.atan2(dy,dx)%math.pi)*9/math.pi)%9] += math.hypot(dx,dy)
            vector = []
            for y in range(7):
                for x in range(7):
                    block = [v for yy in (y,y+1) for xx in (x,x+1) for v in cells[yy*8+xx]]
                    norm = math.sqrt(sum(v*v for v in block))+1e-5
                    vector.extend(v/norm for v in block)
            norm = math.sqrt(sum(v*v for v in vector))+1e-9
            descriptors.append([v/norm for v in vector])
        return descriptors

    try:
        refs = descriptor(reference(ctx, slot), template=True)
        scores = []
        for key in pool:
            vectors = descriptor(ctx["previews"][ctx["ids"][key]])
            score = max(sum(a*b for a,b in zip(ref, vec)) for ref in refs for vec in vectors)
            scores.append((key, score))
        # Stable sort; original order resolves ties, without filename semantics.
        scores.sort(key=lambda pair: pair[1], reverse=True)
        return [key for key, _ in scores], scores
    except (OSError, ValueError, KeyError):
        return list(pool), []


def select_repair(ctx, model, slot, pool, same_side, reference_images):
    """Review visually ordered candidates individually within one slot budget."""
    from types import SimpleNamespace
    from core import shenhui_shoe_packaging as shoe

    deadline = time.monotonic() + 90
    order, scores = _repair_visual_order(ctx, slot, pool)
    score_by_id = dict(scores)
    attempts = []
    last_model = ""
    for key in order:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        root = Path(ctx["root"]) / f"repair-check-{slot}-{len(attempts)+1}"
        root.mkdir(parents=True, exist_ok=True)
        selected = {slot: ctx["ids"][key]}
        if same_side and ctx.get("side_anchor"):
            selected["tmz3"] = ctx["side_anchor"]
        checked = audit(
            {**ctx, "root":str(root), "routes":[model],
             "direct_review_routes":[model],
             "request_timeout":fast.REQUEST_TIMEOUT},
            {"selected":selected}, [slot],
        )
        row = next((r for r in checked.get("response", {}).get("reviews", [])
                    if r.get("slot") == slot and r.get("candidate_id") == key), {})
        last_model = row.get("model") or last_model
        attempt = {"ids":[key], "visual_order_score":score_by_id.get(key),
                   "pair_review":checked}
        attempts.append(attempt)
        if (slot in checked["approved"] and row.get("accepted") is True
                and row.get("model") and row.get("evidence")):
            response = {"accepted":True,"candidate_id":key,"evidence":row["evidence"]}
            attempt["response"] = response
            return response, SimpleNamespace(model_id=row["model"]), attempts
        # A failed or timed-out image cannot consume another attempt while
        # other candidates remain unexamined. Scores never imply acceptance.
    if not last_model:
        raise shoe.ShoeSelectionError("逐张重选未获得有效复核响应；" + json.dumps(attempts,ensure_ascii=False))
    return {"accepted":False,"candidate_id":"","evidence":"逐张复核未找到明确匹配或已用尽预算"}, SimpleNamespace(model_id=last_model), attempts
