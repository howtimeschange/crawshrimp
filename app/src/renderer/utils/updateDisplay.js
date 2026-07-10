const ACTION_BY_STATUS = Object.freeze({
  available: 'download',
  error: 'retry',
  'ready-to-install': 'install',
})

export function buildSidebarUpdatePresentation(updateStatus = {}, collapsed = false) {
  const status = String(updateStatus.status || 'idle')
  const currentVersion = normalizeVersion(updateStatus.currentVersion)
  const latestVersion = normalizeVersion(updateStatus.latestVersion)
  const versionLabel = formatVersionLabel(currentVersion, collapsed)
  const action = ACTION_BY_STATUS[status] || null
  const base = {
    action,
    label: '',
    versionLabel,
    title: '',
    tone: 'up-to-date',
    percent: null,
  }

  if (status === 'checking') {
    return {
      ...base,
      label: '检查更新中',
      title: '正在检查桌面更新',
      tone: 'checking',
    }
  }

  if (status === 'available') {
    return {
      ...base,
      label: '更新',
      title: `发现 ${formatFullVersion(latestVersion)}，点击下载`,
      tone: 'available',
    }
  }

  if (status === 'downloading') {
    const percent = normalizePercent(updateStatus.progress?.percent)
    return {
      ...base,
      label: `下载中 ${percent}%`,
      title: `正在下载 ${formatFullVersion(latestVersion || currentVersion)}`,
      tone: 'downloading',
      percent,
    }
  }

  if (status === 'downloaded') {
    return {
      ...base,
      label: '准备安装',
      title: `${formatFullVersion(latestVersion || currentVersion)} 已下载，正在确认是否可以安装`,
      tone: 'waiting',
    }
  }

  if (status === 'waiting-for-tasks') {
    const blockerCount = Array.isArray(updateStatus.blockers) ? updateStatus.blockers.length : 0
    return {
      ...base,
      label: blockerCount > 0 ? `等待 ${blockerCount} 个任务结束` : '等待任务结束',
      title: `${formatFullVersion(latestVersion || currentVersion)} 已下载，等待 ${blockerCount} 个任务结束后安装`,
      tone: 'waiting',
    }
  }

  if (status === 'ready-to-install') {
    return {
      ...base,
      label: '重启安装',
      title: `${formatFullVersion(latestVersion || currentVersion)} 已准备好，点击重启安装`,
      tone: 'ready',
    }
  }

  if (status === 'installing') {
    return {
      ...base,
      label: '正在重启',
      title: `正在重启安装 ${formatFullVersion(latestVersion || currentVersion)}`,
      tone: 'installing',
    }
  }

  if (status === 'error') {
    const error = String(updateStatus.error || '桌面更新失败。')
    return {
      ...base,
      label: '重试',
      title: `更新失败：${error}`,
      tone: 'error',
    }
  }

  if (status === 'disabled') {
    return {
      ...base,
      label: '桌面更新不可用',
      title: String(updateStatus.error || '当前环境不支持桌面更新。'),
      tone: 'disabled',
    }
  }

  return {
    ...base,
    label: '已是最新',
    title: `当前已是最新版本 ${formatFullVersion(currentVersion)}`,
  }
}

function normalizePercent(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(100, Math.round(numeric)))
}

function normalizeVersion(value) {
  return String(value || '').trim()
}

function formatFullVersion(version) {
  return version ? `v${version}` : '当前版本'
}

function formatVersionLabel(version, collapsed) {
  if (!version) return 'v--'
  const parts = version.split('.').filter(Boolean)
  if (collapsed && parts.length >= 2) return `v${parts[0]}.${parts[1]}`
  return `v${version}`
}
