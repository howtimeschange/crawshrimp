'use strict'

// Prevent child processes from accidentally inheriting ELECTRON_RUN_AS_NODE
delete process.env.ELECTRON_RUN_AS_NODE

const { app, BrowserWindow, Menu, ipcMain, shell, dialog, session, powerMonitor, protocol, nativeImage } = require('electron')
const { Notification } = require('electron')
const { autoUpdater } = require('electron-updater')
const path   = require('path')
const fs     = require('fs')
const http   = require('http')
const https  = require('https')
const crypto = require('crypto')
const os     = require('os')
const { fileURLToPath } = require('url')
const { Readable } = require('stream')
const { spawn, execSync, execFileSync } = require('child_process')
const { createBackendController } = require('./backendController')
const { createLifecycleController } = require('./lifecycleController')
const { stopManagedChrome: stopManagedChromeFromState } = require('./managedChrome')
const { startDesktopServices } = require('./startupServices')
const {
  requestBackendApi,
  resolveAiVideoCapabilityPath,
  sanitizeAiVideoConfigResponse,
  signAiVideoCapability,
} = require('./backendApi')
const { collectCrawshrimpDataDirCandidates } = require('./dataDirRecovery')
const {
  readSavedAiVideoInputDirectory,
  rememberAiVideoInputDirectory,
} = require('./aiVideoDirectoryStore')
const { createSingleFlightRecovery, isOwnedBackendRuntime, classifyBackendHealth } = require('./serviceRecovery')
const { probeChromeCdp: probeChromeCdpHealth, prepareChromeRecovery } = require('./chromeCdp')
const { requestBackendHealth } = require('./backendHealth')
const { configureSingleInstance } = require('./singleInstance')
const { createUpdateService } = require('./updateService')
const { createUpdateInstallCoordinator } = require('./updateInstallCoordinator')
const { createUpdateCheckScheduler } = require('./updateCheckScheduler')
const { evaluateUpdatePlatform, resolveUpdateFeedUrl } = require('./updatePlatform')
const {
  deleteAuthorizedWorkspaceImage,
  getAuthorizedBalaWorkspaceVideo,
  loadAuthorizedBalaWorkspaceRoots,
  readAuthorizedBalaWorkspaceManifest,
  rememberAuthorizedBalaWorkspaceRoot,
  writeAuthorizedBalaWorkspaceManifest,
} = require('./balaWorkspaceFiles')
const APP_METADATA = require('../package.json')

const BALA_WORKSPACE_MEDIA_PROTOCOL = 'bala-workspace-media'
const LOCAL_MEDIA_PROTOCOL = 'crawshrimp-media'
const LOCAL_MEDIA_VIDEO_EXTS = new Set(['.mp4', '.m4v', '.mov', '.webm'])
const LOCAL_MEDIA_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const authorizedLocalMediaRoots = new Set()
protocol.registerSchemesAsPrivileged([
  {
    scheme: BALA_WORKSPACE_MEDIA_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
  {
    scheme: LOCAL_MEDIA_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
])

const DEFAULT_API_PORT = parseInt(process.env.CRAWSHRIMP_PORT || '18765')
let apiPort = DEFAULT_API_PORT
const DEV_RENDERER_URL = process.env.CRAWSHRIMP_RENDERER_URL || 'http://127.0.0.1:5173'
const API_TOKEN_HEADER = 'X-Crawshrimp-Token'
const CDP_PORT = 9222
const IS_DEV   = !app.isPackaged
const CLOUD_APPROVAL_APP_ENV = IS_DEV ? 'development' : 'production'
const BACKEND_STARTUP_ATTEMPTS = process.platform === 'win32' ? 60 : 20
const BACKEND_LAUNCH_RETRIES = process.platform === 'win32' ? 2 : 1
const BACKEND_INSTANCE_ID = crypto.randomUUID()
const AI_VIDEO_CAPABILITY_SECRET = crypto.randomBytes(32).toString('hex')
const LEGACY_RUNTIME_MARKERS = [
  'adapters',
  'adapter-meta',
  'data',
  'knowledge',
  'logs',
  'crawshrimp.db',
  'config.json',
  'api-token',
  'chrome-profile',
]
let resolvedCrawshrimpDataDir = ''
let preferredCrawshrimpDataDir = ''
let desktopServicesStartupPromise = null
let dataDirRecoveryInfo = { recovered: false, from: '', to: '', errors: [] }
const authorizedBalaWorkspaceRoots = new Set()
let loadedBalaWorkspaceAuthorizationStore = ''

function balaWorkspaceMediaUrl(workspaceRoot = '', filePath = '') {
  const payload = Buffer.from(JSON.stringify({ workspaceRoot, filePath }), 'utf8').toString('base64url')
  return `${BALA_WORKSPACE_MEDIA_PROTOCOL}://workspace/${payload}`
}

function parseBalaWorkspaceMediaPayload(rawUrl = '') {
  const url = new URL(String(rawUrl || ''))
  if (url.protocol !== `${BALA_WORKSPACE_MEDIA_PROTOCOL}:` || url.hostname !== 'workspace') {
    throw new Error('无效的工作区媒体地址')
  }
  const encoded = url.pathname.replace(/^\//, '')
  if (!encoded) throw new Error('缺少工作区媒体地址')
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  if (!payload || typeof payload !== 'object') throw new Error('工作区媒体地址格式无效')
  return payload
}

function parseByteRange(rangeHeader, size) {
  const total = Number(size || 0)
  if (!Number.isSafeInteger(total) || total < 1) throw new Error('视频文件为空')
  const header = String(rangeHeader || '').trim()
  if (!header) return { start: 0, end: total - 1, partial: false }
  const match = header.match(/^bytes=(\d*)-(\d*)$/i)
  if (!match) throw new RangeError('不支持的视频范围请求')
  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) throw new RangeError('不支持的视频范围请求')
  if (!rawStart) {
    const suffixLength = Number(rawEnd)
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) throw new RangeError('无效的视频范围请求')
    return { start: Math.max(0, total - suffixLength), end: total - 1, partial: true }
  }
  const start = Number(rawStart)
  const end = rawEnd ? Number(rawEnd) : total - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= total) {
    throw new RangeError('视频范围不在文件内')
  }
  return { start, end: Math.min(end, total - 1), partial: true }
}

