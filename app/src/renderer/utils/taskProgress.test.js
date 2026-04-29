import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildTaskRunnerProgressSummary,
  resolveTaskProgressConfig,
} from './taskProgress.js'

test('tmall material match-buy uses Semir batch download progress in task runner', () => {
  const config = resolveTaskProgressConfig('semir-cloud-drive', 'tmall_material_match_buy')
  assert.equal(config.mode, 'enhanced')
  assert.equal(config.usage.taskRunner, 'enhanced')

  const summary = buildTaskRunnerProgressSummary({
    adapterId: 'semir-cloud-drive',
    taskId: 'tmall_material_match_buy',
    liveStatus: 'running',
    isRunning: true,
    live: {
      status: 'running',
      phase: 'collect_job',
      current: 1,
      total: 2,
      buyer_id: '109326124011',
      store: '26Q2/模拍',
      download_total: 5,
      download_completed: 2,
      download_success: 2,
      download_concurrency: 10,
      download_retry_attempts: 3,
      download_started: true,
      download_active: true,
    },
  })

  assert.equal(summary.title, '双阶段进度')
  assert.equal(summary.ariaLabel, '森马云盘双阶段进度')
  assert.equal(summary.tracks.length, 2)
  assert.equal(summary.tracks[0].title, '上层 · 检索链接')
  assert.equal(summary.tracks[0].main, '1 / 2 个编码')
  assert.equal(summary.tracks[1].title, '下层 · 批量下载')
  assert.equal(summary.tracks[1].main, '2 / 5 个文件')
})
