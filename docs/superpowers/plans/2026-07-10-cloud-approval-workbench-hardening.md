# Cloud Approval Workbench Reliability and Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the ten reviewed correctness and security defects in cloud batch submission, sync ownership, job leasing, completion delivery, machine authentication, Prompt resolution, workbook handling, UI request ordering, and direct-generation finalization.

**Architecture:** Keep the existing Cloudflare Worker, D1/R2, desktop machine agent, and Vue/Electron boundaries. Enforce durable identity with existing unique keys, make state transitions conditional and terminal, add a desktop lease keeper and SQLite completion outbox, and isolate workbook and UI concurrency changes behind focused helpers.

**Tech Stack:** Cloudflare Workers, D1 SQLite, R2, TypeScript, Vitest, Vue 3, Electron, Python 3.12, SQLite, Python `unittest`, Node built-in test runner, Vite 8.

## Global Constraints

- Work only in `/Users/xingyicheng/Documents/crawshrimp/.worktrees/cloud-approval-workbench` on `codex/cloud-approval-workbench`.
- Preserve all pre-existing dirty changes. In particular, keep unrelated model/ratio/task-runner edits in `core/cloud_job_executors.py`, `tests/test_cloud_job_executors.py`, and the listed Tmall/app files.
- Never stage or commit a pre-existing dirty hunk. If a task touches an already-dirty file, validate the combined file but leave it unstaged unless the unrelated hunk has been committed by its owner.
- Follow RED -> GREEN for every behavior. Do not edit production code before observing the named regression test fail for the expected reason.
- Keep submit retries operator-driven; never automatically move an ambiguous Tmall submit to another machine.
- Keep lease TTL at 300 seconds and renew long operations every 60 seconds.
- Workbook limits are 20 MiB, 32 sheets, 20,000 rows per sheet, and 256 columns per sheet.
- Production Prompt resolution must never return `version_id: null`.
- Direct-generation result identities must be deterministic from `request_uid` and output index.
- Do not replace `xlsx`, change workbook parsing semantics, add workbook limits, or upgrade Vite in this execution; the user deferred Task 4 on 2026-07-10.

## Execution Status (2026-07-10)

- Tasks 1-3: implemented in `4ec74d9b` and covered by the Cloud Worker suite.
- Task 4: explicitly deferred; `xlsx`, Vite, and esbuild audit findings remain accepted follow-up risk.
- Tasks 5-7: implemented with RED -> GREEN coverage in the current worktree.
- Task 8: functional test/build gates pass; the dependency audit remains non-zero only for the deferred Task 4 dependencies.

---

### Task 1: Batch-level submit identity and sync ownership

**Files:**
- Modify: `cloud/approval-workbench/src/tests/batches.test.ts`
- Modify: `cloud/approval-workbench/src/tests/review.test.ts`
- Modify: `cloud/approval-workbench/src/worker/batch-routes.ts`
- Modify: `cloud/approval-workbench/src/worker/asset-routes.ts`

**Interfaces:**
- Consumes: `batch_uid`, selected `machine_id`, existing dispatch-job states, replayed style/asset sync payloads.
- Produces: canonical `submit_tmall_material_test:{batch_uid}` keys, legacy active-job protection, and `upsertAsset(..., statusPolicy)`.

- [ ] **Step 1: Add failing submit regression tests**

Add tests that submit the same ready batch to `machine-1` and `machine-2`, then assert one dispatch row and the original assigned machine. Seed a legacy active row with key `submit_tmall_material_test:batch-20260707:machine-1`, submit with machine 2, and assert HTTP 409 with no second row. Add a terminal-failure retry test that asserts the same job UID is requeued with the newly selected machine.

```ts
expect(state.jobs.filter((job) => job.job_type === 'submit_tmall_material_test')).toHaveLength(1)
expect(state.jobs[0].idempotency_key).toBe('submit_tmall_material_test:batch-20260707')
expect(state.jobs[0].assigned_machine_id).toBe('machine-1')
```

- [ ] **Step 2: Add failing sync replay tests**

