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
  const intervalMs = Math.max(1, Number(options.intervalMs || 500))
  const attempts = Math.max(1, Number(options.attempts || 20))
  const launchRetries = Math.max(0, Number(options.launchRetries || 0))
  const retryDelayMs = Math.max(1, Number(options.retryDelayMs || intervalMs))
  const stopProcess = options.stopProcess || (() => {})

  let backendProcess = null
  let startupPromise = null
  let startupFailure = null
  let ready = false

  function markNotReady() {
    ready = false
    sendStatus('api', false)
  }

  function rememberProcess(proc) {
    backendProcess = proc

    proc.once('error', (error) => {
      startupFailure = error
      log(`[api] process error: ${describeError(error)}`)
      if (backendProcess === proc) backendProcess = null
      markNotReady()
    })

    proc.once('exit', (code) => {
      if (!ready) {
        startupFailure = new Error(describeProcessExit(proc, code))
      }
      if (backendProcess === proc) backendProcess = null
      markNotReady()
    })
  }

  async function ensureReady() {
    if (await probeReady()) {
      ready = true
      startupFailure = null
      sendStatus('api', true)
      return
    }

    if (startupPromise) return startupPromise

    startupPromise = (async () => {
      for (let launchAttempt = 0; launchAttempt <= launchRetries; launchAttempt += 1) {
        startupFailure = null
        if (!backendProcess) {
          try {
            const proc = await startProcess()
            if (proc) rememberProcess(proc)
          } catch (error) {
            startupFailure = error
          }
        }

        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (await probeReady()) {
            ready = true
            startupFailure = null
            sendStatus('api', true)
            return
          }
          if (startupFailure) break
          await sleep(intervalMs)
        }

        if (!startupFailure) {
          const tail = describeProcessStartup(backendProcess)
          startupFailure = new Error(tail ? `API server startup timeout: ${tail}` : 'API server startup timeout')
        }

        if (backendProcess) {
          const proc = backendProcess
          backendProcess = null
          stopProcess(proc)
          markNotReady()
        }

        if (launchAttempt >= launchRetries) {
          throw startupFailure
        }

        log(`[api] startup failed: ${describeError(startupFailure)}; retrying backend launch ${launchAttempt + 1}/${launchRetries}`)
        startupFailure = null
        await sleep(retryDelayMs)
      }

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
    stopProcess(proc)
    sendStatus('api', false)
  }

  return {
    ensureReady,
    runWhenReady,
    stop,
  }
}

module.exports = {
  createBackendController,
}
