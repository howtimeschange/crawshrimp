<template>
  <div class="llm-settings">
    <div class="llm-toolbar"><p>每个供应商独立配置 Key 和连接地址。已有森马共享 Key 会继续供三条森马网关使用。</p><button class="btn-orange" :disabled="busy" @click="edit()">添加供应商</button></div>
    <div class="llm-default"><label>默认模型</label><SearchCombobox :model-value="settings['ai.llm.default_model'] || LLM_DEFAULTS['ai.llm.default_model']" :options="modelOptions" :disabled="busy" label="默认文本模型" @update:model-value="setDefault" /></div>
    <p v-if="message" :class="['llm-message', { error }]" role="status">{{ message }}</p>
    <div class="llm-provider-list" aria-label="文本模型供应商列表">
      <article v-for="provider in rows" :key="provider.id" class="llm-provider-row">
        <div class="llm-brand" :class="provider.brand"><img v-if="logos[provider.brand]" :src="logos[provider.brand]" alt="" /><span v-else>{{ provider.brand === 'glm' ? 'GLM' : 'AI' }}</span></div>
        <div class="llm-provider-main"><div class="llm-title"><strong>{{ provider.name }}</strong><span class="llm-badge" :class="{ configured: provider.configured }">{{ provider.configured ? '已配 Key' : '未配 Key' }}</span><span class="llm-badge">{{ provider.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI' }} 兼容</span><span v-if="provider.custom" class="llm-badge">自定义</span><span v-if="provider.isDefault" class="llm-badge configured">默认</span></div><p class="llm-url" :title="provider.base_url">{{ provider.base_url }}</p><div class="llm-models"><span v-for="model in provider.models.slice(0, 3)" :key="model.value" :title="model.value">{{ provider.custom ? model.label : model.value }}</span><span v-if="provider.models.length > 3">+{{ provider.models.length - 3 }}</span></div></div>
        <div class="llm-actions"><small>{{ provider.models.length }} 个模型</small><div><button v-if="!provider.isDefault && provider.models.length" class="btn-ghost" :disabled="busy" @click="setDefault(provider.models[0].value)">设为默认</button><button class="btn-ghost" :disabled="busy" :aria-label="`编辑 ${provider.name}`" @click="edit(provider)">编辑</button></div></div>
      </article>
    </div>
    <dialog ref="modal" class="llm-modal" aria-labelledby="llm-modal-title" @cancel="cancel" @click="backdrop">
      <form @submit.prevent="save">
        <header><div><small>文本模型供应商</small><h3 id="llm-modal-title">{{ draft.name || '添加供应商' }}</h3></div><button type="button" class="btn-ghost" :disabled="busy" @click="close">关闭</button></header>
        <div class="llm-form">
          <label>供应商名称<input v-model="draft.name" :readonly="!draft.custom" :disabled="busy" required /></label>
          <label>兼容协议<select v-model="draft.protocol" :disabled="busy || !draft.custom"><option value="openai">OpenAI 兼容</option><option value="anthropic">Anthropic 兼容</option></select></label>
          <label class="wide">Base URL<input v-model="draft.base_url" :disabled="busy" type="url" required placeholder="https://api.example.com/v1" /></label>
          <label class="wide">API Key<input v-model="draft.api_key" :disabled="busy" type="password" autocomplete="new-password" :placeholder="draft.configured ? '已配置；留空保留原 Key' : '输入 API Key'" /><small>Key 保存后不会读回页面。留空保持现有配置。</small></label>
          <label v-if="draft.custom" class="wide">模型 ID<textarea v-model="draft.modelsText" :disabled="busy" rows="5" placeholder="每行一个模型 ID" required /><small>按供应商区分同名模型，调用时使用原始模型 ID。</small></label>
          <div v-else class="wide"><label>支持模型</label><div class="llm-models expanded"><span v-for="model in draft.models" :key="model.value">{{ model.value }}</span></div></div>
        </div>
        <p v-if="modalError" class="llm-message error" role="alert">{{ modalError }}</p>
        <footer><button v-if="draft.custom && draft.existing" type="button" class="btn-ghost llm-delete" :disabled="busy" @click="remove">{{ deleting ? '确认移除供应商' : '移除供应商' }}</button><span /><button type="button" class="btn-ghost" :disabled="busy" @click="close">取消</button><StatefulButton class="btn-orange" type="submit" :state="busy ? 'pending' : 'idle'" pending-label="保存中…">保存供应商</StatefulButton></footer>
      </form>
    </dialog>
  </div>
</template>
<script setup>
import { computed, reactive, ref } from 'vue'
import SearchCombobox from './interaction/SearchCombobox.vue'
import StatefulButton from './interaction/StatefulButton.vue'
import { LLM_DEFAULTS } from '../utils/llmSettings.mjs'
import { CUSTOM_LLM_FIELD, providerRows, buildProviderPatch } from '../utils/llmProviders.mjs'
import deepseekLogo from '../assets/llm-providers/deepseek-logo.png'
import semirLogo from '../assets/llm-providers/semir-logo.png'
const props = defineProps({ settings: { type: Object, required: true }, onSave: { type: Function, required: true } })
const logos = { deepseek: deepseekLogo, semir: semirLogo }
const rows = computed(() => providerRows(props.settings))
const modelOptions = computed(() => rows.value.flatMap(provider => provider.models.map(model => ({ ...model, group: provider.name }))))
const modal = ref(null), busy = ref(false), message = ref(''), error = ref(false), modalError = ref(''), deleting = ref(false)
const draft = reactive({ name: '', custom: true, protocol: 'openai', base_url: '', api_key: '', modelsText: '', models: [] })
let opener
function edit(provider) {
  opener = document.activeElement
  modalError.value = ''; deleting.value = false
  Object.assign(draft, provider || { id: `custom-${crypto.randomUUID()}`, name: '', protocol: 'openai', base_url: '', custom: true, configured: false, models: [] }, { api_key: '', existing: Boolean(provider), modelsText: provider?.models.map(model => provider.custom ? model.label : model.value).join('\n') || '' })
  modal.value.showModal()
}
function close() { if (busy.value) return; modal.value.close(); draft.api_key = ''; opener?.focus() }
function cancel(event) { event.preventDefault(); close() }
function backdrop(event) { if (event.target !== modal.value) return; const rect = modal.value.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close() }
async function persist(patch, text) {
  if (busy.value) return false
  busy.value = true; message.value = ''; error.value = false
  try { const result = await props.onSave(patch); if (result?.error || result?.ok === false) throw new Error(result.error || '保存失败'); message.value = text; return true }
  catch (e) { error.value = true; message.value = e.message || '保存失败'; modalError.value = message.value; return false }
  finally { busy.value = false }
}
async function setDefault(model) { await persist({ 'ai.llm.default_model': model }, '默认模型已保存') }
async function save() {
  if (busy.value) return
  modalError.value = ''
  let patch
  try { patch = buildProviderPatch(props.settings, draft) } catch (e) { modalError.value = e.message; return }
  if (await persist(patch, '供应商已保存')) close()
}
async function remove() {
  if (!deleting.value) { deleting.value = true; return }
  const providers = (props.settings[CUSTOM_LLM_FIELD] || []).filter(provider => provider.id !== draft.id)
  const patch = { [CUSTOM_LLM_FIELD]: providers }
  if (String(props.settings['ai.llm.default_model'] || '').startsWith(`${draft.id}/`)) patch['ai.llm.default_model'] = LLM_DEFAULTS['ai.llm.default_model']
  if (await persist(patch, '供应商已移除')) close()
}
</script>
<style scoped>
.btn-orange,.btn-ghost { min-height: 34px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 7px; font: inherit; font-size: 12px; cursor: pointer; }.btn-orange { background: var(--orange); border-color: var(--orange); color: var(--on-orange); font-weight: 600; }.btn-ghost { background: var(--bg3); color: var(--text); }.btn-ghost:hover:not(:disabled) { border-color: var(--border-strong); }.btn-orange:hover:not(:disabled) { background: var(--orange-hover); }.btn-orange:disabled,.btn-ghost:disabled { opacity: .6; cursor: default; }.btn-orange:focus-visible,.btn-ghost:focus-visible { outline: 2px solid var(--orange); outline-offset: 2px; }
.llm-settings { display: grid; gap: 16px; min-width: 0; }
.llm-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 14px; background: var(--bg3); border: 1px solid var(--border); border-radius: 8px; }
.llm-toolbar p,.llm-url,.llm-actions small,.llm-modal small { color: var(--text2); font-size: 12px; line-height: 1.6; margin: 0; }
.llm-toolbar button { flex-shrink: 0; }
.llm-default { display: grid; grid-template-columns: 72px minmax(0, 440px); gap: 12px; align-items: center; font-size: 12px; color: var(--text2); }
.llm-provider-list { display: grid; gap: 12px; }.llm-provider-row { display: flex; align-items: center; gap: 16px; padding: 18px; background: var(--bg3); border: 1px solid var(--border); border-radius: 10px; min-width: 0; }
.llm-brand { width: 96px; height: 44px; flex-shrink: 0; display: grid; place-items: center; border-radius: 7px; background: var(--bg2); font-size: 16px; font-weight: 700; overflow: hidden; }.llm-brand img { width: 100%; height: 100%; object-fit: contain; }.llm-brand.glm { background: #123e3a; color: #b5f4e0; }
.llm-provider-main { min-width: 0; flex: 1; }.llm-title { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }.llm-title strong { font-size: 14px; margin-right: 3px; }
.llm-badge { border-radius: 5px; padding: 3px 5px; font-size: 11px; color: var(--text2); background: var(--bg4); }.llm-badge.configured { color: var(--green); background: color-mix(in srgb,var(--green) 10%,transparent); }
.llm-url { margin: 8px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.llm-models { display: flex; flex-wrap: wrap; gap: 5px; }.llm-models span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 11px ui-monospace,monospace; color: var(--text2); background: var(--bg2); padding: 4px 8px; border-radius: 20px; }.expanded { margin-top: 8px; }.expanded span { white-space: normal; overflow-wrap: anywhere; }
.llm-actions { display: grid; gap: 8px; justify-items: end; flex-shrink: 0; }.llm-actions > div { display: flex; gap: 7px; }.llm-actions button { padding: 6px 9px; font-size: 12px; }
.llm-message { margin: 0; color: var(--green); font-size: 12px; }.llm-message.error,.llm-delete { color: var(--red); }
.llm-modal { margin: auto; width: min(620px, calc(100vw - 32px)); max-height: calc(100vh - 40px); padding: 22px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg2); color: var(--text); overflow: auto; box-shadow: var(--shadow-soft); }.llm-modal::backdrop { background: var(--scrim); }.llm-modal header { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 20px; }.llm-modal h3 { margin: 4px 0 0; font-size: 18px; }.llm-form { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }.llm-form label { display: grid; gap: 7px; font-size: 12px; }.wide { grid-column: 1 / -1; }.llm-form input,.llm-form select,.llm-form textarea { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); font: inherit; }.llm-form input:focus,.llm-form textarea:focus { outline: 2px solid var(--orange); outline-offset: 1px; }.llm-form input[readonly] { color: var(--text2); }.llm-modal footer { display: flex; align-items: center; gap: 8px; margin-top: 22px; }.llm-modal footer > span { flex: 1; }
@media(max-width:1100px) { .llm-provider-row { flex-wrap: wrap; }.llm-actions { width: 100%; display: flex; align-items: center; justify-content: flex-end; }.llm-actions small { margin-right: auto; }.llm-brand { width: 70px; }.llm-toolbar { flex-wrap: wrap; } }
@media(max-width:600px) { .llm-form { grid-template-columns: 1fr; }.llm-brand { display: none; }.llm-default { grid-template-columns: 1fr; } }
</style>
