import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

test('App registers local prompt library menu below AI image and before data files', () => {
  const app = read('app/src/renderer/App.vue')
  const aiImage = app.indexOf("id: 'ai_image'")
  const promptLibrary = app.indexOf("id: 'local_prompt_library'")
  const files = app.indexOf("id: 'files'")

  assert.notEqual(promptLibrary, -1, 'local prompt library route is missing')
  assert.ok(aiImage < promptLibrary, 'prompt library should sit below AI image in the sidebar')
  assert.ok(promptLibrary < files, 'prompt library should sit above data files in the sidebar')
  assert.match(app, /label: '提示词库'/)
  assert.match(app, /<LocalPromptLibrary\s+v-if="currentView === 'local_prompt_library'"[\s\S]*@open-cloud-approval="currentView = 'cloud_approval'"/)
})

test('LocalPromptLibrary view supports import update, manual edit, and cloud sync', () => {
  const view = read('app/src/renderer/views/LocalPromptLibrary.vue')

  assert.match(view, /导入更新/)
  assert.match(view, /保存编辑/)
  assert.match(view, /同步到线上/)
  assert.match(view, /browseFile\(\{[\s\S]*excel:\s*true/)
  assert.match(view, /PROMPT_IMPORT_HEADER_ROWS/)
  assert.match(view, /readPromptWorkbookTemplates/)
  assert.match(view, /readExcel\(selected,[\s\S]*header_row:\s*headerRow/)
  assert.match(view, /parsePromptWorkbookImportCandidates/)
  assert.match(view, /importLocalPromptLibrary/)
  assert.match(view, /saveLocalPromptLibrary/)
  assert.match(view, /syncLocalPromptLibraryToCloud/)
})

test('LocalPromptLibrary view combines local and cloud prompt libraries with source-aware actions', () => {
  const view = read('app/src/renderer/views/LocalPromptLibrary.vue')

  assert.match(view, /登录云端审批平台/)
  assert.match(view, /刷新线上/)
  assert.match(view, /打开云端 Prompt 管理/)
  assert.match(view, /保存为本地副本/)
  assert.match(view, /getCloudApprovalStatus/)
  assert.match(view, /listCloudPromptLibraries/)
  assert.match(view, /resolveCloudPromptTemplates/)
  assert.match(view, /const localLibraries = ref\(\[\]\)/)
  assert.match(view, /const cloudLibraries = ref\(\[\]\)/)
  assert.match(view, /const libraries = computed/)
  assert.match(view, /selectedLocalLibrary/)
  assert.match(view, /selectedCloudLibrary/)
  assert.match(view, /librarySourceLabel/)
  assert.match(view, /source_type/)
})

test('Electron bridges expose local prompt library persistence and cloud sync IPC', () => {
  const preload = read('app/src/preload.js')
  const main = read('app/src/main.js')
  const devBridge = read('app/src/renderer/utils/devCsBridge.js')

  for (const source of [preload, devBridge]) {
    assert.match(source, /listLocalPromptLibraries/)
    assert.match(source, /createLocalPromptLibrary/)
    assert.match(source, /importLocalPromptLibrary/)
    assert.match(source, /saveLocalPromptLibrary/)
    assert.match(source, /syncLocalPromptLibraryToCloud/)
  }

  for (const channel of [
    'list-local-prompt-libraries',
    'create-local-prompt-library',
    'import-local-prompt-library',
    'save-local-prompt-library',
    'sync-local-prompt-library-to-cloud',
  ]) {
    assert.match(main, new RegExp(`secureHandle\\('${channel}'`))
  }
  assert.match(main, /local-prompt-libraries\.json/)
  assert.match(main, /session\.defaultSession\.cookies\.get/)
  assert.match(main, /\/api\/prompt-libraries\/import/)
})

test('Preload local prompt library APIs tolerate a renderer updated before main process restart', () => {
  const preload = read('app/src/preload.js')

  assert.match(preload, /LOCAL_PROMPT_LIBRARY_FALLBACK_STORAGE_KEY/)
  assert.match(preload, /listLocalPromptLibraries:[\s\S]*invokeWithApiFallback\('list-local-prompt-libraries'/)
  assert.match(preload, /createLocalPromptLibrary:[\s\S]*invokeWithApiFallback\('create-local-prompt-library'/)
  assert.match(preload, /importLocalPromptLibrary:[\s\S]*invokeWithApiFallback\('import-local-prompt-library'/)
  assert.match(preload, /saveLocalPromptLibrary:[\s\S]*invokeWithApiFallback\('save-local-prompt-library'/)
  assert.match(preload, /syncLocalPromptLibraryToCloud:[\s\S]*invokeWithApiFallback\('sync-local-prompt-library-to-cloud'/)
  assert.match(preload, /请重启抓虾客户端后再同步线上提示词库/)
})
