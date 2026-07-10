# Crawshrimp Desktop Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a user-consented, task-safe stable-release updater for Crawshrimp on macOS and Windows, with a persistent 168 px/56 px collapsible sidebar and a bottom version/update control.

**Architecture:** Keep `electron-updater` and every installer decision in the Electron main process, use a backend drain/readiness guard as the source of truth for safe installation, and expose only bounded IPC state/actions to Vue. Build stable `vX.Y.Z` update assets through the existing GitHub Actions matrix; Windows uses NSIS and blockmaps, while macOS updates from a signed, notarized, stapled ZIP and keeps DMG as the bridge/fallback artifact.

**Tech Stack:** Electron 29.4.6, electron-updater 6.8.9, electron-builder 24.13.3, Node.js 20 test runner, Vue 3/Vite 5, FastAPI/Python unittest, GitHub Actions, NSIS, Apple Developer ID/notarytool/ShipIt.

## Global Constraints

- Only published, non-draft, non-prerelease `vX.Y.Z` GitHub Releases are eligible for in-app updates.
- `desktop-latest` remains manual QA only and must stay `latest=false`.
- Set `autoDownload = false`, `autoInstallOnAppQuit = false`, `allowPrerelease = false`, and `allowDowngrade = false`.
- Never force an update, auto-download before consent, auto-install on ordinary quit, or stop a task for an update.
- Treat unavailable or ambiguous backend install readiness as unsafe.
- Require a second explicit `重启安装` action after download and after all blockers clear.
- Keep `appId: com.crawshrimp.app`, product name `抓虾`, `perMachine: false`, and the current NSIS installer identity stable.
- Windows may launch unsigned updates initially; add `publisherName` enforcement only after Windows code signing is configured.
- Formal macOS tag builds must fail unless the ZIP-contained app is Developer ID signed, notarized, stapled, and verified for both arm64 and x64.
- Expanded sidebar width is 168 px; collapsed desktop icon-rail width is approximately 56 px.
- Sidebar collapse changes presentation only; it must not remount the active content view or interrupt work.
- Display the version from `app.getVersion()`; never hard-code it in the renderer.
- Preserve `CRAWSHRIMP_DATA`, adapters, task data, logs, desktop config, API token, exports, and the managed Chrome profile.
- Existing users perform one manual overlay install of the bridge release; they never uninstall first.
- Do not stage or modify unrelated `cloud/approval-workbench` work or runtime directories while executing this plan.

---

## File Structure

### New focused units

- `app/src/updatePlatform.js` — packaged-install support checks and test-feed override gating.
- `app/src/updatePlatform.test.js` — macOS supported-location and production/test-feed rules.
- `app/src/updateService.js` — pure main-process update state and electron-updater event wiring.
- `app/src/updateService.test.js` — state transitions, explicit download, cache/error, and install handoff tests.
- `app/src/updateInstallCoordinator.js` — backend readiness polling, drain acquisition, notification, and install orchestration.
- `app/src/updateInstallCoordinator.test.js` — fail-closed, blocker, race, cleanup, and notification tests.
- `core/runtime_install_guard.py` — thread-safe active-operation registry and atomic update-drain state.
- `tests/test_runtime_install_guard.py` — guard unit tests.
- `app/src/renderer/utils/updateDisplay.js` — expanded/collapsed footer presentation mapping.
- `app/src/renderer/utils/updateDisplay.test.js` — every update-state presentation.
- `app/src/renderer/utils/sidebarState.js` — persistent 168 px/56 px sidebar preference.
- `app/src/renderer/utils/sidebarState.test.js` — preference normalization and storage behavior.
- `app/src/renderer/components/SidebarUpdateFooter.vue` — version/update footer UI.
- `app/scripts/notarize-macos-app.js` — electron-builder `afterSign` bridge.
- `app/scripts/notarize-macos-app.sh` — notarize/staple/verify the signed app before ZIP and DMG creation.
- `app/scripts/validate-update-artifacts.js` — update metadata/file/hash contract validation.
- `app/scripts/validate-update-artifacts.test.js` — artifact validator fixtures.
- `app/scripts/update-e2e-server.js` — local generic-provider feed for signed packaged update tests.
- `app/scripts/update-e2e-server.test.js` — health, range, traversal, and missing-file feed tests.
- `docs/desktop-update-release-checklist.md` — bridge, Windows, macOS ARM, macOS Intel, rollback, and evidence checklist.

### Existing files to modify

- `app/package.json` and `app/package-lock.json` — exact `electron-updater` dependency and test scripts.
- `tests/desktop-auto-update-disabled.test.js` — replace the disabled assertions with enabled updater source/build contracts and rename to `tests/desktop-auto-update.test.js`.
- `core/api_server.py` — readiness/drain endpoints, request tracking, blocker aggregation, task/scheduler drain gates.
- `core/scheduler.py` — skip scheduled callbacks while the update drain is held.
- `core/cloud_machine_agent.py` — do not claim a new cloud job during drain; report a claimed job as a blocker.
- `tests/test_api_task_lifecycle.py` and `tests/test_cloud_machine_agent.py` — endpoint and cloud-drain integration tests.
- `app/src/lifecycleController.js` and `app/src/lifecycleController.test.js` — updater-driven cleanup path distinct from normal quit.
- `app/src/main.js` — compose updater services, secure IPC, delayed startup check, notification, and update status events.
- `app/src/preload.js` — bounded updater IPC bridge.
- `app/src/renderer/utils/devCsBridge.js` and `app/src/renderer/utils/devCsBridge.test.js` — disabled browser-dev updater contract.
- `app/src/renderer/App.vue` — collapse control, layout widths, global update state, and footer placement.
- `app/src/renderer/views/SettingsPage.vue` — read-only updater status and manual check/retry panel.
- `app/build.yml` — GitHub publish provider, macOS ZIP targets, `afterSign` hook.
- `.github/workflows/build-desktop.yml` — required secrets, ZIP/YAML artifacts, validators, draft stable release publication, rolling-release filtering.
- `tests/desktop-macos-signing-notarization.test.js` and `tests/workflow-triggers.test.js` — new signing and publication contracts.
- `README.md` — automatic update behavior, bridge install, data preservation, and manual fallback.

---

### Task 1: Restore the Main-Process Update State Machine

**Files:**
- Create: `app/src/updatePlatform.js`
- Create: `app/src/updatePlatform.test.js`
- Create: `app/src/updateService.js`
- Create: `app/src/updateService.test.js`
- Modify: `app/package.json`
- Modify: `app/package-lock.json`
- Rename: `tests/desktop-auto-update-disabled.test.js` → `tests/desktop-auto-update.test.js`

**Interfaces:**
- Produces: `evaluateUpdatePlatform({ platform, isPackaged, execPath, homeDir }): { supported: boolean, reason: string }`.
- Produces: `resolveTestFeedUrl({ isTestBuild, env }): string`; production builds always return an empty string.
- Produces: `createUpdateService({ app, autoUpdater, platformSupport, testFeedUrl, getAvailableBytes, log, emit }): UpdateService` with `getStatus()`, `subscribe(listener)`, `checkForUpdates({ manual })`, `downloadUpdate()`, `setInstallReadiness({ ready, blockers, error })`, `setInstalling()`, `quitAndInstall()`, and `dispose()`.
- Consumed later by: Tasks 4, 5, 6, 7, and 10.

- [ ] **Step 1: Install the exact updater dependency and rename the obsolete contract test**

