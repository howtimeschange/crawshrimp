export const AI_IMAGE_MODELS = [
  {
    id: 'gpt-image-2k',
    key: 'gpt-image-2',
    label: 'GPT Image 2K',
    configId: 'ai.1xm.gpt_image_2k_key',
    size: '1024x1024',
    keyTier: '2k',
  },
  {
    id: 'gpt-image-4k',
    key: 'gpt-image-2',
    label: 'GPT Image 4K',
    configId: 'ai.1xm.gpt_image_4k_key',
    size: '2048x2048',
    keyTier: '4k',
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    key: 'gemini-3.1-flash-image-preview',
    label: 'Gemini 3.1 Flash Image Preview',
    configId: 'ai.1xm.gemini_3_1_flash_image_preview_key',
    size: '1024x1024',
    keyTier: 'ai.1xm.gemini_3_1_flash_image_preview_key',
  },
  {
    id: 'gemini-3-pro-image-preview',
    key: 'gemini-3-pro-image-preview',
    label: 'Gemini 3 Pro Image Preview',
    configId: 'ai.1xm.gemini_3_pro_image_preview_key',
    size: '1024x1024',
    keyTier: 'ai.1xm.gemini_3_pro_image_preview_key',
  },
]

export const AI_IMAGE_SIZE_OPTIONS = [
  { size: '1024x1024', ratio: '1:1', tier: '2k' },
  { size: '2048x2048', ratio: '1:1', tier: '2k' },
  { size: '2048x2048', ratio: '1:1', tier: '4k' },
  { size: '960x1280', ratio: '3:4', tier: '2k' },
  { size: '1536x2048', ratio: '3:4', tier: '2k' },
  { size: '1536x2048', ratio: '3:4', tier: '4k' },
  { size: '1280x960', ratio: '4:3', tier: '2k' },
  { size: '2048x1536', ratio: '4:3', tier: '2k' },
  { size: '2048x1536', ratio: '4:3', tier: '4k' },
  { size: '1024x1280', ratio: '4:5', tier: '2k' },
  { size: '1536x1920', ratio: '4:5', tier: '2k' },
  { size: '1536x1920', ratio: '4:5', tier: '4k' },
  { size: '1536x1024', ratio: '3:2', tier: '2k' },
  { size: '1536x1024', ratio: '3:2', tier: '4k' },
  { size: '1024x1536', ratio: '2:3', tier: '2k' },
  { size: '1024x1536', ratio: '2:3', tier: '4k' },
  { size: '1536x864', ratio: '16:9', tier: '2k' },
  { size: '1920x1080', ratio: '16:9', tier: '2k' },
  { size: '1920x1080', ratio: '16:9', tier: '4k' },
  { size: '864x1536', ratio: '9:16', tier: '2k' },
  { size: '1080x1920', ratio: '9:16', tier: '2k' },
  { size: '1080x1920', ratio: '9:16', tier: '4k' },
]
export const AI_IMAGE_RATIOS = ['1:1', '3:4', '4:3', '4:5', '3:2', '2:3', '16:9', '9:16']
export const AI_IMAGE_SIZES = [...new Set(AI_IMAGE_SIZE_OPTIONS.map((option) => option.size))]
export const AI_IMAGE_QUALITIES = ['standard', 'high']
export const AI_IMAGE_FORMATS = ['png', 'jpg', 'webp']

export function outputDirHint(platform = '') {
  const isWindows = String(platform || '').toLowerCase().startsWith('win')
  if (isWindows) return '%USERPROFILE%\\Downloads\\抓虾导出\\AI生图'
  return '~/Downloads/抓虾导出/AI生图；Windows：%USERPROFILE%\\Downloads\\抓虾导出\\AI生图'
}

export function getAiImageModel(modelId) {
  return AI_IMAGE_MODELS.find((model) => model.id === modelId) || AI_IMAGE_MODELS[0]
}

function gcd(left, right) {
  let a = Math.abs(Number(left) || 0)
  let b = Math.abs(Number(right) || 0)
  while (b) {
    const next = a % b
    a = b
    b = next
  }
  return a || 1
}

function maxDimension(size) {
  const match = String(size || '').trim().match(/^(\d+)x(\d+)$/i)
  if (!match) return 0
  return Math.max(Number(match[1]) || 0, Number(match[2]) || 0)
}

