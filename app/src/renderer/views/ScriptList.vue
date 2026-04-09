<template>
  <div class="view">
    <header class="view-header">
      <h2>我的脚本</h2>
      <div class="header-actions">
        <button class="btn-ghost" @click="openInstallModal">+ 导入脚本</button>
      </div>
    </header>

    <div class="script-grid">
      <div v-if="loading" class="placeholder">加载中…</div>
      <div v-else-if="loadError && !groups.length" class="placeholder placeholder-stack">
        <span>{{ loadError }}</span>
        <button class="btn-ghost" @click="loadGroups">重试</button>
      </div>
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
            {{ lastStatusLabel(lastStatus(g)) }}
          </span>
          <button class="remove-btn" @click.stop="removeAdapter(g.adapter_id)">移除</button>
        </div>
      </div>
    </div>

    <!-- 导入弹窗 -->
    <div
      v-if="showInstall"
      class="modal-backdrop"
      @click.self="closeInstallModal"
      @dragenter.prevent="handleDragEnter"
      @dragover.prevent="handleDragOver"
      @dragleave.prevent="handleDragLeave"
      @drop.prevent="handleDrop"
    >
      <div class="modal install-modal" :class="{ success: installState === 'success' }">
        <template v-if="installState === 'success'">
          <div class="success-panel" aria-live="polite">
            <div class="success-badge">✓</div>
            <h3>导入成功</h3>
            <p class="success-copy">
              <strong>{{ successAdapterName }}</strong> {{ successDetail }}
            </p>
            <div class="success-meta">
              <span class="success-pill">列表已刷新</span>
              <span v-if="successAdapterVersion" class="success-pill">v{{ successAdapterVersion }}</span>
            </div>
            <button class="btn-success" @click="closeInstallModal">完成</button>
          </div>
        </template>

        <template v-else>
          <h3>导入脚本包</h3>
          <p class="modal-sub">支持导入两种来源：包含 manifest.yaml 的适配包目录，或已经打包好的 .zip 适配包</p>
          <div class="drop-zone" :class="{ active: isDragging, ready: !!installPath }">
            <div class="drop-title">{{ isDragging ? '松开即可导入' : '拖拽适配包目录或 .zip 包到这里' }}</div>
            <div class="drop-sub">{{ installSummary }}</div>
          </div>
          <div class="picker-row">
            <button class="btn-orange-sm" :disabled="installing" @click="browseDirectory">选择目录</button>
            <button class="btn-ghost" :disabled="installing" @click="browseZip">选择 ZIP</button>
          </div>
          <div class="input-row install-input-row">
            <input
              v-model="installPath"
              placeholder="也可以直接粘贴目录路径或 .zip 文件路径"
              class="input"
              :disabled="installing"
              @change="handleManualPathChange"
            />
            <span v-if="installType" class="path-kind">{{ installType === 'zip' ? 'ZIP' : '目录' }}</span>
            <button v-if="installPath" class="clear-inline" :disabled="installing" @click="clearInstallSelection">清空</button>
          </div>
          <p v-if="msg" :class="['msg', msgErr ? 'err' : 'ok']">{{ msg }}</p>
          <div class="modal-actions">
            <button class="btn-orange" :disabled="!installPath || installing" @click="doInstall">
              {{ installing ? '导入中…' : '导入' }}
            </button>
            <button class="btn-ghost" :disabled="installing" @click="closeInstallModal">取消</button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, inject, onMounted, onUnmounted } from 'vue'

const emit = defineEmits(['open-script', 'reload'])
const scriptGroups = inject('scriptGroups')
const loadScriptGroups = inject('loadScriptGroups')

const loading = ref(false)
const loadError = ref('')
const showInstall = ref(false)
const installPath = ref('')
const installType = ref('')
const installing = ref(false)
const isDragging = ref(false)
const dragDepth = ref(0)
const msg = ref('')
const msgErr = ref(false)
const installState = ref('idle')
const successAdapterName = ref('')
const successAdapterVersion = ref('')
const successDetail = ref('')
const successCloseTimer = ref(null)

