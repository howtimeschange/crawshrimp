<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { apiGet, apiPost, type ApiError } from '../api'

interface MachineRow {
  machine_id: string
  machine_name: string
  app_version: string
  capabilities_json: string
  auth_status: string
  health: string
  current_job_id: string | null
  last_seen_at: string | null
}

interface EnrollmentTokenRow {
  id: number
  label: string
  status: string
  allowed_capabilities_json: string
  expires_at: string
  used_by_machine_id: string | null
}

interface QueueSummary {
  queued: number
  active: number
  terminal: number
  by_status: Record<string, number>
}

const machines = ref<MachineRow[]>([])
const tokens = ref<EnrollmentTokenRow[]>([])
const queueSummary = ref<QueueSummary>({ queued: 0, active: 0, terminal: 0, by_status: {} })
const tokenForm = ref({
  label: 'Tmall approval worker',
  allowedCapabilities: 'regenerate_ai_image,submit_tmall_material_test',
  expiresInSeconds: 86400,
  requireApproval: true,
})
const oneTimeToken = ref('')
const rotatedToken = ref('')
const message = ref('')
const error = ref('')
const lastLoadedAt = ref('')
let refreshTimer: ReturnType<typeof window.setInterval> | null = null

const onlineCount = computed(() => machines.value.filter((machine) => effectiveHealth(machine).startsWith('online')).length)
const busyCount = computed(() => machines.value.filter((machine) => effectiveHealth(machine) === 'online_busy').length)

