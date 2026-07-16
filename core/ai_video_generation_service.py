"""AI video generation workbench: validation, provider adapters, worker."""
from __future__ import annotations

import hashlib
import json
import logging
import mimetypes
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Mapping, Optional
from uuid import uuid4

from core import data_sink, runtime_paths
from core.config import load_config
from core.one_xm_image import file_to_data_url

logger = logging.getLogger(__name__)

PUBLIC_STATUSES = frozenset({
    "draft",
    "queued",
    "running",
    "downloading",
    "completed",
    "needs_config",
    "failed",
    "cancelled",
    "expired",
})
EDITABLE_STATUSES = frozenset({"draft", "needs_config", "failed", "expired"})
ACTIVE_STATUSES = frozenset({"queued", "running", "downloading"})
DELETE_BLOCKED_STATUSES = frozenset({"queued", "running", "downloading"})

SEEDANCE_MODEL = "doubao-seedance-2-0-260128"
HAPPYHORSE_MODELS = {
    "happyhorse-1.1-t2v": "t2v",
    "happyhorse-1.1-i2v": "i2v",
    "happyhorse-1.1-r2v": "r2v",
}
UI_MODEL_IDS = {
    "seedance-2.0": {"provider": "seedance", "model": SEEDANCE_MODEL},
    "happyhorse-1.1-t2v": {"provider": "happyhorse", "model": "happyhorse-1.1-t2v"},
    "happyhorse-1.1-i2v": {"provider": "happyhorse", "model": "happyhorse-1.1-i2v"},
    "happyhorse-1.1-r2v": {"provider": "happyhorse", "model": "happyhorse-1.1-r2v"},
}
SEEDANCE_RATIOS = frozenset({"16:9", "9:16", "1:1", "3:4", "4:3", "21:9", "adaptive"})
HAPPYHORSE_RATIOS = frozenset({"16:9", "9:16", "1:1", "4:3", "3:4", "4:5", "5:4", "9:21", "21:9"})
ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
HIDDEN_REQUEST_FIELDS = frozenset({
    "seed",
    "raw",
    "rawJson",
    "raw_json",
    "priority",
    "tools",
    "safety_identifier",
    "safetyIdentifier",
    "api_key",
    "apiKey",
    "endpoint",
    "poll_interval",
    "pollInterval",
    "timeout",
    "workspace_id",
    "workspaceId",
})

DEFAULT_OUTPUT_DIR_NAME = "抓虾AI生视频"
POLL_INTERVAL_SECONDS = 5.0
POLL_TIMEOUT_SECONDS = 30 * 60
SUBMIT_TIMEOUT_SECONDS = 120
CLI_ROOT = Path(__file__).resolve().parents[1] / "integrations"
SEEDANCE_CLI_DIR = CLI_ROOT / "seedanceCLI"
BAILIAN_CLI_DIR = CLI_ROOT / "bailianCLI"

_WORKER_LOCK = threading.RLock()
_WORKER_THREAD: Optional[threading.Thread] = None
_WORKER_STOP = threading.Event()
_RUN_LOCKS: dict[str, threading.RLock] = {}
_RUN_LOCKS_GUARD = threading.Lock()
_CLI_RUNNER: Optional[Callable[..., dict]] = None
_DOWNLOADER: Optional[Callable[..., Path]] = None


class AiVideoError(Exception):
    def __init__(
        self,
        message: str,
        *,
        code: str = "VALIDATION_FAILED",
        retryable: bool = False,
        safe_suggestion: str = "",
        provider_code: str = "",
        provider_message: str = "",
        http_status: int = 400,
    ):
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.safe_suggestion = safe_suggestion or message
        self.provider_code = provider_code
        self.provider_message = provider_message
        self.http_status = http_status

    def as_dict(self) -> dict:
        return {
            "code": self.code,
            "message": str(self),
            "providerCode": self.provider_code or None,
            "providerMessage": self.provider_message or None,
            "retryable": bool(self.retryable),
            "safeSuggestion": self.safe_suggestion,
            "occurredAt": _now_iso(),
        }


def _compact(value: Any) -> str:
    return str(value or "").strip()


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _nested_config_value(cfg: Mapping[str, Any], dotted: str) -> Any:
    current: Any = cfg
    for part in dotted.split("."):
        if not isinstance(current, Mapping):
            return None
        current = current.get(part)
    return current


def default_output_dir() -> Path:
    return Path.home() / "Downloads" / DEFAULT_OUTPUT_DIR_NAME


def expand_output_dir(raw: Any) -> Path:
    value = _compact(raw)
    if not value:
        return default_output_dir()
    return Path(value).expanduser().resolve()


def safety_identifier() -> str:
    seed = f"{os.uname().nodename if hasattr(os, 'uname') else 'host'}:{Path.home()}:crawshrimp-ai-video"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:32]


