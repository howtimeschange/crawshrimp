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

const props = defineProps<{ initialBatchUid?: string }>()

const batchUid = ref(props.initialBatchUid || '')
const batch = ref<BatchDetail | null>(null)
const machines = ref<MachineRow[]>([])
const selectedStyleId = ref<number | null>(null)
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
const selectedStyle = computed(() => styles.value.find((style) => style.id === selectedStyleId.value) ?? styles.value[0])
const aiAssets = computed(() => selectedStyle.value?.assets.filter((asset) => asset.kind === 'ai') ?? [])
const sourceAssets = computed(() => selectedStyle.value?.assets.filter((asset) => asset.kind !== 'ai') ?? [])
const imageResources = computed(() => selectedStyle.value?.image_resources ?? [])
const rejectedAssets = computed(() => batch.value?.styles.flatMap((style) => style.assets).filter((asset) => asset.kind === 'ai' && asset.status === 'rejected') ?? [])
const submitMachines = computed(() => machines.value.filter((machine) => machine.auth_status === 'active' && machine.health && ['online_idle', 'online_busy'].includes(machine.health) && isFresh(machine.last_seen_at) && machine.capabilities_json.includes('submit_tmall_material_test')))

watch(() => props.initialBatchUid, (value) => {
  if (value) {
    batchUid.value = value
    loadBatch()
  }
})

