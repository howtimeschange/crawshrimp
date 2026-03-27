<template>
  <div class="view">
    <header class="view-header">
      <h2>数据文件</h2>
      <div class="header-actions">
        <button class="btn-ghost-sm" @click="showDirSetting = !showDirSetting" title="设置保存目录">
          📁 保存目录
        </button>
        <button class="btn-ghost-sm" @click="load">刷新</button>
      </div>
    </header>

    <!-- 保存目录设置面板 -->
    <div v-if="showDirSetting" class="dir-panel">
      <div class="dir-panel-inner">
        <label class="dir-label">数据保存目录</label>
        <div class="dir-row">
          <input v-model="dataDir" class="input" placeholder="默认: ~/.crawshrimp" />
          <button class="btn-ghost-sm" @click="browseDir">选择</button>
          <button class="btn-orange-sm" :disabled="savingDir" @click="saveDir">
            {{ savingDir ? '保存中…' : '保存' }}
          </button>
        </div>
        <p v-if="dirMsg" :class="['dir-msg', dirOk ? 'ok' : 'err']">{{ dirMsg }}</p>
        <p class="dir-hint">修改后新任务产出的文件将保存到此目录，已有文件路径不变。</p>
      </div>
    </div>

    <div class="file-browser">
      <div v-if="!groups.length" class="placeholder">还没有输出文件。执行一个抓取任务后文件会出现在这里。</div>
      <div v-for="g in groups" :key="g.key" class="group">
        <div class="group-header">
          <span class="group-name">{{ g.adapter }} / {{ g.task }}</span>
          <span class="group-count">{{ g.files.length }} 个文件</span>
        </div>
        <div class="file-rows">
          <div v-for="f in g.files" :key="f.path" class="file-row">
            <span class="f-icon">{{ f.path.endsWith('.xlsx') || f.path.endsWith('.xls') ? '📊' : f.path.endsWith('.json') ? '📋' : '📄' }}</span>
            <div class="f-info" @click="openFile(f.path)" title="点击打开文件">
              <span class="f-name">{{ f.name }}</span>
              <span class="f-meta">
                <span v-if="f.size" class="f-size">{{ f.size }}</span>
                <span v-if="f.ctime" class="f-ctime">{{ f.ctime }}</span>
              </span>
            </div>
            <div class="f-actions">
              <button class="f-btn" title="在文件夹中显示" @click="revealFile(f.path)">显示</button>
              <button class="f-btn" title="另存为…" @click="saveAs(f.path)">另存为</button>
              <button class="f-btn danger" title="删除文件" @click="deleteFile(f)">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除确认对话框 -->
    <div v-if="confirmFile" class="modal-overlay" @click.self="confirmFile = null">
      <div class="modal">
        <p class="modal-title">确认删除</p>
        <p class="modal-body">将永久删除文件：<br><strong>{{ confirmFile.name }}</strong></p>
        <div class="modal-actions">
          <button class="btn-ghost-sm" @click="confirmFile = null">取消</button>
          <button class="btn-danger-sm" :disabled="deleting" @click="doDelete">
            {{ deleting ? '删除中…' : '确认删除' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const groups        = ref([])
const showDirSetting = ref(false)
const dataDir       = ref('')
const savingDir     = ref(false)
const dirMsg        = ref('')
const dirOk         = ref(true)
const confirmFile   = ref(null)
const deleting      = ref(false)

async function load() {
  // 同时加载设置（获取当前数据目录）
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
          // 获取文件 stat（大小 + 创建时间）
          let size = '', ctime = ''
          try {
            const stat = await window.cs.statFile(p)
            if (stat) {
              size  = stat.size  ? formatSize(stat.size)  : ''
              ctime = stat.ctime ? formatDate(stat.ctime) : ''
            }
          } catch (_) {}
          files.push({ path: p, name: p.split('/').pop().split('\\').pop(), size, ctime })
        }
      }
      if (files.length) result.push({ key: a.id + t.task_id, adapter: a.name, task: t.task_name, files })
    }
  }
  groups.value = result
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

async function saveAs(srcPath) {
  await window.cs.saveAsFile(srcPath)
}

function deleteFile(f) { confirmFile.value = f }

