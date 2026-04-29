'use strict'

// Prevent child processes from accidentally inheriting ELECTRON_RUN_AS_NODE
delete process.env.ELECTRON_RUN_AS_NODE

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const { autoUpdater } = require('electron-updater')
const path   = require('path')
const fs     = require('fs')
const http   = require('http')
const crypto = require('crypto')
const { spawn, execSync, execFileSync } = require('child_process')
const { createBackendController } = require('./backendController')
const { createUpdateService } = require('./updateService')

const API_PORT = parseInt(process.env.CRAWSHRIMP_PORT || '18765')
const CDP_PORT = 9222
const IS_DEV   = !app.isPackaged
const BACKEND_STARTUP_ATTEMPTS = process.platform === 'win32' ? 60 : 20
const BACKEND_LAUNCH_RETRIES = process.platform === 'win32' ? 2 : 0

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

function getCrawshrimpDataDir() {
  return process.env.CRAWSHRIMP_DATA || path.join(app.getPath('home'), '.crawshrimp')
}

function getApiServerScript() {
  if (!IS_DEV) return path.join(process.resourcesPath, 'python-scripts', 'core', 'api_server.py')
  return path.join(__dirname, '..', '..', 'core', 'api_server.py')
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
  for (const candidate of candidateAdapterTemplatePaths(adapterId, templateFile, templatePath)) {
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 620,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (IS_DEV) {
    // Vite dev server
    mainWindow.loadURL('http://127.0.0.1:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

// ── FastAPI backend ────────────────────────────────────────────────────────────
let backendProcess = null

function spawnBackendProcess() {
  const pythonBin  = getPythonBin()
  const serverScript = getApiServerScript()

  if (!fs.existsSync(serverScript)) {
    throw new Error(`api_server.py not found: ${serverScript}`)
  }

  log(`[api] starting: ${pythonBin} ${serverScript}`)
  const proc = spawn(pythonBin, [serverScript], {
    cwd: getPythonScriptsDir(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      CRAWSHRIMP_PORT: String(API_PORT),
      ELECTRON_RUN_AS_NODE: '',
      PYTHONPATH: !IS_DEV
        ? path.join(process.resourcesPath, 'python-scripts')
        : path.join(__dirname, '..', '..'),
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
  if (process.platform === 'win32') {
    try { execSync(`taskkill /F /T /PID ${proc.pid}`, { timeout: 3000 }) } catch (_) {}
  } else {
    proc.kill('SIGTERM')
  }
  if (backendProcess === proc) backendProcess = null
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
  const retries = Math.max(0, Number(options.retries || 0))
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs || 0))

  const doRequest = () => new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null
    const opts = {
      hostname: '127.0.0.1',
      port: API_PORT,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }
    const req = http.request(opts, (res) => {
      let data = ''
      res.on('data', d => data += d)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve(data) }
      })
    })
    req.on('error', reject)
    if (bodyStr) req.write(bodyStr)
    req.end()
  })

  const retryableCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'EPIPE'])

  return (async () => {
    if (options.ensureReady !== false) {
      await backendController.ensureReady()
    }
    let lastError = null
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await doRequest()
      } catch (error) {
        lastError = error
        if (!retryableCodes.has(error?.code) || attempt === retries) {
          throw error
        }
        await new Promise(resolve => setTimeout(resolve, retryDelayMs))
      }
    }
    throw lastError
  })()
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
      port: API_PORT,
      path: '/health',
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
    const logDir = path.join(getCrawshrimpDataDir(), 'logs')
    fs.mkdirSync(logDir, { recursive: true })
    fs.appendFileSync(path.join(logDir, 'desktop.log'), line + '\n', 'utf8')
  } catch {}
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', line)
  }
}

function sendStatus(key, value) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status', { key, value })
  }
}

function sendUpdateStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', status)
  }
}

const backendController = createBackendController({
  log,
  sendStatus,
  probeReady: () => probeApiReady(),
  startProcess: () => spawnBackendProcess(),
  stopProcess: (proc) => stopBackendProcess(proc),
  intervalMs: 500,
  attempts: BACKEND_STARTUP_ATTEMPTS,
  launchRetries: BACKEND_LAUNCH_RETRIES,
  retryDelayMs: 1200,
})

const updateService = createUpdateService({
  app,
  autoUpdater,
  log,
  emit: sendUpdateStatus,
})

async function startBackend() {
  await backendController.ensureReady()
}

function stopBackend() {
  backendController.stop()
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  try {
    await startBackend()
    log(`[api] ready on port ${API_PORT}`)
  } catch (error) {
    log(`[warn] API backend failed to start: ${error.message}`)
  }

  // Auto-launch Chrome with CDP on startup
  const chromeState = await probeChromeCdp()
  if (chromeState.ok) {
    log('[chrome] CDP already ready on port ' + CDP_PORT)
    sendStatus('chrome', true)
  } else {
    log('[chrome] CDP not detected, auto-launching Chrome...')
    const result = await launchChrome()
    log('[chrome] ' + result.msg)
    sendStatus('chrome', result.ok)
  }

  setTimeout(() => {
    updateService.checkForUpdates({ manual: false })
  }, 15000)
})

