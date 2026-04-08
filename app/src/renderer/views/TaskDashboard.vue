<template>
  <div class="view">
    <header class="view-header">
      <h2>Tasks</h2>
      <button class="btn btn-sm" @click="loadTasks">Refresh</button>
    </header>
    <div class="tasks-list">
      <div v-if="loading" class="placeholder">Loading...</div>
      <div v-else-if="!tasks.length" class="placeholder">No tasks. Enable a platform adapter first.</div>
      <div v-for="t in tasks" :key="t.adapter_id + t.task_id" class="task-row">
        <div class="task-info">
          <div class="task-names">
            <strong>{{ t.task_name }}</strong>
            <span class="adapter-badge">{{ t.adapter_name }}</span>
          </div>
          <div class="task-meta">
            <span class="trigger-badge">{{ t.trigger?.type }}</span>
            <span v-if="t.last_run" :class="['status-badge', t.last_run.status]">
              {{ t.last_run.status }} · {{ formatTime(t.last_run.finished_at) }}
            </span>
            <span v-if="t.next_run" class="next-run">next {{ formatTime(t.next_run) }}</span>
          </div>
        </div>
        <div class="task-actions">
          <button class="btn btn-sm btn-run" :disabled="isActiveStatus(t.live?.status)" @click="runTask(t)">
            {{ isActiveStatus(t.live?.status) ? 'Running...' : 'Run' }}
          </button>
          <button class="btn btn-sm btn-ghost" @click="openLogs(t)">Logs</button>
        </div>
      </div>
    </div>
    <div v-if="logsTask" class="log-drawer">
      <div class="drawer-header">
        <strong>{{ logsTask.task_name }}</strong>
        <button class="btn btn-sm btn-ghost" @click="logsTask = null">Close</button>
      </div>
      <div class="log-body" ref="logsEl">
        <div v-for="(l, i) in taskLogs" :key="i" class="log-line">{{ l }}</div>
        <div v-if="!taskLogs.length" class="placeholder">No logs yet.</div>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
const tasks = ref([]); const loading = ref(true)
const logsTask = ref(null); const taskLogs = ref([]); const logsEl = ref(null)
let pollTimer = null; let logsTimer = null
async function loadTasks() { loading.value = true; tasks.value = await window.cs.getTasks(); loading.value = false }
async function runTask(t) { await window.cs.runTask(t.adapter_id, t.task_id); await loadTasks() }
function isActiveStatus(status) { return ['running', 'pausing', 'paused', 'stopping'].includes(status) }
async function openLogs(t) {
  logsTask.value = t; taskLogs.value = []; await pollLogs()
  clearInterval(logsTimer); logsTimer = setInterval(pollLogs, 1500)
}
async function pollLogs() {
  if (!logsTask.value) return
  const r = await window.cs.getTaskLogs(logsTask.value.adapter_id, logsTask.value.task_id)
  taskLogs.value = r.logs || []
  nextTick(() => { if (logsEl.value) logsEl.value.scrollTop = logsEl.value.scrollHeight })
}
function formatTime(iso) { if (!iso) return ''; return new Date(iso).toLocaleString('zh-CN', { hour12: false }).replace(',', '') }
onMounted(() => { loadTasks(); pollTimer = setInterval(loadTasks, 5000) })
onUnmounted(() => { clearInterval(pollTimer); clearInterval(logsTimer) })
</script>
<style scoped>
.view { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.view-header { display: flex; align-items: center; gap: 12px; padding: 20px 24px 12px; border-bottom: 1px solid #1e2130; }
.view-header h2 { font-size: 18px; font-weight: 700; color: #e2e8f0; flex: 1; }
.tasks-list { flex: 1; overflow-y: auto; padding: 8px 0; }
.placeholder { color: #475569; text-align: center; padding: 40px; font-size: 14px; }
.task-row { display: flex; align-items: center; padding: 14px 24px; border-bottom: 1px solid #1e2130; gap: 12px; transition: background 0.1s; }
.task-row:hover { background: #1a1d27; }
.task-info { flex: 1; display: flex; flex-direction: column; gap: 6px; }
.task-names { display: flex; align-items: center; gap: 8px; }
.task-names strong { font-size: 14px; color: #e2e8f0; }
.adapter-badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: #1e1b4b; color: #a5b4fc; }
.task-meta { display: flex; align-items: center; gap: 10px; }
.trigger-badge { font-size: 11px; padding: 2px 8px; border-radius: 6px; background: #0f172a; color: #64748b; border: 1px solid #1e2130; }
.status-badge { font-size: 11px; padding: 2px 8px; border-radius: 6px; }
.status-badge.done { background: #14532d33; color: #4ade80; }
.status-badge.error { background: #450a0a33; color: #f87171; }
.status-badge.running { background: #1e3a5f33; color: #60a5fa; }
.status-badge.pausing,
.status-badge.paused { background: #3f2d1233; color: #fbbf24; }
.status-badge.stopping,
.status-badge.stopped { background: #3f1d1d33; color: #fca5a5; }
.next-run { font-size: 11px; color: #475569; }
.task-actions { display: flex; gap: 8px; }
.log-drawer { border-top: 1px solid #2d3148; height: 220px; display: flex; flex-direction: column; }
.drawer-header { display: flex; align-items: center; padding: 8px 16px; background: #1a1d27; gap: 12px; }
.drawer-header strong { flex: 1; font-size: 13px; color: #a5b4fc; }
.log-body { flex: 1; overflow-y: auto; padding: 8px 16px; font-family: monospace; font-size: 11px; color: #64748b; }
.log-line { line-height: 1.6; white-space: pre-wrap; word-break: break-all; }
.btn { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; background: #4f46e5; color: white; transition: background 0.15s; }
.btn:hover { background: #4338ca; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-sm { padding: 5px 12px; font-size: 12px; }
.btn-run { background: #065f46; color: #6ee7b7; }
.btn-run:hover { background: #064e3b; }
.btn-ghost { background: transparent; border: 1px solid #2d3148; color: #94a3b8; }
.btn-ghost:hover { background: #1e2130; }
</style>
