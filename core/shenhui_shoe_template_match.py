"""Template comparisons with measured background and explicit candidate fact gates."""

from __future__ import annotations

import hashlib
import json
import math
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


TEMPLATE_LAYOUT_GUIDE = "第1张是单格模板参考，只数这一个拍摄画面内的鞋；后续图是候选或成品，不把跨图片的鞋累加。"

HUMAN_REVIEW_METHOD = (
    "模板是通用品类拍摄示例，不是同款商品身份证明；候选与模板的鞋款、品牌、配色、材质、鞋帮高低不同，绝不能作为拒绝理由。"
    "只有实际导出图与其所选原图需要保持商品内容一致，不能要求候选与业务模板为同款。"
    "独立终审方法：前序模型选择与通过记录不是事实，必须重新观察实图。"
    "先分别描述模板和候选，再比较，不能先下通过结论再编依据。"
    "按鞋只数、摆放关系、脚尖/鞋跟位置、近镜头端、后跟弧面、鞋底纹路、内里逐项观察；"
    "正侧面不能替代侧后方，鞋头近的前斜视不能替代鞋跟近的后斜视。"
    "横竖判断沿鞋底脚尖到鞋跟的轴线，不能把高筒靴靴筒或拉环当成鞋轴。"
    "单独检查背景四周和内部：局部接触阴影允许，摄影棚墙线、大片亮暗渐变和光斑不算纯底。"
    "检查独立功能卡、纸片和异物，不能将鞋身装饰误当功能卡。"
    "扣在鞋带或鞋面上的卡通、毛绒、IP挂饰即使悬垂仍属装饰；功能卡须是展示功能、材质、参数或示意图的独立商品说明载体，不能只凭挂法和形状判定。"
    "品类规则与对应模板共同决定要求，不能将运动鞋的鞋底组合要求套到雪地靴内里图。"
    "同鞋侧判断看图案和结构，不看鞋尖向左还是向右。"
    "任何决定性条件不满足或看不清，都应拒绝并在reason指出具体可见差异和修复目标；"
    "没有合适候选可以缺图，不能为了凑齐接受近似图。"
)

def reference(ctx, slot):
    from core import shenhui_shoe_packaging as shoe

    root = Path(ctx["root"]) / "direct-references"
    root.mkdir(exist_ok=True)
    single = root / (slot + "-single-v1.jpg")
    if single.exists():
        return str(single)
    if slot.startswith("tmz"):
        source = ctx["main_refs"][int(slot[-1]) - 1]
    elif slot == "yx":
        source = ctx.get("yx_ref") or str(shoe.SHOE_YX_REFERENCE_IMAGE)
    else:
        source = ctx["yq_refs"][slot]
    # Repeated reference tiles caused real reviewers to count two shoes in a
    # one-shoe pose. Original yq assets contain two examples: use the first.
    if slot.startswith("yq"):
        with Image.open(source) as opened:
            cell = ImageOps.exif_transpose(opened).convert("RGB")
            cell.crop((0, 0, cell.width, round(cell.height / 2))).save(
                single, quality=92
            )
        source = str(single)
    fast._readable_preview(source, single)
    return str(single)


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
    if slot == "tmz4":
        from core.shenhui_shoe_sequential import contract
        prompt += "模板缩略图透视不清时仍须满足本坑位业务视角：" + json.dumps(
            contract(slot, ctx.get("category", "")), ensure_ascii=False)
    prompt += "候选须均匀纯白或纯灰底，不能带摄影棚墙面光照渐变；除功能卡坑位yx外，不得混入独立功能卡。"
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
              '左右脚的同一外侧可以使用镜像印花；图案中耳朵或文字左右顺序反转本身不能证明变成内侧。'
              '先比较拉链、孔位、魔术贴起止端、拼片缝线、鞋底结构这些可见位置关系，再辅助看印花。'
              '没有内侧参照时，不能把任意印花差异臆称为“内侧特有标识”；线稿与填色、左右脚不同装饰本身不证明结构鞋侧相反。'
              '判为相反鞋侧须指出明确结构差异及它们在两图的位置；没有明确证据时不要编造差异。'
              '只返回JSON {"same_side":true或false,"reason":"直接可见的共同结构或差异"}。')
    payload, route = fast._request(
        {**ctx, "system_prompt":"你是商品图片核对员。只按实拍图回答JSON。",
         "request_purpose":"same_side_check"},
        model, prompt, images, "同款鞋侧身份复核",
    )
    if (not isinstance(payload, dict) or not isinstance(payload.get("same_side"), bool)
            or not isinstance(payload.get("reason"), str) or not payload["reason"].strip()):
        from core import shenhui_shoe_packaging as shoe
        raise shoe.ShoeSelectionError("鞋侧核验缺少有效结论与实际图像依据")
    return {"same_side":payload["same_side"], "response":payload, "model":route.model_id,
            "request":{"prompt":prompt,"images":images},
            "input_sha256":[hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in images]}


