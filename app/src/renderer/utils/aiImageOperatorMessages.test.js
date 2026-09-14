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
    '上游生图服务暂时不可用。请查看重试记录后再决定是否重试。',
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

test('unknown synchronous receipts never suggest resubmission', () => {
  assert.match(generationFailureMessage('HTTP 504', 'UNKNOWN_SUBMIT_RESULT'), /已停止自动提交/)
  assert.match(generationFailureMessage('提交回执未知，HTTP 502'), /先核实供应商记录/)
  assert.equal(retrySummaryText({ submission_retry_history: [{ attempt: 1 }, { attempt: 2 }] }), '已自动重试 2 次')
})
