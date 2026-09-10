'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { createWorkspaceFileWorker } = require('./balaWorkspaceWorker')

test('large workspace scans leave the main loop responsive and preserve hashes, deletion and manifests', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bala-worker-'))
  const worker = createWorkspaceFileWorker()
  let ticks = 0
  const timer = setInterval(() => { ticks += 1 }, 2)
  try {
    const dir = path.join(workspaceRoot, '208326102205', '01_模拍原图')
    fs.mkdirSync(dir, { recursive: true })
    const payload = Buffer.alloc(32 * 1024, 3)
    for (let i = 0; i < 1875; i += 1) fs.writeFileSync(path.join(dir, `${i}.jpg`), payload)
    // Warm the worker first so startup is not counted as responsiveness evidence.
    await worker.run('listAuthorizedBalaWorkspaceVideos', { workspaceRoot })
    ticks = 0
    const images = await worker.run('listAuthorizedBalaWorkspaceImages', { workspaceRoot })
    assert.equal(images.length, 1875)
    assert.ok(ticks > 0, 'the event loop must run while files are being hashed')
    assert.equal(images[0].sha256, crypto.createHash('sha256').update(payload).digest('hex'))
    const result = await worker.run('deleteAuthorizedWorkspaceImage', { filePath: images[0].path })
    assert.equal(result.ok, true)
    assert.equal(fs.existsSync(images[0].path), false)
    const missing = await worker.run('deleteAuthorizedWorkspaceImage', { filePath: images[0].path })
    assert.equal(missing.alreadyMissing, true)
    await worker.run('writeAuthorizedBalaWorkspaceManifest', { workspaceRoot, payload: { version: 1, task: 'preserved' } })
    assert.deepEqual(await worker.run('readAuthorizedBalaWorkspaceManifest', { workspaceRoot }), { version: 1, task: 'preserved' })
    await assert.rejects(worker.run('deleteAuthorizedWorkspaceImage', { filePath: dir }), /目录/)
    await assert.rejects(worker.run('arbitraryOperation', {}), /不支持/)
    assert.equal((await worker.run('listAuthorizedBalaWorkspaceImages', { workspaceRoot })).length, 1874)
  } finally {
    clearInterval(timer)
    await worker.close()
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('video history worker persists hidden records and deletes an unregistered video after restart', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bala-video-cleanup-'))
  const video = path.join(workspaceRoot, '209426107202_seedance_cgt-old.mp4')
  let worker = createWorkspaceFileWorker()
  try {
    fs.writeFileSync(video, 'video')
    const payload = { workspaceDir: workspaceRoot, video: { tasks: [], results: [], hiddenPaths: [video] } }
    await worker.run('writeAuthorizedBalaWorkspaceManifest', { workspaceRoot, payload })
    await worker.close()
    worker = createWorkspaceFileWorker()
    assert.deepEqual(await worker.run('readAuthorizedBalaWorkspaceManifest', { workspaceRoot }), payload)
    assert.equal(fs.existsSync(video), true)
    assert.equal((await worker.run('deleteAuthorizedWorkspaceVideos', { workspaceRoot, filePaths: [video] })).ok, true)
    assert.equal(fs.existsSync(video), false)
    assert.equal((await worker.run('deleteAuthorizedWorkspaceVideos', { workspaceRoot, filePaths: [video] })).missing_count, 1)
  } finally {
    await worker.close()
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  }
})
