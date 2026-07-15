from __future__ import annotations

import hmac
import json
import re
import secrets
from datetime import datetime
from pathlib import Path
from typing import Any

from core import runtime_paths

WORKFLOW_ID = "bala_ai_video_material_selection"
VIDEO_ADAPTER_ID = "bala-ai-video-assistant"
AI_TASK_ID = "bala_ai_face_background_generate"
VALID_OPERATION_TYPES = {"face_swap", "background_swap", "outfit_swap", "pose_swap"}
THUMBNAIL_MAX_EDGE = 480
THUMBNAIL_QUALITY = 72


def compact(value: Any) -> str:
    return str(value or "").strip()


def normalize_operation_type(value: Any) -> str:
    text = compact(value).lower()
    if text in {"background_swap", "background", "换背景"}:
        return "background_swap"
    if text in {"outfit_swap", "outfit", "换装"}:
        return "outfit_swap"
    if text in {"pose_swap", "pose", "换姿势"}:
        return "pose_swap"
    return "face_swap"


def normalize_source_type(value: Any) -> str:
    text = compact(value)
    if "模拍" in text:
        return "model"
    if "细节" in text or "平拍" in text:
        return "detail"
    return "other"


def _safe_id(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._~-]+", "-", compact(value)).strip("-")
    return cleaned or fallback


def _material_root() -> Path:
    path = runtime_paths.child_dir("bala-ai-video-materials")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _batch_dir(batch: dict | None = None, batch_id: str = "") -> Path:
    resolved_batch_id = compact(batch_id or (batch or {}).get("batch_id"))
    artifact_dir = compact((batch or {}).get("artifact_dir"))
    root = Path(artifact_dir).expanduser() if artifact_dir else _material_root()
    path = root / _safe_id(resolved_batch_id, "bala-material")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _batch_json_path(batch: dict | None = None, batch_id: str = "") -> Path:
    return _batch_dir(batch, batch_id) / "material-batch.json"


def _style_code_from_row(row: dict, local_path: str) -> str:
    style_code = compact(row.get("输入款号") or row.get("款号"))
    if style_code:
        return style_code
    match = re.search(r"\b(\d{12})\b", local_path)
    return match.group(1) if match else "unknown"


def _asset_version(path: str | Path) -> str:
    try:
        stat = Path(path).expanduser().stat()
    except OSError:
        return "0"
    return f"{stat.st_mtime_ns:x}-{stat.st_size:x}"


def attach_material_preview_urls(batch: dict, api_base_url: str) -> dict:
    base = compact(api_base_url).rstrip("/")
    batch_id = compact(batch.get("batch_id"))
    token = compact(batch.get("token"))
    if not base or not batch_id or not token:
        return batch
    for item in batch.get("items") or []:
        for asset in item.get("assets") or []:
            if not isinstance(asset, dict):
                continue
            asset_id = compact(asset.get("id"))
            if not asset_id:
                continue
            version = _asset_version(asset.get("path") or "")
            asset["image_url"] = f"{base}/bala-ai-video-materials/api/{batch_id}/image/{asset_id}?token={token}"
            asset["thumbnail_url"] = (
                f"{base}/bala-ai-video-materials/api/{batch_id}/thumbnail/{asset_id}"
                f"?token={token}&v={version}"
            )
    return batch


def ensure_material_thumbnail(
    batch: dict,
    asset_id: str,
    source_path: str | Path,
    *,
    max_edge: int = THUMBNAIL_MAX_EDGE,
    quality: int = THUMBNAIL_QUALITY,
) -> Path:
    from PIL import Image, ImageOps

    source = Path(source_path).expanduser()
    if not source.is_file():
        raise FileNotFoundError(str(source))
    edge = max(64, min(int(max_edge or THUMBNAIL_MAX_EDGE), 1024))
    webp_quality = max(40, min(int(quality or THUMBNAIL_QUALITY), 90))
    cache_dir = _batch_dir(batch) / "thumbnails"
    cache_dir.mkdir(parents=True, exist_ok=True)
    destination = cache_dir / f"{_safe_id(asset_id, 'asset')}-{edge}-q{webp_quality}.webp"
    if destination.is_file() and destination.stat().st_mtime_ns >= source.stat().st_mtime_ns:
        return destination

    temporary = cache_dir / f".{destination.name}.{secrets.token_hex(4)}.tmp"
    try:
        with Image.open(source) as opened:
            image = ImageOps.exif_transpose(opened)
            if image.mode not in {"RGB", "RGBA"}:
                image = image.convert("RGBA" if "transparency" in image.info else "RGB")
            image.thumbnail((edge, edge), Image.Resampling.LANCZOS)
            image.save(temporary, format="WEBP", quality=webp_quality, method=4)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def build_material_batch(rows: list[dict], artifact_dir: str, api_base_url: str) -> dict:
    batch_id = f"bala-material-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(3)}"
    token = secrets.token_urlsafe(18)
    items_by_style: dict[str, dict] = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        local_path = compact(row.get("本地文件"))
        if not local_path or not Path(local_path).is_file():
            continue
        if compact(row.get("下载结果")) in {"已跳过", "失败", "下载失败"}:
            continue
        style_code = _style_code_from_row(row, local_path)
        item = items_by_style.setdefault(style_code, {"style_code": style_code, "assets": []})
        source_type = normalize_source_type(row.get("素材来源"))
        asset_id = f"{_safe_id(style_code, 'style')}-{source_type}-{len(item['assets']) + 1}"
        item["assets"].append({
            "id": asset_id,
            "style_code": style_code,
            "source_type": source_type,
            "filename": compact(row.get("文件名")) or Path(local_path).name,
            "path": str(Path(local_path).expanduser()),
            "selected": False,
            "download_result": compact(row.get("下载结果")),
            "action": compact(row.get("处理动作")),
            "note": compact(row.get("备注")),
            "image_url": f"{api_base_url.rstrip('/')}/bala-ai-video-materials/api/{batch_id}/image/{asset_id}?token={token}",
        })
    batch = {
        "batch_id": batch_id,
        "token": token,
        "workflow": WORKFLOW_ID,
        "status": "pending_selection",
        "artifact_dir": str(Path(artifact_dir or _material_root()).expanduser()),
        "items": list(items_by_style.values()),
        "board_url": f"{api_base_url.rstrip('/')}/bala-ai-video-materials/{batch_id}?token={token}",
    }
    return attach_material_preview_urls(batch, api_base_url)