async function handleBalaWorkspaceMediaRequest(request) {
  try {
    ensureBalaWorkspaceAuthorizationsLoaded()
    const payload = parseBalaWorkspaceMediaPayload(request.url)
    const media = getAuthorizedBalaWorkspaceVideo({
      workspaceRoot: payload.workspaceRoot,
      filePath: payload.filePath,
      roots: authorizedBalaWorkspaceRoots,
    })
    const range = parseByteRange(request.headers.get('range'), media.size)
    const length = range.end - range.start + 1
    const headers = {
      'Content-Type': media.mime,
      'Content-Length': String(length),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    }
    if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${media.size}`
    return new Response(Readable.toWeb(fs.createReadStream(media.path, { start: range.start, end: range.end })), {
      status: range.partial ? 206 : 200,
      headers,
    })
  } catch (error) {
    const status = error instanceof RangeError ? 416 : 403
    return new Response('本地工作区视频不可用', { status, headers: { 'Cache-Control': 'no-store' } })
  }
}

function localMediaRootIdentity(rootPath = '') {
  const resolved = path.resolve(String(rootPath || '').trim())
  try {
    const real = fs.realpathSync.native(resolved)
    return process.platform === 'win32' ? real.toLowerCase() : real
  } catch {
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
}

function ensureDefaultLocalMediaRoots() {
  const defaults = [
    path.join(os.homedir(), 'Downloads', '抓虾AI生视频'),
    path.join(os.homedir(), 'Downloads', '巴拉AI视频成片'),
    getCrawshrimpDataDir(),
  ]
  for (const root of defaults) {
    try {
      if (fs.existsSync(root)) authorizeLocalMediaRoot(root)
    } catch { /* fixed app roots are best effort */ }
  }
}

function authorizeLocalMediaRoot(rootPath = '') {
  const raw = String(rootPath || '').trim()
  if (!raw) throw new Error('媒体授权目录不能为空')
  const resolved = path.resolve(raw)
  const stat = fs.lstatSync(resolved)
  if (stat.isSymbolicLink()) throw new Error('媒体授权目录不能是符号链接')
  if (!stat.isDirectory()) throw new Error('媒体授权路径必须是文件夹')
  const real = fs.realpathSync.native(resolved)
  if (localMediaRootIdentity(resolved) !== localMediaRootIdentity(real) || path.resolve(resolved) !== path.resolve(real)) {
    throw new Error('媒体授权目录不能包含符号链接')
  }
  const identity = localMediaRootIdentity(real)
  authorizedLocalMediaRoots.add(identity)
  return identity
}

function localMediaPathIsAuthorized(realPath = '') {
  const realIdentity = localMediaRootIdentity(realPath)
  return [...authorizedLocalMediaRoots].some((root) => (
    realIdentity === root || realIdentity.startsWith(`${root}${path.sep}`) || realIdentity.startsWith(`${root}/`)
  ))
}

function localMediaMime(filePath = '') {
  const ext = path.extname(String(filePath || '')).toLowerCase()
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4'
  if (ext === '.webm') return 'video/webm'
  if (ext === '.mov') return 'video/quicktime'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return ''
}

function getAuthorizedLocalMediaFile(filePath = '') {
  ensureDefaultLocalMediaRoots()
  const raw = String(filePath || '').trim()
  if (!raw) throw new Error('缺少本地媒体路径')
  const resolved = path.resolve(raw)
  const stat = fs.lstatSync(resolved)
  if (stat.isSymbolicLink()) throw new Error('禁止预览符号链接媒体')
  if (!stat.isFile()) throw new Error('本地媒体不是文件')
  const real = fs.realpathSync.native(resolved)
  if (path.resolve(resolved) !== path.resolve(real)) throw new Error('禁止预览包含符号链接的媒体')
  if (!localMediaPathIsAuthorized(real)) throw new Error('该本地媒体未授权预览，请先通过系统选择器选择所在目录')
  const mime = localMediaMime(real)
  if (!mime) throw new Error('不支持的媒体类型')
  const ext = path.extname(real).toLowerCase()
  if (!LOCAL_MEDIA_VIDEO_EXTS.has(ext) && !LOCAL_MEDIA_IMAGE_EXTS.has(ext)) {
    throw new Error('仅支持图片与常见视频格式')
  }
  return {
    path: real,
    mime,
    size: stat.size,
  }
}

function getAuthorizedLocalMediaDirectory(rootPath = '') {
  ensureDefaultLocalMediaRoots()
  const raw = String(rootPath || '').trim()
  if (!raw) throw new Error('目录路径不能为空')
  const resolved = path.resolve(raw)
  const stat = fs.lstatSync(resolved)
  if (stat.isSymbolicLink()) throw new Error('禁止扫描符号链接目录')
  if (!stat.isDirectory()) throw new Error('不是有效目录')
  const real = fs.realpathSync.native(resolved)
  if (path.resolve(resolved) !== path.resolve(real)) throw new Error('禁止扫描包含符号链接的目录')
  if (!localMediaPathIsAuthorized(real)) throw new Error('该目录未授权，请先通过系统选择器选择目录')
  return real
}

function getAiVideoCapabilityMediaFile(fileToken = '', allowedScopes = ['input', 'media']) {
  const resolved = resolveAiVideoCapabilityPath(fileToken, {
    secret: AI_VIDEO_CAPABILITY_SECRET,
    expectedKind: 'file',
    allowedScopes,
  })
  const mime = localMediaMime(resolved.path)
  const ext = path.extname(resolved.path).toLowerCase()
  if (!mime || (!LOCAL_MEDIA_VIDEO_EXTS.has(ext) && !LOCAL_MEDIA_IMAGE_EXTS.has(ext))) {
    throw new Error('仅支持图片与常见视频格式')
  }
  return {
    path: resolved.path,
    mime,
    size: resolved.stat.size,
  }
}

function localMediaUrl(fileToken = '') {
  const value = String(fileToken || '').trim()
  if (!value) throw new Error('缺少本地媒体授权')
  return `${LOCAL_MEDIA_PROTOCOL}://local/${encodeURIComponent(value)}`
}

function parseLocalMediaPayload(rawUrl = '') {
  const url = new URL(String(rawUrl || ''))
  if (url.protocol !== `${LOCAL_MEDIA_PROTOCOL}:` || url.hostname !== 'local') {
    throw new Error('无效的本地媒体地址')
  }
  const encoded = url.pathname.replace(/^\//, '')
  if (!encoded) throw new Error('缺少本地媒体地址')
  return decodeURIComponent(encoded)
}

async function handleLocalMediaRequest(request) {
  try {
    const fileToken = parseLocalMediaPayload(request.url)
    const media = getAiVideoCapabilityMediaFile(fileToken)
    const isVideo = String(media.mime || '').startsWith('video/')
    if (!isVideo) {
      return new Response(Readable.toWeb(fs.createReadStream(media.path)), {
        status: 200,
        headers: {
          'Content-Type': media.mime,
          'Content-Length': String(media.size),
          'Cache-Control': 'no-store',
        },
      })
    }
    const range = parseByteRange(request.headers.get('range'), media.size)
    const length = range.end - range.start + 1
    const headers = {
      'Content-Type': media.mime,
      'Content-Length': String(length),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    }
    if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${media.size}`
    return new Response(Readable.toWeb(fs.createReadStream(media.path, { start: range.start, end: range.end })), {
      status: range.partial ? 206 : 200,
      headers,
    })
  } catch (error) {
    const status = error instanceof RangeError ? 416 : 403
    return new Response(String(error?.message || '本地媒体不可用'), {
      status,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}

function normalizePathForIdentity(rawPath = '') {
  const resolved = path.resolve(String(rawPath || ''))
  try {
    return fs.realpathSync.native(resolved).replace(/\\/g, '/')
  } catch {
    return resolved.replace(/\\/g, '/')
  }
}

function sameRuntimePath(left = '', right = '') {
  if (!left || !right) return false
  return normalizePathForIdentity(left).toLowerCase() === normalizePathForIdentity(right).toLowerCase()
}

function normalizeExtensionList(value) {
  const source = Array.isArray(value) ? value : []
  return new Set(source
    .map(item => String(item || '').trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean))
}

function listDirectoryFilesSnapshot(rootPath, opts = {}) {
  const rawRoot = String(rootPath || '').trim()
  if (!rawRoot) throw new Error('目录路径不能为空')
  const root = fs.realpathSync.native(path.resolve(rawRoot))
  const stat = fs.statSync(root)
  if (!stat.isDirectory()) throw new Error(`不是有效目录：${rawRoot}`)

  const allowedExts = normalizeExtensionList(opts.extensions)
  const maxFiles = Math.max(1, Math.min(Number(opts.max_files || opts.maxFiles || 5000) || 5000, 20000))
  const results = []

  function walk(dir) {
    if (results.length >= maxFiles) return
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))

    for (const entry of entries) {
      if (results.length >= maxFiles) return
      if (!entry?.name || entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).slice(1).toLowerCase()
      if (allowedExts.size && !allowedExts.has(ext)) continue
      try {
        const fileStat = fs.statSync(fullPath)
        results.push({
          path: fullPath,
          relativePath: path.relative(root, fullPath).replace(/\\/g, '/'),
          mtimeMs: fileStat.mtimeMs,
          size: fileStat.size,
        })
      } catch {}
    }
  }

  walk(root)
  return {
    ok: true,
    root,
    paths: results,
    truncated: results.length >= maxFiles,
  }
}

function normalizeUrlForMatch(raw) {
  try {
    const url = new URL(String(raw || ''))
    url.hash = ''
    return url.toString()
  } catch {
    return String(raw || '').trim()
  }
}

function getFrontChromeTabMeta() {
  if (process.platform !== 'darwin') return null

  const chromeApps = ['Google Chrome', 'Chromium', 'Google Chrome for Testing']
  for (const appName of chromeApps) {
    const script = [
      `tell application "${appName}"`,
      '  if not running then return ""',
      '  if (count of windows) = 0 then return ""',
      '  set activeTab to active tab of front window',
      '  return (URL of activeTab as text) & linefeed & (title of activeTab as text)',
      'end tell',
    ].join('\n')

    try {
      const output = execSync(`osascript <<'APPLESCRIPT'\n${script}\nAPPLESCRIPT`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      if (!output) continue
      const [url, ...titleLines] = output.split('\n')
      if (!url) continue
      return {
        appName,
        url: url.trim(),
        title: titleLines.join('\n').trim(),
      }
    } catch {}
  }

  return null
}

async function resolveCurrentChromeTab() {
  const frontTab = getFrontChromeTabMeta()
  if (!frontTab?.url) return null

  const tabs = await apiCall('GET', '/settings/chrome-tabs')
  if (!Array.isArray(tabs) || !tabs.length) return null

  const normalizedUrl = normalizeUrlForMatch(frontTab.url)
  const normalizedTitle = String(frontTab.title || '').trim()

  const byUrl = tabs.filter(t => normalizeUrlForMatch(t.url) === normalizedUrl)
  if (normalizedTitle) {
    const exactUrlTitle = byUrl.find(t => String(t.title || '').trim() === normalizedTitle)
    if (exactUrlTitle) return exactUrlTitle
  }
  if (byUrl.length === 1) return byUrl[0]

  if (normalizedTitle) {
    const byTitle = tabs.filter(t => String(t.title || '').trim() === normalizedTitle)
    if (byTitle.length === 1) return byTitle[0]
  }

  return null
}

// ── Path helpers ──────────────────────────────────────────────────────────────

function getPythonBin() {
  if (!IS_DEV) {
    const winBin  = path.join(process.resourcesPath, 'python', 'python.exe')
    const unixBin = path.join(process.resourcesPath, 'python', 'bin', 'python3')
    const bundled = process.platform === 'win32' ? winBin : unixBin
    if (fs.existsSync(bundled)) return bundled
  }
  // dev fallback: __dirname = app/src, crawshrimp root = app/src/../..
  const venvPy = path.join(__dirname, '..', '..', 'venv', 'bin', 'python3')
  if (fs.existsSync(venvPy)) return venvPy
  return process.platform === 'win32' ? 'python' : 'python3'
}

function getPythonScriptsDir() {
  if (!IS_DEV) return path.join(process.resourcesPath, 'python-scripts')
  // dev: app/src/main.js -> project root is two levels up
  return path.join(__dirname, '..', '..')
}

function getDesktopConfigPath() {
  return path.join(app.getPath('userData'), 'desktop-config.json')
}

function readDesktopConfig() {
  try {
    const raw = fs.readFileSync(getDesktopConfigPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeDesktopConfig(patch = {}) {
  const next = { ...readDesktopConfig(), ...(patch || {}) }
  const configPath = getDesktopConfigPath()
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf8')
  return next
}

function resolveConfiguredDataDir(rawValue = '') {
  const raw = String(rawValue || '').trim()
  if (!raw || raw === 'data') return ''
  if (raw === '~') return app.getPath('home')
  if (raw.startsWith(`~${path.sep}`) || raw.startsWith('~/') || raw.startsWith('~\\')) {
    return path.resolve(path.join(app.getPath('home'), raw.slice(2)))
  }
  if (!path.isAbsolute(raw)) return ''
  return path.resolve(raw)
}

function getWindowsLocalCrawshrimpDataDir() {
  const localAppData = String(process.env.LOCALAPPDATA || '').trim()
  if (localAppData) return path.join(localAppData, 'crawshrimp')
  return path.join(app.getPath('userData'), 'data')
}

function getMacLocalCrawshrimpDataDir() {
  return path.join(app.getPath('appData'), 'crawshrimp')
}

function hasLegacyRuntimeData(dirPath) {
  return LEGACY_RUNTIME_MARKERS.some(marker => fs.existsSync(path.join(dirPath, marker)))
}

function readLegacyConfiguredDataDir() {
  try {
    const legacyConfigPath = path.join(app.getPath('home'), '.crawshrimp', 'config.json')
    const raw = fs.readFileSync(legacyConfigPath, 'utf8')
    const parsed = JSON.parse(raw)
    return resolveConfiguredDataDir(parsed?.data_dir || '')
  } catch {
    return ''
  }
}

function ensureWritableDirectory(dirPath, label = 'directory') {
  fs.mkdirSync(dirPath, { recursive: true })
  const probe = path.join(dirPath, `.crawshrimp-write-test-${process.pid}-${Date.now()}`)
  fs.writeFileSync(probe, 'ok', 'utf8')
  fs.unlinkSync(probe)
  return fs.realpathSync.native(dirPath)
}

function ensureWritableDataDir(dirPath) {
  const root = ensureWritableDirectory(dirPath, 'CRAWSHRIMP_DATA')
  for (const childName of ['adapters', 'adapter-meta', 'data', 'logs']) {
    ensureWritableDirectory(path.join(root, childName), childName)
  }
  return root
}

function resolveCrawshrimpDataDir() {
  const explicit = String(process.env.CRAWSHRIMP_DATA || '').trim()
  if (explicit) return path.resolve(explicit)
  if (!preferredCrawshrimpDataDir) {
    preferredCrawshrimpDataDir = resolveConfiguredDataDir(readDesktopConfig().data_dir || '') || readLegacyConfiguredDataDir()
  }
  if (preferredCrawshrimpDataDir) return path.resolve(preferredCrawshrimpDataDir)

  if (process.platform === 'win32') {
    const legacyRoot = path.join(app.getPath('home'), '.crawshrimp')
    if (hasLegacyRuntimeData(legacyRoot)) return path.resolve(legacyRoot)
    return path.resolve(getWindowsLocalCrawshrimpDataDir())
  }
  if (process.platform === 'darwin') {
    const legacyRoot = path.join(app.getPath('home'), '.crawshrimp')
    if (hasLegacyRuntimeData(legacyRoot)) return path.resolve(legacyRoot)
    return path.resolve(getMacLocalCrawshrimpDataDir())
  }
  return path.join(app.getPath('home'), '.crawshrimp')
}

function prepareCrawshrimpDataDir() {
  const candidates = collectCrawshrimpDataDirCandidates({
    primaryDataDir: resolveCrawshrimpDataDir(),
    platform: process.platform,
    legacyDataDir: path.join(app.getPath('home'), '.crawshrimp'),
    windowsLocalDataDir: getWindowsLocalCrawshrimpDataDir(),
    macLocalDataDir: getMacLocalCrawshrimpDataDir(),
  })

  const seen = new Set()
  const errors = []
  const primary = candidates[0] ? path.resolve(candidates[0]) : ''
  for (const candidate of candidates) {
    const dirPath = path.resolve(candidate)
    const key = dirPath.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    try {
      const writable = ensureWritableDataDir(dirPath)
      process.env.CRAWSHRIMP_DATA = writable
      writeDesktopConfig({ data_dir: writable })
      dataDirRecoveryInfo = {
        recovered: Boolean(errors.length || (primary && !sameRuntimePath(primary, writable))),
        from: errors.length ? primary : '',
        to: writable,
        errors: [...errors],
      }
      return writable
    } catch (error) {
      errors.push(`${dirPath}: ${error.message}`)
      console.log(`[data] ${dirPath} is not writable: ${error.message}`)
    }
  }

  throw new Error(`No writable CRAWSHRIMP_DATA directory. ${errors.join(' | ')}`)
}

function getCrawshrimpDataDir() {
  if (!resolvedCrawshrimpDataDir) {
    resolvedCrawshrimpDataDir = prepareCrawshrimpDataDir()
  }
  return resolvedCrawshrimpDataDir
}

function getBalaWorkspaceAuthorizationStorePath() {
  return path.join(getCrawshrimpDataDir(), 'authorized-bala-workspaces.json')
}

function getAiVideoInputDirectoryStorePath() {
  return path.join(getCrawshrimpDataDir(), 'ai-video-input-directory.json')
}

function ensureBalaWorkspaceAuthorizationsLoaded() {
  const storePath = getBalaWorkspaceAuthorizationStorePath()
  if (sameRuntimePath(storePath, loadedBalaWorkspaceAuthorizationStore)) return storePath
  authorizedBalaWorkspaceRoots.clear()
  loadAuthorizedBalaWorkspaceRoots(storePath, { roots: authorizedBalaWorkspaceRoots })
  loadedBalaWorkspaceAuthorizationStore = storePath
  return storePath
}

function getApiTokenPath() {
  return path.join(getCrawshrimpDataDir(), 'api-token')
}

function getBackendLockPath() {
  return path.join(getCrawshrimpDataDir(), 'backend.lock')
}

function readBackendLockPid() {
  try {
    return Number(fs.readFileSync(getBackendLockPath(), 'utf8').trim() || 0) || 0
  } catch {
    return 0
  }
}

function getApiToken() {
  const envToken = String(process.env.CRAWSHRIMP_API_TOKEN || '').trim()
  if (envToken) return envToken

  const tokenPath = getApiTokenPath()
  try {
    if (fs.existsSync(tokenPath)) {
      const existing = fs.readFileSync(tokenPath, 'utf8').trim()
      if (existing) {
        process.env.CRAWSHRIMP_API_TOKEN = existing
        return existing
      }
    }
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true })
    const token = crypto.randomBytes(32).toString('hex')
    fs.writeFileSync(tokenPath, token, 'utf8')
    try { fs.chmodSync(tokenPath, 0o600) } catch (_) {}
    process.env.CRAWSHRIMP_API_TOKEN = token
    return token
  } catch (error) {
    log(`[api] failed to prepare API token: ${error.message}`)
    throw error
  }
}

function getDesktopLogPath() {
  return path.join(getCrawshrimpDataDir(), 'logs', 'desktop.log')
}

function getApiServerScript() {
  if (!IS_DEV) return path.join(process.resourcesPath, 'python-scripts', 'core', 'api_server.py')
  return path.join(__dirname, '..', '..', 'core', 'api_server.py')
}

function getBackendLaunchArgs() {
  return ['-m', 'core.api_server']
}

function candidateTemplatePaths(srcPath = '') {
  const raw = String(srcPath || '').trim()
  if (!raw) return []

  const candidates = [raw]
  const normalized = raw.replace(/\\/g, '/')
  const marker = '/adapters/'
  const idx = normalized.lastIndexOf(marker)
  const scriptsDir = getPythonScriptsDir()

  if (idx >= 0) {
    const relative = normalized.slice(idx + 1)
    candidates.push(path.join(scriptsDir, relative))
  }

  const fileName = path.basename(raw)
  if (fileName) {
    candidates.push(path.join(scriptsDir, 'adapters', fileName))
  }

  return [...new Set(candidates)]
}

function resolveExistingFilePath(srcPath = '') {
  for (const candidate of candidateTemplatePaths(srcPath)) {
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate
    }
  }
  return ''
}

function candidateAdapterTemplatePaths(adapterId = '', templateFile = '', templatePath = '') {
  const candidates = []
  if (templatePath) candidates.push(...candidateTemplatePaths(templatePath))
  if (templateFile) candidates.push(...candidateTemplatePaths(templateFile))

  const normalizedFile = String(templateFile || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (adapterId && normalizedFile) {
    const parts = normalizedFile.split('/').filter(Boolean)
    const scriptsDir = getPythonScriptsDir()
    const dataDir = getCrawshrimpDataDir()
    candidates.push(path.join(scriptsDir, 'adapters', adapterId, ...parts))
    candidates.push(path.join(dataDir, 'adapters', adapterId, ...parts))

    const fileName = parts[parts.length - 1]
    if (fileName) {
      candidates.push(path.join(scriptsDir, 'adapters', adapterId, fileName))
      candidates.push(path.join(dataDir, 'adapters', adapterId, fileName))
    }
  }

  return [...new Set(candidates)]
}

function resolveAdapterTemplatePath(adapterId = '', templateFile = '', templatePath = '') {
  const adapterRootCandidates = [
    path.join(getPythonScriptsDir(), 'adapters', String(adapterId || '')),
    path.join(getCrawshrimpDataDir(), 'adapters', String(adapterId || '')),
  ].map(p => path.resolve(p))

  for (const candidate of candidateAdapterTemplatePaths(adapterId, templateFile, templatePath)) {
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const resolved = path.resolve(candidate)
      if (adapterRootCandidates.some(root => resolved === root || resolved.startsWith(root + path.sep))) {
        return resolved
      }
    }
  }
  return ''
}

async function saveExistingFileAs(resolvedSrcPath) {
  const name = path.basename(resolvedSrcPath)
  const ext = path.extname(resolvedSrcPath).replace('.', '') || '*'
  const downloadDir = app.getPath('downloads') || app.getPath('documents')
  const res = await dialog.showSaveDialog(mainWindow, {
    title: '另存为',
    defaultPath: path.join(downloadDir, name),
    filters: [{ name: '文件', extensions: [ext] }, { name: '所有文件', extensions: ['*'] }],
  })
  if (res.canceled || !res.filePath) return { ok: false }
  fs.copyFileSync(resolvedSrcPath, res.filePath)
  return { ok: true, dest: res.filePath }
}

function findQuickLookPdfPreview(pdfPath, outputDir) {
  const candidates = [
    path.join(outputDir, `${path.basename(pdfPath)}.png`),
    path.join(outputDir, `${path.basename(pdfPath, path.extname(pdfPath))}.png`),
  ]
  const stack = [outputDir]
  while (stack.length) {
    const dir = stack.pop()
    for (const name of fs.readdirSync(dir)) {
      const candidate = path.join(dir, name)
      const stat = fs.statSync(candidate)
      if (stat.isDirectory()) stack.push(candidate)
      if (stat.isFile() && /\.(png|jpg|jpeg)$/i.test(name)) candidates.push(candidate)
    }
  }
  return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || ''
}

function pdfPreviewPageFromImage(imagePath, page, width = 0, height = 0) {
  const raw = fs.readFileSync(imagePath)
  const ext = path.extname(imagePath).toLowerCase()
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
  return {
    page,
    preview_path: imagePath,
    width,
    height,
    data_url: `data:${mime};base64,${raw.toString('base64')}`,
  }
}

function resolveLocalImagePath(rawPath = '') {
  const value = String(rawPath || '').trim()
  if (!value) return ''
  if (/^file:\/\//i.test(value)) return fileURLToPath(value)
  if (value === '~') return app.getPath('home')
  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) {
    return path.join(app.getPath('home'), value.slice(2))
  }
  return path.resolve(value)
}

function imageMimeForPath(filePath = '') {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return ''
}

function readLocalImageDataUrl(rawPath = '') {
  const imagePath = resolveLocalImagePath(rawPath)
  const mime = imageMimeForPath(imagePath)
  if (!imagePath || !mime) throw new Error('请选择 PNG、JPG、WEBP 或 GIF 图片')
  const stat = fs.statSync(imagePath)
  if (!stat.isFile()) throw new Error('图片文件不存在')
  if (stat.size > 25 * 1024 * 1024) throw new Error('图片超过 25MB，无法预览')
  const raw = fs.readFileSync(imagePath)
  return {
    ok: true,
    path: imagePath,
    data_url: `data:${mime};base64,${raw.toString('base64')}`,
  }
}

/**
 * Resize local images for grid thumbnails. Avoids loading multi‑MB originals as data URLs.
 * Prefer Electron nativeImage; fall back to macOS sips.
 */
function readLocalImageThumbnail(rawPath = '', opts = {}) {
  const imagePath = resolveLocalImagePath(rawPath)
  const mime = imageMimeForPath(imagePath)
  if (!imagePath || !mime) throw new Error('请选择 PNG、JPG、WEBP 或 GIF 图片')
  const stat = fs.statSync(imagePath)
  if (!stat.isFile()) throw new Error('图片文件不存在')
  // Thumbnails can still be generated for larger sources than full preview.
  if (stat.size > 80 * 1024 * 1024) throw new Error('图片超过 80MB，无法生成缩略图')

  const maxEdge = Math.max(64, Math.min(Number(opts.maxEdge || opts.max_edge || 320) || 320, 1280))
  const qualityPct = Math.round(Math.max(0.4, Math.min(Number(opts.quality || 0.72) || 0.72, 0.95)) * 100)

  // Fast path: already tiny enough — return original bytes when small.
  if (stat.size <= 120 * 1024) {
    try {
      return readLocalImageDataUrl(imagePath)
    } catch {
      // continue to resize path
    }
  }

  try {
    let image = nativeImage.createFromPath(imagePath)
    if (!image.isEmpty()) {
      const size = image.getSize()
      const longEdge = Math.max(size.width || 0, size.height || 0)
      if (longEdge > maxEdge && longEdge > 0) {
        const scale = maxEdge / longEdge
        image = image.resize({
          width: Math.max(1, Math.round((size.width || maxEdge) * scale)),
          height: Math.max(1, Math.round((size.height || maxEdge) * scale)),
          quality: 'good',
        })
      }
      const jpeg = image.toJPEG(qualityPct)
      if (jpeg && jpeg.length) {
        const outSize = image.getSize()
        return {
          ok: true,
          path: imagePath,
          data_url: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
          width: outSize.width,
          height: outSize.height,
          bytes: jpeg.length,
          thumbnail: true,
        }
      }
    }
  } catch {
    // fall through to sips
  }

  // macOS sips fallback for formats/sizes nativeImage struggles with
  if (process.platform === 'darwin') {
    const sipsBin = '/usr/bin/sips'
    if (fs.existsSync(sipsBin)) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-thumb-'))
      const tmpOut = path.join(tmpDir, 'thumb.jpg')
      try {
        execFileSync(sipsBin, ['-s', 'format', 'jpeg', '-Z', String(maxEdge), imagePath, '--out', tmpOut], {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 20000,
        })
        if (fs.existsSync(tmpOut)) {
          const raw = fs.readFileSync(tmpOut)
          return {
            ok: true,
            path: imagePath,
            data_url: `data:image/jpeg;base64,${raw.toString('base64')}`,
            bytes: raw.length,
            thumbnail: true,
          }
        }
      } catch {
        // fall through
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
      }
    }
  }

  // Last resort: full file if under the preview size cap
  return readLocalImageDataUrl(imagePath)
}

function renderPdfPreviewWithPyMuPDF(pdfPath, outputDir) {
  const pythonBin = getPythonBin()
  fs.mkdirSync(outputDir, { recursive: true })

  const script = `
import json
import sys
from pathlib import Path

import fitz

pdf_path = Path(sys.argv[1])
output_dir = Path(sys.argv[2])
output_dir.mkdir(parents=True, exist_ok=True)

doc = fitz.open(str(pdf_path))
pages = []
try:
    for index in range(doc.page_count):
        page = doc.load_page(index)
        rect = page.rect
        long_edge = max(float(rect.width or 0), float(rect.height or 0), 1.0)
        scale = max(3.0, min(8.0, 3600.0 / long_edge))
        pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        target = output_dir / f"page-{index + 1}.png"
        pixmap.save(str(target))
        pages.append({
            "page": index + 1,
            "preview_path": str(target),
            "width": pixmap.width,
            "height": pixmap.height,
        })
finally:
    doc.close()

print(json.dumps({"pages": pages}, ensure_ascii=False))
`.trim()

  try {
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8' }
    delete env.ELECTRON_RUN_AS_NODE
    const stdout = execFileSync(pythonBin, ['-c', script, pdfPath, outputDir], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    })
    const parsed = JSON.parse(String(stdout || '').trim() || '{}')
    const pages = Array.isArray(parsed.pages)
      ? parsed.pages
        .filter(page => page?.preview_path && fs.existsSync(page.preview_path))
        .map(page => pdfPreviewPageFromImage(
          page.preview_path,
          Number(page.page) || 1,
          Number(page.width) || 0,
          Number(page.height) || 0,
        ))
      : []
    if (!pages.length) return { ok: false, error: 'PyMuPDF 没有渲染出 PDF 页面。' }
    return {
      ok: true,
      engine: 'pymupdf',
      page_count: pages.length,
      pages,
      preview_path: pages[0].preview_path,
      data_url: pages[0].data_url,
    }
  } catch (error) {
    const stderr = String(error?.stderr || '').trim()
    const detail = stderr || error.message || String(error)
    return { ok: false, error: detail }
  }
}

function renderPdfPreviewWithQuickLook(pdfPath) {
  if (!fs.existsSync(pdfPath) || !fs.statSync(pdfPath).isFile()) {
    return { ok: false, error: `PDF 文件不存在：${pdfPath}` }
  }
  if (path.extname(pdfPath).toLowerCase() !== '.pdf') {
    return { ok: false, error: '请选择 PDF 文件进行预览框选。' }
  }

  const previewRoot = path.join(getCrawshrimpDataDir(), 'pdf-previews')
  const digest = crypto.createHash('sha1').update(`${pdfPath}:${fs.statSync(pdfPath).mtimeMs}`).digest('hex').slice(0, 16)
  const outputDir = path.join(previewRoot, digest)
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })

  const pymupdfResult = renderPdfPreviewWithPyMuPDF(pdfPath, path.join(outputDir, 'pages'))
  if (pymupdfResult.ok) return pymupdfResult
  if (process.platform !== 'darwin') {
    return { ok: false, error: `PDF 预览图生成失败：PyMuPDF: ${pymupdfResult.error}` }
  }

  try {
    const quickLookBin = fs.existsSync('/usr/bin/qlmanage') ? '/usr/bin/qlmanage' : 'qlmanage'
    execFileSync(quickLookBin, ['-t', '-s', '1800', '-o', outputDir, pdfPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 45000,
    })
    const previewPath = findQuickLookPdfPreview(pdfPath, outputDir)
    if (!previewPath) {
      const produced = fs.readdirSync(outputDir).join(', ')
      return { ok: false, error: `PDF 预览图生成失败：PyMuPDF: ${pymupdfResult.error}；Quick Look 没有输出图片。输出目录：${produced || '空'}` }
    }
    const page = pdfPreviewPageFromImage(previewPath, 1)
    return {
      ok: true,
      engine: 'quicklook',
      page_count: 1,
      pages: [page],
      preview_path: previewPath,
      data_url: page.data_url,
    }
  } catch (error) {
    const stderr = String(error?.stderr || '').trim()
    const detail = stderr || error.message || String(error)
    return { ok: false, error: `PDF 预览图生成失败：PyMuPDF: ${pymupdfResult.error}；Quick Look: ${detail}` }
  }
}

// ── Window ────────────────────────────────────────────────────────────────────
let mainWindow = null

function getRendererIndexPath() {
  return path.join(__dirname, '..', 'dist', 'renderer', 'index.html')
}

function isTrustedRendererUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''))
    if (IS_DEV) {
      const devOrigin = new URL(DEV_RENDERER_URL).origin
      return parsed.origin === devOrigin
    }
    if (parsed.protocol !== 'file:') return false
    return path.resolve(fileURLToPath(parsed)) === path.resolve(getRendererIndexPath())
  } catch {
    return false
  }
}

function guardRendererNavigation(win) {
  win.webContents.on('will-navigate', (event, url) => {
    if (isTrustedRendererUrl(url)) return
    event.preventDefault()
    log(`[security] blocked renderer navigation: ${url}`)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(String(url || ''))
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(parsed.toString())
      }
    } catch {}
    return { action: 'deny' }
  })
}

function assertTrustedSender(event) {
  const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || ''
  if (!isTrustedRendererUrl(senderUrl)) {
    throw new Error(`Blocked IPC from untrusted renderer: ${senderUrl || 'unknown'}`)
  }
}

function trustedIpcHandler(handler) {
  return async (event, ...args) => {
    assertTrustedSender(event)
    return handler(event, ...args)
  }
}

function secureHandle(channel, handler) {
  ipcMain.handle(channel, trustedIpcHandler(handler))
}

function hideNativeAppMenu() {
  if (process.platform === 'darwin') return
  Menu.setApplicationMenu(null)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 620,
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: process.platform !== 'darwin',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  guardRendererNavigation(mainWindow)
  if (process.platform !== 'darwin') {
    mainWindow.setMenuBarVisibility(false)
  }

  if (IS_DEV) {
    // Vite dev server
    mainWindow.loadURL(DEV_RENDERER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(getRendererIndexPath())
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

// ── FastAPI backend ────────────────────────────────────────────────────────────
let backendProcess = null

function spawnBackendProcess() {
  const pythonBin  = getPythonBin()
  const serverScript = getApiServerScript()
  const scriptsDir = getPythonScriptsDir()
  const launchArgs = getBackendLaunchArgs()
  resolvedCrawshrimpDataDir = getCrawshrimpDataDir()
  const apiToken = getApiToken()

  if (!fs.existsSync(serverScript)) {
    throw new Error(`api_server.py not found: ${serverScript}`)
  }

  log(`[api] launch context: port=${apiPort}, data=${resolvedCrawshrimpDataDir}, scripts=${scriptsDir}, python=${pythonBin}, lock=${getBackendLockPath()}, token=${apiToken ? 'set' : 'missing'}`)
  log(`[api] starting: ${pythonBin} ${launchArgs.join(' ')}`)
  const proc = spawn(pythonBin, launchArgs, {
    cwd: scriptsDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      CRAWSHRIMP_PORT: String(apiPort),
      CRAWSHRIMP_DATA: resolvedCrawshrimpDataDir,
      CRAWSHRIMP_ALLOW_DATA_FALLBACK: '1',
      CRAWSHRIMP_API_TOKEN: apiToken,
      CRAWSHRIMP_BACKEND_INSTANCE_ID: BACKEND_INSTANCE_ID,
      CRAWSHRIMP_AI_VIDEO_CAPABILITY_SECRET: AI_VIDEO_CAPABILITY_SECRET,
      CRAWSHRIMP_APP_ENV: CLOUD_APPROVAL_APP_ENV,
      CRAWSHRIMP_NODE_EXECUTABLE: process.execPath,
      ELECTRON_RUN_AS_NODE: '',
      PYTHONPATH: scriptsDir,
    },
  })
  backendProcess = proc
  const startupOutput = []

  const fwd = (prefix) => (d) =>
    d.toString('utf8').split('\n').filter(l => l.trim()).forEach(l => {
      startupOutput.push(l)
      if (startupOutput.length > 80) startupOutput.shift()
      log(`[${prefix}] ${l}`)
    })

  proc.getStartupOutput = () => startupOutput.join('\n')

  proc.stdout.on('data', fwd('api'))
  proc.stderr.on('data', fwd('api'))
  proc.on('exit', (code) => {
    log(`[api] process exited code=${code}`)
    if (backendProcess === proc) backendProcess = null
  })

  return proc
}

function stopBackendProcess(proc = backendProcess) {
  if (!proc) return
  stopProcessTreeByPid(proc.pid, proc)
  if (backendProcess === proc) backendProcess = null
}

function stopProcessTreeByPid(pid, proc = null) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { timeout: 3000, stdio: 'ignore' })
    } else if (proc && typeof proc.kill === 'function') {
      proc.kill('SIGTERM')
    } else {
      process.kill(pid, 'SIGTERM')
    }
    return true
  } catch {
    return false
  }
}

// ── Chrome / CDP ──────────────────────────────────────────────────────────────

const CHROME_PATHS_WIN = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : '',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)

const CHROME_PATHS_MAC = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
]

let managedChromeProcess = null
let lastChromeDiagnostic = { ok: false, kind: 'unknown', message: '尚未检测 Chrome CDP' }

function getChromeCandidates() {
  if (process.platform === 'win32') return CHROME_PATHS_WIN
  return CHROME_PATHS_MAC
}

function getManagedChromeProfileDir() {
  return path.join(getCrawshrimpDataDir(), 'chrome-profile')
}

function getManagedChromeStateFile() {
  return path.join(getCrawshrimpDataDir(), 'chrome-instance.json')
}

function writeManagedChromeState(state) {
  const filePath = getManagedChromeStateFile()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8')
}

function clearManagedChromeState() {
  try { fs.unlinkSync(getManagedChromeStateFile()) } catch (_) {}
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForPidExit(pid, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return !isPidAlive(pid)
}

function readPidCommandLine(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return ''
  try {
    if (process.platform === 'win32') {
      const output = execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ], {
        encoding: 'utf8',
        timeout: 2500,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      return String(output || '').trim()
    }
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      timeout: 2500,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function isManagedChromePid(pid) {
  const commandLine = readPidCommandLine(pid)
  if (!commandLine) return false
  const normalizedCommand = commandLine.replace(/\\/g, '/').toLowerCase()
  const normalizedProfile = normalizePathForIdentity(getManagedChromeProfileDir()).toLowerCase()
  return normalizedCommand.includes(`--remote-debugging-port=${CDP_PORT}`) &&
    normalizedCommand.includes(normalizedProfile)
}

function probeChromeCdp(timeoutMs = 800) {
  return probeChromeCdpHealth({ http, port: CDP_PORT, timeoutMs }).then(result => {
    lastChromeDiagnostic = result
    return result
  })
}

function rememberManagedChromeProcess(proc, chromePath, profileDir) {
  managedChromeProcess = proc
  writeManagedChromeState({
    pid: proc.pid,
    chromePath,
    profileDir,
    cdpPort: CDP_PORT,
    launchedAt: new Date().toISOString(),
  })
  proc.on('exit', () => {
    if (managedChromeProcess?.pid === proc.pid) {
      managedChromeProcess = null
      clearManagedChromeState()
    }
  })
}

async function performLaunchChrome(customPath = '') {
  const isWin = process.platform === 'win32'
  const candidates = getChromeCandidates()

  let ready = await probeChromeCdp()
  const recovery = await prepareChromeRecovery({
    diagnostic: ready,
    stopManagedChrome: stopManagedChromeForQuit,
    probeCdp: () => probeChromeCdp(),
  })
  ready = recovery.diagnostic
  if (recovery.action === 'ready') {
    sendStatus('chrome', true)
    return { ok: true, code: 'CDP_READY', msg: `Chrome CDP already ready (port ${CDP_PORT})`, diagnostic: ready }
  }
  if (recovery.action === 'blocked') {
    return {
      ok: false,
      code: recovery.code,
      msg: recovery.message,
      diagnostic: ready,
    }
  }

  let chromePath = customPath && fs.existsSync(customPath) ? customPath : null
  if (!chromePath) {
    for (const p of candidates) {
      if (fs.existsSync(p)) { chromePath = p; break }
    }
  }
  if (!chromePath) {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Chrome not found — select browser executable',
      buttonLabel: 'Select',
      filters: isWin ? [{ name: 'Executable', extensions: ['exe'] }] : [],
      properties: ['openFile'],
    })
    if (res.canceled || !res.filePaths.length) return { ok: false, msg: 'Chrome path not selected' }
    chromePath = res.filePaths[0]
  }

  const profileDir = getManagedChromeProfileDir()
  fs.mkdirSync(profileDir, { recursive: true })

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    'about:blank',
  ]

  if (managedChromeProcess?.pid && isPidAlive(managedChromeProcess.pid)) {
    log(`[chrome] managed Chrome pid=${managedChromeProcess.pid} still alive, waiting for CDP`)
  }

  // Keep automation traffic in an isolated browser profile and never close
  // the user's existing Chrome windows.
  log(`[chrome] launching dedicated instance with isolated profile ${profileDir}`)
  const proc = spawn(chromePath, [
    ...args,
  ], {
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  })
  let spawnError = ''
  const chromeStderr = []
  proc.stderr?.on('data', chunk => {
    const text = String(chunk || '').trim()
    if (!text) return
    chromeStderr.push(text)
    if (chromeStderr.length > 20) chromeStderr.shift()
    log(`[chrome] Chrome stderr: ${text}`)
  })
  proc.stderr?.unref?.()
  proc.once('error', (error) => {
    spawnError = error.message
    log(`[chrome] failed to launch: ${error.message}`)
    if (managedChromeProcess?.pid === proc.pid) managedChromeProcess = null
    clearManagedChromeState()
  })
  proc.unref()
  if (proc.pid) rememberManagedChromeProcess(proc, chromePath, profileDir)

  for (let i = 0; i < 50; i++) {
    if (spawnError) {
      return { ok: false, msg: `Failed to launch Chrome: ${spawnError}` }
    }
    await new Promise(r => setTimeout(r, 600))
    const cdp = await probeChromeCdp()
    if (cdp.ok) {
      sendStatus('chrome', true)
      return { ok: true, msg: `Chrome started, CDP port ${CDP_PORT}` }
    }
  }
  if (spawnError) {
    return { ok: false, msg: `Failed to launch Chrome: ${spawnError}` }
  }
  return {
    ok: false,
    code: 'CDP_START_TIMEOUT',
    msg: chromeStderr.length
      ? `Chrome 已启动但 CDP 未就绪：${chromeStderr.slice(-3).join(' | ')}`
      : 'Chrome launched but CDP did not become ready. Check whether the dedicated browser window started normally.',
    diagnostic: lastChromeDiagnostic,
  }
}

const launchChrome = createSingleFlightRecovery(performLaunchChrome)

// ── HTTP helper (call FastAPI) ─────────────────────────────────────────────────

function apiCall(method, urlPath, body = null, options = {}) {
  return requestBackendApi({
    http,
    port: apiPort,
    token: getApiToken(),
    tokenHeader: API_TOKEN_HEADER,
    method,
    urlPath,
    body,
    options,
    runWhenReady: (request, runOptions) => backendController.runWhenReady(request, runOptions),
    describeFailure: describeApiCallFailure,
  })
}

function canonicalAiVideoSelection(rawPath = '', expectedKind = 'file') {
  const value = String(rawPath || '').trim()
  if (!value || !path.isAbsolute(value)) throw new Error('AI 视频选择路径无效')
  const absolute = path.resolve(value)
  const selectedStat = fs.lstatSync(absolute)
  if (selectedStat.isSymbolicLink()) throw new Error('AI 视频选择路径不能是符号链接')
  const real = fs.realpathSync.native(absolute)
  if (path.resolve(absolute) !== path.resolve(real)) throw new Error('AI 视频选择路径不能包含符号链接')
  const stat = fs.lstatSync(real)
  if (expectedKind === 'file' && !stat.isFile()) throw new Error('AI 视频选择项不是文件')
  if (expectedKind === 'directory' && !stat.isDirectory()) throw new Error('AI 视频选择项不是目录')
  return { path: real, stat }
}

function issueAiVideoPathCapability(rawPath, { kind, scope }) {
  const selected = canonicalAiVideoSelection(rawPath, kind)
  return {
    ...selected,
    token: signAiVideoCapability({
      secret: AI_VIDEO_CAPABILITY_SECRET,
      kind,
      scope,
      filePath: selected.path,
    }),
  }
}

function aiVideoDefaultOutputDirectory() {
  const outputDir = path.join(os.homedir(), 'Downloads', '抓虾AI生视频')
  fs.mkdirSync(outputDir, { recursive: true })
  return canonicalAiVideoSelection(outputDir, 'directory').path
}

async function aiVideoConfigForRenderer() {
  const response = await apiCall('GET', '/ai-video/config')
  const outputDir = issueAiVideoPathCapability(aiVideoDefaultOutputDirectory(), {
    kind: 'directory',
    scope: 'output',
  })
  return sanitizeAiVideoConfigResponse(response, {
    defaultOutputDirToken: outputDir.token,
    defaultOutputDirName: path.basename(outputDir.path),
  })
}

function aiVideoPublicFileItem(rawPath, { scope = 'input', relativePath = '', allowedKinds = ['image'] } = {}) {
  const selected = issueAiVideoPathCapability(rawPath, { kind: 'file', scope })
  const ext = path.extname(selected.path).toLowerCase()
  const mime = localMediaMime(selected.path)
  const kinds = new Set((Array.isArray(allowedKinds) ? allowedKinds : [allowedKinds])
    .map(item => String(item || '').trim())
    .filter(Boolean))
  const isImage = LOCAL_MEDIA_IMAGE_EXTS.has(ext) && ext !== '.gif'
  const isVideo = LOCAL_MEDIA_VIDEO_EXTS.has(ext)
  if ((!kinds.has('image') || !isImage) && (!kinds.has('video') || !isVideo)) {
    if (kinds.has('video') && kinds.has('image')) throw new Error('AI 视频素材仅支持 JPG、PNG、WEBP、MP4、MOV、M4V、WEBM')
    if (kinds.has('video')) throw new Error('AI 视频素材仅支持 MP4、MOV、M4V、WEBM')
    throw new Error('AI 视频参考图仅支持 JPG、PNG、WEBP')
  }
  return {
    fileToken: selected.token,
    previewToken: selected.token,
    name: path.basename(selected.path),
    relativePath: String(relativePath || '').replace(/\\/g, '/'),
    kind: isVideo ? 'video' : 'image',
    mimeType: mime,
    size: selected.stat.size,
    mtimeMs: selected.stat.mtimeMs,
  }
}

async function selectAiVideoFiles(opts = {}) {
  const maxCount = Math.max(1, Math.min(Number(opts?.maxCount || 9) || 9, 9))
  const requestedKind = String(opts?.mediaKind || opts?.kind || 'image').trim()
  const allowedKinds = requestedKind === 'video'
    ? ['video']
    : requestedKind === 'image-video'
      ? ['image', 'video']
      : ['image']
  const filters = []
  if (allowedKinds.includes('image') && allowedKinds.includes('video')) {
    filters.push({ name: '图片与视频素材', extensions: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'm4v', 'webm'] })
  } else if (allowedKinds.includes('video')) {
    filters.push({ name: '视频文件', extensions: ['mp4', 'mov', 'm4v', 'webm'] })
  } else {
    filters.push({ name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'webp'] })
  }
  const response = await dialog.showOpenDialog(mainWindow, {
    title: String(opts?.title || (allowedKinds.includes('video') ? '选择 AI 视频素材' : '选择 AI 视频参考图')),
    properties: ['openFile', 'multiSelections'],
    filters,
  })
  if (response.canceled) return { ok: true, canceled: true, items: [] }
  const items = []
  for (const filePath of (response.filePaths || []).slice(0, maxCount)) {
    items.push(aiVideoPublicFileItem(filePath, { allowedKinds }))
  }
  return { ok: true, canceled: false, items }
}

async function selectAiVideoDirectory(opts = {}) {
  const scope = String(opts?.scope || '')
  if (scope !== 'input' && scope !== 'output') throw new Error('AI 视频目录用途无效')
  const response = await dialog.showOpenDialog(mainWindow, {
    title: String(opts?.title || (scope === 'output' ? '选择 AI 生视频输出目录' : '选择本地参考图库文件夹')),
    properties: ['openDirectory', 'createDirectory'],
  })
  if (response.canceled || !response.filePaths?.length) return { ok: true, canceled: true }
  const selected = issueAiVideoPathCapability(response.filePaths[0], { kind: 'directory', scope })
  if (scope === 'input') {
    rememberAiVideoInputDirectory(getAiVideoInputDirectoryStorePath(), selected.path)
  }
  return {
    ok: true,
    canceled: false,
    directoryToken: selected.token,
    name: path.basename(selected.path),
    scope,
  }
}

function getSavedAiVideoDirectory(scope = 'input') {
  const requestedScope = String(scope || 'input')
  if (requestedScope !== 'input') throw new Error('仅支持恢复 AI 视频输入图库')
  return readSavedAiVideoInputDirectory(getAiVideoInputDirectoryStorePath(), {
    secret: AI_VIDEO_CAPABILITY_SECRET,
  })
}

function listAiVideoDirectory(directoryToken, opts = {}) {
  const directory = resolveAiVideoCapabilityPath(directoryToken, {
    secret: AI_VIDEO_CAPABILITY_SECRET,
    expectedKind: 'directory',
    allowedScopes: ['input'],
  })
  const requested = normalizeExtensionList(opts?.extensions)
  const extensions = ['jpg', 'jpeg', 'png', 'webp'].filter(ext => !requested.size || requested.has(ext))
  if (!extensions.length) return { ok: true, items: [], truncated: false }
  const maxFiles = Math.max(1, Math.min(Number(opts?.maxFiles || 500) || 500, 500))
  const snapshot = listDirectoryFilesSnapshot(directory.path, { extensions, maxFiles })
  return {
    ok: true,
    items: snapshot.paths.map(item => aiVideoPublicFileItem(item.path, {
      scope: 'input',
      relativePath: item.relativePath,
    })),
    truncated: snapshot.truncated,
  }
}

async function openAiVideoDirectory(directoryToken) {
  const directory = resolveAiVideoCapabilityPath(directoryToken, {
    secret: AI_VIDEO_CAPABILITY_SECRET,
    expectedKind: 'directory',
    allowedScopes: ['output'],
  })
  const error = await shell.openPath(directory.path)
  if (error) throw new Error(error)
  return { ok: true }
}

async function openAiVideoFile(fileToken) {
  const media = getAiVideoCapabilityMediaFile(fileToken, ['media'])
  if (!String(media.mime || '').startsWith('video/')) throw new Error('该授权不是视频文件')
  const error = await shell.openPath(media.path)
  if (error) throw new Error(error)
  return { ok: true }
}

function aiVideoMediaForRenderer(fileToken) {
  const media = getAiVideoCapabilityMediaFile(fileToken)
  return {
    ok: true,
    mime: media.mime,
    size: media.size,
    media_url: localMediaUrl(fileToken),
  }
}

function stripLocalPath(result = {}) {
  const sanitized = { ...(result || {}) }
  delete sanitized.path
  return sanitized
}

function readAiVideoImagePreview(fileToken) {
  const media = getAiVideoCapabilityMediaFile(fileToken)
  if (!String(media.mime || '').startsWith('image/')) throw new Error('该授权不是图片')
  return stripLocalPath(readLocalImageDataUrl(media.path))
}

function readAiVideoImageThumbnail(fileToken, opts = {}) {
  const media = getAiVideoCapabilityMediaFile(fileToken)
  if (!String(media.mime || '').startsWith('image/')) throw new Error('该授权不是图片')
  return stripLocalPath(readLocalImageThumbnail(media.path, opts || {}))
}

function normalizeUpdaterApiError(error) {
  const status = Number(error?.status || error?.statusCode || error?.response?.status || 0) || undefined
  const responseData = error?.response?.data || error?.response || null
  const detail = error?.detail || responseData?.detail || responseData?.error || responseData?.message || ''
  const message = typeof detail === 'string' && detail
    ? detail
    : (detail?.message || detail?.error || error?.message || String(error || '更新服务请求失败。'))
  const wrapped = new Error(message)
  if (status) {
    wrapped.status = status
    wrapped.statusCode = status
  }
  wrapped.detail = detail || responseData || null
  const blockers = error?.blockers || detail?.blockers || responseData?.blockers || []
  if (Array.isArray(blockers)) wrapped.blockers = blockers.map(blocker => ({ ...blocker }))
  wrapped.response = {
    status,
    data: responseData,
  }
  wrapped.cause = error
  return wrapped
}

async function withUpdaterApiError(run) {
  try {
    return await run()
  } catch (error) {
    throw normalizeUpdaterApiError(error)
  }
}

// ── Local prompt library store ───────────────────────────────────────────────

const LOCAL_PROMPT_LIBRARY_STORE_NAME = 'local-prompt-libraries.json'
const LOCAL_PROMPT_SCENARIOS = new Set(['裂变图', '创意拍摄'])

function localPromptLibraryStorePath() {
  return path.join(getCrawshrimpDataDir(), LOCAL_PROMPT_LIBRARY_STORE_NAME)
}

function localPromptUid(prefix = 'local') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
}

function localPromptNow() {
  return new Date().toISOString()
}

function normalizeLocalScenario(value) {
  const text = String(value || '').trim()
  return LOCAL_PROMPT_SCENARIOS.has(text) ? text : '裂变图'
}

function localNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(String(value).trim())
  return Number.isFinite(number) ? number : null
}

function localNo(value) {
  const text = String(value ?? '').trim().toLowerCase()
  return ['否', 'false', '0', 'no', '停用', '禁用'].includes(text)
}

function localStringArray(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim()).filter(Boolean)
  }
  return String(value || '')
    .split(/[,\n，、；;]/)
    .map(item => item.trim())
    .filter(Boolean)
}

function normalizeLocalPromptTemplate(template = {}) {
  const femalePriority = localNumberOrNull(template.female_priority)
  const maleNeutralPriority = localNumberOrNull(template.male_neutral_priority)
  const priority = localNumberOrNull(template.priority) ?? femalePriority ?? maleNeutralPriority ?? 100
  return {
    local_uid: String(template.local_uid || localPromptUid('prompt')),
    group_name: String(template.group_name || '').trim(),
    field_name: String(template.field_name || '').trim(),
    source_field_id: String(template.source_field_id || '').trim(),
    field_order: localNumberOrNull(template.field_order),
    visible: template.visible === false || template.visible === 0 || localNo(template.visible) ? false : true,
    prompt_text: String(template.prompt_text || '').trim(),
    size_label: String(template.size_label || '2K').trim() || '2K',
    output_format: String(template.output_format || 'jpeg').trim() || 'jpeg',
    quality: String(template.quality || 'auto').trim() || 'auto',
    reference_fields: localStringArray(template.reference_fields),
    word_count: localNumberOrNull(template.word_count),
    field_type: String(template.field_type || '').trim(),
    female_priority: femalePriority,
    male_neutral_priority: maleNeutralPriority,
    category_rules: localStringArray(template.category_rules),
    gender_rules: localStringArray(template.gender_rules),
    priority,
    enabled: template.enabled === false || template.enabled === 0 || localNo(template.enabled) ? false : true,
    updated_at: String(template.updated_at || localPromptNow()),
  }
}

function normalizeLocalPromptLibrary(library = {}) {
  const now = localPromptNow()
  return {
    library_uid: String(library.library_uid || localPromptUid('library')),
    name: String(library.name || 'AI 测图提示词库 本地版').trim() || 'AI 测图提示词库 本地版',
    scenario: normalizeLocalScenario(library.scenario),
    status: String(library.status || 'draft'),
    cloud_library_id: library.cloud_library_id ?? null,
    cloud_synced_at: String(library.cloud_synced_at || ''),
    import_source_path: String(library.import_source_path || ''),
    created_at: String(library.created_at || now),
    updated_at: String(library.updated_at || now),
    templates: (Array.isArray(library.templates) ? library.templates : []).map(normalizeLocalPromptTemplate),
  }
}

function readLocalPromptLibraryState() {
  try {
    const raw = fs.readFileSync(localPromptLibraryStorePath(), 'utf8')
    const parsed = JSON.parse(raw)
    const libraries = Array.isArray(parsed?.libraries) ? parsed.libraries : []
    return { libraries: libraries.map(normalizeLocalPromptLibrary) }
  } catch {
    return { libraries: [] }
  }
}

function writeLocalPromptLibraryState(state) {
  const storePath = localPromptLibraryStorePath()
  fs.mkdirSync(path.dirname(storePath), { recursive: true })
  const libraries = (Array.isArray(state?.libraries) ? state.libraries : []).map(normalizeLocalPromptLibrary)
  fs.writeFileSync(storePath, JSON.stringify({ libraries }, null, 2), 'utf8')
  return { libraries }
}

function sortLocalPromptLibraries(libraries = []) {
  return [...libraries].sort((left, right) => Date.parse(right.updated_at || '') - Date.parse(left.updated_at || ''))
}

function listLocalPromptLibraries() {
  const state = readLocalPromptLibraryState()
  return { ok: true, libraries: sortLocalPromptLibraries(state.libraries) }
}

function upsertLocalPromptLibrary(payload = {}) {
  const state = readLocalPromptLibraryState()
  const now = localPromptNow()
  const libraryUid = String(payload.library_uid || '').trim()
  const existingIndex = state.libraries.findIndex(library => library.library_uid === libraryUid)
  const existing = existingIndex >= 0 ? state.libraries[existingIndex] : {}
  const next = normalizeLocalPromptLibrary({
    ...existing,
    ...payload,
    library_uid: existing.library_uid || libraryUid || localPromptUid('library'),
    status: 'draft',
    created_at: existing.created_at || now,
    updated_at: now,
    cloud_library_id: existing.cloud_library_id ?? null,
    cloud_synced_at: existing.cloud_synced_at || '',
  })
  if (existingIndex >= 0) state.libraries[existingIndex] = next
  else state.libraries.unshift(next)
  writeLocalPromptLibraryState(state)
  return { ok: true, library: next, libraries: sortLocalPromptLibraries(state.libraries) }
}

function createLocalPromptLibrary(payload = {}) {
  return upsertLocalPromptLibrary({
    name: payload.name || 'AI 测图提示词库 本地版',
    scenario: payload.scenario || '裂变图',
    templates: Array.isArray(payload.templates) ? payload.templates : [{
      group_name: '裂变图',
      field_name: '正面标准站姿',
      prompt_text: '保留商品主体、颜色和版型，生成适合 AI 测图的电商主图。',
      field_order: 0,
      female_priority: 10,
      enabled: true,
    }],
  })
}

function saveLocalPromptLibrary(libraryUid, payload = {}) {
  const state = readLocalPromptLibraryState()
  const index = state.libraries.findIndex(library => library.library_uid === String(libraryUid || '').trim())
  if (index < 0) throw new Error('本地提示词库不存在')
  const existing = state.libraries[index]
  const next = normalizeLocalPromptLibrary({
    ...existing,
    ...payload,
    library_uid: existing.library_uid,
    status: existing.status === 'synced' ? 'draft' : existing.status || 'draft',
    cloud_library_id: existing.cloud_library_id ?? null,
    cloud_synced_at: existing.cloud_synced_at || '',
    created_at: existing.created_at,
    updated_at: localPromptNow(),
  })
  state.libraries[index] = next
  writeLocalPromptLibraryState(state)
  return { ok: true, library: next, libraries: sortLocalPromptLibraries(state.libraries) }
}

function localPromptLibraryForSync(libraryUid) {
  const state = readLocalPromptLibraryState()
  const library = state.libraries.find(item => item.library_uid === String(libraryUid || '').trim())
  if (!library) throw new Error('本地提示词库不存在')
  return { state, library }
}

function cloudPromptPayloadForLibrary(library) {
  const normalized = normalizeLocalPromptLibrary(library)
  const templates = normalized.templates.map(template => ({
    group_name: template.group_name,
    field_name: template.field_name,
    source_field_id: template.source_field_id,
    field_order: template.field_order,
    visible: template.visible,
    prompt_text: template.prompt_text,
    size_label: template.size_label,
    output_format: template.output_format,
    quality: template.quality,
    reference_fields: template.reference_fields,
    word_count: template.word_count,
    field_type: template.field_type,
    female_priority: template.female_priority,
    male_neutral_priority: template.male_neutral_priority,
    category_rules: template.category_rules,
    gender_rules: template.gender_rules,
    priority: template.priority,
    enabled: template.enabled,
  }))
  const invalid = templates.find(template => !template.group_name || !template.field_name || !template.prompt_text)
  if (invalid || templates.length === 0) {
    throw new Error('同步前请补齐每条 Prompt 的分组、字段名和 Prompt 内容')
  }
  return {
    name: normalized.name,
    scenario: normalized.scenario,
    templates,
  }
}

async function cloudApprovalCookieHeader(baseUrl) {
  const cookies = await session.defaultSession.cookies.get({ url: baseUrl })
  const sessionCookie = cookies.find(cookie => cookie.name === 'cs_session' && cookie.value)
  if (!sessionCookie) {
    throw new Error('请先在云端审批页面登录，再管理提示词库')
  }
  return cookies
    .filter(cookie => cookie.name && cookie.value)
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ')
}

function parseJsonBody(text) {
  try {
    const parsed = JSON.parse(text || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function cloudErrorMessage(status, payload) {
  const detail = payload?.error || payload?.message || payload?.detail || 'request rejected'
  if (status === 401) return `云端登录已过期，请重新登录云端审批：${detail}`
  if (status === 403) return `当前云端账号没有 Prompt 管理权限：${detail}`
  return `云端提示词库请求失败：HTTP ${status}; ${detail}`
}

async function cloudApprovalUserApiCall(baseUrl, method, apiPath, body = null) {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  if (!base) throw new Error('请先配置云端审批地址')
  const cookie = await cloudApprovalCookieHeader(base)
  const target = new URL(apiPath, `${base}/`)
  const data = body === null || body === undefined
    ? null
    : Buffer.from(JSON.stringify(body), 'utf8')
  const client = target.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = client.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      timeout: 30000,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CrawshrimpDesktop/1.0',
        Cookie: cookie,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
      },
    }, (res) => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        const payload = parseJsonBody(text)
        if (Number(res.statusCode || 0) >= 400) {
          reject(new Error(cloudErrorMessage(Number(res.statusCode || 0), payload)))
          return
        }
        resolve(payload)
      })
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy(new Error('云端提示词库同步超时'))
    })
    if (data) req.write(data)
    req.end()
  })
}

async function syncLocalPromptLibraryToCloud(libraryUid) {
  const { state, library } = localPromptLibraryForSync(libraryUid)
  const payload = cloudPromptPayloadForLibrary(library)
  const status = await apiCall('GET', '/cloud-approval/status')
  const baseUrl = String(status?.base_url || '').trim()
  if (!baseUrl) throw new Error('请先在设置里配置云端审批地址')
  const cloud = await cloudApprovalUserApiCall(baseUrl, 'POST', '/api/prompt-libraries/import', payload)
  const now = localPromptNow()
  const next = normalizeLocalPromptLibrary({
    ...library,
    status: 'synced',
    cloud_library_id: cloud?.library?.id ?? library.cloud_library_id ?? null,
    cloud_synced_at: now,
    updated_at: now,
  })
  const index = state.libraries.findIndex(item => item.library_uid === library.library_uid)
  if (index >= 0) state.libraries[index] = next
  writeLocalPromptLibraryState(state)
  return { ok: true, library: next, cloud }
}

async function cloudApprovalBaseUrlForDesktop() {
  const status = await apiCall('GET', '/cloud-approval/status')
  const baseUrl = String(status?.base_url || '').trim()
  if (!baseUrl) throw new Error('请先在设置里配置云端审批地址')
  return baseUrl
}

async function listCloudPromptLibrariesForDesktop() {
  const baseUrl = await cloudApprovalBaseUrlForDesktop()
  let userSessionError = null
  try {
    return await cloudApprovalUserApiCall(baseUrl, 'GET', '/api/prompt-libraries')
  } catch (error) {
    userSessionError = error
  }
  try {
    return await apiCall('GET', '/cloud-approval/prompt-libraries')
  } catch {
    throw userSessionError
  }
}

async function resolveCloudPromptTemplatesForDesktop(libraryId, query = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      params.set(key, String(value))
    }
  }
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const baseUrl = await cloudApprovalBaseUrlForDesktop()
  let userSessionError = null
  try {
    return await cloudApprovalUserApiCall(baseUrl, 'GET', `/api/prompt-libraries/${encodeURIComponent(String(libraryId || ''))}/resolved${suffix}`)
  } catch (error) {
    userSessionError = error
  }
  try {
    return await apiCall('GET', `/cloud-approval/prompt-libraries/${encodeURIComponent(String(libraryId || ''))}/resolved${suffix}`)
  } catch {
    throw userSessionError
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

async function probeApiReady(timeoutMs = 800) {
  return (await getBackendHealth(timeoutMs)).ok
}

function log(msg) {
  const ts = new Date().toLocaleTimeString('en', { hour12: false })
  const line = `[${ts}] ${msg}`
  console.log(line)
  try {
    const logDir = path.dirname(getDesktopLogPath())
    fs.mkdirSync(logDir, { recursive: true })
    fs.appendFileSync(getDesktopLogPath(), line + '\n', 'utf8')
  } catch {}
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', line)
  }
}

function describeApiCallFailure(error) {
  const message = [
    `核心服务未能连接：${error?.message || String(error)}`,
    `请重启抓虾；如果仍失败，把日志发给开发者：${getDesktopLogPath()}`,
    `Python: ${getPythonBin()}`,
    `资源目录: ${process.resourcesPath}`,
  ].join('\n')
  const wrapped = new Error(message)
  wrapped.code = error?.code
  return wrapped
}

function expectedBackendScriptsDir() {
  return getPythonScriptsDir()
}

function expectedBackendDataDir() {
  return getCrawshrimpDataDir()
}

function isCompatibleBackendRuntime(runtime = {}) {
  if (!isOwnedBackendRuntime(runtime, {
    instanceId: BACKEND_INSTANCE_ID,
    scriptsDir: expectedBackendScriptsDir(),
    samePath: sameRuntimePath,
  })) return false
  const runtimeDataDir = String(runtime.data_dir || '')
  return sameRuntimePath(runtimeDataDir, expectedBackendDataDir())
}

function adoptOwnedBackendDataDir(runtime = {}) {
  if (!isOwnedBackendRuntime(runtime, {
    instanceId: BACKEND_INSTANCE_ID,
    scriptsDir: expectedBackendScriptsDir(),
    samePath: sameRuntimePath,
  })) return false

  const runtimeDataDir = String(runtime.data_dir || '').trim()
  if (!runtimeDataDir || !path.isAbsolute(runtimeDataDir)) return false
  if (sameRuntimePath(runtimeDataDir, expectedBackendDataDir())) return true

  try {
    const previous = expectedBackendDataDir()
    const adopted = ensureWritableDataDir(runtimeDataDir)
    resolvedCrawshrimpDataDir = adopted
    preferredCrawshrimpDataDir = adopted
    process.env.CRAWSHRIMP_DATA = adopted
    writeDesktopConfig({ data_dir: adopted })
    dataDirRecoveryInfo = {
      recovered: true,
      from: previous,
      to: adopted,
      errors: [`Python backend recovered from ${previous}`],
    }
    log(`[data] adopted backend fallback data directory ${previous} -> ${adopted}`)
    return true
  } catch (error) {
    log(`[data] refused backend fallback data directory ${runtimeDataDir}: ${error.message}`)
    return false
  }
}

function describeBackendRuntime(runtime = {}) {
  const parts = []
  if (runtime.kind) parts.push(String(runtime.kind))
  if (runtime.pid) parts.push(`pid=${runtime.pid}`)
  if (runtime.backend_instance_id) parts.push(`instance=${runtime.backend_instance_id}`)
  if (runtime.owns_backend_instance === false) parts.push('lock=foreign')
  if (runtime.scripts_dir) parts.push(`scripts=${runtime.scripts_dir}`)
  return parts.join(' ')
}

function findAvailableApiPort(startPort = DEFAULT_API_PORT + 1) {
  return new Promise((resolve, reject) => {
    const server = require('net').createServer()
    server.unref()
    server.on('error', (error) => {
      server.close(() => {})
      if (error.code === 'EADDRINUSE' && startPort < DEFAULT_API_PORT + 100) {
        findAvailableApiPort(startPort + 1).then(resolve, reject)
        return
      }
      reject(error)
    })
    server.listen(startPort, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}

function getBackendHealth(timeoutMs = 800) {
  return requestBackendHealth({ http, port: apiPort, timeoutMs })
}

async function validateApiRuntime() {
  const health = await getBackendHealth()
  if (!health.ok) return false
  const runtime = health.data?.runtime
  if (isCompatibleBackendRuntime(runtime)) return true
  if (adoptOwnedBackendDataDir(runtime)) return true
  await stopForeignBackendRuntime(runtime)
  log(`[api] found another crawshrimp backend on port ${apiPort}; ${describeBackendRuntime(runtime) || 'runtime identity unavailable'}`)
  return false
}

async function stopForeignBackendRuntime(runtime = {}) {
  const lockPid = runtime.owns_backend_instance === false ? Number(runtime.backend_lock_pid || 0) || readBackendLockPid() : 0
  const runtimePid = lockPid || Number(runtime.pid || 0)
  const runtimeDataDir = String(runtime.data_dir || '')
  if (!runtimePid || runtimePid === process.pid) return false
  if (!sameRuntimePath(runtimeDataDir, expectedBackendDataDir())) return false

  log(`[api] terminating stale crawshrimp backend pid=${runtimePid}`)
  if (!stopProcessTreeByPid(runtimePid)) return false
  return await waitForPidExit(runtimePid)
}

async function switchApiEndpoint() {
  const nextPort = await findAvailableApiPort(apiPort === DEFAULT_API_PORT ? DEFAULT_API_PORT + 1 : apiPort + 1)
  log(`[api] switching backend port ${apiPort} -> ${nextPort}`)
  apiPort = nextPort
  sendStatus('api', false)
  return true
}

function sendStatus(key, value) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status', { key, value })
  }
}

async function prepareBackendEndpoint() {
  if (await probeApiReady()) {
    if (await validateApiRuntime()) return
    await switchApiEndpoint()
    return
  }

  const availablePort = await findAvailableApiPort(apiPort)
  if (availablePort !== apiPort) {
    log(`[api] port ${apiPort} is occupied but no compatible backend responded`)
    apiPort = availablePort
    log(`[api] switching backend port to available port ${apiPort}`)
    sendStatus('api', false)
  }
}

const backendController = createBackendController({
  log,
  sendStatus,
  probeReady: () => probeApiReady(),
  validateReady: () => validateApiRuntime(),
  switchEndpoint: () => switchApiEndpoint(),
  startProcess: () => spawnBackendProcess(),
  stopProcess: (proc) => stopBackendProcess(proc),
  intervalMs: 500,
  attempts: BACKEND_STARTUP_ATTEMPTS,
  launchRetries: BACKEND_LAUNCH_RETRIES,
  retryDelayMs: 1200,
})

const restartBackend = createSingleFlightRecovery(async () => {
  log('[api] manual recovery requested')
  desktopServicesStartupPromise = null
  backendController.stop()
  resolvedCrawshrimpDataDir = ''
  await prepareBackendEndpoint()
  await backendController.ensureReady()
  const health = await getBackendHealth(1500)
  if (!health.ok || !isCompatibleBackendRuntime(health.data?.runtime)) {
    throw new Error('核心服务已重启，但健康检查未通过。')
  }
  const result = {
    ok: true,
    api: true,
    apiState: backendController.getState(),
    apiPort,
    apiBase: `http://127.0.0.1:${apiPort}`,
    apiToken: getApiToken(),
    dataDir: getCrawshrimpDataDir(),
    apiDiagnostic: backendController.getDiagnostics(),
    dataDirRecovery: { ...dataDirRecoveryInfo },
  }
  log(`[api] manual recovery complete on port ${apiPort}`)
  return result
})

async function startBackend() {
  await prepareBackendEndpoint()
  await backendController.ensureReady()
}

async function startChromeOnLaunch() {
  const chromeState = await probeChromeCdp()
  if (chromeState.ok) {
    const msg = 'CDP already ready on port ' + CDP_PORT
    log('[chrome] ' + msg)
    sendStatus('chrome', true)
    return { ok: true, msg }
  }

  log('[chrome] CDP not detected, auto-launching Chrome...')
  const result = await launchChrome()
  log('[chrome] ' + result.msg)
  sendStatus('chrome', result.ok)
  return result
}

function stopBackend() {
  backendController.stop()
  desktopServicesStartupPromise = null
}

async function getActiveTasksForQuit() {
  try {
    return await apiCall('GET', '/tasks/active', null, {
      ensureReady: false,
      timeoutMs: 1200,
    })
  } catch (error) {
    log(`[warn] failed to query active tasks before quit: ${error.message}`)
    return {
      active: 'unknown',
      unknown: true,
      reason: 'query-failed',
      error: error.message,
      tasks: [],
    }
  }
}

async function requestStopActiveTasks(tasks = []) {
  for (const task of tasks) {
    const adapterId = String(task.adapter_id || '').trim()
    const taskId = String(task.task_id || '').trim()
    if (!adapterId || !taskId) continue
    try {
      const result = await apiCall('POST', `/tasks/${encodeURIComponent(adapterId)}/${encodeURIComponent(taskId)}/stop`, null, {
        ensureReady: false,
        timeoutMs: 1500,
      })
      if (result && typeof result === 'object' && result.ok === false) {
        throw new Error(result.detail || result.error || 'backend rejected stop request')
      }
    } catch (error) {
      log(`[warn] failed to request stop for ${adapterId}/${taskId}: ${error.message}`)
    }
  }
}

async function waitForNoActiveTasks(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  let lastActive = null
  while (Date.now() < deadline) {
    const active = await getActiveTasksForQuit()
    lastActive = active
    if (active?.unknown || active?.active === 'unknown') {
      log('[warn] active task drain could not be verified before quit')
      return {
        active: 'unknown',
        unknown: true,
        reason: 'drain-unknown',
        error: active.error,
        tasks: Array.isArray(active.tasks) ? active.tasks : [],
      }
    }
    if (!active?.active || !Array.isArray(active.tasks) || active.tasks.length === 0) return true
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  log('[warn] timed out waiting for active tasks to stop before quit')
  return {
    active: 'unknown',
    unknown: true,
    reason: 'drain-timeout',
    tasks: Array.isArray(lastActive?.tasks) ? lastActive.tasks : [],
  }
}

async function confirmQuitWithActiveTasks(tasks = [], state = {}) {
  const count = Array.isArray(tasks) ? tasks.length : 0
  const detail = count > 0
    ? tasks.slice(0, 5).map(item => `- ${item.adapter_id}/${item.task_id} (${item.status || 'running'})`).join('\n')
    : ''
  const unknown = state?.unknown === true || state?.active === 'unknown'
  const buttons = unknown ? ['继续运行', '强制退出'] : ['继续运行', '停止任务并退出']
  const title = unknown ? '无法确认任务状态' : '任务仍在运行'
  const message = unknown
    ? '无法确认是否还有任务正在运行。强制退出可能导致任务中断或数据丢失。'
    : `还有 ${count} 个任务正在运行。`
  const detailText = unknown
    ? [state?.error ? `错误：${state.error}` : '', detail].filter(Boolean).join('\n')
    : `${detail}${count > 5 ? `\n- 另有 ${count - 5} 个任务...` : ''}\n\n退出会请求任务停止并等待导出收尾完成。`
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons,
    defaultId: 0,
    cancelId: 0,
    title,
    message,
    detail: detailText || '建议继续运行，等待任务状态恢复后再退出。',
    noLink: true,
  })
  return result.response === 1
}

