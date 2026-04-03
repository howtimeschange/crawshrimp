<template>
  <div class="layout">
    <!-- 标题栏 -->
    <div class="titlebar">
      <span class="logo">🦐 抓虾</span>
      <div class="status-bar">
        <span class="dot" :class="status.api ? 'on' : 'off'">
          <i></i>核心
        </span>
        <span class="dot" :class="status.chrome ? 'on' : 'off'">
          <i></i>Chrome
        </span>
      </div>
    </div>

    <!-- 侧边栏 -->
    <aside class="sidebar">
      <!-- 一级菜单 -->
      <nav v-if="!activeScript">
        <button
          v-for="item in navItems" :key="item.id"
          :class="['nav-btn', { active: currentView === item.id }]"
          @click="currentView = item.id"
        >
          <span class="icon">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <!-- 二级菜单：进入脚本后 -->
      <div v-else class="sub-nav">
        <button class="back-btn" @click="exitScript">
          ← 我的脚本
        </button>
        <div class="script-title">
          <span class="icon">{{ activeScript.icon || '📄' }}</span>
          {{ activeScript.adapter_name }}
        </div>
        <div class="task-list">
          <button
            v-for="t in activeScript.tasks" :key="t.task_id"
            :class="['task-btn', { active: activeTaskId === t.task_id }]"
            @click="activeTaskId = t.task_id"
          >
            {{ t.task_name }}
            <span v-if="t.live?.status === 'running'" class="running-dot"></span>
          </button>
        </div>
      </div>
    </aside>

    <!-- 主内容区 -->
    <main class="content">
      <!-- 我的脚本：脚本列表 -->
      <ScriptList
        v-if="currentView === 'scripts' && !activeScript"
        @open-script="openScript"
        @reload="loadScriptGroups"
      />
      <!-- 脚本任务执行页 -->
      <TaskRunner
        v-else-if="activeScript && activeTaskId"
        :adapter-id="activeScript.adapter_id"
        :task="activeScript.tasks.find(t => t.task_id === activeTaskId)"
        @status-change="onTaskStatusChange"
      />
      <!-- 抓虾市场 -->
      <MarketPage v-else-if="currentView === 'market'" />
      <!-- 数据文件 -->
      <DataFiles v-else-if="currentView === 'files'" />
      <!-- 设置 -->
      <SettingsPage v-else-if="currentView === 'settings'" :status="status" @launch-chrome="launchChrome" />
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import ScriptList  from './views/ScriptList.vue'
import TaskRunner  from './views/TaskRunner.vue'
import MarketPage  from './views/MarketPage.vue'
import DataFiles   from './views/DataFiles.vue'
import SettingsPage from './views/SettingsPage.vue'

const currentView = ref('scripts')
const status = ref({ api: false, chrome: false })
const activeScript = ref(null)   // { adapter_id, adapter_name, tasks[] }
const activeTaskId = ref(null)
const scriptGroups = ref([])

const navItems = [
  { id: 'scripts',  icon: '📄', label: '我的脚本' },
  { id: 'market',   icon: '🏪', label: '抓虾市场' },
  { id: 'files',    icon: '📁', label: '数据文件' },
  { id: 'settings', icon: '⚙️', label: '设置' },
]

async function loadScriptGroups() {
  const tasks = await window.cs.getTasks()
  // Group by adapter
  const map = {}
  for (const t of tasks) {
    if (!map[t.adapter_id]) {
      map[t.adapter_id] = {
        adapter_id: t.adapter_id,
        adapter_name: t.adapter_name,
        enabled: t.enabled,
        tasks: []
      }
    }
    map[t.adapter_id].tasks.push(t)
  }
  scriptGroups.value = Object.values(map)
  return scriptGroups.value
}

function openScript(group) {
  activeScript.value = group
  activeTaskId.value = group.tasks[0]?.task_id || null
  currentView.value = 'scripts'
}

function exitScript() {
  activeScript.value = null
  activeTaskId.value = null
}

function onTaskStatusChange(status) {
  if (activeScript.value && activeTaskId.value) {
    const t = activeScript.value.tasks.find(x => x.task_id === activeTaskId.value)
    if (t) t.live = status
  }
}

