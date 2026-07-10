const assert = require('node:assert/strict')
const test = require('node:test')

test('batch Prompt counts default and clamp to the GPT 1-8 range', async () => {
  const { normalizeBatchPromptCount } = await import('../app/src/renderer/utils/aiImageBatchGeneration.mjs')
  assert.equal(normalizeBatchPromptCount(undefined), 1)
  assert.equal(normalizeBatchPromptCount(0), 1)
  assert.equal(normalizeBatchPromptCount(4), 4)
  assert.equal(normalizeBatchPromptCount(99), 8)
  assert.equal(normalizeBatchPromptCount(7, { forceSingle: true }), 1)
})

test('batch summary ignores empty Prompts and totals normalized images', async () => {
  const { summarizeBatchPrompts } = await import('../app/src/renderer/utils/aiImageBatchGeneration.mjs')
  assert.deepEqual(summarizeBatchPrompts([
    { prompt: 'one', count: 3 },
    { prompt: '  ', count: 8 },
    { prompt: 'two', count: 2 },
  ]), { promptCount: 2, totalImages: 5 })
  assert.deepEqual(summarizeBatchPrompts([
    { prompt: 'one', count: 8 },
  ], { forceSingle: true }), { promptCount: 1, totalImages: 1 })
})

test('batch settings snapshot is a detached copy of outside settings', async () => {
  const { batchSettingsFromForm } = await import('../app/src/renderer/utils/aiImageBatchGeneration.mjs')
  const outside = { modelId: 'gpt-image-2-4k', ratio: '3:4', size: '2448x3264', quality: 'high', format: 'png' }
  const batch = batchSettingsFromForm(outside)
  batch.modelId = 'gpt-image-2'
  assert.equal(outside.modelId, 'gpt-image-2-4k')
  assert.deepEqual(Object.keys(batch), ['modelId', 'ratio', 'size', 'quality', 'format'])
})

test('queued multi-image runs expose one loading slot per requested image', async () => {
  const { loadingSlotIndexes } = await import('../app/src/renderer/utils/aiImageBatchGeneration.mjs')
  assert.deepEqual(loadingSlotIndexes({ status: 'queued', requested_count: 3 }), [0, 1, 2])
  assert.deepEqual(loadingSlotIndexes({ status: 'running' }), [0])
  assert.deepEqual(loadingSlotIndexes({ status: 'completed', requested_count: 3 }), [])
})
