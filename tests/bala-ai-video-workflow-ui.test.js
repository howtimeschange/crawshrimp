import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as balaWorkflow from '../app/src/renderer/utils/balaAiVideoWorkflow.js'
import {
  buildBalaMaterialPrepareParams,
  buildBalaAiStageRequest,
  buildBalaVideoStageRequest,
  latestRunForTaskData,
  normalizeBalaMaterialGroups,
  normalizeBalaReviewBatchStyles,
  normalizeBalaTemplateCatalog,
  normalizeBalaVideoResultRows,
  normalizeStyleCodeLines,
  normalizeWorkflowStageStatus,
  parseRunOutputFiles,
  parseBalaReviewBoardUrl,
  summarizeBalaMaterialGroups,
  summarizeBalaReviewBatch,
} from '../app/src/renderer/utils/balaAiVideoWorkflow.js'

test('AI video workflow builds hidden Semir material prepare params from business fields', () => {
  const params = buildBalaMaterialPrepareParams({
    itemCodes: '208326102205\n208326102205，208326105214',
    cloudPath: ' 巴拉营运BU-商品//根目录/ ',
    exportFolder: ' /tmp/bala-video ',
    packageName: ' 第一批 ',
  })

  assert.deepEqual(normalizeStyleCodeLines('208326102205，208326102205\n208326105214'), [
    '208326102205',
    '208326105214',
  ])
  assert.equal(params.mode, 'new')
  assert.equal(params.folder_scan_depth, 2)
  assert.equal(params.duplicate_mode, 'first_per_hash')
  assert.equal(params.download_concurrency, 8)
  assert.equal(params.max_image_mb, 20)
  assert.equal(params.item_codes, '208326102205\n208326105214')
  assert.equal(params.cloud_path, '巴拉营运BU-商品//根目录/')
  assert.equal(params.export_folder, '/tmp/bala-video')
  assert.equal(params.package_name, '第一批')
})

test('AI video workflow normalizes task output files and material batch groups', () => {
  assert.deepEqual(parseRunOutputFiles('["/tmp/a.xlsx","/tmp/b.json"]'), ['/tmp/a.xlsx', '/tmp/b.json'])
  assert.equal(latestRunForTaskData({ runs: [{ id: 1 }, { id: 2 }] }, '2')?.id, 2)

  const groups = normalizeBalaMaterialGroups({
    fallbackCodes: ['208326108104'],
    batch: {
      status: 'selected',
      items: [{
        style_code: '208326102205',
        assets: [
          { id: 'm1', source_type: 'model', filename: 'front.jpg', path: '/tmp/front.jpg', image_url: '/image/m1', thumbnail_url: '/thumbnail/m1', selected: true },
          { id: 'd1', source_type: 'detail', filename: 'neck.jpg', path: '/tmp/neck.jpg', selected: false },
        ],
      }],
    },
    rows: [{
      输入款号: '208326102205',
      素材来源: '商品细节图',
      文件名: 'hangtag.jpg',
      下载结果: '已跳过',
      处理动作: '已过滤',
      备注: '标签类素材已过滤',
    }],
  })

  const main = groups.find(group => group.styleCode === '208326102205')
  assert.equal(main.modelPhotos.length, 1)
  assert.equal(main.modelPhotos[0].thumbnailUrl, '/thumbnail/m1')
  assert.equal(main.detailPhotos.length, 1)
  assert.equal(main.skippedRows.length, 1)
  assert.ok(groups.some(group => group.styleCode === '208326108104'))
  assert.deepEqual(summarizeBalaMaterialGroups(groups), {
    styleCount: 2,
    modelCount: 1,
    detailCount: 1,
    selectedCount: 1,
    skippedCount: 1,
    failedCount: 0,
  })
})

test('AI video workflow restores downloaded Excel rows into material groups without duplicating batch assets', () => {
  const downloadedRow = {
    输入款号: '208326102205',
    素材来源: '模拍图',
    文件名: '1-AI.jpg',
    下载结果: '已下载',
    本地文件: '/tmp/208326102205/01_模拍原图/1-AI.jpg',
    处理动作: '保留AI模拍图',
  }

  const rowOnlyGroups = normalizeBalaMaterialGroups({ rows: [downloadedRow] })
  assert.equal(rowOnlyGroups.length, 1)
  assert.equal(rowOnlyGroups[0].modelPhotos.length, 1)
  assert.equal(rowOnlyGroups[0].modelPhotos[0].path, downloadedRow.本地文件)
  assert.equal(rowOnlyGroups[0].modelPhotos[0].selected, false)

  const groupsWithBatch = normalizeBalaMaterialGroups({
    batch: {
      status: 'pending_selection',
      items: [{
        style_code: '208326102205',
        assets: [{
          id: 'model-1',
          source_type: 'model',
          filename: '1-AI.jpg',
          path: downloadedRow.本地文件,
          selected: true,
        }],
      }],
    },
    rows: [downloadedRow],
  })
  assert.equal(groupsWithBatch[0].modelPhotos.length, 1)
  assert.equal(groupsWithBatch[0].modelPhotos[0].selected, false)

  const persistedSelection = normalizeBalaMaterialGroups({
    batch: {
      status: 'selected',
      items: [{
        style_code: '208326102205',
        assets: [{
          id: 'model-1',
          source_type: 'model',
          filename: '1-AI.jpg',
          path: downloadedRow.本地文件,
          selected: true,
        }],
      }],
    },
  })
  assert.equal(persistedSelection[0].modelPhotos[0].selected, true)
})

test('AI edit source filtering preserves the reactive source object used by click selection', () => {
  const source = {
    name: 'front.jpg',
    selected: true,
    editSelected: false,
    versions: [
      { id: 'v1', editSelected: false, deleted: false },
      { id: 'v2', editSelected: true, deleted: false },
      { id: 'v3', editSelected: true, deleted: true },
    ],
  }
  const style = { modelPhotos: [source] }

  assert.equal(typeof balaWorkflow.selectEditableSourcesForStyle, 'function')
  const visible = balaWorkflow.selectEditableSourcesForStyle(style)
  assert.equal(visible[0], source)
  visible[0].editSelected = true
  assert.equal(source.editSelected, true)
  assert.deepEqual(
    balaWorkflow.selectVisibleEditableVersions(source, true).map(item => item.id),
    ['v2'],
  )
  assert.equal(balaWorkflow.selectEditableSourcesForStyle(style, true)[0], source)
})

test('AI model library applies age and gender filters together', () => {
  const items = [
    { id: 'girl-young', ageLabel: '幼童', gender: '女' },
    { id: 'boy-young', ageLabel: '幼童', gender: '男' },
    { id: 'boy-older', ageLabel: '中大童', gender: '男' },
  ]

  assert.equal(typeof balaWorkflow.filterBalaModelLibraryItems, 'function')
  assert.deepEqual(
    balaWorkflow.filterBalaModelLibraryItems(items, { age: '幼童', gender: '男' }).map(item => item.id),
    ['boy-young'],
  )
  assert.deepEqual(
    balaWorkflow.filterBalaModelLibraryItems(items, { age: '', gender: '男' }).map(item => item.id),
    ['boy-young', 'boy-older'],
  )
})

test('AI model labels hide internal numeric group identifiers', () => {
  assert.equal(typeof balaWorkflow.formatBalaModelDisplayLabel, 'function')
  const label = balaWorkflow.formatBalaModelDisplayLabel({
    group: '100',
    group_label: '100 男 幼童',
    age_label: '幼童',
    gender: '男',
    expression: '标准',
  })
  assert.equal(label, '幼童 / 男 / 标准')
  assert.doesNotMatch(label, /\b(?:66|73|100|140)\b/)
})

