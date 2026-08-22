<template>
  <section class="bsv-workbench">
    <header class="bsv-topbar">
      <div>
        <p class="bsv-kicker">AI 买家秀</p>
        <h2>AI 买家秀工作流</h2>
        <p class="bsv-subtitle">Excel 解析、森马云盘找图、AI 生图和本地打包</p>
      </div>
      <div class="bsv-top-actions">
        <button type="button" class="bsv-ghost" :disabled="!primaryOutputTarget" @click="openPrimaryOutput">打开输出目录</button>
      </div>
    </header>

    <nav class="bsv-stepper" role="tablist" aria-label="AI 买家秀工作流步骤">
      <button
        v-for="step in steps"
        :key="step.id"
        type="button"
        role="tab"
        :class="['bsv-step', { active: activeStep === step.id, done: step.done }]"
        :aria-selected="activeStep === step.id"
        @click="selectStep(step)"
      >
        <span class="bsv-step-index">{{ step.index }}</span>
        <span class="bsv-step-copy">
          <strong>{{ step.title }}</strong>
          <small>{{ step.detail }}</small>
        </span>
      </button>
    </nav>

    <main class="bsv-stage" :aria-busy="taskState.status === 'running' ? 'true' : 'false'">
      <section v-if="activeStep === 'match'" class="bsv-stage-grid">
        <aside class="bsv-panel bsv-params-panel">
          <header class="bsv-panel-head">
            <div>
              <strong>Excel 与找图参数</strong>
              <span>{{ taskState.status === 'running' ? '任务进行中' : '待命' }}</span>
            </div>
          </header>
          <div class="bsv-panel-body">
            <label class="bsv-field">
              <span>买家秀 Excel</span>
              <div class="bsv-file-picker">
                <strong :title="excelPath">{{ excelPath ? fileName(excelPath) : '请选择 Excel 文件' }}</strong>
                <button type="button" class="bsv-ghost small" @click="pickExcel">选择</button>
                <button v-if="excelPath" type="button" class="bsv-ghost small" @click="previewExcel">预览</button>
              </div>
            </label>
            <label class="bsv-field">
              <span>平铺参考图库路径</span>
              <input v-model="flatCloudPath" />
            </label>
            <label class="bsv-field">
              <span>本地图包目录</span>
              <div class="bsv-file-picker">
                <strong :title="exportFolder">{{ exportFolder || '默认保存到下载目录' }}</strong>
                <button type="button" class="bsv-ghost small" @click="pickExportFolder">选择</button>
              </div>
            </label>
            <label class="bsv-field">
              <span>图包名称</span>
              <input v-model="packageName" />
            </label>
            <label class="bsv-field">
              <span>执行模式</span>
              <select v-model="executeMode">
                <option value="generate">下载并真实生图</option>
                <option value="download_only">只下载匹配素材</option>
                <option value="resume">续跑原图包</option>
              </select>
            </label>
            <label class="bsv-field">
              <span>生图模型</span>
              <select v-model="selectedModelId">
                <option v-for="model in buyerShowModelOptions" :key="model.id" :value="model.id">
                  {{ model.label }}
                </option>
              </select>
            </label>
            <label v-if="isResumeMode" class="bsv-field">
              <span>续跑原图包目录</span>
              <div class="bsv-file-picker">
                <strong :title="resumePackageDir">{{ resumePackageDir || '请选择已有图包文件夹' }}</strong>
                <button type="button" class="bsv-ghost small" @click="pickResumePackageDir">选择</button>
              </div>
            </label>
            <label class="bsv-field">
              <span>自定义 Prompt</span>
              <textarea v-model="customPrompt" rows="4" placeholder="特殊款可填写；留空使用默认买家秀换装 Prompt"></textarea>
            </label>
            <label class="bsv-field">
              <span>补充约束</span>
              <textarea v-model="promptExtra" rows="3"></textarea>
            </label>
            <section class="bsv-progress-card" :class="taskState.status">
              <div>
                <strong>{{ taskState.message }}</strong>
                <span>{{ excelPreview.rowCount }} 行 Excel · {{ taskState.records || 0 }} 条结果</span>
              </div>
              <i class="bsv-progress-bar" :style="{ '--progress': `${overallProgress}%` }"></i>
              <div class="bsv-progress-grid">
                <span>找图 {{ searchLabel }}</span>
                <span>下载 {{ downloadLabel }}</span>
                <span>生图 {{ generationLabel }}</span>
              </div>
            </section>
            <button type="button" class="bsv-primary wide" :disabled="taskState.status === 'running'" @click="startWorkflow">
              {{ startButtonLabel }}
            </button>
            <button v-if="taskState.status === 'running'" type="button" class="bsv-ghost wide danger" @click="stopWorkflow">
              停止任务
            </button>
          </div>
        </aside>

        <section class="bsv-panel">
          <header class="bsv-panel-head">
            <div>
              <strong>Excel 解析预览</strong>
              <span>{{ excelPreview.status }}</span>
            </div>
          </header>
          <div class="bsv-panel-body bsv-preview-body">
            <div v-if="excelPreview.error" class="bsv-inline-error">{{ excelPreview.error }}</div>
            <div v-else-if="excelPreview.rows.length" class="bsv-table-shell">
              <table>
                <thead>
                  <tr>
                    <th>订单号</th>
                    <th>款色号</th>
                    <th>尺码</th>
                    <th>唯一值</th>
                    <th>AI素材库路径</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, index) in excelPreview.rows.slice(0, 12)" :key="index">
                    <td>{{ row['订单号'] }}</td>
                    <td>{{ row['款色号'] }}</td>
                    <td>{{ row['尺码'] }}</td>
                    <td>{{ row['唯一值'] }}</td>
                    <td>{{ row['AI素材库路径'] }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="bsv-empty-inline">
              选择 Excel 后会显示前几行数据。
            </div>
          </div>
        </section>
      </section>

      <section v-else-if="activeStep === 'generate'" class="bsv-two-column">
        <section class="bsv-panel">
          <header class="bsv-panel-head">
            <div>
              <strong>AI 生图队列</strong>
              <span>{{ taskState.currentLabel || '等待任务状态' }}</span>
            </div>
          </header>
          <div class="bsv-panel-body">
            <div class="bsv-stat-grid">
              <div>
                <strong>{{ generationPendingCount }}</strong>
                <span>待生图</span>
              </div>
              <div>
                <strong>{{ taskState.generationCompleted || 0 }}</strong>
                <span>已拿链接</span>
              </div>
              <div>
                <strong>{{ resultDownloadLabel }}</strong>
                <span>已落图</span>
              </div>
              <div>
                <strong>{{ taskState.records || 0 }}</strong>
                <span>结果行</span>
              </div>
            </div>
            <div class="bsv-log-box">
              <p v-for="(line, index) in taskState.logs.slice(-12)" :key="index">{{ line }}</p>
            </div>
          </div>
        </section>
        <section class="bsv-panel">
          <header class="bsv-panel-head">
            <div>
              <strong>Prompt 策略</strong>
              <span>{{ customPrompt ? '自定义 Prompt' : '默认部位定向替换' }}</span>
            </div>
          </header>
          <div class="bsv-panel-body bsv-copy-list">
            <span>常规款：上装、下装、鞋类自动判断替换部位</span>
            <span>特殊款：羽绒服、套装、连体衣等可用自定义 Prompt 收紧约束</span>
            <span>主图：模拍图；参考图：按款色号自动匹配平铺图</span>
          </div>
        </section>
      </section>

      <section v-else class="bsv-result-layout">
        <section class="bsv-panel bsv-run-list-panel">
          <header class="bsv-panel-head">
            <div>
              <strong>历史任务队列</strong>
              <span>{{ resultHistoryRuns.length }} 条本机记录</span>
            </div>
            <button type="button" class="bsv-ghost small" @click="loadResultHistory()">刷新</button>
          </header>
          <div class="bsv-panel-body">
            <div v-if="resultHistoryError" class="bsv-inline-error">{{ resultHistoryError }}</div>
            <div v-else-if="resultHistoryLoading" class="bsv-empty-inline">正在读取本机历史任务...</div>
            <div v-else-if="!resultHistoryRuns.length" class="bsv-empty-inline">暂无 AI 买家秀历史任务。</div>
            <div v-else class="bsv-run-table-shell">
              <table class="bsv-run-table">
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>状态</th>
                    <th>完成时间</th>
                    <th>结果</th>
                    <th>输出</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="run in resultHistoryRuns"
                    :key="runKey(run)"
                    :class="{ selected: selectedResultRunId === runKey(run) }"
                    tabindex="0"
                    :aria-selected="selectedResultRunId === runKey(run)"
                    @click="selectResultRun(run)"
                    @keydown.enter.prevent="selectResultRun(run)"
                    @keydown.space.prevent="selectResultRun(run)"
                  >
                    <td>#{{ run.id }}</td>
                    <td><span :class="['bsv-status-pill', runStatusClass(run.status)]">{{ runStatusLabel(run.status) }}</span></td>
                    <td>{{ formatRunTime(run) }}</td>
                    <td>{{ Number(run.records_count || 0) }} 行</td>
                    <td>{{ parseRunOutputFiles(run).length }} 个</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section class="bsv-panel bsv-run-detail-panel">
          <header class="bsv-panel-head">
            <div>
              <strong>{{ selectedResultRun ? `任务 #${selectedResultRun.id}` : '结果详情' }}</strong>
              <span>{{ selectedResultRun ? formatRunTime(selectedResultRun) : '选择左侧任务查看输出' }}</span>
            </div>
            <button type="button" class="bsv-primary" :disabled="!primaryOutputTarget" @click="openPrimaryOutput">打开结果目录</button>
          </header>
          <div class="bsv-panel-body">
            <div class="bsv-result-summary" :class="runStatusClass(selectedResultRun?.status || taskState.status)">
              <strong>{{ selectedResultRun ? runStatusLabel(selectedResultRun.status) : taskState.message }}</strong>
              <span>{{ selectedResultSummary }}</span>
            </div>
            <div class="bsv-output-list">
              <article v-for="file in selectedResultFiles" :key="file">
                <strong>{{ outputFileLabel(file) }}</strong>
                <span :title="file">{{ file }}</span>
                <button type="button" class="bsv-ghost small" @click="openFile(file)">打开</button>
              </article>
            </div>
            <div v-if="selectedResultRun && !selectedResultFiles.length" class="bsv-empty-inline">该任务没有可打开的输出文件。</div>
          </div>
        </section>
      </section>
    </main>
  </section>
</template>

<script setup>
import { computed, onUnmounted, reactive, ref } from 'vue'
import { AI_IMAGE_MODELS } from '../utils/aiImageModels.js'

const ADAPTER_ID = 'semir-cloud-drive'
const TASK_ID = 'buyer_show_ai_generate'
const DEFAULT_EXCEL_PATH = ''
const DEFAULT_FLAT_PATH = '巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/'
const DEFAULT_EXPORT_FOLDER = '~/Downloads/AI 买家秀全量测试'
const DEFAULT_MODEL_ID = 'gpt-image-4k'
const BUYER_SHOW_MODEL_LABELS = {
  'gemini-3.1-flash-image-preview': 'Gemini Flash',
  'gemini-3-pro-image-preview': 'Gemini Pro',
}
const buyerShowModelOptions = AI_IMAGE_MODELS.map(model => ({
  ...model,
  label: BUYER_SHOW_MODEL_LABELS[model.id] || model.label,
}))

const activeStep = ref('match')
const excelPath = ref(DEFAULT_EXCEL_PATH)
const flatCloudPath = ref(DEFAULT_FLAT_PATH)
const exportFolder = ref(DEFAULT_EXPORT_FOLDER)
const packageName = ref('AI买家秀')
const executeMode = ref('generate')
const selectedModelId = ref(DEFAULT_MODEL_ID)
const resumePackageDir = ref('')
const customPrompt = ref('')
const promptExtra = ref('')
const pollTimer = ref(null)
let currentRunId = ''

const excelPreview = reactive({
  rows: [],
  headers: [],
  rowCount: 0,
  status: '等待选择 Excel',
  error: '',
})

const taskState = reactive({
  status: 'idle',
  message: '等待选择 Excel 后开始找图',
  error: '',
  runId: '',
  records: 0,
  currentLabel: '',
  searchTotal: 0,
  searchCompleted: 0,
  downloadTotal: 0,
  downloadCompleted: 0,
  downloadSuccess: 0,
  downloadFailed: 0,
  generationTotal: 0,
  generationCompleted: 0,
  resultDownloadSubmitted: 0,
  resultDownloadTotal: 0,
  resultDownloadCompleted: 0,
  logs: [],
})

const outputFiles = ref([])
const manualStepSelection = ref(false)
const resultHistoryRuns = ref([])
const selectedResultRunId = ref('')
const resultHistoryLoading = ref(false)
const resultHistoryError = ref('')

const steps = computed(() => [
  { id: 'match', index: 1, title: '找图', detail: '导入表格与设置参数', done: ['generate', 'result'].includes(activeStep.value) || taskState.searchCompleted > 0 },
  { id: 'generate', index: 2, title: 'AI 生图', detail: '查看下载与生图进度', done: ['done', 'failed'].includes(taskState.status) },
  { id: 'result', index: 3, title: '结果', detail: '任务结束后查看结果', done: taskState.status === 'done' },
])

const searchLabel = computed(() => taskState.searchTotal ? `${taskState.searchCompleted}/${taskState.searchTotal}` : '0/0')
const downloadLabel = computed(() => taskState.downloadTotal ? `${taskState.downloadCompleted}/${taskState.downloadTotal}` : '0/0')
const generationLabel = computed(() => taskState.generationTotal ? `${taskState.generationCompleted}/${taskState.generationTotal}` : '0/0')
const generationPendingCount = computed(() => Math.max(0, Number(taskState.generationTotal || 0) - Number(taskState.generationCompleted || 0)))
const resultDownloadTotal = computed(() => Math.max(
  Number(taskState.resultDownloadTotal || 0),
  Number(taskState.resultDownloadSubmitted || 0),
  Number(taskState.generationTotal || 0),
))
const resultDownloadLabel = computed(() => resultDownloadTotal.value ? `${taskState.resultDownloadCompleted}/${resultDownloadTotal.value}` : '0/0')
const selectedResultRun = computed(() => {
  const selectedId = String(selectedResultRunId.value || '').trim()
  if (!selectedId) return null
  return resultHistoryRuns.value.find(run => runKey(run) === selectedId) || null
})
const selectedResultFiles = computed(() => (
  selectedResultRun.value ? parseRunOutputFiles(selectedResultRun.value) : outputFiles.value
))
const activeOutputFiles = computed(() => (
  activeStep.value === 'result' ? selectedResultFiles.value : outputFiles.value
))
const selectedResultSummary = computed(() => {
  const run = selectedResultRun.value
  if (!run) return taskState.error || `${taskState.records || 0} 条结果；${outputFiles.value.length} 个输出引用`
  const files = parseRunOutputFiles(run)
  const error = String(run.error || '').trim()
  if (error) return error
  return `${Number(run.records_count || 0)} 条结果；${files.length} 个输出引用`
})
const overallProgress = computed(() => {
  if (taskState.status === 'done') return 100
  if (taskState.status === 'failed') return Math.max(8, taskState.records ? 70 : 12)
  const search = taskState.searchTotal ? taskState.searchCompleted / taskState.searchTotal : 0
  const download = taskState.downloadTotal ? taskState.downloadCompleted / taskState.downloadTotal : 0
  const generation = taskState.generationTotal ? taskState.generationCompleted / taskState.generationTotal : 0
  const resultDownload = resultDownloadTotal.value ? taskState.resultDownloadCompleted / resultDownloadTotal.value : 0
  return Math.round(Math.max(search * 30, download * 48, generation * 78, resultDownload * 92, taskState.status === 'running' ? 8 : 0))
})
const isResumeMode = computed(() => ['resume', 'recover', 'resume_recover', 'resume-recover'].includes(String(executeMode.value || '').toLowerCase()))
const selectedAiModel = computed(() => (
  buyerShowModelOptions.find(model => model.id === selectedModelId.value)
  || buyerShowModelOptions.find(model => model.id === DEFAULT_MODEL_ID)
  || buyerShowModelOptions[0]
))
const startButtonLabel = computed(() => {
  if (taskState.status === 'running') return '正在执行...'
  return isResumeMode.value ? '开始续跑原图包' : '开始 Excel 找图并生图'
})
const primaryOutputTarget = computed(() => (
  activeOutputFiles.value.find(file => !/\.[a-z0-9]{2,5}$/i.test(file))
  || (isResumeMode.value ? resumePackageDir.value : '')
  || exportFolder.value
  || activeOutputFiles.value[0]
  || ''
))

function fileName(value) {
  return String(value || '').split(/[\\/]/).filter(Boolean).pop() || ''
}

function dirName(value) {
  const text = String(value || '').replace(/[\\/]+$/, '')
  const separator = text.includes('\\') ? '\\' : '/'
  const parts = text.split(/[\\/]/).filter(Boolean)
  parts.pop()
  if (!parts.length) return ''
  if (text.startsWith(separator)) return `${separator}${parts.join(separator)}`
  return parts.join(separator)
}

function outputFileLabel(file) {
  const value = String(file || '')
  if (/使用记录\.xlsx$/i.test(value)) return '使用记录表'
  if (/执行结果\.xlsx$/i.test(value) || /匹配下载结果/i.test(value)) return '执行结果表'
  if (/\.zip$/i.test(value)) return 'ZIP 图包'
  if (!/\.[a-z0-9]{2,5}$/i.test(value)) return '本地图包文件夹'
  return fileName(value)
}

function parseOutputFiles(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean)
  try {
    const parsed = JSON.parse(String(value || '[]'))
    return Array.isArray(parsed) ? parsed.map(item => String(item || '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function parseRunOutputFiles(run) {
  return parseOutputFiles(run?.output_files)
}

function runKey(run) {
  return String(run?.id || run?.run_id || '').trim()
}

function selectResultRun(run) {
  selectedResultRunId.value = runKey(run)
}

function runStatusClass(status) {
  const value = String(status || '').toLowerCase()
  if (['done', 'success', 'completed', 'partial'].includes(value)) return 'done'
  if (['failed', 'error', 'stopped', 'cancelled'].includes(value)) return 'failed'
  if (['running', 'queued', 'paused', 'pausing', 'stopping'].includes(value)) return 'running'
  return 'idle'
}

function runStatusLabel(status) {
  const value = runStatusClass(status)
  if (value === 'done') return '完成'
  if (value === 'failed') return String(status || '').toLowerCase() === 'stopped' ? '已停止' : '失败'
  if (value === 'running') return '进行中'
  return '未知'
}

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value || '')
  return date.toLocaleString('zh-CN', { hour12: false }).replace(',', '')
}

function formatRunTime(run) {
  return formatDateTime(run?.finished_at || run?.last_seen_at || run?.started_at)
}

async function loadResultHistory(preferredRunId = '') {
  resultHistoryLoading.value = true
  resultHistoryError.value = ''
  try {
    const data = await window.cs.getData(ADAPTER_ID, TASK_ID, { limit: 0 })
    const runs = Array.isArray(data?.runs) ? data.runs : []
    resultHistoryRuns.value = runs
    const preferredId = String(preferredRunId || selectedResultRunId.value || currentRunId || '').trim()
    const selected = (preferredId ? runs.find(run => runKey(run) === preferredId) : null) || runs[0] || null
    selectedResultRunId.value = selected ? runKey(selected) : ''
    if (selected) outputFiles.value = parseRunOutputFiles(selected)
  } catch (error) {
    resultHistoryError.value = error?.message || String(error)
  } finally {
    resultHistoryLoading.value = false
  }
}

function toPlainJson(value, fallback) {
  try {
    const cloned = JSON.parse(JSON.stringify(value ?? fallback))
    return cloned ?? fallback
  } catch {
    return fallback
  }
}

function selectStep(step) {
  activeStep.value = step.id
  manualStepSelection.value = true
  if (step.id === 'result') loadResultHistory()
}

function setAutoStep(stepId) {
  if (!manualStepSelection.value) activeStep.value = stepId
}

function currentRunLogLines(logs = []) {
  const lines = Array.isArray(logs) ? logs.map(line => String(line || '')) : []
  let markerIndex = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/新运行/.test(lines[index])) {
      markerIndex = index
      break
    }
  }
  return markerIndex >= 0 ? lines.slice(markerIndex + 1) : lines
}

