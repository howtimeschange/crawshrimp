<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { apiGet, apiPost, type ApiError } from './api'
import LoginView from './views/LoginView.vue'
import AdminUsersView from './views/AdminUsersView.vue'
import MachinesView from './views/MachinesView.vue'
import PromptLibraryView from './views/PromptLibraryView.vue'
import BatchListView from './views/BatchListView.vue'
import BatchReviewView from './views/BatchReviewView.vue'
import DashboardView from './views/DashboardView.vue'
import MaterialDataDashboardView from './views/MaterialDataDashboardView.vue'

type PageKey =
  | 'dashboard'
  | 'batches'
  | 'review'
  | 'prompts'
  | 'materialData'
  | 'machines'
  | 'users'

interface CurrentUser {
  user: {
    email: string
    name: string
    status: string
  }
  roles: Array<{ role_key: string; name: string }>
  permissions: string[]
}

const me = ref<CurrentUser | null>(null)
const activePage = ref<PageKey>('dashboard')
const selectedBatchUid = ref('')
const loadingSession = ref(true)
const appError = ref('')
const isEmbedded = computed(() => new URLSearchParams(window.location.search).get('embed') === '1')

const navItems: Array<{ key: PageKey; label: string; permission: string }> = [
  { key: 'dashboard', label: '总览', permission: 'dashboard:read' },
  { key: 'batches', label: '审批批次', permission: 'batches:read' },
  { key: 'prompts', label: 'Prompt 库', permission: 'prompts:read' },
  { key: 'materialData', label: '测图数据', permission: 'dashboard:read' },
  { key: 'machines', label: '任务机', permission: 'machines:read' },
  { key: 'users', label: '账号', permission: 'users:write' },
]

const visibleNav = computed(() => {
  // Backend RBAC remains authoritative; these checks only keep the UI compact for the current user.
  const permissions = new Set(me.value?.permissions ?? [])
  return navItems.filter((item) => permissions.has(item.permission))
})

const activeTitle = computed(() => activePage.value === 'review' ? '审图详情' : navItems.find((item) => item.key === activePage.value)?.label ?? '总览')

function applyDirectBatchLink(): boolean {
  const params = new URLSearchParams(window.location.search)
  const directBatchUid = String(params.get('batch_uid') || '').trim()
  if (!directBatchUid) return false
  selectedBatchUid.value = directBatchUid
  activePage.value = 'review'
  return true
}

function applyDirectPageLink(): boolean {
  const params = new URLSearchParams(window.location.search)
  const requestedPage = String(params.get('page') || '').trim()
  if (requestedPage === 'prompts' && visibleNav.value.some((item) => item.key === 'prompts')) {
    activePage.value = 'prompts'
    return true
  }
  return false
}

async function loadMe() {
  loadingSession.value = true
  appError.value = ''
  try {
    me.value = await apiGet<CurrentUser>('/api/auth/me')
    if (!applyDirectBatchLink() && !applyDirectPageLink() && !visibleNav.value.some((item) => item.key === activePage.value)) {
      activePage.value = visibleNav.value[0]?.key ?? 'dashboard'
    }
  } catch (error) {
    const apiError = error as ApiError
    if (apiError.status !== 401) appError.value = apiError.message
    me.value = null
  } finally {
    loadingSession.value = false
  }
}

async function logout() {
  await apiPost('/api/auth/logout')
  me.value = null
  selectedBatchUid.value = ''
  activePage.value = 'dashboard'
}

function openReview(batchUid: string) {
  selectedBatchUid.value = batchUid
  activePage.value = 'review'
}

onMounted(loadMe)
</script>

