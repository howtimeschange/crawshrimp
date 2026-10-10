#!/usr/bin/env node

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { once } = require('node:events')

const ELECTRON_CHILD_ARG = '--electron-child'
const LIVE_ARG = '--live'
const JSON_ARG = '--json'
const LIVE_TARGET = 'https://updates.crawshrimp.com/crawshrimp-v2.5.11-mac-arm64.zip'
const ELECTRON_TIMEOUT_MS = 60_000

if (!process.versions.electron && !process.argv.includes(ELECTRON_CHILD_ARG)) {
  const electronBin = require('electron')
  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE

  let command = electronBin
  let args = [__filename, ELECTRON_CHILD_ARG, ...process.argv.slice(2)]
  if (process.platform === 'linux') {
    args = ['--no-sandbox', ...args]
    if (!process.env.DISPLAY) {
      command = 'xvfb-run'
      args = ['-a', electronBin, ...args]
    }
  }

  const result = spawnSync(command, args, {
    cwd: path.join(__dirname, '..'),
    env: childEnv,
    stdio: 'inherit',
    timeout: ELECTRON_TIMEOUT_MS,
  })
  if (result.error) {
    const hint = command === 'xvfb-run'
      ? 'xvfb-run is required to run this Electron regression on Linux without DISPLAY.'
      : 'Electron regression launcher failed.'
    console.error(`${hint}\n${result.error.stack || result.error.message}`)
    process.exit(1)
  }
  if (result.signal) {
    console.error(`Electron regression timed out or was terminated by ${result.signal}.`)
    process.exit(1)
  }
  process.exit(result.status == null ? 1 : result.status)
}

const { app, session } = require('electron')
const { EventEmitter } = require('node:events')
const { ElectronHttpExecutor } = require('../node_modules/electron-updater/out/electronHttpExecutor')
const { GenericDifferentialDownloader } = require('../node_modules/electron-updater/out/differentialDownloader/GenericDifferentialDownloader')
const { CancellationToken, configureRequestOptions, configureRequestUrl } = require('../node_modules/builder-util-runtime')
const { createUpdateService } = require('../src/updateService')

const quietJson = process.argv.includes(JSON_ARG)

function sha512(bytes) {
  return crypto.createHash('sha512').update(bytes).digest('base64')
}

function makeBlockMap(bytes, blockSize) {
  const sizes = []
  const checksums = []
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    const block = bytes.subarray(offset, Math.min(offset + blockSize, bytes.length))
    sizes.push(block.length)
    checksums.push(sha512(block))
  }
  return {
    version: '1',
    files: [{ name: 'file', offset: 0, sizes, checksums }],
  }
}

function createLogger(messages) {
  return {
    info: message => messages.push({ level: 'info', message }),
    warn: message => messages.push({ level: 'warn', message }),
    error: message => messages.push({ level: 'error', message }),
    debug: message => messages.push({ level: 'debug', message }),
  }
}

