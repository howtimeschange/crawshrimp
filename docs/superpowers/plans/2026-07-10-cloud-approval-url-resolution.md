# Cloud Approval URL Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the packaged desktop app always use `https://approval.crawshrimp.com/` while the development backend discovers a verified local approval workbench and the settings page displays the result as read-only.

**Architecture:** Add a focused Python resolver that owns environment selection, URL validation, `/health` identity checks, bounded local discovery, a 10-second cache, and refresh/invalidation. `core/api_server.py` becomes the single integration point for cloud clients and status; Electron only communicates packaged/development mode and forwards refresh options; Vue only renders the backend contract.

**Tech Stack:** Python 3 standard library, FastAPI, unittest, Electron 29, Node test runner, Vue 3.

## Global Constraints

- Production URL is always `https://approval.crawshrimp.com/` and ignores saved URLs plus `CRAWSHRIMP_CLOUD_APPROVAL_URL`.
- Development precedence is `CRAWSHRIMP_CLOUD_APPROVAL_URL`, verified saved loopback URL, verified ports `8787–8797`, then `http://127.0.0.1:8787` fallback.
- Discovery accepts only `/health` responses with `ok === true` and `service === "crawshrimp-cloud-approval-workbench"`.
- Discovery never scans LAN hosts or ports outside `8787–8797`.
- The automatic discovery cache lasts 10 seconds; `refresh=true` bypasses it and concurrent resolution is serialized.
- The settings address is read-only in both environments.
- Existing machine credentials and historical `cloud_approval.base_url` data are preserved.
- Do not modify or stage unrelated existing changes in `adapters/tmall-ops-assistant/manifest.yaml`, material dashboard files, or AI-image/Tmall tests.

---

## File Structure

- Create `core/cloud_approval_url.py`: URL resolution, health probing, cache, and stable status contract.
- Create `tests/test_cloud_approval_url.py`: isolated resolver precedence, validation, identity, cache, and concurrency tests.
- Modify `core/cloud_approval_client.py`: optional transport-error callback used to invalidate discovery cache.
- Modify `tests/test_cloud_approval_client.py`: verify callback behavior without changing existing client semantics.
- Modify `core/api_server.py`: consume the resolver for status and every desktop cloud client.
- Modify `tests/test_cloud_api_server.py`: lock backend integration, config compatibility, and refresh behavior.
- Modify `app/src/main.js`: inject desktop environment and forward status refresh.
- Modify `app/src/preload.js`: expose optional refresh argument.
- Modify `app/src/renderer/utils/devCsBridge.js`: mirror refresh behavior in browser development.
- Modify `tests/desktop-backend-startup.test.js`: assert packaged/development environment injection.
- Modify `tests/cloud-approval-ipc.test.js`: assert refresh forwarding across IPC and browser bridge.
- Modify `app/src/renderer/views/SettingsPage.vue`: read-only URL and status copy.
- Modify `tests/cloud-approval-settings.test.js`: protect the UI and payload contract.

### Task 1: Build the focused backend URL resolver

**Files:**
- Create: `core/cloud_approval_url.py`
- Create: `tests/test_cloud_approval_url.py`

**Interfaces:**
- Consumes: `Mapping[str, str]` environment values, saved base URL string, injectable `probe(url) -> tuple[bool, str]`, injectable monotonic clock.
- Produces: `CloudApprovalUrlResolution`, `CloudApprovalUrlResolver.resolve(saved_base_url="", refresh=False, environ=None)`, module function `resolve_cloud_approval_url(saved_base_url="", refresh=False)`, and `invalidate_cloud_approval_url_cache()`.

- [ ] **Step 1: Write the failing resolver tests**

Create `tests/test_cloud_approval_url.py` with explicit fake probes and a controllable clock:

