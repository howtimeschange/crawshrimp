#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const METADATA_BY_PLATFORM = new Map([
  ['macos', 'latest-mac.yml'],
  ['windows', 'latest.yml'],
])

function walkFiles(root) {
  const files = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }
  return files
}

function normalizeReference(value) {
  const unquoted = value.trim().replace(/^['"]|['"]$/g, '')
  try {
    const parsed = new URL(unquoted)
    return decodeURIComponent(path.basename(parsed.pathname))
  } catch {
    return unquoted.split(/[?#]/, 1)[0]
  }
}

function parseMetadataAssets(source) {
  const assets = []
  const lines = source.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const referenceMatch = lines[index].match(/^\s*-?\s*(?:url|path):\s*(.+?)\s*$/)
    if (!referenceMatch) continue

    let sha512 = null
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next]
      if (/^\s*-?\s*(?:url|path):\s*/.test(line)) break
      const hashMatch = line.match(/^\s*sha512:\s*(.+?)\s*$/)
      if (hashMatch) {
        sha512 = hashMatch[1].trim().replace(/^['"]|['"]$/g, '')
        break
      }
    }

    assets.push({
      reference: normalizeReference(referenceMatch[1]),
      sha512,
      line: index + 1,
    })
  }
  return assets
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function findBasename(metadataDir, basename) {
  const matches = walkFiles(metadataDir).filter((filePath) => path.basename(filePath) === basename)
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) return { ambiguous: matches }
  return null
}

function resolveReference(metadataDir, reference) {
  if (!reference || path.isAbsolute(reference) || reference.includes('\\')) return { unsafe: true }

  const normalized = path.normalize(reference)
  const hasDirectory = normalized.includes(path.sep)
  const resolved = hasDirectory
    ? path.resolve(metadataDir, normalized)
    : findBasename(metadataDir, path.basename(normalized))

  if (!resolved) return { missing: true, path: path.resolve(metadataDir, normalized) }
  if (resolved.ambiguous) return { ambiguous: resolved.ambiguous }
  if (!isInside(metadataDir, resolved)) return { unsafe: true }
  return { path: resolved }
}

function findMetadataFiles(root) {
  return walkFiles(root).filter((filePath) => {
    const name = path.basename(filePath)
    return name === 'latest.yml' || name === 'latest-mac.yml'
  })
}

function findPlatformDirs(root) {
  const dirs = []
  function walkDirs(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const entryPath = path.join(dir, entry.name)
      if (METADATA_BY_PLATFORM.has(entry.name)) dirs.push(entryPath)
      walkDirs(entryPath)
    }
  }
  walkDirs(root)
  return dirs
}

export function validateUpdateArtifacts(root) {
  const artifactRoot = path.resolve(root)
  const errors = []
  let assetCount = 0

  if (!fs.existsSync(artifactRoot) || !fs.statSync(artifactRoot).isDirectory()) {
    return { ok: false, assetCount, errors: [`${artifactRoot}: artifact root is not a directory`] }
  }

  const metadataFiles = findMetadataFiles(artifactRoot)
  if (metadataFiles.length === 0) {
    errors.push(`${artifactRoot}: missing update metadata latest.yml or latest-mac.yml`)
  }

  const platformDirs = findPlatformDirs(artifactRoot)
  const platformNames = new Set(platformDirs.map((dir) => path.basename(dir)))
  if (platformNames.has('macos') && platformNames.has('windows')) {
    for (const dir of platformDirs) {
      const expected = METADATA_BY_PLATFORM.get(path.basename(dir))
      if (expected && !fs.existsSync(path.join(dir, expected))) {
        errors.push(`${path.relative(artifactRoot, path.join(dir, expected))}: missing metadata`)
      }
    }
  }

  for (const metadataFile of metadataFiles) {
    const metadataDir = path.dirname(metadataFile)
    const relativeMetadata = path.relative(artifactRoot, metadataFile)
    const assets = parseMetadataAssets(fs.readFileSync(metadataFile, 'utf8'))
    if (assets.length === 0) {
      errors.push(`${relativeMetadata}: zero referenced assets`)
      continue
    }

    for (const asset of assets) {
      assetCount += 1
      if (!asset.sha512) {
        errors.push(`${relativeMetadata}:${asset.line}: missing sha512 for ${asset.reference}`)
        continue
      }

      const resolved = resolveReference(metadataDir, asset.reference)
      if (resolved.unsafe) {
        errors.push(`${relativeMetadata}:${asset.line}: unsafe referenced asset path ${asset.reference}`)
        continue
      }
      if (resolved.ambiguous) {
        errors.push(`${relativeMetadata}:${asset.line}: ambiguous referenced asset ${asset.reference}`)
        continue
      }
      if (resolved.missing || !fs.existsSync(resolved.path) || !fs.statSync(resolved.path).isFile()) {
        errors.push(`${relativeMetadata}:${asset.line}: missing referenced asset ${asset.reference}`)
        continue
      }

      const actual = crypto.createHash('sha512').update(fs.readFileSync(resolved.path)).digest('base64')
      if (actual !== asset.sha512) {
        errors.push(`${relativeMetadata}:${asset.line}: sha512 mismatch for ${path.relative(metadataDir, resolved.path)}`)
      }
    }
  }

  return { ok: errors.length === 0, assetCount, errors }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const root = process.argv[2]
  if (!root) {
    console.error('usage: node scripts/validate-update-artifacts.js <root>')
    process.exit(2)
  }
  const result = validateUpdateArtifacts(root)
  for (const error of result.errors) {
    console.error(error)
  }
  process.exit(result.ok ? 0 : 1)
}
