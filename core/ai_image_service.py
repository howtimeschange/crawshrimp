"""Local AI image workbench service helpers."""
from __future__ import annotations

import mimetypes
import re
import shutil
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.parse import urlparse
from uuid import uuid4

from core import data_sink, runtime_paths
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


def _requested_image_count(source: Mapping[str, Any], *, default: int = 1, max_count: int = 8) -> int:
    params = _params(source)
    raw = source.get("n")
    if raw is None or raw == "":
        raw = params.get("n")
    if raw is None or raw == "":
        raw = params.get("count")
    if raw is None or raw == "":
        raw = default
    try:
        count = int(float(str(raw).strip()))
    except Exception:
        count = default
    return max(1, min(int(max_count), count))


def _size_tier(size: str) -> str:
    match = re.match(r"^(\d+)x(\d+)$", _compact(size), flags=re.IGNORECASE)
    if match and max(int(match.group(1)), int(match.group(2))) > 2048:
        return "4k"
    return "2k"


def _normalize_size(size: Any, *, max_edge: int = 2048) -> str:
    value = _compact(size) or "1024x1024"
    match = re.match(r"^(\d+)x(\d+)$", value, flags=re.IGNORECASE)
    if not match:
        return value
    width = int(match.group(1))
    height = int(match.group(2))
    longest = max(width, height)
    if longest <= max_edge:
        return f"{width}x{height}"
    scale = max_edge / float(longest)
    normalized_width = max(1, int(round(width * scale)))
    normalized_height = max(1, int(round(height * scale)))
    return f"{normalized_width}x{normalized_height}"


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


def _param_input_assets(params: Mapping[str, Any]) -> list[dict[str, Any]]:
    assets: list[dict[str, Any]] = []
    main_path = _compact(params.get("main_image_path"))
    if main_path:
        assets.append({"kind": "main", "path": main_path, "sort_order": 0})
    references = params.get("reference_image_paths")
    if isinstance(references, str):
        references = [references]
    if isinstance(references, list):
        for index, path in enumerate(references, start=1):
            value = _compact(path)
            if value:
                assets.append({"kind": "reference", "path": value, "sort_order": index})
    return assets


def build_one_xm_payload(
    job: Mapping[str, Any],
    assets: list[Mapping[str, Any]] | None = None,
    *,
    file_to_data_url_fn: Callable[[str], str] = file_to_data_url,
) -> dict:
    params = _params(job)
    quality = _compact(params.get("quality") or "auto").lower()
    if quality not in {"auto", "standard", "low", "medium", "high"}:
        quality = "auto"
    payload: dict[str, Any] = {
        "model": _compact(job.get("model_key") or params.get("model") or "gpt-image-2") or "gpt-image-2",
        "prompt": _compact(job.get("prompt") or params.get("prompt")),
        "size": _normalize_size(params.get("size") or "1024x1024"),
        "quality": quality,
        "output_format": _compact(params.get("output_format") or params.get("response_format") or params.get("format") or "png") or "png",
        "n": _requested_image_count(job),
    }
    for optional_key in ("webhook_url", "webhook_secret", "mask"):
        if params.get(optional_key):
            payload[optional_key] = params.get(optional_key)

    input_assets = _param_input_assets(params) or list(assets or [])
    ordered_assets = sorted(input_assets, key=lambda item: (int(item.get("sort_order") or 0), int(item.get("id") or 0)))
    images = []
    for asset in ordered_assets:
        if _compact(asset.get("kind")).lower() != "main":
            continue
        path = _compact(asset.get("path"))
        if path:
            images.append(file_to_data_url_fn(path))
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
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 Crawshrimp/AIImageWorkbench",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
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
            _validate_downloaded_image(target)
        except Exception as exc:
            if target is not None and target.exists():
                target.unlink()
            raise DownloadOutputsError(str(exc), files) from exc
        files.append(str(target))
    return files


