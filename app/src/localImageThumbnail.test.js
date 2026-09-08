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
  const outcomes = await Promise.allSettled(Array.from({ length: 24 }, () => reader(__filename, { maxEdge: 280 })))
  assert.equal(peak, 2)
  assert.equal(calls, 24)
  assert.equal(outcomes.filter(item => item.status === 'rejected').length, 1)
  assert.equal(outcomes[0].value.bytes, 5)
  assert.equal(outcomes[0].value.width, 210)
})
