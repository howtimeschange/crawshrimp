from __future__ import annotations

import hmac
import json
import os
import re
import secrets
import shutil
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Mapping

from core import ai_image_service
from core import data_sink
from core import runtime_paths

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
WORKFLOW_ID = "bala_ai_video_image_review"
STATUS_GENERATING = "generating"
STATUS_PENDING_APPROVAL = "pending_approval"
STATUS_READY_FOR_VIDEO = "ready_for_video"
VIDEO_PROVIDER_QN = "qn_img2video"
_REVIEW_BATCH_LOCKS: dict[str, threading.RLock] = {}
_REVIEW_BATCH_LOCKS_GUARD = threading.Lock()


def _text(value: Any) -> str:
    return str(value or "").strip()


def normalize_operation_type(value: object) -> str:
    text = _text(value).lower()
    if text in {"face_swap", "face", "换脸", "ai_face", "ai换脸"}:
        return "face_swap"
    if text in {"background_swap", "background", "换背景", "ai_background", "ai换背景"}:
        return "background_swap"
    if text in {"outfit_swap", "outfit", "换装", "ai_outfit", "ai换装"}:
        return "outfit_swap"
    if text in {"pose_swap", "pose", "换姿势", "ai_pose", "ai换姿势"}:
        return "pose_swap"
    return "face_swap"


def _safe_id(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._~-]+", "-", _text(value)).strip("-")
    return cleaned or fallback


def _review_root() -> Path:
    path = runtime_paths.child_dir("bala-ai-video-review")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _batch_dir(artifact_dir: str, batch_id: str) -> Path:
    root = Path(artifact_dir or _review_root()).expanduser()
    path = root / _safe_id(batch_id, "bala-review")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _batch_json_path(batch: Mapping[str, Any] | None = None, batch_id: str = "") -> Path:
    source = batch or {}
    return _batch_dir(_text(source.get("artifact_dir")), _text(batch_id or source.get("batch_id"))) / "review-batch.json"


def _style_code_from_row(row: Mapping[str, Any]) -> str:
    text = _text(row.get("款号") or row.get("style_code") or row.get("输入款号") or row.get("源图文件"))
    match = re.search(r"\b(\d{12})\b", text)
    return match.group(1) if match else (text or "unknown")


def _path_list(*values: Any) -> list[str]:
    paths: list[str] = []
    for value in values:
        if isinstance(value, Mapping):
            paths.extend(_path_list(value.get("paths")))
        elif isinstance(value, (list, tuple)):
            paths.extend(_path_list(*value))
        else:
            paths.extend(
                item.strip()
                for item in str(value or "").replace("，", "\n").replace(",", "\n").splitlines()
                if item.strip()
            )
    return paths


def _first_existing_path(*values: Any) -> str:
    for path in _path_list(*values):
        if Path(path).expanduser().is_file():
            return str(Path(path).expanduser())
    return ""


def _result_path_from_row(row: Mapping[str, Any]) -> str:
    return _first_existing_path(
        row.get("AI图文件"),
        row.get("生成图文件"),
        row.get("结果图文件"),
        row.get("输出文件"),
        row.get("本地文件"),
        row.get("path"),
    )


def _asset_image_url(api_base_url: str, batch_id: str, asset_id: str, token: str) -> str:
    if not api_base_url:
        return ""
    return f"{api_base_url.rstrip('/')}/bala-ai-video-review/api/{batch_id}/image/{asset_id}?token={token}"


def _operation_prompt(row: Mapping[str, Any], operation_type: str) -> str:
    if operation_type == "background_swap":
        return _text(row.get("背景Prompt") or row.get("background_prompt"))
    if operation_type == "pose_swap":
        return _text(row.get("姿势Prompt") or row.get("pose_prompt"))
    return _text(row.get("Prompt") or row.get("补充要求") or row.get("prompt_extra"))


def _is_failed_row(row: Mapping[str, Any]) -> bool:
    result = _text(row.get("执行结果") or row.get("status"))
    return any(word in result for word in ("失败", "错误", "failed", "error"))


def _all_assets(batch: Mapping[str, Any]) -> list[dict]:
    return [
        asset
        for item in batch.get("items") or []
        for asset in item.get("assets") or []
        if isinstance(asset, dict)
    ]


