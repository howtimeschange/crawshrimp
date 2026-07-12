'use strict'

const INITIAL_DELAY_MS = 15_000
const PERIODIC_INTERVAL_MS = 6 * 60 * 60 * 1000
const FAILURE_RETRY_DELAY_MS = 5 * 60 * 1000
const FOCUS_COOLDOWN_MS = 5 * 60 * 1000

function createUpdateCheckScheduler({
  updateService,
  supported,
  notifyAvailable = () => {},
  log = console,
  now = () => Date.now(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  initialDelayMs = INITIAL_DELAY_MS,
  intervalMs = PERIODIC_INTERVAL_MS,
  retryDelayMs = FAILURE_RETRY_DELAY_MS,
  focusCooldownMs = FOCUS_COOLDOWN_MS,
} = {}) {
  let timer = null
  let started = false
  let disposed = false
  let checking = false
  let lastAttemptAt = 0
  let lastNotifiedVersion = ''

  function schedule(delayMs) {
    if (disposed || supported !== true) return
    if (timer) clearTimeoutFn(timer)
    timer = setTimeoutFn(runAutomaticCheck, Math.max(0, Number(delayMs) || 0))
  }

  function start() {
    if (started || disposed || supported !== true) return
    started = true
    schedule(initialDelayMs)
  }

  function onAppFocus() {
    if (!started || disposed || checking || !lastAttemptAt) return
    if (Number(now()) - lastAttemptAt < focusCooldownMs) return
    schedule(0)
  }

  async function runAutomaticCheck() {
    timer = null
    if (disposed || supported !== true || checking) return
    checking = true
    lastAttemptAt = Number(now()) || Date.now()
    try {
      await updateService.checkForUpdates({ manual: false })
      if (disposed) return
      const status = updateService.getStatus()
      const version = String(status?.latestVersion || 'available')
      if (status?.status === 'available' && version !== lastNotifiedVersion) {
        lastNotifiedVersion = version
        notifyAvailable(status)
      }
      schedule(intervalMs)
    } catch (error) {
      if (!disposed) {
        log?.warn?.('Automatic desktop update check failed', error)
        schedule(retryDelayMs)
      }
    } finally {
      checking = false
    }
  }

  function dispose() {
    disposed = true
    if (timer) clearTimeoutFn(timer)
    timer = null
  }

  return { start, onAppFocus, dispose }
}

module.exports = { createUpdateCheckScheduler }
