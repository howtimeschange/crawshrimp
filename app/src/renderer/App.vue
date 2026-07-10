<template>
  <div
    class="layout"
    :class="{
      'layout-ai-image': currentView === 'ai_image',
      'sidebar-collapsed': sidebarCollapsed,
    }"
  >
    <!-- 标题栏 -->
    <div class="titlebar">
      <div class="brand">
        <span class="logo">🦐 抓虾</span>
        <button
          class="collapse-btn"
          type="button"
          :aria-label="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
          :title="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
          @click="toggleSidebar"
        >
          {{ sidebarCollapsed ? '›' : '‹' }}
        </button>
      </div>
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
      <nav v-if="!activeScript || sidebarCollapsed" :class="{ 'collapsed-primary-nav': activeScript && sidebarCollapsed }">
        <button
          v-for="item in filteredNavItems" :key="item.id"
          :class="['nav-btn', { active: currentView === item.id }]"
          :aria-label="item.label"
          :title="item.label"
          @click="selectNav(item)"
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
            :class="['task-btn', { active: activeTaskId === t.task_id, 'task-btn-detailed': hasEnhancedSidebarProgress(t) }]"
            @click="activeTaskId = t.task_id"
          >
            <template v-if="hasEnhancedSidebarProgress(t)">
              <div class="task-btn-main">
                <span class="task-btn-label">{{ t.task_name }}</span>
                <span class="task-btn-status">
                  <span v-if="taskProgressSummary(t)?.percentLabel" class="task-btn-percent">
                    {{ taskProgressSummary(t)?.percentLabel }}
                  </span>
                  <span class="running-dot"></span>
                </span>
              </div>
              <div
                v-if="taskProgressSummary(t)?.overall"
                class="task-btn-progress"
                role="progressbar"
                :aria-label="taskProgressSummary(t)?.overall?.ariaLabel"
                :aria-valuenow="taskProgressSummary(t)?.overall?.percentValue"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <div class="task-btn-progress-fill" :style="{ width: `${taskProgressSummary(t)?.overall?.percentValue || 0}%` }"></div>
              </div>
              <div v-if="taskProgressSummary(t)?.batch" class="task-btn-sub">
                {{ taskProgressSummary(t).batch.main }}
              </div>
            </template>
            <template v-else>
              {{ t.task_name }}
              <span v-if="isTaskLiveActive(t.live?.status)" class="running-dot"></span>
            </template>
          </button>
        </div>
      </div>
      <SidebarUpdateFooter
        :update-status="updateStatus"
        :collapsed="sidebarCollapsed"
        @download="downloadUpdate"
        @install="installUpdate"
        @retry="retryUpdateCheck"
      />
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
      <!-- 任务中心 -->
      <TaskCenter
        v-else-if="currentView === 'task_center' && !activeInstanceUid"
        @open-instance="openTaskInstance"
      />
      <TaskInstanceRunner
        v-else-if="currentView === 'task_center' && activeInstanceUid"
        :instance-uid="activeInstanceUid"
        @back="activeInstanceUid = ''"
      />
      <!-- AI 生图 -->
      <KeepAlive>
        <AiImageWorkbench
          v-if="currentView === 'ai_image'"
          @open-settings="openSettingsPanel('ai-1xm')"
        />
      </KeepAlive>
      <!-- 提示词库 -->
      <LocalPromptLibrary
        v-if="currentView === 'local_prompt_library'"
        @open-cloud-approval="currentView = 'cloud_approval'"
      />
      <!-- 数据文件 -->
      <DataFiles v-if="currentView === 'files'" />
      <!-- 云端审批 -->
      <CloudApprovalFrame v-if="currentView === 'cloud_approval'" />
      <!-- 设置 -->
      <SettingsPage
        v-if="currentView === 'settings'"
        :status="status"
        :focus-panel-id="focusSettingsPanelId"
        :update-status="updateStatus"
        @launch-chrome="launchChrome"
        @check-update="retryUpdateCheck"
      />
    </main>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import ScriptList  from './views/ScriptList.vue'
