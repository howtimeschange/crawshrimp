<script setup lang="ts">
import { computed, nextTick, onMounted, onUpdated, ref, watch } from 'vue'

import { apiGet, apiPatch, apiPost, type ApiError } from '../api'
import { exportPromptWorkbook, parsePromptWorkbook, type PromptTemplateExcelRow } from '../promptExcel'

interface PromptTemplate extends PromptTemplateExcelRow {
  id?: number
  library_id?: number
  quality: string
  category_rules: string[]
  gender_rules: string[]
  priority: number
  updated_at?: string
}

interface PromptLibrary {
  id: number
  name: string
  scenario: string
  status: string
  created_at?: string
  updated_at?: string
  templates: PromptTemplate[]
}

type ViewMode = 'list' | 'detail'

const libraries = ref<PromptLibrary[]>([])
const selectedLibraryId = ref<number | null>(null)
const viewMode = ref<ViewMode>('list')
const message = ref('')
const error = ref('')
const importing = ref(false)
const saving = ref(false)
const savingLibrary = ref(false)
const publishing = ref(false)
const creatingLibrary = ref(false)
const groupFilter = ref('all')
const keyword = ref('')
const newLibrary = ref({ name: 'AI 测图提示词库 默认版', scenario: '裂变图' })
const libraryDraft = ref({ name: '', scenario: '裂变图' })
const fileInput = ref<HTMLInputElement | null>(null)
const promptTextareas = ref<HTMLTextAreaElement[]>([])
const props = defineProps<{ permissions?: string[] }>()
const scenarioOptions = ['裂变图', '创意拍摄']

const selectedLibrary = computed(() => libraries.value.find((library) => library.id === selectedLibraryId.value) ?? null)
const editableTemplates = computed(() => selectedLibrary.value?.templates ?? [])
const canEditPrompts = computed(() => props.permissions?.includes('prompts:write') ?? false)
const isListView = computed(() => viewMode.value === 'list')
const enabledTemplateCount = computed(() => editableTemplates.value.filter((template) => template.enabled).length)
const cloudLibraryRows = computed(() => [...libraries.value].sort((left, right) => {
  const rightTime = Date.parse(right.created_at || right.updated_at || '') || 0
  const leftTime = Date.parse(left.created_at || left.updated_at || '') || 0
  return rightTime - leftTime || String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN')
}))
const groupSummaries = computed(() => {
  const groups = new Map<string, { name: string; total: number; enabled: number }>()
  for (const template of editableTemplates.value) {
    const name = template.group_name || '未分组'
    const current = groups.get(name) ?? { name, total: 0, enabled: 0 }
    current.total += 1
    if (template.enabled) current.enabled += 1
    groups.set(name, current)
  }
  return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
})
const displayTemplates = computed(() => {
  const search = keyword.value.trim().toLowerCase()
  return editableTemplates.value.filter((template) => {
    if (groupFilter.value !== 'all' && (template.group_name || '未分组') !== groupFilter.value) return false
    if (!search) return true
    const haystack = `${template.group_name} ${template.field_name} ${template.prompt_text}`.toLowerCase()
    return haystack.includes(search)
  })
})
const activeLibraryMeta = computed(() => {
  if (isListView.value) return `${libraries.value.length} 个线上库，发布后可用于 AI 测图任务`
  if (!selectedLibrary.value) return '导入或创建 Prompt 库后开始维护模板'
  return `${selectedLibrary.value.scenario} · ${statusLabel(selectedLibrary.value.status)} · ${editableTemplates.value.length} 条字段，${enabledTemplateCount.value} 条启用`
})

watch(selectedLibraryId, () => {
  groupFilter.value = 'all'
  syncLibraryDraft()
})

watch(displayTemplates, resizePromptTextareas, { flush: 'post' })

