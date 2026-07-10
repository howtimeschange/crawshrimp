# Cloud Approval Workbench Reliability and Security Hardening Design

**Date:** 2026-07-10

**Status:** Approved for implementation

**Scope:** `codex/cloud-approval-workbench`, covering the Cloudflare approval workbench, the desktop cloud-machine agent, Prompt library integration, and workbook import/export.

**Scope update (2026-07-10):** The user explicitly deferred Section 8 workbook dependency replacement and input-limit work because its parser-compatibility surface is larger than the state-machine fixes. `xlsx@0.18.5` remains temporarily, and its known audit findings must be reported as accepted outstanding risk rather than fixed.

## Context

The cloud approval branch already passes its existing unit tests and builds, but review found ten correctness and security gaps. The highest-risk failures are duplicate irreversible Tmall submissions, cloud approval state being overwritten by replayed local sync, leases that can expire without reaching a terminal state, and desktop completion results that are persisted but never retried.

This hardening keeps the existing Cloudflare Worker plus desktop task-machine architecture. It strengthens the invariants at the boundaries where concurrent requests, process restarts, and untrusted workbooks currently bypass the happy-path tests.

## Goals

1. A batch can have at most one logical Tmall submit job, regardless of selected machine or concurrent requests.
2. Replaying local sync cannot erase cloud-owned review or submission state.
3. Every claimed job eventually becomes reclaimable or terminal, and every machine reservation is eventually released.
4. Long-running desktop operations keep a valid lease while they are running.
5. Completion results survive transient network failure and process restart, and are retried before new work is claimed.
6. Invalid machine credentials are cleared through a stable Worker/client error contract.
7. Production Prompt resolution only returns immutable published versions.
8. Workbook handling has no known high-severity production dependency advisory and enforces bounded input.
9. Stale Prompt-picker responses cannot overwrite the current selection.
10. Direct cloud generation can be finalized only once under concurrent polling.

## Non-goals

- Migrating dispatch jobs to Durable Objects or an external queue.
- Moving Tmall browser automation or local generation into the cloud.
- Redesigning the approval UI.
- Automatically retrying an ambiguous Tmall submit on a different machine.
- Changing unrelated AI-image model, ratio, lineage, or result-cache behavior already present in the worktree.

## System Invariants

The implementation must preserve these invariants:

- `submit_tmall_material_test` has one logical row per `batch_uid`.
- A succeeded submit job is never automatically requeued.
- An expired final attempt is terminalized and its machine reservation is released.
- Only the current, unexpired `lease_id` can renew, report progress, complete, or fail a job.
- A local sync owns source metadata; the cloud owns review and submit status after first ingestion.
- Machine production reads never receive a Prompt template with `version_id = null`.
- A direct generation request has at most one finalizer and one deterministic set of result asset UIDs.

## 1. Batch Submit Idempotency

### Logical identity

Change the submit idempotency key from:

```text
submit_tmall_material_test:{batch_uid}:{machine_id}
```

to:

```text
submit_tmall_material_test:{batch_uid}
```

The existing unique constraint on `(job_type, idempotency_key)` then becomes the database-level concurrency guard. Two Worker requests selecting different machines race on the same key and converge on the same job row.

### State handling

- `queued`, `leased`, `running`, `uploading_results`, and `cancel_requested`: return the existing job; do not change its assigned machine.
- `succeeded` or batch status `submitted`: return HTTP 409.
- `terminal_failed`, `retryable_failed`, `blocked_needs_login`, or `cancelled`: an authorized operator may explicitly submit again. Requeue the same row, reset attempt and result state, and assign the newly selected machine.
- Before insert or requeue, retain the batch-level active-submit query as a defensive guard for legacy rows whose old idempotency keys include a machine ID.

Legacy rows do not require a migration. The active-submit guard prevents a new key from running beside an already active legacy job; once legacy jobs are terminal, the new canonical row is used.

## 2. Sync Ownership and Review Preservation

### Batch

- Reject `POST /api/ai-image-batches/sync` with HTTP 409 when the existing batch is `submitted`.
- Preserve the existing cloud batch status on replay.
- Continue updating local identity, title, Prompt-version declaration, and source-machine metadata for non-submitted batches.

### Styles

On style conflict, update only source-owned fields:

- `skc_code`
- `category`
- `gender`
- `missing_prompt_reason`
- `source_summary_json`

Do not overwrite `status`, `review_summary_json`, or `submit_summary_json`.

### Assets

Extend the asset upsert contract with an explicit status policy:

```ts
statusPolicy: 'replace' | 'preserve-existing'
```

