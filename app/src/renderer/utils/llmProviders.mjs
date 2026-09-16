import { LLM_MODELS, LLM_DEFAULTS, LLM_MASKED_CREDENTIAL_VALUE } from './llmSettings.mjs'
export const CUSTOM_LLM_FIELD = 'ai.llm.custom_providers'
const definitions = [
  ['deepseek', 'DeepSeek 官方', 'deepseek', 'openai', model => model.startsWith('deepseek-official-')],
  ['glm', '智谱官方', 'glm', 'openai', model => model.startsWith('glm-official-')],
  ['overseas_openai', '森马海外 OpenAI', 'semir', 'openai', model => /^(gpt-|gemini-)/.test(model)],
  ['overseas_anthropic', '森马海外 Anthropic', 'semir', 'anthropic', model => model.startsWith('claude-')],
  ['domestic', '森马国内 OpenAI', 'semir', 'openai', model => !/^(gpt-|gemini-|claude-|deepseek-official-|glm-official-)/.test(model)],
]
export const LLM_PROVIDERS = definitions.map(([id, name, brand, protocol, matches]) => ({
  id, name, brand, protocol, keyField: `ai.llm.${id}_api_key`, statusField: `ai.llm.${id}_configured`,
  baseField: `ai.llm.${id}_base_url`, models: LLM_MODELS.filter(model => matches(model.value)),
  legacy: brand === 'semir',
}))
export function providerConfigured(settings, provider) {
  if (typeof settings[provider.statusField] === 'boolean') return settings[provider.statusField]
  const key = String(settings[provider.keyField] || '').trim()
  return Boolean(key && key !== LLM_MASKED_CREDENTIAL_VALUE)
}
export function providerRows(settings = {}) {
  const selected = settings['ai.llm.default_model'] || LLM_DEFAULTS['ai.llm.default_model']
  const builtins = LLM_PROVIDERS.map(provider => ({ ...provider, base_url: settings[provider.baseField] || LLM_DEFAULTS[provider.baseField], configured: providerConfigured(settings, provider), custom: false }))
  const custom = (Array.isArray(settings[CUSTOM_LLM_FIELD]) ? settings[CUSTOM_LLM_FIELD] : []).map(provider => ({
    ...provider, custom: true, brand: 'custom', configured: Boolean(provider.configured),
    models: (provider.models || []).map(model => { const id = typeof model === 'string' ? model : model.id; return { value: `${provider.id}/${id}`, label: id } }),
  }))
  return [...builtins, ...custom].map(provider => ({ ...provider, isDefault: provider.models.some(model => model.value === selected) }))
}
export function parseProviderModels(text) {
  return [...new Set(String(text || '').split(/[\n,]+/).map(id => id.trim()).filter(Boolean))].map(id => ({ id }))
}
export function providerDraftError(draft) {
  if (!draft.name.trim()) return '请填写供应商名称'
  try { const url = new URL(draft.base_url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error() } catch { return '请输入有效的 HTTP(S) Base URL，不包含账号、查询参数或片段' }
  if (draft.custom && !parseProviderModels(draft.modelsText).length) return '请至少添加一个模型 ID'
  return ''
}
export function buildProviderPatch(settings, draft) {
  const error = providerDraftError(draft)
  if (error) throw new Error(error)
  const key = String(draft.api_key || '').trim()
  const keyPatch = key && !key.includes(LLM_MASKED_CREDENTIAL_VALUE) ? { api_key: key } : {}
  if (!draft.custom) {
    const provider = LLM_PROVIDERS.find(provider => provider.id === draft.id)
    if (!provider) throw new Error('供应商不存在')
    return { [provider.baseField]: draft.base_url.trim(), ...(keyPatch.api_key ? { [provider.keyField]: keyPatch.api_key } : {}) }
  }
  const previous = settings[CUSTOM_LLM_FIELD] || []
  const old = previous.find(provider => provider.id === draft.id)
  const oldModels = new Map((old?.models || []).map(model => [typeof model === 'string' ? model : model.id, model]))
  const provider = { id: draft.id, name: draft.name.trim(), protocol: draft.protocol, base_url: draft.base_url.trim(), models: parseProviderModels(draft.modelsText).map(model => oldModels.get(model.id) || model), ...keyPatch }
  const providers = previous.filter(item => item.id !== draft.id).map(({ api_key, apiKey, configured, ...item }) => item)
  providers.push(provider)
  const patch = { [CUSTOM_LLM_FIELD]: providers }
  const selected = settings['ai.llm.default_model'] || ''
  if (selected.startsWith(`${draft.id}/`) && !provider.models.some(model => `${draft.id}/${typeof model === 'string' ? model : model.id}` === selected)) patch['ai.llm.default_model'] = `${draft.id}/${provider.models[0].id || provider.models[0]}`
  return patch
}
