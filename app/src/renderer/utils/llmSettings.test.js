import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEEPSEEK_API_KEY_FIELD,
  DEEPSEEK_OFFICIAL_MODELS_UI,
  LLM_API_KEY_FIELD,
  LLM_DEFAULTS,
  LLM_MASKED_CREDENTIAL_VALUE,
  LLM_MODELS,
  buildLlmSettingsPatch,
  clearWrittenLlmSettings,
  isDeepSeekConfigured,
  isLlmConfigured,
} from './llmSettings.mjs'

test('LLM settings expose all configured gateway defaults and supported model ids', () => {
  assert.equal(LLM_DEFAULTS['ai.llm.default_model'], 'gemini-3.5-flash')
  assert.equal(LLM_DEFAULTS['ai.llm.deepseek_base_url'], 'https://api.deepseek.com')
  assert.equal(LLM_MODELS.length, 17)
  assert.deepEqual(
    LLM_MODELS.map(item => item.value),
    [
      'deepseek-official-v4-flash',
      'deepseek-official-v4-pro',
      'deepseek-official-v4-flash-vision-exp',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'claude-opus-4-8',
      'claude-sonnet-5',
      'gemini-3.1-pro-preview',
      'gemini-3.5-flash',
      'qwen3.8-max-preview',
      'qwen3.7-plus',
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'glm-5.2',
      'kimi-k2.7-code',
    ],
  )
  assert.deepEqual(DEEPSEEK_OFFICIAL_MODELS_UI.map(item => item.value), [
    'deepseek-official-v4-flash',
    'deepseek-official-v4-pro',
    'deepseek-official-v4-flash-vision-exp',
  ])
})

test('masked or blank LLM credentials are never posted back to settings', () => {
  assert.deepEqual(buildLlmSettingsPatch({
    [LLM_API_KEY_FIELD]: LLM_MASKED_CREDENTIAL_VALUE,
    [DEEPSEEK_API_KEY_FIELD]: LLM_MASKED_CREDENTIAL_VALUE,
    'ai.llm.overseas_openai_base_url': LLM_DEFAULTS['ai.llm.overseas_openai_base_url'],
    'ai.llm.overseas_anthropic_base_url': '',
    'ai.llm.default_model': 'claude-sonnet-5',
  }), {
    'ai.llm.overseas_openai_base_url': LLM_DEFAULTS['ai.llm.overseas_openai_base_url'],
    'ai.llm.default_model': 'claude-sonnet-5',
  })
})

test('DeepSeek official key is posted as its own field and cleared after write', () => {
  assert.deepEqual(buildLlmSettingsPatch({
    [DEEPSEEK_API_KEY_FIELD]: 'sk-deepseek-unit',
    'ai.llm.deepseek_base_url': 'https://api.deepseek.com',
    'ai.llm.default_model': 'deepseek-official-v4-flash',
  }), {
    [DEEPSEEK_API_KEY_FIELD]: 'sk-deepseek-unit',
    'ai.llm.deepseek_base_url': 'https://api.deepseek.com',
    'ai.llm.default_model': 'deepseek-official-v4-flash',
  })
  const cfg = { [DEEPSEEK_API_KEY_FIELD]: 'sk-deepseek-unit' }
  clearWrittenLlmSettings(cfg, { [DEEPSEEK_API_KEY_FIELD]: 'sk-deepseek-unit' })
  assert.equal(cfg[DEEPSEEK_API_KEY_FIELD], LLM_MASKED_CREDENTIAL_VALUE)
  assert.equal(cfg['ai.llm.deepseek_configured'], true)
  assert.equal(isDeepSeekConfigured(cfg), true)
})

test('DeepSeek official configured badge uses backend boolean without receiving the key', () => {
  assert.equal(isDeepSeekConfigured({ 'ai.llm.deepseek_configured': true }), true)
  assert.equal(isDeepSeekConfigured({ 'ai.llm.deepseek_configured': false }), false)
  assert.equal(isDeepSeekConfigured({ [DEEPSEEK_API_KEY_FIELD]: 'sk-deepseek-unit' }), true)
  assert.equal(isDeepSeekConfigured({ [DEEPSEEK_API_KEY_FIELD]: LLM_MASKED_CREDENTIAL_VALUE }), false)
})

test('successful LLM key writes are cleared from renderer memory', () => {
  const cfg = {
    [LLM_API_KEY_FIELD]: 'unit-secret',
    'ai.llm.configured': false,
  }
  clearWrittenLlmSettings(cfg, { [LLM_API_KEY_FIELD]: 'unit-secret' })
  assert.equal(cfg[LLM_API_KEY_FIELD], LLM_MASKED_CREDENTIAL_VALUE)
  assert.equal(cfg['ai.llm.configured'], true)
  assert.equal(isLlmConfigured(cfg), true)
})