function applyProgressFromLogs(logs = []) {
  const lines = currentRunLogLines(logs)
  let visibleMaterialized = 0
  for (const line of lines) {
    let match = line.match(/待生成\s+(\d+)\s+行/)
    if (match) {
      taskState.generationTotal = Math.max(taskState.generationTotal, Number(match[1] || 0))
    }
    match = line.match(/续跑待落图\s+(\d+)\s+行/)
    if (match) {
      const value = Number(match[1] || 0)
      taskState.resultDownloadSubmitted = Math.max(taskState.resultDownloadSubmitted, value)
      taskState.resultDownloadTotal = Math.max(taskState.resultDownloadTotal, value)
    }
    match = line.match(/AI 生图链接收集进度\s+(\d+)\s*\/\s*(\d+)(?:[；;]\s*已入落图队列\s+(\d+))?/)
    if (match) {
      taskState.generationCompleted = Math.max(taskState.generationCompleted, Number(match[1] || 0))
      taskState.generationTotal = Math.max(taskState.generationTotal, Number(match[2] || 0))
      if (match[3]) {
        const submitted = Number(match[3] || 0)
        taskState.resultDownloadSubmitted = Math.max(taskState.resultDownloadSubmitted, submitted)
        taskState.resultDownloadTotal = Math.max(taskState.resultDownloadTotal, submitted)
      }
    }
    match = line.match(/AI 结果落图进度\s+(\d+)\s*\/\s*(\d+)/)
    if (match) {
      taskState.resultDownloadCompleted = Math.max(taskState.resultDownloadCompleted, Number(match[1] || 0))
      taskState.resultDownloadTotal = Math.max(taskState.resultDownloadTotal, Number(match[2] || 0))
      taskState.resultDownloadSubmitted = Math.max(taskState.resultDownloadSubmitted, Number(match[2] || 0))
    }
    if (/\[buyer-show\]\s+(已生成|落图失败):/.test(line)) visibleMaterialized += 1
    match = line.match(/Script complete\.\s*Records:\s*(\d+)/i) || line.match(/开始后处理\s+(\d+)\s+行/)
    if (match) {
      taskState.records = Math.max(taskState.records, Number(match[1] || 0))
    }
  }
  if (visibleMaterialized) {
    taskState.resultDownloadCompleted = Math.max(taskState.resultDownloadCompleted, visibleMaterialized)
    taskState.resultDownloadTotal = Math.max(taskState.resultDownloadTotal, taskState.resultDownloadSubmitted, visibleMaterialized)
  }
}

