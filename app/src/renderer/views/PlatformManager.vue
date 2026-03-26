<template>
  <div class="view">
    <header class="view-header">
      <h2>Platforms</h2>
      <button class="btn btn-sm" @click="showInstallModal = true">+ Install Adapter</button>
    </header>
    <div class="adapter-grid">
      <div v-if="loading" class="placeholder">Loading...</div>
      <div v-else-if="!adapters.length" class="placeholder">No adapters installed. Click "Install Adapter" to add a platform.</div>
      <div v-for="a in adapters" :key="a.id" class="adapter-card" :class="{ disabled: !a.enabled }">
        <div class="card-header">
          <div class="adapter-meta">
            <strong>{{ a.name }}</strong>
            <span class="version">v{{ a.version }}</span>
          </div>
          <label class="toggle">
            <input type="checkbox" :checked="a.enabled" @change="toggleAdapter(a.id, $event.target.checked)" />
            <span class="slider"></span>
          </label>
        </div>
        <p class="description">{{ a.description || a.id }}</p>
        <div class="card-footer">
          <span class="task-count">{{ a.tasks?.length || 0 }} tasks</span>
          <button class="btn btn-danger btn-sm" @click="uninstall(a.id)">Remove</button>
        </div>
      </div>
    </div>
    <div v-if="showInstallModal" class="modal-backdrop" @click.self="showInstallModal = false">
      <div class="modal">
        <h3>Install Adapter</h3>
        <div class="field">
          <label>Local directory path</label>
          <div class="input-row">
            <input v-model="installPath" placeholder="/path/to/adapter-folder" />
            <button class="btn btn-sm" @click="browsePath">Browse</button>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" @click="installAdapter" :disabled="!installPath">Install</button>
          <button class="btn btn-ghost" @click="showInstallModal = false">Cancel</button>
        </div>
        <p v-if="installMsg" :class="['msg', installErr ? 'err' : 'ok']">{{ installMsg }}</p>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, onMounted } from 'vue'
const adapters = ref([]); const loading = ref(true)
const showInstallModal = ref(false); const installPath = ref('')
const installMsg = ref(''); const installErr = ref(false)
async function loadAdapters() { loading.value = true; adapters.value = await window.cs.getAdapters(); loading.value = false }
async function toggleAdapter(id, enabled) { await window.cs.enableAdapter(id, enabled); await loadAdapters() }
async function uninstall(id) { if (!confirm(`Remove "${id}"?`)) return; await window.cs.uninstallAdapter(id); await loadAdapters() }
async function browsePath() { const p = await window.cs.browseFile({ directory: true }); if (p) installPath.value = p }
async function installAdapter() {
  installMsg.value = ''; installErr.value = false
  const r = await window.cs.installAdapter({ path: installPath.value })
  if (r.ok) { installMsg.value = `Installed: ${r.adapter?.name || installPath.value}`; installPath.value = ''; await loadAdapters() }
  else { installMsg.value = r.detail || r.error || 'Install failed'; installErr.value = true }
}
onMounted(loadAdapters)
</script>
<style scoped>
.view { height: 100%; display: flex; flex-direction: column; }
.view-header { display: flex; align-items: center; padding: 20px 24px 12px; border-bottom: 1px solid #1e2130; gap: 12px; }
.view-header h2 { font-size: 18px; font-weight: 700; color: #e2e8f0; flex: 1; }
.adapter-grid { flex: 1; overflow-y: auto; padding: 16px 24px; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; align-content: start; }
.placeholder { color: #475569; font-size: 14px; grid-column: 1/-1; padding: 40px 0; text-align: center; }
.adapter-card { background: #1a1d27; border: 1px solid #2d3148; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 10px; transition: border-color 0.15s; }
.adapter-card:hover { border-color: #4338ca; }
.adapter-card.disabled { opacity: 0.5; }
.card-header { display: flex; align-items: center; gap: 10px; }
.adapter-meta { flex: 1; }
.adapter-meta strong { display: block; font-size: 14px; color: #e2e8f0; }
.version { font-size: 11px; color: #64748b; }
.description { font-size: 12px; color: #64748b; line-height: 1.5; }
.card-footer { display: flex; align-items: center; justify-content: space-between; }
.task-count { font-size: 12px; color: #64748b; }
.toggle { position: relative; display: inline-block; width: 36px; height: 20px; }
.toggle input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; inset: 0; background: #334155; border-radius: 20px; cursor: pointer; transition: 0.2s; }
.toggle input:checked + .slider { background: #4f46e5; }
.slider::before { content: ''; position: absolute; height: 14px; width: 14px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.2s; }
.toggle input:checked + .slider::before { transform: translateX(16px); }
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #1a1d27; border: 1px solid #2d3148; border-radius: 16px; padding: 28px; width: 480px; display: flex; flex-direction: column; gap: 16px; }
.modal h3 { font-size: 16px; color: #e2e8f0; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; color: #94a3b8; }
.input-row { display: flex; gap: 8px; }
.input-row input { flex: 1; }
input { background: #0f1117; border: 1px solid #2d3148; border-radius: 8px; padding: 8px 12px; color: #e2e8f0; font-size: 13px; outline: none; }
input:focus { border-color: #4f46e5; }
.modal-actions { display: flex; gap: 8px; }
.msg { font-size: 12px; border-radius: 6px; padding: 6px 10px; }
.msg.ok { background: #14532d33; color: #4ade80; }
.msg.err { background: #450a0a33; color: #f87171; }
.btn { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; background: #4f46e5; color: white; transition: background 0.15s; }
.btn:hover { background: #4338ca; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-sm { padding: 5px 12px; font-size: 12px; }
.btn-ghost { background: transparent; border: 1px solid #2d3148; color: #94a3b8; }
.btn-ghost:hover { background: #1e2130; color: #e2e8f0; }
.btn-danger { background: #7f1d1d; color: #fca5a5; }
.btn-danger:hover { background: #991b1b; }
</style>
