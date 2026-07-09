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
  assert.match(app, /<KeepAlive>[\s\S]*<AiImageWorkbench[\s\S]*v-if="currentView === 'ai_image'"[\s\S]*@open-settings="openSettingsPanel\('ai-1xm'\)"[\s\S]*<\/KeepAlive>/)
  assert.doesNotMatch(app, /<AiImageWorkbench[\s\S]*v-show=/)
})

test('App keeps the global sidebar visible on the AI image page', () => {
  const app = read('app/src/renderer/App.vue')

  assert.doesNotMatch(app, /v-if="currentView !== 'ai_image'"[\s\S]*class="sidebar"/)
  assert.doesNotMatch(app, /layout-focus/)
  assert.doesNotMatch(app, /content-focus/)
  assert.match(app, /<aside class="sidebar">/)
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
  assert.doesNotMatch(workbench, /class="aiw-param-ribbon"/)
  assert.match(workbench, /class="aiw-prompt-panel aiw-task-panel"/)
  assert.match(workbench, /class="aiw-results-grid"/)
  assert.match(workbench, /:aria-busy="generating \? 'true' : 'false'"/)
  assert.match(workbench, /class="aiw-history-drawer"/)
  assert.doesNotMatch(workbench, /class="aiw-generate-footer"/)
  assert.match(workbench, /AI 生图工作台/)
  assert.match(workbench, /支持主图、参考图、Prompt、比例尺寸联动和多模型生成/)
  assert.match(workbench, /outputDirHint\(\)/)
  assert.match(workbench, /点击上传主图/)
  assert.match(workbench, /点击添加参考图/)
  assert.match(workbench, /选择文件夹/)
  assert.match(workbench, /配置模型 Key/)
  assert.doesNotMatch(workbench, /本地 1XM 图片模型工作台/)
  assert.doesNotMatch(workbench, /去设置 1XM Key/)
  assert.doesNotMatch(workbench, /提交 1XM 任务/)
  assert.match(workbench, /defineEmits\(\['open-settings'\]\)/)
})

test('AI image workbench uses picker interactions and hides canvas entry for now', () => {
  const workbench = read('app/src/renderer/views/AiImageWorkbench.vue')

  assert.match(workbench, /historyOpen = ref\(true\)/)
  assert.match(workbench, /STORAGE_KEY = 'crawshrimp\.aiImageWorkbench\.state\.v2'/)
  assert.match(workbench, /restorePersistedWorkbench/)
  assert.match(workbench, /persistWorkbenchState/)
  assert.match(workbench, /scheduleTaskAutosave/)
  assert.match(workbench, /window\.cs\.updateAiImageJob/)
  assert.match(workbench, /createNewTask/)
  assert.match(workbench, /taskRecords/)
  assert.match(workbench, /任务记录/)
  assert.match(workbench, /新建任务/)
  assert.match(workbench, /window\.cs\.browseFile\(opts\)/)
  assert.match(workbench, /chooseMainImage/)
  assert.match(workbench, /chooseReferenceImages/)
  assert.match(workbench, /chooseOutputFolder/)
  assert.match(workbench, /readLocalImagePreview/)
  assert.match(workbench, /imagePreviewSrc\(form\.mainImagePath\)/)
  assert.match(workbench, /aiw-preview-fallback/)
  assert.match(workbench, /visibleResultCards/)
  assert.match(workbench, /aiw-loading-preview/)
  assert.match(workbench, /aiw-wave-flow/)
  assert.match(workbench, /aiw-loading-breathe/)
  assert.doesNotMatch(workbench, /aiw-shimmer/)
  assert.match(workbench, /class="aiw-history-item"/)
  assert.match(workbench, /button:focus-visible/)
  assert.match(workbench, /summary\.image_urls/)
  const generateStart = workbench.indexOf('async function generate()')
  const generateEnd = workbench.indexOf('function normalizeGenerateError', generateStart)
  const generateBody = workbench.slice(generateStart, generateEnd)
  assert.doesNotMatch(generateBody, /currentJob\.value = null/)
  assert.match(workbench, /main_image_path: form\.mainImagePath/)
  assert.match(workbench, /reference_image_paths: \[\.\.\.form\.referenceImagePaths\]/)
  assert.match(workbench, /return item\?\.path \|\| item\?\.url \|\| ''/)
  assert.match(workbench, /本地 AI 生图服务未就绪，请重启抓虾客户端后再试/)
  assert.match(workbench, /runResult && runResult\.ok === false/)
  assert.match(workbench, /runResult\.summary\?\.error/)
  assert.doesNotMatch(workbench, />画布</)
  assert.doesNotMatch(workbench, /sendToCanvas/)
  assert.doesNotMatch(workbench, /createCanvasDocument/)
})

