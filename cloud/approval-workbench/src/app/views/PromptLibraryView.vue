<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { apiGet, apiPatch, apiPost, type ApiError } from '../api'

interface PromptTemplate {
  id: number
  group_name: string
  field_name: string
  prompt_text: string
  size_label: string
  output_format: string
  quality: string
  category_rules: string[]
  gender_rules: string[]
  priority: number
  enabled: number | boolean
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
const selectedTemplateId = ref<number | null>(null)
const message = ref('')
const error = ref('')
const newLibrary = ref({ name: '', scenario: '裂变图' })

const selectedLibrary = computed(() => libraries.value.find((library) => library.id === selectedLibraryId.value) ?? libraries.value[0])
const selectedTemplate = computed(() => selectedLibrary.value?.templates.find((template) => template.id === selectedTemplateId.value) ?? selectedLibrary.value?.templates[0])

async function load() {
  try {
    const data = await apiGet<{ libraries: PromptLibrary[] }>('/api/prompt-libraries')
    libraries.value = data.libraries
    selectedLibraryId.value = selectedLibrary.value?.id ?? null
    selectedTemplateId.value = selectedTemplate.value?.id ?? null
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function createLibrary() {
  error.value = ''
  const template = {
    group_name: 'default',
    field_name: 'main_image',
    prompt_text: '保留商品主体与版型，生成适合测图的电商主图。',
    size_label: '960x1280',
    output_format: 'jpeg',
    quality: 'auto',
    category_rules: [],
    gender_rules: [],
    priority: 10,
    enabled: true,
  }
  try {
    await apiPost('/api/prompt-libraries', { ...newLibrary.value, templates: [template] })
    newLibrary.value.name = ''
    message.value = 'Prompt 库已创建'
    await load()
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function saveTemplate() {
  if (!selectedTemplate.value) return
  await apiPatch(`/api/prompt-templates/${selectedTemplate.value.id}`, selectedTemplate.value)
  message.value = '模板已保存'
  await load()
}

async function publishLibrary() {
  if (!selectedLibrary.value) return
  await apiPost(`/api/prompt-libraries/${selectedLibrary.value.id}/publish-version`)
  message.value = '版本已发布'
  await load()
}

onMounted(load)
</script>

<template>
  <section class="view-stack">
    <p v-if="message" class="notice">{{ message }}</p>
    <p v-if="error" class="notice danger">{{ error }}</p>

    <section class="form-panel view-stack">
      <h2>新建 Prompt 库</h2>
      <div class="inline-fields">
        <label class="field"><span>名称</span><input v-model="newLibrary.name" placeholder="如：天猫测图主图 Prompt" /></label>
        <label class="field"><span>场景</span><select v-model="newLibrary.scenario"><option>裂变图</option><option>创意拍摄</option></select></label>
        <button class="primary-button" type="button" @click="createLibrary">创建库</button>
      </div>
    </section>

    <section class="split-grid">
      <div class="table-panel">
        <div class="table-header"><h2>Prompt 库</h2><button class="ghost-button" type="button" @click="load">刷新</button></div>
        <table class="data-table">
          <thead><tr><th>名称</th><th>场景</th><th>状态</th><th>模板</th></tr></thead>
          <tbody>
            <tr v-for="library in libraries" :key="library.id" @click="selectedLibraryId = library.id; selectedTemplateId = library.templates[0]?.id ?? null">
              <td><strong>{{ library.name }}</strong></td>
              <td>{{ library.scenario }}</td>
              <td><span class="badge">{{ library.status }}</span></td>
              <td>{{ library.templates.length }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <form class="form-panel view-stack" @submit.prevent="saveTemplate">
        <div class="table-header">
          <h2>模板编辑器</h2>
          <button class="small-button" type="button" @click="publishLibrary">发布版本</button>
        </div>
        <label class="field">
          <span>模板</span>
          <select v-model.number="selectedTemplateId">
            <option v-for="template in selectedLibrary?.templates ?? []" :key="template.id" :value="template.id">
              {{ template.group_name }} / {{ template.field_name }}
            </option>
          </select>
        </label>
        <template v-if="selectedTemplate">
          <label class="field"><span>分组</span><input v-model="selectedTemplate.group_name" /></label>
          <label class="field"><span>字段</span><input v-model="selectedTemplate.field_name" /></label>
          <label class="field"><span>Prompt 文本</span><textarea v-model="selectedTemplate.prompt_text" /></label>
          <div class="inline-fields">
            <label class="field"><span>尺寸</span><input v-model="selectedTemplate.size_label" /></label>
            <label class="field"><span>格式</span><input v-model="selectedTemplate.output_format" /></label>
            <label class="field"><span>质量</span><input v-model="selectedTemplate.quality" /></label>
            <label class="field"><span>优先级</span><input v-model.number="selectedTemplate.priority" type="number" /></label>
          </div>
          <button class="primary-button" type="submit">保存模板</button>
        </template>
        <div v-else class="empty-state">选择或创建 Prompt 库后编辑模板</div>
      </form>
    </section>
  </section>
</template>
