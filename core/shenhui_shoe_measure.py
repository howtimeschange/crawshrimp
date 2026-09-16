"""Measurement-first pose matching (prototype, additive to the board pipeline).

Idea: the audit showed both reviewers *judge* fine pose classes unreliably
(双鞋并排落地 vs 后鞋抬跟, 正侧 vs 后斜, 纵向 vs 水平鞋轴) while neither local
silhouette geometry nor aspect ratios separate the truth. What models do well is
locate things. So this method asks the model only to measure pixels - shoe
boxes, sole bottom lines, toe/heel points, which face is visible - and lets this
module decide with explicit arithmetic.

Nothing here approves an image on a model verdict: every decision comes from a
numeric comparison in `decide`, so the thresholds can be calibrated on the
human-audited gold set and re-checked offline.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from typing import Any

VERSION = "shoe-measure-v1"

PROMPT = '''你是商品图片测量员。只测量，不判断合格与否，不给建议。返回 JSON。
坐标一律用 0~1 的归一化值，[0,0] 是左上角，[1,1] 是右下角；不要输出像素绝对值。
对图片里每一只可辨认的鞋各给一条记录，按从前景（离镜头近）到背景排序：
{"shoes":[{"index":1,
  "bbox":[x1,y1,x2,y2],
  "sole_bottom_y": 该鞋鞋底/鞋跟与地面接触处最低点的 y,
  "toe":[x,y], "heel":[x,y],
  "axis_dx_up": "toe_to_heel_dx", "axis_dy_up": "toe_to_heel_dy",
  "complete": true/false,
  "outsole_tread_visible": 是否看见触地花纹面,
  "outsole_face_toward_camera": 该花纹面是否基本正对镜头,
  "outsole_face_ratio": 花纹面占该鞋鞋底可见面积的比例 0~1,
  "side_shown": "outer"|"inner"|"both"|"unclear",
  "near_end": "toe"|"heel"|"neither"|"unclear"}],
 "background_kind": "plain_white"|"plain_gray"|"studio_gradient"|"scene"|"unclear",
 "ground_shadow_bottom_y": 地面接触阴影的最低点 y，没有阴影给 null,
 "independent_cards": 独立功能说明卡数量(整数),
 "image_notes": "一句话描述拍摄构图"}
注意：sole_bottom_y 是这只鞋自身的最低点，用于比较两只鞋是否落在同一条地面线上；
两只鞋悬空或一只抬起时，两只鞋的 sole_bottom_y 会明显不同。axis 用脚尖点与鞋跟点的差值表示，
高靴的靴筒方向不算鞋轴。看不清的字段给 null，不要猜测。'''


@dataclass
class ShoeMeasurement:
    index: int = 0
    bbox: tuple[float, float, float, float] | None = None
    sole_bottom_y: float | None = None
    toe: tuple[float, float] | None = None
    heel: tuple[float, float] | None = None
    complete: bool | None = None
    outsole_tread_visible: bool | None = None
    outsole_face_toward_camera: bool | None = None
    outsole_face_ratio: float | None = None
    side_shown: str = ""
    near_end: str = ""

    @property
    def height(self) -> float:
        if not self.bbox:
            return 0.0
        return max(0.0, self.bbox[3] - self.bbox[1])

    @property
    def axis(self) -> tuple[float, float] | None:
        if not self.toe or not self.heel:
            return None
        return (self.heel[0] - self.toe[0], self.heel[1] - self.toe[1])


@dataclass
class SceneMeasurement:
    shoes: list[ShoeMeasurement] = field(default_factory=list)
    background_kind: str = ""
    ground_shadow_bottom_y: float | None = None
    independent_cards: int | None = None
    notes: str = ""


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    if isinstance(value, str):
        match = re.fullmatch(r"\s*(-?\d+(?:\.\d+)?)\s*%?\s*", value)
        if match:
            number = float(match.group(1))
            return number / 100 if value.strip().endswith("%") else number
    return None


def _point(value: Any) -> tuple[float, float] | None:
    if isinstance(value, (list, tuple)) and len(value) == 2:
        x, y = _num(value[0]), _num(value[1])
        if x is not None and y is not None and 0 <= x <= 1 and 0 <= y <= 1:
            return (x, y)
    return None


def _bbox(value: Any) -> tuple[float, float, float, float] | None:
    if isinstance(value, (list, tuple)) and len(value) == 4:
        parts = [_num(v) for v in value]
        if all(v is not None for v in parts):
            x1, y1, x2, y2 = parts
            if x2 >= x1 and y2 >= y1:
                return (x1, y1, x2, y2)
    return None


def parse(payload: Any) -> SceneMeasurement:
    """Fail closed: a missing measurement stays None and is never guessed."""
    if not isinstance(payload, dict):
        raise ValueError("测量返回不是 JSON 对象")
    rows = payload.get("shoes")
    if not isinstance(rows, list):
        raise ValueError("测量返回缺少 shoes 列表")
    shoes = []
    for position, row in enumerate(rows[:4], start=1):
        if not isinstance(row, dict):
            continue
        shoes.append(ShoeMeasurement(
            index=int(_num(row.get("index")) or position),
            bbox=_bbox(row.get("bbox")),
            sole_bottom_y=_num(row.get("sole_bottom_y")),
            toe=_point(row.get("toe")),
            heel=_point(row.get("heel")),
            complete=row.get("complete") if type(row.get("complete")) is bool else None,
            outsole_tread_visible=row.get("outsole_tread_visible") if type(row.get("outsole_tread_visible")) is bool else None,
            outsole_face_toward_camera=row.get("outsole_face_toward_camera") if type(row.get("outsole_face_toward_camera")) is bool else None,
            outsole_face_ratio=_num(row.get("outsole_face_ratio")),
            side_shown=str(row.get("side_shown") or ""),
            near_end=str(row.get("near_end") or ""),
        ))
    cards = payload.get("independent_cards")
    return SceneMeasurement(
        shoes=shoes,
        background_kind=str(payload.get("background_kind") or ""),
        ground_shadow_bottom_y=_num(payload.get("ground_shadow_bottom_y")),
        independent_cards=int(cards) if type(cards) is int else None,
        notes=str(payload.get("image_notes") or "")[:200],
    )


# Calibrated on the human-audited gold set (see calibrate_measure.py output).
DEFAULTS = {
    "pair_bottom_gap": 0.22,      # |b1-b2| / 鞋高 上限，超过判为一只鞋抬起
    "axis_vertical": 1.15,        # |dy|/|dx| 下限，纵向鞋轴
    "axis_horizontal": 1.05,      # |dx|/|dy| 下限，水平鞋轴
    "axis_min_span": 0.12,        # 鞋轴归一化长度下限，太短视为不可测
    "outsole_ratio_full": 0.5,    # 完整外底朝向镜头的花纹面比例下限
    "side_target": "outer",
}


def _pair_bottom_gap(shoe_a: ShoeMeasurement, shoe_b: ShoeMeasurement) -> float | None:
    if shoe_a.sole_bottom_y is None or shoe_b.sole_bottom_y is None:
        return None
    scale = max(shoe_a.height, shoe_b.height, 1e-6)
    return abs(shoe_a.sole_bottom_y - shoe_b.sole_bottom_y) / scale


def _axis_metrics(shoe: ShoeMeasurement) -> tuple[float, float] | None:
    axis = shoe.axis
    if axis is None:
        return None
    dx, dy = abs(axis[0]), abs(axis[1])
    span = math.hypot(dx, dy)
    if span <= 0:
        return None
    return (dy / max(dx, 1e-6), span)


def decide(semantic: str, scene: SceneMeasurement, *, category: str = "",
           thresholds: dict | None = None) -> tuple[bool, str, dict]:
    """Approve a candidate only when the measured numbers satisfy the contract."""
    t = {**DEFAULTS, **(thresholds or {})}
    facts: dict[str, Any] = {}
    shoes = scene.shoes
    if not shoes:
        return False, "未测得任何鞋只", facts

    if semantic == "tmz1":
        if len(shoes) < 2:
            return False, "只测得 %d 只鞋，tmz1 需要两只" % len(shoes), facts
        gap = _pair_bottom_gap(shoes[0], shoes[1])
        facts["pair_bottom_gap"] = gap
        if gap is None:
            return False, "两只鞋的落地点无法测量", facts
        if gap > t["pair_bottom_gap"]:
            return False, "两只鞋底沿相差 %.0f%% 鞋高，非并排落地" % (gap * 100), facts
        if any(s.complete is False for s in shoes[:2]):
            return False, "存在不完整的鞋", facts
        return True, "两只鞋底沿相差 %.0f%% 鞋高，符合并排落地" % (gap * 100), facts

    if semantic in {"tmz2", "yq1"}:
        if len(shoes) < 2:
            return False, "只测得 %d 只鞋，tmz2 需要两只" % len(shoes), facts
        rear = [s for s in shoes if s.outsole_face_toward_camera]
        front = [s for s in shoes if not s.outsole_face_toward_camera]
        facts["rear_sole_facing"] = len(rear)
        if not rear or not front:
            return False, "没有测得一只鞋完整外底朝镜头", facts
        ratio = rear[0].outsole_face_ratio
        facts["outsole_face_ratio"] = ratio
        if ratio is None or ratio < t["outsole_ratio_full"]:
            return False, "外底朝向镜头的花纹面不足（比例 %s）" % ratio, facts
        gap = _pair_bottom_gap(shoes[0], shoes[1])
        facts["pair_bottom_gap"] = gap
        if gap is not None and gap > 1.0:
            return False, "两只鞋完全分离，未形成前鞋+后鞋底组合", facts
        return True, "测得前鞋正常展示、后鞋外底朝向镜头", facts

    if semantic == "tmz3":
        shoe = shoes[0]
        metrics = _axis_metrics(shoe)
        facts["axis"] = metrics
        if metrics is None or metrics[1] < t["axis_min_span"]:
            return False, "鞋轴不可测（脚尖/鞋跟点缺失）", facts
        if metrics[0] < t["axis_vertical"]:
            return False, "鞋轴 dy/dx=%.2f，不是纵向" % metrics[0], facts
        if shoe.side_shown == "inner":
            return False, "测得展示的是内侧", facts
        if shoe.complete is False:
            return False, "鞋不完整", facts
        return True, "鞋轴 dy/dx=%.2f 纵向，展示%s侧" % (metrics[0], shoe.side_shown or "外"), facts

    if semantic == "tmz4":
        shoe = shoes[0]
        facts["near_end"] = shoe.near_end
        facts["side_shown"] = shoe.side_shown
        if category == "雪地":
            return False, "雪地图位需要鞋口内里近景，测量法不裁决该图位", facts
        if shoe.near_end != "heel":
            return False, "测得靠镜头的是%s端，不是后跟" % (shoe.near_end or "未知"), facts
        if shoe.complete is False:
            return False, "鞋不完整", facts
        return True, "脚后跟靠近镜头，符合后斜视", facts

    if semantic == "yq2":
        shoe = shoes[0]
        ratio = shoe.outsole_face_ratio
        facts["outsole_face_ratio"] = ratio
        if shoe.outsole_tread_visible is not True or shoe.outsole_face_toward_camera is not True:
            return False, "没有看到朝向镜头的完整外底花纹面", facts
        if ratio is None or ratio < t["outsole_ratio_full"]:
            return False, "外底花纹面比例不足（%s）" % ratio, facts
        return True, "完整外底正对镜头", facts

    if semantic == "yq3":
        shoe = shoes[0]
        metrics = _axis_metrics(shoe)
        facts["axis"] = metrics
        if metrics is None or metrics[1] < t["axis_min_span"]:
            return False, "鞋轴不可测（脚尖/鞋跟点缺失）", facts
        if metrics[0] > 1.0 / t["axis_horizontal"]:
            return False, "鞋轴 dy/dx=%.2f，不是水平侧视" % metrics[0], facts
        if shoe.side_shown != t["side_target"]:
            return False, "测得展示的是%s，不是外侧" % (shoe.side_shown or "未知"), facts
        if shoe.outsole_tread_visible is True and (shoe.outsole_face_ratio or 0) > 0.5:
            return False, "鞋底花纹面占比过高，是露底角度而非水平正侧", facts
        return True, "水平正侧且展示外侧", facts

    return False, "测量法未覆盖的图位：%s" % semantic, facts


def measurement_prompt(semantic: str, category: str) -> str:
    return (PROMPT + "\n本次只需测量，不要判断图位是否合格。\n"
            + f"款号品类：{category or '未知'}；目标图位：{semantic}\n"
            + '只返回 JSON，不要返回 Markdown。')


def parse_and_decide(payload: Any, semantic: str, *, category: str = "",
                     thresholds: dict | None = None) -> tuple[bool, str, dict]:
    return decide(semantic, parse(payload), category=category, thresholds=thresholds)


__all__ = ["VERSION", "PROMPT", "ShoeMeasurement", "SceneMeasurement", "parse", "decide",
           "measurement_prompt", "parse_and_decide", "DEFAULTS"]
