import base64
import json
import os
import unittest
from unittest.mock import patch

from core import ai_video_generation_service as svc


SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
NONCE = bytes.fromhex("000102030405060708090a0b")
TOKEN = (
    "avcap2.AAECAwQFBgcICQoL."
    "-ibsPzzVDirxoqd3VYWApiGgcZz30ll-x6ri72fxEG8zvv1EWpqf_G8p5IZ_MyOLcmlczwsx0NiFXXoOIF8t9hjuW_1dmhQ22Q5OKaGbC-nyIlGqXcopANuaG8PcNbNA71P4Y7_F5u3vng"
)
PAYLOAD = {
    "v": 2,
    "kind": "file",
    "scope": "input",
    "path": "/tmp/reference.jpg",
    "issuedAt": 1_750_000_000_000,
}


class AiVideoCapabilityCryptoTests(unittest.TestCase):
    def setUp(self):
        capability_env = patch.dict(
            os.environ,
            {"CRAWSHRIMP_AI_VIDEO_CAPABILITY_SECRET": SECRET},
        )
        capability_env.start()
        self.addCleanup(capability_env.stop)

    def test_python_matches_node_aes_gcm_interop_vector(self):
        token = svc._encrypt_path_capability_payload(PAYLOAD, nonce=NONCE)

        self.assertEqual(token, TOKEN)
        self.assertEqual(svc._decrypt_path_capability_payload(TOKEN), PAYLOAD)

    def test_encrypted_token_segments_do_not_reveal_the_absolute_path(self):
        token = svc._encrypt_path_capability_payload(PAYLOAD, nonce=NONCE)

        self.assertNotIn(PAYLOAD["path"], token)
        for segment in token.split(".")[1:]:
            padded = segment + "=" * (-len(segment) % 4)
            decoded = base64.urlsafe_b64decode(padded.encode("ascii"))
            self.assertNotIn(PAYLOAD["path"].encode("utf-8"), decoded)

    def test_legacy_cleartext_capability_is_rejected(self):
        legacy_payload = base64.urlsafe_b64encode(
            json.dumps({**PAYLOAD, "v": 1, "nonce": "legacy"}, separators=(",", ":")).encode("utf-8")
        ).decode("ascii").rstrip("=")

        with self.assertRaises(svc.AiVideoError) as captured:
            svc._decrypt_path_capability_payload(f"avcap1.{legacy_payload}.legacy-signature")

        self.assertEqual(captured.exception.code, "PATH_CAPABILITY_INVALID")


if __name__ == "__main__":
    unittest.main()