async function pickExcel() {
  const selected = await window.cs.browseFile({ title: '选择买家秀 Excel', excel: true })
  if (!selected) return
  excelPath.value = selected
  await previewExcel()
}

async function previewExcel() {
  if (!excelPath.value) return
  excelPreview.status = '正在解析 Excel...'
  excelPreview.error = ''
  try {
    const result = await window.cs.readExcel(excelPath.value)
    excelPreview.rows = Array.isArray(result?.rows) ? result.rows : []
    excelPreview.headers = Array.isArray(result?.headers) ? result.headers : []
    excelPreview.rowCount = excelPreview.rows.length
    excelPreview.status = excelPreview.rowCount ? `已解析 ${excelPreview.rowCount} 行` : 'Excel 没有可读取数据'
  } catch (error) {
    excelPreview.rows = []
    excelPreview.headers = []
    excelPreview.rowCount = 0
    excelPreview.error = error?.message || String(error)
    excelPreview.status = '解析失败'
  }
}

async function pickExportFolder() {
  const selected = await window.cs.browseFile({
    title: '选择 AI 买家秀输出目录',
    directory: true,
    defaultPath: exportFolder.value || DEFAULT_EXPORT_FOLDER,
  })
  if (selected) exportFolder.value = selected
}

async function pickResumePackageDir() {
  const selected = await window.cs.browseFile({
    title: '选择要续跑的 AI 买家秀原图包目录',
    directory: true,
    defaultPath: resumePackageDir.value || exportFolder.value || DEFAULT_EXPORT_FOLDER,
  })
  if (!selected) return
  resumePackageDir.value = selected
  const selectedName = fileName(selected)
  if (selectedName) packageName.value = selectedName
  const parent = dirName(selected)
  if (parent) exportFolder.value = parent
}

