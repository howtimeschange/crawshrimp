# Task 9 Report: Desktop Cloud Client And Batch Sync Payload Builder

Status: DONE

## Summary

- Added `core/cloud_approval_client.py` with stdlib `urllib.request` JSON requests, bearer machine-token support, retry handling for 429/5xx, fake transport injection for tests, direct asset upload, and sanitized exception text.
- Added `core/cloud_batch_sync.py` to map local Tmall approval batches into cloud batch/style/asset payloads, derive deterministic asset IDs when local IDs are missing, keep raw absolute paths out of cloud-facing payload fields, presign local files, upload assets, and mark sync complete.
- Wired `run_tmall_ai_image_test_chain.py` immediately after `write_approval_batch` so cloud sync runs only when `cloud_approval.machine_enabled`, `cloud_approval.base_url`, and stored machine credentials are present.
- Cloud sync failures now keep local generation successful, persist a warning on the local batch, record a cloud job warning event through `core.data_sink`, and append a warning evidence row.

## RED

Initial tests were written first and failed before implementation:

```text
python -m unittest tests.test_cloud_approval_client tests.test_cloud_batch_sync -v
FAILED: ModuleNotFoundError: No module named 'core.cloud_approval_client'
FAILED: ModuleNotFoundError: No module named 'core.cloud_batch_sync'
```

During self-review, I added a regression test for upload exception sanitization. It failed before the patch because a `urllib.error.HTTPError` from the upload transport bubbled directly:

```text
test_upload_asset_exception_does_not_return_signed_upload_url ... ERROR
urllib.error.HTTPError: HTTP Error 403: Forbidden
```

## Validation

```text
python -m unittest tests.test_cloud_approval_client tests.test_cloud_batch_sync tests.test_tmall_ai_image_chain_script -v
Ran 41 tests in 0.632s
OK
```

```text
git diff --check -- core/cloud_approval_client.py core/cloud_batch_sync.py adapters/tmall-ops-assistant/tools/run_tmall_ai_image_test_chain.py tests/test_cloud_approval_client.py tests/test_cloud_batch_sync.py
OK
```

## Scope Notes

- Did not send Tmall cookies, login state, 1XM keys, or shop privileges to cloud.
- Did not add any real Cloudflare or cloud API token to code, tests, logs, or report.
- Did not stage unrelated untracked runtime files such as `.crawshrimp-dev*`, `.wrangler`, docs temp files, or tmp Tmall CSVs.
- The cloud payload intentionally excludes local `board_url` and local absolute paths; asset metadata uses basename-only `source_path_label` for traceability.

## Fix Report: Worker API Contract Alignment

### What Changed

- Updated `build_cloud_batch_payload(batch)` to target the worker sync contract:
  - posts to `POST /api/ai-image-batches/sync`;
  - includes top-level `batch_uid`, `title`, local instance/run IDs, and prompt version set data when available;
  - nests cloud assets under each `style.assets` entry instead of sending top-level `assets` or `style.asset_uids`;
  - includes style status/missing-prompt fields, prompt text/version fields, content hashes, generation fields, and sanitized metadata.
- Updated local upload sync to match the worker:
  - posts one presign request per asset to `POST /api/assets/presign`;
  - sends the required single-asset body with `batch_uid`, numeric `style_id`, `asset_uid`, `kind`, `filename`, `content_hash`, prompt fields, generation fields, and safe metadata;
  - refuses to call presign when no numeric `style_id` is available, rather than inventing an invalid payload;
  - posts completion to `POST /api/ai-image-batches/{batch_uid}/sync-complete`.
- Updated `CloudApprovalClient.upload_asset()` to resolve worker-relative upload URLs such as `/api/assets/upload/...` against the configured cloud base URL.
- Hardened basename handling so `_source_path_label()` strips both POSIX slash paths and Windows backslash paths.
- Updated tests to assert the actual worker routes, nested payload shape, per-asset presign payload, relative upload URL handling, and no-presign-without-style-id behavior.

### Tests Run

```text
python -m unittest tests.test_cloud_approval_client tests.test_cloud_batch_sync tests.test_tmall_ai_image_chain_script -v
Ran 43 tests in 0.616s
OK
```

```text
git diff --check -- core/cloud_approval_client.py core/cloud_batch_sync.py adapters/tmall-ops-assistant/tools/run_tmall_ai_image_test_chain.py tests/test_cloud_approval_client.py tests/test_cloud_batch_sync.py
OK
```

### Command Output Summary

- `tests.test_cloud_approval_client`: all 7 tests passed, including token redaction and relative upload URL handling.
- `tests.test_cloud_batch_sync`: all 4 tests passed, covering worker-compatible sync payloads, safe path labels, actual worker routes, single-asset presign bodies, and missing-style-id protection.
- `tests.test_tmall_ai_image_chain_script`: all existing chain tests passed with no regressions.
- `git diff --check`: no whitespace errors.

### Self-Review

- Verified the implementation uses the worker route names from `cloud/approval-workbench/src/worker/index.ts`.
- Verified sync assets are nested under `style.assets`, which is what `batch-routes.ts` reads.
- Verified presign sends a single asset body accepted by `asset-routes.ts` and does not send `{ assets: [...] }`.
- Verified cloud-facing path labels are basename-only and Windows-style paths are stripped to filenames.
- Remaining integration dependency: real uploads require a numeric cloud `style_id` from the sync response or local metadata; the desktop code now fails before presign if that value is unavailable, so it will not send an invalid worker request.

