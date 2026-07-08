<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { apiGet, apiPost, type ApiError } from '../api'
import { parseMaterialTestWorkbook } from '../materialDataImport'

interface Summary {
  total_items: number
  total_materials: number
  total_search_exposure: number
  weighted_search_ctr: number
  best_image_count: number
  latest_import: { source_filename: string; imported_at: string } | null
}

interface ImageMetric {
  id: number
  style_code: string
  item_id: string
  image_type: string
  material_url: string
  search_impressions: number
  search_clicks: number
  search_ctr: number
  detail_clicks: number
  detail_add_to_cart: number
  detail_pay_conversion_rate: number
}

const summary = ref<Summary | null>(null)
const images = ref<ImageMetric[]>([])
const loading = ref(false)
const actionMessage = ref('')
const error = ref('')
const filters = ref({ statistic_type: '', date: '', image_type: '', q: '' })
const crawlMachineId = ref('')
const scheduleTime = ref('09:30')
const DETAIL_IMPORT_CHUNK_SIZE = 800

const queryString = computed(() => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters.value)) {
    if (value.trim()) params.set(key, value.trim())
  }
  const text = params.toString()
  return text ? `?${text}` : ''
})

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const [summaryBody, imagesBody] = await Promise.all([
      apiGet<Summary>('/api/material-test/summary'),
      apiGet<{ images: ImageMetric[] }>(`/api/material-test/images${queryString.value}`),
    ])
    summary.value = summaryBody
    images.value = imagesBody.images
  } catch (err) {
    error.value = (err as ApiError).message
  } finally {
    loading.value = false
  }
}

async function importWorkbook(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  actionMessage.value = ''
  error.value = ''
  try {
    const parsed = await parseMaterialTestWorkbook(file)
    const sourceUid = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const source = { ...parsed.source, source_uid: sourceUid }
    let overviewRows = 0
    let detailRows = 0
    let insertedOrUpdated = 0
    const detailChunks = chunkRows(parsed.detail_rows, DETAIL_IMPORT_CHUNK_SIZE)
    const firstDetailChunk = detailChunks.shift() ?? []
    const firstResponse = await apiPost<{ overview_rows: number; detail_rows: number; inserted_or_updated: number }>('/api/material-test/import', {
      source,
      overview_rows: parsed.overview_rows,
      detail_rows: firstDetailChunk,
    })
    overviewRows += firstResponse.overview_rows
    detailRows += firstResponse.detail_rows
    insertedOrUpdated += firstResponse.inserted_or_updated
    for (const detailChunk of detailChunks) {
      const response = await apiPost<{ overview_rows: number; detail_rows: number; inserted_or_updated: number }>('/api/material-test/import', {
        source,
        overview_rows: [],
        detail_rows: detailChunk,
      })
      detailRows += response.detail_rows
      insertedOrUpdated += response.inserted_or_updated
      actionMessage.value = `正在导入 ${overviewRows} 条概览、${detailRows}/${parsed.detail_rows.length} 条明细`
    }
    actionMessage.value = `已导入 ${overviewRows} 条概览、${detailRows} 条明细，写入 ${insertedOrUpdated} 条`
    await refresh()
  } catch (err) {
    error.value = (err as ApiError).message
  } finally {
    input.value = ''
  }
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size))
  }
  return chunks
}

async function triggerCrawl() {
  actionMessage.value = ''
  error.value = ''
  try {
    const body = await apiPost<{ job: { job_uid: string } }>('/api/material-test/crawl-jobs', {
      machine_id: crawlMachineId.value.trim(),
      run_params: { statistic_type: filters.value.statistic_type || 'ACCUMULATE_30_DAYS' },
    })
    actionMessage.value = `抓取任务已创建：${body.job.job_uid}`
  } catch (err) {
    error.value = (err as ApiError).message
  }
}

