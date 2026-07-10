import assert from 'node:assert/strict'
import test from 'node:test'

import { parseAdvancedJsonConfig } from './aiImageAdvancedJson.mjs'

test('advanced JSON accepts an empty value and plain object settings', () => {
  assert.deepEqual(parseAdvancedJsonConfig(''), {})
  assert.deepEqual(parseAdvancedJsonConfig('{"background":"white"}'), { background: 'white' })
})

test('advanced JSON reports a user-facing line and column for invalid input', () => {
  assert.throws(
    () => parseAdvancedJsonConfig('{\n  "background": "white",\n}'),
    /高级 JSON 格式错误：第 3 行，第 1 列/,
  )
})

test('advanced JSON rejects arrays because generation settings require an object', () => {
  assert.throws(
    () => parseAdvancedJsonConfig('["white"]'),
    /高级 JSON 必须是对象/,
  )
})
