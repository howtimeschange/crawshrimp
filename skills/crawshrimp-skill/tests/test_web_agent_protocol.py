import json
import unittest

from scripts.web_agent_protocol import (
    Action,
    Journal,
    Observation,
    PageState,
    Plan,
    SafetyError,
    TaskKind,
    Verification,
    classify_task,
    validate_action,
)


class WebAgentProtocolTest(unittest.TestCase):
    def test_classifies_read_operate_and_flow_tasks(self):
        cases = {
            "抓取这个页面表格并总结页面内容": TaskKind.READ,
            "筛选近7天数据，翻到下一页，下载导出文件": TaskKind.OPERATE,
            "打开每个订单详情弹窗，跨页面收集证据并整理流程": TaskKind.FLOW,
        }
        for prompt, expected in cases.items():
            with self.subTest(prompt=prompt):
                self.assertEqual(classify_task(prompt), expected)

    def test_blocks_dangerous_write_actions_without_user_confirmation(self):
        action = Action(kind="submit", target="发布按钮", value=None, risk="dangerous")

        with self.assertRaises(SafetyError):
            validate_action(action, user_confirmed=False)

        self.assertIsNone(validate_action(action, user_confirmed=True))

    def test_journal_records_minimum_evidence_chain_as_json(self):
        journal = Journal(task="下载当前筛选结果")
        state = PageState(
            url="https://example.test/orders",
            title="Orders",
            visible_text=["Orders", "Export"],
            controls=[{"role": "button", "name": "Export"}],
            tables=[{"caption": "Orders", "rows": 2}],
        )
        journal.add_observation(Observation(summary="orders page is ready", page=state))
        journal.set_plan(
            Plan(
                goal="download filtered orders",
                kind=TaskKind.OPERATE,
                steps=["open export menu", "download file", "verify file appears"],
            )
        )
        journal.add_action(Action(kind="click", target="Export", value=None, risk="safe"))
        journal.add_verification(
            Verification(
                passed=True,
                evidence="export menu opened and download button is visible",
            )
        )

        payload = json.loads(journal.to_json())

        self.assertEqual(payload["task"], "下载当前筛选结果")
        self.assertEqual(payload["plan"]["kind"], "operate")
        self.assertEqual(payload["observations"][0]["page"]["url"], "https://example.test/orders")
        self.assertEqual(payload["actions"][0]["kind"], "click")
        self.assertTrue(payload["verifications"][0]["passed"])


if __name__ == "__main__":
    unittest.main()