test('AI video workflow derives independent search and download progress', () => {
  assert.equal(typeof balaWorkflow.normalizeBalaMaterialProgress, 'function')
  const progress = balaWorkflow.normalizeBalaMaterialProgress({
    search_total_codes: 4,
    search_completed_codes: 3,
    download_total: 20,
    download_completed: 7,
    download_success: 6,
    download_failed: 1,
  })
  assert.deepEqual(progress, {
    searchTotal: 4,
    searchCompleted: 3,
    searchProgress: 75,
    downloadTotal: 20,
    downloadCompleted: 7,
    downloadProgress: 35,
    downloaded: 6,
    failed: 1,
  })
})

test('AI video workflow only binds material polling to a newly started run', () => {
  assert.equal(typeof balaWorkflow.selectNewTaskRun, 'function')
  assert.equal(balaWorkflow.selectNewTaskRun({
    live: { run_id: null, status: 'running' },
    last_run: { id: 6, status: 'done' },
  }, '6'), null)
  assert.deepEqual(balaWorkflow.selectNewTaskRun({
    live: { run_id: 7, status: 'running' },
    last_run: { id: 6, status: 'done' },
  }, '6'), {
    runId: '7',
    status: 'running',
    source: 'live',
    snapshot: { run_id: 7, status: 'running' },
  })
  assert.deepEqual(balaWorkflow.selectNewTaskRun({
    live: null,
    last_run: { id: 7, status: 'error', error: '目标页面启动失败' },
  }, '6'), {
    runId: '7',
    status: 'failed',
    source: 'last_run',
    snapshot: { id: 7, status: 'error', error: '目标页面启动失败' },
  })
})

test('AI and QN video launches wait for a newly started run instead of reusing history', async () => {
  assert.equal(typeof balaWorkflow.waitForNewTaskRun, 'function')
  const snapshots = [
    { live: null, last_run: { id: 6, status: 'done' } },
    { live: { run_id: 7, status: 'running' }, last_run: { id: 6, status: 'done' } },
  ]
  const launch = await balaWorkflow.waitForNewTaskRun({
    getStatus: async () => snapshots.shift(),
    previousRunId: '6',
    attempts: 2,
    delayMs: 0,
    sleepFn: async () => {},
  })
  assert.equal(launch.runId, '7')

  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  assert.match(source, /waitForAiImageRunStart\(previousRunId\)/)
  assert.match(source, /waitForQnVideoRunStart\(previousRunId\)/)
  assert.doesNotMatch(source, /initial\?\.live\?\.run_id \|\| initial\?\.last_run\?\.id/)
})

test('AI video workflow rebases runtime Excel paths into the selected workspace package', () => {
  assert.equal(typeof balaWorkflow.rebaseBalaMaterialRowsToWorkspace, 'function')
  const rows = balaWorkflow.rebaseBalaMaterialRowsToWorkspace({
    workspaceDir: '/Users/demo/巴拉AI视频工作区',
    outputFiles: [
      '/Users/demo/巴拉AI视频工作区/208326102205_20260715',
      '/Users/demo/巴拉AI视频工作区/巴拉AI视频素材准备结果.xlsx',
    ],
    rows: [{
      输入款号: '208326102205',
      素材来源: '模拍图',
      文件名: '1-AI.jpg',
      下载结果: '已下载',
      本地文件: '/runtime/6/208326102205/01_模拍原图/1-AI.jpg',
    }],
  })
  assert.equal(rows[0].本地文件, '/Users/demo/巴拉AI视频工作区/208326102205_20260715/208326102205/01_模拍原图/1-AI.jpg')

  assert.deepEqual(balaWorkflow.rebaseBalaMaterialRowsToWorkspace({
    workspaceDir: '/Users/demo/另一个工作区',
    outputFiles: ['/Users/demo/巴拉AI视频工作区/208326102205_20260715'],
    rows: [{ 本地文件: '/runtime/file.jpg' }],
  }), [])
})

test('AI video workflow status normalization maps runtime states to UI stages', () => {
  assert.equal(normalizeWorkflowStageStatus('running'), 'running')
  assert.equal(normalizeWorkflowStageStatus('done'), 'done')
  assert.equal(normalizeWorkflowStageStatus('partial_failed'), 'partial')
  assert.equal(normalizeWorkflowStageStatus('error'), 'failed')
  assert.equal(normalizeWorkflowStageStatus('stopped'), 'stopped')
})

test('buildBalaAiStageRequest targets AI generation with selected material images', () => {
  const request = buildBalaAiStageRequest({
    next_task: {
      adapter_id: 'bala-ai-video-assistant',
      task_id: 'bala_ai_face_background_generate',
      params: {
        operation_type: 'pose_swap',
        source_images: { paths: ['/tmp/model.jpg'] },
        pose_prompt: '自然侧身行走',
      },
    },
  })

  assert.equal(request.adapterId, 'bala-ai-video-assistant')
  assert.equal(request.taskId, 'bala_ai_face_background_generate')
  assert.equal(request.params.operation_type, 'pose_swap')
  assert.deepEqual(request.params.source_images.paths, ['/tmp/model.jpg'])
})

test('Bala model library picker exposes visual age and gender filters', () => {
  const source = fs.readFileSync('app/src/renderer/components/BalaModelLibraryPickerModal.vue', 'utf8')

  assert.match(source, /选择 AI 模特素材/)
  assert.match(source, /新生儿/)
  assert.match(source, /婴童/)
  assert.match(source, /幼童/)
  assert.match(source, /中大童/)
  assert.match(source, /通用/)
  assert.match(source, /女/)
  assert.match(source, /男/)
  assert.match(source, /image_url/)
  assert.match(source, /selectedModelIds/)
  assert.match(source, /confirmSelection/)
})

test('TaskRunner opens Bala material selection drawer after Semir material preparation', () => {
  const source = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')

  assert.match(source, /BalaAiMaterialSelectionDrawer/)
  assert.match(source, /createBalaMaterialBatch/)
  assert.match(source, /semir_video_material_prepare/)
  assert.match(source, /@start-ai-stage=/)
  assert.match(source, /emit\('open-task'/)
})

test('App handles Bala workflow open-task handoff with initial params', () => {
  const source = fs.readFileSync('app/src/renderer/App.vue', 'utf8')

  assert.match(source, /@open-task="openTaskFromRunner"/)
  assert.match(source, /taskRunnerHandoffParams/)
  assert.match(source, /taskRunnerHandoffKey/)
  assert.match(source, /function openTaskFromRunner/)
  assert.match(source, /activeTaskId\.value = taskId/)
})

test('Bala review helpers parse board URL and build qn video handoff params', () => {
  const parsed = parseBalaReviewBoardUrl('http://127.0.0.1:18765/bala-ai-video-review/bala-1?token=abc')
  assert.deepEqual(parsed, { batchId: 'bala-1', token: 'abc' })

  const request = buildBalaVideoStageRequest({
    next_task: {
      adapter_id: 'bala-ai-video-assistant',
      task_id: 'qn_img2video_batch',
      params: {
        material_images: { paths: ['/tmp/approved.png'] },
        download_template_previews: true,
        download_videos: true,
      },
    },
  })
  assert.equal(request.taskId, 'qn_img2video_batch')
  assert.deepEqual(request.params.material_images.paths, ['/tmp/approved.png'])
  assert.equal(request.params.download_template_previews, true)
  assert.equal(request.params.download_videos, true)

  const summary = summarizeBalaReviewBatch({
    items: [{ assets: [
      { kind: 'origin', status: 'pending' },
      { kind: 'ai', status: 'pending' },
      { kind: 'ai', status: 'approved' },
    ] }],
  })
  assert.deepEqual(summary, { total: 3, pending: 2, approved: 1, rejected: 0, generating: 0, failed: 0 })
})

test('AI video workflow maps real review batch assets into style cards', () => {
  const styles = normalizeBalaReviewBatchStyles({
    items: [{
      style_code: '208326102205',
      assets: [
        { id: 'origin-1', kind: 'origin', path: '/tmp/source.jpg', status: 'reference' },
        {
          id: 'ai-1',
          kind: 'ai',
          status: 'approved',
          operation_type: 'background_swap',
          path: '/tmp/result.png',
          source_path: '/tmp/source.jpg',
          image_url: '/bala-ai-video-review/api/batch/image/ai-1?token=t',
        },
      ],
    }],
  })

  assert.equal(styles.length, 1)
  assert.equal(styles[0].styleCode, '208326102205')
  assert.equal(styles[0].sourceAssets[0].role, '原图')
  assert.equal(styles[0].sourceAssets[0].action, '原图')
  assert.equal(styles[0].sourceAssets[0].operationType, 'origin')
  assert.equal(styles[0].assets[0].status, 'approved')
  assert.equal(styles[0].assets[0].action, 'AI 换背景')
})

test('AI video workflow wires outfit references and settings handoff in the fixed entry', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const appSource = fs.readFileSync('app/src/renderer/App.vue', 'utf8')

  assert.match(source, /pickOutfitImages/)
  assert.match(source, /garment_images/)
  assert.match(source, /outfit_reference_images/)
  assert.match(source, /variant_reference_images/)
  assert.match(source, /开始生图/)
  assert.match(source, /emit\('open-settings', 'ai-video'\)/)
  assert.match(appSource, /<AiVideoWorkflow[\s\S]*@open-settings="openSettingsPanel"/)
})