```python
import json
import threading
import unittest
from unittest.mock import patch

from core.cloud_approval_url import (
    CloudApprovalUrlResolver,
    DEFAULT_LOCAL_CLOUD_APPROVAL_URL,
    PRODUCTION_CLOUD_APPROVAL_URL,
    probe_cloud_approval_service,
)


class FakeHealthResponse:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def getcode(self):
        return self.status

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class CloudApprovalUrlResolverTests(unittest.TestCase):
    def test_health_probe_requires_cloud_approval_service_identity(self):
        good = FakeHealthResponse({
            "ok": True,
            "service": "crawshrimp-cloud-approval-workbench",
        })
        wrong = FakeHealthResponse({"ok": True, "service": "another-service"})

        with patch("core.cloud_approval_url.urllib.request.urlopen", return_value=good):
            self.assertEqual(probe_cloud_approval_service("http://127.0.0.1:8787"), (True, ""))
        with patch("core.cloud_approval_url.urllib.request.urlopen", return_value=wrong):
            self.assertEqual(
                probe_cloud_approval_service("http://127.0.0.1:8787"),
                (False, "unexpected_service"),
            )

    def test_production_ignores_override_and_saved_url(self):
        calls = []
        resolver = CloudApprovalUrlResolver(probe=lambda url: (calls.append(url) or (True, "")))

        result = resolver.resolve(
            saved_base_url="http://127.0.0.1:8791",
            environ={
                "CRAWSHRIMP_APP_ENV": "production",
                "CRAWSHRIMP_CLOUD_APPROVAL_URL": "https://wrong.example.test",
            },
        )

        self.assertEqual(result.base_url, PRODUCTION_CLOUD_APPROVAL_URL)
        self.assertEqual(result.base_url_source, "production_default")
        self.assertTrue(result.configured)
        self.assertEqual(calls, [PRODUCTION_CLOUD_APPROVAL_URL])

    def test_invalid_development_override_blocks_fallback(self):
        calls = []
        resolver = CloudApprovalUrlResolver(probe=lambda url: (calls.append(url) or (True, "")))

        result = resolver.resolve(environ={
            "CRAWSHRIMP_APP_ENV": "development",
            "CRAWSHRIMP_CLOUD_APPROVAL_URL": "127.0.0.1:8790",
        })

        self.assertEqual(result.base_url, "")
        self.assertEqual(result.base_url_source, "environment_override")
        self.assertFalse(result.configured)
        self.assertFalse(result.service_reachable)
        self.assertEqual(result.service_error, "invalid_environment_override")
        self.assertEqual(calls, [])

    def test_verified_saved_loopback_url_precedes_port_scan(self):
        calls = []

        def probe(url):
            calls.append(url)
            return (url == "http://127.0.0.1:8795", "" if url.endswith(":8795") else "unreachable")

        result = CloudApprovalUrlResolver(probe=probe).resolve(
            saved_base_url="http://127.0.0.1:8795/",
            environ={"CRAWSHRIMP_APP_ENV": "development"},
        )

        self.assertEqual(result.base_url, "http://127.0.0.1:8795")
        self.assertEqual(result.base_url_source, "saved_local")
        self.assertTrue(result.service_reachable)
        self.assertEqual(calls, ["http://127.0.0.1:8795"])

    def test_non_loopback_saved_url_is_ignored_and_first_verified_port_wins(self):
        calls = []

        def probe(url):
            calls.append(url)
            return (url.endswith(":8790"), "" if url.endswith(":8790") else "unreachable")

        result = CloudApprovalUrlResolver(probe=probe).resolve(
            saved_base_url="https://approval.example.test",
            environ={"CRAWSHRIMP_APP_ENV": "development"},
        )

        self.assertEqual(result.base_url, "http://127.0.0.1:8790")
        self.assertEqual(result.base_url_source, "detected_local")
        self.assertEqual(calls[0], "http://127.0.0.1:8787")
        self.assertEqual(calls[-1], "http://127.0.0.1:8790")
        self.assertNotIn("https://approval.example.test", calls)

    def test_no_local_service_returns_unreachable_8787_fallback(self):
        result = CloudApprovalUrlResolver(probe=lambda _url: (False, "unreachable")).resolve(
            environ={"CRAWSHRIMP_APP_ENV": "development"},
        )

        self.assertEqual(result.base_url, DEFAULT_LOCAL_CLOUD_APPROVAL_URL)
        self.assertEqual(result.base_url_source, "development_fallback")
        self.assertTrue(result.configured)
        self.assertFalse(result.service_reachable)
        self.assertEqual(result.service_error, "not_detected")

    def test_cache_refresh_and_concurrent_reads_share_one_probe(self):
        now = [100.0]
        probe_started = threading.Event()
        release_probe = threading.Event()
        calls = []

        def probe(url):
            calls.append(url)
            probe_started.set()
            release_probe.wait(1)
            return True, ""

        resolver = CloudApprovalUrlResolver(probe=probe, monotonic=lambda: now[0])
        results = []
        first = threading.Thread(target=lambda: results.append(resolver.resolve(
            environ={"CRAWSHRIMP_APP_ENV": "development"},
        )))
        second = threading.Thread(target=lambda: results.append(resolver.resolve(
            environ={"CRAWSHRIMP_APP_ENV": "development"},
        )))
        first.start()
        probe_started.wait(1)
        second.start()
        release_probe.set()
        first.join(1)
        second.join(1)

        self.assertEqual(len(calls), 1)
        self.assertEqual([item.base_url for item in results], [DEFAULT_LOCAL_CLOUD_APPROVAL_URL] * 2)

        resolver.resolve(environ={"CRAWSHRIMP_APP_ENV": "development"})
        self.assertEqual(len(calls), 1)
        resolver.resolve(refresh=True, environ={"CRAWSHRIMP_APP_ENV": "development"})
        self.assertEqual(len(calls), 2)
        now[0] += 11
        resolver.resolve(environ={"CRAWSHRIMP_APP_ENV": "development"})
        self.assertEqual(len(calls), 3)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the resolver tests to verify RED**

Run:

```bash
venv/bin/python3 -m unittest tests.test_cloud_approval_url -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'core.cloud_approval_url'`.

- [ ] **Step 3: Implement the resolver and real health probe**

Create `core/cloud_approval_url.py` with these public types and rules:

```python
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
    except ValueError:
        return ""
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return ""
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
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
        headers={"Accept": "application/json", "User-Agent": "CrawshrimpCloudApprovalDiscovery/1.0"},
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
        environment = "production" if str(values.get("CRAWSHRIMP_APP_ENV") or "").lower() == "production" else "development"
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

    def _resolve_uncached(self, environment: str, override: str, saved_base_url: str) -> CloudApprovalUrlResolution:
        if environment == "production":
            reachable, error = self._probe(PRODUCTION_CLOUD_APPROVAL_URL)
            return CloudApprovalUrlResolution(environment, PRODUCTION_CLOUD_APPROVAL_URL, "production_default", reachable, error)
        if override:
            normalized = normalize_cloud_approval_url(override)
            if not normalized:
                return CloudApprovalUrlResolution(environment, "", "environment_override", False, "invalid_environment_override")
            reachable, error = self._probe(normalized)
            return CloudApprovalUrlResolution(environment, normalized, "environment_override", reachable, error)
        saved = normalize_cloud_approval_url(saved_base_url)
        if saved and is_loopback_cloud_approval_url(saved):
            reachable, error = self._probe(saved)
            if reachable:
                return CloudApprovalUrlResolution(environment, saved, "saved_local", True, "")
        checked = {saved} if saved else set()
        for port in LOCAL_DISCOVERY_PORTS:
            candidate = f"http://127.0.0.1:{port}"
            if candidate in checked:
                continue
            reachable, error = self._probe(candidate)
            if reachable:
                return CloudApprovalUrlResolution(environment, candidate, "detected_local", True, "")
        return CloudApprovalUrlResolution(environment, DEFAULT_LOCAL_CLOUD_APPROVAL_URL, "development_fallback", False, "not_detected")


