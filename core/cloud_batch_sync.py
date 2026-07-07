"""Build and sync cloud approval payloads from local Tmall approval batches."""
from __future__ import annotations

import hashlib
import mimetypes
from pathlib import Path
from typing import Any, Mapping

from core.cloud_approval_client import CloudApprovalClient, CloudApprovalError


def build_cloud_batch_payload(batch: Mapping[str, Any]) -> dict:
    """Return the JSON payload for POST /api/ai-image-batches/sync."""
    if not batch.get("batch_id"):
        raise ValueError("batch must contain batch_id and items")
    batch_uid = str(batch["batch_id"])
    styles = []
    for item_index, item in enumerate(batch.get("items") or [], start=1):
        if not isinstance(item, Mapping):
            continue
        style_uid = str(item.get("id") or _stable_uid(batch_uid, item.get("style_code"), item_index))
        style_assets = []
        for asset_index, asset in enumerate(item.get("assets") or [], start=1):
            if not isinstance(asset, Mapping):
                continue
            asset_uid = _asset_uid(batch_uid, item, asset, asset_index)
            style_assets.append(_asset_payload(batch_uid, style_uid, item, asset, asset_uid, asset_index))
        styles.append({
            "style_uid": style_uid,
            "style_id": _positive_int(item.get("style_id") or item.get("cloud_style_id")),
            "row_no": item.get("row_no", ""),
            "style_code": str(item.get("style_code") or ""),
            "item_id": str(item.get("item_id") or ""),
            "category": str(item.get("category") or ""),
            "gender": str(item.get("gender") or ""),
            "skc_code": str(item.get("skc_code") or ""),
            "reference_mode": str(item.get("reference_mode") or ""),
            "status": str(item.get("status") or "pending_review"),
            "missing_prompt_reason": str(item.get("missing_prompt_reason") or ""),
            "source_summary": _sanitize_meta({
                "row_no": item.get("row_no", ""),
                "reference_mode": item.get("reference_mode", ""),
                "source_path_label": _source_path_label(item.get("origin_path")),
                "detail_reference_path_label": _source_path_label(item.get("detail_reference_path")),
            }),
            "assets": style_assets,
            "meta": {
                "task_run_uid": str(item.get("task_run_uid") or ""),
            },
        })
    prompt_version_set = _prompt_version_set(batch, styles)
    return {
        "batch_uid": batch_uid,
        "title": str(batch.get("title") or batch.get("approval_message") or batch_uid),
        "status": str(batch.get("status") or ""),
        "created_at": str(batch.get("created_at") or ""),
        "adapter_id": str(batch.get("adapter_id") or ""),
        "task_id": str(batch.get("task_id") or ""),
        "local_instance_uid": str(batch.get("task_instance_uid") or batch.get("local_instance_uid") or ""),
        "local_run_id": str(batch.get("task_run_uid") or batch.get("local_run_id") or ""),
        "task_instance_uid": str(batch.get("task_instance_uid") or batch.get("local_instance_uid") or ""),
        "task_run_uid": str(batch.get("task_run_uid") or batch.get("local_run_id") or ""),
        "approval_message": str(batch.get("approval_message") or ""),
        "prompt_version_set": prompt_version_set,
        "styles": styles,
        "meta": {
            "local_board_available": bool(batch.get("board_path")),
            "item_count": len(styles),
            "asset_count": sum(len(style.get("assets") or []) for style in styles),
        },
    }


