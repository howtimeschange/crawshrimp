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
  let lastError = ''
  let launchAttempt = 0
  let generation = 0

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

  function rememberFailure(error) {
    startupFailure = error
    lastError = describeError(error)
  }

  function assertActiveGeneration(expectedGeneration) {
    if (generation !== expectedGeneration) throw new Error('Backend startup canceled')
  }

  function rememberProcess(proc) {
    backendProcess = proc
    currentProcessWasReady = false

    proc.once('error', (error) => {
      if (backendProcess !== proc) return
      rememberFailure(error)
      log(`[api] process error: ${describeError(error)}`)
      backendProcess = null
      currentProcessWasReady = false
      markNotReady('failed')
    })

    proc.once('exit', (code) => {
      if (backendProcess !== proc) return
      if (!ready) {
        rememberFailure(new Error(describeProcessExit(proc, code)))
      }
      backendProcess = null
      currentProcessWasReady = false
      markNotReady(ready ? 'degraded' : 'failed')
    })
  }

  async function ensureReady() {
    const ensureGeneration = generation

    async function acceptReadyBackend(expectedGeneration) {
      assertActiveGeneration(expectedGeneration)
      ready = true
      if (backendProcess) currentProcessWasReady = true
      startupFailure = null
      lastError = ''
      consecutiveProbeFailures = 0
      sendStatus('api', true)
      setState('ready')
    }

    const initiallyReady = await probeReady()
    assertActiveGeneration(ensureGeneration)
    if (initiallyReady) {
      const runtimeValid = await validateReady()
      assertActiveGeneration(ensureGeneration)
      if (runtimeValid) {
        await acceptReadyBackend(ensureGeneration)
        return
      }
      markNotReady('restarting')
      await switchEndpoint()
      assertActiveGeneration(ensureGeneration)
    }

    assertActiveGeneration(ensureGeneration)
    if (startupPromise) return startupPromise

    const startupGeneration = generation
    const activeStartup = (async () => {
      for (let launchIndex = 0; launchIndex <= launchRetries; launchIndex += 1) {
        assertActiveGeneration(startupGeneration)
        const attemptNumber = launchIndex + 1
        // Expose a one-based attempt count without leaking the loop variable.
        // This is reset after an explicit stop/recovery.
        setLaunchAttempt(attemptNumber)
        const hadReadyBackend = currentProcessWasReady && Boolean(backendProcess)
        let endpointSwitched = false
        startupFailure = null
        if (!backendProcess) {
          setState(launchIndex > 0 ? 'restarting' : 'starting')
          try {
            const proc = await startProcess()
            if (generation !== startupGeneration) {
              if (proc) stopProcess(proc)
              assertActiveGeneration(startupGeneration)
            }
            if (proc) rememberProcess(proc)
          } catch (error) {
            assertActiveGeneration(startupGeneration)
            rememberFailure(error)
          }
        }

        for (let attempt = 0; attempt < attempts; attempt += 1) {
          assertActiveGeneration(startupGeneration)
          const probeIsReady = await probeReady()
          assertActiveGeneration(startupGeneration)
          if (probeIsReady) {
            const runtimeValid = await validateReady()
            assertActiveGeneration(startupGeneration)
            if (runtimeValid) {
              await acceptReadyBackend(startupGeneration)
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
            assertActiveGeneration(startupGeneration)
            endpointSwitched = true
            break
          }
          if (startupFailure) break
          await sleep(intervalMs)
          assertActiveGeneration(startupGeneration)
        }

        if (endpointSwitched) {
          startupFailure = null
          continue
        }

        if (!startupFailure) {
          const tail = describeProcessStartup(backendProcess)
          rememberFailure(new Error(tail ? `API server startup timeout: ${tail}` : 'API server startup timeout'))
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

        if (launchIndex >= launchRetries) {
          setState('failed')
          throw startupFailure
        }

        log(`[api] startup failed: ${describeError(startupFailure)}; retrying backend launch ${launchIndex + 1}/${launchRetries}`)
        startupFailure = null
        setState('restarting')
        await sleep(retryDelayMs)
      }

      setState('failed')
      const error = new Error(lastError || 'API server startup failed')
      rememberFailure(error)
      throw error
    })()
    startupPromise = activeStartup

    try {
      await activeStartup
    } finally {
      if (startupPromise === activeStartup) startupPromise = null
    }
  }

  function setLaunchAttempt(value) {
    launchAttempt = Math.max(0, Number(value || 0))
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
    generation += 1
    const proc = backendProcess
    backendProcess = null
    startupPromise = null
    startupFailure = null
    lastError = ''
    launchAttempt = 0
    ready = false
    currentProcessWasReady = false
    consecutiveProbeFailures = 0
    if (proc) stopProcess(proc)
    sendStatus('api', false)
    setState('stopped')
  }

  return {
    ensureReady,
    runWhenReady,
    stop,
    getState: () => state,
    getDiagnostics: () => ({ state, lastError, launchAttempt }),
  }
}

module.exports = {
  createBackendController,
}
