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
    if (disposed) return invalidReadiness('Coordinator is disposed')
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
      const readiness = normalizeReadiness(await getReadiness(), 'readiness')
      if (disposed) return invalidReadiness('Coordinator is disposed')
      updateService.setInstallReadiness(readiness)
      if (readiness.ready) {
        stopPolling()
        if (previous.status === 'waiting-for-tasks') notifyReady?.()
      } else if (readiness.error) {
        stopPolling()
      } else {
        startPolling()
      }
      return readiness
    } catch (error) {
      if (disposed) return invalidReadiness('Coordinator is disposed')
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
      const drainReadiness = normalizeDrainResponse(drain)
      if (disposed) {
        if (drainReadiness.valid) await releaseDrainSafely(drainReadiness.drainToken)
        return { ok: false, deferred: true }
      }
      if (!drainReadiness.valid) {
        await releaseDrainSafely(drainReadiness.drainToken)
        updateService.setInstallReadiness({
          ready: false,
          blockers: drainReadiness.blockers,
          error: drainReadiness.error,
        })
        return { ok: false, deferred: true }
      }
      drainToken = drainReadiness.drainToken
    } catch (error) {
      if (disposed) return { ok: false, deferred: true }
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
      const shutdownReady = await shutdownForUpdate()
      if (shutdownReady !== true) {
        await releaseDrainSafely(drainToken)
        updateService.setInstallReadiness({ ready: true, blockers: [] })
        return { ok: false, deferred: true }
      }
      if (disposed) {
        await releaseDrainSafely(drainToken)
        return { ok: false, deferred: true }
      }
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

function normalizeReadiness(value, source = 'readiness') {
  if (!isPlainObject(value) || typeof value.ready !== 'boolean') {
    return invalidReadiness(`Invalid ${source} response: explicit ready boolean is required.`)
  }
  const blockers = Array.isArray(value.blockers)
    ? value.blockers.map(blocker => ({ ...blocker }))
    : []
  const error = String(value.error || '').trim()
  const safe = value.ready === true && blockers.length === 0 && !error
  if (safe) {
    return {
      ready: true,
      blockers: [],
    }
  }
  const unsafeError = value.ready === true
    ? error || `Invalid ${source} response: ready true conflicts with blockers.`
    : error
  return {
    ready: false,
    blockers,
    ...(unsafeError ? { error: unsafeError } : {}),
  }
}

function normalizeDrainResponse(value) {
  if (!isPlainObject(value) || value.ok !== true) {
    return invalidDrain('Invalid drain response: ok true is required.')
  }
  const drainToken = String(value.drain_token || value.drainToken || '').trim()
  if (!drainToken) {
    return invalidDrain('Invalid drain response: non-empty drain token is required.')
  }
  const readiness = normalizeReadiness(value.readiness, 'drain readiness')
  if (!readiness.ready) {
    return {
      valid: false,
      drainToken,
      blockers: readiness.blockers,
      error: readiness.error || 'Invalid drain response: readiness.ready true is required.',
    }
  }
  return {
    valid: true,
    drainToken,
  }
}

function invalidReadiness(error) {
  return {
    ready: false,
    blockers: [],
    error,
  }
}

function invalidDrain(error) {
  return {
    valid: false,
    blockers: [],
    error,
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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
