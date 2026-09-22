import test from 'node:test'
import assert from 'node:assert/strict'
import { providerRows, buildProviderPatch, CUSTOM_LLM_FIELD } from './llmProviders.mjs'
import { LLM_MASKED_CREDENTIAL_VALUE } from './llmSettings.mjs'
test('builtin rows preserve supported models, per-route status and default', () => {
  const rows = providerRows({ 'ai.llm.default_model': 'claude-sonnet-5', 'ai.llm.overseas_anthropic_configured': true })
  assert.equal(rows.length, 5)
  assert.equal(rows.find(row => row.isDefault).id, 'overseas_anthropic')
  assert.equal(rows.find(row => row.id === 'overseas_anthropic').configured, true)
  assert.equal(rows.find(row => row.id === 'overseas_openai').configured, false)
  assert.equal(rows.flatMap(row => row.models).length, 29)
})
test('blank and masked edits preserve write-only keys', () => {
  for (const api_key of ['', LLM_MASKED_CREDENTIAL_VALUE]) assert.deepEqual(buildProviderPatch({}, { id: 'domestic', name: '森马', base_url: 'https://example.com/v1', api_key, custom: false }), { 'ai.llm.domestic_base_url': 'https://example.com/v1' })
})
test('same model IDs on different providers stay distinct and edits preserve capabilities', () => {
  const settings = { [CUSTOM_LLM_FIELD]: [{id:'a',name:'A',protocol:'openai',models:[{id:'model',supports_tools:false}],configured:true},{id:'b',name:'B',models:[{id:'model'}]}] }
  const rows = providerRows(settings).filter(row => row.custom)
  assert.deepEqual(rows.map(row => row.models[0].value), ['a/model','b/model'])
  const patch = buildProviderPatch(settings, { id:'a',name:'A edited',base_url:'https://example.com/v1',protocol:'openai',custom:true,modelsText:'model\nmodel\nnew',api_key:'' })
  const edited = patch[CUSTOM_LLM_FIELD].find(row => row.id === 'a')
  assert.equal(edited.models.length, 2)
  assert.equal(edited.models[0].supports_tools, false)
  assert.equal('api_key' in edited, false)
})
test('removing selected custom model moves default to a remaining model', () => {
  const patch = buildProviderPatch({'ai.llm.default_model':'a/old'}, {id:'a',name:'A',base_url:'https://example.com',custom:true,protocol:'openai',modelsText:'new'})
  assert.equal(patch['ai.llm.default_model'], 'a/new')
  assert.throws(() => buildProviderPatch({}, {name:'A',base_url:'https://user:secret@example.com',custom:true,modelsText:'x'}), /HTTP/)
})
