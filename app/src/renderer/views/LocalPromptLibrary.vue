<template>
  <div class="local-prompt-library">
    <header class="lpl-head">
      <div>
        <h2>提示词库</h2>
        <p>本地 Prompt 模板，支持同步到云端审批台</p>
      </div>
      <div class="lpl-head-actions">
        <button type="button" class="lpl-secondary" :disabled="busy" @click="createLibrary">新建库</button>
        <button type="button" class="lpl-secondary" :disabled="busy" @click="chooseWorkbookForImport">
          {{ importing ? '导入中...' : '导入更新' }}
        </button>
        <button type="button" class="lpl-secondary" :disabled="busy || !selectedLibrary" @click="saveLocalEdits">保存编辑</button>
        <button type="button" class="lpl-primary" :disabled="busy || !selectedLibrary" @click="syncSelectedLibrary">
          {{ syncing ? '同步中...' : '同步到线上' }}
        </button>
      </div>
    </header>

    <p v-if="message" class="lpl-notice">{{ message }}</p>
    <p v-if="error" class="lpl-notice error">{{ error }}</p>

    <section class="lpl-toolbar">
      <label>
        <span>当前库</span>
        <select v-model="selectedLibraryUid">
          <option v-for="library in libraries" :key="library.library_uid" :value="library.library_uid">
            {{ library.name }}
          </option>
        </select>
      </label>
      <label class="wide">
        <span>库名称</span>
        <input v-model="libraryDraft.name" :disabled="!selectedLibrary" />
      </label>
      <label>
        <span>场景</span>
        <select v-model="libraryDraft.scenario" :disabled="!selectedLibrary">
          <option v-for="scenario in scenarioOptions" :key="scenario">{{ scenario }}</option>
        </select>
      </label>
      <label>
        <span>搜索</span>
        <input v-model.trim="keyword" type="search" placeholder="名称 / Prompt" />
      </label>
    </section>

    <section v-if="!selectedLibrary" class="lpl-empty">
      <strong>暂无本地提示词库</strong>
      <button type="button" class="lpl-primary" @click="createLibrary">新建库</button>
    </section>

    <section v-else class="lpl-workspace">
      <aside class="lpl-groups">
        <div class="lpl-groups-head">
          <strong>分组</strong>
          <span>{{ groupSummaries.length }} 组</span>
        </div>
        <button type="button" :class="{ active: groupFilter === 'all' }" @click="groupFilter = 'all'">
          <strong>全部</strong>
          <span>{{ templates.length }} 条</span>
        </button>
        <button
          v-for="group in groupSummaries"
          :key="group.name"
          type="button"
          :class="{ active: groupFilter === group.name }"
          @click="groupFilter = group.name"
        >
          <strong>{{ group.name }}</strong>
          <span>{{ group.enabled }} / {{ group.total }} 启用</span>
        </button>
        <div class="lpl-sync-meta">
          <span>{{ statusLabel(selectedLibrary.status) }}</span>
          <span v-if="selectedLibrary.cloud_library_id">云端 #{{ selectedLibrary.cloud_library_id }}</span>
        </div>
      </aside>

      <main class="lpl-table-panel">
        <div class="lpl-table-head">
          <div>
            <h3>Prompt 明细</h3>
            <span>{{ displayTemplates.length }} 条</span>
          </div>
          <button type="button" class="lpl-secondary" @click="addPromptRow">新增 Prompt</button>
        </div>

        <div class="lpl-edit-list">
          <article v-for="(template, index) in displayTemplates" :key="templateKey(template, index)" class="lpl-edit-row">
            <div class="lpl-row-top">
              <label class="lpl-check">
                <input v-model="template.enabled" type="checkbox" />
                <span>启用</span>
              </label>
              <label>
                <span>分组</span>
                <input v-model="template.group_name" />
              </label>
              <label>
                <span>字段名</span>
                <input v-model="template.field_name" />
              </label>
              <label class="small">
                <span>女优先</span>
                <input v-model.number="template.female_priority" type="number" />
              </label>
              <label class="small">
                <span>男/中</span>
                <input v-model.number="template.male_neutral_priority" type="number" />
              </label>
              <button type="button" class="lpl-icon danger" aria-label="删除 Prompt" @click="removePromptRow(template)">删除</button>
            </div>
            <div class="lpl-row-grid">
              <label>
                <span>尺寸</span>
                <input v-model="template.size_label" />
              </label>
              <label>
                <span>格式</span>
                <input v-model="template.output_format" />
              </label>
              <label class="wide">
                <span>引用字段</span>
                <input :value="referenceText(template)" @input="setReferenceText(template, $event.target.value)" />
              </label>
            </div>
            <label class="prompt">
              <span>Prompt</span>
              <textarea v-model="template.prompt_text" rows="4" placeholder="输入完整生图 Prompt"></textarea>
            </label>
          </article>
          <div v-if="!displayTemplates.length" class="lpl-empty inline">没有匹配的 Prompt</div>
        </div>
      </main>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import {
  DEFAULT_PROMPT_LIBRARY_NAME,
  PROMPT_SCENARIOS,
  createLocalPromptUid,
  defaultPromptTemplate,
  normalizePromptLibrary,
  normalizePromptTemplate,
  parsePromptWorkbookSheets,
} from '../utils/localPromptLibrary'

