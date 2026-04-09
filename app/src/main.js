'use strict'

// Prevent child processes from accidentally inheriting ELECTRON_RUN_AS_NODE
delete process.env.ELECTRON_RUN_AS_NODE

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path   = require('path')
const fs     = require('fs')
const net    = require('net')
const http   = require('http')
const { spawn, execSync } = require('child_process')

const API_PORT = parseInt(process.env.CRAWSHRIMP_PORT || '18765')
const CDP_PORT = 9222
const IS_DEV   = !app.isPackaged

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

async function startBackend() {
  if (await probeTcp(API_PORT)) {
    log(`[api] already running on port ${API_PORT}`)
    return
  }

  const pythonBin  = getPythonBin()
  const serverScript = getApiServerScript()

  if (!fs.existsSync(serverScript)) {
    log(`[warn] api_server.py not found: ${serverScript}`)
    return
  }

  log(`[api] starting: ${pythonBin} ${serverScript}`)
  backendProcess = spawn(pythonBin, [serverScript], {
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

  const fwd = (prefix) => (d) =>
    d.toString('utf8').split('\n').filter(l => l.trim()).forEach(l => log(`[${prefix}] ${l}`))

  backendProcess.stdout.on('data', fwd('api'))
  backendProcess.stderr.on('data', fwd('api'))
  backendProcess.on('exit', (code) => {
    log(`[api] process exited code=${code}`)
    backendProcess = null
  })

  // Wait up to 10s for API to be ready
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500))
    if (await probeTcp(API_PORT)) {
      log(`[api] ready on port ${API_PORT}`)
      sendStatus('api', true)
      return
    }
  }
  log('[warn] API server startup timeout')
}

function stopBackend() {
  if (!backendProcess) return
  if (process.platform === 'win32') {
    try { execSync(`taskkill /F /T /PID ${backendProcess.pid}`, { timeout: 3000 }) } catch (_) {}
  } else {
    backendProcess.kill('SIGTERM')
  }
  backendProcess = null
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

function probeTcp(port, host = '127.0.0.1', ms = 500) {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    const done = (ok) => { try { sock.destroy() } catch (_) {} resolve(ok) }
    sock.setTimeout(ms)
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
    sock.once('timeout', () => done(false))
    sock.connect(port, host)
  })
}

function log(msg) {
  const ts = new Date().toLocaleTimeString('en', { hour12: false })
  const line = `[${ts}] ${msg}`
  console.log(line)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', line)
  }
}

function sendStatus(key, value) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status', { key, value })
  }
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  await startBackend()

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
})

app.on('window-all-closed', () => {
  stopBackend()
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('get-status', async () => ({
  api:     await probeTcp(API_PORT),
  chrome:  (await probeChromeCdp()).ok,
  apiPort: API_PORT,
  cdpPort: CDP_PORT,
  pythonBin: getPythonBin(),
  dev: IS_DEV,
}))

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
  if (payload.path) {
    return apiCall('POST', '/adapters/install', { path: payload.path })
  }
  if (payload.file) {
    const raw = fs.readFileSync(payload.file)
    return apiCall('POST', '/adapters/install', { zip_base64: raw.toString('base64') })
  }
  return { ok: false, error: 'No path or file provided' }
})

ipcMain.handle('get-tasks',       async () => apiCall('GET', '/tasks', null, {
  retries: 20,
  retryDelayMs: 500,
}))
ipcMain.handle('run-task',        async (_, aid, tid, params, options) =>
  apiCall('POST', `/tasks/${aid}/${tid}/run`, {
    params: params || {},
    current_tab_id: options?.current_tab_id || '',
  }))
ipcMain.handle('pause-task',      async (_, aid, tid) => apiCall('POST', `/tasks/${aid}/${tid}/pause`))
ipcMain.handle('resume-task',     async (_, aid, tid) => apiCall('POST', `/tasks/${aid}/${tid}/resume`))
ipcMain.handle('stop-task',       async (_, aid, tid) => apiCall('POST', `/tasks/${aid}/${tid}/stop`))
ipcMain.handle('get-task-status', async (_, aid, tid) => apiCall('GET',  `/tasks/${aid}/${tid}/status`))
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
    : [{ name: '所有文件', extensions: ['*'] }])
  const res = await dialog.showOpenDialog(mainWindow, {
    title: opts.title || '选择文件',
    properties: props,
    filters,
  })
  if (res.canceled) return opts.multi ? [] : ''
  return opts.multi ? (res.filePaths || []) : (res.filePaths[0] || '')
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
