<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { apiGet, apiPost, type ApiError } from '../api'
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
const expandedRowKey = ref<string | null>(null)
const newLibrary = ref({ name: 'AI 测图提示词库 默认版', scenario: '裂变图' })
const fileInput = ref<HTMLInputElement | null>(null)

const selectedLibrary = computed(() => libraries.value.find((library) => library.id === selectedLibraryId.value) ?? libraries.value[0] ?? null)
const editableTemplates = computed(() => selectedLibrary.value?.templates ?? [])

async function load() {
  try {
    const data = await apiGet<{ libraries: PromptLibrary[] }>('/api/prompt-libraries')
    libraries.value = data.libraries.map((library) => ({
      ...library,
      templates: library.templates.map(normalizeTemplate),
    }))
    selectedLibraryId.value = selectedLibrary.value?.id ?? null
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function createLibrary() {
  error.value = ''
  try {
    await apiPost('/api/prompt-libraries', {
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
    await load()
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function importWorkbook(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  importing.value = true
  error.value = ''
  try {
    const rows = await parsePromptWorkbook(file)
    await apiPost('/api/prompt-libraries/import', {
      name: newLibrary.value.name || 'AI 测图提示词库 默认版',
      scenario: newLibrary.value.scenario,
      templates: rows,
    })
    message.value = `已导入 ${rows.length} 条 Prompt 字段`
    await load()
  } catch (caught) {
    error.value = (caught as ApiError).message || 'Excel 导入失败'
  } finally {
    importing.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function saveTable() {
  if (!selectedLibrary.value) return
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
  await apiPost(`/api/prompt-libraries/${selectedLibrary.value.id}/publish-version`)
  message.value = '版本已发布'
  await load()
}

function addRow() {
  if (!selectedLibrary.value) return
  selectedLibrary.value.templates.push(normalizeTemplate({
    group_name: selectedLibrary.value.templates[0]?.group_name || '上装',
    field_name: '',
    source_field_id: '',
    field_order: selectedLibrary.value.templates.length + 1,
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

onMounted(load)
</script>

<template>
  <section class="view-stack">
    <p v-if="message" class="notice">{{ message }}</p>
    <p v-if="error" class="notice danger">{{ error }}</p>

    <section class="form-panel view-stack">
      <div class="table-header">
        <h2>Prompt 库工作台</h2>
        <button class="ghost-button" type="button" @click="load">刷新</button>
      </div>
      <div class="prompt-toolbar">
        <label class="field compact">
          <span>库</span>
          <select v-model.number="selectedLibraryId">
            <option v-for="library in libraries" :key="library.id" :value="library.id">
              {{ library.name }}
            </option>
          </select>
        </label>
        <label class="field compact">
          <span>场景</span>
          <select v-model="newLibrary.scenario">
            <option>裂变图</option>
            <option>创意拍摄</option>
          </select>
        </label>
        <label class="field grow">
          <span>新库名称</span>
          <input v-model="newLibrary.name" />
        </label>
        <button class="primary-button" type="button" @click="createLibrary">新建库</button>
        <button class="ghost-button" type="button" :disabled="importing" @click="fileInput?.click()">
          {{ importing ? '导入中' : '导入 Excel' }}
        </button>
        <input ref="fileInput" class="hidden-input" type="file" accept=".xlsx,.xls" @change="importWorkbook" />
        <button class="ghost-button" type="button" :disabled="!selectedLibrary" @click="exportWorkbook">导出 Excel</button>
        <button class="ghost-button" type="button" :disabled="!selectedLibrary" @click="publishLibrary">发布版本</button>
        <button class="primary-button" type="button" :disabled="saving || !selectedLibrary" @click="saveTable">
          {{ saving ? '保存中' : '批量保存' }}
        </button>
      </div>
      <div v-if="selectedLibrary" class="library-meta">
        <span class="badge">{{ selectedLibrary.scenario }}</span>
        <span class="badge">{{ selectedLibrary.status }}</span>
        <span class="muted">{{ editableTemplates.length }} 条字段</span>
      </div>
    </section>

    <section class="table-panel prompt-table-panel">
      <div class="table-header">
        <h2>字段表格</h2>
        <button class="ghost-button" type="button" :disabled="!selectedLibrary" @click="addRow">新增行</button>
      </div>
      <div v-if="!selectedLibrary" class="empty-state">导入或创建 Prompt 库后编辑字段</div>
      <div v-else class="spreadsheet-scroll">
        <table class="data-table prompt-sheet">
          <thead>
            <tr>
              <th>启用</th>
              <th>分组</th>
              <th>字段名</th>
              <th>字段 ID</th>
              <th>顺序</th>
              <th>视图</th>
              <th>尺寸</th>
              <th>格式</th>
              <th>引用字段</th>
              <th>Prompt</th>
              <th>字数</th>
              <th>类型</th>
              <th>女优先</th>
              <th>男/中优先</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(template, index) in editableTemplates" :key="template.id ?? `new-${index}`">
              <tr>
                <td><input v-model="template.enabled" type="checkbox" /></td>
                <td><input v-model="template.group_name" /></td>
                <td><input v-model="template.field_name" /></td>
                <td><input v-model="template.source_field_id" /></td>
                <td><input v-model.number="template.field_order" type="number" /></td>
                <td><input v-model="template.visible" type="checkbox" /></td>
                <td><input v-model="template.size_label" /></td>
                <td><input v-model="template.output_format" /></td>
                <td><input v-model="template.reference_fields" /></td>
                <td>
                  <button class="prompt-cell-button" type="button" @click="expandedRowKey = expandedRowKey === String(template.id ?? `new-${index}`) ? null : String(template.id ?? `new-${index}`)">
                    {{ template.prompt_text || '编辑 Prompt' }}
                  </button>
                </td>
                <td><input v-model.number="template.word_count" type="number" /></td>
                <td><input v-model="template.field_type" /></td>
                <td><input v-model.number="template.female_priority" type="number" /></td>
                <td><input v-model.number="template.male_neutral_priority" type="number" /></td>
              </tr>
              <tr v-if="expandedRowKey === String(template.id ?? `new-${index}`)" class="prompt-detail-row">
                <td colspan="14">
                  <textarea v-model="template.prompt_text" rows="4" />
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<style scoped>
.prompt-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 10px;
}

.field.compact {
  min-width: 150px;
}

.field.grow {
  flex: 1 1 220px;
}

.hidden-input {
  display: none;
}

.library-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.prompt-table-panel {
  min-width: 0;
}

.spreadsheet-scroll {
  overflow: auto;
}

.prompt-sheet {
  min-width: 1360px;
}

.prompt-sheet th,
.prompt-sheet td {
  vertical-align: middle;
}

.prompt-sheet input,
.prompt-detail-row textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  padding: 8px;
}

.prompt-sheet input[type="checkbox"] {
  width: 18px;
  height: 18px;
  padding: 0;
}

.prompt-cell-button {
  display: block;
  width: 260px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  padding: 8px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-detail-row textarea {
  min-height: 96px;
  resize: vertical;
}
</style>
