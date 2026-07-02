'use strict'
const { contextBridge, ipcRenderer } = require('electron')

const DEFAULT_API_BASE = 'http://127.0.0.1:18765'
const TOKEN_STORAGE_KEY = 'crawshrimp.apiToken'
const API_BASE_STORAGE_KEY = 'crawshrimp.apiBase'
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

contextBridge.exposeInMainWorld('cs', {
  getStatus:       () => ipcRenderer.invoke('get-status').then(rememberApiConnectionFromStatus),
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
  runTaskInstance: (uid) => invokeWithApiFallback('run-task-instance', [uid],
    () => apiCall('POST', `/task-instances/${encodePathPart(uid)}/run`, {})),
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
  probeTaskParams: (aid, tid, params, options) => ipcRenderer.invoke('probe-task-params', aid, tid, params, options),
  runTask:         (aid, tid, params, options) => ipcRenderer.invoke('run-task', aid, tid, params, options),
  pauseTask:       (aid, tid) => ipcRenderer.invoke('pause-task', aid, tid),
  resumeTask:      (aid, tid) => ipcRenderer.invoke('resume-task', aid, tid),
  stopTask:        (aid, tid) => ipcRenderer.invoke('stop-task', aid, tid),
  getTaskStatus:   (aid, tid) => ipcRenderer.invoke('get-task-status', aid, tid),
  getTaskLogs:     (aid, tid) => ipcRenderer.invoke('get-task-logs', aid, tid),
  clearTaskLogs:   (aid, tid) => ipcRenderer.invoke('clear-task-logs', aid, tid),

  getData:         (aid, tid) => ipcRenderer.invoke('get-data', aid, tid),
  exportData:      (aid, tid, fmt) => ipcRenderer.invoke('export-data', aid, tid, fmt),
  openFile:        (path) => ipcRenderer.invoke('open-file', path),
  readExcel:       (path) => ipcRenderer.invoke('read-excel', path),
  testNotify:      (channel) => ipcRenderer.invoke('test-notify', channel),
  getTmallApprovalBatch: (batchId, token) => ipcRenderer.invoke('get-tmall-approval-batch', batchId, token),
  saveTmallApprovalDecisions: (batchId, token, decisions) => ipcRenderer.invoke('save-tmall-approval-decisions', batchId, token, decisions),
  regenerateTmallApprovalAsset: (batchId, token, payload) => ipcRenderer.invoke('regenerate-tmall-approval-asset', batchId, token, payload),
  submitTmallApprovalBatch: (batchId, token) => ipcRenderer.invoke('submit-tmall-approval-batch', batchId, token),

  getSettings:     () => ipcRenderer.invoke('get-settings'),
  saveSettings:    (cfg) => ipcRenderer.invoke('save-settings', cfg),
  patchSettings:   (cfg) => invokeWithApiFallback('patch-settings', [cfg],
    () => apiCall('PATCH', '/settings', cfg || {})),
  browseFile:      (opts) => ipcRenderer.invoke('browse-file', opts),
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
