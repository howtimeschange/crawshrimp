'use strict'

function parsePayload(data) {
  try { return JSON.parse(data) } catch { return data }
}

function backendErrorFromResponse(statusCode, statusMessage, payload) {
  const detail = payload && typeof payload === 'object'
    ? (payload.detail || payload.error || payload.message)
    : ''
  const fallback = typeof payload === 'string' && payload.trim()
    ? payload
    : (statusMessage || `HTTP ${statusCode}`)
  const error = new Error(detail || fallback)
  error.statusCode = statusCode
  error.response = payload
  return error
}

function requestBackendApi({
  http,
  port,
  token,
  tokenHeader,
  method,
  urlPath,
  body = null,
  options = {},
  runWhenReady,
  describeFailure,
}) {
  const retries = Math.max(0, Number(options.retries || 0))
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs || 0))
  const timeoutMs = Math.max(0, Number(options.timeoutMs || 0))

  const doRequest = () => new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null
    const opts = {
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        [tokenHeader]: token,
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }
    const req = http.request(opts, (res) => {
      let data = ''
      res.on('data', d => data += d)
      res.on('end', () => {
        const statusCode = Number(res.statusCode || 0)
        const payload = parsePayload(data)
        if (statusCode >= 400) {
          reject(backendErrorFromResponse(statusCode, res.statusMessage, payload))
          return
        }
        resolve(payload)
      })
    })
    req.on('error', reject)
    if (timeoutMs > 0) {
      req.setTimeout(timeoutMs, () => {
        const error = new Error(`Request timed out after ${timeoutMs}ms`)
        error.code = 'ETIMEDOUT'
        req.destroy(error)
      })
    }
    if (bodyStr) req.write(bodyStr)
    req.end()
  })

  const retryableCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'EPIPE'])

  if (options.ensureReady === false || typeof runWhenReady !== 'function') {
    return doRequest()
  }

  return runWhenReady(doRequest, {
    retries,
    retryDelayMs,
    retryableCodes,
    describeFailure,
  })
}

module.exports = {
  requestBackendApi,
  backendErrorFromResponse,
}
