"""Per-style, row-addressed template/source/export boards are the review input.

The reviewer sees pixels and contracts, never prior acceptance or mask scores.
Each row has independent validation, caching and repair status.
"""
from __future__ import annotations

import os

from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from pathlib import Path
import hashlib
import json

from PIL import Image, ImageDraw, ImageFont, ImageOps

from core import shenhui_shoe_fast as fast
from core import shenhui_shoe_template_match as direct
from core import shenhui_shoe_sequential as sequence
from core import shenhui_shoe_source_review as source_review

VERSION = 'style-comparison-board-v12'
PAGE_ROWS = 4
# A/B/C 改选机制默认关闭：实测它在"已经正确"的槽位上有约 40% 偏好抖动，
# 会在真实跑批里把正确的图换掉。开启需业务确认（实验用 SHOE_BOARD_ALTERNATES=1）。
SHOE_BOARD_ALTERNATES = os.environ.get('SHOE_BOARD_ALTERNATES', '0').strip() == '1'
CELL_WIDTH = 600
ROW_HEIGHT = 460
MAX_UNKNOWN_ATTEMPTS = 2

METHOD = '''你是独立商品图片审核员。图片是按款号制作的对照看板，每行有稳定的row_id和色码。
每行从左到右是 TEMPLATE(单格通用模板)、SOURCE A(当前选中原图)、可选的 ALT B/ALT C(同一图位的备选原图)、EXPORT(真实成品，只对应 A)。
先只看每行的 A/B/C 三张候选，写下各自实际显示的鞋只数、主要视面和摆放类型，再看左侧模板比较差异，最后比较 A 与成品。
SOURCE的描述不能复制TEMPLATE描述或检查项。左列有鞋底不代表中列有鞋底；中列有鞋帮侧面不代表它是正侧视。不要跨行或跨列累加鞋只数。
模板只规定构图，鞋款、配色、材质、鞋帮高低不同不构成不合格。原图与成品必须保持同一商品、同一内容。
可以对照其他行理解同款鞋侧结构，但不能把其他行合格内容算到当前行。CONTEXT ONLY行是本色tmz3鞋侧参照，不返回审核结果。
yq3只借助CONTEXT辨认同一鞋侧：比较侧板缝线、拉链、魔术贴固定端、装饰所在侧。参照本身即使倾斜或姿势不合tmz3，也不影响清楚可见的鞋侧身份；不要把参照的姿势错误算给当前SOURCE。若参照看不到足够侧板特征，anchor_side_readable=null且same_outer_side_as_anchor=null，不能猜同侧或反侧。
鞋轴沿鞋底脚尖到脚跟，不沿高靴靴筒。双鞋不能冒充单鞋；鞋盒、标签特写、鞋垫不能冒充实物鞋。
tmz1要求两只完整鞋都落在同一条地面线上并排展示：后鞋抬起、抬跟倾斜、上下错开或与地面分离都不合格，必须改选其它候选或返回none。
tmz3允许单鞋倾斜或局部支撑，不要求90度直立或整条鞋底落地。原图像素中鞋头到鞋根的纵向跨度大于横向跨度即可称主要纵向；悬空禁止只用于明确要求双鞋落地的图位，不能套到单鞋竖侧图。
tmz2要求前鞋正常展示、后鞋露出完整外底；后鞋允许侧放、倾斜或靠在前鞋上，但它必须与地面或前鞋有明确接触。只有清楚看到上下分离、没有支撑的悬浮组合才判no_floating=false；后鞋接触点被遮挡、无法看清时为null。
鞋头近的前斜视和正侧面不能冒充鞋跟近的后斜视；外底触地花纹面和鞋底侧墙不同。
独立功能说明卡须展示功能/材质/参数/示意，固定在鞋上的IP饰物不是功能卡。小条码吊牌不是功能卡；yx必须实物鞋与功能卡同框。
均匀白灰底和局部触地阴影允许；摄影棚墙线、大片渐变、光斑不允许。标准源图允许正面/斜向、悬挂/平放不同。
导出允许正常缩放、白灰底转换、指定透明底与标签裁剪；不允许截断鞋、丢失内容、错换商品或明显损坏。
SOURCE可能已经去除大面积空白边缘，EXPORT保留实际画布，两列中的鞋子显示大小不同是正常现象。只因为EXPORT主体较小、留白较多或两列显示比例不同，不能判export_match=false。必须指出具体丢失部位、内容错换或损坏；需要检查像素尺寸时由程序核验，不从看板的显示大小猜测。
看不清关键细节就返回null并说明需要放大什么，不猜测，也不能为了凑齐而通过。
逐行返回JSON {"rows":[...]}; 每行字段：
row_id, chosen_source("A"|"B"|"C"|"D"|"E"|"none"，选出真正符合本图位要求的候选；只有 A 明确违反契约时才能改选其它列，A 合格就返回A，全部不合格返回none), candidate_observation(先描述被选中列实际可见内容), candidate_pose(下述互斥分类),
alt_observations(对象，{"B":"简述B实际可见内容","C":"..."}；没有该列就省略), template_observation(再描述左列可见内容),
template_shoe_count(整数), candidate_shoe_count(整数，鞋盒/鞋垫可为0),
source_checks(对象，覆盖该行全部required_checks，**一律针对 A 列**填写，每项true/false/null；包括no_开头，无悬空就no_floating=true，不是询问是否存在悬空),
chosen_checks(仅当 chosen_source 不是 A 时返回：对象，覆盖该行全部required_checks，表示被选中那一列是否满足),
不返回source_match总票，只逐条填写source_checks；模板是不同商品的通用构图，不能因鞋款不同另行否决。
export_match(true/false/null；chosen_source不是A时返回null，因为成品只对应A),
仅yq3额外返回anchor_side_readable(true/false/null)、anchor_side_observation(参照和SOURCE实际可比的具体侧板特征)，
candidate_facts(按下述规范，描述被选中的候选), reason(决定性差异或通过依据，必须说明为何放弃其它候选), repair_target(不合格时需要怎样的源图/加工修正)。
不要只返回整页通过。每一个指定row_id恰好一次；输出错误或缺行只会保留该行待复核。'''


