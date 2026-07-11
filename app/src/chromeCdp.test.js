'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { once } = require('node:events')

const { probeChromeCdp, prepareChromeRecovery } = require('./chromeCdp')

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

test('CDP probe requires valid version and tab endpoints', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    if (req.url === '/json/version') {
      res.end(JSON.stringify({ Browser: 'Chrome/140', 'Protocol-Version': '1.3' }))
    } else {
      res.end(JSON.stringify([{ id: 'tab-1', type: 'page' }]))
    }
  }, async port => {
    const result = await probeChromeCdp({ http, port, timeoutMs: 100 })
    assert.equal(result.kind, 'ready')
    assert.equal(result.ok, true)
    assert.equal(result.browser, 'Chrome/140')
  })
})

test('CDP probe classifies HTTP 404 as an occupied non-CDP port', async () => {
  await withServer((_req, res) => {
    res.writeHead(404)
    res.end('Not Found')
  }, async port => {
    const result = await probeChromeCdp({ http, port, timeoutMs: 100 })
    assert.equal(result.kind, 'occupied-non-cdp')
    assert.equal(result.ok, false)
    assert.match(result.message, /端口被其他服务占用/)
  })
})

test('CDP probe classifies one valid endpoint as partial CDP', async () => {
  await withServer((req, res) => {
    res.writeHead(req.url === '/json/version' ? 200 : 404, { 'Content-Type': 'application/json' })
    res.end(req.url === '/json/version' ? JSON.stringify({ Browser: 'Chrome/140' }) : '{}')
  }, async port => {
    const result = await probeChromeCdp({ http, port, timeoutMs: 100 })
    assert.equal(result.kind, 'partial-cdp')
  })
})

test('CDP probe classifies malformed successful payloads', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{broken')
  }, async port => {
    const result = await probeChromeCdp({ http, port, timeoutMs: 100 })
    assert.equal(result.kind, 'invalid-cdp')
  })
})

test('CDP probe classifies a closed port as connection refused', async () => {
  const server = http.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))

  const result = await probeChromeCdp({ http, port, timeoutMs: 100 })
  assert.equal(result.kind, 'connection-refused')
})

test('CDP probe classifies endpoints that do not answer as timeout', async () => {
  await withServer(() => {}, async port => {
    const result = await probeChromeCdp({ http, port, timeoutMs: 20 })
    assert.equal(result.kind, 'timeout')
  })
})

test('Chrome recovery never stops or launches into a non-CDP occupied port', async () => {
  let stops = 0
  let reprobes = 0
  const diagnostic = { ok: false, kind: 'occupied-non-cdp', message: 'occupied' }

  const result = await prepareChromeRecovery({
    diagnostic,
    stopManagedChrome: async () => {
      stops += 1
      return { stopped: true }
    },
    probeCdp: async () => {
      reprobes += 1
      return { ok: false, kind: 'connection-refused' }
    },
  })

  assert.equal(result.action, 'blocked')
  assert.equal(stops, 0)
  assert.equal(reprobes, 0)
})

test('Chrome recovery reprobes after stopping a verified managed partial CDP instance', async () => {
  let reprobes = 0
  const result = await prepareChromeRecovery({
    diagnostic: { ok: false, kind: 'partial-cdp', message: 'partial' },
    stopManagedChrome: async () => ({ stopped: true, reason: 'stopped' }),
    probeCdp: async () => {
      reprobes += 1
      return { ok: false, kind: 'connection-refused', message: 'closed' }
    },
  })

  assert.equal(result.action, 'launch')
  assert.equal(result.diagnostic.kind, 'connection-refused')
  assert.equal(reprobes, 1)
})

test('Chrome recovery blocks a partial responder when no managed process was stopped', async () => {
  const result = await prepareChromeRecovery({
    diagnostic: { ok: false, kind: 'partial-cdp', message: 'partial' },
    stopManagedChrome: async () => ({ stopped: false, reason: 'no-state' }),
    probeCdp: async () => assert.fail('must not re-probe without a stopped managed process'),
  })

  assert.equal(result.action, 'blocked')
  assert.equal(result.code, 'CDP_PORT_OCCUPIED')
})

test('Chrome recovery does not launch into a timed-out unknown responder', async () => {
  const result = await prepareChromeRecovery({
    diagnostic: { ok: false, kind: 'timeout', message: 'timeout' },
    stopManagedChrome: async () => ({ stopped: false, reason: 'no-state' }),
    probeCdp: async () => assert.fail('must not re-probe without a stopped managed process'),
  })

  assert.equal(result.action, 'blocked')
  assert.equal(result.code, 'CDP_PORT_OCCUPIED')
})
