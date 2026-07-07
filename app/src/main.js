'use strict'

// Prevent child processes from accidentally inheriting ELECTRON_RUN_AS_NODE
delete process.env.ELECTRON_RUN_AS_NODE

const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron')
const path   = require('path')
const fs     = require('fs')
const http   = require('http')
const crypto = require('crypto')
const { fileURLToPath } = require('url')
const { spawn, execSync, execFileSync } = require('child_process')
const { createBackendController } = require('./backendController')
const { createLifecycleController } = require('./lifecycleController')
const { stopManagedChrome: stopManagedChromeFromState } = require('./managedChrome')
const { startDesktopServices } = require('./startupServices')
const { requestBackendApi } = require('./backendApi')

const DEFAULT_API_PORT = parseInt(process.env.CRAWSHRIMP_PORT || '18765')
let apiPort = DEFAULT_API_PORT
const DEV_RENDERER_URL = process.env.CRAWSHRIMP_RENDERER_URL || 'http://127.0.0.1:5173'
const API_TOKEN_HEADER = 'X-Crawshrimp-Token'
const CDP_PORT = 9222
const IS_DEV   = !app.isPackaged
const BACKEND_STARTUP_ATTEMPTS = process.platform === 'win32' ? 60 : 20
const BACKEND_LAUNCH_RETRIES = process.platform === 'win32' ? 2 : 1
const BACKEND_INSTANCE_ID = crypto.randomUUID()
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
  const explicit = String(process.env.CRAWSHRIMP_DATA || '').trim()
  const candidates = [resolveCrawshrimpDataDir()]
  if (!explicit && process.platform === 'win32') {
    candidates.push(path.join(app.getPath('home'), '.crawshrimp'))
    candidates.push(getWindowsLocalCrawshrimpDataDir())
  }
  if (!explicit && process.platform === 'darwin') {
    candidates.push(path.join(app.getPath('home'), '.crawshrimp'))
    candidates.push(getMacLocalCrawshrimpDataDir())
  }

  const seen = new Set()
  const errors = []
  for (const candidate of candidates) {
    const dirPath = path.resolve(candidate)
    const key = dirPath.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    try {
      const writable = ensureWritableDataDir(dirPath)
      process.env.CRAWSHRIMP_DATA = writable
      writeDesktopConfig({ data_dir: writable })
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
  return new Promise((resolve) => {
    let done = false
    const finish = (result) => {
      if (done) return
      done = true
      resolve(result)
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port: CDP_PORT,
      path: '/json/version',
      method: 'GET',
      timeout: timeoutMs,
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          finish({ ok: false, statusCode: res.statusCode || 0 })
          return
        }
        try {
          const parsed = JSON.parse(data || '{}')
          const browser = String(parsed.Browser || '')
          finish({
            ok: Boolean(browser),
            browser,
            protocolVersion: String(parsed['Protocol-Version'] || ''),
            webSocketDebuggerUrl: String(parsed.webSocketDebuggerUrl || ''),
          })
        } catch (error) {
          finish({ ok: false, error: error.message })
        }
      })
    })

    req.on('error', (error) => finish({ ok: false, error: error.message }))
    req.on('timeout', () => {
      req.destroy(new Error('timeout'))
      finish({ ok: false, error: 'timeout' })
    })
    req.end()
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

async function launchChrome(customPath = '') {
  const isWin = process.platform === 'win32'
  const candidates = getChromeCandidates()

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

  const ready = await probeChromeCdp()
  if (ready.ok) {
    sendStatus('chrome', true)
    return { ok: true, msg: `Chrome CDP already ready (port ${CDP_PORT})` }
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
    stdio: 'ignore',
    windowsHide: true,
  })
  let spawnError = ''
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
    msg: 'Chrome launched but CDP did not become ready. Check whether the dedicated browser window started normally.',
  }
}

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

// ── Utilities ─────────────────────────────────────────────────────────────────

function probeApiReady(timeoutMs = 800) {
  return new Promise((resolve) => {
    let done = false
    const finish = (result) => {
      if (done) return
      done = true
      resolve(result)
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port: apiPort,
      path: '/health?probe=1',
      method: 'GET',
      timeout: timeoutMs,
    }, (res) => {
      res.resume()
      res.on('end', () => finish(res.statusCode === 200))
    })

    req.on('error', () => finish(false))
    req.on('timeout', () => {
      req.destroy(new Error('timeout'))
      finish(false)
    })
    req.end()
  })
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
  if (!runtime || typeof runtime !== 'object') return false
  const runtimeScriptsDir = String(runtime.scripts_dir || '')
  const runtimeDataDir = String(runtime.data_dir || '')
  const runtimeInstanceId = String(runtime.backend_instance_id || '')
  if (runtimeInstanceId !== BACKEND_INSTANCE_ID) return false
  if (runtime.owns_backend_instance !== true) return false
  if (!sameRuntimePath(runtimeDataDir, expectedBackendDataDir())) return false
  return sameRuntimePath(runtimeScriptsDir, expectedBackendScriptsDir())
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

