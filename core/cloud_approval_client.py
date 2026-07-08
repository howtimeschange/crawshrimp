"""Small stdlib HTTP client for desktop cloud approval sync."""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Mapping, Optional


class CloudApprovalError(RuntimeError):
    pass


DEFAULT_USER_AGENT = "CrawshrimpCloudApproval/1.0"


class CloudApprovalClient:
    def __init__(
        self,
        base_url: str,
        user_token: str = "",
        machine_token: str = "",
        timeout: float = 30.0,
        transport=None,
        sleep=None,
        user_agent: str = DEFAULT_USER_AGENT,
    ):
        self.base_url = str(base_url or "").rstrip("/")
        self.user_token = str(user_token or "")
        self.machine_token = str(machine_token or "")
        self.timeout = float(timeout or 30.0)
        self.transport = transport
        self._sleep = sleep or time.sleep
        self.user_agent = str(user_agent or DEFAULT_USER_AGENT)

    def request_json(self, method: str, path: str, body: Optional[Mapping[str, Any]] = None, *, token_type: str = "machine") -> dict:
        """Send JSON to the cloud API, retry 429/5xx, and return a JSON object."""
        url = self._url_for(path)
        data = None if body is None else json.dumps(dict(body), ensure_ascii=False).encode("utf-8")
        headers = {"Accept": "application/json", "User-Agent": self.user_agent}
        if data is not None:
            headers["Content-Type"] = "application/json"
        token = self._token_for(token_type) if self._should_attach_token(url) else ""
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return self._send_json_with_retry(method.upper(), url, data, headers, token)

    def upload_asset(self, upload_url: str, path: Path, content_type: str, *, token_type: str = "machine") -> dict:
        """Upload one local file to the cloud-provided upload URL."""
        asset_path = Path(path)
        url = self._url_for(upload_url)
        headers = {"Content-Type": content_type or "application/octet-stream", "User-Agent": self.user_agent}
        token = self._token_for(token_type) if self._should_attach_token(url) else ""
        if token:
            headers["Authorization"] = f"Bearer {token}"
        data = asset_path.read_bytes()
        max_attempts = 3
        for attempt in range(max_attempts):
            request = urllib.request.Request(url, data=data, headers=headers, method="PUT")
            try:
                response = self._open(request)
                status, payload = self._response_status_payload(response)
            except urllib.error.HTTPError as exc:
                status = int(exc.code or 0)
                if self._should_retry_status(status) and attempt < max_attempts - 1:
                    self._sleep(self._retry_delay(attempt))
                    continue
                raise CloudApprovalError(f"cloud upload failed: HTTP {status}") from None
            except Exception as exc:
                raise CloudApprovalError(f"cloud upload failed: {type(exc).__name__}") from None
            if status < 400:
                return payload
            if self._should_retry_status(status) and attempt < max_attempts - 1:
                self._sleep(self._retry_delay(attempt))
                continue
            raise CloudApprovalError(f"cloud upload failed: HTTP {status}")
        raise CloudApprovalError("cloud upload failed after retries")

    def download_asset(self, asset_uid: str, target_path: Path, *, job_uid: str = "", lease_id: str = "", token_type: str = "machine") -> Path:
        """Download one cloud asset to target_path using the current token."""
        query = {}
        if job_uid:
            query["job_uid"] = job_uid
        if lease_id:
            query["lease_id"] = lease_id
        suffix = f"?{urllib.parse.urlencode(query)}" if query else ""
        url = self._url_for(f"/api/assets/{urllib.parse.quote(str(asset_uid or ''), safe='')}/download{suffix}")
        headers = {"Accept": "*/*", "User-Agent": self.user_agent}
        token = self._token_for(token_type) if self._should_attach_token(url) else ""
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(url, headers=headers, method="GET")
        target = Path(target_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        max_attempts = 3
        for attempt in range(max_attempts):
            request = urllib.request.Request(url, headers=headers, method="GET")
            try:
                response = self._open(request)
                status = int(getattr(response, "status", 0) or response.getcode() or 0)
                if status < 400:
                    target.write_bytes(response.read())
                    return target
            except urllib.error.HTTPError as exc:
                status = int(exc.code or 0)
                if self._should_retry_status(status) and attempt < max_attempts - 1:
                    self._sleep(self._retry_delay(attempt))
                    continue
                raise CloudApprovalError(f"cloud asset download failed: HTTP {status}") from None
            except Exception as exc:
                raise CloudApprovalError(f"cloud asset download failed: {type(exc).__name__}") from None
            if self._should_retry_status(status) and attempt < max_attempts - 1:
                self._sleep(self._retry_delay(attempt))
                continue
            raise CloudApprovalError(f"cloud asset download failed: HTTP {status}")
        return target

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
                raise CloudApprovalError(f"cloud request failed: {type(exc).__name__}: {self._redact(str(exc), token)}") from None
            if status < 400:
                return payload
            if self._should_retry_status(status):
                if attempt < max_attempts - 1:
                    self._sleep(self._retry_delay(attempt))
                    continue
            detail = self._error_detail(payload)
            token_hint = self._token_hint(token)
            suffix = f" token={token_hint}" if token_hint else ""
            raise CloudApprovalError(f"cloud request failed: HTTP {status}{suffix}; {self._redact(detail, token)}")
        raise CloudApprovalError("cloud request failed after retries")

    @staticmethod
    def _should_retry_status(status: int) -> bool:
        return status == 429 or 500 <= status <= 599

    @staticmethod
    def _retry_delay(attempt: int) -> float:
        return min(0.25 * (2 ** attempt), 2.0)

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

    def _should_attach_token(self, url: str) -> bool:
        if not self.base_url:
            return False
        try:
            target = urllib.parse.urlparse(url)
            base = urllib.parse.urlparse(self.base_url)
        except Exception:
            return False
        return (target.scheme, target.netloc) == (base.scheme, base.netloc)

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
