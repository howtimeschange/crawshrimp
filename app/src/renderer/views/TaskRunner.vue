<template>
  <div class="runner">
    <!-- 页头 -->
    <header class="runner-header">
      <h2>{{ task?.task_name }}</h2>
      <p v-if="task?.description" class="desc">{{ task.description }}</p>
    </header>

    <div class="runner-body">
      <!-- 参数面板 -->
      <div class="params-panel" v-if="visibleParams.length">
        <div :class="['params-grid', paramsGridClass]">
          <div v-for="param in visibleParams" :key="param.id" :class="['param-group', paramLayoutClass(param)]">
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
              <p v-if="param.hint" class="hint">{{ param.hint }}</p>
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
            <template v-else-if="isRangeParamType(param.type)">
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
                      :type="getTemporalInputType(param.type)"
                      v-model="values[param.id + '_start']"
                      class="date-card-input"
                    />
                    <span :class="['date-card-value', { placeholder: !values[param.id + '_start'] }]">
                      {{ formatTemporalDisplay(values[param.id + '_start'], param.type) }}
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
                      :type="getTemporalInputType(param.type)"
                      v-model="values[param.id + '_end']"
                      class="date-card-input"
                    />
                    <span :class="['date-card-value', { placeholder: !values[param.id + '_end'] }]">
                      {{ formatTemporalDisplay(values[param.id + '_end'], param.type) }}
                    </span>
                    <span class="date-card-icon" aria-hidden="true">选择</span>
                  </div>
                </div>
              </div>
            </template>

            <template v-else-if="isSingleTemporalParamType(param.type)">
              <div class="date-range-panel">
                <div class="date-range">
                  <div
                    class="date-card"
                    role="button"
                    tabindex="0"
                    @click="openDatePicker(param.id)"
                    @keydown.enter.prevent="openDatePicker(param.id)"
                    @keydown.space.prevent="openDatePicker(param.id)"
                  >
                    <input
                      :ref="el => setDateInputRef(param.id, el)"
                      :type="getTemporalInputType(param.type)"
                      v-model="values[param.id]"
                      class="date-card-input"
                    />
                    <span :class="['date-card-value', { placeholder: !values[param.id] }]">
                      {{ formatTemporalDisplay(values[param.id], param.type) }}
                    </span>
                    <span class="date-card-icon" aria-hidden="true">选择</span>
                  </div>
                </div>
                <p v-if="param.hint" class="hint">{{ param.hint }}</p>
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
                <div class="file-picker-actions">
                  <button class="btn-pick" @click="pickExcel(param.id)">选择文件</button>
                </div>
              </div>
              <div v-if="getParamTemplates(param).length" class="template-list">
                <div
                  v-for="(template, index) in getParamTemplates(param)"
                  :key="template.file || index"
                  class="template-card"
                >
                  <div class="template-main">
                    <div class="template-title-row">
                      <span class="template-name">{{ template.label || fileName(template.file || '') }}</span>
                      <span class="template-ext">{{ templateExtension(template) }}</span>
                      <span v-if="template.version" class="template-version">v{{ template.version }}</span>
                    </div>
                    <p v-if="template.description" class="template-desc">{{ template.description }}</p>
                  </div>
                  <button
                    class="btn-template"
                    :disabled="!canDownloadTemplate(template)"
                    @click="downloadTemplate(task, param, template)"
                  >
                    下载
                  </button>
                </div>
              </div>
              <div
                v-if="templateFeedback[param.id]"
                :class="['template-feedback', templateFeedback[param.id].ok ? 'ok' : 'err']"
              >
                {{ templateFeedback[param.id].msg }}
              </div>
              <div v-if="values[param.id + '_rows']?.length" class="excel-preview">
                <span class="preview-count">已读取 {{ values[param.id + '_rows'].length }} 行</span>
                <span class="preview-cols">列：{{ values[param.id + '_headers']?.join(' / ') }}</span>
              </div>
              <div v-if="excelLoading[param.id]" class="excel-loading">读取文件中…</div>
              <p v-if="param.hint" class="hint">{{ param.hint }}</p>
            </template>

            <!-- 多图上传 -->
            <template v-else-if="param.type === 'file_images'">
              <div class="file-picker">
                <div class="file-chosen" :class="{ empty: !(values[param.id + '_paths'] || []).length }" @click="pickImages(param)">
                  <span class="f-ico">🖼</span>
                  <span class="f-label">
                    {{ imageSummary(param) }}
                  </span>
                  <span v-if="(values[param.id + '_paths'] || []).length" class="f-clear" @click.stop="clearImages(param.id)">✕</span>
                </div>
                <div class="file-picker-actions">
                  <button class="btn-pick" @click="pickImages(param)">选择图片</button>
                </div>
              </div>
              <div v-if="(values[param.id + '_paths'] || []).length" class="image-file-list">
                <span
                  v-for="path in values[param.id + '_paths']"
                  :key="path"
                  class="image-file-chip"
                >
                  {{ fileName(path) }}
                </span>
              </div>
              <p v-if="param.hint" class="hint">{{ param.hint }}</p>
            </template>
          </div>
        </div>

        <!-- 执行按钮 -->
        <div class="action-row">
          <button
            class="run-btn"
            :class="{ running: isRunning }"
            :disabled="isRunning || missingRequired"
            @click="runTask"
          >
            <span v-if="isRunning">{{ runningLabel }}</span>
            <span v-else>▶ 立即执行</span>
          </button>
          <button
            v-if="autoPrecheckFlow"
            class="run-sub-btn"
            :disabled="isRunning || missingRequired"
            @click="runValidationOnly"
          >
            {{ validationOnlyLabel }}
          </button>
          <button
            v-if="isRunning && liveStatus === 'running'"
            class="run-sub-btn"
            @click="pauseCurrentTask"
          >
            暂停
          </button>
          <button
            v-if="isRunning && (liveStatus === 'paused' || liveStatus === 'pausing')"
            class="run-sub-btn"
            @click="resumeCurrentTask"
          >
            继续
          </button>
          <button
            v-if="isRunning"
            class="run-sub-btn run-sub-btn-stop"
            :disabled="liveStatus === 'stopping'"
            @click="stopCurrentTask"
          >
            停止
          </button>
          <span v-if="autoPrecheckFlow" class="action-note">{{ autoPrecheckNote }}</span>
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
            <span v-if="isRunning">{{ runningLabel }}</span>
            <span v-else>▶ 立即执行</span>
          </button>
          <button
            v-if="isRunning && liveStatus === 'running'"
            class="run-sub-btn"
            @click="pauseCurrentTask"
          >
            暂停
          </button>
          <button
            v-if="isRunning && (liveStatus === 'paused' || liveStatus === 'pausing')"
            class="run-sub-btn"
            @click="resumeCurrentTask"
          >
            继续
          </button>
          <button
            v-if="isRunning"
            class="run-sub-btn run-sub-btn-stop"
            :disabled="liveStatus === 'stopping'"
            @click="stopCurrentTask"
          >
            停止
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

        <div v-if="progressSummary && useEnhancedProgressUi" class="progress-strip" aria-live="polite">
          <div class="progress-strip-head">
            <div class="progress-strip-main">
              <span class="progress-strip-title">{{ progressSummary.title }}</span>
              <span class="progress-strip-value">{{ progressSummary.main }}</span>
              <span class="progress-strip-percent">{{ progressSummary.percentLabel }}</span>
            </div>
            <div class="progress-strip-meta">
              <span v-if="progressSummary.completedText">{{ progressSummary.completedText }}</span>
              <span v-if="progressSummary.batchText">{{ progressSummary.batchText }}</span>
              <span v-if="progressSummary.rowText">{{ progressSummary.rowText }}</span>
              <span v-if="progressSummary.targetText">{{ progressSummary.targetText }}</span>
              <span v-if="progressSummary.storeText">{{ progressSummary.storeText }}</span>
              <span v-if="progressSummary.phaseText">{{ progressSummary.phaseText }}</span>
            </div>
          </div>
          <div class="progress-strip-stack">
            <div class="progress-track">
              <div class="progress-track-label">
                <span>{{ progressSummary.trackTitle }}</span>
                <span>{{ progressSummary.percentLabel }}</span>
              </div>
              <div
                :class="['progress-strip-bar', { indeterminate: progressSummary.indeterminate }]"
                role="progressbar"
                :aria-label="progressSummary.ariaLabel"
                :aria-valuenow="progressSummary.indeterminate ? null : progressSummary.percentValue"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuetext="progressSummary.ariaText"
                :aria-busy="progressSummary.indeterminate ? 'true' : 'false'"
              >
                <div
                  :class="['progress-strip-bar-fill', { indeterminate: progressSummary.indeterminate }]"
                  :style="progressSummary.indeterminate ? undefined : { width: `${progressSummary.percentValue}%` }"
                ></div>
              </div>
            </div>
            <div v-if="progressSummary.batchPercentValue > 0" class="progress-track progress-track-secondary">
              <div class="progress-track-label">
                <span>当前条目</span>
                <span>{{ progressSummary.batchText }}</span>
              </div>
              <div
                class="progress-strip-bar progress-strip-bar-secondary"
                role="progressbar"
                aria-label="当前条目进度"
                :aria-valuenow="progressSummary.batchPercentValue"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuetext="`${progressSummary.batchText}，${progressSummary.batchPercentValue}%`"
              >
                <div
                  class="progress-strip-bar-fill progress-strip-bar-fill-secondary"
                  :style="{ width: `${progressSummary.batchPercentValue}%` }"
                ></div>
              </div>
            </div>
          </div>
          <div class="progress-strip-sub">{{ progressSummary.sub }}</div>
        </div>

        <div v-else-if="progressSummary" class="progress-strip" aria-live="polite">
          <div class="progress-strip-head">
            <div class="progress-strip-main">
              <span class="progress-strip-title">批处理进度</span>
              <span class="progress-strip-value">{{ progressSummary.main }}</span>
              <span class="progress-strip-percent">{{ progressSummary.percentLabel }}</span>
            </div>
            <div class="progress-strip-meta">
              <span>已完成 {{ progressSummary.completed }} 条</span>
              <span v-if="progressSummary.batchText">{{ progressSummary.batchText }}</span>
              <span v-if="progressSummary.rowText">{{ progressSummary.rowText }}</span>
              <span v-if="progressSummary.targetText">{{ progressSummary.targetText }}</span>
            </div>
          </div>
          <div
            class="progress-strip-bar"
            role="progressbar"
            :aria-label="progressSummary.ariaLabel"
            :aria-valuenow="progressSummary.percentValue"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuetext="progressSummary.ariaText"
          >
            <div class="progress-strip-bar-fill" :style="{ width: `${progressSummary.percentValue}%` }"></div>
          </div>
          <div class="progress-strip-sub">{{ progressSummary.sub }}</div>
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
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { buildTaskRunnerProgressSummary, resolveTaskProgressConfig } from '../utils/taskProgress'

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
const templateFeedback = ref({})
const runStage = ref('')
const dateInputRefs = new Map()
let pollTimer = null
let currentRunId = null   // 当前触发的任务 run_id，用于轮询匹配
let runAbortToken = 0

