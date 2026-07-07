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
]

test('main process exposes cloud approval IPC handlers to local API routes', () => {
  const source = read('app/src/main.js')

  for (const [_method, channel, verb, route] of METHODS) {
    assert.match(source, new RegExp(`secureHandle\\('${channel}'`))
    assert.match(source, new RegExp(`apiCall\\('${verb}', '${route.replaceAll('/', '\\/')}`))
  }
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
