import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  buildBalaAiStageRequest,
  buildBalaVideoStageRequest,
  parseBalaReviewBoardUrl,
  summarizeBalaReviewBatch,
} from '../app/src/renderer/utils/balaAiVideoWorkflow.js'

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
    assert.match(source, /\/bala-ai-video-review\/api/)
  }
})
