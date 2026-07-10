import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync('src/renderer/utils/devCsBridge.js', 'utf8')
const rendererEntry = fs.readFileSync('src/renderer/main.js', 'utf8')

test('dev browser bridge installs only when preload bridge is missing', () => {
  assert.match(source, /window\.cs \|\| !isLocalRenderer\(\)/)
  assert.match(source, /window\.cs = createDevCsBridge\(\)/)
  assert.match(rendererEntry, /installDevCsBridge\(\)/)
})

test('dev browser bridge supports task instances and local API token header', () => {
  assert.match(source, /X-Crawshrimp-Token/)
  assert.match(source, /listTaskInstances/)
  assert.match(source, /createTaskInstance/)
  assert.match(source, /runTaskInstance/)
  assert.match(source, /TOKEN_STORAGE_KEY = 'crawshrimp\.apiToken'/)
  assert.match(source, /API_BASE_STORAGE_KEY = 'crawshrimp\.apiBase'/)
  assert.match(source, /crawshrimp_api_base/)
})

test('dev browser bridge discovers a shifted local API port', () => {
  assert.match(source, /API_PORT_PROBE_RANGE/)
  assert.match(source, /function rememberApiBase/)
  assert.match(source, /function isCrawshrimpHealthPayload/)
  assert.match(source, /async function discoverApiBase/)
  assert.match(source, /\/health\?probe=1/)
  assert.match(source, /isCrawshrimpHealthPayload\(payload\)/)
  assert.match(source, /await discoverApiBase\(initialBase\)/)
  assert.match(source, /return \{ api: false, chrome: false, apiPort: Number\(new URL\(fallbackBase \|\| DEFAULT_API_BASE\)\.port \|\| 18765\)/)
})

test('dev browser bridge exposes disabled no-op desktop updater methods', () => {
  assert.match(source, /function disabledUpdateStatus/)
  assert.match(source, /status: 'disabled'/)
  assert.match(source, /currentVersion: 'dev'/)
  assert.match(source, /error: '浏览器开发模式不会检查桌面更新。'/)
  assert.match(source, /getUpdateStatus: async \(\) => disabledUpdateStatus\(\)/)
  assert.match(source, /checkForUpdates: async \(\) => disabledUpdateStatus\(\)/)
  assert.match(source, /downloadUpdate: async \(\) => disabledUpdateStatus\(\)/)
  assert.match(source, /installUpdate: async \(\) => \(\{ ok: false, error: '浏览器开发模式不能安装桌面更新。' \}\)/)
  assert.match(source, /onUpdateStatus: \(\) => \(\) => \{\}/)
})
