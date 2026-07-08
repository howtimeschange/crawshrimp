import json
import traceback
import urllib.error
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from core.cloud_approval_client import CloudApprovalClient, CloudApprovalError


class FakeResponse:
    def __init__(self, status: int = 200, body: dict | None = None):
        self.status = status
        self.body = json.dumps(body if body is not None else {}).encode("utf-8")
        self.headers = {"Content-Type": "application/json"}

    def read(self) -> bytes:
        return self.body

    def getcode(self) -> int:
        return self.status


class FakeBytesResponse:
    def __init__(self, status: int = 200, body: bytes = b""):
        self.status = status
        self.body = body

    def read(self) -> bytes:
        return self.body

    def getcode(self) -> int:
        return self.status


class FakeTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, request, timeout):
        self.calls.append((request, timeout))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class CloudApprovalClientTests(unittest.TestCase):
    def test_trims_trailing_slash_from_base_url(self):
        client = CloudApprovalClient("https://approval.example.com///")

        self.assertEqual(client.base_url, "https://approval.example.com")

    def test_request_json_includes_bearer_machine_token(self):
        transport = FakeTransport([FakeResponse(body={"ok": True})])
        client = CloudApprovalClient(
            "https://approval.example.com/",
            machine_token="machine-secret-token",
            transport=transport,
        )

        payload = client.request_json("POST", "/api/test", {"hello": "world"})

        self.assertEqual(payload, {"ok": True})
        request, timeout = transport.calls[0]
        self.assertEqual(request.full_url, "https://approval.example.com/api/test")
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.headers["Authorization"], "Bearer machine-secret-token")
        self.assertEqual(request.headers["User-agent"], "CrawshrimpCloudApproval/1.0")
        self.assertEqual(request.headers["Content-type"], "application/json")
        self.assertEqual(timeout, 30.0)
        self.assertEqual(json.loads(request.data.decode("utf-8")), {"hello": "world"})

    def test_request_json_retries_429_and_5xx_with_bounded_backoff(self):
        transport = FakeTransport([
            FakeResponse(status=429, body={"error": "slow down"}),
            FakeResponse(status=502, body={"error": "bad gateway"}),
            FakeResponse(status=200, body={"ok": True}),
        ])
        sleeps = []
        client = CloudApprovalClient(
            "https://approval.example.com",
            machine_token="machine-secret-token",
            transport=transport,
            sleep=sleeps.append,
        )

        payload = client.request_json("POST", "api/retry", {"attempt": 1})

        self.assertEqual(payload, {"ok": True})
        self.assertEqual(len(transport.calls), 3)
        self.assertEqual(sleeps, [0.25, 0.5])

    def test_upload_asset_calls_upload_url_with_bytes_content_type_and_machine_token(self):
        transport = FakeTransport([FakeResponse(body={"uploaded": True})])
        client = CloudApprovalClient(
            "https://approval.example.com",
            machine_token="machine-secret-token",
            transport=transport,
        )

        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "asset.jpg"
            path.write_bytes(b"image-bytes")
            result = client.upload_asset("https://approval.example.com/api/assets/upload/object", path, "image/jpeg")

        self.assertEqual(result, {"uploaded": True})
        request, _timeout = transport.calls[0]
        self.assertEqual(request.full_url, "https://approval.example.com/api/assets/upload/object")
        self.assertEqual(request.get_method(), "PUT")
        self.assertEqual(request.data, b"image-bytes")
        self.assertEqual(request.headers["Content-type"], "image/jpeg")
        self.assertEqual(request.headers["User-agent"], "CrawshrimpCloudApproval/1.0")
        self.assertEqual(request.headers["Authorization"], "Bearer machine-secret-token")

    def test_upload_asset_does_not_send_machine_token_to_cross_origin_absolute_url(self):
        transport = FakeTransport([FakeResponse(body={"uploaded": True})])
        client = CloudApprovalClient(
            "https://approval.example.com",
            machine_token="machine-secret-token",
            transport=transport,
        )

        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "asset.jpg"
            path.write_bytes(b"image-bytes")
            result = client.upload_asset("https://upload.example.com/object", path, "image/jpeg")

        self.assertEqual(result, {"uploaded": True})
        request, _timeout = transport.calls[0]
        self.assertEqual(request.full_url, "https://upload.example.com/object")
        self.assertNotIn("Authorization", request.headers)

    def test_upload_asset_resolves_worker_relative_upload_url(self):
        transport = FakeTransport([FakeResponse(body={"uploaded": True})])
        client = CloudApprovalClient(
            "https://approval.example.com/",
            machine_token="machine-secret-token",
            transport=transport,
        )

        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "asset.jpg"
            path.write_bytes(b"image-bytes")
            result = client.upload_asset("/api/assets/upload/object-key", path, "image/jpeg")

        self.assertEqual(result, {"uploaded": True})
        request, _timeout = transport.calls[0]
        self.assertEqual(request.full_url, "https://approval.example.com/api/assets/upload/object-key")

    def test_upload_asset_retries_5xx_with_bounded_backoff(self):
        transport = FakeTransport([
            FakeResponse(status=502, body={"error": "bad gateway"}),
            FakeResponse(body={"uploaded": True}),
        ])
        sleeps = []
        client = CloudApprovalClient(
            "https://approval.example.com",
            machine_token="machine-secret-token",
            transport=transport,
            sleep=sleeps.append,
        )

        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "asset.jpg"
            path.write_bytes(b"image-bytes")
            result = client.upload_asset("/api/assets/upload/object-key", path, "image/jpeg")

        self.assertEqual(result, {"uploaded": True})
        self.assertEqual(len(transport.calls), 2)
        self.assertEqual(sleeps, [0.25])

    def test_download_asset_retries_5xx_with_bounded_backoff(self):
        transport = FakeTransport([
            FakeBytesResponse(status=503, body=b"temporarily unavailable"),
            FakeBytesResponse(status=200, body=b"image-bytes"),
        ])
        sleeps = []
        client = CloudApprovalClient(
            "https://approval.example.com",
            machine_token="machine-secret-token",
            transport=transport,
            sleep=sleeps.append,
        )

        with TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "asset.jpg"
            result = client.download_asset("asset-1", target, job_uid="job-1", lease_id="lease-1")
            self.assertEqual(result, target)
            self.assertEqual(target.read_bytes(), b"image-bytes")

        self.assertEqual(len(transport.calls), 2)
        self.assertEqual(sleeps, [0.25])

    def test_client_exception_redacts_full_tokens(self):
        transport = FakeTransport([FakeResponse(status=403, body={"error": "denied"})])
        token = "machine-token-value-that-must-not-leak"
        client = CloudApprovalClient(
            "https://approval.example.com",
            machine_token=token,
            transport=transport,
        )

        with self.assertRaises(CloudApprovalError) as ctx:
            client.request_json("POST", "/api/test", {"hello": "world"})

        self.assertNotIn(token, str(ctx.exception))
        self.assertIn("mach...", str(ctx.exception))

    def test_request_json_transport_exception_does_not_chain_full_token(self):
        token = "machine-token-value-that-must-not-leak"
        transport = FakeTransport([
            RuntimeError(f"transport failed with Authorization: Bearer {token}"),
        ])
        client = CloudApprovalClient(
            "https://approval.example.com",
            machine_token=token,
            transport=transport,
        )

        with self.assertRaises(CloudApprovalError) as ctx:
            client.request_json("POST", "/api/test", {"hello": "world"})

        self.assertNotIn(token, str(ctx.exception))
        self.assertTrue(ctx.exception.__cause__ is None or token not in repr(ctx.exception.__cause__))
        formatted = "".join(traceback.format_exception(ctx.exception))
        self.assertNotIn(token, formatted)
        self.assertIn("RuntimeError", str(ctx.exception))
        self.assertIn("mach...", str(ctx.exception))

    def test_upload_asset_exception_does_not_return_signed_upload_url(self):
        signed_url = "https://upload.example.com/object?signature=secret-upload-token"
        transport = FakeTransport([
            urllib.error.HTTPError(signed_url, 403, "Forbidden", {}, None),
        ])
        token = "machine-token-value-that-must-not-leak"
        client = CloudApprovalClient(
            "https://approval.example.com",
            machine_token=token,
            transport=transport,
        )

        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "asset.jpg"
            path.write_bytes(b"image-bytes")
            with self.assertRaises(CloudApprovalError) as ctx:
                client.upload_asset(signed_url, path, "image/jpeg")

        self.assertNotIn(signed_url, str(ctx.exception))
        self.assertNotIn("secret-upload-token", str(ctx.exception))
        self.assertNotIn(token, str(ctx.exception))

    def test_upload_asset_transport_exception_does_not_chain_full_token(self):
        token = "machine-token-value-that-must-not-leak"
        transport = FakeTransport([
            RuntimeError(f"upload failed with Authorization: Bearer {token}"),
        ])
        client = CloudApprovalClient(
            "https://approval.example.com",
            machine_token=token,
            transport=transport,
        )

        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "asset.jpg"
            path.write_bytes(b"image-bytes")
            with self.assertRaises(CloudApprovalError) as ctx:
                client.upload_asset("https://upload.example.com/object", path, "image/jpeg")

        self.assertNotIn(token, str(ctx.exception))
        self.assertTrue(ctx.exception.__cause__ is None or token not in repr(ctx.exception.__cause__))
        formatted = "".join(traceback.format_exception(ctx.exception))
        self.assertNotIn(token, formatted)
        self.assertIn("RuntimeError", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
