export const LLM_MASKED_CREDENTIAL_VALUE = '••••••••••••••••••••••••••••••••'

export const LLM_API_KEY_FIELD = 'ai.llm.api_key'
export const DEEPSEEK_API_KEY_FIELD = 'ai.llm.deepseek_api_key'
export const DEEPSEEK_BASE_URL_FIELD = 'ai.llm.deepseek_base_url'
export const GLM_API_KEY_FIELD = 'ai.llm.glm_api_key'
export const GLM_BASE_URL_FIELD = 'ai.llm.glm_base_url'
export const DEEPSEEK_OFFICIAL_BASE_URL_DEFAULT = 'https://api.deepseek.com'
export const GLM_OFFICIAL_BASE_URL_DEFAULT = 'https://open.bigmodel.cn/api/paas/v4'

export const LLM_DEFAULTS = Object.freeze({
  'ai.llm.overseas_openai_base_url': 'https://ai-aigw.semir.com/overseas-openai-vip/v1',
  'ai.llm.overseas_anthropic_base_url': 'https://ai-aigw.semir.com/overseas-anthropic-vip',
  'ai.llm.domestic_base_url': 'https://ai-aigw.semir.com/bailian-codingplan/v1',
  'ai.llm.deepseek_base_url': DEEPSEEK_OFFICIAL_BASE_URL_DEFAULT,
  'ai.llm.glm_base_url': GLM_OFFICIAL_BASE_URL_DEFAULT,
  'ai.llm.default_model': 'gemini-3.5-flash',
})

export const LLM_MODELS = Object.freeze([
  { value: 'deepseek-official-flash', label: 'DeepSeek 官方 · V4.1 Flash（多模态）' },
  { value: 'deepseek-official-v4-flash', label: 'DeepSeek 官方 · V4.1 Flash（旧 Flash 别名）' },
  { value: 'deepseek-official-v4-pro', label: 'DeepSeek 官方 · V4 Pro' },
  { value: 'deepseek-official-v4-flash-vision-exp', label: 'DeepSeek 官方 · V4.1 Flash（旧 Vision 别名）' },
  { value: 'glm-official-5.3-flash', label: 'GLM 官方 · GLM-5.3-Flash（主推）' },
  { value: 'glm-official-5.3', label: 'GLM 官方 · GLM-5.3' },
  { value: 'glm-official-5.2', label: 'GLM 官方 · GLM-5.2' },
  { value: 'gpt-6-astra', label: '海外 · GPT-6 Astra' },
  { value: 'gpt-5.6-sol', label: '海外 · GPT-5.6 Sol' },
  { value: 'gpt-5.6-terra', label: '海外 · GPT-5.6 Terra' },
  { value: 'gpt-5.6-luna', label: '海外 · GPT-5.6 Luna' },
  { value: 'gpt-5.5', label: '海外 · GPT-5.5' },
  { value: 'claude-opus-4-8', label: '海外 · Claude Opus 4.8' },
  { value: 'claude-sonnet-5', label: '海外 · Claude Sonnet 5' },
  { value: 'gemini-3.1-pro-preview', label: '海外 · Gemini 3.1 Pro Preview' },
  { value: 'gemini-3.5-flash', label: '海外 · Gemini 3.5 Flash（默认）' },
  { value: 'qwen3.8-max-preview', label: '国内 · Qwen 3.8 Max Preview' },
  { value: 'qwen3.7-plus', label: '国内 · Qwen 3.7 Plus' },
  { value: 'deepseek-v4.1-flash', label: '国内 · DeepSeek V4.1 Flash（网关）' },
  { value: 'deepseek-v4-flash', label: '国内 · DeepSeek V4 Flash（网关）' },
  { value: 'deepseek-v4-pro', label: '国内 · DeepSeek V4 Pro（网关）' },
  { value: 'glm-5.2', label: '国内 · GLM 5.2' },
  { value: 'kimi-k3', label: '国内 · Kimi K3' },
  { value: 'kimi-k2.7-code', label: '国内 · Kimi K2.7 Code' },
])

