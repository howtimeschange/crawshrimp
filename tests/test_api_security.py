import os
import unittest
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

    async def test_health_route_is_public(self):
        async def call_next(_request):
            return PlainTextResponse("ok")

        with patch.dict(os.environ, {"CRAWSHRIMP_API_TOKEN": "unit-token"}, clear=False):
            response = await api_server.require_local_api_token(FakeRequest("/health"), call_next)

        self.assertEqual(response.status_code, 200)


if __name__ == "__main__":
    unittest.main()
