<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { apiGet, apiPatch, apiPost, type ApiError } from '../api'

interface AssetRow {
  asset_uid: string
  style_id: number
  kind: string
  status: string
  filename: string
  prompt_text: string
  parent_asset_uid: string | null
}

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

interface DispatchJob {
  job_uid: string
  job_type: string
  status: string
  payload?: Record<string, unknown>
}

interface StyleRow {
  id: number
  style_code: string
  item_id: string
  skc_code: string
  category: string
  gender: string
  status: string
  missing_prompt_reason: string
  assets: AssetRow[]
  image_resources?: ImageResourceRow[]
}

interface BatchDetail {
  batch_uid: string
  title: string
  status: string
  styles: StyleRow[]
  jobs?: DispatchJob[]
}

interface MachineRow {
  machine_id: string
  machine_name: string
  auth_status: string
  health: string
  last_seen_at: string | null
  capabilities_json: string
}

interface ReviewStats {
  total: number
  approved: number
  rejected: number
  pending: number
}

const props = defineProps<{ initialBatchUid?: string }>()

const batchUid = ref(props.initialBatchUid || '')
const batch = ref<BatchDetail | null>(null)
const machines = ref<MachineRow[]>([])
const selectedStyleId = ref<number | null>(null)
const selectedAssetUid = ref('')
const selectedAssetUids = ref<string[]>([])
const selectedResourceUids = ref<string[]>([])
const selectedMachineId = ref('')
const message = ref('')
const error = ref('')
const promptOverrides = ref<Record<string, string>>({})
const manualKind = ref<'source' | 'reference' | 'ai'>('reference')
const manualFile = ref<File | null>(null)
const manualUploading = ref(false)

const styles = computed(() => batch.value?.styles ?? [])
const selectedStyle = computed(() => styles.value.find((style) => style.id === selectedStyleId.value) ?? styles.value[0] ?? null)
const aiAssets = computed(() => selectedStyle.value?.assets.filter((asset) => asset.kind === 'ai') ?? [])
const sourceAssets = computed(() => selectedStyle.value?.assets.filter((asset) => ['source', 'reference'].includes(asset.kind)) ?? [])
const imageResources = computed(() => selectedStyle.value?.image_resources ?? [])
const sourceImageResources = computed(() => imageResources.value.filter((resource) => resource.kind !== 'ai'))
const rejectedAssets = computed(() => batch.value?.styles.flatMap((style) => style.assets).filter((asset) => asset.kind === 'ai' && asset.status === 'rejected') ?? [])
const selectedAsset = computed(() => {
  const assets = selectedStyle.value?.assets ?? []
  return assets.find((asset) => asset.asset_uid === selectedAssetUid.value)
    ?? aiAssets.value[0]
    ?? sourceAssets.value[0]
    ?? null
})
const selectedAssetJobs = computed(() => selectedAsset.value ? jobsForAsset(selectedAsset.value) : [])
const batchStats = computed(() => {
  const allAiAssets = styles.value.flatMap((style) => style.assets).filter((asset) => asset.kind === 'ai')
  return reviewStats(allAiAssets)
})
const submitMachines = computed(() => machines.value.filter((machine) => machine.auth_status === 'active' && machine.health && ['online_idle', 'online_busy'].includes(machine.health) && isFresh(machine.last_seen_at) && machine.capabilities_json.includes('submit_tmall_material_test')))

watch(() => props.initialBatchUid, (value) => {
  if (value) {
    batchUid.value = value
    void loadBatch()
  }
})

watch(selectedStyleId, () => {
  selectedResourceUids.value = []
  selectedAssetUids.value = []
  const style = selectedStyle.value
  if (!style?.assets.some((asset) => asset.asset_uid === selectedAssetUid.value)) {
    selectedAssetUid.value = defaultAssetUid(style)
  }
})

