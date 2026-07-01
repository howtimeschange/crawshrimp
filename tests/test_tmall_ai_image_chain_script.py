import importlib.util
import asyncio
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


SCRIPT_PATH = Path("adapters/tmall-ops-assistant/tools/run_tmall_ai_image_test_chain.py").resolve()


def load_script():
    spec = importlib.util.spec_from_file_location("tmall_ai_image_chain", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class TmallAiImageChainScriptTests(unittest.TestCase):
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

        rows, invalid = module.normalize_workflow_rows(table, 5)

        self.assertEqual(invalid, [])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].style_code, "208326100202")
        self.assertEqual(rows[0].item_id, "1002178235142")
        self.assertEqual(rows[0].category, "长袖T恤")
        self.assertEqual(rows[0].gender, "中性")
        self.assertEqual(rows[0].skc_code, "208326100202-00482")

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
        self.assertTrue(row["__1xm_idempotency_key"].isascii())

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
  global.fetch = async (url) => {{
    const path = String(url);
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

        self.assertEqual(payload["chosen"], "橱窗1.jpg")
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
    const path = String(url);
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
    const path = String(url);
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