def _recompute_batch_status(batch: dict) -> dict:
    ai_assets = [asset for asset in _all_assets(batch) if asset.get("kind") == "ai"]
    reviewable_assets = [asset for asset in _all_assets(batch) if asset.get("kind") in {"origin", "ai"}]
    if any(asset.get("status") == STATUS_GENERATING for asset in ai_assets):
        batch["status"] = STATUS_GENERATING
    elif any(asset.get("status") == "pending" for asset in reviewable_assets):
        batch["status"] = STATUS_PENDING_APPROVAL
    elif any(asset.get("status") == "approved" for asset in reviewable_assets):
        batch["status"] = STATUS_READY_FOR_VIDEO
    else:
        batch["status"] = STATUS_PENDING_APPROVAL
    return batch


def build_review_batch(rows: list[dict], run_params: dict, artifact_dir: str, api_base_url: str) -> dict:
    batch_id = f"bala-ai-video-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(3)}"
    token = secrets.token_urlsafe(18)
    items_by_style: dict[str, dict] = {}
    origin_assets: dict[tuple[str, str], str] = {}
    ai_index = 0

    for row in rows or []:
        if not isinstance(row, Mapping):
            continue
        style_code = _style_code_from_row(row)
        item = items_by_style.setdefault(style_code, {"style_code": style_code, "assets": []})
        source_path = _text(row.get("源图文件") or row.get("source_image") or row.get("source_path"))
        source_asset_id = ""
        if source_path:
            key = (style_code, source_path)
            source_asset_id = origin_assets.get(key, "")
            if not source_asset_id:
                source_asset_id = f"{_safe_id(style_code, 'style')}-origin-{len(origin_assets) + 1}"
                origin_assets[key] = source_asset_id
                item["assets"].append({
                    "id": source_asset_id,
                    "kind": "origin",
                    "style_code": style_code,
                    "path": source_path,
                    "filename": Path(source_path).name,
                    "status": "pending",
                    "image_url": _asset_image_url(api_base_url, batch_id, source_asset_id, token),
                })

        ai_index += 1
        operation_type = normalize_operation_type(row.get("操作类型") or row.get("operation_type"))
        result_path = _result_path_from_row(row)
        status = "failed" if _is_failed_row(row) else ("pending" if result_path else STATUS_GENERATING)
        ai_asset_id = f"{_safe_id(style_code, 'style')}-ai-{ai_index}"
        item["assets"].append({
            "id": ai_asset_id,
            "kind": "ai",
            "style_code": style_code,
            "source_asset_id": source_asset_id,
            "source_path": source_path,
            "path": result_path,
            "filename": Path(result_path).name if result_path else "",
            "status": status,
            "operation_type": operation_type,
            "job_uid": _text(row.get("AI任务UID") or row.get("job_uid")),
            "run_uid": _text(row.get("运行UID") or row.get("run_uid")),
            "prompt": _operation_prompt(row, operation_type),
            "model_id": _text(row.get("模特ID") or row.get("指定模特图") or row.get("model_id")),
            "model_image_path": _text(row.get("模特图文件") or row.get("model_image_path")),
            "background_prompt": _text(row.get("背景Prompt") or row.get("background_prompt")),
            "garment_paths": _path_list(row.get("服装图文件") or row.get("garment_images")),
            "outfit_reference_paths": _path_list(row.get("搭配参考图文件") or row.get("outfit_reference_images")),
            "variant_reference_paths": _path_list(row.get("同款不同色参考图文件") or row.get("variant_reference_images")),
            "pose_prompt": _text(row.get("姿势Prompt") or row.get("pose_prompt")),
            "image_url": _asset_image_url(api_base_url, batch_id, ai_asset_id, token),
        })

    batch = {
        "batch_id": batch_id,
        "token": token,
        "workflow": WORKFLOW_ID,
        "status": STATUS_GENERATING,
        "artifact_dir": str(Path(artifact_dir or _review_root()).expanduser()),
        "workspace_dir": _text((run_params or {}).get("workspace_dir") or (run_params or {}).get("output_dir")),
        "video_provider": _text((run_params or {}).get("video_provider")) or VIDEO_PROVIDER_QN,
        "items": list(items_by_style.values()),
        "board_url": f"{api_base_url.rstrip('/')}/bala-ai-video-review/{batch_id}?token={token}",
    }
    return _recompute_batch_status(batch)