import TaskRunner  from './views/TaskRunner.vue'
import TaskCenter  from './views/TaskCenter.vue'
import TaskInstanceRunner from './views/TaskInstanceRunner.vue'
import AiImageWorkbench from './views/AiImageWorkbench.vue'
import LocalPromptLibrary from './views/LocalPromptLibrary.vue'
import DataFiles   from './views/DataFiles.vue'
import SettingsPage from './views/SettingsPage.vue'
import CloudApprovalFrame from './views/CloudApprovalFrame.vue'
import SidebarUpdateFooter from './components/SidebarUpdateFooter.vue'
import { buildScriptGroups } from './utils/scriptGroups'
import { buildTaskOverviewProgress, isTaskLiveActive, resolveTaskProgressConfig } from './utils/taskProgress'
import { readSidebarCollapsed, writeSidebarCollapsed } from './utils/sidebarState.js'

const currentView = ref('scripts')
const status = ref({ api: false, apiState: 'starting', chrome: false, apiPort: 18765, cdpPort: 9222 })
const activeScript = ref(null)   // { adapter_id, adapter_name, tasks[] }
const activeTaskId = ref(null)
const activeInstanceUid = ref('')
const scriptGroups = ref([])
const cloudApprovalStatus = ref(null)
const focusSettingsPanelId = ref('')
const sidebarCollapsed = ref(readSidebarCollapsed(window.localStorage))
const updateStatus = ref({
  status: 'idle',
  currentVersion: '',
  latestVersion: '',
  progress: null,
  blockers: [],
  error: '',
  downloaded: false,
})

const navItems = [
  { id: 'scripts',  icon: '📄', label: '我的脚本' },
  { id: 'task_center', icon: '📋', label: '任务中心' },
  { id: 'ai_image', icon: '🎨', label: 'AI 生图' },
  { id: 'local_prompt_library', icon: '💬', label: '提示词库' },
  { id: 'files',    icon: '📁', label: '数据文件' },
  { id: 'cloud_approval', icon: '☁️', label: '云端审批' },
  { id: 'settings', icon: '⚙️', label: '设置' },
]

const cloudApprovalConfigured = computed(() => {
  const cloudStatus = cloudApprovalStatus.value || {}
  return Boolean(cloudStatus.configured || String(cloudStatus.base_url || '').trim())
})

const filteredNavItems = computed(() =>
  navItems.filter(item => item.id !== 'cloud_approval' || cloudApprovalConfigured.value)
)

function selectNav(item) {
  if (activeScript.value || currentView.value !== item.id) {
    activeScript.value = null
    activeTaskId.value = null
  }
  currentView.value = item.id
  activeInstanceUid.value = ''
  if (item.id !== 'settings') focusSettingsPanelId.value = ''
}

function openSettingsPanel(panelId) {
  focusSettingsPanelId.value = panelId
  currentView.value = 'settings'
  activeScript.value = null
  activeTaskId.value = null
  activeInstanceUid.value = ''
}

async function refreshCloudApprovalStatus() {
  if (typeof window.cs.getCloudApprovalStatus !== 'function') {
    cloudApprovalStatus.value = null
    if (currentView.value === 'cloud_approval') currentView.value = 'settings'
    return
  }
  try {
    cloudApprovalStatus.value = await window.cs.getCloudApprovalStatus()
  } catch (error) {
    console.error('Failed to get cloud approval status', error)
    cloudApprovalStatus.value = null
  }
  if (!cloudApprovalConfigured.value && currentView.value === 'cloud_approval') {
    currentView.value = 'settings'
  }
}