// 初始化默认值
watch(() => props.task, (task) => {
  if (!task) return
  const v = {}
  for (const p of (task.params || [])) {
    if (p.type === 'checkbox') v[p.id] = p.default || []
    else if (isSingleTemporalParamType(p.type)) v[p.id] = p.default ?? ''
    else if (isRangeParamType(p.type)) { v[p.id + '_start'] = ''; v[p.id + '_end'] = '' }
    else if (p.type === 'file_excel') {
      v[p.id + '_path'] = ''
      v[p.id + '_rows'] = []
      v[p.id + '_headers'] = []
    }
    else if (p.type === 'file_images') {
      v[p.id + '_paths'] = normalizeImagePaths(p.default?.paths, imageParamLimit(p))
    }
    else v[p.id] = p.default ?? ''
  }
  values.value = v
  templateFeedback.value = {}
  // 切换 task 时保留/恢复历史日志，不清空
  outputFiles.value = []
  isRunning.value = false
  lastResult.value = null
  runStage.value = ''
  // 异步加载该任务的历史日志
  nextTick(async () => {
    try {
      const logR = await window.cs.getTaskLogs(props.adapterId, task.task_id)
      if (logR.logs) logs.value = logR.logs
      const taskStatus = await window.cs.getTaskStatus(props.adapterId, task.task_id)
      const live = taskStatus?.live
      const last = taskStatus?.last_run
      if (live && isTaskActiveStatus(live.status)) {
        isRunning.value = true
        currentRunId = live.run_id ?? last?.id ?? null
        emit('status-change', live)
      } else if (!live && last && isTaskActiveStatus(last.status)) {
        isRunning.value = true
        currentRunId = last.id ?? null
        emit('status-change', {
          status: last.status,
          records: last.records_count,
          error: last.error,
          run_id: last.id,
        })
      }
      scrollToBottom()
    } catch {}
  })
}, { immediate: true })