Create a batch, mark one AI asset `approved`, one `rejected`, and the style `approved`, replay the same sync payload, and assert all cloud-owned states remain unchanged. Add a submitted-batch test expecting HTTP 409. Add a new-style replay test asserting the batch is recomputed to `pending_review` while existing decisions remain.

```ts
expect(state.assets.find((row) => row.asset_uid === 'asset-ai-1')?.status).toBe('approved')
expect(state.styles[0].status).toBe('approved')
expect(response.status).toBe(409)
```

- [ ] **Step 3: Run targeted tests and verify RED**

Run:

```bash
cd cloud/approval-workbench
npx vitest run src/tests/batches.test.ts src/tests/review.test.ts
```

Expected: new tests fail because submit identity includes `machineId`, sync overwrites states, and submitted sync is accepted.

- [ ] **Step 4: Implement canonical submit identity**

Use the batch-only key and check `hasActiveSubmitJob()` before inserting or requeuing when no canonical active row exists.

```ts
const idempotencyKey = `submit_tmall_material_test:${batchUid}`
const existing = await findDispatchJob(env, 'submit_tmall_material_test', idempotencyKey)
const activeSubmit = await activeSubmitJobForBatch(env, batchUid)
if (activeSubmit && activeSubmit.job_uid !== existing?.job_uid) {
  return json({ error: 'batch already has an active submit job', code: 'batch_submit_active' }, { status: 409 })
}
```

Keep active canonical jobs unchanged, reject succeeded jobs, and requeue only explicit terminal/retryable/cancelled states.

- [ ] **Step 5: Implement sync ownership**

Reject submitted batches before any write. Remove `status = excluded.status` from the style conflict update. Extend `upsertAsset`:

```ts
statusPolicy?: 'replace' | 'preserve-existing'
```

Bind the conflict status with SQL equivalent to:

```sql
status = CASE
  WHEN ? = 'preserve-existing' THEN ai_image_assets.status
  ELSE excluded.status
END
```

Pass `preserve-existing` only from `upsertSyncedAsset`, then call `recomputeReviewState` after replay sync.

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run the command from Step 3. Expected: both files pass with no new failures.

- [ ] **Step 7: Check task diff boundary**

Run:

```bash
git diff --check -- cloud/approval-workbench/src/tests/batches.test.ts cloud/approval-workbench/src/tests/review.test.ts cloud/approval-workbench/src/worker/batch-routes.ts cloud/approval-workbench/src/worker/asset-routes.ts
git diff --stat -- cloud/approval-workbench/src/tests/batches.test.ts cloud/approval-workbench/src/tests/review.test.ts cloud/approval-workbench/src/worker/batch-routes.ts cloud/approval-workbench/src/worker/asset-routes.ts
```

Expected: clean diff check and only Task 1 files.

---

### Task 2: Lease exhaustion, machine-token error code, and published Prompt versions

**Files:**
- Modify: `cloud/approval-workbench/src/tests/machines.test.ts`
- Modify: `cloud/approval-workbench/src/tests/prompts.test.ts`
- Modify: `cloud/approval-workbench/src/worker/http.ts`
- Modify: `cloud/approval-workbench/src/worker/machine-routes.ts`
- Modify: `cloud/approval-workbench/src/worker/prompt-routes.ts`

**Interfaces:**
- Produces: `unauthorized(message, code?)`, terminal lease recovery, `machine_token_invalid`, `prompt_library_not_published`, and `prompt_library_version_incomplete`.

- [ ] **Step 1: Add failing lease-exhaustion tests**

Seed a busy machine and expired running job with `attempt_count === max_attempts === 1`. Trigger claim from another machine. Assert the expired job becomes `terminal_failed`, its lease is cleared, the old machine becomes idle, the result reason is stored, and exactly one `lease_expired_terminal` event exists after two recovery calls.

```ts
expect(expired.status).toBe('terminal_failed')
expect(expired.lease_id).toBeNull()
expect(oldMachine.current_job_id).toBeNull()
expect(JSON.parse(expired.result_json).reason).toBe('lease_expired_attempts_exhausted')
```