const scenarioOptions = PROMPT_SCENARIOS
const libraries = ref([])
const selectedLibraryUid = ref('')
const libraryDraft = ref({ name: DEFAULT_PROMPT_LIBRARY_NAME, scenario: PROMPT_SCENARIOS[0] })
const groupFilter = ref('all')
const keyword = ref('')
const loading = ref(false)
const saving = ref(false)
const importing = ref(false)
const syncing = ref(false)
const message = ref('')
const error = ref('')

const busy = computed(() => loading.value || saving.value || importing.value || syncing.value)
const selectedLibrary = computed(() => libraries.value.find(library => library.library_uid === selectedLibraryUid.value) || libraries.value[0] || null)
const templates = computed(() => selectedLibrary.value?.templates || [])
const groupSummaries = computed(() => {
  const groups = new Map()
  for (const template of templates.value) {
    const name = template.group_name || '未分组'
    const current = groups.get(name) || { name, total: 0, enabled: 0 }
    current.total += 1
    if (template.enabled) current.enabled += 1
    groups.set(name, current)
  }
  return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
})
const displayTemplates = computed(() => {
  const search = keyword.value.trim().toLowerCase()
  return templates.value.filter(template => {
    if (groupFilter.value !== 'all' && (template.group_name || '未分组') !== groupFilter.value) return false
    if (!search) return true
    const haystack = `${template.group_name} ${template.field_name} ${template.prompt_text}`.toLowerCase()
    return haystack.includes(search)
  })
})

watch(selectedLibraryUid, () => {
  groupFilter.value = 'all'
  syncLibraryDraft()
})