def save_review_batch(batch: dict) -> Path:
    path = _batch_json_path(batch)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    try:
        temporary.write_text(json.dumps(batch, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def _review_batch_lock(batch_id: str) -> threading.RLock:
    safe_batch_id = _safe_id(batch_id, "")
    with _REVIEW_BATCH_LOCKS_GUARD:
        lock = _REVIEW_BATCH_LOCKS.get(safe_batch_id)
        if lock is None:
            lock = threading.RLock()
            _REVIEW_BATCH_LOCKS[safe_batch_id] = lock
        return lock


def mutate_review_batch(
    batch_id: str,
    token: str,
    mutation: Callable[[dict], dict | None],
) -> dict:
    with _review_batch_lock(batch_id):
        batch = load_review_batch(batch_id)
        validate_token(batch, token)
        updated = mutation(batch) or batch
        save_review_batch(updated)
        return updated


def load_review_batch(batch_id: str) -> dict:
    safe_batch_id = _safe_id(batch_id, "")
    candidates = [_review_root() / safe_batch_id / "review-batch.json"]
    candidates.extend(_review_root().glob(f"**/{safe_batch_id}/review-batch.json"))
    for path in candidates:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    raise FileNotFoundError(_text(batch_id))


def list_review_batches(*, style_codes: list[str] | None = None, workspace_dir: str = "", limit: int = 100) -> list[dict]:
    requested_styles = {_text(value) for value in (style_codes or []) if _text(value)}
    requested_workspace = _text(workspace_dir).replace("\\", "/").rstrip("/")
    try:
        safe_limit = max(1, min(int(limit), 200))
    except (TypeError, ValueError):
        safe_limit = 100
    batches: list[dict] = []
    seen_batch_ids: set[str] = set()
    paths = sorted(_review_root().glob("**/review-batch.json"), key=lambda item: item.parent.name)
    for path in paths:
        try:
            batch = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            continue
        if not isinstance(batch, dict):
            continue
        batch_id = _text(batch.get("batch_id"))
        if not batch_id or batch_id in seen_batch_ids:
            continue
        styles = {
            _text(item.get("style_code") or item.get("styleCode"))
            for item in (batch.get("items") or [])
            if isinstance(item, Mapping)
        }
        if requested_styles and not requested_styles.intersection(styles):
            continue
        if requested_workspace:
            batch_workspace = _text(batch.get("workspace_dir")).replace("\\", "/").rstrip("/")
            workspace_matches = batch_workspace == requested_workspace
            if not workspace_matches:
                asset_paths = [
                    _text(asset.get(key)).replace("\\", "/")
                    for item in (batch.get("items") or [])
                    if isinstance(item, Mapping)
                    for asset in (item.get("assets") or [])
                    if isinstance(asset, Mapping)
                    for key in ("path", "source_path", "source_image")
                ]
                workspace_matches = any(
                    path == requested_workspace or path.startswith(f"{requested_workspace}/")
                    for path in asset_paths if path
                )
            if not workspace_matches:
                continue
        seen_batch_ids.add(batch_id)
        batches.append(batch)
    return batches[-safe_limit:]


def validate_token(batch: Mapping[str, Any], token: str) -> None:
    expected = _text(batch.get("token"))
    provided = _text(token)
    if not expected or not provided or not hmac.compare_digest(expected, provided):
        raise PermissionError("Bala review batch token mismatch")


def update_review_decisions(batch: dict, decisions: dict) -> dict:
    decision_map = decisions or {}
    allowed = {"approved", "rejected", "pending"}
    for asset in _all_assets(batch):
        if asset.get("kind") not in {"origin", "ai"}:
            continue
        decision = decision_map.get(asset.get("id"))
        if not isinstance(decision, Mapping):
            continue
        status = _text(decision.get("status"))
        if status in allowed:
            asset["status"] = status
        note = _text(decision.get("note"))
        if note:
            asset["review_note"] = note
    return _recompute_batch_status(batch)


def remove_review_asset(batch: dict, asset_id: str) -> dict:
    target = _text(asset_id)
    for item in batch.get("items") or []:
        assets = item.get("assets") if isinstance(item, dict) else None
        if not isinstance(assets, list):
            continue
        for index, asset in enumerate(assets):
            if not isinstance(asset, dict) or _text(asset.get("id")) != target:
                continue
            if asset.get("kind") != "ai":
                raise ValueError("仅允许从审核批次删除 AI 结果")
            assets.pop(index)
            return _recompute_batch_status(batch)
    raise KeyError(target)


def _job_output_paths(job_uid: str) -> list[str]:
    paths: list[str] = []
    if not job_uid:
        return paths
    job = data_sink.get_ai_image_job(job_uid) or {}
    summary = job.get("summary") if isinstance(job.get("summary"), Mapping) else {}
    paths.extend(_path_list(summary.get("output_files"), summary.get("files")))
    result_cache = summary.get("result_cache") if isinstance(summary.get("result_cache"), Mapping) else {}
    paths.extend(_path_list(list(result_cache.values())))
    for asset in data_sink.list_ai_image_assets(job_uid):
        if _text(asset.get("kind")).lower() in {"output", "result", "generated", "ai"}:
            paths.extend(_path_list(asset.get("path")))
    existing = [path for path in paths if Path(path).expanduser().is_file()]
    if existing:
        return existing

    urls = _path_list(summary.get("image_urls"))
    for run in summary.get("runs") or []:
        if isinstance(run, Mapping):
            urls.extend(_path_list(run.get("image_urls")))
    for url in dict.fromkeys(urls):
        if not url.startswith(("http://", "https://")):
            continue
        try:
            materialized = ai_image_service.materialize_remote_image(job_uid, url)
        except Exception:
            continue
        path = _text(materialized.get("path"))
        if path and Path(path).expanduser().is_file():
            existing.append(path)
    return existing


def refresh_generated_assets(batch: dict) -> dict:
    for asset in _all_assets(batch):
        if asset.get("kind") != "ai":
            continue
        if _text(asset.get("path")) and Path(_text(asset.get("path"))).is_file():
            if asset.get("status") == STATUS_GENERATING:
                asset["status"] = "pending"
            continue
        paths = _job_output_paths(_text(asset.get("job_uid")))
        if not paths:
            continue
        asset["path"] = paths[0]
        asset["filename"] = Path(paths[0]).name
        asset["status"] = "pending"
    return _recompute_batch_status(batch)


def _unique_target(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    for index in range(2, 1000):
        candidate = path.with_name(f"{stem}-{index}{suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"Unable to find unique output path for {path}")


def export_video_input_manifest(batch: dict, output_root: str, provider: str = VIDEO_PROVIDER_QN) -> dict:
    root = Path(output_root or _batch_dir(_text(batch.get("artifact_dir")), _text(batch.get("batch_id"))) / "video-input").expanduser()
    root.mkdir(parents=True, exist_ok=True)
    styles: list[dict] = []
    copied_paths: list[str] = []

    for item in batch.get("items") or []:
        style_code = _text(item.get("style_code")) or "unknown"
        style_dir = root / _safe_id(style_code, "style")
        images = []
        for asset in item.get("assets") or []:
            if asset.get("kind") not in {"origin", "ai"} or asset.get("status") != "approved":
                continue
            source = Path(_text(asset.get("path"))).expanduser()
            if not source.is_file() or source.suffix.lower() not in IMAGE_SUFFIXES:
                continue
            style_dir.mkdir(parents=True, exist_ok=True)
            target = _unique_target(style_dir / source.name)
            shutil.copy2(source, target)
            copied = str(target)
            copied_paths.append(copied)
            images.append({
                "path": copied,
                "source_asset_id": _text(asset.get("id")),
                "kind": _text(asset.get("kind")),
                "operation_type": (
                    normalize_operation_type(asset.get("operation_type"))
                    if asset.get("kind") == "ai"
                    else "origin"
                ),
            })
        if images:
            styles.append({"style_code": style_code, "images": images})

    manifest_payload = {
        "provider": _text(provider) or VIDEO_PROVIDER_QN,
        "batch_id": _text(batch.get("batch_id")),
        "styles": styles,
    }
    manifest_path = root / "bala-video-input-manifest.json"
    manifest_path.write_text(json.dumps(manifest_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        **manifest_payload,
        "manifest_path": str(manifest_path),
        "image_paths": copied_paths,
        "image_count": len(copied_paths),
    }


def build_qn_img2video_initial_params(manifest: dict) -> dict:
    image_paths = list(manifest.get("image_paths") or [])
    if not image_paths:
        for style in manifest.get("styles") or []:
            for image in style.get("images") or []:
                path = _text(image.get("path"))
                if path:
                    image_paths.append(path)
    return {
        "execute_mode": "plan",
        "material_images": {"paths": image_paths},
        "video_input_manifest": _text(manifest.get("manifest_path")),
        "download_template_previews": True,
    }
