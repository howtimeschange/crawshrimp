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
  assert.doesNotMatch(view, /approvalBoardUrl\.value \|\| isRunning\.value \? 'done' : 'active'/)
  assert.doesNotMatch(view, /approvalBoardUrl\.value \? \(pending > 0 \? 'active' : 'done'\) : 'pending'/)
})

test('Tmall approval board lifecycle stages are not hard-coded as completed', () => {
  const view = fs.readFileSync('app/src/renderer/views/TmallAiApprovalDrawer.vue', 'utf8')
  assert.match(view, /generationStageClass/)
  assert.match(view, /approvalStageClass/)
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

  assert.match(runner, /isCloudApprovalBoardUrl/)
  assert.match(runner, /searchParams\.has\('batch_uid'\)/)
  assert.match(runner, /cloudApprovalFrameUrl/)
  assert.match(runner, /buildEmbeddedCloudApprovalUrl\(approvalBoardUrl\.value\)/)
  assert.match(runner, /class="cloud-approval-embed"/)
  assert.match(runner, /<TmallAiApprovalDrawer[\s\S]*v-else-if="approvalBoardUrl"/)
  assert.match(runner, /isLocalTmallApprovalBoardUrl\(path\)/)
})

test('Tmall AI image runner avoids duplicate step titles under numbered tabs', () => {
  const runner = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')

  assert.match(runner, /<header v-if="!isTmallAiImageChainTask" class="runner-header">/)
  assert.match(runner, /\.ai-chain-tab\s*\{[^}]*align-items:\s*center;/s)
  assert.match(runner, /\.ai-chain-tab-index\s*\{[^}]*align-self:\s*center;/s)
  assert.doesNotMatch(runner, /v-if="isTmallAiImageChainTask" class="ai-chain-panel-head"/)
  assert.doesNotMatch(runner, /<div class="ai-chain-panel-head">[\s\S]*实际测图任务创建结果/)
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
