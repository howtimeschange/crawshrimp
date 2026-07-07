export interface Env {
  DB: D1Database
  ASSETS: R2Bucket
  SESSION_TTL_SECONDS?: string
}

export function sessionTtlSeconds(env: Env): number {
  const value = Number(env.SESSION_TTL_SECONDS || 604800)
  return Number.isFinite(value) && value > 0 ? value : 604800
}
