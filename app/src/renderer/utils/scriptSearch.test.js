import test from 'node:test'
import assert from 'node:assert/strict'

import { matchesScriptGroupSearch } from './scriptSearch.js'

const group = {
  adapter_name: 'Temu 运营助手',
  tasks: [
    { task_name: 'AI洗唛制作' },
    { task_name: '后台-商品流量-详情' },
  ],
}

test('matches script groups by adapter name', () => {
  assert.equal(matchesScriptGroupSearch(group, 'temu'), true)
  assert.equal(matchesScriptGroupSearch(group, '运营助手'), true)
})

test('matches script groups by task script name', () => {
  assert.equal(matchesScriptGroupSearch(group, '洗唛'), true)
  assert.equal(matchesScriptGroupSearch(group, '商品流量'), true)
})

test('ignores blank query and rejects unmatched text', () => {
  assert.equal(matchesScriptGroupSearch(group, ''), true)
  assert.equal(matchesScriptGroupSearch(group, '   '), true)
  assert.equal(matchesScriptGroupSearch(group, '京东'), false)
})