async function createR2LikeServer({ updateBytes, silentBytes }) {
  const requests = []
  let silent = true
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      range: req.headers.range || req.headers.Range || null,
    })

    if (req.url === '/redirect.bin') {
      res.writeHead(302, { location: `${new URL('new.bin', `http://127.0.0.1:${server.address().port}/`)}` })
      res.end()
      return
    }

    if (req.url === '/silent.bin') {
      const commonHeaders = {
        'accept-ranges': 'bytes',
        'content-length': String(silentBytes.length),
        'content-type': 'application/octet-stream',
      }
      if (silent) {
        res.writeHead(200, commonHeaders)
        req.on('close', () => res.destroy())
        return
      }
      res.writeHead(200, commonHeaders)
      res.end(silentBytes)
      return
    }

    if (req.url !== '/new.bin') {
      res.writeHead(404)
      res.end('not found')
      return
    }

    const range = req.headers.range
    const commonHeaders = {
      'accept-ranges': 'bytes',
      'cache-control': 'public, max-age=31536000, immutable',
      'content-type': 'application/octet-stream',
    }

    if (range != null) {
      if (!range.startsWith('bytes=') || range.includes(',')) {
        res.writeHead(400, { ...commonHeaders, 'content-type': 'text/html' })
        res.end('<html><body>bad range</body></html>')
        return
      }

      const match = /^bytes=(\d+)-(\d+)$/.exec(range)
      if (match == null) {
        res.writeHead(416, { ...commonHeaders, 'content-range': `bytes */${updateBytes.length}` })
        res.end()
        return
      }

      const start = Number(match[1])
      const end = Number(match[2])
      if (start > end || end >= updateBytes.length) {
        res.writeHead(416, { ...commonHeaders, 'content-range': `bytes */${updateBytes.length}` })
        res.end()
        return
      }

      const body = updateBytes.subarray(start, end + 1)
      res.writeHead(206, {
        ...commonHeaders,
        'content-length': String(body.length),
        'content-range': `bytes ${start}-${end}/${updateBytes.length}`,
      })
      if (req.method === 'HEAD') res.end()
      else res.end(body)
      return
    }

    res.writeHead(200, { ...commonHeaders, 'content-length': String(updateBytes.length) })
    if (req.method === 'HEAD') res.end()
    else res.end(updateBytes)
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    requests,
    setSilent(value) { silent = Boolean(value) },
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  }
}

function makeExecutor(label) {
  const partition = `update-download-regression-${label}-${process.pid}-${Date.now()}`
  const executor = new ElectronHttpExecutor()
  executor.cachedSession = session.fromPartition(partition, { cache: false })
  return executor
}

function createServiceConfigProbe(feedUrl) {
  const updater = new EventEmitter()
  const feeds = []
  updater.httpExecutor = makeExecutor('service-config')
  updater.checkForUpdates = async () => {}
  updater.downloadUpdate = async () => {}
  updater.quitAndInstall = () => {}
  updater.setFeedURL = options => feeds.push(options)

  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.5.7' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
    updateFeedUrl: feedUrl,
    log: createLogger([]),
  })
  service.dispose()

  assert.equal(feeds.length, 1)
  assert.equal(feeds[0].provider, 'generic')
  assert.equal(feeds[0].url, feedUrl)
  assert.equal(feeds[0].useMultipleRangeRequest, false)
  return feeds[0]
}

async function runServiceTimeoutRetry({ server, root, bytes }) {
  class StubUpdater extends EventEmitter {
    constructor() {
      super()
      this.httpExecutor = makeExecutor('service-timeout')
      this.feeds = []
      this.downloadAttempts = 0
      this.tokens = []
      this.downloadedFiles = []
    }

    setFeedURL(options) {
      this.feeds.push(options)
    }

    async checkForUpdates() {
      this.emit('update-available', {
        version: '9.9.9',
        releaseNotes: 'transport regression',
        files: [{ size: bytes.length }],
      })
    }

    async downloadUpdate(token) {
      this.downloadAttempts += 1
      this.tokens.push(token)
      const destination = path.join(root, `service-download-${this.downloadAttempts}.bin`)
      await this.httpExecutor.download(new URL('silent.bin', server.url), destination, {
        cancellationToken: token,
        sha512: sha512(bytes),
        onProgress: progress => this.emit('download-progress', progress),
      })
      this.downloadedFiles.push(destination)
      this.emit('update-downloaded', { version: '9.9.9' })
      return [destination]
    }

    quitAndInstall() {}
  }

  const updater = new StubUpdater()
  const statuses = []
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.5.7' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
    updateFeedUrl: server.url,
    getAvailableBytes: () => 1024 * 1024,
    downloadStallTimeoutMs: 200,
    log: createLogger([]),
    emit: status => statuses.push(status),
  })

  try {
    await service.checkForUpdates()
    assert.equal(service.getStatus().status, 'available')
    await assert.rejects(() => service.downloadUpdate(), /未收到数据/)
    assert.equal(service.getStatus().status, 'error')
    assert.equal(updater.tokens.length, 1)
    assert.equal(updater.tokens[0].cancelled, true)

    updater.emit('update-downloaded', { version: 'late-cancelled-event' })
    assert.equal(service.getStatus().status, 'error')
    assert.equal(service.getStatus().downloaded, false)

    server.setSilent(false)
    await service.downloadUpdate()
    assert.equal(service.getStatus().status, 'ready-to-install')
    assert.equal(service.getStatus().downloaded, true)
    assert.equal(updater.downloadAttempts, 2)
    assert.deepEqual(fs.readFileSync(updater.downloadedFiles.at(-1)), bytes)

    return {
      attempts: updater.downloadAttempts,
      firstTokenCancelled: updater.tokens[0].cancelled,
      finalStatus: service.getStatus().status,
      finalDownloaded: service.getStatus().downloaded,
      downloadedBytes: fs.statSync(updater.downloadedFiles.at(-1)).size,
      statusEvents: statuses.map(status => status.status),
    }
  } finally {
    service.dispose()
  }
}

