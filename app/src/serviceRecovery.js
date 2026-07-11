'use strict'

function createSingleFlightRecovery(run) {
  if (typeof run !== 'function') throw new TypeError('run is required')
  let inFlight = null

  return (...args) => {
    if (inFlight) return inFlight
    inFlight = Promise.resolve()
      .then(() => run(...args))
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }
}

function isOwnedBackendRuntime(runtime = {}, options = {}) {
  const samePath = options.samePath
  if (!runtime || typeof runtime !== 'object') return false
  if (typeof samePath !== 'function') return false
  if (String(runtime.backend_instance_id || '') !== String(options.instanceId || '')) return false
  if (runtime.owns_backend_instance !== true) return false
  return samePath(String(runtime.scripts_dir || ''), String(options.scriptsDir || ''))
}

function classifyBackendHealth(health = {}, isCompatible = () => false) {
  const reachable = health?.ok === true
  const compatible = reachable && typeof isCompatible === 'function'
    ? Boolean(isCompatible(health.data?.runtime))
    : false
  return { reachable, compatible }
}

module.exports = { createSingleFlightRecovery, isOwnedBackendRuntime, classifyBackendHealth }