async function load() {
  try {
    const previousId = selectedLibraryId.value
    const data = await apiGet<{ libraries: PromptLibrary[] }>('/api/prompt-libraries')
    libraries.value = data.libraries.map((library) => ({
      ...library,
      templates: library.templates.map(normalizeTemplate),
    }))
    if (previousId && libraries.value.some((library) => library.id === previousId)) {
      selectedLibraryId.value = previousId
    } else {
      selectedLibraryId.value = null
      viewMode.value = 'list'
    }
    syncLibraryDraft()
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function createLibrary() {
  if (!canEditPrompts.value) {
    error.value = '当前账号没有 Prompt 编辑权限'
    return
  }
  error.value = ''
  try {
    const response = await apiPost<{ library: { id: number } }>('/api/prompt-libraries', {
      ...newLibrary.value,
      templates: [{
        group_name: '上装',
        field_name: '正面标准站姿',
        prompt_text: '保留商品主体与版型，生成适合测图的电商主图。',
        size_label: '2K',
        output_format: 'jpeg',
        quality: 'auto',
        category_rules: [],
        gender_rules: [],
        priority: 10,
        enabled: true,
      }],
    })
    message.value = 'Prompt 库已创建'
    creatingLibrary.value = false
    await load()
    selectedLibraryId.value = response.library.id
    viewMode.value = 'detail'
    syncLibraryDraft()
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function importWorkbook(event: Event) {
  if (!canEditPrompts.value) {
    error.value = '当前账号没有 Prompt 导入权限'
    return
  }
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  importing.value = true
  error.value = ''
  try {
    const rows = await parsePromptWorkbook(file)
    const response = await apiPost<{ library: { id: number } }>('/api/prompt-libraries/import', {
      name: newLibrary.value.name || libraryDraft.value.name || 'AI 测图提示词库 默认版',
      scenario: newLibrary.value.scenario,
      templates: rows,
    })
    message.value = `已导入 ${rows.length} 条 Prompt 字段`
    creatingLibrary.value = false
    await load()
    selectedLibraryId.value = response.library.id
    viewMode.value = 'detail'
    syncLibraryDraft()
  } catch (caught) {
    error.value = (caught as ApiError).message || 'Excel 导入失败'
  } finally {
    importing.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function saveLibraryMeta() {
  if (!selectedLibrary.value) return
  if (!canEditPrompts.value) {
    error.value = '当前账号没有 Prompt 库管理权限'
    return
  }
  savingLibrary.value = true
  error.value = ''
  try {
    await apiPatch(`/api/prompt-libraries/${selectedLibrary.value.id}`, {
      name: libraryDraft.value.name,
      scenario: libraryDraft.value.scenario,
    })
    message.value = '库信息已保存，当前版本已回到草稿'
    await load()
  } catch (caught) {
    error.value = (caught as ApiError).message
  } finally {
    savingLibrary.value = false
  }
}

async function saveTable() {
  if (!selectedLibrary.value) return
  if (!canEditPrompts.value) {
    error.value = '当前账号没有 Prompt 编辑权限'
    return
  }
  saving.value = true
  error.value = ''
  try {
    await apiPost(`/api/prompt-libraries/${selectedLibrary.value.id}/templates/bulk`, {
      templates: selectedLibrary.value.templates.map((template) => ({
        ...template,
        reference_fields: template.reference_fields,
        enabled: Boolean(template.enabled),
      })),
    })
    message.value = 'Prompt 表格已保存'
    await load()
  } catch (caught) {
    error.value = (caught as ApiError).message
  } finally {
    saving.value = false
  }
}

async function exportWorkbook() {
  if (!selectedLibrary.value) return
  try {
    const data = await apiGet<{ library: PromptLibrary, templates: PromptTemplate[] }>(`/api/prompt-libraries/${selectedLibrary.value.id}/export`)
    exportPromptWorkbook(data.library.name, data.templates.map((template) => ({
      ...normalizeTemplate(template),
      reference_fields: referenceFieldText(template.reference_fields),
    })))
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function publishLibrary() {
  if (!selectedLibrary.value) return
  if (!canEditPrompts.value) {
    error.value = '当前账号没有 Prompt 发布权限'
    return
  }
  publishing.value = true
  error.value = ''
  try {
    await apiPost(`/api/prompt-libraries/${selectedLibrary.value.id}/publish-version`)
    message.value = '新版本已发布'
    await load()
  } catch (caught) {
    error.value = (caught as ApiError).message
  } finally {
    publishing.value = false
  }
}

function addRow() {
  if (!selectedLibrary.value) return
  if (!canEditPrompts.value) {
    error.value = '当前账号没有 Prompt 编辑权限'
    return
  }
  selectedLibrary.value.templates.unshift(normalizeTemplate({
    group_name: groupFilter.value !== 'all' ? groupFilter.value : selectedLibrary.value.templates[0]?.group_name || '上装',
    field_name: '',
    source_field_id: '',
    field_order: nextTopFieldOrder(),
    visible: true,
    size_label: '2K',
    output_format: 'jpeg',
    reference_fields: [],
    prompt_text: '',
    word_count: null,
    field_type: '',
    female_priority: null,
    male_neutral_priority: null,
    enabled: true,
    quality: 'auto',
    category_rules: [],
    gender_rules: [],
    priority: 100,
  }))
  resizePromptTextareas()
}

function deletePromptRow(template: PromptTemplate) {
  if (!selectedLibrary.value) return
  if (!canEditPrompts.value) {
    error.value = '当前账号没有 Prompt 编辑权限'
    return
  }
  selectedLibrary.value.templates = selectedLibrary.value.templates.filter((row) => row !== template)
}

function syncLibraryDraft() {
  if (!selectedLibrary.value) {
    libraryDraft.value = { name: '', scenario: '裂变图' }
    return
  }
  libraryDraft.value = {
    name: selectedLibrary.value.name,
    scenario: selectedLibrary.value.scenario || '裂变图',
  }
}

function nextTopFieldOrder(): number {
  const orders = selectedLibrary.value?.templates
    .map((template) => template.field_order)
    .filter((order): order is number => Number.isInteger(order)) ?? []
  return orders.length ? Math.min(...orders) - 1 : 0
}

function normalizeTemplate(template: Partial<PromptTemplate>): PromptTemplate {
  return {
    id: template.id,
    library_id: template.library_id,
    group_name: template.group_name || '',
    field_name: template.field_name || '',
    source_field_id: template.source_field_id || '',
    field_order: template.field_order ?? null,
    visible: template.visible !== false,
    size_label: template.size_label || '2K',
    output_format: template.output_format || 'jpeg',
    reference_fields: referenceFieldText(template.reference_fields),
    prompt_text: template.prompt_text || '',
    word_count: template.word_count ?? null,
    field_type: template.field_type || '',
    female_priority: template.female_priority ?? null,
    male_neutral_priority: template.male_neutral_priority ?? null,
    enabled: template.enabled !== false,
    quality: template.quality || 'auto',
    category_rules: template.category_rules || [],
    gender_rules: template.gender_rules || [],
    priority: template.priority ?? template.female_priority ?? template.male_neutral_priority ?? 100,
    updated_at: template.updated_at,
  }
}

function referenceFieldText(value: unknown): string {
  return Array.isArray(value) ? value.join('，') : typeof value === 'string' ? value : ''
}

function templateRowKey(template: PromptTemplate, index: number): string {
  return String(template.id ?? `${template.group_name}-${template.field_name}-${index}`)
}

function statusLabel(status: string): string {
  if (status === 'published') return '已发布'
  if (status === 'draft') return '草稿'
  if (status === 'archived') return '已归档'
  return status || '-'
}

function enabledLabel(template: PromptTemplate): string {
  return template.enabled ? '启用' : '停用'
}

function enterLibraryDetail(library: PromptLibrary) {
  selectedLibraryId.value = library.id
  viewMode.value = 'detail'
  groupFilter.value = 'all'
  keyword.value = ''
  syncLibraryDraft()
  resizePromptTextareas()
}

function backToLibraryList() {
  viewMode.value = 'list'
  keyword.value = ''
}

function libraryPromptCount(library: PromptLibrary): number {
  return Array.isArray(library.templates) ? library.templates.length : 0
}

function librarySourceLabel(): string {
  return '线上'
}

function formatDateTime(value: unknown): string {
  const date = new Date(String(value || ''))
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

function resizePromptTextarea(eventOrTextarea: Event | HTMLTextAreaElement) {
  const textarea = eventOrTextarea instanceof HTMLTextAreaElement
    ? eventOrTextarea
    : eventOrTextarea.target instanceof HTMLTextAreaElement
      ? eventOrTextarea.target
      : null
  if (!textarea) return
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

onMounted(async () => {
  await load()
  resizePromptTextareas()
})
onUpdated(resizePromptTextareas)
</script>

<template>
  <section class="view-stack prompt-library-page">
    <p v-if="message" class="notice">{{ message }}</p>
    <p v-if="error" class="notice danger">{{ error }}</p>

    <section class="prompt-command-panel">
      <div class="prompt-command-head">
        <div>
          <h2>库管理</h2>
          <p>{{ activeLibraryMeta }}</p>
        </div>
        <div class="prompt-primary-actions">
          <button class="ghost-button" type="button" @click="load">刷新</button>
          <button v-if="canEditPrompts" class="ghost-button" type="button" @click="creatingLibrary = !creatingLibrary">
            {{ creatingLibrary ? '收起建库' : '新建库' }}
          </button>
          <button v-if="!isListView" class="ghost-button" type="button" @click="backToLibraryList">返回列表</button>
        </div>
      </div>

      <input ref="fileInput" class="hidden-input" type="file" accept=".xlsx,.xls" @change="importWorkbook" />

      <div v-if="creatingLibrary && canEditPrompts" class="library-create-panel">
        <div>
          <strong>新建提示词库</strong>
          <span>建库会先生成草稿，发布新版本后才进入线上生图选择。</span>
        </div>
        <label class="field grow">
          <span>新库名称</span>
          <input v-model="newLibrary.name" />
        </label>
        <label class="field compact">
          <span>场景</span>
          <select v-model="newLibrary.scenario">
            <option v-for="scenario in scenarioOptions" :key="scenario">{{ scenario }}</option>
          </select>
        </label>
        <button class="primary-button" type="button" @click="createLibrary">确认创建</button>
      </div>

      <p v-if="!canEditPrompts" class="permission-note">当前账号可以查看 Prompt 库，但不能新建、导入、编辑或发布。需要编辑权限时请让管理员分配 prompts:write。</p>
    </section>

    <section v-if="isListView" class="prompt-library-list-panel">
      <div class="prompt-library-list-head">
        <div>
          <h3>提示词库列表</h3>
          <p>{{ cloudLibraryRows.length }} 个线上库</p>
        </div>
        <button v-if="canEditPrompts" class="primary-button" type="button" @click="creatingLibrary = true">新建库</button>
      </div>
      <div class="prompt-library-table">
        <div class="prompt-library-header" role="row">
          <span>提示词库名称</span>
          <span>当前 Prompt 数量</span>
          <span>创建时间</span>
          <span>来源</span>
          <span>操作</span>
        </div>
        <div class="prompt-library-body">
          <div v-for="library in cloudLibraryRows" :key="library.id" class="prompt-library-row">
            <div class="prompt-library-name">
              <strong>{{ library.name }}</strong>
              <span>{{ library.scenario }} · {{ statusLabel(library.status) }}</span>
            </div>
            <div>{{ libraryPromptCount(library) }} 条</div>
            <div>{{ formatDateTime(library.created_at || library.updated_at) }}</div>
            <div><span class="source-badge">{{ librarySourceLabel() }}</span></div>
            <div class="prompt-library-actions">
              <button class="ghost-button" type="button" @click="enterLibraryDetail(library)">进入编辑</button>
            </div>
          </div>
        </div>
      </div>
      <div v-if="!cloudLibraryRows.length" class="panel empty-state">导入或创建 Prompt 库后维护字段</div>
    </section>

    <section v-else-if="!selectedLibrary" class="panel empty-state">
      <span>未选择提示词库</span>
      <button class="ghost-button" type="button" @click="backToLibraryList">返回列表</button>
    </section>

    <section v-else class="prompt-workspace">
      <aside class="prompt-group-panel">
        <div class="prompt-group-head">
          <h3>分组</h3>
          <span>{{ groupSummaries.length }} 组</span>
        </div>
        <button class="group-filter" :class="{ active: groupFilter === 'all' }" type="button" @click="groupFilter = 'all'">
          <strong>全部 Prompt</strong>
          <span>{{ editableTemplates.length }} 条</span>
        </button>
        <button
          v-for="group in groupSummaries"
          :key="group.name"
          class="group-filter"
          :class="{ active: groupFilter === group.name }"
          type="button"
          @click="groupFilter = group.name"
        >
          <strong>{{ group.name }}</strong>
          <span>{{ group.enabled }} / {{ group.total }} 启用</span>
        </button>
        <div class="library-meta stacked">
          <span class="source-badge">{{ librarySourceLabel() }}</span>
          <span class="badge">{{ statusLabel(selectedLibrary.status) }}</span>
          <span class="badge">{{ enabledTemplateCount }} 条启用</span>
          <span v-if="!canEditPrompts" class="permission-badge">只读权限</span>
        </div>
      </aside>

      <main class="prompt-editor-panel">
        <div class="library-manager-grid">
          <label class="field library-name-field">
            <span>库名称</span>
            <input v-model="libraryDraft.name" :disabled="!canEditPrompts || !selectedLibrary" />
          </label>
          <label class="field compact">
            <span>场景</span>
            <select v-model="libraryDraft.scenario" :disabled="!canEditPrompts || !selectedLibrary">
              <option v-for="scenario in scenarioOptions" :key="scenario">{{ scenario }}</option>
            </select>
          </label>
          <label class="field search-field">
            <span>搜索</span>
            <input v-model.trim="keyword" type="search" placeholder="名称 / Prompt" />
          </label>
          <div class="library-actions">
            <button class="ghost-button" type="button" :disabled="!selectedLibrary" @click="exportWorkbook">导出 Excel</button>
            <button v-if="canEditPrompts" class="ghost-button" type="button" :disabled="importing" @click="fileInput?.click()">
              {{ importing ? '导入中' : '导入 Excel 建库' }}
            </button>
            <button v-if="canEditPrompts" class="ghost-button" type="button" :disabled="!selectedLibrary || publishing" @click="publishLibrary">
              {{ publishing ? '发布中' : '发布新版本' }}
            </button>
            <button v-if="canEditPrompts" class="primary-button" type="button" :disabled="savingLibrary || !selectedLibrary" @click="saveLibraryMeta">
              {{ savingLibrary ? '保存中' : '保存库信息' }}
            </button>
          </div>
        </div>

        <div class="prompt-display-head">
          <div>
            <h2>Prompt 明细</h2>
            <p>按线上表格维护业务字段，未展示字段会随导入导出保留。</p>
          </div>
          <div class="prompt-detail-actions">
            <span class="badge">{{ displayTemplates.length }} 条</span>
            <button v-if="canEditPrompts" class="ghost-button" type="button" :disabled="!selectedLibrary" @click="addRow">新增 Prompt</button>
            <button v-if="canEditPrompts" class="primary-button" type="button" :disabled="saving || !selectedLibrary" @click="saveTable">
              {{ saving ? '保存中' : '保存 Prompt' }}
            </button>
          </div>
        </div>
        <div class="prompt-edit-list">
          <div class="prompt-template-table">
            <div class="prompt-template-header" role="row">
              <span>状态</span>
              <span>分组</span>
              <span>字段名</span>
              <span>女优先</span>
              <span>男/中</span>
              <span>Prompt</span>
              <span>操作</span>
            </div>
            <div class="prompt-template-body">
              <div v-for="(template, index) in displayTemplates" :key="templateRowKey(template, index)" class="prompt-template-row" :class="{ disabled: !template.enabled }">
                <div class="prompt-template-cell status">
                  <label class="prompt-switch" :class="{ readonly: !canEditPrompts }">
                    <input v-model="template.enabled" type="checkbox" :disabled="!canEditPrompts" aria-label="启用 Prompt" />
                    <span class="prompt-switch-track" aria-hidden="true"></span>
                    <strong>{{ enabledLabel(template) }}</strong>
                  </label>
                </div>
                <div class="prompt-template-cell">
                  <input v-model="template.group_name" :disabled="!canEditPrompts" aria-label="分组" />
                </div>
                <div class="prompt-template-cell">
                  <input v-model="template.field_name" :disabled="!canEditPrompts" aria-label="字段名" />
                </div>
                <div class="prompt-template-cell compact">
                  <input v-model.number="template.female_priority" type="number" :disabled="!canEditPrompts" aria-label="女优先" />
                </div>
                <div class="prompt-template-cell compact">
                  <input v-model.number="template.male_neutral_priority" type="number" :disabled="!canEditPrompts" aria-label="男/中优先" />
                </div>
                <div class="prompt-template-cell prompt">
                  <textarea
                    ref="promptTextareas"
                    v-model="template.prompt_text"
                    rows="2"
                    :disabled="!canEditPrompts"
                    aria-label="Prompt"
                    placeholder="输入完整生图 Prompt"
                    @input="resizePromptTextarea"
                  ></textarea>
                </div>
                <div class="prompt-template-cell action">
                  <button class="ghost-button danger compact-action" type="button" :disabled="!canEditPrompts" @click="deletePromptRow(template)">删除</button>
                </div>
              </div>
            </div>
          </div>
          <div v-if="!displayTemplates.length" class="panel empty-state">没有匹配的 Prompt</div>
        </div>
      </main>
    </section>
  </section>
</template>

<style scoped>
.prompt-library-page {
  gap: 16px;
}

.prompt-command-panel,
.prompt-library-list-panel,
.prompt-group-panel,
.prompt-display-panel,
.prompt-editor-panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
}

.prompt-command-panel {
  display: grid;
  gap: 14px;
  padding: 14px;
}

.prompt-command-head,
.prompt-library-list-head,
.library-manager-grid,
.prompt-edit-toolbar,
.prompt-primary-actions,
.library-meta,
.prompt-display-head,
.prompt-detail-actions,
.prompt-card-meta,
.prompt-edit-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.prompt-command-head,
.prompt-library-list-head,
.prompt-display-head {
  justify-content: space-between;
}

.prompt-command-head h2,
.prompt-command-head p,
.prompt-library-list-head h3,
.prompt-library-list-head p,
.prompt-display-head h2,
.prompt-display-head p,
.prompt-group-head h3,
.prompt-group-head span,
.prompt-card-body h3,
.prompt-card-body p {
  margin: 0;
}

.prompt-command-head h2,
.prompt-display-head h2 {
  font-size: 18px;
  line-height: 1.25;
}

.prompt-command-head p,
.prompt-library-list-head p,
.prompt-display-head p,
.permission-note {
  color: var(--text2);
  font-size: 13px;
  line-height: 1.5;
}

.prompt-primary-actions {
  justify-content: flex-end;
}

.prompt-library-list-panel {
  display: grid;
  gap: 12px;
  padding: 14px;
}

.prompt-library-table,
.prompt-template-table {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}

.prompt-library-header,
.prompt-library-row,
.prompt-template-header,
.prompt-template-row {
  display: grid;
  align-items: stretch;
}

.prompt-library-header,
.prompt-template-header {
  min-height: 36px;
  background: var(--bg3);
  color: var(--text2);
  font-size: 12px;
  font-weight: 900;
}

.prompt-library-header,
.prompt-library-row {
  grid-template-columns: minmax(260px, 1.4fr) minmax(120px, 0.6fr) minmax(170px, 0.7fr) minmax(92px, 0.45fr) minmax(110px, 0.5fr);
}

.prompt-library-header span,
.prompt-library-row > div,
.prompt-template-header span,
.prompt-template-cell {
  min-width: 0;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
}

.prompt-library-row:last-child > div,
.prompt-template-row:last-child .prompt-template-cell {
  border-bottom: 0;
}

.prompt-library-name {
  display: grid !important;
  align-content: center;
  gap: 4px;
}

.prompt-library-name strong,
.prompt-library-name span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-library-name span {
  color: var(--text2);
  font-size: 12px;
}

.prompt-library-actions {
  justify-content: flex-end;
}

.source-badge {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  border: 1px solid rgba(74, 222, 128, 0.42);
  border-radius: 999px;
  background: rgba(74, 222, 128, 0.11);
  color: #b7f7cf;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 900;
}

.library-manager-grid {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(150px, 180px) minmax(220px, 0.8fr);
  gap: 10px;
  align-items: end;
}

.library-actions,
.prompt-detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.library-actions {
  grid-column: 1 / -1;
  padding-top: 2px;
}

.library-name-field {
  min-width: 260px;
}

.prompt-edit-toolbar {
  align-items: end;
  border-top: 1px solid var(--border);
  padding-top: 14px;
}

.field.compact {
  min-width: 150px;
}

.field.grow {
  flex: 1 1 220px;
}

.library-create-panel {
  display: grid;
  grid-template-columns: minmax(210px, 1.2fr) minmax(240px, 1fr) minmax(150px, 180px) auto;
  gap: 10px;
  align-items: end;
  border: 1px solid rgba(255, 107, 43, 0.34);
  border-radius: 8px;
  background: rgba(255, 107, 43, 0.07);
  padding: 12px;
}

.library-create-panel > div {
  display: grid;
  gap: 4px;
  align-self: center;
}

.library-create-panel strong {
  color: var(--text);
  font-size: 14px;
}

.library-create-panel span {
  color: var(--text2);
  font-size: 12px;
  line-height: 1.45;
}

.permission-badge {
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(255, 107, 43, 0.45);
  border-radius: 8px;
  background: rgba(255, 107, 43, 0.08);
  color: #ffd8c7;
  padding: 3px 8px;
  font-size: 12px;
  font-weight: 800;
}

.library-meta.stacked {
  display: grid;
  gap: 7px;
  align-items: start;
  justify-content: stretch;
  margin-top: 6px;
}

.hidden-input {
  display: none;
}

.permission-note {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  padding: 10px 12px;
}

.prompt-workspace {
  display: grid;
  grid-template-columns: minmax(190px, 240px) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

.prompt-group-panel {
  display: grid;
  gap: 8px;
  padding: 12px;
  position: sticky;
  top: 10px;
}

.prompt-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 8px;
}

.prompt-group-head h3 {
  font-size: 15px;
}

.prompt-group-head span {
  color: var(--text2);
  font-size: 12px;
}

.group-filter {
  display: grid;
  width: 100%;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text);
  padding: 9px 10px;
  text-align: left;
}

.group-filter.active,
.group-filter:hover {
  border-color: var(--orange);
  background: rgba(255, 107, 43, 0.09);
}

.group-filter strong {
  font-size: 13px;
}

.group-filter span {
  color: var(--text2);
  font-size: 12px;
}

.prompt-display-panel,
.prompt-editor-panel {
  min-width: 0;
  overflow: auto;
}

.prompt-editor-panel > .library-manager-grid {
  padding: 14px;
  border-bottom: 1px solid var(--border);
}

.prompt-display-head {
  border-bottom: 1px solid var(--border);
  padding: 14px;
}

.prompt-edit-list {
  display: grid;
  gap: 10px;
  padding: 14px;
}

.prompt-preview-card,
.prompt-edit-row {
  display: grid;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  padding: 12px;
}

.prompt-preview-card.disabled {
  opacity: 0.62;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text2);
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 900;
  white-space: nowrap;
}

.status-pill.approved {
  border-color: rgba(74, 222, 128, 0.58);
  background: rgba(74, 222, 128, 0.13);
  color: #b7f7cf;
}

.status-pill.rejected {
  border-color: rgba(248, 113, 113, 0.58);
  background: rgba(248, 113, 113, 0.13);
  color: #ffd2d2;
}

.check-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 7px;
  align-items: center;
  color: var(--text);
  font-size: 12px;
  font-weight: 800;
}

.prompt-card-meta {
  justify-content: space-between;
}

.prompt-card-body {
  display: grid;
  gap: 8px;
}

.prompt-card-body h3 {
  font-size: 15px;
}

.prompt-card-body p {
  color: var(--text);
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
}

.prompt-edit-row {
  grid-template-columns: minmax(260px, 0.72fr) minmax(420px, 1fr);
  align-items: start;
}

.prompt-edit-meta {
  align-items: end;
}

.prompt-edit-meta .field {
  min-width: 132px;
  flex: 1 1 132px;
}

.priority-field {
  max-width: 118px;
}

.prompt-text-field textarea {
  min-height: 132px;
  line-height: 1.55;
}

.prompt-template-header,
.prompt-template-row {
  grid-template-columns: 116px minmax(120px, 0.8fr) minmax(150px, 0.9fr) 96px 96px minmax(260px, 1.7fr) 82px;
}

.prompt-template-row.disabled {
  opacity: 0.68;
}

.prompt-template-cell {
  align-items: stretch;
}

.prompt-template-cell.status,
.prompt-template-cell.action {
  align-items: center;
}

.prompt-template-cell.action {
  justify-content: flex-end;
}

.prompt-template-cell.compact input {
  text-align: center;
}

.prompt-template-cell input,
.prompt-template-cell textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg2);
  color: var(--text);
  padding: 8px 9px;
  font: inherit;
  outline: none;
}

.prompt-template-cell input:disabled,
.prompt-template-cell textarea:disabled {
  opacity: 0.72;
  cursor: not-allowed;
}

.prompt-template-cell input:focus,
.prompt-template-cell textarea:focus {
  border-color: var(--orange);
}

.prompt-template-cell.prompt textarea {
  min-height: 42px;
  resize: none;
  overflow: hidden;
  line-height: 1.55;
}

.prompt-switch {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--text);
  font-size: 12px;
  font-weight: 900;
}

.prompt-switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.prompt-switch-track {
  position: relative;
  width: 34px;
  height: 18px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.28);
  border: 1px solid var(--border);
  transition: background 0.16s, border-color 0.16s;
}

.prompt-switch-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text2);
  transition: transform 0.16s, background 0.16s;
}

.prompt-switch input:checked + .prompt-switch-track {
  border-color: rgba(74, 222, 128, 0.48);
  background: rgba(74, 222, 128, 0.22);
}

.prompt-switch input:checked + .prompt-switch-track::after {
  transform: translateX(16px);
  background: #b7f7cf;
}

.prompt-switch.readonly {
  opacity: 0.72;
}

.compact-action {
  padding-inline: 10px;
}

@media (max-width: 980px) {
  .prompt-workspace,
  .prompt-edit-row,
  .library-manager-grid,
  .library-create-panel,
  .prompt-library-header,
  .prompt-library-row,
  .prompt-template-header,
  .prompt-template-row {
    grid-template-columns: 1fr;
  }

  .prompt-group-panel {
    position: static;
  }

  .prompt-library-header {
    display: none;
  }

  .prompt-template-header {
    display: none;
  }
}

@media (max-width: 720px) {
  .prompt-command-head,
  .prompt-library-list-head,
  .prompt-display-head,
  .prompt-primary-actions,
  .library-actions,
  .prompt-detail-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .prompt-primary-actions button,
  .library-actions button,
  .prompt-detail-actions button,
  .library-create-panel button {
    width: 100%;
  }
}
</style>