async function runGuardedRedirectDownload({ server, root, bytes }) {
  const updater = new EventEmitter()
  updater.httpExecutor = makeExecutor('service-redirect')
  updater.checkForUpdates = async () => {}
  updater.downloadUpdate = async () => {}
  updater.quitAndInstall = () => {}
  updater.setFeedURL = () => {}

  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.5.7' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
    updateFeedUrl: server.url,
    downloadStallTimeoutMs: 1000,
    log: createLogger([]),
  })

  try {
    const destination = path.join(root, 'redirect-new.bin')
    await updater.httpExecutor.download(new URL('redirect.bin', server.url), destination, {
      cancellationToken: new CancellationToken(),
      sha512: sha512(bytes),
    })
    assert.deepEqual(fs.readFileSync(destination), bytes)
    return {
      bytes: fs.statSync(destination).size,
      sha512: sha512(fs.readFileSync(destination)),
    }
  } finally {
    service.dispose()
  }
}

async function runLocalRegression(root) {
  const oldBytes = Buffer.from('AAAABBBBCCCCDDDD', 'utf8')
  const newBytes = Buffer.from('AAAAxxxxCCCCyyyy', 'utf8')
  const serviceBytes = Buffer.from('service-download-ok', 'utf8')
  const oldBlockMap = makeBlockMap(oldBytes, 4)
  const newBlockMap = makeBlockMap(newBytes, 4)
  const server = await createR2LikeServer({ updateBytes: newBytes, silentBytes: serviceBytes })
  const loggerMessages = []

  try {
    const providerOptions = createServiceConfigProbe(server.url)
    const oldFile = path.join(root, 'old.bin')
    const diffFile = path.join(root, 'diff-new.bin')
    const fullFile = path.join(root, 'full-new.bin')
    fs.writeFileSync(oldFile, oldBytes)

    const diffProgress = []
    const diffDownloader = new GenericDifferentialDownloader(
      { size: newBytes.length, sha512: sha512(newBytes) },
      makeExecutor('diff'),
      {
        oldFile,
        newUrl: new URL('new.bin', server.url),
        newFile: diffFile,
        logger: createLogger(loggerMessages),
        requestHeaders: null,
        isUseMultipleRangeRequest: providerOptions.useMultipleRangeRequest,
        cancellationToken: new CancellationToken(),
        onProgress: progress => diffProgress.push(progress),
      },
    )

    await diffDownloader.download(oldBlockMap, newBlockMap)
    assert.deepEqual(fs.readFileSync(diffFile), newBytes)

    const diffRanges = server.requests
      .filter(request => request.range != null)
      .map(request => request.range)
    assert.deepEqual(diffRanges, ['bytes=4-7', 'bytes=12-15'])
    assert.ok(diffProgress.length >= 1)
    assert.equal(diffProgress.at(-1).percent, 100)

    const fullProgress = []
    await makeExecutor('full').download(new URL('new.bin', server.url), fullFile, {
      cancellationToken: new CancellationToken(),
      sha512: sha512(newBytes),
      onProgress: progress => fullProgress.push(progress),
    })
    assert.deepEqual(fs.readFileSync(fullFile), newBytes)
    assert.ok(fullProgress.length >= 1)
    assert.equal(fullProgress.at(-1).percent, 100)

    const serviceRetry = await runServiceTimeoutRetry({ server, root, bytes: serviceBytes })
    const guardedRedirect = await runGuardedRedirectDownload({ server, root, bytes: newBytes })

    return {
      ok: true,
      mode: 'local',
      userData: app.getPath('userData'),
      outputRoot: root,
      providerOptions,
      differential: {
        rebuiltBytes: fs.statSync(diffFile).size,
        rangeRequests: diffRanges,
        progressEvents: diffProgress.length,
        finalProgress: diffProgress.at(-1),
      },
      fullDownload: {
        bytes: fs.statSync(fullFile).size,
        progressEvents: fullProgress.length,
        finalProgress: fullProgress.at(-1),
      },
      serviceRetry,
      guardedRedirect,
      serverRequests: server.requests,
      loggerMessages,
    }
  } finally {
    await server.close()
  }
}

