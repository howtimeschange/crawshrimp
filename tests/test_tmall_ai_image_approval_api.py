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


if __name__ == "__main__":
    unittest.main()
