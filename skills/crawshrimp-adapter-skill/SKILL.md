---
name: crawshrimp-adapter-skill
description: Engineering guide for building and stabilizing crawshrimp adapters. Use when implementing or repairing crawshrimp adapter scripts, `manifest.yaml`, phase/shared/live progress, multi-site or multi-time-range state inheritance, export dedupe guards, frontend progress whitelist wiring, or pre-commit regression for adapter changes. Triggers for “适配器”, “脚本稳定性”, “进度条”, “导出去重”, “状态恢复”, and “回归清单”.
---

# Crawshrimp Adapter Skill

Use this skill for **crawshrimp-specific adapter engineering**, not generic DOM probing.

This skill is the right fit when the hard part is one of these:

- adapter phase design
- `meta.shared` carry and restoration
- live progress contract
- multi-site or multi-time-range loops
- export dedupe and acceptance checks
- frontend enhanced-progress whitelist
- regression and commit boundary control

If the current blocker is a **new page**, **flaky control**, **portal popup**, or **React/Vue DOM experiment**, use this skill together with [../web-automation-skill/SKILL.md](../web-automation-skill/SKILL.md).

If a standard `crawshrimp probe` bundle exists, treat it as the input evidence layer for this skill. Probe should tell you the page state map, candidate API surfaces, and recovery clues; this skill turns those findings into phases, `shared`, runtime actions, export guards, and regressions.

Preferred probe entry in this repo:

```bash
./venv/bin/python scripts/crawshrimp_probe.py run \
  --adapter <adapter_id> \
  --task <task_id> \
  --goal "<what you need to prove>"
```

If the page is not yet well-mapped, run that wrapper first instead of hand-rolling DOM reconnaissance from scratch.

## Quick Workflow

1. Classify the task first.
   - Pure list scraping
   - Batch detail collection
   - Mixed list + drawer + export flow

2. Lock the adapter surface and runtime truth first.
   - If you are touching `manifest.yaml`, adapter entrypoints, installed runtime copies, or shared repo touchpoints, read [references/adapter-surface-and-runtime.md](references/adapter-surface-and-runtime.md).

3. Lock the protocol contract before changing logic.
   - If you are changing phases, `shared`, or live progress, read [references/phase-shared-live.md](references/phase-shared-live.md).

4. Stabilize state inheritance and recovery next.
   - If the task switches site, time range, page, drawer, or host, read [references/state-recovery.md](references/state-recovery.md).

5. If a probe bundle or DOM findings note already exists, translate it into adapter design before editing code.
   - Read [references/probe-to-adapter.md](references/probe-to-adapter.md).

6. Add export guards and acceptance criteria.
   - If duplicate rows, missing last page, or wrong scope labels are possible, read [references/export-and-validation.md](references/export-and-validation.md).

7. Touch frontend progress only if the task truly needs it.
   - If the task is long-running and users need richer progress visibility, read [references/progress-ui-whitelist.md](references/progress-ui-whitelist.md).

8. Add runner-facing regression before live verification.
   - If you are fixing protocol bugs, recovery branches, runtime artifacts, or adapter regressions, read [references/js-runner-and-regression.md](references/js-runner-and-regression.md).

9. Run the regression ladder before staging or committing.
   - Always finish with [references/regression-checklist.md](references/regression-checklist.md).

## Core Guardrails

- Prefer **business-level phases** over field-level phases.
- Store **explicit user selections once** in `shared`, then restore from `shared`; do not keep re-deriving them from volatile DOM.
- Treat `no target on current page/scope` differently from `target existed but action failed`.
- Do not fake `total_rows` just to make a percent bar look good.
- `manifest.yaml` is part of the adapter contract; do not hide progress-mode or task-specific UI policy inside manifest flags.
- Crawshrimp executes the installed adapter copy, not the repo file you just edited; verify runtime sync before live testing.
- If you change phase/shared/progress protocol behavior, add or update JS regression first, then Python runner coverage if the backend contract moved.
- Export-time dedupe is a **final safety net**, not the primary correctness mechanism.
- Shared frontend files are cross-task touchpoints; stage them carefully when another session is modifying a sibling task.

## Main Repo Touchpoints

These files are the usual places to inspect before editing:

- `adapters/<adapter_id>/manifest.yaml`
- `adapters/<adapter_id>/<task-script>.js`
- `tests/<adapter-task>.test.js`
- `core/js_runner.py`
- `core/api_server.py`
- `core/data_sink.py`
- `app/src/renderer/utils/taskProgress.js`
- `app/src/renderer/App.vue`
- `app/src/renderer/views/ScriptList.vue`
- `app/src/renderer/views/TaskRunner.vue`
- `sdk/ADAPTER_GUIDE.md`
- `DEVELOPMENT.md`

## Reference Map

- [references/adapter-surface-and-runtime.md](references/adapter-surface-and-runtime.md)
  Use when deciding which repo surfaces belong to the change, how `manifest.yaml` fits the contract, and how to verify the installed runtime is actually running your latest code.

- [references/phase-shared-live.md](references/phase-shared-live.md)
  Use when designing or repairing phase state machines, `shared` carry, and live progress fields.

- [references/state-recovery.md](references/state-recovery.md)
  Use when site/time/page/drawer context can drift, or when retries, reloads, and API-first fallbacks matter.

- [references/export-and-validation.md](references/export-and-validation.md)
  Use when duplicates, scope drift, missing final pages, or export correctness are in scope.

- [references/progress-ui-whitelist.md](references/progress-ui-whitelist.md)
  Use when wiring enhanced progress UI for a task without affecting other scripts.

- [references/js-runner-and-regression.md](references/js-runner-and-regression.md)
  Use when writing or updating Node regressions, deciding when `core/js_runner.py` tests are required, and proving a bugfix before install.

- [references/probe-to-adapter.md](references/probe-to-adapter.md)
  Use when a probe bundle or DOM findings note already exists and you need to translate it into phase boundaries, `shared`, runtime actions, and recoverable adapter behavior.

- [references/regression-checklist.md](references/regression-checklist.md)
  Use before install, live regression, staging, and commit.
