import test from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateVideoCost,
  formatCny,
  resolveHappyHorseMode,
  happyHorseModelId,
  happyHorseModeLabel,
} from './aiVideoPricing.mjs'

test('happyhorse mode follows image count', () => {
  assert.equal(resolveHappyHorseMode(0), 't2v')
  assert.equal(resolveHappyHorseMode(1), 'i2v')
  assert.equal(resolveHappyHorseMode(2), 'r2v')
  assert.equal(resolveHappyHorseMode(9), 'r2v')
  assert.equal(happyHorseModelId('t2v'), 'happyhorse-1.1-t2v')
  assert.equal(happyHorseModelId('i2v'), 'happyhorse-1.1-i2v')
  assert.equal(happyHorseModelId('r2v'), 'happyhorse-1.1-r2v')
  assert.equal(happyHorseModeLabel('i2v'), '图生视频')
})

test('happyhorse cost uses resolution rate', () => {
  const cost720 = estimateVideoCost({ provider: 'happyhorse', resolution: '720P', duration: 5 })
  assert.equal(cost720.total, 4.5)
  assert.equal(cost720.ratePerSec, 0.9)

  const cost1080 = estimateVideoCost({ provider: 'happyhorse', resolution: '1080P', duration: 5 })
  assert.equal(cost1080.total, 6)
  assert.equal(cost1080.ratePerSec, 1.2)
})

test('seedance cost estimate for 5s 720p', () => {
  const cost = estimateVideoCost({ provider: 'seedance', resolution: '720p', duration: 5 })
  assert.equal(cost.total, 5)
  assert.equal(formatCny(cost.total), '¥5.00')
})

test('bailian gateway models show unknown local price instead of a fake estimate', () => {
  for (const provider of ['kling-v3', 'kling-omni', 'pixverse-motioncontrol']) {
    const cost = estimateVideoCost({ provider, resolution: '720P', duration: 5 })
    assert.equal(cost.known, false)
    assert.equal(formatCny(cost.total), '—')
    assert.match(cost.formula, /百炼控制台/)
  }
})
