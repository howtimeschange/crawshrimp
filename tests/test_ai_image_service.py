import json
import ssl
import tempfile
import unittest
from pathlib import Path
from urllib.error import URLError
from unittest.mock import patch

from core import data_sink
from core import ai_image_service


PNG_1X1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000a49444154789c6360000002000154a24f5d00000000"
    "49454e44ae426082"
)


class AiImageServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        patcher = patch("core.runtime_paths.data_root", return_value=self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        home_patcher = patch("pathlib.Path.home", return_value=self.root / "home")
        home_patcher.start()
        self.addCleanup(home_patcher.stop)
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
            "params": {"size": "2048x2048", "ratio": "1:1", "quality": "high", "n": 2},
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
        self.assertNotIn("ratio", payload)
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

    def test_materialize_data_url_image_writes_supported_annotation_png(self):
        job = data_sink.create_ai_image_job({"title": "annotation job"})
        data_url = "data:image/png;base64," + (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
        )

        result = ai_image_service.materialize_data_url_image(
            job["job_uid"],
            data_url,
            filename="annotation-edit.png",
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["job_uid"], job["job_uid"])
        self.assertEqual(result["mime_type"], "image/png")
        self.assertTrue(result["path"].endswith(".png"))
        self.assertTrue(Path(result["path"]).is_file())
        self.assertIn("annotation-edit", Path(result["path"]).name)

    def test_materialize_data_url_image_rejects_non_image_or_oversized_data(self):
        job = data_sink.create_ai_image_job({"title": "bad annotation job"})

        with self.assertRaisesRegex(ValueError, "仅支持 PNG、JPG 或 WEBP"):
            ai_image_service.materialize_data_url_image(
                job["job_uid"],
                "data:image/svg+xml;base64,PHN2Zy8+",
                filename="bad.svg",
            )

        with self.assertRaisesRegex(ValueError, "图片超过"):
            ai_image_service.materialize_data_url_image(
                job["job_uid"],
                "data:image/png;base64,AAAA",
                filename="too-large.png",
                max_bytes=1,
            )

    def test_gpt_workbench_payload_keeps_official_4k_and_normalizes_fields(self):
        payload = ai_image_service.build_workbench_one_xm_payload({
            "model_key": "gpt-image-2",
            "prompt": "make a product banner",
            "params": {
                "size": "3840x2160",
                "ratio": "16:9",
                "quality": "standard",
                "response_format": "jpg",
                "n": 2,
            },
        })

        self.assertEqual(payload["size"], "3840x2160")
        self.assertEqual(payload["quality"], "medium")
        self.assertEqual(payload["output_format"], "jpeg")
        self.assertEqual(payload["n"], 2)
        self.assertNotIn("ratio", payload)

    def test_gpt_workbench_payload_rejects_dimensions_outside_official_rules(self):
        for size in ("4096x4096", "1920x1080", "640x640"):
            with self.subTest(size=size), self.assertRaisesRegex(ValueError, "GPT-Image-2"):
                ai_image_service.build_workbench_one_xm_payload({
                    "model_key": "gpt-image-2",
                    "prompt": "make a product image",
                    "params": {"size": size},
                })

    def test_nano_workbench_payload_uses_ratio_and_resolution_without_openai_fields(self):
        payload = ai_image_service.build_workbench_one_xm_payload({
            "model_key": "gemini-3-pro-image-preview",
            "prompt": "make a product image",
            "params": {
                "size": "4K",
                "ratio": "16:9",
                "quality": "high",
                "response_format": "png",
                "n": 4,
            },
        })

        self.assertEqual(payload, {
            "model": "gemini-3-pro-image-preview",
            "prompt": "make a product image",
            "size": "16:9",
            "quality": "4K",
        })

    def test_build_payload_normalizes_legacy_ui_format_and_quality(self):
        job = {
            "prompt": "make a product image",
            "params": {"quality": "standard", "response_format": "jpg"},
        }

        payload = ai_image_service.build_one_xm_payload(job)

        self.assertEqual(payload["quality"], "medium")
        self.assertEqual(payload["output_format"], "jpeg")

    def test_run_job_saves_remote_urls_without_blocking_on_local_downloads(self):
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

        result = ai_image_service.run_job_with_one_xm(
            job["job_uid"],
            settings={"base_url": "https://api.example", "2k": "super-secret", "4k": ""},
            runner=fake_runner,
            downloader=lambda *_args: self.fail("generation should not synchronously download remote results"),
            file_to_data_url_fn=lambda _path: "data:image/png;base64,reference",
        )

        refreshed = data_sink.get_ai_image_job(job["job_uid"])
        summary_text = json.dumps(refreshed["summary"], ensure_ascii=False)
        self.assertTrue(result["ok"])
        self.assertEqual(refreshed["status"], "completed")
        self.assertEqual(refreshed["summary"]["image_urls"], ["https://cdn.example/out.png"])
        self.assertEqual(refreshed["summary"]["output_files"], [])
        self.assertEqual(refreshed["summary"]["runs"][0]["image_urls"], ["https://cdn.example/out.png"])
        self.assertEqual(refreshed["summary"]["runs"][0]["output_files"], [])
        self.assertEqual(refreshed["summary"]["runs"][0]["input_params"], {
            "main_image_path": "",
            "reference_image_paths": [],
        })
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
            Path(target).write_bytes(PNG_1X1)

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

    def test_run_job_requests_selected_count_and_ignores_extra_provider_urls(self):
        job = data_sink.create_ai_image_job({
            "title": "single image count",
            "prompt": "make one image only",
            "params": {"size": "1024x1024", "n": 1},
        })
        captured_payloads = []

        def fake_runner(_client, payload, **_kwargs):
            captured_payloads.append(dict(payload))
            return {
                "ok": True,
                "task_id": "task-extra-urls",
                "poll_url": "https://poll.example/task-extra-urls",
                "image_urls": [
                    "https://cdn.example/out-1.png",
                    "https://cdn.example/out-2.png",
                    "https://cdn.example/out-3.png",
                    "https://cdn.example/out-4.png",
                ],
            }

        result = ai_image_service.run_job_with_one_xm(
            job["job_uid"],
            settings={"2k": "key-2k", "4k": ""},
            runner=fake_runner,
            downloader=lambda *_args: self.fail("generation should not synchronously download remote results"),
        )

        refreshed = data_sink.get_ai_image_job(job["job_uid"])
        self.assertTrue(result["ok"])
        self.assertEqual(captured_payloads[0]["n"], 1)
        self.assertEqual(refreshed["summary"]["image_urls"], ["https://cdn.example/out-1.png"])
        self.assertEqual(refreshed["summary"]["output_files"], [])
        self.assertEqual(refreshed["summary"]["runs"][0]["image_urls"], ["https://cdn.example/out-1.png"])
        self.assertEqual(refreshed["summary"]["runs"][0]["output_files"], [])

    def test_run_job_appends_generation_runs_without_replacing_previous_results(self):
        job = data_sink.create_ai_image_job({
            "title": "same task feed",
            "prompt": "first prompt",
            "params": {"size": "1024x1024", "n": 1},
        })
        calls = []
        idempotency_keys = []

        def fake_runner(_client, payload, **kwargs):
            calls.append(payload["prompt"])
            idempotency_keys.append(kwargs.get("idempotency_key", ""))
            return {
                "ok": True,
                "task_id": f"task-{len(calls)}",
                "poll_url": f"https://poll.example/task-{len(calls)}",
                "image_urls": [f"https://cdn.example/out-{len(calls)}.png"],
            }

        first = ai_image_service.run_job_with_one_xm(
            job["job_uid"],
            settings={"2k": "key-2k", "4k": ""},
            runner=fake_runner,
            downloader=lambda *_args: self.fail("generation should not synchronously download remote results"),
        )
        data_sink.update_ai_image_job(job["job_uid"], {
            "prompt": "second prompt",
            "params": {"size": "1024x1024", "n": 1},
        })
        second = ai_image_service.run_job_with_one_xm(
            job["job_uid"],
            settings={"2k": "key-2k", "4k": ""},
            runner=fake_runner,
            downloader=lambda *_args: self.fail("generation should not synchronously download remote results"),
        )

        refreshed = data_sink.get_ai_image_job(job["job_uid"])
        self.assertTrue(first["ok"])
        self.assertTrue(second["ok"])
        self.assertEqual(refreshed["status"], "completed")
        self.assertEqual([run["prompt"] for run in refreshed["summary"]["runs"]], ["first prompt", "second prompt"])
        self.assertEqual([run["task_id"] for run in refreshed["summary"]["runs"]], ["task-1", "task-2"])
        self.assertEqual(len(idempotency_keys), 2)
        self.assertNotEqual(idempotency_keys[0], idempotency_keys[1])
        self.assertTrue(all(key.startswith(f"ai_image_{job['job_uid']}_") for key in idempotency_keys))
        self.assertEqual(len({run["run_uid"] for run in refreshed["summary"]["runs"]}), 2)
        self.assertEqual(refreshed["summary"]["output_files"], [])
        self.assertEqual([run["output_files"] for run in refreshed["summary"]["runs"]], [[], []])
        self.assertEqual(refreshed["summary"]["image_urls"], [
            "https://cdn.example/out-1.png",
            "https://cdn.example/out-2.png",
        ])

    def test_run_job_persists_edit_source_on_the_new_run(self):
        job = data_sink.create_ai_image_job({
            "prompt": "edit prompt",
            "summary": {
                "result_cache": {
                    "https://cdn.example/already-cached.png": "/cache/already-cached.png",
                },
            },
            "params": {
                "size": "1024x1024",
                "n": 1,
                "edit_source": {
                    "job_uid": "parent-job",
                    "run_uid": "parent-run",
                    "result_key": "https://cdn.example/parent.png",
                },
            },
        })

        ai_image_service.run_job_with_one_xm(
            job["job_uid"],
            settings={"2k": "key-2k", "4k": ""},
            runner=lambda *_args, **_kwargs: {
                "ok": True,
                "image_urls": ["https://cdn.example/child.png"],
            },
        )

        refreshed = data_sink.get_ai_image_job(job["job_uid"])
        run = refreshed["summary"]["runs"][0]
        self.assertEqual(run["edit_source"], {
            "job_uid": "parent-job",
            "run_uid": "parent-run",
            "result_key": "https://cdn.example/parent.png",
        })
        self.assertEqual(refreshed["summary"]["result_cache"], {
            "https://cdn.example/already-cached.png": "/cache/already-cached.png",
        })

    def test_run_job_keeps_run_keys_unique_when_provider_task_id_repeats(self):
        job = data_sink.create_ai_image_job({
            "title": "same task provider cache guard",
            "prompt": "first prompt",
            "params": {"size": "1024x1024", "n": 1},
        })
        calls = []

        def fake_runner(_client, payload, **_kwargs):
            calls.append(payload["prompt"])
            return {
                "ok": True,
                "task_id": "provider-reused-task",
                "poll_url": "https://poll.example/provider-reused-task",
                "image_urls": [f"https://cdn.example/out-{len(calls)}.png"],
            }

        ai_image_service.run_job_with_one_xm(
            job["job_uid"],
            settings={"2k": "key-2k", "4k": ""},
            runner=fake_runner,
            downloader=lambda *_args: self.fail("generation should not synchronously download remote results"),
        )
        data_sink.update_ai_image_job(job["job_uid"], {
            "prompt": "second prompt",
            "params": {"size": "1024x1024", "n": 1},
        })
        ai_image_service.run_job_with_one_xm(
            job["job_uid"],
            settings={"2k": "key-2k", "4k": ""},
            runner=fake_runner,
            downloader=lambda *_args: self.fail("generation should not synchronously download remote results"),
        )

        refreshed = data_sink.get_ai_image_job(job["job_uid"])
        runs = refreshed["summary"]["runs"]
        self.assertEqual([run["task_id"] for run in runs], ["provider-reused-task", "provider-reused-task"])
        self.assertEqual(len({run["run_uid"] for run in runs}), 2)
        self.assertEqual([run["image_urls"][0] for run in runs], [
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

    def test_run_job_ignores_downloader_failures_because_generation_is_url_first(self):
        job = data_sink.create_ai_image_job({
            "title": "download failure no longer blocks",
            "prompt": "prompt",
            "params": {"size": "1024x1024", "n": 2},
        })

        def fake_runner(*_args, **_kwargs):
            return {"ok": True, "image_urls": ["https://cdn.example/one.png", "https://cdn.example/two.png"]}

        result = ai_image_service.run_job_with_one_xm(
            job["job_uid"],
            settings={"2k": "secret-key", "4k": ""},
            runner=fake_runner,
            downloader=lambda *_args: (_ for _ in ()).throw(RuntimeError("download should not run")),
        )

        refreshed = data_sink.get_ai_image_job(job["job_uid"])
        summary_text = json.dumps(refreshed["summary"], ensure_ascii=False)
        self.assertTrue(result["ok"])
        self.assertEqual(refreshed["status"], "completed")
        self.assertEqual(refreshed["summary"]["warning"], "")
        self.assertEqual(refreshed["summary"]["output_files"], [])
        self.assertEqual(refreshed["summary"]["image_urls"], ["https://cdn.example/one.png", "https://cdn.example/two.png"])
        self.assertNotEqual(refreshed["status"], "running")
        self.assertNotIn("secret-key", summary_text)
        self.assertNotIn("data:image", summary_text)
        self.assertNotIn("webhook_secret", summary_text)

    def test_materialize_remote_image_downloads_known_job_url_to_cache(self):
        job = data_sink.create_ai_image_job({"title": "materialize job"})
        downloads = []
        data_sink.update_ai_image_job(job["job_uid"], {
            "summary": {
                "image_urls": ["https://cdn.example/generated.png"],
                "runs": [{
                    "run_uid": "run-existing",
                    "image_urls": ["https://cdn.example/from-run.webp"],
                }],
            },
        })

        def downloader(_url, target):
            downloads.append(str(target))
            Path(target).write_bytes(PNG_1X1)

        first = ai_image_service.materialize_remote_image(
            job["job_uid"],
            "https://cdn.example/generated.png",
            downloader=downloader,
        )
        second = ai_image_service.materialize_remote_image(
            job["job_uid"],
            "https://cdn.example/generated.png",
            downloader=downloader,
        )
        refreshed = data_sink.get_ai_image_job(job["job_uid"])

        self.assertTrue(first["ok"])
        self.assertEqual(first["url"], "https://cdn.example/generated.png")
        self.assertEqual(first["path"], second["path"])
        self.assertEqual(len(downloads), 1)
        self.assertTrue(Path(first["path"]).is_file())
        self.assertIn("ai-image-cache", first["path"])
        self.assertEqual(Path(first["path"]).suffix, ".png")
        self.assertEqual(refreshed["summary"]["runs"], [{
            "run_uid": "run-existing",
            "image_urls": ["https://cdn.example/from-run.webp"],
        }])
        self.assertEqual(
            refreshed["summary"]["result_cache"]["https://cdn.example/generated.png"],
            first["path"],
        )

    def test_materialize_remote_image_rebuilds_a_corrupt_deterministic_cache(self):
        url = "https://cdn.example/generated.png"
        job = data_sink.create_ai_image_job({
            "title": "materialize corrupt cache",
            "summary": {"image_urls": [url]},
        })
        downloads = []

        def downloader(_url, target):
            downloads.append(str(target))
            Path(target).write_bytes(PNG_1X1)

        first = ai_image_service.materialize_remote_image(job["job_uid"], url, downloader=downloader)
        Path(first["path"]).write_bytes(b"not-an-image")
        second = ai_image_service.materialize_remote_image(job["job_uid"], url, downloader=downloader)

        self.assertEqual(first["path"], second["path"])
        self.assertEqual(len(downloads), 2)
        self.assertEqual(Path(second["path"]).read_bytes(), PNG_1X1)

    def test_materialize_remote_image_retries_transient_tls_download_failure(self):
        url = "https://cdn.example/transient.png"
        job = data_sink.create_ai_image_job({
            "title": "materialize transient download",
            "summary": {"image_urls": [url]},
        })
        attempts = []

        def downloader(_url, target):
            attempts.append(str(target))
            if len(attempts) == 1:
                raise URLError(ssl.SSLEOFError(8, "UNEXPECTED_EOF_WHILE_READING"))
            Path(target).write_bytes(PNG_1X1)

        with patch("core.ai_image_service.time.sleep") as sleep:
            result = ai_image_service.materialize_remote_image(
                job["job_uid"],
                url,
                downloader=downloader,
            )

        self.assertTrue(result["ok"])
        self.assertEqual(len(attempts), 2)
        self.assertEqual(Path(result["path"]).read_bytes(), PNG_1X1)
        sleep.assert_called_once_with(0.25)

    def test_materialize_remote_image_can_cache_stale_persisted_result_url(self):
        result = ai_image_service.materialize_remote_image(
            "stale-local-job",
            "https://cdn.example/stale-result.webp",
            allow_unlisted=True,
            downloader=lambda _url, target: Path(target).write_bytes(PNG_1X1),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["job_uid"], "stale-local-job")
        self.assertEqual(result["url"], "https://cdn.example/stale-result.webp")
        self.assertTrue(Path(result["path"]).is_file())
        self.assertIn("ai-image-cache", result["path"])
        self.assertEqual(Path(result["path"]).suffix, ".webp")

    def test_materialize_remote_image_rejects_urls_outside_job_results(self):
        job = data_sink.create_ai_image_job({"title": "materialize guard"})
        data_sink.update_ai_image_job(job["job_uid"], {
            "summary": {"image_urls": ["https://cdn.example/generated.png"]},
        })

        with self.assertRaisesRegex(ValueError, "不属于当前任务"):
            ai_image_service.materialize_remote_image(
                job["job_uid"],
                "https://evil.example/not-this-job.png",
                downloader=lambda *_args: self.fail("unknown URLs must not be downloaded"),
            )

    def test_download_outputs_uses_unique_names_without_overwriting_existing_files(self):
        output_dir = self.root / "downloads"
        output_dir.mkdir()
        existing = output_dir / "result-01.png"
        existing.write_bytes(b"existing")

        files = ai_image_service._download_outputs(
            ["https://cdn.example/out.png"],
            output_dir,
            lambda _url, target: Path(target).write_bytes(PNG_1X1),
        )

        self.assertEqual(existing.read_bytes(), b"existing")
        self.assertEqual(Path(files[0]).name, "result-01-1.png")
        self.assertEqual(Path(files[0]).read_bytes(), PNG_1X1)

    def test_download_outputs_rejects_non_image_files_and_removes_bad_file(self):
        output_dir = self.root / "downloads"

        with self.assertRaises(ai_image_service.DownloadOutputsError) as ctx:
            ai_image_service._download_outputs(
                ["https://cdn.example/out.png"],
                output_dir,
                lambda _url, target: Path(target).write_bytes(b"png"),
            )

        self.assertEqual(ctx.exception.output_files, [])
        self.assertFalse(any(output_dir.iterdir()))

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
