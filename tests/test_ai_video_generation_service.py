import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from core import ai_video_generation_service as svc
from core import data_sink


READY_PROVIDER_STATUS = {
    "seedance": {"configured": True, "source": "test", "cliReady": True},
    "happyhorse": {"configured": True, "source": "test", "cliReady": True},
}
CAPABILITY_SECRET = "9f" * 32


class _ImmediateThread:
    def __init__(self, *, target=None, args=(), kwargs=None, **_options):
        self.target = target
        self.args = args
        self.kwargs = kwargs or {}

    def start(self):
        if self.target:
            self.target(*self.args, **self.kwargs)

    def is_alive(self):
        return False


class AiVideoGenerationServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.output_dir = self.root / "out"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        capability_env = patch.dict(
            os.environ,
            {"CRAWSHRIMP_AI_VIDEO_CAPABILITY_SECRET": CAPABILITY_SECRET},
        )
        capability_env.start()
        self.addCleanup(capability_env.stop)
        patcher = patch("core.runtime_paths.data_root", return_value=self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        child_dir_patcher = patch(
            "core.runtime_paths.child_dir",
            side_effect=lambda child_name, create=True: self.root / child_name,
        )
        child_dir_patcher.start()
        self.addCleanup(child_dir_patcher.stop)
        data_sink.init_db()
        svc.set_cli_runner(None)
        svc.set_downloader(None)
        self.addCleanup(lambda: svc.set_cli_runner(None))
        self.addCleanup(lambda: svc.set_downloader(None))
        self.addCleanup(svc.stop_worker)
        poster_patcher = patch.object(svc, "extract_video_poster", return_value=None)
        poster_patcher.start()
        self.addCleanup(poster_patcher.stop)
        default_output_patcher = patch.object(svc, "default_output_dir", return_value=self.output_dir)
        default_output_patcher.start()
        self.addCleanup(default_output_patcher.stop)

    def _write_image(self, name: str, size=(512, 512)) -> Path:
        path = self.root / name
        Image.new("RGB", size, color=(20, 120, 200)).save(path, format="JPEG")
        return path

    def _capability(
        self,
        kind: str,
        scope: str,
        path: Path,
        *,
        issued_at: int | None = None,
        resolve_path: bool = True,
    ) -> str:
        payload = {
            "v": 2,
            "kind": kind,
            "scope": scope,
            "path": str(path.resolve(strict=False) if resolve_path else path.absolute()),
            "issuedAt": issued_at if issued_at is not None else int(time.time() * 1000),
        }
        return svc._encrypt_path_capability_payload(payload)

    def test_public_status_enum_and_hidden_fields_rejected(self):
        self.assertEqual(
            set(svc.PUBLIC_STATUSES),
            {
                "draft",
                "queued",
                "running",
                "downloading",
                "completed",
                "needs_config",
                "failed",
                "cancelled",
                "expired",
            },
        )
        with self.assertRaises(svc.AiVideoError):
            svc.normalize_parameters("seedance", svc.SEEDANCE_MODEL, {"seed": 1, "resolution": "720p", "duration": 5})

    def test_seedance_and_happyhorse_validation_matrix(self):
        img = self._write_image("ref.jpg")
        image_token = self._capability("file", "input", img)
        output_token = self._capability("directory", "output", self.output_dir)
        seedance = svc.validate_input({
            "provider": "seedance",
            "model": "seedance-2.0",
            "prompt": "a cinematic product shot",
            "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5, "generateAudio": True, "watermark": False},
            "assets": [{"fileToken": image_token}],
            "outputDirToken": output_token,
        })
        self.assertEqual(seedance["model"], svc.SEEDANCE_MODEL)
        self.assertEqual(seedance["parameters"]["duration"], 5)

        with self.assertRaises(svc.AiVideoError) as captured:
            svc.validate_input({
                "provider": "happyhorse",
                "model": "happyhorse-1.1-t2v",
                "prompt": "text only",
                "parameters": {"ratio": "16:9", "resolution": "720P", "duration": 5},
                "assets": [{"fileToken": image_token}],
                "outputDirToken": output_token,
            })

        with self.assertRaises(svc.AiVideoError) as unsigned_output:
            svc.validate_input({
                "provider": "happyhorse",
                "model": "happyhorse-1.1-i2v",
                "prompt": "i2v",
                "parameters": {"ratio": "16:9", "resolution": "720P", "duration": 5},
                "assets": [{"fileToken": image_token}],
                "outputDirToken": output_token,
            })

        i2v = svc.validate_input({
            "provider": "happyhorse",
            "model": "happyhorse-1.1-i2v",
            "prompt": "i2v",
            "parameters": {"resolution": "720P", "duration": 5, "watermark": False},
            "assets": [{"fileToken": image_token}],
            "outputDirToken": output_token,
        })
        self.assertNotIn("ratio", i2v["parameters"])

    def test_provider_and_model_must_match_exactly(self):
        self.assertEqual(
            svc.resolve_model("seedance", "seedance-2.0"),
            ("seedance", svc.SEEDANCE_MODEL),
        )
        self.assertEqual(
            svc.resolve_model("happyhorse", "happyhorse-1.1-t2v"),
            ("happyhorse", "happyhorse-1.1-t2v"),
        )
        self.assertEqual(
            svc.resolve_model("happyhorse", svc.KLING_V3_MODEL),
            ("happyhorse", svc.KLING_V3_MODEL),
        )
        self.assertEqual(
            svc.resolve_model("happyhorse", "pixverse-motioncontrol"),
            ("happyhorse", svc.PIXVERSE_MOTIONCONTROL_MODEL),
        )
        for provider, model in (
            ("seedance", "happyhorse-1.1-t2v"),
            ("happyhorse", "seedance-2.0"),
            ("seedance", "arbitrary-seedance-model"),
        ):
            with self.subTest(provider=provider, model=model):
                with self.assertRaises(svc.AiVideoError):
                    svc.resolve_model(provider, model)

    def test_bailian_gateway_models_validate_and_build_payloads(self):
        output_token = self._capability("directory", "output", self.output_dir)
        with patch.object(svc, "provider_status", return_value=READY_PROVIDER_STATUS):
            kling = svc.validate_input({
                "provider": "happyhorse",
                "model": svc.KLING_V3_MODEL,
                "prompt": "在火车里吃火锅唱歌",
                "parameters": {
                    "mode": "std",
                    "aspect_ratio": "16:9",
                    "duration": 5,
                    "audio": True,
                    "watermark": False,
                },
                "assets": [],
                "outputDirToken": output_token,
            })
            self.assertEqual(kling["model"], svc.KLING_V3_MODEL)
            self.assertEqual(kling["parameters"]["aspect_ratio"], "16:9")
            self.assertEqual(svc.build_provider_payload(kling), {
                "model": svc.KLING_V3_MODEL,
                "input": {"prompt": "在火车里吃火锅唱歌"},
                "parameters": {
                    "mode": "std",
                    "aspect_ratio": "16:9",
                    "duration": 5,
                    "audio": True,
                    "watermark": False,
                },
            })

            kling_i2v = svc.validate_input({
                "provider": "happyhorse",
                "model": svc.KLING_V3_MODEL,
                "prompt": "从车厢窗边推近到火锅桌，人物开口唱歌",
                "parameters": {
                    "mode": "std",
                    "aspect_ratio": "16:9",
                    "duration": 5,
                    "audio": True,
                    "watermark": False,
                    "media": [
                        {"type": "first_frame", "url": "https://example.com/train-start.jpg"},
                        {"type": "last_frame", "url": "https://example.com/train-end.jpg"},
                    ],
                },
                "assets": [],
                "outputDirToken": output_token,
            })
            self.assertEqual(kling_i2v["parameters"]["media"], [
                {"type": "first_frame", "url": "https://example.com/train-start.jpg"},
                {"type": "last_frame", "url": "https://example.com/train-end.jpg"},
            ])
            self.assertEqual(svc.build_provider_payload(kling_i2v), {
                "model": svc.KLING_V3_MODEL,
                "input": {
                    "prompt": "从车厢窗边推近到火锅桌，人物开口唱歌",
                    "media": [
                        {"type": "first_frame", "url": "https://example.com/train-start.jpg"},
                        {"type": "last_frame", "url": "https://example.com/train-end.jpg"},
                    ],
                },
                "parameters": {
                    "mode": "std",
                    "duration": 5,
                    "audio": True,
                    "watermark": False,
                },
            })

            kling_omni = svc.validate_input({
                "provider": "happyhorse",
                "model": svc.KLING_OMNI_MODEL,
                "prompt": "参考人物主体，在火车里吃火锅唱歌",
                "parameters": {
                    "mode": "std",
                    "aspect_ratio": "16:9",
                    "duration": 5,
                    "audio": False,
                    "watermark": False,
                    "media": [
                        {"type": "refer", "url": "https://example.com/person.png"},
                        {
                            "type": "feature",
                            "url": "https://example.com/motion.mp4",
                            "keep_original_sound": "no",
                        },
                    ],
                },
                "assets": [],
                "outputDirToken": output_token,
            })
            self.assertEqual(svc.build_provider_payload(kling_omni)["input"]["media"], [
                {"type": "refer", "url": "https://example.com/person.png"},
                {"type": "feature", "url": "https://example.com/motion.mp4", "keep_original_sound": "no"},
            ])

            pixverse = svc.validate_input({
                "provider": "happyhorse",
                "model": svc.PIXVERSE_MOTIONCONTROL_MODEL,
                "prompt": "",
                "parameters": {
                    "imageUrl": "https://example.com/character.png",
                    "videoUrl": "https://example.com/motion.mp4",
                    "resolution": "720P",
                    "watermark": False,
                },
                "assets": [],
                "outputDirToken": output_token,
            })
            self.assertEqual(svc.build_provider_payload(pixverse), {
                "model": svc.PIXVERSE_MOTIONCONTROL_MODEL,
                "input": {
                    "media": [
                        {"type": "image_url", "url": "https://example.com/character.png"},
                        {"type": "video_url", "url": "https://example.com/motion.mp4"},
                    ],
                },
                "parameters": {"resolution": "720P", "watermark": False},
            })

    def test_bailian_gateway_models_reject_wrong_input_shapes(self):
        img = self._write_image("kling-local-ref.jpg")
        image_token = self._capability("file", "input", img)
        output_token = self._capability("directory", "output", self.output_dir)
        local_kling = svc.validate_input({
            "provider": "happyhorse",
            "model": svc.KLING_V3_MODEL,
            "prompt": "local image should be uploaded before provider submission",
            "parameters": {"aspect_ratio": "16:9", "duration": 5},
            "assets": [{"fileToken": image_token, "role": "first_frame"}],
            "outputDirToken": output_token,
        })
        self.assertEqual(local_kling["assets"][0]["role"], "first_frame")
        self.assertEqual(local_kling["assets"][0]["kind"], "image")
        with self.assertRaises(svc.AiVideoError):
            svc.validate_input({
                "provider": "happyhorse",
                "model": svc.KLING_V3_MODEL,
                "prompt": "file URL should be rejected",
                "parameters": {
                    "aspect_ratio": "16:9",
                    "duration": 5,
                    "media": [{"type": "first_frame", "url": "file:///tmp/frame.jpg"}],
                },
                "assets": [],
                "outputDirToken": output_token,
            })
        with self.assertRaises(svc.AiVideoError):
            svc.validate_input({
                "provider": "happyhorse",
                "model": svc.KLING_V3_MODEL,
                "prompt": "unsupported media type for v3",
                "parameters": {
                    "aspect_ratio": "16:9",
                    "duration": 5,
                    "media": [{"type": "refer", "url": "https://example.com/ref.jpg"}],
                },
                "assets": [],
                "outputDirToken": output_token,
            })
        with self.assertRaises(svc.AiVideoError):
            svc.validate_input({
                "provider": "happyhorse",
                "model": svc.PIXVERSE_MOTIONCONTROL_MODEL,
                "prompt": "",
                "parameters": {
                    "imageUrl": "file:///tmp/character.png",
                    "videoUrl": "https://example.com/motion.mp4",
                    "resolution": "720P",
                },
                "assets": [],
                "outputDirToken": output_token,
            })

    def test_pixverse_local_assets_are_uploaded_to_bailian_temp_urls_before_payload(self):
        image = self._write_image("pixverse-character.jpg")
        video = self.root / "pixverse-motion.mp4"
        video.write_bytes(b"\x00\x00\x00\x18ftypmp42demo-video")
        output_token = self._capability("directory", "output", self.output_dir)
        normalized = svc.validate_input({
            "provider": "happyhorse",
            "model": svc.PIXVERSE_MOTIONCONTROL_MODEL,
            "prompt": "",
            "parameters": {"resolution": "720P", "watermark": False},
            "assets": [
                {"fileToken": self._capability("file", "input", image), "role": "image_url", "sortOrder": 0},
                {"fileToken": self._capability("file", "input", video), "role": "video_url", "sortOrder": 1},
            ],
            "outputDirToken": output_token,
        })
        self.assertEqual([asset["kind"] for asset in normalized["assets"]], ["image", "video"])

        def fake_upload(*, api_key, model, path):
            self.assertEqual(api_key, "runtime-key")
            self.assertEqual(model, svc.PIXVERSE_MOTIONCONTROL_MODEL)
            return f"oss://dashscope-instant/test/{Path(path).name}"

        with patch.object(svc, "provider_secrets", return_value={"happyhorse": "runtime-key"}), \
                patch.object(svc, "_upload_file_to_bailian_temp_storage", side_effect=fake_upload):
            prepared = svc._with_bailian_temp_uploaded_assets(normalized)

        self.assertEqual(svc.build_provider_payload(prepared), {
            "model": svc.PIXVERSE_MOTIONCONTROL_MODEL,
            "input": {
                "media": [
                    {"type": "image_url", "url": "oss://dashscope-instant/test/pixverse-character.jpg"},
                    {"type": "video_url", "url": "oss://dashscope-instant/test/pixverse-motion.mp4"},
                ],
            },
            "parameters": {"resolution": "720P", "watermark": False},
        })

    def test_bailian_temp_upload_prefers_dedicated_upload_key(self):
        image = self._write_image("kling-first-frame.jpg")
        output_token = self._capability("directory", "output", self.output_dir)
        normalized = svc.validate_input({
            "provider": "happyhorse",
            "model": svc.KLING_V3_MODEL,
            "prompt": "在火车里吃火锅唱歌",
            "parameters": {"aspect_ratio": "16:9", "duration": 5, "media": []},
            "assets": [
                {"fileToken": self._capability("file", "input", image), "role": "first_frame", "sortOrder": 0},
            ],
            "outputDirToken": output_token,
        })

        used_keys = []

        def fake_upload(*, api_key, model, path):
            used_keys.append(api_key)
            self.assertEqual(model, svc.KLING_V3_MODEL)
            self.assertEqual(Path(path).name, "kling-first-frame.jpg")
            return "oss://dashscope-instant/test/kling-first-frame.jpg"

        with patch.object(svc, "provider_secrets", return_value={
            "happyhorse": "video-generation-key",
            "bailian_upload": "official-upload-key",
        }), patch.object(svc, "_upload_file_to_bailian_temp_storage", side_effect=fake_upload):
            prepared = svc._with_bailian_temp_uploaded_assets(normalized)

        self.assertEqual(used_keys, ["official-upload-key"])
        self.assertEqual(prepared["parameters"]["media"][0]["url"], "oss://dashscope-instant/test/kling-first-frame.jpg")

    def test_bailian_upload_policy_url_can_be_overridden_without_exposing_it_to_ui(self):
        with patch.dict(os.environ, {"BAILIAN_UPLOADS_URL": "https://gateway.example.com/uploads"}), \
                patch.object(svc, "load_config", return_value={}):
            self.assertEqual(svc.bailian_upload_policy_url(), "https://gateway.example.com/uploads")
        with patch.dict(os.environ, {"BAILIAN_UPLOADS_URL": "https://env.example.com/uploads"}), \
                patch.object(svc, "load_config", return_value={"ai": {"video": {"bailian_uploads_url": "https://cfg.example.com/uploads"}}}):
            self.assertEqual(svc.bailian_upload_policy_url(), "https://cfg.example.com/uploads")

    def test_semir_bailian_gateway_disables_local_pricing_estimate(self):
        cfg = {
            "ai": {
                "video": {
                    "bailian_api_key": "runtime-key",
                    "bailian_base_url": "https://ai-aigw.semir.com/bailian-vedio/api/v1",
                },
            },
        }
        with patch.object(svc, "load_config", return_value=cfg):
            status = svc.provider_status()
        self.assertTrue(status["happyhorse"]["configured"])
        self.assertFalse(status["happyhorse"]["pricingEstimateAvailable"])

    def test_provider_status_reports_dedicated_bailian_upload_configuration(self):
        cfg = {
            "ai": {
                "video": {
                    "bailian_upload_api_key": "official-upload-key",
                    "bailian_uploads_url": "https://dashscope.example.com/api/v1/uploads",
                },
            },
        }
        with patch.object(svc, "load_config", return_value=cfg):
            status = svc.provider_status()
        self.assertTrue(status["bailianUpload"]["configured"])
        self.assertEqual(status["bailianUpload"]["source"], "AI 能力")
        self.assertTrue(status["bailianUpload"]["policyUrlConfigured"])

    def test_provider_env_uses_minimal_allowlist_and_selected_provider_only(self):
        allowed = {
            "PATH": "/safe/bin:/usr/bin",
            "HOME": str(self.root),
            "TMPDIR": str(self.root / "tmp"),
            "LANG": "zh_CN.UTF-8",
            "LC_ALL": "zh_CN.UTF-8",
            "LC_TESTING": "kept-locale",
        }
        polluted = {
            "ARK_BASE_URL": "https://shell-seedance.invalid",
            "BAILIAN_BASE_URL": "https://shell-bailian.invalid",
            "BAILIAN_WORKSPACE_ID": "shell-workspace",
            "BAILIAN_REGION": "shell-region",
            "DASHSCOPE_BASE_URL": "https://shell-dashscope.invalid",
            "DASHSCOPE_WORKSPACE_ID": "shell-dashscope-workspace",
            "DASHSCOPE_REGION": "shell-dashscope-region",
            "CRAWSHRIMP_AI_VIDEO_CAPABILITY_SECRET": "provider-must-not-inherit-capability-secret",
            "CRAWSHRIMP_API_TOKEN": "provider-must-not-inherit-api-token",
            "OPENAI_API_KEY": "openai-secret",
            "ONE_XM_API_TOKEN": "one-xm-secret",
            "AWS_SECRET_ACCESS_KEY": "cloud-secret",
            "GITHUB_TOKEN": "github-secret",
            "CUSTOM_SECRET": "custom-secret",
            "NODE_OPTIONS": "--require=/tmp/steal-secrets.js",
            "HTTPS_PROXY": "http://user:password@proxy.invalid",
        }
        config = {
            "ai": {"video": {
                "seedance_base_url": "https://configured-seedance.invalid",
                "bailian_base_url": "https://configured-bailian.invalid",
                "bailian_workspace_id": "configured-workspace",
                "bailian_region": "cn-beijing",
            }},
        }
        with patch.dict(os.environ, {**allowed, **polluted}, clear=True), \
                patch.object(svc, "load_config", return_value=config), \
                patch.object(svc, "provider_secrets", return_value={
                    "seedance": "selected-seedance-key",
                    "happyhorse": "selected-happyhorse-key",
                }):
            for provider in ("seedance", "happyhorse"):
                env, _ = svc.provider_env(provider)
                for name, value in allowed.items():
                    self.assertEqual(env.get(name), value, f"{provider} lost allowlisted {name}")
                selected_names = {"ARK_BASE_URL"} if provider == "seedance" else {
                    "BAILIAN_BASE_URL",
                    "BAILIAN_WORKSPACE_ID",
                    "BAILIAN_REGION",
                }
                for name in polluted:
                    if name not in selected_names:
                        self.assertNotIn(name, env, f"{provider} inherited {name}")
                if provider == "seedance":
                    self.assertEqual(env.get("ARK_API_KEY"), "selected-seedance-key")
                    self.assertEqual(env.get("ARK_BASE_URL"), "https://configured-seedance.invalid")
                    self.assertNotIn("DASHSCOPE_API_KEY", env)
                    self.assertNotIn("BAILIAN_WORKSPACE_ID", env)
                else:
                    self.assertEqual(env.get("DASHSCOPE_API_KEY"), "selected-happyhorse-key")
                    self.assertEqual(env.get("BAILIAN_BASE_URL"), "https://configured-bailian.invalid")
                    self.assertEqual(env.get("BAILIAN_WORKSPACE_ID"), "configured-workspace")
                    self.assertNotIn("ARK_API_KEY", env)

    def test_provider_cli_error_redacts_every_injected_config_value(self):
        config = {
            "ai": {"video": {
                "seedance_base_url": "https://configured-seedance.invalid",
                "bailian_base_url": "https://configured-bailian.invalid",
                "bailian_workspace_id": "configured-workspace-id",
                "bailian_region": "configured-private-region",
            }},
        }
        provider_secrets = {
            "seedance": "configured-seedance-api-key",
            "happyhorse": "configured-happyhorse-api-key",
        }
        injected_names = {
            "seedance": ("ARK_API_KEY", "ARK_BASE_URL"),
            "happyhorse": (
                "DASHSCOPE_API_KEY",
                "BAILIAN_BASE_URL",
                "BAILIAN_WORKSPACE_ID",
                "BAILIAN_REGION",
            ),
        }

        def failed_subprocess(command, **kwargs):
            env = kwargs["env"]
            echoed = " provider-config=".join(
                env[name]
                for name in injected_names[current_provider]
            )
            return subprocess.CompletedProcess(command, 1, stdout="", stderr=echoed)

        with patch.object(svc, "load_config", return_value=config), \
                patch.object(svc, "provider_secrets", return_value=provider_secrets), \
                patch.object(svc.subprocess, "run", side_effect=failed_subprocess):
            for current_provider in ("seedance", "happyhorse"):
                with self.subTest(provider=current_provider):
                    with self.assertRaises(svc.AiVideoError) as captured:
                        svc._run_cli(
                            provider=current_provider,
                            args=["bin/provider.js", "get", "task-id"],
                            cwd=self.root,
                        )
                    public_error = json.dumps(
                        svc.envelope_error(captured.exception),
                        ensure_ascii=False,
                    )
                    for name in injected_names[current_provider]:
                        self.assertNotIn(
                            svc.provider_env(current_provider)[0][name],
                            public_error,
                            f"{current_provider} leaked {name}",
                        )
                    self.assertIn("[redacted]", public_error)

    def test_public_asset_token_can_be_reused_when_updating_a_draft(self):
        image = self._write_image("draft-reference.jpg")
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "draft-public-asset",
                "status": "needs_config",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "reuse the persisted reference image",
                "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                "outputDir": str(self.output_dir.resolve()),
            },
            assets=[{
                "localPath": str(image.resolve()),
                "originalName": image.name,
                "mimeType": "image/jpeg",
            }],
            run_payload={
                "requestUid": "draft-public-asset",
                "status": "needs_config",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "inputSnapshot": {},
            },
        )
        public = svc.public_job(data_sink.get_ai_video_job(created["job"]["id"]))

        with patch.object(svc, "provider_status", return_value=READY_PROVIDER_STATUS):
            updated = svc.update_job(created["job"]["id"], {"assets": public["assets"]})

        self.assertEqual(updated["data"]["job"]["assets"][0]["name"], image.name)

    def test_redact_text_hides_secrets_and_home(self):
        home = str(Path.home())
        text = f"Authorization: Bearer secret-token path={home}/Downloads/a.mp4 ARK_API_KEY=abc123"
        redacted = svc.redact_text(text, ["abc123", "secret-token"])
        self.assertNotIn("secret-token", redacted)
        self.assertNotIn("abc123", redacted)
        self.assertNotIn(home, redacted)
        self.assertIn("~", redacted)

    def test_redacted_provider_artifact_removes_embedded_data_urls(self):
        archive_dir = self.root / "archive"
        secret_data_url = "data:image/jpeg;base64,super-secret-image-bytes"
        svc._write_run_artifacts(
            archive_dir,
            normalized={"prompt": "test", "assets": [], "parameters": {}},
            provider_payload={"input": {"media": [{"type": "first_frame", "url": secret_data_url}]}},
            event="test",
        )
        artifact = (archive_dir / "request.provider.redacted.json").read_text(encoding="utf-8")
        self.assertNotIn(secret_data_url, artifact)
        self.assertNotIn("super-secret-image-bytes", artifact)
        self.assertIn("[redacted-data-url]", artifact)

    def test_run_artifact_write_rejects_archive_dir_swapped_to_symlink(self):
        output_root = self.root / "artifact-output"
        output_root.mkdir()
        archive_dir = output_root / "2026-07-16" / "job" / "run"
        prepared = svc._secure_prepare_archive_dir(output_root, archive_dir)
        outside = self.root / "artifact-outside"
        outside.mkdir()
        prepared.rmdir()
        prepared.symlink_to(outside, target_is_directory=True)

        with self.assertRaises(svc.AiVideoError) as captured:
            svc._write_run_artifacts(
                prepared,
                normalized={"prompt": "must stay inside", "assets": [], "parameters": {}},
                provider_payload={"prompt": "must stay inside"},
                event="submit_start",
            )

        self.assertEqual(captured.exception.code, "ARCHIVE_WRITE_FAILED")
        self.assertEqual(list(outside.iterdir()), [])

    def test_artifacts_skip_without_dirfd_support_and_never_follow_symlink(self):
        outside = self.root / "unsupported-artifact-outside"
        outside.mkdir()
        archive_link = self.root / "unsupported-artifact-link"
        archive_link.symlink_to(outside, target_is_directory=True)

        with patch.object(svc.os, "supports_dir_fd", set()), \
                patch.object(svc.logger, "warning") as warning:
            svc._write_run_artifacts(
                archive_link,
                normalized={"prompt": "do not write through link", "assets": [], "parameters": {}},
                provider_payload={"prompt": "do not write through link"},
                event="submit_start",
            )
            svc._write_archive_json(archive_link, "response.provider.redacted.json", {"ok": True})
            svc._append_archive_event(archive_link, {"event": "submitted"})

        self.assertEqual(list(outside.iterdir()), [])
        self.assertGreaterEqual(warning.call_count, 1)

    def test_submit_continues_when_secure_artifact_dirfd_is_unavailable(self):
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "unsupported-artifact-submit",
                "status": "queued",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "provider create must continue",
                "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                "outputDir": str(self.output_dir),
            },
            run_payload={
                "requestUid": "unsupported-artifact-submit",
                "status": "queued",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "inputSnapshot": {
                    "prompt": "provider create must continue",
                    "assets": [],
                    "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                },
            },
        )
        cli_calls = []

        def fake_cli(**kwargs):
            cli_calls.append(kwargs)
            return {"objects": [{"id": "task-without-artifacts", "status": "queued"}]}

        svc.set_cli_runner(fake_cli)
        with patch.object(svc.os, "supports_dir_fd", set()), \
                patch.object(svc, "provider_status", return_value=READY_PROVIDER_STATUS), \
                patch.object(svc.logger, "warning") as warning:
            svc._submit_run(created["run"])

        run = data_sink.get_ai_video_run(created["run"]["id"])
        self.assertEqual(len(cli_calls), 1)
        self.assertEqual(run["status"], "running")
        self.assertEqual(run["providerTaskId"], "task-without-artifacts")
        self.assertEqual(list(self.output_dir.rglob("request.normalized.json")), [])
        self.assertGreaterEqual(warning.call_count, 1)

    def test_validate_does_not_create_output_directory(self):
        output_dir = self.root / "not-created-by-validation" / "nested"
        with patch.object(svc, "provider_status", return_value=READY_PROVIDER_STATUS):
            normalized = svc.validate_input({
                "provider": "seedance",
                "model": "seedance-2.0",
                "prompt": "validate without filesystem mutation",
                "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                "assets": [],
                "outputDirToken": self._capability("directory", "output", output_dir),
            })
        self.assertFalse(output_dir.exists())
        self.assertEqual(Path(normalized["outputDir"]), output_dir.resolve())

    def test_public_validation_rejects_unsigned_paths(self):
        image = self._write_image("unsigned.jpg")
        with self.assertRaises(svc.AiVideoError) as unsigned_output:
            svc.validate_input({
                "provider": "seedance",
                "model": "seedance-2.0",
                "prompt": "unsigned output",
                "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                "assets": [],
                "outputDir": str(self.output_dir),
            })
        self.assertEqual(unsigned_output.exception.code, "PATH_CAPABILITY_REQUIRED")
        with self.assertRaises(svc.AiVideoError) as unsigned_input:
            svc.validate_input({
                "provider": "seedance",
                "model": "seedance-2.0",
                "prompt": "unsigned input",
                "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                "assets": [{"localPath": str(image)}],
                "outputDirToken": self._capability("directory", "output", self.output_dir),
            })
        self.assertEqual(unsigned_input.exception.code, "PATH_CAPABILITY_REQUIRED")

    def test_path_capability_rejects_tampering_wrong_kind_and_expiry(self):
        valid = self._capability("directory", "output", self.output_dir)
        tampered = valid[:-1] + ("A" if valid[-1] != "A" else "B")
        expired = self._capability(
            "directory",
            "output",
            self.output_dir,
            issued_at=int((time.time() - 25 * 60 * 60) * 1000),
        )
        wrong_kind = self._capability("file", "input", self.output_dir)
        for token in (tampered, expired, wrong_kind):
            with self.subTest(token=token[-12:]):
                with self.assertRaises(svc.AiVideoError):
                    svc.validate_input({
                        "provider": "seedance",
                        "model": "seedance-2.0",
                        "prompt": "invalid output capability",
                        "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                        "assets": [],
                        "outputDirToken": token,
                    })

    def test_input_capability_rejects_symlink_after_signing(self):
        image = self._write_image("real-image.jpg")
        symlink = self.root / "linked-image.jpg"
        symlink.symlink_to(image)
        with self.assertRaises(svc.AiVideoError) as captured:
            svc.validate_input({
                "provider": "seedance",
                "model": "seedance-2.0",
                "prompt": "signed symlink",
                "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                "assets": [{"fileToken": self._capability("file", "input", symlink, resolve_path=False)}],
                "outputDirToken": self._capability("directory", "output", self.output_dir),
            })
        self.assertEqual(captured.exception.code, "PATH_NOT_ALLOWED")

    def test_public_responses_replace_persisted_paths_with_capabilities(self):
        image = self._write_image("public-asset.jpg")
        video = self.output_dir / "output.mp4"
        poster = self.output_dir / "poster.jpg"
        video.write_bytes(b"video")
        poster.write_bytes(b"poster")
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "public-paths",
                "status": "completed",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "public paths",
                "outputDir": str(self.output_dir.resolve()),
            },
            assets=[{
                "localPath": str(image.resolve()),
                "originalName": image.name,
                "mimeType": "image/jpeg",
            }],
            run_payload={
                "requestUid": "public-paths",
                "status": "completed",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "inputSnapshot": {
                    "prompt": "public paths",
                    "parameters": {},
                    "assets": [{"localPath": str(image.resolve()), "originalName": image.name}],
                },
                "archiveStatus": "archived",
                "output": {
                    "localVideoPath": str(video.resolve()),
                    "localPosterPath": str(poster.resolve()),
                    "archiveDir": str(self.output_dir.resolve()),
                },
            },
        )
        job = svc.public_job(data_sink.get_ai_video_job(created["job"]["id"]))
        run = svc.public_run(data_sink.get_ai_video_run(created["run"]["id"]))
        serialized = json.dumps({"job": job, "run": run}, ensure_ascii=False)
        for raw_path in (self.output_dir.resolve(), image.resolve(), video.resolve(), poster.resolve()):
            self.assertNotIn(str(raw_path), serialized)
        self.assertIn("outputDirToken", job)
        self.assertEqual(job["outputDirName"], self.output_dir.name)
        self.assertIn("fileToken", job["assets"][0])
        self.assertEqual(job["assets"][0]["name"], image.name)
        self.assertIn("fileToken", run["inputSnapshot"]["assets"][0])
        self.assertIn("localVideoToken", run["output"])
        self.assertIn("localPosterToken", run["output"])
        self.assertEqual(run["output"]["videoFileName"], video.name)
        self.assertEqual(run["output"]["posterFileName"], poster.name)

    def test_request_uid_idempotent_create_and_mock_provider_flow(self):
        state = {"create_calls": 0, "get_calls": 0}

        def fake_cli(*, provider, args, cwd, timeout_seconds):
            command = args[1] if len(args) > 1 else ""
            if command == "create":
                state["create_calls"] += 1
                if provider == "seedance":
                    return {"objects": [{"id": "task_seed_1", "status": "queued"}], "stdout": "", "stderr": "", "returncode": 0}
                return {
                    "objects": [{"output": {"task_id": "task_hh_1", "task_status": "PENDING"}}],
                    "stdout": "",
                    "stderr": "",
                    "returncode": 0,
                }
            if command == "get":
                state["get_calls"] += 1
                if provider == "seedance":
                    return {
                        "objects": [{
                            "id": "task_seed_1",
                            "status": "succeeded",
                            "content": {"video_url": "https://cdn.example/video.mp4"},
                        }],
                        "stdout": "",
                        "stderr": "",
                        "returncode": 0,
                    }
                return {
                    "objects": [{
                        "output": {
                            "task_id": "task_hh_1",
                            "task_status": "SUCCEEDED",
                            "video_url": "https://cdn.example/video.mp4",
                        }
                    }],
                    "stdout": "",
                    "stderr": "",
                    "returncode": 0,
                }
            raise AssertionError(f"unexpected command {args}")

        def fake_download(*, url, target_path):
            path = Path(target_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"\x00\x00\x00\x18ftypmp42fake")
            return path

        svc.set_cli_runner(fake_cli)
        svc.set_downloader(fake_download)

        with patch.object(svc, "provider_status", return_value={
            "seedance": {"configured": True, "source": "test", "cliReady": True},
            "happyhorse": {"configured": True, "source": "test", "cliReady": True},
        }):
            first = svc.create_job({
                "requestUid": "req-idem-1",
                "provider": "seedance",
                "model": "seedance-2.0",
                "prompt": "mock seedance video",
                "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5, "generateAudio": True, "watermark": False},
                "assets": [],
                "outputDirToken": self._capability("directory", "output", self.output_dir),
            })
            second = svc.create_job({
                "requestUid": "req-idem-1",
                "provider": "seedance",
                "model": "seedance-2.0",
                "prompt": "mock seedance video",
                "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5, "generateAudio": True, "watermark": False},
                "assets": [],
                "outputDirToken": self._capability("directory", "output", self.output_dir),
            })
            self.assertTrue(second.get("reused"))
            self.assertEqual(first["data"]["job"]["id"], second["data"]["job"]["id"])

            run_id = first["data"]["run"]["id"]
            import time
            completed = None
            for _ in range(80):
                completed = data_sink.get_ai_video_run(run_id)
                if completed and completed.get("status") == "completed":
                    break
                if completed and completed.get("providerTaskId") and completed.get("status") in {"running", "downloading"}:
                    svc.process_run(run_id)
                time.sleep(0.05)
            self.assertEqual(state["create_calls"], 1)
            self.assertIsNotNone(completed)
            self.assertEqual(completed["providerTaskId"], "task_seed_1")
            self.assertEqual(completed["status"], "completed")
            self.assertEqual(completed["archiveStatus"], "archived")
            local = Path(completed["output"]["localVideoPath"])
            self.assertTrue(local.is_file())
            self.assertTrue(local.stat().st_size > 0)

    def test_duplicate_creates_persistent_draft_without_provider_calls(self):
        original = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "duplicate-source",
                "title": "source",
                "status": "completed",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "duplicate source prompt",
                "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                "outputDir": str(self.output_dir),
            },
            assets=[],
            run_payload={
                "requestUid": "duplicate-source",
                "status": "completed",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "inputSnapshot": {},
                "archiveStatus": "archived",
            },
        )
        cli_calls = []

        def fake_cli(*, provider, args, cwd, timeout_seconds):
            cli_calls.append((provider, list(args)))
            if args[1] == "create":
                return {"objects": [{"id": "unexpected-task", "status": "queued"}]}
            return {"objects": [{"id": "unexpected-task", "status": "failed"}]}

        svc.set_cli_runner(fake_cli)
        with patch.object(svc, "provider_status", return_value=READY_PROVIDER_STATUS), \
                patch.object(svc, "ensure_worker_started", return_value=None), \
                patch.object(svc.threading, "Thread", _ImmediateThread):
            duplicated = svc.duplicate_job(original["job"]["id"])

        job = data_sink.get_ai_video_job(duplicated["data"]["job"]["id"])
        self.assertEqual(job["status"], "draft")
        self.assertEqual(len(job["runs"]), 1)
        self.assertEqual(job["runs"][0]["status"], "draft")
        self.assertIsNone(job["runs"][0]["providerTaskId"])
        self.assertEqual(cli_calls, [])

    def test_raw_provider_payload_is_deleted_after_submit(self):
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "payload-cleanup",
                "status": "queued",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "payload cleanup",
                "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                "outputDir": str(self.output_dir),
            },
            assets=[],
            run_payload={
                "requestUid": "payload-cleanup",
                "status": "queued",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "inputSnapshot": {
                    "prompt": "payload cleanup",
                    "assets": [],
                    "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                },
            },
        )
        payload_paths = []

        def fake_cli(*, provider, args, cwd, timeout_seconds):
            payload_path = Path(args[-1])
            self.assertTrue(payload_path.is_file())
            payload_paths.append(payload_path)
            return {"objects": [{"id": "task-cleanup", "status": "queued"}]}

        svc.set_cli_runner(fake_cli)
        with patch.object(svc, "provider_status", return_value=READY_PROVIDER_STATUS):
            svc._submit_run(created["run"])
        self.assertEqual(len(payload_paths), 1)
        self.assertFalse(payload_paths[0].exists())

    def test_submit_rejects_reference_image_content_changed_after_snapshot(self):
        image = self._write_image("changed-after-snapshot.jpg")
        inspected = svc._inspect_image(image)
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "changed-reference-submit",
                "status": "queued",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "never submit changed reference bytes",
                "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                "outputDir": str(self.output_dir),
            },
            assets=[inspected],
            run_payload={
                "requestUid": "changed-reference-submit",
                "status": "queued",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "inputSnapshot": {
                    "prompt": "never submit changed reference bytes",
                    "assets": [inspected],
                    "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                },
            },
        )
        Image.new("RGB", (512, 512), color=(220, 30, 40)).save(image, format="JPEG")
        cli_calls = []
        svc.set_cli_runner(lambda **kwargs: cli_calls.append(kwargs) or {
            "objects": [{"id": "must-not-be-created", "status": "queued"}],
        })

        with patch.object(svc, "provider_status", return_value=READY_PROVIDER_STATUS):
            svc._submit_run(created["run"])

        run = data_sink.get_ai_video_run(created["run"]["id"])
        self.assertEqual(cli_calls, [])
        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["error"]["code"], "VALIDATION_FAILED")

    def test_submit_rejects_reference_image_replaced_by_symlink_before_cli(self):
        image = self._write_image("symlink-after-snapshot.jpg")
        inspected = svc._inspect_image(image)
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "symlink-reference-submit",
                "status": "queued",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "never follow replacement symlink",
                "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                "outputDir": str(self.output_dir),
            },
            assets=[inspected],
            run_payload={
                "requestUid": "symlink-reference-submit",
                "status": "queued",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "inputSnapshot": {
                    "prompt": "never follow replacement symlink",
                    "assets": [inspected],
                    "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                },
            },
        )
        unauthorized = self.root / "unauthorized-local-bytes"
        unauthorized.write_bytes(b"must never be included in a provider request")
        image.unlink()
        image.symlink_to(unauthorized)
        cli_calls = []
        svc.set_cli_runner(lambda **kwargs: cli_calls.append(kwargs) or {
            "objects": [{"id": "must-not-be-created", "status": "queued"}],
        })

        with patch.object(svc.os, "supports_dir_fd", set()), \
                patch.object(svc, "provider_status", return_value=READY_PROVIDER_STATUS):
            svc._submit_run(created["run"])

        run = data_sink.get_ai_video_run(created["run"]["id"])
        self.assertEqual(cli_calls, [])
        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["error"]["code"], "VALIDATION_FAILED")

    def test_create_timeout_is_unknown_submit_result(self):
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "submit-timeout",
                "status": "queued",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "unknown submit",
                "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                "outputDir": str(self.output_dir),
            },
            assets=[],
            run_payload={
                "requestUid": "submit-timeout",
                "status": "queued",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "inputSnapshot": {
                    "prompt": "unknown submit",
                    "assets": [],
                    "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                },
            },
        )

        def timeout_cli(**_kwargs):
            raise svc.AiVideoError("create timed out", code="PROVIDER_TIMEOUT", retryable=True)

        svc.set_cli_runner(timeout_cli)
        with patch.object(svc, "provider_status", return_value=READY_PROVIDER_STATUS):
            svc._submit_run(created["run"])
        run = data_sink.get_ai_video_run(created["run"]["id"])
        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["error"]["code"], "UNKNOWN_SUBMIT_RESULT")
        self.assertFalse(run["error"]["retryable"])

    def test_crash_after_provider_acceptance_is_not_resubmitted_during_recovery(self):
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "submit-crash-window",
                "status": "queued",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "never pay twice after restart",
                "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                "outputDir": str(self.output_dir),
            },
            assets=[],
            run_payload={
                "requestUid": "submit-crash-window",
                "status": "queued",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "inputSnapshot": {
                    "prompt": "never pay twice after restart",
                    "assets": [],
                    "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                },
            },
        )
        run_id = created["run"]["id"]
        cli_actions = []

        def accepted_provider_call(*, provider, args, cwd, timeout_seconds):
            cli_actions.append(args[1])
            if args[1] == "create":
                return {"objects": [{"id": "accepted-before-crash", "status": "queued"}]}
            return {"objects": [{"id": "accepted-before-crash", "status": "running"}]}

        real_update_run = data_sink.update_ai_video_run

        def crash_before_task_id_save(uid, payload=None):
            if (payload or {}).get("providerTaskId"):
                raise SystemExit("simulated process exit before task id commit")
            return real_update_run(uid, payload)

        svc.set_cli_runner(accepted_provider_call)
        with patch.object(svc, "provider_status", return_value=READY_PROVIDER_STATUS):
            with patch.object(data_sink, "update_ai_video_run", side_effect=crash_before_task_id_save):
                with self.assertRaises(SystemExit):
                    svc._submit_run(created["run"])

            crashed = data_sink.get_ai_video_run(run_id)
            self.assertEqual(crashed["status"], "queued")
            self.assertFalse(crashed.get("providerTaskId"))
            self.assertEqual(crashed["providerStatus"], "submitting")
            self.assertTrue(crashed.get("submittedAt"))

            svc.recover_active_runs(once=True)

        recovered = data_sink.get_ai_video_run(run_id)
        self.assertEqual(cli_actions, ["create"])
        self.assertEqual(recovered["status"], "failed")
        self.assertFalse(recovered.get("providerTaskId"))
        self.assertEqual(recovered["error"]["code"], "UNKNOWN_SUBMIT_RESULT")
        self.assertFalse(recovered["error"]["retryable"])

    def test_unknown_submit_result_blocks_full_retry(self):
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "unknown-retry-source",
                "status": "failed",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "do not retry blindly",
                "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                "outputDir": str(self.output_dir),
            },
            assets=[],
            run_payload={
                "requestUid": "unknown-retry-source",
                "status": "failed",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "inputSnapshot": {},
                "error": {"code": "UNKNOWN_SUBMIT_RESULT", "retryable": False},
            },
        )
        with self.assertRaises(svc.AiVideoError) as captured:
            svc.retry_job(created["job"]["id"], "blocked-retry")
        self.assertEqual(captured.exception.code, "UNKNOWN_SUBMIT_RESULT")
        self.assertEqual(len(data_sink.list_ai_video_runs(created["job"]["id"])), 1)

    def test_retry_needs_config_is_side_effect_free_until_provider_ready(self):
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "retry-needs-config-source",
                "status": "needs_config",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "retry only after provider is ready",
                "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                "outputDir": str(self.output_dir),
            },
            run_payload={
                "requestUid": "retry-needs-config-source",
                "status": "needs_config",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "inputSnapshot": {},
            },
        )
        job_id = created["job"]["id"]
        original_run_id = created["run"]["id"]
        not_ready = {
            "seedance": {"configured": False, "source": "未配置", "cliReady": True},
            "happyhorse": {"configured": False, "source": "未配置", "cliReady": True},
        }

        with patch.object(svc, "provider_status", return_value=not_ready):
            with self.assertRaises(svc.AiVideoError) as captured:
                svc.retry_job(job_id, "retry-still-needs-config")

        self.assertEqual(captured.exception.code, "NEEDS_CONFIG")
        unchanged_job = data_sink.get_ai_video_job(job_id)
        self.assertEqual(unchanged_job["status"], "needs_config")
        self.assertEqual(unchanged_job["currentRunId"], original_run_id)
        self.assertEqual(len(data_sink.list_ai_video_runs(job_id)), 1)
        self.assertIsNone(data_sink.get_ai_video_run_by_request_uid("retry-still-needs-config"))

        with patch.object(svc, "provider_status", return_value=READY_PROVIDER_STATUS), \
                patch.object(svc, "ensure_worker_started", return_value=None), \
                patch.object(svc.threading, "Thread") as thread_class:
            retried = svc.retry_job(job_id, "retry-now-ready")

        self.assertFalse(retried["reused"])
        self.assertEqual(retried["data"]["run"]["status"], "queued")
        ready_job = data_sink.get_ai_video_job(job_id)
        self.assertEqual(ready_job["status"], "queued")
        self.assertEqual(ready_job["currentRunId"], retried["data"]["run"]["id"])
        self.assertEqual(len(data_sink.list_ai_video_runs(job_id)), 2)
        thread_class.return_value.start.assert_called_once_with()

    def test_retry_request_uid_cannot_reuse_a_run_from_another_job(self):
        first = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "retry-owner-a",
                "status": "failed",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "owner A",
                "outputDir": str(self.output_dir),
            },
            run_payload={
                "requestUid": "retry-owner-a",
                "status": "failed",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "inputSnapshot": {},
            },
        )
        second = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "retry-owner-b",
                "status": "failed",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "owner B",
                "outputDir": str(self.output_dir),
            },
            run_payload={
                "requestUid": "retry-owner-b",
                "status": "failed",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "inputSnapshot": {},
            },
        )

        replay = svc.retry_job(first["job"]["id"], "retry-owner-a")
        self.assertTrue(replay["reused"])
        self.assertEqual(replay["data"]["job"]["id"], first["job"]["id"])
        self.assertEqual(replay["data"]["run"]["id"], first["run"]["id"])

        with self.assertRaises(svc.AiVideoError) as captured:
            svc.retry_job(second["job"]["id"], "retry-owner-a")

        self.assertEqual(captured.exception.code, "REQUEST_UID_CONFLICT")
        self.assertEqual(captured.exception.http_status, 409)
        self.assertEqual(len(data_sink.list_ai_video_runs(first["job"]["id"])), 1)
        self.assertEqual(len(data_sink.list_ai_video_runs(second["job"]["id"])), 1)

    def test_create_request_uid_cannot_reuse_a_retry_run_from_another_job(self):
        original = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "create-run-collision-source",
                "status": "failed",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "existing seedance job",
                "outputDir": str(self.output_dir),
            },
            run_payload={
                "requestUid": "create-run-collision-source",
                "status": "failed",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "inputSnapshot": {},
            },
        )
        data_sink.create_ai_video_run({
            "requestUid": "create-run-only-collision",
            "jobId": original["job"]["id"],
            "status": "failed",
            "provider": "seedance",
            "model": svc.SEEDANCE_MODEL,
            "inputSnapshot": {},
        })
        before_jobs = data_sink.list_ai_video_jobs(include_deleted=True)
        before_runs = data_sink.list_ai_video_runs()
        before_assets = data_sink.list_ai_video_assets()

        with patch.object(svc, "provider_status", return_value=READY_PROVIDER_STATUS), \
                patch.object(svc, "ensure_worker_started") as ensure_worker, \
                patch.object(svc.threading, "Thread") as worker_thread:
            with self.assertRaises(svc.AiVideoError) as captured:
                svc.create_job({
                    "requestUid": "create-run-only-collision",
                    "provider": "happyhorse",
                    "model": "happyhorse-1.1-t2v",
                    "prompt": "must not return the unrelated seedance job",
                    "parameters": {
                        "ratio": "16:9",
                        "resolution": "720P",
                        "duration": 5,
                        "watermark": False,
                    },
                    "assets": [],
                    "outputDirToken": self._capability("directory", "output", self.output_dir),
                })

        self.assertEqual(captured.exception.code, "REQUEST_UID_CONFLICT")
        self.assertEqual(captured.exception.http_status, 409)
        ensure_worker.assert_not_called()
        worker_thread.assert_not_called()
        self.assertEqual(data_sink.list_ai_video_jobs(include_deleted=True), before_jobs)
        self.assertEqual(data_sink.list_ai_video_runs(), before_runs)
        self.assertEqual(data_sink.list_ai_video_assets(), before_assets)

    def test_retryable_get_error_keeps_remote_run_recoverable(self):
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "transient-get",
                "status": "running",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "still running remotely",
                "outputDir": str(self.output_dir),
            },
            assets=[],
            run_payload={
                "requestUid": "transient-get",
                "status": "running",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "providerTaskId": "remote-task-still-running",
                "inputSnapshot": {},
            },
        )

        def transient_get(**_kwargs):
            raise svc.AiVideoError("temporary timeout", code="PROVIDER_TIMEOUT", retryable=True)

        svc.set_cli_runner(transient_get)
        svc._poll_until_terminal_or_once(created["run"]["id"], once=True)
        run = data_sink.get_ai_video_run(created["run"]["id"])
        self.assertEqual(run["status"], "running")
        self.assertEqual(run["providerTaskId"], "remote-task-still-running")
        self.assertEqual(run["error"]["code"], "PROVIDER_TIMEOUT")

    def test_recent_happyhorse_unknown_can_recover_to_running_then_succeeded(self):
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "happyhorse-unknown-recovers",
                "status": "running",
                "provider": "happyhorse",
                "model": "happyhorse-1.1-t2v",
                "prompt": "provider status is temporarily unknown",
                "outputDir": str(self.output_dir),
            },
            assets=[],
            run_payload={
                "requestUid": "happyhorse-unknown-recovers",
                "status": "running",
                "provider": "happyhorse",
                "model": "happyhorse-1.1-t2v",
                "providerTaskId": "happyhorse-unknown-task",
                "submittedAt": svc._now_iso(),
                "inputSnapshot": {},
            },
        )
        snapshots = iter((
            {"output": {"task_id": "happyhorse-unknown-task", "task_status": "UNKNOWN"}},
            {"output": {"task_id": "happyhorse-unknown-task", "task_status": "RUNNING"}},
            {"output": {
                "task_id": "happyhorse-unknown-task",
                "task_status": "SUCCEEDED",
                "video_url": "https://provider.invalid/video.mp4?signature=temporary",
            }},
        ))

        def fake_cli(**_kwargs):
            return {"objects": [next(snapshots)]}

        svc.set_cli_runner(fake_cli)
        run_id = created["run"]["id"]
        svc._poll_until_terminal_or_once(run_id, once=True)
        first = data_sink.get_ai_video_run(run_id)
        self.assertEqual(first["status"], "running")
        self.assertEqual(first["providerStatus"], "UNKNOWN")

        svc._poll_until_terminal_or_once(run_id, once=True)
        second = data_sink.get_ai_video_run(run_id)
        self.assertEqual(second["status"], "running")
        self.assertEqual(second["providerStatus"], "RUNNING")

        svc._poll_until_terminal_or_once(run_id, once=True)
        succeeded = data_sink.get_ai_video_run(run_id)
        self.assertEqual(succeeded["status"], "downloading")
        self.assertEqual(succeeded["providerStatus"], "SUCCEEDED")

    def test_once_recovery_expires_a_run_using_its_persisted_submission_time(self):
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "persisted-poll-window",
                "status": "running",
                "provider": "happyhorse",
                "model": "happyhorse-1.1-t2v",
                "prompt": "old provider task",
                "outputDir": str(self.output_dir),
            },
            assets=[],
            run_payload={
                "requestUid": "persisted-poll-window",
                "status": "running",
                "provider": "happyhorse",
                "model": "happyhorse-1.1-t2v",
                "providerTaskId": "old-happyhorse-task",
                "providerStatus": "RUNNING",
                "submittedAt": "2000-01-01T00:00:00",
                "inputSnapshot": {},
            },
        )
        svc.set_cli_runner(lambda **_kwargs: {
            "objects": [{"output": {
                "task_id": "old-happyhorse-task",
                "task_status": "RUNNING",
            }}],
        })

        svc._poll_until_terminal_or_once(created["run"]["id"], once=True)

        recovered = data_sink.get_ai_video_run(created["run"]["id"])
        self.assertEqual(recovered["status"], "expired")
        self.assertEqual(recovered["error"]["code"], "PROVIDER_TIMEOUT")

    def test_recovery_is_single_flight_per_run(self):
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "single-flight",
                "status": "running",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "single flight",
                "outputDir": str(self.output_dir),
            },
            assets=[],
            run_payload={
                "requestUid": "single-flight",
                "status": "running",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "providerTaskId": "single-flight-task",
                "inputSnapshot": {},
            },
        )
        first_get_started = threading.Event()
        overlap_gate = threading.Barrier(2)
        state = {"calls": 0, "active": 0, "maxActive": 0}
        state_lock = threading.Lock()

        def fake_cli(**_kwargs):
            with state_lock:
                state["calls"] += 1
                call_number = state["calls"]
                state["active"] += 1
                state["maxActive"] = max(state["maxActive"], state["active"])
            first_get_started.set()
            if call_number <= 2:
                try:
                    overlap_gate.wait(timeout=0.5)
                except threading.BrokenBarrierError:
                    pass
                snapshot = {"id": "single-flight-task", "status": "running"}
            else:
                snapshot = {"id": "single-flight-task", "status": "failed"}
            with state_lock:
                state["active"] -= 1
            return {"objects": [snapshot]}

        svc.set_cli_runner(fake_cli)
        with patch.object(svc, "POLL_INTERVAL_SECONDS", 0):
            primary = threading.Thread(target=svc.process_run, args=(created["run"]["id"],))
            primary.start()
            self.assertTrue(first_get_started.wait(timeout=2))
            svc.recover_active_runs(once=True)
            primary.join(timeout=3)
        self.assertFalse(primary.is_alive())
        self.assertEqual(state["maxActive"], 1)

    def test_recovery_schedules_other_runs_with_bounded_concurrency(self):
        for index in range(5):
            request_uid = f"bounded-recovery-{index}"
            data_sink.create_ai_video_job_with_run(
                job_payload={
                    "requestUid": request_uid,
                    "status": "running",
                    "provider": "seedance",
                    "model": svc.SEEDANCE_MODEL,
                    "prompt": f"bounded recovery {index}",
                    "outputDir": str(self.output_dir),
                },
                assets=[],
                run_payload={
                    "requestUid": request_uid,
                    "status": "running",
                    "provider": "seedance",
                    "model": svc.SEEDANCE_MODEL,
                    "providerTaskId": f"bounded-recovery-task-{index}",
                    "submittedAt": svc._now_iso(),
                    "inputSnapshot": {},
                },
            )

        release = threading.Event()
        four_started = threading.Event()
        state = {"active": 0, "maxActive": 0}
        state_lock = threading.Lock()

        def blocked_get(*, args, **_kwargs):
            task_id = args[-1]
            with state_lock:
                state["active"] += 1
                state["maxActive"] = max(state["maxActive"], state["active"])
                if state["active"] == 4:
                    four_started.set()
            release.wait(timeout=3)
            with state_lock:
                state["active"] -= 1
            return {"objects": [{"id": task_id, "status": "running"}]}

        svc.set_cli_runner(blocked_get)
        recovery = threading.Thread(
            target=svc.recover_active_runs,
            kwargs={"once": True},
        )
        recovery.start()
        try:
            reached_bound = four_started.wait(timeout=1)
        finally:
            release.set()
            recovery.join(timeout=4)

        self.assertTrue(reached_bound, "a blocked first Run prevented later Runs from being scheduled")
        self.assertFalse(recovery.is_alive())
        self.assertEqual(state["maxActive"], 4)

    def test_succeeded_without_video_url_does_not_recurse(self):
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "success-no-url",
                "status": "running",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "eventually consistent url",
                "outputDir": str(self.output_dir),
            },
            assets=[],
            run_payload={
                "requestUid": "success-no-url",
                "status": "running",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "providerTaskId": "success-no-url-task",
                "inputSnapshot": {},
            },
        )
        calls = 0

        def succeeded_without_url(**_kwargs):
            nonlocal calls
            calls += 1
            return {"objects": [{"id": "success-no-url-task", "status": "succeeded", "content": {}}]}

        svc.set_cli_runner(succeeded_without_url)
        old_limit = sys.getrecursionlimit()
        sys.setrecursionlimit(120)
        try:
            svc.process_run(created["run"]["id"])
        finally:
            sys.setrecursionlimit(old_limit)
        run = data_sink.get_ai_video_run(created["run"]["id"])
        self.assertLessEqual(calls, 2)
        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["archiveStatus"], "archive_failed")

    def test_archive_rejects_output_root_replaced_by_symlink(self):
        selected = self.root / "selected-output"
        selected.mkdir()
        outside = self.root / "outside-output"
        outside.mkdir()
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "archive-symlink",
                "status": "downloading",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "do not escape output root",
                "outputDir": str(selected.resolve()),
            },
            assets=[],
            run_payload={
                "requestUid": "archive-symlink",
                "status": "downloading",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "providerTaskId": "archive-symlink-task",
                "providerStatus": "succeeded",
                "archiveStatus": "pending_archive",
                "output": {"providerVideoUrl": "https://example.invalid/output.mp4"},
                "inputSnapshot": {},
            },
        )
        selected.rmdir()
        selected.symlink_to(outside, target_is_directory=True)
        download_calls = []

        def fake_download(*, url, target_path):
            download_calls.append((url, target_path))
            path = Path(target_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"unexpected")
            return path

        svc.set_downloader(fake_download)
        svc._archive_run(created["run"]["id"])
        run = data_sink.get_ai_video_run(created["run"]["id"])
        self.assertEqual(download_calls, [])
        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["archiveStatus"], "archive_failed")
        self.assertEqual(run["error"]["code"], "ARCHIVE_WRITE_FAILED")

    def test_retry_archive_rejects_running_run_without_changing_pollability(self):
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "retry-archive-running",
                "status": "running",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "remote task is still running",
                "outputDir": str(self.output_dir),
            },
            run_payload={
                "requestUid": "retry-archive-running",
                "status": "running",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "providerTaskId": "remote-task-still-running",
                "providerStatus": "running",
                "archiveStatus": "none",
                "inputSnapshot": {},
            },
        )
        cli_calls = []

        def running_cli(**kwargs):
            cli_calls.append(kwargs)
            return {"objects": [{"id": "remote-task-still-running", "status": "running"}]}

        svc.set_cli_runner(running_cli)
        with patch.object(svc, "ensure_worker_started", return_value=None):
            with self.assertRaises(svc.AiVideoError) as captured:
                svc.retry_archive(created["run"]["id"])

        self.assertEqual(captured.exception.http_status, 409)
        self.assertEqual(cli_calls, [])
        unchanged = data_sink.get_ai_video_run(created["run"]["id"])
        self.assertEqual(unchanged["status"], "running")
        self.assertEqual(unchanged["providerStatus"], "running")
        self.assertEqual(unchanged["archiveStatus"], "none")

        svc.process_run(created["run"]["id"], once=True)
        self.assertEqual(len(cli_calls), 1)
        polled = data_sink.get_ai_video_run(created["run"]["id"])
        self.assertEqual(polled["status"], "running")
        self.assertEqual(polled["providerStatus"], "running")

    def test_retry_archive_returns_before_blocking_download_and_single_flights(self):
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "retry-archive-async",
                "status": "failed",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "retry archive asynchronously",
                "outputDir": str(self.output_dir),
            },
            run_payload={
                "requestUid": "retry-archive-async",
                "status": "failed",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "providerTaskId": "retry-archive-async-task",
                "providerStatus": "succeeded",
                "archiveStatus": "archive_failed",
                "output": {"providerVideoUrl": "https://example.invalid/output.mp4"},
                "inputSnapshot": {"parameters": {"duration": 5}},
            },
        )
        download_started = threading.Event()
        allow_download_finish = threading.Event()
        download_finished = threading.Event()
        download_calls = []

        def blocking_download(*, url, target_path):
            download_calls.append((url, target_path))
            download_started.set()
            allow_download_finish.wait(timeout=3)
            path = Path(target_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"fake mp4")
            download_finished.set()
            return path

        svc.set_downloader(blocking_download)
        with patch.object(svc, "ensure_worker_started", return_value=None):
            first = svc.retry_archive(created["run"]["id"])
            second = svc.retry_archive(created["run"]["id"])

        self.assertFalse(download_finished.is_set())
        self.assertEqual(first["data"]["run"]["status"], "downloading")
        self.assertEqual(first["data"]["run"]["archiveStatus"], "pending_archive")
        self.assertEqual(second["data"]["run"]["status"], "downloading")
        self.assertEqual(second["data"]["run"]["archiveStatus"], "pending_archive")
        self.assertTrue(download_started.wait(timeout=1))
        self.assertEqual(len(download_calls), 1)

        allow_download_finish.set()
        deadline = time.time() + 3
        while time.time() < deadline:
            run = data_sink.get_ai_video_run(created["run"]["id"])
            if run and run.get("status") == "completed":
                break
            time.sleep(0.02)
        run = data_sink.get_ai_video_run(created["run"]["id"])
        self.assertEqual(len(download_calls), 1)
        self.assertEqual(run["status"], "completed")
        self.assertEqual(run["archiveStatus"], "archived")

    def test_download_rejects_part_file_symlink_before_network_access(self):
        target = self.output_dir / "output.mp4"
        outside = self.root / "outside-part-target"
        outside.write_bytes(b"do-not-overwrite")
        target.with_suffix(".mp4.part").symlink_to(outside)

        with patch.object(svc.shutil, "which", return_value=None), \
                patch.object(svc.urllib.request, "urlopen") as urlopen:
            with self.assertRaises(svc.AiVideoError) as captured:
                svc._download_file("https://example.invalid/output.mp4", target)

        urlopen.assert_not_called()
        self.assertEqual(captured.exception.code, "ARCHIVE_WRITE_FAILED")
        self.assertEqual(outside.read_bytes(), b"do-not-overwrite")

    def test_download_rejects_parent_replaced_by_symlink_before_network_access(self):
        archive_dir = self.output_dir / "archive"
        archive_dir.mkdir()
        outside = self.root / "outside-download-dir"
        outside.mkdir()
        archive_dir.rmdir()
        archive_dir.symlink_to(outside, target_is_directory=True)
        target = archive_dir / "output.mp4"

        with patch.object(svc.shutil, "which", return_value=None), \
                patch.object(svc.urllib.request, "urlopen") as urlopen:
            with self.assertRaises(svc.AiVideoError) as captured:
                svc._download_file("https://example.invalid/output.mp4", target)

        urlopen.assert_not_called()
        self.assertEqual(captured.exception.code, "ARCHIVE_WRITE_FAILED")
        self.assertFalse((outside / "output.mp4").exists())

    def test_concurrent_create_request_uid_returns_same_job(self):
        start_gate = threading.Barrier(2)
        lookup_gate = threading.Barrier(2)
        run_lookup_gate = threading.Barrier(2)
        results = []

        def missing_job(_request_uid):
            lookup_gate.wait(timeout=3)
            return None

        def missing_run(_request_uid):
            run_lookup_gate.wait(timeout=3)
            return None

        def create(label):
            start_gate.wait(timeout=3)
            try:
                result = data_sink.create_ai_video_job_with_run(
                    job_payload={
                        "requestUid": "concurrent-create",
                        "title": label,
                        "status": "needs_config",
                        "provider": "seedance",
                        "model": svc.SEEDANCE_MODEL,
                    },
                    run_payload={
                        "requestUid": "concurrent-create",
                        "status": "needs_config",
                        "provider": "seedance",
                        "model": svc.SEEDANCE_MODEL,
                    },
                )
                results.append(("ok", result["job"]["id"], result["run"]["id"]))
            except Exception as exc:
                results.append(("error", type(exc).__name__, str(exc)))

        with patch.object(data_sink, "get_ai_video_job_by_request_uid", side_effect=missing_job), \
                patch.object(data_sink, "get_ai_video_run_by_request_uid", side_effect=missing_run):
            threads = [threading.Thread(target=create, args=(label,)) for label in ("A", "B")]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=5)
        self.assertEqual(len(results), 2)
        self.assertTrue(all(item[0] == "ok" for item in results), results)
        self.assertEqual(len({item[1] for item in results}), 1)
        self.assertEqual(len({item[2] for item in results}), 1)
        self.assertEqual(len(data_sink.list_ai_video_jobs(include_deleted=True)), 1)
        self.assertEqual(len(data_sink.list_ai_video_runs()), 1)

    def test_concurrent_retry_request_uid_returns_same_run(self):
        original = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "retry-source",
                "status": "failed",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
            },
            run_payload={
                "requestUid": "retry-source",
                "status": "failed",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
            },
        )
        start_gate = threading.Barrier(2)
        lookup_gate = threading.Barrier(2)
        results = []

        def missing_run(_request_uid):
            lookup_gate.wait(timeout=3)
            return None

        def retry():
            start_gate.wait(timeout=3)
            try:
                run = data_sink.create_ai_video_run({
                    "requestUid": "concurrent-retry",
                    "jobId": original["job"]["id"],
                    "status": "needs_config",
                    "provider": "seedance",
                    "model": svc.SEEDANCE_MODEL,
                })
                results.append(("ok", run["id"], run.get("_reused")))
            except Exception as exc:
                results.append(("error", type(exc).__name__, str(exc)))

        with patch.object(data_sink, "get_ai_video_run_by_request_uid", side_effect=missing_run):
            threads = [threading.Thread(target=retry) for _ in range(2)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=5)
        self.assertEqual(len(results), 2)
        self.assertTrue(all(item[0] == "ok" for item in results), results)
        self.assertEqual(len({item[1] for item in results}), 1)
        self.assertEqual(sorted(item[2] for item in results), [False, True])
        self.assertEqual(len(data_sink.list_ai_video_runs(original["job"]["id"])), 2)

    def test_concurrent_distinct_retry_request_uids_only_create_one_run(self):
        original = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "distinct-retry-source",
                "status": "failed",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "only one paid retry",
                "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                "outputDir": str(self.output_dir),
            },
            run_payload={
                "requestUid": "distinct-retry-source",
                "status": "failed",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "inputSnapshot": {},
            },
        )
        job_id = original["job"]["id"]
        original_run_id = original["run"]["id"]
        real_get_job = data_sink.get_ai_video_job
        lookup_gate = threading.Barrier(2)
        first_lookup_threads = set()
        first_lookup_guard = threading.Lock()
        outcomes = []
        scheduled = []

        def overlap_first_job_lookup(uid):
            job = real_get_job(uid)
            ident = threading.get_ident()
            wait_for_peer = False
            if uid == job_id:
                with first_lookup_guard:
                    if ident not in first_lookup_threads:
                        first_lookup_threads.add(ident)
                        wait_for_peer = True
            if wait_for_peer:
                lookup_gate.wait(timeout=3)
            return job

        def retry(request_uid):
            try:
                outcomes.append(("ok", svc.retry_job(job_id, request_uid)))
            except Exception as exc:
                outcomes.append(("error", exc))

        class _RecordedThread:
            def __init__(self, *, target=None, args=(), **_kwargs):
                self.target = target
                self.args = args

            def start(self):
                scheduled.append(self.args[0])

        callers = [
            threading.Thread(target=retry, args=(request_uid,))
            for request_uid in ("distinct-retry-a", "distinct-retry-b")
        ]
        with patch.object(data_sink, "get_ai_video_job", side_effect=overlap_first_job_lookup), \
                patch.object(svc, "provider_status", return_value=READY_PROVIDER_STATUS), \
                patch.object(svc, "ensure_worker_started", return_value=None), \
                patch.object(svc.threading, "Thread", _RecordedThread):
            for caller in callers:
                caller.start()
            for caller in callers:
                caller.join(timeout=5)

        self.assertTrue(all(not caller.is_alive() for caller in callers))
        successes = [item for item in outcomes if item[0] == "ok"]
        conflicts = [item for item in outcomes if item[0] == "error"]
        self.assertEqual(len(successes), 1, outcomes)
        self.assertEqual(len(conflicts), 1, outcomes)
        self.assertIsInstance(conflicts[0][1], svc.AiVideoError)
        self.assertEqual(conflicts[0][1].code, "RETRY_CONFLICT")
        self.assertEqual(conflicts[0][1].http_status, 409)

        runs = data_sink.list_ai_video_runs(job_id)
        self.assertEqual(len(runs), 2)
        retry_runs = [run for run in runs if run["id"] != original_run_id]
        self.assertEqual(len(retry_runs), 1)
        self.assertEqual(scheduled, [retry_runs[0]["id"]])
        job = real_get_job(job_id)
        self.assertEqual(job["status"], "queued")
        self.assertEqual(job["currentRunId"], retry_runs[0]["id"])

    def test_concurrent_retry_request_uid_conflict_never_mutates_loser_job(self):
        image_a = self._write_image("retry-race-a.jpg")
        image_b = self._write_image("retry-race-b.jpg")

        def create_failed_job(request_uid, prompt, image):
            return data_sink.create_ai_video_job_with_run(
                job_payload={
                    "requestUid": request_uid,
                    "status": "failed",
                    "provider": "seedance",
                    "model": svc.SEEDANCE_MODEL,
                    "prompt": prompt,
                    "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                    "outputDir": str(self.output_dir),
                },
                assets=[{
                    "localPath": str(image),
                    "originalName": image.name,
                    "mimeType": "image/jpeg",
                }],
                run_payload={
                    "requestUid": request_uid,
                    "status": "failed",
                    "provider": "seedance",
                    "model": svc.SEEDANCE_MODEL,
                    "inputSnapshot": {},
                },
            )

        first = create_failed_job("retry-race-source-a", "owner A retry", image_a)
        second = create_failed_job("retry-race-source-b", "owner B retry", image_b)
        initial = {}
        for created in (first, second):
            job_id = created["job"]["id"]
            job = data_sink.get_ai_video_job(job_id)
            initial[job_id] = {
                "status": job["status"],
                "currentRunId": job["currentRunId"],
                "assets": data_sink.list_ai_video_assets(job_id),
            }

        start_gate = threading.Barrier(2)
        lookup_gate = threading.Barrier(2)
        outcomes = []
        scheduled = []

        def missing_run(_request_uid):
            lookup_gate.wait(timeout=3)
            return None

        def retry(job_id):
            start_gate.wait(timeout=3)
            try:
                outcomes.append(("ok", job_id, svc.retry_job(job_id, "shared-concurrent-retry")))
            except Exception as exc:
                outcomes.append(("error", job_id, exc))

        class _RecordedThread:
            def __init__(self, *, target=None, args=(), **_kwargs):
                self.target = target
                self.args = args

            def start(self):
                scheduled.append(self.args[0])

        callers = [
            threading.Thread(target=retry, args=(created["job"]["id"],))
            for created in (first, second)
        ]
        with patch.object(data_sink, "get_ai_video_run_by_request_uid", side_effect=missing_run), \
                patch.object(svc, "provider_status", return_value=READY_PROVIDER_STATUS), \
                patch.object(svc, "ensure_worker_started", return_value=None), \
                patch.object(svc.threading, "Thread", _RecordedThread):
            for caller in callers:
                caller.start()
            for caller in callers:
                caller.join(timeout=5)

        self.assertTrue(all(not caller.is_alive() for caller in callers))
        self.assertEqual(len(outcomes), 2)
        successes = [item for item in outcomes if item[0] == "ok"]
        conflicts = [item for item in outcomes if item[0] == "error"]
        self.assertEqual(len(successes), 1, outcomes)
        self.assertEqual(len(conflicts), 1, outcomes)
        self.assertIsInstance(conflicts[0][2], svc.AiVideoError)
        self.assertEqual(conflicts[0][2].code, "REQUEST_UID_CONFLICT")
        self.assertEqual(conflicts[0][2].http_status, 409)

        shared_run = data_sink.get_ai_video_run_by_request_uid("shared-concurrent-retry")
        owner_job_id = shared_run["jobId"]
        loser_job_id = conflicts[0][1]
        self.assertEqual(successes[0][1], owner_job_id)
        self.assertNotEqual(loser_job_id, owner_job_id)
        self.assertEqual(scheduled, [shared_run["id"]])

        owner = data_sink.get_ai_video_job(owner_job_id)
        loser = data_sink.get_ai_video_job(loser_job_id)
        self.assertEqual(owner["status"], "queued")
        self.assertEqual(owner["currentRunId"], shared_run["id"])
        self.assertEqual(len(data_sink.list_ai_video_runs(owner_job_id)), 2)
        self.assertEqual(loser["status"], initial[loser_job_id]["status"])
        self.assertEqual(loser["currentRunId"], initial[loser_job_id]["currentRunId"])
        self.assertEqual(data_sink.list_ai_video_assets(loser_job_id), initial[loser_job_id]["assets"])
        self.assertEqual(len(data_sink.list_ai_video_runs(loser_job_id)), 1)

    def test_unknown_submit_result_does_not_auto_retry(self):
        def fake_cli(*, provider, args, cwd, timeout_seconds):
            return {"objects": [{"status": "queued"}], "stdout": "{}", "stderr": "", "returncode": 0}

        svc.set_cli_runner(fake_cli)
        with patch.object(svc, "provider_status", return_value={
            "seedance": {"configured": True, "source": "test", "cliReady": True},
            "happyhorse": {"configured": True, "source": "test", "cliReady": True},
        }):
            created = svc.create_job({
                "requestUid": "req-unknown-1",
                "provider": "seedance",
                "model": "seedance-2.0",
                "prompt": "unknown submit",
                "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5},
                "assets": [],
                "outputDirToken": self._capability("directory", "output", self.output_dir),
            })
            run_id = created["data"]["run"]["id"]
            import time
            for _ in range(40):
                run = data_sink.get_ai_video_run(run_id)
                if run and run.get("status") == "failed":
                    break
                time.sleep(0.05)
            run = data_sink.get_ai_video_run(run_id)
            self.assertEqual(run["status"], "failed")
            self.assertEqual(run["error"]["code"], "UNKNOWN_SUBMIT_RESULT")
            self.assertFalse(run.get("providerTaskId"))

    def test_delete_blocks_active_and_soft_deletes_completed(self):
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "req-del-1",
                "title": "del",
                "status": "running",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "x",
                "parameters": {"duration": 5, "resolution": "720p", "watermark": False},
                "outputDir": str(self.output_dir),
            },
            assets=[],
            run_payload={
                "requestUid": "req-del-1",
                "status": "running",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "inputSnapshot": {},
                "providerTaskId": "task-1",
            },
        )
        with self.assertRaises(svc.AiVideoError):
            svc.delete_job(created["job"]["id"])

        data_sink.update_ai_video_run(created["run"]["id"], {"status": "completed"})
        result = svc.delete_job(created["job"]["id"])
        self.assertTrue(result["ok"])
        job = data_sink.get_ai_video_job(created["job"]["id"])
        self.assertTrue(job.get("deletedAt"))

    def test_delete_cancels_queued_run_before_provider_submission(self):
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "req-cancel-queued",
                "status": "queued",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "cancel before submit",
                "outputDir": str(self.output_dir),
            },
            run_payload={
                "requestUid": "req-cancel-queued",
                "status": "queued",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "inputSnapshot": {},
            },
        )

        result = svc.delete_job(created["job"]["id"])

        self.assertEqual(result, {
            "ok": True,
            "data": {"id": created["job"]["id"], "status": "cancelled"},
        })
        job = data_sink.get_ai_video_job(created["job"]["id"])
        run = data_sink.get_ai_video_run(created["run"]["id"])
        self.assertEqual(job["status"], "cancelled")
        self.assertIsNone(job.get("deletedAt"))
        self.assertEqual(run["status"], "cancelled")
        self.assertIsNone(run.get("providerTaskId"))

    def test_delete_rejects_queued_run_with_submission_attempt_marker(self):
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "req-cancel-submission-marker",
                "status": "queued",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "remote acceptance may have happened",
                "outputDir": str(self.output_dir),
            },
            run_payload={
                "requestUid": "req-cancel-submission-marker",
                "status": "queued",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "inputSnapshot": {},
            },
        )
        run_id = created["run"]["id"]
        data_sink.update_ai_video_run(run_id, {
            "status": "queued",
            "providerStatus": "submitting",
            "submittedAt": "2026-07-16T21:00:00",
        })
        cli_calls = []
        svc.set_cli_runner(lambda **kwargs: cli_calls.append(kwargs))

        with self.assertRaises(svc.AiVideoError) as captured:
            svc.delete_job(created["job"]["id"])

        self.assertEqual(captured.exception.http_status, 409)
        job = data_sink.get_ai_video_job(created["job"]["id"])
        run = data_sink.get_ai_video_run(run_id)
        self.assertEqual(job["status"], "queued")
        self.assertIsNone(job.get("deletedAt"))
        self.assertEqual(run["status"], "queued")
        self.assertEqual(run["providerStatus"], "submitting")
        self.assertTrue(run.get("submittedAt"))

        svc.process_run(run_id)

        recovered = data_sink.get_ai_video_run(run_id)
        self.assertEqual(cli_calls, [])
        self.assertEqual(recovered["status"], "failed")
        self.assertEqual(recovered["error"]["code"], "UNKNOWN_SUBMIT_RESULT")

    def test_delete_waits_for_submit_lock_and_rejects_saved_provider_task(self):
        created = data_sink.create_ai_video_job_with_run(
            job_payload={
                "requestUid": "req-cancel-submit-race",
                "status": "queued",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "prompt": "do not fake cancel",
                "outputDir": str(self.output_dir),
            },
            run_payload={
                "requestUid": "req-cancel-submit-race",
                "status": "queued",
                "provider": "seedance",
                "model": svc.SEEDANCE_MODEL,
                "inputSnapshot": {},
            },
        )
        run_id = created["run"]["id"]
        submit_started = threading.Event()
        allow_task_save = threading.Event()
        delete_started = threading.Event()
        outcome = []

        def submitting_worker():
            with svc._run_lock(run_id):
                submit_started.set()
                allow_task_save.wait(timeout=3)
                data_sink.update_ai_video_run(run_id, {
                    "status": "running",
                    "providerTaskId": "remote-task-won-race",
                    "providerStatus": "queued",
                })

        def delete_while_submitting():
            delete_started.set()
            try:
                outcome.append(("ok", svc.delete_job(created["job"]["id"])))
            except Exception as exc:
                outcome.append(("error", exc))

        worker = threading.Thread(target=submitting_worker)
        worker.start()
        self.assertTrue(submit_started.wait(timeout=2))
        deleter = threading.Thread(target=delete_while_submitting)
        deleter.start()
        self.assertTrue(delete_started.wait(timeout=2))
        deleter.join(timeout=0.1)
        waited_for_submit = deleter.is_alive()
        allow_task_save.set()
        worker.join(timeout=3)
        deleter.join(timeout=3)

        self.assertTrue(waited_for_submit)
        self.assertFalse(worker.is_alive())
        self.assertFalse(deleter.is_alive())
        self.assertEqual(len(outcome), 1)
        self.assertEqual(outcome[0][0], "error")
        self.assertIsInstance(outcome[0][1], svc.AiVideoError)
        self.assertEqual(outcome[0][1].http_status, 409)
        job = data_sink.get_ai_video_job(created["job"]["id"])
        run = data_sink.get_ai_video_run(run_id)
        self.assertEqual(job["status"], "running")
        self.assertIsNone(job.get("deletedAt"))
        self.assertEqual(run["providerTaskId"], "remote-task-won-race")


if __name__ == "__main__":
    unittest.main()
