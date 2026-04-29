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
            {{ launching ? '启动中…' : props.status?.chrome ? '重新连接' : '启动专用 Chrome' }}
          </button>
        </div>
        <p v-if="chromeMsg" :class="['hint-msg', chromeMsgOk ? 'ok' : 'err']">{{ chromeMsg }}</p>
        <p class="hint">应用启动时会自动尝试拉起专用 Chrome 实例，不会关闭你已经打开的浏览器窗口；此按钮用于手动重试</p>
      </section>

      <!-- 自动更新 -->
      <section id="auto-update-section" class="section">
        <h3>自动更新</h3>
        <div class="status-row">
          <span>当前版本</span>
          <span class="badge neutral">v{{ updateStatus.currentVersion || '未知' }}</span>
        </div>
        <div class="status-row">
          <span>{{ updateStatusLabel }}</span>
          <span :class="['badge', updateBadgeClass]">{{ updateBadgeText }}</span>
        </div>
        <div v-if="updateStatus.status === 'downloading'" class="update-progress" aria-label="更新下载进度">
          <div class="update-progress-bar" :style="{ width: updateProgressPercent + '%' }"></div>
        </div>
        <p v-if="updateMessage" :class="['hint-msg', updateMessageOk ? 'ok' : 'err']">{{ updateMessage }}</p>
        <div v-if="updateStatus.releaseNotes" class="release-notes">
          <p class="guide-title">更新日志</p>
          <pre class="guide-code">{{ updateStatus.releaseNotes }}</pre>
        </div>
        <div class="test-row">
          <button class="btn-ghost-sm" :disabled="checkingUpdate" @click="checkUpdate">
            {{ checkingUpdate ? '检查中…' : '检查更新' }}
          </button>
          <button
            v-if="updateStatus.updateAvailable && !updateStatus.downloaded"
            class="btn-orange-sm"
            :disabled="downloadingUpdate"
            @click="downloadUpdate">
            {{ downloadingUpdate ? '下载中…' : '下载更新' }}
          </button>
          <button
            v-if="updateStatus.downloaded"
            class="btn-orange-sm"
            @click="installUpdate">
            {{ updateStatus.installDeferred ? '任务结束后安装' : '重启并安装' }}
          </button>
        </div>
        <p class="hint">后台会静默检查新版本；安装更新前会等待当前任务结束，避免中断正在执行的抓取。</p>
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
import { computed, ref, reactive, onMounted, onUnmounted } from 'vue'

const props = defineProps(['status'])
const emit  = defineEmits(['launch-chrome'])

const cfg     = ref({})
const saving  = ref(false)
const saveMsg = ref('')
const saveErr = ref(false)

const launching  = ref(false)
const chromeMsg  = ref('')
const chromeMsgOk = ref(true)

const updateStatus = ref({
  status: 'idle',
  currentVersion: '',
  latestVersion: '',
  releaseNotes: '',
  error: '',
  progress: null,
  updateAvailable: false,
  downloaded: false,
  installDeferred: false,
})
const checkingUpdate = ref(false)
const downloadingUpdate = ref(false)
const updateMessage = ref('')
const updateMessageOk = ref(true)
let stopUpdateStatusListener = null

const testing = reactive({ dingtalk: false, feishu: false, webhook: false })
const testMsg = reactive({ dingtalk: '', feishu: '', webhook: '' })
const testOk  = reactive({ dingtalk: true, feishu: true, webhook: true })

const updateProgressPercent = computed(() => {
  const percent = Number(updateStatus.value?.progress?.percent || 0)
  return Math.max(0, Math.min(100, Math.round(percent)))
})

const updateStatusLabel = computed(() => {
  const latest = updateStatus.value.latestVersion ? `发现 v${updateStatus.value.latestVersion}` : '更新状态'
  if (updateStatus.value.status === 'available') return latest
  if (updateStatus.value.status === 'downloaded') return `v${updateStatus.value.latestVersion || ''} 已下载`
  if (updateStatus.value.status === 'downloading') return `正在下载 v${updateStatus.value.latestVersion || ''}`
  if (updateStatus.value.status === 'not-available') return '已经是最新版本'
  if (updateStatus.value.status === 'disabled') return '开发模式'
  if (updateStatus.value.status === 'error') return '检查失败'
  if (updateStatus.value.status === 'checking') return '正在检查'
  return '等待检查'
})

const updateBadgeText = computed(() => {
  if (updateStatus.value.status === 'available') return '可更新'
  if (updateStatus.value.status === 'downloaded') return updateStatus.value.installDeferred ? '待安装' : '已下载'
  if (updateStatus.value.status === 'downloading') return `${updateProgressPercent.value}%`
  if (updateStatus.value.status === 'not-available') return '最新'
  if (updateStatus.value.status === 'disabled') return '未启用'
  if (updateStatus.value.status === 'error') return '失败'
  if (updateStatus.value.status === 'checking') return '检查中'
  return '空闲'
})

const updateBadgeClass = computed(() => {
  if (['available', 'downloaded', 'downloading'].includes(updateStatus.value.status)) return 'on'
  if (updateStatus.value.status === 'error') return 'off'
  return 'neutral'
})

async function load() {
  cfg.value = await window.cs.getSettings() || {}
  if (window.cs.getUpdateStatus) {
    updateStatus.value = await window.cs.getUpdateStatus()
  }
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

async function checkUpdate() {
  checkingUpdate.value = true
  updateMessage.value = ''
  try {
    updateStatus.value = await window.cs.checkForUpdates()
    if (updateStatus.value.status === 'not-available') {
      updateMessage.value = '已是最新版本'
      updateMessageOk.value = true
    } else if (updateStatus.value.status === 'disabled') {
      updateMessage.value = updateStatus.value.error || '开发模式不会检查自动更新'
      updateMessageOk.value = true
    }
  } catch (e) {
    updateMessage.value = e.message
    updateMessageOk.value = false
  }
  checkingUpdate.value = false
}

async function downloadUpdate() {
  downloadingUpdate.value = true
  updateMessage.value = ''
  try {
    updateStatus.value = await window.cs.downloadUpdate()
  } catch (e) {
    updateMessage.value = e.message
    updateMessageOk.value = false
  }
  downloadingUpdate.value = false
}

async function installUpdate() {
  try {
    const res = await window.cs.installUpdate()
    if (res.deferred) {
      updateMessage.value = '当前有任务运行，更新会在任务结束后再安装'
      updateMessageOk.value = true
      updateStatus.value = await window.cs.getUpdateStatus()
    }
  } catch (e) {
    updateMessage.value = e.message
    updateMessageOk.value = false
  }
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

onMounted(() => {
  load()
  if (window.cs.onUpdateStatus) {
    stopUpdateStatusListener = window.cs.onUpdateStatus((next) => {
      updateStatus.value = next
      if (next.status === 'error') {
        updateMessage.value = next.error || '更新检查失败'
        updateMessageOk.value = false
      }
    })
  }
})
onUnmounted(() => {
  if (stopUpdateStatusListener) stopUpdateStatusListener()
})
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
.badge.neutral { background: rgba(148,163,184,0.12); color: #cbd5e1; }

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
.release-notes { display: flex; flex-direction: column; gap: 8px; }
.update-progress { height: 8px; border-radius: 999px; overflow: hidden; background: var(--bg); border: 1px solid var(--border); }
.update-progress-bar { height: 100%; background: var(--orange); transition: width 0.2s ease; }

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
