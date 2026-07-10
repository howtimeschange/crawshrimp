const test = require('node:test')
const assert = require('node:assert/strict')
const { evaluateUpdatePlatform, resolveTestFeedUrl } = require('./updatePlatform')

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
