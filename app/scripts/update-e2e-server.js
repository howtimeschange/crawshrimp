#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { URL } = require('node:url')

const PROVIDER = 'crawshrimp-update-e2e'

function parseArgs(argv = process.argv.slice(2)) {
  const args = { root: '', port: 0 }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--root') {
      args.root = argv[index + 1] || ''
      index += 1
      continue
    }
    if (value === '--port') {
      args.port = Number(argv[index + 1] || 0)
      index += 1
      continue
    }
    throw new Error(`unknown argument: ${value}`)
  }
  if (!args.root) throw new Error('usage: node scripts/update-e2e-server.js --root <artifact-directory> [--port <port>]')
  if (!Number.isInteger(args.port) || args.port < 0 || args.port > 65535) {
    throw new Error(`invalid port: ${args.port}`)
  }
  return args
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function sendText(response, statusCode, body, headers = {}) {
  const payload = Buffer.from(body, 'utf8')
  response.writeHead(statusCode, {
    'content-length': String(payload.length),
    ...headers,
  })
  response.end(payload)
}

function sendEmpty(response, statusCode, headers = {}) {
  response.writeHead(statusCode, headers)
  response.end()
}

function resolveRequestPath(root, rawUrl) {
  const rawPath = String(rawUrl || '').split(/[?#]/, 1)[0]
  if (/%2e/i.test(rawPath)) return { status: 403 }
  try {
    const decodedRawPath = decodeURIComponent(rawPath)
    const rawSegments = decodedRawPath.split('/').filter(Boolean)
    if (rawSegments.some(segment => segment === '..')) return { status: 403 }
  } catch {
    return { status: 400 }
  }

  let pathname
  try {
    pathname = new URL(rawUrl, 'http://127.0.0.1').pathname
  } catch {
    return { status: 400 }
  }

  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return { status: 400 }
  }

  const segments = decoded.split('/').filter(Boolean)
  if (segments.some(segment => segment === '..')) return { status: 403 }
  const target = path.resolve(root, ...segments)
  if (!isInside(root, target)) return { status: 403 }
  return { path: target }
}

function parseRange(header, size) {
  if (!header) return null
  const match = String(header).match(/^bytes=(\d*)-(\d*)$/)
  if (!match) return { unsatisfiable: true }

  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return { unsatisfiable: true }

  let start
  let end
  if (!rawStart) {
    const suffixLength = Number(rawEnd)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { unsatisfiable: true }
    start = Math.max(size - suffixLength, 0)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd ? Number(rawEnd) : size - 1
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    return { unsatisfiable: true }
  }
  return { start, end: Math.min(end, size - 1) }
}

async function startUpdateE2EServer({ root, port = 0 } = {}) {
  if (!root) throw new Error('root is required')
  const rootPath = fs.realpathSync.native(path.resolve(root))
  if (!fs.statSync(rootPath).isDirectory()) throw new Error(`root is not a directory: ${root}`)

  const server = http.createServer((request, response) => {
    if (request.url === '/health') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return sendEmpty(response, 405)
      const body = JSON.stringify({ ok: true, provider: PROVIDER })
      if (request.method === 'HEAD') {
        return sendEmpty(response, 200, {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
        })
      }
      return sendText(response, 200, body, { 'content-type': 'application/json' })
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') return sendEmpty(response, 405)

    const resolved = resolveRequestPath(rootPath, request.url || '/')
    if (resolved.status) return sendEmpty(response, resolved.status)

    let stat
    let realFile
    try {
      stat = fs.statSync(resolved.path)
      realFile = fs.realpathSync.native(resolved.path)
    } catch {
      return sendEmpty(response, 404)
    }
    if (!stat.isFile() || !isInside(rootPath, realFile)) return sendEmpty(response, stat.isDirectory() ? 404 : 403)

    const size = stat.size
    const range = parseRange(request.headers.range, size)
    if (range?.unsatisfiable) {
      return sendEmpty(response, 416, { 'content-range': `bytes */${size}` })
    }

    const commonHeaders = {
      'accept-ranges': 'bytes',
      'content-type': 'application/octet-stream',
    }
    if (range) {
      const contentLength = range.end - range.start + 1
      response.writeHead(206, {
        ...commonHeaders,
        'content-length': String(contentLength),
        'content-range': `bytes ${range.start}-${range.end}/${size}`,
      })
      if (request.method === 'HEAD') return response.end()
      return fs.createReadStream(realFile, { start: range.start, end: range.end }).pipe(response)
    }

    response.writeHead(200, {
      ...commonHeaders,
      'content-length': String(size),
    })
    if (request.method === 'HEAD') return response.end()
    return fs.createReadStream(realFile).pipe(response)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  const url = `http://127.0.0.1:${address.port}/`
  return {
    server,
    url,
    root: rootPath,
    close: () => new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve()))),
  }
}

async function main() {
  const args = parseArgs()
  const server = await startUpdateE2EServer(args)
  console.log(`${PROVIDER} listening on ${server.url}`)
}

if (require.main === module) {
  main().catch(error => {
    console.error(error?.message || error)
    process.exit(2)
  })
}

module.exports = { startUpdateE2EServer, parseArgs, parseRange }
