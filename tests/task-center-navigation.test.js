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

test('Embedded Tmall approval board loads its batch on first render', () => {
  const drawer = fs.readFileSync('app/src/renderer/views/TmallAiApprovalDrawer.vue', 'utf8')
  const runner = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')

  assert.match(drawer, /watch\(\(\) => \[props\.modelValue, props\.boardUrl\]/)
  assert.match(drawer, /\{ immediate: true \}/)
  assert.match(drawer, /if \(open\) reload\(\)/)
  assert.match(runner, /<TmallAiApprovalDrawer[\s\S]*:model-value="true"[\s\S]*embedded/)
})

test('Tmall AI image runner embeds cloud approval board URLs', () => {
  const runner = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')

  assert.match(runner, /isTrustedCloudApprovalBoardUrl/)
  assert.match(runner, /cloudApprovalBaseUrl/)
  assert.match(runner, /getCloudApprovalStatus/)
  assert.match(runner, /cloudApprovalFrameUrl/)
  assert.match(runner, /buildEmbeddedCloudApprovalUrl\(approvalBoardUrl\.value,\s*cloudApprovalBaseUrl\.value\)/)
  assert.match(runner, /class="cloud-approval-embed"/)
  assert.match(runner, /referrerpolicy="no-referrer"/)
  assert.match(runner, /<TmallAiApprovalDrawer[\s\S]*v-else-if="approvalBoardUrl"/)
  assert.match(runner, /isLocalTmallApprovalBoardUrl\(path\)/)
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

test('Tmall generation confirmation board uses compact slots and modal editors', () => {
  const drawer = fs.readFileSync('app/src/renderer/views/TmallAiApprovalDrawer.vue', 'utf8')

  assert.match(drawer, /const MAX_CONFIRMATION_IMAGES = 10/)
  assert.match(drawer, /class="generation-confirm-board"/)
  assert.match(drawer, /class="confirmation-reference-panel"/)
  assert.match(drawer, /class="generation-prompt-grid"/)
  assert.match(drawer, /class="prompt-reference-toggle-row"/)
  assert.match(drawer, /class="add-generation-prompt-card"/)
  assert.match(drawer, /class="main-image-slot"/)
  assert.match(drawer, /class="\['reference-image-slot'/)
  assert.match(drawer, /openImagePreview/)
  assert.match(drawer, /class="image-preview-modal"/)
  assert.match(drawer, /openPromptEditor/)
  assert.match(drawer, /class="prompt-editor-modal"/)
  assert.match(drawer, /referenceImageSelected/)
  assert.match(drawer, /togglePromptReferenceImage/)
  assert.match(drawer, /生图张数/)
  assert.match(drawer, /v-model\.number="prompt\.image_count"/)
  assert.match(drawer, /normalizeGenerationImageCount/)
  assert.match(functionBlock(drawer, 'generationConfirmationPayload'), /image_count:\s*normalizeGenerationImageCount\(prompt\.image_count\)/)
  assert.doesNotMatch(drawer, /class="confirmation-image-slots"/)
  assert.doesNotMatch(drawer, /class="approval-inspector"/)
  assert.doesNotMatch(drawer, /\.approval-inspector/)
  assert.doesNotMatch(drawer, /@click="addGenerationPrompt\(item\)"/)
})

test('Tmall generation confirmation submit shows generation progress immediately', () => {
  const drawer = fs.readFileSync('app/src/renderer/views/TmallAiApprovalDrawer.vue', 'utf8')
  const runner = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')
  const submitGeneration = functionBlock(drawer, 'submitGenerationConfirmation')
  const generationStarted = functionBlock(runner, 'handleApprovalGenerationStarted')

  assert.match(drawer, /'generation-started'/)
  assert.match(runner, /@generation-started="handleApprovalGenerationStarted"/)
  assert.match(submitGeneration, /status:\s*'generating'/)
  assert.match(submitGeneration, /submit_progress:\s*\{/)
  assert.match(submitGeneration, /message:\s*generationStartMessage/)
  assert.match(submitGeneration, /emit\('generation-started', batch\.value\)/)
  assert.match(submitGeneration, /startSubmitProgressPolling\(\)/)
  assert.match(submitGeneration, /stopSubmitProgressPolling\(\)/)
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

test('Tmall AI image task config can choose a cloud Prompt library', () => {
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
  assert.match(runner, /window\.cs\.listCloudPromptLibraries/)
  assert.match(runner, /window\.cs\.resolveCloudPromptTemplates/)
  assert.match(runner, /cloudPromptLibrarySearch/)
  assert.match(runner, /cloudPromptLibraryScenario/)
  assert.match(runner, /选择云端 Prompt 库/)
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
  assert.match(promptPicker, /window\.cs\.resolveCloudPromptTemplates/)
  assert.match(promptPicker, /library\.source_label/)
  assert.match(promptPicker, /selectedLibrary\.source_type === 'local'/)
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
