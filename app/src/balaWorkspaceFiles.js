'use strict'

const fs = require('node:fs')
const path = require('node:path')

const BALA_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const BALA_VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm'])
const BALA_WORKSPACE_MANIFEST_FILENAME = '.crawshrimp-ai-video-workflow.json'
const BALA_WORKSPACE_MANIFEST_MAX_BYTES = 8 * 1024 * 1024

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

function authorizedWorkspaceRoot(workspaceRoot, { roots = new Set(), fsApi = fs } = {}) {
  const rawRoot = String(workspaceRoot || '').trim()
  if (!rawRoot) throw new Error('缺少 AI 视频工作区目录')
  const canonicalRoot = canonicalPath(rawRoot, fsApi)
  if (!roots.has(rootIdentity(canonicalRoot, fsApi))) {
    throw new Error('当前工作区未授权，请重新使用系统文件夹选择器选择工作区')
  }
  return canonicalRoot
}

function videoMimeForPath(filePath = '') {
  const extension = path.extname(String(filePath || '')).toLowerCase()
  if (extension === '.mp4' || extension === '.m4v') return 'video/mp4'
  if (extension === '.webm') return 'video/webm'
  if (extension === '.mov') return 'video/quicktime'
  return ''
}

function imageMimeForPath(filePath = '') {
  const extension = path.extname(String(filePath || '')).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.png') return 'image/png'
  if (extension === '.webp') return 'image/webp'
  return ''
}

function getAuthorizedBalaWorkspaceImage({ workspaceRoot, filePath, roots = new Set(), fsApi = fs } = {}) {
  const canonicalRoot = authorizedWorkspaceRoot(workspaceRoot, { roots, fsApi })
  const rawFile = String(filePath || '').trim()
  if (!rawFile) throw new Error('缺少本地图片路径')
  const resolvedFile = path.resolve(rawFile)
  const stat = fsApi.lstatSync(resolvedFile)
  if (stat.isSymbolicLink()) throw new Error('禁止预览符号链接')
  if (!stat.isFile()) throw new Error('只能预览普通图片文件')
  const mime = imageMimeForPath(resolvedFile)
  if (!mime || !BALA_IMAGE_EXTENSIONS.has(path.extname(resolvedFile).toLowerCase())) {
    throw new Error('只能预览 PNG、JPG、JPEG 或 WEBP 图片文件')
  }
  const canonicalFile = canonicalPath(resolvedFile, fsApi)
  assertDescendant(canonicalRoot, canonicalFile)
  return {
    path: canonicalFile,
    mime,
    size: stat.size,
  }
}

function getAuthorizedBalaWorkspaceVideo({ workspaceRoot, filePath, roots = new Set(), fsApi = fs } = {}) {
  const canonicalRoot = authorizedWorkspaceRoot(workspaceRoot, { roots, fsApi })
  const rawFile = String(filePath || '').trim()
  if (!rawFile) throw new Error('缺少本地视频路径')
  const resolvedFile = path.resolve(rawFile)
  const stat = fsApi.lstatSync(resolvedFile)
  if (stat.isSymbolicLink()) throw new Error('禁止预览符号链接')
  if (!stat.isFile()) throw new Error('只能预览普通视频文件')
  const mime = videoMimeForPath(resolvedFile)
  if (!mime || !BALA_VIDEO_EXTENSIONS.has(path.extname(resolvedFile).toLowerCase())) {
    throw new Error('只能预览 MP4、M4V、MOV 或 WEBM 视频文件')
  }
  const canonicalFile = canonicalPath(resolvedFile, fsApi)
  assertDescendant(canonicalRoot, canonicalFile)
  return {
    path: canonicalFile,
    mime,
    size: stat.size,
  }
}

function workspaceManifestPath(workspaceRoot, { roots = new Set(), fsApi = fs } = {}) {
  return path.join(authorizedWorkspaceRoot(workspaceRoot, { roots, fsApi }), BALA_WORKSPACE_MANIFEST_FILENAME)
}

function readAuthorizedBalaWorkspaceManifest({ workspaceRoot, roots = new Set(), fsApi = fs } = {}) {
  const manifestPath = workspaceManifestPath(workspaceRoot, { roots, fsApi })
  if (!fsApi.existsSync(manifestPath)) return null
  const stat = fsApi.lstatSync(manifestPath)
  if (stat.isSymbolicLink()) throw new Error('工作区恢复清单不能是符号链接')
  if (!stat.isFile()) throw new Error('工作区恢复清单不是普通文件')
  if (stat.size > BALA_WORKSPACE_MANIFEST_MAX_BYTES) throw new Error('工作区恢复清单超过大小限制')
  let payload
  try {
    payload = JSON.parse(fsApi.readFileSync(manifestPath, 'utf8'))
  } catch {
    throw new Error('工作区恢复清单无法读取')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('工作区恢复清单格式无效')
  }
  return payload
}

function writeAuthorizedBalaWorkspaceManifest({ workspaceRoot, payload, roots = new Set(), fsApi = fs } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('工作区恢复清单格式无效')
  }
  const manifestPath = workspaceManifestPath(workspaceRoot, { roots, fsApi })
  const serialized = `${JSON.stringify(payload)}\n`
  if (Buffer.byteLength(serialized, 'utf8') > BALA_WORKSPACE_MANIFEST_MAX_BYTES) {
    throw new Error('工作区恢复清单超过大小限制')
  }
  const temporaryPath = `${manifestPath}.${process.pid}.${Date.now().toString(36)}.tmp`
  fsApi.writeFileSync(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 })
  fsApi.renameSync(temporaryPath, manifestPath)
  return { ok: true, path: manifestPath }
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

  const canonicalRoot = authorizedWorkspaceRoot(rawRoot, { roots, fsApi })

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
  BALA_VIDEO_EXTENSIONS,
  BALA_WORKSPACE_MANIFEST_FILENAME,
  authorizeBalaWorkspaceRoot,
  deleteAuthorizedWorkspaceImage,
  getAuthorizedBalaWorkspaceImage,
  getAuthorizedBalaWorkspaceVideo,
  loadAuthorizedBalaWorkspaceRoots,
  readAuthorizedBalaWorkspaceManifest,
  rememberAuthorizedBalaWorkspaceRoot,
  writeAuthorizedBalaWorkspaceManifest,
}
