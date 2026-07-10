import asyncio
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from core import api_server


API_SERVER_PATH = Path("core/api_server.py")

class TmallAiImageApprovalApiTests(unittest.TestCase):
    def test_approval_board_routes_are_public_but_token_checked(self):
        source = API_SERVER_PATH.read_text(encoding="utf-8")

        self.assertIn('"/tmall-ai-image-approval/"', source)
        self.assertIn("def _validate_tmall_approval_token", source)
        self.assertIn("hmac.compare_digest", source)
        self.assertIn('@app.get("/tmall-ai-image-approval/{batch_id}")', source)
        self.assertIn('@app.post("/tmall-ai-image-approval/api/{batch_id}/submit")', source)
        self.assertIn('@app.post("/tmall-ai-image-approval/api/{batch_id}/generate")', source)
        self.assertIn('@app.post("/tmall-ai-image-approval/api/{batch_id}/submit-generation")', source)
        self.assertIn("TmallApprovalGenerationConfirmRequest", source)
        self.assertIn("def _safe_tmall_approval_paths", source)

    def test_cloud_prompt_library_routes_proxy_to_cloud_approval_workbench(self):
        source = API_SERVER_PATH.read_text(encoding="utf-8")

        self.assertIn('@app.get("/cloud-approval/prompt-libraries")', source)
        self.assertIn('@app.get("/cloud-approval/prompt-libraries/{library_id}/resolved")', source)
        self.assertIn("def _cloud_prompt_libraries", source)
        self.assertIn("def _cloud_prompt_templates", source)
        self.assertIn("def _cloud_prompt_library_export", source)
        self.assertIn('/api/prompt-libraries/{library_id}/resolved', source)
        self.assertIn('/api/prompt-libraries/{library_id}/export', source)
        self.assertIn('token_type="machine"', source)

    def test_ai_image_chain_accepts_cloud_prompt_library_source(self):
        source = API_SERVER_PATH.read_text(encoding="utf-8")

        self.assertIn('prompt_source = _normalize_prompt_source', source)
        self.assertIn('cloud_prompt_library_id', source)
        self.assertIn('_cloud_prompt_library_export(cloud_prompt_library_id)', source)
        self.assertIn('cloud_prompt_templates_json', source)
        self.assertIn('缺少云端 Prompt 库', source)
        self.assertIn('缺少 AI 测图提示词库文件', source)

    def test_ai_image_chain_uses_embedded_local_prompt_templates_without_cloud_export(self):
        payload = '{"templates":[{"field_name":"正面图","prompt_text":"本地 Prompt"}]}'

        with patch.object(api_server, "_cloud_prompt_library_export") as cloud_export:
            library_id, templates_json = api_server._tmall_ai_image_prompt_library_params({
                "cloud_prompt_library_id": "local:local-1",
                "cloud_prompt_library_source": "local",
                "cloud_prompt_templates_json": payload,
            })

        self.assertEqual(library_id, "local:local-1")
        self.assertEqual(templates_json, payload)
        cloud_export.assert_not_called()

    def test_submit_route_registers_excel_result_as_task_output(self):
        source = API_SERVER_PATH.read_text(encoding="utf-8")

        self.assertIn('result_path = str(result.get("excel_path") or result.get("result_path") or "").strip()', source)
        self.assertIn('"result_excel_path": result_path', source)
        self.assertIn('"audit_result_path": audit_path', source)
        self.assertIn('summary_files = list(summary.get("output_files") or [])', source)
        self.assertIn('kind=_task_instance_artifact_kind(result_path)', source)
        self.assertNotIn('kind="file",\n                label=Path(str(result.get("result_path"))).name', source)

    def test_submit_route_updates_instance_summary_with_excel_output(self):
        updates = []
        artifacts = []
        module = SimpleNamespace(upload_approved_tmall_batch=AsyncMock(return_value={
            "ok": True,
            "status": "created",
            "attempted": 1,
            "succeeded": 1,
            "failed": 0,
            "submitted": 1,
            "result_path": "/tmp/result.xlsx",
            "excel_path": "/tmp/result.xlsx",
            "audit_path": "/tmp/audit.json",
            "rows": [{"阶段": "天猫上传/创建测图任务"}],
        }))

        def capture_update(instance_uid, **kwargs):
            updates.append({"instance_uid": instance_uid, **kwargs})
            return {}

        def capture_artifact(instance_uid, **kwargs):
            artifacts.append({"instance_uid": instance_uid, **kwargs})
            return {}

        with patch.object(api_server, "_load_tmall_approval_batch", return_value={"batch_id": "batch-x"}), \
            patch.object(api_server, "_validate_tmall_approval_token", return_value=None), \
            patch.object(api_server, "_load_tmall_ai_image_chain_module", return_value=module), \
            patch.object(api_server.data_sink, "find_task_instance_by_approval_batch_id", return_value={
                "instance_uid": "instance-x",
                "summary_json": '{"output_files":["http://127.0.0.1:18767/tmall-ai-image-approval/batch-x?token=t"]}',
            }), \
            patch.object(api_server.data_sink, "update_task_instance", side_effect=capture_update), \
            patch.object(api_server.data_sink, "add_task_instance_artifact", side_effect=capture_artifact):
            result = asyncio.run(api_server.submit_tmall_ai_image_approval_batch("batch-x", token="t"))

        self.assertEqual(result["result_path"], "/tmp/result.xlsx")
        self.assertEqual(len(updates), 1)
        summary = updates[0]["summary"]
        self.assertEqual(summary["result_path"], "/tmp/result.xlsx")
        self.assertEqual(summary["result_excel_path"], "/tmp/result.xlsx")
        self.assertEqual(summary["audit_result_path"], "/tmp/audit.json")
        self.assertIn("/tmp/result.xlsx", summary["output_files"])
        self.assertEqual(len(artifacts), 1)
        self.assertEqual(artifacts[0]["kind"], "excel")
        self.assertEqual(artifacts[0]["label"], "result.xlsx")
        self.assertEqual(artifacts[0]["path"], "/tmp/result.xlsx")

    def test_submit_generation_route_accepts_background_generation(self):
        updates = []
        scheduled = []
        prepared_batch = {
            "batch_id": "batch-generate",
            "status": "generating",
            "items": [{"id": "item-1", "assets": [{"id": "ai-loading", "kind": "ai", "status": "generating", "placeholder": True}]}],
            "submit_progress": {"status": "running", "total": 1, "image_total": 2},
        }
        module = SimpleNamespace(
            update_generation_confirmation=lambda batch, items: {**batch, "items": items},
            prepare_generation_confirmation_placeholders=lambda batch: prepared_batch,
        )

        def capture_update(instance_uid, **kwargs):
            updates.append({"instance_uid": instance_uid, **kwargs})
            return {}

        def capture_task(coro):
            scheduled.append(coro)
            coro.close()
            return None

        with patch.object(api_server, "_load_tmall_approval_batch", return_value={"batch_id": "batch-generate", "token": "t"}), \
            patch.object(api_server, "_validate_tmall_approval_token", return_value=None), \
            patch.object(api_server, "_load_tmall_ai_image_chain_module", return_value=module), \
            patch.object(api_server, "_safe_tmall_generation_confirmation_items", return_value=[{"id": "item-1"}]), \
            patch.object(api_server.asyncio, "create_task", side_effect=capture_task), \
            patch.object(api_server.data_sink, "find_task_instance_by_approval_batch_id", return_value={
                "instance_uid": "instance-generate",
                "summary_json": "{}",
            }), \
            patch.object(api_server.data_sink, "update_task_instance", side_effect=capture_update):
            result = asyncio.run(api_server.submit_tmall_ai_image_generation_confirmation(
                "batch-generate",
                api_server.TmallApprovalGenerationConfirmRequest(items=[{"id": "item-1"}]),
                token="t",
            ))

        self.assertTrue(result["accepted"])
        self.assertEqual(result["status"], "generating")
        self.assertEqual(result["batch"]["items"][0]["assets"][0]["status"], "generating")
        self.assertEqual(len(scheduled), 1)
        self.assertEqual(updates[0]["status"], "running")
        self.assertEqual(updates[0]["current_step"], "approval")


if __name__ == "__main__":
    unittest.main()
