/**
 * Provider list-price snapshots for estimated cost UI.
 * Actual billing is settled by Ark / Bailian consoles and may include discounts.
 */

/** HappyHorse 1.1 — 华北2（北京）原价，按输出视频秒数计费（元/秒） */
export const HAPPYHORSE_RATE_CNY_PER_SEC = {
  '720P': 0.9,
  '1080P': 1.2,
}

/**
 * Seedance 2.0 — 公开资料约「纯视频生成 ≈ 1 元/秒（720p 口径）」。
 * 480p / 1080p 用相对系数做前端预估，非控制台实时价。
 */
export const SEEDANCE_RATE_CNY_PER_SEC = {
  '480p': 0.7,
  '720p': 1.0,
  '1080p': 1.0,
}

export function normalizeHappyHorseResolution(value) {
  const raw = String(value || '720P').trim().toUpperCase()
  return raw === '1080P' ? '1080P' : '720P'
}

export function normalizeSeedanceResolution(value) {
  const raw = String(value || '720p').trim().toLowerCase()
  if (raw === '480p') return '480p'
  if (raw === '1080p') return '1080p'
  return '720p'
}

export function clampDuration(value, { min = 3, max = 15 } = {}) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.round(n)))
}

/**
 * Resolve HappyHorse mode purely from image count.
 * 0 → t2v, 1 → i2v, 2-9 → r2v
 */
export function resolveHappyHorseMode(imageCount) {
  const count = Math.max(0, Number(imageCount) || 0)
  if (count <= 0) return 't2v'
  if (count === 1) return 'i2v'
  return 'r2v'
}

export function happyHorseModelId(mode) {
  if (mode === 'i2v') return 'happyhorse-1.1-i2v'
  if (mode === 'r2v') return 'happyhorse-1.1-r2v'
  return 'happyhorse-1.1-t2v'
}

export function happyHorseModeLabel(mode) {
  return ({
    t2v: '文生视频',
    i2v: '图生视频',
    r2v: '参考生视频',
  })[mode] || mode
}

/**
 * @returns {{
 *   currency: 'CNY',
 *   duration: number,
 *   ratePerSec: number,
 *   total: number,
 *   formula: string,
 *   disclaimer: string,
 * }}
 */
export function estimateVideoCost({ provider, resolution, duration }) {
  if (['kling-v3', 'kling-omni', 'pixverse-motioncontrol'].includes(String(provider || ''))) {
    return {
      currency: 'CNY',
      duration: 0,
      ratePerSec: Number.NaN,
      total: Number.NaN,
      formula: '百炼控制台按模型实际用量结算',
      disclaimer: 'Kling / PixVerse 价格不在本地写死，实际以百炼控制台账单为准',
      known: false,
    }
  }

  const secs = clampDuration(duration, {
    min: provider === 'seedance' ? 4 : 3,
    max: 15,
  })

  if (provider === 'happyhorse') {
    const res = normalizeHappyHorseResolution(resolution)
    const rate = HAPPYHORSE_RATE_CNY_PER_SEC[res] ?? 0.9
    const total = Number((rate * secs).toFixed(2))
    return {
      currency: 'CNY',
      duration: secs,
      ratePerSec: rate,
      total,
      formula: `${secs} 秒 × ${rate} 元/秒（${res}）`,
      disclaimer: '百炼原价快照，实际以控制台结算为准（可能有折扣/额度）',
      known: true,
    }
  }

  const res = normalizeSeedanceResolution(resolution)
  const rate = SEEDANCE_RATE_CNY_PER_SEC[res] ?? 1.0
  const total = Number((rate * secs).toFixed(2))
  return {
    currency: 'CNY',
    duration: secs,
    ratePerSec: rate,
    total,
    formula: `${secs} 秒 × 约 ${rate} 元/秒（${res}）`,
    disclaimer: '方舟公开口径约 1 元/秒（720p 纯生成），实际以控制台结算为准',
    known: true,
  }
}

export function formatCny(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '—'
  return `¥${n.toFixed(2)}`
}