async function doDelete() {
  if (!confirmFile.value) return
  deleting.value = true
  try {
    await window.cs.deleteFile(confirmFile.value.path)
    // 从 groups 中移除
    for (const g of groups.value) {
      const idx = g.files.findIndex(f => f.path === confirmFile.value.path)
      if (idx !== -1) { g.files.splice(idx, 1); break }
    }
    // 清空空 group
    groups.value = groups.value.filter(g => g.files.length > 0)
  } catch (e) {
    alert('删除失败：' + e.message)
  }
  deleting.value = false
  confirmFile.value = null
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
</script>

<style scoped>
.view { height: 100%; display: flex; flex-direction: column; }
.view-header { display: flex; align-items: center; padding: 20px 24px 16px; border-bottom: 1px solid var(--border); gap: 12px; }
.view-header h2 { font-size: 18px; font-weight: 700; flex: 1; }
.header-actions { display: flex; gap: 8px; }

/* 目录设置面板 */
.dir-panel { border-bottom: 1px solid var(--border); background: var(--bg2); }
.dir-panel-inner { padding: 14px 24px; display: flex; flex-direction: column; gap: 8px; max-width: 680px; }
.dir-label { font-size: 12px; font-weight: 600; color: var(--text2); }
.dir-row { display: flex; gap: 8px; align-items: center; }
.dir-row .input { flex: 1; }
.input { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; color: var(--text); font-size: 13px; outline: none; }
.input:focus { border-color: var(--orange); }
.dir-msg { font-size: 12px; padding: 5px 10px; border-radius: 6px; }
.dir-msg.ok  { background: rgba(74,222,128,0.1);  color: #4ade80; }
.dir-msg.err { background: rgba(248,113,113,0.1); color: #f87171; }
.dir-hint { font-size: 11px; color: var(--text3); margin: 0; }

/* 文件浏览 */
.placeholder { color: var(--text3); text-align: center; padding: 60px; font-size: 14px; }
.file-browser { flex: 1; overflow-y: auto; padding: 16px 24px; display: flex; flex-direction: column; gap: 20px; }
.group { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.group-header { display: flex; align-items: center; padding: 12px 16px; background: var(--bg3); border-bottom: 1px solid var(--border); gap: 8px; }
.group-name { font-size: 13px; font-weight: 600; color: var(--text); flex: 1; }
.group-count { font-size: 11px; color: var(--text3); }
.file-rows { display: flex; flex-direction: column; }
.file-row { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--border); transition: background 0.1s; }
.file-row:last-child { border-bottom: none; }
.file-row:hover { background: var(--bg3); }
.f-icon { font-size: 18px; flex-shrink: 0; }
.f-info { flex: 1; display: flex; flex-direction: column; gap: 3px; cursor: pointer; min-width: 0; }
.f-name { font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.f-meta { display: flex; gap: 10px; align-items: center; }
.f-size  { font-size: 11px; color: var(--text3); }
.f-ctime { font-size: 11px; color: var(--text3); }
.f-actions { display: flex; gap: 6px; flex-shrink: 0; }
.f-btn { font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text2); cursor: pointer; white-space: nowrap; }
.f-btn:hover { background: var(--bg); color: var(--text); }
.f-btn.danger { color: #f87171; border-color: rgba(248,113,113,0.3); }
.f-btn.danger:hover { background: rgba(248,113,113,0.1); }

/* 删除确认模态框 */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: var(--bg2); border: 1px solid var(--border); border-radius: 14px; padding: 24px; min-width: 320px; max-width: 440px; display: flex; flex-direction: column; gap: 14px; }
.modal-title { font-size: 15px; font-weight: 700; }
.modal-body { font-size: 13px; color: var(--text2); line-height: 1.6; }
.modal-body strong { color: var(--text); }
.modal-actions { display: flex; gap: 10px; justify-content: flex-end; }

/* 按钮 */
.btn-ghost-sm { padding: 6px 12px; border-radius: 7px; border: 1px solid var(--border); background: transparent; color: var(--text2); font-size: 12px; cursor: pointer; }
.btn-ghost-sm:hover:not(:disabled) { background: var(--bg3); color: var(--text); }
.btn-ghost-sm:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-orange-sm { padding: 6px 14px; border-radius: 8px; border: none; background: var(--orange); color: white; font-size: 12px; font-weight: 600; cursor: pointer; }
.btn-orange-sm:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-danger-sm { padding: 6px 14px; border-radius: 7px; border: none; background: #ef4444; color: white; font-size: 12px; font-weight: 600; cursor: pointer; }
.btn-danger-sm:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