async function stopManagedChromeForQuit() {
  const result = await stopManagedChromeFromState({
    stateFile: getManagedChromeStateFile(),
    expectedProfileDir: getManagedChromeProfileDir(),
    expectedCdpPort: CDP_PORT,
    isPidAlive,
    isManagedPid: isManagedChromePid,
    killPid: pid => stopProcessTreeByPid(pid),
    waitForPidExit: pid => waitForPidExit(pid, 3000),
    log,
  })
  if (result.stopped) {
    managedChromeProcess = null
    sendStatus('chrome', false)
  }
  return result
}

async function restoreWindowAfterQuitCanceled() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
  } else {
    mainWindow.show()
    mainWindow.focus()
  }
  return ensureDesktopServicesStarted().catch(error => {
    log(`[lifecycle] failed to restart services after quit cancellation: ${error.message}`)
  })
}

async function ensureDesktopServicesStarted() {
  if (!desktopServicesStartupPromise) {
    desktopServicesStartupPromise = startDesktopServices({
      startBackend,
      startChrome: startChromeOnLaunch,
      log,
    })
  }
  const startup = await desktopServicesStartupPromise
  if (startup.api.ok) log(`[api] ready on port ${apiPort}`)
  if (!startup.api.ok) desktopServicesStartupPromise = null
  return startup
}

