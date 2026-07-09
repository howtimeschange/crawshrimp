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
  assigned_machine_id?: string | null
  payload?: Record<string, unknown>
  result?: unknown
  created_at?: string
  updated_at?: string
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
  submitted: number
  rejected: number
  pending: number
}

interface TaskResultSummary {
  submitted: string
  attempted: string
  succeeded: string
  failed: string
  error: string
}

const ACTIVE_SUBMIT_STATUSES = new Set(['queued', 'leased', 'running', 'uploading_results', 'cancel_requested'])

const props = defineProps<{ initialBatchUid?: string }>()

const batchUid = ref(props.initialBatchUid || '')
const batch = ref<BatchDetail | null>(null)
const machines = ref<MachineRow[]>([])
const selectedStyleId = ref<number | null>(null)
const selectedAssetUid = ref('')
const selectedMachineId = ref('')
const message = ref('')
const error = ref('')

const styles = computed(() => batch.value?.styles ?? [])
const selectedStyle = computed(() => styles.value.find((style) => style.id === selectedStyleId.value) ?? styles.value[0] ?? null)
const aiAssets = computed(() => selectedStyle.value?.assets.filter((asset) => asset.kind === 'ai') ?? [])
const sourceAssets = computed(() => selectedStyle.value?.assets.filter((asset) => ['source', 'reference'].includes(asset.kind)) ?? [])
const imageResources = computed(() => selectedStyle.value?.image_resources ?? [])
const sourceImageResources = computed(() => imageResources.value.filter((resource) => resource.kind !== 'ai'))
const selectedAsset = computed(() => {
  const assets = selectedStyle.value?.assets ?? []
  return assets.find((asset) => asset.asset_uid === selectedAssetUid.value)
    ?? aiAssets.value[0]
    ?? sourceAssets.value[0]
    ?? null
})
const selectedAssetJobs = computed(() => selectedAsset.value ? jobsForAsset(selectedAsset.value) : [])
const submitJobs = computed(() => (batch.value?.jobs ?? []).filter((job) => job.job_type === 'submit_tmall_material_test'))
const latestSubmitJob = computed(() => submitJobs.value[0] ?? null)
const activeSubmitJob = computed(() => submitJobs.value.find((job) => ACTIVE_SUBMIT_STATUSES.has(job.status)) ?? null)
const batchStats = computed(() => {
  const allAiAssets = styles.value.flatMap((style) => style.assets).filter((asset) => asset.kind === 'ai')
  return reviewStats(allAiAssets)
})
const hasSubmittedResults = computed(() => styles.value.some((style) => style.assets.some((asset) => asset.kind === 'ai' && asset.status === 'submitted')) || latestSubmitJob.value?.status === 'succeeded')
const displayBatchStatus = computed(() => {
  if (batch.value?.status === 'submitted' || hasSubmittedResults.value) return 'submitted'
  if (activeSubmitJob.value) return 'submitting'
  return batch.value?.status || ''
})
const submitMachines = computed(() => machines.value.filter((machine) => machine.auth_status === 'active' && machine.health && ['online_idle', 'online_busy'].includes(machine.health) && isFresh(machine.last_seen_at) && machine.capabilities_json.includes('submit_tmall_material_test')))
const submitValidationMessage = computed(() => {
  if (!batch.value) return '请先从审批批次进入审图详情'
  if (batch.value.status === 'submitted' || hasSubmittedResults.value) return '批次已提交，可查看任务回传结果'
  if (activeSubmitJob.value) return `提交任务${jobStatusLabel(activeSubmitJob.value.status)}，等待任务机回传结果`
  const missingStyles = styles.value.filter((style) => style.status !== 'skipped' && statsForStyle(style).approved === 0)
  if (missingStyles.length > 0) {
    return `每个款式至少确认 1 张 AI 图后才能提交：${missingStyles.map((style) => style.style_code || style.item_id || `款式 ${style.id}`).join('、')}`
  }
  if (!selectedMachineId.value) return '请选择具备上传天猫测图能力的任务机'
  return ''
})
const canSubmitBatch = computed(() => Boolean(batch.value && !submitValidationMessage.value && !activeSubmitJob.value && batch.value.status !== 'submitted' && !hasSubmittedResults.value))

