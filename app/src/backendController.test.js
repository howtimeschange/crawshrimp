const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const { createBackendController } = require('./backendController')

test('ensureReady reuses the same in-flight startup', async () => {
  let probeCount = 0
  let startCount = 0

  const controller = createBackendController({
    log: () => {},
    sendStatus: () => {},
    probeReady: async () => {
      probeCount += 1
      return probeCount >= 3
    },
    startProcess: () => {
      startCount += 1
      return new EventEmitter()
    },
    intervalMs: 1,
    attempts: 5,
  })

  await Promise.all([controller.ensureReady(), controller.ensureReady(), controller.ensureReady()])

  assert.equal(startCount, 1)
})

test('ensureReady rejects with the launch error before ready', async () => {
  const controller = createBackendController({
    log: () => {},
    sendStatus: () => {},
    probeReady: async () => false,
    startProcess: () => {
      const proc = new EventEmitter()
      setTimeout(() => {
        const err = new Error('spawn /tmp/python EPERM')
        err.code = 'EPERM'
        proc.emit('error', err)
      }, 0)
      return proc
    },
    intervalMs: 1,
    attempts: 5,
  })

  await assert.rejects(
    controller.ensureReady(),
    /spawn \/tmp\/python EPERM/
  )
})

test('ensureReady rejects when the process exits before becoming ready', async () => {
  const controller = createBackendController({
    log: () => {},
    sendStatus: () => {},
    probeReady: async () => false,
    startProcess: () => {
      const proc = new EventEmitter()
      setTimeout(() => proc.emit('exit', 23), 0)
      return proc
    },
    intervalMs: 1,
    attempts: 5,
  })

  await assert.rejects(
    controller.ensureReady(),
    /process exited before ready \(code=23\)/
  )

  assert.deepEqual(controller.getDiagnostics(), {
    state: 'failed',
    lastError: 'Backend process exited before ready (code=23)',
    launchAttempt: 1,
  })
})

test('stop clears a failed startup even after the child process already exited', async () => {
  const statuses = []
  const controller = createBackendController({
    log: () => {},
    sendStatus: (key, value) => statuses.push([key, value]),
    probeReady: async () => false,
    startProcess: () => {
      const proc = new EventEmitter()
      setTimeout(() => proc.emit('exit', 9), 0)
      return proc
    },
    intervalMs: 1,
    attempts: 5,
  })

  await assert.rejects(controller.ensureReady(), /code=9/)
  controller.stop()

  assert.deepEqual(controller.getDiagnostics(), {
    state: 'stopped',
    lastError: '',
    launchAttempt: 0,
  })
  assert.ok(statuses.some(([key, value]) => key === 'apiState' && value === 'stopped'))
})

test('stop cancels an in-flight startup without letting the stale attempt become ready', async () => {
  let probeReady = false
  let starts = 0
  const controller = createBackendController({
    log: () => {},
    sendStatus: () => {},
    probeReady: async () => probeReady,
    startProcess: () => {
      starts += 1
      return new EventEmitter()
    },
    intervalMs: 5,
    attempts: 10,
  })

  const startup = controller.ensureReady()
  await new Promise(resolve => setTimeout(resolve, 1))
  controller.stop()
  probeReady = true

  await assert.rejects(startup, /startup canceled/)
  assert.equal(controller.getState(), 'stopped')
  assert.equal(starts, 1)
})

test('stop ignores a delayed exit from the child it no longer owns', async () => {
  const proc = new EventEmitter()
  const controller = createBackendController({
    log: () => {},
    sendStatus: () => {},
    probeReady: async () => false,
    startProcess: () => proc,
    stopProcess: () => {},
    intervalMs: 5,
    attempts: 10,
  })

  const startup = controller.ensureReady()
  await new Promise(resolve => setTimeout(resolve, 1))
  controller.stop()
  proc.emit('exit', 0)

  await assert.rejects(startup, /startup canceled/)
  assert.deepEqual(controller.getDiagnostics(), {
    state: 'stopped',
    lastError: '',
    launchAttempt: 0,
  })
})

test('stop cancels startup while the initial readiness probe is pending', async () => {
  let releaseProbe
  let starts = 0
  const probeStarted = new Promise(resolve => {
    releaseProbe = () => {
      resolve()
      return false
    }
  })
  const controller = createBackendController({
    log: () => {},
    sendStatus: () => {},
    probeReady: () => probeStarted,
    startProcess: () => {
      starts += 1
      return new EventEmitter()
    },
    intervalMs: 1,
    attempts: 1,
  })

  const startup = controller.ensureReady()
  controller.stop()
  releaseProbe()

  await assert.rejects(startup, /startup canceled/)
  assert.equal(starts, 0)
  assert.equal(controller.getState(), 'stopped')
})

