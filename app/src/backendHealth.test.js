'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { once } = require('node:events')

const { requestBackendHealth } = require('./backendHealth')

async function withServer(handler, run) {
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    return await run(server.address().port)
  } finally {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
}

test('backend health probe has a total deadline even when a responder trickles forever', async () => {
  assert.equal(typeof requestBackendHealth, 'function', 'bounded backend health probe must exist')
  const timers = []
  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    timers.push(setInterval(() => res.write(' '), 5))
  }, async port => {
    const startedAt = Date.now()
    const result = await requestBackendHealth({ http, port, timeoutMs: 25 })
    timers.forEach(clearInterval)

    assert.equal(result.ok, false)
    assert.equal(result.errorCode, 'ETIMEDOUT')
    assert.ok(Date.now() - startedAt < 150, 'total deadline must not be reset by response activity')
  })
})

test('backend health probe rejects oversized response bodies', async () => {
  assert.equal(typeof requestBackendHealth, 'function', 'bounded backend health probe must exist')
  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ value: 'x'.repeat(2048) }))
  }, async port => {
    const result = await requestBackendHealth({ http, port, timeoutMs: 200, maxBodyBytes: 1024 })

    assert.equal(result.ok, false)
    assert.equal(result.errorCode, 'ERR_RESPONSE_TOO_LARGE')
  })
})

test('backend health probe returns parsed runtime data for a bounded valid response', async () => {
  assert.equal(typeof requestBackendHealth, 'function', 'bounded backend health probe must exist')
  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', runtime: { backend_instance_id: 'desktop-1' } }))
  }, async port => {
    const result = await requestBackendHealth({ http, port, timeoutMs: 200 })

    assert.equal(result.ok, true)
    assert.equal(result.statusCode, 200)
    assert.equal(result.data.runtime.backend_instance_id, 'desktop-1')
  })
})
