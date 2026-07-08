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

    def test_default_output_dir_is_job_scoped_under_runtime_data(self):
        job = {"job_uid": "job-123"}

        path = ai_image_service.default_output_dir(job)

        self.assertEqual(path, self.root / "ai-image" / "jobs" / "job-123")

    def test_select_model_key_prefers_size_tier_and_raises_without_key(self):
        settings = {"2k": "key-2k", "4k": "key-4k"}

        self.assertEqual(ai_image_service.select_model_key({"size": "4096x4096"}, settings), ("4k", "key-4k"))
        self.assertEqual(ai_image_service.select_model_key({"size": "1024x1024"}, settings), ("2k", "key-2k"))

        with self.assertRaisesRegex(ValueError, "1XM GPT Image 4K Key"):
            ai_image_service.select_model_key({"size": "4096x4096"}, {"2k": "key-2k", "4k": ""})

    def test_build_payload_orders_reference_images_and_uses_file_to_data_url(self):
        job = {
            "prompt": "make a hero image",
            "params": {"size": "2048x2048", "quality": "high", "n": 2},
        }
        assets = [
            {"kind": "reference", "path": "/tmp/back.png", "sort_order": 20},
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
            "data:image/png;base64,front",
            "data:image/png;base64,back",
        ])

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

    def test_copy_assets_to_directory_copies_local_assets(self):
        source = self.root / "source.png"
        source.write_bytes(b"image")
        target_dir = self.root / "export"

        copied = ai_image_service.copy_assets_to_directory([
            {"path": str(source), "kind": "reference"},
            {"url": "https://cdn.example/skip.png", "kind": "generated"},
        ], target_dir)

        self.assertEqual(len(copied), 1)
        self.assertEqual(Path(copied[0]).read_bytes(), b"image")


if __name__ == "__main__":
    unittest.main()
