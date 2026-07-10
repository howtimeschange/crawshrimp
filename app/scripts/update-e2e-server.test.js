const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const { startUpdateE2EServer } = require('./update-e2e-server')

async function withServer(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-update-e2e-'))
  fs.writeFileSync(path.join(root, 'latest.yml'), 'version: 2.0.1\n', 'utf8')
  fs.writeFileSync(path.join(root, 'asset.bin'), Buffer.from('0123456789abcdef', 'utf8'))

  const server = await startUpdateE2EServer({ root, port: 0 })
  t.after(async () => {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
  return server
}

async function request(server, pathname, options = {}) {
  const target = new URL(server.url)
  const { statusCode, headers, body } = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: pathname,
      method: options.method || 'GET',
      headers: options.headers,
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }))
    })
    req.on('error', reject)
    req.end()
  })
  return {
    response: {
      status: statusCode,
      headers: { get: name => headers[String(name).toLowerCase()] || null },
    },
    text: body.toString('utf8'),
    bytes: body,
  }
}

test('local update e2e server reports health on loopback', async t => {
  const server = await withServer(t)

  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/)
  const { response, text } = await request(server, '/health')

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/json')
  assert.deepEqual(JSON.parse(text), { ok: true, provider: 'crawshrimp-update-e2e' })
})

test('local update e2e server serves full assets and HEAD metadata', async t => {
  const server = await withServer(t)

  const get = await request(server, '/asset.bin')
  assert.equal(get.response.status, 200)
  assert.equal(get.response.headers.get('content-length'), '16')
  assert.equal(get.text, '0123456789abcdef')

  const head = await request(server, '/asset.bin', { method: 'HEAD' })
  assert.equal(head.response.status, 200)
  assert.equal(head.response.headers.get('content-length'), '16')
  assert.equal(head.bytes.length, 0)
})

test('local update e2e server supports single byte ranges', async t => {
  const server = await withServer(t)

  const partial = await request(server, '/asset.bin', { headers: { range: 'bytes=4-7' } })

  assert.equal(partial.response.status, 206)
  assert.equal(partial.response.headers.get('content-range'), 'bytes 4-7/16')
  assert.equal(partial.response.headers.get('content-length'), '4')
  assert.equal(partial.text, '4567')
})

test('local update e2e server rejects malformed and unsatisfiable ranges', async t => {
  const server = await withServer(t)

  const malformed = await request(server, '/asset.bin', { headers: { range: 'bytes=abc' } })
  assert.equal(malformed.response.status, 416)
  assert.equal(malformed.response.headers.get('content-range'), 'bytes */16')

  const unsatisfiable = await request(server, '/asset.bin', { headers: { range: 'bytes=999-1000' } })
  assert.equal(unsatisfiable.response.status, 416)
  assert.equal(unsatisfiable.response.headers.get('content-range'), 'bytes */16')
})

test('local update e2e server rejects encoded traversal and missing files', async t => {
  const server = await withServer(t)

  const traversal = await request(server, '/%2e%2e/package.json')
  assert.equal(traversal.response.status, 403)
  const plainTraversal = await request(server, '/../package.json')
  assert.equal(plainTraversal.response.status, 403)

  const missing = await request(server, '/missing.yml')
  assert.equal(missing.response.status, 404)
})

test('local update e2e server CLI starts and closes cleanly', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-update-e2e-cli-'))
  fs.writeFileSync(path.join(root, 'latest.yml'), 'version: 2.0.1\n', 'utf8')
  const child = require('node:child_process').spawn(process.execPath, [
    path.join(__dirname, 'update-e2e-server.js'),
    '--root',
    root,
    '--port',
    '0',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => {
    child.kill()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const [chunk] = await once(child.stdout, 'data')
  assert.match(String(chunk), /crawshrimp-update-e2e listening on http:\/\/127\.0\.0\.1:\d+\//)
})
