'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cs', {
  // System info
  getStatus:       () => ipcRenderer.invoke('get-status'),

  // Chrome / CDP
  launchChrome:    (path) => ipcRenderer.invoke('launch-chrome', path),
  checkChrome:     () => ipcRenderer.invoke('check-chrome'),
  getChromeTabs:   () => ipcRenderer.invoke('get-chrome-tabs'),

  // Adapter management (proxied to FastAPI)
  getAdapters:     () => ipcRenderer.invoke('get-adapters'),
  installAdapter:  (payload) => ipcRenderer.invoke('install-adapter', payload),
  uninstallAdapter:(id) => ipcRenderer.invoke('uninstall-adapter', id),
  enableAdapter:   (id, enabled) => ipcRenderer.invoke('enable-adapter', id, enabled),

  // Task control
  getTasks:        () => ipcRenderer.invoke('get-tasks'),
  runTask:         (adapterId, taskId) => ipcRenderer.invoke('run-task', adapterId, taskId),
  stopTask:        (adapterId, taskId) => ipcRenderer.invoke('stop-task', adapterId, taskId),
  getTaskStatus:   (adapterId, taskId) => ipcRenderer.invoke('get-task-status', adapterId, taskId),
  getTaskLogs:     (adapterId, taskId) => ipcRenderer.invoke('get-task-logs', adapterId, taskId),

  // Data
  getData:         (adapterId, taskId) => ipcRenderer.invoke('get-data', adapterId, taskId),
  exportData:      (adapterId, taskId, fmt) => ipcRenderer.invoke('export-data', adapterId, taskId, fmt),

  // Settings
  getSettings:     () => ipcRenderer.invoke('get-settings'),
  saveSettings:    (cfg) => ipcRenderer.invoke('save-settings', cfg),
  browseFile:      (opts) => ipcRenderer.invoke('browse-file', opts),

  // Events from main process
  onLog:    (cb) => ipcRenderer.on('log', (_, msg) => cb(msg)),
  onStatus: (cb) => ipcRenderer.on('status', (_, data) => cb(data)),
  offLog:   ()   => ipcRenderer.removeAllListeners('log'),
  offStatus:()   => ipcRenderer.removeAllListeners('status'),
})
