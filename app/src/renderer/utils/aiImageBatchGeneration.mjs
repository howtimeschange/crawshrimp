const text = (value) => String(value || '').trim()

export function normalizeBatchPromptCount(value, options = {}) {
  if (options.forceSingle) return 1
  const parsed = Number.parseInt(String(value ?? 1), 10)
  if (!Number.isFinite(parsed)) return 1
  return Math.max(1, Math.min(8, parsed))
}

export function summarizeBatchPrompts(cards = [], options = {}) {
  return (Array.isArray(cards) ? cards : []).reduce((summary, card) => {
    if (!text(card?.prompt)) return summary
    summary.promptCount += 1
    summary.totalImages += normalizeBatchPromptCount(card?.count, options)
    return summary
  }, { promptCount: 0, totalImages: 0 })
}

export function batchSettingsFromForm(snapshot = {}) {
  return {
    modelId: text(snapshot.modelId),
    ratio: text(snapshot.ratio) || '1:1',
    size: text(snapshot.size),
    quality: text(snapshot.quality) || 'auto',
    format: text(snapshot.format) || 'png',
  }
}

export function loadingSlotIndexes(run = {}) {
  const status = text(run.status).toLowerCase()
  if (!['queued', 'running'].includes(status)) return []
  const count = normalizeBatchPromptCount(run.requested_count)
  return Array.from({ length: count }, (_, index) => index)
}
