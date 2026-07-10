const STATUS_LABELS = Object.freeze({
  draft: '草稿',
  queued: '排队中',
  running: '生成中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
})

export function formatAiImageRunStatus(status) {
  const normalized = String(status || '').trim().toLowerCase()
  return STATUS_LABELS[normalized] || String(status || '').trim()
}

export function generationFailureMessage(error) {
  const message = String(error?.message || error || '').trim()
  if (/(?:status code|http)\s*(?:502|503|504)\b|bad gateway|service unavailable|gateway timeout|upstream timeout|timed out|timeout/i.test(message)) {
    return '上游生图服务响应超时。系统已完成自动重试，你可以重试本队列。'
  }
  if (/rate limit|too many requests|\b429\b/i.test(message)) {
    return '上游服务当前请求较多。请稍后重试本队列。'
  }
  if (/unauthori[sz]ed|forbidden|invalid api key|\b401\b|\b403\b/i.test(message)) {
    return '当前模型的访问配置不可用。请打开配置检查对应 Key。'
  }
  if (!message) return '生图任务未能完成。你可以重试本队列或打开参数检查。'
  return message
}

export function promptLibraryFailureMessage(error) {
  const message = String(error?.message || error || '').trim()
  if (!message) return 'Prompt 库暂时无法连接。你可以刷新重试或使用本地库。'
  if (/token|no handler|window\.cs|ipc|failed to fetch|networkerror|econnrefused|开发浏览器模式|服务未就绪/i.test(message)) {
    return 'Prompt 库暂时无法连接。你可以刷新重试、使用本地库，或前往配置检查云端连接。'
  }
  return message
}

export function retrySummaryText(run = {}) {
  const historyCount = Array.isArray(run.retry_history) ? run.retry_history.length : 0
  const automaticCount = Math.max(0, Number(run.retry_count) || 0, historyCount)
  const manualCount = Math.max(0, Number(run.manual_retry_count) || 0)
  return [
    automaticCount ? `已自动重试 ${automaticCount} 次` : '',
    manualCount ? `已手动重试 ${manualCount} 次` : '',
  ].filter(Boolean).join(' · ')
}