async function launchChrome() {
  await window.cs.launchChrome()
}

let pollTimer = null
onMounted(async () => {
  window.cs.onStatus(({ key, value }) => { status.value[key] = value })
  try {
    const s = await window.cs.getStatus()
    status.value.api = s.api
    status.value.chrome = s.chrome
  } catch (error) {
    console.error('Failed to get initial status', error)
  }

  try {
    await loadScriptGroups()
  } catch (error) {
    console.error('Failed to load initial script groups', error)
  }

  pollTimer = setInterval(async () => {
    const s = await window.cs.getStatus()
    status.value.api = s.api
    status.value.chrome = s.chrome
  }, 5000)
})
onUnmounted(() => {
  clearInterval(pollTimer)
  window.cs.offStatus()
})

// Expose to children via provide
import { provide } from 'vue'
provide('scriptGroups', scriptGroups)
provide('loadScriptGroups', loadScriptGroups)
</script>

<style>
:root {
  --orange: #FF6B2B;
  --orange-dim: #cc5522;
  --orange-bg: rgba(255, 107, 43, 0.12);
  --bg: #141418;
  --bg2: #1c1c22;
  --bg3: #242430;
  --border: #2e2e3a;
  --text: #e2e0f0;
  --text2: #8b8aa0;
  --text3: #555468;
  --green: #4ade80;
  --red: #f87171;
  --radius: 10px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--bg); color: var(--text); font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; font-size: 13px; }
#app { width: 100vw; height: 100vh; }
button { cursor: pointer; }
input, select, textarea { font-family: inherit; }
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
</style>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 168px 1fr;
  grid-template-rows: 40px 1fr;
  height: 100vh;
}

/* 标题栏 */
.titlebar {
  grid-column: 1 / -1;
  -webkit-app-region: drag;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  /* macOS 红绿灯按钮区约 78px，右侧留空给全屏等 */
  padding: 0 20px 0 88px;
  gap: 8px;
}
.logo { font-size: 18px; font-weight: 800; color: var(--text); }
.status-bar { margin-left: auto; display: flex; gap: 16px; -webkit-app-region: no-drag; }
.dot { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text3); }
.dot i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--text3); }
.dot.on i { background: var(--green); box-shadow: 0 0 6px var(--green); }
.dot.off i { background: var(--red); }
.dot.on { color: var(--text2); }

/* 侧边栏 */
.sidebar {
  background: var(--bg2);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 10px 0;
  overflow-y: auto;
}
nav { display: flex; flex-direction: column; gap: 2px; padding: 0 8px; }
.nav-btn {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 8px;
  background: transparent; border: none;
  color: var(--text2); font-size: 13px; text-align: left;
  transition: all 0.15s;
}
.nav-btn:hover { background: var(--bg3); color: var(--text); }
.nav-btn.active { background: var(--orange-bg); color: var(--orange); font-weight: 600; }
.icon { font-size: 15px; width: 20px; }

/* 二级菜单 */
.sub-nav { display: flex; flex-direction: column; height: 100%; }
.back-btn {
  margin: 0 8px 8px; padding: 8px 12px; border-radius: 8px;
  background: transparent; border: 1px solid var(--border);
  color: var(--text2); font-size: 12px; text-align: left;
  transition: all 0.15s;
}
.back-btn:hover { background: var(--bg3); color: var(--text); }
.script-title {
  padding: 6px 20px 10px;
  font-size: 11px; font-weight: 700;
  color: var(--text3); text-transform: uppercase; letter-spacing: 0.06em;
  display: flex; align-items: center; gap: 6px;
}
.task-list { display: flex; flex-direction: column; gap: 2px; padding: 0 8px; }
.task-btn {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 12px; border-radius: 8px;
  background: transparent; border: none;
  color: var(--text2); font-size: 13px; text-align: left;
  transition: all 0.15s;
}
.task-btn:hover { background: var(--bg3); color: var(--text); }
.task-btn.active { background: var(--orange-bg); color: var(--orange); font-weight: 600; }
.running-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--orange); animation: pulse 1s infinite;
}
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

/* 主内容 */
.content { overflow: hidden; background: var(--bg); height: 100%; }
</style>