VISUAL_FACTS_PROMPT = """另逐项观察候选原图，返回 candidate_facts 对象：
background_kind 只能为 plain_white/plain_gray/studio_gradient/scene/unclear；
均匀白灰底允许鞋底附近局部落地阴影，但墙面光斑、大片明暗渐变、摄影棚墙地背景不是纯色底。
independent_cards 为布尔值：是否有独立放置的功能说明卡；鞋身固定装饰、印花、徽章不是独立卡。附着在鞋口/鞋舌的小条码吊牌或尺码标签不属于独立功能卡，不得仅因它把标准源图拒绝或当成yx功能卡图；明显遮挡鞋体导致不完整则另判完整性。
toe 与 heel 为鞋底最前端与最后端的归一化[x,y]坐标，heel不是高鞋筒顶端或提环。
near_end 为 heel/toe/neither/unclear；判断哪个端靠近相机，不是哪个端在画面左侧。
heel_back_visible 为布尔值：可见朝后的后跟弧面/包边；可通过后跟提环下方的后缝、后跟标识区域及包边辨认。只见后半段侧面不算；不要求正后方直拍，也不要求整个后跟面毫无遮挡。露底角度下仍须逐项观察后跟区域，不能因为外底面积大就自动认定后跟不可见。
view 为 side/rear_oblique/rear/front_oblique/front/top/bottom/unclear。
outsole_tread_visible、upper_side_visible、lining_visible 为布尔值，分别观察外底触地花纹面、鞋帮侧面、鞋口内部衬里是否可见；鞋底侧墙不算外底花纹面。
每个事实须按候选本身观察，不得为了 match=true 改写。"""



def background_perimeter_evidence(path):
    """Measure the upper perimeter, avoiding the permitted contact shadow.

    This is supporting evidence, not a verdict about the unseen interior.
    """
    with Image.open(path) as opened:
        im = ImageOps.exif_transpose(opened).convert("RGB")
        im.thumbnail((160, 160))
        w, h = im.size
        pixels = [im.getpixel((x, y)) for y in range(h) for x in range(w)
                  if y < max(1, h * .08) or
                  (y < h * .7 and (x < max(1, w * .08) or x >= w * .92))]
    levels = sorted(sum(pixel) / 3 for pixel in pixels)
    return {"region": "上沿及左右边缘上70%，不包含底部落地阴影",
            "luminance_p05": round(levels[int((len(levels)-1)*.05)], 2),
            "luminance_p95": round(levels[int((len(levels)-1)*.95)], 2),
            "neutral_fraction": round(sum(max(p)-min(p) <= 6 for p in pixels)/len(pixels), 3)}

