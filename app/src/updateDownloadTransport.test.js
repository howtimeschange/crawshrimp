const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { CancellationError, CancellationToken } = require('builder-util-runtime')

const { installUpdateDownloadTransport } = require('./updateDownloadTransport')

class FakeRequest extends EventEmitter {
  constructor() {
    super()
    this.abortCalls = 0
  }

  abort() {
    this.abortCalls += 1
    this.emit('abort')
  }
}

class FakeResponse extends EventEmitter {}

function createTimerHarness() {
  let nextId = 0
  const active = new Set()
  const timers = []

  function setTimeoutFn(fn, ms) {
    const timer = {
      id: ++nextId,
      ms,
      fn,
      unrefCalls: 0,
      unref() { this.unrefCalls += 1 },
    }
    active.add(timer)
    timers.push(timer)
    return timer
  }

  function clearTimeoutFn(timer) {
    if (timer) active.delete(timer)
  }

  function fire(timer = timers[timers.length - 1]) {
    assert.ok(active.has(timer), 'timer should be active before firing')
    timer.fn()
  }

  return { active, timers, setTimeoutFn, clearTimeoutFn, fire }
}

function createExecutor() {
  const calls = []
  const executor = {
    addErrorAndTimeoutHandlers(request, reject, timeout) {
      calls.push({ request, reject, timeout })
      request.on('error', reject)
      request.on('aborted', () => reject(new Error('request aborted')))
    },
  }
  return { executor, calls, original: executor.addErrorAndTimeoutHandlers }
}

function createRejectRecorder() {
  const errors = []
  return {
    errors,
    reject(error) {
      errors.push(error)
    },
  }
}

function installHarness({ token = new CancellationToken(), timeoutMs = 120 } = {}) {
  const timers = createTimerHarness()
  const { executor, calls, original } = createExecutor()
  const timeouts = []
  const restore = installUpdateDownloadTransport({
    executor,
    getCancellationToken: () => token,
    inactivityTimeoutMs: timeoutMs,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onTimeout: (error, timedOutToken) => timeouts.push({ error, token: timedOutToken }),
  })
  return { executor, calls, original, restore, timers, token, timeouts }
}

test('header stall aborts the request, rejects, cancels the token, and clears the timer', () => {
  const harness = installHarness()
  const request = new FakeRequest()
  const reject = createRejectRecorder()

  harness.executor.addErrorAndTimeoutHandlers(request, reject.reject)
  assert.equal(harness.timers.active.size, 1)

  harness.timers.fire()

  assert.equal(request.abortCalls, 1)
  assert.equal(harness.timers.active.size, 0)
  assert.equal(harness.token.cancelled, true)
  assert.equal(harness.timeouts.length, 1)
  assert.equal(harness.timeouts[0].token, harness.token)
  assert.equal(reject.errors.length, 1)
  assert.equal(reject.errors[0].code, 'ERR_UPDATER_REQUEST_TIMEOUT')
})

test('body gap timeout is measured after the response starts', () => {
  const harness = installHarness()
  const request = new FakeRequest()
  const response = new FakeResponse()
  const reject = createRejectRecorder()

  harness.executor.addErrorAndTimeoutHandlers(request, reject.reject)
  const initialTimer = harness.timers.timers.at(-1)
  request.emit('response', response)
  const responseTimer = harness.timers.timers.at(-1)

  assert.notEqual(responseTimer, initialTimer)
  assert.equal(harness.timers.active.has(initialTimer), false)
  assert.equal(harness.timers.active.has(responseTimer), true)

  harness.timers.fire(responseTimer)

  assert.equal(request.abortCalls, 1)
  assert.equal(reject.errors.length, 1)
  assert.equal(reject.errors[0].code, 'ERR_UPDATER_REQUEST_TIMEOUT')
  assert.equal(harness.timers.active.size, 0)
})

test('response data resets the inactivity timer', () => {
  const harness = installHarness()
  const request = new FakeRequest()
  const response = new FakeResponse()
  const reject = createRejectRecorder()

  harness.executor.addErrorAndTimeoutHandlers(request, reject.reject)
  request.emit('response', response)
  const responseTimer = harness.timers.timers.at(-1)
  response.emit('data', Buffer.from('chunk'))
  const dataTimer = harness.timers.timers.at(-1)

  assert.notEqual(dataTimer, responseTimer)
  assert.equal(harness.timers.active.has(responseTimer), false)
  assert.equal(harness.timers.active.has(dataTimer), true)
  assert.deepEqual(reject.errors, [])

  harness.timers.fire(dataTimer)
  assert.equal(reject.errors[0].code, 'ERR_UPDATER_REQUEST_TIMEOUT')
})

