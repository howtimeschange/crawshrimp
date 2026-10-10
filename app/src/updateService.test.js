const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createUpdateService, fetchLatestReleaseNotes } = require('./updateService')
const { CancellationToken } = require('builder-util-runtime')
const quietLog = { info() {}, warn() {}, error() {}, debug() {} }

function createUpdater() {
  const updater = new EventEmitter()
  updater.checkForUpdates = async () => {}
  updater.downloadUpdate = async () => {}
  updater.quitAndInstall = () => {}
  updater.setFeedURL = () => {}
  return updater
}

function createService(options = {}) {
  return createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: createUpdater(),
    platformSupport: { supported: true, reason: '' },
    log: quietLog,
    ...options,
  })
}

test('available update waits for explicit download', async () => {
  const updater = createUpdater()
  updater.checkForUpdates = async () => {
    updater.emit('update-available', { version: '2.0.1', releaseNotes: '安全更新' })
  }
  let downloads = 0
  updater.downloadUpdate = async () => { downloads += 1 }

  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
  })

  await service.checkForUpdates({ manual: false })
  assert.equal(service.getStatus().status, 'available')
  assert.equal(downloads, 0)
  await service.downloadUpdate()
  assert.equal(downloads, 1)
})

test('available update records the time of the automatic check', async () => {
  const updater = createUpdater()
  updater.checkForUpdates = async () => {
    updater.emit('update-available', { version: '2.0.1' })
  }
  const service = createService({ autoUpdater: updater })

  await service.checkForUpdates({ manual: false })

  assert.equal(service.getStatus().status, 'available')
  assert.match(service.getStatus().lastCheckedAt, /^\d{4}-\d{2}-\d{2}T/)
})

test('downloaded update becomes waiting or ready only through readiness input', async () => {
  const updater = createUpdater()
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
  })

  updater.emit('update-available', { version: '2.0.1' })
  updater.downloadUpdate = async () => updater.emit('update-downloaded', { version: '2.0.1' })
  await service.downloadUpdate()
  assert.equal(service.getStatus().status, 'ready-to-install')
  service.setInstallReadiness({
    ready: false,
    blockers: [{ kind: 'task', id: 'tmall::export', label: '导出任务', status: 'running' }],
  })
  assert.equal(service.getStatus().status, 'waiting-for-tasks')

  service.setInstallReadiness({ ready: true, blockers: [] })
  assert.equal(service.getStatus().status, 'ready-to-install')
})

test('unsupported development builds are disabled and do not check for updates', async () => {
  const updater = createUpdater()
  let checks = 0
  updater.checkForUpdates = async () => { checks += 1 }
  const service = createUpdateService({
    app: { isPackaged: false, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: false, reason: '开发模式不会检查桌面更新。' },
  })

  assert.equal(service.getStatus().status, 'disabled')
  await assert.rejects(() => service.checkForUpdates({ manual: true }), /开发模式不会检查桌面更新/)
  assert.equal(checks, 0)
})

test('subscription cleanup stops status notifications and dispose removes updater listeners', async () => {
  const updater = createUpdater()
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
  })
  const statuses = []
  const unsubscribe = service.subscribe(status => statuses.push(status.status))

  updater.emit('checking-for-update')
  unsubscribe()
  updater.emit('update-not-available')
  assert.deepEqual(statuses, ['idle', 'checking'])

  service.dispose()
  assert.equal(updater.listenerCount('checking-for-update'), 0)
  updater.emit('checking-for-update')
  assert.equal(service.getStatus().status, 'up-to-date')
})

test('no available update publishes the declared up-to-date status', () => {
  const updater = createUpdater()
  const service = createService({ autoUpdater: updater })

  updater.emit('update-not-available')

  assert.equal(service.getStatus().status, 'up-to-date')
})

test('download progress is normalized to a stable percent and byte shape', async () => {
  const updater = createUpdater()
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
  })

  updater.downloadUpdate = async () => updater.emit('download-progress', {
    percent: 34.567,
    transferred: 34567,
    total: 100000,
    bytesPerSecond: 1234,
  })
  updater.emit('update-available', { version: '2.0.1' })
  await service.downloadUpdate()

  assert.deepEqual(service.getStatus().progress, {
    percent: 34.57,
    transferred: 34567,
    total: 100000,
    bytesPerSecond: 1234,
  })
})

test('SHA and download errors keep a newer version eligible for retry', async () => {
  const updater = createUpdater()
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
  })

  updater.emit('update-available', { version: '2.0.1' })
  updater.emit('error', new Error('sha512 checksum mismatch'))
  assert.equal(service.getStatus().status, 'error')
  assert.match(service.getStatus().error, /sha512 checksum mismatch/)
  await assert.doesNotReject(() => service.downloadUpdate())
})

