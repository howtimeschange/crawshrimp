import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { mergeWindowsUpdateArtifacts } from './merge-windows-update-artifacts.js'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')
const { findFile } = require('electron-updater/out/providers/Provider.js')

function fixture(t, armVersion = '2.5.7') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-update-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const arch of ['x64', 'arm64']) {
    const version = arch === 'arm64' ? armVersion : '2.5.7'
    const dir = path.join(root, arch === 'x64' ? 'windows' : 'windows-arm64')
    fs.mkdirSync(dir)
    const name = `crawshrimp-v${version}-win-${arch}.exe`
    const bytes = Buffer.from(arch)
    const sha512 = crypto.createHash('sha512').update(bytes).digest('base64')
    fs.writeFileSync(path.join(dir, name), bytes)
    fs.writeFileSync(path.join(dir, name + '.blockmap'), 'blockmap')
    fs.writeFileSync(path.join(dir, 'latest.yml'), `version: ${version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${name}\nsha512: ${sha512}\nreleaseDate: '2026-09-16T00:00:00.000Z'\n`)
  }
  return root
}

test('merged Windows feed selects the matching installer for each actual updater architecture', t => {
  const root = fixture(t)
  mergeWindowsUpdateArtifacts(root)
  const metadata = yaml.load(fs.readFileSync(path.join(root, 'windows/latest.yml'), 'utf8'))
  assert.equal(metadata.files.length, 2)
  assert.match(metadata.path, /win-x64/)
  assert.equal(fs.existsSync(path.join(root, 'windows-arm64')), false)
  const descriptor = Object.getOwnPropertyDescriptor(process, 'arch')
  try {
    for (const arch of ['x64', 'arm64']) {
      Object.defineProperty(process, 'arch', { value: arch })
      const resolved = metadata.files.map(info => ({ info, url: new URL(info.url, 'https://updates.example/') }))
      assert.match(findFile(resolved, 'exe').url.pathname, new RegExp(`win-${arch}\\.exe$`))
    }
  } finally {
    Object.defineProperty(process, 'arch', descriptor)
  }
})

test('merge rejects mismatched versions without changing x64 feed', t => {
  const root = fixture(t, '2.5.8')
  const file = path.join(root, 'windows/latest.yml')
  const before = fs.readFileSync(file, 'utf8')
  assert.throws(() => mergeWindowsUpdateArtifacts(root), /versions differ/)
  assert.equal(fs.readFileSync(file, 'utf8'), before)
})

test('merge rejects corrupted ARM installer before publication', t => {
  const root = fixture(t)
  fs.writeFileSync(path.join(root, 'windows-arm64/crawshrimp-v2.5.7-win-arm64.exe'), 'bad')
  assert.throws(() => mergeWindowsUpdateArtifacts(root), /sha512 mismatch/)
})
