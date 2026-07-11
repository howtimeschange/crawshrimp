const test = require('node:test')
const assert = require('node:assert/strict')

const { createUpdateInstallCoordinator } = require('./updateInstallCoordinator')

function createUpdateService(initial = {}) {
  const subscribers = new Set()
  const readinessCalls = []
  let unsubscribeCalls = 0
  let status = {
    status: 'idle',
    downloaded: false,
    blockers: [],
    error: '',
    ...initial,
  }

  function snapshot() {
    return {
      ...status,
      blockers: status.blockers.map(blocker => ({ ...blocker })),
    }
  }

  function publish(patch) {
    status = { ...status, ...patch }
    const next = snapshot()
    for (const subscriber of subscribers) subscriber(next)
  }

  return {
    getStatus: snapshot,
    publish,
    readinessCalls,
    get unsubscribeCalls() {
      return unsubscribeCalls
    },
    subscribe(listener) {
      subscribers.add(listener)
      listener(snapshot())
      return () => {
        unsubscribeCalls += 1
        subscribers.delete(listener)
      }
    },
    setInstallReadiness(readiness) {
      readinessCalls.push(readiness)
      if (readiness.error) {
        publish({
          status: 'waiting-for-tasks',
          blockers: readiness.blockers || [],
          error: String(readiness.error),
        })
        return
      }
      publish({
        status: readiness.ready ? 'ready-to-install' : 'waiting-for-tasks',
        blockers: readiness.ready ? [] : readiness.blockers || [],
        error: '',
      })
    },
    setInstalling() {
      if (status.status !== 'ready-to-install') throw new Error('not ready')
      publish({ status: 'installing', blockers: [], error: '' })
    },
    quitAndInstall() {
      if (status.status !== 'installing') throw new Error('not installing')
    },
  }
}

function createTimerHarness() {
  const active = new Set()
  const timers = []
  return {
    timers,
    active,
    setIntervalFn(fn, ms) {
      const timer = { fn, ms }
      active.add(timer)
      timers.push(timer)
      return timer
    },
    clearIntervalFn(timer) {
      active.delete(timer)
    },
  }
}

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

test('downloaded state immediately checks readiness', async () => {
  const updateService = createUpdateService({ status: 'downloaded', downloaded: true })
  let checks = 0
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => {
      checks += 1
      return { ready: true, blockers: [] }
    },
    acquireDrain: async () => ({ ok: true, drain_token: 'drain-1', readiness: { ready: true, blockers: [] } }),
    releaseDrain: async () => {},
    shutdownForUpdate: async () => true,
    notifyReady: () => {},
  })

  coordinator.start()
  await flush()

  assert.equal(checks, 1)
  assert.equal(updateService.getStatus().status, 'ready-to-install')
})

test('a blocker sets waiting-for-tasks and schedules one five-second retry', async () => {
  const updateService = createUpdateService({ status: 'downloaded', downloaded: true })
  const timerHarness = createTimerHarness()
  let checks = 0
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => {
      checks += 1
      return {
        ready: false,
        blockers: [{ kind: 'task', id: 'export::1', label: 'Export', status: 'running' }],
      }
    },
    acquireDrain: async () => ({ ok: true, drain_token: 'drain-1', readiness: { ready: true, blockers: [] } }),
    releaseDrain: async () => {},
    shutdownForUpdate: async () => true,
    notifyReady: () => {},
    ...timerHarness,
  })

  coordinator.start()
  await flush()
  await coordinator.refreshReadiness()

  assert.equal(updateService.getStatus().status, 'waiting-for-tasks')
  assert.deepEqual(updateService.getStatus().blockers, [
    { kind: 'task', id: 'export::1', label: 'Export', status: 'running' },
  ])
  assert.equal(timerHarness.timers.length, 1)
  assert.equal(timerHarness.timers[0].ms, 5000)
  assert.equal(timerHarness.active.size, 1)

  await timerHarness.timers[0].fn()

  assert.equal(checks, 3)
  assert.equal(timerHarness.timers.length, 1)
})

