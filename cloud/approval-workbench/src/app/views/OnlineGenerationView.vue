<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { apiGet, apiPost, type ApiError } from '../api'

interface BatchRow { batch_uid: string; title: string; status: string }
interface AssetRow { asset_uid: string; style_id: number; kind: string; status: string; filename: string; prompt_text: string }
interface ImageResourceRow {
  resource_uid: string
  batch_uid: string
  style_code: string
  item_id: string
  kind: string
  asset_uid: string
  object_key: string
  filename: string
  source_label: string
}
interface StyleRow { id: number; style_code: string; item_id: string; category: string; gender: string; assets: AssetRow[]; image_resources?: ImageResourceRow[] }
interface DispatchJob { job_uid: string; job_type: string; status: string; assigned_machine_id: string | null; payload?: Record<string, unknown> }
interface BatchDetail { batch_uid: string; title: string; status: string; styles: StyleRow[]; jobs?: DispatchJob[] }
interface MachineRow { machine_id: string; machine_name: string; auth_status: string; health: string; capabilities_json: string }
interface PromptLibrary { id: number; name: string; status: string }
interface PromptTemplate { id: number; template_id?: number; version_id?: number; prompt_text: string; field_name?: string; group_name?: string }

const batches = ref<BatchRow[]>([])
const batchUid = ref('')
const batch = ref<BatchDetail | null>(null)
const selectedStyleId = ref<number | null>(null)
const sourceAssetUid = ref('')
const referenceAssetUids = ref<string[]>([])
const machines = ref<MachineRow[]>([])
const selectedMachineId = ref('')
const promptLibraries = ref<PromptLibrary[]>([])
const selectedLibraryId = ref<number | null>(null)
const promptTemplates = ref<PromptTemplate[]>([])
const selectedTemplateKey = ref('')
const promptText = ref('')
const message = ref('')
const error = ref('')

const styles = computed(() => batch.value?.styles ?? [])
const selectedStyle = computed(() => styles.value.find((style) => style.id === selectedStyleId.value) ?? null)
const sourceAssets = computed(() => selectedStyle.value?.assets.filter((asset) => ['source', 'reference'].includes(asset.kind) && asset.status === 'uploaded') ?? [])
const sourceResources = computed(() => selectedStyle.value?.image_resources?.filter((resource) => ['source', 'reference'].includes(resource.kind)) ?? [])
const selectableResources = computed(() => {
  const resources = sourceResources.value
  if (resources.length > 0) return resources
  return sourceAssets.value.map((asset) => ({
    resource_uid: asset.asset_uid,
    batch_uid: batch.value?.batch_uid ?? '',
    style_code: selectedStyle.value?.style_code ?? '',
    item_id: selectedStyle.value?.item_id ?? '',
    kind: asset.kind,
    asset_uid: asset.asset_uid,
    object_key: '',
    filename: asset.filename,
    source_label: '',
  }))
})
const generationMachines = computed(() => machines.value.filter((machine) => machine.auth_status === 'active' && machine.capabilities_json.includes('generate_ai_image')))
const generationJobs = computed(() => (batch.value?.jobs ?? []).filter((job) => job.job_type === 'generate_ai_image'))

watch(selectedStyleId, () => {
  sourceAssetUid.value = selectableResources.value[0]?.asset_uid ?? ''
  referenceAssetUids.value = selectableResources.value.slice(0, 3).map((resource) => resource.asset_uid)
})

watch([selectedLibraryId, selectedStyleId], () => {
  void loadResolvedPrompts()
})

watch(selectedTemplateKey, () => {
  const template = promptTemplates.value.find((item) => templateKey(item) === selectedTemplateKey.value)
  if (template?.prompt_text) promptText.value = template.prompt_text
})