async function getBackendHealth(timeoutMs = 800) {
  return new Promise((resolve) => {
    let done = false
    const finish = (result) => {
      if (done) return
      done = true
      resolve(result)
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port: apiPort,
      path: '/health?probe=1',
      method: 'GET',
      timeout: timeoutMs,
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          finish({ ok: false, statusCode: res.statusCode || 0 })
          return
        }
        try {
          const parsed = JSON.parse(data || '{}')
          finish({ ok: true, data: parsed })
        } catch (error) {
          finish({ ok: false, error: error.message })
        }
      })
    })

    req.on('error', (error) => finish({ ok: false, error: error.message }))
    req.on('timeout', () => {
      req.destroy(new Error('timeout'))
      finish({ ok: false, error: 'timeout' })
    })
    req.end()
  })
}

async function validateApiRuntime() {
  const health = await getBackendHealth()
  if (!health.ok) return false
  const runtime = health.data?.runtime
  if (isCompatibleBackendRuntime(runtime)) return true
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
    return { active: false, tasks: [] }
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
  while (Date.now() < deadline) {
    const active = await getActiveTasksForQuit()
    if (!active?.active || !Array.isArray(active.tasks) || active.tasks.length === 0) return true
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  log('[warn] timed out waiting for active tasks to stop before quit')
  return false
}

async function confirmQuitWithActiveTasks(tasks = []) {
  const count = Array.isArray(tasks) ? tasks.length : 0
  const detail = count > 0
    ? tasks.slice(0, 5).map(item => `- ${item.adapter_id}/${item.task_id} (${item.status || 'running'})`).join('\n')
    : ''
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['继续运行', '停止任务并退出'],
    defaultId: 0,
    cancelId: 0,
    title: '任务仍在运行',
    message: `还有 ${count} 个任务正在运行。`,
    detail: `${detail}${count > 5 ? `\n- 另有 ${count - 5} 个任务...` : ''}\n\n退出会请求任务停止并等待导出收尾完成。`,
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

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  hideNativeAppMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    ensureDesktopServicesStarted()
  })

  await ensureDesktopServicesStarted()
})

app.on('window-all-closed', () => {
  lifecycleController.handleWindowAllClosed()
})

app.on('before-quit', (event) => {
  lifecycleController.handleBeforeQuit(event).catch(error => {
    log(`[lifecycle] before-quit failed: ${error.message}`)
  })
})

// ── IPC handlers ──────────────────────────────────────────────────────────────

secureHandle('get-status', async () => ({
  api:     await probeApiReady(),
  apiState: backendController.getState(),
  chrome:  (await probeChromeCdp()).ok,
  apiPort,
  apiBase: `http://127.0.0.1:${apiPort}`,
  apiToken: getApiToken(),
  cdpPort: CDP_PORT,
  pythonBin: getPythonBin(),
  dev: IS_DEV,
}))

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

secureHandle('submit-tmall-approval-batch', async (_, batchId, token) => {
  return apiCall(
    'POST',
    `/tmall-ai-image-approval/api/${encodeURIComponent(String(batchId || ''))}/submit?${approvalTokenQuery(token)}`,
    null,
    { timeoutMs: 20 * 60 * 1000 },
  )
})

secureHandle('get-cloud-approval-status', async () => apiCall('GET', '/cloud-approval/status'))
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
      ? [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg'] }, { name: '所有文件', extensions: ['*'] }]
      : opts.zip
        ? [{ name: 'ZIP 压缩包', extensions: ['zip'] }, { name: '所有文件', extensions: ['*'] }]
        : opts.pdf
          ? [{ name: 'PDF 文件', extensions: ['pdf'] }, { name: '所有文件', extensions: ['*'] }]
          : [{ name: '所有文件', extensions: ['*'] }])
  const res = await dialog.showOpenDialog(mainWindow, {
    title: opts.title || '选择文件',
    properties: props,
    filters,
  })
  if (res.canceled) return opts.multi ? [] : ''
  return opts.multi ? (res.filePaths || []) : (res.filePaths[0] || '')
})

secureHandle('list-directory-files', async (_, rootPath, opts = {}) => {
  return listDirectoryFilesSnapshot(rootPath, opts)
})

secureHandle('render-pdf-preview', async (_, filePath) => {
  try {
    return renderPdfPreviewWithQuickLook(String(filePath || ''))
  } catch (error) {
    return { ok: false, error: error.message || String(error) }
  }
})

secureHandle('read-excel', async (_, filePath) => {
  try {
    return await apiCall('POST', '/files/read-excel', { path: filePath })
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