def iter_local_asset_files(batch: Mapping[str, Any]) -> list[dict]:
    """Return uploadable local files with asset_uid, kind, path, filename, and content_type."""
    if not batch.get("batch_id"):
        return []
    batch_uid = str(batch["batch_id"])
    files = []
    for item_index, item in enumerate(batch.get("items") or [], start=1):
        if not isinstance(item, Mapping):
            continue
        for asset_index, asset in enumerate(item.get("assets") or [], start=1):
            if not isinstance(asset, Mapping):
                continue
            path_text = str(asset.get("path") or "").strip()
            if not path_text:
                continue
            path = Path(path_text)
            if not path.is_file():
                continue
            asset_uid = _asset_uid(batch_uid, item, asset, asset_index)
            generation_row = asset.get("generation_row") if isinstance(asset.get("generation_row"), Mapping) else {}
            files.append({
                "asset_uid": asset_uid,
                "style_uid": str(item.get("id") or _stable_uid(batch_uid, item.get("style_code"), item_index)),
                "style_id": _positive_int(item.get("style_id") or item.get("cloud_style_id")),
                "style_code": str(item.get("style_code") or ""),
                "item_id": str(item.get("item_id") or ""),
                "kind": _cloud_kind(asset.get("kind")),
                "path": path,
                "filename": _safe_filename(asset.get("filename") or path.name),
                "content_type": _content_type(path),
                "content_hash": _content_hash(asset, path),
                "prompt_text": str(asset.get("prompt") or generation_row.get("完整Prompt") or generation_row.get("最终提示词") or ""),
                "prompt_template_version_id": _positive_int(asset.get("prompt_template_version_id") or generation_row.get("prompt_template_version_id")),
                "parent_asset_uid": str(asset.get("parent_asset_uid") or ""),
                "generation_job_id": str(asset.get("generation_job_id") or generation_row.get("__1xm_task_id") or generation_row.get("任务ID") or ""),
                "source_path_label": _source_path_label(asset.get("path")),
                "meta": _asset_meta(item, asset, asset_index),
            })
    return files


def sync_local_approval_batch(batch: Mapping[str, Any], client: CloudApprovalClient) -> dict:
    """Create/update the cloud batch, upload assets, then mark sync complete."""
    payload = build_cloud_batch_payload(batch)
    sync_response = client.request_json("POST", "/api/ai-image-batches/sync", payload)
    files = iter_local_asset_files(batch)
    uploaded = []
    style_ids = _style_ids_by_local_key(sync_response, payload)
    for item in files:
        style_id = _style_id_for_file(item, style_ids)
        if not style_id:
            raise CloudApprovalError(f"cloud presign requires numeric style_id for asset {item['asset_uid']}")
        presign = client.request_json("POST", "/api/assets/presign", _presign_payload(payload["batch_uid"], item, style_id))
        upload_url = str(presign.get("upload_url") or "")
        if not upload_url:
            raise CloudApprovalError(f"cloud presign response missing upload_url for asset {item['asset_uid']}")
        result = client.upload_asset(upload_url, item["path"], item["content_type"])
        uploaded.append({
            "asset_uid": item["asset_uid"],
            "filename": item["filename"],
            "content_type": item["content_type"],
            "object_key": str(presign.get("object_key") or ""),
            "uploaded": True,
            "result": result,
        })
    complete = client.request_json("POST", f"/api/ai-image-batches/{payload['batch_uid']}/sync-complete", {
        "batch_uid": payload["batch_uid"],
        "assets": uploaded,
    })
    if isinstance(complete, dict) and "assets" not in complete:
        complete = {**complete, "assets": uploaded}
    return complete


