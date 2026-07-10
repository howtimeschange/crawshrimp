import importlib.util
import asyncio
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SCRIPT_PATH = Path("adapters/tmall-ops-assistant/tools/run_tmall_ai_image_test_chain.py").resolve()


def load_script():
    spec = importlib.util.spec_from_file_location("tmall_ai_image_chain", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


async def noop_wait_for_tmall_ready(*_args, **_kwargs):
    return None


class TmallAiImageChainScriptTests(unittest.TestCase):
    def test_chain_execution_modes_are_approval_or_direct_create_only(self):
        module = load_script()

        self.assertEqual(
            module.CHAIN_EXECUTION_MODES,
            ("approval_then_create", "direct_create"),
        )
        approval = module.normalize_chain_execution_mode("approval_then_create")
        direct = module.normalize_chain_execution_mode("direct_create")

        self.assertFalse(approval["generate"])
        self.assertTrue(approval["confirm_generation"])
        self.assertTrue(approval["approval_required"])
        self.assertFalse(approval["live_upload"])
        self.assertFalse(approval["live_create"])
        self.assertTrue(direct["generate"])
        self.assertFalse(direct["confirm_generation"])
        self.assertFalse(direct["approval_required"])
        self.assertTrue(direct["live_upload"])
        self.assertTrue(direct["live_create"])
        with self.assertRaises(ValueError):
            module.normalize_chain_execution_mode("generate")

    def test_generation_defaults_use_large_three_four_gpt_4k(self):
        module = load_script()

        args = module.build_parser().parse_args([])
        defaults = module.approval_generation_defaults({"run_params": {}}, {"assets": []})

        self.assertEqual(args.image_size, "1536x2048")
        self.assertEqual(args.one_xm_key_tier, "4k")
        self.assertEqual(defaults["image_size"], "1536x2048")
        self.assertEqual(defaults["ratio"], "3:4")
        self.assertEqual(defaults["model"], "gpt-image-2")
        self.assertEqual(defaults["one_xm_key_tier"], "4k")

    def test_approval_item_preserves_reference_and_ai_display_order(self):
        module = load_script()
        workflow = module.WorkflowItem(2, "208326100202", "1002178235142", "长袖T恤", "中性")

        item = module.build_approval_item(
            workflow,
            {"chosenMain": {"filename": "橱窗1.jpg"}, "chosenDetail": {"filename": "208326100202-00482.jpg"}},
            "/tmp/main.jpg",
            "/tmp/flat.jpg",
            [
                {"提示词序号": 1, "提示词字段名": "正面", "完整Prompt": "prompt 1", "本地生成图文件": "/tmp/ai-1.jpg"},
                {"提示词序号": 2, "提示词字段名": "侧身", "完整Prompt": "prompt 2", "本地生成图文件": "/tmp/ai-2.jpg"},
            ],
            ["/tmp/ai-1.jpg", "/tmp/ai-2.jpg"],
            reference_mode="main_and_detail",
        )

        self.assertEqual(
            [asset["label"] for asset in item["assets"]],
            ["原图/主图", "款色参考图", "AI 图 1", "AI 图 2"],
        )
        self.assertEqual(item["assets"][2]["prompt"], "prompt 1")
        self.assertEqual(item["assets"][3]["prompt_name"], "侧身")
        self.assertEqual(item["assets"][2]["status"], "pending")
        self.assertEqual(item["assets"][0]["status"], "reference")

    def test_approval_item_limits_ai_assets_to_selected_generation_paths(self):
        module = load_script()
        workflow = module.WorkflowItem(2, "208326100202", "1002178235142", "长袖T恤", "中性")

        item = module.build_approval_item(
            workflow,
            {},
            "/tmp/main.jpg",
            "",
            [
                {"提示词序号": 1, "提示词字段名": "正面", "本地生成图文件": "/tmp/ai-1-a.jpg\n/tmp/ai-1-b.jpg"},
                {"提示词序号": 2, "提示词字段名": "侧身", "本地生成图文件": "/tmp/ai-2.jpg"},
            ],
            ["/tmp/ai-1-a.jpg", "/tmp/ai-2.jpg"],
            reference_mode="main_only",
        )

        ai_assets = [asset for asset in item["assets"] if asset["kind"] == "ai"]
        self.assertEqual([asset["path"] for asset in ai_assets], ["/tmp/ai-1-a.jpg", "/tmp/ai-2.jpg"])

    def test_generation_confirmation_item_groups_source_images_and_prompts_before_generation(self):
        module = load_script()
        workflow = module.WorkflowItem(2, "208326100202", "1002178235142", "长袖T恤", "中性")

        item = module.build_generation_confirmation_item(
            workflow,
            {"chosenMain": {"filename": "橱窗1.jpg"}, "chosenDetail": {"filename": "208326100202-00482.jpg"}},
            "/tmp/main.jpg",
            "/tmp/flat.jpg",
            [
                {"提示词序号": 1, "提示词字段名": "正面", "完整Prompt": "prompt 1", "参考图文件": "/tmp/main.jpg"},
                {"提示词序号": 2, "提示词字段名": "侧身", "完整Prompt": "prompt 2", "参考图文件": "/tmp/main.jpg"},
            ],
            reference_mode="main_only",
        )

        self.assertEqual(item["status"], "pending_generation_confirmation")
        self.assertEqual([asset["label"] for asset in item["assets"]], ["原图/主图", "款色参考图"])
        main_asset, detail_asset = item["assets"]
        self.assertTrue(main_asset["use_for_generation"])
        self.assertFalse(detail_asset["use_for_generation"])
        self.assertEqual(main_asset["slot"], "main")
        self.assertEqual(detail_asset["slot"], "reference")
        self.assertEqual([prompt["prompt_name"] for prompt in item["generation_prompts"]], ["正面", "侧身"])
        self.assertEqual(item["generation_prompts"][0]["prompt"], "prompt 1")
        self.assertEqual(item["generation_prompts"][0]["image_count"], 1)
        self.assertEqual(item["generation_prompts"][1]["reference_paths"], ["/tmp/main.jpg"])
        self.assertEqual(item["generation_prompts"][1]["image_count"], 1)
        self.assertEqual(item["generation_prompts"][1]["status"], "pending")

    def test_generation_confirmation_item_exposes_all_style_color_reference_images(self):
        module = load_script()
        workflow = module.WorkflowItem(2, "208326100202", "1002178235142", "长袖T恤", "中性")

        item = module.build_generation_confirmation_item(
            workflow,
            {
                "chosenMain": {"filename": "橱窗1.jpg"},
                "chosenDetail": {"filename": "208326100202-20841.jpg"},
                "detailReferencePaths": [
                    "/tmp/208326100202-20841.jpg",
                    "/tmp/208326100202-30424.jpg",
                    "/tmp/208326100202-60354.jpg",
                ],
            },
            "/tmp/main.jpg",
            "/tmp/208326100202-20841.jpg",
            [{"提示词序号": 1, "提示词字段名": "正面", "完整Prompt": "prompt", "参考图文件": "/tmp/main.jpg"}],
            reference_mode="main_only",
        )

        detail_assets = [asset for asset in item["assets"] if asset["kind"] == "detail_reference"]
        self.assertEqual(
            [asset["path"] for asset in detail_assets],
            [
                "/tmp/208326100202-20841.jpg",
                "/tmp/208326100202-30424.jpg",
                "/tmp/208326100202-60354.jpg",
            ],
        )
        self.assertEqual(detail_assets[0]["label"], "款色参考图")
        self.assertEqual(detail_assets[1]["label"], "款色参考图 2")

    def test_prepare_generation_confirmation_placeholders_returns_generating_ai_cards(self):
        module = load_script()
        batch = {
            "batch_id": "batch-placeholder",
            "status": module.GENERATION_CONFIRMATION_STATUS,
            "run_params": {"image_size": "1536x2048", "one_xm_key_tier": "4k"},
            "items": [{
                "id": "item-1",
                "style_code": "208326100202",
                "item_id": "1002178235142",
                "origin_path": "/tmp/main.jpg",
                "assets": [{"id": "origin-1", "kind": "origin", "path": "/tmp/main.jpg", "slot": "main"}],
                "generation_prompts": [{
                    "id": "prompt-1",
                    "prompt_index": 1,
                    "prompt_name": "正面",
                    "prompt": "prompt",
                    "custom_prompt": "prompt",
                    "image_count": 2,
                    "reference_paths": ["/tmp/main.jpg"],
                    "status": "pending",
                }],
            }],
        }

        with patch.object(module, "save_approval_batch"), \
            patch.object(module, "maybe_sync_approval_batch_to_cloud") as sync_to_cloud:
            prepared = module.prepare_generation_confirmation_placeholders(batch)

        ai_assets = [asset for asset in prepared["items"][0]["assets"] if asset["kind"] == "ai"]
        sync_to_cloud.assert_not_called()
        self.assertEqual(prepared["status"], "generating")
        self.assertEqual(prepared["submit_progress"]["status"], "running")
        self.assertEqual(prepared["submit_progress"]["image_total"], 2)
        self.assertEqual(len(ai_assets), 2)
        self.assertTrue(all(asset["status"] == "generating" and asset["placeholder"] for asset in ai_assets))
        self.assertTrue(all(asset["placeholder_preview_path"] == "/tmp/main.jpg" for asset in ai_assets))

    def test_submit_generation_confirmation_persists_each_prompt_as_it_finishes(self):
        module = load_script()
        snapshots = []

        def fake_generate(row, *_args, **_kwargs):
            patched = dict(row)
            patched["生成图URL"] = f"https://img.example/{row['提示词序号']}.jpg"
            patched["执行结果"] = "已生成"
            return patched

        def fake_download(row, artifact_dir):
            return [str(Path(artifact_dir) / f"{row['款号']}-ai-{row['提示词序号']}.jpg")]

        def capture_save(next_batch):
            snapshots.append(json.loads(json.dumps(next_batch, ensure_ascii=False, default=str)))

        with tempfile.TemporaryDirectory() as temp_dir:
            batch = {
                "batch_id": "batch-incremental",
                "status": "generating",
                "task_run_uid": "run-incremental",
                "artifact_dir": temp_dir,
                "run_params": {
                    "generation_concurrency": 1,
                    "approval_notify_channel": "none",
                    "image_size": "1536x2048",
                    "one_xm_key_tier": "4k",
                },
                "items": [{
                    "id": "item-1",
                    "style_code": "208326100202",
                    "item_id": "1002178235142",
                    "origin_path": "/tmp/main.jpg",
                    "workflow": {
                        "row_no": 2,
                        "style_code": "208326100202",
                        "item_id": "1002178235142",
                        "category": "长袖T恤",
                        "gender": "中性",
                    },
                    "assets": [
                        {"id": "origin-1", "kind": "origin", "path": "/tmp/main.jpg", "slot": "main"},
                        {"id": "loading-1", "kind": "ai", "status": "generating", "placeholder": True, "prompt_index": 1},
                        {"id": "loading-2", "kind": "ai", "status": "generating", "placeholder": True, "prompt_index": 2},
                    ],
                    "generation_prompts": [
                        {
                            "id": "prompt-1",
                            "prompt_index": 1,
                            "prompt_name": "正面",
                            "prompt_group": "上装",
                            "custom_prompt": "prompt 1",
                            "image_count": 1,
                            "reference_paths": ["/tmp/main.jpg"],
                            "status": "generating",
                        },
                        {
                            "id": "prompt-2",
                            "prompt_index": 2,
                            "prompt_name": "侧面",
                            "prompt_group": "上装",
                            "custom_prompt": "prompt 2",
                            "image_count": 1,
                            "reference_paths": ["/tmp/main.jpg"],
                            "status": "generating",
                        },
                    ],
                }],
            }

            with patch.object(module, "resolve_one_xm_settings", return_value={"4k": "unit-key-4k"}), \
                patch.object(module, "run_one_xm_generation_row", fake_generate), \
                patch.object(module, "download_generated_images", fake_download), \
                patch.object(module, "save_approval_batch", capture_save), \
                patch.object(module, "maybe_sync_approval_batch_to_cloud"):
                result = module.submit_generation_confirmation_batch(batch)

        partial = next(snapshot for snapshot in snapshots if snapshot["submit_progress"]["completed"] == 1)
        partial_ai_assets = [asset for asset in partial["items"][0]["assets"] if asset["kind"] == "ai"]

        self.assertEqual(partial["status"], "generating")
        self.assertEqual(partial["generation_summary"]["generated"], 1)
        self.assertEqual(partial_ai_assets[0]["status"], "pending")
        self.assertFalse(partial_ai_assets[0].get("placeholder"))
        self.assertEqual(partial_ai_assets[0]["prompt_index"], 1)
        self.assertTrue(partial_ai_assets[1]["placeholder"])
        self.assertEqual(partial_ai_assets[1]["prompt_index"], 2)
        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], "pending_approval")
        self.assertEqual(snapshots[-1]["submit_progress"]["completed"], 2)

    def test_generation_confirmation_prompt_image_count_updates_1xm_payload(self):
        module = load_script()
        batch = {
            "batch_id": "batch-count",
            "task_run_uid": "run-count",
            "run_params": {"ai_image_count": 4, "image_size": "960x1280", "quality": "auto", "output_format": "jpeg"},
        }
        item = {
            "id": "item-1",
            "style_code": "208326100202",
            "item_id": "1002178235142",
            "origin_path": "/tmp/main.jpg",
            "workflow": {
                "row_no": 2,
                "style_code": "208326100202",
                "item_id": "1002178235142",
                "category": "长袖T恤",
                "gender": "中性",
                "skc_code": "208326100202-00211",
            },
            "generation_rows": [{
                "提示词分组": "上装",
                "提示词字段名": "正面",
                "提示词序号": 1,
                "尺寸": "960x1280",
                "格式": "jpeg",
                "质量": "auto",
                "生成数量": 1,
                "__1xm_payload": {"n": 1, "size": "960x1280", "ratio": "3:4"},
            }],
        }
        prompt = {
            "prompt_index": 1,
            "prompt_name": "动态展示",
            "prompt_group": "上装",
            "prompt": "prompt text",
            "custom_prompt": "prompt text",
            "reference_paths": ["/tmp/main.jpg"],
            "image_count": 3,
            "generation_row": item["generation_rows"][0],
        }

        row = module.generation_confirmation_prompt_to_row(batch, item, prompt, index=1)

        self.assertEqual(row["生成数量"], 3)
        self.assertEqual(row["比例"], "3:4")
        self.assertEqual(row["__1xm_payload"]["n"], 3)
        self.assertEqual(row["__1xm_payload"]["ratio"], "3:4")

    def test_approval_generation_defaults_do_not_treat_prompt_count_as_image_count(self):
        module = load_script()
        item = {"assets": []}

        prompt_count_only = module.approval_generation_defaults(
            {"run_params": {"ai_image_count": 4}},
            item,
        )
        explicit_generation_count = module.approval_generation_defaults(
            {"run_params": {"ai_image_count": 4, "generation_image_count": 3}},
            item,
        )

        self.assertEqual(prompt_count_only["count"], 1)
        self.assertEqual(explicit_generation_count["count"], 3)

    def test_cloud_prompt_templates_normalize_to_prompt_items(self):
        module = load_script()

        prompts = module.prompt_items_from_cloud_templates([
            {
                "template_id": 11,
                "group_name": "上装",
                "field_name": "动态定格",
                "field_order": 2,
                "size_label": "960x1280",
                "output_format": "jpeg",
                "prompt_text": "云端 prompt A",
                "female_priority": 3,
                "male_neutral_priority": 4,
            },
            {
                "template_id": 12,
                "group_name": "下装",
                "field_name": "裤装正面",
                "prompt": "云端 prompt B",
                "priority": 7,
            },
            {"field_name": "空内容"},
        ])

        self.assertEqual(len(prompts), 2)
        self.assertEqual(prompts[0].sheet_name, "上装")
        self.assertEqual(prompts[0].field_name, "动态定格")
        self.assertEqual(prompts[0].field_order, 2)
        self.assertEqual(prompts[0].size_label, "960x1280")
        self.assertEqual(prompts[0].output_format, "jpeg")
        self.assertEqual(prompts[0].prompt, "云端 prompt A")
        self.assertEqual(prompts[0].female_priority, 3)
        self.assertEqual(prompts[0].neutral_priority, 4)
        self.assertEqual(prompts[1].neutral_priority, 7)

    def test_load_prompt_library_uses_cloud_templates_when_selected(self):
        module = load_script()
        args = SimpleNamespace(
            prompt_source="cloud_prompt_library",
            prompt_file="/tmp/should-not-read.xlsx",
            cloud_prompt_library_id="42",
            cloud_prompt_templates_json=json.dumps({
                "templates": [{
                    "group_name": "上装",
                    "field_name": "正面",
                    "prompt_text": "来自线上 Prompt 库",
                    "priority": 1,
                }],
            }, ensure_ascii=False),
        )

        with patch.object(module, "read_prompt_library") as read_local:
            prompts = module.load_prompt_library_for_args(args)

        read_local.assert_not_called()
        self.assertEqual(len(prompts), 1)
        self.assertEqual(prompts[0].sheet_name, "上装")
        self.assertEqual(prompts[0].prompt, "来自线上 Prompt 库")

    def test_write_generation_confirmation_batch_waits_for_generation_submit(self):
        module = load_script()
        workflow = module.WorkflowItem(2, "208326100202", "1002178235142", "长袖T恤", "中性")

        with tempfile.TemporaryDirectory() as temp_dir:
            artifact_dir = Path(temp_dir)
            item = module.build_generation_confirmation_item(
                workflow,
                {"chosenMain": {"filename": "橱窗1.jpg"}},
                str(artifact_dir / "main.jpg"),
                "",
                [{"提示词序号": 1, "提示词字段名": "正面", "完整Prompt": "保留主商品", "参考图文件": str(artifact_dir / "main.jpg")}],
                reference_mode="main_only",
            )

            batch = module.write_generation_confirmation_batch(
                artifact_dir,
                [item],
                run_params={"approval_message_template": "批次 {{batch_id}}：{{board_url}}"},
                base_url="http://127.0.0.1:18765",
                batch_id="confirm-test",
                token="token-test",
                created_at="2026-07-09T12:00:00+08:00",
            )

            self.assertEqual(batch["status"], "pending_generation_confirmation")
            self.assertEqual(batch["generation_prompt_total"], 1)
            self.assertIn("token=token-test", batch["board_url"])
            html = Path(batch["board_path"]).read_text(encoding="utf-8")
            self.assertIn("确认提交生图任务", html)
            self.assertIn("保留主商品", html)

    def test_write_approval_batch_creates_board_and_renders_message_template(self):
        module = load_script()
        workflow = module.WorkflowItem(2, "208326100202", "1002178235142", "长袖T恤", "中性")

        with tempfile.TemporaryDirectory() as temp_dir:
            artifact_dir = Path(temp_dir)
            item = module.build_approval_item(
                workflow,
                {"chosenMain": {"filename": "橱窗1.jpg"}},
                str(artifact_dir / "main.jpg"),
                "",
                [{"提示词序号": 1, "提示词字段名": "正面", "完整Prompt": "保留主商品", "本地生成图文件": str(artifact_dir / "ai-1.jpg")}],
                [str(artifact_dir / "ai-1.jpg")],
                reference_mode="main_only",
            )

            batch = module.write_approval_batch(
                artifact_dir,
                [item],
                run_params={"approval_message_template": "批次 {{batch_id}}，共 {{total_styles}} 款：{{board_url}}"},
                base_url="http://127.0.0.1:18765",
                batch_id="batch-test",
                token="token-test",
                created_at="2026-07-01T12:00:00+08:00",
            )

            self.assertEqual(batch["batch_id"], "batch-test")
            self.assertEqual(batch["status"], "pending_approval")
            self.assertIn("token=token-test", batch["board_url"])
            self.assertTrue(Path(batch["json_path"]).is_file())
            self.assertTrue(Path(batch["board_path"]).is_file())
            self.assertIn("批次 batch-test，共 1 款", batch["approval_message"])
            html = Path(batch["board_path"]).read_text(encoding="utf-8")
            self.assertIn("天猫AI测图审批看板", html)
            self.assertIn("AI 图 1", html)
            self.assertIn("保留主商品", html)

    def test_render_approval_board_html_escapes_user_controlled_fields(self):
        module = load_script()
        batch = {
            "batch_id": "batch-xss",
            "status": "pending_approval",
            "created_at": "2026-07-08T12:00:00+08:00",
            "token": "local-token",
            "items": [{
                "style_code": '<img src=x onerror=alert(1)>',
                "item_id": '1001"><img src=x onerror=alert(2)>',
                "category": '<script>alert(3)</script>',
                "skc_code": "SKC-1",
                "reference_mode": "main_only",
                "assets": [{
                    "id": "asset-1",
                    "kind": "ai",
                    "label": '<img src=x onerror=alert(4)>',
                    "path": "/tmp/ai.jpg",
                    "filename": "ai.jpg",
                    "prompt": '</textarea><script>alert(5)</script>',
                    "status": "pending",
                }],
            }],
        }

        html = module.render_approval_board_html(batch)

        self.assertNotIn('<img src=x onerror=alert(1)>', html)
        self.assertNotIn('<img src=x onerror=alert(2)>', html)
        self.assertNotIn('<script>alert(3)</script>', html)
        self.assertNotIn('<img src=x onerror=alert(4)>', html)
        self.assertNotIn('</textarea><script>alert(5)</script>', html)
        self.assertIn("\\u003cimg src=x onerror=alert(1)\\u003e", html)

    def test_cloud_sync_rewrites_approval_message_to_cloud_board_url(self):
        module = load_script()
        workflow = module.WorkflowItem(2, "208326100202", "1002178235142", "长袖T恤", "中性")

        with tempfile.TemporaryDirectory() as temp_dir:
            artifact_dir = Path(temp_dir)
            item = module.build_approval_item(
                workflow,
                {"chosenMain": {"filename": "橱窗1.jpg"}},
                str(artifact_dir / "main.jpg"),
                "",
                [{"提示词序号": 1, "提示词字段名": "正面", "完整Prompt": "保留主商品", "本地生成图文件": str(artifact_dir / "ai-1.jpg")}],
                [str(artifact_dir / "ai-1.jpg")],
                reference_mode="main_only",
            )
            batch = module.write_approval_batch(
                artifact_dir,
                [item],
                run_params={"approval_message_template": "请打开审批看板确认后创建测图任务：{{board_url}}"},
                base_url="http://127.0.0.1:18765",
                batch_id="batch-cloud",
                token="token-local",
                created_at="2026-07-08T12:00:00+08:00",
            )
            local_board_url = batch["board_url"]
            cloud_board_url = "https://approval.crawshrimp.com/?batch_uid=batch-cloud"

            with patch("core.config.load_config", return_value={
                "cloud_approval": {
                    "machine_enabled": True,
                    "base_url": "https://approval.crawshrimp.com",
                    "poll_timeout_seconds": 30,
                },
            }), patch.object(module.data_sink, "get_cloud_machine_credentials", return_value={
                "machine_token": "csr_machine_secret",
            }), patch.object(module.data_sink, "record_cloud_job_event"), patch(
                "core.cloud_batch_sync.sync_local_approval_batch",
                return_value={"ok": True, "assets": []},
            ):
                module.maybe_sync_approval_batch_to_cloud(batch, log=lambda _line: None)

            self.assertEqual(batch.get("local_board_url"), local_board_url)
            self.assertEqual(batch.get("cloud_board_url"), cloud_board_url)
            self.assertEqual(batch["board_url"], cloud_board_url)
            self.assertIn(cloud_board_url, batch["approval_message"])
            self.assertNotIn(local_board_url, batch["approval_message"])
            rows = module.approval_result_rows(batch)
            self.assertEqual(rows[0]["审批看板"], cloud_board_url)
            self.assertEqual(rows[0]["云端审批看板"], cloud_board_url)
            self.assertEqual(rows[0]["本地审批看板"], local_board_url)
            saved = json.loads(Path(batch["json_path"]).read_text(encoding="utf-8"))
            self.assertEqual(saved["board_url"], cloud_board_url)

    def test_cloud_sync_records_visible_warning_when_config_is_incomplete(self):
        module = load_script()
        with tempfile.TemporaryDirectory() as temp_dir:
            batch = {
                "batch_id": "batch-cloud-missing",
                "status": "pending_approval",
                "board_url": "http://127.0.0.1:18765/tmall-ai-image-approval/batch-cloud-missing?token=local",
                "json_path": str(Path(temp_dir) / "approval-batch.json"),
                "board_path": str(Path(temp_dir) / "approval-board.html"),
                "items": [],
            }
            Path(batch["json_path"]).write_text(json.dumps(batch, ensure_ascii=False), encoding="utf-8")
            logs = []

            with patch("core.config.load_config", return_value={
                "cloud_approval": {
                    "machine_enabled": True,
                    "base_url": "https://approval.crawshrimp.com",
                },
            }), patch.object(module.data_sink, "get_cloud_machine_credentials", return_value={}):
                result = module.maybe_sync_approval_batch_to_cloud(batch, log=logs.append)

            self.assertIsNone(result)
            self.assertEqual(batch["cloud_sync"]["status"], "warning")
            self.assertIn("未注册任务机", batch["cloud_sync"]["warning"])
            self.assertTrue(any("云端审批同步跳过" in line for line in logs))
            saved = json.loads(Path(batch["json_path"]).read_text(encoding="utf-8"))
            self.assertEqual(saved["cloud_sync"]["status"], "warning")

    def test_selected_upload_plan_from_approval_batch_only_keeps_confirmed_ai_images(self):
        module = load_script()
        batch = {
            "items": [{
                "style_code": "208326100202",
                "item_id": "1002178235142",
                "origin_path": "/tmp/main.jpg",
                "detail_reference_path": "/tmp/flat.jpg",
                "assets": [
                    {"id": "origin-1", "kind": "origin", "path": "/tmp/main.jpg"},
                    {"id": "ai-1", "kind": "ai", "path": "/tmp/ai-1.jpg", "status": "approved"},
                    {"id": "ai-2", "kind": "ai", "path": "/tmp/ai-2.jpg", "status": "rejected"},
                    {"id": "ai-3", "kind": "ai", "path": "/tmp/ai-3.jpg", "status": "pending"},
                ],
                "workflow": {
                    "row_no": 2,
                    "style_code": "208326100202",
                    "item_id": "1002178235142",
                    "category": "长袖T恤",
                    "gender": "中性",
                    "prompt_name": "",
                    "skc_code": "208326100202-00482",
                },
            }],
        }

        plan = module.selected_upload_plan_from_approval_batch(batch)

        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0]["origin_path"], "/tmp/main.jpg")
        self.assertEqual(plan[0]["generated_paths"], ["/tmp/ai-1.jpg"])

    def test_selected_upload_plan_filters_ai_images_from_other_runs(self):
        module = load_script()
        batch = {
            "task_run_uid": "run-current",
            "items": [{
                "style_code": "208326100202",
                "item_id": "1002178235142",
                "origin_path": "/tmp/main.jpg",
                "assets": [
                    {
                        "id": "ai-current",
                        "kind": "ai",
                        "path": "/tmp/current.jpg",
                        "status": "approved",
                        "task_run_uid": "run-current",
                    },
                    {
                        "id": "ai-old",
                        "kind": "ai",
                        "path": "/tmp/old.jpg",
                        "status": "approved",
                        "task_run_uid": "run-old",
                    },
                    {
                        "id": "ai-unknown",
                        "kind": "ai",
                        "path": "/tmp/unknown.jpg",
                        "status": "approved",
                    },
                ],
                "workflow": {
                    "row_no": 2,
                    "style_code": "208326100202",
                    "item_id": "1002178235142",
                    "category": "长袖T恤",
                    "gender": "中性",
                },
            }],
        }

        plan = module.selected_upload_plan_from_approval_batch(batch)

        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0]["generated_paths"], ["/tmp/current.jpg"])

    def test_selected_upload_plan_skips_previously_online_success_rows_only(self):
        module = load_script()
        batch = {
            "submit_result_rows": [
                {
                    "阶段": "天猫上传/创建测图任务",
                    "款号": "208326100202",
                    "任务ID": "41716301",
                    "执行结果": "已创建/加素材/已上线",
                    "上线结果": "已上线",
                    "页面回读": "total=1；status=1；testImages=5",
                    "提交图片文件": "/tmp/success-ai.jpg",
                    "提交图片数量": 1,
                },
                {
                    "阶段": "天猫上传/创建测图任务",
                    "款号": "208326108101",
                    "任务ID": "41733207",
                    "执行结果": "天猫上传/创建失败",
                    "上线结果": "未上线",
                    "页面回读": "total=1；status=-1；testImages=6",
                },
            ],
            "items": [
                {
                    "style_code": "208326100202",
                    "item_id": "1002178235142",
                    "origin_path": "/tmp/success-main.jpg",
                    "assets": [{"id": "ai-success", "kind": "ai", "path": "/tmp/success-ai.jpg", "status": "approved"}],
                    "workflow": {"row_no": 2, "style_code": "208326100202", "item_id": "1002178235142"},
                },
                {
                    "style_code": "208326108101",
                    "item_id": "1061920756107",
                    "origin_path": "/tmp/failed-main.jpg",
                    "assets": [{"id": "ai-failed", "kind": "ai", "path": "/tmp/failed-ai.jpg", "status": "approved"}],
                    "workflow": {"row_no": 3, "style_code": "208326108101", "item_id": "1061920756107"},
                },
            ],
        }

        plan = module.selected_upload_plan_from_approval_batch(batch)

        self.assertEqual([item["workflow"]["style_code"] for item in plan], ["208326108101"])

    def test_selected_upload_plan_only_sends_unsubmitted_ai_images_after_partial_success(self):
        module = load_script()
        batch = {
            "submit_result_rows": [
                {
                    "阶段": "天猫上传/创建测图任务",
                    "款号": "208326100202",
                    "任务ID": "41716301",
                    "执行结果": "已创建/加素材/已上线",
                    "上线结果": "已上线",
                    "页面回读": "total=1；status=1；testImages=3",
                    "提交图片文件": "/tmp/ai-1.jpg\n/tmp/ai-2.jpg",
                    "提交图片数量": 2,
                },
            ],
            "items": [
                {
                    "style_code": "208326100202",
                    "item_id": "1002178235142",
                    "origin_path": "/tmp/main.jpg",
                    "assets": [
                        {"id": "ai-1", "kind": "ai", "path": "/tmp/ai-1.jpg", "status": "approved"},
                        {"id": "ai-2", "kind": "ai", "path": "/tmp/ai-2.jpg", "status": "approved"},
                        {"id": "ai-3", "kind": "ai", "path": "/tmp/ai-3.jpg", "status": "approved"},
                        {"id": "ai-4", "kind": "ai", "path": "/tmp/ai-4.jpg", "status": "approved"},
                        {"id": "ai-5", "kind": "ai", "path": "/tmp/ai-5.jpg", "status": "approved"},
                    ],
                    "workflow": {"row_no": 2, "style_code": "208326100202", "item_id": "1002178235142"},
                },
            ],
        }

        plan = module.selected_upload_plan_from_approval_batch(batch)

        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0]["generated_paths"], ["/tmp/ai-3.jpg", "/tmp/ai-4.jpg", "/tmp/ai-5.jpg"])
        self.assertEqual(plan[0]["submit_mode"], "append_unsubmitted")

    def test_selected_upload_plan_allows_explicit_rerun_when_all_confirmed_images_were_submitted(self):
        module = load_script()
        batch = {
            "submit_result_rows": [
                {
                    "阶段": "天猫上传/创建测图任务",
                    "款号": "208326100202",
                    "任务ID": "41716301",
                    "执行结果": "已创建/加素材/已上线",
                    "上线结果": "已上线",
                    "页面回读": "total=1；status=1；testImages=3",
                    "提交图片文件": "/tmp/ai-1.jpg\n/tmp/ai-2.jpg",
                    "提交图片数量": 2,
                },
            ],
            "items": [
                {
                    "style_code": "208326100202",
                    "item_id": "1002178235142",
                    "origin_path": "/tmp/main.jpg",
                    "assets": [
                        {"id": "ai-1", "kind": "ai", "path": "/tmp/ai-1.jpg", "status": "approved"},
                        {"id": "ai-2", "kind": "ai", "path": "/tmp/ai-2.jpg", "status": "approved"},
                    ],
                    "workflow": {"row_no": 2, "style_code": "208326100202", "item_id": "1002178235142"},
                },
            ],
        }

        plan = module.selected_upload_plan_from_approval_batch(batch)

        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0]["generated_paths"], ["/tmp/ai-1.jpg", "/tmp/ai-2.jpg"])
        self.assertEqual(plan[0]["submit_mode"], "rerun_confirmed")

    def test_selected_upload_plan_treats_legacy_success_without_image_list_as_rerun(self):
        module = load_script()
        batch = {
            "submit_result_rows": [
                {
                    "阶段": "天猫上传/创建测图任务",
                    "款号": "208326100202",
                    "任务ID": "41716301",
                    "执行结果": "已创建/加素材/已上线",
                    "上线结果": "已上线",
                    "页面回读": "total=1；status=1；testImages=5",
                },
            ],
            "items": [
                {
                    "style_code": "208326100202",
                    "item_id": "1002178235142",
                    "origin_path": "/tmp/main.jpg",
                    "assets": [
                        {"id": "ai-1", "kind": "ai", "path": "/tmp/ai-1.jpg", "status": "approved"},
                    ],
                    "workflow": {"row_no": 2, "style_code": "208326100202", "item_id": "1002178235142"},
                },
            ],
        }

        plan = module.selected_upload_plan_from_approval_batch(batch)

        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0]["generated_paths"], ["/tmp/ai-1.jpg"])
        self.assertEqual(plan[0]["submit_mode"], "rerun_confirmed")

    def test_upload_approved_batch_retries_failed_styles_without_resubmitting_successes(self):
        module = load_script()
        upload_styles = []

        async def fake_get_runner(*_args, **_kwargs):
            return SimpleNamespace(timeout=60)

        async def fake_upload_and_create(_runner, workflow, *_args, **_kwargs):
            upload_styles.append(workflow.style_code)
            return {
                "uploaded": [{"url": f"https://img.example/{workflow.style_code}.jpg"}],
                "materials": [{"picUrl": f"https://img.example/{workflow.style_code}.jpg"}],
                "batchPayload": {"experimentTaskId": f"task-{workflow.style_code}"},
                "readback": {"total": 1},
                "readbackTaskSummary": {"status": "1", "testImageCount": 1, "online": True},
                "onlineResult": {"ok": True},
                "error": "",
            }

        class Bridge:
            def __init__(self, _cdp_url):
                pass

            def is_available(self, timeout=5):
                return True

        with tempfile.TemporaryDirectory() as temp_dir:
            batch = {
                "batch_id": "batch-retry-only-failed",
                "artifact_dir": temp_dir,
                "run_params": {},
                "submit_result_rows": [
                    {
                        "表格行号": 2,
                        "款号": "208326100202",
                        "商品ID": "1002178235142",
                        "阶段": "天猫上传/创建测图任务",
                        "任务ID": "41716301",
                        "执行结果": "已创建/加素材/已上线",
                        "上线结果": "已上线",
                        "页面回读": "total=1；status=1；testImages=5",
                        "提交图片文件": "/tmp/success-ai.jpg",
                        "提交图片数量": 1,
                    },
                    {
                        "表格行号": 3,
                        "款号": "208326108101",
                        "商品ID": "1061920756107",
                        "阶段": "天猫上传/创建测图任务",
                        "任务ID": "41733207",
                        "执行结果": "天猫上传/创建失败",
                        "上线结果": "未上线",
                        "页面回读": "total=1；status=-1；testImages=6",
                    },
                ],
                "items": [
                    {
                        "style_code": "208326100202",
                        "item_id": "1002178235142",
                        "origin_path": "/tmp/success-main.jpg",
                        "workflow": {"row_no": 2, "style_code": "208326100202", "item_id": "1002178235142"},
                        "semir_data": {},
                        "assets": [{"id": "ai-success", "kind": "ai", "path": "/tmp/success-ai.jpg", "status": "approved"}],
                    },
                    {
                        "style_code": "208326108101",
                        "item_id": "1061920756107",
                        "origin_path": "/tmp/failed-main.jpg",
                        "workflow": {"row_no": 3, "style_code": "208326108101", "item_id": "1061920756107"},
                        "semir_data": {},
                        "assets": [
                            {
                                "id": "ai-failed",
                                "kind": "ai",
                                "path": "/tmp/failed-ai.jpg",
                                "status": "approved",
                                "generation_row": {"提示词序号": 1, "提示词字段名": "正面"},
                            },
                        ],
                    },
                ],
            }
            with patch.object(module, "CDPBridge", Bridge), \
                patch.object(module, "get_runner", fake_get_runner), \
                patch.object(module, "wait_for_tmall_api_ready", noop_wait_for_tmall_ready), \
                patch.object(module, "recover_tmall_submission_by_readback", return_value=None), \
                patch.object(module, "upload_and_create_tmall_task", fake_upload_and_create):
                result = asyncio.run(module.upload_approved_tmall_batch(batch))

        self.assertEqual(upload_styles, ["208326108101"])
        self.assertTrue(result["ok"])
        self.assertEqual(result["attempted"], 2)
        self.assertEqual(result["succeeded"], 2)
        self.assertEqual(result["failed"], 0)
        self.assertEqual(batch["submit_summary"], {"attempted": 2, "succeeded": 2, "failed": 0})
        create_rows = [
            row for row in batch["submit_result_rows"]
            if row.get("阶段") == "天猫上传/创建测图任务" and row.get("款号") == "208326108101"
        ]
        self.assertEqual(create_rows[-1]["提交图片文件"], "/tmp/failed-ai.jpg")
        self.assertEqual(create_rows[-1]["提交图片数量"], 1)

    def test_wait_for_tmall_api_ready_waits_until_login_succeeds(self):
        module = load_script()
        logs = []
        sleeps = []

        class Runner:
            def __init__(self):
                self.timeout = 120
                self.calls = 0

            async def evaluate_with_reconnect(self, _script, allow_navigation_retry=True):
                statuses = [
                    {
                        "ready": False,
                        "isLoginUrl": True,
                        "hasMtop": False,
                        "href": "https://loginmyseller.taobao.com/login.htm",
                        "title": "登录",
                    },
                    {
                        "ready": False,
                        "isLoginUrl": False,
                        "hasMtop": False,
                        "href": module.TMALL_URL,
                        "title": "加载中",
                    },
                    {
                        "ready": True,
                        "isLoginUrl": False,
                        "hasMtop": True,
                        "href": module.TMALL_URL,
                        "title": "素材测试",
                    },
                ]
                status = statuses[min(self.calls, len(statuses) - 1)]
                self.calls += 1
                return SimpleNamespace(success=True, data=[status], error="")

        async def fake_sleep(seconds):
            sleeps.append(seconds)

        runner = Runner()
        with patch.object(module.asyncio, "sleep", fake_sleep):
            asyncio.run(module.wait_for_tmall_api_ready(
                runner,
                log=logs.append,
                timeout_ms=300000,
                poll_interval_seconds=0,
            ))

        self.assertEqual(runner.calls, 3)
        self.assertEqual(sleeps, [0, 0])
        self.assertEqual(runner.timeout, 120)
        self.assertTrue(any("等待天猫登录" in line for line in logs))
        self.assertTrue(any("天猫测图页面已就绪" in line for line in logs))

    def test_wait_for_tmall_api_ready_times_out_with_login_message(self):
        module = load_script()

        class Runner:
            timeout = 120

            async def evaluate_with_reconnect(self, _script, allow_navigation_retry=True):
                return SimpleNamespace(
                    success=True,
                    data=[{
                        "ready": False,
                        "isLoginUrl": True,
                        "hasMtop": False,
                        "href": "https://loginmyseller.taobao.com/login.htm",
                        "title": "登录",
                    }],
                    error="",
                )

        with self.assertRaisesRegex(RuntimeError, "等待天猫登录超时.*天猫登录页"):
            asyncio.run(module.wait_for_tmall_api_ready(Runner(), timeout_ms=0))

    def test_upload_approved_batch_waits_for_tmall_login_before_uploading(self):
        module = load_script()
        events = []

        async def fake_get_runner(*_args, **_kwargs):
            return SimpleNamespace(timeout=60)

        async def fake_wait_for_tmall_ready(_runner, **kwargs):
            events.append(("wait", kwargs.get("timeout_ms")))

        async def fake_upload_and_create(_runner, workflow, *_args, **_kwargs):
            events.append(("upload", workflow.style_code))
            return {
                "uploaded": [{"url": f"https://img.example/{workflow.style_code}.jpg"}],
                "materials": [{"picUrl": f"https://img.example/{workflow.style_code}.jpg"}],
                "batchPayload": {"experimentTaskId": f"task-{workflow.style_code}"},
                "readback": {"total": 1},
                "readbackTaskSummary": {"status": "1", "testImageCount": 1, "online": True},
                "onlineResult": {"ok": True},
                "error": "",
            }

        class Bridge:
            def __init__(self, _cdp_url):
                pass

            def is_available(self, timeout=5):
                return True

        with tempfile.TemporaryDirectory() as temp_dir:
            batch = {
                "batch_id": "batch-wait-login",
                "artifact_dir": temp_dir,
                "run_params": {},
                "items": [{
                    "style_code": "208326100202",
                    "item_id": "1002178235142",
                    "origin_path": "/tmp/main.jpg",
                    "workflow": {"row_no": 2, "style_code": "208326100202", "item_id": "1002178235142"},
                    "semir_data": {},
                    "assets": [
                        {
                            "id": "ai-1",
                            "kind": "ai",
                            "path": "/tmp/ai-1.jpg",
                            "status": "approved",
                            "generation_row": {"提示词序号": 1, "提示词字段名": "正面"},
                        },
                    ],
                }],
            }
            with patch.object(module, "CDPBridge", Bridge), \
                patch.object(module, "get_runner", fake_get_runner), \
                patch.object(module, "wait_for_tmall_api_ready", fake_wait_for_tmall_ready), \
                patch.object(module, "upload_and_create_tmall_task", fake_upload_and_create):
                result = asyncio.run(module.upload_approved_tmall_batch(batch))

        self.assertTrue(result["ok"])
        self.assertEqual(events, [("wait", 300000), ("upload", "208326100202")])

    def test_upload_approved_batch_recovers_previous_timeout_by_readback_without_upload(self):
        module = load_script()
        upload_styles = []
        recovered_styles = []

        async def fake_get_runner(*_args, **_kwargs):
            return SimpleNamespace(timeout=60)

        async def fake_upload_and_create(_runner, workflow, *_args, **_kwargs):
            upload_styles.append(workflow.style_code)
            return {}

        async def fake_recover(_runner, workflow, **kwargs):
            recovered_styles.append((workflow.style_code, kwargs.get("reason", "")))
            return {
                "uploaded": [{"url": f"https://img.example/{workflow.style_code}-1.jpg"} for _index in range(5)],
                "materials": [{"picUrl": f"https://img.example/{workflow.style_code}-1.jpg"} for _index in range(5)],
                "batchPayload": {"experimentTaskId": f"task-{workflow.style_code}"},
                "readback": {"total": 1},
                "readbackTaskSummary": {"status": "1", "testImageCount": 5, "online": True},
                "onlineResult": {"recoveredByReadback": True},
                "batchAddWarnings": ["历史提交显示 timeout，已通过天猫后台回读纠偏，未重复上传"],
                "error": "",
            }

        class Bridge:
            def __init__(self, _cdp_url):
                pass

            def is_available(self, timeout=5):
                return True

        with tempfile.TemporaryDirectory() as temp_dir:
            batch = {
                "batch_id": "batch-recover-timeout",
                "artifact_dir": temp_dir,
                "run_params": {},
                "submit_result_rows": [
                    {
                        "表格行号": 2,
                        "款号": "208326100202",
                        "商品ID": "1002178235142",
                        "阶段": "天猫上传/创建测图任务",
                        "执行结果": "天猫上传/创建失败",
                        "备注": "timeout",
                    },
                ],
                "items": [{
                    "style_code": "208326100202",
                    "item_id": "1002178235142",
                    "origin_path": "/tmp/main.jpg",
                    "workflow": {"row_no": 2, "style_code": "208326100202", "item_id": "1002178235142"},
                    "semir_data": {},
                    "assets": [
                        {
                            "id": "ai-1",
                            "kind": "ai",
                            "path": "/tmp/ai-1.jpg",
                            "status": "approved",
                            "generation_row": {"提示词序号": 1, "提示词字段名": "正面"},
                        },
                    ],
                }],
            }
            with patch.object(module, "CDPBridge", Bridge), \
                patch.object(module, "get_runner", fake_get_runner), \
                patch.object(module, "wait_for_tmall_api_ready", noop_wait_for_tmall_ready), \
                patch.object(module, "recover_tmall_submission_by_readback", fake_recover), \
                patch.object(module, "upload_and_create_tmall_task", fake_upload_and_create):
                result = asyncio.run(module.upload_approved_tmall_batch(batch))

        self.assertEqual(upload_styles, [])
        self.assertEqual(recovered_styles[0][0], "208326100202")
        self.assertTrue(result["ok"])
        self.assertEqual(result["attempted"], 1)
        self.assertEqual(result["succeeded"], 1)
        create_rows = [row for row in result["rows"] if row.get("阶段") == "天猫上传/创建测图任务"]
        self.assertEqual(create_rows[0]["执行结果"], "已创建/加素材/已上线")
        self.assertIn("后台回读", create_rows[0]["备注"])

    def test_generate_approval_asset_for_item_accepts_product_item_id(self):
        module = load_script()
        captured = {}

        def fake_generate(row, *_args, **_kwargs):
            captured["style_code"] = row["款号"]
            patched = dict(row)
            patched["生成图URL"] = "https://img.example/manual.jpg"
            patched["执行结果"] = "已生成"
            return patched

        def fake_download(row, artifact_dir):
            return [str(Path(artifact_dir) / f"{row['款号']}-ai-{row['__1xm_output_token']}.jpg")]

        with tempfile.TemporaryDirectory() as temp_dir:
            batch = {
                "batch_id": "batch-product-id",
                "task_run_uid": "run-current",
                "artifact_dir": temp_dir,
                "run_params": {},
                "items": [{
                    "id": "internal-item-1",
                    "style_code": "208326100202",
                    "item_id": "1002178235142",
                    "origin_path": "/tmp/main.jpg",
                    "workflow": {
                        "row_no": 2,
                        "style_code": "208326100202",
                        "item_id": "1002178235142",
                        "category": "长袖T恤",
                        "gender": "中性",
                    },
                    "assets": [{"id": "origin-1", "kind": "origin", "path": "/tmp/main.jpg"}],
                }],
            }
            with patch.object(module, "resolve_one_xm_settings", return_value={"2k": "unit-key", "4k": "unit-key-4k"}), \
                patch.object(module, "run_one_xm_generation_row", fake_generate), \
                patch.object(module, "download_generated_images", fake_download), \
                patch.object(module, "save_approval_batch"):
                asset = module.generate_approval_asset_for_item(
                    batch,
                    item_id="1002178235142",
                    prompt="manual prompt",
                    main_image_path="/tmp/main.jpg",
                )

        self.assertEqual(captured["style_code"], "208326100202")
        self.assertEqual(asset["task_run_uid"], "run-current")

    def test_regenerate_approval_asset_uses_fresh_1xm_key_and_current_batch_run(self):
        module = load_script()
        captured = {}

        def fake_generate(row, *_args, **_kwargs):
            captured["idempotency_key"] = row["__1xm_idempotency_key"]
            captured["output_token"] = row["__1xm_output_token"]
            captured["task_run_uid"] = row["__task_run_uid"]
            patched = dict(row)
            patched["生成图URL"] = "https://img.example/retry.jpg"
            patched["执行结果"] = "已生成"
            return patched

        def fake_download(row, artifact_dir):
            return [str(Path(artifact_dir) / f"{row['款号']}-ai-{row['__1xm_output_token']}.jpg")]

        with tempfile.TemporaryDirectory() as temp_dir:
            batch = {
                "batch_id": "batch-retry",
                "task_run_uid": "run-current",
                "artifact_dir": temp_dir,
                "run_params": {"retry_attempts": 1, "compensate_attempts": 1, "poll_timeout_minutes": 1},
                "items": [{
                    "id": "item-1",
                    "style_code": "208326100202",
                    "origin_path": "/tmp/main.jpg",
                    "assets": [{
                        "id": "ai-1",
                        "kind": "ai",
                        "path": "/tmp/old.jpg",
                        "status": "pending",
                        "prompt": "old prompt",
                        "generation_row": {
                            "款号": "208326100202",
                            "提示词分组": "上装",
                            "提示词字段名": "正面",
                            "提示词序号": 1,
                            "尺寸": "960x1280",
                            "格式": "jpeg",
                            "质量": "auto",
                            "参考图文件": "/tmp/main.jpg",
                            "最终提示词": "old prompt",
                            "完整Prompt": "old prompt",
                            "__1xm_key_tier": "2k",
                            "__1xm_idempotency_key": "old-key",
                            "__task_run_uid": "run-current",
                            "__1xm_payload": {"prompt": "old prompt", "size": "960x1280", "quality": "auto", "output_format": "jpeg", "n": 1},
                        },
                    }],
                }],
            }
            with patch.object(module, "resolve_one_xm_settings", return_value={"2k": "unit-key", "4k": "unit-key-4k"}), \
                patch.object(module, "run_one_xm_generation_row", fake_generate), \
                patch.object(module, "download_generated_images", fake_download), \
                patch.object(module, "save_approval_batch"):
                asset = module.regenerate_approval_asset(
                    batch,
                    "ai-1",
                    prompt="new prompt",
                    reference_paths=["/tmp/main.jpg"],
                )

        self.assertNotEqual(captured["idempotency_key"], "old-key")
        self.assertEqual(captured["task_run_uid"], "run-current")
        self.assertIn(captured["output_token"], asset["path"])
        self.assertEqual(asset["task_run_uid"], "run-current")
        self.assertEqual(asset["prompt"], "new prompt")
        self.assertEqual(asset["generation_row"]["__1xm_idempotency_key"], captured["idempotency_key"])

    def test_generate_approval_asset_for_item_appends_manual_ai_asset_to_current_batch(self):
        module = load_script()
        captured = {}

        def fake_generate(row, *_args, **_kwargs):
            captured.update({
                "prompt": row["完整Prompt"],
                "references": row["__1xm_reference_paths"],
                "task_run_uid": row["__task_run_uid"],
                "idempotency_key": row["__1xm_idempotency_key"],
                "output_token": row["__1xm_output_token"],
            })
            patched = dict(row)
            patched["生成图URL"] = "https://img.example/manual.jpg"
            patched["执行结果"] = "已生成"
            return patched

        def fake_download(row, artifact_dir):
            return [str(Path(artifact_dir) / f"{row['款号']}-ai-{row['__1xm_output_token']}.jpg")]

        with tempfile.TemporaryDirectory() as temp_dir:
            batch = {
                "batch_id": "batch-manual",
                "task_run_uid": "run-current",
                "artifact_dir": temp_dir,
                "run_params": {"image_size": "960x1280", "output_format": "jpeg", "quality": "low"},
                "items": [{
                    "id": "item-1",
                    "style_code": "208326100202",
                    "item_id": "1002178235142",
                    "origin_path": "/tmp/main.jpg",
                    "workflow": {
                        "row_no": 2,
                        "style_code": "208326100202",
                        "item_id": "1002178235142",
                        "category": "长袖T恤",
                        "gender": "中性",
                    },
                    "assets": [
                        {"id": "origin-1", "kind": "origin", "path": "/tmp/main.jpg"},
                        {"id": "detail-1", "kind": "detail_reference", "path": "/tmp/detail.jpg"},
                    ],
                }],
            }
            with patch.object(module, "resolve_one_xm_settings", return_value={"2k": "unit-key", "4k": "unit-key-4k"}), \
                patch.object(module, "run_one_xm_generation_row", fake_generate), \
                patch.object(module, "download_generated_images", fake_download), \
                patch.object(module, "save_approval_batch"):
                asset = module.generate_approval_asset_for_item(
                    batch,
                    item_id="item-1",
                    prompt="manual prompt",
                    main_image_path="/tmp/main.jpg",
                    reference_paths=["/tmp/detail.jpg"],
                )

        self.assertEqual(captured["prompt"], "manual prompt")
        self.assertEqual(captured["references"], ["/tmp/main.jpg", "/tmp/detail.jpg"])
        self.assertEqual(captured["task_run_uid"], "run-current")
        self.assertTrue(captured["idempotency_key"].isascii())
        self.assertEqual(asset["task_run_uid"], "run-current")
        self.assertTrue(asset["manual_added"])
        self.assertIn(captured["output_token"], asset["path"])
        self.assertEqual(len([item for item in batch["items"][0]["assets"] if item.get("kind") == "ai"]), 1)

    def test_generate_approval_asset_uses_gemini_model_key_from_cloud_run_params(self):
        module = load_script()
        captured = {}

        class FakeOneXMClient:
            def __init__(self, api_key, *, base_url=None):
                captured["api_key"] = api_key
                captured["base_url"] = base_url

        def fake_runner(client, payload, **kwargs):
            captured["payload"] = dict(payload)
            captured["idempotency_key"] = kwargs.get("idempotency_key")
            return {
                "ok": True,
                "task_id": "task-gemini",
                "poll_url": "https://1xm.example/tasks/task-gemini",
                "image_urls": ["https://img.example/gemini.jpg"],
            }

        def fake_download(row, artifact_dir):
            captured["result_row"] = dict(row)
            return [str(Path(artifact_dir) / "gemini.jpg")]

        with tempfile.TemporaryDirectory() as temp_dir:
            batch = {
                "batch_id": "batch-gemini",
                "task_run_uid": "run-gemini",
                "artifact_dir": temp_dir,
                "run_params": {
                    "model": "gemini-3-pro-image-preview",
                    "image_size": "2048x2048",
                    "output_format": "webp",
                    "quality": "high",
                },
                "items": [{
                    "id": "item-1",
                    "style_code": "208326100202",
                    "item_id": "1002178235142",
                    "origin_path": "/tmp/main.jpg",
                    "workflow": {
                        "row_no": 2,
                        "style_code": "208326100202",
                        "item_id": "1002178235142",
                        "category": "长袖T恤",
                        "gender": "中性",
                    },
                    "assets": [{"id": "origin-1", "kind": "origin", "path": "/tmp/main.jpg"}],
                }],
            }
            settings = {
                "2k": "",
                "4k": "",
                "ai.1xm.gemini_3_1_flash_image_preview_key": "",
                "ai.1xm.gemini_3_pro_image_preview_key": "gemini-pro-key",
            }
            with patch.object(module, "resolve_one_xm_settings", return_value=settings), \
                patch("core.api_server.OneXMImageClient", FakeOneXMClient), \
                patch("core.api_server.run_image_task_until_done", fake_runner), \
                patch.object(module, "download_generated_images", fake_download), \
                patch.object(module, "save_approval_batch"):
                asset = module.generate_approval_asset_for_item(
                    batch,
                    item_id="item-1",
                    prompt="manual prompt",
                    main_image_path="/tmp/main.jpg",
                )

        self.assertEqual(captured["api_key"], "gemini-pro-key")
        self.assertEqual(captured["payload"]["model"], "gemini-3-pro-image-preview")
        self.assertEqual(captured["payload"]["size"], "2048x2048")
        self.assertEqual(captured["payload"]["output_format"], "webp")
        self.assertEqual(captured["result_row"]["执行结果"], "已生成")
        self.assertNotIn("gemini-pro-key", json.dumps(asset, ensure_ascii=False))

    def test_upload_approved_batch_marks_create_failed_when_only_task_returns_error_with_task_id(self):
        module = load_script()

        async def fake_get_runner(*_args, **_kwargs):
            return SimpleNamespace(timeout=60)

        upload_calls = []

        async def fake_upload_and_create(*args, **_kwargs):
            upload_calls.append(args)
            return {
                "uploaded": [{"url": "https://img.example/main.jpg"}, {"url": "https://img.example/ai.jpg"}],
                "materials": [{"picUrl": "https://img.example/ai.jpg"}],
                "batchPayload": {"experimentTaskId": "41716301"},
                "readback": {"total": 1},
                "readbackTaskSummary": {"status": "-1", "testImageCount": 1},
                "error": "测图素材数量超过限制.3:4尺寸素材超过限制",
            }

        class Bridge:
            def __init__(self, _cdp_url):
                pass

            def is_available(self, timeout=5):
                return True

        with tempfile.TemporaryDirectory() as temp_dir:
            artifact_dir = Path(temp_dir)
            batch = {
                "batch_id": "batch-partial",
                "artifact_dir": str(artifact_dir),
                "run_params": {},
                "items": [{
                    "style_code": "208326100202",
                    "item_id": "1002178235142",
                    "origin_path": "/tmp/main.jpg",
                    "detail_reference_path": "",
                    "reference_mode": "main_only",
                    "workflow": {
                        "row_no": 2,
                        "style_code": "208326100202",
                        "item_id": "1002178235142",
                        "category": "长袖T恤",
                        "gender": "中性",
                    },
                    "semir_data": {},
                    "assets": [
                        {"id": "origin-1", "kind": "origin", "path": "/tmp/main.jpg"},
                        {
                            "id": "ai-1",
                            "kind": "ai",
                            "path": "/tmp/ai-1.jpg",
                            "status": "approved",
                            "generation_row": {"提示词序号": 1, "提示词字段名": "正面"},
                        },
                    ],
                }],
            }
            with patch.object(module, "CDPBridge", Bridge), \
                patch.object(module, "get_runner", fake_get_runner), \
                patch.object(module, "wait_for_tmall_api_ready", noop_wait_for_tmall_ready), \
                patch.object(module, "upload_and_create_tmall_task", fake_upload_and_create):
                result = asyncio.run(module.upload_approved_tmall_batch(batch))
            self.assertFalse(result["ok"])
            self.assertEqual(result["status"], "create_failed")
            self.assertEqual(result["attempted"], 1)
            self.assertEqual(result["succeeded"], 0)
            self.assertEqual(result["failed"], 1)
            self.assertEqual(batch["status"], "create_failed")
            self.assertEqual(upload_calls[0][2], "/tmp/main.jpg")
            self.assertEqual(upload_calls[0][3], ["/tmp/ai-1.jpg"])
            self.assertTrue(Path(batch["submit_result_path"]).is_file())
            self.assertTrue(Path(batch["submit_result_excel_path"]).is_file())
            self.assertTrue(str(batch["submit_result_excel_path"]).endswith(".xlsx"))
            self.assertEqual(result["result_path"], batch["submit_result_excel_path"])
            self.assertEqual(result["excel_path"], batch["submit_result_excel_path"])
            self.assertEqual(result["audit_path"], batch["submit_result_path"])
            create_rows = [row for row in result["rows"] if row.get("阶段") == "天猫上传/创建测图任务"]
            self.assertEqual(create_rows[0]["任务ID"], "41716301")
            self.assertEqual(create_rows[0]["执行结果"], "天猫上传/创建失败")

    def test_upload_approved_batch_does_not_count_material_only_task_as_success(self):
        module = load_script()

        async def fake_get_runner(*_args, **_kwargs):
            return SimpleNamespace(timeout=60)

        async def fake_upload_and_create(*_args, **_kwargs):
            return {
                "uploaded": [{"url": "https://img.example/main.jpg"}, {"url": "https://img.example/ai.jpg"}],
                "materials": [{"picUrl": "https://img.example/ai.jpg"}],
                "batchPayload": {"experimentTaskId": "41716301"},
                "readback": {"total": 1},
                "readbackTaskSummary": {"status": "-1", "testImageCount": 1, "online": False},
                "onlineResult": None,
                "error": "",
            }

        class Bridge:
            def __init__(self, _cdp_url):
                pass

            def is_available(self, timeout=5):
                return True

        with tempfile.TemporaryDirectory() as temp_dir:
            artifact_dir = Path(temp_dir)
            batch = {
                "batch_id": "batch-material-only",
                "artifact_dir": str(artifact_dir),
                "run_params": {},
                "items": [{
                    "style_code": "208326100202",
                    "item_id": "1002178235142",
                    "origin_path": "/tmp/main.jpg",
                    "detail_reference_path": "",
                    "reference_mode": "main_only",
                    "workflow": {
                        "row_no": 2,
                        "style_code": "208326100202",
                        "item_id": "1002178235142",
                        "category": "长袖T恤",
                        "gender": "中性",
                    },
                    "semir_data": {},
                    "assets": [
                        {"id": "origin-1", "kind": "origin", "path": "/tmp/main.jpg"},
                        {
                            "id": "ai-1",
                            "kind": "ai",
                            "path": "/tmp/ai-1.jpg",
                            "status": "approved",
                            "generation_row": {"提示词序号": 1, "提示词字段名": "正面"},
                        },
                    ],
                }],
            }
            with patch.object(module, "CDPBridge", Bridge), \
                patch.object(module, "get_runner", fake_get_runner), \
                patch.object(module, "wait_for_tmall_api_ready", noop_wait_for_tmall_ready), \
                patch.object(module, "upload_and_create_tmall_task", fake_upload_and_create):
                result = asyncio.run(module.upload_approved_tmall_batch(batch))

            self.assertFalse(result["ok"])
            self.assertEqual(result["status"], "create_failed")
            self.assertEqual(result["succeeded"], 0)
            self.assertEqual(result["failed"], 1)
            create_rows = [row for row in result["rows"] if row.get("阶段") == "天猫上传/创建测图任务"]
            self.assertEqual(create_rows[0]["执行结果"], "天猫上传/创建失败")
            self.assertIn("未上线", create_rows[0]["备注"])

    def test_upload_approved_batch_sends_dingtalk_summary_with_success_detail_urls(self):
        module = load_script()
        from core import notifier as core_notifier

        async def fake_get_runner(*_args, **_kwargs):
            return SimpleNamespace(timeout=60)

        async def fake_upload_and_create(_runner, workflow, *_args, **_kwargs):
            if workflow.style_code == "208326100202":
                return {
                    "uploaded": [{"url": "https://img.example/main.jpg"}, {"url": "https://img.example/ai.jpg"}],
                    "materials": [{"picUrl": "https://img.example/ai.jpg"}],
                    "batchPayload": {"experimentTaskId": "41716301"},
                    "readback": {"total": 1},
                    "readbackTaskSummary": {"status": "1", "testImageCount": 5, "online": True},
                    "onlineResult": {"ok": True},
                    "error": "",
                }
            return {
                "uploaded": [{"url": "https://img.example/main.jpg"}],
                "materials": [],
                "batchPayload": {"experimentTaskId": "41733207"},
                "readback": {"total": 1},
                "readbackTaskSummary": {"status": "-1", "testImageCount": 0, "online": False},
                "onlineResult": None,
                "error": "任务未上线，未开始测试",
            }

        class Bridge:
            def __init__(self, _cdp_url):
                pass

            def is_available(self, timeout=5):
                return True

        with tempfile.TemporaryDirectory() as temp_dir:
            batch = {
                "batch_id": "batch-notify-submit",
                "artifact_dir": temp_dir,
                "run_params": {"approval_notify_channel": "dingtalk"},
                "items": [
                    {
                        "style_code": "208326100202",
                        "item_id": "1002178235142",
                        "origin_path": "/tmp/main-1.jpg",
                        "detail_reference_path": "",
                        "reference_mode": "main_only",
                        "workflow": {
                            "row_no": 2,
                            "style_code": "208326100202",
                            "item_id": "1002178235142",
                            "category": "长袖T恤",
                            "gender": "中性",
                        },
                        "semir_data": {},
                        "assets": [
                            {
                                "id": "ai-1",
                                "kind": "ai",
                                "path": "/tmp/ai-1.jpg",
                                "status": "approved",
                                "generation_row": {"提示词序号": 1, "提示词字段名": "正面"},
                            },
                        ],
                    },
                    {
                        "style_code": "208326108101",
                        "item_id": "1061920756107",
                        "origin_path": "/tmp/main-2.jpg",
                        "detail_reference_path": "",
                        "reference_mode": "main_only",
                        "workflow": {
                            "row_no": 3,
                            "style_code": "208326108101",
                            "item_id": "1061920756107",
                            "category": "长袖T恤",
                            "gender": "中性",
                        },
                        "semir_data": {},
                        "assets": [
                            {
                                "id": "ai-2",
                                "kind": "ai",
                                "path": "/tmp/ai-2.jpg",
                                "status": "approved",
                                "generation_row": {"提示词序号": 1, "提示词字段名": "正面"},
                            },
                        ],
                    },
                ],
            }
            send_calls = []

            def fake_send(*_args, **kwargs):
                send_calls.append(kwargs)

            with patch.object(module, "CDPBridge", Bridge), \
                patch.object(module, "get_runner", fake_get_runner), \
                patch.object(module, "wait_for_tmall_api_ready", noop_wait_for_tmall_ready), \
                patch.object(module, "upload_and_create_tmall_task", fake_upload_and_create), \
                patch.object(core_notifier, "send", fake_send):
                result = asyncio.run(module.upload_approved_tmall_batch(batch))

        self.assertEqual(result["status"], "partial_failed")
        self.assertEqual(result["succeeded"], 1)
        self.assertEqual(result["failed"], 1)
        self.assertEqual(len(send_calls), 1)
        self.assertEqual(send_calls[0]["channel"], "dingtalk")
        message = send_calls[0]["message"]
        self.assertIn("尝试 2 款 / 成功 1 款 / 失败 1 款", message)
        self.assertIn("208326100202", message)
        self.assertIn(
            "https://myseller.taobao.com/home.htm/material-center/material-test/common_test"
            "?testStatus=1&testChannel=common_search&tab=all&itemId=1002178235142",
            message,
        )
        self.assertIn("208326108101", message)

    def test_upload_approved_batch_persists_submit_progress_while_creating_tasks(self):
        module = load_script()

        async def fake_get_runner(*_args, **_kwargs):
            return SimpleNamespace()

        async def fake_upload_and_create(*args, **_kwargs):
            self.assertGreaterEqual(args[0].timeout, 120)
            workflow = args[1]
            return {
                "uploaded": [{"url": "https://img.example/main.jpg"}, {"url": f"https://img.example/{workflow.style_code}.jpg"}],
                "materials": [{"picUrl": f"https://img.example/{workflow.style_code}.jpg"}],
                "batchPayload": {"experimentTaskId": f"task-{workflow.style_code}"},
                "readback": {"total": 1},
                "readbackTaskSummary": {"status": "1", "testImageCount": 1, "online": True},
                "onlineResult": {"ok": True},
                "error": "",
            }

        class Bridge:
            def __init__(self, _cdp_url):
                pass

            def is_available(self, timeout=5):
                return True

        with tempfile.TemporaryDirectory() as temp_dir:
            artifact_dir = Path(temp_dir)
            items = []
            for index, style_code in enumerate(["208326100202", "208326108101"], start=2):
                items.append({
                    "style_code": style_code,
                    "item_id": f"100217823514{index}",
                    "origin_path": f"/tmp/{style_code}-main.jpg",
                    "detail_reference_path": "",
                    "reference_mode": "main_only",
                    "workflow": {
                        "row_no": index,
                        "style_code": style_code,
                        "item_id": f"100217823514{index}",
                        "category": "长袖T恤",
                        "gender": "中性",
                    },
                    "semir_data": {},
                    "assets": [
                        {"id": f"origin-{index}", "kind": "origin", "path": f"/tmp/{style_code}-main.jpg"},
                        {
                            "id": f"ai-{index}",
                            "kind": "ai",
                            "path": f"/tmp/{style_code}-ai-1.jpg",
                            "status": "approved",
                            "generation_row": {"提示词序号": 1, "提示词字段名": "正面"},
                        },
                    ],
                })
            batch = {
                "batch_id": "batch-progress",
                "artifact_dir": str(artifact_dir),
                "run_params": {},
                "items": items,
            }
            snapshots = []

            def capture_progress(next_batch):
                snapshots.append(dict(next_batch.get("submit_progress") or {}))

            with patch.object(module, "CDPBridge", Bridge), \
                patch.object(module, "get_runner", fake_get_runner), \
                patch.object(module, "wait_for_tmall_api_ready", noop_wait_for_tmall_ready), \
                patch.object(module, "upload_and_create_tmall_task", fake_upload_and_create), \
                patch.object(module, "save_approval_batch", capture_progress):
                result = asyncio.run(module.upload_approved_tmall_batch(batch))

            self.assertTrue(result["ok"])
            running = [item for item in snapshots if item.get("status") == "running"]
            self.assertTrue(running)
            self.assertEqual(running[0]["total"], 2)
            self.assertEqual(running[0]["completed"], 0)
            self.assertTrue(any(item.get("completed") == 1 for item in running))
            self.assertEqual(snapshots[-1]["status"], "completed")
            self.assertEqual(snapshots[-1]["succeeded"], 2)

    def test_tmall_upload_reuses_stopped_task_and_replaces_old_images_by_default(self):
        module = load_script()
        code = module.js_call(module.TMALL_UPLOAD_CREATE_JS, {
            "style_code": "208326100202",
            "item_id": "1002178235142",
            "files": [{
                "name": "208326100202-ai-1.jpg",
                "role": "ai",
                "localPath": "/tmp/ai-1.jpg",
                "dataUrl": "data:image/jpeg;base64,AA==",
            }],
            "live_upload": True,
            "live_create": True,
            "live_online": True,
            "folder_id": "0",
            "upload_delay_ms": 0,
            "create_delay_ms": 0,
            "batch_delay_ms": 0,
            "readback_delay_ms": 0,
        })
        node_script = f"""
;(async () => {{
  const code = {json.dumps(code, ensure_ascii=False)};
  const calls = [];
  let online = false;
  const stoppedRow = {{
    domainId: '1002178235142',
    columns: {{
      test_data: {{
        dataList: [{{
          imageTestSource: 'common_search',
          experimentTaskId: 41716301,
          testStatus: -1,
          originImageMetrics: {{
            '3:4': [{{ imageId: 100, imageIds: [100], imageUrl: 'https://img.example/origin.jpg' }}],
          }},
          testImageMetrics: {{
            '3:4': [
              {{ imageId: 201, imageIds: [201], imageUrl: 'https://img.example/old-1.jpg' }},
              {{ imageId: 202, imageIds: [202], imageUrl: 'https://img.example/old-2.jpg' }},
              {{ imageId: 203, imageIds: [203], imageUrl: 'https://img.example/old-3.jpg' }},
              {{ imageId: 204, imageIds: [204], imageUrl: 'https://img.example/old-4.jpg' }},
              {{ imageId: 205, imageIds: [205], imageUrl: 'https://img.example/old-5.jpg' }},
            ],
          }},
        }}],
      }},
    }},
  }};
  global.document = {{ cookie: '_tb_token_=token-test' }};
  global.fetch = async (url) => {{
    const raw = String(url);
    if (raw.startsWith('data:')) {{
      return {{ ok: true, async blob() {{ return new Blob(['image'], {{ type: 'image/jpeg' }}); }} }};
    }}
    if (raw.startsWith('https://stream-upload.taobao.com/api/upload.api')) {{
      return {{
        ok: true,
        async text() {{
          return JSON.stringify({{ success: true, object: {{ url: '//img.example/new-ai.jpg', fileId: 'new-1', pix: '960x1280' }} }});
        }},
      }};
    }}
    throw new Error('unexpected fetch ' + raw);
  }};
  global.window = {{
    lib: {{
      mtop: {{
        async request(request) {{
          calls.push({{ api: request.api, data: request.data }});
          if (request.api === 'mtop.taobao.qn.copilot.framework.listmodel.data.search') {{
            const params = JSON.parse(request.data.params || '{{}}');
            if (params.testStatus === '0') return {{ data: {{ result: {{ total: online ? 0 : 1, list: online ? [] : [stoppedRow] }} }} }};
            if (params.testStatus === '1') return {{ data: {{ result: {{ total: online ? 1 : 0, list: online ? [stoppedRow] : [] }} }} }};
            return {{ data: {{ result: {{ total: 0, list: [] }} }} }};
          }}
          if (request.api === 'mtop.taobao.qn.copilot.test.image.task.create') {{
            throw new Error('should reuse the stopped task instead of creating a fresh one');
          }}
          if (request.api === 'mtop.taobao.qn.copilot.test.image.batch.delete') {{
            return {{ data: {{ ok: true }} }};
          }}
          if (request.api === 'mtop.taobao.qn.copilot.test.image.batch.add') {{
            return {{ data: {{ ok: true }} }};
          }}
          if (request.api === 'mtop.taobao.qn.copilot.test.image.task.online') {{
            online = true;
            return {{ data: {{ ok: true }} }};
          }}
          throw new Error('unexpected mtop ' + request.api);
        }},
      }},
    }},
  }};
  const result = await eval(code);
  if (!result.success) throw new Error(result.error || 'mocked tmall upload failed');
  const data = result.data[0];
  process.stdout.write(JSON.stringify({{
	    error: data.error,
	    reusedTaskId: data.reusedExistingTask && data.reusedExistingTask.experimentTaskId,
	    clearedMaterialIds: data.clearedMaterialIds,
    apis: calls.map((call) => call.api),
    deleteMaterialIds: calls
      .filter((call) => call.api === 'mtop.taobao.qn.copilot.test.image.batch.delete')
      .map((call) => call.data.materialIds),
    addPayloads: calls
      .filter((call) => call.api === 'mtop.taobao.qn.copilot.test.image.batch.add')
      .map((call) => call.data),
    onlinePayloads: calls
      .filter((call) => call.api === 'mtop.taobao.qn.copilot.test.image.task.online')
      .map((call) => call.data),
  }}));
}})().catch((error) => {{
  console.error(error && error.stack || error);
  process.exit(1);
}});
"""
        completed = subprocess.run(["node"], input=node_script, text=True, capture_output=True, check=True)
        payload = json.loads(completed.stdout)

        self.assertEqual(payload["error"], "")
        self.assertEqual(payload["reusedTaskId"], "41716301")
        self.assertEqual(payload["clearedMaterialIds"], ["201", "202", "203", "204", "205"])
        self.assertNotIn("mtop.taobao.qn.copilot.test.image.task.create", payload["apis"])
        self.assertEqual(payload["deleteMaterialIds"], ["201", "202", "203", "204", "205"])
        self.assertEqual(payload["addPayloads"][0]["experimentTaskId"], "41716301")
        self.assertIn("new-ai.jpg", payload["addPayloads"][0]["materials"])
        self.assertIn('"experimentTaskId":"41716301"', payload["onlinePayloads"][0]["taskStatusList"])

    def test_tmall_readback_dedupes_material_id_and_image_ids_for_same_image(self):
        module = load_script()
        code = module.js_call(module.TMALL_SUBMISSION_READBACK_JS, {
            "item_id": "1002178235142",
            "expected_test_images": 1,
            "reason": "unit-test",
        })
        node_script = f"""
;(async () => {{
  const code = {json.dumps(code, ensure_ascii=False)};
  global.window = {{
    lib: {{
      mtop: {{
        async request(request) {{
          if (request.api !== 'mtop.taobao.qn.copilot.framework.listmodel.data.search') {{
            throw new Error('unexpected mtop ' + request.api);
          }}
          return {{
            data: {{
              result: {{
                total: 1,
                list: [{{
                  domainId: '1002178235142',
                  columns: {{
                    test_data: {{
                      dataList: [{{
                        imageTestSource: 'common_search',
                        experimentTaskId: 41716301,
                        testStatus: 1,
                        originImageMetrics: {{}},
                        testImageMetrics: {{
                          '3:4': [{{
                            imageId: 201,
                            imageIds: [201],
                            imageUrl: 'https://img.example/ai-1.jpg',
                          }}],
                        }},
                      }}],
                    }},
                  }},
                }}],
              }},
            }},
          }};
        }},
      }},
    }},
  }};
  const result = await eval(code);
  if (!result.success) throw new Error(result.error || 'mocked readback failed');
  const data = result.data[0];
  process.stdout.write(JSON.stringify({{
    uploaded: data.uploaded.length,
    materials: data.materials.length,
    summary: data.readbackTaskSummary,
  }}));
}})().catch((error) => {{
  console.error(error && error.stack || error);
  process.exit(1);
}});
"""
        completed = subprocess.run(["node"], input=node_script, text=True, capture_output=True, check=True)
        payload = json.loads(completed.stdout)

        self.assertEqual(payload["uploaded"], 1)
        self.assertEqual(payload["materials"], 1)
        self.assertEqual(payload["summary"]["testImageCount"], 1)

    def test_workflow_aliases_match_user_import_template_headers(self):
        module = load_script()
        table = {
            "headers": ["款号", "SKC编码", "ID（用于测图的ID）", "品类（后期匹配）", "模特性别"],
            "rows": [{
                "款号": "208326100202",
                "SKC编码": "208326100202-00482",
                "ID（用于测图的ID）": "1002178235142",
                "品类（后期匹配）": "长袖T恤",
                "模特性别": "中性",
            }],
        }

        rows, invalid = module.normalize_workflow_rows(table)

        self.assertEqual(invalid, [])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].style_code, "208326100202")
        self.assertEqual(rows[0].item_id, "1002178235142")
        self.assertEqual(rows[0].category, "长袖T恤")
        self.assertEqual(rows[0].gender, "中性")
        self.assertEqual(rows[0].skc_code, "208326100202-00482")

    def test_workflow_rows_default_to_all_valid_rows_without_processing_limit(self):
        module = load_script()
        table = {
            "headers": ["款号", "ID（用于测图的ID）", "品类（后期匹配）", "模特性别"],
            "rows": [
                {"款号": f"20832610020{i}", "ID（用于测图的ID）": f"100{i}", "品类（后期匹配）": "长袖T恤", "模特性别": "中性"}
                for i in range(6)
            ],
        }

        rows, invalid = module.normalize_workflow_rows(table)

        self.assertEqual(invalid, [])
        self.assertEqual(len(rows), 6)
        self.assertEqual(rows[-1].style_code, "208326100205")

    def test_category_mapping_for_current_workflow_table_values(self):
        module = load_script()

        self.assertEqual(module.category_to_prompt_sheet("长袖T恤"), "上装")
        self.assertEqual(module.category_to_prompt_sheet("羽绒服"), "上装")
        self.assertEqual(module.category_to_prompt_sheet("长裤"), "下装")
        self.assertEqual(module.category_to_prompt_sheet("外套"), "上装")
        self.assertEqual(module.category_to_prompt_sheet("毛衫"), "上装")

    def test_generation_row_keeps_three_four_material_image_size_and_ascii_idempotency_key(self):
        module = load_script()
        workflow = module.WorkflowItem(2, "208326100202", "1002178235142", "长袖T恤", "中性")
        prompt = module.PromptItem("上装", "正面标准站姿", 4, "2K", "jpeg", "严格保留原图衣服图案", 1, 8)

        row = module.make_generation_row(
            workflow,
            prompt,
            ["/tmp/origin.jpg", "/tmp/detail-flat.jpg"],
            image_size="960x1280",
            quality="low",
            output_format="jpeg",
            key_tier="2k",
            run_nonce="run-A",
        )
        next_run_row = module.make_generation_row(
            workflow,
            prompt,
            ["/tmp/origin.jpg", "/tmp/detail-flat.jpg"],
            image_size="960x1280",
            quality="low",
            output_format="jpeg",
            key_tier="2k",
            run_nonce="run-B",
        )
        large_three_four_row = module.make_generation_row(
            workflow,
            prompt,
            "/tmp/origin.jpg",
            image_size="1536x2048",
            ratio="3:4",
            quality="high",
            output_format="jpeg",
            key_tier="4k",
            run_nonce="run-C",
        )

        self.assertEqual(row["尺寸"], "960x1280")
        self.assertEqual(row["格式"], "jpeg")
        self.assertEqual(row["质量"], "low")
        self.assertEqual(row["比例"], "3:4")
        self.assertEqual(row["完整Prompt"], row["最终提示词"])
        self.assertEqual(row["__1xm_payload"]["n"], 1)
        self.assertEqual(row["__1xm_payload"]["ratio"], "3:4")
        self.assertEqual(row["主参考图文件"], "/tmp/origin.jpg")
        self.assertEqual(row["细节参考图文件"], "/tmp/detail-flat.jpg")
        self.assertEqual(row["__1xm_reference_paths"], ["/tmp/origin.jpg", "/tmp/detail-flat.jpg"])
        self.assertEqual(row["__1xm_key_tier"], "2k")
        self.assertEqual(row["__task_run_uid"], "run-A")
        self.assertTrue(row["__1xm_idempotency_key"].isascii())
        self.assertNotEqual(row["__1xm_idempotency_key"], next_run_row["__1xm_idempotency_key"])
        self.assertEqual(large_three_four_row["尺寸"], "1536x2048")
        self.assertEqual(large_three_four_row["比例"], "3:4")
        self.assertEqual(large_three_four_row["质量"], "high")
        self.assertEqual(large_three_four_row["__1xm_key_tier"], "4k")
        self.assertEqual(large_three_four_row["__1xm_payload"]["size"], "1536x2048")
        self.assertEqual(large_three_four_row["__1xm_payload"]["ratio"], "3:4")

    def test_select_prompts_returns_four_prompts_by_priority(self):
        module = load_script()
        workflow = module.WorkflowItem(2, "208326100202", "1002178235142", "长袖T恤", "女")
        prompts = [
            module.PromptItem("上装", "优先3", 3, "2K", "jpeg", "p3", 3, 30),
            module.PromptItem("上装", "优先1", 1, "2K", "jpeg", "p1", 1, 10),
            module.PromptItem("上装", "优先5", 5, "2K", "jpeg", "p5", 5, 50),
            module.PromptItem("上装", "优先2", 2, "2K", "jpeg", "p2", 2, 20),
            module.PromptItem("上装", "优先4", 4, "2K", "jpeg", "p4", 4, 40),
        ]

        selected = module.select_prompts(workflow, prompts, 4)

        self.assertEqual([item.field_name for item in selected], ["优先1", "优先2", "优先3", "优先4"])

    def test_run_chain_finds_all_semir_images_before_generation_confirmation(self):
        module = load_script()
        logs: list[str] = []
        progress_events: list[dict] = []
        workflow_table = {
            "headers": ["款号", "ID（用于测图的ID）", "品类（后期匹配）", "模特性别"],
            "rows": [
                {"款号": "208326100202", "ID（用于测图的ID）": "1001", "品类（后期匹配）": "长袖T恤", "模特性别": "中性"},
                {"款号": "208326108101", "ID（用于测图的ID）": "1002", "品类（后期匹配）": "长袖T恤", "模特性别": "中性"},
            ],
        }
        prompts = [
            module.PromptItem("上装", "优先1", 1, "2K", "jpeg", "p1", 1, 1),
            module.PromptItem("上装", "优先2", 2, "2K", "jpeg", "p2", 2, 2),
        ]

        class Bridge:
            def __init__(self, _cdp_url):
                pass

            def is_available(self, timeout=5):
                return True

        async def fake_get_runner(*_args, **_kwargs):
            return SimpleNamespace()

        async def fake_wait_for_semir_ready(*_args, **_kwargs):
            return None

        download_detail_values = []

        async def fake_find_semir(_runner, workflow, *_args, **kwargs):
            download_detail_values.append(kwargs.get("download_detail"))
            return (
                {
                    "chosenMain": {"filename": f"{workflow.style_code}.jpg"},
                    "chosenDetail": {"filename": f"{workflow.style_code}-flat.jpg"},
                },
                f"/tmp/{workflow.style_code}-main.jpg",
                f"/tmp/{workflow.style_code}-flat.jpg",
            )

        def fake_generate(row, *_args, **_kwargs):
            patched = dict(row)
            patched["执行结果"] = "生图完成"
            return patched

        def fake_download(row, _artifact_dir):
            return [f"/tmp/{row['款号']}-ai-{row['提示词序号']}.jpg"]

        async def wait_for_control(payload):
            progress_events.append(payload)

        args = SimpleNamespace(
            execute_mode="approval_then_create",
            workflow_file="/tmp/workflow.xlsx",
            prompt_file="/tmp/prompts.xlsx",
            cloud_path="巴拉营运BU-商品//巴拉货控/2026年巴拉秋/",
            cdp_url="http://127.0.0.1:9222",
            image_size="960x1280",
            ai_image_count=2,
            generation_concurrency=100,
            reference_mode="main_only",
            allow_global_semir_fallback=False,
            quality="auto",
            output_format="jpeg",
            one_xm_key_tier="auto",
            retry_attempts=1,
            compensate_attempts=1,
            poll_timeout_minutes=1,
            tmall_upload_delay_seconds=0,
            tmall_create_delay_seconds=0,
            tmall_batch_delay_seconds=0,
            tmall_readback_delay_seconds=0,
            approval_message_template="",
            approval_notify_channel="none",
            approval_base_url="http://127.0.0.1:18765",
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(module, "read_workbook_table", return_value=workflow_table), \
                patch.object(module, "read_prompt_library", return_value=prompts), \
                patch.object(module, "CDPBridge", Bridge), \
                patch.object(module, "get_runner", fake_get_runner), \
                patch.object(module, "wait_for_semir_api_ready", fake_wait_for_semir_ready), \
                patch.object(module, "resolve_one_xm_settings", return_value={"2k": "unit-key", "4k": "unit-key-4k"}), \
                patch.object(module, "find_semir_references", fake_find_semir), \
                patch.object(module, "run_one_xm_generation_row", fake_generate), \
                patch.object(module, "download_generated_images", fake_download):
                rows = asyncio.run(module.run_chain_rows(
                    args,
                    Path(temp_dir),
                    log=logs.append,
                    wait_for_control=wait_for_control,
                ))

        find_indexes = [index for index, line in enumerate(logs) if "森马云盘找图" in line]
        generation_indexes = [index for index, line in enumerate(logs) if "1XM 生图提交" in line]
        self.assertEqual(len(find_indexes), 2)
        self.assertEqual(download_detail_values, [True, True])
        self.assertEqual(generation_indexes, [])
        self.assertFalse(any("1XM 生图批量提交" in line for line in logs))
        self.assertTrue(any(event.get("shared", {}).get("generation_total_jobs") == 0 for event in progress_events))
        self.assertTrue(any(row.get("阶段") == "确认提交生图" for row in rows))
        self.assertTrue(any(row.get("执行结果") == "等待确认提交生图任务" for row in rows))

    def test_select_prompts_skips_multi_item_prompts_by_default(self):
        module = load_script()
        workflow = module.WorkflowItem(2, "208326100202", "1002178235142", "长袖T恤", "中性")
        prompts = [
            module.PromptItem("上装", "动态展示", 1, "2K", "jpeg", "只生成当前主商品", 1, 1),
            module.PromptItem("上装", "创意拍1", 2, "2K", "jpeg", "以{{衣服1}}、{{衣服2}}为参考生成多件衣服效果图", 2, 2),
            module.PromptItem("上装", "坐姿展示", 3, "2K", "jpeg", "保留主商品颜色", 3, 3),
        ]

        selected = module.select_prompts(workflow, prompts, 3)

        self.assertEqual([item.field_name for item in selected], ["动态展示", "坐姿展示"])

    def test_semir_main_matching_excludes_color_ai_derivatives(self):
        module = load_script()
        code = module.js_call(module.SEMIR_FIND_JS, {
            "style_code": "208326100202",
            "skc_code": "",
            "cloud_path": "巴拉营运BU-商品//巴拉货控/2026年巴拉秋/",
            "limit": 8,
        })
        node_script = f"""
;(async () => {{
  const code = {json.dumps(code, ensure_ascii=False)};
  const searchItems = [
    {{
      filename: '橱窗1&颜色AI-4.jpg',
      fullpath: '巴拉货控/2026年巴拉秋/208326100202/橱窗1&颜色AI-4.jpg',
      ext: 'jpg',
    }},
    {{
      filename: '橱窗1.jpg',
      fullpath: '巴拉货控/2026年巴拉秋/208326100202/橱窗1.jpg',
      ext: 'jpg',
    }},
  ];
  const response = (payload) => ({{
    ok: true,
    async text() {{ return JSON.stringify(payload); }},
  }});
  const fetchedUrls = [];
  let mountAttempts = 0;
  global.fetch = async (url) => {{
    fetchedUrls.push(String(url));
    const path = new URL(String(url), 'https://fmp.semirapp.com').pathname;
    if (path === '/fengcloud/1/account/mount') {{
      mountAttempts += 1;
      if (mountAttempts === 1) throw new TypeError('Failed to fetch');
      return response({{ list: [{{ mount_id: 'm1', name: '巴拉营运BU-商品' }}] }});
    }}
    if (path === '/fengcloud/2/file/search') {{
      return response({{ list: searchItems, total: searchItems.length }});
    }}
    if (path.includes('/file/list') || path.includes('/file/ls')) {{
      return response({{ list: [], total: 0 }});
    }}
    if (path.startsWith('/fengcloud/2/file/info')) {{
      return response({{ url: 'https://example.com/source.jpg' }});
    }}
    return response({{ list: [], total: 0 }});
  }};
  const result = await eval(code);
  if (!result.success) throw new Error(result.error || 'mocked semir find failed');
  process.stdout.write(JSON.stringify({{
    chosen: result.data[0].chosenMain && result.data[0].chosenMain.filename,
    mainCandidates: result.data[0].mainCandidates.map((item) => item.filename),
    mountUrl: fetchedUrls.find((url) => String(url).includes('/fengcloud/1/account/mount')) || '',
    mountAttempts,
  }}));
}})().catch((error) => {{
  console.error(error && error.stack || error);
  process.exit(1);
}});
"""
        completed = subprocess.run(["node"], input=node_script, text=True, capture_output=True, check=True)
        payload = json.loads(completed.stdout)

        self.assertEqual(payload["chosen"], "橱窗1.jpg")
        self.assertTrue(payload["mountUrl"].startswith("https://fmp.semirapp.com/fengcloud/1/account/mount"))
        self.assertEqual(payload["mountAttempts"], 2)
        self.assertNotIn("橱窗1&颜色AI-4.jpg", payload["mainCandidates"])

    def test_semir_main_matching_accepts_yz1_without_parentheses(self):
        module = load_script()
        code = module.js_call(module.SEMIR_FIND_JS, {
            "style_code": "208326100202",
            "skc_code": "",
            "cloud_path": "巴拉营运BU-商品//巴拉货控/2026年巴拉秋/",
            "limit": 8,
        })
        node_script = f"""
;(async () => {{
  const code = {json.dumps(code, ensure_ascii=False)};
  const searchItems = [
    {{
      filename: 'yz2.jpg',
      fullpath: '巴拉货控/2026年巴拉秋/208326100202-已选/yz2.jpg',
      ext: 'jpg',
    }},
    {{
      filename: 'yz1.jpg',
      fullpath: '巴拉货控/2026年巴拉秋/208326100202-已选/yz1.jpg',
      ext: 'jpg',
    }},
  ];
  const response = (payload) => ({{
    ok: true,
    async text() {{ return JSON.stringify(payload); }},
  }});
  global.fetch = async (url) => {{
    const path = new URL(String(url), 'https://fmp.semirapp.com').pathname;
    if (path === '/fengcloud/1/account/mount') {{
      return response({{ list: [{{ mount_id: 'm1', name: '巴拉营运BU-商品' }}] }});
    }}
    if (path === '/fengcloud/2/file/search') {{
      return response({{ list: searchItems, total: searchItems.length }});
    }}
    if (path.includes('/file/list') || path.includes('/file/ls')) {{
      return response({{ list: [], total: 0 }});
    }}
    if (path.startsWith('/fengcloud/2/file/info')) {{
      return response({{ url: 'https://example.com/source.jpg' }});
    }}
    return response({{ list: [], total: 0 }});
  }};
  const result = await eval(code);
  if (!result.success) throw new Error(result.error || 'mocked semir find failed');
  process.stdout.write(JSON.stringify({{
    chosen: result.data[0].chosenMain && result.data[0].chosenMain.filename,
    mainCandidates: result.data[0].mainCandidates.map((item) => item.filename),
  }}));
}})().catch((error) => {{
  console.error(error && error.stack || error);
  process.exit(1);
}});
"""
        completed = subprocess.run(["node"], input=node_script, text=True, capture_output=True, check=True)
        payload = json.loads(completed.stdout)

        self.assertEqual(payload["chosen"], "yz1.jpg")
        self.assertEqual(payload["mainCandidates"], ["yz1.jpg"])

    def test_semir_main_matching_prefers_yz1_with_parentheses_over_bare_yz1(self):
        module = load_script()
        code = module.js_call(module.SEMIR_FIND_JS, {
            "style_code": "208426103204",
            "skc_code": "",
            "cloud_path": "巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/",
            "limit": 8,
        })
        node_script = f"""
;(async () => {{
  const code = {json.dumps(code, ensure_ascii=False)};
  const searchItems = [
    {{
      filename: 'yz1.jpg',
      fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/模拍原图/期货/0P/婴童/208426103204-已回齐6.3已选6.4/yz1.jpg',
      ext: 'jpg',
    }},
    {{
      filename: 'yz(1)-2026-5-18bala6206.jpg',
      fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/模拍原图/期货/0P/婴童/208426103204-已回齐6.3已选6.4/yz(1)-2026-5-18bala6206.jpg',
      ext: 'jpg',
    }},
  ];
  const response = (payload) => ({{
    ok: true,
    async text() {{ return JSON.stringify(payload); }},
  }});
  global.fetch = async (url) => {{
    const path = new URL(String(url), 'https://fmp.semirapp.com').pathname;
    if (path === '/fengcloud/1/account/mount') {{
      return response({{ list: [{{ mount_id: 'm1', name: '巴拉营运BU-商品' }}] }});
    }}
    if (path === '/fengcloud/2/file/search') {{
      return response({{ list: searchItems, total: searchItems.length }});
    }}
    if (path.includes('/file/list') || path.includes('/file/ls')) {{
      return response({{ list: [], total: 0 }});
    }}
    if (path.startsWith('/fengcloud/2/file/info')) {{
      return response({{ url: 'https://example.com/source.jpg' }});
    }}
    return response({{ list: [], total: 0 }});
  }};
  const result = await eval(code);
  if (!result.success) throw new Error(result.error || 'mocked semir find failed');
  process.stdout.write(JSON.stringify({{
    chosen: result.data[0].chosenMain && result.data[0].chosenMain.filename,
    mainCandidates: result.data[0].mainCandidates.map((item) => item.filename),
  }}));
}})().catch((error) => {{
  console.error(error && error.stack || error);
  process.exit(1);
}});
"""
        completed = subprocess.run(["node"], input=node_script, text=True, capture_output=True, check=True)
        payload = json.loads(completed.stdout)

        self.assertEqual(payload["chosen"], "yz(1)-2026-5-18bala6206.jpg")
        self.assertEqual(payload["mainCandidates"], ["yz(1)-2026-5-18bala6206.jpg", "yz1.jpg"])

    def test_semir_detail_reference_prefers_selected_model_original_style_color_images(self):
        module = load_script()
        code = module.js_call(module.SEMIR_FIND_JS, {
            "style_code": "208326100202",
            "skc_code": "208326100202-00211",
            "cloud_path": "巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/",
            "limit": 8,
        })
        node_script = f"""
;(async () => {{
  const code = {json.dumps(code, ensure_ascii=False)};
  const selectedFolder = '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/模拍原图/期货/1P/婴童/208326100202-已回齐6.2已选';
  const searchItems = [
    {{
      filename: '208326100202-已回齐6.2已选',
      fullpath: selectedFolder,
      dir: 1,
      type: 'folder',
    }},
    {{
      filename: '208326100202-00482.jpg',
      fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/平拍原图/208326100202/208326100202-00482.jpg',
      ext: 'jpg',
    }},
    {{
      filename: '20832610020230424-婴幼童-男-AI参考.jpg',
      fullpath: `${{selectedFolder}}/20832610020230424-婴幼童-男-AI参考.jpg`,
      ext: 'jpg',
    }},
  ];
  const selectedItems = [
    {{ filename: 'yz1.jpg', ext: 'jpg' }},
    {{ filename: '208326100202-20841.jpg', ext: 'jpg' }},
    {{ filename: '208326100202-30424-14.jpg', ext: 'jpg' }},
    {{ filename: '208326100202-60354.jpg', ext: 'jpg' }},
    {{ filename: '208326100202-80224.jpg', ext: 'jpg' }},
    {{ filename: '20832610020230424-婴幼童-男-AI参考.jpg', ext: 'jpg' }},
  ];
  const response = (payload) => ({{
    ok: true,
    async text() {{ return JSON.stringify(payload); }},
  }});
  global.fetch = async (url) => {{
    const path = new URL(String(url), 'https://fmp.semirapp.com').pathname;
    if (path === '/fengcloud/1/account/mount') {{
      return response({{ list: [{{ mount_id: 'm1', name: '巴拉营运BU-商品' }}] }});
    }}
    if (path === '/fengcloud/2/file/search') {{
      return response({{ list: searchItems, total: searchItems.length }});
    }}
    if (path.includes('/file/list') || path.includes('/file/ls')) {{
      return response({{ list: selectedItems, total: selectedItems.length }});
    }}
    if (path.startsWith('/fengcloud/2/file/info')) {{
      return response({{ url: 'https://example.com/source.jpg' }});
    }}
    return response({{ list: [], total: 0 }});
  }};
  const result = await eval(code);
  if (!result.success) throw new Error(result.error || 'mocked semir find failed');
  process.stdout.write(JSON.stringify({{
    chosenDetail: result.data[0].chosenDetail && result.data[0].chosenDetail.filename,
    detailCandidates: result.data[0].detailCandidates.map((item) => item.filename),
  }}));
}})().catch((error) => {{
  console.error(error && error.stack || error);
  process.exit(1);
}});
"""
        completed = subprocess.run(["node"], input=node_script, text=True, capture_output=True, check=True)
        payload = json.loads(completed.stdout)

        self.assertEqual(payload["chosenDetail"], "208326100202-20841.jpg")
        self.assertEqual(payload["detailCandidates"][:4], [
            "208326100202-20841.jpg",
            "208326100202-30424-14.jpg",
            "208326100202-60354.jpg",
            "208326100202-80224.jpg",
        ])
        self.assertNotIn("208326100202-00482.jpg", payload["detailCandidates"])
        self.assertNotIn("20832610020230424-婴幼童-男-AI参考.jpg", payload["detailCandidates"])

    def test_find_semir_references_downloads_all_style_color_candidates(self):
        module = load_script()
        workflow = module.WorkflowItem(2, "208326100202", "1002178235142", "长袖T恤", "中性", skc_code="208326100202-00211")

        class Runner:
            async def evaluate_with_reconnect(self, script, **_kwargs):
                if "SEMIR_FETCH_FILE_JS" in script or "缺少下载 URL" in script:
                    return SimpleNamespace(success=True, data=[{"base64": "dGVzdA=="}], error="")
                return SimpleNamespace(
                    success=True,
                    data=[{
                        "chosenMain": {"filename": "橱窗1.jpg", "materialUrl": "https://example.com/main.jpg"},
                        "chosenDetail": {"filename": "208326100202-20841.jpg", "materialUrl": "https://example.com/20841.jpg"},
                        "detailCandidates": [
                            {"filename": "208326100202-20841.jpg", "materialUrl": "https://example.com/20841.jpg"},
                            {"filename": "208326100202-30424.jpg", "materialUrl": "https://example.com/30424.jpg"},
                            {"filename": "208326100202-60354.jpg", "materialUrl": "https://example.com/60354.jpg"},
                        ],
                    }],
                    error="",
                )

        with tempfile.TemporaryDirectory() as tmpdir, \
            patch.object(module, "optimize_reference_image", side_effect=lambda path: path):
            data, main_path, detail_path = asyncio.run(module.find_semir_references(
                Runner(),
                workflow,
                "巴拉运营BU/模拍原图/已选",
                Path(tmpdir),
                download_detail=True,
            ))

        self.assertTrue(main_path.endswith("208326100202-main-origin.jpg"))
        self.assertTrue(detail_path.endswith("208326100202-detail-flat-1.jpg"))
        self.assertEqual(
            [Path(path).name for path in data["detailReferencePaths"]],
            [
                "208326100202-detail-flat-1.jpg",
                "208326100202-detail-flat-2.jpg",
                "208326100202-detail-flat-3.jpg",
            ],
        )
        self.assertEqual(
            [Path(item["localPath"]).name for item in data["detailCandidates"]],
            [
                "208326100202-detail-flat-1.jpg",
                "208326100202-detail-flat-2.jpg",
                "208326100202-detail-flat-3.jpg",
            ],
        )

    def test_tmall_upload_image_is_normalized_to_three_four_portrait(self):
        module = load_script()
        try:
            from PIL import Image
        except Exception:
            self.skipTest("Pillow is not installed")

        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "wide.jpg"
            Image.new("RGB", (1200, 800), "white").save(source)

            output = Path(module.normalize_tmall_upload_image(str(source)))

            self.assertNotEqual(output, source)
            with Image.open(output) as normalized:
                self.assertEqual(normalized.size, (960, 1280))

    def test_main_only_does_not_fallback_when_only_detail_is_missing(self):
        module = load_script()

        class Runner:
            def __init__(self):
                self.calls = 0

            async def evaluate_with_reconnect(self, _script, allow_navigation_retry=True):
                self.calls += 1
                return SimpleNamespace(
                    success=True,
                    data=[{"chosenMain": {"filename": "橱窗1.jpg"}}],
                    error="",
                )

        runner = Runner()
        workflow = module.WorkflowItem(2, "208326100202", "1002178235142", "长袖T恤", "中性")

        data, main_path, detail_path = asyncio.run(module.find_semir_references(
            runner,
            workflow,
            "巴拉营运BU-商品//巴拉货控/2026年巴拉秋/",
            Path("/tmp"),
            allow_global_fallback=True,
            download_files=False,
            download_detail=False,
        ))

        self.assertEqual(runner.calls, 1)
        self.assertEqual(data["chosenMain"]["filename"], "橱窗1.jpg")
        self.assertEqual(main_path, "")
        self.assertEqual(detail_path, "")

    def test_result_rows_support_main_only_reference_mode_without_detail_file(self):
        module = load_script()
        workflow = module.WorkflowItem(2, "208326100202", "1002178235142", "长袖T恤", "中性")

        rows = module.result_rows_for_workflow(
            workflow,
            {"chosenMain": {"filename": "橱窗1.jpg"}, "chosenDetail": {"skcCode": "208326100202-00211"}},
            "/tmp/main.jpg",
            "",
            [{
                "提示词序号": 1,
                "提示词字段名": "正面",
                "执行结果": "生图失败",
                "备注": "timeout",
            }],
            ["/tmp/should-not-fallback.jpg"],
            None,
            reference_mode="main_only",
        )

        self.assertEqual(rows[0]["参考图模式"], "main_only")
        self.assertEqual(rows[0]["执行结果"], "已下载主图参考图")
        self.assertEqual(rows[1]["本地文件"], "")
        self.assertEqual(rows[1]["执行结果"], "生图失败")

    def test_tmall_create_result_rows_include_material_test_detail_url(self):
        module = load_script()
        workflow = module.WorkflowItem(2, "208326100202", "1002178235142", "长袖T恤", "中性")

        rows = module.result_rows_for_workflow(
            workflow,
            {"chosenMain": {"filename": "橱窗1.jpg"}},
            "/tmp/main.jpg",
            "",
            [{
                "提示词序号": 1,
                "提示词字段名": "正面",
                "完整Prompt": "prompt",
                "执行结果": "已生成",
            }],
            ["/tmp/ai-1.jpg"],
            {
                "uploaded": [{"url": "https://img.example/main.jpg"}, {"url": "https://img.example/ai-1.jpg"}],
                "materials": [{"picUrl": "https://img.example/ai-1.jpg"}],
                "batchPayload": {"experimentTaskId": "41716301"},
                "readback": {"total": 1},
                "readbackTaskSummary": {"status": "1", "testImageCount": 5},
                "onlineResult": {"success": True},
            },
            reference_mode="main_only",
        )

        create_rows = [row for row in rows if row.get("阶段") == "天猫上传/创建测图任务"]
        self.assertEqual(
            create_rows[0]["测图详情URL"],
            "https://myseller.taobao.com/home.htm/material-center/material-test/common_test"
            "?testStatus=1&testChannel=common_search&tab=all&itemId=1002178235142",
        )


if __name__ == "__main__":
    unittest.main()