const lifecycleController = createLifecycleController({
  platform: process.platform,
  getActiveTasks: getActiveTasksForQuit,
  confirmQuitWithActiveTasks,
  requestStopActiveTasks,
  waitForNoActiveTasks,
  stopBackend,
  stopManagedChrome: stopManagedChromeForQuit,
  quitApp: () => app.quit(),
  onQuitCanceled: restoreWindowAfterQuitCanceled,
  log,
})

const updatePlatformSupport = evaluateUpdatePlatform({
  platform: process.platform,
  isPackaged: app.isPackaged,
  execPath: process.execPath,
  homeDir: app.getPath('home'),
})

const updateFeedUrl = resolveUpdateFeedUrl({
  isTestBuild: APP_METADATA.crawshrimpUpdateTestBuild === true,
  env: process.env,
  configuredFeedUrl: APP_METADATA.crawshrimpUpdateFeedUrl,
})

function sendUpdateStatus(snapshot) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('update-status', snapshot)
}

function notifyUpdateReady() {
  if (!Notification?.isSupported?.()) return
  const notification = new Notification({
    title: '抓虾更新已下载',
    body: '当前任务已结束，可以重启安装新版本。',
  })
  notification.show()
}

function notifyUpdateAvailable(status = {}) {
  if (!Notification?.isSupported?.()) return
  const version = String(status.latestVersion || '').trim()
  const notification = new Notification({
    title: '抓虾发现新版本',
    body: version ? `v${version} 已可下载，点击侧边栏“更新”开始下载。` : '发现可用更新，点击侧边栏“更新”开始下载。',
  })
  notification.show()
}

