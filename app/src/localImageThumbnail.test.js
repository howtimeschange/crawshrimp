'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createThumbnailReader } = require('./localImageThumbnail')

test('image decoding is bounded and failures release their queue slot', async () => {
  let active = 0, peak = 0, calls = 0
  const reader = createThumbnailReader({
    async decodeImage(file, maxEdge, quality) {
      const id = calls++
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 3))
      active--
      if (id === 1) throw new Error('bad image')
      assert.equal(maxEdge, 280)
      assert.equal(quality, 72)
      return { data_url: 'data:image/jpeg;base64,small', bytes: 5, width: 210, height: 280 }
    },
  })
  const outcomes = await Promise.allSettled(Array.from({ length: 24 }, (_, i) => reader(__filename, { maxEdge: 280, scope: String(i) })))
  assert.equal(peak, 2)
  assert.equal(calls, 24)
  assert.equal(outcomes.filter(item => item.status === 'rejected').length, 1)
  assert.equal(outcomes[0].value.bytes, 5)
  assert.equal(outcomes[0].value.width, 210)
})


test('duplicate versions share decoding; queued scopes cancel without blocking new work', async () => {
  let release, calls = 0
  const gate = new Promise(resolve => { release = resolve })
  const reader = createThumbnailReader({ concurrency: 1, async decodeImage() {
    calls++
    if (calls === 1) await gate
    return { data_url: 'data:image/jpeg;base64,x', width: 1, height: 1 }
  } })
  const first = reader(__filename, { scope: 'active' })
  const duplicate = reader(__filename, { scope: 'active' })
  await new Promise(resolve => setTimeout(resolve, 30))
  const old = Array.from({length: 50}, (_, i) => reader(__filename, { scope: 'old', maxEdge: 64 + i }))
  const settled = Promise.allSettled(old)
  await new Promise(resolve => setTimeout(resolve, 30))
  reader.cancelScope('old')
  const fresh = reader(__filename, { scope: 'new' })
  release()
  await Promise.all([first, duplicate, fresh])
  assert.equal(calls, 2)
  assert.equal((await settled).filter(item => item.status === 'rejected').length, 50)
})

test('thumbnail queue rejects overflow and remains usable after draining', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const reader = createThumbnailReader({ concurrency: 1, async decodeImage() {
    await gate
    return { data_url: 'data:image/jpeg;base64,x', width: 1, height: 1 }
  } })
  const requests = Array.from({length: 100}, (_, i) => reader(__filename, {scope: String(i)}))
  const outcomes = Promise.allSettled(requests)
  await new Promise(resolve => setTimeout(resolve, 50))
  release()
  const results = await outcomes
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 65)
  assert.equal(results.filter(item => item.status === 'rejected' && /队列已满/.test(item.reason.message)).length, 35)
  assert.equal((await reader(__filename)).ok, true)
})
