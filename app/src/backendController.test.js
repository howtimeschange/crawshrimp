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