const updateService = createUpdateService({
  app,
  autoUpdater,
  platformSupport: updatePlatformSupport,
  updateFeedUrl,
  getAvailableBytes: () => {
    const stats = fs.statfsSync(app.getPath('userData'))
    return Number(stats.bavail) * Number(stats.bsize)
  },
  emit: sendUpdateStatus,
  log: console,
})

const updateCoordinator = createUpdateInstallCoordinator({
  updateService,
  getReadiness: () => withUpdaterApiError(() => apiCall('GET', '/runtime/install-readiness', null, {
    ensureReady: false,
    timeoutMs: 1500,
  })),
  acquireDrain: () => withUpdaterApiError(() => apiCall('POST', '/runtime/update-drain', {}, {
    ensureReady: false,
    timeoutMs: 1500,
  })),
  releaseDrain: drainToken => withUpdaterApiError(() => apiCall('DELETE', '/runtime/update-drain', {
    drain_token: drainToken,
  }, {
    ensureReady: false,
    timeoutMs: 1500,
  })),
  shutdownForUpdate: () => lifecycleController.prepareForUpdateInstall(),
  recoverAfterCleanupFailure: async () => {
    lifecycleController.recoverFromUpdateInstallFailure()
    await ensureDesktopServicesStarted()
  },
  notifyReady: notifyUpdateReady,
  log,
})

