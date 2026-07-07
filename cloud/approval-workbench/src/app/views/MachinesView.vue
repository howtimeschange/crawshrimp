<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

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

const machines = ref<MachineRow[]>([])
const tokens = ref<EnrollmentTokenRow[]>([])
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

const onlineCount = computed(() => machines.value.filter((machine) => machine.health.startsWith('online')).length)

async function load() {
  error.value = ''
  try {
    const [machineData, tokenData] = await Promise.all([
      apiGet<{ machines: MachineRow[] }>('/api/admin/machines'),
      apiGet<{ enrollment_tokens: EnrollmentTokenRow[] }>('/api/admin/machine-enrollment-tokens'),
    ])
    machines.value = machineData.machines
    tokens.value = tokenData.enrollment_tokens
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

onMounted(load)
</script>

<template>
  <section class="view-stack">
    <div class="metric-grid">
      <div class="metric"><span>任务机</span><strong>{{ machines.length }}</strong></div>
      <div class="metric"><span>在线</span><strong>{{ onlineCount }}</strong></div>
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
      <div class="table-header"><h2>任务机列表</h2><button class="ghost-button" type="button" @click="load">刷新</button></div>
      <table class="data-table">
        <thead>
          <tr><th>任务机</th><th>状态</th><th>能力</th><th>任务</th><th>最近心跳</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="machine in machines" :key="machine.machine_id">
            <td><strong>{{ machine.machine_name }}</strong><br /><span class="muted">{{ machine.machine_id }} · {{ machine.app_version || '-' }}</span></td>
            <td><span class="badge">{{ machine.auth_status }}</span> <span class="badge">{{ machine.health }}</span></td>
            <td>{{ machine.capabilities_json }}</td>
            <td>{{ machine.current_job_id || '-' }}</td>
            <td>{{ machine.last_seen_at || '-' }}</td>
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
            <td><span class="badge">{{ token.status }}</span></td>
            <td>{{ token.allowed_capabilities_json }}</td>
            <td>{{ token.expires_at }}</td>
            <td>{{ token.used_by_machine_id || '-' }}</td>
            <td><button class="danger-button" type="button" @click="revokeToken(token)">撤销</button></td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>
