<template>
  <div class="local-prompt-library">
    <header class="lpl-head">
      <div>
        <h2>提示词库</h2>
        <p>本地和线上 Prompt 模板，支持同步、预览和云端管理</p>
      </div>
      <div class="lpl-head-actions">
        <button type="button" class="lpl-secondary" :disabled="busy" @click="openCloudApprovalLogin">登录云端审批平台</button>
        <button type="button" class="lpl-secondary" :disabled="cloudLoading" @click="loadCloudLibraries">
          {{ cloudLoading ? '读取线上...' : '刷新线上' }}
        </button>
        <button type="button" class="lpl-secondary" :disabled="!cloudPromptManageUrl" @click="openCloudPromptManager">打开云端 Prompt 管理</button>
        <template v-if="isListView">
          <button type="button" class="lpl-primary" :disabled="busy" @click="createLibrary">新建库</button>
        </template>
        <template v-else>
          <button type="button" class="lpl-secondary" @click="backToLibraryList">返回列表</button>
          <button type="button" class="lpl-secondary" :disabled="busy || !selectedLocalLibrary" @click="chooseWorkbookForImport">
            {{ importing ? '导入中...' : '导入更新' }}
          </button>
          <button type="button" class="lpl-secondary" :disabled="busy || !selectedLocalLibrary" @click="saveLocalEdits">保存编辑</button>
          <button type="button" class="lpl-primary" :disabled="busy || !selectedLocalLibrary" @click="syncSelectedLibrary">
            {{ syncing ? '同步中...' : '同步到线上' }}
          </button>
        </template>
      </div>
    </header>

    <p v-if="message" class="lpl-notice">{{ message }}</p>
    <p v-if="error" class="lpl-notice error">{{ error }}</p>
    <p v-if="cloudError" class="lpl-notice warning">{{ cloudError }}</p>

    <section v-if="isListView" class="lpl-library-list">
      <div class="lpl-library-list-head">
        <div>
          <h3>提示词库列表</h3>
          <p>{{ libraries.length }} 个库，本地 {{ localLibraries.length }} 个，线上 {{ cloudLibraries.length }} 个</p>
        </div>
        <button type="button" class="lpl-primary" :disabled="busy" @click="createLibrary">新建库</button>
      </div>
      <div class="lpl-library-table">
        <div class="lpl-library-header" role="row">
          <span>提示词库名称</span>
          <span>当前 Prompt 数量</span>
          <span>创建时间</span>
          <span>来源</span>
          <span>操作</span>
        </div>
        <div class="lpl-library-body">
          <div v-for="library in libraryRows" :key="library.library_uid" class="lpl-library-row">
            <div class="lpl-library-name">
              <strong>{{ library.name }}</strong>
              <span>{{ library.scenario }} · {{ statusLabel(library.status) }}</span>
            </div>
            <div>{{ templateCount(library) }} 条</div>
            <div>{{ formatDateTime(library.created_at || library.updated_at) }}</div>
            <div><span class="lpl-source-badge">{{ librarySourceLabel(library.source_type) }}</span></div>
            <div class="lpl-library-actions">
              <button type="button" class="lpl-secondary" @click="enterLibraryDetail(library)">进入编辑</button>
            </div>
          </div>
        </div>
      </div>
      <div v-if="!libraries.length" class="lpl-empty inline">
        <strong>暂无提示词库</strong>
        <button type="button" class="lpl-primary" @click="createLibrary">新建库</button>
      </div>
    </section>

    <section v-else-if="!selectedLibrary" class="lpl-empty">
      <strong>未选择提示词库</strong>
      <button type="button" class="lpl-secondary" @click="backToLibraryList">返回列表</button>
    </section>

    <section v-else class="lpl-detail">
      <section class="lpl-toolbar">
        <label class="wide">
          <span>库名称</span>
          <input v-model="libraryDraft.name" :disabled="!selectedLocalLibrary" />
        </label>
        <label>
          <span>场景</span>
          <select v-model="libraryDraft.scenario" :disabled="!selectedLocalLibrary">
            <option v-for="scenario in scenarioOptions" :key="scenario">{{ scenario }}</option>
          </select>
        </label>
        <label>
          <span>搜索</span>
          <input v-model.trim="keyword" type="search" placeholder="名称 / Prompt" />
        </label>
      </section>

      <section class="lpl-workspace">
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
          <span class="lpl-source-badge">{{ librarySourceLabel(selectedLibrary.source_type) }}</span>
          <span>{{ statusLabel(selectedLibrary.status) }}</span>
          <span v-if="selectedLibrary.cloud_library_id">云端 #{{ selectedLibrary.cloud_library_id }}</span>
        </div>
      </aside>

      <main class="lpl-table-panel">
        <div class="lpl-table-head">
          <div>
            <h3>Prompt 明细</h3>
            <span class="lpl-source-badge">{{ librarySourceLabel(selectedLibrary.source_type) }}</span>
            <span>{{ displayTemplates.length }} 条</span>
          </div>
          <button v-if="selectedCloudLibrary" type="button" class="lpl-secondary" @click="copyCloudLibraryToLocal">保存为本地副本</button>
          <button v-else type="button" class="lpl-secondary" @click="addPromptRow">新增 Prompt</button>
        </div>

        <div class="lpl-edit-list">
          <div class="lpl-template-table">
            <div class="lpl-template-header" role="row">
              <span>状态</span>
              <span>分组</span>
              <span>字段名</span>
              <span>女优先</span>
              <span>男/中</span>
              <span>Prompt</span>
              <span>操作</span>
            </div>
            <div class="lpl-template-body">
              <div v-for="(template, index) in displayTemplates" :key="templateKey(template, index)" class="lpl-template-row" :class="{ disabled: !template.enabled }">
                <div class="lpl-template-cell status">
                  <label class="lpl-switch" :class="{ readonly: !selectedLocalLibrary }">
                    <input v-model="template.enabled" type="checkbox" :disabled="!selectedLocalLibrary" aria-label="启用 Prompt" />
                    <span class="lpl-switch-track" aria-hidden="true"></span>
                    <strong>{{ template.enabled ? '启用' : '停用' }}</strong>
                  </label>
                </div>
                <div class="lpl-template-cell">
                  <input v-model="template.group_name" :disabled="!selectedLocalLibrary" aria-label="分组" />
                </div>
                <div class="lpl-template-cell">
                  <input v-model="template.field_name" :disabled="!selectedLocalLibrary" aria-label="字段名" />
                </div>
                <div class="lpl-template-cell compact">
                  <input v-model.number="template.female_priority" type="number" :disabled="!selectedLocalLibrary" aria-label="女优先" />
                </div>
                <div class="lpl-template-cell compact">
                  <input v-model.number="template.male_neutral_priority" type="number" :disabled="!selectedLocalLibrary" aria-label="男/中优先" />
                </div>
                <div class="lpl-template-cell prompt">
                  <textarea
                    ref="promptTextareas"
                    v-model="template.prompt_text"
                    rows="2"
                    :disabled="!selectedLocalLibrary"
                    aria-label="Prompt"
                    placeholder="输入完整生图 Prompt"
                    @input="resizePromptTextarea"
                  ></textarea>
                </div>
                <div class="lpl-template-cell action">
                  <button type="button" class="lpl-icon danger" :disabled="!selectedLocalLibrary" aria-label="删除 Prompt" @click="removePromptRow(template)">删除</button>
                </div>
              </div>
            </div>
          </div>
          <div v-if="!displayTemplates.length" class="lpl-empty inline">没有匹配的 Prompt</div>
        </div>
      </main>
      </section>
    </section>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUpdated, ref, watch } from 'vue'
