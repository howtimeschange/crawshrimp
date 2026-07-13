const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

test('custom mac signer skips non-native resources while preserving Mach-O runtime code', () => {
  const signerPath = path.join(__dirname, 'sign-macos-app.js')
  assert.equal(fs.existsSync(signerPath), true, 'custom mac signer exists')

  const { createPythonDataIgnore } = require('./sign-macos-app')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-mac-sign-'))
  const pythonRoot = path.join(root, '抓虾.app', 'Contents', 'Resources', 'python')
  const executable = path.join(pythonRoot, 'bin', 'python3.12')
  const zoneInfo = path.join(pythonRoot, 'lib', 'python3.12', 'site-packages', 'tzdata', 'zoneinfo', 'Asia', 'Shanghai')
  const ignoredByExistingRule = path.join(pythonRoot, 'already-ignored.pyc')
  const outsidePython = path.join(root, '抓虾.app', 'Contents', 'Resources', 'icon.png')
  const electronLocale = path.join(root, '抓虾.app', 'Contents', 'Frameworks', 'Electron Framework.framework', 'Resources', 'sw.lproj', 'locale.pak')

  try {
    fs.mkdirSync(path.dirname(executable), { recursive: true })
    fs.mkdirSync(path.dirname(zoneInfo), { recursive: true })
    fs.mkdirSync(path.dirname(outsidePython), { recursive: true })
    fs.mkdirSync(path.dirname(electronLocale), { recursive: true })
    fs.writeFileSync(executable, Buffer.from([0xfe, 0xed, 0xfa, 0xcf, 0, 0, 0, 0]))
    fs.writeFileSync(zoneInfo, Buffer.from([0x54, 0x5a, 0x69, 0x66, 0x32, 0, 0, 0]))
    fs.writeFileSync(ignoredByExistingRule, Buffer.from([0, 1, 2, 3]))
    fs.writeFileSync(outsidePython, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    fs.writeFileSync(electronLocale, Buffer.from('pak'))

    const ignore = createPythonDataIgnore(filePath => filePath.endsWith('.pyc'))
    assert.equal(ignore(executable), false)
    assert.equal(ignore(zoneInfo), true)
    assert.equal(ignore(ignoredByExistingRule), true)
    assert.equal(ignore(outsidePython), true)
    assert.equal(ignore(electronLocale), true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