const executeModeParam = computed(() =>
  (props.task?.params || []).find(p =>
    p?.id === 'execute_mode' &&
    p?.type === 'radio' &&
    (p?.options || []).some(opt => opt?.value === 'plan') &&
    (p?.options || []).some(opt => opt?.value === 'live')
  ) || null
)

const autoPrecheckFlow = computed(() =>
  props.task?.execution_ui_mode === 'precheck_before_live' && !!executeModeParam.value
)

const visibleParams = computed(() =>
  orderVisibleParams((props.task?.params || []).filter(isParamVisibleInForm))
)

const validationOnlyLabel = computed(() =>
  props.task?.validation_only_label || '仅校验 Excel'
)

const autoPrecheckNote = computed(() =>
  props.task?.auto_precheck_note || '执行前会自动做 Excel 预检'
)

const liveStatus = computed(() => props.task?.live?.status || '')
const liveProgress = computed(() => props.task?.live || {})
const paramsGridClass = computed(() =>
  props.adapterId === 'shopee-webchat-bulk-reply' ? 'params-grid-shopee-bulk' : ''
)
const useEnhancedProgressUi = computed(() =>
  resolveTaskProgressConfig(props.adapterId, props.task?.task_id).usage.taskRunner === 'enhanced'
)

function isTaskActiveStatus(status) {
  return ['running', 'pausing', 'paused', 'stopping'].includes(status)
}

const runningLabel = computed(() => {
  if (liveStatus.value === 'pausing') return '⏳ 暂停中…'
  if (liveStatus.value === 'paused') return '⏸ 已暂停'
  if (liveStatus.value === 'stopping') return '⏳ 停止中…'
  if (runStage.value === 'plan') return '⏳ 预检中…'
  if (runStage.value === 'live') return '⏳ live 执行中…'
  return '⏳ 进行中…'
})

const missingRequired = computed(() => {
  if (!props.task) return false
  return visibleParams.value.some(p => {
    if (!p.required) return false
    if (p.type === 'file_excel') return !values.value[p.id + '_path']
    if (p.type === 'file_images') return !(values.value[p.id + '_paths'] || []).length
    if (isSingleTemporalParamType(p.type)) return !values.value[p.id]
    if (isRangeParamType(p.type)) {
      return !values.value[p.id + '_start'] || !values.value[p.id + '_end']
    }
    return !values.value[p.id]
  })
})

