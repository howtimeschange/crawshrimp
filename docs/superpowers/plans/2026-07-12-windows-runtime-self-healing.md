# Windows Runtime Self-Healing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe one-click backend and Chrome recovery, structured diagnostics, single-instance protection, and Windows installer guidance.

**Architecture:** Keep process ownership in Electron, extract pure CDP classification and single-instance coordination into focused modules, and extend the existing backend controller rather than adding a second process manager. All recovery actions are single-flight and refuse to kill foreign processes.

**Tech Stack:** Electron, Node.js CommonJS, Vue 3, Python 3.12, Node test runner, pytest, Vite, electron-builder/NSIS.

## Global Constraints

- Do not kill an unknown process on API port 18765 or CDP port 9222.
- Do not silently migrate or delete runtime data.
- Preserve active-task shutdown and update-drain safety.
- Keep default backend port 18765 and CDP port 9222.
- Use TDD for every behavior change.

---

### Task 1: Backend diagnostics and reset-safe recovery

**Files:**
- Modify: `app/src/backendController.js`
- Modify: `app/src/backendController.test.js`

**Interfaces:**
- Produces: `getDiagnostics(): { state, lastError, launchAttempt }`
- Produces: `stop(): void` that clears controller state even without a live child.

- [ ] Add failing tests proving a failed child leaves a readable diagnostic and `stop()` clears stale failure state after the child has exited.
- [ ] Run `node --test app/src/backendController.test.js` and confirm the new tests fail because `getDiagnostics` is absent and stale state remains.
- [ ] Track the last failure and launch attempt in `ensureReady`, return an immutable snapshot, and make `stop()` reset state unconditionally.
- [ ] Re-run the controller test and confirm it passes.

### Task 2: Owned Python fallback adoption and backend repair IPC

**Files:**
- Create: `app/src/serviceRecovery.js`
- Create: `app/src/serviceRecovery.test.js`
- Modify: `app/src/main.js`
- Modify: `app/src/preload.js`
- Modify: `tests/desktop-backend-startup.test.js`

**Interfaces:**
- Produces: `createSingleFlightRecovery(run): () => Promise<Result>`.
- Produces IPC: `restart-backend` and `open-diagnostic-log`.
- Extends `get-status` with `apiDiagnostic`, `dataDir`, and `dataDirRecovery`.

- [ ] Add failing tests for a shared single-flight promise, owned fallback adoption, foreign-runtime rejection, IPC exposure, and diagnostic status fields.
- [ ] Run the focused Node tests and confirm failures identify the missing module and wiring.
- [ ] Implement the single-flight helper, adopt only the current owned backend's writable absolute fallback directory, persist it, and add backend repair/log IPC handlers.
- [ ] Re-run focused tests and keep all existing backend tests green.

### Task 3: CDP classification and managed Chrome repair

**Files:**
- Create: `app/src/chromeCdp.js`
- Create: `app/src/chromeCdp.test.js`
- Modify: `app/src/main.js`
- Modify: `app/src/managedChrome.js`

**Interfaces:**
- Produces: `probeChromeCdp({ http, port, timeoutMs }): Promise<CdpDiagnostic>`.
- Produces diagnostics with `kind`, `ok`, endpoint status, and readable message.

- [ ] Add failing tests for ready, refused, timeout, 404 wrong responder, partial, and malformed responses.
- [ ] Run `node --test app/src/chromeCdp.test.js` and confirm the missing module failure.
- [ ] Implement dual-endpoint probing and stable classification.
- [ ] Add failing source/integration tests proving wrong responders do not spawn Chrome and verified stale managed instances are stopped before relaunch.
- [ ] Wire single-flight launch/recovery, stderr logging, and structured status into `main.js`.
- [ ] Re-run CDP, managed-Chrome, and desktop startup tests.

### Task 4: Recovery UI

**Files:**
- Modify: `app/src/renderer/App.vue`
- Modify: `app/src/renderer/views/SettingsPage.vue`
- Modify: `app/src/renderer/views/ScriptList.vue`
- Add or modify renderer utility tests under `app/src/renderer/utils/` when logic is extracted.

**Interfaces:**
- Consumes: `window.cs.restartBackend()`, `window.cs.launchChrome()`, `window.cs.openDiagnosticLog()`.
- Displays backend/CDP diagnostic snapshots from `get-status`.

- [ ] Add failing source-contract tests for recovery actions, diagnostic copy, and the script-list repair event.
- [ ] Run focused tests and confirm the new contracts are absent.
- [ ] Wire App recovery functions, settings actions/messages, and script-list one-click recovery.
- [ ] Re-run renderer tests and `cd app && npm run vite:build`.

### Task 5: Single-instance and installer lifecycle hardening

**Files:**
- Create: `app/src/singleInstance.js`
- Create: `app/src/singleInstance.test.js`
- Modify: `app/src/main.js`
- Modify: `README.md`
- Modify: `docs/desktop-update-release-checklist.md`

**Interfaces:**
- Produces: `configureSingleInstance({ app, getWindow, createWindow }): boolean`.

- [ ] Add failing tests proving the first instance registers focus behavior and a second instance quits before service startup.
- [ ] Run the focused test and confirm the missing module failure.
- [ ] Implement single-instance coordination and guard `app.whenReady()` service startup.
- [ ] Document manual bridge shutdown and add concrete Windows acceptance cases for stale processes and denied runtime directories.
- [ ] Re-run lifecycle, updater, and desktop contract tests.

### Task 6: Full verification and review

**Files:**
- Review all changed files.

- [ ] Run `node --test app/src/*.test.js app/src/renderer/utils/*.test.js app/scripts/*.test.js`.
- [ ] Run `node --test tests/*.test.js`.
- [ ] Run `python3 -m pytest -q`.
- [ ] Run `cd app && npm run vite:build`.
- [ ] Run `git diff --check` and inspect `git diff --stat` plus the complete diff.
- [ ] Request an independent code review against the design and plan; fix every Critical and Important issue.
- [ ] Re-run all verification commands after review fixes.
