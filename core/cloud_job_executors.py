"""Local executors for cloud approval machine jobs."""
from __future__ import annotations

import asyncio
import importlib.util
import mimetypes
import urllib.request
from pathlib import Path
from typing import Any, Mapping

from core import runtime_paths
from core.cloud_approval_client import CloudApprovalClient, CloudApprovalError


class CloudJobBlocked(RuntimeError):
    def __init__(self, status: str, message: str = ""):
        super().__init__(message or status)
        self.status = status
        self.message = message or status


class CloudJobTerminalFailure(RuntimeError):
    pass


class CloudJobExecutor:
    def __init__(
        self,
        client: CloudApprovalClient,
        work_dir: Path | None = None,
        *,
        tmall_module=None,
    ):
        self.client = client
        self.work_dir = Path(work_dir) if work_dir is not None else runtime_paths.data_root() / "cloud-jobs"
        self.tmall_module = tmall_module

    def execute(self, job: Mapping[str, Any]) -> dict:
        job_type = str(job.get("job_type") or "")
        if job_type == "regenerate_ai_image":
            return self.execute_regenerate_ai_image(job)
        if job_type == "submit_tmall_material_test":
            return self.execute_submit_tmall_material_test(job)
        raise ValueError(f"Unsupported cloud job type: {job_type}")

    def execute_regenerate_ai_image(self, job: Mapping[str, Any]) -> dict:
        payload = _payload(job)
        asset_uid = _required_text(payload, "asset_uid")
        batch_uid = str(payload.get("batch_uid") or job.get("batch_uid") or "")
        style_id = _positive_int(payload.get("style_id"))
        task_dir = self._task_dir(job)
        self._progress(job, "downloading_assets", "下载参考素材")
        reference_paths = [
            str(self._download_asset(uid, task_dir / "references"))
            for uid in _text_list(payload.get("reference_asset_uids"))
        ]
        self._renew(job)

        module = self._tmall_module()
        batch = self._regeneration_batch(job, payload, task_dir, reference_paths)
        self._progress(job, "regenerating", "本地重新生图")
        asset = module.regenerate_approval_asset(
            batch,
            asset_uid,
            prompt=str(payload.get("prompt_text") or ""),
            reference_paths=reference_paths,
        )
        self._renew(job)

        output_path = _local_file(asset.get("path"), task_dir)
        self._progress(job, "uploading_results", "上传重新生图结果")
        upload_result = self._upload_result_asset(
            batch_uid=batch_uid,
            style_id=style_id,
            asset_uid=asset_uid,
            path=output_path,
            prompt_text=str(asset.get("prompt") or payload.get("prompt_text") or ""),
            parent_asset_uid=str(payload.get("parent_asset_uid") or ""),
            generation_job_id=str((asset.get("generation_row") or {}).get("任务ID") or (asset.get("generation_row") or {}).get("__1xm_task_id") or ""),
        )
        self._renew(job)
        return {
            "status": "succeeded",
            "result": {
                "asset_uid": asset_uid,
                "filename": output_path.name,
                "object_key": upload_result.get("object_key", ""),
                "local_result_path": str(output_path),
            },
        }

    def execute_submit_tmall_material_test(self, job: Mapping[str, Any]) -> dict:
        payload = _payload(job)
        submit_plan = payload.get("submit_plan") if isinstance(payload.get("submit_plan"), Mapping) else None
        if not submit_plan:
            raise ValueError("submit_tmall_material_test payload is missing")
        task_dir = self._task_dir(job)
        self._progress(job, "downloading_assets", "下载已确认图片")
        batch = self._submit_batch(job, submit_plan, task_dir)
        self._renew(job)

        module = self._tmall_module()
        self._progress(job, "submitting", "本地提交天猫测图任务")
        try:
            result = _run_maybe_async(module.upload_approved_tmall_batch(batch))
        except RuntimeError as exc:
            if _looks_like_login_block(str(exc)):
                raise CloudJobBlocked("needs_login", str(exc)) from exc
            raise CloudJobTerminalFailure(str(exc)) from exc
        if _submit_result_failed(result):
            raise CloudJobTerminalFailure(_submit_failure_message(result))
        self._renew(job)
        return {
            "status": "succeeded",
            "result": {
                "status": str(result.get("status") or ""),
                "result_path": _safe_result_path(result.get("result_path"), task_dir),
                "submitted": result.get("submitted", result.get("succeeded", 0)),
                "attempted": result.get("attempted", 0),
                "succeeded": result.get("succeeded", 0),
                "failed": result.get("failed", 0),
            },
        }

    def _task_dir(self, job: Mapping[str, Any]) -> Path:
        job_uid = _safe_segment(str(job.get("job_uid") or "job"))
        path = self.work_dir / job_uid
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _download_asset(self, asset_uid: str, target_dir: Path) -> Path:
        target_dir.mkdir(parents=True, exist_ok=True)
        safe_uid = _safe_segment(asset_uid)
        target = target_dir / f"{safe_uid}.jpg"
        if hasattr(self.client, "download_asset"):
            return Path(self.client.download_asset(asset_uid, target))
        url = self.client._url_for(f"/api/assets/{asset_uid}/download")
        headers = {"Accept": "*/*"}
        token = getattr(self.client, "machine_token", "")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=getattr(self.client, "timeout", 30.0)) as response:
                target.write_bytes(response.read())
        except Exception as exc:
            raise CloudApprovalError(f"cloud asset download failed: {type(exc).__name__}") from None
        return target

    def _upload_result_asset(
        self,
        *,
        batch_uid: str,
        style_id: int,
        asset_uid: str,
        path: Path,
        prompt_text: str,
        parent_asset_uid: str,
        generation_job_id: str,
    ) -> dict:
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        presign = self.client.request_json("POST", "/api/assets/presign", {
            "batch_uid": batch_uid,
            "style_id": style_id,
            "asset_uid": asset_uid,
            "kind": "ai",
            "filename": path.name,
            "content_type": content_type,
            "prompt_text": prompt_text,
            "parent_asset_uid": parent_asset_uid,
            "generation_job_id": generation_job_id,
        })
        upload_url = str(presign.get("upload_url") or "")
        if not upload_url:
            raise CloudApprovalError(f"cloud presign response missing upload_url for asset {asset_uid}")
        self.client.upload_asset(upload_url, path, content_type)
        return presign

    def _progress(self, job: Mapping[str, Any], phase: str, message: str) -> dict:
        return self.client.request_json("POST", f"/api/jobs/{_job_uid(job)}/progress", {
            "job_uid": _job_uid(job),
            "lease_id": _lease_id(job),
            "message": message,
            "result": {"phase": phase},
        })

    def _renew(self, job: Mapping[str, Any]) -> dict:
        return self.client.request_json("POST", f"/api/jobs/{_job_uid(job)}/renew", {
            "job_uid": _job_uid(job),
            "lease_id": _lease_id(job),
        })

    def _regeneration_batch(self, job: Mapping[str, Any], payload: Mapping[str, Any], task_dir: Path, reference_paths: list[str]) -> dict:
        batch_uid = str(payload.get("batch_uid") or job.get("batch_uid") or "")
        style_id = payload.get("style_id")
        asset_uid = str(payload.get("asset_uid") or "")
        return {
            "batch_id": batch_uid,
            "task_run_uid": _job_uid(job),
            "artifact_dir": str(task_dir),
            "run_params": {},
            "items": [{
                "id": str(style_id or ""),
                "style_id": style_id,
                "assets": [{
                    "id": asset_uid,
                    "kind": "ai",
                    "status": "rejected",
                    "prompt": str(payload.get("prompt_text") or ""),
                    "reference_paths": reference_paths,
                    "generation_row": dict(payload.get("generation_row") or {"完整Prompt": str(payload.get("prompt_text") or "")}),
                }],
            }],
        }

    def _submit_batch(self, job: Mapping[str, Any], submit_plan: Mapping[str, Any], task_dir: Path) -> dict:
        batch_uid = str(submit_plan.get("batch_uid") or job.get("batch_uid") or "")
        styles_by_id = {
            int(style.get("id")): style
            for style in submit_plan.get("styles") or []
            if isinstance(style, Mapping) and _positive_int(style.get("id")) > 0
        }
        source_by_style: dict[int, Mapping[str, Any]] = {}
        for asset in submit_plan.get("assets") or []:
            if not isinstance(asset, Mapping):
                continue
            kind = str(asset.get("kind") or "")
            if kind not in ("source", "origin", "main"):
                continue
            style_id = _positive_int(asset.get("style_id"))
            if style_id <= 0 or style_id in source_by_style:
                continue
            source_by_style[style_id] = asset
        items_by_style: dict[int, dict] = {}
        for asset in submit_plan.get("assets") or []:
            if not isinstance(asset, Mapping) or str(asset.get("kind") or "") != "ai":
                continue
            if str(asset.get("status") or "") != "approved":
                continue
            style_id = _positive_int(asset.get("style_id"))
            style = styles_by_id.get(style_id, {})
            local_path = self._download_asset(str(asset.get("asset_uid") or ""), task_dir / "approved")
            source_asset = source_by_style.get(style_id)
            if not source_asset:
                raise ValueError(f"approved style {style_id or 'unknown'} is missing a source asset for submit origin")
            origin_path = str(self._download_asset(str(source_asset.get("asset_uid") or ""), task_dir / "origins"))
            item = items_by_style.setdefault(style_id, {
                "id": str(style.get("style_uid") or style_id),
                "style_id": style_id,
                "style_code": str(style.get("style_code") or ""),
                "item_id": str(style.get("item_id") or ""),
                "origin_path": origin_path,
                "workflow": {
                    "row_no": style.get("row_no", ""),
                    "style_code": str(style.get("style_code") or ""),
                    "item_id": str(style.get("item_id") or ""),
                },
                "semir_data": {},
                "assets": [],
            })
            item["assets"].append({
                "id": str(asset.get("asset_uid") or ""),
                "kind": "ai",
                "status": "approved",
                "path": str(local_path),
                "filename": str(asset.get("filename") or local_path.name),
                "prompt": str(asset.get("prompt_text") or ""),
                "generation_row": dict(asset.get("meta") or {}),
            })
        return {
            "batch_id": batch_uid,
            "task_run_uid": _job_uid(job),
            "artifact_dir": str(task_dir),
            "run_params": {},
            "items": list(items_by_style.values()),
        }

    def _tmall_module(self):
        if self.tmall_module is None:
            self.tmall_module = _load_tmall_module()
        return self.tmall_module


