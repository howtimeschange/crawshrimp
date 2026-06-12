import unittest
from unittest.mock import patch

from core.cdp_bridge import CDPBridge


class DummyResponse:
    def __init__(self, payload: bytes = b'{"id":"tab-1","type":"page"}'):
        self.payload = payload

    def read(self):
        return self.payload


class CDPBridgeTests(unittest.TestCase):
    def test_new_tab_encodes_full_target_url_query(self):
        target_url = (
            "https://www.temu.com/de-en/example-g-606106067809179.html"
            "?_oak_mp_inf=EJvn%2BIaB"
            "&top_gallery_url=https%3A%2F%2Fimg.kwcdn.com%2Fproduct%2Fopen%2Fgoods.jpeg"
            "&refer_page_name=goods"
        )

        with patch("core.cdp_bridge.cdp_urlopen", return_value=DummyResponse()) as mocked_open:
            bridge = CDPBridge("http://127.0.0.1:9222")
            bridge.new_tab(target_url)

        request = mocked_open.call_args.args[0]
        request_url = request.full_url
        self.assertIn("%26top_gallery_url%3Dhttps%253A%252F%252Fimg.kwcdn.com", request_url)
        self.assertIn("%26refer_page_name%3Dgoods", request_url)
        self.assertNotIn("&top_gallery_url=", request_url)


if __name__ == "__main__":
    unittest.main()