Run:

```bash
cd app
npm install --save --save-exact electron-updater@6.8.9
cd ..
git mv tests/desktop-auto-update-disabled.test.js tests/desktop-auto-update.test.js
```

Expected: `app/package.json` contains `"electron-updater": "6.8.9"` and the lockfile changes only for that dependency tree.

- [ ] **Step 2: Write failing platform-support tests**

Create `app/src/updatePlatform.test.js` with these cases:

```javascript
const test = require('node:test')
const assert = require('node:assert/strict')
const { evaluateUpdatePlatform, resolveTestFeedUrl } = require('./updatePlatform')

test('packaged Windows builds support in-place update', () => {
  assert.deepEqual(
    evaluateUpdatePlatform({
      platform: 'win32',
      isPackaged: true,
      execPath: 'C:\\Users\\Kim\\AppData\\Local\\Programs\\crawshrimp\\抓虾.exe',
      homeDir: 'C:\\Users\\Kim',
    }),
    { supported: true, reason: '' },
  )
})

test('macOS mounted DMG and translocated builds are rejected', () => {
  for (const execPath of [
    '/Volumes/抓虾/抓虾.app/Contents/MacOS/抓虾',
    '/private/var/folders/AppTranslocation/抓虾.app/Contents/MacOS/抓虾',
  ]) {
    const result = evaluateUpdatePlatform({
      platform: 'darwin',
      isPackaged: true,
      execPath,
      homeDir: '/Users/kim',
    })
    assert.equal(result.supported, false)
  }
})

test('production build ignores a generic test feed override', () => {
  assert.equal(resolveTestFeedUrl({
    isTestBuild: false,
    env: { CRAWSHRIMP_UPDATE_E2E_URL: 'http://127.0.0.1:40123' },
  }), '')
})
```

- [ ] **Step 3: Run the platform tests to verify failure**

Run: `cd app && node --test src/updatePlatform.test.js`

Expected: FAIL with `Cannot find module './updatePlatform'`.

- [ ] **Step 4: Implement the packaged-location and test-feed policy**

Create `app/src/updatePlatform.js` with these exact rules:

```javascript
'use strict'

const path = require('path')

function evaluateUpdatePlatform({ platform, isPackaged, execPath, homeDir }) {
  if (!isPackaged) return { supported: false, reason: '开发模式不会检查桌面更新。' }
  if (platform !== 'darwin') return { supported: true, reason: '' }

  const normalized = String(execPath || '').replace(/\\/g, '/')
  const userApplications = path.join(String(homeDir || ''), 'Applications').replace(/\\/g, '/')
  const inApplications = normalized.startsWith('/Applications/') ||
    (userApplications && normalized.startsWith(userApplications + '/'))
  if (normalized.startsWith('/Volumes/')) {
    return { supported: false, reason: '请先将抓虾拖入“应用程序”目录，再检查更新。' }
  }
  if (normalized.includes('/AppTranslocation/')) {
    return { supported: false, reason: '抓虾当前处于系统隔离路径，请重新从“应用程序”目录打开。' }
  }
  if (!inApplications) {
    return { supported: false, reason: '请从“应用程序”目录运行抓虾后再更新。' }
  }
  return { supported: true, reason: '' }
}

function resolveTestFeedUrl({ isTestBuild, env }) {
  if (!isTestBuild) return ''
  return String(env?.CRAWSHRIMP_UPDATE_E2E_URL || '').trim()
}

module.exports = { evaluateUpdatePlatform, resolveTestFeedUrl }
```

- [ ] **Step 5: Run platform tests**

Run: `cd app && node --test src/updatePlatform.test.js`

Expected: PASS.

- [ ] **Step 6: Write failing update-service state tests**

Create `app/src/updateService.test.js` using `EventEmitter` fakes. Cover these exact expectations:

```javascript
test('available update waits for explicit download', async () => {
  const updater = new EventEmitter()
  updater.checkForUpdates = async () => {
    updater.emit('update-available', { version: '2.0.1', releaseNotes: '安全更新' })
  }
  let downloads = 0
  updater.downloadUpdate = async () => { downloads += 1 }

  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
  })

  await service.checkForUpdates({ manual: false })
  assert.equal(service.getStatus().status, 'available')
  assert.equal(downloads, 0)
  await service.downloadUpdate()
  assert.equal(downloads, 1)
})

test('downloaded update becomes waiting or ready only through readiness input', () => {
  const updater = new EventEmitter()
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
  })

  updater.emit('update-downloaded', { version: '2.0.1' })
  service.setInstallReadiness({
    ready: false,
    blockers: [{ kind: 'task', id: 'tmall::export', label: '导出任务', status: 'running' }],
  })
  assert.equal(service.getStatus().status, 'waiting-for-tasks')

  service.setInstallReadiness({ ready: true, blockers: [] })
  assert.equal(service.getStatus().status, 'ready-to-install')
})
```

Also test development disablement, event subscription cleanup, progress normalization, SHA/download errors, insufficient disk space before download, and `quitAndInstall` rejection before a download exists. The disk-space test supplies update metadata with `files[0].size = 200` and `getAvailableBytes: () => 100`, then expects zero updater download calls and a user-facing `磁盘空间不足` error.

- [ ] **Step 7: Run update-service tests to verify failure**

Run: `cd app && node --test src/updateService.test.js`

Expected: FAIL with `Cannot find module './updateService'`.

- [ ] **Step 8: Implement the update service**

Build `app/src/updateService.js` around one private state object and one subscriber set. The state starts as:

```javascript
const state = {
  status: platformSupport.supported ? 'idle' : 'disabled',
  currentVersion: String(app?.getVersion?.() || ''),
  latestVersion: '',
  releaseNotes: '',
  progress: null,
  error: platformSupport.reason || '',
  blockers: [],
  lastCheckedAt: '',
  downloaded: false,
  manualDownloadUrl: 'https://github.com/howtimeschange/crawshrimp/releases/latest',
}
```

Wire `checking-for-update`, `update-available`, `update-not-available`, `download-progress`, `update-downloaded`, and `error`. Configure the four global updater flags from Global Constraints. Persist the largest numeric `files[].size` from update metadata as `requiredBytes`. Before calling the updater, compare it with injected `getAvailableBytes()`; when free bytes are lower, stay on the current version and report both formatted required and available space. `downloadUpdate()` must reject unless status is `available` or `error` with a known newer version. `quitAndInstall()` must reject unless `downloaded === true` and `status === 'installing'`. `dispose()` removes updater listeners and subscribers.

When the injected `testFeedUrl` is non-empty, call `autoUpdater.setFeedURL({ provider: 'generic', url: testFeedUrl })`; ordinary packaged builds receive an empty string and keep the generated GitHub provider.

- [ ] **Step 9: Replace the old source contract with enabled updater assertions**

Rewrite `tests/desktop-auto-update.test.js` so it asserts:

```javascript
assert.equal(packageJson.dependencies['electron-updater'], '6.8.9')
assert.equal(fs.existsSync(path.join(repoRoot, 'app/src/updateService.js')), true)
assert.match(updateService, /autoDownload = false/)
assert.match(updateService, /autoInstallOnAppQuit = false/)
assert.doesNotMatch(preload, /setFeedURL/)
```

Do not assert main/preload/UI integration yet; later tasks extend this file after those files exist.

- [ ] **Step 10: Run focused and package tests**

Run:

```bash
cd app
node --test src/updatePlatform.test.js src/updateService.test.js
npm test
cd ..
node --test tests/desktop-auto-update.test.js
```

Expected: all PASS.

- [ ] **Step 11: Commit**

```bash
git add app/package.json app/package-lock.json app/src/updatePlatform.js app/src/updatePlatform.test.js app/src/updateService.js app/src/updateService.test.js tests/desktop-auto-update.test.js
git commit -m "feat(desktop): restore update state service"
```

---

### Task 2: Add the Atomic Runtime Install Guard

**Files:**
- Create: `core/runtime_install_guard.py`
- Create: `tests/test_runtime_install_guard.py`

**Interfaces:**
- Produces: `RuntimeInstallGuard.begin_operation(kind, operation_id, label, status="running") -> str`.
- Produces: `RuntimeInstallGuard.end_operation(token) -> bool`.
- Produces: `RuntimeInstallGuard.readiness(extra_blockers=()) -> dict`.
- Produces: `RuntimeInstallGuard.acquire_drain(extra_blockers=()) -> str`.
- Produces: `RuntimeInstallGuard.release_drain(token) -> bool`.
- Produces: `RuntimeInstallGuard.assert_start_allowed() -> None`.
- Produces: `RuntimeInstallGuard.is_draining() -> bool`.
- Produces exceptions: `UpdateDrainActive` and `InstallRuntimeBusy`.
- Consumed later by: Task 3.

- [ ] **Step 1: Write failing guard tests**

Create `tests/test_runtime_install_guard.py` with tests for operation registration, duplicate-safe tokens, atomic drain acquisition, rejection while busy, rejection of new operations during drain, wrong-token release, correct-token release, and a fresh guard starting undrained.

Use this core test:

```python
def test_drain_blocks_new_operations_until_matching_token_releases():
    guard = RuntimeInstallGuard()
    drain_token = guard.acquire_drain()

    with self.assertRaises(UpdateDrainActive):
        guard.begin_operation("task", "tmall::export", "天猫导出")

    self.assertFalse(guard.release_drain("wrong-token"))
    self.assertTrue(guard.is_draining())
    self.assertTrue(guard.release_drain(drain_token))
    operation_token = guard.begin_operation("task", "tmall::export", "天猫导出")
    self.assertTrue(guard.end_operation(operation_token))
```

- [ ] **Step 2: Run the guard test to verify failure**

Run: `PYTHONPATH=. .venv/bin/python -m unittest tests.test_runtime_install_guard -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'core.runtime_install_guard'`.

- [ ] **Step 3: Implement the thread-safe guard**

Create `core/runtime_install_guard.py` with a `threading.RLock`, a token-keyed active-operation dictionary, and one optional drain token. Normalize blockers to:

```python
{
    "kind": str(kind or "operation"),
    "id": str(operation_id or token),
    "label": str(label or operation_id or "后台操作"),
    "status": str(status or "running"),
}
```

`begin_operation` must check drain state and register within the same lock. `acquire_drain` must combine registered operations with supplied blockers and raise `InstallRuntimeBusy(blockers)` if the combined list is non-empty; otherwise it stores and returns a new UUID hex token. `readiness` returns:

```python
{
    "ready": len(blockers) == 0 and not draining,
    "draining": draining,
    "blockers": blockers,
    "checked_at": datetime.now(timezone.utc).isoformat(),
}
```

- [ ] **Step 4: Run the guard tests**

Run: `PYTHONPATH=. .venv/bin/python -m unittest tests.test_runtime_install_guard -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/runtime_install_guard.py tests/test_runtime_install_guard.py
git commit -m "feat(runtime): add atomic update drain guard"
```

---

### Task 3: Make Backend Readiness Authoritative

**Files:**
- Modify: `core/api_server.py`
- Modify: `core/scheduler.py`
- Modify: `core/cloud_machine_agent.py`
- Modify: `tests/test_api_task_lifecycle.py`
- Modify: `tests/test_cloud_machine_agent.py`
- Test: `tests/test_runtime_install_guard.py`

**Interfaces:**
- Consumes: `RuntimeInstallGuard` from Task 2.
- Produces HTTP: `GET /runtime/install-readiness`.
- Produces HTTP: `POST /runtime/update-drain` returning `{ ok, drain_token, readiness }`.
- Produces HTTP: `DELETE /runtime/update-drain` accepting `{ drain_token }`.
- Produces: scheduler hooks `set_runtime_operation_hooks(begin_operation, end_operation)`.
- Produces: cloud-agent constructor options `begin_job_operation: Callable[[], str]` and `end_job_operation: Callable[[str], None]`.
- Consumed later by: Task 4 and Task 5.

- [ ] **Step 1: Write failing endpoint tests**

Extend `tests/test_api_task_lifecycle.py` to assert:

- Idle readiness returns `ready: true`.
- A registered regular task appears as a `task` blocker.
- A task-center instance keeps its `instance_uid`.
- AI image jobs with `queued` or `running` status appear as `ai_image` blockers.
- `cloud_machine_controller.last_health == "online_busy"` appears as a `cloud_job` blocker.
- Drain acquisition while a blocker exists returns HTTP 409 with code `runtime_busy`.
- A mutating request during drain returns HTTP 409 with code `update_pending`.
- Deleting with the matching drain token restores task starts.
- A wrong drain token returns HTTP 409 and does not release.

Add this request/assertion block to the endpoint test:

```python
response = client.post("/runtime/update-drain")
self.assertEqual(response.status_code, 200)
drain_token = response.json()["drain_token"]

blocked = client.post("/tasks/example/task/run", json={"params": {}})
self.assertEqual(blocked.status_code, 409)
self.assertEqual(blocked.json()["detail"]["code"], "update_pending")

released = client.request(
    "DELETE",
    "/runtime/update-drain",
    json={"drain_token": drain_token},
)
self.assertEqual(released.status_code, 200)
```

- [ ] **Step 2: Write failing cloud-claim tests**

Extend `tests/test_cloud_machine_agent.py`:

```python
def test_claim_is_skipped_when_runtime_operation_cannot_start(self):
    client = FakeCloudClient()
    agent = CloudMachineAgent(client, begin_job_operation=lambda: '')

    result = agent.claim_once()

    self.assertIsNone(result["job"])
    self.assertEqual(result["job_result"], None)
    self.assertFalse(any(path.endswith("/jobs/claim") for _, path, _ in client.requests))
```

Also test that the existing default still claims normally.

- [ ] **Step 3: Run the integration tests to verify failure**

Run:

```bash
PYTHONPATH=. .venv/bin/python -m unittest   tests.test_api_task_lifecycle   tests.test_cloud_machine_agent -v
```

Expected: FAIL because the endpoints and `begin_job_operation` option do not exist.

- [ ] **Step 4: Add request-operation tracking and blocker aggregation**

In `core/api_server.py`:

- Instantiate one `RuntimeInstallGuard`.
- Extract the current `/tasks/active` loop into private `_active_task_items() -> list[dict]` so both endpoints reuse it.
- Add `_collect_install_blockers()` that combines:
  - `_active_task_items()`.
  - Task instances whose persisted status is exactly `running`.
  - AI image jobs whose job or summary run status is `queued` or `running`.
  - Guard-registered mutating/export operations.
  - A `cloud_job` blocker when controller health is `online_busy`.
- Deduplicate on `(kind, id)`.