const progressSummary = computed(() =>
  buildTaskRunnerProgressSummary({
    adapterId: props.adapterId,
    taskId: props.task?.task_id,
    live: liveProgress.value,
    liveStatus: liveStatus.value,
    isRunning: isRunning.value,
  })
)

function paramLayoutClass(param) {
  if (!param) return 'param-span-compact'
  if (props.adapterId === 'shopee-webchat-bulk-reply') {
    if (['mode', 'run_mode'].includes(param.id)) {
      return 'param-span-half'
    }
    if (['start_row', 'end_row', 'batch_size'].includes(param.id)) {
      return 'param-span-third'
    }
  }
  if (param.type === 'file_excel' || param.type === 'file_images' || param.type === 'checkbox' || isRangeParamType(param.type) || isSingleTemporalParamType(param.type)) {
    return 'param-span-full'
  }
  if (param.type === 'radio' && (param.options?.length || 0) > 2) {
    return 'param-span-full'
  }
  return 'param-span-compact'
}

function imageParamLimit(param) {
  const value = Number(param?.max || 0)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function normalizeImagePaths(paths, maxCount = 0) {
  const normalized = Array.isArray(paths)
    ? paths.map(path => String(path || '').trim()).filter(Boolean)
    : []
  return maxCount > 0 ? normalized.slice(0, maxCount) : normalized
}

function imageSummary(param) {
  const count = (values.value[param.id + '_paths'] || []).length
  const maxCount = imageParamLimit(param)
  if (!count) {
    return maxCount > 0
      ? `点击选择图片（支持多选，最多 ${maxCount} 张）…`
      : '点击选择图片（支持多选）…'
  }
  return maxCount > 0 ? `${count} / ${maxCount} 张图片` : `${count} 张图片`
}

function orderVisibleParams(params) {
  const list = [...(params || [])]
  if (props.adapterId !== 'shopee-webchat-bulk-reply') return list

  const order = {
    mode: 1,
    run_mode: 2,
    start_row: 3,
    end_row: 4,
    batch_size: 5,
    input_file: 6,
  }

  return list.sort((a, b) => {
    const ao = order[a.id] ?? 999
    const bo = order[b.id] ?? 999
    if (ao !== bo) return ao - bo
    return String(a.label || '').localeCompare(String(b.label || ''), 'zh-CN')
  })
}

function isRangeParamType(type) {
  return ['date_range'].includes(String(type || ''))
}

function isSingleTemporalParamType(type) {
  return ['week', 'month', 'week_range', 'month_range'].includes(String(type || ''))
}

function normalizeRuleValues(value) {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null) return []
  return [value]
}

function matchesVisibleWhen(rule) {
  if (!rule || typeof rule !== 'object') return true
  const field = String(rule.field || rule.param_id || rule.id || '').trim()
  if (!field) return true

  const currentValue = values.value[field]
  if (Object.prototype.hasOwnProperty.call(rule, 'equals')) {
    return currentValue === rule.equals
  }
  if (Object.prototype.hasOwnProperty.call(rule, 'not_equals')) {
    return currentValue !== rule.not_equals
  }

  const oneOf = normalizeRuleValues(rule.in ?? rule.one_of)
  if (oneOf.length) return oneOf.includes(currentValue)

  const notIn = normalizeRuleValues(rule.not_in)
  if (notIn.length) return !notIn.includes(currentValue)

  return true
}

function isParamVisibleByRule(param) {
  const visibleWhen = param?.visible_when
  if (!visibleWhen) return true
  const rules = Array.isArray(visibleWhen) ? visibleWhen : [visibleWhen]
  return rules.every(matchesVisibleWhen)
}

function isParamVisibleInForm(param) {
  if (autoPrecheckFlow.value && param?.id === 'execute_mode') return false
  return isParamVisibleByRule(param)
}

function forceReset() {
  clearInterval(pollTimer)
  pollTimer = null
  runAbortToken += 1
  isRunning.value = false
  currentRunId = null
  runStage.value = ''
  logs.value.push('[重置] 已强制重置运行状态')
}

function buildRunParams(overrides = {}) {
  const params = {}
  for (const p of (props.task.params || [])) {
    if (!isParamVisibleInForm(p)) continue

    if (isSingleTemporalParamType(p.type)) {
      params[p.id] = values.value[p.id] || ''
      continue
    }

    if (isRangeParamType(p.type)) {
      params[p.id] = {
        start: values.value[p.id + '_start'] || '',
        end: values.value[p.id + '_end'] || '',
      }
      continue
    }

    if (p.type === 'select') {
      const v = values.value[p.id]
      params[p.id] = v
      if (v === '自定义') {
        const linkedRangeId = getLinkedDateRangeIdForSelect(p.id)
        const startKey = linkedRangeId ? linkedRangeId + '_start' : '_custom_start_' + p.id
        const endKey = linkedRangeId ? linkedRangeId + '_end' : '_custom_end_' + p.id
        params['custom_start'] = values.value[startKey] || ''
        params['custom_end'] = values.value[endKey] || ''
        params['custom_range'] = {
          start: params['custom_start'],
          end: params['custom_end'],
        }
      }
      continue
    }

    if (p.type === 'file_excel') {
      params[p.id] = {
        path: values.value[p.id + '_path'],
      }
      continue
    }

    if (p.type === 'file_images') {
      const maxCount = imageParamLimit(p)
      params[p.id] = {
        paths: normalizeImagePaths(values.value[p.id + '_paths'], maxCount),
      }
      continue
    }

    params[p.id] = values.value[p.id]
  }
  return JSON.parse(JSON.stringify({ ...params, ...overrides }))
}

