import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildOdpsSyncFile,
  groupOdpsSyncableFiles,
  isOdpsSyncableTask,
  isOdpsSyncableFile,
} from './odpsSyncTasks.js'

test('ODPS sync is enabled for Temu mall flux and TikTok product analytics', () => {
  assert.equal(isOdpsSyncableTask('temu', 'mall_flux'), true)
  assert.equal(isOdpsSyncableTask('tiktok-ops-assistant', 'product_analytics'), true)
  assert.equal(isOdpsSyncableTask('tiktok-ops-assistant', 'product_rating'), false)
})

test('ODPS sync file guard requires a syncable task and Excel path', () => {
  assert.equal(isOdpsSyncableFile({
    adapter_id: 'tiktok-ops-assistant',
    task_id: 'product_analytics',
    path: '/tmp/TikTok商品数据分析.xlsx',
  }), true)
  assert.equal(isOdpsSyncableFile({
    adapter_id: 'tiktok-ops-assistant',
    task_id: 'product_analytics',
    path: '/tmp/TikTok商品数据分析.csv',
  }), false)
  assert.equal(isOdpsSyncableFile({
    adapter_id: 'temu',
    task_id: 'goods_data',
    path: '/tmp/Temu商品数据.xlsx',
  }), false)
})

test('buildOdpsSyncFile wraps task runner output paths with task context', () => {
  const file = buildOdpsSyncFile(
    'tiktok-ops-assistant',
    'product_analytics',
    '/tmp/TikTok商品数据分析.xlsx',
  )

  assert.deepEqual(file, {
    adapter_id: 'tiktok-ops-assistant',
    task_id: 'product_analytics',
    path: '/tmp/TikTok商品数据分析.xlsx',
  })
  assert.equal(isOdpsSyncableFile(file), true)
})

test('groupOdpsSyncableFiles groups mixed sync targets by adapter and task', () => {
  const groups = groupOdpsSyncableFiles([
    {
      adapter_id: 'temu',
      task_id: 'mall_flux',
      path: '/tmp/Temu店铺流量.xlsx',
    },
    {
      adapter_id: 'tiktok-ops-assistant',
      task_id: 'product_analytics',
      path: '/tmp/TikTok商品数据分析.xlsx',
    },
    {
      adapter_id: 'tiktok-ops-assistant',
      task_id: 'product_analytics',
      path: '/tmp/TikTok商品数据分析.csv',
    },
  ])

  assert.deepEqual(groups, [
    {
      adapter_id: 'temu',
      task_id: 'mall_flux',
      paths: ['/tmp/Temu店铺流量.xlsx'],
    },
    {
      adapter_id: 'tiktok-ops-assistant',
      task_id: 'product_analytics',
      paths: ['/tmp/TikTok商品数据分析.xlsx'],
    },
  ])
})