test('insufficient disk space prevents download with a user-facing error', async () => {
  const updater = createUpdater()
  updater.checkForUpdates = async () => {
    updater.emit('update-available', { version: '2.0.1', files: [{ size: 200 }] })
  }
  let downloads = 0
  updater.downloadUpdate = async () => { downloads += 1 }
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
    getAvailableBytes: () => 100,
  })

  await service.checkForUpdates({ manual: true })
  await assert.rejects(() => service.downloadUpdate(), /磁盘空间不足/)
  assert.equal(downloads, 0)
  assert.match(service.getStatus().error, /磁盘空间不足/)
  assert.match(service.getStatus().error, /200 B/)
  assert.match(service.getStatus().error, /100 B/)
})

test('disk probe failure publishes an update error and skips download', async () => {
  const updater = createUpdater()
  updater.checkForUpdates = async () => {
    updater.emit('update-available', { version: '2.0.1', files: [{ size: 200 }] })
  }
  let downloads = 0
  updater.downloadUpdate = async () => { downloads += 1 }
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
    getAvailableBytes: () => {
      throw new Error('statfs failed')
    },
  })

  await service.checkForUpdates({ manual: true })
  await assert.rejects(() => service.downloadUpdate(), /statfs failed/)

  assert.equal(downloads, 0)
  assert.equal(service.getStatus().status, 'error')
  assert.match(service.getStatus().error, /statfs failed/)
})

test('quitAndInstall rejects until a downloaded update is explicitly installing', async () => {
  const updater = createUpdater()
  let installs = 0
  updater.quitAndInstall = () => { installs += 1 }
  const service = createService({ autoUpdater: updater })

  assert.throws(() => service.quitAndInstall(), /尚未准备好安装/)
  updater.emit('update-available', { version: '2.0.1' })
  updater.downloadUpdate = async () => updater.emit('update-downloaded', { version: '2.0.1' })
  await service.downloadUpdate()
  assert.throws(() => service.quitAndInstall(), /尚未准备好安装/)
  service.setInstalling()
  service.quitAndInstall()
  assert.equal(installs, 1)
})

test('configured feed URL uses the generic updater provider', () => {
  const updater = createUpdater()
  const feeds = []
  updater.setFeedURL = options => feeds.push(options)
  createService({
    autoUpdater: updater,
    updateFeedUrl: 'https://updates.crawshrimp.com/',
  })

  assert.deepEqual(feeds, [{ provider: 'generic', url: 'https://updates.crawshrimp.com/', useMultipleRangeRequest: false }])
})

test('Cloudflare update check falls back to GitHub when the primary feed is unavailable', async () => {
  const updater = createUpdater()
  const feeds = []
  let checks = 0
  updater.setFeedURL = options => feeds.push(options)
  updater.checkForUpdates = async () => {
    checks += 1
    if (checks === 1) throw new Error('Cloudflare update feed unavailable')
    updater.emit('update-available', { version: '2.1.3' })
  }

  const service = createService({
    autoUpdater: updater,
    updateFeedUrl: 'https://updates.crawshrimp.com/',
    log: { warn: () => {} },
  })

  await assert.doesNotReject(() => service.checkForUpdates())

  assert.equal(service.getStatus().status, 'available')
  assert.deepEqual(feeds, [
    { provider: 'generic', url: 'https://updates.crawshrimp.com/', useMultipleRangeRequest: false },
    { provider: 'github', owner: 'howtimeschange', repo: 'crawshrimp' },
  ])
})

test('a new check restores single-range configuration after GitHub fallback', async () => {
  const updater = createUpdater()
  const feeds = []
  let checks = 0
  updater.setFeedURL = feed => feeds.push(feed)
  updater.checkForUpdates = async () => {
    if (++checks === 1) throw new Error('primary unavailable')
    updater.emit('update-available', { version: '2.1.3' })
  }
  const service = createService({ autoUpdater: updater, updateFeedUrl: 'https://updates.crawshrimp.com/' })
  await service.checkForUpdates()
  await service.checkForUpdates()
  assert.deepEqual(feeds.at(-1), {
    provider: 'generic', url: 'https://updates.crawshrimp.com/', useMultipleRangeRequest: false,
  })
})

test('downloads pass a cancellation token and concurrent calls share the same attempt', async () => {
  const updater = createUpdater()
  let resolveDownload
  let calls = 0
  let token
  updater.downloadUpdate = input => {
    calls += 1
    token = input
    return new Promise(resolve => { resolveDownload = resolve })
  }
  const service = createService({ autoUpdater: updater })
  updater.emit('update-available', { version: '2.0.1' })
  const first = service.downloadUpdate()
  const second = service.downloadUpdate()
  await Promise.resolve()
  assert.equal(calls, 1)
  assert.ok(token instanceof CancellationToken)
  assert.equal(service.getStatus().status, 'downloading')
  assert.equal(service.getStatus().progress, null)
  resolveDownload(['update.zip'])
  assert.deepEqual(await first, ['update.zip'])
  assert.deepEqual(await second, ['update.zip'])
})

