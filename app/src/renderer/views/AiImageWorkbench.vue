<template>
  <section class="aiw-workbench aiw-option-3">
    <header class="aiw-topbar">
      <div>
        <p class="aiw-kicker">AI 生图</p>
        <h2>本地 1XM 图片模型工作台</h2>
        <p class="aiw-subtitle">支持主图、参考图、Prompt、自定义尺寸和多模型生成</p>
      </div>
      <div class="aiw-top-actions">
        <button class="aiw-ghost" type="button" @click="historyOpen = !historyOpen">历史记录</button>
        <button class="aiw-ghost" type="button" @click="openOutputFolder">打开输出文件夹</button>
        <button class="aiw-ghost" type="button" @click="openSettings">去设置 1XM Key</button>
      </div>
    </header>

    <div class="aiw-param-ribbon" aria-label="生成参数">
      <label>
        <span>模型</span>
        <select v-model="form.modelId" @change="syncModelDefaults">
          <option v-for="model in AI_IMAGE_MODELS" :key="model.id" :value="model.id">{{ model.label }}</option>
        </select>
      </label>
      <label>
        <span>尺寸</span>
        <select v-model="form.size">
          <option v-for="size in AI_IMAGE_SIZES" :key="size" :value="size">{{ size }}</option>
        </select>
      </label>
      <label>
        <span>比例</span>
        <select v-model="form.ratio">
          <option v-for="ratio in AI_IMAGE_RATIOS" :key="ratio" :value="ratio">{{ ratio }}</option>
        </select>
      </label>
      <label>
        <span>质量</span>
        <select v-model="form.quality">
          <option v-for="quality in AI_IMAGE_QUALITIES" :key="quality" :value="quality">{{ quality }}</option>
        </select>
      </label>
      <label>
        <span>格式</span>
        <select v-model="form.format">
          <option v-for="format in AI_IMAGE_FORMATS" :key="format" :value="format">{{ format }}</option>
        </select>
      </label>
      <label>
        <span>张数</span>
        <input v-model.number="form.count" type="number" min="1" max="8" />
      </label>
      <label class="aiw-output-field">
        <span>输出文件夹</span>
        <input v-model.trim="form.output_dir" :placeholder="outputDirHint()" />
      </label>
      <div class="aiw-key-status" :class="{ missing: Boolean(activeMissingKey) }">
        <span>Key 状态</span>
        <strong>{{ activeMissingKey ? '未配置' : '可生成' }}</strong>
      </div>
    </div>

    <div class="aiw-main-grid" :class="{ 'history-collapsed': !historyOpen }">
      <aside class="aiw-prompt-panel">
        <div class="aiw-panel-head">
          <span>Prompt 与素材</span>
          <button type="button" @click="resetForm">重置</button>
        </div>
        <textarea v-model.trim="form.prompt" placeholder="描述商品、卖点、模特姿态、背景和禁用元素..."></textarea>

        <section class="aiw-material-box">
          <div class="aiw-panel-head">
            <span>主图</span>
            <button type="button" @click="form.mainImagePath = ''">删除</button>
          </div>
          <input v-model.trim="form.mainImagePath" placeholder="/Users/.../main.png" />
        </section>

        <section class="aiw-material-box">
          <div class="aiw-panel-head">
            <span>参考图</span>
            <button type="button" @click="addReferencePath">添加</button>
          </div>
          <div v-for="(_, index) in form.referenceImagePaths" :key="index" class="aiw-reference-row">
            <input v-model.trim="form.referenceImagePaths[index]" placeholder="/Users/.../ref.png" />
            <button type="button" @click="removeReferencePath(index)">删除</button>
          </div>
        </section>

        <section class="aiw-material-box">
          <span class="aiw-field-label">高级 JSON</span>
          <textarea v-model.trim="form.advancedJson" class="aiw-advanced-json" placeholder='{"background":"white"}'></textarea>
        </section>
      </aside>

      <main class="aiw-results-grid" aria-label="生成结果">
        <div class="aiw-workspace-head">
          <div>
            <strong>{{ currentJob?.title || '本次生成' }}</strong>
            <span>{{ summaryLine }}</span>
          </div>
          <div class="aiw-tabs">
            <button :class="{ active: workspaceMode === 'results' }" type="button" @click="workspaceMode = 'results'">结果</button>
            <button :class="{ active: workspaceMode === 'canvas' }" type="button" @click="workspaceMode = 'canvas'">画布</button>
            <button :class="{ active: workspaceMode === 'logs' }" type="button" @click="workspaceMode = 'logs'">日志</button>
          </div>
        </div>

        <section v-if="workspaceMode === 'results'" class="aiw-result-list">
          <article
            v-for="item in resultCards"
            :key="item.path || item.url"
            class="aiw-result-card"
            :class="{ selected: selectedResults.has(resultKey(item)) }"
          >
            <button class="aiw-select-toggle" type="button" @click="toggleResult(item)">
              {{ selectedResults.has(resultKey(item)) ? '已选' : '选择' }}
            </button>
            <img v-if="item.url || item.path" :src="item.url || `file://${item.path}`" :alt="item.label" />
            <div v-else class="aiw-result-preview">{{ item.label }}</div>
            <footer>
              <span>{{ item.model || activeModel.label }} · {{ item.size || form.size }}</span>
              <div>
                <button type="button" @click="saveAs([item])">另存为</button>
                <button type="button" @click="setAsMain(item)">设为主图</button>
                <button type="button" @click="addAsReference(item)">加入参考图</button>
                <button type="button" @click="sendToCanvas([item])">发送到画布</button>
              </div>
            </footer>
          </article>
          <div v-if="!resultCards.length" class="aiw-empty-state">
            <strong>等待生成结果</strong>
            <span>创建任务后，输出图会直接出现在这里。</span>
          </div>
        </section>

        <section v-else-if="workspaceMode === 'canvas'" class="aiw-canvas-stage">
          <article
            v-for="node in canvasDocument.nodes"
            :key="node.id"
            class="aiw-canvas-node"
            :class="{ selected: node.selected }"
            :style="{ left: `${node.x}px`, top: `${node.y}px` }"
            @click="node.selected = !node.selected"
          >
            <img v-if="node.url || node.path" :src="node.url || `file://${node.path}`" :alt="node.label" />
            <span>{{ node.label }}</span>
          </article>
          <div v-if="!canvasDocument.nodes.length" class="aiw-empty-state">
            <strong>画布待接入</strong>
            <span>选中结果后发送到画布，可继续设为主图或参考图。</span>
          </div>
        </section>

        <section v-else class="aiw-log-panel">
          <pre>{{ logs.join('\n') || '暂无日志' }}</pre>
        </section>
      </main>

      <aside v-show="historyOpen" class="aiw-history-drawer">
        <div class="aiw-panel-head">
          <span>历史</span>
          <button type="button" @click="loadJobs">刷新</button>
        </div>
        <ol>
          <li v-for="job in jobs" :key="job.job_uid" @click="restoreJob(job)">
            <strong>{{ job.title || job.job_uid }}</strong>
            <span>{{ job.model_key || 'gpt-image-2' }} · {{ job.status || 'draft' }}</span>
          </li>
        </ol>
      </aside>
    </div>

    <footer class="aiw-generate-footer">
      <div>
        <strong>{{ footerTitle }}</strong>
        <span>默认输出文件夹：~/Downloads/抓虾导出/AI生图；Windows：%USERPROFILE%\Downloads\抓虾导出\AI生图</span>
        <small v-if="errorMessage">{{ errorMessage }}</small>
      </div>
      <div class="aiw-footer-actions">
        <button type="button" :disabled="!selectedResultItems.length" @click="saveAs(selectedResultItems)">另存选中</button>
        <button type="button" :disabled="!selectedResultItems.length" @click="sendToCanvas(selectedResultItems)">选中到画布</button>
        <button type="button" :disabled="generating" @click="generate">{{ generateLabel }}</button>
      </div>
    </footer>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import {
  AI_IMAGE_FORMATS,
  AI_IMAGE_MODELS,
  AI_IMAGE_QUALITIES,
  AI_IMAGE_RATIOS,
  AI_IMAGE_SIZES,
  defaultAiImageForm,
  getAiImageModel,
  missingKeyForModel,
  modelIdForJob,
  outputDirHint,
} from '../utils/aiImageModels.js'
import { createCanvasDocument, insertImageNode } from '../utils/aiImageCanvas.js'

