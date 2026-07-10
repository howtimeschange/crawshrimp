import test from 'node:test'
import assert from 'node:assert/strict'

import { buildEmbeddedCloudApprovalUrl, isTrustedCloudApprovalBoardUrl } from './cloudApprovalUrl.js'

test('cloud approval embedded URL appends embed mode while preserving batch_uid', () => {
  const url = buildEmbeddedCloudApprovalUrl('https://approval.example.com/?batch_uid=batch-20260707')

  assert.equal(url, 'https://approval.example.com/?batch_uid=batch-20260707&embed=1')
})

test('cloud approval embedded URL is restricted to the configured approval origin', () => {
  assert.equal(
    isTrustedCloudApprovalBoardUrl('https://approval.example.com/review?batch_uid=batch-1', 'https://approval.example.com/app'),
    true,
  )
  assert.equal(
    isTrustedCloudApprovalBoardUrl('https://evil.example.com/review?batch_uid=batch-1', 'https://approval.example.com/app'),
    false,
  )
  assert.equal(
    isTrustedCloudApprovalBoardUrl('https://approval.example.com/review?batch_uid=', 'https://approval.example.com/app'),
    false,
  )
  assert.equal(
    isTrustedCloudApprovalBoardUrl('https://approval.example.com/tmall-ai-image-approval/batch-1?batch_uid=batch-1', 'https://approval.example.com/app'),
    false,
  )
  assert.equal(
    buildEmbeddedCloudApprovalUrl('https://evil.example.com/review?batch_uid=batch-1', 'https://approval.example.com/app'),
    '',
  )
})

test('cloud approval embedded URL returns empty string for invalid configured URLs', () => {
  assert.equal(buildEmbeddedCloudApprovalUrl('not a url'), '')
})
