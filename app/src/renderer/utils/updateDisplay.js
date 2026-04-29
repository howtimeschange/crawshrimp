const ACTIONABLE_UPDATE_STATUSES = ['available', 'downloaded', 'downloading']

export function buildTopbarUpdatePrompt(updateStatus = {}) {
  const status = String(updateStatus.status || '').trim().toLowerCase()
  const latestVersion = String(updateStatus.latestVersion || '').trim()
  if (!ACTIONABLE_UPDATE_STATUSES.includes(status)) return null

  if (status === 'downloading') {
    const percent = Math.max(0, Math.min(100, Math.round(Number(updateStatus.progress?.percent || 0))))
    return {
      label: percent > 0 ? `更新 ${percent}%` : '更新中',
      title: latestVersion ? `正在下载 v${latestVersion}` : '正在下载新版本',
    }
  }

  if (status === 'downloaded') {
    return {
      label: '安装更新',
      title: latestVersion ? `v${latestVersion} 已下载，点击安装` : '新版本已下载，点击安装',
    }
  }

  return {
    label: '更新',
    title: latestVersion ? `发现 v${latestVersion}，点击查看` : '发现新版本，点击查看',
  }
}