def save_material_batch(batch: dict) -> Path:
    path = _batch_json_path(batch)
    path.write_text(json.dumps(batch, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def load_material_batch(batch_id: str) -> dict:
    safe_batch_id = _safe_id(batch_id, "")
    candidates = [
        _material_root() / safe_batch_id / "material-batch.json",
    ]
    for path in _material_root().glob(f"**/{safe_batch_id}/material-batch.json"):
        candidates.append(path)
    for path in candidates:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    raise FileNotFoundError(compact(batch_id))


def validate_token(batch: dict, token: str) -> None:
    expected = compact(batch.get("token"))
    provided = compact(token)
    if not expected or not provided or not hmac.compare_digest(expected, provided):
        raise PermissionError("Bala material batch token mismatch")


def _all_assets(batch: dict) -> list[dict]:
    return [
        asset
        for item in batch.get("items") or []
        for asset in item.get("assets") or []
        if isinstance(asset, dict)
    ]


def update_material_selection(batch: dict, selected_asset_ids: list[str]) -> dict:
    selected = {compact(item) for item in selected_asset_ids or [] if compact(item)}
    for asset in _all_assets(batch):
        asset["selected"] = compact(asset.get("id")) in selected
    batch["status"] = "selected" if selected else "pending_selection"
    return batch


def _list_paths(value: Any) -> list[str]:
    if isinstance(value, dict):
        return _list_paths(value.get("paths"))
    if isinstance(value, (list, tuple)):
        return [compact(item) for item in value if compact(item)]
    return [
        item.strip()
        for item in str(value or "").replace("，", "\n").replace(",", "\n").splitlines()
        if item.strip()
    ]


def _selected_source_paths(batch: dict, payload: dict) -> list[str]:
    requested = {compact(item) for item in payload.get("selected_asset_ids") or [] if compact(item)}
    paths: list[str] = []
    for asset in _all_assets(batch):
        if requested and compact(asset.get("id")) not in requested:
            continue
        if not requested and not asset.get("selected"):
            continue
        path = compact(asset.get("path"))
        if path:
            paths.append(path)
    return paths


def _model_ref_ids(payload: dict) -> list[str]:
    return _list_paths(payload.get("model_ref_ids"))


def export_ai_input(batch: dict, operation_type: str, payload: dict) -> dict:
    operation = normalize_operation_type(operation_type)
    data = payload or {}
    source_paths = _selected_source_paths(batch, data)
    params: dict[str, Any] = {
        "operation_type": operation,
        "source_images": {"paths": source_paths},
        "review_mode": "create_review_batch",
        "generation_mode": "submit_async",
    }
    prompt_extra = compact(data.get("prompt_extra"))
    if prompt_extra:
        params["prompt_extra"] = prompt_extra
    if operation == "face_swap":
        params["model_ref_ids"] = "\n".join(_model_ref_ids(data))
        params["model_groups"] = []
    elif operation == "background_swap":
        params["background_prompt"] = compact(data.get("background_prompt"))
    elif operation == "outfit_swap":
        params["garment_images"] = {"paths": _list_paths(data.get("garment_images"))}
        params["outfit_reference_images"] = {"paths": _list_paths(data.get("outfit_reference_images"))}
        params["variant_reference_images"] = {"paths": _list_paths(data.get("variant_reference_images"))}
    elif operation == "pose_swap":
        params["pose_prompt"] = compact(data.get("pose_prompt"))
        params["prompt_cards"] = data.get("prompt_cards") if isinstance(data.get("prompt_cards"), list) else []
    return {
        "ok": True,
        "operation_type": operation,
        "source_images": source_paths,
        "next_task": {
            "adapter_id": VIDEO_ADAPTER_ID,
            "task_id": AI_TASK_ID,
            "params": params,
        },
    }
