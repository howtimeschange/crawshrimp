<template>
  <div class="view">
    <header class="view-header">
      <h2>数据文件</h2>
      <button class="btn-ghost" @click="load">刷新</button>
    </header>
    <div class="file-browser">
      <div v-if="!groups.length" class="placeholder">还没有输出文件。执行一个抓取任务后文件会出现在这里。</div>
      <div v-for="g in groups" :key="g.key" class="group">
        <div class="group-header">
          <span class="group-name">{{ g.adapter }} / {{ g.task }}</span>
          <span class="group-count">{{ g.files.length }} 个文件</span>
        </div>
        <div class="file-rows">
          <div v-for="f in g.files" :key="f.path" class="file-row" @click="openFile(f.path)">
            <span class="f-icon">{{ f.path.endsWith('.xlsx') ? '📊' : '📄' }}</span>
            <div class="f-info">
              <span class="f-name">{{ f.name }}</span>
              <span class="f-size">{{ f.size }}</span>
            </div>
            <button class="f-open">打开 →</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
const groups = ref([])

async function load() {
  const adapters = await window.cs.getAdapters()
  const result = []
  for (const a of adapters) {
    const tasks = await window.cs.getTasks()
    for (const t of tasks.filter(x => x.adapter_id === a.id)) {
      const data = await window.cs.getData(a.id, t.task_id)
      const files = []
      for (const run of (data.runs || [])) {
        let paths = []
        try { paths = typeof run.output_files === 'string' ? JSON.parse(run.output_files) : (run.output_files || []) } catch {}
        for (const p of paths) {
          files.push({ path: p, name: p.split('/').pop(), size: '' })
        }
      }
      if (files.length) result.push({ key: a.id + t.task_id, adapter: a.name, task: t.task_name, files })
    }
  }
  groups.value = result
}

function openFile(path) { window.cs.openFile(path) }
onMounted(load)
</script>

<style scoped>
.view { height: 100%; display: flex; flex-direction: column; }
.view-header { display: flex; align-items: center; padding: 20px 24px 16px; border-bottom: 1px solid var(--border); gap: 12px; }
.view-header h2 { font-size: 18px; font-weight: 700; flex: 1; }
.placeholder { color: var(--text3); text-align: center; padding: 60px; font-size: 14px; }
.file-browser { flex: 1; overflow-y: auto; padding: 16px 24px; display: flex; flex-direction: column; gap: 20px; }
.group { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.group-header { display: flex; align-items: center; padding: 12px 16px; background: var(--bg3); border-bottom: 1px solid var(--border); gap: 8px; }
.group-name { font-size: 13px; font-weight: 600; color: var(--text); flex: 1; }
.group-count { font-size: 11px; color: var(--text3); }
.file-rows { display: flex; flex-direction: column; }
.file-row { display: flex; align-items: center; gap: 10px; padding: 11px 16px; border-bottom: 1px solid var(--border); cursor: pointer; transition: background 0.1s; }
.file-row:last-child { border-bottom: none; }
.file-row:hover { background: var(--bg3); }
.f-icon { font-size: 18px; }
.f-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.f-name { font-size: 13px; color: var(--text); }
.f-size { font-size: 11px; color: var(--text3); }
.f-open { font-size: 12px; color: var(--orange); background: transparent; border: none; padding: 4px 10px; border-radius: 6px; }
.f-open:hover { background: var(--orange-bg); }
.btn-ghost { padding: 7px 14px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: var(--text2); font-size: 12px; }
.btn-ghost:hover { background: var(--bg3); color: var(--text); }
</style>
