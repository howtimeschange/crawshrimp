'use strict'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describeError(error) {
  if (!error) return 'unknown error'
  return error.message || String(error)
}

function describeProcessExit(proc, code) {
  const base = `Backend process exited before ready (code=${code})`
  if (!proc || typeof proc.getStartupOutput !== 'function') return base
  const output = String(proc.getStartupOutput() || '').trim()
  if (!output) return base
  const tail = output.split('\n').map(line => line.trim()).filter(Boolean).slice(-8).join(' | ')
  return tail ? `${base}: ${tail}` : base
}

function describeProcessStartup(proc) {
  if (!proc || typeof proc.getStartupOutput !== 'function') return ''
  const output = String(proc.getStartupOutput() || '').trim()
  if (!output) return ''
  return output.split('\n').map(line => line.trim()).filter(Boolean).slice(-8).join(' | ')
}

function createBackendController(options) {
  const probeReady = options.probeReady
  const startProcess = options.startProcess
  const log = options.log || (() => {})
  const sendStatus = options.sendStatus || (() => {})
  const validateReady = options.validateReady || (async () => true)
  const switchEndpoint = options.switchEndpoint || (async () => false)
  const intervalMs = Math.max(1, Number(options.intervalMs || 500))
  const attempts = Math.max(1, Number(options.attempts || 20))
  const launchRetries = Math.max(0, Number(options.launchRetries || 0))
  const retryDelayMs = Math.max(1, Number(options.retryDelayMs || intervalMs))
  const restartProbeFailures = Math.max(1, Number(options.restartProbeFailures || 3))
  const stopProcess = options.stopProcess || (() => {})

  let backendProcess = null
  let startupPromise = null
  let startupFailure = null
  let ready = false
  let currentProcessWasReady = false
  let state = 'starting'
  let consecutiveProbeFailures = 0

  function setState(nextState) {
    const normalized = String(nextState || '').trim() || 'failed'
    if (state === normalized) return
    state = normalized
    sendStatus('apiState', state)
  }

  function markNotReady(nextState = 'degraded') {
    ready = false
    sendStatus('api', false)
    setState(nextState)
  }

  function rememberProcess(proc) {
    backendProcess = proc
    currentProcessWasReady = false

    proc.once('error', (error) => {
      startupFailure = error
      log(`[api] process error: ${describeError(error)}`)
      if (backendProcess === proc) backendProcess = null
      currentProcessWasReady = false
      markNotReady('failed')
    })

    proc.once('exit', (code) => {
      if (!ready) {
        startupFailure = new Error(describeProcessExit(proc, code))
      }
      if (backendProcess === proc) backendProcess = null
      currentProcessWasReady = false
      markNotReady(ready ? 'degraded' : 'failed')
    })
  }

  async function ensureReady() {
    async function acceptReadyBackend() {
      ready = true
      if (backendProcess) currentProcessWasReady = true
      startupFailure = null
      consecutiveProbeFailures = 0
      sendStatus('api', true)
      setState('ready')
    }

    if (await probeReady()) {
      if (await validateReady()) {
        await acceptReadyBackend()
        return
      }
      markNotReady('restarting')
      await switchEndpoint()
    }

    if (startupPromise) return startupPromise

    startupPromise = (async () => {
      for (let launchAttempt = 0; launchAttempt <= launchRetries; launchAttempt += 1) {
        const hadReadyBackend = currentProcessWasReady && Boolean(backendProcess)
        let endpointSwitched = false
        startupFailure = null
        if (!backendProcess) {
          setState(launchAttempt > 0 ? 'restarting' : 'starting')
          try {
            const proc = await startProcess()
            if (proc) rememberProcess(proc)
          } catch (error) {
            startupFailure = error
          }
        }

        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (await probeReady()) {
            if (await validateReady()) {
              await acceptReadyBackend()
              return
            }
            markNotReady('restarting')
            if (backendProcess) {
              const proc = backendProcess
              backendProcess = null
              currentProcessWasReady = false
              stopProcess(proc)
            }
            await switchEndpoint()
            endpointSwitched = true
            break
          }
          if (startupFailure) break
          await sleep(intervalMs)
        }

        if (endpointSwitched) {
          startupFailure = null
          continue
        }

        if (!startupFailure) {
          const tail = describeProcessStartup(backendProcess)
          startupFailure = new Error(tail ? `API server startup timeout: ${tail}` : 'API server startup timeout')
        }

        if (hadReadyBackend) {
          consecutiveProbeFailures += 1
          if (consecutiveProbeFailures < restartProbeFailures) {
            markNotReady('degraded')
            throw startupFailure
          }
          log(`[api] ready backend missed ${consecutiveProbeFailures} consecutive probes; restarting`)
          markNotReady('restarting')
        }

        if (backendProcess) {
          const proc = backendProcess
          backendProcess = null
          currentProcessWasReady = false
          stopProcess(proc)
          markNotReady(hadReadyBackend ? 'restarting' : 'failed')
        }

        if (launchAttempt >= launchRetries) {
          setState('failed')
          throw startupFailure
        }

        log(`[api] startup failed: ${describeError(startupFailure)}; retrying backend launch ${launchAttempt + 1}/${launchRetries}`)
        startupFailure = null
        setState('restarting')
        await sleep(retryDelayMs)
      }

      setState('failed')
      throw new Error('API server startup failed')
    })()

    try {
      await startupPromise
    } finally {
      startupPromise = null
    }
  }

  async function runWhenReady(operation, options = {}) {
    const retries = Math.max(0, Number(options.retries || 0))
    const retryDelayMs = Math.max(0, Number(options.retryDelayMs || 0))
    const retryableCodes = options.retryableCodes || new Set()
    const describeFailure = typeof options.describeFailure === 'function'
      ? options.describeFailure
      : null

    let lastError = null
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      await ensureReady()
      try {
        return await operation()
      } catch (error) {
        lastError = error
        const isRetryable = retryableCodes.has(error?.code)
        if (!isRetryable || attempt === retries) {
          if (isRetryable && describeFailure) {
            throw describeFailure(error)
          }
          throw error
        }
        markNotReady()
        if (retryDelayMs > 0) {
          await sleep(retryDelayMs)
        }
      }
    }
    throw lastError
  }

  function stop() {
    if (!backendProcess) return
    const proc = backendProcess
    backendProcess = null
    startupPromise = null
    startupFailure = null
    ready = false
    currentProcessWasReady = false
    consecutiveProbeFailures = 0
    stopProcess(proc)
    sendStatus('api', false)
    setState('failed')
  }

  return {
    ensureReady,
    runWhenReady,
    stop,
    getState: () => state,
  }
}

module.exports = {
  createBackendController,
}
