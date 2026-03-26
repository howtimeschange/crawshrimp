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
          <div class="date-range">
            <input type="date" v-model="values[param.id + '_start']" class="input" />
            <span class="date-sep">至</span>
            <input type="date" v-model="values[param.id + '_end']" class="input" />
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
      </div>

      <!-- 执行按钮 -->
      <div class="action-row">
        <button
          class="run-btn"
          :class="{ running: isRunning }"
          :disabled="isRunning || missingRequired"
          @click="runTask"
        >
          <span v-if="isRunning">⏳ 抓取中…</span>
          <span v-else>▶ 开始抓取</span>
        </button>
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
          <span v-if="isRunning">⏳ 抓取中…</span>
          <span v-else>▶ 开始抓取</span>
        </button>
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
let pollTimer = null

// 初始化默认值
watch(() => props.task, (task) => {
  if (!task) return
  const v = {}
  for (const p of (task.params || [])) {
    if (p.type === 'checkbox') v[p.id] = p.default || []
    else if (p.type === 'date_range') { v[p.id + '_start'] = ''; v[p.id + '_end'] = '' }
    else v[p.id] = p.default ?? ''
  }
  values.value = v
  logs.value = []
  outputFiles.value = []
  isRunning.value = false
  lastResult.value = null
}, { immediate: true })

const missingRequired = computed(() => {
  if (!props.task) return false
  return (props.task.params || []).some(p => p.required && !values.value[p.id])
})

async function runTask() {
  if (isRunning.value) return
  isRunning.value = true
  lastResult.value = null
  logs.value = []
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
    }
  }

  const r = await window.cs.runTask(props.adapterId, props.task.task_id, params)
  if (!r.ok) {
    logs.value.push(`[错误] ${r.message || JSON.stringify(r)}`)
    isRunning.value = false
    return
  }

  logs.value.push(`[${now()}] 任务已启动，等待执行…`)
  emit('status-change', { status: 'running' })

  // 开始轮询日志
  pollTimer = setInterval(pollStatus, 800)
}

async function pollStatus() {
  const r = await window.cs.getTaskStatus(props.adapterId, props.task.task_id)
  const live = r.live
  const logR = await window.cs.getTaskLogs(props.adapterId, props.task.task_id)

  if (logR.logs) logs.value = logR.logs
  scrollToBottom()

  if (!live || live.status === 'running') return

  // 完成
  clearInterval(pollTimer)
  isRunning.value = false
  emit('status-change', live)

  if (live.status === 'done') {
    lastResult.value = { ok: true, msg: `✓ 完成，共 ${live.records} 条记录` }
    // 加载输出文件
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
  } else if (live.status === 'error') {
    lastResult.value = { ok: false, msg: `✗ 失败: ${live.error || '未知错误'}` }
  }
}

function scrollToBottom() {
  nextTick(() => { if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight })
}

function clearLogs() { logs.value = [] }

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

.date-range { display: flex; align-items: center; gap: 10px; }
.date-sep { font-size: 12px; color: var(--text2); }
.date-range .input { width: 160px; }

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
  flex: 1; overflow-y: auto; padding: 12px 16px;
  font-family: 'Menlo', 'Monaco', monospace; font-size: 12px; line-height: 1.7;
}
.log-empty { color: var(--text3); text-align: center; padding: 40px 0; }
.log-line { color: var(--text2); white-space: pre-wrap; word-break: break-all; }
.log-line.ok   { color: #4ade80; }
.log-line.err  { color: #f87171; }
.log-line.warn { color: #fbbf24; }
</style>
