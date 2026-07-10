const DEFAULT_API_BASE = 'http://127.0.0.1:18765'
const API_PORT_PROBE_RANGE = Array.from({ length: 11 }, (_, index) => 18765 + index)
const TOKEN_STORAGE_KEY = 'crawshrimp.apiToken'
const API_BASE_STORAGE_KEY = 'crawshrimp.apiBase'
const LOCAL_PROMPT_LIBRARY_STORAGE_KEY = 'crawshrimp.localPromptLibraries.v1'
const TOKEN_QUERY_KEYS = ['crawshrimp_token', 'api_token', 'token']
const API_BASE_QUERY_KEYS = ['crawshrimp_api_base', 'api_base']
let discoveredApiBase = ''

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

function normalizeApiBase(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function rememberApiBase(value) {
  const normalized = normalizeApiBase(value)
  if (!normalized) return ''
  discoveredApiBase = normalized
  try { window.localStorage?.setItem(API_BASE_STORAGE_KEY, normalized) } catch {}
  return normalized
}

function isCrawshrimpHealthPayload(payload) {
  return payload?.status === 'ok' && (
    Boolean(payload?.runtime?.scripts_dir)
    || typeof payload?.chrome === 'boolean'
    || Number.isFinite(Number(payload?.adapters))
  )
}

function apiBase() {
  const queryBase = readQueryValue(API_BASE_QUERY_KEYS)
  if (queryBase) {
    return rememberApiBase(queryBase)
  }
  let storedBase = ''
  try {
    storedBase = String(window.localStorage?.getItem(API_BASE_STORAGE_KEY) || '').trim()
  } catch {}
  return normalizeApiBase(storedBase || discoveredApiBase || import.meta.env.VITE_CRAWSHRIMP_API_BASE || DEFAULT_API_BASE)
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

function buildUrlWithBase(base, path) {
  if (/^https?:\/\//i.test(String(path || ''))) return String(path)
  return `${normalizeApiBase(base)}${String(path || '').startsWith('/') ? '' : '/'}${path}`
}

function apiBaseCandidates(initialBase = '') {
  const seen = new Set()
  return [
    initialBase,
    apiBase(),
    import.meta.env.VITE_CRAWSHRIMP_API_BASE,
    DEFAULT_API_BASE,
    ...API_PORT_PROBE_RANGE.map(port => `http://127.0.0.1:${port}`),
  ]
    .map(normalizeApiBase)
    .filter((base) => {
      if (!base || seen.has(base)) return false
      seen.add(base)
      return true
    })
}

async function discoverApiBase(initialBase = '') {
  for (const candidate of apiBaseCandidates(initialBase)) {
    try {
      const response = await fetch(buildUrlWithBase(candidate, '/health?probe=1'), {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) continue
      const payload = await parseResponse(response)
      if (isCrawshrimpHealthPayload(payload)) return rememberApiBase(candidate)
    } catch {}
  }
  return ''
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

  const initialBase = apiBase()
  let response
  try {
    response = await fetch(buildUrlWithBase(initialBase, path), options)
  } catch (error) {
    const fallbackBase = await discoverApiBase(initialBase)
    if (!fallbackBase || fallbackBase === initialBase) throw error
    response = await fetch(buildUrlWithBase(fallbackBase, path), options)
  }
  let payload = await parseResponse(response)
  if (!response.ok && response.status === 404) {
    const fallbackBase = await discoverApiBase(initialBase)
    if (fallbackBase && fallbackBase !== initialBase) {
      response = await fetch(buildUrlWithBase(fallbackBase, path), options)
      payload = await parseResponse(response)
    }
  }
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

function devPromptUid(prefix = 'local') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeDevPromptLibrary(library = {}) {
  const now = new Date().toISOString()
  return {
    library_uid: String(library.library_uid || devPromptUid('library')),
    name: String(library.name || 'AI 测图提示词库 本地版').trim() || 'AI 测图提示词库 本地版',
    scenario: ['裂变图', '创意拍摄'].includes(String(library.scenario || '').trim()) ? String(library.scenario || '').trim() : '裂变图',
    status: String(library.status || 'draft'),
    cloud_library_id: library.cloud_library_id ?? null,
    cloud_synced_at: String(library.cloud_synced_at || ''),
    import_source_path: String(library.import_source_path || ''),
    created_at: String(library.created_at || now),
    updated_at: String(library.updated_at || now),
    templates: (Array.isArray(library.templates) ? library.templates : []).map(template => ({
      local_uid: String(template.local_uid || devPromptUid('prompt')),
      group_name: String(template.group_name || '').trim(),
      field_name: String(template.field_name || '').trim(),
      source_field_id: String(template.source_field_id || '').trim(),
      field_order: template.field_order ?? null,
      visible: template.visible !== false,
      prompt_text: String(template.prompt_text || '').trim(),
      size_label: String(template.size_label || '2K').trim() || '2K',
      output_format: String(template.output_format || 'jpeg').trim() || 'jpeg',
      quality: String(template.quality || 'auto').trim() || 'auto',
      reference_fields: Array.isArray(template.reference_fields) ? template.reference_fields : [],
      word_count: template.word_count ?? null,
      field_type: String(template.field_type || '').trim(),
      female_priority: template.female_priority ?? null,
      male_neutral_priority: template.male_neutral_priority ?? null,
      category_rules: Array.isArray(template.category_rules) ? template.category_rules : [],
      gender_rules: Array.isArray(template.gender_rules) ? template.gender_rules : [],
      priority: template.priority ?? template.female_priority ?? template.male_neutral_priority ?? 100,
      enabled: template.enabled !== false,
      updated_at: String(template.updated_at || now),
    })),
  }
}

function readDevPromptLibraries() {
  try {
    const parsed = JSON.parse(window.localStorage?.getItem(LOCAL_PROMPT_LIBRARY_STORAGE_KEY) || '{}')
    return (Array.isArray(parsed?.libraries) ? parsed.libraries : []).map(normalizeDevPromptLibrary)
  } catch {
    return []
  }
}

function writeDevPromptLibraries(libraries) {
  const normalized = (Array.isArray(libraries) ? libraries : []).map(normalizeDevPromptLibrary)
  window.localStorage?.setItem(LOCAL_PROMPT_LIBRARY_STORAGE_KEY, JSON.stringify({ libraries: normalized }))
  return normalized
}

function upsertDevPromptLibrary(payload = {}) {
  const libraries = readDevPromptLibraries()
  const index = libraries.findIndex(library => library.library_uid === String(payload.library_uid || '').trim())
  const existing = index >= 0 ? libraries[index] : {}
  const next = normalizeDevPromptLibrary({
    ...existing,
    ...payload,
    library_uid: existing.library_uid || payload.library_uid || devPromptUid('library'),
    status: 'draft',
    created_at: existing.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  if (index >= 0) libraries[index] = next
  else libraries.unshift(next)
  const saved = writeDevPromptLibraries(libraries)
  return { ok: true, library: next, libraries: saved }
}

export function createDevCsBridge() {
  return {
    getStatus: async () => {
      try {
        let health = await apiCall('GET', '/health')
        if (!isCrawshrimpHealthPayload(health)) {
          const fallbackBase = await discoverApiBase(apiBase())
          if (fallbackBase) health = await apiCall('GET', '/health')
        }
        return {
          api: health?.status === 'ok',
          chrome: Boolean(health?.chrome),
          apiPort: Number(new URL(apiBase()).port || 18765),
          cdpPort: 9222,
          dev: true,
        }
      } catch {
        const fallbackBase = await discoverApiBase(apiBase())
        return { api: false, chrome: false, apiPort: Number(new URL(fallbackBase || DEFAULT_API_BASE).port || 18765), cdpPort: 9222, dev: true }
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
    runTaskInstance: (uid, options = {}) => apiCall('POST', `/task-instances/${encodePathPart(uid)}/run`, options || {}),
    listTaskSchedules: (query = {}) => apiCall('GET', `/task-schedules?${queryString(query)}`),
    createTaskSchedule: (payload) => apiCall('POST', '/task-schedules', payload || {}),
    getTaskSchedule: (uid) => apiCall('GET', `/task-schedules/${encodePathPart(uid)}`),
    updateTaskSchedule: (uid, payload) => apiCall('PATCH', `/task-schedules/${encodePathPart(uid)}`, payload || {}),
    deleteTaskSchedule: (uid) => apiCall('DELETE', `/task-schedules/${encodePathPart(uid)}`),
    runTaskScheduleNow: (uid) => apiCall('POST', `/task-schedules/${encodePathPart(uid)}/run-now`, {}),
    listAiImageJobs: () => apiCall('GET', '/ai-image/jobs'),
    createAiImageJob: (payload) => apiCall('POST', '/ai-image/jobs', payload || {}),
    getAiImageJob: (uid) => apiCall('GET', `/ai-image/jobs/${encodePathPart(uid)}`),
    updateAiImageJob: (uid, payload) => apiCall('PATCH', `/ai-image/jobs/${encodePathPart(uid)}`, payload || {}),
    setAiImageJobPinned: (uid, pinned) => apiCall('PATCH', `/ai-image/jobs/${encodePathPart(uid)}/pin`, { pinned: Boolean(pinned) }),
    deleteAiImageJob: (uid) => apiCall('DELETE', `/ai-image/jobs/${encodePathPart(uid)}`),
    runAiImageJob: (uid) => apiCall('POST', `/ai-image/jobs/${encodePathPart(uid)}/run`, {}),
    batchRunAiImageJob: (uid, payload) => apiCall('POST', `/ai-image/jobs/${encodePathPart(uid)}/batch-run`, payload || {}),
    retryAiImageRun: (uid, runUid) => apiCall('POST', `/ai-image/jobs/${encodePathPart(uid)}/runs/${encodePathPart(runUid)}/retry`, {}),
    saveAsAiImageJob: (uid, payload) => apiCall('POST', `/ai-image/jobs/${encodePathPart(uid)}/save-as`, payload || {}),
    materializeAiImageResult: (uid, payload) => apiCall('POST', `/ai-image/jobs/${encodePathPart(uid)}/materialize`, payload || {}),
    createAiImageAsset: (payload) => apiCall('POST', '/ai-image/assets', payload || {}),
    createAiImageCanvas: (payload) => apiCall('POST', '/ai-image/canvases', payload || {}),

    probeTaskParams: (aid, tid, params, options = {}) => apiCall('POST', `/tasks/${encodePathPart(aid)}/${encodePathPart(tid)}/params/probe`, {
      params: params || {},
      current_tab_id: options.current_tab_id || '',
    }),
    runTask: (aid, tid, params, options = {}) => apiCall('POST', `/tasks/${encodePathPart(aid)}/${encodePathPart(tid)}/run`, {
      params: params || {},
      current_tab_id: options.current_tab_id || '',
    }),
    pauseTask: (aid, tid, instanceUid = '') => {
      const uid = String(instanceUid || '').trim()
      return uid
        ? apiCall('POST', `/task-instances/${encodePathPart(uid)}/pause`)
        : apiCall('POST', `/tasks/${encodePathPart(aid)}/${encodePathPart(tid)}/pause`)
    },
    resumeTask: (aid, tid, instanceUid = '') => {
      const uid = String(instanceUid || '').trim()
      return uid
        ? apiCall('POST', `/task-instances/${encodePathPart(uid)}/resume`)
        : apiCall('POST', `/tasks/${encodePathPart(aid)}/${encodePathPart(tid)}/resume`)
    },
    stopTask: (aid, tid, instanceUid = '') => {
      const uid = String(instanceUid || '').trim()
      return uid
        ? apiCall('POST', `/task-instances/${encodePathPart(uid)}/stop`)
        : apiCall('POST', `/tasks/${encodePathPart(aid)}/${encodePathPart(tid)}/stop`)
    },
    getTaskStatus: (aid, tid, instanceUid = '') => {
      const uid = String(instanceUid || '').trim()
      return uid
        ? apiCall('GET', `/task-instances/${encodePathPart(uid)}/run-status`)
        : apiCall('GET', `/tasks/${encodePathPart(aid)}/${encodePathPart(tid)}/status`)
    },
    getTaskLogs: (aid, tid, instanceUid = '') => {
      const uid = String(instanceUid || '').trim()
      return uid
        ? apiCall('GET', `/task-instances/${encodePathPart(uid)}/logs`)
        : apiCall('GET', `/tasks/${encodePathPart(aid)}/${encodePathPart(tid)}/logs`)
    },
    clearTaskLogs: (aid, tid, instanceUid = '') => {
      const uid = String(instanceUid || '').trim()
      return uid
        ? apiCall('DELETE', `/task-instances/${encodePathPart(uid)}/logs`)
        : apiCall('DELETE', `/tasks/${encodePathPart(aid)}/${encodePathPart(tid)}/logs`)
    },

    getData: (aid, tid) => apiCall('GET', `/data/${encodePathPart(aid)}/${encodePathPart(tid)}`),
    exportData: async (aid, tid, fmt = 'excel') => {
      const url = buildUrl(`/data/${encodePathPart(aid)}/${encodePathPart(tid)}/export?format=${encodeURIComponent(fmt)}`)
      window.open(url, '_blank', 'noopener,noreferrer')
      return { ok: true, result: { url } }
    },
    openFile: openExternalLike,
    openExternalUrl: openExternalLike,
    getApiBase: () => apiBase(),
    readExcel: (path, options = {}) => apiCall('POST', '/files/read-excel', {
      path,
      sheet: options?.sheet || null,
      header_row: Number(options?.header_row || options?.headerRow || 1) || 1,
    }),
    testNotify: (channel) => apiCall('POST', '/settings/test-notify', { channel }),
    getTmallApprovalBatch: (batchId, token) => apiCall('GET', `/tmall-ai-image-approval/api/${encodePathPart(batchId)}?token=${encodeURIComponent(String(token || ''))}`),
    saveTmallApprovalDecisions: (batchId, token, decisions) => apiCall('POST', `/tmall-ai-image-approval/api/${encodePathPart(batchId)}/decisions?token=${encodeURIComponent(String(token || ''))}`, { decisions: decisions || {} }),
    importTmallApprovalReferenceFiles: (batchId, token, paths) => apiCall('POST', `/tmall-ai-image-approval-local/api/${encodePathPart(batchId)}/reference-files?token=${encodeURIComponent(String(token || ''))}`, { paths: Array.isArray(paths) ? paths : [] }),
    regenerateTmallApprovalAsset: (batchId, token, payload) => apiCall('POST', `/tmall-ai-image-approval/api/${encodePathPart(batchId)}/regenerate?token=${encodeURIComponent(String(token || ''))}`, payload || {}),
    generateTmallApprovalAsset: (batchId, token, payload) => apiCall('POST', `/tmall-ai-image-approval/api/${encodePathPart(batchId)}/generate?token=${encodeURIComponent(String(token || ''))}`, payload || {}),
    submitTmallApprovalGeneration: (batchId, token, payload) => apiCall('POST', `/tmall-ai-image-approval/api/${encodePathPart(batchId)}/submit-generation?token=${encodeURIComponent(String(token || ''))}`, payload || {}),
    submitTmallApprovalBatch: (batchId, token) => apiCall('POST', `/tmall-ai-image-approval/api/${encodePathPart(batchId)}/submit?token=${encodeURIComponent(String(token || ''))}`, {}),
    getCloudApprovalStatus: (options = {}) => apiCall(
      'GET',
      options?.refresh ? '/cloud-approval/status?refresh=true' : '/cloud-approval/status',
    ),
    saveCloudApprovalConfig: (payload) => apiCall('POST', '/cloud-approval/config', payload || {}),
    enrollCloudMachine: (payload) => apiCall('POST', '/cloud-approval/enroll-machine', payload || {}),
    startCloudMachine: () => apiCall('POST', '/cloud-approval/machine/start', {}),
    stopCloudMachine: () => apiCall('POST', '/cloud-approval/machine/stop', {}),
    syncCloudApprovalBatch: (payload) => apiCall('POST', '/cloud-approval/sync-batch', payload || {}),
    listCloudPromptLibraries: () => apiCall('GET', '/cloud-approval/prompt-libraries'),
    resolveCloudPromptTemplates: (libraryId, query = {}) => {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query || {})) {
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          params.set(key, String(value))
        }
      }
      const suffix = params.toString() ? `?${params.toString()}` : ''
      return apiCall('GET', `/cloud-approval/prompt-libraries/${encodePathPart(libraryId)}/resolved${suffix}`)
    },
    listLocalPromptLibraries: async () => ({ ok: true, libraries: readDevPromptLibraries() }),
    createLocalPromptLibrary: async (payload = {}) => upsertDevPromptLibrary({
      name: payload.name || 'AI 测图提示词库 本地版',
      scenario: payload.scenario || '裂变图',
      templates: Array.isArray(payload.templates) ? payload.templates : [],
    }),
    importLocalPromptLibrary: async (payload = {}) => upsertDevPromptLibrary(payload),
    saveLocalPromptLibrary: async (libraryUid, payload = {}) => upsertDevPromptLibrary({ ...payload, library_uid: libraryUid }),
    syncLocalPromptLibraryToCloud: async () => {
      throw devModeError('浏览器开发模式不能同步云端提示词库，请在 Electron 开发壳中登录云端审批后同步')
    },

    getSettings: () => apiCall('GET', '/settings'),
    saveSettings: (cfg) => apiCall('PUT', '/settings', cfg || {}),
    patchSettings: (cfg) => apiCall('PATCH', '/settings', cfg || {}),
    browseFile: promptPath,
    readLocalImagePreview: (path) => apiCall('POST', '/files/local-image-preview', { path }),
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
