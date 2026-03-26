<template>
  <div class="view">
    <header class="view-header">
      <h2>Settings</h2>
    </header>
    <div class="settings-body">
      <!-- Status -->
      <section class="section">
        <h3>Connection Status</h3>
        <div class="status-row">
          <span>FastAPI Core (port {{ cfg.port || 18765 }})</span>
          <span :class="['badge', props.status?.api ? 'green' : 'red']">{{ props.status?.api ? 'Connected' : 'Not running' }}</span>
        </div>
        <div class="status-row">
          <span>Chrome CDP (port {{ cfg.cdp_port || 9222 }})</span>
          <span :class="['badge', props.status?.chrome ? 'green' : 'red']">{{ props.status?.chrome ? 'Connected' : 'Not connected' }}</span>
          <button class="btn btn-sm" @click="$emit('launch-chrome')">Launch Chrome</button>
        </div>
      </section>

      <!-- Notifications -->
      <section class="section">
        <h3>Notifications</h3>
        <div class="field">
          <label>DingTalk Webhook</label>
          <input v-model="cfg['notify.dingtalk_webhook']" placeholder="https://oapi.dingtalk.com/robot/send?access_token=..." />
        </div>
        <div class="field">
          <label>Feishu Webhook</label>
          <input v-model="cfg['notify.feishu_webhook']" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />
        </div>
        <div class="field">
          <label>Custom Webhook</label>
          <input v-model="cfg['notify.custom_webhook']" placeholder="https://your-server/webhook" />
        </div>
      </section>

      <!-- Data directory -->
      <section class="section">
        <h3>Storage</h3>
        <div class="field">
          <label>Data directory (CRAWSHRIMP_DATA)</label>
          <div class="input-row">
            <input v-model="cfg['data_dir']" placeholder="~/.crawshrimp" />
            <button class="btn btn-sm" @click="browseDataDir">Browse</button>
          </div>
        </div>
      </section>

      <div class="save-row">
        <button class="btn" @click="save" :disabled="saving">{{ saving ? 'Saving...' : 'Save Settings' }}</button>
        <span v-if="saveMsg" :class="['msg', saveErr ? 'err' : 'ok']">{{ saveMsg }}</span>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, onMounted } from 'vue'
const props = defineProps(['status'])
const emit = defineEmits(['launch-chrome'])
const cfg = ref({}); const saving = ref(false); const saveMsg = ref(''); const saveErr = ref(false)
async function load() { cfg.value = await window.cs.getSettings() || {} }
async function browseDataDir() { const p = await window.cs.browseFile({ directory: true, title: 'Select data directory' }); if (p) cfg.value['data_dir'] = p }
async function save() {
  saving.value = true; saveMsg.value = ''
  try {
    await window.cs.saveSettings(cfg.value)
    saveMsg.value = 'Saved'; saveErr.value = false
  } catch (e) { saveMsg.value = e.message; saveErr.value = true }
  saving.value = false
}
onMounted(load)
</script>
<style scoped>
.view { height: 100%; display: flex; flex-direction: column; }
.view-header { display: flex; align-items: center; padding: 20px 24px 12px; border-bottom: 1px solid #1e2130; }
.view-header h2 { font-size: 18px; font-weight: 700; color: #e2e8f0; }
.settings-body { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 24px; }
.section { background: #1a1d27; border: 1px solid #2d3148; border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.section h3 { font-size: 13px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
.status-row { display: flex; align-items: center; gap: 12px; font-size: 13px; color: #cbd5e1; }
.status-row span:first-child { flex: 1; }
.badge { font-size: 11px; padding: 2px 10px; border-radius: 10px; font-weight: 600; }
.badge.green { background: #14532d; color: #4ade80; }
.badge.red { background: #450a0a; color: #f87171; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; color: #94a3b8; }
.input-row { display: flex; gap: 8px; }
.input-row input { flex: 1; }
input { background: #0f1117; border: 1px solid #2d3148; border-radius: 8px; padding: 8px 12px; color: #e2e8f0; font-size: 13px; outline: none; width: 100%; }
input:focus { border-color: #4f46e5; }
.save-row { display: flex; align-items: center; gap: 12px; }
.msg { font-size: 12px; border-radius: 6px; padding: 6px 10px; }
.msg.ok { background: #14532d33; color: #4ade80; }
.msg.err { background: #450a0a33; color: #f87171; }
.btn { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; background: #4f46e5; color: white; transition: background 0.15s; }
.btn:hover { background: #4338ca; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-sm { padding: 5px 12px; font-size: 12px; }
</style>