const emit = defineEmits(['open-settings'])

const form = reactive(defaultAiImageForm())
const jobs = ref([])
const settings = ref({})
const currentJob = ref(null)
const selectedResults = reactive(new Set())
const workspaceMode = ref('results')
const historyOpen = ref(true)
const generating = ref(false)
const errorMessage = ref('')
const logs = ref([])
const canvasDocument = reactive(createCanvasDocument())

const activeModel = computed(() => getAiImageModel(form.modelId))
const activeMissingKey = computed(() => missingKeyForModel(form.modelId, settings.value))
const resultCards = computed(() => collectResultCards(currentJob.value))
const selectedResultItems = computed(() => resultCards.value.filter((item) => selectedResults.has(resultKey(item))))
const footerTitle = computed(() => activeMissingKey.value ? '当前模型缺少 1XM Key' : '本地生成队列')
const generateLabel = computed(() => activeMissingKey.value ? '去设置 1XM Key' : generating.value ? '生成中...' : '开始生成')
const summaryLine = computed(() => {
  const status = currentJob.value?.status || '未开始'
  return `${activeModel.value.label} · ${form.size} · ${form.count} 张 · ${status}`
})

onMounted(async () => {
  await Promise.all([loadSettings(), loadJobs()])
})

function syncModelDefaults() {
  const model = activeModel.value
  form.model_key = model.key
  form.model_key_tier = model.keyTier
  if (model.id === 'gpt-image-4k' && form.size === '1024x1024') form.size = '4096x4096'
}