test('AI video material step uses a native directory picker, dual progress, launch verification, and restore', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')

  assert.doesNotMatch(source, /<input v-model="materialOutputDir"/)
  assert.match(source, /pickMaterialOutputDirectory/)
  assert.match(source, /选择 AI 视频工作区目录/)
  assert.match(source, /directory:\s*true/)
  assert.match(source, /找款进度/)
  assert.match(source, /下载进度/)
  assert.match(source, /materialTask\.searchProgress/)
  assert.match(source, /materialTask\.downloadProgress/)
  assert.match(source, /waitForMaterialRunStart/)
  assert.match(source, /素材下载页面或任务未成功启动/)
  assert.match(source, /restoreLatestMaterialTask/)
  assert.match(source, /工作区目录/)
  assert.match(source, /const workspaceDir = ref/)
  assert.match(source, /const materialOutputDir = workspaceDir/)
  assert.match(source, /const videoOutputDir = workspaceDir/)
  assert.match(source, /BALA_AI_VIDEO_WORKSPACE_STORAGE_KEY/)
  assert.match(source, /localStorage\.getItem\(BALA_AI_VIDEO_WORKSPACE_STORAGE_KEY\)/)
  assert.match(source, /localStorage\.setItem\(BALA_AI_VIDEO_WORKSPACE_STORAGE_KEY/)
  assert.match(source, /resetMaterialWorkspace/)
  assert.match(source, /rebaseBalaMaterialRowsToWorkspace/)
  assert.doesNotMatch(source, /<input v-model="videoOutputDir"/)
  assert.match(source, /pickVideoOutputDirectory/)
  assert.match(source, /@click="toggleMaterialSelection\(asset\)"/)
  assert.match(source, /aiv-thumb-zoom/)
  assert.match(source, /@click\.stop="openImagePreview\(asset, activeMaterialGroup\.styleCode\)"/)
  assert.match(source, /aiv-material-sticky-actions/)
  assert.match(source, /\.aiv-params-panel[\s\S]*?overflow-y:\s*auto/)
  assert.match(source, /\.aiv-source-board\.compact section[\s\S]*?align-content:\s*start/)
  assert.match(source, /MATERIAL_RENDER_CHUNK\s*=\s*20/)
  assert.match(source, /visibleMaterialAssets/)
  assert.match(source, /showMoreMaterialAssets/)
  assert.match(source, /loading="lazy"/)
  assert.match(source, /decoding="async"/)
  assert.match(source, /thumbnailSourceFor\(asset\)/)
  assert.match(source, /:src="thumbnailSourceFor\(asset\)"/)
  assert.match(source, /加载更多/)
})

test('AI video image workbench groups expose an obvious accessible accordion action', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')

  assert.match(source, /:aria-expanded="isMaterialExpanded\(/)
  assert.match(source, /:aria-controls="`image-workbench-\$\{style\.styleCode\}`"/)
  assert.match(source, /class="aiv-collapse-action"/)
  assert.match(source, /展开素材/)
  assert.match(source, /收起素材/)
  assert.match(source, /\.aiv-collapse-head:hover/)
  assert.match(source, /\.aiv-collapse-head:focus-visible/)
  assert.match(source, /\.aiv-collapse-head:active/)
  assert.doesNotMatch(source, /aiv-collapse-icon/)
})

test('AI video material preview shows one style and one source tab at a time, defaulting to model photos', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const materialTemplate = source.slice(
    source.indexOf('<section class="aiv-panel aiv-material-results-panel">'),
    source.indexOf('<section v-else-if="activeStep === \'ai-edit\'"'),
  )

  assert.match(materialTemplate, /class="aiv-material-style-tabs" role="tablist"/)
  assert.match(materialTemplate, /role="tab"[\s\S]*?:aria-selected="activeMaterialStyleCode === item\.styleCode"/)
  assert.match(materialTemplate, /class="aiv-material-source-tabs" role="tablist"/)
  assert.match(materialTemplate, /@click="selectMaterialSource\('model'\)"/)
  assert.match(materialTemplate, /@click="selectMaterialSource\('detail'\)"/)
  assert.match(materialTemplate, /v-if="activeMaterialSource === 'model'"/)
  assert.match(materialTemplate, /v-else-if="activeMaterialSource === 'detail'"/)
  assert.doesNotMatch(materialTemplate, /aiv-collapse-head/)
  assert.match(source, /const activeMaterialSource = ref\('model'\)/)
  assert.match(source, /function selectMaterialStyle\(styleCode\)[\s\S]*?activeMaterialSource\.value = 'model'/)
})

test('AI video material tabs stay in fixed rows above the independently scrolling image area', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const materialTemplate = source.slice(
    source.indexOf('<section class="aiv-panel aiv-material-results-panel">'),
    source.indexOf('<section v-else-if="activeStep === \'ai-edit\'"'),
  )
  const headerIndex = materialTemplate.indexOf('</header>')
  const styleTabsIndex = materialTemplate.indexOf('class="aiv-material-style-tabs"')
  const sourceTabsIndex = materialTemplate.indexOf('class="aiv-material-source-switcher"')
  const scrollBodyIndex = materialTemplate.indexOf('class="aiv-panel-body aiv-style-list"')

  assert.ok(headerIndex < styleTabsIndex)
  assert.ok(styleTabsIndex < sourceTabsIndex)
  assert.ok(sourceTabsIndex < scrollBodyIndex)
  assert.match(source, /\.aiv-material-results-panel\s*\{[\s\S]*?grid-template-rows:\s*auto auto auto minmax\(0, 1fr\) auto/)
  assert.doesNotMatch(source, /\.aiv-material-style-tabs\s*\{[^}]*position:\s*sticky/)
  assert.doesNotMatch(source, /\.aiv-material-source-switcher\s*\{[^}]*position:\s*sticky/)

  const switcherCssStart = source.indexOf('.aiv-material-source-switcher {')
  const switcherCss = source.slice(switcherCssStart, source.indexOf('}', switcherCssStart) + 1)
  assert.match(switcherCss, /margin:\s*0/)
  assert.match(switcherCss, /border-left:\s*0/)
  assert.match(switcherCss, /border-right:\s*0/)
  assert.match(switcherCss, /border-radius:\s*0/)
})

