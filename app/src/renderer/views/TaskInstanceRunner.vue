<template>
  <div class="task-instance-runner">
    <header class="tir-head">
      <button type="button" class="tir-back" @click="$emit('back')">返回任务中心</button>
      <div class="tir-title">
        <strong>{{ instance?.title || '任务实例' }}</strong>
        <span>{{ instance?.adapter_id || '-' }} / {{ instance?.task_id || '-' }}</span>
      </div>
      <span :class="['tir-status', statusTone(instance?.status)]">{{ statusLabel(instance?.status) }}</span>
    </header>

    <section v-if="instance" class="tir-readback">
      <div class="tir-readback-item">
        <span>审批批次</span>
        <strong>{{ instance.summary?.approval_batch_id || '-' }}</strong>
      </div>
      <div class="tir-readback-item">
        <span>创建结果</span>
        <strong>{{ createSummaryText }}</strong>
      </div>
      <button
        v-if="preferredApprovalBoardUrl"
        type="button"
        class="tir-link"
        @click="openArtifact(preferredApprovalBoardUrl)"
      >
        审批看板
      </button>
      <div v-if="instance.artifacts?.length" class="tir-artifacts">
        <button
          v-for="artifact in instance.artifacts"
          :key="artifact.id || artifact.path"
          type="button"
          @click="openArtifact(artifact.path)"
        >
          {{ artifact.label || artifactName(artifact.path) }}
        </button>
      </div>
    </section>

    <div v-if="loading" class="tir-state">加载中...</div>
    <div v-else-if="error" class="tir-state error">{{ error }}</div>
    <TaskRunner
      v-else-if="task"
      :key="`${instanceUid}-${reloadToken}`"
      :adapter-id="instance.adapter_id"
      :task="task"
      :instance-uid="instanceUid"
      :initial-params="instance.params || {}"
      :initial-step="instance.current_step || ''"
      @status-change="handleStatusChange"
      @instance-updated="handleInstanceUpdated"
    />
    <div v-else class="tir-state">未找到脚本任务</div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import TaskRunner from './TaskRunner.vue'
import { mergeTaskLiveStatus } from '../utils/taskRunnerState'

const props = defineProps({
  instanceUid: { type: String, required: true },
})

defineEmits(['back'])

const instance = ref(null)
const task = ref(null)
const loading = ref(false)
const error = ref('')
const preferredApprovalBoardUrl = computed(() => {
  const summary = instance.value?.summary || {}
  const local = String(summary.local_board_url || '').trim()
  if (local) return local
  const approval = String(summary.approval_board_url || '').trim()
  return isLocalTmallApprovalBoardUrl(approval) ? approval : ''
})
const createSummaryText = computed(() => {
  const summary = instance.value?.summary || {}
  const attempted = Number(summary.attempted || 0)
  const succeeded = Number(summary.succeeded || 0)
  const failed = Number(summary.failed || 0)
  if (attempted || succeeded || failed) return `成功 ${succeeded} / 失败 ${failed} / 尝试 ${attempted}`
  if (Object.prototype.hasOwnProperty.call(summary, 'records')) return `${Number(summary.records || 0)} 条记录`
  return '-'
})
const reloadToken = ref(0)

async function loadInstance() {
  if (!props.instanceUid) return
  loading.value = true
  error.value = ''
  try {
    const [detail, tasks] = await Promise.all([
      window.cs.getTaskInstance(props.instanceUid),
      window.cs.getTasks(),
    ])
    instance.value = detail
    task.value = (tasks || []).find(item =>
      item.adapter_id === detail.adapter_id &&
      item.task_id === detail.task_id
    ) || null
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

function handleStatusChange(status) {
  if (!instance.value || !status?.status) return
  task.value = mergeTaskLiveStatus(task.value, status)
  if (status.status === 'running') instance.value.status = 'running'
  if (status.status === 'done') instance.value.status = status.approval_board_url ? 'waiting_approval' : (instance.value.status === 'waiting_approval' ? 'waiting_approval' : 'completed')
  if (status.status === 'error') instance.value.status = 'failed'
  if (status.status === 'stopped') instance.value.status = 'stopped'
  if (['done', 'error', 'stopped'].includes(status.status)) {
    setTimeout(loadInstance, 800)
  }
}

async function handleInstanceUpdated() {
  await loadInstance()
  reloadToken.value += 1
}

function artifactName(path) {
  return String(path || '').split('/').pop().split('\\').pop() || '输出文件'
}

async function openArtifact(path) {
  if (!path) return
  await window.cs.openFile(path)
}

function isLocalTmallApprovalBoardUrl(path) {
  const target = String(path || '').trim()
  if (!target) return false
  try {
    const parsed = new URL(target)
    return parsed.pathname.includes('/tmall-ai-image-approval/')
  } catch {
    return target.includes('/tmall-ai-image-approval/')
  }
}

function statusLabel(status) {
  const labels = {
    draft: '草稿',
    running: '运行中',
    waiting_approval: '待审批',
    completed: '已完成',
    stopped: '已停止',
    failed: '失败',
    archived: '已归档',
  }
  return labels[String(status || '').trim()] || status || '-'
}

function statusTone(status) {
  const value = String(status || '').trim()
  if (['failed'].includes(value)) return 'error'
  if (['completed', 'archived'].includes(value)) return 'done'
  if (['waiting_approval'].includes(value)) return 'pending'
  if (['running'].includes(value)) return 'active'
  return 'neutral'
}

watch(() => props.instanceUid, loadInstance)
onMounted(loadInstance)
</script>

<style scoped>
.task-instance-runner {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.tir-head {
  flex: 0 0 auto;
  min-height: 56px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
}
.tir-back {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text2);
  padding: 8px 11px;
  font-size: 12px;
}
.tir-back:hover {
  color: var(--text);
}
.tir-title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tir-title strong {
  color: var(--text);
  font-size: 14px;
}
.tir-title span {
  color: var(--text3);
  font-size: 12px;
}
.tir-status {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 5px 10px;
  color: var(--text2);
  font-size: 12px;
}
.tir-status.active { border-color: rgba(96, 165, 250, .35); color: var(--blue); }
.tir-status.pending { border-color: rgba(251, 191, 36, .35); color: var(--yellow); }
.tir-status.done { border-color: rgba(74, 222, 128, .32); color: var(--green); }
.tir-status.error { border-color: rgba(248, 113, 113, .34); color: var(--red); }
.tir-readback {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg2) 82%, var(--bg) 18%);
  overflow-x: auto;
}
.tir-readback-item {
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  gap: 7px;
  color: var(--text3);
  font-size: 12px;
}
.tir-readback-item strong {
  color: var(--text2);
  font-size: 12px;
}
.tir-link,
.tir-artifacts button {
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text2);
  padding: 6px 9px;
  font-size: 12px;
}
.tir-link {
  border-color: rgba(var(--orange-rgb), .34);
  color: var(--orange-text);
}
.tir-artifacts {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tir-state {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--text3);
  font-size: 13px;
}
.tir-state.error {
  color: var(--red);
}
@media (max-width: 760px) {
  .tir-head {
    grid-template-columns: minmax(0, 1fr);
    align-items: stretch;
  }
  .tir-status {
    justify-self: start;
  }
}
</style>
