'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { once } = require('node:events')

const { requestBackendApi } = require('./backendApi')

async function withServer(handler, callback) {
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const { port } = server.address()
    return await callback(port)
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  }
}

function callBackend(port, urlPath) {
  return requestBackendApi({
    http,
    port,
    token: 'test-token',
    tokenHeader: 'X-Crawshrimp-Token',
    method: 'GET',
    urlPath,
    options: { ensureReady: false },
  })
}

test('requestBackendApi resolves successful JSON responses', async () => {
  await withServer((req, res) => {
    assert.equal(req.headers['x-crawshrimp-token'], 'test-token')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  }, async (port) => {
    assert.deepEqual(await callBackend(port, '/ok'), { ok: true })
  })
})

test('requestBackendApi rejects 409 responses with backend detail', async () => {
  await withServer((_req, res) => {
    res.writeHead(409, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ detail: '任务正在运行中，请先暂停/继续/停止当前任务' }))
  }, async (port) => {
    await assert.rejects(
      () => callBackend(port, '/task-instances/instance-2/run'),
      (error) => {
        assert.equal(error.statusCode, 409)
        assert.equal(error.message, '任务正在运行中，请先暂停/继续/停止当前任务')
        assert.deepEqual(error.response, { detail: '任务正在运行中，请先暂停/继续/停止当前任务' })
        return true
      }
    )
  })
})

test('requestBackendApi rejects 404 responses with backend message', async () => {
  await withServer((_req, res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: 'Task schedule not found' }))
  }, async (port) => {
    await assert.rejects(
      () => callBackend(port, '/task-schedules/missing/run-now'),
      (error) => {
        assert.equal(error.statusCode, 404)
        assert.equal(error.message, 'Task schedule not found')
        assert.deepEqual(error.response, { message: 'Task schedule not found' })
        return true
      }
    )
  })
})

test('requestBackendApi preserves structured AI video error messages', async () => {
  await withServer((_req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      detail: {
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Prompt 不能为空',
          detail: null,
        },
      },
    }))
  }, async (port) => {
    await assert.rejects(
      () => callBackend(port, '/ai-video/validate'),
      (error) => {
        assert.equal(error.statusCode, 400)
        assert.equal(error.message, 'Prompt 不能为空')
        assert.equal(error.code, 'VALIDATION_FAILED')
        return true
      }
    )
  })
})

test('backend requests read the endpoint and matching credential after every readiness check', async () => {
  let attempts = 0
  await withServer((req, res) => {
    assert.equal(req.headers['x-crawshrimp-token'], 'second-token')
    res.end('{"server":2}')
  }, async secondPort => {
    await withServer((_req, res) => {
      assert.fail('A request reached the pre-readiness endpoint')
      res.end()
    }, async oldPort => {
      let connection = { port: oldPort, token: 'old-token' }
      const probe = http.createServer()
      probe.listen(0, '127.0.0.1')
      await once(probe, 'listening')
      const firstPort = probe.address().port
      await new Promise(resolve => probe.close(resolve))
      const result = await requestBackendApi({
        http, getConnection: () => connection, tokenHeader: 'X-Crawshrimp-Token', method: 'GET', urlPath: '/settings',
        options: { retries: 1 },
        runWhenReady: async (operation, { retryableCodes }) => {
          connection = { port: firstPort, token: 'first-token' }
          attempts += 1
          await assert.rejects(operation, error => retryableCodes.has(error.code))
          connection = { port: secondPort, token: 'second-token' }
          attempts += 1
          return operation()
        },
      })
      assert.deepEqual(result, { server: 2 })
      assert.equal(attempts, 2)
    })
  })
})

test('backend requests settle when a server drops a partial response or never finishes it', async () => {
  for (const disconnect of [true, false]) {
    await withServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"partial":')
      if (disconnect) setTimeout(() => res.destroy(), 15)
    }, async port => {
      await assert.rejects(requestBackendApi({
        http, port, token: 'test-token', tokenHeader: 'X-Crawshrimp-Token',
        method: 'POST', urlPath: '/operation', options: { ensureReady: false, timeoutMs: 200 },
      }), { code: disconnect ? 'ERR_BACKEND_RESPONSE_INTERRUPTED' : 'ETIMEDOUT' })
    })
  }
})