const updateCheckScheduler = createUpdateCheckScheduler({
  updateService,
  supported: updatePlatformSupport.supported,
  notifyAvailable: notifyUpdateAvailable,
  log,
})

function scheduleInitialUpdateCheck() {
  if (!updatePlatformSupport.supported) return
  updateCoordinator.start()
  updateCheckScheduler.start()
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

configureSingleInstance({
  app,
  getWindow: () => mainWindow,
  createWindow,
  onPrimary: () => {
    app.whenReady().then(async () => {
      hideNativeAppMenu()
      protocol.handle(BALA_WORKSPACE_MEDIA_PROTOCOL, handleBalaWorkspaceMediaRequest)
      protocol.handle(LOCAL_MEDIA_PROTOCOL, handleLocalMediaRequest)
      ensureDefaultLocalMediaRoots()
      createWindow()
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
        ensureDesktopServicesStarted()
      })

      scheduleInitialUpdateCheck()
      await ensureDesktopServicesStarted()
    })

    app.on('browser-window-focus', () => {
      updateCheckScheduler.onAppFocus()
    })

    powerMonitor.on('resume', () => {
      updateCheckScheduler.onAppFocus()
    })

    app.on('window-all-closed', () => {
      lifecycleController.handleWindowAllClosed()
    })

    app.on('before-quit', (event) => {
      lifecycleController.handleBeforeQuit(event).catch(error => {
        log(`[lifecycle] before-quit failed: ${error.message}`)
      })
    })

    app.on('will-quit', () => {
      updateCheckScheduler.dispose()
      updateCoordinator.dispose()
      updateService.dispose()
    })
  },
})

// ── IPC handlers ──────────────────────────────────────────────────────────────

async function getDesktopStatus() {
  const backendHealth = await getBackendHealth()
  const backendAvailability = classifyBackendHealth(backendHealth, isCompatibleBackendRuntime)
  const chromeAvailable = (await probeChromeCdp()).ok
  return {
    api: backendAvailability.compatible,
    apiReachable: backendAvailability.reachable,
    apiState: backendController.getState(),
    apiDiagnostic: backendController.getDiagnostics(),
    chrome: chromeAvailable,
    chromeDiagnostic: { ...lastChromeDiagnostic },
    apiPort,
    apiBase: `http://127.0.0.1:${apiPort}`,
    apiToken: getApiToken(),
    cdpPort: CDP_PORT,
    pythonBin: getPythonBin(),
    dataDir: getCrawshrimpDataDir(),
    dataDirRecovery: { ...dataDirRecoveryInfo },
    dev: IS_DEV,
  }
}

secureHandle('get-status', async () => getDesktopStatus())

secureHandle('restart-backend', async () => restartBackend())
secureHandle('open-diagnostic-log', async () => {
  const logPath = getDesktopLogPath()
  if (fs.existsSync(logPath)) shell.showItemInFolder(logPath)
  else await shell.openPath(path.dirname(logPath))
  return { ok: true, path: logPath }
})

secureHandle('update:get-status', async () => updateService.getStatus())
secureHandle('update:check', async () => {
  if (updateService.getStatus().downloaded) {
    await updateCoordinator.refreshReadiness()
    return updateService.getStatus()
  }
  await updateService.checkForUpdates({ manual: true })
  return updateService.getStatus()
})
secureHandle('update:download', async () => {
  await updateService.downloadUpdate()
  return updateService.getStatus()
})
secureHandle('update:install', async () => updateCoordinator.requestInstall())

secureHandle('launch-chrome', async (_, customPath) => launchChrome(customPath || ''))
secureHandle('check-chrome', async () => ({ ok: (await probeChromeCdp()).ok }))

secureHandle('get-chrome-tabs', async () => {
  try { return await apiCall('GET', '/settings/chrome-tabs') } catch { return [] }
})
secureHandle('get-current-chrome-tab', async () => {
  try {
    return await resolveCurrentChromeTab()
  } catch {
    return null
  }
})

