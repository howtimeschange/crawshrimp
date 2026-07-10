export interface Env {
  DB: D1Database
  ASSETS: R2Bucket
  SESSION_TTL_SECONDS?: string
  ONE_XM_BASE_URL?: string
  ONE_XM_API_KEY?: string
  ONE_XM_GPT_IMAGE_2_KEY?: string
  ONE_XM_GEMINI_3_1_FLASH_IMAGE_PREVIEW_KEY?: string
  ONE_XM_GEMINI_3_PRO_IMAGE_PREVIEW_KEY?: string
  ONE_XM_GPT_IMAGE_GROUP?: string
  ONE_XM_IMAGE_TIMEOUT_MS?: string
  ONE_XM_IMAGE_FETCH_TIMEOUT_MS?: string
  ONE_XM_IMAGE_POLL_INTERVAL_MS?: string
  ONE_XM_IMAGE_MAX_POLLS?: string
}

export function sessionTtlSeconds(env: Env): number {
  const value = Number(env.SESSION_TTL_SECONDS || 604800)
  return Number.isFinite(value) && value > 0 ? value : 604800
}
