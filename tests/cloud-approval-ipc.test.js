import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8')
}

const METHODS = [
  ['getCloudApprovalStatus', 'get-cloud-approval-status', 'GET', '/cloud-approval/status'],
  ['saveCloudApprovalConfig', 'save-cloud-approval-config', 'POST', '/cloud-approval/config'],
  ['enrollCloudMachine', 'enroll-cloud-machine', 'POST', '/cloud-approval/enroll-machine'],
  ['startCloudMachine', 'start-cloud-machine', 'POST', '/cloud-approval/machine/start'],
  ['stopCloudMachine', 'stop-cloud-machine', 'POST', '/cloud-approval/machine/stop'],
  ['syncCloudApprovalBatch', 'sync-cloud-approval-batch', 'POST', '/cloud-approval/sync-batch'],
  ['listCloudPromptLibraries', 'list-cloud-prompt-libraries', 'GET', '/cloud-approval/prompt-libraries'],
]

test('main process exposes cloud approval IPC handlers to local API routes', () => {
  const source = read('app/src/main.js')

  for (const [_method, channel, verb, route] of METHODS) {
    assert.match(source, new RegExp(`secureHandle\\('${channel}'`))
    assert.match(source, new RegExp(`apiCall\\('${verb}', '${route.replaceAll('/', '\\/')}`))
  }
})

test('cloud prompt template IPC includes library-scoped resolved route', () => {
  const main = read('app/src/main.js')
  const preload = read('app/src/preload.js')
  const devBridge = read('app/src/renderer/utils/devCsBridge.js')

  assert.match(main, /secureHandle\('resolve-cloud-prompt-templates'/)
  assert.match(main, /\/cloud-approval\/prompt-libraries\/\$\{encodeURIComponent\(String\(libraryId \|\| ''\)\)\}\/resolved/)
  assert.match(preload, /resolveCloudPromptTemplates:/)
  assert.match(preload, /ipcRenderer\.invoke\('resolve-cloud-prompt-templates'/)
  assert.match(devBridge, /resolveCloudPromptTemplates:/)
  assert.match(devBridge, /\/cloud-approval\/prompt-libraries\/\$\{encodePathPart\(libraryId\)\}\/resolved/)
})

test('preload exposes cloud approval methods on window.cs', () => {
  const source = read('app/src/preload.js')

  for (const [method, channel] of METHODS) {
    assert.match(source, new RegExp(`${method}:`))
    assert.match(source, new RegExp(`ipcRenderer\\.invoke\\('${channel}'`))
  }
})

test('browser dev bridge exposes cloud approval methods with API fallback routes', () => {
  const source = read('app/src/renderer/utils/devCsBridge.js')

  for (const [method, _channel, verb, route] of METHODS) {
    assert.match(source, new RegExp(`${method}:`))
    assert.match(source, new RegExp(`apiCall\\('${verb}', '${route.replaceAll('/', '\\/')}`))
  }
})
