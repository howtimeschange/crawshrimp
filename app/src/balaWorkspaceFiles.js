'use strict'

const fs = require('node:fs')
const path = require('node:path')

const BALA_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

function canonicalPath(value, fsApi = fs) {
  const resolved = path.resolve(String(value || '').trim())
  return fsApi.realpathSync.native(resolved)
}

function rootIdentity(value, fsApi = fs) {
  const canonical = canonicalPath(value, fsApi)
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

function authorizeBalaWorkspaceRoot(rootPath, { roots = new Set(), fsApi = fs } = {}) {
  const raw = String(rootPath || '').trim()
  if (!raw) throw new Error('请选择 AI 视频工作区目录')
  const stat = fsApi.lstatSync(raw)
  if (stat.isSymbolicLink()) throw new Error('工作区目录不能是符号链接')
  if (!stat.isDirectory()) throw new Error('所选工作区不是目录')
  const canonical = canonicalPath(raw, fsApi)
  roots.add(rootIdentity(canonical, fsApi))
  return canonical
}

function loadAuthorizedBalaWorkspaceRoots(storePath, { roots = new Set(), fsApi = fs } = {}) {
  const rawStorePath = String(storePath || '').trim()
  if (!rawStorePath || !fsApi.existsSync(rawStorePath)) return roots
  let payload
  try {
    payload = JSON.parse(fsApi.readFileSync(rawStorePath, 'utf8'))
  } catch {
    return roots
  }
  for (const rootPath of Array.isArray(payload?.roots) ? payload.roots : []) {
    try {
      authorizeBalaWorkspaceRoot(rootPath, { roots, fsApi })
    } catch {
      // Ignore stale, removed, or no-longer-safe workspace grants.
    }
  }
  return roots
}

function rememberAuthorizedBalaWorkspaceRoot(rootPath, {
  roots = new Set(),
  storePath = '',
  fsApi = fs,
} = {}) {
  const canonical = authorizeBalaWorkspaceRoot(rootPath, { roots, fsApi })
  const rawStorePath = String(storePath || '').trim()
  if (!rawStorePath) return canonical
  const parent = path.dirname(rawStorePath)
  fsApi.mkdirSync(parent, { recursive: true })
  const tempPath = `${rawStorePath}.${process.pid}.tmp`
  const payload = JSON.stringify({ version: 1, roots: [...roots].sort() }, null, 2)
  fsApi.writeFileSync(tempPath, `${payload}\n`, { encoding: 'utf8', mode: 0o600 })
  fsApi.renameSync(tempPath, rawStorePath)
  return canonical
}

function assertDescendant(rootPath, filePath) {
  const relative = path.relative(rootPath, filePath)
  if (!relative) throw new Error('禁止删除工作区本身')
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('只能删除已授权工作区内的图片文件')
  }
}

function canonicalMissingPath(filePath, fsApi = fs) {
  let cursor = path.resolve(filePath)
  const suffix = []
  while (!fsApi.existsSync(cursor)) {
    const parent = path.dirname(cursor)
    if (parent === cursor) break
    suffix.unshift(path.basename(cursor))
    cursor = parent
  }
  return path.join(canonicalPath(cursor, fsApi), ...suffix)
}

function deleteAuthorizedWorkspaceImage({ workspaceRoot, filePath, roots = new Set(), fsApi = fs } = {}) {
  const rawRoot = String(workspaceRoot || '').trim()
  const rawFile = String(filePath || '').trim()
  if (!rawRoot || !rawFile) throw new Error('缺少工作区或待删除图片路径')

  const canonicalRoot = canonicalPath(rawRoot, fsApi)
  if (!roots.has(rootIdentity(canonicalRoot, fsApi))) {
    throw new Error('当前工作区未授权，请重新使用系统文件夹选择器选择工作区')
  }

  const resolvedFile = path.resolve(rawFile)
  if (!fsApi.existsSync(resolvedFile)) {
    if (!BALA_IMAGE_EXTENSIONS.has(path.extname(resolvedFile).toLowerCase())) {
      throw new Error('只能删除 png、jpg、jpeg 或 webp 图片文件')
    }
    const canonicalFile = canonicalMissingPath(resolvedFile, fsApi)
    assertDescendant(canonicalRoot, canonicalFile)
    return { ok: true, path: canonicalFile, alreadyMissing: true }
  }
  const stat = fsApi.lstatSync(resolvedFile)
  if (stat.isSymbolicLink()) throw new Error('禁止删除符号链接')
  const canonicalFile = canonicalPath(resolvedFile, fsApi)
  assertDescendant(canonicalRoot, canonicalFile)
  if (!stat.isFile()) throw new Error('只能删除普通图片文件，不能删除目录')
  if (!BALA_IMAGE_EXTENSIONS.has(path.extname(resolvedFile).toLowerCase())) {
    throw new Error('只能删除 png、jpg、jpeg 或 webp 图片文件')
  }
  fsApi.unlinkSync(canonicalFile)
  return { ok: true, path: canonicalFile }
}

module.exports = {
  BALA_IMAGE_EXTENSIONS,
  authorizeBalaWorkspaceRoot,
  deleteAuthorizedWorkspaceImage,
  loadAuthorizedBalaWorkspaceRoots,
  rememberAuthorizedBalaWorkspaceRoot,
}
