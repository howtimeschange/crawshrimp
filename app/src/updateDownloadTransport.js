'use strict'

const { CancellationError } = require('builder-util-runtime')

// Electron net.ClientRequest has no `socket` event. The updater's socket-based
// timeout therefore does not cover it, and stalled differential requests also
// need explicit cancellation before a retry can start.
function installUpdateDownloadTransport({
  executor,
  getCancellationToken = () => null,
  onTimeout = () => {},
  inactivityTimeoutMs = 120_000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  if (typeof executor?.addErrorAndTimeoutHandlers !== 'function') return () => {}
  const original = executor.addErrorAndTimeoutHandlers
  const pending = new Set()
  const timeoutMs = Number(inactivityTimeoutMs)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid update request timeout')

  function guardedHandlers(request, reject, upstreamTimeout) {
    original.call(this, request, reject, upstreamTimeout)
    const token = getCancellationToken()
    let timer = null
    let response = null
    let finished = false

    function cleanup() {
      if (finished) return
      finished = true
      clearTimeoutFn(timer)
      pending.delete(cancel)
      token?.removeListener('cancel', cancel)
      request.removeListener('response', onResponse)
      request.removeListener('error', cleanup)
      request.removeListener('aborted', cleanup)
      request.removeListener('abort', onAbort)
      response?.removeListener('data', resetTimer)
      response?.removeListener('end', cleanup)
      response?.removeListener('error', cleanup)
      response?.removeListener('aborted', cleanup)
    }

    function fail(error, timedOut = false) {
      if (finished) return
      cleanup()
      if (timedOut) {
        onTimeout(error, token)
        token?.cancel()
      }
      // Abort before rejecting, so the upstream download promise can clean up
      // its files and downloadPromise before the caller is allowed to retry.
      try { request.abort() } finally { reject(error) }
    }

    function cancel() { fail(new CancellationError()) }
    // The executor also aborts requests when following a manual redirect.
    // Only token cancellation should reject; a redirect abort just cleans up
    // this request's timer while the executor continues with the next request.
    function onAbort() { cleanup() }
    function resetTimer() {
      if (finished) return
      clearTimeoutFn(timer)
      timer = setTimeoutFn(() => {
        const error = new Error(`更新下载连接超过 ${Math.ceil(timeoutMs / 1000)} 秒未收到数据，请重试或下载安装包。`)
        error.code = 'ERR_UPDATER_REQUEST_TIMEOUT'
        fail(error, true)
      }, timeoutMs)
      timer?.unref?.()
    }

    function onResponse(incoming) {
      if (finished) return
      response = incoming
      response.on('data', resetTimer)
      response.once('end', cleanup)
      response.once('error', cleanup)
      response.once('aborted', cleanup)
      resetTimer()
    }

    pending.add(cancel)
    request.once('response', onResponse)
    request.once('error', cleanup)
    request.once('aborted', cleanup)
    request.once('abort', onAbort)
    resetTimer()
    token?.onCancel(cancel)
  }

  executor.addErrorAndTimeoutHandlers = guardedHandlers
  return () => {
    for (const cancel of [...pending]) cancel()
    if (executor.addErrorAndTimeoutHandlers === guardedHandlers) {
      executor.addErrorAndTimeoutHandlers = original
    }
  }
}

module.exports = { installUpdateDownloadTransport }
