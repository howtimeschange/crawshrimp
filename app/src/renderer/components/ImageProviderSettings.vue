<template>
  <div class="image-provider-settings">
    <div class="provider-toolbar">
      <p>按供应商管理连接与模型，配置后可在生图和工作流中选择。</p>
      <button class="primary" type="button" @click="openEditor()">＋ 添加自定义供应商</button>
    </div>
    <div class="provider-list" aria-label="图片模型供应商列表">
      <article v-for="provider in providers" :key="provider.id" class="provider-card">
        <div :class="['provider-logo', provider.id]">{{ provider.logo }}</div>
        <div class="provider-main">
          <div class="provider-heading">
            <h4>{{ provider.name }}</h4>
            <span :class="['status', provider.configured ? 'ready' : '']">{{ provider.configured ? '已配 Key' : '未配 Key' }}</span>
            <span class="tag">{{ provider.protocolLabel }}</span>
            <span v-if="provider.custom" class="tag">自定义</span>
          </div>
          <p class="endpoint">{{ provider.baseUrl || '尚未填写接口地址' }}</p>
          <div class="model-tags"><span v-for="model in provider.previewModels" :key="model">{{ model }}</span><span v-if="provider.more">+{{ provider.more }}</span></div>
        </div>
        <div class="provider-actions">
          <small>{{ provider.modelCount }} 个模型</small>
          <button type="button" :aria-label="`编辑${provider.name}`" @click="openEditor(provider)">编辑</button>
        </div>
      </article>
    </div>
    <p class="provider-footnote">密钥保存在本机。</p>
    <p v-if="savedMessage" class="saved-message" role="status">{{ savedMessage }}</p>

    <details class="connection-history" @toggle="loadHistory">
      <summary>最近使用配置与调用记录</summary>
      <p v-if="history.recent" class="help">最近使用：{{ history.recent.config_name }} · {{ history.recent.model }} · {{ history.recent.time }}</p>
      <div class="provider-heading"><select v-model="historyProvider" aria-label="调用记录供应商" @change="refreshHistory"><option value="">全部供应商</option><option v-for="provider in providers" :key="provider.id" :value="provider.id">{{ provider.name }}</option></select><button type="button" @click="refreshHistory">刷新记录</button></div>
      <p class="help">显示最近 100 条生成记录，包含工作台及任务服务记录；错误按类型脱敏，记录不包含密钥或提示词。</p>
      <p v-if="historyError" class="editor-error">{{ historyError }}</p>
      <div class="history-scroll"><table><thead><tr><th>时间 / 任务</th><th>配置 / 模型</th><th>结果</th><th>耗时 / 重试</th></tr></thead><tbody><tr v-for="row in history.items" :key="row.job_uid + row.run_uid"><td>{{ row.time }}<small>{{ '任务 ' + row.job_uid.slice(0, 8) }}</small></td><td>{{ row.config_name }}<small>{{ row.model }} · {{ row.config_version || '旧记录无配置版本' }}</small></td><td>{{ { completed: '成功', failed: '失败', running: '生成中', queued: '排队中' }[row.status] || row.status }}<small>{{ row.error }}</small></td><td>{{ row.elapsed_seconds == null ? '—' : row.elapsed_seconds + ' 秒' }}<small>重试 {{ row.retry_count }} 次</small></td></tr></tbody></table><p v-if="!history.items.length" class="help">暂无调用记录</p></div>
    </details>

    <Teleport to="body">
      <div v-if="editor.open" class="image-provider-backdrop" @click.self="closeEditor" @keydown.esc="closeEditor">
        <section ref="dialog" class="image-provider-dialog" role="dialog" aria-modal="true" aria-labelledby="image-provider-title" tabindex="-1" @keydown.tab="trapFocus">
          <header>
            <div><p>{{ editor.isNew ? '新增供应商' : '编辑供应商' }}</p><h3 id="image-provider-title">{{ draft.name || '自定义供应商' }}</h3></div>
            <button type="button" aria-label="关闭供应商编辑" :disabled="editor.saving" @click="closeEditor">×</button>
          </header>
          <form @submit.prevent="saveEditor">
            <div class="editor-body">
              <template v-if="draft.custom">
                <div class="editor-grid">
                  <label>供应商名称<input v-model="draft.name" required placeholder="例如：团队生图网关" /></label>
                  <label>接口协议<select v-model="draft.protocol"><option value="openai">OpenAI Images</option><option value="gemini">Gemini 原生</option><option value="one_xm">1XM 异步任务</option></select></label>
                </div>
                <label>Base URL<input v-model="draft.baseUrl" required type="url" :placeholder="draft.protocol === 'gemini' ? 'https://api.example.com/v1beta' : 'https://api.example.com/v1'" /></label>
                <label>API Key<input v-model="draft.apiKey" type="password" autocomplete="off" placeholder="填写供应商密钥" /></label>
                <label>模型 ID<textarea v-model="draft.modelsText" rows="4" required placeholder="每行一个模型 ID，例如 gpt-image-2" /></label>
                <p class="help">模型 ID 使用供应商的原始名称。保存后，各生图入口会显示“供应商 · 模型”。</p>
              </template>
              <template v-else>
                <div v-for="group in draft.groups" :key="group.title" class="connection-group">
                  <h4>{{ group.title }}</h4><p v-if="group.description" class="help">{{ group.description }}</p>
                  <label v-for="field in group.fields" :key="field.id">{{ field.label }}
                    <input v-model="draft.values[field.id]" :type="field.secret ? 'password' : 'url'" :placeholder="field.placeholder || ''" autocomplete="off" />
                  </label>
                </div>
                <div class="supported-models"><h4>可选模型</h4><div class="model-tags"><span v-for="model in draft.models" :key="model">{{ model }}</span></div></div>
              </template>
              <p v-if="editor.error" class="editor-error" role="alert">{{ editor.error }}</p>
            </div>
            <footer>
              <button v-if="draft.custom && !editor.isNew" type="button" class="danger" :disabled="editor.saving" @click="removeProvider">移除供应商</button>
              <span class="spacer" />
              <button type="button" :disabled="editor.saving" @click="closeEditor">取消</button>
              <button class="primary" type="submit" :disabled="editor.saving">{{ editor.saving ? '保存中…' : '保存供应商' }}</button>
            </footer>
          </form>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, reactive, ref, onMounted } from 'vue'
