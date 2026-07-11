# Desktop Update Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every verified Critical, Important, and Minor issue from the comprehensive review of the desktop auto-update branch.

**Architecture:** Keep the existing explicit-download, task-drain, user-confirmed-install design. Harden its boundaries: release publication becomes non-destructive and metadata-exact; lifecycle cleanup becomes transactional with recovery; renderer actions become single-flight and accessible. Each task starts with a failing regression test and ends with a focused commit and independent review.

**Tech Stack:** Electron 29, electron-updater 6, Node.js test runner, Vue 3, GitHub Actions, FastAPI/Python runtime guard.

## Global Constraints

- Stable automatic updates come only from exact formal `vX.Y.Z` GitHub Releases.
- `desktop-latest` remains manual QA only and never contains updater metadata.
- No release rerun may take an already-published stable Release offline before replacement assets are validated.
- macOS formal metadata must reference both versioned ARM64 and x64 ZIP payloads; Windows formal metadata must reference exactly the versioned x64 NSIS EXE.
- Installation remains user initiated and never force-stops active tasks.
- Installation may proceed only after backend and managed Chrome cleanup are confirmed successful.
- If installation fails after cleanup, runtime services and lifecycle state must recover before the UI offers another attempt.
- Renderer update actions are single-flight, display user-readable errors, and remain keyboard accessible in collapsed mode.
- No push, tag mutation, GitHub Release mutation, signing, notarization, or packaged-release readiness claim is authorized by this plan.

---

### Task 12: Make updater artifact validation and Release publication fail-safe

**Files:**
- Modify: `app/scripts/validate-update-artifacts.js`
- Modify: `app/scripts/validate-update-artifacts.test.js`
- Modify: `.github/workflows/build-desktop.yml`
- Modify: `tests/desktop-auto-update.test.js`
- Modify: `tests/workflow-triggers.test.js`

**Interfaces:**
- Consumes: `validateUpdateArtifacts(root, { formalRelease, version })` and GitHub CLI release publication steps.
- Produces: formal validation that rejects missing or unexpected updater references; idempotent version-release reruns; non-delete-first `desktop-latest` updates.

- [ ] **Step 1: Write failing formal metadata-reference tests**

Add tests that build a complete formal manifest but make `latest-mac.yml` reference only ARM64 ZIP, make it reference a DMG instead of ZIP, or make `latest.yml` reference an unexpected asset. Each must assert `ok === false` and an error naming the missing/unexpected updater reference.

- [ ] **Step 2: Run the validator tests and verify RED**

Run: `cd app && node --test scripts/validate-update-artifacts.test.js`

Expected: the new cases fail because current formal validation checks file presence and version but not the exact metadata reference set.

- [ ] **Step 3: Implement exact formal metadata-reference validation**

Reuse the parsed metadata assets. In formal mode require these exact reference sets after normalization:

```text
macos/latest-mac.yml:
  crawshrimp-v${version}-mac-arm64.zip
  crawshrimp-v${version}-mac-x64.zip

windows/latest.yml:
  crawshrimp-v${version}-win-x64.exe
```

Reject missing and unexpected references. Keep SHA512 verification and top-level version validation unchanged.

- [ ] **Step 4: Write failing workflow contract tests**

Add source-contract assertions requiring:

```text
- an already-published version Release with the exact asset set is treated as an idempotent success without changing it to draft
- an already-published version Release with a mismatched asset set fails before mutation
- desktop-latest is updated in place or created when missing; the workflow does not delete the existing release/tag first
- manual installer assets are validated before any rolling tag/release mutation
```

- [ ] **Step 5: Run workflow tests and verify RED**

Run: `node --test tests/desktop-auto-update.test.js tests/workflow-triggers.test.js`

Expected: failures point to `gh release edit ... --draft` on an existing published Release and delete-first `desktop-latest` logic.

- [ ] **Step 6: Implement fail-safe GitHub Release handling**

For versioned releases:

```text
missing release -> create draft, upload, verify exact asset set, publish/latest
existing draft -> upload/clobber, verify exact asset set, publish/latest
existing published + exact asset set -> leave published assets intact and succeed idempotently
existing published + mismatched asset set -> fail before mutation
```

