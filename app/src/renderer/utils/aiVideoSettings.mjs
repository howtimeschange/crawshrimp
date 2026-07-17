export const AI_VIDEO_CREDENTIAL_FIELDS = Object.freeze([
  'ai.video.seedance_api_key',
  'ai.video.bailian_api_key',
  'ai.video.bailian_upload_api_key',
])

export const AI_VIDEO_MASKED_CREDENTIAL_VALUE = '••••••••••••••••••••••••••••••••'

export const AI_VIDEO_WRITE_ONLY_FIELDS = Object.freeze([
  ...AI_VIDEO_CREDENTIAL_FIELDS,
  'ai.video.seedance_base_url',
  'ai.video.bailian_workspace_id',
  'ai.video.bailian_region',
  'ai.video.bailian_base_url',
  'ai.video.bailian_uploads_url',
])

export const AI_VIDEO_CONNECTION_DEFAULTS = Object.freeze({
  'ai.video.seedance_base_url': 'https://ark.cn-beijing.volces.com',
  'ai.video.bailian_region': 'cn-beijing',
  'ai.video.bailian_base_url': 'https://ai-aigw.semir.com/bailian-vedio/api/v1',
  'ai.video.bailian_uploads_url': 'https://dashscope.aliyuncs.com/api/v1/uploads',
})

const CREDENTIAL_STATUS_FIELDS = Object.freeze({
  'ai.video.seedance_api_key': 'ai.video.seedance_configured',
  'ai.video.bailian_api_key': 'ai.video.happyhorse_configured',
  'ai.video.bailian_upload_api_key': 'ai.video.bailian_upload_configured',
})

export function buildWriteOnlyAiVideoPatch(cfg = {}) {
  return AI_VIDEO_WRITE_ONLY_FIELDS.reduce((patch, key) => {
    const value = String(cfg?.[key] ?? '').trim()
    if (AI_VIDEO_CREDENTIAL_FIELDS.includes(key) && value.includes(AI_VIDEO_MASKED_CREDENTIAL_VALUE)) {
      return patch
    }
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
    const statusKey = CREDENTIAL_STATUS_FIELDS[key]
    if (statusKey) {
      cfg[key] = AI_VIDEO_MASKED_CREDENTIAL_VALUE
      cfg[statusKey] = true
    } else {
      cfg[key] = ''
    }
  }
  return cfg
}
