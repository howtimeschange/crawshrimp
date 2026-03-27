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
          <span :class="['badge', props.status?.chrome ? 'on' : 'off']">
            {{ props.status?.chrome ? '已连接' : '未连接' }}
          </span>
          <button class="btn-orange-sm" :disabled="launching" @click="doLaunchChrome">
            {{ launching ? '启动中…' : props.status?.chrome ? '重新连接' : '启动 Chrome' }}
          </button>
        </div>
        <p v-if="chromeMsg" :class="['hint-msg', chromeMsgOk ? 'ok' : 'err']">{{ chromeMsg }}</p>
        <p class="hint">应用启动时会自动尝试拉起 Chrome，此按钮用于手动重试</p>
      </section>

      <!-- 通知设置 -->
      <section class="section">
        <h3>通知</h3>
        <p class="hint">配置后，适配包脚本里声明的通知（notify）将自动推送到对应渠道。每个渠道独立配置，不填则不启用。</p>

        <!-- 钉钉 -->
        <div class="notify-block">
          <div class="notify-label">
            <span class="dot dd"></span>
            <strong>钉钉机器人</strong>
            <span class="badge on" v-if="cfg['notify.dingtalk_webhook']">已配置</span>
            <span class="badge off" v-else>未配置</span>
          </div>
          <div class="field">
            <label>Webhook URL</label>
            <input v-model="cfg['notify.dingtalk_webhook']"
              placeholder="https://oapi.dingtalk.com/robot/send?access_token=..." class="input" />
          </div>
          <div class="field">
            <label>加签密钥（可选）</label>
            <input v-model="cfg['notify.dingtalk_secret']"
              placeholder="SEC..." class="input" type="password" />
          </div>
          <div class="test-row">
            <button class="btn-ghost-sm" :disabled="testing.dingtalk" @click="testNotify('dingtalk')">
              {{ testing.dingtalk ? '发送中…' : '发送测试消息' }}
            </button>
            <span v-if="testMsg.dingtalk" :class="['test-result', testOk.dingtalk ? 'ok' : 'err']">{{ testMsg.dingtalk }}</span>
          </div>
        </div>

        <!-- 飞书 -->
        <div class="notify-block">
          <div class="notify-label">
            <span class="dot fs"></span>
            <strong>飞书机器人</strong>
            <span class="badge on" v-if="cfg['notify.feishu_webhook']">已配置</span>
            <span class="badge off" v-else>未配置</span>
          </div>
          <div class="field">
            <label>Webhook URL</label>
            <input v-model="cfg['notify.feishu_webhook']"
              placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." class="input" />
          </div>
          <div class="test-row">
            <button class="btn-ghost-sm" :disabled="testing.feishu" @click="testNotify('feishu')">
              {{ testing.feishu ? '发送中…' : '发送测试消息' }}
            </button>
            <span v-if="testMsg.feishu" :class="['test-result', testOk.feishu ? 'ok' : 'err']">{{ testMsg.feishu }}</span>
          </div>
        </div>

        <!-- 自定义 Webhook -->
        <div class="notify-block">
          <div class="notify-label">
            <span class="dot wh"></span>
            <strong>自定义 Webhook</strong>
            <span class="badge on" v-if="cfg['notify.custom_webhook']">已配置</span>
            <span class="badge off" v-else>未配置</span>
          </div>
          <div class="field">
            <label>Webhook URL（POST JSON）</label>
            <input v-model="cfg['notify.custom_webhook']"
              placeholder="https://your-server/hook" class="input" />
          </div>
          <div class="test-row">
            <button class="btn-ghost-sm" :disabled="testing.webhook" @click="testNotify('webhook')">
              {{ testing.webhook ? '发送中…' : '发送测试消息' }}
            </button>
            <span v-if="testMsg.webhook" :class="['test-result', testOk.webhook ? 'ok' : 'err']">{{ testMsg.webhook }}</span>
          </div>
        </div>

        <!-- 通知说明 -->
        <div class="notify-guide">
          <p class="guide-title">如何在脚本中使用通知？</p>
          <p class="guide-body">在 manifest.yaml 的 output 里加一行即可：</p>
          <pre class="guide-code">output:
  - type: excel
    filename: "结果_{date}.xlsx"
  - type: notify
    channel: dingtalk          # dingtalk | feishu | webhook
    condition: "data.length > 0"   # 可选条件</pre>
          <p class="guide-body">脚本里可在 meta 里自定义通知标题和内容：</p>
          <pre class="guide-code">return {
  success: true, data: violations,
  meta: {
    has_more: false,
    notify_title: `破价 ${violations.length} 个`,
    notify_body: violations.map(v => v['SKU ID']).join(', ')
  }
}</pre>
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
        <button class="btn-orange" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存设置' }}
        </button>
        <span v-if="saveMsg" :class="['msg', saveErr ? 'err' : 'ok']">{{ saveMsg }}</span>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'

const props = defineProps(['status'])
const emit  = defineEmits(['launch-chrome'])

const cfg     = ref({})
const saving  = ref(false)
const saveMsg = ref('')
const saveErr = ref(false)

const launching  = ref(false)
const chromeMsg  = ref('')
const chromeMsgOk = ref(true)

const testing = reactive({ dingtalk: false, feishu: false, webhook: false })
const testMsg = reactive({ dingtalk: '', feishu: '', webhook: '' })
const testOk  = reactive({ dingtalk: true, feishu: true, webhook: true })

async function load() {
  cfg.value = await window.cs.getSettings() || {}
}

