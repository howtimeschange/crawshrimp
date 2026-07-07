import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from core.cloud_batch_sync import build_cloud_batch_payload, sync_local_approval_batch


class FakeClient:
    def __init__(self):
        self.calls = []
        self.uploads = []

    def request_json(self, method, path, body=None, *, token_type="machine"):
        self.calls.append((method, path, body, token_type))
        if path == "/api/ai-image-batches/presign":
            return {
                "uploads": [
                    {
                        "asset_uid": item["asset_uid"],
                        "upload_url": f"https://upload.example.com/{item['asset_uid']}",
                    }
                    for item in body["assets"]
                ]
            }
        if path == "/api/ai-image-batches/sync-complete":
            return {"ok": True, "batch_uid": body["batch_uid"]}
        return {"ok": True, "batch_uid": body["batch_uid"]}

    def upload_asset(self, upload_url, path, content_type):
        self.uploads.append((upload_url, Path(path), content_type))
        return {"ok": True}


class CloudBatchSyncTests(unittest.TestCase):
    def _local_batch(self, temp_dir: Path) -> dict:
        origin = temp_dir / "origin.jpg"
        ai1 = temp_dir / "ai-1.jpg"
        ai2 = temp_dir / "ai-2.png"
        for path in (origin, ai1, ai2):
            path.write_bytes(b"image")
        return {
            "batch_id": "batch-20260707",
            "status": "pending_approval",
            "created_at": "2026-07-07T10:00:00+08:00",
            "adapter_id": "tmall-ops-assistant",
            "task_id": "tmall_ai_image_test_chain",
            "task_run_uid": "run-123",
            "board_url": "http://127.0.0.1:18765/tmall-ai-image-approval/batch-20260707?token=local",
            "items": [
                {
                    "id": "item-1",
                    "row_no": 2,
                    "style_code": "208326100202",
                    "item_id": "1002178235142",
                    "category": "长袖T恤",
                    "gender": "中性",
                    "skc_code": "208326100202-00482",
                    "origin_path": str(origin),
                    "assets": [
                        {"id": "origin-1", "kind": "origin", "path": str(origin), "label": "原图/主图"},
                        {
                            "id": "ai-1",
                            "kind": "ai",
                            "path": str(ai1),
                            "label": "AI 图 1",
                            "prompt": "保留主商品",
                            "prompt_index": 1,
                            "generation_row": {"提示词版本": "v3", "prompt_version": "2026-07"},
                        },
                        {
                            "kind": "ai",
                            "path": str(ai2),
                            "label": "AI 图 2",
                            "prompt": "侧身展示",
                            "prompt_index": 2,
                        },
                    ],
                }
            ],
        }

    def test_build_cloud_batch_payload_includes_styles_assets_and_prompt_versions(self):
        with TemporaryDirectory() as temp:
            batch = self._local_batch(Path(temp))

            payload = build_cloud_batch_payload(batch)

        self.assertEqual(payload["batch_uid"], "batch-20260707")
        self.assertEqual(payload["task_run_uid"], "run-123")
        self.assertEqual(len(payload["styles"]), 1)
        self.assertEqual(payload["styles"][0]["style_code"], "208326100202")
        self.assertEqual(len(payload["assets"]), 3)
        prompts = {asset["asset_uid"]: asset for asset in payload["assets"]}
        self.assertEqual(prompts["ai-1"]["prompt"], "保留主商品")
        self.assertEqual(prompts["ai-1"]["prompt_version"], "2026-07")
        self.assertEqual(prompts["ai-1"]["prompt_version_label"], "v3")
        self.assertEqual(prompts["origin-1"]["kind"], "source")
        self.assertEqual(prompts["ai-1"]["kind"], "ai")

    def test_build_cloud_batch_payload_keeps_absolute_paths_outside_safe_metadata(self):
        with TemporaryDirectory() as temp:
            batch = self._local_batch(Path(temp))
            payload = build_cloud_batch_payload(batch)
            encoded = json.dumps(payload, ensure_ascii=False)

            self.assertNotIn(str(Path(temp)), encoded)
            for asset in payload["assets"]:
                self.assertNotIn("/", asset["metadata"]["source_path_label"])
                self.assertNotIn("\\", asset["metadata"]["source_path_label"])

    def test_sync_local_approval_batch_presigns_uploads_and_marks_complete(self):
        with TemporaryDirectory() as temp:
            batch = self._local_batch(Path(temp))
            client = FakeClient()

            result = sync_local_approval_batch(batch, client)

        self.assertEqual(result, {"ok": True, "batch_uid": "batch-20260707"})
        self.assertEqual(
            [(method, path) for method, path, _body, _token in client.calls],
            [
                ("POST", "/api/ai-image-batches"),
                ("POST", "/api/ai-image-batches/presign"),
                ("POST", "/api/ai-image-batches/sync-complete"),
            ],
        )
        self.assertEqual(len(client.uploads), 3)
        self.assertEqual(
            [upload[0] for upload in client.uploads],
            [
                "https://upload.example.com/origin-1",
                "https://upload.example.com/ai-1",
                f"https://upload.example.com/{client.calls[1][2]['assets'][2]['asset_uid']}",
            ],
        )
        complete_body = client.calls[-1][2]
        self.assertEqual(complete_body["batch_uid"], "batch-20260707")
        self.assertEqual(len(complete_body["assets"]), 3)


if __name__ == "__main__":
    unittest.main()
