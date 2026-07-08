import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AI_IMAGE_MODELS,
  defaultAiImageForm,
  missingKeyForModel,
  outputDirHint,
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

test('output dir hint includes mac linux and windows compatible examples', () => {
  const hint = outputDirHint()

  assert.match(hint, /~\/Downloads\/抓虾导出\/AI生图/)
  assert.match(hint, /%USERPROFILE%\\Downloads\\抓虾导出\\AI生图/)
})
