---
name: crawshrimp-probe-skill
description: Legacy compatibility skill for the repo's dev harness reconnaissance flow. Use when a task needs `snapshot`, `capture`, `eval`, `knowledge`, or `probe` from `scripts/crawshrimp_dev_harness.py` before adapter work.
---

# Crawshrimp Dev Harness Skill

`crawshrimp-probe-skill` is now a historical name. In this repo, the standard reconnaissance entrypoint is `scripts/crawshrimp_dev_harness.py`.

Use this skill when you need a fast evidence layer before deeper DOM Lab or adapter engineering:

- page state and DOM snapshot
- existing notes / probe knowledge hits
- safe request capture
- one-off JS experiments on the current tab
- a reusable probe bundle only when the task truly needs one

## Default Action

1. Start with `snapshot`.
2. Read `knowledge` hits before writing new notes or experiments.
3. Use `capture` or `eval` for focused DOM / network experiments.
4. Use `probe` only if you need a structured bundle under `~/.crawshrimp/probes`.
5. Hand off to `web-automation-skill` or `crawshrimp-adapter-skill`.

## Preferred Commands

Start from `snapshot` so you get page structure and matching knowledge cards in one step:

```bash
./venv/bin/python scripts/crawshrimp_dev_harness.py snapshot \
  --adapter <adapter_id> \
  --task <task_id>
```

Then search or rebuild knowledge when notes / probe outputs changed:

```bash
./venv/bin/python scripts/crawshrimp_dev_harness.py knowledge \
  --adapter <adapter_id> \
  --task <task_id> \
  --query "<selector | endpoint | drawer>"

./venv/bin/python scripts/crawshrimp_dev_harness.py rebuild-knowledge
```

Use focused experiments before escalating to a structured probe:

```bash
./venv/bin/python scripts/crawshrimp_dev_harness.py capture \
  --adapter <adapter_id> \
  --task <task_id> \
  --capture-mode passive

./venv/bin/python scripts/crawshrimp_dev_harness.py eval \
  --adapter <adapter_id> \
  --task <task_id> \
  --file /absolute/path/to/check.js
```

If you still need a reusable bundle and `strategy.json`, run `probe` from the same entrypoint:

```bash
./venv/bin/python scripts/crawshrimp_dev_harness.py probe \
  --adapter <adapter_id> \
  --task <task_id> \
  --goal "<what you need to prove>" \
  --safe-auto \
  --safe-click-labels 查看详情 近7日 近30日
```

On macOS, the harness tries to resolve the current front Chrome tab automatically by matching the active tab URL/title against crawshrimp's `/settings/chrome-tabs`.

## Reading Existing Results

Prefer the generated knowledge index and grouped skill docs:

```bash
./venv/bin/python scripts/crawshrimp_dev_harness.py knowledge \
  --adapter <adapter_id> \
  --task <task_id>
```

If you must inspect a historical `probe_id` directly, the legacy wrapper still exists:

```bash
./venv/bin/python scripts/crawshrimp_probe.py show --probe-id <probe_id>
```

## Handoff

After the harness run:

1. If the page is still unclear, continue with `web-automation-skill`.
2. If you already have enough evidence to design phases / recovery / runtime actions, continue with `crawshrimp-adapter-skill`.
3. If a probe bundle was created, treat it as raw evidence that should also be searchable through the knowledge index.
