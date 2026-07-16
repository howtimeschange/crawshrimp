import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildWriteOnlyAiVideoPatch,
  clearWrittenAiVideoFields,
  isAiVideoCredentialConfigured,
} from './aiVideoSettings.mjs'


test('write-only AI video settings never send blank values back to the backend', () => {
  const cfg = {
    'ai.video.seedance_api_key': '',
    'ai.video.seedance_base_url': '',
    'ai.video.bailian_api_key': 'new-secret',
    'ai.video.bailian_workspace_id': '  ',
    'ai.video.bailian_region': 'cn-shanghai',
  }

  assert.deepEqual(buildWriteOnlyAiVideoPatch(cfg), {
    'ai.video.bailian_api_key': 'new-secret',
    'ai.video.bailian_region': 'cn-shanghai',
  })
})

test('configured badges use backend booleans without receiving stored credentials', () => {
  const cfg = {
    'ai.video.seedance_configured': true,
    'ai.video.happyhorse_configured': false,
    'ai.video.seedance_api_key': '',
    'ai.video.bailian_api_key': '',
  }

  assert.equal(isAiVideoCredentialConfigured(cfg, 'ai.video.seedance_api_key'), true)
  assert.equal(isAiVideoCredentialConfigured(cfg, 'ai.video.bailian_api_key'), false)
})

test('successfully written AI video values are cleared from renderer memory', () => {
  const cfg = {
    'ai.video.seedance_api_key': 'typed-secret',
    'ai.video.seedance_base_url': 'https://custom.invalid',
    'ai.video.seedance_configured': false,
  }

  clearWrittenAiVideoFields(cfg, {
    'ai.video.seedance_api_key': 'typed-secret',
    'ai.video.seedance_base_url': 'https://custom.invalid',
  })

  assert.equal(cfg['ai.video.seedance_api_key'], '')
  assert.equal(cfg['ai.video.seedance_base_url'], '')
  assert.equal(cfg['ai.video.seedance_configured'], true)
})
