import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi import HTTPException

from core import ai_image_service
from core import api_server
from core import data_sink


class AiImageApiTests(unittest.TestCase):
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

    def test_ai_image_routes_are_registered(self):
        for method, path in [
            ("GET", "/ai-image/jobs"),
            ("POST", "/ai-image/jobs"),
            ("GET", "/ai-image/jobs/{job_uid}"),
            ("PATCH", "/ai-image/jobs/{job_uid}"),
            ("POST", "/ai-image/jobs/{job_uid}/run"),
            ("POST", "/ai-image/jobs/{job_uid}/save-as"),
            ("POST", "/ai-image/assets"),
            ("POST", "/ai-image/canvases"),
        ]:
            self.assertRouteRegistered(path, method)

    def test_job_crud_api_uses_data_sink(self):
        created = api_server.create_ai_image_job(api_server.AiImageJobRequest(
            title="主图",
            prompt="prompt",
            params={"size": "1024x1024"},
        ))

        self.assertEqual(api_server.get_ai_image_job(created["job_uid"])["title"], "主图")
        updated = api_server.update_ai_image_job(created["job_uid"], api_server.AiImageJobPatchRequest(status="ready"))
        self.assertEqual(updated["status"], "ready")
        self.assertEqual(api_server.list_ai_image_jobs()[0]["job_uid"], created["job_uid"])

    def test_job_create_and_patch_ignore_client_controlled_summary(self):
        unsafe_summary = {
            "api_key": "super-secret",
            "image": "data:image/png;base64,abc",
            "webhook_secret": "hook-secret",
            "raw": {"payload": "upstream"},
        }

        created = api_server.create_ai_image_job(api_server.AiImageJobRequest(
            title="unsafe",
            prompt="prompt",
            summary=unsafe_summary,
        ))
        updated = api_server.update_ai_image_job(
            created["job_uid"],
            api_server.AiImageJobPatchRequest(summary=unsafe_summary),
        )

        self.assertEqual(created["summary"], {})
        self.assertEqual(updated["summary"], {})
        self.assertEqual(data_sink.get_ai_image_job(created["job_uid"])["summary"], {})

    def test_asset_and_canvas_creation_api(self):
        job = data_sink.create_ai_image_job({"title": "api job"})

        asset = api_server.create_ai_image_asset(api_server.AiImageAssetRequest(
            job_uid=job["job_uid"],
            kind="reference",
            path="/tmp/ref.png",
            meta={"slot": "front"},
        ))
        canvas = api_server.create_ai_image_canvas(api_server.AiImageCanvasRequest(
            job_uid=job["job_uid"],
            title="canvas",
            canvas={"nodes": []},
        ))

        self.assertEqual(asset["meta"]["slot"], "front")
        self.assertEqual(canvas["canvas"], {"nodes": []})

    def test_run_job_api_uses_fake_service(self):
        job = data_sink.create_ai_image_job({"title": "run job"})

        with patch("core.api_server.ai_image_service.run_job_with_one_xm", return_value={"ok": True, "job_uid": job["job_uid"]}) as run:
            result = api_server.run_ai_image_job(job["job_uid"])

        self.assertEqual(result, {"ok": True, "job_uid": job["job_uid"]})
        run.assert_called_once_with(job["job_uid"])

    def test_run_job_api_missing_key_error_exposes_config_id(self):
        job = data_sink.create_ai_image_job({"title": "missing key"})
        error = ai_image_service.MissingModelKeyError(
            "设置菜单未配置 1XM 图片模型 API Key",
            config_id="ai.1xm.gemini_3_pro_image_preview_key",
        )

        with patch("core.api_server.ai_image_service.run_job_with_one_xm", side_effect=error):
            with self.assertRaises(HTTPException) as ctx:
                api_server.run_ai_image_job(job["job_uid"])

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail["config_id"], "ai.1xm.gemini_3_pro_image_preview_key")

    def test_save_as_api_uses_service_copy(self):
        job = data_sink.create_ai_image_job({"title": "save job"})
        output = self.root / "out.png"
        data_sink.update_ai_image_job(job["job_uid"], {"summary": {"output_files": [str(output)]}})

        with patch("core.api_server.ai_image_service.copy_assets_to_directory", return_value=[str(self.root / "copy.png")]) as copy:
            result = api_server.save_as_ai_image_job(job["job_uid"], api_server.AiImageSaveAsRequest(directory=str(self.root / "export")))

        self.assertEqual(result["files"], [str(self.root / "copy.png")])
        copy.assert_called_once()


if __name__ == "__main__":
    unittest.main()
