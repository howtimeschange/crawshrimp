import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import api_server
from core import data_sink


class AiVideoGenerationApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        patcher = patch("core.runtime_paths.data_root", return_value=self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()

    def assertRouteRegistered(self, path, method):
        routes = [
            route for route in api_server.app.routes
            if getattr(route, "path", "") == path and method in getattr(route, "methods", set())
        ]
        self.assertTrue(routes, f"{method} {path} is not registered")

    def test_ai_video_routes_are_registered(self):
        for method, path in [
            ("GET", "/ai-video/config"),
            ("POST", "/ai-video/validate"),
            ("POST", "/ai-video/jobs"),
            ("GET", "/ai-video/jobs"),
            ("GET", "/ai-video/jobs/{job_id}"),
            ("PATCH", "/ai-video/jobs/{job_id}"),
            ("POST", "/ai-video/jobs/{job_id}/duplicate"),
            ("POST", "/ai-video/jobs/{job_id}/retry"),
            ("DELETE", "/ai-video/jobs/{job_id}"),
            ("GET", "/ai-video/runs/{run_id}"),
            ("POST", "/ai-video/runs/{run_id}/archive"),
        ]:
            self.assertRouteRegistered(path, method)

    def test_config_endpoint_returns_models(self):
        result = api_server.ai_video_get_config()
        self.assertTrue(result["ok"])
        models = result["data"]["models"]
        self.assertEqual(models[0]["id"], "seedance-2.0")
        self.assertEqual(len(models), 4)


if __name__ == "__main__":
    unittest.main()
