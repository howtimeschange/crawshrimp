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
      const active = await getActiveTasks()
      const tasks = Array.isArray(active?.tasks) ? active.tasks : []
      if (active?.active && tasks.length > 0) {
        const shouldQuit = await confirmQuitWithActiveTasks(tasks)
        if (!shouldQuit) {
          shutdownInProgress = false
          await onQuitCanceled()
          return false
        }
        await requestStopActiveTasks(tasks)
        await waitForNoActiveTasks()
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
      await stopBackend()
      validateManagedChromeStopped(await stopManagedChrome())
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

function validateManagedChromeStopped(result) {
  if (!result || result.stopped !== false) return
  if (result.reason !== 'kill-failed' && result.reason !== 'exit-timeout') return
  throw new Error(`Managed Chrome cleanup failed: ${result.reason}`)
}

module.exports = {
  createLifecycleController,
}