_resolver = CloudApprovalUrlResolver()


def resolve_cloud_approval_url(saved_base_url: str = "", *, refresh: bool = False) -> CloudApprovalUrlResolution:
    return _resolver.resolve(saved_base_url, refresh=refresh)


def invalidate_cloud_approval_url_cache() -> None:
    _resolver.invalidate()
```

- [ ] **Step 4: Run resolver tests and static syntax checks**

Run:

```bash
venv/bin/python3 -m unittest tests.test_cloud_approval_url -v
venv/bin/python3 -m py_compile core/cloud_approval_url.py
```

Expected: all resolver tests PASS and `py_compile` exits 0.

- [ ] **Step 5: Commit the resolver unit**

```bash
git add core/cloud_approval_url.py tests/test_cloud_approval_url.py
git commit -m "feat(cloud): resolve approval URL by environment"
```

### Task 2: Invalidate discovery after transport failures

**Files:**
- Modify: `core/cloud_approval_client.py`
- Modify: `tests/test_cloud_approval_client.py`

**Interfaces:**
- Consumes: optional `on_transport_error: Callable[[], None]` constructor argument.
- Produces: existing `CloudApprovalClient` behavior plus exactly-once callback notification for each terminal non-HTTP transport exception.

- [ ] **Step 1: Add a failing transport callback test**

Append this test to `CloudApprovalClientTests` in `tests/test_cloud_approval_client.py`:

```python
    def test_transport_failure_notifies_cache_invalidator(self):
        notifications = []

        def broken_transport(_request, timeout):
            self.assertEqual(timeout, 30.0)
            raise OSError("connection refused")

        client = CloudApprovalClient(
            "http://127.0.0.1:8787",
            transport=broken_transport,
            on_transport_error=lambda: notifications.append("invalidated"),
        )

        with self.assertRaisesRegex(CloudApprovalError, "cloud request failed: OSError"):
            client.request_json("GET", "/api/prompt-libraries")

        self.assertEqual(notifications, ["invalidated"])
