<template>
  <div class="task-center">
    <header class="tc-head">
      <div>
        <h2>任务中心</h2>
        <p>实例化管理脚本任务、审批状态、历史结果和定时运行</p>
      </div>
      <div class="tc-head-actions">
        <button type="button" class="tc-secondary" @click="startCreateSchedule">
          新增数据抓取定时任务
        </button>
        <button type="button" class="tc-primary" :disabled="creating" @click="createAiImageTask">
          {{ creating ? '创建中...' : '新增 AI 测图任务' }}
        </button>
      </div>
    </header>

    <section class="tc-toolbar">
      <div class="tc-tabs" role="tablist">
        <button
          v-for="tab in groups"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="activeGroup === tab.id"
          :class="{ active: activeGroup === tab.id }"
          @click="activeGroup = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>
      <div class="tc-search">
        <input
          v-model.trim="keyword"
          type="search"
          placeholder="搜索脚本、任务、实例"
          @keydown.enter="loadInstances"
        />
        <button type="button" :disabled="loading" @click="refreshAll">
          {{ loading || schedulesLoading ? '刷新中...' : '刷新' }}
        </button>
      </div>
    </section>

    <section class="tc-schedules">
      <div class="tc-section-head">
        <div>
          <h3>定时任务</h3>
          <p>首批接入 巴拉-AI测图数据抓取导出，可每天或每周自动运行</p>
        </div>
        <span v-if="schedules.length" class="tc-count">{{ schedules.length }} 个</span>
      </div>

      <form v-if="showScheduleForm" class="tc-schedule-form" @submit.prevent="saveSchedule">
        <label>
          <span>任务名称</span>
          <input v-model.trim="scheduleForm.title" type="text" required />
        </label>
        <label>
          <span>频次</span>
          <select v-model="scheduleForm.frequency">
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
          </select>
        </label>
        <label v-if="scheduleForm.frequency === 'weekly'">
          <span>周几</span>
          <select v-model.number="scheduleForm.weekday">
            <option v-for="day in weekdays" :key="day.value" :value="day.value">
              {{ day.label }}
            </option>
          </select>
        </label>
        <label>
          <span>时间</span>
          <input v-model="scheduleForm.time_of_day" type="time" required />
        </label>
        <label class="wide">
          <span>本地导出目录</span>
          <input
            v-model.trim="scheduleForm.output_dir"
            type="text"
            placeholder="留空使用系统下载目录下的抓虾默认导出地址"
          />
        </label>
        <label class="wide">
          <span>钉钉消息模板</span>
          <textarea v-model="scheduleForm.notify_template" rows="4" />
        </label>
        <label class="tc-check">
          <input v-model="scheduleForm.enabled" type="checkbox" />
          <span>启用定时任务</span>
        </label>
        <div class="tc-form-actions">
          <button type="button" class="tc-secondary" @click="cancelScheduleEdit">取消</button>
          <button type="submit" class="tc-primary" :disabled="savingSchedule">
            {{ savingSchedule ? '保存中...' : (editingScheduleUid ? '保存定时任务' : '创建定时任务') }}
          </button>
        </div>
      </form>

      <div v-if="scheduleError" class="tc-inline-error">{{ scheduleError }}</div>
      <div v-else-if="schedulesLoading" class="tc-inline-state">定时任务加载中...</div>
      <div v-else-if="!schedules.length" class="tc-inline-state">暂无定时任务</div>
      <div v-else class="tc-schedule-list">
        <article v-for="schedule in schedules" :key="schedule.schedule_uid" class="tc-schedule-card">
          <div class="tc-schedule-main">
            <strong>{{ schedule.title || '未命名定时任务' }}</strong>
            <span>{{ scheduleFrequencyLabel(schedule) }} · {{ schedule.task_id }}</span>
            <small>{{ schedule.params?.output_dir || '默认导出目录' }}</small>
          </div>
          <div class="tc-schedule-meta">
            <span :class="['tc-status', schedule.enabled ? 'active' : 'neutral']">
              {{ schedule.enabled ? '已启用' : '已停用' }}
            </span>
            <span>下次 {{ formatTime(schedule.next_run) }}</span>
            <span>最近 {{ schedule.last_status || '-' }}</span>
          </div>
          <div class="tc-schedule-actions">
            <label class="tc-switch">
              <input
                type="checkbox"
                :checked="Boolean(schedule.enabled)"
                @change="toggleSchedule(schedule, $event)"
              />
              <span>启用</span>
            </label>
            <button type="button" @click="runScheduleNow(schedule)">运行一次</button>
            <button type="button" @click="editSchedule(schedule)">编辑</button>
            <button type="button" class="danger" @click="archiveSchedule(schedule)">归档</button>
          </div>
        </article>
      </div>
    </section>

    <section class="tc-content">
      <div v-if="error" class="tc-state error">{{ error }}</div>
      <div v-else-if="loading" class="tc-state">加载中...</div>
      <div v-else-if="!items.length" class="tc-state">暂无任务</div>
      <button
        v-for="item in items"
        v-else
        :key="item.instance_uid"
        type="button"
        class="tc-row"
        @click="$emit('open-instance', item.instance_uid)"
      >
        <div class="tc-row-main">
          <strong>{{ item.title || '未命名任务' }}</strong>
          <span>{{ item.adapter_id }} / {{ item.task_id }}</span>
        </div>
        <div class="tc-row-meta">
          <span :class="['tc-status', statusTone(item.status)]">{{ statusLabel(item.status) }}</span>
          <span>{{ formatTime(item.updated_at || item.created_at) }}</span>
        </div>
      </button>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue'

