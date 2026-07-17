'use strict'
const { contextBridge, ipcRenderer } = require('electron')

const DEFAULT_API_BASE = 'http://127.0.0.1:18765'
const TOKEN_STORAGE_KEY = 'crawshrimp.apiToken'
const API_BASE_STORAGE_KEY = 'crawshrimp.apiBase'
const LOCAL_PROMPT_LIBRARY_FALLBACK_STORAGE_KEY = 'crawshrimp.localPromptLibraries.fallback.v1'
const TOKEN_QUERY_KEYS = ['crawshrimp_token', 'api_token', 'token']
const API_BASE_QUERY_KEYS = ['crawshrimp_api_base', 'api_base']

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

function readStorageValue(key) {
  try {
    return String(window.localStorage?.getItem(key) || '').trim()
  } catch {
    return ''
  }
}

function writeStorageValue(key, value) {
  try {
    if (value) window.localStorage?.setItem(key, String(value))
  } catch {}
}

function apiBase() {
  const queryBase = readQueryValue(API_BASE_QUERY_KEYS)
  if (queryBase) {
    writeStorageValue(API_BASE_STORAGE_KEY, queryBase)
    return queryBase.replace(/\/+$/, '')
  }
  const storedBase = readStorageValue(API_BASE_STORAGE_KEY)
  return String(storedBase || DEFAULT_API_BASE).replace(/\/+$/, '')
}

function rememberApiConnectionFromStatus(status) {
  const port = Number(status?.apiPort || 0)
  const statusBase = String(status?.apiBase || (port ? `http://127.0.0.1:${port}` : '')).trim()
  const statusToken = String(status?.apiToken || '').trim()
  if (statusBase) writeStorageValue(API_BASE_STORAGE_KEY, statusBase)
  if (statusToken) writeStorageValue(TOKEN_STORAGE_KEY, statusToken)
  const publicStatus = { ...(status || {}) }
  delete publicStatus.apiToken
  return publicStatus
}

function apiToken() {
  const queryToken = readQueryValue(TOKEN_QUERY_KEYS)
  if (queryToken) {
    writeStorageValue(TOKEN_STORAGE_KEY, queryToken)
    return queryToken
  }
  return readStorageValue(TOKEN_STORAGE_KEY)
}

