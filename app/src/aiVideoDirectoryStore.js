'use strict'

const fs = require('node:fs')
const path = require('node:path')

const { signAiVideoCapability } = require('./backendApi')

const STORE_VERSION = 1
const MAX_STORE_BYTES = 64 * 1024

function canonicalAiVideoInputDirectory(rawPath, { fsApi = fs } = {}) {
  const value = String(rawPath || '').trim()
  if (!value || !path.isAbsolute(value)) throw new Error('AI 视频图库路径无效')
  const absolute = path.resolve(value)
  const selectedStat = fsApi.lstatSync(absolute)
  if (selectedStat.isSymbolicLink()) throw new Error('AI 视频图库不能是符号链接')
  if (!selectedStat.isDirectory()) throw new Error('AI 视频图库不是目录')
  const real = fsApi.realpathSync.native(absolute)
  if (path.resolve(absolute) !== path.resolve(real)) throw new Error('AI 视频图库不能包含符号链接')
  const realStat = fsApi.lstatSync(real)
  if (realStat.isSymbolicLink() || !realStat.isDirectory()) throw new Error('AI 视频图库不是安全目录')
  return real
}

function rememberAiVideoInputDirectory(storePath, rawPath, { fsApi = fs } = {}) {
  const target = String(storePath || '').trim()
  if (!target) throw new Error('AI 视频图库存储路径无效')
  const canonical = canonicalAiVideoInputDirectory(rawPath, { fsApi })
  const parent = path.dirname(target)
  const temporaryPath = `${target}.${process.pid}.${Date.now()}.tmp`
  const payload = `${JSON.stringify({
    version: STORE_VERSION,
    inputDirectory: canonical,
  }, null, 2)}\n`
  fsApi.mkdirSync(parent, { recursive: true })
  try {
    fsApi.writeFileSync(temporaryPath, payload, { encoding: 'utf8', mode: 0o600 })
    fsApi.renameSync(temporaryPath, target)
    try { fsApi.chmodSync(target, 0o600) } catch { /* best effort on Windows */ }
  } catch (error) {
    try { fsApi.unlinkSync(temporaryPath) } catch { /* best effort cleanup */ }
    throw error
  }
  return canonical
}

function readSavedAiVideoInputDirectory(storePath, {
  secret,
  fsApi = fs,
} = {}) {
  try {
    const target = String(storePath || '').trim()
    if (!target || !String(secret || '').trim()) return null
    const storeStat = fsApi.lstatSync(target)
    if (storeStat.isSymbolicLink() || !storeStat.isFile() || storeStat.size > MAX_STORE_BYTES) return null
    const payload = JSON.parse(fsApi.readFileSync(target, 'utf8'))
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    if (payload.version !== STORE_VERSION) return null
    const canonical = canonicalAiVideoInputDirectory(payload.inputDirectory, { fsApi })
    return {
      directoryToken: signAiVideoCapability({
        secret,
        kind: 'directory',
        scope: 'input',
        filePath: canonical,
      }),
      name: path.basename(canonical),
      scope: 'input',
    }
  } catch {
    return null
  }
}

module.exports = {
  canonicalAiVideoInputDirectory,
  readSavedAiVideoInputDirectory,
  rememberAiVideoInputDirectory,
}
