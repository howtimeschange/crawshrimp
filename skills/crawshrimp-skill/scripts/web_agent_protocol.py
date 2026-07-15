#!/usr/bin/env python3
"""Protocol helpers for AI-agent web automation workflows.

This module intentionally stops at workflow data structures and safety checks.
Browser control should be supplied by the host environment or a future adapter.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any


class TaskKind(StrEnum):
    READ = "read"
    OPERATE = "operate"
    FLOW = "flow"


class SafetyError(RuntimeError):
    """Raised when an action needs explicit user confirmation."""


@dataclass(frozen=True)
class PageState:
    url: str
    title: str = ""
    visible_text: list[str] = field(default_factory=list)
    controls: list[dict[str, Any]] = field(default_factory=list)
    tables: list[dict[str, Any]] = field(default_factory=list)
    downloads: list[dict[str, Any]] = field(default_factory=list)
    network: list[dict[str, Any]] = field(default_factory=list)
    blocking_states: list[dict[str, Any]] = field(default_factory=list)
    context: dict[str, Any] = field(default_factory=dict)
    active_regions: list[dict[str, Any]] = field(default_factory=list)
    accessibility: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class Observation:
    summary: str
    page: PageState


@dataclass(frozen=True)
class Plan:
    goal: str
    kind: TaskKind
    steps: list[str]
    stop_conditions: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Action:
    kind: str
    target: str
    value: str | None = None
    risk: str = "safe"
    reason: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Verification:
    passed: bool
    evidence: str
    next_step: str = ""
    check: dict[str, Any] = field(default_factory=dict)


@dataclass
class Journal:
    task: str
    observations: list[Observation] = field(default_factory=list)
    plan: Plan | None = None
    actions: list[Action] = field(default_factory=list)
    verifications: list[Verification] = field(default_factory=list)
    failures: list[dict[str, Any]] = field(default_factory=list)

    def add_observation(self, observation: Observation) -> None:
        self.observations.append(observation)

    def set_plan(self, plan: Plan) -> None:
        self.plan = plan

    def add_action(self, action: Action) -> None:
        self.actions.append(action)

    def add_verification(self, verification: Verification) -> None:
        self.verifications.append(verification)

    def add_failure(self, failure: dict[str, Any]) -> None:
        self.failures.append(dict(failure))

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        if self.plan is not None:
            payload["plan"]["kind"] = self.plan.kind.value
        return payload

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)


READ_KEYWORDS = {
    "抓",
    "抓取",
    "读取",
    "搜索",
    "总结",
    "整理",
    "提取",
    "导出页面数据",
    "表格",
    "信息",
}

OPERATE_KEYWORDS = {
    "筛选",
    "翻页",
    "下一页",
    "打开详情",
    "下载",
    "导出",
    "填写",
    "填表",
    "选择",
    "上传",
}

FLOW_KEYWORDS = {
    "多页面",
    "多弹窗",
    "跨页面",
    "流程",
    "工作流",
    "每个",
    "批量",
    "证据",
    "复用流程",
}

DANGEROUS_ACTION_KINDS = {
    "submit",
    "publish",
    "send",
    "delete",
    "pay",
    "purchase",
    "confirm",
    "bulk_modify",
}

DANGEROUS_RISKS = {"dangerous", "write", "destructive", "external_effect"}


def classify_task(prompt: str) -> TaskKind:
    """Classify the user's web task into the first supported protocol families."""
    text = prompt.lower()
    flow_score = sum(1 for word in FLOW_KEYWORDS if word.lower() in text)
    operate_score = sum(1 for word in OPERATE_KEYWORDS if word.lower() in text)
    read_score = sum(1 for word in READ_KEYWORDS if word.lower() in text)

    if flow_score and (operate_score or read_score or flow_score >= 2):
        return TaskKind.FLOW
    if operate_score:
        return TaskKind.OPERATE
    if read_score:
        return TaskKind.READ
    return TaskKind.READ


def validate_action(action: Action, *, user_confirmed: bool = False) -> None:
    """Reject dangerous actions unless the user has explicitly confirmed them."""
    kind = action.kind.strip().lower()
    risk = action.risk.strip().lower()
    if (kind in DANGEROUS_ACTION_KINDS or risk in DANGEROUS_RISKS) and not user_confirmed:
        raise SafetyError(
            f"Action '{action.kind}' on '{action.target}' requires explicit user confirmation."
        )


def draft_plan(task: str, *, kind: TaskKind | None = None) -> Plan:
    task_kind = kind or classify_task(task)
    if task_kind is TaskKind.READ:
        steps = [
            "observe page structure and visible data",
            "identify tables, search results, or relevant text blocks",
            "extract the requested information",
            "verify extracted data against visible page evidence",
        ]
    elif task_kind is TaskKind.OPERATE:
        steps = [
            "observe controls and current page state",
            "execute one safe UI action at a time",
            "read back the UI state after each action",
            "verify the requested file, page state, or form state exists",
        ]
    else:
        steps = [
            "map the involved pages, dialogs, and state transitions",
            "plan the workflow as small reversible or safe actions",
            "execute each transition with readback before continuing",
            "record evidence and distill reusable workflow notes",
        ]
    return Plan(
        goal=task,
        kind=task_kind,
        steps=steps,
        stop_conditions=[
            "login or permission wall blocks progress",
            "a write, submit, send, delete, payment, or bulk-modify action is required",
            "the page state contradicts the current plan",
        ],
    )


def _command_classify(args: argparse.Namespace) -> int:
    print(classify_task(args.task).value)
    return 0


def _command_plan(args: argparse.Namespace) -> int:
    print(json.dumps(asdict(draft_plan(args.task)), ensure_ascii=False, indent=2))
    return 0


def _command_journal_template(args: argparse.Namespace) -> int:
    journal = Journal(task=args.task)
    journal.set_plan(draft_plan(args.task))
    print(journal.to_json())
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="AI-agent web operation protocol helper.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    classify_parser = subparsers.add_parser("classify", help="classify a web task")
    classify_parser.add_argument("task")
    classify_parser.set_defaults(func=_command_classify)

    plan_parser = subparsers.add_parser("plan", help="draft a protocol-level plan")
    plan_parser.add_argument("task")
    plan_parser.set_defaults(func=_command_plan)

    journal_parser = subparsers.add_parser("journal-template", help="emit an empty evidence journal")
    journal_parser.add_argument("task")
    journal_parser.set_defaults(func=_command_journal_template)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
