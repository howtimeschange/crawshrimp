import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('desktop backend starts as a module from python-scripts root', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /function getBackendLaunchArgs\(\) \{\s*return \['-m', 'core\.api_server'\]\s*\}/)
  assert.match(main, /const launchArgs = getBackendLaunchArgs\(\)/)
  assert.match(main, /spawn\(pythonBin, launchArgs, \{/)
  assert.match(main, /cwd: scriptsDir/)
  assert.match(main, /PYTHONPATH: scriptsDir/)
  assert.doesNotMatch(main, /spawn\(pythonBin, \[serverScript\]/)
})

test('desktop tells the Python backend whether it is packaged', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /const CLOUD_APPROVAL_APP_ENV = IS_DEV \? 'development' : 'production'/)
  assert.match(main, /CRAWSHRIMP_APP_ENV: CLOUD_APPROVAL_APP_ENV/)
})

test('desktop backend switches away from an occupied non-compatible API port before launch', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /async function prepareBackendEndpoint\(\)/)
  assert.match(main, /const availablePort = await findAvailableApiPort\(apiPort\)/)
  assert.match(main, /port \$\{apiPort\} is occupied but no compatible backend responded/)
  assert.match(main, /async function startBackend\(\) \{\s*await prepareBackendEndpoint\(\)\s*await backendController\.ensureReady\(\)\s*\}/)
})