function resetForm() {
  Object.assign(form, defaultAiImageForm())
  selectedResults.clear()
  currentJob.value = null
  errorMessage.value = ''
}

function openSettings() {
  emit('open-settings', 'ai-1xm')
}

async function loadSettings() {
  try {
    settings.value = typeof window?.cs?.getSettings === 'function' ? await window.cs.getSettings() : {}
  } catch (error) {
    logs.value.push(`读取设置失败：${error.message || error}`)
    settings.value = {}
  }
}

async function loadJobs() {
  try {
    const response = await window.cs.listAiImageJobs()
    jobs.value = Array.isArray(response) ? response : response?.items || []
  } catch (error) {
    logs.value.push(`读取历史失败：${error.message || error}`)
  }
}

function parseAdvancedJson() {
  if (!form.advancedJson) return {}
  return JSON.parse(form.advancedJson)
}

function buildJobPayload() {
  const params = {
    size: form.size,
    ratio: form.ratio,
    quality: form.quality,
    response_format: form.format,
    n: Number(form.count) || 1,
    model_key_tier: activeModel.value.keyTier,
    ...parseAdvancedJson(),
  }
  return {
    title: form.title || 'AI 生图任务',
    prompt: form.prompt,
    model_key: activeModel.value.key,
    output_dir: form.output_dir,
    params,
  }
}

