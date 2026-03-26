<template>
  <div class="layout">
    <div class="titlebar">
      <span class="app-name">CrawShrimp</span>
      <div class="status-dots">
        <span class="dot" :class="status.api ? 'green' : 'red'">API</span>
        <span class="dot" :class="status.chrome ? 'green' : 'red'">CDP</span>
      </div>
    </div>
    <div class="sidebar">
      <nav>
        <button v-for="item in navItems" :key="item.id"
          :class="['nav-btn', { active: currentView === item.id }]"
          @click="currentView = item.id">
          <span class="nav-icon">{{ item.icon }}</span>
          <span class="nav-label">{{ item.label }}</span>
        </button>
      </nav>
      <div class="log-tail" ref="logEl">
        <div v-for="(line, i) in logs.slice(-50)" :key="i" class="log-line">{{ line }}</div>
      </div>
    </div>
    <main class="content">
      <PlatformManager v-if="currentView === 'platforms'" />
      <TaskDashboard   v-else-if="currentView === 'tasks'" />
      <DataExplorer    v-else-if="currentView === 'data'" />
      <SettingsView    v-else-if="currentView === 'settings'" :status="status" @launch-chrome="launchChrome" />
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import PlatformManager from './views/PlatformManager.vue'
import TaskDashboard   from './views/TaskDashboard.vue'
import DataExplorer    from './views/DataExplorer.vue'
import SettingsView    from './views/SettingsView.vue'

const currentView = ref('platforms')
const logs = ref([])
const logEl = ref(null)
const status = ref({ api: false, chrome: false })
const navItems = [
  { id: 'platforms', icon: '🧩', label: 'Platforms' },
  { id: 'tasks',     icon: '⏱', label: 'Tasks' },
  { id: 'data',      icon: '📊', label: 'Data' },
  { id: 'settings',  icon: '⚙', label: 'Settings' },
]
function addLog(line) {
  logs.value.push(line)
  if (logs.value.length > 200) logs.value.splice(0, 50)
  nextTick(() => { if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight })
}
async function launchChrome() {
  const r = await window.cs.launchChrome()
  addLog(r.msg || JSON.stringify(r))
}
onMounted(async () => {
  window.cs.onLog(addLog)
  window.cs.onStatus(({ key, value }) => { status.value[key] = value })
  const s = await window.cs.getStatus()
  status.value.api = s.api
  status.value.chrome = s.chrome
})
onUnmounted(() => { window.cs.offLog(); window.cs.offStatus() })
</script>

<style scoped>
.layout { display: grid; grid-template-columns: 180px 1fr; grid-template-rows: 38px 1fr; height: 100vh; }
.titlebar {
  grid-column: 1 / -1; -webkit-app-region: drag;
  background: #1a1d27; display: flex; align-items: center;
  padding: 0 16px; gap: 12px; border-bottom: 1px solid #2d3148;
}
.app-name { font-weight: 700; font-size: 14px; color: #a78bfa; }
.status-dots { margin-left: auto; display: flex; gap: 8px; -webkit-app-region: no-drag; }
.dot { font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
.dot.green { background: #14532d; color: #4ade80; }
.dot.red   { background: #450a0a; color: #f87171; }
.sidebar { background: #13161f; border-right: 1px solid #2d3148; display: flex; flex-direction: column; padding: 12px 0 0; }
nav { display: flex; flex-direction: column; gap: 2px; padding: 0 8px; }
.nav-btn { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 8px; background: transparent; border: none; color: #94a3b8; cursor: pointer; font-size: 13px; text-align: left; transition: all 0.15s; }
.nav-btn:hover { background: #1e2130; color: #e2e8f0; }
.nav-btn.active { background: #312e81; color: #c4b5fd; }
.nav-icon { font-size: 16px; width: 20px; }
.log-tail { margin-top: auto; flex: 1; overflow-y: auto; padding: 8px; font-size: 10px; font-family: monospace; color: #475569; border-top: 1px solid #1e2130; }
.log-line { white-space: pre-wrap; word-break: break-all; line-height: 1.4; }
.content { overflow: hidden; background: #0f1117; }
</style>
