# Main Ahead Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Repair all four P1 and six P2 findings in origin/main..main, restore every affected validation gate, and complete a fresh inline code review without introducing regressions.

**Architecture:** Keep the existing adapters and services intact while tightening their state transitions and trust boundaries. Each production behavior change is driven by a regression test that is observed failing first, then implemented minimally and revalidated at package and repository scope.

**Tech Stack:** Node.js node:test and vm adapter harnesses, Python 3.12 with pytest/unittest, FastAPI service modules, Vue 3, urllib/curl provider transport, JSON Schema.

## Global Constraints

- Execute directly on the current local main branch; the user explicitly authorized main and prohibited subagents.
- Do not push, publish, tag, or create a pull request.
- Preserve the intentional behavior that genuinely duplicated user-submitted member URLs remain duplicated.
- Treat provider URLs and response bytes as untrusted input.
- Use RED -> GREEN for every production fix and capture the focused command result before moving on.
- Finish with full repository tests, Vite build, diff checks, secret scan, and a fresh review of the complete working diff.

---

### Task 1: Tmall member input de-duplication

**Files:**
- Modify: adapters/tmall-ops-assistant/tmall-compete-member-monitor.js:170
- Test: tests/tmall-ops-assistant-member-monitor.test.js

**Interfaces:**
- Consumes: input_file rows, sheet_name, and sheets returned by the workbook API.
- Produces: collectInputRows(params), with the active top-level sheet represented once while explicit duplicate submissions remain intact.

- [x] **Step 1: Write the failing transport-shape regression**

Add a node:test case that JSON-roundtrips a workbook object containing top-level rows plus sheets[active].rows and asserts that the active seller occurs once while a second sheet is still included.

- [x] **Step 2: Verify RED**

Run: node --test tests/tmall-ops-assistant-member-monitor.test.js

Expected: the new case reports two active-sheet occurrences instead of one.

- [x] **Step 3: Implement active-sheet exclusion**

When top-level rows exist, skip only the sheet named by file.sheet_name while collecting the remaining sheets. Do not apply value-based de-duplication.

- [x] **Step 4: Verify GREEN**

Run: node --test tests/tmall-ops-assistant-member-monitor.test.js

Expected: every member-monitor test passes.

### Task 2: Tmall paid-monitor identity and date integrity

**Files:**
- Modify: adapters/tmall-ops-assistant/tmall-compete-paid-monitor.js:471-509
- Modify: adapters/tmall-ops-assistant/tmall-compete-paid-monitor.js:198-277
- Modify: adapters/tmall-ops-assistant/tmall-compete-paid-monitor.js:935-965
- Test: tests/tmall-ops-assistant-compete-monitor.test.js

**Interfaces:**
- Consumes: shop aliases, DMP search results, base-analysis tokens, and page-selected analysis/comparison dates.
- Produces: strict shop matching, a structureShops list rebuilt from resolved state, and a non-reversed analysis-period weekLabel.

- [x] **Step 1: Write three failing regressions**

Cover: unrelated first-result fallback must return null; a self token discovered during collect_batch must appear in the next structureShops state; page dates 2026-07-09..2026-07-15 vs 2026-07-02..2026-07-08 must label the analysis period as 2026-07-09~2026-07-15.

- [x] **Step 2: Verify RED**

Run: node --test tests/tmall-ops-assistant-compete-monitor.test.js

Expected: all three new expectations fail for the previously reviewed reasons.

- [x] **Step 3: Implement minimal state corrections**

Remove first-candidate fallback, derive the page-mode label from beginDate/endDate, and rebuild structureShops after selfShop/resolvedShops gain a token.

- [x] **Step 4: Verify GREEN**

Run: node --test tests/tmall-ops-assistant-compete-monitor.test.js

Expected: all compete-monitor tests pass.

### Task 3: Bala regeneration terminal states

**Files:**
- Modify: core/api_server.py:7474-7510
- Modify: core/bala_ai_video_review.py:350-404
- Test: tests/test_bala_ai_video_review_api.py
- Test: tests/test_bala_ai_video_review.py

**Interfaces:**
- Consumes: submit_workbench_batch accepted/run results and persisted AI-image job state.
- Produces: retry assets that enter generating only after accepted submission, and refresh logic that maps terminal failed/cancelled/expired jobs to failed review assets.

- [x] **Step 1: Write failing submission and refresh tests**

Add one test for MissingModelKeyError or accepted=false producing a failed retry asset, and one for refresh_generated_assets converting a generating asset backed by a failed job into failed with an explanatory review note.

- [x] **Step 2: Verify RED**

Run: venv/bin/python -m pytest -q tests/test_bala_ai_video_review.py tests/test_bala_ai_video_review_api.py

Expected: the new status assertions fail while existing review tests remain green.

- [x] **Step 3: Implement explicit terminal-state mapping**

Set generating only when accepted is true and a run was returned. Persist failed for non-submitted/rejected/exception paths, and reconcile failed/cancelled/expired job status during refresh.

- [x] **Step 4: Verify GREEN**

Run: venv/bin/python -m pytest -q tests/test_bala_ai_video_review.py tests/test_bala_ai_video_review_api.py

Expected: both files pass.

### Task 4: AI-video read-path and polling safety

