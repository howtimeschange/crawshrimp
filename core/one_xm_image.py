"""1XM GPT-Image async task client."""
from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable, Mapping, Optional


DEFAULT_BASE_URL = "https://api.1xm.ai/v1"
FINAL_STATUSES = {"succeeded", "failed", "cancelled", "canceled"}
RETRYABLE_STATUS_CODES = {408, 409, 425, 429, 500, 502, 503, 504}
HEADER_TOKEN_RE = re.compile(r"[^A-Za-z0-9._~-]+")


class OneXMImageError(RuntimeError):
    """Base error for 1XM image calls."""


class RetryableOneXMImageError(OneXMImageError):
    """Network or upstream errors that can be retried safely."""


def _compact(value: object) -> str:
    return str(value or "").strip()


def _safe_idempotency_key(value: object, *, max_length: int = 180) -> str:
    text = _compact(value)
    if not text:
        return ""
    safe = HEADER_TOKEN_RE.sub("_", text)
    safe = re.sub(r"_+", "_", safe).strip("_")
    if safe == text:
        return safe[:max_length]
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]
    prefix_limit = max(1, max_length - len(digest) - 1)
    prefix = (safe or "key")[:prefix_limit].rstrip("_") or "key"
    return f"{prefix}_{digest}"


def _json_dumps(payload: Mapping[str, Any]) -> bytes:
    return json.dumps(dict(payload or {}), ensure_ascii=False).encode("utf-8")


def _parse_json_bytes(data: bytes) -> dict[str, Any]:
    text = data.decode("utf-8", errors="replace")
    if not text.strip():
        return {}
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise OneXMImageError(f"1XM returned non-JSON response: {text[:240]}") from exc
    if not isinstance(parsed, dict):
        raise OneXMImageError("1XM returned an unexpected JSON payload")
    return parsed


