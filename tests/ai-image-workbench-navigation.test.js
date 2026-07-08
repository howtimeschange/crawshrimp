import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

test('App registers AI image route after task center and before data files', () => {
  const app = read('app/src/renderer/App.vue')
  const taskCenter = app.indexOf("id: 'task_center'")
  const aiImage = app.indexOf("id: 'ai_image'")
  const files = app.indexOf("id: 'files'")

  assert.notEqual(taskCenter, -1, 'task center route is missing')
  assert.notEqual(aiImage, -1, 'AI image route is missing')
  assert.notEqual(files, -1, 'data files route is missing')
  assert.ok(taskCenter < aiImage, 'AI image route should follow task center')
  assert.ok(aiImage < files, 'AI image route should precede data files')
  assert.match(app, /label: 'AI 生图'/)
  assert.match(app, /<AiImageWorkbench[\s\S]*@open-settings="openSettingsPanel\('ai-1xm'\)"/)
})

test('App hides global sidebar in AI image focus mode', () => {
  const app = read('app/src/renderer/App.vue')

  assert.match(app, /v-if="currentView !== 'ai_image'"[\s\S]*class="sidebar"/)
  assert.match(app, /:class="\['content', \{ 'content-focus': currentView === 'ai_image' \}\]"/)
  assert.match(app, /\.layout-focus\s*\{[^}]*grid-template-columns:\s*1fr;/s)
})

test('Settings page accepts focus panel id and exposes 1XM image model keys', () => {
  const settings = read('app/src/renderer/views/SettingsPage.vue')

  assert.match(settings, /focusPanelId/)
  assert.match(settings, /watch\(\(\) => props\.focusPanelId/)
  assert.match(settings, /1XM 图片模型/)
  assert.doesNotMatch(settings, /1XM GPT-Image-2/)
  assert.match(settings, /ai\.1xm\.gemini_3_1_flash_image_preview_key/)
  assert.match(settings, /ai\.1xm\.gemini_3_pro_image_preview_key/)
  assert.match(settings, /Gemini 3\.1 Flash Image Preview Key/)
  assert.match(settings, /Gemini 3 Pro Image Preview Key/)
})

test('AI image workbench renders option 3 shell regions and settings action', () => {
  const workbench = read('app/src/renderer/views/AiImageWorkbench.vue')

  assert.match(workbench, /class="aiw-workbench aiw-option-3"/)
  assert.match(workbench, /class="aiw-param-ribbon"/)
  assert.match(workbench, /class="aiw-prompt-panel"/)
  assert.match(workbench, /class="aiw-results-grid"/)
  assert.match(workbench, /class="aiw-history-drawer"/)
  assert.match(workbench, /class="aiw-generate-footer"/)
  assert.match(workbench, /本地 1XM 图片模型工作台/)
  assert.match(workbench, /去设置 1XM Key/)
  assert.match(workbench, /defineEmits\(\['open-settings'\]\)/)
})