const emit = defineEmits(['open-instance'])

const defaultNotifyTemplate = `巴拉-AI测图数据抓取导出执行通知
定时任务：{{schedule_title}}
执行状态：{{status}}
导出记录：{{records}}
输出文件：{{output_files}}
导出目录：{{export_dir}}
完成时间：{{finished_at}}
错误信息：{{error}}`

const groups = [
  { id: 'current', label: '当前任务' },
  { id: 'pending', label: '待处理' },
  { id: 'history', label: '历史任务' },
]

const weekdays = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' },
]

const activeGroup = ref('current')
const keyword = ref('')
const items = ref([])
const schedules = ref([])
const loading = ref(false)
const schedulesLoading = ref(false)
const creating = ref(false)
const savingSchedule = ref(false)
const showScheduleForm = ref(false)
const editingScheduleUid = ref('')
const error = ref('')
const scheduleError = ref('')
const scheduleForm = ref(defaultScheduleForm())

function defaultScheduleForm() {
  return {
    title: `巴拉数据抓取 ${new Date().toLocaleDateString('zh-CN')}`,
    frequency: 'daily',
    weekday: 1,
    time_of_day: '09:30',
    output_dir: '',
    notify_template: defaultNotifyTemplate,
    enabled: true,
  }
}

async function refreshAll() {
  await Promise.all([loadInstances(), loadSchedules()])
}

