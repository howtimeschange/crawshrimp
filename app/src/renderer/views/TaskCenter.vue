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
        <button type="button" class="tc-primary" :disabled="creating" @click="startCreateAiImageTask">
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

    <section class="tc-content">
      <div v-if="error || scheduleError" class="tc-state error">{{ error || scheduleError }}</div>
      <div v-else-if="loading || schedulesLoading" class="tc-state">加载中...</div>
      <div v-else-if="!combinedItems.length" class="tc-state">暂无任务</div>
      <article
        v-for="item in combinedItems"
        v-else
        :key="item.rowUid"
        :class="['tc-row', item.rowType]"
        :role="item.rowType === 'instance' ? 'button' : undefined"
        :tabindex="item.rowType === 'instance' ? 0 : undefined"
        @click="openTaskCenterItem(item)"
        @keydown.enter="openTaskCenterItem(item)"
      >
        <div class="tc-row-main">
          <strong>{{ item.title || '未命名任务' }}</strong>
          <span class="tc-type-line">
            <span class="tc-type-label">任务类型</span>
            <b>{{ itemTypeLabel(item) }}</b>
            <em>{{ item.adapter_id }} / {{ item.task_id }}</em>
          </span>
          <span v-if="item.rowType === 'schedule'">{{ scheduleFrequencyLabel(item) }} · {{ item.params?.output_dir || '默认导出目录' }}</span>
          <span v-else>{{ item.current_step || 'config' }}</span>
          <div v-if="aiPreviewImagesForTask(item).length" class="tc-ai-preview" aria-label="AI 图预览">
            <figure v-for="preview in aiPreviewImagesForTask(item)" :key="preview.id">
              <img :src="preview.url" :alt="preview.label" loading="lazy" />
            </figure>
          </div>
        </div>
        <div class="tc-row-meta">
          <span :class="['tc-status', itemStatusTone(item)]">{{ itemStatusLabel(item) }}</span>
          <span>{{ itemTimeLabel(item) }}</span>
          <span v-if="item.rowType === 'schedule'">最近 {{ item.last_status || '-' }}</span>
        </div>
        <div v-if="item.rowType === 'schedule'" class="tc-schedule-actions">
          <label class="tc-switch" @click.stop>
            <input
              type="checkbox"
              :checked="Boolean(item.enabled)"
              @change.stop="toggleSchedule(item, $event)"
            />
            <span>启用</span>
          </label>
          <button type="button" @click.stop="runScheduleNow(item)">运行一次</button>
          <button type="button" @click.stop="editSchedule(item)">编辑</button>
          <button type="button" class="danger" @click.stop="archiveSchedule(item)">归档</button>
        </div>
      </article>
    </section>

    <div v-if="showAiTaskDialog" class="tc-modal-backdrop" @click.self="cancelAiTaskCreate">
      <section class="tc-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-task-dialog-title">
        <header class="tc-modal-head">
          <div>
            <h3 id="ai-task-dialog-title">新增 AI 测图任务</h3>
            <p>创建一个新的巴拉-AI测图全链路任务实例</p>
          </div>
          <button type="button" class="tc-icon-button" aria-label="关闭" @click="cancelAiTaskCreate">×</button>
        </header>
        <form class="tc-dialog-form tc-ai-task-form" @submit.prevent="createAiImageTask">
          <label>
            <span>任务名称</span>
            <input v-model.trim="aiTaskForm.title" type="text" required />
          </label>
          <div v-if="aiTaskError" class="tc-inline-error">{{ aiTaskError }}</div>
          <div class="tc-form-actions">
            <button type="button" class="tc-secondary" @click="cancelAiTaskCreate">取消</button>
            <button type="submit" class="tc-primary" :disabled="creating">
              {{ creating ? '创建中...' : '创建任务' }}
            </button>
          </div>
        </form>
      </section>
    </div>

    <div v-if="showScheduleDialog" class="tc-modal-backdrop" @click.self="cancelScheduleEdit">
      <section class="tc-modal-dialog wide" role="dialog" aria-modal="true" aria-labelledby="schedule-dialog-title">
        <header class="tc-modal-head">
          <div>
            <h3 id="schedule-dialog-title">{{ editingScheduleUid ? '编辑定时任务' : '新增数据抓取定时任务' }}</h3>
            <p>巴拉-AI测图数据抓取导出可按每天或每周自动执行</p>
          </div>
          <button type="button" class="tc-icon-button" aria-label="关闭" @click="cancelScheduleEdit">×</button>
        </header>
        <form class="tc-schedule-form tc-dialog-form" @submit.prevent="saveSchedule">
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
          <div class="tc-field wide">
            <span>本地导出目录</span>
            <div class="tc-dir-picker" :class="{ empty: !scheduleForm.output_dir }">
              <button type="button" class="tc-dir-target" @click="chooseScheduleOutputDir">
                <span>{{ scheduleForm.output_dir || '留空使用系统下载目录下的抓虾默认导出地址' }}</span>
              </button>
              <button type="button" class="tc-secondary" @click="chooseScheduleOutputDir">
                选择文件夹
              </button>
              <button
                v-if="scheduleForm.output_dir"
                type="button"
                class="tc-secondary"
                @click="clearScheduleOutputDir"
              >
                清除
              </button>
            </div>
          </div>
          <label class="full">
            <span>钉钉消息模板</span>
            <textarea v-model="scheduleForm.notify_template" rows="8" />
          </label>
          <label class="tc-check">
            <input v-model="scheduleForm.enabled" type="checkbox" />
            <span>启用定时任务</span>
          </label>
          <div v-if="scheduleError" class="tc-inline-error tc-form-message">{{ scheduleError }}</div>
          <div class="tc-form-actions">
            <button type="button" class="tc-secondary" @click="cancelScheduleEdit">取消</button>
            <button type="submit" class="tc-primary" :disabled="savingSchedule">
              {{ savingSchedule ? '保存中...' : (editingScheduleUid ? '保存定时任务' : '创建定时任务') }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'

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
const showAiTaskDialog = ref(false)
const showScheduleDialog = ref(false)
const editingScheduleUid = ref('')
const error = ref('')
const scheduleError = ref('')
const aiTaskError = ref('')
const aiTaskForm = ref(defaultAiTaskForm())
const scheduleForm = ref(defaultScheduleForm())
const aiPreviewCache = ref({})
const aiPreviewLoading = ref({})

function defaultAiTaskForm() {
  return {
    title: `AI测图任务 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
  }
}

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
    void loadAiPreviewsForItems(items.value)
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

function startCreateAiImageTask() {
  aiTaskForm.value = defaultAiTaskForm()
  aiTaskError.value = ''
  showAiTaskDialog.value = true
}

function cancelAiTaskCreate() {
  showAiTaskDialog.value = false
  aiTaskForm.value = defaultAiTaskForm()
  aiTaskError.value = ''
}

async function createAiImageTask() {
  creating.value = true
  error.value = ''
  aiTaskError.value = ''
  try {
    const title = String(aiTaskForm.value.title || '').trim() || defaultAiTaskForm().title
    const result = await window.cs.createTaskInstance({
      adapter_id: 'tmall-ops-assistant',
      task_id: 'tmall_ai_image_test_chain',
      title,
      params: {},
    })
    cancelAiTaskCreate()
    await loadInstances()
    if (result?.instance_uid) emit('open-instance', result.instance_uid)
  } catch (err) {
    aiTaskError.value = err?.message || String(err)
  } finally {
    creating.value = false
  }
}

function startCreateSchedule() {
  editingScheduleUid.value = ''
  scheduleForm.value = defaultScheduleForm()
  scheduleError.value = ''
  showScheduleDialog.value = true
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
  showScheduleDialog.value = true
}

function cancelScheduleEdit() {
  editingScheduleUid.value = ''
  showScheduleDialog.value = false
  scheduleForm.value = defaultScheduleForm()
  scheduleError.value = ''
}

async function chooseScheduleOutputDir() {
  scheduleError.value = ''
  try {
    const selected = await window.cs.browseFile({
      title: '选择本地导出目录',
      directory: true,
    })
    if (selected) scheduleForm.value.output_dir = selected
  } catch (err) {
    scheduleError.value = err?.message || String(err)
  }
}

function clearScheduleOutputDir() {
  scheduleForm.value.output_dir = ''
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
    await refreshAll()
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
    await refreshAll()
  } catch (err) {
    scheduleError.value = err?.message || String(err)
    await refreshAll()
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
    await refreshAll()
  } catch (err) {
    scheduleError.value = err?.message || String(err)
  }
}

const combinedItems = computed(() => {
  const instanceRows = items.value.map(item => ({
    ...item,
    rowType: 'instance',
    rowUid: `instance:${item.instance_uid}`,
  }))
  const scheduleRows = schedules.value
    .filter(scheduleVisibleInActiveGroup)
    .map(schedule => ({
      ...schedule,
      rowType: 'schedule',
      rowUid: `schedule:${schedule.schedule_uid}`,
      status: schedule.enabled ? 'enabled' : 'disabled',
    }))
  return [...scheduleRows, ...instanceRows].sort((left, right) =>
    sortableTime(right) - sortableTime(left)
  )
})

function scheduleVisibleInActiveGroup(schedule) {
  if (activeGroup.value === 'history') return false
  if (activeGroup.value === 'pending') {
    return !schedule.enabled || ['failed', 'error', 'create_failed', 'partial_failed'].includes(String(schedule.last_status || '').trim())
  }
  return true
}

function sortableTime(item) {
  const value = item.updated_at || item.created_at || item.last_triggered_at || item.next_run || ''
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function openTaskCenterItem(item) {
  if (item?.rowType !== 'instance' || !item.instance_uid) return
  emit('open-instance', item.instance_uid)
}

function itemTypeLabel(item) {
  if (item?.rowType === 'schedule') return '定时任务'
  if (item?.task_id === 'tmall_ai_image_test_chain') return 'AI 测图任务'
  return '脚本任务'
}

function itemStatusLabel(item) {
  if (item?.rowType === 'schedule') return item.enabled ? '已启用' : '已停用'
  return statusLabel(item?.status)
}

function itemStatusTone(item) {
  if (item?.rowType === 'schedule') return item.enabled ? 'active' : 'neutral'
  return statusTone(item?.status)
}

function itemTimeLabel(item) {
  if (item?.rowType === 'schedule') return `下次 ${formatTime(item.next_run)}`
  return formatTime(item.updated_at || item.created_at)
}

function aiPreviewImagesForTask(item) {
  if (item?.rowType !== 'instance') return []
  return aiPreviewCache.value[item.instance_uid] || []
}

function setAiPreviewCache(instanceUid, previews) {
  aiPreviewCache.value = {
    ...aiPreviewCache.value,
    [instanceUid]: previews,
  }
}

function setAiPreviewLoading(instanceUid, loadingValue) {
  aiPreviewLoading.value = {
    ...aiPreviewLoading.value,
    [instanceUid]: loadingValue,
  }
}

function approvalRefFromSummary(summary) {
  const directBatchId = String(summary?.approval_batch_id || '').trim()
  const directToken = String(summary?.approval_token || '').trim()
  const boardUrl = String(summary?.approval_board_url || '').trim()
  let origin = ''
  let batchId = directBatchId
  let token = directToken
  try {
    const parsed = new URL(boardUrl)
    origin = parsed.origin
    const parts = parsed.pathname.split('/').filter(Boolean)
    batchId = batchId || parts[parts.length - 1] || ''
    token = token || parsed.searchParams.get('token') || ''
  } catch {}
  return {
    origin: origin || 'http://127.0.0.1:18765',
    batchId,
    token,
  }
}

function tmallApprovalImageUrl(origin, batchId, token, assetId) {
  return `${origin}/tmall-ai-image-approval/api/${encodeURIComponent(batchId)}/image/${encodeURIComponent(assetId)}?token=${encodeURIComponent(token)}`
}

function extractAiPreviewImages(batch, ref) {
  return (batch?.items || [])
    .flatMap(item => item?.assets || [])
    .filter(asset => asset?.kind === 'ai' && asset?.id)
    .slice(0, 4)
    .map(asset => ({
      id: String(asset.id),
      label: String(asset.label || asset.filename || 'AI 图'),
      url: tmallApprovalImageUrl(ref.origin, ref.batchId, ref.token, asset.id),
    }))
}

async function loadAiPreviewsForItems(rows) {
  await Promise.all((rows || []).map(async (item) => {
    if (item?.task_id !== 'tmall_ai_image_test_chain' || !item?.instance_uid) return
    if (aiPreviewCache.value[item.instance_uid] || aiPreviewLoading.value[item.instance_uid]) return
    const ref = approvalRefFromSummary(item.summary || {})
    if (!ref.batchId || !ref.token) return
    setAiPreviewLoading(item.instance_uid, true)
    try {
      const batch = await window.cs.getTmallApprovalBatch(ref.batchId, ref.token)
      setAiPreviewCache(item.instance_uid, extractAiPreviewImages(batch, ref))
    } catch {
      setAiPreviewCache(item.instance_uid, [])
    } finally {
      setAiPreviewLoading(item.instance_uid, false)
    }
  }))
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
.tc-head h2 {
  color: var(--text);
  font-size: 18px;
  font-weight: 800;
}
.tc-head p {
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
.tc-schedule-form textarea,
.tc-dialog-form input,
.tc-dialog-form select,
.tc-dialog-form textarea {
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
.tc-schedule-form label,
.tc-schedule-form .tc-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text3);
  font-size: 12px;
}
.tc-schedule-form label.wide,
.tc-schedule-form .tc-field.wide {
  grid-column: span 2;
}
.tc-schedule-form label.full,
.tc-schedule-form .tc-field.full {
  grid-column: 1 / -1;
}
.tc-schedule-form textarea {
  resize: vertical;
  min-height: 180px;
}
.tc-dir-picker {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
}
.tc-dir-target {
  min-width: 0;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text);
  padding: 8px 11px;
  text-align: left;
  cursor: pointer;
}
.tc-dir-target span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tc-dir-picker.empty .tc-dir-target {
  color: var(--text3);
}
.tc-dir-picker .tc-secondary {
  height: 34px;
  white-space: nowrap;
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
.tc-row-main,
.tc-row-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tc-row-main strong {
  color: var(--text);
  font-size: 14px;
}
.tc-row-main span,
.tc-row-meta span:last-child {
  color: var(--text3);
  font-size: 12px;
}
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
.tc-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(3, 5, 12, .62);
}
.tc-modal-dialog {
  width: min(520px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg2);
  box-shadow: 0 24px 70px rgba(0, 0, 0, .42);
}
.tc-modal-dialog.wide {
  width: min(960px, calc(100vw - 32px));
}
.tc-modal-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
}
.tc-modal-head h3 {
  margin: 0;
  color: var(--text);
  font-size: 16px;
  line-height: 1.25;
}
.tc-modal-head p {
  margin: 5px 0 0;
  color: var(--text3);
  font-size: 12px;
}
.tc-icon-button {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text2);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.tc-dialog-form {
  margin: 0;
  padding: 16px 20px 20px;
  border: 0;
  background: transparent;
}
.tc-ai-task-form {
  display: grid;
  gap: 12px;
}
.tc-ai-task-form label {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text3);
  font-size: 12px;
}
.tc-dialog-form .tc-form-actions {
  grid-column: 1 / -1;
}
.tc-form-message {
  grid-column: 1 / -1;
  margin-top: 0;
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
  min-height: 76px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(130px, auto);
  gap: 18px;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  color: inherit;
  text-align: left;
  margin-bottom: 8px;
  cursor: pointer;
}
.tc-row.schedule {
  grid-template-columns: minmax(0, 1fr) minmax(130px, auto) auto;
  cursor: default;
}
.tc-row:hover {
  border-color: rgba(255, 107, 43, .34);
  background: color-mix(in srgb, var(--bg2) 88%, var(--orange) 12%);
}
.tc-row.schedule:hover {
  border-color: var(--border);
  background: var(--bg2);
}
.tc-type-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.tc-type-label {
  color: var(--text3);
}
.tc-type-line b {
  border: 1px solid rgba(255, 107, 43, .28);
  border-radius: 999px;
  background: rgba(255, 107, 43, .08);
  color: var(--orange);
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 700;
}
.tc-type-line em {
  min-width: 0;
  color: var(--text3);
  font-size: 12px;
  font-style: normal;
}
.tc-ai-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.tc-ai-preview figure {
  width: 46px;
  height: 60px;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg3);
}
.tc-ai-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
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
  .tc-schedule-form label.wide,
  .tc-schedule-form .tc-field.wide {
    grid-column: span 1;
  }
  .tc-dir-picker {
    grid-template-columns: minmax(0, 1fr);
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
