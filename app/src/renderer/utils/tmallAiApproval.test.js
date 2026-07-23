import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyCustomReferenceDefaults,
  isCustomReferencePrompt,
  markPromptReferenceSelection,
  removeReferencePathFromPrompts,
  restorePromptReferencePaths,
} from './tmallAiApproval.js'

test('custom references automatically apply only to creative and combination prompts', () => {
  assert.equal(isCustomReferencePrompt('鞋品创意拍-户外场景'), true)
  assert.equal(isCustomReferencePrompt('秋冬组合拍'), true)
  assert.equal(isCustomReferencePrompt('鞋品细节图'), false)

  const prompts = applyCustomReferenceDefaults([
    { id: 'creative', prompt_name: '鞋品创意拍-户外场景', reference_paths: ['/main.jpg'] },
    { id: 'outfit', prompt_name: '秋冬组合拍', reference_paths: ['/main.jpg'] },
    { id: 'detail', prompt_name: '鞋品细节图', reference_paths: ['/main.jpg'] },
  ], ['/custom-1.jpg', '/custom-2.jpg'])

  assert.deepEqual(prompts[0].reference_paths, ['/main.jpg', '/custom-1.jpg', '/custom-2.jpg'])
  assert.deepEqual(prompts[1].reference_paths, ['/main.jpg', '/custom-1.jpg', '/custom-2.jpg'])
  assert.deepEqual(prompts[2].reference_paths, ['/main.jpg'])
  assert.equal(prompts[0].reference_binding_mode, 'automatic')
  assert.equal(prompts[0].use_custom_references, true)
})

test('automatic custom-reference updates preserve manually edited prompt bindings', () => {
  const prompts = applyCustomReferenceDefaults([
    {
      id: 'manual',
      prompt_name: '鞋品创意拍',
      reference_binding_mode: 'manual',
      reference_paths: ['/main.jpg', '/kept.jpg'],
    },
    {
      id: 'automatic',
      prompt_name: '鞋品创意拍',
      reference_binding_mode: 'automatic',
      reference_paths: ['/main.jpg'],
    },
  ], ['/new-custom.jpg'])

  assert.deepEqual(prompts[0].reference_paths, ['/main.jpg', '/kept.jpg'])
  assert.deepEqual(prompts[1].reference_paths, ['/main.jpg', '/new-custom.jpg'])
})

test('manual selection and removal update only prompt bindings passed to the helper', () => {
  const selected = markPromptReferenceSelection(
    { id: 'creative', prompt_name: '创意拍', reference_paths: ['/main.jpg'] },
    ['/main.jpg', '/custom.jpg'],
  )
  assert.equal(selected.reference_binding_mode, 'manual')
  assert.equal(selected.use_custom_references, true)
  assert.deepEqual(selected.reference_paths, ['/main.jpg', '/custom.jpg'])

  const prompts = removeReferencePathFromPrompts([
    selected,
    { id: 'other', prompt_name: '组合拍', reference_paths: ['/main.jpg', '/custom.jpg'] },
  ], '/custom.jpg')

  assert.deepEqual(prompts[0].reference_paths, ['/main.jpg'])
  assert.deepEqual(prompts[1].reference_paths, ['/main.jpg'])
})

test('batch reload preserves explicit automatic and manual prompt reference bindings', () => {
  const referenceAssets = [
    { path: '/legacy-selected.jpg', use_for_generation: true },
    { path: '/custom.jpg', custom_upload: true, use_for_generation: false },
  ]

  assert.deepEqual(
    restorePromptReferencePaths({
      reference_binding_mode: 'automatic',
      reference_paths: ['/main.jpg', '/custom.jpg'],
    }, '/main.jpg', referenceAssets),
    ['/main.jpg', '/custom.jpg'],
  )
  assert.deepEqual(
    restorePromptReferencePaths({
      reference_binding_mode: 'manual',
      reference_paths: ['/main.jpg'],
    }, '/main.jpg', referenceAssets),
    ['/main.jpg'],
  )
  assert.deepEqual(
    restorePromptReferencePaths({
      reference_paths: ['/main.jpg', '/legacy-selected.jpg', '/custom.jpg'],
    }, '/main.jpg', referenceAssets),
    ['/main.jpg', '/legacy-selected.jpg'],
  )
})