async function generate() {
  errorMessage.value = ''
  if (activeMissingKey.value) {
    openSettings()
    return
  }
  if (generating.value) return
  generating.value = true
  logs.value.push('创建 AI 生图任务')
  try {
    const created = await window.cs.createAiImageJob(buildJobPayload())
    const jobUid = created?.job_uid
    if (!jobUid) throw new Error('后端未返回 job_uid')
    currentJob.value = created
    await createInputAssets(jobUid)
    logs.value.push(`提交 1XM 任务：${jobUid}`)
    await window.cs.runAiImageJob(jobUid)
    const latest = await window.cs.getAiImageJob(jobUid)
    currentJob.value = latest || created
    selectedResults.clear()
    logs.value.push(`生成完成：${jobUid}`)
    await loadJobs()
  } catch (error) {
    errorMessage.value = error?.detail?.message || error?.message || String(error)
    logs.value.push(`生成失败：${errorMessage.value}`)
  } finally {
    generating.value = false
  }
}

async function createInputAssets(jobUid) {
  const calls = []
  if (form.mainImagePath) {
    calls.push(window.cs.createAiImageAsset({
      job_uid: jobUid,
      kind: 'main',
      source_type: 'local',
      path: form.mainImagePath,
      sort_order: 0,
      meta: { role: 'main' },
    }))
  }
  form.referenceImagePaths
    .map((path) => String(path || '').trim())
    .filter(Boolean)
    .forEach((path, index) => {
      calls.push(window.cs.createAiImageAsset({
        job_uid: jobUid,
        kind: 'reference',
        source_type: 'local',
        path,
        sort_order: index + 1,
        meta: { role: 'reference' },
      }))
    })
  await Promise.all(calls)
}

function collectResultCards(job) {
  const summary = job?.summary && typeof job.summary === 'object' ? job.summary : {}
  const assets = Array.isArray(job?.assets) ? job.assets : []
  const paths = Array.isArray(summary.output_files) ? summary.output_files : []
  const outputAssets = assets.filter((asset) => asset.kind === 'output' || asset.kind === 'result')
  return [
    ...paths.map((path, index) => ({
      path,
      label: `结果 ${index + 1}`,
      model: job?.model_key,
      size: job?.params?.size,
    })),
    ...outputAssets.map((asset, index) => ({
      path: asset.path || '',
      url: asset.url || '',
      label: asset.meta?.label || `输出素材 ${index + 1}`,
      model: job?.model_key,
      size: job?.params?.size,
    })),
  ].filter((item, index, list) => resultKey(item) && list.findIndex((candidate) => resultKey(candidate) === resultKey(item)) === index)
}

function resultKey(item) {
  return item?.path || item?.url || ''
}

function toggleResult(item) {
  const key = resultKey(item)
  if (!key) return
  if (selectedResults.has(key)) selectedResults.delete(key)
  else selectedResults.add(key)
}

async function saveAs(items) {
  if (!currentJob.value?.job_uid || !items.length) return
  try {
    const directory = form.output_dir
    await window.cs.saveAsAiImageJob(currentJob.value.job_uid, {
      directory,
      files: items.map(resultKey).filter(Boolean),
    })
    logs.value.push(`另存 ${items.length} 张图片到 ${directory}`)
  } catch (error) {
    errorMessage.value = error.message || String(error)
  }
}

function setAsMain(item) {
  form.mainImagePath = resultKey(item)
}

function addAsReference(item) {
  const key = resultKey(item)
  if (key && !form.referenceImagePaths.includes(key)) form.referenceImagePaths.push(key)
}

async function sendToCanvas(items) {
  if (!items.length) return
  let nextDocument = { ...canvasDocument, nodes: [...canvasDocument.nodes] }
  for (const item of items) {
    nextDocument = insertImageNode(nextDocument, {
      path: item.path || '',
      url: item.url || '',
      label: item.label,
      source: 'result',
    })
  }
  Object.assign(canvasDocument, nextDocument)
  workspaceMode.value = 'canvas'
  if (typeof window.cs.createAiImageCanvas === 'function') {
    try {
      await window.cs.createAiImageCanvas({
        job_uid: currentJob.value?.job_uid || '',
        title: `${currentJob.value?.title || 'AI 生图'} 画布`,
        canvas: JSON.parse(JSON.stringify(canvasDocument)),
      })
    } catch (error) {
      logs.value.push(`保存画布失败：${error.message || error}`)
    }
  }
}

