"""AI video generation workbench: validation, provider adapters, worker."""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import mimetypes
import os
import re
import shutil
import stat
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Mapping, Optional
from uuid import uuid4

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from core import data_sink, runtime_paths
from core.config import load_config

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
KLING_V3_MODEL = "kling/kling-v3-video-generation"
KLING_OMNI_MODEL = "kling/kling-v3-omni-video-generation"
PIXVERSE_MOTIONCONTROL_MODEL = "pixverse/pixverse-motioncontrol"
HAPPYHORSE_MODELS = {
    "happyhorse-1.1-t2v": "t2v",
    "happyhorse-1.1-i2v": "i2v",
    "happyhorse-1.1-r2v": "r2v",
}
KLING_MODELS = frozenset({KLING_V3_MODEL, KLING_OMNI_MODEL})
BAILIAN_GATEWAY_MODELS = frozenset({
    KLING_V3_MODEL,
    KLING_OMNI_MODEL,
    PIXVERSE_MOTIONCONTROL_MODEL,
})
BAILIAN_MODEL_IDS = frozenset(set(HAPPYHORSE_MODELS.keys()) | set(BAILIAN_GATEWAY_MODELS))
UI_MODEL_IDS = {
    "seedance-2.0": {"provider": "seedance", "model": SEEDANCE_MODEL},
    "happyhorse-1.1-t2v": {"provider": "happyhorse", "model": "happyhorse-1.1-t2v"},
    "happyhorse-1.1-i2v": {"provider": "happyhorse", "model": "happyhorse-1.1-i2v"},
    "happyhorse-1.1-r2v": {"provider": "happyhorse", "model": "happyhorse-1.1-r2v"},
    "kling-v3": {"provider": "happyhorse", "model": KLING_V3_MODEL},
    "kling-v3-omni": {"provider": "happyhorse", "model": KLING_OMNI_MODEL},
    "pixverse-motioncontrol": {"provider": "happyhorse", "model": PIXVERSE_MOTIONCONTROL_MODEL},
    KLING_V3_MODEL: {"provider": "happyhorse", "model": KLING_V3_MODEL},
    KLING_OMNI_MODEL: {"provider": "happyhorse", "model": KLING_OMNI_MODEL},
    PIXVERSE_MOTIONCONTROL_MODEL: {"provider": "happyhorse", "model": PIXVERSE_MOTIONCONTROL_MODEL},
}
SEEDANCE_RATIOS = frozenset({"16:9", "9:16", "1:1", "3:4", "4:3", "21:9", "adaptive"})
HAPPYHORSE_RATIOS = frozenset({"16:9", "9:16", "1:1", "4:3", "3:4", "4:5", "5:4", "9:21", "21:9"})
KLING_ASPECT_RATIOS = frozenset({"16:9", "9:16", "1:1"})
KLING_MODES = frozenset({"std", "pro"})
PIXVERSE_RESOLUTIONS = frozenset({"360P", "540P", "720P"})
ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm"}
ALLOWED_VIDEO_MIME = {"video/mp4", "video/quicktime", "video/webm"}
KLING_V3_MEDIA_TYPES = frozenset({"first_frame", "last_frame"})
KLING_OMNI_MEDIA_TYPES = frozenset({"first_frame", "last_frame", "refer", "feature", "base"})
PIXVERSE_MEDIA_TYPES = frozenset({"image_url", "video_url"})
BAILIAN_TEMP_UPLOAD_POLICY_URL = "https://dashscope.aliyuncs.com/api/v1/uploads"
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
RECOVERY_MAX_WORKERS = 4
CAPABILITY_PREFIX = "avcap2"
CAPABILITY_MAX_AGE_SECONDS = 24 * 60 * 60
CAPABILITY_FUTURE_SKEW_SECONDS = 5 * 60
CAPABILITY_NONCE_BYTES = 12
CAPABILITY_TAG_BYTES = 16
CAPABILITY_AAD = CAPABILITY_PREFIX.encode("ascii")
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


def _capability_secret() -> bytes:
    raw = _compact(os.environ.get("CRAWSHRIMP_AI_VIDEO_CAPABILITY_SECRET"))
    if re.fullmatch(r"[0-9A-Fa-f]{64}", raw):
        return bytes.fromhex(raw)
    encoded = raw.encode("utf-8")
    if len(encoded) >= 32:
        return hashlib.sha256(encoded).digest()
    raise AiVideoError(
        "AI 视频路径授权未配置",
        code="NEEDS_CONFIG",
        safe_suggestion="请完整重启桌面端后重试",
        http_status=503,
    )


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    try:
        if not value or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
            raise ValueError("invalid base64url")
        padding = "=" * (-len(value) % 4)
        decoded = base64.urlsafe_b64decode((value + padding).encode("ascii"))
        if _b64url_encode(decoded) != value:
            raise ValueError("non-canonical base64url")
        return decoded
    except Exception as exc:
        raise AiVideoError("路径授权格式无效", code="PATH_CAPABILITY_INVALID") from exc


def _encrypt_path_capability_payload(payload: Mapping[str, Any], *, nonce: Optional[bytes] = None) -> str:
    nonce_bytes = os.urandom(CAPABILITY_NONCE_BYTES) if nonce is None else bytes(nonce)
    if len(nonce_bytes) != CAPABILITY_NONCE_BYTES:
        raise AiVideoError("路径授权 nonce 无效", code="PATH_CAPABILITY_INVALID")
    plaintext = json.dumps(
        dict(payload),
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    sealed = AESGCM(_capability_secret()).encrypt(nonce_bytes, plaintext, CAPABILITY_AAD)
    return f"{CAPABILITY_PREFIX}.{_b64url_encode(nonce_bytes)}.{_b64url_encode(sealed)}"


def _decrypt_path_capability_payload(token: Any) -> dict:
    value = _compact(token)
    parts = value.split(".")
    if len(parts) != 3 or parts[0] != CAPABILITY_PREFIX:
        raise AiVideoError("路径授权格式无效", code="PATH_CAPABILITY_INVALID")
    nonce = _b64url_decode(parts[1])
    sealed = _b64url_decode(parts[2])
    if len(nonce) != CAPABILITY_NONCE_BYTES or len(sealed) <= CAPABILITY_TAG_BYTES:
        raise AiVideoError("路径授权格式无效", code="PATH_CAPABILITY_INVALID")
    try:
        plaintext = AESGCM(_capability_secret()).decrypt(nonce, sealed, CAPABILITY_AAD)
    except InvalidTag as exc:
        raise AiVideoError("路径授权认证无效", code="PATH_CAPABILITY_INVALID") from exc
    try:
        payload = json.loads(plaintext.decode("utf-8"))
    except Exception as exc:
        raise AiVideoError("路径授权载荷无效", code="PATH_CAPABILITY_INVALID") from exc
    if not isinstance(payload, Mapping):
        raise AiVideoError("路径授权载荷无效", code="PATH_CAPABILITY_INVALID")
    return dict(payload)


def _assert_no_symlink_components(path: Path) -> None:
    absolute = path.expanduser().absolute()
    current = Path(absolute.anchor)
    for part in absolute.parts[1:]:
        current = current / part
        try:
            if current.is_symlink():
                raise AiVideoError("路径包含符号链接", code="PATH_NOT_ALLOWED")
            if not current.exists():
                break
        except AiVideoError:
            raise
        except OSError as exc:
            raise AiVideoError("无法校验路径安全性", code="PATH_NOT_ALLOWED") from exc


def _validated_existing_file(path: Path) -> Path:
    candidate = path.expanduser()
    if not candidate.is_absolute():
        raise AiVideoError("文件授权路径必须是绝对路径", code="PATH_CAPABILITY_INVALID")
    absolute = candidate.absolute()
    _assert_no_symlink_components(absolute)
    try:
        resolved = absolute.resolve(strict=True)
    except OSError as exc:
        raise AiVideoError("授权文件不存在", code="PATH_NOT_ALLOWED") from exc
    if resolved != absolute or not resolved.is_file():
        raise AiVideoError("授权文件路径无效", code="PATH_NOT_ALLOWED")
    return resolved


def _validated_output_dir(path: Path) -> Path:
    candidate = path.expanduser()
    if not candidate.is_absolute():
        raise AiVideoError("输出目录授权路径必须是绝对路径", code="PATH_CAPABILITY_INVALID")
    absolute = candidate.absolute()
    _assert_no_symlink_components(absolute)
    resolved = absolute.resolve(strict=False)
    if resolved != absolute:
        raise AiVideoError("输出目录包含符号链接", code="PATH_NOT_ALLOWED")
    if absolute.exists() and not absolute.is_dir():
        raise AiVideoError("输出路径不是目录", code="ARCHIVE_WRITE_FAILED")
    writable_parent = absolute
    while not writable_parent.exists() and writable_parent != writable_parent.parent:
        writable_parent = writable_parent.parent
    _assert_no_symlink_components(writable_parent)
    if not writable_parent.is_dir() or not os.access(writable_parent, os.W_OK):
        raise AiVideoError(
            "输出目录不可写",
            code="ARCHIVE_WRITE_FAILED",
            safe_suggestion="重新选择有写入权限的输出目录",
        )
    return resolved


def issue_path_capability(path: str | Path, *, kind: str, scope: str) -> str:
    if kind not in {"file", "directory"} or scope not in {"input", "output", "media"}:
        raise AiVideoError("路径授权范围无效", code="PATH_CAPABILITY_INVALID")
    raw_path = Path(str(path or "")).expanduser()
    if kind == "file":
        safe_path = _validated_existing_file(raw_path)
    else:
        safe_path = _validated_output_dir(raw_path)
    payload = {
        "v": 2,
        "kind": kind,
        "scope": scope,
        "path": str(safe_path),
        "issuedAt": int(time.time() * 1000),
    }
    return _encrypt_path_capability_payload(payload)


def verify_path_capability(token: Any, *, expected_kind: str, expected_scope: str) -> Path:
    payload = _decrypt_path_capability_payload(token)
    if payload.get("v") != 2:
        raise AiVideoError("路径授权版本无效", code="PATH_CAPABILITY_INVALID")
    if _compact(payload.get("kind")) != expected_kind or _compact(payload.get("scope")) != expected_scope:
        raise AiVideoError("路径授权范围不匹配", code="PATH_CAPABILITY_INVALID")
    try:
        issued_at = float(payload.get("issuedAt"))
    except Exception as exc:
        raise AiVideoError("路径授权时间无效", code="PATH_CAPABILITY_INVALID") from exc
    if issued_at > 100_000_000_000:
        issued_at /= 1000.0
    now = time.time()
    if issued_at > now + CAPABILITY_FUTURE_SKEW_SECONDS:
        raise AiVideoError("路径授权时间无效", code="PATH_CAPABILITY_INVALID")
    if now - issued_at > CAPABILITY_MAX_AGE_SECONDS:
        raise AiVideoError("路径授权已过期", code="PATH_CAPABILITY_EXPIRED")
    path_value = _compact(payload.get("path"))
    if not path_value or "\x00" in path_value:
        raise AiVideoError("路径授权载荷无效", code="PATH_CAPABILITY_INVALID")
    path = Path(path_value).expanduser()
    if expected_kind == "file":
        return _validated_existing_file(path)
    return _validated_output_dir(path)


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
            elif key_text.lower() in {"video_url", "url"} and isinstance(item, str) and (
                item.startswith("http") or item.startswith("oss://")
            ):
                result[key] = "[redacted-url]"
            else:
                result[key] = redact_obj(item, secret_values)
        return result
    if isinstance(value, list):
        return [redact_obj(item, secret_values) for item in value]
    if isinstance(value, str):
        if value.lstrip().lower().startswith("data:"):
            return "[redacted-data-url]"
        return redact_text(value, secret_values)
    return value


def provider_secrets() -> dict[str, str]:
    cfg = load_config()
    return {
        "seedance": _compact(_nested_config_value(cfg, "ai.video.seedance_api_key")),
        "happyhorse": _compact(_nested_config_value(cfg, "ai.video.bailian_api_key")),
        "bailian_upload": _compact(_nested_config_value(cfg, "ai.video.bailian_upload_api_key")),
    }


def bailian_upload_policy_url() -> str:
    cfg = load_config()
    configured = _compact(_nested_config_value(cfg, "ai.video.bailian_uploads_url"))
    env_value = _compact(os.environ.get("BAILIAN_UPLOADS_URL") or os.environ.get("DASHSCOPE_UPLOADS_URL"))
    return configured or env_value or BAILIAN_TEMP_UPLOAD_POLICY_URL


def provider_status() -> dict:
    cfg = load_config()
    secrets = provider_secrets()
    bailian_base_url = _compact(_nested_config_value(cfg, "ai.video.bailian_base_url"))
    bailian_uses_semir_gateway = "ai-aigw.semir.com" in bailian_base_url.lower() or "bailian-vedio" in bailian_base_url.lower()

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
            "pricingEstimateAvailable": not bailian_uses_semir_gateway,
        },
        "bailianUpload": {
            "configured": bool(secrets["bailian_upload"]),
            "source": source_for("ai.video.bailian_upload_api_key"),
            "policyUrlConfigured": bool(_compact(_nested_config_value(cfg, "ai.video.bailian_uploads_url"))),
        },
    }


