import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import data_sink


class AiImageDataSinkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        patcher = patch("core.runtime_paths.data_root", return_value=self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()

    def test_job_crud_round_trips_structured_fields(self):
        output_dir = str(self.root / "exports")
        job = data_sink.create_ai_image_job({
            "title": "秋装主图",
            "prompt": "clean studio photo",
            "model_key": "gpt-image-2",
            "status": "draft",
            "output_dir": output_dir,
            "params": {"size": "2048x2048", "quality": "high"},
            "summary": {"source": "workbench"},
        })

        self.assertTrue(job["job_uid"])
        self.assertEqual(job["title"], "秋装主图")
        self.assertEqual(job["output_dir"], output_dir)
        self.assertEqual(job["params"]["size"], "2048x2048")
        loaded = data_sink.get_ai_image_job(job["job_uid"])
        self.assertEqual(loaded["prompt"], "clean studio photo")
        self.assertEqual(loaded["output_dir"], output_dir)

        updated = data_sink.update_ai_image_job(job["job_uid"], {
            "status": "completed",
            "output_dir": str(self.root / "exports-2"),
            "summary": {"image_urls": ["https://cdn.example/result.png"]},
        })

        self.assertEqual(updated["status"], "completed")
        self.assertEqual(updated["output_dir"], str(self.root / "exports-2"))
        self.assertEqual(updated["summary"]["image_urls"], ["https://cdn.example/result.png"])
        listed = data_sink.list_ai_image_jobs()
        self.assertEqual([item["job_uid"] for item in listed], [job["job_uid"]])
        self.assertEqual(listed[0]["output_dir"], str(self.root / "exports-2"))

    def test_pinned_jobs_sort_by_latest_pin_without_touching_updated_at(self):
        first = data_sink.create_ai_image_job({"title": "first"})
        second = data_sink.create_ai_image_job({"title": "second"})
        first_updated_at = first["updated_at"]
        second_updated_at = second["updated_at"]

        with patch("core.data_sink._utc_now_iso", side_effect=[
            "2026-07-10T10:00:00+00:00",
            "2026-07-10T10:01:00+00:00",
        ]):
            pinned_first = data_sink.set_ai_image_job_pinned(first["job_uid"], True)
            pinned_second = data_sink.set_ai_image_job_pinned(second["job_uid"], True)

        listed = data_sink.list_ai_image_jobs()

        self.assertEqual([item["job_uid"] for item in listed[:2]], [second["job_uid"], first["job_uid"]])
        self.assertEqual(pinned_first["pinned_at"], "2026-07-10T10:00:00+00:00")
        self.assertEqual(pinned_second["pinned_at"], "2026-07-10T10:01:00+00:00")
        self.assertEqual(pinned_first["updated_at"], first_updated_at)
        self.assertEqual(pinned_second["updated_at"], second_updated_at)

        unpinned_second = data_sink.set_ai_image_job_pinned(second["job_uid"], False)

        self.assertEqual(unpinned_second["pinned_at"], "")
        self.assertEqual(data_sink.list_ai_image_jobs()[0]["job_uid"], first["job_uid"])

    def test_delete_job_cascades_assets_and_canvases(self):
        job = data_sink.create_ai_image_job({"title": "delete me"})
        data_sink.create_ai_image_asset({
            "job_uid": job["job_uid"],
            "kind": "result",
            "path": "/tmp/result.png",
        })
        data_sink.create_ai_image_canvas({
            "job_uid": job["job_uid"],
            "title": "delete canvas",
            "canvas": {"nodes": []},
        })

        deleted = data_sink.delete_ai_image_job(job["job_uid"])

        self.assertTrue(deleted)
        self.assertIsNone(data_sink.get_ai_image_job(job["job_uid"]))
        self.assertEqual(data_sink.list_ai_image_assets(job["job_uid"]), [])
        self.assertEqual(data_sink.list_ai_image_canvases(job["job_uid"]), [])
        self.assertFalse(data_sink.delete_ai_image_job(job["job_uid"]))

    def test_asset_crud_preserves_order_and_metadata(self):
        job = data_sink.create_ai_image_job({"title": "asset job"})
        first = data_sink.create_ai_image_asset({
            "job_uid": job["job_uid"],
            "kind": "reference",
            "source_type": "local",
            "path": "/tmp/b.png",
            "sort_order": 20,
            "meta": {"slot": "back"},
        })
        second = data_sink.create_ai_image_asset({
            "job_uid": job["job_uid"],
            "kind": "reference",
            "source_type": "local",
            "path": "/tmp/a.png",
            "sort_order": 10,
            "meta": {"slot": "front"},
        })

        assets = data_sink.list_ai_image_assets(job["job_uid"])

        self.assertEqual([item["asset_uid"] for item in assets], [second["asset_uid"], first["asset_uid"]])
        self.assertEqual(assets[0]["meta"], {"slot": "front"})

    def test_canvas_crud_round_trips_canvas_json(self):
        job = data_sink.create_ai_image_job({"title": "canvas job"})
        canvas = data_sink.create_ai_image_canvas({
            "job_uid": job["job_uid"],
            "title": "对比画布",
            "canvas": {"nodes": [{"id": "a1", "x": 8, "y": 12}]},
        })

        loaded = data_sink.get_ai_image_canvas(canvas["canvas_uid"])

        self.assertEqual(loaded["job_uid"], job["job_uid"])
        self.assertEqual(loaded["canvas"]["nodes"][0]["id"], "a1")
        self.assertEqual(data_sink.list_ai_image_canvases(job["job_uid"])[0]["canvas_uid"], canvas["canvas_uid"])


if __name__ == "__main__":
    unittest.main()
