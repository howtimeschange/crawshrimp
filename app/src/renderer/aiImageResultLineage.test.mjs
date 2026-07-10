import test from 'node:test'
import assert from 'node:assert/strict'

import * as resultLineage from './aiImageResultLineage.mjs'

const {
  promptChainFromLineage,
  resolveResultLineage,
} = resultLineage

const image = (url, prompt, parent = '') => ({
  url,
  prompt,
  editSource: parent ? { result_key: parent } : null,
})

test('resolves only ancestors on the current edit branch', () => {
  const one = image('https://img/1.png', 'one')
  const two = image('https://img/2.png', 'two', one.url)
  const three = image('https://img/3.png', 'three', two.url)
  const four = image('https://img/4.png', 'four', one.url)
  const all = [one, two, three, four]

  assert.deepEqual(resolveResultLineage(three, all).map((item) => item.url), [one.url, two.url, three.url])
  assert.deepEqual(resolveResultLineage(four, all).map((item) => item.url), [one.url, four.url])
})

test('does not guess ancestors for legacy items and stops cycles', () => {
  const legacy = image('https://img/legacy.png', 'legacy')
  const a = image('https://img/a.png', 'a', 'https://img/b.png')
  const b = image('https://img/b.png', 'b', 'https://img/a.png')

  assert.deepEqual(resolveResultLineage(legacy, [legacy]).map((item) => item.url), [legacy.url])
  assert.deepEqual(resolveResultLineage(a, [a, b]).map((item) => item.url), [b.url, a.url])
})

test('resolves parents by either remote URL or local path', () => {
  const one = {
    url: 'https://img/1.png',
    path: '/cache/1.png',
    prompt: 'one',
  }
  const two = {
    url: 'https://img/2.png',
    path: '/cache/2.png',
    prompt: 'two',
    editSource: { result_key: '/cache/1.png' },
  }

  assert.deepEqual(resolveResultLineage(two, [one, two]).map((item) => item.url), [one.url, two.url])
})

test('numbers prompts by branch depth', () => {
  const chain = [
    image('https://img/1.png', 'original'),
    image('https://img/2.png', 'edit one'),
    image('https://img/3.png', 'edit two'),
  ]

  assert.deepEqual(promptChainFromLineage(chain).map(({ label, prompt }) => ({ label, prompt })), [
    { label: '原图 Prompt', prompt: 'original' },
    { label: '修改 Prompt 1', prompt: 'edit one' },
    { label: '修改 Prompt 2', prompt: 'edit two' },
  ])
})

const queue = (key, items, overrides = {}) => ({
  key,
  title: overrides.title || key,
  createdAt: overrides.createdAt || `2026-07-10T10:0${key.length}:00Z`,
  prompt: overrides.prompt || `${key} prompt`,
  status: overrides.status || 'completed',
  items,
})

test('groups sequential and branched edits into their root queue in run order', () => {
  assert.equal(typeof resultLineage.groupResultQueuesByLineage, 'function')

  const root = image('https://img/root.png', 'root prompt')
  const otherRoot = image('https://img/other.png', 'other prompt')
  const editOne = image('https://img/edit-1.png', 'edit one', root.url)
  const editTwo = image('https://img/edit-2.png', 'edit two', editOne.url)
  const branch = image('https://img/branch.png', 'branch edit', root.url)

  const grouped = resultLineage.groupResultQueuesByLineage([
    queue('root-run', [root], { prompt: 'root prompt' }),
    queue('other-run', [otherRoot], { prompt: 'other prompt' }),
    queue('edit-one-run', [editOne], { prompt: 'edit one' }),
    queue('edit-two-run', [editTwo], { prompt: 'edit two' }),
    queue('branch-run', [branch], { prompt: 'branch edit' }),
  ])

  assert.equal(grouped.length, 2)
  assert.deepEqual(grouped[0].items.map((item) => item.url), [root.url, editOne.url, editTwo.url, branch.url])
  assert.deepEqual(grouped[0].items.map((item) => item.label), ['结果 1', '结果 2', '结果 3', '结果 4'])
  assert.equal(grouped[0].key, 'root-run')
  assert.equal(grouped[0].prompt, 'root prompt')
  assert.deepEqual(grouped[1].items.map((item) => item.url), [otherRoot.url])
})

test('keeps all original images before edits and separates unrelated prompt roots', () => {
  const originalOne = image('https://img/root-1.png', 'shared prompt')
  const originalTwo = image('https://img/root-2.png', 'shared prompt')
  const editOfSecond = image('https://img/root-2-edit.png', 'edit second', originalTwo.url)
  const unrelated = image('https://img/unrelated.png', 'unrelated prompt')

  const grouped = resultLineage.groupResultQueuesByLineage([
    queue('multi-root', [originalOne, originalTwo]),
    queue('unrelated-root', [unrelated]),
    queue('edit-second', [editOfSecond]),
  ])

  assert.equal(grouped.length, 2)
  assert.deepEqual(grouped[0].items.map((item) => item.url), [originalOne.url, originalTwo.url, editOfSecond.url])
  assert.deepEqual(grouped[0].items.map((item) => item.label), ['结果 1', '结果 2', '结果 3'])
  assert.deepEqual(grouped[1].items.map((item) => item.url), [unrelated.url])
})

test('appends loading and failed edit placeholders to the source queue and aggregates status', () => {
  const root = image('https://img/status-root.png', 'root prompt')
  const loadingEdit = {
    key: 'loading-edit',
    label: '生成中 1',
    loading: true,
    editSource: { result_key: root.url },
  }
  const failedEdit = {
    key: 'failed-edit',
    label: '修改失败',
    failed: true,
    editSource: { result_key: root.url },
  }

  const grouped = resultLineage.groupResultQueuesByLineage([
    queue('status-root-run', [root]),
    queue('loading-edit-run', [loadingEdit], { status: 'running' }),
    queue('failed-edit-run', [failedEdit], { status: 'failed' }),
  ])

  assert.equal(grouped.length, 1)
  assert.deepEqual(grouped[0].items.map((item) => item.label), ['结果 1', '生成中 1', '修改失败'])
  assert.equal(grouped[0].status, 'running')
  assert.equal(grouped[0].loading, true)
})

test('keeps an edit queue standalone when its parent result cannot be resolved', () => {
  const root = image('https://img/known-root.png', 'root prompt')
  const orphan = image('https://img/orphan.png', 'orphan edit', 'https://img/missing-parent.png')

  const grouped = resultLineage.groupResultQueuesByLineage([
    queue('known-root-run', [root]),
    queue('orphan-run', [orphan]),
  ])

  assert.equal(grouped.length, 2)
  assert.deepEqual(grouped.map((item) => item.key), ['known-root-run', 'orphan-run'])
  assert.deepEqual(grouped[1].items.map((item) => item.url), [orphan.url])
})

test('keeps cyclic edit queues standalone instead of inventing a root group', () => {
  const first = image('https://img/cycle-a.png', 'cycle a', 'https://img/cycle-b.png')
  const second = image('https://img/cycle-b.png', 'cycle b', first.url)

  const grouped = resultLineage.groupResultQueuesByLineage([
    queue('cycle-a-run', [first]),
    queue('cycle-b-run', [second]),
  ])

  assert.equal(grouped.length, 2)
  assert.deepEqual(grouped.map((item) => item.key), ['cycle-a-run', 'cycle-b-run'])
})
