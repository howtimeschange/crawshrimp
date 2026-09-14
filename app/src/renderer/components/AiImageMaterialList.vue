<template>
  <ol class="material-list" :aria-label="role === 'main' ? '主图列表' : '参考图列表'">
    <li v-for="(item, index) in items" :key="item.path" class="material-row" :title="item.name"
      :class="{ 'sorting-source': draggingPath === item.path, 'insert-before': targetPath === item.path && !insertAfter, 'insert-after': targetPath === item.path && insertAfter }"
      :draggable="!disabled && items.length > 1" @dragstart.stop="startSort($event, item)" @dragend.stop="clearSort"
      @dragenter="hoverSort($event, item)" @dragover="hoverSort($event, item)" @dragleave="leaveSort($event, item)" @drop="finishSort($event, item, index)">
      <button class="material-handle" type="button" :disabled="disabled || items.length < 2" :aria-label="`拖动排序：${item.name}`" title="拖动排序，也可用方向键调整" @keydown.left.prevent="$emit('move', index, -1)" @keydown.right.prevent="$emit('move', index, 1)" @keydown.up.prevent="$emit('move', index, -1)" @keydown.down.prevent="$emit('move', index, 1)">
        <svg width="12" height="20" viewBox="0 0 12 20" fill="currentColor" aria-hidden="true"><circle v-for="(point, i) in gripPoints" :key="i" :cx="point[0]" :cy="point[1]" r="1.3" /></svg>
      </button>
      <button class="material-thumb" type="button" :aria-label="`查看大图：${item.name}`" :title="item.name" :disabled="!item.preview" @click="openPreview(item)">
        <img draggable="false" v-if="item.preview" :src="item.preview" :alt="item.name" @error="$emit('preview-error', item.path)" />
        <span v-else>图 {{ offset + index + 1 }}</span>
      </button>
      <span class="material-number" aria-hidden="true">{{ offset + index + 1 }}</span>
      <button class="material-remove" type="button" :disabled="disabled" :aria-label="`移除${item.name}`" :title="`移除${item.name}`" @click="$emit('remove', index)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
    </li>
  </ol>
  <Teleport to="body">
    <dialog ref="previewDialog" class="material-preview" aria-label="图片预览" @click.self="closePreview" @keydown.stop @close="previewItem = null">
      <section v-if="previewItem" class="material-preview-content">
        <header><span>{{ previewItem.name }}</span><button type="button" aria-label="关闭图片预览" @click="closePreview">关闭</button></header>
        <img :src="previewItem.preview" :alt="previewItem.name" />
      </section>
    </dialog>
  </Teleport>
</template>
<script setup>
import { ref, nextTick, getCurrentInstance, watch } from 'vue'
import { INPUT_SORT_MIME, isInputSortTransfer, sortDestination } from '../utils/aiImageDrag.mjs'
const listId = String(getCurrentInstance().uid)
const gripPoints = [[3, 5], [9, 5], [3, 10], [9, 10], [3, 15], [9, 15]]
const draggingPath = ref('')
const targetPath = ref('')
const insertAfter = ref(false)
const previewDialog = ref(null)
const previewItem = ref(null)
async function openPreview(item) {
  if (draggingPath.value || !item.preview) return
  previewItem.value = item
  await nextTick()
  previewDialog.value?.showModal()
}
function closePreview() { previewDialog.value?.close() }

const props = defineProps({ items: { type: Array, default: () => [] }, role: { type: String, default: 'main' }, offset: { type: Number, default: 0 }, disabled: Boolean })
const emit = defineEmits(['move', 'reorder', 'remove', 'preview-error'])