import {
  DEFAULT_PROMPT_LIBRARY_NAME,
  PROMPT_IMPORT_HEADER_ROWS,
  PROMPT_SCENARIOS,
  createLocalPromptUid,
  defaultPromptTemplate,
  normalizePromptLibrary,
  normalizePromptTemplate,
  parsePromptWorkbookImportCandidates,
} from '../utils/localPromptLibrary'

const emit = defineEmits(['open-cloud-approval'])
const scenarioOptions = PROMPT_SCENARIOS
const localLibraries = ref([])
const cloudLibraries = ref([])
const selectedLibraryUid = ref('')
const viewMode = ref('list')
const libraryDraft = ref({ name: DEFAULT_PROMPT_LIBRARY_NAME, scenario: PROMPT_SCENARIOS[0] })
const groupFilter = ref('all')
const keyword = ref('')
const loading = ref(false)
const cloudLoading = ref(false)
const saving = ref(false)
const importing = ref(false)
const syncing = ref(false)
const message = ref('')
const error = ref('')
const cloudError = ref('')
const cloudStatus = ref(null)
const promptTextareas = ref([])

const busy = computed(() => loading.value || saving.value || importing.value || syncing.value)
const libraries = computed(() => [...localLibraries.value, ...cloudLibraries.value])
const libraryRows = computed(() => [...libraries.value].sort((left, right) => {
  const rightTime = Date.parse(right.created_at || right.updated_at || '') || 0
  const leftTime = Date.parse(left.created_at || left.updated_at || '') || 0
  return rightTime - leftTime || String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN')
}))
const isListView = computed(() => viewMode.value === 'list')
const selectedLibrary = computed(() => selectedLibraryUid.value ? libraries.value.find(library => library.library_uid === selectedLibraryUid.value) || null : null)
const selectedLocalLibrary = computed(() => selectedLibrary.value?.source_type === 'local' ? selectedLibrary.value : null)
const selectedCloudLibrary = computed(() => selectedLibrary.value?.source_type === 'cloud' ? selectedLibrary.value : null)
const templates = computed(() => selectedLibrary.value?.templates || [])
const cloudBaseUrl = computed(() => String(cloudStatus.value?.base_url || '').trim())
const cloudPromptManageUrl = computed(() => buildCloudPromptManageUrl(cloudBaseUrl.value))
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