def _load_tmall_module():
    script = Path(__file__).resolve().parents[1] / "adapters" / "tmall-ops-assistant" / "tools" / "run_tmall_ai_image_test_chain.py"
    spec = importlib.util.spec_from_file_location("cloud_tmall_ai_image_test_chain", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load Tmall cloud executor module: {script}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_maybe_async(value):
    if asyncio.iscoroutine(value):
        return asyncio.run(value)
    return value


def _payload(job: Mapping[str, Any]) -> Mapping[str, Any]:
    payload = job.get("payload")
    if not isinstance(payload, Mapping) or not payload:
        raise ValueError(f"{job.get('job_type') or 'cloud job'} payload is missing")
    return payload


def _required_text(payload: Mapping[str, Any], key: str) -> str:
    value = str(payload.get(key) or "")
    if not value:
        raise ValueError(f"cloud job payload is missing {key}")
    return value


def _job_uid(job: Mapping[str, Any]) -> str:
    return _required_text(job, "job_uid")


def _lease_id(job: Mapping[str, Any]) -> str:
    return _required_text(job, "lease_id")


def _text_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item or "")]


def _positive_int(value: Any) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 0
    return number if number > 0 else 0


def _safe_segment(value: str) -> str:
    text = str(value or "").strip().replace("\\", "/").split("/")[-1]
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in text)
    return safe.strip(".-") or "item"


