<template>
  <div class="view">
    <div v-if="showMachineStatus" class="status-strip">
      <span>任务机需要处理</span>
      <div class="status-pills">
        <span :class="['pill', status?.running ? 'on' : 'off']">{{ status?.running ? '在线' : '离线' }}</span>
        <span :class="['pill', status?.token_present ? 'on' : 'off']">{{ status?.token_present ? '已注册' : '未注册' }}</span>
        <span class="pill neutral">{{ status?.health || 'stopped' }}</span>
      </div>
    </div>

    <section v-if="error" class="empty-state">
      <h3>云端审批暂不可用</h3>
      <p>{{ error }}</p>
    </section>

    <section v-else-if="!cloudUrl" class="empty-state">
      <h3>未配置云端地址</h3>
      <p>请先在设置的「云端审批」中配置云端地址，注册任务机后再进入审批工作台。</p>
    </section>

    <section v-else-if="!embeddedUrl" class="empty-state">
      <h3>云端地址无效</h3>
      <p>请在设置的「云端审批」中填写 http 或 https 开头的有效地址。</p>
    </section>

    <section v-else class="frame-shell">
      <section v-if="frameError" class="empty-state frame-error">
        <h3>云端审批页面加载失败</h3>
        <p>{{ frameError }}</p>
        <button type="button" class="open-button" @click="openCloudWorkbench">在浏览器打开</button>
      </section>
      <template v-else>
        <div v-if="!frameLoaded" class="frame-loading">
          <span class="spinner"></span>
          <span>正在加载云端审批工作台</span>
        </div>
        <iframe
          :src="embeddedUrl"
          title="云端审批"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads allow-modals"
          referrerpolicy="no-referrer"
          @load="onFrameLoad"
          @error="onFrameError"
        />
      </template>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { buildEmbeddedCloudApprovalUrl } from '../utils/cloudApprovalUrl.js'

const status = ref(null)
const error = ref('')
const frameLoaded = ref(false)
const frameError = ref('')
let frameLoadTimer = null
const cloudUrl = computed(() => String(status.value?.base_url || '').trim())
const embeddedUrl = computed(() => buildEmbeddedCloudApprovalUrl(cloudUrl.value))
const showMachineStatus = computed(() => Boolean(status.value && (!status.value.running || !status.value.token_present || ['needs_login', 'config_missing', 'version_blocked'].includes(status.value.health))))

function clearFrameLoadTimer() {
  if (frameLoadTimer) {
    clearTimeout(frameLoadTimer)
    frameLoadTimer = null
  }
}

function resetFrameState(url) {
  clearFrameLoadTimer()
  frameLoaded.value = false
  frameError.value = ''
  if (!url) return
  frameLoadTimer = setTimeout(() => {
    if (!frameLoaded.value) {
      frameError.value = '云端审批工作台加载超时，可能被本机服务、网络策略或浏览器嵌入策略拦截。'
    }
  }, 12000)
}

function onFrameLoad() {
  frameLoaded.value = true
  frameError.value = ''
  clearFrameLoadTimer()
}

function onFrameError() {
  frameLoaded.value = false
  frameError.value = '云端审批工作台无法嵌入当前窗口。'
  clearFrameLoadTimer()
}

async function openCloudWorkbench() {
  const url = embeddedUrl.value || cloudUrl.value
  if (!url || typeof window.cs?.openExternalUrl !== 'function') return
  await window.cs.openExternalUrl(url)
}

async function refresh() {
  try {
    status.value = await window.cs.getCloudApprovalStatus()
    error.value = ''
  } catch (e) {
    error.value = e?.message || '读取云端审批状态失败'
  }
}

watch(embeddedUrl, resetFrameState, { immediate: true })
onMounted(refresh)
onUnmounted(clearFrameLoadTimer)
</script>

<style scoped>
.view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.status-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  color: var(--text2);
  font-size: 12px;
}

.status-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.pill {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 750;
}

.pill.on {
  color: var(--green);
  background: rgba(74, 222, 128, 0.12);
}

.pill.off {
  color: var(--red);
  background: rgba(248, 113, 113, 0.12);
}

.pill.neutral {
  color: var(--text2);
  background: rgba(148, 163, 184, 0.12);
}

.empty-state {
  margin: 24px 28px;
  padding: 22px;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.empty-state h3 {
  margin: 0 0 8px;
  font-size: 17px;
}

.empty-state p {
  margin: 0;
  color: var(--text2);
  line-height: 1.6;
}

.frame-shell {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
}

.frame-loading {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text2);
  background: var(--bg);
  font-size: 13px;
}

.spinner {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.16);
  border-top-color: var(--orange);
  animation: spin 0.8s linear infinite;
}

.frame-error {
  max-width: 560px;
}

.open-button {
  margin-top: 14px;
  min-height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid rgba(var(--orange-rgb), 0.5);
  background: var(--orange-bg);
  color: var(--orange-text);
  font-weight: 700;
}

iframe {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: 0;
  background: white;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
