"""Build and sync cloud approval payloads from local Tmall approval batches."""
from __future__ import annotations

import hashlib
import mimetypes
from pathlib import Path
from typing import Any, Mapping

from core.cloud_approval_client import CloudApprovalClient


def build_cloud_batch_payload(batch: Mapping[str, Any]) -> dict:
    """Return the JSON payload for POST /api/ai-image-batches."""
    if not batch.get("batch_id"):
        raise ValueError("batch must contain batch_id and items")
    batch_uid = str(batch["batch_id"])
    styles = []
    assets = []
    for item_index, item in enumerate(batch.get("items") or [], start=1):
        if not isinstance(item, Mapping):
            continue
        style_uid = str(item.get("id") or _stable_uid(batch_uid, item.get("style_code"), item_index))
        style_assets = []
        for asset_index, asset in enumerate(item.get("assets") or [], start=1):
            if not isinstance(asset, Mapping):
                continue
            asset_uid = _asset_uid(batch_uid, item, asset, asset_index)
            style_assets.append(asset_uid)
            assets.append(_asset_payload(batch_uid, style_uid, item, asset, asset_uid, asset_index))
        styles.append({
            "style_uid": style_uid,
            "row_no": item.get("row_no", ""),
            "style_code": str(item.get("style_code") or ""),
            "item_id": str(item.get("item_id") or ""),
            "category": str(item.get("category") or ""),
            "gender": str(item.get("gender") or ""),
            "skc_code": str(item.get("skc_code") or ""),
            "reference_mode": str(item.get("reference_mode") or ""),
            "asset_uids": style_assets,
            "metadata": {
                "task_run_uid": str(item.get("task_run_uid") or ""),
            },
        })
    return {
        "batch_uid": batch_uid,
        "status": str(batch.get("status") or ""),
        "created_at": str(batch.get("created_at") or ""),
        "adapter_id": str(batch.get("adapter_id") or ""),
        "task_id": str(batch.get("task_id") or ""),
        "task_instance_uid": str(batch.get("task_instance_uid") or ""),
        "task_run_uid": str(batch.get("task_run_uid") or ""),
        "approval_message": str(batch.get("approval_message") or ""),
        "styles": styles,
        "assets": assets,
        "metadata": {
            "local_board_available": bool(batch.get("board_path")),
            "item_count": len(styles),
            "asset_count": len(assets),
        },
    }


def iter_local_asset_files(batch: Mapping[str, Any]) -> list[dict]:
    """Return uploadable local files with asset_uid, kind, path, filename, and content_type."""
    if not batch.get("batch_id"):
        return []
    batch_uid = str(batch["batch_id"])
    files = []
    for item in batch.get("items") or []:
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
            files.append({
                "asset_uid": _asset_uid(batch_uid, item, asset, asset_index),
                "kind": _cloud_kind(asset.get("kind")),
                "path": path,
                "filename": path.name,
                "content_type": _content_type(path),
            })
    return files


def sync_local_approval_batch(batch: Mapping[str, Any], client: CloudApprovalClient) -> dict:
    """Create/update the cloud batch, upload assets, then mark sync complete."""
    payload = build_cloud_batch_payload(batch)
    client.request_json("POST", "/api/ai-image-batches", payload)
    files = iter_local_asset_files(batch)
    presign = client.request_json("POST", "/api/ai-image-batches/presign", {
        "batch_uid": payload["batch_uid"],
        "assets": [
            {
                "asset_uid": item["asset_uid"],
                "kind": item["kind"],
                "filename": item["filename"],
                "content_type": item["content_type"],
            }
            for item in files
        ],
    })
    upload_urls = _upload_urls_by_asset(presign)
    uploaded = []
    for item in files:
        upload_url = upload_urls.get(item["asset_uid"])
        if not upload_url:
            continue
        result = client.upload_asset(upload_url, item["path"], item["content_type"])
        uploaded.append({
            "asset_uid": item["asset_uid"],
            "filename": item["filename"],
            "content_type": item["content_type"],
            "uploaded": True,
            "result": result,
        })
    return client.request_json("POST", "/api/ai-image-batches/sync-complete", {
        "batch_uid": payload["batch_uid"],
        "assets": uploaded,
    })


def _asset_payload(batch_uid: str, style_uid: str, item: Mapping[str, Any], asset: Mapping[str, Any], asset_uid: str, asset_index: int) -> dict:
    generation_row = asset.get("generation_row") if isinstance(asset.get("generation_row"), Mapping) else {}
    prompt_version = str(generation_row.get("prompt_version") or generation_row.get("Prompt版本") or "")
    prompt_version_label = str(generation_row.get("提示词版本") or generation_row.get("prompt_version_label") or "")
    path = Path(str(asset.get("path") or ""))
    return {
        "asset_uid": asset_uid,
        "style_uid": style_uid,
        "kind": _cloud_kind(asset.get("kind")),
        "filename": str(asset.get("filename") or path.name or ""),
        "label": str(asset.get("label") or ""),
        "status": str(asset.get("status") or ""),
        "prompt": str(asset.get("prompt") or ""),
        "prompt_index": asset.get("prompt_index", ""),
        "prompt_name": str(asset.get("prompt_name") or ""),
        "prompt_group": str(asset.get("prompt_group") or ""),
        "prompt_version": prompt_version,
        "prompt_version_label": prompt_version_label,
        "metadata": {
            "local_asset_id": str(asset.get("id") or ""),
            "source_path_label": _source_path_label(asset.get("path")),
            "style_code": str(item.get("style_code") or ""),
            "item_id": str(item.get("item_id") or ""),
            "asset_index": asset_index,
        },
    }


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
    return Path(text).name if text else ""


def _content_type(path: Path) -> str:
    guessed, _encoding = mimetypes.guess_type(str(path))
    return guessed or "application/octet-stream"


def _upload_urls_by_asset(presign: Mapping[str, Any]) -> dict[str, str]:
    uploads = presign.get("uploads")
    if isinstance(uploads, list):
        return {
            str(item.get("asset_uid") or ""): str(item.get("upload_url") or item.get("url") or "")
            for item in uploads
            if isinstance(item, Mapping)
        }
    if isinstance(uploads, Mapping):
        return {str(key): str(value) for key, value in uploads.items()}
    return {}
