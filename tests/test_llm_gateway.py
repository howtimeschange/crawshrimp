import asyncio
import json
import os
import socket
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from openpyxl import load_workbook

from core import api_server, data_sink, llm_gateway, runtime_paths


def valid_scripts():
    return {
        "scripts": [
            {
                "guang_title": "爱跑跳男童春日轻运动鞋透气好穿上学户外日常都方便",
                "recommend_title": "男童春日轻运动鞋透气上学户外日常",
                "video_description": "家有爱跑爱跳男孩的家长看这里，鞋面透气孔洞是第一眼重点，旋钮扣方便孩子自己穿脱，宽敞鞋头给日常活动留出空间。正在给幼儿园和小学男生挑春秋运动鞋的家庭，可以重点看看这双。",
            },
            {
                "guang_title": "小童日常跑跳鞋旋钮穿脱省心上学户外活动每天都适合",
                "recommend_title": "小童日常跑跳鞋旋钮穿脱省心上学户外",
                "video_description": "幼儿园男孩每天跑跳多，选鞋先看穿脱和脚感。这双鞋用旋钮扣减少反复系带，鞋头空间更从容，再加上撞色生肖造型，日常上学和户外活动都好搭。想给活泼小男孩准备运动鞋的家长可以看看。",
            },
            {
                "guang_title": "男孩春秋运动鞋透气旋钮扣设计跑跳日常搭配省心好穿",
                "recommend_title": "男孩春秋运动鞋透气旋钮扣日常好穿",
                "video_description": "给三到六岁男孩选春秋鞋，先看透气，再看穿脱，最后看日常搭配。图片里的孔洞鞋面、旋钮扣和立体生肖元素分别照顾到跑跳、独立穿鞋和孩子喜欢的造型。正在挑男童慢跑鞋的家长别错过。",
            },
        ]
    }