function clearSort() { draggingPath.value = ''; targetPath.value = ''; insertAfter.value = false }
function startSort(event, item) {
  if (props.disabled || props.items.length < 2 || event.target.closest?.('.material-remove')) { event.preventDefault(); return }
  draggingPath.value = item.path
  event.dataTransfer.setData(INPUT_SORT_MIME, JSON.stringify({ listId, path: item.path }))
  event.dataTransfer.effectAllowed = 'move'
}
function hoverSort(event, item) {
  if (!isInputSortTransfer(event.dataTransfer)) return
  event.preventDefault(); event.stopPropagation()
  if (props.disabled || !draggingPath.value) { event.dataTransfer.dropEffect = 'none'; return }
  event.dataTransfer.dropEffect = 'move'
  targetPath.value = item.path
  const rect = event.currentTarget.getBoundingClientRect()
  insertAfter.value = event.clientX > rect.left + rect.width / 2
}
function leaveSort(event, item) {
  if (event.currentTarget.contains(event.relatedTarget)) return
  if (targetPath.value === item.path) targetPath.value = ''
}
function finishSort(event, item, rowIndex) {
  if (!isInputSortTransfer(event.dataTransfer)) return
  event.preventDefault(); event.stopPropagation()
  try {
    const payload = JSON.parse(event.dataTransfer.getData(INPUT_SORT_MIME))
    if (props.disabled || payload.listId !== listId) return
    const from = props.items.findIndex(entry => entry.path === payload.path)
    if (from < 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const to = sortDestination(from, rowIndex, event.clientX > rect.left + rect.width / 2)
    emit('reorder', from, to)
  } catch { /* Ignore incomplete or foreign drag data. */ } finally { clearSort() }
}
watch(() => props.disabled, value => { if (value) clearSort() })
</script>
<style scoped>
.material-list { display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0 0; padding: 0; list-style: none; }
.material-row { position: relative; flex: 0 0 88px; width: 88px; height: 88px; }
button { font: inherit; color: var(--text); background: var(--bg3, var(--bg)); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
.material-thumb { display: grid; place-items: center; width: 100%; height: 100%; padding: 0; overflow: hidden; background: var(--bg); color: var(--text2); font-size: 12px; cursor: zoom-in; }
.material-thumb img { width: 100%; height: 100%; object-fit: contain; }
.material-thumb:hover:not(:disabled) { border-color: var(--text2); }
.material-number { position: absolute; bottom: 4px; left: 4px; min-width: 18px; padding: 1px 4px; border-radius: 4px; color: #fff; background: #16161ddd; text-align: center; font-size: 11px; line-height: 16px; pointer-events: none; }
.material-remove, .material-handle { position: absolute; z-index: 1; display: grid; place-items: center; padding: 0; color: #fff; background: #24242ded; border: 1px solid #ffffff38; }
.material-remove { right: -5px; top: -5px; width: 24px; height: 24px; border-radius: 50%; }
.material-remove:hover:not(:disabled) { background: #b4232e; }
.material-handle { left: 4px; top: 4px; width: 20px; height: 24px; cursor: grab; }
.material-handle:active, .sorting-source { cursor: grabbing; }
.material-handle:disabled { visibility: hidden; }
button:disabled { cursor: default; }
.material-remove:disabled { opacity: .4; }
button:focus-visible { outline: 2px solid var(--accent, #ff6a1a); outline-offset: 3px; }
.sorting-source { opacity: .45; }
.material-row.insert-before::before, .material-row.insert-after::after { content: ''; position: absolute; top: 0; bottom: 0; width: 3px; border-radius: 2px; background: var(--orange, #ff7026); pointer-events: none; }
.material-row.insert-before::before { left: -7px; }
.material-row.insert-after::after { right: -7px; }
.material-preview { position: fixed; inset: 0; width: 100vw; height: 100vh; max-width: none; max-height: none; margin: 0; padding: 24px; border: 0; background: transparent; color: var(--text); box-sizing: border-box; }
.material-preview[open] { display: grid; place-items: center; }
.material-preview::backdrop { background: #000c; }
.material-preview-content { max-width: 92vw; background: var(--bg2, #1d1d26); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.material-preview header { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 12px 16px; }
.material-preview header span { min-width: 0; overflow-wrap: anywhere; font-size: 13px; }
.material-preview header button { flex: none; padding: 6px 12px; }
.material-preview-content > img { display: block; max-width: 100%; max-height: calc(90vh - 72px); margin: auto; object-fit: contain; }
</style>
