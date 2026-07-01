import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { renderDashboard } from '../adapters/tmall-ops-assistant/tools/watch_tmall_background_tasks.mjs'

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

test('combined task dashboard renders tmall audit and semir cloud match progress', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tmall-dashboard-test-'))
  const auditDir = path.join(root, 'full-latest-logic-audit-test')
  const matchDir = path.join(root, 'semir-cloud-package-match-test')
  fs.mkdirSync(path.join(auditDir, 'sheets'), { recursive: true })
  fs.mkdirSync(matchDir, { recursive: true })

  writeJson(path.join(auditDir, 'audit-summary.json'), {
    totalItems: 10,
    countsByMode: { anchored_replace: 1 },
    countsByStopAnchor: { wanted_info: 1 },
    countsByOcrStatus: { recognized: 1 },
  })
  fs.writeFileSync(path.join(auditDir, 'audit-results.jsonl'), [
    JSON.stringify({ sequence: 1, merchantCode: '208126108109', itemId: '814480905961', latestMode: 'anchored_replace', shouldReplace: 'yes', replaceRange: '#1-#5', preserveBottomRange: '#6-#9', attempts: 1, fetchedAt: '2026-07-01T04:00:00.000Z' }),
    '',
  ].join('\n'))
  fs.writeFileSync(path.join(auditDir, 'full-audit.log'), '[full-audit] 1/10 ok\n')
  fs.writeFileSync(path.join(auditDir, 'sheets/00001.png'), '')

  writeJson(path.join(matchDir, 'summary.json'), {
    targetStyles: 5,
    matchedStyles: 1,
    selectedStyles: 1,
    noMatchStyles: 0,
    errorStyles: 0,
    pathFormats: { 'product-packaging': 3 },
  })
  fs.writeFileSync(path.join(matchDir, 'match-results.jsonl'), [
    JSON.stringify({ styleCode: '208126108109', itemIds: ['814480905961'], mountResults: [{ ok: true, imageCount: 3, selected: 2, searchCount: 7 }], matchedAt: '2026-07-01T04:01:00.000Z' }),
    '',
  ].join('\n'))
  fs.writeFileSync(path.join(matchDir, 'matched-images.csv'), 'styleCode,fullpath\n208126108109,a.jpg\n')
  fs.writeFileSync(path.join(matchDir, 'semir-match.log'), '[semir-match] 1/5 ok\n')

  const output = renderDashboard({
    auditOut: auditDir,
    matchOut: matchDir,
    auditScreen: 'missing-audit-screen',
    matchScreen: 'missing-match-screen',
    recent: 3,
  })

  assert.match(output, /Tmall Detail Audit/)
  assert.match(output, /Semir Cloud Package Match/)
  assert.match(output, /1\/10/)
  assert.match(output, /1\/5/)
  assert.match(output, /208126108109/)
  assert.match(output, /product-packaging:3/)
})