async function loadLibraries() {
  loading.value = true
  error.value = ''
  try {
    const payload = await window.cs.listLocalPromptLibraries()
    libraries.value = (Array.isArray(payload?.libraries) ? payload.libraries : []).map(normalizePromptLibrary)
    if (!libraries.value.some(library => library.library_uid === selectedLibraryUid.value)) {
      selectedLibraryUid.value = libraries.value[0]?.library_uid || ''
    }
    syncLibraryDraft()
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

async function createLibrary() {
  error.value = ''
  message.value = ''
  try {
    const response = await window.cs.createLocalPromptLibrary({
      name: DEFAULT_PROMPT_LIBRARY_NAME,
      scenario: PROMPT_SCENARIOS[0],
      templates: [{ ...defaultPromptTemplate(PROMPT_SCENARIOS[0]), local_uid: createLocalPromptUid() }],
    })
    await loadLibraries()
    selectedLibraryUid.value = response?.library?.library_uid || selectedLibraryUid.value
    syncLibraryDraft()
    message.value = '本地提示词库已创建'
  } catch (err) {
    error.value = err?.message || String(err)
  }
}

async function chooseWorkbookForImport() {
  importing.value = true
  error.value = ''
  message.value = ''
  try {
    const selected = await window.cs.browseFile({
      title: '选择提示词库 Excel',
      excel: true,
    })
    if (!selected) return
    const workbook = await window.cs.readExcel(selected, { header_row: 4 })
    if (workbook?.error) throw new Error(workbook.error)
    const parsedTemplates = parsePromptWorkbookSheets(workbook)
      .map(template => ({ ...template, local_uid: createLocalPromptUid() }))
    if (!parsedTemplates.length) throw new Error('没有识别到可导入的 Prompt 行')

    const response = await window.cs.importLocalPromptLibrary({
      library_uid: selectedLibrary.value?.library_uid || '',
      name: libraryDraft.value.name || selectedLibrary.value?.name || DEFAULT_PROMPT_LIBRARY_NAME,
      scenario: libraryDraft.value.scenario || selectedLibrary.value?.scenario || PROMPT_SCENARIOS[0],
      import_source_path: selected,
      templates: parsedTemplates,
    })
    await loadLibraries()
    selectedLibraryUid.value = response?.library?.library_uid || selectedLibraryUid.value
    syncLibraryDraft()
    message.value = `已导入更新 ${parsedTemplates.length} 条 Prompt`
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    importing.value = false
  }
}

async function saveLocalEdits() {
  if (!selectedLibrary.value) return
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    const response = await window.cs.saveLocalPromptLibrary(selectedLibrary.value.library_uid, {
      name: libraryDraft.value.name || DEFAULT_PROMPT_LIBRARY_NAME,
      scenario: libraryDraft.value.scenario || PROMPT_SCENARIOS[0],
      templates: templates.value.map(normalizePromptTemplate),
    })
    await loadLibraries()
    selectedLibraryUid.value = response?.library?.library_uid || selectedLibraryUid.value
    message.value = '本地提示词库已保存'
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    saving.value = false
  }
}

async function syncSelectedLibrary() {
  if (!selectedLibrary.value) return
  syncing.value = true
  error.value = ''
  message.value = ''
  try {
    await saveLocalEdits()
    const response = await window.cs.syncLocalPromptLibraryToCloud(selectedLibrary.value.library_uid)
    await loadLibraries()
    selectedLibraryUid.value = response?.library?.library_uid || selectedLibraryUid.value
    const cloudId = response?.cloud?.library?.id || response?.library?.cloud_library_id
    message.value = cloudId ? `已同步到云端提示词库 #${cloudId}` : '已同步到云端提示词库'
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    syncing.value = false
  }
}

function syncLibraryDraft() {
  if (!selectedLibrary.value) {
    libraryDraft.value = { name: DEFAULT_PROMPT_LIBRARY_NAME, scenario: PROMPT_SCENARIOS[0] }
    return
  }
  libraryDraft.value = {
    name: selectedLibrary.value.name,
    scenario: selectedLibrary.value.scenario || PROMPT_SCENARIOS[0],
  }
}

function addPromptRow() {
  if (!selectedLibrary.value) return
  const groupName = groupFilter.value !== 'all'
    ? groupFilter.value
    : templates.value[0]?.group_name || selectedLibrary.value.scenario || PROMPT_SCENARIOS[0]
  selectedLibrary.value.templates.unshift({
    ...defaultPromptTemplate(groupName),
    local_uid: createLocalPromptUid(),
    field_name: '',
    prompt_text: '',
  })
}

function removePromptRow(template) {
  if (!selectedLibrary.value) return
  selectedLibrary.value.templates = selectedLibrary.value.templates.filter(row => row !== template)
}

function templateKey(template, index) {
  return template.local_uid || `${template.group_name}-${template.field_name}-${index}`
}

function referenceText(template) {
  return Array.isArray(template.reference_fields) ? template.reference_fields.join('，') : String(template.reference_fields || '')
}

function setReferenceText(template, value) {
  template.reference_fields = String(value || '').split(/[,\n，、；;]/).map(item => item.trim()).filter(Boolean)
}

function statusLabel(status) {
  if (status === 'synced') return '已同步'
  if (status === 'draft') return '本地草稿'
  return status || '本地草稿'
}

onMounted(loadLibraries)
</script>

<style scoped>
.local-prompt-library {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.lpl-head,
.lpl-toolbar,
.lpl-table-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.lpl-head {
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border);
}

.lpl-head h2,
.lpl-head p,
.lpl-table-head h3,
.lpl-table-head span {
  margin: 0;
}

.lpl-head h2 {
  font-size: 18px;
  font-weight: 800;
}

.lpl-head p,
.lpl-table-head span,
.lpl-groups-head span,
.lpl-sync-meta,
.lpl-empty {
  color: var(--text2);
  font-size: 12px;
}

.lpl-head-actions,
.lpl-row-top,
.lpl-row-grid {
  display: flex;
  align-items: end;
  gap: 8px;
}

.lpl-primary,
.lpl-secondary,
.lpl-icon,
.lpl-groups button {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text2);
  padding: 8px 12px;
  font-size: 12px;
  white-space: nowrap;
}

