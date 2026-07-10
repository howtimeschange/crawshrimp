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
  assert.match(source, /v-model="cfg\['cloud_approval\.base_url'\]"[\s\S]*readonly/)
  assert.match(source, /getCloudApprovalStatus\(\{ refresh: true \}\)/)
  assert.match(source, /cloudAddressHint/)
  assert.match(source, /正式环境固定地址/)
  assert.match(source, /已检测到本地审批服务/)
  assert.match(source, /未检测到本地审批服务，当前显示默认地址/)

  const payloadBody = source.match(/function cloudConfigPayload\(\) \{([\s\S]*?)\n\}/)?.[1] || ''
  assert.doesNotMatch(payloadBody, /base_url/)
  const cloudPanelFields = source.match(/'cloud-approval': \[([^\]]*)\]/)?.[1] || ''
  assert.doesNotMatch(cloudPanelFields, /base_url/)
  assert.match(source, /cfg\.value\['cloud_approval\.base_url'\] = status\.base_url \|\| ''/)
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
  assert.match(frameSource, /referrerpolicy="no-referrer"/)
  assert.match(frameSource, /allow-downloads/)
  assert.match(frameSource, /allow-modals/)
  assert.doesNotMatch(frameSource, /machine_token/)
})
