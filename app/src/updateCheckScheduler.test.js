const test = require('node:test')
const assert = require('node:assert/strict')
const { createUpdateCheckScheduler } = require('./updateCheckScheduler')

function createTimerHarness() {
  const timers = []
  const active = new Set()
  return {
    timers,
    active,
    setTimeoutFn(fn, ms) {
      const timer = { fn, ms }
      timers.push(timer)
      active.add(timer)
      return timer
    },
    clearTimeoutFn(timer) {
      active.delete(timer)
    },
    async fire(timer) {
      active.delete(timer)
      await timer.fn()
    },
  }
}

function createUpdateService(results = []) {
  const calls = []
  let status = { status: 'idle', latestVersion: '' }
  return {
    calls,
    getStatus: () => ({ ...status }),
    async checkForUpdates(options) {
      calls.push(options)
      const result = results.shift() || { status: 'up-to-date', latestVersion: '' }
      if (result instanceof Error) throw result
      status = { ...status, ...result }
      return status
    },
  }
}

test('automatic checks start after launch and repeat every six hours without duplicate notifications', async () => {
  const timers = createTimerHarness()
  const updateService = createUpdateService([
    { status: 'available', latestVersion: '2.1.2' },
    { status: 'available', latestVersion: '2.1.2' },
  ])
  const notifications = []
  const scheduler = createUpdateCheckScheduler({
    updateService,
    supported: true,
    notifyAvailable: status => notifications.push(status.latestVersion),
    now: () => 100,
    initialDelayMs: 15000,
    intervalMs: 6 * 60 * 60 * 1000,
    retryDelayMs: 5 * 60 * 1000,
    focusCooldownMs: 5 * 60 * 1000,
    ...timers,
  })

  scheduler.start()
  assert.equal(timers.timers[0].ms, 15000)
  await timers.fire(timers.timers[0])
  assert.deepEqual(updateService.calls, [{ manual: false }])
  assert.deepEqual(notifications, ['2.1.2'])

  const intervalTimer = timers.timers[1]
  assert.equal(intervalTimer.ms, 6 * 60 * 60 * 1000)
  await timers.fire(intervalTimer)
  assert.deepEqual(updateService.calls, [{ manual: false }, { manual: false }])
  assert.deepEqual(notifications, ['2.1.2'])
})

test('app focus rechecks an already-running desktop after the focus cooldown', async () => {
  const timers = createTimerHarness()
  let now = 0
  const updateService = createUpdateService([{ status: 'up-to-date' }, { status: 'up-to-date' }])
  const scheduler = createUpdateCheckScheduler({
    updateService,
    supported: true,
    now: () => now,
    initialDelayMs: 15000,
    intervalMs: 6 * 60 * 60 * 1000,
    retryDelayMs: 5 * 60 * 1000,
    focusCooldownMs: 5 * 60 * 1000,
    ...timers,
  })

  scheduler.start()
  now = 15000
  await timers.fire(timers.timers[0])
  now += 5 * 60 * 1000
  scheduler.onAppFocus()

  const focusTimer = timers.timers[2]
  assert.equal(focusTimer.ms, 0)
  await timers.fire(focusTimer)
  assert.deepEqual(updateService.calls, [{ manual: false }, { manual: false }])
})

test('failed automatic checks retry after five minutes instead of waiting for the six-hour interval', async () => {
  const timers = createTimerHarness()
  const updateService = createUpdateService([new Error('feed unavailable'), { status: 'up-to-date' }])
  const warnings = []
  const scheduler = createUpdateCheckScheduler({
    updateService,
    supported: true,
    log: { warn: (message, error) => warnings.push(`${message}:${error.message}`) },
    now: () => 100,
    initialDelayMs: 15000,
    intervalMs: 6 * 60 * 60 * 1000,
    retryDelayMs: 5 * 60 * 1000,
    focusCooldownMs: 5 * 60 * 1000,
    ...timers,
  })

  scheduler.start()
  await timers.fire(timers.timers[0])
  assert.equal(timers.timers[1].ms, 5 * 60 * 1000)
  assert.deepEqual(warnings, ['Automatic desktop update check failed:feed unavailable'])

  await timers.fire(timers.timers[1])
  assert.deepEqual(updateService.calls, [{ manual: false }, { manual: false }])
  assert.equal(timers.timers[2].ms, 6 * 60 * 60 * 1000)
})

test('unsupported environments schedule no automatic update checks', () => {
  const timers = createTimerHarness()
  const scheduler = createUpdateCheckScheduler({
    updateService: createUpdateService(),
    supported: false,
    ...timers,
  })

  scheduler.start()
  scheduler.onAppFocus()
  assert.equal(timers.timers.length, 0)
})
