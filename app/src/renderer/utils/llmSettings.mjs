export const LLM_MASKED_CREDENTIAL_VALUE = '••••••••••••••••••••••••••••••••'

export const LLM_API_KEY_FIELD = 'ai.llm.api_key'

export const LLM_DEFAULTS = Object.freeze({
  'ai.llm.overseas_openai_base_url': 'https://ai-aigw.semir.com/overseas-openai-vip/v1',
  'ai.llm.overseas_anthropic_base_url': 'https://ai-aigw.semir.com/overseas-anthropic-vip',
  'ai.llm.domestic_base_url': 'https://ai-aigw.semir.com/bailian-codingplan/v1',
  'ai.llm.default_model': 'gpt-5.6-terra',
})

export const LLM_MODELS = Object.freeze([
  { value: 'gpt-5.6-sol', label: '海外 · GPT-5.6 Sol' },
  { value: 'gpt-5.6-terra', label: '海外 · GPT-5.6 Terra' },
  { value: 'gpt-5.6-luna', label: '海外 · GPT-5.6 Luna' },
  { value: 'gpt-5.5', label: '海外 · GPT-5.5' },
  { value: 'claude-opus-4-8', label: '海外 · Claude Opus 4.8' },
  { value: 'claude-sonnet-5', label: '海外 · Claude Sonnet 5' },
  { value: 'gemini-3.1-pro-preview', label: '海外 · Gemini 3.1 Pro Preview' },
  { value: 'gemini-3.5-flash', label: '海外 · Gemini 3.5 Flash' },
  { value: 'qwen3.8-max-preview', label: '国内 · Qwen 3.8 Max Preview' },
  { value: 'qwen3.7-plus', label: '国内 · Qwen 3.7 Plus' },
  { value: 'deepseek-v4-pro', label: '国内 · DeepSeek V4 Pro' },
  { value: 'glm-5.2', label: '国内 · GLM 5.2' },
  { value: 'kimi-k2.7-code', label: '国内 · Kimi K2.7 Code' },
])

export const LLM_PANEL_FIELDS = Object.freeze([
  LLM_API_KEY_FIELD,
  ...Object.keys(LLM_DEFAULTS),
])

export function isLlmConfigured(cfg = {}) {
  if (typeof cfg?.['ai.llm.configured'] === 'boolean') return cfg['ai.llm.configured']
  const value = String(cfg?.[LLM_API_KEY_FIELD] ?? '').trim()
  return Boolean(value && !value.includes(LLM_MASKED_CREDENTIAL_VALUE))
}

export function buildLlmSettingsPatch(cfg = {}) {
  return LLM_PANEL_FIELDS.reduce((patch, key) => {
    const value = String(cfg?.[key] ?? '').trim()
    if (!value) return patch
    if (key === LLM_API_KEY_FIELD && value.includes(LLM_MASKED_CREDENTIAL_VALUE)) return patch
    patch[key] = value
    return patch
  }, {})
}

export function clearWrittenLlmSettings(cfg = {}, patch = {}) {
  if (Object.prototype.hasOwnProperty.call(patch, LLM_API_KEY_FIELD)) {
    cfg[LLM_API_KEY_FIELD] = LLM_MASKED_CREDENTIAL_VALUE
    cfg['ai.llm.configured'] = true
  }
  return cfg
}
