const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')

const app = fs.readFileSync('app/src/renderer/App.vue', 'utf8')
const workbench = fs.readFileSync('app/src/renderer/views/AiImageWorkbench.vue', 'utf8')

test('AI image app shell moves global navigation to a compact bottom bar on narrow windows', () => {
  const rootClassBinding = app.match(/<div\s+class="layout"\s+:class="(\{[\s\S]*?\})"\s*>/)?.[1]
  assert.ok(rootClassBinding, 'root layout should bind a class object')
  assert.match(rootClassBinding, /'layout-ai-image'\s*:\s*currentView\s*===\s*'ai_image'/)
  assert.match(rootClassBinding, /'sidebar-collapsed'\s*:\s*effectiveSidebarCollapsed/)
  assert.match(app, /:aria-label="item\.label"/)
  assert.match(app, /:title="item\.label"/)
  assert.match(app, /@media \(max-width: 760px\)[\s\S]*\.layout\.layout-ai-image[\s\S]*grid-template-rows:\s*40px minmax\(0, 1fr\) 56px;/)
  assert.match(app, /\.layout-ai-image \.sidebar[\s\S]*grid-row:\s*3;/)
  assert.match(app, /\.layout-ai-image nav[\s\S]*flex-direction:\s*row;/)
})

test('AI image workbench switches between input and result panes instead of stacking a broken narrow layout', () => {
  assert.match(workbench, /const compactPane = ref\('inputs'\)/)
  assert.match(workbench, /const narrowWorkbench = ref\(false\)/)
  assert.match(workbench, /const taskSidebarToggleActive = computed\(\(\) => narrowWorkbench\.value \? compactPane\.value === 'history' : taskSidebarOpen\.value\)/)
  assert.match(workbench, /class="aiw-compact-tabs"/)
  assert.match(workbench, /@click="compactPane = 'inputs'"/)
  assert.match(workbench, /@click="compactPane = 'results'"/)
  assert.match(workbench, /:class="`compact-\$\{compactPane\}`"/)
  assert.match(workbench, /@media \(max-width: 1060px\)[\s\S]*\.aiw-main-grid\.compact-inputs \.aiw-results-grid[\s\S]*display:\s*none;/)
  assert.match(workbench, /@media \(max-width: 1060px\)[\s\S]*\.aiw-main-grid\.compact-results \.aiw-prompt-panel[\s\S]*display:\s*none;/)
  assert.match(workbench, /async function selectTaskRecord\(job\)[\s\S]*if \(narrowWorkbench\.value\) compactPane\.value = 'results'/)
})

test('narrow batch, history, lightbox, and touch controls remain reachable', () => {
  assert.match(workbench, /@media \(max-width: 760px\)[\s\S]*\.aiw-batch-prompt-rail[\s\S]*grid-auto-flow:\s*row;/)
  assert.match(workbench, /@media \(max-width: 760px\)[\s\S]*\.aiw-history-sidebar[\s\S]*position:\s*absolute;/)
  assert.match(workbench, /@media \(max-width: 760px\)[\s\S]*\.aiw-lightbox-annotation-toolbar[\s\S]*overflow-x:\s*auto;/)
  assert.match(workbench, /@media \(pointer: coarse\)[\s\S]*min-height:\s*44px;/)
  assert.match(workbench, /@media \(pointer: coarse\)[\s\S]*\.aiw-annotation-color-button[\s\S]*width:\s*44px;[\s\S]*height:\s*44px;/)
})
