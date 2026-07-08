# Final Review Fix Report

## Changed files

- `cloud/approval-workbench/src/worker/batch-routes.ts`
- `cloud/approval-workbench/src/worker/asset-routes.ts`
- `cloud/approval-workbench/src/worker/machine-routes.ts`
- `cloud/approval-workbench/src/worker/index.ts`
- `cloud/approval-workbench/migrations/0006_dispatch_job_cancel_requested.sql`
- `core/cloud_job_executors.py`
- `core/cloud_machine_agent.py`
- `app/src/renderer/views/CloudApprovalFrame.vue`
- `docs/cloud-approval-workbench-runbook.md`
- `cloud/approval-workbench/src/tests/assets.test.ts`
- `cloud/approval-workbench/src/tests/machines.test.ts`
- `cloud/approval-workbench/src/tests/review.test.ts`
- `tests/test_cloud_job_executors.py`
- `tests/test_cloud_machine_agent.py`

## Fix summary

1. Regeneration now creates a new generated child asset uid (`regen-*`) instead of reusing the rejected asset uid. The rejected asset is preserved through `rejected_asset_uid`, and `parent_asset_uid` points to that rejected asset.
2. Added user-session job cancellation at `POST /api/jobs/:job_uid/cancel`, persisted `cancel_requested`, audited the request, and made active leases surface cancellation through renew/progress so the desktop agent reports `cancelled`.
3. Added cross-site protection for cookie-authenticated asset downloads: `Sec-Fetch-Site: cross-site` is rejected for session downloads, while machine bearer-token downloads remain lease-scoped. Download responses now include same-origin/CSP/no-store protections.
4. Removed the always-visible local `CloudApprovalFrame` header chrome. It now fills the right workspace and only shows compact error/missing-url or machine-attention status states.
5. Updated the runbook enrollment-token example to include `generate_ai_image`, `regenerate_ai_image`, `submit_tmall_material_test`, and `crawl_tmall_material_test_data`.

## Tests run

- PASS: `cd cloud/approval-workbench && npm run test -- src/tests/assets.test.ts src/tests/machines.test.ts src/tests/batches.test.ts src/tests/auth-routes.test.ts src/tests/material-data.test.ts`
- PASS: `cd cloud/approval-workbench && npm run test -- src/tests/schema.test.ts src/tests/machines.test.ts src/tests/assets.test.ts src/tests/review.test.ts`
- PASS: `cd cloud/approval-workbench && npm run test`
- PASS: `cd cloud/approval-workbench && npm run typecheck`
- PASS: `cd cloud/approval-workbench && npm run build` (Vite large chunk warning only)
- PASS: `python -m unittest tests.test_cloud_job_executors tests.test_cloud_machine_agent`
- PASS: `cd app && npm test -- --runInBand` (existing module-type warnings only)
- PASS: `git diff --check`

## Commit

Code-fix commit: `8f740bd1`

## Residual risk

- Cloudflare deployment was not run in this final-review fix pass.

## Follow-up fix: cancelled lease recovery

- Fixed cancelled leased/running dispatch jobs so expired leases with `cancel_requested = 1` transition to terminal `cancelled`, clear lease ownership fields, and record a `cancelled` dispatch job event.
- Tightened machine claim selection and the final lease update to explicitly require `cancel_requested != 1`, preventing malformed queued cancel-requested jobs from being claimed.
- Added focused regression coverage for expired cancel-requested lease recovery and queued cancel-requested claim exclusion.

## Follow-up tests

- PASS: `cd cloud/approval-workbench && npm test -- src/tests/machines.test.ts`
- PASS: `cd cloud/approval-workbench && npm run typecheck`
- PASS: `git diff --check`

## Follow-up commit

- Code-fix commit: `4f88ffcaa03c924171cfab5c7cd05c4d7ae95f7a`