const groups = scriptGroups

onMounted(loadGroups)

async function loadGroups() {
  loading.value = true
  loadError.value = ''
  try {
    await loadScriptGroups()
  } catch (error) {
    console.error('Failed to load script groups', error)
    loadError.value = error?.message || '脚本列表加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function anyRunning(g) {
  return g.tasks.some(t => ['running', 'pausing', 'paused', 'stopping'].includes(t.live?.status))
}

function lastStatus(g) {
  for (const t of g.tasks) {
    if (t.last_run?.status) return t.last_run.status
  }
  return null
}

function lastStatusLabel(status) {
  if (status === 'done') return '上次成功'
  if (status === 'stopped') return '上次停止'
  return '上次失败'
}

const zipFilters = [
  { name: 'ZIP 适配包', extensions: ['zip'] },
  { name: '所有文件', extensions: ['*'] },
]

const installSummary = computed(() => {
  if (installType.value === 'zip' && installPath.value) {
    return '已选择 ZIP 包，导入时会自动解压并安装'
  }
  if (installType.value === 'directory' && installPath.value) {
    return '已选择适配包目录，目录根下需要包含 manifest.yaml'
  }
  return '支持拖入单个目录或单个 .zip 包，也可以点击下方按钮选择'
})

async function removeAdapter(id) {
  if (!confirm(`确认移除「${id}」？相关数据不会删除。`)) return
  await window.cs.uninstallAdapter(id)
  await loadScriptGroups()
}

function resetDragState() {
  dragDepth.value = 0
  isDragging.value = false
}

function openInstallModal() {
  resetInstallFeedback()
  clearInstallSelection()
  showInstall.value = true
}

function closeInstallModal() {
  if (installing.value) return
  clearSuccessTimer()
  showInstall.value = false
  resetInstallFeedback()
  clearInstallSelection()
}

function clearInstallSelection() {
  installPath.value = ''
  installType.value = ''
  msg.value = ''
  msgErr.value = false
  resetDragState()
}

function clearSuccessTimer() {
  if (successCloseTimer.value) {
    clearTimeout(successCloseTimer.value)
    successCloseTimer.value = null
  }
}

function resetInstallFeedback() {
  clearSuccessTimer()
  msg.value = ''
  msgErr.value = false
  installState.value = 'idle'
  successAdapterName.value = ''
  successAdapterVersion.value = ''
  successDetail.value = ''
}

async function resolveInstallTarget(targetPath, expectedKind = '') {
  const normalized = String(targetPath || '').trim()
  if (!normalized) return { ok: false, error: '请选择适配包目录或 .zip 包' }

  const stat = await window.cs.statFile(normalized)
  const lower = normalized.toLowerCase()

  if (expectedKind === 'zip') {
    if (!stat?.isFile || !lower.endsWith('.zip')) {
      return { ok: false, error: '请选择一个 .zip 适配包文件' }
    }
    return { ok: true, kind: 'zip', path: normalized }
  }

  if (expectedKind === 'directory') {
    if (!stat?.isDirectory) {
      return { ok: false, error: '请选择包含 manifest.yaml 的适配包目录' }
    }
    return { ok: true, kind: 'directory', path: normalized }
  }

  if (stat?.isDirectory) return { ok: true, kind: 'directory', path: normalized }
  if (stat?.isFile && lower.endsWith('.zip')) return { ok: true, kind: 'zip', path: normalized }

  return { ok: false, error: '仅支持适配包目录或 .zip 包' }
}

async function setInstallTarget(targetPath, expectedKind = '') {
  const result = await resolveInstallTarget(targetPath, expectedKind)
  installPath.value = String(targetPath || '').trim()
  if (!result.ok) {
    installType.value = ''
    msg.value = result.error
    msgErr.value = true
    return false
  }
  installPath.value = result.path
  installType.value = result.kind
  msg.value = ''
  msgErr.value = false
  return true
}

async function browseDirectory() {
  const p = await window.cs.browseFile({ directory: true, title: '选择适配包文件夹' })
  if (p) await setInstallTarget(p, 'directory')
}

async function browseZip() {
  const p = await window.cs.browseFile({ title: '选择 ZIP 适配包', filters: zipFilters })
  if (p) await setInstallTarget(p, 'zip')
}

async function handleManualPathChange() {
  if (!installPath.value.trim()) {
    clearInstallSelection()
    return
  }
  await setInstallTarget(installPath.value)
}

function hasDraggedFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files')
}

