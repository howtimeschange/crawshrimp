const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { stopManagedChrome } = require('./managedChrome')

test('stopManagedChrome kills only the recorded managed Chrome instance', async () => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-chrome-'))
  const profileDir = path.join(tmpdir, 'profile')
  const stateFile = path.join(tmpdir, 'chrome-instance.json')
  fs.mkdirSync(profileDir)
  fs.writeFileSync(stateFile, JSON.stringify({
    pid: 4321,
    profileDir,
    cdpPort: 9222,
  }), 'utf8')
  const killed = []

  const result = await stopManagedChrome({
    stateFile,
    expectedProfileDir: profileDir,
    expectedCdpPort: 9222,
    isPidAlive: pid => pid === 4321,
    killPid: pid => {
      killed.push(pid)
      return true
    },
    waitForPidExit: async () => true,
  })

  assert.equal(result.stopped, true)
  assert.deepEqual(killed, [4321])
  assert.equal(fs.existsSync(stateFile), false)
})

test('stopManagedChrome refuses state from a different profile', async () => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-chrome-'))
  const profileDir = path.join(tmpdir, 'profile')
  const otherProfileDir = path.join(tmpdir, 'other-profile')
  const stateFile = path.join(tmpdir, 'chrome-instance.json')
  fs.mkdirSync(profileDir)
  fs.mkdirSync(otherProfileDir)
  fs.writeFileSync(stateFile, JSON.stringify({
    pid: 4321,
    profileDir: otherProfileDir,
    cdpPort: 9222,
  }), 'utf8')
  const killed = []

  const result = await stopManagedChrome({
    stateFile,
    expectedProfileDir: profileDir,
    expectedCdpPort: 9222,
    isPidAlive: () => true,
    killPid: pid => {
      killed.push(pid)
      return true
    },
  })

  assert.equal(result.stopped, false)
  assert.equal(result.reason, 'profile-mismatch')
  assert.deepEqual(killed, [])
  assert.equal(fs.existsSync(stateFile), true)
})

test('stopManagedChrome refuses an alive pid that no longer matches the managed browser process', async () => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-chrome-'))
  const profileDir = path.join(tmpdir, 'profile')
  const stateFile = path.join(tmpdir, 'chrome-instance.json')
  fs.mkdirSync(profileDir)
  fs.writeFileSync(stateFile, JSON.stringify({
    pid: 4321,
    profileDir,
    cdpPort: 9222,
  }), 'utf8')
  const killed = []

  const result = await stopManagedChrome({
    stateFile,
    expectedProfileDir: profileDir,
    expectedCdpPort: 9222,
    isPidAlive: () => true,
    isManagedPid: () => false,
    killPid: pid => {
      killed.push(pid)
      return true
    },
  })

  assert.equal(result.stopped, false)
  assert.equal(result.reason, 'pid-identity-mismatch')
  assert.deepEqual(killed, [])
  assert.equal(fs.existsSync(stateFile), true)
})