function buildRunParams() {
  return {
    mode: 'new',
    input_file: {
      path: excelPath.value,
      rows: toPlainJson(excelPreview.rows, []),
      headers: toPlainJson(excelPreview.headers, []),
    },
    flat_cloud_path: flatCloudPath.value,
    export_folder: exportFolder.value,
    package_name: packageName.value,
    execute_mode: executeMode.value,
    resume_package_dir: isResumeMode.value ? resumePackageDir.value : '',
    model_id: selectedAiModel.value?.id || DEFAULT_MODEL_ID,
    model: selectedAiModel.value?.key || 'gpt-image-2',
    model_key_tier: selectedAiModel.value?.keyTier || '4k',
    image_size: 'source_ratio',
    max_generate_jobs: 0,
    max_model_images_per_row: 500,
    model_folder_scan_depth: 4,
    model_folder_scan_max_folders: 500,
    model_file_info_batch_size: 5,
    ai_generation_concurrency: 5,
    ai_result_download_concurrency: 10,
    usage_record_mode: 'ignore',
    custom_prompt: customPrompt.value,
    prompt_extra: promptExtra.value,
  }
}

function resetTaskState() {
  taskState.status = 'running'
  taskState.message = '正在提交 AI 买家秀任务...'
  taskState.error = ''
  taskState.runId = ''
  taskState.records = 0
  taskState.currentLabel = ''
  taskState.searchTotal = excelPreview.rowCount || 0
  taskState.searchCompleted = 0
  taskState.downloadTotal = 0
  taskState.downloadCompleted = 0
  taskState.downloadSuccess = 0
  taskState.downloadFailed = 0
  taskState.generationTotal = 0
  taskState.generationCompleted = 0
  taskState.resultDownloadSubmitted = 0
  taskState.resultDownloadTotal = 0
  taskState.resultDownloadCompleted = 0
  taskState.logs = []
  outputFiles.value = []
}