function handleDragEnter(event) {
  if (!hasDraggedFiles(event)) return
  dragDepth.value += 1
  isDragging.value = true
}

function handleDragOver(event) {
  if (!hasDraggedFiles(event)) return
  event.dataTransfer.dropEffect = 'copy'
  isDragging.value = true
}

function handleDragLeave(event) {
  if (!hasDraggedFiles(event)) return
  dragDepth.value = Math.max(0, dragDepth.value - 1)
  if (dragDepth.value === 0) isDragging.value = false
}

async function handleDrop(event) {
  resetDragState()
  const files = Array.from(event.dataTransfer?.files || []).filter(file => file.path)
  if (!files.length) return
  if (files.length > 1) {
    msg.value = '一次只能导入一个适配包目录或一个 .zip 包'
    msgErr.value = true
    return
  }
  await setInstallTarget(files[0].path)
}

async function doInstall() {
  const resolved = await resolveInstallTarget(installPath.value, installType.value)
  if (!resolved.ok) {
    msg.value = resolved.error
    msgErr.value = true
    return
  }

  installPath.value = resolved.path
  installType.value = resolved.kind
  msg.value = ''
  msgErr.value = false
  installState.value = 'idle'
  installing.value = true

  const payload = resolved.kind === 'zip'
    ? { file: resolved.path }
    : { path: resolved.path }

  try {
    const r = await window.cs.installAdapter(payload)
    if (r.ok) {
      let refreshFailed = false
      try {
        await loadScriptGroups()
        emit('reload')
      } catch (error) {
        refreshFailed = true
        console.warn('Failed to reload script groups after install', error)
      }
      installing.value = false
      successAdapterName.value = r.adapter?.name || resolved.path
      successAdapterVersion.value = r.adapter?.version || ''
      successDetail.value = refreshFailed
        ? '已成功导入，但脚本列表刷新失败，请稍后手动刷新。'
        : '已成功导入，脚本列表已更新。'
      installState.value = 'success'
      clearInstallSelection()
      clearSuccessTimer()
      successCloseTimer.value = window.setTimeout(() => {
        if (showInstall.value && installState.value === 'success') {
          closeInstallModal()
        }
      }, 1800)
      return
    }
    msg.value = r.detail || r.error || '导入失败'
    msgErr.value = true
  } catch (error) {
    msg.value = error?.message || '导入失败'
    msgErr.value = true
  } finally {
    installing.value = false
  }
}

onUnmounted(() => {
  clearSuccessTimer()
})
</script>