test('response end clears the timer and leaves the request alone', () => {
  const harness = installHarness()
  const request = new FakeRequest()
  const response = new FakeResponse()
  const reject = createRejectRecorder()

  harness.executor.addErrorAndTimeoutHandlers(request, reject.reject)
  request.emit('response', response)
  response.emit('end')

  assert.equal(harness.timers.active.size, 0)
  assert.equal(request.abortCalls, 0)
  assert.deepEqual(reject.errors, [])
})

test('request abort from a manual redirect only clears this request timeout', () => {
  const harness = installHarness()
  const request = new FakeRequest()
  const reject = createRejectRecorder()

  harness.executor.addErrorAndTimeoutHandlers(request, reject.reject)
  request.emit('abort')

  assert.equal(harness.timers.active.size, 0)
  assert.equal(request.abortCalls, 0)
  assert.equal(harness.token.cancelled, false)
  assert.deepEqual(reject.errors, [])
})

test('token cancellation after response end does not abort a completed request', () => {
  const harness = installHarness()
  const request = new FakeRequest()
  const response = new FakeResponse()
  const reject = createRejectRecorder()

  harness.executor.addErrorAndTimeoutHandlers(request, reject.reject)
  request.emit('response', response)
  response.emit('end')
  harness.token.cancel()

  assert.equal(harness.timers.active.size, 0)
  assert.equal(request.abortCalls, 0)
  assert.deepEqual(reject.errors, [])
})

test('request and response errors or aborts clear transport timers', () => {
  for (const trigger of ['request-error', 'request-aborted', 'response-error', 'response-aborted']) {
    const harness = installHarness()
    const request = new FakeRequest()
    const response = new FakeResponse()
    const reject = createRejectRecorder()

    harness.executor.addErrorAndTimeoutHandlers(request, reject.reject)
    if (trigger.startsWith('response')) request.emit('response', response)

    if (trigger === 'request-error') request.emit('error', new Error('network'))
    if (trigger === 'request-aborted') request.emit('aborted')
    if (trigger === 'response-error') response.emit('error', new Error('body'))
    if (trigger === 'response-aborted') response.emit('aborted')

    assert.equal(harness.timers.active.size, 0, trigger)
  }
})

test('token cancellation aborts the active request and rejects with CancellationError', () => {
  const harness = installHarness()
  const request = new FakeRequest()
  const reject = createRejectRecorder()

  harness.executor.addErrorAndTimeoutHandlers(request, reject.reject)
  harness.token.cancel()

  assert.equal(request.abortCalls, 1)
  assert.equal(harness.timers.active.size, 0)
  assert.equal(reject.errors.length, 1)
  assert.ok(reject.errors[0] instanceof CancellationError)
})

test('dispose restores the executor, cancels pending requests, and leaves no timers', () => {
  const harness = installHarness()
  const first = new FakeRequest()
  const second = new FakeRequest()
  const firstReject = createRejectRecorder()
  const secondReject = createRejectRecorder()

  harness.executor.addErrorAndTimeoutHandlers(first, firstReject.reject)
  harness.executor.addErrorAndTimeoutHandlers(second, secondReject.reject)
  assert.notEqual(harness.executor.addErrorAndTimeoutHandlers, harness.original)

  harness.restore()

  assert.equal(harness.executor.addErrorAndTimeoutHandlers, harness.original)
  assert.equal(first.abortCalls, 1)
  assert.equal(second.abortCalls, 1)
  assert.equal(harness.timers.active.size, 0)
  assert.ok(firstReject.errors[0] instanceof CancellationError)
  assert.ok(secondReject.errors[0] instanceof CancellationError)
})

test('copy-only phases with no active request do not create transport timeouts', () => {
  const harness = installHarness()

  assert.equal(harness.timers.active.size, 0)
  assert.equal(harness.timers.timers.length, 0)

  harness.restore()
  assert.equal(harness.timers.active.size, 0)
})

test('requests without a cancellation token still time out and clean up', () => {
  const harness = installHarness({ token: null })
  const request = new FakeRequest()
  const reject = createRejectRecorder()

  harness.executor.addErrorAndTimeoutHandlers(request, reject.reject)
  harness.timers.fire()

  assert.equal(request.abortCalls, 1)
  assert.equal(harness.timers.active.size, 0)
  assert.equal(harness.timeouts.length, 1)
  assert.equal(harness.timeouts[0].token, null)
  assert.equal(reject.errors[0].code, 'ERR_UPDATER_REQUEST_TIMEOUT')
})
