'use strict'

function createLifecycleController(options = {}) {
  const platform = options.platform || process.platform
  const getActiveTasks = options.getActiveTasks || (async () => ({ active: false, tasks: [] }))
  const confirmQuitWithActiveTasks = options.confirmQuitWithActiveTasks || (async () => true)
  const requestStopActiveTasks = options.requestStopActiveTasks || (async () => {})
  const waitForNoActiveTasks = options.waitForNoActiveTasks || (async () => {})
  const stopBackend = options.stopBackend || (() => {})
  const stopManagedChrome = options.stopManagedChrome || (() => {})
  const quitApp = options.quitApp || (() => {})
  const onQuitCanceled = options.onQuitCanceled || (async () => {})
  const log = options.log || (() => {})

  let shutdownInProgress = false
  let confirmedQuit = false
  let updateInstallShutdownPrepared = false

  function handleWindowAllClosed() {
    if (platform === 'darwin') return
    quitApp()
  }

  async function handleBeforeQuit(event = null) {
    if (confirmedQuit) return true
    if (shutdownInProgress) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault()
      return false
    }

    if (event && typeof event.preventDefault === 'function') event.preventDefault()
    shutdownInProgress = true

    try {
      let active
      try {
        active = await getActiveTasks()
      } catch (error) {
        active = {
          active: 'unknown',
          unknown: true,
          reason: 'query-failed',
          error: error?.message || String(error),
          tasks: [],
        }
      }

      const tasks = Array.isArray(active?.tasks) ? active.tasks : []
      if (isUnknownActiveState(active)) {
        const shouldQuit = await confirmQuitWithActiveTasks(tasks, active)
        if (!shouldQuit) {
          shutdownInProgress = false
          await onQuitCanceled()
          return false
        }
      } else if (active?.active && tasks.length > 0) {
        const shouldQuit = await confirmQuitWithActiveTasks(tasks, { reason: 'active' })
        if (!shouldQuit) {
          shutdownInProgress = false
          await onQuitCanceled()
          return false
        }
        await requestStopActiveTasks(tasks)
        const drained = await waitForNoActiveTasks()
        if (isUnknownActiveState(drained) || drained === false) {
          const drainState = normalizeDrainFailure(drained)
          const shouldForceQuit = await confirmQuitWithActiveTasks(tasks, drainState)
          if (!shouldForceQuit) {
            shutdownInProgress = false
            await onQuitCanceled()
            return false
          }
        }
      }

      await stopBackend()
      await stopManagedChrome()
      confirmedQuit = true
      quitApp()
      return true
    } catch (error) {
      log(`[lifecycle] graceful shutdown failed: ${error?.message || String(error)}`)
      try { await stopBackend() } catch (_) {}
      try { await stopManagedChrome() } catch (_) {}
      confirmedQuit = true
      quitApp()
      return true
    }
  }

  async function prepareForUpdateInstall() {
    if (confirmedQuit) return true
    if (shutdownInProgress) return false

    shutdownInProgress = true
    try {
      validateManagedChromeStopped(await stopManagedChrome())
      await stopBackend()
      confirmedQuit = true
      updateInstallShutdownPrepared = true
      return true
    } catch (error) {
      shutdownInProgress = false
      throw error
    }
  }

  function recoverFromUpdateInstallFailure() {
    if (!updateInstallShutdownPrepared) return false
    shutdownInProgress = false
    confirmedQuit = false
    updateInstallShutdownPrepared = false
    return true
  }

  return {
    handleBeforeQuit,
    handleWindowAllClosed,
    prepareForUpdateInstall,
    recoverFromUpdateInstallFailure,
  }
}

function isUnknownActiveState(active) {
  if (!active || typeof active !== 'object') return false
  return active.unknown === true || active.active === 'unknown'
}

function normalizeDrainFailure(result) {
  if (isUnknownActiveState(result)) return result
  return {
    active: 'unknown',
    unknown: true,
    reason: 'drain-unknown',
    tasks: [],
  }
}

function validateManagedChromeStopped(result) {
  if (!result || result.stopped !== false) return
  if (result.reason !== 'kill-failed' && result.reason !== 'exit-timeout') return
  throw new Error(`Managed Chrome cleanup failed: ${result.reason}`)
}

module.exports = {
  createLifecycleController,
}