async function createSchedule() {
  actionMessage.value = ''
  error.value = ''
  try {
    await apiPost('/api/material-test/schedules', {
      schedule_time: scheduleTime.value,
      machine_id: crawlMachineId.value.trim(),
      statistic_type: filters.value.statistic_type || 'ACCUMULATE_30_DAYS',
    })
    actionMessage.value = `定时抓取已保存：${scheduleTime.value}`
  } catch (err) {
    error.value = (err as ApiError).message
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value || 0)
}

function formatPercent(value: number): string {
  return `${((value || 0) * 100).toFixed(2)}%`
}

onMounted(refresh)
</script>

<template>
  <section class="material-dashboard">
    <div class="toolbar-row">
      <div class="filter-grid">
        <label>
          <span>统计口径</span>
          <select v-model="filters.statistic_type" @change="refresh">
            <option value="">全部</option>
            <option value="ACCUMULATE_30_DAYS">ACCUMULATE_30_DAYS</option>
            <option value="DAILY">DAILY</option>
          </select>
        </label>
        <label>
          <span>日期</span>
          <input v-model="filters.date" type="date" @change="refresh">
        </label>
        <label>
          <span>图片类型</span>
          <input v-model="filters.image_type" placeholder="如 主图" @change="refresh">
        </label>
        <label>
          <span>款号 / 商品</span>
          <input v-model="filters.q" placeholder="搜索款号或商品ID" @keyup.enter="refresh">
        </label>
      </div>
      <button class="primary-button" type="button" @click="refresh">刷新</button>
    </div>

    <p v-if="error" class="notice danger">{{ error }}</p>
    <p v-if="actionMessage" class="notice">{{ actionMessage }}</p>

    <div class="kpi-grid">
      <div class="metric-card"><span>商品数</span><strong>{{ formatNumber(summary?.total_items ?? 0) }}</strong></div>
      <div class="metric-card"><span>素材数</span><strong>{{ formatNumber(summary?.total_materials ?? 0) }}</strong></div>
      <div class="metric-card"><span>搜索曝光</span><strong>{{ formatNumber(summary?.total_search_exposure ?? 0) }}</strong></div>
      <div class="metric-card"><span>加权搜索 CTR</span><strong>{{ formatPercent(summary?.weighted_search_ctr ?? 0) }}</strong></div>
      <div class="metric-card"><span>最优素材</span><strong>{{ formatNumber(summary?.best_image_count ?? 0) }}</strong></div>
    </div>

    <div class="action-strip">
      <label class="file-action">
        <input type="file" accept=".xlsx,.xls" @change="importWorkbook">
        <span>导入工作簿</span>
      </label>
      <input v-model="crawlMachineId" class="machine-input" placeholder="任务机 ID（可选）">
      <button class="secondary-button" type="button" @click="triggerCrawl">立即抓取</button>
      <input v-model="scheduleTime" class="time-input" type="time">
      <button class="secondary-button" type="button" @click="createSchedule">保存定时</button>
    </div>

    <div class="table-shell">
      <table>
        <thead>
          <tr>
            <th>款号</th>
            <th>商品ID</th>
            <th>图片类型</th>
            <th>素材</th>
            <th>曝光</th>
            <th>点击</th>
            <th>CTR</th>
            <th>详情点击</th>
            <th>加购</th>
            <th>支付转化率</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="10">加载中...</td></tr>
          <tr v-for="image in images" :key="image.id">
            <td>{{ image.style_code }}</td>
            <td>{{ image.item_id }}</td>
            <td>{{ image.image_type }}</td>
            <td>
              <a class="thumb-link" :href="image.material_url" target="_blank" rel="noreferrer">
                <img :src="image.material_url" alt="">
              </a>
            </td>
            <td>{{ formatNumber(image.search_impressions) }}</td>
            <td>{{ formatNumber(image.search_clicks) }}</td>
            <td>{{ formatPercent(image.search_ctr) }}</td>
            <td>{{ formatNumber(image.detail_clicks) }}</td>
            <td>{{ formatNumber(image.detail_add_to_cart) }}</td>
            <td>{{ formatPercent(image.detail_pay_conversion_rate) }}</td>
          </tr>
          <tr v-if="!loading && images.length === 0"><td colspan="10">暂无数据</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
