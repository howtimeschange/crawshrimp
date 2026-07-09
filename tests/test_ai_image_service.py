import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import data_sink
from core import ai_image_service


class AiImageServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        patcher = patch("core.runtime_paths.data_root", return_value=self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()

    def test_default_output_dir_uses_user_visible_downloads_folder(self):
        job = {"job_uid": "job-123"}
        home = self.root.parent / f"home-{self.root.name}"

        with patch("pathlib.Path.home", return_value=home):
            path = ai_image_service.default_output_dir(job)

        self.assertEqual(path, home / "Downloads" / "抓虾导出" / "AI生图")
        self.assertNotIn(str(self.root), str(path))
        self.assertNotIn("job-123", str(path))

    def test_default_output_dir_honors_explicit_output_dir(self):
        output_dir = self.root / "custom-export"
        job = {"job_uid": "job-123", "output_dir": str(output_dir)}

        path = ai_image_service.default_output_dir(job)

        self.assertEqual(path, output_dir)

    def test_select_model_key_prefers_size_tier_and_raises_without_key(self):
        settings = {"2k": "key-2k", "4k": "key-4k"}

        self.assertEqual(ai_image_service.select_model_key({"size": "4096x4096"}, settings), ("4k", "key-4k"))
        self.assertEqual(ai_image_service.select_model_key({"size": "1024x1024"}, settings), ("2k", "key-2k"))

        with self.assertRaisesRegex(ValueError, "1XM GPT Image 4K Key"):
            ai_image_service.select_model_key({"size": "4096x4096"}, {"2k": "key-2k", "4k": ""})

    def test_select_model_key_uses_independent_gemini_config_ids(self):
        settings = {
            "2k": "gpt-2k",
            "4k": "gpt-4k",
            "ai.1xm.gemini_3_1_flash_image_preview_key": "flash-key",
            "ai.1xm.gemini_3_pro_image_preview_key": "pro-key",
        }

        self.assertEqual(
            ai_image_service.select_model_key({"model_key": "gemini-3.1-flash-image-preview"}, settings),
            ("ai.1xm.gemini_3_1_flash_image_preview_key", "flash-key"),
        )
        self.assertEqual(
            ai_image_service.select_model_key({"model_key": "gemini-3-pro-image-preview"}, settings),
            ("ai.1xm.gemini_3_pro_image_preview_key", "pro-key"),
        )

        with self.assertRaisesRegex(ValueError, "ai\\.1xm\\.gemini_3_pro_image_preview_key") as ctx:
            ai_image_service.select_model_key(
                {"model_key": "gemini-3-pro-image-preview"},
                {"2k": "gpt-2k", "4k": "gpt-4k", "ai.1xm.gemini_3_pro_image_preview_key": ""},
            )
        self.assertEqual(ctx.exception.config_id, "ai.1xm.gemini_3_pro_image_preview_key")

    def test_build_payload_orders_reference_images_and_uses_file_to_data_url(self):
        job = {
            "prompt": "make a hero image",
            "params": {"size": "2048x2048", "quality": "high", "n": 2},
        }
        assets = [
            {"kind": "reference", "path": "/tmp/back.png", "sort_order": 20},
            {"kind": "main", "path": "/tmp/main.png", "sort_order": 999},
            {"kind": "mask", "path": "/tmp/mask.png", "sort_order": 5},
            {"kind": "reference", "path": "/tmp/front.png", "sort_order": 10},
        ]

        payload = ai_image_service.build_one_xm_payload(
            job,
            assets,
            file_to_data_url_fn=lambda path: f"data:image/png;base64,{Path(path).stem}",
        )

        self.assertEqual(payload["prompt"], "make a hero image")
        self.assertEqual(payload["size"], "2048x2048")
        self.assertEqual(payload["quality"], "high")
        self.assertEqual(payload["n"], 2)
        self.assertEqual(payload["image"], [
            "data:image/png;base64,main",
            "data:image/png;base64,front",
            "data:image/png;base64,back",
        ])

    def test_build_payload_allows_text_to_image_without_reference_assets(self):
        job = {
            "prompt": "make a dragon dance on the great wall",
            "params": {"size": "1024x1024", "quality": "high", "n": 1},
        }

        payload = ai_image_service.build_one_xm_payload(
            job,
            [],
            file_to_data_url_fn=lambda path: self.fail(f"unexpected image read: {path}"),
        )

        self.assertEqual(payload["prompt"], "make a dragon dance on the great wall")
        self.assertEqual(payload["size"], "1024x1024")
        self.assertNotIn("image", payload)

    def test_build_payload_reads_persisted_input_paths_from_params(self):
        job = {
            "prompt": "make a product image",
            "params": {
                "size": "1024x1024",
                "main_image_path": "/tmp/main.png",
                "reference_image_paths": ["/tmp/ref-a.png", "/tmp/ref-b.png"],
            },
        }

        payload = ai_image_service.build_one_xm_payload(
            job,
            [],
            file_to_data_url_fn=lambda path: f"data:image/png;base64,{Path(path).stem}",
        )

        self.assertEqual(payload["image"], [
            "data:image/png;base64,main",
            "data:image/png;base64,ref-a",
            "data:image/png;base64,ref-b",
        ])

    def test_build_payload_normalizes_oversized_4k_dimensions_to_provider_limit(self):
        payload = ai_image_service.build_one_xm_payload({
            "prompt": "make a product image",
            "params": {"size": "4096x4096"},
        })
        self.assertEqual(payload["size"], "2048x2048")

        wide_payload = ai_image_service.build_one_xm_payload({
            "prompt": "make a product banner",
            "params": {"size": "4096x2304"},
        })
        self.assertEqual(wide_payload["size"], "2048x1152")

    def test_build_payload_accepts_ui_response_format_and_standard_quality(self):
        job = {
            "prompt": "make a product image",
            "params": {"quality": "standard", "response_format": "webp"},
        }

        payload = ai_image_service.build_one_xm_payload(job)

        self.assertEqual(payload["quality"], "standard")
        self.assertEqual(payload["output_format"], "webp")

    def test_run_job_downloads_outputs_and_keeps_key_and_data_urls_out_of_summary(self):
        job = data_sink.create_ai_image_job({
            "title": "secure job",
            "prompt": "prompt",
            "params": {"size": "1024x1024"},
        })
        data_sink.create_ai_image_asset({
            "job_uid": job["job_uid"],
            "kind": "reference",
            "path": "/tmp/ref.png",
        })

        def fake_runner(client, payload, **kwargs):
            self.assertEqual(payload["image"], ["data:image/png;base64,reference"])
            self.assertNotIn("super-secret", json.dumps(payload))
            return {
                "ok": True,
                "task_id": "task-1",
                "poll_url": "https://poll.example/task-1",
                "image_urls": ["https://cdn.example/out.png"],
                "raw": {"contains": "raw upstream"},
            }

        def fake_download(url, target):
            Path(target).write_bytes(b"png")

        result = ai_image_service.run_job_with_one_xm(
            job["job_uid"],
            settings={"base_url": "https://api.example", "2k": "super-secret", "4k": ""},
            runner=fake_runner,
            downloader=fake_download,
            file_to_data_url_fn=lambda _path: "data:image/png;base64,reference",
        )

        refreshed = data_sink.get_ai_image_job(job["job_uid"])
        summary_text = json.dumps(refreshed["summary"], ensure_ascii=False)
        self.assertTrue(result["ok"])
        self.assertEqual(refreshed["status"], "completed")
        self.assertTrue(Path(refreshed["summary"]["output_files"][0]).is_file())
        self.assertNotIn("super-secret", summary_text)
        self.assertNotIn("data:image", summary_text)
        self.assertNotIn("raw upstream", summary_text)

    def test_run_job_supports_prompt_only_generation_without_assets(self):
        job = data_sink.create_ai_image_job({
            "title": "prompt only",
            "prompt": "make a dragon dance on the great wall",
            "params": {"size": "1024x1024"},
        })

        def fake_runner(client, payload, **kwargs):
            self.assertNotIn("image", payload)
            self.assertEqual(payload["prompt"], "make a dragon dance on the great wall")
            return {
                "ok": True,
                "task_id": "task-text-only",
                "poll_url": "https://poll.example/task-text-only",
                "image_urls": ["https://cdn.example/text-only.png"],
            }

        def fake_download(url, target):
            Path(target).write_bytes(b"png")

        result = ai_image_service.run_job_with_one_xm(
            job["job_uid"],
            settings={"base_url": "https://api.example", "2k": "super-secret", "4k": ""},
            runner=fake_runner,
            downloader=fake_download,
            file_to_data_url_fn=lambda path: self.fail(f"unexpected image read: {path}"),
        )

        refreshed = data_sink.get_ai_image_job(job["job_uid"])
        self.assertTrue(result["ok"])
        self.assertEqual(refreshed["status"], "completed")
        self.assertEqual(refreshed["summary"]["task_id"], "task-text-only")

    def test_run_job_appends_generation_runs_without_replacing_previous_results(self):
        job = data_sink.create_ai_image_job({
            "title": "same task feed",
            "prompt": "first prompt",
            "params": {"size": "1024x1024", "n": 1},
        })
        calls = []

        def fake_runner(_client, payload, **_kwargs):
            calls.append(payload["prompt"])
            return {
                "ok": True,
                "task_id": f"task-{len(calls)}",
                "poll_url": f"https://poll.example/task-{len(calls)}",
                "image_urls": [f"https://cdn.example/out-{len(calls)}.png"],
            }

        def fake_download(_url, target):
            Path(target).write_bytes(b"png")

        first = ai_image_service.run_job_with_one_xm(
            job["job_uid"],
            settings={"2k": "key-2k", "4k": ""},
            runner=fake_runner,
            downloader=fake_download,
        )
        data_sink.update_ai_image_job(job["job_uid"], {
            "prompt": "second prompt",
            "params": {"size": "1024x1024", "n": 1},
        })
        second = ai_image_service.run_job_with_one_xm(
            job["job_uid"],
            settings={"2k": "key-2k", "4k": ""},
            runner=fake_runner,
            downloader=fake_download,
        )

        refreshed = data_sink.get_ai_image_job(job["job_uid"])
        self.assertTrue(first["ok"])
        self.assertTrue(second["ok"])
        self.assertEqual(refreshed["status"], "completed")
        self.assertEqual([run["prompt"] for run in refreshed["summary"]["runs"]], ["first prompt", "second prompt"])
        self.assertEqual([run["task_id"] for run in refreshed["summary"]["runs"]], ["task-1", "task-2"])
        self.assertEqual(len(refreshed["summary"]["output_files"]), 2)
        self.assertEqual(refreshed["summary"]["image_urls"], [
            "https://cdn.example/out-1.png",
            "https://cdn.example/out-2.png",
        ])

    def test_run_job_marks_failed_when_runner_raises_after_start(self):
        job = data_sink.create_ai_image_job({
            "title": "runner failure",
            "prompt": "prompt",
            "params": {"size": "1024x1024"},
        })

        def failing_runner(*_args, **_kwargs):
            raise RuntimeError("upstream exploded with api_key=super-secret and data:image/png;base64,abc")

        result = ai_image_service.run_job_with_one_xm(
            job["job_uid"],
            settings={"2k": "super-secret", "4k": ""},
            runner=failing_runner,
        )

        refreshed = data_sink.get_ai_image_job(job["job_uid"])
        summary_text = json.dumps(refreshed["summary"], ensure_ascii=False)
        self.assertFalse(result["ok"])
        self.assertEqual(refreshed["status"], "failed")
        self.assertIn("upstream exploded", refreshed["summary"]["error"])
        self.assertNotIn("super-secret", summary_text)
        self.assertNotIn("data:image", summary_text)

    def test_run_job_keeps_upstream_success_when_download_raises_after_outputs(self):
        job = data_sink.create_ai_image_job({
            "title": "download failure",
            "prompt": "prompt",
            "params": {"size": "1024x1024"},
        })

        def fake_runner(*_args, **_kwargs):
            return {"ok": True, "image_urls": ["https://cdn.example/one.png", "https://cdn.example/two.png"]}

        def flaky_download(url, target):
            if "two" in url:
                raise RuntimeError("download failed for webhook_secret=hidden")
            Path(target).write_bytes(b"png")

        result = ai_image_service.run_job_with_one_xm(
            job["job_uid"],
            settings={"2k": "secret-key", "4k": ""},
            runner=fake_runner,
            downloader=flaky_download,
        )

        refreshed = data_sink.get_ai_image_job(job["job_uid"])
        summary_text = json.dumps(refreshed["summary"], ensure_ascii=False)
        self.assertTrue(result["ok"])
        self.assertEqual(refreshed["status"], "completed")
        self.assertEqual(len(refreshed["summary"]["output_files"]), 1)
        self.assertIn("本地保存失败", refreshed["summary"]["warning"])
        self.assertNotIn("webhook_secret", summary_text)
        self.assertNotIn("secret-key", summary_text)

    def test_run_job_keeps_remote_results_when_download_setup_raises_before_saving_files(self):
        job = data_sink.create_ai_image_job({
            "title": "download setup failure",
            "prompt": "prompt",
            "params": {"size": "1024x1024"},
        })

        def fake_runner(*_args, **_kwargs):
            return {"ok": True, "image_urls": ["https://cdn.example/one.png"]}

        with patch("core.ai_image_service._unique_path", side_effect=RuntimeError("allocate failed api_key=secret-key data:image/png;base64,abc webhook_secret=hidden")):
            result = ai_image_service.run_job_with_one_xm(
                job["job_uid"],
                settings={"2k": "secret-key", "4k": ""},
                runner=fake_runner,
                downloader=lambda _url, target: Path(target).write_bytes(b"png"),
            )

        refreshed = data_sink.get_ai_image_job(job["job_uid"])
        summary_text = json.dumps(refreshed["summary"], ensure_ascii=False)
        self.assertTrue(result["ok"])
        self.assertEqual(refreshed["status"], "completed")
        self.assertIn("allocate failed", refreshed["summary"]["warning"])
        self.assertEqual(refreshed["summary"]["output_files"], [])
        self.assertEqual(refreshed["summary"]["image_urls"], ["https://cdn.example/one.png"])
        self.assertNotEqual(refreshed["status"], "running")
        self.assertNotIn("secret-key", summary_text)
        self.assertNotIn("data:image", summary_text)
        self.assertNotIn("webhook_secret", summary_text)

    def test_download_outputs_uses_unique_names_without_overwriting_existing_files(self):
        output_dir = self.root / "downloads"
        output_dir.mkdir()
        existing = output_dir / "result-01.png"
        existing.write_bytes(b"existing")

        files = ai_image_service._download_outputs(
            ["https://cdn.example/out.png"],
            output_dir,
            lambda _url, target: Path(target).write_bytes(b"new"),
        )

        self.assertEqual(existing.read_bytes(), b"existing")
        self.assertEqual(Path(files[0]).name, "result-01-1.png")
        self.assertEqual(Path(files[0]).read_bytes(), b"new")

    def test_copy_assets_to_directory_copies_local_assets(self):
        source = self.root / "source.png"
        source.write_bytes(b"image")
        target_dir = self.root / "export"

        copied = ai_image_service.copy_assets_to_directory([
            {"path": str(source), "kind": "reference"},
        ], target_dir)

        self.assertEqual(len(copied), 1)
        self.assertEqual(Path(copied[0]).read_bytes(), b"image")

    def test_copy_assets_to_directory_downloads_remote_assets(self):
        target_dir = self.root / "remote-export"

        copied = ai_image_service.copy_assets_to_directory(
            [{"url": "https://cdn.example/generated.png", "kind": "generated"}],
            target_dir,
            downloader=lambda _url, target: Path(target).write_bytes(b"remote"),
        )

        self.assertEqual(len(copied), 1)
        self.assertEqual(Path(copied[0]).name, "result-01.png")
        self.assertEqual(Path(copied[0]).read_bytes(), b"remote")

    def test_copy_assets_to_directory_loops_until_unique_name(self):
        source = self.root / "source.png"
        source.write_bytes(b"image")
        target_dir = self.root / "export"
        target_dir.mkdir()
        (target_dir / "source.png").write_bytes(b"existing")
        (target_dir / "source-1.png").write_bytes(b"existing alternate")

        copied = ai_image_service.copy_assets_to_directory([{"path": str(source)}], target_dir)

        self.assertEqual(Path(copied[0]).name, "source-2.png")
        self.assertEqual((target_dir / "source.png").read_bytes(), b"existing")
        self.assertEqual((target_dir / "source-1.png").read_bytes(), b"existing alternate")


if __name__ == "__main__":
    unittest.main()