secureHandle('get-adapters',     async () => apiCall('GET',    '/adapters'))
secureHandle('uninstall-adapter',async (_, id) => apiCall('DELETE', `/adapters/${id}`))
secureHandle('enable-adapter',   async (_, id, enabled) =>
  apiCall('PATCH', `/adapters/${id}/enable`, { enabled }))
secureHandle('get-script-favorites', async () => apiCall('GET', '/script-favorites'))
secureHandle('favorite-script', async (_, id) => apiCall('PUT', `/script-favorites/${id}`))
secureHandle('unfavorite-script', async (_, id) => apiCall('DELETE', `/script-favorites/${id}`))

secureHandle('install-adapter', async (_, payload) => {
  const installMode = payload?.install_mode || 'copy'
  if (payload.path) {
    return apiCall('POST', '/adapters/install', { path: payload.path, install_mode: installMode })
  }
  if (payload.file) {
    const raw = fs.readFileSync(payload.file)
    return apiCall('POST', '/adapters/install', { zip_base64: raw.toString('base64'), install_mode: installMode })
  }
  return { ok: false, error: 'No path or file provided' }
})

secureHandle('get-tasks',       async () => apiCall('GET', '/tasks', null, {
  retries: 20,
  retryDelayMs: 500,
}))
secureHandle('list-task-instances', async (_, query = {}) =>
  apiCall('GET', `/task-instances?${new URLSearchParams(query || {})}`))
secureHandle('create-task-instance', async (_, payload) =>
  apiCall('POST', '/task-instances', payload || {}))
secureHandle('get-task-instance', async (_, instanceUid) =>
  apiCall('GET', `/task-instances/${encodeURIComponent(String(instanceUid || ''))}`))
secureHandle('update-task-instance', async (_, instanceUid, payload) =>
  apiCall('PATCH', `/task-instances/${encodeURIComponent(String(instanceUid || ''))}`, payload || {}))
secureHandle('run-task-instance', async (_, instanceUid, options = {}) =>
  apiCall('POST', `/task-instances/${encodeURIComponent(String(instanceUid || ''))}/run`, options || {}))
secureHandle('list-task-schedules', async (_, query = {}) =>
  apiCall('GET', `/task-schedules?${new URLSearchParams(query || {})}`))
secureHandle('create-task-schedule', async (_, payload) =>
  apiCall('POST', '/task-schedules', payload || {}))
secureHandle('get-task-schedule', async (_, scheduleUid) =>
  apiCall('GET', `/task-schedules/${encodeURIComponent(String(scheduleUid || ''))}`))
secureHandle('update-task-schedule', async (_, scheduleUid, payload) =>
  apiCall('PATCH', `/task-schedules/${encodeURIComponent(String(scheduleUid || ''))}`, payload || {}))
secureHandle('delete-task-schedule', async (_, scheduleUid) =>
  apiCall('DELETE', `/task-schedules/${encodeURIComponent(String(scheduleUid || ''))}`))
secureHandle('run-task-schedule-now', async (_, scheduleUid) =>
  apiCall('POST', `/task-schedules/${encodeURIComponent(String(scheduleUid || ''))}/run-now`, {}))
secureHandle('list-ai-image-jobs', async () =>
  apiCall('GET', '/ai-image/jobs'))
secureHandle('create-ai-image-job', async (_, payload) =>
  apiCall('POST', '/ai-image/jobs', payload || {}))
secureHandle('get-ai-image-job', async (_, jobUid) =>
  apiCall('GET', `/ai-image/jobs/${encodeURIComponent(String(jobUid || ''))}`))
secureHandle('update-ai-image-job', async (_, jobUid, payload) =>
  apiCall('PATCH', `/ai-image/jobs/${encodeURIComponent(String(jobUid || ''))}`, payload || {}))
secureHandle('set-ai-image-job-pinned', async (_, jobUid, pinned) =>
  apiCall('PATCH', `/ai-image/jobs/${encodeURIComponent(String(jobUid || ''))}/pin`, { pinned: Boolean(pinned) }))
secureHandle('delete-ai-image-job', async (_, jobUid) =>
  apiCall('DELETE', `/ai-image/jobs/${encodeURIComponent(String(jobUid || ''))}`))
secureHandle('run-ai-image-job', async (_, jobUid) =>
  apiCall('POST', `/ai-image/jobs/${encodeURIComponent(String(jobUid || ''))}/run`, {}, { timeoutMs: 20 * 60 * 1000 }))
secureHandle('batch-run-ai-image-job', async (_, jobUid, payload) =>
  apiCall('POST', `/ai-image/jobs/${encodeURIComponent(String(jobUid || ''))}/batch-run`, payload || {}))
secureHandle('retry-ai-image-run', async (_, jobUid, runUid) =>
  apiCall('POST', `/ai-image/jobs/${encodeURIComponent(String(jobUid || ''))}/runs/${encodeURIComponent(String(runUid || ''))}/retry`, {}))
secureHandle('save-as-ai-image-job', async (_, jobUid, payload) =>
  apiCall('POST', `/ai-image/jobs/${encodeURIComponent(String(jobUid || ''))}/save-as`, payload || {}))
secureHandle('materialize-ai-image-result', async (_, jobUid, payload) =>
  apiCall('POST', `/ai-image/jobs/${encodeURIComponent(String(jobUid || ''))}/materialize`, payload || {}))
secureHandle('create-ai-image-asset', async (_, payload) =>
  apiCall('POST', '/ai-image/assets', payload || {}))
secureHandle('create-ai-image-canvas', async (_, payload) =>
  apiCall('POST', '/ai-image/canvases', payload || {}))
secureHandle('ai-video:get-config', async () =>
  aiVideoConfigForRenderer())
secureHandle('ai-video:select-files', async (_, opts = {}) =>
  selectAiVideoFiles(opts || {}))
secureHandle('ai-video:select-directory', async (_, opts = {}) =>
  selectAiVideoDirectory(opts || {}))
secureHandle('ai-video:get-saved-directory', async (_, scope = 'input') =>
  getSavedAiVideoDirectory(scope))
secureHandle('ai-video:list-directory', async (_, directoryToken, opts = {}) =>
  listAiVideoDirectory(directoryToken, opts || {}))
secureHandle('ai-video:open-directory', async (_, directoryToken) =>
  openAiVideoDirectory(directoryToken))
secureHandle('ai-video:open-file', async (_, fileToken) =>
  openAiVideoFile(fileToken))
secureHandle('ai-video:get-media-url', async (_, fileToken) =>
  aiVideoMediaForRenderer(fileToken))
secureHandle('ai-video:read-image-preview', async (_, fileToken) =>
  readAiVideoImagePreview(fileToken))
secureHandle('ai-video:read-image-thumbnail', async (_, fileToken, opts = {}) => {
  try {
    return readAiVideoImageThumbnail(fileToken, opts || {})
  } catch (error) {
    return { ok: false, error: error?.message || String(error) }
  }
})
secureHandle('ai-video:validate', async (_, payload) =>
  apiCall('POST', '/ai-video/validate', payload || {}))
secureHandle('ai-video:create-job', async (_, payload) =>
  apiCall('POST', '/ai-video/jobs', payload || {}))
secureHandle('ai-video:list-jobs', async (_, query = {}) => {
  const params = new URLSearchParams()
  if (query?.status) params.set('status', String(query.status))
  if (query?.provider) params.set('provider', String(query.provider))
  if (query?.limit) params.set('limit', String(query.limit))
  const suffix = params.toString()
  return apiCall('GET', `/ai-video/jobs${suffix ? `?${suffix}` : ''}`)
})
secureHandle('ai-video:get-job', async (_, jobId) =>
  apiCall('GET', `/ai-video/jobs/${encodeURIComponent(String(jobId || ''))}`))
secureHandle('ai-video:update-job', async (_, jobId, payload) =>
  apiCall('PATCH', `/ai-video/jobs/${encodeURIComponent(String(jobId || ''))}`, payload || {}))
secureHandle('ai-video:duplicate-job', async (_, jobId) =>
  apiCall('POST', `/ai-video/jobs/${encodeURIComponent(String(jobId || ''))}/duplicate`, {}))
secureHandle('ai-video:retry-job', async (_, jobId, payload) =>
  apiCall('POST', `/ai-video/jobs/${encodeURIComponent(String(jobId || ''))}/retry`, payload || {}))
secureHandle('ai-video:delete-job-record', async (_, jobId) =>
  apiCall('DELETE', `/ai-video/jobs/${encodeURIComponent(String(jobId || ''))}`))
secureHandle('ai-video:get-run', async (_, runId) =>
  apiCall('GET', `/ai-video/runs/${encodeURIComponent(String(runId || ''))}`))
secureHandle('ai-video:retry-archive', async (_, runId) =>
  apiCall('POST', `/ai-video/runs/${encodeURIComponent(String(runId || ''))}/archive`, {}))
secureHandle('probe-task-params', async (_, aid, tid, params, options) =>
  apiCall('POST', `/tasks/${aid}/${tid}/params/probe`, {
    params: params || {},
    current_tab_id: options?.current_tab_id || '',
  }))
secureHandle('run-task', async (_, aid, tid, params, options) =>
  apiCall('POST', `/tasks/${aid}/${tid}/run`, {
    params: params || {},
    current_tab_id: options?.current_tab_id || '',
  }))
secureHandle('pause-task', async (_, aid, tid, instanceUid = '') => {
  const uid = String(instanceUid || '').trim()
  return uid
    ? apiCall('POST', `/task-instances/${encodeURIComponent(uid)}/pause`)
    : apiCall('POST', `/tasks/${aid}/${tid}/pause`)
})
secureHandle('resume-task', async (_, aid, tid, instanceUid = '') => {
  const uid = String(instanceUid || '').trim()
  return uid
    ? apiCall('POST', `/task-instances/${encodeURIComponent(uid)}/resume`)
    : apiCall('POST', `/tasks/${aid}/${tid}/resume`)
})
secureHandle('stop-task', async (_, aid, tid, instanceUid = '') => {
  const uid = String(instanceUid || '').trim()
  return uid
    ? apiCall('POST', `/task-instances/${encodeURIComponent(uid)}/stop`)
    : apiCall('POST', `/tasks/${aid}/${tid}/stop`)
})
secureHandle('get-task-status', async (_, aid, tid, instanceUid = '') => {
  const uid = String(instanceUid || '').trim()
  return apiCall('GET', uid
    ? `/task-instances/${encodeURIComponent(uid)}/run-status`
    : `/tasks/${aid}/${tid}/status`, null, {
  ensureReady: false,
  })
})
secureHandle('get-task-logs', async (_, aid, tid, instanceUid = '') => {
  const uid = String(instanceUid || '').trim()
  return apiCall('GET', uid
    ? `/task-instances/${encodeURIComponent(uid)}/logs`
    : `/tasks/${aid}/${tid}/logs`, null, {
  ensureReady: false,
  })
})
secureHandle('clear-task-logs', async (_, aid, tid, instanceUid = '') => {
  const uid = String(instanceUid || '').trim()
  return apiCall('DELETE', uid
    ? `/task-instances/${encodeURIComponent(uid)}/logs`
    : `/tasks/${aid}/${tid}/logs`)
})

secureHandle('get-data',    async (_, aid, tid) => apiCall('GET', `/data/${aid}/${tid}`, null, {
  ensureReady: false,
}))
secureHandle('export-data', async (_, aid, tid, fmt) => {
  try {
    const res = await apiCall('GET', `/data/${aid}/${tid}/export?format=${fmt}`)
    return { ok: true, result: res }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

secureHandle('open-file', async (_, filePath) => {
  try {
    const parsed = new URL(String(filePath || ''))
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      await shell.openExternal(parsed.toString())
      return { ok: true }
    }
  } catch {}
  shell.openPath(filePath)
  return { ok: true }
})

secureHandle('open-external-url', async (_, rawUrl) => {
  const parsed = new URL(String(rawUrl || ''))
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP(S) URLs can be opened externally')
  }
  await shell.openExternal(parsed.toString())
  return { ok: true }
})

function approvalTokenQuery(token) {
  return `token=${encodeURIComponent(String(token || ''))}`
}

secureHandle('get-tmall-approval-batch', async (_, batchId, token) => {
  return apiCall('GET', `/tmall-ai-image-approval/api/${encodeURIComponent(String(batchId || ''))}?${approvalTokenQuery(token)}`)
})

secureHandle('save-tmall-approval-decisions', async (_, batchId, token, decisions) => {
  return apiCall(
    'POST',
    `/tmall-ai-image-approval/api/${encodeURIComponent(String(batchId || ''))}/decisions?${approvalTokenQuery(token)}`,
    { decisions: decisions || {} },
  )
})

secureHandle('import-tmall-approval-reference-files', async (_, batchId, token, paths) => {
  return apiCall(
    'POST',
    `/tmall-ai-image-approval-local/api/${encodeURIComponent(String(batchId || ''))}/reference-files?${approvalTokenQuery(token)}`,
    { paths: Array.isArray(paths) ? paths : [] },
  )
})

secureHandle('regenerate-tmall-approval-asset', async (_, batchId, token, payload) => {
  return apiCall(
    'POST',
    `/tmall-ai-image-approval/api/${encodeURIComponent(String(batchId || ''))}/regenerate?${approvalTokenQuery(token)}`,
    payload || {},
    { timeoutMs: 20 * 60 * 1000 },
  )
})

secureHandle('generate-tmall-approval-asset', async (_, batchId, token, payload) => {
  return apiCall(
    'POST',
    `/tmall-ai-image-approval/api/${encodeURIComponent(String(batchId || ''))}/generate?${approvalTokenQuery(token)}`,
    payload || {},
    { timeoutMs: 20 * 60 * 1000 },
  )
})

secureHandle('submit-tmall-approval-generation', async (_, batchId, token, payload) => {
  return apiCall(
    'POST',
    `/tmall-ai-image-approval/api/${encodeURIComponent(String(batchId || ''))}/submit-generation?${approvalTokenQuery(token)}`,
    payload || {},
    { timeoutMs: 20 * 60 * 1000 },
  )
})

secureHandle('submit-tmall-approval-batch', async (_, batchId, token) => {
  return apiCall(
    'POST',
    `/tmall-ai-image-approval/api/${encodeURIComponent(String(batchId || ''))}/submit?${approvalTokenQuery(token)}`,
    null,
    { timeoutMs: 20 * 60 * 1000 },
  )
})

secureHandle('create-bala-material-batch', async (_, rows, sourceTask) => {
  return apiCall('POST', '/bala-ai-video-materials/api/from-rows', {
    rows: rows || [],
    source_task: sourceTask || {},
  })
})

secureHandle('get-bala-material-batch', async (_, batchId, token) => {
  return apiCall('GET', `/bala-ai-video-materials/api/${encodeURIComponent(String(batchId || ''))}?${approvalTokenQuery(token)}`)
})

secureHandle('save-bala-material-selection', async (_, batchId, token, selectedAssetIds) => {
  return apiCall(
    'POST',
    `/bala-ai-video-materials/api/${encodeURIComponent(String(batchId || ''))}/selection?${approvalTokenQuery(token)}`,
    { selected_asset_ids: selectedAssetIds || [] },
  )
})

secureHandle('export-bala-ai-input', async (_, batchId, token, payload) => {
  return apiCall(
    'POST',
    `/bala-ai-video-materials/api/${encodeURIComponent(String(batchId || ''))}/export-ai-input?${approvalTokenQuery(token)}`,
    payload || {},
  )
})

secureHandle('list-bala-model-library', async (_, filters = {}) => {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters || {})) {
    if (value !== undefined && value !== null && String(value) !== '') {
      query.set(key, String(value))
    }
  }
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return apiCall('GET', `/bala-ai-video-model-library/api${suffix}`)
})