```

- [ ] **Step 2: Run the callback test to verify RED**

Run:

```bash
venv/bin/python3 -m unittest tests.test_cloud_approval_client.CloudApprovalClientTests.test_transport_failure_notifies_cache_invalidator -v
```

Expected: FAIL because `CloudApprovalClient.__init__` does not accept `on_transport_error`.

- [ ] **Step 3: Add the optional callback and notify on terminal transport exceptions**

Add the constructor field and helper:

```python
    def __init__(
        self,
        base_url: str,
        user_token: str = "",
        machine_token: str = "",
        timeout: float = 30.0,
        transport=None,
        sleep=None,
        user_agent: str = DEFAULT_USER_AGENT,
        on_transport_error=None,
    ):
        self.base_url = str(base_url or "").rstrip("/")
        self.user_token = str(user_token or "")
        self.machine_token = str(machine_token or "")
        self.timeout = float(timeout or 30.0)
        self.transport = transport
        self._sleep = sleep or time.sleep
        self.user_agent = str(user_agent or DEFAULT_USER_AGENT)
        self._on_transport_error = on_transport_error

    def _notify_transport_error(self) -> None:
        if not callable(self._on_transport_error):
            return
        try:
            self._on_transport_error()
        except Exception:
            return
```

In the generic `except Exception as exc` branches of `upload_asset`, `download_asset`, and `_send_json_with_retry`, call `self._notify_transport_error()` immediately before raising `CloudApprovalError`. Do not notify for `HTTPError`, because a responding HTTP service is still reachable.

The three terminal exception branches become:

```python
            except Exception as exc:
                self._notify_transport_error()
                raise CloudApprovalError(f"cloud upload failed: {type(exc).__name__}") from None
```

```python
            except Exception as exc:
                self._notify_transport_error()
                raise CloudApprovalError(f"cloud asset download failed: {type(exc).__name__}") from None
```

```python
            except Exception as exc:
                self._notify_transport_error()
                raise CloudApprovalError(
                    f"cloud request failed: {type(exc).__name__}: {self._redact(str(exc), token)}"
                ) from None
```

- [ ] **Step 4: Run the complete client test module**

Run:

```bash
venv/bin/python3 -m unittest tests.test_cloud_approval_client -v
```

Expected: all tests PASS, including retry and token-redaction tests.

- [ ] **Step 5: Commit transport invalidation**

```bash
git add core/cloud_approval_client.py tests/test_cloud_approval_client.py
git commit -m "fix(cloud): invalidate URL discovery after transport errors"
```

### Task 3: Make FastAPI status and every cloud client use the resolver

**Files:**
- Modify: `core/api_server.py:39-42`
- Modify: `core/api_server.py:7221-7436`
- Modify: `tests/test_cloud_api_server.py`

**Interfaces:**
- Consumes: `resolve_cloud_approval_url(saved_base_url, refresh=False)` and `invalidate_cloud_approval_url_cache()` from Task 1.
- Produces: `_cloud_approval_resolution(refresh=False)`, resolver-backed `_build_cloud_client()`, and `GET /cloud-approval/status?refresh=true`.

- [ ] **Step 1: Add failing FastAPI integration tests**

Import `CloudApprovalUrlResolution` and add a helper to `CloudApiServerTests`:

```python
from core.cloud_approval_url import CloudApprovalUrlResolution


    def resolution(self, **overrides):
        values = {
            "environment": "development",
            "base_url": "http://127.0.0.1:8789",
            "base_url_source": "detected_local",
            "service_reachable": True,
            "service_error": "",
        }
        values.update(overrides)
        return CloudApprovalUrlResolution(**values)
```

In `setUp`, install a default resolver stub so all pre-existing API tests stay isolated from real network discovery:

```python
        self.default_resolution = self.resolution(
            base_url="https://approval.example.test",
            base_url_source="environment_override",
        )
        resolution_patcher = patch(
            "core.api_server.resolve_cloud_approval_url",
            return_value=self.default_resolution,
        )
        resolution_patcher.start()
        self.addCleanup(resolution_patcher.stop)