- [ ] **Step 2: Add failing token and Prompt tests**

Assert an invalid bearer token returns HTTP 401 and `{ code: 'machine_token_invalid' }`. Add one draft-library resolve test and one published library containing an enabled unversioned template; both must return HTTP 409 with their respective stable codes.

- [ ] **Step 3: Run targeted tests and verify RED**

```bash
cd cloud/approval-workbench
npx vitest run src/tests/machines.test.ts src/tests/prompts.test.ts
```

Expected: lease remains stuck, token has no code, and draft/unversioned Prompt rows resolve successfully.

- [ ] **Step 4: Add coded unauthorized responses**

```ts
export function unauthorized(message = 'Unauthorized', code = ''): Response {
  return json(code ? { error: message, code } : { error: message }, { status: 401 })
}
```

Use `unauthorized('Invalid machine token', 'machine_token_invalid')` in `requireMachine`.

- [ ] **Step 5: Terminalize exhausted leases**

Select expired jobs with `attempt_count >= max_attempts`, update only currently active expired rows to `terminal_failed`, clear their leases, write a redacted reason object, release their machines, update linked generation requests to failed, and record events only for rows selected before the update.

- [ ] **Step 6: Require published immutable Prompt versions**

Load the library at the start of `resolvePrompts`. Return coded 404/409 responses as specified. After `latestVersionsByTemplate`, reject when any enabled template lacks a version. Remove the mutable fallback from the production resolve path.

- [ ] **Step 7: Run targeted tests and verify GREEN**

Run the Step 3 command. Expected: both test files pass.

---

### Task 3: Direct cloud generation single-finalizer CAS

**Files:**
- Modify: `cloud/approval-workbench/src/tests/review.test.ts`
- Modify: `cloud/approval-workbench/src/worker/batch-routes.ts`

**Interfaces:**
- Produces: conditional `claimDirectGenerationFinalization(env, requestUid)`, `finalizing` polling semantics, and deterministic `cloud-gen-{requestUid}-{index}` asset UIDs.

- [ ] **Step 1: Add a failing concurrent-poll test**

Use a deferred fake upstream result so two poll requests both read `running` before either completes. Resolve both and assert one request stores the assets, the other returns completed/202 without storing another set, and every result UID is deterministic.

```ts
expect(state.assets.filter((row) => row.generation_job_id === requestUid)).toHaveLength(2)
expect(resultUids).toEqual([`cloud-gen-${requestUid}-1`, `cloud-gen-${requestUid}-2`])
```

- [ ] **Step 2: Run the regression and verify RED**

```bash
cd cloud/approval-workbench
npx vitest run src/tests/review.test.ts -t "finalizes direct generation once"
```

Expected: duplicate randomly named assets are stored.

- [ ] **Step 3: Implement the finalization claim**

After upstream settlement reports completed and before storing data, execute:

```sql
UPDATE ai_generation_requests
SET status = 'finalizing', updated_at = ?
WHERE request_uid = ? AND status IN ('queued', 'running')
```

Only a one-row update may call `completeDirectGenerationRequest`. A losing request reloads status and returns existing assets for `completed`, or HTTP 202 for `finalizing`.

- [ ] **Step 4: Use deterministic asset identity and safe retry writes**

Replace the random UID with:

```ts
const assetUid = `cloud-gen-${details.requestUid}-${index + 1}`
```

Keep object keys and resource upserts derived from that UID. Update failures only from `finalizing` to `failed`; never overwrite `completed`.

- [ ] **Step 5: Run review tests and verify GREEN**

```bash
cd cloud/approval-workbench
npx vitest run src/tests/review.test.ts
```

Expected: all review tests pass.

---

### Task 4: Secure, bounded workbook imports and exports — Deferred by user

**Decision:** Do not execute this task in the current hardening pass. Keep it as the exact follow-up plan for a separately validated workbook migration.