For `desktop-latest`, validate the manual DMG/EXE set first and update/create without deleting the current release first. Verify the final manual asset set and keep `latest=false`.

- [ ] **Step 7: Run focused tests and syntax checks**

Run:

```bash
cd app && node --test scripts/validate-update-artifacts.test.js
node --test tests/desktop-auto-update.test.js tests/workflow-triggers.test.js tests/desktop-macos-signing-notarization.test.js
git diff --check
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/build-desktop.yml app/scripts/validate-update-artifacts.js app/scripts/validate-update-artifacts.test.js tests/desktop-auto-update.test.js tests/workflow-triggers.test.js
git commit -m "fix(release): make desktop update publication fail safe"
```

---

### Task 13: Make update cleanup transactional and recoverable

**Files:**
- Modify: `app/src/lifecycleController.js`
- Modify: `app/src/lifecycleController.test.js`
- Modify: `app/src/updateInstallCoordinator.js`
- Modify: `app/src/updateInstallCoordinator.test.js`
- Modify: `app/src/updateService.js`
- Modify: `app/src/updateService.test.js`
- Modify: `app/src/main.js`
- Modify: `tests/desktop-auto-update.test.js`

**Interfaces:**
- Consumes: `stopManagedChrome()` result, coordinator drain token, `ensureDesktopServicesStarted()`.
- Produces: `recoverFromUpdateInstallFailure()` lifecycle reset and a coordinator recovery callback invoked only after cleanup completed but install did not start successfully.

- [ ] **Step 1: Write failing lifecycle cleanup tests**

Add tests proving `prepareForUpdateInstall()` rejects and does not confirm quit when managed Chrome returns `{ stopped: false, reason: 'kill-failed' }` or `{ stopped: false, reason: 'exit-timeout' }`. Preserve safe handling for `already-exited` and identity-mismatch results where no managed process should be killed.

- [ ] **Step 2: Run lifecycle tests and verify RED**

Run: `cd app && node --test src/lifecycleController.test.js`

Expected: cleanup currently returns true for failed Chrome termination.

- [ ] **Step 3: Implement cleanup result validation and lifecycle recovery**

Treat `kill-failed` and `exit-timeout` as cleanup failures. Add a production lifecycle method that resets `shutdownInProgress` and `confirmedQuit` only for a failed update-install attempt; it must not affect a successful quit.

- [ ] **Step 4: Write failing coordinator recovery tests**

Cover both `setInstalling()` and `quitAndInstall()` failures after `shutdownForUpdate()` returned true. Assert the drain is released, recovery is awaited exactly once, the runtime returns to a retryable status only after recovery, and the original error remains observable.

- [ ] **Step 5: Run coordinator tests and verify RED**

Run: `cd app && node --test src/updateInstallCoordinator.test.js`

Expected: recovery callback is missing and services remain stopped.

- [ ] **Step 6: Implement post-cleanup recovery wiring**

Add an injected recovery callback to the coordinator. In `main.js`, reset lifecycle update-install state and restart desktop services through the existing startup path. Recovery failures must be logged without leaking the drain token and without hiding the original install failure.

- [ ] **Step 7: Write failing disk-probe error test**

Make `getAvailableBytes()` throw and assert `downloadUpdate()` publishes `status: 'error'` with the readable message instead of leaving `status: 'available'`.

- [ ] **Step 8: Run the service test and verify RED**

Run: `cd app && node --test src/updateService.test.js`

Expected: the thrown probe error bypasses the current download `try/catch`.

- [ ] **Step 9: Move disk probing into the guarded download path**

Handle probe failures with the same error publication used for download failures, without starting a download.

- [ ] **Step 10: Run focused tests**

Run:

```bash
cd app && node --test src/lifecycleController.test.js src/updateInstallCoordinator.test.js src/updateService.test.js
node --test tests/desktop-auto-update.test.js
git diff --check
```

Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add app/src/lifecycleController.js app/src/lifecycleController.test.js app/src/updateInstallCoordinator.js app/src/updateInstallCoordinator.test.js app/src/updateService.js app/src/updateService.test.js app/src/main.js tests/desktop-auto-update.test.js
git commit -m "fix(update): recover safely from install failures"
```

---

### Task 14: Make renderer update actions single-flight and accessible

**Files:**
- Create: `app/src/renderer/utils/updateActions.js`
- Create: `app/src/renderer/utils/updateActions.test.js`
- Modify: `app/src/renderer/App.vue`
- Modify: `app/src/renderer/components/SidebarUpdateFooter.vue`
- Modify: `app/src/renderer/views/SettingsPage.vue`
- Modify: `tests/desktop-auto-update.test.js`
- Modify: `tests/ai-image-workbench-responsive.test.js`

**Interfaces:**
- Consumes: preload methods `downloadUpdate()`, `checkForUpdates()`, `installUpdate()`, and `getUpdateStatus()`.
- Produces: one in-flight update action at a time, stable renderer error state, disabled controls during action execution, keyboard-focusable collapsed status text.

- [ ] **Step 1: Write failing single-flight behavior tests**

Define a small production utility used by `App.vue`. Tests must prove two calls made before the first settles invoke the underlying action once and share the same completion, busy transitions are `true -> false`, and a rejected action is routed to the supplied error handler without an unhandled rejection.

- [ ] **Step 2: Run utility tests and verify RED**

Run: `cd app && node --test src/renderer/utils/updateActions.test.js`

Expected: module is absent.

- [ ] **Step 3: Implement the minimal single-flight runner**

Use one in-flight promise for all update actions. Do not queue a second download/check/install behind the first. Always clear busy state in `finally`.

- [ ] **Step 4: Wire renderer error handling and disabled states**

Route footer and Settings checks through the runner. During an action, disable actionable controls. On failure, read the latest main-process status when possible and present a user-readable error; do not leave an unhandled event-handler Promise.

- [ ] **Step 5: Write failing accessibility contract tests**

Require collapsed non-action update status to be keyboard focusable and carry appropriate status semantics. Require actionable controls to reflect the busy-disabled state. Preserve immediate hover/focus tooltip behavior and expanded-sidebar no-overflow selectors.

- [ ] **Step 6: Run renderer contract tests and verify RED**

Run: `node --test tests/desktop-auto-update.test.js tests/ai-image-workbench-responsive.test.js`

Expected: missing tabindex/role/busy bindings fail.

- [ ] **Step 7: Implement collapsed keyboard access**

For collapsed non-action states, add `tabindex="0"`, status semantics, and the existing `focus-visible` tooltip path. Keep expanded passive version text out of the tab order.

- [ ] **Step 8: Run focused tests and build**

Run:

```bash
cd app && node --test src/renderer/utils/updateActions.test.js src/renderer/utils/updateDisplay.test.js
node --test tests/desktop-auto-update.test.js tests/ai-image-workbench-responsive.test.js
cd app && npm run vite:build
git diff --check
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add app/src/renderer/utils/updateActions.js app/src/renderer/utils/updateActions.test.js app/src/renderer/App.vue app/src/renderer/components/SidebarUpdateFooter.vue app/src/renderer/views/SettingsPage.vue tests/desktop-auto-update.test.js tests/ai-image-workbench-responsive.test.js
git commit -m "fix(ui): serialize desktop update actions"
```

---

## Final Verification

- [ ] Generate a review package from the pre-remediation base to final HEAD and dispatch a whole-branch reviewer.
- [ ] Resolve every remaining Critical and Important finding in one cohesive fix wave, then re-review.
- [ ] Run `cd app && npm test`.
- [ ] Run `node --test tests/*.test.js`.
- [ ] Run `venv/bin/python -m pytest -q tests/test_runtime_install_guard.py tests/test_api_task_lifecycle.py tests/test_task_schedules_scheduler.py tests/test_cloud_machine_agent.py`.
- [ ] Run `cd app && npm run vite:build`.
- [ ] Run `git diff --check` and verify a clean worktree.
- [ ] Recheck expanded/collapsed sidebar dimensions and tooltips in the running Electron shell.
- [ ] Do not claim packaged Windows/macOS acceptance until real signed/notarized installers are tested.