test('stop cancels startup while runtime validation is pending', async () => {
  let releaseValidation
  let signalValidation
  const validationStarted = new Promise(resolve => { signalValidation = resolve })
  let starts = 0
  let switches = 0
  let probes = 0
  const controller = createBackendController({
    log: () => {},
    sendStatus: () => {},
    probeReady: async () => {
      probes += 1
      return probes === 1
    },
    validateReady: () => {
      signalValidation()
      return new Promise(resolve => { releaseValidation = resolve })
    },
    switchEndpoint: async () => { switches += 1 },
    startProcess: () => {
      starts += 1
      return new EventEmitter()
    },
    intervalMs: 1,
    attempts: 1,
  })

  const startup = controller.ensureReady()
  await validationStarted
  controller.stop()
  releaseValidation(false)

  await assert.rejects(startup, /startup canceled/)
  assert.equal(starts, 0)
  assert.equal(switches, 0)
  assert.equal(controller.getState(), 'stopped')
})

test('stop cancels startup while endpoint switching is pending', async () => {
  let releaseSwitch
  let signalSwitch
  const switchStarted = new Promise(resolve => { signalSwitch = resolve })
  let starts = 0
  let probes = 0
  const controller = createBackendController({
    log: () => {},
    sendStatus: () => {},
    probeReady: async () => {
      probes += 1
      return probes === 1
    },
    validateReady: async () => false,
    switchEndpoint: () => {
      signalSwitch()
      return new Promise(resolve => { releaseSwitch = resolve })
    },
    startProcess: () => {
      starts += 1
      return new EventEmitter()
    },
    intervalMs: 1,
    attempts: 1,
  })

  const startup = controller.ensureReady()
  await switchStarted
  controller.stop()
  releaseSwitch(false)

  await assert.rejects(startup, /startup canceled/)
  assert.equal(starts, 0)
  assert.equal(controller.getState(), 'stopped')
})

test('stop disposes a child whose delayed start resolves after cancellation', async () => {
  let resolveStart
  let signalStartCalled
  const startCalled = new Promise(resolve => { signalStartCalled = resolve })
  const proc = new EventEmitter()
  proc.pid = 4321
  const stopped = []
  const controller = createBackendController({
    log: () => {},
    sendStatus: () => {},
    probeReady: async () => false,
    startProcess: () => {
      signalStartCalled()
      return new Promise(resolve => { resolveStart = resolve })
    },
    stopProcess: child => stopped.push(child.pid),
    intervalMs: 1,
    attempts: 1,
  })

  const startup = controller.ensureReady()
  await startCalled
  controller.stop()
  resolveStart(proc)

  await assert.rejects(startup, /startup canceled/)
  assert.deepEqual(stopped, [4321])
  controller.stop()
  assert.deepEqual(stopped, [4321])
  assert.deepEqual(controller.getDiagnostics(), {
    state: 'stopped',
    lastError: '',
    launchAttempt: 0,
  })
})

test('ensureReady includes backend startup output when process exits before ready', async () => {
  const controller = createBackendController({
    log: () => {},
    sendStatus: () => {},
    probeReady: async () => false,
    startProcess: () => {
      const proc = new EventEmitter()
      proc.getStartupOutput = () => [
        'Traceback (most recent call last):',
        "ZoneInfoNotFoundError: 'No time zone found with key Asia/Shanghai'",
      ].join('\n')
      setTimeout(() => proc.emit('exit', 3), 0)
      return proc
    },
    intervalMs: 1,
    attempts: 5,
  })

  await assert.rejects(
    controller.ensureReady(),
    /No time zone found with key Asia\/Shanghai/
  )
})

test('records a diagnostic when a ready backend exits unexpectedly', async () => {
  let probeReady = false
  const proc = new EventEmitter()
  const controller = createBackendController({
    log: () => {},
    sendStatus: () => {},
    probeReady: async () => probeReady,
    startProcess: () => {
      probeReady = true
      return proc
    },
    intervalMs: 1,
    attempts: 2,
  })

  await controller.ensureReady()
  proc.emit('exit', 17)

  assert.deepEqual(controller.getDiagnostics(), {
    state: 'degraded',
    lastError: 'Backend process exited after ready (code=17)',
    launchAttempt: 1,
  })
})

test('ensureReady retries a backend launch that exits before ready', async () => {
  let startCount = 0
  const controller = createBackendController({
    log: () => {},
    sendStatus: () => {},
    probeReady: async () => startCount >= 2,
    startProcess: () => {
      startCount += 1
      const proc = new EventEmitter()
      if (startCount === 1) setTimeout(() => proc.emit('exit', 3), 0)
      return proc
    },
    intervalMs: 1,
    attempts: 5,
    launchRetries: 1,
    retryDelayMs: 1,
  })

  await controller.ensureReady()

  assert.equal(startCount, 2)
})

test('ensureReady stops a timed-out backend process before retrying launch', async () => {
  let startCount = 0
  const stopped = []

  const controller = createBackendController({
    log: () => {},
    sendStatus: () => {},
    probeReady: async () => startCount >= 2,
    startProcess: () => {
      startCount += 1
      const proc = new EventEmitter()
      proc.pid = 1000 + startCount
      return proc
    },
    stopProcess: (proc) => stopped.push(proc.pid),
    intervalMs: 1,
    attempts: 1,
    launchRetries: 1,
    retryDelayMs: 1,
  })

  await controller.ensureReady()

  assert.equal(startCount, 2)
  assert.deepEqual(stopped, [1001])
})