POSE_OBSERVATION = '''candidate_pose只按被选中列选择一个实际拍摄类型，不按图位名称推断：
pair_grounded=两鞋正常并列落地、两只完整鞋的鞋底落在同一条地面线上；后鞋抬起、抬跟倾斜、上下错开或与地面分离属于pair_floating，不能算pair_grounded；
pair_front_sole=一鞋正常展示且另一鞋完整触地花纹面朝镜头；pair_floating=两鞋上下分离悬空；
当candidate_shoe_count=2时只选择上述pair分类；两鞋都为斜前方向且正常并列落地时仍选pair_grounded。front_oblique/side_horizontal等单鞋分类不能用作双鞋摆放类型。
side_upright=完整侧面为主体、鞋底脚尖到脚跟轴纵向；side_horizontal=完整侧面为主体、脚掌轴水平；
front_oblique=鞋头近处宽大，明显看见鞋头正面和鞋带/鞋面上表面；rear_oblique=鞋跟近、鞋头远的后侧；
top_opening=从上往下看鞋口、鞋舌/鞋面，鞋口呈明显开口椭圆；lining_detail=鞋口内里占主体的局部近景；
outsole_only=只有一只鞋的完整外底；shoe_with_card=实物鞋与独立功能卡同框；other；unclear。
悬空鞋的鞋底侧墙不是朝镜头的完整外底。靴筒向上或鞋头朝下不证明是side_upright；大量看到鞋口和鞋面应归top_opening/front_oblique。
横向伸展的斜前鞋仍是front_oblique；看到一部分鞋侧不等于side_horizontal。很小的透视变化允许，但清楚可见宽鞋头正面不能叫纯侧面。
分类与布尔检查必须分别据图判断；不一致时保留不一致，不能修改观察来迎合通过。'''


POSE_KINDS = {'pair_grounded', 'pair_front_sole', 'pair_floating', 'side_upright', 'side_horizontal',
              'front_oblique', 'rear_oblique', 'top_opening', 'lining_detail', 'outsole_only',
              'shoe_with_card', 'other', 'unclear'}
POSE_REQUIREMENTS = {'tmz1': {'pair_grounded'}, 'tmz2': {'pair_front_sole'},
                     'tmz3': {'side_upright'}, 'yq3': {'side_horizontal'}}


def review_routes(ctx, semantic):
    primary = getattr(ctx.get('model_state'), 'board_review_model_id', '')
    if primary and semantic in sequence.ORDER and semantic not in {'tmz5', 'wpz5'}:
        # A designated pose reviewer must not silently degrade to a weaker
        # fallback. Invalid output stays unknown for bounded later re-review.
        return [primary]
    return ctx.get('direct_review_routes', ctx['routes'])


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def side_reference_ready(response):
    return (isinstance(response, dict) and response.get('anchor_side_readable') is True
            and isinstance(response.get('anchor_side_observation'), str)
            and bool(response['anchor_side_observation'].strip()))


