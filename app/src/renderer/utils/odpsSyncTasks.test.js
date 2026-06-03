import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildOdpsSyncFile,
  groupOdpsSyncableFiles,
  isOdpsSyncableTask,
  isOdpsSyncableFile,
} from './odpsSyncTasks.js'

test('ODPS sync is enabled for Temu mall flux, TikTok product analytics, and AliExpress analytics', () => {
  assert.equal(isOdpsSyncableTask('temu', 'mall_flux'), true)
  assert.equal(isOdpsSyncableTask('tiktok-ops-assistant', 'product_analytics'), true)
  assert.equal(isOdpsSyncableTask('aliexpress-ops-assistant', 'deal_analysis'), true)
  assert.equal(isOdpsSyncableTask('aliexpress-ops-assistant', 'product_ranking'), true)
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
  assert.equal(isOdpsSyncableFile({
    adapter_id: 'aliexpress-ops-assistant',
    task_id: 'product_ranking',
    path: '/tmp/速卖通商品排行.xlsx',
  }), true)
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
    {
      adapter_id: 'aliexpress-ops-assistant',
      task_id: 'deal_analysis',
      path: '/tmp/速卖通成交分析.xlsx',
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
    {
      adapter_id: 'aliexpress-ops-assistant',
      task_id: 'deal_analysis',
      paths: ['/tmp/速卖通成交分析.xlsx'],
    },
  ])
})