test('ensureReady does not stop a previously ready backend during transient probe timeouts', async () => {
  let startCount = 0
  let transientFailure = false
  const stopped = []

  const controller = createBackendController({
    log: () => {},
    sendStatus: () => {},
    probeReady: async () => startCount > 0 && !transientFailure,
    startProcess: () => {
      startCount += 1
      const proc = new EventEmitter()
      proc.pid = 2000 + startCount
      return proc
    },
    stopProcess: (proc) => stopped.push(proc.pid),
    intervalMs: 1,
    attempts: 2,
  })

  await controller.ensureReady()

  transientFailure = true
  await assert.rejects(
    controller.ensureReady(),
    /API server startup timeout/
  )
  await assert.rejects(
    controller.ensureReady(),
    /API server startup timeout/
  )

  assert.equal(startCount, 1)
  assert.deepEqual(stopped, [])
})

test('ensureReady marks a previously ready backend degraded before restart threshold', async () => {
  let startCount = 0
  let probeOk = true
  const stopped = []
  const statuses = []

  const controller = createBackendController({
    log: () => {},
    sendStatus: (key, value) => statuses.push([key, value]),
    probeReady: async () => startCount > 0 && probeOk,
    startProcess: () => {
      startCount += 1
      const proc = new EventEmitter()
      proc.pid = 3000 + startCount
      return proc
    },
    stopProcess: (proc) => stopped.push(proc.pid),
    intervalMs: 1,
    attempts: 1,
    restartProbeFailures: 2,
  })

  await controller.ensureReady()
  probeOk = false

  await assert.rejects(controller.ensureReady(), /API server startup timeout/)

  assert.equal(controller.getState(), 'degraded')
  assert.deepEqual(stopped, [])
  assert.ok(statuses.some(([key, value]) => key === 'apiState' && value === 'degraded'))
})

test('runWhenReady retries the operation after a retryable connection error', async () => {
  let probeCount = 0
  let operationCount = 0

  const controller = createBackendController({
    log: () => {},
    sendStatus: () => {},
    probeReady: async () => {
      probeCount += 1
      return probeCount === 1 || probeCount >= 3
    },
    startProcess: () => new EventEmitter(),
    intervalMs: 1,
    attempts: 5,
  })

  const result = await controller.runWhenReady(async () => {
    operationCount += 1
    if (operationCount === 1) {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:18765')
      error.code = 'ECONNREFUSED'
      throw error
    }
    return 'ok'
  }, {
    retries: 1,
    retryDelayMs: 1,
    retryableCodes: new Set(['ECONNREFUSED']),
  })

  assert.equal(result, 'ok')
  assert.equal(operationCount, 2)
})

test('runWhenReady can replace exhausted retryable connection errors with diagnostics', async () => {
  const controller = createBackendController({
    log: () => {},
    sendStatus: () => {},
    probeReady: async () => true,
    startProcess: () => new EventEmitter(),
    intervalMs: 1,
    attempts: 5,
  })

  await assert.rejects(
    controller.runWhenReady(async () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:18765')
      error.code = 'ECONNREFUSED'
      throw error
    }, {
      retries: 1,
      retryDelayMs: 1,
      retryableCodes: new Set(['ECONNREFUSED']),
      describeFailure: (error) => new Error(`核心服务暂时不可用：${error.message}`),
    }),
    /核心服务暂时不可用：connect ECONNREFUSED/
  )
})

test('ensureReady does not reuse a backend from another runtime', async () => {
  let probeCount = 0
  let startCount = 0

  const controller = createBackendController({
    log: () => {},
    sendStatus: () => {},
    probeReady: async () => {
      probeCount += 1
      return probeCount >= 2
    },
    validateReady: async () => {
      if (startCount === 0) return false
      return true
    },
    startProcess: () => {
      startCount += 1
      return new EventEmitter()
    },
    intervalMs: 1,
    attempts: 5,
  })

  await controller.ensureReady()

  assert.equal(startCount, 1)
  assert.equal(probeCount, 2)
})

test('ensureReady switches endpoint before launching when ready backend is foreign', async () => {
  const endpoints = []
  let activeEndpoint = 18765
  let startCount = 0

  const controller = createBackendController({
    log: () => {},
    sendStatus: () => {},
    probeReady: async () => activeEndpoint === 18765,
    validateReady: async () => false,
    switchEndpoint: async () => {
      activeEndpoint = 18766
      endpoints.push(activeEndpoint)
    },
    startProcess: () => {
      startCount += 1
      return new EventEmitter()
    },
    intervalMs: 1,
    attempts: 1,
  })

  await assert.rejects(controller.ensureReady(), /API server startup timeout/)

  assert.deepEqual(endpoints, [18766])
  assert.equal(startCount, 1)
})
