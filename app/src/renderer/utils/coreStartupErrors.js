export function isCoreStartupConnectionError(error) {
  const message = String(error?.message || error || '')
  return /核心服务未能连接/.test(message) ||
    /connect ECONN(?:REFUSED|RESET)\s+127\.0\.0\.1:\d+/.test(message) ||
    /ECONN(?:REFUSED|RESET)\s+127\.0\.0\.1:\d+/.test(message)
}

export function formatScriptListLoadError(error, fallback = '脚本列表加载失败，请稍后重试') {
  if (isCoreStartupConnectionError(error)) {
    return '核心服务正在启动，稍后会自动刷新。'
  }
  return String(error?.message || '').trim() || fallback
}