Normal upload/finalization paths use `replace`. Batch sync uses `preserve-existing`, which keeps the existing status while still refreshing safe source metadata. A newly inserted asset still receives `planned`.

After a replayed sync, recompute review state so newly added styles/assets can move a previously ready batch back to `pending_review` without erasing existing decisions.

## 3. Lease Exhaustion and Reservation Release

`recoverClaimableJobs()` will handle two expired groups:

1. Attempts remain: return the job to `queued`, clear lease and assigned machine, release the machine, and record `lease_expired_requeued`.
2. Attempts are exhausted: set `terminal_failed`, clear lease, retain the last assigned machine in event history, store result reason `lease_expired_attempts_exhausted`, release the machine, and record `lease_expired_terminal`.

For `generate_ai_image`, terminalizing the dispatch job also marks the linked generation request `failed`. Tmall submits remain manually retryable through the explicit submit endpoint; they are never automatically moved to another machine.

Recovery must be idempotent. A second claim request cannot emit a second terminalization event for the same already-terminal job.

## 4. Desktop Lease Keeper

Add a focused lease-keeper component in `core/cloud_job_executors.py`:

- Lease TTL remains 300 seconds.
- Renewal interval is 60 seconds.
- The keeper starts before each potentially long blocking operation: first generation, regeneration, Tmall submit, and material-data crawl.
- It runs in a daemon thread and stops in `finally`.
- It records the first renewal exception or cancellation response.
- After the blocking call returns, the foreground executor checks the keeper result before uploading or completing. A stale lease or cancellation prevents completion under the old lease.
- Fast download/upload phases keep their existing explicit renew calls.

The keeper does not attempt to forcibly terminate third-party browser or provider code. Its responsibility is to preserve the lease while the operation is valid and to prevent stale result writes when it is not.

## 5. Durable Completion Outbox

Extend local SQLite table `cloud_job_completion_results` with:

```sql
lease_id TEXT NOT NULL DEFAULT ''
result_json TEXT NOT NULL DEFAULT '{}'
last_error TEXT NOT NULL DEFAULT ''
attempt_count INTEGER NOT NULL DEFAULT 0
next_attempt_at TEXT NOT NULL DEFAULT ''
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
```

Existing databases are upgraded with additive `ALTER TABLE` checks.

Data-sink interfaces become:

```python
save_pending_cloud_job_completion(job_uid, lease_id, result, last_error="") -> dict
list_pending_cloud_job_completions(limit=20) -> list[dict]
mark_pending_cloud_job_completion_attempt(job_uid, error, next_attempt_at) -> None
clear_pending_cloud_job_completion(job_uid) -> None
```

The agent flushes due outbox entries before sending idle heartbeat or claiming new work. Successful completion clears the row. Transient failure increments the attempt counter and applies bounded exponential backoff. A stale lease response clears the row and records a local `completion_stale_lease` event because the old lease must never be replayed with a new claim.

For compatibility, reading an old row with no lease ID returns it but does not send it; the agent records and clears it as unreplayable rather than attaching it to a future lease.

## 6. Machine Credential Error Contract

All invalid, unknown, expired, or revoked machine bearer tokens return:

```json
{
  "error": "Invalid machine token",
  "code": "machine_token_invalid"
}
```

with HTTP 401. The generic code avoids exposing whether a token previously existed.

The desktop client clears saved machine credentials on HTTP 401 when the response contains `machine_token_invalid`. During a compatibility window it also recognizes the existing `Invalid machine token` and `machine_token_revoked` texts. Clearing credentials makes the next explicit enrollment use the provided registration token instead of returning `already_enrolled`.

## 7. Published-only Prompt Resolution

`GET /api/prompt-libraries/{id}/resolved` first loads the library.

- Missing library: HTTP 404.
- Library not `published`: HTTP 409 with code `prompt_library_not_published`.
- Published library: return only enabled templates that have a stored version.
- If an enabled template lacks a version, fail with HTTP 409 and code `prompt_library_version_incomplete`; never fall back to the mutable template row.

Prompt editing and export continue to use the existing library-management endpoints. No draft-preview behavior is added to the production `/resolved` route.

## 8. Workbook and Build Dependency Security

Remove `xlsx@0.18.5`.

Use:

- `read-excel-file@9.3.0` for material and Prompt workbook reads.
- `write-excel-file@4.1.1` for Prompt workbook export.

Both dependencies were checked in an isolated package-lock audit on 2026-07-10 with zero reported production vulnerabilities. Load them with dynamic `import()` only when a workbook action is requested.

Enforce before or during parsing:

