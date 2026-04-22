import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

test('Flexi Combo passes both placeholders and both timestamps into setRangePicker', () => {
  const scriptPath = path.resolve('adapters/lazada-plus-v1/voucher-create.js')
  const source = fs.readFileSync(scriptPath, 'utf8')

  assert.match(
    source,
    /await setRangePicker\('Start Date', 'End Date', row\.voucher_start_at, row\.voucher_end_at\)/,
  )
  assert.doesNotMatch(
    source,
    /await setRangePicker\('Start Date', row\.voucher_start_at, row\.voucher_end_at\)/,
  )
})
