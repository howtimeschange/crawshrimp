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

    <div v-if="loading" class="tir-state">加载中...</div>
    <div v-else-if="error" class="tir-state error">{{ error }}</div>
    <TaskRunner
      v-else-if="task"
      :adapter-id="instance.adapter_id"
      :task="task"
      :instance-uid="instanceUid"
      :initial-params="instance.params || {}"
      @status-change="handleStatusChange"
    />
    <div v-else class="tir-state">未找到脚本任务</div>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue'
import TaskRunner from './TaskRunner.vue'

const props = defineProps({
  instanceUid: { type: String, required: true },
})

defineEmits(['back'])

const instance = ref(null)
const task = ref(null)
const loading = ref(false)
const error = ref('')

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
  if (status.status === 'running') instance.value.status = 'running'
  if (status.status === 'done') instance.value.status = instance.value.status === 'waiting_approval' ? 'waiting_approval' : 'completed'
  if (status.status === 'error') instance.value.status = 'failed'
  if (status.status === 'stopped') instance.value.status = 'stopped'
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
.tir-status.active { border-color: rgba(96, 165, 250, .35); color: #93c5fd; }
.tir-status.pending { border-color: rgba(251, 191, 36, .35); color: #fbbf24; }
.tir-status.done { border-color: rgba(74, 222, 128, .32); color: #86efac; }
.tir-status.error { border-color: rgba(248, 113, 113, .34); color: #fca5a5; }
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
