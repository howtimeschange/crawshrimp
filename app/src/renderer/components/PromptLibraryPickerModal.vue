<template>
  <div v-if="open" class="prompt-library-picker-modal" @click.self="close">
    <section class="prompt-library-picker-panel" role="dialog" aria-modal="true" aria-label="从 Prompt 库选择">
      <header class="prompt-library-picker-head">
        <div>
          <strong>{{ title }}</strong>
          <span>{{ subtitle }}</span>
        </div>
        <button type="button" class="prompt-library-icon-btn" aria-label="关闭 Prompt 库选择" @click="close">×</button>
      </header>

      <div class="prompt-library-picker-filters">
        <select v-model="selectedLibraryId" class="prompt-library-select" @change="loadPromptLibraryTemplates(selectedLibraryId)">
          <option value="">选择 Prompt 库</option>
          <option v-for="library in libraries" :key="library.picker_key || library.id" :value="String(library.picker_key || library.id)">
            {{ library.name || `Prompt 库 ${library.id}` }}（{{ library.source_label }}）
          </option>
        </select>
        <input v-model="search" class="prompt-library-search" placeholder="搜索 Prompt 名称 / 内容" />
        <select v-model="category" class="prompt-library-category">
          <option value="">全部分类</option>
          <option v-for="item in categories" :key="item" :value="item">{{ item }}</option>
        </select>
        <button type="button" class="prompt-library-refresh" :disabled="loading" @click="loadPromptLibraries">
          {{ loading ? '刷新中' : '刷新' }}
        </button>
      </div>

      <div v-if="error" class="prompt-library-picker-empty error">{{ error }}</div>
      <div v-else-if="loading || templatesLoading" class="prompt-library-picker-empty">正在读取 Prompt 库...</div>
      <div v-else class="prompt-library-template-list">
        <button
          v-for="template in filteredTemplates"
          :key="template.template_id || template.id || `${template.group_name}-${template.field_name}`"
          type="button"
          class="prompt-library-template-row"
          @click="selectTemplate(template)"
        >
          <span>{{ template.group_name || '未分类' }}</span>
          <strong>{{ template.field_name || '未命名 Prompt' }}</strong>
          <p>{{ template.prompt_text || template.prompt || '' }}</p>
        </button>
        <div v-if="!filteredTemplates.length" class="prompt-library-picker-empty">没有匹配的 Prompt</div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { buildPromptLibraryPickerLibraries } from '../utils/localPromptLibrary'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '从 Prompt 库选择' },
  subtitle: { type: String, default: '选中后会回填当前 Prompt。' },
})

const emit = defineEmits(['close', 'select'])

const libraries = ref([])
const templates = ref([])
const selectedLibraryId = ref('')
const search = ref('')
const category = ref('')
const loading = ref(false)
const templatesLoading = ref(false)
const error = ref('')

const categories = computed(() => {
  const seen = new Set()
  for (const template of templates.value || []) {
    const group = String(template?.group_name || '').trim()
    if (group) seen.add(group)
  }
  return Array.from(seen)
})

const filteredTemplates = computed(() => {
  const query = search.value.trim().toLowerCase()
  const selectedCategory = category.value.trim()
  return (templates.value || []).filter((template) => {
    if (selectedCategory && String(template?.group_name || '').trim() !== selectedCategory) return false
    if (!query) return true
    const haystack = [
      template?.group_name,
      template?.field_name,
      template?.prompt_text,
      template?.prompt,
      template?.size_label,
    ].join(' ').toLowerCase()
    return haystack.includes(query)
  })
})

watch(() => props.open, (open) => {
  if (!open) return
  search.value = ''
  category.value = ''
  if (!libraries.value.length) void loadPromptLibraries()
  else if (selectedLibraryId.value) void loadPromptLibraryTemplates(selectedLibraryId.value)
}, { immediate: true })

function close() {
  emit('close')
}