async function startWorkflow() {
  if (!excelPath.value) {
    taskState.status = 'failed'
    taskState.message = '请先选择买家秀 Excel'
    taskState.error = '缺少 Excel 文件'
    return
  }
  if (!flatCloudPath.value) {
    taskState.status = 'failed'
    taskState.message = '请填写平铺参考图库路径'
    taskState.error = '缺少平铺参考图库路径'
    return
  }
  if (isResumeMode.value && !resumePackageDir.value) {
    taskState.status = 'failed'
    taskState.message = '请选择要续跑的原图包目录'
    taskState.error = '缺少续跑原图包目录'
    return
  }
  if (!excelPreview.rows.length) {
    await previewExcel()
  }
  const previousStatus = await window.cs.getTaskStatus(ADAPTER_ID, TASK_ID).catch(() => null)
  const previousRunId = String(previousStatus?.live?.run_id || previousStatus?.last_run?.id || '').trim()
  resetTaskState()
  activeStep.value = 'match'
  manualStepSelection.value = false
  try {
    const result = await window.cs.runTask(ADAPTER_ID, TASK_ID, buildRunParams(), {})
    if (!result?.ok) throw new Error(result?.message || result?.error || '任务启动失败')
    const launch = await waitForRunStart(previousRunId)
    currentRunId = launch.runId
    taskState.runId = currentRunId
    applyStatusSnapshot(launch.snapshot)
    pollTask()
  } catch (error) {
    stopPolling()
    taskState.status = 'failed'
    taskState.message = error?.message || String(error)
    taskState.error = error?.message || String(error)
    activeStep.value = 'result'
  }
}