async function resolveCurrentTabId(params) {
  let currentTabId = ''
  if (String(params.mode || '').trim().toLowerCase() === 'current') {
    try {
      const tab = await window.cs.getCurrentChromeTab?.()
      if (tab?.id) currentTabId = String(tab.id)
    } catch {}
  }
  return currentTabId
}

function resetRunUi() {
  lastResult.value = null
  outputFiles.value = []
  showFiles.value = false
}

async function pauseCurrentTask() {
  if (!isRunning.value || liveStatus.value !== 'running') return
  try {
    await window.cs.pauseTask(props.adapterId, props.task.task_id)
    logs.value.push(`[${now()}] 已发送暂停指令`)
    emit('status-change', { status: 'pausing', run_id: currentRunId })
    scrollToBottom()
  } catch (e) {
    logs.value.push(`[错误] ${e?.message || String(e)}`)
  }
}

async function resumeCurrentTask() {
  if (!isRunning.value || !['paused', 'pausing'].includes(liveStatus.value)) return
  try {
    await window.cs.resumeTask(props.adapterId, props.task.task_id)
    logs.value.push(`[${now()}] 已发送继续指令`)
    emit('status-change', { status: 'running', run_id: currentRunId })
    scrollToBottom()
  } catch (e) {
    logs.value.push(`[错误] ${e?.message || String(e)}`)
  }
}

async function stopCurrentTask() {
  if (!isRunning.value || liveStatus.value === 'stopping') return
  try {
    await window.cs.stopTask(props.adapterId, props.task.task_id)
    logs.value.push(`[${now()}] 已发送停止指令`)
    emit('status-change', { status: 'stopping', run_id: currentRunId })
    scrollToBottom()
  } catch (e) {
    logs.value.push(`[错误] ${e?.message || String(e)}`)
  }
}

async function startTaskRun(params, pendingMessage) {
  const currentTabId = await resolveCurrentTabId(params)
  const r = await window.cs.runTask(props.adapterId, props.task.task_id, params, {
    current_tab_id: currentTabId,
  })
  if (!r.ok) throw new Error(r.message || JSON.stringify(r))
  logs.value.push(`[${now()}] ${pendingMessage}`)
  emit('status-change', { status: 'running' })
  await new Promise(res => setTimeout(res, 600))
  const initStatus = await window.cs.getTaskStatus(props.adapterId, props.task.task_id)
  currentRunId = initStatus?.live?.run_id ?? initStatus?.last_run?.id ?? null
  const token = runAbortToken
  return await new Promise((resolve) => {
    pollTimer = setInterval(async () => {
      if (token !== runAbortToken) {
        clearInterval(pollTimer)
        pollTimer = null
        resolve({ status: 'cancelled' })
        return
      }
      const result = await pollStatusOnce()
      if (!result) return
      clearInterval(pollTimer)
      pollTimer = null
      resolve(result)
    }, 800)
  })
}

async function pollStatusOnce() {
  const r = await window.cs.getTaskStatus(props.adapterId, props.task.task_id)
  const live = r.live
  const logR = await window.cs.getTaskLogs(props.adapterId, props.task.task_id)

  if (logR.logs) logs.value = logR.logs
  if (live) emit('status-change', live)
  scrollToBottom()

  // live 有值且是当前任务正在跑 → 继续等
  if (live && isTaskActiveStatus(live.status)) return null

  // live 为 null 时：检查 last_run 是否是我们触发的这次（匹配 run_id）
  if (!live) {
    const last = r.last_run
    // 还没有 run_id（任务刚提交还没写入）→ 继续等
    if (!currentRunId) return null
    // last_run 不是当前任务 → 继续等
    if (!last || last.id !== currentRunId) return null
    // last_run 是当前任务但还在跑 → 继续等
    if (isTaskActiveStatus(last.status)) return null
    // last_run 是当前任务且已完成 → 用 last 作为结果
    const syntheticLive = { status: last.status, records: last.records_count, error: last.error, run_id: last.id }
    return syntheticLive
  }

  // live 有值且不是 running（done/error）且匹配当前 run_id
  if (currentRunId && live.run_id && live.run_id !== currentRunId) return null
  return live
}

function scrollToBottom() {
  nextTick(() => { if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight })
}

async function refreshOutputFiles() {
  const dataR = await window.cs.getData(props.adapterId, props.task.task_id)
  if (!dataR.runs?.[0]?.output_files) return []
  try {
    const files = typeof dataR.runs[0].output_files === 'string'
      ? JSON.parse(dataR.runs[0].output_files)
      : dataR.runs[0].output_files
    outputFiles.value = files || []
    if (files?.length) showFiles.value = true
    return files || []
  } catch {
    return []
  }
}