## Fix Report: Worker Style-ID And Asset Upload Contract

### What Changed

- Updated `cloud/approval-workbench/src/worker/batch-routes.ts` so `POST /api/ai-image-batches/sync` returns a safe top-level `styles` array for desktop matching:
  - includes numeric `id` and `style_id` from the Worker database;
  - includes `style_code`, `item_id`, and safe `style_uid` when supplied;
  - excludes assets and local path-bearing fields.
- Added `PUT /api/assets/upload/{object_key}` in the Worker:
  - routed from `cloud/approval-workbench/src/worker/index.ts`;
  - authenticates with an active machine bearer token or a user session with `machines:write`;
  - decodes and validates object keys under `batches/`;
  - rejects traversal, non-batch keys, unauthenticated requests, and stale keys without an asset row;
  - writes the raw request body to R2 and marks the matching `ai_image_assets.object_key` row `uploaded`.
- Updated Worker tests in `cloud/approval-workbench/src/tests/batches.test.ts` and `cloud/approval-workbench/src/tests/assets.test.ts` for the returned style IDs and real upload route behavior.
- Updated `tests/test_cloud_batch_sync.py` so local batches no longer require local numeric `style_id`; the fake Worker sync response now returns cloud style IDs by synced style data.

### Tests Run

```text
python -m unittest tests.test_cloud_batch_sync tests.test_cloud_approval_client tests.test_tmall_ai_image_chain_script -v
Ran 43 tests in 0.642s
OK
```

```text
cd cloud/approval-workbench && npm test -- src/tests/batches.test.ts src/tests/assets.test.ts
Test Files  2 passed (2)
Tests  32 passed (32)
```

```text
cd cloud/approval-workbench && npm run typecheck
tsc --noEmit
OK
```

```text
git diff --check -- core/cloud_batch_sync.py tests/test_cloud_batch_sync.py cloud/approval-workbench/src/worker/batch-routes.ts cloud/approval-workbench/src/worker/asset-routes.ts cloud/approval-workbench/src/worker/index.ts cloud/approval-workbench/src/tests/batches.test.ts cloud/approval-workbench/src/tests/assets.test.ts
OK
```

### Concerns

- No remaining known blocker from this follow-up. The upload route requires an existing planned asset row for the object key, which matches the presign-first desktop flow.

## Fix Report: Desktop Upload Machine Bearer Auth

### Changed Files

- `core/cloud_approval_client.py`
  - `CloudApprovalClient.upload_asset()` now defaults to machine-token auth and sends `Authorization: Bearer <machine_token>` when configured.
  - Kept existing call sites working by adding `token_type` as an optional keyword-only argument.
- `tests/test_cloud_approval_client.py`
  - Updated the upload test to assert the machine bearer token is included.
  - Extended the upload-error sanitization test so the full machine token is not exposed in the raised error.

### Tests Run

```text
python -m unittest tests.test_cloud_approval_client tests.test_cloud_batch_sync tests.test_tmall_ai_image_chain_script -v
Ran 43 tests in 0.641s
OK
```

```text
cd cloud/approval-workbench && npm test -- src/tests/assets.test.ts src/tests/batches.test.ts
Test Files  2 passed (2)
Tests  32 passed (32)
```

```text
git diff --check -- core/cloud_approval_client.py tests/test_cloud_approval_client.py tests/test_cloud_batch_sync.py
OK
```

### Self-Review

- Verified the fix does not change broad Worker auth semantics; the Worker route still requires a machine bearer token or privileged user session.
- Verified desktop uploads now match the machine-token auth used by the Worker upload tests.
- Verified upload error messages still omit signed upload URLs, upload signatures, and the full machine token.
- Verified `tests/test_cloud_batch_sync.py` does not need changes because it checks the upload call boundary, not raw HTTP headers.

## Fix Report: Token-Safe Exception Chaining

### Changed Files

- `core/cloud_approval_client.py`
  - Suppressed original exception chaining for token-bearing request and upload transport failures by raising sanitized `CloudApprovalError`s with `from None`.
  - Kept request failure messages useful by preserving the exception type and redacted exception text.
  - Kept upload failure messages stable with sanitized HTTP status or exception type text.
- `tests/test_cloud_approval_client.py`
  - Added regression coverage for `request_json()` generic transport failures where the lower-level exception message contains the full machine token.
  - Added regression coverage for `upload_asset()` generic transport failures where the lower-level exception message contains the full machine token.
  - Each regression checks `str(error)`, the chained cause representation when present, and formatted traceback output.

### Tests Run

```text
python -m unittest tests.test_cloud_approval_client -v
Ran 9 tests in 0.002s
OK
```

```text
python -m unittest tests.test_cloud_approval_client tests.test_cloud_batch_sync tests.test_tmall_ai_image_chain_script -v
Ran 45 tests in 0.629s
OK
```

```text
git diff --check -- core/cloud_approval_client.py tests/test_cloud_approval_client.py
OK
```

### Self-Review

- Verified the new regression tests fail before the client fix because `CloudApprovalError.__cause__` retains the lower-level token-bearing exception.
- Verified the final formatted traceback no longer contains the full machine token for request or upload transport failures.
- Verified upload requests still send machine bearer auth through the existing upload header test.
- Verified retry behavior is unchanged through the existing 429/5xx retry test and the broader Tmall chain regression suite.
