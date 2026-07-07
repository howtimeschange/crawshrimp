<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { apiGet, type ApiError } from '../api'

interface SummaryData {
  batch_totals_by_status: Record<string, number>
  image_funnel: Record<string, number>
}

interface PromptMetric {
  version_id: number
  template_id: number
  generated: number
  approved: number
  rejected: number
  approval_rate: number
}

interface MachineMetric {
  machine_id: string
  succeeded: number
  failed: number
}

const summary = ref<SummaryData | null>(null)
const promptMetrics = ref<PromptMetric[]>([])
const machineMetrics = ref<MachineMetric[]>([])
const error = ref('')

const batchTotal = computed(() => Object.values(summary.value?.batch_totals_by_status ?? {}).reduce((total, value) => total + value, 0))

async function load() {
  error.value = ''
  try {
    const [summaryData, promptData, machineData] = await Promise.all([
      apiGet<SummaryData>('/api/dashboard/summary'),
      apiGet<{ prompt_templates: PromptMetric[] }>('/api/dashboard/prompt-performance'),
      apiGet<{ machines: MachineMetric[] }>('/api/dashboard/machine-performance'),
    ])
    summary.value = summaryData
    promptMetrics.value = promptData.prompt_templates
    machineMetrics.value = machineData.machines
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

onMounted(load)
</script>

<template>
  <section class="view-stack">
    <p v-if="error" class="notice danger">{{ error }}</p>
    <div class="metric-grid">
      <div class="metric"><span>批次总数</span><strong>{{ batchTotal }}</strong></div>
      <div class="metric"><span>生成图片</span><strong>{{ summary?.image_funnel.generated ?? 0 }}</strong></div>
      <div class="metric"><span>确认图片</span><strong>{{ summary?.image_funnel.approved ?? 0 }}</strong></div>
      <div class="metric"><span>重生图</span><strong>{{ summary?.image_funnel.regenerated ?? 0 }}</strong></div>
    </div>

    <section class="table-panel">
      <div class="table-header"><h2>批次状态</h2><button class="ghost-button" type="button" @click="load">刷新</button></div>
      <table class="data-table">
        <thead><tr><th>状态</th><th>数量</th></tr></thead>
        <tbody>
          <tr v-for="(count, status) in summary?.batch_totals_by_status ?? {}" :key="status">
            <td><span class="badge">{{ status }}</span></td>
            <td>{{ count }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="split-grid">
      <div class="table-panel">
        <div class="table-header"><h2>Prompt 表现</h2></div>
        <table class="data-table">
          <thead><tr><th>模板</th><th>版本</th><th>生成</th><th>确认率</th><th>舍弃</th></tr></thead>
          <tbody>
            <tr v-for="metric in promptMetrics" :key="metric.version_id">
              <td>{{ metric.template_id }}</td>
              <td>{{ metric.version_id }}</td>
              <td>{{ metric.generated }}</td>
              <td>{{ Math.round(metric.approval_rate * 100) }}%</td>
              <td>{{ metric.rejected }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="promptMetrics.length === 0" class="empty-state">暂无 Prompt 指标</div>
      </div>

      <div class="table-panel">
        <div class="table-header"><h2>任务机指标</h2></div>
        <table class="data-table">
          <thead><tr><th>任务机</th><th>成功</th><th>失败</th></tr></thead>
          <tbody>
            <tr v-for="metric in machineMetrics" :key="metric.machine_id">
              <td>{{ metric.machine_id }}</td>
              <td>{{ metric.succeeded }}</td>
              <td>{{ metric.failed }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="machineMetrics.length === 0" class="empty-state">暂无任务机指标</div>
      </div>
    </section>
  </section>
</template>