def _default_transport(method: str, url: str, headers: Optional[Mapping[str, str]] = None, body: Any = None, timeout: int = 30):
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else _json_dumps(body)
    request = urllib.request.Request(
        url,
        data=data,
        headers=dict(headers or {}),
        method=method.upper(),
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return int(response.status), _parse_json_bytes(response.read())
    except urllib.error.HTTPError as exc:
        payload = _parse_json_bytes(exc.read() or b"{}")
        if exc.code in RETRYABLE_STATUS_CODES:
            raise RetryableOneXMImageError(_error_message(payload, f"HTTP {exc.code}")) from exc
        raise OneXMImageError(_error_message(payload, f"HTTP {exc.code}")) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise RetryableOneXMImageError(str(exc)) from exc


def _error_message(payload: Mapping[str, Any], fallback: str = "1XM image task failed") -> str:
    error = payload.get("error") if isinstance(payload, Mapping) else None
    if isinstance(error, Mapping):
        return _compact(error.get("message") or error.get("code")) or fallback
    return _compact(payload.get("message") if isinstance(payload, Mapping) else "") or fallback


def _normalize_base_url(base_url: str) -> str:
    value = _compact(base_url) or DEFAULT_BASE_URL
    return value.rstrip("/")


def _join_url(base_url: str, path: str) -> str:
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return f"{_normalize_base_url(base_url)}/{path.lstrip('/')}"


def file_to_data_url(path: str, *, max_bytes: int = 20 * 1024 * 1024) -> str:
    file_path = Path(path).expanduser()
    if not file_path.is_file():
        raise FileNotFoundError(f"Reference image not found: {path}")
    size = file_path.stat().st_size
    if size > max_bytes:
        raise OneXMImageError(f"Reference image exceeds 1XM 20MB limit: {path}")
    mime = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    if mime not in {"image/png", "image/jpeg", "image/webp"}:
        if file_path.suffix.lower() in {".jpg", ".jpeg"}:
            mime = "image/jpeg"
        elif file_path.suffix.lower() == ".png":
            mime = "image/png"
        elif file_path.suffix.lower() == ".webp":
            mime = "image/webp"
    data = base64.b64encode(file_path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{data}"


class OneXMImageClient:
    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        transport: Optional[Callable[..., tuple[int, dict[str, Any]]]] = None,
    ) -> None:
        self.api_key = _compact(api_key)
        self.base_url = _normalize_base_url(base_url)
        self.transport = transport or _default_transport
        if not self.api_key:
            raise ValueError("1XM API key is required")

    def _headers(self, idempotency_key: str = "", *, json_body: bool = True) -> dict[str, str]:
        headers = {"Authorization": f"Bearer {self.api_key}"}
        if json_body:
            headers["Content-Type"] = "application/json"
        safe_idempotency_key = _safe_idempotency_key(idempotency_key)
        if safe_idempotency_key:
            headers["Idempotency-Key"] = safe_idempotency_key
        return headers

    def request_json(
        self,
        method: str,
        path_or_url: str,
        *,
        payload: Optional[Mapping[str, Any]] = None,
        idempotency_key: str = "",
        timeout: int = 30,
    ) -> dict[str, Any]:
        status, body = self.transport(
            method.upper(),
            _join_url(self.base_url, path_or_url),
            headers=self._headers(idempotency_key, json_body=payload is not None),
            body=dict(payload or {}) if payload is not None else None,
            timeout=timeout,
        )
        if status < 200 or status >= 300:
            if status in RETRYABLE_STATUS_CODES:
                raise RetryableOneXMImageError(_error_message(body, f"HTTP {status}"))
            raise OneXMImageError(_error_message(body, f"HTTP {status}"))
        return body if isinstance(body, dict) else {}

    def create_task(
        self,
        payload: Mapping[str, Any],
        *,
        idempotency_key: str,
        timeout: int = 30,
        request_retries: int = 3,
        retry_delay_seconds: float = 1.0,
        sleep_fn: Callable[[float], None] = time.sleep,
    ) -> dict[str, Any]:
        return _retry_call(
            lambda: self.request_json(
                "POST",
                "/images/tasks",
                payload=payload,
                idempotency_key=idempotency_key,
                timeout=timeout,
            ),
            request_retries=request_retries,
            retry_delay_seconds=retry_delay_seconds,
            sleep_fn=sleep_fn,
        )

    def get_task(
        self,
        poll_url_or_task_id: str,
        *,
        timeout: int = 30,
        request_retries: int = 3,
        retry_delay_seconds: float = 1.0,
        sleep_fn: Callable[[float], None] = time.sleep,
    ) -> dict[str, Any]:
        target = _compact(poll_url_or_task_id)
        if not target.startswith("http://") and not target.startswith("https://"):
            target = f"/images/tasks/{target}"
        return _retry_call(
            lambda: self.request_json("GET", target, timeout=timeout),
            request_retries=request_retries,
            retry_delay_seconds=retry_delay_seconds,
            sleep_fn=sleep_fn,
        )


def _retry_call(
    fn: Callable[[], dict[str, Any]],
    *,
    request_retries: int,
    retry_delay_seconds: float,
    sleep_fn: Callable[[float], None],
) -> dict[str, Any]:
    attempts = max(1, int(request_retries or 1))
    last_error: Exception | None = None
    for index in range(attempts):
        try:
            return fn()
        except RetryableOneXMImageError as exc:
            last_error = exc
            if index + 1 >= attempts:
                break
            sleep_fn(max(0.0, float(retry_delay_seconds or 0)))
    if last_error:
        raise last_error
    raise OneXMImageError("1XM request failed")


def extract_image_urls(task_payload: Mapping[str, Any]) -> list[str]:
    urls = []
    for item in task_payload.get("data") or []:
        if not isinstance(item, Mapping):
            continue
        url = _compact(item.get("url"))
        if url:
            urls.append(url)
    return urls


def run_image_task_until_done(
    client: OneXMImageClient,
    payload: Mapping[str, Any],
    *,
    idempotency_key: str,
    task_attempts: int = 1,
    request_retries: int = 3,
    request_timeout_seconds: int = 120,
    retry_delay_seconds: float = 1.0,
    poll_timeout_seconds: int = 600,
    poll_interval_seconds: float = 5.0,
    sleep_fn: Callable[[float], None] = time.sleep,
    monotonic_fn: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    max_attempts = max(1, int(task_attempts or 1))
    base_key = _compact(idempotency_key)
    if not base_key:
        raise ValueError("idempotency_key is required")

    last_error = ""
    create_attempts = 0
    poll_attempts = 0

    for attempt in range(1, max_attempts + 1):
        task_key = base_key if attempt == 1 else f"{base_key}-retry{attempt}"
        create_attempts += 1
        task = client.create_task(
            payload,
            idempotency_key=task_key,
            timeout=max(30, int(request_timeout_seconds or 120)),
            request_retries=request_retries,
            retry_delay_seconds=retry_delay_seconds,
            sleep_fn=sleep_fn,
        )
        task_id = _compact(task.get("id"))
        poll_url = _compact(task.get("poll_url")) or (f"/images/tasks/{task_id}" if task_id else "")
        started = monotonic_fn()
        current = dict(task)

        while True:
            status = _compact(current.get("status")).lower()
            if status == "succeeded":
                return {
                    "ok": True,
                    "task_id": _compact(current.get("id")) or task_id,
                    "poll_url": poll_url,
                    "status": status,
                    "image_urls": extract_image_urls(current),
                    "raw": current,
                    "create_attempts": create_attempts,
                    "poll_attempts": poll_attempts,
                    "compensation_attempts": attempt - 1,
                }
            if status in {"failed", "cancelled", "canceled"}:
                last_error = _error_message(current, f"1XM task {status}")
                break
            if monotonic_fn() - started > max(1, int(poll_timeout_seconds or 1)):
                last_error = "1XM task polling timed out"
                break
            if not poll_url:
                last_error = "1XM task did not return poll_url"
                break
            wait_seconds = float(current.get("poll_after") or poll_interval_seconds or 5)
            sleep_fn(max(0.0, wait_seconds))
            poll_attempts += 1
            current = client.get_task(
                poll_url,
                request_retries=request_retries,
                retry_delay_seconds=retry_delay_seconds,
                sleep_fn=sleep_fn,
            )

    return {
        "ok": False,
        "task_id": "",
        "poll_url": "",
        "status": "failed",
        "image_urls": [],
        "raw": {},
        "error": last_error or "1XM image task failed",
        "create_attempts": create_attempts,
        "poll_attempts": poll_attempts,
        "compensation_attempts": max_attempts - 1,
    }
