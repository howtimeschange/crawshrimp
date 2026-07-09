<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

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
  templates: PromptTemplate[]
}

const libraries = ref<PromptLibrary[]>([])
const selectedLibraryId = ref<number | null>(null)
const message = ref('')
const error = ref('')
const importing = ref(false)
const saving = ref(false)
const savingLibrary = ref(false)
const publishing = ref(false)
const editing = ref(false)
const creatingLibrary = ref(false)
const groupFilter = ref('all')
const newLibrary = ref({ name: 'AI 测图提示词库 默认版', scenario: '裂变图' })
const libraryDraft = ref({ name: '', scenario: '裂变图' })
const fileInput = ref<HTMLInputElement | null>(null)
const props = defineProps<{ permissions?: string[] }>()
const scenarioOptions = ['裂变图', '创意拍摄']

const selectedLibrary = computed(() => libraries.value.find((library) => library.id === selectedLibraryId.value) ?? libraries.value[0] ?? null)
const editableTemplates = computed(() => selectedLibrary.value?.templates ?? [])
const canEditPrompts = computed(() => props.permissions?.includes('prompts:write') ?? false)
const enabledTemplateCount = computed(() => editableTemplates.value.filter((template) => template.enabled).length)
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
  if (groupFilter.value === 'all') return editableTemplates.value
  return editableTemplates.value.filter((template) => (template.group_name || '未分组') === groupFilter.value)
})
const activeLibraryMeta = computed(() => {
  if (!selectedLibrary.value) return '导入或创建 Prompt 库后开始维护模板'
  return `${selectedLibrary.value.scenario} · ${statusLabel(selectedLibrary.value.status)} · ${editableTemplates.value.length} 条字段，${enabledTemplateCount.value} 条启用`
})

watch(selectedLibraryId, () => {
  groupFilter.value = 'all'
  syncLibraryDraft()
})

async function load() {
  try {
    const previousId = selectedLibraryId.value
    const data = await apiGet<{ libraries: PromptLibrary[] }>('/api/prompt-libraries')
    libraries.value = data.libraries.map((library) => ({
      ...library,
      templates: library.templates.map(normalizeTemplate),
    }))
    selectedLibraryId.value = libraries.value.some((library) => library.id === previousId)
      ? previousId
      : libraries.value[0]?.id ?? null
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
  editing.value = true
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

function enterEditMode() {
  if (!canEditPrompts.value) {
    error.value = '当前账号仅可查看 Prompt 库，请联系管理员分配 prompts:write 权限'
    return
  }
  editing.value = true
}

function leaveEditMode() {
  editing.value = false
  void load()
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

onMounted(load)
</script>

<template>
  <section class="view-stack prompt-library-page" :class="{ editing }">
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
        </div>
      </div>

      <div class="library-manager-grid">
        <label class="field compact">
          <span>当前库</span>
          <select v-model.number="selectedLibraryId">
            <option v-for="library in libraries" :key="library.id" :value="library.id">
              {{ library.name }}
            </option>
          </select>
        </label>
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
        <div v-if="selectedLibrary" class="library-meta">
          <span class="badge">{{ statusLabel(selectedLibrary.status) }}</span>
          <span class="badge">{{ enabledTemplateCount }} 条启用</span>
          <span v-if="!canEditPrompts" class="permission-badge">只读权限</span>
        </div>
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

    <section v-if="!selectedLibrary" class="panel empty-state">导入或创建 Prompt 库后维护字段</section>

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
      </aside>

      <main v-if="!editing" class="prompt-display-panel">
        <div class="prompt-display-head">
          <div>
            <h2>Prompt 明细</h2>
            <p>默认查看业务可用字段，工程字段仅在导入导出中保留，不占用日常维护空间。</p>
          </div>
          <div class="prompt-detail-actions">
            <span class="badge">{{ displayTemplates.length }} 条</span>
            <button v-if="canEditPrompts" class="ghost-button" type="button" :disabled="!selectedLibrary" @click="addRow">新增 Prompt</button>
            <button v-if="canEditPrompts" class="primary-button" type="button" @click="enterEditMode">编辑 Prompt</button>
          </div>
        </div>
        <div class="prompt-card-list">
          <article v-for="(template, index) in displayTemplates" :key="templateRowKey(template, index)" class="prompt-preview-card" :class="{ disabled: !template.enabled }">
            <div class="prompt-card-meta">
              <span class="status-pill" :class="{ approved: template.enabled, rejected: !template.enabled }">{{ enabledLabel(template) }}</span>
              <span class="badge">{{ template.group_name || '未分组' }}</span>
              <span class="muted">女 {{ template.female_priority ?? '-' }} · 男/中 {{ template.male_neutral_priority ?? '-' }}</span>
            </div>
            <div class="prompt-card-body">
              <h3>{{ template.field_name || '未命名 Prompt' }}</h3>
              <p>{{ template.prompt_text || '暂无 Prompt 内容' }}</p>
            </div>
          </article>
        </div>
      </main>

      <main v-else class="prompt-editor-panel">
        <div class="prompt-display-head">
          <div>
            <h2>Prompt 明细编辑</h2>
            <p>只维护业务审核需要看到的字段；未展示字段会随原数据保留并继续参与导入导出。</p>
          </div>
          <div class="prompt-detail-actions">
            <span class="badge">{{ displayTemplates.length }} 条</span>
            <button class="ghost-button" type="button" :disabled="!selectedLibrary" @click="addRow">新增 Prompt</button>
            <button class="ghost-button" type="button" @click="leaveEditMode">退出编辑</button>
            <button class="primary-button" type="button" :disabled="saving || !selectedLibrary" @click="saveTable">
              {{ saving ? '保存中' : '保存 Prompt' }}
            </button>
          </div>
        </div>
        <div class="prompt-edit-list">
          <article v-for="(template, index) in displayTemplates" :key="templateRowKey(template, index)" class="prompt-edit-row">
            <div class="prompt-edit-meta">
              <label class="check-row">
                <input v-model="template.enabled" type="checkbox" />
                <span>启用</span>
              </label>
              <label class="field">
                <span>分组</span>
                <input v-model="template.group_name" />
              </label>
              <label class="field">
                <span>字段名</span>
                <input v-model="template.field_name" />
              </label>
              <label class="field priority-field">
                <span>女优先</span>
                <input v-model.number="template.female_priority" type="number" />
              </label>
              <label class="field priority-field">
                <span>男/中优先</span>
                <input v-model.number="template.male_neutral_priority" type="number" />
              </label>
            </div>
            <label class="field prompt-text-field">
              <span>Prompt</span>
              <textarea v-model="template.prompt_text" rows="5" placeholder="输入用于 AI 测图的提示词模板"></textarea>
            </label>
          </article>
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
.prompt-display-head {
  justify-content: space-between;
}

.prompt-command-head h2,
.prompt-command-head p,
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
.prompt-display-head p,
.permission-note {
  color: var(--text2);
  font-size: 13px;
  line-height: 1.5;
}

.prompt-primary-actions {
  justify-content: flex-end;
}

.library-manager-grid {
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(260px, 1fr) minmax(150px, 180px);
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

.prompt-display-head {
  border-bottom: 1px solid var(--border);
  padding: 14px;
}

.prompt-card-list,
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

@media (max-width: 980px) {
  .prompt-workspace,
  .prompt-edit-row,
  .library-manager-grid,
  .library-create-panel {
    grid-template-columns: 1fr;
  }

  .prompt-group-panel {
    position: static;
  }
}

@media (max-width: 720px) {
  .prompt-command-head,
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