Add FastAPI middleware that calls `begin_operation` for every POST/PUT/PATCH/DELETE request and for GET requests whose path matches `/data/{adapter_id}/{task_id}/export`. Exempt `/runtime/install-readiness`, `/runtime/update-drain`, and health endpoints. Convert `UpdateDrainActive` to HTTP 409 with:

```json
{
  "detail": {
    "code": "update_pending",
    "message": "抓虾正在准备安装更新，请稍后再启动新任务。"
  }
}
```

Always call `end_operation` in `finally`.

- [ ] **Step 5: Add readiness and drain endpoints**

Add the three routes using `_collect_install_blockers()`. Use a Pydantic request model with `drain_token: str` for release. Convert `InstallRuntimeBusy` to HTTP 409:

```python
raise HTTPException(409, {
    "code": "runtime_busy",
    "message": "仍有任务正在运行。",
    "blockers": exc.blockers,
})
```

Do not log blocker parameters or secrets.

- [ ] **Step 6: Gate scheduler and cloud claims atomically**

In `core/scheduler.py` add optional module-level operation hooks:

```python
_begin_runtime_operation: Callable[[str, str, str, str], str] | None = None
_end_runtime_operation: Callable[[str], None] | None = None

def set_runtime_operation_hooks(begin_operation=None, end_operation=None) -> None:
    global _begin_runtime_operation, _end_runtime_operation
    _begin_runtime_operation = begin_operation
    _end_runtime_operation = end_operation
```

Both generated `_job` wrappers call the begin hook before invoking callbacks, return without starting work when it returns an empty token, hold the token for the entire scheduled callback, and release it in `finally`. Configure the hooks from `core/api_server.py` with wrappers around `runtime_install_guard.begin_operation(...)` and `end_operation(token)`; the begin wrapper converts `UpdateDrainActive` to an empty token.

In `core/cloud_machine_agent.py` add `begin_job_operation` and `end_job_operation` to the constructor. At the start of `claim_once`, acquire one operation token before calling the claim API; return this idle result when the callback returns an empty token:

```python
{
    "job": None,
    "job_result": None,
    "next_poll_after_seconds": DEFAULT_IDLE_SECONDS,
    "idle_sleep_seconds": DEFAULT_IDLE_SECONDS,
}
```

Hold a non-empty token across both claim and `_execute_claimed_job`, and release it in `finally`. Construct the app's cloud agent with wrappers around the same runtime guard. This prevents drain acquisition from racing between an idle check and a remote cloud-job claim.

- [ ] **Step 7: Run backend tests**

Run:

```bash
PYTHONPATH=. .venv/bin/python -m unittest   tests.test_runtime_install_guard   tests.test_api_task_lifecycle   tests.test_cloud_machine_agent -v
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add core/api_server.py core/scheduler.py core/cloud_machine_agent.py tests/test_runtime_install_guard.py tests/test_api_task_lifecycle.py tests/test_cloud_machine_agent.py
git commit -m "feat(runtime): expose update install readiness"
```

---

### Task 4: Coordinate Readiness, Notification, and Install

**Files:**
- Create: `app/src/updateInstallCoordinator.js`
- Create: `app/src/updateInstallCoordinator.test.js`

**Interfaces:**
- Consumes: Task 1 `UpdateService`.
- Consumes HTTP adapters supplied by Task 5: `getReadiness()`, `acquireDrain()`, and `releaseDrain(token)`.
- Produces: `createUpdateInstallCoordinator(options)` with `start()`, `refreshReadiness()`, `requestInstall()`, and `dispose()`.
- Consumed later by: Task 5.

- [ ] **Step 1: Write failing coordinator tests**

Use injected functions rather than Electron or real timers. Cover:

- Downloaded state immediately checks readiness.
- A blocker sets `waiting-for-tasks` and schedules a five-second retry.
- Transition from waiting to ready emits exactly one notification.
- Readiness network failure sets an error and never installs.
- `requestInstall` performs a fresh check, then acquire-drain, cleanup, `setInstalling`, and `quitAndInstall` in that order.
- A 409 race returns to waiting.
- Cleanup failure releases the acquired drain token.
- `dispose` unsubscribes and clears polling.

Assert order with:

```javascript
assert.deepEqual(events, [
  'get-readiness',
  'acquire-drain',
  'shutdown',
  'set-installing',
  'quit-and-install',
])
```

- [ ] **Step 2: Run coordinator tests to verify failure**

Run: `cd app && node --test src/updateInstallCoordinator.test.js`

Expected: FAIL with `Cannot find module './updateInstallCoordinator'`.

- [ ] **Step 3: Implement the coordinator**

Create `createUpdateInstallCoordinator` with these injected dependencies:

```javascript
{
  updateService,
  getReadiness,
  acquireDrain,
  releaseDrain,
  shutdownForUpdate,
  notifyReady,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  pollIntervalMs = 5000,
  log = () => {},
}
```

`start()` subscribes to the service and reacts only when `snapshot.status === 'downloaded'`. `refreshReadiness()` updates the service with the returned blockers. It starts one polling timer only while blocked. A readiness exception calls `setInstallReadiness({ ready: false, blockers: [], error })` and stops polling.

`requestInstall()` must:

1. Refresh readiness.
2. Return `{ ok: false, deferred: true }` if not ready.
3. Acquire a drain token.
4. Run updater-specific lifecycle cleanup.
5. Mark installing.
6. Call `quitAndInstall`.
7. Release the token and restore a retryable state if steps 4–6 throw before process exit.

- [ ] **Step 4: Run coordinator tests and app tests**

Run:

```bash
cd app
node --test src/updateInstallCoordinator.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/updateInstallCoordinator.js app/src/updateInstallCoordinator.test.js
git commit -m "feat(desktop): coordinate task-safe update install"
```

---

### Task 5: Integrate Lifecycle, Main Process, Preload, and Dev Bridge

**Files:**
- Modify: `app/src/lifecycleController.js`
- Modify: `app/src/lifecycleController.test.js`
- Modify: `app/src/main.js`
- Modify: `app/src/preload.js`
- Modify: `app/src/renderer/utils/devCsBridge.js`
- Modify: `app/src/renderer/utils/devCsBridge.test.js`
- Modify: `tests/desktop-auto-update.test.js`
- Test: `app/src/updateService.test.js`
- Test: `app/src/updateInstallCoordinator.test.js`

**Interfaces:**
- Consumes: Tasks 1, 3, and 4.
- Produces lifecycle method: `prepareForUpdateInstall(): Promise<boolean>`.
- Produces IPC: `update:get-status`, `update:check`, `update:download`, `update:install`.
- Produces renderer event: `update-status`.
- Produces preload methods: `getUpdateStatus`, `checkForUpdates`, `downloadUpdate`, `installUpdate`, `onUpdateStatus`.
- Consumed later by: Tasks 6 and 7.

- [ ] **Step 1: Write failing updater-lifecycle tests**

Extend `app/src/lifecycleController.test.js` with:

```javascript
test('updater cleanup never asks to stop active tasks', async () => {
  const events = []
  const controller = createLifecycleController({
    getActiveTasks: async () => { events.push('get-active'); return { active: true, tasks: [{}] } },
    confirmQuitWithActiveTasks: async () => events.push('confirm'),
    requestStopActiveTasks: async () => events.push('stop-tasks'),
    stopBackend: async () => events.push('stop-backend'),
    stopManagedChrome: async () => events.push('stop-chrome'),
  })

  await controller.prepareForUpdateInstall()

  assert.deepEqual(events, ['stop-backend', 'stop-chrome'])
})
```

