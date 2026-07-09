import unittest
from pathlib import Path


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


if __name__ == "__main__":
    unittest.main()
