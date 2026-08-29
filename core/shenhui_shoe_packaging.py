"""Shoe-specific selection and packaging for the DeepDraw new-arrival adapter."""

from __future__ import annotations

import json
import logging
import re
import shutil
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from core import llm_gateway, ocr_service, shenhui_shoe_rules


logger = logging.getLogger(__name__)


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
    "靴子": "休闲",
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
    if normalized == "tms":
        return "tms.jpg"
    if normalized == "yx":
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


def _select_tmz_same_color_first_with_slots(
    candidates_by_color: dict[str, dict[str, Any]],
    color_order: list[str] | None = None,
) -> list[tuple[int, str, str]]:
    """Select available Tmall slots from the promoted main color only."""

    order = [
        color
        for color in (color_order or list(candidates_by_color))
        if color in candidates_by_color
    ]
    order.extend(color for color in candidates_by_color if color not in order)
    if not order:
        raise ShoeSelectionError("未识别到鞋品颜色，无法生成 tmz 主图")

    base_color = order[0]
    selected: list[tuple[int, str, str]] = []
    for index in range(1, 6):
        slot = f"tmz{index}"
        base_value = _text((candidates_by_color.get(base_color) or {}).get(slot))
        if base_value:
            selected.append((index, base_color, base_value))
    return selected


def select_tmz_same_color_first(
    candidates_by_color: dict[str, dict[str, Any]],
    color_order: list[str] | None = None,
) -> list[tuple[str, str]]:
    """Select available Tmall slots from one main color."""

    return [
        (color, source)
        for _index, color, source in _select_tmz_same_color_first_with_slots(
            candidates_by_color,
            color_order,
        )
    ]


def _selection_indexed(
    slots: dict[str, Any],
    slot: str,
    max_count: int | None = None,
) -> list[tuple[int, str]]:
    direct = slots.get(slot)
    if isinstance(direct, list):
        return [
            (index, value_text)
            for index, value in enumerate(direct, start=1)
            if (max_count is None or index <= max_count)
            and (value_text := _text(value))
        ]
    values = []
    index = 1
    while True:
        key = f"{slot}{index}"
        if max_count is None and key not in slots:
            break
        if max_count is not None and index > max_count:
            break
        value = _text(slots.get(key))
        if value:
            values.append((index, value))
        index += 1
    return values


def _selection_list(slots: dict[str, Any], slot: str) -> list[str]:
    return [source for _index, source in _selection_indexed(slots, slot)]


def _selection_array(
    slots: dict[str, Any],
    slot: str,
    expected_count: int,
) -> list[str]:
    values = [""] * expected_count
    direct = slots.get(slot)
    if isinstance(direct, list):
        for index, value in enumerate(direct[:expected_count], start=1):
            values[index - 1] = _text(value)
        return values
    for index in range(1, expected_count + 1):
        values[index - 1] = _text(slots.get(f"{slot}{index}"))
    return values


def _slot_warning(
    *,
    color: str,
    slot: str,
    warning: str,
    output_path: str = "",
    action: str = "缺少源图已跳过",
    download_result: str = "未找到",
) -> dict[str, str]:
    return {
        "color": color,
        "slot": slot,
        "warning": warning,
        "output_path": output_path,
        "action": action,
        "download_result": download_result,
    }


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

    assignments: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []

    selected_tmz_indices: set[int] = set()
    for index, color, source in _select_tmz_same_color_first_with_slots(
        selections_by_color,
        order,
    ):
        selected_tmz_indices.add(index)
        assignments.append({
            "color": color,
            "slot": f"tmz{index}",
            "source": source,
            "output_path": output_filename("tmz", index),
        })
    for index in range(1, 6):
        if index not in selected_tmz_indices:
            warnings.append(_slot_warning(
                color=main_color,
                slot=f"tmz{index}",
                output_path=output_filename("tmz", index),
                warning=f"缺少 tmz{index} 对应姿势，已跳过 {output_filename('tmz', index)}",
            ))

    for color_index, color in enumerate(order, start=1):
        slots = selections_by_color.get(color) or {}
        folder = f"{color_index}.{_safe_path_component(color)}"

        for slot in ("tms",):
            source = _text(slots.get(slot))
            if not source:
                warnings.append(_slot_warning(
                    color=color,
                    slot=slot,
                    output_path=f"{folder}/tms.jpg",
                    warning=f"{color} 缺少 tms.jpg，已跳过该输出图",
                ))
                continue
            assignments.append({
                "color": color,
                "slot": slot,
                "source": source,
                "output_path": f"{folder}/{output_filename(slot, source_filename=source)}",
            })

        if color == main_color:
            source = _text(slots.get("o"))
            if not source:
                warnings.append(_slot_warning(
                    color=color,
                    slot="o",
                    output_path=f"{folder}/{output_filename('o')}",
                    warning=f"{color} 缺少 o.jpg 海报姿势，已跳过该输出图",
                ))
            else:
                assignments.append({
                    "color": color,
                    "slot": "o",
                    "source": source,
                    "output_path": f"{folder}/{output_filename('o')}",
                })

        for slot, expected_count in (("wpz", 6), ("yq", 3)):
            indexed_sources = _selection_indexed(slots, slot, expected_count)
            selected_indices = {index for index, _source in indexed_sources}
            for index, source in indexed_sources:
                assignments.append({
                    "color": color,
                    "slot": f"{slot}{index}",
                    "source": source,
                    "output_path": f"{folder}/{output_filename(slot, index)}",
                })
            for index in range(1, expected_count + 1):
                if index not in selected_indices:
                    output_path = f"{folder}/{output_filename(slot, index)}"
                    warnings.append(_slot_warning(
                        color=color,
                        slot=f"{slot}{index}",
                        output_path=output_path,
                        warning=f"{color} 缺少 {slot}{index} 源图，已跳过 {output_path}",
                    ))

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
            warnings.append(_slot_warning(
                color=color,
                slot="yx",
                warning="允许缺少 yx.jpg：未识别到功能吊牌图",
                action="允许缺少",
            ))

    return assignments, warnings


