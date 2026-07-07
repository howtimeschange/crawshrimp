<script setup lang="ts">
import { ref } from 'vue'

import { apiPost, type ApiError } from '../api'

const emit = defineEmits<{ authenticated: [] }>()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function submitLogin() {
  loading.value = true
  error.value = ''
  try {
    await apiPost('/api/auth/login', { email: email.value, password: password.value })
    emit('authenticated')
  } catch (caught) {
    error.value = (caught as ApiError).message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login-screen">
    <form class="login-panel" @submit.prevent="submitLogin">
      <div>
        <p class="section-kicker">Crawshrimp Cloud Approval</p>
        <h1>登录</h1>
      </div>
      <p v-if="error" class="notice danger">{{ error }}</p>
      <label class="field">
        <span>邮箱</span>
        <input v-model="email" autocomplete="email" name="email" required type="email" />
      </label>
      <label class="field">
        <span>密码</span>
        <input v-model="password" autocomplete="current-password" name="password" required type="password" />
      </label>
      <button class="primary-button full" :disabled="loading" type="submit">
        {{ loading ? '登录中...' : '登录' }}
      </button>
    </form>
  </main>
</template>

<style scoped>
.login-screen {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 20px;
  background: #0d1117;
}

.login-panel {
  display: grid;
  width: min(380px, 100%);
  gap: 14px;
  border: 1px solid #242b36;
  border-radius: 8px;
  background: #111721;
  padding: 22px;
}

h1 {
  margin: 4px 0 0;
  font-size: 24px;
  line-height: 1.2;
}
</style>
