const test = require('node:test')
const assert = require('node:assert/strict')

const { createLifecycleController } = require('./lifecycleController')

test('macOS window-all-closed keeps backend running for dock reactivation', () => {
  const events = []
  const controller = createLifecycleController({
    platform: 'darwin',
    stopBackend: () => events.push('stop-backend'),
    quitApp: () => events.push('quit'),
  })

  controller.handleWindowAllClosed()

  assert.deepEqual(events, [])
})

test('non-mac window-all-closed starts app quit instead of directly killing backend', () => {
  const events = []
  const controller = createLifecycleController({
    platform: 'win32',
    stopBackend: () => events.push('stop-backend'),
    quitApp: () => events.push('quit'),
  })

  controller.handleWindowAllClosed()

  assert.deepEqual(events, ['quit'])
})

test('before-quit cancels quit when active tasks exist and user chooses to continue running', async () => {
  const events = []
  const prevented = []
  const controller = createLifecycleController({
    getActiveTasks: async () => ({
      active: true,
      tasks: [{ jid: 'demo::task', status: 'running', records: 3 }],
    }),
    confirmQuitWithActiveTasks: async () => false,
    onQuitCanceled: async () => events.push('restore-window'),
    stopBackend: async () => events.push('stop-backend'),
    stopManagedChrome: async () => events.push('stop-chrome'),
    quitApp: () => events.push('quit'),
  })

  await controller.handleBeforeQuit({
    preventDefault: () => prevented.push(true),
  })

  assert.deepEqual(prevented, [true])
  assert.deepEqual(events, ['restore-window'])
})

test('before-quit waits for graceful shutdown when user confirms active task stop', async () => {
  const events = []
  const prevented = []
  const controller = createLifecycleController({
    getActiveTasks: async () => ({
      active: true,
      tasks: [{ jid: 'demo::task', status: 'running', records: 3 }],
    }),
    confirmQuitWithActiveTasks: async (tasks) => {
      events.push(`confirm:${tasks.length}`)
      return true
    },
    requestStopActiveTasks: async (tasks) => events.push(`request-stop:${tasks.length}`),
    waitForNoActiveTasks: async () => events.push('wait-no-active'),
    stopBackend: async () => events.push('stop-backend'),
    stopManagedChrome: async () => events.push('stop-chrome'),
    quitApp: () => events.push('quit'),
  })

  await controller.handleBeforeQuit({
    preventDefault: () => prevented.push(true),
  })

  assert.deepEqual(prevented, [true])
  assert.deepEqual(events, [
    'confirm:1',
    'request-stop:1',
    'wait-no-active',
    'stop-backend',
    'stop-chrome',
    'quit',
  ])
})

test('before-quit stops managed processes without prompting when no tasks are active', async () => {
  const events = []
  const prevented = []
  const controller = createLifecycleController({
    getActiveTasks: async () => ({ active: false, tasks: [] }),
    confirmQuitWithActiveTasks: async () => events.push('confirm'),
    stopBackend: async () => events.push('stop-backend'),
    stopManagedChrome: async () => events.push('stop-chrome'),
    quitApp: () => events.push('quit'),
  })

  await controller.handleBeforeQuit({
    preventDefault: () => prevented.push(true),
  })

  assert.deepEqual(prevented, [true])
  assert.deepEqual(events, ['stop-backend', 'stop-chrome', 'quit'])
})

test('before-quit allows the confirmed second quit event through', async () => {
  const events = []
  const prevented = []
  const controller = createLifecycleController({
    getActiveTasks: async () => ({ active: false, tasks: [] }),
    stopBackend: async () => events.push('stop-backend'),
    stopManagedChrome: async () => events.push('stop-chrome'),
    quitApp: () => events.push('quit'),
  })

  await controller.handleBeforeQuit({
    preventDefault: () => prevented.push('first'),
  })
  const second = await controller.handleBeforeQuit({
    preventDefault: () => prevented.push('second'),
  })

  assert.equal(second, true)
  assert.deepEqual(prevented, ['first'])
  assert.deepEqual(events, ['stop-backend', 'stop-chrome', 'quit'])
})

test('before-quit waits for quit-cancel recovery hooks to settle', async () => {
  const events = []
  let releaseRecovery
  const recovery = new Promise(resolve => { releaseRecovery = resolve })
  const controller = createLifecycleController({
    getActiveTasks: async () => ({
      active: true,
      tasks: [{ jid: 'demo::task', status: 'running', records: 3 }],
    }),
    confirmQuitWithActiveTasks: async () => false,
    onQuitCanceled: async () => {
      events.push('recovery-started')
      await recovery
      events.push('recovery-finished')
    },
    quitApp: () => events.push('quit'),
  })

  const beforeQuit = controller.handleBeforeQuit({
    preventDefault: () => events.push('prevented'),
  })

  for (let i = 0; i < 5 && !events.includes('recovery-started'); i++) {
    await Promise.resolve()
  }
  assert.deepEqual(events, ['prevented', 'recovery-started'])
  releaseRecovery()
  await beforeQuit

  assert.deepEqual(events, ['prevented', 'recovery-started', 'recovery-finished'])
})

test('updater cleanup never asks to stop active tasks', async () => {
  const events = []
  const controller = createLifecycleController({
    getActiveTasks: async () => { events.push('get-active'); return { active: true, tasks: [{}] } },
    confirmQuitWithActiveTasks: async () => events.push('confirm'),
    requestStopActiveTasks: async () => events.push('stop-tasks'),
    stopBackend: async () => events.push('stop-backend'),
    stopManagedChrome: async () => events.push('stop-chrome'),
  })

  await controller.prepareForUpdateInstall()

  assert.deepEqual(events, ['stop-backend', 'stop-chrome'])
})

test('updater cleanup lets the next before-quit pass without duplicate cleanup', async () => {
  const events = []
  const prevented = []
  const controller = createLifecycleController({
    getActiveTasks: async () => { events.push('get-active'); return { active: true, tasks: [{}] } },
    confirmQuitWithActiveTasks: async () => events.push('confirm'),
    requestStopActiveTasks: async () => events.push('stop-tasks'),
    stopBackend: async () => events.push('stop-backend'),
    stopManagedChrome: async () => events.push('stop-chrome'),
    quitApp: () => events.push('quit'),
  })

  const prepared = await controller.prepareForUpdateInstall()
  const beforeQuit = await controller.handleBeforeQuit({
    preventDefault: () => prevented.push('prevented'),
  })

  assert.equal(prepared, true)
  assert.equal(beforeQuit, true)
  assert.deepEqual(prevented, [])
  assert.deepEqual(events, ['stop-backend', 'stop-chrome'])
})

test('updater cleanup failure resets shutdown state for a later normal quit', async () => {
  const events = []
  const controller = createLifecycleController({
    getActiveTasks: async () => { events.push('get-active'); return { active: false, tasks: [] } },
    stopBackend: async () => {
      events.push('stop-backend')
      if (events.length === 1) throw new Error('backend stop failed')
    },
    stopManagedChrome: async () => events.push('stop-chrome'),
    quitApp: () => events.push('quit'),
  })

  await assert.rejects(
    () => controller.prepareForUpdateInstall(),
    /backend stop failed/
  )
  await controller.handleBeforeQuit()

  assert.deepEqual(events, ['stop-backend', 'get-active', 'stop-backend', 'stop-chrome', 'quit'])
})