test('automatic checks cannot reset an active download or replace its provider', async () => {
  const updater = createUpdater()
  let resolveDownload
  let checks = 0
  updater.checkForUpdates = async () => { checks += 1 }
  updater.downloadUpdate = () => new Promise(resolve => { resolveDownload = resolve })
  const service = createService({ autoUpdater: updater })
  updater.emit('update-available', { version: '2.0.1' })
  const pending = service.downloadUpdate()
  await Promise.resolve()
  updater.emit('download-progress', { percent: 20, transferred: 20, total: 100 })
  await service.checkForUpdates()
  assert.equal(checks, 0)
  assert.equal(service.getStatus().progress.percent, 20)
  assert.equal(service.getStatus().status, 'downloading')
  resolveDownload([])
  await pending
})

test('cancelled download events cannot overwrite its error and retry waits for cleanup', async () => {
  const updater = createUpdater()
  let token
  let rejectDownload
  let downloads = 0
  updater.downloadUpdate = input => {
    downloads += 1
    token = input
    return new Promise((resolve, reject) => { rejectDownload = reject })
  }
  const service = createService({ autoUpdater: updater })
  updater.emit('update-available', { version: '2.0.1' })
  const pending = service.downloadUpdate()
  const rejection = assert.rejects(pending, /timeout/)
  await Promise.resolve()
  token.cancel()
  updater.emit('download-progress', { percent: 90 })
  updater.emit('update-downloaded', { version: '2.0.1' })
  updater.emit('error', new Error('late updater failure'))
  assert.equal(service.getStatus().status, 'downloading')
  const duplicate = service.downloadUpdate()
  const duplicateRejection = assert.rejects(duplicate, /timeout/)
  assert.equal(downloads, 1)
  rejectDownload(new Error('timeout'))
  await Promise.all([rejection, duplicateRejection])
  assert.equal(service.getStatus().status, 'error')
  updater.emit('download-progress', { percent: 100 })
  updater.emit('update-downloaded', { version: '2.0.1' })
  updater.emit('error', new Error('late cancellation'))
  assert.equal(service.getStatus().status, 'error')
  assert.equal(service.getStatus().error, 'timeout')
  updater.downloadUpdate = async input => {
    assert.notEqual(input, token)
    assert.equal(input.cancelled, false)
    downloads += 1
    updater.emit('update-downloaded', { version: '2.0.1' })
    return ['retry.zip']
  }
  assert.deepEqual(await service.downloadUpdate(), ['retry.zip'])
  assert.equal(downloads, 2)
  assert.equal(service.getStatus().status, 'ready-to-install')
})

test('dispose cancels active downloads and does not start downloads after a pending disk probe', async () => {
  const updater = createUpdater()
  const originalLogger = { info() {}, warn() {}, error() {} }
  updater.logger = originalLogger
  let resolveDisk
  let downloads = 0
  updater.downloadUpdate = async () => { downloads += 1 }
  const service = createService({
    autoUpdater: updater,
    getAvailableBytes: () => new Promise(resolve => { resolveDisk = resolve }),
  })
  updater.emit('update-available', { version: '2.0.1' })
  const pending = service.downloadUpdate()
  const rejection = assert.rejects(pending, /cancelled/)
  await Promise.resolve()
  service.dispose()
  resolveDisk(1_000_000)
  await rejection
  assert.equal(downloads, 0)
  assert.equal(updater.logger, originalLogger)
  assert.equal(updater.listenerCount('download-progress'), 0)
  await assert.rejects(service.downloadUpdate(), /已关闭/)
})

test('an unavailable disk probe is not treated as zero free bytes', async () => {
  const updater = createUpdater()
  let downloads = 0
  updater.downloadUpdate = async () => { downloads += 1 }
  const service = createService({ autoUpdater: updater })
  updater.emit('update-available', { version: '2.0.1', files: [{ size: 1000 }] })
  await service.downloadUpdate()
  assert.equal(downloads, 1)
})

test('updater diagnostic messages reach the provided desktop logger', () => {
  const updater = createUpdater()
  const entries = []
  const service = createService({ autoUpdater: updater, log: { warn: (...args) => entries.push(args) } })
  updater.logger.warn('Cannot download differentially, fallback to full download')
  assert.match(entries[0][0], /fallback to full download/)
  assert.doesNotThrow(() => updater.logger.info('info'))
  assert.doesNotThrow(() => updater.logger.error('error'))
  service.dispose()
})