import { AI_IMAGE_MODELS, CUSTOM_IMAGE_PROVIDERS_FIELD, customImageProviders } from '../utils/aiImageModels.js'
const props = defineProps({ config: { type: Object, required: true }, save: { type: Function, required: true } })
const builtin = [
  { id: '1xm', name: '1XM', logo: '1XM', protocolLabel: '异步任务', groups: [
    { title: '连接', fields: [{ id: 'ai.1xm.base_url', label: 'Base URL' }] },
    { title: 'GPT Image 2', description: '1XM 按分辨率使用不同密钥。', fields: [{ id: 'ai.1xm.gpt_image_2k_key', label: '2K API Key', secret: true }, { id: 'ai.1xm.gpt_image_4k_key', label: '4K API Key', secret: true }] },
    { title: 'Nano Banana', fields: [{ id: 'ai.1xm.gemini_3_1_flash_image_preview_key', label: 'Nano Banana 2 API Key', secret: true }, { id: 'ai.1xm.gemini_3_pro_image_preview_key', label: 'Nano Banana Pro API Key', secret: true }] },
  ] },
  { id: 'woka', name: '沃卡', logo: 'WOKA', protocolLabel: 'OpenAI / Gemini', groups: [
    { title: '身份验证', description: 'GPT Image 与 Nano Banana 共用此密钥。', fields: [{ id: 'ai.woka.api_key', label: 'API Key', secret: true }] },
    { title: '接口地址', fields: [{ id: 'ai.woka.base_url', label: 'GPT Image · OpenAI Base URL' }, { id: 'ai.woka.gemini_base_url', label: 'Nano Banana · Gemini Base URL' }] },
  ] },
  { id: 'semir', name: '森马网关', logo: 'Semir', protocolLabel: 'OpenAI / Gemini', groups: [
    { title: 'GPT Image', fields: [{ id: 'ai.semir.base_url', label: 'OpenAI Base URL' }, { id: 'ai.semir.gpt_api_key', label: 'GPT API Key', secret: true }] },
    { title: 'Nano Banana', fields: [{ id: 'ai.semir.gemini_base_url', label: 'Gemini Base URL' }, { id: 'ai.semir.gemini_api_key', label: 'Google API Key', secret: true }] },
  ] },
]
const providers = computed(() => [
  ...builtin.map(item => {
    const models = AI_IMAGE_MODELS.filter(model => (model.provider || '1xm') === item.id)
    return { ...item, baseUrl: props.config[`ai.${item.id}.base_url`], configured: item.groups.some(group => group.fields.some(field => field.secret && props.config[field.id])), previewModels: item.id === '1xm' ? ['GPT Image 2 · 2K / 4K', 'Nano Banana 2', 'Nano Banana Pro'] : ['GPT Image 2', 'Nano Banana 2', 'Nano Banana Pro'], modelCount: models.length, models: models.map(model => model.label.replace(/^.* · /, '')) }
  }),
  ...customImageProviders(props.config).map(item => ({ ...item, custom: true, logo: item.name?.slice(0, 2).toUpperCase() || 'API', baseUrl: item.base_url, protocolLabel: { openai: 'OpenAI Images', gemini: 'Gemini 原生', one_xm: '异步任务' }[item.protocol], configured: Boolean(item.api_key), previewModels: (item.models || []).slice(0, 3), modelCount: item.models?.length || 0, more: Math.max(0, (item.models?.length || 0) - 3) })),
])
const editor = reactive({ open: false, isNew: false, saving: false, error: '' })
const draft = reactive({ id: '', name: '', custom: false, protocol: 'openai', baseUrl: '', apiKey: '', modelsText: '', groups: [], models: [], values: {} })
const dialog = ref(null)
const savedMessage = ref('')
const history = reactive({ items: [], recent: null })
const historyProvider = ref('')
const historyError = ref('')
async function refreshHistory() {
  try { Object.assign(history, await window.cs.imageCallHistory(historyProvider.value)); historyError.value = '' }
  catch { historyError.value = '调用记录暂时不可用，请重启抓虾客户端后刷新。' }
}
function loadHistory(event) { if (event.target.open) void refreshHistory() }
onMounted(refreshHistory)
let restoreFocus = null
async function openEditor(provider) {
  restoreFocus = document.activeElement
  editor.isNew = !provider
  editor.error = ''
  Object.assign(draft, { id: provider?.id || `custom-${crypto.randomUUID()}`, name: provider?.name || '', custom: !provider || Boolean(provider.custom), protocol: provider?.protocol || 'openai', baseUrl: provider?.baseUrl || '', apiKey: provider?.api_key || '', modelsText: (provider?.models || []).join('\n'), groups: provider?.groups || [], models: provider?.models || [], values: { ...props.config } })
  editor.open = true
  await nextTick()
  dialog.value?.focus()
}
function closeEditor() { if (editor.saving) return; editor.open = false; restoreFocus?.focus() }
function trapFocus(event) {
  const elements = [...dialog.value.querySelectorAll('button:not(:disabled), input, select, textarea')]
  const first = elements[0], last = elements.at(-1)
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
function validUrl(value) { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash } catch { return false } }
async function commit(patch, message) {
  editor.saving = true; editor.error = ''
  try { await props.save(patch); savedMessage.value = message; editor.saving = false; closeEditor() }
  catch (error) { editor.error = error?.message || '保存失败' }
  finally { editor.saving = false }
}
async function saveEditor() {
  const patch = {}
  if (draft.custom) {
    const models = [...new Set(draft.modelsText.split(/[\n,，]+/).map(value => value.trim()).filter(Boolean))]
    if (!draft.name.trim() || !validUrl(draft.baseUrl) || !models.length) { editor.error = '请填写供应商名称、有效接口地址和至少一个模型 ID。'; return }
    if (models.some(model => /\s/.test(model))) { editor.error = '模型 ID 不能包含空格。'; return }
    const next = { id: draft.id, name: draft.name.trim(), protocol: draft.protocol, base_url: draft.baseUrl.trim().replace(/\/$/, ''), api_key: draft.apiKey.trim(), models }
    patch[CUSTOM_IMAGE_PROVIDERS_FIELD] = [...customImageProviders(props.config).filter(item => item.id !== draft.id), next]
  } else {
    for (const group of draft.groups) for (const field of group.fields) {
      const value = String(draft.values[field.id] || '').trim()
      if (!field.secret && !validUrl(value)) { editor.error = '请填写有效的接口地址。'; return }
      patch[field.id] = value
    }
  }
  await commit(patch, `${draft.name} 已保存`)
}
async function removeProvider() {
  await commit({ [CUSTOM_IMAGE_PROVIDERS_FIELD]: customImageProviders(props.config).filter(item => item.id !== draft.id) }, '自定义供应商已移除')
}
</script>

