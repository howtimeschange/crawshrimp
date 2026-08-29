from __future__ import annotations

from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import hashlib
import re
import uuid
from statistics import median
from typing import Callable, Iterable, Mapping, Sequence

from PIL import Image, ImageChops, ImageOps

from core import llm_gateway
from core import ocr_service
from core.config import load_config


YQ_HANG_TAG = "hang_tag"
YQ_WASH_LABEL = "wash_label"
VALID_YQ_ROLES = frozenset({YQ_HANG_TAG, YQ_WASH_LABEL})

LABEL_WASTE_MARKERS = (
    "无吊牌",
    "无吊卡",
    "无挂牌",
    "无合格证",
    "无水洗",
    "无洗唛",
    "无洗标",
    "无洗水",
    "废图",
    "作废",
    "无效",
)
_NEGATIVE_LABEL_PATTERN = re.compile(
    r"没有(?:吊牌|吊卡|挂牌|合格证|水洗|洗唛|洗标|洗水)"
)
_YQ_ROLE_PATTERN = re.compile(
    r"(?<![a-z0-9])yq(?:\(?([12])\)?|([一二]))(?![a-z0-9])",
    re.IGNORECASE,
)
_STYLE_COLOR_PATTERN_TEMPLATE = r"{style}[-_](\d{{5}})(?!\d)"
_PRIMARY_SIZE_PATTERN = re.compile(r"(?<!\d)(\d{2,3})(?:\s*/\s*\d{1,3})?(?!\s*[-–—]\s*\d)(?!\d)")


@dataclass(frozen=True)
class LabelCandidate:
    kind: str
    style_code: str
    color_code: str
    sizes: tuple[str, ...]
    bbox: tuple[float, float, float, float]
    confidence: float
    printed_label: bool
    handwritten_placeholder: bool
    negative_text: str
    source_path: Path
    page_index: int
    model_id: str


@dataclass(frozen=True)
class ReviewJob:
    job_id: str
    image_path: Path
    expected_style_code: str
    expected_role: str = ""
    page_index: int = -1
    source_path: Path | None = None


@dataclass(frozen=True)
class ExistingYqDecision:
    accepted: bool
    role: str
    style_code: str
    color_code: str
    reason: str
    model_ids: tuple[str, ...] = ()


@dataclass
class ExistingYqRenamePlan:
    row: dict
    source: Path
    style_code: str
    decision: ExistingYqDecision
    target: Path
    current: Path


@dataclass(frozen=True)
class RenderedPage:
    page_index: int
    image_path: Path
    width: int
    height: int


@dataclass(frozen=True)
class CropVerification:
    accepted: bool
    reason: str
    ocr_text: str = ""


@dataclass(frozen=True)
class ApparelLabelProcessingResult:
    generated_count: int
    accepted_existing: tuple[Path, ...]
    rejected_paths: tuple[Path, ...]
    missing_roles: tuple[str, ...]
    audit_rows: tuple[dict, ...]


def _compact(value: object) -> str:
    return str(value or "").strip()


def detect_yq_role(filename: str) -> str:
    stem = Path(_compact(filename)).stem.lower()
    stem = stem.replace("（", "(").replace("）", ")")
    stem = re.sub(r"\s+", "", stem)
    match = _YQ_ROLE_PATTERN.search(stem)
    if not match:
        return ""
    marker = match.group(1) or match.group(2)
    return YQ_HANG_TAG if marker in {"1", "一"} else YQ_WASH_LABEL


def _is_exact_yq_filename(filename: str, role: str) -> bool:
    stem = Path(_compact(filename)).stem.lower()
    stem = stem.replace("（", "(").replace("）", ")")
    stem = re.sub(r"\s+", "", stem)
    marker = "1" if role == YQ_HANG_TAG else "2"
    return bool(re.fullmatch(rf"yq(?:{marker}|\({marker}\))(?:-\d+)?", stem))


def extract_scope(
    style_code: str,
    row: Mapping[str, object],
    filename: str,
) -> tuple[str, str]:
    style = _compact(style_code)
    explicit = _compact(row.get("__style_color_code"))
    for value in (explicit, filename):
        match = re.search(
            _STYLE_COLOR_PATTERN_TEMPLATE.format(style=re.escape(style)),
            value,
        )
        if match:
            return style, match.group(1)
    return style, ""


def _primary_size(value: object) -> int | None:
    text = _compact(value)
    if not text or re.search(r"\d\s*[-–—]\s*\d", text):
        return None
    match = _PRIMARY_SIZE_PATTERN.search(text)
    if not match:
        return None
    size = int(match.group(1))
    return size if 50 <= size <= 250 else None


def preferred_size(sizes: Iterable[object]) -> int | None:
    values = sorted({size for value in sizes if (size := _primary_size(value)) is not None})
    if not values:
        return None
    if 110 in values:
        return 110
    greater = [value for value in values if value > 110]
    if greater:
        return min(greater)
    return max(values)


def is_waste_path(value: str) -> bool:
    text = _compact(value)
    return any(marker in text for marker in LABEL_WASTE_MARKERS) or bool(
        _NEGATIVE_LABEL_PATTERN.search(text)
    )


def _negative_label_semantic(value: object) -> str:
    return "waste" if is_waste_path(_compact(value)) else ""


def candidate_rejection_reason(candidate: LabelCandidate, expected_style_code: str) -> str:
    if candidate.kind not in VALID_YQ_ROLES:
        return "未识别为吊牌或洗唛"
    if not candidate.printed_label:
        return "无法证明为真实印刷标签"
    if candidate.handwritten_placeholder:
        return "手写纸占位图"
    if _negative_label_semantic(candidate.negative_text):
        return "图片包含无吊牌/无水洗等否定信息"
    expected_style = _compact(expected_style_code)
    if expected_style and _compact(candidate.style_code) != expected_style:
        return f"识别款号与当前款号不一致：{candidate.style_code or '空'}"
    return ""


def _bbox_is_valid(value: Sequence[float]) -> bool:
    if len(value) != 4:
        return False
    try:
        x1, y1, x2, y2 = (float(item) for item in value)
    except (TypeError, ValueError):
        return False
    return (
        0.0 <= x1 < x2 <= 1.0
        and 0.0 <= y1 < y2 <= 1.0
        and (x2 - x1) >= 0.02
        and (y2 - y1) >= 0.02
        and (x2 - x1) * (y2 - y1) >= 0.005
    )


