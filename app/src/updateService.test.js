const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createUpdateService } = require('./updateService')

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

test('downloaded update becomes waiting or ready only through readiness input', () => {
  const updater = createUpdater()
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
  })

  updater.emit('update-downloaded', { version: '2.0.1' })
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
  assert.throws(() => service.setInstalling(), /尚未准备好安装/)
  service.setInstallReadiness({ ready: true, blockers: [] })
  service.setInstalling()
  service.quitAndInstall()
  assert.equal(installs, 1)
})

test('test feed URL configures only the injected generic feed', () => {
  const updater = createUpdater()
  const feeds = []
  updater.setFeedURL = options => feeds.push(options)
  createService({
    autoUpdater: updater,
    testFeedUrl: 'http://127.0.0.1:40123',
  })

  assert.deepEqual(feeds, [{ provider: 'generic', url: 'http://127.0.0.1:40123' }])
})
