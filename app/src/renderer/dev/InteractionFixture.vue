<template>
  <main class="fixture">
    <header><div><p>抓虾 · 交互验收</p><h1>状态清楚，操作顺手</h1><small>本地固定样例 · 不调用生成或审批服务</small></div><button @click="theme = theme === 'dark' ? 'light' : 'dark'">切换{{ theme === 'dark' ? '浅色' : '深色' }}</button></header>
    <section class="fixture-panel"><h2>图片生成 · 本地状态验收</h2><p>手动切换模拟状态，不请求模型。画布保持相同尺寸。</p>
      <div class="fixture-actions"><button v-for="option in generationOptions" :key="option.value" :aria-pressed="generationState === option.value" @click="generationState = option.value">{{ option.label }}</button></div>
      <ImageGeneration class="fixture-generation" :status="generationState" :src="images[0].src">
        <button aria-label="预览生成样例" @click="selection = '已打开生成图片预览'"><img :src="images[0].src" alt="本地商品生成样例" /></button>
        <template #error><div class="fixture-generation-error"><strong>生成失败</strong><p>本地错误样例，参数和历史结果保留。</p><button @click="generationState = 'generating'">重试样例</button></div></template>
      </ImageGeneration>
    </section>
    <div class="fixture-columns">
      <section class="fixture-panel"><h2>选择与反馈</h2><SearchCombobox v-model="selected" label="样例模型" :options="options" /><div class="fixture-actions"><StatefulButton :state="buttonState" @click="run">验证成功反馈</StatefulButton><button @click="fail">验证失败反馈</button></div><CommandPalette :items="commands" @select="item => selection = item.label" /><p>{{ selection }}</p><ImportQueue :items="imports" :busy="false" @retry="retry" @remove="item => imports = imports.filter(row => row.id !== item.id)" /></section>
      <section class="fixture-panel"><h2>任务与审核</h2><ActivitySteps :items="steps" /><button @click="completeStep">完成当前步骤</button><ApprovalCard title="图片审核" :summary="approved ? '当前图片已批准，可继续后续操作' : '等待确认：商品完整、颜色一致、文字清晰'" :confirmed="approved"><template #actions><StatefulButton :state="approved ? 'success' : 'idle'" @click="approved = true">批准此图</StatefulButton><button @click="approved = false">恢复待定</button></template></ApprovalCard></section>
    </div>
    <section class="fixture-panel"><h2>5,000 张素材 · 规则网格</h2><p>已选择 {{ chosen.size }} 张。方向键可跨行移动；滚动后选择保留。</p><VirtualGrid :items="images" :height="400" :row-height="180" :min-width="150" label="五千张素材"><template #default="{ item }"><button class="fixture-image" :aria-pressed="chosen.has(item.id)" @click="toggle(item.id)"><img :src="item.src" :alt="item.label" loading="lazy" /><span>{{ item.label }}</span></button></template></VirtualGrid></section>
    <ToastStack />
  </main>
