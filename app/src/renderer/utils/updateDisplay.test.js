import test from 'node:test'
import assert from 'node:assert/strict'

import { buildTopbarUpdatePrompt } from './updateDisplay.js'

test('topbar update prompt is hidden when no update is actionable', () => {
  assert.equal(buildTopbarUpdatePrompt({ status: 'idle' }), null)
  assert.equal(buildTopbarUpdatePrompt({ status: 'not-available' }), null)
  assert.equal(buildTopbarUpdatePrompt({ status: 'error' }), null)
})

test('topbar update prompt is shown for available downloaded and downloading updates', () => {
  assert.deepEqual(
    buildTopbarUpdatePrompt({ status: 'available', latestVersion: '1.4.6' }),
    { label: '更新', title: '发现 v1.4.6，点击查看' },
  )
  assert.deepEqual(
    buildTopbarUpdatePrompt({ status: 'downloaded', latestVersion: '1.4.6' }),
    { label: '安装更新', title: 'v1.4.6 已下载，点击安装' },
  )
  assert.deepEqual(
    buildTopbarUpdatePrompt({ status: 'downloading', latestVersion: '1.4.6', progress: { percent: 42.2 } }),
    { label: '更新 42%', title: '正在下载 v1.4.6' },
  )
})