function pickHeaders(headers) {
  const wanted = ['server', 'date', 'content-type', 'content-length', 'content-range', 'accept-ranges', 'cf-cache-status', 'cf-ray', 'etag', 'last-modified', 'cache-control']
  const out = {}
  for (const key of wanted) {
    if (headers[key] != null) out[key] = headers[key]
  }
  return out
}

async function probeLiveRange(mode, range) {
  const ses = session.fromPartition(`update-download-regression-live-${mode}-${process.pid}-${Date.now()}`, { cache: false })
  await ses.setProxy({ mode })
  const executor = new ElectronHttpExecutor()
  executor.cachedSession = ses

  const options = {
    headers: { Range: range, 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    redirect: 'manual',
  }
  configureRequestUrl(new URL(LIVE_TARGET), options)
  configureRequestOptions(options)

  const resolvedProxy = await ses.resolveProxy(LIVE_TARGET).catch(error => `resolveProxy failed: ${error.message}`)
  const started = Date.now()

  return await new Promise(resolve => {
    let settled = false
    const finish = extra => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        mode,
        range,
        resolvedProxy,
        elapsedMs: Date.now() - started,
        ...extra,
      })
    }
    const request = executor.createRequest(options, response => {
      const result = {
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
        headers: pickHeaders(response.headers || {}),
      }
      response.once('data', chunk => {
        request.abort()
        finish({ ...result, firstChunkBytes: chunk.length, firstDataMs: Date.now() - started, abortedAfterFirstData: true })
      })
      response.once('end', () => finish({ ...result, ended: true }))
      response.once('error', error => finish({ ...result, responseError: error.message }))
    })
    request.once('error', error => finish({ requestError: error.message }))
    request.end()
    const timer = setTimeout(() => {
      request.abort()
      finish({ watchdogTimeoutMs: Date.now() - started })
    }, 9000)
  })
}

async function runLiveProbe(root) {
  return {
    ok: true,
    mode: 'live',
    userData: app.getPath('userData'),
    outputRoot: root,
    target: LIVE_TARGET,
    probes: [
      await probeLiveRange('system', 'bytes=0-1023'),
      await probeLiveRange('system', 'bytes=0-1023,2048-3071'),
      await probeLiveRange('direct', 'bytes=0-1023'),
      await probeLiveRange('direct', 'bytes=0-1023,2048-3071'),
    ],
  }
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-update-download-regression-'))
  app.setPath('userData', path.join(root, 'userData'))
  await app.whenReady()

  try {
    const result = process.argv.includes(LIVE_ARG)
      ? await runLiveProbe(root)
      : await runLocalRegression(root)

    if (quietJson) {
      console.log(JSON.stringify(result))
    } else {
      console.log(JSON.stringify(result, null, 2))
    }
  } finally {
    app.quit()
  }
}

main().catch(error => {
  console.error(error?.stack || error)
  app.exit(1)
})
