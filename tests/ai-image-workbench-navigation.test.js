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
  assert.match(workbench, /class="aiw-task-records-workspace"/)
  assert.doesNotMatch(workbench, /class="aiw-generate-footer"/)
  assert.match(workbench, /AI 生图工作台/)
  assert.match(workbench, /支持主图、参考图、Prompt、比例尺寸联动和多模型生成/)
  assert.match(workbench, /outputDirHint\(\)/)
  assert.match(workbench, /点击上传主图/)
  assert.match(workbench, /点击添加参考图/)
  assert.match(workbench, /选择文件夹/)
  assert.match(workbench, /<AiwIcon name="settings" \/>配置/)
  assert.doesNotMatch(workbench, /配置模型 Key/)
  assert.doesNotMatch(workbench, /本地 1XM 图片模型工作台/)
  assert.doesNotMatch(workbench, /去设置 1XM Key/)
  assert.doesNotMatch(workbench, /提交 1XM 任务/)
  assert.match(workbench, /defineEmits\(\['open-settings'\]\)/)
})

test('AI image workbench uses picker interactions and hides canvas entry for now', () => {
  const workbench = read('app/src/renderer/views/AiImageWorkbench.vue')

  assert.match(workbench, /workspaceMode = ref\('results'\)/)
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
  assert.match(workbench, /return item\?\.url \|\| item\?\.path \|\| ''/)
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
  assert.match(workbench, /queuePromptPreview\(queue\)/)
  assert.match(workbench, /openPromptDialog\(queue\)/)
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

test('AI image workbench isolates generated prompts from draft edits', () => {
  const workbench = read('app/src/renderer/views/AiImageWorkbench.vue')
  const taskRecordsStart = workbench.indexOf('const taskRecords = computed')
  const taskRecordsEnd = workbench.indexOf('const summaryLine', taskRecordsStart)
  const taskRecordsBody = workbench.slice(taskRecordsStart, taskRecordsEnd)
  const restoreStart = workbench.indexOf('async function restoreJob(job, options = {})')
  const restoreEnd = workbench.indexOf('function openOutputFolder', restoreStart)
  const restoreBody = workbench.slice(restoreStart, restoreEnd)

  assert.match(workbench, /function hasGeneratedResults\(job = \{\}\)/)
  assert.match(workbench, /if \(!options\.includeGeneratedDrafts && hasGeneratedResults\(job\)\) return job/)
  assert.match(taskRecordsBody, /mergeJobWithDraft\(source, \{ includeGeneratedDrafts: false \}\)/)
  assert.match(taskRecordsBody, /mergeJobWithDraft\(currentJob\.value, \{ includeGeneratedDrafts: false \}\)/)
  assert.match(restoreBody, /const formDetail = mergeJobWithDraft\(detail, \{ includeGeneratedDrafts: true \}\)/)
  assert.match(restoreBody, /currentJob\.value = detail/)
})

test('AI image workbench saves current count before provider request', () => {
  const workbench = read('app/src/renderer/views/AiImageWorkbench.vue')
  const buildPayloadStart = workbench.indexOf('function buildJobPayload')
  const buildPayloadEnd = workbench.indexOf('function scheduleTaskAutosave', buildPayloadStart)
  const buildPayloadBody = workbench.slice(buildPayloadStart, buildPayloadEnd)
  const ensureStart = workbench.indexOf('async function ensureCurrentTask()')
  const ensureEnd = workbench.indexOf('async function createTaskFromCurrentForm', ensureStart)
  const ensureBody = workbench.slice(ensureStart, ensureEnd)
  const autosaveStart = workbench.indexOf('async function autosaveCurrentTask')
  const autosaveEnd = workbench.indexOf('function upsertJob', autosaveStart)
  const autosaveBody = workbench.slice(autosaveStart, autosaveEnd)

  assert.match(workbench, /function normalizeImageCount\(value\)/)
  assert.match(buildPayloadBody, /const requestedCount = normalizeImageCount\(form\.count\)/)
  assert.ok(
    buildPayloadBody.indexOf('...parseAdvancedJson') < buildPayloadBody.indexOf('n: requestedCount'),
    'advanced JSON must not override the count control',
  )
  assert.match(buildPayloadBody, /params\.n = requestedCount/)
  assert.match(autosaveBody, /if \(!options\.allowDuringGeneration && generating\.value\) return null/)
  assert.match(autosaveBody, /if \(!options\.force && hasGeneratedResults\(currentJob\.value\)\) return null/)
  assert.match(ensureBody, /autosaveCurrentTask\(\{ force: true, allowDuringGeneration: true \}\)/)
})

test('AI image workbench exposes a clear clickable full prompt affordance', () => {
  const workbench = read('app/src/renderer/views/AiImageWorkbench.vue')
  const promptRowStart = workbench.indexOf('class="aiw-result-prompt-row"')
  const promptRowEnd = workbench.indexOf('</div>', promptRowStart)
  const promptRowBody = workbench.slice(promptRowStart, promptRowEnd)

  assert.match(workbench, /const promptDialogQueue = ref\(null\)/)
  assert.match(workbench, /const promptDialogPrompt = computed\(\(\) => queuePromptText\(promptDialogQueue\.value\)\)/)
  assert.match(workbench, /class="aiw-result-prompt-row"/)
  assert.match(promptRowBody, /class="aiw-prompt-preview-button"/)
  assert.match(promptRowBody, /@click="openPromptDialog\(queue\)"/)
  assert.match(promptRowBody, /查看完整/)
  assert.match(promptRowBody, /<AiwIcon name="eye"/)
  assert.doesNotMatch(promptRowBody, /shouldShowPromptDialog\(queue\)/)
  assert.match(workbench, /class="aiw-prompt-dialog"/)
  assert.match(workbench, /role="dialog" aria-modal="true" aria-label="完整 Prompt"/)
  assert.match(workbench, /function queuePromptPreview\(queue = \{\}\)/)
  assert.match(workbench, /function openPromptDialog\(queue\)/)
  assert.match(workbench, /function closePromptDialog\(\)/)
})

test('AI image workbench falls back from broken local output files to remote result URLs', () => {
  const workbench = read('app/src/renderer/views/AiImageWorkbench.vue')

  assert.match(workbench, /function resultPreviewCandidates\(item\)/)
  assert.match(workbench, /return \[item\?\.url, item\?\.path\]/)
  assert.match(workbench, /function resultPreviewSrc\(item\)/)
  assert.match(workbench, /function markResultPreviewBroken\(item\)/)
  assert.match(workbench, /resultPreviewCandidates\(item\)\.forEach/)
  assert.match(workbench, /:src="resultPreviewSrc\(item\)"/)
  assert.match(workbench, /@error="markResultPreviewBroken\(item\)"/)
})

test('AI image workbench materializes URL results before using them as input images', () => {
  const workbench = read('app/src/renderer/views/AiImageWorkbench.vue')
  const materializeStart = workbench.indexOf('async function materializeResultForInput(item)')
  const materializeEnd = workbench.indexOf('async function saveAs(items)', materializeStart)
  const materializeBody = workbench.slice(materializeStart, materializeEnd)
  const setAsMainStart = workbench.indexOf('async function setAsMain(item)')
  const setAsMainEnd = workbench.indexOf('async function addAsReference(item)', setAsMainStart)
  const setAsMainBody = workbench.slice(setAsMainStart, setAsMainEnd)
  const addRefStart = workbench.indexOf('async function addAsReference(item)')
  const addRefEnd = workbench.indexOf('function removeReferencePath', addRefStart)
  const addRefBody = workbench.slice(addRefStart, addRefEnd)

  assert.notEqual(materializeStart, -1, 'materializeResultForInput should exist')
  assert.match(materializeBody, /window\.cs\.materializeAiImageResult/)
  assert.match(materializeBody, /currentJob\.value\?\.job_uid/)
  assert.match(materializeBody, /file: resultKey\(item\)/)
  assert.match(materializeBody, /return result\?\.path \|\| item\?\.path \|\| ''/)
  assert.match(setAsMainBody, /const key = await materializeResultForInput\(item\)/)
  assert.match(addRefBody, /const key = await materializeResultForInput\(item\)/)
  assert.doesNotMatch(setAsMainBody, /form\.mainImagePath = resultKey\(item\)/)
  assert.doesNotMatch(addRefBody, /form\.referenceImagePaths\.push\(resultKey\(item\)\)/)
})

test('AI image workbench recreates stale persisted jobs before running', () => {
  const workbench = read('app/src/renderer/views/AiImageWorkbench.vue')

  assert.match(workbench, /function isAiImageJobNotFoundError\(error\)/)
  assert.match(workbench, /function forgetStaleJob\(jobUid\)/)
  assert.match(workbench, /const existing = await window\.cs\.getAiImageJob\(currentJob\.value\.job_uid\)/)
  assert.match(workbench, /if \(!isAiImageJobNotFoundError\(error\)\) throw error/)
  assert.match(workbench, /const created = await createTaskFromCurrentForm\('draft'\)/)
  assert.match(workbench, /当前任务记录不存在，请重新新建任务后再生成/)
})

test('AI image workbench keeps result card actions and metadata compact', () => {
  const workbench = read('app/src/renderer/views/AiImageWorkbench.vue')
  const cardActionsStart = workbench.indexOf('class="aiw-result-card-actions"')
  const cardActionsEnd = workbench.indexOf('</div>', cardActionsStart)
  const cardActionsBody = workbench.slice(cardActionsStart, cardActionsEnd)

  assert.match(workbench, /class="aiw-result-card-meta"/)
  assert.match(workbench, /class="aiw-result-card-actions"/)
  assert.ok(
    cardActionsBody.indexOf('设为主图') < cardActionsBody.indexOf('设为参考')
      && cardActionsBody.indexOf('设为参考') < cardActionsBody.indexOf('下载'),
    'result card actions should be ordered as set main, set reference, download',
  )
  assert.match(cardActionsBody, /<AiwIcon name="image"/)
  assert.match(cardActionsBody, /<AiwIcon name="plus"/)
  assert.match(cardActionsBody, /<AiwIcon name="download"/)
  assert.doesNotMatch(workbench, />加入参考图</)
  assert.doesNotMatch(workbench, />另存为<\/button>/)
  assert.match(workbench, /\.aiw-result-card-actions\s*\{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
  assert.match(workbench, /\.aiw-result-card-meta\s*\{[\s\S]*flex-direction: row/)
  assert.match(workbench, /const AiwIcon =/)
  assert.match(workbench, /\.aiw-button-icon\s*\{[\s\S]*width: 14px/)
  assert.match(workbench, /\.aiw-icon-button-content\s*\{[\s\S]*display: inline-flex/)
})

test('AI image workbench uses icons on primary page actions', () => {
  const workbench = read('app/src/renderer/views/AiImageWorkbench.vue')
  const topActionsStart = workbench.indexOf('class="aiw-top-actions"')
  const topActionsEnd = workbench.indexOf('</div>', topActionsStart)
  const topActionsBody = workbench.slice(topActionsStart, topActionsEnd)
  const resultsActionsStart = workbench.indexOf('class="aiw-results-actions"')
  const resultsActionsEnd = workbench.indexOf('class="aiw-tabs"', resultsActionsStart)
  const resultsActionsBody = workbench.slice(resultsActionsStart, resultsActionsEnd)

  assert.match(topActionsBody, /<AiwIcon name="plus"/)
  assert.match(topActionsBody, /<AiwIcon name="folder"/)
  assert.match(topActionsBody, /<AiwIcon name="settings"/)
  assert.match(resultsActionsBody, /<AiwIcon :name="allVisibleSelected \? 'minus-square' : 'check-square'"/)
  assert.match(resultsActionsBody, /<AiwIcon name="download"/)
  assert.match(workbench, /<AiwIcon name="wand"/)
})

test('AI image workbench uses results and task tabs without a logs page', () => {
  const workbench = read('app/src/renderer/views/AiImageWorkbench.vue')
  const tabsStart = workbench.indexOf('class="aiw-tabs"')
  const tabsEnd = workbench.indexOf('</div>', tabsStart)
  const tabsBody = workbench.slice(tabsStart, tabsEnd)

  assert.match(tabsBody, /workspaceMode === 'results'/)
  assert.match(tabsBody, />结果<\/button>/)
  assert.match(tabsBody, /workspaceMode === 'tasks'/)
  assert.match(tabsBody, />任务<\/button>/)
  assert.doesNotMatch(tabsBody, />日志<\/button>/)
  assert.doesNotMatch(workbench, /workspaceMode === 'logs'/)
  assert.doesNotMatch(workbench, /class="aiw-log-panel"/)
  assert.doesNotMatch(workbench, /class="aiw-log-stack"/)
})

test('AI image workbench renders task records as a sidebar inside the result workspace', () => {
  const workbench = read('app/src/renderer/views/AiImageWorkbench.vue')
  const taskWorkspaceStart = workbench.indexOf('v-else-if="workspaceMode === \'tasks\'" class="aiw-task-records-workspace"')
  const detailStart = workbench.indexOf('class="aiw-task-detail-panel"', taskWorkspaceStart)
  const sidebarStart = workbench.indexOf('class="aiw-history-sidebar"', taskWorkspaceStart)
  const sidebarEnd = workbench.indexOf('</aside>', sidebarStart)
  const sidebarBody = workbench.slice(sidebarStart, sidebarEnd)

  assert.match(workbench, /v-else-if="workspaceMode === 'tasks'" class="aiw-task-records-workspace"/)
  assert.match(workbench, /class="aiw-history-sidebar"/)
  assert.match(workbench, /class="aiw-task-detail-panel"/)
  assert.doesNotMatch(sidebarBody, /class="aiw-history-actions"/)
  assert.doesNotMatch(sidebarBody, /@click="createNewTask"/)
  assert.doesNotMatch(sidebarBody, /@click="loadJobs"/)
  assert.doesNotMatch(workbench, /\.aiw-history-actions/)
  assert.match(workbench, /@click="selectTaskRecord\(job\)"/)
  assert.match(workbench, /async function selectTaskRecord\(job\)/)
  assert.match(workbench, /workspaceMode\.value = 'results'[\s\S]*await restoreJob\(job\)/)
  assert.doesNotMatch(workbench, />查看结果</)
  assert.doesNotMatch(workbench, /stayInTasks: true/)
  assert.ok(detailStart > 0 && sidebarStart > 0 && detailStart < sidebarStart, 'task detail should render before the task list so the list sits on the right')
  assert.match(workbench, /\.aiw-task-records-workspace\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(220px, 240px\)/)
  assert.doesNotMatch(workbench, /class="aiw-history-drawer"/)
  assert.doesNotMatch(workbench, /class="aiw-history-toggle"/)
  assert.doesNotMatch(workbench, /grid-template-columns: minmax\(300px, 340px\) minmax\(420px, 1fr\) minmax\(230px, 260px\)/)
  assert.match(workbench, /@media \(max-width: 1060px\)/)
})

test('AI image workbench simplifies top actions and reports open-folder failures', () => {
  const workbench = read('app/src/renderer/views/AiImageWorkbench.vue')
  const openStart = workbench.indexOf('async function openOutputFolder()')
  const openEnd = workbench.indexOf('function pathLabel', openStart)
  const openBody = workbench.slice(openStart, openEnd)

  assert.match(workbench, /class="aiw-top-primary" type="button" @click="createNewTask"[\s\S]*<AiwIcon name="plus" \/>新建任务/)
  assert.match(workbench, /<AiwIcon name="settings" \/>配置/)
  assert.doesNotMatch(workbench, />配置模型 Key<\/button>/)
  assert.notEqual(openStart, -1, 'openOutputFolder should be async')
  assert.match(openBody, /const directory = form\.output_dir \|\| currentJob\.value\?\.output_dir \|\| ''/)
  assert.match(openBody, /window\.cs\.openFile/)
  assert.match(openBody, /window\.cs\.revealFile/)
  assert.match(openBody, /throw new Error\('当前环境不支持直接打开输出文件夹'\)/)
  assert.match(openBody, /logs\.value\.push\(`打开输出文件夹/)
  assert.match(openBody, /errorMessage\.value = error\.message \|\| String\(error\)/)
})
