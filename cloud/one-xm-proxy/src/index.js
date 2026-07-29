const DEFAULT_UPSTREAM_BASE_URL = 'https://api.1xm.ai/v1'
const DEFAULT_MAX_JSON_REWRITE_BYTES = 1024 * 1024
const DEFAULT_IMAGE_PROXY_HOSTS = ['img.1xm.ai']

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const WEBSOCKET_FORWARD_HEADERS = new Set([
  'accept-language',
  'authorization',
  'cache-control',
  'cookie',
  'origin',
  'pragma',
  'sec-websocket-extensions',
  'sec-websocket-key',
  'sec-websocket-protocol',
  'sec-websocket-version',
  'upgrade',
  'user-agent',
])

const ALLOWED_METHODS = new Set(['GET', 'POST', 'HEAD', 'OPTIONS'])

export default {
  async fetch(request, env) {
    return handleRequest(request, env)
  },
}

export async function handleRequest(request, env = {}) {
  const url = new URL(request.url)
  const route = parseProxyRoute(url.pathname)

  if (route.path === '/health' && request.method === 'GET') {
    return jsonResponse({
      ok: true,
      service: 'crawshrimp-one-xm-proxy',
      upstream: upstreamBaseUrl(env),
      auth_mode: stringValue(env.ONE_XM_API_KEY) ? 'worker-secret' : 'pass-through',
      token_required: Boolean(stringValue(env.ONE_XM_PROXY_TOKEN)),
    })
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) })
  }

  if (route.path === '/v1/proxy-image' || route.path === '/proxy-image') {
    if (!(await isAuthorizedProxyRequest(request, url, route, env))) {
      return jsonError(403, 'Invalid 1XM proxy token.', request, env)
    }
    return proxyImage(request, url, env)
  }

  if (!ALLOWED_METHODS.has(request.method)) {
    return jsonError(405, 'Method not allowed', request, env)
  }

  if (!isAllowedOneXmPath(route.path)) {
    return jsonError(404, 'Only 1XM image task endpoints are proxied.', request, env)
  }

  if (!(await isAuthorizedProxyRequest(request, url, route, env))) {
    return jsonError(403, 'Invalid 1XM proxy token.', request, env)
  }

  const authorization = upstreamAuthorization(request, env)
  if (!authorization) {
    return jsonError(401, 'Missing Authorization header or ONE_XM_API_KEY secret.', request, env)
  }

  const upstreamUrl = buildUpstreamUrl(url, route.path, env)

  if (isWebSocketRequest(request)) {
    return proxyWebSocket(request, upstreamUrl, authorization, request, env)
  }

  return proxyHttp(request, upstreamUrl, route, authorization, env)
}

export function buildUpstreamUrl(requestUrl, proxyPath, env = {}) {
  const upstream = new URL(upstreamBaseUrl(env))
  const pathWithoutVersion = proxyPath === '/v1'
    ? '/'
    : proxyPath.startsWith('/v1/')
      ? proxyPath.slice('/v1'.length)
      : proxyPath
  upstream.pathname = joinPaths(upstream.pathname, pathWithoutVersion)
  upstream.search = requestUrl.search
  upstream.searchParams.delete('proxy_token')
  return upstream
}

export function rewriteUpstreamJsonUrls(value, upstreamBase, publicBase, env = {}) {
  if (typeof value === 'string') {
    const normalizedUpstream = stripTrailingSlash(upstreamBase)
    if (value.startsWith(`${normalizedUpstream}/`)) {
      return `${stripTrailingSlash(publicBase)}${value.slice(normalizedUpstream.length)}`
    }
    if (isAllowedImageUrl(value, env)) {
      return `${stripTrailingSlash(publicBase)}/proxy-image?url=${encodeURIComponent(value)}`
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteUpstreamJsonUrls(item, upstreamBase, publicBase, env))
  }
  if (value && typeof value === 'object') {
    const rewritten = {}
    for (const [key, item] of Object.entries(value)) {
      rewritten[key] = rewriteUpstreamJsonUrls(item, upstreamBase, publicBase, env)
    }
    return rewritten
  }
  return value
}