watch(displayTemplates, resizePromptTextareas, { flush: 'post' })

async function loadLibraries() {
  loading.value = true
  error.value = ''
  try {
    await loadLocalLibraries()
    await refreshCloudApprovalStatus()
    await loadCloudLibraries({ silent: true })
    ensureSelectedLibrary()
    syncLibraryDraft()
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

async function loadLocalLibraries() {
  const payload = await window.cs.listLocalPromptLibraries()
  localLibraries.value = (Array.isArray(payload?.libraries) ? payload.libraries : [])
    .map(library => normalizePromptLibrary({ ...library, source_type: 'local' }))
}

async function refreshCloudApprovalStatus() {
  try {
    cloudStatus.value = await window.cs.getCloudApprovalStatus()
  } catch {
    cloudStatus.value = null
  }
}

async function loadCloudLibraries(options = {}) {
  cloudLoading.value = true
  if (!options.silent) {
    cloudError.value = ''
    message.value = ''
  }
  try {
    await refreshCloudApprovalStatus()
    if (!cloudBaseUrl.value) {
      cloudLibraries.value = []
      cloudError.value = '尚未配置云端审批地址，可先进入云端审批页面完成配置和登录'
      return
    }
    const payload = await window.cs.listCloudPromptLibraries()
    cloudLibraries.value = (Array.isArray(payload?.libraries) ? payload.libraries : [])
      .map(library => normalizePromptLibrary({ ...library, source_type: 'cloud' }))
    cloudError.value = ''
    if (!options.silent) message.value = `已读取 ${cloudLibraries.value.length} 个线上提示词库`
  } catch (err) {
    cloudLibraries.value = []
    cloudError.value = err?.message || String(err)
  } finally {
    cloudLoading.value = false
    ensureSelectedLibrary()
    syncLibraryDraft()
  }
}

function ensureSelectedLibrary() {
  if (selectedLibraryUid.value && !libraries.value.some(library => library.library_uid === selectedLibraryUid.value)) {
    selectedLibraryUid.value = ''
    viewMode.value = 'list'
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
    await loadLocalLibraries()
    selectedLibraryUid.value = response?.library?.library_uid || selectedLibraryUid.value
    viewMode.value = 'detail'
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
    const importResult = await readPromptWorkbookTemplates(selected)
    const parsedTemplates = importResult.templates
      .map(template => ({ ...template, local_uid: createLocalPromptUid() }))
    if (!parsedTemplates.length) {
      throw new Error(`没有识别到可导入的 Prompt 行（已尝试第 ${PROMPT_IMPORT_HEADER_ROWS.join('、')} 行作为表头）`)
    }

    const response = await window.cs.importLocalPromptLibrary({
      library_uid: selectedLocalLibrary.value?.library_uid || '',
      name: libraryDraft.value.name || selectedLocalLibrary.value?.name || DEFAULT_PROMPT_LIBRARY_NAME,
      scenario: libraryDraft.value.scenario || selectedLocalLibrary.value?.scenario || PROMPT_SCENARIOS[0],
      import_source_path: selected,
      templates: parsedTemplates,
    })
    await loadLocalLibraries()
    selectedLibraryUid.value = response?.library?.library_uid || selectedLibraryUid.value
    viewMode.value = 'detail'
    syncLibraryDraft()
    const headerText = importResult.header_row ? `（表头第 ${importResult.header_row} 行）` : ''
    message.value = `已导入更新 ${parsedTemplates.length} 条 Prompt${headerText}`
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    importing.value = false
  }
}

async function readPromptWorkbookTemplates(selected) {
  const candidates = []
  for (const headerRow of PROMPT_IMPORT_HEADER_ROWS) {
    const workbook = await window.cs.readExcel(selected, { header_row: headerRow })
    if (workbook?.error) throw new Error(workbook.error)
    candidates.push({ header_row: headerRow, workbook })

    const result = parsePromptWorkbookImportCandidates(candidates)
    if (result.templates.length) return result
  }
  return parsePromptWorkbookImportCandidates(candidates)
}

async function saveLocalEdits() {
  if (!selectedLocalLibrary.value) return
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    const response = await window.cs.saveLocalPromptLibrary(selectedLocalLibrary.value.library_uid, {
      name: libraryDraft.value.name || DEFAULT_PROMPT_LIBRARY_NAME,
      scenario: libraryDraft.value.scenario || PROMPT_SCENARIOS[0],
      templates: templates.value.map(normalizePromptTemplate),
    })
    await loadLocalLibraries()
    selectedLibraryUid.value = response?.library?.library_uid || selectedLibraryUid.value
    viewMode.value = 'detail'
    message.value = '本地提示词库已保存'
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    saving.value = false
  }
}

async function syncSelectedLibrary() {
  if (!selectedLocalLibrary.value) return
  syncing.value = true
  error.value = ''
  message.value = ''
  try {
    await saveLocalEdits()
    const response = await window.cs.syncLocalPromptLibraryToCloud(selectedLocalLibrary.value.library_uid)
    await loadLocalLibraries()
    await loadCloudLibraries({ silent: true })
    selectedLibraryUid.value = response?.library?.library_uid || selectedLibraryUid.value
    viewMode.value = 'detail'
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
  if (!selectedLocalLibrary.value) return
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
  if (!selectedLocalLibrary.value) return
  selectedLocalLibrary.value.templates = selectedLocalLibrary.value.templates.filter(row => row !== template)
}

async function copyCloudLibraryToLocal() {
  if (!selectedCloudLibrary.value) return
  error.value = ''
  message.value = ''
  try {
    const cloudLibrary = selectedCloudLibrary.value
    const cloudTemplates = Array.isArray(selectedCloudLibrary.value.templates) ? selectedCloudLibrary.value.templates : []
    if (!cloudTemplates.length) throw new Error('线上库没有可复制的 Prompt 模板')
    const response = await window.cs.createLocalPromptLibrary({
      name: `${cloudLibrary.name} 本地副本`,
      scenario: cloudLibrary.scenario || PROMPT_SCENARIOS[0],
      templates: cloudTemplates.map(template => ({
        ...normalizePromptTemplate(template),
        local_uid: createLocalPromptUid(),
      })),
    })
    await loadLocalLibraries()
    selectedLibraryUid.value = response?.library?.library_uid || selectedLibraryUid.value
    viewMode.value = 'detail'
    syncLibraryDraft()
    message.value = `已保存为本地副本：${cloudTemplates.length} 条 Prompt`
  } catch (err) {
    error.value = err?.message || String(err)
  }
}

function openCloudApprovalLogin() {
  emit('open-cloud-approval')
}

function enterLibraryDetail(library) {
  selectedLibraryUid.value = library?.library_uid || ''
  viewMode.value = 'detail'
  groupFilter.value = 'all'
  syncLibraryDraft()
  resizePromptTextareas()
}

function backToLibraryList() {
  viewMode.value = 'list'
  keyword.value = ''
}

async function openCloudPromptManager() {
  const url = cloudPromptManageUrl.value
  if (!url) return
  try {
    await window.cs.openExternalUrl(url)
  } catch (err) {
    error.value = err?.message || String(err)
  }
}

function templateKey(template, index) {
  return template.local_uid || `${template.group_name}-${template.field_name}-${index}`
}

function templateCount(library) {
  return Array.isArray(library?.templates) ? library.templates.length : 0
}

function formatDateTime(value) {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function resizePromptTextarea(eventOrTextarea) {
  const textarea = eventOrTextarea?.target || eventOrTextarea
  if (!textarea?.style) return
  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
}

function resizePromptTextareas() {
  nextTick(() => {
    for (const textarea of promptTextareas.value.flat()) {
      resizePromptTextarea(textarea)
    }
  })
}

function statusLabel(status) {
  if (status === 'synced') return '已同步'
  if (status === 'published') return '已发布'
  if (status === 'draft') return '本地草稿'
  return status || '本地草稿'
}

function librarySourceLabel(sourceType) {
  return sourceType === 'cloud' ? '线上' : '本地'
}

function buildCloudPromptManageUrl(baseUrl) {
  const text = String(baseUrl || '').trim()
  if (!text) return ''
  try {
    const url = new URL(text)
    url.searchParams.set('page', 'prompts')
    return url.toString()
  } catch {
    return ''
  }
}

onMounted(async () => {
  await loadLibraries()
  resizePromptTextareas()
})

onUpdated(resizePromptTextareas)
</script>

<style scoped>
.local-prompt-library {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}

.lpl-head,
.lpl-toolbar,
.lpl-table-head,
.lpl-library-list-head {
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
.lpl-table-head span,
.lpl-library-list-head h3,
.lpl-library-list-head p {
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

.lpl-head-actions {
  display: flex;
  align-items: end;
  gap: 8px;
}

.lpl-head-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
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
  cursor: pointer;
}

.lpl-primary {
  border-color: rgba(255, 107, 43, .48);
  background: var(--orange);
  color: #fff;
  font-weight: 700;
}

.lpl-secondary {
  border-color: rgba(255, 255, 255, .18);
  background: rgba(255, 255, 255, .08);
  color: var(--text);
  font-weight: 700;
}

.lpl-secondary:hover {
  border-color: rgba(255, 107, 43, .48);
  background: rgba(255, 107, 43, .12);
}

.lpl-primary:disabled,
.lpl-secondary:disabled {
  cursor: not-allowed;
  opacity: .55;
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

.lpl-notice.warning {
  border-color: rgba(251, 191, 36, .38);
  background: rgba(251, 191, 36, .08);
  color: #fde68a;
}

.lpl-source-badge {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 22px;
  border: 1px solid rgba(148, 163, 184, .32);
  border-radius: 999px;
  background: rgba(148, 163, 184, .1);
  color: #cbd5e1;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 750;
}

.lpl-toolbar {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(120px, 150px) minmax(180px, 240px);
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
}

.lpl-toolbar label {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.lpl-toolbar span {
  color: var(--text2);
  font-size: 12px;
}

.lpl-toolbar input,
.lpl-toolbar select,
.lpl-template-cell input,
.lpl-template-cell textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  padding: 7px 9px;
  font-size: 13px;
  outline: none;
}

.lpl-toolbar input:focus,
.lpl-toolbar select:focus,
.lpl-template-cell input:focus,
.lpl-template-cell textarea:focus {
  border-color: var(--orange);
}

.lpl-toolbar input:disabled,
.lpl-toolbar select:disabled,
.lpl-template-cell input:disabled,
.lpl-template-cell textarea:disabled,
.lpl-icon:disabled {
  cursor: not-allowed;
  opacity: .68;
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

.lpl-library-list,
.lpl-detail {
  flex: 1 1 0;
  min-height: 0;
}

.lpl-library-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 24px 20px;
}

.lpl-library-list-head {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  padding: 13px 14px;
}

.lpl-library-list-head h3 {
  font-size: 15px;
}

.lpl-library-list-head p,
.lpl-library-name span {
  color: var(--text2);
  font-size: 12px;
}

.lpl-library-table {
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
}

.lpl-library-header,
.lpl-library-row {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) 150px 190px 110px 110px;
  align-items: center;
}

.lpl-library-header {
  position: sticky;
  top: 0;
  z-index: 1;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg2) 88%, #000 12%);
}

.lpl-library-header span,
.lpl-library-row > div {
  padding: 10px 12px;
}

.lpl-library-header span {
  color: var(--text2);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.lpl-library-row {
  min-height: 60px;
  border-bottom: 1px solid var(--border);
}

.lpl-library-row:last-child {
  border-bottom: none;
}

.lpl-library-row:hover {
  background: rgba(255, 255, 255, .018);
}

.lpl-library-row > div {
  min-width: 0;
  color: var(--text);
  font-size: 13px;
}

.lpl-library-name {
  display: grid;
  gap: 4px;
}

.lpl-library-name strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lpl-library-actions {
  display: flex;
  justify-content: flex-end;
}

.lpl-detail {
  display: flex;
  flex-direction: column;
}

.lpl-workspace {
  flex: 1 1 0;
  min-height: 0;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 14px;
  overflow: hidden;
  padding: 14px 24px 20px;
}

.lpl-groups {
  align-self: stretch;
  min-height: 0;
  display: grid;
  gap: 8px;
  overflow-y: auto;
  overscroll-behavior: contain;
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
  display: flex;
  flex-direction: column;
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
  flex-wrap: wrap;
  gap: 10px;
}

.lpl-edit-list {
  flex: 1 1 0;
  height: auto;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 14px;
}

.lpl-template-table {
  min-width: 1120px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg);
}

.lpl-template-header,
.lpl-template-row {
  display: grid;
  grid-template-columns: 92px minmax(120px, 150px) minmax(190px, 240px) 76px 76px minmax(420px, 1fr) 76px;
  align-items: stretch;
}

.lpl-template-header {
  position: sticky;
  top: 0;
  z-index: 1;
  background: color-mix(in srgb, var(--bg2) 88%, #000 12%);
  border-bottom: 1px solid var(--border);
}

.lpl-template-header span {
  color: var(--text2);
  font-size: 12px;
  font-weight: 800;
  padding: 9px 10px;
  white-space: nowrap;
}

.lpl-template-row {
  border-bottom: 1px solid var(--border);
  transition: background .14s ease, opacity .14s ease;
}

.lpl-template-row:last-child {
  border-bottom: none;
}

.lpl-template-row:hover {
  background: rgba(255, 255, 255, .018);
}

.lpl-template-row.disabled {
  opacity: .64;
}

.lpl-template-cell {
  min-width: 0;
  display: flex;
  align-items: center;
  border-right: 1px solid var(--border);
  padding: 7px 8px;
}

.lpl-template-cell:last-child {
  border-right: none;
}

.lpl-template-cell.compact input {
  text-align: center;
}

.lpl-template-cell.prompt {
  align-items: stretch;
}

.lpl-template-cell.prompt textarea {
  min-height: 54px;
  overflow: hidden;
  resize: none;
  line-height: 1.45;
}

.lpl-template-cell.action {
  justify-content: center;
}

.lpl-switch {
  display: inline-grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  color: var(--text2);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.lpl-switch.readonly {
  cursor: not-allowed;
}

.lpl-switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.lpl-switch-track {
  position: relative;
  width: 32px;
  height: 18px;
  border: 1px solid rgba(148, 163, 184, .4);
  border-radius: 999px;
  background: rgba(148, 163, 184, .18);
  transition: background .16s ease, border-color .16s ease;
}

.lpl-switch-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: #cbd5e1;
  transition: transform .16s ease, background .16s ease;
}

.lpl-switch input:checked + .lpl-switch-track {
  border-color: rgba(255, 107, 43, .72);
  background: rgba(255, 107, 43, .3);
}

.lpl-switch input:checked + .lpl-switch-track::after {
  transform: translateX(14px);
  background: #fff;
}

.lpl-switch strong {
  overflow: hidden;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1080px) {
  .lpl-workspace {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .lpl-groups {
    position: static;
    max-height: min(180px, 30vh);
  }

  .lpl-toolbar {
    grid-template-columns: 1fr;
  }

  .lpl-library-list-head {
    align-items: flex-start;
  }

  .lpl-library-header {
    display: none;
  }

  .lpl-library-row {
    grid-template-columns: 1fr;
    align-items: start;
  }

  .lpl-library-actions {
    justify-content: flex-start;
  }

  .lpl-template-table {
    min-width: 0;
  }

  .lpl-template-header {
    display: none;
  }

  .lpl-template-row {
    grid-template-columns: 1fr;
  }

  .lpl-template-cell {
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .lpl-template-cell:last-child {
    border-bottom: none;
  }
}
</style>
