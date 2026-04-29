'use strict'

function normalizeReleaseNotes(notes) {
  if (Array.isArray(notes)) {
    return notes
      .map(item => {
        if (typeof item === 'string') return item
        return String(item?.note || item?.text || '').trim()
      })
      .filter(Boolean)
      .join('\n')
  }
  return String(notes || '').trim()
}

function createUpdateService({
  app,
  autoUpdater,
  log = () => {},
  emit = () => {},
  downloadOnUpdateAvailable = false,
} = {}) {
  const state = {
    status: 'idle',
    currentVersion: app?.getVersion ? app.getVersion() : '',
    latestVersion: '',
    releaseNotes: '',
    error: '',
    progress: null,
    updateAvailable: false,
    downloaded: false,
    installDeferred: false,
    activeTaskCount: 0,
    lastCheckedAt: '',
    manualCheck: false,
  }

  function snapshot(extra = {}) {
    return { ...state, ...extra }
  }

  function publish(next = {}) {
    Object.assign(state, next)
    const event = snapshot()
    emit(event)
    return event
  }

  function wireUpdaterEvents() {
    if (!autoUpdater?.on) return

    autoUpdater.on('checking-for-update', () => {
      publish({ status: 'checking', error: '', progress: null })
    })

    autoUpdater.on('update-available', info => {
      publish({
        status: 'available',
        latestVersion: String(info?.version || ''),
        releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
        updateAvailable: true,
        downloaded: false,
        error: '',
      })
      if (downloadOnUpdateAvailable) autoUpdater.downloadUpdate()
    })

    autoUpdater.on('update-not-available', info => {
      publish({
        status: 'not-available',
        latestVersion: String(info?.version || state.currentVersion || ''),
        updateAvailable: false,
        downloaded: false,
        installDeferred: false,
        error: '',
        lastCheckedAt: new Date().toISOString(),
      })
    })

    autoUpdater.on('download-progress', progress => {
      publish({
        status: 'downloading',
        progress: {
          percent: Number(progress?.percent || 0),
          transferred: Number(progress?.transferred || 0),
          total: Number(progress?.total || 0),
          bytesPerSecond: Number(progress?.bytesPerSecond || 0),
        },
        error: '',
      })
    })

    autoUpdater.on('update-downloaded', info => {
      publish({
        status: 'downloaded',
        latestVersion: String(info?.version || state.latestVersion || ''),
        releaseNotes: normalizeReleaseNotes(info?.releaseNotes) || state.releaseNotes,
        updateAvailable: true,
        downloaded: true,
        progress: { percent: 100 },
        error: '',
      })
    })

    autoUpdater.on('error', error => {
      publish({
        status: 'error',
        error: error?.message || String(error),
      })
    })
  }

  wireUpdaterEvents()

  if (autoUpdater) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
  }

  return {
    getStatus() {
      return snapshot()
    },

    setActiveTaskCount(count) {
      const activeTaskCount = Math.max(0, Number(count) || 0)
      publish({ activeTaskCount })
      if (activeTaskCount === 0 && state.installDeferred && state.downloaded) {
        this.installDownloadedUpdate()
      }
      return snapshot()
    },

    async checkForUpdates({ manual = false } = {}) {
      if (!app?.isPackaged) {
        return publish({
          status: 'disabled',
          error: '开发模式不会检查自动更新。',
          manualCheck: manual,
        })
      }

      state.manualCheck = manual
      try {
        publish({ status: 'checking', error: '', progress: null, manualCheck: manual })
        const result = await autoUpdater.checkForUpdates()
        return snapshot({ result })
      } catch (error) {
        log(`[update] check failed: ${error?.message || String(error)}`)
        return publish({ status: 'error', error: error?.message || String(error) })
      }
    },

    async downloadUpdate() {
      if (!state.updateAvailable) {
        return publish({ status: 'not-available', error: '当前没有可下载的更新。' })
      }
      try {
        publish({ status: 'downloading', error: '' })
        await autoUpdater.downloadUpdate()
        return snapshot()
      } catch (error) {
        log(`[update] download failed: ${error?.message || String(error)}`)
        return publish({ status: 'error', error: error?.message || String(error) })
      }
    },

    installDownloadedUpdate() {
      if (!state.downloaded) {
        return { ok: false, error: '更新尚未下载完成。' }
      }
      if (state.activeTaskCount > 0) {
        publish({ installDeferred: true })
        return { ok: false, deferred: true }
      }
      publish({ status: 'installing', installDeferred: false })
      autoUpdater.quitAndInstall(false, true)
      return { ok: true }
    },
  }
}

module.exports = {
  createUpdateService,
  normalizeReleaseNotes,
}
