import test from 'node:test'
import assert from 'node:assert/strict'

import { buildEmbeddedCloudApprovalUrl } from './cloudApprovalUrl.js'

test('cloud approval embedded URL appends embed mode while preserving batch_uid', () => {
  const url = buildEmbeddedCloudApprovalUrl('https://approval.example.com/?batch_uid=batch-20260707')

  assert.equal(url, 'https://approval.example.com/?batch_uid=batch-20260707&embed=1')
})

test('cloud approval embedded URL returns empty string for invalid configured URLs', () => {
  assert.equal(buildEmbeddedCloudApprovalUrl('not a url'), '')
})
