<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { apiGet, apiPost, type ApiError } from '../api'
import { parseMaterialTestWorkbook } from '../materialDataImport'

interface Summary {
  total_items: number
  total_materials: number
  total_search_exposure: number
  total_search_clicks: number
  weighted_search_ctr: number
  best_image_count: number
  snapshot_material_rows: number
  raw_snapshot_rows: number
  merged_snapshot_rows: number
  statistic_date_count: number
  earliest_statistic_date: string | null
  latest_statistic_date: string | null
  latest_import: { source_filename: string; imported_at: string } | null
}

interface ImageMetric {
  id: number
  style_code: string
  item_id: string
  item_title: string
  statistic_type: string
  statistic_date: string
  image_type: string
  material_id: string
  material_url: string
  search_impressions: number
  search_clicks: number
  search_ctr: number
  detail_impressions: number
  detail_clicks: number
  detail_ctr: number
  detail_add_to_cart: number
  detail_pay_conversion: number
  detail_pay_conversion_rate: number
}

interface StyleReport {
  key: string
  style_code: string
  item_id: string
  item_title: string
  material_count: number
  search_impressions: number
  search_clicks: number
  search_ctr: number
  best_image: ImageMetric | null
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
const snapshotModeLabel = computed(() => filters.value.date ? '指定日期累计快照' : '最新累计快照')
const styleReports = computed<StyleReport[]>(() => {
  const groups = new Map<string, StyleReport>()
  for (const image of images.value) {
    const key = `${image.item_id}|${image.style_code}`
    const current = groups.get(key) ?? {
      key,
      style_code: image.style_code,
      item_id: image.item_id,
      item_title: image.item_title,
      material_count: 0,
      search_impressions: 0,
      search_clicks: 0,
      search_ctr: 0,
      best_image: null,
    }
    current.material_count += 1
    current.search_impressions += Number(image.search_impressions || 0)
    current.search_clicks += Number(image.search_clicks || 0)
    if (!current.best_image || image.search_ctr > current.best_image.search_ctr || (image.search_ctr === current.best_image.search_ctr && image.search_impressions > current.best_image.search_impressions)) {
      current.best_image = image
    }
    groups.set(key, current)
  }
  return [...groups.values()]
    .map((report) => ({
      ...report,
      search_ctr: report.search_impressions > 0 ? report.search_clicks / report.search_impressions : 0,
    }))
    .sort((left, right) => right.search_impressions - left.search_impressions || right.search_ctr - left.search_ctr)
})
const topImage = computed(() => images.value[0] ?? null)

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const [summaryBody, imagesBody] = await Promise.all([
      apiGet<Summary>(`/api/material-test/summary${queryString.value}`),
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

function formatStatisticDate(value?: string | null): string {
  if (!value) return '-'
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : value
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
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

    <section class="snapshot-callout">
      <div>
        <h2>{{ snapshotModeLabel }}</h2>
        <p>天猫导出的累计口径会按统计日期保留多份快照。看板会先合并同一天同一图片的重复记录，再把同一素材的跨日期累计记录合并，只展示最新统计日期；选择日期后展示该日期的累计快照。</p>
      </div>
      <div class="snapshot-badges">
        <span>统计日期 {{ formatStatisticDate(summary?.latest_statistic_date) }}</span>
        <span>原始快照 {{ formatNumber(summary?.raw_snapshot_rows ?? 0) }}</span>
        <span>已合并重复/跨日期快照 {{ formatNumber(summary?.merged_snapshot_rows ?? 0) }}</span>
      </div>
    </section>

    <div class="kpi-grid">
      <div class="metric-card"><span>商品数</span><strong>{{ formatNumber(summary?.total_items ?? 0) }}</strong></div>
      <div class="metric-card"><span>素材数（已合并）</span><strong>{{ formatNumber(summary?.total_materials ?? 0) }}</strong></div>
      <div class="metric-card"><span>搜索曝光（快照）</span><strong>{{ formatNumber(summary?.total_search_exposure ?? 0) }}</strong></div>
      <div class="metric-card"><span>搜索点击（快照）</span><strong>{{ formatNumber(summary?.total_search_clicks ?? 0) }}</strong></div>
      <div class="metric-card"><span>加权搜索 CTR</span><strong>{{ formatPercent(summary?.weighted_search_ctr ?? 0) }}</strong></div>
      <div class="metric-card"><span>最优素材</span><strong>{{ formatNumber(summary?.best_image_count ?? 0) }}</strong></div>
    </div>

    <div v-if="summary?.latest_import" class="action-strip compact-context">
      <strong>最近导入</strong>
      <span>{{ summary.latest_import.source_filename }}</span>
      <span>{{ formatDateTime(summary.latest_import.imported_at) }}</span>
    </div>

    <div class="action-strip">
      <label class="file-action">
        <input type="file" accept=".xlsx,.xls" @change="importWorkbook">
        <span>导入测图数据</span>
      </label>
      <input v-model="crawlMachineId" class="machine-input" placeholder="任务机 ID（可选，不填则自动分配）">
      <button class="secondary-button" type="button" @click="triggerCrawl">下发立即抓取</button>
      <input v-model="scheduleTime" class="time-input" type="time">
      <button class="secondary-button" type="button" @click="createSchedule">保存定时</button>
    </div>

    <section class="report-grid">
      <article class="report-panel">
        <div class="report-head">
          <h2>按款式汇总</h2>
          <span>{{ styleReports.length }} 款</span>
        </div>
        <table class="compact-report-table">
          <thead>
            <tr>
              <th>商品 / 款号</th>
              <th>素材</th>
              <th>曝光</th>
              <th>点击</th>
              <th>CTR</th>
              <th>当前最佳</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="report in styleReports.slice(0, 8)" :key="report.key">
              <td>
                <strong>{{ report.item_id }}</strong>
                <span>{{ report.style_code || '-' }}</span>
              </td>
              <td>{{ formatNumber(report.material_count) }}</td>
              <td>{{ formatNumber(report.search_impressions) }}</td>
              <td>{{ formatNumber(report.search_clicks) }}</td>
              <td>{{ formatPercent(report.search_ctr) }}</td>
              <td>{{ report.best_image?.image_type || '-' }} · {{ formatPercent(report.best_image?.search_ctr ?? 0) }}</td>
            </tr>
            <tr v-if="styleReports.length === 0"><td colspan="6">暂无款式汇总</td></tr>
          </tbody>
        </table>
      </article>

      <article class="report-panel insight-panel">
        <div class="report-head">
          <h2>素材表现结论</h2>
          <span>{{ snapshotModeLabel }}</span>
        </div>
        <div v-if="topImage" class="insight-body">
          <a class="large-thumb" :href="topImage.material_url" target="_blank" rel="noreferrer">
            <img :src="topImage.material_url" alt="">
          </a>
          <div>
            <strong>{{ topImage.image_type || '素材' }} · {{ topImage.item_id }}</strong>
            <p>当前筛选下曝光最高，搜索曝光 {{ formatNumber(topImage.search_impressions) }}，点击 {{ formatNumber(topImage.search_clicks) }}，CTR {{ formatPercent(topImage.search_ctr) }}。</p>
            <span>统计日期 {{ formatStatisticDate(topImage.statistic_date) }}</span>
          </div>
        </div>
        <p v-else class="empty-report">导入测图数据后展示素材表现结论。</p>
      </article>
    </section>

    <div class="table-shell">
      <div class="table-title-row">
        <h2>素材表现明细</h2>
        <span>{{ snapshotModeLabel }} · {{ formatNumber(images.length) }} 条</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>商品 / 款号</th>
            <th>统计日期</th>
            <th>图片类型</th>
            <th>素材</th>
            <th>曝光</th>
            <th>点击</th>
            <th>CTR</th>
            <th>详情曝光</th>
            <th>详情点击</th>
            <th>详情 CTR</th>
            <th>加购</th>
            <th>支付转化率</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="12">加载中...</td></tr>
          <tr v-for="image in images" :key="image.id">
            <td>
              <strong>{{ image.item_id }}</strong>
              <span class="subtle-cell">{{ image.style_code || '-' }}</span>
            </td>
            <td>{{ formatStatisticDate(image.statistic_date) }}</td>
            <td>{{ image.image_type }}</td>
            <td>
              <a class="thumb-link" :href="image.material_url" target="_blank" rel="noreferrer">
                <img :src="image.material_url" alt="">
              </a>
            </td>
            <td>{{ formatNumber(image.search_impressions) }}</td>
            <td>{{ formatNumber(image.search_clicks) }}</td>
            <td>{{ formatPercent(image.search_ctr) }}</td>
            <td>{{ formatNumber(image.detail_impressions) }}</td>
            <td>{{ formatNumber(image.detail_clicks) }}</td>
            <td>{{ formatPercent(image.detail_ctr) }}</td>
            <td>{{ formatNumber(image.detail_add_to_cart) }}</td>
            <td>{{ formatPercent(image.detail_pay_conversion_rate) }}</td>
          </tr>
          <tr v-if="!loading && images.length === 0"><td colspan="12">暂无数据</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.material-dashboard {
  display: grid;
  gap: 16px;
}

.snapshot-callout,
.report-panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
}

.snapshot-callout {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px;
}

.snapshot-callout h2,
.snapshot-callout p,
.report-head h2,
.insight-body p,
.empty-report,
.table-title-row h2 {
  margin: 0;
}

.snapshot-callout h2,
.report-head h2,
.table-title-row h2 {
  font-size: 16px;
  line-height: 1.3;
}

.snapshot-callout p,
.insight-body p,
.empty-report {
  margin-top: 6px;
  color: var(--text2);
  font-size: 13px;
  line-height: 1.55;
}

.snapshot-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  min-width: min(520px, 100%);
}

.snapshot-badges span,
.report-head span,
.insight-body span {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text2);
  padding: 5px 8px;
  font-size: 12px;
  font-weight: 800;
}

.compact-context {
  justify-content: flex-start;
  align-items: center;
  background: var(--bg3);
  color: var(--text2);
  font-size: 13px;
}

.compact-context strong {
  color: var(--text);
}

.report-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.75fr);
  gap: 14px;
  align-items: start;
}

