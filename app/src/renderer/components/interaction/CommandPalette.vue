<template>
  <button type="button" class="cs-command-trigger" aria-label="搜索功能与任务" @click="show">搜索功能与任务 <kbd>{{ shortcut }}</kbd></button>
  <Teleport to="body"><dialog ref="dialog" class="cs-command-dialog" aria-label="搜索功能与任务" @click="backdrop" @close="closed" @keydown.esc.stop>
    <header><input ref="input" v-model="query" role="combobox" aria-label="搜索功能、脚本、任务" aria-autocomplete="list" aria-expanded="true" aria-controls="cs-command-results" :aria-activedescendant="filtered[index] ? `cs-command-${index}` : undefined" placeholder="搜索功能、脚本、任务…" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.enter.prevent="choose(filtered[index])" /><button type="button" aria-label="关闭快捷面板" @click="dialog.close()">Esc</button></header>
    <ul id="cs-command-results" role="listbox" aria-label="搜索结果"><template v-for="(item, i) in filtered" :key="item.id"><li v-if="item.group !== filtered[i-1]?.group" role="presentation" class="cs-command-group">{{ item.group }}</li><li :id="`cs-command-${i}`" role="option" :aria-selected="index === i" :class="{ active: i === index }" @mousedown.prevent @click="choose(item)" @mousemove="index = i"><span>{{ item.label }}</span><small>{{ item.detail }}</small></li></template><li v-if="!filtered.length" class="cs-command-empty" role="presentation">没有匹配的功能或任务</li></ul>
    <footer>↑ ↓ 选择 · Enter 打开 · Esc 关闭<span>{{ filtered.length }} 项</span></footer>
  </dialog></Teleport>
</template>
<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
const props = defineProps({ items: { type: Array, default: () => [] } })
const emit = defineEmits(['select', 'open'])
const dialog = ref(null), input = ref(null), query = ref(''), index = ref(0), recent = ref([])
const shortcut = /Mac/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'
try { recent.value = JSON.parse(localStorage.getItem('cs-command-recents') || '[]').filter(id => typeof id === 'string').slice(0, 6) } catch {}
const filtered = computed(() => {
  const words = query.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  if (words.length) return props.items.filter(item => words.every(word => `${item.label} ${item.detail || ''} ${item.group}`.toLocaleLowerCase().includes(word))).slice(0, 80)
  const recents = recent.value.map(id => props.items.find(item => item.id === id)).filter(Boolean).map(item => ({ ...item, group: '最近访问' }))
  return [...recents, ...props.items.filter(item => !recent.value.includes(item.id))].slice(0, 80)
})
let returnFocus
watch(query, () => { index.value = 0 })
watch(filtered, () => { index.value = Math.min(index.value, Math.max(0, filtered.value.length - 1)) })
watch(index, async () => { await nextTick(); dialog.value?.querySelector(`#cs-command-${index.value}`)?.scrollIntoView({ block: 'nearest' }) })
async function show() {
  if (dialog.value?.open) return
  // Respect the existing modal's focus boundary.
  if (document.querySelector('dialog[open], [aria-modal="true"]')) return
  returnFocus = document.activeElement; query.value = ''; index.value = 0
  dialog.value.showModal(); emit('open'); await nextTick(); input.value?.focus()
}
function closed() { returnFocus?.isConnected && returnFocus.focus?.() }
function backdrop(event) { if (event.target !== dialog.value) return; const r = dialog.value.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.value.close() }
function move(delta) { index.value = (index.value + delta + filtered.value.length) % (filtered.value.length || 1) }
async function choose(item) { if (!item) return; recent.value = [item.id, ...recent.value.filter(id => id !== item.id)].slice(0, 6); try { localStorage.setItem('cs-command-recents', JSON.stringify(recent.value)) } catch {} dialog.value.close(); await nextTick(); emit('select', item) }
function shortcutKey(event) { if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k' || event.isComposing) return; event.preventDefault(); if (dialog.value.open) dialog.value.close(); else void show() }
defineExpose({ show })
onMounted(() => window.addEventListener('keydown', shortcutKey))
onBeforeUnmount(() => window.removeEventListener('keydown', shortcutKey))
</script>
<style scoped>
.cs-command-trigger { -webkit-app-region: no-drag; display: flex; align-items: center; gap: 20px; padding: 5px 9px; color: var(--text2); background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; font-size: 12px; cursor: pointer; }.cs-command-trigger kbd { font: inherit; font-size: 10px; }.cs-command-dialog { padding: 0; width: min(560px, calc(100vw - 40px)); margin: 15vh auto auto; max-height: 70vh; background: var(--bg2); color: var(--text); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 20px 80px #0004; }.cs-command-dialog[open] { animation: enter .18s ease-out; }.cs-command-dialog::backdrop { background: #0006; }.cs-command-dialog header { padding: 14px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 12px; }.cs-command-dialog input { flex: 1; min-width: 0; padding: 5px; background: none; border: 0; color: var(--text); font: inherit; outline: none; }.cs-command-dialog header button { border: 1px solid var(--border); border-radius: 4px; background: var(--bg3); color: var(--text2); font-size: 11px; cursor: pointer; }.cs-command-dialog ul { margin: 0; padding: 8px; list-style: none; max-height: 46vh; overflow: auto; }.cs-command-dialog li[role=option] { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 10px; font-size: 13px; border-radius: 6px; cursor: pointer; }.cs-command-dialog li.active { background: var(--bg3); box-shadow: inset 2px 0 var(--orange); }.cs-command-dialog small { color: var(--text2); max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.cs-command-group,.cs-command-empty { padding: 10px; font-size: 11px; color: var(--text2); }.cs-command-dialog footer { display: flex; justify-content: space-between; border-top: 1px solid var(--border); padding: 10px 15px; font-size: 11px; color: var(--text2); }@keyframes enter { from { opacity: 0; transform: translateY(-6px); } }@media(prefers-reduced-motion:reduce) { * { animation: none !important; } }
</style>
