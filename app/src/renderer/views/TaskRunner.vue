<template>
  <div class="runner">
    <!-- 页头 -->
    <header class="runner-header">
      <h2>{{ task?.task_name }}</h2>
      <p v-if="task?.description" class="desc">{{ task.description }}</p>
    </header>

    <!-- 参数面板 -->
    <div class="params-panel" v-if="task?.params?.length">
      <div v-for="param in task.params" :key="param.id" class="param-group">
        <label class="param-label">
          {{ param.label }}
          <span v-if="param.required" class="required">*</span>
        </label>

        <!-- 文本输入 -->
        <template v-if="param.type === 'text'">
          <input
            v-model="values[param.id]"
            :placeholder="param.placeholder || ''"
            class="input"
          />
          <p v-if="param.hint" class="hint">{{ param.hint }}</p>
        </template>

        <!-- 单选框 -->
        <template v-else-if="param.type === 'radio'">
          <div class="radio-group">
            <label v-for="opt in param.options" :key="opt.value" class="radio-item">
              <input
                type="radio"
                :name="param.id"
                :value="opt.value"
                v-model="values[param.id]"
              />
              <span class="radio-label">{{ opt.label }}</span>
            </label>
          </div>
        </template>

        <!-- 下拉选择 -->
        <template v-else-if="param.type === 'select'">
          <select v-model="values[param.id]" class="select">
            <option v-for="opt in param.options" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
          <template v-if="shouldShowInlineCustomDate(param)">
            <div class="custom-date-hint">自定义范围</div>
            <div class="date-range" style="margin-top:6px">
              <input type="date" v-model="values['_custom_start_' + param.id]" class="input" />
              <span class="date-sep">~</span>
              <input type="date" v-model="values['_custom_end_' + param.id]" class="input" />
            </div>
          </template>
        </template>

        <!-- 复选框组 -->
        <template v-else-if="param.type === 'checkbox'">
          <div class="checkbox-group">
            <label v-for="opt in param.options" :key="opt.value" class="checkbox-item">
              <input
                type="checkbox"
                :value="opt.value"
                v-model="values[param.id]"
              />
              <span class="checkbox-label">{{ opt.label }}</span>
            </label>
          </div>
          <p v-if="param.hint" class="hint">{{ param.hint }}</p>
        </template>

        <!-- 日期区间 -->
        <template v-else-if="param.type === 'date_range'">
          <div v-if="shouldShowDateRangeParam(param)" class="date-range-panel">
            <div class="date-range">
              <div
                class="date-card"
                role="button"
                tabindex="0"
                @click="openDatePicker(param.id + '_start')"
                @keydown.enter.prevent="openDatePicker(param.id + '_start')"
                @keydown.space.prevent="openDatePicker(param.id + '_start')"
              >
                <input
                  :ref="el => setDateInputRef(param.id + '_start', el)"
                  type="date"
                  v-model="values[param.id + '_start']"
                  class="date-card-input"
                />
                <span :class="['date-card-value', { placeholder: !values[param.id + '_start'] }]">
                  {{ formatDateDisplay(values[param.id + '_start']) }}
                </span>
                <span class="date-card-icon" aria-hidden="true">选择</span>
              </div>
              <span class="date-sep">至</span>
              <div
                class="date-card"
                role="button"
                tabindex="0"
                @click="openDatePicker(param.id + '_end')"
                @keydown.enter.prevent="openDatePicker(param.id + '_end')"
                @keydown.space.prevent="openDatePicker(param.id + '_end')"
              >
                <input
                  :ref="el => setDateInputRef(param.id + '_end', el)"
                  type="date"
                  v-model="values[param.id + '_end']"
                  class="date-card-input"
                />
                <span :class="['date-card-value', { placeholder: !values[param.id + '_end'] }]">
                  {{ formatDateDisplay(values[param.id + '_end']) }}
                </span>
                <span class="date-card-icon" aria-hidden="true">选择</span>
              </div>
            </div>
          </div>
        </template>

        <!-- 数字 -->
        <template v-else-if="param.type === 'number'">
          <input
            type="number"
            v-model.number="values[param.id]"
            :min="param.min" :max="param.max" :step="param.step || 1"
            class="input input-number"
          />
        </template>

        <!-- Excel / CSV 文件上传 -->
        <template v-else-if="param.type === 'file_excel'">
          <div class="file-picker">
            <div class="file-chosen" :class="{ empty: !values[param.id + '_path'] }" @click="pickExcel(param.id)">
              <span class="f-ico">📊</span>
              <span class="f-label">{{ values[param.id + '_path'] ? fileName(values[param.id + '_path']) : '点击选择 Excel / CSV 文件…' }}</span>
              <span v-if="values[param.id + '_path']" class="f-clear" @click.stop="clearExcel(param.id)">✕</span>
            </div>
            <button class="btn-pick" @click="pickExcel(param.id)">选择文件</button>
          </div>
          <div v-if="values[param.id + '_rows']?.length" class="excel-preview">
            <span class="preview-count">已读取 {{ values[param.id + '_rows'].length }} 行</span>
            <span class="preview-cols">列：{{ values[param.id + '_headers']?.join(' / ') }}</span>
          </div>
          <div v-if="excelLoading[param.id]" class="excel-loading">读取文件中…</div>
          <p v-if="param.hint" class="hint">{{ param.hint }}</p>
        </template>
      </div>

      <!-- 执行按钮 -->
      <div class="action-row">
        <button
          class="run-btn"
          :class="{ running: isRunning }"
          :disabled="isRunning || missingRequired"
          @click="runTask"
        >
          <span v-if="isRunning">⏳ 进行中…</span>
          <span v-else>▶ 立即执行</span>
        </button>
        <span v-if="isRunning" class="reset-link" @click="forceReset">重置</span>
        <span v-if="missingRequired" class="missing-hint">请填写必填项</span>
        <span v-if="lastResult" :class="['result-badge', lastResult.ok ? 'ok' : 'err']">
          {{ lastResult.msg }}
        </span>
      </div>
    </div>

    <!-- 无参数任务的执行按钮 -->
    <div v-else class="params-panel">
      <div class="action-row">
        <button
          class="run-btn"
          :class="{ running: isRunning }"
          :disabled="isRunning"
          @click="runTask"
        >
          <span v-if="isRunning">⏳ 进行中…</span>
          <span v-else>▶ 立即执行</span>
        </button>
        <span v-if="isRunning" class="reset-link" @click="forceReset">重置</span>
      </div>
    </div>

    <!-- 运行日志 -->
    <div class="log-panel">
      <div class="log-header">
        <span>运行日志</span>
        <div class="log-actions">
          <span v-if="outputFiles.length" class="output-count" @click="showFiles = !showFiles">
            📁 {{ outputFiles.length }} 个输出文件
          </span>
          <button class="clear-btn" @click="clearLogs">清空</button>
        </div>
      </div>

      <!-- 输出文件列表 -->
      <div v-if="showFiles && outputFiles.length" class="file-list">
        <div v-for="f in outputFiles" :key="f" class="file-item" @click="openFile(f)">
          <span class="file-icon">{{ f.endsWith('.xlsx') ? '📊' : '📄' }}</span>
          <span class="file-name">{{ fileName(f) }}</span>
          <span class="file-open">打开 →</span>
        </div>
      </div>

      <div class="log-body" ref="logEl">
        <div v-if="!logs.length" class="log-empty">等待任务执行…</div>
        <div v-for="(line, i) in logs" :key="i" :class="['log-line', logClass(line)]">{{ line }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'

const props = defineProps({
  adapterId: String,
  task: Object,
})
const emit = defineEmits(['status-change'])

const values = ref({})
const logs = ref([])
const isRunning = ref(false)
const lastResult = ref(null)
const logEl = ref(null)
const outputFiles = ref([])
const showFiles = ref(false)
const excelLoading = ref({})
const dateInputRefs = new Map()
let pollTimer = null
let currentRunId = null   // 当前触发的任务 run_id，用于轮询匹配

// 初始化默认值
watch(() => props.task, (task) => {
  if (!task) return
  const v = {}
  for (const p of (task.params || [])) {
    if (p.type === 'checkbox') v[p.id] = p.default || []
    else if (p.type === 'date_range') { v[p.id + '_start'] = ''; v[p.id + '_end'] = '' }
    else if (p.type === 'file_excel') {
      v[p.id + '_path'] = ''
      v[p.id + '_rows'] = []
      v[p.id + '_headers'] = []
    }
    else v[p.id] = p.default ?? ''
  }
  values.value = v
  // 切换 task 时保留/恢复历史日志，不清空
  outputFiles.value = []
  isRunning.value = false
  lastResult.value = null
  // 异步加载该任务的历史日志
  nextTick(async () => {
    try {
      const logR = await window.cs.getTaskLogs(props.adapterId, task.task_id)
      if (logR.logs) logs.value = logR.logs
      scrollToBottom()
    } catch {}
  })
}, { immediate: true })

const missingRequired = computed(() => {
  if (!props.task) return false
  return (props.task.params || []).some(p => {
    if (!p.required) return false
    if (p.type === 'file_excel') return !values.value[p.id + '_path']
    return !values.value[p.id]
  })
})

function forceReset() {
  clearInterval(pollTimer)
  isRunning.value = false
  currentRunId = null
  logs.value.push('[重置] 已强制重置运行状态')
}

async function runTask() {
  if (isRunning.value) return
  isRunning.value = true
  lastResult.value = null
  // 不清空日志，新一轮运行的分隔线由后端插入
  outputFiles.value = []
  showFiles.value = false

  // 整理 params
  const params = { ...values.value }
  for (const p of (props.task.params || [])) {
    if (p.type === 'date_range') {
      params[p.id] = {
        start: values.value[p.id + '_start'],
        end:   values.value[p.id + '_end'],
      }
      delete params[p.id + '_start']
      delete params[p.id + '_end']
    } else if (p.type === 'select') {
      // 如果选了「自定义」，把对应的日期也打进去
      const v = values.value[p.id]
      if (v === '自定义') {
        const linkedRangeId = getLinkedDateRangeIdForSelect(p.id)
        const startKey = linkedRangeId ? linkedRangeId + '_start' : '_custom_start_' + p.id
        const endKey = linkedRangeId ? linkedRangeId + '_end' : '_custom_end_' + p.id
        params['custom_start'] = values.value[startKey] || ''
        params['custom_end']   = values.value[endKey] || ''
        // 同时把 custom_range 填进去（兼容 manifest 里单独声明的 date_range）
        params['custom_range'] = {
          start: params['custom_start'],
          end:   params['custom_end'],
        }
      }
      // 清理联动临时字段
      delete params['_custom_start_' + p.id]
      delete params['_custom_end_'   + p.id]
    } else if (p.type === 'file_excel') {
      // 仅发送 path，rows 和 headers 由后端在执行前自动读取，避免 IPC 负载过大导致 UI 卡死
      params[p.id] = {
        path: values.value[p.id + '_path'],
      }
      delete params[p.id + '_path']
      delete params[p.id + '_rows']
      delete params[p.id + '_headers']
    }
  }

  let currentTabId = ''
  if (String(params.mode || '').trim().toLowerCase() === 'current') {
    try {
      const tab = await window.cs.getCurrentChromeTab?.()
      if (tab?.id) currentTabId = String(tab.id)
    } catch {}
  }

  const r = await window.cs.runTask(props.adapterId, props.task.task_id, params, {
    current_tab_id: currentTabId,
  })
  if (!r.ok) {
    logs.value.push(`[错误] ${r.message || JSON.stringify(r)}`)
    isRunning.value = false
    return
  }

  logs.value.push(`[${now()}] 任务已启动，等待执行…`)
  emit('status-change', { status: 'running' })

  // 等一下让后端写入 run_id，再拿到本次任务的 run_id
  await new Promise(res => setTimeout(res, 600))
  const initStatus = await window.cs.getTaskStatus(props.adapterId, props.task.task_id)
  currentRunId = initStatus?.live?.run_id ?? initStatus?.last_run?.id ?? null

  // 开始轮询日志
  pollTimer = setInterval(pollStatus, 800)
}

async function pollStatus() {
  const r = await window.cs.getTaskStatus(props.adapterId, props.task.task_id)
  const live = r.live
  const logR = await window.cs.getTaskLogs(props.adapterId, props.task.task_id)

  if (logR.logs) logs.value = logR.logs
  scrollToBottom()

  // live 有值且是当前任务正在跑 → 继续等
  if (live && live.status === 'running') return

  // live 为 null 时：检查 last_run 是否是我们触发的这次（匹配 run_id）
  if (!live) {
    const last = r.last_run
    // 还没有 run_id（任务刚提交还没写入）→ 继续等
    if (!currentRunId) return
    // last_run 不是当前任务 → 继续等
    if (!last || last.id !== currentRunId) return
    // last_run 是当前任务但还在跑 → 继续等
    if (last.status === 'running') return
    // last_run 是当前任务且已完成 → 用 last 作为结果
    const syntheticLive = { status: last.status, records: last.records_count, error: last.error, run_id: last.id }
    return finishRun(syntheticLive)
  }

  // live 有值且不是 running（done/error）且匹配当前 run_id
  if (currentRunId && live.run_id && live.run_id !== currentRunId) return
  finishRun(live)
}

function scrollToBottom() {
  nextTick(() => { if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight })
}

async function finishRun(result) {
  clearInterval(pollTimer)
  isRunning.value = false
  currentRunId = null
  emit('status-change', result)

  if (result.status === 'done') {
    lastResult.value = { ok: true, msg: `✓ 完成，共 ${result.records ?? result.records_count ?? 0} 条记录` }
    const dataR = await window.cs.getData(props.adapterId, props.task.task_id)
    if (dataR.runs?.[0]?.output_files) {
      try {
        const files = typeof dataR.runs[0].output_files === 'string'
          ? JSON.parse(dataR.runs[0].output_files)
          : dataR.runs[0].output_files
        outputFiles.value = files || []
        if (files?.length) showFiles.value = true
      } catch {}
    }
  } else if (result.status === 'error') {
    lastResult.value = { ok: false, msg: `✗ 失败: ${result.error || '未知错误'}` }
  }
}

async function clearLogs() {
  logs.value = []
  try {
    await window.cs.clearTaskLogs(props.adapterId, props.task.task_id)
  } catch {}
}

function logClass(line) {
  if (line.includes('ERROR') || line.includes('错误') || line.includes('失败')) return 'err'
  if (line.includes('[ok]') || line.includes('完成') || line.includes('Done')) return 'ok'
  if (line.includes('[warn]') || line.includes('警告')) return 'warn'
  return ''
}

function now() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

function fileName(path) {
  return path.split('/').pop().split('\\').pop()
}

function openFile(path) {
  window.cs.openFile(path)
}

function isCustomDateSelected(paramId) {
  const v = values.value[paramId]
  return v === '自定义' || v === 'custom'
}

function selectSupportsCustom(param) {
  return (param?.options || []).some(opt =>
    opt?.value === '自定义' ||
    opt?.value === 'custom' ||
    String(opt?.label || '').includes('自定义')
  )
}

function getLinkedDateRangeIdForSelect(paramId) {
  const params = props.task?.params || []
  const selectParam = params.find(p => p.id === paramId)
  if (!selectSupportsCustom(selectParam)) return null
  const explicit = params.find(p => p.type === 'date_range' && p.id === 'custom_range')
  if (explicit) return explicit.id
  const dateRanges = params.filter(p => p.type === 'date_range')
  return dateRanges.length === 1 ? dateRanges[0].id : null
}

function getControllerSelectForDateRange(paramId) {
  const params = props.task?.params || []
  if (paramId === 'custom_range') {
    return params.find(p => p.type === 'select' && selectSupportsCustom(p)) || null
  }
  return null
}

function shouldShowInlineCustomDate(param) {
  return isCustomDateSelected(param.id) && !getLinkedDateRangeIdForSelect(param.id)
}

function shouldShowDateRangeParam(param) {
  const controller = getControllerSelectForDateRange(param.id)
  if (!controller) return true
  return isCustomDateSelected(controller.id)
}

function formatDateDisplay(value) {
  if (!value) return '年 / 月 / 日'
  return String(value).replace(/-/g, ' / ')
}

function setDateInputRef(key, el) {
  if (el) {
    dateInputRefs.set(key, el)
  } else {
    dateInputRefs.delete(key)
  }
}

function openDatePicker(key) {
  const input = dateInputRefs.get(key)
  if (!input) return
  input.focus({ preventScroll: true })
  if (typeof input.showPicker === 'function') {
    input.showPicker()
    return
  }
  input.click()
}

async function pickExcel(paramId) {
  const path = await window.cs.browseFile({
    title: '选择 Excel 或 CSV 文件',
    excel: true,
  })
  if (!path) return
  values.value[paramId + '_path'] = path
  values.value[paramId + '_rows'] = []
  values.value[paramId + '_headers'] = []
  excelLoading.value[paramId] = true
  try {
    const r = await window.cs.readExcel(path)
    if (r.rows) {
      values.value[paramId + '_rows'] = r.rows
      values.value[paramId + '_headers'] = r.headers
    }
  } catch (e) {
    values.value[paramId + '_path'] = ''
  } finally {
    excelLoading.value[paramId] = false
  }
}

function clearExcel(paramId) {
  values.value[paramId + '_path'] = ''
  values.value[paramId + '_rows'] = []
  values.value[paramId + '_headers'] = []
}

onUnmounted(() => clearInterval(pollTimer))
</script>

<style scoped>
.runner { height: 100%; display: flex; flex-direction: column; overflow: hidden; }

.runner-header {
  padding: 20px 24px 14px;
  border-bottom: 1px solid var(--border);
}
.runner-header h2 { font-size: 18px; font-weight: 700; color: var(--text); }
.desc { font-size: 12px; color: var(--text3); margin-top: 4px; }

/* 参数面板 */
.params-panel {
  padding: 20px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.param-group { display: flex; flex-direction: column; gap: 7px; }
.param-label { font-size: 12px; color: var(--text2); font-weight: 500; }
.required { color: var(--orange); margin-left: 3px; }
.hint { font-size: 11px; color: var(--text3); line-height: 1.5; }

.input {
  background: var(--bg3); border: 1px solid var(--border); border-radius: 8px;
  padding: 9px 12px; color: var(--text); font-size: 13px; outline: none;
  transition: border-color 0.15s; width: 100%;
}
.input:focus { border-color: var(--orange); }
.input-number { width: 120px; }
.select {
  background: var(--bg3); border: 1px solid var(--border); border-radius: 8px;
  padding: 9px 12px; color: var(--text); font-size: 13px; outline: none;
  cursor: pointer; width: 240px;
}
.select:focus { border-color: var(--orange); }

.radio-group { display: flex; gap: 20px; flex-wrap: wrap; }
.radio-item { display: flex; align-items: center; gap: 7px; cursor: pointer; }
.radio-item input[type=radio] { accent-color: var(--orange); width: 15px; height: 15px; cursor: pointer; }
.radio-label { font-size: 13px; color: var(--text); }

.checkbox-group { display: flex; gap: 16px; flex-wrap: wrap; }
.checkbox-item { display: flex; align-items: center; gap: 7px; cursor: pointer; }
.checkbox-item input[type=checkbox] { accent-color: var(--orange); width: 14px; height: 14px; cursor: pointer; }
.checkbox-label { font-size: 13px; color: var(--text); }

.date-range-panel {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg3);
}
.date-range { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.date-sep { font-size: 12px; color: var(--text2); }
.date-range .input { width: 160px; }
.custom-date-hint { font-size: 11px; color: var(--text3); margin-top: 10px; font-weight: 600; letter-spacing: 0.04em; }
.date-card {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 180px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg2);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform 0.15s;
  overflow: hidden;
}
.date-card:hover { border-color: var(--orange); background: rgba(255,255,255,0.04); transform: translateY(-1px); }
.date-card:focus-within { border-color: var(--orange); box-shadow: 0 0 0 3px rgba(255, 106, 41, 0.12); }
.date-card-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  pointer-events: none;
}
.date-card-value {
  font-size: 13px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.date-card-value.placeholder { color: var(--text3); }
.date-card-icon {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text3);
  pointer-events: none;
}