<template>
  <LoginView v-if="!loadingSession && !me" @authenticated="loadMe" />
  <main v-else class="app-shell" :class="{ embedded: isEmbedded }">
    <header v-if="!isEmbedded" class="app-header">
      <div class="brand-block">
        <span class="brand-mark">CS</span>
        <div>
          <p class="brand-name">Crawshrimp 云端审批台</p>
          <p class="brand-subtitle">AI 测图协同工作台</p>
        </div>
      </div>
      <div class="account-strip" v-if="me">
        <div>
          <p>{{ me.user.name }}</p>
          <span>{{ me.roles.map((role) => role.name).join(' / ') || me.user.email }}</span>
        </div>
        <button class="ghost-button" type="button" @click="logout">退出登录</button>
      </div>
    </header>

    <section class="workspace">
      <div class="workspace-chrome">
        <div class="title-block" v-if="!isEmbedded">
          <p class="section-kicker">抓虾云端测图审批台</p>
          <h1>{{ activeTitle }}</h1>
        </div>
        <nav class="top-tabs" aria-label="主导航">
          <button
            v-for="item in visibleNav"
            :key="item.key"
            class="nav-button"
            :class="{ active: activePage === item.key }"
            type="button"
            @click="activePage = item.key"
          >
            {{ item.label }}
          </button>
        </nav>
      </div>
      <header class="topbar">
        <h1 v-if="isEmbedded">{{ activeTitle }}</h1>
        <div class="status-strip">
          <span class="status-dot"></span>
          <span>{{ loadingSession ? '连接中' : '已连接' }}</span>
        </div>
      </header>

      <p v-if="appError" class="notice danger">{{ appError }}</p>
      <div v-if="loadingSession" class="panel">正在加载会话...</div>
      <DashboardView v-else-if="activePage === 'dashboard'" />
      <BatchListView v-else-if="activePage === 'batches'" @review="openReview" />
      <BatchReviewView v-else-if="activePage === 'review'" :initial-batch-uid="selectedBatchUid" />
      <PromptLibraryView v-else-if="activePage === 'prompts'" :permissions="me.permissions" />
      <MaterialDataDashboardView v-else-if="activePage === 'materialData'" />
      <MachinesView v-else-if="activePage === 'machines'" />
      <AdminUsersView v-else-if="activePage === 'users'" />
    </section>
  </main>
</template>

<style>
:root {
  color-scheme: dark;
  --orange: #ff6b2b;
  --orange-bg: rgba(255, 107, 43, 0.12);
  --bg: #141418;
  --bg2: #1c1c22;
  --bg3: #242430;
  --border: #2e2e3a;
  --text: #e2e0f0;
  --text2: #8b8aa0;
  --text3: #77768c;
  --green: #4ade80;
  --red: #f87171;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--bg);
  color: var(--text);
}

* {
  box-sizing: border-box;
}

body {
  min-width: 320px;
  margin: 0;
  background: var(--bg);
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  cursor: pointer;
}

.app-shell {
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
}

.app-shell.embedded {
  min-height: 100dvh;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  padding: 12px 18px;
}

.brand-block {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-mark {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid rgba(255, 107, 43, 0.5);
  border-radius: 8px;
  background: var(--orange-bg);
  color: var(--orange);
  font-size: 12px;
  font-weight: 800;
}

.brand-name,
.brand-subtitle,
.section-kicker,
.account-strip p,
.account-strip span {
  margin: 0;
}

.brand-name {
  font-size: 14px;
  font-weight: 800;
}

.brand-subtitle,
.section-kicker,
.account-strip span,
.muted {
  color: var(--text2);
  font-size: 12px;
}

.account-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: right;
}

.account-strip p {
  font-size: 13px;
  font-weight: 800;
}

.workspace {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  padding: 14px 18px 18px;
}

.embedded .workspace {
  min-height: 100dvh;
  padding: 8px 10px 10px;
}

.workspace-chrome {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 10px;
}

.embedded .workspace-chrome {
  align-items: stretch;
  margin-bottom: 8px;
}

.title-block h1 {
  margin: 2px 0 0;
  font-size: 22px;
  line-height: 1.2;
}

.top-tabs,
.toolbar,
.row-actions,
.inline-fields,
.asset-actions,
.tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.top-tabs {
  justify-content: flex-end;
}

.nav-button,
.ghost-button,
.primary-button,
.secondary-button,
.danger-button,
.small-button {
  min-height: 32px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 7px 10px;
  background: var(--bg2);
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    color 160ms ease,
    transform 160ms ease;
}

.nav-button {
  white-space: nowrap;
}

.nav-button.active,
.primary-button {
  border-color: var(--orange);
  background: var(--orange-bg);
  color: #fff3ed;
}

.ghost-button {
  background: transparent;
}

.secondary-button {
  background: var(--bg3);
}

.danger-button {
  border-color: rgba(248, 113, 113, 0.45);
  background: rgba(248, 113, 113, 0.12);
  color: #ffd2d2;
}

.small-button {
  min-height: 28px;
  padding: 5px 8px;
  font-size: 12px;
  text-decoration: none;
}

button:hover:not(:disabled),
.small-button:hover {
  border-color: var(--orange);
  color: #fff3ed;
}

button:active:not(:disabled) {
  transform: translateY(1px);
}

button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 2px solid rgba(255, 107, 43, 0.72);
  outline-offset: 2px;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.full {
  width: 100%;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  margin-bottom: 10px;
}

.embedded .topbar {
  justify-content: space-between;
}

.topbar h1 {
  margin: 0;
  font-size: 18px;
  line-height: 1.2;
}

.status-strip {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 9px;
  background: var(--bg2);
  color: var(--text2);
  font-size: 12px;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--green);
}

.panel,
.table-panel,
.form-panel,
.modal-panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
}

