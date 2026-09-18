<template>
  <div ref="surface" class="cs-image-generation" :class="[status, { revealed: ready, visible, 'preview-error': previewError }]" :aria-busy="busy" @pointermove="move" @pointerleave="leave">
    <div v-if="status === 'complete'" class="cs-generation-media" @load.capture="loaded" @error.capture="previewError = true"><slot /></div>
    <div v-if="busy" class="cs-generation-dither" aria-hidden="true"><span /></div>
    <div v-if="status === 'error'" class="cs-generation-error"><slot name="error" /></div>
    <div class="cs-generation-status" role="status">
      <span class="cs-generation-mark" :class="{ spinning: busy }" aria-hidden="true">{{ status === 'error' || previewError ? '!' : ready ? '✓' : '⠿' }}</span>
      <span>{{ statusText || message }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
// Vue adaptation of beUI's stable canvas / dither / reveal interaction.
// Status is supplied by real work; no timer invents provider progress.
const props = defineProps({ status: { type: String, default: 'generating' }, src: { type: String, default: '' }, statusText: { type: String, default: '' } })
const surface = ref(null), mediaLoaded = ref(false), previewError = ref(false), visible = ref(true)
const ready = computed(() => props.status === 'complete' && (mediaLoaded.value || !props.src || previewError.value))
const busy = computed(() => props.status !== 'error' && !ready.value)
const message = computed(() => previewError.value ? '预览加载失败' : props.status === 'queued' ? '等待生成' : props.status === 'error' ? '生成未完成' : ready.value ? '图片已生成' : props.status === 'complete' ? '正在加载图片' : '正在生成图片')
function loaded(event) { if (event.target instanceof HTMLImageElement) mediaLoaded.value = true }
watch(() => [props.src, props.status], async () => {
  mediaLoaded.value = false
  previewError.value = false
  await nextTick()
  const img = surface.value?.querySelector('img')
  if (img?.complete && img.naturalWidth > 0) mediaLoaded.value = true
}, { immediate: true })
function move(event) {
  if (!busy.value || event.pointerType !== 'mouse' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const rect = surface.value.getBoundingClientRect()
  surface.value.style.setProperty('--spot-x', `${event.clientX - rect.left}px`)
  surface.value.style.setProperty('--spot-y', `${event.clientY - rect.top}px`)
}
function leave() { surface.value?.style.removeProperty('--spot-x'); surface.value?.style.removeProperty('--spot-y') }
let observer
onMounted(() => {
  observer = new IntersectionObserver(([entry]) => { visible.value = entry.isIntersecting })
  observer.observe(surface.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<style scoped>
.cs-image-generation { position: relative; isolation: isolate; height: 286px; min-height: 0; overflow: hidden; background: var(--bg2); color: var(--text2); }
.cs-generation-media { position: absolute; inset: 0; opacity: 0; transform: scale(1.015); filter: blur(3px); transition: opacity 420ms ease, transform 420ms ease, filter 420ms ease; }
.revealed .cs-generation-media { opacity: 1; transform: none; filter: none; }
.cs-generation-media :deep(button), .cs-generation-media :deep(img) { width: 100%; height: 100%; min-height: 0; object-fit: contain; }
.cs-generation-dither { position: absolute; inset: 0; pointer-events: none; background-image: radial-gradient(circle, var(--text3) .7px, transparent 1px); background-size: 10px 10px; opacity: .5; }
.cs-generation-dither span { position: absolute; inset: -15%; background-image: radial-gradient(circle, var(--orange) 1.2px, transparent 1.7px); background-size: 10px 10px; mask-image: radial-gradient(ellipse 34% 38% at var(--spot-x, 50%) var(--spot-y, 48%), #000, transparent); animation: cs-generation-drift 4.8s ease-in-out infinite alternate; animation-play-state: paused; }
.visible .cs-generation-dither span, .visible .spinning { animation-play-state: running; }
.queued .cs-generation-dither span { animation: none; opacity: .45; }
.cs-generation-status { position: absolute; z-index: 1; left: 12px; bottom: 12px; max-width: calc(100% - 24px); display: flex; align-items: center; gap: 7px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg2); color: var(--text2); font-size: 11px; pointer-events: none; }
.cs-generation-mark { color: var(--orange); font-size: 16px; line-height: 16px; }
.spinning { animation: cs-generation-spin 2.4s ease-in-out infinite; animation-play-state: paused; }
.error .cs-generation-mark, .preview-error .cs-generation-mark { color: var(--red); }
.revealed:not(.preview-error) .cs-generation-mark { color: var(--green); }
.cs-generation-error { position: absolute; inset: 0; overflow: auto; padding-bottom: 46px; }
@keyframes cs-generation-drift { from { transform: translate(-4%, -3%); } to { transform: translate(4%, 3%); } }
@keyframes cs-generation-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .cs-generation-media { transition: none; transform: none; filter: none; }.cs-generation-dither span, .spinning { animation: none; } }
</style>