def font(size):
    for name in ('DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf', 'arial.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def render_board(items, path, *, detail=False):
    """No crop/rotation/mirroring: preserve the pose and complete export canvas.

    Rows may carry up to two alternates so the reviewer can compare A/B/C instead
    of only judging the single image the local shortlist already picked.
    """
    contexts = {}
    for item in items:
        if item.get('anchor'):
            contexts.setdefault(item['color'], item['anchor'])
    max_alternates = max((len(item.get('alternates') or []) for item in items), default=0)
    cell_width = 900 if detail else (460 if max_alternates > 2 else (560 if max_alternates else CELL_WIDTH))
    row_height = 850 if detail else ROW_HEIGHT
    margin, column_gap, row_gap = 16, 16, 24
    row_count = len(items) + len(contexts)
    columns = 2 + max_alternates + 1
    width = 2 * margin + columns * cell_width + (columns - 1) * column_gap
    height = 64 + row_height * row_count + row_gap * (row_count - 1) + margin
    board = Image.new('RGB', (width, height), 'white')
    draw = ImageDraw.Draw(board)
    draw.text((margin, 14), 'STYLE ' + str(items[0]['style']) + ' | TEMPLATE / ' +
              ' / '.join(['A'] + [chr(ord('B') + i) for i in range(max_alternates)] + ['EXPORT']),
              fill='#111827', font=font(25))

    def paint(index, paths, title, labels, address):
        y = 64 + index * (row_height + row_gap)
        draw.rectangle((margin, y, width - margin - 1, y + row_height - 1), fill='#111827')
        draw.text((margin + 12, y + 8), title, fill='white', font=font(22))
        for column, (image_path, label) in enumerate(zip(paths, labels)):
            x = margin + column * (cell_width + column_gap)
            draw.rectangle((x, y + 40, x + cell_width - 1, y + row_height - 1),
                           fill='white', outline='#111827', width=5)
            draw.rectangle((x + 5, y + 45, x + cell_width - 6, y + 78),
                           fill=('#fff0bc', '#dceafb', '#dcefe5', '#ece5fb', '#fde2e2', '#e2f0fb')[column % 6])
            draw.text((x + 12, y + 50), address + ' / ' + label, fill='#111827', font=font(18))
            if image_path is None:
                # The board font has no CJK glyphs; keep the placeholder ASCII so
                # the reviewer cannot misread it as a missing EXPORT column.
                draw.text((x + cell_width // 2 - 96, y + row_height // 2 - 12),
                          'NO ALTERNATE CANDIDATE', fill='#9aa3af', font=font(22))
                continue
            if image_path:
                with Image.open(image_path) as image:
                    image = ImageOps.exif_transpose(image).convert('RGBA')
                    image.thumbnail((cell_width - 20, row_height - 98), Image.Resampling.LANCZOS)
                    background = Image.new('RGBA', image.size, 'white')
                    background.alpha_composite(image)
                    board.paste(background.convert('RGB'), (x + (cell_width - image.width) // 2,
                                y + 86 + (row_height - 98 - image.height) // 2))
    for i, item in enumerate(items):
        alternates = list(item.get('alternates') or [])
        cells = [(item['template'], 'TEMPLATE'), (item['source_path'], 'A = SOURCE')]
        for label, _key, candidate_path in alternates:
            cells.append((candidate_path, label + ' = ALT'))
        # Pad only inside the page's own column count; the EXPORT cell must always
        # land on the canvas. Padding to a fixed 5 on a 3-column page used to draw
        # EXPORT outside the image, and reviewers reported a missing EXPORT column.
        alt_labels = ('B = ALT', 'C = ALT', 'D = ALT', 'E = ALT')
        while len(cells) < columns - 1:
            cells.append((None, alt_labels[min(len(cells) - 2, len(alt_labels) - 1)]))
        cells.append((item['export_path'], 'EXPORT (A)'))
        cells = cells[:columns]
        paint(i, [path for path, _label in cells], item['row_id'] + ' | COLOR ' + item['color'] + ' | ' + ','.join(item['slots']),
              [label for _path, label in cells], item['row_id'])
    for index, (color, anchor) in enumerate(contexts.items(), len(items)):
        paint(index, [anchor, anchor, anchor], 'CONTEXT ONLY | COLOR ' + color + ' | tmz3 side identity',
              ['SAME SOURCE', 'SAME SOURCE', 'SAME SOURCE'], 'CONTEXT ' + color)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    board.save(path, quality=94)
    return str(path)



def pixel_evidence_gap(semantic, item, response):
    """Program-side check of the pixel facts the reviewer reported.

    The decisive pose differences (正侧 vs 后斜, 纵向 vs 水平鞋轴, 后跟远近) are
    not separable by local silhouette geometry: calibrated 2026-09-16 on the real
    full13 sources, silhouette aspect and ground-line metrics of correct and wrong
    samples overlap completely. So the program does not re-derive the pose; it
    checks that an acceptance is actually backed by the pixel facts the reviewer
    reported (toe/heel coordinates, near_end, heel_back_visible, tread view) and
    that those facts do not contradict the verdict. A gap is routed to an enlarged
    re-review, never to acceptance and never to a silent rejection.
    """
    facts = response.get('candidate_facts')
    if not isinstance(facts, dict):
        return '缺少像素级候选事实'
    if semantic in {'tmz3', 'yq3'}:
        points = [facts.get('toe'), facts.get('heel')]
        if not all(isinstance(p, list) and len(p) == 2 and all(
                type(v) in (int, float) and 0 <= v <= 1 for v in p) for p in points):
            return '缺少鞋头鞋跟归一化像素坐标'
        size = item.get('source_size') or [1000, 1000]
        dx = abs(points[0][0] - points[1][0]) * size[0]
        dy = abs(points[0][1] - points[1][1]) * size[1]
        if (dx * dx + dy * dy) ** 0.5 < min(size) * 0.1:
            return '鞋头鞋跟像素坐标太近，不能确定脚掌轴线'
        if semantic == 'tmz3' and dy <= dx:
            return '像素坐标显示脚掌轴为水平方向，与纵向单鞋的接受结论矛盾'
        if semantic == 'yq3' and dx <= dy:
            return '像素坐标显示脚掌轴为纵向，与水平外侧正侧的接受结论矛盾'
    if semantic == 'tmz4' and item.get('category') != '雪地':
        if facts.get('near_end') != 'heel' or facts.get('heel_back_visible') is not True:
            return '像素事实未显示后跟靠近且可见后跟弧面'
        if facts.get('view') not in {'rear_oblique', 'rear', 'bottom'}:
            return '像素事实的视面不是后侧或侧后'
    if semantic == 'tmz4' and item.get('category') == '雪地':
        if facts.get('lining_visible') is not True or facts.get('upper_side_visible') is not True:
            return '像素事实未同时显示鞋口内里与鞋帮侧面'
    if semantic == 'yq2':
        if facts.get('view') != 'bottom' or facts.get('outsole_tread_visible') is not True:
            return '像素事实不是完整外底正朝镜头'
    return ''


def row_verdict(item, response):
    """Turn visible facts into status; malformed/unclear is never source-invalid.

    Returns (status, reason, choice) where choice is a candidate id when the
    reviewer picked an alternate column, '' when it rejected every candidate,
    and None when the verdict does not carry a choice.
    """
    from core.shenhui_shoe_packaging import ShoeSelectionError
    if not isinstance(response, dict):
        raise ShoeSelectionError('看板审核缺少本行')
    alternates = list(item.get('alternates') or [])
    choice = None
    missing_choice = ''
    selected_column = 'A'
    if alternates:
        raw_choice = response.get('chosen_source')
        if isinstance(raw_choice, str) and raw_choice.strip().lower() in {'a', 'b', 'c', 'd', 'e', 'none'}:
            selected_column = raw_choice.strip().upper()
        else:
            # An unanswered A/B/C field keeps the previous single-candidate
            # verdict for A instead of invalidating the page; the row still has
            # to pass every acceptance gate below.
            missing_choice = '；看板未说明 A/B/C 选择，按 A 继续核验'
    else:
        selected_column = 'A'
    for field in ('template_observation', 'candidate_observation', 'reason'):
        if not isinstance(response.get(field), str) or not response[field].strip():
            raise ShoeSelectionError('看板审核缺少独立观察或可见依据')
    if len(alternates) >= 2 and isinstance(response.get('alt_observations'), dict):
        for label, _key, _path in alternates:
            observed = (response['alt_observations'] or {}).get(label)
            if isinstance(observed, str) and not observed.strip():
                raise ShoeSelectionError('看板对该行备选图给出了空观察')
    if selected_column in {'B', 'C', 'D', 'E'}:
        index = ord(selected_column) - ord('B')
        if index >= len(alternates):
            raise ShoeSelectionError('看板选择了不存在的备选列')
        label, key, _path = alternates[index]
        # A preference alone must not swap an image: the audit showed the model's
        # ranking drifts on cases that are already correct. A swap is honoured
        # only when A visibly breaks the contract and the replacement satisfies it.
        required_checks = item.get('required_checks') or {}
        a_failures = [name for name, value in (response.get('source_checks') or {}).items()
                      if value is False and name in required_checks]
        chosen_checks = response.get('chosen_checks')
        chosen_ok = (isinstance(chosen_checks, dict)
                     and all(chosen_checks.get(name) is not False for name in required_checks))
        if not a_failures or not chosen_ok:
            return ('review_unknown',
                    str(response.get('reason') or '') + '；看板改选 ' + label + ' 但未给出 A 的契约失败依据，保留原图放大复核',
                    None)
        return ('source_invalid',
                str(response.get('reason') or '') + '；A 不满足：' + '、'.join(a_failures) + '，改选 ' + label + ' 候选',
                key)
    if selected_column == 'NONE':
        return ('source_invalid',
                str(response.get('reason') or '') + '；看板判定 A/B/C 三个候选均不符合本图位，需从完整素材重选',
                '')
    for field in ('export_match',):
        if field not in response or (response[field] is not None and type(response[field]) is not bool):
            raise ShoeSelectionError('看板审核结论格式错误')
    if 'source_match' in response and response['source_match'] is not None and type(response['source_match']) is not bool:
        raise ShoeSelectionError('看板审核结论格式错误')
    counts = [response.get('template_shoe_count'), response.get('candidate_shoe_count')]
    if any(type(n) is not int or n < 0 for n in counts):
        raise ShoeSelectionError('看板审核鞋只数缺失或无效')
    semantic = item['semantic']
    required = item['required_checks']
    checks = response.get('source_checks')
    if (not isinstance(checks, dict) or not set(required).issubset(checks)
            or any(checks[k] is not None and type(checks[k]) is not bool for k in required)):
        raise ShoeSelectionError('看板审核未逐项覆盖本行规则')
    checks = {key: checks[key] for key in required}
    # New responses use the explicit checklist. Preserve contradictory legacy
    # totals as unknown rather than retroactively turning old failures green.
    source_match = response.get('source_match', not any(v is False for v in checks.values()))
    expected = {'tmz1': 2, 'tmz2': 2, 'tmz3': 1}.get(semantic)
    if expected and counts[0] != expected:
        raise ShoeSelectionError('看板模板鞋数与图位定义矛盾，需要放大复核')
    reason = response['reason'] + missing_choice
    target = response.get('repair_target')
    if isinstance(target, str) and target.strip():
        reason += '；修复目标：' + target
    # A visible non-shoe is already a decisive rejection for a shoe pose.
    if counts[1] == 0 and semantic in sequence.ORDER:
        return 'source_invalid', reason, None
    if expected and counts[1] != expected:
        return 'source_invalid', reason + '；鞋只数不符合图位', None
    if semantic in {'tmz4', 'tmz5', 'yq3'} and counts[1] != 1:
        return 'source_invalid', reason + '；此图位只允许一只鞋或单只鞋的规定细节', None
    failed_checks = [key for key, value in checks.items() if value is False]
    # Hard landing veto for the pair slots: a floating or raised-rear pair is
    # never a grounded tmz1, and floating is never tmz2/yq1.
    pose = response.get('candidate_pose')
    if semantic in {'tmz1', 'tmz2', 'yq1'}:
        # An explicit floating classification is a hard veto for the pair slots.
        if pose == 'pair_floating':
            return 'source_invalid', reason + '；看板判定两只鞋上下分离悬空，本图位要求落地展示', None
        # A single contradicting checkbox is not enough on its own: a wrong
        # no_floating=false used to become a false rejection. It keeps the bounded
        # enlarged re-review, and the blind source review must also see floating
        # before the row is invalidated.
        if semantic == 'tmz1' and pose in POSE_KINDS and pose != 'unclear' and pose != 'pair_grounded':
            return 'review_unknown', reason + '；拍摄类型为' + str(pose) + '，未证明两只鞋落在同一地面线上，保留原图放大复核', None
    if semantic == 'yq3' and not side_reference_ready(response):
        return 'review_unknown', reason + '；鞋侧参照不可辨或缺少具体配对证据，不能判断同侧/反侧', None
    axis_check = {'tmz3': 'vertical_toe_heel_axis', 'yq3': 'horizontal_side_view'}.get(semantic)
    facts = response.get('candidate_facts')
    if (axis_check and failed_checks == [axis_check] and isinstance(facts, dict)
            and (semantic != 'yq3' or (facts.get('view') == 'side' and response.get('candidate_pose') == 'side_horizontal'))):
        points = [facts.get('toe'), facts.get('heel')]
        if all(isinstance(p, list) and len(p) == 2 and all(type(v) in (int, float) and 0 <= v <= 1 for v in p) for p in points):
            dx = abs(points[0][0] - points[1][0]) * item['source_size'][0]
            dy = abs(points[0][1] - points[1][1]) * item['source_size'][1]
            if (semantic == 'tmz3' and dy > dx) or (semantic == 'yq3' and dx > dy):
                return 'review_unknown', reason + '；鞋轴坐标与方向拒绝结论矛盾，保留原图放大复核', None
    if source_match is True and failed_checks:
        return 'review_unknown', reason + '；总判断与逐项判断矛盾，需核对：' + '；'.join(required[key] for key in failed_checks), None
    if source_match is False and not failed_checks:
        return 'review_unknown', reason + '；逐项规则未发现明确失败，总票却拒绝，保留原图放大复核', None
    if source_match is False or any(v is False for v in checks.values()):
        return 'source_invalid', reason + ('；不满足：' + '；'.join(required[key] for key in failed_checks) if failed_checks else ''), None
    if any(v is None for v in checks.values()):
        return 'review_unknown', reason, None
    if source_match is None:
        # The prompt asks for the checklist only, and a model that still returns an
        # explicit null total must not turn a complete all-true checklist into an
        # unknown (this produced false unknowns, e.g. 00399 yx on 2026-09-16).
        source_match = not any(v is False for v in checks.values())
    allowed_poses = POSE_REQUIREMENTS.get(semantic)
    if semantic == 'tmz4':
        allowed_poses = {'lining_detail'} if item['category'] == '雪地' else {'rear_oblique'}
    if allowed_poses:
        pose = response.get('candidate_pose')
        if pose not in POSE_KINDS or pose == 'unclear':
            return 'review_unknown', reason + '；缺少原图实际拍摄类型，需放大复核', None
        if pose not in allowed_poses:
            return 'review_unknown', reason + '；原图拍摄类型为' + pose + '，与全部通过的逐项规则矛盾，保留源图放大复核', None
    facts = response.get('candidate_facts')
    if semantic in sequence.ORDER:
        if not isinstance(facts, dict):
            raise ShoeSelectionError('看板审核缺少实际图像事实')
        if facts.get('background_kind') == 'unclear' or facts.get('view') == 'unclear':
            return 'review_unknown', reason, None
        needed = ['independent_cards']
        if semantic in {'tmz2', 'yq2'} or (semantic == 'tmz4' and item['category'] == '运动'):
            needed.extend(['outsole_tread_visible', 'upper_side_visible'])
        if semantic == 'tmz4':
            needed.extend(['lining_visible', 'upper_side_visible'] if item['category'] == '雪地' else ['heel_back_visible'])
            if item['category'] != '雪地' and facts.get('near_end') in (None, 'unclear'):
                return 'review_unknown', reason + '；后跟远近需放大复核', None
        if any(facts.get(k) is None for k in needed):
            return 'review_unknown', reason + '；缺少本图位决定性事实，需放大复核', None
        if semantic in {'tmz3', 'yq3'}:
            for name in ('toe', 'heel'):
                point = facts.get(name)
                if (not isinstance(point, list) or len(point) != 2
                        or any(type(v) not in (int, float) or not 0 <= v <= 1 for v in point)):
                    return 'review_unknown', reason + '；鞋轴坐标不完整，需放大复核', None
        if (any(type(facts.get(k)) is not bool for k in needed)
                or facts.get('background_kind') not in {'plain_white', 'plain_gray', 'studio_gradient', 'scene'}
                or facts.get('view') not in {'side', 'rear_oblique', 'rear', 'front_oblique', 'front', 'top', 'bottom'}):
            raise ShoeSelectionError('看板审核图像事实不完整')
        failures = direct.visual_fact_failures(semantic, facts, item['source_size'], item['category'], item['perimeter'])
        if (failures == ['鞋头鞋跟轴线方向不符'] and axis_check and checks.get(axis_check) is True
                and response.get('candidate_pose') in POSE_REQUIREMENTS.get(semantic, set())):
            return 'review_unknown', reason + '；拍摄类型和方向检查均通过，但鞋头鞋跟坐标方向相反，保留原图放大复核', None
        if failures:
            return 'source_invalid', reason + '；' + '；'.join(failures), None
    # Acceptance must be backed by the pixel facts the reviewer reported.
    evidence_gap = pixel_evidence_gap(semantic, item, response)
    if evidence_gap:
        return 'review_unknown', reason + '；' + evidence_gap + '，保留原图放大复核', None
    if item.get('export_identity_sha256'):
        # This proof comes from the actual original file, never the cropped
        # board preview. It resolves export identity only, after source checks.
        return 'accepted', reason + '；程序核验：成品与原始文件SHA256一致，未丢失或替换任何内容', None
    if response['export_match'] is None:
        return 'review_unknown', reason, None
    return ('accepted' if response['export_match'] else 'export_invalid'), reason, None


def audit_page(items, root, page_id):
    """One board request; only unanswered/unclear rows go to the next model."""
    root = Path(root)
    pending, results, errors, actual = list(items), {}, {}, set()
    ctx = items[0]['ctx']
    routes = ctx.get('board_page_routes') or review_routes(ctx, items[0]['semantic'])
    for attempt, model in enumerate(routes):
        if not pending or model in actual:
            continue
        if attempt > 0:
            # Recheck only unresolved rows, each on a genuinely larger board.
            for index, item in enumerate(pending):
                detail_ctx = {**item['ctx'], 'board_detail': True, 'routes': [model],
                    'direct_review_routes': [m for m in routes[attempt:] if m not in actual],
                    'board_page_routes': [m for m in routes[attempt:] if m not in actual]}
                results.update(audit_page([{**item, 'ctx': detail_ctx}], root, f'{page_id}-detail{index + 1}'))
            pending = []
            break
        gate = getattr(ctx.get('model_state'), 'image_work', None)
        with gate if gate is not None else nullcontext():
            board = render_board(pending, root / f'{page_id}-{attempt + 1}.jpg', detail=bool(ctx.get('board_detail')))
        manifest = [{k: row[k] for k in ('row_id', 'color', 'category', 'semantic', 'slots', 'required_checks')} for row in pending]
        prompt = (METHOD + '\n' + POSE_OBSERVATION + '\n' + direct.VISUAL_FACTS_PROMPT
                  + '\n款号：' + ctx['style'] + '\n逐行任务：' + json.dumps(manifest, ensure_ascii=False))
        request = {'prompt': prompt, 'images': [board], 'input_sha256': [digest(board)]}
        evidence_path = root / f'{page_id}-{attempt + 1}.json'
        evidence = {'version': VERSION, 'request': request, 'rows': manifest, 'requested_model': model}
        try:
            payload, route = fast._request({**ctx, 'pipeline_stage': 'export_review',
                'request_purpose': 'board_unclear_recheck' if ctx.get('board_detail') else 'board_review',
                'system_prompt': '你是独立商品图片审核员，按看板逐行观察并输出JSON。',
                'transport_fallback_routes': [m for m in routes[attempt + 1:] if m not in actual]},
                model, prompt, [board], '按款对照看板审核 ' + page_id)
            actual.add(route.model_id)
            evidence.update(response=payload, model=route.model_id)
            rows = payload.get('rows') if isinstance(payload, dict) else None
            if not isinstance(rows, list):
                rows = []
            next_pending = []
            for item in pending:
                matches = [r for r in rows if isinstance(r, dict) and r.get('row_id') == item['row_id']]
                response = matches[0] if len(matches) == 1 else None
                try:
                    status, reason, board_choice = row_verdict(item, response)
                except (ValueError, TypeError, KeyError) as exc:
                    status, reason, board_choice = 'review_unknown', str(exc), None
                result = {'status': status, 'accepted': status == 'accepted', 'reason': reason,
                          'response': response, 'model': route.model_id, 'request': request,
                          'evidence_path': str(evidence_path), 'board_choice': board_choice}
                results[item['row_id']] = result
                if status == 'review_unknown':
                    next_pending.append(item)
            pending = next_pending
        except Exception as exc:
            # Keep this page's completed rows. The coordinator never promotes
            # malformed output or network failure to a rejection of the source.
            from core import llm_gateway
            from core.shenhui_shoe_packaging import ShoeSelectionError
            if not isinstance(exc, (OSError, ValueError, ShoeSelectionError, llm_gateway.LlmGatewayError)):
                raise
            evidence['error'] = str(exc)
            for item in pending:
                errors[item['row_id']] = str(exc)
        evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
    for item in pending:
        results[item['row_id']] = {**results.get(item['row_id'], {}), 'status': 'review_unknown', 'accepted': False,
            'reason': results.get(item['row_id'], {}).get('reason') or errors.get(item['row_id'], '审核尚无有效逐行结论')}
    return source_review.guard_accepted(items, results, root)


def review_style(color_inputs):
    """Group every color of one style, then review 4-row pages concurrently."""
    from core import shenhui_shoe_final_review as final, shenhui_shoe_packaging as shoe
    outputs, items, original_hashes = {}, [], {}
    for color, (selection, rows) in color_inputs.items():
        ctx, root, rejected, records, groups = final.prepare_export_records(selection, rows)
        outputs[color] = (rejected, records)
        for (semantic, original), members in groups.items():
            local = {**ctx, 'root': str(root / semantic)}
            Path(local['root']).mkdir(exist_ok=True)
            source = ctx['previews'].get(original) or ctx.get('export_source_paths', {})[original]
            raw_source = ctx.get('export_source_paths', {}).get(original)
            raw_hash = ''
            if raw_source and Path(raw_source).is_file():
                if raw_source not in original_hashes:
                    original_hashes[raw_source] = digest(raw_source)
                raw_hash = original_hashes[raw_source]
            template = direct.reference(local, semantic) if semantic in sequence.ORDER else source
            anchor_name = shoe._consensus_slot_value(selection, 'tmz3')
            anchor = ctx['previews'].get(anchor_name) if semantic == 'yq3' else None
            # Up to two alternates from the same slot's local shortlist, so the
            # reviewer can compare A/B/C instead of only judging the one image the
            # geometric shortlist already picked. 'none' stays available and
            # triggers a full-pool retrieval.
            alternates = []
            if SHOE_BOARD_ALTERNATES and semantic in sequence.ORDER:
                ranked = (ctx.get('mask_plan') or {}).get('by_slot', {}).get(semantic, {}).get('ranked', [])
                pool = []
                for row in ranked:
                    key = row['candidate_id']
                    name = ctx['ids'].get(key)
                    candidate_path = ctx['previews'].get(name)
                    if (not name or not candidate_path or not row.get('mask_valid')
                            or name == ctx.get('verified_label_filename')):
                        continue
                    pool.append({'key': key, 'name': name, 'path': str(candidate_path)})
                if pool:
                    # The audit showed the mask top-3 are often near-duplicates of the
                    # wrong pick, so a comparison board without a pose-diverse set has
                    # nothing better to offer. Offer the best mask match first, then
                    # greedily add the candidates that differ most from everything
                    # already on the row (farthest-first by silhouette similarity).
                    from core.shenhui_shoe_mask_rank import MaskIndex, similarity
                    index = MaskIndex()
                    chosen: list[dict] = []
                    for candidate in pool:
                        if candidate['name'] != original:
                            chosen.append(candidate)
                            break
                    best_match = next((c for c in pool if c['name'] != original), None)
                    if best_match is not None and not chosen:
                        chosen.append(best_match)
                    current_reference = ctx['previews'].get(original)
                    labels = ('B', 'C', 'D', 'E')
                    while len(chosen) < len(labels):
                        pick, pick_value = None, None
                        for candidate in pool:
                            if candidate['name'] == original or candidate in chosen:
                                continue
                            feature = index.get(candidate['path'])
                            distances = [similarity(index.get(other['path']), feature,
                                                    allow_mirror=False)['score'] for other in chosen]
                            if current_reference:
                                distances.append(similarity(index.get(current_reference), feature,
                                                            allow_mirror=False)['score'])
                            value = max(distances) if distances else 1.0
                            if pick_value is None or value < pick_value:
                                pick, pick_value = candidate, value
                        if pick is None:
                            break
                        chosen.append(pick)
                    alternates = [(labels[i], c['key'], c['path']) for i, c in enumerate(chosen)]
            unique = {}
            for member in members:
                unique.setdefault(member['sha256'], []).append(member)
            for export_hash, aliases in unique.items():
                with Image.open(source) as image:
                    source_size = image.size
                if semantic in sequence.ORDER:
                    required = sequence.contract(semantic, ctx['category'], bool(ctx.get('gray_standard')) if semantic == 'tmz5' else False)
                elif semantic in {'wpz6', 'tmq'}:
                    required = {'label_source': '原图须为标签/鞋盒图；模板列此时是已核验标签原图，允许成品仅裁出标签，不能套用实物鞋姿势规则'}
                else:
                    required = {'source_reference': '此行是辅助素材/渠道派生图，模板列是同一原图，只核验成品内容对应，不套用主图姿势规则；透明底和缩放允许'}
                item = {'ctx': ctx, 'selection': selection, 'style': ctx['style'], 'color': color,
                        'category': ctx['category'], 'semantic': semantic, 'template': template, 'source_path': source,
                        'source_id': next((k for k, v in ctx['ids'].items() if v == original), 'AUX-' + digest(source)[:10]),
                        'original': original, 'export_path': aliases[0]['path'], 'anchor': anchor,
                        'export_identity_sha256': raw_hash if raw_hash == export_hash else '',
                        'source_review_revision': ctx.get('source_review_revisions', {}).get(original, 0),
                        'slots': [r['slot'] for r in aliases], 'members': aliases, 'required_checks': required,
                        'source_size': source_size, 'perimeter': direct.background_perimeter_evidence(source),
                        'alternates': alternates}
                key_data = [VERSION, color, semantic, digest(template), digest(source), raw_hash, export_hash,
                            item['source_review_revision'],
                            [(label, digest(path)) for label, _key, path in alternates],
                            digest(anchor) if anchor else '', required, review_routes(ctx, semantic),
                            METHOD, POSE_OBSERVATION, direct.VISUAL_FACTS_PROMPT,
                            source_review.VERSION, source_review.PROMPT, ctx.get('direct_review_routes', ctx['routes'])]
                key = hashlib.sha256(json.dumps(key_data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
                item.update(key=key, row_id=color + '-' + semantic + '-' + key[:10])
                if semantic == 'yq3' and not anchor:
                    item['verdict'] = {'status': 'review_unknown', 'accepted': False, 'reason': '缺少同款色tmz3鞋侧参照'}
                elif key in selection.get('_board_review_cache', {}):
                    item['verdict'] = {**selection['_board_review_cache'][key], 'reused_unchanged_inputs': True}
                items.append(item)
    if not items:
        return outputs
    root = Path(items[0]['ctx']['root']).parent / 'style-review-boards'
    root.mkdir(exist_ok=True)
    todo = [item for item in items if 'verdict' not in item]
    by_route = {}
    for item in todo:
        routes = review_routes(item['ctx'], item['semantic'])
        detail = item['selection'].get('_board_review_attempts', {}).get(item['key'], 0) > 0
        item['ctx'] = {**item['ctx'], 'board_page_routes': routes, 'board_detail': detail}
        by_route.setdefault((tuple(routes), detail), []).append(item)
    pages = []
    for (_, detail), rows in by_route.items():
        size = 1 if detail else PAGE_ROWS
        pages.extend(rows[i:i + size] for i in range(0, len(rows), size))

    def work(page):
        page_id = hashlib.sha256('|'.join(r['key'] for r in page).encode()).hexdigest()[:16]
        # Distinguish repeated unknown reviews without overwriting evidence.
        attempt = max(r['selection'].get('_board_review_attempts', {}).get(r['key'], 0) for r in page) + 1
        return page, audit_page(page, root, f'{page_id}-r{attempt}')

    while pages:
        retry_pages = []
        with ThreadPoolExecutor(max_workers=min(8, len(pages))) as executor:
            for page, results in executor.map(work, pages):
                for item in page:
                    verdict = results[item['row_id']]
                    if (item['semantic'] == 'yq3' and verdict['status'] in {'accepted', 'source_invalid'}
                            and not side_reference_ready(verdict.get('response'))):
                        verdict = {**verdict, 'status': 'review_unknown', 'accepted': False,
                                   'reason': '鞋侧参照不可辨或缺少具体配对证据，保留原图放大复核'}
                    item['verdict'] = verdict
                    selection = item['selection']
                    attempts = selection.setdefault('_board_review_attempts', {})
                    attempts[item['key']] = attempts.get(item['key'], 0) + 1
                    if verdict['status'] not in {'review_unknown', 'export_invalid'} or attempts[item['key']] >= MAX_UNKNOWN_ATTEMPTS:
                        selection.setdefault('_board_review_cache', {})[item['key']] = verdict
                    else:
                        # The last repair round may introduce a new image.
                        # Finish its own bounded detail review here; a global
                        # repair-round budget is not a per-image review budget.
                        item['ctx'] = {**item['ctx'], 'board_detail': True}
                        retry_pages.append([item])
        pages = retry_pages
    # Contradictory source decisions from different exports cannot approve a
    # sibling. Preserve the source on dispute and keep the retry budget bounded.
    source_groups = {}
    for item in items:
        source_groups.setdefault((item['color'], item['semantic'], item['source_path']), []).append(item)
    for siblings in source_groups.values():
        states = {r['verdict']['status'] for r in siblings}
        if 'source_invalid' in states and states & {'accepted', 'export_invalid'}:
            for item in siblings:
                verdict = {**item['verdict'], 'status': 'review_unknown', 'accepted': False,
                           'reason': '同一源图不同成品行的源图结论冲突，保留候选待放大复核'}
                item['verdict'] = verdict
                selection = item['selection']
                cache = selection.setdefault('_board_review_cache', {})
                if selection.get('_board_review_attempts', {}).get(item['key'], 0) >= MAX_UNKNOWN_ATTEMPTS:
                    cache[item['key']] = verdict
                else:
                    cache.pop(item['key'], None)
    for item in items:
        verdict = item['verdict']
        semantic = item['semantic']
        checked = {'slot': semantic, 'candidate_id': item['source_id'], 'accepted': verdict['accepted'],
                   'status': verdict['status'], 'evidence': verdict['reason'], 'model': verdict.get('model', ''),
                   'comparison': 'style_comparison_board', 'template_source': item['template'],
                   'comparison_image': (verdict.get('request', {}).get('images') or [''])[0],
                   'response': verdict.get('response'), 'request': verdict.get('request'), 'row_id': item['row_id'],
                   'board_choice': verdict.get('board_choice')}
        checked['source_observation'] = verdict.get('source_observation')
        checked['export_identity_sha256'] = item['export_identity_sha256']
        audit = {'approved': [semantic] if verdict['accepted'] else [],
                 'rejected': {} if verdict['accepted'] else {semantic: verdict['reason']},
                 'outcomes': {semantic: verdict['status']}, 'response': {'reviews': [checked]},
                 'comparison': 'style_comparison_board', 'model': verdict.get('model', '')}
        for member in item['members']:
            member.update(status=verdict['status'], accepted=verdict['accepted'], reason=verdict['reason'],
                          review=audit, board_row_id=item['row_id'], reused_unchanged_inputs=verdict.get('reused_unchanged_inputs', False),
                          board_choice=verdict.get('board_choice'))
            if not member['accepted']:
                outputs[item['color']][0][semantic] = member['reason']
    for color, (selection, _) in color_inputs.items():
        records = outputs[color][1]
        path = Path(selection['_sequential_context']['root']) / 'export-review' / 'results.json'
        path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
    (root / 'latest-index.json').write_text(json.dumps([{k: item.get(k) for k in (
        'row_id', 'key', 'style', 'color', 'semantic', 'slots', 'template', 'source_path', 'export_path',
        'export_identity_sha256', 'source_review_revision', 'anchor', 'verdict')}
        for item in items], ensure_ascii=False, indent=2), encoding='utf-8')
    return outputs
