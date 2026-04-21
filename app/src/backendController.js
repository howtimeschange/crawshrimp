'use strict'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describeError(error) {
  if (!error) return 'unknown error'
  return error.message || String(error)
}

function createBackendController(options) {
  const probeReady = options.probeReady
  const startProcess = options.startProcess
  const log = options.log || (() => {})
  const sendStatus = options.sendStatus || (() => {})
  const intervalMs = Math.max(1, Number(options.intervalMs || 500))
  const attempts = Math.max(1, Number(options.attempts || 20))
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
        startupFailure = new Error(`Backend process exited before ready (code=${code})`)
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
      startupFailure = null
      if (!backendProcess) {
        const proc = await startProcess()
        if (proc) rememberProcess(proc)
      }

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (await probeReady()) {
          ready = true
          startupFailure = null
          sendStatus('api', true)
          return
        }
        if (startupFailure) {
          throw startupFailure
        }
        await sleep(intervalMs)
      }

      if (startupFailure) {
        throw startupFailure
      }

      throw new Error('API server startup timeout')
    })()

    try {
      await startupPromise
    } finally {
      startupPromise = null
    }
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
    stop,
  }
}

module.exports = {
  createBackendController,
}
