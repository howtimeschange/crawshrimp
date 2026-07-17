import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AI_VIDEO_CONNECTION_DEFAULTS,
  AI_VIDEO_MASKED_CREDENTIAL_VALUE,
  buildWriteOnlyAiVideoPatch,
  clearWrittenAiVideoFields,
  isAiVideoCredentialConfigured,
} from './aiVideoSettings.mjs'

test('AI video connection defaults are visible without being credentials', () => {
  assert.deepEqual(AI_VIDEO_CONNECTION_DEFAULTS, {
    'ai.video.seedance_base_url': 'https://ark.cn-beijing.volces.com',
    'ai.video.bailian_region': 'cn-beijing',
    'ai.video.bailian_base_url': 'https://ai-aigw.semir.com/bailian-vedio/api/v1',
    'ai.video.bailian_uploads_url': 'https://dashscope.aliyuncs.com/api/v1/uploads',
  })
})

test('write-only AI video settings never send blank values back to the backend', () => {
  const cfg = {
    'ai.video.seedance_api_key': '',
    'ai.video.seedance_base_url': '',
    'ai.video.bailian_api_key': 'new-secret',
    'ai.video.bailian_workspace_id': '  ',
    'ai.video.bailian_region': 'cn-shanghai',
    'ai.video.bailian_upload_api_key': 'upload-secret',
    'ai.video.bailian_uploads_url': 'https://dashscope.example.com/api/v1/uploads',
  }

  assert.deepEqual(buildWriteOnlyAiVideoPatch(cfg), {
    'ai.video.bailian_api_key': 'new-secret',
    'ai.video.bailian_region': 'cn-shanghai',
    'ai.video.bailian_upload_api_key': 'upload-secret',
    'ai.video.bailian_uploads_url': 'https://dashscope.example.com/api/v1/uploads',
  })
})

test('masked AI video credentials are display-only and never posted as settings', () => {
  const cfg = {
    'ai.video.seedance_api_key': AI_VIDEO_MASKED_CREDENTIAL_VALUE,
    'ai.video.seedance_base_url': 'https://custom.invalid',
    'ai.video.bailian_api_key': `${AI_VIDEO_MASKED_CREDENTIAL_VALUE}typo`,
    'ai.video.bailian_upload_api_key': AI_VIDEO_MASKED_CREDENTIAL_VALUE,
  }

  assert.deepEqual(buildWriteOnlyAiVideoPatch(cfg), {
    'ai.video.seedance_base_url': 'https://custom.invalid',
  })
})

test('configured badges use backend booleans without receiving stored credentials', () => {
  const cfg = {
    'ai.video.seedance_configured': true,
    'ai.video.happyhorse_configured': false,
    'ai.video.bailian_upload_configured': true,
    'ai.video.seedance_api_key': '',
    'ai.video.bailian_api_key': '',
    'ai.video.bailian_upload_api_key': '',
  }

  assert.equal(isAiVideoCredentialConfigured(cfg, 'ai.video.seedance_api_key'), true)
  assert.equal(isAiVideoCredentialConfigured(cfg, 'ai.video.bailian_api_key'), false)
  assert.equal(isAiVideoCredentialConfigured(cfg, 'ai.video.bailian_upload_api_key'), true)
})

test('successfully written AI video values are cleared from renderer memory', () => {
  const cfg = {
    'ai.video.seedance_api_key': 'typed-secret',
    'ai.video.seedance_base_url': 'https://custom.invalid',
    'ai.video.bailian_upload_api_key': 'upload-secret',
    'ai.video.bailian_uploads_url': 'https://dashscope.example.com/api/v1/uploads',
    'ai.video.seedance_configured': false,
    'ai.video.bailian_upload_configured': false,
  }

  clearWrittenAiVideoFields(cfg, {
    'ai.video.seedance_api_key': 'typed-secret',
    'ai.video.seedance_base_url': 'https://custom.invalid',
    'ai.video.bailian_upload_api_key': 'upload-secret',
    'ai.video.bailian_uploads_url': 'https://dashscope.example.com/api/v1/uploads',
  })

  assert.equal(cfg['ai.video.seedance_api_key'], AI_VIDEO_MASKED_CREDENTIAL_VALUE)
  assert.equal(cfg['ai.video.seedance_base_url'], '')
  assert.equal(cfg['ai.video.seedance_configured'], true)
  assert.equal(cfg['ai.video.bailian_upload_api_key'], AI_VIDEO_MASKED_CREDENTIAL_VALUE)
  assert.equal(cfg['ai.video.bailian_uploads_url'], '')
  assert.equal(cfg['ai.video.bailian_upload_configured'], true)
})
