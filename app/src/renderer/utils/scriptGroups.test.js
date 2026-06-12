import test from 'node:test'
import assert from 'node:assert/strict'

import { buildScriptGroups } from './scriptGroups.js'

test('buildScriptGroups sorts groups by adapter name then adapter id', () => {
  const tasks = [
    {
      adapter_id: 'temu',
      adapter_name: 'Temu 运营助手',
      adapter_version: '1.4.0',
      task_id: 'goods_data',
      task_name: '商品数据',
      enabled: true,
    },
    {
      adapter_id: 'tmall-ops-assistant',
      adapter_name: '天猫运营助手',
      adapter_version: '0.1.0',
      task_id: 'buyer_reviews',
      task_name: '买家评价抓取',
      enabled: true,
    },
    {
      adapter_id: 'shopee-plus-v2',
      adapter_name: 'Shopee 运营助手',
      adapter_version: '2.0.0',
      task_id: 'voucher_batch_create',
      task_name: '批量创建优惠券',
      enabled: true,
    },
    {
      adapter_id: 'alpha-b',
      adapter_name: 'Alpha',
      adapter_version: '1.0.1',
      task_id: 'task_b',
      task_name: 'Task B',
      enabled: true,
    },
    {
      adapter_id: 'alpha-a',
      adapter_name: 'Alpha',
      adapter_version: '1.0.0',
      task_id: 'task_a',
      task_name: 'Task A',
      enabled: true,
    },
  ]

  const groups = buildScriptGroups(tasks)

  assert.deepEqual(
    groups.map(group => `${group.adapter_name}:${group.adapter_id}`),
    [
      '天猫运营助手:tmall-ops-assistant',
      'Alpha:alpha-a',
      'Alpha:alpha-b',
      'Shopee 运营助手:shopee-plus-v2',
      'Temu 运营助手:temu',
    ],
  )
  assert.deepEqual(
    groups.map(group => group.adapter_version),
    ['0.1.0', '1.0.0', '1.0.1', '2.0.0', '1.4.0'],
  )
})

test('buildScriptGroups keeps task display formatting inside each group', () => {
  const tasks = [
    {
      adapter_id: 'temu',
      adapter_name: 'Temu 运营助手',
      adapter_version: '1.4.0',
      task_id: 'goods_data',
      task_name: '原始商品数据',
      enabled: true,
    },
    {
      adapter_id: 'temu',
      adapter_name: 'Temu 运营助手',
      adapter_version: '1.4.0',
      task_id: 'single_product_reviews',
      task_name: '商城-单款商品评价',
      enabled: true,
    },
    {
      adapter_id: 'temu',
      adapter_name: 'Temu 运营助手',
      adapter_version: '1.4.0',
      task_id: 'reviews',
      task_name: '原始店铺评价',
      enabled: true,
    },
  ]

  const groups = buildScriptGroups(tasks)

  assert.equal(groups.length, 1)
  assert.equal(groups[0].adapter_version, '1.4.0')
  assert.deepEqual(
    groups[0].tasks.map(task => task.task_name),
    ['商城-单款商品评价', '商城-店铺评价', '后台-商品数据'],
  )
})
