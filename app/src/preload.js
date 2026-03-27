'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cs', {
  getStatus:       () => ipcRenderer.invoke('get-status'),
  launchChrome:    (path) => ipcRenderer.invoke('launch-chrome', path),
  checkChrome:     () => ipcRenderer.invoke('check-chrome'),

  getAdapters:     () => ipcRenderer.invoke('get-adapters'),
  installAdapter:  (payload) => ipcRenderer.invoke('install-adapter', payload),
  uninstallAdapter:(id) => ipcRenderer.invoke('uninstall-adapter', id),
  enableAdapter:   (id, enabled) => ipcRenderer.invoke('enable-adapter', id, enabled),

  getTasks:        () => ipcRenderer.invoke('get-tasks'),
  runTask:         (aid, tid, params) => ipcRenderer.invoke('run-task', aid, tid, params),
  getTaskStatus:   (aid, tid) => ipcRenderer.invoke('get-task-status', aid, tid),
  getTaskLogs:     (aid, tid) => ipcRenderer.invoke('get-task-logs', aid, tid),
  clearTaskLogs:   (aid, tid) => ipcRenderer.invoke('clear-task-logs', aid, tid),

  getData:         (aid, tid) => ipcRenderer.invoke('get-data', aid, tid),
  exportData:      (aid, tid, fmt) => ipcRenderer.invoke('export-data', aid, tid, fmt),
  openFile:        (path) => ipcRenderer.invoke('open-file', path),
  readExcel:       (path) => ipcRenderer.invoke('read-excel', path),
  testNotify:      (channel) => ipcRenderer.invoke('test-notify', channel),

  getSettings:     () => ipcRenderer.invoke('get-settings'),
  saveSettings:    (cfg) => ipcRenderer.invoke('save-settings', cfg),
  browseFile:      (opts) => ipcRenderer.invoke('browse-file', opts),

  statFile:        (path) => ipcRenderer.invoke('stat-file', path),
  revealFile:      (path) => ipcRenderer.invoke('reveal-file', path),
  deleteFile:      (path) => ipcRenderer.invoke('delete-file', path),
  saveAsFile:      (path) => ipcRenderer.invoke('save-as-file', path),

  onLog:    (cb) => ipcRenderer.on('log', (_, msg) => cb(msg)),
  onStatus: (cb) => ipcRenderer.on('status', (_, data) => cb(data)),
  offLog:   ()   => ipcRenderer.removeAllListeners('log'),
  offStatus:()   => ipcRenderer.removeAllListeners('status'),
})
