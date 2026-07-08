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

    <section v-else class="frame-shell">
      <iframe :src="embeddedUrl" title="云端审批" sandbox="allow-same-origin allow-scripts allow-forms allow-popups" />
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { buildEmbeddedCloudApprovalUrl } from '../utils/cloudApprovalUrl.js'

const status = ref(null)
const error = ref('')
const cloudUrl = computed(() => String(status.value?.base_url || '').trim())
const embeddedUrl = computed(() => buildEmbeddedCloudApprovalUrl(cloudUrl.value))
const showMachineStatus = computed(() => Boolean(status.value && (!status.value.running || !status.value.token_present || ['needs_login', 'config_missing', 'version_blocked'].includes(status.value.health))))

async function refresh() {
  try {
    status.value = await window.cs.getCloudApprovalStatus()
    error.value = ''
  } catch (e) {
    error.value = e?.message || '读取云端审批状态失败'
  }
}

onMounted(refresh)
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
  color: #4ade80;
  background: rgba(74, 222, 128, 0.12);
}

.pill.off {
  color: #f87171;
  background: rgba(248, 113, 113, 0.12);
}

.pill.neutral {
  color: #cbd5e1;
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
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
}

iframe {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: 0;
  background: white;
}
</style>
