<template>
  <div ref="root" class="cs-combobox" @keydown.esc.stop="close" @focusout="leave">
    <button ref="trigger" type="button" class="cs-combobox-trigger" role="combobox" :aria-label="label" :aria-expanded="open" :aria-controls="listId" aria-haspopup="listbox" :disabled="disabled" @click="toggle" @keydown.down.prevent="show" @keydown.up.prevent="show">
      <span>{{ selected?.label || (modelValue ? '所选项已不可用，请重新选择' : placeholder) }}</span><span aria-hidden="true">⌄</span>
    </button>
    <Teleport :to="portalTarget"><div v-if="open" ref="panel" class="cs-combobox-panel" :style="panelStyle" @keydown.esc.stop.prevent="close" @focusout="leave">
      <input ref="searchInput" v-model="query" :aria-label="`搜索${label}`" role="combobox" aria-autocomplete="list" aria-expanded="true" :aria-controls="listId" :aria-activedescendant="filtered[index] ? `${listId}-${index}` : undefined" placeholder="输入关键词搜索…" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.enter.prevent="choose(filtered[index])" @keydown.home.prevent="index = 0" @keydown.end.prevent="index = filtered.length - 1" />
      <ul :id="listId" role="listbox" :aria-label="label">
        <template v-for="(option, i) in filtered" :key="String(option.value)">
          <li v-if="option.group && option.group !== filtered[i-1]?.group" role="presentation" class="cs-combobox-group">{{ option.group }}</li>
          <li :id="`${listId}-${i}`" role="option" :aria-selected="option.value === modelValue" :class="{ active: i === index, selected: option.value === modelValue }" @mousedown.prevent @click="choose(option)" @mousemove="index = i"><span>{{ option.label }}</span><span v-if="option.value === modelValue" aria-hidden="true">✓</span></li>
        </template>
        <li v-if="!filtered.length" role="presentation" class="cs-combobox-empty">没有匹配项</li>
      </ul>
    </div></Teleport>
  </div>
</template>
<script setup>
import { computed, ref, nextTick, watch, useId, onMounted, onBeforeUnmount } from 'vue'
const props = defineProps({ modelValue: [String, Number], options: { type: Array, default: () => [] }, label: { type: String, default: '选项' }, placeholder: { type: String, default: '请选择' }, disabled: Boolean })
const emit = defineEmits(['update:modelValue', 'change'])
const root = ref(null), trigger = ref(null), searchInput = ref(null), query = ref(''), open = ref(false), index = ref(0)
const panel = ref(null), portalTarget = ref('body'), panelStyle = ref({})
const listId = `cs-options-${useId()}`
const selected = computed(() => props.options.find(item => item.value === props.modelValue))
const filtered = computed(() => props.options.filter(item => !item.disabled && `${item.label} ${item.group || ''} ${item.keywords || ''}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
watch(query, () => { index.value = 0 })
watch(() => props.options, () => { index.value = Math.min(index.value, Math.max(0, filtered.value.length - 1)) })
watch(index, async () => { await nextTick(); panel.value?.querySelector(`#${CSS.escape(listId + '-' + index.value)}`)?.scrollIntoView({ block: 'nearest' }) })
async function show() { if (props.disabled) return; portalTarget.value = root.value?.closest('dialog, [aria-modal="true"]') || document.body; query.value = ''; open.value = true; position(); index.value = Math.max(0, filtered.value.findIndex(item => item.value === props.modelValue)); await nextTick(); searchInput.value?.focus() }
function close() { open.value = false; trigger.value?.focus() }
function toggle() { if (open.value) close(); else void show() }
function move(delta) { index.value = (index.value + delta + filtered.value.length) % (filtered.value.length || 1) }
function choose(item) { if (!item) return; emit('update:modelValue', item.value); emit('change', item.value); close() }
function leave(event) { if (!root.value?.contains(event.relatedTarget) && !panel.value?.contains(event.relatedTarget)) open.value = false }
function position() {
  if (!open.value || !trigger.value) return
  const rect = trigger.value.getBoundingClientRect()
  const below = window.innerHeight - rect.bottom - 12
  const above = rect.top - 12
  const up = below < 220 && above > below
  const available = Math.max(100, Math.min(300, up ? above : below))
  panelStyle.value = { left: `${Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(240, rect.width) - 8))}px`, width: `${Math.max(240, rect.width)}px`, maxHeight: `${available}px`, ...(up ? { bottom: `${window.innerHeight - rect.top + 4}px`, top: 'auto' } : { top: `${rect.bottom + 4}px`, bottom: 'auto' }) }
}
function outside(event) { if (!root.value?.contains(event.target) && !panel.value?.contains(event.target)) open.value = false }
onMounted(() => { document.addEventListener('pointerdown', outside); window.addEventListener('resize', position); window.addEventListener('scroll', position, true) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true) })
</script>
<style scoped>
.cs-combobox { position: relative; min-width: 0; width: 100%; font-size: 13px; }.cs-combobox-trigger { display: flex; justify-content: space-between; gap: 10px; align-items: center; width: 100%; min-height: 36px; padding: 8px 10px; color: var(--text); background: var(--bg3); border: 1px solid var(--border); border-radius: 6px; text-align: left; font: inherit; cursor: pointer; }.cs-combobox-trigger > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.cs-combobox-panel { position: fixed; display: flex; flex-direction: column; box-sizing: border-box; top: calc(100% + 4px); left: 0; width: max(100%, 240px); max-width: min(440px, 80vw); z-index: 1200; padding: 6px; background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px #0002; animation: appear .16s ease-out; }.cs-combobox-panel input { width: 100%; box-sizing: border-box; min-height: 34px; padding: 8px; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 5px; font: inherit; }.cs-combobox-panel ul { margin: 6px 0 0; padding: 0; list-style: none; max-height: 230px; min-height: 0; overflow: auto; }.cs-combobox-panel li[role=option] { display: flex; justify-content: space-between; gap: 8px; padding: 9px; border-radius: 5px; cursor: pointer; overflow-wrap: anywhere; }.cs-combobox-panel .active { background: var(--bg3); }.cs-combobox-panel .selected { color: var(--orange); }.cs-combobox-group,.cs-combobox-empty { padding: 8px; font-size: 12px; color: var(--text2); }.cs-combobox :focus-visible { outline: 2px solid var(--orange); outline-offset: 1px; }@keyframes appear { from { opacity: 0; transform: translateY(-3px); } }@media(prefers-reduced-motion:reduce) { * { animation: none !important; } }
</style>