SHOE_REFERENCE_IMAGE = (
    Path(__file__).resolve().parents[1]
    / "adapters"
    / "shenhui-new-arrival"
    / "assets"
    / "shoe-main-image-template-small.jpg"
)
SHOE_POSTER_REFERENCE_IMAGE = (
    Path(__file__).resolve().parents[1]
    / "adapters"
    / "shenhui-new-arrival"
    / "assets"
    / "shoe-poster-template.jpg"
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
SHOE_MAIN_TEMPLATE_CATEGORY_ORDER: tuple[str, ...] = (
    "雪地",
    "运动",
    "婴童",
    "休闲",
)
SHOE_MAIN_TEMPLATE_CATEGORY_SLUGS: dict[str, str] = {
    "雪地": "snow",
    "运动": "sports",
    "婴童": "baby",
    "休闲": "leisure",
}
SHOE_POSE_MULTI_MODEL_ID = "multi-model"
SHOE_LABEL_OCR_MODEL = "gpt-5.6-sol"
SHOE_POSE_DEFAULT_MODEL = "gpt-5.6-sol"
SHOE_OFFICIAL_DEEPSEEK_VISION_MODEL = "deepseek-official-v4-flash-vision-exp"
SHOE_POSE_DEFAULT_FALLBACK_MODELS: tuple[str, ...] = (
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "deepseek-official-v4-flash-vision-exp",
    "kimi-k2.7-code",
)
SHOE_LABEL_OCR_DEFAULT_MODEL_CHAIN: tuple[str, ...] = (
    "gpt-5.6-sol",
    "gemini-3.5-flash",
    "qwen3.7-plus",
    "gpt-5.6-terra",
    "kimi-k2.7-code",
    "deepseek-official-v4-flash-vision-exp",
)
SHOE_FALLBACK_MODEL_LIMIT = 5
SHOE_POSE_MODEL_CANDIDATES = (
    "deepseek-official-v4-flash-vision-exp",
    "deepseek-official-v4-flash",
    "deepseek-official-v4-pro",
    "glm-official-5.3-flash",
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
    "deepseek-v4-flash",
    "deepseek-v4-pro",
    "glm-5.2",
    "kimi-k2.7-code",
)
SHOE_CROSS_COLOR_MAX_DISTANCE = 0.32
SHOE_WHITE_BACKGROUND_LUMA = 249.5
SHOE_YX_MAX_FOREGROUND_COVERAGE = 0.65
SHOE_POSE3_SIDE_ASYMMETRY_MARGIN = 0.006
SHOE_POSE1_MIN_SCORE_IMPROVEMENT = 0.08
SHOE_MAIN_SLOT_DUPLICATE_MAX_DISTANCE = 0.045
SHOE_BACKGROUND_PAIR_MAX_DISTANCE = 0.06
SHOE_VISUAL_VARIANT_MAX_DISTANCE = 0.025
SHOE_SAME_BACKGROUND_VISUAL_VARIANT_MAX_DISTANCE = 0.003
SHOE_SAME_BACKGROUND_VISUAL_MIN_PIXEL_MATCH = 0.70
SHOE_SAME_BACKGROUND_VISUAL_MAX_PIXEL_DELTA = 3
SHOE_GRAY_BACKGROUND_RGB = (242, 242, 242)
SHOE_MODEL_INPUT_MAX_SIDE = 900
SHOE_MODEL_INPUT_JPEG_QUALITY = 72
SHOE_CONTACT_SHEET_CHUNK_SIZE = 4
SHOE_GLOBAL_PAGE_CHUNK_SIZE = 12
SHOE_GLOBAL_PAGE_MAX_PAGES = 8
SHOE_MULTIMODAL_IMAGE_INPUT_LIMIT = 10
SHOE_POSE_MODEL_MAX_ATTEMPTS = 3
SHOE_LABEL_OCR_MODEL_MAX_ATTEMPTS = 3
SHOE_POSE_MODEL_TIMEOUT_SECONDS = 60
SHOE_LABEL_OCR_TIMEOUT_SECONDS = 60
SHOE_POSE_TIMEOUT_PROBE_SECONDS = 180
SHOE_LABEL_OCR_TIMEOUT_PROBE_SECONDS = 180
SHOE_POSE_BATCH_PARALLELISM = 2
SHOE_POSE_MAX_CONCURRENT_CALLS = 4
SHOE_POSE_CONSENSUS_REQUIRED_VOTES = 2
SHOE_POSE_STRATEGY_GLOBAL_PAGES = "global_pages"
SHOE_POSE_STRATEGY_BATCH = "batch"
SHOE_POSE_STRATEGY_BATCH_OVERVIEW = "batch_overview"
SHOE_POSE_STRATEGY_SINGLE_SHEET = "single_sheet"
SHOE_POSE_STRATEGY_FOCUSED = "focused"
SHOE_POSE_DEFAULT_STRATEGY = SHOE_POSE_STRATEGY_SINGLE_SHEET
SHOE_FULL_POSE_REQUIRED_CONSENSUS_SLOTS = (
    "tmz1",
    "tmz2",
    "tmz3",
    "tmz4",
    "tmz5",
    "wpz5",
    "wpz6",
    "yq1",
    "yq2",
    "yq3",
)


def _run_pose_model_wave(
    model_ids: list[Any] | tuple[Any, ...],
    invoke: Any,
    *,
    max_workers: int = SHOE_POSE_MAX_CONCURRENT_CALLS,
) -> list[Any]:
    """Run one independent scoring wave concurrently and preserve model order."""

    ordered_models = list(model_ids)
    if not ordered_models:
        return []
    results: list[Any] = [None] * len(ordered_models)
    with ThreadPoolExecutor(
        max_workers=min(max(1, int(max_workers)), len(ordered_models)),
        thread_name_prefix="shoe-pose-model",
    ) as executor:
        future_to_index = {
            executor.submit(invoke, model_id): index
            for index, model_id in enumerate(ordered_models)
        }
        for future in as_completed(future_to_index):
            results[future_to_index[future]] = future.result()
    return results


def _interleaved_pose_work_items(
    model_wave: list[str],
    pending_batches: list[dict[str, Any]],
    routes_by_batch: dict[int, set[str]],
) -> list[tuple[str, dict[str, Any]]]:
    """Queue each batch's independent models together for real concurrent scoring."""

    return [
        (model_id, batch_input)
        for batch_input in pending_batches
        for model_id in model_wave
        if model_id
        not in routes_by_batch.get(int(batch_input["batch_index"]), set())
    ]


SHOE_MANDATORY_TARGETED_SLOTS = (
    "tmz3",
    "wpz5",
    "yq3",
)
SHOE_FOCUSED_POSE_SLOTS = (
    *SHOE_FULL_POSE_REQUIRED_CONSENSUS_SLOTS,
    "yx",
)
SHOE_FOCUSED_MAX_CANDIDATES = 36
SHOE_CHANNEL_CANVAS_SIZE = 800
SHOE_WPT_MAX_BYTES = 600 * 1024
SHOE_TMQ_CANVAS_SIZE = 800

SHOE_POSE5_FEATURE_RULES = {
    "运动": {
        "min_aspect": 0.42,
        "max_aspect": 0.82,
        "target_aspect": 0.58,
        "min_coverage": 0.08,
        "max_coverage": 0.32,
        "target_coverage": 0.16,
    },
    "婴童": {
        "min_aspect": 0.42,
        "max_aspect": 0.82,
        "target_aspect": 0.58,
        "min_coverage": 0.08,
        "max_coverage": 0.32,
        "target_coverage": 0.16,
    },
    "休闲": {
        "min_aspect": 0.42,
        "max_aspect": 0.82,
        "target_aspect": 0.58,
        "min_coverage": 0.08,
        "max_coverage": 0.32,
        "target_coverage": 0.16,
    },
    "雪地": {
        "min_aspect": 0.42,
        "max_aspect": 0.82,
        "target_aspect": 0.58,
        "min_coverage": 0.08,
        "max_coverage": 0.32,
        "target_coverage": 0.16,
    },
}

SHOE_SELECTION_SYSTEM_PROMPT = """你是电商鞋品图片审核员。你要把候选原图匹配到深绘鞋品图包槽位。
只能选择候选图编号，不能编造编号或文件名。先识别鞋盒标签中的产品名称和颜色，再结合参考模板判断品类和姿势。
如果输入中包含当前品类 tmz1..tmz5 的切片参考，主图位必须优先逐张对照这些参考图判断。
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


def _is_auto_shoe_model_id(model_id: str) -> bool:
    return _text(model_id).lower() in {
        "",
        "auto",
        "multi",
        "multi-model",
        "multi_model",
        "多模型",
    }


def _is_timeout_like_llm_error(exc: Exception | str) -> bool:
    text = _text(exc).lower()
    return any(
        marker in text
        for marker in (
            "timeout",
            "timed out",
            "time out",
            "请求超过总时长",
            "超时",
            "deadline",
        )
    )


def _split_shoe_model_ids(value: Any) -> list[str]:
    if isinstance(value, str):
        raw_items = re.split(r"[\s,，、;；]+", value)
    elif isinstance(value, list | tuple):
        raw_items = value
    else:
        raw_items = []
    return list(dict.fromkeys(_text(item) for item in raw_items if _text(item)))


def _configured_shoe_fallback_model_ids(value: Any) -> list[str]:
    return _split_shoe_model_ids(value)[:SHOE_FALLBACK_MODEL_LIMIT]


def normalize_shoe_pose_strategy(value: Any) -> str:
    text = _text(value).lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "": SHOE_POSE_DEFAULT_STRATEGY,
        "global": SHOE_POSE_STRATEGY_GLOBAL_PAGES,
        "global_pages": SHOE_POSE_STRATEGY_GLOBAL_PAGES,
        "global_page": SHOE_POSE_STRATEGY_GLOBAL_PAGES,
        "global_sheets": SHOE_POSE_STRATEGY_GLOBAL_PAGES,
        "paged_global": SHOE_POSE_STRATEGY_GLOBAL_PAGES,
        "pages": SHOE_POSE_STRATEGY_GLOBAL_PAGES,
        "batch": SHOE_POSE_STRATEGY_BATCH,
        "batched": SHOE_POSE_STRATEGY_BATCH,
        "chunk": SHOE_POSE_STRATEGY_BATCH,
        "chunked": SHOE_POSE_STRATEGY_BATCH,
        "batch_overview": SHOE_POSE_STRATEGY_BATCH_OVERVIEW,
        "batched_overview": SHOE_POSE_STRATEGY_BATCH_OVERVIEW,
        "batch_context": SHOE_POSE_STRATEGY_BATCH_OVERVIEW,
        "overview": SHOE_POSE_STRATEGY_BATCH_OVERVIEW,
        "panorama": SHOE_POSE_STRATEGY_BATCH_OVERVIEW,
        "global_context": SHOE_POSE_STRATEGY_BATCH_OVERVIEW,
        "single": SHOE_POSE_STRATEGY_SINGLE_SHEET,
        "single_sheet": SHOE_POSE_STRATEGY_SINGLE_SHEET,
        "one_sheet": SHOE_POSE_STRATEGY_SINGLE_SHEET,
        "full_sheet": SHOE_POSE_STRATEGY_SINGLE_SHEET,
        "all_in_one": SHOE_POSE_STRATEGY_SINGLE_SHEET,
    }
    strategy = aliases.get(text)
    if strategy:
        return strategy
    raise ShoeSelectionError(
        f"不支持的鞋品候选图识别策略“{_text(value)}”；"
        "支持 global_pages、batch、batch_overview、single_sheet"
    )


def _shoe_append_fallback_model_ids(
    model_ids: list[str],
    config: dict | None = None,
    fallback_model_ids: Any = None,
) -> list[str]:
    selected = list(dict.fromkeys(_text(item) for item in model_ids if _text(item)))
    for fallback in _configured_shoe_fallback_model_ids(fallback_model_ids):
        if fallback not in selected:
            selected.append(fallback)
    return selected


def _shoe_pose_model_ids(
    model_id: str,
    config: dict | None = None,
    fallback_model_ids: Any = None,
) -> list[str]:
    text = _text(model_id)
    if _is_auto_shoe_model_id(text):
        selected = _shoe_append_fallback_model_ids([], config, fallback_model_ids)
        return selected or [SHOE_POSE_DEFAULT_MODEL, *SHOE_POSE_DEFAULT_FALLBACK_MODELS]
    parts = _split_shoe_model_ids(text)
    model_ids = list(dict.fromkeys(parts or [text]))
    return _shoe_append_fallback_model_ids(model_ids, config, fallback_model_ids)


def _shoe_label_model_ids(
    model_id: str,
    config: dict | None = None,
    fallback_model_ids: Any = None,
) -> list[str]:
    text = _text(model_id)
    if _is_auto_shoe_model_id(text):
        selected = _shoe_append_fallback_model_ids([], config, fallback_model_ids)
        return selected or list(SHOE_LABEL_OCR_DEFAULT_MODEL_CHAIN)
    return _shoe_append_fallback_model_ids([text], config, fallback_model_ids)


def _is_pose_matching_candidate(filename: str) -> bool:
    """Exclude prebuilt channel/AI angles from pose analysis while preserving them."""

    stem = Path(_text(filename)).stem
    return not re.search(r"ai\s*角度图", stem, flags=re.IGNORECASE)


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


def _is_tms_source_filename(filename: str, style_code: str, color_code: str) -> bool:
    stem = Path(_text(filename)).stem.strip()
    if not stem:
        return False
    return bool(
        re.fullmatch(
            rf"{re.escape(_text(style_code))}\s*[-－]\s*{re.escape(_text(color_code))}",
            stem,
            flags=re.IGNORECASE,
        )
    )


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
    foreground_fill_ratio: float = 0.0
    foreground_color_bins: int = 0
    foreground_edge_mean: float = 0.0
    foreground_saturation_mean: float = 0.0
    foreground_saturation_p80: float = 0.0


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

    mask_crop = mask.crop(bbox)
    foreground_pixels = [
        (pixel, mask_value)
        for pixel, mask_value in zip(image.crop(bbox).getdata(), mask_crop.getdata())
        if mask_value > 0
    ]
    foreground_area = len(foreground_pixels)
    bbox_area = max((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]), 1)
    foreground_fill_ratio = foreground_area / bbox_area
    if foreground_pixels:
        foreground_colors = [pixel for pixel, _mask_value in foreground_pixels]
        foreground_color_bins = len(
            {
                (red // 32, green // 32, blue // 32)
                for red, green, blue in foreground_colors
            }
        )
        saturations = sorted(
            (
                (max(red, green, blue) - min(red, green, blue))
                / max(max(red, green, blue), 1)
            )
            for red, green, blue in foreground_colors
        )
        saturation_index = min(int(len(saturations) * 0.80), len(saturations) - 1)
        foreground_saturation_mean = sum(saturations) / len(saturations)
        foreground_saturation_p80 = saturations[saturation_index]
        edge_image = (
            ImageOps.grayscale(image.crop(bbox))
            .filter(ImageFilter.FIND_EDGES)
        )
        edge_values = [
            edge_value
            for edge_value, mask_value in zip(edge_image.getdata(), mask_crop.getdata())
            if mask_value > 0
        ]
        foreground_edge_mean = (
            sum(edge_values) / len(edge_values)
            if edge_values
            else 0.0
        )
    else:
        foreground_color_bins = 0
        foreground_saturation_mean = 0.0
        foreground_saturation_p80 = 0.0
        foreground_edge_mean = 0.0

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
        foreground_fill_ratio=foreground_fill_ratio,
        foreground_color_bins=foreground_color_bins,
        foreground_edge_mean=foreground_edge_mean,
        foreground_saturation_mean=foreground_saturation_mean,
        foreground_saturation_p80=foreground_saturation_p80,
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


def _binary_pose_third_densities(
    feature: _BinaryPoseFeature | None,
) -> tuple[tuple[float, float, float], tuple[float, float, float]] | None:
    if not feature or not feature.valid or feature.mask is None:
        return None

    mask = feature.mask.convert("L")
    width, height = mask.size
    if width <= 0 or height <= 0:
        return None
    data = list(mask.getdata())

    def density(x0: int, x1: int, y0: int, y1: int) -> float:
        x0 = max(0, min(width, x0))
        x1 = max(0, min(width, x1))
        y0 = max(0, min(height, y0))
        y1 = max(0, min(height, y1))
        area = max((x1 - x0) * (y1 - y0), 1)
        return (
            sum(
                1
                for y in range(y0, y1)
                for x in range(x0, x1)
                if data[y * width + x] > 0
            )
            / area
        )

    column_densities = tuple(
        density(index * width // 3, (index + 1) * width // 3, 0, height)
        for index in range(3)
    )
    row_densities = tuple(
        density(0, width, index * height // 3, (index + 1) * height // 3)
        for index in range(3)
    )
    return column_densities, row_densities


def _is_low_detail_main_shoe_candidate(
    pose: _BinaryPoseFeature | None,
) -> bool:
    """Reject insoles, standalone soles, charms, and tiny detail objects for main slots."""

    if not pose or not pose.valid:
        return True
    has_quality_metrics = bool(
        pose.foreground_fill_ratio
        or pose.foreground_color_bins
        or pose.foreground_edge_mean
        or pose.foreground_saturation_p80
    )
    if not has_quality_metrics:
        return False
    if (
        pose.foreground_fill_ratio <= 0.32
        and pose.foreground_saturation_p80 <= 0.14
    ):
        return True
    if (
        pose.foreground_fill_ratio <= 0.42
        and pose.foreground_edge_mean <= 30.0
        and pose.foreground_saturation_p80 <= 0.08
    ):
        return True
    if (
        pose.foreground_color_bins <= 32
        and pose.foreground_edge_mean <= 35.0
        and pose.foreground_saturation_p80 <= 0.18
    ):
        return True
    if (
        pose.foreground_color_bins <= 24
        and pose.bounding_coverage <= 0.09
    ):
        return True
    return False


def _is_complete_main_shoe_candidate(
    pose: _BinaryPoseFeature | None,
) -> bool:
    return bool(pose and pose.valid and not _is_low_detail_main_shoe_candidate(pose))


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
    return shenhui_shoe_rules._candidate_family_key(filename)


def _is_copy_variant_filename(filename: str) -> bool:
    return bool(
        re.search(
            r"\s*(?:拷贝|[-－]?\s*副本)$",
            Path(_text(filename)).stem,
            flags=re.IGNORECASE,
        )
    )


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
    retired_source_names: set[str] = set()

    def retire_source(*names: str) -> None:
        for name in names:
            text = _text(name)
            if text:
                retired_source_names.add(text)

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
        retire_source(yx_name)
        corrections.append(
            f"yx 已清空：{yx_name} 为鞋面局部特写，未完整展示鞋子与功能吊牌"
        )

    wpz = _selection_array(slots, "wpz", 6)
    ruled["wpz"] = wpz
    yq = _selection_array(slots, "yq", 3)
    ruled["yq"] = yq

    def valid_shared_pose2(pose: _BinaryPoseFeature | None) -> bool:
        profile = _binary_pose_third_densities(pose)
        if profile:
            column_densities, row_densities = profile
            rear_outsole_layout = (
                min(column_densities[0], column_densities[2]) >= 0.20
                and abs(column_densities[0] - column_densities[2]) <= 0.08
                and row_densities[1] >= 0.62
            )
        else:
            rear_outsole_layout = True
        return bool(
            pose
            and pose.valid
            and 1.15 <= pose.aspect_ratio <= 1.65
            and 0.10 <= pose.bounding_coverage <= 0.30
            and pose.background_luma >= 235.0
            and _is_complete_main_shoe_candidate(pose)
            and rear_outsole_layout
        )

    def shared_pose2_score(pose: _BinaryPoseFeature) -> float:
        profile = _binary_pose_third_densities(pose)
        if profile:
            column_densities, row_densities = profile
            layout_score = (
                abs(row_densities[0] - 0.54) * 0.35
                + abs(column_densities[0] - column_densities[2]) * 0.25
            )
        else:
            layout_score = 0.0
        return (
            abs(pose.aspect_ratio - 1.36)
            + abs(pose.bounding_coverage - 0.16) * 2.0
            + abs(pose.background_luma - 242.0) / 255.0 * 0.08
            + layout_score
        )

    def more_like_pose4_than_pose2(
        filename: str,
        pose: _BinaryPoseFeature | None,
    ) -> bool:
        if _text(category) == "雪地" or not pose:
            return False
        is_pose4_candidate = bool(
            0.62 <= pose.aspect_ratio <= 1.75
            and 0.05 <= pose.bounding_coverage <= 0.24
            and 235.0 <= pose.background_luma < SHOE_WHITE_BACKGROUND_LUMA
            and not (
                pose.aspect_ratio >= 1.55
                and pose.bounding_coverage >= 0.16
            )
            and _is_complete_main_shoe_candidate(pose)
        )
        if not is_pose4_candidate:
            return False
        pose4_score = (
            abs(pose.aspect_ratio - 1.22)
            + abs(pose.bounding_coverage - 0.12) * 2.0
            + abs(pose.background_luma - 242.0) / 255.0 * 0.08
        )
        return pose4_score + 0.04 < shared_pose2_score(pose)

    if len(wpz) >= 2:
        current_wpz2 = wpz[1]
        current_tmz2 = _text(ruled.get("tmz2")) or current_wpz2
        current_wpz2_feature = feature_for(current_wpz2)
        current_tmz2_feature = feature_for(current_tmz2)
        current_valid = (
            valid_shared_pose2(current_wpz2_feature)
            and valid_shared_pose2(current_tmz2_feature)
        )
        if not current_valid:
            occupied = {
                _text(value)
                for value in [
                    wpz[0] if wpz else "",
                    *wpz[2:],
                    *yq[1:],
                    ruled.get("yx"),
                    ruled.get("tmz1"),
                    ruled.get("tmz3"),
                    ruled.get("tmz4"),
                    ruled.get("tmz5"),
                ]
                if _text(value)
            }
            yq1_source = _text(yq[0]) if yq else ""
            preferred_pose2 = [
                (yq1_source, yq1_feature)
                for yq1_feature in [feature_for(yq1_source)]
                if yq1_source
                and yq1_source not in occupied
                and valid_shared_pose2(yq1_feature)
            ]
            eligible_baby_pose2 = preferred_pose2 or [
                (filename, pose)
                for filename in entries_by_name
                if filename not in occupied
                for pose in [feature_for(filename)]
                if valid_shared_pose2(pose)
                and not more_like_pose4_than_pose2(filename, pose)
            ]
            if eligible_baby_pose2:
                replacement, _replacement_feature = min(
                    eligible_baby_pose2,
                    key=lambda item: (shared_pose2_score(item[1]), item[0].lower()),
                )
                if (
                    current_wpz2 != replacement
                    or current_tmz2 != replacement
                ):
                    wpz[1] = replacement
                    ruled["tmz2"] = replacement
                    corrections.append(
                        "主图2前鞋加后鞋底姿势已纠正："
                        f"{current_wpz2} -> {replacement}"
                    )

    def valid_yq2_outsole(pose: _BinaryPoseFeature | None) -> bool:
        return bool(
            pose
            and 1.75 <= pose.aspect_ratio <= 2.70
            and 0.08 <= pose.bounding_coverage <= 0.40
            and pose.background_luma >= 235.0
        )

    if outsole_entries_by_name is not None:
        outsole_entries = dict(entries_by_name)
        outsole_entries.update(outsole_entries_by_name)
    else:
        outsole_entries = entries_by_name
    current_yq2 = _text(yq[1]) if len(yq) >= 2 else ""
    current_yq2_feature = (
        feature_for(current_yq2, outsole_entries)
        if len(yq) >= 2
        else None
    )
    has_explicit_outsole_pool = outsole_entries_by_name is not None
    should_repair_yq2 = len(yq) >= 2 and (
        bool(
            current_yq2
            and current_yq2_feature is not None
            and not valid_yq2_outsole(current_yq2_feature)
        )
        or bool(
            has_explicit_outsole_pool
            and (
                not current_yq2
                or current_yq2_feature is None
                or not valid_yq2_outsole(current_yq2_feature)
            )
        )
    )
    if should_repair_yq2:
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
            retire_source(previous_yq2)
            corrections.append(
                f"yq2 完整鞋底已纠正：{previous_yq2} -> {replacement}"
            )
        elif current_yq2:
            previous_yq2 = yq[1]
            if current_yq2_feature is not None:
                yq[1] = ""
                retire_source(previous_yq2)
                corrections.append(
                    f"yq2 不是完整鞋底且未找到合格原始素材，已清空：{previous_yq2}"
                )

    def valid_pose3_vertical_span(pose: _BinaryPoseFeature) -> bool:
        if pose.bounding_coverage <= 0.12:
            return True
        profile = _binary_pose_third_densities(pose)
        if not profile:
            return True
        _column_densities, row_densities = profile
        min_edge_density = 0.035 if _text(category) == "婴童" else 0.10
        return min(row_densities[0], row_densities[2]) >= min_edge_density

    def valid_pose3(pose: _BinaryPoseFeature | None) -> bool:
        category_text = _text(category)
        max_aspect = 0.95 if category_text == "婴童" else 0.82
        max_coverage = 0.145 if category_text == "婴童" else 0.16
        return bool(
            pose
            and 0.45 <= pose.aspect_ratio <= max_aspect
            and pose.bounding_coverage <= max_coverage
            and valid_pose3_vertical_span(pose)
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
        pose3_locked = False

        def valid_baby_pose3(pose: _BinaryPoseFeature | None) -> bool:
            has_side_contour = bool(
                pose
                and (
                    pose.aspect_ratio >= 0.72
                    or _binary_pose_horizontal_asymmetry(pose) >= 0.08
                )
            )
            return bool(
                pose
                and 0.48 <= pose.aspect_ratio <= 0.95
                and 0.055 <= pose.bounding_coverage <= 0.145
                and 235.0 <= pose.background_luma < SHOE_WHITE_BACKGROUND_LUMA
                and valid_pose3_vertical_span(pose)
                and has_side_contour
                and _is_complete_main_shoe_candidate(pose)
            )

        def baby_pose3_score(pose: _BinaryPoseFeature) -> float:
            profile = _binary_pose_third_densities(pose)
            side_density_bonus = 0.0
            if profile:
                column_densities, _row_densities = profile
                side_density_bonus = min(max(column_densities[0], column_densities[2]), 0.08)
            return (
                abs(pose.aspect_ratio - 0.88)
                + abs(pose.bounding_coverage - 0.11) * 1.4
                + abs(pose.background_luma - 242.0) / 255.0 * 0.08
                - min(_binary_pose_horizontal_asymmetry(pose), 0.24) * 0.55
                - side_density_bonus * 0.70
            )

        if _text(category) == "婴童":
            occupied_baby_pose3 = {
                _text(value)
                for value in [
                    *wpz[:2],
                    *wpz[3:4],
                    *wpz[5:],
                    *yq,
                    ruled.get("yx"),
                    *[
                        ruled.get(f"tmz{index}")
                        for index in (1, 2, 4)
                    ],
                ]
                if _text(value)
            }
            baby_side_pose3 = [
                (filename, pose)
                for filename in entries_by_name
                if filename not in occupied_baby_pose3
                for pose in [feature_for(filename)]
                if valid_baby_pose3(pose)
            ]
            current_wpz3_feature = feature_for(current_wpz3)
            current_tmz3_feature = feature_for(current_tmz3)
            current_valid = (
                valid_baby_pose3(current_wpz3_feature)
                and valid_baby_pose3(current_tmz3_feature)
            )
            if baby_side_pose3 and (
                not current_valid
                or min(
                    baby_pose3_score(pose)
                    for name, pose in baby_side_pose3
                    if name in {current_wpz3, current_tmz3}
                )
                - min(baby_pose3_score(pose) for _name, pose in baby_side_pose3)
                >= 0.01
            ):
                replacement, _replacement_feature = min(
                    baby_side_pose3,
                    key=lambda item: (baby_pose3_score(item[1]), item[0].lower()),
                )
                if (
                    current_wpz3 != replacement
                    or current_tmz3 != replacement
                ):
                    wpz[2] = replacement
                    ruled["tmz3"] = replacement
                    retire_source(current_wpz3, current_tmz3)
                    corrections.append(
                        "婴童第3姿势外侧竖立图已纠正："
                        f"{current_wpz3} -> {replacement}"
                    )
                    current_wpz3 = replacement
                    current_tmz3 = replacement
                    pose3_locked = True

        # Sports and baby-shoe shoots can contain two near-identical vertical
        # candidates: a frontal shoe and the outer-side profile required by
        # the template. The outer-side silhouette is less left/right
        # symmetric. Only use that signal when the candidate gap is clear.
        if (
            not pose3_locked
            and _text(category) == "运动"
            and len(eligible_pose3) >= 2
        ):
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
                retire_source(current_wpz3, current_tmz3)
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
                retire_source(current_wpz3, current_tmz3)

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
            "雪地": (1.08, 0.22),
            "运动": (1.00, 0.22),
            "休闲": (1.05, 0.20),
            "婴童": (1.08, 0.15),
        }.get(_text(category), (1.00, 0.20))
        min_pose1_coverage = {
            "婴童": 0.13,
        }.get(_text(category), 0.12)

        def valid_shared_pose1(pose: _BinaryPoseFeature | None) -> bool:
            return bool(
                pose
                and 0.68 <= pose.aspect_ratio <= 1.65
                and min_pose1_coverage <= pose.bounding_coverage <= 0.34
                and pose.background_luma >= 235.0
                and _is_complete_main_shoe_candidate(pose)
            )

        occupied = {
            _text(value)
            for value in [
                *wpz[1:4],
                *yq,
                ruled.get("yx"),
                *[ruled.get(f"tmz{index}") for index in range(2, 5)],
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

        if eligible_pose1:
            replacement, replacement_feature = min(
                eligible_pose1,
                key=lambda item: (
                    pose1_score(item[1]),
                    item[0].lower(),
                ),
            )
            current_valid = (
                bool(current_wpz1_feature and valid_shared_pose1(current_wpz1_feature))
                and bool(current_tmz1_feature and valid_shared_pose1(current_tmz1_feature))
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
                retire_source(current_wpz1, current_tmz1)
                corrections.append(
                    "主图1最新双鞋斜前方姿势已纠正："
                    f"{current_wpz1} -> {replacement}"
                )

    def valid_shared_pose4_candidate(
        filename: str,
        pose: _BinaryPoseFeature | None,
    ) -> bool:
        if _text(category) == "雪地":
            return _is_snow_pose4_business_opening(filename, pose)
        return bool(
            pose
            and 0.62 <= pose.aspect_ratio <= 1.75
            and 0.05 <= pose.bounding_coverage <= 0.24
            and 235.0 <= pose.background_luma < SHOE_WHITE_BACKGROUND_LUMA
            and not (
                pose.aspect_ratio >= 1.55
                and pose.bounding_coverage >= 0.16
            )
            and _is_complete_main_shoe_candidate(pose)
        )

    def shared_pose4_score(pose: _BinaryPoseFeature) -> float:
        if _text(category) == "雪地":
            return _snow_pose4_opening_score(pose)
        return (
            abs(pose.aspect_ratio - 1.22)
            + abs(pose.bounding_coverage - 0.12) * 2.0
            + abs(pose.background_luma - 242.0) / 255.0 * 0.08
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
                retire_source(current_wpz4, current_tmz4)
                corrections.append(
                    "雪地第4姿势完整鞋口内里图已纠正："
                    f"{current_wpz4} -> {replacement}"
                )

    if _text(category) != "雪地" and len(wpz) >= 4:
        current_wpz4 = wpz[3]
        current_tmz4 = _text(ruled.get("tmz4")) or current_wpz4
        current_pose4_feature = feature_for(current_wpz4)
        current_tmz4_feature = feature_for(current_tmz4)
        current_valid = (
            bool(
                current_pose4_feature
                and valid_shared_pose4_candidate(current_wpz4, current_pose4_feature)
            )
            and bool(
                current_tmz4_feature
                and valid_shared_pose4_candidate(current_tmz4, current_tmz4_feature)
            )
        )
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
            if valid_shared_pose4_candidate(filename, pose)
        ]
        if eligible_pose4:
            replacement, replacement_feature = min(
                eligible_pose4,
                key=lambda item: (shared_pose4_score(item[1]), item[0].lower()),
            )
            current_score = max(
                (
                    shared_pose4_score(pose)
                    for pose in (current_pose4_feature, current_tmz4_feature)
                    if pose is not None
                ),
                default=float("inf"),
            )
            should_replace = (
                not current_valid
                or (
                    replacement not in {current_wpz4, current_tmz4}
                    and current_score - shared_pose4_score(replacement_feature) >= 0.02
                )
            )
            if should_replace:
                wpz[3] = replacement
                ruled["tmz4"] = replacement
                retire_source(current_wpz4, current_tmz4)
                corrections.append(
                    "主图4/wpz4 最新模板姿势已纠正："
                    f"{current_wpz4 or current_tmz4} -> {replacement}"
                )
        elif (
            current_wpz4
            or current_tmz4
        ) and (
            current_pose4_feature
            or current_tmz4_feature
        ):
            if not current_valid:
                wpz[3] = ""
                ruled["tmz4"] = ""
                retire_source(current_wpz4, current_tmz4)
                corrections.append(
                    "主图4/wpz4 未找到合格最新模板姿势，已跳过："
                    f"{current_wpz4 or current_tmz4}"
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
        if not pose:
            return False
        min_aspect = 1.05 if _text(category) == "婴童" else 1.45
        min_luma = 220.0 if _text(category) == "婴童" else 235.0
        return bool(
            min_aspect <= pose.aspect_ratio <= 2.50
            and 0.10 <= pose.bounding_coverage <= 0.45
            and min_luma <= pose.background_luma < SHOE_WHITE_BACKGROUND_LUMA
        )

    if len(yq) >= 3 and (
        not current_yq3
        or current_yq3_feature is None
        or not valid_shared_yq3(current_yq3_feature)
    ):
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
            retire_source(current_yq3)
            corrections.append(
                f"yq3 固定完整外侧面已纠正："
                f"{current_yq3} -> {replacement}"
            )
        elif current_yq3:
            if current_yq3_feature is not None:
                yq[2] = ""
                retire_source(current_yq3)
                corrections.append(
                    f"yq3 不是完整外侧面且未找到合格原始素材，已清空：{current_yq3}"
                )

    def set_main_slot(index: int, filename: str) -> None:
        retire_source(ruled.get(f"tmz{index}", ""))
        if 1 <= index <= len(wpz):
            retire_source(wpz[index - 1])
        ruled[f"tmz{index}"] = filename
        if 1 <= index <= len(wpz):
            wpz[index - 1] = filename

    def main_slot_name(index: int) -> str:
        return _text(ruled.get(f"tmz{index}")) or (
            _text(wpz[index - 1]) if 1 <= index <= len(wpz) else ""
        )

    def main_pose_target(index: int) -> tuple[float, float]:
        category_text = _text(category)
        if index == 1:
            return {
                "雪地": (1.08, 0.22),
                "运动": (1.00, 0.22),
                "休闲": (1.05, 0.20),
                "婴童": (1.08, 0.15),
            }.get(category_text, (1.00, 0.20))
        if index == 2:
            return {
                "雪地": (0.95, 0.18),
                "运动": (0.95, 0.22),
                "休闲": (1.05, 0.18),
                "婴童": (0.78, 0.16),
            }.get(category_text, (0.95, 0.18))
        if index == 3:
            return (0.66, 0.075)
        if index == 4:
            return (1.25, 0.20) if category_text == "雪地" else (1.22, 0.12)
        pose5_rule = SHOE_POSE5_FEATURE_RULES.get(category_text) or {}
        return (
            float(pose5_rule.get("target_aspect", 0.60)),
            float(pose5_rule.get("target_coverage", 0.14)),
        )

    def main_pose_score(index: int, pose: _BinaryPoseFeature) -> float:
        target_aspect, target_coverage = main_pose_target(index)
        background_penalty = (
            abs(pose.background_luma - 242.0) / 255.0 * 0.12
            if index < 5
            else 0.0
        )
        return (
            abs(pose.aspect_ratio - target_aspect)
            + abs(pose.bounding_coverage - target_coverage) * 2.0
            + background_penalty
        )

    def valid_main_pose_candidate(
        index: int,
        filename: str,
        pose: _BinaryPoseFeature | None,
    ) -> bool:
        if not pose or not pose.valid:
            return False
        category_text = _text(category)
        if index == 1:
            min_coverage = 0.13 if category_text == "婴童" else 0.12
            return bool(
                0.68 <= pose.aspect_ratio <= 1.65
                and min_coverage <= pose.bounding_coverage <= 0.34
                and pose.background_luma >= 235.0
                and _is_complete_main_shoe_candidate(pose)
            )
        if index == 2:
            return bool(
                0.62 <= pose.aspect_ratio <= 1.30
                and 0.12 <= pose.bounding_coverage <= 0.32
                and pose.background_luma >= 235.0
                and _is_complete_main_shoe_candidate(pose)
            )
        if index == 3:
            return valid_pose3(pose)
        if index == 4:
            return valid_shared_pose4_candidate(filename, pose)
        if index == 5:
            pose5_rule = SHOE_POSE5_FEATURE_RULES.get(category_text)
            return bool(
                pose5_rule
                and pose5_rule["min_aspect"] <= pose.aspect_ratio <= pose5_rule["max_aspect"]
                and pose.bounding_coverage >= pose5_rule["min_coverage"]
                and pose.bounding_coverage <= pose5_rule["max_coverage"]
                and _is_complete_main_shoe_candidate(pose)
            )
        return False

    def is_near_duplicate_main_pose(first: str, second: str) -> bool:
        if not first or not second:
            return False
        if first == second or _copy_variant_key(first) == _copy_variant_key(second):
            return True
        first_feature = feature_for(first)
        second_feature = feature_for(second)
        if (
            not first_feature
            or not second_feature
            or first_feature.mask is None
            or second_feature.mask is None
        ):
            return False
        return (
            _binary_pose_distance(first_feature, second_feature)
            <= SHOE_MAIN_SLOT_DUPLICATE_MAX_DISTANCE
        )

    def safe_pose_distance(
        first: _BinaryPoseFeature,
        second: _BinaryPoseFeature,
    ) -> float:
        if first.mask is None or second.mask is None:
            return float("inf")
        return _binary_pose_distance(first, second)

    def collect_background_variant_pairs() -> tuple[
        list[tuple[str, _BinaryPoseFeature]],
        list[tuple[str, _BinaryPoseFeature]],
        list[dict[str, Any]],
    ]:
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

        return gray_variants, white_variants, paired_groups

    gray_variants, white_variants, paired_groups = collect_background_variant_pairs()

    def gray_pair_for_white(
        white_name: str,
    ) -> tuple[str, _BinaryPoseFeature] | None:
        white_feature = feature_for(white_name)
        if (
            not white_name
            or not white_feature
            or white_feature.background_luma < SHOE_WHITE_BACKGROUND_LUMA
        ):
            return None
        paired = next(
            (
                (group["gray_name"], group["gray_feature"])
                for group in paired_groups
                if group["white_name"] == white_name
            ),
            None,
        )
        if paired:
            return paired
        nearest = min(
            (
                (gray_name, gray_feature, safe_pose_distance(gray_feature, white_feature))
                for gray_name, gray_feature in gray_variants
            ),
            key=lambda item: (item[2], item[0].lower()),
            default=None,
        )
        if nearest and nearest[2] <= SHOE_BACKGROUND_PAIR_MAX_DISTANCE:
            return nearest[0], nearest[1]
        return None

    def prefer_gray_background_for_standard_main_slots() -> None:
        for index in range(1, min(4, len(wpz)) + 1):
            current_tmz = _text(ruled.get(f"tmz{index}"))
            current_wpz = _text(wpz[index - 1])
            selected_names = [
                name
                for name in (current_tmz, current_wpz)
                if name
            ]
            for selected_name in selected_names:
                gray_pair = gray_pair_for_white(selected_name)
                if not gray_pair:
                    continue
                gray_name, gray_feature = gray_pair
                occupied_elsewhere = {
                    main_slot_name(other_index)
                    for other_index in range(1, 6)
                    if other_index != index
                }
                if gray_name in occupied_elsewhere:
                    continue
                selected_feature = feature_for(selected_name)
                gray_is_valid_same_pose_pair = bool(
                    selected_feature
                    and valid_main_pose_candidate(index, selected_name, selected_feature)
                    and gray_feature.valid
                    and 235.0 <= gray_feature.background_luma < SHOE_WHITE_BACKGROUND_LUMA
                    and safe_pose_distance(gray_feature, selected_feature)
                    <= SHOE_BACKGROUND_PAIR_MAX_DISTANCE
                    and abs(gray_feature.aspect_ratio - selected_feature.aspect_ratio) <= 0.08
                    and abs(gray_feature.bounding_coverage - selected_feature.bounding_coverage) <= 0.04
                )
                if (
                    not valid_main_pose_candidate(index, gray_name, gray_feature)
                    and not gray_is_valid_same_pose_pair
                ):
                    continue
                previous_tmz = current_tmz or current_wpz
                previous_wpz = current_wpz
                if previous_tmz == gray_name and previous_wpz == gray_name:
                    break
                set_main_slot(index, gray_name)
                corrections.append(
                    f"主图{index}/wpz{index} 已改用同姿势灰底原图："
                    f"{previous_tmz or previous_wpz} -> {gray_name}"
                )
                break

    def best_main_pose_replacement(
        index: int,
        *,
        forbidden: set[str],
    ) -> tuple[str, _BinaryPoseFeature] | None:
        eligible: list[tuple[str, _BinaryPoseFeature]] = []
        for filename in entries_by_name:
            if filename in forbidden or filename in retired_source_names:
                continue
            pose = feature_for(filename)
            if not valid_main_pose_candidate(index, filename, pose):
                continue
            if any(
                is_near_duplicate_main_pose(filename, existing)
                for existing in forbidden
            ):
                continue
            eligible.append((filename, pose))
        if not eligible:
            return None
        return min(
            eligible,
            key=lambda item: (
                main_pose_score(index, item[1]),
                item[0].lower(),
            ),
        )

    def repair_main_slot_duplicates(
        *,
        include_pose5: bool = False,
        locked_indices: set[int] | None = None,
    ) -> None:
        max_index = 5 if include_pose5 else 4
        locked = locked_indices or set()
        while True:
            current = {
                index: main_slot_name(index)
                for index in range(1, max_index + 1)
                if main_slot_name(index)
            }
            duplicate_pair = next(
                (
                    (first_index, second_index)
                    for first_index in range(1, max_index + 1)
                    for second_index in range(first_index + 1, max_index + 1)
                    if is_near_duplicate_main_pose(
                        current.get(first_index, ""),
                        current.get(second_index, ""),
                    )
                ),
                None,
            )
            if not duplicate_pair:
                return
            first_index, second_index = duplicate_pair
            used_names = {
                name
                for index, name in current.items()
                if index not in duplicate_pair and name
            }
            repair_options: list[tuple[float, int, str, _BinaryPoseFeature]] = []
            for index in duplicate_pair:
                if index in locked:
                    continue
                current_name = current.get(index, "")
                current_feature = feature_for(current_name)
                forbidden = set(used_names)
                forbidden.update(
                    name
                    for other_index, name in current.items()
                    if other_index != index and name
                )
                replacement = best_main_pose_replacement(
                    index,
                    forbidden=forbidden,
                )
                if not replacement:
                    continue
                replacement_name, replacement_feature = replacement
                current_score = (
                    main_pose_score(index, current_feature)
                    if current_feature
                    and valid_main_pose_candidate(index, current_name, current_feature)
                    else float("inf")
                )
                improvement = current_score - main_pose_score(index, replacement_feature)
                current_conflicts = any(
                    is_near_duplicate_main_pose(current_name, other_name)
                    for other_index, other_name in current.items()
                    if other_index != index and other_name
                )
                if (
                    improvement < 0.02
                    and current_score != float("inf")
                    and not current_conflicts
                ):
                    continue
                repair_options.append(
                    (
                        -improvement,
                        -index,
                        replacement_name,
                        replacement_feature,
                    )
                )
            if repair_options:
                _sort_key, negative_index, replacement_name, _replacement_feature = min(
                    repair_options,
                    key=lambda item: (item[0], item[1], item[2].lower()),
                )
                index = -negative_index
                previous = current.get(index, "")
                set_main_slot(index, replacement_name)
                corrections.append(
                    f"主图{index}与其他主图姿势重复，已按模板行位纠正："
                    f"{previous} -> {replacement_name}"
                )
                continue
            clear_candidates = [
                index
                for index in duplicate_pair
                if index not in locked
            ]
            if not clear_candidates:
                return
            clear_index = (
                first_index
                if second_index == 5 and 5 in locked and first_index in clear_candidates
                else
                5
                if second_index == 5 and first_index in {1, 2}
                else first_index
                if second_index == 5
                else second_index
            )
            if clear_index in locked:
                clear_index = clear_candidates[-1]
            previous = current.get(clear_index, "")
            set_main_slot(clear_index, "")
            corrections.append(
                f"主图{clear_index}与其他主图姿势重复且未找到合格候选，已跳过："
                f"{previous}"
            )

    prefer_gray_background_for_standard_main_slots()
    repair_main_slot_duplicates(include_pose5=False)
    prefer_gray_background_for_standard_main_slots()
    repair_main_slot_duplicates(include_pose5=False)

    if len(wpz) < 5:
        return ruled, corrections

    rule = SHOE_POSE5_FEATURE_RULES.get(_text(category))
    if not rule:
        return ruled, corrections

    def valid_pose_feature(pose: _BinaryPoseFeature | None) -> bool:
        return (
            pose is not None
            and rule["min_aspect"] <= pose.aspect_ratio <= rule["max_aspect"]
            and pose.bounding_coverage >= rule["min_coverage"]
            and pose.bounding_coverage <= rule["max_coverage"]
            and _is_complete_main_shoe_candidate(pose)
        )

    def pose5_score(pose: _BinaryPoseFeature) -> float:
        return (
            abs(pose.aspect_ratio - rule["target_aspect"])
            + abs(pose.bounding_coverage - rule["target_coverage"]) * 2.0
        )

    def valid_white_pose_feature(pose: _BinaryPoseFeature | None) -> bool:
        return bool(
            valid_pose_feature(pose)
            and pose.background_luma >= SHOE_WHITE_BACKGROUND_LUMA
        )

    def valid_gray_pose_feature(pose: _BinaryPoseFeature | None) -> bool:
        return bool(
            valid_pose_feature(pose)
            and 235.0 <= pose.background_luma < SHOE_WHITE_BACKGROUND_LUMA
        )

    def repair_pose4_if_reused_by_pose5() -> None:
        if len(wpz) < 4:
            return
        category_text = _text(category)
        pose5_names = {
            _text(ruled.get("tmz5")),
            _text(wpz[4]) if len(wpz) > 4 else "",
        }
        pose5_names.discard("")
        current_wpz4 = _text(wpz[3])
        current_tmz4 = _text(ruled.get("tmz4")) or current_wpz4
        if current_wpz4 not in pose5_names and current_tmz4 not in pose5_names:
            return

        def valid_pose4_candidate(
            filename: str,
            pose: _BinaryPoseFeature | None,
        ) -> bool:
            return valid_shared_pose4_candidate(filename, pose)

        occupied = {
            _text(value)
            for value in [
                *wpz[:3],
                *(wpz[4:] if len(wpz) > 4 else []),
                *yq,
                ruled.get("yx"),
                ruled.get("tmz1"),
                ruled.get("tmz2"),
                ruled.get("tmz3"),
                ruled.get("tmz5"),
            ]
            if _text(value)
        }
        occupied.update(pose5_names)
        eligible_pose4 = [
            (filename, pose)
            for filename in entries_by_name
            if filename not in occupied
            for pose in [feature_for(filename)]
            if valid_pose4_candidate(filename, pose)
        ]
        if eligible_pose4:
            replacement, replacement_feature = min(
                eligible_pose4,
                key=lambda item: (
                    shared_pose4_score(item[1]),
                    item[0].lower(),
                ),
            )
            wpz[3] = replacement
            ruled["tmz4"] = replacement
            corrections.append(
                f"{category_text}第4姿势与主图5重复，已纠正："
                f"{current_wpz4 or current_tmz4} -> {replacement}"
            )
            return

        wpz[3] = ""
        ruled["tmz4"] = ""
        corrections.append(
            f"{category_text}第4姿势与主图5重复且未找到合格候选，已跳过："
            f"{current_wpz4 or current_tmz4}"
        )

    current_tmz5 = _text(ruled.get("tmz5"))

    def conflicts_pose5_existing_rows(filename: str) -> bool:
        checked_rows = (1, 2) if current_tmz5 else (1, 2, 3, 4)
        return any(
            is_near_duplicate_main_pose(filename, main_slot_name(index))
            for index in checked_rows
        )

    eligible_white = [
        (filename, pose)
        for filename, pose in white_variants
        if valid_white_pose_feature(pose)
        and not conflicts_pose5_existing_rows(filename)
    ]

    def best_gray_for_white(
        white_name: str,
        white_feature: _BinaryPoseFeature,
    ) -> tuple[str, _BinaryPoseFeature] | None:
        paired = next(
            (
                (group["gray_name"], group["gray_feature"])
                for group in paired_groups
                if group["white_name"] == white_name
                and valid_gray_pose_feature(group.get("gray_feature"))
            ),
            None,
        )
        if paired:
            return paired
        nearest = min(
            (
                (gray_name, gray_feature, safe_pose_distance(gray_feature, white_feature))
                for gray_name, gray_feature in gray_variants
                if valid_gray_pose_feature(gray_feature)
                and not conflicts_pose5_existing_rows(gray_name)
            ),
            key=lambda item: (item[2], pose5_score(item[1]), item[0].lower()),
            default=None,
        )
        if nearest and nearest[2] <= SHOE_BACKGROUND_PAIR_MAX_DISTANCE:
            return nearest[0], nearest[1]
        eligible_gray = [
            (filename, pose)
            for filename, pose in gray_variants
            if valid_gray_pose_feature(pose)
            and not conflicts_pose5_existing_rows(filename)
        ]
        if not eligible_gray:
            return None
        return min(
            eligible_gray,
            key=lambda item: (pose5_score(item[1]), item[0].lower()),
        )

    if eligible_white:
        white_name, white_feature = min(
            eligible_white,
            key=lambda item: (pose5_score(item[1]), item[0].lower()),
        )
        previous_tmz5 = _text(ruled.get("tmz5"))
        previous_wpz5 = wpz[4]
        ruled["tmz5"] = white_name
        gray_match = best_gray_for_white(white_name, white_feature)
        if gray_match:
            wpz[4] = gray_match[0]
        if previous_tmz5 != ruled["tmz5"]:
            corrections.append(
                "主图5白底单鞋姿势已纠正："
                f"{previous_tmz5} -> {ruled['tmz5']}"
            )
        if previous_wpz5 != wpz[4]:
            corrections.append(
                "wpz5 已匹配主图5同姿势灰底原图："
                f"{previous_wpz5} -> {wpz[4]}"
            )
        if (
            previous_tmz5 != ruled["tmz5"]
            or previous_wpz5 != wpz[4]
        ):
            corrections.append(
                "tmz5/wpz5 已按原图白底优先、同姿势配套校正："
                f"{ruled['tmz5']} / {wpz[4]}"
            )
        repair_pose4_if_reused_by_pose5()
        repair_main_slot_duplicates(include_pose5=True, locked_indices={5})
        return ruled, corrections

    current_tmz5_feature = feature_for(current_tmz5)
    current_wpz5_feature = feature_for(wpz[4])
    if (
        valid_gray_pose_feature(current_tmz5_feature)
        and not conflicts_pose5_existing_rows(current_tmz5)
    ):
        gray_name = current_tmz5
    elif (
        valid_gray_pose_feature(current_wpz5_feature)
        and not conflicts_pose5_existing_rows(wpz[4])
    ):
        gray_name = wpz[4]
    else:
        eligible_gray = [
            (filename, pose)
            for filename, pose in gray_variants
            if valid_gray_pose_feature(pose)
            and not conflicts_pose5_existing_rows(filename)
        ]
        if not eligible_gray:
            return ruled, corrections
        gray_name, _gray_feature = min(
            eligible_gray,
            key=lambda item: (pose5_score(item[1]), item[0].lower()),
        )
    previous_tmz5 = _text(ruled.get("tmz5"))
    previous_wpz5 = wpz[4]
    ruled["tmz5"] = gray_name
    wpz[4] = gray_name
    if previous_tmz5 != ruled["tmz5"]:
        corrections.append(
            "主图5未找到白底原图，已按姿势优先使用灰底原图："
            f"{previous_tmz5} -> {ruled['tmz5']}"
        )
    if (
        previous_tmz5 != ruled["tmz5"]
        or previous_wpz5 != wpz[4]
    ):
        corrections.append(
            "主图5未找到白底原图，已按姿势优先使用灰底原图："
            f"{previous_tmz5} / {previous_wpz5} -> {gray_name}"
        )
    repair_pose4_if_reused_by_pose5()
    repair_main_slot_duplicates(include_pose5=True)
    return ruled, corrections


def _apply_post_selection_quality_rules(
    category: str,
    slots: dict[str, Any],
    entries_by_name: dict[str, dict[str, Any]],
    *,
    outsole_entries_by_name: dict[str, dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Keep semantic consensus authoritative; legacy analyzers retain old repair rules."""

    has_consensus_evidence = any(
        isinstance(slots.get(key), (dict, list)) and bool(slots.get(key))
        for key in ("_model_votes", "_model_votes_by_batch")
    )
    if has_consensus_evidence:
        ruled = dict(slots)
        corrections: list[str] = []
        exact_tms_models: dict[str, set[str]] = {}
        for model_evidence in slots.get("_candidate_facts_by_model") or []:
            if not isinstance(model_evidence, dict):
                continue
            model_id = _text(model_evidence.get("model_id"))
            if not model_id:
                continue
            for fact in model_evidence.get("candidate_facts") or []:
                if not isinstance(fact, dict):
                    continue
                filename = _text(fact.get("filename"))
                stem = Path(filename).stem
                if not re.fullmatch(r"\d{12}\s*-\s*\d{5}", stem):
                    continue
                if filename not in entries_by_name:
                    continue
                asset_type = _text(fact.get("asset_type")).lower()
                shoe_count = _text(fact.get("shoe_count")).lower()
                background = _text(fact.get("background")).lower()
                pose = _text(fact.get("pose")).lower()
                matched_slots = {
                    shenhui_shoe_rules.normalize_slot_name(slot)
                    for slot in (fact.get("matched_slots") or [])
                }
                complete = fact.get("complete") is True or _text(
                    fact.get("complete")
                ).lower() in {"1", "true", "yes", "是", "完整"}
                feature_card = fact.get("feature_card") is True or _text(
                    fact.get("feature_card")
                ).lower() in {"1", "true", "yes", "是", "有"}
                if (
                    asset_type not in {"shoe", "footwear", "鞋", "鞋子"}
                    or shoe_count not in {"single", "one", "单只", "单鞋"}
                    or background not in {"white", "白", "白底"}
                    or not complete
                    or feature_card
                    or not (pose == "tmz5" or "tmz5" in matched_slots)
                ):
                    continue
                exact_tms_models.setdefault(filename, set()).add(model_id)
        verified_exact_tms = [
            (filename, models)
            for filename, models in exact_tms_models.items()
            if len(models) >= SHOE_POSE_CONSENSUS_REQUIRED_VOTES
        ]
        if verified_exact_tms:
            filename, models = min(
                verified_exact_tms,
                key=lambda item: (-len(item[1]), item[0].lower()),
            )
            previous_tmz5 = _text(ruled.get("tmz5"))
            ruled["tmz5"] = filename
            model_votes = dict(ruled.get("_model_votes") or {})
            model_votes["tmz5"] = {
                "status": "locked",
                "selected": filename,
                "selected_family": _copy_variant_key(filename),
                "votes": len(models),
                "required_votes": SHOE_POSE_CONSENSUS_REQUIRED_VOTES,
                "models": sorted(models),
                "candidates": {
                    _copy_variant_key(filename): sorted(models),
                },
                "source": "verified_exact_tms_contract",
            }
            ruled["_model_votes"] = model_votes
            if previous_tmz5 != filename:
                corrections.append(
                    f"tmz5 已按双模型验证的款号-色号白底单鞋纠正："
                    f"{previous_tmz5 or '空'} -> {filename}"
                )
        # Models vote on a pose family, while the source often contains a white
        # ``拷贝`` export and its gray-background original under the same family
        # key.  Keep the semantic vote authoritative, but normalize main poses
        # 1-4 to the original gray variant required by the output contract.
        gray_originals_by_family: dict[str, list[str]] = {}
        for candidate_name, entry in entries_by_name.items():
            if _is_copy_variant_filename(candidate_name):
                continue
            candidate_path = entry.get("path") if isinstance(entry, dict) else None
            if not candidate_path or not Path(candidate_path).is_file():
                continue
            candidate_feature = _binary_pose_feature(candidate_path)
            if not (
                candidate_feature.valid
                and 235.0
                <= candidate_feature.background_luma
                < SHOE_WHITE_BACKGROUND_LUMA
            ):
                continue
            gray_originals_by_family.setdefault(
                _copy_variant_key(candidate_name),
                [],
            ).append(candidate_name)

        normalized_families: set[str] = set()
        for index in range(1, 5):
            slot = f"tmz{index}"
            selected = _text(ruled.get(slot))
            if not selected or not _is_copy_variant_filename(selected):
                continue
            selected_entry = entries_by_name.get(selected) or {}
            selected_path = selected_entry.get("path")
            if not selected_path or not Path(selected_path).is_file():
                continue
            selected_feature = _binary_pose_feature(selected_path)
            if not (
                selected_feature.valid
                and selected_feature.background_luma >= SHOE_WHITE_BACKGROUND_LUMA
            ):
                continue
            family = _copy_variant_key(selected)
            gray_candidates = gray_originals_by_family.get(family) or []
            if not gray_candidates:
                continue
            replacement = min(
                gray_candidates,
                key=lambda candidate_name: (
                    abs(
                        _binary_pose_feature(
                            entries_by_name[candidate_name]["path"]
                        ).background_luma
                        - 242.0
                    ),
                    candidate_name.lower(),
                ),
            )
            _replace_consensus_slot_value(ruled, slot, replacement)
            model_votes = dict(ruled.get("_model_votes") or {})
            vote = dict(model_votes.get(slot) or {})
            vote.update({
                "selected": replacement,
                "selected_family": family,
                "variant_source": "verified_gray_copy_variant",
                "voted_variant": selected,
            })
            model_votes[slot] = vote
            ruled["_model_votes"] = model_votes
            if family not in normalized_families:
                corrections.append(
                    f"{slot}/wpz{index} 已保留双模型姿势族并改用灰底原图："
                    f"{selected} -> {replacement}"
                )
                normalized_families.add(family)
        return ruled, corrections
    return _apply_selection_quality_rules(
        category,
        slots,
        entries_by_name,
        outsole_entries_by_name=outsole_entries_by_name,
    )


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
    matched["o"] = match_source(_text(anchor_slots.get("o")), optional=True)
    wpz_sources = _selection_array(anchor_slots, "wpz", 6)
    matched["wpz"] = [
        match_source(
            source,
            match_kind="shoe_box" if index == 6 else "pose",
        )
        for index, source in enumerate(wpz_sources, start=1)
    ]
    matched["yq"] = [
        match_source(source)
        for source in _selection_array(anchor_slots, "yq", 3)
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
    overview_sheet_count: int = 0,
    candidate_scope: str = "batch",
    main_pose_reference_count: int = 0,
) -> str:
    candidate_text = "\n".join(f"{key}={value}" for key, value in candidate_ids.items())
    candidate_sheet_count = max(1, int(candidate_sheet_count))
    overview_sheet_count = max(0, int(overview_sheet_count))
    main_pose_reference_count = max(0, int(main_pose_reference_count))
    is_global_pages = candidate_scope == SHOE_POSE_STRATEGY_GLOBAL_PAGES
    is_single_sheet = candidate_scope == SHOE_POSE_STRATEGY_SINGLE_SHEET
    is_focused = candidate_scope == SHOE_POSE_STRATEGY_FOCUSED
    is_batch_with_overview = overview_sheet_count > 0
    candidate_scope_rule = ""
    if is_focused:
        candidate_scope_rule = (
            "\n本轮是 global_pages 后的 focused finalist 复核：前面的候选图合起来"
            "已经包含所有页级模型曾为必需槽位提名的候选族。必须把这些 finalist "
            "放在同一轮直接横向比较，再逐候选返回可校验事实 candidates。"
            "页级票数只能决定进入 finalist，不能代替本轮模板语义判断。"
            "不要直接填写完整 slots；槽位由本地硬规则和本轮独立模型共识锁定。"
        )
    elif is_global_pages:
        candidate_scope_rule = (
            "\n本轮是 global_pages 分页全局识别：第一张图只包含本色当前页候选，"
            "不是本色全部候选；每个候选只出现一次且使用全局稳定编号。"
            "不要直接填写完整 slots；必须逐候选返回可校验事实 candidates，"
            "由本地 SlotRule 规则引擎统一锁定 tmz/wpz/yq/o/yx 槽位。"
        )
    elif is_single_sheet:
        candidate_scope_rule = (
            "\n本轮是全量候选大图一次性识别：第一张图已经包含本色全部候选，"
            "必须在所有候选编号中逐张返回可校验事实 candidates。"
            "不要直接填写完整 slots；槽位由本地硬规则和独立模型共识锁定。"
        )
    elif is_batch_with_overview:
        candidate_scope_rule = (
            "\n本轮是多批次识别：第一张图是当前可返回的候选批次；"
            "后面的全景图只用于理解本色全部候选、相似姿势分布和缺图可能性。"
            "逐张返回可校验事实 candidates，且返回 JSON 只能引用“候选编号”列表中的当前批次编号，"
            "不能引用全景图里但不在当前批次编号列表中的图片；"
            "不要直接填写完整 slots。"
        )
    else:
        candidate_scope_rule = (
            "\n本轮是多批次识别：只处理本批次候选；"
            "逐张返回可校验事实 candidates，不要直接填写完整 slots。"
        )
    reference_offset = candidate_sheet_count + overview_sheet_count
    if is_global_pages:
        reference_start = candidate_sheet_count + 1
        if candidate_sheet_count == 1:
            candidate_order = "第一张图是带编号的本色当前页候选原图；"
        else:
            candidate_order = f"前{candidate_sheet_count}张图都是带编号的本色当前页候选原图；"
        if main_pose_reference_count:
            poster_index = reference_start + main_pose_reference_count
            yq_index = poster_index + 1
            image_order = (
                candidate_order +
                f"第{reference_start}到第{poster_index - 1}张图是当前品类的主图位切片参考，"
                "按顺序一一对应 tmz1、tmz2、tmz3、tmz4、tmz5；"
                f"第{poster_index}张图是鞋品海报姿势模板，"
                f"第{yq_index}张图是 yq 三姿势参考模板。"
            )
        else:
            image_order = (
                candidate_order +
                f"第{reference_start}张图是当前品类 tmz1..tmz5 主图位合并参考，"
                f"第{reference_start + 1}张图是 yq 三姿势参考模板。"
            )
    elif main_pose_reference_count:
        reference_start = reference_offset + 1
        poster_index = reference_start + main_pose_reference_count
        yq_index = poster_index + 1
        if is_focused:
            candidate_order = (
                "第一张图是带编号的全部 finalist 候选原图；"
                if candidate_sheet_count == 1
                else f"前{candidate_sheet_count}张图合起来是带编号的全部 finalist 候选原图；"
            )
        elif is_single_sheet:
            candidate_order = "第一张图是带编号的本色全部候选原图；"
        elif candidate_sheet_count == 1:
            candidate_order = "第一张图是带编号的本色当前批次候选原图；"
        else:
            candidate_order = f"前{candidate_sheet_count}张图都是带编号的本色候选原图；"
        if overview_sheet_count:
            overview_start = candidate_sheet_count + 1
            overview_end = candidate_sheet_count + overview_sheet_count
            if overview_start == overview_end:
                candidate_order += f"第{overview_start}张图是本色全部候选全景上下文；"
            else:
                candidate_order += f"第{overview_start}到第{overview_end}张图是本色全部候选全景上下文；"
        image_order = (
            candidate_order +
            f"第{reference_start}到第{poster_index - 1}张图是当前品类的主图位切片参考，"
            "按顺序一一对应 tmz1、tmz2、tmz3、tmz4、tmz5；"
            f"第{poster_index}张图是鞋品海报姿势模板，"
            f"第{yq_index}张图是 yq 三姿势参考模板。"
        )
    elif candidate_sheet_count == 1:
        first_text = (
            "第一张图是带编号的本色全部候选原图"
            if is_single_sheet or is_focused
            else "第一张图是带编号的本色当前批次候选原图"
        )
        if overview_sheet_count:
            image_order = (
                f"{first_text}，第二张图是本色全部候选全景上下文，"
                "第三张图是鞋品主图姿势模板，"
                "第四张图是鞋品海报姿势模板，第五张图是 yq 三姿势参考模板。"
            )
        else:
            image_order = (
                f"{first_text}，第二张图是鞋品主图姿势模板，"
                "第三张图是鞋品海报姿势模板，"
                "第四张图是 yq 三姿势参考模板。"
            )
    else:
        reference_start = reference_offset + 1
        overview_text = ""
        if overview_sheet_count:
            overview_start = candidate_sheet_count + 1
            overview_end = candidate_sheet_count + overview_sheet_count
            overview_text = (
                f"第{overview_start}到第{overview_end}张图是本色全部候选全景上下文；"
            )
        image_order = (
            f"前{candidate_sheet_count}张图都是带编号的本色候选原图；"
            f"{overview_text}"
            f"第{reference_start}张图是鞋品主图姿势模板，"
            f"第{reference_start + 1}张图是鞋品海报姿势模板，"
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
        poster_rule = {
            "雪地": "复用该品类 tmz1/wpz1 的两只雪地靴/秋冬拖鞋/运动靴完整同框姿势",
            "运动": "复用该品类 tmz2/wpz2 的前方一只完整鞋、后方另一只鞋底朝向镜头姿势",
            "婴童": "复用该品类 tmz1/wpz1 的两只鞋完整同框姿势",
            "休闲": "复用该品类 tmz1/wpz1 的公主鞋/皮鞋/靴子/女生凉鞋斜前方双鞋姿势",
        }[forced_category]
        pose5_extra = ""
        if forced_category == "婴童":
            pose5_extra = (
                "婴童海报图不允许选择旧版主图5那种一只侧身或单只鞋展示；"
                "必须是两只鞋完整同框。\n"
            )
        elif forced_category == "休闲":
            pose5_extra = "休闲海报图不要选择两只鞋竖向上下分开的旧版俯视对角线图。\n"
        forced_rule = (
            f"\n本款品类已由 Excel 确定为“{forced_category}”，"
            f"只能按模板{category_column}选择姿势；不得自行改判品类，"
            f'shoe_category 必须返回“{forced_category}”。'
            "新版规则中主图5和海报图已经拆开："
            "tmz1/wpz1 必须选择该品类主图模板第1行的一双鞋或双鞋 3/4 完整展示；"
            "tmz5 必须优先选择原始白底单只鞋斜向展示图；"
            "若确实没有白底候选，按姿势选择灰底原图作为 fallback；"
            "不能用两只鞋组合图，不能把灰底图改成白底图；"
            f"o 海报图必须选择：{poster_rule}。"
            + (pose5_extra or "\n")
        )
    return_format = (
        '{"color_name":"包含中文颜色和5位色码的名称","shoe_category":"运动|休闲|雪地|婴童",'
        '"candidates":['
        '{"candidate_id":"I01","filename":"原文件名.jpg","asset_type":"shoe|shoe_box|feature_card|other",'
        '"shoe_count":"single|pair|other","pose":"tmz1|tmz2|tmz3|tmz4|tmz5|yq2|yq3|wpz5|wpz6|yx|other",'
        '"background":"white|gray|other","complete":true,'
        '"side":"outer|inner|front|rear|side_rear|sole|mixed|unknown",'
        '"outsole_visible":false,"feature_card":false,'
        '"matched_slots":["tmz1","wpz1"],"confidence":0.92}'
        ']}'
    )
    return f"""款号：{style_code}
色码：{color_code}
{image_order}
{candidate_scope_rule}
主图模板四列从左到右依次为：雪地靴/秋冬拖鞋/运动靴、运动鞋/板鞋、婴童、公主鞋/皮鞋/靴子/女生凉鞋；每列从上到下是主图姿势1至5。
海报模板从左到右依次为：运动鞋+板鞋、婴童鞋、雪地靴+秋冬拖鞋+运动靴、公主鞋+皮鞋+靴子+女生凉鞋。
{forced_rule}

文件名确定性约束：形如“12位款号-5位色码.jpg”的本色标准图是 tms/tmz5 强候选，
必须先目视确认它是白底、完整、单只鞋；它绝不是鞋盒 wpz6。wpz6 必须能看到实体鞋盒及其款号/颜色标签。

选择规则：
1. tmz1..tmz5 是天猫5张主图；wpz1..wpz4 与天猫前4张姿势相同。
   如果本次输入提供了当前品类的 5 张主图位切片参考，必须优先逐张对照这些参考图判断 tmz1..tmz5，不要只按文字描述猜姿势。
   tmz1/wpz1 必须匹配最新主图模板第1行：按品类选择一双鞋或双鞋 3/4 斜前方完整展示，
   能同时看清鞋面、鞋头、鞋身外侧和整体造型；不能再按旧规则选择单只鞋、鞋垫、单独鞋底、鞋盒、吊牌、小配件或局部特写。
   tmz2..tmz4 匹配该品类模板第2至4姿势；tmz5 是新版主图5，必须优先挑选原始白底单只鞋斜向展示图；
   如果确实找不到白底候选，按姿势优先选择灰底原图作为 fallback。
   不能选择灰底图后改白底，不能选择旧版第五姿势的两只鞋组合图、鞋垫、单独鞋底、鞋盒或局部特写。
   所有品类的 tmz2/wpz2 都必须是：前方一只完整鞋正常展示，后方另一只完整鞋的鞋底朝向镜头。
   禁止选择两只鞋同向、并排、悬空的图，也禁止鞋垫、单鞋、单独鞋底或局部特写。
   所有品类的 tmz3/wpz3 都必须是单只鞋竖立或悬立、鞋身近似纵向的姿势；
   必须展示鞋子的完整外侧轮廓，鞋头不能正对镜头；不能选择“鞋头朝镜头”的正面竖立图，
   也不能选择正常平放的侧视图、普通斜前方单鞋图，或复用 tmz1/wpz1、yq3。
   除雪地靴/秋冬拖鞋/运动靴外，其他品类的 tmz4/wpz4 都按主图模板第4行的同一姿势族选择：完整单鞋后侧或侧后角度。
   雪地是唯一特殊主图4：必须是完整鞋口内里图，画面要同时看见鞋口绒毛/内里和鞋帮侧面，不能只裁到鞋面或鞋头。
   雪地第4姿势不能选择拉链、鞋帮外侧、普通侧面特写、鞋面/鞋头局部裁切图；
   非雪地主图4不能误用 yq3 的完整外侧面。
2. wpz 共6张，wpz1..wpz4 与天猫前4张姿势相同；wpz5 优先选择与 tmz5 同姿势的灰底原图，wpz6 必须是带款号和颜色标签的鞋盒图。
   如果没有同姿势灰底原图，仍按候选原图返回，程序不会把白底或灰底图片改色。
3. o 是主推色必需的海报图，新版海报姿势与主图5不同，不要再把 tmz5/wpz5 当海报图。
   运动鞋/板鞋海报固定复用 tmz2/wpz2 的“前方一只鞋+后方一只鞋底朝镜头”姿势；
   雪地靴/秋冬拖鞋/运动靴海报固定复用 tmz1/wpz1；
   婴童海报固定复用 tmz1/wpz1；
   公主鞋/皮鞋/靴子/女生凉鞋海报固定复用 tmz1/wpz1。
   非主推色不输出 o.jpg。
4. yq 必须且只能返回3张，按第四张参考模板从左到右依次匹配：斜前方鞋+后方鞋底、完整鞋底平铺、完整外侧面。不要把 AI 角度图、颜色图或其他展示图放进 yq。
5. yk 不用选择，程序会合并主推色云盘中的 1.jpg..N.jpg 和主推色云盘中已经命名为 yk1..ykN 的细节图；细节有几张就输出几张，非主推色不输出 yk。
   雪地款缺少独立 yk 细节图时，程序会优先复用未占用的鞋口内里细节原图；若没有独立细节图，会从正确的雪地第4姿势鞋口内里图裁切生成 yk1。
   yx 只允许选择“鞋子主体与一张或多张功能吊牌/功能卡同框”的完整展示图。
   单独鞋垫、单独吊牌、鞋盒、普通鞋子图或局部特写都不是 yx；找不到合格图片必须返回空字符串。
6. tms 不用选择，程序会按“12位款号-5位色码”文件名确定。
7. 只有模板明确要求复用或姿势等价的槽位可以复用同一姿势，例如 o 复用 tmz1/tmz2、wpz1..wpz4 复用 tmz1..tmz4、wpz5 匹配 tmz5、yq1 与 tmz2 都匹配前鞋加后鞋底姿势。
   tmz1..tmz5 彼此必须按模板行位区分，不能用同一张图、拷贝图、白底/灰底同姿势图或近重复姿势互相占位。
8. 如果本次候选图里没有某个槽位要求的姿势，该槽位必须返回空字符串或空数组，
   不要为了凑齐而强行选择相似但不正确的图；程序会合并其他批次并按缺图规则跳过。

候选编号：
{candidate_text}

返回格式：
{return_format}"""


def _shoe_targeted_slot_prompt(
    style_code: str,
    color_code: str,
    candidate_ids: dict[str, str],
    shoe_category: str,
    *,
    target_slot: str,
    candidate_sheet_count: int,
    has_reference_image: bool,
) -> str:
    """Ask one model route to arbitrate exactly one unresolved semantic slot."""

    target_slot = shenhui_shoe_rules.normalize_slot_name(target_slot)
    if target_slot not in SHOE_FULL_POSE_REQUIRED_CONSENSUS_SLOTS:
        raise ShoeSelectionError(f"不支持的鞋品单槽位裁决：{target_slot or '空'}")
    candidate_sheet_count = max(1, int(candidate_sheet_count or 1))
    if candidate_sheet_count == 1:
        image_order = "第一张图包含全部候选"
    else:
        image_order = f"前{candidate_sheet_count}张图合起来包含全部候选"
    if has_reference_image:
        image_order += (
            "；每张候选面板顶部都有同一张 REFERENCE TEMPLATE / 不可选精确模板，"
            "只能作为视觉参照，不能作为候选编号返回"
            f"；第{candidate_sheet_count + 1}张图是 {target_slot} 的唯一精确模板"
        )
    else:
        image_order += "；本槽位没有额外模板图，必须严格按下述确定性规则判断"

    slot_rules = {
        "tmz1": "完整双鞋或一双鞋的斜前方 3/4 展示，姿势必须与精确模板一致",
        "tmz2": (
            "前方一只完整鞋正常展示，后方另一只完整鞋的鞋底朝向镜头；"
            "两鞋同向、并排、悬空、单鞋或单独鞋底都不合格"
        ),
        "tmz3": (
            "完整单鞋竖立或悬立，鞋身近似纵向并展示完整外侧轮廓；"
            "普通平放侧视、斜前方单鞋和鞋头正对镜头都不合格"
        ),
        "tmz4": (
            "非雪地必须是完整单鞋后侧或侧后角度；雪地必须同时看见鞋口内里和鞋帮侧面"
        ),
        "tmz5": "原始白底完整单只鞋斜向展示，只有确实无白底候选时才接受同姿势灰底原图",
        "wpz5": (
            "必须是与 tmz5 精确模板同姿势的灰底原图，完整单只鞋；"
            "白底标准图、yk 局部细节、双鞋图和鞋盒都不合格"
        ),
        "wpz6": "必须是能看到实体鞋盒以及款号和颜色标签的鞋盒标签图，普通鞋图绝不合格",
        "yq1": (
            "完整双鞋组合，前鞋斜前方展示，后鞋鞋底朝向镜头；"
            "必须独立对照 yq1 精确模板；若同一候选也精确匹配等价的 tmz2 模板则允许复用"
        ),
        "yq2": "完整鞋底平铺并朝向镜头，不接受局部鞋底、斜角鞋身或普通侧视图",
        "yq3": "无遮挡的完整单鞋外侧面，鞋头到鞋跟完整可见；内侧、竖立、鞋底和功能卡图都不合格",
    }
    candidate_text = "\n".join(
        f"{candidate_id}={filename}"
        for candidate_id, filename in candidate_ids.items()
    )
    return_format = (
        '{"color_name":"中文款色名+5位色号",'
        f'"shoe_category":"{_text(shoe_category)}",'
        '"candidates":[{'
        '"candidate_id":"I01","filename":"原文件名.jpg",'
        '"asset_type":"shoe|shoe_box|other",'
        '"shoe_count":"single|pair|other",'
        f'"pose":"{target_slot}|other","background":"white|gray|other",'
        '"complete":true,"side":"outer|inner|front|rear|side_rear|sole|mixed|unknown",'
        '"outsole_visible":false,"feature_card":false,'
        f'"matched_slots":["{target_slot}"],"confidence":0.96}}]}}'
    )
    return f"""款号：{style_code}
色码：{color_code}
品类：{_text(shoe_category)}
{image_order}。

本轮只裁决 {target_slot}，不要同时判断其他槽位，也不要返回 slots。
目标规则：{slot_rules[target_slot]}。
必须横向比较全部候选，只允许把最匹配且完全满足规则的一个候选标记为
matched_slots=["{target_slot}"]；其他候选的 matched_slots 必须为空数组。
若没有完全匹配者，所有候选 matched_slots 都返回空数组，禁止为凑票选择近似姿势。
每个候选都要返回可校验事实；candidate_id 和 filename 必须来自下列清单。

候选编号：
{candidate_text}

返回格式：
{return_format}"""


def _create_contact_sheet(
    entries: list[dict[str, Any]],
    target: Path,
    *,
    start_index: int = 1,
    candidate_labels: list[str] | None = None,
    columns: int = 4,
    tile_width: int = 240,
    image_height: int = 180,
    label_height: int = 28,
    quality: int = 68,
) -> dict[str, str]:
    from PIL import Image, ImageDraw, ImageFont, ImageOps

    columns = max(1, int(columns))
    tile_width = max(80, int(tile_width))
    image_height = max(80, int(image_height))
    label_height = max(18, int(label_height))
    rows = max(1, (len(entries) + columns - 1) // columns)
    sheet = Image.new("RGB", (tile_width * columns, (image_height + label_height) * rows), "white")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    candidate_ids: dict[str, str] = {}

    for offset, entry in enumerate(entries):
        index = start_index + offset
        candidate_id = (
            _text(candidate_labels[offset])
            if candidate_labels and offset < len(candidate_labels)
            else f"I{index:02d}"
        )
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
        draw.text((left + 5, top + image_height + 6), label[:30], fill="black", font=font)

    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target, format="JPEG", quality=quality, optimize=True)
    return candidate_ids


def _create_contact_overview_sheet(
    entries: list[dict[str, Any]],
    target: Path,
) -> dict[str, str]:
    return _create_contact_sheet(
        entries,
        target,
        start_index=1,
        columns=6,
        tile_width=160,
        image_height=120,
        label_height=24,
        quality=62,
    )


def _create_single_contact_sheet(
    entries: list[dict[str, Any]],
    target: Path,
) -> dict[str, str]:
    return _create_contact_sheet(
        entries,
        target,
        start_index=1,
        columns=4,
        tile_width=240,
        image_height=180,
        label_height=28,
        quality=68,
    )


def _create_global_page_contact_sheets(
    entries: list[dict[str, Any]],
    target: Path,
) -> tuple[list[Path], dict[str, str]]:
    sheets: list[Path] = []
    candidate_ids: dict[str, str] = {}
    chunk_size = SHOE_GLOBAL_PAGE_CHUNK_SIZE
    for chunk_index, start in enumerate(range(0, len(entries), chunk_size), start=1):
        chunk = entries[start:start + chunk_size]
        chunk_target = target.with_name(f"{target.stem}-global-{chunk_index}{target.suffix}")
        candidate_ids.update(
            _create_contact_sheet(
                chunk,
                chunk_target,
                start_index=start + 1,
                columns=4,
                tile_width=240,
                image_height=180,
                label_height=28,
                quality=68,
            )
        )
        sheets.append(chunk_target)
    return sheets, candidate_ids


def _create_focused_contact_sheets(
    candidate_ids: dict[str, str],
    entries_by_name: dict[str, dict[str, Any]],
    target: Path,
) -> tuple[list[Path], dict[str, str]]:
    sheets: list[Path] = []
    rendered_ids: dict[str, str] = {}
    items = [
        (candidate_id, filename, entries_by_name.get(filename))
        for candidate_id, filename in candidate_ids.items()
    ]
    missing = [filename for _candidate_id, filename, entry in items if not entry]
    if missing:
        raise ShoeSelectionError(
            "focused finalist 缺少原图：" + "、".join(missing[:8])
        )
    for chunk_index, start in enumerate(
        range(0, len(items), SHOE_GLOBAL_PAGE_CHUNK_SIZE),
        start=1,
    ):
        chunk = items[start:start + SHOE_GLOBAL_PAGE_CHUNK_SIZE]
        chunk_target = target.with_name(
            f"{target.stem}-{chunk_index}{target.suffix}"
        )
        labels = [candidate_id for candidate_id, _filename, _entry in chunk]
        entries = [entry for _candidate_id, _filename, entry in chunk if entry]
        rendered_ids.update(_create_contact_sheet(
            entries,
            chunk_target,
            candidate_labels=labels,
            columns=4,
            tile_width=240,
            image_height=180,
            label_height=28,
            quality=72,
        ))
        sheets.append(chunk_target)
    return sheets, rendered_ids


def _embed_reference_template_header(
    sheet_path: Path,
    reference_image: Path | str,
    target_slot: str,
) -> None:
    from PIL import Image, ImageDraw, ImageFont, ImageOps

    reference_path = Path(_text(reference_image))
    if not reference_path.is_file():
        return
    header_height = 360
    label_height = 34
    with Image.open(sheet_path) as opened_sheet:
        sheet = _image_rgb_on_white(ImageOps.exif_transpose(opened_sheet))
    with Image.open(reference_path) as opened_reference:
        reference = _image_rgb_on_white(ImageOps.exif_transpose(opened_reference))
    reference.thumbnail((sheet.width - 48, header_height - label_height - 18), Image.Resampling.LANCZOS)
    combined = Image.new("RGB", (sheet.width, sheet.height + header_height), "white")
    draw = ImageDraw.Draw(combined)
    font = ImageFont.load_default()
    draw.rectangle((0, 0, sheet.width, header_height), fill=(255, 252, 238), outline=(214, 55, 55), width=3)
    draw.text(
        (12, 10),
        f"REFERENCE TEMPLATE / 不可选 - {target_slot}",
        fill=(160, 32, 32),
        font=font,
    )
    x = (sheet.width - reference.width) // 2
    y = label_height + (header_height - label_height - reference.height) // 2
    combined.paste(reference, (x, y))
    draw.rectangle((x, y, x + reference.width, y + reference.height), outline=(214, 55, 55), width=2)
    combined.paste(sheet, (0, header_height))
    combined.save(sheet_path, format="JPEG", quality=82, optimize=True)


def _create_targeted_slot_contact_sheets(
    target_slot: str,
    candidate_ids: dict[str, str],
    entries_by_name: dict[str, dict[str, Any]],
    target: Path,
    *,
    round_index: int,
    reference_image: Path | str = "",
) -> tuple[list[Path], dict[str, str]]:
    """Render large, stable-ID panels for one exact-template arbitration."""

    target_slot = shenhui_shoe_rules.normalize_slot_name(target_slot)
    if target_slot not in SHOE_FULL_POSE_REQUIRED_CONSENSUS_SLOTS:
        raise ShoeSelectionError(
            f"不支持的鞋品单槽位候选面板：{target_slot or '空'}"
        )
    items = [
        (candidate_id, filename, entries_by_name.get(filename))
        for candidate_id, filename in candidate_ids.items()
    ]
    missing = [filename for _candidate_id, filename, entry in items if not entry]
    if missing:
        raise ShoeSelectionError(
            f"{target_slot} 单槽位候选面板缺少原图：" + "、".join(missing[:8])
        )

    sheets: list[Path] = []
    rendered_ids: dict[str, str] = {}
    panel_stem = target.stem
    if not panel_stem.endswith(f"-{target_slot}"):
        panel_stem += f"-{target_slot}"
    panel_base = target.with_name(
        f"{panel_stem}-round{max(1, int(round_index))}{target.suffix}"
    )
    for chunk_index, start in enumerate(range(0, len(items), 4), start=1):
        chunk = items[start:start + 4]
        chunk_target = panel_base.with_name(
            f"{panel_base.stem}-{chunk_index}{panel_base.suffix}"
        )
        rendered_ids.update(_create_contact_sheet(
            [entry for _candidate_id, _filename, entry in chunk if entry],
            chunk_target,
            candidate_labels=[candidate_id for candidate_id, _filename, _entry in chunk],
            columns=2,
            tile_width=420,
            image_height=320,
            label_height=34,
            quality=80,
        ))
        if _text(reference_image):
            _embed_reference_template_header(chunk_target, reference_image, target_slot)
        sheets.append(chunk_target)
    return sheets, rendered_ids


def _deduplicate_exact_image_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    import hashlib

    seen: set[tuple[int, str]] = set()
    deduped: list[dict[str, Any]] = []
    for entry in entries:
        path = Path(entry["path"])
        try:
            stat = path.stat()
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            deduped.append(entry)
            continue
        key = (stat.st_size, digest)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(entry)
    return deduped


def _create_contact_sheets(
    entries: list[dict[str, Any]],
    target: Path,
) -> tuple[list[Path], dict[str, str]]:
    sheets: list[Path] = []
    candidate_ids: dict[str, str] = {}
    chunk_size = SHOE_CONTACT_SHEET_CHUNK_SIZE
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


def _create_pose_contact_inputs(
    entries: list[dict[str, Any]],
    target: Path,
    *,
    pose_strategy: str,
) -> tuple[list[Path], dict[str, str], Path | None]:
    strategy = normalize_shoe_pose_strategy(pose_strategy)
    if strategy == SHOE_POSE_STRATEGY_GLOBAL_PAGES:
        sheets, candidate_ids = _create_global_page_contact_sheets(entries, target)
        return sheets, candidate_ids, None
    if strategy == SHOE_POSE_STRATEGY_SINGLE_SHEET:
        full_target = target.with_name(f"{target.stem}-all{target.suffix}")
        candidate_ids = _create_single_contact_sheet(entries, full_target)
        return [full_target], candidate_ids, None

    sheets, candidate_ids = _create_contact_sheets(entries, target)
    overview_sheet = None
    if strategy == SHOE_POSE_STRATEGY_BATCH_OVERVIEW:
        overview_sheet = target.with_name(f"{target.stem}-overview{target.suffix}")
        _create_contact_overview_sheet(entries, overview_sheet)
    return sheets, candidate_ids, overview_sheet


def _create_model_input_preview(
    source: Path,
    target: Path,
    *,
    max_side: int = SHOE_MODEL_INPUT_MAX_SIDE,
) -> Path:
    from PIL import Image, ImageOps

    with Image.open(source) as opened:
        image = _image_rgb_on_white(ImageOps.exif_transpose(opened))
        image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(
            target,
            format="JPEG",
            quality=SHOE_MODEL_INPUT_JPEG_QUALITY,
            optimize=True,
        )
    return target


def _create_main_pose_reference_cells(
    source: Path,
    target_dir: Path,
) -> dict[str, list[Path]]:
    from PIL import Image, ImageOps

    target_dir.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as opened:
        image = _image_rgb_on_white(ImageOps.exif_transpose(opened))
    width, height = image.size
    references: dict[str, list[Path]] = {}
    for column_index, category in enumerate(SHOE_MAIN_TEMPLATE_CATEGORY_ORDER):
        slug = SHOE_MAIN_TEMPLATE_CATEGORY_SLUGS[category]
        category_refs: list[Path] = []
        for row_index in range(5):
            left = round(column_index * width / 4)
            right = round((column_index + 1) * width / 4)
            top = round(row_index * height / 5)
            bottom = round((row_index + 1) * height / 5)
            target = target_dir / f"{slug}-tmz{row_index + 1}.jpg"
            cell = image.crop((left, top, right, bottom))
            cell.thumbnail((900, 900), Image.Resampling.LANCZOS)
            cell.save(
                target,
                format="JPEG",
                quality=SHOE_MODEL_INPUT_JPEG_QUALITY,
                optimize=True,
            )
            category_refs.append(target)
        references[category] = category_refs
    return references


def _create_yq_reference_cells(
    source: Path,
    target_dir: Path,
) -> dict[str, Path]:
    """Cut the two-row yq template into its three semantic slot columns."""

    from PIL import Image, ImageOps

    target_dir.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as opened:
        image = _image_rgb_on_white(ImageOps.exif_transpose(opened))
    width, height = image.size
    references: dict[str, Path] = {}
    for column_index in range(3):
        slot = f"yq{column_index + 1}"
        left = round(column_index * width / 3)
        right = round((column_index + 1) * width / 3)
        target = target_dir / f"{slot}.jpg"
        cell = image.crop((left, 0, right, height))
        cell.thumbnail((900, 900), Image.Resampling.LANCZOS)
        cell.save(
            target,
            format="JPEG",
            quality=SHOE_MODEL_INPUT_JPEG_QUALITY,
            optimize=True,
        )
        references[slot] = target
    return references


def _create_main_pose_reference_sheet(
    sources: list[Path],
    target: Path,
) -> Path:
    from PIL import Image, ImageDraw, ImageFont, ImageOps

    opened_images = []
    try:
        for source in sources[:5]:
            with Image.open(source) as opened:
                image = _image_rgb_on_white(ImageOps.exif_transpose(opened))
                image.thumbnail((180, 180), Image.Resampling.LANCZOS)
                opened_images.append(image.copy())
        if not opened_images:
            raise ShoeSelectionError("鞋品主图合并参考缺少切片")
        tile_width = 190
        label_height = 26
        height = max(image.height for image in opened_images) + label_height
        sheet = Image.new("RGB", (tile_width * len(opened_images), height), "white")
        draw = ImageDraw.Draw(sheet)
        font = ImageFont.load_default()
        for offset, image in enumerate(opened_images):
            left = offset * tile_width
            x = left + (tile_width - image.width) // 2
            y = (height - label_height - image.height) // 2
            sheet.paste(image, (x, y))
            draw.rectangle(
                (left, height - label_height, left + tile_width, height),
                fill=(245, 245, 245),
            )
            draw.text((left + 8, height - label_height + 7), f"tmz{offset + 1}", fill="black", font=font)
        target.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(
            target,
            format="JPEG",
            quality=SHOE_MODEL_INPUT_JPEG_QUALITY,
            optimize=True,
        )
        return target
    finally:
        for image in opened_images:
            image.close()


def _candidate_id_number(candidate_id: Any) -> int | None:
    match = re.search(r"(\d+)", _text(candidate_id))
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def _candidate_ids_for_contact_sheet(
    candidate_ids: dict[str, str],
    sheet_index: int,
) -> dict[str, str]:
    start = (max(1, int(sheet_index)) - 1) * SHOE_CONTACT_SHEET_CHUNK_SIZE + 1
    end = start + SHOE_CONTACT_SHEET_CHUNK_SIZE - 1
    selected = {
        key: value
        for key, value in candidate_ids.items()
        if (number := _candidate_id_number(key)) is not None
        and start <= number <= end
    }
    return selected or (candidate_ids if sheet_index == 1 else {})


def _candidate_ids_for_global_page(
    candidate_ids: dict[str, str],
    page_index: int,
) -> dict[str, str]:
    start = (max(1, int(page_index)) - 1) * SHOE_GLOBAL_PAGE_CHUNK_SIZE + 1
    end = start + SHOE_GLOBAL_PAGE_CHUNK_SIZE - 1
    selected = {
        key: value
        for key, value in candidate_ids.items()
        if (number := _candidate_id_number(key)) is not None
        and start <= number <= end
    }
    return selected or (candidate_ids if page_index == 1 else {})


def _notify_shoe_model_progress(
    progress,
    stage: str,
    *,
    style_code: str,
    color_code: str,
) -> None:
    if callable(progress):
        progress(stage, style_code=style_code, color_code=color_code)


def _validate_pose_payload_references(
    payload: dict[str, Any],
    candidate_ids: dict[str, str],
) -> None:
    if not isinstance(payload, dict):
        raise llm_gateway.LlmResponseError("鞋品姿势识别未返回 JSON 对象")
    if shenhui_shoe_rules.has_candidate_facts_payload(payload):
        valid_ids = set(candidate_ids)
        candidate_names = set(candidate_ids.values())
        missing = []
        for fact in shenhui_shoe_rules.parse_candidate_facts(payload, candidate_ids):
            if fact.candidate_id not in valid_ids or fact.filename not in candidate_names:
                missing.append(f"{fact.candidate_id}={fact.filename}")
        if missing:
            raise llm_gateway.LlmResponseError(
                "识别候选事实引用了不存在的候选图：" + "、".join(missing[:5])
            )
        return
    slots = payload.get("slots")
    if not isinstance(slots, dict):
        raise llm_gateway.LlmResponseError("鞋品姿势识别缺少 slots")
    candidate_names = set(candidate_ids.values())
    missing = []
    for key, value in slots.items():
        values = value if isinstance(value, list) else [value]
        for item in values:
            resolved = _resolve_candidate_value(item, candidate_ids)
            if resolved and candidate_names and resolved not in candidate_names:
                missing.append(f"{key}={resolved}")
    if missing:
        raise llm_gateway.LlmResponseError(
            "识别结果引用了不存在的候选图：" + "、".join(missing[:5])
        )


def _ensure_pose_image_input_limit(
    image_inputs: list[str],
    *,
    style_code: str,
    color_code: str,
    pose_strategy: str,
) -> None:
    if len(image_inputs) <= SHOE_MULTIMODAL_IMAGE_INPUT_LIMIT:
        return
    raise ShoeSelectionError(
        f"{style_code}-{color_code} 鞋品姿势识别输入图片 {len(image_inputs)} 张，"
        f"超过网关上限 {SHOE_MULTIMODAL_IMAGE_INPUT_LIMIT} 张；"
        f"策略 {pose_strategy} 已拒绝继续，避免模型静默截断候选图"
    )


def _validate_label_ocr_payload(
    payload: Any,
    *,
    style_code: str,
    color_code: str,
) -> None:
    if not isinstance(payload, dict):
        raise llm_gateway.LlmResponseError("鞋盒标签 OCR 未返回 JSON 对象")
    expected_style = _text(style_code)
    expected_color = _text(color_code)
    read_style = _text(payload.get("style_code") or payload.get("款号"))
    if read_style != expected_style:
        raise llm_gateway.LlmResponseError(
            f"鞋盒标签 OCR 款号不一致：{read_style or '空'}，期望 {expected_style}"
        )
    read_color_code = _text(payload.get("color_code"))
    color_name = _text(payload.get("color_name"))
    if read_color_code != expected_color:
        raise llm_gateway.LlmResponseError(
            f"鞋盒标签 OCR 色码不一致：{read_color_code or '空'}，期望 {expected_color}"
        )
    if not color_name:
        raise llm_gateway.LlmResponseError("鞋盒标签 OCR 未返回颜色名称")
    color_codes_in_name = re.findall(r"\d{5}", color_name)
    if color_codes_in_name and expected_color not in color_codes_in_name:
        raise llm_gateway.LlmResponseError(
            "鞋盒标签 OCR 颜色名称中的色码不一致："
            + "、".join(color_codes_in_name[:3])
            + f"，期望 {expected_color}"
        )
    if _normalized_bbox(payload.get("label_bbox")) is None:
        raise llm_gateway.LlmResponseError("鞋盒标签 OCR 未返回有效标签坐标")
    if _normalized_bbox(payload.get("style_code_bbox")) is None:
        raise llm_gateway.LlmResponseError("鞋盒标签 OCR 未返回有效款号文字坐标")


def _verify_label_payload_with_local_ocr(
    payload: dict[str, Any],
    *,
    label_source_image: Path | str,
    style_code: str,
    color_code: str,
) -> dict[str, Any]:
    _validate_label_ocr_payload(
        payload,
        style_code=style_code,
        color_code=color_code,
    )
    label_bbox = _normalized_bbox(payload.get("label_bbox"))
    if label_bbox is None:
        raise llm_gateway.LlmResponseError("鞋盒标签 OCR 未返回有效标签坐标")
    try:
        transcription = ocr_service.extract_shoe_label_fields(
            label_source_image,
            label_bbox=label_bbox,
            expected_color_code=color_code,
        )
    except Exception as exc:
        raise llm_gateway.LlmResponseError(
            f"鞋盒标签本地 OCR 失败：{_text(exc)}"
        ) from exc
    refined = dict(payload)
    exact_style_bbox_source = ""
    try:
        exact_style_bbox = ocr_service.locate_exact_style_code_bbox(
            label_source_image,
            style_code=style_code,
            label_bbox=label_bbox,
        )
    except Exception:
        exact_style_bbox = None
    if exact_style_bbox is not None:
        refined["style_code_bbox"] = [value * 1000.0 for value in exact_style_bbox]
        exact_style_bbox_source = "local_tesseract_exact_style_code"
    exact_color_name = _text(transcription.get("color_name"))
    recovered_label_bbox: tuple[float, float, float, float] | None = None
    if not exact_color_name:
        style_bbox = _normalized_bbox(payload.get("style_code_bbox"))
        if style_bbox is not None:
            sx1, sy1, sx2, sy2 = style_bbox
            style_width = sx2 - sx1
            style_height = sy2 - sy1
            recovered_label_bbox = (
                max(0.0, sx1 - style_width * 0.70),
                max(0.0, sy1 - style_height * 0.50),
                min(1.0, sx2 + style_width * 0.50),
                min(
                    1.0,
                    max(0.0, sy1 - style_height * 0.50)
                    + max(style_height * 6.0, style_width * 2.15),
                ),
            )
            if recovered_label_bbox != label_bbox:
                try:
                    recovered = ocr_service.extract_shoe_label_fields(
                        label_source_image,
                        label_bbox=recovered_label_bbox,
                        expected_color_code=color_code,
                    )
                except Exception:
                    recovered = {}
                if _text(recovered.get("color_name")):
                    transcription = dict(recovered)
                    transcription["source"] = "local_tesseract_style_anchor_recovery"
                    exact_color_name = _text(transcription.get("color_name"))
    if not exact_color_name:
        # Some vision routes return a box that follows the printed border too
        # tightly.  On small shoe-box labels this can clip the left field name
        # or the final color digits after the OCR subregion is calculated.  A
        # bounded expansion preserves the model's label location while giving
        # local OCR enough context; acceptance still requires the exact
        # expected five-digit color code.
        x1, y1, x2, y2 = label_bbox
        width = x2 - x1
        height = y2 - y1
        expanded_label_bbox = (
            max(0.0, x1 - width * 0.20),
            max(0.0, y1 - height * 0.20),
            min(1.0, x2 + width * 0.20),
            min(1.0, y2 + height * 0.20),
        )
        if expanded_label_bbox not in {label_bbox, recovered_label_bbox}:
            try:
                expanded = ocr_service.extract_shoe_label_fields(
                    label_source_image,
                    label_bbox=expanded_label_bbox,
                    expected_color_code=color_code,
                )
            except Exception:
                expanded = {}
            if _text(expanded.get("color_name")):
                transcription = dict(expanded)
                transcription["source"] = "local_tesseract_expanded_label_recovery"
                exact_color_name = _text(transcription.get("color_name"))
                recovered_label_bbox = expanded_label_bbox
    if not exact_color_name:
        observed_text = _text(transcription.get("observed_text"))
        observed_digits = re.sub(r"\D", "", observed_text)
        if _text(style_code) not in observed_digits:
            raise llm_gateway.LlmResponseError(
                "鞋盒标签本地 OCR 未读到包含当前5位色号的完整“颜色”字段，"
                "且未确认当前完整款号"
            )
        model_color_name = _text(payload.get("color_name"))
        model_product_name = _text(payload.get("product_name"))
        local_product_name = _text(transcription.get("product_name"))
        if local_product_name and not model_product_name:
            refined["product_name"] = local_product_name
        refined["_label_transcription"] = {
            "source": "local_tesseract_style_identity_ai_color_fallback",
            "confidence": float(transcription.get("confidence") or 0.0),
            "region": _text(transcription.get("region")),
            "color_name": "",
            "product_name": local_product_name,
            "model_color_name": model_color_name,
            "model_product_name": model_product_name,
            "corrected_model_color_name": False,
            "style_identity_verified": True,
            "observed_text": observed_text,
        }
        if exact_style_bbox_source:
            refined["_label_transcription"]["style_code_bbox_source"] = (
                exact_style_bbox_source
            )
        _validate_label_ocr_payload(
            refined,
            style_code=style_code,
            color_code=color_code,
        )
        return refined
    if _text(color_code) not in exact_color_name:
        raise llm_gateway.LlmResponseError(
            f"鞋盒标签本地 OCR 色码不一致：{exact_color_name}"
        )
    if recovered_label_bbox is not None:
        # Model payload bboxes use the public 0..1000 contract, while local
        # OCR helpers operate on normalized 0..1 coordinates. Keep the payload
        # unit stable when writing a recovered box back for tmq generation.
        refined["label_bbox"] = [value * 1000.0 for value in recovered_label_bbox]
    model_color_name = _text(payload.get("color_name"))
    model_product_name = _text(payload.get("product_name"))
    refined["color_name"] = exact_color_name
    local_product_name = _text(transcription.get("product_name"))
    if local_product_name and not model_product_name:
        refined["product_name"] = local_product_name
    refined["_label_transcription"] = {
        "source": _text(transcription.get("source")),
        "confidence": float(transcription.get("confidence") or 0.0),
        "region": _text(transcription.get("region")),
        "color_name": exact_color_name,
        "product_name": local_product_name,
        "model_color_name": model_color_name,
        "model_product_name": model_product_name,
        "corrected_model_color_name": model_color_name != exact_color_name,
    }
    if exact_style_bbox_source:
        refined["_label_transcription"]["style_code_bbox_source"] = (
            exact_style_bbox_source
        )
    _validate_label_ocr_payload(
        refined,
        style_code=style_code,
        color_code=color_code,
    )
    return refined


def _merge_indexed_slot_values(
    existing: list[str],
    value: Any,
    expected_count: int,
) -> list[str]:
    merged = list(existing[:expected_count])
    if len(merged) < expected_count:
        merged.extend([""] * (expected_count - len(merged)))
    values = value if isinstance(value, list) else [value]
    for index, item in enumerate(values[:expected_count]):
        text = _text(item)
        if text and not merged[index]:
            merged[index] = text
    return merged


def _merge_pose_payloads(payloads: list[dict[str, Any]]) -> dict[str, Any]:
    merged_slots: dict[str, Any] = {
        "wpz": [""] * 6,
        "yq": [""] * 3,
        "yk": [],
    }
    scalar_slots = [f"tmz{index}" for index in range(1, 6)] + ["o", "yx"]
    color_name = ""
    category = ""

    sorted_payloads = sorted(
        payloads,
        key=lambda item: int(item.get("_batch_index") or 0)
        if isinstance(item, dict)
        else 0,
    )

    for payload in sorted_payloads:
        if not isinstance(payload, dict):
            continue
        if not color_name:
            color_name = _text(payload.get("color_name"))
        if not category:
            category = _text(payload.get("shoe_category"))
        slots = payload.get("slots")
        if not isinstance(slots, dict):
            continue
        for key in scalar_slots:
            value = _text(slots.get(key))
            if value and not _text(merged_slots.get(key)):
                merged_slots[key] = value
        merged_slots["wpz"] = _merge_indexed_slot_values(
            merged_slots.get("wpz") or [],
            slots.get("wpz") or [],
            6,
        )
        merged_slots["yq"] = _merge_indexed_slot_values(
            merged_slots.get("yq") or [],
            slots.get("yq") or [],
            3,
        )
        yk_values = slots.get("yk")
        if isinstance(yk_values, list):
            for item in yk_values:
                text = _text(item)
                if text and text not in merged_slots["yk"]:
                    merged_slots["yk"].append(text)

    return {
        "color_name": color_name,
        "shoe_category": category,
        "slots": merged_slots,
    }


def _merge_batch_consensus_payloads(
    payloads: list[dict[str, Any]],
    *,
    required_votes: int,
) -> dict[str, Any]:
    """Merge batch winners without treating an unresolved batch vote as a winner.

    ``batch_overview`` shows each model one small candidate batch plus a global
    thumbnail.  A slot is safe to carry forward only when the independently
    locked batch winners agree.  Missing or differing winners remain empty and
    are sent to the exact single-slot targeted review.
    """

    merged = _merge_pose_payloads(payloads)
    merged_slots = merged["slots"]
    model_votes: dict[str, dict[str, Any]] = {}
    consensus_issues: list[dict[str, Any]] = []
    routes: set[str] = set()
    facts_by_model: list[dict[str, Any]] = []
    required_votes = max(1, int(required_votes or 1))

    for payload in payloads:
        routes.update(
            _text(route)
            for route in (payload.get("_consensus_routes") or [])
            if _text(route)
        )
        facts_by_model.extend(payload.get("_candidate_facts_by_model") or [])

    for slot in SHOE_FULL_POSE_REQUIRED_CONSENSUS_SLOTS:
        locked_by_family: dict[str, list[dict[str, Any]]] = {}
        candidates: dict[str, set[str]] = {}
        for payload in payloads:
            vote = (payload.get("_model_votes") or {}).get(slot)
            if not isinstance(vote, dict):
                continue
            for family, models in (vote.get("candidates") or {}).items():
                candidates.setdefault(_text(family), set()).update(
                    _text(model) for model in models if _text(model)
                )
            if vote.get("status") != "locked":
                continue
            family = _text(vote.get("selected_family"))
            selected = _text(vote.get("selected"))
            if not family and selected:
                family = _copy_variant_key(selected)
            if family and selected:
                locked_by_family.setdefault(family, []).append(vote)

        status = "insufficient_votes"
        selected = ""
        selected_family = ""
        selected_models: list[str] = []
        votes = max((len(models) for models in candidates.values()), default=0)
        if len(locked_by_family) == 1:
            selected_family, locked_votes = next(iter(locked_by_family.items()))
            winner = sorted(
                locked_votes,
                key=lambda item: (
                    -int(item.get("votes") or 0),
                    _text(item.get("selected")),
                ),
            )[0]
            selected = _text(winner.get("selected"))
            selected_models = sorted({
                _text(model)
                for vote in locked_votes
                for model in (vote.get("models") or [])
                if _text(model)
            })
            votes = max(int(vote.get("votes") or 0) for vote in locked_votes)
            status = "locked"
            _replace_consensus_slot_value(merged_slots, slot, selected)
        else:
            _replace_consensus_slot_value(merged_slots, slot, "")
            if len(locked_by_family) > 1:
                status = "cross_batch_conflict"

        model_votes[slot] = {
            "status": status,
            "selected": selected,
            "selected_family": selected_family,
            "votes": votes,
            "required_votes": required_votes,
            "models": selected_models,
            "candidates": {
                family: sorted(models)
                for family, models in sorted(candidates.items())
                if family
            },
        }
        if status != "locked" and candidates:
            consensus_issues.append({
                "slot": slot,
                "status": status,
                "votes": votes,
                "required_votes": required_votes,
                "candidates": model_votes[slot]["candidates"],
            })

    merged.update({
        "_model_id": "+".join(sorted(routes)),
        "_consensus_routes": sorted(routes),
        "_model_votes": model_votes,
        "_consensus_issues": consensus_issues,
        "_candidate_facts_by_model": facts_by_model,
    })
    return merged


def _consensus_slot_value(slots: dict[str, Any], slot: str) -> str:
    match = re.fullmatch(r"(wpz|yq)(\d+)", slot)
    if match:
        values = _selection_array(
            slots,
            match.group(1),
            6 if match.group(1) == "wpz" else 3,
        )
        index = int(match.group(2)) - 1
        return _text(values[index]) if 0 <= index < len(values) else ""
    return _text(slots.get(slot))


def _replace_consensus_slot_value(
    slots: dict[str, Any],
    slot: str,
    selected: str,
) -> None:
    """Replace one consensus slot and keep its deterministic aliases aligned."""

    slot = shenhui_shoe_rules.normalize_slot_name(slot)
    indexed = re.fullmatch(r"(wpz|yq)(\d+)", slot)
    if indexed:
        key = indexed.group(1)
        length = 6 if key == "wpz" else 3
        values = _selection_array(slots, key, length)
        values[int(indexed.group(2)) - 1] = selected
        slots[key] = values
        return
    slots[slot] = selected
    main_match = re.fullmatch(r"tmz([1-4])", slot)
    if main_match:
        index = int(main_match.group(1)) - 1
        wpz_values = _selection_array(slots, "wpz", 6)
        wpz_values[index] = selected
        slots["wpz"] = wpz_values


def _cross_page_conflict_slots(
    page_payloads: list[dict[str, Any]],
) -> list[str]:
    """Return slots whose independently locked winners differ across pages.

    Candidate disagreement inside one page is not a cross-page conflict. It is
    resolved by the focused round at the normal quorum instead of being
    promoted to a three-vote targeted round.
    """

    locked_families_by_slot: dict[str, set[str]] = {}
    for page_payload in page_payloads:
        page_votes = page_payload.get("_model_votes") or {}
        for slot in SHOE_FULL_POSE_REQUIRED_CONSENSUS_SLOTS:
            vote = page_votes.get(slot)
            if not isinstance(vote, dict) or vote.get("status") != "locked":
                continue
            family = _text(vote.get("selected_family"))
            if not family:
                selected = _text(vote.get("selected"))
                family = _copy_variant_key(selected) if selected else ""
            if family:
                locked_families_by_slot.setdefault(slot, set()).add(family)
    return sorted(
        slot
        for slot, families in locked_families_by_slot.items()
        if len(families) > 1
    )


def _lock_verified_exact_tms_contract(
    payload: dict[str, Any],
    *,
    candidate_ids: dict[str, str],
    entries_by_name: dict[str, dict[str, Any]],
    style_code: str,
    color_code: str,
    required_votes: int,
    candidate_facts_by_model: list[dict[str, Any]] | None = None,
) -> bool:
    """Lock the exact ``style-color.jpg`` white single-shoe asset before targeting."""

    exact_stem = f"{_text(style_code)}-{_text(color_code)}".replace(" ", "")

    def is_exact_filename(filename: Any) -> bool:
        return Path(_text(filename)).stem.replace(" ", "") == exact_stem

    exact_entries = sorted(
        filename
        for filename in entries_by_name
        if is_exact_filename(filename)
    )
    if len(exact_entries) != 1:
        return False
    exact_filename = exact_entries[0]
    exact_candidate_ids = sorted(
        candidate_id
        for candidate_id, filename in candidate_ids.items()
        if _text(filename) == exact_filename
    )
    if len(exact_candidate_ids) != 1:
        return False
    exact_candidate_id = exact_candidate_ids[0]

    supporting_models: set[str] = set()
    identity_models: set[str] = set()
    pose_models: set[str] = set()
    evidence_items = (
        candidate_facts_by_model
        if candidate_facts_by_model is not None
        else list(payload.get("_candidate_facts_by_model") or [])
    )
    for model_evidence in evidence_items:
        if not isinstance(model_evidence, dict):
            continue
        model_id = _text(model_evidence.get("model_id"))
        if not model_id:
            continue
        for fact in model_evidence.get("candidate_facts") or []:
            if not isinstance(fact, dict) or not is_exact_filename(fact.get("filename")):
                continue
            asset_type = _text(fact.get("asset_type")).lower()
            shoe_count = _text(fact.get("shoe_count")).lower()
            background = _text(fact.get("background")).lower()
            pose = _text(fact.get("pose")).lower()
            matched_slots = {
                shenhui_shoe_rules.normalize_slot_name(slot)
                for slot in (fact.get("matched_slots") or [])
            }
            complete = fact.get("complete") is True or _text(
                fact.get("complete")
            ).lower() in {"1", "true", "yes", "是", "完整"}
            feature_card = fact.get("feature_card") is True or _text(
                fact.get("feature_card")
            ).lower() in {"1", "true", "yes", "是", "有"}
            identity_verified = (
                asset_type in {"shoe", "footwear", "鞋", "鞋子"}
                and shoe_count in {"single", "one", "单只", "单鞋"}
                and complete
                and not feature_card
            )
            if identity_verified:
                identity_models.add(model_id)
                if pose == "tmz5" or "tmz5" in matched_slots:
                    pose_models.add(model_id)
            if (
                identity_verified
                and background in {"white", "白", "白底"}
                and (pose == "tmz5" or "tmz5" in matched_slots)
            ):
                supporting_models.add(model_id)
                break

    required_votes = max(1, int(required_votes))
    verification = "strict_multimodal"
    contract_models = set(supporting_models)
    if len(contract_models) < required_votes:
        exact_entry = entries_by_name.get(exact_filename) or {}
        exact_path = exact_entry.get("path") if isinstance(exact_entry, dict) else None
        local_white_verified = False
        if exact_path and Path(exact_path).is_file():
            exact_feature = _binary_pose_feature(Path(exact_path))
            local_white_verified = bool(
                exact_feature.valid
                and exact_feature.background_luma >= SHOE_WHITE_BACKGROUND_LUMA
                and 0.02 <= exact_feature.bounding_coverage <= 0.85
            )
        # Models are reliable at the coarse identity facts (shoe, single,
        # complete, no feature card) but may disagree on a near-white studio
        # background or call the exact front pose ``other``.  The filename is a
        # producer contract and local pixels can verify the white background;
        # require two independent identity routes plus at least one explicit
        # tmz5 nomination before skipping targeted voting.
        if (
            local_white_verified
            and len(identity_models) >= required_votes
            and pose_models
        ):
            contract_models = set(identity_models)
            verification = "independent_identity_local_white"
        else:
            return False
    slots = payload.get("slots")
    if not isinstance(slots, dict):
        return False
    _replace_consensus_slot_value(slots, "tmz5", exact_candidate_id)
    payload.setdefault("_model_votes", {})["tmz5"] = {
        "status": "locked",
        "selected": exact_candidate_id,
        "selected_family": _copy_variant_key(exact_filename),
        "votes": len(contract_models),
        "required_votes": required_votes,
        "models": sorted(contract_models),
        "candidates": {
            _copy_variant_key(exact_filename): sorted(contract_models),
        },
        "source": "verified_exact_tms_contract",
        "verification": verification,
    }
    payload["_consensus_issues"] = [
        issue
        for issue in (payload.get("_consensus_issues") or [])
        if _text(issue.get("slot")) != "tmz5"
    ]
    locked_slots = set(payload.get("_exact_contract_locked_slots") or [])
    locked_slots.add("tmz5")
    payload["_exact_contract_locked_slots"] = sorted(locked_slots)
    return True


def _restrict_pose_payload_to_target_slot(
    payload: dict[str, Any],
    candidate_ids: dict[str, str],
    target_slot: str,
) -> dict[str, Any]:
    """Normalize a targeted response so non-target slot hints cannot leak."""

    target_slot = shenhui_shoe_rules.normalize_slot_name(target_slot)
    facts = shenhui_shoe_rules.parse_candidate_facts(payload, candidate_ids)
    candidates: list[dict[str, Any]] = []
    for fact in facts:
        valid, _reason = shenhui_shoe_rules.candidate_is_valid_for_slot(
            fact,
            target_slot,
            _text(payload.get("shoe_category")),
        )
        implied_unique_wpz5 = (
            target_slot == "wpz5"
            and len(candidate_ids) == 1
            and valid
        )
        matched = target_slot in fact.matched_slots or implied_unique_wpz5
        candidates.append({
            "candidate_id": fact.candidate_id,
            "filename": fact.filename,
            "asset_type": fact.asset_type,
            "shoe_count": fact.shoe_count,
            "pose": target_slot if matched else "other",
            "background": fact.background,
            "complete": fact.complete,
            "side": fact.side,
            "outsole_visible": fact.outsole_visible,
            "feature_card": fact.feature_card,
            "confidence": fact.confidence,
            "matched_slots": [target_slot] if matched else [],
        })
    return {
        "color_name": _text(payload.get("color_name")),
        "shoe_category": _text(payload.get("shoe_category")),
        "candidates": candidates,
    }


def _targeted_slot_candidate_ids(
    target_slot: str,
    candidate_ids: dict[str, str],
    *,
    focused_slots: dict[str, Any],
    candidate_facts_by_model: list[dict[str, Any]],
    required_votes: int,
    entries_by_name: dict[str, dict[str, Any]] | None = None,
    shoe_category: str = "",
    prefer_prior_slot_nominations: bool = False,
    prefer_exact_tmz5_visual_pair: bool = False,
) -> tuple[dict[str, str], dict[str, str]]:
    """Apply cross-slot and historical-fact gates before targeted voting."""

    target_slot = shenhui_shoe_rules.normalize_slot_name(target_slot)
    exclusions: dict[str, str] = {}
    blocked_families: dict[str, str] = {}
    nominated_candidate_ids: set[str] = set()
    if prefer_prior_slot_nominations:
        current_selected = _consensus_slot_value(focused_slots, target_slot)
        if current_selected in candidate_ids:
            nominated_candidate_ids.add(current_selected)
        for model_evidence in candidate_facts_by_model or []:
            if not isinstance(model_evidence, dict):
                continue
            payload = {"candidates": model_evidence.get("candidate_facts") or []}
            for fact in shenhui_shoe_rules.parse_candidate_facts(payload, candidate_ids):
                fact_slots = {
                    shenhui_shoe_rules.normalize_slot_name(slot)
                    for slot in fact.matched_slots
                }
                fact_pose = shenhui_shoe_rules.normalize_slot_name(fact.pose)
                if target_slot in fact_slots or fact_pose == target_slot:
                    nominated_candidate_ids.add(fact.candidate_id)
    compatible_slot_pairs = {
        frozenset(("tmz2", "yq1")),
        frozenset(("tmz5", "wpz5")),
    }
    for occupied_slot in SHOE_FULL_POSE_REQUIRED_CONSENSUS_SLOTS:
        if occupied_slot == target_slot:
            continue
        if frozenset((target_slot, occupied_slot)) in compatible_slot_pairs:
            continue
        occupied = _consensus_slot_value(focused_slots, occupied_slot)
        if not occupied:
            continue
        family = _consensus_vote_key(occupied, candidate_ids)
        if family:
            blocked_families.setdefault(family, occupied_slot)

    pair_routes_by_family: dict[str, set[str]] = {}
    if target_slot == "wpz5":
        for model_evidence in candidate_facts_by_model or []:
            if not isinstance(model_evidence, dict):
                continue
            route = _text(model_evidence.get("model_id"))
            if not route:
                continue
            payload = {"candidates": model_evidence.get("candidate_facts") or []}
            for fact in shenhui_shoe_rules.parse_candidate_facts(payload, candidate_ids):
                shoe_count = re.sub(
                    r"[^a-z0-9\u4e00-\u9fff]+",
                    "_",
                    _text(fact.shoe_count).lower(),
                ).strip("_")
                if shoe_count not in {
                    "pair",
                    "two",
                    "double",
                    "two_shoes",
                    "双",
                    "双鞋",
                    "两",
                    "两只",
                    "两只鞋",
                }:
                    continue
                family = _consensus_vote_key(fact.candidate_id, candidate_ids)
                if family:
                    pair_routes_by_family.setdefault(family, set()).add(route)

    required_votes = max(1, int(required_votes or 1))
    pose5_rule = (
        SHOE_POSE5_FEATURE_RULES.get(_text(shoe_category))
        if target_slot == "wpz5"
        else None
    )
    filtered: dict[str, str] = {}
    for candidate_id, filename in candidate_ids.items():
        family = _consensus_vote_key(candidate_id, candidate_ids)
        occupied_slot = blocked_families.get(family)
        if occupied_slot:
            exclusions[candidate_id] = f"occupied by incompatible slot {occupied_slot}"
            continue
        pair_routes = pair_routes_by_family.get(family, set())
        verified_pose5_geometry = False
        if pose5_rule and entries_by_name:
            entry = entries_by_name.get(filename) or {}
            path = Path(_text(entry.get("path")))
            if path.is_file():
                pose = _binary_pose_feature(path)
                if pose.valid:
                    if not (
                        pose5_rule["min_aspect"]
                        <= pose.aspect_ratio
                        <= pose5_rule["max_aspect"]
                        and pose5_rule["min_coverage"]
                        <= pose.bounding_coverage
                        <= pose5_rule["max_coverage"]
                        and _is_complete_main_shoe_candidate(pose)
                    ):
                        exclusions[candidate_id] = (
                            "outside wpz5 pose5 geometry hard gate"
                        )
                        continue
                    if not (
                        235.0
                        <= pose.background_luma
                        < SHOE_WHITE_BACKGROUND_LUMA
                    ):
                        exclusions[candidate_id] = (
                            "wpz5 requires an original gray background candidate"
                        )
                        continue
                    verified_pose5_geometry = True
        if len(pair_routes) >= required_votes and not verified_pose5_geometry:
            exclusions[candidate_id] = (
                f"pair evidence from {len(pair_routes)} independent routes"
            )
            continue
        filtered[candidate_id] = filename
    if (
        target_slot == "wpz5"
        and prefer_exact_tmz5_visual_pair
        and entries_by_name
        and filtered
    ):
        tmz5_candidate_id = _consensus_slot_value(focused_slots, "tmz5")
        tmz5_filename = _text(candidate_ids.get(tmz5_candidate_id))
        tmz5_entry = entries_by_name.get(tmz5_filename) or {}
        tmz5_path = tmz5_entry.get("path")
        tmz5_feature = (
            _binary_pose_feature(Path(tmz5_path))
            if tmz5_path and Path(tmz5_path).is_file()
            else None
        )
        visual_pair_ids: set[str] = set()
        if (
            tmz5_feature is not None
            and tmz5_feature.mask is not None
            and tmz5_feature.background_luma >= SHOE_WHITE_BACKGROUND_LUMA
        ):
            for candidate_id, filename in filtered.items():
                entry = entries_by_name.get(filename) or {}
                candidate_path = entry.get("path")
                if not candidate_path or not Path(candidate_path).is_file():
                    continue
                candidate_feature = _binary_pose_feature(Path(candidate_path))
                if (
                    candidate_feature.mask is None
                    or not (
                        235.0
                        <= candidate_feature.background_luma
                        < SHOE_WHITE_BACKGROUND_LUMA
                    )
                ):
                    continue
                if (
                    _binary_pose_distance(tmz5_feature, candidate_feature)
                    <= SHOE_BACKGROUND_PAIR_MAX_DISTANCE
                ):
                    visual_pair_ids.add(candidate_id)
        if visual_pair_ids:
            for candidate_id in list(filtered):
                if candidate_id in visual_pair_ids:
                    continue
                exclusions[candidate_id] = (
                    "not the verified gray visual pair of exact tmz5"
                )
                filtered.pop(candidate_id, None)
    eligible_nominations = nominated_candidate_ids.intersection(filtered)
    if prefer_prior_slot_nominations and eligible_nominations:
        for candidate_id in list(filtered):
            if candidate_id in eligible_nominations:
                continue
            exclusions[candidate_id] = "not nominated for target slot by prior batch models"
            filtered.pop(candidate_id, None)
    return filtered, exclusions


def _targeted_round_finalist_ids(
    payloads: list[dict[str, Any]],
    candidate_ids: dict[str, str],
    target_slot: str,
    shoe_category: str,
) -> dict[str, str]:
    """Keep the per-route nominees for a smaller, fresh consensus round."""

    target_slot = shenhui_shoe_rules.normalize_slot_name(target_slot)
    nominated: set[str] = set()
    for payload in payloads:
        if not isinstance(payload, dict):
            continue
        normalized = shenhui_shoe_rules.slot_payload_from_candidate_facts(
            payload,
            candidate_ids,
            shoe_category=shoe_category,
        )
        selected = _consensus_slot_value(
            normalized.get("slots") or {},
            target_slot,
        )
        if selected in candidate_ids:
            nominated.add(selected)
    return {
        candidate_id: filename
        for candidate_id, filename in candidate_ids.items()
        if candidate_id in nominated
    }


def _same_background_visual_signature(path: Path | str) -> tuple[Any, Any]:
    """Return aligned RGB and foreground-mask thumbnails for duplicate checks."""

    from PIL import Image, ImageFilter, ImageOps

    with Image.open(path) as opened:
        image = _image_rgb_on_white(ImageOps.exif_transpose(opened)).resize(
            (160, 160),
            Image.Resampling.LANCZOS,
        )
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
            mask_pixels[x, y] = (
                255
                if max(
                    abs(pixel[channel] - background[channel])
                    for channel in range(3)
                )
                > 22
                else 0
            )
    mask = mask.filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.MaxFilter(3))
    return image, mask


def _same_background_foreground_pixel_match(
    first: tuple[Any, Any],
    second: tuple[Any, Any],
) -> float:
    """Measure aligned unchanged foreground pixels, excluding shared background."""

    from PIL import ImageChops

    first_image, first_mask = first
    second_image, second_mask = second
    foreground_union = ImageChops.lighter(first_mask, second_mask)
    difference = ImageChops.difference(first_image, second_image)
    compared = 0
    matched = 0
    for pixel, mask_value in zip(difference.getdata(), foreground_union.getdata()):
        if mask_value <= 0:
            continue
        compared += 1
        if max(pixel) <= SHOE_SAME_BACKGROUND_VISUAL_MAX_PIXEL_DELTA:
            matched += 1
    return matched / compared if compared else 0.0


def _visual_consensus_family_keys(
    candidate_ids: dict[str, str],
    entries_by_name: dict[str, dict[str, Any]] | None,
    *,
    allow_same_background_variants: bool = False,
) -> dict[str, str]:
    """Cluster near-identical background/export variants without adding votes."""

    if not entries_by_name:
        return {}
    filenames = list(dict.fromkeys(candidate_ids.values()))
    parent = {filename: filename for filename in filenames}
    features: dict[str, _BinaryPoseFeature] = {}
    duplicate_signatures: dict[str, tuple[Any, Any]] = {}

    def find(filename: str) -> str:
        while parent[filename] != filename:
            parent[filename] = parent[parent[filename]]
            filename = parent[filename]
        return filename

    def union(first: str, second: str) -> None:
        first_root = find(first)
        second_root = find(second)
        if first_root != second_root:
            parent[second_root] = first_root

    for filename in filenames:
        entry = entries_by_name.get(filename) or {}
        path = entry.get("path")
        if path and Path(path).is_file():
            features[filename] = _binary_pose_feature(path)
            if allow_same_background_variants:
                duplicate_signatures[filename] = (
                    _same_background_visual_signature(path)
                )

    for index, first in enumerate(filenames):
        for second in filenames[index + 1:]:
            if _copy_variant_key(first) == _copy_variant_key(second):
                union(first, second)
                continue
            first_feature = features.get(first)
            second_feature = features.get(second)
            if not first_feature or not second_feature:
                continue
            if not (
                first_feature.valid
                and second_feature.valid
                and first_feature.mask is not None
                and second_feature.mask is not None
                and abs(first_feature.aspect_ratio - second_feature.aspect_ratio) <= 0.05
                and abs(
                    first_feature.bounding_coverage
                    - second_feature.bounding_coverage
                )
                <= 0.05
            ):
                continue
            background_distance = abs(
                first_feature.background_luma
                - second_feature.background_luma
            )
            pose_distance = _binary_pose_distance(first_feature, second_feature)
            is_background_export_variant = (
                background_distance >= 5.0
                and pose_distance <= SHOE_VISUAL_VARIANT_MAX_DISTANCE
            )
            is_same_background_variant = (
                allow_same_background_variants
                and background_distance < 5.0
                and pose_distance
                <= SHOE_SAME_BACKGROUND_VISUAL_VARIANT_MAX_DISTANCE
                and first in duplicate_signatures
                and second in duplicate_signatures
                and _same_background_foreground_pixel_match(
                    duplicate_signatures[first],
                    duplicate_signatures[second],
                )
                >= SHOE_SAME_BACKGROUND_VISUAL_MIN_PIXEL_MATCH
            )
            if not (is_background_export_variant or is_same_background_variant):
                continue
            union(first, second)

    groups: dict[str, list[str]] = {}
    for filename in filenames:
        groups.setdefault(find(filename), []).append(filename)
    result: dict[str, str] = {}
    for members in groups.values():
        member_features = [
            features[filename]
            for filename in members
            if filename in features
        ]
        same_background_group = bool(
            allow_same_background_variants
            and len(member_features) > 1
            and max(feature.background_luma for feature in member_features)
            - min(feature.background_luma for feature in member_features)
            < 5.0
        )

        def representative_rank(filename: str) -> tuple[Any, ...]:
            feature = features.get(filename)
            if same_background_group and feature is not None:
                # A function card commonly leaves the outer silhouette nearly
                # unchanged but replaces colorful shoe pixels with a neutral
                # rectangle.  Within this tightly bounded duplicate family,
                # retain the richer unobstructed export as the output variant.
                return (
                    -feature.foreground_saturation_mean,
                    -feature.foreground_saturation_p80,
                    -feature.foreground_color_bins,
                    _is_copy_variant_filename(filename),
                    filename.lower(),
                )
            return (
                not (
                    feature is not None
                    and 235.0
                    <= feature.background_luma
                    < SHOE_WHITE_BACKGROUND_LUMA
                ),
                _is_copy_variant_filename(filename),
                filename.lower(),
            )

        representative = min(
            members,
            key=representative_rank,
        )
        family_key = _copy_variant_key(representative)
        for filename in members:
            result[filename] = family_key
    return result


def _consensus_vote_key(
    value: str,
    candidate_ids: dict[str, str],
    visual_family_keys: dict[str, str] | None = None,
) -> str:
    resolved = candidate_ids.get(_text(value), _text(value))
    if visual_family_keys and resolved in visual_family_keys:
        return visual_family_keys[resolved]
    return _copy_variant_key(resolved)


def _consensus_pose_payload(
    payloads: list[dict[str, Any]],
    candidate_ids: dict[str, str],
    shoe_category: str = "",
    *,
    required_votes: int = 2,
    entries_by_name: dict[str, dict[str, Any]] | None = None,
    same_background_visual_slot: str = "",
) -> dict[str, Any]:
    """Lock a slot only when distinct model routes select the same image family."""

    required_votes = max(1, int(required_votes or 1))
    same_background_visual_slot = shenhui_shoe_rules.normalize_slot_name(
        same_background_visual_slot
    )
    visual_family_keys = _visual_consensus_family_keys(
        candidate_ids,
        entries_by_name,
        allow_same_background_variants=(same_background_visual_slot == "yq3"),
    )
    normalized_by_route: dict[str, dict[str, Any]] = {}
    route_variant_deduplication: dict[str, list[str]] = {}
    facts_by_model: list[dict[str, Any]] = []
    for payload in payloads:
        if not isinstance(payload, dict):
            continue
        route = _text(payload.get("_model_id"))
        if not route or route in normalized_by_route:
            continue
        if not shenhui_shoe_rules.has_candidate_facts_payload(payload):
            raise ShoeSelectionError(
                f"鞋品姿势识别模型 {route} 未返回必需的 candidates 结构化候选事实"
            )
        normalized = shenhui_shoe_rules.slot_payload_from_candidate_facts(
            payload,
            candidate_ids,
            shoe_category=shoe_category,
        )
        if same_background_visual_slot == "yq3":
            nominated_facts = []
            for fact in shenhui_shoe_rules.parse_candidate_facts(
                payload,
                candidate_ids,
            ):
                if "yq3" not in fact.matched_slots:
                    continue
                valid, _reason = shenhui_shoe_rules.candidate_is_valid_for_slot(
                    fact,
                    "yq3",
                    shoe_category,
                )
                if valid:
                    nominated_facts.append(fact)
            nominated_ids = list(dict.fromkeys(
                fact.candidate_id for fact in nominated_facts
            ))
            nominated_families = {
                _consensus_vote_key(
                    candidate_id,
                    candidate_ids,
                    visual_family_keys,
                )
                for candidate_id in nominated_ids
            }
            if nominated_ids and len(nominated_families) == 1:
                # A route may mark both white/gray or card/no-card exports of
                # the exact same yq3 image. Collapse that one visual family
                # before slot scoring; this preserves one vote per route and
                # does not resolve genuine multi-family model ambiguity.
                slots = normalized.get("slots")
                if isinstance(slots, dict):
                    _replace_consensus_slot_value(slots, "yq3", nominated_ids[0])
                    if len(nominated_ids) > 1:
                        route_variant_deduplication[route] = sorted(nominated_ids)
        normalized["_model_id"] = route
        normalized_by_route[route] = normalized
        facts_by_model.append({
            "model_id": route,
            "candidate_facts": list(normalized.get("_candidate_facts") or []),
            "slot_decisions": list(normalized.get("_slot_decisions") or []),
        })

    scalar_slots = [f"tmz{index}" for index in range(1, 6)] + ["o", "yx"]
    indexed_slots = [f"wpz{index}" for index in range(1, 7)] + [
        f"yq{index}" for index in range(1, 4)
    ]
    slot_names = [*scalar_slots, *indexed_slots]
    selected: dict[str, str] = {}
    model_votes: dict[str, dict[str, Any]] = {}
    consensus_issues: list[dict[str, Any]] = []

    for slot in slot_names:
        slot_visual_family_keys = (
            visual_family_keys
            if not same_background_visual_slot or slot == same_background_visual_slot
            else {}
        )
        groups: dict[str, dict[str, Any]] = {}
        for route, payload in normalized_by_route.items():
            slots = payload.get("slots")
            if not isinstance(slots, dict):
                continue
            value = _consensus_slot_value(slots, slot)
            if not value:
                continue
            key = _consensus_vote_key(
                value,
                candidate_ids,
                slot_visual_family_keys,
            )
            group = groups.setdefault(key, {"models": set(), "values": []})
            group["models"].add(route)
            group["values"].append(value)

        ranked = sorted(
            groups.items(),
            key=lambda item: (-len(item[1]["models"]), item[0]),
        )
        best_key = ranked[0][0] if ranked else ""
        best = ranked[0][1] if ranked else {"models": set(), "values": []}
        votes = len(best["models"])
        tied_best = [
            item
            for item in ranked
            if len(item[1]["models"]) == votes
        ]
        representative = ""
        if best["values"]:
            eligible_values = [
                candidate_id
                for candidate_id in candidate_ids
                if _consensus_vote_key(
                    candidate_id,
                    candidate_ids,
                    slot_visual_family_keys,
                )
                == best_key
            ]
            representative = sorted(
                set(eligible_values or best["values"]),
                key=lambda value: (
                    _copy_variant_key(candidate_ids.get(value, value)) != best_key,
                    _is_copy_variant_filename(candidate_ids.get(value, value)),
                    candidate_ids.get(value, value).lower(),
                ),
            )[0]
        if representative and votes >= required_votes and len(tied_best) > 1:
            status = "conflict_tie"
        elif representative and votes >= required_votes:
            status = "locked"
        else:
            status = "insufficient_votes"
        if status == "locked":
            selected[slot] = representative
        elif groups:
            consensus_issues.append({
                "slot": slot,
                "status": status,
                "votes": votes,
                "required_votes": required_votes,
                "candidates": {
                    key: sorted(group["models"])
                    for key, group in ranked
                },
            })
        model_votes[slot] = {
            "status": status,
            "selected": representative if status == "locked" else "",
            "selected_family": best_key if status == "locked" else "",
            "votes": votes,
            "required_votes": required_votes,
            "models": sorted(best["models"]),
            "candidates": {
                key: sorted(group["models"])
                for key, group in ranked
            },
        }
        raw_voted_families = {
            _copy_variant_key(candidate_ids.get(value, value))
            for value in best["values"]
        }
        if status == "locked" and len(raw_voted_families) > 1:
            model_votes[slot].update({
                "family_source": "verified_visual_duplicate_cluster",
                "voted_variants": sorted(set(best["values"])),
            })
        if (
            status == "locked"
            and representative
            and representative not in best["values"]
        ):
            model_votes[slot].update({
                "variant_source": "verified_visual_duplicate_cluster",
                "voted_variants": sorted(set(best["values"])),
            })
        if status == "locked" and slot == same_background_visual_slot:
            applied_route_deduplication = {
                route: variants
                for route, variants in route_variant_deduplication.items()
                if route in best["models"]
            }
            if applied_route_deduplication:
                model_votes[slot]["route_variant_deduplication"] = (
                    applied_route_deduplication
                )

    first_payload = next(iter(normalized_by_route.values()), {})
    slots = {
        **{slot: selected.get(slot, "") for slot in scalar_slots},
        "wpz": [selected.get(f"wpz{index}", "") for index in range(1, 7)],
        "yq": [selected.get(f"yq{index}", "") for index in range(1, 4)],
        "yk": [],
    }
    return {
        "color_name": _text(first_payload.get("color_name")),
        "shoe_category": _text(shoe_category) or _text(first_payload.get("shoe_category")),
        "slots": slots,
        "_model_id": "+".join(normalized_by_route),
        "_consensus_routes": list(normalized_by_route),
        "_model_votes": model_votes,
        "_consensus_issues": consensus_issues,
        "_candidate_facts_by_model": facts_by_model,
        "_ruleset": _text(first_payload.get("_ruleset")),
    }


def _focused_candidate_ids_from_page_payloads(
    *,
    payloads_by_batch: dict[int, list[dict[str, Any]]],
    batch_inputs: list[dict[str, Any]],
    candidate_ids: dict[str, str],
    shoe_category: str,
    style_code: str,
    color_code: str,
) -> dict[str, str]:
    """Collect every page-level finalist without using page votes as the winner."""

    if len(candidate_ids) > SHOE_FOCUSED_MAX_CANDIDATES:
        raise ShoeSelectionError(
            "global_pages focused finalist 候选过多："
            f"{len(candidate_ids)} > {SHOE_FOCUSED_MAX_CANDIDATES}，拒绝静默截断"
        )

    selected_ids: set[str] = set()
    support_by_id: dict[str, set[str]] = {}
    batch_ids_by_index = {
        int(item.get("batch_index") or 0): dict(item.get("candidate_ids") or {})
        for item in batch_inputs
    }

    def add_candidate(candidate_id: str, route: str) -> None:
        candidate_id = _text(candidate_id)
        if candidate_id not in candidate_ids:
            return
        selected_ids.add(candidate_id)
        if route:
            support_by_id.setdefault(candidate_id, set()).add(route)

    for batch_index, payloads in payloads_by_batch.items():
        batch_candidate_ids = batch_ids_by_index.get(int(batch_index), {})
        for payload in payloads:
            if not isinstance(payload, dict):
                continue
            route = _text(payload.get("_model_id"))
            normalized = shenhui_shoe_rules.slot_payload_from_candidate_facts(
                payload,
                batch_candidate_ids,
                shoe_category=shoe_category,
            )
            normalized_slots = normalized.get("slots") or {}
            for slot in SHOE_FOCUSED_POSE_SLOTS:
                value = _consensus_slot_value(normalized_slots, slot)
                add_candidate(value, route)
            for fact in shenhui_shoe_rules.parse_candidate_facts(
                payload,
                batch_candidate_ids,
            ):
                fact_slots = {
                    shenhui_shoe_rules.normalize_slot_name(slot)
                    for slot in fact.matched_slots
                }
                is_box_fact = any(
                    token in _text(fact.asset_type).lower()
                    for token in ("shoe_box", "box", "label", "鞋盒", "标签")
                )
                is_exact_tms = _is_tms_source_filename(
                    fact.filename,
                    style_code,
                    color_code,
                )
                if fact_slots.intersection(SHOE_FOCUSED_POSE_SLOTS) or is_box_fact or is_exact_tms:
                    add_candidate(fact.candidate_id, route)

    for candidate_id, filename in candidate_ids.items():
        if _is_tms_source_filename(filename, style_code, color_code):
            add_candidate(candidate_id, "filename-contract")

    if len(candidate_ids) <= SHOE_FOCUSED_MAX_CANDIDATES:
        for candidate_id in candidate_ids:
            add_candidate(candidate_id, "")

    original_order = {candidate_id: index for index, candidate_id in enumerate(candidate_ids)}
    finalists = sorted(
        selected_ids,
        key=lambda candidate_id: (
            original_order.get(candidate_id, 9999),
            -len(support_by_id.get(candidate_id, set())),
            candidate_ids[candidate_id].lower(),
        )
    )
    if not finalists:
        raise ShoeSelectionError("global_pages focused 未收集到任何 finalist 候选")
    if len(finalists) > SHOE_FOCUSED_MAX_CANDIDATES:
        raise ShoeSelectionError(
            "global_pages focused finalist 候选过多："
            f"{len(finalists)} > {SHOE_FOCUSED_MAX_CANDIDATES}，拒绝静默截断"
        )
    return {
        candidate_id: candidate_ids[candidate_id]
        for candidate_id in finalists
    }


def _default_analyze_color(**kwargs) -> dict[str, Any]:
    candidate_ids = kwargs["candidate_ids"]
    contact_sheets = kwargs.get("contact_sheets") or [kwargs["contact_sheet"]]
    pose_strategy = normalize_shoe_pose_strategy(kwargs.get("pose_strategy"))
    overview_contact_sheet = _text(kwargs.get("overview_contact_sheet"))
    config = kwargs.get("config")
    model_id = _text(kwargs.get("model_id")) or SHOE_POSE_DEFAULT_MODEL
    model_ids = _shoe_pose_model_ids(
        model_id,
        config,
        kwargs.get("fallback_model_ids"),
    )
    log = kwargs.get("log") or (lambda _message: None)
    progress = kwargs.get("progress")
    errors: list[str] = []
    style_code = kwargs["style_code"]
    color_code = kwargs["color_code"]
    pose_evidence_path = _text(kwargs.get("pose_evidence_path"))
    total_batches = (
        1
        if pose_strategy == SHOE_POSE_STRATEGY_SINGLE_SHEET
        else max(1, len(contact_sheets))
    )
    if (
        pose_strategy == SHOE_POSE_STRATEGY_GLOBAL_PAGES
        and len(contact_sheets) > SHOE_GLOBAL_PAGE_MAX_PAGES
    ):
        raise ShoeSelectionError(
            f"{style_code}-{color_code} global_pages 输入图片超过模型上限，"
            "不能静默截断"
        )
    main_pose_reference_images = [
        _text(path)
        for path in (kwargs.get("main_pose_reference_images") or [])
        if _text(path)
    ][:5]
    main_pose_reference_sheet = _text(kwargs.get("main_pose_reference_sheet"))
    yq_reference_images = {
        shenhui_shoe_rules.normalize_slot_name(slot): _text(path)
        for slot, path in (kwargs.get("yq_reference_images") or {}).items()
        if shenhui_shoe_rules.normalize_slot_name(slot) in {"yq1", "yq2", "yq3"}
        and _text(path)
    }
    candidate_entries = [
        item
        for item in (kwargs.get("candidate_entries") or [])
        if isinstance(item, dict)
        and _text(item.get("filename"))
        and item.get("path")
    ]
    candidate_entries_by_name = {
        _text(item.get("filename")): item
        for item in candidate_entries
    }

    model_payloads: list[dict[str, Any]] = []
    route_model_ids: list[str] = []
    disabled_models: set[str] = set()
    batch_inputs: list[dict[str, Any]] = []
    for batch_index, contact_sheet in enumerate(contact_sheets[:total_batches], start=1):
        if pose_strategy == SHOE_POSE_STRATEGY_SINGLE_SHEET:
            batch_candidate_ids = dict(candidate_ids)
        elif pose_strategy == SHOE_POSE_STRATEGY_GLOBAL_PAGES:
            batch_candidate_ids = _candidate_ids_for_global_page(
                candidate_ids,
                batch_index,
            )
        else:
            batch_candidate_ids = _candidate_ids_for_contact_sheet(
                candidate_ids,
                batch_index,
            )
        if not batch_candidate_ids:
            continue
        overview_inputs = (
            [overview_contact_sheet]
            if pose_strategy == SHOE_POSE_STRATEGY_BATCH_OVERVIEW and overview_contact_sheet
            else []
        )
        if pose_strategy == SHOE_POSE_STRATEGY_GLOBAL_PAGES:
            if main_pose_reference_images:
                image_inputs = [
                    contact_sheet,
                    *main_pose_reference_images,
                    kwargs.get("poster_reference_image") or str(SHOE_POSTER_REFERENCE_IMAGE),
                    kwargs["yq_reference_image"],
                ]
                main_pose_reference_count_for_prompt = len(main_pose_reference_images)
            else:
                image_inputs = [
                    contact_sheet,
                    main_pose_reference_sheet or kwargs["reference_image"],
                    kwargs["yq_reference_image"],
                ]
                main_pose_reference_count_for_prompt = 1
            _ensure_pose_image_input_limit(
                image_inputs,
                style_code=style_code,
                color_code=color_code,
                pose_strategy=pose_strategy,
            )
            candidate_sheet_count = 1
            overview_sheet_count_for_prompt = 0
        elif main_pose_reference_images:
            image_inputs = [
                contact_sheet,
                *overview_inputs,
                *main_pose_reference_images,
                kwargs.get("poster_reference_image") or str(SHOE_POSTER_REFERENCE_IMAGE),
                kwargs["yq_reference_image"],
            ]
            _ensure_pose_image_input_limit(
                image_inputs,
                style_code=style_code,
                color_code=color_code,
                pose_strategy=pose_strategy,
            )
            candidate_sheet_count = 1
            overview_sheet_count_for_prompt = len(overview_inputs)
            main_pose_reference_count_for_prompt = len(main_pose_reference_images)
        else:
            image_inputs = [
                contact_sheet,
                *overview_inputs,
                kwargs["reference_image"],
                kwargs.get("poster_reference_image") or str(SHOE_POSTER_REFERENCE_IMAGE),
                kwargs["yq_reference_image"],
            ]
            _ensure_pose_image_input_limit(
                image_inputs,
                style_code=style_code,
                color_code=color_code,
                pose_strategy=pose_strategy,
            )
            candidate_sheet_count = 1
            overview_sheet_count_for_prompt = len(overview_inputs)
            main_pose_reference_count_for_prompt = 0
        batch_inputs.append({
            "batch_index": batch_index,
            "contact_sheet": contact_sheet,
            "candidate_ids": batch_candidate_ids,
            "user_prompt": _shoe_selection_prompt(
                style_code,
                color_code,
                batch_candidate_ids,
                kwargs.get("shoe_category") or "",
                candidate_sheet_count=candidate_sheet_count,
                overview_sheet_count=overview_sheet_count_for_prompt,
                candidate_scope=pose_strategy,
                main_pose_reference_count=main_pose_reference_count_for_prompt,
            ),
            "image_inputs": image_inputs,
        })
    log(
        f"鞋品姿势识别策略：{style_code}-{color_code}，"
        f"{pose_strategy}，候选批次 {len(batch_inputs)}，总候选 {len(candidate_ids)} 张"
    )

    def analyze_batch_with_model(
        batch_input: dict[str, Any],
        current_model_id: str,
        *,
        timeout_seconds: float = SHOE_POSE_MODEL_TIMEOUT_SECONDS,
        max_attempts: int = SHOE_POSE_MODEL_MAX_ATTEMPTS,
        timeout_probe: bool = False,
    ) -> dict[str, Any]:
        batch_index = int(batch_input["batch_index"])
        batch_candidate_ids = batch_input["candidate_ids"]
        last_error = ""
        timeout_like = False
        configuration_error = False
        max_attempts = max(1, int(max_attempts or 1))
        phase_prefix = "单批耐心复测 " if timeout_probe else ""
        for attempt in range(1, max_attempts + 1):
            stage = (
                f"姿势识别 {phase_prefix}{current_model_id} 第{attempt}/{max_attempts}次 "
                f"批次{batch_index}/{total_batches}"
            )
            _notify_shoe_model_progress(
                progress,
                stage,
                style_code=style_code,
                color_code=color_code,
            )
            log(
                f"鞋品姿势识别模型{phase_prefix}尝试：{style_code}-{color_code}，"
                f"模型 {current_model_id}，第 {attempt}/{max_attempts} 次，"
                f"候选批次 {batch_index}/{total_batches}，候选 {len(batch_candidate_ids)} 张，"
                f"超时上限 {float(timeout_seconds):g} 秒"
            )
            try:
                payload, route = llm_gateway.generate_multimodal_json(
                    system_prompt=SHOE_SELECTION_SYSTEM_PROMPT,
                    user_prompt=batch_input["user_prompt"],
                    image_inputs=batch_input["image_inputs"],
                    model_id=current_model_id,
                    fallback_model_ids=[],
                    config=config,
                    timeout_seconds=timeout_seconds,
                    retry_same_model=False,
                )
                if not shenhui_shoe_rules.has_candidate_facts_payload(payload):
                    raise llm_gateway.LlmResponseError(
                        "鞋品姿势识别结果缺少必需的 candidates 结构化候选事实"
                    )
                _validate_pose_payload_references(payload, batch_candidate_ids)
            except llm_gateway.LlmGatewayError as exc:
                last_error = _text(exc)
                log(
                    f"[warn] 鞋品姿势识别模型失败：{style_code}-{color_code}，"
                    f"模型 {current_model_id}，第 {attempt}/{max_attempts} 次，"
                    f"批次 {batch_index}/{total_batches}：{last_error}"
                )
                if isinstance(exc, llm_gateway.LlmConfigurationError):
                    configuration_error = True
                    break
                if _is_timeout_like_llm_error(exc):
                    timeout_like = True
                    break
                continue
            return {
                "ok": True,
                "batch_index": batch_index,
                "payload": payload,
                "route_model_id": route.model_id,
                "timeout_probe": timeout_probe,
            }
        return {
            "ok": False,
            "batch_index": batch_index,
            "error": last_error or "未返回可用结果",
            "timeout_like": timeout_like,
            "configuration_error": configuration_error,
            "timeout_probe": timeout_probe,
        }

    required_model_votes = max(
        1,
        int(
            kwargs.get("consensus_required_votes")
            or SHOE_POSE_CONSENSUS_REQUIRED_VOTES
        ),
    )
    payloads_by_batch: dict[int, list[dict[str, Any]]] = {
        int(item["batch_index"]): []
        for item in batch_inputs
    }
    routes_by_batch: dict[int, set[str]] = {
        int(item["batch_index"]): set()
        for item in batch_inputs
    }
    requires_full_slot_consensus = pose_strategy == SHOE_POSE_STRATEGY_SINGLE_SHEET
    focused_consensus_evidence: dict[str, Any] = {}

    def flush_pose_evidence(status: str) -> None:
        if not pose_evidence_path:
            return
        try:
            _write_pose_analysis_evidence(
                target=pose_evidence_path,
                style_code=style_code,
                color_code=color_code,
                pose_strategy=pose_strategy,
                candidate_ids=candidate_ids,
                batch_inputs=batch_inputs,
                payloads_by_batch=payloads_by_batch,
                shoe_category=kwargs.get("shoe_category") or "",
                required_votes=required_model_votes,
                errors=errors,
                status=status,
                focused_consensus=focused_consensus_evidence,
            )
        except Exception as exc:
            log(
                f"[warn] 鞋品姿势识别证据写入失败："
                f"{style_code}-{color_code}，{_text(exc)}"
            )

    def missing_required_consensus_slots(batch_input: dict[str, Any]) -> list[str]:
        if not requires_full_slot_consensus:
            return []
        batch_index = int(batch_input["batch_index"])
        if len(routes_by_batch.get(batch_index, set())) < required_model_votes:
            return list(SHOE_FULL_POSE_REQUIRED_CONSENSUS_SLOTS)
        consensus = _consensus_pose_payload(
            payloads_by_batch.get(batch_index, []),
            batch_input["candidate_ids"],
            kwargs.get("shoe_category") or "",
            required_votes=required_model_votes,
        )
        model_votes = consensus.get("_model_votes") or {}
        return [
            slot
            for slot in SHOE_FULL_POSE_REQUIRED_CONSENSUS_SLOTS
            if not isinstance(model_votes.get(slot), dict)
            or model_votes[slot].get("status") != "locked"
        ]

    def consensus_payloads_for_ready_batches() -> list[dict[str, Any]]:
        payloads: list[dict[str, Any]] = []
        for batch_input in batch_inputs:
            batch_index = int(batch_input["batch_index"])
            if len(routes_by_batch.get(batch_index, set())) < required_model_votes:
                continue
            payloads.append(_consensus_pose_payload(
                payloads_by_batch.get(batch_index, []),
                batch_input["candidate_ids"],
                kwargs.get("shoe_category") or "",
                required_votes=required_model_votes,
            ))
        return payloads

    def missing_global_required_consensus_slots() -> list[str]:
        if pose_strategy != SHOE_POSE_STRATEGY_GLOBAL_PAGES:
            return []
        consensus_payloads = consensus_payloads_for_ready_batches()
        if not consensus_payloads:
            return list(SHOE_FULL_POSE_REQUIRED_CONSENSUS_SLOTS)
        payload = (
            consensus_payloads[0]
            if len(consensus_payloads) == 1
            else _merge_pose_payloads(consensus_payloads)
        )
        slots = payload.get("slots")
        if not isinstance(slots, dict):
            return list(SHOE_FULL_POSE_REQUIRED_CONSENSUS_SLOTS)
        return [
            slot
            for slot in SHOE_FULL_POSE_REQUIRED_CONSENSUS_SLOTS
            if not _consensus_slot_value(slots, slot)
        ]

    def batch_needs_more_model_votes(batch_input: dict[str, Any]) -> bool:
        batch_index = int(batch_input["batch_index"])
        if len(routes_by_batch.get(batch_index, set())) < required_model_votes:
            return True
        if pose_strategy == SHOE_POSE_STRATEGY_GLOBAL_PAGES:
            if len(batch_inputs) > 1:
                return False
            return bool(missing_global_required_consensus_slots())
        return bool(missing_required_consensus_slots(batch_input))

    def record_success(result: dict[str, Any]) -> None:
        batch_index = int(result.get("batch_index") or 0)
        route_model_id = _text(result.get("route_model_id"))
        if not route_model_id:
            return
        if route_model_id in routes_by_batch.setdefault(batch_index, set()):
            log(
                f"[warn] 鞋品姿势识别重复模型路由不计第二票："
                f"{style_code}-{color_code}，批次 {batch_index}/{total_batches}，"
                f"路由 {route_model_id}"
            )
            return
        payload = dict(result["payload"])
        payload["_batch_index"] = batch_index
        payload["_model_id"] = route_model_id
        routes_by_batch[batch_index].add(route_model_id)
        payloads_by_batch.setdefault(batch_index, []).append(payload)
        model_payloads.append(payload)
        if route_model_id not in route_model_ids:
            route_model_ids.append(route_model_id)
        flush_pose_evidence("partial")

    remaining_model_ids = list(model_ids)
    first_model_wave = True
    while remaining_model_ids:
        pending_batches = [
            item
            for item in batch_inputs
            if batch_needs_more_model_votes(item)
        ]
        if not pending_batches:
            break
        available_models = [
            model_id
            for model_id in remaining_model_ids
            if model_id not in disabled_models
        ]
        if not available_models:
            break
        wave_size = (
            min(required_model_votes, len(available_models))
            if first_model_wave
            else 1
        )
        model_wave = available_models[:wave_size]
        remaining_model_ids = [
            model_id
            for model_id in remaining_model_ids
            if model_id not in model_wave
        ]
        first_model_wave = False
        work_items = _interleaved_pose_work_items(
            model_wave,
            pending_batches,
            routes_by_batch,
        )
        if not work_items:
            continue
        log(
            f"鞋品姿势识别智能并发调度：{style_code}-{color_code}，"
            f"模型 {','.join(model_wave)}，批次任务 {len(work_items)} 个，"
            f"并发上限 {min(SHOE_POSE_MAX_CONCURRENT_CALLS, len(work_items))}"
        )

        def invoke_pose_work_item(work_item: tuple[str, dict[str, Any]]) -> dict[str, Any]:
            current_model_id, batch_input = work_item
            return analyze_batch_with_model(batch_input, current_model_id)

        results = _run_pose_model_wave(
            work_items,
            invoke_pose_work_item,
            max_workers=SHOE_POSE_MAX_CONCURRENT_CALLS,
        )
        for (current_model_id, batch_input), result in zip(work_items, results):
            if result.get("ok"):
                record_success(result)
                continue
            batch_index = int(result.get("batch_index") or batch_input["batch_index"])
            error_text = _text(result.get("error")) or "未返回可用结果"
            if result.get("configuration_error"):
                errors.append(
                    f"{current_model_id}: 批次{batch_index}/{total_batches} {error_text}"
                )
                disabled_models.add(current_model_id)
            elif result.get("timeout_like"):
                has_fresh_fallback = any(
                    model_id not in disabled_models
                    for model_id in remaining_model_ids
                )
                errors.append(
                    f"{current_model_id}: 批次{batch_index}/{total_batches} "
                    f"{error_text}；"
                    + (
                        "已切换独立 fallback"
                        if has_fresh_fallback
                        else "无可用独立 fallback，已快速 fail-closed"
                    )
                )
                disabled_models.add(current_model_id)
                if has_fresh_fallback:
                    log(
                        f"[warn] 鞋品姿势识别模型超时，优先切换独立 fallback："
                        f"{style_code}-{color_code}，模型 {current_model_id}，"
                        f"批次 {batch_index}/{total_batches}"
                    )
                else:
                    log(
                        f"[warn] 鞋品姿势识别模型超时且无新 fallback，快速 fail-closed："
                        f"{style_code}-{color_code}，模型 {current_model_id}，"
                        f"批次 {batch_index}/{total_batches}"
                    )
            else:
                errors.append(
                    f"{current_model_id}: 批次{batch_index}/{total_batches} {error_text}"
                )

    pending_batches = [
        item
        for item in batch_inputs
        if len(routes_by_batch.get(int(item["batch_index"]), set()))
        < required_model_votes
    ]
    missing_slot_batches: list[tuple[int, list[str]]] = []
    global_missing_slots: list[str] = []
    if pose_strategy == SHOE_POSE_STRATEGY_GLOBAL_PAGES:
        if not pending_batches and len(batch_inputs) <= 1:
            global_missing_slots = missing_global_required_consensus_slots()
    else:
        missing_slot_batches = [
            (
                int(item["batch_index"]),
                missing_required_consensus_slots(item),
            )
            for item in batch_inputs
            if len(routes_by_batch.get(int(item["batch_index"]), set()))
            >= required_model_votes
        ]
        missing_slot_batches = [
            (batch_index, missing_slots)
            for batch_index, missing_slots in missing_slot_batches
            if missing_slots
        ]
    if pending_batches:
        errors.extend(
            f"共识票数不足批次{int(item.get('batch_index') or 0)}/{total_batches} "
            f"{len(routes_by_batch.get(int(item['batch_index']), set()))}/{required_model_votes}"
            for item in pending_batches
        )
    if missing_slot_batches:
        errors.extend(
            f"必需槽位未锁定批次{batch_index}/{total_batches}：{','.join(missing_slots)}"
            for batch_index, missing_slots in missing_slot_batches
        )
    if global_missing_slots:
        errors.append(f"全局必需槽位未锁定：{','.join(global_missing_slots)}")
    if pending_batches or missing_slot_batches or global_missing_slots:
        flush_pose_evidence("failed")
        raise ShoeSelectionError(
            f"{style_code}-{color_code} 鞋品姿势识别独立模型共识不足："
            + "；".join(errors[:8])
        )

    if model_payloads:
        consensus_payloads = [
            _consensus_pose_payload(
                payloads_by_batch[int(batch_input["batch_index"])],
                batch_input["candidate_ids"],
                kwargs.get("shoe_category") or "",
                required_votes=required_model_votes,
            )
            for batch_input in batch_inputs
        ]
        targeted_from_batch_overview = bool(
            pose_strategy == SHOE_POSE_STRATEGY_BATCH_OVERVIEW
            and len(consensus_payloads) > 1
        )
        requires_focused = bool(
            pose_strategy == SHOE_POSE_STRATEGY_GLOBAL_PAGES
            and len(consensus_payloads) > 1
        )
        requires_semantic_recheck = requires_focused or targeted_from_batch_overview
        if requires_semantic_recheck and not candidate_entries:
            message = (
                "global_pages focused 缺少 candidate_entries，拒绝回退旧跨页合并"
                if requires_focused
                else (
                    "batch_overview 语义复核缺少 candidate_entries，"
                    "拒绝回退旧跨批次合并"
                )
            )
            errors.append(message)
            focused_consensus_evidence.update({
                "status": "failed",
                "errors": [message],
            })
            flush_pose_evidence("failed")
            raise ShoeSelectionError(f"{style_code}-{color_code} {message}")
        should_run_focused = requires_semantic_recheck
        if should_run_focused:
            page_conflict_slots = (
                _cross_page_conflict_slots(consensus_payloads)
                if requires_focused
                else []
            )
            focused_candidate_ids = (
                _focused_candidate_ids_from_page_payloads(
                    payloads_by_batch=payloads_by_batch,
                    batch_inputs=batch_inputs,
                    candidate_ids=candidate_ids,
                    shoe_category=kwargs.get("shoe_category") or "",
                    style_code=style_code,
                    color_code=color_code,
                )
                if requires_focused
                else dict(candidate_ids)
            )
            entries_by_name = {
                _text(item.get("filename")): item
                for item in candidate_entries
            }
            first_contact = Path(_text(contact_sheets[0]))
            if not first_contact.is_absolute() and not first_contact.exists():
                first_entry_path = Path(candidate_entries[0]["path"])
                focused_target = first_entry_path.parent / f"{color_code}-focused.jpg"
            else:
                focused_target = first_contact.with_name(f"{color_code}-focused.jpg")
            focused_sheets: list[Path] = []
            focused_batch: dict[str, Any] = {}
            if requires_focused:
                focused_sheets, rendered_focused_ids = _create_focused_contact_sheets(
                    focused_candidate_ids,
                    entries_by_name,
                    focused_target,
                )
                if rendered_focused_ids != focused_candidate_ids:
                    raise ShoeSelectionError(
                        f"{style_code}-{color_code} global_pages focused 候选编号写入不一致"
                    )
                if main_pose_reference_images:
                    focused_image_inputs = [
                        *[str(path) for path in focused_sheets],
                        *main_pose_reference_images,
                        kwargs.get("poster_reference_image") or str(SHOE_POSTER_REFERENCE_IMAGE),
                        kwargs["yq_reference_image"],
                    ]
                    focused_reference_count = len(main_pose_reference_images)
                else:
                    focused_image_inputs = [
                        *[str(path) for path in focused_sheets],
                        main_pose_reference_sheet or kwargs["reference_image"],
                        kwargs.get("poster_reference_image") or str(SHOE_POSTER_REFERENCE_IMAGE),
                        kwargs["yq_reference_image"],
                    ]
                    focused_reference_count = 0
                _ensure_pose_image_input_limit(
                    focused_image_inputs,
                    style_code=style_code,
                    color_code=color_code,
                    pose_strategy=SHOE_POSE_STRATEGY_FOCUSED,
                )
                focused_batch = {
                    "batch_index": 1,
                    "candidate_ids": focused_candidate_ids,
                    "user_prompt": _shoe_selection_prompt(
                        style_code,
                        color_code,
                        focused_candidate_ids,
                        kwargs.get("shoe_category") or "",
                        candidate_sheet_count=len(focused_sheets),
                        candidate_scope=SHOE_POSE_STRATEGY_FOCUSED,
                        main_pose_reference_count=focused_reference_count,
                    ),
                    "image_inputs": focused_image_inputs,
                }
            focused_payloads: list[dict[str, Any]] = []
            focused_routes: set[str] = set()
            focused_errors: list[str] = []
            focused_payload: dict[str, Any] | None = None
            focused_missing = list(SHOE_FULL_POSE_REQUIRED_CONSENSUS_SLOTS)
            targeted_slot_consensus: dict[str, Any] = {}
            available_mandatory_targeted_slots: tuple[str, ...] = ()

            def available_model_count() -> int:
                return max(
                    1,
                    sum(model_id not in disabled_models for model_id in model_ids),
                )

            def elevated_required_votes(slot: str) -> int:
                if (
                    focused_payload is not None
                    and slot in set(
                        focused_payload.get("_exact_contract_locked_slots") or []
                    )
                ):
                    return required_model_votes
                return (
                    max(required_model_votes, min(3, available_model_count()))
                    if slot in page_conflict_slots
                    else required_model_votes
                )

            def focused_required_route_count() -> int:
                return (
                    max(required_model_votes, min(3, available_model_count()))
                    if page_conflict_slots
                    else required_model_votes
                )

            def targeted_required_votes(slot: str) -> int:
                return elevated_required_votes(slot)

            def focused_missing_slots(payload: dict[str, Any]) -> list[str]:
                votes = payload.get("_model_votes") or {}
                missing: list[str] = []
                for slot in SHOE_FULL_POSE_REQUIRED_CONSENSUS_SLOTS:
                    vote = votes.get(slot)
                    required_slot_votes = elevated_required_votes(slot)
                    if (
                        not isinstance(vote, dict)
                        or vote.get("status") != "locked"
                        or int(vote.get("votes") or 0) < required_slot_votes
                    ):
                        missing.append(slot)
                return missing

            def update_focused_evidence() -> None:
                focused_consensus_evidence.update({
                    "candidate_ids": focused_candidate_ids,
                    "contact_sheets": [str(path) for path in focused_sheets],
                    "routes": sorted(focused_routes),
                    "page_conflict_slots": page_conflict_slots,
                    "required_route_count": focused_required_route_count(),
                    "required_votes_by_slot": {
                        slot: targeted_required_votes(slot)
                        for slot in SHOE_FULL_POSE_REQUIRED_CONSENSUS_SLOTS
                    },
                    "model_votes": (
                        focused_payload.get("_model_votes") if focused_payload else {}
                    ),
                    "consensus_issues": (
                        focused_payload.get("_consensus_issues") if focused_payload else []
                    ),
                    "candidate_facts_by_model": (
                        focused_payload.get("_candidate_facts_by_model")
                        if focused_payload
                        else []
                    ),
                    "targeted_slot_consensus": targeted_slot_consensus,
                    "errors": focused_errors,
                })

            def targeted_reference_for_slot(slot: str) -> str:
                match = re.fullmatch(r"tmz([1-5])", slot)
                if match:
                    index = int(match.group(1)) - 1
                    if index < len(main_pose_reference_images):
                        return main_pose_reference_images[index]
                    return ""
                if slot == "wpz5":
                    return (
                        main_pose_reference_images[4]
                        if len(main_pose_reference_images) >= 5
                        else ""
                    )
                if slot in {"yq1", "yq2", "yq3"}:
                    return _text(yq_reference_images.get(slot))
                return ""

            available_mandatory_targeted_slots = tuple(
                slot
                for slot in SHOE_MANDATORY_TARGETED_SLOTS
                if slot != "yq3" or targeted_from_batch_overview
            )

            if targeted_from_batch_overview:
                focused_payload = _merge_batch_consensus_payloads(
                    consensus_payloads,
                    required_votes=required_model_votes,
                )
                focused_routes.update(focused_payload.get("_consensus_routes") or [])
                focused_missing = focused_missing_slots(focused_payload)

            def try_lock_exact_tms_contract() -> bool:
                if focused_payload is None:
                    return False
                exact_contract_evidence = [
                    *list(focused_payload.get("_candidate_facts_by_model") or []),
                    *[
                        evidence
                        for page_payload in consensus_payloads
                        for evidence in (
                            page_payload.get("_candidate_facts_by_model") or []
                        )
                    ],
                ]
                return _lock_verified_exact_tms_contract(
                    focused_payload,
                    candidate_ids=focused_candidate_ids,
                    entries_by_name=entries_by_name,
                    style_code=style_code,
                    color_code=color_code,
                    required_votes=required_model_votes,
                    candidate_facts_by_model=exact_contract_evidence,
                )

            if targeted_from_batch_overview:
                log(
                    f"鞋品 batch_overview 缺槽定向复核：{style_code}-{color_code}，"
                    f"跳过全量 focused，待锁定 {','.join(focused_missing) or '无'}"
                )
            else:
                log(
                    f"鞋品 focused finalist 复核：{style_code}-{color_code}，"
                    f"{len(focused_candidate_ids)} 个候选族，"
                    f"{len(focused_sheets)} 张候选图"
                )
            focused_remaining_models = (
                [] if targeted_from_batch_overview else list(model_ids)
            )
            while focused_remaining_models:
                available_models = [
                    model_id
                    for model_id in focused_remaining_models
                    if model_id not in disabled_models
                ]
                if not available_models:
                    break
                needed_routes = max(
                    1,
                    focused_required_route_count() - len(focused_routes),
                )
                focused_wave = available_models[:needed_routes]
                focused_remaining_models = [
                    model_id
                    for model_id in focused_remaining_models
                    if model_id not in focused_wave
                ]
                log(
                    f"鞋品 focused 智能并发评分：{style_code}-{color_code}，"
                    f"模型 {','.join(focused_wave)}"
                )
                focused_results = _run_pose_model_wave(
                    focused_wave,
                    lambda current_model_id: analyze_batch_with_model(
                        focused_batch,
                        current_model_id,
                    ),
                    max_workers=SHOE_POSE_MAX_CONCURRENT_CALLS,
                )
                timed_out_focused_models = [
                    current_model_id
                    for current_model_id, result in zip(
                        focused_wave,
                        focused_results,
                    )
                    if not result.get("ok") and result.get("timeout_like")
                ]
                has_fresh_focused_fallback = any(
                    model_id not in disabled_models
                    for model_id in focused_remaining_models
                )
                if timed_out_focused_models:
                    disabled_models.update(timed_out_focused_models)
                    for current_model_id in timed_out_focused_models:
                        if has_fresh_focused_fallback:
                            log(
                                f"[warn] 鞋品 focused 模型超时，优先切换独立 fallback："
                                f"{style_code}-{color_code}，模型 {current_model_id}"
                            )
                        else:
                            log(
                                f"[warn] 鞋品 focused 模型超时且无新 fallback，"
                                f"快速 fail-closed：{style_code}-{color_code}，"
                                f"模型 {current_model_id}"
                            )
                for current_model_id, initial_result in zip(
                    focused_wave,
                    focused_results,
                ):
                    result = initial_result
                    if not result.get("ok"):
                        focused_errors.append(
                            f"{current_model_id}: "
                            f"{_text(result.get('error')) or '未返回可用结果'}"
                        )
                        if result.get("configuration_error"):
                            disabled_models.add(current_model_id)
                        continue
                    route_model_id = _text(result.get("route_model_id"))
                    if not route_model_id or route_model_id in focused_routes:
                        continue
                    focused_routes.add(route_model_id)
                    focused_result = dict(result["payload"])
                    focused_result["_model_id"] = route_model_id
                    focused_payloads.append(focused_result)
                if focused_payloads:
                    focused_payload = _consensus_pose_payload(
                        focused_payloads,
                        focused_candidate_ids,
                        kwargs.get("shoe_category") or "",
                        required_votes=required_model_votes,
                    )
                    exact_contract_locked = try_lock_exact_tms_contract()
                    focused_missing = focused_missing_slots(focused_payload)
                    if exact_contract_locked:
                        log(
                            f"鞋品精确白底契约提前锁定：{style_code}-{color_code}，"
                            "tmz5 跳过后续模型和 targeted 二次投票"
                        )
                update_focused_evidence()
                flush_pose_evidence("partial")
                if len(focused_routes) >= focused_required_route_count():
                    if focused_missing:
                        log(
                            f"鞋品 focused 已达到独立路由法定数，转精确单槽位审核："
                            f"{style_code}-{color_code}，待裁决 {','.join(focused_missing)}"
                        )
                    break

            if focused_payload is not None and try_lock_exact_tms_contract():
                focused_missing = focused_missing_slots(focused_payload)
                if "tmz5" not in focused_missing:
                    log(
                        f"鞋品精确白底契约提前锁定：{style_code}-{color_code}，"
                        "tmz5 跳过 targeted 二次投票"
                    )
                update_focused_evidence()
                flush_pose_evidence("partial")

            focused_targets = list(focused_missing)
            for mandatory_slot in available_mandatory_targeted_slots:
                if mandatory_slot not in focused_targets:
                    focused_targets.append(mandatory_slot)
            if focused_payload is not None and focused_targets:
                log(
                    f"鞋品 focused 单槽位复核：{style_code}-{color_code}，"
                    f"待裁决 {','.join(focused_targets)}"
                )
                for target_slot in focused_targets:
                    target_required_votes = targeted_required_votes(target_slot)
                    reference_image = targeted_reference_for_slot(target_slot)
                    target_errors: list[str] = []
                    if target_slot != "wpz6" and not reference_image:
                        target_errors.append(f"{target_slot} 缺少精确模板切片")
                        targeted_slot_consensus[target_slot] = {
                            "status": "failed",
                            "reference_image": "",
                            "routes": [],
                            "required_votes": target_required_votes,
                            "model_votes": {},
                            "consensus_issues": [],
                            "candidate_facts_by_model": [],
                            "candidate_ids": {},
                            "excluded_candidates": {},
                            "contact_sheets": [],
                            "rounds": [],
                            "errors": target_errors,
                        }
                        update_focused_evidence()
                        flush_pose_evidence("partial")
                        continue
                    focused_slots = focused_payload.get("slots")
                    if not isinstance(focused_slots, dict):
                        raise ShoeSelectionError("鞋品 focused 结果缺少 slots")
                    target_candidate_ids, excluded_candidates = (
                        _targeted_slot_candidate_ids(
                            target_slot,
                            focused_candidate_ids,
                            focused_slots=focused_slots,
                            candidate_facts_by_model=list(
                                focused_payload.get("_candidate_facts_by_model") or []
                            ),
                            required_votes=target_required_votes,
                            entries_by_name=entries_by_name,
                            shoe_category=kwargs.get("shoe_category") or "",
                            prefer_prior_slot_nominations=targeted_from_batch_overview,
                            prefer_exact_tmz5_visual_pair=bool(
                                targeted_from_batch_overview
                                and target_slot == "wpz5"
                                and "tmz5"
                                in (focused_payload.get("_exact_contract_locked_slots") or [])
                            ),
                        )
                    )
                    expanded_target_candidate_ids = dict(target_candidate_ids)
                    if targeted_from_batch_overview:
                        expanded_target_candidate_ids, _expanded_exclusions = (
                            _targeted_slot_candidate_ids(
                                target_slot,
                                focused_candidate_ids,
                                focused_slots=focused_slots,
                                candidate_facts_by_model=list(
                                    focused_payload.get("_candidate_facts_by_model") or []
                                ),
                                required_votes=target_required_votes,
                                entries_by_name=entries_by_name,
                                shoe_category=kwargs.get("shoe_category") or "",
                                prefer_prior_slot_nominations=False,
                            )
                        )
                    if not target_candidate_ids:
                        target_errors.append(
                            f"{target_slot} 经过跨槽占用和历史事实门禁后无候选"
                        )
                        targeted_slot_consensus[target_slot] = {
                            "status": "failed",
                            "reference_image": reference_image,
                            "routes": [],
                            "required_votes": target_required_votes,
                            "model_votes": {},
                            "consensus_issues": [],
                            "candidate_facts_by_model": [],
                            "candidate_ids": {},
                            "excluded_candidates": excluded_candidates,
                            "contact_sheets": [],
                            "rounds": [],
                            "errors": target_errors,
                        }
                        update_focused_evidence()
                        flush_pose_evidence("partial")
                        continue

                    target_payloads: list[dict[str, Any]] = []
                    target_routes: set[str] = set()
                    all_target_routes: set[str] = set()
                    target_payload: dict[str, Any] | None = None
                    target_vote: dict[str, Any] = {}
                    target_rounds: list[dict[str, Any]] = []
                    target_contact_sheets: list[str] = []
                    current_candidate_ids = target_candidate_ids

                    for round_index in (1, 2):
                        target_sheets, rendered_target_ids = (
                            _create_targeted_slot_contact_sheets(
                                target_slot,
                                current_candidate_ids,
                                entries_by_name,
                                focused_target,
                                round_index=round_index,
                                reference_image=reference_image,
                            )
                        )
                        if rendered_target_ids != current_candidate_ids:
                            raise ShoeSelectionError(
                                f"{style_code}-{color_code} {target_slot} "
                                "单槽位候选编号写入不一致"
                            )
                        target_contact_sheets.extend(str(path) for path in target_sheets)
                        target_image_inputs = [
                            *[str(path) for path in target_sheets],
                            *([reference_image] if reference_image else []),
                        ]
                        _ensure_pose_image_input_limit(
                            target_image_inputs,
                            style_code=style_code,
                            color_code=color_code,
                            pose_strategy=(
                                f"{SHOE_POSE_STRATEGY_FOCUSED}:{target_slot}:"
                                f"round{round_index}"
                            ),
                        )
                        target_batch = {
                            "batch_index": 1,
                            "candidate_ids": current_candidate_ids,
                            "user_prompt": _shoe_targeted_slot_prompt(
                                style_code,
                                color_code,
                                current_candidate_ids,
                                kwargs.get("shoe_category") or "",
                                target_slot=target_slot,
                                candidate_sheet_count=len(target_sheets),
                                has_reference_image=bool(reference_image),
                            ),
                            "image_inputs": target_image_inputs,
                        }
                        target_payloads = []
                        target_routes = set()
                        target_payload = None
                        target_vote = {}
                        round_errors: list[str] = []
                        round_evidence: dict[str, Any] = {
                            "round": round_index,
                            "candidate_ids": dict(current_candidate_ids),
                            "contact_sheets": [str(path) for path in target_sheets],
                            "routes": [],
                            "status": "partial",
                            "model_votes": {},
                            "consensus_issues": [],
                            "candidate_facts_by_model": [],
                            "errors": round_errors,
                        }
                        target_rounds.append(round_evidence)
                        log(
                            f"鞋品 focused 单槽位裁决：{style_code}-{color_code}，"
                            f"槽位 {target_slot}，第 {round_index} 轮 "
                            f"{len(current_candidate_ids)} 个候选，要求 "
                            f"{target_required_votes} 个独立路由同票"
                        )
                        target_remaining_models = list(model_ids)
                        while target_remaining_models:
                            available_models = [
                                model_id
                                for model_id in target_remaining_models
                                if model_id not in disabled_models
                            ]
                            if not available_models:
                                break
                            needed_routes = max(
                                1,
                                target_required_votes - len(target_routes),
                            )
                            target_wave = available_models[:needed_routes]
                            target_remaining_models = [
                                model_id
                                for model_id in target_remaining_models
                                if model_id not in target_wave
                            ]
                            log(
                                f"鞋品 focused 单槽位智能并发评分："
                                f"{style_code}-{color_code}，槽位 {target_slot}，"
                                f"第 {round_index} 轮，模型 {','.join(target_wave)}"
                            )
                            target_results = _run_pose_model_wave(
                                target_wave,
                                lambda current_model_id: analyze_batch_with_model(
                                    target_batch,
                                    current_model_id,
                                ),
                                max_workers=SHOE_POSE_MAX_CONCURRENT_CALLS,
                            )
                            timed_out_target_models = [
                                current_model_id
                                for current_model_id, result in zip(
                                    target_wave,
                                    target_results,
                                )
                                if not result.get("ok") and result.get("timeout_like")
                            ]
                            has_fresh_target_fallback = any(
                                model_id not in disabled_models
                                for model_id in target_remaining_models
                            )
                            if timed_out_target_models:
                                disabled_models.update(timed_out_target_models)
                                for current_model_id in timed_out_target_models:
                                    if has_fresh_target_fallback:
                                        log(
                                            f"[warn] 鞋品 focused 单槽位模型超时，"
                                            f"优先切换独立 fallback：{style_code}-{color_code}，"
                                            f"模型 {current_model_id}，槽位 {target_slot}，"
                                            f"第 {round_index} 轮"
                                        )
                                    else:
                                        log(
                                            f"[warn] 鞋品 focused 单槽位模型超时且无新 "
                                            f"fallback，快速 fail-closed："
                                            f"{style_code}-{color_code}，模型 {current_model_id}，"
                                            f"槽位 {target_slot}，第 {round_index} 轮"
                                        )
                            for current_model_id, initial_result in zip(
                                target_wave,
                                target_results,
                            ):
                                result = initial_result
                                if not result.get("ok"):
                                    error_text = (
                                        f"第{round_index}轮 {current_model_id}: "
                                        f"{_text(result.get('error')) or '未返回可用结果'}"
                                    )
                                    round_errors.append(error_text)
                                    target_errors.append(error_text)
                                    if result.get("configuration_error"):
                                        disabled_models.add(current_model_id)
                                    continue
                                route_model_id = _text(result.get("route_model_id"))
                                if not route_model_id or route_model_id in target_routes:
                                    continue
                                target_routes.add(route_model_id)
                                all_target_routes.add(route_model_id)
                                target_result = _restrict_pose_payload_to_target_slot(
                                    dict(result["payload"]),
                                    current_candidate_ids,
                                    target_slot,
                                )
                                target_result["_model_id"] = route_model_id
                                target_payloads.append(target_result)
                            if target_payloads:
                                target_payload = _consensus_pose_payload(
                                    target_payloads,
                                    current_candidate_ids,
                                    kwargs.get("shoe_category") or "",
                                    required_votes=target_required_votes,
                                    entries_by_name=(
                                        candidate_entries_by_name
                                        if target_slot == "yq3"
                                        else None
                                    ),
                                    same_background_visual_slot=(
                                        "yq3" if target_slot == "yq3" else ""
                                    ),
                                )
                                target_vote = dict(
                                    (target_payload.get("_model_votes") or {}).get(
                                        target_slot
                                    )
                                    or {}
                                )
                                round_evidence.update({
                                    "routes": sorted(target_routes),
                                    "status": (
                                        "locked"
                                        if target_vote.get("status") == "locked"
                                        else "partial"
                                    ),
                                    "model_votes": target_payload.get("_model_votes") or {},
                                    "consensus_issues": (
                                        target_payload.get("_consensus_issues") or []
                                    ),
                                    "candidate_facts_by_model": (
                                        target_payload.get("_candidate_facts_by_model") or []
                                    ),
                                })
                                targeted_slot_consensus[target_slot] = {
                                    "status": round_evidence["status"],
                                    "reference_image": reference_image,
                                    "routes": sorted(target_routes),
                                    "required_votes": target_required_votes,
                                    "model_votes": target_payload.get("_model_votes") or {},
                                    "consensus_issues": (
                                        target_payload.get("_consensus_issues") or []
                                    ),
                                    "candidate_facts_by_model": (
                                        target_payload.get("_candidate_facts_by_model") or []
                                    ),
                                    "candidate_ids": dict(target_candidate_ids),
                                    "expanded_candidate_ids": dict(
                                        expanded_target_candidate_ids
                                    ),
                                    "excluded_candidates": excluded_candidates,
                                    "contact_sheets": list(target_contact_sheets),
                                    "rounds": target_rounds,
                                    "errors": target_errors,
                                }
                                update_focused_evidence()
                                flush_pose_evidence("partial")
                                if (
                                    target_vote.get("status") == "locked"
                                    and int(target_vote.get("votes") or 0)
                                    >= target_required_votes
                                ):
                                    break
                                if (
                                    targeted_from_batch_overview
                                    and round_index == 1
                                    and len(target_routes) >= target_required_votes
                                    and target_vote.get("status") != "locked"
                                    and set(expanded_target_candidate_ids)
                                    != set(current_candidate_ids)
                                ):
                                    break

                        locked = bool(
                            target_payload is not None
                            and target_vote.get("status") == "locked"
                            and int(target_vote.get("votes") or 0)
                            >= target_required_votes
                        )
                        if locked:
                            break
                        if (
                            targeted_from_batch_overview
                            and round_index == 1
                            and len(target_routes) >= target_required_votes
                            and target_vote.get("status") != "locked"
                            and set(expanded_target_candidate_ids)
                            != set(current_candidate_ids)
                        ):
                            log(
                                f"鞋品 focused 单槽位提名未达双票，扩大候选池："
                                f"{style_code}-{color_code}，槽位 {target_slot}，"
                                f"{len(current_candidate_ids)} -> "
                                f"{len(expanded_target_candidate_ids)}"
                            )
                            current_candidate_ids = expanded_target_candidate_ids
                            continue
                        finalists = _targeted_round_finalist_ids(
                            target_payloads,
                            current_candidate_ids,
                            target_slot,
                            kwargs.get("shoe_category") or "",
                        )
                        if (
                            round_index == 1
                            and finalists
                            and set(finalists) != set(current_candidate_ids)
                        ):
                            log(
                                f"鞋品 focused 单槽位决赛：{style_code}-{color_code}，"
                                f"槽位 {target_slot}，候选收敛 "
                                f"{len(current_candidate_ids)} -> {len(finalists)}"
                            )
                            current_candidate_ids = finalists
                            continue
                        break

                    if (
                        target_payload is None
                        or target_vote.get("status") != "locked"
                        or int(target_vote.get("votes") or 0) < target_required_votes
                    ):
                        existing = targeted_slot_consensus.get(target_slot) or {}
                        existing.update({
                            "status": "failed",
                            "reference_image": reference_image,
                            "routes": sorted(target_routes),
                            "required_votes": target_required_votes,
                            "candidate_ids": dict(target_candidate_ids),
                            "expanded_candidate_ids": dict(
                                expanded_target_candidate_ids
                            ),
                            "excluded_candidates": excluded_candidates,
                            "contact_sheets": list(target_contact_sheets),
                            "rounds": target_rounds,
                            "errors": target_errors,
                        })
                        targeted_slot_consensus[target_slot] = existing
                        update_focused_evidence()
                        flush_pose_evidence("partial")
                        continue
                    selected = _consensus_slot_value(
                        target_payload.get("slots") or {},
                        target_slot,
                    )
                    _replace_consensus_slot_value(
                        focused_slots,
                        target_slot,
                        selected,
                    )
                    focused_payload.setdefault("_model_votes", {})[target_slot] = target_vote
                    focused_payload["_consensus_issues"] = [
                        issue
                        for issue in (focused_payload.get("_consensus_issues") or [])
                        if _text(issue.get("slot")) != target_slot
                    ]
                    focused_payload.setdefault("_candidate_facts_by_model", []).extend(
                        target_payload.get("_candidate_facts_by_model") or []
                    )
                    focused_routes.update(all_target_routes)
                    focused_payload["_consensus_routes"] = sorted(focused_routes)
                    focused_payload["_model_id"] = "+".join(sorted(focused_routes))
                    focused_payload["_targeted_slot_consensus"] = targeted_slot_consensus
                    focused_missing = focused_missing_slots(focused_payload)
                    update_focused_evidence()
                    flush_pose_evidence("partial")
            for mandatory_slot in available_mandatory_targeted_slots:
                evidence = targeted_slot_consensus.get(mandatory_slot) or {}
                vote = (evidence.get("model_votes") or {}).get(mandatory_slot) or {}
                if (
                    evidence.get("status") != "locked"
                    or int(vote.get("votes") or 0)
                    < targeted_required_votes(mandatory_slot)
                ):
                    if mandatory_slot not in focused_missing:
                        focused_missing.append(mandatory_slot)
            focused_routes_missing = max(
                0,
                focused_required_route_count() - len(focused_routes),
            )
            if focused_payload is None or focused_missing or focused_routes_missing:
                update_focused_evidence()
                flush_pose_evidence("failed")
                focused_failure = (
                    ",".join(focused_missing)
                    if focused_missing
                    else (
                        f"独立路由不足 {len(focused_routes)}/"
                        f"{focused_required_route_count()}"
                    )
                )
                raise ShoeSelectionError(
                    f"{style_code}-{color_code} "
                    + (
                        "global_pages focused 独立模型共识不足："
                        if requires_focused
                        else "batch_overview 语义复核独立模型共识不足："
                    )
                    + focused_failure
                    + (f"；{'；'.join(focused_errors[:4])}" if focused_errors else "")
                )
            page_facts = [
                evidence
                for item in consensus_payloads
                for evidence in (item.get("_candidate_facts_by_model") or [])
            ]
            focused_facts = list(focused_payload.get("_candidate_facts_by_model") or [])
            focused_payload["_model_votes_by_batch"] = [
                item.get("_model_votes") or {}
                for item in consensus_payloads
            ]
            focused_payload["_page_consensus_issues"] = [
                issue
                for item in consensus_payloads
                for issue in (item.get("_consensus_issues") or [])
            ]
            focused_payload["_candidate_facts_by_model"] = [
                *focused_facts,
                *page_facts,
            ]
            focused_payload["_focused_candidate_ids"] = focused_candidate_ids
            focused_payload["_focused_contact_sheets"] = [
                str(path) for path in focused_sheets
            ]
            focused_consensus_evidence.update({
                "candidate_ids": focused_candidate_ids,
                "contact_sheets": [str(path) for path in focused_sheets],
                "routes": list(focused_payload.get("_consensus_routes") or []),
                "page_conflict_slots": page_conflict_slots,
                "required_route_count": focused_required_route_count(),
                "required_votes_by_slot": {
                    slot: targeted_required_votes(slot)
                    for slot in SHOE_FULL_POSE_REQUIRED_CONSENSUS_SLOTS
                },
                "model_votes": focused_payload.get("_model_votes") or {},
                "consensus_issues": focused_payload.get("_consensus_issues") or [],
                "candidate_facts_by_model": focused_facts,
                "targeted_slot_consensus": targeted_slot_consensus,
                "errors": focused_errors,
            })
            payload = focused_payload
        elif len(consensus_payloads) == 1:
            payload = consensus_payloads[0]
        else:
            payload = _merge_pose_payloads(consensus_payloads)
            payload["_model_id"] = "+".join(route_model_ids)
            payload["_model_votes_by_batch"] = [
                item.get("_model_votes") or {}
                for item in consensus_payloads
            ]
            payload["_consensus_issues"] = [
                issue
                for item in consensus_payloads
                for issue in (item.get("_consensus_issues") or [])
            ]
            payload["_candidate_facts_by_model"] = [
                evidence
                for item in consensus_payloads
                for evidence in (item.get("_candidate_facts_by_model") or [])
            ]
        _validate_pose_payload_references(payload, candidate_ids)
        if errors:
            payload["_model_attempt_warnings"] = "；".join(errors[:5])
        flush_pose_evidence("complete")
        return payload

    flush_pose_evidence("failed")
    raise ShoeSelectionError(
        f"{style_code}-{color_code} 鞋品姿势识别多模型均失败："
        + "；".join(errors[:8])
    )


def _create_label_preview(source: Path, target: Path) -> None:
    # Labels contain small printed fields. Preserve more source detail than the
    # pose previews so the model reads the label instead of guessing from the
    # shoe/box appearance; normalized coordinates remain valid after resizing.
    _create_model_input_preview(source, target, max_side=1800)


def _create_focused_label_preview(
    source: Path,
    target: Path,
    label_bbox: Any,
) -> Path:
    from PIL import Image, ImageOps

    label = _normalized_bbox(label_bbox)
    if label is None:
        raise ShoeSelectionError("鞋盒标签坐标无效，无法生成定向 OCR 裁片")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", Image.DecompressionBombWarning)
        with Image.open(source) as opened:
            image = _image_rgb_on_white(ImageOps.exif_transpose(opened))
    width, height = image.size
    x1, y1, x2, y2 = label
    # Keep a little more surrounding box context than the coarse detector
    # returns.  Besides avoiding clipped first/last characters, this keeps the
    # printed field labels visible so vision routes distinguish look-alike
    # glyphs such as “红” and “灰”.
    pad_x = (x2 - x1) * 0.12
    pad_y = (y2 - y1) * 0.12
    crop = image.crop((
        round(max(0.0, x1 - pad_x) * width),
        round(max(0.0, y1 - pad_y) * height),
        round(min(1.0, x2 + pad_x) * width),
        round(min(1.0, y2 + pad_y) * height),
    ))
    max_side = max(crop.size)
    if max_side != 1800:
        scale = 1800 / max_side
        crop = crop.resize(
            (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
            Image.Resampling.LANCZOS,
        )
    target.parent.mkdir(parents=True, exist_ok=True)
    crop.save(target, format="JPEG", quality=96, optimize=True)
    return target


def _create_focused_label_color_context_preview(
    source: Path,
    target: Path,
    label_bbox: Any,
) -> Path:
    """Crop the product/color side of a shoe-box label at native detail."""

    from PIL import Image, ImageOps

    label = _normalized_bbox(label_bbox)
    if label is None:
        raise ShoeSelectionError("鞋盒标签坐标无效，无法生成颜色字段上下文裁片")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", Image.DecompressionBombWarning)
        with Image.open(source) as opened:
            image = _image_rgb_on_white(ImageOps.exif_transpose(opened))
    width, height = image.size
    x1, y1, x2, y2 = label
    label_width = x2 - x1
    label_height = y2 - y1
    # Keep the whole label and some surrounding box context.  The printed color
    # row is faint, and aggressive lower-left crops remove the table/grid cues
    # that vision routes use to distinguish the color value from nearby size,
    # material and compliance fields.  This asymmetric crop keeps the label
    # large while preserving those cues.
    crop = image.crop((
        round(max(0.0, x1 - label_width * 0.40) * width),
        round(max(0.0, y1 - label_height * 0.30) * height),
        round(min(1.0, x2 + label_width * 0.02) * width),
        round(min(1.0, y2 + label_height * 0.20) * height),
    ))
    max_side = max(crop.size)
    if max_side > 1800:
        scale = 1800 / max_side
        crop = crop.resize(
            (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
            Image.Resampling.LANCZOS,
        )
    target.parent.mkdir(parents=True, exist_ok=True)
    crop.save(target, format="JPEG", quality=96, optimize=True)
    return target


def _default_analyze_color_label(**kwargs) -> dict[str, Any]:
    color_code = kwargs["color_code"]
    style_code = kwargs["style_code"]
    model_id = (
        _text(kwargs.get("label_model_id"))
        or _text(kwargs.get("model_id"))
        or SHOE_LABEL_OCR_MODEL
    )
    config = kwargs.get("config")
    model_ids = _shoe_label_model_ids(
        model_id,
        config,
        kwargs.get("label_fallback_model_ids") or kwargs.get("fallback_model_ids"),
    )
    log = kwargs.get("log") or (lambda _message: None)
    progress = kwargs.get("progress")
    errors: list[str] = []
    ai_color_votes: dict[str, list[dict[str, Any]]] = {}
    local_label_evidence: dict[str, Any] | None = None
    focused_seed_candidate: dict[str, Any] | None = None

    def model_family(model_id: str) -> str:
        """Collapse correlated routes so same-family OCR is not independent proof."""

        normalized = _text(model_id).lower()
        for family, prefixes in {
            "openai": ("gpt-",),
            "google": ("gemini-",),
            "qwen": ("qwen",),
            "kimi": ("kimi-",),
            "deepseek": ("deepseek-",),
            "glm": ("glm-",),
            "anthropic": ("claude-",),
        }.items():
            if normalized.startswith(prefixes):
                return family
        return normalized

    def accept_label_payload(candidate: dict[str, Any]) -> dict[str, Any] | None:
        transcription = dict(candidate.get("_label_transcription") or {})
        if (
            _text(transcription.get("source"))
            != "local_tesseract_style_identity_ai_color_fallback"
        ):
            return candidate
        color_key = re.sub(r"\s+", "", _text(candidate.get("color_name"))).lower()
        route_id = _text(candidate.get("_model_id"))
        votes = ai_color_votes.setdefault(color_key, [])
        if route_id and all(_text(item.get("_model_id")) != route_id for item in votes):
            votes.append(candidate)
        vote_families = {
            model_family(_text(item.get("_model_id")))
            for item in votes
            if _text(item.get("_model_id"))
        }
        if len(votes) < 2 or len(vote_families) < 2:
            log(
                f"鞋盒标签 AI 颜色等待跨模型家族同票：{style_code}-{color_code}，"
                f"颜色 {_text(candidate.get('color_name'))}，当前 {len(votes)} 票/"
                f"{len(vote_families)} 个模型家族"
            )
            return None
        accepted_votes: list[dict[str, Any]] = []
        accepted_families: set[str] = set()
        for item in votes:
            family = model_family(_text(item.get("_model_id")))
            if not family or family in accepted_families:
                continue
            accepted_votes.append(item)
            accepted_families.add(family)
            if len(accepted_votes) == 2:
                break
        accepted = dict(accepted_votes[0])
        routes = [_text(item.get("_model_id")) for item in accepted_votes]
        accepted["_model_id"] = "+".join(routes)
        accepted_transcription = dict(
            accepted.get("_label_transcription") or {}
        )
        accepted_transcription.update({
            "source": "local_tesseract_style_identity_ai_color_consensus",
            "model_routes": routes,
            "model_families": sorted(accepted_families),
            "model_votes": 2,
            "color_name_source": "focused_label_ai_consensus",
        })
        accepted["_label_transcription"] = accepted_transcription
        log(
            f"鞋盒标签 AI 颜色跨模型家族同票：{style_code}-{color_code}，"
            f"颜色 {_text(accepted.get('color_name'))}，模型 {','.join(routes)}"
        )
        return accepted

    system_prompt = (
        "你是鞋盒标签 OCR 审核员。只读取图片中实际印刷的标签文字，不根据鞋子外观猜颜色。"
        "只返回 JSON，不要 Markdown。"
    )
    user_prompt = (
        f"这是款号 {style_code}、色码 {color_code} 的鞋盒标签图。"
        "请逐字抄写产品名称和完整颜色名称。颜色名称必须以图片标签为准，并保留5位色码；"
        "不得概括、缩写、改写或用鞋子外观替换标签原文。"
        "例如标签写“梦幻粉60301”就必须返回“梦幻粉60301”，不能返回“粉色60301”。"
        '返回：{"style_code":"完整12位款号","product_name":"...","color_name":"...","color_code":"5位色码"}'
        "，并返回整张图中鞋盒白色标签和完整12位款号文字的归一化坐标。"
        "style_code_bbox 必须紧贴完整12位款号文本本身，不包含“产品货号/款号”等字段名；"
        "如果边界不确定，宁可略宽也不能漏掉任意一位数字。"
        '"label_bbox":[x1,y1,x2,y2],"style_code_bbox":[x1,y1,x2,y2]，'
        "坐标范围0到1000。"
    )

    def verify_label_with_local_cache(candidate: dict[str, Any]) -> dict[str, Any]:
        nonlocal local_label_evidence
        if local_label_evidence is not None:
            refined = dict(candidate)
            refined["label_bbox"] = local_label_evidence.get("label_bbox")
            refined["style_code_bbox"] = local_label_evidence.get("style_code_bbox")
            transcription = dict(local_label_evidence.get("transcription") or {})
            transcription["model_color_name"] = _text(candidate.get("color_name"))
            transcription["model_product_name"] = _text(candidate.get("product_name"))
            refined["_label_transcription"] = transcription
            return refined
        refined = _verify_label_payload_with_local_ocr(
            candidate,
            label_source_image=kwargs["label_source_image"],
            style_code=style_code,
            color_code=color_code,
        )
        transcription = dict(refined.get("_label_transcription") or {})
        if (
            _text(transcription.get("source"))
            == "local_tesseract_style_identity_ai_color_fallback"
        ):
            local_label_evidence = {
                "label_bbox": refined.get("label_bbox"),
                "style_code_bbox": refined.get("style_code_bbox"),
                "transcription": transcription,
            }
        return refined

    def refine_color_from_focused_label(
        candidate: dict[str, Any],
        *,
        current_model_id: str,
    ) -> dict[str, Any]:
        transcription = dict(candidate.get("_label_transcription") or {})
        if (
            _text(transcription.get("source"))
            != "local_tesseract_style_identity_ai_color_fallback"
        ):
            return candidate
        focused_input = _text(kwargs.get("label_image"))
        focused_inputs = [focused_input]
        source_text = _text(kwargs.get("label_source_image"))
        if source_text:
            source = Path(source_text)
            label_image_path = Path(focused_input)
            focused_target = label_image_path.with_name(
                f"{label_image_path.stem}-focused{label_image_path.suffix or '.jpg'}"
            )
            color_context_target = label_image_path.with_name(
                f"{label_image_path.stem}-color-context{label_image_path.suffix or '.jpg'}"
            )
            try:
                focused_input = str(
                    _create_focused_label_preview(
                        source,
                        focused_target,
                        candidate.get("label_bbox"),
                    )
                )
                color_context_input = str(
                    _create_focused_label_color_context_preview(
                        source,
                        color_context_target,
                        candidate.get("label_bbox"),
                    )
                )
                # A single native-detail color context is both more accurate
                # and materially faster than sending the overlapping full crop
                # plus context crop through the multimodal gateway.
                focused_inputs = [color_context_input]
            except Exception:
                logger.debug(
                    "Failed to create focused shoe-label preview %s",
                    source,
                    exc_info=True,
                )
        focused_prompt = (
            "这是裁切后的鞋盒标签左下区域。"
            "只逐字读取标签中‘颜色’字段冒号后的完整值，必须保留全部中文修饰词和5位色码；"
            "禁止根据鞋子外观概括，禁止省略任意中文修饰字；"
            "标签只有一个颜色值，禁止用斜杠、顿号或其他方式返回多个候选。"
            "不要根据提示词猜款色，也不要使用图片外的信息。"
            '返回：{"color_name":"图片中颜色字段的完整原文"}。'
        )
        try:
            focused_payload, focused_route = llm_gateway.generate_multimodal_json(
                system_prompt=system_prompt,
                user_prompt=focused_prompt,
                image_inputs=focused_inputs,
                model_id=current_model_id,
                fallback_model_ids=[],
                config=config,
                timeout_seconds=SHOE_LABEL_OCR_TIMEOUT_SECONDS,
                retry_same_model=False,
            )
        except llm_gateway.LlmGatewayError as exc:
            raise llm_gateway.LlmResponseError(
                f"鞋盒标签定向颜色 OCR 失败：{_text(exc)}"
            ) from exc
        if not isinstance(focused_payload, dict):
            raise llm_gateway.LlmResponseError("鞋盒标签定向颜色 OCR 未返回 JSON 对象")
        focused_code = _text(focused_payload.get("color_code"))
        focused_name = re.sub(r"\s+", "", _text(focused_payload.get("color_name")))
        expected_code = _text(color_code)
        color_codes_in_name = re.findall(r"\d{5}", focused_name)
        if (focused_code and focused_code != expected_code) or (
            color_codes_in_name and color_codes_in_name != [expected_code]
        ):
            raise llm_gateway.LlmResponseError(
                f"鞋盒标签定向颜色 OCR 色码不一致：{focused_name or focused_code or '空'}"
            )
        if not color_codes_in_name and focused_code != expected_code:
            raise llm_gateway.LlmResponseError(
                "鞋盒标签定向颜色 OCR 未返回可核验的5位色码"
            )
        if color_codes_in_name:
            if not focused_name.endswith(expected_code):
                raise llm_gateway.LlmResponseError(
                    f"鞋盒标签定向颜色 OCR 色码不一致：{focused_name}"
                )
            prefix = focused_name[: -len(expected_code)]
        else:
            prefix = focused_name
        joined_color = re.fullmatch(
            r"([\u3400-\u9fff])[/／、]([\u3400-\u9fff]{1,4}色)",
            prefix,
        )
        if joined_color:
            prefix = "".join(joined_color.groups())
        elif re.search(r"[/／、]", prefix):
            raise llm_gateway.LlmResponseError(
                f"鞋盒标签定向颜色 OCR 返回多个候选：{prefix}"
            )
        if not re.search(r"[\u3400-\u9fff]", prefix):
            raise llm_gateway.LlmResponseError("鞋盒标签定向颜色 OCR 未返回中文颜色名")
        # Some vision routes return the exact printed Chinese color in
        # ``color_name`` and put the 5-digit code only in ``color_code``.  The
        # two fields still form complete, internally consistent label evidence;
        # normalize them to the package naming contract instead of discarding a
        # correct independent vote.
        focused_name = f"{prefix}{expected_code}"
        refined = dict(candidate)
        refined["color_name"] = focused_name
        refined["_model_id"] = focused_route.model_id
        refined_transcription = dict(transcription)
        refined_transcription.update({
            "focused_model_color_name": focused_name,
            "color_name_source": "focused_label_ai_vote",
        })
        refined["_label_transcription"] = refined_transcription
        log(
            f"鞋盒标签定向颜色 OCR：{style_code}-{color_code}，"
            f"模型 {focused_route.model_id}，颜色 {focused_name}"
        )
        return refined

    for current_model_id in model_ids:
        last_error = ""
        for attempt in range(1, SHOE_LABEL_OCR_MODEL_MAX_ATTEMPTS + 1):
            _notify_shoe_model_progress(
                progress,
                (
                    f"鞋盒标签 OCR {current_model_id} "
                    f"第{attempt}/{SHOE_LABEL_OCR_MODEL_MAX_ATTEMPTS}次"
                ),
                style_code=style_code,
                color_code=color_code,
            )
            log(
                f"鞋盒标签 OCR 模型尝试：{style_code}-{color_code}，"
                f"模型 {current_model_id}，第 {attempt}/{SHOE_LABEL_OCR_MODEL_MAX_ATTEMPTS} 次"
            )
            try:
                if focused_seed_candidate is not None:
                    # The first successful full-label pass plus local OCR has
                    # already established the exact style identity and crop.
                    # Independent fallback routes only need to vote on that
                    # same focused color field; repeating full-label OCR here
                    # doubles latency and creates another opportunity to time
                    # out before the useful targeted vote.
                    payload = dict(focused_seed_candidate)
                    route = type(
                        "FocusedLabelRoute",
                        (),
                        {"model_id": current_model_id},
                    )()
                else:
                    payload, route = llm_gateway.generate_multimodal_json(
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        image_inputs=[kwargs["label_image"]],
                        model_id=current_model_id,
                        fallback_model_ids=[],
                        config=config,
                        timeout_seconds=SHOE_LABEL_OCR_TIMEOUT_SECONDS,
                        retry_same_model=False,
                    )
                    _validate_label_ocr_payload(
                        payload,
                        style_code=style_code,
                        color_code=color_code,
                    )
                    payload["_model_id"] = route.model_id
                    if _text(kwargs.get("label_source_image")):
                        payload = verify_label_with_local_cache(payload)
                    if local_label_evidence is not None:
                        focused_seed_candidate = dict(payload)
                payload = refine_color_from_focused_label(
                    payload,
                    current_model_id=current_model_id,
                )
            except llm_gateway.LlmGatewayError as exc:
                last_error = _text(exc)
                log(
                    f"[warn] 鞋盒标签 OCR 模型失败：{style_code}-{color_code}，"
                    f"模型 {current_model_id}，第 {attempt}/{SHOE_LABEL_OCR_MODEL_MAX_ATTEMPTS} 次："
                    f"{last_error}"
                )
                if isinstance(exc, llm_gateway.LlmConfigurationError):
                    break
                if isinstance(exc, llm_gateway.LlmResponseError):
                    break
                if _is_timeout_like_llm_error(exc):
                    log(
                        f"[warn] 鞋盒标签 OCR 模型 60 秒超时，"
                        f"直接切换独立 fallback：{style_code}-{color_code}，"
                        f"模型 {current_model_id}"
                    )
                    break
                continue
            if not isinstance(payload, dict):
                last_error = "鞋盒标签 OCR 未返回 JSON 对象"
                log(
                    f"[warn] 鞋盒标签 OCR 模型失败：{style_code}-{color_code}，"
                    f"模型 {current_model_id} 返回非对象结果"
                )
                continue
            payload["_model_id"] = route.model_id
            if errors:
                payload["_model_attempt_warnings"] = "；".join(errors[:5])
            accepted_payload = accept_label_payload(payload)
            if accepted_payload is not None:
                return accepted_payload
            last_error = "AI 颜色尚未获得两个跨模型家族同票"
            break
        errors.append(f"{current_model_id}: {last_error or '未返回可用结果'}")

    raise ShoeSelectionError(
        f"{style_code}-{color_code} 鞋盒标签 OCR 多模型均失败："
        + "；".join(errors[:8])
    )


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
    for metadata_key in (
        "_consensus_routes",
        "_model_votes",
        "_model_votes_by_batch",
        "_consensus_issues",
        "_targeted_slot_consensus",
        "_candidate_facts_by_model",
        "_label_wpz6_resolution",
        "_label_color_name",
        "_label_model_id",
        "_label_transcription",
        "_ruleset",
    ):
        if metadata_key in payload:
            resolved[metadata_key] = payload.get(metadata_key)
    for key, value in slots.items():
        if isinstance(value, list):
            resolved[key] = [
                _resolve_candidate_value(item, candidate_ids)
                for item in value
            ]
        else:
            resolved[key] = _resolve_candidate_value(value, candidate_ids)
    return color_name, category, resolved


def _write_selection_evidence(
    *,
    analysis_root: Path,
    style_code: str,
    color_code: str,
    color_name: str,
    category: str,
    model_category: str,
    model_id: str,
    selection: dict[str, Any],
) -> Path:
    evidence_keys = (
        "_model_votes",
        "_model_votes_by_batch",
        "_consensus_issues",
        "_targeted_slot_consensus",
        "_candidate_facts_by_model",
        "_ruleset",
    )
    resolved_slots = {
        key: value
        for key, value in selection.items()
        if not key.startswith("_")
        and key
        not in {
            "label_bbox",
            "style_code_bbox",
        }
    }
    evidence = {
        "style_code": style_code,
        "color_code": color_code,
        "color_name": color_name,
        "category": category,
        "model_category": model_category,
        "model_id": _text(selection.get("_model_id")) or model_id,
        "ruleset": selection.get("_ruleset"),
        "resolved_slots": resolved_slots,
        "selection_evidence": {
            key: selection.get(key)
            for key in evidence_keys
            if key in selection
        },
    }
    target = analysis_root / style_code / f"{color_code}-selection-evidence.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return target


def _write_pose_analysis_evidence(
    *,
    target: Path | str,
    style_code: str,
    color_code: str,
    pose_strategy: str,
    candidate_ids: dict[str, str],
    batch_inputs: list[dict[str, Any]],
    payloads_by_batch: dict[int, list[dict[str, Any]]],
    shoe_category: str,
    required_votes: int,
    errors: list[str],
    status: str,
    focused_consensus: dict[str, Any] | None = None,
) -> None:
    target_path = Path(target)
    route_evidence: list[dict[str, Any]] = []
    consensus_by_batch: list[dict[str, Any]] = []
    for batch_input in batch_inputs:
        batch_index = int(batch_input.get("batch_index") or 0)
        batch_candidate_ids = batch_input.get("candidate_ids") or {}
        batch_payloads = payloads_by_batch.get(batch_index, [])
        for payload in batch_payloads:
            route = _text(payload.get("_model_id"))
            if not route:
                continue
            normalized = shenhui_shoe_rules.slot_payload_from_candidate_facts(
                payload,
                batch_candidate_ids,
                shoe_category=shoe_category,
            )
            route_evidence.append({
                "batch_index": batch_index,
                "model_id": route,
                "candidate_facts": list(normalized.get("_candidate_facts") or []),
                "slot_decisions": list(normalized.get("_slot_decisions") or []),
            })
        if batch_payloads:
            consensus = _consensus_pose_payload(
                batch_payloads,
                batch_candidate_ids,
                shoe_category,
                required_votes=required_votes,
            )
            consensus_by_batch.append({
                "batch_index": batch_index,
                "model_votes": consensus.get("_model_votes") or {},
                "consensus_issues": consensus.get("_consensus_issues") or [],
            })

    evidence = {
        "style_code": style_code,
        "color_code": color_code,
        "pose_strategy": pose_strategy,
        "status": status,
        "candidate_ids": dict(candidate_ids),
        "route_evidence": route_evidence,
        "consensus_by_batch": consensus_by_batch,
        "focused_consensus": focused_consensus or {},
        "errors": list(errors),
    }
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _semantic_vote_slot(slot: str, category: str) -> str:
    slot = _text(slot).lower()
    if re.fullmatch(r"wpz[1-4]", slot):
        return f"tmz{slot[-1]}"
    if slot == "o":
        return "tmz2" if _text(category) == "运动" else "tmz1"
    if slot == "tms":
        return "tmz5"
    return slot


def _semantic_report_fields(
    selection: dict[str, Any],
    *,
    slot: str,
    source_name: str,
) -> dict[str, str]:
    vote_slot = _semantic_vote_slot(slot, _text(selection.get("shoe_category")))
    source_family = _copy_variant_key(source_name)
    vote_candidates: list[dict[str, Any]] = []
    direct_votes = selection.get("_model_votes")
    if isinstance(direct_votes, dict) and isinstance(direct_votes.get(vote_slot), dict):
        vote_candidates.append(direct_votes[vote_slot])
    for batch_votes in selection.get("_model_votes_by_batch") or []:
        if isinstance(batch_votes, dict) and isinstance(batch_votes.get(vote_slot), dict):
            vote_candidates.append(batch_votes[vote_slot])
    vote = next(
        (
            item
            for item in vote_candidates
            if _text(item.get("status")) == "locked"
            and _text(item.get("selected_family")) == source_family
        ),
        None,
    )
    if vote is None:
        return {}

    voting_models = list(dict.fromkeys(
        _text(model_id)
        for model_id in (vote.get("models") or [])
        if _text(model_id)
    ))
    model_facts: list[dict[str, Any]] = []
    for model_id in voting_models:
        matching_facts = [
            fact
            for model_evidence in (
                selection.get("_candidate_facts_by_model") or []
            )
            if isinstance(model_evidence, dict)
            and _text(model_evidence.get("model_id")) == model_id
            for fact in (model_evidence.get("candidate_facts") or [])
            if isinstance(fact, dict)
            and _copy_variant_key(_text(fact.get("filename"))) == source_family
        ]
        supporting_fact = None
        for fact in matching_facts:
            candidate_id = _text(fact.get("candidate_id"))
            parsed_facts = shenhui_shoe_rules.parse_candidate_facts(
                {"candidates": [fact]},
                ({candidate_id: _text(fact.get("filename"))} if candidate_id else {}),
            )
            if parsed_facts and shenhui_shoe_rules.candidate_is_valid_for_slot(
                parsed_facts[0],
                vote_slot,
                _text(selection.get("shoe_category")),
            )[0]:
                supporting_fact = fact
                break
        if supporting_fact is None and matching_facts:
            supporting_fact = matching_facts[0]
        if supporting_fact is not None:
            model_facts.append({"model_id": model_id, "fact": supporting_fact})

    return {
        "语义属性": json.dumps(
            {"slot": vote_slot, "models": model_facts},
            ensure_ascii=False,
            sort_keys=True,
        ),
        "模型共识": json.dumps(vote, ensure_ascii=False, sort_keys=True),
    }


def _natural_slot_index(filename: str, prefix: str) -> tuple[int, str]:
    match = re.search(
        rf"^{re.escape(prefix)}\s*(?:[\(（]\s*)?(\d+)",
        Path(filename).stem,
        flags=re.IGNORECASE,
    )
    return (int(match.group(1)) if match else 9999, filename.lower())


def _apply_o_category_rule(category: str, slots: dict[str, Any]) -> dict[str, Any]:
    ruled = dict(slots)
    category_text = _text(category)
    wpz_by_index = dict(_selection_indexed(ruled, "wpz", 6))
    if category_text == "运动":
        ruled["o"] = _text(ruled.get("tmz2")) or wpz_by_index.get(2, "")
    elif category_text in {"雪地", "婴童", "休闲"}:
        ruled["o"] = _text(ruled.get("tmz1")) or wpz_by_index.get(1, "")
    return ruled


def _sync_wpz_main_slots(slots: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    ruled = dict(slots)
    wpz = _selection_array(slots, "wpz", 6)
    corrections: list[str] = []
    for index in range(1, 5):
        tmz_key = f"tmz{index}"
        tmz_value = _text(ruled.get(tmz_key))
        wpz_value = _text(wpz[index - 1])
        if tmz_value and wpz_value != tmz_value:
            wpz[index - 1] = tmz_value
            corrections.append(
                f"wpz{index} 已按 {tmz_key} 同步：{wpz_value or '空'} -> {tmz_value}"
            )
        elif not tmz_value and wpz_value:
            ruled[tmz_key] = wpz_value
            corrections.append(
                f"{tmz_key} 已按 wpz{index} 补齐：空 -> {wpz_value}"
            )
    ruled["wpz"] = wpz
    yq = _selection_array(slots, "yq", 3)
    ruled["yq"] = yq
    return ruled, corrections


def _label_ocr_candidate_sources_for_wpz6(
    *,
    selection: dict[str, Any],
    candidate_ids: dict[str, str],
    entries_by_name: dict[str, dict[str, Any]],
    style_code: str,
    color_code: str,
) -> list[dict[str, Any]]:
    """Rank consensus-backed shoe-box sources and exclude the exact tms image."""

    candidates: dict[str, dict[str, Any]] = {}

    def candidate_for(source: Any) -> dict[str, Any] | None:
        source_name = candidate_ids.get(_text(source), _text(source))
        if not source_name or source_name not in entries_by_name:
            return None
        if _is_tms_source_filename(source_name, style_code, color_code):
            return None
        if source_name in candidates:
            return candidates[source_name]
        feature = _entry_feature(entries_by_name[source_name])
        foreground_coverage = (
            feature.bounding_coverage
            if feature is not None and feature.valid
            else None
        )
        box_view_rank = 1
        if foreground_coverage is not None:
            box_view_rank = 0 if foreground_coverage < 0.90 else 2
        return candidates.setdefault(source_name, {
            "filename": source_name,
            "box_fact_models": set(),
            "plain_shoe_fact_models": set(),
            "vote_models": set(),
            "vote": None,
            "current": False,
            "box_view_rank": box_view_rank,
            "foreground_coverage": foreground_coverage,
        })

    current_wpz6 = dict(_selection_indexed(selection, "wpz", 6)).get(6, "")
    current_candidate = candidate_for(current_wpz6)
    if current_candidate is not None:
        current_candidate["current"] = True
    has_consensus_evidence = bool(
        selection.get("_model_votes")
        or selection.get("_model_votes_by_batch")
        or selection.get("_candidate_facts_by_model")
    )

    vote_sets: list[dict[str, Any]] = []
    direct_votes = selection.get("_model_votes")
    if isinstance(direct_votes, dict):
        vote_sets.append(direct_votes)
    vote_sets.extend(
        votes
        for votes in (selection.get("_model_votes_by_batch") or [])
        if isinstance(votes, dict)
    )
    for votes in vote_sets:
        vote = votes.get("wpz6")
        if not isinstance(vote, dict) or _text(vote.get("status")) != "locked":
            continue
        item = candidate_for(vote.get("selected"))
        if item is None:
            continue
        item["vote_models"].update(
            _text(model_id)
            for model_id in (vote.get("models") or [])
            if _text(model_id)
        )
        existing_vote = item.get("vote")
        if not isinstance(existing_vote, dict) or int(vote.get("votes") or 0) > int(
            existing_vote.get("votes") or 0
        ):
            item["vote"] = dict(vote)

    for model_evidence in selection.get("_candidate_facts_by_model") or []:
        if not isinstance(model_evidence, dict):
            continue
        model_id = _text(model_evidence.get("model_id"))
        for fact in model_evidence.get("candidate_facts") or []:
            if not isinstance(fact, dict):
                continue
            item = candidate_for(fact.get("filename") or fact.get("candidate_id"))
            if item is None:
                continue
            asset_type = _text(fact.get("asset_type")).lower()
            matched_slots = {
                shenhui_shoe_rules.normalize_slot_name(slot)
                for slot in (fact.get("matched_slots") or [])
            }
            is_box = any(
                token in asset_type
                for token in ("shoe_box", "box", "label", "鞋盒", "标签")
            )
            if is_box and ("wpz6" in matched_slots or _text(fact.get("pose")) == "wpz6"):
                if model_id:
                    item["box_fact_models"].add(model_id)
            elif asset_type in {"shoe", "footwear", "鞋", "鞋子", "shoe_with_card"}:
                if model_id:
                    item["plain_shoe_fact_models"].add(model_id)

    if has_consensus_evidence:
        ranked = [
            item
            for item in candidates.values()
            if item["box_fact_models"]
        ]
    else:
        ranked = [
            item
            for item in candidates.values()
            if item["vote_models"] or item["current"]
        ]
    ranked.sort(key=lambda item: (
        not bool(item["box_fact_models"]),
        item["box_view_rank"],
        -len(item["vote_models"]),
        -len(item["box_fact_models"]),
        bool(item["plain_shoe_fact_models"]),
        not bool(item["current"]),
        _text(item["filename"]).lower(),
    ))
    return [
        {
            **item,
            "box_fact_models": sorted(item["box_fact_models"]),
            "plain_shoe_fact_models": sorted(item["plain_shoe_fact_models"]),
            "vote_models": sorted(item["vote_models"]),
        }
        for item in ranked
    ]


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
    _save_wpt_original_png(source, outputs["wpt30"])
    _save_transparent_canvas_png(source, outputs["jdt_png"])
    return outputs


def _save_transparent_canvas_png(
    source: Path | str,
    target: Path | str,
    *,
    canvas_size: int = SHOE_CHANNEL_CANVAS_SIZE,
) -> Path:
    from PIL import Image, ImageOps

    source = Path(source)
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", Image.DecompressionBombWarning)
        with Image.open(source) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGBA")
    image.thumbnail((canvas_size, canvas_size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    left = (canvas_size - image.width) // 2
    top = (canvas_size - image.height) // 2
    canvas.alpha_composite(image, (left, top))
    canvas.save(target, format="PNG", optimize=True, compress_level=9)
    return target


def _save_wpt_original_png(
    source: Path | str,
    target: Path | str,
    *,
    max_bytes: int = SHOE_WPT_MAX_BYTES,
) -> Path:
    from PIL import Image, ImageOps

    source = Path(source)
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", Image.DecompressionBombWarning)
        with Image.open(source) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGBA")
    image.save(target, format="PNG", optimize=True, compress_level=9)
    if target.stat().st_size <= max_bytes:
        return target

    for colors in (256, 192, 128, 96, 64, 48, 32, 24, 16, 12, 8):
        try:
            quantized = image.quantize(colors=colors, method=Image.Quantize.FASTOCTREE)
            quantized.save(target, format="PNG", optimize=True, compress_level=9)
            if target.stat().st_size <= max_bytes:
                return target
        except Exception:
            logger.debug(
                "Failed to quantize wpt image %s with %s colors",
                source,
                colors,
                exc_info=True,
            )

    return target


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
    try:
        exact_style = ocr_service.locate_exact_style_code_bbox(
            source,
            style_code=style_code,
            label_bbox=label,
        )
    except Exception:
        exact_style = None
        logger.debug(
            "Failed to locate exact local style-code bbox for tmq %s",
            source,
            exc_info=True,
        )
    if exact_style is not None:
        style = exact_style
    else:
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
    canvas_size = SHOE_TMQ_CANVAS_SIZE
    crop = image.crop((round(left), round(top), round(left + side), round(top + side)))
    crop = crop.resize((canvas_size, canvas_size), Image.Resampling.LANCZOS)

    label_x1, label_y1, label_x2, label_y2 = label
    fallback_style = (
        label_x1 + (label_x2 - label_x1) * 0.24,
        label_y1 + (label_y2 - label_y1) * 0.00,
        label_x1 + (label_x2 - label_x1) * 0.90,
        label_y1 + (label_y2 - label_y1) * 0.22,
    )
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
            expanded_x1 = max(label_x1, center - half_width)
            expanded_x2 = min(label_x2, center + half_width)
            if expanded_x2 > expanded_x1:
                style = (expanded_x1, style[1], expanded_x2, style[3])
            else:
                # A model can return a valid style bbox that is nevertheless
                # outside its recovered/expanded label bbox. Avoid passing an
                # inverted rectangle to Pillow; use the established top-row
                # label geometry and let the downstream OCR/red-box validator
                # fail closed if that geometry does not contain the style.
                style = fallback_style
    else:
        style = fallback_style
    draw = ImageDraw.Draw(crop)
    scale = canvas_size / side
    style_height_on_crop = max(1.0, (style[3] - style[1]) * height * scale)
    pad_left = max(3, round(style_height_on_crop * 0.22))
    pad_right = max(4, round(style_height_on_crop * 0.32))
    pad_y = max(3, round(style_height_on_crop * 0.30))
    rectangle = (
        max(0, round((style[0] * width - left) * scale) - pad_left),
        max(0, round((style[1] * height - top) * scale) - pad_y),
        min(canvas_size, round((style[2] * width - left) * scale) + pad_right),
        min(canvas_size, round((style[3] * height - top) * scale) + pad_y),
    )
    if rectangle[2] <= rectangle[0] or rectangle[3] <= rectangle[1]:
        style = fallback_style
        rectangle = (
            max(0, round((style[0] * width - left) * scale) - pad_left),
            max(0, round((style[1] * height - top) * scale) - pad_y),
            min(canvas_size, round((style[2] * width - left) * scale) + pad_right),
            min(canvas_size, round((style[3] * height - top) * scale) + pad_y),
        )
    if rectangle[2] <= rectangle[0] or rectangle[3] <= rectangle[1]:
        raise ShoeSelectionError("鞋盒标签款号坐标位于裁切区域外，无法生成 tmq.jpg")
    draw.rectangle(rectangle, outline=(255, 0, 0), width=3)
    target.parent.mkdir(parents=True, exist_ok=True)
    crop.save(target, format="JPEG", quality=95, optimize=True)
    return target


def _validate_selection_sources(
    style_code: str,
    color_name: str,
    slots: dict[str, Any],
    entries_by_name: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    sanitized = dict(slots)
    warnings: list[dict[str, str]] = []
    for key, value in slots.items():
        if str(key).startswith("_"):
            continue
        if isinstance(value, list):
            cleaned: list[str] = []
            for index, filename in enumerate(value, start=1):
                filename_text = _text(filename)
                if not filename_text:
                    cleaned.append("")
                    continue
                if filename_text in entries_by_name:
                    cleaned.append(filename_text)
                    continue
                cleaned.append("")
                slot = f"{key}{index}" if key in {"wpz", "yq", "yk"} else str(key)
                warnings.append(_slot_warning(
                    color=color_name,
                    slot=slot,
                    warning=(
                        f"{style_code} {color_name} 识别结果引用了不存在的候选图 "
                        f"{filename_text}，已跳过该槽位"
                    ),
                ))
            sanitized[key] = cleaned
            continue
        filename_text = _text(value)
        if filename_text and filename_text not in entries_by_name:
            sanitized[key] = ""
            warnings.append(_slot_warning(
                color=color_name,
                slot=str(key),
                warning=(
                    f"{style_code} {color_name} 识别结果引用了不存在的候选图 "
                    f"{filename_text}，已跳过该槽位"
                ),
            ))
    return sanitized, warnings


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


def _skipped_slot_report_row(
    *,
    style_code: str,
    color: str,
    slot: str,
    warning: str,
    output_path: str = "",
    source_name: str = "",
    cloud_path: str = "",
    category_source: str = "",
    action: str = "缺少源图已跳过",
    download_result: str = "未找到",
    remarks: str = "",
) -> dict[str, Any]:
    return {
        "输入款号": style_code,
        "颜色": color,
        "原文件名": source_name,
        "云盘路径": cloud_path,
        "规则槽位": slot,
        "输出文件名": output_path,
        "处理动作": action,
        "下载结果": download_result,
        "本地文件": "",
        "规则告警": warning,
        "品类来源": category_source,
        "备注": remarks,
    }


def prepare_shoe_packages(
    *,
    data_rows: list[dict[str, Any]],
    output_root: Path | str,
    model_id: str = SHOE_POSE_DEFAULT_MODEL,
    pose_strategy: str = SHOE_POSE_DEFAULT_STRATEGY,
    label_model_id: str = "",
    fallback_model_ids: Any = None,
    label_fallback_model_ids: Any = None,
    shoe_categories: dict[str, str] | None = None,
    config: dict | None = None,
    analyze_color=None,
    analyze_color_label=None,
    reference_image: Path | str = SHOE_REFERENCE_IMAGE,
    poster_reference_image: Path | str = SHOE_POSTER_REFERENCE_IMAGE,
    pose1_reference_image: Path | str = SHOE_POSE1_REFERENCE_IMAGE,
    yq_reference_image: Path | str = SHOE_YQ_REFERENCE_IMAGE,
    log=lambda _message: None,
    progress=None,
    preserve_analysis_artifacts: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, Path]]:
    """Analyze downloaded shoe images, copy selected slots, and build report rows."""

    output_root = Path(output_root)
    pose_strategy = normalize_shoe_pose_strategy(pose_strategy)
    reference_image = Path(reference_image)
    poster_reference_image = Path(poster_reference_image)
    yq_reference_image = Path(yq_reference_image)
    if not reference_image.is_file():
        raise ShoeSelectionError(f"鞋品主图参考模板不存在：{reference_image}")
    if not poster_reference_image.is_file():
        raise ShoeSelectionError(f"鞋品海报参考模板不存在：{poster_reference_image}")
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
    model_input_root = analysis_root / "_model_inputs"
    reference_image_for_model = _create_model_input_preview(
        reference_image,
        model_input_root / "main-template.jpg",
    )
    main_pose_references_by_category = _create_main_pose_reference_cells(
        reference_image,
        model_input_root / "main-pose-cells",
    )
    main_pose_reference_sheets_by_category = {
        category: _create_main_pose_reference_sheet(
            references,
            model_input_root / "main-pose-sheets" / f"{SHOE_MAIN_TEMPLATE_CATEGORY_SLUGS[category]}-tmz.jpg",
        )
        for category, references in main_pose_references_by_category.items()
    }
    poster_reference_image_for_model = _create_model_input_preview(
        poster_reference_image,
        model_input_root / "poster-template.jpg",
    )
    yq_reference_image_for_model = _create_model_input_preview(
        yq_reference_image,
        model_input_root / "yq-template.jpg",
    )
    yq_reference_cells = _create_yq_reference_cells(
        yq_reference_image,
        model_input_root / "yq-pose-cells",
    )

    for style_code, colors in grouped.items():
        forced_category = (shoe_categories or {}).get(style_code, "")
        selections_by_color: dict[str, dict[str, Any]] = {}
        entries_by_color_name: dict[str, dict[str, dict[str, Any]]] = {}
        original_entries_by_color_name: dict[str, list[dict[str, Any]]] = {}
        color_order: list[str] = []
        selection_warnings: list[dict[str, str]] = []
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
                reason = f"{style_code}-{color_code} 没有可用于鞋品姿势识别的候选图片"
                log(f"[warn] {reason}，已跳过该款色")
                report_rows.append(_skipped_slot_report_row(
                    style_code=style_code,
                    color=color_code,
                    slot="款色",
                    warning=f"{reason}，不影响同款其他色",
                    action="失败款色跳过",
                    download_result="已跳过",
                    remarks=reason,
                ))
                organize_completed += 1
                report_progress(
                    "款色跳过",
                    style_code=style_code,
                    color_code=color_code,
                )
                continue
            candidate_ids: dict[str, str] = {}
            # A geometry-only cross-colour transfer has no independent semantic
            # votes for the target colour. Keep it only for explicitly supplied
            # legacy/custom analyzers; the production analyzer audits every colour.
            used_local_match = anchor_slots is not None and analyze_color is not None
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
                effective_pose_strategy = pose_strategy
                if effective_pose_strategy == SHOE_POSE_STRATEGY_GLOBAL_PAGES:
                    global_limit = SHOE_GLOBAL_PAGE_CHUNK_SIZE * SHOE_GLOBAL_PAGE_MAX_PAGES
                    if len(selection_entries) > global_limit:
                        before_count = len(selection_entries)
                        selection_entries = _deduplicate_exact_image_entries(selection_entries)
                        log(
                            f"鞋品全局分页候选去重：{style_code}-{color_code}，"
                            f"{before_count} -> {len(selection_entries)} 张"
                        )
                    if len(selection_entries) > global_limit:
                        effective_pose_strategy = SHOE_POSE_STRATEGY_BATCH_OVERVIEW
                        log(
                            f"[warn] 鞋品全局分页候选超过 {global_limit} 张："
                            f"{style_code}-{color_code}，已自动降级为 batch_overview"
                        )
                contact_sheets, candidate_ids, overview_contact_sheet = _create_pose_contact_inputs(
                    selection_entries,
                    contact_sheet,
                    pose_strategy=effective_pose_strategy,
                )
                log(
                    f"鞋品姿势识别：{style_code}-{color_code}，"
                    f"候选图 {len(selection_entries)} 张，策略 {effective_pose_strategy}"
                )
                payload = analyzer(
                    style_code=style_code,
                    color_code=color_code,
                    contact_sheet=str(contact_sheets[0]),
                    contact_sheets=[str(path) for path in contact_sheets],
                    overview_contact_sheet=(
                        str(overview_contact_sheet) if overview_contact_sheet else ""
                    ),
                    pose_strategy=effective_pose_strategy,
                    reference_image=str(reference_image_for_model),
                    main_pose_reference_images=[
                        str(path)
                        for path in main_pose_references_by_category.get(
                            forced_category,
                            [],
                        )
                    ],
                    main_pose_reference_sheet=str(
                        main_pose_reference_sheets_by_category.get(forced_category)
                        or reference_image_for_model
                    ),
                    poster_reference_image=str(poster_reference_image_for_model),
                    yq_reference_image=str(yq_reference_image_for_model),
                    yq_reference_images={
                        slot: str(path)
                        for slot, path in yq_reference_cells.items()
                    },
                    candidate_ids=candidate_ids,
                    candidate_names=[
                        entry["filename"]
                        for entry in selection_entries
                    ],
                    candidate_entries=[
                        {
                            "filename": entry["filename"],
                            "path": entry["path"],
                        }
                        for entry in selection_entries
                    ],
                    shoe_category=forced_category,
                    model_id=model_id,
                    fallback_model_ids=fallback_model_ids,
                    config=config,
                    log=log,
                    progress=report_progress,
                    pose_evidence_path=(
                        str(analysis_root / style_code / f"{color_code}-pose-evidence.json")
                        if preserve_analysis_artifacts
                        else ""
                    ),
                )
            if not isinstance(payload, dict):
                raise ShoeSelectionError(f"{style_code}-{color_code} 识别结果不是对象")
            try:
                color_name, model_category, slots = _resolve_selection_payload(payload, candidate_ids)
            except ShoeSelectionError as exc:
                raise ShoeSelectionError(f"{style_code}-{color_code} {exc}") from exc
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
                    if _is_tms_source_filename(filename, style_code, color_code)
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
            slots, quality_corrections = _apply_post_selection_quality_rules(
                category,
                slots,
                pose_entries_by_name,
                outsole_entries_by_name=outsole_entries_by_name,
            )
            for correction in quality_corrections:
                log(f"鞋品确定性校验：{style_code}-{color_code}，{correction}")
            slots, wpz_sync_corrections = _sync_wpz_main_slots(slots)
            for correction in wpz_sync_corrections:
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

            tmz5_source = _text(slots.get("tmz5"))
            if tmz5_source:
                slots["tms"] = tmz5_source

            slots, current_selection_warnings = _validate_selection_sources(
                style_code,
                color_name,
                slots,
                entries_by_name,
            )
            selection_warnings.extend(current_selection_warnings)
            if anchor_slots is None:
                anchor_slots = dict(slots)
                anchor_selection_entries = list(quality_rule_entries)
                anchor_category = category
            if label_analyzer:
                label_candidates = _label_ocr_candidate_sources_for_wpz6(
                    selection=slots,
                    candidate_ids=candidate_ids,
                    entries_by_name=entries_by_name,
                    style_code=style_code,
                    color_code=color_code,
                )
                if not label_candidates:
                    raise ShoeSelectionError(
                        f"{style_code}-{color_code} 缺少共识支持的 wpz6 鞋盒标签图，"
                        "无法验证款色命名和生成 tmq.jpg"
                    )
                label_image = analysis_root / style_code / f"{color_code}-label.jpg"
                label_payload: dict[str, Any] | None = None
                box_source_name = ""
                selected_label_candidate: dict[str, Any] | None = None
                label_candidate_errors: list[str] = []
                for label_candidate in label_candidates:
                    candidate_name = _text(label_candidate.get("filename"))
                    box_source = entries_by_name.get(candidate_name)
                    if not box_source:
                        continue
                    _create_label_preview(Path(box_source["path"]), label_image)
                    log(
                        f"鞋盒标签 OCR：{style_code}-{color_code}，"
                        f"候选 {candidate_name}"
                    )
                    try:
                        current_label_payload = label_analyzer(
                            style_code=style_code,
                            color_code=color_code,
                            label_image=str(label_image),
                            label_source_image=str(box_source["path"]),
                            model_id=model_id,
                            label_model_id=label_model_id,
                            fallback_model_ids=fallback_model_ids,
                            label_fallback_model_ids=(
                                label_fallback_model_ids or fallback_model_ids
                            ),
                            config=config,
                            log=log,
                            progress=report_progress,
                        )
                        if not isinstance(current_label_payload, dict):
                            raise llm_gateway.LlmResponseError(
                                "鞋盒标签 OCR 结果不是对象"
                            )
                        _validate_label_ocr_payload(
                            current_label_payload,
                            style_code=style_code,
                            color_code=color_code,
                        )
                        resolved_color_name, label_warning = _resolve_label_color_name(
                            current_color_name=color_name,
                            color_code=color_code,
                            label_payload=current_label_payload,
                        )
                        if label_warning:
                            raise llm_gateway.LlmResponseError(label_warning)
                    except (ShoeSelectionError, llm_gateway.LlmGatewayError) as exc:
                        label_candidate_errors.append(
                            f"{candidate_name}: {_text(exc)}"
                        )
                        log(
                            f"[warn] 鞋盒标签 OCR 候选未通过："
                            f"{style_code}-{color_code}，{candidate_name}：{_text(exc)}"
                        )
                        continue
                    label_payload = current_label_payload
                    color_name = resolved_color_name
                    box_source_name = candidate_name
                    selected_label_candidate = label_candidate
                    break
                if label_payload is None or not box_source_name:
                    raise ShoeSelectionError(
                        f"{style_code}-{color_code} 鞋盒标签 OCR 所有共识候选均未通过："
                        + "；".join(label_candidate_errors[:6])
                    )
                wpz = _selection_array(slots, "wpz", 6)
                previous_wpz6 = wpz[5]
                wpz[5] = box_source_name
                slots["wpz"] = wpz
                if previous_wpz6 != box_source_name:
                    log(
                        f"鞋盒标签 OCR 已纠正 wpz6：{style_code}-{color_code}，"
                        f"{previous_wpz6 or '空'} -> {box_source_name}"
                    )
                if selected_label_candidate and isinstance(
                    selected_label_candidate.get("vote"),
                    dict,
                ):
                    model_votes = dict(slots.get("_model_votes") or {})
                    model_votes["wpz6"] = dict(selected_label_candidate["vote"])
                    slots["_model_votes"] = model_votes
                slots["_label_wpz6_resolution"] = {
                    "selected": box_source_name,
                    "previous": previous_wpz6,
                    "candidates": [
                        {
                            "filename": item.get("filename"),
                            "box_fact_models": item.get("box_fact_models") or [],
                            "vote_models": item.get("vote_models") or [],
                        }
                        for item in label_candidates
                    ],
                }
                slots["product_name"] = _text(label_payload.get("product_name"))
                slots["label_bbox"] = label_payload.get("label_bbox")
                slots["style_code_bbox"] = label_payload.get("style_code_bbox")
                slots["_label_verified"] = True
                slots["_label_color_name"] = color_name
                slots["_label_model_id"] = _text(label_payload.get("_model_id"))
                slots["_label_transcription"] = dict(
                    label_payload.get("_label_transcription") or {}
                )

            slots["shoe_category"] = category
            slots["shoe_category_source"] = category_source
            if preserve_analysis_artifacts:
                _write_selection_evidence(
                    analysis_root=analysis_root,
                    style_code=style_code,
                    color_code=color_code,
                    color_name=color_name,
                    category=category,
                    model_category=model_category,
                    model_id=model_id,
                    selection=slots,
                )
            selections_by_color[color_name] = slots
            entries_by_color_name[color_name] = entries_by_name
            original_entries_by_color_name[color_name] = entries
            color_order.append(color_name)
            log(
                f"鞋品姿势识别完成：{style_code}-{color_name}，"
                f"品类 {category or '未返回'}（{category_source}），"
                f"模型 {slots.get('_model_id') or model_id}"
            )
            organize_completed += 1
            report_progress(
                "款色识别完成",
                style_code=style_code,
                color_code=color_name,
            )

        if not selections_by_color:
            reason = f"{style_code} 没有可继续整理的款色，已跳过该款"
            log(f"[warn] {reason}")
            report_rows.append(_skipped_style_report_row(style_code, reason))
            continue

        output_color_order = _promoted_color_first(selections_by_color, color_order)
        assignments, warnings = build_output_assignments(
            selections_by_color,
            output_color_order,
        )
        warnings.extend(selection_warnings)
        warnings.extend(
            {
                "color": color_name,
                "slot": "鞋盒OCR",
                "warning": _text(slots.get("_label_warning")),
                "action": "已本地框选",
                "download_result": "已完成",
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
            entry = entries_by_color_name.get(color_name, {}).get(source_name)
            if not entry:
                report_rows.append(_skipped_slot_report_row(
                    style_code=style_code,
                    color=color_name,
                    slot=assignment["slot"],
                    source_name=source_name,
                    output_path=assignment["output_path"],
                    warning=(
                        f"{color_name} 源图 {source_name} 未下载或不存在，"
                        f"已跳过 {assignment['output_path']}"
                    ),
                    category_source=(
                        selections_by_color.get(color_name, {}).get("shoe_category_source")
                        or ""
                    ),
                ))
                continue
            target = package_root / assignment["output_path"]
            selected_category = _text(
                selections_by_color[color_name].get("shoe_category")
            )
            background_rgb = (
                (255, 255, 255)
                if assignment["slot"] == "tms"
                else
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
                "鞋盒命名已验证": (
                    "是" if selections_by_color[color_name].get("_label_verified") else "否"
                ),
                "鞋盒款色名": _text(
                    selections_by_color[color_name].get("_label_color_name")
                ),
                "备注": (
                    f"品类：{selections_by_color[color_name].get('shoe_category') or '未返回'}；"
                    f"模型：{selections_by_color[color_name].get('_model_id') or model_id}"
                ),
                **_semantic_report_fields(
                    selections_by_color[color_name],
                    slot=assignment["slot"],
                    source_name=source_name,
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
            channel_outputs: dict[str, Path] = {}
            if not angle_entry:
                safe_color = _safe_path_component(color_name)
                for slot, output_name in (
                    ("jdt", f"jdt.{safe_color}.png"),
                    ("wpt30", f"wpt30.{safe_color}.png"),
                ):
                    report_rows.append(_skipped_slot_report_row(
                        style_code=style_code,
                        color=color_name,
                        slot=slot,
                        output_path=output_name,
                        warning=(
                            f"{style_code} {color_name} 缺少 Ai角度图1，"
                            f"已跳过 {output_name}"
                        ),
                        category_source=(
                            selections_by_color[color_name].get("shoe_category_source")
                            or ""
                        ),
                    ))
            else:
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
                        "备注": (
                            "800x800 透明底"
                            if slot.startswith("jdt")
                            else "保持原图透明；目标小于 600KB"
                        ),
                    })

            if color_index == 1:
                if channel_outputs.get("jdt_png"):
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
                        "备注": "首色 tmt 为 800x800 透明底",
                    })
                else:
                    report_rows.append(_skipped_slot_report_row(
                        style_code=style_code,
                        color=color_name,
                        slot="tmt",
                        output_path="tmt.png",
                        warning=(
                            f"{style_code} {color_name} 缺少 Ai角度图1，"
                            "已跳过 tmt.png"
                        ),
                        category_source=(
                            selections_by_color[color_name].get("shoe_category_source")
                            or ""
                        ),
                    ))
                wpz_by_index = dict(_selection_indexed(selections_by_color[color_name], "wpz", 6))
                box_source_name = wpz_by_index.get(6, "")
                box_entry = entries_by_name.get(box_source_name) if box_source_name else None
                if not box_entry:
                    report_rows.append(_skipped_slot_report_row(
                        style_code=style_code,
                        color=color_name,
                        slot="tmq",
                        output_path="tmq.jpg",
                        warning=(
                            f"{style_code} {color_name} 缺少 wpz6 鞋盒标签图，"
                            "已跳过 tmq.jpg"
                        ),
                        category_source=(
                            selections_by_color[color_name].get("shoe_category_source")
                            or ""
                        ),
                    ))
                else:
                    try:
                        tmq_target = _create_tmq_asset(
                            source=Path(box_entry["path"]),
                            target=package_root / "tmq.jpg",
                            label_bbox=selections_by_color[color_name].get("label_bbox"),
                            style_code_bbox=selections_by_color[color_name].get("style_code_bbox"),
                            style_code=style_code,
                            require_style_code_bbox=True,
                        )
                    except ShoeSelectionError as exc:
                        report_rows.append(_skipped_slot_report_row(
                            style_code=style_code,
                            color=color_name,
                            slot="tmq",
                            source_name=box_entry["filename"],
                            cloud_path=_text(box_entry["row"].get("云盘路径")),
                            output_path="tmq.jpg",
                            warning=f"{style_code} {color_name} {exc}，已跳过 tmq.jpg",
                            category_source=(
                                selections_by_color[color_name].get("shoe_category_source")
                                or ""
                            ),
                        ))
                    else:
                        report_rows.append({
                            "输入款号": style_code,
                            "颜色": color_name,
                            "原文件名": box_entry["filename"],
                            "云盘路径": _text(box_entry["row"].get("云盘路径")),
                            "规则槽位": "tmq",
                            "输出文件名": tmq_target.name,
                            "处理动作": (
                                "鞋盒标签裁切并框选已验证款号"
                            ),
                            "下载结果": "已下载",
                            "本地文件": str(tmq_target),
                            "规则告警": "",
                            "品类来源": selections_by_color[color_name].get("shoe_category_source") or "",
                            "鞋盒命名已验证": "是",
                            "鞋盒款色名": color_name,
                            "备注": "800x800；完整12位款号坐标已验证",
                        })
            report_progress(
                "复制命名完成",
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
            warning_color = warning["color"]
            warning_slot = warning.get("slot") or "yx"
            warning_slots = selections_by_color.get(warning_color) or {}
            report_rows.append(_skipped_slot_report_row(
                style_code=style_code,
                color=warning_color,
                slot=warning_slot,
                output_path=warning.get("output_path") or "",
                warning=warning["warning"],
                category_source=warning_slots.get("shoe_category_source") or "",
                action=warning.get("action") or (
                    "允许缺少" if warning_slot == "yx" else "缺少源图已跳过"
                ),
                download_result=warning.get("download_result") or "未找到",
            ))

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

    if not preserve_analysis_artifacts and analysis_root.exists():
        shutil.rmtree(analysis_root, ignore_errors=True)
    report_progress("整理完成", active=False)
    return report_rows, package_roots


def _extract_failed_style_code(message: str) -> str:
    match = re.search(r"\b(\d{12})\b", _text(message))
    return match.group(1) if match else ""


def _row_style_code(row: dict[str, Any]) -> str:
    return _text(row.get("输入款号") or row.get("__shenhui_group_code"))


def _skipped_style_report_row(style_code: str, reason: str) -> dict[str, Any]:
    return {
        "输入款号": style_code,
        "颜色": "",
        "原文件名": "",
        "云盘路径": "",
        "规则槽位": "整款",
        "输出文件名": "",
        "处理动作": "失败款跳过",
        "下载结果": "已跳过",
        "本地文件": "",
        "规则告警": f"{style_code} 整理失败，已跳过该款，不影响其他款",
        "品类来源": "",
        "备注": reason,
    }


def _group_rows_by_style(rows: list[dict[str, Any]]) -> list[tuple[str, list[dict[str, Any]]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    order: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        style_code = _row_style_code(row)
        if not style_code:
            continue
        if style_code not in grouped:
            grouped[style_code] = []
            order.append(style_code)
        grouped[style_code].append(row)
    return [(style_code, grouped[style_code]) for style_code in order]


def _count_shoe_organize_colors(rows: list[dict[str, Any]]) -> int:
    colors: set[tuple[str, str]] = set()
    for row in rows:
        if not isinstance(row, dict) or _text(row.get("下载结果")) != "已下载":
            continue
        local_path = Path(_text(row.get("本地文件"))).expanduser()
        if not local_path.is_file():
            continue
        style_code = _row_style_code(row)
        color_code = _text(row.get("__shoe_color_code") or row.get("颜色"))
        filename = _text(row.get("__shoe_original_filename") or row.get("原文件名") or local_path.name)
        if not style_code or not color_code:
            continue
        if _is_junk_shoe_asset_filename(filename, _text(row.get("云盘路径"))):
            continue
        colors.add((style_code, color_code))
    return len(colors)


def prepare_shoe_packages_skip_failed_styles(**kwargs) -> tuple[list[dict[str, Any]], dict[str, Path]]:
    """Prepare shoe packages while dropping only the style that fails.

    Some business source folders lack a required pose or channel image. The
    interactive task should still finish the other styles in the same batch.
    """

    original_rows = list(kwargs.get("data_rows") or [])
    output_root_raw = kwargs.get("output_root")
    output_root = Path(output_root_raw) if output_root_raw else None
    log = kwargs.get("log") or (lambda _message: None)
    progress = kwargs.get("progress")
    style_groups = _group_rows_by_style(original_rows)
    if not style_groups:
        return prepare_shoe_packages(**kwargs)

    report_rows: list[dict[str, Any]] = []
    package_roots: dict[str, Path] = {}
    style_totals = {
        style_code: _count_shoe_organize_colors(rows)
        for style_code, rows in style_groups
    }
    organize_total = sum(style_totals.values()) or len(style_groups)
    organize_completed_before_style = 0

    for style_code, style_rows in style_groups:
        style_total = style_totals.get(style_code) or 1

        def style_progress(event: dict[str, Any]) -> None:
            if progress is None:
                return
            current_completed = int(event.get("organize_completed") or 0)
            patched_completed = min(
                organize_total,
                organize_completed_before_style + current_completed,
            )
            patched = dict(event)
            patched["organize_total"] = organize_total
            patched["organize_completed"] = patched_completed
            if (
                patched_completed < organize_total
                and patched.get("organize_active") is False
            ):
                patched["organize_active"] = True
                patched["organize_stage"] = f"款号 {style_code} 整理完成，继续下一款"
            progress(patched)

        try:
            current_kwargs = dict(kwargs)
            current_kwargs["data_rows"] = style_rows
            if progress is not None and len(style_groups) > 1:
                current_kwargs["progress"] = style_progress
            current_report_rows, current_package_roots = prepare_shoe_packages(**current_kwargs)
            report_rows.extend(current_report_rows)
            package_roots.update(current_package_roots)
        except ShoeSelectionError as exc:
            reason = _text(exc)
            failed_style_code = _extract_failed_style_code(reason) or style_code
            if failed_style_code != style_code:
                raise
            log(
                f"[warn] 鞋品款号 {style_code} 整理失败，"
                f"已跳过该款并继续其他款：{reason}"
            )
            report_rows.append(_skipped_style_report_row(style_code, reason))
            if output_root is not None:
                shutil.rmtree(output_root / style_code, ignore_errors=True)
                if not bool(kwargs.get("preserve_analysis_artifacts")):
                    shutil.rmtree(output_root / "_shoe_analysis" / style_code, ignore_errors=True)
        finally:
            organize_completed_before_style = min(
                organize_total,
                organize_completed_before_style + style_total,
            )

    if output_root is not None and not bool(kwargs.get("preserve_analysis_artifacts")):
        shutil.rmtree(output_root / "_shoe_analysis", ignore_errors=True)
    if progress is not None:
        progress({
            "organize_total": organize_total,
            "organize_completed": organize_total,
            "organize_active": False,
            "organize_current_style": "",
            "organize_current_color": "",
            "organize_stage": "整理完成",
        })
    return report_rows, package_roots
