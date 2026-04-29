const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const { createUpdateService } = require('./updateService')

test('defers install while tasks are active and installs automatically after they finish', async () => {
  const updater = new EventEmitter()
  updater.autoDownload = false
  updater.checkForUpdates = async () => ({ updateInfo: { version: '1.4.6', releaseNotes: 'notes' } })
  updater.downloadUpdate = async () => ['downloaded']
  let quitAndInstallCount = 0
  updater.quitAndInstall = () => { quitAndInstallCount += 1 }

  const events = []
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '1.4.5' },
    autoUpdater: updater,
    log: () => {},
    emit: event => events.push(event),
  })

  service.setActiveTaskCount(1)
  updater.emit('update-downloaded', { version: '1.4.6', releaseNotes: 'notes' })
  const deferred = service.installDownloadedUpdate()

  assert.equal(deferred.ok, false)
  assert.equal(deferred.deferred, true)
  assert.equal(quitAndInstallCount, 0)
  assert.equal(service.getStatus().installDeferred, true)

  service.setActiveTaskCount(0)

  assert.equal(quitAndInstallCount, 1)
  assert.equal(service.getStatus().installDeferred, false)
  assert.equal(events.at(-1).status, 'installing')
})

test('manual check is disabled in development builds', async () => {
  let checkCount = 0
  const service = createUpdateService({
    app: { isPackaged: false, getVersion: () => '1.4.5' },
    autoUpdater: {
      on: () => {},
      checkForUpdates: async () => { checkCount += 1 },
    },
    log: () => {},
    emit: () => {},
  })

  const status = await service.checkForUpdates({ manual: true })

  assert.equal(status.status, 'disabled')
  assert.equal(status.manualCheck, true)
  assert.equal(checkCount, 0)
})

test('manual check exposes available release and starts download on request', async () => {
  const updater = new EventEmitter()
  updater.autoDownload = true
  updater.checkForUpdates = async () => {
    updater.emit('update-available', {
      version: '1.4.6',
      releaseNotes: [{ note: '新增自动更新' }, { note: '优化设置页提示' }],
    })
  }
  let downloadCount = 0
  updater.downloadUpdate = async () => {
    downloadCount += 1
    updater.emit('download-progress', { percent: 42, transferred: 42, total: 100, bytesPerSecond: 1024 })
    updater.emit('update-downloaded', { version: '1.4.6', releaseNotes: '下载完成' })
  }
  updater.quitAndInstall = () => {}

  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '1.4.5' },
    autoUpdater: updater,
    log: () => {},
    emit: () => {},
  })

  await service.checkForUpdates({ manual: true })
  assert.equal(service.getStatus().status, 'available')
  assert.equal(service.getStatus().latestVersion, '1.4.6')
  assert.match(service.getStatus().releaseNotes, /新增自动更新/)

  await service.downloadUpdate()

  assert.equal(downloadCount, 1)
  assert.equal(service.getStatus().status, 'downloaded')
  assert.equal(service.getStatus().progress.percent, 100)
})
