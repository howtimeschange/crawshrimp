<template>
  <div class="view">
    <header class="view-header"><h2>设置</h2></header>
    <div class="settings-body">
      <!-- 连接状态 -->
      <section class="section">
        <h3>连接状态</h3>
        <div class="status-row">
          <span>核心服务 (端口 18765)</span>
          <span :class="['badge', props.status?.api ? 'on' : 'off']">{{ props.status?.api ? '运行中' : '未启动' }}</span>
        </div>
        <div class="status-row">
          <span>Chrome CDP (端口 9222)</span>
          <span :class="['badge', props.status?.chrome ? 'on' : 'off']">{{ props.status?.chrome ? '已连接' : '未连接' }}</span>
          <button class="btn-orange-sm" @click="$emit('launch-chrome')">启动 Chrome</button>
        </div>
      </section>

      <!-- 通知设置 -->
      <section class="section">
        <h3>通知</h3>
        <div class="field">
          <label>钉钉 Webhook</label>
          <input v-model="cfg['notify.dingtalk_webhook']" placeholder="https://oapi.dingtalk.com/robot/send?access_token=..." class="input" />
        </div>
        <div class="field">
          <label>飞书 Webhook</label>
          <input v-model="cfg['notify.feishu_webhook']" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." class="input" />
        </div>
        <div class="field">
          <label>自定义 Webhook</label>
          <input v-model="cfg['notify.custom_webhook']" placeholder="https://your-server/webhook" class="input" />
        </div>
      </section>

      <!-- 数据目录 -->
      <section class="section">
        <h3>存储</h3>
        <div class="field">
          <label>数据目录 (CRAWSHRIMP_DATA)</label>
          <div class="input-row">
            <input v-model="cfg['data_dir']" placeholder="默认: ~/.crawshrimp" class="input" />
            <button class="btn-ghost" @click="browseDir">选择</button>
          </div>
        </div>
      </section>

      <div class="save-row">
        <button class="btn-orange" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button>
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
async function browseDir() { const p = await window.cs.browseFile({ directory: true }); if (p) cfg.value['data_dir'] = p }
async function save() {
  saving.value = true; saveMsg.value = ''
  try { await window.cs.saveSettings(cfg.value); saveMsg.value = '已保存'; saveErr.value = false }
  catch (e) { saveMsg.value = e.message; saveErr.value = true }
  saving.value = false
}
onMounted(load)
</script>

<style scoped>
.view { height: 100%; display: flex; flex-direction: column; }
.view-header { display: flex; align-items: center; padding: 20px 24px 16px; border-bottom: 1px solid var(--border); }
.view-header h2 { font-size: 18px; font-weight: 700; }
.settings-body { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 20px; max-width: 640px; }
.section { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.section h3 { font-size: 11px; font-weight: 700; color: var(--text3); text-transform: uppercase; letter-spacing: 0.08em; }
.status-row { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--text2); }
.status-row span:first-child { flex: 1; }
.badge { font-size: 11px; padding: 3px 10px; border-radius: 10px; font-weight: 600; }
.badge.on  { background: rgba(74,222,128,0.12); color: #4ade80; }
.badge.off { background: rgba(248,113,113,0.12); color: #f87171; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; color: var(--text2); }
.input-row { display: flex; gap: 8px; }
.input-row .input { flex: 1; }
.input { background: var(--bg3); border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px; color: var(--text); font-size: 13px; outline: none; width: 100%; }
.input:focus { border-color: var(--orange); }
.save-row { display: flex; align-items: center; gap: 12px; }
.msg { font-size: 12px; padding: 5px 10px; border-radius: 6px; }
.msg.ok  { background: rgba(74,222,128,0.1); color: #4ade80; }
.msg.err { background: rgba(248,113,113,0.1); color: #f87171; }
.btn-orange { padding: 10px 24px; border-radius: 9px; border: none; background: var(--orange); color: white; font-size: 13px; font-weight: 700; }
.btn-orange:hover { background: var(--orange-dim); }
.btn-orange:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-orange-sm { padding: 6px 14px; border-radius: 8px; border: none; background: var(--orange); color: white; font-size: 12px; font-weight: 600; }
.btn-ghost { padding: 9px 14px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: var(--text2); font-size: 12px; }
.btn-ghost:hover { background: var(--bg3); color: var(--text); }
</style>