**Files:**
- Modify: `cloud/approval-workbench/package.json`
- Modify: `cloud/approval-workbench/package-lock.json`
- Create: `cloud/approval-workbench/src/app/workbookLimits.ts`
- Create: `cloud/approval-workbench/src/tests/workbook-limits.test.ts`
- Modify: `cloud/approval-workbench/src/app/materialDataImport.ts`
- Modify: `cloud/approval-workbench/src/app/promptExcel.ts`
- Modify: `cloud/approval-workbench/src/tests/material-data.test.ts`
- Modify: `cloud/approval-workbench/src/tests/prompt-excel.test.ts`

**Interfaces:**
- Produces: `assertWorkbookFileSize(file)`, `assertWorkbookShape(sheetNames, rowsBySheet)`, dynamically loaded readers/writer, and the existing normalized workbook outputs.

- [ ] **Step 1: Add failing limit tests**

Test exactly-at-limit acceptance and over-limit rejection for file bytes, sheet count, row count, and column count. Expected error messages must identify the violated limit.

```ts
expect(() => assertWorkbookShape(Array.from({ length: 33 }, (_, i) => `S${i}`), new Map())).toThrow(/32/)
expect(() => assertWorksheetRows('明细', [Array(257).fill('x')])).toThrow(/256/)
```

- [ ] **Step 2: Run limit tests and verify RED**

```bash
cd cloud/approval-workbench
npx vitest run src/tests/workbook-limits.test.ts
```

Expected: module does not exist.

- [ ] **Step 3: Implement pure limit helpers**

Export constants for 20 MiB, 32, 20,000, and 256. Count the widest row, not only the first row. Reject before normalization.

- [ ] **Step 4: Replace workbook dependencies**

```bash
cd cloud/approval-workbench
npm remove xlsx
npm install read-excel-file@9.3.0 write-excel-file@4.1.1
npm install -D vite@8.1.4 @vitejs/plugin-vue@6.0.7
```

Move Vite and the Vue plugin out of `dependencies`. Import browser entrypoints dynamically inside workbook actions.

- [ ] **Step 5: Preserve workbook contracts**

Use `readSheetNames` followed by per-sheet `readXlsxFile(file, { sheet })`. Convert returned cell matrices into the existing header/object representation. For Prompt export, build the existing grouped matrices and pass them to `write-excel-file` with parallel `sheets` names and a sanitized filename.

- [ ] **Step 6: Run workbook tests, typecheck, build, and audit**

```bash
cd cloud/approval-workbench
npx vitest run src/tests/workbook-limits.test.ts src/tests/material-data.test.ts src/tests/prompt-excel.test.ts
npm run typecheck
npm run build
npm audit --omit=dev
```

Expected: tests/typecheck/build exit 0; production audit contains no high or critical vulnerabilities.

---

### Task 5: Prompt picker stale-response protection

**Files:**
- Create: `app/src/renderer/utils/promptLibraryRequestGuard.js`
- Create: `app/src/renderer/utils/promptLibraryRequestGuard.test.js`
- Modify: `app/src/renderer/components/PromptLibraryPickerModal.vue`
- Modify: `tests/ai-image-workbench-navigation.test.js`

**Interfaces:**
- Produces: `createPromptLibraryRequestGuard()` with `begin(key)`, `isCurrent(token, key)`, and `invalidate()`.

- [ ] **Step 1: Add failing pure guard tests**

```js
test('only the latest library request remains current', () => {
  const guard = createPromptLibraryRequestGuard()
  const first = guard.begin('cloud:1')
  const second = guard.begin('cloud:2')
  assert.equal(guard.isCurrent(first, 'cloud:1'), false)
  assert.equal(guard.isCurrent(second, 'cloud:2'), true)
  guard.invalidate()
  assert.equal(guard.isCurrent(second, 'cloud:2'), false)
})
```

- [ ] **Step 2: Run and verify RED**

```bash
cd app
node --test src/renderer/utils/promptLibraryRequestGuard.test.js
```

Expected: helper module does not exist.

- [ ] **Step 3: Implement and wire the guard**