secureHandle('list-bala-video-templates', async (_, filters = {}) => {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters || {})) {
    if (value !== undefined && value !== null && String(value) !== '') {
      query.set(key, String(value))
    }
  }
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return apiCall('GET', `/bala-ai-video-templates/api${suffix}`)
})

secureHandle('run-bala-seedance-video', async (_, payload = {}) => {
  return apiCall(
    'POST',
    '/bala-ai-video-seedance/api/run',
    payload || {},
    { timeoutMs: 2 * 60 * 60 * 1000 },
  )
})

secureHandle('get-bala-video-provider-status', async () => {
  return apiCall('GET', '/bala-ai-video-providers/api/status')
})

secureHandle('preflight-bala-video-provider', async (_, payload = {}) => {
  return apiCall('POST', '/bala-ai-video-providers/api/preflight', payload || {})
})

secureHandle('refresh-bala-video-provider-task', async (_, payload = {}) => {
  return apiCall(
    'POST',
    '/bala-ai-video-providers/api/task',
    payload || {},
    { timeoutMs: 2 * 60 * 60 * 1000 },
  )
})

secureHandle('run-bala-happyhorse-video', async (_, payload = {}) => {
  return apiCall(
    'POST',
    '/bala-ai-video-happyhorse/api/run',
    payload || {},
    { timeoutMs: 2 * 60 * 60 * 1000 },
  )
})

secureHandle('get-bala-review-batch', async (_, batchId, token) => {
  return apiCall('GET', `/bala-ai-video-review/api/${encodeURIComponent(String(batchId || ''))}?${approvalTokenQuery(token)}`)
})

secureHandle('list-bala-review-workspace-batches', async (_, filters = {}) => {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters || {})) {
    if (value !== undefined && value !== null && String(value).trim()) query.set(key, String(value))
  }
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return apiCall('GET', `/bala-ai-video-review-workspace/api/batches${suffix}`)
})

secureHandle('save-bala-review-decisions', async (_, batchId, token, decisions) => {
  return apiCall(
    'POST',
    `/bala-ai-video-review/api/${encodeURIComponent(String(batchId || ''))}/decisions?${approvalTokenQuery(token)}`,
    { decisions: decisions || {} },
  )
})

secureHandle('delete-bala-review-asset', async (_, batchId, token, assetId) => {
  return apiCall(
    'DELETE',
    `/bala-ai-video-review/api/${encodeURIComponent(String(batchId || ''))}/asset/${encodeURIComponent(String(assetId || ''))}?${approvalTokenQuery(token)}`,
  )
})

secureHandle('refresh-bala-review-batch', async (_, batchId, token) => {
  return apiCall(
    'POST',
    `/bala-ai-video-review/api/${encodeURIComponent(String(batchId || ''))}/refresh?${approvalTokenQuery(token)}`,
    {},
  )
})

secureHandle('regenerate-bala-review-asset', async (_, batchId, token, payload) => {
  return apiCall(
    'POST',
    `/bala-ai-video-review/api/${encodeURIComponent(String(batchId || ''))}/regenerate?${approvalTokenQuery(token)}`,
    payload || {},
    { timeoutMs: 20 * 60 * 1000 },
  )
})

secureHandle('export-bala-video-input', async (_, batchId, token, payload) => {
  return apiCall(
    'POST',
    `/bala-ai-video-review/api/${encodeURIComponent(String(batchId || ''))}/export-video-input?${approvalTokenQuery(token)}`,
    payload || {},
    { timeoutMs: 5 * 60 * 1000 },
  )
})

secureHandle('get-cloud-approval-status', async (_, options = {}) => apiCall(
  'GET',
  options?.refresh ? '/cloud-approval/status?refresh=true' : '/cloud-approval/status',
))
secureHandle('save-cloud-approval-config', async (_, payload) =>
  apiCall('POST', '/cloud-approval/config', payload || {}))
secureHandle('enroll-cloud-machine', async (_, payload) =>
  apiCall('POST', '/cloud-approval/enroll-machine', payload || {}))
secureHandle('start-cloud-machine', async () =>
  apiCall('POST', '/cloud-approval/machine/start', {}))
secureHandle('stop-cloud-machine', async () =>
  apiCall('POST', '/cloud-approval/machine/stop', {}))
secureHandle('sync-cloud-approval-batch', async (_, payload) =>
  apiCall('POST', '/cloud-approval/sync-batch', payload || {}, { timeoutMs: 20 * 60 * 1000 }))
secureHandle('list-cloud-prompt-libraries', async () =>
  listCloudPromptLibrariesForDesktop())
secureHandle('resolve-cloud-prompt-templates', async (_, libraryId, query = {}) => {
  return resolveCloudPromptTemplatesForDesktop(libraryId, query)
})
secureHandle('list-local-prompt-libraries', async () => listLocalPromptLibraries())
secureHandle('create-local-prompt-library', async (_, payload) => createLocalPromptLibrary(payload || {}))
secureHandle('import-local-prompt-library', async (_, payload) => upsertLocalPromptLibrary(payload || {}))
secureHandle('save-local-prompt-library', async (_, libraryUid, payload) => saveLocalPromptLibrary(libraryUid, payload || {}))
secureHandle('sync-local-prompt-library-to-cloud', async (_, libraryUid) => syncLocalPromptLibraryToCloud(libraryUid))

secureHandle('get-settings', async () => {
  const cfg = await apiCall('GET', '/settings')
  const desktopCfg = readDesktopConfig()
  const desktopDataDir = resolveConfiguredDataDir(desktopCfg.data_dir || '')
  cfg.data_dir = desktopDataDir || getCrawshrimpDataDir()
  return cfg
})
secureHandle('save-settings', async (_, cfg) => {
  const plain = cfg && typeof cfg === 'object' ? cfg : {}
  const dataDir = resolveConfiguredDataDir(plain.data_dir || '')
  if (dataDir) {
    plain.data_dir = dataDir
    preferredCrawshrimpDataDir = dataDir
    writeDesktopConfig({ data_dir: dataDir })
  } else {
    preferredCrawshrimpDataDir = ''
    writeDesktopConfig({ data_dir: '' })
  }
  const result = await apiCall('PUT', '/settings', plain)
  return dataDir && !sameRuntimePath(dataDir, getCrawshrimpDataDir())
    ? { ...result, restart_required: true }
    : result
})

secureHandle('patch-settings', async (_, cfg) => {
  const plain = cfg && typeof cfg === 'object' ? { ...cfg } : {}
  const hasDataDir = Object.prototype.hasOwnProperty.call(plain, 'data_dir')
  let restartRequired = false

  if (hasDataDir) {
    const dataDir = resolveConfiguredDataDir(plain.data_dir || '')
    if (dataDir) {
      plain.data_dir = dataDir
      preferredCrawshrimpDataDir = dataDir
      writeDesktopConfig({ data_dir: dataDir })
      restartRequired = !sameRuntimePath(dataDir, getCrawshrimpDataDir())
    } else {
      plain.data_dir = ''
      preferredCrawshrimpDataDir = ''
      writeDesktopConfig({ data_dir: '' })
    }
  }

  const result = await apiCall('PATCH', '/settings', plain)
  return restartRequired ? { ...result, restart_required: true } : result
})

secureHandle('stat-file', async (_, filePath) => {
  try {
    const stat = fs.statSync(filePath)
    return {
      size: stat.size,
      ctime: stat.birthtime.toISOString(),
      mtime: stat.mtime.toISOString(),
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
    }
  } catch { return null }
})

secureHandle('reveal-file', async (_, filePath) => {
  shell.showItemInFolder(filePath)
  return { ok: true }
})

secureHandle('delete-file', async (_, filePath) => {
  return apiCall('POST', '/files/delete', { paths: [filePath] })
})

secureHandle('delete-files', async (_, filePaths) => {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths]
  return apiCall('POST', '/files/delete', {
    paths: paths.filter(Boolean),
  })
})

secureHandle('sync-odps-files', async (_, payload) => {
  return apiCall('POST', '/data-sync/odps', {
    adapter_id: payload?.adapter_id || '',
    task_id: payload?.task_id || '',
    paths: Array.isArray(payload?.paths) ? payload.paths.filter(Boolean) : [],
    endpoint: payload?.endpoint || '',
    app_code: payload?.app_code || '',
  })
})

secureHandle('save-as-file', async (_, srcPath) => {
  const resolvedSrcPath = resolveExistingFilePath(srcPath)
  if (!resolvedSrcPath) {
    throw new Error(`源文件不存在：${srcPath}`)
  }
  try {
    return await saveExistingFileAs(resolvedSrcPath)
  } catch (e) {
    throw new Error(e.message)
  }
})

secureHandle('save-adapter-template', async (_, adapterId, templateFile, templatePath = '') => {
  const resolvedSrcPath = resolveAdapterTemplatePath(adapterId, templateFile, templatePath)
  if (!resolvedSrcPath) {
    throw new Error(`模板文件不存在：${templateFile || templatePath}`)
  }
  try {
    return await saveExistingFileAs(resolvedSrcPath)
  } catch (e) {
    throw new Error(e.message)
  }
})

secureHandle('browse-file', async (_, opts = {}) => {
  const props = opts.directory ? ['openDirectory'] : ['openFile']
  if (opts.multi && !opts.directory) props.push('multiSelections')
  const filters = opts.filters || (opts.excel
    ? [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }, { name: '所有文件', extensions: ['*'] }]
    : opts.images
      ? [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp'] }, { name: '所有文件', extensions: ['*'] }]
      : opts.zip
        ? [{ name: 'ZIP 压缩包', extensions: ['zip'] }, { name: '所有文件', extensions: ['*'] }]
        : opts.pdf
          ? [{ name: 'PDF 文件', extensions: ['pdf'] }, { name: '所有文件', extensions: ['*'] }]
          : [{ name: '所有文件', extensions: ['*'] }])
  const res = await dialog.showOpenDialog(mainWindow, {
    title: opts.title || '选择文件',
    defaultPath: opts.defaultPath || undefined,
    properties: props,
    filters,
  })
  if (res.canceled) return opts.multi ? [] : ''
  const selected = opts.multi ? (res.filePaths || []) : (res.filePaths[0] || '')
  // Authorize selected directories (and parent of selected files) for local media playback.
  const paths = opts.multi ? selected : (selected ? [selected] : [])
  for (const item of paths) {
    try {
      const target = String(item || '').trim()
      if (!target) continue
      const st = fs.statSync(target)
      authorizeLocalMediaRoot(st.isDirectory() ? target : path.dirname(target))
    } catch { /* ignore authorization failures */ }
  }
  return selected
})

secureHandle('select-bala-workspace', async (_, opts = {}) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: opts.title || '选择 AI 视频工作区目录',
    defaultPath: opts.defaultPath || undefined,
    properties: ['openDirectory', 'createDirectory'],
  })
  if (res.canceled || !res.filePaths?.length) return ''
  const storePath = ensureBalaWorkspaceAuthorizationsLoaded()
  return rememberAuthorizedBalaWorkspaceRoot(res.filePaths[0], {
    roots: authorizedBalaWorkspaceRoots,
    storePath,
  })
})

secureHandle('delete-bala-workspace-image', async (_, workspaceRoot, filePath) => {
  ensureBalaWorkspaceAuthorizationsLoaded()
  return deleteAuthorizedWorkspaceImage({
    workspaceRoot,
    filePath,
    roots: authorizedBalaWorkspaceRoots,
  })
})

secureHandle('get-bala-workspace-video-media', async (_, workspaceRoot, filePath) => {
  ensureBalaWorkspaceAuthorizationsLoaded()
  const media = getAuthorizedBalaWorkspaceVideo({
    workspaceRoot,
    filePath,
    roots: authorizedBalaWorkspaceRoots,
  })
  return {
    ok: true,
    ...media,
    media_url: balaWorkspaceMediaUrl(workspaceRoot, media.path),
  }
})

secureHandle('get-local-media-url', async (_, filePath) => {
  const media = getAuthorizedLocalMediaFile(filePath)
  const fileToken = signAiVideoCapability({
    secret: AI_VIDEO_CAPABILITY_SECRET,
    kind: 'file',
    scope: 'media',
    filePath: media.path,
  })
  return {
    ok: true,
    mime: media.mime,
    size: media.size,
    media_url: localMediaUrl(fileToken),
  }
})

secureHandle('read-bala-workspace-manifest', async (_, workspaceRoot) => {
  ensureBalaWorkspaceAuthorizationsLoaded()
  return readAuthorizedBalaWorkspaceManifest({
    workspaceRoot,
    roots: authorizedBalaWorkspaceRoots,
  })
})

secureHandle('write-bala-workspace-manifest', async (_, workspaceRoot, payload) => {
  ensureBalaWorkspaceAuthorizationsLoaded()
  return writeAuthorizedBalaWorkspaceManifest({
    workspaceRoot,
    payload,
    roots: authorizedBalaWorkspaceRoots,
  })
})

secureHandle('read-local-image-preview', async (_, filePath) => {
  const media = getAuthorizedLocalMediaFile(filePath)
  if (!String(media.mime || '').startsWith('image/')) throw new Error('该文件不是图片')
  return readLocalImageDataUrl(media.path)
})

secureHandle('read-local-image-thumbnail', async (_, filePath, opts = {}) => {
  try {
    const media = getAuthorizedLocalMediaFile(filePath)
    if (!String(media.mime || '').startsWith('image/')) throw new Error('该文件不是图片')
    return readLocalImageThumbnail(media.path, opts || {})
  } catch (error) {
    return { ok: false, error: error?.message || String(error) }
  }
})

secureHandle('list-directory-files', async (_, rootPath, opts = {}) => {
  const directory = getAuthorizedLocalMediaDirectory(rootPath)
  return listDirectoryFilesSnapshot(directory, opts)
})

secureHandle('render-pdf-preview', async (_, filePath) => {
  try {
    return renderPdfPreviewWithQuickLook(String(filePath || ''))
  } catch (error) {
    return { ok: false, error: error.message || String(error) }
  }
})

secureHandle('read-excel', async (_, filePath, options = {}) => {
  try {
    return await apiCall('POST', '/files/read-excel', {
      path: filePath,
      sheet: options?.sheet || null,
      header_row: Number(options?.header_row || options?.headerRow || 1) || 1,
    })
  } catch (e) {
    return { error: e.message, headers: [], rows: [], total: 0 }
  }
})

secureHandle('test-notify', async (_, channel) => {
  try {
    return await apiCall('POST', '/settings/test-notify', { channel })
  } catch (e) {
    return { ok: false, error: e.message }
  }
})
