<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { apiGet, apiPost, type ApiError } from '../api'

interface BatchRow { batch_uid: string; title: string; status: string }
interface AssetRow { asset_uid: string; style_id: number; kind: string; status: string; filename: string; prompt_text: string; parent_asset_uid?: string | null }
interface ImageResourceRow {
  resource_uid: string
  batch_uid: string
  style_code: string
  item_id: string
  kind: string
  asset_uid: string
  object_key: string
  filename: string
  source_label: string
}
interface StyleRow { id: number; style_code: string; item_id: string; category: string; gender: string; assets: AssetRow[]; image_resources?: ImageResourceRow[] }
interface DispatchJob {
  job_uid: string
  job_type: string
  status: string
  assigned_machine_id: string | null
  payload?: Record<string, unknown>
  result?: Record<string, unknown>
}
interface BatchDetail { batch_uid: string; title: string; status: string; styles: StyleRow[]; jobs?: DispatchJob[] }
interface MachineRow { machine_id: string; machine_name: string; auth_status: string; health: string; capabilities_json: string }
interface PromptLibrary { id: number; name: string; status: string }
interface PromptTemplate { id: number; template_id?: number; version_id?: number; prompt_text: string; field_name?: string; group_name?: string }
interface SelectableResource {
  resource_uid: string
  kind: string
  asset_uid: string
  filename: string
  source_label: string
}

