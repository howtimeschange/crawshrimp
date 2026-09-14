<template>
  <div v-if="open" class="face-backdrop" @click.self="close" @keydown.esc.stop.prevent="close">
    <section ref="panel" class="face-dialog" role="dialog" aria-modal="true" aria-label="生成结果换脸" tabindex="-1" @keydown="trapDialogFocus">
      <header><div><strong>生成结果换脸</strong><p>{{ title }}</p></div><button type="button" :disabled="busy" @click="close">关闭</button></header>
      <div class="face-body">
        <div class="comparison"><figure><img :src="sourceUrl" alt="换脸前的生成图" /><figcaption>原生成图</figcaption></figure><figure v-if="resultUrl"><img :src="resultUrl" alt="换脸后的生成图" /><figcaption>换脸结果 · 待审批</figcaption></figure></div>
        <div class="face-controls">
          <div class="selected-model"><img v-if="model" :src="model.imageUrl" :alt="model.label" /><div><strong>AI 模特</strong><p>{{ model?.label || '尚未选择模特' }}</p></div><button type="button" :disabled="busy || Boolean(resultUrl)" @click="pickerOpen = true">{{ model ? '更换' : '选择模特' }}</button></div>
          <label>换脸补充要求<textarea v-model="instruction" :disabled="busy || Boolean(resultUrl)" placeholder="可选，例如：保持表情自然，脸部边缘与原图光线融合"></textarea></label>
          <p class="hint">只替换脸部，保留服装、姿势和背景。新图将加入本款审批结果，原图保留。</p>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <p v-if="busy" role="status">换脸中，请稍候…</p>
          <button class="primary" type="button" :disabled="blocked || busy || !model || Boolean(resultUrl)" @click="$emit('submit', { model_id: model.id, instruction })">{{ blocked ? '提交状态待核实' : busy ? '正在换脸…' : resultUrl ? '已生成，待审批' : '开始换脸' }}</button>
        </div>
      </div>
      <BalaModelPicker :open="pickerOpen" :selected="model" @close="closePicker" @select="selectModel" />
    </section>
  </div>
</template>
<script setup>
import { nextTick, ref, watch } from 'vue'
import BalaModelPicker from './BalaModelPicker.vue'
import { trapDialogFocus } from '../utils/dialogAccessibility.mjs'
const props = defineProps({ open: Boolean, busy: Boolean, blocked: Boolean, sourceUrl: String, resultUrl: String, title: String, error: String })
const emit = defineEmits(['close', 'submit'])
const model = ref(null), instruction = ref(''), pickerOpen = ref(false), panel = ref(null)
function close() { if (!props.busy && !pickerOpen.value) emit('close') }
function closePicker() { pickerOpen.value = false; nextTick(() => panel.value?.focus()) }
function selectModel(value) { model.value = value; closePicker() }
watch(() => props.open, async open => { if (open) { instruction.value = ''; await nextTick(); panel.value?.focus() } else pickerOpen.value = false })
</script>
<style scoped>
.face-backdrop { position: fixed; inset: 0; z-index: 320; background: #0009; display: grid; place-items: center; padding: 24px; }
.face-dialog { width: min(1120px, 94vw); max-height: 90vh; overflow: auto; background: var(--bg2); color: var(--text); border: 1px solid var(--border); border-radius: 12px; padding: 24px; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 20px; } header strong { font-size: 20px; } p { color: var(--text2); line-height: 1.6; margin: 6px 0; }
.face-body { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(280px,1fr); gap: 24px; }.comparison { display: flex; gap: 12px; min-width: 0; } figure { flex: 1; min-width: 0; margin: 0; } figure img { width: 100%; height: min(56vh,540px); object-fit: contain; background: var(--bg); border-radius: 8px; } figcaption { margin-top: 8px; color: var(--text2); font-size: 13px; }
.face-controls { display: flex; flex-direction: column; gap: 16px; }.selected-model { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; }.selected-model img { width: 64px; height: 64px; object-fit: cover; border-radius: 6px; }.selected-model > div { flex: 1; }.selected-model p { font-size: 12px; } label { display: grid; gap: 8px; } textarea { min-height: 112px; resize: vertical; }
button, textarea { color: var(--text); background: var(--bg3); border: 1px solid var(--border); padding: 10px 12px; border-radius: 6px; font: inherit; } button { cursor: pointer; } .primary { background: var(--orange, #ff7026); color: #161616; border-color: transparent; font-weight: 600; min-height: 42px; }.hint { font-size: 13px; }.error { color: var(--red); } button:disabled { opacity: .5; cursor: default; } button:focus-visible, textarea:focus-visible { outline: 2px solid var(--orange, #ff7026); outline-offset: 2px; }
@media(max-width:800px) { .face-body { grid-template-columns: 1fr; } figure img { height: 35vh; } }
</style>