async function waitForRunStart(previousRunId) {
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    const status = await window.cs.getTaskStatus(ADAPTER_ID, TASK_ID).catch(() => null)
    const live = status?.live
    if (live?.run_id && String(live.run_id) !== previousRunId) {
      return { runId: String(live.run_id), snapshot: live }
    }
    const last = status?.last_run
    if (last?.id && String(last.id) !== previousRunId) {
      return { runId: String(last.id), snapshot: { ...last, run_id: last.id, records: last.records_count } }
    }
    await sleep(400)
  }
  throw new Error('任务已提交，但没有读到新的运行状态')
}

function schedulePoll() {
  stopPolling()
  pollTimer.value = window.setTimeout(pollTask, 1200)
}

function stopPolling() {
  if (pollTimer.value) window.clearTimeout(pollTimer.value)
  pollTimer.value = null
}

async function pollTask() {
  try {
    const [status, logsPayload] = await Promise.all([
      window.cs.getTaskStatus(ADAPTER_ID, TASK_ID),
      window.cs.getTaskLogs(ADAPTER_ID, TASK_ID).catch(() => null),
    ])
    if (Array.isArray(logsPayload?.logs)) {
      taskState.logs = logsPayload.logs.slice(-80)
      applyProgressFromLogs(taskState.logs)
      inferStepFromLogs(taskState.logs)
    }
    const live = status?.live
    if (live && (!currentRunId || String(live.run_id || '') === currentRunId)) {
      applyStatusSnapshot(live)
      if (isTerminalStatus(live.status)) {
        await finalizeRun(String(live.run_id || currentRunId))
        return
      }
      schedulePoll()
      return
    }
    const last = status?.last_run
    if (last && (!currentRunId || String(last.id || '') === currentRunId)) {
      applyStatusSnapshot({ ...last, run_id: last.id, records: last.records_count })
      if (isTerminalStatus(last.status)) {
        await finalizeRun(String(last.id || currentRunId))
        return
      }
    }
    schedulePoll()
  } catch (error) {
    taskState.status = 'failed'
    taskState.message = `读取任务状态失败：${error?.message || String(error)}`
    taskState.error = error?.message || String(error)
    activeStep.value = 'result'
  }
}

function applyStatusSnapshot(snapshot = {}) {
  const normalized = normalizeStatus(snapshot.status)
  taskState.status = normalized
  taskState.records = Number(snapshot.records || snapshot.records_count || taskState.records || 0)
  taskState.searchTotal = Number(snapshot.search_total_codes || taskState.searchTotal || 0)
  taskState.searchCompleted = Number(snapshot.search_completed_codes || taskState.searchCompleted || 0)
  taskState.downloadTotal = Number(snapshot.download_total || taskState.downloadTotal || 0)
  taskState.downloadCompleted = Number(snapshot.download_completed || taskState.downloadCompleted || 0)
  taskState.downloadSuccess = Number(snapshot.download_success || taskState.downloadSuccess || 0)
  taskState.downloadFailed = Number(snapshot.download_failed || taskState.downloadFailed || 0)
  taskState.generationTotal = Number(snapshot.generation_total_jobs || taskState.generationTotal || 0)
  taskState.generationCompleted = Number(snapshot.generation_completed_jobs || taskState.generationCompleted || 0)
  taskState.currentLabel = String(snapshot.current_buyer_id || snapshot.current_source_filename || snapshot.phase || '').trim()
  if (normalized === 'running') {
    taskState.message = taskState.currentLabel ? `正在处理：${taskState.currentLabel}` : '任务运行中...'
  } else if (normalized === 'done') {
    taskState.message = 'AI 买家秀任务完成'
  } else if (normalized === 'failed') {
    taskState.message = String(snapshot.error || 'AI 买家秀任务失败')
    taskState.error = String(snapshot.error || '')
  }
}

