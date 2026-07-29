import assert from 'node:assert/strict'
import test from 'node:test'

import { buildUpstreamUrl, handleRequest, rewriteUpstreamJsonUrls } from '../src/index.js'

test('maps Crawshrimp /v1 image task paths to the 1XM upstream', () => {
  const url = new URL('https://proxy.example/t/token/v1/images/tasks?poll=1&proxy_token=hidden')
  const upstream = buildUpstreamUrl(url, '/v1/images/tasks', {})

  assert.equal(upstream.toString(), 'https://api.1xm.ai/v1/images/tasks?poll=1')
})

test('rewrites upstream poll URLs back to the proxy base', () => {
  const rewritten = rewriteUpstreamJsonUrls(
    {
      poll_url: 'https://api.1xm.ai/v1/images/tasks/task_1',
      nested: [{ pollUrl: 'https://api.1xm.ai/v1/images/tasks/task_2' }],
    },
    'https://api.1xm.ai/v1',
    'https://proxy.example/t/token/v1',
  )

  assert.equal(rewritten.poll_url, 'https://proxy.example/t/token/v1/images/tasks/task_1')
  assert.equal(rewritten.nested[0].pollUrl, 'https://proxy.example/t/token/v1/images/tasks/task_2')
})

test('rewrites allowed image URLs to the image proxy', () => {
  const rewritten = rewriteUpstreamJsonUrls(
    { data: [{ url: 'https://img.1xm.ai/generated/task_1.png?token=abc' }] },
    'https://api.1xm.ai/v1',
    'https://proxy.example/t/token/v1',
  )

  assert.equal(
    rewritten.data[0].url,
    'https://proxy.example/t/token/v1/proxy-image?url=https%3A%2F%2Fimg.1xm.ai%2Fgenerated%2Ftask_1.png%3Ftoken%3Dabc',
  )
})

test('rejects image proxy requests for non-1XM hosts', async () => {
  const response = await handleRequest(
    new Request('https://proxy.example/v1/proxy-image?url=https%3A%2F%2Fevil.example%2Fout.png'),
    {},
  )

  assert.equal(response.status, 403)
})

test('proxies allowed 1XM image downloads', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    assert.equal(input, 'https://img.1xm.ai/generated/task_1.png')
    assert.equal(init.method, 'GET')
    return new Response('image-bytes', {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': '11' },
    })
  }

  try {
    const response = await handleRequest(
      new Request('https://proxy.example/v1/proxy-image?url=https%3A%2F%2Fimg.1xm.ai%2Fgenerated%2Ftask_1.png'),
      {},
    )
    const body = await response.text()

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.equal(response.headers.get('x-one-xm-proxy-image'), '1')
    assert.equal(body, 'image-bytes')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('requires the optional proxy token before forwarding', async () => {
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = async () => {
    called = true
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json', 'content-length': '2' } })
  }
  try {
    const response = await handleRequest(
      new Request('https://proxy.example/v1/images/tasks', {
        method: 'POST',
        headers: { authorization: 'Bearer sk-probe' },
      }),
      { ONE_XM_PROXY_TOKEN: 'expected' },
    )

    assert.equal(response.status, 403)
    assert.equal(called, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('forwards requests and rewrites JSON task URLs', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => {
    calls.push({ input, init })
    assert.equal(input, 'https://api.1xm.ai/v1/images/tasks')
    assert.equal(init.method, 'POST')
    assert.equal(init.headers.get('authorization'), 'Bearer sk-upstream-secret')
    assert.equal(init.headers.get('idempotency-key'), 'job-1')
    return new Response(JSON.stringify({
      id: 'task_1',
      poll_url: 'https://api.1xm.ai/v1/images/tasks/task_1',
    }), {
      status: 202,
      headers: {
        'content-type': 'application/json',
        'content-length': '72',
      },
    })
  }

  try {
    const response = await handleRequest(
      new Request('https://proxy.example/t/expected/v1/images/tasks', {
        method: 'POST',
        headers: {
          authorization: 'Bearer sk-local-placeholder',
          'content-type': 'application/json',
          'idempotency-key': 'job-1',
        },
        body: JSON.stringify({ model: 'gpt-image-2', prompt: 'probe' }),
      }),
      {
        ONE_XM_PROXY_TOKEN: 'expected',
        ONE_XM_API_KEY: 'sk-upstream-secret',
      },
    )
    const body = await response.json()

    assert.equal(response.status, 202)
    assert.equal(calls.length, 1)
    assert.equal(body.poll_url, 'https://proxy.example/t/expected/v1/images/tasks/task_1')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rewrites JSON task URLs when upstream omits content-length', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'task_1',
    status: 'succeeded',
    data: [{ url: 'https://img.1xm.ai/generated/task_1.png' }],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })

  try {
    const response = await handleRequest(
      new Request('https://proxy.example/v1/images/tasks/task_1', {
        method: 'GET',
        headers: { authorization: 'Bearer sk-local' },
      }),
      {},
    )
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.data[0].url, 'https://proxy.example/v1/proxy-image?url=https%3A%2F%2Fimg.1xm.ai%2Fgenerated%2Ftask_1.png')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('passes through the local Authorization header when no Worker secret is configured', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_input, init) => {
    assert.equal(init.headers.get('authorization'), 'Bearer sk-local')
    return new Response('{}', { status: 401, headers: { 'content-type': 'application/json', 'content-length': '2' } })
  }

  try {
    const response = await handleRequest(
      new Request('https://proxy.example/v1/images/tasks', {
        method: 'POST',
        headers: { authorization: 'Bearer sk-local' },
      }),
      {},
    )

    assert.equal(response.status, 401)
  } finally {
    globalThis.fetch = originalFetch
  }
})
