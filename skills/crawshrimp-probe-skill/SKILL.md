---
name: crawshrimp-probe-skill
description: Run the repo's built-in crawshrimp probe flow before writing or repairing adapters. Use when a task needs structured page reconnaissance, endpoint hints, or a standard probe bundle under ~/.crawshrimp/probes.
---

# Crawshrimp Probe Skill

Use this skill when you need a **standard probe bundle** before deeper DOM Lab or adapter engineering.

This skill is for:

- new pages that are still unknown
- deciding `dom_first / api_first / mixed`
- capturing safe interaction-triggered requests
- generating a reusable bundle and `report.md`

## Default Action

When probe is available in this repo, run it before manual DOM exploration unless:

- the page is already well-understood
- a recent probe bundle for the same page already exists
- the task is purely about phase/shared/progress and does not need fresh page reconnaissance

## Preferred Command

Use the wrapper script so you do not have to manually look up `current_tab_id`:

```bash
./venv/bin/python scripts/crawshrimp_probe.py run \
  --adapter <adapter_id> \
  --task <task_id> \
  --goal "<what you need to prove>"
```

On macOS, the script tries to resolve the current front Chrome tab automatically by matching the active tab URL/title against crawshrimp's `/settings/chrome-tabs`.

## If You Need Extra Safe Triggers

```bash
./venv/bin/python scripts/crawshrimp_probe.py run \
  --adapter temu \
  --task goods_traffic_detail \
  --goal "识别详情抽屉与导出触发链路" \
  --safe-auto \
  --safe-click-labels 查看详情 近7日 近30日
```

## Reading Existing Probe Results

Summary:

```bash
./venv/bin/python scripts/crawshrimp_probe.py show --probe-id <probe_id>
```

Full bundle:

```bash
./venv/bin/python scripts/crawshrimp_probe.py show --probe-id <probe_id> --bundle
```

## Handoff

After running probe:

1. Read `strategy.json` first.
2. If the page is still unclear, continue with `web-automation-skill`.
3. If you are ready to design phases/recovery/runtime actions, continue with `crawshrimp-adapter-skill`.