test('AI video review step restores all persisted review batches with a latest-run fallback after remount', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')

  assert.match(source, /@click="selectWorkflowStep\(step\.id\)"/)
  assert.match(source, /async function selectWorkflowStep\(stepId\)/)
  assert.match(source, /stepId === 'review'[\s\S]*?loadLatestReviewBatch\(\)/)
  assert.match(source, /async function restoreLatestReviewBatch\(/)
  assert.match(source, /window\.cs\.getData\(BALA_AI_VIDEO_ADAPTER_ID, BALA_AI_IMAGE_TASK_ID\)/)
  assert.match(source, /onMounted\(\(\) => \{[\s\S]*?restoreReviewWorkspaceBatches\(\{ silent: true \}\)[\s\S]*?if \(!restoredBatchCount\) await restoreLatestReviewBatch\(\{ silent: true \}\)/)
  assert.match(source, /async function refreshReviewBatch\(\)[\s\S]*?if \(!boardUrls\.length\) \{[\s\S]*?loadLatestReviewBatch\(\)/)
})

test('AI video step navigation restores the latest review assets before creating video tasks', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')

  assert.match(
    source,
    /async function selectWorkflowStep\(stepId\)[\s\S]*?stepId === 'templates'[\s\S]*?loadLatestReviewBatch\(\)[\s\S]*?buildVideoJobsFromReview\(\)/,
  )
})

test('Bala material prepare defaults to a new browser page', () => {
  const manifestSource = fs.readFileSync('adapters/bala-ai-video-assistant/manifest.yaml', 'utf8')
  const materialTaskBlock = manifestSource.split('  - id: bala_ai_face_background_generate')[0]
  assert.match(materialTaskBlock, /- id: mode[\s\S]*?default: new/)
  assert.match(materialTaskBlock, /label: 全新页面（推荐）/)
})

test('AI video workflow normalizes local template catalog and qn result rows', () => {
  const templates = normalizeBalaTemplateCatalog({
    templates: [{
      templateId: '641241_62536236_21',
      title: '领口',
      slotDescription: '7:模特全身(必填)',
      ratio: '3:4',
      duration: 13,
      localPreviewVideo: '/tmp/template.mp4',
      localCoverImage: '/tmp/template.png',
    }],
  })
  assert.equal(templates[0].id, '641241_62536236_21')
  assert.equal(templates[0].description, '7:模特全身(必填)')
  assert.equal(templates[0].video, '/tmp/template.mp4')

  const results = normalizeBalaVideoResultRows([{
    款号: '208326102205',
    模板名称: '领口',
    提交任务ID: 'task-1',
    本地视频文件: '/tmp/out.mp4',
    执行结果: '成功',
  }], { provider: 'qn' })
  assert.equal(results[0].styleCode, '208326102205')
  assert.equal(results[0].status, '已完成')
  assert.equal(results[0].progress, 100)
  assert.equal(results[0].path, '/tmp/out.mp4')
})

test('Bala image review drawer exposes approval, retry, refresh, and video handoff actions', () => {
  const source = fs.readFileSync('app/src/renderer/views/BalaAiImageReviewDrawer.vue', 'utf8')

  assert.match(source, /巴拉 AI 图片审核/)
  assert.match(source, /getBalaReviewBatch/)
  assert.match(source, /saveBalaReviewDecisions/)
  assert.match(source, /refreshBalaReviewBatch/)
  assert.match(source, /regenerateBalaReviewAsset/)
  assert.match(source, /exportBalaVideoInput/)
  assert.match(source, /start-video-stage/)
  assert.match(source, /进入视频生成/)
  assert.match(source, /submit_async:\s*true/)
})

test('review retry keeps display status out of the generation prompt', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const start = source.indexOf('async function requestReviewAssetRetry')
  const end = source.indexOf('function reviewSummaryCounts', start)
  const retrySource = source.slice(start, end)

  assert.match(retrySource, /const retryPrompt =/)
  assert.match(retrySource, /prompt:\s*retryPrompt/)
  assert.doesNotMatch(retrySource, /prompt:\s*asset\.meta/)
  assert.doesNotMatch(retrySource, /asset\.prompt\s*\|\|\s*asset\.meta/)
})

test('review approvals become video-selectable only after the durable save succeeds', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const singleStart = source.indexOf('async function setReviewAssetStatus')
  const singleEnd = source.indexOf('async function setStyleReviewStatus', singleStart)
  const bulkStart = source.indexOf('async function saveReviewAssetsStatus')
  const bulkEnd = source.indexOf('async function refreshReviewBatch', bulkStart)
  const singleSource = source.slice(singleStart, singleEnd)
  const bulkSource = source.slice(bulkStart, bulkEnd)

  assert.doesNotMatch(singleSource, /asset\.status\s*=\s*normalized/)
  assert.doesNotMatch(singleSource, /syncWorkspaceReviewDecision\(asset, normalized\)/)
  assert.doesNotMatch(singleSource, /asset\.reviewBoardUrl\s*\|\|\s*reviewBoardUrl\.value/)
  assert.doesNotMatch(bulkSource, /asset\.status\s*=\s*status/)
  assert.doesNotMatch(bulkSource, /syncWorkspaceReviewDecision\(asset, status\)/)
  assert.doesNotMatch(bulkSource, /asset\.reviewBoardUrl\s*\|\|\s*reviewBoardUrl\.value/)
  assert.match(singleSource, /await window\.cs\.saveBalaReviewDecisions/)
  assert.match(bulkSource, /await window\.cs\.saveBalaReviewDecisions/)
  assert.match(singleSource, /if \(!ref\) \{[\s\S]*?applyLocalReviewDecision\(asset, normalized\)[\s\S]*?return/)
  assert.match(bulkSource, /const localAssets = \[\]/)
  assert.match(bulkSource, /localAssets\.push\(asset\)/)
  assert.match(bulkSource, /for \(const asset of localAssets\) applyLocalReviewDecision\(asset, status\)/)
})

test('video tasks and provider results persist across reloads with real refresh and download actions', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const templateSource = source.split('<script setup>')[0]
  const preload = fs.readFileSync('app/src/preload.js', 'utf8')
  const devBridge = fs.readFileSync('app/src/renderer/utils/devCsBridge.js', 'utf8')
  const main = fs.readFileSync('app/src/main.js', 'utf8')

  assert.match(source, /BALA_AI_VIDEO_STATE_STORAGE_KEY/)
  assert.match(source, /function persistVideoWorkflowState/)
  assert.match(source, /function restoreVideoWorkflowState/)
  assert.match(source, /onMounted\(\(\) => \{[\s\S]*?restoreVideoWorkflowState\(\)/)
  assert.match(source, /providerTaskId/)
  assert.match(templateSource, /@click="refreshVideoResults"/)
  assert.match(templateSource, /@click="downloadCompletedVideoResults"/)
  assert.match(source, /async function refreshVideoResults/)
  assert.match(source, /async function downloadCompletedVideoResults/)
  assert.match(source, /refreshBalaVideoProviderTask/)
  assert.match(preload, /refreshBalaVideoProviderTask/)
  assert.match(devBridge, /refreshBalaVideoProviderTask/)
  assert.match(main, /refresh-bala-video-provider-task/)
})

test('TaskRunner opens Bala image review drawer after AI generation', () => {
  const source = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')

  assert.match(source, /BalaAiImageReviewDrawer/)
  assert.match(source, /bala_ai_face_background_generate/)
  assert.match(source, /findBalaReviewBoardUrl/)
  assert.match(source, /maybeOpenBalaImageReview/)
  assert.match(source, /@start-video-stage=/)
})

test('Bala review bridge is exposed in preload and dev fallback', () => {
  const preload = fs.readFileSync('app/src/preload.js', 'utf8')
  const devBridge = fs.readFileSync('app/src/renderer/utils/devCsBridge.js', 'utf8')

  for (const source of [preload, devBridge]) {
    assert.match(source, /getBalaReviewBatch/)
    assert.match(source, /saveBalaReviewDecisions/)
    assert.match(source, /refreshBalaReviewBatch/)
    assert.match(source, /regenerateBalaReviewAsset/)
    assert.match(source, /exportBalaVideoInput/)
    assert.match(source, /listBalaVideoTemplates/)
    assert.match(source, /runBalaSeedanceVideo/)
    assert.match(source, /\/bala-ai-video-review\/api/)
    assert.match(source, /\/bala-ai-video-templates\/api/)
    assert.match(source, /\/bala-ai-video-seedance\/api\/run/)
  }
})

test('AI video workflow exposes HappyHorse as an explicit video task provider', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const templateSource = source.split('<script setup>')[0]

  assert.match(templateSource, /百炼 HappyHorse/)
  assert.match(templateSource, /文生视频/)
  assert.match(templateSource, /图生视频/)
  assert.match(templateSource, /参考生视频/)
  assert.match(source, /runBalaHappyHorseVideo/)
  assert.match(source, /getBalaVideoProviderStatus/)
  assert.doesNotMatch(templateSource, /semir_video_material_prepare/)
  assert.doesNotMatch(templateSource, /integrations\/(?:seedanceCLI|bailianCLI)/)
  assert.doesNotMatch(templateSource, /(?:ARK|DASHSCOPE)_API_KEY/)
})

test('Seedance privacy protection falls back to a text-only original-person task', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const start = source.indexOf('async function runSeedanceVideoTask')
  const end = source.indexOf('async function runHappyHorseVideoTask', start)
  const runner = source.slice(start, end)

  assert.equal(typeof balaWorkflow.isSeedancePrivacyProtectionError, 'function')
  assert.equal(balaWorkflow.isSeedancePrivacyProtectionError(
    new Error('InputImageSensitiveContentDetected.PrivacyInformation: input image may contain real person'),
  ), true)
  assert.equal(balaWorkflow.isSeedancePrivacyProtectionError(new Error('quota exceeded')), false)
  assert.match(runner, /catch \(error\)[\s\S]*?isSeedancePrivacyProtectionError\(error\)/)
  assert.match(runner, /image_paths:\s*\[\]/)
})

