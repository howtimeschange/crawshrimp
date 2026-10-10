const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const path = require('node:path')

function runRegression() {
  return new Promise((resolve, reject) => {
    let settled = false
    const child = spawn(process.execPath, [
      path.join(__dirname, 'update-download-regression.js'),
      '--json',
    ], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error('update download regression timed out'))
    }, 65_000)
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.on('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const out = Buffer.concat(stdout).toString('utf8')
      const err = Buffer.concat(stderr).toString('utf8')
      if (code !== 0) {
        reject(new Error(`update download regression exited ${code}\n${err}\n${out}`))
        return
      }
      try {
        resolve(JSON.parse(out))
      } catch (error) {
        reject(new Error(`cannot parse regression JSON: ${error.message}\n${err}\n${out}`))
      }
    })
  })
}

test('Electron updater download regression uses single byte ranges and validates downloads', { timeout: 70_000 }, async () => {
  const result = await runRegression()

  assert.equal(result.ok, true)
  assert.equal(result.mode, 'local')
  assert.deepEqual(result.providerOptions, {
    provider: 'generic',
    url: result.providerOptions.url,
    useMultipleRangeRequest: false,
  })
  assert.deepEqual(result.differential.rangeRequests, ['bytes=4-7', 'bytes=12-15'])
  assert.equal(result.differential.rebuiltBytes, 16)
  assert.equal(result.differential.finalProgress.percent, 100)
  assert.equal(result.fullDownload.bytes, 16)
  assert.equal(result.fullDownload.finalProgress.percent, 100)
  assert.deepEqual(result.serviceRetry, {
    attempts: 2,
    firstTokenCancelled: true,
    finalStatus: 'ready-to-install',
    finalDownloaded: true,
    downloadedBytes: 19,
    statusEvents: result.serviceRetry.statusEvents,
  })
  assert.deepEqual(result.serviceRetry.statusEvents, [
    'checking',
    'available',
    'downloading',
    'error',
    'downloading',
    'downloading',
    'ready-to-install',
  ])
  assert.deepEqual(result.guardedRedirect, {
    bytes: 16,
    sha512: result.guardedRedirect.sha512,
  })
  assert.equal(result.guardedRedirect.sha512.length > 0, true)
  assert.deepEqual(result.serverRequests.slice(0, 5).map(request => request.range), [
    'bytes=4-7',
    'bytes=12-15',
    null,
    null,
    null,
  ])
  const redirectIndex = result.serverRequests.findIndex(request => request.url === '/redirect.bin')
  assert.notEqual(redirectIndex, -1)
  assert.equal(result.serverRequests[redirectIndex + 1]?.url, '/new.bin')
})