Also test that the next `handleBeforeQuit` returns true without duplicate cleanup and that cleanup failure resets updater-shutdown state.

- [ ] **Step 2: Run lifecycle tests to verify failure**

Run: `cd app && node --test src/lifecycleController.test.js`

Expected: FAIL because `prepareForUpdateInstall` is missing.

- [ ] **Step 3: Implement updater-driven lifecycle cleanup**

Add `prepareForUpdateInstall` to the controller. It must not call `getActiveTasks`, `confirmQuitWithActiveTasks`, `requestStopActiveTasks`, or `waitForNoActiveTasks`. It sets `shutdownInProgress`, stops backend and managed Chrome, then sets `confirmedQuit = true`. On failure it resets `shutdownInProgress = false` and rethrows so the coordinator can release drain.

Keep the existing normal-quit behavior unchanged.

- [ ] **Step 4: Add failing source/IPC contracts**

Extend `tests/desktop-auto-update.test.js` to assert:

```javascript
assert.match(main, /require\('electron-updater'\)/)
assert.match(main, /createUpdateService/)
assert.match(main, /createUpdateInstallCoordinator/)
assert.match(main, /15000/)
assert.match(main, /update:get-status/)
assert.match(main, /update:check/)
assert.match(main, /update:download/)
assert.match(main, /update:install/)
assert.match(preload, /getUpdateStatus/)
assert.match(preload, /checkForUpdates/)
assert.match(preload, /downloadUpdate/)
assert.match(preload, /installUpdate/)
assert.match(preload, /onUpdateStatus/)
assert.doesNotMatch(preload, /setFeedURL/)
```

Extend `app/src/renderer/utils/devCsBridge.test.js` to require a disabled updater status and no-op check/download/install methods.

- [ ] **Step 5: Compose the updater in `app/src/main.js`**

Import `Notification` from Electron and `autoUpdater` from `electron-updater`. Evaluate platform support using `process.platform`, `app.isPackaged`, `process.execPath`, and `app.getPath('home')`.

Read packaged metadata once with `const APP_METADATA = require('../package.json')`, then resolve the E2E feed with:

```javascript
const testFeedUrl = resolveTestFeedUrl({
  isTestBuild: APP_METADATA.crawshrimpUpdateTestBuild === true,
  env: process.env,
})
```

Pass `testFeedUrl` into `createUpdateService`. Formal builds do not contain the marker and therefore cannot honor the environment override.

Pass a disk adapter based on the existing `fs` import:

```javascript
getAvailableBytes: () => {
  const stats = fs.statfsSync(app.getPath('userData'))
  return Number(stats.bavail) * Number(stats.bsize)
},
```

Create one `sendUpdateStatus(snapshot)` event sender. Compose the service and coordinator after lifecycle controller creation. HTTP adapters use existing `apiCall` with `ensureReady: false` and short timeouts:

```javascript
getReadiness: () => apiCall('GET', '/runtime/install-readiness', null, {
  ensureReady: false,
  timeoutMs: 1500,
}),
acquireDrain: () => apiCall('POST', '/runtime/update-drain', {}, {
  ensureReady: false,
  timeoutMs: 1500,
}),
releaseDrain: drainToken => apiCall('DELETE', '/runtime/update-drain', {
  drain_token: drainToken,
}, {
  ensureReady: false,
  timeoutMs: 1500,
}),
```

`notifyReady` creates one system notification with title `抓虾更新已下载` and body `当前任务已结束，可以重启安装新版本。` when supported.

After `ensureDesktopServicesStarted()` succeeds in `app.whenReady()`, call `coordinator.start()` and schedule `updateService.checkForUpdates({ manual: false })` after 15 seconds. Do not schedule in development/unsupported mode.

- [ ] **Step 6: Add secure updater IPC and preload methods**

Register only the four channels listed in Interfaces. `update:install` calls the coordinator, not `autoUpdater` directly. `update:check` calls `coordinator.refreshReadiness()` when `updateService.getStatus().downloaded` is true; otherwise it calls `updateService.checkForUpdates({ manual: true })`. This makes the same Retry action recover both feed-check and readiness failures.

In preload, return a listener cleanup closure:

```javascript
onUpdateStatus: (cb) => {
  const listener = (_, data) => cb(data)
  ipcRenderer.on('update-status', listener)
  return () => ipcRenderer.removeListener('update-status', listener)
},
```

Do not expose URLs, channels, file paths, or `setFeedURL`.

- [ ] **Step 7: Add the browser-dev bridge contract**

In `createDevCsBridge()` define one local `disabledUpdateStatus()` factory and return:

```javascript
getUpdateStatus: async () => disabledUpdateStatus(),
checkForUpdates: async () => disabledUpdateStatus(),
downloadUpdate: async () => disabledUpdateStatus(),
installUpdate: async () => ({ ok: false, error: '浏览器开发模式不能安装桌面更新。' }),
onUpdateStatus: () => () => {},
```

The local factory returns:

```javascript
{
  status: 'disabled',
  currentVersion: 'dev',
  latestVersion: '',
  progress: null,
  blockers: [],
  error: '浏览器开发模式不会检查桌面更新。',
  downloaded: false,
}
```

- [ ] **Step 8: Run integration tests**

Run:

```bash
cd app
node --test src/lifecycleController.test.js src/updateService.test.js src/updateInstallCoordinator.test.js src/renderer/utils/devCsBridge.test.js
npm test
cd ..
node --test tests/desktop-auto-update.test.js tests/desktop-backend-startup.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app/src/lifecycleController.js app/src/lifecycleController.test.js app/src/main.js app/src/preload.js app/src/renderer/utils/devCsBridge.js app/src/renderer/utils/devCsBridge.test.js tests/desktop-auto-update.test.js
git commit -m "feat(desktop): wire secure updater lifecycle"
```

---

### Task 6: Build the Sidebar Presentation Units

**Files:**
- Create: `app/src/renderer/utils/updateDisplay.js`
- Create: `app/src/renderer/utils/updateDisplay.test.js`
- Create: `app/src/renderer/utils/sidebarState.js`
- Create: `app/src/renderer/utils/sidebarState.test.js`
- Create: `app/src/renderer/components/SidebarUpdateFooter.vue`

**Interfaces:**
- Consumes: Task 5 update status shape.
- Produces: `buildSidebarUpdatePresentation(updateStatus, collapsed): UpdatePresentation`.
- Produces: `readSidebarCollapsed(storage): boolean` and `writeSidebarCollapsed(storage, collapsed): boolean`.
- Produces Vue events: `download`, `install`, and `retry`.
- Consumed later by: Task 7.

- [ ] **Step 1: Write failing display mapping tests**

Create tests that assert exact copy and actions:

```javascript
assert.deepEqual(
  buildSidebarUpdatePresentation({
    status: 'available',
    currentVersion: '2.0.0',
    latestVersion: '2.0.1',
  }, false),
  {
    action: 'download',
    label: '更新',
    versionLabel: 'v2.0.0',
    title: '发现 v2.0.1，点击下载',
    tone: 'available',
    percent: null,
  },
)
```

Also cover `up-to-date`, `downloading` with rounded/clamped percent, `waiting-for-tasks` with blocker count, `ready-to-install`, `error`, `disabled`, and collapsed version label `v2.0`.

