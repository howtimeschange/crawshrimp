const test = require('node:test')
const assert = require('node:assert/strict')

const { collectCrawshrimpDataDirCandidates } = require('./dataDirRecovery')

test('Windows explicit CRAWSHRIMP_DATA remains preferred but can recover to local app data', () => {
  const candidates = collectCrawshrimpDataDirCandidates({
    primaryDataDir: 'C:\\Users\\smadmin\\.crawshrimp',
    platform: 'win32',
    legacyDataDir: 'C:\\Users\\smadmin\\.crawshrimp',
    windowsLocalDataDir: 'C:\\Users\\smadmin\\AppData\\Local\\crawshrimp',
    macLocalDataDir: '',
  })

  assert.deepEqual(candidates, [
    'C:\\Users\\smadmin\\.crawshrimp',
    'C:\\Users\\smadmin\\AppData\\Local\\crawshrimp',
  ])
})