async function proxyHttp(request, upstreamUrl, route, authorization, env) {
  const upstreamResponse = await fetch(upstreamUrl.toString(), {
    method: request.method,
    headers: upstreamHeaders(request, authorization),
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  })

  return rewriteJsonResponseIfSmall(upstreamResponse, request, route, env)
}

async function proxyWebSocket(request, upstreamUrl, authorization, originalRequest, env) {
  const upstreamResponse = await fetch(upstreamUrl.toString(), {
    method: request.method,
    headers: upstreamHeaders(request, authorization, { webSocket: true }),
    body: request.body,
    redirect: 'manual',
  })

  if (upstreamResponse.status !== 101) {
    const status = upstreamResponse.status || 502
    const text = await upstreamResponse.text().catch(() => '')
    return jsonError(502, `Upstream WebSocket upgrade failed: ${status}${text ? ` ${text.slice(0, 240)}` : ''}`, originalRequest, env)
  }
  return upstreamResponse
}

async function rewriteJsonResponseIfSmall(response, request, route, env) {
  const headers = responseHeaders(response.headers, request, env)
  const contentType = response.headers.get('content-type') || ''
  const contentLengthHeader = response.headers.get('content-length')
  const contentLength = Number(contentLengthHeader || 0)
  const maxBytes = numberFromEnv(env.MAX_JSON_REWRITE_BYTES, DEFAULT_MAX_JSON_REWRITE_BYTES, 1024, 5 * 1024 * 1024)

  if (
    response.body
    && contentType.toLowerCase().includes('application/json')
    && (!contentLengthHeader || (Number.isFinite(contentLength) && contentLength <= maxBytes))
  ) {
    const text = await response.text()
    try {
      const rewritten = rewriteUpstreamJsonUrls(
        JSON.parse(text),
        upstreamBaseUrl(env),
        publicBaseUrl(request.url, route),
        env,
      )
      headers.set('content-type', 'application/json; charset=utf-8')
      headers.delete('content-length')
      return new Response(JSON.stringify(rewritten), {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    } catch {
      headers.delete('content-length')
      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function parseProxyRoute(pathname) {
  const match = pathname.match(/^\/t\/([^/]+)(\/.*)?$/)
  if (!match) return { token: '', path: pathname || '/' }
  return {
    token: decodeURIComponent(match[1] || ''),
    path: match[2] || '/',
  }
}

async function proxyImage(request, url, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonError(405, 'Image proxy only supports GET and HEAD.', request, env)
  }

  const target = stringValue(url.searchParams.get('url'))
  if (!isAllowedImageUrl(target, env)) {
    return jsonError(403, 'Image URL is not allowed for this proxy.', request, env)
  }

  const imageRequestHeaders = new Headers()
  imageRequestHeaders.set('user-agent', request.headers.get('user-agent') || 'crawshrimp-one-xm-proxy/1.0')
  imageRequestHeaders.set('accept', request.headers.get('accept') || 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8')
  const range = request.headers.get('range')
  if (range) imageRequestHeaders.set('range', range)

  const response = await fetch(target, {
    method: request.method,
    headers: imageRequestHeaders,
    redirect: 'follow',
  })
  const headers = responseHeaders(response.headers, request, env)
  headers.set('x-one-xm-proxy-image', '1')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function isAllowedOneXmPath(pathname) {
  return (
    pathname === '/images/tasks'
    || pathname.startsWith('/images/tasks/')
    || pathname === '/v1/images/tasks'
    || pathname.startsWith('/v1/images/tasks/')
  )
}

async function isAuthorizedProxyRequest(request, url, route, env) {
  const expected = stringValue(env.ONE_XM_PROXY_TOKEN)
  if (!expected) return true
  const supplied = stringValue(
    request.headers.get('x-one-xm-proxy-token')
    || url.searchParams.get('proxy_token')
    || route.token,
  )
  return timingSafeEqual(supplied, expected)
}

function upstreamHeaders(request, authorization, options = {}) {
  const headers = new Headers()
  const webSocket = Boolean(options.webSocket)

  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase()
    if (lower === 'host') continue
    if (lower.startsWith('cf-')) continue
    if (lower === 'x-real-ip' || lower === 'x-forwarded-for' || lower === 'x-forwarded-proto') continue
    if (webSocket) {
      if (!WEBSOCKET_FORWARD_HEADERS.has(lower)) continue
    } else if (HOP_BY_HOP_HEADERS.has(lower)) {
      continue
    }
    if (lower === 'x-one-xm-proxy-token') continue
    headers.set(name, value)
  }

  headers.set('authorization', authorization)
  headers.set('user-agent', request.headers.get('user-agent') || 'crawshrimp-one-xm-proxy/1.0')
  return headers
}

function responseHeaders(source, request, env) {
  const headers = new Headers()
  for (const [name, value] of source) {
    const lower = name.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lower)) continue
    headers.set(name, value)
  }
  headers.set('x-one-xm-proxy', 'crawshrimp-cloudflare')
  for (const [name, value] of corsHeaders(request, env)) headers.set(name, value)
  return headers
}

function corsHeaders(request, env) {
  const headers = new Headers()
  const origin = allowedCorsOrigin(request.headers.get('origin') || '', env)
  if (origin) {
    headers.set('access-control-allow-origin', origin)
    headers.set('vary', 'Origin')
  }
  headers.set('access-control-allow-methods', 'GET, POST, HEAD, OPTIONS')
  headers.set('access-control-allow-headers', 'Authorization, Content-Type, Idempotency-Key, X-One-XM-Proxy-Token')
  headers.set('access-control-max-age', '86400')
  return headers
}

function allowedCorsOrigin(origin, env) {
  const configured = stringValue(env.ALLOWED_ORIGINS)
  if (!configured || !origin) return ''
  if (configured === '*') return '*'
  const allowed = configured.split(',').map((item) => item.trim()).filter(Boolean)
  return allowed.includes(origin) ? origin : ''
}

function upstreamAuthorization(request, env) {
  const key = stringValue(env.ONE_XM_API_KEY)
  if (key) return `Bearer ${key}`
  return stringValue(request.headers.get('authorization'))
}

function isAllowedImageUrl(value, env) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    return allowedImageHosts(env).has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

function allowedImageHosts(env) {
  const configured = stringValue(env.ONE_XM_IMAGE_PROXY_HOSTS)
  const hosts = configured
    ? configured.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_IMAGE_PROXY_HOSTS
  return new Set(hosts)
}

function isWebSocketRequest(request) {
  return stringValue(request.headers.get('upgrade')).toLowerCase() === 'websocket'
}

function upstreamBaseUrl(env) {
  return stripTrailingSlash(stringValue(env.ONE_XM_UPSTREAM_BASE_URL || env.UPSTREAM_BASE_URL) || DEFAULT_UPSTREAM_BASE_URL)
}

function publicBaseUrl(requestUrl, route) {
  const url = new URL(requestUrl)
  const tokenPrefix = route.token ? `/t/${encodeURIComponent(route.token)}` : ''
  return `${url.origin}${tokenPrefix}/v1`
}

function joinPaths(basePath, suffixPath) {
  const base = `/${String(basePath || '').replace(/^\/+|\/+$/g, '')}`
  const suffix = `/${String(suffixPath || '').replace(/^\/+/, '')}`
  if (base === '/') return suffix
  if (suffix === '/') return base
  return `${base}${suffix}`
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberFromEnv(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

function timingSafeEqual(a, b) {
  const left = new TextEncoder().encode(String(a || ''))
  const right = new TextEncoder().encode(String(b || ''))
  const length = Math.max(left.length, right.length)
  let diff = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] || 0) ^ (right[index] || 0)
  }
  return diff === 0
}

function jsonResponse(payload, init = {}) {
  const headers = new Headers(init.headers || {})
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(payload), { ...init, headers })
}

function jsonError(status, message, request, env) {
  return jsonResponse(
    { ok: false, error: message },
    { status, headers: corsHeaders(request, env) },
  )
}