function addReferencePath() {
  form.referenceImagePaths.push('')
}

function removeReferencePath(index) {
  form.referenceImagePaths.splice(index, 1)
}

async function restoreJob(job) {
  let detail = job
  if (job?.job_uid && typeof window.cs.getAiImageJob === 'function') {
    try {
      detail = await window.cs.getAiImageJob(job.job_uid) || job
    } catch (error) {
      logs.value.push(`读取任务详情失败：${error.message || error}`)
    }
  }
  currentJob.value = detail
  form.title = detail.title || form.title
  form.prompt = detail.prompt || ''
  form.modelId = modelIdForJob(detail)
  form.model_key = activeModel.value.key
  form.model_key_tier = activeModel.value.keyTier
  form.output_dir = detail.output_dir || form.output_dir
  if (detail.params && typeof detail.params === 'object') {
    form.size = detail.params.size || form.size
    form.ratio = detail.params.ratio || form.ratio
    form.quality = detail.params.quality || form.quality
    form.format = detail.params.response_format || form.format
    form.count = detail.params.n || form.count
  }
  selectedResults.clear()
}

function openOutputFolder() {
  if (form.output_dir && typeof window.cs.openFile === 'function') window.cs.openFile(form.output_dir)
}
</script>

<style scoped>
.aiw-workbench {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 14px;
  padding: 18px 20px;
  background: #141418;
  color: var(--text);
}

.aiw-topbar,
.aiw-param-ribbon,
.aiw-prompt-panel,
.aiw-results-grid,
.aiw-history-drawer,
.aiw-generate-footer {
  border: 1px solid #2e2e3a;
  background: #1c1c22;
}

.aiw-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 16px 18px;
  border-radius: 8px;
}

.aiw-kicker {
  margin: 0 0 6px;
  color: #ff6b2b;
  font-size: 12px;
  font-weight: 800;
}

.aiw-topbar h2 {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
}

.aiw-subtitle {
  margin: 7px 0 0;
  color: var(--text2);
  line-height: 1.5;
}

