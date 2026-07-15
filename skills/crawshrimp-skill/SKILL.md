---
name: crawshrimp-skill
description: Use when an AI agent needs to explore and operate a live webpage through an existing or dedicated local CDP 9222 browser session, prefer page-owned APIs/request paths over manual clicking, extract data, download files, fill forms without dangerous submission, or complete multi-step web workflows with evidence.
---

# Crawshrimp Skill

## Overview

Crawshrimp Skill has two jobs: use crawshrimp-style CDP browser automation to let an AI agent complete live webpage tasks, then freeze proven workflows into reusable skills, scripts, or CLI commands.

The loop is: observe, model, plan, act, verify, journal, then distill.

## Default Browser Entry

For every webpage task, classify it first, then start with the user's existing CDP browser on `http://127.0.0.1:9222`. Use `--cdp-url http://127.0.0.1:9222` and observe the requested URL prefix before opening a new browser, using a browser extension, or asking the user to log in again.

If the page looks logged out, first check whether the 9222 browser already has a logged-in tab or session for the same host. Treat a login screen in a fresh browser as an environment mismatch until the 9222 session is ruled out.

### 9222 Connection-Refused Recovery

After classification, probe the existing endpoint before acting. Only when both `http://127.0.0.1:9222/json/version` and `http://127.0.0.1:9222/json` specifically fail with **connection refused** (no listener) may you launch a replacement. Do not ask the user to start Chrome in that case: proactively open one visible, dedicated Chrome instance, wait for healthy CDP, then resume the original `observe` command.

Prefer the bundled recovery helper so the probe/launch/wait loop is consistent:

```bash
python3 scripts/ensure_cdp_browser.py --cdp-url http://127.0.0.1:9222 --timeout-seconds 30
```

The helper re-probes immediately before launching so another agent's already-successful recovery is reused, launches at most once per recovery event, and exits nonzero for blocked states that are not safe to replace. On macOS, its launch is equivalent to this dedicated skill-owned profile flow:

```bash
mkdir -p "$HOME/.crawshrimp-skill/chrome-profile"
nohup "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.crawshrimp-skill/chrome-profile" \
  --no-first-run \
  --no-default-browser-check \
  --new-window about:blank \
  >"$HOME/.crawshrimp-skill/chrome-9222.log" 2>&1 &
```

For another operating system, the helper locates an installed Chrome or Chromium executable and preserves the same loopback address, port, isolated `--user-data-dir`, and no-first-run flags. Never use the normal Chrome profile, import or copy credentials, or weaken Chrome security with permissive remote-origin or web-security flags.

Poll for at most 30 seconds. Continue only after `/json/version` returns a JSON object with a nonempty `Browser` field **and** `/json` returns a JSON array; then retry the same `web_operator.py observe` command and continue with the normal API-first loop. Journal a sanitized recovery record: the connection-refused diagnosis, dedicated profile ownership, ready evidence, and any launch failure—never cookies, tokens, or profile contents.

Connection refused is the only automatic-launch condition. Do not launch, kill, restart, or take over a process for a timeout, HTTP 404/non-200 response, malformed or partial CDP data, a WebSocket interruption, a target-tab mismatch, or an already-open but logged-out browser. Report that diagnostic instead. If the new isolated browser is ready but reaches a login page, ask the user to log in in that visible dedicated window; do not claim it reused the previous session. Browser recovery never relaxes the authorization rules for save, submit, publish, delete, send, pay, or bulk changes.

## Operation Surface Ladder

Do not default to manual page clicking. Use an API-first approach: first observe the prepared 9222 browser and page state, then identify the page-owned API or request path that can complete the task with the least brittle operation surface:

1. Page-owned application APIs, frontend modules, actions, or observed request wrappers already loaded by the page.
2. In-page `fetch` or low-level request replay inside the current page context, after payload shape, auth context, business rules, and safety checks are understood.
3. Visible UI/DOM controls only when no reliable page-owned API path exists, when a human-visible interaction is the source of truth, or when UI readback is needed for verification.
4. Low-level CDP primitives only when the app/API layer and clear DOM controls are insufficient.

For read, export, download, create, update, publish, and multi-step flows, prefer the page-owned API path whenever it can be understood and verified safely. Verify results through UI refresh plus application/API readback when possible.

## Operating Loop