test('transition from waiting to ready emits exactly one notification', async () => {
  const updateService = createUpdateService({ status: 'downloaded', downloaded: true })
  const timerHarness = createTimerHarness()
  const readiness = [
    { ready: false, blockers: [{ kind: 'task', id: 'ai::1' }] },
    { ready: true, blockers: [] },
    { ready: true, blockers: [] },
  ]
  let notifications = 0
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => readiness.shift() || { ready: true, blockers: [] },
    acquireDrain: async () => ({ ok: true, drain_token: 'drain-1', readiness: { ready: true, blockers: [] } }),
    releaseDrain: async () => {},
    shutdownForUpdate: async () => true,
    notifyReady: () => { notifications += 1 },
    ...timerHarness,
  })

  coordinator.start()
  await flush()
  assert.equal(updateService.getStatus().status, 'waiting-for-tasks')

  await timerHarness.timers[0].fn()
  await coordinator.refreshReadiness()

  assert.equal(updateService.getStatus().status, 'ready-to-install')
  assert.equal(notifications, 1)
  assert.equal(timerHarness.active.size, 0)
})

test('readiness network failure sets an error and never installs', async () => {
  const updateService = createUpdateService({ status: 'downloaded', downloaded: true })
  const events = []
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => {
      events.push('get-readiness')
      throw new Error('network down')
    },
    acquireDrain: async () => {
      events.push('acquire-drain')
      return { ok: true, drain_token: 'drain-1', readiness: { ready: true, blockers: [] } }
    },
    releaseDrain: async () => events.push('release-drain'),
    shutdownForUpdate: async () => { events.push('shutdown'); return true },
    notifyReady: () => {},
  })

  const result = await coordinator.requestInstall()

  assert.deepEqual(events, ['get-readiness'])
  assert.deepEqual(result, { ok: false, deferred: true })
  assert.equal(updateService.getStatus().status, 'waiting-for-tasks')
  assert.match(updateService.getStatus().error, /network down/)
})

async function assertUnsafeReadinessDefers(label, readinessResponse) {
  const updateService = createUpdateService({ status: 'ready-to-install', downloaded: true })
  const events = []
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => readinessResponse,
    acquireDrain: async () => {
      events.push(`${label}:acquire-drain`)
      return { ok: true, drain_token: 'drain-1', readiness: { ready: true, blockers: [] } }
    },
    releaseDrain: async () => events.push(`${label}:release-drain`),
    shutdownForUpdate: async () => {
      events.push(`${label}:shutdown`)
      return true
    },
    notifyReady: () => {},
  })

  const result = await coordinator.requestInstall()

  assert.deepEqual(result, { ok: false, deferred: true })
  assert.deepEqual(events, [])
  assert.equal(updateService.getStatus().status, 'waiting-for-tasks')
  assert.match(updateService.getStatus().error, /readiness/i)
}

test('malformed readiness responses fail closed before drain acquisition', async () => {
  await assertUnsafeReadinessDefers('undefined', undefined)
  await assertUnsafeReadinessDefers('empty-object', {})
  await assertUnsafeReadinessDefers('non-object', 'ready')
  await assertUnsafeReadinessDefers('missing-explicit-ready', { blockers: [] })
})

test('ready readiness with blockers fails closed before drain acquisition', async () => {
  const updateService = createUpdateService({ status: 'ready-to-install', downloaded: true })
  const events = []
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => ({
      ready: true,
      blockers: [{ kind: 'task', id: 'contradictory::1' }],
    }),
    acquireDrain: async () => {
      events.push('acquire-drain')
      return { ok: true, drain_token: 'drain-1', readiness: { ready: true, blockers: [] } }
    },
    releaseDrain: async () => events.push('release-drain'),
    shutdownForUpdate: async () => { events.push('shutdown'); return true },
    notifyReady: () => {},
  })

  assert.deepEqual(await coordinator.requestInstall(), { ok: false, deferred: true })
  assert.deepEqual(events, [])
  assert.equal(updateService.getStatus().status, 'waiting-for-tasks')
  assert.deepEqual(updateService.getStatus().blockers, [{ kind: 'task', id: 'contradictory::1' }])
  assert.match(updateService.getStatus().error, /readiness/i)
})

test('ready readiness with error fails closed before drain acquisition', async () => {
  const updateService = createUpdateService({ status: 'ready-to-install', downloaded: true })
  const events = []
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => ({
      ready: true,
      blockers: [],
      error: 'backend disagrees',
    }),
    acquireDrain: async () => {
      events.push('acquire-drain')
      return { ok: true, drain_token: 'drain-1', readiness: { ready: true, blockers: [] } }
    },
    releaseDrain: async () => events.push('release-drain'),
    shutdownForUpdate: async () => { events.push('shutdown'); return true },
    notifyReady: () => {},
  })

  assert.deepEqual(await coordinator.requestInstall(), { ok: false, deferred: true })
  assert.deepEqual(events, [])
  assert.equal(updateService.getStatus().status, 'waiting-for-tasks')
  assert.match(updateService.getStatus().error, /backend disagrees/)
})

