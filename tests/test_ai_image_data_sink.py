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
        job = data_sink.create_ai_image_job({
            "title": "秋装主图",
            "prompt": "clean studio photo",
            "model_key": "gpt-image-2",
            "status": "draft",
            "params": {"size": "2048x2048", "quality": "high"},
            "summary": {"source": "workbench"},
        })

        self.assertTrue(job["job_uid"])
        self.assertEqual(job["title"], "秋装主图")
        self.assertEqual(job["params"]["size"], "2048x2048")
        self.assertEqual(data_sink.get_ai_image_job(job["job_uid"])["prompt"], "clean studio photo")

        updated = data_sink.update_ai_image_job(job["job_uid"], {
            "status": "completed",
            "summary": {"image_urls": ["https://cdn.example/result.png"]},
        })

        self.assertEqual(updated["status"], "completed")
        self.assertEqual(updated["summary"]["image_urls"], ["https://cdn.example/result.png"])
        self.assertEqual([item["job_uid"] for item in data_sink.list_ai_image_jobs()], [job["job_uid"]])

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
