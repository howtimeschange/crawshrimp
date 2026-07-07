"""Small stdlib HTTP client for desktop cloud approval sync."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Mapping, Optional


class CloudApprovalError(RuntimeError):
    pass


class CloudApprovalClient:
    def __init__(
        self,
        base_url: str,
        user_token: str = "",
        machine_token: str = "",
        timeout: float = 30.0,
        transport=None,
        sleep=None,
    ):
        self.base_url = str(base_url or "").rstrip("/")
        self.user_token = str(user_token or "")
        self.machine_token = str(machine_token or "")
        self.timeout = float(timeout or 30.0)
        self.transport = transport
        self._sleep = sleep or time.sleep

    def request_json(self, method: str, path: str, body: Optional[Mapping[str, Any]] = None, *, token_type: str = "machine") -> dict:
        """Send JSON to the cloud API, retry 429/5xx, and return a JSON object."""
        url = self._url_for(path)
        data = None if body is None else json.dumps(dict(body), ensure_ascii=False).encode("utf-8")
        headers = {"Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        token = self._token_for(token_type)
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return self._send_json_with_retry(method.upper(), url, data, headers, token)

    def upload_asset(self, upload_url: str, path: Path, content_type: str) -> dict:
        """Upload one local file to the cloud-provided upload URL."""
        asset_path = Path(path)
        headers = {"Content-Type": content_type or "application/octet-stream"}
        request = urllib.request.Request(
            str(upload_url),
            data=asset_path.read_bytes(),
            headers=headers,
            method="PUT",
        )
        try:
            response = self._open(request)
            status, _payload = self._response_status_payload(response)
        except urllib.error.HTTPError as exc:
            raise CloudApprovalError(f"cloud upload failed: HTTP {int(exc.code or 0)}") from exc
        except Exception as exc:
            raise CloudApprovalError(f"cloud upload failed: {type(exc).__name__}") from exc
        if status >= 400:
            raise CloudApprovalError(f"cloud upload failed: HTTP {status}")
        return _payload

    def _send_json_with_retry(self, method: str, url: str, data: bytes | None, headers: Mapping[str, str], token: str) -> dict:
        max_attempts = 3
        for attempt in range(max_attempts):
            request = urllib.request.Request(url, data=data, headers=dict(headers), method=method)
            try:
                response = self._open(request)
                status, payload = self._response_status_payload(response)
            except urllib.error.HTTPError as exc:
                status = int(exc.code or 0)
                payload = self._json_from_bytes(exc.read())
            except Exception as exc:
                raise CloudApprovalError(f"cloud request failed: {type(exc).__name__}: {self._redact(str(exc), token)}") from exc
            if status < 400:
                return payload
            if status in {429} or 500 <= status <= 599:
                if attempt < max_attempts - 1:
                    self._sleep(min(0.25 * (2 ** attempt), 2.0))
                    continue
            detail = self._error_detail(payload)
            token_hint = self._token_hint(token)
            suffix = f" token={token_hint}" if token_hint else ""
            raise CloudApprovalError(f"cloud request failed: HTTP {status}{suffix}; {self._redact(detail, token)}")
        raise CloudApprovalError("cloud request failed after retries")

    def _open(self, request):
        opener = self.transport or urllib.request.urlopen
        return opener(request, timeout=self.timeout)

    def _url_for(self, path: str) -> str:
        text = str(path or "")
        if text.startswith("http://") or text.startswith("https://"):
            return text
        if not self.base_url:
            raise CloudApprovalError("cloud base_url is required")
        return f"{self.base_url}/{text.lstrip('/')}"

    def _token_for(self, token_type: str) -> str:
        if token_type == "user":
            return self.user_token
        return self.machine_token

    @staticmethod
    def _response_status_payload(response) -> tuple[int, dict]:
        status = int(getattr(response, "status", 0) or response.getcode() or 0)
        return status, CloudApprovalClient._json_from_bytes(response.read())

    @staticmethod
    def _json_from_bytes(data: bytes) -> dict:
        if not data:
            return {}
        try:
            payload = json.loads(data.decode("utf-8"))
        except Exception:
            return {}
        return payload if isinstance(payload, dict) else {"data": payload}

    @staticmethod
    def _error_detail(payload: Mapping[str, Any]) -> str:
        for key in ("error", "message", "detail"):
            if payload.get(key):
                return str(payload.get(key))
        return "request rejected"

    @staticmethod
    def _token_hint(token: str) -> str:
        if not token:
            return ""
        return f"{token[:4]}..."

    @staticmethod
    def _redact(text: str, token: str) -> str:
        if token:
            text = text.replace(token, CloudApprovalClient._token_hint(token))
        return text
