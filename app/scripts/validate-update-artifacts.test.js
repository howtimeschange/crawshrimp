import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { validateUpdateArtifacts } from './validate-update-artifacts.js'

function fixtureDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'update-artifacts-'))
}

function writeAsset(root, relativePath, bytes) {
  const filePath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, bytes)
  return {
    name: path.basename(relativePath),
    sha512: crypto.createHash('sha512').update(bytes).digest('base64'),
  }
}

function writeMetadata(root, relativePath, assets) {
  const metadataPath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true })
  const lines = ['version: 2.0.0', 'files:']
  for (const asset of assets) {
    lines.push(`  - url: ${asset.name}`)
    lines.push(`    sha512: ${asset.sha512}`)
  }
  fs.writeFileSync(metadataPath, `${lines.join('\n')}\n`)
}

function writeFormalReleaseManifest(root, version = '2.0.0') {
  const macAssets = [
    writeAsset(root, `release-assets/macos/crawshrimp-v${version}-mac-arm64.dmg`, Buffer.from('mac-arm64-dmg')),
    writeAsset(root, `release-assets/macos/crawshrimp-v${version}-mac-x64.dmg`, Buffer.from('mac-x64-dmg')),
    writeAsset(root, `release-assets/macos/crawshrimp-v${version}-mac-arm64.zip`, Buffer.from('mac-arm64-zip')),
    writeAsset(root, `release-assets/macos/crawshrimp-v${version}-mac-x64.zip`, Buffer.from('mac-x64-zip')),
    writeAsset(root, `release-assets/macos/crawshrimp-v${version}-mac-arm64.zip.blockmap`, Buffer.from('mac-arm64-blockmap')),
    writeAsset(root, `release-assets/macos/crawshrimp-v${version}-mac-x64.zip.blockmap`, Buffer.from('mac-x64-blockmap')),
  ]
  const winAssets = [
    writeAsset(root, `release-assets/windows/crawshrimp-v${version}-win-x64.exe`, Buffer.from('win-exe')),
    writeAsset(root, `release-assets/windows/crawshrimp-v${version}-win-x64.exe.blockmap`, Buffer.from('win-blockmap')),
  ]
  writeMetadata(root, 'release-assets/macos/latest-mac.yml', macAssets.filter(asset => asset.name.endsWith('.zip')))
  writeMetadata(root, 'release-assets/windows/latest.yml', winAssets.filter(asset => asset.name.endsWith('.exe')))
}

test('validates Windows metadata that references an existing EXE with matching sha512', () => {
  const root = fixtureDir()
  const exe = writeAsset(root, 'latest/win/crawshrimp-v2.0.0-win-x64.exe', Buffer.from('windows-installer'))
  writeMetadata(root, 'latest/win/latest.yml', [exe])

  const result = validateUpdateArtifacts(root)

  assert.deepEqual(result.errors, [])
  assert.equal(result.assetCount, 1)
})

test('validates macOS metadata that references both ZIP architectures with matching sha512', () => {
  const root = fixtureDir()
  const arm64 = writeAsset(root, 'macos/crawshrimp-v2.0.0-mac-arm64.zip', Buffer.from('mac-arm64'))
  const x64 = writeAsset(root, 'macos/crawshrimp-v2.0.0-mac-x64.zip', Buffer.from('mac-x64'))
  writeMetadata(root, 'macos/latest-mac.yml', [arm64, x64])

  const result = validateUpdateArtifacts(root)

  assert.deepEqual(result.errors, [])
  assert.equal(result.assetCount, 2)
})

test('fails when metadata references a missing file', () => {
  const root = fixtureDir()
  writeMetadata(root, 'windows/latest.yml', [{ name: 'missing.exe', sha512: 'abc123' }])

  const result = validateUpdateArtifacts(root)

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /missing referenced asset/)
  assert.match(result.errors.join('\n'), /missing\.exe/)
})

test('fails when a referenced file sha512 does not match metadata', () => {
  const root = fixtureDir()
  const exe = writeAsset(root, 'windows/crawshrimp-v2.0.0-win-x64.exe', Buffer.from('actual-bytes'))
  writeMetadata(root, 'windows/latest.yml', [{ name: exe.name, sha512: crypto.createHash('sha512').update('other-bytes').digest('base64') }])

  const result = validateUpdateArtifacts(root)

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /sha512 mismatch/)
  assert.match(result.errors.join('\n'), /crawshrimp-v2\.0\.0-win-x64\.exe/)
})

test('fails when both platform directories exist but one platform metadata file is missing', () => {
  const root = fixtureDir()
  fs.mkdirSync(path.join(root, 'macos'), { recursive: true })
  const exe = writeAsset(root, 'windows/crawshrimp-v2.0.0-win-x64.exe', Buffer.from('windows-installer'))
  writeMetadata(root, 'windows/latest.yml', [exe])

  const result = validateUpdateArtifacts(root)

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /missing metadata/)
  assert.match(result.errors.join('\n'), /macos\/latest-mac\.yml/)
})