function inferStepFromLogs(logs = []) {
  const text = logs.slice(-20).join('\n')
  if (/\[buyer-show\]|生图|GPT|1XM|后处理/.test(text)) setAutoStep('generate')
  else if (/download|下载|collect|plan_job|找图|搜索/.test(text)) setAutoStep('match')
}

async function finalizeRun(runId = '') {
  stopPolling()
  await loadResultHistory(runId || currentRunId)
  const run = selectedResultRun.value || {}
  outputFiles.value = parseRunOutputFiles(run)
  if (taskState.status !== 'failed') {
    taskState.status = normalizeStatus(run.status) === 'failed' ? 'failed' : 'done'
    taskState.message = taskState.status === 'done' ? 'AI 买家秀任务完成' : String(run.error || 'AI 买家秀任务失败')
    taskState.error = String(run.error || '')
  }
  manualStepSelection.value = false
  activeStep.value = 'result'
}

async function stopWorkflow() {
  await window.cs.stopTask(ADAPTER_ID, TASK_ID).catch(() => null)
  stopPolling()
  taskState.status = 'failed'
  taskState.message = '任务已停止'
  taskState.error = '用户停止任务'
  manualStepSelection.value = false
  activeStep.value = 'result'
}

async function openFile(file) {
  if (file) await window.cs.openFile(file)
}

async function openPrimaryOutput() {
  const target = primaryOutputTarget.value
  if (target) await openFile(target)
}

function normalizeStatus(status) {
  const value = String(status || '').toLowerCase()
  if (['done', 'success', 'completed', 'partial'].includes(value)) return 'done'
  if (['failed', 'error', 'stopped', 'cancelled'].includes(value)) return 'failed'
  if (['running', 'queued', 'paused', 'pausing', 'stopping'].includes(value)) return 'running'
  return taskState.status || 'idle'
}

function isTerminalStatus(status) {
  return ['done', 'success', 'completed', 'partial', 'failed', 'error', 'stopped', 'cancelled'].includes(String(status || '').toLowerCase())
}

function sleep(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

onUnmounted(() => {
  stopPolling()
})
</script>

<style scoped>
.bsv-workbench {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  background: var(--bg);
}

.bsv-topbar {
  min-height: 86px;
  padding: 18px 22px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.bsv-kicker {
  margin: 0 0 4px;
  color: var(--orange-text);
  font-size: 11px;
  font-weight: 800;
}

.bsv-topbar h2 {
  margin: 0 0 6px;
  font-size: 22px;
  line-height: 1.15;
}

.bsv-subtitle {
  margin: 0;
  color: var(--text2);
  font-size: 12px;
}

.bsv-top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bsv-stepper {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  padding: 8px 22px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
}

.bsv-step {
  min-width: 0;
  height: 46px;
  padding: 6px 9px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, .10);
  background: rgba(255, 255, 255, .025);
  color: var(--text2);
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  text-align: left;
  cursor: pointer;
}

.bsv-step.active {
  border-color: var(--orange);
  background: linear-gradient(90deg, rgba(var(--orange-rgb), .16), rgba(var(--orange-rgb), .06));
  color: var(--text);
  box-shadow: inset 0 0 0 1px rgba(var(--orange-rgb), .14), 0 5px 14px rgba(0, 0, 0, .16);
}

.bsv-step.done .bsv-step-index {
  color: var(--green);
}

.bsv-step-index {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, .28);
  color: var(--text);
  font-size: 12px;
  font-weight: 800;
}

.bsv-step-copy {
  min-width: 0;
  display: grid;
  gap: 1px;
}

.bsv-step-copy strong,
.bsv-step-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bsv-step-copy strong {
  font-size: 12px;
}

.bsv-step-copy small {
  color: var(--text3);
  font-size: 10px;
}

.bsv-stage {
  min-height: 0;
  overflow: auto;
  padding: 18px 22px 22px;
}

.bsv-stage-grid {
  min-height: 100%;
  display: grid;
  grid-template-columns: minmax(330px, 420px) minmax(0, 1fr);
  gap: 16px;
}

.bsv-two-column {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 420px);
  gap: 16px;
}

.bsv-panel {
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg2);
  box-shadow: 0 12px 34px rgba(0, 0, 0, .18);
  overflow: hidden;
}

.bsv-params-panel {
  align-self: start;
}

.bsv-panel-head {
  min-height: 58px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.bsv-panel-head div {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.bsv-panel-head strong {
  color: var(--text);
  font-size: 14px;
}

.bsv-panel-head span {
  color: var(--text3);
  font-size: 11px;
}

.bsv-panel-body {
  min-height: 0;
  padding: 14px 16px;
  display: grid;
  gap: 13px;
}

.bsv-field,
.bsv-copy-list {
  min-width: 0;
  display: grid;
  gap: 7px;
}

.bsv-field > span,
.bsv-copy-list span {
  color: var(--text3);
  font-size: 11px;
  line-height: 1.45;
}

.bsv-field input,
.bsv-field select,
.bsv-field textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  background: var(--bg);
  font-size: 12px;
  line-height: 1.45;
}

.bsv-field input,
.bsv-field select {
  height: 38px;
  padding: 0 10px;
}

.bsv-field textarea {
  resize: vertical;
  padding: 9px 10px;
}

.bsv-field-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
}

.bsv-file-picker {
  min-height: 38px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  padding: 4px 5px 4px 10px;
}

