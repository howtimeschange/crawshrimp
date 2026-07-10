const assert = require('node:assert/strict')
const test = require('node:test')

test('loading preview prefers run main, then first reference, then text artwork', async () => {
  const { resolveLoadingPreviewContext } = await import('../app/src/renderer/utils/aiImageLoadingState.mjs')

  assert.deepEqual(resolveLoadingPreviewContext({}, {
    input_params: { main_image_path: '/main.png', reference_image_paths: ['/ref.png'] },
  }), { previewPath: '/main.png', mode: 'input' })
  assert.deepEqual(resolveLoadingPreviewContext({}, {
    input_params: { reference_image_paths: ['/ref.png', '/ref-b.png'] },
  }), { previewPath: '/ref.png', mode: 'input' })
  assert.deepEqual(resolveLoadingPreviewContext({}, {}), { previewPath: '', mode: 'text' })
  assert.deepEqual(resolveLoadingPreviewContext({
    params: { main_image_path: '/later-job-main.png' },
  }, {
    input_params: { main_image_path: '', reference_image_paths: [] },
  }), { previewPath: '', mode: 'text' })
})

test('loading preview falls back from run to job and current input snapshot', async () => {
  const { resolveLoadingPreviewContext } = await import('../app/src/renderer/utils/aiImageLoadingState.mjs')

  assert.deepEqual(resolveLoadingPreviewContext({
    params: { reference_image_paths: ['/job-ref.png'] },
  }), { previewPath: '/job-ref.png', mode: 'input' })
  assert.deepEqual(resolveLoadingPreviewContext({}, {}, {
    mainImagePath: '/current-main.png',
    referenceImagePaths: ['/current-ref.png'],
  }), { previewPath: '/current-main.png', mode: 'input' })
})

test('loading copy cycles through all Crawshrimp phrases', async () => {
  const { AI_IMAGE_LOADING_MESSAGES, loadingMessageFor } = await import('../app/src/renderer/utils/aiImageLoadingState.mjs')

  assert.deepEqual(AI_IMAGE_LOADING_MESSAGES, [
    '正在出海',
    '正在撒网',
    '正在寻找灵感海域',
    '正在捕捞画面',
    '正在收网',
    '正在挑选大虾',
    '正在满载返航',
  ])
  assert.equal(loadingMessageFor(7, 0), AI_IMAGE_LOADING_MESSAGES[0])
  assert.equal(loadingMessageFor(0, 2), AI_IMAGE_LOADING_MESSAGES[2])
})

test('in-flight generation belongs only to its originating task', async () => {
  const { generationBelongsToJob } = await import('../app/src/renderer/utils/aiImageLoadingState.mjs')

  assert.equal(generationBelongsToJob('job-a', 'job-a'), true)
  assert.equal(generationBelongsToJob('job-a', 'job-b'), false)
  assert.equal(generationBelongsToJob('', 'job-a'), false)
  assert.equal(generationBelongsToJob('job-a', ''), false)
})