class LlmGatewayTests(unittest.TestCase):
    def config(self):
        return {
            "ai": {
                "llm": {
                    "api_key": "unit-key",
                    "overseas_openai_base_url": "https://openai.example/v1",
                    "overseas_anthropic_base_url": "https://anthropic.example",
                    "domestic_base_url": "https://domestic.example/v1",
                    "default_model": "gpt-5.6-terra",
                }
            }
        }

    def test_model_routes_match_protocol_and_region(self):
        overseas = llm_gateway.route_for_model("gemini-3.5-flash", self.config())
        anthropic = llm_gateway.route_for_model("claude-sonnet-5", self.config())
        domestic = llm_gateway.route_for_model("deepseek-v4-pro", self.config())

        self.assertEqual(overseas.protocol, "openai")
        self.assertEqual(overseas.base_url, "https://openai.example/v1")
        self.assertEqual(anthropic.protocol, "anthropic")
        self.assertEqual(anthropic.base_url, "https://anthropic.example")
        self.assertEqual(domestic.protocol, "openai")
        self.assertEqual(domestic.base_url, "https://domestic.example/v1")

    def test_runtime_environment_key_can_be_used_without_persisting_it_in_config(self):
        config = self.config()
        config["ai"]["llm"]["api_key"] = ""
        with patch.dict(os.environ, {"CRAWSHRIMP_LLM_API_KEY": "runtime-only-key"}):
            route = llm_gateway.route_for_model("qwen3.8-max-preview", config)
        self.assertEqual(route.api_key, "runtime-only-key")

    def test_response_validation_rejects_price_or_promotional_benefits(self):
        payload = valid_scripts()
        payload["scripts"][0]["video_description"] += "现在领券更优惠。"
        with self.assertRaisesRegex(llm_gateway.LlmResponseError, "促销利益点"):
            llm_gateway.normalize_video_copies(payload)

    def test_response_validation_rejects_titles_that_are_too_short(self):
        payload = valid_scripts()
        payload["scripts"][0]["guang_title"] = "男童运动鞋透气好穿"
        payload["scripts"][0]["recommend_title"] = "男童运动鞋"
        with self.assertRaisesRegex(llm_gateway.LlmResponseError, "没有接近"):
            llm_gateway.normalize_video_copies(payload)

    def test_generation_retries_once_after_invalid_model_json(self):
        calls = []

        def fake_openai(route, title, images, correction):
            calls.append(correction)
            payload = {"scripts": []} if not correction else valid_scripts()
            return {"choices": [{"message": {"content": __import__("json").dumps(payload, ensure_ascii=False)}}]}

        copies, route = llm_gateway.generate_video_copies(
            product_title="巴拉巴拉童鞋儿童运动鞋男童透气跑步鞋",
            image_urls=["https://img.example/1.jpg"],
            model_id="gpt-5.6-terra",
            config=self.config(),
            request_openai=fake_openai,
        )

        self.assertEqual(route.model_id, "gpt-5.6-terra")
        self.assertEqual(len(copies), 3)
        self.assertEqual(len(calls), 2)
        self.assertIn("3个视频方案", calls[1])

    def test_generation_retries_transient_gateway_errors(self):
        calls = []

        def fake_openai(route, title, images, correction):
            calls.append(correction)
            if len(calls) == 1:
                raise llm_gateway.LlmGatewayError(
                    "文本模型接口连接失败：Remote end closed connection without response"
                )
            return {"choices": [{"message": {"content": __import__("json").dumps(valid_scripts(), ensure_ascii=False)}}]}

        copies, route = llm_gateway.generate_video_copies(
            product_title="巴拉巴拉童鞋儿童运动鞋男童透气跑步鞋",
            image_urls=["https://img.example/1.jpg"],
            model_id="gpt-5.6-terra",
            config=self.config(),
            request_openai=fake_openai,
            retry_sleep=lambda _: None,
        )

        self.assertEqual(route.model_id, "gpt-5.6-terra")
        self.assertEqual(len(copies), 3)
        self.assertEqual(len(calls), 2)

    def test_generic_multimodal_json_uses_local_images_with_domestic_qwen_route(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            image_path = Path(tmpdir) / "shoe.jpg"
            image_path.write_bytes(b"\xff\xd8\xff\xdbfake-jpeg")
            calls = []

            def fake_openai(route, system_prompt, user_prompt, images):
                calls.append((route, system_prompt, user_prompt, images))
                return {
                    "choices": [{
                        "message": {
                            "content": '{"shoe_category":"运动","slots":{"o":"GD005292.jpg"}}'
                        }
                    }]
                }

            payload, route = llm_gateway.generate_multimodal_json(
                system_prompt="识别鞋品姿势",
                user_prompt="只返回 JSON",
                image_inputs=[str(image_path)],
                model_id="qwen3.8-max-preview",
                config=self.config(),
                request_openai=fake_openai,
            )

        self.assertEqual(route.model_id, "qwen3.8-max-preview")
        self.assertEqual(payload["shoe_category"], "运动")
        self.assertEqual(payload["slots"]["o"], "GD005292.jpg")
        self.assertEqual(calls[0][1:3], ("识别鞋品姿势", "只返回 JSON"))
        self.assertTrue(calls[0][3][0].startswith("data:image/jpeg;base64,"))

    def test_generic_multimodal_json_uses_anthropic_messages_route(self):
        calls = []

        def fake_anthropic(route, system_prompt, user_prompt, images):
            calls.append((route, system_prompt, user_prompt, images))
            return {"content": [{"type": "text", "text": '{"ok":true}'}]}

        payload, route = llm_gateway.generate_multimodal_json(
            system_prompt="识别鞋品姿势",
            user_prompt="只返回 JSON",
            image_inputs=["data:image/png;base64,iVBORw0KGgo="],
            model_id="claude-sonnet-5",
            config=self.config(),
            request_anthropic=fake_anthropic,
        )

        self.assertEqual(payload, {"ok": True})
        self.assertEqual(route.model_id, "claude-sonnet-5")
        self.assertEqual(route.protocol, "anthropic")
        self.assertEqual(calls[0][1:3], ("识别鞋品姿势", "只返回 JSON"))
        self.assertTrue(calls[0][3][0].startswith("data:image/png;base64,"))

    def test_generic_multimodal_json_retries_once_after_transient_gateway_error(self):
        calls = []

        def flaky_openai(route, system_prompt, user_prompt, images):
            calls.append(route.model_id)
            if len(calls) == 1:
                raise llm_gateway.LlmGatewayError("文本模型接口连接失败：timed out")
            return {"choices": [{"message": {"content": '{"ok":true}'}}]}

        payload, _route = llm_gateway.generate_multimodal_json(
            system_prompt="识别鞋品姿势",
            user_prompt="只返回 JSON",
            image_inputs=["data:image/jpeg;base64,/9j/2Q=="],
            model_id="qwen3.8-max-preview",
            config=self.config(),
            request_openai=flaky_openai,
        )

        self.assertEqual(payload, {"ok": True})
        self.assertEqual(len(calls), 2)

    def test_generic_multimodal_json_switches_to_fallback_model_after_timeout(self):
        calls = []

        def flaky_openai(route, system_prompt, user_prompt, images):
            calls.append(route.model_id)
            if route.model_id == "qwen3.8-max-preview":
                raise llm_gateway.LlmGatewayError("文本模型接口连接失败：timed out")
            return {"choices": [{"message": {"content": '{"ok":true}'}}]}

        payload, route = llm_gateway.generate_multimodal_json(
            system_prompt="识别鞋品姿势",
            user_prompt="只返回 JSON",
            image_inputs=["data:image/jpeg;base64,/9j/2Q=="],
            model_id="qwen3.8-max-preview",
            fallback_model_ids=["qwen3.7-plus"],
            config=self.config(),
            request_openai=flaky_openai,
        )

        self.assertEqual(payload, {"ok": True})
        self.assertEqual(route.model_id, "qwen3.7-plus")
        self.assertEqual(calls, ["qwen3.8-max-preview", "qwen3.7-plus"])

    def test_post_json_enforces_total_deadline_when_response_keeps_dripping_bytes(self):
        payload = json.dumps({"ok": True}).encode("utf-8")

        class SlowDripHandler(BaseHTTPRequestHandler):
            def do_POST(self):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                for byte in payload:
                    try:
                        self.wfile.write(bytes([byte]))
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError, socket.timeout):
                        break
                    time.sleep(0.05)

            def log_message(self, _format, *_args):
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), SlowDripHandler)
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        started = time.monotonic()
        try:
            with self.assertRaisesRegex(llm_gateway.LlmGatewayError, "总时长"):
                llm_gateway._post_json(
                    f"http://127.0.0.1:{server.server_port}/slow",
                    {"ping": True},
                    {},
                    timeout=0.1,
                    total_timeout=0.2,
                )
        finally:
            server.shutdown()
            server.server_close()
            server_thread.join(timeout=1)

        self.assertLess(time.monotonic() - started, 1.0)


