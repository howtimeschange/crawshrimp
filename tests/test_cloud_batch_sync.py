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
        if path == "/api/ai-image-batches/sync":
            return {
                "ok": True,
                "batch": {"batch_uid": body["batch_uid"]},
                "styles": [
                    {
                        "id": 101 + index,
                        "style_id": 101 + index,
                        "style_uid": style["style_uid"],
                        "style_code": style["style_code"],
                        "item_id": style["item_id"],
                    }
                    for index, style in enumerate(body["styles"])
                ],
            }
        if path == "/api/assets/presign":
            return {
                "asset_uid": body["asset_uid"],
                "object_key": f"batches/{body['batch_uid']}/{body['kind']}/{body['asset_uid']}-{body['filename']}",
                "upload_url": f"/api/assets/upload/{body['asset_uid']}",
                "method": "PUT",
                "headers": {},
            }
        if path == "/api/ai-image-batches/batch-20260707/sync-complete":
            return {"ok": True, "status": "pending_review"}
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
                            "path": str(ai2).replace("/", "\\"),
                            "filename": "C:\\tmp\\ai-2.png",
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
        self.assertEqual(payload["title"], "batch-20260707")
        self.assertEqual(payload["task_run_uid"], "run-123")
        self.assertEqual(len(payload["styles"]), 1)
        self.assertEqual(payload["styles"][0]["style_code"], "208326100202")
        self.assertIsNone(payload["styles"][0]["style_id"])
        self.assertNotIn("assets", {key for key in payload.keys()})
        self.assertEqual(len(payload["styles"][0]["assets"]), 3)
        prompts = {asset["asset_uid"]: asset for asset in payload["styles"][0]["assets"]}
        self.assertEqual(prompts["ai-1"]["prompt"], "保留主商品")
        self.assertEqual(prompts["ai-1"]["prompt_text"], "保留主商品")
        self.assertEqual(prompts["ai-1"]["prompt_version"], "2026-07")
        self.assertEqual(prompts["ai-1"]["prompt_version_label"], "v3")
        self.assertEqual(prompts["origin-1"]["kind"], "source")
        self.assertEqual(prompts["ai-1"]["kind"], "ai")
        self.assertTrue(prompts["origin-1"]["content_hash"])
        self.assertEqual(payload["prompt_version_set"], [{"prompt_version": "2026-07", "label": "v3"}])

    def test_build_cloud_batch_payload_keeps_absolute_paths_outside_safe_metadata(self):
        with TemporaryDirectory() as temp:
            batch = self._local_batch(Path(temp))
            payload = build_cloud_batch_payload(batch)
            encoded = json.dumps(payload, ensure_ascii=False)

            self.assertNotIn(str(Path(temp)), encoded)
            for style in payload["styles"]:
                for asset in style["assets"]:
                    self.assertNotIn("/", asset["source_path_label"])
                    self.assertNotIn("\\", asset["source_path_label"])
                    self.assertNotIn("/", asset["meta"]["source_path_label"])
                    self.assertNotIn("\\", asset["meta"]["source_path_label"])

    def test_sync_local_approval_batch_presigns_uploads_and_marks_complete(self):
        with TemporaryDirectory() as temp:
            batch = self._local_batch(Path(temp))
            client = FakeClient()

            result = sync_local_approval_batch(batch, client)

        self.assertEqual(result["ok"], True)
        self.assertEqual(result["status"], "pending_review")
        self.assertEqual(len(result["assets"]), 2)
        self.assertEqual(
            [(method, path) for method, path, _body, _token in client.calls],
            [
                ("POST", "/api/ai-image-batches/sync"),
                ("POST", "/api/assets/presign"),
                ("POST", "/api/assets/presign"),
                ("POST", "/api/ai-image-batches/batch-20260707/sync-complete"),
            ],
        )
        self.assertEqual(len(client.uploads), 2)
        self.assertEqual(
            [upload[0] for upload in client.uploads],
            [
                "/api/assets/upload/origin-1",
                "/api/assets/upload/ai-1",
            ],
        )
        presign_body = client.calls[1][2]
        self.assertEqual(presign_body["batch_uid"], "batch-20260707")
        self.assertEqual(presign_body["style_id"], 101)
        self.assertEqual(presign_body["asset_uid"], "origin-1")
        self.assertNotIn("assets", presign_body)
        complete_body = client.calls[-1][2]
        self.assertEqual(complete_body["batch_uid"], "batch-20260707")
        self.assertEqual(len(complete_body["assets"]), 2)

    def test_sync_local_approval_batch_uses_worker_style_id_without_local_style_id(self):
        with TemporaryDirectory() as temp:
            batch = self._local_batch(Path(temp))
            client = FakeClient()

            result = sync_local_approval_batch(batch, client)

        self.assertEqual(result["ok"], True)
        self.assertEqual(len(client.uploads), 2)
        self.assertEqual(
            [(method, path) for method, path, _body, _token in client.calls],
            [
                ("POST", "/api/ai-image-batches/sync"),
                ("POST", "/api/assets/presign"),
                ("POST", "/api/assets/presign"),
                ("POST", "/api/ai-image-batches/batch-20260707/sync-complete"),
            ],
        )
        self.assertEqual(client.calls[1][2]["style_id"], 101)


if __name__ == "__main__":
    unittest.main()