.aiw-top-actions,
.aiw-footer-actions,
.aiw-tabs,
.aiw-result-card footer div {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.aiw-param-ribbon {
  display: grid;
  grid-template-columns: minmax(170px, 1.2fr) repeat(5, minmax(92px, 0.65fr)) minmax(220px, 1.3fr) minmax(96px, 0.6fr);
  gap: 10px;
  padding: 12px;
  border-radius: 8px;
}

.aiw-param-ribbon label,
.aiw-material-box,
.aiw-generate-footer div,
.aiw-key-status {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.aiw-param-ribbon span,
.aiw-panel-head,
.aiw-generate-footer span,
.aiw-field-label,
.aiw-key-status span,
.aiw-result-card footer span,
.aiw-empty-state span {
  color: var(--text2);
  font-size: 12px;
}

.aiw-param-ribbon select,
.aiw-param-ribbon input,
.aiw-prompt-panel textarea,
.aiw-prompt-panel input {
  width: 100%;
  min-width: 0;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #141418;
  color: var(--text);
  font: inherit;
}

.aiw-param-ribbon select,
.aiw-param-ribbon input,
.aiw-prompt-panel input {
  height: 36px;
  padding: 0 10px;
}

.aiw-output-field {
  grid-column: span 1;
}

.aiw-key-status {
  justify-content: center;
  padding: 7px 10px;
  border: 1px solid rgba(70, 180, 120, 0.35);
  border-radius: 8px;
  background: rgba(70, 180, 120, 0.08);
}

.aiw-key-status.missing {
  border-color: rgba(255, 107, 43, 0.45);
  background: rgba(255, 107, 43, 0.1);
}

.aiw-key-status strong {
  font-size: 13px;
}

.aiw-main-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(320px, 360px) minmax(420px, 1fr) minmax(230px, 270px);
  gap: 14px;
}

.aiw-main-grid.history-collapsed {
  grid-template-columns: minmax(320px, 360px) minmax(420px, 1fr);
}

.aiw-prompt-panel,
.aiw-history-drawer {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-radius: 8px;
  overflow: auto;
}

.aiw-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.aiw-prompt-panel > textarea {
  min-height: 180px;
  resize: vertical;
  padding: 12px;
  line-height: 1.6;
}

.aiw-material-box {
  padding-top: 10px;
  border-top: 1px solid #2e2e3a;
}

.aiw-reference-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.aiw-advanced-json {
  min-height: 82px;
  resize: vertical;
  padding: 10px;
  line-height: 1.5;
}

.aiw-results-grid {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  overflow: hidden;
  border-radius: 8px;
}

.aiw-workspace-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.aiw-workspace-head div:first-child {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.aiw-result-list {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  overflow: auto;
}

.aiw-result-card {
  position: relative;
  min-height: 260px;
  display: flex;
  flex-direction: column;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #242430;
  overflow: hidden;
}

.aiw-result-card.selected {
  border-color: #ff6b2b;
  box-shadow: 0 0 0 1px rgba(255, 107, 43, 0.35);
}

.aiw-result-card img,
.aiw-canvas-node img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.aiw-result-card > img,
.aiw-result-preview {
  flex: 1;
  min-height: 190px;
  background: #17181d;
}

.aiw-result-preview {
  display: grid;
  place-items: center;
  color: var(--text3);
  font-size: 24px;
  font-weight: 800;
}

.aiw-select-toggle {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1;
}

.aiw-result-card footer,
.aiw-generate-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.aiw-result-card footer {
  padding: 10px;
}

.aiw-result-card footer div {
  justify-content: flex-end;
}

.aiw-history-drawer ol {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.aiw-history-drawer li {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 11px;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #242430;
  cursor: pointer;
}

.aiw-canvas-stage {
  position: relative;
  min-height: 0;
  flex: 1;
  overflow: auto;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #141418;
}

.aiw-canvas-node {
  position: absolute;
  width: 180px;
  height: 210px;
  display: flex;
  flex-direction: column;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #242430;
  overflow: hidden;
  cursor: pointer;
}

.aiw-canvas-node.selected {
  border-color: #ff6b2b;
}

.aiw-canvas-node span {
  padding: 7px;
  font-size: 12px;
}

.aiw-log-panel {
  min-height: 0;
  flex: 1;
  overflow: auto;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #141418;
}

.aiw-log-panel pre {
  margin: 0;
  padding: 12px;
  white-space: pre-wrap;
  color: var(--text2);
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
}

.aiw-empty-state {
  min-height: 220px;
  display: grid;
  place-content: center;
  gap: 8px;
  text-align: center;
  border: 1px dashed #2e2e3a;
  border-radius: 8px;
  background: #17181d;
}

.aiw-generate-footer {
  padding: 12px 14px;
  border-radius: 8px;
}

.aiw-generate-footer small {
  color: #ff8b5f;
}

button {
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #242430;
  color: var(--text);
  font: inherit;
  font-weight: 700;
  padding: 8px 12px;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

button.active,
.aiw-footer-actions button:last-child,
.aiw-ghost {
  border-color: rgba(255, 107, 43, 0.35);
  background: rgba(255, 107, 43, 0.1);
  color: #ff6b2b;
}

.aiw-ghost {
  flex: 0 0 auto;
}

@media (max-width: 1180px) {
  .aiw-param-ribbon,
  .aiw-main-grid,
  .aiw-main-grid.history-collapsed,
  .aiw-result-list {
    grid-template-columns: 1fr;
  }

  .aiw-topbar,
  .aiw-generate-footer,
  .aiw-workspace-head {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