def _normalized_bbox(value: object) -> tuple[float, float, float, float]:
    items = list(value) if isinstance(value, (list, tuple)) else []
    try:
        bbox = tuple(float(item) for item in items)
    except (TypeError, ValueError):
        bbox = ()
    if not _bbox_is_valid(bbox):
        return (0.0, 0.0, 0.0, 0.0)
    return bbox  # type: ignore[return-value]


def _candidate_from_payload(
    payload: Mapping[str, object],
    *,
    job: ReviewJob,
    model_id: str,
) -> LabelCandidate:
    raw_sizes = payload.get("sizes")
    if isinstance(raw_sizes, (list, tuple)):
        sizes = tuple(_compact(value) for value in raw_sizes if _compact(value))
    else:
        sizes = (_compact(raw_sizes),) if _compact(raw_sizes) else ()
    negative_text = _compact(payload.get("negative_text") or payload.get("waste_reason"))
    return LabelCandidate(
        kind=_compact(payload.get("kind")).lower(),
        style_code=_compact(payload.get("style_code")),
        color_code=_compact(payload.get("color_code")),
        sizes=sizes,
        bbox=_normalized_bbox(payload.get("bbox")),
        confidence=float(payload.get("confidence") or 0.0),
        printed_label=bool(payload.get("printed_label")),
        handwritten_placeholder=bool(payload.get("handwritten_placeholder")),
        negative_text=negative_text,
        source_path=job.source_path or job.image_path,
        page_index=job.page_index,
        model_id=model_id,
    )


def _review_prompt(job: ReviewJob) -> str:
    role_rule = (
        f"目标文件名提示角色为 {job.expected_role}，但必须按图片内容独立判断。"
        if job.expected_role
        else "请独立判断每个候选是吊牌、洗唛还是非标签。"
    )
    return f"""当前款号：{job.expected_style_code}
{role_rule}
识别图片内每个独立标签单元。手写纸覆盖真实标签、主要内容是手写款号/尺码、或图片写有无吊牌/无水洗时必须标记废图。
返回严格 JSON：{{"candidates":[{{"kind":"hang_tag|wash_label|non_label","printed_label":true,"handwritten_placeholder":false,"negative_text":"","style_code":"","color_code":"","sizes":[],"bbox":[0,0,1,1],"confidence":0.0}}]}}。
bbox 使用 0 到 1 归一化坐标并包含完整标签外框。不得猜测看不清的款号、色号或尺码。"""


def default_reviewer(job: ReviewJob, model_id: str) -> list[LabelCandidate]:
    payload, route = llm_gateway.generate_multimodal_json(
        system_prompt="你是服饰吊牌和洗唛的视觉审查器，只返回严格 JSON。",
        user_prompt=_review_prompt(job),
        image_inputs=[str(job.image_path)],
        model_id=model_id,
        config=load_config(),
        timeout_seconds=90,
        retry_same_model=False,
    )
    candidates = payload.get("candidates") if isinstance(payload, Mapping) else []
    if not isinstance(candidates, list):
        return []
    return [
        _candidate_from_payload(item, job=job, model_id=route.model_id)
        for item in candidates
        if isinstance(item, Mapping)
    ]


Reviewer = Callable[[ReviewJob, str], Sequence[LabelCandidate]]


