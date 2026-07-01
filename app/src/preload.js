'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cs', {
  getStatus:       () => ipcRenderer.invoke('get-status'),
  launchChrome:    (path) => ipcRenderer.invoke('launch-chrome', path),
  checkChrome:     () => ipcRenderer.invoke('check-chrome'),
  getCurrentChromeTab: () => ipcRenderer.invoke('get-current-chrome-tab'),

  getAdapters:     () => ipcRenderer.invoke('get-adapters'),
  installAdapter:  (payload) => ipcRenderer.invoke('install-adapter', payload),
  uninstallAdapter:(id) => ipcRenderer.invoke('uninstall-adapter', id),
  enableAdapter:   (id, enabled) => ipcRenderer.invoke('enable-adapter', id, enabled),

  getTasks:        () => ipcRenderer.invoke('get-tasks'),
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
