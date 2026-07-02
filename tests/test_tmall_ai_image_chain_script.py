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


class TmallAiImageChainScriptTests(unittest.TestCase):
    def test_chain_execution_modes_are_approval_or_direct_create_only(self):
        module = load_script()

        self.assertEqual(
            module.CHAIN_EXECUTION_MODES,
            ("approval_then_create", "direct_create"),
        )
        approval = module.normalize_chain_execution_mode("approval_then_create")
        direct = module.normalize_chain_execution_mode("direct_create")

        self.assertTrue(approval["generate"])
        self.assertTrue(approval["approval_required"])
        self.assertFalse(approval["live_upload"])
        self.assertFalse(approval["live_create"])
        self.assertTrue(direct["generate"])
        self.assertFalse(direct["approval_required"])
        self.assertTrue(direct["live_upload"])
        self.assertTrue(direct["live_create"])
        with self.assertRaises(ValueError):
            module.normalize_chain_execution_mode("generate")

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
            with patch.object(module, "resolve_one_xm_settings", return_value={"2k": "unit-key", "4k": ""}), \
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
            with patch.object(module, "resolve_one_xm_settings", return_value={"2k": "unit-key", "4k": ""}), \
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
            with patch.object(module, "resolve_one_xm_settings", return_value={"2k": "unit-key", "4k": ""}), \
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

    def test_upload_approved_batch_marks_partial_failed_when_tmall_returns_error_with_task_id(self):
        module = load_script()

        async def fake_get_runner(*_args, **_kwargs):
            return SimpleNamespace()

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
                patch.object(module, "upload_and_create_tmall_task", fake_upload_and_create):
                result = asyncio.run(module.upload_approved_tmall_batch(batch))
            self.assertFalse(result["ok"])
            self.assertEqual(result["status"], "partial_failed")
            self.assertEqual(result["attempted"], 1)
            self.assertEqual(result["succeeded"], 0)
            self.assertEqual(result["failed"], 1)
            self.assertEqual(batch["status"], "partial_failed")
            self.assertEqual(upload_calls[0][2], "/tmp/main.jpg")
            self.assertEqual(upload_calls[0][3], ["/tmp/ai-1.jpg"])
            self.assertTrue(Path(batch["submit_result_path"]).is_file())
            create_rows = [row for row in result["rows"] if row.get("阶段") == "天猫上传/创建测图任务"]
            self.assertEqual(create_rows[0]["任务ID"], "41716301")
            self.assertEqual(create_rows[0]["执行结果"], "天猫上传/创建失败")

    def test_tmall_upload_creates_fresh_task_by_default_without_clearing_old_images(self):
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
            return {{ data: {{ result: {{ taskStatusList: [{{ experimentTaskId: 99900011, source: 'common_search' }}] }} }} }};
          }}
          if (request.api === 'mtop.taobao.qn.copilot.test.image.batch.delete') {{
            throw new Error('should create a fresh task without clearing old material ids');
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
        self.assertIsNone(payload["reusedTaskId"])
        self.assertEqual(payload["clearedMaterialIds"], [])
        self.assertIn("mtop.taobao.qn.copilot.test.image.task.create", payload["apis"])
        self.assertEqual(payload["deleteMaterialIds"], [])
        self.assertEqual(payload["addPayloads"][0]["experimentTaskId"], "99900011")
        self.assertIn("new-ai.jpg", payload["addPayloads"][0]["materials"])
        self.assertIn('"experimentTaskId":"99900011"', payload["onlinePayloads"][0]["taskStatusList"])

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

        self.assertEqual(row["尺寸"], "960x1280")
        self.assertEqual(row["格式"], "jpeg")
        self.assertEqual(row["质量"], "low")
        self.assertEqual(row["完整Prompt"], row["最终提示词"])
        self.assertEqual(row["__1xm_payload"]["n"], 1)
        self.assertEqual(row["主参考图文件"], "/tmp/origin.jpg")
        self.assertEqual(row["细节参考图文件"], "/tmp/detail-flat.jpg")
        self.assertEqual(row["__1xm_reference_paths"], ["/tmp/origin.jpg", "/tmp/detail-flat.jpg"])
        self.assertEqual(row["__1xm_key_tier"], "2k")
        self.assertEqual(row["__task_run_uid"], "run-A")
        self.assertTrue(row["__1xm_idempotency_key"].isascii())
        self.assertNotEqual(row["__1xm_idempotency_key"], next_run_row["__1xm_idempotency_key"])

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

    def test_run_chain_finds_all_semir_images_before_submitting_1xm_batch(self):
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

        async def fake_find_semir(_runner, workflow, *_args, **_kwargs):
            return {"chosenMain": {"filename": f"{workflow.style_code}.jpg"}}, f"/tmp/{workflow.style_code}-main.jpg", ""

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
                patch.object(module, "resolve_one_xm_settings", return_value={"2k": "unit-key", "4k": ""}), \
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
        self.assertEqual(len(generation_indexes), 4)
        self.assertGreater(min(generation_indexes), max(find_indexes))
        self.assertTrue(any("1XM 生图批量提交 4 张，并发 100" in line for line in logs))
        self.assertTrue(any(event.get("shared", {}).get("generation_total_jobs") == 4 for event in progress_events))
        self.assertTrue(any(event.get("shared", {}).get("generation_submitted_jobs", 0) > 0 for event in progress_events))
        self.assertTrue(any(row.get("阶段") == "图片审批" for row in rows))

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


if __name__ == "__main__":
    unittest.main()
