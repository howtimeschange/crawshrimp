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
