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
}

interface BatchDetail {
  batch_uid: string
  title: string
  status: string
  styles: StyleRow[]
}

interface MachineRow {
  machine_id: string
  machine_name: string
  auth_status: string
  capabilities_json: string
}

const props = defineProps<{ initialBatchUid?: string }>()

const batchUid = ref(props.initialBatchUid || '')
const batch = ref<BatchDetail | null>(null)
const machines = ref<MachineRow[]>([])
const selectedStyleId = ref<number | null>(null)
const selectedAssetUids = ref<string[]>([])
const selectedMachineId = ref('')
const message = ref('')
const error = ref('')

const styles = computed(() => batch.value?.styles ?? [])
const selectedStyle = computed(() => styles.value.find((style) => style.id === selectedStyleId.value) ?? styles.value[0])
const aiAssets = computed(() => selectedStyle.value?.assets.filter((asset) => asset.kind === 'ai') ?? [])
const sourceAssets = computed(() => selectedStyle.value?.assets.filter((asset) => asset.kind !== 'ai') ?? [])
const submitMachines = computed(() => machines.value.filter((machine) => machine.auth_status === 'active' && machine.capabilities_json.includes('submit_tmall_material_test')))

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

function toggleAsset(asset: AssetRow) {
  if (selectedAssetUids.value.includes(asset.asset_uid)) {
    selectedAssetUids.value = selectedAssetUids.value.filter((assetUid) => assetUid !== asset.asset_uid)
  } else {
    selectedAssetUids.value = [...selectedAssetUids.value, asset.asset_uid]
  }
}

async function decide(asset: AssetRow, decision: 'approved' | 'rejected' | 'pending') {
  if (!batch.value) return
  await apiPatch(`/api/ai-image-batches/${encodeURIComponent(batch.value.batch_uid)}/assets/${encodeURIComponent(asset.asset_uid)}/decision`, { decision })
  message.value = `${asset.filename} 已标记为 ${decision}`
  await loadBatch()
}

async function regenerateSelected() {
  if (!batch.value || selectedAssetUids.value.length === 0) return
  await apiPost(`/api/ai-image-batches/${encodeURIComponent(batch.value.batch_uid)}/regenerate`, { asset_uids: selectedAssetUids.value })
  message.value = '一键重生图任务已创建'
  selectedAssetUids.value = []
}

async function markReady() {
  if (!batch.value) return
  await apiPost(`/api/ai-image-batches/${encodeURIComponent(batch.value.batch_uid)}/mark-ready`)
  message.value = '批次已标记为待提交'
  await loadBatch()
}

async function submitJob() {
  if (!batch.value || !selectedMachineId.value) return
  await apiPost(`/api/ai-image-batches/${encodeURIComponent(batch.value.batch_uid)}/submit`, { machine_id: selectedMachineId.value })
  message.value = '提交创建测图任务已派发'
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
          <h2>素材轨</h2>
          <div v-for="asset in sourceAssets" :key="asset.asset_uid" class="asset-row">
            <span class="badge">{{ asset.kind }}</span>
            <strong>{{ asset.filename }}</strong>
          </div>
        </div>

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
            </div>
            <p class="muted">{{ asset.prompt_text || '暂无 prompt' }}</p>
            <div class="asset-actions">
              <button class="small-button" type="button" @click="decide(asset, 'approved')">确认</button>
              <button class="danger-button" type="button" @click="decide(asset, 'rejected')">舍弃</button>
              <button class="ghost-button" type="button" @click="decide(asset, 'pending')">待定</button>
            </div>
          </div>
        </div>

        <div class="row-actions">
          <button class="danger-button" type="button" @click="regenerateSelected">一键重生图</button>
          <button class="ghost-button" type="button" @click="markReady">标记可提交</button>
        </div>

        <label class="field">
          <span>提交任务机</span>
          <select v-model="selectedMachineId">
            <option value="">选择任务机</option>
            <option v-for="machine in submitMachines" :key="machine.machine_id" :value="machine.machine_id">{{ machine.machine_name }}</option>
          </select>
        </label>
        <button class="primary-button full" type="button" @click="submitJob">提交创建测图任务</button>
      </aside>
    </section>

    <div v-else class="panel empty-state">输入或从审批批次页面选择批次后开始审核</div>
  </section>
</template>
