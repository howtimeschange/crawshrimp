import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { validateUpdateArtifacts } from './validate-update-artifacts.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, 'prepare-mac-update-metadata.js')

test('mac update metadata keeps ZIP updaters and removes mutable DMG entries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-update-metadata-'))
  const metadata = path.join(root, 'latest-mac.yml')
  const armZip = Buffer.from('arm-zip')
  const x64Zip = Buffer.from('x64-zip')
  const armZipHash = crypto.createHash('sha512').update(armZip).digest('base64')
  const x64ZipHash = crypto.createHash('sha512').update(x64Zip).digest('base64')
  fs.writeFileSync(path.join(root, 'crawshrimp-v2.1.0-mac-arm64.zip'), armZip)
  fs.writeFileSync(path.join(root, 'crawshrimp-v2.1.0-mac-x64.zip'), x64Zip)
  fs.writeFileSync(metadata, `version: 2.1.0
files:
  - url: crawshrimp-v2.1.0-mac-arm64.zip
    sha512: ${armZipHash}
    size: 101
  - url: crawshrimp-v2.1.0-mac-x64.zip
    sha512: ${x64ZipHash}
    size: 102
  - url: crawshrimp-v2.1.0-mac-arm64.dmg
    sha512: stale-arm-dmg-hash
    size: 201
  - url: crawshrimp-v2.1.0-mac-x64.dmg
    sha512: stale-x64-dmg-hash
    size: 202
path: crawshrimp-v2.1.0-mac-arm64.zip
sha512: ${armZipHash}
releaseDate: '2026-07-11T00:00:00.000Z'
`)

  const result = spawnSync(process.execPath, [script, metadata], { encoding: 'utf8' })

  assert.equal(result.status, 0, result.stderr)
  const updated = fs.readFileSync(metadata, 'utf8')
  assert.match(updated, /url: crawshrimp-v2\.1\.0-mac-arm64\.zip/)
  assert.match(updated, /url: crawshrimp-v2\.1\.0-mac-x64\.zip/)
  assert.doesNotMatch(updated, /\.dmg/)
  assert.match(updated, /^path: crawshrimp-v2\.1\.0-mac-arm64\.zip$/m)
  assert.ok(updated.includes(`\nsha512: ${armZipHash}\n`))

  const validation = validateUpdateArtifacts(root)
  assert.deepEqual(validation.errors, [])
  assert.equal(validation.assetCount, 2)
})
