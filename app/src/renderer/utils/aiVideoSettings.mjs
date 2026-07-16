export const AI_VIDEO_WRITE_ONLY_FIELDS = Object.freeze([
  'ai.video.seedance_api_key',
  'ai.video.seedance_base_url',
  'ai.video.bailian_api_key',
  'ai.video.bailian_workspace_id',
  'ai.video.bailian_region',
  'ai.video.bailian_base_url',
])

const CREDENTIAL_STATUS_FIELDS = Object.freeze({
  'ai.video.seedance_api_key': 'ai.video.seedance_configured',
  'ai.video.bailian_api_key': 'ai.video.happyhorse_configured',
})

export function buildWriteOnlyAiVideoPatch(cfg = {}) {
  return AI_VIDEO_WRITE_ONLY_FIELDS.reduce((patch, key) => {
    const value = String(cfg?.[key] ?? '').trim()
    if (value) patch[key] = value
    return patch
  }, {})
}

export function isAiVideoCredentialConfigured(cfg = {}, key = '') {
  const statusKey = CREDENTIAL_STATUS_FIELDS[key]
  if (statusKey && typeof cfg?.[statusKey] === 'boolean') return cfg[statusKey]
  return Boolean(String(cfg?.[key] ?? '').trim())
}

export function clearWrittenAiVideoFields(cfg = {}, patch = {}) {
  for (const key of AI_VIDEO_WRITE_ONLY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    cfg[key] = ''
    const statusKey = CREDENTIAL_STATUS_FIELDS[key]
    if (statusKey) cfg[statusKey] = true
  }
  return cfg
}
