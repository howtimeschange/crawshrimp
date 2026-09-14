<template>
  <div v-if="open" class="model-picker-backdrop" @click.self="$emit('close')" @keydown.esc.stop.prevent="$emit('close')">
    <section ref="panel" class="model-picker" role="dialog" aria-modal="true" aria-label="选择 AI 模特" tabindex="-1" @keydown="trapDialogFocus">
      <header><div><strong>选择 AI 模特</strong><p>按年龄和性别筛选</p></div><button type="button" @click="$emit('close')">关闭</button></header>
      <div class="filters">
        <label>年龄段<select v-model="age"><option value="">全部</option><option v-for="value in ages" :key="value">{{ value }}</option></select></label>
        <label>性别<select v-model="gender"><option value="">全部</option><option v-for="value in genders" :key="value">{{ value }}</option></select></label>
      </div>
      <p v-if="loading" role="status">正在加载模特库…</p>
      <div v-else-if="error" role="alert"><p>{{ error }}</p><button type="button" @click="load">重新加载</button></div>
      <div v-else class="model-grid">
        <button v-for="model in filtered" :key="model.id" type="button" :class="{ selected: draft?.id === model.id }" :aria-pressed="draft?.id === model.id" @click="draft = model">
          <img :src="model.imageUrl" :alt="model.label" loading="lazy" />
          <strong>{{ model.age_label }} · {{ model.gender }}</strong><span>{{ model.label }}</span>
        </button>
        <p v-if="!filtered.length">当前筛选下没有可用模特。</p>
      </div>
      <footer><span>{{ draft?.label || '尚未选择模特' }}</span><button class="primary" type="button" :disabled="!draft" @click="$emit('select', draft)">确认选择</button></footer>
    </section>
  </div>
</template>
<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { formatBalaModelDisplayLabel } from '../utils/balaAiVideoWorkflow'
import { trapDialogFocus } from '../utils/dialogAccessibility.mjs'
const props = defineProps({ open: Boolean, selected: Object })
defineEmits(['close', 'select'])
const panel = ref(null), items = ref([]), loading = ref(false), error = ref(''), age = ref(''), gender = ref(''), draft = ref(null)
let request = 0
const ages = computed(() => [...new Set(items.value.map(item => item.age_label).filter(Boolean))])
const genders = computed(() => [...new Set(items.value.map(item => item.gender).filter(Boolean))])
const filtered = computed(() => items.value.filter(item => (!age.value || item.age_label === age.value) && (!gender.value || item.gender === gender.value)))
async function load() {
  const id = ++request
  loading.value = true; error.value = ''
  try {
    const payload = await window.cs.listBalaModelLibrary({})
    if (id !== request) return
    if (payload?.error || payload?.detail) throw new Error(payload.error || payload.detail)
    const base = String(window.cs.getApiBase?.() || '').replace(/\/$/, '')
    items.value = (payload.items || []).map(item => ({ ...item, label: formatBalaModelDisplayLabel(item), imageUrl: new URL(item.image_url, `${base}/`).href }))
  } catch (err) { if (id === request) error.value = err.message || '模特库暂时无法加载，请重试' }
  finally { if (id === request) loading.value = false }
}
watch(() => props.open, async open => {
  if (!open) { request++; return }
  draft.value = props.selected || null
  await nextTick(); panel.value?.focus()
  void load()
})
</script>
<style scoped>
.model-picker-backdrop { position: fixed; inset: 0; z-index: 340; background: #0009; display: grid; place-items: center; padding: 24px; }
.model-picker { width: min(900px, 95vw); max-height: 88vh; display: flex; flex-direction: column; gap: 18px; padding: 24px; background: var(--bg2); color: var(--text); border: 1px solid var(--border); border-radius: 12px; }
header, footer, .filters { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
header strong { font-size: 18px; } p { margin: 6px 0; color: var(--text2); } .filters { justify-content: flex-start; } label { display: flex; align-items: center; gap: 10px; }
button, select { color: var(--text); background: var(--bg3); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; cursor: pointer; font: inherit; }
.model-grid { overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px,1fr)); gap: 12px; }
.model-grid button { display: flex; flex-direction: column; text-align: left; gap: 6px; padding: 8px; }
.model-grid img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 4px; }
.model-grid span, footer span { font-size: 12px; color: var(--text2); }.model-grid .selected { border: 2px solid var(--orange, #ff7026); padding: 7px; }
.primary { background: var(--orange, #ff7026); color: #161616; border-color: transparent; font-weight: 600; } button:disabled { opacity: .45; cursor: default; } button:focus-visible, select:focus-visible { outline: 2px solid var(--orange, #ff7026); outline-offset: 2px; }
</style>
