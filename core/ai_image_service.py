"""Local AI image workbench service helpers."""
from __future__ import annotations

import mimetypes
import re
import shutil
import urllib.request
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.parse import urlparse

from core import data_sink, runtime_paths
from core.one_xm_image import DEFAULT_BASE_URL, OneXMImageClient, file_to_data_url, run_image_task_until_done


def _compact(value: Any) -> str:
    return str(value or "").strip()


def default_output_dir(job: Mapping[str, Any]) -> Path:
    job_uid = _compact(job.get("job_uid")) or "unassigned"
    return runtime_paths.data_root() / "ai-image" / "jobs" / job_uid


def _params(job: Mapping[str, Any]) -> dict:
    value = job.get("params")
    return dict(value) if isinstance(value, Mapping) else {}


def _size_tier(size: str) -> str:
    match = re.match(r"^(\d+)x(\d+)$", _compact(size), flags=re.IGNORECASE)
    if match and max(int(match.group(1)), int(match.group(2))) > 2048:
        return "4k"
    return "2k"


def select_model_key(job_or_params: Mapping[str, Any], settings: Mapping[str, Any]) -> tuple[str, str]:
    params = _params(job_or_params)
    explicit = _compact(job_or_params.get("model_key_tier") or params.get("model_key_tier") or params.get("key_tier")).lower()
    tier = explicit if explicit in {"2k", "4k"} else _size_tier(_compact(job_or_params.get("size") or params.get("size")))
    key = _compact(settings.get(tier))
    if not key:
        raise ValueError(f"设置菜单未配置 1XM GPT Image {tier.upper()} Key")
    return tier, key


def build_one_xm_payload(
    job: Mapping[str, Any],
    assets: list[Mapping[str, Any]] | None = None,
    *,
    file_to_data_url_fn: Callable[[str], str] = file_to_data_url,
) -> dict:
    params = _params(job)
    quality = _compact(params.get("quality") or "auto").lower()
    if quality not in {"auto", "low", "medium", "high"}:
        quality = "auto"
    payload: dict[str, Any] = {
        "model": _compact(job.get("model_key") or params.get("model") or "gpt-image-2") or "gpt-image-2",
        "prompt": _compact(job.get("prompt") or params.get("prompt")),
        "size": _compact(params.get("size") or "1024x1024") or "1024x1024",
        "quality": quality,
        "output_format": _compact(params.get("output_format") or params.get("format") or "png") or "png",
        "n": int(params.get("n") or 1),
    }
    for optional_key in ("webhook_url", "webhook_secret", "mask"):
        if params.get(optional_key):
            payload[optional_key] = params.get(optional_key)

    ordered_assets = sorted(list(assets or []), key=lambda item: (int(item.get("sort_order") or 0), int(item.get("id") or 0)))
    images = []
    for asset in ordered_assets:
        if _compact(asset.get("kind")).lower() != "reference":
            continue
        path = _compact(asset.get("path"))
        if path:
            images.append(file_to_data_url_fn(path))
    if images:
        payload["image"] = images[:10]
    return payload


def _default_downloader(url: str, target: Path) -> None:
    with urllib.request.urlopen(url, timeout=60) as response:
        target.write_bytes(response.read())


def _extension_from_url(url: str, fallback: str = ".png") -> str:
    suffix = Path(urlparse(url).path).suffix.lower()
    if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
        return suffix
    guessed = mimetypes.guess_extension(mimetypes.guess_type(url)[0] or "")
    return guessed if guessed in {".png", ".jpg", ".jpeg", ".webp"} else fallback


def _download_outputs(image_urls: list[str], output_dir: Path, downloader: Callable[[str, Path], None]) -> list[str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    files: list[str] = []
    for index, url in enumerate(image_urls, start=1):
        suffix = _extension_from_url(url)
        target = output_dir / f"result-{index:02d}{suffix}"
        downloader(url, target)
        files.append(str(target))
    return files


def _safe_summary(result: Mapping[str, Any], output_files: list[str], tier: str) -> dict:
    return {
        "ok": bool(result.get("ok")),
        "model_key_tier": tier,
        "task_id": _compact(result.get("task_id")),
        "poll_url": _compact(result.get("poll_url")),
        "image_urls": [str(url) for url in result.get("image_urls") or []],
        "output_files": output_files,
        "error": _compact(result.get("error")),
        "create_attempts": int(result.get("create_attempts") or 0),
        "poll_attempts": int(result.get("poll_attempts") or 0),
        "compensation_attempts": int(result.get("compensation_attempts") or 0),
    }


def run_job_with_one_xm(
    job_uid: str,
    *,
    settings: Mapping[str, Any] | None = None,
    runner: Callable[..., dict[str, Any]] = run_image_task_until_done,
    downloader: Callable[[str, Path], None] = _default_downloader,
    file_to_data_url_fn: Callable[[str], str] = file_to_data_url,
) -> dict:
    job = data_sink.get_ai_image_job(job_uid)
    if not job:
        raise ValueError(f"AI image job not found: {job_uid}")
    resolved_settings = dict(settings or {})
    if not resolved_settings:
        from core.api_server import _resolve_one_xm_settings

        resolved_settings = _resolve_one_xm_settings()
    tier, api_key = select_model_key(job, resolved_settings)
    assets = data_sink.list_ai_image_assets(job_uid)
    payload = build_one_xm_payload(job, assets, file_to_data_url_fn=file_to_data_url_fn)
    if not payload.get("prompt"):
        raise ValueError("AI image job prompt is required")

    client = OneXMImageClient(api_key, base_url=_compact(resolved_settings.get("base_url")) or DEFAULT_BASE_URL)
    data_sink.update_ai_image_job(job_uid, {"status": "running"})
    result = runner(
        client,
        payload,
        idempotency_key=f"ai_image_{job_uid}",
        task_attempts=1,
        request_retries=3,
        request_timeout_seconds=120,
        poll_timeout_seconds=600,
    )
    output_files: list[str] = []
    if result.get("ok"):
        output_files = _download_outputs([str(url) for url in result.get("image_urls") or []], default_output_dir(job), downloader)
    summary = _safe_summary(result, output_files, tier)
    data_sink.update_ai_image_job(job_uid, {
        "status": "completed" if result.get("ok") else "failed",
        "summary": summary,
    })
    return {"ok": bool(result.get("ok")), "job_uid": job_uid, "summary": summary}


def copy_assets_to_directory(assets: list[Mapping[str, Any]], directory: str | Path) -> list[str]:
    target_dir = Path(directory).expanduser()
    target_dir.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    for asset in assets or []:
        source = Path(_compact(asset.get("path"))).expanduser()
        if not source.is_file():
            continue
        target = target_dir / source.name
        if target.exists():
            target = target_dir / f"{source.stem}-{len(copied) + 1}{source.suffix}"
        shutil.copy2(source, target)
        copied.append(str(target))
    return copied
