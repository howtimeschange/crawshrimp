from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import quote

REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_LIBRARY_ROOT = REPO_ROOT / "adapters" / "bala-ai-video-assistant" / "assets" / "model-library"
MANIFEST_PATH = MODEL_LIBRARY_ROOT / "manifest.json"


def compact(value: Any) -> str:
    return str(value or "").strip()


def _with_image_url(item: dict) -> dict:
    model_id = compact(item.get("id"))
    return {
        **item,
        "image_url": f"/bala-ai-video-model-library/api/image/{quote(model_id, safe='')}",
    }


def load_model_library() -> dict:
    payload = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    items = [_with_image_url(item) for item in payload.get("items") or [] if compact(item.get("id"))]
    return {
        **payload,
        "items": items,
        "count": len(items),
    }


def filter_model_library(
    library: dict,
    age_label: str = "",
    gender: str = "",
    group: str = "",
    search: str = "",
) -> dict:
    age = compact(age_label)
    sex = compact(gender)
    group_id = compact(group)
    keyword = compact(search).lower()
    items = []
    for item in library.get("items") or []:
        haystack = " ".join([
            compact(item.get("id")),
            compact(item.get("group_label")),
            compact(item.get("age_label")),
            compact(item.get("gender")),
            compact(item.get("expression")),
            compact(item.get("filename")),
        ]).lower()
        if age and compact(item.get("age_label")) != age:
            continue
        if sex and compact(item.get("gender")) != sex:
            continue
        if group_id and compact(item.get("group")) != group_id:
            continue
        if keyword and keyword not in haystack:
            continue
        items.append(item)
    return {
        **library,
        "items": items,
        "count": len(items),
    }


def resolve_model_image_path(model_id: str) -> Path:
    safe_id = compact(model_id).replace("\\", "/")
    if not safe_id or safe_id.startswith("/") or ".." in Path(safe_id).parts:
        raise ValueError("非法模特素材路径")
    path = (MODEL_LIBRARY_ROOT / safe_id).resolve()
    root = MODEL_LIBRARY_ROOT.resolve()
    if root not in path.parents:
        raise ValueError("非法模特素材路径")
    if not path.is_file():
        raise FileNotFoundError(safe_id)
    return path
