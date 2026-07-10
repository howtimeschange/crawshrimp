export const AI_IMAGE_LOADING_MESSAGES = [
  '正在出海',
  '正在撒网',
  '正在寻找灵感海域',
  '正在捕捞画面',
  '正在收网',
  '正在挑选大虾',
  '正在满载返航',
]

const text = (value) => String(value || '').trim()
const paths = (value) => (Array.isArray(value) ? value.map(text).filter(Boolean) : [])

export function resolveLoadingPreviewContext(job = {}, run = {}, fallback = {}) {
  const hasRunSnapshot = Boolean(run.input_params && typeof run.input_params === 'object')
  const runParams = hasRunSnapshot ? run.input_params : {}
  const jobParams = job.params && typeof job.params === 'object' ? job.params : {}
  const mainImagePath = hasRunSnapshot
    ? text(runParams.main_image_path)
    : text(jobParams.main_image_path || fallback.mainImagePath)
  const referenceImagePaths = paths(
    hasRunSnapshot
      ? runParams.reference_image_paths
      : paths(jobParams.reference_image_paths).length
        ? jobParams.reference_image_paths
        : fallback.referenceImagePaths,
  )
  const previewPath = mainImagePath || referenceImagePaths[0] || ''
  return { previewPath, mode: previewPath ? 'input' : 'text' }
}

export function loadingMessageFor(tick = 0, offset = 0) {
  const rawIndex = Number(tick) + Number(offset)
  const index = Math.abs(Number.isFinite(rawIndex) ? rawIndex : 0) % AI_IMAGE_LOADING_MESSAGES.length
  return AI_IMAGE_LOADING_MESSAGES[index]
}