def redact_text(text: Any, secret_values: Optional[list[str]] = None) -> str:
    sanitized = str(text or "")
    home = str(Path.home())
    if home:
        sanitized = sanitized.replace(home, "~")
    for secret in secret_values or []:
        if secret:
            sanitized = sanitized.replace(secret, "[redacted]")
    sanitized = re.sub(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+", r"\1[redacted]", sanitized)
    sanitized = re.sub(
        r"(?i)((?:api[_ -]?key|authorization|ark_api_key|dashscope_api_key)\s*[:=]\s*)[^\s,;\"']+",
        r"\1[redacted]",
        sanitized,
    )
    sanitized = re.sub(
        r"(https?://[^\s\"']+\?)([^\s\"']+)",
        lambda m: m.group(1) + "redacted=1",
        sanitized,
    )
    return sanitized


def redact_obj(value: Any, secret_values: Optional[list[str]] = None) -> Any:
    if isinstance(value, Mapping):
        result = {}
        for key, item in value.items():
            key_text = str(key)
            if any(token in key_text.lower() for token in ("api_key", "authorization", "token", "secret")):
                result[key] = "[redacted]"
            elif key_text.lower() in {"video_url", "url"} and isinstance(item, str) and item.startswith("http"):
                result[key] = "[redacted-url]"
            else:
                result[key] = redact_obj(item, secret_values)
        return result
    if isinstance(value, list):
        return [redact_obj(item, secret_values) for item in value]
    if isinstance(value, str):
        return redact_text(value, secret_values)
    return value


def provider_secrets() -> dict[str, str]:
    cfg = load_config()
    return {
        "seedance": _compact(_nested_config_value(cfg, "ai.video.seedance_api_key")),
        "happyhorse": _compact(_nested_config_value(cfg, "ai.video.bailian_api_key")),
    }


def provider_status() -> dict:
    cfg = load_config()
    secrets = provider_secrets()

    def source_for(key: str) -> str:
        return "AI 能力" if _compact(_nested_config_value(cfg, key)) else "未配置"

    return {
        "seedance": {
            "configured": bool(secrets["seedance"]),
            "source": source_for("ai.video.seedance_api_key"),
            "cliReady": (SEEDANCE_CLI_DIR / "bin" / "seedance.js").is_file(),
        },
        "happyhorse": {
            "configured": bool(secrets["happyhorse"]),
            "source": source_for("ai.video.bailian_api_key"),
            "cliReady": (BAILIAN_CLI_DIR / "bin" / "bailian.js").is_file(),
        },
    }


def provider_env(provider: str) -> tuple[dict[str, str], list[str]]:
    cfg = load_config()
    secrets = provider_secrets()
    env = dict(os.environ)
    env.pop("ELECTRON_RUN_AS_NODE", None)
    for name in ("ARK_API_KEY", "VOLCENGINE_ARK_API_KEY", "DASHSCOPE_API_KEY", "BAILIAN_API_KEY"):
        env.pop(name, None)
    secret_values = [value for value in secrets.values() if value]
    if provider == "seedance":
        if secrets["seedance"]:
            env["ARK_API_KEY"] = secrets["seedance"]
        base_url = _compact(_nested_config_value(cfg, "ai.video.seedance_base_url"))
        if base_url:
            env["ARK_BASE_URL"] = base_url
    elif provider == "happyhorse":
        if secrets["happyhorse"]:
            env["DASHSCOPE_API_KEY"] = secrets["happyhorse"]
        for env_name, config_key in (
            ("BAILIAN_WORKSPACE_ID", "ai.video.bailian_workspace_id"),
            ("BAILIAN_REGION", "ai.video.bailian_region"),
            ("BAILIAN_BASE_URL", "ai.video.bailian_base_url"),
        ):
            value = _compact(_nested_config_value(cfg, config_key))
            if value:
                env[env_name] = value
    return env, secret_values


def node_runtime() -> tuple[str, dict[str, str]]:
    bundled = _compact(os.environ.get("CRAWSHRIMP_NODE_EXECUTABLE"))
    if bundled:
        return bundled, {"ELECTRON_RUN_AS_NODE": "1"}
    return shutil.which("node") or "node", {}


def parse_cli_json_objects(text: str) -> list[dict]:
    decoder = json.JSONDecoder()
    index = 0
    objects: list[dict] = []
    source = str(text or "")
    while index < len(source):
        brace = source.find("{", index)
        if brace < 0:
            break
        try:
            value, end = decoder.raw_decode(source[brace:])
        except json.JSONDecodeError:
            index = brace + 1
            continue
        if isinstance(value, dict):
            objects.append(value)
        index = brace + end
    return objects


def set_cli_runner(runner: Optional[Callable[..., dict]]) -> None:
    global _CLI_RUNNER
    _CLI_RUNNER = runner


def set_downloader(downloader: Optional[Callable[..., Path]]) -> None:
    global _DOWNLOADER
    _DOWNLOADER = downloader


def _run_cli(
    *,
    provider: str,
    args: list[str],
    cwd: Path,
    timeout_seconds: float = SUBMIT_TIMEOUT_SECONDS,
) -> dict:
    if _CLI_RUNNER is not None:
        return _CLI_RUNNER(provider=provider, args=args, cwd=str(cwd), timeout_seconds=timeout_seconds)

    node_executable, node_env = node_runtime()
    env, secret_values = provider_env(provider)
    env.update(node_env)
    command = [node_executable, *args]
    try:
        completed = subprocess.run(
            command,
            cwd=str(cwd),
            env=env,
            capture_output=True,
            text=True,
            timeout=max(1.0, float(timeout_seconds)),
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise AiVideoError(
            f"{provider} CLI 执行超时",
            code="PROVIDER_TIMEOUT",
            retryable=True,
            safe_suggestion="稍后可复制为新任务或等待后重试",
            http_status=504,
        ) from exc
    stdout = completed.stdout or ""
    stderr = completed.stderr or ""
    objects = parse_cli_json_objects(stdout)
    if completed.returncode != 0:
        detail = redact_text((stderr or stdout).strip() or f"{provider} CLI failed", secret_values)
        code, mapped = map_provider_error(provider, detail)
        raise AiVideoError(
            mapped or detail,
            code=code,
            retryable=code in {"PROVIDER_TIMEOUT", "PROVIDER_REJECTED"},
            provider_message=detail,
            safe_suggestion=_safe_suggestion_for(code),
            http_status=500,
        )
    return {
        "objects": objects,
        "stdout": redact_text(stdout, secret_values),
        "stderr": redact_text(stderr, secret_values),
        "returncode": completed.returncode,
        "secret_values": secret_values,
    }


def map_provider_error(provider: str, text: str) -> tuple[str, str]:
    raw = str(text or "")
    if "ModelNotOpen" in raw:
        return "NEEDS_CONFIG", "模型未开通，请到设置或方舟控制台开通后重试"
    if "SetLimitExceeded" in raw:
        return "PROVIDER_REJECTED", "额度或推理限制已触发，请稍后重试"
    if "PrivacyInformation" in raw or "InputImageSensitiveContentDetected" in raw:
        return "PRIVACY_BLOCKED", "触发隐私保护拦截，请改用商品图和原创虚构人物描述"
    if "PolicyViolation" in raw or "OutputVideoSensitiveContentDetected" in raw:
        return "PROVIDER_REJECTED", "输出策略拦截，请调整 Prompt 或素材后重试"
    if "api key" in raw.lower() or "not configured" in raw.lower() or "Missing required env" in raw:
        return "CREDENTIAL_MISSING", "请先在设置中的 AI 能力配置对应密钥"
    if provider == "happyhorse":
        return "PROVIDER_REJECTED", f"百炼返回失败：{raw[:240]}"
    return "PROVIDER_REJECTED", raw[:240] or "provider 拒绝请求"


def _safe_suggestion_for(code: str) -> str:
    return {
        "VALIDATION_FAILED": "按提示修改 Prompt、图片或参数后重新提交",
        "CREDENTIAL_MISSING": "到设置中的 AI 能力配置对应密钥",
        "NEEDS_CONFIG": "配置后可继续提交当前 Job",
        "UNKNOWN_SUBMIT_RESULT": "为避免重复扣费，本次不会自动重提；请确认后复制为新任务",
        "PROVIDER_REJECTED": "查看原因后调整素材或 Prompt",
        "PRIVACY_BLOCKED": "不绕过平台保护，可改用商品图和原创人物描述重试",
        "PROVIDER_TIMEOUT": "可稍后恢复查询或复制为新任务",
        "DOWNLOAD_FAILED": "当前视频待归档，可点击重新归档",
        "ARCHIVE_WRITE_FAILED": "重新选择有写入权限的输出目录",
    }.get(code, "请根据提示处理后重试")


def resolve_model(provider: str, model: str) -> tuple[str, str]:
    provider_value = _compact(provider).lower()
    model_value = _compact(model)
    if model_value in UI_MODEL_IDS:
        meta = UI_MODEL_IDS[model_value]
        return meta["provider"], meta["model"]
    if provider_value == "seedance":
        return "seedance", model_value or SEEDANCE_MODEL
    if provider_value == "happyhorse":
        if model_value not in HAPPYHORSE_MODELS:
            raise AiVideoError("HappyHorse 模型必须是 happyhorse-1.1-t2v/i2v/r2v")
        return "happyhorse", model_value
    if model_value == SEEDANCE_MODEL:
        return "seedance", SEEDANCE_MODEL
    raise AiVideoError("不支持的 provider 或 model")


def model_short(model: str) -> str:
    value = _compact(model)
    if value == SEEDANCE_MODEL:
        return "seedance2"
    if value.startswith("happyhorse-"):
        return value.replace("happyhorse-", "hh-")
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value)[:24] or "model"


def job_title_from_prompt(prompt: str) -> str:
    text = re.sub(r"\s+", " ", _compact(prompt))
    head = text[:24] if text else "未命名视频"
    return f"{head} · {datetime.now().strftime('%m-%d %H:%M')}"


def _inspect_image(path: Path) -> dict:
    if not path.is_file():
        raise AiVideoError(f"参考图片不存在：{path}")
    if path.suffix.lower() not in ALLOWED_IMAGE_EXTS:
        raise AiVideoError("图片格式仅允许 JPEG、JPG、PNG、WEBP")
    size = path.stat().st_size
    if size > 20 * 1024 * 1024:
        raise AiVideoError("单图大小不能超过 20MB")
    mime = mimetypes.guess_type(str(path))[0] or ""
    if path.suffix.lower() in {".jpg", ".jpeg"}:
        mime = "image/jpeg"
    elif path.suffix.lower() == ".png":
        mime = "image/png"
    elif path.suffix.lower() == ".webp":
        mime = "image/webp"
    if mime not in ALLOWED_MIME:
        raise AiVideoError("图片格式仅允许 JPEG、JPG、PNG、WEBP")
    width = 0
    height = 0
    try:
        from PIL import Image

        with Image.open(path) as image:
            width, height = image.size
            image.verify()
    except Exception as exc:
        raise AiVideoError(f"参考文件不是有效图片：{path.name}") from exc
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return {
        "kind": "image",
        "sourceType": "local_file",
        "originalName": path.name,
        "localPath": str(path.resolve()),
        "mimeType": mime,
        "width": int(width),
        "height": int(height),
        "sizeBytes": int(size),
        "sha256": digest,
    }


def _reject_hidden_fields(parameters: Mapping[str, Any]) -> None:
    for key in parameters.keys():
        if str(key) in HIDDEN_REQUEST_FIELDS:
            raise AiVideoError(f"不允许提交隐藏字段：{key}")


def normalize_parameters(provider: str, model: str, parameters: Optional[Mapping[str, Any]]) -> dict:
    source = dict(parameters or {})
    _reject_hidden_fields(source)
    if provider == "seedance":
        ratio = _compact(source.get("ratio")) or "9:16"
        if ratio not in SEEDANCE_RATIOS:
            raise AiVideoError("Seedance ratio 不在允许枚举内")
        resolution = _compact(source.get("resolution")) or "720p"
        if resolution not in {"480p", "720p", "1080p"}:
            raise AiVideoError("Seedance resolution 仅支持 480p/720p/1080p")
        try:
            duration = int(source.get("duration") if source.get("duration") is not None else 5)
        except Exception as exc:
            raise AiVideoError("duration 必须是整数") from exc
        if not 4 <= duration <= 15:
            raise AiVideoError("Seedance duration 必须是 4-15 的整数")
        generate_audio = source.get("generateAudio")
        if generate_audio is None:
            generate_audio = source.get("generate_audio", True)
        return {
            "ratio": ratio,
            "resolution": resolution,
            "duration": duration,
            "watermark": bool(source.get("watermark", False)),
            "generateAudio": bool(generate_audio),
        }

    mode = HAPPYHORSE_MODELS.get(model)
    if not mode:
        raise AiVideoError("未知 HappyHorse 模型")
    resolution = _compact(source.get("resolution")) or "720P"
    resolution = resolution.upper()
    if resolution not in {"720P", "1080P"}:
        raise AiVideoError("HappyHorse resolution 仅支持 720P/1080P")
    try:
        duration = int(source.get("duration") if source.get("duration") is not None else 5)
    except Exception as exc:
        raise AiVideoError("duration 必须是整数") from exc
    if not 3 <= duration <= 15:
        raise AiVideoError("HappyHorse duration 必须是 3-15 的整数")
    params = {
        "resolution": resolution,
        "duration": duration,
        "watermark": bool(source.get("watermark", False)),
    }
    if mode != "i2v":
        default_ratio = "16:9" if mode == "t2v" else "9:16"
        ratio = _compact(source.get("ratio")) or default_ratio
        if ratio not in HAPPYHORSE_RATIOS:
            raise AiVideoError("HappyHorse ratio 不在允许枚举内")
        params["ratio"] = ratio
    elif "ratio" in source and _compact(source.get("ratio")):
        raise AiVideoError("HappyHorse I2V 不允许提交 ratio")
    return params


def validate_input(payload: Mapping[str, Any]) -> dict:
    provider, model = resolve_model(payload.get("provider"), payload.get("model"))
    prompt = _compact(payload.get("prompt"))
    if not prompt:
        raise AiVideoError("Prompt 不能为空")
    if len(prompt) > 4000:
        raise AiVideoError("Prompt 不能超过 4000 字符")
    parameters = normalize_parameters(provider, model, payload.get("parameters") if isinstance(payload.get("parameters"), Mapping) else {})
    output_dir = expand_output_dir(payload.get("outputDir") or payload.get("output_dir"))
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        raise AiVideoError(
            "输出目录不可写",
            code="ARCHIVE_WRITE_FAILED",
            safe_suggestion="重新选择有写入权限的输出目录",
        ) from exc
    if not os.access(output_dir, os.W_OK):
        raise AiVideoError(
            "输出目录不可写",
            code="ARCHIVE_WRITE_FAILED",
            safe_suggestion="重新选择有写入权限的输出目录",
        )

    asset_inputs = list(payload.get("assets") or [])
    assets: list[dict] = []
    for index, item in enumerate(asset_inputs):
        source = dict(item or {})
        path_value = _compact(source.get("localPath") or source.get("local_path") or source.get("fileToken") or source.get("path"))
        if not path_value:
            raise AiVideoError("参考图路径不能为空")
        path = Path(path_value).expanduser()
        inspected = _inspect_image(path)
        role = _compact(source.get("role")) or ("first_frame" if model.endswith("-i2v") else "reference_image")
        if model.endswith("-i2v"):
            role = "first_frame"
        inspected.update({
            "role": role,
            "sortOrder": int(source.get("sortOrder") if source.get("sortOrder") is not None else index),
        })
        assets.append(inspected)

    if provider == "seedance":
        if len(assets) > 4:
            raise AiVideoError("Seedance v1 参考图最多 4 张")
    elif model.endswith("-t2v"):
        if assets:
            raise AiVideoError("HappyHorse 文生视频不允许携带图片")
    elif model.endswith("-i2v"):
        if len(assets) != 1:
            raise AiVideoError("HappyHorse 图生视频必须且只能 1 张图片")
        asset = assets[0]
        if asset["width"] < 300 or asset["height"] < 300:
            raise AiVideoError("HappyHorse I2V 图片宽高均不小于 300px")
        ratio = max(asset["width"], asset["height"]) / float(min(asset["width"], asset["height"]) or 1)
        if ratio > 2.5:
            raise AiVideoError("HappyHorse I2V 宽高比必须在 1:2.5 到 2.5:1 之间")
    elif model.endswith("-r2v"):
        if not 1 <= len(assets) <= 9:
            raise AiVideoError("HappyHorse 参考生视频需要 1-9 张图片")
        for asset in assets:
            if min(asset["width"], asset["height"]) < 400:
                raise AiVideoError("HappyHorse R2V 每张图片短边不低于 400px")

    warnings: list[str] = []
    if model.endswith("-r2v") and not re.search(r"\[Image\s*\d+\]", prompt, flags=re.I):
        warnings.append("建议在 Prompt 中使用 [Image 1]、[Image 2] 引用参考图")

    status = provider_status()
    configured = bool(status.get(provider, {}).get("configured"))
    cli_ready = bool(status.get(provider, {}).get("cliReady"))
    return {
        "ok": True,
        "provider": provider,
        "model": model,
        "prompt": prompt,
        "parameters": parameters,
        "assets": assets,
        "outputDir": str(output_dir),
        "configured": configured,
        "cliReady": cli_ready,
        "warnings": warnings,
        "needsConfig": not (configured and cli_ready),
    }


def build_seedance_payload(normalized: Mapping[str, Any]) -> dict:
    content: list[dict] = [{"type": "text", "text": normalized["prompt"]}]
    for asset in normalized.get("assets") or []:
        path = _compact(asset.get("localPath"))
        if not path:
            continue
        content.append({
            "type": "image_url",
            "image_url": {"url": file_to_data_url(path)},
            "role": "reference_image",
        })
    params = normalized["parameters"]
    return {
        "model": SEEDANCE_MODEL,
        "content": content,
        "generate_audio": bool(params.get("generateAudio", True)),
        "ratio": params.get("ratio") or "9:16",
        "duration": int(params.get("duration") or 5),
        "resolution": params.get("resolution") or "720p",
        "watermark": bool(params.get("watermark", False)),
        "safety_identifier": safety_identifier(),
    }


def build_happyhorse_payload(normalized: Mapping[str, Any]) -> dict:
    model = normalized["model"]
    mode = HAPPYHORSE_MODELS[model]
    params = dict(normalized["parameters"])
    input_payload: dict[str, Any] = {"prompt": normalized["prompt"]}
    assets = list(normalized.get("assets") or [])
    if mode == "i2v":
        url = file_to_data_url(assets[0]["localPath"])
        input_payload["media"] = [{"type": "first_frame", "url": url}]
    elif mode == "r2v":
        input_payload["media"] = [
            {"type": "reference_image", "url": file_to_data_url(asset["localPath"])}
            for asset in assets
        ]
    parameters = {
        "resolution": params.get("resolution") or "720P",
        "duration": int(params.get("duration") or 5),
        "watermark": bool(params.get("watermark", False)),
    }
    if mode != "i2v":
        parameters["ratio"] = params.get("ratio") or ("16:9" if mode == "t2v" else "9:16")
    return {
        "model": model,
        "input": input_payload,
        "parameters": parameters,
    }


def build_provider_payload(normalized: Mapping[str, Any]) -> dict:
    if normalized["provider"] == "seedance":
        return build_seedance_payload(normalized)
    return build_happyhorse_payload(normalized)


def archive_dir_for(job_id: str, run_id: str, output_root: Path, created_at: Optional[str] = None) -> Path:
    day = datetime.now().strftime("%Y-%m-%d")
    if created_at:
        try:
            day = datetime.fromisoformat(created_at).strftime("%Y-%m-%d")
        except Exception:
            pass
    return Path(output_root).expanduser() / day / job_id / run_id


def output_filename(provider: str, model: str, job_id: str, run_id: str, created_at: Optional[str] = None) -> str:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    if created_at:
        try:
            stamp = datetime.fromisoformat(created_at).strftime("%Y%m%d-%H%M%S")
        except Exception:
            pass
    return f"{stamp}-{provider}-{model_short(model)}-{job_id[-4:]}-{run_id[-4:]}.mp4"


def _write_run_artifacts(archive_dir: Path, *, normalized: Mapping[str, Any], provider_payload: Mapping[str, Any], event: str) -> None:
    archive_dir.mkdir(parents=True, exist_ok=True)
    (archive_dir / "request.normalized.json").write_text(
        json.dumps(redact_obj(dict(normalized)), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (archive_dir / "request.provider.redacted.json").write_text(
        json.dumps(redact_obj(dict(provider_payload)), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    events_path = archive_dir / "events.jsonl"
    with events_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"at": _now_iso(), "event": event}, ensure_ascii=False) + "\n")
    input_dir = archive_dir / "input"
    input_dir.mkdir(exist_ok=True)
    for index, asset in enumerate(normalized.get("assets") or [], start=1):
        src = _compact(asset.get("localPath"))
        if not src:
            continue
        path = Path(src)
        if path.is_file():
            target = input_dir / f"image-{index:02d}{path.suffix.lower() or '.jpg'}"
            if not target.exists():
                shutil.copy2(path, target)


def create_job(payload: Mapping[str, Any]) -> dict:
    request_uid = _compact(payload.get("requestUid") or payload.get("request_uid"))
    if not request_uid:
        raise AiVideoError("requestUid 必填")
    existing = data_sink.get_ai_video_job_by_request_uid(request_uid)
    if existing:
        job = data_sink.get_ai_video_job(existing["id"]) or existing
        run = data_sink.get_ai_video_run(job.get("currentRunId") or "") or {}
        return {"ok": True, "data": {"job": public_job(job), "run": public_run(run)}, "reused": True}

    normalized = validate_input(payload)
    provider = normalized["provider"]
    model = normalized["model"]
    status = "needs_config" if normalized["needsConfig"] else "queued"
    title = job_title_from_prompt(normalized["prompt"])
    input_snapshot = {
        "prompt": normalized["prompt"],
        "assets": normalized["assets"],
        "parameters": normalized["parameters"],
    }
    created = data_sink.create_ai_video_job_with_run(
        job_payload={
            "requestUid": request_uid,
            "title": title,
            "status": status,
            "provider": provider,
            "model": model,
            "prompt": normalized["prompt"],
            "parameters": normalized["parameters"],
            "outputDir": normalized["outputDir"],
        },
        assets=normalized["assets"],
        run_payload={
            "requestUid": request_uid,
            "status": status,
            "provider": provider,
            "model": model,
            "inputSnapshot": input_snapshot,
            "archiveStatus": "none",
        },
    )
    job = created["job"]
    run = created["run"]
    if created.get("reused"):
        return {"ok": True, "data": {"job": public_job(job), "run": public_run(run)}, "reused": True}

    if status == "queued":
        ensure_worker_started()
        threading.Thread(target=process_run, args=(run["id"],), daemon=True, name=f"ai-video-submit-{run['id'][-6:]}").start()
    return {"ok": True, "data": {"job": public_job(job), "run": public_run(run)}, "reused": False}


def duplicate_job(job_id: str) -> dict:
    job = data_sink.get_ai_video_job(job_id)
    if not job or job.get("deletedAt"):
        raise AiVideoError("任务不存在", code="VALIDATION_FAILED", http_status=404)
    request_uid = f"dup_{uuid4().hex}"
    assets = []
    for asset in job.get("assets") or []:
        assets.append({
            "role": asset.get("role"),
            "localPath": asset.get("localPath"),
            "sortOrder": asset.get("sortOrder"),
        })
    return create_job({
        "requestUid": request_uid,
        "provider": job.get("provider"),
        "model": job.get("model"),
        "prompt": job.get("prompt"),
        "parameters": job.get("parameters") or {},
        "assets": assets,
        "outputDir": job.get("outputDir"),
    })


def retry_job(job_id: str, request_uid: str) -> dict:
    job = data_sink.get_ai_video_job(job_id)
    if not job or job.get("deletedAt"):
        raise AiVideoError("任务不存在", code="VALIDATION_FAILED", http_status=404)
    request = _compact(request_uid)
    if not request:
        raise AiVideoError("requestUid 必填")
    existing_run = data_sink.get_ai_video_run_by_request_uid(request)
    if existing_run:
        return {"ok": True, "data": {"job": public_job(job), "run": public_run(existing_run)}, "reused": True}
    if job.get("status") in ACTIVE_STATUSES:
        raise AiVideoError("任务仍在执行中，请等待完成后再重试")

    assets = []
    for asset in job.get("assets") or []:
        assets.append({
            "role": asset.get("role"),
            "localPath": asset.get("localPath"),
            "sortOrder": asset.get("sortOrder"),
        })
    normalized = validate_input({
        "provider": job.get("provider"),
        "model": job.get("model"),
        "prompt": job.get("prompt"),
        "parameters": job.get("parameters") or {},
        "assets": assets,
        "outputDir": job.get("outputDir"),
    })
    status = "needs_config" if normalized["needsConfig"] else "queued"
    run = data_sink.create_ai_video_run({
        "requestUid": request,
        "jobId": job["id"],
        "status": status,
        "provider": normalized["provider"],
        "model": normalized["model"],
        "inputSnapshot": {
            "prompt": normalized["prompt"],
            "assets": normalized["assets"],
            "parameters": normalized["parameters"],
        },
        "archiveStatus": "none",
    })
    data_sink.update_ai_video_job(job["id"], {
        "status": status,
        "currentRunId": run["id"],
        "parameters": normalized["parameters"],
        "prompt": normalized["prompt"],
        "outputDir": normalized["outputDir"],
    })
    data_sink.replace_ai_video_assets(job["id"], normalized["assets"])
    job = data_sink.get_ai_video_job(job["id"]) or job
    if status == "queued":
        ensure_worker_started()
        threading.Thread(target=process_run, args=(run["id"],), daemon=True, name=f"ai-video-retry-{run['id'][-6:]}").start()
    return {"ok": True, "data": {"job": public_job(job), "run": public_run(run)}, "reused": False}


def delete_job(job_id: str) -> dict:
    job = data_sink.get_ai_video_job(job_id)
    if not job or job.get("deletedAt"):
        raise AiVideoError("任务不存在", code="VALIDATION_FAILED", http_status=404)
    status = _compact(job.get("status"))
    run = data_sink.get_ai_video_run(job.get("currentRunId") or "") or {}
    if status in DELETE_BLOCKED_STATUSES or (status == "queued" and _compact(run.get("providerTaskId"))):
        raise AiVideoError("任务已提交或运行中，不能删除记录", code="VALIDATION_FAILED", http_status=409)
    data_sink.soft_delete_ai_video_job(job_id)
    return {"ok": True, "data": {"id": job_id}}


def update_job(job_id: str, payload: Mapping[str, Any]) -> dict:
    job = data_sink.get_ai_video_job(job_id)
    if not job or job.get("deletedAt"):
        raise AiVideoError("任务不存在", code="VALIDATION_FAILED", http_status=404)
    if _compact(job.get("status")) not in EDITABLE_STATUSES:
        raise AiVideoError("当前状态不可编辑输入参数")
    merged = {
        "provider": payload.get("provider", job.get("provider")),
        "model": payload.get("model", job.get("model")),
        "prompt": payload.get("prompt", job.get("prompt")),
        "parameters": payload.get("parameters", job.get("parameters") or {}),
        "assets": payload.get("assets"),
        "outputDir": payload.get("outputDir", job.get("outputDir")),
    }
    if merged["assets"] is None:
        merged["assets"] = [
            {"role": a.get("role"), "localPath": a.get("localPath"), "sortOrder": a.get("sortOrder")}
            for a in (job.get("assets") or [])
        ]
    normalized = validate_input(merged)
    data_sink.update_ai_video_job(job_id, {
        "provider": normalized["provider"],
        "model": normalized["model"],
        "prompt": normalized["prompt"],
        "parameters": normalized["parameters"],
        "outputDir": normalized["outputDir"],
        "status": "draft" if _compact(job.get("status")) == "needs_config" and not normalized["needsConfig"] else job.get("status"),
        "title": job_title_from_prompt(normalized["prompt"]),
    })
    data_sink.replace_ai_video_assets(job_id, normalized["assets"])
    return {"ok": True, "data": {"job": public_job(data_sink.get_ai_video_job(job_id) or {})}}


def public_job(job: Mapping[str, Any]) -> dict:
    if not job:
        return {}
    current_run = job.get("currentRun")
    if not current_run and job.get("currentRunId"):
        current_run = data_sink.get_ai_video_run(job.get("currentRunId") or "")
    result = {
        "id": job.get("id"),
        "requestUid": job.get("requestUid"),
        "title": job.get("title"),
        "status": job.get("status"),
        "provider": job.get("provider"),
        "model": job.get("model"),
        "prompt": job.get("prompt"),
        "parameters": job.get("parameters") or {},
        "currentRunId": job.get("currentRunId"),
        "outputDir": job.get("outputDir"),
        "createdAt": job.get("createdAt"),
        "updatedAt": job.get("updatedAt"),
        "deletedAt": job.get("deletedAt"),
        "assets": job.get("assets") or [],
        "currentRun": public_run(current_run) if current_run else None,
        "displayStatus": display_status(job.get("status"), current_run),
        "waitedSeconds": waited_seconds(current_run or job),
        "archiveLabel": archive_label(current_run),
    }
    return result


def public_run(run: Optional[Mapping[str, Any]]) -> dict:
    if not run:
        return {}
    output = dict(run.get("output") or {}) if isinstance(run.get("output"), Mapping) else {}
    # Strip provider video URL from public response
    output.pop("providerVideoUrl", None)
    output.pop("videoUrl", None)
    output.pop("video_url", None)
    error = run.get("error") if isinstance(run.get("error"), Mapping) else None
    return {
        "id": run.get("id"),
        "requestUid": run.get("requestUid"),
        "jobId": run.get("jobId"),
        "status": run.get("status"),
        "provider": run.get("provider"),
        "model": run.get("model"),
        "inputSnapshot": run.get("inputSnapshot") or {},
        "providerTaskId": run.get("providerTaskId"),
        "providerStatus": run.get("providerStatus"),
        "archiveStatus": run.get("archiveStatus") or "none",
        "output": output or None,
        "error": error,
        "createdAt": run.get("createdAt"),
        "updatedAt": run.get("updatedAt"),
        "submittedAt": run.get("submittedAt"),
        "completedAt": run.get("completedAt"),
        "displayStatus": display_status(run.get("status"), run),
        "waitedSeconds": waited_seconds(run),
        "archiveLabel": archive_label(run),
    }


def display_status(status: Any, run: Optional[Mapping[str, Any]] = None) -> str:
    value = _compact(status)
    archive = _compact((run or {}).get("archiveStatus"))
    if value == "failed" and archive == "archive_failed":
        return "待归档"
    return {
        "draft": "草稿",
        "queued": "排队",
        "running": "生成中",
        "downloading": "下载归档",
        "completed": "已完成",
        "needs_config": "待配置",
        "failed": "失败",
        "cancelled": "已取消",
        "expired": "已过期",
    }.get(value, value or "未知")


def archive_label(run: Optional[Mapping[str, Any]]) -> str:
    if not run:
        return ""
    archive = _compact(run.get("archiveStatus"))
    if archive == "archive_failed":
        return "待归档"
    if archive == "archived":
        return "已归档"
    if archive == "pending_archive":
        return "归档中"
    return ""


def waited_seconds(entity: Mapping[str, Any]) -> int:
    stamp = _compact(entity.get("submittedAt") or entity.get("createdAt") or entity.get("created_at"))
    if not stamp:
        return 0
    try:
        started = datetime.fromisoformat(stamp)
    except Exception:
        return 0
    return max(0, int((datetime.now() - started.replace(tzinfo=None)).total_seconds()))


def get_config() -> dict:
    status = provider_status()
    return {
        "ok": True,
        "data": {
            "providers": status,
            "models": [
                {
                    "id": "seedance-2.0",
                    "provider": "seedance",
                    "model": SEEDANCE_MODEL,
                    "label": "Seedance 2.0",
                    "defaults": {
                        "ratio": "9:16",
                        "resolution": "720p",
                        "duration": 5,
                        "generateAudio": True,
                        "watermark": False,
                    },
                    "configured": status["seedance"]["configured"],
                },
                {
                    "id": "happyhorse-1.1-t2v",
                    "provider": "happyhorse",
                    "model": "happyhorse-1.1-t2v",
                    "label": "HappyHorse 文生",
                    "defaults": {
                        "ratio": "16:9",
                        "resolution": "720P",
                        "duration": 5,
                        "watermark": False,
                    },
                    "configured": status["happyhorse"]["configured"],
                },
                {
                    "id": "happyhorse-1.1-i2v",
                    "provider": "happyhorse",
                    "model": "happyhorse-1.1-i2v",
                    "label": "HappyHorse 图生",
                    "defaults": {
                        "resolution": "720P",
                        "duration": 5,
                        "watermark": False,
                    },
                    "configured": status["happyhorse"]["configured"],
                },
                {
                    "id": "happyhorse-1.1-r2v",
                    "provider": "happyhorse",
                    "model": "happyhorse-1.1-r2v",
                    "label": "HappyHorse 参考生",
                    "defaults": {
                        "ratio": "9:16",
                        "resolution": "720P",
                        "duration": 5,
                        "watermark": False,
                    },
                    "configured": status["happyhorse"]["configured"],
                },
            ],
            "defaultModelId": "seedance-2.0",
            "defaultOutputDir": str(default_output_dir()),
            "seedanceRatios": sorted(SEEDANCE_RATIOS),
            "happyhorseRatios": sorted(HAPPYHORSE_RATIOS),
            "historyLimit": 50,
        },
    }


def list_jobs(status: str = "", provider: str = "", limit: int = 50) -> dict:
    jobs = data_sink.list_ai_video_jobs(status=status, provider=provider, limit=limit)
    # Best-effort poster backfill for completed archives without poster.jpg.
    for job in jobs:
        run = job.get("currentRun") if isinstance(job.get("currentRun"), Mapping) else None
        if not run or _compact(run.get("status")) != "completed":
            continue
        output = run.get("output") if isinstance(run.get("output"), Mapping) else {}
        poster = _compact((output or {}).get("localPosterPath"))
        video = _compact((output or {}).get("localVideoPath"))
        if video and (not poster or not Path(poster).expanduser().is_file()):
            ensure_run_poster(run.get("id") or "")
    jobs = data_sink.list_ai_video_jobs(status=status, provider=provider, limit=limit)
    return {"ok": True, "data": {"jobs": [public_job(job) for job in jobs]}}


def get_job(job_id: str) -> dict:
    job = data_sink.get_ai_video_job(job_id)
    if not job or job.get("deletedAt"):
        raise AiVideoError("任务不存在", http_status=404)
    run_id = _compact(job.get("currentRunId"))
    if run_id:
        ensure_run_poster(run_id)
        job = data_sink.get_ai_video_job(job_id) or job
    return {"ok": True, "data": {"job": public_job(job), "runs": [public_run(run) for run in job.get("runs") or []]}}


def get_run(run_id: str) -> dict:
    run = data_sink.get_ai_video_run(run_id)
    if not run:
        raise AiVideoError("Run 不存在", http_status=404)
    return {"ok": True, "data": {"run": public_run(run)}}


def _run_lock(run_id: str) -> threading.RLock:
    with _RUN_LOCKS_GUARD:
        lock = _RUN_LOCKS.get(run_id)
        if lock is None:
            lock = threading.RLock()
            _RUN_LOCKS[run_id] = lock
        return lock


def process_run(run_id: str) -> None:
    with _run_lock(run_id):
        run = data_sink.get_ai_video_run(run_id)
        if not run:
            return
        status = _compact(run.get("status"))
        if status in {"completed", "failed", "cancelled", "expired", "needs_config"}:
            return
        if status == "queued" and not _compact(run.get("providerTaskId")):
            _submit_run(run)
            run = data_sink.get_ai_video_run(run_id) or run
        if _compact(run.get("status")) in {"running", "queued"} and _compact(run.get("providerTaskId")):
            _poll_until_terminal_or_once(run_id)
            run = data_sink.get_ai_video_run(run_id) or run
        if _compact(run.get("status")) == "downloading" or (
            _compact(run.get("status")) == "running" and _provider_succeeded(run)
        ):
            _archive_run(run_id)


def _provider_succeeded(run: Mapping[str, Any]) -> bool:
    provider = _compact(run.get("provider"))
    status = _compact(run.get("providerStatus")).lower()
    if provider == "seedance":
        return status == "succeeded"
    if provider == "happyhorse":
        return status == "succeeded"
    return False


def _submit_run(run: Mapping[str, Any]) -> None:
    run_id = run["id"]
    job = data_sink.get_ai_video_job(run.get("jobId") or "") or {}
    snapshot = run.get("inputSnapshot") if isinstance(run.get("inputSnapshot"), Mapping) else {}
    normalized = {
        "provider": run.get("provider"),
        "model": run.get("model"),
        "prompt": snapshot.get("prompt") or job.get("prompt") or "",
        "parameters": snapshot.get("parameters") or job.get("parameters") or {},
        "assets": snapshot.get("assets") or job.get("assets") or [],
        "outputDir": job.get("outputDir") or str(default_output_dir()),
    }
    status = provider_status()
    provider = _compact(normalized["provider"])
    if not status.get(provider, {}).get("configured"):
        error = AiVideoError(
            f"请先在 AI 能力配置 {'Seedance' if provider == 'seedance' else 'HappyHorse'} 凭据",
            code="CREDENTIAL_MISSING",
            safe_suggestion="到设置中的 AI 能力配置对应密钥",
        )
        data_sink.update_ai_video_run(run_id, {"status": "needs_config", "error": error.as_dict()})
        return
    if not status.get(provider, {}).get("cliReady"):
        error = AiVideoError("视频供应商共享能力未完整安装", code="NEEDS_CONFIG")
        data_sink.update_ai_video_run(run_id, {"status": "needs_config", "error": error.as_dict()})
        return

    try:
        provider_payload = build_provider_payload(normalized)
    except Exception as exc:
        error = AiVideoError(str(exc), code="VALIDATION_FAILED")
        data_sink.update_ai_video_run(run_id, {"status": "failed", "error": error.as_dict()})
        return

    archive_dir = archive_dir_for(run.get("jobId") or "job", run_id, Path(normalized["outputDir"]), run.get("createdAt"))
    try:
        _write_run_artifacts(archive_dir, normalized=normalized, provider_payload=provider_payload, event="submit_start")
        payload_path = runtime_paths.child_dir("ai-video-generation") / f"payload-{run_id}.json"
        payload_path.parent.mkdir(parents=True, exist_ok=True)
        # Write raw payload for CLI only; redacted copy already archived.
        payload_path.write_text(json.dumps(provider_payload, ensure_ascii=False), encoding="utf-8")
        if provider == "seedance":
            result = _run_cli(
                provider="seedance",
                args=["bin/seedance.js", "create", str(payload_path)],
                cwd=SEEDANCE_CLI_DIR,
            )
            created = (result.get("objects") or [{}])[0]
            task_id = _compact(created.get("id"))
            provider_status_value = _compact(created.get("status")) or "queued"
        else:
            result = _run_cli(
                provider="happyhorse",
                args=["bin/bailian.js", "create", str(payload_path)],
                cwd=BAILIAN_CLI_DIR,
            )
            created = (result.get("objects") or [{}])[0]
            output = created.get("output") if isinstance(created.get("output"), dict) else {}
            task_id = _compact(output.get("task_id"))
            provider_status_value = _compact(output.get("task_status")) or "PENDING"
        if not task_id:
            error = AiVideoError(
                "create 未返回 provider task id",
                code="UNKNOWN_SUBMIT_RESULT",
                safe_suggestion="为避免重复扣费，本次不会自动重提；请确认后复制为新任务",
            )
            data_sink.update_ai_video_run(run_id, {
                "status": "failed",
                "error": error.as_dict(),
                "providerStatus": provider_status_value,
            })
            (archive_dir / "response.provider.redacted.json").write_text(
                json.dumps(redact_obj(created), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            return
        data_sink.update_ai_video_run(run_id, {
            "status": "running",
            "providerTaskId": task_id,
            "providerStatus": provider_status_value,
            "submittedAt": _now_iso(),
            "error": {},
        })
        (archive_dir / "response.provider.redacted.json").write_text(
            json.dumps(redact_obj(created), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        with (archive_dir / "events.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"at": _now_iso(), "event": "submitted", "providerTaskId": task_id}, ensure_ascii=False) + "\n")
    except AiVideoError as exc:
        status_value = "needs_config" if exc.code in {"CREDENTIAL_MISSING", "NEEDS_CONFIG"} else "failed"
        data_sink.update_ai_video_run(run_id, {"status": status_value, "error": exc.as_dict()})
    except Exception as exc:
        error = AiVideoError(
            f"提交失败：{exc}",
            code="UNKNOWN_SUBMIT_RESULT",
            safe_suggestion="为避免重复扣费，本次不会自动重提；请确认后复制为新任务",
        )
        data_sink.update_ai_video_run(run_id, {"status": "failed", "error": error.as_dict()})


def _poll_until_terminal_or_once(run_id: str, *, once: bool = False) -> None:
    started = time.monotonic()
    while True:
        run = data_sink.get_ai_video_run(run_id)
        if not run:
            return
        task_id = _compact(run.get("providerTaskId"))
        if not task_id:
            return
        provider = _compact(run.get("provider"))
        try:
            if provider == "seedance":
                result = _run_cli(
                    provider="seedance",
                    args=["bin/seedance.js", "get", task_id],
                    cwd=SEEDANCE_CLI_DIR,
                    timeout_seconds=60,
                )
                snapshot = (result.get("objects") or [{}])[0]
                provider_status_value = _compact(snapshot.get("status"))
                video_url = _compact(((snapshot.get("content") or {}) if isinstance(snapshot.get("content"), dict) else {}).get("video_url"))
                terminal = provider_status_value in {"succeeded", "failed", "cancelled", "expired"}
            else:
                result = _run_cli(
                    provider="happyhorse",
                    args=["bin/bailian.js", "get", task_id],
                    cwd=BAILIAN_CLI_DIR,
                    timeout_seconds=60,
                )
                snapshot = (result.get("objects") or [{}])[0]
                output = snapshot.get("output") if isinstance(snapshot.get("output"), dict) else {}
                provider_status_value = _compact(output.get("task_status"))
                video_url = _compact(output.get("video_url"))
                terminal = provider_status_value.upper() in {"SUCCEEDED", "FAILED", "CANCELED", "UNKNOWN"}
                provider_status_value = provider_status_value.upper()
        except AiVideoError as exc:
            data_sink.update_ai_video_run(run_id, {"status": "failed", "error": exc.as_dict()})
            return
        except Exception as exc:
            data_sink.update_ai_video_run(run_id, {
                "status": "failed",
                "error": AiVideoError(str(exc), code="PROVIDER_REJECTED").as_dict(),
            })
            return

        mapped = map_provider_public_status(provider, provider_status_value)
        if mapped == "running":
            data_sink.update_ai_video_run(run_id, {
                "status": "running",
                "providerStatus": provider_status_value,
            })
        elif mapped == "downloading":
            output = dict(run.get("output") or {}) if isinstance(run.get("output"), Mapping) else {}
            output["providerVideoUrl"] = video_url
            data_sink.update_ai_video_run(run_id, {
                "status": "downloading",
                "providerStatus": provider_status_value,
                "archiveStatus": "pending_archive",
                "output": output,
            })
            _archive_run(run_id)
            return
        elif mapped in {"failed", "cancelled", "expired"}:
            data_sink.update_ai_video_run(run_id, {
                "status": mapped,
                "providerStatus": provider_status_value,
                "completedAt": _now_iso(),
                "error": AiVideoError(
                    f"provider 状态：{provider_status_value}",
                    code="PROVIDER_REJECTED" if mapped == "failed" else mapped.upper(),
                ).as_dict(),
            })
            return

        if once or terminal:
            return
        if time.monotonic() - started > POLL_TIMEOUT_SECONDS:
            data_sink.update_ai_video_run(run_id, {
                "status": "expired",
                "providerStatus": provider_status_value,
                "error": AiVideoError(
                    "长时间未完成",
                    code="PROVIDER_TIMEOUT",
                    retryable=True,
                    safe_suggestion="可稍后恢复查询或复制为新任务",
                ).as_dict(),
            })
            return
        time.sleep(POLL_INTERVAL_SECONDS)


def map_provider_public_status(provider: str, provider_status_value: str) -> str:
    value = _compact(provider_status_value)
    lower = value.lower()
    if provider == "seedance":
        if lower in {"queued", "running"}:
            return "running"
        if lower == "succeeded":
            return "downloading"
        if lower == "failed":
            return "failed"
        if lower == "cancelled":
            return "cancelled"
        if lower == "expired":
            return "expired"
        return "running"
    upper = value.upper()
    if upper in {"PENDING", "RUNNING"}:
        return "running"
    if upper == "SUCCEEDED":
        return "downloading"
    if upper == "FAILED":
        return "failed"
    if upper == "CANCELED":
        return "cancelled"
    if upper == "UNKNOWN":
        return "expired"
    return "running"


def _find_ffmpeg() -> Optional[str]:
    candidates = [
        shutil.which("ffmpeg"),
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
    ]
    for candidate in candidates:
        value = _compact(candidate)
        if value and Path(value).is_file():
            return value
    return None


def extract_video_poster(
    video_path: str | Path,
    poster_path: str | Path | None = None,
    *,
    fallback_image: str | Path | None = None,
) -> Optional[Path]:
    """Extract poster.jpg next to the video. Prefer ffmpeg, then macOS qlmanage, then fallback image."""
    video = Path(str(video_path or "")).expanduser()
    if not video.is_file():
        return None
    target = Path(poster_path) if poster_path else (video.parent / "poster.jpg")
    target = target.expanduser()
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None

    if target.is_file() and target.stat().st_size > 0:
        return target

    # 1) ffmpeg
    ffmpeg = _find_ffmpeg()
    if ffmpeg:
        try:
            completed = subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-ss",
                    "0.15",
                    "-i",
                    str(video),
                    "-frames:v",
                    "1",
                    "-q:v",
                    "3",
                    str(target),
                ],
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
            if completed.returncode == 0 and target.is_file() and target.stat().st_size > 0:
                return target
            if target.exists() and target.stat().st_size <= 0:
                try:
                    target.unlink()
                except OSError:
                    pass
        except Exception:
            logger.debug("ffmpeg poster extract failed for %s", video, exc_info=True)

    # 2) macOS Quick Look thumbnail + sips convert
    qlmanage = shutil.which("qlmanage") or "/usr/bin/qlmanage"
    sips = shutil.which("sips") or "/usr/bin/sips"
    if Path(qlmanage).is_file():
        tmp_dir = runtime_paths.child_dir("ai-video-posters-tmp")
        try:
            tmp_dir.mkdir(parents=True, exist_ok=True)
            completed = subprocess.run(
                [qlmanage, "-t", "-s", "720", "-o", str(tmp_dir), str(video)],
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
            produced = tmp_dir / f"{video.name}.png"
            if not produced.is_file():
                # qlmanage may sanitize names; pick newest png
                pngs = sorted(tmp_dir.glob("*.png"), key=lambda p: p.stat().st_mtime, reverse=True)
                produced = pngs[0] if pngs else produced
            if produced.is_file() and produced.stat().st_size > 0:
                if Path(sips).is_file():
                    convert = subprocess.run(
                        [sips, "-s", "format", "jpeg", str(produced), "--out", str(target)],
                        capture_output=True,
                        text=True,
                        timeout=30,
                        check=False,
                    )
                    if convert.returncode == 0 and target.is_file() and target.stat().st_size > 0:
                        try:
                            produced.unlink(missing_ok=True)  # type: ignore[call-arg]
                        except TypeError:
                            try:
                                produced.unlink()
                            except OSError:
                                pass
                        return target
                # keep png as poster if jpeg convert fails
                try:
                    shutil.copy2(produced, target.with_suffix(".png"))
                    if target.with_suffix(".png").is_file():
                        return target.with_suffix(".png")
                except OSError:
                    pass
            _ = completed  # silence unused
        except Exception:
            logger.debug("qlmanage poster extract failed for %s", video, exc_info=True)

    # 3) fallback to first reference image
    fallback = Path(str(fallback_image or "")).expanduser() if fallback_image else None
    if fallback and fallback.is_file():
        try:
            from PIL import Image

            with Image.open(fallback) as image:
                rgb = image.convert("RGB")
                rgb.save(target, format="JPEG", quality=88)
            if target.is_file() and target.stat().st_size > 0:
                return target
        except Exception:
            try:
                shutil.copy2(fallback, target)
                if target.is_file() and target.stat().st_size > 0:
                    return target
            except OSError:
                pass
    return None


def _fallback_image_from_run(run: Mapping[str, Any]) -> Optional[str]:
    snapshot = run.get("inputSnapshot") if isinstance(run.get("inputSnapshot"), Mapping) else {}
    assets = snapshot.get("assets") if isinstance(snapshot.get("assets"), list) else []
    for asset in assets:
        if not isinstance(asset, Mapping):
            continue
        path = _compact(asset.get("localPath") or asset.get("local_path"))
        if path and Path(path).expanduser().is_file():
            return path
    return None


def ensure_run_poster(run_id: str) -> Optional[str]:
    run = data_sink.get_ai_video_run(run_id)
    if not run:
        return None
    output = dict(run.get("output") or {}) if isinstance(run.get("output"), Mapping) else {}
    existing = _compact(output.get("localPosterPath") or output.get("local_poster_path"))
    if existing and Path(existing).expanduser().is_file():
        return existing
    video = _compact(output.get("localVideoPath") or output.get("local_video_path"))
    if not video:
        return None
    video_path = Path(video).expanduser()
    poster = extract_video_poster(
        video_path,
        video_path.parent / "poster.jpg",
        fallback_image=_fallback_image_from_run(run),
    )
    if not poster:
        return None
    output["localPosterPath"] = str(poster)
    data_sink.update_ai_video_run(run_id, {"output": output})
    return str(poster)


def _finalize_archived_output(
    *,
    run_id: str,
    run: Mapping[str, Any],
    output: Mapping[str, Any],
    local_mp4: Path,
    archive_dir: Path,
    file_name: str,
) -> None:
    poster = extract_video_poster(
        local_mp4,
        archive_dir / "poster.jpg",
        fallback_image=_fallback_image_from_run(run),
    )
    data_sink.update_ai_video_run(run_id, {
        "status": "completed",
        "archiveStatus": "archived",
        "completedAt": _now_iso(),
        "output": {
            **dict(output or {}),
            "localVideoPath": str(local_mp4),
            "localPosterPath": str(poster) if poster else None,
            "archiveDir": str(archive_dir),
            "fileName": file_name,
            "sizeBytes": local_mp4.stat().st_size,
            "durationSeconds": (run.get("inputSnapshot") or {}).get("parameters", {}).get("duration"),
        },
        "error": {},
    })


def _download_file(url: str, target: Path) -> Path:
    if _DOWNLOADER is not None:
        return _DOWNLOADER(url=url, target_path=str(target))
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_suffix(target.suffix + ".part")
    if part.exists():
        try:
            part.unlink()
        except OSError:
            pass

    # Prefer curl for robust large-file download with connect/max time limits.
    curl = shutil.which("curl")
    last_error: Exception | None = None
    if curl:
        try:
            completed = subprocess.run(
                [
                    curl,
                    "-fsSL",
                    "--connect-timeout",
                    "20",
                    "--max-time",
                    "300",
                    "-o",
                    str(part),
                    url,
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            if completed.returncode != 0 or not part.is_file() or part.stat().st_size <= 0:
                detail = (completed.stderr or completed.stdout or f"curl exit {completed.returncode}").strip()
                raise RuntimeError(detail[:300])
            part.replace(target)
            return target
        except Exception as exc:
            last_error = exc
            if part.exists():
                try:
                    part.unlink()
                except OSError:
                    pass

    request = urllib.request.Request(url, method="GET", headers={"User-Agent": "crawshrimp-ai-video/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response, part.open("wb") as handle:
            while True:
                chunk = response.read(1024 * 256)
                if not chunk:
                    break
                handle.write(chunk)
        if not part.is_file() or part.stat().st_size <= 0:
            raise RuntimeError("downloaded file is empty")
        part.replace(target)
        return target
    except Exception as exc:
        if part.exists():
            try:
                part.unlink()
            except OSError:
                pass
        message = str(exc or last_error or "download failed")
        raise AiVideoError(
            f"下载失败：{message}",
            code="DOWNLOAD_FAILED",
            retryable=True,
            safe_suggestion="当前视频待归档，可点击重新归档",
        ) from exc


def _archive_run(run_id: str) -> None:
    run = data_sink.get_ai_video_run(run_id)
    if not run:
        return
    job = data_sink.get_ai_video_job(run.get("jobId") or "") or {}
    output = dict(run.get("output") or {}) if isinstance(run.get("output"), Mapping) else {}
    video_url = _compact(output.get("providerVideoUrl") or output.get("video_url"))
    archive_root = expand_output_dir(job.get("outputDir") or default_output_dir())
    archive_dir = Path(output.get("archiveDir") or archive_dir_for(job.get("id") or run.get("jobId") or "job", run_id, archive_root, run.get("createdAt")))
    archive_dir.mkdir(parents=True, exist_ok=True)
    file_name = _compact(output.get("fileName")) or output_filename(
        _compact(run.get("provider")),
        _compact(run.get("model")),
        _compact(job.get("id") or run.get("jobId")),
        run_id,
        run.get("createdAt"),
    )
    # Keep stable local name output.mp4 plus friendly file name hardlink/copy.
    local_mp4 = archive_dir / "output.mp4"
    friendly = archive_dir / file_name
    if local_mp4.is_file() and local_mp4.stat().st_size > 0:
        if not friendly.exists():
            try:
                shutil.copy2(local_mp4, friendly)
            except OSError:
                pass
        _finalize_archived_output(
            run_id=run_id,
            run=run,
            output=output,
            local_mp4=local_mp4,
            archive_dir=archive_dir,
            file_name=file_name,
        )
        return

    if not video_url:
        # Re-fetch once to get video url
        _poll_until_terminal_or_once(run_id, once=True)
        run = data_sink.get_ai_video_run(run_id) or run
        output = dict(run.get("output") or {}) if isinstance(run.get("output"), Mapping) else {}
        video_url = _compact(output.get("providerVideoUrl") or output.get("video_url"))
    if not video_url:
        data_sink.update_ai_video_run(run_id, {
            "status": "failed",
            "archiveStatus": "archive_failed",
            "error": AiVideoError(
                "缺少可下载的视频地址",
                code="DOWNLOAD_FAILED",
                retryable=True,
            ).as_dict(),
        })
        return

    data_sink.update_ai_video_run(run_id, {
        "status": "downloading",
        "archiveStatus": "pending_archive",
    })
    try:
        _download_file(video_url, local_mp4)
        if not friendly.exists():
            shutil.copy2(local_mp4, friendly)
        with (archive_dir / "events.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"at": _now_iso(), "event": "archived", "file": file_name}, ensure_ascii=False) + "\n")
        _finalize_archived_output(
            run_id=run_id,
            run=run,
            output=output,
            local_mp4=local_mp4,
            archive_dir=archive_dir,
            file_name=file_name,
        )
    except AiVideoError as exc:
        data_sink.update_ai_video_run(run_id, {
            "status": "failed",
            "archiveStatus": "archive_failed",
            "error": exc.as_dict(),
            "output": {
                **output,
                "archiveDir": str(archive_dir),
                "fileName": file_name,
            },
        })
    except Exception as exc:
        data_sink.update_ai_video_run(run_id, {
            "status": "failed",
            "archiveStatus": "archive_failed",
            "error": AiVideoError(str(exc), code="DOWNLOAD_FAILED", retryable=True).as_dict(),
            "output": {
                **output,
                "archiveDir": str(archive_dir),
                "fileName": file_name,
            },
        })


def retry_archive(run_id: str) -> dict:
    run = data_sink.get_ai_video_run(run_id)
    if not run:
        raise AiVideoError("Run 不存在", http_status=404)
    if not _compact(run.get("providerTaskId")):
        raise AiVideoError("缺少 provider task id，无法重新归档")
    data_sink.update_ai_video_run(run_id, {
        "status": "downloading",
        "archiveStatus": "pending_archive",
        "error": {},
    })
    ensure_worker_started()
    process_run(run_id)
    run = data_sink.get_ai_video_run(run_id) or run
    job = data_sink.get_ai_video_job(run.get("jobId") or "") or {}
    return {"ok": True, "data": {"job": public_job(job), "run": public_run(run)}}


def worker_loop() -> None:
    while not _WORKER_STOP.is_set():
        try:
            recover_active_runs(once=True)
        except Exception:
            logger.exception("ai video worker tick failed")
        _WORKER_STOP.wait(POLL_INTERVAL_SECONDS)


def ensure_worker_started() -> None:
    global _WORKER_THREAD
    with _WORKER_LOCK:
        if _WORKER_THREAD and _WORKER_THREAD.is_alive():
            return
        _WORKER_STOP.clear()
        _WORKER_THREAD = threading.Thread(target=worker_loop, name="ai-video-worker", daemon=True)
        _WORKER_THREAD.start()


def stop_worker() -> None:
    _WORKER_STOP.set()


def recover_active_runs(*, once: bool = False) -> None:
    runs = data_sink.list_active_ai_video_runs()
    for run in runs:
        run_id = run.get("id")
        if not run_id:
            continue
        status = _compact(run.get("status"))
        task_id = _compact(run.get("providerTaskId"))
        if status == "queued" and not task_id:
            process_run(run_id)
            continue
        if status in {"running", "downloading", "queued"} and task_id:
            if once:
                _poll_until_terminal_or_once(run_id, once=True)
                latest = data_sink.get_ai_video_run(run_id)
                if latest and _compact(latest.get("status")) == "downloading":
                    _archive_run(run_id)
            else:
                process_run(run_id)


def envelope_error(exc: Exception) -> dict:
    if isinstance(exc, AiVideoError):
        return {
            "ok": False,
            "error": {
                "code": exc.code,
                "message": str(exc),
                "detail": exc.provider_message or None,
            },
        }
    return {
        "ok": False,
        "error": {
            "code": "INTERNAL_ERROR",
            "message": str(exc) or "internal error",
        },
    }
