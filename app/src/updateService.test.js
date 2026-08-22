const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createUpdateService, fetchLatestReleaseNotes } = require('./updateService')

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

test('downloaded update becomes waiting or ready only through readiness input', () => {
  const updater = createUpdater()
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
  })

  updater.emit('update-downloaded', { version: '2.0.1' })
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

test('download progress is normalized to a stable percent and byte shape', () => {
  const updater = createUpdater()
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
  })

  updater.emit('download-progress', {
    percent: 34.567,
    transferred: 34567,
    total: 100000,
    bytesPerSecond: 1234,
  })

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

test('quitAndInstall rejects until a downloaded update is explicitly installing', () => {
  const updater = createUpdater()
  let installs = 0
  updater.quitAndInstall = () => { installs += 1 }
  const service = createService({ autoUpdater: updater })

  assert.throws(() => service.quitAndInstall(), /尚未准备好安装/)
  updater.emit('update-downloaded', { version: '2.0.1' })
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

  assert.deepEqual(feeds, [{ provider: 'generic', url: 'https://updates.crawshrimp.com/' }])
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
    { provider: 'generic', url: 'https://updates.crawshrimp.com/' },
    { provider: 'github', owner: 'howtimeschange', repo: 'crawshrimp' },
  ])
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
