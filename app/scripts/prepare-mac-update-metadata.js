#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function unquote(value) {
  return value.trim().replace(/^['"]|['"]$/g, '')
}

function isDmgReference(value) {
  return /\.dmg(?:[?#].*)?$/i.test(unquote(value))
}

function isZipReference(value) {
  return /\.zip(?:[?#].*)?$/i.test(unquote(value))
}

export function keepZipUpdatersOnly(source) {
  const lines = source.split(/\r?\n/)
  const filesIndex = lines.findIndex(line => /^files:\s*$/.test(line))
  if (filesIndex === -1) {
    throw new Error('latest-mac.yml is missing the top-level files block')
  }

  let filesEnd = lines.length
  for (let index = filesIndex + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index])) {
      filesEnd = index
      break
    }
  }

  const kept = []
  let removedDmgs = 0
  let zipCount = 0
  let index = filesIndex + 1
  while (index < filesEnd) {
    const item = lines[index].match(/^(\s*)-\s+(?:url|path):\s*(.+?)\s*$/)
    if (!item) {
      kept.push(lines[index])
      index += 1
      continue
    }

    let next = index + 1
    while (next < filesEnd && !new RegExp(`^${item[1]}-\\s+(?:url|path):\\s*`).test(lines[next])) {
      next += 1
    }

    if (isDmgReference(item[2])) {
      removedDmgs += 1
    } else {
      if (isZipReference(item[2])) zipCount += 1
      kept.push(...lines.slice(index, next))
    }
    index = next
  }

  if (zipCount === 0) {
    throw new Error('latest-mac.yml does not contain a ZIP updater entry')
  }

  return {
    source: [...lines.slice(0, filesIndex + 1), ...kept, ...lines.slice(filesEnd)].join('\n'),
    removedDmgs,
    zipCount,
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const metadataPath = process.argv[2]
  if (!metadataPath) {
    console.error('usage: node scripts/prepare-mac-update-metadata.js <latest-mac.yml>')
    process.exit(2)
  }

  const absolutePath = path.resolve(metadataPath)
  const prepared = keepZipUpdatersOnly(fs.readFileSync(absolutePath, 'utf8'))
  const temporaryPath = `${absolutePath}.tmp`
  fs.writeFileSync(temporaryPath, prepared.source)
  fs.renameSync(temporaryPath, absolutePath)
  console.log(`Prepared ${metadataPath}: kept ${prepared.zipCount} ZIP updater(s), removed ${prepared.removedDmgs} DMG entr${prepared.removedDmgs === 1 ? 'y' : 'ies'}`)
}