test('AI image workbench maps ratio to compatible size options', () => {
  const workbench = read('app/src/renderer/views/AiImageWorkbench.vue')

  assert.match(workbench, /const sizeOptions = computed\(\(\) => sizesForRatio\(form\.ratio\)\)/)
  assert.match(workbench, /<select v-model="form\.ratio" @change="syncSizeFromRatio">/)
  assert.match(workbench, /<select v-model="form\.size" @change="syncRatioFromSize">/)
  assert.match(workbench, /form\.size = sizeForRatio\(form\.ratio, form\.size, activeModel\.value\.keyTier\)/)
  assert.match(workbench, /form\.ratio = ratioForSize\(form\.size, form\.ratio\)/)
})

test('AI image task records keep history order while highlighting the clicked task', () => {
  const workbench = read('app/src/renderer/views/AiImageWorkbench.vue')
  const taskRecordsStart = workbench.indexOf('const taskRecords = computed')
  const taskRecordsEnd = workbench.indexOf('const summaryLine', taskRecordsStart)
  const taskRecordsBody = workbench.slice(taskRecordsStart, taskRecordsEnd)
  const restoreStart = workbench.indexOf('async function restoreJob(job, options = {})')
  const restoreEnd = workbench.indexOf('function openOutputFolder', restoreStart)
  const restoreBody = workbench.slice(restoreStart, restoreEnd)

  assert.notEqual(taskRecordsStart, -1, 'taskRecords computed should exist')
  assert.ok(
    taskRecordsBody.indexOf('for (const job of jobs.value)') < taskRecordsBody.indexOf('if (currentJob.value?.job_uid && !seen.has(currentJob.value.job_uid))'),
    'taskRecords should preserve jobs.value ordering before adding an unlisted current task',
  )
  assert.doesNotMatch(
    taskRecordsBody,
    /records\.push\(mergeJobWithDraft\(currentJob\.value\)\)[\s\S]*for \(const job of jobs\.value\)/,
    'taskRecords should not move the active task before the history list',
  )
  assert.match(workbench, /const pendingActiveJobUid = ref\(''\)/)
  assert.match(workbench, /const highlightedJobUid = computed\(\(\) => pendingActiveJobUid\.value \|\| activeJobUid\.value\)/)
  assert.match(workbench, /:class="\{ active: highlightedJobUid === job\.job_uid \}"/)
  assert.ok(
    restoreBody.indexOf('pendingActiveJobUid.value = job.job_uid') < restoreBody.indexOf('window.cs.getAiImageJob(job.job_uid)'),
    'clicked task should highlight before detail loading finishes',
  )
  assert.ok(
    restoreBody.indexOf('currentJob.value = detail') < restoreBody.indexOf("pendingActiveJobUid.value = ''"),
    'pending highlight should clear after current task is restored',
  )
})

test('AI image workbench restores history from detail payload before setting current job', () => {
  const workbench = read('app/src/renderer/views/AiImageWorkbench.vue')
  const restoreStart = workbench.indexOf('async function restoreJob(job, options = {})')
  const restoreEnd = workbench.indexOf('function openOutputFolder', restoreStart)
  const restoreBody = workbench.slice(restoreStart, restoreEnd)

  assert.notEqual(restoreStart, -1, 'restoreJob should be async')
  assert.match(restoreBody, /window\.cs\.getAiImageJob\(job\.job_uid\)/)
  assert.ok(
    restoreBody.indexOf('window.cs.getAiImageJob(job.job_uid)') < restoreBody.indexOf('currentJob.value ='),
    'restoreJob should fetch detail before assigning currentJob',
  )
})

test('AI image workbench presents result queues, selectable cards, task thumbnails, and lightbox preview', () => {
  const workbench = read('app/src/renderer/views/AiImageWorkbench.vue')

  assert.match(workbench, /const resultQueues = computed\(\(\) => collectResultQueues\(currentJob\.value\)\)/)
  assert.match(workbench, /const visibleResultQueues = computed/)
  assert.match(workbench, /class="aiw-result-queue"/)
  assert.match(workbench, /queuePromptLine\(queue\)/)
  assert.match(workbench, /@click="toggleResult\(item\)"/)
  assert.match(workbench, /@click\.stop="openLightbox\(item\)"/)
  assert.match(workbench, /selectAllVisibleResults/)
  assert.match(workbench, /allVisibleSelected/)
  assert.match(workbench, /class="aiw-history-thumbs"/)
  assert.match(workbench, /taskPreviewItems\(job\)/)
  assert.match(workbench, /const lightboxItem = ref\(null\)/)
  assert.match(workbench, /class="aiw-lightbox"/)
  assert.match(workbench, /function collectResultQueues\(job\)/)
  assert.match(workbench, /summary\.runs/)
})
