<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { apiGet, apiPatch, apiPost, type ApiError } from '../api'

interface UserRow {
  id: number
  email: string
  name: string
  status: string
  created_at?: string
  roles?: RoleRow[]
  roleKeys?: string[]
}

interface RoleRow {
  role_key: string
  name: string
}

const users = ref<UserRow[]>([])
const roles = ref<RoleRow[]>([])
const selectedRoleKeys = ref<Record<number, string>>({})
const showCreate = ref(false)
const loading = ref(false)
const message = ref('')
const error = ref('')
const form = ref({ email: '', name: '', password: '', status: 'active', roleKeys: ['viewer'] })

const activeUsers = computed(() => users.value.filter((user) => user.status === 'active').length)

function loadedRoleKey(user: UserRow): string | null {
  if (Array.isArray(user.roleKeys)) return user.roleKeys[0] ?? null
  if (Array.isArray(user.roles)) return user.roles[0]?.role_key ?? null
  return null
}

function canAssignRole(user: UserRow): boolean {
  return loadedRoleKey(user) !== null && Boolean(selectedRoleKeys.value[user.id])
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [userData, roleData] = await Promise.all([
      apiGet<{ users: UserRow[] }>('/api/admin/users'),
      apiGet<{ roles: RoleRow[] }>('/api/admin/roles'),
    ])
    users.value = userData.users
    roles.value = roleData.roles
    selectedRoleKeys.value = Object.fromEntries(
      users.value.flatMap((user) => {
        const roleKey = loadedRoleKey(user)
        return roleKey ? [[user.id, roleKey] as const] : []
      }),
    )
  } catch (caught) {
    error.value = (caught as ApiError).message
  } finally {
    loading.value = false
  }
}

async function createUser() {
  message.value = ''
  error.value = ''
  try {
    await apiPost('/api/admin/users', form.value)
    showCreate.value = false
    form.value = { email: '', name: '', password: '', status: 'active', roleKeys: ['viewer'] }
    message.value = '账号已创建'
    await load()
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function assignRole(user: UserRow) {
  message.value = ''
  error.value = ''
  if (!canAssignRole(user)) {
    error.value = `${user.email} 当前角色未加载，已阻止覆盖保存`
    return
  }
  try {
    await apiPatch(`/api/admin/users/${user.id}/roles`, { roleKeys: [selectedRoleKeys.value[user.id]] })
    message.value = `${user.email} 角色已更新`
    await load()
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function disableUser(user: UserRow) {
  await apiPatch(`/api/admin/users/${user.id}`, { status: 'disabled' })
  message.value = `${user.email} 已停用`
  await load()
}

onMounted(load)
</script>

<template>
  <section class="view-stack">
    <div class="metric-grid">
      <div class="metric"><span>账号总数</span><strong>{{ users.length }}</strong></div>
      <div class="metric"><span>启用账号</span><strong>{{ activeUsers }}</strong></div>
      <div class="metric"><span>角色模板</span><strong>{{ roles.length }}</strong></div>
      <div class="metric"><span>权限模式</span><strong>RBAC</strong></div>
    </div>

    <p v-if="message" class="notice">{{ message }}</p>
    <p v-if="error" class="notice danger">{{ error }}</p>

    <section class="table-panel">
      <div class="table-header">
        <h2>账号列表</h2>
        <button class="primary-button" type="button" @click="showCreate = true">新建账号</button>
      </div>
      <table class="data-table">
        <thead>
          <tr><th>账号</th><th>状态</th><th>角色分配</th><th>创建时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id">
            <td><strong>{{ user.name }}</strong><br /><span class="muted">{{ user.email }}</span></td>
            <td><span class="badge">{{ user.status }}</span></td>
            <td>
              <div class="inline-fields">
                <select v-model="selectedRoleKeys[user.id]">
                  <option v-for="role in roles" :key="role.role_key" :value="role.role_key">{{ role.name }}</option>
                </select>
                <button class="small-button" type="button" :disabled="!canAssignRole(user)" @click="assignRole(user)">保存角色</button>
                <span v-if="loadedRoleKey(user) === null" class="muted">角色未加载，禁止覆盖保存</span>
              </div>
            </td>
            <td>{{ user.created_at || '-' }}</td>
            <td><button class="danger-button" type="button" @click="disableUser(user)">停用</button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!loading && users.length === 0" class="empty-state">暂无账号</div>
    </section>

    <div v-if="showCreate" class="modal-backdrop" @click.self="showCreate = false">
      <form class="modal-panel view-stack" @submit.prevent="createUser">
        <h2>新建账号</h2>
        <label class="field"><span>邮箱</span><input v-model="form.email" required type="email" /></label>
        <label class="field"><span>姓名</span><input v-model="form.name" required /></label>
        <label class="field"><span>初始密码</span><input v-model="form.password" minlength="8" required type="password" /></label>
        <label class="field">
          <span>角色</span>
          <select v-model="form.roleKeys[0]">
            <option v-for="role in roles" :key="role.role_key" :value="role.role_key">{{ role.name }}</option>
          </select>
        </label>
        <div class="row-actions">
          <button class="primary-button" type="submit">创建</button>
          <button class="ghost-button" type="button" @click="showCreate = false">取消</button>
        </div>
      </form>
    </div>
  </section>
</template>
