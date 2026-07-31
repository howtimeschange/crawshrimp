"""Shoe-specific selection and packaging for the DeepDraw new-arrival adapter."""

from __future__ import annotations

import re
import shutil
import warnings
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from core import llm_gateway, ocr_service


class ShoeSelectionError(ValueError):
    """Raised when a required DeepDraw shoe slot cannot be selected."""


SHOE_CATEGORY_ALIASES = {
    "运动": "运动",
    "运动鞋": "运动",
    "板鞋": "运动",
    "休闲": "休闲",
    "休闲鞋": "休闲",
    "公主鞋": "休闲",
    "皮鞋": "休闲",
    "女生凉鞋": "休闲",
    "雪地": "雪地",
    "雪地靴": "雪地",
    "秋冬拖鞋": "雪地",
    "运动靴": "雪地",
    "婴童": "婴童",
    "婴童鞋": "婴童",
    "宝宝鞋": "婴童",
}


def _text(value: Any) -> str:
    return str(value or "").strip()


def normalize_shoe_category(value: Any) -> str:
    raw = re.sub(r"\s+", "", _text(value))
    category = SHOE_CATEGORY_ALIASES.get(raw)
    if not category:
        raise ShoeSelectionError(
            f"不支持的鞋品品类“{_text(value)}”；"
            "支持运动鞋/板鞋、公主鞋/皮鞋/女生凉鞋、"
            "雪地靴/秋冬拖鞋/运动靴、宝宝鞋/婴童鞋"
        )
    return category


def _normalize_style_code(value: Any) -> str:
    text = _text(value)
    if re.fullmatch(r"\d+\.0", text):
        text = text[:-2]
    return text


def parse_shoe_category_rows(rows: Any) -> dict[str, str]:
    if not isinstance(rows, list):
        raise ShoeSelectionError("鞋品品类 Excel 无法读取 rows 数据")
    parsed: dict[str, str] = {}
    for row_index, row in enumerate(rows, start=2):
        if not isinstance(row, dict):
            continue
        style_code = _normalize_style_code(row.get("款号"))
        raw_category = _text(row.get("品类"))
        if not style_code and not raw_category:
            continue
        if not style_code or not raw_category:
            raise ShoeSelectionError(
                f"鞋品品类 Excel 第 {row_index} 行必须同时填写“款号”和“品类”"
            )
        category = normalize_shoe_category(raw_category)
        existing = parsed.get(style_code)
        if existing and existing != category:
            raise ShoeSelectionError(
                f"鞋品品类 Excel 款号 {style_code} 重复且品类冲突："
                f"{existing} / {category}"
            )
        parsed[style_code] = category
    if not parsed:
        raise ShoeSelectionError("鞋品品类 Excel 没有有效的“款号/品类”数据")
    return parsed


def resolve_style_category(
    style_code: str,
    model_category: Any,
    shoe_categories: dict[str, str] | None,
) -> tuple[str, str, str]:
    style_code = _normalize_style_code(style_code)
    configured = (shoe_categories or {}).get(style_code)
    if configured:
        return normalize_shoe_category(configured), "Excel指定", ""
    category = normalize_shoe_category(model_category)
    if shoe_categories:
        warning = (
            f"鞋品品类 Excel 中款号未匹配：{style_code}；"
            f"已使用模型兜底品类：{category}"
        )
    else:
        warning = (
            f"未上传鞋品品类 Excel；款号 {style_code} "
            f"已使用模型兜底品类：{category}"
        )
    return category, "模型兜底", warning


def _png_or_jpg_suffix(source_filename: Any, fallback: str = ".jpg") -> str:
    suffix = Path(_text(source_filename)).suffix.lower()
    return ".png" if suffix == ".png" else fallback


def _safe_path_component(value: Any, fallback: str = "未命名") -> str:
    text = re.sub(r'[\\/:*?"<>|]+', "_", _text(value))
    text = re.sub(r"\s+", " ", text).strip(" .")
    return text or fallback


def output_filename(
    slot: str,
    index: int | None = None,
    source_filename: Any = None,
) -> str:
    normalized = _text(slot).lower()
    if normalized == "o":
        return "o.jpg"
    if normalized in {"tms", "yx"}:
        return f"{normalized}{_png_or_jpg_suffix(source_filename)}"
    if normalized == "yk":
        if not index:
            raise ShoeSelectionError("yk 输出必须提供序号")
        return f"yk{index}.jpg"
    if normalized in {"tmz", "yq"}:
        if not index:
            raise ShoeSelectionError(f"{normalized} 输出必须提供序号")
        return f"{normalized} ({index}).jpg"
    if normalized == "wpz":
        if not index:
            raise ShoeSelectionError("wpz 输出必须提供序号")
        return f"wpz ({index if index <= 4 else index + 10}).jpg"
    raise ShoeSelectionError(f"不支持的鞋品输出槽位：{slot}")


def _available_tmz_count(slots: dict[str, Any]) -> int:
    return sum(bool(_text(slots.get(f"tmz{index}"))) for index in range(1, 6))


def select_tmz_same_color_first(
    candidates_by_color: dict[str, dict[str, Any]],
    color_order: list[str] | None = None,
) -> list[tuple[str, str]]:
    """Select five Tmall slots while showing the second color in tmz2.

    The color containing the largest number of Tmall slots becomes the base
    color. Slot 2 uses the next available color when present, because the
    business package expects multi-color styles to reveal another color there.
    Other slots only cross colors when the base color is missing that pose.
    """

    order = [
        color
        for color in (color_order or list(candidates_by_color))
        if color in candidates_by_color
    ]
    order.extend(color for color in candidates_by_color if color not in order)
    if not order:
        raise ShoeSelectionError("未识别到鞋品颜色，无法生成 tmz 主图")

    order_index = {color: index for index, color in enumerate(order)}
    base_color = min(
        order,
        key=lambda color: (
            -_available_tmz_count(candidates_by_color.get(color) or {}),
            order_index[color],
        ),
    )

    selected: list[tuple[str, str]] = []
    for index in range(1, 6):
        slot = f"tmz{index}"
        base_value = _text((candidates_by_color.get(base_color) or {}).get(slot))
        if index == 2:
            alternate = next(
                (
                    (color, _text((candidates_by_color.get(color) or {}).get(slot)))
                    for color in order
                    if color != base_color
                    and _text((candidates_by_color.get(color) or {}).get(slot))
                ),
                None,
            )
            if alternate:
                selected.append(alternate)
                continue
        if base_value:
            selected.append((base_color, base_value))
            continue
        fallback = next(
            (
                (color, _text((candidates_by_color.get(color) or {}).get(slot)))
                for color in order
                if color != base_color
                and _text((candidates_by_color.get(color) or {}).get(slot))
            ),
            None,
        )
        if not fallback:
            raise ShoeSelectionError(f"未识别到 {slot} 对应姿势，无法生成完整天猫主图")
        selected.append(fallback)
    return selected


def _selection_list(slots: dict[str, Any], slot: str) -> list[str]:
    direct = slots.get(slot)
    if isinstance(direct, list):
        return [_text(value) for value in direct if _text(value)]
    values = []
    index = 1
    while True:
        key = f"{slot}{index}"
        if key not in slots:
            break
        value = _text(slots.get(key))
        if value:
            values.append(value)
        index += 1
    return values


def _promoted_color(
    selections_by_color: dict[str, dict[str, Any]],
    color_order: list[str],
) -> str:
    return next(
        (
            color
            for color in color_order
            if _selection_list(selections_by_color.get(color) or {}, "yk")
        ),
        color_order[0] if color_order else "",
    )


def _promoted_color_first(
    selections_by_color: dict[str, dict[str, Any]],
    color_order: list[str],
) -> list[str]:
    promoted = _promoted_color(selections_by_color, color_order)
    if not promoted:
        return color_order
    return [
        promoted,
        *[color for color in color_order if color != promoted],
    ]