def visual_fact_failures(slot, facts, image_size, category="", perimeter=None):
    """Fail closed on missing observations, independently of model match votes."""
    if not isinstance(facts, dict):
        return ["缺少候选独立观察"]
    failures = []
    if facts.get("background_kind") not in {"plain_white", "plain_gray"}:
        failures.append("背景不是均匀纯白或纯灰底")
    if (perimeter and perimeter["luminance_p05"] >= 175
            and perimeter["luminance_p95"] - perimeter["luminance_p05"] > 20):
        failures.append("背景边缘存在大范围亮度变化，不能按纯色底放行")
    cards = facts.get("independent_cards")
    if type(cards) is not bool:
        failures.append("缺少独立功能卡观察")
    elif cards != (slot == "yx"):
        failures.append("功能卡应与鞋同框" if slot == "yx" else "普通鞋图混入独立功能卡")
    if slot in {"tmz3", "yq3"}:
        points = [facts.get("toe"), facts.get("heel")]
        valid = all(isinstance(p, list) and len(p) == 2 and all(
            type(v) in (int, float) and math.isfinite(v) and 0 <= v <= 1 for v in p
        ) for p in points)
        if not valid:
            failures.append("缺少有效鞋头鞋跟坐标")
        else:
            toe, heel = points
            dx = abs(toe[0] - heel[0]) * image_size[0]
            dy = abs(toe[1] - heel[1]) * image_size[1]
            if math.hypot(dx, dy) < min(image_size) * .1:
                failures.append("鞋头鞋跟坐标不能区分脚掌轴线")
            elif (slot == "tmz3" and dy <= dx) or (slot == "yq3" and dx <= dy):
                failures.append("鞋头鞋跟轴线方向不符")
        # A small rear perspective may still primarily show the full side;
        # the template comparison checks that view while coordinates enforce
        # the non-negotiable upright foot axis. Horizontal yq3 is stricter.
        allowed_views = {"side", "rear_oblique"} if slot == "tmz3" else {"side"}
        if facts.get("view") not in allowed_views:
            failures.append("要求完整鞋侧视面")
    if slot == "tmz4" and category != "雪地":
        if (facts.get("near_end") != "heel" or facts.get("heel_back_visible") is not True
                or facts.get("view") not in ({"rear_oblique", "rear", "bottom"} if category == "运动" else {"rear_oblique", "rear"})):
            failures.append("要求后跟近鞋头远且可见后跟弧面的侧后视角")
    if slot == "tmz4" and category == "运动":
        if facts.get("outsole_tread_visible") is not True or facts.get("upper_side_visible") is not True:
            failures.append("运动鞋后斜视须同时露出外底花纹面与鞋帮侧面")
    if slot == "tmz4" and category == "雪地":
        if facts.get("lining_visible") is not True or facts.get("upper_side_visible") is not True:
            failures.append("雪地鞋须同时露出鞋口内里与鞋帮侧面")
    if slot == "yq2":
        if facts.get("view") != "bottom" or facts.get("outsole_tread_visible") is not True:
            failures.append("完整鞋底须正朝镜头，不能以倾斜露底替代")
        if facts.get("upper_side_visible") is not False:
            failures.append("完整鞋底图不能在鞋底后方明显露出鞋帮侧面")
    if slot == "tmz2":
        if facts.get("outsole_tread_visible") is not True or facts.get("upper_side_visible") is not True:
            failures.append("双鞋组合须同时看见前鞋鞋帮与后鞋完整外底花纹，上下分离但未露底不符合")
    return failures

