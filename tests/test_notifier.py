import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from core import notifier


class NotifierConditionTests(unittest.TestCase):
    def test_should_notify_supports_basic_data_length_condition(self):
        self.assertTrue(notifier.should_notify("data.length > 0", [{"id": 1}]))
        self.assertFalse(notifier.should_notify("data.length > 1", [{"id": 1}]))
        self.assertTrue(notifier.should_notify("data.length >= 1 && data.length < 3", [{"id": 1}]))
        self.assertFalse(notifier.should_notify("data.length > 1 || data.length == 0", [{"id": 1}]))
        self.assertTrue(notifier.should_notify("data.length > 1 || data.length == 1", [{"id": 1}]))
        self.assertFalse(notifier.should_notify("data.length > 1 && data.length < 3 || data.length == 1", [{}, {}, {}, {}]))

    def test_should_notify_does_not_execute_python_expressions(self):
        class Trap:
            touched = False

        notifier.should_notify("setattr(data[0], 'touched', True) or True", [Trap])

        self.assertFalse(Trap.touched)

    def test_dingtalk_webhook_appends_timestamp_and_sign_when_secret_is_configured(self):
        captured = {}

        def fake_post(url, payload):
            captured["url"] = url
            captured["payload"] = payload
            return {"errcode": 0}

        def fake_cfg_get(key, default=""):
            values = {
                "notify.dingtalk_webhook": "https://oapi.dingtalk.com/robot/send?access_token=unit-token",
                "notify.dingtalk_secret": "unit-secret",
            }
            return values.get(key, default)

        with patch.object(notifier, "cfg_get", side_effect=fake_cfg_get), \
            patch.object(notifier.time, "time", return_value=1710000000.123), \
            patch.object(notifier, "_post_json", side_effect=fake_post):
            notifier._send_dingtalk(
                "审批待处理",
                2,
                "天猫运营助手",
                "巴拉-AI测图全链路",
                [{"审批看板": "http://127.0.0.1:18765/tmall-ai-image-approval/batch"}],
                None,
                "请审批",
            )

        parsed = urlparse(captured["url"])
        query = parse_qs(parsed.query)
        self.assertEqual(query["access_token"], ["unit-token"])
        self.assertEqual(query["timestamp"], ["1710000000123"])
        self.assertTrue(query["sign"][0])
        self.assertEqual(captured["payload"]["msgtype"], "markdown")


if __name__ == "__main__":
    unittest.main()