- Maximum file size: 20 MiB.
- Maximum worksheets: 32.
- Maximum rows per worksheet: 20,000.
- Maximum columns per worksheet: 256.
- Reject limit violations with a user-facing validation error before API submission.

Upgrade build-only dependencies to `vite@8.1.4` and `@vitejs/plugin-vue@6.0.7`, and move both to `devDependencies`. The branch runtime uses Node `22.23.1`, satisfying Vite 8's Node requirement. This removes the audited Vite/esbuild advisories from production dependency accounting.

## 9. Prompt Picker Stale-response Guard

Add a monotonically increasing request sequence to `PromptLibraryPickerModal.vue`.

- Increment it for every library change, local resolution, modal close, and reload.
- Capture both sequence and selected picker key before awaiting the cloud response.
- Apply templates, errors, category reset, and loading completion only if both still match.

The behavior mirrors the existing stale-response guard in `OnlineGenerationView.vue`.

## 10. Direct Generation Finalization CAS

Add `finalizing` to the internal generation-request lifecycle.

Polling behavior:

1. If status is `completed`, return stored assets.
2. If status is `finalizing`, return HTTP 202 and ask the caller to poll again.
3. When the upstream task reports results, atomically update `running -> finalizing` with a conditional `WHERE status IN ('queued', 'running')`.
4. Only the request that changes one row may write assets.
5. A request that loses the CAS reloads state and returns completed assets or HTTP 202.

Result asset UIDs are deterministic:

```text
cloud-gen-{request_uid}-{1-based-index}
```

The object key and image-resource UID are derived from the same identity. Retrying after a Worker failure overwrites/reuses the same R2 object and database row instead of creating an orphan set.

If finalization fails, update `finalizing -> failed` with the error. A completed request is immutable.

## Error Handling and Observability

- All new conflict responses contain stable `code` fields in addition to human-readable `error` text.
- Lease recovery events include previous status, attempt count, max attempts, machine ID, and reason.
- Outbox retries record local events without including Prompt text, tokens, image data, or local absolute paths.
- Existing audit redaction remains mandatory on all added payloads.

## Test Strategy

### Cloud Worker tests

- Concurrent/cross-machine submit requests converge on one job.
- Legacy active submit rows block the new canonical key.
- Explicit retry reuses a failed logical job and succeeded jobs reject retry.
- Sync replay preserves approved, rejected, and submitted asset/style state.
- Submitted batches reject sync.
- Expired attempts-remaining jobs requeue; attempts-exhausted jobs terminalize and release machines.
- Invalid token returns the stable code.
- Draft and incomplete Prompt libraries are rejected.
- Two concurrent generation polls yield one deterministic asset set.
- Workbook parsing limit helpers reject oversized shapes.

### Desktop Python tests

- Lease keeper renews repeatedly during a controlled long operation.
- Lease keeper stops on success and exception.
- Renewal failure prevents stale completion.
- Completion outbox survives a new agent instance and flushes before claim.
- Stale outbox entries are cleared without replay under another lease.
- Invalid-token responses clear credentials and allow enrollment.

### Desktop renderer tests

- A slower cloud Prompt response cannot overwrite a newer library selection.
- Workbook imports preserve current row mapping and exports preserve sheet names and values.
- File, sheet, row, and column limits produce readable errors.

### Validation gates

Run all of the following before completion:

```bash
cd cloud/approval-workbench && npm run check
cd cloud/approval-workbench && npm audit --omit=dev
cd app && npm test && npm run vite:build
pytests=(${(f)"$( { git diff --name-only main...HEAD; git diff --name-only; } | sort -u | rg '^tests/test_.*\.py$' )"}); ./venv/bin/python -m unittest ${pytests[@]}
jstests=(${(f)"$( { git diff --name-only main...HEAD; git diff --name-only; } | sort -u | rg '^tests/.*\.test\.js$' )"}); node --test ${jstests[@]}
git diff --check
git merge-tree --write-tree main HEAD
git status --short --branch
```

## Rollout and Compatibility

- D1 schema changes are limited to existing status values; no destructive migration is required.
- Local SQLite outbox migration is additive and safe for existing rows.
- Canonical batch-level submit keys coexist with legacy keys through the defensive active-job query.
- The machine-token response keeps the existing `error` text while adding a stable `code`.
- Prompt consumers must publish a library before using it. Existing draft-only local configuration will receive a clear conflict instead of silently using mutable content.

## Success Criteria

The current hardening phase is complete when the nine non-workbook regression areas pass, the applicable validation gates pass, the deferred `xlsx` audit findings are reported explicitly, `git diff --check` is clean, and none of the pre-existing unrelated worktree changes are overwritten or included in this hardening checkpoint.