def provider_env(provider: str) -> tuple[dict[str, str], list[str]]:
    cfg = load_config()
    secrets = provider_secrets()
    allowed_names = {
        "PATH",
        "HOME",
        "TMPDIR",
        "TEMP",
        "TMP",
        "LANG",
        "TZ",
        "SYSTEMROOT",
        "WINDIR",
        "COMSPEC",
        "PATHEXT",
    }
    env: dict[str, str] = {}
    for name, value in os.environ.items():
        upper = name.upper()
        if upper.endswith(("_KEY", "_TOKEN", "_SECRET")):
            continue
        if upper in allowed_names or upper.startswith("LC_"):
            env[name] = value
    selected_secret = _compact(secrets.get(provider))
    secret_values = [selected_secret] if selected_secret else []
    if provider == "seedance":
        if secrets["seedance"]:
            env["ARK_API_KEY"] = secrets["seedance"]
        base_url = _compact(_nested_config_value(cfg, "ai.video.seedance_base_url"))
        if base_url:
            env["ARK_BASE_URL"] = base_url
            secret_values.append(base_url)
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
                secret_values.append(value)
    return env, list(dict.fromkeys(secret_values))


def _safe_upload_filename(name: str) -> str:
    value = _compact(name) or "asset"
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip(".-")
    return (value or "asset")[:120]


