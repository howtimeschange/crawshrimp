import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { loadLocalPromptLibraryViewSources } from '../app/src/renderer/utils/localPromptLibraryViewState.js'

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
  assert.doesNotMatch(view, /resolveCloudPromptTemplates/)
  assert.match(view, /selectedCloudLibrary\.value\.templates/)
  assert.match(view, /const localLibraries = ref\(\[\]\)/)
  assert.match(view, /const cloudLibraries = ref\(\[\]\)/)
  assert.match(view, /const libraries = computed/)
  assert.match(view, /selectedLocalLibrary/)
  assert.match(view, /selectedCloudLibrary/)
  assert.match(view, /librarySourceLabel/)
  assert.match(view, /source_type/)
  assert.match(view, /cloudPromptLibraryNotice\(err, options\)/)
  assert.match(view, /cloudError\.value = options\.silent \? ''/)
})

test('Shared Prompt picker reads draft cloud templates from the library list payload', () => {
  const picker = read('app/src/renderer/components/PromptLibraryPickerModal.vue')

  assert.match(picker, /buildPromptLibraryPickerLibraries/)
  assert.match(picker, /loadPromptLibraryPickerSources/)
  assert.match(picker, /window\.cs\.listCloudPromptLibraries/)
  assert.doesNotMatch(picker, /window\.cs\.resolveCloudPromptTemplates/)
  assert.match(picker, /selectedLibrary\.templates/)
})

test('Shared Prompt picker publishes local libraries while cloud refresh remains pending', () => {
  const picker = read('app/src/renderer/components/PromptLibraryPickerModal.vue')

  assert.match(picker, /loadPromptLibraryPickerSources\(\{[\s\S]*onLocal:/)
  assert.match(picker, /applyPromptLibrarySources\(localState/)
  assert.match(picker, /loading && !libraries\.length/)
  assert.doesNotMatch(picker, /v-else-if="loading \|\| templatesLoading"/)
})

test('LocalPromptLibrary opens with a library list before entering prompt detail editing', () => {
  const view = read('app/src/renderer/views/LocalPromptLibrary.vue')

  assert.match(view, /const viewMode = ref\('list'\)/)
  assert.match(view, /提示词库列表/)
  assert.match(view, /提示词库名称/)
  assert.match(view, /当前 Prompt 数量/)
  assert.match(view, /创建时间/)
  assert.match(view, /进入编辑/)
  assert.match(view, /enterLibraryDetail/)
  assert.match(view, /backToLibraryList/)
  assert.doesNotMatch(view, /<select v-model="selectedLibraryUid"/)
})

test('LocalPromptLibrary active secondary buttons do not look disabled', () => {
  const view = read('app/src/renderer/views/LocalPromptLibrary.vue')
  const secondaryRule = view.match(/\.lpl-secondary\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  const disabledRule = view.match(/\.lpl-primary:disabled,\n\.lpl-secondary:disabled\s*\{([\s\S]*?)\n\}/)?.[1] || ''

  assert.match(secondaryRule, /color:\s*var\(--text\)/)
  assert.match(secondaryRule, /background:\s*rgba\(255,\s*255,\s*255,\s*\.08\)/)
  assert.match(secondaryRule, /border-color:\s*rgba\(255,\s*255,\s*255,\s*\.18\)/)
  assert.match(secondaryRule, /font-weight:\s*700/)
  assert.match(disabledRule, /opacity:\s*\.55/)
})

test('LocalPromptLibrary confines long Prompt scrolling to the workspace', () => {
  const app = read('app/src/renderer/App.vue')
  const view = read('app/src/renderer/views/LocalPromptLibrary.vue')
  const viewportRule = app.match(/html,\s*body\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  const appRootRule = app.match(/#app\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  const rootRule = view.match(/\.local-prompt-library\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  const workspaceRule = view.match(/\.lpl-workspace\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  const groupsRule = view.match(/\.lpl-groups\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  const panelRule = view.match(/\.lpl-table-panel\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  const listRule = view.match(/\.lpl-edit-list\s*\{([\s\S]*?)\n\}/)?.[1] || ''

  assert.match(viewportRule, /overflow:\s*hidden/)
  assert.match(appRootRule, /position:\s*fixed/)
  assert.match(appRootRule, /inset:\s*0/)
  assert.match(appRootRule, /overflow:\s*hidden/)
  assert.match(rootRule, /overflow:\s*hidden/)
  assert.match(workspaceRule, /grid-template-rows:\s*minmax\(0,\s*1fr\)/)
  assert.match(workspaceRule, /overflow:\s*hidden/)
  assert.match(groupsRule, /min-height:\s*0/)
  assert.match(groupsRule, /overflow-y:\s*auto/)
  assert.match(panelRule, /display:\s*flex/)
  assert.match(panelRule, /flex-direction:\s*column/)
  assert.match(listRule, /flex:\s*1\s+1\s+0/)
  assert.match(listRule, /height:\s*auto/)
  assert.match(listRule, /overscroll-behavior:\s*contain/)
})

test('LocalPromptLibrary publishes local libraries while silent cloud refresh is still pending', async () => {
  let resolveCloud
  const events = []
  const cloudPending = new Promise(resolve => { resolveCloud = resolve })

  const state = await loadLocalPromptLibraryViewSources({
    listLocalPromptLibraries: async () => ({ libraries: [{ library_uid: 'local-1', name: '本地库' }] }),
    loadCloudLibraries: async options => {
      events.push(['cloud-start', options])
      return cloudPending
    },
    onLocalReady: libraries => events.push(['local-ready', libraries.map(library => library.name)]),
  })

  assert.deepEqual(events, [
    ['local-ready', ['本地库']],
    ['cloud-start', { silent: true }],
  ])
  assert.equal(state.localLibraries[0].source_type, 'local')

  resolveCloud({ libraries: [{ id: 7, name: '线上库' }] })
  await state.cloudRefresh
})

test('LocalPromptLibrary keeps local libraries usable when silent cloud refresh fails', async () => {
  const events = []

  const state = await loadLocalPromptLibraryViewSources({
    listLocalPromptLibraries: async () => ({ libraries: [{ library_uid: 'local-1', name: '本地库' }] }),
    loadCloudLibraries: async () => {
      events.push('cloud-start')
      throw new Error('cloud offline')
    },
    onLocalReady: libraries => events.push(`local:${libraries[0].name}`),
  })

  assert.deepEqual(events, ['local:本地库', 'cloud-start'])
  assert.equal(state.localLibraries[0].name, '本地库')
  const cloudResult = await state.cloudRefresh
  assert.equal(cloudResult.ok, false)
  assert.match(cloudResult.error.message, /cloud offline/)
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