.report-panel {
  min-width: 0;
  overflow: hidden;
}

.report-head,
.table-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid var(--border);
  padding: 12px 14px;
}

.compact-report-table {
  width: 100%;
  border-collapse: collapse;
}

.compact-report-table th,
.compact-report-table td {
  border-bottom: 1px solid var(--border);
  padding: 10px 12px;
  text-align: left;
  vertical-align: middle;
}

.compact-report-table th {
  color: var(--text2);
  font-size: 12px;
  font-weight: 900;
}

.compact-report-table td {
  color: var(--text);
  font-size: 13px;
}

.compact-report-table td:first-child,
.table-shell td:first-child {
  display: grid;
  gap: 3px;
}

.compact-report-table td:first-child span,
.subtle-cell {
  color: var(--text2);
  font-size: 12px;
}

.insight-panel {
  display: grid;
}

.insight-body {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  padding: 14px;
}

.large-thumb,
.thumb-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}

.large-thumb {
  width: 72px;
  height: 72px;
}

.large-thumb img,
.thumb-link img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.table-title-row {
  background: var(--bg2);
}

.table-title-row span {
  color: var(--text2);
  font-size: 12px;
  font-weight: 800;
}

.empty-report {
  padding: 14px;
}

@media (max-width: 980px) {
  .snapshot-callout,
  .report-grid {
    grid-template-columns: 1fr;
  }

  .snapshot-callout {
    display: grid;
  }

  .snapshot-badges {
    justify-content: flex-start;
    min-width: 0;
  }
}
</style>
