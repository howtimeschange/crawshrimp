'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { execFileSync } = require('node:child_process')
const { createThumbnailReader } = require('./localImageThumbnail')
const { createPdfPreviewWorker } = require('./pdfPreviewWorker')
const pythonBin = process.env.CRAWSHRIMP_TEST_PYTHON || path.resolve(__dirname, '../../venv/bin/python')

function fixture(t) {
  if (!fs.existsSync(pythonBin)) { t.skip('Set CRAWSHRIMP_TEST_PYTHON to a Python runtime with Pillow and PyMuPDF'); return null }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-media-regression-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('real image decoder rejects corrupt and truncated files and preserves portrait dimensions', async t => {
  const dir = fixture(t); if (!dir) return
  execFileSync(pythonBin, ['-c', `from PIL import Image; import sys; from pathlib import Path
p=Path(sys.argv[1]); image=Image.new('RGB',(600,1200),'red')
for ext in ['png','jpg','webp','gif']: image.save(p/('portrait.'+ext))
`, dir])
  fs.writeFileSync(path.join(dir, 'broken.png'), 'not an image')
  const valid = fs.readFileSync(path.join(dir, 'portrait.png'))
  fs.writeFileSync(path.join(dir, 'truncated.png'), valid.subarray(0, 45))
  const read = createThumbnailReader({ getPythonBin: () => pythonBin })
  for (const ext of ['png','jpg','webp','gif']) {
    const result = await read(path.join(dir, `portrait.${ext}`), { maxEdge: 280 })
    assert.equal(result.ok, true)
    assert.deepEqual([result.width, result.height], [140,280])
    assert.match(result.data_url, /^data:image\/jpeg;base64,/)
  }
  await assert.rejects(read(path.join(dir, 'broken.png')), /缩略图不可用/)
  await assert.rejects(read(path.join(dir, 'truncated.png')), /缩略图不可用/)
  const result = await read(path.join(dir, 'portrait.png'))
  assert.equal(result.ok, true)
})

test('PDF worker keeps the event loop responsive, isolates outputs, and rejects excess pages', async t => {
  const dir = fixture(t); if (!dir) return
  execFileSync(pythonBin, ['-c', `import fitz,sys
from pathlib import Path
p=Path(sys.argv[1])
for count in (20,101):
 d=fitz.open()
 for i in range(count): d.new_page().insert_text((40,40),'Regression page '+str(i))
 d.save(p/(str(count)+'.pdf')); d.close()
`, dir])
  const worker = createPdfPreviewWorker()
  t.after(() => worker.close())
  let ticks = 0
  const timer = setInterval(() => ticks++, 5)
  const args = { pdfPath: path.join(dir, '20.pdf'), pythonBin, dataDir: dir }
  try {
    const start = performance.now()
    const first = await worker.run(args)
    assert.equal(first.ok, true, first.error)
    assert.equal(first.page_count, 20)
    assert.ok(ticks > 5, `event loop ticks: ${ticks}`)
    console.log(JSON.stringify({ pdfPages: first.page_count, elapsedMs: Math.round(performance.now()-start), eventLoopTicks: ticks }))
    const second = await worker.run(args)
    assert.equal(second.ok, true, second.error)
    assert.equal(first.preview_path, '')
    assert.match(first.pages[0].data_url, /^data:image\/png;base64,/)
    assert.deepEqual(fs.readdirSync(path.join(dir, 'pdf-previews')), [])
    const excessive = await worker.run({ ...args, pdfPath: path.join(dir, '101.pdf') })
    assert.equal(excessive.ok, false)
    assert.match(excessive.error, /100 页/)
    assert.deepEqual(fs.readdirSync(path.join(dir, 'pdf-previews')), [])
    fs.writeFileSync(path.join(dir, 'bad.pdf'), 'bad pdf')
    const bad = await worker.run({ ...args, pdfPath: path.join(dir, 'bad.pdf') })
    assert.equal(bad.ok, false)
    assert.deepEqual(fs.readdirSync(path.join(dir, 'pdf-previews')), [])
  } finally { clearInterval(timer) }
})
