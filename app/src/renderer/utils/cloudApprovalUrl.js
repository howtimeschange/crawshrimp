export function buildEmbeddedCloudApprovalUrl(rawUrl) {
  const raw = String(rawUrl || '').trim()
  if (!raw) return ''
  const url = new URL(raw)
  url.searchParams.set('embed', '1')
  return url.toString()
}