def _local_file(value: Any, root: Path) -> Path:
    path = Path(str(value or ""))
    if not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("cloud job result must be a local task file")
    return path


def _safe_result_path(value: Any, root: Path) -> str:
    if not value:
        return ""
    path = Path(str(value))
    if not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
        return ""
    return str(path)


def _looks_like_login_block(message: str) -> bool:
    lowered = str(message or "").lower()
    return any(marker in lowered for marker in ("login", "登录", "cdp", "chrome", "cookie"))


def _submit_result_failed(result: Any) -> bool:
    if not isinstance(result, Mapping):
        return False
    if result.get("ok") is False:
        return True
    if _positive_int(result.get("failed")) > 0:
        return True
    return str(result.get("status") or "") in {"create_failed", "partial_failed"}


def _submit_failure_message(result: Any) -> str:
    if not isinstance(result, Mapping):
        return "tmall_submit_failed"
    status = str(result.get("status") or "tmall_submit_failed")
    failed = _positive_int(result.get("failed"))
    attempted = _positive_int(result.get("attempted"))
    parts = [status]
    if failed:
        parts.append(f"failed={failed}")
    if attempted:
        parts.append(f"attempted={attempted}")
    message = str(result.get("message") or result.get("error") or "")
    if message:
        parts.append(message)
    return "; ".join(parts)
