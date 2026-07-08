# Task 2 Report: Local Persistence, Service, API, And IPC

Status: DONE

## Scope completed

- Added SQLite tables and CRUD helpers for `ai_image_jobs`, `ai_image_assets`, and `ai_image_canvases`.
- Added local AI image service helpers:
  - `default_output_dir`
  - `select_model_key`
  - `build_one_xm_payload`
  - `run_job_with_one_xm`
  - `copy_assets_to_directory`
- Reused `core/one_xm_image.py` for data URL conversion, 1XM client creation, and task execution.
- Added local FastAPI endpoints for job CRUD, asset/canvas creation, job run, and save-as.
- Added Electron main/preload/dev bridge methods for the AI image workbench HTTP APIs.
- Did not modify `AiImageWorkbench.vue`.
- Did not implement cloud behavior.

## TDD red evidence

- RED data sink: `python -m unittest tests.test_ai_image_data_sink -v` failed because `core.data_sink.create_ai_image_job` and related CRUD helpers did not exist.
- RED service: `python -m unittest tests.test_ai_image_service -v` failed because `core.ai_image_service` did not exist.
- RED API: `python -m unittest tests.test_ai_image_api -v` failed because `/ai-image/jobs` was not registered and API functions/models were missing.
- RED IPC/dev bridge: `node --test tests/ai-image-ipc-bridge.test.js` failed because `list-ai-image-jobs` and the renderer bridge methods were missing.

## Security notes

- `run_job_with_one_xm` stores only a sanitized summary: task id, poll url, image URLs, local output files, attempts, status, and error.
- The service does not write the 1XM API key, complete data URLs, or raw upstream response payload into `summary_json`.
- `/ai-image/jobs/{job_uid}/run` is service-backed and can be tested with a fake service/runner; tests do not call real 1XM.

## Verification

- `python -m unittest tests.test_ai_image_data_sink tests.test_ai_image_service tests.test_ai_image_api -v`: passed, 13 tests.
- `node --test tests/ai-image-ipc-bridge.test.js`: passed, 3 tests.
- `cd app && npm test`: passed, 69 tests.

## Concerns

- `cd app && npm test` still emits the repo's existing Node `MODULE_TYPELESS_PACKAGE_JSON` warnings for ESM-style renderer utility tests. They are unrelated to this task and all tests pass.

# Task 2 Fix Report

Status: DONE

## Changed files

- `core/ai_image_service.py`
- `core/api_server.py`
- `tests/test_ai_image_service.py`
- `tests/test_ai_image_api.py`
- `.superpowers/sdd/task-2-report.md`

## TDD red evidence

- RED service: `python -m unittest tests.test_ai_image_service -v` failed with 10 tests run, 3 failures, 2 errors:
  - Gemini model key selection returned `('2k', 'gpt-2k')` instead of `ai.1xm.gemini_3_1_flash_image_preview_key`.
  - runner exception propagated and left the job path without a failed status update.
  - download exception propagated instead of storing `partial_failed`.
  - `_download_outputs` overwrote `result-01.png`.
  - `copy_assets_to_directory` selected `source-1.png` even when that alternate already existed.
- RED API: `python -m unittest tests.test_ai_image_api -v` failed with 7 tests run, 1 failure, 1 error:
  - client-controlled `summary` persisted through create.
  - `MissingModelKeyError` did not exist for API responses with a targetable config id.

## Implementation notes

- Added explicit config ids for GPT and Gemini image keys. Gemini Flash uses `ai.1xm.gemini_3_1_flash_image_preview_key`; Gemini Pro uses `ai.1xm.gemini_3_pro_image_preview_key`.
- Added `MissingModelKeyError(config_id=...)` and mapped it to an HTTP 400 detail object so the frontend can target the missing settings field.
- Extended local settings resolution to return the Gemini key fields while retaining the existing GPT `2k`/`4k` aliases.
- Wrapped post-start runner and download paths so jobs no longer remain `running`: runner exceptions store `failed`; download exceptions after some saved files store `partial_failed`.
- Sanitized stored exception summaries for API-key text, full `data:image` payloads, `webhook_secret`, and raw upstream leakage.
- Added unique filename allocation loops for generated downloads and save-as copies.
- Ignored client-provided `summary` in create and patch API payloads so summaries remain service-owned.

## Tests run

- `python -m unittest tests.test_ai_image_data_sink tests.test_ai_image_service tests.test_ai_image_api -v`: passed, 20 tests.
- `node --test tests/ai-image-ipc-bridge.test.js`: passed, 3 tests.
- `cd app && npm test`: passed, 69 tests. Existing `MODULE_TYPELESS_PACKAGE_JSON` warnings still appear for renderer utility tests.

## Commit hash

- This fix commit; exact SHA recorded by the caller after commit creation.

## Concerns

- No functional concerns. The existing Node `MODULE_TYPELESS_PACKAGE_JSON` warnings remain unrelated to this fix.