async function loadScriptGroups(options = {}) {
  const tasks = await window.cs.getTasks()
  const nextGroups = buildScriptGroups(tasks)
  if (options.preserveOnShrink && scriptGroups.value.length > 0) {
    const beforeTaskCount = scriptGroups.value.reduce((sum, group) => sum + (group.tasks?.length || 0), 0)
    const nextTaskCount = nextGroups.reduce((sum, group) => sum + (group.tasks?.length || 0), 0)
    const adapterShrink = nextGroups.length > 0 && nextGroups.length < Math.ceil(scriptGroups.value.length * 0.75)
    const taskShrink = nextTaskCount > 0 && nextTaskCount < Math.ceil(beforeTaskCount * 0.75)
    if (adapterShrink || taskShrink) {
      return scriptGroups.value
    }
  }
  scriptGroups.value = nextGroups
  if (activeScript.value) {
    const nextActiveScript = nextGroups.find(group => group.adapter_id === activeScript.value.adapter_id)
    if (nextActiveScript) {
      activeScript.value = nextActiveScript
      if (!nextActiveScript.tasks.some(task => task.task_id === activeTaskId.value)) {
        activeTaskId.value = nextActiveScript.tasks[0]?.task_id || null
      }
    }
  }
  return scriptGroups.value
}

function openScript(group) {
  activeScript.value = group
  activeTaskId.value = group.tasks[0]?.task_id || null
  currentView.value = 'scripts'
  activeInstanceUid.value = ''
}

function exitScript() {
  activeScript.value = null
  activeTaskId.value = null
}

function openTaskInstance(instanceUid) {
  activeInstanceUid.value = instanceUid || ''
}

function onTaskStatusChange(status) {
  if (activeScript.value && activeTaskId.value) {
    const t = activeScript.value.tasks.find(x => x.task_id === activeTaskId.value)
    if (t) t.live = status
  }
}

function hasEnhancedSidebarProgress(task) {
  return isTaskLiveActive(task?.live?.status) &&
    resolveTaskProgressConfig(activeScript.value?.adapter_id, task?.task_id).usage.sidebar === 'enhanced'
}

function taskProgressSummary(task) {
  return buildTaskOverviewProgress(activeScript.value?.adapter_id, task?.task_id, task?.live || {})
}

async function launchChrome() {
  await window.cs.launchChrome()
}

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  writeSidebarCollapsed(window.localStorage, sidebarCollapsed.value)
}

async function downloadUpdate() {
  updateStatus.value = await window.cs.downloadUpdate()
}

async function retryUpdateCheck() {
  updateStatus.value = await window.cs.checkForUpdates()
}

async function installUpdate() {
  const result = await window.cs.installUpdate()
  if (result?.status) updateStatus.value = result
}