def _validate_downloaded_image(path: Path) -> None:
    try:
        header = path.read_bytes()[:16]
    except FileNotFoundError as exc:
        raise ValueError(f"downloaded image file is missing: {path.name}") from exc
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return
    if header.startswith(b"\xff\xd8\xff"):
        return
    if header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return
    raise ValueError(f"downloaded file is not a supported image: {path.name}")


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
        "run_uid": _compact(result.get("run_uid")),
        "model_key_tier": tier,
        "task_id": _compact(result.get("task_id")),
        "poll_url": _compact(result.get("poll_url")),
        "image_urls": [str(url) for url in result.get("image_urls") or []],
        "output_files": output_files,
        "error": _sanitize_error(result.get("error")),
        "warning": "",
        "create_attempts": int(result.get("create_attempts") or 0),
        "poll_attempts": int(result.get("poll_attempts") or 0),
        "compensation_attempts": int(result.get("compensation_attempts") or 0),
    }


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item or "").strip()]


def _append_unique(existing: list[str], additions: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in [*existing, *additions]:
        value = str(item or "").strip()
        if not value or value in seen:
            continue
        result.append(value)
        seen.add(value)
    return result


def _legacy_run_from_summary(job: Mapping[str, Any], summary: Mapping[str, Any]) -> dict | None:
    output_files = _string_list(summary.get("output_files"))
    image_urls = _string_list(summary.get("image_urls"))
    if not output_files and not image_urls:
        return None
    params = _params(job)
    return {
        "run_uid": "legacy",
        "created_at": _compact(job.get("updated_at") or job.get("created_at")),
        "prompt": _compact(job.get("prompt") or params.get("prompt")),
        "model_key": _compact(job.get("model_key") or params.get("model") or "gpt-image-2"),
        "model_key_tier": _compact(summary.get("model_key_tier")),
        "size": _compact(params.get("size")),
        "ratio": _compact(params.get("ratio")),
        "status": _compact(job.get("status") or "completed"),
        "task_id": _compact(summary.get("task_id")),
        "poll_url": _compact(summary.get("poll_url")),
        "image_urls": image_urls,
        "output_files": output_files,
        "warning": _compact(summary.get("warning")),
        "error": _compact(summary.get("error")),
    }


def _merge_run_summary(job: Mapping[str, Any], latest_summary: Mapping[str, Any], *, status: str) -> dict:
    previous_summary = job.get("summary") if isinstance(job.get("summary"), Mapping) else {}
    previous_runs = [
        dict(run)
        for run in previous_summary.get("runs") or []
        if isinstance(run, Mapping)
    ]
    if not previous_runs:
        legacy_run = _legacy_run_from_summary(job, previous_summary)
        if legacy_run:
            previous_runs.append(legacy_run)

    params = _params(job)
    output_files = _string_list(latest_summary.get("output_files"))
    image_urls = _string_list(latest_summary.get("image_urls"))
    run_record = {
        "run_uid": _compact(latest_summary.get("run_uid") or latest_summary.get("task_id")) or f"run-{len(previous_runs) + 1}",
        "created_at": _now_iso(),
        "prompt": _compact(job.get("prompt") or params.get("prompt")),
        "model_key": _compact(job.get("model_key") or params.get("model") or "gpt-image-2"),
        "model_key_tier": _compact(latest_summary.get("model_key_tier")),
        "size": _compact(params.get("size")),
        "ratio": _compact(params.get("ratio")),
        "status": status,
        "task_id": _compact(latest_summary.get("task_id")),
        "poll_url": _compact(latest_summary.get("poll_url")),
        "image_urls": image_urls,
        "output_files": output_files,
        "warning": _compact(latest_summary.get("warning")),
        "error": _compact(latest_summary.get("error")),
    }

    return {
        **dict(latest_summary),
        "image_urls": _append_unique(_string_list(previous_summary.get("image_urls")), image_urls),
        "output_files": _append_unique(_string_list(previous_summary.get("output_files")), output_files),
        "runs": [*previous_runs, run_record],
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
    requested_count = _requested_image_count(payload)

    client = OneXMImageClient(api_key, base_url=_compact(resolved_settings.get("base_url")) or DEFAULT_BASE_URL)
    run_uid = uuid4().hex
    data_sink.update_ai_image_job(job_uid, {"status": "running"})
    try:
        result = runner(
            client,
            payload,
            idempotency_key=f"ai_image_{job_uid}_{run_uid}",
            task_attempts=1,
            request_retries=3,
            request_timeout_seconds=120,
            poll_timeout_seconds=600,
        )
    except Exception as exc:
        summary = _safe_summary(
            {"ok": False, "run_uid": run_uid, "error": _sanitize_error(exc, [api_key])},
            [],
            tier,
        )
        summary = _merge_run_summary(job, summary, status="failed")
        data_sink.update_ai_image_job(job_uid, {"status": "failed", "summary": summary})
        return {"ok": False, "job_uid": job_uid, "summary": summary}

    normalized_result = dict(result or {})
    if normalized_result.get("ok"):
        normalized_result["image_urls"] = [
            str(url)
            for url in (normalized_result.get("image_urls") or [])
            if str(url or "").strip()
        ][:requested_count]

    summary = _safe_summary({**normalized_result, "run_uid": run_uid}, [], tier)
    if normalized_result.get("ok") and not summary["image_urls"]:
        summary["ok"] = False
        summary["error"] = "生成任务成功返回，但没有图片地址"
    status = "completed" if summary.get("ok") else "failed"
    summary = _merge_run_summary(job, summary, status=status)
    data_sink.update_ai_image_job(job_uid, {
        "status": status,
        "summary": summary,
    })
    return {"ok": bool(summary.get("ok")), "job_uid": job_uid, "summary": summary}


def _known_result_urls(job: Mapping[str, Any]) -> list[str]:
    summary = job.get("summary") if isinstance(job.get("summary"), Mapping) else {}
    urls = _string_list(summary.get("image_urls"))
    for run in summary.get("runs") or []:
        if isinstance(run, Mapping):
            urls.extend(_string_list(run.get("image_urls")))
    for asset in data_sink.list_ai_image_assets(_compact(job.get("job_uid"))) if job.get("job_uid") else []:
        if _compact(asset.get("kind")).lower() in {"output", "result"}:
            urls.extend(_string_list([asset.get("url")]))
    return _append_unique([], urls)


def materialize_remote_image(
    job_uid: str,
    url: str,
    *,
    allow_unlisted: bool = False,
    downloader: Callable[[str, Path], None] = _default_downloader,
) -> dict:
    job = data_sink.get_ai_image_job(job_uid)
    if not job:
        if not allow_unlisted:
            raise ValueError(f"AI image job not found: {job_uid}")
        job = {"job_uid": job_uid}
    source_url = _compact(url)
    if not source_url:
        raise ValueError("图片地址不能为空")
    if not (source_url.startswith("http://") or source_url.startswith("https://")):
        raise ValueError("仅支持物化远程图片地址")
    if not allow_unlisted and source_url not in _known_result_urls(job):
        raise ValueError("图片 URL 不属于当前任务结果")

    cache_dir = runtime_paths.child_dir("ai-image-cache")
    suffix = _extension_from_url(source_url)
    target = _unique_path(cache_dir / f"result-{_compact(job_uid)[:8] or 'job'}-{uuid4().hex[:8]}{suffix}")
    try:
        downloader(source_url, target)
        _validate_downloaded_image(target)
    except Exception:
        if target.exists():
            target.unlink()
        raise
    return {"ok": True, "job_uid": job_uid, "url": source_url, "path": str(target)}


def copy_assets_to_directory(
    assets: list[Mapping[str, Any]],
    directory: str | Path,
    *,
    downloader: Callable[[str, Path], None] = _default_downloader,
) -> list[str]:
    target_dir = Path(directory).expanduser()
    target_dir.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    for asset in assets or []:
        source_url = _compact(asset.get("url"))
        source_path = _compact(asset.get("path"))
        if source_url.startswith("http://") or source_url.startswith("https://"):
            suffix = _extension_from_url(source_url)
            target = _unique_path(target_dir / f"result-{len(copied) + 1:02d}{suffix}")
            downloader(source_url, target)
            copied.append(str(target))
            continue
        source = Path(source_path).expanduser()
        if not source_path or not source.is_file():
            continue
        target = _unique_path(target_dir / source.name)
        shutil.copy2(source, target)
        copied.append(str(target))
    return copied