1. Classify the task as `read`, `operate`, or `flow`.
2. Connect to the 9222 browser and observe the current page before acting. If the endpoint is specifically connection refused, run the dedicated Chrome recovery above, verify both CDP endpoints, and retry; otherwise preserve the diagnostic and do not replace the browser. Then record the URL, title, visible text, controls, tables, downloads, network clues, app/framework clues, and blocking states.
3. Identify the page-owned API/request path first: loaded frontend modules, action wrappers, observed network requests, endpoint shapes, pagination/export/download routes, and required payload fields.
4. Build a page model that names the user's goal, the relevant objects, safe actions, risks, and success evidence.
5. For state-changing work, read business rules before editing: quotas, used/remaining capacity, percentage totals, field validation, permission state, disabled-state rules, and save semantics.
6. Choose the least brittle API-first operation surface. Use DOM controls only when the API path is unavailable, unsafe, unverifiable, or when visible UI interaction is itself the required task.
7. Plan small steps with stop conditions. Every planned action needs a readback or verification signal, and ratio/percentage updates must avoid invalid intermediate totals.
8. Execute one safe action at a time, preferably through the page's own API in the current page context. Re-observe after page transitions, dialogs, downloads, navigation, or re-render.
9. Verify against evidence, not hope: application/API readback, stable network results, visible UI state after refresh, extracted rows, downloaded files, changed URL, or success messages. Use double verification for state-changing tasks when available.
10. Journal the work. Record observations, discovered API paths, payload shapes, plans, actions, verification evidence, failures, and the final reusable workflow notes.

Use `scripts/web_agent_protocol.py` for the shared task taxonomy, safety checks, plan template, and evidence journal schema:

```bash
python3 scripts/web_agent_protocol.py classify "抓取这个页面表格并总结"
python3 scripts/web_agent_protocol.py plan "筛选近7天并下载导出文件"
python3 scripts/web_agent_protocol.py journal-template "多页面收集详情证据"
```

Use `scripts/web_operator.py` for the normal five-verb web operation protocol:

```bash
python3 scripts/web_operator.py observe --cdp-url http://127.0.0.1:9222 --url-prefix https://example.com --task "summarize the page" --journal run.json
python3 scripts/web_operator.py act click --url-prefix https://example.com --selector "button.export" --reason "open export menu" --journal run.json
python3 scripts/web_operator.py act navigate --url-prefix https://example.com --url "https://example.com/report" --reason "open report page" --journal run.json
python3 scripts/web_operator.py act paginate --url-prefix https://example.com --selector "button.next" --reason "move to next result page" --journal run.json
python3 scripts/web_operator.py act upload --url-prefix https://example.com --selector "input[type=file]" --file ./input.csv --reason "attach import file" --journal run.json
python3 scripts/web_operator.py act upload-chooser --url-prefix https://example.com --clicks-json '[{"x":120,"y":240}]' --file ./input.csv --reason "attach file through native chooser" --journal run.json
python3 scripts/web_operator.py act capture-wheel --url-prefix https://example.com --wheels-json '[{"x":640,"y":520,"delta_y":900}]' --value '[{"url_contains":"/api/"}]' --reason "capture lazy-load requests" --journal run.json
python3 scripts/web_operator.py act download --url-prefix https://example.com --selector "a.export" --expected-file report.csv --download-dir ~/Downloads --reason "download export artifact" --journal run.json
python3 scripts/web_operator.py verify --url-prefix https://example.com --expression "document.body.innerText.includes('Export')" --evidence "export menu visible" --journal run.json
python3 scripts/web_operator.py verify --check file-exists --target report.csv --download-dir ~/Downloads --evidence "report file exists" --journal run.json
python3 scripts/web_operator.py distill --journal run.json --output workflow.md
python3 scripts/web_operator.py distill --journal run.json --output-dir reusable-workflow --name example-export --include-skill
```

Use `scripts/browser_executor.py` only when you need low-level direct CDP primitives:

```bash
python3 scripts/browser_executor.py cdp --cdp-url http://127.0.0.1:9222 --url-prefix https://example.com observe
python3 scripts/browser_executor.py cdp --cdp-url http://127.0.0.1:9222 --url-prefix https://example.com eval --script "document.title"
python3 scripts/browser_executor.py cdp --cdp-url http://127.0.0.1:9222 --url-prefix https://example.com capture --capture-mode passive --matches-json '[{"url_contains":"/api/"}]'
```

Use crawshrimp-compatible execution helpers when reusing or distilling adapter-shaped work:

```bash
python3 scripts/adapter_registry.py --root adapters scan
python3 scripts/knowledge_service.py --adapters-root adapters --probes-root probes --data-root knowledge rebuild
python3 scripts/knowledge_service.py --data-root knowledge search --query "export drawer" --adapter temu --task goods_traffic_detail
python3 scripts/phase_runner.py --url-prefix https://example.com --file adapters/demo/orders.js --params-json '{"keyword":"sku"}' --artifact-dir artifacts
```

## Crawshrimp Runtime Compatibility

This skill mirrors the main crawshrimp execution surfaces in reusable form:

