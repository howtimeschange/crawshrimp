'use strict'

const DEFAULT_MAX_BODY_BYTES = 256 * 1024

function requestBackendHealth({ http, port, timeoutMs = 800, maxBodyBytes = DEFAULT_MAX_BODY_BYTES }) {
  if (!http || typeof http.request !== 'function') throw new TypeError('http.request is required')

  return new Promise(resolve => {
    let settled = false
    let deadlineTimer = null
    let req = null
    const deadlineMs = Math.max(1, Number(timeoutMs || 800))
    const bodyLimit = Math.max(1, Number(maxBodyBytes || DEFAULT_MAX_BODY_BYTES))

    const finish = result => {
      if (settled) return false
      settled = true
      if (deadlineTimer) clearTimeout(deadlineTimer)
      resolve(result)
      return true
    }

    req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/health?probe=1',
      method: 'GET',
      timeout: deadlineMs,
    }, res => {
      let body = ''
      let bodyBytes = 0
      const statusCode = Number(res.statusCode || 0)

      if (statusCode !== 200) {
        finish({ ok: false, statusCode, error: `HTTP ${statusCode || 'error'}`, errorCode: 'ERR_HTTP_STATUS' })
        res.destroy()
        return
      }

      res.on('data', chunk => {
        bodyBytes += Buffer.byteLength(chunk)
        if (bodyBytes > bodyLimit) {
          if (finish({
            ok: false,
            statusCode,
            error: `response exceeds ${bodyLimit} bytes`,
            errorCode: 'ERR_RESPONSE_TOO_LARGE',
          })) res.destroy()
          return
        }
        body += chunk
      })
      res.on('end', () => {
        try {
          finish({ ok: true, statusCode, data: JSON.parse(body || '{}') })
        } catch (error) {
          finish({ ok: false, statusCode, error: error.message, errorCode: 'ERR_INVALID_JSON' })
        }
      })
      res.on('aborted', () => finish({
        ok: false,
        statusCode,
        error: 'response aborted',
        errorCode: 'ECONNRESET',
      }))
      res.on('error', error => finish({
        ok: false,
        statusCode,
        error: error.message,
        errorCode: error.code || '',
      }))
    })

    req.on('error', error => finish({
      ok: false,
      statusCode: 0,
      error: error.message,
      errorCode: error.code || '',
    }))
    req.on('timeout', () => {
      if (finish({ ok: false, statusCode: 0, error: 'timeout', errorCode: 'ETIMEDOUT' })) req.destroy()
    })
    deadlineTimer = setTimeout(() => {
      if (finish({ ok: false, statusCode: 0, error: 'timeout', errorCode: 'ETIMEDOUT' })) req.destroy()
    }, deadlineMs)
    req.end()
  })
}

module.exports = { requestBackendHealth }
