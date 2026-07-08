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
    size: '4096x4096',
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

export const AI_IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536', '2048x2048', '4096x4096']
export const AI_IMAGE_RATIOS = ['1:1', '4:5', '3:4', '16:9', '9:16']
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
    if (job.params?.size === '4096x4096' || job.size === '4096x4096') return 'gpt-image-4k'
    return 'gpt-image-2k'
  }

  return AI_IMAGE_MODELS[0].id
}

export function defaultAiImageForm(overrides = {}) {
  const model = getAiImageModel(overrides.modelId)
  return {
    title: 'AI 生图任务',
    modelId: model.id,
    model_key: model.key,
    model_key_tier: model.keyTier,
    size: model.size,
    ratio: '1:1',
    quality: 'high',
    format: 'png',
    count: 4,
    output_dir: '~/Downloads/抓虾导出/AI生图',
    prompt: '',
    advancedJson: '',
    mainImagePath: '',
    referenceImagePaths: [],
    ...overrides,
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
