const test = require('node:test')
const assert = require('node:assert/strict')
const { evaluateUpdatePlatform, resolveTestFeedUrl, resolveUpdateFeedUrl } = require('./updatePlatform')

test('packaged Windows builds support in-place update', () => {
  assert.deepEqual(
    evaluateUpdatePlatform({
      platform: 'win32',
      isPackaged: true,
      execPath: 'C:\\Users\\Kim\\AppData\\Local\\Programs\\crawshrimp\\抓虾.exe',
      homeDir: 'C:\\Users\\Kim',
    }),
    { supported: true, reason: '' },
  )
})

test('macOS mounted DMG and translocated builds are rejected', () => {
  for (const execPath of [
    '/Volumes/抓虾/抓虾.app/Contents/MacOS/抓虾',
    '/private/var/folders/AppTranslocation/抓虾.app/Contents/MacOS/抓虾',
  ]) {
    const result = evaluateUpdatePlatform({
      platform: 'darwin',
      isPackaged: true,
      execPath,
      homeDir: '/Users/kim',
    })
    assert.equal(result.supported, false)
  }
})

test('production build ignores a generic test feed override', () => {
  assert.equal(resolveTestFeedUrl({
    isTestBuild: false,
    env: { CRAWSHRIMP_UPDATE_E2E_URL: 'http://127.0.0.1:40123' },
  }), '')
})

test('test build accepts only normalized loopback HTTP update feed URLs', () => {
  for (const [rawUrl, expectedUrl] of [
    ['http://127.0.0.1:40123', 'http://127.0.0.1:40123/'],
    [' http://localhost:40123/feed/ ', 'http://localhost:40123/feed/'],
    ['http://LOCALHOST:40123/feed?channel=e2e#ignored', 'http://localhost:40123/feed?channel=e2e'],
  ]) {
    assert.equal(resolveTestFeedUrl({
      isTestBuild: true,
      env: { CRAWSHRIMP_UPDATE_E2E_URL: rawUrl },
    }), expectedUrl)
  }
})

test('test feed override rejects non-loopback and unsafe URLs', () => {
  for (const rawUrl of [
    'https://127.0.0.1:40123',
    'http://example.com:40123',
    'http://192.168.1.20:40123',
    'http://user:pass@127.0.0.1:40123',
    'file:///tmp/feed',
    'ftp://127.0.0.1/feed',
    'not a url',
  ]) {
    assert.equal(resolveTestFeedUrl({
      isTestBuild: true,
      env: { CRAWSHRIMP_UPDATE_E2E_URL: rawUrl },
    }), '', rawUrl)
  }
})

test('production metadata rejects every test feed override even when the URL is otherwise valid', () => {
  for (const rawUrl of [
    'http://127.0.0.1:40123',
    'http://localhost:40123/feed',
    'https://127.0.0.1:40123',
    'http://example.com:40123',
    'file:///tmp/feed',
    'not a url',
  ]) {
    assert.equal(resolveTestFeedUrl({
      isTestBuild: false,
      env: { CRAWSHRIMP_UPDATE_E2E_URL: rawUrl },
    }), '', rawUrl)
  }
})

test('production builds use the configured HTTPS update feed', () => {
  assert.equal(resolveUpdateFeedUrl({
    isTestBuild: false,
    env: { CRAWSHRIMP_UPDATE_E2E_URL: 'http://127.0.0.1:40123' },
    configuredFeedUrl: 'https://updates.crawshrimp.com',
  }), 'https://updates.crawshrimp.com/')
})

test('test builds retain the loopback feed override ahead of the configured update feed', () => {
  assert.equal(resolveUpdateFeedUrl({
    isTestBuild: true,
    env: { CRAWSHRIMP_UPDATE_E2E_URL: 'http://localhost:40123/feed' },
    configuredFeedUrl: 'https://updates.crawshrimp.com',
  }), 'http://localhost:40123/feed')
})

test('configured update feeds reject insecure or credential-bearing URLs', () => {
  for (const configuredFeedUrl of [
    'http://updates.crawshrimp.com',
    'https://user:pass@updates.crawshrimp.com',
    'file:///tmp/feed',
    'not a url',
  ]) {
    assert.equal(resolveUpdateFeedUrl({
      isTestBuild: false,
      env: {},
      configuredFeedUrl,
    }), '', configuredFeedUrl)
  }
})
