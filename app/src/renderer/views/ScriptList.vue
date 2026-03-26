<template>
  <div class="view">
    <header class="view-header">
      <h2>我的脚本</h2>
      <div class="header-actions">
        <button class="btn-ghost" @click="showInstall = true">+ 导入脚本</button>
      </div>
    </header>

    <div class="script-grid">
      <div v-if="loading" class="placeholder">加载中…</div>
      <div v-else-if="!groups.length" class="placeholder">
        还没有脚本。点击「导入脚本」安装你的第一个适配包。
      </div>

      <div
        v-for="g in groups" :key="g.adapter_id"
        class="script-card"
        :class="{ disabled: !g.enabled }"
        @click="$emit('open-script', g)"
      >
        <div class="card-top">
          <span class="card-icon">🦐</span>
          <div class="card-info">
            <strong>{{ g.adapter_name }}</strong>
            <span class="task-count">{{ g.tasks.length }} 个任务</span>
          </div>
          <span class="arrow">→</span>
        </div>
        <div class="task-chips">
          <span v-for="t in g.tasks" :key="t.task_id" class="chip">{{ t.task_name }}</span>
        </div>
        <div class="card-bottom">
          <span v-if="anyRunning(g)" class="running-badge">运行中</span>
          <span v-else-if="lastStatus(g)" :class="['status-badge', lastStatus(g)]">
            {{ lastStatus(g) === 'done' ? '上次成功' : '上次失败' }}
          </span>
          <button class="remove-btn" @click.stop="removeAdapter(g.adapter_id)">移除</button>
        </div>
      </div>
    </div>

    <!-- 导入弹窗 -->
    <div v-if="showInstall" class="modal-backdrop" @click.self="showInstall = false">
      <div class="modal">
        <h3>导入脚本包</h3>
        <p class="modal-sub">选择包含 manifest.yaml 的适配包文件夹，或直接拖入 .zip 包</p>
        <div class="input-row">
          <input v-model="installPath" placeholder="/path/to/adapter-folder" class="input" />
          <button class="btn-orange-sm" @click="browsePath">选择目录</button>
        </div>
        <p v-if="msg" :class="['msg', msgErr ? 'err' : 'ok']">{{ msg }}</p>
        <div class="modal-actions">
          <button class="btn-orange" :disabled="!installPath" @click="doInstall">导入</button>
          <button class="btn-ghost" @click="showInstall = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, inject, onMounted } from 'vue'

const emit = defineEmits(['open-script', 'reload'])
const scriptGroups = inject('scriptGroups')
const loadScriptGroups = inject('loadScriptGroups')

const loading = ref(false)
const showInstall = ref(false)
const installPath = ref('')
const msg = ref('')
const msgErr = ref(false)

const groups = scriptGroups

onMounted(async () => {
  loading.value = true
  await loadScriptGroups()
  loading.value = false
})

function anyRunning(g) {
  return g.tasks.some(t => t.live?.status === 'running')
}

function lastStatus(g) {
  for (const t of g.tasks) {
    if (t.last_run?.status) return t.last_run.status
  }
  return null
}

async function removeAdapter(id) {
  if (!confirm(`确认移除「${id}」？相关数据不会删除。`)) return
  await window.cs.uninstallAdapter(id)
  await loadScriptGroups()
}

async function browsePath() {
  const p = await window.cs.browseFile({ directory: true, title: '选择适配包文件夹' })
  if (p) installPath.value = p
}

async function doInstall() {
  msg.value = ''; msgErr.value = false
  const r = await window.cs.installAdapter({ path: installPath.value })
  if (r.ok) {
    msg.value = `已导入：${r.adapter?.name || installPath.value}`
    installPath.value = ''
    await loadScriptGroups()
    emit('reload')
  } else {
    msg.value = r.detail || r.error || '导入失败'
    msgErr.value = true
  }
}
</script>

<style scoped>
.view { height: 100%; display: flex; flex-direction: column; }
.view-header {
  display: flex; align-items: center; padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border);
}
.view-header h2 { font-size: 18px; font-weight: 700; flex: 1; }
.placeholder { color: var(--text3); text-align: center; padding: 60px; font-size: 14px; grid-column: 1/-1; }

.script-grid {
  flex: 1; overflow-y: auto; padding: 20px 24px;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px; align-content: start;
}
.script-card {
  background: var(--bg2); border: 1px solid var(--border); border-radius: 12px;
  padding: 18px; cursor: pointer; transition: all 0.15s;
  display: flex; flex-direction: column; gap: 12px;
}
.script-card:hover { border-color: var(--orange); background: var(--bg3); }
.script-card.disabled { opacity: 0.5; }
.card-top { display: flex; align-items: center; gap: 12px; }
.card-icon { font-size: 26px; }
.card-info { flex: 1; }
.card-info strong { display: block; font-size: 15px; font-weight: 700; color: var(--text); }
.task-count { font-size: 12px; color: var(--text3); }
.arrow { font-size: 16px; color: var(--text3); transition: color 0.15s; }
.script-card:hover .arrow { color: var(--orange); }
.task-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  font-size: 11px; padding: 3px 9px; border-radius: 20px;
  background: var(--bg3); border: 1px solid var(--border); color: var(--text2);
}
.card-bottom { display: flex; align-items: center; justify-content: space-between; }
.running-badge { font-size: 11px; padding: 2px 8px; border-radius: 5px; background: var(--orange-bg); color: var(--orange); }
.status-badge { font-size: 11px; padding: 2px 8px; border-radius: 5px; }
.status-badge.done  { background: rgba(74,222,128,0.1); color: #4ade80; }
.status-badge.error { background: rgba(248,113,113,0.1); color: #f87171; }
.remove-btn {
  font-size: 11px; color: var(--text3); background: transparent; border: none;
  padding: 3px 8px; border-radius: 5px;
}
.remove-btn:hover { color: #f87171; background: rgba(248,113,113,0.1); }

/* Modal */
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: var(--bg2); border: 1px solid var(--border); border-radius: 16px; padding: 28px; width: 500px; display: flex; flex-direction: column; gap: 16px; }
.modal h3 { font-size: 16px; font-weight: 700; }
.modal-sub { font-size: 12px; color: var(--text3); margin-top: -8px; }
.input-row { display: flex; gap: 8px; }
.input { flex: 1; background: var(--bg3); border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px; color: var(--text); font-size: 13px; outline: none; }
.input:focus { border-color: var(--orange); }
.msg { font-size: 12px; padding: 6px 10px; border-radius: 6px; }
.msg.ok  { background: rgba(74,222,128,0.1); color: #4ade80; }
.msg.err { background: rgba(248,113,113,0.1); color: #f87171; }
.modal-actions { display: flex; gap: 8px; }

/* Buttons */
.btn-orange { padding: 9px 20px; border-radius: 9px; border: none; background: var(--orange); color: white; font-size: 13px; font-weight: 700; }
.btn-orange:hover { background: var(--orange-dim); }
.btn-orange:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-orange-sm { padding: 9px 14px; border-radius: 8px; border: none; background: var(--orange); color: white; font-size: 12px; font-weight: 600; white-space: nowrap; }
.btn-ghost { padding: 9px 16px; border-radius: 9px; border: 1px solid var(--border); background: transparent; color: var(--text2); font-size: 13px; }
.btn-ghost:hover { background: var(--bg3); color: var(--text); }
.header-actions .btn-ghost { padding: 7px 14px; font-size: 12px; }
</style>