let pollTimer = null
let updateStatusCleanup = null
onMounted(async () => {
  window.cs.onStatus(({ key, value }) => { status.value[key] = value })
  if (typeof window.cs.onUpdateStatus === 'function') {
    updateStatusCleanup = window.cs.onUpdateStatus(nextStatus => {
      updateStatus.value = { ...updateStatus.value, ...(nextStatus || {}) }
    })
  }
  try {
    if (typeof window.cs.getUpdateStatus === 'function') {
      updateStatus.value = await window.cs.getUpdateStatus()
    }
  } catch (error) {
    console.error('Failed to get update status', error)
  }
  try {
    const s = await window.cs.getStatus()
    status.value.api = s.api
    status.value.apiState = s.apiState || status.value.apiState
    status.value.chrome = s.chrome
    status.value.apiPort = s.apiPort || status.value.apiPort
    status.value.cdpPort = s.cdpPort || status.value.cdpPort
  } catch (error) {
    console.error('Failed to get initial status', error)
  }

  try {
    await loadScriptGroups()
  } catch (error) {
    console.error('Failed to load initial script groups', error)
  }
  await refreshCloudApprovalStatus()

  pollTimer = setInterval(async () => {
    const s = await window.cs.getStatus()
    status.value.api = s.api
    status.value.apiState = s.apiState || status.value.apiState
    status.value.chrome = s.chrome
    status.value.apiPort = s.apiPort || status.value.apiPort
    status.value.cdpPort = s.cdpPort || status.value.cdpPort
    await refreshCloudApprovalStatus()
  }, 5000)
})
onUnmounted(() => {
  clearInterval(pollTimer)
  if (typeof updateStatusCleanup === 'function') updateStatusCleanup()
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
html,
body {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
body { background: var(--bg); color: var(--text); font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; font-size: 13px; }
#app {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
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

.layout.sidebar-collapsed {
  grid-template-columns: 56px 1fr;
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
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  -webkit-app-region: no-drag;
}
.logo { font-size: 18px; font-weight: 800; color: var(--text); white-space: nowrap; }
.collapse-btn {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;
  color: var(--text2);
  font-size: 18px;
  line-height: 1;
  -webkit-app-region: no-drag;
}
.collapse-btn:hover,
.collapse-btn:focus-visible {
  color: var(--text);
  background: var(--bg3);
  outline: none;
}
.sidebar-collapsed .titlebar {
  padding-left: 88px;
}
.sidebar-collapsed .brand {
  width: 56px;
  justify-content: center;
  margin-left: -32px;
}
.sidebar-collapsed .logo {
  display: none;
}
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
  min-height: 0;
  overflow: hidden;
}
nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 8px;
  min-height: 0;
  overflow-y: auto;
}
.nav-btn {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 8px;
  background: transparent; border: none;
  color: var(--text2); font-size: 13px; text-align: left;
  transition: all 0.15s;
}
.sidebar-collapsed nav {
  padding: 0 6px;
}
.sidebar-collapsed .nav-btn {
  justify-content: center;
  padding: 10px 0;
}
.sidebar-collapsed .nav-btn > span:not(.icon) {
  display: none;
}
.sidebar-collapsed .nav-btn .icon {
  width: auto;
  font-size: 17px;
}
.nav-btn:hover { background: var(--bg3); color: var(--text); }
.nav-btn.active { background: var(--orange-bg); color: var(--orange); font-weight: 600; }
.icon { font-size: 15px; width: 20px; }

/* 二级菜单 */
.sub-nav {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
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
.task-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 8px 12px;
  scrollbar-gutter: stable;
}
.task-btn {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 12px; border-radius: 8px;
  background: transparent; border: none;
  color: var(--text2); font-size: 13px; text-align: left;
  transition: all 0.15s;
}
.task-btn:hover { background: var(--bg3); color: var(--text); }
.task-btn.active { background: var(--orange-bg); color: var(--orange); font-weight: 600; }
.task-btn-detailed {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}
.task-btn-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.task-btn-label {
  min-width: 0;
  flex: 1;
}
.task-btn-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.task-btn-percent {
  font-size: 11px;
  color: var(--orange);
  font-variant-numeric: tabular-nums;
}
.running-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--orange); animation: pulse 1s infinite;
}
.task-btn-progress {
  position: relative;
  height: 5px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255, 107, 43, 0.16);
}
.task-btn-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--orange), #ff9a5f);
}
.task-btn-sub {
  font-size: 11px;
  color: var(--text3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

/* 主内容 */
.content { overflow: hidden; background: var(--bg); height: 100%; min-height: 0; }

@media (max-width: 760px) {
  .layout.layout-ai-image {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 40px minmax(0, 1fr) 56px;
  }

  .layout-ai-image .titlebar {
    grid-column: 1;
    grid-row: 1;
    padding-right: 12px;
  }

  .layout-ai-image .content {
    grid-column: 1;
    grid-row: 2;
  }

  .layout-ai-image .sidebar {
    grid-column: 1;
    grid-row: 3;
    flex-direction: row;
    padding: 4px 0 max(4px, env(safe-area-inset-bottom));
    overflow-x: auto;
    border-top: 1px solid var(--border);
    border-right: 0;
  }

  .layout-ai-image nav {
    width: 100%;
    flex-direction: row;
    align-items: stretch;
    gap: 4px;
    padding: 0 6px;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .layout-ai-image .nav-btn {
    min-width: 48px;
    flex: 1 0 48px;
    justify-content: center;
    padding: 8px;
  }

  .layout-ai-image .nav-btn > span:not(.icon) {
    display: none;
  }

  .layout-ai-image .nav-btn .icon {
    width: auto;
    font-size: 18px;
  }

  .layout-ai-image .sidebar-update-footer {
    display: none;
  }
}
</style>