test('requestInstall fresh-checks readiness then drains, cleans up, marks installing, and quits', async () => {
  const updateService = createUpdateService({ status: 'ready-to-install', downloaded: true })
  const events = []
  updateService.setInstalling = () => {
    events.push('set-installing')
    updateService.publish({ status: 'installing', blockers: [], error: '' })
  }
  updateService.quitAndInstall = () => {
    events.push('quit-and-install')
  }
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => {
      events.push('get-readiness')
      return { ready: true, blockers: [] }
    },
    acquireDrain: async () => {
      events.push('acquire-drain')
      return { ok: true, drain_token: 'drain-1', readiness: { ready: true, blockers: [] } }
    },
    releaseDrain: async () => events.push('release-drain'),
    shutdownForUpdate: async () => { events.push('shutdown'); return true },
    notifyReady: () => {},
  })

  const result = await coordinator.requestInstall()

  assert.deepEqual(events, [
    'get-readiness',
    'acquire-drain',
    'shutdown',
    'set-installing',
    'quit-and-install',
  ])
  assert.deepEqual(result, { ok: true })
})

test('requestInstall accepts real successful API drain response and quits only after cleanup', async () => {
  const updateService = createUpdateService({ status: 'ready-to-install', downloaded: true })
  const events = []
  updateService.setInstalling = () => {
    events.push('set-installing')
    updateService.publish({ status: 'installing', blockers: [], error: '' })
  }
  updateService.quitAndInstall = () => {
    events.push('quit-and-install')
  }
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => {
      events.push('get-readiness')
      return { ready: true, blockers: [], draining: false }
    },
    acquireDrain: async () => {
      events.push('acquire-drain')
      return {
        ok: true,
        drain_token: 'drain-1',
        readiness: {
          ready: true,
          draining: true,
          blockers: [],
          install_ready: true,
        },
      }
    },
    releaseDrain: async token => events.push(`release-drain:${token}`),
    shutdownForUpdate: async () => { events.push('shutdown'); return true },
    notifyReady: () => {},
  })

  const result = await coordinator.requestInstall()

  assert.deepEqual(events, [
    'get-readiness',
    'acquire-drain',
    'shutdown',
    'set-installing',
    'quit-and-install',
  ])
  assert.deepEqual(result, { ok: true })
})

async function assertUnsafeDrainDefers(label, drainResponse) {
  const updateService = createUpdateService({ status: 'ready-to-install', downloaded: true })
  const events = []
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => {
      events.push(`${label}:get-readiness`)
      return { ready: true, blockers: [] }
    },
    acquireDrain: async () => {
      events.push(`${label}:acquire-drain`)
      return drainResponse
    },
    releaseDrain: async token => events.push(`${label}:release-drain:${token}`),
    shutdownForUpdate: async () => {
      events.push(`${label}:shutdown`)
      return true
    },
    notifyReady: () => {},
  })

  const result = await coordinator.requestInstall()
  const expectedEvents = [`${label}:get-readiness`, `${label}:acquire-drain`]
  if (String(drainResponse?.drain_token || drainResponse?.drainToken || '').trim()) {
    expectedEvents.push(`${label}:release-drain:${drainResponse.drain_token || drainResponse.drainToken}`)
  }

  assert.deepEqual(result, { ok: false, deferred: true })
  assert.deepEqual(events, expectedEvents)
  assert.equal(updateService.getStatus().status, 'waiting-for-tasks')
  assert.match(updateService.getStatus().error, /drain/i)
}

test('malformed drain responses fail closed before cleanup or install', async () => {
  await assertUnsafeDrainDefers('undefined', undefined)
  await assertUnsafeDrainDefers('empty-object', {})
  await assertUnsafeDrainDefers('empty-token', {
    ok: true,
    drain_token: '',
    readiness: { ready: true, blockers: [] },
  })
  await assertUnsafeDrainDefers('missing-readiness', {
    ok: true,
    drain_token: 'drain-1',
  })
})