async function finishRun(result, options = {}) {
  clearInterval(pollTimer)
  pollTimer = null
  const keepRunning = !!options.keepRunning
  if (!keepRunning) {
    isRunning.value = false
    currentRunId = null
    runStage.value = ''
  } else {
    currentRunId = null
  }
  emit('status-change', result)

  if (result.status === 'done') {
    await refreshOutputFiles()
    if (options.message) {
      lastResult.value = { ok: !!options.ok, msg: options.message }
    } else {
      lastResult.value = { ok: true, msg: `✓ 完成，共 ${result.records ?? result.records_count ?? 0} 条记录` }
    }
  } else if (result.status === 'stopped') {
    await refreshOutputFiles()
    lastResult.value = {
      ok: false,
      msg: options.message || `■ 已停止，保留 ${result.records ?? result.records_count ?? 0} 条结果`,
    }
  } else if (result.status === 'error') {
    lastResult.value = { ok: false, msg: options.message || `✗ 失败: ${result.error || '未知错误'}` }
  }
}

async function inspectLatestPlanOutput() {
  const files = await refreshOutputFiles()
  const xlsx = files.find(f => String(f || '').toLowerCase().endsWith('.xlsx'))
  if (!xlsx) {
    return { pass: false, summary: '未找到预检结果文件' }
  }
  const sheet = await window.cs.readExcel(xlsx)
  const rows = Array.isArray(sheet?.rows) ? sheet.rows : []
  if (!rows.length) {
    return { pass: false, summary: '预检结果为空' }
  }
  const invalid = rows.filter(row => String(row['状态'] || '') === 'invalid')
  const outOfScope = rows.filter(row => String(row['状态'] || '') === 'ready_but_out_of_current_live_scope')
  const ready = rows.filter(row => String(row['状态'] || '') === 'ready_for_live')
  const parts = []
  if (ready.length) parts.push(`${ready.length} 行可直接执行`)
  if (invalid.length) parts.push(`${invalid.length} 行配置有误`)
  if (outOfScope.length) parts.push(`${outOfScope.length} 行超出当前 live 范围`)
  return {
    pass: !invalid.length && !outOfScope.length,
    summary: parts.join('，') || '未识别到有效预检结果',
  }
}

async function runValidationOnly() {
  if (isRunning.value) return
  isRunning.value = true
  resetRunUi()
  runStage.value = 'plan'
  try {
    const result = await startTaskRun(buildRunParams({ execute_mode: 'plan' }), 'Excel 预检已启动…')
    if (result.status === 'cancelled') return
    const gate = result.status === 'done' ? await inspectLatestPlanOutput() : null
    if (result.status === 'done') {
      await finishRun(result, {
        ok: gate?.pass !== false,
        message: gate?.summary
          ? `${gate?.pass === false ? '✗' : '✓'} 预检${gate?.pass === false ? '未通过' : '完成'}：${gate.summary}`
          : `✓ 预检完成，共 ${result.records ?? result.records_count ?? 0} 条记录`,
      })
      return
    }
    await finishRun(result)
  } catch (e) {
    isRunning.value = false
    runStage.value = ''
    currentRunId = null
    lastResult.value = { ok: false, msg: `✗ 失败: ${e?.message || String(e)}` }
    logs.value.push(`[错误] ${e?.message || String(e)}`)
  }
}

