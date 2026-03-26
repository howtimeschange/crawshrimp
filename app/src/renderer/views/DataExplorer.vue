<template>
  <div class="view">
    <header class="view-header">
      <h2>Data</h2>
      <select v-model="selAdapter">
        <option value="">All platforms</option>
        <option v-for="a in adapters" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
    </header>
    <div class="runs-list">
      <div v-if="!filteredRuns.length" class="placeholder">No data yet. Run a task first.</div>
      <div v-for="run in filteredRuns" :key="run.id" class="run-row">
        <div class="run-info">
          <strong>{{ run.adapter_id }} / {{ run.task_id }}</strong>
          <span :class="['status-badge', run.status]">{{ run.status }}</span>
        </div>
        <div class="run-meta">
          <span>{{ run.records_count }} records</span>
          <span>{{ formatTime(run.finished_at) }}</span>
        </div>
        <div class="run-actions">
          <button class="btn btn-sm" :disabled="!hasFile(run, '.xlsx')" @click="doExport(run, 'excel')">Excel</button>
          <button class="btn btn-sm btn-ghost" :disabled="!hasFile(run, '.json')" @click="doExport(run, 'json')">JSON</button>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, computed, onMounted } from 'vue'
const adapters = ref([]); const allRuns = ref([]); const selAdapter = ref('')
const filteredRuns = computed(() =>
  selAdapter.value ? allRuns.value.filter(r => r.adapter_id === selAdapter.value) : allRuns.value
)
async function load() {
  adapters.value = await window.cs.getAdapters()
  const runs = []
  for (const a of adapters.value) {
    for (const t of (a.tasks || [])) {
      const r = await window.cs.getData(a.id, t.id)
      if (r.runs) runs.push(...r.runs.map(x => ({ ...x, adapter_id: a.id, task_id: t.id })))
    }
  }
  allRuns.value = runs.sort((a, b) => b.id - a.id)
}
async function doExport(run, fmt) { await window.cs.exportData(run.adapter_id, run.task_id, fmt) }
function hasFile(run, ext) {
  try {
    const files = typeof run.output_files === 'string' ? JSON.parse(run.output_files) : run.output_files
    return Array.isArray(files) && files.some(f => f.endsWith(ext))
  } catch { return false }
}
function formatTime(iso) { if (!iso) return ''; return new Date(iso).toLocaleString('zh-CN', { hour12: false }).replace(',', '') }
onMounted(load)
</script>
<style scoped>
.view { height: 100%; display: flex; flex-direction: column; }
.view-header { display: flex; align-items: center; padding: 20px 24px 12px; border-bottom: 1px solid #1e2130; gap: 16px; }
.view-header h2 { font-size: 18px; font-weight: 700; color: #e2e8f0; flex: 1; }
select { background: #1a1d27; border: 1px solid #2d3148; border-radius: 8px; padding: 6px 10px; color: #e2e8f0; font-size: 12px; outline: none; }
.runs-list { flex: 1; overflow-y: auto; padding: 8px 0; }
.placeholder { color: #475569; text-align: center; padding: 40px; font-size: 14px; }
.run-row { display: flex; align-items: center; padding: 14px 24px; border-bottom: 1px solid #1e2130; gap: 16px; }
.run-row:hover { background: #1a1d27; }
.run-info { flex: 1; display: flex; align-items: center; gap: 10px; }
.run-info strong { font-size: 13px; color: #e2e8f0; }
.run-meta { display: flex; gap: 16px; font-size: 12px; color: #64748b; }
.run-actions { display: flex; gap: 8px; }
.status-badge { font-size: 11px; padding: 2px 8px; border-radius: 6px; }
.status-badge.done { background: #14532d33; color: #4ade80; }
.status-badge.error { background: #450a0a33; color: #f87171; }
.status-badge.running { background: #1e3a5f33; color: #60a5fa; }
.btn { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 12px; font-weight: 600; background: #4f46e5; color: white; }
.btn:hover { background: #4338ca; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-sm { padding: 5px 12px; }
.btn-ghost { background: transparent; border: 1px solid #2d3148; color: #94a3b8; }
.btn-ghost:hover { background: #1e2130; }
</style>