async function loadBatch() {
  if (!batchUid.value) return
  error.value = ''
  try {
    const data = await apiGet<{ batch: BatchDetail }>(`/api/ai-image-batches/${encodeURIComponent(batchUid.value)}`)
    batch.value = data.batch
    selectedStyleId.value = data.batch.styles[0]?.id ?? null
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

watch(selectedStyleId, () => {
  selectedResourceUids.value = []
})

function toggleAsset(asset: AssetRow) {
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
    message.value = `${asset.filename} 已标记为 ${decision}`
    await loadBatch()
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
    selectedAssetUids.value = []
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function regenerateRejected() {
  if (!batch.value || rejectedAssets.value.length === 0) return
  try {
    await apiPost(`/api/ai-image-batches/${encodeURIComponent(batch.value.batch_uid)}/regenerate-rejected`, { prompt_overrides: promptOverrides.value })
    message.value = `已创建 ${rejectedAssets.value.length} 个舍弃图重跑任务`
    await loadBatch()
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function regenerateOne(asset: AssetRow) {
  selectedAssetUids.value = [asset.asset_uid]
  await regenerateSelected()
  await loadBatch()
}

async function markReady() {
  if (!batch.value) return
  try {
    await apiPost(`/api/ai-image-batches/${encodeURIComponent(batch.value.batch_uid)}/mark-ready`)
    message.value = '已重新计算批次可提交状态'
    await loadBatch()
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function submitJob() {
  if (!batch.value || !selectedMachineId.value) return
  try {
    await apiPost(`/api/ai-image-batches/${encodeURIComponent(batch.value.batch_uid)}/submit`, { machine_id: selectedMachineId.value })
    message.value = '提交创建测图任务已派发'
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
    await loadBatch()
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
    return payload.asset_uid === asset.asset_uid || payload.source_asset_uid === asset.asset_uid
  })
}

onMounted(() => {
  loadBatch()
  loadMachines()
})
</script>

<template>
  <section class="view-stack">
    <section class="panel toolbar">
      <label class="field">
        <span>批次 UID</span>
        <input v-model="batchUid" placeholder="输入批次 UID" @keydown.enter="loadBatch" />
      </label>
      <button class="primary-button" type="button" @click="loadBatch">加载批次</button>
      <button class="ghost-button" type="button" @click="loadMachines">刷新任务机</button>
    </section>

    <p v-if="message" class="notice">{{ message }}</p>
    <p v-if="error" class="notice danger">{{ error }}</p>

    <section v-if="batch" class="split-grid">
      <div class="table-panel">
        <div class="table-header">
          <h2>{{ batch.title }}</h2>
          <span class="badge">{{ batch.status }}</span>
        </div>
        <table class="data-table">
          <thead><tr><th>款式</th><th>SKC</th><th>类目</th><th>状态</th></tr></thead>
          <tbody>
            <tr v-for="style in styles" :key="style.id" @click="selectedStyleId = style.id">
              <td><strong>{{ style.style_code }}</strong><br /><span class="muted">{{ style.item_id || '-' }}</span></td>
              <td>{{ style.skc_code || '-' }}</td>
              <td>{{ style.category || '-' }} / {{ style.gender || '-' }}</td>
              <td><span class="badge">{{ style.status }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <aside class="form-panel view-stack">
        <div>
          <h2>{{ selectedStyle?.style_code || '选择款式' }}</h2>
          <p class="muted">{{ selectedStyle?.missing_prompt_reason || '逐张确认 AI 图，并按需重生图或提交测图任务。' }}</p>
        </div>

        <div class="asset-rail">
          <h2>资源库</h2>
          <div v-if="imageResources.length === 0" class="asset-row muted">当前款式还没有同步资源。</div>
          <div
            v-for="resource in imageResources"
            :key="resource.resource_uid"
            class="asset-row"
            :class="{ selected: selectedResourceUids.includes(resource.resource_uid) }"
          >
            <img v-if="isPreviewable(resource)" class="asset-thumb" :src="resourceDownloadUrl(resource)" :alt="resource.filename" />
            <div class="row-actions">
              <input type="checkbox" :checked="selectedResourceUids.includes(resource.resource_uid)" @change="toggleResource(resource)" />
              <span class="badge">{{ resource.kind }}</span>
              <span v-if="resource.source_label" class="badge">{{ resource.source_label }}</span>
              <strong>{{ resource.filename }}</strong>
              <a class="small-button" :href="resourceDownloadUrl(resource)" target="_blank" rel="noopener">下载</a>
            </div>
          </div>
        </div>

        <div class="asset-rail">
          <h2>素材轨</h2>
          <div v-for="asset in sourceAssets" :key="asset.asset_uid" class="asset-row">
            <img v-if="isPreviewable(asset)" class="asset-thumb" :src="assetDownloadUrl(asset)" :alt="asset.filename" />
            <div class="row-actions">
              <span class="badge">{{ asset.kind }}</span>
              <strong>{{ asset.filename }}</strong>
              <a class="small-button" :href="assetDownloadUrl(asset)" target="_blank" rel="noopener">下载</a>
            </div>
          </div>
        </div>

        <form class="asset-rail" @submit.prevent="uploadManualAsset">
          <h2>新增素材</h2>
          <div class="inline-fields">
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
          </div>
          <button class="ghost-button" type="submit" :disabled="manualUploading || !manualFile">上传到当前款式</button>
        </form>

        <div class="asset-rail">
          <h2>AI 图审批</h2>
          <div
            v-for="asset in aiAssets"
            :key="asset.asset_uid"
            class="asset-row"
            :class="{ selected: selectedAssetUids.includes(asset.asset_uid) }"
          >
            <div class="row-actions">
              <input type="checkbox" :checked="selectedAssetUids.includes(asset.asset_uid)" @change="toggleAsset(asset)" />
              <strong>{{ asset.filename }}</strong>
              <span class="badge">{{ asset.status }}</span>
              <span v-for="job in jobsForAsset(asset)" :key="job.job_uid" class="badge">{{ job.status }}</span>
              <a class="small-button" :href="assetDownloadUrl(asset)" target="_blank" rel="noopener">下载</a>
            </div>
            <img v-if="isPreviewable(asset)" class="asset-preview" :src="assetDownloadUrl(asset)" :alt="asset.filename" />
            <label class="field">
              <span>重生图 Prompt</span>
              <textarea v-model="promptOverrides[asset.asset_uid]" placeholder="编辑后选择图片并点击重生图"></textarea>
            </label>
            <div class="asset-actions">
              <button class="small-button" type="button" @click="decide(asset, 'approved')">确认</button>
              <button class="danger-button" type="button" @click="decide(asset, 'rejected')">舍弃</button>
              <button class="ghost-button" type="button" @click="decide(asset, 'pending')">待定</button>
              <button class="ghost-button" type="button" :disabled="asset.status !== 'rejected'" @click="regenerateOne(asset)">换 Prompt 重跑</button>
            </div>
          </div>
        </div>

        <div class="row-actions">
          <button class="danger-button" type="button" @click="regenerateSelected">所选重生图</button>
          <button class="danger-button" type="button" :disabled="rejectedAssets.length === 0" @click="regenerateRejected">一键重生图</button>
          <button class="ghost-button" type="button" @click="markReady">重新计算可提交状态</button>
        </div>

        <label class="field">
          <span>提交任务机</span>
          <select v-model="selectedMachineId">
            <option value="">选择任务机</option>
            <option v-for="machine in submitMachines" :key="machine.machine_id" :value="machine.machine_id">{{ machine.machine_name }} / {{ machine.health }}</option>
          </select>
        </label>
        <p v-if="submitMachines.length === 0" class="muted">没有最近在线且具备提交能力的任务机。</p>
        <button class="primary-button full" type="button" @click="submitJob">提交创建测图任务</button>
      </aside>
    </section>

    <div v-else class="panel empty-state">输入或从审批批次页面选择批次后开始审核</div>
  </section>
</template>