app.on('window-all-closed', () => {
  stopBackend()
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('get-status', async () => ({
  api:     await probeApiReady(),
  chrome:  (await probeChromeCdp()).ok,
  apiPort: API_PORT,
  cdpPort: CDP_PORT,
  pythonBin: getPythonBin(),
  dev: IS_DEV,
}))

ipcMain.handle('update:get-status', async () => updateService.getStatus())
ipcMain.handle('update:check', async () => updateService.checkForUpdates({ manual: true }))
ipcMain.handle('update:download', async () => updateService.downloadUpdate())
ipcMain.handle('update:install', async () => updateService.installDownloadedUpdate())
ipcMain.handle('update:set-install-deferral', async (_, active) =>
  updateService.setActiveTaskCount(active ? 1 : 0))

ipcMain.handle('launch-chrome', async (_, customPath) => launchChrome(customPath || ''))
ipcMain.handle('check-chrome', async () => ({ ok: (await probeChromeCdp()).ok }))

ipcMain.handle('get-chrome-tabs', async () => {
  try { return await apiCall('GET', '/settings/chrome-tabs') } catch { return [] }
})
ipcMain.handle('get-current-chrome-tab', async () => {
  try {
    return await resolveCurrentChromeTab()
  } catch {
    return null
  }
})

ipcMain.handle('get-adapters',     async () => apiCall('GET',    '/adapters'))
ipcMain.handle('uninstall-adapter',async (_, id) => apiCall('DELETE', `/adapters/${id}`))
ipcMain.handle('enable-adapter',   async (_, id, enabled) =>
  apiCall('PATCH', `/adapters/${id}/enable`, { enabled }))

ipcMain.handle('install-adapter', async (_, payload) => {
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

ipcMain.handle('get-tasks',       async () => apiCall('GET', '/tasks', null, {
  retries: 20,
  retryDelayMs: 500,
}))
ipcMain.handle('probe-task-params', async (_, aid, tid, params, options) =>
  apiCall('POST', `/tasks/${aid}/${tid}/params/probe`, {
    params: params || {},
    current_tab_id: options?.current_tab_id || '',
  }))
ipcMain.handle('run-task', async (_, aid, tid, params, options) => {
  updateService.setActiveTaskCount(1)
  try {
    return await apiCall('POST', `/tasks/${aid}/${tid}/run`, {
      params: params || {},
      current_tab_id: options?.current_tab_id || '',
    })
  } catch (error) {
    updateService.setActiveTaskCount(0)
    throw error
  }
})
ipcMain.handle('pause-task',      async (_, aid, tid) => apiCall('POST', `/tasks/${aid}/${tid}/pause`))
ipcMain.handle('resume-task',     async (_, aid, tid) => apiCall('POST', `/tasks/${aid}/${tid}/resume`))
ipcMain.handle('stop-task',       async (_, aid, tid) => apiCall('POST', `/tasks/${aid}/${tid}/stop`))
ipcMain.handle('get-task-status', async (_, aid, tid) => {
  const status = await apiCall('GET', `/tasks/${aid}/${tid}/status`)
  const liveStatus = String(status?.live?.status || status?.last_run?.status || '').toLowerCase()
  if (!status?.live || !['running', 'pausing', 'paused', 'stopping'].includes(liveStatus)) {
    updateService.setActiveTaskCount(0)
  }
  return status
})
ipcMain.handle('get-task-logs',   async (_, aid, tid) => apiCall('GET',    `/tasks/${aid}/${tid}/logs`))
ipcMain.handle('clear-task-logs', async (_, aid, tid) => apiCall('DELETE', `/tasks/${aid}/${tid}/logs`))

ipcMain.handle('get-data',    async (_, aid, tid) => apiCall('GET', `/data/${aid}/${tid}`))
ipcMain.handle('export-data', async (_, aid, tid, fmt) => {
  try {
    const res = await apiCall('GET', `/data/${aid}/${tid}/export?format=${fmt}`)
    return { ok: true, result: res }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('open-file', async (_, filePath) => {
  shell.openPath(filePath)
  return { ok: true }
})

ipcMain.handle('get-settings',  async () => apiCall('GET', '/settings'))
ipcMain.handle('save-settings', async (_, cfg) => apiCall('PUT', '/settings', cfg))

ipcMain.handle('stat-file', async (_, filePath) => {
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

ipcMain.handle('reveal-file', async (_, filePath) => {
  shell.showItemInFolder(filePath)
  return { ok: true }
})

ipcMain.handle('delete-file', async (_, filePath) => {
  return apiCall('POST', '/files/delete', { paths: [filePath] })
})

ipcMain.handle('delete-files', async (_, filePaths) => {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths]
  return apiCall('POST', '/files/delete', {
    paths: paths.filter(Boolean),
  })
})

ipcMain.handle('save-as-file', async (_, srcPath) => {
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

ipcMain.handle('save-adapter-template', async (_, adapterId, templateFile, templatePath = '') => {
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

ipcMain.handle('browse-file', async (_, opts = {}) => {
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

ipcMain.handle('render-pdf-preview', async (_, filePath) => {
  try {
    return renderPdfPreviewWithQuickLook(String(filePath || ''))
  } catch (error) {
    return { ok: false, error: error.message || String(error) }
  }
})

ipcMain.handle('read-excel', async (_, filePath) => {
  try {
    return await apiCall('POST', '/files/read-excel', { path: filePath })
  } catch (e) {
    return { error: e.message, headers: [], rows: [], total: 0 }
  }
})

ipcMain.handle('test-notify', async (_, channel) => {
  try {
    return await apiCall('POST', '/settings/test-notify', { channel })
  } catch (e) {
    return { ok: false, error: e.message }
  }
})
