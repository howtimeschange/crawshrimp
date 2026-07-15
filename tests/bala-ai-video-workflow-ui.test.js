import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
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
  assert.equal(params.mode, 'current')
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
      items: [{
        style_code: '208326102205',
        assets: [
          { id: 'm1', source_type: 'model', filename: 'front.jpg', path: '/tmp/front.jpg', selected: true },
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
  assert.match(source, /emit\('open-settings'\)/)
  assert.match(appSource, /@open-settings="openSettingsPanel\('ai-1xm'\)"/)
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
