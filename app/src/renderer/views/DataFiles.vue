<template>
  <div class="df-root">
    <!-- 固定顶部栏 -->
    <header class="df-header">
      <h2>数据文件</h2>
      <div class="df-header-actions">
        <button class="btn-ghost-sm" @click="showDirSetting = !showDirSetting">📁 保存目录</button>
        <button class="btn-ghost-sm" @click="load">刷新</button>
      </div>
    </header>

    <!-- 可变导航面板 -->
    <div v-if="showDirSetting" class="df-dir-panel">
      <div class="df-dir-inner">
        <label class="df-dir-label">数据保存目录</label>
        <div class="df-dir-row">
          <input v-model="dataDir" class="df-input" placeholder="默认: ~/.crawshrimp" />
          <button class="btn-ghost-sm" @click="browseDir">选择</button>
          <button class="btn-orange-sm" :disabled="savingDir" @click="saveDir">
            {{ savingDir ? '保存中…' : '保存' }}
          </button>
        </div>
        <p v-if="dirMsg" :class="['df-dir-msg', dirOk ? 'ok' : 'err']">{{ dirMsg }}</p>
        <p class="df-dir-hint">修改后新任务产出的文件将保存到此目录，已有文件路径不变。</p>
      </div>
    </div>

    <div v-if="groups.length" class="df-toolbar" :class="{ active: selectedCount > 0 }">
      <div class="df-toolbar-left">
        <label class="df-select-all">
          <input
            type="checkbox"
            :checked="allSelected"
            @change="toggleSelectAll"
          />
          <span>{{ allSelected ? '取消全选' : '全选当前列表' }}</span>
        </label>
        <span class="df-toolbar-count">已选 {{ selectedCount }} 个文件</span>
      </div>
      <div class="df-toolbar-actions">
        <button class="btn-ghost-sm" :disabled="!selectedCount || deleting" @click="clearSelection">清空选择</button>
        <button class="btn-danger-sm" :disabled="!selectedCount || deleting" @click="openBatchDeleteConfirm">批量删除</button>
      </div>
    </div>

    <div v-if="noticeMsg" class="df-notice" :class="noticeType">
      {{ noticeMsg }}
    </div>

    <!-- 滚动内容区 -->
    <div class="df-body">
      <div v-if="!groups.length" class="df-placeholder">还没有输出文件。执行一个抓取任务后文件会出现在这里。</div>
      <div v-for="g in groups" :key="g.key" class="df-group">
        <div class="df-group-header">
          <span class="df-group-name">{{ g.adapter }} / {{ g.task }}</span>
          <span class="df-group-count">{{ g.files.length }} 个文件</span>
        </div>
        <div class="df-group-body">
          <div v-for="f in g.files" :key="f.path" class="df-file-row" :class="{ selected: isSelected(f.path) }">
            <label class="df-file-check" @click.stop>
              <input
                type="checkbox"
                :checked="isSelected(f.path)"
                :disabled="deleting"
                @change="toggleSelection(f, $event.target.checked)"
              />
            </label>
            <span class="df-file-icon">{{ f.path.endsWith('.xlsx') || f.path.endsWith('.xls') ? '📊' : f.path.endsWith('.json') ? '📋' : '📄' }}</span>
            <div class="df-file-info" @click="openFile(f.path)">
              <span class="df-file-name">{{ f.name }}</span>
              <span class="df-file-meta">
                <span v-if="f.size" class="df-file-size">{{ f.size }}</span>
                <span v-if="f.ctime" class="df-file-time">{{ f.ctime }}</span>
              </span>
            </div>
            <div class="df-file-actions">
              <button class="df-btn" @click="revealFile(f.path)">显示</button>
              <button class="df-btn" @click="saveAs(f.path)">另存为</button>
              <button class="df-btn df-btn-danger" @click="openDeleteConfirm([f])">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除确认 -->
    <div v-if="showDeleteConfirm" class="df-modal-overlay" @click.self="closeDeleteConfirm">
      <div class="df-modal df-modal-danger">
        <p class="df-modal-title">确认删除 {{ deleteTargets.length }} 个文件</p>
        <p class="df-modal-body">将从磁盘永久删除这些表格文件，并同步从运行记录中移除。此操作无法撤销。</p>
        <div class="df-delete-preview">
          <div v-for="file in deleteTargets.slice(0, 5)" :key="file.path" class="df-delete-item">
            <span class="df-delete-item-name">{{ file.name }}</span>
            <span class="df-delete-item-path">{{ file.path }}</span>
          </div>
          <div v-if="deleteTargets.length > 5" class="df-delete-more">
            还有 {{ deleteTargets.length - 5 }} 个文件未显示
          </div>
        </div>
        <div class="df-modal-actions">
          <button class="btn-ghost-sm" :disabled="deleting" @click="closeDeleteConfirm">取消</button>
          <button class="btn-danger-sm" :disabled="deleting || !deleteTargets.length" @click="doDelete">
            {{ deleting ? '删除中…' : '确认删除' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'

const groups         = ref([])
const showDirSetting = ref(false)
const dataDir        = ref('')
const savingDir      = ref(false)
const dirMsg         = ref('')
const dirOk          = ref(true)
const deleting       = ref(false)
const showDeleteConfirm = ref(false)
const deleteTargets   = ref([])
const selectedPaths   = ref([])
const noticeMsg       = ref('')
const noticeType      = ref('ok')
let noticeTimer       = null

const allFiles = computed(() => groups.value.flatMap(g => g.files || []))
const visiblePaths = computed(() => [...new Set(allFiles.value.map(f => f.path).filter(Boolean))])
const selectedFiles = computed(() => {
  const selected = new Set(selectedPaths.value)
  const seen = new Set()
  const files = []
  for (const file of allFiles.value) {
    const path = file?.path
    if (!path || !selected.has(path) || seen.has(path)) continue
    seen.add(path)
    files.push(file)
  }
  return files
})
const selectedCount = computed(() => selectedFiles.value.length)
const allSelected = computed(() => visiblePaths.value.length > 0 && selectedCount.value === visiblePaths.value.length)

async function load() {
  try {
    const settings = await window.cs.getSettings()
    dataDir.value = settings['data_dir'] || ''
  } catch (_) {}

  const adapters = await window.cs.getAdapters()
  const result = []
  for (const a of adapters) {
    const tasks = await window.cs.getTasks()
    for (const t of tasks.filter(x => x.adapter_id === a.id)) {
      const data = await window.cs.getData(a.id, t.task_id)
      const files = []
      for (const run of (data.runs || [])) {
        let paths = []
        try { paths = typeof run.output_files === 'string' ? JSON.parse(run.output_files) : (run.output_files || []) } catch {}
        for (const p of paths) {
          let size = '', ctime = ''
          try {
            const stat = await window.cs.statFile(p)
            if (!stat?.isFile) continue
            size  = stat.size  ? formatSize(stat.size)  : ''
            ctime = stat.ctime ? formatDate(stat.ctime) : ''
          } catch (_) {}
          files.push({ path: p, name: p.split('/').pop().split('\\').pop(), size, ctime })
        }
      }
      if (files.length) result.push({ key: a.id + t.task_id, adapter: a.name, task: t.task_name, files })
    }
  }
  groups.value = result
  syncSelection()
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function formatDate(iso) {
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

function openFile(path)   { window.cs.openFile(path) }
function revealFile(path) { window.cs.revealFile(path) }
async function saveAs(srcPath) { await window.cs.saveAsFile(srcPath) }

function isSelected(path) {
  return selectedPaths.value.includes(path)
}

function toggleSelection(file, checked) {
  const path = file?.path
  if (!path) return
  if (checked) {
    if (!selectedPaths.value.includes(path)) selectedPaths.value = [...selectedPaths.value, path]
  } else {
    selectedPaths.value = selectedPaths.value.filter(p => p !== path)
  }
}

function clearSelection() {
  selectedPaths.value = []
}

function toggleSelectAll() {
  if (allSelected.value) {
    clearSelection()
    return
  }
  selectedPaths.value = [...visiblePaths.value]
}

function syncSelection() {
  const visible = new Set(visiblePaths.value)
  selectedPaths.value = selectedPaths.value.filter(path => visible.has(path))
}

function clearNoticeTimer() {
  if (noticeTimer) {
    clearTimeout(noticeTimer)
    noticeTimer = null
  }
}

function setNotice(message, type = 'ok', ttlMs = 2600) {
  clearNoticeTimer()
  noticeMsg.value = message
  noticeType.value = type
  if (ttlMs > 0) {
    noticeTimer = window.setTimeout(() => {
      noticeMsg.value = ''
      noticeTimer = null
    }, ttlMs)
  }
}

function openDeleteConfirm(files) {
  deleteTargets.value = [...(files || [])]
  showDeleteConfirm.value = true
}

function openBatchDeleteConfirm() {
  openDeleteConfirm(selectedFiles.value)
}

function closeDeleteConfirm() {
  if (deleting.value) return
  showDeleteConfirm.value = false
  deleteTargets.value = []
}

async function doDelete() {
  const targets = [...deleteTargets.value]
  if (!targets.length) return
  deleting.value = true
  try {
    const paths = targets.map(f => f.path).filter(Boolean)
    const r = await window.cs.deleteFiles(paths)
    const deletedCount = Number(r?.deleted_count || 0)
    const missingCount = Number(r?.missing_count || 0)
    const failedCount = Number(r?.failed_count || (Array.isArray(r?.failed) ? r.failed.length : 0) || 0)
    if (!r?.ok && !deletedCount && !missingCount) {
      throw new Error(r?.error || '删除失败')
    }

    await load()
    const deletedSet = new Set(paths)
    selectedPaths.value = selectedPaths.value.filter(path => !deletedSet.has(path))
    showDeleteConfirm.value = false
    deleteTargets.value = []

    const parts = []
    if (deletedCount > 0) parts.push(`已删除 ${deletedCount} 个文件`)
    if (missingCount > 0) parts.push(`${missingCount} 个文件已不存在`)
    if (failedCount > 0) parts.push(`${failedCount} 个文件删除失败`)
    setNotice(parts.join('，') || '删除完成', failedCount > 0 ? 'warn' : 'ok')
  } catch (e) {
    setNotice('删除失败：' + (e.message || e), 'err', 3600)
  }
  deleting.value = false
}

async function browseDir() {
  const p = await window.cs.browseFile({ directory: true })
  if (p) dataDir.value = p
}

async function saveDir() {
  savingDir.value = true; dirMsg.value = ''
  try {
    const settings = await window.cs.getSettings()
    const plain = Object.assign({}, settings, { data_dir: dataDir.value })
    await window.cs.saveSettings(JSON.parse(JSON.stringify(plain)))
    dirMsg.value = '已保存'; dirOk.value = true
  } catch (e) {
    dirMsg.value = e.message; dirOk.value = false
  }
  savingDir.value = false
}

onMounted(load)
onUnmounted(clearNoticeTimer)
</script>

<style scoped>
/* === 根容器：position 绝对定位，完全跳出 grid 链 === */
.df-root {
  position: fixed;
  top: 40px;          /* 避开 macOS 标题栏 */
  left: 168px;        /* 避开侧边栏 */
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  overflow: hidden;
}

/* === 固定头部 === */
.df-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 18px 24px 14px;
  border-bottom: 1px solid var(--border);
  gap: 12px;
}
.df-header h2 { font-size: 18px; font-weight: 700; flex: 1; }
.df-header-actions { display: flex; gap: 8px; }

/* === 目录面板 === */
.df-dir-panel {
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
}
.df-dir-inner { padding: 14px 24px; display: flex; flex-direction: column; gap: 8px; max-width: 680px; }
.df-dir-label { font-size: 12px; font-weight: 600; color: var(--text2); }
.df-dir-row { display: flex; gap: 8px; align-items: center; }
.df-dir-row .df-input { flex: 1; }
.df-input { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; color: var(--text); font-size: 13px; outline: none; }
.df-input:focus { border-color: var(--orange); }
.df-dir-msg { font-size: 12px; padding: 5px 10px; border-radius: 6px; }
.df-dir-msg.ok  { background: rgba(74,222,128,0.1);  color: #4ade80; }
.df-dir-msg.err { background: rgba(248,113,113,0.1); color: #f87171; }
.df-dir-hint { font-size: 11px; color: var(--text3); margin: 0; }

/* === 批量工具条 === */
.df-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 24px;
  border-bottom: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.02);
}
.df-toolbar.active {
  background: rgba(249, 115, 22, 0.08);
}
.df-toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.df-select-all {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text2);
  user-select: none;
}
.df-select-all input {
  width: 14px;
  height: 14px;
  accent-color: var(--orange);
}
.df-toolbar-count {
  font-size: 12px;
  color: var(--text3);
}
.df-toolbar-actions {
  display: flex;
  gap: 8px;
}

/* === 轻提示 === */
.df-notice {
  margin: 10px 24px 0;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.45;
}
.df-notice.ok {
  border: 1px solid rgba(74, 222, 128, 0.25);
  background: rgba(74, 222, 128, 0.08);
  color: #86efac;
}
.df-notice.warn {
  border: 1px solid rgba(251, 191, 36, 0.25);
  background: rgba(251, 191, 36, 0.08);
  color: #fcd34d;
}
.df-notice.err {
  border: 1px solid rgba(248, 113, 113, 0.25);
  background: rgba(248, 113, 113, 0.08);
  color: #fca5a5;
}

/* === 滚动区 === */
.df-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
}

/* === 空状态 === */
.df-placeholder { color: var(--text3); text-align: center; padding: 60px; font-size: 14px; }

/* === 文件组 === */
.df-group { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin-bottom: 20px; }
.df-group:last-child { margin-bottom: 0; }
.df-group-header { display: flex; align-items: center; padding: 12px 16px; background: var(--bg3); border-bottom: 1px solid var(--border); gap: 8px; }
.df-group-name { font-size: 13px; font-weight: 600; color: var(--text); flex: 1; }
.df-group-count { font-size: 11px; color: var(--text3); }
.df-group-body { display: flex; flex-direction: column; }

/* === 文件行 === */
.df-file-row { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--border); transition: background 0.1s; }
.df-file-row:last-child { border-bottom: none; }
.df-file-row:hover { background: var(--bg3); }
.df-file-row.selected { background: rgba(249, 115, 22, 0.08); }
.df-file-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.df-file-check input {
  width: 14px;
  height: 14px;
  accent-color: var(--orange);
}
.df-file-icon { font-size: 18px; flex-shrink: 0; }
.df-file-info { flex: 1; display: flex; flex-direction: column; gap: 3px; cursor: pointer; min-width: 0; }
.df-file-name { font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.df-file-meta { display: flex; gap: 10px; align-items: center; }
.df-file-size { font-size: 11px; color: var(--text3); }
.df-file-time { font-size: 11px; color: var(--text3); }
.df-file-actions { display: flex; gap: 6px; flex-shrink: 0; }
.df-btn { font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text2); cursor: pointer; white-space: nowrap; }
.df-btn:hover { background: var(--bg); color: var(--text); }
.df-btn-danger { color: #f87171; border-color: rgba(248,113,113,0.3); }
.df-btn-danger:hover { background: rgba(248,113,113,0.1); }

/* === 模态框 === */
.df-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 100; }
.df-modal { background: var(--bg2); border: 1px solid var(--border); border-radius: 14px; padding: 24px; min-width: 320px; max-width: 440px; display: flex; flex-direction: column; gap: 14px; }
.df-modal-danger { border-color: rgba(248, 113, 113, 0.35); box-shadow: 0 12px 48px rgba(0, 0, 0, 0.35); }
.df-modal-title { font-size: 15px; font-weight: 700; }
.df-modal-body { font-size: 13px; color: var(--text2); line-height: 1.6; }
.df-modal-body strong { color: var(--text); }
.df-modal-actions { display: flex; gap: 10px; justify-content: flex-end; }

.df-delete-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow: auto;
  padding: 8px 0 0;
}
.df-delete-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
}
.df-delete-item-name {
  font-size: 12px;
  color: var(--text);
  word-break: break-all;
}
.df-delete-item-path,
.df-delete-more {
  font-size: 11px;
  color: var(--text3);
  word-break: break-all;
}

/* === 按钮 === */
.btn-ghost-sm { padding: 6px 12px; border-radius: 7px; border: 1px solid var(--border); background: transparent; color: var(--text2); font-size: 12px; cursor: pointer; }
.btn-ghost-sm:hover:not(:disabled) { background: var(--bg3); color: var(--text); }
.btn-ghost-sm:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-orange-sm { padding: 6px 14px; border-radius: 8px; border: none; background: var(--orange); color: white; font-size: 12px; font-weight: 600; cursor: pointer; }
.btn-orange-sm:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-danger-sm { padding: 6px 14px; border-radius: 7px; border: none; background: #ef4444; color: white; font-size: 12px; font-weight: 600; cursor: pointer; }
.btn-danger-sm:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
