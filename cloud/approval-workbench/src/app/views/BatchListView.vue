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

onMounted(load)
</script>

<template>
  <section class="view-stack">
    <p v-if="error" class="notice danger">{{ error }}</p>
    <section class="panel toolbar">
      <label class="field">
        <span>状态筛选</span>
        <select v-model="statusFilter">
          <option v-for="status in statuses" :key="status" :value="status">{{ status === 'all' ? '全部' : status }}</option>
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
      <table class="data-table">
        <thead><tr><th>批次</th><th>状态</th><th>来源</th><th>创建</th><th>更新</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="batch in filteredBatches" :key="batch.batch_uid">
            <td><strong>{{ batch.title }}</strong><br /><span class="muted">{{ batch.batch_uid }} · {{ batch.local_run_id || '-' }}</span></td>
            <td><span class="badge">{{ batch.status }}</span></td>
            <td>{{ batch.source_machine_id || '-' }}</td>
            <td>{{ batch.created_at }}</td>
            <td>{{ batch.updated_at }}</td>
            <td><button class="primary-button" type="button" @click="emit('review', batch.batch_uid)">进入审批</button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="filteredBatches.length === 0" class="empty-state">没有符合条件的批次</div>
    </section>
  </section>
</template>
