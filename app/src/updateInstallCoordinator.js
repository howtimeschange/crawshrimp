'use strict'

function createUpdateInstallCoordinator({
  updateService,
  getReadiness,
  acquireDrain,
  releaseDrain,
  shutdownForUpdate,
  notifyReady,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  pollIntervalMs = 5000,
  log = () => {},
}) {
  if (!updateService) throw new Error('updateService is required')
  if (typeof getReadiness !== 'function') throw new Error('getReadiness is required')
  if (typeof acquireDrain !== 'function') throw new Error('acquireDrain is required')
  if (typeof releaseDrain !== 'function') throw new Error('releaseDrain is required')
  if (typeof shutdownForUpdate !== 'function') throw new Error('shutdownForUpdate is required')

  let unsubscribe = null
  let pollTimer = null
  let disposed = false
  let refreshing = null

  function start() {
    if (unsubscribe) return
    unsubscribe = updateService.subscribe(snapshot => {
      if (disposed || snapshot?.status !== 'downloaded') return
      void refreshReadiness()
    })
  }

  async function refreshReadiness() {
    if (disposed) return normalizeReadiness(updateService.getStatus?.())
    if (refreshing) return refreshing
    refreshing = doRefreshReadiness()
    try {
      return await refreshing
    } finally {
      refreshing = null
    }
  }

  async function doRefreshReadiness() {
    const previous = updateService.getStatus?.() || {}
    try {
      const readiness = normalizeReadiness(await getReadiness())
      updateService.setInstallReadiness(readiness)
      if (readiness.ready) {
        stopPolling()
        if (previous.status === 'waiting-for-tasks') notifyReady?.()
      } else {
        startPolling()
      }
      return readiness
    } catch (error) {
      stopPolling()
      updateService.setInstallReadiness({
        ready: false,
        blockers: [],
        error: readableError(error),
      })
      return { ready: false, blockers: [], error }
    }
  }

  async function requestInstall() {
    const readiness = await refreshReadiness()
    if (!readiness?.ready) return { ok: false, deferred: true }

    let drainToken = ''
    try {
      const drain = await acquireDrain()
      const drainReadiness = normalizeReadiness(drain?.readiness || { ready: drain?.ok !== false, blockers: [] })
      if (!drainReadiness.ready) {
        updateService.setInstallReadiness(drainReadiness)
        startPolling()
        return { ok: false, deferred: true }
      }
      drainToken = drain?.drain_token || drain?.drainToken || ''
    } catch (error) {
      if (isConflict(error)) {
        updateService.setInstallReadiness({
          ready: false,
          blockers: conflictBlockers(error),
          error: '',
        })
        startPolling()
        return { ok: false, deferred: true }
      }
      throw error
    }

    try {
      await shutdownForUpdate()
      updateService.setInstalling()
      updateService.quitAndInstall()
      return { ok: true }
    } catch (error) {
      await releaseDrainSafely(drainToken)
      updateService.setInstallReadiness({ ready: true, blockers: [] })
      throw error
    }
  }

  function dispose() {
    disposed = true
    stopPolling()
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  }

  function startPolling() {
    if (disposed || pollTimer) return
    pollTimer = setIntervalFn(() => {
      void refreshReadiness()
    }, pollIntervalMs)
  }

  function stopPolling() {
    if (!pollTimer) return
    clearIntervalFn(pollTimer)
    pollTimer = null
  }

  async function releaseDrainSafely(token) {
    if (!token) return
    try {
      await releaseDrain(token)
    } catch (releaseError) {
      log?.warn?.('Failed to release update drain token after install failure', releaseError)
    }
  }

  return {
    start,
    refreshReadiness,
    requestInstall,
    dispose,
  }
}

function normalizeReadiness(value = {}) {
  const blockers = Array.isArray(value.blockers)
    ? value.blockers.map(blocker => ({ ...blocker }))
    : []
  return {
    ready: value.ready === undefined ? blockers.length === 0 : Boolean(value.ready),
    blockers,
    ...(value.error ? { error: value.error } : {}),
  }
}

function isConflict(error) {
  return error?.status === 409 || error?.statusCode === 409 || error?.response?.status === 409
}

function conflictBlockers(error) {
  const blockers =
    error?.blockers ||
    error?.detail?.blockers ||
    error?.response?.data?.detail?.blockers ||
    error?.response?.data?.blockers ||
    []
  return Array.isArray(blockers) ? blockers.map(blocker => ({ ...blocker })) : []
}

function readableError(error) {
  if (!error) return 'Unknown readiness error'
  if (typeof error === 'string') return error
  return String(error.message || error)
}

module.exports = {
  createUpdateInstallCoordinator,
}
