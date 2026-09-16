<template>
  <section v-if="items.length" class="cs-activity" aria-label="任务执行步骤">
    <details v-for="(item, index) in items" :key="item.id || index" :open="isOpen(item, index)" :class="state(item)" @toggle="toggle($event, item, index)">
      <summary><span class="cs-step-mark" aria-hidden="true">{{ done(item) ? '✓' : state(item) === 'error' ? '!' : index + 1 }}</span><strong>{{ item.title }}</strong><span class="cs-step-summary">{{ item.status || item.main || item.detail }}</span><span class="cs-step-chevron" aria-hidden="true">⌄</span></summary>
      <div class="cs-step-detail"><p v-if="item.main">{{ item.main }}</p><p v-if="item.detail || item.caption">{{ item.detail || item.caption }}</p><span v-if="item.percentLabel">{{ item.percentLabel }}</span><slot :item="item" /></div>
    </details>
  </section>
</template>
<script setup>
import { reactive, watch } from 'vue'
const props = defineProps({ items: { type: Array, default: () => [] } })
const overrides = reactive({})
const key = (item, index) => item.id || String(index)
const done = item => ['complete', 'completed', 'done', 'success', 'succeeded'].includes(item.state)
const state = item => done(item) ? 'done' : ['failed', 'error'].includes(item.state) ? 'error' : ['running', 'active', 'current', 'processing'].includes(item.state) ? 'active' : 'pending'
const isOpen = (item, index) => overrides[key(item, index)] ?? ['active', 'error'].includes(state(item))
function toggle(event, item, index) { if (event.target.open !== isOpen(item, index)) overrides[key(item, index)] = event.target.open }
watch(() => props.items.map(item => `${item.id}:${item.state}`).join('|'), () => { for (const k of Object.keys(overrides)) delete overrides[k] })
</script>
<style scoped>
.cs-activity { display: grid; gap: 6px; margin: 12px 0; }.cs-activity details { background: var(--bg2); color: var(--text); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }.cs-activity summary { display: flex; align-items: center; gap: 9px; padding: 10px 12px; cursor: pointer; list-style: none; font-size: 12px; }.cs-activity summary::-webkit-details-marker { display: none; }.cs-step-mark { flex: 0 0 20px; height: 20px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 50%; font-size: 11px; color: var(--text2); }.active .cs-step-mark { color: var(--orange); border-color: var(--orange); }.done .cs-step-mark { color: var(--green, #458866); }.error .cs-step-mark { color: var(--red, #d85f5f); }.cs-step-summary { margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text2); max-width: 55%; }.cs-step-chevron { color: var(--text2); transition: transform .16s; }details[open] .cs-step-chevron { transform: rotate(180deg); }.cs-step-detail { padding: 0 14px 12px 42px; font-size: 12px; color: var(--text2); animation: appear .16s ease-out; }.cs-step-detail p { margin: 4px 0; overflow-wrap: anywhere; }summary:focus-visible { outline: 2px solid var(--orange); outline-offset: -2px; }@keyframes appear { from { opacity: 0; } }@media(prefers-reduced-motion:reduce) { * { animation: none !important; transition: none !important; } }
</style>
