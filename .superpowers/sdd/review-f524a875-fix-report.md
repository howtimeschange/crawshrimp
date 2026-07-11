# Review f524a875 Fix Report

## Scope

Implemented all Critical and Important findings from `.superpowers/sdd/review-f524a875-fix-brief.md`, plus the low-risk Minor `update-not-available` status alignment. No publish, push, retag, notarization, packaged install, or release mutation was run.

## Changes

- `core/api_server.py`: install readiness now fails closed when task-instance or AI-image-job collection raises; drain acquisition returns `409 install_readiness_unavailable` and never issues a token under uncertainty.
- `app/scripts/validate-update-artifacts.js`: formal release validation now checks every updater metadata file for exactly one top-level `version: X.Y.Z`, rejecting missing, duplicate, nested, or mismatched values.
- `app/src/main.js`: `update:check` and `update:download` now await updater actions and return `updateService.getStatus()`.
- `app/src/updateInstallCoordinator.js`: install only proceeds when `shutdownForUpdate()` returns exactly `true`; false/non-true releases the drain token and defers without install side effects.
- `.github/workflows/build-desktop.yml`: rolling `desktop-latest` publication now depends on the validated versioned release job.
- `app/src/renderer/views/LocalPromptLibrary.vue`: local prompt libraries release `loading` and local actions before the silent cloud refresh; cloud refresh is guarded against unmounted stale updates.
- `app/src/renderer/components/SidebarUpdateFooter.vue`: collapsed footer now exposes custom hover/focus tooltip with `data-tooltip`, retains `aria-label`, and avoids clipping.
- `app/src/updateService.js`: `update-not-available` now publishes `up-to-date`, while existing version-only rendering remains covered.
- Tests updated/added across Python API lifecycle, updater coordinator/service, workflow contracts, artifact validation, prompt-library contracts, responsive shell, and footer tooltip coverage.

## RED Evidence

Initial focused RED run after test additions:

- `node --test app/scripts/validate-update-artifacts.test.js app/src/updateInstallCoordinator.test.js app/src/updateService.test.js tests/desktop-auto-update.test.js tests/workflow-triggers.test.js tests/local-prompt-library-contract.test.js tests/ai-image-workbench-responsive.test.js`
  - Failed as expected on metadata version checks, cleanup false handling, `up-to-date`, stable IPC return shape, footer tooltip, workflow ordering, and local-first cloud decoupling.
- `venv/bin/python -m pytest tests/test_api_task_lifecycle.py -k "install_readiness_fails_closed or update_drain_fails_closed" -q`
  - Failed as expected: readiness stayed ready and drain returned `200` when blocker sources raised.

## GREEN Evidence

Focused rerun after implementation:

- `node --test app/scripts/validate-update-artifacts.test.js app/src/updateInstallCoordinator.test.js app/src/updateService.test.js tests/desktop-auto-update.test.js tests/workflow-triggers.test.js tests/local-prompt-library-contract.test.js tests/ai-image-workbench-responsive.test.js`
  - `80 passed`
- `venv/bin/python -m pytest tests/test_api_task_lifecycle.py -k "install_readiness_fails_closed or update_drain_fails_closed" -q`
  - `2 passed, 34 deselected`

Broader validation:

- `npm test` from `app/`
  - `177 passed`
- `node --test tests/*.test.js`
  - `812 passed`
- `venv/bin/python -m pytest tests/test_api_task_lifecycle.py -q`
  - `36 passed`
- `npm run vite:build` from `app/`
  - Passed. Existing Vite/Radix module-directive and chunk-size warnings were emitted.
- `git diff --check`
  - Passed.

Post self-review prompt unmount guard rerun:

- `node --test tests/local-prompt-library-contract.test.js`
  - `11 passed`
- `node --test tests/*.test.js`
  - `812 passed`
- `npm test` from `app/`
  - `177 passed`
- `npm run vite:build` from `app/`
  - Passed with the same existing warnings.
- `git diff --check`
  - Passed.

## Changed Files

- `.github/workflows/build-desktop.yml`
- `app/scripts/validate-update-artifacts.js`
- `app/scripts/validate-update-artifacts.test.js`
- `app/src/main.js`
- `app/src/renderer/components/SidebarUpdateFooter.vue`
- `app/src/renderer/views/LocalPromptLibrary.vue`
- `app/src/updateInstallCoordinator.js`
- `app/src/updateInstallCoordinator.test.js`
- `app/src/updateService.js`
- `app/src/updateService.test.js`
- `core/api_server.py`
- `tests/ai-image-workbench-responsive.test.js`
- `tests/desktop-auto-update.test.js`
- `tests/local-prompt-library-contract.test.js`
- `tests/test_api_task_lifecycle.py`
- `tests/workflow-triggers.test.js`
- `.superpowers/sdd/review-f524a875-fix-report.md`

## Self-Review

- Confirmed install readiness uncertainty is now unsafe for both readiness and drain token issuance.
- Confirmed installer side effects remain ordered: readiness, drain, cleanup, installing state, `quitAndInstall`.
- Confirmed cleanup false/non-true path releases the token and does not call install side effects.
- Confirmed rolling release cannot mutate `desktop-latest` until versioned release job has uploaded/read back/marked latest.
- Confirmed prompt-library local data is usable before cloud refresh completes, and late cloud refresh does not write after unmount.
- Confirmed no generated `dist` files were staged.

## Residual Risks

- The broad validation emits pre-existing Node module-type and Vite/Radix/chunk-size warnings; no new failing checks.

## Commit

Commit SHA: final post-amend SHA is reported in the handoff from `git rev-parse --short=8 HEAD`. Embedding the post-amend SHA in this committed file would itself change the commit SHA.