Create a closure-backed monotonically increasing sequence. In the modal, call `begin(id)` before any local/cloud load, check `isCurrent` before every state write after `await`, and call `invalidate()` on close and modal reset. Only the current request may clear `templatesLoading`.

- [ ] **Step 4: Run renderer tests and verify GREEN**

```bash
cd app
node --test src/renderer/utils/promptLibraryRequestGuard.test.js
cd ..
node --test tests/ai-image-workbench-navigation.test.js
```

Expected: both suites pass.

---

### Task 6: SQLite completion outbox and credential recovery

**Files:**
- Modify: `core/data_sink.py`
- Modify: `core/cloud_approval_client.py`
- Modify: `core/cloud_machine_agent.py`
- Modify: `tests/test_cloud_machine_data_sink.py`
- Modify: `tests/test_cloud_approval_client.py`
- Modify: `tests/test_cloud_machine_agent.py`

**Interfaces:**
- Produces: persisted lease-aware completion rows, due-entry listing/backoff, structured HTTP error metadata, and `CloudMachineAgent.flush_pending_completions()`.

- [ ] **Step 1: Add failing data-sink migration and outbox tests**

Assert a saved entry returns `job_uid`, `lease_id`, result, attempt count, and due time; listing returns only due rows; marking an attempt increments the counter; re-running `init_db()` preserves the row and required columns.

```python
saved = data_sink.save_pending_cloud_job_completion("job-1", "lease-1", {"ok": True})
self.assertEqual(saved["lease_id"], "lease-1")
self.assertEqual(data_sink.list_pending_cloud_job_completions()[0]["result"], {"ok": True})
```

- [ ] **Step 2: Add failing agent and client tests**

Make one agent persist a completion after HTTP 502, create a new agent, and assert its next loop sends `/complete` before heartbeat or claim. Add stale-lease clearing, transient backoff, and invalid-token credential-clearing tests. Extend `CloudApprovalError` assertions to include `status` and parsed `payload`.

- [ ] **Step 3: Run targeted Python tests and verify RED**

```bash
./venv/bin/python -m unittest tests.test_cloud_machine_data_sink tests.test_cloud_approval_client tests.test_cloud_machine_agent
```

Expected: new signatures, listing behavior, structured errors, and pre-claim flush are absent.

- [ ] **Step 4: Add structured CloudApprovalError metadata**

```python
class CloudApprovalError(RuntimeError):
    def __init__(self, message: str, *, status: int = 0, payload: Mapping[str, Any] | None = None):
        super().__init__(message)
        self.status = int(status or 0)
        self.payload = dict(payload or {})
```

Raise it with status/payload from JSON HTTP failures while preserving existing message text.

- [ ] **Step 5: Migrate and implement the completion outbox**

Add missing SQLite columns through `PRAGMA table_info` plus `ALTER TABLE`. Implement the exact spec interfaces, deserialize `result_json`, and compare `next_attempt_at` against UTC ISO strings.

- [ ] **Step 6: Flush outbox before idle heartbeat and claim**

For each due row, post its persisted lease and result. Clear on success or stale lease. On transient failure, record an event and schedule bounded backoff from `(10, 30, 60, 120)` seconds. Never attach an old completion to a newly claimed lease.

- [ ] **Step 7: Clear invalid credentials by stable contract**

Clear when `exc.status == 401` and payload code is `machine_token_invalid`, while retaining temporary text compatibility for the two old messages.

- [ ] **Step 8: Run targeted tests and verify GREEN**

Run the Step 3 command. Expected: all tests pass.

---

### Task 7: Background lease keeper for blocking desktop operations

**Files:**
- Modify: `core/cloud_job_executors.py`
- Modify: `tests/test_cloud_job_executors.py`

**Interfaces:**
- Produces: `_LeaseKeeper` and `_run_with_lease_keeper(job, operation)`; keeps existing ratio/model behavior in dirty hunks unchanged.

- [ ] **Step 1: Add failing lease-keeper tests**