</template>
<script setup>
import { ref, computed, reactive, watch } from 'vue'
import ImageGeneration from '../components/interaction/ImageGeneration.vue'
import SearchCombobox from '../components/interaction/SearchCombobox.vue'
import StatefulButton from '../components/interaction/StatefulButton.vue'
import CommandPalette from '../components/interaction/CommandPalette.vue'
import ImportQueue from '../components/interaction/ImportQueue.vue'
import ActivitySteps from '../components/interaction/ActivitySteps.vue'
import ApprovalCard from '../components/interaction/ApprovalCard.vue'
import VirtualGrid from '../components/interaction/VirtualGrid.vue'
import ToastStack from '../components/interaction/ToastStack.vue'
import { notifyOperation } from '../utils/interactionToasts'
const generationState = ref('generating')
const generationOptions = [{ value: 'queued', label: '查看排队' }, { value: 'generating', label: '查看生成中' }, { value: 'complete', label: '查看完成' }, { value: 'error', label: '查看失败' }]
const theme = ref('dark')
watch(theme, value => document.documentElement.dataset.theme = value, { immediate: true })
const selected = ref('gpt'), buttonState = ref('idle'), selection = ref(''), approved = ref(false)
const options = [{ value: 'gpt', label: 'GPT Image 2', group: '森马网关' }, { value: 'nano', label: 'Nano Banana 2', group: '森马网关' }, { value: 'woka', label: 'GPT Image 2', group: '沃卡' }]
const commands = [{ id: 'a', label: 'AI 生图', group: '工作台' }, { id: 'b', label: '视频任务', group: '最近任务' }]
const imports = ref([{ id: 1, name: '商品正面.png', state: 'success' }, { id: 2, name: '商品侧面.png', state: 'error', error: '读取失败，请检查文件后重试' }])
const steps = ref([{ id: 'find', title: '找图', state: 'complete', main: '已找到 12 张素材' }, { id: 'generate', title: '生成', state: 'active', detail: '正在处理第 2 张图片' }, { id: 'review', title: '审核', state: 'pending', detail: '等待图片结果' }])
const chosen = reactive(new Set())
const images = Array.from({length: 5000}, (_, i) => ({ id: String(i), label: `素材 ${i + 1}`, src: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="160"><rect width="200" height="160" fill="${i%2 ? '#353541' : '#2b2b35'}"/><path d="M60 120 L75 45 L125 45 L145 120Z" fill="#a4a1a9"/><text x="100" y="145" fill="#e2e0f0" text-anchor="middle" font-size="12">${i+1}</text></svg>`)}` }))
function toggle(id) { chosen.has(id) ? chosen.delete(id) : chosen.add(id) }
function completeStep() { steps.value[1].state = 'complete'; steps.value[1].main = '已生成 4 张图片'; steps.value[2].state = 'active' }
function retry(item) { item.state = 'pending'; item.error = ''; setTimeout(() => item.state = 'success', 700) }
function run() { buttonState.value = 'pending'; notifyOperation({ id: 'fixture-save', state: 'pending', title: '正在保存' }); setTimeout(() => { buttonState.value = 'success'; notifyOperation({ id: 'fixture-save', title: '保存成功' }) }, 900) }
function fail() { buttonState.value = 'error'; notifyOperation({ id: 'fixture-save', state: 'error', title: '保存未完成', detail: '本地错误样例，可重试。' }) }
</script>
<style scoped>
.fixture-generation { max-width: 360px; border: 1px solid var(--border); border-radius: 8px; }.fixture-generation-error { padding: 35px 20px; text-align: center; }.fixture-generation :deep(.cs-generation-media button) { padding: 0; border: 0; border-radius: 0; }

.fixture { height: 100vh; overflow: auto; padding: 32px; max-width: 1200px; margin: auto; }.fixture > header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; }.fixture h1 { margin: 8px 0; font-size: 24px; }.fixture h2 { font-size: 14px; margin-bottom: 14px; }.fixture small,.fixture p { color: var(--text2); font-size: 12px; line-height: 1.7; }.fixture header p { color: var(--orange); }.fixture-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }.fixture-panel { border: 1px solid var(--border); border-radius: 10px; padding: 20px; background: var(--bg2); margin-bottom: 16px; min-width: 0; }.fixture button { color: var(--text); background: var(--bg3); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; cursor: pointer; }.fixture-actions { display: flex; gap: 8px; margin: 14px 0; }.fixture .cs-approval-card { margin-top: 14px; }.fixture-image { display: flex; flex-direction: column; width: 100%; height: 180px; text-align: left; }.fixture-image img { width: 100%; min-height: 0; flex: 1; object-fit: contain; }.fixture-image span { padding-top: 7px; font-size: 12px; }.fixture-image[aria-pressed=true] { border: 2px solid var(--orange); }.fixture button:focus-visible { outline: 2px solid var(--orange); outline-offset: 2px; }@media(max-width:700px) { .fixture-columns { grid-template-columns: 1fr; } }
</style>
