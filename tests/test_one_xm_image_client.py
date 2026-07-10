import tempfile
import unittest
from pathlib import Path

from core.one_xm_image import OneXMImageClient, file_to_data_url, run_image_task_until_done


class FakeTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, method, url, headers=None, body=None, timeout=30):
        self.calls.append({
            "method": method,
            "url": url,
            "headers": dict(headers or {}),
            "body": body,
            "timeout": timeout,
        })
        if not self.responses:
            raise AssertionError("No fake response left")
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class OneXMImageClientTests(unittest.TestCase):
    def test_create_and_poll_async_task_until_image_url_is_ready(self):
        transport = FakeTransport([
            (202, {
                "id": "task_1",
                "status": "queued",
                "poll_url": "https://api.1xm.ai/v1/images/tasks/task_1",
                "poll_after": 0,
            }),
            (200, {"id": "task_1", "status": "running", "poll_after": 0}),
            (200, {
                "id": "task_1",
                "status": "succeeded",
                "data": [{"url": "https://img.1xm.ai/generated/task_1_0.png"}],
            }),
        ])
        client = OneXMImageClient("unit-key", transport=transport)

        result = run_image_task_until_done(
            client,
            {"model": "gpt-image-2", "prompt": "测试", "size": "1024x1024", "n": 1},
            idempotency_key="order_1",
            poll_timeout_seconds=30,
            sleep_fn=lambda _seconds: None,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["task_id"], "task_1")
        self.assertEqual(result["image_urls"], ["https://img.1xm.ai/generated/task_1_0.png"])
        self.assertEqual(transport.calls[0]["method"], "POST")
        self.assertEqual(transport.calls[0]["headers"]["Authorization"], "Bearer unit-key")
        self.assertEqual(transport.calls[0]["headers"]["Idempotency-Key"], "order_1")
        self.assertEqual(transport.calls[1]["method"], "GET")

    def test_non_ascii_idempotency_key_is_normalized_for_http_headers(self):
        transport = FakeTransport([
            (202, {
                "id": "task_1",
                "status": "succeeded",
                "data": [{"url": "https://img.1xm.ai/generated/task_1_0.png"}],
            }),
        ])
        client = OneXMImageClient("unit-key", transport=transport)

        result = run_image_task_until_done(
            client,
            {"model": "gpt-image-2", "prompt": "测试", "size": "1024x1024", "n": 1},
            idempotency_key="tmall_ai_上装_正面标准站姿",
            poll_timeout_seconds=30,
            sleep_fn=lambda _seconds: None,
        )

        key = transport.calls[0]["headers"]["Idempotency-Key"]
        self.assertTrue(result["ok"])
        self.assertNotIn("上装", key)
        key.encode("ascii")

    def test_success_status_extracts_nested_platform_result_urls(self):
        transport = FakeTransport([
            (202, {
                "id": 9288,
                "task_id": "task_success",
                "status": "SUCCESS",
                "result_url": "https://img.1xm.ai/generated/task_success_0.png",
                "data": {
                    "data": [
                        {"url": "https://img.1xm.ai/generated/task_success_0.png"},
                        {"url": "https://img.1xm.ai/generated/task_success_1.png"},
                    ],
                },
            }),
        ])
        client = OneXMImageClient("unit-key", transport=transport)

        result = run_image_task_until_done(
            client,
            {"model": "gpt-image-2", "prompt": "测试", "size": "1024x1024", "n": 2},
            idempotency_key="order_success",
            poll_timeout_seconds=30,
            sleep_fn=lambda _seconds: None,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["task_id"], "task_success")
        self.assertEqual(result["image_urls"], [
            "https://img.1xm.ai/generated/task_success_0.png",
            "https://img.1xm.ai/generated/task_success_1.png",
        ])

    def test_failed_task_is_compensated_with_new_idempotency_key(self):
        transport = FakeTransport([
            (202, {
                "id": "task_failed",
                "status": "queued",
                "poll_url": "https://api.1xm.ai/v1/images/tasks/task_failed",
                "poll_after": 0,
            }),
            (200, {
                "id": "task_failed",
                "status": "failed",
                "error": {"message": "upstream timeout"},
            }),
            (202, {
                "id": "task_retry",
                "status": "queued",
                "poll_url": "https://api.1xm.ai/v1/images/tasks/task_retry",
                "poll_after": 0,
            }),
            (200, {
                "id": "task_retry",
                "status": "succeeded",
                "data": [{"url": "https://img.1xm.ai/generated/task_retry_0.png"}],
            }),
        ])
        client = OneXMImageClient("unit-key", transport=transport)

        result = run_image_task_until_done(
            client,
            {"model": "gpt-image-2", "prompt": "测试", "size": "1024x1024", "n": 1},
            idempotency_key="order_2",
            task_attempts=2,
            poll_timeout_seconds=30,
            sleep_fn=lambda _seconds: None,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["task_id"], "task_retry")
        self.assertEqual(result["compensation_attempts"], 1)
        post_keys = [
            call["headers"]["Idempotency-Key"]
            for call in transport.calls
            if call["method"] == "POST"
        ]
        self.assertEqual(post_keys, ["order_2", "order_2-retry2"])

    def test_file_to_data_url_uses_image_mime_type(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            image_path = Path(tmpdir) / "source.png"
            image_path.write_bytes(b"\x89PNG\r\n\x1a\n")

            value = file_to_data_url(str(image_path))

        self.assertTrue(value.startswith("data:image/png;base64,"))


if __name__ == "__main__":
    unittest.main()
