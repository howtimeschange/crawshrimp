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

---

## Desktop auto-update final review fix wave

### RED evidence

- Critical drain/readiness: `node --test app/src/updateInstallCoordinator.test.js` failed at `requestInstall accepts real successful API drain response and quits only after cleanup`; actual events stopped at `release-drain:drain-1` instead of reaching `shutdown`, `set-installing`, and `quit-and-install`.
- Critical API contract: `python -m pytest tests/test_runtime_install_guard.py tests/test_api_task_lifecycle.py::ApiTaskLifecycleTests::test_runtime_install_readiness_and_drain_gate_mutations -q` failed with `KeyError: 'install_ready'` on the successful `POST /runtime/update-drain` response.
- Important downloaded manual-check status: `node --test tests/desktop-auto-update.test.js` failed because `update:check` returned `updateCoordinator.refreshReadiness()` directly instead of awaiting readiness and returning `updateService.getStatus()`.
- Important formal manifest: `node --test scripts/validate-update-artifacts.test.js` failed because formal validation did not reject a missing required release asset.
- Minor guard snapshots: the same Python focused run failed because mutating a returned blocker changed the guard's internal blocker label.

### Implementation

- `core/api_server.py`: renamed `_collect_install_blockers()` to `_collect_external_install_blockers()` and made successful `POST /runtime/update-drain` return a drain-specific readiness payload with `ready: true`, `install_ready: true`, `draining: true`, and no blockers after the drain is acquired.
- `app/src/main.js`: changed downloaded `update:check` to refresh readiness for side effects, then return the stable updater status object.
- `app/scripts/validate-update-artifacts.js`: added `--formal-release --version X.Y.Z` validation requiring the exact formal asset set: two macOS DMGs, two macOS ZIPs, two ZIP blockmaps, `latest-mac.yml`, Windows EXE, Windows EXE blockmap, and `latest.yml`; rejects missing or extra release assets.
- `.github/workflows/build-desktop.yml`: runs formal manifest validation with `${APP_VERSION}` before rolling `desktop-latest` mutation and before versioned release metadata/publish steps.
- `core/runtime_install_guard.py`: returns deep-copied blocker snapshots so callers cannot mutate guard state.

### Minor finding disposition

- Guard shallow snapshots: fixed with focused coverage.
- Helper naming: fixed by renaming to `_collect_external_install_blockers()` and updating direct references.
- `SidebarUpdateFooter.vue` mount-level coverage: not added. The current app test stack has no Vue mount harness such as `@vue/test-utils` or DOM test runner, and adding one would be disproportionate for this fix wave. Existing coverage remains utility-level update display tests plus repo static wiring tests; no new heavyweight harness was introduced.

### GREEN evidence

- PASS: `node --test app/src/updateInstallCoordinator.test.js` (`18` tests)
- PASS: `node --test tests/desktop-auto-update.test.js` (`12` tests)
- PASS: `cd app && node --test scripts/validate-update-artifacts.test.js` (`14` tests; existing module-type warning only)
- PASS: `python -m pytest tests/test_runtime_install_guard.py tests/test_api_task_lifecycle.py::ApiTaskLifecycleTests::test_runtime_install_readiness_and_drain_gate_mutations -q` (`11` tests, `2` subtests)
- PASS: `cd app && npm test` (`171` tests; existing module-type warnings only)
- PASS: `python -m py_compile core/runtime_install_guard.py core/api_server.py`
- PASS: `node --check app/scripts/validate-update-artifacts.js && node --check app/src/updateInstallCoordinator.js && node --check app/src/main.js`

### Self-review

- Scope is limited to the final review findings and tests around them.
- No publish, push, retag, packaged update install, or real packaged acceptance was run or claimed.
- `desktop-latest` remains manual-only: the workflow still uploads only DMG/EXE with `--latest=false`; update metadata is validated as a precondition but not uploaded to the rolling release.

### Commit

- Code-fix commit: `6497ea17`
