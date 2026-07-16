import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from core import ai_video_generation_service as svc
from core import data_sink


class AiVideoGenerationServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.output_dir = self.root / "out"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        patcher = patch("core.runtime_paths.data_root", return_value=self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()
        svc.set_cli_runner(None)
        svc.set_downloader(None)
        self.addCleanup(lambda: svc.set_cli_runner(None))
        self.addCleanup(lambda: svc.set_downloader(None))
        self.addCleanup(svc.stop_worker)

    def _write_image(self, name: str, size=(512, 512)) -> Path:
        path = self.root / name
        Image.new("RGB", size, color=(20, 120, 200)).save(path, format="JPEG")
        return path

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
        seedance = svc.validate_input({
            "provider": "seedance",
            "model": "seedance-2.0",
            "prompt": "a cinematic product shot",
            "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5, "generateAudio": True, "watermark": False},
            "assets": [{"localPath": str(img)}],
            "outputDir": str(self.output_dir),
        })
        self.assertEqual(seedance["model"], svc.SEEDANCE_MODEL)
        self.assertEqual(seedance["parameters"]["duration"], 5)

        with self.assertRaises(svc.AiVideoError):
            svc.validate_input({
                "provider": "happyhorse",
                "model": "happyhorse-1.1-t2v",
                "prompt": "text only",
                "parameters": {"ratio": "16:9", "resolution": "720P", "duration": 5},
                "assets": [{"localPath": str(img)}],
                "outputDir": str(self.output_dir),
            })

        with self.assertRaises(svc.AiVideoError):
            svc.validate_input({
                "provider": "happyhorse",
                "model": "happyhorse-1.1-i2v",
                "prompt": "i2v",
                "parameters": {"ratio": "16:9", "resolution": "720P", "duration": 5},
                "assets": [{"localPath": str(img)}],
                "outputDir": str(self.output_dir),
            })

        i2v = svc.validate_input({
            "provider": "happyhorse",
            "model": "happyhorse-1.1-i2v",
            "prompt": "i2v",
            "parameters": {"resolution": "720P", "duration": 5, "watermark": False},
            "assets": [{"localPath": str(img)}],
            "outputDir": str(self.output_dir),
        })
        self.assertNotIn("ratio", i2v["parameters"])

    def test_redact_text_hides_secrets_and_home(self):
        home = str(Path.home())
        text = f"Authorization: Bearer secret-token path={home}/Downloads/a.mp4 ARK_API_KEY=abc123"
        redacted = svc.redact_text(text, ["abc123", "secret-token"])
        self.assertNotIn("secret-token", redacted)
        self.assertNotIn("abc123", redacted)
        self.assertNotIn(home, redacted)
        self.assertIn("~", redacted)

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
                "outputDir": str(self.output_dir),
            })
            second = svc.create_job({
                "requestUid": "req-idem-1",
                "provider": "seedance",
                "model": "seedance-2.0",
                "prompt": "mock seedance video",
                "parameters": {"ratio": "9:16", "resolution": "720p", "duration": 5, "generateAudio": True, "watermark": False},
                "assets": [],
                "outputDir": str(self.output_dir),
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
                "outputDir": str(self.output_dir),
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


if __name__ == "__main__":
    unittest.main()