def build_output_assignments(
    selections_by_color: dict[str, dict[str, Any]],
    color_order: list[str] | None = None,
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    order = [
        color
        for color in (color_order or list(selections_by_color))
        if color in selections_by_color
    ]
    order.extend(color for color in selections_by_color if color not in order)
    if not order:
        raise ShoeSelectionError("未识别到鞋品颜色")
    order = _promoted_color_first(selections_by_color, order)

    main_color = order[0]
    main_slots = selections_by_color.get(main_color) or {}
    if not _text(main_slots.get("o")):
        raise ShoeSelectionError(f"{main_color} 未识别到必需的 o.jpg 海报姿势")

    assignments: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []

    for index, (color, source) in enumerate(
        select_tmz_same_color_first(selections_by_color, order),
        start=1,
    ):
        assignments.append({
            "color": color,
            "slot": f"tmz{index}",
            "source": source,
            "output_path": output_filename("tmz", index),
        })

    for color_index, color in enumerate(order, start=1):
        slots = selections_by_color.get(color) or {}
        folder = f"{color_index}.{_safe_path_component(color)}"

        for slot in ("tms",):
            source = _text(slots.get(slot))
            if not source:
                continue
            assignments.append({
                "color": color,
                "slot": slot,
                "source": source,
                "output_path": f"{folder}/{output_filename(slot, source_filename=source)}",
            })

        if color == main_color:
            source = _text(slots.get("o"))
            assignments.append({
                "color": color,
                "slot": "o",
                "source": source,
                "output_path": f"{folder}/{output_filename('o')}",
            })

        for slot in ("wpz", "yq"):
            for index, source in enumerate(_selection_list(slots, slot), start=1):
                assignments.append({
                    "color": color,
                    "slot": f"{slot}{index}",
                    "source": source,
                    "output_path": f"{folder}/{output_filename(slot, index)}",
                })

        if color == main_color:
            for index, source in _yk_output_sources(_selection_list(slots, "yk")):
                assignments.append({
                    "color": color,
                    "slot": f"yk{index}",
                    "source": source,
                    "output_path": f"{folder}/{output_filename('yk', index)}",
                })

        yx_source = _text(slots.get("yx"))
        if yx_source:
            assignments.append({
                "color": color,
                "slot": "yx",
                "source": yx_source,
                "output_path": f"{folder}/{output_filename('yx', source_filename=yx_source)}",
            })
        else:
            warnings.append({
                "color": color,
                "warning": "允许缺少 yx.jpg：未识别到功能吊牌图",
            })

    return assignments, warnings


SHOE_REFERENCE_IMAGE = (
    Path(__file__).resolve().parents[1]
    / "adapters"
    / "shenhui-new-arrival"
    / "assets"
    / "shoe-main-image-template-small.jpg"
)
SHOE_POSE1_REFERENCE_IMAGE = (
    Path(__file__).resolve().parents[1]
    / "adapters"
    / "shenhui-new-arrival"
    / "assets"
    / "shoe-main-pose1-template.jpg"
)
SHOE_YQ_REFERENCE_IMAGE = (
    Path(__file__).resolve().parents[1]
    / "adapters"
    / "shenhui-new-arrival"
    / "assets"
    / "shoe-yq-template.jpg"
)
SHOE_LABEL_OCR_MODEL = "qwen3.7-plus"
SHOE_POSE_MULTI_MODEL_ID = "multi-model"
SHOE_POSE_DEFAULT_MODEL = "gpt-5.5"
SHOE_POSE_MODEL_CANDIDATES = (
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "claude-opus-4-8",
    "claude-sonnet-5",
    "gemini-3.1-pro-preview",
    "gemini-3.5-flash",
    "qwen3.8-max-preview",
    "qwen3.7-plus",
    "deepseek-v4-pro",
    "glm-5.2",
    "kimi-k2.7-code",
)
SHOE_CROSS_COLOR_MAX_DISTANCE = 0.32
SHOE_WHITE_BACKGROUND_LUMA = 249.5
SHOE_YX_MAX_FOREGROUND_COVERAGE = 0.65
SHOE_POSE3_SIDE_ASYMMETRY_MARGIN = 0.006
SHOE_POSE1_MIN_SCORE_IMPROVEMENT = 0.08
SHOE_BACKGROUND_PAIR_MAX_DISTANCE = 0.06
SHOE_GRAY_BACKGROUND_RGB = (242, 242, 242)

SHOE_POSE5_FEATURE_RULES = {
    "运动": {
        "min_aspect": 1.02,
        "max_aspect": 1.35,
        "target_aspect": 1.10,
        "max_coverage": 0.22,
        "target_coverage": 0.10,
    },
    "婴童": {
        "min_aspect": 1.02,
        "max_aspect": 1.45,
        "target_aspect": 1.12,
        "max_coverage": 0.22,
        "target_coverage": 0.11,
    },
    "休闲": {
        "min_aspect": 0.40,
        "max_aspect": 0.80,
        "target_aspect": 0.55,
        "max_coverage": 0.22,
        "target_coverage": 0.10,
    },
    "雪地": {
        "min_aspect": 0.82,
        "max_aspect": 1.25,
        "target_aspect": 1.00,
        "max_coverage": 0.22,
        "target_coverage": 0.11,
    },
}

SHOE_SELECTION_SYSTEM_PROMPT = """你是电商鞋品图片审核员。你要把候选原图匹配到深绘鞋品图包槽位。
只能选择候选图编号，不能编造编号或文件名。先识别鞋盒标签中的产品名称和颜色，再结合参考模板判断品类和姿势。
品类只能是：运动、休闲、雪地、婴童。
运动：运动鞋、板鞋。
休闲：公主鞋、皮鞋、普通靴子、女生凉鞋。
雪地：雪地靴、秋冬拖鞋、运动靴。
婴童：婴童鞋。
只返回 JSON，不要 Markdown。"""


def _qwen_fallback_model_ids(model_id: str) -> list[str]:
    return {
        "qwen3.8-max-preview": ["qwen3.7-plus"],
        "qwen3.7-plus": ["qwen3.8-max-preview"],
    }.get(_text(model_id), [])


def _shoe_pose_model_ids(model_id: str) -> list[str]:
    text = _text(model_id)
    if not text or text.lower() in {
        "auto",
        "multi",
        "multi-model",
        "multi_model",
        "多模型",
    }:
        return list(SHOE_POSE_MODEL_CANDIDATES)
    parts = [
        _text(item)
        for item in re.split(r"[\s,，、;；]+", text)
        if _text(item)
    ]
    return list(dict.fromkeys(parts or [text]))


def _is_pose_matching_candidate(filename: str) -> bool:
    """Exclude prebuilt channel/AI angles from pose analysis while preserving them."""

    stem = Path(_text(filename)).stem
    return (
        not re.search(r"ai\s*角度图", stem, flags=re.IGNORECASE)
        and not re.fullmatch(r"\d{12}-\d{5}", stem)
    )


def _is_named_yk_filename(filename: str) -> bool:
    return bool(
        re.match(
            r"^yk\s*(?:[\(（]\s*)?\d+",
            Path(_text(filename)).stem,
            flags=re.IGNORECASE,
        )
    )


def _bare_yk_index(filename: str) -> int | None:
    match = re.fullmatch(r"([1-9]\d?)", Path(_text(filename)).stem)
    return int(match.group(1)) if match else None


def _is_yk_source_filename(filename: str) -> bool:
    return _named_yk_index(filename) is not None or _bare_yk_index(filename) is not None


def _yk_source_index(filename: str) -> int | None:
    named = _named_yk_index(filename)
    return named if named is not None else _bare_yk_index(filename)


def _named_yk_index(filename: str) -> int | None:
    match = re.match(
        r"^yk\s*(?:[\(（]\s*)?(\d+)",
        Path(_text(filename)).stem,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    return int(match.group(1))


def _yk_output_sources(sources: list[str]) -> list[tuple[int, str]]:
    output: list[tuple[int, str]] = []
    used: set[int] = set()
    fallback_index = 1
    for source in sources:
        explicit_index = _yk_source_index(source)
        if explicit_index is not None:
            if explicit_index in used:
                continue
            index = explicit_index
        else:
            while fallback_index in used:
                fallback_index += 1
            index = fallback_index
        used.add(index)
        output.append((index, source))
    return output


def _named_yk_sort_key(filename: str) -> tuple[int, int, str]:
    index = _yk_source_index(filename)
    stem = Path(_text(filename)).stem
    canonical = bool(
        re.fullmatch(rf"yk\s*{index}", stem, flags=re.IGNORECASE)
    ) if index else False
    priority = 0 if canonical else 1 if _bare_yk_index(filename) is not None else 2
    return (index if index is not None else 9999, priority, filename.lower())


def _is_reserved_shoe_output_filename(filename: str) -> bool:
    stem = Path(_text(filename)).stem
    normalized = stem.lower()
    if _is_named_yk_filename(filename):
        return True
    if normalized in {"o", "tms", "yx", "tmq", "tmt"}:
        return True
    if normalized.startswith(("jdt.", "wpt30.")):
        return True
    return bool(
        re.match(
            r"^(?:tmz|wpz|yq)\s*(?:[\(（]\s*)?\d+\s*[\)）]?$",
            stem,
            flags=re.IGNORECASE,
        )
    )


def _is_pose_selection_candidate(filename: str) -> bool:
    """Keep every usable original eligible for pose selection."""

    return _is_pose_matching_candidate(filename)


def _is_ai_angle_image_filename(filename: str) -> bool:
    stem = re.sub(r"\s+", "", Path(_text(filename)).stem.lower())
    return bool(re.search(r"ai角度图\d*$", stem, flags=re.IGNORECASE))


def _entries_with_ai_angle_images(
    base_entries: list[dict[str, Any]],
    all_entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    names = {
        _text(entry.get("filename"))
        for entry in base_entries
    }
    output = list(base_entries)
    output.extend(
        entry
        for entry in all_entries
        if _is_ai_angle_image_filename(_text(entry.get("filename")))
        and _text(entry.get("filename")) not in names
    )
    return output


def _is_junk_shoe_asset_filename(filename: str, cloud_path: str = "") -> bool:
    name = Path(_text(filename)).name
    if not name:
        return False
    lowered = name.lower()
    if lowered.startswith("._") or lowered in {".ds_store", "desktop.ini", "thumbs.db"}:
        return True
    segments = [
        segment
        for segment in _text(cloud_path).replace("\\", "/").split("/")
        if segment
    ]
    return any(
        segment == "__MACOSX"
        or Path(segment).name.startswith("._")
        or segment.lower() in {".ds_store", "desktop.ini", "thumbs.db"}
        for segment in segments
    )


def _original_asset_relative_targets(
    entries: list[dict[str, Any]],
) -> list[Path]:
    """Build lossless output paths without overwriting cloud files with the same name."""

    filename_counts: dict[str, int] = {}
    for entry in entries:
        filename = Path(_text(entry.get("filename"))).name
        filename_counts[filename] = filename_counts.get(filename, 0) + 1

    targets: list[Path] = []
    used_targets: set[Path] = set()
    for entry_index, entry in enumerate(entries, start=1):
        filename = Path(_text(entry.get("filename"))).name
        if filename_counts.get(filename, 0) > 1:
            cloud_path = _text((entry.get("row") or {}).get("云盘路径")).replace("\\", "/")
            source_folder = PurePosixPath(cloud_path).parent.name or f"来源{entry_index}"
            target = Path(source_folder) / filename
        else:
            target = Path(filename)

        if target in used_targets:
            target = target.with_name(
                f"{target.stem} ({entry_index}){target.suffix}"
            )
        used_targets.add(target)
        targets.append(target)
    return targets


def _shoe_size_segment(entry: dict[str, Any]) -> str:
    cloud_path = _text((entry.get("row") or {}).get("云盘路径")).replace("\\", "/")
    segments = [segment for segment in cloud_path.split("/") if segment]
    for segment in reversed(segments[:-1]):
        if re.fullmatch(r"\d{2}", segment):
            return segment
    return ""


def _shoe_size_yk_marker_count(entries: list[dict[str, Any]], size: str) -> int:
    return sum(
        1
        for entry in entries
        if _shoe_size_segment(entry) == size
        and _is_yk_source_filename(_text(entry.get("filename")))
    )


def _filter_single_shoe_size_entries(
    entries: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], str]:
    sizes = sorted(
        {
            size
            for entry in entries
            for size in [_shoe_size_segment(entry)]
            if size
        },
        key=lambda value: int(value),
    )
    if len(sizes) <= 1:
        return entries, ""
    yk_counts = {
        size: _shoe_size_yk_marker_count(entries, size)
        for size in sizes
    }
    has_yk_markers = any(count > 0 for count in yk_counts.values())
    if has_yk_markers:
        selected = max(
            sizes,
            key=lambda size: (yk_counts[size], int(size)),
        )
        reason = f"按文案标注 YK 优先选择 {selected} 码素材"
    else:
        selected = sizes[-1]
        preserved_angle_count = sum(
            1
            for entry in entries
            if _shoe_size_segment(entry)
            and _shoe_size_segment(entry) != selected
            and _is_ai_angle_image_filename(_text(entry.get("filename")))
        )
        if preserved_angle_count:
            reason = (
                f"未发现文案标注 YK，回退保留 {selected} 码素材，"
                f"并保留 {preserved_angle_count} 张跨尺码 AI 角度图"
            )
        else:
            reason = f"未发现文案标注 YK，回退仅保留 {selected} 码素材"
    filtered = [
        entry
        for entry in entries
        if (
            not _shoe_size_segment(entry)
            or _shoe_size_segment(entry) == selected
            or (
                not has_yk_markers
                and _is_ai_angle_image_filename(_text(entry.get("filename")))
            )
        )
    ]
    return (
        filtered,
        f"检测到同款色多个尺码原图（{', '.join(sizes)}），{reason}",
    )


@dataclass(frozen=True)
class _BinaryPoseFeature:
    mask: Any
    aspect_ratio: float
    bounding_coverage: float
    background_luma: float
    valid: bool


def _image_rgb_on_white(image: Any) -> Any:
    """Convert PIL images to RGB, compositing transparent pixels onto white."""

    return _image_rgb_on_background(image, (255, 255, 255))


def _image_rgb_on_background(
    image: Any,
    background_rgb: tuple[int, int, int],
    *,
    replace_opaque_background: bool = False,
) -> Any:
    """Convert PIL images to RGB, compositing transparent pixels onto a solid color."""

    from PIL import Image

    if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (*background_rgb, 255))
        background.alpha_composite(rgba)
        return background.convert("RGB")
    rgb = image.convert("RGB")
    if replace_opaque_background:
        return _replace_border_background(rgb, background_rgb)
    return rgb


def _replace_border_background(
    image: Any,
    background_rgb: tuple[int, int, int],
    *,
    tolerance: int = 18,
) -> Any:
    """Repaint only the edge-connected studio background on opaque images."""

    width, height = image.size
    if width <= 0 or height <= 0:
        return image
    pixels = image.load()
    border = []
    for x in range(width):
        border.extend((pixels[x, 0], pixels[x, height - 1]))
    for y in range(height):
        border.extend((pixels[0, y], pixels[width - 1, y]))
    source_background = tuple(
        sorted(pixel[channel] for pixel in border)[len(border) // 2]
        for channel in range(3)
    )

    def is_background(pixel: tuple[int, int, int]) -> bool:
        return max(
            abs(pixel[channel] - source_background[channel])
            for channel in range(3)
        ) <= tolerance

    output = image.copy()
    output_pixels = output.load()
    visited = bytearray(width * height)
    stack: list[tuple[int, int]] = []
    for x in range(width):
        stack.append((x, 0))
        stack.append((x, height - 1))
    for y in range(height):
        stack.append((0, y))
        stack.append((width - 1, y))

    while stack:
        x, y = stack.pop()
        offset = y * width + x
        if visited[offset]:
            continue
        visited[offset] = 1
        if not is_background(pixels[x, y]):
            continue
        output_pixels[x, y] = background_rgb
        if x > 0:
            stack.append((x - 1, y))
        if x + 1 < width:
            stack.append((x + 1, y))
        if y > 0:
            stack.append((x, y - 1))
        if y + 1 < height:
            stack.append((x, y + 1))
    return output


def _binary_pose_feature(path: Path | str) -> _BinaryPoseFeature:
    """Build a color-insensitive foreground silhouette for cross-color matching."""

    from PIL import Image, ImageFilter, ImageOps

    with Image.open(path) as opened:
        image = _image_rgb_on_white(ImageOps.exif_transpose(opened))
        image.thumbnail((256, 256), Image.Resampling.LANCZOS)
    width, height = image.size
    pixels = image.load()
    border = []
    for x in range(width):
        border.extend((pixels[x, 0], pixels[x, height - 1]))
    for y in range(height):
        border.extend((pixels[0, y], pixels[width - 1, y]))
    background = tuple(
        sorted(pixel[channel] for pixel in border)[len(border) // 2]
        for channel in range(3)
    )

    mask = Image.new("L", image.size)
    mask_pixels = mask.load()
    for y in range(height):
        for x in range(width):
            pixel = pixels[x, y]
            distance = max(
                abs(pixel[channel] - background[channel])
                for channel in range(3)
            )
            mask_pixels[x, y] = 255 if distance > 22 else 0
    mask = mask.filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.MaxFilter(3))
    bbox = mask.getbbox()
    if not bbox:
        return _BinaryPoseFeature(
            mask=Image.new("1", (128, 128)),
            aspect_ratio=1.0,
            bounding_coverage=0.0,
            background_luma=sum(background) / 3,
            valid=False,
        )

    crop = mask.crop(bbox)
    crop_width, crop_height = crop.size
    crop.thumbnail((116, 116), Image.Resampling.LANCZOS)
    normalized = Image.new("L", (128, 128), 0)
    normalized.paste(
        crop,
        ((128 - crop.width) // 2, (128 - crop.height) // 2),
    )
    normalized = normalized.point(lambda value: 255 if value > 80 else 0).convert("1")
    return _BinaryPoseFeature(
        mask=normalized,
        aspect_ratio=crop_width / max(crop_height, 1),
        bounding_coverage=(crop_width * crop_height) / max(width * height, 1),
        background_luma=sum(background) / 3,
        valid=True,
    )


def _binary_pose_distance(
    anchor: _BinaryPoseFeature,
    candidate: _BinaryPoseFeature,
) -> float:
    from PIL import ImageChops, ImageStat

    if not anchor.valid or not candidate.valid or anchor.mask is None or candidate.mask is None:
        return float("inf")
    mismatch = (
        ImageStat.Stat(
            ImageChops.logical_xor(anchor.mask, candidate.mask).convert("L")
        ).mean[0]
        / 255
    )
    return (
        mismatch
        + abs(anchor.aspect_ratio - candidate.aspect_ratio) * 0.08
        + abs(anchor.bounding_coverage - candidate.bounding_coverage) * 0.10
        + abs(anchor.background_luma - candidate.background_luma) / 255 * 0.15
    )


def _binary_pose_horizontal_asymmetry(feature: _BinaryPoseFeature | None) -> float:
    """Measure whether a vertical shoe shows a side instead of a frontal view."""

    if not feature or not feature.valid or feature.mask is None:
        return 0.0

    from PIL import ImageChops, ImageOps, ImageStat

    mask = feature.mask.convert("1")
    mirrored = ImageOps.mirror(mask)
    return (
        ImageStat.Stat(
            ImageChops.logical_xor(mask, mirrored).convert("L")
        ).mean[0]
        / 255
    )


def _rank_binary_contour_matches(
    anchor_path: Path | str,
    candidates: list[dict[str, Any]],
    *,
    feature_cache: dict[str, _BinaryPoseFeature] | None = None,
) -> list[tuple[str, float]]:
    """Rank another color's originals by background-differenced silhouette."""

    cache = feature_cache if feature_cache is not None else {}

    def feature(path: Path | str) -> _BinaryPoseFeature:
        key = str(Path(path))
        if key not in cache:
            cache[key] = _binary_pose_feature(path)
        return cache[key]

    anchor = feature(anchor_path)
    ranked = [
        (
            _text(entry.get("filename")),
            _binary_pose_distance(anchor, feature(entry["path"])),
        )
        for entry in candidates
        if _text(entry.get("filename")) and entry.get("path")
    ]
    return sorted(ranked, key=lambda item: (item[1], item[0].lower()))


def _rank_yx_layout_matches(
    anchor_path: Path | str,
    candidates: list[dict[str, Any]],
    *,
    image_cache: dict[str, Any] | None = None,
) -> list[tuple[str, float]]:
    """Rank yx candidates by the full-canvas shoe-and-function-tag layout.

    A foreground crop is deliberately not used here: yx differs from an
    otherwise identical ordinary shoe shot by the function tags placed in
    front of the shoe. Keeping the entire canvas preserves those tag positions.
    """

    from PIL import Image, ImageChops, ImageOps, ImageStat

    cache = image_cache if image_cache is not None else {}

    def feature(path: Path | str):
        key = str(Path(path))
        if key not in cache:
            with Image.open(path) as opened:
                cache[key] = (
                    _image_rgb_on_white(ImageOps.exif_transpose(opened))
                    .resize((128, 128), Image.Resampling.LANCZOS)
                )
        return cache[key]

    anchor = feature(anchor_path)
    ranked = []
    for entry in candidates:
        filename = _text(entry.get("filename"))
        if not filename or not entry.get("path"):
            continue
        difference = ImageStat.Stat(
            ImageChops.difference(anchor, feature(entry["path"]))
        ).mean
        score = sum(difference) / (len(difference) * 255)
        ranked.append((filename, score))
    return sorted(ranked, key=lambda item: (item[1], item[0].lower()))


def _rank_shoe_box_matches(
    anchor_path: Path | str,
    candidates: list[dict[str, Any]],
    *,
    feature_cache: dict[str, _BinaryPoseFeature] | None = None,
) -> list[tuple[str, float]]:
    """Rank shoe-box label shots without confusing a horizontal outsole."""

    cache = feature_cache if feature_cache is not None else {}

    def feature(path: Path | str) -> _BinaryPoseFeature:
        key = str(Path(path))
        if key not in cache:
            cache[key] = _binary_pose_feature(path)
        return cache[key]

    anchor = feature(anchor_path)
    ranked = []
    for entry in candidates:
        filename = _text(entry.get("filename"))
        if not filename or not entry.get("path"):
            continue
        candidate = feature(entry["path"])
        if not anchor.valid or not candidate.valid:
            score = float("inf")
        else:
            score = (
                abs(anchor.bounding_coverage - candidate.bounding_coverage) * 0.70
                + abs(anchor.aspect_ratio - candidate.aspect_ratio) * 0.10
                + abs(anchor.background_luma - candidate.background_luma) / 255 * 0.80
            )
        ranked.append((filename, score))
    return sorted(ranked, key=lambda item: (item[1], item[0].lower()))


def _copy_variant_key(filename: str) -> str:
    stem = Path(_text(filename)).stem
    return re.sub(
        r"\s*(?:拷贝|[-－]?\s*副本)$",
        "",
        stem,
        flags=re.IGNORECASE,
    ).strip().lower()


def _is_snow_lining_detail_feature(pose: _BinaryPoseFeature | None) -> bool:
    return bool(
        pose
        and 0.90 <= pose.aspect_ratio <= 1.50
        and 0.25 <= pose.bounding_coverage <= 0.50
    )


def _is_snow_pose4_opening_feature(pose: _BinaryPoseFeature | None) -> bool:
    return bool(
        pose
        and 0.95 <= pose.aspect_ratio <= 1.45
        and 0.50 <= pose.bounding_coverage <= 0.75
        and 235.0 <= pose.background_luma < SHOE_WHITE_BACKGROUND_LUMA
    )


def _is_snow_opening_angle_filename(filename: str) -> bool:
    return _is_ai_angle_image_filename(filename)


def _snow_opening_angle_filename_priority(filename: str) -> int:
    if not _is_snow_opening_angle_filename(filename):
        return 99
    stem = re.sub(r"\s+", "", Path(_text(filename)).stem.lower())
    match = re.search(r"角度图(\d+)$", stem, flags=re.IGNORECASE)
    if not match:
        return 9
    try:
        number = int(match.group(1))
    except ValueError:
        return 9
    return 0 if number == 1 else 1 if number == 2 else min(number, 9)


def _is_snow_pose4_business_opening(
    filename: str,
    pose: _BinaryPoseFeature | None,
) -> bool:
    if _is_snow_opening_angle_filename(filename):
        return True
    return bool(
        pose
        and (
            (
                _is_named_snow_detail_filename(filename)
                and (
                    _is_snow_pose4_opening_feature(pose)
                    or _is_snow_lining_detail_feature(pose)
                )
            )
            or (
                0.85 <= pose.aspect_ratio <= 1.08
                and 0.18 <= pose.bounding_coverage <= 0.35
                and 235.0 <= pose.background_luma < SHOE_WHITE_BACKGROUND_LUMA
            )
        )
    )


def _create_snow_lining_detail_crop(source: Path, target: Path) -> None:
    from PIL import Image, ImageChops, ImageOps

    with Image.open(source) as opened:
        image = _image_rgb_on_white(ImageOps.exif_transpose(opened))
    width, height = image.size
    pixels = image.load()
    border = []
    for x in range(width):
        border.extend((pixels[x, 0], pixels[x, height - 1]))
    for y in range(height):
        border.extend((pixels[0, y], pixels[width - 1, y]))
    background = tuple(
        sorted(pixel[channel] for pixel in border)[len(border) // 2]
        for channel in range(3)
    )
    diff = ImageChops.difference(
        image,
        Image.new("RGB", image.size, background),
    ).convert("L")
    mask = diff.point(lambda value: 255 if value > 18 else 0)
    bbox = mask.getbbox()
    if bbox:
        left, top, right, bottom = bbox
        fg_width = right - left
        fg_height = bottom - top
        crop = (
            max(0, left - int(fg_width * 0.08)),
            max(0, top - int(fg_height * 0.08)),
            min(width, right + int(fg_width * 0.08)),
            min(height, top + int(fg_height * 0.62)),
        )
    else:
        crop = (
            int(width * 0.20),
            int(height * 0.10),
            int(width * 0.80),
            int(height * 0.62),
        )
    target.parent.mkdir(parents=True, exist_ok=True)
    image.crop(crop).save(target, format="JPEG", quality=95, optimize=True)


def _slot_source_names(slots: dict[str, Any]) -> set[str]:
    names: set[str] = set()
    for key, value in slots.items():
        if str(key).startswith("_") or key == "yk":
            continue
        values = value if isinstance(value, list) else [value]
        names.update(_text(item) for item in values if _text(item))
    return names


def _entry_feature(entry: dict[str, Any]) -> _BinaryPoseFeature | None:
    path = entry.get("path") if isinstance(entry, dict) else None
    if not path:
        return None
    try:
        return _binary_pose_feature(Path(path))
    except Exception:
        return None


def _snow_lining_detail_score(feature: _BinaryPoseFeature) -> float:
    return (
        abs(feature.aspect_ratio - 1.23)
        + abs(feature.bounding_coverage - 0.38) * 2.0
    )


def _is_named_snow_detail_filename(filename: str) -> bool:
    stem = Path(_text(filename)).stem.lower()
    return bool(
        _is_yk_source_filename(filename)
        or re.search(r"(?:细节|鞋口|内里|绒毛|detail|mouth|lining)", stem)
    )


def _snow_pose4_opening_score(feature: _BinaryPoseFeature) -> float:
    return (
        abs(feature.aspect_ratio - 1.16)
        + abs(feature.bounding_coverage - 0.58) * 2.0
    )


def _snow_pose4_business_opening_sort_key(
    filename: str,
    feature: _BinaryPoseFeature | None,
) -> tuple[int, int, float, str]:
    angle_priority = _snow_opening_angle_filename_priority(filename)
    if angle_priority < 99:
        return (0, angle_priority, 0.0, filename.lower())
    if feature is None:
        return (9, 9, float("inf"), filename.lower())
    group = 1 if _is_named_snow_detail_filename(filename) else 2
    return (
        group,
        9,
        _snow_pose4_opening_score(feature),
        filename.lower(),
    )


def _ensure_snow_detail_yk(
    *,
    style_code: str,
    color_code: str,
    slots: dict[str, Any],
    entries_by_name: dict[str, dict[str, Any]],
    analysis_root: Path,
) -> tuple[dict[str, Any], str]:
    if _selection_list(slots, "yk"):
        return slots, ""

    detail_candidates = [
        (name, entry, feature)
        for name, entry in entries_by_name.items()
        for feature in [_entry_feature(entry)]
        if feature and _is_snow_lining_detail_feature(feature)
    ]
    opening_candidates = [
        (name, entry, feature)
        for name, entry in entries_by_name.items()
        for feature in [_entry_feature(entry)]
        if feature and _is_snow_pose4_business_opening(name, feature)
    ]

    occupied = _slot_source_names(slots)
    available = [
        item
        for item in detail_candidates
        if item[0] not in occupied
        and _is_named_snow_detail_filename(item[0])
    ]
    if available:
        name, _entry, _feature = min(
            available,
            key=lambda item: (_snow_lining_detail_score(item[2]), item[0].lower()),
        )
        ruled = dict(slots)
        ruled["yk"] = [name]
        return ruled, f"缺少文案 YK 标注，已选择 {name} 作为 yk1"

    preferred_names = [
        _text(slots.get("tmz4")),
        *(_selection_list(slots, "wpz")[3:4]),
    ]
    preferred = next(
        (
            (name, entry, feature)
            for name in preferred_names
            for entry in [entries_by_name.get(name)]
            if entry
            for feature in [_entry_feature(entry)]
            if feature
            and (
                _is_snow_pose4_business_opening(name, feature)
                or _is_snow_lining_detail_feature(feature)
            )
        ),
        None,
    )
    source = preferred or min(
        opening_candidates,
        key=lambda item: _snow_pose4_business_opening_sort_key(item[0], item[2]),
        default=None,
    )
    if source is None:
        source = min(
            detail_candidates,
            key=lambda item: (_snow_lining_detail_score(item[2]), item[0].lower()),
            default=None,
        )
    if source is None:
        return slots, ""
    source_name, source_entry, _source_feature = source
    generated_name = "yk1-auto-crop.jpg"
    if generated_name in entries_by_name:
        generated_name = "yk1-auto-crop-2.jpg"
    generated_path = analysis_root / style_code / f"{color_code}-{generated_name}"
    _create_snow_lining_detail_crop(Path(source_entry["path"]), generated_path)
    entries_by_name[generated_name] = {
        "path": generated_path,
        "filename": generated_name,
        "row": source_entry["row"],
    }
    ruled = dict(slots)
    ruled["yk"] = [generated_name]
    return ruled, f"缺少独立细节图，已从 {source_name} 裁切生成 yk1"


def _apply_selection_quality_rules(
    category: str,
    slots: dict[str, Any],
    entries_by_name: dict[str, dict[str, Any]],
    *,
    outsole_entries_by_name: dict[str, dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Repair deterministic pose/background mistakes after model selection."""

    ruled = dict(slots)
    ruled["wpz"] = _selection_list(slots, "wpz")
    corrections: list[str] = []
    feature_cache: dict[str, _BinaryPoseFeature] = {}

    def feature_for(
        name: str,
        source_entries: dict[str, dict[str, Any]] | None = None,
    ) -> _BinaryPoseFeature | None:
        entry = (source_entries or entries_by_name).get(_text(name))
        path = entry.get("path") if isinstance(entry, dict) else None
        if not path:
            return None
        key = str(Path(path))
        if key not in feature_cache:
            try:
                feature_cache[key] = _binary_pose_feature(path)
            except Exception:
                return None
        feature = feature_cache[key]
        return feature if feature.valid else None

    yx_name = _text(ruled.get("yx"))
    yx_feature = feature_for(yx_name)
    if (
        yx_name
        and yx_feature
        and yx_feature.bounding_coverage > SHOE_YX_MAX_FOREGROUND_COVERAGE
    ):
        ruled["yx"] = ""
        corrections.append(
            f"yx 已清空：{yx_name} 为鞋面局部特写，未完整展示鞋子与功能吊牌"
        )

    wpz = ruled["wpz"]
    yq = _selection_list(slots, "yq")
    ruled["yq"] = yq

    # yq1 is not category-specific: it is the same front-shoe plus rear-outsole
    # composition as main-image pose 2. Reusing the already selected pose keeps
    # the fixed yq sequence deterministic even when the model mistakes a
    # multi-shoe top view for the reference composition.
    if len(yq) >= 1 and len(wpz) >= 2 and yq[0] != wpz[1]:
        previous_yq1 = yq[0]
        yq[0] = wpz[1]
        corrections.append(
            f"yq1 固定姿势已纠正：{previous_yq1} -> {yq[0]}"
        )

    def valid_yq2_outsole(pose: _BinaryPoseFeature | None) -> bool:
        return bool(
            pose
            and 1.75 <= pose.aspect_ratio <= 2.70
            and 0.08 <= pose.bounding_coverage <= 0.40
            and pose.background_luma >= 235.0
        )

    outsole_entries = outsole_entries_by_name or entries_by_name
    current_yq2_feature = (
        feature_for(yq[1], outsole_entries)
        if len(yq) >= 2
        else None
    )
    if (
        len(yq) >= 2
        and current_yq2_feature is not None
        and not valid_yq2_outsole(current_yq2_feature)
    ):
        occupied = {
            _text(value)
            for value in [
                *wpz,
                yq[0],
                *yq[2:],
                ruled.get("yx"),
                *[ruled.get(f"tmz{index}") for index in range(1, 6)],
            ]
            if _text(value)
        }
        eligible_outsoles = [
            (filename, pose)
            for filename in outsole_entries
            if filename not in occupied
            for pose in [feature_for(filename, outsole_entries)]
            if valid_yq2_outsole(pose)
        ]
        if eligible_outsoles:
            target_aspect, target_coverage = {
                "运动": (2.30, 0.24),
                "休闲": (2.35, 0.19),
                "雪地": (1.98, 0.15),
                "婴童": (1.98, 0.15),
            }.get(_text(category), (2.10, 0.18))
            previous_yq2 = yq[1]
            replacement, _replacement_feature = min(
                eligible_outsoles,
                key=lambda item: (
                    abs(item[1].background_luma - 242.0) / 255.0,
                    abs(item[1].aspect_ratio - target_aspect)
                    + abs(item[1].bounding_coverage - target_coverage) * 2.0,
                    item[0].lower(),
                ),
            )
            yq[1] = replacement
            corrections.append(
                f"yq2 完整鞋底已纠正：{previous_yq2} -> {replacement}"
            )

    def valid_pose3(pose: _BinaryPoseFeature | None) -> bool:
        return bool(
            pose
            and 0.45 <= pose.aspect_ratio <= 0.82
            and pose.bounding_coverage <= 0.10
        )

    if len(wpz) >= 3:
        current_wpz3 = wpz[2]
        current_tmz3 = _text(ruled.get("tmz3")) or current_wpz3
        eligible_pose3 = [
            (filename, pose)
            for filename in entries_by_name
            for pose in [feature_for(filename)]
            if valid_pose3(pose)
        ]

        # Sports and baby-shoe shoots can contain two near-identical vertical
        # candidates: a frontal shoe and the outer-side profile required by
        # the template. The outer-side silhouette is less left/right
        # symmetric. Only use that signal when the candidate gap is clear.
        if _text(category) in {"运动", "婴童"} and len(eligible_pose3) >= 2:
            pose3_by_asymmetry = sorted(
                (
                    (
                        _binary_pose_horizontal_asymmetry(pose),
                        filename,
                    )
                    for filename, pose in eligible_pose3
                ),
                key=lambda item: (-item[0], item[1].lower()),
            )
            best_asymmetry, best_filename = pose3_by_asymmetry[0]
            second_asymmetry = pose3_by_asymmetry[1][0]
            if (
                best_asymmetry - second_asymmetry
                >= SHOE_POSE3_SIDE_ASYMMETRY_MARGIN
                and (
                    current_wpz3 != best_filename
                    or current_tmz3 != best_filename
                )
            ):
                wpz[2] = best_filename
                ruled["tmz3"] = best_filename
                corrections.append(
                    "第3姿势外侧竖立图已纠正："
                    f"{current_wpz3} -> {best_filename}"
                )
                current_wpz3 = best_filename
                current_tmz3 = best_filename

        if (
            not valid_pose3(feature_for(current_wpz3))
            or not valid_pose3(feature_for(current_tmz3))
        ):
            occupied = {
                _text(value)
                for value in [
                    *wpz[:2],
                    *wpz[3:],
                    *yq,
                    ruled.get("yx"),
                    *[
                        ruled.get(f"tmz{index}")
                        for index in (1, 2, 4, 5)
                    ],
                ]
                if _text(value)
            }
            unoccupied_pose3 = [
                (filename, pose)
                for filename, pose in eligible_pose3
                if filename not in occupied
            ]
            if unoccupied_pose3:
                replacement, replacement_feature = min(
                    unoccupied_pose3,
                    key=lambda item: (
                        abs(item[1].aspect_ratio - 0.68)
                        + abs(item[1].bounding_coverage - 0.055) * 2.0,
                        item[0].lower(),
                    ),
                )
                wpz[2] = replacement
                ruled["tmz3"] = replacement

                paired_variants = [
                    (
                        filename,
                        _binary_pose_distance(replacement_feature, pose),
                    )
                    for filename, pose in eligible_pose3
                    if filename != replacement
                ]
                paired_variants = [
                    item
                    for item in paired_variants
                    if item[1] <= 0.04
                ]
                if paired_variants:
                    ruled["tmz3"] = min(
                        paired_variants,
                        key=lambda item: (item[1], item[0].lower()),
                    )[0]
                corrections.append(
                    "第3姿势竖立图已纠正："
                    f"{current_wpz3} -> {replacement}"
                )

    if wpz:
        current_wpz1 = wpz[0]
        current_tmz1 = _text(ruled.get("tmz1")) or current_wpz1
        current_wpz1_feature = feature_for(current_wpz1)
        current_tmz1_feature = feature_for(current_tmz1)
        target_aspect, target_coverage = {
            "雪地": (0.67, 0.145),
            "运动": (0.78, 0.23),
            "休闲": (0.84, 0.20),
            "婴童": (0.84, 0.20),
        }.get(_text(category), (0.84, 0.20))

        def valid_shared_pose1(pose: _BinaryPoseFeature | None) -> bool:
            return bool(
                pose
                and 0.58 <= pose.aspect_ratio <= 0.95
                and 0.08 <= pose.bounding_coverage <= 0.35
                and 235.0 <= pose.background_luma < SHOE_WHITE_BACKGROUND_LUMA
            )

        occupied = {
            _text(value)
            for value in [
                *wpz[1:],
                *yq,
                ruled.get("yx"),
                *[ruled.get(f"tmz{index}") for index in range(2, 6)],
            ]
            if _text(value)
        }
        eligible_pose1 = [
            (filename, pose)
            for filename in entries_by_name
            if filename not in occupied
            for pose in [feature_for(filename)]
            if valid_shared_pose1(pose)
        ]

        def pose1_score(pose: _BinaryPoseFeature) -> float:
            return (
                abs(pose.aspect_ratio - target_aspect)
                + abs(pose.bounding_coverage - target_coverage) * 2.0
            )

        if (
            current_wpz1_feature is not None
            and current_tmz1_feature is not None
            and eligible_pose1
        ):
            replacement, replacement_feature = min(
                eligible_pose1,
                key=lambda item: (
                    pose1_score(item[1]),
                    item[0].lower(),
                ),
            )
            current_valid = (
                valid_shared_pose1(current_wpz1_feature)
                and valid_shared_pose1(current_tmz1_feature)
            )
            current_score = max(
                (
                    pose1_score(pose)
                    for pose in (current_wpz1_feature, current_tmz1_feature)
                    if pose is not None
                ),
                default=float("inf"),
            )
            should_replace = (
                not current_valid
                or (
                    replacement not in {current_wpz1, current_tmz1}
                    and current_score - pose1_score(replacement_feature)
                    >= SHOE_POSE1_MIN_SCORE_IMPROVEMENT
                )
            )
            if should_replace:
                wpz[0] = replacement
                ruled["tmz1"] = replacement
                corrections.append(
                    "主图1新版单鞋斜前方姿势已纠正："
                    f"{current_wpz1} -> {replacement}"
                )

    if _text(category) == "雪地" and len(wpz) >= 4:
        current_wpz4 = wpz[3]
        current_tmz4 = _text(ruled.get("tmz4")) or current_wpz4

        if (
            not _is_snow_pose4_business_opening(current_wpz4, feature_for(current_wpz4))
            or not _is_snow_pose4_business_opening(current_tmz4, feature_for(current_tmz4))
        ):
            occupied = {
                _text(value)
                for value in [
                    *wpz[:3],
                    *wpz[4:],
                    *yq,
                    ruled.get("yx"),
                    *[
                        ruled.get(f"tmz{index}")
                        for index in (1, 2, 3, 5)
                    ],
                ]
                if _text(value)
            }
            eligible_pose4 = [
                (filename, pose)
                for filename in entries_by_name
                if filename not in occupied
                for pose in [feature_for(filename)]
                if _is_snow_pose4_business_opening(filename, pose)
            ]
            if eligible_pose4:
                replacement, _replacement_feature = min(
                    eligible_pose4,
                    key=lambda item: _snow_pose4_business_opening_sort_key(
                        item[0],
                        item[1],
                    ),
                )
                wpz[3] = replacement
                ruled["tmz4"] = replacement
                corrections.append(
                    "雪地第4姿势完整鞋口内里图已纠正："
                    f"{current_wpz4} -> {replacement}"
                )

    if _text(category) == "休闲" and len(wpz) >= 4:
        current_wpz4 = wpz[3]
        current_tmz4 = _text(ruled.get("tmz4")) or current_wpz4

        def valid_leisure_pose4(pose: _BinaryPoseFeature | None) -> bool:
            return bool(
                pose
                and 1.35 <= pose.aspect_ratio <= 1.75
                and 0.05 <= pose.bounding_coverage <= 0.11
                and 235.0 <= pose.background_luma < SHOE_WHITE_BACKGROUND_LUMA
            )

        if (
            not valid_leisure_pose4(feature_for(current_wpz4))
            or not valid_leisure_pose4(feature_for(current_tmz4))
        ):
            occupied = {
                _text(value)
                for value in [
                    *wpz[:3],
                    *wpz[4:],
                    *yq,
                    ruled.get("yx"),
                    *[
                        ruled.get(f"tmz{index}")
                        for index in (1, 2, 3, 5)
                    ],
                ]
                if _text(value)
            }
            eligible_pose4 = [
                (filename, pose)
                for filename in entries_by_name
                if filename not in occupied
                for pose in [feature_for(filename)]
                if valid_leisure_pose4(pose)
            ]
            if eligible_pose4:
                replacement, _replacement_feature = min(
                    eligible_pose4,
                    key=lambda item: (
                        abs(item[1].aspect_ratio - 1.55)
                        + abs(item[1].bounding_coverage - 0.078) * 2.0,
                        item[0].lower(),
                    ),
                )
                wpz[3] = replacement
                ruled["tmz4"] = replacement
                corrections.append(
                    "休闲第4姿势后侧完整侧面已纠正："
                    f"{current_wpz4} -> {replacement}"
                )

    if _text(category) == "婴童" and len(wpz) >= 4:
        current_wpz4 = wpz[3]
        current_tmz4 = _text(ruled.get("tmz4")) or current_wpz4

        def valid_baby_pose4(pose: _BinaryPoseFeature | None) -> bool:
            return bool(
                pose
                and 1.05 <= pose.aspect_ratio <= 1.35
                and 0.06 <= pose.bounding_coverage <= 0.12
                and 235.0 <= pose.background_luma < SHOE_WHITE_BACKGROUND_LUMA
            )

        if (
            not valid_baby_pose4(feature_for(current_wpz4))
            or not valid_baby_pose4(feature_for(current_tmz4))
        ):
            # A model commonly swaps the baby-shoe rear-side pose with yq3.
            # Keep the current yq3 available here; the shared yq3 rule below
            # will then recover the released complete outer-side image.
            occupied = {
                _text(value)
                for value in [
                    *wpz[:3],
                    *wpz[4:],
                    *yq[:2],
                    ruled.get("yx"),
                    *[
                        ruled.get(f"tmz{index}")
                        for index in (1, 2, 3, 5)
                    ],
                ]
                if _text(value)
            }
            eligible_pose4 = [
                (filename, pose)
                for filename in entries_by_name
                if filename not in occupied
                for pose in [feature_for(filename)]
                if valid_baby_pose4(pose)
            ]
            if eligible_pose4:
                replacement, _replacement_feature = min(
                    eligible_pose4,
                    key=lambda item: (
                        abs(item[1].aspect_ratio - 1.22)
                        + abs(item[1].bounding_coverage - 0.09) * 2.0,
                        item[0].lower(),
                    ),
                )
                wpz[3] = replacement
                ruled["tmz4"] = replacement
                corrections.append(
                    "婴童第4姿势后侧角度已纠正："
                    f"{current_wpz4} -> {replacement}"
                )

    if _text(category) == "运动":
        current_pose4 = wpz[3] if len(wpz) >= 4 else _text(ruled.get("tmz4"))
        current_pose4_feature = feature_for(current_pose4)

        def valid_sports_pose4(pose: _BinaryPoseFeature | None) -> bool:
            return bool(
                pose
                and 0.82 <= pose.aspect_ratio <= 1.05
                and 0.15 <= pose.bounding_coverage <= 0.32
                and 235.0 <= pose.background_luma < SHOE_WHITE_BACKGROUND_LUMA
            )

        if current_pose4 and not valid_sports_pose4(current_pose4_feature):
            occupied = {
                _text(value)
                for value in [
                    *wpz[:3],
                    *wpz[4:],
                    *yq,
                    ruled.get("yx"),
                    *[
                        ruled.get(f"tmz{index}")
                        for index in (1, 2, 3, 5)
                    ],
                ]
                if _text(value)
            }
            eligible_pose4 = [
                (filename, pose)
                for filename in entries_by_name
                if filename not in occupied
                for pose in [feature_for(filename)]
                if valid_sports_pose4(pose)
            ]
            if eligible_pose4:
                replacement, _replacement_feature = min(
                    eligible_pose4,
                    key=lambda item: (
                        abs(item[1].aspect_ratio - 0.90)
                        + abs(item[1].bounding_coverage - 0.23) * 2.0,
                        item[0].lower(),
                    ),
                )
                ruled["tmz4"] = replacement
                if len(wpz) >= 4:
                    wpz[3] = replacement
                corrections.append(
                    f"运动第4姿势后侧鞋底角度已纠正："
                    f"{current_pose4} -> {replacement}"
                )

    current_yq3 = yq[2] if len(yq) >= 3 else ""
    current_yq3_feature = feature_for(current_yq3)
    yq3_target = {
        "运动": (2.10, 0.26),
        "休闲": (2.10, 0.19),
        "雪地": (1.60, 0.19),
        "婴童": (1.58, 0.17),
    }.get(_text(category), (1.80, 0.20))

    def valid_shared_yq3(pose: _BinaryPoseFeature | None) -> bool:
        return bool(
            pose
            and 1.45 <= pose.aspect_ratio <= 2.50
            and 0.10 <= pose.bounding_coverage <= 0.45
            and 235.0 <= pose.background_luma < SHOE_WHITE_BACKGROUND_LUMA
        )

    if current_yq3 and not valid_shared_yq3(current_yq3_feature):
        occupied = {
            _text(value)
            for value in [
                *wpz,
                *yq[:2],
                ruled.get("yx"),
                *[ruled.get(f"tmz{index}") for index in range(1, 6)],
            ]
            if _text(value)
        }
        eligible_yq3 = [
            (filename, pose)
            for filename in entries_by_name
            if filename not in occupied
            for pose in [feature_for(filename)]
            if valid_shared_yq3(pose)
        ]
        if eligible_yq3:
            replacement, _replacement_feature = min(
                eligible_yq3,
                key=lambda item: (
                    abs(item[1].aspect_ratio - yq3_target[0])
                    + abs(item[1].bounding_coverage - yq3_target[1]) * 2.0,
                    item[0].lower(),
                ),
            )
            yq[2] = replacement
            corrections.append(
                f"yq3 固定完整外侧面已纠正："
                f"{current_yq3} -> {replacement}"
            )

    if len(wpz) < 5:
        return ruled, corrections

    preferred_leisure_gray_tmz5 = ""
    if _text(category) == "休闲":
        leisure_tmz5_candidates = [
            (filename, pose)
            for filename in entries_by_name
            for pose in [feature_for(filename)]
            if (
                pose
                and pose.valid
                and 1.15 <= pose.aspect_ratio <= 1.75
                and 0.05 <= pose.bounding_coverage <= 0.42
                and 235.0 <= pose.background_luma < SHOE_WHITE_BACKGROUND_LUMA
            )
        ]
        if leisure_tmz5_candidates:
            preferred_leisure_gray_tmz5, _preferred_feature = min(
                leisure_tmz5_candidates,
                key=lambda item: (
                    abs(item[1].aspect_ratio - 1.30)
                    + abs(item[1].bounding_coverage - 0.09) * 2.0,
                    item[0].lower(),
                ),
            )

    groups: dict[str, list[tuple[str, _BinaryPoseFeature]]] = {}
    gray_variants: list[tuple[str, _BinaryPoseFeature]] = []
    white_variants: list[tuple[str, _BinaryPoseFeature]] = []
    for filename in entries_by_name:
        current_feature = feature_for(filename)
        if not current_feature:
            continue
        groups.setdefault(_copy_variant_key(filename), []).append(
            (filename, current_feature)
        )
        if current_feature.background_luma < SHOE_WHITE_BACKGROUND_LUMA:
            gray_variants.append((filename, current_feature))
        else:
            white_variants.append((filename, current_feature))

    paired_groups: list[dict[str, Any]] = []
    paired_names: set[tuple[str, str]] = set()
    for key, variants in groups.items():
        gray = [
            item
            for item in variants
            if item[1].background_luma < SHOE_WHITE_BACKGROUND_LUMA
        ]
        white = [
            item
            for item in variants
            if item[1].background_luma >= SHOE_WHITE_BACKGROUND_LUMA
        ]
        if not gray or not white:
            continue
        gray_name, gray_feature = min(
            gray,
            key=lambda item: (abs(item[1].background_luma - 242.0), item[0].lower()),
        )
        white_name, white_feature = max(
            white,
            key=lambda item: (item[1].background_luma, item[0].lower()),
        )
        paired_groups.append({
            "key": key,
            "gray_name": gray_name,
            "gray_feature": gray_feature,
            "white_name": white_name,
            "white_feature": white_feature,
        })
        paired_names.add((gray_name, white_name))

    used_white_names = {
        white_name
        for _gray_name, white_name in paired_names
    }

    def safe_pose_distance(
        first: _BinaryPoseFeature,
        second: _BinaryPoseFeature,
    ) -> float:
        if first.mask is None or second.mask is None:
            return float("inf")
        return _binary_pose_distance(first, second)

    for gray_name, gray_feature in gray_variants:
        nearest_white = min(
            (
                (white_name, white_feature, safe_pose_distance(gray_feature, white_feature))
                for white_name, white_feature in white_variants
                if (gray_name, white_name) not in paired_names
                and white_name not in used_white_names
            ),
            key=lambda item: (item[2], item[0].lower()),
            default=None,
        )
        if nearest_white is None or nearest_white[2] > SHOE_BACKGROUND_PAIR_MAX_DISTANCE:
            continue
        white_name, white_feature, _distance = nearest_white
        paired_groups.append({
            "key": f"{gray_name}\0{white_name}",
            "gray_name": gray_name,
            "gray_feature": gray_feature,
            "white_name": white_name,
            "white_feature": white_feature,
        })
        paired_names.add((gray_name, white_name))
        used_white_names.add(white_name)

    rule = SHOE_POSE5_FEATURE_RULES.get(_text(category))
    if not paired_groups or not rule:
        return ruled, corrections

    def valid_pose(group: dict[str, Any]) -> bool:
        pose = group["gray_feature"]
        return (
            rule["min_aspect"] <= pose.aspect_ratio <= rule["max_aspect"]
            and pose.bounding_coverage <= rule["max_coverage"]
        )

    preferred_leisure_group = next(
        (
            group
            for group in paired_groups
            if group["gray_name"] == preferred_leisure_gray_tmz5
        ),
        None,
    )
    current_key = _copy_variant_key(wpz[4])
    current_group = next(
        (group for group in paired_groups if group["key"] == current_key),
        None,
    )
    if preferred_leisure_group:
        selected_group = preferred_leisure_group
    elif current_group and valid_pose(current_group):
        selected_group = current_group
    else:
        eligible = [group for group in paired_groups if valid_pose(group)]
        if not eligible:
            return ruled, corrections
        selected_group = min(
            eligible,
            key=lambda group: (
                abs(
                    group["gray_feature"].aspect_ratio
                    - rule["target_aspect"]
                )
                + abs(
                    group["gray_feature"].bounding_coverage
                    - rule["target_coverage"]
                )
                * 2.0,
                group["gray_name"].lower(),
            ),
        )

    previous_tmz5 = _text(ruled.get("tmz5"))
    previous_wpz5 = wpz[4]
    ruled["tmz5"] = selected_group["white_name"]
    wpz[4] = selected_group["gray_name"]
    if (
        preferred_leisure_group
        and selected_group["key"] == preferred_leisure_group["key"]
        and previous_tmz5 != ruled["tmz5"]
    ):
        corrections.append(
            "休闲第5张主图双鞋斜前方姿势已纠正："
            f"{previous_tmz5} -> {ruled['tmz5']}"
        )
    if _copy_variant_key(previous_wpz5) != selected_group["key"]:
        corrections.append(
            f"{category}第5姿势已纠正："
            f"{previous_wpz5} -> {selected_group['gray_name']}"
        )
    if (
        previous_tmz5 != ruled["tmz5"]
        or previous_wpz5 != wpz[4]
    ):
        corrections.append(
            "tmz5/wpz5 白底/灰底已按同一姿势成对校正："
            f"{ruled['tmz5']} / {wpz[4]}"
        )
    return ruled, corrections


def _match_slots_from_anchor_color(
    *,
    anchor_slots: dict[str, Any],
    anchor_entries: list[dict[str, Any]],
    target_entries: list[dict[str, Any]],
) -> tuple[dict[str, Any], float]:
    """Propagate an approved color's slot poses to another color locally."""

    anchor_by_name = {
        _text(entry.get("filename")): entry
        for entry in anchor_entries
        if _text(entry.get("filename"))
    }
    target_by_name = {
        _text(entry.get("filename")): entry
        for entry in target_entries
        if _text(entry.get("filename"))
    }
    if not anchor_by_name or not target_by_name:
        raise ShoeSelectionError("跨色姿势匹配缺少可读取的原图")

    feature_cache: dict[str, _BinaryPoseFeature] = {}
    yx_layout_cache: dict[str, Any] = {}
    source_match_cache: dict[tuple[str, str], tuple[str, float]] = {}
    anchor_order = list(anchor_by_name)
    target_order = list(target_by_name)

    def match_source(
        source_name: str,
        *,
        optional: bool = False,
        match_kind: str = "pose",
    ) -> str:
        source_name = _text(source_name)
        if not source_name:
            return ""
        cache_key = (match_kind, source_name)
        if cache_key in source_match_cache:
            return source_match_cache[cache_key][0]
        anchor_entry = anchor_by_name.get(source_name)
        if not anchor_entry:
            if optional:
                return ""
            raise ShoeSelectionError(f"基准色姿势图不存在：{source_name}")

        if match_kind == "yx_layout":
            anchor_key = str(Path(anchor_entry["path"]))
            if anchor_key not in feature_cache:
                feature_cache[anchor_key] = _binary_pose_feature(
                    anchor_entry["path"]
                )
            if not feature_cache[anchor_key].valid:
                return ""
            ranked = _rank_yx_layout_matches(
                anchor_entry["path"],
                target_entries,
                image_cache=yx_layout_cache,
            )
        else:
            ranker = (
                _rank_shoe_box_matches
                if match_kind == "shoe_box"
                else _rank_binary_contour_matches
            )
            ranked = ranker(
                anchor_entry["path"],
                target_entries,
                feature_cache=feature_cache,
            )
        if ranked and ranked[0][1] != float("inf"):
            if optional and ranked[0][1] > SHOE_CROSS_COLOR_MAX_DISTANCE:
                return ""
            source_match_cache[cache_key] = ranked[0]
            return ranked[0][0]

        # Some synthetic/unit-test assets and rare all-white originals do not
        # yield a contour. Color folders from the same shoot retain stable
        # ordering, so use the corresponding position as a bounded fallback.
        source_index = re.search(r"(?:^|[-_ ])(\d+)$", Path(source_name).stem)
        if source_index:
            same_index = next(
                (
                    name
                    for name in target_order
                    if re.search(
                        rf"(?:^|[-_ ]){re.escape(source_index.group(1))}$",
                        Path(name).stem,
                    )
                ),
                "",
            )
            if same_index:
                source_match_cache[cache_key] = (same_index, 0.0)
                return same_index
        anchor_index = anchor_order.index(source_name)
        if len(anchor_order) == len(target_order) and anchor_index < len(target_order):
            matched = target_order[anchor_index]
            source_match_cache[cache_key] = (matched, 0.0)
            return matched
        if optional:
            return ""
        raise ShoeSelectionError(f"跨色姿势匹配失败：{source_name}")

    matched: dict[str, Any] = {
        "_model_id": (
            f"{_text(anchor_slots.get('_model_id'))}+二值轮廓跨色匹配"
            if _text(anchor_slots.get("_model_id"))
            else "二值轮廓跨色匹配"
        )
    }
    for key in (f"tmz{index}" for index in range(1, 6)):
        matched[key] = match_source(_text(anchor_slots.get(key)))
    wpz_sources = _selection_list(anchor_slots, "wpz")
    matched["wpz"] = [
        match_source(
            source,
            match_kind="shoe_box" if index == 6 else "pose",
        )
        for index, source in enumerate(wpz_sources, start=1)
    ]
    matched["yq"] = [
        match_source(source)
        for source in _selection_list(anchor_slots, "yq")
    ]
    matched["yx"] = match_source(
        _text(anchor_slots.get("yx")),
        optional=True,
        match_kind="yx_layout",
    )
    optional_yx = _text(anchor_slots.get("yx"))
    scores = [
        score
        for (match_kind, source_name), (_target, score) in source_match_cache.items()
        if score != float("inf")
        and not (match_kind == "yx_layout" and source_name == optional_yx)
    ]
    return matched, max(scores, default=0.0)


def _shoe_selection_prompt(
    style_code: str,
    color_code: str,
    candidate_ids: dict[str, str],
    shoe_category: str = "",
    *,
    candidate_sheet_count: int = 1,
) -> str:
    candidate_text = "\n".join(f"{key}={value}" for key, value in candidate_ids.items())
    candidate_sheet_count = max(1, int(candidate_sheet_count))
    if candidate_sheet_count == 1:
        image_order = (
            "第一张图是带编号的本色候选原图，第二张图是鞋品主图姿势模板，"
            "第三张图是新版主图1参考姿势，第四张图是 yq 三姿势参考模板。"
        )
    else:
        reference_start = candidate_sheet_count + 1
        image_order = (
            f"前{candidate_sheet_count}张图都是带编号的本色候选原图；"
            f"第{reference_start}张图是鞋品主图姿势模板，"
            f"第{reference_start + 1}张图是新版主图1参考姿势，"
            f"第{reference_start + 2}张图是 yq 三姿势参考模板。"
        )
    forced_category = _text(shoe_category)
    forced_rule = ""
    if forced_category:
        category_column = {
            "雪地": "第1列",
            "运动": "第2列",
            "婴童": "第3列",
            "休闲": "第4列",
        }[forced_category]
        pose5_rule = {
            "雪地": "两只鞋并排、鞋头以约45度斜前方朝向镜头",
            "运动": "两只鞋前后错位、斜前方展示，能看清鞋面和外侧",
            "婴童": "两只鞋左右对称并排，两个鞋头都正面朝向镜头",
            "休闲": "两只鞋斜前方并排或轻微错位展示，能看清两只鞋面和鞋头",
        }[forced_category]
        pose5_extra = ""
        if forced_category == "婴童":
            pose5_extra = (
                "婴童第5姿势不允许选择两只鞋斜向45度、前后错位、"
                "一只侧身或从侧前方展示的图片。\n"
            )
        elif forced_category == "休闲":
            pose5_extra = "休闲第5姿势不要选择两只鞋竖向上下分开的俯视对角线图。\n"
        forced_rule = (
            f"\n本款品类已由 Excel 确定为“{forced_category}”，"
            f"只能按模板{category_column}选择姿势；不得自行改判品类，"
            f'shoe_category 必须返回“{forced_category}”。'
            f"该品类第5姿势必须是：{pose5_rule}。"
            "灰底 wpz5 与白底 tmz5 必须分别选择这个相同摆放姿势。"
            + (pose5_extra or "\n")
        )
    return f"""款号：{style_code}
色码：{color_code}
{image_order}
模板四列从左到右依次为：雪地、运动、婴童、休闲；每列从上到下是主图姿势1至5。
{forced_rule}

选择规则：
1. tmz1..tmz5 是天猫5张主图；wpz1..wpz4 与天猫前4张姿势相同。
   tmz1/wpz1 必须使用第三张参考图的新版主图1：单只鞋、白底或浅灰底、斜前方悬浮/半悬浮展示，
   能同时看清鞋面、鞋头、鞋身外侧和鞋底厚度；这个主图1适用于所有平台，不能再按旧模板第一格选择平放双鞋、鞋盒、局部特写或鞋头正对镜头。
   tmz2..tmz5 匹配该品类模板第2至5姿势；第5张必须白底。
   所有品类的 tmz2/wpz2 都必须是：前方一只完整鞋正常展示，后方另一只完整鞋的鞋底朝向镜头。
   禁止选择两只鞋同向、并排、悬空的图，也禁止鞋垫、单鞋、单独鞋底或局部特写。
   所有品类的 tmz3/wpz3 都必须是单只鞋竖立或悬立、鞋身近似纵向的姿势；
   必须展示鞋子的完整外侧轮廓，鞋头不能正对镜头；不能选择“鞋头朝镜头”的正面竖立图，
   也不能选择正常平放的侧视图、普通斜前方单鞋图，或复用 tmz1/wpz1、yq3。
   tmz4/wpz4 必须按品类区分：运动是后侧斜悬且鞋底朝镜头；休闲是完整后侧面；
   雪地是完整鞋口内里图：画面要同时看见鞋口绒毛/内里和鞋帮侧面，不能只裁到鞋面或鞋头；
   婴童是单鞋后侧角度。
   雪地第4姿势不能选择拉链、鞋帮外侧、普通侧面特写、鞋面/鞋头局部裁切图；
   婴童第4姿势不能误用 yq3 的完整外侧面。
2. wpz 共6张，wpz1..wpz4 与天猫前4张姿势相同；wpz5 与 tmz5 姿势相同但必须灰底；wpz6 必须是带款号和颜色标签的鞋盒图。
   tmz5/wpz5 都必须完整展示两只鞋，并严格匹配当前品类模板第5姿势；禁止鞋垫、单鞋、单独鞋底、局部特写或鞋盒。
3. o 是主推色必需的海报图：运动类固定复用 wpz2 的“前方一只鞋+后方一只鞋底朝镜头”姿势；休闲、雪地、婴童固定复用主推色 wpz5 的品类摆放姿势。程序会按品类强制覆盖，非主推色不输出 o.jpg。
   wpz5 必须是该品类模板第5姿势的灰底版本，不能误用白底副本。
4. yq 必须且只能返回3张，按第四张参考模板从左到右依次匹配：斜前方鞋+后方鞋底、完整鞋底平铺、完整外侧面。不要把 AI 角度图、颜色图或其他展示图放进 yq。
5. yk 不用选择，程序会合并主推色云盘中的 1.jpg..N.jpg 和主推色云盘中已经命名为 yk1..ykN 的细节图；细节有几张就输出几张，非主推色不输出 yk。
   雪地款缺少独立 yk 细节图时，程序会优先复用未占用的鞋口内里细节原图；若没有独立细节图，会从正确的雪地第4姿势鞋口内里图裁切生成 yk1。
   yx 只允许选择“鞋子主体与一张或多张功能吊牌/功能卡同框”的完整展示图。
   单独鞋垫、单独吊牌、鞋盒、普通鞋子图或局部特写都不是 yx；找不到合格图片必须返回空字符串。
6. tms 不用选择，程序会按“12位款号-5位色码”文件名确定。
7. 同一编号可以在姿势完全相同的不同槽位复用。

候选编号：
{candidate_text}

返回格式：
{{"color_name":"包含中文颜色和5位色码的名称","shoe_category":"运动|休闲|雪地|婴童","slots":{{"tmz1":"I01","tmz2":"I02","tmz3":"I03","tmz4":"I04","tmz5":"I05","o":"I06","wpz":["I01","I02","I03","I04","I07","I08"],"yq":["I09","I10","I11"],"yk":[],"yx":""}}}}"""


def _create_contact_sheet(
    entries: list[dict[str, Any]],
    target: Path,
    *,
    start_index: int = 1,
) -> dict[str, str]:
    from PIL import Image, ImageDraw, ImageFont, ImageOps

    tile_width = 300
    image_height = 225
    label_height = 30
    columns = 4
    rows = (len(entries) + columns - 1) // columns
    sheet = Image.new("RGB", (tile_width * columns, (image_height + label_height) * rows), "white")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    candidate_ids: dict[str, str] = {}

    for offset, entry in enumerate(entries):
        index = start_index + offset
        candidate_id = f"I{index:02d}"
        filename = _text(entry.get("filename"))
        candidate_ids[candidate_id] = filename
        source = Path(entry["path"])
        with Image.open(source) as opened:
            image = _image_rgb_on_white(ImageOps.exif_transpose(opened))
            image.thumbnail((tile_width - 12, image_height - 12), Image.Resampling.LANCZOS)
            left = (offset % columns) * tile_width
            top = (offset // columns) * (image_height + label_height)
            x = left + (tile_width - image.width) // 2
            y = top + (image_height - image.height) // 2
            sheet.paste(image, (x, y))
        label = f"{candidate_id} {filename}"
        draw.rectangle(
            (left, top + image_height, left + tile_width, top + image_height + label_height),
            fill=(245, 245, 245),
        )
        draw.text((left + 5, top + image_height + 6), label[:36], fill="black", font=font)

    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target, format="JPEG", quality=72, optimize=True)
    return candidate_ids


def _create_contact_sheets(
    entries: list[dict[str, Any]],
    target: Path,
) -> tuple[list[Path], dict[str, str]]:
    sheets: list[Path] = []
    candidate_ids: dict[str, str] = {}
    chunk_size = 12
    for chunk_index, start in enumerate(range(0, len(entries), chunk_size), start=1):
        chunk = entries[start:start + chunk_size]
        chunk_target = target.with_name(f"{target.stem}-{chunk_index}{target.suffix}")
        candidate_ids.update(
            _create_contact_sheet(
                chunk,
                chunk_target,
                start_index=start + 1,
            )
        )
        sheets.append(chunk_target)
    return sheets, candidate_ids


def _default_analyze_color(**kwargs) -> dict[str, Any]:
    candidate_ids = kwargs["candidate_ids"]
    contact_sheets = kwargs.get("contact_sheets") or [kwargs["contact_sheet"]]
    model_id = _text(kwargs.get("model_id")) or SHOE_POSE_DEFAULT_MODEL
    model_ids = _shoe_pose_model_ids(model_id)
    errors: list[str] = []
    user_prompt = _shoe_selection_prompt(
        kwargs["style_code"],
        kwargs["color_code"],
        candidate_ids,
        kwargs.get("shoe_category") or "",
        candidate_sheet_count=len(contact_sheets),
    )
    image_inputs = [
        *contact_sheets,
        kwargs["reference_image"],
        kwargs.get("pose1_reference_image") or str(SHOE_POSE1_REFERENCE_IMAGE),
        kwargs["yq_reference_image"],
    ]
    candidate_names = set(candidate_ids.values())

    for current_model_id in model_ids:
        try:
            payload, route = llm_gateway.generate_multimodal_json(
                system_prompt=SHOE_SELECTION_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                image_inputs=image_inputs,
                model_id=current_model_id,
                fallback_model_ids=(
                    []
                    if len(model_ids) > 1
                    else _qwen_fallback_model_ids(current_model_id)
                ),
                config=kwargs.get("config"),
            )
            if not isinstance(payload, dict):
                raise llm_gateway.LlmResponseError("鞋品姿势识别未返回 JSON 对象")
            slots = payload.get("slots")
            if not isinstance(slots, dict):
                raise llm_gateway.LlmResponseError("鞋品姿势识别缺少 slots")
            missing = []
            for key, value in slots.items():
                values = value if isinstance(value, list) else [value]
                for item in values:
                    resolved = _resolve_candidate_value(item, candidate_ids)
                    if (
                        resolved
                        and candidate_names
                        and resolved not in candidate_names
                    ):
                        missing.append(f"{key}={resolved}")
            if missing:
                raise llm_gateway.LlmResponseError(
                    "识别结果引用了不存在的候选图：" + "、".join(missing[:5])
                )
            payload["_model_id"] = route.model_id
            if errors:
                payload["_model_attempt_warnings"] = "；".join(errors[:5])
            return payload
        except llm_gateway.LlmGatewayError as exc:
            errors.append(f"{current_model_id}: {exc}")

    raise ShoeSelectionError(
        "鞋品姿势识别多模型均失败："
        + "；".join(errors[:8])
    )


def _create_label_preview(source: Path, target: Path) -> None:
    from PIL import Image, ImageOps

    with Image.open(source) as opened:
        image = _image_rgb_on_white(ImageOps.exif_transpose(opened))
        image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(target, format="JPEG", quality=82, optimize=True)


def _default_analyze_color_label(**kwargs) -> dict[str, Any]:
    color_code = kwargs["color_code"]
    # Keep label OCR stable while allowing the operator to benchmark different
    # multimodal models for the much harder pose-selection task.
    model_id = SHOE_LABEL_OCR_MODEL
    payload, _route = llm_gateway.generate_multimodal_json(
        system_prompt=(
            "你是鞋盒标签 OCR 审核员。只读取图片中实际印刷的标签文字，不根据鞋子外观猜颜色。"
            "只返回 JSON，不要 Markdown。"
        ),
        user_prompt=(
            f"这是款号 {kwargs['style_code']}、色码 {color_code} 的鞋盒标签图。"
            "请读取产品名称和完整颜色名称。颜色名称必须以图片标签为准，并保留5位色码。"
            '返回：{"product_name":"...","color_name":"...","color_code":"5位色码"}'
            "，并返回整张图中鞋盒白色标签和完整12位款号文字的归一化坐标。"
            "style_code_bbox 必须紧贴完整12位款号文本本身，不包含“产品货号/款号”等字段名；"
            "如果边界不确定，宁可略宽也不能漏掉任意一位数字。"
            '"label_bbox":[x1,y1,x2,y2],"style_code_bbox":[x1,y1,x2,y2]，'
            "坐标范围0到1000。"
        ),
        image_inputs=[kwargs["label_image"]],
        model_id=model_id,
        fallback_model_ids=_qwen_fallback_model_ids(model_id),
        config=kwargs.get("config"),
    )
    if not isinstance(payload, dict):
        raise ShoeSelectionError("鞋盒标签 OCR 未返回 JSON 对象")
    return payload


def _resolve_candidate_value(value: Any, candidate_ids: dict[str, str]) -> str:
    text = _text(value)
    return candidate_ids.get(text, text)


def _resolve_selection_payload(
    payload: dict[str, Any],
    candidate_ids: dict[str, str],
) -> tuple[str, str, dict[str, Any]]:
    color_name = _text(payload.get("color_name"))
    category = _text(payload.get("shoe_category"))
    slots = payload.get("slots")
    if not isinstance(slots, dict):
        raise ShoeSelectionError("鞋品姿势识别结果缺少 slots")

    resolved: dict[str, Any] = {"_model_id": _text(payload.get("_model_id"))}
    for key, value in slots.items():
        if isinstance(value, list):
            resolved[key] = [
                _resolve_candidate_value(item, candidate_ids)
                for item in value
                if _resolve_candidate_value(item, candidate_ids)
            ]
        else:
            resolved[key] = _resolve_candidate_value(value, candidate_ids)
    return color_name, category, resolved


def _natural_slot_index(filename: str, prefix: str) -> tuple[int, str]:
    match = re.search(
        rf"^{re.escape(prefix)}\s*(?:[\(（]\s*)?(\d+)",
        Path(filename).stem,
        flags=re.IGNORECASE,
    )
    return (int(match.group(1)) if match else 9999, filename.lower())


def _apply_o_category_rule(category: str, slots: dict[str, Any]) -> dict[str, Any]:
    ruled = dict(slots)
    wpz = _selection_list(ruled, "wpz")
    if len(wpz) < 5:
        raise ShoeSelectionError("缺少 wpz2/wpz5，无法按品类设置 o.jpg")
    ruled["o"] = wpz[1] if _text(category) == "运动" else wpz[4]
    return ruled


def _resolve_label_color_name(
    *,
    current_color_name: str,
    color_code: str,
    label_payload: dict[str, Any],
) -> tuple[str, str]:
    label_color_name = _text(label_payload.get("color_name"))
    if label_color_name:
        resolved = (
            label_color_name
            if color_code in label_color_name
            else f"{label_color_name}{color_code}"
        )
        return resolved, ""
    fallback = _text(current_color_name) or color_code
    if color_code not in fallback:
        fallback = f"{fallback}{color_code}"
    return fallback, "鞋盒标签 OCR 未识别到颜色名称，已沿用姿势识别颜色名"


def _create_ai_channel_assets(
    *,
    source: Path | str,
    package_root: Path | str,
    color_name: str,
) -> dict[str, Path]:
    source = Path(source)
    package_root = Path(package_root)
    package_root.mkdir(parents=True, exist_ok=True)
    safe_color_name = _safe_path_component(color_name)
    outputs = {
        "wpt30": package_root / f"wpt30.{safe_color_name}.png",
        "jdt_png": package_root / f"jdt.{safe_color_name}.png",
    }
    shutil.copy2(source, outputs["wpt30"])
    shutil.copy2(source, outputs["jdt_png"])
    return outputs


def _normalized_bbox(value: Any) -> tuple[float, float, float, float] | None:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    try:
        values = tuple(max(0.0, min(1000.0, float(item))) / 1000.0 for item in value)
    except (TypeError, ValueError):
        return None
    if values[2] <= values[0] or values[3] <= values[1]:
        return None
    return values


def _create_tmq_asset(
    *,
    source: Path | str,
    target: Path | str,
    label_bbox: Any = None,
    style_code_bbox: Any = None,
    style_code: str = "",
    require_style_code_bbox: bool = False,
) -> Path:
    from PIL import Image, ImageDraw, ImageOps

    source = Path(source)
    target = Path(target)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", Image.DecompressionBombWarning)
        with Image.open(source) as opened:
            image = _image_rgb_on_white(ImageOps.exif_transpose(opened))
    width, height = image.size
    style = _normalized_bbox(style_code_bbox)
    if require_style_code_bbox and style is None:
        raise ShoeSelectionError("鞋盒标签 OCR 未返回款号文字坐标，无法生成 tmq.jpg")

    label = _normalized_bbox(label_bbox)
    if label is None and style is not None:
        style_x1, style_y1, style_x2, style_y2 = style
        style_width = style_x2 - style_x1
        style_height = style_y2 - style_y1
        label = (
            max(0.0, style_x1 - style_width * 1.3),
            max(0.0, style_y1 - style_height * 5.0),
            min(1.0, style_x2 + style_width * 3.2),
            min(1.0, style_y2 + style_height * 8.0),
        )
    if label is None:
        label = (0.50, 0.31, 0.79, 0.57)
    style = ocr_service.refine_style_code_bbox(
        image=image,
        label_bbox=label,
        style_code_bbox=style,
        style_code=style_code,
    )
    label_px = (
        label[0] * width,
        label[1] * height,
        label[2] * width,
        label[3] * height,
    )
    label_width = label_px[2] - label_px[0]
    label_height = label_px[3] - label_px[1]
    side = max(label_width * 1.12, label_height * 1.55)
    side = min(side, width, height)
    center_x = (label_px[0] + label_px[2]) / 2
    center_y = (label_px[1] + label_px[3]) / 2
    left = max(0.0, min(width - side, center_x - side / 2))
    top = max(0.0, min(height - side, center_y - side / 2))
    crop = image.crop((round(left), round(top), round(left + side), round(top + side)))
    crop = crop.resize((460, 460), Image.Resampling.LANCZOS)

    label_x1, label_y1, label_x2, label_y2 = label
    if style is not None:
        style_width_px = (style[2] - style[0]) * width
        style_height_px = (style[3] - style[1]) * height
        # OCR often returns a tight text box and may clip the final digit by a
        # few pixels. Keep the box anchored to the recognized text while sizing
        # it for a full 12-digit style code.
        min_width_px = style_height_px * max(5.5, min(len(_text(style_code)) * 0.58, 8.8))
        if style_width_px < min_width_px:
            center = (style[0] + style[2]) / 2
            half_width = (min_width_px / width) / 2
            style = (
                max(label_x1, center - half_width),
                style[1],
                min(label_x2, center + half_width),
                style[3],
            )
    else:
        style = (
            label_x1 + (label_x2 - label_x1) * 0.24,
            label_y1 + (label_y2 - label_y1) * 0.00,
            label_x1 + (label_x2 - label_x1) * 0.90,
            label_y1 + (label_y2 - label_y1) * 0.22,
        )
    draw = ImageDraw.Draw(crop)
    scale = 460 / side
    style_height_on_crop = max(1.0, (style[3] - style[1]) * height * scale)
    pad_left = max(3, round(style_height_on_crop * 0.22))
    pad_right = max(4, round(style_height_on_crop * 0.32))
    pad_y = max(3, round(style_height_on_crop * 0.30))
    rectangle = (
        max(0, round((style[0] * width - left) * scale) - pad_left),
        max(0, round((style[1] * height - top) * scale) - pad_y),
        min(460, round((style[2] * width - left) * scale) + pad_right),
        min(460, round((style[3] * height - top) * scale) + pad_y),
    )
    draw.rectangle(rectangle, outline=(255, 0, 0), width=3)
    target.parent.mkdir(parents=True, exist_ok=True)
    crop.save(target, format="JPEG", quality=95, optimize=True)
    return target


def _validate_selection_sources(
    style_code: str,
    color_name: str,
    slots: dict[str, Any],
    entries_by_name: dict[str, dict[str, Any]],
) -> None:
    missing = []
    for key, value in slots.items():
        if str(key).startswith("_"):
            continue
        values = value if isinstance(value, list) else [value]
        for filename in values:
            if _text(filename) and _text(filename) not in entries_by_name:
                missing.append(f"{key}={filename}")
    if missing:
        raise ShoeSelectionError(
            f"{style_code} {color_name} 识别结果引用了不存在的候选图：{', '.join(missing[:5])}"
        )

    required = ["tms", "o", *[f"tmz{index}" for index in range(1, 6)]]
    absent = [key for key in required if not _text(slots.get(key))]
    if len(_selection_list(slots, "wpz")) < 6:
        absent.append("wpz1..6")
    if len(_selection_list(slots, "yq")) != 3:
        absent.append("yq1..3")
    if absent:
        raise ShoeSelectionError(
            f"{style_code} {color_name} 缺少必需槽位：{', '.join(absent)}"
        )


def _copy_as_jpeg(
    source: Path,
    target: Path,
    *,
    background_rgb: tuple[int, int, int] | None = None,
) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    target_suffix = target.suffix.lower()
    source_suffix = source.suffix.lower()
    if background_rgb is None and target_suffix == ".png" and source_suffix == ".png":
        shutil.copy2(source, target)
        return
    if (
        background_rgb is None
        and target_suffix in {".jpg", ".jpeg"}
        and source_suffix in {".jpg", ".jpeg"}
    ):
        shutil.copy2(source, target)
        return
    from PIL import Image, ImageOps

    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened)
        if target_suffix == ".png":
            image.save(target, format="PNG")
        else:
            background = background_rgb or (255, 255, 255)
            _image_rgb_on_background(
                image,
                background,
                replace_opaque_background=background_rgb is not None,
            ).save(
                target,
                format="JPEG",
                quality=95,
                optimize=True,
            )


def prepare_shoe_packages(
    *,
    data_rows: list[dict[str, Any]],
    output_root: Path | str,
    model_id: str = SHOE_POSE_DEFAULT_MODEL,
    shoe_categories: dict[str, str] | None = None,
    config: dict | None = None,
    analyze_color=None,
    analyze_color_label=None,
    reference_image: Path | str = SHOE_REFERENCE_IMAGE,
    pose1_reference_image: Path | str = SHOE_POSE1_REFERENCE_IMAGE,
    yq_reference_image: Path | str = SHOE_YQ_REFERENCE_IMAGE,
    log=lambda _message: None,
    progress=None,
) -> tuple[list[dict[str, Any]], dict[str, Path]]:
    """Analyze downloaded shoe images, copy selected slots, and build report rows."""

    output_root = Path(output_root)
    reference_image = Path(reference_image)
    pose1_reference_image = Path(pose1_reference_image)
    yq_reference_image = Path(yq_reference_image)
    if not reference_image.is_file():
        raise ShoeSelectionError(f"鞋品主图参考模板不存在：{reference_image}")
    if not pose1_reference_image.is_file():
        raise ShoeSelectionError(f"鞋品主图1参考模板不存在：{pose1_reference_image}")
    if not yq_reference_image.is_file():
        raise ShoeSelectionError(f"鞋品 yq 参考模板不存在：{yq_reference_image}")

    grouped: dict[str, dict[str, list[dict[str, Any]]]] = {}
    uncolored_originals_by_style: dict[str, list[dict[str, Any]]] = {}
    for row in data_rows or []:
        if not isinstance(row, dict) or _text(row.get("下载结果")) != "已下载":
            continue
        local_path = Path(_text(row.get("本地文件"))).expanduser()
        if not local_path.is_file():
            continue
        style_code = _text(row.get("输入款号") or row.get("__shenhui_group_code"))
        color_code = _text(row.get("__shoe_color_code") or row.get("颜色"))
        filename = _text(row.get("__shoe_original_filename") or row.get("原文件名") or local_path.name)
        if not style_code or not filename:
            continue
        if _is_junk_shoe_asset_filename(filename, _text(row.get("云盘路径"))):
            continue
        entry = {
            "path": local_path,
            "filename": filename,
            "row": row,
        }
        if not color_code:
            uncolored_originals_by_style.setdefault(style_code, []).append(entry)
            continue
        grouped.setdefault(style_code, {}).setdefault(color_code, []).append(entry)
    if not grouped:
        raise ShoeSelectionError("没有可用于鞋品选图的已下载图片")

    organize_total = sum(len(colors) for colors in grouped.values())
    organize_completed = 0

    def report_progress(
        stage: str,
        *,
        style_code: str = "",
        color_code: str = "",
        active: bool = True,
    ) -> None:
        if progress is None:
            return
        progress({
            "organize_total": organize_total,
            "organize_completed": organize_completed,
            "organize_active": active,
            "organize_current_style": style_code,
            "organize_current_color": color_code,
            "organize_stage": stage,
        })

    report_progress("准备整理")
    analyzer = analyze_color or _default_analyze_color
    label_analyzer = analyze_color_label
    if label_analyzer is None and analyze_color is None:
        label_analyzer = _default_analyze_color_label
    report_rows: list[dict[str, Any]] = []
    package_roots: dict[str, Path] = {}
    analysis_root = output_root / "_shoe_analysis"

    for style_code, colors in grouped.items():
        forced_category = (shoe_categories or {}).get(style_code, "")
        selections_by_color: dict[str, dict[str, Any]] = {}
        entries_by_color_name: dict[str, dict[str, dict[str, Any]]] = {}
        original_entries_by_color_name: dict[str, list[dict[str, Any]]] = {}
        color_order: list[str] = []
        category_warning = ""
        anchor_slots: dict[str, Any] | None = None
        anchor_selection_entries: list[dict[str, Any]] = []
        anchor_category = ""

        for color_code, entries in colors.items():
            entries, size_warning = _filter_single_shoe_size_entries(entries)
            if size_warning:
                log(f"[warn] {style_code}-{color_code} {size_warning}")
            report_progress(
                "识别姿势",
                style_code=style_code,
                color_code=color_code,
            )
            entries_by_name = {
                entry["filename"]: entry
                for entry in entries
            }
            pose_matching_entries = [
                entry
                for entry in entries
                if _is_pose_matching_candidate(entry["filename"])
            ]
            selection_entries = [
                entry
                for entry in pose_matching_entries
                if _is_pose_selection_candidate(entry["filename"])
            ]
            if not selection_entries:
                raise ShoeSelectionError(
                    f"{style_code}-{color_code} 没有可用于鞋品姿势识别的候选图片"
                )
            candidate_ids: dict[str, str] = {}
            used_local_match = anchor_slots is not None
            if used_local_match:
                target_match_entries = (
                    _entries_with_ai_angle_images(pose_matching_entries, entries)
                    if _text(anchor_category) == "雪地"
                    else pose_matching_entries
                )
                matched_slots, worst_distance = _match_slots_from_anchor_color(
                    anchor_slots=anchor_slots,
                    anchor_entries=anchor_selection_entries,
                    target_entries=target_match_entries,
                )
                if worst_distance <= SHOE_CROSS_COLOR_MAX_DISTANCE:
                    payload = {
                        "color_name": color_code,
                        "shoe_category": anchor_category,
                        "slots": matched_slots,
                        "_model_id": matched_slots.get("_model_id"),
                    }
                    log(
                        f"鞋品跨色姿势匹配：{style_code}-{color_code}，"
                        f"复用基准色姿势，最大轮廓差 {worst_distance:.3f}"
                    )
                else:
                    used_local_match = False
                    log(
                        f"[warn] {style_code}-{color_code} 跨色轮廓差 "
                        f"{worst_distance:.3f} 超过 {SHOE_CROSS_COLOR_MAX_DISTANCE:.2f}，"
                        "改用大模型单独识别"
                    )

            if not used_local_match:
                contact_sheet = analysis_root / style_code / f"{color_code}.jpg"
                contact_sheets, candidate_ids = _create_contact_sheets(
                    selection_entries,
                    contact_sheet,
                )
                log(
                    f"鞋品姿势识别：{style_code}-{color_code}，"
                    f"候选图 {len(selection_entries)} 张"
                )
                payload = analyzer(
                    style_code=style_code,
                    color_code=color_code,
                    contact_sheet=str(contact_sheets[0]),
                    contact_sheets=[str(path) for path in contact_sheets],
                    reference_image=str(reference_image),
                    pose1_reference_image=str(pose1_reference_image),
                    yq_reference_image=str(yq_reference_image),
                    candidate_ids=candidate_ids,
                    candidate_names=[
                        entry["filename"]
                        for entry in selection_entries
                    ],
                    shoe_category=forced_category,
                    model_id=model_id,
                    config=config,
                )
            if not isinstance(payload, dict):
                raise ShoeSelectionError(f"{style_code}-{color_code} 识别结果不是对象")
            color_name, model_category, slots = _resolve_selection_payload(payload, candidate_ids)
            category, category_source, current_category_warning = resolve_style_category(
                style_code,
                model_category,
                shoe_categories,
            )
            if current_category_warning and not category_warning:
                category_warning = current_category_warning
            if not color_name:
                color_name = color_code
            if color_code not in color_name:
                color_name = f"{color_name}{color_code}"

            exact_tms = next(
                (
                    filename
                    for filename in entries_by_name
                    if Path(filename).stem.lower() == f"{style_code}-{color_code}".lower()
                ),
                "",
            )
            if exact_tms:
                slots["tms"] = exact_tms

            yk_sources = sorted(
                (
                    filename
                    for filename in entries_by_name
                    if _is_yk_source_filename(filename)
                ),
                key=_named_yk_sort_key,
            )
            slots["yk"] = yk_sources
            slots["yq"] = _selection_list(slots, "yq")[:3]

            named_yx = next(
                (
                    filename
                    for filename in entries_by_name
                    if re.match(r"^yx(?:\b|[\s_\-(（])", Path(filename).stem, re.IGNORECASE)
                ),
                "",
            )
            if named_yx:
                slots["yx"] = named_yx

            quality_rule_entries = list(selection_entries)
            if _text(category) == "雪地":
                quality_rule_entries = _entries_with_ai_angle_images(
                    quality_rule_entries,
                    entries,
                )
            pose_entries_by_name = {
                entry["filename"]: entry
                for entry in quality_rule_entries
            }
            outsole_entries_by_name = {
                entry["filename"]: entry
                for entry in pose_matching_entries
            }
            slots, quality_corrections = _apply_selection_quality_rules(
                category,
                slots,
                pose_entries_by_name,
                outsole_entries_by_name=outsole_entries_by_name,
            )
            for correction in quality_corrections:
                log(f"鞋品确定性校验：{style_code}-{color_code}，{correction}")
            slots = _apply_o_category_rule(category, slots)

            if _text(category) == "雪地":
                slots, yk_fallback = _ensure_snow_detail_yk(
                    style_code=style_code,
                    color_code=color_code,
                    slots=slots,
                    entries_by_name=entries_by_name,
                    analysis_root=analysis_root,
                )
                if yk_fallback:
                    log(
                        "鞋品确定性校验："
                        f"{style_code}-{color_code}，{yk_fallback}"
                    )

            _validate_selection_sources(style_code, color_name, slots, entries_by_name)
            if anchor_slots is None:
                anchor_slots = dict(slots)
                anchor_selection_entries = list(quality_rule_entries)
                anchor_category = category
            if label_analyzer:
                wpz_sources = _selection_list(slots, "wpz")
                box_source = entries_by_name[wpz_sources[5]]
                label_image = analysis_root / style_code / f"{color_code}-label.jpg"
                _create_label_preview(Path(box_source["path"]), label_image)
                log(f"鞋盒标签 OCR：{style_code}-{color_code}")
                label_payload = label_analyzer(
                    style_code=style_code,
                    color_code=color_code,
                    label_image=str(label_image),
                    model_id=model_id,
                    config=config,
                )
                if not isinstance(label_payload, dict):
                    raise ShoeSelectionError(f"{style_code}-{color_code} 鞋盒标签 OCR 结果不是对象")
                read_color_code = _text(label_payload.get("color_code"))
                if read_color_code and read_color_code != color_code:
                    raise ShoeSelectionError(
                        f"{style_code}-{color_code} 鞋盒标签 OCR 色码不一致：{read_color_code}"
                    )
                color_name, label_warning = _resolve_label_color_name(
                    current_color_name=color_name,
                    color_code=color_code,
                    label_payload=label_payload,
                )
                if label_warning:
                    slots["_label_warning"] = label_warning
                    log(f"[warn] {style_code}-{color_code} {label_warning}")
                slots["product_name"] = _text(label_payload.get("product_name"))
                slots["label_bbox"] = label_payload.get("label_bbox")
                slots["style_code_bbox"] = label_payload.get("style_code_bbox")

            slots["shoe_category"] = category
            slots["shoe_category_source"] = category_source
            selections_by_color[color_name] = slots
            entries_by_color_name[color_name] = entries_by_name
            original_entries_by_color_name[color_name] = entries
            color_order.append(color_name)
            log(
                f"鞋品姿势识别完成：{style_code}-{color_name}，"
                f"品类 {category or '未返回'}（{category_source}），"
                f"模型 {slots.get('_model_id') or model_id}"
            )

        output_color_order = _promoted_color_first(selections_by_color, color_order)
        assignments, warnings = build_output_assignments(
            selections_by_color,
            output_color_order,
        )
        warnings.extend(
            {
                "color": color_name,
                "slot": "鞋盒OCR",
                "warning": _text(slots.get("_label_warning")),
            }
            for color_name, slots in selections_by_color.items()
            if _text(slots.get("_label_warning"))
        )
        package_root = output_root / style_code
        package_roots[style_code] = package_root

        report_progress(
            "生成命名计划",
            style_code=style_code,
            color_code=output_color_order[0] if output_color_order else "",
        )
        for assignment in assignments:
            color_name = assignment["color"]
            source_name = assignment["source"]
            entry = entries_by_color_name[color_name][source_name]
            target = package_root / assignment["output_path"]
            selected_category = _text(
                selections_by_color[color_name].get("shoe_category")
            )
            background_rgb = (
                SHOE_GRAY_BACKGROUND_RGB
                if selected_category == "雪地"
                and assignment["slot"] in {"tmz4", "wpz4"}
                else None
            )
            _copy_as_jpeg(
                Path(entry["path"]),
                target,
                background_rgb=background_rgb,
            )
            source_row = entry["row"]
            report_rows.append({
                "输入款号": style_code,
                "颜色": color_name,
                "原文件名": source_name,
                "云盘路径": _text(source_row.get("云盘路径")),
                "规则槽位": assignment["slot"],
                "输出文件名": assignment["output_path"],
                "处理动作": "已选图并按鞋品规则命名",
                "下载结果": "已下载",
                "本地文件": str(target),
                "规则告警": "",
                "品类来源": selections_by_color[color_name].get("shoe_category_source") or "",
                "备注": (
                    f"品类：{selections_by_color[color_name].get('shoe_category') or '未返回'}；"
                    f"模型：{selections_by_color[color_name].get('_model_id') or model_id}"
                ),
            })

        for color_index, color_name in enumerate(output_color_order, start=1):
            report_progress(
                "复制命名",
                style_code=style_code,
                color_code=color_name,
            )
            folder = package_root / f"{color_index}.{_safe_path_component(color_name)}"
            entries_by_name = entries_by_color_name[color_name]
            original_entries = original_entries_by_color_name[color_name]
            original_targets = _original_asset_relative_targets(original_entries)
            for entry, relative_target in zip(original_entries, original_targets):
                filename = entry["filename"]
                if (
                    _is_reserved_shoe_output_filename(filename)
                    or (
                        color_index == 1
                        and _bare_yk_index(filename) is not None
                    )
                ):
                    continue
                target = folder / relative_target
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(Path(entry["path"]), target)
                source_row = entry["row"]
                report_rows.append({
                    "输入款号": style_code,
                    "颜色": color_name,
                    "原文件名": filename,
                    "云盘路径": _text(source_row.get("云盘路径")),
                    "规则槽位": "原始素材",
                    "输出文件名": str(target.relative_to(package_root)),
                    "处理动作": "保留网盘全部原始图片",
                    "下载结果": "已下载",
                    "本地文件": str(target),
                    "规则告警": "",
                    "品类来源": selections_by_color[color_name].get("shoe_category_source") or "",
                    "备注": "",
                })

            angle_entry = next(
                (
                    entry
                    for filename, entry in entries_by_name.items()
                    if re.search(r"\+Ai角度图1(?:\.[^.]+)$", filename, flags=re.IGNORECASE)
                ),
                None,
            )
            if not angle_entry:
                raise ShoeSelectionError(f"{style_code} {color_name} 缺少 Ai角度图1，无法生成 jdt/wpt30")
            channel_outputs = _create_ai_channel_assets(
                source=Path(angle_entry["path"]),
                package_root=package_root,
                color_name=color_name,
            )
            for slot, target in channel_outputs.items():
                report_rows.append({
                    "输入款号": style_code,
                    "颜色": color_name,
                    "原文件名": angle_entry["filename"],
                    "云盘路径": _text(angle_entry["row"].get("云盘路径")),
                    "规则槽位": "jdt" if slot.startswith("jdt") else "wpt30",
                    "输出文件名": target.name,
                    "处理动作": "由 Ai角度图1 生成渠道图",
                    "下载结果": "已下载",
                    "本地文件": str(target),
                    "规则告警": "",
                    "品类来源": selections_by_color[color_name].get("shoe_category_source") or "",
                    "备注": "保持 Ai角度图1 原始尺寸和比例；PNG 为原文件字节复制",
                })

            if color_index == 1:
                tmt_target = package_root / "tmt.png"
                shutil.copy2(channel_outputs["jdt_png"], tmt_target)
                report_rows.append({
                    "输入款号": style_code,
                    "颜色": color_name,
                    "原文件名": angle_entry["filename"],
                    "云盘路径": _text(angle_entry["row"].get("云盘路径")),
                    "规则槽位": "tmt",
                    "输出文件名": tmt_target.name,
                    "处理动作": "首色 jdt.png 复用为 tmt.png",
                    "下载结果": "已下载",
                    "本地文件": str(tmt_target),
                    "规则告警": "",
                    "品类来源": selections_by_color[color_name].get("shoe_category_source") or "",
                    "备注": "保持 Ai角度图1 原始尺寸和比例",
                })
                wpz_sources = _selection_list(selections_by_color[color_name], "wpz")
                box_entry = entries_by_name[wpz_sources[5]]
                tmq_target = _create_tmq_asset(
                    source=Path(box_entry["path"]),
                    target=package_root / "tmq.jpg",
                    label_bbox=selections_by_color[color_name].get("label_bbox"),
                    style_code_bbox=selections_by_color[color_name].get("style_code_bbox"),
                    style_code=style_code,
                    require_style_code_bbox=bool(label_analyzer),
                )
                report_rows.append({
                    "输入款号": style_code,
                    "颜色": color_name,
                    "原文件名": box_entry["filename"],
                    "云盘路径": _text(box_entry["row"].get("云盘路径")),
                    "规则槽位": "tmq",
                    "输出文件名": tmq_target.name,
                    "处理动作": "鞋盒标签裁切并框选款号",
                    "下载结果": "已下载",
                    "本地文件": str(tmq_target),
                    "规则告警": "",
                    "品类来源": selections_by_color[color_name].get("shoe_category_source") or "",
                    "备注": "460x460",
                })
            organize_completed += 1
            report_progress(
                "款色完成",
                style_code=style_code,
                color_code=color_name,
            )

        uncolored_originals = uncolored_originals_by_style.get(style_code, [])
        uncolored_targets = _original_asset_relative_targets(uncolored_originals)
        for entry, relative_target in zip(uncolored_originals, uncolored_targets):
            target = package_root / "原图" / relative_target
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(Path(entry["path"]), target)
            source_row = entry["row"]
            report_rows.append({
                "输入款号": style_code,
                "颜色": "",
                "原文件名": entry["filename"],
                "云盘路径": _text(source_row.get("云盘路径")),
                "规则槽位": "原始素材",
                "输出文件名": str(target.relative_to(package_root)),
                "处理动作": "保留网盘全部原始图片",
                "下载结果": "已下载",
                "本地文件": str(target),
                "规则告警": "",
                "品类来源": selections_by_color[color_order[0]].get("shoe_category_source") or "",
                "备注": "原网盘文件未标注色号，保留在款号根目录的原图文件夹",
            })

        for warning in warnings:
            report_rows.append({
                "输入款号": style_code,
                "颜色": warning["color"],
                "原文件名": "",
                "云盘路径": "",
                "规则槽位": warning.get("slot") or "yx",
                "输出文件名": "",
                "处理动作": (
                    "允许缺少"
                    if (warning.get("slot") or "yx") == "yx"
                    else "已降级"
                ),
                "下载结果": "未找到",
                "本地文件": "",
                "规则告警": warning["warning"],
                "品类来源": selections_by_color[warning["color"]].get("shoe_category_source") or "",
                "备注": "",
            })

        if category_warning:
            report_rows.append({
                "输入款号": style_code,
                "颜色": "",
                "原文件名": "",
                "云盘路径": "",
                "规则槽位": "品类",
                "输出文件名": "",
                "处理动作": "模型兜底",
                "下载结果": "已完成",
                "本地文件": "",
                "规则告警": category_warning,
                "品类来源": "模型兜底",
                "备注": "",
            })

    if analysis_root.exists():
        shutil.rmtree(analysis_root, ignore_errors=True)
    report_progress("整理完成", active=False)
    return report_rows, package_roots