async function loadBatch(preferred: { styleId?: number | null; assetUid?: string } = {}) {
  if (!batchUid.value) return
  error.value = ''
  try {
    const data = await apiGet<{ batch: BatchDetail }>(`/api/ai-image-batches/${encodeURIComponent(batchUid.value)}`)
    batch.value = data.batch
    const nextStyleId = preferred.styleId && data.batch.styles.some((style) => style.id === preferred.styleId)
      ? preferred.styleId
      : data.batch.styles[0]?.id ?? null
    const nextStyle = data.batch.styles.find((style) => style.id === nextStyleId) ?? data.batch.styles[0] ?? null
    selectedStyleId.value = nextStyleId
    selectedAssetUid.value = preferred.assetUid && nextStyle?.assets.some((asset) => asset.asset_uid === preferred.assetUid)
      ? preferred.assetUid
      : defaultAssetUid(nextStyle)
    selectedAssetUids.value = []
    selectedResourceUids.value = []
    promptOverrides.value = Object.fromEntries(data.batch.styles.flatMap((style) => style.assets.filter((asset) => asset.kind === 'ai').map((asset) => [asset.asset_uid, asset.prompt_text || ''])))
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function loadMachines() {
  try {
    const data = await apiGet<{ machines: MachineRow[] }>('/api/admin/machines')
    machines.value = data.machines
    selectedMachineId.value = submitMachines.value[0]?.machine_id ?? ''
  } catch {
    machines.value = []
  }
}

function selectStyle(style: StyleRow) {
  selectedStyleId.value = style.id
  selectedAssetUid.value = defaultAssetUid(style)
}

function selectAsset(asset: AssetRow) {
  selectedAssetUid.value = asset.asset_uid
}

function defaultAssetUid(style: StyleRow | null): string {
  return style?.assets.find((asset) => asset.kind === 'ai')?.asset_uid ?? style?.assets[0]?.asset_uid ?? ''
}

function reviewStats(assets: AssetRow[]): ReviewStats {
  const aiRows = assets.filter((asset) => asset.kind === 'ai')
  return {
    total: aiRows.length,
    approved: aiRows.filter((asset) => asset.status === 'approved').length,
    rejected: aiRows.filter((asset) => asset.status === 'rejected').length,
    pending: aiRows.filter((asset) => !['approved', 'rejected', 'submitted'].includes(asset.status)).length,
  }
}

function statsForStyle(style: StyleRow): ReviewStats {
  return reviewStats(style.assets)
}

function styleStateClass(style: StyleRow): string {
  const stats = statsForStyle(style)
  if (stats.total === 0) return 'empty'
  if (stats.pending > 0) return 'pending'
  if (stats.approved > 0) return 'approved'
  return 'rejected'
}

function toggleAsset(asset: AssetRow) {
  selectAsset(asset)
  if (selectedAssetUids.value.includes(asset.asset_uid)) {
    selectedAssetUids.value = selectedAssetUids.value.filter((assetUid) => assetUid !== asset.asset_uid)
  } else {
    selectedAssetUids.value = [...selectedAssetUids.value, asset.asset_uid]
  }
}

function toggleResource(resource: ImageResourceRow) {
  if (selectedResourceUids.value.includes(resource.resource_uid)) {
    selectedResourceUids.value = selectedResourceUids.value.filter((resourceUid) => resourceUid !== resource.resource_uid)
  } else {
    selectedResourceUids.value = [...selectedResourceUids.value, resource.resource_uid]
  }
}

async function decide(asset: AssetRow, decision: 'approved' | 'rejected' | 'pending') {
  if (!batch.value) return
  try {
    await apiPatch(`/api/ai-image-batches/${encodeURIComponent(batch.value.batch_uid)}/assets/${encodeURIComponent(asset.asset_uid)}/decision`, { decision })
    message.value = `${asset.filename} 已标记为 ${decisionLabel(decision)}`
    await loadBatch({ styleId: selectedStyleId.value, assetUid: asset.asset_uid })
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function regenerateSelected() {
  if (!batch.value || selectedAssetUids.value.length === 0) return
  try {
    const overrides = Object.fromEntries(selectedAssetUids.value.map((assetUid) => [assetUid, promptOverrides.value[assetUid] || '']).filter(([, prompt]) => String(prompt).trim()))
    await apiPost(`/api/ai-image-batches/${encodeURIComponent(batch.value.batch_uid)}/regenerate`, { asset_uids: selectedAssetUids.value, prompt_overrides: overrides })
    message.value = '重生图任务已创建，已使用当前 Prompt 覆盖文本'
    await loadBatch({ styleId: selectedStyleId.value, assetUid: selectedAssetUid.value })
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function regenerateRejected() {
  if (!batch.value || rejectedAssets.value.length === 0) return
  try {
    await apiPost(`/api/ai-image-batches/${encodeURIComponent(batch.value.batch_uid)}/regenerate-rejected`, { prompt_overrides: promptOverrides.value })
    message.value = `已创建 ${rejectedAssets.value.length} 个舍弃图重跑任务`
    await loadBatch({ styleId: selectedStyleId.value, assetUid: selectedAssetUid.value })
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function regenerateOne(asset: AssetRow) {
  selectedAssetUids.value = [asset.asset_uid]
  await regenerateSelected()
}

async function markReady() {
  if (!batch.value) return
  try {
    await apiPost(`/api/ai-image-batches/${encodeURIComponent(batch.value.batch_uid)}/mark-ready`)
    message.value = '已重新计算批次可提交状态'
    await loadBatch({ styleId: selectedStyleId.value, assetUid: selectedAssetUid.value })
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function submitJob() {
  if (!batch.value || !selectedMachineId.value) return
  try {
    await apiPost(`/api/ai-image-batches/${encodeURIComponent(batch.value.batch_uid)}/submit`, { machine_id: selectedMachineId.value })
    message.value = '提交创建测图任务已派发'
    await loadBatch({ styleId: selectedStyleId.value, assetUid: selectedAssetUid.value })
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

function assetDownloadUrl(asset: AssetRow): string {
  return `/api/assets/${encodeURIComponent(asset.asset_uid)}/download`
}

function resourceDownloadUrl(resource: ImageResourceRow): string {
  return `/api/assets/${encodeURIComponent(resource.asset_uid)}/download`
}

function isPreviewable(asset: Pick<AssetRow | ImageResourceRow, 'filename'>): boolean {
  return /\.(jpe?g|png|webp|gif)$/i.test(asset.filename)
}

function onManualFile(event: Event) {
  const target = event.target as HTMLInputElement
  manualFile.value = target.files?.[0] ?? null
}

async function uploadManualAsset() {
  if (!batch.value || !selectedStyle.value || !manualFile.value) return
  manualUploading.value = true
  error.value = ''
  try {
    const file = manualFile.value
    const assetUid = `manual-${manualKind.value}-${Date.now().toString(36)}`
    const plan = await apiPost<{ upload_url: string }>(`/api/ai-image-batches/${encodeURIComponent(batch.value.batch_uid)}/manual-assets`, {
      style_id: selectedStyle.value.id,
      asset_uid: assetUid,
      kind: manualKind.value,
      filename: file.name,
      prompt_text: manualKind.value === 'ai' ? '' : undefined,
      meta: { source: 'manual_upload' },
    })
    const response = await fetch(plan.upload_url, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!response.ok) throw { status: response.status, message: response.statusText || '上传失败' } satisfies ApiError
    message.value = `${file.name} 已上传`
    manualFile.value = null
    await loadBatch({ styleId: selectedStyleId.value, assetUid })
  } catch (caught) {
    error.value = (caught as ApiError).message
  } finally {
    manualUploading.value = false
  }
}

function isFresh(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false
  const timestamp = Date.parse(lastSeenAt)
  return Number.isFinite(timestamp) && Date.now() - timestamp <= 2 * 60 * 1000
}

function jobsForAsset(asset: AssetRow): DispatchJob[] {
  return (batch.value?.jobs ?? []).filter((job) => {
    const payload = job.payload ?? {}
    return payload.asset_uid === asset.asset_uid || payload.source_asset_uid === asset.asset_uid || payload.rejected_asset_uid === asset.asset_uid
  })
}

function decisionLabel(status: string): string {
  if (status === 'approved') return '已确认'
  if (status === 'rejected') return '已舍弃'
  if (status === 'pending') return '待定'
  if (status === 'uploaded') return '待审批'
  if (status === 'planned') return '待上传'
  if (status === 'submitted') return '已提交'
  if (status === 'generating') return '生成中'
  if (status === 'generated') return '已生成'
  return status || '待审批'
}

function kindLabel(kind: string): string {
  if (kind === 'source') return '主图'
  if (kind === 'reference') return '参考图'
  if (kind === 'ai') return 'AI 图'
  if (kind === 'table') return '表格'
  if (kind === 'result') return '结果'
  if (kind === 'log') return '日志'
  return kind || '素材'
}

onMounted(() => {
  void loadBatch()
  void loadMachines()
})
</script>

<template>
  <section class="view-stack batch-review-page">
    <section class="panel review-loadbar">
      <label class="field review-batch-field">
        <span>批次 UID</span>
        <input v-model="batchUid" placeholder="输入批次 UID" @keydown.enter="loadBatch()" />
      </label>
      <button class="primary-button" type="button" @click="loadBatch()">加载批次</button>
      <button class="ghost-button" type="button" @click="loadMachines()">刷新任务机</button>
    </section>

    <p v-if="message" class="notice">{{ message }}</p>
    <p v-if="error" class="notice danger">{{ error }}</p>

    <section v-if="batch" class="review-workbench">
      <aside class="style-nav-panel" aria-label="款式导航">
        <header class="review-batch-head">
          <div>
            <p class="review-kicker">AI 测图审图</p>
            <h2>{{ batch.title }}</h2>
            <span>{{ batch.batch_uid }}</span>
          </div>
          <span class="status-pill">{{ batch.status }}</span>
        </header>

        <div class="review-stats">
          <div><span>款式</span><strong>{{ styles.length }}</strong></div>
          <div><span>AI 图</span><strong>{{ batchStats.total }}</strong></div>
          <div><span>确认</span><strong>{{ batchStats.approved }}</strong></div>
          <div><span>舍弃</span><strong>{{ batchStats.rejected }}</strong></div>
        </div>

        <div class="style-nav-list">
          <button
            v-for="style in styles"
            :key="style.id"
            class="style-nav-card"
            :class="[{ active: selectedStyleId === style.id }, styleStateClass(style)]"
            type="button"
            @click="selectStyle(style)"
          >
            <span class="style-nav-title">{{ style.style_code || '-' }}</span>
            <span class="style-nav-meta">商品 {{ style.item_id || '-' }} / SKC {{ style.skc_code || '-' }}</span>
            <span class="style-nav-meta">{{ style.category || '-' }} / {{ style.gender || '-' }}</span>
            <span v-if="style.missing_prompt_reason" class="style-warning">{{ style.missing_prompt_reason }}</span>
            <span class="style-counts">
              <b>确认 {{ statsForStyle(style).approved }}</b>
              <b>舍弃 {{ statsForStyle(style).rejected }}</b>
              <b>待定 {{ statsForStyle(style).pending }}</b>
            </span>
          </button>
        </div>
      </aside>

      <main class="review-gallery-panel">
        <header class="selected-style-head">
          <div>
            <p class="review-kicker">当前款式</p>
            <h2>{{ selectedStyle?.style_code || '选择款式' }}</h2>
            <span>{{ selectedStyle?.item_id || '-' }} / {{ selectedStyle?.category || '-' }} / {{ selectedStyle?.gender || '-' }}</span>
          </div>
          <div class="selected-style-actions">
            <button class="danger-button" type="button" :disabled="selectedAssetUids.length === 0" @click="regenerateSelected">所选重生图</button>
            <button class="danger-button" type="button" :disabled="rejectedAssets.length === 0" @click="regenerateRejected">一键重生图</button>
            <button class="ghost-button" type="button" @click="markReady">重新计算可提交状态</button>
          </div>
        </header>

        <section class="source-zone">
          <div class="zone-title">
            <h3>主图 / 参考图</h3>
            <span>{{ sourceImageResources.length + sourceAssets.length }} 个素材</span>
          </div>
          <div class="source-strip">
            <button
              v-for="resource in sourceImageResources"
              :key="resource.resource_uid"
              class="source-tile"
              :class="{ selected: selectedResourceUids.includes(resource.resource_uid) }"
              type="button"
              @click="toggleResource(resource)"
            >
              <img v-if="isPreviewable(resource)" :src="resourceDownloadUrl(resource)" :alt="resource.filename" />
              <span v-else class="file-placeholder">{{ kindLabel(resource.kind) }}</span>
              <strong>{{ resource.source_label || kindLabel(resource.kind) }}</strong>
              <small>{{ resource.filename }}</small>
            </button>
            <button
              v-for="asset in sourceAssets"
              :key="asset.asset_uid"
              class="source-tile"
              :class="{ active: selectedAsset?.asset_uid === asset.asset_uid }"
              type="button"
              @click="selectAsset(asset)"
            >
              <img v-if="isPreviewable(asset)" :src="assetDownloadUrl(asset)" :alt="asset.filename" />
              <span v-else class="file-placeholder">{{ kindLabel(asset.kind) }}</span>
              <strong>{{ kindLabel(asset.kind) }}</strong>
              <small>{{ asset.filename }}</small>
            </button>
          </div>
        </section>

        <section class="ai-review-zone">
          <div class="zone-title">
            <h3>AI 图审批</h3>
            <span v-if="selectedStyle">确认 {{ statsForStyle(selectedStyle).approved }} / 舍弃 {{ statsForStyle(selectedStyle).rejected }} / 待定 {{ statsForStyle(selectedStyle).pending }}</span>
          </div>
          <div v-if="aiAssets.length === 0" class="gallery-empty">
            当前款式还没有 AI 图，可先在 AI 生图页或右侧上传一张 AI 图。
          </div>
          <div v-else class="review-gallery">
            <article
              v-for="asset in aiAssets"
              :key="asset.asset_uid"
              class="review-card"
              :class="[asset.status, { active: selectedAsset?.asset_uid === asset.asset_uid, selected: selectedAssetUids.includes(asset.asset_uid) }]"
            >
              <button class="review-image-button" type="button" @click="selectAsset(asset)">
                <img v-if="isPreviewable(asset)" :src="assetDownloadUrl(asset)" :alt="asset.filename" />
                <span v-else class="file-placeholder">AI 图</span>
              </button>
              <div class="review-card-meta">
                <label class="check-row">
                  <input type="checkbox" :checked="selectedAssetUids.includes(asset.asset_uid)" @change="toggleAsset(asset)" />
                  <span>{{ asset.filename }}</span>
                </label>
                <span class="status-pill" :class="asset.status">{{ decisionLabel(asset.status) }}</span>
              </div>
              <div class="review-card-actions">
                <button class="small-button" type="button" @click="decide(asset, 'approved')">确认</button>
                <button class="danger-button small-action" type="button" @click="decide(asset, 'rejected')">舍弃</button>
                <button class="ghost-button small-action" type="button" @click="decide(asset, 'pending')">待定</button>
              </div>
            </article>
          </div>
        </section>
      </main>

      <aside class="review-inspector">
        <template v-if="selectedAsset">
          <section class="inspector-preview">
            <img v-if="isPreviewable(selectedAsset)" :src="assetDownloadUrl(selectedAsset)" :alt="selectedAsset.filename" />
            <span v-else class="file-placeholder large">{{ kindLabel(selectedAsset.kind) }}</span>
          </section>

          <section class="inspector-section">
            <div class="inspector-title">
              <div>
                <h3>{{ kindLabel(selectedAsset.kind) }}</h3>
                <span>{{ selectedAsset.filename }}</span>
              </div>
              <span class="status-pill" :class="selectedAsset.status">{{ decisionLabel(selectedAsset.status) }}</span>
            </div>
            <div class="inspector-jobs" v-if="selectedAssetJobs.length">
              <span v-for="job in selectedAssetJobs" :key="job.job_uid" class="badge">{{ job.job_type }} / {{ job.status }}</span>
            </div>
          </section>

          <label v-if="selectedAsset.kind === 'ai'" class="field inspector-prompt">
            <span>原始 / 重跑 Prompt</span>
            <textarea v-model="promptOverrides[selectedAsset.asset_uid]" placeholder="修改 Prompt 后，可对舍弃图片重新生成"></textarea>
          </label>

          <section v-if="selectedAsset.kind === 'ai'" class="inspector-actions">
            <button class="small-button" type="button" @click="decide(selectedAsset, 'approved')">确认</button>
            <button class="danger-button" type="button" @click="decide(selectedAsset, 'rejected')">舍弃</button>
            <button class="ghost-button" type="button" @click="decide(selectedAsset, 'pending')">待定</button>
            <button class="primary-button" type="button" :disabled="selectedAsset.status !== 'rejected'" @click="regenerateOne(selectedAsset)">换 Prompt 重跑</button>
          </section>

          <a class="ghost-button download-link" :href="assetDownloadUrl(selectedAsset)" target="_blank" rel="noopener">下载当前图</a>
        </template>
        <div v-else class="inspector-empty">选择一张图片后查看 Prompt 和审批动作。</div>

        <form class="manual-upload-panel" @submit.prevent="uploadManualAsset">
          <h3>新增素材</h3>
          <label class="field">
            <span>类型</span>
            <select v-model="manualKind">
              <option value="source">主图</option>
              <option value="reference">参考图</option>
              <option value="ai">AI 图</option>
            </select>
          </label>
          <label class="field">
            <span>文件</span>
            <input type="file" accept="image/*" @change="onManualFile" />
          </label>
          <button class="ghost-button full" type="submit" :disabled="manualUploading || !manualFile">上传到当前款式</button>
        </form>

        <section class="submit-panel">
          <label class="field">
            <span>提交任务机</span>
            <select v-model="selectedMachineId">
              <option value="">选择任务机</option>
              <option v-for="machine in submitMachines" :key="machine.machine_id" :value="machine.machine_id">{{ machine.machine_name }} / {{ machine.health }}</option>
            </select>
          </label>
          <p v-if="submitMachines.length === 0" class="muted">没有最近在线且具备提交能力的任务机。</p>
          <button class="primary-button full" type="button" :disabled="!selectedMachineId" @click="submitJob">提交创建测图任务</button>
        </section>
      </aside>
    </section>

    <div v-else class="panel empty-state">输入或从审批批次页面选择批次后开始审核</div>
  </section>
</template>

<style scoped>
.batch-review-page {
  min-height: 0;
}

.review-loadbar {
  display: flex;
  align-items: end;
  gap: 10px;
}

.review-batch-field {
  min-width: min(440px, 100%);
  flex: 1;
}

.review-batch-field > span,
.inspector-prompt > span,
.manual-upload-panel .field > span,
.submit-panel .field > span {
  color: var(--text2);
  font-size: 12px;
  font-weight: 800;
}

.review-workbench {
  display: grid;
  grid-template-columns: minmax(220px, 260px) minmax(420px, 1fr) minmax(300px, 360px);
  gap: 12px;
  min-height: calc(100dvh - 184px);
}

.style-nav-panel,
.review-gallery-panel,
.review-inspector {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
}

.style-nav-panel,
.review-inspector {
  align-self: start;
  max-height: calc(100dvh - 184px);
  overflow: auto;
}

.review-batch-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid var(--border);
  padding: 12px;
}

.review-kicker,
.review-batch-head h2,
.review-batch-head span,
.selected-style-head h2,
.selected-style-head span,
.zone-title h3,
.zone-title span,
.inspector-title h3,
.inspector-title span,
.manual-upload-panel h3 {
  margin: 0;
}

.review-kicker {
  margin-bottom: 5px;
  color: var(--orange);
  font-size: 11px;
  font-weight: 800;
}

.review-batch-head h2,
.selected-style-head h2 {
  font-size: 16px;
  line-height: 1.25;
}

.review-batch-head h2 {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.review-batch-head span,
.selected-style-head span,
.zone-title span,
.inspector-title span {
  color: var(--text2);
  font-size: 12px;
}

.review-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  border-bottom: 1px solid var(--border);
  padding: 10px 12px;
}

.review-stats div {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  padding: 8px;
}

.review-stats span {
  display: block;
  color: var(--text2);
  font-size: 11px;
}

.review-stats strong {
  display: block;
  margin-top: 4px;
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}

.style-nav-list {
  display: grid;
  gap: 8px;
  padding: 10px;
}

.style-nav-card {
  display: grid;
  gap: 6px;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text);
  padding: 10px;
  text-align: left;
}

.style-nav-card.active,
.style-nav-card:hover {
  border-color: var(--orange);
  background: rgba(255, 107, 43, 0.09);
}

.style-nav-card.approved {
  border-color: rgba(74, 222, 128, 0.34);
}

.style-nav-card.rejected {
  border-color: rgba(248, 113, 113, 0.34);
}

.style-nav-title {
  font-size: 14px;
  font-weight: 900;
}

.style-nav-meta,
.style-warning {
  color: var(--text2);
  font-size: 11px;
  line-height: 1.45;
}

.style-warning {
  color: #fecaca;
}

.style-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 2px;
}

.style-counts b {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  padding: 3px 6px;
  color: var(--text2);
  font-size: 11px;
  font-weight: 800;
}

.review-gallery-panel {
  display: grid;
  grid-template-rows: auto auto 1fr;
  overflow: hidden;
}

.selected-style-head,
.zone-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.selected-style-head {
  border-bottom: 1px solid var(--border);
  padding: 12px 14px;
}

.selected-style-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.source-zone,
.ai-review-zone {
  min-width: 0;
  padding: 12px 14px;
}

.source-zone {
  border-bottom: 1px solid var(--border);
}

.source-strip {
  display: grid;
  grid-auto-columns: 118px;
  grid-auto-flow: column;
  gap: 10px;
  margin-top: 10px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.source-tile {
  display: grid;
  gap: 5px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text);
  padding: 7px;
  text-align: left;
}

.source-tile.selected,
.source-tile.active,
.source-tile:hover {
  border-color: var(--orange);
}

.source-tile img {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 6px;
  background: var(--bg);
  object-fit: cover;
}

.source-tile strong,
.source-tile small {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-tile strong {
  font-size: 12px;
}

.source-tile small {
  color: var(--text2);
  font-size: 11px;
}

.ai-review-zone {
  min-height: 0;
  overflow: auto;
}

.review-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(174px, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.review-card {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  overflow: hidden;
}

.review-card.active,
.review-card.selected,
.review-card:hover {
  border-color: var(--orange);
}

.review-card.approved {
  border-color: rgba(74, 222, 128, 0.42);
}

.review-card.rejected {
  border-color: rgba(248, 113, 113, 0.42);
}

.review-image-button {
  display: block;
  width: 100%;
  border: 0;
  border-radius: 0;
  background: var(--bg);
  padding: 0;
}

.review-image-button img {
  display: block;
  width: 100%;
  aspect-ratio: 3 / 4;
  background: rgba(255, 255, 255, 0.03);
  object-fit: contain;
}

.review-card-meta {
  display: grid;
  gap: 8px;
  padding: 9px;
}

.check-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 7px;
  align-items: center;
  color: var(--text);
  font-size: 12px;
}

.check-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-card-actions {
  display: flex;
  gap: 6px;
  border-top: 1px solid var(--border);
  padding: 9px;
}

.small-action {
  min-height: 28px;
  padding: 5px 8px;
  font-size: 12px;
}

.review-inspector {
  display: grid;
  gap: 12px;
  padding: 12px;
}

.inspector-preview {
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  min-height: 260px;
  overflow: hidden;
}

.inspector-preview img {
  display: block;
  width: 100%;
  max-height: 420px;
  object-fit: contain;
}

.file-placeholder {
  display: grid;
  width: 100%;
  min-height: 84px;
  place-items: center;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text2);
  font-size: 12px;
  font-weight: 800;
}

.file-placeholder.large {
  min-height: 260px;
}

.inspector-section,
.manual-upload-panel,
.submit-panel {
  display: grid;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  padding: 10px;
}

.inspector-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.inspector-title h3,
.manual-upload-panel h3 {
  font-size: 14px;
}

.inspector-title span {
  word-break: break-all;
}

.inspector-jobs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.inspector-prompt textarea {
  min-height: 180px;
}

.inspector-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.download-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text2);
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 900;
  white-space: nowrap;
}

.status-pill.approved {
  border-color: rgba(74, 222, 128, 0.4);
  color: #b7f7cf;
}

.status-pill.rejected {
  border-color: rgba(248, 113, 113, 0.45);
  color: #ffd2d2;
}

.status-pill.uploaded,
.status-pill.pending {
  border-color: rgba(255, 107, 43, 0.45);
  color: #ffd8c7;
}

.gallery-empty,
.inspector-empty {
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 18px;
  color: var(--text2);
  text-align: center;
}

@media (max-width: 1180px) {
  .review-workbench {
    grid-template-columns: minmax(210px, 250px) minmax(0, 1fr);
  }

  .review-inspector {
    grid-column: 1 / -1;
    max-height: none;
  }
}

@media (max-width: 860px) {
  .review-loadbar,
  .selected-style-head,
  .zone-title {
    align-items: stretch;
    flex-direction: column;
  }

  .review-workbench {
    grid-template-columns: 1fr;
    min-height: 0;
  }

  .style-nav-panel,
  .review-inspector {
    max-height: none;
  }

  .source-strip {
    grid-auto-columns: minmax(116px, 42vw);
  }
}
</style>