class TmallVideoCopyPostProcessTests(unittest.IsolatedAsyncioTestCase):
    async def test_backend_expands_each_product_to_three_template_rows(self):
        source = [{
            "款号": "204125140101",
            "ID": "850170525107",
            "__generate_video_copy": True,
            "__product_title": "巴拉巴拉童鞋儿童运动鞋男童透气跑步鞋",
            "__main_image_urls": [f"https://img.example/{index}.jpg" for index in range(5)],
        }]
        waits = []

        with patch.object(
            llm_gateway,
            "generate_video_copies",
            return_value=(llm_gateway.normalize_video_copies(valid_scripts()), llm_gateway.LlmRoute(
                model_id="gpt-5.6-terra",
                protocol="openai",
                base_url="https://openai.example/v1",
                api_key="unit-key",
            )),
        ):
            rows = await api_server._apply_video_copy_generation(
                source,
                {"model_id": "gpt-5.6-terra", "generation_concurrency": 2},
                lambda payload=None: asyncio.sleep(0, result=waits.append(payload)),
                lambda _: None,
            )

        self.assertEqual(len(rows), 3)
        self.assertEqual({row["款号"] for row in rows}, {"204125140101"})
        self.assertTrue(all(row["ID"] == "850170525107" for row in rows))
        self.assertTrue(all(row["逛逛标题"] and row["搜推标题"] and row["视频描述"] for row in rows))
        self.assertTrue(waits)

    async def test_backend_uses_evaluated_default_model_when_omitted(self):
        source = [{
            "款号": "204125140101",
            "ID": "850170525107",
            "__generate_video_copy": True,
            "__product_title": "巴拉巴拉童鞋儿童运动鞋男童透气跑步鞋",
            "__main_image_urls": [f"https://img.example/{index}.jpg" for index in range(5)],
        }]
        logs = []

        with patch.object(
            llm_gateway,
            "generate_video_copies",
            return_value=(llm_gateway.normalize_video_copies(valid_scripts()), llm_gateway.LlmRoute(
                model_id="gpt-5.6-terra",
                protocol="openai",
                base_url="https://openai.example/v1",
                api_key="unit-key",
            )),
        ) as generate:
            rows = await api_server._apply_video_copy_generation(
                source,
                {},
                lambda payload=None: asyncio.sleep(0),
                logs.append,
            )

        self.assertEqual(len(rows), 3)
        self.assertEqual(generate.call_args.kwargs["model_id"], "gpt-5.6-terra")
        self.assertTrue(any("准备使用 gpt-5.6-terra" in item for item in logs))

    async def test_final_workbook_matches_batch_upload_headers_and_text_ids(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            with patch.object(runtime_paths, "data_root", return_value=root):
                workbook_path = Path(data_sink.export_excel(
                    [{
                        "款号": "204125140101",
                        "ID": "850170525107",
                        "逛逛标题": "爱跑跳男童春日轻运动鞋透气好穿上学户外日常都方便",
                        "搜推标题": "男童春日轻运动鞋透气上学户外日常",
                        "视频描述": valid_scripts()["scripts"][0]["video_description"],
                        "参与活动": "",
                        "定时/日": "",
                        "定时/具体时间": "",
                        "上传情况": "",
                        "内容ID": "",
                    }],
                    "bala-ai-video-assistant",
                    "tmall_video_copy_generate",
                    "result.xlsx",
                    column_order=["款号", "ID", "逛逛标题", "搜推标题", "视频描述", "参与活动", "定时/日", "定时/具体时间", "上传情况", "内容ID"],
                ))
            final_refs = api_server._finalize_bala_ai_video_assistant_outputs(
                task_id="tmall_video_copy_generate",
                data_rows=[],
                runtime_files=[],
                exported_files=[str(workbook_path)],
                run_params={},
                runtime_artifact_dir=str(root / "runtime"),
                log=lambda _: None,
            )
            self.assertEqual(final_refs, [str(workbook_path)])

            workbook = load_workbook(workbook_path)
            sheet = workbook.active
            try:
                self.assertEqual(
                    [cell.value for cell in sheet[1]],
                    ["款号", "ID", "逛逛标题", "搜推标题", "视频描述", "参与活动", "定时/日", "定时/具体时间", "上传情况", "内容ID"],
                )
                self.assertEqual(sheet["B2"].value, "850170525107")
                self.assertEqual(sheet["B2"].number_format, "@")
                self.assertEqual(sheet["A1"].fill.fgColor.rgb, "00FFFF00")
            finally:
                workbook.close()


if __name__ == "__main__":
    unittest.main()