test('AI video workflow only downloads software-manager previews when a template is selected', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const start = source.indexOf('function buildQnVideoTaskParams')
  const end = source.indexOf('function upsertVideoResults', start)
  const builder = source.slice(start, end)

  assert.match(builder, /download_template_previews:\s*Boolean\(task\.template\)/)
  assert.match(builder, /ratio:\s*'3:4'/)
})

test('legacy provider wording is migrated when persisted video tasks and results are restored', () => {
  const legacyProviderName = ['软件', '管家'].join('')

  assert.equal(typeof balaWorkflow.migrateBalaBusinessManagerText, 'function')
  assert.equal(typeof balaWorkflow.normalizeBalaVideoTaskProvider, 'function')
  assert.equal(
    balaWorkflow.migrateBalaBusinessManagerText(`208326102205 · ${legacyProviderName} 视频任务 01`),
    '208326102205 · 生意管家 视频任务 01',
  )
  assert.equal(
    balaWorkflow.migrateBalaBusinessManagerText(`${legacyProviderName}页面加载超时`),
    '生意管家页面加载超时',
  )
  assert.equal(balaWorkflow.normalizeBalaVideoTaskProvider(legacyProviderName), 'qn')
  assert.equal(balaWorkflow.normalizeBalaVideoTaskProvider('生意管家页面生成'), 'qn')
  assert.equal(balaWorkflow.normalizeBalaVideoTaskProvider('qn'), 'qn')

  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const taskStart = source.indexOf('function persistedVideoTask')
  const resultStart = source.indexOf('function persistedVideoResult', taskStart)
  const persistStart = source.indexOf('function persistVideoWorkflowState', resultStart)
  const taskSource = source.slice(taskStart, resultStart)
  const resultSource = source.slice(resultStart, persistStart)

  assert.match(taskSource, /title:\s*migrateBalaBusinessManagerText\(/)
  assert.match(taskSource, /provider:\s*normalizeBalaVideoTaskProvider\(/)
  assert.match(taskSource, /prompt:\s*migrateBalaBusinessManagerText\(/)
  assert.match(taskSource, /status:\s*migrateBalaBusinessManagerText\(/)
  assert.match(resultSource, /template:\s*migrateBalaBusinessManagerText\(/)
  assert.match(resultSource, /provider:\s*migrateBalaBusinessManagerText\(/)
  assert.match(resultSource, /error:\s*migrateBalaBusinessManagerText\(/)
})

test('Bala business surfaces consistently call the QN provider business-manager', () => {
  const legacyProviderName = ['软件', '管家'].join('')
  const businessSurfacePaths = [
    'adapters/bala-ai-video-assistant/manifest.yaml',
    'adapters/bala-ai-video-assistant/notes/img2video-dom-api-findings-2026-07-15.md',
    'adapters/bala-ai-video-assistant/qn-img2video-batch.js',
    'app/src/renderer/utils/balaAiVideoWorkflow.js',
    'app/src/renderer/views/AiVideoWorkflow.vue',
    'core/api_server.py',
    'docs/superpowers/plans/2026-07-15-bala-ai-video-image-review-workflow.md',
    'docs/superpowers/plans/2026-07-15-bala-ai-video-workflow-codereview-handoff.md',
    'docs/superpowers/plans/2026-07-15-bala-ai-video-workflow-operational-completion.md',
    'docs/superpowers/specs/2026-07-14-bala-ai-video-automation-workflow.md',
    'docs/superpowers/specs/2026-07-15-bala-ai-video-workflow-design-review.md',
    'docs/superpowers/specs/2026-07-15-bala-ai-video-workflow-entry-design.html',
    'docs/superpowers/specs/2026-07-15-bala-ai-video-workflow-entry-design.md',
    'tests/bala-ai-video-workflow-ui.test.js',
  ]

  for (const filePath of businessSurfacePaths) {
    const source = fs.readFileSync(filePath, 'utf8')
    assert.equal(source.includes(legacyProviderName), false, `${filePath} still contains the legacy provider name`)
  }
})

test('software-manager terminal failures stay failed instead of becoming preflight success', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const finalizeStart = source.indexOf('async function finalizeQnVideoTask')
  const finalizeEnd = source.indexOf('async function waitForQnVideoTask', finalizeStart)
  const finalizeSource = source.slice(finalizeStart, finalizeEnd)

  assert.equal(typeof balaWorkflow.qnTerminalRunFailure, 'function')
  assert.equal(balaWorkflow.qnTerminalRunFailure({ status: 'done' }), '')
  assert.equal(
    balaWorkflow.qnTerminalRunFailure({
      status: 'error',
      error: '生意管家页面加载超时，请保留已登录页面后重试',
    }),
    '生意管家页面加载超时，请保留已登录页面后重试',
  )
  assert.match(finalizeSource, /qnTerminalRunFailure\(terminalSnapshot\)/)
  assert.match(finalizeSource, /if \(terminalFailure\) \{[\s\S]*?status:\s*'失败'[\s\S]*?path:\s*''[\s\S]*?throw new Error\(terminalFailure\)/)
})

test('software-manager failed output rows fail the parent video task', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const finalizeStart = source.indexOf('async function finalizeQnVideoTask')
  const finalizeEnd = source.indexOf('async function waitForQnVideoTask', finalizeStart)
  const finalizeSource = source.slice(finalizeStart, finalizeEnd)

  assert.equal(typeof balaWorkflow.qnVideoResultFailure, 'function')
  assert.equal(balaWorkflow.qnVideoResultFailure([{ status: '已完成' }]), '')
  assert.match(
    balaWorkflow.qnVideoResultFailure([{ status: '失败', error: '视频下载失败' }]),
    /1 条失败.*视频下载失败/,
  )
  assert.match(finalizeSource, /const rowFailure = qnVideoResultFailure\(normalized\)/)
  assert.match(finalizeSource, /if \(rowFailure\) throw new Error\(rowFailure\)/)
})

test('AI video task summary uses live counts and failed results expose their reason', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const templateSource = source.split('<script setup>')[0]

  assert.match(templateSource, /<strong>\{\{ videoJobs\.length \}\} 款<\/strong>/)
  assert.match(templateSource, /v-if="item\.error" class="aiv-result-error"/)
  assert.match(templateSource, /\{\{ item\.error \}\}/)
})

test('failed video results without an output hide file actions and return to generation', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const templateSource = source.split('<script setup>')[0]

  assert.match(templateSource, /v-if="videoResultHasOutput\(item\)"[^>]*@click="openVideoResult\(item\)"/)
  assert.match(templateSource, /v-if="canRetryVideoResult\(item\)"[^>]*@click="retryVideoResult\(item\)"/)
  assert.match(templateSource, /v-if="!videoResultHasOutput\(item\) && !canRetryVideoResult\(item\)"[^>]*@click="activeStep = 'templates'"/)
})

test('video task directory and image pickers use accessible explicit controls', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const templateSource = source.split('<script setup>')[0]

  assert.match(templateSource, /@click="pickVideoTaskOutputDirectory"/)
  assert.doesNotMatch(templateSource, /<input v-model="videoTaskDraft\.outputDir"/)
  assert.doesNotMatch(templateSource, /@dblclick="openImagePreview\(asset, videoTaskDraft\.styleCode\)"/)
  assert.match(templateSource, /:aria-pressed="videoTaskDraft\.assetIds\.includes\(asset\.id\)"/)
  assert.match(templateSource, /:aria-pressed="asset\.selected"/)
  assert.match(templateSource, /:aria-pressed="selectedModel\?\.id === model\.id"/)
  assert.match(templateSource, /:aria-pressed="selectedTemplateId === template\.id"/)
  assert.match(templateSource, /class="aiv-video-asset-zoom"/)
})

test('HappyHorse bridge is exposed in preload and browser fallback', () => {
  const preload = fs.readFileSync('app/src/preload.js', 'utf8')
  const devBridge = fs.readFileSync('app/src/renderer/utils/devCsBridge.js', 'utf8')

  for (const source of [preload, devBridge]) {
    assert.match(source, /getBalaVideoProviderStatus/)
    assert.match(source, /runBalaHappyHorseVideo/)
    assert.match(source, /\/bala-ai-video-providers\/api\/status/)
    assert.match(source, /\/bala-ai-video-happyhorse\/api\/run/)
  }
})

test('AI capability settings provide local secret fields for video providers', () => {
  const settings = fs.readFileSync('app/src/renderer/views/SettingsPage.vue', 'utf8')

  assert.match(settings, /id: 'ai-video'/)
  assert.match(settings, /ai\.video\.seedance_api_key/)
  assert.match(settings, /ai\.video\.bailian_api_key/)
  assert.match(settings, /type="password"/)
})

test('material thumbnails prioritize the currently rendered 20 cards without personal-path defaults', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const templateSource = source.split('<script setup>')[0]

  assert.doesNotMatch(templateSource, /fetchpriority="low"/)
  assert.match(templateSource, /loading="eager"/)
  assert.doesNotMatch(source, /DEFAULT_BALA_AI_VIDEO_WORKSPACE_DIR\s*=\s*['"]\/Users\//)
  assert.match(source, /const workspaceDir = ref\(loadStoredWorkspaceDir\(\)\)/)
})

test('AI edit workspace treats selection as operation scope and exposes shared edit tools', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const templateSource = source.split('<script setup>')[0]
  const finalizeStart = source.indexOf('async function finalizeAiImageTask')
  const finalizeEnd = source.indexOf('async function loadReviewBatchFromBoard', finalizeStart)
  const finalizeSource = source.slice(finalizeStart, finalizeEnd)

  assert.match(source, /PromptLibraryPickerModal/)
  assert.match(source, /TldrawAnnotationLayer/)
  assert.match(templateSource, /本地素材库/)
  assert.match(templateSource, /从 Prompt 库选择/)
  assert.match(templateSource, /aiv-selected-model-preview/)
  assert.match(templateSource, /aiv-edit-sticky-actions/)
  assert.match(templateSource, /删除生成结果/)
  assert.match(templateSource, /生成历史/)
  assert.doesNotMatch(templateSource, /选中的版本会进入审核池/)
  assert.doesNotMatch(finalizeSource, /activeStep\.value = 'review'/)
  assert.match(source, /function buildReviewWorkspaceStyles/)
  assert.match(source, /const selectedInputPaths = selectedSources\.map/)
  assert.match(source, /source_images:\s*\{\s*paths:\s*selectedInputPaths\s*\}/)
  assert.match(source, /source_limit:\s*selectedInputPaths\.length/)
  assert.match(source, /\.aiv-edit-action-panel[\s\S]*?overflow:\s*hidden/)
  assert.match(source, /\.aiv-edit-action-panel \.aiv-panel-body[\s\S]*?overflow-y:\s*auto/)
  assert.match(source, /\.aiv-edit-style-list[\s\S]*?align-content:\s*start/)
})

test('deleting an AI result requires confirmation and removes the authorized local image', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const templateSource = source.split('<script setup>')[0]
  const deleteStart = source.indexOf('async function confirmDeleteGeneratedVersion')
  const deleteEnd = source.indexOf('async function refreshReviewBatch', deleteStart)
  const deleteSource = source.slice(deleteStart, deleteEnd)
  const preload = fs.readFileSync('app/src/preload.js', 'utf8')
  const main = fs.readFileSync('app/src/main.js', 'utf8')

  assert.match(templateSource, /确认删除本地图片/)
  assert.match(templateSource, /删除后无法撤销/)
  assert.match(source, /window\.cs\.deleteBalaWorkspaceImage/)
  assert.match(source, /window\.cs\.deleteBalaReviewAsset/)
  assert.match(preload, /deleteBalaWorkspaceImage/)
  assert.match(preload, /deleteBalaReviewAsset/)
  assert.match(main, /delete-bala-workspace-image/)
  assert.match(main, /rememberAuthorizedBalaWorkspaceRoot/)
  assert.match(main, /loadAuthorizedBalaWorkspaceRoots/)
  assert.match(main, /authorized-bala-workspaces\.json/)
  assert.match(deleteSource, /const remoteAssetId = String\(reviewAsset\?\.remoteAssetId/)
  assert.match(deleteSource, /const boardUrl = reviewAsset\?\.reviewBoardUrl/)
  assert.doesNotMatch(deleteSource, /reviewAsset\?\.reviewBoardUrl \|\| reviewBoardUrl\.value/)
  assert.doesNotMatch(source, /lastDeletedVersion/)
  assert.doesNotMatch(templateSource, /撤销删除/)
})

test('precise image edits archive the generated result inside the selected workspace before adding history', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const editStart = source.indexOf('async function runPreviewImageEdit')
  const editEnd = source.indexOf('function providerLabel', editStart)
  const editSource = source.slice(editStart, editEnd)

  assert.match(source, /async function archivePreviewOutputToWorkspace\(/)
  assert.match(editSource, /const current = activePreviewHistoryItem\.value/)
  assert.match(editSource, /main_image_path:\s*mainPath/)
  assert.doesNotMatch(editSource, /selectedSourceAssetsForAi\(/)
  assert.match(source, /window\.cs\.saveAsAiImageJob\(jobUid,\s*\{[\s\S]*?directory:\s*workspaceDir\.value[\s\S]*?files:\s*\[source\]/)
  assert.match(editSource, /const localOutputPath = await archivePreviewOutputToWorkspace\(jobUid, output\)/)
  assert.match(editSource, /if \(!localOutputPath\) throw new Error\('大图修改结果未能保存到当前工作区'\)/)
  assert.match(editSource, /previewPath:\s*localOutputPath/)
})

test('review workspace includes originals and every non-deleted AI result', () => {
  assert.equal(typeof balaWorkflow.buildBalaReviewWorkspaceStyles, 'function')
  const styles = balaWorkflow.buildBalaReviewWorkspaceStyles([{
    styleCode: '208326102205',
    modelPhotos: [{
      id: 'source-1',
      name: 'front.jpg',
      path: '/tmp/front.jpg',
      sourceType: 'model',
      selected: true,
      versions: [
        { id: 'ai-face', operationType: 'face_swap', label: '换脸结果', previewPath: '/tmp/face.png' },
        { id: 'ai-bg', operationType: 'background_swap', label: '背景结果', previewPath: '/tmp/bg.png', deleted: true },
      ],
    }],
    detailPhotos: [{ id: 'detail-1', name: 'neck.jpg', path: '/tmp/neck.jpg', sourceType: 'detail' }],
  }])

  assert.equal(styles.length, 1)
  assert.deepEqual(styles[0].assets.map(asset => [asset.id, asset.kind, asset.status]), [
    ['source-1', 'origin', 'pending'],
    ['ai-face', 'ai', 'pending'],
  ])
  assert.equal(styles[0].sourceAssets.length, 1)

  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  assert.match(source, /reviewAssetCount\(style, 'origin'\).*张原图/)
  assert.match(source, /reviewAssetCount\(style, 'ai'\).*张 AI 图/)
})

test('review workspace merges remote origin decisions by path and keeps remote-only retries', () => {
  assert.equal(typeof balaWorkflow.mergeBalaReviewWorkspaceStyles, 'function')
  const local = [{
    styleCode: '208326102205',
    assets: [
      { id: 'local-origin', kind: 'origin', path: '/tmp/source.jpg', sourcePath: '/tmp/source.jpg', status: 'pending' },
      { id: 'local-ai', kind: 'ai', path: '/tmp/ai.png', sourcePath: '/tmp/source.jpg', status: 'pending' },
    ],
    sourceAssets: [{ id: 'detail-1', kind: 'reference', path: '/tmp/detail.jpg' }],
  }]
  const remote = [{
    styleCode: '208326102205',
    assets: [
      { id: 'remote-ai', kind: 'ai', path: '/tmp/ai.png', sourcePath: '/tmp/source.jpg', status: 'approved' },
      { id: 'retry-new', kind: 'ai', path: '/tmp/retry.png', sourcePath: '/tmp/source.jpg', status: 'pending' },
    ],
    sourceAssets: [
      { id: 'remote-origin', kind: 'origin', path: '/tmp/source.jpg', sourcePath: '/tmp/source.jpg', status: 'rejected' },
    ],
  }]

  const merged = balaWorkflow.mergeBalaReviewWorkspaceStyles(local, remote)

  assert.deepEqual(merged[0].assets.map(asset => [asset.id, asset.kind, asset.status]), [
    ['remote-origin', 'origin', 'rejected'],
    ['remote-ai', 'ai', 'approved'],
    ['retry-new', 'ai', 'pending'],
  ])
  assert.equal(merged[0].sourceAssets.length, 1)
})

test('workspace versions keep results from different review batches that reuse the same asset id', () => {
  assert.equal(typeof balaWorkflow.mergeBalaWorkspaceVersions, 'function')
  const existing = [{
    id: '208326102205-ai-1-face-job',
    remoteAssetId: '208326102205-ai-1',
    jobUid: 'face-job',
    operationType: 'face_swap',
    previewPath: '/tmp/face.png',
  }]
  const merged = balaWorkflow.mergeBalaWorkspaceVersions(existing, [{
    id: '208326102205-ai-1',
    jobUid: 'background-job',
    operationType: 'background_swap',
    path: '/tmp/background.png',
  }])

  assert.equal(merged.length, 2)
  assert.deepEqual(merged.map(item => [item.remoteAssetId, item.jobUid, item.operationType, item.previewPath]), [
    ['208326102205-ai-1', 'face-job', 'face_swap', '/tmp/face.png'],
    ['208326102205-ai-1', 'background-job', 'background_swap', '/tmp/background.png'],
  ])
  assert.notEqual(merged[0].id, merged[1].id)
})

test('review workspace keeps same-id AI assets from different persisted batches', () => {
  const first = [{
    styleCode: '208326102205',
    assets: [{
      id: '208326102205-ai-1',
      remoteAssetId: '208326102205-ai-1',
      kind: 'ai',
      jobUid: 'face-job',
      reviewBoardUrl: 'http://127.0.0.1/review/face?token=face',
      path: '/tmp/face.png',
      status: 'pending',
    }],
    sourceAssets: [],
  }]
  const second = [{
    styleCode: '208326102205',
    assets: [{
      id: '208326102205-ai-1',
      remoteAssetId: '208326102205-ai-1',
      kind: 'ai',
      jobUid: 'pose-job',
      reviewBoardUrl: 'http://127.0.0.1/review/pose?token=pose',
      path: '/tmp/pose.png',
      status: 'approved',
    }],
    sourceAssets: [],
  }]

  const merged = balaWorkflow.mergeBalaReviewWorkspaceStyles(first, second)

  assert.equal(merged[0].assets.length, 2)
  assert.deepEqual(merged[0].assets.map(asset => asset.jobUid), ['face-job', 'pose-job'])
})

test('AI image workspace metadata survives reload without persisting thumbnail payloads', () => {
  assert.equal(typeof balaWorkflow.serializeBalaImageWorkspaceState, 'function')
  assert.equal(typeof balaWorkflow.restoreBalaImageWorkspaceState, 'function')
  const original = [{
    styleCode: '208326102205',
    modelPhotos: [{
      id: 'source-1',
      path: '/tmp/source.jpg',
      thumbnailDataUrl: 'data:image/webp;base64,huge-payload',
      reviewStatus: 'approved',
      versions: [{
        id: 'face-version',
        remoteAssetId: '208326102205-ai-1',
        jobUid: 'face-job',
        runUid: 'face-run',
        operationType: 'face_swap',
        previewPath: '/tmp/face.png',
        reviewBoardUrl: 'http://127.0.0.1/review/face?token=face',
        status: 'approved',
      }],
    }],
  }]

  const snapshot = balaWorkflow.serializeBalaImageWorkspaceState(original)
  assert.doesNotMatch(JSON.stringify(snapshot), /huge-payload/)

  const restored = [{
    styleCode: '208326102205',
    modelPhotos: [{ id: 'source-1', path: '/tmp/source.jpg', versions: [] }],
  }]
  balaWorkflow.restoreBalaImageWorkspaceState(restored, snapshot)

  assert.equal(restored[0].modelPhotos[0].reviewStatus, 'approved')
  assert.deepEqual(restored[0].modelPhotos[0].versions.map(version => ({
    jobUid: version.jobUid,
    previewPath: version.previewPath,
    reviewBoardUrl: version.reviewBoardUrl,
    status: version.status,
  })), [{
    jobUid: 'face-job',
    previewPath: '/tmp/face.png',
    reviewBoardUrl: 'http://127.0.0.1/review/face?token=face',
    status: 'approved',
  }])
})

test('workflow restores all persisted review batches and routes decisions through each asset board', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const preload = fs.readFileSync('app/src/preload.js', 'utf8')
  const main = fs.readFileSync('app/src/main.js', 'utf8')

  assert.match(source, /BALA_AI_IMAGE_WORKSPACE_STATE_STORAGE_KEY/)
  assert.match(source, /async function restoreReviewWorkspaceBatches\(/)
  assert.match(source, /window\.cs\.listBalaReviewWorkspaceBatches/)
  assert.match(source, /normalizeBalaReviewBatchStyles\(batch,\s*\{\s*reviewBoardUrl/)
  assert.match(source, /const boardUrl = asset\.reviewBoardUrl \|\| reviewBoardUrl\.value/)
  assert.match(preload, /listBalaReviewWorkspaceBatches/)
  assert.match(main, /list-bala-review-workspace-batches/)
})

test('video asset pool enforces the review gate and keeps business source labels', () => {
  assert.equal(typeof balaWorkflow.buildBalaVideoAssetPool, 'function')
  const assets = balaWorkflow.buildBalaVideoAssetPool({
    reviewStyle: {
      styleCode: '208326102205',
      assets: [
        { id: 'approved-face', label: '正面', operationType: 'face_swap', status: 'approved', path: '/tmp/face.png' },
        { id: 'pending-outfit', label: '侧面', operationType: 'outfit_swap', status: 'pending', path: '/tmp/outfit.png' },
        { id: 'retry-pose', label: '背面', operationType: 'pose_swap', status: 'retry', path: '/tmp/pose.png' },
        { id: 'rejected-bg', label: '背景', operationType: 'background_swap', status: 'rejected', path: '/tmp/bg.png' },
      ],
      sourceAssets: [
        { id: 'approved-origin', name: '原图', sourceType: 'model', status: 'approved', path: '/tmp/source.jpg' },
        { id: 'rejected-detail', name: '细节', sourceType: 'detail', status: 'rejected', path: '/tmp/detail.jpg' },
      ],
    },
  })

  assert.deepEqual(assets.map(asset => [asset.id, asset.kind, asset.status, asset.selectable]), [
    ['vasset-approved-face', 'AI 换脸', 'approved', true],
    ['vasset-pending-outfit', 'AI 换装', 'pending', false],
    ['vasset-retry-pose', 'AI 换姿势', 'retry', false],
    ['vasset-208326102205-source-approved-origin', '模拍', 'approved', true],
  ])
})

test('video stage only exposes styles that contain an approved asset', () => {
  assert.equal(typeof balaWorkflow.hasApprovedBalaVideoAsset, 'function')
  assert.equal(balaWorkflow.hasApprovedBalaVideoAsset([
    { status: 'pending', selectable: false },
    { status: 'retry', selectable: false },
  ]), false)
  assert.equal(balaWorkflow.hasApprovedBalaVideoAsset([
    { status: 'pending', selectable: false },
    { status: 'approved', selectable: true },
  ]), true)

  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  assert.match(
    source,
    /function buildVideoJobsFromReview\(\)[\s\S]*?hasApprovedBalaVideoAsset\(assets\)[\s\S]*?continue/,
  )
})

test('Seedance and HappyHorse plan mode uses the backend provider preflight', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const preload = fs.readFileSync('app/src/preload.js', 'utf8')
  const main = fs.readFileSync('app/src/main.js', 'utf8')
  const devBridge = fs.readFileSync('app/src/renderer/utils/devCsBridge.js', 'utf8')

  assert.match(source, /async function preflightVideoProviderTask\(task\)/)
  assert.match(source, /window\.cs\.preflightBalaVideoProvider\(/)
  assert.match(source, /async function runSeedanceVideoTask[\s\S]*?mode !== 'live'[\s\S]*?preflightVideoProviderTask\(task\)/)
  assert.match(source, /async function runHappyHorseVideoTask[\s\S]*?mode !== 'live'[\s\S]*?preflightVideoProviderTask\(task\)/)
  assert.match(preload, /preflightBalaVideoProvider:[\s\S]*?preflight-bala-video-provider/)
  assert.match(main, /secureHandle\('preflight-bala-video-provider'[\s\S]*?bala-ai-video-providers\/api\/preflight/)
  assert.match(devBridge, /preflightBalaVideoProvider:[\s\S]*?bala-ai-video-providers\/api\/preflight/)
})

test('a submitted video task cannot be reset by preflight or create a duplicate live provider run', () => {
  assert.equal(typeof balaWorkflow.shouldCreateBalaVideoProviderRun, 'function')
  assert.equal(balaWorkflow.shouldCreateBalaVideoProviderRun({ status: '待预检' }), true)
  assert.equal(balaWorkflow.shouldCreateBalaVideoProviderRun({ providerTaskId: 'plan-run', status: '预检完成，等待授权生成' }), true)
  assert.equal(balaWorkflow.shouldCreateBalaVideoProviderRun({ providerTaskId: 'failed-run', status: '失败' }), true)
  assert.equal(balaWorkflow.shouldCreateBalaVideoProviderRun({ providerTaskId: 'live-run', status: '已提交 / 查看结果' }), false)
  assert.equal(balaWorkflow.shouldCreateBalaVideoProviderRun({ providerTaskId: 'provider-task', status: '已下载' }), false)

  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  assert.match(
    source,
    /async function runVideoTask\(task, mode = 'plan'\) \{\s*if \(!shouldCreateBalaVideoProviderRun\(task\)\)[\s\S]*?return/,
  )
})

test('new video task uses a tiled style library, approved-only assets, and no split mode', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const templateSource = source.split('<script setup>')[0]

  assert.match(templateSource, /aiv-video-style-library/)
  assert.match(templateSource, /选择款号素材库/)
  assert.doesNotMatch(templateSource, /v-model="videoTaskDraft\.styleCode"[\s\S]{0,120}<option/)
  assert.doesNotMatch(templateSource, /成片拆分/)
  assert.doesNotMatch(source, /videoTaskDraft\.groupMode/)
  assert.doesNotMatch(source, /task\.groupMode/)
  assert.match(templateSource, /:disabled="!asset\.selectable"/)
  assert.match(source, /group_mode:\s*'all_images_one_video'/)
  assert.match(source, /duration:\s*5,[\s\S]*?runBalaSeedanceVideo/)
})

test('AI outfit references cross the preload bridge as cloneable plain arrays', () => {
  const reactivePaths = new Proxy(['/tmp/garment.jpg', '  /tmp/detail.jpg  '], {})
  assert.throws(() => structuredClone({ paths: reactivePaths }))

  assert.equal(typeof balaWorkflow.toBalaBridgeStringArray, 'function')
  const paths = balaWorkflow.toBalaBridgeStringArray(reactivePaths)
  assert.deepEqual(paths, ['/tmp/garment.jpg', '/tmp/detail.jpg'])
  assert.deepEqual(structuredClone({ paths }), { paths })

  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  assert.match(source, /garment_images:[\s\S]{0,120}toBalaBridgeStringArray\(garmentImagePaths\.value\)/)
  assert.match(source, /outfit_reference_images:[\s\S]{0,140}toBalaBridgeStringArray\(outfitReferencePaths\.value\)/)
  assert.match(source, /variant_reference_images:[\s\S]{0,140}toBalaBridgeStringArray\(variantReferencePaths\.value\)/)
})

test('AI image generation stays active until review assets leave generating state', () => {
  assert.equal(typeof balaWorkflow.hasGeneratingBalaReviewAssets, 'function')
  assert.equal(balaWorkflow.hasGeneratingBalaReviewAssets({
    items: [{ assets: [{ status: 'pending' }, { status: 'generating' }] }],
  }), true)
  assert.equal(balaWorkflow.hasGeneratingBalaReviewAssets({
    items: [{ assets: [{ status: 'pending' }, { status: 'failed' }] }],
  }), false)

  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  assert.match(source, /async function waitForAiReviewResults/)
  assert.match(source, /refreshBalaReviewBatch/)
  assert.match(source, /hasGeneratingBalaReviewAssets\(batch\)/)
  assert.match(source, /AI 图片仍在生成/)
})
