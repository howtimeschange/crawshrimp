<template>
  <div class="view">
    <header class="view-header">
      <div>
        <h2>设置</h2>
        <p>按配置域分开管理，每个子菜单独立保存。</p>
      </div>
    </header>

    <div class="settings-workspace">
      <aside class="settings-menu" aria-label="设置配置域">
        <div v-for="group in menuGroups" :key="group.id" class="menu-cluster">
          <button
            type="button"
            :class="['menu-group', { active: activeGroupId === group.id }]"
            @click="selectGroup(group.id)"
          >
            <span class="menu-icon">{{ group.icon }}</span>
            <span class="menu-copy">
              <strong>{{ group.label }}</strong>
              <small>{{ group.desc }}</small>
            </span>
          </button>
          <Transition name="settings-children">
            <div v-if="activeGroupId === group.id" class="menu-children">
              <button
                v-for="child in group.children"
                :key="child.id"
                type="button"
                :class="['menu-child', { active: activePanelId === child.id }]"
                @click="selectPanel(group.id, child.id)"
              >
                <span>{{ child.label }}</span>
                <span
                  v-if="child.statusKey || child.statusKeys?.length"
                  :class="['mini-state', isMenuChildConfigured(child) ? 'on' : 'off']"
                >
                  {{ isMenuChildConfigured(child) ? '已配' : '未配' }}
                </span>
              </button>
            </div>
          </Transition>
        </div>
      </aside>

      <main class="settings-content">
        <Transition name="settings-panel" mode="out-in">
        <section v-if="activePanelId === 'connection-overview'" key="connection-overview" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">连接</p>
              <h3>服务状态</h3>
            </div>
            <span :class="['badge', props.status?.api && props.status?.chrome ? 'on' : 'neutral']">
              {{ props.status?.api && props.status?.chrome ? '可运行' : '待检查' }}
            </span>
          </div>

          <div class="status-grid">
            <article class="status-card">
              <div>
                <span>核心服务 (端口 {{ props.status?.apiPort || 18765 }})</span>
                <strong>本地 API · {{ props.status?.apiState || 'unknown' }}</strong>
              </div>
              <span :class="['badge', props.status?.api ? 'on' : 'off']">
                {{ props.status?.api ? '运行中' : '未启动' }}
              </span>
            </article>
            <article class="status-card">
              <div>
                <span>Chrome CDP (端口 {{ props.status?.cdpPort || 9222 }})</span>
                <strong>浏览器连接</strong>
              </div>
              <span :class="['badge', props.status?.chrome ? 'on' : 'off']">
                {{ props.status?.chrome ? '已连接' : '未连接' }}
              </span>
            </article>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <p v-if="backendMsg" :class="['inline-msg', backendMsgOk ? 'ok' : 'err']">{{ backendMsg }}</p>
              <p v-if="chromeMsg" :class="['inline-msg', chromeMsgOk ? 'ok' : 'err']">{{ chromeMsg }}</p>
              <p v-if="props.status?.apiDiagnostic?.lastError" class="inline-msg err">
                核心服务：{{ props.status.apiDiagnostic.lastError }}
              </p>
              <p v-if="!props.status?.chrome && props.status?.chromeDiagnostic?.message" class="inline-msg err">
                Chrome：{{ props.status.chromeDiagnostic.message }}
              </p>
              <p v-if="props.status?.dataDirRecovery?.recovered" class="inline-msg ok">
                数据目录已自动恢复到：{{ props.status.dataDirRecovery.to }}
              </p>
              <div class="action-strip">
                <button class="btn-orange" :disabled="backendRepairing" @click="doRepairBackend">
                  {{ backendRepairing ? '修复中...' : '修复核心服务' }}
                </button>
                <button class="btn-orange" :disabled="launching" @click="doLaunchChrome">
                  {{ launching ? '修复中...' : '修复 Chrome 连接' }}
                </button>
                <button class="btn-ghost" @click="openDiagnosticLog">打开诊断日志</button>
              </div>
            </div>
            <div class="side-note">
              <strong>连接策略</strong>
              <p>核心服务会重新检查数据目录和端口。Chrome 修复只会关闭身份确认属于抓虾的专用实例，不会结束未知进程。</p>
              <p v-if="props.status?.dataDir">当前数据目录：{{ props.status.dataDir }}</p>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'notify-dingtalk'" key="notify-dingtalk" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">通知</p>
              <h3>钉钉机器人</h3>
            </div>
            <span :class="['badge', isFieldConfigured('notify.dingtalk_webhook') ? 'on' : 'off']">
              {{ isFieldConfigured('notify.dingtalk_webhook') ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label>Webhook URL</label>
                <input
                  v-model="cfg['notify.dingtalk_webhook']"
                  placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."
                  class="input"
                />
              </div>
              <div class="field">
                <label>加签密钥（可选）</label>
                <input
                  v-model="cfg['notify.dingtalk_secret']"
                  placeholder="SEC..."
                  class="input"
                  type="password"
                  autocomplete="off"
                />
              </div>
              <PanelActions panel-id="notify-dingtalk" @save="savePanel('notify-dingtalk')" />
            </div>
            <div class="side-note">
              <strong>保存范围</strong>
              <p>只更新钉钉 Webhook 和加签密钥，不影响飞书、自定义 Webhook 或其他设置域。</p>
              <button class="btn-ghost" :disabled="testing.dingtalk" @click="testNotify('dingtalk')">
                {{ testing.dingtalk ? '发送中...' : '发送测试消息' }}
              </button>
              <span v-if="testMsg.dingtalk" :class="['test-result', testOk.dingtalk ? 'ok' : 'err']">
                {{ testMsg.dingtalk }}
              </span>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'application-update'" key="application-update" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">应用</p>
              <h3>桌面更新</h3>
            </div>
            <span :class="['badge', updateBadgeTone]">
              {{ updateBadgeLabel }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="readonly-grid">
                <div class="readonly-row">
                  <span>当前版本</span>
                  <strong>{{ updateStatus.currentVersion ? `v${updateStatus.currentVersion}` : '未知' }}</strong>
                </div>
                <div class="readonly-row">
                  <span>最新版本</span>
                  <strong>{{ updateStatus.latestVersion ? `v${updateStatus.latestVersion}` : '暂无' }}</strong>
                </div>
                <div class="readonly-row">
                  <span>上次检查</span>
                  <strong>{{ formattedLastCheckedAt }}</strong>
                </div>
              </div>
              <p v-if="updateStatus.error" class="inline-msg err">{{ updateStatus.error }}</p>
              <div class="action-strip">
                <button
                  class="btn-orange"
                  :disabled="updateActionBusy || updateStatus.status === 'checking'"
                  @click="requestUpdateCheck"
                >
                  {{ updateStatus.status === 'error' ? '重新检查' : '检查更新' }}
                </button>
                <button
                  v-if="showManualDownload"
                  class="btn-ghost"
                  :disabled="updateActionBusy"
                  @click="openManualDownload"
                >
                  手动下载安装包
                </button>
              </div>
            </div>
            <div class="side-note">
              <strong>更新控制</strong>
              <p>这里仅显示桌面更新状态并触发检查；下载和安装控制保留在侧边栏底部。</p>
              <p v-if="updateStatus.status === 'disabled'">当前环境不支持自动桌面更新时，可使用官方 Release 页面手动下载。</p>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'notify-feishu'" key="notify-feishu" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">通知</p>
              <h3>飞书机器人</h3>
            </div>
            <span :class="['badge', isFieldConfigured('notify.feishu_webhook') ? 'on' : 'off']">
              {{ isFieldConfigured('notify.feishu_webhook') ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label>Webhook URL</label>
                <input
                  v-model="cfg['notify.feishu_webhook']"
                  placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                  class="input"
                />
              </div>
              <PanelActions panel-id="notify-feishu" @save="savePanel('notify-feishu')" />
            </div>
            <div class="side-note">
              <strong>保存范围</strong>
              <p>只更新飞书 Webhook，其他通知渠道保持当前保存状态。</p>
              <button class="btn-ghost" :disabled="testing.feishu" @click="testNotify('feishu')">
                {{ testing.feishu ? '发送中...' : '发送测试消息' }}
              </button>
              <span v-if="testMsg.feishu" :class="['test-result', testOk.feishu ? 'ok' : 'err']">
                {{ testMsg.feishu }}
              </span>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'notify-custom'" key="notify-custom" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">通知</p>
              <h3>自定义 Webhook</h3>
            </div>
            <span :class="['badge', isFieldConfigured('notify.custom_webhook') ? 'on' : 'off']">
              {{ isFieldConfigured('notify.custom_webhook') ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label>Webhook URL（POST JSON）</label>
                <input
                  v-model="cfg['notify.custom_webhook']"
                  placeholder="https://your-server/hook"
                  class="input"
                />
              </div>
              <PanelActions panel-id="notify-custom" @save="savePanel('notify-custom')" />
            </div>
            <div class="side-note">
              <strong>保存范围</strong>
              <p>只更新自定义 Webhook 地址，适合接入内部转发服务或其他消息网关。</p>
              <button class="btn-ghost" :disabled="testing.webhook" @click="testNotify('webhook')">
                {{ testing.webhook ? '发送中...' : '发送测试消息' }}
              </button>
              <span v-if="testMsg.webhook" :class="['test-result', testOk.webhook ? 'ok' : 'err']">
                {{ testMsg.webhook }}
              </span>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'notify-guide'" key="notify-guide" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">通知</p>
              <h3>脚本调用说明</h3>
            </div>
            <span class="badge neutral">只读</span>
          </div>
          <div class="guide-grid">
            <div class="guide-block">
              <p class="guide-title">manifest.yaml</p>
              <pre class="guide-code">output:
  - type: excel
    filename: "结果_{date}.xlsx"
  - type: notify
    channel: dingtalk
    condition: "data.length > 0"</pre>
            </div>
            <div class="guide-block">
              <p class="guide-title">脚本 meta</p>
              <pre class="guide-code">return {
  success: true,
  data: violations,
  meta: {
    has_more: false,
    notify_title: `破价 ${violations.length} 个`,
    notify_body: violations.map(v => v['SKU ID']).join(', ')
  }
}</pre>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'storage-data'" key="storage-data" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">存储</p>
              <h3>数据目录</h3>
            </div>
            <span class="badge neutral">本机</span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label>数据目录 (CRAWSHRIMP_DATA)</label>
                <div class="input-row">
                  <input v-model="cfg['data_dir']" placeholder="默认自动选择可写目录" class="input" />
                  <button class="btn-ghost" @click="browseDir">选择</button>
                </div>
              </div>
              <PanelActions panel-id="storage-data" @save="savePanel('storage-data')" />
            </div>
            <div class="side-note path-note">
              <strong>当前目录</strong>
              <p>{{ cfg['data_dir'] || '默认运行时目录' }}</p>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'sync-odps'" key="sync-odps" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">数据同步</p>
              <h3>ODPS 写入接口</h3>
            </div>
            <span :class="['badge', isFieldConfigured('odps.app_code') ? 'on' : 'off']">
              {{ isFieldConfigured('odps.app_code') ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label>ODPS AppCode</label>
                <input
                  v-model="cfg['odps.app_code']"
                  placeholder="用于 Authorization: APPCODE ..."
                  class="input"
                  type="password"
                  autocomplete="off"
                />
              </div>
              <PanelActions panel-id="sync-odps" @save="savePanel('sync-odps')" />
            </div>
            <div class="side-note">
              <strong>同步出口</strong>
              <p>任务输出文件和「数据文件」页会读取这个 AppCode 进行 ODPS 同步。</p>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'ai-1xm'" key="ai-1xm" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">AI 生图</p>
              <h3>1XM 图片模型</h3>
            </div>
            <span :class="['badge', hasAnyFieldConfigured(ai1xmKeyFields) ? 'on' : 'off']">
              {{ hasAnyFieldConfigured(ai1xmKeyFields) ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label>1XM Base URL</label>
                <input
                  v-model="cfg['ai.1xm.base_url']"
                  placeholder="https://api.1xm.ai/v1"
                  class="input"
                />
              </div>
              <div class="split-fields">
                <div class="field">
                  <label>GPT Image 2K Key</label>
                  <input
                    v-model="cfg['ai.1xm.gpt_image_2k_key']"
                    placeholder="sk-..."
                    class="input"
                    type="password"
                    autocomplete="off"
                  />
                </div>
                <div class="field">
                  <label>GPT Image 4K Key</label>
                  <input
                    v-model="cfg['ai.1xm.gpt_image_4k_key']"
                    placeholder="sk-..."
                    class="input"
                    type="password"
                    autocomplete="off"
                  />
                </div>
              </div>
              <div class="split-fields">
                <div class="field">
                  <label>Gemini 3.1 Flash Image Preview Key</label>
                  <input
                    v-model="cfg['ai.1xm.gemini_3_1_flash_image_preview_key']"
                    placeholder="sk-..."
                    class="input"
                    type="password"
                    autocomplete="off"
                  />
                </div>
                <div class="field">
                  <label>Gemini 3 Pro Image Preview Key</label>
                  <input
                    v-model="cfg['ai.1xm.gemini_3_pro_image_preview_key']"
                    placeholder="sk-..."
                    class="input"
                    type="password"
                    autocomplete="off"
                  />
                </div>
              </div>
              <PanelActions panel-id="ai-1xm" @save="savePanel('ai-1xm')" />
            </div>
            <div class="side-note">
              <strong>密钥状态</strong>
              <div class="key-states">
                <span :class="['key-pill', isFieldConfigured('ai.1xm.gpt_image_2k_key') ? 'on' : 'off']">2K</span>
                <span :class="['key-pill', isFieldConfigured('ai.1xm.gpt_image_4k_key') ? 'on' : 'off']">4K</span>
                <span :class="['key-pill', isFieldConfigured('ai.1xm.gemini_3_1_flash_image_preview_key') ? 'on' : 'off']">G31</span>
                <span :class="['key-pill', isFieldConfigured('ai.1xm.gemini_3_pro_image_preview_key') ? 'on' : 'off']">G3P</span>
              </div>
              <p>密钥只保存在本机抓虾配置中，任务运行时由后端读取。</p>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'ai-video'" key="ai-video" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">AI 视频</p>
              <h3>视频模型 Provider</h3>
            </div>
            <span :class="['badge', hasAnyFieldConfigured(aiVideoKeyFields) ? 'on' : 'off']">
              {{ hasAnyFieldConfigured(aiVideoKeyFields) ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="split-fields">
                <div class="field">
                  <label>Seedance API Key</label>
                  <input
                    v-model="cfg['ai.video.seedance_api_key']"
                    class="input"
                    type="password"
                    autocomplete="off"
                  />
                </div>
                <div class="field">
                  <label>Seedance Base URL</label>
                  <input v-model="cfg['ai.video.seedance_base_url']" class="input" />
                </div>
              </div>
              <div class="split-fields">
                <div class="field">
                  <label>HappyHorse API Key</label>
                  <input
                    v-model="cfg['ai.video.bailian_api_key']"
                    class="input"
                    type="password"
                    autocomplete="off"
                  />
                </div>
                <div class="field">
                  <label>百炼业务空间 ID</label>
                  <input v-model="cfg['ai.video.bailian_workspace_id']" class="input" />
                </div>
              </div>
              <div class="split-fields">
                <div class="field">
                  <label>百炼区域</label>
                  <input v-model="cfg['ai.video.bailian_region']" class="input" />
                </div>
                <div class="field">
                  <label>百炼 Base URL（可选）</label>
                  <input v-model="cfg['ai.video.bailian_base_url']" class="input" />
                </div>
              </div>
              <PanelActions panel-id="ai-video" @save="savePanel('ai-video')" />
            </div>
            <div class="side-note">
              <strong>本机凭据</strong>
              <div class="key-states">
                <span :class="['key-pill', isFieldConfigured('ai.video.seedance_api_key') ? 'on' : 'off']">S</span>
                <span :class="['key-pill', isFieldConfigured('ai.video.bailian_api_key') ? 'on' : 'off']">H</span>
              </div>
              <p>密钥只保存在本机抓虾配置中，运行视频任务时注入共享能力进程；工作流页面、任务参数和日志不会展示密钥。</p>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'cloud-approval'" key="cloud-approval" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">云端审批</p>
              <h3>云端审批</h3>
            </div>
            <span :class="['badge', cloudStatus?.configured ? 'on' : 'off']">
              {{ cloudStatus?.configured ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label>云端地址</label>
                <input
                  v-model="cfg['cloud_approval.base_url']"
                  class="input"
                  readonly
                />
                <p :class="['cloud-address-hint', cloudAddressHintOk ? 'ok' : 'warn']">
                  {{ cloudAddressHint }}
                </p>
              </div>
              <div class="field">
                <label>注册 token</label>
                <input
                  v-model="cfg['cloud_approval.registration_token']"
                  placeholder="用于首次注册任务机"
                  class="input"
                  type="password"
                  autocomplete="off"
                />
              </div>
              <div class="field">
                <label>任务机名称</label>
                <input
                  v-model="cfg['cloud_approval.machine_name']"
                  placeholder="例如：设计部任务机"
                  class="input"
                />
              </div>
              <div class="field">
                <label>任务能力</label>
                <div class="capability-list">
                  <label v-for="option in cloudCapabilityOptions" :key="option.value" class="check-row">
                    <input
                      v-model="cfg['cloud_approval.capabilities']"
                      type="checkbox"
                      :value="option.value"
                    />
                    <span>{{ option.label }}</span>
                  </label>
                </div>
              </div>
              <label class="check-row">
                <input v-model="cfg['cloud_approval.machine_enabled']" type="checkbox" />
                <span>启用任务机</span>
              </label>
              <div class="action-strip cloud-actions">
                <button class="btn-orange" :disabled="cloudBusy.config" @click="saveCloudApprovalConfig">
                  {{ cloudBusy.config ? '保存中...' : '保存配置' }}
                </button>
                <button class="btn-ghost" :disabled="cloudBusy.enroll" @click="enrollCloudMachine">
                  {{ cloudBusy.enroll ? '注册中...' : '注册任务机' }}
                </button>
                <button class="btn-ghost" :disabled="cloudBusy.start || cloudStatus?.running" @click="startCloudMachine">
                  {{ cloudBusy.start ? '启动中...' : '启动' }}
                </button>
                <button class="btn-ghost" :disabled="cloudBusy.stop || !cloudStatus?.running" @click="stopCloudMachine">
                  {{ cloudBusy.stop ? '停止中...' : '停止' }}
                </button>
              </div>
              <p v-if="cloudMsg" :class="['inline-msg', cloudMsgOk ? 'ok' : 'err']">{{ cloudMsg }}</p>
            </div>
            <div class="side-note">
              <strong>任务机状态</strong>
              <div class="key-states">
                <span :class="['key-pill', cloudStatus?.running ? 'on' : 'off']">
                  {{ cloudStatus?.running ? '在线' : '离线' }}
                </span>
                <span :class="['key-pill', cloudStatus?.token_present ? 'on' : 'off']">
                  {{ cloudStatus?.token_present ? '已注册' : '未注册' }}
                </span>
                <span class="key-pill neutral">{{ cloudStatus?.health || 'stopped' }}</span>
              </div>
              <p>状态只显示是否已注册、运行状态和任务机 ID；长期任务机凭证不会在界面展示。</p>
              <p v-if="cloudStatus?.machine_id">任务机 ID：{{ cloudStatus.machine_id }}</p>
              <p v-if="cloudStatus?.base_url">云端地址：{{ cloudStatus.base_url }}</p>
              <p v-if="cloudStatus?.capabilities?.length">任务能力：{{ cloudStatus.capabilities.join(', ') }}</p>
            </div>
          </div>
        </section>
        </Transition>
      </main>
    </div>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, onMounted, reactive, ref, watch } from 'vue'

const OFFICIAL_RELEASE_URL = 'https://github.com/howtimeschange/crawshrimp/releases/latest'

const props = defineProps(['status', 'focusPanelId', 'updateStatus', 'updateActionBusy'])
const emit = defineEmits(['runtime-refresh', 'check-update'])

const cfg = ref({})
const savedCfg = ref({})

const activeGroupId = ref('connection')
const activePanelId = ref('connection-overview')

const launching = ref(false)
const chromeMsg = ref('')
const chromeMsgOk = ref(true)
const backendRepairing = ref(false)
const backendMsg = ref('')
const backendMsgOk = ref(true)

const testing = reactive({ dingtalk: false, feishu: false, webhook: false })
const testMsg = reactive({ dingtalk: '', feishu: '', webhook: '' })
const testOk = reactive({ dingtalk: true, feishu: true, webhook: true })
const cloudStatus = ref(null)
const cloudBusy = reactive({ config: false, enroll: false, start: false, stop: false })
const cloudMsg = ref('')
const cloudMsgOk = ref(true)
const cloudServiceErrorMessages = {
  invalid_environment_override: '开发环境变量中的云端审批地址无效',
  unreachable: '云端审批服务暂时无法访问',
  unexpected_service: '检测到的地址不是抓虾云端审批服务',
  not_detected: '未检测到本地审批服务，当前显示默认地址',
}
const defaultCloudCapabilities = ['generate_ai_image', 'regenerate_ai_image', 'submit_tmall_material_test', 'crawl_tmall_material_test_data']
const cloudCapabilityOptions = [
  { value: 'generate_ai_image', label: 'generate_ai_image' },
  { value: 'regenerate_ai_image', label: 'regenerate_ai_image' },
  { value: 'submit_tmall_material_test', label: 'submit_tmall_material_test' },
  { value: 'crawl_tmall_material_test_data', label: 'crawl_tmall_material_test_data' },
]
const ai1xmKeyFields = [
  'ai.1xm.gpt_image_2k_key',
  'ai.1xm.gpt_image_4k_key',
  'ai.1xm.gemini_3_1_flash_image_preview_key',
  'ai.1xm.gemini_3_pro_image_preview_key',
]
const aiVideoKeyFields = [
  'ai.video.seedance_api_key',
  'ai.video.bailian_api_key',
]

const saveState = reactive({})

const menuGroups = [
  {
    id: 'connection',
    icon: '●',
    label: '连接',
    desc: '核心服务 / Chrome',
    children: [{ id: 'connection-overview', label: '服务状态' }],
  },
  {
    id: 'notify',
    icon: '●',
    label: '通知',
    desc: '机器人 / Webhook',
    children: [
      { id: 'notify-dingtalk', label: '钉钉机器人', statusKey: 'notify.dingtalk_webhook' },
      { id: 'notify-feishu', label: '飞书机器人', statusKey: 'notify.feishu_webhook' },
      { id: 'notify-custom', label: '自定义 Webhook', statusKey: 'notify.custom_webhook' },
      { id: 'notify-guide', label: '脚本调用说明' },
    ],
  },
  {
    id: 'application',
    icon: '●',
    label: '应用',
    desc: '版本 / 桌面更新',
    children: [{ id: 'application-update', label: '桌面更新' }],
  },
  {
    id: 'storage',
    icon: '●',
    label: '存储',
    desc: '运行数据目录',
    children: [{ id: 'storage-data', label: '数据目录' }],
  },
  {
    id: 'sync',
    icon: '●',
    label: '数据同步',
    desc: 'ODPS 接口',
    children: [{ id: 'sync-odps', label: 'ODPS AppCode', statusKey: 'odps.app_code' }],
  },
  {
    id: 'ai',
    icon: '●',
    label: 'AI 能力',
    desc: '图片 / 视频模型',
    children: [
      { id: 'ai-1xm', label: '1XM 图片模型', statusKeys: ai1xmKeyFields },
      { id: 'ai-video', label: '视频模型', statusKeys: aiVideoKeyFields },
    ],
  },
  {
    id: 'cloud',
    icon: '●',
    label: '云端审批',
    desc: '审批入口 / 任务机',
    children: [{ id: 'cloud-approval', label: '云端审批', statusKey: 'cloud_approval.base_url' }],
  },
]

const panelFields = {
  'notify-dingtalk': ['notify.dingtalk_webhook', 'notify.dingtalk_secret'],
  'notify-feishu': ['notify.feishu_webhook'],
  'notify-custom': ['notify.custom_webhook'],
  'storage-data': ['data_dir'],
  'sync-odps': ['odps.app_code'],
  'ai-1xm': ['ai.1xm.base_url', 'ai.1xm.gpt_image_2k_key', 'ai.1xm.gpt_image_4k_key', 'ai.1xm.gemini_3_1_flash_image_preview_key', 'ai.1xm.gemini_3_pro_image_preview_key'],
  'ai-video': ['ai.video.seedance_api_key', 'ai.video.seedance_base_url', 'ai.video.bailian_api_key', 'ai.video.bailian_workspace_id', 'ai.video.bailian_region', 'ai.video.bailian_base_url'],
  'cloud-approval': ['cloud_approval.registration_token', 'cloud_approval.machine_name', 'cloud_approval.machine_enabled', 'cloud_approval.capabilities'],
}

const notifyPanelByChannel = {
  dingtalk: 'notify-dingtalk',
  feishu: 'notify-feishu',
  webhook: 'notify-custom',
}

const activeGroup = computed(() => menuGroups.find(group => group.id === activeGroupId.value) || menuGroups[0])
const updateStatus = computed(() => props.updateStatus || {})
const updateActionBusy = computed(() => Boolean(props.updateActionBusy))
const updateBadgeLabel = computed(() => {
  const status = String(updateStatus.value.status || 'idle')
  if (status === 'available') return '可更新'
  if (status === 'checking') return '检查中'
  if (status === 'downloading') return '下载中'
  if (status === 'ready-to-install') return '待安装'
  if (status === 'error') return '异常'
  if (status === 'unsupported') return '不可用'
  if (status === 'disabled') return '不可用'
  return '已配置'
})
const updateBadgeTone = computed(() => {
  const status = String(updateStatus.value.status || 'idle')
  if (status === 'error' || status === 'disabled' || status === 'unsupported') return 'off'
  if (status === 'available' || status === 'ready-to-install') return 'on'
  return 'neutral'
})
const formattedLastCheckedAt = computed(() => {
  const raw = updateStatus.value.lastCheckedAt || updateStatus.value.checkedAt || ''
  if (!raw) return '尚未检查'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return String(raw)
  return date.toLocaleString()
})
const showManualDownload = computed(() => {
  const status = String(updateStatus.value.status || '')
  const error = String(updateStatus.value.error || '')
  const hasFallbackStatus = status === 'disabled' || status === 'error' || status === 'unsupported'
  const hasFallbackError = /unsupported|signature|签名|更新/i.test(error)
  return updateStatus.value.manualDownloadUrl === OFFICIAL_RELEASE_URL && hasFallbackStatus && (status === 'unsupported' || hasFallbackError)
})
const cloudAddressHint = computed(() => {
  const status = cloudStatus.value || {}
  const errorMessage = cloudServiceErrorMessages[status.service_error] || '未检测到本地审批服务，当前显示默认地址'
  if (status.environment === 'production') {
    return status.service_reachable ? '正式环境固定地址' : `正式环境固定地址；${errorMessage}`
  }
  if (status.service_reachable) return '已检测到本地审批服务'
  return errorMessage
})
const cloudAddressHintOk = computed(() => Boolean(cloudStatus.value?.service_reachable))

function ensureSaveState(panelId) {
  if (!saveState[panelId]) {
    saveState[panelId] = { saving: false, msg: '', err: false }
  }
  return saveState[panelId]
}

function panelSaving(panelId) {
  return Boolean(saveState[panelId]?.saving)
}

function panelMsg(panelId) {
  return saveState[panelId]?.msg || ''
}

function panelErr(panelId) {
  return Boolean(saveState[panelId]?.err)
}

const PanelActions = defineComponent({
  name: 'PanelActions',
  props: { panelId: { type: String, required: true } },
  emits: ['save'],
  setup(componentProps, { emit: emitAction }) {
    return () => h('div', { class: 'panel-actions' }, [
      h(
        'button',
        {
          class: 'btn-orange',
          disabled: panelSaving(componentProps.panelId),
          onClick: () => emitAction('save'),
        },
        panelSaving(componentProps.panelId) ? '保存中...' : '保存此项',
      ),
      panelMsg(componentProps.panelId)
        ? h('span', {
          class: ['msg', panelErr(componentProps.panelId) ? 'err' : 'ok'],
        }, panelMsg(componentProps.panelId))
        : null,
    ])
  },
})

function flattenSettings(source, prefix = '', target = {}) {
  const value = source && typeof source === 'object' ? source : {}
  for (const [key, item] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      flattenSettings(item, nextKey, target)
    } else {
      target[nextKey] = item
    }
  }
  return target
}

function normalizedSettings(raw) {
  const flat = flattenSettings(raw || {})
  if (!flat['ai.1xm.base_url']) flat['ai.1xm.base_url'] = 'https://api.1xm.ai/v1'
  if (!flat['ai.video.seedance_base_url']) flat['ai.video.seedance_base_url'] = 'https://ark.cn-beijing.volces.com'
  if (!flat['ai.video.bailian_region']) flat['ai.video.bailian_region'] = 'cn-beijing'
  flat['cloud_approval.machine_enabled'] = Boolean(flat['cloud_approval.machine_enabled'])
  flat['cloud_approval.capabilities'] = normalizeCloudCapabilities(flat['cloud_approval.capabilities'])
  return flat
}

async function load() {
  const flat = normalizedSettings(await window.cs.getSettings() || {})
  cfg.value = { ...flat }
  savedCfg.value = { ...flat }
  await loadCloudStatus()
}

function selectGroup(groupId) {
  const group = menuGroups.find(item => item.id === groupId) || menuGroups[0]
  activeGroupId.value = group.id
  activePanelId.value = group.children[0]?.id || group.id
}

function selectPanel(groupId, panelId) {
  activeGroupId.value = groupId
  activePanelId.value = panelId
}

function focusPanel(panelId) {
  if (!panelId) return
  const group = menuGroups.find(item => item.children.some(child => child.id === panelId))
  if (!group) return
  activeGroupId.value = group.id
  activePanelId.value = panelId
}

function isFieldConfigured(key) {
  return String(cfg.value[key] || '').trim().length > 0
}

function hasAnyFieldConfigured(keys) {
  return keys.some(key => isFieldConfigured(key))
}

function isMenuChildConfigured(child) {
  if (Array.isArray(child?.statusKeys)) return hasAnyFieldConfigured(child.statusKeys)
  return isFieldConfigured(child?.statusKey)
}

async function browseDir() {
  const p = await window.cs.browseFile({ directory: true })
  if (p) cfg.value['data_dir'] = p
}

function buildPatch(panelId) {
  const keys = panelFields[panelId] || []
  return keys.reduce((patch, key) => {
    patch[key] = key === 'cloud_approval.capabilities'
      ? selectedCloudCapabilities()
      : cfg.value[key] ?? ''
    return patch
  }, {})
}

function normalizeCloudCapabilities(value) {
  const raw = Array.isArray(value) ? value : []
  const allowed = new Set(defaultCloudCapabilities)
  const capabilities = raw
    .map(item => String(item || '').trim())
    .filter((item, index, list) => item && allowed.has(item) && list.indexOf(item) === index)
  return capabilities.length ? capabilities : [...defaultCloudCapabilities]
}

function selectedCloudCapabilities() {
  const capabilities = normalizeCloudCapabilities(cfg.value['cloud_approval.capabilities'])
  cfg.value['cloud_approval.capabilities'] = capabilities
  return capabilities
}

async function savePanel(panelId, options = {}) {
  const keys = panelFields[panelId] || []
  if (!keys.length) return { ok: true }

  const state = ensureSaveState(panelId)
  state.saving = true
  state.err = false
  if (!options.silent) state.msg = ''

  try {
    const patch = buildPatch(panelId)
    const result = typeof window.cs.patchSettings === 'function'
      ? await window.cs.patchSettings(patch)
      : await window.cs.saveSettings({ ...savedCfg.value, ...patch })

    savedCfg.value = { ...savedCfg.value, ...patch }
    state.err = false
    if (!options.silent) {
      state.msg = result?.restart_required ? '已保存，重启应用后生效' : '已保存'
    }
    return result
  } catch (e) {
    state.err = true
    state.msg = e?.message || '保存失败'
    throw e
  } finally {
    state.saving = false
  }
}

function cloudConfigPayload() {
  return {
    registration_token: cfg.value['cloud_approval.registration_token'] || '',
    machine_name: cfg.value['cloud_approval.machine_name'] || '',
    machine_enabled: Boolean(cfg.value['cloud_approval.machine_enabled']),
    capabilities: selectedCloudCapabilities(),
  }
}

function applyCloudStatus(status) {
  cloudStatus.value = status || null
  if (status?.base_url !== undefined) cfg.value['cloud_approval.base_url'] = status.base_url || ''
  if (status?.machine_name !== undefined) cfg.value['cloud_approval.machine_name'] = status.machine_name || cfg.value['cloud_approval.machine_name'] || ''
  if (status?.machine_enabled !== undefined) cfg.value['cloud_approval.machine_enabled'] = Boolean(status.machine_enabled)
  if (status?.capabilities !== undefined) cfg.value['cloud_approval.capabilities'] = normalizeCloudCapabilities(status.capabilities)
}

async function loadCloudStatus() {
  if (typeof window.cs.getCloudApprovalStatus !== 'function') return
  try {
    applyCloudStatus(await window.cs.getCloudApprovalStatus({ refresh: true }))
  } catch (e) {
    cloudMsg.value = e?.message || '读取云端审批状态失败'
    cloudMsgOk.value = false
  }
}

async function saveCloudApprovalConfig() {
  cloudBusy.config = true
  cloudMsg.value = ''
  try {
    const result = await window.cs.saveCloudApprovalConfig(cloudConfigPayload())
    applyCloudStatus(result?.status)
    cloudMsg.value = '已保存'
    cloudMsgOk.value = true
  } catch (e) {
    cloudMsg.value = e?.message || '保存失败'
    cloudMsgOk.value = false
  } finally {
    cloudBusy.config = false
  }
}

async function enrollCloudMachine() {
  cloudBusy.enroll = true
  cloudMsg.value = ''
  try {
    await window.cs.saveCloudApprovalConfig(cloudConfigPayload())
    const result = await window.cs.enrollCloudMachine({
      registration_token: cfg.value['cloud_approval.registration_token'] || '',
      machine_name: cfg.value['cloud_approval.machine_name'] || '',
      capabilities: selectedCloudCapabilities(),
    })
    applyCloudStatus(result?.status)
    cloudMsg.value = '任务机已注册'
    cloudMsgOk.value = true
  } catch (e) {
    cloudMsg.value = e?.message || '注册失败'
    cloudMsgOk.value = false
  } finally {
    cloudBusy.enroll = false
  }
}

async function startCloudMachine() {
  cloudBusy.start = true
  cloudMsg.value = ''
  try {
    const result = await window.cs.startCloudMachine()
    applyCloudStatus(result?.status)
    cloudMsg.value = '任务机已启动'
    cloudMsgOk.value = true
  } catch (e) {
    cloudMsg.value = e?.message || '启动失败'
    cloudMsgOk.value = false
  } finally {
    cloudBusy.start = false
  }
}

async function stopCloudMachine() {
  cloudBusy.stop = true
  cloudMsg.value = ''
  try {
    const result = await window.cs.stopCloudMachine()
    applyCloudStatus(result?.status)
    cloudMsg.value = '任务机已停止'
    cloudMsgOk.value = true
  } catch (e) {
    cloudMsg.value = e?.message || '停止失败'
    cloudMsgOk.value = false
  } finally {
    cloudBusy.stop = false
  }
}

async function doLaunchChrome() {
  launching.value = true
  chromeMsg.value = ''
  try {
    const res = await window.cs.launchChrome()
    chromeMsg.value = res.msg || (res.ok ? '已启动' : '启动失败')
    chromeMsgOk.value = res.ok
    emit('runtime-refresh')
  } catch (e) {
    chromeMsg.value = e.message
    chromeMsgOk.value = false
  } finally {
    launching.value = false
  }
}

async function doRepairBackend() {
  backendRepairing.value = true
  backendMsg.value = ''
  try {
    const result = await window.cs.restartBackend()
    backendMsg.value = result?.dataDirRecovery?.recovered
      ? `核心服务已恢复，数据目录已切换到 ${result.dataDir}`
      : '核心服务已重新启动并通过健康检查'
    backendMsgOk.value = true
    emit('runtime-refresh')
  } catch (error) {
    backendMsg.value = error?.message || '核心服务修复失败'
    backendMsgOk.value = false
  } finally {
    backendRepairing.value = false
  }
}

async function openDiagnosticLog() {
  try {
    await window.cs.openDiagnosticLog()
  } catch (error) {
    backendMsg.value = error?.message || '无法打开诊断日志'
    backendMsgOk.value = false
  }
}

function requestUpdateCheck() {
  emit('check-update')
}

function openManualDownload() {
  if (updateActionBusy.value) return
  if (updateStatus.value.manualDownloadUrl === OFFICIAL_RELEASE_URL) {
    window.cs.openExternalUrl(updateStatus.value.manualDownloadUrl)
  }
}

async function testNotify(channel) {
  const panelId = notifyPanelByChannel[channel]
  testing[channel] = true
  testMsg[channel] = ''

  try {
    await savePanel(panelId, { silent: true })
    const res = await window.cs.testNotify(channel)
    testMsg[channel] = res.ok ? (res.msg || '发送成功') : (res.error || '发送失败')
    testOk[channel] = Boolean(res.ok)
  } catch (e) {
    testMsg[channel] = e?.message || '发送失败'
    testOk[channel] = false
  } finally {
    testing[channel] = false
  }
}

onMounted(() => {
  load()
  focusPanel(props.focusPanelId)
})

watch(() => props.focusPanelId, panelId => {
  focusPanel(panelId)
})

watch(activePanelId, panelId => {
  if (panelId === 'cloud-approval') loadCloudStatus()
})
</script>

<style scoped>
.view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.view-header {
  display: flex;
  align-items: center;
  padding: 20px 28px 16px;
  border-bottom: 1px solid var(--border);
}

.view-header h2 {
  font-size: 19px;
  font-weight: 750;
  margin: 0;
}

.view-header p {
  margin: 6px 0 0;
  color: var(--text3);
  font-size: 12px;
  line-height: 1.4;
}

.settings-workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 236px minmax(0, 1fr);
  gap: 18px;
  padding: 18px 24px 22px 28px;
  overflow: hidden;
}

.settings-menu,
.settings-content {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.settings-menu {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
  scrollbar-gutter: stable;
}

.menu-cluster {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.menu-group,
.menu-child {
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text2);
  text-align: left;
  transition:
    background 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
    border-color 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
    color 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
    box-shadow 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
    transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.menu-group {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 9px;
  padding: 10px 11px;
  transform-origin: left center;
}

.menu-group:hover,
.menu-child:hover {
  background: var(--bg2);
  color: var(--text);
}

.menu-group:active,
.menu-child:active,
.btn-orange:active,
.btn-ghost:active {
  transform: translateY(1px);
}

.menu-group.active {
  background: rgba(255, 107, 43, 0.11);
  border-color: rgba(255, 107, 43, 0.2);
  color: var(--orange);
  box-shadow: inset 0 0 0 1px rgba(255, 107, 43, 0.06), 0 10px 28px rgba(255, 107, 43, 0.06);
}

.menu-icon {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: currentColor;
  color: inherit;
  font-size: 0;
  flex: 0 0 auto;
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.22s ease;
}

.menu-group.active .menu-icon {
  transform: scale(1.28);
  box-shadow: 0 0 0 4px rgba(255, 107, 43, 0.08);
}

.menu-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.menu-copy strong {
  font-size: 13px;
  font-weight: 700;
  color: inherit;
}

.menu-copy small {
  font-size: 11px;
  color: var(--text3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.menu-children {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 0 0 2px 23px;
  overflow: hidden;
  transform-origin: top left;
}

.menu-child {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 30px;
  border-radius: 7px;
  padding: 7px 9px;
  font-size: 12px;
  transform-origin: left center;
}

.menu-child.active {
  color: var(--text);
  background: var(--bg3);
  border-color: var(--border);
  transform: translateX(4px);
}

.mini-state {
  flex: 0 0 auto;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 999px;
}

.mini-state.on {
  color: #4ade80;
  background: rgba(74, 222, 128, 0.1);
}

.mini-state.off {
  color: #f87171;
  background: rgba(248, 113, 113, 0.1);
}

.settings-children-enter-active,
.settings-children-leave-active {
  max-height: 190px;
  transition:
    max-height 0.26s cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 0.2s ease,
    transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.settings-children-enter-from,
.settings-children-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-6px) scaleY(0.98);
}

.settings-children-enter-to,
.settings-children-leave-from {
  max-height: 190px;
  opacity: 1;
  transform: translateY(0) scaleY(1);
}

.settings-children-enter-active .menu-child {
  animation: menu-child-in 0.26s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.settings-children-enter-active .menu-child:nth-child(2) { animation-delay: 0.025s; }
.settings-children-enter-active .menu-child:nth-child(3) { animation-delay: 0.05s; }
.settings-children-enter-active .menu-child:nth-child(4) { animation-delay: 0.075s; }

.settings-content {
  display: flex;
  align-items: flex-start;
  padding-right: 4px;
}

.panel {
  width: min(100%, 1180px);
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  transform-origin: top left;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}

.panel-kicker {
  margin: 0 0 5px;
  color: var(--orange);
  font-size: 12px;
  font-weight: 700;
}

.panel-head h3 {
  margin: 0;
  font-size: 19px;
  line-height: 1.25;
}

.panel-layout,
.guide-grid {
  display: grid;
  grid-template-columns: minmax(360px, 1.15fr) minmax(280px, 0.85fr);
  gap: 18px;
  align-items: start;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.readonly-grid {
  display: grid;
  gap: 10px;
}

.readonly-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-height: 42px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
}

.readonly-row span {
  color: var(--text3);
  font-size: 12px;
}

.readonly-row strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  overflow-wrap: anywhere;
  text-align: right;
}

.status-card,
.side-note,
.guide-block {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 9px;
}

.status-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 16px;
}

.status-card div {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.status-card span:first-child {
  color: var(--text3);
  font-size: 12px;
}

.status-card strong {
  color: var(--text);
  font-size: 15px;
  font-weight: 700;
}

.form-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.field label {
  font-size: 12px;
  color: var(--text2);
}

.input-row,
.split-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.split-fields {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.input {
  width: 100%;
  min-width: 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--text);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.input:focus {
  border-color: var(--orange);
  background: #17171d;
}

.side-note {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 15px;
  color: var(--text2);
}

.side-note strong {
  color: var(--text);
  font-size: 13px;
}

.side-note p {
  margin: 0;
  color: var(--text3);
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.path-note p {
  color: var(--text2);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
}

.panel-actions,
.action-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
}

.badge,
.msg,
.test-result {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  max-width: 100%;
}

.badge {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 999px;
  font-weight: 700;
}

.badge.on {
  background: rgba(74, 222, 128, 0.12);
  color: #4ade80;
}

.badge.off {
  background: rgba(248, 113, 113, 0.12);
  color: #f87171;
}

.badge.neutral {
  background: rgba(148, 163, 184, 0.12);
  color: #cbd5e1;
}

.inline-msg,
.msg,
.test-result {
  font-size: 12px;
  line-height: 1.4;
}

.inline-msg,
.msg {
  margin: 0;
  padding: 7px 10px;
  border-radius: 7px;
}

.inline-msg.ok,
.msg.ok,
.test-result.ok {
  color: #4ade80;
}

.inline-msg.ok,
.msg.ok {
  background: rgba(74, 222, 128, 0.1);
}

.inline-msg.err,
.msg.err,
.test-result.err {
  color: #f87171;
}

.inline-msg.err,
.msg.err {
  background: rgba(248, 113, 113, 0.1);
}

.cloud-address-hint {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.5;
}

.cloud-address-hint.ok {
  color: #4ade80;
}

.cloud-address-hint.warn {
  color: var(--orange);
}

.guide-block {
  min-width: 0;
  padding: 14px;
}

.guide-title {
  margin: 0 0 10px;
  color: var(--orange);
  font-size: 12px;
  font-weight: 700;
}

.guide-code {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
  background: var(--bg);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 7px;
  padding: 11px 12px;
  margin: 0;
  color: var(--text2);
  white-space: pre;
  overflow-x: auto;
  line-height: 1.6;
}

.key-states {
  display: flex;
  gap: 8px;
}

.key-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  height: 26px;
  border-radius: 7px;
  border: 1px solid var(--border);
  font-size: 12px;
  font-weight: 800;
}

.key-pill.on {
  color: #4ade80;
  background: rgba(74, 222, 128, 0.09);
  border-color: rgba(74, 222, 128, 0.18);
}

.key-pill.off {
  color: var(--text3);
  background: rgba(255, 255, 255, 0.03);
}

.key-pill.neutral {
  color: #cbd5e1;
  background: rgba(148, 163, 184, 0.12);
  border-color: rgba(148, 163, 184, 0.18);
}

.check-row {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  width: fit-content;
  color: var(--text2);
  font-size: 12px;
}

.check-row input {
  width: 15px;
  height: 15px;
  accent-color: var(--orange);
}

.capability-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
}

.cloud-actions {
  flex-wrap: wrap;
}

.btn-orange,
.btn-ghost {
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
}

.btn-orange {
  padding: 10px 18px;
  border: none;
  background: var(--orange);
  color: white;
}

.btn-orange:hover:not(:disabled) {
  background: #ff7a3e;
}

.btn-ghost {
  padding: 9px 13px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text2);
}

.btn-ghost:hover:not(:disabled) {
  background: var(--bg2);
  color: var(--text);
}

.btn-orange:disabled,
.btn-ghost:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

:deep(.panel-actions) {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
}

:deep(.panel-actions .btn-orange) {
  padding: 10px 18px;
  border: none;
  border-radius: 8px;
  background: var(--orange);
  color: white;
  font-size: 12px;
  font-weight: 700;
  transition: background 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
}

:deep(.panel-actions .btn-orange:hover:not(:disabled)) {
  background: #ff7a3e;
}

:deep(.panel-actions .btn-orange:active) {
  transform: translateY(1px);
}

:deep(.panel-actions .btn-orange:disabled) {
  opacity: 0.45;
  cursor: not-allowed;
}

:deep(.panel-actions .msg) {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  max-width: 100%;
  margin: 0;
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 12px;
  line-height: 1.4;
}

:deep(.panel-actions .msg.ok) {
  background: rgba(74, 222, 128, 0.1);
  color: #4ade80;
}

:deep(.panel-actions .msg.err) {
  background: rgba(248, 113, 113, 0.1);
  color: #f87171;
}

.settings-panel-enter-active {
  transition:
    opacity 0.24s ease,
    transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1),
    filter 0.24s ease;
}

.settings-panel-leave-active {
  transition:
    opacity 0.14s ease,
    transform 0.16s cubic-bezier(0.4, 0, 1, 1),
    filter 0.14s ease;
}

.settings-panel-enter-from {
  opacity: 0;
  transform: translateY(10px) scale(0.992);
  filter: blur(2px);
}

.settings-panel-leave-to {
  opacity: 0;
  transform: translateY(-5px) scale(0.996);
  filter: blur(1px);
}

.settings-panel-enter-to,
.settings-panel-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
  filter: blur(0);
}

.settings-panel-enter-active .panel-head,
.settings-panel-enter-active .status-card,
.settings-panel-enter-active .field,
.settings-panel-enter-active .side-note,
.settings-panel-enter-active .guide-block,
.settings-panel-enter-active :deep(.panel-actions) {
  animation: panel-item-in 0.32s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.settings-panel-enter-active .status-card:nth-child(2),
.settings-panel-enter-active .field:nth-child(2),
.settings-panel-enter-active .guide-block:nth-child(2) {
  animation-delay: 0.035s;
}

.settings-panel-enter-active .side-note,
.settings-panel-enter-active :deep(.panel-actions) {
  animation-delay: 0.06s;
}

@keyframes menu-child-in {
  from {
    opacity: 0;
    transform: translateX(-8px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes panel-item-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .menu-group,
  .menu-child,
  .menu-icon,
  .settings-children-enter-active,
  .settings-children-leave-active,
  .settings-panel-enter-active,
  .settings-panel-leave-active,
  .settings-panel-enter-active .panel-head,
  .settings-panel-enter-active .status-card,
  .settings-panel-enter-active .field,
  .settings-panel-enter-active .side-note,
  .settings-panel-enter-active .guide-block,
  .settings-panel-enter-active :deep(.panel-actions) {
    animation: none;
    transition: none;
  }
}

@media (max-width: 980px) {
  .settings-workspace {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }

  .settings-menu {
    overflow: visible;
  }

  .settings-content {
    overflow: visible;
  }

  .panel-layout,
  .guide-grid,
  .status-grid,
  .split-fields {
    grid-template-columns: 1fr;
  }
}
</style>