async function loadPromptLibraries() {
  loading.value = true
  error.value = ''
  try {
    if (!window?.cs) throw new Error('本地 Prompt 库服务未就绪')
    const [localResult, cloudResult] = await Promise.allSettled([
      window.cs.listLocalPromptLibraries(),
      window.cs.listCloudPromptLibraries(),
    ])
    const localPayload = promptLibrarySettledPayload(localResult, '本地 Prompt 库')
    const cloudPayload = promptLibrarySettledPayload(cloudResult, '线上 Prompt 库')
    const nextLibraries = buildPromptLibraryPickerLibraries({
      localLibraries: Array.isArray(localPayload.payload?.libraries) ? localPayload.payload.libraries : [],
      cloudLibraries: Array.isArray(cloudPayload.payload?.libraries) ? cloudPayload.payload.libraries : [],
    })
    libraries.value = nextLibraries
    const currentId = String(selectedLibraryId.value || '').trim()
    const currentExists = nextLibraries.some(library => String(library.picker_key || library.id || '') === currentId)
    const nextLibraryId = currentExists ? currentId : String(nextLibraries[0]?.picker_key || nextLibraries[0]?.id || '').trim()
    selectedLibraryId.value = nextLibraryId
    const errors = [localPayload.error, cloudPayload.error].filter(Boolean)
    if (!nextLibraries.length && errors.length) throw new Error(errors.join('；'))
    if (nextLibraryId) await loadPromptLibraryTemplates(nextLibraryId)
    else templates.value = []
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

async function loadPromptLibraryTemplates(libraryId) {
  const id = String(libraryId || '').trim()
  if (!id) {
    templates.value = []
    return
  }
  const selectedLibrary = (libraries.value || [])
    .find(library => String(library.picker_key || library.id || '') === id)
  if (selectedLibrary && selectedLibrary.source_type === 'local') {
    templates.value = (selectedLibrary.templates || [])
      .map(template => ({ ...template, source_label: selectedLibrary.source_label || '本地' }))
    category.value = ''
    return
  }
  templatesLoading.value = true
  error.value = ''
  try {
    const cloudLibraryId = selectedLibrary?.cloud_library_id ?? id.replace(/^cloud:/, '')
    const payload = await window.cs.resolveCloudPromptTemplates(cloudLibraryId, { limit: 500 })
    if (payload?.detail || payload?.error) throw new Error(payload.detail || payload.error)
    templates.value = (Array.isArray(payload?.templates) ? payload.templates : [])
      .map(template => ({ ...template, source_type: 'cloud', source_label: selectedLibrary?.source_label || '线上' }))
    category.value = ''
  } catch (err) {
    error.value = err?.message || String(err)
    templates.value = []
  } finally {
    templatesLoading.value = false
  }
}

function promptLibrarySettledPayload(result, label) {
  if (result.status === 'rejected') {
    return { payload: {}, error: `${label}读取失败：${result.reason?.message || result.reason}` }
  }
  const payload = result.value || {}
  const payloadError = payload?.detail || payload?.error
  if (payloadError) return { payload: {}, error: `${label}读取失败：${payloadError}` }
  return { payload, error: '' }
}

function selectTemplate(template) {
  emit('select', template)
  close()
}
</script>

<style scoped>
.prompt-library-picker-modal {
  position: fixed;
  inset: 0;
  z-index: 320;
  display: grid;
  align-items: start;
  justify-items: center;
  box-sizing: border-box;
  padding: clamp(10px, 2dvh, 24px) clamp(10px, 2vw, 28px);
  overflow: hidden;
  background: rgba(5, 6, 10, 0.68);
  backdrop-filter: blur(10px);
}

.prompt-library-picker-panel {
  width: min(1040px, calc(100vw - 20px));
  height: min(760px, calc(100vh - 20px));
  height: min(760px, calc(100dvh - 20px));
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 14px;
  padding: 16px;
  overflow: hidden;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #1c1c22;
  color: var(--text, #f4f4f6);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.44);
}

.prompt-library-picker-head,
.prompt-library-picker-filters {
  align-items: center;
  gap: 12px;
}

.prompt-library-picker-head {
  display: flex;
  justify-content: space-between;
}

.prompt-library-picker-head div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.prompt-library-picker-head span {
  color: var(--text2, #a0a0b0);
  font-size: 12px;
}

.prompt-library-picker-filters {
  display: grid;
  grid-template-columns: minmax(180px, 260px) minmax(160px, 1fr) minmax(130px, 190px) auto;
  padding-top: 12px;
  border-top: 1px solid #2e2e3a;
}

.prompt-library-select,
.prompt-library-search,
.prompt-library-category {
  min-width: 0;
  height: 38px;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #242430;
  color: inherit;
  font: inherit;
}

.prompt-library-select {
  width: 100%;
  padding: 0 10px;
}

.prompt-library-search {
  width: 100%;
  padding: 0 12px;
}

.prompt-library-category {
  width: 100%;
  padding: 0 10px;
}

.prompt-library-refresh,
.prompt-library-icon-btn {
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #242430;
  color: inherit;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.prompt-library-refresh {
  flex: 0 0 auto;
  min-height: 38px;
  padding: 0 12px;
}

.prompt-library-icon-btn {
  width: 36px;
  height: 36px;
}

.prompt-library-template-list {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  padding-right: 4px;
}

.prompt-library-template-row {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 12px;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #202028;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.prompt-library-template-row:hover,
.prompt-library-refresh:hover,
.prompt-library-icon-btn:hover {
  border-color: rgba(255, 107, 43, 0.5);
  background: rgba(255, 107, 43, 0.08);
}

.prompt-library-template-row span {
  color: #ff8b5f;
  font-size: 12px;
  font-weight: 800;
}

.prompt-library-template-row strong {
  color: var(--text, #f4f4f6);
}

.prompt-library-template-row p {
  max-height: 52px;
  margin: 0;
  overflow: hidden;
  color: var(--text2, #a0a0b0);
  font-size: 12px;
  line-height: 1.55;
}

.prompt-library-picker-empty {
  min-height: 180px;
  display: grid;
  place-items: center;
  border: 1px dashed #2e2e3a;
  border-radius: 8px;
  color: var(--text2, #a0a0b0);
}

.prompt-library-picker-empty.error {
  color: #ff8b5f;
}

@media (max-width: 840px) {
  .prompt-library-picker-filters {
    align-items: stretch;
    grid-template-columns: 1fr;
  }

  .prompt-library-picker-head {
    align-items: flex-start;
  }

  .prompt-library-picker-panel {
    gap: 10px;
    padding: 12px;
  }

  .prompt-library-template-row {
    padding: 10px;
  }
}
</style>