test('release notes prefer GitHub latest release API before Cloudflare fallbacks', async () => {
  const calls = []
  const fetchImpl = async url => {
    calls.push(url)
    return createJsonResponse({
      tag_name: 'v2.1.0',
      body: '- GitHub notes',
      published_at: '2026-08-22T10:00:00Z',
      html_url: 'https://github.test/releases/v2.1.0',
    })
  }

  const result = await fetchLatestReleaseNotes({
    fetchImpl,
    mirrorUrl: 'https://mirror.test/latest-release.json',
    cloudflareUrl: 'https://updates.crawshrimp.test/latest-release.json',
    githubUrl: 'https://api.github.test/releases/latest',
  })

  assert.deepEqual(calls, ['https://api.github.test/releases/latest'])
  assert.deepEqual(result, {
    ok: true,
    version: '2.1.0',
    body: '- GitHub notes',
    publishedAt: '2026-08-22T10:00:00Z',
    url: 'https://github.test/releases/v2.1.0',
  })
})

test('release notes fall back to the configured mirror after GitHub fails', async () => {
  const calls = []
  const fetchImpl = async url => {
    calls.push(url)
    if (url === 'https://api.github.test/releases/latest') {
      return createTextResponse('unavailable', { status: 503 })
    }
    return createJsonResponse({
      tagName: 'v2.3.0',
      changelog: 'Mirror notes',
      date: '2026-08-22',
      url: 'https://mirror.test/releases/v2.3.0',
    })
  }

  const result = await fetchLatestReleaseNotes({
    fetchImpl,
    mirrorUrl: 'https://mirror.test/latest-release.json',
    cloudflareUrl: 'https://updates.crawshrimp.test/latest-release.json',
    githubUrl: 'https://api.github.test/releases/latest',
  })

  assert.deepEqual(calls, [
    'https://api.github.test/releases/latest',
    'https://mirror.test/latest-release.json',
  ])
  assert.deepEqual(result, {
    ok: true,
    version: '2.3.0',
    body: 'Mirror notes',
    publishedAt: '2026-08-22',
    url: 'https://mirror.test/releases/v2.3.0',
  })
})

test('release notes fall back to Cloudflare JSON when GitHub and mirror fail', async () => {
  const calls = []
  const fetchImpl = async url => {
    calls.push(url)
    if (url !== 'https://updates.crawshrimp.test/latest-release.json') {
      return createTextResponse('unavailable', { status: 503 })
    }
    return createJsonResponse({
      version: '2.2.0',
      notes: 'Cloudflare notes',
      publishedAt: '2026-08-22T11:00:00Z',
      releaseUrl: 'https://updates.crawshrimp.test/releases/2.2.0',
    })
  }

  const result = await fetchLatestReleaseNotes({
    fetchImpl,
    mirrorUrl: 'https://mirror.test/latest-release.json',
    cloudflareUrl: 'https://updates.crawshrimp.test/latest-release.json',
    githubUrl: 'https://api.github.test/releases/latest',
  })

  assert.deepEqual(calls, [
    'https://api.github.test/releases/latest',
    'https://mirror.test/latest-release.json',
    'https://updates.crawshrimp.test/latest-release.json',
  ])
  assert.deepEqual(result, {
    ok: true,
    version: '2.2.0',
    body: 'Cloudflare notes',
    publishedAt: '2026-08-22T11:00:00Z',
    url: 'https://updates.crawshrimp.test/releases/2.2.0',
  })
})

test('release notes accept Cloudflare markdown after GitHub fails', async () => {
  const calls = []
  const fetchImpl = async url => {
    calls.push(url)
    if (url === 'https://api.github.test/releases/latest') {
      return createTextResponse('unavailable', { status: 503 })
    }
    return createTextResponse('# v2.4.0\n\n- Cloudflare markdown notes', { contentType: 'text/markdown' })
  }

  const result = await fetchLatestReleaseNotes({
    fetchImpl,
    mirrorUrl: '',
    cloudflareUrl: 'https://updates.crawshrimp.test/latest-release.json',
    githubUrl: 'https://api.github.test/releases/latest',
  })

  assert.deepEqual(calls, [
    'https://api.github.test/releases/latest',
    'https://updates.crawshrimp.test/latest-release.json',
  ])
  assert.deepEqual(result, {
    ok: true,
    version: '',
    body: '# v2.4.0\n\n- Cloudflare markdown notes',
    publishedAt: '',
    url: 'https://updates.crawshrimp.test/latest-release.json',
  })
})

function createJsonResponse(payload, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => String(name).toLowerCase() === 'content-type' ? 'application/json' : '' },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }
}

function createTextResponse(body, { status = 200, contentType = 'text/plain' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => String(name).toLowerCase() === 'content-type' ? contentType : '' },
    json: async () => JSON.parse(body),
    text: async () => body,
  }
}