test('validates nested release-assets macos and windows roots', () => {
  const root = fixtureDir()
  const mac = writeAsset(root, 'release-assets/macos/crawshrimp-v2.0.0-mac-arm64.zip', Buffer.from('mac'))
  const win = writeAsset(root, 'release-assets/windows/crawshrimp-v2.0.0-win-x64.exe', Buffer.from('win'))
  writeMetadata(root, 'release-assets/macos/latest-mac.yml', [mac])
  writeMetadata(root, 'release-assets/windows/latest.yml', [win])

  const result = validateUpdateArtifacts(root)

  assert.deepEqual(result.errors, [])
  assert.equal(result.assetCount, 2)
})

test('fails when a metadata file parses zero assets', () => {
  const root = fixtureDir()
  fs.mkdirSync(path.join(root, 'windows'), { recursive: true })
  fs.writeFileSync(path.join(root, 'windows/latest.yml'), 'version: 2.0.0\nfiles: []\n')

  const result = validateUpdateArtifacts(root)

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /zero referenced assets/)
})

test('fails when metadata path traversal would escape the artifact tree', () => {
  const root = fixtureDir()
  const hash = crypto.createHash('sha512').update('outside').digest('base64')
  writeMetadata(root, 'windows/latest.yml', [{ name: '../outside.exe', sha512: hash }])

  const result = validateUpdateArtifacts(root)

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /unsafe referenced asset path/)
})

test('fails when metadata references an absolute asset path', () => {
  const root = fixtureDir()
  const hash = crypto.createHash('sha512').update('absolute').digest('base64')
  writeMetadata(root, 'windows/latest.yml', [{ name: '/tmp/outside.exe', sha512: hash }])

  const result = validateUpdateArtifacts(root)

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /unsafe referenced asset path/)
})

test('fails when metadata references a Windows-style backslash path', () => {
  const root = fixtureDir()
  const hash = crypto.createHash('sha512').update('windows-path').digest('base64')
  writeMetadata(root, 'windows/latest.yml', [{ name: 'nested\\app.exe', sha512: hash }])

  const result = validateUpdateArtifacts(root)

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /unsafe referenced asset path/)
})

test('fails when basename-only metadata matches duplicate candidate files', () => {
  const root = fixtureDir()
  const first = writeAsset(root, 'windows/a/crawshrimp-v2.0.0-win-x64.exe', Buffer.from('first'))
  writeAsset(root, 'windows/b/crawshrimp-v2.0.0-win-x64.exe', Buffer.from('second'))
  writeMetadata(root, 'windows/latest.yml', [first])

  const result = validateUpdateArtifacts(root)

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /ambiguous referenced asset/)
})

test('fails explicitly for unsupported inline YAML asset shape', () => {
  const root = fixtureDir()
  const exe = writeAsset(root, 'windows/crawshrimp-v2.0.0-win-x64.exe', Buffer.from('inline'))
  fs.writeFileSync(
    path.join(root, 'windows/latest.yml'),
    `version: 2.0.0\nfiles: [{ url: ${exe.name}, sha512: ${exe.sha512} }]\n`,
  )

  const result = validateUpdateArtifacts(root)

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /zero referenced assets/)
})

test('deduplicates repeated metadata references to the same file and hash', () => {
  const root = fixtureDir()
  const exe = writeAsset(root, 'windows/crawshrimp-v2.0.0-win-x64.exe', Buffer.from('same-file'))
  writeMetadata(root, 'windows/latest.yml', [exe, exe])

  const result = validateUpdateArtifacts(root)

  assert.deepEqual(result.errors, [])
  assert.equal(result.assetCount, 1)
})

test('formal release validation requires the exact complete versioned asset manifest', () => {
  const root = fixtureDir()
  writeFormalReleaseManifest(root, '2.0.0')

  const valid = validateUpdateArtifacts(root, { version: '2.0.0', formalRelease: true })
  assert.deepEqual(valid.errors, [])

  fs.unlinkSync(path.join(root, 'release-assets/macos/crawshrimp-v2.0.0-mac-x64.zip.blockmap'))
  const missing = validateUpdateArtifacts(root, { version: '2.0.0', formalRelease: true })
  assert.equal(missing.ok, false)
  assert.match(missing.errors.join('\n'), /missing required release asset/)
  assert.match(missing.errors.join('\n'), /crawshrimp-v2\.0\.0-mac-x64\.zip\.blockmap/)

  writeAsset(root, 'release-assets/windows/crawshrimp-v2.0.0-win-arm64.exe', Buffer.from('extra-win'))
  const extra = validateUpdateArtifacts(root, { version: '2.0.0', formalRelease: true })
  assert.equal(extra.ok, false)
  assert.match(extra.errors.join('\n'), /unexpected release asset/)
  assert.match(extra.errors.join('\n'), /crawshrimp-v2\.0\.0-win-arm64\.exe/)
})
