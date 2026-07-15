#!/usr/bin/env python3
"""Generate reusable workflow assets from a successful web-agent journal."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

try:
    from scripts.web_operator import distill_workflow
except ModuleNotFoundError:
    from web_operator import distill_workflow


def _slugify(raw: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", raw.strip().lower()).strip("-")
    return slug or "web-workflow"


def _load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Journal must be a JSON object: {path}")
    return payload


def _commands_from_journal(journal: dict[str, Any], *, name: str) -> dict[str, Any]:
    observations = journal.get("observations") or []
    first_page = ((observations[0] or {}).get("page") or {}) if observations else {}
    actions = []
    for action in journal.get("actions") or []:
        if not isinstance(action, dict):
            continue
        kind = action.get("kind") or ""
        value = action.get("value")
        metadata = action.get("metadata") if isinstance(action.get("metadata"), dict) else {}
        files = []
        if isinstance(metadata.get("files"), list):
            files = [str(item) for item in metadata.get("files") or []]
        elif kind in {"upload", "upload-chooser"} and isinstance(value, str):
            files = [item for item in value.split(",") if item]
        matchers = metadata.get("matchers")
        if not isinstance(matchers, list):
            matchers = metadata.get("matches") if isinstance(metadata.get("matches"), list) else []
        actions.append({
            "kind": kind,
            "selector": action.get("target") or "",
            "value": action.get("value"),
            "url": value if kind == "navigate" else "",
            "files": files,
            "clicks": list(metadata.get("clicks") or []),
            "wheels": list(metadata.get("wheels") or []),
            "matchers": list(matchers or []),
            "expected_file": str(metadata.get("expected_file") or metadata.get("expectedFile") or ""),
            "timeout_ms": int(metadata.get("timeout_ms") or metadata.get("timeoutMs") or 0),
            "risk": action.get("risk") or "safe",
            "reason": action.get("reason") or "",
        })
    return {
        "name": name,
        "task": journal.get("task") or name,
        "start_url": first_page.get("url") or "",
        "title": first_page.get("title") or "",
        "actions": actions,
        "verifications": journal.get("verifications") or [],
    }


def _runner_source() -> str:
    return '''#!/usr/bin/env python3
"""Run a distilled web workflow through crawshrimp-skill's web_operator.py."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a reusable CDP web workflow.")
    parser.add_argument("--commands", default=str(Path(__file__).with_name("commands.json")))
    parser.add_argument("--operator", required=True, help="Path to crawshrimp-skill/scripts/web_operator.py")
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--cdp-url", default="http://127.0.0.1:9222")
    parser.add_argument("--tab-id", default="")
    parser.add_argument("--url-prefix", default="")
    parser.add_argument("--journal", default="workflow-run.json")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    commands = json.loads(Path(args.commands).read_text(encoding="utf-8"))
    base = [args.python, args.operator]
    browser_args = ["--cdp-url", args.cdp_url, "--task", commands.get("task") or commands.get("name") or "web workflow", "--journal", args.journal]
    if args.tab_id:
        browser_args += ["--tab-id", args.tab_id]
    if args.url_prefix:
        browser_args += ["--url-prefix", args.url_prefix]

    steps = [base + ["observe"] + browser_args]
    for action in commands.get("actions") or []:
        step = base + ["act", action.get("kind") or "click"] + browser_args
        if action.get("kind") == "navigate" and action.get("url"):
            step += ["--url", action["url"]]
        elif action.get("selector"):
            step += ["--selector", action["selector"]]
        for file_path in action.get("files") or []:
            step += ["--file", file_path]
        if action.get("clicks"):
            step += ["--clicks-json", json.dumps(action["clicks"], ensure_ascii=False)]
        if action.get("wheels"):
            step += ["--wheels-json", json.dumps(action["wheels"], ensure_ascii=False)]
        if action.get("matchers") and action.get("kind") == "capture-wheel":
            step += ["--value", json.dumps(action["matchers"], ensure_ascii=False)]
        if action.get("expected_file"):
            step += ["--expected-file", str(action["expected_file"])]
        if action.get("timeout_ms"):
            step += ["--timeout-ms", str(action["timeout_ms"])]
        if action.get("value") is not None and action.get("kind") not in {"navigate", "upload"} and not (action.get("kind") == "capture-wheel" and action.get("matchers")):
            step += ["--value", str(action["value"])]
        if action.get("reason"):
            step += ["--reason", action["reason"]]
        if action.get("risk"):
            step += ["--risk", action["risk"]]
        steps.append(step)

    for verification in commands.get("verifications") or []:
        check = verification.get("check") if isinstance(verification, dict) else {}
        evidence = str((verification or {}).get("evidence") or "workflow verification")
        if isinstance(check, dict) and check.get("kind"):
            step = base + ["verify"] + browser_args + ["--check", str(check["kind"]), "--target", str(check.get("target") or check.get("path") or ""), "--evidence", evidence]
            if check.get("minimum") is not None:
                step += ["--minimum", str(check["minimum"])]
            steps.append(step)

    for step in steps:
        print(" ".join(step))
        if not args.dry_run:
            subprocess.run(step, check=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
'''


def _skill_source(commands: dict[str, Any]) -> str:
    name = _slugify(str(commands.get("name") or "web-workflow"))
    task = str(commands.get("task") or name)
    return f'''---
name: {name}
description: Use when repeating the proven browser workflow for: {task}
---

# {name}

Run this reusable workflow with `run_workflow.py`. It expects Chrome CDP and the parent `crawshrimp-skill/scripts/web_operator.py`.

## Workflow

- Task: {task}
- Start URL: {commands.get("start_url") or ""}
- Actions: {len(commands.get("actions") or [])}

## Safety

Review `commands.json` before running. Dangerous submit, publish, send, delete, pay, purchase, confirm, or bulk-modify actions must still require explicit user confirmation.
'''


def _adapter_manifest_source(commands: dict[str, Any]) -> str:
    name = _slugify(str(commands.get("name") or "web-workflow"))
    task = str(commands.get("task") or name).replace("\n", " ")
    start_url = str(commands.get("start_url") or "")
    return "\n".join(
        [
            f"id: {name}",
            f"name: {task}",
            "version: 0.1.0",
            f"entry_url: {start_url}",
            "tasks:",
            f"  - id: {name}",
            f"    name: {task}",
            f"    script: {name}.js",
            f"    entry_url: {start_url}",
            "",
        ]
    )


def _adapter_script_source(commands: dict[str, Any]) -> str:
    name = _slugify(str(commands.get("name") or "web-workflow"))
    return f"""// Adapter draft generated from a crawshrimp-skill journal.
// Review selectors, request matchers, auth assumptions, and pagination before installing.
const workflow = {json.dumps(commands, ensure_ascii=False, indent=2)};

return {{
  success: true,
  data: [],
  meta: {{
    action: "complete",
    has_more: false,
    adapter_draft: true,
    workflow_name: {json.dumps(name)}
  }}
}};
"""


def _adapter_readme_source(commands: dict[str, Any]) -> str:
    return "\n".join(
        [
            "# Adapter Draft",
            "",
            "Review before installing this draft into a real adapter registry.",
            "",
            f"- Workflow: `{commands.get('name') or ''}`",
            f"- Task: {commands.get('task') or ''}",
            f"- Start URL: {commands.get('start_url') or ''}",
            f"- Actions: {len(commands.get('actions') or [])}",
            "",
            "## Next Checks",
            "",
            "- Confirm login/auth assumptions.",
            "- Replace draft script body with tested phase/runtime logic.",
            "- Keep dangerous submit, publish, delete, payment, and bulk actions behind explicit confirmation.",
            "",
        ]
    )


def build_reusable_workflow(
    *,
    journal_path: Path,
    output_dir: Path,
    name: str = "",
    include_skill: bool = False,
    include_adapter_draft: bool = False,
) -> dict[str, Any]:
    journal = _load_json(journal_path)
    workflow_name = _slugify(name or str(journal.get("task") or "web-workflow"))
    output_dir.mkdir(parents=True, exist_ok=True)

    commands = _commands_from_journal(journal, name=workflow_name)
    (output_dir / "workflow.md").write_text(distill_workflow(journal), encoding="utf-8")
    (output_dir / "commands.json").write_text(json.dumps(commands, ensure_ascii=False, indent=2), encoding="utf-8")
    runner = output_dir / "run_workflow.py"
    runner.write_text(_runner_source(), encoding="utf-8")
    runner.chmod(0o755)
    if include_skill:
        (output_dir / "SKILL.md").write_text(_skill_source(commands), encoding="utf-8")
    if include_adapter_draft:
        draft_dir = output_dir / "adapter-draft"
        draft_dir.mkdir(parents=True, exist_ok=True)
        adapter_script = draft_dir / f"{workflow_name}.js"
        (draft_dir / "manifest.yaml").write_text(_adapter_manifest_source(commands), encoding="utf-8")
        adapter_script.write_text(_adapter_script_source(commands), encoding="utf-8")
        (draft_dir / "README.md").write_text(_adapter_readme_source(commands), encoding="utf-8")

    return {
        "name": workflow_name,
        "output_dir": str(output_dir),
        "files": sorted(str(item.relative_to(output_dir)) for item in output_dir.rglob("*") if item.is_file()),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build reusable workflow assets from a web-agent journal.")
    parser.add_argument("--journal", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--name", default="")
    parser.add_argument("--include-skill", action="store_true")
    parser.add_argument("--include-adapter-draft", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    result = build_reusable_workflow(
        journal_path=Path(args.journal),
        output_dir=Path(args.output_dir),
        name=args.name,
        include_skill=args.include_skill,
        include_adapter_draft=args.include_adapter_draft,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