<style scoped>
.connection-history { padding: 18px; display: grid; gap: 14px; border: 1px solid var(--border); border-radius: 10px; }
.connection-history summary { cursor: pointer; font-weight: 600; }
.history-scroll { overflow: auto; max-height: 420px; }
table { border-collapse: collapse; width: 100%; font-size: 12px; } th, td { text-align: left; padding: 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
td small { display: block; color: var(--text3); margin-top: 4px; overflow-wrap: anywhere; }

.image-provider-settings { display: grid; gap: 16px; }
.provider-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 16px; border: 1px solid var(--border, #34343e); border-radius: 10px; background: var(--bg3, #25252d); }
.provider-toolbar p, .provider-footnote { margin: 0; color: var(--text3, #9292a6); font-size: 13px; line-height: 1.6; }
button { cursor: pointer; border: 1px solid var(--border, #3b3b47); border-radius: 7px; background: transparent; color: var(--text, #ededf3); padding: 8px 13px; font: inherit; font-size: 13px; white-space: nowrap; }
button:hover { background: var(--bg3, #30303b); }
button.primary { background: #ff7026; color: #191411; border-color: #ff7026; font-weight: 600; }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid #ff8d56; outline-offset: 3px; }
.provider-list { display: grid; gap: 12px; }
.provider-card { display: flex; align-items: flex-start; gap: 16px; padding: 20px; border: 1px solid var(--border, #34343e); border-radius: 11px; background: var(--bg3, #252531); }
.provider-logo { display: grid; place-items: center; flex: 0 0 90px; height: 46px; border-radius: 8px; background: #32323d; color: #fff; font-weight: 750; font-size: 19px; letter-spacing: -.6px; }
.provider-logo.woka { background: #583f91; }.provider-logo.semir { background: #008e50; }.provider-logo.\31 xm { background: #355da9; }
.provider-main { flex: 1; min-width: 0; }
.provider-heading { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
h4 { margin: 0; color: var(--text, #ededf3); font-size: 15px; }
.status, .tag { font-size: 11px; line-height: 1.5; border-radius: 5px; padding: 2px 6px; background: #85859519; color: var(--text3, #a5a5b7); }
.status.ready { background: #3eba8020; color: #4fce95; }
.endpoint { margin: 8px 0; font-size: 12px; color: var(--text3, #9292a6); overflow-wrap: anywhere; }
.model-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.model-tags span { border-radius: 5px; padding: 3px 8px; background: #85859513; color: var(--text3, #aaaabb); font-size: 11px; }
.provider-actions { display: grid; gap: 10px; justify-items: end; flex-shrink: 0; }
.provider-actions small { font-size: 11px; color: var(--text3, #9292a6); }
.saved-message { color: #4fce95; font-size: 13px; margin: 0; }
.image-provider-backdrop { position: fixed; inset: 0; z-index: 2000; display: flex; justify-content: center; align-items: center; padding: 24px; background: #0009; }
.image-provider-dialog { width: 620px; max-width: 100%; max-height: calc(100vh - 48px); overflow: auto; background: var(--bg2, #1e1e27); border: 1px solid var(--border, #3b3b47); border-radius: 14px; box-shadow: 0 24px 80px #0006; color: var(--text, #ededf3); }
.image-provider-dialog header { padding: 22px 24px 18px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border, #34343e); }
.image-provider-dialog header p { font-size: 11px; color: #ff925c; margin: 0 0 7px; }.image-provider-dialog h3 { margin: 0; font-size: 20px; }
.editor-body { padding: 22px 24px; display: grid; gap: 20px; }
.connection-group { display: grid; gap: 14px; }.connection-group + .connection-group, .supported-models { border-top: 1px solid var(--border, #34343e); padding-top: 18px; }
.supported-models h4 { margin-bottom: 10px; }
label { display: grid; gap: 8px; color: var(--text3, #b5b5c4); font-size: 12px; }
input, select, textarea { box-sizing: border-box; width: 100%; min-width: 0; border-radius: 7px; border: 1px solid var(--border, #3b3b47); background: var(--bg, #14141c); color: var(--text, #ededf3); font: inherit; font-size: 13px; padding: 11px 12px; }
textarea { resize: vertical; }.editor-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.help { font-size: 12px; line-height: 1.6; margin: 0; color: var(--text3, #9696aa); }.editor-error { color: #fa8c8c; font-size: 13px; margin: 0; }
footer { position: sticky; bottom: 0; display: flex; gap: 10px; padding: 16px 24px; border-top: 1px solid var(--border, #34343e); background: var(--bg2, #1e1e27); }.spacer { flex: 1; }.danger { color: #f08c8c; }
@media (max-width: 820px) { .provider-toolbar { align-items: flex-start; flex-direction: column; }.provider-card { padding: 15px; gap: 12px; }.provider-logo { flex-basis: 62px; font-size: 15px; }.provider-heading { gap: 5px; }.editor-grid { grid-template-columns: 1fr; } }
</style>