function buildUrl(requestPath) {
  const value = String(requestPath || '')
  if (/^https?:\/\//i.test(value)) return value
  return `${apiBase()}${value.startsWith('/') ? '' : '/'}${value}`
}

async function parseResponse(response) {
  const contentType = String(response.headers?.get?.('content-type') || '')
  if (contentType.includes('application/json')) {
    try { return await response.json() } catch {}
  }
  const text = await response.text()
  try { return JSON.parse(text || '{}') } catch {}
  return text
}

async function apiCall(method, requestPath, body) {
  const headers = { Accept: 'application/json' }
  const token = apiToken()
  if (token) headers['X-Crawshrimp-Token'] = token
  const options = { method, headers }
  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  const response = await fetch(buildUrl(requestPath), options)
  const payload = await parseResponse(response)
  if (!response.ok) {
    const detail = payload?.detail || payload?.error || payload?.message || String(payload || response.statusText || '请求失败')
    throw new Error(detail)
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

function isMissingHandlerError(error) {
  return String(error?.message || error || '').includes('No handler registered')
}

async function invokeWithApiFallback(channel, args = [], fallback) {
  try {
    return await ipcRenderer.invoke(channel, ...args)
  } catch (error) {
    if (!isMissingHandlerError(error)) throw error
    return await fallback()
  }
}

function localPromptFallbackUid(prefix = 'local') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function localPromptFallbackArray(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean)
  return String(value || '')
    .split(/[,\n，、；;]/)
    .map(item => item.trim())
    .filter(Boolean)
}

function normalizeLocalPromptFallbackTemplate(template = {}) {
  const femalePriority = template.female_priority === '' || template.female_priority === undefined ? null : Number(template.female_priority)
  const maleNeutralPriority = template.male_neutral_priority === '' || template.male_neutral_priority === undefined ? null : Number(template.male_neutral_priority)
  const priority = Number.isFinite(Number(template.priority)) ? Number(template.priority)
    : Number.isFinite(femalePriority) ? femalePriority
      : Number.isFinite(maleNeutralPriority) ? maleNeutralPriority
        : 100
  return {
    local_uid: String(template.local_uid || localPromptFallbackUid('prompt')),
    group_name: String(template.group_name || '').trim(),
    field_name: String(template.field_name || '').trim(),
    source_field_id: String(template.source_field_id || '').trim(),
    field_order: Number.isFinite(Number(template.field_order)) ? Number(template.field_order) : null,
    visible: template.visible !== false,
    prompt_text: String(template.prompt_text || '').trim(),
    size_label: String(template.size_label || '2K').trim() || '2K',
    output_format: String(template.output_format || 'jpeg').trim() || 'jpeg',
    quality: String(template.quality || 'auto').trim() || 'auto',
    reference_fields: localPromptFallbackArray(template.reference_fields),
    word_count: Number.isFinite(Number(template.word_count)) ? Number(template.word_count) : null,
    field_type: String(template.field_type || '').trim(),
    female_priority: Number.isFinite(femalePriority) ? femalePriority : null,
    male_neutral_priority: Number.isFinite(maleNeutralPriority) ? maleNeutralPriority : null,
    category_rules: localPromptFallbackArray(template.category_rules),
    gender_rules: localPromptFallbackArray(template.gender_rules),
    priority,
    enabled: template.enabled !== false,
    updated_at: String(template.updated_at || new Date().toISOString()),
  }
}

function normalizeLocalPromptFallbackLibrary(library = {}) {
  const now = new Date().toISOString()
  const scenario = String(library.scenario || '').trim()
  return {
    library_uid: String(library.library_uid || localPromptFallbackUid('library')),
    name: String(library.name || 'AI 测图提示词库 本地版').trim() || 'AI 测图提示词库 本地版',
    scenario: ['裂变图', '创意拍摄'].includes(scenario) ? scenario : '裂变图',
    status: String(library.status || 'draft'),
    cloud_library_id: library.cloud_library_id ?? null,
    cloud_synced_at: String(library.cloud_synced_at || ''),
    import_source_path: String(library.import_source_path || ''),
    created_at: String(library.created_at || now),
    updated_at: String(library.updated_at || now),
    templates: (Array.isArray(library.templates) ? library.templates : []).map(normalizeLocalPromptFallbackTemplate),
  }
}

function readLocalPromptFallbackLibraries() {
  try {
    const parsed = JSON.parse(window.localStorage?.getItem(LOCAL_PROMPT_LIBRARY_FALLBACK_STORAGE_KEY) || '{}')
    return (Array.isArray(parsed?.libraries) ? parsed.libraries : []).map(normalizeLocalPromptFallbackLibrary)
  } catch {
    return []
  }
}

function writeLocalPromptFallbackLibraries(libraries) {
  const normalized = (Array.isArray(libraries) ? libraries : []).map(normalizeLocalPromptFallbackLibrary)
  try {
    window.localStorage?.setItem(LOCAL_PROMPT_LIBRARY_FALLBACK_STORAGE_KEY, JSON.stringify({ libraries: normalized }))
  } catch {}
  return normalized
}

function upsertLocalPromptFallbackLibrary(payload = {}) {
  const libraries = readLocalPromptFallbackLibraries()
  const libraryUid = String(payload.library_uid || '').trim()
  const existingIndex = libraries.findIndex(library => library.library_uid === libraryUid)
  const existing = existingIndex >= 0 ? libraries[existingIndex] : {}
  const next = normalizeLocalPromptFallbackLibrary({
    ...existing,
    ...payload,
    library_uid: existing.library_uid || libraryUid || localPromptFallbackUid('library'),
    status: 'draft',
    created_at: existing.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  if (existingIndex >= 0) libraries[existingIndex] = next
  else libraries.unshift(next)
  const saved = writeLocalPromptFallbackLibraries(libraries)
  return { ok: true, fallback: true, library: next, libraries: saved }
}

function createLocalPromptFallbackLibrary(payload = {}) {
  return upsertLocalPromptFallbackLibrary({
    name: payload.name || 'AI 测图提示词库 本地版',
    scenario: payload.scenario || '裂变图',
    templates: Array.isArray(payload.templates) ? payload.templates : [],
  })
}

contextBridge.exposeInMainWorld('cs', {
  getStatus:       () => ipcRenderer.invoke('get-status').then(rememberApiConnectionFromStatus),
  restartBackend:  () => ipcRenderer.invoke('restart-backend').then(rememberApiConnectionFromStatus),
  openDiagnosticLog: () => ipcRenderer.invoke('open-diagnostic-log'),
  getUpdateStatus: () => ipcRenderer.invoke('update:get-status'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate:  () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb) => {
    const listener = (_, data) => cb(data)
    ipcRenderer.on('update-status', listener)
    return () => ipcRenderer.removeListener('update-status', listener)
  },
  launchChrome:    (path) => ipcRenderer.invoke('launch-chrome', path),
  checkChrome:     () => ipcRenderer.invoke('check-chrome'),
  getCurrentChromeTab: () => ipcRenderer.invoke('get-current-chrome-tab'),

  getAdapters:     () => ipcRenderer.invoke('get-adapters'),
  installAdapter:  (payload) => ipcRenderer.invoke('install-adapter', payload),
  uninstallAdapter:(id) => ipcRenderer.invoke('uninstall-adapter', id),
  enableAdapter:   (id, enabled) => ipcRenderer.invoke('enable-adapter', id, enabled),

  getTasks:        () => ipcRenderer.invoke('get-tasks'),
  listTaskInstances: (query = {}) => invokeWithApiFallback('list-task-instances', [query],
    () => apiCall('GET', `/task-instances?${queryString(query)}`)),
  createTaskInstance: (payload) => invokeWithApiFallback('create-task-instance', [payload],
    () => apiCall('POST', '/task-instances', payload || {})),
  getTaskInstance: (uid) => invokeWithApiFallback('get-task-instance', [uid],
    () => apiCall('GET', `/task-instances/${encodePathPart(uid)}`)),
  updateTaskInstance: (uid, payload) => invokeWithApiFallback('update-task-instance', [uid, payload],
    () => apiCall('PATCH', `/task-instances/${encodePathPart(uid)}`, payload || {})),
  runTaskInstance: (uid, options = {}) => invokeWithApiFallback('run-task-instance', [uid, options || {}],
    () => apiCall('POST', `/task-instances/${encodePathPart(uid)}/run`, options || {})),
  listTaskSchedules: (query = {}) => invokeWithApiFallback('list-task-schedules', [query],
    () => apiCall('GET', `/task-schedules?${queryString(query)}`)),
  createTaskSchedule: (payload) => invokeWithApiFallback('create-task-schedule', [payload],
    () => apiCall('POST', '/task-schedules', payload || {})),
  getTaskSchedule: (uid) => invokeWithApiFallback('get-task-schedule', [uid],
    () => apiCall('GET', `/task-schedules/${encodePathPart(uid)}`)),
  updateTaskSchedule: (uid, payload) => invokeWithApiFallback('update-task-schedule', [uid, payload],
    () => apiCall('PATCH', `/task-schedules/${encodePathPart(uid)}`, payload || {})),
  deleteTaskSchedule: (uid) => invokeWithApiFallback('delete-task-schedule', [uid],
    () => apiCall('DELETE', `/task-schedules/${encodePathPart(uid)}`)),
  runTaskScheduleNow: (uid) => invokeWithApiFallback('run-task-schedule-now', [uid],
    () => apiCall('POST', `/task-schedules/${encodePathPart(uid)}/run-now`, {})),
  listAiImageJobs: () => invokeWithApiFallback('list-ai-image-jobs', [],
    () => apiCall('GET', '/ai-image/jobs')),
  createAiImageJob: (payload) => invokeWithApiFallback('create-ai-image-job', [payload],
    () => apiCall('POST', '/ai-image/jobs', payload || {})),
  getAiImageJob: (uid) => invokeWithApiFallback('get-ai-image-job', [uid],
    () => apiCall('GET', `/ai-image/jobs/${encodePathPart(uid)}`)),
  updateAiImageJob: (uid, payload) => invokeWithApiFallback('update-ai-image-job', [uid, payload],
    () => apiCall('PATCH', `/ai-image/jobs/${encodePathPart(uid)}`, payload || {})),
  setAiImageJobPinned: (uid, pinned) => invokeWithApiFallback('set-ai-image-job-pinned', [uid, pinned],
    () => apiCall('PATCH', `/ai-image/jobs/${encodePathPart(uid)}/pin`, { pinned: Boolean(pinned) })),
  deleteAiImageJob: (uid) => invokeWithApiFallback('delete-ai-image-job', [uid],
    () => apiCall('DELETE', `/ai-image/jobs/${encodePathPart(uid)}`)),
  runAiImageJob: (uid) => invokeWithApiFallback('run-ai-image-job', [uid],
    () => apiCall('POST', `/ai-image/jobs/${encodePathPart(uid)}/run`, {})),
  batchRunAiImageJob: (uid, payload) => invokeWithApiFallback('batch-run-ai-image-job', [uid, payload],
    () => apiCall('POST', `/ai-image/jobs/${encodePathPart(uid)}/batch-run`, payload || {})),
  retryAiImageRun: (uid, runUid) => invokeWithApiFallback('retry-ai-image-run', [uid, runUid],
    () => apiCall('POST', `/ai-image/jobs/${encodePathPart(uid)}/runs/${encodePathPart(runUid)}/retry`, {})),
  saveAsAiImageJob: (uid, payload) => invokeWithApiFallback('save-as-ai-image-job', [uid, payload],
    () => apiCall('POST', `/ai-image/jobs/${encodePathPart(uid)}/save-as`, payload || {})),
  materializeAiImageResult: (uid, payload) => invokeWithApiFallback('materialize-ai-image-result', [uid, payload],
    () => apiCall('POST', `/ai-image/jobs/${encodePathPart(uid)}/materialize`, payload || {})),
  createAiImageAsset: (payload) => invokeWithApiFallback('create-ai-image-asset', [payload],
    () => apiCall('POST', '/ai-image/assets', payload || {})),
  createAiImageCanvas: (payload) => invokeWithApiFallback('create-ai-image-canvas', [payload],
    () => apiCall('POST', '/ai-image/canvases', payload || {})),
  getAiVideoConfig: () => ipcRenderer.invoke('ai-video:get-config'),
  selectAiVideoImages: (opts = {}) => ipcRenderer.invoke('ai-video:select-files', opts || {}),
  selectAiVideoMedia: (opts = {}) => ipcRenderer.invoke('ai-video:select-files', opts || {}),
  selectAiVideoDirectory: (opts = {}) => ipcRenderer.invoke('ai-video:select-directory', opts || {}),
  getSavedAiVideoDirectory: (scope = 'input') => ipcRenderer.invoke('ai-video:get-saved-directory', scope),
  listAiVideoDirectory: (directoryToken, opts = {}) => ipcRenderer.invoke('ai-video:list-directory', directoryToken, opts || {}),
  openAiVideoDirectory: (directoryToken) => ipcRenderer.invoke('ai-video:open-directory', directoryToken),
  openAiVideoFile: (fileToken) => ipcRenderer.invoke('ai-video:open-file', fileToken),
  getAiVideoMediaUrl: (fileToken) => ipcRenderer.invoke('ai-video:get-media-url', fileToken),
  readAiVideoImagePreview: (fileToken) => ipcRenderer.invoke('ai-video:read-image-preview', fileToken),
  readAiVideoImageThumbnail: (fileToken, opts = {}) => ipcRenderer.invoke('ai-video:read-image-thumbnail', fileToken, opts || {}),
  validateAiVideo: (payload) => invokeWithApiFallback('ai-video:validate', [payload],
    () => apiCall('POST', '/ai-video/validate', payload || {})),
  createAiVideoJob: (payload) => invokeWithApiFallback('ai-video:create-job', [payload],
    () => apiCall('POST', '/ai-video/jobs', payload || {})),
  listAiVideoJobs: (query) => invokeWithApiFallback('ai-video:list-jobs', [query || {}],
    () => {
      const params = new URLSearchParams()
      if (query?.status) params.set('status', String(query.status))
      if (query?.provider) params.set('provider', String(query.provider))
      if (query?.limit) params.set('limit', String(query.limit))
      const suffix = params.toString()
      return apiCall('GET', `/ai-video/jobs${suffix ? `?${suffix}` : ''}`)
    }),
  getAiVideoJob: (jobId) => invokeWithApiFallback('ai-video:get-job', [jobId],
    () => apiCall('GET', `/ai-video/jobs/${encodePathPart(jobId)}`)),
  updateAiVideoJob: (jobId, payload) => invokeWithApiFallback('ai-video:update-job', [jobId, payload],
    () => apiCall('PATCH', `/ai-video/jobs/${encodePathPart(jobId)}`, payload || {})),
  duplicateAiVideoJob: (jobId) => invokeWithApiFallback('ai-video:duplicate-job', [jobId],
    () => apiCall('POST', `/ai-video/jobs/${encodePathPart(jobId)}/duplicate`, {})),
  retryAiVideoJob: (jobId, payload) => invokeWithApiFallback('ai-video:retry-job', [jobId, payload],
    () => apiCall('POST', `/ai-video/jobs/${encodePathPart(jobId)}/retry`, payload || {})),
  deleteAiVideoJobRecord: (jobId) => invokeWithApiFallback('ai-video:delete-job-record', [jobId],
    () => apiCall('DELETE', `/ai-video/jobs/${encodePathPart(jobId)}`)),
  getAiVideoRun: (runId) => invokeWithApiFallback('ai-video:get-run', [runId],
    () => apiCall('GET', `/ai-video/runs/${encodePathPart(runId)}`)),
  retryAiVideoArchive: (runId) => invokeWithApiFallback('ai-video:retry-archive', [runId],
    () => apiCall('POST', `/ai-video/runs/${encodePathPart(runId)}/archive`, {})),
  probeTaskParams: (aid, tid, params, options) => ipcRenderer.invoke('probe-task-params', aid, tid, params, options),
  runTask:         (aid, tid, params, options) => ipcRenderer.invoke('run-task', aid, tid, params, options),
  pauseTask:       (aid, tid, instanceUid = '') => ipcRenderer.invoke('pause-task', aid, tid, instanceUid),
  resumeTask:      (aid, tid, instanceUid = '') => ipcRenderer.invoke('resume-task', aid, tid, instanceUid),
  stopTask:        (aid, tid, instanceUid = '') => ipcRenderer.invoke('stop-task', aid, tid, instanceUid),
  getTaskStatus:   (aid, tid, instanceUid = '') => ipcRenderer.invoke('get-task-status', aid, tid, instanceUid),
  getTaskLogs:     (aid, tid, instanceUid = '') => ipcRenderer.invoke('get-task-logs', aid, tid, instanceUid),
  clearTaskLogs:   (aid, tid, instanceUid = '') => ipcRenderer.invoke('clear-task-logs', aid, tid, instanceUid),

  getData:         (aid, tid) => ipcRenderer.invoke('get-data', aid, tid),
  exportData:      (aid, tid, fmt) => ipcRenderer.invoke('export-data', aid, tid, fmt),
  openFile:        (path) => ipcRenderer.invoke('open-file', path),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  getApiBase:      () => apiBase(),
  readExcel:       (path, options = {}) => ipcRenderer.invoke('read-excel', path, options || {}),
  testNotify:      (channel) => ipcRenderer.invoke('test-notify', channel),
  getTmallApprovalBatch: (batchId, token) => ipcRenderer.invoke('get-tmall-approval-batch', batchId, token),
  saveTmallApprovalDecisions: (batchId, token, decisions) => ipcRenderer.invoke('save-tmall-approval-decisions', batchId, token, decisions),
  importTmallApprovalReferenceFiles: (batchId, token, paths) => ipcRenderer.invoke('import-tmall-approval-reference-files', batchId, token, paths),
  regenerateTmallApprovalAsset: (batchId, token, payload) => ipcRenderer.invoke('regenerate-tmall-approval-asset', batchId, token, payload),
  generateTmallApprovalAsset: (batchId, token, payload) => ipcRenderer.invoke('generate-tmall-approval-asset', batchId, token, payload),
  submitTmallApprovalGeneration: (batchId, token, payload) => ipcRenderer.invoke('submit-tmall-approval-generation', batchId, token, payload),
  submitTmallApprovalBatch: (batchId, token) => ipcRenderer.invoke('submit-tmall-approval-batch', batchId, token),
  createBalaMaterialBatch: (rows, sourceTask) => invokeWithApiFallback('create-bala-material-batch', [rows || [], sourceTask || {}],
    () => apiCall('POST', '/bala-ai-video-materials/api/from-rows', { rows: rows || [], source_task: sourceTask || {} })),
  getBalaMaterialBatch: (batchId, token) => invokeWithApiFallback('get-bala-material-batch', [batchId, token],
    () => apiCall('GET', `/bala-ai-video-materials/api/${encodePathPart(batchId)}?token=${encodePathPart(token)}`)),
  saveBalaMaterialSelection: (batchId, token, selectedAssetIds) => invokeWithApiFallback('save-bala-material-selection', [batchId, token, selectedAssetIds || []],
    () => apiCall('POST', `/bala-ai-video-materials/api/${encodePathPart(batchId)}/selection?token=${encodePathPart(token)}`, { selected_asset_ids: selectedAssetIds || [] })),
  exportBalaAiInput: (batchId, token, payload) => invokeWithApiFallback('export-bala-ai-input', [batchId, token, payload || {}],
    () => apiCall('POST', `/bala-ai-video-materials/api/${encodePathPart(batchId)}/export-ai-input?token=${encodePathPart(token)}`, payload || {})),
  listBalaModelLibrary: (filters) => invokeWithApiFallback('list-bala-model-library', [filters || {}],
    () => {
      const suffix = queryString(filters || {})
      return apiCall('GET', `/bala-ai-video-model-library/api${suffix ? `?${suffix}` : ''}`)
    }),
  listBalaVideoTemplates: (filters) => invokeWithApiFallback('list-bala-video-templates', [filters || {}],
    () => {
      const suffix = queryString(filters || {})
      return apiCall('GET', `/bala-ai-video-templates/api${suffix ? `?${suffix}` : ''}`)
    }),
  runBalaSeedanceVideo: (payload) => invokeWithApiFallback('run-bala-seedance-video', [payload || {}],
    () => apiCall('POST', '/bala-ai-video-seedance/api/run', payload || {})),
  getBalaVideoProviderStatus: () => invokeWithApiFallback('get-bala-video-provider-status', [],
    () => apiCall('GET', '/bala-ai-video-providers/api/status')),
  preflightBalaVideoProvider: (payload) => invokeWithApiFallback('preflight-bala-video-provider', [payload || {}],
    () => apiCall('POST', '/bala-ai-video-providers/api/preflight', payload || {})),
  refreshBalaVideoProviderTask: (payload) => invokeWithApiFallback('refresh-bala-video-provider-task', [payload || {}],
    () => apiCall('POST', '/bala-ai-video-providers/api/task', payload || {})),
  runBalaHappyHorseVideo: (payload) => invokeWithApiFallback('run-bala-happyhorse-video', [payload || {}],
    () => apiCall('POST', '/bala-ai-video-happyhorse/api/run', payload || {})),
  getBalaReviewBatch: (batchId, token) => invokeWithApiFallback('get-bala-review-batch', [batchId, token],
    () => apiCall('GET', `/bala-ai-video-review/api/${encodePathPart(batchId)}?token=${encodePathPart(token)}`)),
  listBalaReviewWorkspaceBatches: (filters = {}) => invokeWithApiFallback('list-bala-review-workspace-batches', [filters || {}],
    () => {
      const suffix = queryString(filters || {})
      return apiCall('GET', `/bala-ai-video-review-workspace/api/batches${suffix ? `?${suffix}` : ''}`)
    }),
  saveBalaReviewDecisions: (batchId, token, decisions) => invokeWithApiFallback('save-bala-review-decisions', [batchId, token, decisions || {}],
    () => apiCall('POST', `/bala-ai-video-review/api/${encodePathPart(batchId)}/decisions?token=${encodePathPart(token)}`, { decisions: decisions || {} })),
  deleteBalaReviewAsset: (batchId, token, assetId) => invokeWithApiFallback('delete-bala-review-asset', [batchId, token, assetId],
    () => apiCall('DELETE', `/bala-ai-video-review/api/${encodePathPart(batchId)}/asset/${encodePathPart(assetId)}?token=${encodePathPart(token)}`)),
  refreshBalaReviewBatch: (batchId, token) => invokeWithApiFallback('refresh-bala-review-batch', [batchId, token],
    () => apiCall('POST', `/bala-ai-video-review/api/${encodePathPart(batchId)}/refresh?token=${encodePathPart(token)}`, {})),
  regenerateBalaReviewAsset: (batchId, token, payload) => invokeWithApiFallback('regenerate-bala-review-asset', [batchId, token, payload || {}],
    () => apiCall('POST', `/bala-ai-video-review/api/${encodePathPart(batchId)}/regenerate?token=${encodePathPart(token)}`, payload || {})),
  exportBalaVideoInput: (batchId, token, payload) => invokeWithApiFallback('export-bala-video-input', [batchId, token, payload || {}],
    () => apiCall('POST', `/bala-ai-video-review/api/${encodePathPart(batchId)}/export-video-input?token=${encodePathPart(token)}`, payload || {})),
  getCloudApprovalStatus: (options = {}) => ipcRenderer.invoke('get-cloud-approval-status', options || {}),
  saveCloudApprovalConfig: (payload) => ipcRenderer.invoke('save-cloud-approval-config', payload),
  enrollCloudMachine: (payload) => ipcRenderer.invoke('enroll-cloud-machine', payload),
  startCloudMachine: () => ipcRenderer.invoke('start-cloud-machine'),
  stopCloudMachine: () => ipcRenderer.invoke('stop-cloud-machine'),
  syncCloudApprovalBatch: (payload) => ipcRenderer.invoke('sync-cloud-approval-batch', payload),
  listCloudPromptLibraries: () => invokeWithApiFallback('list-cloud-prompt-libraries', [],
    () => apiCall('GET', '/cloud-approval/prompt-libraries')),
  resolveCloudPromptTemplates: (libraryId, query = {}) => invokeWithApiFallback('resolve-cloud-prompt-templates', [libraryId, query || {}],
    () => {
      const suffix = queryString(query || {})
      return apiCall('GET', `/cloud-approval/prompt-libraries/${encodePathPart(libraryId)}/resolved${suffix ? `?${suffix}` : ''}`)
    }),
  listLocalPromptLibraries: () => invokeWithApiFallback('list-local-prompt-libraries', [],
    async () => ({ ok: true, fallback: true, libraries: readLocalPromptFallbackLibraries() })),
  createLocalPromptLibrary: (payload) => invokeWithApiFallback('create-local-prompt-library', [payload || {}],
    async () => createLocalPromptFallbackLibrary(payload || {})),
  importLocalPromptLibrary: (payload) => invokeWithApiFallback('import-local-prompt-library', [payload || {}],
    async () => upsertLocalPromptFallbackLibrary(payload || {})),
  saveLocalPromptLibrary: (libraryUid, payload) => invokeWithApiFallback('save-local-prompt-library', [libraryUid, payload || {}],
    async () => upsertLocalPromptFallbackLibrary({ ...(payload || {}), library_uid: libraryUid })),
  syncLocalPromptLibraryToCloud: (libraryUid) => invokeWithApiFallback('sync-local-prompt-library-to-cloud', [libraryUid],
    async () => {
      throw new Error('请重启抓虾客户端后再同步线上提示词库')
    }),

  getSettings:     () => ipcRenderer.invoke('get-settings'),
  saveSettings:    (cfg) => ipcRenderer.invoke('save-settings', cfg),
  patchSettings:   (cfg) => invokeWithApiFallback('patch-settings', [cfg],
    () => apiCall('PATCH', '/settings', cfg || {})),
  browseFile:      (opts) => ipcRenderer.invoke('browse-file', opts),
  selectBalaWorkspace: (opts) => ipcRenderer.invoke('select-bala-workspace', opts || {}),
  deleteBalaWorkspaceImage: (workspaceRoot, filePath) => ipcRenderer.invoke('delete-bala-workspace-image', workspaceRoot, filePath),
  getBalaWorkspaceVideoMedia: (workspaceRoot, filePath) => ipcRenderer.invoke('get-bala-workspace-video-media', workspaceRoot, filePath),
  readBalaWorkspaceManifest: (workspaceRoot) => ipcRenderer.invoke('read-bala-workspace-manifest', workspaceRoot),
  writeBalaWorkspaceManifest: (workspaceRoot, payload) => ipcRenderer.invoke('write-bala-workspace-manifest', workspaceRoot, payload || {}),
  getLocalMediaUrl: (filePath) => ipcRenderer.invoke('get-local-media-url', filePath),
  readLocalImagePreview: (path) => invokeWithApiFallback('read-local-image-preview', [path],
    () => apiCall('POST', '/files/local-image-preview', { path })),
  /** Compressed grid thumbnail (resized JPEG). Prefer this for libraries with many large images. */
  readLocalImageThumbnail: (path, opts) => ipcRenderer.invoke('read-local-image-thumbnail', path, opts || {}),
  listDirectoryFiles: (path, opts) => ipcRenderer.invoke('list-directory-files', path, opts),
  renderPdfPreview:(path) => ipcRenderer.invoke('render-pdf-preview', path),

  statFile:        (path) => ipcRenderer.invoke('stat-file', path),
  revealFile:      (path) => ipcRenderer.invoke('reveal-file', path),
  deleteFile:      (path) => ipcRenderer.invoke('delete-file', path),
  deleteFiles:     (paths) => ipcRenderer.invoke('delete-files', paths),
  syncOdpsFiles:   (payload) => ipcRenderer.invoke('sync-odps-files', payload),
  saveAsFile:      (path) => ipcRenderer.invoke('save-as-file', path),
  saveAdapterTemplate: (adapterId, templateFile, templatePath) => ipcRenderer.invoke('save-adapter-template', adapterId, templateFile, templatePath),

  onLog:    (cb) => ipcRenderer.on('log', (_, msg) => cb(msg)),
  onStatus: (cb) => ipcRenderer.on('status', (_, data) => cb(data)),
  offLog:   ()   => ipcRenderer.removeAllListeners('log'),
  offStatus:()   => ipcRenderer.removeAllListeners('status'),
})
