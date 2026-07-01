import importlib.util
import sys
import unittest
from pathlib import Path


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