export const DEEPSEEK_OFFICIAL_MODELS_UI = Object.freeze([
  { value: 'deepseek-official-flash', label: 'DeepSeek 官方 · V4.1 Flash（多模态）' },
  { value: 'deepseek-official-v4-flash', label: 'DeepSeek 官方 · V4.1 Flash（旧 Flash 别名）' },
  { value: 'deepseek-official-v4-pro', label: 'DeepSeek 官方 · V4 Pro' },
  { value: 'deepseek-official-v4-flash-vision-exp', label: 'DeepSeek 官方 · V4.1 Flash（旧 Vision 别名）' },
])

export const GLM_OFFICIAL_MODELS_UI = Object.freeze([
  { value: 'glm-5.3-flash', label: 'GLM-5.3-Flash', type: '对话' },
  { value: 'glm-5.3', label: 'GLM-5.3', type: '对话' },
  { value: 'glm-5.2', label: 'GLM-5.2', type: '对话' },
  { value: 'glm-ocr', label: 'GLM-OCR', type: 'OCR' },
  { value: 'glm-image', label: 'GLM-Image', type: '生图' },
  { value: 'glm-tts', label: 'GLM-TTS', type: '语音' },
  { value: 'glm-asr-2512', label: 'GLM-ASR-2512', type: '语音' },
  { value: 'cogvideox-3', label: 'CogVideoX-3', type: '视频' },
  { value: 'embedding-3', label: 'Embedding-3', type: '向量' },
])

export const LLM_PANEL_FIELDS = Object.freeze([
  LLM_API_KEY_FIELD,
  DEEPSEEK_API_KEY_FIELD,
  GLM_API_KEY_FIELD,
  ...Object.keys(LLM_DEFAULTS),
])

export function isLlmConfigured(cfg = {}) {
  if (typeof cfg?.['ai.llm.configured'] === 'boolean') return cfg['ai.llm.configured']
  const value = String(cfg?.[LLM_API_KEY_FIELD] ?? '').trim()
  return Boolean(value && !value.includes(LLM_MASKED_CREDENTIAL_VALUE))
}

export function isDeepSeekConfigured(cfg = {}) {
  if (typeof cfg?.['ai.llm.deepseek_configured'] === 'boolean') return cfg['ai.llm.deepseek_configured']
  const value = String(cfg?.[DEEPSEEK_API_KEY_FIELD] ?? '').trim()
  return Boolean(value && !value.includes(LLM_MASKED_CREDENTIAL_VALUE))
}

export function isGlmConfigured(cfg = {}) {
  if (typeof cfg?.['ai.llm.glm_configured'] === 'boolean') return cfg['ai.llm.glm_configured']
  const value = String(cfg?.[GLM_API_KEY_FIELD] ?? '').trim()
  return Boolean(value && !value.includes(LLM_MASKED_CREDENTIAL_VALUE))
}

export function buildLlmSettingsPatch(cfg = {}) {
  return LLM_PANEL_FIELDS.reduce((patch, key) => {
    const value = String(cfg?.[key] ?? '').trim()
    if (!value) return patch
    if ([LLM_API_KEY_FIELD, DEEPSEEK_API_KEY_FIELD, GLM_API_KEY_FIELD].includes(key) && value.includes(LLM_MASKED_CREDENTIAL_VALUE)) return patch
    patch[key] = value
    return patch
  }, {})
}

export function clearWrittenLlmSettings(cfg = {}, patch = {}) {
  if (Object.prototype.hasOwnProperty.call(patch, LLM_API_KEY_FIELD)) {
    cfg[LLM_API_KEY_FIELD] = LLM_MASKED_CREDENTIAL_VALUE
    cfg['ai.llm.configured'] = true
  }
  if (Object.prototype.hasOwnProperty.call(patch, DEEPSEEK_API_KEY_FIELD)) {
    cfg[DEEPSEEK_API_KEY_FIELD] = LLM_MASKED_CREDENTIAL_VALUE
    cfg['ai.llm.deepseek_configured'] = true
  }
  if (Object.prototype.hasOwnProperty.call(patch, GLM_API_KEY_FIELD)) {
    cfg[GLM_API_KEY_FIELD] = LLM_MASKED_CREDENTIAL_VALUE
    cfg['ai.llm.glm_configured'] = true
  }
  return cfg
}