export function ratioForSize(size, fallback = '1:1') {
  const direct = AI_IMAGE_SIZE_OPTIONS.find((option) => option.size === size)
  if (direct) return direct.ratio
  const match = String(size || '').trim().match(/^(\d+)x(\d+)$/i)
  if (!match) return fallback
  const width = Number(match[1])
  const height = Number(match[2])
  const divisor = gcd(width, height)
  const ratio = `${width / divisor}:${height / divisor}`
  return AI_IMAGE_RATIOS.includes(ratio) ? ratio : fallback
}

export function sizesForRatio(ratio) {
  const normalized = AI_IMAGE_RATIOS.includes(ratio) ? ratio : '1:1'
  return [...new Set(AI_IMAGE_SIZE_OPTIONS
    .filter((option) => option.ratio === normalized)
    .map((option) => option.size))]
}

export function defaultSizeForRatio(ratio, tier = '2k') {
  const sizes = AI_IMAGE_SIZE_OPTIONS.filter((option) => option.ratio === (AI_IMAGE_RATIOS.includes(ratio) ? ratio : '1:1'))
  if (!sizes.length) return '1024x1024'
  const normalizedTier = String(tier || '').toLowerCase() === '4k' ? '4k' : '2k'
  const tierMatch = sizes.find((option) => option.tier === normalizedTier)
  return (tierMatch || sizes[0]).size
}

export function sizeForRatio(ratio, currentSize = '', tier = '2k') {
  const options = sizesForRatio(ratio)
  return options.includes(currentSize) ? currentSize : defaultSizeForRatio(ratio, tier)
}

export function modelIdForJob(job = {}) {
  const directId = job.model_id || job.modelId
  if (AI_IMAGE_MODELS.some((model) => model.id === directId)) return directId

  const modelKey = job.model_key || job.modelKey || ''
  const directModel = AI_IMAGE_MODELS.find((model) => model.key === modelKey && model.key !== 'gpt-image-2')
  if (directModel) return directModel.id

  if (modelKey === 'gpt-image-2') {
    const tier = String(job.model_key_tier || job.params?.model_key_tier || '').toLowerCase()
    if (tier === '4k') return 'gpt-image-4k'
    if (tier === '2k') return 'gpt-image-2k'
    if (maxDimension(job.params?.size || job.size) > 2048) return 'gpt-image-4k'
    return 'gpt-image-2k'
  }

  return AI_IMAGE_MODELS[0].id
}

export function defaultAiImageForm(overrides = {}) {
  const model = getAiImageModel(overrides.modelId)
  const baseSize = overrides.size || model.size
  const ratio = overrides.ratio || ratioForSize(baseSize)
  const size = sizeForRatio(ratio, baseSize, model.keyTier)
  return {
    title: 'AI 生图任务',
    modelId: model.id,
    model_key: model.key,
    model_key_tier: model.keyTier,
    size,
    ratio: overrides.ratio || ratioForSize(size),
    quality: 'high',
    format: 'png',
    count: 4,
    output_dir: '~/Downloads/抓虾导出/AI生图',
    prompt: '',
    advancedJson: '',
    mainImagePath: '',
    referenceImagePaths: [],
    ...overrides,
    modelId: model.id,
    model_key: model.key,
    model_key_tier: model.keyTier,
    size,
    ratio,
  }
}

export function normalizeSettings(settings = {}) {
  const direct = settings && typeof settings === 'object' ? settings : {}
  const ai = direct.ai && typeof direct.ai === 'object' ? direct.ai : {}
  const oneXm = ai['1xm'] && typeof ai['1xm'] === 'object' ? ai['1xm'] : {}
  return {
    ...direct,
    'ai.1xm.gpt_image_2k_key': direct['ai.1xm.gpt_image_2k_key'] ?? oneXm.gpt_image_2k_key ?? direct['2k'] ?? '',
    'ai.1xm.gpt_image_4k_key': direct['ai.1xm.gpt_image_4k_key'] ?? oneXm.gpt_image_4k_key ?? direct['4k'] ?? '',
    'ai.1xm.gemini_3_1_flash_image_preview_key':
      direct['ai.1xm.gemini_3_1_flash_image_preview_key'] ?? oneXm.gemini_3_1_flash_image_preview_key ?? '',
    'ai.1xm.gemini_3_pro_image_preview_key':
      direct['ai.1xm.gemini_3_pro_image_preview_key'] ?? oneXm.gemini_3_pro_image_preview_key ?? '',
  }
}

export function missingKeyForModel(modelId, settings = {}) {
  const model = getAiImageModel(modelId)
  const normalized = normalizeSettings(settings)
  return String(normalized[model.configId] || '').trim() ? '' : model.configId
}
