import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatAiImageRunStatus,
  generationFailureMessage,
  promptLibraryFailureMessage,
  retrySummaryText,
} from './aiImageOperatorMessages.mjs'

test('AI image run statuses use operator-facing Chinese labels', () => {
  assert.equal(formatAiImageRunStatus('queued'), '排队中')
  assert.equal(formatAiImageRunStatus('running'), '生成中')
  assert.equal(formatAiImageRunStatus('completed'), '已完成')
  assert.equal(formatAiImageRunStatus('failed'), '失败')
})

test('transient provider failures explain recovery without exposing raw gateway text', () => {
  assert.equal(
    generationFailureMessage('bad response status code 504'),
    '上游生图服务响应超时。系统已完成自动重试，你可以重试本队列。',
  )
})

test('prompt library failures replace developer token details with operator actions', () => {
  assert.equal(
    promptLibraryFailureMessage('开发浏览器模式缺少本地 API token'),
    'Prompt 库暂时无法连接。你可以刷新重试、使用本地库，或前往配置检查云端连接。',
  )
})

test('retry summary reports automatic and manual recovery attempts', () => {
  assert.equal(
    retrySummaryText({ retry_count: 2, manual_retry_count: 1 }),
    '已自动重试 2 次 · 已手动重试 1 次',
  )
})
