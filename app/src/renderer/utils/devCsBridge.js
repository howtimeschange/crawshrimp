const DEFAULT_API_BASE = 'http://127.0.0.1:18765'
const TOKEN_STORAGE_KEY = 'crawshrimp.apiToken'
const API_BASE_STORAGE_KEY = 'crawshrimp.apiBase'
const TOKEN_QUERY_KEYS = ['crawshrimp_token', 'api_token', 'token']
const API_BASE_QUERY_KEYS = ['crawshrimp_api_base', 'api_base']

function isLocalRenderer() {
  if (typeof window === 'undefined') return false
  const host = String(window.location?.hostname || '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

function readQueryValue(keys = []) {
  try {
    const params = new URLSearchParams(window.location.search || '')
    for (const key of keys) {
      const value = String(params.get(key) || '').trim()
      if (value) return value
    }
  } catch {}
  return ''
}

function apiBase() {
  const queryBase = readQueryValue(API_BASE_QUERY_KEYS)
  if (queryBase) {
    try { window.localStorage?.setItem(API_BASE_STORAGE_KEY, queryBase) } catch {}
    return queryBase.replace(/\/+$/, '')
  }
  let storedBase = ''
  try {
    storedBase = String(window.localStorage?.getItem(API_BASE_STORAGE_KEY) || '').trim()
  } catch {}
  return String(storedBase || import.meta.env.VITE_CRAWSHRIMP_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '')
}

function apiToken() {
  const queryToken = readQueryValue(TOKEN_QUERY_KEYS)
  if (queryToken) {
    try { window.localStorage?.setItem(TOKEN_STORAGE_KEY, queryToken) } catch {}
    return queryToken
  }
  try {
    return String(window.localStorage?.getItem(TOKEN_STORAGE_KEY) || '').trim()
  } catch {
    return ''
  }
}

function devModeError(message) {
  return Object.assign(new Error(message), { devBridge: true })
}

async function parseResponse(response) {
  const contentType = String(response.headers.get('content-type') || '')
  if (contentType.includes('application/json')) return await response.json()
  return await response.text()
}

function buildUrl(path) {
  if (/^https?:\/\//i.test(String(path || ''))) return String(path)
  return `${apiBase()}${String(path || '').startsWith('/') ? '' : '/'}${path}`
}

async function apiCall(method, path, body) {
  const headers = {}
  const token = apiToken()
  if (token) headers['X-Crawshrimp-Token'] = token
  const options = { method, headers }
  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }

  const response = await fetch(buildUrl(path), options)
  const payload = await parseResponse(response)
  if (!response.ok) {
    const detail = payload?.detail || payload?.error || payload?.message || String(payload || response.statusText)
    if (response.status === 401) {
      throw devModeError(`开发浏览器模式缺少本地 API token：请在 localStorage.${TOKEN_STORAGE_KEY} 写入当前 .crawshrimp-dev/api-token，或用 ?crawshrimp_token=... 打开页面`)
    }
    throw devModeError(detail)
  }
  return payload
}

function queryString(query = {}) {
  return new URLSearchParams(
    Object.entries(query || {})
      .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
      .map(([key, value]) => [key, String(value)])
  ).toString()
}

function encodePathPart(value) {
  return encodeURIComponent(String(value || ''))
}

function promptPath(opts = {}) {
  const multi = Boolean(opts.multiSelections || opts.multi)
  const title = opts.title || (opts.directory ? '请输入本地目录路径' : '请输入本地文件路径')
  const hint = multi ? '多个路径可用英文逗号分隔' : ''
  const value = window.prompt(`${title}${hint ? `\n${hint}` : ''}`, '')
  if (!value) return multi ? [] : ''
  if (!multi) return value.trim()
  return value.split(',').map(item => item.trim()).filter(Boolean)
}

function openExternalLike(path) {
  const value = String(path || '').trim()
  if (!value) return Promise.resolve({ ok: false, error: '路径为空' })
  if (/^https?:\/\//i.test(value)) {
    window.open(value, '_blank', 'noopener,noreferrer')
    return Promise.resolve({ ok: true })
  }
  console.info(`[crawshrimp-dev] 浏览器开发模式不能直接打开本地文件：${value}`)
  return Promise.resolve({ ok: false, error: '浏览器开发模式不能直接打开本地文件，请在 Electron 开发壳中打开' })
}

export function createDevCsBridge() {
  return {
    getStatus: async () => {
      try {
        const health = await apiCall('GET', '/health')
        return {
          api: health?.status === 'ok',
          chrome: Boolean(health?.chrome),
          apiPort: Number(new URL(apiBase()).port || 18765),
          cdpPort: 9222,
          dev: true,
        }
      } catch {
        return { api: false, chrome: false, apiPort: 18765, cdpPort: 9222, dev: true }
      }
    },
    launchChrome: async () => ({ ok: false, error: '浏览器开发模式不负责启动 Chrome，请使用 Electron 开发壳' }),
    checkChrome: async () => ({ ok: Boolean((await apiCall('GET', '/health'))?.chrome) }),
    getCurrentChromeTab: async () => {
      const tabs = await apiCall('GET', '/settings/chrome-tabs')
      return Array.isArray(tabs) ? (tabs[0] || null) : null
    },

    getAdapters: () => apiCall('GET', '/adapters'),
    installAdapter: (payload) => apiCall('POST', '/adapters/install', payload || {}),
    uninstallAdapter: (id) => apiCall('DELETE', `/adapters/${encodePathPart(id)}`),
    enableAdapter: (id, enabled) => apiCall('PATCH', `/adapters/${encodePathPart(id)}/enable`, { enabled }),

    getTasks: () => apiCall('GET', '/tasks'),
    listTaskInstances: (query = {}) => apiCall('GET', `/task-instances?${queryString(query)}`),
    createTaskInstance: (payload) => apiCall('POST', '/task-instances', payload || {}),
    getTaskInstance: (uid) => apiCall('GET', `/task-instances/${encodePathPart(uid)}`),
    updateTaskInstance: (uid, payload) => apiCall('PATCH', `/task-instances/${encodePathPart(uid)}`, payload || {}),
    runTaskInstance: (uid) => apiCall('POST', `/task-instances/${encodePathPart(uid)}/run`, {}),
    listTaskSchedules: (query = {}) => apiCall('GET', `/task-schedules?${queryString(query)}`),
    createTaskSchedule: (payload) => apiCall('POST', '/task-schedules', payload || {}),
    getTaskSchedule: (uid) => apiCall('GET', `/task-schedules/${encodePathPart(uid)}`),
    updateTaskSchedule: (uid, payload) => apiCall('PATCH', `/task-schedules/${encodePathPart(uid)}`, payload || {}),
    deleteTaskSchedule: (uid) => apiCall('DELETE', `/task-schedules/${encodePathPart(uid)}`),
    runTaskScheduleNow: (uid) => apiCall('POST', `/task-schedules/${encodePathPart(uid)}/run-now`, {}),

    probeTaskParams: (aid, tid, params, options = {}) => apiCall('POST', `/tasks/${encodePathPart(aid)}/${encodePathPart(tid)}/params/probe`, {
      params: params || {},
      current_tab_id: options.current_tab_id || '',
    }),
    runTask: (aid, tid, params, options = {}) => apiCall('POST', `/tasks/${encodePathPart(aid)}/${encodePathPart(tid)}/run`, {
      params: params || {},
      current_tab_id: options.current_tab_id || '',
    }),
    pauseTask: (aid, tid) => apiCall('POST', `/tasks/${encodePathPart(aid)}/${encodePathPart(tid)}/pause`),
    resumeTask: (aid, tid) => apiCall('POST', `/tasks/${encodePathPart(aid)}/${encodePathPart(tid)}/resume`),
    stopTask: (aid, tid) => apiCall('POST', `/tasks/${encodePathPart(aid)}/${encodePathPart(tid)}/stop`),
    getTaskStatus: (aid, tid) => apiCall('GET', `/tasks/${encodePathPart(aid)}/${encodePathPart(tid)}/status`),
    getTaskLogs: (aid, tid) => apiCall('GET', `/tasks/${encodePathPart(aid)}/${encodePathPart(tid)}/logs`),
    clearTaskLogs: (aid, tid) => apiCall('DELETE', `/tasks/${encodePathPart(aid)}/${encodePathPart(tid)}/logs`),

    getData: (aid, tid) => apiCall('GET', `/data/${encodePathPart(aid)}/${encodePathPart(tid)}`),
    exportData: async (aid, tid, fmt = 'excel') => {
      const url = buildUrl(`/data/${encodePathPart(aid)}/${encodePathPart(tid)}/export?format=${encodeURIComponent(fmt)}`)
      window.open(url, '_blank', 'noopener,noreferrer')
      return { ok: true, result: { url } }
    },
    openFile: openExternalLike,
    readExcel: (path) => apiCall('POST', '/files/read-excel', { path }),
    testNotify: (channel) => apiCall('POST', '/settings/test-notify', { channel }),
    getTmallApprovalBatch: (batchId, token) => apiCall('GET', `/tmall-ai-image-approval/api/${encodePathPart(batchId)}?token=${encodeURIComponent(String(token || ''))}`),
    saveTmallApprovalDecisions: (batchId, token, decisions) => apiCall('POST', `/tmall-ai-image-approval/api/${encodePathPart(batchId)}/decisions?token=${encodeURIComponent(String(token || ''))}`, { decisions: decisions || {} }),
    regenerateTmallApprovalAsset: (batchId, token, payload) => apiCall('POST', `/tmall-ai-image-approval/api/${encodePathPart(batchId)}/regenerate?token=${encodeURIComponent(String(token || ''))}`, payload || {}),
    submitTmallApprovalBatch: (batchId, token) => apiCall('POST', `/tmall-ai-image-approval/api/${encodePathPart(batchId)}/submit?token=${encodeURIComponent(String(token || ''))}`, {}),

    getSettings: () => apiCall('GET', '/settings'),
    saveSettings: (cfg) => apiCall('PUT', '/settings', cfg || {}),
    patchSettings: (cfg) => apiCall('PATCH', '/settings', cfg || {}),
    browseFile: promptPath,
    listDirectoryFiles: async () => ({ ok: false, paths: [], error: '浏览器开发模式不支持直接扫描本地目录' }),
    renderPdfPreview: async () => ({ ok: false, error: '浏览器开发模式不支持本地 PDF 预览' }),

    statFile: async () => ({ exists: false }),
    revealFile: openExternalLike,
    deleteFile: async (path) => apiCall('POST', '/files/delete', { paths: [path] }),
    deleteFiles: (paths) => apiCall('POST', '/files/delete', { paths: paths || [] }),
    syncOdpsFiles: (payload) => apiCall('POST', '/data-sync/odps', payload || {}),
    saveAsFile: openExternalLike,
    saveAdapterTemplate: async () => ({ ok: false, error: '浏览器开发模式不支持保存内置模板' }),

    onLog: () => {},
    onStatus: () => {},
    offLog: () => {},
    offStatus: () => {},
  }
}

export function installDevCsBridge() {
  if (typeof window === 'undefined' || window.cs || !isLocalRenderer()) return false
  window.cs = createDevCsBridge()
  window.__CRAWSHRIMP_DEV_BRIDGE__ = true
  return true
}
