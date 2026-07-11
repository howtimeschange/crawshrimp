'use strict'

const LATEST_RELEASE_URL = 'https://github.com/howtimeschange/crawshrimp/releases/latest'

function createUpdateService({
  app,
  autoUpdater,
  platformSupport,
  testFeedUrl = '',
  getAvailableBytes,
  log = console,
  emit,
}) {
  const support = platformSupport || { supported: false, reason: '当前环境不支持桌面更新。' }
  const subscribers = new Set()
  let disposed = false
  let requiredBytes = 0

  const state = {
    status: support.supported ? 'idle' : 'disabled',
    currentVersion: String(app?.getVersion?.() || ''),
    latestVersion: '',
    releaseNotes: '',
    progress: null,
    error: support.reason || '',
    blockers: [],
    lastCheckedAt: '',
    downloaded: false,
    manualDownloadUrl: LATEST_RELEASE_URL,
  }

  configureUpdater(autoUpdater, testFeedUrl, log)

  function snapshot() {
    return {
      ...state,
      progress: state.progress ? { ...state.progress } : null,
      blockers: state.blockers.map(blocker => ({ ...blocker })),
    }
  }

  function publish(patch = {}) {
    if (disposed) return
    Object.assign(state, patch)
    const next = snapshot()
    if (typeof emit === 'function') emit(next)
    for (const listener of subscribers) listener(next)
  }

  function rememberUpdateInfo(info = {}) {
    state.latestVersion = String(info.version || state.latestVersion || '')
    state.releaseNotes = normalizeReleaseNotes(info.releaseNotes || state.releaseNotes || '')
    requiredBytes = largestFileSize(info)
  }

  const handlers = {
    'checking-for-update': () => publish({ status: 'checking', error: '', progress: null }),
    'update-available': info => {
      rememberUpdateInfo(info)
      publish({
        status: 'available',
        latestVersion: state.latestVersion,
        releaseNotes: state.releaseNotes,
        progress: null,
        error: '',
        blockers: [],
        downloaded: false,
      })
    },
    'update-not-available': () => publish({
      status: 'up-to-date',
      error: '',
      progress: null,
      lastCheckedAt: new Date().toISOString(),
    }),
    'download-progress': progress => publish({
      status: 'downloading',
      progress: normalizeProgress(progress),
      error: '',
    }),
    'update-downloaded': info => {
      rememberUpdateInfo(info)
      publish({
        status: 'downloaded',
        latestVersion: state.latestVersion,
        releaseNotes: state.releaseNotes,
        progress: null,
        error: '',
        downloaded: true,
      })
    },
    error: error => publish({
      status: 'error',
      progress: null,
      error: readableError(error),
    }),
  }

  for (const [eventName, handler] of Object.entries(handlers)) {
    autoUpdater?.on?.(eventName, handler)
  }

  async function checkForUpdates() {
    ensureSupported()
    publish({ status: 'checking', error: '', progress: null })
    try {
      return await autoUpdater.checkForUpdates()
    } catch (error) {
      publish({ status: 'error', error: readableError(error), progress: null })
      throw error
    }
  }

  async function downloadUpdate() {
    if (state.status !== 'available' && !(state.status === 'error' && state.latestVersion)) {
      throw new Error('当前没有可下载的桌面更新。')
    }
    const freeBytes = typeof getAvailableBytes === 'function' ? await getAvailableBytes() : null
    if (requiredBytes > 0 && Number.isFinite(Number(freeBytes)) && Number(freeBytes) < requiredBytes) {
      const message = `磁盘空间不足：更新需要 ${formatBytes(requiredBytes)}，当前可用 ${formatBytes(Number(freeBytes))}。`
      publish({ status: 'error', error: message, progress: null })
      throw new Error(message)
    }
    publish({ status: 'downloading', error: '', progress: null })
    try {
      return await autoUpdater.downloadUpdate()
    } catch (error) {
      publish({ status: 'error', error: readableError(error), progress: null })
      throw error
    }
  }

  function setInstallReadiness({ ready, blockers = [], error = '' } = {}) {
    const normalizedBlockers = Array.isArray(blockers) ? blockers.map(blocker => ({ ...blocker })) : []
    if (error) {
      publish({ status: 'waiting-for-tasks', blockers: normalizedBlockers, error: String(error) })
      return
    }
    if (!state.downloaded) {
      publish({ blockers: normalizedBlockers, error: ready ? '' : state.error })
      return
    }
    publish({
      status: ready ? 'ready-to-install' : 'waiting-for-tasks',
      blockers: ready ? [] : normalizedBlockers,
      error: '',
    })
  }

  function setInstalling() {
    if (!state.downloaded || state.status !== 'ready-to-install') {
      throw new Error('尚未准备好安装桌面更新。')
    }
    publish({ status: 'installing', error: '', blockers: [] })
  }

  function quitAndInstall() {
    if (!state.downloaded || state.status !== 'installing') {
      throw new Error('尚未准备好安装桌面更新。')
    }
    return autoUpdater.quitAndInstall()
  }

  function subscribe(listener) {
    subscribers.add(listener)
    listener(snapshot())
    return () => subscribers.delete(listener)
  }

  function dispose() {
    disposed = true
    subscribers.clear()
    for (const [eventName, handler] of Object.entries(handlers)) {
      autoUpdater?.removeListener?.(eventName, handler)
    }
  }

  function ensureSupported() {
    if (support.supported) return
    throw new Error(support.reason || '当前环境不支持桌面更新。')
  }

  return {
    getStatus: snapshot,
    subscribe,
    checkForUpdates,
    downloadUpdate,
    setInstallReadiness,
    setInstalling,
    quitAndInstall,
    dispose,
  }
}

function configureUpdater(autoUpdater, testFeedUrl, log) {
  if (!autoUpdater) throw new Error('autoUpdater is required')
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  const feedUrl = String(testFeedUrl || '').trim()
  if (feedUrl) {
    try {
      autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
    } catch (error) {
      log?.warn?.('Failed to configure desktop update test feed', error)
      throw error
    }
  }
}

function normalizeReleaseNotes(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item?.note || item || '')).filter(Boolean).join('\n')
  }
  return String(value || '')
}

function normalizeProgress(progress = {}) {
  return {
    percent: roundPercent(progress.percent),
    transferred: normalizeNumber(progress.transferred),
    total: normalizeNumber(progress.total),
    bytesPerSecond: normalizeNumber(progress.bytesPerSecond),
  }
}

function roundPercent(value) {
  const numeric = normalizeNumber(value)
  return Math.max(0, Math.min(100, Math.round(numeric * 100) / 100))
}

function normalizeNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0
}

function largestFileSize(info = {}) {
  const files = Array.isArray(info.files) ? info.files : []
  return files.reduce((largest, file) => {
    const size = Number(file?.size)
    return Number.isFinite(size) && size > largest ? size : largest
  }, 0)
}

function readableError(error) {
  return String(error?.message || error || '桌面更新失败。')
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0)
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let amount = bytes / 1024
  let index = 0
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024
    index += 1
  }
  return `${Math.round(amount * 10) / 10} ${units[index]}`
}

module.exports = { createUpdateService }
