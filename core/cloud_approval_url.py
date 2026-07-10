"""Resolve the effective cloud approval URL for desktop and development runtimes."""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable, Mapping
from urllib.parse import urlparse

PRODUCTION_CLOUD_APPROVAL_URL = "https://approval.crawshrimp.com"
DEFAULT_LOCAL_CLOUD_APPROVAL_URL = "http://127.0.0.1:8787"
LOCAL_DISCOVERY_PORTS = range(8787, 8798)
CLOUD_APPROVAL_SERVICE_NAME = "crawshrimp-cloud-approval-workbench"
CACHE_TTL_SECONDS = 10.0

Probe = Callable[[str], tuple[bool, str]]


@dataclass(frozen=True)
class CloudApprovalUrlResolution:
    environment: str
    base_url: str
    base_url_source: str
    service_reachable: bool
    service_error: str

    @property
    def configured(self) -> bool:
        return bool(self.base_url)

    def status_fields(self) -> dict:
        return {
            "environment": self.environment,
            "base_url": self.base_url,
            "base_url_source": self.base_url_source,
            "service_reachable": self.service_reachable,
            "service_error": self.service_error,
            "configured": self.configured,
        }


def normalize_cloud_approval_url(value: str) -> str:
    text = str(value or "").strip().rstrip("/")
    try:
        parsed = urlparse(text)
        parsed_port = parsed.port
    except ValueError:
        return ""
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return ""
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        return ""
    if parsed_port is not None and not 1 <= parsed_port <= 65535:
        return ""
    return text


def is_loopback_cloud_approval_url(value: str) -> bool:
    normalized = normalize_cloud_approval_url(value)
    if not normalized:
        return False
    return str(urlparse(normalized).hostname or "").lower() in {"127.0.0.1", "localhost", "::1"}


def probe_cloud_approval_service(base_url: str, timeout: float = 0.5) -> tuple[bool, str]:
    request = urllib.request.Request(
        f"{str(base_url).rstrip('/')}/health",
        headers={
            "Accept": "application/json",
            "User-Agent": "CrawshrimpCloudApprovalDiscovery/1.0",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = int(getattr(response, "status", 0) or response.getcode() or 0)
            if status >= 400:
                return False, "unreachable"
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError):
        return False, "unreachable"
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
        return False, "unexpected_service"
    if not isinstance(payload, dict):
        return False, "unexpected_service"
    if payload.get("ok") is not True or payload.get("service") != CLOUD_APPROVAL_SERVICE_NAME:
        return False, "unexpected_service"
    return True, ""


class CloudApprovalUrlResolver:
    def __init__(
        self,
        *,
        probe: Probe = probe_cloud_approval_service,
        monotonic: Callable[[], float] = time.monotonic,
        cache_ttl_seconds: float = CACHE_TTL_SECONDS,
    ):
        self._probe = probe
        self._monotonic = monotonic
        self._cache_ttl_seconds = float(cache_ttl_seconds)
        self._lock = threading.Lock()
        self._cache_key = None
        self._cache_expires_at = 0.0
        self._cache_result = None

    def invalidate(self) -> None:
        with self._lock:
            self._cache_key = None
            self._cache_expires_at = 0.0
            self._cache_result = None

    def resolve(
        self,
        saved_base_url: str = "",
        *,
        refresh: bool = False,
        environ: Mapping[str, str] | None = None,
    ) -> CloudApprovalUrlResolution:
        values = os.environ if environ is None else environ
        environment = (
            "production"
            if str(values.get("CRAWSHRIMP_APP_ENV") or "").lower() == "production"
            else "development"
        )
        override = str(values.get("CRAWSHRIMP_CLOUD_APPROVAL_URL") or "").strip()
        cache_key = (environment, override, str(saved_base_url or "").strip())
        with self._lock:
            now = self._monotonic()
            if not refresh and self._cache_key == cache_key and now < self._cache_expires_at:
                return self._cache_result
            result = self._resolve_uncached(environment, override, saved_base_url)
            self._cache_key = cache_key
            self._cache_expires_at = now + self._cache_ttl_seconds
            self._cache_result = result
            return result

    def _resolve_uncached(
        self,
        environment: str,
        override: str,
        saved_base_url: str,
    ) -> CloudApprovalUrlResolution:
        if environment == "production":
            reachable, error = self._probe(PRODUCTION_CLOUD_APPROVAL_URL)
            return CloudApprovalUrlResolution(
                environment,
                PRODUCTION_CLOUD_APPROVAL_URL,
                "production_default",
                reachable,
                error,
            )

        if override:
            normalized = normalize_cloud_approval_url(override)
            if not normalized:
                return CloudApprovalUrlResolution(
                    environment,
                    "",
                    "environment_override",
                    False,
                    "invalid_environment_override",
                )
            reachable, error = self._probe(normalized)
            return CloudApprovalUrlResolution(
                environment,
                normalized,
                "environment_override",
                reachable,
                error,
            )

        saved = normalize_cloud_approval_url(saved_base_url)
        if saved and is_loopback_cloud_approval_url(saved):
            reachable, _error = self._probe(saved)
            if reachable:
                return CloudApprovalUrlResolution(environment, saved, "saved_local", True, "")

        checked = {saved} if saved else set()
        for port in LOCAL_DISCOVERY_PORTS:
            candidate = f"http://127.0.0.1:{port}"
            if candidate in checked:
                continue
            reachable, _error = self._probe(candidate)
            if reachable:
                return CloudApprovalUrlResolution(
                    environment,
                    candidate,
                    "detected_local",
                    True,
                    "",
                )

        return CloudApprovalUrlResolution(
            environment,
            DEFAULT_LOCAL_CLOUD_APPROVAL_URL,
            "development_fallback",
            False,
            "not_detected",
        )


_resolver = CloudApprovalUrlResolver()


def resolve_cloud_approval_url(
    saved_base_url: str = "",
    *,
    refresh: bool = False,
) -> CloudApprovalUrlResolution:
    return _resolver.resolve(saved_base_url, refresh=refresh)


def invalidate_cloud_approval_url_cache() -> None:
    _resolver.invalidate()
