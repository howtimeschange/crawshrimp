'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const AI_VIDEO_CAPABILITY_PREFIX = 'avcap2'
const AI_VIDEO_CAPABILITY_KINDS = new Set(['file', 'directory'])
const AI_VIDEO_CAPABILITY_SCOPES = new Set(['input', 'output', 'media'])
const AI_VIDEO_CAPABILITY_MAX_AGE_MS = 24 * 60 * 60 * 1000
const AI_VIDEO_CAPABILITY_FUTURE_SKEW_MS = 5 * 60 * 1000
const AI_VIDEO_CAPABILITY_NONCE_BYTES = 12
const AI_VIDEO_CAPABILITY_TAG_BYTES = 16
const AI_VIDEO_CAPABILITY_AAD = Buffer.from(AI_VIDEO_CAPABILITY_PREFIX, 'ascii')

function aiVideoCapabilityKey(secret) {
  const value = String(secret || '').trim()
  if (/^[A-Fa-f0-9]{64}$/.test(value)) return Buffer.from(value, 'hex')
  const encoded = Buffer.from(value, 'utf8')
  if (encoded.length >= 32) return crypto.createHash('sha256').update(encoded).digest()
  throw new Error('AI 视频 capability secret 无效')
}

function aiVideoCapabilityNonce(value) {
  const nonce = value == null
    ? crypto.randomBytes(AI_VIDEO_CAPABILITY_NONCE_BYTES)
    : Buffer.isBuffer(value) || value instanceof Uint8Array
      ? Buffer.from(value)
      : Buffer.from(String(value), 'utf8')
  if (nonce.length !== AI_VIDEO_CAPABILITY_NONCE_BYTES) {
    throw new Error('AI 视频 capability nonce 无效')
  }
  return nonce
}

function decodeAiVideoCapabilitySegment(value) {
  const segment = String(value || '')
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error('AI 视频 capability 格式无效')
  const decoded = Buffer.from(segment, 'base64url')
  if (decoded.toString('base64url') !== segment) throw new Error('AI 视频 capability 格式无效')
  return decoded
}

function signAiVideoCapability({
  secret,
  kind,
  scope,
  filePath,
  issuedAt = Date.now(),
  nonce,
}) {
  const kindValue = String(kind || '')
  const scopeValue = String(scope || '')
  const pathValue = String(filePath || '')
  if (!AI_VIDEO_CAPABILITY_KINDS.has(kindValue)) throw new Error('AI 视频 capability 类型无效')
  if (!AI_VIDEO_CAPABILITY_SCOPES.has(scopeValue)) throw new Error('AI 视频 capability 用途无效')
  if (!path.isAbsolute(pathValue)) throw new Error('AI 视频 capability 路径必须是绝对路径')
  const payload = {
    v: 2,
    kind: kindValue,
    scope: scopeValue,
    path: pathValue,
    issuedAt: Number(issuedAt),
  }
  const nonceBytes = aiVideoCapabilityNonce(nonce)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const cipher = crypto.createCipheriv('aes-256-gcm', aiVideoCapabilityKey(secret), nonceBytes, {
    authTagLength: AI_VIDEO_CAPABILITY_TAG_BYTES,
  })
  cipher.setAAD(AI_VIDEO_CAPABILITY_AAD)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const sealed = Buffer.concat([encrypted, cipher.getAuthTag()])
  return `${AI_VIDEO_CAPABILITY_PREFIX}.${nonceBytes.toString('base64url')}.${sealed.toString('base64url')}`
}

