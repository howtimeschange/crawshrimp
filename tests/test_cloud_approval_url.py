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
            return url == "http://127.0.0.1:8795", "" if url.endswith(":8795") else "unreachable"

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
            return url.endswith(":8790"), "" if url.endswith(":8790") else "unreachable"

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
