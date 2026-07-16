import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

function functionBlock(source, name) {
  const match = source.match(new RegExp(`function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`))
  assert.ok(match, `missing function ${name}`)
  return match[1]
}

test('App navigation replaces market with task center', () => {
  const app = fs.readFileSync('app/src/renderer/App.vue', 'utf8')
  assert.match(app, /label: '任务中心'/)
  assert.match(app, /id: 'task_center'/)
  assert.doesNotMatch(app, /label: '抓虾市场'/)
})

test('TaskCenter exposes AI image task creation copy', () => {
  const view = fs.readFileSync('app/src/renderer/views/TaskCenter.vue', 'utf8')
  assert.match(view, /新增 AI 测图任务/)
  assert.match(view, /新增数据抓取定时任务/)
  assert.match(view, /每天/)
  assert.match(view, /每周/)
  assert.match(view, /钉钉消息模板/)
  assert.match(view, /runTaskScheduleNow/)
  assert.match(view, /当前任务/)
  assert.match(view, /待处理/)
  assert.match(view, /历史任务/)
})

test('TaskCenter renders task instances and schedules in one unified list', () => {
  const view = fs.readFileSync('app/src/renderer/views/TaskCenter.vue', 'utf8')
  assert.match(view, /const combinedItems = computed/)
  assert.match(view, /v-for="item in combinedItems"/)
  assert.match(view, /item\.rowType === 'schedule'/)
  assert.match(view, /任务类型/)
  assert.match(view, /定时任务/)
  assert.doesNotMatch(view, /class="tc-schedules"/)
  assert.doesNotMatch(view, /class="tc-schedule-list"/)
})

