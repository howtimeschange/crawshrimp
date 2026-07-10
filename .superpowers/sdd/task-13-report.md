## Task 13 Report - 2026-07-08

Implemented:
- Added `scripts/cloud_approval_dry_run.py` with deterministic fake cloud HTTP transport by default and explicit `--live-cloud-url` opt-in for real cloud calls.
- Added `tests/test_cloud_approval_dry_run.py` covering seed-admin instructions, enrollment token creation, fake machine enrollment, local batch sync, rejected-image regeneration job creation, approved-image submit job creation, and non-zero assertion failures.
- Added `docs/cloud-approval-workbench-runbook.md` grounded in the implemented desktop routes, worker routes, D1 schema, machine capabilities, and Tmall safety constraints.
- Added the concise README runbook link paragraph requested by the brief.

Validation:
- `python scripts/cloud_approval_dry_run.py` passed and printed all six phases.
- `python -m unittest tests.test_cloud_config tests.test_cloud_machine_data_sink tests.test_cloud_approval_client tests.test_cloud_batch_sync tests.test_cloud_machine_agent tests.test_cloud_job_executors tests.test_cloud_api_server tests.test_cloud_approval_dry_run -v` passed, 44 tests.
- `node --test tests/cloud-approval-ipc.test.js tests/cloud-approval-settings.test.js` passed, 5 tests.
- `cd cloud/approval-workbench && npm run check` passed: typecheck, 93 Vitest tests, build.
- `cd /Users/xingyicheng/Documents/crawshrimp/app && npm test` passed, 68 tests; existing module-type warnings only.
- `git diff --check` passed.

Concerns:
- No checked-in first-admin seed command exists. The runbook documents the implemented D1 schema and operator-controlled seed path instead of inventing a command.

## Task 13 Fix - 2026-07-08

Changed files:
- `core/config.py`
- `core/api_server.py`
- `app/src/renderer/views/SettingsPage.vue`
- `tests/test_cloud_config.py`
- `tests/test_cloud_api_server.py`
- `tests/cloud-approval-settings.test.js`
- `docs/cloud-approval-workbench-runbook.md`
- `.superpowers/sdd/task-13-report.md`

Fix summary:
- Changed default V1 cloud approval capabilities to `regenerate_ai_image` and `submit_tmall_material_test`.
- Added task capability controls to Settings -> Cloud Approval.
- Made Settings save and machine enrollment send the same normalized capability list.
- Kept cloud status and enrollment responses free of long-lived machine tokens while returning safe capabilities.
- Aligned the runbook wording with the visible `任务能力` Settings control.

Validation:
- `python -m unittest tests.test_cloud_api_server tests.test_cloud_approval_dry_run -v` passed, 13 tests.
- `node --test tests/cloud-approval-ipc.test.js tests/cloud-approval-settings.test.js` passed, 5 tests.
- `python scripts/cloud_approval_dry_run.py` passed and printed `DRY RUN PASS`.
- `python -m unittest tests.test_cloud_config -v` passed, 2 tests.
- `cd app && npm test` passed, 68 tests; existing module-type warnings only.
- `git diff --check` passed.

Concerns:
- Existing machines already enrolled with a non-empty saved capability list keep reporting that saved list until re-enrolled or reconfigured.
