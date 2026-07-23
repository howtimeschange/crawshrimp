import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from PIL import Image
from pydantic import ValidationError

from core import ai_video_generation_service as svc
from core import api_server, runtime_paths
from core.config import load_config, patch_config


class AiVideoGenerationSecurityApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        patcher = patch("core.runtime_paths.data_root", return_value=self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        capability_env = patch.dict(
            os.environ,
            {"CRAWSHRIMP_AI_VIDEO_CAPABILITY_SECRET": "7a" * 32},
        )
        capability_env.start()
        self.addCleanup(capability_env.stop)

    def test_settings_response_never_contains_ai_video_credentials_or_connection_values(self):
        patch_config({
            "ai.video.seedance_api_key": "seedance-secret",
            "ai.video.seedance_base_url": "https://private-seedance.invalid",
            "ai.video.bailian_api_key": "bailian-secret",
            "ai.video.bailian_workspace_id": "workspace-secret",
            "ai.video.bailian_region": "private-region",
            "ai.video.bailian_base_url": "https://private-bailian.invalid",
            "ai.video.bailian_upload_api_key": "upload-secret",
            "ai.video.bailian_uploads_url": "https://private-upload.invalid/api/v1/uploads",
        })

        settings = api_server.get_settings()
        video = settings["ai"]["video"]

        for field in (
            "seedance_api_key",
            "seedance_base_url",
            "bailian_api_key",
            "bailian_workspace_id",
            "bailian_region",
            "bailian_base_url",
            "bailian_upload_api_key",
            "bailian_uploads_url",
        ):
            self.assertNotIn(field, video)
        self.assertEqual(video["seedance_configured"], True)
        self.assertEqual(video["happyhorse_configured"], True)
        self.assertEqual(video["bailian_upload_configured"], True)

    def test_settings_writes_preserve_hidden_ai_video_values_when_omitted_or_blank(self):
        patch_config({
            "ai.video.seedance_api_key": "seedance-secret",
            "ai.video.seedance_base_url": "https://private-seedance.invalid",
            "ai.video.bailian_api_key": "bailian-secret",
            "ai.video.bailian_upload_api_key": "upload-secret",
            "ai.video.bailian_uploads_url": "https://private-upload.invalid/api/v1/uploads",
        })

        api_server.put_settings({"data_dir": "new-data"})
        api_server.patch_settings({
            "ai.video.seedance_api_key": "",
            "ai.video.seedance_base_url": "",
            "ai.video.bailian_api_key": "replacement-secret",
            "ai.video.bailian_upload_api_key": "",
            "ai.video.bailian_uploads_url": "",
        })

        video = load_config()["ai"]["video"]
        self.assertEqual(video["seedance_api_key"], "seedance-secret")
        self.assertEqual(video["seedance_base_url"], "https://private-seedance.invalid")
        self.assertEqual(video["bailian_api_key"], "replacement-secret")
        self.assertEqual(video["bailian_upload_api_key"], "upload-secret")
        self.assertEqual(video["bailian_uploads_url"], "https://private-upload.invalid/api/v1/uploads")

    def test_settings_response_and_blank_writes_never_expose_or_erase_llm_key(self):
        patch_config({
            "ai.llm.api_key": "llm-secret",
            "ai.llm.default_model": "claude-sonnet-5",
        })

        settings = api_server.get_settings()
        self.assertNotIn("api_key", settings["ai"]["llm"])
        self.assertEqual(settings["ai"]["llm"]["configured"], True)
        self.assertEqual(settings["ai"]["llm"]["default_model"], "claude-sonnet-5")

        api_server.patch_settings({
            "ai.llm.api_key": "",
            "ai.llm.configured": True,
            "ai.llm.default_model": "gpt-5.6-terra",
        })
        llm = load_config()["ai"]["llm"]
        self.assertEqual(llm["api_key"], "llm-secret")
        self.assertEqual(llm["default_model"], "gpt-5.6-terra")
        self.assertNotIn("configured", llm)

    def test_non_owner_backend_rejects_every_ai_video_mutation_route(self):
        previous = getattr(api_server.app.state, "owns_backend_instance", None)
        api_server.app.state.owns_backend_instance = False
        self.addCleanup(setattr, api_server.app.state, "owns_backend_instance", previous)

        calls = [
            (
                "create_job",
                lambda: api_server.ai_video_create_job(api_server.AiVideoCreateJobRequest(
                    requestUid="req-1",
                    provider="seedance",
                    model="seedance-2.0",
                    prompt="test",
                )),
            ),
            (
                "update_job",
                lambda: api_server.ai_video_update_job("job-1", api_server.AiVideoUpdateJobRequest(prompt="next")),
            ),
            (
                "retry_job",
                lambda: api_server.ai_video_retry_job("job-1", api_server.AiVideoRetryRequest(requestUid="retry-1")),
            ),
            ("delete_job", lambda: api_server.ai_video_delete_job("job-1")),
            ("retry_archive", lambda: api_server.ai_video_retry_archive("run-1")),
        ]

        for method_name, invoke in calls:
            with self.subTest(method=method_name), patch.object(
                api_server.ai_video_generation_service,
                method_name,
            ) as mocked:
                with self.assertRaises(HTTPException) as captured:
                    invoke()
                self.assertEqual(captured.exception.status_code, 503)
                mocked.assert_not_called()

    def test_http_models_accept_only_capability_tokens_for_local_paths(self):
        request = api_server.AiVideoValidateRequest(
            provider="seedance",
            model="seedance-2.0",
            prompt="test",
            assets=[{"fileToken": "avcap2.file.sealed", "sortOrder": 0}],
            outputDirToken="avcap2.directory.sealed",
        )
        payload = api_server._model_payload(request, exclude_none=True)
        self.assertEqual(payload["assets"][0]["fileToken"], "avcap2.file.sealed")
        self.assertEqual(payload["outputDirToken"], "avcap2.directory.sealed")

        with self.assertRaises(ValidationError):
            api_server.AiVideoValidateRequest(
                provider="seedance",
                model="seedance-2.0",
                prompt="test",
                assets=[{"localPath": "/tmp/unselected.jpg"}],
                outputDirToken="avcap2.directory.sealed",
            )
        with self.assertRaises(ValidationError):
            api_server.AiVideoValidateRequest(
                provider="seedance",
                model="seedance-2.0",
                prompt="test",
                assets=[],
                outputDir="/tmp/unselected-output",
            )

    def test_validate_response_never_exposes_capability_paths(self):
        image = self.root / "private-reference.jpg"
        Image.new("RGB", (512, 512), color=(30, 80, 160)).save(image, format="JPEG")
        output_dir = self.root / "private-output"
        output_dir.mkdir()
        request = api_server.AiVideoValidateRequest(
            provider="seedance",
            model="seedance-2.0",
            prompt="validate without returning local paths",
            assets=[{
                "fileToken": svc.issue_path_capability(image, kind="file", scope="input"),
                "sortOrder": 0,
            }],
            parameters={"ratio": "9:16", "resolution": "720p", "duration": 5},
            outputDirToken=svc.issue_path_capability(output_dir, kind="directory", scope="output"),
        )

        with patch.object(svc, "provider_status", return_value={
            "seedance": {"configured": True, "source": "test", "cliReady": True},
            "happyhorse": {"configured": True, "source": "test", "cliReady": True},
        }):
            result = api_server.ai_video_validate(request)

        serialized = json.dumps(result, ensure_ascii=False)
        self.assertTrue(result["ok"])
        self.assertNotIn(str(self.root), serialized)
        self.assertNotIn(str(Path.home()), serialized)
        self.assertNotIn("localPath", serialized)
        self.assertNotIn("outputDir", serialized)
        self.assertEqual(result["data"]["assets"][0]["name"], image.name)
        self.assertEqual(result["data"]["assets"][0]["width"], 512)
        self.assertEqual(result["data"]["assets"][0]["height"], 512)


if __name__ == "__main__":
    unittest.main()