```

Add these tests:

```python
    def test_status_uses_resolver_contract_and_forwards_refresh(self):
        with patch("core.api_server.resolve_cloud_approval_url", return_value=self.resolution()) as resolve:
            payload = api_server.get_cloud_approval_status(refresh=True)

        resolve.assert_called_once_with("", refresh=True)
        self.assertEqual(payload["base_url"], "http://127.0.0.1:8789")
        self.assertEqual(payload["base_url_source"], "detected_local")
        self.assertTrue(payload["service_reachable"])
        self.assertEqual(payload["service_error"], "")
        self.assertEqual(payload["environment"], "development")

    def test_build_cloud_client_uses_effective_url_and_invalidation_callback(self):
        data_sink.save_cloud_machine_credentials("machine-1", "machine-secret", "任务机", ["read_prompt_library"])
        with patch("core.api_server.resolve_cloud_approval_url", return_value=self.resolution()), \
                patch("core.api_server.invalidate_cloud_approval_url_cache") as invalidate:
            client = api_server._build_cloud_client()
            client._notify_transport_error()

        self.assertEqual(client.base_url, "http://127.0.0.1:8789")
        self.assertEqual(client.machine_token, "machine-secret")
        invalidate.assert_called_once_with()

    def test_config_keeps_historical_base_url_but_does_not_use_request_value(self):
        save_config({
            **DEFAULT_CONFIG,
            "cloud_approval": {
                **DEFAULT_CONFIG["cloud_approval"],
                "base_url": "http://127.0.0.1:8788",
            },
        })
        with patch("core.api_server.resolve_cloud_approval_url", return_value=self.resolution()) as resolve:
            result = api_server.configure_cloud_approval(api_server.CloudApprovalConfigRequest(
                base_url="https://business-user.example.test",
                machine_name="设计部任务机",
                capabilities=["regenerate_ai_image"],
            ))

        self.assertEqual(api_server._cloud_approval_config()["base_url"], "http://127.0.0.1:8788")
        self.assertEqual(result["status"]["base_url"], "http://127.0.0.1:8789")
        self.assertEqual(resolve.call_args.args[0], "http://127.0.0.1:8788")

    def test_machine_start_rejects_unreachable_resolved_service(self):
        data_sink.save_cloud_machine_credentials("machine-1", "machine-secret", "任务机", ["read_prompt_library"])
        unreachable = self.resolution(
            base_url="http://127.0.0.1:8787",
            base_url_source="development_fallback",
            service_reachable=False,
            service_error="not_detected",
        )

        with patch("core.api_server.resolve_cloud_approval_url", return_value=unreachable):
            with self.assertRaises(api_server.HTTPException) as raised:
                api_server.start_cloud_machine()

        self.assertEqual(raised.exception.status_code, 502)
        self.assertIn("not_detected", str(raised.exception.detail))
```

In the existing `test_config_route_persists_cloud_approval_settings_without_credentials`, keep the status assertion for `https://approval.example.test` and add this assertion to lock the compatibility rule that the request cannot replace historical storage:

```python
        self.assertEqual(api_server._cloud_approval_config().get("base_url"), "")
```

The default resolver stub above supplies the example effective URL to existing status, enrollment, sync, start, auto-start, and stop tests without external requests.

- [ ] **Step 2: Run backend API tests to verify RED**

Run:

```bash
venv/bin/python3 -m unittest tests.test_cloud_api_server -v
```

Expected: FAIL because status has no refresh argument or resolver fields, and config still persists the request URL.

- [ ] **Step 3: Integrate the resolver into status, clients, enrollment, and config**

Add imports:

```python
from core.cloud_approval_url import (
    invalidate_cloud_approval_url_cache,
    resolve_cloud_approval_url,
)
```

Replace direct URL reads with these helpers:

```python
def _cloud_approval_resolution(*, refresh: bool = False):
    cloud = _cloud_approval_config()
    return resolve_cloud_approval_url(str(cloud.get("base_url") or ""), refresh=refresh)


def _build_cloud_client() -> CloudApprovalClient:
    resolution = _cloud_approval_resolution()
    saved = data_sink.get_cloud_machine_credentials() or {}
    return CloudApprovalClient(
        base_url=resolution.base_url,
        machine_token=str(saved.get("machine_token") or ""),
        on_transport_error=invalidate_cloud_approval_url_cache,
    )
```

Change status to merge `resolution.status_fields()`:

```python
def _cloud_approval_status(*, refresh: bool = False) -> dict:
    cloud = _cloud_approval_config()
    resolution = _cloud_approval_resolution(refresh=refresh)
    saved = data_sink.get_cloud_machine_credentials() or {}
    machine_name = str(cloud.get("machine_name") or saved.get("machine_name") or "").strip()
    machine_id = str(saved.get("machine_id") or "").strip()
    token_present = bool(str(saved.get("machine_token") or "").strip())
    running = cloud_machine_controller.is_running()
    health = "running" if running and cloud_machine_controller.last_health == "stopped" else cloud_machine_controller.last_health
    return {
        **resolution.status_fields(),
        "running": running,
        "auth": "enrolled" if token_present else "missing_token",
        "health": health or ("running" if running else "stopped"),
        "machine_name": machine_name,
        "machine_id": machine_id,
        "token_present": token_present,
        "machine_enabled": bool(cloud.get("machine_enabled")),
        "capabilities": _cloud_capabilities(saved, cloud),
        "last_error": cloud_machine_controller.last_error,
    }


@app.get("/cloud-approval/status")
def get_cloud_approval_status(refresh: bool = False):
    return _cloud_approval_status(refresh=refresh)
```