async function assertContradictoryDrainReadinessDefers(label, readiness) {
  const updateService = createUpdateService({ status: 'ready-to-install', downloaded: true })
  const events = []
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => {
      events.push(`${label}:get-readiness`)
      return { ready: true, blockers: [] }
    },
    acquireDrain: async () => {
      events.push(`${label}:acquire-drain`)
      return { ok: true, drain_token: 'drain-1', readiness }
    },
    releaseDrain: async token => events.push(`${label}:release-drain:${token}`),
    shutdownForUpdate: async () => {
      events.push(`${label}:shutdown`)
      return true
    },
    notifyReady: () => {},
  })

  assert.deepEqual(await coordinator.requestInstall(), { ok: false, deferred: true })
  assert.deepEqual(events, [
    `${label}:get-readiness`,
    `${label}:acquire-drain`,
    `${label}:release-drain:drain-1`,
  ])
  assert.equal(updateService.getStatus().status, 'waiting-for-tasks')
}

test('drain readiness with blockers fails closed and releases the token', async () => {
  await assertContradictoryDrainReadinessDefers('drain-blockers', {
    ready: true,
    blockers: [{ kind: 'task', id: 'contradictory::drain' }],
  })
})

test('drain readiness with error fails closed and releases the token', async () => {
  await assertContradictoryDrainReadinessDefers('drain-error', {
    ready: true,
    blockers: [],
    error: 'drain disagrees',
  })
})

test('a 409 drain race returns to waiting without cleanup or install', async () => {
  const updateService = createUpdateService({ status: 'ready-to-install', downloaded: true })
  const timerHarness = createTimerHarness()
  const events = []
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => {
      events.push('get-readiness')
      return { ready: true, blockers: [] }
    },
    acquireDrain: async () => {
      events.push('acquire-drain')
      const error = new Error('runtime busy')
      error.status = 409
      error.blockers = [{ kind: 'task', id: 'race::1' }]
      throw error
    },
    releaseDrain: async () => events.push('release-drain'),
    shutdownForUpdate: async () => { events.push('shutdown'); return true },
    notifyReady: () => {},
    ...timerHarness,
  })

  const result = await coordinator.requestInstall()

  assert.deepEqual(events, ['get-readiness', 'acquire-drain'])
  assert.deepEqual(result, { ok: false, deferred: true })
  assert.equal(updateService.getStatus().status, 'waiting-for-tasks')
  assert.deepEqual(updateService.getStatus().blockers, [{ kind: 'task', id: 'race::1' }])
  assert.equal(timerHarness.timers.length, 1)
})

test('cleanup failure releases the acquired drain token and restores retryable readiness', async () => {
  const updateService = createUpdateService({ status: 'ready-to-install', downloaded: true })
  const events = []
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => {
      events.push('get-readiness')
      return { ready: true, blockers: [] }
    },
    acquireDrain: async () => {
      events.push('acquire-drain')
      return { ok: true, drain_token: 'drain-1', readiness: { ready: true, blockers: [] } }
    },
    releaseDrain: async token => events.push(`release-drain:${token}`),
    shutdownForUpdate: async () => {
      events.push('shutdown')
      throw new Error('cleanup failed')
    },
    notifyReady: () => {},
  })

  await assert.rejects(() => coordinator.requestInstall(), /cleanup failed/)

  assert.deepEqual(events, [
    'get-readiness',
    'acquire-drain',
    'shutdown',
    'release-drain:drain-1',
  ])
  assert.equal(updateService.getStatus().status, 'ready-to-install')
})

test('cleanup false result releases the drain token and skips install side effects', async () => {
  const updateService = createUpdateService({ status: 'ready-to-install', downloaded: true })
  const events = []
  updateService.setInstalling = () => events.push('set-installing')
  updateService.quitAndInstall = () => events.push('quit-and-install')
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => {
      events.push('get-readiness')
      return { ready: true, blockers: [] }
    },
    acquireDrain: async () => {
      events.push('acquire-drain')
      return { ok: true, drain_token: 'drain-1', readiness: { ready: true, blockers: [] } }
    },
    releaseDrain: async token => events.push(`release-drain:${token}`),
    shutdownForUpdate: async () => {
      events.push('shutdown')
      return false
    },
    notifyReady: () => {},
  })

  const result = await coordinator.requestInstall()

  assert.deepEqual(result, { ok: false, deferred: true })
  assert.deepEqual(events, [
    'get-readiness',
    'acquire-drain',
    'shutdown',
    'release-drain:drain-1',
  ])
  assert.equal(updateService.getStatus().status, 'ready-to-install')
})

