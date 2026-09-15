'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { scanDirectory } = require('./directoryScanWorker')
test('directory scans preserve order, budget filtered entries, allow heartbeats and cancellation', async t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-worker-'))
 t.after(() => fs.rmSync(root, { recursive: true, force: true }))
 for (let i = 0; i < 2000; i++) fs.writeFileSync(path.join(root, `image-${i}.jpg`), 'x')
 fs.writeFileSync(path.join(root, '.hidden.jpg'), 'x')
 let ticks = 0
 const timer = setInterval(() => ticks++, 1)
 try {
  const result = await scanDirectory(root, { maxFiles: 2000, extensions: ['jpg'] })
  assert.equal(result.paths.length, 2000)
  assert.match(result.paths[1].relativePath, /^image-1.jpg$/)
  assert.ok(ticks > 0)
  const budget = await scanDirectory(root, { maxEntries: 10, extensions: ['png'] })
  assert.equal(budget.paths.length, 0)
  assert.equal(budget.budgetExceeded, true)
  assert.equal(budget.truncated, true)
  const controller = new AbortController()
  const cancelled = scanDirectory(root, {}, { signal: controller.signal })
  controller.abort()
  await assert.rejects(cancelled, /取消/)
  assert.equal((await scanDirectory(root, { maxFiles: 1 })).paths.length, 1)
 } finally { clearInterval(timer) }
})