Replace `configure_cloud_approval` so the compatibility field is accepted but ignored:

```python
@app.post("/cloud-approval/config")
def configure_cloud_approval(req: CloudApprovalConfigRequest):
    patch_config({
        "cloud_approval": {
            **_cloud_approval_config(),
            "registration_token": str(req.registration_token or "").strip(),
            "machine_name": str(req.machine_name or "").strip(),
            "machine_enabled": bool(req.machine_enabled),
            "capabilities": _cloud_capabilities(req.capabilities),
        },
    })
    return {"ok": True, "status": _cloud_approval_status()}
```

At the start of `enroll_cloud_machine`, resolve the effective address and construct its client as follows. Keep the existing token, name, capabilities, enrollment call, safe response, and credential handling around this block:

```python
    cloud = _cloud_approval_config()
    resolution = _cloud_approval_resolution(refresh=True)
    if not resolution.configured:
        raise HTTPException(400, f"cloud approval address is invalid: {resolution.service_error}")
    if not resolution.service_reachable:
        raise HTTPException(502, f"cloud approval service is unavailable: {resolution.service_error}")
    base_url = resolution.base_url
    client = CloudApprovalClient(
        base_url=base_url,
        on_transport_error=invalidate_cloud_approval_url_cache,
    )
```

When the enrollment succeeds, preserve `**cloud`, clear `registration_token`, and update `machine_name` plus `capabilities`; do not assign `base_url` in the patch.

In `start_cloud_machine`, after the existing `configured` check, add:

```python
    if not status["service_reachable"]:
        raise HTTPException(502, f"cloud approval service is unavailable: {status['service_error']}")
```

In `_start_cloud_machine_if_enabled`, include `not status["service_reachable"]` in the skip condition so an unreachable service is not auto-started into an immediate failure loop.

Before task-machine start, enrollment, prompt proxy, and batch sync, keep existing validation and error mapping. Their clients now all route through `_build_cloud_client` or the enrollment resolution.

- [ ] **Step 4: Run backend API, resolver, agent, and sync tests**

Run:

```bash
venv/bin/python3 -m unittest \
  tests.test_cloud_approval_url \
  tests.test_cloud_api_server \
  tests.test_cloud_approval_client \
  tests.test_cloud_machine_agent \
  tests.test_cloud_batch_sync \
  tests.test_cloud_job_executors -v
```

Expected: all tests PASS and no test performs an external network request.

- [ ] **Step 5: Commit backend integration**

```bash
git add core/api_server.py tests/test_cloud_api_server.py
git commit -m "feat(cloud): use resolved approval URL across backend"
```

### Task 4: Pass desktop environment and refresh through Electron bridges

**Files:**
- Modify: `app/src/main.js:26`
- Modify: `app/src/main.js:764-793`
- Modify: `app/src/main.js:2058`
- Modify: `app/src/preload.js:306`
- Modify: `app/src/renderer/utils/devCsBridge.js:391`
- Modify: `tests/desktop-backend-startup.test.js`
- Modify: `tests/cloud-approval-ipc.test.js`

**Interfaces:**
- Consumes: Electron `IS_DEV` and renderer `{ refresh?: boolean }` options.
- Produces: `CRAWSHRIMP_APP_ENV`, IPC `getCloudApprovalStatus(options)`, and `/cloud-approval/status?refresh=true` forwarding.

- [ ] **Step 1: Write failing Electron contract tests**

Add to `tests/desktop-backend-startup.test.js`:

```javascript
test('desktop tells the Python backend whether it is packaged', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /const CLOUD_APPROVAL_APP_ENV = IS_DEV \? 'development' : 'production'/)
  assert.match(main, /CRAWSHRIMP_APP_ENV: CLOUD_APPROVAL_APP_ENV/)
})
```

Add assertions to `tests/cloud-approval-ipc.test.js`:

```javascript
test('cloud approval status refresh is forwarded by desktop and browser bridges', () => {
  const main = read('app/src/main.js')
  const preload = read('app/src/preload.js')
  const devBridge = read('app/src/renderer/utils/devCsBridge.js')

  assert.match(main, /options\?\.refresh \? '\/cloud-approval\/status\?refresh=true' : '\/cloud-approval\/status'/)
  assert.match(preload, /getCloudApprovalStatus: \(options = \{\}\) => ipcRenderer\.invoke\('get-cloud-approval-status', options \|\| \{\}\)/)
  assert.match(devBridge, /getCloudApprovalStatus: \(options = \{\}\) => apiCall\([\s\S]*options\?\.refresh \? '\/cloud-approval\/status\?refresh=true' : '\/cloud-approval\/status'/)
})
```