async function loadInstances() {
  loading.value = true
  error.value = ''
  try {
    const result = await window.cs.listTaskInstances({
      status_group: activeGroup.value,
      keyword: keyword.value,
    })
    items.value = Array.isArray(result?.items) ? result.items : []
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

async function loadSchedules() {
  schedulesLoading.value = true
  scheduleError.value = ''
  try {
    const result = await window.cs.listTaskSchedules({
      adapter_id: 'tmall-ops-assistant',
      task_id: 'tmall_material_test_data_export',
    })
    schedules.value = Array.isArray(result?.items) ? result.items : []
  } catch (err) {
    scheduleError.value = err?.message || String(err)
  } finally {
    schedulesLoading.value = false
  }
}

async function createAiImageTask() {
  creating.value = true
  error.value = ''
  try {
    const result = await window.cs.createTaskInstance({
      adapter_id: 'tmall-ops-assistant',
      task_id: 'tmall_ai_image_test_chain',
      title: `AI测图任务 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      params: {},
    })
    await loadInstances()
    if (result?.instance_uid) emit('open-instance', result.instance_uid)
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    creating.value = false
  }
}

function startCreateSchedule() {
  editingScheduleUid.value = ''
  scheduleForm.value = defaultScheduleForm()
  scheduleError.value = ''
  showScheduleForm.value = true
}

function editSchedule(schedule) {
  editingScheduleUid.value = schedule.schedule_uid
  scheduleForm.value = {
    title: schedule.title || '',
    frequency: schedule.frequency || 'daily',
    weekday: Number(schedule.weekday || 1),
    time_of_day: schedule.time_of_day || '09:30',
    output_dir: schedule.params?.output_dir || '',
    notify_template: schedule.notify_template || defaultNotifyTemplate,
    enabled: Boolean(schedule.enabled),
  }
  scheduleError.value = ''
  showScheduleForm.value = true
}

function cancelScheduleEdit() {
  editingScheduleUid.value = ''
  showScheduleForm.value = false
  scheduleForm.value = defaultScheduleForm()
}

function schedulePayload() {
  const params = {}
  if (scheduleForm.value.output_dir) params.output_dir = scheduleForm.value.output_dir
  return {
    adapter_id: 'tmall-ops-assistant',
    task_id: 'tmall_material_test_data_export',
    title: scheduleForm.value.title,
    frequency: scheduleForm.value.frequency,
    time_of_day: scheduleForm.value.time_of_day,
    weekday: scheduleForm.value.frequency === 'weekly' ? Number(scheduleForm.value.weekday || 1) : null,
    params,
    notify_channel: 'dingtalk',
    notify_template: scheduleForm.value.notify_template || defaultNotifyTemplate,
    enabled: Boolean(scheduleForm.value.enabled),
  }
}

async function saveSchedule() {
  savingSchedule.value = true
  scheduleError.value = ''
  try {
    const payload = schedulePayload()
    if (editingScheduleUid.value) {
      await window.cs.updateTaskSchedule(editingScheduleUid.value, payload)
    } else {
      await window.cs.createTaskSchedule(payload)
    }
    cancelScheduleEdit()
    await loadSchedules()
  } catch (err) {
    scheduleError.value = err?.message || String(err)
  } finally {
    savingSchedule.value = false
  }
}

async function toggleSchedule(schedule, event) {
  scheduleError.value = ''
  try {
    await window.cs.updateTaskSchedule(schedule.schedule_uid, { enabled: Boolean(event?.target?.checked) })
    await loadSchedules()
  } catch (err) {
    scheduleError.value = err?.message || String(err)
    await loadSchedules()
  }
}

async function runScheduleNow(schedule) {
  scheduleError.value = ''
  try {
    const result = await window.cs.runTaskScheduleNow(schedule.schedule_uid)
    await Promise.all([loadSchedules(), loadInstances()])
    if (result?.instance_uid) emit('open-instance', result.instance_uid)
  } catch (err) {
    scheduleError.value = err?.message || String(err)
  }
}

async function archiveSchedule(schedule) {
  scheduleError.value = ''
  try {
    await window.cs.deleteTaskSchedule(schedule.schedule_uid)
    await loadSchedules()
  } catch (err) {
    scheduleError.value = err?.message || String(err)
  }
}

function scheduleFrequencyLabel(schedule) {
  if (schedule.frequency === 'weekly') return `每周${weekdayLabel(schedule.weekday)} ${schedule.time_of_day}`
  return `每天 ${schedule.time_of_day}`
}

function weekdayLabel(value) {
  return weekdays.find((item) => item.value === Number(value))?.label?.replace('周', '') || '-'
}

function statusLabel(status) {
  const labels = {
    draft: '草稿',
    queued: '排队中',
    running: '运行中',
    generating: '生图中',
    waiting_approval: '待审批',
    creating: '创建中',
    completed: '已完成',
    stopped: '已停止',
    failed: '失败',
    create_failed: '创建失败',
    partial_failed: '部分失败',
    archived: '已归档',
  }
  return labels[String(status || '').trim()] || status || '-'
}

function statusTone(status) {
  const value = String(status || '').trim()
  if (['failed', 'create_failed', 'partial_failed'].includes(value)) return 'error'
  if (['completed', 'archived'].includes(value)) return 'done'
  if (['waiting_approval'].includes(value)) return 'pending'
  if (['running', 'generating', 'creating', 'queued'].includes(value)) return 'active'
  return 'neutral'
}

function formatTime(value) {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return value
  }
}

watch(activeGroup, loadInstances)
onMounted(refreshAll)
</script>

<style scoped>
.task-center {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.tc-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border);
}
.tc-head h2,
.tc-section-head h3 {
  color: var(--text);
  font-size: 18px;
  font-weight: 800;
}
.tc-section-head h3 {
  font-size: 14px;
}
.tc-head p,
.tc-section-head p {
  margin-top: 4px;
  color: var(--text3);
  font-size: 12px;
}
.tc-head-actions,
.tc-form-actions,
.tc-schedule-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tc-primary,
.tc-secondary,
.tc-search button,
.tc-tabs button,
.tc-schedule-actions button {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text2);
  padding: 8px 12px;
  font-size: 12px;
}
.tc-primary {
  border-color: rgba(255, 107, 43, .48);
  background: var(--orange);
  color: #fff;
  font-weight: 700;
}
.tc-secondary {
  background: var(--bg2);
}
.tc-schedule-actions button.danger {
  color: #fca5a5;
}
.tc-primary:disabled,
.tc-search button:disabled {
  cursor: not-allowed;
  opacity: .6;
}
.tc-toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
}
.tc-tabs,
.tc-search {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.tc-tabs button.active {
  border-color: rgba(255, 107, 43, .48);
  background: var(--orange-bg);
  color: var(--orange);
}
.tc-search input,
.tc-schedule-form input,
.tc-schedule-form select,
.tc-schedule-form textarea {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text);
  padding: 8px 11px;
  outline: none;
}
.tc-search input {
  width: min(320px, 32vw);
  min-width: 180px;
}
.tc-schedules {
  flex: 0 0 auto;
  padding: 14px 24px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg2) 86%, var(--bg3) 14%);
}
.tc-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.tc-count {
  color: var(--text3);
  font-size: 12px;
}
.tc-schedule-form {
  display: grid;
  grid-template-columns: repeat(4, minmax(140px, 1fr));
  gap: 10px;
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}
.tc-schedule-form label {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text3);
  font-size: 12px;
}
.tc-schedule-form label.wide {
  grid-column: span 2;
}
.tc-schedule-form textarea {
  resize: vertical;
}
.tc-check,
.tc-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text3);
  font-size: 12px;
}
.tc-check {
  flex-direction: row !important;
}
.tc-form-actions {
  justify-content: flex-end;
}
.tc-inline-error,
.tc-inline-state {
  margin-top: 10px;
  color: var(--text3);
  font-size: 12px;
}
.tc-inline-error {
  color: var(--red);
}
.tc-schedule-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
.tc-schedule-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 14px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}
.tc-schedule-main,
.tc-schedule-meta,
.tc-row-main,
.tc-row-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tc-schedule-main strong,
.tc-row-main strong {
  color: var(--text);
  font-size: 14px;
}
.tc-schedule-main span,
.tc-schedule-main small,
.tc-schedule-meta span,
.tc-row-main span,
.tc-row-meta span:last-child {
  color: var(--text3);
  font-size: 12px;
}
.tc-schedule-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tc-schedule-meta,
.tc-row-meta {
  align-items: flex-end;
  text-align: right;
}
.tc-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 24px 24px;
}
.tc-state {
  display: grid;
  place-items: center;
  min-height: 180px;
  color: var(--text3);
  font-size: 13px;
}
.tc-state.error {
  color: var(--red);
}
.tc-row {
  width: 100%;
  min-height: 72px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  color: inherit;
  text-align: left;
  margin-bottom: 8px;
}
.tc-row:hover {
  border-color: rgba(255, 107, 43, .34);
  background: color-mix(in srgb, var(--bg2) 88%, var(--orange) 12%);
}
.tc-status {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 4px 9px;
  color: var(--text2);
  font-size: 12px;
}
.tc-status.active { border-color: rgba(96, 165, 250, .35); color: #93c5fd; }
.tc-status.pending { border-color: rgba(251, 191, 36, .35); color: #fbbf24; }
.tc-status.done { border-color: rgba(74, 222, 128, .32); color: #86efac; }
.tc-status.error { border-color: rgba(248, 113, 113, .34); color: #fca5a5; }
.tc-status.neutral { color: var(--text3); }
@media (max-width: 920px) {
  .tc-head,
  .tc-toolbar,
  .tc-head-actions {
    align-items: stretch;
    flex-direction: column;
  }
  .tc-search input {
    width: 100%;
  }
  .tc-schedule-form {
    grid-template-columns: minmax(0, 1fr);
  }
  .tc-schedule-form label.wide {
    grid-column: span 1;
  }
  .tc-schedule-card,
  .tc-row {
    grid-template-columns: minmax(0, 1fr);
  }
  .tc-schedule-meta,
  .tc-row-meta {
    align-items: flex-start;
    text-align: left;
  }
  .tc-schedule-actions {
    flex-wrap: wrap;
  }
}
</style>
