# Task 6 Report: Material-Test Data Import, Dashboard, And Crawl Job

Status: DONE

## Summary

Implemented the cloud-side AI material-test data loop for the cloud approval workbench.

- Added D1 schema for material-test task overviews, image metrics, and crawl schedules.
- Added workbook parsing for the existing Tmall export workbook shape, including percent strings such as `7.79%` to decimal `0.0779`.
- Added worker endpoints:
  - `GET /api/material-test/summary`
  - `GET /api/material-test/images`
  - `POST /api/material-test/import`
  - `POST /api/material-test/crawl-jobs`
  - `POST /api/material-test/schedules`
- Added the `MaterialDataDashboardView.vue` dashboard with KPI cards, filters, image metric table, manual workbook import, immediate crawl trigger, and schedule creation.
- Added `crawl_tmall_material_test_data` support to the cloud job executor with an injectable runner for tests.
- Wired material-test crawl capability into default task-machine capability surfaces.
- Extended result asset upload authorization for `crawl_tmall_material_test_data` jobs.

## Files Changed

- Added `cloud/approval-workbench/migrations/0005_material_test_data.sql`
- Added `cloud/approval-workbench/src/worker/material-data-routes.ts`
- Modified `cloud/approval-workbench/src/worker/index.ts`
- Added `cloud/approval-workbench/src/app/materialDataImport.ts`
- Added `cloud/approval-workbench/src/app/views/MaterialDataDashboardView.vue`
- Modified `cloud/approval-workbench/src/app/App.vue`
- Modified `cloud/approval-workbench/src/worker/asset-routes.ts`
- Modified `core/cloud_job_executors.py`
- Modified default cloud capability surfaces in `core/api_server.py`, `core/config.py`, and `app/src/renderer/views/SettingsPage.vue`
- Added `cloud/approval-workbench/src/tests/material-data.test.ts`
- Added `tests/test_cloud_material_data_export.py`
- Updated capability expectation tests in `tests/test_cloud_api_server.py` and `tests/test_cloud_config.py`

## Verification

- `cd cloud/approval-workbench && npm run typecheck`: passed
- `cd cloud/approval-workbench && npm run test -- src/tests/material-data.test.ts`: passed
- `cd cloud/approval-workbench && npm run build`: passed
- `python -m unittest tests.test_cloud_material_data_export tests.test_cloud_job_executors`: passed
- `git diff --check`: passed

Additional scoped checks:

- `python -m unittest tests.test_cloud_api_server tests.test_cloud_config`: passed
- `node --test tests/cloud-approval-settings.test.js`: passed

## Notes

- The production crawl executor delegates to the existing local `tmall_material_test_data_export` task through `core.api_server._execute_task`, using a job-scoped export directory.
- The executor result payload avoids returning local absolute workbook paths; it reports row counts and the uploaded workbook object key/asset UID.
- No `.crawshrimp-runtime/`, tokens, cookies, or generated secrets were staged.

## Review Fix Report

Status: DONE

Fixed all Critical, Important, and Minor review findings from the Task 6 review.

- Changed manual workbook import to preserve one generated `source_uid` while posting detail rows in 800-row chunks instead of sending the full workbook detail sheet in one request.
- Changed `POST /api/material-test/import` to build bounded D1 statement groups and execute them through `DB.batch()` in 500-statement chunks when available, with a bounded fallback.
- Added machine-token import lease enforcement: machine imports now require `job_uid` and `lease_id`, validate the active lease belongs to the same machine, require `job_type = crawl_tmall_material_test_data`, require an active lease status, reject expired leases, and require the machine capability.
- Updated the crawl executor to send `job_uid` and `lease_id` on every import request and to import parsed detail rows in 1000-row chunks with one shared source UID.
- Changed immediate crawl job default idempotency so repeated UI clicks create distinct jobs; explicit `idempotency_key` still dedupes.
- Added Worker scheduled dispatch for active material-test crawl schedules, using `schedule_uid + local date + schedule_time` as the occurrence idempotency key.
- Added `schedule_time` range validation for `00:00` through `23:59`.
- Extended tests for D1 batch chunking, machine lease rejection, immediate rerun behavior, scheduled dispatch, invalid schedule times, and executor chunked import lease fields.

