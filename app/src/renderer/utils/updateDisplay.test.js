import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSidebarUpdatePresentation } from './updateDisplay.js'

test('available update maps to download copy and action', () => {
  assert.deepEqual(
    buildSidebarUpdatePresentation({
      status: 'available',
      currentVersion: '2.0.0',
      latestVersion: '2.0.1',
    }, false),
    {
      action: 'download',
      label: '更新',
      versionLabel: 'v2.0.0',
      title: '发现 v2.0.1，点击下载',
      tone: 'available',
      percent: null,
    },
  )
})

test('default no-update statuses show version-only copy without unavailable language', () => {
  for (const status of ['idle', 'checking', 'up-to-date', 'no-new-version', 'disabled']) {
    const presentation = buildSidebarUpdatePresentation({
      status,
      currentVersion: '2.0.0',
      error: '开发模式不会检查桌面更新。',
    }, false)

    assert.equal(presentation.action, null)
    assert.equal(presentation.label, '')
    assert.equal(presentation.versionLabel, 'v2.0.0')
    assert.equal(presentation.title, '当前版本 v2.0.0')
    assert.equal(presentation.tone, 'up-to-date')
    assert.equal(presentation.percent, null)
    assert.doesNotMatch(`${presentation.label} ${presentation.title}`, /不可用|开发模式|不会检查|错误|失败/)
  }
})

test('downloading status rounds and clamps progress without an action', () => {
  assert.deepEqual(
    buildSidebarUpdatePresentation({
      status: 'downloading',
      currentVersion: '2.0.0',
      latestVersion: '2.0.1',
      progress: { percent: 101.4 },
    }, false),
    {
      action: null,
      label: '下载中 100%',
      versionLabel: 'v2.0.0',
      title: '正在下载 v2.0.1',
      tone: 'downloading',
      percent: 100,
    },
  )

  assert.equal(
    buildSidebarUpdatePresentation({
      status: 'downloading',
      currentVersion: '2.0.0',
      progress: { percent: -12.1 },
    }, false).percent,
    0,
  )
})

test('waiting status reports blocker count without an action', () => {
  assert.deepEqual(
    buildSidebarUpdatePresentation({
      status: 'waiting-for-tasks',
      currentVersion: '2.0.0',
      latestVersion: '2.0.1',
      blockers: [
        { label: '导出任务' },
        { label: '上传任务' },
      ],
    }, false),
    {
      action: null,
      label: '等待 2 个任务结束',
      versionLabel: 'v2.0.0',
      title: 'v2.0.1 已下载，等待 2 个任务结束后安装',
      tone: 'waiting',
      percent: null,
    },
  )
})

test('ready update maps to install copy and action', () => {
  assert.deepEqual(
    buildSidebarUpdatePresentation({
      status: 'ready-to-install',
      currentVersion: '2.0.0',
      latestVersion: '2.0.1',
    }, false),
    {
      action: 'install',
      label: '重启安装',
      versionLabel: 'v2.0.0',
      title: 'v2.0.1 已准备好，点击重启安装',
      tone: 'ready',
      percent: null,
    },
  )
})

test('downloaded and installing statuses remain non-actionable', () => {
  assert.deepEqual(
    buildSidebarUpdatePresentation({
      status: 'downloaded',
      currentVersion: '2.0.0',
      latestVersion: '2.0.1',
    }, false),
    {
      action: null,
      label: '准备安装',
      versionLabel: 'v2.0.0',
      title: 'v2.0.1 已下载，正在确认是否可以安装',
      tone: 'waiting',
      percent: null,
    },
  )

  assert.deepEqual(
    buildSidebarUpdatePresentation({
      status: 'installing',
      currentVersion: '2.0.0',
      latestVersion: '2.0.1',
    }, false),
    {
      action: null,
      label: '正在重启',
      versionLabel: 'v2.0.0',
      title: '正在重启安装 v2.0.1',
      tone: 'installing',
      percent: null,
    },
  )
})

test('error status maps to retry copy and action', () => {
  assert.deepEqual(
    buildSidebarUpdatePresentation({
      status: 'error',
      currentVersion: '2.0.0',
      latestVersion: '2.0.1',
      error: '网络错误',
    }, false),
    {
      action: 'retry',
      label: '重试',
      versionLabel: 'v2.0.0',
      title: '更新失败：网络错误',
      tone: 'error',
      percent: null,
    },
  )
})

test('disabled status shows version only and no action', () => {
  assert.deepEqual(
    buildSidebarUpdatePresentation({
      status: 'disabled',
      currentVersion: '2.0.0',
      error: '开发模式不会检查桌面更新。',
    }, false),
    {
      action: null,
      label: '',
      versionLabel: 'v2.0.0',
      title: '当前版本 v2.0.0',
      tone: 'up-to-date',
      percent: null,
    },
  )
})

test('collapsed presentation uses a compact version label', () => {
  assert.equal(
    buildSidebarUpdatePresentation({
      status: 'available',
      currentVersion: '2.0.0',
      latestVersion: '2.0.1',
    }, true).versionLabel,
    'v2.0',
  )
})
