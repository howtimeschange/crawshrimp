# Workflow Reuse

## When To Distill

Distill a workflow when:

- the agent completed the task with evidence
- the same page task is likely to recur
- the route has stable selectors or clear fallback notes
- the user asks for a reusable command, script, skill, adapter draft, or operating playbook

Do not distill failed or unsafe routes as reusable automation. Distill them as investigation notes only.

## Reusable Package

Create a reusable package from a successful journal:

```bash
python3 scripts/web_operator.py distill \
  --journal run.json \
  --output-dir reusable-workflow \
  --name example-export \
  --include-skill
```

The package contains:

- `workflow.md`: human-readable route and evidence
- `commands.json`: machine-readable actions, verification evidence, and replay inputs
- `run_workflow.py`: CLI wrapper that calls `scripts/web_operator.py`
- `SKILL.md`: optional installable skill draft for repeated use

## Review Before Reuse

Before running a generated workflow:

- confirm Chrome is open with CDP
- inspect `commands.json`
- confirm selectors still match the page
- confirm account/store/context is correct
- confirm no dangerous submit/publish/send/delete/pay/purchase/confirm/bulk-modify step is hidden in the route

## What To Improve Later

Repeated workflow runs should evolve from:

1. journal evidence
2. reusable workflow package
3. hardened CLI
4. installable skill
5. crawshrimp adapter if the task needs GUI, templates, scheduling, exports, or wider non-agent reuse