.panel,
.form-panel,
.modal-panel {
  padding: 14px;
}

.view-stack {
  display: grid;
  gap: 14px;
}

.split-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
  gap: 14px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(140px, 1fr));
  gap: 10px;
}

.metric {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  padding: 12px;
}

.metric span {
  color: var(--text2);
  font-size: 12px;
}

.metric strong {
  display: block;
  margin-top: 6px;
  font-size: 22px;
}

.table-panel {
  overflow: hidden;
}

.table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--border);
  padding: 12px 14px;
}

.table-header h2,
.form-panel h2,
.modal-panel h2 {
  margin: 0;
  font-size: 16px;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.data-table th,
.data-table td {
  border-bottom: 1px solid var(--border);
  padding: 10px 12px;
  text-align: left;
  vertical-align: top;
}

.data-table th {
  color: var(--text2);
  font-size: 12px;
  font-weight: 800;
}

.field {
  display: grid;
  gap: 6px;
}

.field label {
  color: var(--text2);
  font-size: 12px;
  font-weight: 800;
}

.field input,
.field select,
.field textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
}

.field textarea {
  min-height: 136px;
  resize: vertical;
}

.notice {
  border: 1px solid rgba(74, 222, 128, 0.4);
  border-radius: 8px;
  margin: 0 0 12px;
  padding: 10px 12px;
  background: rgba(74, 222, 128, 0.1);
  color: #b7f7cf;
  font-size: 13px;
}

.notice.danger {
  border-color: rgba(248, 113, 113, 0.45);
  background: rgba(248, 113, 113, 0.12);
  color: #ffd2d2;
}

.badge {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 3px 8px;
  background: var(--bg3);
  color: var(--text);
  font-size: 12px;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgb(10 10 14 / 76%);
}

.modal-panel {
  width: min(560px, 100%);
}

.empty-state {
  padding: 26px 14px;
  color: var(--text2);
  text-align: center;
}

.asset-rail {
  display: grid;
  gap: 10px;
}

.asset-row {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  background: var(--bg3);
}

.asset-row.selected {
  border-color: var(--orange);
}

.asset-preview,
.asset-thumb {
  display: block;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  object-fit: contain;
}

.asset-preview {
  max-height: 260px;
  margin: 10px 0;
}

.asset-thumb {
  max-height: 150px;
  margin-bottom: 8px;
}

.material-dashboard {
  display: grid;
  gap: 14px;
}

.toolbar-row,
.action-strip {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  padding: 12px;
}

.filter-grid {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(4, minmax(140px, 1fr));
  gap: 10px;
}

.filter-grid label {
  display: grid;
  gap: 5px;
  color: var(--text2);
  font-size: 12px;
}

.filter-grid input,
.filter-grid select,
.action-strip input {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg3);
  color: var(--text);
  padding: 8px 10px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(120px, 1fr));
  gap: 10px;
}

.metric-card {
  display: grid;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  padding: 12px;
}

.metric-card span {
  color: var(--text2);
  font-size: 12px;
}

.metric-card strong {
  font-size: 24px;
}

.file-action {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  border: 1px solid rgba(255, 107, 43, 0.5);
  border-radius: 6px;
  background: var(--orange-bg);
  color: var(--orange);
  font-weight: 700;
  padding: 0 12px;
  overflow: hidden;
}

.file-action input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.machine-input {
  flex: 1;
}

.time-input {
  width: 124px;
}

.table-shell {
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.table-shell table {
  width: 100%;
  min-width: 980px;
  border-collapse: collapse;
  background: var(--bg2);
}

.table-shell th,
.table-shell td {
  border-bottom: 1px solid var(--border);
  padding: 9px 10px;
  text-align: left;
  font-size: 13px;
  white-space: nowrap;
}

.table-shell th {
  color: var(--text2);
  font-size: 12px;
  font-weight: 700;
}

.thumb-link {
  display: block;
  width: 44px;
  height: 44px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg3);
}

.thumb-link img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

@media (max-width: 860px) {
  .app-header,
  .workspace-chrome,
  .account-strip {
    align-items: stretch;
    flex-direction: column;
  }

  .account-strip {
    text-align: left;
  }

  .top-tabs {
    justify-content: flex-start;
    overflow-x: auto;
    flex-wrap: nowrap;
    padding-bottom: 2px;
  }

  .metric-grid,
  .split-grid {
    grid-template-columns: 1fr;
  }

  .data-table {
    display: block;
    overflow-x: auto;
  }

  .toolbar-row,
  .action-strip {
    align-items: stretch;
    flex-direction: column;
  }

  .filter-grid,
  .kpi-grid {
    grid-template-columns: 1fr;
  }

  .machine-input,
  .time-input {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 1ms !important;
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
  }
}
</style>
