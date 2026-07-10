'use strict'

const path = require('path')

function evaluateUpdatePlatform({ platform, isPackaged, execPath, homeDir }) {
  if (!isPackaged) return { supported: false, reason: '开发模式不会检查桌面更新。' }
  if (platform !== 'darwin') return { supported: true, reason: '' }

  const normalized = String(execPath || '').replace(/\\/g, '/')
  const userApplications = path.join(String(homeDir || ''), 'Applications').replace(/\\/g, '/')
  const inApplications = normalized.startsWith('/Applications/') ||
    (userApplications && normalized.startsWith(userApplications + '/'))
  if (normalized.startsWith('/Volumes/')) {
    return { supported: false, reason: '请先将抓虾拖入“应用程序”目录，再检查更新。' }
  }
  if (normalized.includes('/AppTranslocation/')) {
    return { supported: false, reason: '抓虾当前处于系统隔离路径，请重新从“应用程序”目录打开。' }
  }
  if (!inApplications) {
    return { supported: false, reason: '请从“应用程序”目录运行抓虾后再更新。' }
  }
  return { supported: true, reason: '' }
}

function resolveTestFeedUrl({ isTestBuild, env }) {
  if (!isTestBuild) return ''
  return String(env?.CRAWSHRIMP_UPDATE_E2E_URL || '').trim()
}

module.exports = { evaluateUpdatePlatform, resolveTestFeedUrl }