const modelOptions = [
  { value: 'gpt-image-2', label: 'GPT Image 2' },
  { value: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image' },
  { value: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image' },
]
const sizeOptions = ['1:1', '3:4', '4:3', '16:9', '9:16', '1024x1024', '1536x1024', '1024x1536', '2048x2048', '4096x4096']
const qualityOptions = ['auto', 'low', 'medium', 'high', 'standard', '1K', '2K', '4K']
const formatOptions = ['png', 'jpg', 'webp']

const batches = ref<BatchRow[]>([])
const batchUid = ref('')
const batch = ref<BatchDetail | null>(null)
const selectedStyleId = ref<number | null>(null)
const sourceAssetUid = ref('')
const referenceAssetUids = ref<string[]>([])
const machines = ref<MachineRow[]>([])
const selectedMachineId = ref('')
const promptLibraries = ref<PromptLibrary[]>([])
const selectedLibraryId = ref<number | null>(null)
const promptTemplates = ref<PromptTemplate[]>([])
const selectedTemplateKey = ref('')
const promptText = ref('')
const model = ref('gpt-image-2')
const size = ref('1024x1024')
const quality = ref('auto')
const outputFormat = ref('png')
const count = ref(1)
const message = ref('')
const error = ref('')
const submitting = ref(false)

const styles = computed(() => batch.value?.styles ?? [])
const selectedStyle = computed(() => styles.value.find((style) => style.id === selectedStyleId.value) ?? styles.value[0] ?? null)
const aiAssets = computed(() => selectedStyle.value?.assets.filter((asset) => asset.kind === 'ai') ?? [])
const sourceAssets = computed(() => selectedStyle.value?.assets.filter((asset) => ['source', 'reference'].includes(asset.kind) && asset.status === 'uploaded') ?? [])
const sourceResources = computed(() => selectedStyle.value?.image_resources?.filter((resource) => ['source', 'reference'].includes(resource.kind)) ?? [])
const selectableResources = computed<SelectableResource[]>(() => {
  if (sourceResources.value.length > 0) {
    return sourceResources.value.map((resource) => ({
      resource_uid: resource.resource_uid,
      kind: resource.kind,
      asset_uid: resource.asset_uid,
      filename: resource.filename,
      source_label: resource.source_label,
    }))
  }
  return sourceAssets.value.map((asset) => ({
    resource_uid: asset.asset_uid,
    kind: asset.kind,
    asset_uid: asset.asset_uid,
    filename: asset.filename,
    source_label: '',
  }))
})
const generationMachines = computed(() => machines.value.filter((machine) => machine.auth_status === 'active' && hasCapability(machine, 'generate_ai_image')))
const generationJobs = computed(() => (batch.value?.jobs ?? []).filter((job) => job.job_type === 'generate_ai_image'))
const selectedStyleJobs = computed(() => generationJobs.value.filter((job) => String(job.payload?.style_id ?? '') === String(selectedStyle.value?.id ?? '')))
const canSubmit = computed(() => Boolean(batch.value && selectedStyle.value && sourceAssetUid.value && promptText.value.trim() && !submitting.value))
const selectedTemplateVersionId = computed(() => {
  const template = promptTemplates.value.find((item) => templateKey(item) === selectedTemplateKey.value)
  return Number(template?.version_id ?? template?.id) || null
})

watch(batchUid, () => {
  void loadBatch()
})

watch(selectedStyleId, () => {
  resetMaterialSelection()
  void loadResolvedPrompts()
})

watch(selectedLibraryId, () => {
  void loadResolvedPrompts()
})

watch(selectedTemplateKey, () => {
  const template = promptTemplates.value.find((item) => templateKey(item) === selectedTemplateKey.value)
  if (template?.prompt_text) promptText.value = template.prompt_text
})

async function loadBatches() {
  try {
    const data = await apiGet<{ batches: BatchRow[] }>('/api/ai-image-batches')
    batches.value = data.batches
    batchUid.value ||= data.batches[0]?.batch_uid ?? ''
    if (batchUid.value) await loadBatch()
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function loadBatch() {
  if (!batchUid.value) return
  error.value = ''
  try {
    const previousStyleId = selectedStyleId.value
    const data = await apiGet<{ batch: BatchDetail }>(`/api/ai-image-batches/${encodeURIComponent(batchUid.value)}`)
    batch.value = data.batch
    selectedStyleId.value = data.batch.styles.some((style) => style.id === previousStyleId) ? previousStyleId : data.batch.styles[0]?.id ?? null
    resetMaterialSelection()
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function loadMachines() {
  try {
    const data = await apiGet<{ machines: MachineRow[] }>('/api/admin/machines')
    machines.value = data.machines
  } catch {
    machines.value = []
  }
}

async function loadPromptLibraries() {
  try {
    const data = await apiGet<{ libraries: PromptLibrary[] }>('/api/prompt-libraries')
    promptLibraries.value = data.libraries.filter((library) => library.status === 'published')
    selectedLibraryId.value = promptLibraries.value[0]?.id ?? null
  } catch {
    promptLibraries.value = []
  }
}

async function loadResolvedPrompts() {
  if (!selectedLibraryId.value || !selectedStyle.value) {
    promptTemplates.value = []
    selectedTemplateKey.value = ''
    return
  }
  const params = new URLSearchParams()
  if (selectedStyle.value.category) params.set('category', selectedStyle.value.category)
  if (selectedStyle.value.gender) params.set('gender', selectedStyle.value.gender)
  if (selectedStyle.value.style_code) params.set('style_code', selectedStyle.value.style_code)
  if (selectedStyle.value.item_id) params.set('item_id', selectedStyle.value.item_id)
  try {
    const data = await apiGet<{ templates: PromptTemplate[] }>(`/api/prompt-libraries/${selectedLibraryId.value}/resolved?${params.toString()}`)
    promptTemplates.value = data.templates
    selectedTemplateKey.value = templateKey(data.templates[0])
  } catch {
    promptTemplates.value = []
    selectedTemplateKey.value = ''
  }
}

function templateKey(template?: PromptTemplate): string {
  if (!template) return ''
  return String(template.version_id ?? template.id ?? template.template_id ?? '')
}

function templateLabel(template: PromptTemplate): string {
  const group = template.group_name ? `${template.group_name} / ` : ''
  return `${group}${template.field_name || `模板 ${templateKey(template)}`}`
}

function resetMaterialSelection() {
  const source = selectableResources.value.find((resource) => resource.kind === 'source') ?? selectableResources.value[0]
  sourceAssetUid.value = source?.asset_uid ?? ''
  referenceAssetUids.value = selectableResources.value
    .filter((resource) => resource.asset_uid !== sourceAssetUid.value)
    .slice(0, 3)
    .map((resource) => resource.asset_uid)
}

function selectSource(assetUid: string) {
  sourceAssetUid.value = assetUid
  referenceAssetUids.value = referenceAssetUids.value.filter((uid) => uid !== assetUid)
}

function toggleReference(assetUid: string) {
  if (assetUid === sourceAssetUid.value) return
  referenceAssetUids.value = referenceAssetUids.value.includes(assetUid)
    ? referenceAssetUids.value.filter((uid) => uid !== assetUid)
    : [...referenceAssetUids.value, assetUid]
}

function assetDownloadUrl(asset: AssetRow | SelectableResource): string {
  return `/api/assets/${encodeURIComponent(asset.asset_uid)}/download`
}

function isPreviewable(item: Pick<AssetRow | SelectableResource, 'filename'>): boolean {
  return /\.(jpe?g|png|webp|gif)$/i.test(item.filename)
}

function hasCapability(machine: MachineRow, capability: string): boolean {
  try {
    const parsed = JSON.parse(machine.capabilities_json)
    return Array.isArray(parsed) && parsed.includes(capability)
  } catch {
    return machine.capabilities_json.includes(capability)
  }
}

function kindLabel(kind: string): string {
  if (kind === 'source') return '主图'
  if (kind === 'reference') return '参考图'
  if (kind === 'ai') return 'AI 图'
  return kind || '-'
}

function statusLabel(status: string): string {
  if (status === 'queued') return '排队中'
  if (status === 'leased') return '已领取'
  if (status === 'running') return '生成中'
  if (status === 'uploading_results') return '上传结果'
  if (status === 'succeeded') return '已完成'
  if (status === 'failed' || status === 'terminal_failed') return '失败'
  return status || '-'
}

function jobSummary(job: DispatchJob): string {
  const payload = job.payload ?? {}
  const parts = [
    payload.model,
    payload.size,
    payload.quality,
    payload.output_format,
    payload.count ? `${payload.count} 张` : '',
  ].filter(Boolean)
  return parts.join(' / ') || '使用默认参数'
}

function resultAssetUids(job: DispatchJob): string[] {
  const value = job.result?.generated_asset_uids
  return Array.isArray(value) ? value.map(String) : []
}

async function submitGeneration() {
  if (!batch.value || !selectedStyle.value || !sourceAssetUid.value || !promptText.value.trim()) return
  error.value = ''
  message.value = ''
  submitting.value = true
  try {
    await apiPost(`/api/ai-image-batches/${encodeURIComponent(batch.value.batch_uid)}/generate`, {
      style_id: selectedStyle.value.id,
      source_asset_uid: sourceAssetUid.value,
      reference_asset_uids: referenceAssetUids.value,
      prompt_template_version_id: selectedTemplateVersionId.value,
      prompt_text: promptText.value.trim(),
      machine_id: selectedMachineId.value || undefined,
      model: model.value,
      size: size.value,
      quality: quality.value,
      output_format: outputFormat.value,
      count: Math.max(1, Math.min(8, Number(count.value) || 1)),
    })
    message.value = '在线生图任务已创建'
    await loadBatch()
  } catch (caught) {
    error.value = (caught as ApiError).message
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  void loadBatches()
  void loadMachines()
  void loadPromptLibraries()
})
</script>

<template>
  <section class="cloud-aiw-shell">
    <header class="cloud-aiw-header">
      <div>
        <p class="section-kicker">在线 AI 生图</p>
        <h2>AI 生图工作台</h2>
        <p>支持主图、参考图、Prompt、自定义尺寸和多模型生成</p>
      </div>
      <button class="ghost-button" type="button" @click="loadBatch">刷新</button>
    </header>

    <p v-if="message" class="notice">{{ message }}</p>
    <p v-if="error" class="notice danger">{{ error }}</p>

    <section class="cloud-aiw-param-ribbon" aria-label="生成参数">
      <label class="field">
        <span>批次</span>
        <select v-model="batchUid">
          <option v-for="item in batches" :key="item.batch_uid" :value="item.batch_uid">{{ item.title }}</option>
        </select>
      </label>
      <label class="field">
        <span>款式</span>
        <select v-model.number="selectedStyleId">
          <option v-for="style in styles" :key="style.id" :value="style.id">{{ style.style_code || `款式 ${style.id}` }} / {{ style.item_id || '-' }}</option>
        </select>
      </label>
      <label class="field">
        <span>模型</span>
        <select v-model="model">
          <option v-for="item in modelOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </label>
      <label class="field">
        <span>尺寸</span>
        <select v-model="size">
          <option v-for="item in sizeOptions" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label class="field">
        <span>质量</span>
        <select v-model="quality">
          <option v-for="item in qualityOptions" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label class="field">
        <span>格式</span>
        <select v-model="outputFormat">
          <option v-for="item in formatOptions" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label class="field count-field">
        <span>张数</span>
        <input v-model.number="count" type="number" min="1" max="8" />
      </label>
      <label class="field machine-field">
        <span>任务机</span>
        <select v-model="selectedMachineId">
          <option value="">任意生图任务机</option>
          <option v-for="machine in generationMachines" :key="machine.machine_id" :value="machine.machine_id">{{ machine.machine_name }} / {{ machine.health }}</option>
        </select>
      </label>
    </section>

    <section v-if="batch" class="cloud-aiw-workspace">
      <aside class="cloud-aiw-prompt-panel">
        <div class="cloud-aiw-panel-head">
          <h3>Prompt 与素材</h3>
          <span class="badge">{{ selectedStyle?.category || '-' }} / {{ selectedStyle?.gender || '-' }}</span>
        </div>

        <label class="field">
          <span>Prompt 库</span>
          <select v-model="selectedLibraryId">
            <option v-for="library in promptLibraries" :key="library.id" :value="library.id">{{ library.name }}</option>
          </select>
        </label>
        <label class="field">
          <span>Prompt 模板</span>
          <select v-model="selectedTemplateKey">
            <option v-for="template in promptTemplates" :key="templateKey(template)" :value="templateKey(template)">{{ templateLabel(template) }}</option>
          </select>
        </label>
        <label class="field">
          <span>Prompt</span>
          <textarea v-model="promptText" rows="9" placeholder="选择 Prompt 模板后可继续编辑"></textarea>
        </label>

        <div class="cloud-aiw-materials">
          <div class="cloud-aiw-panel-head">
            <h3>主图 / 参考图</h3>
            <span class="muted">{{ selectableResources.length }} 个资源</span>
          </div>
          <p v-if="selectableResources.length === 0" class="cloud-aiw-empty">当前款式还没有可用于生图的来源资源。</p>
          <article
            v-for="resource in selectableResources"
            :key="resource.resource_uid"
            class="cloud-aiw-resource-card"
            :class="{ source: sourceAssetUid === resource.asset_uid, reference: referenceAssetUids.includes(resource.asset_uid) }"
          >
            <button class="cloud-aiw-thumb-button" type="button" @click="selectSource(resource.asset_uid)">
              <img v-if="isPreviewable(resource)" :src="assetDownloadUrl(resource)" :alt="resource.filename" />
              <span v-else>{{ kindLabel(resource.kind) }}</span>
            </button>
            <div>
              <strong>{{ resource.source_label || kindLabel(resource.kind) }}</strong>
              <span>{{ resource.filename }}</span>
              <div class="cloud-aiw-resource-actions">
                <button class="small-button" type="button" @click="selectSource(resource.asset_uid)">设为主图</button>
                <button
                  class="small-button"
                  type="button"
                  :disabled="sourceAssetUid === resource.asset_uid"
                  @click="toggleReference(resource.asset_uid)"
                >
                  {{ referenceAssetUids.includes(resource.asset_uid) ? '取消参考' : '设为参考' }}
                </button>
                <a class="small-button" :href="assetDownloadUrl(resource)" target="_blank" rel="noopener">下载</a>
              </div>
            </div>
          </article>
        </div>
      </aside>

      <main class="cloud-aiw-results-grid">
        <div class="cloud-aiw-panel-head">
          <div>
            <h3>{{ selectedStyle?.style_code || '当前款式' }} 结果</h3>
            <p class="muted">{{ selectedStyle?.item_id || '未选择款式' }}</p>
          </div>
          <span class="badge">{{ aiAssets.length }} 张 AI 图</span>
        </div>

        <div class="cloud-aiw-result-list">
          <article v-for="asset in aiAssets" :key="asset.asset_uid" class="cloud-aiw-result-card">
            <a class="cloud-aiw-result-image" :href="assetDownloadUrl(asset)" target="_blank" rel="noopener">
              <img v-if="isPreviewable(asset)" :src="assetDownloadUrl(asset)" :alt="asset.filename" />
              <span v-else>{{ asset.filename }}</span>
            </a>
            <div class="cloud-aiw-result-meta">
              <strong>{{ asset.filename }}</strong>
              <span class="badge">{{ statusLabel(asset.status) }}</span>
            </div>
            <p v-if="asset.prompt_text">{{ asset.prompt_text }}</p>
          </article>

          <article v-for="job in selectedStyleJobs" :key="job.job_uid" class="cloud-aiw-result-card queued">
            <div class="cloud-aiw-job-placeholder">
              <span class="badge">{{ statusLabel(job.status) }}</span>
              <strong>{{ jobSummary(job) }}</strong>
              <small>{{ resultAssetUids(job).length ? `已回传 ${resultAssetUids(job).length} 张结果` : job.job_uid }}</small>
            </div>
          </article>

          <p v-if="aiAssets.length === 0 && selectedStyleJobs.length === 0" class="cloud-aiw-empty">选择左侧素材与 Prompt 后创建任务，结果会在这里按款式聚合。</p>
        </div>
      </main>

      <aside class="cloud-aiw-history-drawer">
        <div class="cloud-aiw-panel-head">
          <h3>生成历史</h3>
          <span class="badge">{{ generationJobs.length }}</span>
        </div>
        <article v-for="job in generationJobs" :key="job.job_uid" class="cloud-aiw-history-item">
          <div>
            <strong>{{ statusLabel(job.status) }}</strong>
            <span>{{ jobSummary(job) }}</span>
          </div>
          <small>{{ job.job_uid }}</small>
          <p>款式 {{ job.payload?.style_code || job.payload?.style_id || '-' }} · 任务机 {{ job.assigned_machine_id || '任意' }}</p>
        </article>
        <p v-if="generationJobs.length === 0" class="cloud-aiw-empty">暂无在线生图任务。</p>
      </aside>
    </section>

    <section v-else class="cloud-aiw-empty cloud-aiw-loading">正在加载在线生图批次...</section>

    <footer class="cloud-aiw-generate-footer">
      <div>
        <strong>{{ selectedStyle?.style_code || '未选择款式' }}</strong>
        <span>{{ model }} · {{ size }} · {{ quality }} · {{ outputFormat }} · {{ Math.max(1, Math.min(8, Number(count) || 1)) }} 张</span>
      </div>
      <button class="primary-button" type="button" :disabled="!canSubmit" @click="submitGeneration">
        {{ submitting ? '创建中...' : '创建在线生图任务' }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.cloud-aiw-shell {
  display: grid;
  gap: 12px;
  padding-bottom: 72px;
}

.cloud-aiw-header,
.cloud-aiw-param-ribbon,
.cloud-aiw-prompt-panel,
.cloud-aiw-results-grid,
.cloud-aiw-history-drawer,
.cloud-aiw-generate-footer {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
}

.cloud-aiw-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
}

.cloud-aiw-header h2,
.cloud-aiw-panel-head h3 {
  margin: 0;
  font-size: 16px;
}

.cloud-aiw-header p {
  margin: 4px 0 0;
  color: var(--text2);
  font-size: 13px;
}

.cloud-aiw-param-ribbon {
  display: grid;
  grid-template-columns: minmax(180px, 1.3fr) minmax(180px, 1.2fr) repeat(5, minmax(98px, 0.7fr)) minmax(180px, 1fr);
  gap: 10px;
  padding: 12px;
}

.cloud-aiw-param-ribbon .field,
.cloud-aiw-prompt-panel .field {
  gap: 5px;
}

.cloud-aiw-param-ribbon .field > span,
.cloud-aiw-prompt-panel .field > span {
  color: var(--text2);
  font-size: 12px;
  font-weight: 800;
}

.count-field input {
  min-width: 76px;
}

.cloud-aiw-workspace {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(360px, 1.5fr) minmax(260px, 0.8fr);
  gap: 12px;
  align-items: start;
}

.cloud-aiw-prompt-panel,
.cloud-aiw-results-grid,
.cloud-aiw-history-drawer {
  display: grid;
  gap: 12px;
  min-height: 560px;
  padding: 12px;
}

.cloud-aiw-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.cloud-aiw-panel-head p,
.cloud-aiw-result-card p {
  margin: 4px 0 0;
}

.cloud-aiw-materials,
.cloud-aiw-result-list,
.cloud-aiw-history-drawer {
  align-content: start;
}

.cloud-aiw-resource-card,
.cloud-aiw-result-card,
.cloud-aiw-history-item {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}

.cloud-aiw-resource-card {
  display: grid;
  grid-template-columns: 76px 1fr;
  gap: 10px;
  margin-top: 8px;
  padding: 8px;
}

.cloud-aiw-resource-card.source {
  border-color: rgba(255, 107, 43, 0.8);
  box-shadow: inset 0 0 0 1px rgba(255, 107, 43, 0.28);
}

.cloud-aiw-resource-card.reference {
  background: rgba(255, 107, 43, 0.08);
}

.cloud-aiw-thumb-button,
.cloud-aiw-result-image,
.cloud-aiw-job-placeholder {
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #101015;
  color: var(--text2);
}

.cloud-aiw-thumb-button {
  width: 76px;
  height: 86px;
  padding: 0;
}

.cloud-aiw-thumb-button img,
.cloud-aiw-result-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cloud-aiw-resource-card strong,
.cloud-aiw-result-card strong,
.cloud-aiw-history-item strong {
  display: block;
  font-size: 13px;
}

.cloud-aiw-resource-card span,
.cloud-aiw-result-card p,
.cloud-aiw-history-item span,
.cloud-aiw-history-item p,
.cloud-aiw-history-item small,
.cloud-aiw-job-placeholder small {
  color: var(--text2);
  font-size: 12px;
}

.cloud-aiw-resource-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.cloud-aiw-result-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}

.cloud-aiw-result-card {
  display: grid;
  gap: 8px;
  padding: 8px;
}

.cloud-aiw-result-image,
.cloud-aiw-job-placeholder {
  min-height: 180px;
  text-decoration: none;
}

.cloud-aiw-job-placeholder {
  gap: 8px;
  padding: 16px;
  border-style: dashed;
  text-align: center;
}

.cloud-aiw-result-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.cloud-aiw-history-drawer {
  max-height: 680px;
  overflow: auto;
}

.cloud-aiw-history-item {
  display: grid;
  gap: 6px;
  padding: 10px;
}

.cloud-aiw-history-item + .cloud-aiw-history-item {
  margin-top: 8px;
}

.cloud-aiw-empty {
  margin: 0;
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 14px;
  color: var(--text2);
  font-size: 13px;
}

.cloud-aiw-loading {
  background: var(--bg2);
}

.cloud-aiw-generate-footer {
  position: sticky;
  bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 12px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
}

.cloud-aiw-generate-footer div {
  display: grid;
  gap: 2px;
}

.cloud-aiw-generate-footer span {
  color: var(--text2);
  font-size: 12px;
}

@media (max-width: 1180px) {
  .cloud-aiw-param-ribbon,
  .cloud-aiw-workspace {
    grid-template-columns: 1fr 1fr;
  }

  .cloud-aiw-results-grid,
  .cloud-aiw-history-drawer {
    grid-column: 1 / -1;
  }
}

@media (max-width: 760px) {
  .cloud-aiw-header,
  .cloud-aiw-generate-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .cloud-aiw-param-ribbon,
  .cloud-aiw-workspace {
    grid-template-columns: 1fr;
  }
}
</style>
