import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const readRendererFile = relativePath => readFileSync(
  new URL(`../${relativePath}`, import.meta.url),
  'utf8',
)

const cssRule = (source, selector) => source.match(
  new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`),
)?.[0] || ''

const cssRules = (source, selector) => Array.from(source.matchAll(
  new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`, 'g'),
), match => match[0])

const rendererSourceFiles = (directoryUrl = new URL('../', import.meta.url)) => readdirSync(
  directoryUrl,
  { withFileTypes: true },
).flatMap(entry => {
  const entryUrl = new URL(entry.name, directoryUrl)
  if (entry.isDirectory()) return rendererSourceFiles(new URL(`${entry.name}/`, directoryUrl))
  return /\.(?:vue|css|html)$/.test(entry.name) ? [entryUrl] : []
})

test('light theme uses Taobao orange with a separate accessible text tone', () => {
  const source = readRendererFile('App.vue')
  const lightThemeRule = cssRule(source, ':root[data-theme="light"]')

  assert.match(lightThemeRule, /--orange-rgb:\s*255,\s*80,\s*0;/)
  assert.match(lightThemeRule, /--orange:\s*#FF5000;/i)
  assert.match(lightThemeRule, /--orange-text:\s*#BD3C00;/i)
  assert.match(lightThemeRule, /--orange-hover:\s*#E94700;/i)
  assert.match(lightThemeRule, /--text3:\s*#626470;/i)
})

test('renderer accents use theme-aware orange channels instead of legacy fixed coral', () => {
  for (const fileUrl of rendererSourceFiles()) {
    const source = readFileSync(fileUrl, 'utf8')
    assert.doesNotMatch(
      source,
      /rgba\(\s*255\s*,\s*107\s*,\s*43\s*,/i,
      `${fileUrl.pathname} still hardcodes the legacy orange channel`,
    )
  }
})

test('AI image upload tiles use theme surfaces instead of a fixed dark background', () => {
  const source = readRendererFile('views/AiImageWorkbench.vue')
  const uploadTileRule = source.match(/\.aiw-upload-tile\s*\{[\s\S]*?\}/)?.[0] || ''

  assert.match(uploadTileRule, /background:\s*var\(--bg3\);/)
  assert.doesNotMatch(uploadTileRule, /#17181d/i)
})

test('AI image batch dialog keeps every interactive column on theme surfaces', () => {
  const source = readRendererFile('views/AiImageWorkbench.vue')

  assert.match(cssRule(source, '.aiw-batch-source-column'), /background:\s*var\(--bg3\);/)
  assert.equal(
    cssRules(source, '.aiw-batch-prompt-card').some(rule => /background:\s*var\(--bg2\);/.test(rule)),
    true,
  )
  assert.match(cssRule(source, '.aiw-batch-add-card'), /background:\s*var\(--bg3\);/)
})

test('AI image primary actions use the bright brand tone instead of the pressed tone', () => {
  const source = readRendererFile('views/AiImageWorkbench.vue')
  const primaryRules = source.match(
    /\.aiw-primary-action,\s*\.aiw-top-primary\s*\{[\s\S]*?\}/,
  )?.[0] || ''
  const topPrimaryRule = cssRule(source, '.aiw-top-primary')

  assert.match(primaryRules, /background:\s*var\(--orange\);/)
  assert.doesNotMatch(primaryRules, /background:\s*var\(--orange-strong\);/)
  assert.match(topPrimaryRule, /background:\s*var\(--orange\);/)
})

test('AI video material inputs and directory picker use semantic theme surfaces', () => {
  const source = readRendererFile('views/AiVideoWorkflow.vue')
  const materialFieldRule = source.match(
    /\.aiv-material-stage \.aiv-field input,\s*\.aiv-material-stage \.aiv-field textarea\s*\{[\s\S]*?\}/,
  )?.[0] || ''
  const directoryRule = source.match(
    /\.aiv-material-stage \.aiv-directory-picker,\s*\.aiv-material-stage \.aiv-progress-overview\s*\{[\s\S]*?\}/,
  )?.[0] || ''

  assert.match(materialFieldRule, /background:\s*var\(--bg\);/)
  assert.match(materialFieldRule, /border-color:\s*var\(--border\);/)
  assert.match(directoryRule, /background:\s*var\(--bg\);/)
  assert.match(directoryRule, /border-color:\s*var\(--border\);/)
  assert.match(
    cssRule(source, '.aiv-material-stage .aiv-material-source-tabs'),
    /background:\s*var\(--bg2\);/,
  )
  assert.match(
    cssRule(source, '.aiv-material-stage .aiv-material-source-tabs'),
    /border-color:\s*var\(--border\);/,
  )
})

test('prompt and material picker surfaces do not reintroduce fixed dark panels', () => {
  const promptSource = readRendererFile('components/PromptLibraryPickerModal.vue')
  const videoSource = readRendererFile('views/AiVideoWorkflow.vue')

  assert.match(cssRule(promptSource, '.prompt-library-template-row'), /background:\s*var\(--bg3\);/)
  assert.match(cssRule(videoSource, '.aiv-picker-modal-panel .aiv-modal-foot'), /background:\s*var\(--soft-fill\);/)
  assert.match(cssRule(videoSource, '.aiv-modal-body.model-library'), /background:\s*var\(--soft-fill\);/)
})

test('light theme neutral badges use semantic text colors instead of fixed pale text', () => {
  const promptSource = readRendererFile('views/LocalPromptLibrary.vue')
  const cloudSource = readRendererFile('views/CloudApprovalFrame.vue')

  assert.match(cssRule(promptSource, '.lpl-source-badge'), /color:\s*var\(--text2\);/)
  assert.match(cssRule(cloudSource, '.pill.neutral'), /color:\s*var\(--text2\);/)
})

test('collapsed update tooltip keeps readable contrast in both themes', () => {
  const source = readRendererFile('components/SidebarUpdateFooter.vue')
  const tooltipRule = cssRule(source, '.collapsed .update-control::after')

  assert.match(tooltipRule, /background:\s*var\(--tooltip-bg\);/)
  assert.match(tooltipRule, /color:\s*#f7f7fa;/)
  assert.doesNotMatch(tooltipRule, /color:\s*var\(--text\);/)
})

test('settings default model select shares the complete themed field treatment', () => {
  const source = readRendererFile('views/SettingsPage.vue')

  assert.match(source, /\.input,\s*\.select\s*\{[\s\S]*?background:\s*var\(--bg\);[\s\S]*?border:\s*1px solid var\(--border\);/)
  assert.match(source, /\.input:focus,\s*\.select:focus\s*\{[\s\S]*?border-color:\s*var\(--orange\);/)
})

test('task output dock uses a lighter light-theme surface and restrained controls', () => {
  const appSource = readRendererFile('App.vue')
  const runnerSource = readRendererFile('views/TaskRunner.vue')
  const drawerSource = readRendererFile('views/TaskOutputDrawer.vue')
  const lightThemeRule = cssRule(appSource, ':root[data-theme="light"]')

  assert.match(lightThemeRule, /--dock-bg:\s*#f2f2f4;/i)
  assert.match(cssRule(runnerSource, '.runner-bottom-stack'), /background:\s*var\(--dock-bg\);/)
  assert.match(
    drawerSource,
    /\.task-output-tabs button,\s*\.task-output-actions button\s*\{[\s\S]*?background:\s*var\(--soft-fill\);/,
  )
  assert.match(drawerSource, /border-color:\s*rgba\(var\(--orange-rgb\), \.48\);/)
})

test('system theme copy is operating-system neutral for macOS and Windows', () => {
  const source = readRendererFile('views/SettingsPage.vue')

  assert.match(source, /跟随操作系统外观自动切换/)
  assert.match(source, /description:\s*'跟随 macOS \/ Windows'/)
  assert.doesNotMatch(source, /随 macOS 外观自动切换/)
})

test('legacy renderer surfaces remain safe if they are re-enabled', () => {
  for (const relativePath of [
    'views/SettingsView.vue',
    'views/PlatformManager.vue',
    'views/TaskDashboard.vue',
    'views/DataExplorer.vue',
  ]) {
    const source = readRendererFile(relativePath)

    assert.doesNotMatch(source, /background:\s*#0f1117/i)
    assert.doesNotMatch(source, /color:\s*#e2e8f0/i)
    assert.match(source, /color:\s*var\(--text\);/)
  }

  for (const relativePath of ['views/SettingsView.vue', 'views/PlatformManager.vue']) {
    assert.match(readRendererFile(relativePath), /background:\s*var\(--bg\);/)
  }
})