Verification:

- `cd cloud/approval-workbench && npm run test -- src/tests/material-data.test.ts`: passed
- `cd cloud/approval-workbench && npm run typecheck`: passed
- `cd cloud/approval-workbench && npm run build`: passed
- `python -m unittest tests.test_cloud_material_data_export tests.test_cloud_job_executors`: passed
- `git diff --check`: passed

Concerns:

- `npm run build` still emits the existing Vite chunk-size warning for the bundled app asset; build exits successfully.

## Final Whole-Branch Review Fix Report

Status: DONE

Fixed the final Critical and Important findings for the local/cloud AI image workbench.

RED evidence:

- `python -m unittest tests.test_ai_image_service tests.test_cloud_job_executors -v`: failed before fixes because main images were omitted, `standard` quality was coerced to `auto`, and the cloud executor uploaded `gen-1` instead of Worker-leased `result_asset_uids`.

GREEN evidence:

- `python -m unittest tests.test_ai_image_service tests.test_cloud_job_executors -v`: passed, 27 tests.
- `python -m unittest tests.test_tmall_ai_image_chain_script.TmallAiImageChainScriptTests.test_generate_approval_asset_for_item_accepts_product_item_id tests.test_tmall_ai_image_chain_script.TmallAiImageChainScriptTests.test_regenerate_approval_asset_uses_fresh_1xm_key_and_current_batch_run tests.test_tmall_ai_image_chain_script.TmallAiImageChainScriptTests.test_generate_approval_asset_for_item_appends_manual_ai_asset_to_current_batch -v`: passed, 3 tests.
- `git diff --check`: passed.

Files changed:

- `core/cloud_job_executors.py`
- `core/ai_image_service.py`
- `core/api_server.py`
- `adapters/tmall-ops-assistant/tools/run_tmall_ai_image_test_chain.py`
- `tests/test_ai_image_service.py`
- `tests/test_cloud_job_executors.py`
- `.superpowers/sdd/task-6-report.md`

Self-review:

- Generated cloud uploads now use Worker-provided `result_asset_uids` as the source of truth, with a single-asset fallback only when older payloads omit the allowlist.
- Cloud generation payload fields now flow into task-machine `run_params` and 1XM payload defaults; `count` is capped at the Worker maximum of 8.
- Cloud completion metadata no longer includes local generated or reference file paths.
- Local workbench payloads include the `main` image before references, read UI `response_format`, and preserve `standard` quality.
- No `.crawshrimp-runtime/`, `.wrangler/`, unrelated docs, or generated assets were staged.

## Second Re-review Fix Report

Status: DONE

Fixed the Task 6 re-review findings.

- Added a deployable Worker cron trigger in `cloud/approval-workbench/wrangler.toml` with a five-minute cadence.
- Normalized material-test `statistic_date` values to `YYYYMMDD` during workbook parsing and server import, and normalized UI query dates before filtering.
- Reused the immediate crawl machine validation for schedule creation so selected machines must be active and must include `crawl_tmall_material_test_data`.
- Restricted schedule creation `status` to `active` or `paused`, and validated `timezone` through `Intl.DateTimeFormat` before schedules can be stored.
- Added regression coverage for `date=2026-06-30` matching rows stored as `20260630`, schedule machine validation, and invalid status/timezone rejection.

Verification:

- `cd cloud/approval-workbench && npm run test -- src/tests/material-data.test.ts`: passed
- `cd cloud/approval-workbench && npm run typecheck`: passed
- `cd cloud/approval-workbench && npm run build`: passed
- `python -m unittest tests.test_cloud_material_data_export tests.test_cloud_job_executors`: passed
- `git diff --check`: passed

Concerns:

- `npm run build` still emits the existing Vite chunk-size warning for the bundled app asset; build exits successfully.