async function runTask() {
  if (isRunning.value) return
  if (!autoPrecheckFlow.value) {
    isRunning.value = true
    resetRunUi()
    runStage.value = 'live'
    try {
      const result = await startTaskRun(buildRunParams(), '任务已启动，等待执行…')
      if (result.status === 'cancelled') return
      await finishRun(result)
    } catch (e) {
      isRunning.value = false
      runStage.value = ''
      currentRunId = null
      lastResult.value = { ok: false, msg: `✗ 失败: ${e?.message || String(e)}` }
      logs.value.push(`[错误] ${e?.message || String(e)}`)
    }
    return
  }

  isRunning.value = true
  resetRunUi()
  try {
    runStage.value = 'plan'
    const planResult = await startTaskRun(buildRunParams({ execute_mode: 'plan' }), 'Excel 预检已启动…')
    if (planResult.status === 'cancelled') return
    if (planResult.status !== 'done') {
      await finishRun(planResult)
      return
    }
    const gate = await inspectLatestPlanOutput()
    logs.value.push(`[${now()}] 预检结果：${gate.summary}`)
    scrollToBottom()
    if (!gate.pass) {
      await finishRun(planResult, {
        ok: false,
        message: `✗ 预检未通过：${gate.summary}`,
      })
      return
    }

    runStage.value = 'live'
    const liveResult = await startTaskRun(buildRunParams({ execute_mode: 'live' }), '预检通过，开始 live 执行…')
    if (liveResult.status === 'cancelled') return
    await finishRun(liveResult)
  } catch (e) {
    isRunning.value = false
    runStage.value = ''
    currentRunId = null
    lastResult.value = { ok: false, msg: `✗ 失败: ${e?.message || String(e)}` }
    logs.value.push(`[错误] ${e?.message || String(e)}`)
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
  const explicit = params.find(p => isRangeParamType(p.type) && p.id === 'custom_range')
  if (explicit) return explicit.id
  const dateRanges = params.filter(p => isRangeParamType(p.type))
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
  if (!isParamVisibleByRule(param)) return false
  const controller = getControllerSelectForDateRange(param.id)
  if (!controller) return true
  return isCustomDateSelected(controller.id)
}

function getTemporalInputType(type) {
  if (type === 'week') return 'week'
  if (type === 'month') return 'month'
  if (type === 'week_range') return 'week'
  if (type === 'month_range') return 'month'
  return 'date'
}

function formatTemporalDisplay(value, type) {
  if (!value) {
    if (type === 'week') return '年 / 第几周'
    if (type === 'month') return '年 / 月'
    if (type === 'week_range') return '年 / 第几周'
    if (type === 'month_range') return '年 / 月'
    return '年 / 月 / 日'
  }

  if (type === 'week') {
    const match = String(value).match(/^(\d{4})-W(\d{2})$/i)
    if (match) return `${match[1]} / 第 ${match[2]} 周`
  }

  if (type === 'month') {
    return String(value).replace(/-/g, ' / ')
  }

  if (type === 'week_range') {
    const match = String(value).match(/^(\d{4})-W(\d{2})$/i)
    if (match) return `${match[1]} / 第 ${match[2]} 周`
  }

  if (type === 'month_range') {
    return String(value).replace(/-/g, ' / ')
  }

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

async function pickImages(param) {
  const paramId = param?.id
  if (!paramId) return
  const paths = await window.cs.browseFile({
    title: '选择图片文件',
    images: true,
    multi: true,
  })
  if (!Array.isArray(paths) || !paths.length) return
  values.value[paramId + '_paths'] = normalizeImagePaths(paths, imageParamLimit(param))
}

function clearImages(paramId) {
  values.value[paramId + '_paths'] = []
}

function getParamTemplates(param) {
  const templates = Array.isArray(param?.templates) ? param.templates.filter(Boolean) : []
  if (templates.length) return templates
  if (param?.template_file) {
    return [{
      file: param.template_file,
      label: param.template_label,
      path: param.template_path,
    }]
  }
  return []
}

function templateExtension(template) {
  const raw = template?.file || template?.path || ''
  const ext = raw.split('.').pop()?.toUpperCase()
  return ext ? `.${ext}` : '模板'
}

function canDownloadTemplate(template) {
  return Boolean(template?.path || template?.file)
}

async function downloadTemplate(task, param, template) {
  if (!canDownloadTemplate(template)) return
  delete templateFeedback.value[param.id]
  try {
    const r = await window.cs.saveAdapterTemplate(props.adapterId, template.file || '', template.path || '')
    if (r?.ok && r.dest) {
      templateFeedback.value[param.id] = {
        ok: true,
        msg: `${template.label || fileName(template.file || template.path)} 已保存：${fileName(r.dest)}`,
      }
    }
  } catch (e) {
    templateFeedback.value[param.id] = {
      ok: false,
      msg: `模板下载失败：${e?.message || String(e)}`,
    }
  }
}

onUnmounted(() => clearInterval(pollTimer))
</script>

<style scoped>
.runner { height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }

.runner-header {
  padding: 20px 24px 14px;
  border-bottom: 1px solid var(--border);
}
.runner-header h2 { font-size: 18px; font-weight: 700; color: var(--text); }
.desc { font-size: 12px; color: var(--text3); margin-top: 4px; }

.runner-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* 参数面板 */
.params-panel {
  padding: 20px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.params-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px 20px;
  align-items: start;
}
.params-grid-shopee-bulk {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}
.param-group { min-width: 0; display: flex; flex-direction: column; gap: 7px; }
.param-span-full { grid-column: 1 / -1; }
.param-span-compact { grid-column: span 1; }
.param-span-half { grid-column: span 3; }
.param-span-third { grid-column: span 2; }
.param-label { font-size: 12px; color: var(--text2); font-weight: 500; }
.required { color: var(--orange); margin-left: 3px; }
.hint { font-size: 11px; color: var(--text3); line-height: 1.5; }

.input {
  background: var(--bg3); border: 1px solid var(--border); border-radius: 8px;
  padding: 9px 12px; color: var(--text); font-size: 13px; outline: none;
  transition: border-color 0.15s; width: 100%;
}
.input:focus { border-color: var(--orange); }
.input-number { width: 100%; }
.select {
  background: var(--bg3); border: 1px solid var(--border); border-radius: 8px;
  padding: 9px 12px; color: var(--text); font-size: 13px; outline: none;
  cursor: pointer; width: 100%;
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
.run-sub-btn {
  padding: 10px 18px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg3);
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  transition: all 0.15s;
}
.run-sub-btn:hover:not(:disabled) { border-color: var(--orange); color: var(--orange); transform: translateY(-1px); }
.run-sub-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
.run-sub-btn-stop { border-color: rgba(248,113,113,0.35); color: #fca5a5; }
.run-sub-btn-stop:hover:not(:disabled) { border-color: #f87171; color: #f87171; }
.action-note { font-size: 12px; color: var(--text3); }
.missing-hint { font-size: 12px; color: var(--text3); }
.reset-link { font-size: 12px; color: var(--text3); cursor: pointer; text-decoration: underline; }
.reset-link:hover { color: #f87171; }
.result-badge { font-size: 12px; padding: 4px 10px; border-radius: 6px; }
.result-badge.ok  { background: rgba(74,222,128,0.12); color: #4ade80; }
.result-badge.err { background: rgba(248,113,113,0.12); color: #f87171; }

/* 日志面板 */
.log-panel {
  min-height: 280px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.log-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 16px; background: var(--bg2); border-bottom: 1px solid var(--border);
}
.log-header > span { font-size: 12px; color: var(--text2); font-weight: 600; }
.log-actions { display: flex; align-items: center; gap: 12px; }
.progress-strip {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(255,106,41,0.08), rgba(255,106,41,0.03));
}
.progress-strip-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.progress-strip-main {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  flex-wrap: wrap;
}
.progress-strip-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px 16px;
  flex-wrap: wrap;
  min-width: 0;
  text-align: right;
  font-size: 12px;
  color: var(--text2);
}
.progress-strip-title {
  font-size: 11px;
  color: var(--text3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.progress-strip-value {
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.progress-strip-percent {
  font-size: 12px;
  color: var(--orange);
  font-weight: 700;
}
.progress-strip-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.progress-track {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.progress-track-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  color: var(--text2);
  font-variant-numeric: tabular-nums;
}
.progress-track-secondary .progress-track-label {
  color: var(--text3);
}
.progress-strip-bar {
  position: relative;
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,106,41,0.18);
}
.progress-strip-bar.indeterminate {
  background: rgba(255,255,255,0.06);
}
.progress-strip-bar-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--orange), #ff9a5f);
  box-shadow: 0 0 12px rgba(255,106,41,0.25);
  transition: width 180ms ease;
}
.progress-strip-bar-secondary {
  border-color: rgba(124, 139, 255, 0.18);
  background: rgba(124, 139, 255, 0.08);
}
.progress-strip-bar-fill-secondary {
  background: linear-gradient(90deg, #7c8bff, #9dc1ff);
  box-shadow: 0 0 12px rgba(124, 139, 255, 0.22);
}
.progress-strip-bar-fill.indeterminate {
  width: 36%;
  min-width: 120px;
  border-radius: 999px;
  animation: progress-slide 1.6s ease-in-out infinite;
}
.progress-strip-sub {
  font-size: 12px;
  color: var(--text2);
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@keyframes progress-slide {
  0% { transform: translateX(-110%); }
  50% { transform: translateX(90%); }
  100% { transform: translateX(240%); }
}
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

/* 文件选择控件 */
.file-picker { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.file-chosen {
  flex: 1; display: flex; align-items: center; gap: 8px;
  background: var(--bg3); border: 1px solid var(--border); border-radius: 8px;
  padding: 8px 12px; cursor: pointer; transition: border-color 0.15s;
  min-width: 0;
}
.file-chosen:hover { border-color: var(--orange); }
.file-chosen.empty .f-label { color: var(--text3); }
.file-picker-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.f-ico { font-size: 15px; flex-shrink: 0; }
.f-label { flex: 1; font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.f-clear { font-size: 12px; color: var(--text3); flex-shrink: 0; line-height: 1; }
.f-clear:hover { color: #f87171; }
.btn-pick {
  padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--bg3); color: var(--text2); font-size: 12px; white-space: nowrap;
}
.btn-pick:hover { background: var(--orange-bg); color: var(--orange); border-color: var(--orange); }
.btn-template {
  padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(255, 106, 41, 0.28);
  background: rgba(255, 106, 41, 0.1); color: var(--orange); font-size: 12px; font-weight: 600;
  white-space: nowrap;
}
.btn-template:hover { background: rgba(255, 106, 41, 0.16); border-color: rgba(255, 106, 41, 0.42); }
.btn-template:disabled { opacity: 0.45; cursor: not-allowed; }
.template-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 2px;
}
.template-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
}
.template-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.template-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.template-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}
.template-ext,
.template-version {
  font-size: 10px;
  color: var(--text3);
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--bg2);
  border: 1px solid var(--border);
  letter-spacing: 0.04em;
}
.template-desc {
  margin: 0;
  font-size: 11px;
  color: var(--text3);
  line-height: 1.45;
}
.excel-preview {
  display: flex; gap: 12px; align-items: center;
  padding: 5px 10px; background: rgba(74,222,128,0.07); border-radius: 6px;
}
.preview-count { font-size: 12px; color: #4ade80; font-weight: 600; }
.preview-cols { font-size: 11px; color: var(--text3); }
.excel-loading { font-size: 12px; color: var(--text3); padding: 4px 0; }
.template-feedback { font-size: 12px; padding: 4px 0; }
.template-feedback.ok { color: #4ade80; }
.template-feedback.err { color: #f87171; }
.image-file-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.image-file-chip {
  max-width: 100%;
  font-size: 11px;
  color: var(--text2);
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--bg3);
  border: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 1040px) {
  .params-grid {
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }
  .params-grid-shopee-bulk {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }

  .progress-strip {
    gap: 8px;
  }

  .progress-strip-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .progress-strip-meta {
    justify-content: flex-start;
    text-align: left;
  }

  .progress-strip-sub {
    text-align: left;
    white-space: normal;
  }
}

@media (max-width: 900px) {
  .params-grid-shopee-bulk {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .param-span-half,
  .param-span-third { grid-column: span 1; }
}

@media (max-width: 640px) {
  .params-grid-shopee-bulk { grid-template-columns: minmax(0, 1fr); }
}
</style>