def _asset_payload(batch_uid: str, style_uid: str, item: Mapping[str, Any], asset: Mapping[str, Any], asset_uid: str, asset_index: int) -> dict:
    generation_row = asset.get("generation_row") if isinstance(asset.get("generation_row"), Mapping) else {}
    prompt_version = str(generation_row.get("prompt_version") or generation_row.get("Prompt版本") or "")
    prompt_version_label = str(generation_row.get("提示词版本") or generation_row.get("prompt_version_label") or "")
    path_text = str(asset.get("path") or "")
    path = Path(path_text)
    prompt_text = str(asset.get("prompt") or generation_row.get("完整Prompt") or generation_row.get("最终提示词") or "")
    return {
        "asset_uid": asset_uid,
        "style_uid": style_uid,
        "kind": _cloud_kind(asset.get("kind")),
        "filename": _safe_filename(asset.get("filename") or path.name or asset_uid),
        "content_hash": _content_hash(asset, path if path_text else None),
        "label": str(asset.get("label") or ""),
        "status": str(asset.get("status") or "uploaded"),
        "prompt": prompt_text,
        "prompt_text": prompt_text,
        "prompt_index": asset.get("prompt_index", ""),
        "prompt_name": str(asset.get("prompt_name") or ""),
        "prompt_group": str(asset.get("prompt_group") or ""),
        "prompt_version": prompt_version,
        "prompt_version_label": prompt_version_label,
        "prompt_template_version_id": _positive_int(asset.get("prompt_template_version_id") or generation_row.get("prompt_template_version_id")),
        "parent_asset_uid": str(asset.get("parent_asset_uid") or ""),
        "generation_job_id": str(asset.get("generation_job_id") or generation_row.get("__1xm_task_id") or generation_row.get("任务ID") or ""),
        "source_path_label": _source_path_label(asset.get("path")),
        "meta": _asset_meta(item, asset, asset_index),
    }


def _asset_meta(item: Mapping[str, Any], asset: Mapping[str, Any], asset_index: int) -> dict:
    generation_row = asset.get("generation_row") if isinstance(asset.get("generation_row"), Mapping) else {}
    return _sanitize_meta({
        "local_asset_id": str(asset.get("id") or ""),
        "source_path_label": _source_path_label(asset.get("path")),
        "style_code": str(item.get("style_code") or ""),
        "item_id": str(item.get("item_id") or ""),
        "asset_index": asset_index,
        "prompt_name": str(asset.get("prompt_name") or ""),
        "prompt_group": str(asset.get("prompt_group") or ""),
        "prompt_index": asset.get("prompt_index", ""),
        "generation": generation_row,
    })


def _asset_uid(batch_uid: str, item: Mapping[str, Any], asset: Mapping[str, Any], asset_index: int) -> str:
    local_id = str(asset.get("id") or "").strip()
    if local_id:
        return local_id
    return _stable_uid(
        batch_uid,
        item.get("style_code"),
        asset.get("path"),
        asset.get("prompt_index"),
        asset_index,
    )


def _stable_uid(*parts: Any) -> str:
    text = "/".join(str(part or "") for part in parts)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]


def _cloud_kind(kind: Any) -> str:
    text = str(kind or "").strip()
    if text in {"origin", "source", "local_source"}:
        return "source"
    if text in {"reference", "detail_reference"}:
        return "reference"
    if text == "ai":
        return "ai"
    return text or "asset"


def _source_path_label(path: Any) -> str:
    text = str(path or "").strip()
    return _safe_filename(text) if text else ""


def _safe_filename(value: Any) -> str:
    text = str(value or "").strip()
    base = ""
    for part in text.replace("\\", "/").split("/"):
        if part:
            base = part
    safe = "".join(char if char.isalnum() or char in "._-" else "-" for char in (base or "asset"))
    safe = safe.strip(".-")
    return safe or "asset"


def _content_type(path: Path) -> str:
    guessed, _encoding = mimetypes.guess_type(str(path))
    return guessed or "application/octet-stream"


def _content_hash(asset: Mapping[str, Any], path: Path | None) -> str:
    existing = str(asset.get("content_hash") or asset.get("sha256") or "").strip()
    if existing:
        return existing
    if path and path.is_file():
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    return ""


