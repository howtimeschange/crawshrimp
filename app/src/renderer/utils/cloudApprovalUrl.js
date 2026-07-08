export function buildEmbeddedCloudApprovalUrl(rawUrl) {
  const raw = String(rawUrl || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    url.searchParams.set('embed', '1')
    return url.toString()
  } catch {
    return ''
  }
}