Inject a short renewal interval and controlled blocking operation. Assert renew is called more than once, the keeper stops on success and exceptions, cancellation surfaces as `CloudJobCancelled`, and a renewal failure is raised before the executor returns a successful result.

```python
started = threading.Event()
release = threading.Event()
def operation():
    started.set()
    release.wait(1)
    return {"ok": True}
```

- [ ] **Step 2: Run targeted tests and verify RED**

```bash
./venv/bin/python -m unittest tests.test_cloud_job_executors.CloudJobExecutorTests.test_lease_keeper_renews_during_long_generation tests.test_cloud_job_executors.CloudJobExecutorTests.test_lease_keeper_propagates_renew_failure
```

Expected: helper/behavior is absent.

- [ ] **Step 3: Implement the keeper**

Use `threading.Event.wait(interval)` so shutdown is immediate and testable. Capture the first exception under a lock, stop in `finally`, join with a bounded timeout, and raise the captured exception on the foreground thread.

- [ ] **Step 4: Wrap only long blocking calls**

Wrap:

```python
module.regenerate_approval_asset(...)
module.generate_approval_asset_for_item(...)
_run_maybe_async(module.upload_approved_tmall_batch(batch))
_run_maybe_async(self._material_test_runner()(run_params, task_dir, job))
```

Do not modify the existing ratio propagation or model selection changes in the dirty file.

- [ ] **Step 5: Run executor tests and verify GREEN**

```bash
./venv/bin/python -m unittest tests.test_cloud_job_executors
```

Expected: all executor tests pass.

---

### Task 8: Formatting cleanup and full verification

**Files:**
- Modify: `app/src/dataDirRecovery.js`
- Modify: `app/src/dataDirRecovery.test.js`
- Verify all files changed by Tasks 1-7.

**Interfaces:**
- Produces: a clean patch and evidence for every completion claim.

- [ ] **Step 1: Remove only the extra EOF blank lines**

Use `apply_patch` to leave exactly one final newline in both files. Do not change code.

- [ ] **Step 2: Run scoped validation suggestion**

```bash
python3 /Users/xingyicheng/.codex/skills/scoped-validation/scripts/suggest_validation.py /Users/xingyicheng/Documents/crawshrimp/.worktrees/cloud-approval-workbench
```

Review the suggested commands against the cross-cutting risk and keep the full gates below.

- [ ] **Step 3: Run Cloud gates**

```bash
cd cloud/approval-workbench
npm run check
npm audit --omit=dev
```

Expected: typecheck, all Vitest tests, and build exit 0. The audit is expected to remain non-zero for the explicitly deferred `xlsx@0.18.5` advisories; capture and report the exact counts without treating them as a regression in the nine implemented fixes.

- [ ] **Step 4: Run Electron gates**

```bash
cd app
npm test
npm run vite:build
```

Expected: all tests and build exit 0.

- [ ] **Step 5: Run branch-related Python and Node gates**

From repository root:

```bash
pytests=(${(f)"$( { git diff --name-only main...HEAD; git diff --name-only; } | sort -u | rg '^tests/test_.*\.py$' )"}); ./venv/bin/python -m unittest ${pytests[@]}
jstests=(${(f)"$( { git diff --name-only main...HEAD; git diff --name-only; } | sort -u | rg '^tests/.*\.test\.js$' )"}); node --test ${jstests[@]}
```

Expected: all selected tests pass with zero failures.

- [ ] **Step 6: Verify patch integrity and concurrency context**

```bash
git diff --check
git status --short --branch
git diff --stat
git merge-tree --write-tree main HEAD
```

Expected: diff check and merge-tree exit 0. Classify every remaining dirty file as hardening work or preserved pre-existing work; do not claim a clean worktree while unrelated edits remain.

- [ ] **Step 7: Review the ten-item acceptance checklist**

Confirm evidence exists for: batch submit identity, sync preservation, exhausted lease terminalization, long-operation renewal, completion outbox replay, token reset, published-only Prompt resolution, workbook dependency removal/limits, Prompt picker ordering, and direct-generation CAS.