.bsv-file-picker strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text2);
  font-size: 12px;
}

.bsv-primary,
.bsv-ghost {
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  color: var(--text);
  background: var(--bg3);
}

.bsv-primary {
  border-color: var(--orange);
  background: var(--orange);
  color: var(--on-orange);
  font-weight: 800;
}

.bsv-primary:disabled,
.bsv-ghost:disabled {
  opacity: .55;
  cursor: not-allowed;
}

.bsv-ghost {
  color: var(--text2);
  background: transparent;
}

.bsv-ghost.small {
  height: 28px;
  padding: 0 9px;
  font-size: 12px;
}

.bsv-ghost.danger {
  color: var(--red);
}

.bsv-primary.wide,
.bsv-ghost.wide {
  width: 100%;
}

.bsv-workbench button:focus-visible,
.bsv-workbench input:focus-visible,
.bsv-workbench select:focus-visible,
.bsv-workbench textarea:focus-visible {
  outline: 2px solid var(--orange);
  outline-offset: 2px;
}

.bsv-progress-card,
.bsv-result-summary {
  padding: 11px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(0, 0, 0, .14);
  display: grid;
  gap: 9px;
}

.bsv-progress-card strong,
.bsv-result-summary strong {
  display: block;
  margin-bottom: 3px;
  color: var(--text);
  font-size: 12px;
}

.bsv-progress-card span,
.bsv-result-summary span {
  color: var(--text3);
  font-size: 11px;
}

.bsv-progress-bar {
  height: 7px;
  border-radius: 99px;
  background: linear-gradient(90deg, var(--orange) var(--progress), rgba(255, 255, 255, .12) 0);
}

.bsv-progress-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.bsv-stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.bsv-progress-grid span {
  min-width: 0;
  color: var(--text3);
  font-size: 11px;
}

.bsv-stat-grid div {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, .025);
  display: grid;
  gap: 4px;
}

.bsv-stat-grid strong {
  color: var(--text);
  font-size: 22px;
}

.bsv-stat-grid span {
  color: var(--text3);
  font-size: 11px;
}

.bsv-preview-body {
  min-height: 360px;
}

.bsv-table-shell {
  max-height: calc(100vh - 310px);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.bsv-table-shell table {
  width: 100%;
  border-collapse: collapse;
  min-width: 860px;
}

.bsv-table-shell th,
.bsv-table-shell td {
  padding: 9px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--text2);
  font-size: 11px;
  text-align: left;
  vertical-align: top;
}

.bsv-table-shell th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--text);
  background: var(--bg3);
}

.bsv-empty-inline,
.bsv-inline-error {
  min-height: 54px;
  padding: 14px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  color: var(--text3);
  background: rgba(0, 0, 0, .14);
  display: grid;
  place-items: center;
  font-size: 12px;
}

.bsv-inline-error {
  border-style: solid;
  border-color: rgba(239, 68, 68, .38);
  color: var(--red);
}

.bsv-log-box {
  min-height: 280px;
  max-height: calc(100vh - 320px);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  padding: 10px 12px;
}

.bsv-log-box p {
  margin: 0 0 7px;
  color: var(--text3);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 1.45;
  word-break: break-word;
}

.bsv-result-layout {
  min-height: 70%;
  display: grid;
  grid-template-columns: minmax(520px, 1fr) minmax(360px, 520px);
  gap: 16px;
}

.bsv-run-table-shell {
  max-height: calc(100vh - 335px);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.bsv-run-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 620px;
}

.bsv-run-table th,
.bsv-run-table td {
  padding: 10px 9px;
  border-bottom: 1px solid var(--border);
  color: var(--text2);
  font-size: 11px;
  text-align: left;
  white-space: nowrap;
}

.bsv-run-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--text);
  background: var(--bg3);
}

.bsv-run-table tr {
  cursor: pointer;
}

.bsv-run-table tbody tr:hover,
.bsv-run-table tbody tr.selected {
  background: rgba(var(--orange-rgb), .10);
}

.bsv-status-pill {
  display: inline-grid;
  place-items: center;
  min-width: 46px;
  height: 22px;
  padding: 0 8px;
  border-radius: 99px;
  color: var(--text2);
  background: rgba(255, 255, 255, .06);
}

.bsv-status-pill.done {
  color: var(--green);
  background: rgba(34, 197, 94, .10);
}

.bsv-status-pill.failed {
  color: var(--red);
  background: rgba(239, 68, 68, .10);
}

.bsv-status-pill.running {
  color: var(--orange);
  background: rgba(var(--orange-rgb), .12);
}

.bsv-output-list {
  display: grid;
  gap: 9px;
}

.bsv-output-list article {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, .025);
  display: grid;
  grid-template-columns: minmax(120px, 180px) minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.bsv-output-list strong,
.bsv-output-list span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.bsv-output-list strong {
  color: var(--text);
}

.bsv-output-list span {
  color: var(--text3);
}

@media (max-width: 1100px) {
  .bsv-stage-grid,
  .bsv-two-column,
  .bsv-result-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 780px) {
  .bsv-topbar,
  .bsv-stage {
    padding-left: 14px;
    padding-right: 14px;
  }

  .bsv-stepper {
    grid-template-columns: minmax(0, 1fr);
    padding-left: 14px;
    padding-right: 14px;
  }

  .bsv-field-row,
  .bsv-progress-grid,
  .bsv-stat-grid,
  .bsv-output-list article {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