<style scoped>
.view { height: 100%; display: flex; flex-direction: column; }
.view-header {
  display: flex; align-items: center; padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border);
}
.view-header h2 { font-size: 18px; font-weight: 700; flex: 1; }
.placeholder { color: var(--text3); text-align: center; padding: 60px; font-size: 14px; grid-column: 1/-1; }
.placeholder-stack { display: flex; flex-direction: column; align-items: center; gap: 12px; }

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
.status-badge.stopped { background: rgba(251,191,36,0.1); color: #fbbf24; }
.status-badge.error { background: rgba(248,113,113,0.1); color: #f87171; }
.remove-btn {
  font-size: 11px; color: var(--text3); background: transparent; border: none;
  padding: 3px 8px; border-radius: 5px;
}
.remove-btn:hover { color: #f87171; background: rgba(248,113,113,0.1); }

/* Modal */
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: var(--bg2); border: 1px solid var(--border); border-radius: 16px; padding: 28px; width: 500px; display: flex; flex-direction: column; gap: 16px; }
.install-modal { width: 560px; }
.install-modal.success {
  border-color: rgba(74, 222, 128, 0.25);
  background: linear-gradient(180deg, rgba(22, 101, 52, 0.24), rgba(15, 23, 42, 0.98));
}
.modal h3 { font-size: 16px; font-weight: 700; }
.modal-sub { font-size: 12px; color: var(--text3); margin-top: -8px; line-height: 1.6; }
.drop-zone {
  border: 1px dashed var(--border);
  border-radius: 14px;
  padding: 18px;
  background: rgba(255,255,255,0.02);
  transition: border-color 0.15s, background 0.15s, transform 0.15s;
}
.drop-zone.active {
  border-color: var(--orange);
  background: rgba(255, 106, 41, 0.08);
  transform: translateY(-1px);
}
.drop-zone.ready {
  border-style: solid;
  border-color: rgba(255, 106, 41, 0.45);
}
.drop-title { font-size: 14px; font-weight: 700; color: var(--text); }
.drop-sub { margin-top: 6px; font-size: 12px; color: var(--text3); line-height: 1.6; }
.picker-row { display: flex; gap: 10px; }
.input-row { display: flex; gap: 8px; }
.install-input-row { align-items: center; }
.input { flex: 1; background: var(--bg3); border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px; color: var(--text); font-size: 13px; outline: none; }
.input:focus { border-color: var(--orange); }
.path-kind {
  flex-shrink: 0;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(255, 106, 41, 0.12);
  color: var(--orange);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.clear-inline {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--text3);
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 6px;
}
.clear-inline:hover:not(:disabled) { color: #f87171; background: rgba(248,113,113,0.1); }
.msg { font-size: 12px; padding: 6px 10px; border-radius: 6px; }
.msg.ok  { background: rgba(74,222,128,0.1); color: #4ade80; }
.msg.err { background: rgba(248,113,113,0.1); color: #f87171; }
.modal-actions { display: flex; gap: 8px; }

.success-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
  padding: 18px 8px 4px;
}
.success-badge {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 24px;
  font-weight: 800;
  color: #4ade80;
  border: 1px solid rgba(74, 222, 128, 0.3);
  background: radial-gradient(circle at top, rgba(74, 222, 128, 0.24), rgba(74, 222, 128, 0.08));
  box-shadow: 0 0 0 6px rgba(74, 222, 128, 0.06);
}
.success-panel h3 {
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
}
.success-copy {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text2);
  max-width: 420px;
}
.success-copy strong {
  color: #e2e8f0;
}
.success-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}
.success-pill {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(74, 222, 128, 0.12);
  border: 1px solid rgba(74, 222, 128, 0.18);
  color: #4ade80;
}
.btn-success {
  margin-top: 6px;
  padding: 10px 20px;
  border-radius: 10px;
  border: 1px solid rgba(74, 222, 128, 0.25);
  background: linear-gradient(180deg, rgba(34, 197, 94, 0.95), rgba(22, 163, 74, 0.95));
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.btn-success:hover { filter: brightness(1.05); }

/* Buttons */
.btn-orange { padding: 9px 20px; border-radius: 9px; border: none; background: var(--orange); color: white; font-size: 13px; font-weight: 700; }
.btn-orange:hover { background: var(--orange-dim); }
.btn-orange:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-orange-sm { padding: 9px 14px; border-radius: 8px; border: none; background: var(--orange); color: white; font-size: 12px; font-weight: 600; white-space: nowrap; }
.btn-ghost { padding: 9px 16px; border-radius: 9px; border: 1px solid var(--border); background: transparent; color: var(--text2); font-size: 13px; }
.btn-ghost:hover { background: var(--bg3); color: var(--text); }
.header-actions .btn-ghost { padding: 7px 14px; font-size: 12px; }
</style>
