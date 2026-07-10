import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AI_IMAGE_MODELS,
  AI_IMAGE_SIZES,
  defaultSizeForRatio,
  defaultAiImageForm,
  isNanoBananaModel,
  missingKeyForModel,
  modelIdForJob,
  outputDirHint,
  qualityOptionsForModel,
  ratioForSize,
  sizeForRatio,
  sizeOptionsForModel,
  sizesForRatio,
} from './aiImageModels.js'

test('ai image models expose supported 1XM model ids and config keys', () => {
  assert.deepEqual(
    AI_IMAGE_MODELS.map((model) => model.key),
    [
      'gpt-image-2',
      'gpt-image-2',
      'gemini-3.1-flash-image-preview',
      'gemini-3-pro-image-preview',
    ],
  )
  assert.deepEqual(
    AI_IMAGE_MODELS.map((model) => model.configId),
    [
      'ai.1xm.gpt_image_2k_key',
      'ai.1xm.gpt_image_4k_key',
      'ai.1xm.gemini_3_1_flash_image_preview_key',
      'ai.1xm.gemini_3_pro_image_preview_key',
    ],
  )
})

test('default ai image form uses compact local generation defaults', () => {
  const form = defaultAiImageForm()

  assert.equal(form.title, 'AI 生图任务')
  assert.equal(form.modelId, 'gpt-image-2k')
  assert.equal(form.model_key, 'gpt-image-2')
  assert.equal(form.size, '1024x1024')
  assert.equal(form.ratio, '1:1')
  assert.equal(form.quality, 'high')
  assert.equal(form.format, 'png')
  assert.equal(form.count, 4)
  assert.equal(form.prompt, '')
  assert.equal(form.mainImagePath, '')
  assert.deepEqual(form.referenceImagePaths, [])
  assert.equal(form.output_dir, '~/Downloads/抓虾导出/AI生图')
})

test('ratio and size helpers keep generation dimensions compatible', () => {
  assert.deepEqual(AI_IMAGE_SIZES, [...new Set(AI_IMAGE_SIZES)])
  assert.ok(AI_IMAGE_SIZES.every((size) => Math.max(...size.split('x').map(Number)) <= 3840))
  assert.ok(AI_IMAGE_SIZES.every((size) => size.split('x').map(Number).every((edge) => edge % 16 === 0)))
  assert.ok(!AI_IMAGE_SIZES.includes('1920x1080'))
  assert.ok(!AI_IMAGE_SIZES.includes('1080x1920'))
  assert.deepEqual(sizesForRatio('3:4'), ['960x1280', '1536x2048', '2448x3264'])
  assert.equal(sizeForRatio('3:4', '1024x1024', '2k'), '960x1280')
  assert.equal(defaultSizeForRatio('3:4', '4k'), '2448x3264')
  assert.equal(ratioForSize('1536x1024'), '3:2')
  assert.equal(ratioForSize('1024x1536'), '2:3')

  const threeFour = defaultAiImageForm({ ratio: '3:4' })
  assert.equal(threeFour.size, '960x1280')
  assert.equal(threeFour.ratio, '3:4')

  const wide4k = defaultAiImageForm({ modelId: 'gpt-image-4k', ratio: '16:9' })
  assert.equal(wide4k.size, '3840x2160')
  assert.equal(wide4k.ratio, '16:9')
})

test('model-specific options match GPT and Nano Banana async contracts', () => {
  assert.deepEqual(sizeOptionsForModel('gpt-image-4k', '16:9'), ['3840x2160'])
  assert.deepEqual(sizeOptionsForModel('gemini-3-pro-image-preview', '16:9'), ['1K', '2K', '4K'])
  assert.deepEqual(qualityOptionsForModel('gpt-image-2k'), ['auto', 'high', 'medium', 'low'])
  assert.deepEqual(qualityOptionsForModel('gemini-3.1-flash-image-preview'), [])
  assert.equal(isNanoBananaModel('gemini-3.1-flash-image-preview'), true)
  assert.equal(isNanoBananaModel('gpt-image-2k'), false)
})

test('missing key detection returns the active model config id', () => {
  assert.equal(
    missingKeyForModel('gpt-image-2k', {
      'ai.1xm.gpt_image_2k_key': '',
      'ai.1xm.gpt_image_4k_key': 'key-4k',
    }),
    'ai.1xm.gpt_image_2k_key',
  )
  assert.equal(
    missingKeyForModel('gemini-3-pro-image-preview', {
      'ai.1xm.gemini_3_pro_image_preview_key': 'gemini-key',
    }),
    '',
  )
})

test('model id resolves from persisted job payload model tier and size', () => {
  assert.equal(
    modelIdForJob({
      model_key: 'gpt-image-2',
      model_key_tier: '4k',
      params: { size: '1024x1024' },
    }),
    'gpt-image-4k',
  )
  assert.equal(
    modelIdForJob({
      model_key: 'gpt-image-2',
      params: { size: '3840x2160' },
    }),
    'gpt-image-4k',
  )
  assert.equal(
    modelIdForJob({
      model_key: 'gpt-image-2',
      model_key_tier: '2k',
      params: { size: '4096x4096' },
    }),
    'gpt-image-2k',
  )
  assert.equal(
    modelIdForJob({
      model_key: 'gemini-3-pro-image-preview',
    }),
    'gemini-3-pro-image-preview',
  )
})

test('output dir hint includes mac linux and windows compatible examples', () => {
  const hint = outputDirHint()

  assert.match(hint, /~\/Downloads\/抓虾导出\/AI生图/)
  assert.match(hint, /%USERPROFILE%\\Downloads\\抓虾导出\\AI生图/)
})