test('post-cleanup install failure skips backend drain release and restores readiness after recovery', async () => {
  const updateService = createUpdateService({ status: 'ready-to-install', downloaded: true })
  const events = []
  updateService.setInstalling = () => {
    events.push('set-installing')
    throw new Error('install gate failed')
  }
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => {
      events.push('get-readiness')
      return { ready: true, blockers: [] }
    },
    acquireDrain: async () => {
      events.push('acquire-drain')
      return { ok: true, drain_token: 'drain-1', readiness: { ready: true, blockers: [] } }
    },
    releaseDrain: async token => events.push(`release-drain:${token}`),
    shutdownForUpdate: async () => { events.push('shutdown'); return true },
    recoverAfterCleanupFailure: async () => events.push('recover'),
    notifyReady: () => {},
  })

  await assert.rejects(() => coordinator.requestInstall(), /install gate failed/)

  assert.deepEqual(events, [
    'get-readiness',
    'acquire-drain',
    'shutdown',
    'set-installing',
    'recover',
  ])
  assert.equal(updateService.getStatus().status, 'ready-to-install')
})

test('post-cleanup setInstalling failure skips drain release, awaits recovery, then restores retryable readiness', async () => {
  const updateService = createUpdateService({ status: 'ready-to-install', downloaded: true })
  const events = []
  const setInstallReadiness = updateService.setInstallReadiness
  updateService.setInstallReadiness = readiness => {
    if (events.includes('shutdown')) {
      events.push(`set-readiness:${readiness.ready}:${updateService.getStatus().status}`)
    }
    setInstallReadiness(readiness)
  }
  updateService.setInstalling = () => {
    events.push('set-installing')
    updateService.publish({ status: 'installing', blockers: [], error: '' })
    throw new Error('install gate failed')
  }
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => {
      events.push('get-readiness')
      return { ready: true, blockers: [] }
    },
    acquireDrain: async () => {
      events.push('acquire-drain')
      return { ok: true, drain_token: 'drain-1', readiness: { ready: true, blockers: [] } }
    },
    releaseDrain: async token => events.push(`release-drain:${token}`),
    shutdownForUpdate: async () => { events.push('shutdown'); return true },
    recoverAfterCleanupFailure: async () => {
      events.push(`recover-start:${updateService.getStatus().status}`)
      await Promise.resolve()
      events.push(`recover-end:${updateService.getStatus().status}`)
    },
    notifyReady: () => {},
  })

  await assert.rejects(() => coordinator.requestInstall(), /install gate failed/)

  assert.deepEqual(events, [
    'get-readiness',
    'acquire-drain',
    'shutdown',
    'set-installing',
    'recover-start:installing',
    'recover-end:installing',
    'set-readiness:true:installing',
  ])
  assert.equal(updateService.getStatus().status, 'ready-to-install')
})

test('post-cleanup quitAndInstall failure skips drain release, awaits recovery, then preserves original error', async () => {
  const updateService = createUpdateService({ status: 'ready-to-install', downloaded: true })
  const events = []
  const setInstallReadiness = updateService.setInstallReadiness
  updateService.setInstallReadiness = readiness => {
    if (events.includes('shutdown')) {
      events.push(`set-readiness:${readiness.ready}:${updateService.getStatus().status}`)
    }
    setInstallReadiness(readiness)
  }
  updateService.setInstalling = () => {
    events.push('set-installing')
    updateService.publish({ status: 'installing', blockers: [], error: '' })
  }
  updateService.quitAndInstall = () => {
    events.push('quit-and-install')
    throw new Error('quit install failed')
  }
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => {
      events.push('get-readiness')
      return { ready: true, blockers: [] }
    },
    acquireDrain: async () => {
      events.push('acquire-drain')
      return { ok: true, drain_token: 'drain-1', readiness: { ready: true, blockers: [] } }
    },
    releaseDrain: async token => events.push(`release-drain:${token}`),
    shutdownForUpdate: async () => { events.push('shutdown'); return true },
    recoverAfterCleanupFailure: async () => {
      events.push(`recover-start:${updateService.getStatus().status}`)
      updateService.publish({ status: 'downloaded', blockers: [], error: '' })
      events.push(`recover-end:${updateService.getStatus().status}`)
    },
    notifyReady: () => {},
  })

  await assert.rejects(() => coordinator.requestInstall(), /quit install failed/)

  assert.deepEqual(events, [
    'get-readiness',
    'acquire-drain',
    'shutdown',
    'set-installing',
    'quit-and-install',
    'recover-start:installing',
    'recover-end:downloaded',
    'set-readiness:true:downloaded',
  ])
  assert.equal(updateService.getStatus().status, 'ready-to-install')
})