- adapter/task registry and safe manifest path resolution
- auth check script execution
- knowledge cards from notes and probe bundles
- probe bundle artifacts: DOM, framework, network, endpoints, strategy, recommendations, report
- JSRunner-style phase/shared runtime with `window.__CRAWSHRIMP_PAGE__`, `window.__CRAWSHRIMP_PHASE__`, `window.__CRAWSHRIMP_SHARED__`, and `window.__CRAWSHRIMP_PARAMS__`
- runtime actions: `cdp_clicks`, `inject_files`, `file_chooser_upload`, `capture_click_requests`, `capture_url_requests`, `capture_wheel_requests`, `download_urls`, `download_clicks`, `reload_page`, `next_phase`, `complete`, `abort`
- request capture options for URL/click/wheel flows: `matches`, `min_matches`, `settle_ms`, and `include_response_body`
- URL download retries, concurrency, progress, artifact naming, existing-file skip, and data URL support
- browser-session URL downloads through a temporary CDP tab when a file URL depends on logged-in browser state
- click-download artifact detection with hooks for host-level transient tab handling
- navigation retry and timeout reload recovery in the phase runner

## Supported Task Families

| Family | Use for | Completion evidence |
| --- | --- | --- |
| `read` | table extraction, search results, page summaries, visible data export | extracted records match visible page evidence or cited source areas |
| `operate` | filters, pagination, opening details, downloads, safe form filling | page state, file artifact, or form readback proves the requested state |
| `flow` | multi-page, multi-dialog, repeated detail collection, reusable workflow discovery | journal contains transition evidence and reusable workflow notes |

## Safety Boundary

Default to safe, reversible, or read-only actions. Stop and ask the user before submit, publish, send, delete, pay, purchase, confirm, bulk modify, or any action with external side effects.

Do not treat a filled form as permission to submit it. Filling fields can be safe; sending the form or calling the equivalent save API is a separate dangerous action.

For any final save, submit, publish, or externally visible mutation, require explicit authorization for that exact change unless the user's instruction already gives it. If authorization is already explicit in the conversation, proceed with a journaled API-first action and immediate readback.

## Reference Map

- Read `references/protocol.md` for the protocol objects, task families, action risks, and evidence journal.
- Read `references/page-observation.md` when the page is unknown or dynamic and needs a durable page model.
- Read `references/task-planning.md` when converting a user goal into small web actions.
- Read `references/action-primitives.md` before clicking, typing, selecting, downloading, uploading, waiting, or navigating.
- Read `references/network-intelligence.md` when finding the page-owned API/request path before falling back to DOM actions.
- Read `references/browser-execution.md` before using direct Chrome/CDP, `observe / act / verify / journal / distill`, or low-level request capture.
- Read `references/enterprise-form-workflows.md` before editing authenticated internal forms, quotas, percentages, allocations, approval flows, or other enterprise workflow settings.
- Read `references/verification.md` for structured completion checks.
- Read `references/safety.md` before any caution or dangerous action.
- Read `references/workflow-distillation.md` after a workflow succeeds and should become a reusable skill, script, CLI command, or adapter draft.
- Read `references/workflow-reuse.md` for the generated reusable package contract.
- Read `references/verification-and-journal.md` before claiming the task is complete or distilling a reusable workflow.
- Read `PLAN.md` for the implementation roadmap for this repository.

## Common Mistakes

- Acting before observing the page.
- Opening a fresh browser or extension before checking the user's existing `http://127.0.0.1:9222` browser, or using one for anything other than the explicit connection-refused recovery path.
- Asking the user to log in again after seeing a login page without checking the 9222 CDP browser session.
- Asking the user to start Chrome after both CDP health endpoints reported connection refused instead of starting the dedicated Chrome yourself.
- Launching or killing a Chrome process for a timeout, 404, invalid/partial CDP response, login page, or target-tab mismatch.
- Starting with manual clicks when a page-owned API/request path can solve and verify the task safely.
- Editing enterprise form values before reading business rules, quotas, used capacity, or total-percentage constraints.
- Raising percentage items before lowering the oversized item when the form enforces a total cap.
- Brute-forcing a brittle DOM/coordinate path when the page already exposes a safe frontend API wrapper or request route.
- Running one large script without readback checkpoints.
- Treating a clicked button as success without checking resulting state.
- Submitting, publishing, deleting, sending, paying, or bulk modifying without explicit user confirmation.
- Claiming a state-changing task from only one signal; use double verification with application/API readback and refreshed UI when available.
- Forgetting to record evidence, which makes the workflow impossible to debug or reuse.
- Stopping at `workflow.md` when the workflow will be repeated; generate a reusable package with `distill --output-dir`.