/* 执行按钮 */
.action-row { display: flex; align-items: center; gap: 12px; padding-top: 4px; }
.run-btn {
  padding: 10px 28px; border-radius: 10px; border: none;
  background: var(--orange); color: white;
  font-size: 14px; font-weight: 700;
  transition: all 0.15s; letter-spacing: 0.03em;
}
.run-btn:hover:not(:disabled) { background: var(--orange-dim); transform: translateY(-1px); }
.run-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.run-btn.running { background: #555; }
.missing-hint { font-size: 12px; color: var(--text3); }
.reset-link { font-size: 12px; color: var(--text3); cursor: pointer; text-decoration: underline; }
.reset-link:hover { color: #f87171; }
.result-badge { font-size: 12px; padding: 4px 10px; border-radius: 6px; }
.result-badge.ok  { background: rgba(74,222,128,0.12); color: #4ade80; }
.result-badge.err { background: rgba(248,113,113,0.12); color: #f87171; }

/* 日志面板 */
.log-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.log-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 16px; background: var(--bg2); border-bottom: 1px solid var(--border);
}
.log-header > span { font-size: 12px; color: var(--text2); font-weight: 600; }
.log-actions { display: flex; align-items: center; gap: 12px; }
.output-count {
  font-size: 11px; color: var(--orange); cursor: pointer;
  padding: 2px 8px; border-radius: 5px; background: var(--orange-bg);
}
.clear-btn {
  font-size: 11px; color: var(--text3); background: transparent; border: none;
  padding: 2px 8px; border-radius: 5px;
}
.clear-btn:hover { color: var(--text2); background: var(--bg3); }

.file-list {
  background: var(--bg3); border-bottom: 1px solid var(--border);
  padding: 8px 16px; display: flex; flex-direction: column; gap: 4px;
}
.file-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; border-radius: 7px; cursor: pointer;
  transition: background 0.1s;
}
.file-item:hover { background: var(--bg2); }
.file-icon { font-size: 14px; }
.file-name { flex: 1; font-size: 12px; color: var(--text); }
.file-open { font-size: 11px; color: var(--orange); }

.log-body {
  flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px;
  font-family: 'Menlo', 'Monaco', monospace; font-size: 12px; line-height: 1.7;
}
.log-empty { color: var(--text3); text-align: center; padding: 40px 0; }
.log-line { color: var(--text2); white-space: pre-wrap; word-break: break-all; }
.log-line.ok   { color: #4ade80; }
.log-line.err  { color: #f87171; }
.log-line.warn { color: #fbbf24; }

/* Excel 文件选择控件 */
.file-picker { display: flex; gap: 8px; align-items: center; }
.file-chosen {
  flex: 1; display: flex; align-items: center; gap: 8px;
  background: var(--bg3); border: 1px solid var(--border); border-radius: 8px;
  padding: 8px 12px; cursor: pointer; transition: border-color 0.15s;
  min-width: 0;
}
.file-chosen:hover { border-color: var(--orange); }
.file-chosen.empty .f-label { color: var(--text3); }
.f-ico { font-size: 15px; flex-shrink: 0; }
.f-label { flex: 1; font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.f-clear { font-size: 12px; color: var(--text3); flex-shrink: 0; line-height: 1; }
.f-clear:hover { color: #f87171; }
.btn-pick {
  padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--bg3); color: var(--text2); font-size: 12px; white-space: nowrap;
}
.btn-pick:hover { background: var(--orange-bg); color: var(--orange); border-color: var(--orange); }
.excel-preview {
  display: flex; gap: 12px; align-items: center;
  padding: 5px 10px; background: rgba(74,222,128,0.07); border-radius: 6px;
}
.preview-count { font-size: 12px; color: #4ade80; font-weight: 600; }
.preview-cols { font-size: 11px; color: var(--text3); }
.excel-loading { font-size: 12px; color: var(--text3); padding: 4px 0; }
</style>
