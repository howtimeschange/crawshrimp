import test from 'node:test'
import assert from 'node:assert/strict'
import { createUpdateActionRunner } from './updateActions.js'

test('single-flight update actions share one in-flight promise and busy transitions', async () => {
  let resolveAction
  let calls = 0
  const busyStates = []
  const runner = createUpdateActionRunner({
    setBusy: value => busyStates.push(value),
    handleError: () => assert.fail('unexpected error handler call'),
  })
  const action = () => {
    calls += 1
    return new Promise(resolve => {
      resolveAction = resolve
    })
  }

  const first = runner.run(action)
  const second = runner.run(action)
  assert.equal(calls, 1)
  assert.equal(first, second)

  resolveAction({ status: 'available' })
  assert.deepEqual(await second, { status: 'available' })
  assert.deepEqual(busyStates, [true, false])
})

test('rejected update action is consumed and routed to error handler', async () => {
  const handled = []
  const runner = createUpdateActionRunner({
    setBusy: () => {},
    handleError: (error, latestStatus) => {
      handled.push({ message: error.message, latestStatus })
    },
    getLatestStatus: async () => ({ status: 'up-to-date', currentVersion: '2.0.0' }),
  })

  const result = await runner.run(async () => {
    throw new Error('network down')
  })

  assert.equal(result, null)
  assert.deepEqual(handled, [
    {
      message: 'network down',
      latestStatus: { status: 'up-to-date', currentVersion: '2.0.0' },
    },
  ])
})

test('error handler failures do not reject the shared action promise', async () => {
  const runner = createUpdateActionRunner({
    setBusy: () => {},
    handleError: () => {
      throw new Error('handler failed')
    },
  })

  const result = await runner.run(async () => {
    throw new Error('download failed')
  })

  assert.equal(result, null)
})
