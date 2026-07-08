import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8')
}

test('settings page contains cloud approval operational settings group', () => {
  const source = read('app/src/renderer/views/SettingsPage.vue')

  for (const text of ['云端审批', '云端地址', '注册 token', '任务机名称', '任务能力', '启用任务机']) {
    assert.match(source, new RegExp(text))
  }
  assert.match(source, /cloud_approval\.capabilities/)
  assert.match(source, /generate_ai_image/)
  assert.match(source, /regenerate_ai_image/)
  assert.match(source, /submit_tmall_material_test/)
  assert.match(source, /saveCloudApprovalConfig\(cloudConfigPayload\(\)\)/)
  assert.match(source, /enrollCloudMachine\(\{[\s\S]*capabilities: selectedCloudCapabilities\(\)/)
  for (const method of ['getCloudApprovalStatus', 'saveCloudApprovalConfig', 'enrollCloudMachine', 'startCloudMachine', 'stopCloudMachine']) {
    assert.match(source, new RegExp(method))
  }
  assert.doesNotMatch(source, /machine_token/)
})

test('cloud approval nav item is gated by safe cloud approval status', () => {
  const appSource = read('app/src/renderer/App.vue')
  const frameSource = read('app/src/renderer/views/CloudApprovalFrame.vue')

  assert.match(appSource, /云端审批/)
  assert.match(appSource, /CloudApprovalFrame/)
  assert.match(appSource, /getCloudApprovalStatus/)
  assert.match(appSource, /filteredNavItems/)
  assert.match(appSource, /cloudApprovalConfigured/)
  assert.match(appSource, /currentView\.value === 'cloud_approval'/)
  assert.match(appSource, /currentView\.value = 'settings'/)
  assert.doesNotMatch(appSource, /machine_token/)
  assert.match(frameSource, /getCloudApprovalStatus/)
  assert.match(frameSource, /iframe/)
  assert.doesNotMatch(frameSource, /machine_token/)
})