.lpl-primary {
  border-color: rgba(255, 107, 43, .48);
  background: var(--orange);
  color: #fff;
  font-weight: 700;
}

.lpl-primary:disabled,
.lpl-secondary:disabled {
  cursor: not-allowed;
  opacity: .6;
}

.lpl-icon.danger {
  color: #fca5a5;
}

.lpl-notice {
  margin: 10px 24px 0;
  border: 1px solid rgba(74, 222, 128, .35);
  border-radius: 8px;
  background: rgba(74, 222, 128, .08);
  color: #bbf7d0;
  padding: 9px 12px;
}

.lpl-notice.error {
  border-color: rgba(248, 113, 113, .42);
  background: rgba(248, 113, 113, .08);
  color: #fecaca;
}

.lpl-toolbar {
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(240px, 1fr) minmax(120px, 150px) minmax(180px, 240px);
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
}

.lpl-toolbar label,
.lpl-edit-row label {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.lpl-toolbar span,
.lpl-edit-row label span,
.lpl-check span {
  color: var(--text2);
  font-size: 12px;
}

.lpl-toolbar input,
.lpl-toolbar select,
.lpl-edit-row input,
.lpl-edit-row textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  padding: 8px 10px;
  font-size: 13px;
  outline: none;
}

.lpl-toolbar input:focus,
.lpl-toolbar select:focus,
.lpl-edit-row input:focus,
.lpl-edit-row textarea:focus {
  border-color: var(--orange);
}

.lpl-empty {
  display: grid;
  place-items: center;
  gap: 12px;
  min-height: 220px;
}

.lpl-empty.inline {
  min-height: 90px;
}

.lpl-workspace {
  flex: 1 1 0;
  min-height: 0;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 14px;
  padding: 14px 24px 20px;
}

.lpl-groups {
  align-self: start;
  display: grid;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  padding: 12px;
}

.lpl-groups-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 6px;
}

.lpl-groups button {
  display: grid;
  gap: 4px;
  width: 100%;
  text-align: left;
}

.lpl-groups button.active,
.lpl-groups button:hover {
  border-color: rgba(255, 107, 43, .52);
  background: var(--orange-bg);
  color: var(--orange);
}

.lpl-sync-meta {
  display: grid;
  gap: 4px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
}

.lpl-table-panel {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
}

.lpl-table-head {
  padding: 13px 14px;
  border-bottom: 1px solid var(--border);
}

.lpl-table-head > div {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.lpl-edit-list {
  height: calc(100% - 55px);
  min-height: 0;
  overflow: auto;
  display: grid;
  align-content: start;
  gap: 10px;
  padding: 14px;
}

.lpl-edit-row {
  display: grid;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  padding: 12px;
}

.lpl-row-top {
  display: grid;
  grid-template-columns: 72px minmax(110px, 150px) minmax(160px, 1fr) 88px 88px auto;
}

.lpl-row-grid {
  display: grid;
  grid-template-columns: minmax(90px, 130px) minmax(90px, 130px) minmax(0, 1fr);
}

.lpl-check {
  display: flex !important;
  align-items: center;
  gap: 7px;
  min-height: 36px;
}

.lpl-check input {
  width: 14px;
  accent-color: var(--orange);
}

.prompt textarea {
  resize: vertical;
  min-height: 88px;
  line-height: 1.5;
}

@media (max-width: 1080px) {
  .lpl-workspace {
    grid-template-columns: 1fr;
  }

  .lpl-groups {
    position: static;
  }

  .lpl-row-top,
  .lpl-row-grid,
  .lpl-toolbar {
    grid-template-columns: 1fr;
  }
}
</style>