function verifyAiVideoCapability(token, {
  secret,
  expectedKind = '',
  allowedScopes = [],
  now = Date.now(),
  maxAgeMs = AI_VIDEO_CAPABILITY_MAX_AGE_MS,
  futureSkewMs = AI_VIDEO_CAPABILITY_FUTURE_SKEW_MS,
} = {}) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3 || parts[0] !== AI_VIDEO_CAPABILITY_PREFIX) {
    throw new Error('AI 视频 capability 格式无效')
  }
  let payload
  try {
    const nonce = decodeAiVideoCapabilitySegment(parts[1])
    const sealed = decodeAiVideoCapabilitySegment(parts[2])
    if (nonce.length !== AI_VIDEO_CAPABILITY_NONCE_BYTES || sealed.length <= AI_VIDEO_CAPABILITY_TAG_BYTES) {
      throw new Error('AI 视频 capability 格式无效')
    }
    const ciphertext = sealed.subarray(0, -AI_VIDEO_CAPABILITY_TAG_BYTES)
    const tag = sealed.subarray(-AI_VIDEO_CAPABILITY_TAG_BYTES)
    const decipher = crypto.createDecipheriv('aes-256-gcm', aiVideoCapabilityKey(secret), nonce, {
      authTagLength: AI_VIDEO_CAPABILITY_TAG_BYTES,
    })
    decipher.setAAD(AI_VIDEO_CAPABILITY_AAD)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    payload = JSON.parse(plaintext.toString('utf8'))
  } catch (error) {
    if (/格式无效/.test(String(error?.message || ''))) throw error
    throw new Error('AI 视频 capability 认证无效')
  }
  if (!payload || payload.v !== 2 || !AI_VIDEO_CAPABILITY_KINDS.has(payload.kind)) {
    throw new Error('AI 视频 capability payload 无效')
  }
  if (!AI_VIDEO_CAPABILITY_SCOPES.has(payload.scope) || !path.isAbsolute(String(payload.path || ''))) {
    throw new Error('AI 视频 capability payload 无效')
  }
  const issuedAt = payload.issuedAt
  const currentTime = Number(now)
  const allowedAge = Number(maxAgeMs)
  const allowedFutureSkew = Number(futureSkewMs)
  if (
    typeof issuedAt !== 'number' || !Number.isFinite(issuedAt) ||
    !Number.isFinite(currentTime) || !Number.isFinite(allowedAge) || allowedAge < 0 ||
    !Number.isFinite(allowedFutureSkew) || allowedFutureSkew < 0
  ) {
    throw new Error('AI 视频 capability 时间无效')
  }
  if (issuedAt > currentTime + allowedFutureSkew) {
    throw new Error('AI 视频 capability 时间无效')
  }
  if (currentTime - issuedAt > allowedAge) {
    throw new Error('AI 视频 capability 已过期')
  }
  if (expectedKind && payload.kind !== expectedKind) {
    throw new Error('AI 视频 capability 类型不匹配')
  }
  const scopes = Array.isArray(allowedScopes) ? allowedScopes.map(String) : []
  if (scopes.length && !scopes.includes(payload.scope)) {
    throw new Error('AI 视频 capability 用途不匹配')
  }
  return payload
}

function aiVideoPathIdentity(filePath) {
  const resolved = path.resolve(String(filePath || ''))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function resolveAiVideoCapabilityPath(token, options = {}) {
  const payload = verifyAiVideoCapability(token, options)
  const absolute = path.resolve(payload.path)
  let selectedStat
  let realPath
  try {
    selectedStat = fs.lstatSync(absolute)
    if (selectedStat.isSymbolicLink()) throw new Error('AI 视频 capability 路径不能是符号链接')
    realPath = fs.realpathSync.native(absolute)
  } catch (error) {
    if (/符号链接/.test(String(error?.message || ''))) throw error
    throw new Error('AI 视频 capability 路径不存在或不可访问')
  }
  if (aiVideoPathIdentity(payload.path) !== aiVideoPathIdentity(realPath)) {
    throw new Error('AI 视频 capability 路径不匹配或包含符号链接')
  }
  const stat = fs.lstatSync(realPath)
  if (payload.kind === 'file' && !stat.isFile()) {
    throw new Error('AI 视频 capability 文件类型不匹配')
  }
  if (payload.kind === 'directory' && !stat.isDirectory()) {
    throw new Error('AI 视频 capability 目录类型不匹配')
  }
  return { ...payload, path: realPath, stat }
}

function sanitizeAiVideoConfigResponse(response, {
  defaultOutputDirToken,
  defaultOutputDirName,
} = {}) {
  const source = response && typeof response === 'object' ? response : {}
  const sourceData = source.data && typeof source.data === 'object' ? source.data : {}
  const data = { ...sourceData }
  delete data.defaultOutputDir
  data.defaultOutputDirToken = String(defaultOutputDirToken || '')
  data.defaultOutputDirName = String(defaultOutputDirName || '')
  return { ...source, data }
}

function parsePayload(data) {
  try { return JSON.parse(data) } catch { return data }
}

function structuredErrorDetail(value, seen = new Set()) {
  if (typeof value === 'string') return { message: value }
  if (!value || typeof value !== 'object' || seen.has(value)) return {}
  seen.add(value)

  const code = typeof value.code === 'string' ? value.code : ''
  if (typeof value.message === 'string' && value.message.trim()) {
    return { message: value.message, code }
  }
  for (const key of ['detail', 'error']) {
    const nested = structuredErrorDetail(value[key], seen)
    if (nested.message) return { message: nested.message, code: nested.code || code }
  }
  return { code }
}

function backendErrorFromResponse(statusCode, statusMessage, payload) {
  const detail = structuredErrorDetail(payload)
  const fallback = typeof payload === 'string' && payload.trim()
    ? payload
    : (statusMessage || `HTTP ${statusCode}`)
  const error = new Error(detail.message || fallback)
  if (detail.code) error.code = detail.code
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
  AI_VIDEO_CAPABILITY_PREFIX,
  AI_VIDEO_CAPABILITY_MAX_AGE_MS,
  AI_VIDEO_CAPABILITY_FUTURE_SKEW_MS,
  resolveAiVideoCapabilityPath,
  sanitizeAiVideoConfigResponse,
  signAiVideoCapability,
  verifyAiVideoCapability,
  requestBackendApi,
  backendErrorFromResponse,
}