def review_inputs_concurrently(
    jobs: Sequence[ReviewJob],
    *,
    model_ids: Sequence[str] = ("gpt-5.6-terra", "gpt-5.6-luna"),
    reviewer: Reviewer = default_reviewer,
    max_workers: int = 8,
    log: Callable[[str], None] | None = None,
) -> dict[str, list[LabelCandidate]]:
    results = {job.job_id: [] for job in jobs}
    if not jobs or not model_ids:
        return results
    workers = max(1, min(int(max_workers or 1), len(jobs) * len(model_ids)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(reviewer, job, model_id): (job, model_id)
            for job in jobs
            for model_id in model_ids
        }
        for future in as_completed(futures):
            job, model_id = futures[future]
            try:
                candidates = list(future.result() or [])
            except Exception as exc:
                if log:
                    log(f"[warn] 标签视觉初审失败: {job.job_id} / {model_id}: {exc}")
                continue
            results[job.job_id].extend(candidates)
    return results


def _semantic_key(candidate: LabelCandidate) -> tuple[str, str, str, int | None, bool, bool, str]:
    return (
        candidate.kind,
        candidate.style_code,
        candidate.color_code,
        preferred_size(candidate.sizes),
        candidate.printed_label,
        candidate.handwritten_placeholder,
        _negative_label_semantic(candidate.negative_text),
    )


def _decision_from_candidate(
    candidate: LabelCandidate,
    *,
    expected_role: str,
    style_code: str,
    color_code: str,
    allow_related_style: bool = False,
) -> str:
    recognized_style = _compact(candidate.style_code)
    rejection_style = recognized_style if allow_related_style else style_code
    reason = candidate_rejection_reason(candidate, rejection_style)
    if reason:
        return reason
    if (
        color_code
        and candidate.color_code
        and candidate.color_code != color_code
        and (not recognized_style or recognized_style == _compact(style_code))
    ):
        return f"识别色号与当前款色不一致：{candidate.color_code}"
    return ""


def validate_existing_yq(
    row: Mapping[str, object],
    path: Path,
    style_code: str,
    *,
    reviews: Sequence[LabelCandidate],
    sol_reviewer: Reviewer | None = None,
) -> ExistingYqDecision:
    expected_role = _compact(row.get("__yq_kind")) or detect_yq_role(path.name)
    _style, color_code = extract_scope(style_code, row, path.name)
    valid = [
        candidate
        for candidate in reviews
        if not _decision_from_candidate(
            candidate,
            expected_role=expected_role,
            style_code=style_code,
            color_code=color_code,
            allow_related_style=True,
        )
    ]
    expected_scoped_votes = [
        candidate
        for candidate in valid
        if candidate.kind == expected_role
        and _compact(candidate.style_code) == _compact(style_code)
    ]
    competing_scoped_roles = {
        candidate.kind
        for candidate in valid
        if candidate.kind != expected_role
        and _compact(candidate.style_code)
    }
    if expected_scoped_votes and not competing_scoped_roles:
        valid = expected_scoped_votes
    model_ids = {candidate.model_id for candidate in valid if candidate.model_id}
    semantic_keys = {_semantic_key(candidate) for candidate in valid}
    if len(model_ids) >= 2 and len(semantic_keys) == 1:
        candidate = valid[0]
        recognized_style = _compact(candidate.style_code) or _compact(style_code)
        related = recognized_style != _compact(style_code)
        return ExistingYqDecision(
            True,
            candidate.kind,
            recognized_style,
            color_code,
            (
                f"两个视觉模型一致确认关联部件标签有效：{recognized_style}"
                if related
                else "两个视觉模型一致确认现成 yq 有效"
            ),
            tuple(sorted(model_ids)),
        )

    review_keys = {_semantic_key(candidate) for candidate in reviews}
    has_disagreement = len(review_keys) > 1
    if has_disagreement and sol_reviewer is not None:
        job = ReviewJob(f"existing:{path.name}", path, style_code, expected_role, -1)
        try:
            sol_candidates = list(sol_reviewer(job, "gpt-5.6-sol") or [])
        except Exception:
            sol_candidates = []
        sol_valid = [
            candidate
            for candidate in sol_candidates
            if not _decision_from_candidate(
                candidate,
                expected_role=expected_role,
                style_code=style_code,
                color_code=color_code,
                allow_related_style=True,
            )
        ]
        if len(sol_valid) == 1:
            candidate = sol_valid[0]
            candidate_key = _semantic_key(candidate)
            matching_initial = [
                item for item in valid if _semantic_key(item) == candidate_key
            ]
            if matching_initial:
                model_ids = {
                    matching_initial[0].model_id,
                    candidate.model_id or "gpt-5.6-sol",
                }
                return ExistingYqDecision(
                    True,
                    candidate.kind,
                    _compact(candidate.style_code) or _compact(style_code),
                    color_code,
                    (
                        f"初审模型分歧，一初审模型与 Sol 复核一致确认关联部件标签有效："
                        f"{_compact(candidate.style_code)}"
                        if _compact(candidate.style_code)
                        and _compact(candidate.style_code) != _compact(style_code)
                        else "初审模型分歧，一初审模型与 Sol 复核一致确认现成 yq 有效"
                    ),
                    tuple(sorted(model_id for model_id in model_ids if model_id)),
                )

    exact_name_votes = [
        candidate
        for candidate in valid
        if candidate.kind == expected_role
        and candidate.confidence >= 0.85
        and (
            not _compact(candidate.style_code)
            or _compact(candidate.style_code) == _compact(style_code)
        )
    ]
    conflicting_valid_roles = {
        candidate.kind
        for candidate in valid
        if candidate.kind in VALID_YQ_ROLES and candidate.kind != expected_role
    }
    waste_or_handwritten_models = {
        candidate.model_id
        for candidate in reviews
        if candidate.model_id
        and (
            candidate.handwritten_placeholder
            or _negative_label_semantic(candidate.negative_text)
        )
    }
    if (
        has_disagreement
        and len(reviews) >= 2
        and _is_exact_yq_filename(path.name, expected_role)
        and exact_name_votes
        and not conflicting_valid_roles
        and len(waste_or_handwritten_models) < 2
    ):
        candidate = max(exact_name_votes, key=lambda item: item.confidence)
        return ExistingYqDecision(
            True,
            expected_role,
            _compact(candidate.style_code) or _compact(style_code),
            color_code,
            "精确 yq 命名与单模型高置信内容证据一致，保留现成 yq",
            tuple(sorted({item.model_id for item in exact_name_votes if item.model_id})),
        )

    invalid_reasons = [
        _decision_from_candidate(
            candidate,
            expected_role=expected_role,
            style_code=style_code,
            color_code=color_code,
            allow_related_style=True,
        )
        for candidate in reviews
    ]
    invalid_reasons = [reason for reason in invalid_reasons if reason]
    if has_disagreement:
        reason = "视觉模型分歧，未形成有效复核结论"
    elif invalid_reasons:
        reason = invalid_reasons[0]
    else:
        reason = "有效独立模型证据不足，现成 yq 按 fail-closed 拒绝"
    return ExistingYqDecision(False, expected_role, style_code, color_code, reason)


def _bbox_iou(
    left: tuple[float, float, float, float],
    right: tuple[float, float, float, float],
) -> float:
    x1 = max(left[0], right[0])
    y1 = max(left[1], right[1])
    x2 = min(left[2], right[2])
    y2 = min(left[3], right[3])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    if intersection <= 0:
        return 0.0
    left_area = max(0.0, left[2] - left[0]) * max(0.0, left[3] - left[1])
    right_area = max(0.0, right[2] - right[0]) * max(0.0, right[3] - right[1])
    union = left_area + right_area - intersection
    return intersection / union if union > 0 else 0.0


def merge_page_reviews(
    reviews: Sequence[LabelCandidate],
    *,
    iou_threshold: float = 0.75,
) -> list[LabelCandidate]:
    clusters: list[list[LabelCandidate]] = []
    ordered = sorted(
        (candidate for candidate in reviews if _bbox_is_valid(candidate.bbox)),
        key=lambda item: (
            str(item.source_path),
            item.page_index,
            item.bbox[0],
            item.bbox[1],
            item.model_id,
        ),
    )
    for candidate in ordered:
        matching = next(
            (
                cluster
                for cluster in clusters
                if cluster[0].source_path == candidate.source_path
                and cluster[0].page_index == candidate.page_index
                and cluster[0].kind == candidate.kind
                and _bbox_iou(cluster[0].bbox, candidate.bbox) >= iou_threshold
            ),
            None,
        )
        if matching is None:
            clusters.append([candidate])
        else:
            matching.append(candidate)

    merged: list[LabelCandidate] = []
    for cluster in clusters:
        model_ids = {item.model_id for item in cluster if item.model_id}
        if len(model_ids) < 2:
            continue
        if len({item.kind for item in cluster}) != 1:
            continue
        if len({item.style_code for item in cluster}) != 1:
            continue
        if len({item.color_code for item in cluster}) != 1:
            continue
        main_sizes = {preferred_size(item.sizes) for item in cluster}
        if len(main_sizes) != 1:
            continue
        merged.append(_merge_candidate_cluster(cluster))
    return sorted(merged, key=lambda item: (item.page_index, item.bbox[0], item.bbox[1]))


def _merge_candidate_cluster(cluster: Sequence[LabelCandidate]) -> LabelCandidate:
    first = cluster[0]
    model_ids = {item.model_id for item in cluster if item.model_id}
    sizes = tuple(dict.fromkeys(size for item in cluster for size in item.sizes))
    return LabelCandidate(
        kind=first.kind,
        style_code=first.style_code,
        color_code=first.color_code,
        sizes=sizes,
        bbox=tuple(
            float(median(item.bbox[index] for item in cluster))
            for index in range(4)
        ),  # type: ignore[arg-type]
        confidence=min(item.confidence for item in cluster),
        printed_label=all(item.printed_label for item in cluster),
        handwritten_placeholder=any(item.handwritten_placeholder for item in cluster),
        negative_text="；".join(
            dict.fromkeys(item.negative_text for item in cluster if item.negative_text)
        ),
        source_path=first.source_path,
        page_index=first.page_index,
        model_id="+".join(sorted(model_ids)),
    )


def _same_label_unit(
    left: LabelCandidate,
    right: LabelCandidate,
    *,
    iou_threshold: float,
) -> bool:
    return _semantic_key(left) == _semantic_key(right) and _bbox_iou(left.bbox, right.bbox) >= iou_threshold


def recover_page_reviews_with_sol(
    job: ReviewJob,
    reviews: Sequence[LabelCandidate],
    *,
    style_code: str,
    sol_reviewer: Reviewer | None,
    log: Callable[[str], None] | None = None,
    iou_threshold: float = 0.75,
) -> list[LabelCandidate]:
    locked = merge_page_reviews(reviews, iou_threshold=iou_threshold)
    valid_initial = [
        candidate
        for candidate in reviews
        if _bbox_is_valid(candidate.bbox)
        and not candidate_rejection_reason(candidate, style_code)
        and (not job.expected_role or candidate.kind == job.expected_role)
    ]
    unresolved = [
        candidate
        for candidate in valid_initial
        if not any(
            _same_label_unit(candidate, locked_candidate, iou_threshold=iou_threshold)
            for locked_candidate in locked
        )
    ]
    if not unresolved or sol_reviewer is None:
        return locked

    try:
        sol_candidates = list(sol_reviewer(job, "gpt-5.6-sol") or [])
    except Exception as exc:
        if log:
            log(f"[warn] 标签页 Sol 缺口复核失败: {job.job_id}: {exc}")
        return locked
    sol_valid = [
        candidate
        for candidate in sol_candidates
        if _bbox_is_valid(candidate.bbox)
        and not candidate_rejection_reason(candidate, style_code)
        and (not job.expected_role or candidate.kind == job.expected_role)
    ]

    recovered: list[LabelCandidate] = []
    used_sol_indexes: set[int] = set()
    for initial in unresolved:
        if any(
            _same_label_unit(initial, item, iou_threshold=iou_threshold)
            for item in [*locked, *recovered]
        ):
            continue
        match = next(
            (
                (index, sol_candidate)
                for index, sol_candidate in enumerate(sol_valid)
                if index not in used_sol_indexes
                and _same_label_unit(initial, sol_candidate, iou_threshold=iou_threshold)
            ),
            None,
        )
        if match is None:
            continue
        index, sol_candidate = match
        used_sol_indexes.add(index)
        recovered.append(_merge_candidate_cluster([initial, sol_candidate]))

    return sorted(
        [*locked, *recovered],
        key=lambda item: (item.page_index, item.bbox[0], item.bbox[1]),
    )


def _size_rank(candidate: LabelCandidate) -> tuple[int, int, float]:
    size = preferred_size(candidate.sizes)
    if size == 110:
        return (0, 0, -candidate.confidence)
    if size is not None and size > 110:
        return (1, size, -candidate.confidence)
    if size is not None:
        return (2, -size, -candidate.confidence)
    return (3, 0, -candidate.confidence)


def select_candidates(
    candidates: Sequence[LabelCandidate],
    style_code: str,
    missing_roles: set[str],
) -> list[LabelCandidate]:
    selected: list[LabelCandidate] = []
    for role in sorted(missing_roles):
        scoped = [
            item
            for item in candidates
            if item.style_code == style_code
            and item.kind == role
            and not candidate_rejection_reason(item, style_code)
        ]
        if not scoped:
            continue
        selected.append(min(scoped, key=_size_rank))
    return selected


def _validated_bbox(
    bbox: Sequence[float],
) -> tuple[float, float, float, float]:
    if len(bbox) != 4:
        raise ValueError("裁框必须包含四个坐标")
    x1, y1, x2, y2 = (float(value) for value in bbox)
    if not (0.0 <= x1 < x2 <= 1.0 and 0.0 <= y1 < y2 <= 1.0):
        raise ValueError("裁框坐标必须位于 0 到 1 且顺序有效")
    if (x2 - x1) < 0.02 or (y2 - y1) < 0.02 or (x2 - x1) * (y2 - y1) < 0.005:
        raise ValueError("裁框面积过小")
    return x1, y1, x2, y2


def crop_candidate_to_canvas(
    page_path: Path,
    bbox: Sequence[float],
    output_path: Path,
    *,
    size: int = 800,
) -> None:
    x1, y1, x2, y2 = _validated_bbox(bbox)
    width = x2 - x1
    height = y2 - y1
    x1 = max(0.0, x1 - width * 0.015)
    x2 = min(1.0, x2 + width * 0.015)
    y1 = max(0.0, y1 - height * 0.015)
    y2 = min(1.0, y2 + height * 0.015)
    with Image.open(page_path) as raw:
        image = ImageOps.exif_transpose(raw).convert("RGB")
        crop_box = (
            max(0, int(round(x1 * image.width))),
            max(0, int(round(y1 * image.height))),
            min(image.width, int(round(x2 * image.width))),
            min(image.height, int(round(y2 * image.height))),
        )
        cropped = image.crop(crop_box)
        max_content = max(1, int(round(size * 0.95)))
        scale = min(max_content / cropped.width, max_content / cropped.height)
        resized_size = (
            max(1, int(round(cropped.width * scale))),
            max(1, int(round(cropped.height * scale))),
        )
        cropped = cropped.resize(resized_size, Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (size, size), "white")
        offset = ((size - cropped.width) // 2, (size - cropped.height) // 2)
        canvas.paste(cropped, offset)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        save_options = {"quality": 95, "subsampling": 0} if output_path.suffix.lower() in {".jpg", ".jpeg"} else {}
        canvas.save(output_path, **save_options)


def _non_white_fraction(path: Path) -> float:
    with Image.open(path) as raw:
        image = ImageOps.exif_transpose(raw).convert("RGB")
        if image.size != (800, 800):
            return 0.0
        white = Image.new("RGB", image.size, "white")
        difference = ImageChops.difference(image, white).convert("L")
        histogram = difference.histogram()
        return sum(histogram[13:]) / float(image.width * image.height)


def verify_crop(
    candidate: LabelCandidate,
    output_path: Path,
    *,
    ocr_fn: Callable[[Path], Mapping[str, object]] | None,
) -> CropVerification:
    try:
        fraction = _non_white_fraction(output_path)
    except Exception as exc:
        return CropVerification(False, f"裁图无法打开：{exc}")
    if fraction < 0.01:
        return CropVerification(False, "裁图为空白或仅包含背面 Logo")

    if ocr_fn is not None:
        try:
            ocr_result = ocr_fn(output_path)
            ocr_text = _compact(ocr_result.get("text"))
        except Exception:
            ocr_text = ""
        if ocr_text:
            compact_text = re.sub(r"\s+", "", ocr_text)
            if candidate.style_code and candidate.style_code not in compact_text:
                return CropVerification(False, "裁图 OCR 款号与当前款号不一致", ocr_text)
            size = preferred_size(candidate.sizes)
            if size is not None and not re.search(rf"(?<!\d){size}(?!\d)", compact_text):
                return CropVerification(False, "裁图 OCR 未识别到目标尺码", ocr_text)
            return CropVerification(True, "本地 OCR 已核对款号和目标尺码", ocr_text)

    model_ids = {value for value in candidate.model_id.split("+") if value}
    if len(model_ids) >= 2 and candidate.confidence >= 0.9:
        return CropVerification(True, "本地 OCR 不可用，双模型高置信共识通过")
    return CropVerification(False, "本地 OCR 不可用且双模型证据不足")


def render_pdf_pages(
    pdf_path: Path,
    work_dir: Path,
    *,
    zoom: float = 2.0,
) -> list[RenderedPage]:
    import fitz

    work_dir.mkdir(parents=True, exist_ok=True)
    rendered: list[RenderedPage] = []
    with fitz.open(pdf_path) as document:
        matrix = fitz.Matrix(float(zoom), float(zoom))
        for page_index, page in enumerate(document):
            pixmap = page.get_pixmap(matrix=matrix, alpha=False)
            image_path = work_dir / f"page-{page_index + 1:03d}.png"
            pixmap.save(str(image_path))
            rendered.append(RenderedPage(page_index, image_path, pixmap.width, pixmap.height))
    return rendered


def _append_note(existing: object, note: str) -> str:
    current = _compact(existing)
    addition = _compact(note)
    if not current:
        return addition
    if not addition or addition in current:
        return current
    return f"{current}；{addition}"


def _image_is_openable(path: Path) -> bool:
    try:
        with Image.open(path) as image:
            image.verify()
        return True
    except Exception:
        return False


def prepare_review_image(
    source_path: Path,
    work_dir: Path,
    *,
    max_edge: int = 2048,
    max_bytes: int = 8 * 1024 * 1024,
) -> Path:
    source_path = Path(source_path)
    with Image.open(source_path) as raw:
        image = ImageOps.exif_transpose(raw)
        needs_preview = (
            max(image.size) > max_edge
            or source_path.stat().st_size > max_bytes
            or image.mode not in {"RGB", "L"}
        )
        if not needs_preview:
            return source_path
        if image.mode == "RGBA":
            canvas = Image.new("RGB", image.size, "white")
            canvas.paste(image, mask=image.getchannel("A"))
            image = canvas
        else:
            image = image.convert("RGB")
        image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        work_dir.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha1(str(source_path).encode("utf-8")).hexdigest()[:10]
        preview = work_dir / f"{source_path.stem}-{digest}-review.jpg"
        image.save(preview, format="JPEG", quality=90, optimize=True, subsampling=0)
        if preview.stat().st_size >= 10 * 1024 * 1024:
            image.save(preview, format="JPEG", quality=82, optimize=True)
        return preview


def _role_label(role: str) -> str:
    return "吊牌" if role == YQ_HANG_TAG else "洗唛"


def _canonical_yq_filename(role: str, suffix: str = ".jpg", sequence: int = 1) -> str:
    marker = "yq(1)" if role == YQ_HANG_TAG else "yq(2)"
    extension = suffix.lower() if suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"} else ".jpg"
    index = max(1, int(sequence or 1))
    tail = "" if index == 1 else f"-{index}"
    return f"{marker}{tail}{extension}"


def _existing_plan_preference(plan: ExistingYqRenamePlan) -> tuple[int, int, int, str]:
    suffix_rank = {".jpg": 0, ".jpeg": 1, ".png": 2, ".webp": 3}.get(
        plan.source.suffix.casefold(),
        9,
    )
    return (
        0 if plan.source.stem.casefold() == plan.target.stem.casefold() else 1,
        0 if detect_yq_role(plan.source.name) == plan.decision.role else 1,
        suffix_rank,
        plan.source.name.casefold(),
    )


def _temporary_rename_path(path: Path) -> Path:
    for _attempt in range(100):
        candidate = path.with_name(f".{path.name}.shenhui-tmp-{uuid.uuid4().hex}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"无法为 {path.name} 生成临时重命名路径")


def _rollback_existing_rename_plans(plans: Sequence[ExistingYqRenamePlan]) -> list[str]:
    errors: list[str] = []
    holding_moves: list[tuple[Path, Path]] = []
    for plan in plans:
        if plan.current == plan.source:
            if not plan.source.exists():
                errors.append(f"{plan.source} 已不在原始位置")
            continue
        if not plan.current.exists():
            errors.append(f"{plan.current} 缺失，无法恢复到 {plan.source}")
            continue
        try:
            holding = _temporary_rename_path(plan.current)
            plan.current.rename(holding)
            plan.current = holding
            holding_moves.append((holding, plan.source))
        except Exception as exc:
            errors.append(f"{plan.current} 回滚暂存失败: {exc}")

    for holding, source in holding_moves:
        try:
            if source.exists():
                errors.append(f"{source} 已存在，无法恢复 {holding}")
                continue
            holding.rename(source)
        except Exception as exc:
            errors.append(f"{holding} 恢复到 {source} 失败: {exc}")
    return errors


def _execute_existing_rename_plans(plans: Sequence[ExistingYqRenamePlan]) -> None:
    try:
        for plan in plans:
            if plan.target != plan.source:
                temporary = _temporary_rename_path(plan.source)
                plan.source.rename(temporary)
                plan.current = temporary

        for plan in plans:
            if plan.current != plan.target:
                plan.current.rename(plan.target)
                plan.current = plan.target
    except Exception as exc:
        rollback_errors = _rollback_existing_rename_plans(plans)
        message = f"现成 yq 重命名失败，已尝试回滚: {exc}"
        if rollback_errors:
            message = f"{message}；回滚失败: {'；'.join(rollback_errors)}"
        raise RuntimeError(message) from exc


def _default_ocr(path: Path) -> Mapping[str, object]:
    status = ocr_service.project_tesseract_status()
    if not status.get("available"):
        raise RuntimeError("project OCR unavailable")
    return ocr_service.recognize_image_with_tesseract_js(
        path,
        lang="chi_sim+eng",
        timeout_seconds=45,
    )


def _reject_existing_row(
    row: dict,
    path: Path,
    reason: str,
    *,
    remove_file: bool = True,
) -> None:
    row["处理动作"] = "标签废图已剔除"
    row["下载结果"] = "已剔除"
    row["标签判定"] = "拒绝"
    row["标签证据"] = reason
    # A rejected source pathname may later be reused by an accepted yq role
    # correction (for example, valid yq1 -> yq2 after the old yq2 is deleted).
    # Keep the rejected audit row from appearing to point at that replacement.
    row["本地文件"] = ""
    row["最终裁图"] = ""
    row["备注"] = _append_note(row.get("备注"), reason)
    if remove_file:
        path.unlink(missing_ok=True)


def _existing_audit_fields(
    row: dict,
    decision: ExistingYqDecision,
    path: Path,
    expected_style_code: str,
) -> None:
    related = bool(
        _compact(decision.style_code)
        and _compact(decision.style_code) != _compact(expected_style_code)
    )
    row["标签角色"] = _role_label(decision.role)
    row["识别模型"] = "+".join(decision.model_ids)
    row["识别款号"] = decision.style_code
    row["识别色号"] = decision.color_code
    row["识别尺码"] = ""
    row["标签判定"] = "关联部件标签有效" if related else "现成 yq 有效"
    row["标签证据"] = decision.reason
    row["最终裁图"] = str(path)
    row["处理动作"] = "关联部件 yq 已保留" if related else "现成 yq 已锁定"
    row["备注"] = _append_note(row.get("备注"), decision.reason)


def process_prepare_upload_package_labels(
    *,
    data_rows: list,
    package_root: Path,
    pdf_rows: Sequence[tuple[dict, Path, str]],
    work_dir: Path,
    run_params: Mapping[str, object],
    log: Callable[[str], None],
    reviewer: Reviewer = default_reviewer,
    sol_reviewer: Reviewer = default_reviewer,
    render_pages_fn: Callable[..., Sequence[RenderedPage]] = render_pdf_pages,
    ocr_fn: Callable[[Path], Mapping[str, object]] | None = _default_ocr,
) -> ApparelLabelProcessingResult:
    del run_params  # Reserved for future task-scoped model overrides.
    package_root = Path(package_root)
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    accepted_existing: list[Path] = []
    rejected_paths: list[Path] = []
    audit_rows: list[dict] = []
    global_locks: set[tuple[str, str]] = set()
    observed_styles: set[str] = set()
    style_color_hints: dict[str, set[str]] = {}

    for source_row in data_rows or []:
        if not isinstance(source_row, dict):
            continue
        group_style = _compact(
            source_row.get("__shenhui_group_code")
            or source_row.get("输入款号")
            or source_row.get("输入编码")
        )
        if not group_style:
            continue
        pattern = _STYLE_COLOR_PATTERN_TEMPLATE.format(style=re.escape(group_style))
        for value in (
            source_row.get("__style_color_code"),
            source_row.get("输入编码"),
            source_row.get("文件名"),
            source_row.get("云盘路径"),
        ):
            match = re.search(pattern, _compact(value))
            if match:
                style_color_hints.setdefault(group_style, set()).add(match.group(1))

    existing_jobs: list[ReviewJob] = []
    existing_by_job: dict[str, tuple[dict, Path, str]] = {}
    for index, row in enumerate(data_rows or []):
        if not isinstance(row, dict):
            continue
        if _compact(row.get("__shenhui_asset_role")).lower() != "yq":
            continue
        if _compact(row.get("下载结果")) != "已下载":
            continue
        path = Path(_compact(row.get("本地文件"))).expanduser()
        style_code = _compact(row.get("__shenhui_group_code") or row.get("输入款号") or row.get("输入编码"))
        if style_code:
            observed_styles.add(style_code)
        expected_role = _compact(row.get("__yq_kind")) or detect_yq_role(path.name)
        if not path.is_file() or not _image_is_openable(path):
            reason = "现成 yq 文件损坏或无法打开"
            _reject_existing_row(row, path, reason)
            rejected_paths.append(path)
            continue
        if is_waste_path(f"{row.get('文件名') or ''} {row.get('云盘路径') or ''} {path}"):
            reason = "现成 yq 命中无吊牌/无水洗等废图路径标记"
            _reject_existing_row(row, path, reason)
            rejected_paths.append(path)
            continue
        try:
            review_path = prepare_review_image(path, work_dir / "existing-previews")
        except Exception as exc:
            reason = f"现成 yq 识别预览生成失败：{exc}"
            _reject_existing_row(row, path, reason)
            rejected_paths.append(path)
            continue
        job_id = f"existing:{index}:{path.name}"
        job = ReviewJob(job_id, review_path, style_code, expected_role, -1, path)
        existing_jobs.append(job)
        existing_by_job[job_id] = (row, path, style_code)

    existing_reviews = review_inputs_concurrently(
        existing_jobs,
        reviewer=reviewer,
        log=log,
    )
    existing_decisions: list[tuple[ReviewJob, dict, Path, str, ExistingYqDecision]] = []
    for job in existing_jobs:
        row, path, style_code = existing_by_job[job.job_id]
        decision = validate_existing_yq(
            row,
            path,
            style_code,
            reviews=existing_reviews.get(job.job_id, []),
            sol_reviewer=sol_reviewer,
        )
        existing_decisions.append((job, row, path, style_code, decision))
        if not decision.accepted:
            _reject_existing_row(row, path, decision.reason)
            rejected_paths.append(path)

    accepted_plans: list[ExistingYqRenamePlan] = []
    for _job, row, path, style_code, decision in existing_decisions:
        if not decision.accepted:
            continue
        is_primary_style = _compact(decision.style_code) == _compact(style_code)
        target = path.parent / _canonical_yq_filename(
            decision.role,
            path.suffix,
            1 if is_primary_style else 2,
        )
        accepted_plans.append(
            ExistingYqRenamePlan(row, path, style_code, decision, target, path)
        )

    plans_by_scope: dict[tuple[str, str, str], list[ExistingYqRenamePlan]] = {}
    for plan in accepted_plans:
        recognized_style = _compact(plan.decision.style_code) or plan.style_code
        lock_key = (plan.style_code, plan.decision.role, recognized_style)
        plans_by_scope.setdefault(lock_key, []).append(plan)
    deduplicated_plans: list[ExistingYqRenamePlan] = []
    for (_style_code, role, recognized_style), scoped_plans in plans_by_scope.items():
        ordered_plans = sorted(scoped_plans, key=_existing_plan_preference)
        winner = ordered_plans[0]
        deduplicated_plans.append(winner)
        role_marker = "yq(1)" if role == YQ_HANG_TAG else "yq(2)"
        for duplicate in ordered_plans[1:]:
            reason = (
                f"同款同标签款号 {recognized_style} 已有明确 {role_marker} 命名图 "
                f"{winner.source.name}，"
                f"重复{_role_label(role)}已剔除"
            )
            _reject_existing_row(
                duplicate.row,
                duplicate.source,
                reason,
                remove_file=duplicate.source != winner.source,
            )
            rejected_paths.append(duplicate.source)
    accepted_plans = deduplicated_plans

    plans_by_role: dict[tuple[str, str], list[ExistingYqRenamePlan]] = {}
    for plan in accepted_plans:
        plans_by_role.setdefault((plan.style_code, plan.decision.role), []).append(plan)
    for (group_style, _role), scoped_plans in plans_by_role.items():
        ordered = sorted(
            scoped_plans,
            key=lambda item: (
                0 if _compact(item.decision.style_code) == _compact(group_style) else 1,
                _compact(item.decision.style_code),
                _existing_plan_preference(item),
            ),
        )
        related_sequence = 2
        for plan in ordered:
            is_primary_style = _compact(plan.decision.style_code) == _compact(group_style)
            sequence = 1 if is_primary_style else related_sequence
            if not is_primary_style:
                related_sequence += 1
            plan.target = plan.source.parent / _canonical_yq_filename(
                plan.decision.role,
                plan.source.suffix,
                sequence,
            )

    source_paths = {plan.source for plan in accepted_plans}
    target_counts: dict[Path, int] = {}
    for plan in accepted_plans:
        target_counts[plan.target] = target_counts.get(plan.target, 0) + 1

    rename_plans: list[ExistingYqRenamePlan] = []
    for plan in accepted_plans:
        row = plan.row
        path = plan.source
        target = plan.target
        if target_counts.get(target, 0) > 1:
            _reject_existing_row(row, path, f"现成 yq 目标文件名重复：{target.name}")
            rejected_paths.append(path)
            continue
        if target != path and target.exists() and target not in source_paths:
            _reject_existing_row(row, path, f"现成 yq 与已锁定文件重名：{target.name}")
            rejected_paths.append(path)
            continue
        rename_plans.append(plan)

    _execute_existing_rename_plans(rename_plans)

    for plan in rename_plans:
        row = plan.row
        style_code = plan.style_code
        decision = plan.decision
        path = plan.target
        row["本地文件"] = str(path)
        row["文件名"] = path.name
        row["__package_filename"] = path.name
        row["__yq_kind"] = decision.role
        source_role = detect_yq_role(plan.source.name)
        if source_role and source_role != decision.role:
            stale_note = f"{_role_label(source_role)}图片按 yq 模板名识别并保留原名"
            row["备注"] = "；".join(
                part
                for part in str(row.get("备注") or "").split("；")
                if part.strip() and part.strip() != stale_note
            )
        _existing_audit_fields(row, decision, path, style_code)
        if plan.source.name != path.name:
            row["备注"] = _append_note(
                row.get("备注"),
                f"视觉内容复核为{_role_label(decision.role)}，文件已从 {plan.source.name} 更正为 {path.name}",
            )
        accepted_existing.append(path)
        audit_rows.append(row)
        if _compact(decision.style_code) == _compact(style_code):
            global_locks.add((style_code, decision.role))

    page_jobs: list[ReviewJob] = []
    pdf_by_page_job: dict[str, tuple[int, dict, Path, str, str]] = {}
    active_pdf_indices: list[int] = []
    for pdf_index, (row, pdf_path, raw_style_code) in enumerate(pdf_rows or []):
        style_code = _compact(raw_style_code or row.get("__shenhui_group_code") or row.get("输入款号"))
        if style_code:
            observed_styles.add(style_code)
        role_hint = _compact(row.get("__pdf_type")).lower()
        if role_hint not in VALID_YQ_ROLES:
            role_hint = ""
        roles_to_fill = {role_hint} if role_hint else set(VALID_YQ_ROLES)
        roles_to_fill = {
            role for role in roles_to_fill if (style_code, role) not in global_locks
        }
        if not roles_to_fill:
            row["处理动作"] = "现成 yq 已锁定，跳过对应 PDF"
            row["下载结果"] = "已跳过"
            row["备注"] = _append_note(row.get("备注"), "现成 yq 已锁定，未调用 PDF 识别和裁图")
            continue
        expected_role = next(iter(roles_to_fill)) if len(roles_to_fill) == 1 else ""
        try:
            rendered = list(render_pages_fn(pdf_path, work_dir / f"pdf-{pdf_index + 1:03d}"))
        except Exception as exc:
            rendered = []
            row["备注"] = _append_note(row.get("备注"), f"PDF 渲染失败：{exc}")
        if not rendered:
            row["处理动作"] = "截图失败"
            row["备注"] = _append_note(row.get("备注"), "PDF 未生成可识别页面，原 PDF 待人工裁图")
            continue
        active_pdf_indices.append(pdf_index)
        for page in rendered:
            job_id = f"pdf:{pdf_index}:page:{page.page_index}"
            try:
                review_path = prepare_review_image(
                    page.image_path,
                    work_dir / f"pdf-{pdf_index + 1:03d}" / "previews",
                )
            except Exception as exc:
                row["备注"] = _append_note(row.get("备注"), f"PDF 页预览生成失败：{exc}")
                continue
            page_jobs.append(
                ReviewJob(
                    job_id,
                    review_path,
                    style_code,
                    expected_role,
                    page.page_index,
                    page.image_path,
                )
            )
            pdf_by_page_job[job_id] = (pdf_index, row, pdf_path, style_code, expected_role)

    page_reviews = review_inputs_concurrently(page_jobs, reviewer=reviewer, log=log)
    candidates_by_pdf: dict[int, list[LabelCandidate]] = {index: [] for index in active_pdf_indices}
    recovery_by_job: dict[str, tuple[int, list[LabelCandidate]]] = {}
    if page_jobs:
        workers = max(1, min(4, len(page_jobs)))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {}
            for job in page_jobs:
                pdf_index, _row, _pdf_path, style_code, _expected_role = pdf_by_page_job[job.job_id]
                reviews = page_reviews.get(job.job_id, [])
                locked_count = len(merge_page_reviews(reviews))
                future = pool.submit(
                    recover_page_reviews_with_sol,
                    job,
                    reviews,
                    style_code=style_code,
                    sol_reviewer=sol_reviewer,
                    log=log,
                )
                futures[future] = (job, locked_count)
            for future in as_completed(futures):
                job, locked_count = futures[future]
                try:
                    merged = list(future.result() or [])
                except Exception as exc:
                    if log:
                        log(f"[warn] 标签页缺口复核调度失败: {job.job_id}: {exc}")
                    merged = merge_page_reviews(page_reviews.get(job.job_id, []))
                recovery_by_job[job.job_id] = (locked_count, merged)

    for job in page_jobs:
        pdf_index, _row, _pdf_path, style_code, expected_role = pdf_by_page_job[job.job_id]
        locked_count, merged = recovery_by_job.get(job.job_id, (0, []))
        recovered_count = len(merged) - locked_count
        if recovered_count > 0:
            log(f"[info] 标签页 Sol 补齐 {recovered_count} 个初审缺口: {job.job_id}")
        for candidate in merged:
            if expected_role and candidate.kind != expected_role:
                continue
            candidates_by_pdf[pdf_index].append(candidate)

    generated_count = 0
    missing_roles: list[str] = []
    for pdf_index in active_pdf_indices:
        row, pdf_path, style_code = pdf_rows[pdf_index]
        del pdf_path
        role_hint = _compact(row.get("__pdf_type")).lower()
        candidates = [
            item
            for item in candidates_by_pdf.get(pdf_index, [])
            if item.style_code == style_code
            and (style_code, item.kind) not in global_locks
            and (not role_hint or item.kind == role_hint)
        ]
        roles = {item.kind for item in candidates if item.kind in VALID_YQ_ROLES}
        selected = select_candidates(candidates, style_code, roles)
        generated_for_pdf = 0
        for candidate in selected:
            output_path = package_root / style_code / _canonical_yq_filename(
                candidate.kind,
                ".jpg",
            )
            if output_path.exists():
                continue
            try:
                crop_candidate_to_canvas(candidate.source_path, candidate.bbox, output_path)
                verification = verify_crop(candidate, output_path, ocr_fn=ocr_fn)
            except Exception as exc:
                verification = CropVerification(False, f"本地裁图失败：{exc}")
            if not verification.accepted:
                output_path.unlink(missing_ok=True)
                row["备注"] = _append_note(row.get("备注"), verification.reason)
                continue
            global_locks.add((style_code, candidate.kind))
            generated_count += 1
            generated_for_pdf += 1
            recognized_color = _compact(candidate.color_code)
            evidence = verification.reason
            hints = style_color_hints.get(style_code, set())
            if not recognized_color and len(hints) == 1:
                recognized_color = next(iter(hints))
                evidence = _append_note(
                    evidence,
                    f"模型未返回色号，按目录唯一款色文件名证据补齐：{recognized_color}",
                )
            generated_row = {
                "输入款号": style_code,
                "输入编码": row.get("输入编码") or style_code,
                "素材来源": row.get("素材来源") or "静物图",
                "文件名": output_path.name,
                "云盘路径": row.get("云盘路径") or "",
                "处理动作": "AI 识别裁图",
                "下载结果": "已生成",
                "本地文件": str(output_path),
                "备注": evidence,
                "标签角色": _role_label(candidate.kind),
                "识别模型": candidate.model_id,
                "识别款号": candidate.style_code,
                "识别色号": recognized_color,
                "识别尺码": str(preferred_size(candidate.sizes) or ""),
                "标签判定": "通过",
                "标签证据": evidence,
                "最终裁图": str(output_path),
                "__shenhui_group_code": style_code,
                "__shenhui_asset_role": "yq",
                "__yq_kind": candidate.kind,
                "__style_color_code": (
                    f"{style_code}-{candidate.color_code}" if candidate.color_code else ""
                ),
                "__package_filename": output_path.name,
            }
            data_rows.append(generated_row)
            audit_rows.append(generated_row)
        if generated_for_pdf:
            row["处理动作"] = "AI 识别裁图完成"
            row["下载结果"] = "已生成"
            row["标签判定"] = "通过"
            row["标签证据"] = f"生成 {generated_for_pdf} 张有效 yq"
            row["备注"] = _append_note(row.get("备注"), f"AI 识别并生成 {generated_for_pdf} 张 yq")
        else:
            row["处理动作"] = "截图失败"
            row["标签判定"] = "待人工确认"
            row["备注"] = _append_note(row.get("备注"), "未形成可靠双模型标签候选，原 PDF 待人工裁图")

    for style_code in sorted(observed_styles):
        for role in sorted(VALID_YQ_ROLES):
            if (style_code, role) not in global_locks:
                missing_roles.append(f"{style_code}:{role}")

    return ApparelLabelProcessingResult(
        generated_count,
        tuple(accepted_existing),
        tuple(path for path in rejected_paths if path not in set(accepted_existing)),
        tuple(dict.fromkeys(missing_roles)),
        tuple(audit_rows),
    )
