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

type PageKey = 'dashboard' | 'batches' | 'review' | 'prompts' | 'machines' | 'users'

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

const navItems: Array<{ key: PageKey; label: string; permission: string }> = [
  { key: 'dashboard', label: '数据看板', permission: 'dashboard:read' },
  { key: 'batches', label: '审批批次', permission: 'batches:read' },
  { key: 'review', label: '批次审图', permission: 'batches:read' },
  { key: 'prompts', label: 'Prompt', permission: 'prompts:read' },
  { key: 'machines', label: '任务机', permission: 'machines:read' },
  { key: 'users', label: '账号', permission: 'users:write' },
]

const visibleNav = computed(() => {
  // Backend RBAC remains authoritative; these checks only keep the UI compact for the current user.
  const permissions = new Set(me.value?.permissions ?? [])
  return navItems.filter((item) => permissions.has(item.permission))
})

const activeTitle = computed(() => navItems.find((item) => item.key === activePage.value)?.label ?? '数据看板')

async function loadMe() {
  loadingSession.value = true
  appError.value = ''
  try {
    me.value = await apiGet<CurrentUser>('/api/auth/me')
    if (!visibleNav.value.some((item) => item.key === activePage.value)) {
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
  <main v-else class="app-shell">
    <aside class="sidebar">
      <div class="brand-block">
        <div class="brand-mark">CS</div>
        <div>
          <p class="brand-name">Crawshrimp</p>
          <p class="brand-subtitle">Cloud Approval</p>
        </div>
      </div>

      <nav class="side-nav" aria-label="主导航">
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

      <div class="user-box" v-if="me">
        <p>{{ me.user.name }}</p>
        <span>{{ me.roles.map((role) => role.name).join(' / ') || me.user.email }}</span>
        <button class="ghost-button full" type="button" @click="logout">退出登录</button>
      </div>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <div>
          <p class="section-kicker">抓虾云端测图审批台</p>
          <h1>{{ activeTitle }}</h1>
        </div>
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
      <PromptLibraryView v-else-if="activePage === 'prompts'" />
      <MachinesView v-else-if="activePage === 'machines'" />
      <AdminUsersView v-else-if="activePage === 'users'" />
    </section>
  </main>
</template>

<style>
:root {
  color-scheme: dark;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #0d1117;
  color: #e6edf3;
}

* {
  box-sizing: border-box;
}

body {
  min-width: 320px;
  margin: 0;
  background: #0d1117;
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
  display: grid;
  min-height: 100vh;
  grid-template-columns: 224px minmax(0, 1fr);
  background: #0d1117;
  color: #e6edf3;
}

.sidebar {
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  gap: 18px;
  border-right: 1px solid #242b36;
  background: #111721;
  padding: 18px 14px;
}

.brand-block {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 4px 12px;
}

.brand-mark {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid #314158;
  border-radius: 8px;
  background: #162234;
  color: #7dd3fc;
  font-size: 12px;
  font-weight: 800;
}

.brand-name,
.brand-subtitle,
.section-kicker,
.user-box p,
.user-box span {
  margin: 0;
}

.brand-name {
  font-size: 14px;
  font-weight: 800;
}

.brand-subtitle,
.section-kicker,
.user-box span,
.muted {
  color: #8b96a8;
  font-size: 12px;
}

.side-nav {
  display: grid;
  gap: 4px;
}

.nav-button,
.ghost-button,
.primary-button,
.danger-button,
.small-button {
  min-height: 34px;
  border: 1px solid #303846;
  border-radius: 7px;
  padding: 7px 10px;
  background: #151c28;
  color: #d9e2ef;
  font-size: 13px;
  font-weight: 700;
}

.nav-button {
  width: 100%;
  text-align: left;
}

.nav-button.active,
.primary-button {
  border-color: #2563eb;
  background: #1f3a64;
  color: #f8fbff;
}

.ghost-button {
  background: transparent;
}

.danger-button {
  border-color: #7f1d1d;
  background: #3b171b;
  color: #fecaca;
}

.small-button {
  min-height: 28px;
  padding: 5px 8px;
  font-size: 12px;
  text-decoration: none;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.full {
  width: 100%;
}

.user-box {
  display: grid;
  gap: 8px;
  margin-top: auto;
  border-top: 1px solid #242b36;
  padding-top: 14px;
}

.user-box p {
  font-size: 13px;
  font-weight: 800;
}

.workspace {
  min-width: 0;
  padding: 20px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.topbar h1 {
  margin: 2px 0 0;
  font-size: 22px;
  line-height: 1.2;
}

.status-strip,
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

.status-strip {
  border: 1px solid #283241;
  border-radius: 8px;
  padding: 7px 10px;
  background: #111721;
  color: #aeb9c9;
  font-size: 12px;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #22c55e;
}

.panel,
.table-panel,
.form-panel,
.modal-panel {
  border: 1px solid #242b36;
  border-radius: 8px;
  background: #111721;
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
  border: 1px solid #253044;
  border-radius: 8px;
  background: #141d2a;
  padding: 12px;
}

.metric span {
  color: #8b96a8;
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
  border-bottom: 1px solid #242b36;
  padding: 12px 14px;
}

.table-header h2,
.form-panel h2,
.modal-panel h2 {
  margin: 0;
  font-size: 15px;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.data-table th,
.data-table td {
  border-bottom: 1px solid #202734;
  padding: 10px 12px;
  text-align: left;
  vertical-align: top;
}

.data-table th {
  color: #8b96a8;
  font-size: 12px;
  font-weight: 800;
}

.field {
  display: grid;
  gap: 6px;
}

.field label {
  color: #aab4c3;
  font-size: 12px;
  font-weight: 800;
}

.field input,
.field select,
.field textarea {
  width: 100%;
  border: 1px solid #303846;
  border-radius: 7px;
  padding: 8px 10px;
  background: #0d1117;
  color: #e6edf3;
  font-size: 13px;
}

.field textarea {
  min-height: 136px;
  resize: vertical;
}

.notice {
  border: 1px solid #315241;
  border-radius: 8px;
  margin: 0 0 12px;
  padding: 10px 12px;
  background: #11261c;
  color: #b7f7cf;
  font-size: 13px;
}

.notice.danger {
  border-color: #5b2a2a;
  background: #28171a;
  color: #fecaca;
}

.badge {
  display: inline-flex;
  align-items: center;
  border: 1px solid #344155;
  border-radius: 999px;
  padding: 3px 8px;
  background: #151f2c;
  color: #cbd5e1;
  font-size: 12px;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgb(4 7 12 / 72%);
}

.modal-panel {
  width: min(560px, 100%);
}

.empty-state {
  padding: 26px 14px;
  color: #8b96a8;
  text-align: center;
}

.asset-rail {
  display: grid;
  gap: 10px;
}

.asset-row {
  border: 1px solid #253044;
  border-radius: 8px;
  padding: 10px;
  background: #141d2a;
}

.asset-row.selected {
  border-color: #2563eb;
}

.asset-preview,
.asset-thumb {
  display: block;
  width: 100%;
  border: 1px solid #253044;
  border-radius: 7px;
  background: #0d1117;
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

@media (max-width: 860px) {
  .app-shell {
    grid-template-columns: 1fr;
  }

  .sidebar {
    min-height: auto;
  }

  .metric-grid,
  .split-grid {
    grid-template-columns: 1fr;
  }

  .data-table {
    display: block;
    overflow-x: auto;
  }
}
</style>