def observation_conflicts(ctx, name, slot, payload):
    """Find conflicting observable facts, without treating a prior choice as truth."""
    key = next((key for key, value in ctx.get('ids', {}).items() if value == name), None)
    observed = ctx.get('candidate_observations', {}).get(key, {})
    earlier, current = observed.get('facts'), payload.get('candidate_facts')
    if not isinstance(earlier, dict) or not isinstance(current, dict):
        return []
    # Both independent passes agree there are no physical shoes. Whether the
    # non-shoe object is a card or an insole cannot change this slot rejection.
    if (slot in {'tmz1', 'tmz2', 'tmz3'}
            and type(observed.get('shoe_count')) is int and observed['shoe_count'] == 0
            and type(payload.get('candidate_shoe_count')) is int and payload['candidate_shoe_count'] == 0):
        return []
    conflicts = []
    def compare(field, first, second):
        if first != second:
            conflicts.append({'fact': field, 'observation': first, 'review': second})
    if slot in {'tmz1', 'tmz2', 'tmz3'}:
        first, second = observed.get('shoe_count'), payload.get('candidate_shoe_count')
        if type(first) is int and type(second) is int:
            compare('shoe_count', first, second)
    if slot == 'tmz1' and observed.get('kind') in {'pair_grounded', 'pair_floating'}:
        arrangement = payload.get('arrangement_matches')
        if type(arrangement) is bool:
            compare('grounded_pair_arrangement', observed['kind'] == 'pair_grounded', arrangement)
    fields = ['independent_cards']
    if slot == 'tmz2':
        fields += ['outsole_tread_visible', 'upper_side_visible']
        if observed.get('kind') in {'pair_front_sole', 'pair_floating', 'pair_grounded'} and type(payload.get('arrangement_matches')) is bool:
            compare('front_shoe_and_back_outsole_arrangement', observed['kind'] == 'pair_front_sole', payload['arrangement_matches'])
    if slot == 'yq2':
        fields += ['outsole_tread_visible', 'upper_side_visible']
        if earlier.get('view') != 'unclear' and current.get('view') != 'unclear':
            compare('full_outsole_view', earlier.get('view') == 'bottom', current.get('view') == 'bottom')
    if slot == 'tmz4':
        fields += (['lining_visible', 'upper_side_visible'] if ctx.get('category') == '雪地'
                   else ['heel_back_visible'])
        if ctx.get('category') == '运动':
            fields += ['outsole_tread_visible', 'upper_side_visible']
        if ctx.get('category') != '雪地':
            first, second = earlier.get('near_end'), current.get('near_end')
            if first in {'heel', 'toe', 'neither'} and second in {'heel', 'toe', 'neither'}:
                compare('near_end', first, second)
    for field in fields:
        first, second = earlier.get(field), current.get(field)
        if type(first) is bool and type(second) is bool:
            compare(field, first, second)
    if slot in {'tmz3', 'yq3'}:
        known = {'side', 'rear_oblique', 'rear', 'front_oblique', 'front', 'top', 'bottom'}
        first, second = earlier.get('view'), current.get('view')
        if first in known and second in known:
            allowed = {'side', 'rear_oblique'} if slot == 'tmz3' else {'side'}
            compare('side_view_requirement', first in allowed, second in allowed)
    return conflicts


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
                "status": "review_unknown",
                "evidence": "缺少本款外侧参照",
                "model": "",
            }
        if not name or name not in reverse:
            return {
                "slot": slot,
                "accepted": False,
                "status": "source_missing",
                "evidence": "缺少候选",
                "model": "",
            }
        panel = pair_panel(local, slot, name, root)
        images = [reference(ctx, slot), ctx["previews"][name]]
        input_hashes = [hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in images]
        anchor_hash = (hashlib.sha256(Path(ctx['previews'][local['side_anchor']]).read_bytes()).hexdigest()
                       if slot == 'yq3' else None)
        review_policy = {"version": "pose_facts_v2", "category": ctx.get("category", ""),
                         "gray_standard": bool(ctx.get("gray_standard"))}
        observation = ctx.get('candidate_observations', {}).get(reverse[name])
        if observation is not None:
            review_policy['observation_sha256'] = hashlib.sha256(
                json.dumps(observation, sort_keys=True).encode()).hexdigest()
        if ctx.get('reuse_inventory_reviews'):
            for selection_record in reversed(result.get('records', [])):
                if selection_record.get('slot') != slot:
                    continue
                for attempt in reversed(selection_record.get('small_batch_attempts', [])):
                    prior = attempt.get('pair_review') or {}
                    for checked in (prior.get('response') or {}).get('reviews', []):
                        if (checked.get('slot') == slot and checked.get('candidate_id') == reverse[name]
                                and checked.get('accepted') is True and slot in prior.get('approved', [])
                                and checked.get('review_version') == 'pose_facts_v2'
                                and checked.get('review_policy') == review_policy
                                and checked.get('input_sha256') == input_hashes
                                and (slot != 'yq3' or checked.get('side_anchor_sha256') == anchor_hash)):
                            reused = {**checked, 'reused_unchanged_inputs':True}
                            (root / f'{slot}.json').write_text(json.dumps(reused, ensure_ascii=False, indent=2))
                            return reused
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
        if slot in {"tmz1", "tmz2", "tmz3"}:
            prompt = (
                '第1张为单格模板，第2张为候选。逐项看实际图片：'
                '先数第1张模板里的鞋只数（含鞋底和局部鞋），再单独数第2张候选里的鞋只数；不要跨图片累加；'
                '接着比较鞋之间的摆放关系，包括相靠摆放还是上下分离；最后比较相机朝向鞋的实际视面。'
                '忽略鞋款配色材质鞋帮高低；允许左右镜像，但不能把鞋头视面换成鞋跟视面，也不能旋转候选来凑模板。'
                '返回JSON {"template_shoe_count":整数,"candidate_shoe_count":整数,'
                '"template_arrangement":"实际摆放","candidate_arrangement":"实际摆放",'
                '"arrangement_matches":true或false,"camera_view_matches":true或false,'
                '"match":true或false,"reason":"决定性可见依据"}。'
            )
            if slot == 'tmz2':
                prompt += '本图位必须两只完整鞋，前鞋正常展示鞋帮，后鞋完整外底朝向镜头；两鞋上下分离但没有后鞋完整外底不能算匹配。'
        if slot == "tmz4":
            requirements = sequence.contract(slot, ctx.get("category", ""))
            prompt = (
                "第1张是业务模板，第2张是候选。模板缩略图的轻微透视可能不清楚，"
                "本坑位业务要求如下，须逐项观察候选是否满足，不得把侧后方要求改成正侧面。"
                + json.dumps(requirements, ensure_ascii=False)
                + '。返回JSON {"match":true或false,"reason":"逐项可见依据"}。'
            )
        if slot == "yq2":
            prompt += "完整鞋底坑位允许一只或两只鞋底平铺朝向镜头，数量差异本身不算摆放不匹配。"
        perimeter = background_perimeter_evidence(ctx["previews"][name])
        prompt += ("\n款号：" + ctx.get('style', '') + "；品类：" + ctx.get('category', '')
                   + "；图位：" + slot + "\n" + HUMAN_REVIEW_METHOD
                   + "\n" + TEMPLATE_LAYOUT_GUIDE + "\n" + VISUAL_FACTS_PROMPT)
        prompt += ("\n候选边缘像素实测（亮度0黑255白）：" + json.dumps(perimeter, ensure_ascii=False)
                   + "。边缘均匀且只有鞋底附近局部落地阴影时，不应误报摄影棚渐变；仍检查内部是否有墙面、光斑或场景。")
        if ctx.get('export_images'):
            images.extend(ctx['export_images'])
            prompt += ('\n第2张是所选原图，第3张起是这一原图及其严格同前景配对的实际导出文件。'
                       'match和candidate_facts只判断第2张原图是否符合图位。逐张检查成品是否截断鞋、错换内容、损坏或违反背景要求；'
                       '允许规定的缩放、画布尺寸和白灰底转换，不因这些正常加工拒绝。'
                       '另返回export_checks数组，每个成品一项 {"index":从0开始,"accepted":true或false,"reason":"可见依据"}，'
                       '必须覆盖全部'+str(len(ctx['export_images']))+'张成品。原图不合格与加工损坏须分别判断。')
        elif ctx.get('export_original'):
            images.append(ctx['export_original'])
            prompt += "\n第2张是实际导出成品，第3张是选择的原图。以成品判定姿势与背景；若成品有截断、内容错换或处理损坏，必须拒绝。"
        if ctx.get('prior_selection_evidence'):
            previous = ctx['prior_selection_evidence']
            reasons = [{'selected':r.get('selected'), 'attempts':r.get('attempts', [])}
                       for r in previous.get('records', []) if r.get('slot') == slot]
            prompt += ("\n前序选择记录仅供追溯，不构成通过依据：" + json.dumps({
                'selected':previous.get('selected', {}).get(slot), 'records':reasons,
                'full_candidate_pool':ctx.get('ids', {}),
            }, ensure_ascii=False)
                + "。先独立判断本张是否合格；若不合格，指出需要重新检索的姿势或背景条件，补齐阶段可访问完整候选池，不能为保留前序结论降低标准。")
        errors = []
        disputed = []
        actual_models = set()
        for model in ctx.get("direct_review_routes", ctx["routes"]):
            if model in actual_models:
                continue
            try:
                payload, route = fast._request(
                    {**ctx, "system_prompt": "你是商品图片核对员。只按实拍图回答JSON。",
                     "request_purpose": "observation_fact_dispute" if disputed else (
                         "review_output_invalid" if errors else "primary_review")},
                    model, prompt, images, "模板与已选图直接复核 " + slot
                )
                if disputed and route.model_id in actual_models:
                    errors.append('备用请求仍落到同一实际模型，不能充当独立事实裁决')
                    continue
                actual_models.add(route.model_id)
                if (
                    not isinstance(payload, dict)
                    or not isinstance(payload.get("match"), bool)
                    or not isinstance(payload.get("reason"), str)
                    or not payload["reason"].strip()
                ):
                    raise shoe.ShoeSelectionError("模板比对缺少有效结论与图像依据")
                structure_matches = True
                structural_checks = None
                if slot in {"tmz1", "tmz2", "tmz3"}:
                    counts = [payload.get("template_shoe_count"), payload.get("candidate_shoe_count")]
                    if (any(type(n) is not int for n in counts)
                            or counts[0] < 1 or counts[1] < 0
                            or not isinstance(payload.get("arrangement_matches"), bool)
                            or not isinstance(payload.get("camera_view_matches"), bool)):
                        raise shoe.ShoeSelectionError("缺少逐项构图核验结论")
                    expected_count = 1 if slot == 'tmz3' else 2
                    if counts[0] != expected_count:
                        raise shoe.ShoeSelectionError('模板鞋数与本图位定义矛盾，属于审核事实错误，不能据此批准或排除原图')
                    # Existing outsole policy permits one or two full soles.
                    count_ok = counts[0] == counts[1] or (slot == "yq2" and counts[1] in (1, 2))
                    structure_matches = (count_ok and payload["arrangement_matches"]
                                         and payload["camera_view_matches"])
                    structural_checks = {"count_allowed":count_ok,
                        "arrangement_matches":payload["arrangement_matches"],
                        "camera_view_matches":payload["camera_view_matches"]}
                with Image.open(ctx["previews"][name]) as candidate_image:
                    fact_failures = visual_fact_failures(
                        slot, payload.get("candidate_facts"), candidate_image.size, ctx.get("category", ""), perimeter
                    )
                conflicts = observation_conflicts(ctx, name, slot, payload)
                if conflicts and not disputed:
                    disputed.append({'model': route.model_id, 'facts': conflicts, 'response': payload,
                                     'source_match':payload['match'] and structure_matches and not fact_failures})
                    errors.append('独立观察与审核的可见事实冲突，须独立裁决后才能选用或排除原图')
                    prompt += ('\n本张原图的两次独立观察在以下可见事实发生冲突：'
                               + json.dumps([c['fact'] for c in conflicts], ensure_ascii=False)
                               + '。为避免前序误判诱导，这里不提供两次观察的取值。请重新独立看图裁决，不能按票数、前序结论或凑齐图位判断；'
                               '本次重点解决列出的争议事实，不要从功能卡是否存在推导鞋子视面，也不要从鞋只数推导背景；各事实须分别观察。'
                               '先依据鞋头包头、鞋跟后缝、提环所在端确定鞋头鞋跟，再数互相独立的鞋底与鞋口。'
                               '仍须完整返回原有JSON和逐张成品检查。')
                    continue
                structure_matches = structure_matches and not fact_failures
                if disputed and disputed[0]['source_match'] != (payload['match'] and structure_matches):
                    # A second visual opinion is not ground truth. Real runs
                    # showed a correct first review being overturned by an
                    # invented heel occlusion. Preserve the source on dispute.
                    record = {'slot':slot,'candidate_id':reverse[name],'accepted':False,
                              'status':'review_unknown','model':route.model_id,
                              'evidence':'两次独立精确审核结论冲突，保留原图待复核，不能据此通过或排除候选',
                              'errors':errors,'disputed_observations':disputed,
                              'response':payload,'request':{'prompt':prompt,'images':images},
                              'input_sha256':input_hashes}
                    (root/f'{slot}.json').write_text(json.dumps(record,ensure_ascii=False,indent=2))
                    return record
                side = None
                if slot == "yq3" and payload["match"] and structure_matches:
                    # A successful stream may legitimately exceed 90 seconds
                    # while producing content. The next check gets its own
                    # inactivity deadline rather than inheriting elapsed time.
                    side = review_shoe_side({**ctx, "request_timeout":fast.REQUEST_TIMEOUT},
                                            model, local["side_anchor"], name)
                approved = payload["match"] and structure_matches and (slot != "yq3" or bool(side and side["same_side"]))
                status = 'accepted' if approved else 'source_invalid'
                if ctx.get('export_images'):
                    checks = payload.get('export_checks')
                    if (not isinstance(checks, list) or len(checks) != len(ctx['export_images'])
                            or any(not isinstance(r, dict) or type(r.get('accepted')) is not bool
                                   or type(r.get('index')) is not int
                                   or not isinstance(r.get('reason'), str) or not r['reason'].strip() for r in checks)
                            or {r['index'] for r in checks} != set(range(len(checks)))):
                        raise shoe.ShoeSelectionError('成品检查未返回完整逐图结论')
                    if approved and not all(r['accepted'] for r in checks):
                        approved, status = False, 'export_invalid'
                record = {
                    "slot": slot,
                    "candidate_id": reverse[name],
                    "accepted": approved,
                    "status": status,
                    "evidence": payload["reason"] + ("；" + "；".join(fact_failures) if fact_failures else "") + (("；鞋侧：" + side["response"]["reason"]) if side else ""),
                    "side_identity": side,
                    "structural_checks": structural_checks,
                    "review_version": "pose_facts_v2",
                    "review_policy": review_policy,
                    "fact_failures": fact_failures,
                    "background_perimeter": perimeter,
                    "visible_differences": payload.get("visible_differences", []),
                    "same_side": side["same_side"] if side else None,
                    "model": route.model_id,
                    "comparison": "direct_template_pair",
                    "template_source": reference(ctx, slot),
                    "comparison_image": str(panel),
                    "comparison_sha256": hashlib.sha256(panel.read_bytes()).hexdigest(),
                    "request": {"prompt": prompt, "images": images},
                    "input_sha256": input_hashes,
                    "side_anchor_sha256": anchor_hash,
                    "response": payload,
                    "errors": errors,
                    "disputed_observations": disputed,
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
            "status": "review_unknown",
            "evidence": "模板比对请求未完成",
            "model": "",
            "errors": errors,
            "disputed_observations": disputed,
        }

    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(review, targets))
    evidence = {
        "model": "+".join(sorted({row["model"] for row in rows if row["model"]})),
        "review_models": {r["slot"]: r["model"] for r in rows},
        "response": {"reviews": rows},
        "approved": [r["slot"] for r in rows if r["accepted"]],
        "rejected": {r["slot"]: r["evidence"] for r in rows if not r["accepted"]},
        "outcomes": {r['slot']:r.get('status', 'accepted' if r['accepted'] else 'source_invalid') for r in rows},
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
        refs = descriptor(reference(ctx, slot))
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


def select_inventory(ctx, model, slot, pool, same_side, reference_images):
    """Inspect the complete pool before independently checking a proposal.

    Three distinct proposals bound work without starving candidates ranked low
    by a cheap visual descriptor. A valid negative is never sent to a second
    model for a more favourable vote.
    """
    from types import SimpleNamespace
    from core import shenhui_shoe_packaging as shoe

    remaining = list(pool)
    attempts = []
    last_model = model
    for round_index in range(3):
        if not remaining:
            break
        root = Path(ctx['root']) / f'inventory-{slot}-{round_index + 1}'
        root.mkdir(parents=True, exist_ok=True)
        images = list(reference_images)
        max_sheets = shoe.SHOE_MULTIMODAL_IMAGE_INPUT_LIMIT - len(images)
        chunk = max(ctx.get('inventory_chunk_size', 6), (len(remaining) + max_sheets - 1) // max_sheets)
        for offset in range(0, len(remaining), chunk):
            keys = remaining[offset:offset + chunk]
            target = root / f'candidates-{offset // chunk}.jpg'
            shoe._create_contact_sheet(
                [{'filename':ctx['ids'][k], 'path':ctx['previews'][ctx['ids'][k]]} for k in keys],
                target, candidate_labels=keys, columns=2, tile_width=ctx.get('inventory_tile_width', 600),
                image_height=ctx.get('inventory_tile_width', 600) * 9 // 10, quality=90,
            )
            images.append(str(target))
        prompt = selection_prompt(ctx, slot, remaining, same_side)
        prompt += ('\n完整检查所有候选面板后再选。先分别观察模板和候选的鞋只数、摆放及实际视面。'
                   '鞋盒、标签特写、鞋垫不能冒充完整实物鞋；不要只看轮廓。'
                   '另返回template_observation和candidate_observation说明实际可见内容。')
        payload, route = fast._request(ctx, model, prompt, images, '完整候选选图 ' + slot)
        last_model = route.model_id
        attempt = {'pool':list(remaining), 'proposal':payload, 'model':last_model,
                   'request':{'prompt':prompt, 'images':images}}
        attempts.append(attempt)
        (root / 'proposal.json').write_text(json.dumps(attempt, ensure_ascii=False, indent=2))
        key = payload.get('candidate_id') if isinstance(payload, dict) else None
        if not isinstance(payload, dict) or payload.get('accepted') is not True or key not in remaining:
            break
        if ctx.get('proposal_only') or ctx.get('repair_only'):
            return payload, route, attempts
        selected = {slot:ctx['ids'][key]}
        if same_side and ctx.get('side_anchor'):
            selected['tmz3'] = ctx['side_anchor']
        checked = audit({**ctx, 'root':str(root), 'routes':[model],
                         'direct_review_routes':[model]}, {'selected':selected}, [slot])
        attempt['ids'] = [key]
        attempt['pair_review'] = checked
        (root / 'proposal.json').write_text(json.dumps(attempt, ensure_ascii=False, indent=2))
        row = next((r for r in checked.get('response', {}).get('reviews', [])
                    if r.get('slot') == slot and r.get('candidate_id') == key), {})
        if slot in checked['approved'] and row.get('accepted') is True:
            return {'accepted':True, 'candidate_id':key, 'evidence':row['evidence']}, SimpleNamespace(model_id=row['model']), attempts
        family = shoe._copy_variant_key(ctx['ids'][key])
        remaining = [k for k in remaining if shoe._copy_variant_key(ctx['ids'][k]) != family]
    return {'accepted':False, 'candidate_id':'', 'evidence':'完整候选未找到经独立复核通过的图片'}, SimpleNamespace(model_id=last_model), attempts


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
