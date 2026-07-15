#!/usr/bin/env python3
"""Validate the crawshrimp-skill folder shape and core entry points."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


REQUIRED_FILES = [
    "SKILL.md",
    "PLAN.md",
    "requirements.txt",
    "scripts/web_agent_protocol.py",
    "scripts/adapter_registry.py",
    "scripts/browser_executor.py",
    "scripts/ensure_cdp_browser.py",
    "scripts/knowledge_service.py",
    "scripts/phase_runner.py",
    "scripts/probe_bundle.py",
    "scripts/runtime_downloads.py",
    "scripts/web_operator.py",
    "scripts/workflow_builder.py",
    "references/protocol.md",
    "references/page-observation.md",
    "references/task-planning.md",
    "references/action-primitives.md",
    "references/network-intelligence.md",
    "references/browser-execution.md",
    "references/enterprise-form-workflows.md",
    "references/verification.md",
    "references/safety.md",
    "references/workflow-distillation.md",
]


REQUIRED_SKILL_TERMS = [
    "observe",
    "act",
    "verify",
    "journal",
    "distill",
    "dangerous",
    "9222",
    "API-first",
    "page-owned API",
    "request path",
    "double verification",
    "connection refused",
    "dedicated Chrome",
]


REQUIRED_BROWSER_RECOVERY_TERMS = [
    "connection refused",
    "ensure_cdp_browser.py",
    "/json/version",
    "/json",
    "remote-debugging-address=127.0.0.1",
    "remote-debugging-port=9222",
    "--user-data-dir",
]


def validate(root: Path) -> list[str]:
    errors: list[str] = []
    for relative in REQUIRED_FILES:
        path = root / relative
        if not path.is_file():
            errors.append(f"missing required file: {relative}")

    skill_path = root / "SKILL.md"
    if skill_path.is_file():
        text = skill_path.read_text(encoding="utf-8")
        if not re.search(r"^---\n.*?^---", text, re.M | re.S):
            errors.append("SKILL.md is missing YAML front matter")
        for term in REQUIRED_SKILL_TERMS:
            if term not in text:
                errors.append(f"SKILL.md missing term: {term}")

    browser_execution_path = root / "references/browser-execution.md"
    if browser_execution_path.is_file():
        text = browser_execution_path.read_text(encoding="utf-8")
        for term in REQUIRED_BROWSER_RECOVERY_TERMS:
            if term not in text:
                errors.append(f"references/browser-execution.md missing recovery term: {term}")

    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate crawshrimp-skill structure.")
    parser.add_argument("root", nargs="?", default=".")
    args = parser.parse_args(argv)
    root = Path(args.root).resolve()
    errors = validate(root)
    if errors:
        for error in errors:
            print(f"FAIL: {error}")
        return 1
    print(f"OK: {root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