- [ ] **Step 2: Write failing sidebar preference tests**

Test missing/malformed values as expanded, `"1"` as collapsed, and storage write exceptions as non-fatal. Use the key `crawshrimp.sidebarCollapsed.v1`.

- [ ] **Step 3: Run utility tests to verify failure**

Run:

```bash
cd app
node --test src/renderer/utils/updateDisplay.test.js src/renderer/utils/sidebarState.test.js
```

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement the pure utilities**

`buildSidebarUpdatePresentation` must return one normalized object for every status. The only actionable mappings are:

```javascript
const ACTION_BY_STATUS = {
  available: 'download',
  error: 'retry',
  'ready-to-install': 'install',
}
```

Downloading and waiting states have no click action. `up-to-date` and `disabled` show version only. Collapsed labels use an icon/compact version, but titles retain full version and meaning.

`readSidebarCollapsed` and `writeSidebarCollapsed` catch storage exceptions and never throw.

- [ ] **Step 5: Create the focused Vue footer**

`SidebarUpdateFooter.vue` accepts `updateStatus` and `collapsed`. It imports the presentation mapper, renders a semantic button only when `presentation.action` is non-empty, and emits the mapped event. It includes:

- Full version and text in expanded mode.
- Compact version/icon and tooltip in collapsed mode.
- `role="progressbar"` with `aria-valuenow` while downloading.
- Blocker-count tooltip while waiting.
- Visible focus styling and `aria-label` for every icon-only state.

The component contains no IPC calls and no update state of its own.

- [ ] **Step 6: Run utilities and Vite build**

Run:

```bash
cd app
node --test src/renderer/utils/updateDisplay.test.js src/renderer/utils/sidebarState.test.js
npm run vite:build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/renderer/utils/updateDisplay.js app/src/renderer/utils/updateDisplay.test.js app/src/renderer/utils/sidebarState.js app/src/renderer/utils/sidebarState.test.js app/src/renderer/components/SidebarUpdateFooter.vue
git commit -m "feat(ui): add sidebar update presentation"
```

---

### Task 7: Integrate the Collapsible Shell and Settings Status

**Files:**
- Modify: `app/src/renderer/App.vue`
- Modify: `app/src/renderer/views/SettingsPage.vue`
- Modify: `tests/desktop-auto-update.test.js`
- Test: `app/src/renderer/utils/updateDisplay.test.js`
- Test: `app/src/renderer/utils/sidebarState.test.js`

**Interfaces:**
- Consumes: Tasks 5 and 6.
- Produces: persisted 168 px/56 px application shell.
- Produces: sidebar footer actions wired to bounded preload methods.
- Produces: settings panel ID `application-update`.

- [ ] **Step 1: Add failing shell source contracts**

Extend `tests/desktop-auto-update.test.js` to assert:

- `SidebarUpdateFooter` import and render.
- `crawshrimp.sidebarCollapsed.v1` through the utility.
- CSS variables or exact grid columns for 168 px and 56 px.
- Footer is outside the `!activeScript`/`v-else` navigation branch.
- Update listener cleanup occurs on unmount.
- Settings menu contains `application-update` and `检查更新`.
- Unsupported-location and signature/update errors expose only the pinned official manual Release URL.
- No hard-coded current version literal appears in App or Settings.

- [ ] **Step 2: Run the source contract to verify failure**

Run: `node --test tests/desktop-auto-update.test.js`

Expected: FAIL on missing footer/collapse/settings assertions.

- [ ] **Step 3: Add global update and collapse state to App.vue**

Initialize:

```javascript
const sidebarCollapsed = ref(readSidebarCollapsed(window.localStorage))
const updateStatus = ref({
  status: 'idle',
  currentVersion: '',
  latestVersion: '',
  progress: null,
  blockers: [],
  error: '',
  downloaded: false,
})
```

The toggle writes storage and changes only the root layout class. On mount:

1. Subscribe with `window.cs.onUpdateStatus`.
2. Load `window.cs.getUpdateStatus()`.
3. Keep the existing API/task/cloud startup sequence.

On unmount, call the exact update-listener cleanup closure.

Add action handlers:

```javascript
async function downloadUpdate() {
  updateStatus.value = await window.cs.downloadUpdate()
}

async function retryUpdateCheck() {
  updateStatus.value = await window.cs.checkForUpdates()
}

async function installUpdate() {
  const result = await window.cs.installUpdate()
  if (result?.status) updateStatus.value = result
}
```

- [ ] **Step 4: Refactor the sidebar without remounting content**

Use root classes to set `grid-template-columns: 168px 1fr` or `56px 1fr`. Place the collapse button beside the logo with `-webkit-app-region: no-drag`.

When collapsed and a script task is open, render primary nav icons instead of ambiguous task-name abbreviations while leaving the current TaskRunner mounted. Updating `selectNav` must clear active script/task state only when the user actually selects another primary destination; toggling collapse does not call it.

Place `SidebarUpdateFooter` after the nav/sub-nav branch with `margin-top: auto` so it appears on every route.

Keep the existing `@media (max-width: 760px)` bottom-nav behavior and ignore the desktop collapsed width inside that media rule.

- [ ] **Step 5: Add the settings update-status panel**

Add an Application menu group:

```javascript
{
  id: 'application',
  icon: '●',
  label: '应用',
  desc: '版本 / 桌面更新',
  children: [{ id: 'application-update', label: '桌面更新' }],
}
```

Add an `application-update` panel that shows current version, latest version when present, last check time, non-sensitive error text, and one `检查更新`/`重新检查` button. It does not duplicate download/install controls; the sidebar remains the action surface. When status is unsupported or an update/signature error persists, show `手动下载安装包` and call the existing `window.cs.openExternalUrl(updateStatus.manualDownloadUrl)`. Render the button only when that value exactly matches `https://github.com/howtimeschange/crawshrimp/releases/latest`.

Pass `updateStatus` from App and emit `check-update` to the parent so Settings does not own a second listener.

- [ ] **Step 6: Run UI regression**

Run:

```bash
cd app
node --test src/renderer/utils/updateDisplay.test.js src/renderer/utils/sidebarState.test.js
npm test
npm run vite:build
cd ..
node --test tests/desktop-auto-update.test.js
```

Expected: PASS.

- [ ] **Step 7: Manually verify the local shell without an update feed**

Run:

```bash
cd app
npm run dev
```

Then verify:

- Expanded width is 168 px.
- Collapsed width is approximately 56 px.
- Current AI image/task content remains mounted while toggling.
- Icons have tooltips and keyboard focus.
- Footer displays `dev`/disabled state without offering download.
- Narrow AI-image layout retains bottom navigation.

Expected: no renderer exceptions and no task state reset.

- [ ] **Step 8: Commit**

```bash
git add app/src/renderer/App.vue app/src/renderer/views/SettingsPage.vue tests/desktop-auto-update.test.js
git commit -m "feat(ui): add collapsible update sidebar"
```

---

### Task 8: Generate Windows and macOS Update Metadata

**Files:**
- Modify: `app/build.yml`
- Modify: `.github/workflows/build-desktop.yml`
- Modify: `tests/desktop-auto-update.test.js`
- Modify: `tests/workflow-triggers.test.js`

**Interfaces:**
- Consumes: Task 1 exact dependency.
- Produces: Windows `EXE + blockmap + latest.yml`.
- Produces: macOS `DMG + ZIP + latest-mac.yml + generated ZIP blockmaps`.
- Consumed later by: Tasks 9 and 10.

