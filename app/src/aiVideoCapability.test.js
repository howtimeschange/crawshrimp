'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  resolveAiVideoCapabilityPath,
  sanitizeAiVideoConfigResponse,
  signAiVideoCapability,
  verifyAiVideoCapability,
} = require('./backendApi')

const SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const NOW = 1_750_000_000_000
const INTEROP_NONCE = Buffer.from('000102030405060708090a0b', 'hex')
const INTEROP_TOKEN = 'avcap2.AAECAwQFBgcICQoL.-ibsPzzVDirxoqd3VYWApiGgcZz30ll-x6ri72fxEG8zvv1EWpqf_G8p5IZ_MyOLcmlczwsx0NiFXXoOIF8t9hjuW_1dmhQ22Q5OKaGbC-nyIlGqXcopANuaG8PcNbNA71P4Y7_F5u3vng'

test('AI video capability signs and verifies an exact canonical path contract', () => {
  const token = signAiVideoCapability({
    secret: SECRET,
    kind: 'file',
    scope: 'input',
    filePath: '/tmp/reference.jpg',
    issuedAt: 1_750_000_000_000,
    nonce: INTEROP_NONCE,
  })

  assert.equal(token, INTEROP_TOKEN)
  assert.match(token, /^avcap2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  assert.equal(token.includes('/tmp/reference.jpg'), false)
  for (const segment of token.split('.').slice(1)) {
    assert.equal(Buffer.from(segment, 'base64url').toString('utf8').includes('/tmp/reference.jpg'), false)
  }
  assert.deepEqual(verifyAiVideoCapability(token, {
    secret: SECRET,
    expectedKind: 'file',
    allowedScopes: ['input'],
    now: NOW,
  }), {
    v: 2,
    kind: 'file',
    scope: 'input',
    path: '/tmp/reference.jpg',
    issuedAt: 1_750_000_000_000,
  })
})

test('AI video capability rejects tampering and scope confusion', () => {
  const token = signAiVideoCapability({
    secret: SECRET,
    kind: 'directory',
    scope: 'output',
    filePath: '/tmp/output',
    issuedAt: 1_750_000_000_000,
    nonce: INTEROP_NONCE,
  })
  const [prefix, nonce, sealed] = token.split('.')
  const replacement = sealed.endsWith('A') ? 'B' : 'A'
  const tampered = `${prefix}.${nonce}.${sealed.slice(0, -1)}${replacement}`

  assert.throws(() => verifyAiVideoCapability(tampered, { secret: SECRET }), /认证无效/)
  assert.throws(() => verifyAiVideoCapability(token, {
    secret: SECRET,
    expectedKind: 'file',
    now: NOW,
  }), /类型不匹配/)
  assert.throws(() => verifyAiVideoCapability(token, {
    secret: SECRET,
    allowedScopes: ['input'],
    now: NOW,
  }), /用途不匹配/)
  const legacyPayload = Buffer.from(JSON.stringify({
    v: 1,
    kind: 'file',
    scope: 'input',
    path: '/tmp/reference.jpg',
    issuedAt: NOW,
    nonce: 'legacy',
  }), 'utf8').toString('base64url')
  assert.throws(() => verifyAiVideoCapability(`avcap1.${legacyPayload}.legacy-signature`, {
    secret: SECRET,
  }), /格式无效/)
})

test('AI video capability rejects expired, future, and invalid issue times', () => {
  const expired = signAiVideoCapability({
    secret: SECRET,
    kind: 'file',
    scope: 'input',
    filePath: '/tmp/reference.jpg',
    issuedAt: NOW - (24 * 60 * 60 * 1000) - 1,
  })
  const future = signAiVideoCapability({
    secret: SECRET,
    kind: 'file',
    scope: 'input',
    filePath: '/tmp/reference.jpg',
    issuedAt: NOW + (5 * 60 * 1000) + 1,
  })
  const invalid = signAiVideoCapability({
    secret: SECRET,
    kind: 'file',
    scope: 'input',
    filePath: '/tmp/reference.jpg',
    issuedAt: Number.NaN,
  })

  assert.throws(() => verifyAiVideoCapability(expired, { secret: SECRET, now: NOW }), /已过期/)
  assert.throws(() => verifyAiVideoCapability(future, { secret: SECRET, now: NOW }), /时间无效/)
  assert.throws(() => verifyAiVideoCapability(invalid, { secret: SECRET, now: NOW }), /时间无效/)
})

test('AI video capability resolves only the exact canonical non-symlink target', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-ai-video-capability-'))
  try {
    const realFile = path.join(root, 'reference.jpg')
    const linkFile = path.join(root, 'linked.jpg')
    fs.writeFileSync(realFile, 'image')
    fs.symlinkSync(realFile, linkFile)

    const realToken = signAiVideoCapability({
      secret: SECRET,
      kind: 'file',
      scope: 'input',
      filePath: fs.realpathSync.native(realFile),
      issuedAt: NOW,
    })
    assert.equal(resolveAiVideoCapabilityPath(realToken, {
      secret: SECRET,
      expectedKind: 'file',
      allowedScopes: ['input'],
      now: NOW,
    }).path, fs.realpathSync.native(realFile))

    const linkToken = signAiVideoCapability({
      secret: SECRET,
      kind: 'file',
      scope: 'input',
      filePath: linkFile,
      issuedAt: NOW,
    })
    assert.throws(() => resolveAiVideoCapabilityPath(linkToken, {
      secret: SECRET,
      expectedKind: 'file',
      allowedScopes: ['input'],
      now: NOW,
    }), /符号链接|路径不匹配/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('AI video config response replaces the backend raw default directory with a capability', () => {
  const rawPath = '/Users/example/Downloads/抓虾AI生视频'
  const sanitized = sanitizeAiVideoConfigResponse({
    ok: true,
    data: {
      defaultOutputDir: rawPath,
      defaultModelId: 'seedance-2.0',
    },
  }, {
    defaultOutputDirToken: 'avcap2.default.sealed',
    defaultOutputDirName: '抓虾AI生视频',
  })

  assert.equal(sanitized.data.defaultOutputDir, undefined)
  assert.equal(sanitized.data.defaultOutputDirToken, 'avcap2.default.sealed')
  assert.equal(sanitized.data.defaultOutputDirName, '抓虾AI生视频')
  assert.equal(JSON.stringify(sanitized).includes(rawPath), false)
})