watch(() => props.initialBatchUid, (value) => {
  if (value) {
    batchUid.value = value
    void loadBatch()
  }
})

watch(selectedStyleId, () => {
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
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function loadMachines() {
  try {
    const data = await apiGet<{ machines: MachineRow[] }>('/api/admin/machines')
    machines.value = data.machines
    if (!submitMachines.value.some((machine) => machine.machine_id === selectedMachineId.value)) {
      selectedMachineId.value = submitMachines.value[0]?.machine_id ?? ''
    }
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
  const approved = aiRows.filter((asset) => asset.status === 'approved').length
  const submitted = aiRows.filter((asset) => asset.status === 'submitted').length
  return {
    total: aiRows.length,
    approved: approved + submitted,
    submitted,
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
  if (stats.submitted > 0) return 'submitted'
  if (stats.approved > 0) return 'approved'
  return 'rejected'
}

async function decide(asset: AssetRow, decision: 'approved' | 'rejected' | 'pending') {
  if (!batch.value) return
  if (asset.status === 'submitted') {
    error.value = '已提交图片不能重新审批'
    return
  }
  try {
    await apiPatch(`/api/ai-image-batches/${encodeURIComponent(batch.value.batch_uid)}/assets/${encodeURIComponent(asset.asset_uid)}/decision`, { decision })
    message.value = `${asset.filename} 已标记为 ${decisionLabel(decision)}`
    await loadBatch({ styleId: selectedStyleId.value, assetUid: asset.asset_uid })
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function submitJob() {
  if (!batch.value || !selectedMachineId.value) return
  if (submitValidationMessage.value) {
    error.value = submitValidationMessage.value
    return
  }
  try {
    error.value = ''
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

function isFresh(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false
  const timestamp = Date.parse(lastSeenAt)
  return Number.isFinite(timestamp) && Date.now() - timestamp <= 2 * 60 * 1000
}

function assetStatusClass(status: string): string {
  if (status === 'approved') return 'approved'
  if (status === 'submitted') return 'submitted'
  if (status === 'rejected') return 'rejected'
  return 'pending-review'
}

function batchStatusLabel(status: string): string {
  if (status === 'syncing') return '同步中'
  if (status === 'pending_review') return '待审批'
  if (status === 'submitting') return '提交中'
  if (status === 'ready_to_submit') return '可提交'
  if (status === 'submitted') return '已提交'
  if (status === 'rejected') return '已退回'
  return status || '-'
}

function jobsForAsset(asset: AssetRow): DispatchJob[] {
  return (batch.value?.jobs ?? []).filter((job) => {
    const payload = job.payload ?? {}
    const submitPlan = isRecord(payload.submit_plan) ? payload.submit_plan : {}
    const plannedAssets = Array.isArray(submitPlan.assets) ? submitPlan.assets : []
    return payload.asset_uid === asset.asset_uid
      || payload.source_asset_uid === asset.asset_uid
      || payload.rejected_asset_uid === asset.asset_uid
      || plannedAssets.some((planned) => isRecord(planned) && planned.asset_uid === asset.asset_uid)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function jobStatusLabel(status: string): string {
  if (status === 'queued') return '已排队'
  if (status === 'leased') return '已领取'
  if (status === 'running') return '执行中'
  if (status === 'uploading_results') return '回传中'
  if (status === 'succeeded') return '已成功'
  if (status === 'terminal_failed') return '失败'
  if (status === 'cancel_requested') return '取消中'
  if (status === 'cancelled') return '已取消'
  return status || '-'
}

function machineName(machineId: string | null | undefined): string {
  if (!machineId) return '-'
  return machines.value.find((machine) => machine.machine_id === machineId)?.machine_name || machineId
}

function taskResultSummary(job: DispatchJob | null): TaskResultSummary {
  const result = isRecord(job?.result) ? job.result : {}
  return {
    submitted: taskResultValue(result.submitted),
    attempted: taskResultValue(result.attempted),
    succeeded: taskResultValue(result.succeeded),
    failed: taskResultValue(result.failed),
    error: stringValue(result.error),
  }
}

function taskResultValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-'
  const number = Number(value)
  return Number.isFinite(number) ? String(number) : String(value)
}

function stringValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim()
}

function decisionLabel(status: string): string {
  if (status === 'approved') return '已确认'
  if (status === 'rejected') return '已舍弃'
  if (status === 'pending') return '待审批'
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
    <p v-if="message" class="notice">{{ message }}</p>
    <p v-if="error" class="notice danger">{{ error }}</p>

    <section v-if="batch" class="panel review-batch-summary">
      <div class="review-titlebar">
        <div class="summary-copy">
          <p class="review-kicker">AI 测图审图</p>
          <h2>{{ batch.title }}</h2>
          <span>批次 {{ batch.batch_uid }} · 共 {{ styles.length }} 款、{{ batchStats.total }} 张 AI 图</span>
        </div>
        <div class="summary-stats">
          <div><span>状态</span><strong>{{ batchStatusLabel(displayBatchStatus) }}</strong></div>
          <div><span>已确认</span><strong>{{ batchStats.approved }}</strong></div>
          <div><span>已舍弃</span><strong>{{ batchStats.rejected }}</strong></div>
          <div><span>待审批</span><strong>{{ batchStats.pending }}</strong></div>
        </div>
      </div>
      <section class="batch-submit-panel">
        <label class="field">
          <span>提交任务机</span>
          <select v-model="selectedMachineId">
            <option value="">选择任务机</option>
            <option v-for="machine in submitMachines" :key="machine.machine_id" :value="machine.machine_id">{{ machine.machine_name }} / {{ machine.health }}</option>
          </select>
        </label>
        <p class="submit-validation" :class="{ ready: !submitValidationMessage }">{{ submitValidationMessage || '已满足提交条件，可派发上传天猫测图任务' }}</p>
        <div class="submit-actions">
          <button class="ghost-button" type="button" @click="loadMachines">更新任务机</button>
          <button class="primary-button" type="button" :disabled="!canSubmitBatch" @click="submitJob">提交创建测图任务</button>
        </div>
        <section v-if="latestSubmitJob" class="submit-result-panel">
          <div class="submit-result-head">
            <span>任务结果</span>
            <strong>{{ jobStatusLabel(latestSubmitJob.status) }}</strong>
          </div>
          <small>任务机 {{ machineName(latestSubmitJob.assigned_machine_id) }}</small>
          <div class="task-result-summary">
            <span>提交 {{ taskResultSummary(latestSubmitJob).submitted }}</span>
            <span>尝试 {{ taskResultSummary(latestSubmitJob).attempted }}</span>
            <span>成功 {{ taskResultSummary(latestSubmitJob).succeeded }}</span>
            <span>失败 {{ taskResultSummary(latestSubmitJob).failed }}</span>
          </div>
          <p v-if="taskResultSummary(latestSubmitJob).error" class="task-result-error">{{ taskResultSummary(latestSubmitJob).error }}</p>
        </section>
      </section>
    </section>

    <section v-if="batch" class="review-workbench">
      <aside class="style-nav-panel" aria-label="款式导航">
        <div class="style-panel-head">
          <p class="review-kicker">款式列表</p>
          <strong>{{ styles.length }} 款</strong>
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
              <b class="approved">确认 {{ statsForStyle(style).approved }}</b>
              <b class="rejected">舍弃 {{ statsForStyle(style).rejected }}</b>
              <b class="pending-review">待审 {{ statsForStyle(style).pending }}</b>
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
        </header>

        <section class="source-zone">
          <div class="zone-title">
            <h3>主图 / 参考图</h3>
            <span>{{ sourceImageResources.length + sourceAssets.length }} 个素材</span>
          </div>
          <div class="source-strip">
            <article
              v-for="resource in sourceImageResources"
              :key="resource.resource_uid"
              class="source-tile"
            >
              <img v-if="isPreviewable(resource)" :src="resourceDownloadUrl(resource)" :alt="resource.filename" />
              <span v-else class="file-placeholder">{{ kindLabel(resource.kind) }}</span>
              <strong>{{ resource.source_label || kindLabel(resource.kind) }}</strong>
              <small>{{ resource.filename }}</small>
            </article>
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
            当前款式还没有本地任务机回传的 AI 图。
          </div>
          <div v-else class="review-gallery">
            <article
              v-for="asset in aiAssets"
              :key="asset.asset_uid"
              class="review-card"
              :class="[asset.status, { active: selectedAsset?.asset_uid === asset.asset_uid }]"
            >
              <button class="review-image-button" type="button" @click="selectAsset(asset)">
                <img v-if="isPreviewable(asset)" :src="assetDownloadUrl(asset)" :alt="asset.filename" />
                <span v-else class="file-placeholder">AI 图</span>
              </button>
              <div class="review-card-meta">
                <div class="check-row">
                  <span>{{ asset.filename }}</span>
                </div>
                <span class="review-status-ribbon" :class="assetStatusClass(asset.status)">{{ decisionLabel(asset.status) }}</span>
              </div>
              <div class="review-card-actions">
                <button class="small-button approve-action" type="button" :disabled="asset.status === 'submitted'" @click="decide(asset, 'approved')">确认通过</button>
                <button class="danger-button small-action" type="button" :disabled="asset.status === 'submitted'" @click="decide(asset, 'rejected')">标记舍弃</button>
                <button class="ghost-button small-action" type="button" :disabled="asset.status === 'submitted'" @click="decide(asset, 'pending')">待审批</button>
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
              <span class="status-pill" :class="assetStatusClass(selectedAsset.status)">{{ decisionLabel(selectedAsset.status) }}</span>
            </div>
            <div class="inspector-jobs" v-if="selectedAssetJobs.length">
              <span v-for="job in selectedAssetJobs" :key="job.job_uid" class="badge">{{ job.job_type }} / {{ job.status }}</span>
            </div>
          </section>

          <label v-if="selectedAsset.kind === 'ai'" class="field inspector-prompt prompt-evidence">
            <span>当前图 Prompt</span>
            <textarea :value="selectedAsset.prompt_text || '无 Prompt 记录'" readonly></textarea>
          </label>

          <section v-if="selectedAsset.kind === 'ai'" class="inspector-actions">
            <button class="small-button approve-action" type="button" :disabled="selectedAsset.status === 'submitted'" @click="decide(selectedAsset, 'approved')">确认通过</button>
            <button class="danger-button" type="button" :disabled="selectedAsset.status === 'submitted'" @click="decide(selectedAsset, 'rejected')">标记舍弃</button>
            <button class="ghost-button" type="button" :disabled="selectedAsset.status === 'submitted'" @click="decide(selectedAsset, 'pending')">待审批</button>
          </section>

          <a class="ghost-button download-link" :href="assetDownloadUrl(selectedAsset)" target="_blank" rel="noopener">下载当前图</a>
        </template>
        <div v-else class="inspector-empty">选择一张图片后查看审批动作和任务结果。</div>
      </aside>
    </section>

    <div v-else class="panel empty-state">请从审批批次页面选择批次后开始审核</div>
  </section>
</template>

<style scoped>
.batch-review-page {
  min-height: 0;
}

.review-batch-summary {
  display: grid;
  gap: 10px;
  padding: 12px 14px;
}

.review-titlebar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
}

.summary-copy {
  min-width: 0;
}

.summary-copy h2,
.summary-copy span,
.style-panel-head p,
.style-panel-head strong {
  margin: 0;
}

.summary-copy h2 {
  font-size: 17px;
  line-height: 1.25;
}

.summary-copy span {
  color: var(--text2);
  font-size: 12px;
}

.summary-stats {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.summary-stats div {
  min-width: 76px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  padding: 6px 8px;
}

.summary-stats span,
.summary-stats strong {
  display: block;
}

.summary-stats span {
  color: var(--text2);
  font-size: 11px;
}

.summary-stats strong {
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.batch-submit-panel {
  display: grid;
  grid-template-columns: minmax(220px, 320px) minmax(220px, 1fr) auto;
  gap: 8px;
  align-items: end;
  border: 1px solid rgba(255, 107, 43, 0.28);
  border-radius: 8px;
  background: rgba(255, 107, 43, 0.07);
  padding: 8px;
}

.submit-actions {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
}

.submit-validation {
  margin: 0;
  color: #ffd2d2;
  font-size: 12px;
  line-height: 1.45;
  align-self: center;
}

.submit-validation.ready {
  color: #b7f7cf;
}

.submit-result-panel {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  border-top: 1px solid rgba(255, 107, 43, 0.22);
  padding-top: 8px;
}

.submit-result-head,
.task-result-summary {
  display: flex;
  align-items: center;
  gap: 6px;
}

.task-result-summary {
  flex-wrap: wrap;
}

.submit-result-panel span,
.submit-result-panel small,
.task-result-error {
  color: var(--text2);
  font-size: 12px;
}

.submit-result-panel strong {
  color: #b7f7cf;
  font-size: 13px;
}

.task-result-error {
  margin: 0;
  color: #ffd2d2;
}

.inspector-prompt > span,
.batch-submit-panel .field > span {
  color: var(--text2);
  font-size: 12px;
  font-weight: 800;
}

.review-workbench {
  display: grid;
  grid-template-columns: minmax(220px, 260px) minmax(420px, 1fr) minmax(300px, 360px);
  gap: 12px;
  min-height: calc(100dvh - 178px);
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
  max-height: calc(100dvh - 178px);
  overflow: auto;
}

.style-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid var(--border);
  padding: 12px;
}

.style-panel-head strong {
  font-size: 13px;
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
.inspector-title span {
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

.style-nav-card.submitted {
  border-color: rgba(74, 222, 128, 0.52);
  background: rgba(74, 222, 128, 0.08);
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

.style-counts b.approved {
  border-color: rgba(74, 222, 128, 0.38);
  color: #b7f7cf;
}

.style-counts b.rejected {
  border-color: rgba(248, 113, 113, 0.42);
  color: #ffd2d2;
}

.style-counts b.pending-review {
  border-color: rgba(255, 107, 43, 0.42);
  color: #ffd8c7;
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
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease;
}

.review-card.active,
.review-card:hover {
  border-color: var(--orange);
}

.review-card.approved,
.review-card.submitted {
  border-color: rgba(74, 222, 128, 0.68);
  background: linear-gradient(180deg, rgba(74, 222, 128, 0.11), var(--bg3) 38%);
}

.review-card.rejected {
  border-color: rgba(248, 113, 113, 0.74);
  background: linear-gradient(180deg, rgba(248, 113, 113, 0.12), var(--bg3) 38%);
}

.review-card.pending,
.review-card.uploaded,
.review-card.generated,
.review-card.generating {
  border-color: rgba(255, 107, 43, 0.58);
  background: linear-gradient(180deg, rgba(255, 107, 43, 0.1), var(--bg3) 38%);
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
  flex-wrap: wrap;
  gap: 6px;
  border-top: 1px solid var(--border);
  padding: 9px;
}

.review-status-ribbon {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 900;
}

.review-status-ribbon.approved,
.review-status-ribbon.submitted,
.status-pill.approved,
.status-pill.submitted {
  border-color: rgba(74, 222, 128, 0.58);
  background: rgba(74, 222, 128, 0.13);
  color: #b7f7cf;
}

.review-status-ribbon.rejected,
.status-pill.rejected {
  border-color: rgba(248, 113, 113, 0.58);
  background: rgba(248, 113, 113, 0.13);
  color: #ffd2d2;
}

.review-status-ribbon.pending-review,
.status-pill.pending-review {
  border-color: rgba(255, 107, 43, 0.58);
  background: rgba(255, 107, 43, 0.13);
  color: #ffd8c7;
}

.approve-action {
  border-color: rgba(74, 222, 128, 0.42);
  background: rgba(74, 222, 128, 0.1);
  color: #d8ffe6;
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
.prompt-evidence {
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

.inspector-title h3 {
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
  .review-titlebar,
  .batch-submit-panel {
    grid-template-columns: 1fr;
  }

  .summary-stats {
    justify-content: flex-start;
  }

  .review-workbench {
    grid-template-columns: minmax(210px, 250px) minmax(0, 1fr);
    min-height: 0;
  }

  .review-inspector {
    grid-column: 1 / -1;
    max-height: none;
  }
}

@media (max-width: 860px) {
  .submit-actions,
  .batch-submit-panel,
  .selected-style-head,
  .zone-title {
    align-items: stretch;
    grid-template-columns: 1fr;
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