- [ ] **Step 1: Add failing packaging contracts**

Extend `tests/desktop-auto-update.test.js` to require:

```javascript
assert.match(buildYml, /provider: github/)
assert.match(buildYml, /owner: howtimeschange/)
assert.match(buildYml, /repo: crawshrimp/)
assert.match(buildYml, /target:\s*\n\s*- target: dmg[\s\S]*- target: zip/)
assert.match(workflow, /app\/dist\/latest\*\.yml/)
assert.match(workflow, /app\/dist\/\*\.zip/)
```

Extend `tests/workflow-triggers.test.js` to keep `desktop-latest --latest=false` and require the formal version release to be latest only after validation.

- [ ] **Step 2: Run contract tests to verify failure**

Run:

```bash
node --test tests/desktop-auto-update.test.js tests/workflow-triggers.test.js
```

Expected: FAIL because publish metadata and ZIP/YAML artifact globs are absent.

- [ ] **Step 3: Configure Electron Builder metadata**

In `app/build.yml`:

- Add ZIP alongside DMG for arm64 and x64.
- Add GitHub publish provider owner/repo.
- Keep artifact names unchanged.
- Keep NSIS identity/scope unchanged.
- Add `generateUpdatesFilesForAllChannels: false`.
- Continue invoking builds with `--publish never`; metadata is generated locally and GitHub upload remains workflow-owned.

- [ ] **Step 4: Extend CI artifact collection**

Update the build matrix globs:

```yaml
mac:
  app/dist/*.dmg
  app/dist/*.zip
  app/dist/*.zip.blockmap
  app/dist/latest*.yml

windows:
  app/dist/*.exe
  app/dist/*.exe.blockmap
  app/dist/latest*.yml
```

Update macOS expected-file fallback checks so a post-build cleanup exception is tolerated only when both DMGs, both ZIPs, and update metadata are non-empty.

- [ ] **Step 5: Run contracts and local metadata build smoke**

Run:

```bash
node --test tests/desktop-auto-update.test.js tests/workflow-triggers.test.js
cd app
npm test
```

Expected: PASS. Do not claim cross-platform package success until the GitHub matrix runs.

- [ ] **Step 6: Commit**

```bash
git add app/build.yml .github/workflows/build-desktop.yml tests/desktop-auto-update.test.js tests/workflow-triggers.test.js
git commit -m "build(desktop): generate updater artifacts"
```

---

### Task 9: Make the ZIP App the Signed and Notarized Source

**Files:**
- Create: `app/scripts/notarize-macos-app.js`
- Create: `app/scripts/notarize-macos-app.sh`
- Modify: `app/build.yml`
- Modify: `.github/workflows/build-desktop.yml`
- Modify: `tests/desktop-macos-signing-notarization.test.js`
- Test: `app/scripts/notarize-macos-dmgs.sh`

**Interfaces:**
- Consumes: Task 8 macOS ZIP target.
- Produces: electron-builder `afterSign` hook that staples each architecture's `.app` before target packaging.
- Produces: formal tag credential gate.
- Consumed later by: Task 10 and release acceptance.

- [ ] **Step 1: Write failing signing-lineage contracts**

Extend `tests/desktop-macos-signing-notarization.test.js` to require:

- `afterSign: scripts/notarize-macos-app.js` in build config.
- Formal tag builds set `CRAWSHRIMP_NOTARIZE_APP=1`.
- Missing Apple API credentials or missing CSC credentials exits non-zero on formal tags.
- App script uses `ditto -c -k --keepParent`, `xcrun notarytool submit`, `xcrun stapler staple`, `xcrun stapler validate`, `codesign --verify --deep --strict`, and `spctl --assess`.
- Existing DMG notarization still runs after package generation.
- Final workflow validates the ZIP-extracted app.

- [ ] **Step 2: Run signing contracts to verify failure**

Run: `node --test tests/desktop-macos-signing-notarization.test.js`

Expected: FAIL on the missing afterSign scripts and credential gate.

- [ ] **Step 3: Implement the afterSign bridge**

Create `app/scripts/notarize-macos-app.js`:

```javascript
'use strict'

const path = require('path')
const { spawnSync } = require('child_process')

async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CRAWSHRIMP_NOTARIZE_APP !== '1') return

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  )
  const script = path.join(__dirname, 'notarize-macos-app.sh')
  const result = spawnSync('bash', [script, appPath], {
    cwd: path.dirname(__dirname),
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`macOS app notarization failed with exit code ${result.status}`)
  }
}

exports.default = afterSign
```

- [ ] **Step 4: Implement app notarization and verification**

`notarize-macos-app.sh` accepts exactly one app path, requires the three existing `APPLE_NOTARY_*` variables, verifies the Developer ID signature before upload, creates a temporary ZIP with `ditto`, submits and polls with the same timeout/poll environment contract as the DMG script, prints the Apple log on rejection, staples the accepted ticket to the original app, then runs:

```bash
xcrun stapler validate "${app_path}"
codesign --verify --deep --strict --verbose=2 "${app_path}"
spctl --assess --type execute --verbose=2 "${app_path}"
```

Clean temporary files with a trap and never print credentials.

- [ ] **Step 5: Wire formal-tag credential failure and ZIP validation**

In the workflow's credential step, replace the current skip notice with a formal-tag error and `exit 1` when any Apple or CSC credential is missing. Export `CRAWSHRIMP_NOTARIZE_APP=1` for formal tag builds.

After the DMG notarization step, extract both final ZIPs to separate temporary directories and run signature, Team ID, Gatekeeper, and stapler validation against each contained app.

- [ ] **Step 6: Run signing and build-source tests**

Run:

```bash
node --test tests/desktop-macos-signing-notarization.test.js tests/desktop-auto-update.test.js
cd app
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/scripts/notarize-macos-app.js app/scripts/notarize-macos-app.sh app/build.yml .github/workflows/build-desktop.yml tests/desktop-macos-signing-notarization.test.js
git commit -m "build(mac): notarize updater app before packaging"
```

---

### Task 10: Validate Assets and Publish the Stable Release Atomically

**Files:**
- Create: `app/scripts/validate-update-artifacts.js`
- Create: `app/scripts/validate-update-artifacts.test.js`
- Modify: `app/package.json`
- Modify: `.github/workflows/build-desktop.yml`
- Modify: `tests/workflow-triggers.test.js`
- Modify: `tests/desktop-auto-update.test.js`

**Interfaces:**
- Consumes: Tasks 8 and 9 artifacts.
- Produces CLI: `node app/scripts/validate-update-artifacts.js <root>`.
- Produces: draft-first formal release that becomes Latest only after readback.
- Produces: rolling release upload filtered to manual installer artifacts.

- [ ] **Step 1: Write failing artifact-validator tests**

Use temporary directories and real SHA512 values. Test:

- Windows metadata references an existing EXE with matching SHA512.
- macOS metadata references both ZIP architectures with matching SHA512.
- Missing file fails.
- Hash mismatch fails.
- Missing platform metadata fails when both platform directories are supplied.
- Nested `release-assets/macos` and `release-assets/windows` roots work.

The success fixture computes:

```javascript
const sha512 = crypto.createHash('sha512').update(fileBytes).digest('base64')
```

- [ ] **Step 2: Run validator tests to verify failure**

Run: `cd app && node --test scripts/validate-update-artifacts.test.js`

