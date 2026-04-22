import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

test('non-ID verified voucher sites use Discount Setting section fallback when labels are not nested with inputs', () => {
  const scriptPath = path.resolve('adapters/lazada-plus-v1/voucher-create.js')
  const source = fs.readFileSync(scriptPath, 'utf8')

  assert.match(
    source,
    /if \(!VERIFIED_SITES\.has\(siteCode\)\) return null/,
  )
  assert.match(
    source,
    /const sectionInputs = VERIFIED_SITES\.has\(siteCode\)\s*\? await waitFor\(\(\) => findVoucherPercentInputsBySection\(row\), 2600, 120\)\s*:\s*null/,
  )
})
