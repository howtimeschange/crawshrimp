import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from starlette.responses import PlainTextResponse

from core import api_server


class FakeRequest:
    def __init__(self, path: str, headers: dict[str, str] | None = None, method: str = "GET"):
        self.method = method
        self.url = SimpleNamespace(path=path)
        self.headers = headers or {}


class ApiSecurityTests(unittest.IsolatedAsyncioTestCase):
    async def test_token_required_for_non_health_routes(self):
        async def call_next(_request):
            return PlainTextResponse("ok")

        with patch.dict(os.environ, {"CRAWSHRIMP_API_TOKEN": "unit-token"}, clear=False):
            blocked = await api_server.require_local_api_token(FakeRequest("/adapters"), call_next)
            allowed = await api_server.require_local_api_token(
                FakeRequest("/adapters", {"x-crawshrimp-token": "unit-token"}),
                call_next,
            )

        self.assertEqual(blocked.status_code, 401)
        self.assertEqual(allowed.status_code, 200)

    async def test_unauthorized_local_browser_response_keeps_cors_headers(self):
        async def call_next(_request):
            return PlainTextResponse("ok")

        request = FakeRequest(
            "/tasks",
            headers={"origin": "http://127.0.0.1:5173"},
        )
        with patch.dict(os.environ, {"CRAWSHRIMP_API_TOKEN": "unit-token"}, clear=False):
            blocked = await api_server.require_local_api_token(request, call_next)

        self.assertEqual(blocked.status_code, 401)
        self.assertEqual(blocked.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173")
        self.assertIn("X-Crawshrimp-Token", blocked.headers.get("access-control-allow-headers"))

    async def test_health_route_is_public(self):
        async def call_next(_request):
            return PlainTextResponse("ok")

        with patch.dict(os.environ, {"CRAWSHRIMP_API_TOKEN": "unit-token"}, clear=False):
            response = await api_server.require_local_api_token(FakeRequest("/health"), call_next)

        self.assertEqual(response.status_code, 200)

    async def test_adapter_assets_route_is_public(self):
        async def call_next(_request):
            return PlainTextResponse("ok")

        with patch.dict(os.environ, {"CRAWSHRIMP_API_TOKEN": "unit-token"}, clear=False):
            response = await api_server.require_local_api_token(
                FakeRequest("/adapter-assets/tmall-ops-assistant/vendor/tesseract/tesseract.min.js"),
                call_next,
            )

        self.assertEqual(response.status_code, 200)

    async def test_bala_material_batch_creation_requires_api_auth_while_tokenized_images_stay_public(self):
        async def call_next(_request):
            return PlainTextResponse("ok")

        with patch.dict(os.environ, {"CRAWSHRIMP_API_TOKEN": "unit-token"}, clear=False):
            blocked = await api_server.require_local_api_token(
                FakeRequest("/bala-ai-video-materials/api/from-rows", method="POST"),
                call_next,
            )
            allowed = await api_server.require_local_api_token(
                FakeRequest("/bala-ai-video-materials/api/batch/image/asset", method="GET"),
                call_next,
            )

        self.assertEqual(blocked.status_code, 401)
        self.assertEqual(allowed.status_code, 200)

    async def test_bala_review_export_requires_local_api_auth(self):
        async def call_next(_request):
            return PlainTextResponse("ok")

        path = "/bala-ai-video-review/api/review-batch/export-video-input"
        with patch.dict(os.environ, {"CRAWSHRIMP_API_TOKEN": "unit-token"}, clear=False):
            blocked = await api_server.require_local_api_token(
                FakeRequest(path, method="POST"),
                call_next,
            )
            allowed = await api_server.require_local_api_token(
                FakeRequest(path, {"x-crawshrimp-token": "unit-token"}, method="POST"),
                call_next,
            )

        self.assertEqual(blocked.status_code, 401)
        self.assertEqual(allowed.status_code, 200)

    def test_adapter_asset_response_is_path_scoped_and_cors_enabled(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            adapter_dir = Path(tmpdir) / "demo-adapter"
            asset = adapter_dir / "vendor" / "tesseract" / "tesseract.min.js"
            asset.parent.mkdir(parents=True)
            asset.write_text("window.Tesseract={}", encoding="utf-8")
            outside = Path(tmpdir) / "outside.js"
            outside.write_text("outside", encoding="utf-8")

            with patch("core.api_server.adapter_loader.get_adapter_dir", return_value=adapter_dir):
                response = api_server.get_adapter_asset("demo-adapter", "vendor/tesseract/tesseract.min.js")
                self.assertEqual(response.headers.get("access-control-allow-origin"), "*")

                with self.assertRaises(api_server.HTTPException) as ctx:
                    api_server.get_adapter_asset("demo-adapter", "../outside.js")
                self.assertEqual(ctx.exception.status_code, 400)

                with self.assertRaises(api_server.HTTPException) as ctx:
                    api_server.get_adapter_asset("demo-adapter", str(outside))
                self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