async function browseDir() {
  const p = await window.cs.browseFile({ directory: true })
  if (p) cfg.value['data_dir'] = p
}

async function save() {
  saving.value = true; saveMsg.value = ''
  try {
    // Vue 响应式 Proxy 无法被 IPC 序列化，需先转成纯对象
    const plain = JSON.parse(JSON.stringify(cfg.value))
    await window.cs.saveSettings(plain)
    saveMsg.value = '已保存'; saveErr.value = false
  } catch (e) {
    saveMsg.value = e.message; saveErr.value = true
  }
  saving.value = false
}

async function doLaunchChrome() {
  launching.value = true; chromeMsg.value = ''
  try {
    const res = await window.cs.launchChrome()
    chromeMsg.value  = res.msg || (res.ok ? '已启动' : '启动失败')
    chromeMsgOk.value = res.ok
    emit('launch-chrome')
  } catch (e) {
    chromeMsg.value = e.message; chromeMsgOk.value = false
  }
  launching.value = false
}

async function testNotify(channel) {
  // 先保存当前配置，确保 webhook 已写入（Proxy → 纯对象）
  await window.cs.saveSettings(JSON.parse(JSON.stringify(cfg.value)))

  testing[channel] = true
  testMsg[channel] = ''
  try {
    const res = await window.cs.testNotify(channel)
    testMsg[channel] = res.ok ? '✅ 发送成功' : ('❌ ' + (res.error || '失败'))
    testOk[channel]  = res.ok
  } catch (e) {
    testMsg[channel] = '❌ ' + e.message; testOk[channel] = false
  }
  testing[channel] = false
}

onMounted(load)
</script>

<style scoped>
.view { height: 100%; display: flex; flex-direction: column; }
.view-header { display: flex; align-items: center; padding: 20px 24px 16px; border-bottom: 1px solid var(--border); }
.view-header h2 { font-size: 18px; font-weight: 700; }
.settings-body { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 20px; max-width: 680px; }
.section { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.section h3 { font-size: 11px; font-weight: 700; color: var(--text3); text-transform: uppercase; letter-spacing: 0.08em; }
.hint { font-size: 12px; color: var(--text3); line-height: 1.5; margin: 0; }
.hint-msg { font-size: 12px; padding: 6px 10px; border-radius: 7px; margin: 0; }
.hint-msg.ok  { background: rgba(74,222,128,0.1); color: #4ade80; }
.hint-msg.err { background: rgba(248,113,113,0.1); color: #f87171; }
.status-row { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--text2); }
.status-row span:first-child { flex: 1; }
.badge { font-size: 11px; padding: 3px 10px; border-radius: 10px; font-weight: 600; }
.badge.on  { background: rgba(74,222,128,0.12); color: #4ade80; }
.badge.off { background: rgba(248,113,113,0.12); color: #f87171; }

/* 通知 */
.notify-block { display: flex; flex-direction: column; gap: 10px; padding: 14px; background: var(--bg3); border: 1px solid var(--border); border-radius: 10px; }
.notify-label { display: flex; align-items: center; gap: 8px; }
.notify-label strong { font-size: 13px; font-weight: 600; flex: 1; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot.dd { background: #1aafe6; }
.dot.fs { background: #00b96b; }
.dot.wh { background: var(--orange); }
.test-row { display: flex; align-items: center; gap: 10px; }
.test-result { font-size: 12px; }
.test-result.ok  { color: #4ade80; }
.test-result.err { color: #f87171; }

/* 通知指南 */
.notify-guide { background: rgba(255,107,43,0.06); border: 1px solid rgba(255,107,43,0.18); border-radius: 9px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
.guide-title { font-size: 12px; font-weight: 700; color: var(--orange); margin: 0; }
.guide-body  { font-size: 12px; color: var(--text3); margin: 0; }
.guide-code  { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 11px; background: var(--bg); border-radius: 6px; padding: 10px 12px; margin: 0; color: var(--text2); white-space: pre; overflow-x: auto; line-height: 1.6; }

/* 字段 */
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; color: var(--text2); }
.input-row { display: flex; gap: 8px; }
.input-row .input { flex: 1; }
.input { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px; color: var(--text); font-size: 13px; outline: none; width: 100%; }
.input:focus { border-color: var(--orange); }

/* 按钮 */
.save-row { display: flex; align-items: center; gap: 12px; }
.msg { font-size: 12px; padding: 5px 10px; border-radius: 6px; }
.msg.ok  { background: rgba(74,222,128,0.1);  color: #4ade80; }
.msg.err { background: rgba(248,113,113,0.1); color: #f87171; }
.btn-orange { padding: 10px 24px; border-radius: 9px; border: none; background: var(--orange); color: white; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-orange:hover:not(:disabled) { opacity: 0.85; }
.btn-orange:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-orange-sm { padding: 6px 14px; border-radius: 8px; border: none; background: var(--orange); color: white; font-size: 12px; font-weight: 600; cursor: pointer; }
.btn-orange-sm:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-ghost { padding: 9px 14px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: var(--text2); font-size: 12px; cursor: pointer; }
.btn-ghost:hover { background: var(--bg3); color: var(--text); }
.btn-ghost-sm { padding: 6px 12px; border-radius: 7px; border: 1px solid var(--border); background: transparent; color: var(--text2); font-size: 12px; cursor: pointer; }
.btn-ghost-sm:hover:not(:disabled) { background: var(--bg2); color: var(--text); }
.btn-ghost-sm:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