test('post-cleanup recovery failure logs, preserves install error, and never becomes ready', async () => {
  const updateService = createUpdateService({ status: 'ready-to-install', downloaded: true })
  const events = []
  const warnings = []
  updateService.setInstalling = () => {
    events.push('set-installing')
    updateService.publish({ status: 'installing', blockers: [], error: '' })
  }
  updateService.quitAndInstall = () => {
    events.push('quit-and-install')
    throw new Error('quit install failed')
  }
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => ({ ready: true, blockers: [] }),
    acquireDrain: async () => ({ ok: true, drain_token: 'drain-1', readiness: { ready: true, blockers: [] } }),
    releaseDrain: async token => events.push(`release-drain:${token}`),
    shutdownForUpdate: async () => true,
    recoverAfterCleanupFailure: async () => {
      events.push('recover')
      throw new Error('restart failed')
    },
    notifyReady: () => {},
    log: {
      warn: (message, error) => warnings.push(`${message}:${error.message}`),
    },
  })

  await assert.rejects(() => coordinator.requestInstall(), /quit install failed/)

  assert.deepEqual(events, [
    'set-installing',
    'quit-and-install',
    'recover',
  ])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /restart failed/)
  assert.equal(updateService.getStatus().status, 'waiting-for-tasks')
  assert.match(updateService.getStatus().error, /restart failed/)
})

test('dispose before readiness resolution prevents post-await side effects', async () => {
  const updateService = createUpdateService({ status: 'downloaded', downloaded: true })
  const timerHarness = createTimerHarness()
  const readiness = createDeferred()
  let notifications = 0
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => readiness.promise,
    acquireDrain: async () => ({ ok: true, drain_token: 'drain-1', readiness: { ready: true, blockers: [] } }),
    releaseDrain: async () => {},
    shutdownForUpdate: async () => true,
    notifyReady: () => { notifications += 1 },
    ...timerHarness,
  })

  coordinator.start()
  await flush()
  coordinator.dispose()
  readiness.resolve({ ready: false, blockers: [{ kind: 'task', id: 'late::1' }] })
  await flush()

  assert.equal(updateService.readinessCalls.length, 0)
  assert.equal(notifications, 0)
  assert.equal(timerHarness.timers.length, 0)
  assert.equal(updateService.getStatus().status, 'downloaded')
})

test('dispose before drain resolution releases token and skips install side effects', async () => {
  const updateService = createUpdateService({ status: 'ready-to-install', downloaded: true })
  const drain = createDeferred()
  const events = []
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => {
      events.push('get-readiness')
      return { ready: true, blockers: [] }
    },
    acquireDrain: async () => {
      events.push('acquire-drain')
      return drain.promise
    },
    releaseDrain: async token => events.push(`release-drain:${token}`),
    shutdownForUpdate: async () => { events.push('shutdown'); return true },
    notifyReady: () => {},
  })

  const install = coordinator.requestInstall()
  await flush()
  coordinator.dispose()
  drain.resolve({ ok: true, drain_token: 'drain-1', readiness: { ready: true, blockers: [] } })

  assert.deepEqual(await install, { ok: false, deferred: true })
  assert.deepEqual(events, ['get-readiness', 'acquire-drain', 'release-drain:drain-1'])
})

test('dispose unsubscribes and clears polling', async () => {
  const updateService = createUpdateService({ status: 'downloaded', downloaded: true })
  const timerHarness = createTimerHarness()
  const coordinator = createUpdateInstallCoordinator({
    updateService,
    getReadiness: async () => ({
      ready: false,
      blockers: [{ kind: 'task', id: 'export::1' }],
    }),
    acquireDrain: async () => ({ ok: true, drain_token: 'drain-1', readiness: { ready: true, blockers: [] } }),
    releaseDrain: async () => {},
    shutdownForUpdate: async () => true,
    notifyReady: () => {},
    ...timerHarness,
  })

  coordinator.start()
  await flush()
  coordinator.dispose()
  updateService.publish({ status: 'downloaded', downloaded: true })
  await flush()

  assert.equal(updateService.unsubscribeCalls, 1)
  assert.equal(timerHarness.active.size, 0)
  assert.equal(timerHarness.timers.length, 1)
})