test('desktop backend compatibility requires the current Electron launch identity', () => {
  const main = readRepoFile('app/src/main.js')
  const backendHealth = readRepoFile('app/src/backendHealth.js')
  const apiServer = readRepoFile('core/api_server.py')

  assert.match(main, /const BACKEND_INSTANCE_ID = crypto\.randomUUID\(\)/)
  assert.match(main, /CRAWSHRIMP_BACKEND_INSTANCE_ID: BACKEND_INSTANCE_ID/)
  assert.match(backendHealth, /path: '\/health\?probe=1'/)
  assert.match(main, /isOwnedBackendRuntime\(runtime, \{\s*instanceId: BACKEND_INSTANCE_ID,/)
  assert.match(main, /scriptsDir: expectedBackendScriptsDir\(\)/)
  assert.match(main, /samePath: sameRuntimePath/)
  assert.match(apiServer, /"backend_instance_id": str\(os\.environ\.get\("CRAWSHRIMP_BACKEND_INSTANCE_ID"\) or ""\)/)
})

test('desktop backend readiness uses lightweight health probe', () => {
  const main = readRepoFile('app/src/main.js')
  const backendHealth = readRepoFile('app/src/backendHealth.js')
  const apiServer = readRepoFile('core/api_server.py')

  assert.match(main, /const \{ requestBackendHealth \} = require\('\.\/backendHealth'\)/)
  assert.match(main, /function getBackendHealth\(timeoutMs = 800\) \{\s*return requestBackendHealth\(\{ http, port: apiPort, timeoutMs \}\)\s*\}/)
  assert.match(main, /async function probeApiReady\(timeoutMs = 800\) \{\s*return \(await getBackendHealth\(timeoutMs\)\)\.ok\s*\}/)
  assert.match(backendHealth, /path: '\/health\?probe=1'/)
  assert.match(apiServer, /def health\(probe: bool = False\):\s*if probe:/)
})

test('desktop backend terminates stale crawshrimp backend processes for the same data root', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /async function stopForeignBackendRuntime\(runtime = \{\}\)/)
  assert.match(main, /function readBackendLockPid\(\)/)
  assert.match(main, /const lockPid = runtime\.owns_backend_instance === false \? Number\(runtime\.backend_lock_pid \|\| 0\) \|\| readBackendLockPid\(\) : 0/)
  assert.match(main, /sameRuntimePath\(runtimeDataDir, expectedBackendDataDir\(\)\)/)
  assert.match(main, /stopProcessTreeByPid\(runtimePid\)/)
  assert.match(main, /await waitForPidExit\(runtimePid/)
  assert.match(main, /await stopForeignBackendRuntime\(runtime\)/)
  assert.match(main, /taskkill', \['\/F', '\/T', '\/PID', String\(pid\)\]/)
})

test('desktop services restart when macOS reopens the app after all windows close', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /const BACKEND_LAUNCH_RETRIES = process\.platform === 'win32' \? 2 : 1/)
  assert.match(main, /let desktopServicesStartupPromise = null/)
  assert.match(main, /async function ensureDesktopServicesStarted\(\)/)
  assert.match(main, /if \(!startup\.api\.ok\) desktopServicesStartupPromise = null/)
  assert.match(main, /await ensureDesktopServicesStarted\(\)/)
  assert.match(main, /app\.on\('activate', \(\) => \{\s*if \(BrowserWindow\.getAllWindows\(\)\.length === 0\) createWindow\(\)\s*ensureDesktopServicesStarted\(\)/)
  assert.match(main, /app\.on\('window-all-closed', \(\) => \{\s*lifecycleController\.handleWindowAllClosed\(\)\s*\}\)/)
  assert.doesNotMatch(main, /app\.on\('window-all-closed', \(\) => \{\s*stopBackend\(\)/)
})

test('desktop hides native application menu on Windows and Linux', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /const \{ app, BrowserWindow, Menu, ipcMain, shell, dialog, session \} = require\('electron'\)/)
  assert.match(main, /function hideNativeAppMenu\(\) \{\s*if \(process\.platform === 'darwin'\) return\s*Menu\.setApplicationMenu\(null\)\s*\}/)
  assert.match(main, /autoHideMenuBar: process\.platform !== 'darwin'/)
  assert.match(main, /if \(process\.platform !== 'darwin'\) \{\s*mainWindow\.setMenuBarVisibility\(false\)\s*\}/)
  assert.match(main, /app\.whenReady\(\)\.then\(async \(\) => \{\s*hideNativeAppMenu\(\)\s*createWindow\(\)/)
})

test('desktop lifecycle confirms active tasks before quitting', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /const lifecycleController = createLifecycleController\(\{/)
  assert.match(main, /getActiveTasks: getActiveTasksForQuit/)
  assert.match(main, /confirmQuitWithActiveTasks/)
  assert.match(main, /requestStopActiveTasks/)
  assert.match(main, /waitForNoActiveTasks/)
  assert.match(main, /stopManagedChrome: stopManagedChromeForQuit/)
  assert.match(main, /onQuitCanceled: restoreWindowAfterQuitCanceled/)
  assert.match(main, /function restoreWindowAfterQuitCanceled\(\) \{/)
  assert.match(main, /app\.on\('before-quit', \(event\) => \{\s*lifecycleController\.handleBeforeQuit\(event\)/)
  assert.match(main, /apiCall\('GET', '\/tasks\/active', null, \{\s*ensureReady: false,\s*timeoutMs: 1200,/)
})

test('settings page displays the runtime backend port reported by the main process', () => {
  const appShell = readRepoFile('app/src/renderer/App.vue')
  const settings = readRepoFile('app/src/renderer/views/SettingsPage.vue')

  assert.match(appShell, /apiPort: 18765/)
  assert.match(appShell, /apiState: 'starting'/)
  assert.match(appShell, /function applyRuntimeStatus\(next = \{\}\)/)
  assert.match(appShell, /status\.value = \{ \.\.\.status\.value, \.\.\.\(next \|\| \{\}\) \}/)
  assert.match(settings, /核心服务 \(端口 \{\{ props\.status\?\.apiPort \|\| 18765 \}\}\)/)
})

test('desktop get-status reports backend state machine state', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /apiState: backendController\.getState\(\)/)
})

test('desktop exposes structured backend diagnostics and one-click recovery', () => {
  const main = readRepoFile('app/src/main.js')
  const preload = readRepoFile('app/src/preload.js')
  const restartBlock = main.slice(
    main.indexOf('const restartBackend ='),
    main.indexOf('async function startBackend'),
  )

  assert.match(main, /const \{ createSingleFlightRecovery, isOwnedBackendRuntime, classifyBackendHealth \} = require\('\.\/serviceRecovery'\)/)
  assert.match(main, /const restartBackend = createSingleFlightRecovery\(async \(\) => \{/)
  assert.match(main, /backendController\.stop\(\)/)
  assert.match(main, /await prepareBackendEndpoint\(\)/)
  assert.match(main, /await backendController\.ensureReady\(\)/)
  assert.match(main, /secureHandle\('restart-backend', async \(\) => restartBackend\(\)\)/)
  assert.match(main, /secureHandle\('open-diagnostic-log'/)
  assert.match(main, /apiDiagnostic: backendController\.getDiagnostics\(\)/)
  assert.match(main, /dataDirRecovery: \{ \.\.\.dataDirRecoveryInfo \}/)
  assert.match(restartBlock, /apiBase: `http:\/\/127\.0\.0\.1:\$\{apiPort\}`/)
  assert.match(restartBlock, /apiToken: getApiToken\(\)/)
  assert.match(preload, /restartBackend:\s*\(\) => ipcRenderer\.invoke\('restart-backend'\)/)
  assert.match(preload, /openDiagnosticLog:\s*\(\) => ipcRenderer\.invoke\('open-diagnostic-log'\)/)
})

test('desktop adopts a writable fallback selected by its owned Python backend', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /function adoptOwnedBackendDataDir\(runtime = \{\}\)/)
  assert.match(main, /isOwnedBackendRuntime\(runtime, \{/)
  assert.match(main, /const adopted = ensureWritableDataDir\(runtimeDataDir\)/)
  assert.match(main, /resolvedCrawshrimpDataDir = adopted/)
  assert.match(main, /process\.env\.CRAWSHRIMP_DATA = adopted/)
  assert.match(main, /writeDesktopConfig\(\{ data_dir: adopted \}\)/)
  assert.match(main, /if \(adoptOwnedBackendDataDir\(runtime\)\) return true/)
})

test('desktop classifies CDP health and refuses to spawn into an unknown occupied port', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /const \{ probeChromeCdp: probeChromeCdpHealth, prepareChromeRecovery \} = require\('\.\/chromeCdp'\)/)
  assert.match(main, /return probeChromeCdpHealth\(\{ http, port: CDP_PORT, timeoutMs \}\)/)
  assert.match(main, /const launchChrome = createSingleFlightRecovery\(performLaunchChrome\)/)
  assert.match(main, /const recovery = await prepareChromeRecovery\(\{/)
  assert.match(main, /stopManagedChrome: stopManagedChromeForQuit/)
  assert.match(main, /probeCdp: \(\) => probeChromeCdp\(\)/)
  assert.match(main, /if \(recovery\.action === 'blocked'\)/)
  assert.match(main, /Chrome stderr:/)
})

test('desktop renderer exposes backend repair and structured runtime diagnostics', () => {
  const appShell = readRepoFile('app/src/renderer/App.vue')
  const settings = readRepoFile('app/src/renderer/views/SettingsPage.vue')
  const scriptList = readRepoFile('app/src/renderer/views/ScriptList.vue')

  assert.match(appShell, /apiDiagnostic: \{ state: 'starting', lastError: '', launchAttempt: 0 \}/)
  assert.match(appShell, /chromeDiagnostic: \{ kind: 'unknown', message: '' \}/)
  assert.match(appShell, /async function repairCoreService\(\)/)
  assert.match(appShell, /await window\.cs\.restartBackend\(\)/)
  assert.match(appShell, /provide\('repairCoreService', repairCoreService\)/)
  assert.match(settings, /修复核心服务/)
  assert.match(settings, /修复 Chrome 连接/)
  assert.match(settings, /打开诊断日志/)
  assert.match(settings, /props\.status\?\.apiDiagnostic\?\.lastError/)
  assert.match(settings, /props\.status\?\.chromeDiagnostic\?\.message/)
  assert.match(settings, /props\.status\?\.dataDirRecovery\?\.recovered/)
  assert.match(scriptList, /const repairCoreService = inject\('repairCoreService'\)/)
  assert.match(scriptList, /@click="repairAndLoad"/)
})

test('desktop acquires a single-instance lock before starting services', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /const \{ configureSingleInstance \} = require\('\.\/singleInstance'\)/)
  assert.match(main, /configureSingleInstance\(\{/)
  assert.match(main, /getWindow: \(\) => mainWindow/)
  assert.match(main, /createWindow/)
  assert.match(main, /onPrimary: \(\) => \{\s*app\.whenReady\(\)\.then/)
  assert.match(main, /onPrimary:[\s\S]*app\.on\('window-all-closed'/)
  assert.match(main, /onPrimary:[\s\S]*app\.on\('before-quit'/)
})

test('desktop status requires a compatible owned backend, not only an HTTP responder', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /const backendHealth = await getBackendHealth\(\)/)
  assert.match(main, /const backendAvailability = classifyBackendHealth\(backendHealth, isCompatibleBackendRuntime\)/)
  assert.match(main, /api:\s+backendAvailability\.compatible/)
  assert.match(main, /apiReachable:\s+backendAvailability\.reachable/)
})

test('desktop backend receives a resolved writable CRAWSHRIMP_DATA directory', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /function resolveCrawshrimpDataDir\(\)/)
  assert.match(main, /function readDesktopConfig\(\)/)
  assert.match(main, /function writeDesktopConfig\(patch = \{\}\)/)
  assert.match(main, /function resolveConfiguredDataDir\(rawValue = ''\)/)
  assert.match(main, /function getWindowsLocalCrawshrimpDataDir\(\)/)
  assert.match(main, /path\.join\(localAppData, 'crawshrimp'\)/)
  assert.match(main, /function getMacLocalCrawshrimpDataDir\(\)/)
  assert.match(main, /path\.join\(app\.getPath\('appData'\), 'crawshrimp'\)/)
  assert.match(main, /process\.platform === 'darwin'/)
  assert.match(main, /const LEGACY_RUNTIME_MARKERS = \[/)
  assert.match(main, /function hasLegacyRuntimeData\(dirPath\)/)
  assert.match(main, /if \(hasLegacyRuntimeData\(legacyRoot\)\) return path\.resolve\(legacyRoot\)/)
  assert.match(main, /function readLegacyConfiguredDataDir\(\)/)
  assert.match(main, /function ensureWritableDirectory\(dirPath, label = 'directory'\)/)
  assert.match(main, /function ensureWritableDataDir\(dirPath\)/)
  assert.match(main, /for \(const childName of \['adapters', 'adapter-meta', 'data', 'logs'\]\)/)
  assert.match(main, /function prepareCrawshrimpDataDir\(\)/)
  assert.match(main, /resolvedCrawshrimpDataDir = prepareCrawshrimpDataDir\(\)/)
  assert.match(main, /resolvedCrawshrimpDataDir = getCrawshrimpDataDir\(\)/)
  assert.match(main, /CRAWSHRIMP_DATA: resolvedCrawshrimpDataDir/)
  assert.match(main, /writeDesktopConfig\(\{ data_dir: writable \}\)/)
  assert.match(main, /cfg\.data_dir = desktopDataDir \|\| getCrawshrimpDataDir\(\)/)
  assert.match(main, /plain\.data_dir = dataDir/)
  assert.match(main, /return resolvedCrawshrimpDataDir/)
  assert.match(main, /CRAWSHRIMP_ALLOW_DATA_FALLBACK: '1'/)
  assert.match(main, /\[api\] launch context:/)
})

test('desktop backend startup fails before spawn when API token cannot be prepared', () => {
  const main = readRepoFile('app/src/main.js')
  const apiServer = readRepoFile('core/api_server.py')

  assert.doesNotMatch(main, /catch \(error\) \{\s*log\(`\[api\] failed to prepare API token: \$\{error\.message\}`\)\s*return ''\s*\}/)
  assert.match(main, /const apiToken = getApiToken\(\)/)
  assert.match(main, /CRAWSHRIMP_API_TOKEN: apiToken/)
  assert.match(apiServer, /except Exception as exc:\s*logger\.exception\("Failed to read or create crawshrimp API token"\)\s*raise RuntimeError\("Failed to prepare crawshrimp API token"\) from exc/)
})

test('desktop API helper supports request timeout for shutdown probes', () => {
  const backendApi = readRepoFile('app/src/backendApi.js')

  assert.match(backendApi, /const timeoutMs = Math\.max\(0, Number\(options\.timeoutMs \|\| 0\)\)/)
  assert.match(backendApi, /if \(timeoutMs > 0\) \{\s*req\.setTimeout\(timeoutMs/)
})

test('desktop API helper rejects HTTP error responses with backend detail', () => {
  const main = readRepoFile('app/src/main.js')
  const backendApi = readRepoFile('app/src/backendApi.js')

  assert.match(main, /const \{ requestBackendApi \} = require\('\.\/backendApi'\)/)
  assert.match(main, /function apiCall\(method, urlPath, body = null, options = \{\}\) \{\s*return requestBackendApi\(\{/)
  assert.match(backendApi, /if \(statusCode >= 400\) \{\s*reject\(backendErrorFromResponse\(statusCode, res\.statusMessage, payload\)\)/)
  assert.match(backendApi, /payload\.detail \|\| payload\.error \|\| payload\.message/)
  assert.match(backendApi, /error\.statusCode = statusCode/)
})

test('desktop result data requests do not trigger backend restart readiness flow', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /secureHandle\('get-data',[\s\S]*apiCall\('GET', `\/data\/\$\{aid\}\/\$\{tid\}`, null, \{\s*ensureReady: false,\s*\}\)/)
})

test('desktop quit stop requests log backend rejection details', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /const result = await apiCall\('POST', `\/tasks\/\$\{encodeURIComponent\(adapterId\)\}\/\$\{encodeURIComponent\(taskId\)\}\/stop`, null, \{/)
  assert.match(main, /if \(result && typeof result === 'object' && result\.ok === false\) \{/)
  assert.match(main, /throw new Error\(result\.detail \|\| result\.error \|\| 'backend rejected stop request'\)/)
})

test('desktop quit cancellation handles service recovery failures', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /return ensureDesktopServicesStarted\(\)\.catch\(error => \{/)
  assert.match(main, /log\(`\[lifecycle\] failed to restart services after quit cancellation: \$\{error\.message\}`\)/)
})
