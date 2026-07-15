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
      { kind: 'origin', status: 'reference' },
      { kind: 'ai', status: 'pending' },
      { kind: 'ai', status: 'approved' },
    ] }],
  })
  assert.deepEqual(summary, { total: 2, pending: 1, approved: 1, rejected: 0, generating: 0, failed: 0 })
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

test('AI video review step restores the latest persisted review batch after remount', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')

  assert.match(source, /@click="selectWorkflowStep\(step\.id\)"/)
  assert.match(source, /async function selectWorkflowStep\(stepId\)/)
  assert.match(source, /stepId === 'review'[\s\S]*?loadLatestReviewBatch\(\)/)
  assert.match(source, /async function restoreLatestReviewBatch\(/)
  assert.match(source, /window\.cs\.getData\(BALA_AI_VIDEO_ADAPTER_ID, BALA_AI_IMAGE_TASK_ID\)/)
  assert.match(source, /onMounted\(\(\) => \{[\s\S]*?restoreLatestReviewBatch\(\{ silent: true \}\)/)
  assert.match(source, /async function refreshReviewBatch\(\)[\s\S]*?if \(!ref\) \{[\s\S]*?loadLatestReviewBatch\(\)/)
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

test('AI video task summary uses live counts and failed results expose their reason', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const templateSource = source.split('<script setup>')[0]

  assert.match(templateSource, /<strong>\{\{ videoJobs\.length \}\} 款<\/strong>/)
  assert.match(templateSource, /v-if="item\.error" class="aiv-result-error"/)
  assert.match(templateSource, /\{\{ item\.error \}\}/)
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
