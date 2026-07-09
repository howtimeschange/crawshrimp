export function isTrustedCloudApprovalBoardUrl(rawUrl, configuredBaseUrl = '') {
  const raw = String(rawUrl || '').trim()
  const base = String(configuredBaseUrl || '').trim()
  if (!raw || !base) return false
  try {
    const url = new URL(raw)
    const configured = new URL(base)
    if (!['http:', 'https:'].includes(url.protocol)) return false
    if (!['http:', 'https:'].includes(configured.protocol)) return false
    if (url.origin !== configured.origin) return false
    if (!String(url.searchParams.get('batch_uid') || '').trim()) return false
    if (url.pathname.includes('/tmall-ai-image-approval/')) return false
    return true
  } catch {
    return false
  }
}

export function buildEmbeddedCloudApprovalUrl(rawUrl, configuredBaseUrl = '') {
  const raw = String(rawUrl || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    if (String(configuredBaseUrl || '').trim() && !isTrustedCloudApprovalBoardUrl(raw, configuredBaseUrl)) return ''
    url.searchParams.set('embed', '1')
    return url.toString()
  } catch {
    return ''
  }
}