def _request_bailian_upload_policy(api_key: str, model: str) -> dict:
    query = urllib.parse.urlencode({"action": "getPolicy", "model": model})
    request = urllib.request.Request(
        f"{bailian_upload_policy_url().rstrip('/')}?{query}",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8", errors="replace")
            status = int(getattr(response, "status", 0) or response.getcode() or 0)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise AiVideoError(
            f"百炼临时文件上传凭证获取失败：HTTP {exc.code}",
            code="PROVIDER_UPLOAD_FAILED",
            provider_message=raw[:1000],
            retryable=int(exc.code or 0) in {408, 429, 500, 502, 503, 504},
        ) from None
    except Exception as exc:
        raise AiVideoError(
            f"百炼临时文件上传凭证获取失败：{type(exc).__name__}",
            code="PROVIDER_UPLOAD_FAILED",
            retryable=True,
        ) from exc
    if status >= 400:
        raise AiVideoError(
            f"百炼临时文件上传凭证获取失败：HTTP {status}",
            code="PROVIDER_UPLOAD_FAILED",
            provider_message=raw[:1000],
            retryable=status in {408, 429, 500, 502, 503, 504},
        )
    try:
        body = json.loads(raw or "{}")
    except Exception as exc:
        raise AiVideoError("百炼临时文件上传凭证响应不是 JSON", code="PROVIDER_UPLOAD_FAILED") from exc
    data = body.get("data") if isinstance(body, Mapping) else None
    if not isinstance(data, Mapping):
        raise AiVideoError("百炼临时文件上传凭证缺少 data", code="PROVIDER_UPLOAD_FAILED")
    return dict(data)


def _multipart_form_body(fields: Mapping[str, str], *, file_path: Path, file_field: str = "file") -> tuple[bytes, str]:
    boundary = f"----CrawshrimpBailian{uuid4().hex}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        chunks.append(str(value).encode("utf-8"))
        chunks.append(b"\r\n")
    file_name = _safe_upload_filename(file_path.name)
    content_type = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
    chunks.append(f"--{boundary}\r\n".encode("utf-8"))
    chunks.append(f'Content-Disposition: form-data; name="{file_field}"; filename="{file_name}"\r\n'.encode("utf-8"))
    chunks.append(f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"))
    chunks.append(file_path.read_bytes())
    chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), boundary


def _upload_file_to_bailian_temp_storage(*, api_key: str, model: str, path: Path) -> str:
    file_path = _validated_existing_file(path)
    policy = _request_bailian_upload_policy(api_key, model)
    upload_dir = _compact(policy.get("upload_dir"))
    upload_host = _compact(policy.get("upload_host"))
    if not upload_dir or not upload_host:
        raise AiVideoError("百炼临时文件上传凭证缺少上传地址", code="PROVIDER_UPLOAD_FAILED")
    try:
        max_mb = float(policy.get("max_file_size_mb") or 0)
    except Exception:
        max_mb = 0.0
    if max_mb > 0 and file_path.stat().st_size > max_mb * 1024 * 1024:
        raise AiVideoError(f"文件超过百炼临时上传限制：{int(max_mb)}MB", code="VALIDATION_FAILED")
    key = f"{upload_dir.rstrip('/')}/{uuid4().hex}-{_safe_upload_filename(file_path.name)}"
    fields = {
        "OSSAccessKeyId": _compact(policy.get("oss_access_key_id")),
        "Signature": _compact(policy.get("signature")),
        "policy": _compact(policy.get("policy")),
        "x-oss-object-acl": _compact(policy.get("x_oss_object_acl")),
        "x-oss-forbid-overwrite": _compact(policy.get("x_oss_forbid_overwrite")),
        "key": key,
        "success_action_status": "200",
    }
    missing = [name for name, value in fields.items() if name != "success_action_status" and not value]
    if missing:
        raise AiVideoError(f"百炼临时文件上传凭证缺少字段：{', '.join(missing)}", code="PROVIDER_UPLOAD_FAILED")
    body, boundary = _multipart_form_body(fields, file_path=file_path)
    request = urllib.request.Request(
        upload_host,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw = response.read().decode("utf-8", errors="replace")
            status = int(getattr(response, "status", 0) or response.getcode() or 0)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise AiVideoError(
            f"百炼临时文件上传失败：HTTP {exc.code}",
            code="PROVIDER_UPLOAD_FAILED",
            provider_message=raw[:1000],
            retryable=int(exc.code or 0) in {408, 429, 500, 502, 503, 504},
        ) from None
    except Exception as exc:
        raise AiVideoError(
            f"百炼临时文件上传失败：{type(exc).__name__}",
            code="PROVIDER_UPLOAD_FAILED",
            retryable=True,
        ) from exc
    if status not in {200, 201, 204}:
        raise AiVideoError(
            f"百炼临时文件上传失败：HTTP {status}",
            code="PROVIDER_UPLOAD_FAILED",
            provider_message=raw[:1000],
            retryable=status in {408, 429, 500, 502, 503, 504},
        )
    return f"oss://{key}"


def _with_bailian_temp_uploaded_assets(normalized: Mapping[str, Any]) -> dict:
    model = _compact(normalized.get("model"))
    if model not in BAILIAN_GATEWAY_MODELS:
        return dict(normalized)
    assets = [dict(asset) for asset in (normalized.get("assets") or []) if isinstance(asset, Mapping)]
    if not assets:
        return dict(normalized)
    secrets = provider_secrets()
    api_key = secrets.get("bailian_upload") or secrets.get("happyhorse") or ""
    if not api_key:
        raise AiVideoError("百炼 OSS 上传 API Key 未配置，无法上传本地素材", code="CREDENTIAL_MISSING")
    prepared = dict(normalized)
    params = dict(prepared.get("parameters") or {})
    if model in KLING_MODELS:
        media = [dict(item) for item in (params.get("media") or []) if isinstance(item, Mapping)]
        for asset in sorted(assets, key=lambda item: int(item.get("sortOrder") or 0)):
            role = _compact(asset.get("role")) or "first_frame"
            url = _upload_file_to_bailian_temp_storage(
                api_key=api_key,
                model=model,
                path=Path(_compact(asset.get("localPath"))),
            )
            item = {"type": role, "url": url}
            keep_sound = _compact(asset.get("keep_original_sound") or asset.get("keepOriginalSound"))
            if keep_sound:
                item["keep_original_sound"] = keep_sound
            media.append(item)
        _validate_kling_media(media, model=model)
        params["media"] = media
    elif model == PIXVERSE_MOTIONCONTROL_MODEL:
        for asset in assets:
            role = _compact(asset.get("role"))
            url = _upload_file_to_bailian_temp_storage(
                api_key=api_key,
                model=model,
                path=Path(_compact(asset.get("localPath"))),
            )
            if role == "image_url":
                params["imageUrl"] = url
            elif role == "video_url":
                params["videoUrl"] = url
            else:
                raise AiVideoError("PixVerse 本地素材角色仅支持 image_url / video_url")
        _validate_pixverse_media_sources(
            image_count=1 if params.get("imageUrl") else 0,
            video_count=1 if params.get("videoUrl") else 0,
        )
    prepared["parameters"] = params
    return prepared


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
    if provider_value not in {"seedance", "happyhorse"}:
        raise AiVideoError("不支持的 provider")
    if model_value in UI_MODEL_IDS:
        meta = UI_MODEL_IDS[model_value]
        if provider_value != meta["provider"]:
            raise AiVideoError("provider 与 model 不匹配")
        return provider_value, meta["model"]
    if provider_value == "seedance":
        if model_value != SEEDANCE_MODEL:
            raise AiVideoError("Seedance 模型必须是 doubao-seedance-2-0-260128")
        return "seedance", SEEDANCE_MODEL
    if provider_value == "happyhorse":
        if model_value not in BAILIAN_MODEL_IDS:
            raise AiVideoError("百炼视频模型必须是 HappyHorse、Kling v3、Kling Omni 或 PixVerse Motion Control")
        return "happyhorse", model_value
    raise AiVideoError("不支持的 provider 或 model")


def model_short(model: str) -> str:
    value = _compact(model)
    if value == SEEDANCE_MODEL:
        return "seedance2"
    if value.startswith("happyhorse-"):
        return value.replace("happyhorse-", "hh-")
    if value == KLING_V3_MODEL:
        return "kling-v3"
    if value == KLING_OMNI_MODEL:
        return "kling-omni"
    if value == PIXVERSE_MOTIONCONTROL_MODEL:
        return "pixverse-motion"
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


def _video_mime_for_path(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".mp4", ".m4v"}:
        return "video/mp4"
    if suffix == ".mov":
        return "video/quicktime"
    if suffix == ".webm":
        return "video/webm"
    return mimetypes.guess_type(str(path))[0] or ""


def _inspect_video(path: Path) -> dict:
    if not path.is_file():
        raise AiVideoError(f"参考视频不存在：{path}")
    if path.suffix.lower() not in ALLOWED_VIDEO_EXTS:
        raise AiVideoError("视频格式仅允许 MP4、MOV、M4V、WEBM")
    size = path.stat().st_size
    if size > 200 * 1024 * 1024:
        raise AiVideoError("本地视频不能超过 200MB")
    mime = _video_mime_for_path(path)
    if mime not in ALLOWED_VIDEO_MIME:
        raise AiVideoError("视频格式仅允许 MP4、MOV、M4V、WEBM")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return {
        "kind": "video",
        "sourceType": "local_file",
        "originalName": path.name,
        "localPath": str(path.resolve()),
        "mimeType": mime,
        "width": 0,
        "height": 0,
        "sizeBytes": int(size),
        "sha256": digest,
    }


def _asset_role_to_media_type(role: Any, model: str) -> str:
    value = _compact(role)
    if value:
        return value
    if model == PIXVERSE_MOTIONCONTROL_MODEL:
        return "image_url"
    if model in KLING_MODELS:
        return "first_frame"
    return "reference_image"


def _inspect_local_media(path: Path, *, role: str, model: str) -> dict:
    media_type = _asset_role_to_media_type(role, model)
    if media_type in {"feature", "base", "video_url"}:
        return _inspect_video(path)
    return _inspect_image(path)


def _normalise_bailian_media_item(item: Mapping[str, Any], *, model: str, index: int) -> dict:
    media_type = _compact(item.get("type") or item.get("role"))
    if not media_type:
        raise AiVideoError(f"media[{index}] 缺少 type")
    url = _require_provider_media_url(item.get("url"), f"media[{index}].url")
    result = {"type": media_type, "url": url}
    keep_sound = _compact(item.get("keep_original_sound") or item.get("keepOriginalSound"))
    if keep_sound:
        result["keep_original_sound"] = keep_sound
    return result


def _normalise_media_list(value: Any, *, model: str) -> list[dict]:
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise AiVideoError("media 必须是数组")
    media = []
    for index, item in enumerate(value):
        if not isinstance(item, Mapping):
            raise AiVideoError(f"media[{index}] 必须是对象")
        media.append(_normalise_bailian_media_item(item, model=model, index=index))
    return media


def _validate_kling_media(media: list[Mapping[str, Any]], *, model: str) -> None:
    if not media:
        return
    allowed = KLING_V3_MEDIA_TYPES if model == KLING_V3_MODEL else KLING_OMNI_MEDIA_TYPES
    counts = {"first_frame": 0, "last_frame": 0, "base": 0, "feature": 0}
    for index, item in enumerate(media):
        media_type = _compact(item.get("type") or item.get("role"))
        if media_type not in allowed:
            raise AiVideoError(f"{model_short(model)} 不支持 media 类型：{media_type or index}")
        if media_type in counts:
            counts[media_type] += 1
    if counts["last_frame"] and counts["first_frame"] != 1:
        raise AiVideoError("Kling last_frame 必须与且仅与 1 个 first_frame 配对")
    if counts["first_frame"] > 1 or counts["last_frame"] > 1 or counts["base"] > 1 or counts["feature"] > 1:
        raise AiVideoError("Kling first_frame、last_frame、base、feature 均最多 1 个")


def _validate_pixverse_media_sources(*, image_count: int, video_count: int) -> None:
    if image_count != 1 or video_count != 1:
        raise AiVideoError("PixVerse Motion Control 必须且只能提供 1 张角色图和 1 条动作视频")


def _reject_hidden_fields(parameters: Mapping[str, Any]) -> None:
    for key in parameters.keys():
        if str(key) in HIDDEN_REQUEST_FIELDS:
            raise AiVideoError(f"不允许提交隐藏字段：{key}")


def _is_http_url(value: Any) -> bool:
    text = _compact(value)
    if not text:
        return False
    try:
        parsed = urllib.parse.urlparse(text)
    except Exception:
        return False
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _is_bailian_oss_url(value: Any) -> bool:
    text = _compact(value)
    if not text:
        return False
    try:
        parsed = urllib.parse.urlparse(text)
    except Exception:
        return False
    return parsed.scheme == "oss" and bool(parsed.netloc) and bool(parsed.path.strip("/"))


def _is_provider_media_url(value: Any) -> bool:
    return _is_http_url(value) or _is_bailian_oss_url(value)


def _require_http_url(value: Any, label: str) -> str:
    text = _compact(value)
    if not _is_http_url(text):
        raise AiVideoError(f"{label} 必须是 HTTP/HTTPS URL")
    return text


def _require_provider_media_url(value: Any, label: str) -> str:
    text = _compact(value)
    if not _is_provider_media_url(text):
        raise AiVideoError(f"{label} 必须是 HTTP/HTTPS URL 或百炼临时 oss:// URL")
    return text


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
        if model in KLING_MODELS:
            kling_mode = _compact(source.get("mode")) or "std"
            if kling_mode not in KLING_MODES:
                raise AiVideoError("Kling mode 仅支持 std / pro")
            aspect_ratio = _compact(source.get("aspect_ratio") or source.get("aspectRatio")) or "16:9"
            if aspect_ratio not in KLING_ASPECT_RATIOS:
                raise AiVideoError("Kling aspect_ratio 仅支持 16:9 / 9:16 / 1:1")
            media = _normalise_media_list(source.get("media"), model=model)
            _validate_kling_media(media, model=model)
            try:
                duration = int(source.get("duration") if source.get("duration") is not None else 5)
            except Exception as exc:
                raise AiVideoError("duration 必须是整数") from exc
            if not 3 <= duration <= 15:
                raise AiVideoError("Kling duration 必须是 3-15 的整数")
            audio = source.get("audio")
            if audio is None:
                audio = source.get("generateAudio", False)
            return {
                "mode": kling_mode,
                "aspect_ratio": aspect_ratio,
                "duration": duration,
                "audio": bool(audio),
                "watermark": bool(source.get("watermark", False)),
                "media": media,
            }
        if model == PIXVERSE_MOTIONCONTROL_MODEL:
            resolution = _compact(source.get("resolution")) or "720P"
            resolution = resolution.upper()
            if resolution not in PIXVERSE_RESOLUTIONS:
                raise AiVideoError("PixVerse resolution 仅支持 360P/540P/720P")
            image_url = _compact(source.get("imageUrl") or source.get("image_url") or source.get("characterImageUrl"))
            video_url = _compact(source.get("videoUrl") or source.get("video_url") or source.get("motionVideoUrl"))
            return {
                "imageUrl": _require_provider_media_url(image_url, "PixVerse 角色图 URL") if image_url else "",
                "videoUrl": _require_provider_media_url(video_url, "PixVerse 动作视频 URL") if video_url else "",
                "resolution": resolution,
                "watermark": bool(source.get("watermark", False)),
            }
        raise AiVideoError("未知百炼视频模型")
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


def _validate_input(payload: Mapping[str, Any], *, trusted_paths: bool) -> dict:
    provider, model = resolve_model(payload.get("provider"), payload.get("model"))
    prompt = _compact(payload.get("prompt"))
    if model != PIXVERSE_MOTIONCONTROL_MODEL and not prompt:
        raise AiVideoError("Prompt 不能为空")
    if len(prompt) > 4000:
        raise AiVideoError("Prompt 不能超过 4000 字符")
    parameters = normalize_parameters(provider, model, payload.get("parameters") if isinstance(payload.get("parameters"), Mapping) else {})
    if trusted_paths:
        raw_output_dir = _compact(payload.get("outputDir") or payload.get("output_dir"))
        if not raw_output_dir:
            raw_output_dir = str(default_output_dir())
        output_dir = _validated_output_dir(Path(raw_output_dir))
    else:
        if _compact(payload.get("outputDir") or payload.get("output_dir")):
            raise AiVideoError("输出目录必须使用授权 token", code="PATH_CAPABILITY_REQUIRED")
        output_token = _compact(payload.get("outputDirToken") or payload.get("output_dir_token"))
        if not output_token:
            raise AiVideoError("缺少输出目录授权", code="PATH_CAPABILITY_REQUIRED")
        output_dir = verify_path_capability(
            output_token,
            expected_kind="directory",
            expected_scope="output",
        )

    asset_inputs = list(payload.get("assets") or [])
    assets: list[dict] = []
    for index, item in enumerate(asset_inputs):
        source = dict(item or {})
        if trusted_paths:
            path_value = _compact(source.get("localPath") or source.get("local_path") or source.get("path"))
            if not path_value:
                raise AiVideoError("参考图路径不能为空")
            path = _validated_existing_file(Path(path_value))
        else:
            if _compact(source.get("localPath") or source.get("local_path") or source.get("path")):
                raise AiVideoError("参考图必须使用授权 token", code="PATH_CAPABILITY_REQUIRED")
            file_token = _compact(source.get("fileToken") or source.get("file_token"))
            if not file_token:
                raise AiVideoError("缺少参考图授权", code="PATH_CAPABILITY_REQUIRED")
            path = verify_path_capability(
                file_token,
                expected_kind="file",
                expected_scope="input",
            )
        role = _asset_role_to_media_type(
            source.get("role"),
            model,
        ) or ("first_frame" if model.endswith("-i2v") else "reference_image")
        inspected = _inspect_local_media(path, role=role, model=model) if model in BAILIAN_GATEWAY_MODELS else _inspect_image(path)
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
    elif model in KLING_MODELS:
        media_sources = list(parameters.get("media") or [])
        media_sources.extend({"type": asset.get("role")} for asset in assets)
        _validate_kling_media(media_sources, model=model)
    elif model == PIXVERSE_MOTIONCONTROL_MODEL:
        image_count = 1 if parameters.get("imageUrl") else 0
        video_count = 1 if parameters.get("videoUrl") else 0
        for asset in assets:
            role = _compact(asset.get("role"))
            if role == "image_url":
                image_count += 1
            elif role == "video_url":
                video_count += 1
            else:
                raise AiVideoError("PixVerse 本地素材角色仅支持 image_url / video_url")
        _validate_pixverse_media_sources(image_count=image_count, video_count=video_count)
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
    if model == PIXVERSE_MOTIONCONTROL_MODEL and prompt:
        warnings.append("PixVerse Motion Control 不使用 Prompt；请确认角色图 URL 和动作视频 URL 描述了目标内容")

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


def validate_input(payload: Mapping[str, Any]) -> dict:
    """Validate an untrusted renderer/HTTP request using signed path capabilities."""
    return _validate_input(payload, trusted_paths=False)


def validate_public_input(payload: Mapping[str, Any]) -> dict:
    """Validate a renderer request and return only path-free public metadata."""
    normalized = validate_input(payload)
    assets = []
    for item in normalized.get("assets") or []:
        if not isinstance(item, Mapping):
            continue
        local_path = _compact(item.get("localPath"))
        assets.append({
            "name": _compact(item.get("originalName") or item.get("name"))
            or (Path(local_path).name if local_path else ""),
            "mimeType": _compact(item.get("mimeType")),
            "width": int(item.get("width") or 0),
            "height": int(item.get("height") or 0),
            "sizeBytes": int(item.get("sizeBytes") or 0),
            "role": _compact(item.get("role")) or "reference_image",
            "sortOrder": int(item.get("sortOrder") or 0),
        })
    return {
        "provider": normalized.get("provider"),
        "model": normalized.get("model"),
        "parameters": normalized.get("parameters") or {},
        "assets": assets,
        "configured": bool(normalized.get("configured")),
        "cliReady": bool(normalized.get("cliReady")),
        "warnings": list(normalized.get("warnings") or []),
        "needsConfig": bool(normalized.get("needsConfig")),
    }


def _validate_trusted_input(payload: Mapping[str, Any]) -> dict:
    """Validate paths already persisted by the backend; never expose this through HTTP/IPC."""
    return _validate_input(payload, trusted_paths=True)


def _reference_asset_bytes(asset: Mapping[str, Any]) -> bytes:
    path_value = _compact(asset.get("localPath") or asset.get("local_path"))
    expected_sha256 = _compact(asset.get("sha256")).lower()
    if not path_value or not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        raise AiVideoError("参考图完整性信息缺失，请重新选择后重试")

    path = Path(path_value).expanduser()
    if not path.is_absolute() or not path.name:
        raise AiVideoError("参考图在提交前已变化，请重新选择后重试")

    directory_fd: Optional[int] = None
    file_fd: Optional[int] = None
    try:
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_CLOEXEC", 0)
        supports_dir_fd = getattr(os, "supports_dir_fd", set())
        if hasattr(os, "O_NOFOLLOW") and os.open in supports_dir_fd and os.stat in supports_dir_fd:
            directory_fd = _open_directory_no_follow(path.parent)
            file_fd = os.open(path.name, flags | os.O_NOFOLLOW, dir_fd=directory_fd)
            opened = os.fstat(file_fd)
            current = os.stat(path.name, dir_fd=directory_fd, follow_symlinks=False)
        else:
            before = os.stat(path, follow_symlinks=False)
            if not stat.S_ISREG(before.st_mode):
                raise OSError("reference path is not a regular file")
            file_fd = os.open(path, flags)
            opened = os.fstat(file_fd)
            current = os.stat(path, follow_symlinks=False)
            if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino):
                raise OSError("reference path changed while opening")

        if not stat.S_ISREG(opened.st_mode) or not stat.S_ISREG(current.st_mode):
            raise OSError("reference path is not a regular file")
        if (opened.st_dev, opened.st_ino) != (current.st_dev, current.st_ino):
            raise OSError("reference path changed while opening")
        if opened.st_size > 20 * 1024 * 1024:
            raise OSError("reference image is too large")

        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(file_fd, 256 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > 20 * 1024 * 1024:
                raise OSError("reference image is too large")
            chunks.append(chunk)
        payload = b"".join(chunks)
        if hashlib.sha256(payload).hexdigest() != expected_sha256:
            raise OSError("reference image digest changed")
        return payload
    except (AiVideoError, OSError) as exc:
        raise AiVideoError("参考图在提交前已变化，请重新选择后重试") from exc
    finally:
        if file_fd is not None:
            try:
                os.close(file_fd)
            except OSError:
                pass
        if directory_fd is not None:
            try:
                os.close(directory_fd)
            except OSError:
                pass


def _reference_asset_data_url(asset: Mapping[str, Any]) -> str:
    mime = _compact(asset.get("mimeType") or asset.get("mime_type"))
    if mime not in ALLOWED_MIME:
        suffix = Path(_compact(asset.get("localPath") or asset.get("local_path"))).suffix.lower()
        mime = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
        }.get(suffix, "")
    if mime not in ALLOWED_MIME:
        raise AiVideoError("参考图格式无效，请重新选择后重试")
    encoded = base64.b64encode(_reference_asset_bytes(asset)).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def build_seedance_payload(normalized: Mapping[str, Any]) -> dict:
    content: list[dict] = [{"type": "text", "text": normalized["prompt"]}]
    for asset in normalized.get("assets") or []:
        path = _compact(asset.get("localPath"))
        if not path:
            continue
        content.append({
            "type": "image_url",
            "image_url": {"url": _reference_asset_data_url(asset)},
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
        url = _reference_asset_data_url(assets[0])
        input_payload["media"] = [{"type": "first_frame", "url": url}]
    elif mode == "r2v":
        input_payload["media"] = [
            {"type": "reference_image", "url": _reference_asset_data_url(asset)}
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


def build_bailian_payload(normalized: Mapping[str, Any]) -> dict:
    model = normalized["model"]
    if model in HAPPYHORSE_MODELS:
        return build_happyhorse_payload(normalized)

    params = dict(normalized.get("parameters") or {})
    if model in KLING_MODELS:
        media = list(params.get("media") or [])
        input_payload = {
            "prompt": normalized["prompt"],
        }
        if media:
            input_payload["media"] = media
        parameters = {
            "mode": params.get("mode") or "std",
            "duration": int(params.get("duration") or 5),
            "audio": bool(params.get("audio", False)),
            "watermark": bool(params.get("watermark", False)),
        }
        if not media:
            parameters["aspect_ratio"] = params.get("aspect_ratio") or "16:9"
        return {
            "model": model,
            "input": input_payload,
            "parameters": parameters,
        }

    if model == PIXVERSE_MOTIONCONTROL_MODEL:
        return {
            "model": model,
            "input": {
                "media": [
                    {"type": "image_url", "url": params["imageUrl"]},
                    {"type": "video_url", "url": params["videoUrl"]},
                ],
            },
            "parameters": {
                "resolution": params.get("resolution") or "720P",
                "watermark": bool(params.get("watermark", False)),
            },
        }

    raise AiVideoError("未知百炼视频模型")


def build_provider_payload(normalized: Mapping[str, Any]) -> dict:
    if normalized["provider"] == "seedance":
        return build_seedance_payload(normalized)
    return build_bailian_payload(normalized)


def archive_dir_for(job_id: str, run_id: str, output_root: Path, created_at: Optional[str] = None) -> Path:
    day = datetime.now().strftime("%Y-%m-%d")
    if created_at:
        try:
            day = datetime.fromisoformat(created_at).strftime("%Y-%m-%d")
        except Exception:
            pass
    return Path(output_root).expanduser() / day / job_id / run_id


def _secure_mkdir_tree(path: Path) -> Path:
    absolute = path.expanduser().absolute()
    current = Path(absolute.anchor)
    for part in absolute.parts[1:]:
        current = current / part
        if current.is_symlink():
            raise AiVideoError("输出路径包含符号链接", code="ARCHIVE_WRITE_FAILED")
        if current.exists():
            if not current.is_dir():
                raise AiVideoError("输出路径不是目录", code="ARCHIVE_WRITE_FAILED")
            continue
        try:
            current.mkdir(mode=0o700)
        except FileExistsError:
            if current.is_symlink() or not current.is_dir():
                raise AiVideoError("输出路径创建发生安全冲突", code="ARCHIVE_WRITE_FAILED")
        except OSError as exc:
            raise AiVideoError(
                "输出目录不可写",
                code="ARCHIVE_WRITE_FAILED",
                safe_suggestion="重新选择有写入权限的输出目录",
            ) from exc
    return absolute


def _secure_prepare_archive_dir(output_root: Path, archive_dir: Path) -> Path:
    try:
        safe_root = _validated_output_dir(output_root)
    except AiVideoError as exc:
        raise AiVideoError(
            str(exc),
            code="ARCHIVE_WRITE_FAILED",
            safe_suggestion=exc.safe_suggestion,
        ) from exc
    target = archive_dir.expanduser().absolute()
    try:
        target.relative_to(safe_root)
    except ValueError as exc:
        raise AiVideoError("归档路径超出授权输出目录", code="ARCHIVE_WRITE_FAILED") from exc
    _secure_mkdir_tree(safe_root)
    _assert_no_symlink_components(safe_root)
    _secure_mkdir_tree(target)
    _assert_no_symlink_components(target)
    if target.resolve(strict=True) != target:
        raise AiVideoError("归档路径包含符号链接", code="ARCHIVE_WRITE_FAILED")
    return target


def output_filename(provider: str, model: str, job_id: str, run_id: str, created_at: Optional[str] = None) -> str:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    if created_at:
        try:
            stamp = datetime.fromisoformat(created_at).strftime("%Y%m%d-%H%M%S")
        except Exception:
            pass
    return f"{stamp}-{provider}-{model_short(model)}-{job_id[-4:]}-{run_id[-4:]}.mp4"


def _secure_archive_dirfd_available() -> bool:
    supports_dir_fd = getattr(os, "supports_dir_fd", set())
    required_dirfd_calls = (os.open, os.mkdir, os.stat, os.unlink, os.rename)
    return (
        hasattr(os, "O_DIRECTORY")
        and hasattr(os, "O_NOFOLLOW")
        and all(call in supports_dir_fd for call in required_dirfd_calls)
    )


def _directory_open_flags() -> int:
    if not _secure_archive_dirfd_available():
        raise AiVideoError(
            "当前系统不支持安全归档写入",
            code="ARCHIVE_WRITE_FAILED",
        )
    return os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)


def _open_directory_no_follow(path: Path) -> int:
    absolute = path.expanduser().absolute()
    if not absolute.is_absolute():
        raise AiVideoError("归档目录必须是绝对路径", code="ARCHIVE_WRITE_FAILED")
    component_flags = _directory_open_flags()
    root_flags = os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_CLOEXEC", 0)
    directory_fd: Optional[int] = None
    try:
        directory_fd = os.open(absolute.anchor, root_flags)
        for component in absolute.parts[1:]:
            child_fd = os.open(component, component_flags, dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = child_fd
        return directory_fd
    except OSError as exc:
        if directory_fd is not None:
            try:
                os.close(directory_fd)
            except OSError:
                pass
        raise AiVideoError(
            "归档目录在写入前发生安全变化",
            code="ARCHIVE_WRITE_FAILED",
        ) from exc


def _atomic_write_bytes_at(directory_fd: int, name: str, payload: bytes) -> None:
    if not name or Path(name).name != name:
        raise AiVideoError("归档文件名无效", code="ARCHIVE_WRITE_FAILED")
    temporary_name = f".{name}.{uuid4().hex}.tmp"
    file_fd: Optional[int] = None
    try:
        file_fd = os.open(
            temporary_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
            0o600,
            dir_fd=directory_fd,
        )
        remaining = memoryview(payload)
        while remaining:
            written = os.write(file_fd, remaining)
            if written <= 0:
                raise OSError("short archive write")
            remaining = remaining[written:]
        os.fsync(file_fd)
        os.close(file_fd)
        file_fd = None
        os.rename(
            temporary_name,
            name,
            src_dir_fd=directory_fd,
            dst_dir_fd=directory_fd,
        )
    except OSError as exc:
        raise AiVideoError("归档文件安全写入失败", code="ARCHIVE_WRITE_FAILED") from exc
    finally:
        if file_fd is not None:
            try:
                os.close(file_fd)
            except OSError:
                pass
        try:
            os.unlink(temporary_name, dir_fd=directory_fd)
        except FileNotFoundError:
            pass
        except OSError:
            pass


def _read_optional_bytes_at(directory_fd: int, name: str) -> bytes:
    file_fd: Optional[int] = None
    try:
        file_fd = os.open(
            name,
            os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
            dir_fd=directory_fd,
        )
        chunks = []
        while True:
            chunk = os.read(file_fd, 256 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
        return b"".join(chunks)
    except FileNotFoundError:
        return b""
    except OSError as exc:
        raise AiVideoError("归档事件文件读取失败", code="ARCHIVE_WRITE_FAILED") from exc
    finally:
        if file_fd is not None:
            try:
                os.close(file_fd)
            except OSError:
                pass


def _write_archive_json(archive_dir: Path, name: str, value: Any) -> None:
    if not _secure_archive_dirfd_available():
        logger.warning("Skipping optional AI video archive JSON: secure dir-fd writes are unavailable")
        return
    directory_fd = _open_directory_no_follow(archive_dir)
    try:
        payload = json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8")
        _atomic_write_bytes_at(directory_fd, name, payload)
    finally:
        os.close(directory_fd)


def _append_archive_event(archive_dir: Path, value: Mapping[str, Any]) -> None:
    if not _secure_archive_dirfd_available():
        logger.warning("Skipping optional AI video archive event: secure dir-fd writes are unavailable")
        return
    directory_fd = _open_directory_no_follow(archive_dir)
    try:
        existing = _read_optional_bytes_at(directory_fd, "events.jsonl")
        line = (json.dumps(dict(value), ensure_ascii=False) + "\n").encode("utf-8")
        _atomic_write_bytes_at(directory_fd, "events.jsonl", existing + line)
    finally:
        os.close(directory_fd)


def _write_run_artifacts(archive_dir: Path, *, normalized: Mapping[str, Any], provider_payload: Mapping[str, Any], event: str) -> None:
    if not _secure_archive_dirfd_available():
        logger.warning("Skipping optional AI video run artifacts: secure dir-fd writes are unavailable")
        return
    _secure_mkdir_tree(archive_dir)
    directory_fd = _open_directory_no_follow(archive_dir)
    input_fd: Optional[int] = None
    try:
        _atomic_write_bytes_at(
            directory_fd,
            "request.normalized.json",
            json.dumps(redact_obj(dict(normalized)), ensure_ascii=False, indent=2).encode("utf-8"),
        )
        _atomic_write_bytes_at(
            directory_fd,
            "request.provider.redacted.json",
            json.dumps(redact_obj(dict(provider_payload)), ensure_ascii=False, indent=2).encode("utf-8"),
        )
        existing_events = _read_optional_bytes_at(directory_fd, "events.jsonl")
        event_line = json.dumps({"at": _now_iso(), "event": event}, ensure_ascii=False).encode("utf-8") + b"\n"
        _atomic_write_bytes_at(directory_fd, "events.jsonl", existing_events + event_line)
        try:
            os.mkdir("input", mode=0o700, dir_fd=directory_fd)
        except FileExistsError:
            pass
        except OSError as exc:
            raise AiVideoError("归档输入目录创建失败", code="ARCHIVE_WRITE_FAILED") from exc
        try:
            input_fd = os.open("input", _directory_open_flags(), dir_fd=directory_fd)
        except OSError as exc:
            raise AiVideoError("归档输入目录发生安全变化", code="ARCHIVE_WRITE_FAILED") from exc
        for index, asset in enumerate(normalized.get("assets") or [], start=1):
            src = _compact(asset.get("localPath"))
            if not src:
                continue
            source_path = _validated_existing_file(Path(src))
            target_name = f"image-{index:02d}{source_path.suffix.lower() or '.jpg'}"
            try:
                existing = os.stat(target_name, dir_fd=input_fd, follow_symlinks=False)
            except FileNotFoundError:
                existing = None
            except OSError as exc:
                raise AiVideoError("归档输入文件校验失败", code="ARCHIVE_WRITE_FAILED") from exc
            if existing is not None:
                if not stat.S_ISREG(existing.st_mode):
                    raise AiVideoError("归档输入文件类型不安全", code="ARCHIVE_WRITE_FAILED")
                continue
            _atomic_write_bytes_at(input_fd, target_name, source_path.read_bytes())
    finally:
        if input_fd is not None:
            os.close(input_fd)
        os.close(directory_fd)


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
    try:
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
    except data_sink.AiVideoRequestUidConflictError as exc:
        raise AiVideoError(
            "requestUid 已被其他执行使用",
            code="REQUEST_UID_CONFLICT",
            retryable=False,
            safe_suggestion="请为本次创建生成新的 requestUid",
            http_status=409,
        ) from exc
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
            "kind": asset.get("kind"),
            "role": asset.get("role"),
            "sourceType": asset.get("sourceType"),
            "originalName": asset.get("originalName"),
            "localPath": asset.get("localPath"),
            "mimeType": asset.get("mimeType"),
            "width": asset.get("width"),
            "height": asset.get("height"),
            "sizeBytes": asset.get("sizeBytes"),
            "sha256": asset.get("sha256"),
            "sortOrder": asset.get("sortOrder"),
        })
    input_snapshot = {
        "prompt": job.get("prompt") or "",
        "assets": assets,
        "parameters": job.get("parameters") or {},
    }
    created = data_sink.create_ai_video_job_with_run(
        job_payload={
            "requestUid": request_uid,
            "title": job_title_from_prompt(job.get("prompt") or ""),
            "status": "draft",
            "provider": job.get("provider"),
            "model": job.get("model"),
            "prompt": job.get("prompt"),
            "parameters": job.get("parameters") or {},
            "outputDir": job.get("outputDir"),
        },
        assets=assets,
        run_payload={
            "requestUid": request_uid,
            "status": "draft",
            "provider": job.get("provider"),
            "model": job.get("model"),
            "inputSnapshot": input_snapshot,
            "archiveStatus": "none",
        },
    )
    return {
        "ok": True,
        "data": {
            "job": public_job(created["job"]),
            "run": public_run(created["run"]),
        },
        "reused": bool(created.get("reused")),
    }


def retry_job(job_id: str, request_uid: str) -> dict:
    job = data_sink.get_ai_video_job(job_id)
    if not job or job.get("deletedAt"):
        raise AiVideoError("任务不存在", code="VALIDATION_FAILED", http_status=404)
    request = _compact(request_uid)
    if not request:
        raise AiVideoError("requestUid 必填")
    existing_run = data_sink.get_ai_video_run_by_request_uid(request)
    if existing_run:
        if _compact(existing_run.get("jobId")) != _compact(job_id):
            raise AiVideoError(
                "requestUid 已被其他任务使用",
                code="REQUEST_UID_CONFLICT",
                retryable=False,
                safe_suggestion="请为本次重试生成新的 requestUid",
                http_status=409,
            )
        return {"ok": True, "data": {"job": public_job(job), "run": public_run(existing_run)}, "reused": True}
    if job.get("status") in ACTIVE_STATUSES:
        raise AiVideoError("任务仍在执行中，请等待完成后再重试")
    current_run = data_sink.get_ai_video_run(job.get("currentRunId") or "") or {}
    current_error = current_run.get("error") if isinstance(current_run.get("error"), Mapping) else {}
    if _compact(current_error.get("code")) == "UNKNOWN_SUBMIT_RESULT":
        raise AiVideoError(
            "远端提交结果未知，禁止直接重试以避免重复扣费",
            code="UNKNOWN_SUBMIT_RESULT",
            retryable=False,
            safe_suggestion="请先核对 provider 任务；需要调整时可复制为新草稿",
            http_status=409,
        )

    assets = []
    for asset in job.get("assets") or []:
        assets.append({
            "role": asset.get("role"),
            "localPath": asset.get("localPath"),
            "sortOrder": asset.get("sortOrder"),
        })
    normalized = _validate_trusted_input({
        "provider": job.get("provider"),
        "model": job.get("model"),
        "prompt": job.get("prompt"),
        "parameters": job.get("parameters") or {},
        "assets": assets,
        "outputDir": job.get("outputDir"),
    })
    if normalized["needsConfig"]:
        raise AiVideoError(
            "视频供应商尚未配置完成，不能创建重试任务",
            code="NEEDS_CONFIG",
            retryable=True,
            safe_suggestion="请先在设置中的 AI 能力完成对应 provider 配置",
            http_status=409,
        )
    status = "queued"
    try:
        run = data_sink.create_ai_video_run({
            "requestUid": request,
            "jobId": job["id"],
            "expectedJobStatus": job.get("status"),
            "expectedCurrentRunId": job.get("currentRunId"),
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
    except data_sink.AiVideoRequestUidConflictError as exc:
        raise AiVideoError(
            "requestUid 已被其他任务使用",
            code="REQUEST_UID_CONFLICT",
            retryable=False,
            safe_suggestion="请为本次重试生成新的 requestUid",
            http_status=409,
        ) from exc
    except data_sink.AiVideoRetryConflictError as exc:
        raise AiVideoError(
            "任务状态已变化，本次重试未创建",
            code="RETRY_CONFLICT",
            retryable=True,
            safe_suggestion="请刷新任务状态后再重试",
            http_status=409,
        ) from exc
    if run.get("_reused"):
        current_job = data_sink.get_ai_video_job(job["id"]) or job
        return {
            "ok": True,
            "data": {"job": public_job(current_job), "run": public_run(run)},
            "reused": True,
        }
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
    run_id = _compact(job.get("currentRunId"))
    lock = _run_lock(run_id) if run_id else None
    if lock:
        lock.acquire()
    try:
        job = data_sink.get_ai_video_job(job_id)
        if not job or job.get("deletedAt"):
            raise AiVideoError("任务不存在", code="VALIDATION_FAILED", http_status=404)
        status = _compact(job.get("status"))
        current_run_id = _compact(job.get("currentRunId"))
        run = data_sink.get_ai_video_run(current_run_id) or {}
        if status == "queued" and current_run_id == run_id and not _compact(run.get("providerTaskId")):
            cancelled_run = data_sink.cancel_ai_video_run_if_unsubmitted(run_id)
            if cancelled_run:
                return {"ok": True, "data": {"id": job_id, "status": "cancelled"}}
            job = data_sink.get_ai_video_job(job_id) or job
            status = _compact(job.get("status"))
            run = data_sink.get_ai_video_run(job.get("currentRunId") or "") or run
        if status in DELETE_BLOCKED_STATUSES or (
            status == "queued" and _compact(run.get("providerTaskId"))
        ):
            raise AiVideoError("任务已提交或运行中，不能删除记录", code="VALIDATION_FAILED", http_status=409)
        data_sink.soft_delete_ai_video_job(job_id)
        return {"ok": True, "data": {"id": job_id}}
    finally:
        if lock:
            lock.release()


def update_job(job_id: str, payload: Mapping[str, Any]) -> dict:
    job = data_sink.get_ai_video_job(job_id)
    if not job or job.get("deletedAt"):
        raise AiVideoError("任务不存在", code="VALIDATION_FAILED", http_status=404)
    if _compact(job.get("status")) not in EDITABLE_STATUSES:
        raise AiVideoError("当前状态不可编辑输入参数")
    if _compact(payload.get("outputDir") or payload.get("output_dir")):
        raise AiVideoError("输出目录必须使用授权 token", code="PATH_CAPABILITY_REQUIRED")
    output_token = _compact(payload.get("outputDirToken") or payload.get("output_dir_token"))
    if output_token:
        merged_output_dir = str(verify_path_capability(
            output_token,
            expected_kind="directory",
            expected_scope="output",
        ))
    else:
        merged_output_dir = job.get("outputDir")

    requested_assets = payload.get("assets")
    if requested_assets is None:
        merged_assets = [
            {"role": a.get("role"), "localPath": a.get("localPath"), "sortOrder": a.get("sortOrder")}
            for a in (job.get("assets") or [])
        ]
    else:
        merged_assets = []
        for index, item in enumerate(list(requested_assets or [])):
            source = dict(item or {})
            if _compact(source.get("localPath") or source.get("local_path") or source.get("path")):
                raise AiVideoError("参考图必须使用授权 token", code="PATH_CAPABILITY_REQUIRED")
            file_token = _compact(source.get("fileToken") or source.get("file_token"))
            if not file_token:
                raise AiVideoError("缺少参考图授权", code="PATH_CAPABILITY_REQUIRED")
            path = verify_path_capability(
                file_token,
                expected_kind="file",
                expected_scope="input",
            )
            merged_assets.append({
                "role": source.get("role"),
                "localPath": str(path),
                "sortOrder": source.get("sortOrder") if source.get("sortOrder") is not None else index,
            })
    merged = {
        "provider": payload.get("provider", job.get("provider")),
        "model": payload.get("model", job.get("model")),
        "prompt": payload.get("prompt", job.get("prompt")),
        "parameters": payload.get("parameters", job.get("parameters") or {}),
        "assets": merged_assets,
        "outputDir": merged_output_dir,
    }
    normalized = _validate_trusted_input(merged)
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


def _public_path_token(path_value: Any, *, kind: str, scope: str) -> Optional[str]:
    path = _compact(path_value)
    if not path:
        return None
    try:
        return issue_path_capability(path, kind=kind, scope=scope)
    except AiVideoError:
        logger.warning("Skipping unsafe or unavailable AI video public path", exc_info=True)
        return None


def _public_asset(asset: Mapping[str, Any]) -> dict:
    result = dict(asset or {})
    local_path = _compact(result.pop("localPath", None) or result.pop("local_path", None))
    name = _compact(result.get("originalName") or result.get("name"))
    if not name and local_path:
        name = Path(local_path).name
    result["name"] = name
    token = _public_path_token(local_path, kind="file", scope="input")
    if token:
        result["fileToken"] = token
    return result


def public_job(job: Mapping[str, Any]) -> dict:
    if not job:
        return {}
    current_run = job.get("currentRun")
    if not current_run and job.get("currentRunId"):
        current_run = data_sink.get_ai_video_run(job.get("currentRunId") or "")
    output_dir = _compact(job.get("outputDir"))
    output_dir_token = _public_path_token(output_dir, kind="directory", scope="output")
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
        "outputDirToken": output_dir_token,
        "outputDirName": Path(output_dir).name if output_dir else "",
        "createdAt": job.get("createdAt"),
        "updatedAt": job.get("updatedAt"),
        "deletedAt": job.get("deletedAt"),
        "assets": [_public_asset(asset) for asset in (job.get("assets") or []) if isinstance(asset, Mapping)],
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
    local_video_path = _compact(output.pop("localVideoPath", None) or output.pop("local_video_path", None))
    local_poster_path = _compact(output.pop("localPosterPath", None) or output.pop("local_poster_path", None))
    output.pop("archiveDir", None)
    output.pop("archive_dir", None)
    # Strip provider video URL from public response.
    output.pop("providerVideoUrl", None)
    output.pop("videoUrl", None)
    output.pop("video_url", None)
    if local_video_path:
        token = _public_path_token(local_video_path, kind="file", scope="media")
        if token:
            output["localVideoToken"] = token
            output["videoFileName"] = Path(local_video_path).name
    if local_poster_path:
        token = _public_path_token(local_poster_path, kind="file", scope="media")
        if token:
            output["localPosterToken"] = token
            output["posterFileName"] = Path(local_poster_path).name
    snapshot = dict(run.get("inputSnapshot") or {}) if isinstance(run.get("inputSnapshot"), Mapping) else {}
    snapshot["assets"] = [
        _public_asset(asset)
        for asset in (snapshot.get("assets") or [])
        if isinstance(asset, Mapping)
    ]
    error = run.get("error") if isinstance(run.get("error"), Mapping) else None
    return {
        "id": run.get("id"),
        "requestUid": run.get("requestUid"),
        "jobId": run.get("jobId"),
        "status": run.get("status"),
        "provider": run.get("provider"),
        "model": run.get("model"),
        "inputSnapshot": snapshot,
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
                {
                    "id": KLING_V3_MODEL,
                    "provider": "happyhorse",
                    "model": KLING_V3_MODEL,
                    "label": "Kling v3",
                    "defaults": {
                        "mode": "std",
                        "aspect_ratio": "16:9",
                        "duration": 5,
                        "audio": True,
                        "watermark": False,
                    },
                    "configured": status["happyhorse"]["configured"],
                },
                {
                    "id": KLING_OMNI_MODEL,
                    "provider": "happyhorse",
                    "model": KLING_OMNI_MODEL,
                    "label": "Kling Omni",
                    "defaults": {
                        "mode": "std",
                        "aspect_ratio": "16:9",
                        "duration": 5,
                        "audio": True,
                        "watermark": False,
                    },
                    "configured": status["happyhorse"]["configured"],
                },
                {
                    "id": PIXVERSE_MOTIONCONTROL_MODEL,
                    "provider": "happyhorse",
                    "model": PIXVERSE_MOTIONCONTROL_MODEL,
                    "label": "PixVerse Motion Control",
                    "defaults": {
                        "resolution": "720P",
                        "watermark": False,
                    },
                    "configured": status["happyhorse"]["configured"],
                },
            ],
            "defaultModelId": "seedance-2.0",
            "defaultOutputDir": str(default_output_dir()),
            "seedanceRatios": sorted(SEEDANCE_RATIOS),
            "happyhorseRatios": sorted(HAPPYHORSE_RATIOS),
            "klingAspectRatios": sorted(KLING_ASPECT_RATIOS),
            "klingModes": sorted(KLING_MODES),
            "pixverseResolutions": sorted(PIXVERSE_RESOLUTIONS),
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


def _has_submission_attempt_marker(run: Mapping[str, Any]) -> bool:
    return bool(_compact(run.get("submittedAt"))) or _compact(run.get("providerStatus")).lower() == "submitting"


def _mark_unknown_submission_attempt(run_id: str) -> None:
    error = AiVideoError(
        "检测到未完成的 provider 提交，远端结果未知",
        code="UNKNOWN_SUBMIT_RESULT",
        retryable=False,
        safe_suggestion="为避免重复扣费，本次不会自动重提；请先核对 provider 任务",
    )
    data_sink.update_ai_video_run(run_id, {
        "status": "failed",
        "error": error.as_dict(),
    })


def process_run(run_id: str, *, once: bool = False) -> None:
    lock = _run_lock(run_id)
    if not lock.acquire(blocking=False):
        return
    try:
        run = data_sink.get_ai_video_run(run_id)
        if not run:
            return
        status = _compact(run.get("status"))
        if status in {"completed", "failed", "cancelled", "expired", "needs_config"}:
            return
        if status == "queued" and not _compact(run.get("providerTaskId")):
            if _has_submission_attempt_marker(run):
                _mark_unknown_submission_attempt(run_id)
            else:
                _submit_run(run)
            run = data_sink.get_ai_video_run(run_id) or run
        if _compact(run.get("status")) in {"running", "queued"} and _compact(run.get("providerTaskId")):
            _poll_until_terminal_or_once(run_id, once=once)
            run = data_sink.get_ai_video_run(run_id) or run
        if _compact(run.get("status")) == "downloading" or (
            _compact(run.get("status")) == "running" and _provider_succeeded(run)
        ):
            _archive_run(run_id)
    finally:
        lock.release()


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
    if (
        _compact(run.get("status")) == "queued"
        and not _compact(run.get("providerTaskId"))
        and _has_submission_attempt_marker(run)
    ):
        _mark_unknown_submission_attempt(run_id)
        return
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
        provider_label = "Seedance" if provider == "seedance" else "百炼"
        error = AiVideoError(
            f"请先在 AI 能力配置 {provider_label} 凭据",
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
        provider_normalized = _with_bailian_temp_uploaded_assets(normalized)
        provider_payload = build_provider_payload(provider_normalized)
    except AiVideoError as exc:
        data_sink.update_ai_video_run(run_id, {
            "status": "needs_config" if exc.code in {"CREDENTIAL_MISSING", "NEEDS_CONFIG"} else "failed",
            "error": exc.as_dict(),
        })
        return
    except Exception as exc:
        error = AiVideoError(str(exc), code="VALIDATION_FAILED")
        data_sink.update_ai_video_run(run_id, {"status": "failed", "error": error.as_dict()})
        return

    archive_root = Path(normalized["outputDir"]).expanduser().absolute()
    archive_dir = archive_dir_for(run.get("jobId") or "job", run_id, archive_root, run.get("createdAt"))
    payload_path: Optional[Path] = None
    try:
        archive_dir = _secure_prepare_archive_dir(archive_root, archive_dir)
        _write_run_artifacts(archive_dir, normalized=provider_normalized, provider_payload=provider_payload, event="submit_start")
        payload_path = runtime_paths.child_dir("ai-video-generation") / f"payload-{run_id}.json"
        payload_path.parent.mkdir(parents=True, exist_ok=True)
        # Write raw payload for CLI only; redacted copy already archived.
        payload_path.write_text(json.dumps(provider_payload, ensure_ascii=False), encoding="utf-8")
        data_sink.update_ai_video_run(run_id, {
            "status": "queued",
            "providerStatus": "submitting",
            "submittedAt": _now_iso(),
            "error": {},
        })
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
            _write_archive_json(archive_dir, "response.provider.redacted.json", redact_obj(created))
            return
        data_sink.update_ai_video_run(run_id, {
            "status": "running",
            "providerTaskId": task_id,
            "providerStatus": provider_status_value,
            "submittedAt": _now_iso(),
            "error": {},
        })
        _write_archive_json(archive_dir, "response.provider.redacted.json", redact_obj(created))
        _append_archive_event(
            archive_dir,
            {"at": _now_iso(), "event": "submitted", "providerTaskId": task_id},
        )
    except AiVideoError as exc:
        if exc.code == "PROVIDER_TIMEOUT":
            exc = AiVideoError(
                "create 执行超时，远端提交结果未知",
                code="UNKNOWN_SUBMIT_RESULT",
                retryable=False,
                safe_suggestion="为避免重复扣费，请先核对 provider 任务；不要直接重试",
            )
        status_value = "needs_config" if exc.code in {"CREDENTIAL_MISSING", "NEEDS_CONFIG"} else "failed"
        data_sink.update_ai_video_run(run_id, {"status": status_value, "error": exc.as_dict()})
    except Exception as exc:
        error = AiVideoError(
            f"提交失败：{exc}",
            code="UNKNOWN_SUBMIT_RESULT",
            safe_suggestion="为避免重复扣费，本次不会自动重提；请确认后复制为新任务",
        )
        data_sink.update_ai_video_run(run_id, {"status": "failed", "error": error.as_dict()})
    finally:
        if payload_path is not None:
            try:
                payload_path.unlink(missing_ok=True)
            except TypeError:
                if payload_path.exists():
                    payload_path.unlink()
            except OSError:
                logger.warning("Failed to remove raw AI video provider payload %s", payload_path, exc_info=True)


def _poll_until_terminal_or_once(run_id: str, *, once: bool = False) -> None:
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
                terminal = provider_status_value.upper() in {"SUCCEEDED", "FAILED", "CANCELED"}
                provider_status_value = provider_status_value.upper()
        except AiVideoError as exc:
            if exc.retryable:
                active_status = _compact(run.get("status"))
                if active_status not in ACTIVE_STATUSES:
                    active_status = "running"
                data_sink.update_ai_video_run(run_id, {
                    "status": active_status,
                    "error": exc.as_dict(),
                })
                if waited_seconds(run) >= POLL_TIMEOUT_SECONDS:
                    _expire_polled_run(run_id, provider_status_value=_compact(run.get("providerStatus")))
                    return
                if once:
                    return
                time.sleep(POLL_INTERVAL_SECONDS)
                continue
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

        if waited_seconds(run) >= POLL_TIMEOUT_SECONDS:
            _expire_polled_run(run_id, provider_status_value=provider_status_value)
            return
        if once or terminal:
            return
        time.sleep(POLL_INTERVAL_SECONDS)


def _expire_polled_run(run_id: str, *, provider_status_value: str) -> None:
    data_sink.update_ai_video_run(run_id, {
        "status": "expired",
        "providerStatus": provider_status_value,
        "completedAt": _now_iso(),
        "error": AiVideoError(
            "长时间未完成",
            code="PROVIDER_TIMEOUT",
            retryable=True,
            safe_suggestion="可稍后恢复查询或复制为新任务",
        ).as_dict(),
    })


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
        return "running"
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


def _assert_safe_download_path(path: Path) -> None:
    absolute = path.expanduser().absolute()
    try:
        _assert_no_symlink_components(absolute.parent)
    except AiVideoError as exc:
        raise AiVideoError(
            "下载目标目录包含符号链接",
            code="ARCHIVE_WRITE_FAILED",
            safe_suggestion="重新选择有写入权限的输出目录",
        ) from exc
    if absolute.is_symlink():
        raise AiVideoError(
            "下载目标文件不能是符号链接",
            code="ARCHIVE_WRITE_FAILED",
            safe_suggestion="重新选择有写入权限的输出目录",
        )


def _download_file(url: str, target: Path) -> Path:
    target = target.expanduser().absolute()
    _assert_safe_download_path(target)
    if _DOWNLOADER is not None:
        return _DOWNLOADER(url=url, target_path=str(target))
    target.parent.mkdir(parents=True, exist_ok=True)
    _assert_safe_download_path(target)
    part = target.with_suffix(target.suffix + ".part")
    _assert_safe_download_path(part)
    if part.exists():
        try:
            part.unlink()
        except OSError:
            pass
    _assert_safe_download_path(part)

    # Prefer curl for robust large-file download with connect/max time limits.
    curl = shutil.which("curl")
    last_error: Exception | None = None
    if curl:
        try:
            _assert_safe_download_path(part)
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
            _assert_safe_download_path(part)
            _assert_safe_download_path(target)
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
        _assert_safe_download_path(part)
        with urllib.request.urlopen(request, timeout=30) as response, part.open("xb") as handle:
            while True:
                chunk = response.read(1024 * 256)
                if not chunk:
                    break
                handle.write(chunk)
        if not part.is_file() or part.stat().st_size <= 0:
            raise RuntimeError("downloaded file is empty")
        _assert_safe_download_path(part)
        _assert_safe_download_path(target)
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
    archive_root = Path(str(job.get("outputDir") or default_output_dir())).expanduser().absolute()
    archive_dir = Path(output.get("archiveDir") or archive_dir_for(
        job.get("id") or run.get("jobId") or "job",
        run_id,
        archive_root,
        run.get("createdAt"),
    ))
    file_name = _compact(output.get("fileName")) or output_filename(
        _compact(run.get("provider")),
        _compact(run.get("model")),
        _compact(job.get("id") or run.get("jobId")),
        run_id,
        run.get("createdAt"),
    )
    try:
        archive_dir = _secure_prepare_archive_dir(archive_root, archive_dir)
    except AiVideoError as exc:
        data_sink.update_ai_video_run(run_id, {
            "status": "failed",
            "archiveStatus": "archive_failed",
            "error": exc.as_dict(),
            "output": {**output, "fileName": file_name},
        })
        return
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
        _append_archive_event(
            archive_dir,
            {"at": _now_iso(), "event": "archived", "file": file_name},
        )
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
    should_schedule = False
    lock = _run_lock(run_id)
    if not lock.acquire(blocking=False):
        run = data_sink.get_ai_video_run(run_id)
        if not run:
            raise AiVideoError("Run 不存在", http_status=404)
        if (
            _provider_succeeded(run)
            and _compact(run.get("status")) == "downloading"
            and _compact(run.get("archiveStatus")) == "pending_archive"
        ):
            job = data_sink.get_ai_video_job(run.get("jobId") or "") or {}
            return {"ok": True, "data": {"job": public_job(job), "run": public_run(run)}}
        raise AiVideoError(
            "当前任务正在处理，请稍后刷新状态",
            code="ARCHIVE_RETRY_NOT_ALLOWED",
            safe_suggestion="请等待当前处理结束后再重试",
            http_status=409,
        )
    try:
        run = data_sink.get_ai_video_run(run_id)
        if not run:
            raise AiVideoError("Run 不存在", http_status=404)
        if not _compact(run.get("providerTaskId")):
            raise AiVideoError("缺少 provider task id，无法重新归档")
        archive_status = _compact(run.get("archiveStatus"))
        already_downloading = (
            _compact(run.get("status")) == "downloading"
            and archive_status == "pending_archive"
        )
        if not _provider_succeeded(run) or archive_status not in {
            "archive_failed",
            "pending_archive",
        }:
            raise AiVideoError(
                "当前任务尚未进入可重新归档状态",
                code="ARCHIVE_RETRY_NOT_ALLOWED",
                safe_suggestion="请等待 provider 生成成功后再重新归档",
                http_status=409,
            )
        if not already_downloading:
            run = data_sink.update_ai_video_run(run_id, {
                "status": "downloading",
                "archiveStatus": "pending_archive",
                "error": {},
            })
            should_schedule = True
    finally:
        lock.release()
    if should_schedule:
        ensure_worker_started()
        threading.Thread(
            target=process_run,
            args=(run_id,),
            daemon=True,
            name=f"ai-video-archive-{run_id[-6:]}",
        ).start()
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
    run_ids = [
        str(run.get("id") or "").strip()
        for run in runs
        if str(run.get("id") or "").strip()
    ]
    if not run_ids:
        return
    max_workers = min(RECOVERY_MAX_WORKERS, len(run_ids))
    with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="ai-video-recovery") as executor:
        futures = {
            executor.submit(process_run, run_id, once=once): run_id
            for run_id in run_ids
        }
        for future, run_id in futures.items():
            try:
                future.result()
            except Exception:
                logger.exception("ai video Run recovery failed: %s", run_id)


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
