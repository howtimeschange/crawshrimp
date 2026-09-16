#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateUpdateArtifacts } from './validate-update-artifacts.js'

// electron-updater selects the EXE matching process.arch from this shared feed.
// Keep x64 first (and the legacy path) for older Windows updater clients.
export function mergeWindowsUpdateArtifacts(root) {
  const x64Dir = path.join(root, 'windows')
  const armDir = path.join(root, 'windows-arm64')
  const inputs = [x64Dir, armDir].map((dir, index) => {
    const result = validateUpdateArtifacts(dir)
    if (!result.ok) throw new Error(result.errors.join('\n'))
    const source = fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8')
    const version = source.match(/^version: (\d+\.\d+\.\d+)\s*$/m)?.[1]
    const files = source.match(/^files:\s*\n((?:[ \t]+[^\n]*\n)+)/m)?.[1]
    const arch = index === 0 ? 'x64' : 'arm64'
    const expected = `crawshrimp-v${version}-win-${arch}.exe`
    const urls = [...(files || '').matchAll(/^\s*- url:\s*(.+)\s*$/gm)].map(m => m[1].trim())
    if (!version || !files || urls.length !== 1 || urls[0] !== expected) {
      throw new Error(`Unexpected Windows ${arch} metadata`)
    }
    for (const name of [expected, `${expected}.blockmap`]) {
      if (!fs.statSync(path.join(dir, name)).isFile()) throw new Error(`Missing ${name}`)
    }
    return { source, files, version, expected }
  })
  if (inputs[0].version !== inputs[1].version) throw new Error('Windows architecture versions differ')
  const merged = inputs[0].source.replace(inputs[0].files, inputs[0].files + inputs[1].files)
  for (const name of [inputs[1].expected, `${inputs[1].expected}.blockmap`]) {
    fs.copyFileSync(path.join(armDir, name), path.join(x64Dir, name), fs.constants.COPYFILE_EXCL)
  }
  fs.writeFileSync(path.join(x64Dir, 'latest.yml'), merged)
  const result = validateUpdateArtifacts(x64Dir)
  if (!result.ok) throw new Error(result.errors.join('\n'))
  // Remove only the consumed CI artifact files, never a recursive directory tree.
  for (const name of [inputs[1].expected, `${inputs[1].expected}.blockmap`, 'latest.yml']) {
    fs.unlinkSync(path.join(armDir, name))
  }
  fs.rmdirSync(armDir)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: merge-windows-update-artifacts.js <release-assets>')
  mergeWindowsUpdateArtifacts(path.resolve(process.argv[2]))
}
