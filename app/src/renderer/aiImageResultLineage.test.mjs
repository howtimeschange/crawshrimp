import test from 'node:test'
import assert from 'node:assert/strict'

import {
  promptChainFromLineage,
  resolveResultLineage,
} from './aiImageResultLineage.mjs'

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
