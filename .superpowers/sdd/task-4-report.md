## Task 4 Report

Status: DONE

Changed files:
- `cloud/approval-workbench/src/worker/batch-routes.ts`
- `cloud/approval-workbench/src/worker/asset-routes.ts`
- `cloud/approval-workbench/src/worker/machine-routes.ts`
- `cloud/approval-workbench/src/tests/review.test.ts`
- `cloud/approval-workbench/src/tests/assets.test.ts`
- `cloud/approval-workbench/src/tests/machines.test.ts`

TDD RED evidence:
- `npm test -- src/tests/review.test.ts` failed before implementation: missing `model`, `size`, `quality`, `output_format`, `count` in `generate_ai_image` payload and unsupported model accepted with 201.
- `npm test -- src/tests/assets.test.ts` failed before implementation: `generate_ai_image` lease could not download the source asset and returned 403.
- `npm test -- src/tests/machines.test.ts` failed before implementation: linked `ai_generation_requests` rows stayed `queued` after complete/fail.

Implementation notes:
- Extended `/api/ai-image-batches/:batch_uid/generate` with defaults and validation for `model`, `size`, `quality`, `output_format`, and `count`.
- Supported models: `gpt-image-2`, `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview`.
- Accepted sizes: `1:1`, `3:4`, `4:3`, `16:9`, `9:16`, `1024x1024`, `1536x1024`, `1024x1536`, `2048x2048`, `4096x4096`.
- Accepted quality values: `auto`, `low`, `medium`, `high`, `standard`, `1K`, `2K`, `4K`.
- Accepted output formats: `png`, `jpeg`, `jpg`, `webp`; `jpeg` is normalized to `jpg`.
- Count is restricted to integer `1..8`.
- Generation settings are included in dispatch payload and hashed into idempotency, while the existing `ai_generation_requests` schema remains unchanged for request tracking.
- Secret-ish fields and `data:image` strings are rejected before dispatch/request/audit rows are written.
- `generate_ai_image` leases now allow source/reference asset downloads and generated AI-result upload plans scoped by payload `result_asset_uids`.
- `ai_generation_requests.status` now moves to `completed`, `failed`, or `cancelled` when linked `generate_ai_image` jobs finish through machine lease endpoints.

Tests:
- `npm test -- src/tests/review.test.ts` passed.
- `npm test -- src/tests/assets.test.ts` passed.
- `npm test -- src/tests/machines.test.ts` passed.
- `npm test -- src/tests/review.test.ts src/tests/assets.test.ts src/tests/machines.test.ts` passed: 84 tests.
- `npm run typecheck` passed.

Commit hash: e385ae8f

Concerns:
- No migration was added because the current `ai_generation_requests` table has no settings columns; rich generation settings persist in dispatch payload/idempotency as scoped for Task 4.

# Task 4 Review Fix Report

Status: DONE

RED evidence:
- `npm test -- src/tests/review.test.ts src/tests/machines.test.ts` failed before implementation with 3 expected failures:
  - `does not fail generation requests on generate_ai_image progress updates`: `/progress` changed `ai_generation_requests.status` from `queued` to `failed`.
  - `rejects unsupported or unsafe online generation parameters`: `openai_api_key` was accepted with `201`.
  - `online generation idempotency includes template version and target machine choices`: idempotent repeat returned `request_uid: ""` instead of the original `gen_*` uid.

Implementation:
- Limited `generate_ai_image` request-status syncing so `/progress`/`running` does not update `ai_generation_requests`; completion/cancel/fail statuses still sync to `completed`, `cancelled`, or `failed`.
- Idempotent `/api/ai-image-batches/:batch_uid/generate` responses now reuse the existing request uid from the dispatch payload, with a DB fallback by `dispatch_job_uid`.
- Broadened recursive unsafe-input detection to reject prefixed/nested secret-ish keys including `openai_api_key`, `x-api-key`, `access_token`, `refresh_token`, `password`, and `client_secret`, while preserving normal generation fields.

Tests:
- `npm test -- src/tests/review.test.ts src/tests/machines.test.ts` passed: 58 tests.
- `npm run typecheck` passed.

Commit hash:
- Recorded in final response after commit creation; a tracked file cannot contain the exact hash of the commit that contains it.

Concerns:
- `retryable_failed` remains mapped to `failed` to preserve the existing machine-route contract; the corruption fix is scoped to non-terminal `/progress`/`running` updates.
