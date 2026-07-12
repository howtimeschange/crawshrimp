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
  const rawUrl = String(env?.CRAWSHRIMP_UPDATE_E2E_URL || '').trim()
  if (!rawUrl) return ''

  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    return ''
  }

  const hostname = parsed.hostname.toLowerCase()
  const isLoopback = hostname === '127.0.0.1' || hostname === 'localhost'
  if (parsed.protocol !== 'http:' || !isLoopback) return ''
  if (parsed.username || parsed.password) return ''
  parsed.hostname = hostname
  parsed.hash = ''
  return parsed.toString()
}

function resolveUpdateFeedUrl({ isTestBuild, env, configuredFeedUrl }) {
  const testFeedUrl = resolveTestFeedUrl({ isTestBuild, env })
  if (testFeedUrl) return testFeedUrl

  const rawUrl = String(configuredFeedUrl || '').trim()
  if (!rawUrl) return ''

  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    return ''
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return ''
  parsed.hash = ''
  parsed.search = ''
  return parsed.toString()
}

module.exports = { evaluateUpdatePlatform, resolveTestFeedUrl, resolveUpdateFeedUrl }
