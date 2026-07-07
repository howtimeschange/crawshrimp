# Cloud Approval Workbench Final Review Fix Report

## Status

Implemented the final-review fixes for machine-scoped asset access, review-board workflows, submit-machine freshness, local SQLite permission hardening, explicit ready-state copy, and explicit external URL opening.

## Commits

- This commit: `fix(cloud): scope machine asset access`

## Changed Files

- `cloud/approval-workbench/src/worker/asset-routes.ts`
- `cloud/approval-workbench/src/worker/batch-routes.ts`
- `cloud/approval-workbench/src/app/views/BatchReviewView.vue`
- `cloud/approval-workbench/src/app/App.vue`
- `cloud/approval-workbench/src/tests/assets.test.ts`
- `cloud/approval-workbench/src/tests/review.test.ts`
- `core/cloud_approval_client.py`
- `core/cloud_job_executors.py`
- `core/data_sink.py`
- `tests/test_cloud_job_executors.py`
- `tests/test_cloud_machine_data_sink.py`
- `app/src/main.js`
- `app/src/preload.js`
- `app/src/renderer/utils/devCsBridge.js`
- `app/src/renderer/views/CloudApprovalFrame.vue`
- `docs/cloud-approval-workbench-runbook.md`
- `.superpowers/sdd/final-review-fix-report.md`

## Findings Addressed

1. Machine asset access is now job-scoped. Machine presign, upload, and download require `job_uid` and `lease_id`; the worker validates an active lease owned by that machine and checks the asset/batch/style membership against the leased job payload. User asset access remains RBAC-based.
2. The cloud review board now renders image previews and download links, supports per-image regeneration prompt overrides, supports manual source/reference/AI image upload through a planned upload URL, and passes prompt overrides into regeneration job payloads.
3. Submit jobs now require the selected machine to be active, capable, in an online health state, and recently seen within the freshness window. Stale/offline selections return a clear conflict error, and the UI only lists fresh online submit-capable machines.
4. Local machine tokens remain in SQLite for this pass, but the data sink now applies POSIX owner-only permissions to the data directory and database file. The runbook documents the remaining keychain-migration risk.
5. The ready action UI now says it recalculates the submit-ready state instead of implying a separate manual status override.
6. `CloudApprovalFrame.vue` now uses an explicit `openExternalUrl` IPC path for HTTP(S) cloud URLs.

## Tests Run

- `cd cloud/approval-workbench && npm test -- src/tests/assets.test.ts src/tests/review.test.ts` - passed, 28 tests.
- `python -m unittest tests.test_cloud_machine_data_sink tests.test_cloud_job_executors -v` - passed, 12 tests.
- `cd cloud/approval-workbench && npm run typecheck` - passed.
- `cd cloud/approval-workbench && npm run check` - passed: typecheck, 108 Vitest tests, Vite build.
- `python -m unittest tests.test_cloud_config tests.test_cloud_machine_data_sink tests.test_cloud_approval_client tests.test_cloud_batch_sync tests.test_cloud_machine_agent tests.test_cloud_job_executors tests.test_cloud_api_server tests.test_cloud_approval_dry_run -v` - passed, 48 tests.
- `node --test tests/cloud-approval-ipc.test.js tests/cloud-approval-settings.test.js` - passed, 5 tests.

## Residual Risks

- Machine tokens are still stored as plaintext values inside the local SQLite row. File permissions reduce local exposure on POSIX systems, but a future OS secure-storage/keychain migration is still needed.
- Review-board upload support is scoped to source/reference/AI images and existing planned-object upload flow; it does not add client-side image transformations or resumable uploads.

## Focused Re-Review Follow-Up

Status: implemented the manual upload status fix.

Commit: this commit, `fix(cloud): keep manual uploads planned`.

Changed files:

- `cloud/approval-workbench/src/worker/batch-routes.ts`
- `cloud/approval-workbench/src/app/views/BatchReviewView.vue`
- `cloud/approval-workbench/src/tests/assets.test.ts`
- `cloud/approval-workbench/src/tests/review.test.ts`
- `.superpowers/sdd/final-review-fix-report.md`

Addressed issue:

- Manual source/reference/AI asset creation now always creates a `planned` asset row. The review UI no longer asks the API to mark source/reference assets uploaded before PUT. Regeneration and submit payload builders only include uploaded source/reference assets, so interrupted manual uploads are not usable. The existing upload route remains the transition point that marks a planned asset `uploaded` after a successful PUT.

Tests run:

- `cd cloud/approval-workbench && npm test -- src/tests/assets.test.ts src/tests/review.test.ts` - passed, 30 tests.
- `cd cloud/approval-workbench && npm run check` - passed: typecheck, 110 Vitest tests, Vite build.

Residual risks:

- Failed uploads still leave planned rows visible in the batch detail until retried or superseded; they are intentionally not usable in regeneration or submit payloads.