def _positive_int(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _prompt_version_set(batch: Mapping[str, Any], styles: list[dict]) -> list:
    existing = batch.get("prompt_version_set")
    if isinstance(existing, list):
        return existing
    versions = []
    seen = set()
    for style in styles:
        for asset in style.get("assets") or []:
            if not isinstance(asset, Mapping):
                continue
            version = str(asset.get("prompt_version") or "").strip()
            label = str(asset.get("prompt_version_label") or "").strip()
            key = (version, label)
            if key == ("", "") or key in seen:
                continue
            seen.add(key)
            versions.append({"prompt_version": version, "label": label})
    return versions


def _sanitize_meta(value: Any) -> Any:
    if isinstance(value, Mapping):
        sanitized = {}
        for key, child in value.items():
            key_text = str(key)
            normalized_key = key_text.lower().replace("_", "")
            if normalized_key in {"path", "sourcepath", "localpath", "absolutepath", "originalpath", "filesystempath", "fullpath"}:
                label = _source_path_label(child)
                if label:
                    sanitized[f"{key_text}_label"] = label
                continue
            child_value = _sanitize_meta(child)
            if child_value not in (None, "", [], {}):
                sanitized[key_text] = child_value
        return sanitized
    if isinstance(value, list):
        return [item for item in (_sanitize_meta(item) for item in value) if item not in (None, "", [], {})]
    if isinstance(value, str):
        if _looks_like_local_path(value):
            return _source_path_label(value)
        return value
    return value


def _looks_like_local_path(value: str) -> bool:
    text = value.strip()
    return text.startswith("/") or text.startswith("\\\\") or (len(text) >= 3 and text[1] == ":" and text[2] in {"/", "\\"})


def _style_ids_by_local_key(sync_response: Mapping[str, Any], payload: Mapping[str, Any]) -> dict[tuple[str, str, str], int]:
    style_ids = {}
    for style in _response_styles(sync_response):
        if not isinstance(style, Mapping):
            continue
        style_id = _positive_int(style.get("id") or style.get("style_id"))
        if not style_id:
            continue
        _put_style_id(style_ids, style, style_id)
    for style in payload.get("styles") or []:
        if not isinstance(style, Mapping):
            continue
        style_id = _positive_int(style.get("style_id"))
        if style_id:
            _put_style_id(style_ids, style, style_id)
    return style_ids


def _response_styles(sync_response: Mapping[str, Any]) -> list:
    for key in ("styles", "items"):
        value = sync_response.get(key)
        if isinstance(value, list):
            return value
    batch = sync_response.get("batch")
    if isinstance(batch, Mapping):
        for key in ("styles", "items"):
            value = batch.get(key)
            if isinstance(value, list):
                return value
    return []


def _put_style_id(style_ids: dict[tuple[str, str, str], int], style: Mapping[str, Any], style_id: int) -> None:
    style_uid = str(style.get("style_uid") or style.get("id") or "")
    style_code = str(style.get("style_code") or "")
    item_id = str(style.get("item_id") or "")
    for key in {
        ("uid", style_uid, ""),
        ("code_item", style_code, item_id),
        ("code", style_code, ""),
    }:
        if key[1]:
            style_ids[key] = style_id


def _style_id_for_file(item: Mapping[str, Any], style_ids: Mapping[tuple[str, str, str], int]) -> int | None:
    local = _positive_int(item.get("style_id"))
    if local:
        return local
    keys = (
        ("uid", str(item.get("style_uid") or ""), ""),
        ("code_item", str(item.get("style_code") or ""), str(item.get("item_id") or "")),
        ("code", str(item.get("style_code") or ""), ""),
    )
    for key in keys:
        if style_ids.get(key):
            return style_ids[key]
    return None


def _presign_payload(batch_uid: str, item: Mapping[str, Any], style_id: int) -> dict:
    return {
        "batch_uid": batch_uid,
        "style_id": style_id,
        "asset_uid": item["asset_uid"],
        "kind": item["kind"],
        "filename": item["filename"],
        "content_hash": item.get("content_hash", ""),
        "prompt_template_version_id": item.get("prompt_template_version_id"),
        "prompt_text": item.get("prompt_text", ""),
        "parent_asset_uid": item.get("parent_asset_uid", ""),
        "generation_job_id": item.get("generation_job_id", ""),
        "source_path_label": item.get("source_path_label", ""),
        "meta": item.get("meta") or {},
    }