Expected: FAIL because the validator is missing.

- [ ] **Step 3: Implement the dependency-free validator**

The validator recursively finds `latest.yml` and `latest-mac.yml`, parses every `url:` or `path:` entry and its following `sha512:` value, resolves basename-only references within the metadata file's artifact tree, and compares base64 SHA512 using `crypto.createHash('sha512')`.

Export `validateUpdateArtifacts(root)` for tests and exit non-zero with one line per missing/mismatched asset in CLI mode. Never accept a metadata file with zero parsed assets.

Add `test:update-artifacts` to `app/package.json`.

- [ ] **Step 4: Run validator and app tests**

Run:

```bash
cd app
node --test scripts/validate-update-artifacts.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Add build-time and release-time validation**

In each matrix build, run the validator on `app/dist` before artifact upload.

In `publish-version-release`:

1. Download both platform artifacts.
2. Run the validator on `release-assets`.
3. Verify tag/package version equality.
4. Create or update the versioned Release as `--draft --latest=false`.
5. Upload all update assets with clobber on rerun.
6. Read back asset names with `gh release view ... --json assets`.
7. Compare readback names to the local release-assets set.
8. Publish with `gh release edit ... --draft=false --latest` only after exact match.

The release notes must say automatic update metadata is enabled, not disabled.

- [ ] **Step 6: Keep rolling release manual-only**

The `desktop-latest` publication remains `--latest=false` and uploads only DMG and EXE manual installers. Do not upload `latest.yml`, `latest-mac.yml`, or updater ZIPs to the rolling release.

- [ ] **Step 7: Extend workflow contracts and run them**

Assert draft-first publication, validation-before-publish, exact readback, stable Latest edit, and rolling asset filtering.

Run:

```bash
node --test tests/workflow-triggers.test.js tests/desktop-auto-update.test.js tests/desktop-macos-signing-notarization.test.js
cd app
npm test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/scripts/validate-update-artifacts.js app/scripts/validate-update-artifacts.test.js app/package.json .github/workflows/build-desktop.yml tests/workflow-triggers.test.js tests/desktop-auto-update.test.js
git commit -m "build(desktop): validate and publish stable updates"
```

---

### Task 11: Add Packaged Update Acceptance and Operator Documentation

**Files:**
- Create: `app/scripts/update-e2e-server.js`
- Create: `app/scripts/update-e2e-server.test.js`
- Create: `docs/desktop-update-release-checklist.md`
- Modify: `app/src/updatePlatform.js`
- Modify: `app/src/updatePlatform.test.js`
- Modify: `README.md`
- Modify: `tests/desktop-auto-update.test.js`
- Test: all updater, renderer, backend, workflow, and signing tests.

**Interfaces:**
- Consumes: every prior task.
- Produces: local generic HTTP feed for two signed E2E builds.
- Produces: repeatable bridge/Windows/macOS acceptance checklist and release evidence format.
- Produces: user-facing install/update documentation.

- [ ] **Step 1: Harden the E2E override gate with failing tests**

Extend `updatePlatform.test.js` so an E2E URL is accepted only when both are true:

- Packaged metadata contains `crawshrimpUpdateTestBuild: true`.
- `CRAWSHRIMP_UPDATE_E2E_URL` is loopback HTTP on `127.0.0.1` or `localhost`.

Reject HTTPS/public hosts, credentials in URLs, non-HTTP schemes, and any override in production metadata.

- [ ] **Step 2: Implement the strict test-feed resolver**

Update `resolveTestFeedUrl` to parse with `URL` and return the normalized loopback URL only under the test-build marker. Production builds continue using generated GitHub configuration even if the environment variable is set.

- [ ] **Step 3: Create the local E2E feed server**

`update-e2e-server.js` accepts `--root <artifact-directory>` and `--port <port>`, binds only to `127.0.0.1`, serves metadata and assets with byte-range support, rejects paths escaping root, and exposes `/health` returning:

```json
{ "ok": true, "provider": "crawshrimp-update-e2e" }
```

Create `app/scripts/update-e2e-server.test.js` and verify health, range responses, traversal rejection, and missing-file 404 with a temporary artifact directory and an ephemeral port.

- [ ] **Step 4: Write the release checklist**

`docs/desktop-update-release-checklist.md` contains exact evidence fields:

- Source commit and old/new versions.
- GitHub run IDs.
- Formal and rolling release URLs.
- Asset names and SHA512 readback.
- macOS ARM/Intel `codesign`, Team ID, `spctl`, and `stapler` results.
- Windows install path before/after.
- User-data sentinel path and checksum before/after.
- Active-task blocker screenshot/log.
- “普通退出未安装” proof.
- “任务结束后仅提示重启安装” proof.
- New version/backend health after restart.
- Rollback/unpublish command sequence.

Document two test builds produced with `-c.extraMetadata.crawshrimpUpdateTestBuild=true` and the local E2E URL. The formal build never carries that marker.

- [ ] **Step 5: Update user documentation**

Update README to state:

- Existing updater-disabled users overlay-install the bridge release once.
- Windows updates in place through NSIS without uninstall.
- macOS normal in-app updates use ZIP/ShipIt; DMG is bridge/fallback only.
- User data and Chrome profile remain outside program files.
- Updates wait for active tasks and require explicit restart.
- Windows may show Unknown Publisher until code signing is added.
- `desktop-latest` is manual QA and formal `vX.Y.Z` is the in-app stable source.

- [ ] **Step 6: Run the full scoped regression**

Run:

```bash
cd app
npm test
npm run vite:build
cd ..
node --test tests/*.test.js
PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
git diff --check
```

Expected: all tests PASS and `git diff --check` prints nothing.

- [ ] **Step 7: Run packaged acceptance before claiming release readiness**

Follow the new checklist on:

- Windows x64: previous installed version → E2E new version.
- macOS ARM: previous signed app → signed ZIP through ShipIt.
- macOS Intel: previous signed app → signed ZIP through ShipIt.
- Manual bridge overlay on Windows and macOS.

For each environment, seed a sentinel under the actual data directory, start a real task, download the update, prove the update waits, let the task finish, click `重启安装`, and verify version/backend/data after restart.

Expected: all checklist gates recorded. A DMG-only success does not satisfy macOS acceptance.

- [ ] **Step 8: Commit**

```bash
git add app/scripts/update-e2e-server.js app/scripts/update-e2e-server.test.js app/src/updatePlatform.js app/src/updatePlatform.test.js docs/desktop-update-release-checklist.md README.md tests/desktop-auto-update.test.js
git commit -m "docs(desktop): add updater release acceptance"
```

---

## Final Verification

After all task commits exist, run the smallest complete release gate once more:

```bash
cd app
npm test
npm run vite:build
cd ..
node --test tests/desktop-auto-update.test.js tests/workflow-triggers.test.js tests/desktop-macos-signing-notarization.test.js tests/desktop-backend-startup.test.js
PYTHONPATH=. .venv/bin/python -m unittest   tests.test_runtime_install_guard   tests.test_api_task_lifecycle   tests.test_cloud_machine_agent -v
git diff --check
git status --short --branch
```

Expected:

- All commands PASS.
- The worktree contains no updater-related unstaged or untracked source files.
- Unrelated pre-existing runtime or cloud-workbench files remain untouched.
- The implementation branch contains one focused commit per task.
- Release readiness is not claimed until the three real packaged update checklist runs are complete.