async function load() {
  error.value = ''
  try {
    const [machineData, tokenData] = await Promise.all([
      apiGet<{ machines: MachineRow[]; queue_summary?: QueueSummary }>('/api/admin/machines'),
      apiGet<{ enrollment_tokens: EnrollmentTokenRow[] }>('/api/admin/machine-enrollment-tokens'),
    ])
    machines.value = machineData.machines
    queueSummary.value = machineData.queue_summary ?? { queued: 0, active: 0, terminal: 0, by_status: {} }
    tokens.value = tokenData.enrollment_tokens
    lastLoadedAt.value = new Date().toISOString()
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function createToken() {
  error.value = ''
  message.value = ''
  oneTimeToken.value = ''
  try {
    const data = await apiPost<{ token: string }>('/api/admin/machine-enrollment-tokens', {
      label: tokenForm.value.label,
      allowedCapabilities: tokenForm.value.allowedCapabilities.split(',').map((item) => item.trim()).filter(Boolean),
      expiresInSeconds: Number(tokenForm.value.expiresInSeconds),
      requireApproval: tokenForm.value.requireApproval,
    })
    oneTimeToken.value = data.token
    message.value = '注册 token 已生成'
    await load()
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function machineAction(machine: MachineRow, action: 'approve' | 'disable' | 'revoke' | 'rotate-token') {
  error.value = ''
  rotatedToken.value = ''
  try {
    const data = await apiPost<{ machine_token?: string }>(`/api/admin/machines/${encodeURIComponent(machine.machine_id)}/${action}`)
    if (data.machine_token) rotatedToken.value = data.machine_token
    message.value = `${machine.machine_name} 操作已提交`
    await load()
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function revokeToken(token: EnrollmentTokenRow) {
  await fetch(`/api/admin/machine-enrollment-tokens/${token.id}`, { method: 'DELETE', credentials: 'include' })
  message.value = `${token.label} 已撤销`
  await load()
}

function authStatusLabel(status: string): string {
  if (status === 'active') return '已授权'
  if (status === 'pending_approval') return '待审批'
  if (status === 'disabled') return '已停用'
  if (status === 'revoked') return '已吊销'
  return status || '-'
}

function healthLabel(health: string): string {
  if (health === 'online_idle') return '在线空闲'
  if (health === 'online_busy') return '在线执行中'
  if (health === 'stale') return '心跳超时'
  if (health === 'offline') return '离线'
  if (health === 'needs_login') return '需登录'
  if (health === 'config_missing') return '配置缺失'
  if (health === 'version_blocked') return '版本需升级'
  return health || '-'
}

function effectiveHealth(machine: MachineRow): string {
  if (machine.current_job_id && machine.health === 'online_busy') return 'online_busy'
  if (!machine.last_seen_at) return machine.health || 'offline'
  const timestamp = Date.parse(machine.last_seen_at)
  if (!Number.isFinite(timestamp)) return machine.health || 'offline'
  if (Date.now() - timestamp > 90_000 && !machine.current_job_id) return 'stale'
  return machine.health || 'offline'
}

function tokenStatusLabel(status: string): string {
  if (status === 'issued') return '已生成'
  if (status === 'used') return '已绑定'
  if (status === 'revoked') return '已撤销'
  if (status === 'expired') return '已过期'
  return status || '-'
}

function capabilityLabel(capability: string): string {
  if (capability === 'regenerate_ai_image') return '重生图'
  if (capability === 'submit_tmall_material_test') return '上传测图'
  if (capability === 'crawl_tmall_material_test_data' || capability === 'crawl_tmall_material_data') return '数据抓取'
  return capability
}

function parseCapabilities(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed.map(String)
  } catch {
    // Fall through to comma split for older machine payloads.
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function visibleCapabilities(value: string): string[] {
  return parseCapabilities(value).filter((capability) => capability !== 'generate_ai_image')
}

function formatBeijingTime(value: string | null): string {
  if (!value) return '-'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}

function secondsAgo(value: string | null): string {
  if (!value) return '-'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '-'
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  return `${Math.floor(minutes / 60)} 小时前`
}

onMounted(() => {
  void load()
  refreshTimer = window.setInterval(() => {
    void load()
  }, 5000)
})

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
})
</script>

<template>
  <section class="view-stack">
    <div class="metric-grid">
      <div class="metric"><span>任务机</span><strong>{{ machines.length }}</strong></div>
      <div class="metric"><span>在线</span><strong>{{ onlineCount }}</strong></div>
      <div class="metric"><span>执行中</span><strong>{{ busyCount }}</strong></div>
      <div class="metric"><span>队列中</span><strong>{{ queueSummary.queued }}</strong></div>
      <div class="metric"><span>活跃任务</span><strong>{{ queueSummary.active }}</strong></div>
      <div class="metric"><span>待审批</span><strong>{{ machines.filter((m) => m.auth_status === 'pending_approval').length }}</strong></div>
      <div class="metric"><span>注册 token</span><strong>{{ tokens.filter((t) => t.status === 'issued').length }}</strong></div>
    </div>

    <p v-if="message" class="notice">{{ message }}</p>
    <p v-if="error" class="notice danger">{{ error }}</p>

    <section class="form-panel view-stack">
      <h2>创建任务机注册 token</h2>
      <div class="inline-fields">
        <label class="field"><span>标签</span><input v-model="tokenForm.label" /></label>
        <label class="field"><span>能力</span><input v-model="tokenForm.allowedCapabilities" /></label>
        <label class="field"><span>有效秒数</span><input v-model.number="tokenForm.expiresInSeconds" type="number" min="60" /></label>
        <label class="field"><span>需要审批</span><select v-model="tokenForm.requireApproval"><option :value="true">是</option><option :value="false">否</option></select></label>
      </div>
      <div class="row-actions">
        <button class="primary-button" type="button" @click="createToken">生成注册 token</button>
      </div>
      <p v-if="oneTimeToken" class="notice">
        注册 token 只展示一次：<strong>{{ oneTimeToken }}</strong>
      </p>
      <p v-if="rotatedToken" class="notice">
        轮换后的任务机 token 只展示一次：<strong>{{ rotatedToken }}</strong>
      </p>
    </section>

    <section class="table-panel">
      <div class="table-header">
        <h2>任务机列表</h2>
        <div class="row-actions">
          <span class="muted">每 5 秒自动刷新<span v-if="lastLoadedAt"> · {{ secondsAgo(lastLoadedAt) }}</span></span>
          <button class="ghost-button" type="button" @click="load">刷新</button>
        </div>
      </div>
      <table class="data-table">
        <thead>
          <tr><th>任务机</th><th>状态</th><th>能力</th><th>任务</th><th>最近心跳</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="machine in machines" :key="machine.machine_id">
            <td><strong>{{ machine.machine_name }}</strong><br /><span class="muted">{{ machine.machine_id }} · {{ machine.app_version || '-' }}</span></td>
            <td><span class="badge">{{ authStatusLabel(machine.auth_status) }}</span> <span class="badge">{{ healthLabel(effectiveHealth(machine)) }}</span></td>
            <td>
              <div class="capability-list">
                <span v-for="capability in visibleCapabilities(machine.capabilities_json)" :key="capability" class="badge">{{ capabilityLabel(capability) }}</span>
              </div>
            </td>
            <td>{{ machine.current_job_id || '-' }}</td>
            <td>{{ formatBeijingTime(machine.last_seen_at) }}<br /><span class="muted">{{ secondsAgo(machine.last_seen_at) }}</span></td>
            <td>
              <div class="row-actions">
                <button class="small-button" type="button" @click="machineAction(machine, 'approve')">审批通过</button>
                <button class="small-button" type="button" @click="machineAction(machine, 'rotate-token')">轮换 token</button>
                <button class="danger-button" type="button" @click="machineAction(machine, 'disable')">停用</button>
                <button class="danger-button" type="button" @click="machineAction(machine, 'revoke')">吊销</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="table-panel">
      <div class="table-header"><h2>注册 token 记录</h2></div>
      <table class="data-table">
        <thead>
          <tr><th>标签</th><th>状态</th><th>能力</th><th>到期</th><th>绑定任务机</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="token in tokens" :key="token.id">
            <td>{{ token.label }}</td>
            <td><span class="badge">{{ tokenStatusLabel(token.status) }}</span></td>
            <td>
              <div class="capability-list">
                <span v-for="capability in visibleCapabilities(token.allowed_capabilities_json)" :key="capability" class="badge">{{ capabilityLabel(capability) }}</span>
              </div>
            </td>
            <td>{{ formatBeijingTime(token.expires_at) }}</td>
            <td>{{ token.used_by_machine_id || '-' }}</td>
            <td><button class="danger-button" type="button" @click="revokeToken(token)">撤销</button></td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<style scoped>
.capability-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-width: 360px;
}
</style>
