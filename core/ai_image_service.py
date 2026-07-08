"""Local AI image workbench service helpers."""
from __future__ import annotations

import mimetypes
import re
import shutil
import urllib.request
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.parse import urlparse

from core import data_sink
from core.one_xm_image import DEFAULT_BASE_URL, OneXMImageClient, file_to_data_url, run_image_task_until_done


GPT_2K_CONFIG_ID = "ai.1xm.gpt_image_2k_key"
GPT_4K_CONFIG_ID = "ai.1xm.gpt_image_4k_key"
GEMINI_FLASH_CONFIG_ID = "ai.1xm.gemini_3_1_flash_image_preview_key"
GEMINI_PRO_CONFIG_ID = "ai.1xm.gemini_3_pro_image_preview_key"


class MissingModelKeyError(ValueError):
    def __init__(self, message: str, *, config_id: str):
        super().__init__(message)
        self.config_id = config_id


class DownloadOutputsError(RuntimeError):
    def __init__(self, message: str, output_files: list[str]):
        super().__init__(message)
        self.output_files = output_files


def _compact(value: Any) -> str:
    return str(value or "").strip()


def default_output_dir(job: Mapping[str, Any]) -> Path:
    output_dir = _compact(job.get("output_dir"))
    if output_dir:
        return Path(output_dir).expanduser()
    return Path.home() / "Downloads" / "抓虾导出" / "AI生图"


def _params(job: Mapping[str, Any]) -> dict:
    value = job.get("params")
    return dict(value) if isinstance(value, Mapping) else {}


def _size_tier(size: str) -> str:
    match = re.match(r"^(\d+)x(\d+)$", _compact(size), flags=re.IGNORECASE)
    if match and max(int(match.group(1)), int(match.group(2))) > 2048:
        return "4k"
    return "2k"


def _settings_value(settings: Mapping[str, Any], config_id: str, alias: str = "") -> str:
    return _compact(settings.get(config_id) or (settings.get(alias) if alias else ""))


def select_model_key(job_or_params: Mapping[str, Any], settings: Mapping[str, Any]) -> tuple[str, str]:
    params = _params(job_or_params)
    model = _compact(job_or_params.get("model_key") or params.get("model") or params.get("model_key") or "gpt-image-2")
    if model == "gemini-3.1-flash-image-preview":
        key = _settings_value(settings, GEMINI_FLASH_CONFIG_ID)
        if not key:
            raise MissingModelKeyError(
                f"设置菜单未配置 1XM 图片模型 API Key: {GEMINI_FLASH_CONFIG_ID}",
                config_id=GEMINI_FLASH_CONFIG_ID,
            )
        return GEMINI_FLASH_CONFIG_ID, key
    if model == "gemini-3-pro-image-preview":
        key = _settings_value(settings, GEMINI_PRO_CONFIG_ID)
        if not key:
            raise MissingModelKeyError(
                f"设置菜单未配置 1XM 图片模型 API Key: {GEMINI_PRO_CONFIG_ID}",
                config_id=GEMINI_PRO_CONFIG_ID,
            )
        return GEMINI_PRO_CONFIG_ID, key
    explicit = _compact(job_or_params.get("model_key_tier") or params.get("model_key_tier") or params.get("key_tier")).lower()
    tier = explicit if explicit in {"2k", "4k"} else _size_tier(_compact(job_or_params.get("size") or params.get("size")))
    config_id = GPT_4K_CONFIG_ID if tier == "4k" else GPT_2K_CONFIG_ID
    key = _settings_value(settings, config_id, tier)
    if not key:
        raise MissingModelKeyError(
            f"设置菜单未配置 1XM 图片模型 API Key: {config_id} (1XM GPT Image {tier.upper()} Key)",
            config_id=config_id,
        )
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
    files: list[str] = []
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        raise DownloadOutputsError(str(exc), files) from exc
    for index, url in enumerate(image_urls, start=1):
        suffix = _extension_from_url(url)
        target: Path | None = None
        try:
            target = _unique_path(output_dir / f"result-{index:02d}{suffix}")
            downloader(url, target)
        except Exception as exc:
            if target is not None and target.exists():
                target.unlink()
            raise DownloadOutputsError(str(exc), files) from exc
        files.append(str(target))
    return files


def _unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    for index in range(1, 10_000):
        candidate = path.with_name(f"{path.stem}-{index}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"Cannot allocate unique file name for {path.name}")


def _sanitize_error(value: Any, secrets: list[str] | None = None) -> str:
    text = _compact(value)
    for secret in secrets or []:
        if secret:
            text = text.replace(secret, "[redacted]")
    text = re.sub(r"data:image/[^,\s]+,[^\s]+", "[data-url-redacted]", text, flags=re.IGNORECASE)
    text = re.sub(r"(?i)api[_-]?key\s*=\s*[^\s,;]+", "[api-key-redacted]", text)
    text = re.sub(r"(?i)webhook[_-]?secret\s*=\s*[^\s,;]+", "[webhook-secret-redacted]", text)
    text = re.sub(r"(?i)webhook[_-]?secret", "webhook-secret-redacted", text)
    return text[:500]


def _safe_summary(result: Mapping[str, Any], output_files: list[str], tier: str) -> dict:
    return {
        "ok": bool(result.get("ok")),
        "model_key_tier": tier,
        "task_id": _compact(result.get("task_id")),
        "poll_url": _compact(result.get("poll_url")),
        "image_urls": [str(url) for url in result.get("image_urls") or []],
        "output_files": output_files,
        "error": _sanitize_error(result.get("error")),
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
    try:
        result = runner(
            client,
            payload,
            idempotency_key=f"ai_image_{job_uid}",
            task_attempts=1,
            request_retries=3,
            request_timeout_seconds=120,
            poll_timeout_seconds=600,
        )
    except Exception as exc:
        summary = _safe_summary(
            {"ok": False, "error": _sanitize_error(exc, [api_key])},
            [],
            tier,
        )
        data_sink.update_ai_image_job(job_uid, {"status": "failed", "summary": summary})
        return {"ok": False, "job_uid": job_uid, "summary": summary}

    output_files: list[str] = []
    download_error = ""
    if result.get("ok"):
        try:
            output_files = _download_outputs([str(url) for url in result.get("image_urls") or []], default_output_dir(job), downloader)
        except DownloadOutputsError as exc:
            output_files = exc.output_files
            download_error = _sanitize_error(exc, [api_key])
    summary = _safe_summary(result, output_files, tier)
    if download_error:
        summary["ok"] = False
        summary["error"] = download_error
    data_sink.update_ai_image_job(job_uid, {
        "status": ("partial_failed" if output_files else "failed") if download_error else ("completed" if result.get("ok") else "failed"),
        "summary": summary,
    })
    return {"ok": bool(result.get("ok")) and not download_error, "job_uid": job_uid, "summary": summary}


def copy_assets_to_directory(assets: list[Mapping[str, Any]], directory: str | Path) -> list[str]:
    target_dir = Path(directory).expanduser()
    target_dir.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    for asset in assets or []:
        source = Path(_compact(asset.get("path"))).expanduser()
        if not source.is_file():
            continue
        target = _unique_path(target_dir / source.name)
        shutil.copy2(source, target)
        copied.append(str(target))
    return copied