async function loadBatches() {
  try {
    const data = await apiGet<{ batches: BatchRow[] }>('/api/ai-image-batches')
    batches.value = data.batches
    batchUid.value ||= data.batches[0]?.batch_uid ?? ''
    if (batchUid.value) await loadBatch()
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function loadBatch() {
  if (!batchUid.value) return
  try {
    const data = await apiGet<{ batch: BatchDetail }>(`/api/ai-image-batches/${encodeURIComponent(batchUid.value)}`)
    batch.value = data.batch
    selectedStyleId.value = data.batch.styles[0]?.id ?? null
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

async function loadMachines() {
  try {
    const data = await apiGet<{ machines: MachineRow[] }>('/api/admin/machines')
    machines.value = data.machines
  } catch {
    machines.value = []
  }
}

async function loadPromptLibraries() {
  try {
    const data = await apiGet<{ libraries: PromptLibrary[] }>('/api/prompt-libraries')
    promptLibraries.value = data.libraries.filter((library) => library.status === 'published')
    selectedLibraryId.value = promptLibraries.value[0]?.id ?? null
  } catch {
    promptLibraries.value = []
  }
}

async function loadResolvedPrompts() {
  if (!selectedLibraryId.value || !selectedStyle.value) {
    promptTemplates.value = []
    selectedTemplateKey.value = ''
    return
  }
  const params = new URLSearchParams()
  if (selectedStyle.value.category) params.set('category', selectedStyle.value.category)
  if (selectedStyle.value.gender) params.set('gender', selectedStyle.value.gender)
  try {
    const data = await apiGet<{ templates: PromptTemplate[] }>(`/api/prompt-libraries/${selectedLibraryId.value}/resolved?${params.toString()}`)
    promptTemplates.value = data.templates
    selectedTemplateKey.value = templateKey(data.templates[0])
  } catch {
    promptTemplates.value = []
  }
}

function templateKey(template?: PromptTemplate): string {
  if (!template) return ''
  return String(template.version_id ?? template.id ?? template.template_id ?? '')
}

function toggleReference(assetUid: string) {
  referenceAssetUids.value = referenceAssetUids.value.includes(assetUid)
    ? referenceAssetUids.value.filter((uid) => uid !== assetUid)
    : [...referenceAssetUids.value, assetUid]
}

function resourceDownloadUrl(resource: ImageResourceRow): string {
  return `/api/assets/${encodeURIComponent(resource.asset_uid)}/download`
}

async function submitGeneration() {
  if (!batch.value || !selectedStyle.value) return
  error.value = ''
  try {
    await apiPost(`/api/ai-image-batches/${encodeURIComponent(batch.value.batch_uid)}/generate`, {
      style_id: selectedStyle.value.id,
      source_asset_uid: sourceAssetUid.value,
      reference_asset_uids: referenceAssetUids.value,
      prompt_template_version_id: Number(selectedTemplateKey.value) || null,
      prompt_text: promptText.value,
      machine_id: selectedMachineId.value || undefined,
    })
    message.value = '在线生图任务已创建'
    await loadBatch()
  } catch (caught) {
    error.value = (caught as ApiError).message
  }
}

onMounted(() => {
  loadBatches()
  loadMachines()
  loadPromptLibraries()
})
</script>

<template>
  <section class="view-stack">
    <section class="panel toolbar">
      <label class="field">
        <span>批次</span>
        <select v-model="batchUid" @change="loadBatch">
          <option v-for="item in batches" :key="item.batch_uid" :value="item.batch_uid">{{ item.title }}</option>
        </select>
      </label>
      <button class="ghost-button" type="button" @click="loadBatch">刷新</button>
    </section>

    <p v-if="message" class="notice">{{ message }}</p>
    <p v-if="error" class="notice danger">{{ error }}</p>

    <section v-if="batch" class="split-grid">
      <div class="table-panel">
        <div class="table-header">
          <h2>{{ batch.title }}</h2>
          <span class="badge">{{ batch.status }}</span>
        </div>
        <table class="data-table">
          <thead><tr><th>款式</th><th>类目</th><th>可用素材</th></tr></thead>
          <tbody>
            <tr v-for="style in styles" :key="style.id" @click="selectedStyleId = style.id">
              <td><strong>{{ style.style_code }}</strong><br /><span class="muted">{{ style.item_id || '-' }}</span></td>
              <td>{{ style.category || '-' }} / {{ style.gender || '-' }}</td>
              <td>{{ style.image_resources?.filter((resource) => ['source', 'reference'].includes(resource.kind)).length ?? style.assets.filter((asset) => ['source', 'reference'].includes(asset.kind)).length }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <aside class="form-panel view-stack">
        <h2>{{ selectedStyle?.style_code || '选择款式' }}</h2>
        <label class="field">
          <span>主图</span>
          <select v-model="sourceAssetUid">
            <option v-for="resource in selectableResources" :key="resource.resource_uid" :value="resource.asset_uid">{{ resource.source_label || resource.kind }} / {{ resource.filename }}</option>
          </select>
        </label>
        <div class="asset-rail">
          <h2>资源库</h2>
          <div v-if="selectableResources.length === 0" class="asset-row muted">当前款式还没有可用于生图的来源资源。</div>
          <label v-for="resource in selectableResources" :key="resource.resource_uid" class="asset-row inline-check">
            <input type="checkbox" :checked="referenceAssetUids.includes(resource.asset_uid)" @change="toggleReference(resource.asset_uid)" />
            <span class="badge">{{ resource.kind }}</span>
            <span v-if="resource.source_label" class="badge">{{ resource.source_label }}</span>
            <span>{{ resource.filename }}</span>
            <a class="small-button" :href="resourceDownloadUrl(resource)" target="_blank" rel="noopener" @click.stop>下载</a>
          </label>
        </div>
        <label class="field">
          <span>Prompt 库</span>
          <select v-model="selectedLibraryId">
            <option v-for="library in promptLibraries" :key="library.id" :value="library.id">{{ library.name }}</option>
          </select>
        </label>
        <label class="field">
          <span>Prompt 模板</span>
          <select v-model="selectedTemplateKey">
            <option v-for="template in promptTemplates" :key="templateKey(template)" :value="templateKey(template)">
              {{ template.group_name || 'Prompt' }} / {{ template.field_name || templateKey(template) }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>提交前 Prompt</span>
          <textarea v-model="promptText" rows="8" placeholder="选择模板后可编辑"></textarea>
        </label>
        <label class="field">
          <span>目标任务机</span>
          <select v-model="selectedMachineId">
            <option value="">任意具备生图能力的任务机</option>
            <option v-for="machine in generationMachines" :key="machine.machine_id" :value="machine.machine_id">{{ machine.machine_name }} / {{ machine.health }}</option>
          </select>
        </label>
        <button class="primary-button full" type="button" :disabled="!sourceAssetUid || !promptText" @click="submitGeneration">创建在线生图任务</button>
      </aside>
    </section>

    <section v-if="generationJobs.length" class="panel">
      <h2>在线生图任务</h2>
      <table class="data-table">
        <thead><tr><th>任务</th><th>状态</th><th>款式</th><th>任务机</th></tr></thead>
        <tbody>
          <tr v-for="job in generationJobs" :key="job.job_uid">
            <td>{{ job.job_uid }}</td>
            <td><span class="badge">{{ job.status }}</span></td>
            <td>{{ job.payload?.style_code || job.payload?.style_id || '-' }}</td>
            <td>{{ job.assigned_machine_id || '任意' }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>