- [ ] **Step 2: Run bridge tests to verify RED**

Run:

```bash
node --test tests/desktop-backend-startup.test.js tests/cloud-approval-ipc.test.js
```

Expected: the new environment and refresh assertions FAIL.

- [ ] **Step 3: Implement environment injection and refresh forwarding**

Near `IS_DEV`, add:

```javascript
const CLOUD_APPROVAL_APP_ENV = IS_DEV ? 'development' : 'production'
```

In `spawnBackendProcess()` add this child environment value:

```javascript
CRAWSHRIMP_APP_ENV: CLOUD_APPROVAL_APP_ENV,
```

Replace the main-process handler with:

```javascript
secureHandle('get-cloud-approval-status', async (_, options = {}) => apiCall(
  'GET',
  options?.refresh ? '/cloud-approval/status?refresh=true' : '/cloud-approval/status',
))
```

Replace the preload and browser bridge functions with:

```javascript
getCloudApprovalStatus: (options = {}) => ipcRenderer.invoke('get-cloud-approval-status', options || {}),
```

```javascript
getCloudApprovalStatus: (options = {}) => apiCall(
  'GET',
  options?.refresh ? '/cloud-approval/status?refresh=true' : '/cloud-approval/status',
),
```

- [ ] **Step 4: Run Electron bridge tests**

Run:

```bash
node --test tests/desktop-backend-startup.test.js tests/cloud-approval-ipc.test.js tests/task-center-navigation.test.js tests/local-prompt-library-contract.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit Electron plumbing**

```bash
git add app/src/main.js app/src/preload.js app/src/renderer/utils/devCsBridge.js tests/desktop-backend-startup.test.js tests/cloud-approval-ipc.test.js
git commit -m "feat(app): pass cloud approval environment and refresh"
```

### Task 5: Make the settings address read-only and show discovery state

**Files:**
- Modify: `app/src/renderer/views/SettingsPage.vue:400-405`
- Modify: `app/src/renderer/views/SettingsPage.vue:578`
- Modify: `app/src/renderer/views/SettingsPage.vue:748-770`
- Modify: `tests/cloud-approval-settings.test.js`

**Interfaces:**
- Consumes: status fields `environment`, `base_url`, `base_url_source`, `service_reachable`, and `service_error` from Task 3; `getCloudApprovalStatus({ refresh: true })` from Task 4.
- Produces: read-only copyable address field, stable Chinese discovery hint, and a config payload without `base_url`.

- [ ] **Step 1: Add failing settings contract assertions**

Extend the first test in `tests/cloud-approval-settings.test.js`:

```javascript
  assert.match(source, /v-model="cfg\['cloud_approval\.base_url'\]"[\s\S]*readonly/)
  assert.match(source, /getCloudApprovalStatus\(\{ refresh: true \}\)/)
  assert.match(source, /cloudAddressHint/)
  assert.match(source, /正式环境固定地址/)
  assert.match(source, /已检测到本地审批服务/)
  assert.match(source, /未检测到本地审批服务，当前显示默认地址/)

  const payloadBody = source.match(/function cloudConfigPayload\(\) \{([\s\S]*?)\n\}/)?.[1] || ''
  assert.doesNotMatch(payloadBody, /base_url/)
```

- [ ] **Step 2: Run the settings test to verify RED**

Run:

```bash
node --test tests/cloud-approval-settings.test.js
```

Expected: FAIL because the input is editable, refresh is not requested, and the payload includes `base_url`.

- [ ] **Step 3: Implement the read-only field and status copy**

Replace the address field with:

```vue
<div class="field">
  <label>云端地址</label>
  <input
    v-model="cfg['cloud_approval.base_url']"
    class="input"
    readonly
  />
  <p :class="['cloud-address-hint', cloudAddressHintOk ? 'ok' : 'warn']">
    {{ cloudAddressHint }}
  </p>
</div>
```

Add stable message mapping:

```javascript
const cloudServiceErrorMessages = {
  invalid_environment_override: '开发环境变量中的云端审批地址无效',
  unreachable: '云端审批服务暂时无法访问',
  unexpected_service: '检测到的地址不是抓虾云端审批服务',
  not_detected: '未检测到本地审批服务，当前显示默认地址',
}

