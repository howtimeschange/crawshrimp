<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { apiGet, type ApiError } from '../api'

interface BatchRow {
  batch_uid: string
  title: string
  status: string
  local_run_id: string
  source_machine_id: string | null
  created_at: string
  updated_at: string
  previews?: AssetPreview[]
}

interface AssetPreview {
  asset_uid: string
  kind: string
  status: string
  filename: string
}

const emit = defineEmits<{ review: [batchUid: string] }>()

const batches = ref<BatchRow[]>([])
const statusFilter = ref('all')
const search = ref('')
const error = ref('')

const statuses = ['all', 'syncing', 'pending_review', 'ready_to_submit', 'submitted']
const filteredBatches = computed(() => {
  const query = search.value.trim().toLowerCase()
  return batches.value.filter((batch) => {
    const matchesStatus = statusFilter.value === 'all' || batch.status === statusFilter.value
    const text = `${batch.batch_uid} ${batch.title} ${batch.local_run_id}`.toLowerCase()
    return matchesStatus && (!query || text.includes(query))
  })
})

async function load() {
  try {
    const data = await apiGet<{ batches: BatchRow[] }>('/api/ai-image-batches')
    batches.value = data.batches
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

function formatBeijingTime(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value || '-'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}

function assetDownloadUrl(asset: AssetPreview): string {
  return `/api/assets/${encodeURIComponent(asset.asset_uid)}/download`
}

function previewKindLabel(kind: string): string {
  if (kind === 'source') return '原图'
  if (kind === 'reference') return '参考'
  if (kind === 'ai') return 'AI'
  return kind || '图'
}

function batchStatusLabel(status: string): string {
  if (status === 'syncing') return '同步中'
  if (status === 'pending_review') return '待审批'
  if (status === 'ready_to_submit') return '可提交'
  if (status === 'submitted') return '已提交'
  if (status === 'rejected') return '已退回'
  return status || '-'
}

onMounted(load)
</script>

<template>
  <section class="view-stack">
    <p v-if="error" class="notice danger">{{ error }}</p>
    <section class="panel toolbar">
      <label class="field">
        <span>状态筛选</span>
        <select v-model="statusFilter">
          <option v-for="status in statuses" :key="status" :value="status">{{ status === 'all' ? '全部' : batchStatusLabel(status) }}</option>
        </select>
      </label>
      <label class="field">
        <span>批次搜索</span>
        <input v-model="search" placeholder="批次号、标题、运行 ID" />
      </label>
      <button class="ghost-button" type="button" @click="load">刷新</button>
    </section>

    <section class="table-panel">
      <div class="table-header"><h2>审批批次</h2><span class="badge">{{ filteredBatches.length }} 条</span></div>
      <table class="data-table batch-list-table">
        <thead><tr><th>批次</th><th>预览</th><th>状态</th><th>来源</th><th>创建(北京)</th><th>更新(北京)</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="batch in filteredBatches" :key="batch.batch_uid">
            <td><strong>{{ batch.title }}</strong><br /><span class="muted">{{ batch.batch_uid }} · {{ batch.local_run_id || '-' }}</span></td>
            <td>
              <div v-if="batch.previews?.length" class="batch-preview-strip">
                <a
                  v-for="preview in batch.previews"
                  :key="preview.asset_uid"
                  class="batch-preview-thumb"
                  :href="assetDownloadUrl(preview)"
                  target="_blank"
                  rel="noopener"
                  :title="`${previewKindLabel(preview.kind)} ${preview.filename}`"
                >
                  <img :src="assetDownloadUrl(preview)" :alt="`${previewKindLabel(preview.kind)} ${preview.filename}`" />
                  <span :class="preview.kind">{{ previewKindLabel(preview.kind) }}</span>
                </a>
              </div>
              <span v-else class="muted">暂无图片</span>
            </td>
            <td><span class="badge">{{ batchStatusLabel(batch.status) }}</span></td>
            <td>{{ batch.source_machine_id || '-' }}</td>
            <td>{{ formatBeijingTime(batch.created_at) }}</td>
            <td>{{ formatBeijingTime(batch.updated_at) }}</td>
            <td><button class="primary-button" type="button" @click="emit('review', batch.batch_uid)">进入审批</button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="filteredBatches.length === 0" class="empty-state">没有符合条件的批次</div>
    </section>
  </section>
</template>

<style scoped>
.batch-list-table td {
  vertical-align: middle;
}

.batch-preview-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 220px;
}

.batch-preview-thumb {
  position: relative;
  display: block;
  width: 58px;
  height: 58px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  overflow: hidden;
}

.batch-preview-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.batch-preview-thumb span {
  position: absolute;
  left: 4px;
  bottom: 4px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 6px;
  background: rgba(10, 10, 14, 0.72);
  color: #fff;
  padding: 1px 5px;
  font-size: 10px;
  font-weight: 900;
}

.batch-preview-thumb span.ai {
  border-color: rgba(255, 107, 43, 0.58);
  color: #ffd8c7;
}
</style>