**Files:**
- Modify: core/ai_video_generation_service.py:2323-2347
- Modify: app/src/renderer/views/AiVideoGenerationWorkbench.vue:2274-2301,2538-2543
- Test: tests/test_ai_video_generation_service.py
- Test: app/src/renderer/utils/aiVideoGenerationWorkbench.test.js

**Interfaces:**
- Consumes: persisted completed jobs and the four-second renderer poll.
- Produces: side-effect-free list/detail reads and a renderer single-flight guard for job reloads.

- [x] **Step 1: Write failing regressions**

Assert list_jobs/get_job never call ensure_run_poster, and assert the workbench guards interval reloads while a prior reload is in flight.

- [x] **Step 2: Verify RED**

Run: venv/bin/python -m pytest -q tests/test_ai_video_generation_service.py -k poster

Run: cd app && node --test src/renderer/utils/aiVideoGenerationWorkbench.test.js

Expected: synchronous backfill and missing in-flight guard assertions fail.

- [x] **Step 3: Remove synchronous backfill and add reload single-flight**

Keep poster extraction in archive finalization only. Track jobsReloading around listAiVideoJobs and skip interval-triggered reloads while true.

- [x] **Step 4: Verify GREEN**

Repeat the focused commands and confirm zero failures.

### Task 5: AI-video download and upload resource bounds

**Files:**
- Modify: core/ai_video_generation_service.py:552-629
- Modify: core/ai_video_generation_service.py:870-922
- Modify: core/ai_video_generation_service.py:2916-2983
- Test: tests/test_ai_video_generation_service.py

**Interfaces:**
- Consumes: local provider assets and provider-returned video URLs.
- Produces: streaming multipart iterables with Content-Length, streaming SHA256, HTTP/HTTPS-only downloads, explicit content-type checks, and a 200 MiB byte ceiling.

- [x] **Step 1: Write failing transport tests**

Cover: multipart creation does not call Path.read_bytes; video inspection hashes without read_bytes; non-HTTP URLs are rejected before transport; explicit text/html is rejected; streamed bytes over a patched small limit fail and remove the .part file.

- [x] **Step 2: Verify RED**

Run: venv/bin/python -m pytest -q tests/test_ai_video_generation_service.py -k "multipart or download or inspect_video"

Expected: each new assertion fails against the current eager/unbounded implementation.

- [x] **Step 3: Implement streaming and bounds**

Yield multipart headers/file chunks/footer, calculate and set Content-Length, hash files in chunks, validate URL scheme and response type, and enforce the limit both from Content-Length and accumulated bytes. Configure curl with protocol and max-file limits and recheck the final size.

- [x] **Step 4: Verify GREEN**

Repeat the focused command and run the complete tests/test_ai_video_generation_service.py file.

### Task 6: Contract and test-runner repair

**Files:**
- Modify: sdk/manifest.schema.json:62-80
- Modify: app/src/renderer/utils/aiVideoWorkflow.test.js
- Modify: tests/bala-ai-video-workflow-ui.test.js
- Modify: tests/ai-image-workbench-navigation.test.js
- Modify: tests/desktop-backend-startup.test.js
- Modify: docs/handovers/HANDOVER-2026-07-16-ai-video-generation-workbench.md:3

**Interfaces:**
- Consumes: ParamType.date, package-local app test cwd, and current implementation names/semantics.
- Produces: schema parity and source-contract tests that assert behavior currently implemented rather than obsolete spelling/order.

- [x] **Step 1: Use existing red gates as regression evidence**

Run: venv/bin/python -m pytest -q tests/test_temu_manifest.py

Run: npm --prefix app test

Run: node --test tests/bala-ai-video-workflow-ui.test.js tests/ai-image-workbench-navigation.test.js tests/desktop-backend-startup.test.js

Expected: 1 schema failure, 7 ENOENT app failures, and 13 stale source-contract failures.

- [x] **Step 2: Repair contracts without changing runtime behavior**

Add date to the schema; resolve view fixtures from import.meta.url; update source assertions to current function names, durable per-board review saves, current business labels, protocol registration order, multi-item backendApi import, and AI-video task filtering. Remove the documented trailing whitespace.

- [x] **Step 3: Verify GREEN**

Repeat the three commands and require zero failures.

### Task 7: Full validation and inline second review

**Files:**
- Review: every file changed by Tasks 1-6

**Interfaces:**
- Consumes: the complete uncommitted remediation diff.
- Produces: fresh test/build evidence and a second-review finding list with every issue either fixed or explicitly reported.

- [x] **Step 1: Run scoped and full validation**

Run the affected adapter tests, Bala tests, AI-video service tests, app tests, root Node tests, complete tests/ Python suite, package integration tests, Python compileall, and npm --prefix app run vite:build.

- [x] **Step 2: Run repository hygiene checks**

Run git status --short, git diff --check, a sensitive-key candidate scan, and inspect git diff --stat plus git diff.

- [x] **Step 3: Perform the second code review inline**

Re-read the final diff for correctness, concurrency, state transitions, compatibility, resource cleanup, security boundaries, and test quality. If a new defect is found, add a failing regression and repeat RED -> GREEN before final verification.

- [x] **Step 4: Report without committing**

Return the repaired-file summary, exact validation counts, second-review verdict, and remaining risks. Do not stage, commit, push, or dispatch agents.