const cloudAddressHint = computed(() => {
  const status = cloudStatus.value || {}
  if (status.environment === 'production') return '正式环境固定地址'
  if (status.service_reachable) return '已检测到本地审批服务'
  return cloudServiceErrorMessages[status.service_error] || '未检测到本地审批服务，当前显示默认地址'
})

const cloudAddressHintOk = computed(() => Boolean(
  cloudStatus.value?.environment === 'production' || cloudStatus.value?.service_reachable,
))
```

Remove `cloud_approval.base_url` from `panelFields['cloud-approval']`. Replace `cloudConfigPayload()` with:

```javascript
function cloudConfigPayload() {
  return {
    registration_token: cfg.value['cloud_approval.registration_token'] || '',
    machine_name: cfg.value['cloud_approval.machine_name'] || '',
    machine_enabled: Boolean(cfg.value['cloud_approval.machine_enabled']),
    capabilities: selectedCloudCapabilities(),
  }
}
```

Change `loadCloudStatus` to request a fresh discovery result:

```javascript
async function loadCloudStatus() {
  if (typeof window.cs.getCloudApprovalStatus !== 'function') return
  try {
    applyCloudStatus(await window.cs.getCloudApprovalStatus({ refresh: true }))
  } catch (e) {
    cloudMsg.value = e?.message || '读取云端审批状态失败'
    cloudMsgOk.value = false
  }
}
```

Refresh again whenever the user navigates back into the cloud approval panel:

```javascript
watch(activePanelId, panelId => {
  if (panelId === 'cloud-approval') loadCloudStatus()
})
```

Add these scoped styles without introducing global tokens:

```css
.cloud-address-hint {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.5;
}

.cloud-address-hint.ok {
  color: #4ade80;
}

.cloud-address-hint.warn {
  color: var(--orange);
}
```

- [ ] **Step 4: Run focused frontend and backend regressions**

Run:

```bash
node --test \
  tests/cloud-approval-settings.test.js \
  tests/cloud-approval-ipc.test.js \
  tests/local-prompt-library-contract.test.js \
  tests/task-center-navigation.test.js

venv/bin/python3 -m unittest \
  tests.test_cloud_approval_url \
  tests.test_cloud_api_server \
  tests.test_cloud_approval_client \
  tests.test_cloud_machine_agent \
  tests.test_cloud_batch_sync -v

cd app && npm test && npm run vite:build
```

Expected: every test PASS and Vite production build exits 0.

- [ ] **Step 5: Perform two live local discovery checks**

Start the approval workbench on its default port in one terminal:

```bash
cd cloud/approval-workbench
npm run dev -- --port 8787
```

Then query a forced refresh from another terminal:

```bash
curl -fsS http://127.0.0.1:8787/health
curl -fsS 'http://127.0.0.1:18765/cloud-approval/status?refresh=true'
```

Expected: health reports `service: crawshrimp-cloud-approval-workbench`; backend status reports `base_url: http://127.0.0.1:8787`, `service_reachable: true`, and source `detected_local` or `saved_local`.

Stop that Wrangler process, restart it on `8790`, then repeat:

```bash
cd cloud/approval-workbench
npm run dev -- --port 8790
```

From another terminal:

```bash
curl -fsS http://127.0.0.1:8790/health
curl -fsS 'http://127.0.0.1:18765/cloud-approval/status?refresh=true'
```

Expected: backend status changes to `base_url: http://127.0.0.1:8790` without editing `config.json` or restarting the desktop backend.

- [ ] **Step 6: Review the final diff and commit settings behavior**

Run:

```bash
git diff --check
git status --short
git diff -- app/src/renderer/views/SettingsPage.vue tests/cloud-approval-settings.test.js
```

Expected: no whitespace errors; unrelated dirty files remain unstaged.

Commit:

```bash
git add app/src/renderer/views/SettingsPage.vue tests/cloud-approval-settings.test.js
git commit -m "feat(settings): display resolved cloud approval address"
```

## Final Verification

Run the complete focused suite from the repository root:

```bash
venv/bin/python3 -m unittest \
  tests.test_cloud_approval_url \
  tests.test_cloud_api_server \
  tests.test_cloud_approval_client \
  tests.test_cloud_machine_agent \
  tests.test_cloud_batch_sync \
  tests.test_cloud_job_executors -v

node --test \
  tests/desktop-backend-startup.test.js \
  tests/cloud-approval-ipc.test.js \
  tests/cloud-approval-settings.test.js \
  tests/local-prompt-library-contract.test.js \
  tests/task-center-navigation.test.js

cd app && npm test && npm run vite:build
```

Expected: all Python and Node tests PASS, Vite build exits 0, production mode is locked to the public domain, and development mode resolves only verified approval workbench services.
