<template>
  <div ref="viewport" class="cs-virtual-grid" :class="{ windowed }" :style="windowed ? { height: `${height}px` } : {}" :aria-label="label" @scroll.passive="onScroll">
    <div class="cs-virtual-space" :style="windowed ? { height: `${range.total}px` } : {}">
      <div class="cs-virtual-items" :style="{ gridTemplateColumns: `repeat(${range.columns}, minmax(0, 1fr))`, gap: `${gap}px`, ...(windowed ? { transform: `translateY(${range.top}px)`, position: 'absolute', inset: '0 0 auto' } : {}) }">
        <div v-for="(item, offset) in visible" :key="getKey(item)" class="cs-virtual-cell" :style="windowed ? { height: `${rowHeight}px` } : {}" :data-grid-index="rangeStart + offset" @keydown="navigate($event, rangeStart + offset)"><slot :item="item" :index="rangeStart + offset" /></div>
      </div>
    </div>
    <div v-if="!items.length" class="cs-grid-empty"><slot name="empty">暂无内容</slot></div>
  </div>
</template>
<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { gridWindow } from '../../utils/virtualGrid.mjs'
const props = defineProps({ items: { type: Array, default: () => [] }, getKey: { type: Function, default: item => item.id || item.key || item.path }, minWidth: { type: Number, default: 180 }, rowHeight: { type: Number, default: 250 }, height: { type: Number, default: 560 }, gap: { type: Number, default: 12 }, threshold: { type: Number, default: 24 }, singleColumn: Boolean, label: { type: String, default: '图片列表' } })
const emit = defineEmits(['near-end'])
const viewport = ref(null), width = ref(600), scrollTop = ref(0)
const windowed = computed(() => props.items.length > props.threshold)
const range = computed(() => gridWindow({ count: props.items.length, width: width.value, minWidth: props.minWidth, rowHeight: props.rowHeight, gap: props.gap, scrollTop: scrollTop.value, height: props.height, singleColumn: props.singleColumn }))
const rangeStart = computed(() => windowed.value ? range.value.start : 0)
const visible = computed(() => windowed.value ? props.items.slice(range.value.start, range.value.end) : props.items)
let observer
function onScroll() { scrollTop.value = viewport.value?.scrollTop || 0; if (range.value.end >= props.items.length - range.value.columns * 2) emit('near-end') }
watch(() => props.items[0] && props.getKey(props.items[0]), () => { if (viewport.value) viewport.value.scrollTop = 0; scrollTop.value = 0 })
watch(() => props.items.length, async () => { await nextTick(); onScroll() })
onMounted(() => { observer = new ResizeObserver(entries => { width.value = entries[0].contentRect.width }); observer.observe(viewport.value) })
onBeforeUnmount(() => observer?.disconnect())
async function navigate(event, index) {
  if (!windowed.value || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return
  const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -range.value.columns, ArrowDown: range.value.columns }[event.key]
  const next = Math.max(0, Math.min(props.items.length - 1, index + delta))
  event.preventDefault()
  const y = Math.floor(next / range.value.columns) * (props.rowHeight + props.gap)
  if (y < scrollTop.value || y + props.rowHeight > scrollTop.value + props.height) { viewport.value.scrollTop = y; onScroll() }
  await nextTick()
  viewport.value.querySelector(`[data-grid-index="${next}"] button, [data-grid-index="${next}"] [tabindex="0"]`)?.focus({ preventScroll: true })
}
</script>
<style scoped>
.cs-virtual-grid { min-width: 0; width: 100%; }.windowed { overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }.cs-virtual-space { position: relative; }.cs-virtual-items { display: grid; align-items: stretch; }.cs-virtual-cell { min-width: 0; }.windowed .cs-virtual-cell { overflow: hidden; }.cs-virtual-cell :deep(> article), .cs-virtual-cell :deep(> button) { box-sizing: border-box; width: 100%; height: 100%; }.cs-grid-empty { padding: 24px; color: var(--text2); text-align: center; }
</style>