test('TaskCenter shows AI image previews for generated AI image task instances', () => {
  const view = fs.readFileSync('app/src/renderer/views/TaskCenter.vue', 'utf8')
  assert.match(view, /aiPreviewImagesForTask/)
  assert.match(view, /class="tc-ai-preview"/)
  assert.match(view, /v-for="preview in aiPreviewImagesForTask\(item\)"/)
  assert.match(view, /\/tmall-ai-image-approval\/api\/\$\{encodeURIComponent\(batchId\)\}\/image\//)
  assert.match(view, /summary\?\.approval_batch_id/)
  assert.match(view, /summary\?\.approval_token/)
})

test('Electron and dev bridge expose task schedule APIs', () => {
  const preload = fs.readFileSync('app/src/preload.js', 'utf8')
  const devBridge = fs.readFileSync('app/src/renderer/utils/devCsBridge.js', 'utf8')

  for (const source of [preload, devBridge]) {
    assert.match(source, /listTaskSchedules/)
    assert.match(source, /createTaskSchedule/)
    assert.match(source, /updateTaskSchedule/)
    assert.match(source, /deleteTaskSchedule/)
    assert.match(source, /runTaskScheduleNow/)
  }
})

test('Electron main process registers task center IPC handlers', () => {
  const main = fs.readFileSync('app/src/main.js', 'utf8')
  for (const channel of [
    'list-task-instances',
    'create-task-instance',
    'get-task-instance',
    'update-task-instance',
    'run-task-instance',
    'list-task-schedules',
    'create-task-schedule',
    'get-task-schedule',
    'update-task-schedule',
    'delete-task-schedule',
    'run-task-schedule-now',
  ]) {
    assert.match(main, new RegExp(`secureHandle\\('${channel}'`))
  }
})

test('TaskCenter opens new task flows in modal dialogs', () => {
  const view = fs.readFileSync('app/src/renderer/views/TaskCenter.vue', 'utf8')
  assert.match(view, /showAiTaskDialog/)
  assert.match(view, /showScheduleDialog/)
  assert.match(view, /tc-modal-backdrop/)
  assert.match(view, /tc-modal-dialog/)
  assert.match(view, /@click="startCreateAiImageTask"/)
  assert.doesNotMatch(view, /showScheduleForm/)
  assert.doesNotMatch(view, /<form\s+v-if="showScheduleForm"/)
})

test('TaskCenter schedule dialog uses a folder picker and large DingTalk template area', () => {
  const view = fs.readFileSync('app/src/renderer/views/TaskCenter.vue', 'utf8')
  assert.match(view, /chooseScheduleOutputDir/)
  assert.match(view, /window\.cs\.browseFile\(\{[\s\S]*directory:\s*true/)
  assert.match(view, /class="tc-dir-picker/)
  assert.match(view, /clearScheduleOutputDir/)
  assert.doesNotMatch(view, /v-model\.trim="scheduleForm\.output_dir"[\s\S]*type="text"/)
  assert.match(view, /钉钉消息模板[\s\S]*textarea[\s\S]*rows="8"/)
  assert.match(view, /class="full"[\s\S]*钉钉消息模板/)
})

test('TaskCenter schedule dialog can auto-sync material export results to cloud', () => {
  const view = fs.readFileSync('app/src/renderer/views/TaskCenter.vue', 'utf8')
  assert.match(view, /scheduleForm\.sync_to_cloud/)
  assert.match(view, /自动同步云端/)
  assert.match(view, /sync_to_cloud:\s*true/)
  assert.match(view, /params\.sync_to_cloud\s*=\s*\['enabled'\]/)
  assert.match(view, /schedule\.params\?\.sync_to_cloud/)
})

test('Preload task center APIs fall back to local HTTP when IPC handlers are missing', () => {
  const preload = fs.readFileSync('app/src/preload.js', 'utf8')
  assert.match(preload, /invokeWithApiFallback/)
  assert.match(preload, /No handler registered/)
  assert.match(preload, /listTaskInstances:[\s\S]*invokeWithApiFallback\('list-task-instances'/)
  assert.match(preload, /createTaskInstance:[\s\S]*invokeWithApiFallback\('create-task-instance'/)
  assert.match(preload, /listTaskSchedules:[\s\S]*invokeWithApiFallback\('list-task-schedules'/)
  assert.match(preload, /createTaskSchedule:[\s\S]*invokeWithApiFallback\('create-task-schedule'/)
  assert.match(preload, /\/task-instances/)
  assert.match(preload, /\/task-schedules/)
})

test('Preload task center fallback stays compatible with Electron sandbox', () => {
  const preload = fs.readFileSync('app/src/preload.js', 'utf8')
  const main = fs.readFileSync('app/src/main.js', 'utf8')

  assert.doesNotMatch(preload, /require\('fs'\)/)
  assert.doesNotMatch(preload, /require\('path'\)/)
  assert.doesNotMatch(preload, /require\('os'\)/)
  assert.doesNotMatch(preload, /require\('https?'\)/)
  assert.match(preload, /fetch\(buildUrl/)
  assert.match(preload, /rememberApiConnectionFromStatus/)
  assert.match(preload, /delete publicStatus\.apiToken/)
  assert.match(main, /apiToken:\s*getApiToken\(\)/)
})

test('TaskRunner reads output files from task instance artifacts in instance mode', () => {
  const view = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')
  assert.match(view, /const isInstanceMode = computed/)
  assert.match(view, /window\.cs\.getTaskInstance\(props\.instanceUid\)/)
  assert.match(view, /detail\?\.artifacts/)
  assert.match(view, /detail\?\.summary\?\.approval_board_url/)
  assert.match(view, /const localApprovalBoardUrl = ref\(''\)/)
  assert.match(view, /findLocalApprovalBoardUrl\(allFiles,\s*detail\?\.summary \|\| null\)/)
  assert.match(view, /parseLocalTmallApprovalBoardUrl\(localApprovalBoardUrl\.value \|\| approvalBoardUrl\.value\)/)
})

test('TaskRunner renders single date params with temporal date picker cards', () => {
  const runner = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')
  const temporalTypeBlock = functionBlock(runner, 'isSingleTemporalParamType')

  assert.match(temporalTypeBlock, /'date'/)
  assert.match(runner, /v-else-if="isSingleTemporalParamType\(param\.type\)"/)
  assert.match(runner, /openDatePicker\(param\.id\)/)
})

test('Task instance approval board button prefers the local board URL in the desktop client', () => {
  const view = fs.readFileSync('app/src/renderer/views/TaskInstanceRunner.vue', 'utf8')
  assert.match(view, /const preferredApprovalBoardUrl = computed/)
  assert.match(view, /const local = String\(summary\.local_board_url \|\| ''\)\.trim\(\)/)
  assert.match(view, /return isLocalTmallApprovalBoardUrl\(approval\) \? approval : ''/)
  assert.match(view, /v-if="preferredApprovalBoardUrl"/)
  assert.match(view, /@click="openArtifact\(preferredApprovalBoardUrl\)"/)
})

test('Tmall AI image completed task instances open on the create result step', () => {
  const instanceView = fs.readFileSync('app/src/renderer/views/TaskInstanceRunner.vue', 'utf8')
  const runner = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')

  assert.match(instanceView, /:initial-step="instance\.current_step \|\| ''"/)
  assert.match(runner, /initialStep:\s*\{ type: String, default: '' \}/)
  assert.match(runner, /function initialAiChainActiveStep/)
  assert.match(runner, /aiChainActiveStep\.value = initialAiChainActiveStep\(adapterId, task\)/)
  assert.match(runner, /const preferCreateStep = shouldPreferCreateStepForInstance\(detail\)/)
  assert.match(runner, /refreshAiChainApprovalBatch\(\{ preferCreateStep \}\)/)
})

test('TaskRunner auto-saves task instance draft params', () => {
  const view = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')
  assert.match(view, /scheduleInstanceDraftParamSave/)
  assert.match(view, /saveInstanceDraftParamsNow/)
  assert.match(view, /instanceDraftSaveTargetUid/)
  assert.match(view, /window\.cs\.updateTaskInstance\(targetUid/)
  assert.match(view, /preservedTechnicalInstanceParams/)
})

test('TaskInstanceRunner renders zero-record summaries', () => {
  const view = fs.readFileSync('app/src/renderer/views/TaskInstanceRunner.vue', 'utf8')
  assert.match(view, /hasOwnProperty\.call\(summary, 'records'\)/)
  assert.match(view, /Number\(summary\.records \|\| 0\).*条记录/)
})

test('Tmall AI image runner keeps the upper work area scrollable', () => {
  const view = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')
  assert.match(view, /\.runner-main-scroll\s*\{[^}]*flex:\s*1 1 0;/s)
  assert.match(view, /\.runner-main-scroll\s*\{[^}]*min-height:\s*0;/s)
  assert.match(view, /\.ai-chain-runner \.runner-main-scroll\s*\{[^}]*display:\s*block;/s)
  assert.match(view, /\.ai-chain-step-panel\s*\{[^}]*overflow:\s*visible;/s)
})

test('Task output drawer is minimized by default and opens after logs arrive', () => {
  const view = fs.readFileSync('app/src/renderer/views/TaskOutputDrawer.vue', 'utf8')
  assert.match(view, /const drawerState = ref\('minimized'\)/)
  assert.match(view, /props\.autoOpenOnFirstLog && nextLength > previousLength && previousLength === 0 && drawerState\.value === 'minimized'/)
  assert.match(view, /drawerState\.value = 'half'/)
})

test('Tmall AI image runner step state is derived from batch lifecycle', () => {
  const view = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')
  assert.match(view, /const aiChainLifecycle = computed/)
  assert.match(view, /pending_generation_confirmation/)
  assert.match(view, /id: 'confirm'/)
  assert.match(view, /title: '确认提交'/)
  assert.match(view, /确认提交生图任务/)
  assert.doesNotMatch(view, /approvalBoardUrl\.value \|\| isRunning\.value \? 'done' : 'active'/)
  assert.doesNotMatch(view, /approvalBoardUrl\.value \? \(pending > 0 \? 'active' : 'done'\) : 'pending'/)
})

test('Tmall approval board removes duplicate lower lifecycle tabs', () => {
  const view = fs.readFileSync('app/src/renderer/views/TmallAiApprovalDrawer.vue', 'utf8')
  assert.doesNotMatch(view, /class="approval-lifecycle"/)
  assert.doesNotMatch(view, /\.approval-lifecycle/)
  assert.doesNotMatch(view, /class="approval-stage/)
  assert.doesNotMatch(view, /\.approval-stage/)
  assert.doesNotMatch(view, /class="approval-stage done"/)
  assert.doesNotMatch(view, /summary\.pending > 0 \? 'active' : 'done'/)
})

test('Tmall approval board prioritizes AI images over source thumbnails', () => {
  const drawer = fs.readFileSync('app/src/renderer/views/TmallAiApprovalDrawer.vue', 'utf8')

  assert.match(drawer, /class="asset-board"/)
  assert.match(drawer, /class="ai-assets-panel"/)
  assert.match(drawer, /class="ai-asset-grid"/)
  assert.match(drawer, /v-for="asset in itemAiAssets\(item\)"/)
  assert.match(drawer, /class="source-assets-panel"/)
  assert.match(drawer, /class="source-thumb-row"/)
  assert.match(drawer, /v-for="asset in itemSourceAssets\(item\)"/)
  assert.match(drawer, /function itemAiAssets\(item\)/)
  assert.match(drawer, /function itemSourceAssets\(item\)/)
  assert.match(drawer, /function assetSourceLabel\(asset\)/)
  assert.match(drawer, /grid-template-columns:\s*repeat\(auto-fill, minmax\(178px, 1fr\)\)/)
  assert.match(drawer, /flex:\s*0 0 92px/)
  assert.doesNotMatch(drawer, /class="asset-rail"/)
})

test('Embedded Tmall approval board loads its batch on first render', () => {
  const drawer = fs.readFileSync('app/src/renderer/views/TmallAiApprovalDrawer.vue', 'utf8')
  const runner = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')

  assert.match(drawer, /watch\(\(\) => \[props\.modelValue, props\.boardUrl\]/)
  assert.match(drawer, /\{ immediate: true \}/)
  assert.match(drawer, /if \(open\) reload\(\)/)
  assert.match(runner, /<TmallAiApprovalDrawer[\s\S]*:model-value="true"[\s\S]*embedded/)
})

test('Tmall AI image runner uses the local board inside the desktop client', () => {
  const runner = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')

  assert.match(runner, /isTrustedCloudApprovalBoardUrl/)
  assert.match(runner, /cloudApprovalBaseUrl/)
  assert.match(runner, /getCloudApprovalStatus/)
  assert.match(runner, /const tmallClientApprovalBoardUrl = computed/)
  assert.match(runner, /localApprovalBoardUrl\.value/)
  assert.match(runner, /isLocalTmallApprovalBoardUrl\(approvalBoardUrl\.value\)/)
  assert.match(runner, /<TmallAiApprovalDrawer[\s\S]*v-if="tmallClientApprovalBoardUrl"[\s\S]*:board-url="tmallClientApprovalBoardUrl"/)
  assert.match(runner, /isLocalTmallApprovalBoardUrl\(path\)/)
  assert.match(runner, /window\.cs\.openFile\(isTmallAiImageChainTask\.value \? target : buildEmbeddedCloudApprovalUrl\(target, cloudApprovalBaseUrl\.value\)\)/)
  assert.doesNotMatch(runner, /class="cloud-approval-embed"/)
  assert.doesNotMatch(runner, /return parsed\.searchParams\.has\('batch_uid'\) && !parsed\.pathname\.includes\('\/tmall-ai-image-approval\/'\)/)
})

test('Tmall AI image runner avoids duplicate step titles under numbered tabs', () => {
  const runner = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')

  assert.match(runner, /<header v-if="!isTmallAiImageChainTask" class="runner-header">/)
  assert.match(runner, /\.ai-chain-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/s)
  assert.match(runner, /\.ai-chain-tab\s*\{[^}]*align-items:\s*center;/s)
  assert.match(runner, /\.ai-chain-tab-index\s*\{[^}]*align-self:\s*center;/s)
  assert.doesNotMatch(runner, /v-if="isTmallAiImageChainTask" class="ai-chain-panel-head"/)
  assert.doesNotMatch(runner, /<div class="ai-chain-panel-head">[\s\S]*实际测图任务创建结果/)
})

test('Tmall AI image task maps ratio to compatible size options', () => {
  const manifest = fs.readFileSync('adapters/tmall-ops-assistant/manifest.yaml', 'utf8')
  const runner = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')
  const apiServer = fs.readFileSync('core/api_server.py', 'utf8')
  const chainScript = fs.readFileSync('adapters/tmall-ops-assistant/tools/run_tmall_ai_image_test_chain.py', 'utf8')

  assert.match(manifest, /id: model_id[\s\S]*label: 生图模型[\s\S]*default: gpt-image-4k[\s\S]*GPT Image 4K[\s\S]*Gemini 3 Pro Image Preview/)
  assert.match(manifest, /id: ratio[\s\S]*label: 比例[\s\S]*default: "3:4"[\s\S]*value: "9:16"/)
  assert.match(manifest, /id: image_size[\s\S]*label: 尺寸[\s\S]*default: 1536x2048[\s\S]*1536x2048（3:4）/)
  assert.match(manifest, /id: generation_concurrency[\s\S]*hidden: true/)
  assert.match(manifest, /id: one_xm_key_tier[\s\S]*default: 4k[\s\S]*hidden: true/)
  assert.match(manifest, /id: retry_attempts[\s\S]*hidden: true/)
  assert.match(manifest, /id: compensate_attempts[\s\S]*hidden: true/)
  assert.match(manifest, /id: poll_timeout_minutes[\s\S]*hidden: true/)
  assert.doesNotMatch(manifest, /3840x2160/)
  assert.doesNotMatch(manifest, /2160x3840/)
  assert.match(runner, /AI_IMAGE_MODELS,[\s\S]*AI_IMAGE_RATIOS,[\s\S]*defaultSizeForRatio,[\s\S]*getAiImageModel,[\s\S]*ratioForSize,[\s\S]*sizeForRatio,[\s\S]*sizesForRatio/)
  assert.match(runner, /const tmallAiImageSizeOptions = computed\(\(\) =>\s*sizesForRatio\(tmallAiImageRatioValue\(\)\)/)
  assert.match(runner, /function tmallAiImageRunKeyTier\(model\)/)
  assert.match(runner, /return tier === '4k' \|\| tier === '2k' \? tier : 'auto'/)
  assert.match(runner, /function syncTmallAiImageParamDefaults\(options = \{\}\)/)
  assert.match(runner, /deriveRatioFromSize:\s*hasOwnParamValue\(props\.initialParams, 'image_size'\) && !hasOwnParamValue\(props\.initialParams, 'ratio'\)/)
  assert.match(runner, /function updateTmallAiImageRatio\(value\)/)
  assert.match(runner, /function updateTmallAiImageSize\(value\)/)
  assert.match(runner, /async function prepareRunParams\(overrides = \{\}\) \{[\s\S]*syncTmallAiImageParamDefaults\(\)/)
  assert.match(runner, /params\.model_id = model\.id[\s\S]*params\.model = model\.key[\s\S]*params\.one_xm_key_tier = tmallAiImageRunKeyTier\(model\)[\s\S]*params\.ratio = ratio[\s\S]*params\.image_size = sizeForRatio/)
  assert.match(apiServer, /model_id, model, one_xm_key_tier = _tmall_ai_model_params\(run_params or \{\}\)/)
  assert.match(apiServer, /image_size=str\(\(run_params or \{\}\)\.get\("image_size"\) or "1536x2048"\)\.strip\(\)/)
  assert.match(chainScript, /parser\.add_argument\("--ratio", default=""\)/)
  assert.match(chainScript, /parser\.add_argument\("--image-size", default="1536x2048"\)/)
  assert.match(chainScript, /parser\.add_argument\("--one-xm-key-tier", default="4k"/)
})

test('Tmall generation confirmation board uses compact slots and inline prompt editing', () => {
  const drawer = fs.readFileSync('app/src/renderer/views/TmallAiApprovalDrawer.vue', 'utf8')

  assert.match(drawer, /const MAX_CONFIRMATION_IMAGES = 10/)
  assert.match(drawer, /class="generation-confirm-board"/)
  assert.match(drawer, /class="confirmation-reference-panel"/)
  assert.match(drawer, /class="generation-prompt-grid"/)
  assert.match(drawer, /class="prompt-reference-toggle-row compact"/)
  assert.match(drawer, /class="prompt-reference-summary"/)
  assert.match(drawer, /选择参考图/)
  assert.match(drawer, /promptReferencePicker/)
  assert.match(drawer, /class="prompt-reference-picker-modal"/)
  assert.match(drawer, /class="prompt-reference-picker-grid"/)
  assert.match(drawer, /function promptExtraReferenceCount\(item, prompt\)/)
  assert.match(drawer, /openPromptReferencePicker\(item, prompt\)/)
  assert.match(drawer, /class="add-generation-prompt-card"/)
  assert.match(drawer, /<button v-if="isGenerationConfirmation"[\s\S]*@click="addGenerationPrompt\(item\)"[\s\S]*新增 Prompt/)
  assert.match(drawer, /class="add-generation-prompt-card" @click="addGenerationPrompt\(item\)"/)
  assert.match(functionBlock(drawer, 'addGenerationPrompt'), /prompt_name:\s*hasPromptName \? String\(values\.promptName \|\| ''\) : ''/)
  assert.match(drawer, /class="main-image-slot"/)
  assert.match(drawer, /class="\['reference-image-slot'/)
  assert.match(drawer, /openImagePreview/)
  assert.match(drawer, /class="image-preview-modal"/)
  assert.match(drawer, /referenceImageSelected/)
  assert.match(drawer, /togglePromptReferenceImage/)
  assert.match(drawer, /生图张数/)
  assert.match(drawer, /v-model\.number="prompt\.image_count"/)
  assert.match(drawer, /normalizeGenerationImageCount/)
  assert.match(drawer, /function cloneForIpcPayload\(value, fallback = \{\}\)/)
  assert.match(functionBlock(drawer, 'generationConfirmationPayload'), /image_count:\s*normalizeGenerationImageCount\(prompt\.image_count\)/)
  assert.match(functionBlock(drawer, 'generationConfirmationPayload'), /generation_row:\s*cloneForIpcPayload\(prompt\.generation_row \|\| \{\}\)/)
  assert.doesNotMatch(drawer, /v-for="asset in itemReferenceAssets\(item\)"[\s\S]{0,220}prompt-reference-chip/)
  assert.doesNotMatch(drawer, /class="confirmation-image-slots"/)
  assert.doesNotMatch(drawer, /class="approval-inspector"/)
  assert.doesNotMatch(drawer, /\.approval-inspector/)
  assert.match(drawer, /grid-template-columns:\s*minmax\(124px, 1fr\) 64px/)
  assert.match(drawer, /\.prompt-card-actions \.ghost-btn\.danger\s*\{[\s\S]*justify-self:\s*end/)
  assert.doesNotMatch(drawer, /\.prompt-card-actions\s*\{[\s\S]{0,140}repeat\(3, minmax\(0, 1fr\)\)/)
  assert.doesNotMatch(drawer, /class="add-generation-prompt-card" @click="openPromptEditor\(item\)"/)
  assert.doesNotMatch(drawer, /弹窗编辑/)
  assert.doesNotMatch(drawer, /openPromptEditor/)
  assert.doesNotMatch(drawer, /promptEditor/)
  assert.doesNotMatch(drawer, /prompt-editor-modal/)
  assert.doesNotMatch(drawer, /prompt-editor-panel/)
})

test('Tmall generation confirmation submit shows generation progress immediately', () => {
  const drawer = fs.readFileSync('app/src/renderer/views/TmallAiApprovalDrawer.vue', 'utf8')
  const runner = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')
  const submitGeneration = functionBlock(drawer, 'submitGenerationConfirmation')
  const generationStarted = functionBlock(runner, 'handleApprovalGenerationStarted')

  assert.match(drawer, /'generation-started'/)
  assert.match(runner, /@generation-started="handleApprovalGenerationStarted"/)
  assert.match(submitGeneration, /const payload = cloneForIpcPayload\(generationConfirmationPayload\(\)\)/)
  assert.match(functionBlock(drawer, 'optimisticGenerationBatch'), /status:\s*'generating'/)
  assert.match(functionBlock(drawer, 'optimisticGenerationBatch'), /submit_progress:\s*submitProgress/)
  assert.match(submitGeneration, /message:\s*generationStartMessage/)
  assert.match(submitGeneration, /emit\('generation-started', batch\.value\)/)
  assert.match(submitGeneration, /startSubmitProgressPolling\(\)/)
  assert.match(submitGeneration, /result\?\.accepted \? '已提交后台生图任务/)
  assert.match(submitGeneration, /String\(batch\.value\?\.status \|\| ''\)\.trim\(\) !== 'generating'\) stopSubmitProgressPolling\(\)/)
  assert.match(drawer, /function isGeneratingAsset\(asset\)/)
  assert.match(drawer, /function assetLoadingPreviewPath\(asset, item\)/)
  assert.match(drawer, /class="asset-loading-source"/)
  assert.match(drawer, /class="asset-loading-preview"/)
  assert.match(drawer, /asset-loading-spinner/)
  assert.match(drawer, /function optimisticGenerationBatch\(sourceBatch, payload, submitProgress\)/)
  assert.match(drawer, /function localGenerationPlaceholderAssets\(item, payloadItem, itemIndex, now\)/)
  assert.match(functionBlock(drawer, 'localGenerationPlaceholderAssets'), /placeholder:\s*true/)
  assert.match(functionBlock(drawer, 'localGenerationPlaceholderAssets'), /placeholder_preview_path:\s*mainPath/)
  assert.match(submitGeneration, /const submitProgress = \{/)
  assert.match(submitGeneration, /batch\.value = optimisticGenerationBatch\(batch\.value, payload, submitProgress\)/)
  assert.match(drawer, /effectiveStatus\.value !== 'generating'/)
  assert.match(drawer, /generationSubmitting\.value\) return '正在批量生图'/)
  assert.match(generationStarted, /handleApprovalBatchUpdated\(payload\)/)
  assert.match(generationStarted, /aiChainActiveStep\.value\s*=\s*'approval'/)
})

test('Tmall generation confirmation images use the active local API base', () => {
  const drawer = fs.readFileSync('app/src/renderer/views/TmallAiApprovalDrawer.vue', 'utf8')

  assert.match(drawer, /function tmallApprovalApiBase\(\)/)
  assert.match(drawer, /window\.cs\?\.getApiBase\?\.\(\)/)
  assert.match(functionBlock(drawer, 'referenceImageUrl'), /tmallApprovalApiBase\(\)/)
  assert.doesNotMatch(functionBlock(drawer, 'referenceImageUrl'), /ref\.origin/)
})

test('Tmall AI image task config can use local Prompt libraries when cloud login is unavailable', () => {
  const manifest = fs.readFileSync('adapters/tmall-ops-assistant/manifest.yaml', 'utf8')
  const runner = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')

  assert.match(manifest, /id: prompt_source/)
  assert.match(manifest, /value: local_excel/)
  assert.match(manifest, /value: cloud_prompt_library/)
  assert.match(manifest, /id: cloud_prompt_library_id/)
  assert.match(manifest, /visible_when:[\s\S]*field: prompt_source[\s\S]*equals: cloud_prompt_library/)
  assert.match(manifest, /id: prompt_file[\s\S]*visible_when:[\s\S]*field: prompt_source[\s\S]*equals: local_excel/)

  assert.match(runner, /isCloudPromptLibraryParam/)
  assert.match(runner, /cloudPromptLibraryDialog/)
  assert.match(runner, /openCloudPromptLibraryDialog/)
  assert.match(runner, /loadCloudPromptLibraries/)
  assert.match(runner, /window\.cs\.listLocalPromptLibraries\(\)/)
  assert.match(runner, /window\.cs\.listCloudPromptLibraries/)
  assert.match(runner, /loadPromptLibraryPickerSources/)
  assert.match(runner, /buildPromptLibraryPickerLibraries/)
  assert.match(runner, /buildPromptLibraryTaskSelection/)
  assert.match(runner, /cloud_prompt_templates_json/)
  assert.match(runner, /cloud_prompt_library_source/)
  assert.doesNotMatch(runner, /window\.cs\.resolveCloudPromptTemplates/)
  assert.match(runner, /cloudPromptLibraryDialog\.value\.libraries\.find/)
  assert.match(runner, /library\?\.templates/)
  assert.match(runner, /cloudPromptLibrarySearch/)
  assert.match(runner, /cloudPromptLibraryScenario/)
  assert.match(runner, /选择 Prompt 库/)
  assert.match(runner, /本地 Prompt 库无需登录即可使用/)
})

test('Tmall generation confirmation board can pick prompts from local and cloud libraries', () => {
  const drawer = fs.readFileSync('app/src/renderer/views/TmallAiApprovalDrawer.vue', 'utf8')
  const promptPicker = fs.readFileSync('app/src/renderer/components/PromptLibraryPickerModal.vue', 'utf8')

  assert.match(drawer, /import PromptLibraryPickerModal from '\.\.\/components\/PromptLibraryPickerModal\.vue'/)
  assert.match(drawer, /<PromptLibraryPickerModal/)
  assert.match(drawer, /promptLibraryPicker/)
  assert.match(drawer, /openPromptLibraryPicker\(item, prompt\)/)
  assert.match(drawer, /selectPromptLibraryTemplate/)
  assert.match(promptPicker, /buildPromptLibraryPickerLibraries/)
  assert.match(promptPicker, /window\.cs\.listLocalPromptLibraries\(\)/)
  assert.match(promptPicker, /window\.cs\.listCloudPromptLibraries/)
  assert.doesNotMatch(promptPicker, /window\.cs\.resolveCloudPromptTemplates/)
  assert.match(promptPicker, /library\.source_label/)
  assert.match(promptPicker, /selectedLibrary\.templates/)
  assert.match(drawer, /从 Prompt 库选择/)
  assert.match(promptPicker, /placeholder="搜索 Prompt 名称 \/ 内容"/)
})

test('Prompt library picker stays within small viewport bounds', () => {
  const promptPicker = fs.readFileSync('app/src/renderer/components/PromptLibraryPickerModal.vue', 'utf8')

  assert.match(promptPicker, /\.prompt-library-picker-modal\s*\{[\s\S]*align-items:\s*start;/)
  assert.match(promptPicker, /\.prompt-library-picker-modal\s*\{[\s\S]*padding:\s*clamp\(10px,\s*2dvh,\s*24px\)\s+clamp\(10px,\s*2vw,\s*28px\);/)
  assert.match(promptPicker, /\.prompt-library-picker-panel\s*\{[\s\S]*width:\s*min\(1040px,\s*calc\(100vw - 20px\)\);/)
  assert.match(promptPicker, /\.prompt-library-picker-panel\s*\{[\s\S]*height:\s*min\(760px,\s*calc\(100dvh - 20px\)\);/)
  assert.match(promptPicker, /\.prompt-library-picker-panel\s*\{[\s\S]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\);/)
  assert.match(promptPicker, /\.prompt-library-template-list\s*\{[\s\S]*min-height:\s*0;[\s\S]*overflow:\s*auto;/)
  assert.match(promptPicker, /@media \(max-width:\s*840px\)[\s\S]*grid-template-columns:\s*1fr;/)
})

test('Tmall manual generate modal can edit prompt and pick a concrete cloud prompt', () => {
  const drawer = fs.readFileSync('app/src/renderer/views/TmallAiApprovalDrawer.vue', 'utf8')

  assert.match(drawer, /manual-prompt-head/)
  assert.match(drawer, /v-model="manualGenerate\.prompt"/)
  assert.match(drawer, /openPromptLibraryPicker\(manualGenerate\.item, manualGenerate\)/)
  assert.match(drawer, /选中后会回填当前 Prompt/)
  assert.match(functionBlock(drawer, 'selectPromptLibraryTemplate'), /const promptText = String\(template\?\.prompt_text/)
  assert.match(functionBlock(drawer, 'selectPromptLibraryTemplate'), /if \(prompt === manualGenerate\.value\)/)
  assert.match(functionBlock(drawer, 'selectPromptLibraryTemplate'), /manualGenerate\.value\.prompt = promptText/)
})

test('Tmall approval submit shows progress while backend creates test tasks', () => {
  const drawer = fs.readFileSync('app/src/renderer/views/TmallAiApprovalDrawer.vue', 'utf8')
  const runner = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')

  assert.match(drawer, /class="approval-submit-progress"/)
  assert.match(drawer, /submitProgressPercent/)
  assert.match(drawer, /startSubmitProgressPolling/)
  assert.match(drawer, /正在提交已确认图片并创建测图任务/)
  assert.match(runner, /class="ai-chain-submit-progress"/)
  assert.match(runner, /aiChainSubmitProgressPercent/)
  assert.match(runner, /aiChainSubmitProgressImageCount/)
})

test('Tmall AI image create step polls approval batch after drawer unmounts', () => {
  const runner = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')
  const submitStarted = functionBlock(runner, 'handleApprovalSubmitStarted')
  const startPolling = functionBlock(runner, 'startAiChainApprovalBatchPolling')
  const refreshBatch = functionBlock(runner, 'refreshAiChainApprovalBatch')

  assert.match(runner, /let aiChainBatchPollTimer = null/)
  assert.match(runner, /let aiChainTerminalInstanceUpdateEmitted = false/)
  assert.match(runner, /const aiChainCreateTerminalStatuses = new Set/)
  assert.match(submitStarted, /startAiChainApprovalBatchPolling\(\)/)
  assert.match(startPolling, /window\.setInterval/)
  assert.match(startPolling, /refreshAiChainApprovalBatch\(\{ emitInstanceUpdatedOnTerminal: true \}\)/)
  assert.match(refreshBatch, /window\.cs\.getTmallApprovalBatch\(ref\.batchId, ref\.token\)/)
  assert.match(refreshBatch, /handleApprovalBatchUpdated\(payload\)/)
  assert.match(refreshBatch, /stopAiChainApprovalBatchPolling\(\)/)
  assert.match(refreshBatch, /options\.emitInstanceUpdatedOnTerminal/)
  assert.match(refreshBatch, /!aiChainTerminalInstanceUpdateEmitted/)
  assert.match(refreshBatch, /emit\('instance-updated'\)/)
  assert.match(runner, /refreshAiChainApprovalBatch\(\{ preferCreateStep: false \}\)/)
})

test('Tmall approval submit distinguishes append and rerun interactions', () => {
  const drawer = fs.readFileSync('app/src/renderer/views/TmallAiApprovalDrawer.vue', 'utf8')

  assert.match(drawer, /submitIntentLabel/)
  assert.match(drawer, /pendingSubmitImageCount/)
  assert.match(drawer, /追加提交未提交图片/)
  assert.match(drawer, /重新提交已确认图片/)
  assert.match(drawer, /提交项/)
  assert.match(drawer, /AI图/)
})

test('Tmall AI image create results expose compact detail links', () => {
  const drawer = fs.readFileSync('app/src/renderer/views/TmallAiApprovalDrawer.vue', 'utf8')
  const runner = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')

  for (const source of [drawer, runner]) {
    assert.match(source, /row\.测图详情URL/)
    assert.match(source, /查看详情/)
    assert.match(source, /openTmallDetailUrl/)
    assert.doesNotMatch(source, /\{\{\s*row\.测图详情URL\s*\}\}/)
  }
})

test('Tmall AI image tabs only jump to create when submit starts', () => {
  const drawer = fs.readFileSync('app/src/renderer/views/TmallAiApprovalDrawer.vue', 'utf8')
  const runner = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')
  const batchUpdated = functionBlock(runner, 'handleApprovalBatchUpdated')
  const submitStarted = functionBlock(runner, 'handleApprovalSubmitStarted')
  const committed = functionBlock(runner, 'handleApprovalCommitted')

  assert.match(drawer, /submit-started/)
  assert.match(runner, /@submit-started="handleApprovalSubmitStarted"/)
  assert.doesNotMatch(batchUpdated, /aiChainActiveStep\.value\s*=\s*'create'/)
  assert.match(submitStarted, /aiChainActiveStep\.value\s*=\s*'create'/)
  assert.doesNotMatch(committed, /aiChainActiveStep\.value\s*=\s*'create'/)
})
