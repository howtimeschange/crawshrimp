import test from 'node:test'
import assert from 'node:assert/strict'

import {
  LLM_API_KEY_FIELD,
  LLM_DEFAULTS,
  LLM_MASKED_CREDENTIAL_VALUE,
  LLM_MODELS,
  buildLlmSettingsPatch,
  clearWrittenLlmSettings,
  isLlmConfigured,
} from './llmSettings.mjs'

test('LLM settings expose all configured gateway defaults and supported model ids', () => {
  assert.equal(LLM_DEFAULTS['ai.llm.default_model'], 'gpt-5.6-terra')
  assert.equal(LLM_MODELS.length, 13)
  assert.deepEqual(
    LLM_MODELS.map(item => item.value),
    [
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
      'deepseek-v4-pro',
      'glm-5.2',
      'kimi-k2.7-code',
    ],
  )
})

test('masked or blank LLM credentials are never posted back to settings', () => {
  assert.deepEqual(buildLlmSettingsPatch({
    [LLM_API_KEY_FIELD]: LLM_MASKED_CREDENTIAL_VALUE,
    'ai.llm.overseas_openai_base_url': LLM_DEFAULTS['ai.llm.overseas_openai_base_url'],
    'ai.llm.overseas_anthropic_base_url': '',
    'ai.llm.default_model': 'claude-sonnet-5',
  }), {
    'ai.llm.overseas_openai_base_url': LLM_DEFAULTS['ai.llm.overseas_openai_base_url'],
    'ai.llm.default_model': 'claude-sonnet-5',
  })
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
