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

    def assertRouteNotRegistered(self, path, method):
        routes = [
            route for route in api_server.app.routes
            if getattr(route, "path", "") == path and method in getattr(route, "methods", set())
        ]
        self.assertFalse(routes, f"{method} {path} is unexpectedly registered")

    def test_ai_video_routes_are_registered(self):
        for method, path in [
            ("GET", "/ai-video/config"),
            ("POST", "/ai-video/validate"),
            ("POST", "/ai-video/jobs"),
            ("GET", "/ai-video/jobs"),
            ("GET", "/ai-video/jobs/{job_id}"),
            ("PATCH", "/ai-video/jobs/{job_id}"),
            ("POST", "/ai-video/jobs/{job_id}/retry"),
            ("DELETE", "/ai-video/jobs/{job_id}"),
            ("GET", "/ai-video/runs/{run_id}"),
            ("POST", "/ai-video/runs/{run_id}/archive"),
        ]:
            self.assertRouteRegistered(path, method)

    def test_ai_video_duplicate_route_is_not_exposed(self):
        self.assertRouteNotRegistered("/ai-video/jobs/{job_id}/duplicate", "POST")

    def test_delete_job_passes_local_file_deletion_option(self):
        with patch.object(api_server.ai_video_generation_service, "delete_job", return_value={"ok": True}) as deleted:
            result = api_server.ai_video_delete_job("job-1", delete_local_file=True)

        self.assertTrue(result["ok"])
        deleted.assert_called_once_with("job-1", delete_local_file=True)

    def test_config_endpoint_returns_models(self):
        result = api_server.ai_video_get_config()
        self.assertTrue(result["ok"])
        models = result["data"]["models"]
        self.assertEqual(models[0]["id"], "seedance-2.0")
        self.assertEqual(len(models), 7)
        self.assertIn("kling/kling-v3-video-generation", {item["id"] for item in models})
        self.assertIn("pixverse/pixverse-motioncontrol", {item["id"] for item in models})

    def test_public_parameter_schema_accepts_bailian_gateway_fields(self):
        req = api_server.AiVideoValidateRequest.model_validate({
            "provider": "happyhorse",
            "model": "kling/kling-v3-video-generation",
            "prompt": "在火车里吃火锅唱歌",
            "assets": [],
            "parameters": {
                "mode": "std",
                "aspect_ratio": "16:9",
                "duration": 5,
                "audio": True,
                "watermark": False,
                "media": [
                    {"type": "first_frame", "url": "https://example.com/start.jpg"},
                    {"type": "last_frame", "url": "https://example.com/end.jpg"},
                ],
            },
            "outputDirToken": "token",
        })
        payload = api_server._model_payload(req, exclude_none=True)
        self.assertEqual(payload["parameters"]["mode"], "std")
        self.assertEqual(payload["parameters"]["media"][0]["type"], "first_frame")

        pixverse_req = api_server.AiVideoValidateRequest.model_validate({
            "provider": "happyhorse",
            "model": "pixverse/pixverse-motioncontrol",
            "prompt": "",
            "assets": [],
            "parameters": {
                "imageUrl": "https://example.com/character.png",
                "videoUrl": "https://example.com/motion.mp4",
                "resolution": "720P",
                "watermark": False,
            },
            "outputDirToken": "token",
        })
        pixverse_payload = api_server._model_payload(pixverse_req, exclude_none=True)
        self.assertEqual(pixverse_payload["parameters"]["imageUrl"], "https://example.com/character.png")
        self.assertEqual(pixverse_payload["parameters"]["videoUrl"], "https://example.com/motion.mp4")


if __name__ == "__main__":
    unittest.main()
