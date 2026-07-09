<template>
  <section class="aiw-workbench aiw-option-3">
    <header class="aiw-topbar">
      <div>
        <p class="aiw-kicker">AI 生图</p>
        <h2>AI 生图工作台</h2>
        <p class="aiw-subtitle">支持主图、参考图、Prompt、比例尺寸联动和多模型生成</p>
      </div>
      <div class="aiw-top-actions">
        <button class="aiw-ghost" type="button" @click="createNewTask">新建任务</button>
        <button class="aiw-ghost" type="button" @click="historyOpen = !historyOpen">
          {{ historyOpen ? '收起任务记录' : '任务记录' }}
        </button>
        <button class="aiw-ghost" type="button" @click="openOutputFolder">打开输出文件夹</button>
        <button class="aiw-ghost" type="button" @click="openSettings">配置模型 Key</button>
      </div>
    </header>

    <div class="aiw-main-grid" :class="{ 'history-collapsed': !historyOpen }">
      <aside class="aiw-prompt-panel aiw-task-panel">
        <div class="aiw-panel-head">
          <span>当前任务</span>
          <button type="button" @click="resetForm">重置</button>
        </div>

        <section class="aiw-material-box aiw-title-box">
          <label class="aiw-field">
            <span>任务名称</span>
            <input v-model.trim="form.title" type="text" placeholder="给这次生图任务起个名字" />
          </label>
        </section>

        <section class="aiw-material-box aiw-prompt-box">
          <div class="aiw-panel-head">
            <span>Prompt</span>
            <button type="button" @click="form.prompt = ''">清空</button>
          </div>
          <textarea v-model.trim="form.prompt" placeholder="描述商品、卖点、模特姿态、背景和禁用元素..."></textarea>
        </section>

        <section class="aiw-material-box">
          <div class="aiw-panel-head">
            <span>主图</span>
            <button type="button" @click="chooseMainImage">{{ form.mainImagePath ? '重新选择' : '选择文件' }}</button>
          </div>
          <button v-if="!form.mainImagePath" class="aiw-upload-tile" type="button" @click="chooseMainImage">
            <strong>点击上传主图</strong>
            <span>用于主体保持、商品参考或图生图</span>
          </button>
          <div v-else class="aiw-picked-asset">
            <div class="aiw-thumb">
              <img
                v-if="imagePreviewSrc(form.mainImagePath)"
                :src="imagePreviewSrc(form.mainImagePath)"
                :alt="pathLabel(form.mainImagePath)"
                @error="markPreviewBroken(form.mainImagePath)"
              />
              <div v-else class="aiw-preview-fallback">
                <strong>{{ previewInitial(form.mainImagePath) }}</strong>
              </div>
            </div>
            <div>
              <strong>{{ pathLabel(form.mainImagePath) }}</strong>
              <span>{{ form.mainImagePath }}</span>
            </div>
            <button type="button" @click="removeMainImage">移除</button>
          </div>
        </section>

        <section class="aiw-material-box">
          <div class="aiw-panel-head">
            <span>参考图</span>
            <button type="button" @click="chooseReferenceImages">添加文件</button>
          </div>
          <button class="aiw-upload-tile compact" type="button" @click="chooseReferenceImages">
            <strong>点击添加参考图</strong>
            <span>可多选，最多建议 8 张</span>
          </button>
          <div v-if="form.referenceImagePaths.length" class="aiw-reference-grid">
            <article v-for="(path, index) in form.referenceImagePaths" :key="`${path}-${index}`" class="aiw-reference-card">
              <div class="aiw-thumb">
                <img
                  v-if="imagePreviewSrc(path)"
                  :src="imagePreviewSrc(path)"
                  :alt="pathLabel(path)"
                  @error="markPreviewBroken(path)"
                />
                <div v-else class="aiw-preview-fallback">
                  <strong>{{ previewInitial(path) }}</strong>
                </div>
              </div>
              <span>{{ pathLabel(path) }}</span>
              <button type="button" @click="removeReferencePath(index)">移除</button>
            </article>
          </div>
        </section>

        <section class="aiw-material-box">
          <div class="aiw-panel-head">
            <span>生图参数</span>
          </div>
          <div class="aiw-task-fields" aria-label="生成参数">
            <label class="aiw-field aiw-field-wide">
              <span>模型</span>
              <select v-model="form.modelId" @change="syncModelDefaults">
                <option v-for="model in AI_IMAGE_MODELS" :key="model.id" :value="model.id">{{ model.label }}</option>
              </select>
            </label>
            <label class="aiw-field">
              <span>比例</span>
              <select v-model="form.ratio" @change="syncSizeFromRatio">
                <option v-for="ratio in AI_IMAGE_RATIOS" :key="ratio" :value="ratio">{{ ratio }}</option>
              </select>
            </label>
            <label class="aiw-field">
              <span>尺寸</span>
              <select v-model="form.size" @change="syncRatioFromSize">
                <option v-for="size in sizeOptions" :key="size" :value="size">{{ size }}</option>
              </select>
            </label>
            <label class="aiw-field">
              <span>质量</span>
              <select v-model="form.quality">
                <option v-for="quality in AI_IMAGE_QUALITIES" :key="quality" :value="quality">{{ quality }}</option>
              </select>
            </label>
            <label class="aiw-field">
              <span>格式</span>
              <select v-model="form.format">
                <option v-for="format in AI_IMAGE_FORMATS" :key="format" :value="format">{{ format.toUpperCase() }}</option>
              </select>
            </label>
            <label class="aiw-field">
              <span>张数</span>
              <input v-model.number="form.count" type="number" min="1" max="8" />
            </label>
            <div class="aiw-key-status" :class="{ missing: Boolean(activeMissingKey) }">
              <span>Key 状态</span>
              <strong>{{ activeMissingKey ? '未配置' : '可生成' }}</strong>
            </div>
          </div>
        </section>

        <section class="aiw-material-box">
          <div class="aiw-panel-head">
            <span>输出文件夹</span>
            <button type="button" @click="chooseOutputFolder">选择文件夹</button>
          </div>
          <button class="aiw-path-button" type="button" @click="chooseOutputFolder">
            <strong>{{ form.output_dir ? pathLabel(form.output_dir) : '点击选择输出文件夹' }}</strong>
            <span>{{ form.output_dir || outputDirHint() }}</span>
          </button>
        </section>

        <section class="aiw-material-box">
          <span class="aiw-field-label">高级 JSON</span>
          <textarea v-model.trim="form.advancedJson" class="aiw-advanced-json" placeholder='{"background":"white"}'></textarea>
        </section>

        <section class="aiw-generate-card">
          <button class="aiw-primary-action" type="button" :disabled="generating" @click="generate">{{ generateLabel }}</button>
          <small v-if="errorMessage">{{ errorMessage }}</small>
        </section>
      </aside>

      <main class="aiw-results-grid" aria-label="生成结果" :aria-busy="generating ? 'true' : 'false'">
        <div class="aiw-workspace-head">
          <div>
            <strong>{{ currentJob?.title || '本次生成' }}</strong>
            <span>{{ summaryLine }}</span>
          </div>
          <div class="aiw-results-actions">
            <span>{{ selectedResultItems.length ? `已选 ${selectedResultItems.length} 张` : '未选择图片' }}</span>
            <button type="button" :disabled="!allVisibleSelectableItems.length" @click="selectAllVisibleResults">
              {{ allVisibleSelected ? '取消全选' : '全选图片' }}
            </button>
            <button type="button" :disabled="!selectedResultItems.length" @click="saveAs(selectedResultItems)">另存选中</button>
            <div class="aiw-tabs">
              <button :class="{ active: workspaceMode === 'results' }" type="button" @click="workspaceMode = 'results'">结果</button>
              <button :class="{ active: workspaceMode === 'logs' }" type="button" @click="workspaceMode = 'logs'">日志</button>
            </div>
          </div>
        </div>

        <section v-if="workspaceMode === 'results'" class="aiw-result-wall">
          <section
            v-for="queue in visibleResultQueues"
            :key="queue.key"
            class="aiw-result-queue"
            :class="{ loading: queue.loading }"
          >
            <header class="aiw-result-queue-head">
              <div>
                <strong>{{ queue.title }}</strong>
                <span>{{ queueMetaLine(queue) }}</span>
              </div>
              <p v-if="queuePromptLine(queue)">{{ queuePromptLine(queue) }}</p>
            </header>
            <div class="aiw-result-list">
              <article
                v-for="item in queue.items"
                :key="item.key || item.path || item.url"
                class="aiw-result-card"
                :class="{ selected: selectedResults.has(resultKey(item)), loading: item.loading }"
                :aria-pressed="selectedResults.has(resultKey(item)) ? 'true' : 'false'"
                :tabindex="item.loading ? -1 : 0"
                role="button"
                @click="toggleResult(item)"
                @keydown.enter.prevent="toggleResult(item)"
                @keydown.space.prevent="toggleResult(item)"
              >
                <button v-if="!item.loading" class="aiw-select-toggle" type="button" @click.stop="toggleResult(item)">
                  {{ selectedResults.has(resultKey(item)) ? '已选' : '选择' }}
                </button>
                <button v-if="!item.loading" class="aiw-preview-button" type="button" @click.stop="openLightbox(item)">
                  <img
                    v-if="imagePreviewSrc(resultPreviewKey(item))"
                    :src="imagePreviewSrc(resultPreviewKey(item))"
                    :alt="item.label"
                    @error="markPreviewBroken(resultPreviewKey(item))"
                  />
                  <span v-else class="aiw-result-preview">{{ item.label }}</span>
                </button>
                <div v-else class="aiw-loading-preview">
                  <span aria-hidden="true"></span>
                  <strong>{{ item.label }}</strong>
                </div>
                <footer v-if="!item.loading">
                  <div>
                    <strong>{{ item.label }}</strong>
                    <span>{{ item.model || activeModel.label }} · {{ item.size || form.size }}</span>
                  </div>
                  <div>
                    <button type="button" @click.stop="saveAs([item])">另存为</button>
                    <button type="button" @click.stop="setAsMain(item)">设为主图</button>
                    <button type="button" @click.stop="addAsReference(item)">加入参考图</button>
                  </div>
                </footer>
              </article>
            </div>
          </section>
          <div v-if="!visibleResultCards.length" class="aiw-empty-state">
            <strong>等待生成结果</strong>
            <span>选择已有任务或新建任务后，输出图会保留在对应任务里。</span>
          </div>
        </section>

        <section v-else class="aiw-log-panel">
          <pre>{{ logs.join('\n') || '暂无日志' }}</pre>
        </section>
      </main>

      <aside v-if="historyOpen" class="aiw-history-drawer">
        <div class="aiw-panel-head">
          <span>任务记录</span>
          <div class="aiw-history-actions">
            <button type="button" @click="createNewTask">新建</button>
            <button type="button" @click="loadJobs">刷新</button>
          </div>
        </div>
        <ol>
          <li v-for="job in taskRecords" :key="job.job_uid">
            <button
              class="aiw-history-item"
              :class="{ active: highlightedJobUid === job.job_uid }"
              type="button"
              @click="restoreJob(job)"
            >
              <strong>{{ job.title || job.job_uid }}</strong>
              <div v-if="taskPreviewItems(job).length" class="aiw-history-thumbs">
                <span
                  v-for="item in taskPreviewItems(job)"
                  :key="resultKey(item)"
                  class="aiw-history-thumb"
                >
                  <img
                    v-if="imagePreviewSrc(resultPreviewKey(item))"
                    :src="imagePreviewSrc(resultPreviewKey(item))"
                    :alt="item.label"
                    @error="markPreviewBroken(resultPreviewKey(item))"
                  />
                  <strong v-else>{{ previewInitial(resultPreviewKey(item)) }}</strong>
                </span>
              </div>
              <span>{{ taskMetaLine(job) }}</span>
              <small>{{ taskResultLine(job) }}</small>
            </button>
          </li>
        </ol>
        <div v-if="!taskRecords.length" class="aiw-history-empty">
          <strong>暂无任务</strong>
          <span>点击新建任务后，可以在这里切换每一次生图记录。</span>
        </div>
      </aside>
    </div>
    <div v-if="lightboxItem" class="aiw-lightbox" @click="closeLightbox">
      <figure @click.stop>
        <button class="aiw-lightbox-close" type="button" @click="closeLightbox">关闭</button>
        <img
          v-if="lightboxSrc"
          :src="lightboxSrc"
          :alt="lightboxItem.label"
          @error="markPreviewBroken(resultPreviewKey(lightboxItem))"
        />
        <div v-else class="aiw-lightbox-fallback">{{ lightboxItem.label }}</div>
        <figcaption>
          <strong>{{ lightboxItem.label }}</strong>
          <span>{{ lightboxItem.model || activeModel.label }} · {{ lightboxItem.size || form.size }}</span>
        </figcaption>
      </figure>
    </div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  AI_IMAGE_FORMATS,
  AI_IMAGE_MODELS,
  AI_IMAGE_QUALITIES,
  AI_IMAGE_RATIOS,
  defaultAiImageForm,
  defaultSizeForRatio,
  getAiImageModel,
  missingKeyForModel,
  modelIdForJob,
  outputDirHint,
  ratioForSize,
  sizeForRatio,
  sizesForRatio,
} from '../utils/aiImageModels.js'

const emit = defineEmits(['open-settings'])

const STORAGE_KEY = 'crawshrimp.aiImageWorkbench.state.v2'
const AUTOSAVE_DELAY_MS = 700

const form = reactive(defaultAiImageForm())
const jobs = ref([])
const settings = ref({})
const currentJob = ref(null)
const selectedResults = reactive(new Set())
const workspaceMode = ref('results')
const historyOpen = ref(true)
const generating = ref(false)
const errorMessage = ref('')
const logs = ref([])
const imagePreviews = reactive({})
const previewFailures = reactive(new Set())
const taskDrafts = reactive({})
const pendingActiveJobUid = ref('')
const lightboxItem = ref(null)
let autosaveTimer = null
let restoringState = false

const activeModel = computed(() => getAiImageModel(form.modelId))
const activeMissingKey = computed(() => missingKeyForModel(form.modelId, settings.value))
const activeJobUid = computed(() => currentJob.value?.job_uid || '')
const highlightedJobUid = computed(() => pendingActiveJobUid.value || activeJobUid.value)
const resultQueues = computed(() => collectResultQueues(currentJob.value))
const resultCards = computed(() => resultQueues.value.flatMap((queue) => queue.items || []))
const loadingResultCards = computed(() => {
  if (!generating.value) return []
  const count = Math.max(1, Math.min(8, Number(form.count) || 1))
  return Array.from({ length: count }, (_, index) => ({
    key: `loading-${index + 1}`,
    label: `生成中 ${index + 1}`,
    loading: true,
  }))
})
const loadingResultQueue = computed(() => ({
  key: 'loading-current-run',
  title: '正在生成',
  createdAt: '',
  prompt: form.prompt,
  status: 'running',
  loading: true,
  items: loadingResultCards.value,
}))
const visibleResultQueues = computed(() => {
  const queues = [...resultQueues.value]
  if (loadingResultCards.value.length) return [loadingResultQueue.value, ...queues]
  return queues
})
const visibleResultCards = computed(() => visibleResultQueues.value.flatMap((queue) => queue.items || []))
const allVisibleSelectableItems = computed(() => visibleResultCards.value.filter((item) => !item.loading && resultKey(item)))
const allVisibleSelected = computed(() => (
  allVisibleSelectableItems.value.length > 0
  && allVisibleSelectableItems.value.every((item) => selectedResults.has(resultKey(item)))
))
const sizeOptions = computed(() => sizesForRatio(form.ratio))
const selectedResultItems = computed(() => resultCards.value.filter((item) => selectedResults.has(resultKey(item))))
const generateLabel = computed(() => activeMissingKey.value ? '配置模型 Key' : generating.value ? '生成中...' : '开始生成')
const lightboxSrc = computed(() => lightboxItem.value ? imagePreviewSrc(resultPreviewKey(lightboxItem.value)) : '')
const taskRecords = computed(() => {
  const records = []
  const seen = new Set()
  for (const job of jobs.value) {
    const jobUid = job?.job_uid
    if (!jobUid || seen.has(jobUid)) continue
    const source = jobUid === activeJobUid.value && currentJob.value?.job_uid === jobUid
      ? { ...job, ...currentJob.value }
      : job
    records.push(mergeJobWithDraft(source))
    seen.add(jobUid)
  }
  if (currentJob.value?.job_uid && !seen.has(currentJob.value.job_uid)) {
    records.unshift(mergeJobWithDraft(currentJob.value))
    seen.add(currentJob.value.job_uid)
  }
  return records
})
const summaryLine = computed(() => {
  const status = currentJob.value?.status || '未开始'
  return `${activeModel.value.label} · ${form.ratio} · ${form.size} · ${form.count} 张 · ${status}`
})

onMounted(async () => {
  restorePersistedWorkbench()
  await Promise.all([loadSettings(), loadJobs()])
  await restoreInitialTask()
})

onBeforeUnmount(() => {
  if (autosaveTimer) clearTimeout(autosaveTimer)
  saveDraftForCurrentTask()
  persistWorkbenchState()
})

watch(() => form.mainImagePath, (path) => {
  void refreshImagePreview(path)
})

watch(() => [...form.referenceImagePaths], (paths) => {
  paths.forEach((path) => void refreshImagePreview(path))
})

watch(resultCards, (cards) => {
  cards.forEach((item) => void refreshImagePreview(resultPreviewKey(item)))
})

watch(taskRecords, (records) => {
  records.forEach((job) => {
    taskPreviewItems(job).forEach((item) => void refreshImagePreview(resultPreviewKey(item)))
  })
})

watch(form, () => {
  if (restoringState) return
  saveDraftForCurrentTask()
  persistWorkbenchState()
  scheduleTaskAutosave()
}, { deep: true })

watch([currentJob, workspaceMode, historyOpen], () => {
  if (restoringState) return
  persistWorkbenchState()
})

function formSnapshot() {
  return {
    title: form.title,
    modelId: form.modelId,
    model_key: form.model_key,
    model_key_tier: form.model_key_tier,
    size: form.size,
    ratio: form.ratio,
    quality: form.quality,
    format: form.format,
    count: form.count,
    output_dir: form.output_dir,
    prompt: form.prompt,
    advancedJson: form.advancedJson,
    mainImagePath: form.mainImagePath,
    referenceImagePaths: [...form.referenceImagePaths],
  }
}

function applyFormSnapshot(snapshot = {}) {
  const next = {
    ...defaultAiImageForm({ modelId: snapshot.modelId }),
    ...snapshot,
    referenceImagePaths: Array.isArray(snapshot.referenceImagePaths) ? snapshot.referenceImagePaths : [],
  }
  Object.assign(form, next)
}

function saveDraftForCurrentTask() {
  const key = activeJobUid.value || 'latest'
  taskDrafts[key] = formSnapshot()
}

function mergeJobWithDraft(job = {}) {
  const draft = taskDrafts[job.job_uid] || {}
  const params = job.params && typeof job.params === 'object' ? job.params : {}
  const draftParams = {
    size: draft.size,
    ratio: draft.ratio,
    quality: draft.quality,
    response_format: draft.format,
    n: draft.count,
    model_key_tier: draft.model_key_tier,
    main_image_path: draft.mainImagePath,
    reference_image_paths: draft.referenceImagePaths,
  }
  return {
    ...job,
    title: draft.title || job.title,
    prompt: draft.prompt ?? job.prompt,
    output_dir: draft.output_dir || job.output_dir,
    params: {
      ...params,
      ...Object.fromEntries(Object.entries(draftParams).filter(([, value]) => value !== undefined && value !== '')),
    },
  }
}

function restorePersistedWorkbench() {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    restoringState = true
    if (saved?.form && typeof saved.form === 'object') applyFormSnapshot(saved.form)
    if (saved?.drafts && typeof saved.drafts === 'object') {
      Object.entries(saved.drafts).forEach(([key, value]) => {
        if (value && typeof value === 'object') taskDrafts[key] = value
      })
    }
    if (saved?.activeJobUid) currentJob.value = { job_uid: saved.activeJobUid, status: 'draft' }
    if (typeof saved?.historyOpen === 'boolean') historyOpen.value = saved.historyOpen
    if (saved?.workspaceMode === 'logs' || saved?.workspaceMode === 'results') workspaceMode.value = saved.workspaceMode
    if (Array.isArray(saved?.logs)) logs.value = saved.logs.slice(-80)
  } catch (error) {
    logs.value.push(`恢复 AI 生图草稿失败：${error.message || error}`)
  } finally {
    restoringState = false
  }
}

function persistWorkbenchState() {
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify({
      activeJobUid: activeJobUid.value,
      form: formSnapshot(),
      drafts: taskDrafts,
      historyOpen: historyOpen.value,
      workspaceMode: workspaceMode.value,
      logs: logs.value.slice(-80),
    }))
  } catch {}
}

async function restoreInitialTask() {
  if (activeJobUid.value) {
    const matching = jobs.value.find((job) => job.job_uid === activeJobUid.value) || currentJob.value
    await restoreJob(matching, { preserveCurrentDraft: false })
    return
  }
  if (jobs.value[0]) await restoreJob(jobs.value[0], { preserveCurrentDraft: false })
}

function syncModelDefaults() {
  const model = activeModel.value
  form.model_key = model.key
  form.model_key_tier = model.keyTier
  form.size = defaultSizeForRatio(form.ratio, model.keyTier)
  syncRatioFromSize()
}

function syncSizeFromRatio() {
  form.size = sizeForRatio(form.ratio, form.size, activeModel.value.keyTier)
}

function syncRatioFromSize() {
  form.ratio = ratioForSize(form.size, form.ratio)
}

function resetForm() {
  const currentTitle = form.title || currentJob.value?.title || 'AI 生图任务'
  Object.assign(form, defaultAiImageForm({ title: currentTitle, output_dir: form.output_dir }))
  selectedResults.clear()
  if (currentJob.value?.job_uid) {
    currentJob.value = {
      ...currentJob.value,
      status: 'draft',
      summary: {},
      params: buildJobPayload({ silentAdvanced: true }).params,
    }
  }
  errorMessage.value = ''
  previewFailures.clear()
  saveDraftForCurrentTask()
  persistWorkbenchState()
  scheduleTaskAutosave()
}

function openSettings() {
  emit('open-settings', 'ai-1xm')
}

async function choosePath(opts = {}) {
  if (typeof window?.cs?.browseFile !== 'function') {
    errorMessage.value = '当前环境不支持系统文件选择器，请在抓虾桌面端使用'
    return opts.multi ? [] : ''
  }
  try {
    return await window.cs.browseFile(opts)
  } catch (error) {
    errorMessage.value = error.message || String(error)
    return opts.multi ? [] : ''
  }
}

async function chooseMainImage() {
  const path = await choosePath({
    title: '选择主图文件',
    images: true,
  })
  if (path) {
    form.mainImagePath = path
    await refreshImagePreview(path, { force: true })
  }
}

async function chooseReferenceImages() {
  const paths = await choosePath({
    title: '选择参考图文件',
    images: true,
    multi: true,
  })
  const nextPaths = (Array.isArray(paths) ? paths : [paths])
    .map((path) => String(path || '').trim())
    .filter(Boolean)
  for (const path of nextPaths) {
    if (!form.referenceImagePaths.includes(path)) form.referenceImagePaths.push(path)
    await refreshImagePreview(path, { force: true })
  }
}

async function chooseOutputFolder() {
  const directory = await chooseDirectory('选择 AI 生图输出文件夹')
  if (directory) form.output_dir = directory
}

async function chooseDirectory(title = '选择文件夹') {
  return choosePath({
    title,
    directory: true,
    defaultPath: form.output_dir,
  })
}

async function loadSettings() {
  try {
    settings.value = typeof window?.cs?.getSettings === 'function' ? await window.cs.getSettings() : {}
  } catch (error) {
    logs.value.push(`读取设置失败：${error.message || error}`)
    settings.value = {}
  }
}

async function loadJobs() {
  try {
    const response = await window.cs.listAiImageJobs()
    jobs.value = Array.isArray(response) ? response : response?.items || []
  } catch (error) {
    logs.value.push(`读取历史失败：${error.message || error}`)
  }
}

function parseAdvancedJson(options = {}) {
  if (!form.advancedJson) return {}
  try {
    return JSON.parse(form.advancedJson)
  } catch (error) {
    if (options.silent) return {}
    throw error
  }
}

function buildJobPayload(options = {}) {
  const normalizedSize = sizeForRatio(form.ratio, form.size, activeModel.value.keyTier)
  if (normalizedSize !== form.size) form.size = normalizedSize
  const params = {
    size: normalizedSize,
    ratio: form.ratio,
    quality: form.quality,
    response_format: form.format,
    n: Number(form.count) || 1,
    model_key_tier: activeModel.value.keyTier,
    main_image_path: form.mainImagePath,
    reference_image_paths: [...form.referenceImagePaths],
    ...parseAdvancedJson({ silent: options.silentAdvanced }),
  }
  params.size = sizeForRatio(form.ratio, params.size, activeModel.value.keyTier)
  return {
    title: form.title || 'AI 生图任务',
    prompt: form.prompt,
    model_key: activeModel.value.key,
    output_dir: form.output_dir,
    params,
  }
}

function scheduleTaskAutosave() {
  if (!currentJob.value?.job_uid || typeof window?.cs?.updateAiImageJob !== 'function') return
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null
    void autosaveCurrentTask()
  }, AUTOSAVE_DELAY_MS)
}

async function autosaveCurrentTask() {
  const jobUid = activeJobUid.value
  if (!jobUid || generating.value || typeof window?.cs?.updateAiImageJob !== 'function') return null
  try {
    const payload = buildJobPayload({ silentAdvanced: true })
    const status = currentJob.value?.status || 'draft'
    const updated = await window.cs.updateAiImageJob(jobUid, { ...payload, status })
    if (updated?.job_uid === jobUid) {
      currentJob.value = {
        ...currentJob.value,
        ...updated,
        summary: currentJob.value?.summary || updated.summary,
        assets: currentJob.value?.assets || updated.assets,
      }
      upsertJob(updated)
    }
    return updated
  } catch (error) {
    logs.value.push(`自动保存任务失败：${error.message || error}`)
    return null
  }
}

function upsertJob(job) {
  if (!job?.job_uid) return
  const index = jobs.value.findIndex((item) => item.job_uid === job.job_uid)
  if (index >= 0) jobs.value.splice(index, 1, job)
  else jobs.value.unshift(job)
}

async function ensureCurrentTask() {
  if (currentJob.value?.job_uid) {
    const saved = await autosaveCurrentTask()
    return saved || currentJob.value
  }
  const created = await window.cs.createAiImageJob({ ...buildJobPayload({ silentAdvanced: true }), status: 'draft' })
  currentJob.value = created
  upsertJob(created)
  saveDraftForCurrentTask()
  persistWorkbenchState()
  return created
}

function nextTaskTitle() {
  return `AI 生图任务 ${Math.max(1, jobs.value.length + 1)}`
}

async function createNewTask() {
  if (generating.value) return
  saveDraftForCurrentTask()
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = null
  await autosaveCurrentTask()
  const previous = formSnapshot()
  const next = defaultAiImageForm({
    title: nextTaskTitle(),
    modelId: previous.modelId,
    ratio: previous.ratio,
    size: previous.size,
    quality: previous.quality,
    format: previous.format,
    count: previous.count,
    output_dir: previous.output_dir,
  })
  restoringState = true
  applyFormSnapshot(next)
  selectedResults.clear()
  errorMessage.value = ''
  workspaceMode.value = 'results'
  restoringState = false
  try {
    const created = await window.cs.createAiImageJob({ ...buildJobPayload({ silentAdvanced: true }), status: 'draft' })
    currentJob.value = created
    upsertJob(created)
    taskDrafts[created.job_uid] = formSnapshot()
    historyOpen.value = true
    logs.value.push(`新建生图任务：${created.job_uid}`)
  } catch (error) {
    currentJob.value = null
    errorMessage.value = error.message || String(error)
    logs.value.push(`新建任务失败：${errorMessage.value}`)
  } finally {
    persistWorkbenchState()
  }
}

async function generate() {
  errorMessage.value = ''
  if (activeMissingKey.value) {
    openSettings()
    return
  }
  if (generating.value) return
  generating.value = true
  selectedResults.clear()
  logs.value.push('创建 AI 生图任务')
  try {
    const activeTask = await ensureCurrentTask()
    const jobUid = activeTask?.job_uid
    if (!jobUid) throw new Error('后端未返回 job_uid')
    const previousSummary = currentJob.value?.summary || activeTask.summary || {}
    currentJob.value = {
      ...activeTask,
      ...buildJobPayload({ silentAdvanced: true }),
      job_uid: jobUid,
      status: 'running',
      summary: previousSummary,
    }
    logs.value.push(`提交生成任务：${jobUid}`)
    const runResult = await window.cs.runAiImageJob(jobUid)
    const latest = await window.cs.getAiImageJob(jobUid)
    currentJob.value = mergeJobWithDraft(latest || activeTask)
    upsertJob(latest || activeTask)
    if (runResult && runResult.ok === false) {
      throw new Error(runResult.summary?.error || '生成任务失败，请查看日志')
    }
    const warning = runResult?.summary?.warning || latest?.summary?.warning || ''
    if (warning) logs.value.push(warning)
    selectedResults.clear()
    logs.value.push(`生成完成：${jobUid}`)
    await loadJobs()
  } catch (error) {
    errorMessage.value = normalizeGenerateError(error)
    logs.value.push(`生成失败：${errorMessage.value}`)
  } finally {
    generating.value = false
  }
}

function normalizeGenerateError(error) {
  const detail = error?.detail?.message || error?.message || String(error || '')
  const text = String(detail || '').trim()
  if (/^not found$/i.test(text) || /ai image job not found/i.test(text)) {
    return '本地 AI 生图服务未就绪，请重启抓虾客户端后再试'
  }
  return text || '生成失败，请查看日志'
}

async function createInputAssets(jobUid) {
  const calls = []
  if (form.mainImagePath) {
    calls.push(window.cs.createAiImageAsset({
      job_uid: jobUid,
      kind: 'main',
      source_type: 'local',
      path: form.mainImagePath,
      sort_order: 0,
      meta: { role: 'main' },
    }))
  }
  form.referenceImagePaths
    .map((path) => String(path || '').trim())
    .filter(Boolean)
    .forEach((path, index) => {
      calls.push(window.cs.createAiImageAsset({
        job_uid: jobUid,
        kind: 'reference',
        source_type: 'local',
        path,
        sort_order: index + 1,
        meta: { role: 'reference' },
      }))
    })
  await Promise.all(calls)
}

function collectResultCards(job) {
  return collectResultQueues(job).flatMap((queue) => queue.items || [])
}

function collectResultQueues(job) {
  const summary = job?.summary && typeof job.summary === 'object' ? job.summary : {}
  const runs = Array.isArray(summary.runs) ? summary.runs : []
  if (runs.length) {
    return runs
      .map((run, index) => ({
        key: run.run_uid || run.task_id || `run-${index + 1}`,
        title: `队列 ${index + 1}`,
        createdAt: run.created_at || '',
        prompt: run.prompt || '',
        status: run.status || job?.status || '',
        items: collectResultCardsFromRun(job, run, index),
      }))
      .filter((queue) => queue.items.length)
      .reverse()
  }
  const legacySummary = {
    ...summary,
    image_urls: Array.isArray(summary.image_urls) ? summary.image_urls : [],
    output_files: Array.isArray(summary.output_files) ? summary.output_files : [],
  }
  const items = collectResultCardsFromRun(job, legacySummary, 0, { includeOutputAssets: true })
  if (!items.length) return []
  return [{
    key: job?.job_uid || 'legacy-results',
    title: '队列 1',
    createdAt: job?.updated_at || job?.created_at || '',
    prompt: job?.prompt || '',
    status: job?.status || '',
    items,
  }]
}

function collectResultCardsFromRun(job, run, queueIndex = 0, options = {}) {
  const assets = Array.isArray(job?.assets) ? job.assets : []
  const paths = Array.isArray(run?.output_files) ? run.output_files : []
  const urls = Array.isArray(run?.image_urls) ? run.image_urls : []
  const outputAssets = options.includeOutputAssets ? assets.filter((asset) => asset.kind === 'output' || asset.kind === 'result') : []
  const resultCount = Math.max(paths.length, urls.length)
  return [
    ...Array.from({ length: resultCount }, (_, index) => ({
      key: `${queueIndex}-${paths[index] || urls[index] || index}`,
      path: paths[index] || '',
      url: urls[index] || '',
      label: `结果 ${index + 1}`,
      model: run?.model_key || job?.model_key,
      size: run?.size || job?.params?.size,
      prompt: run?.prompt || job?.prompt || '',
      createdAt: run?.created_at || '',
    })),
    ...outputAssets.map((asset, index) => ({
      key: `${queueIndex}-${asset.asset_uid || asset.path || asset.url || index}`,
      path: asset.path || '',
      url: asset.url || '',
      label: asset.meta?.label || `输出素材 ${index + 1}`,
      model: job?.model_key,
      size: job?.params?.size,
      prompt: run?.prompt || job?.prompt || '',
      createdAt: run?.created_at || '',
    })),
  ].filter((item, index, list) => resultKey(item) && list.findIndex((candidate) => resultKey(candidate) === resultKey(item)) === index)
}

function taskMetaLine(job = {}) {
  const params = job.params && typeof job.params === 'object' ? job.params : {}
  const size = params.size || '未设尺寸'
  const ratio = params.ratio || ratioForSize(size, '1:1')
  const count = Number(params.n || params.count || 1)
  return `${job.model_key || 'gpt-image-2'} · ${ratio} · ${size} · ${count} 张 · ${job.status || 'draft'}`
}

function taskResultLine(job = {}) {
  const summary = job.summary && typeof job.summary === 'object' ? job.summary : {}
  const count = collectResultCards(job).length
  const runCount = Array.isArray(summary.runs) ? summary.runs.length : (count ? 1 : 0)
  if (count) return `已有 ${count} 张结果 · ${runCount} 组生成`
  if (job.job_uid === activeJobUid.value && generating.value) return '正在生成'
  return '暂无结果'
}

function taskPreviewItems(job = {}) {
  return collectResultCards(job).slice(0, 4)
}

function queueMetaLine(queue = {}) {
  return [
    queue.createdAt ? `生成时间 ${formatDateTime(queue.createdAt)}` : '',
    queue.items?.length ? `${queue.items.length} 张` : '',
    queue.status || '',
  ].filter(Boolean).join(' · ')
}

function queuePromptLine(queue = {}) {
  const prompt = String(queue.prompt || '').trim()
  return prompt ? `Prompt：${prompt}` : ''
}

function formatDateTime(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function resultKey(item) {
  return item?.path || item?.url || ''
}

function resultPreviewKey(item) {
  return item?.path || item?.url || ''
}

function toggleResult(item) {
  if (item?.loading) return
  const key = resultKey(item)
  if (!key) return
  if (selectedResults.has(key)) selectedResults.delete(key)
  else selectedResults.add(key)
}

function selectAllVisibleResults() {
  if (!allVisibleSelectableItems.value.length) return
  if (allVisibleSelected.value) {
    allVisibleSelectableItems.value.forEach((item) => selectedResults.delete(resultKey(item)))
    return
  }
  allVisibleSelectableItems.value.forEach((item) => selectedResults.add(resultKey(item)))
}

function openLightbox(item) {
  if (item?.loading || !resultKey(item)) return
  lightboxItem.value = item
  void refreshImagePreview(resultPreviewKey(item))
}

function closeLightbox() {
  lightboxItem.value = null
}

async function saveAs(items) {
  if (!currentJob.value?.job_uid || !items.length) return
  try {
    const directory = await chooseDirectory('选择另存文件夹')
    if (!directory) return
    await window.cs.saveAsAiImageJob(currentJob.value.job_uid, {
      directory,
      files: items.map(resultKey).filter(Boolean),
    })
    logs.value.push(`另存 ${items.length} 张图片到 ${directory}`)
  } catch (error) {
    errorMessage.value = error.message || String(error)
  }
}

function setAsMain(item) {
  const key = resultKey(item)
  form.mainImagePath = key
  void refreshImagePreview(key, { force: true })
}

function addAsReference(item) {
  const key = resultKey(item)
  if (key && !form.referenceImagePaths.includes(key)) form.referenceImagePaths.push(key)
  void refreshImagePreview(key, { force: true })
}

function removeReferencePath(index) {
  const [removed] = form.referenceImagePaths.splice(index, 1)
  forgetImagePreview(removed)
}

function removeMainImage() {
  forgetImagePreview(form.mainImagePath)
  form.mainImagePath = ''
}

async function restoreJob(job, options = {}) {
  if (job?.job_uid) pendingActiveJobUid.value = job.job_uid
  if (options.preserveCurrentDraft !== false) {
    saveDraftForCurrentTask()
    persistWorkbenchState()
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = null
    await autosaveCurrentTask()
  }
  let detail = job
  if (job?.job_uid && typeof window.cs.getAiImageJob === 'function') {
    try {
      detail = await window.cs.getAiImageJob(job.job_uid) || job
    } catch (error) {
      logs.value.push(`读取任务详情失败：${error.message || error}`)
    }
  }
  detail = mergeJobWithDraft(detail)
  restoringState = true
  currentJob.value = detail
  pendingActiveJobUid.value = ''
  form.title = detail.title || form.title
  form.prompt = detail.prompt || ''
  form.modelId = modelIdForJob(detail)
  form.model_key = activeModel.value.key
  form.model_key_tier = activeModel.value.keyTier
  form.output_dir = detail.output_dir || form.output_dir
  if (detail.params && typeof detail.params === 'object') {
    const nextSize = detail.params.size || form.size
    const nextRatio = detail.params.ratio || ratioForSize(nextSize, form.ratio)
    form.ratio = nextRatio
    form.size = sizeForRatio(nextRatio, nextSize, activeModel.value.keyTier)
    form.quality = detail.params.quality || form.quality
    form.format = detail.params.response_format || form.format
    form.count = detail.params.n || form.count
    form.mainImagePath = detail.params.main_image_path || form.mainImagePath
    form.referenceImagePaths = Array.isArray(detail.params.reference_image_paths)
      ? detail.params.reference_image_paths
      : form.referenceImagePaths
  }
  const assets = Array.isArray(detail.assets) ? detail.assets : []
  const mainAsset = assets.find((asset) => asset.kind === 'main' && asset.path)
  if (!form.mainImagePath) form.mainImagePath = mainAsset?.path || ''
  if (!form.referenceImagePaths.length) {
    form.referenceImagePaths = assets
      .filter((asset) => asset.kind === 'reference' && asset.path)
      .map((asset) => asset.path)
  }
  taskDrafts[detail.job_uid] = formSnapshot()
  restoringState = false
  await Promise.all([
    refreshImagePreview(form.mainImagePath),
    ...form.referenceImagePaths.map((path) => refreshImagePreview(path)),
    ...resultCards.value.map((item) => refreshImagePreview(resultPreviewKey(item))),
  ])
  selectedResults.clear()
  workspaceMode.value = 'results'
  persistWorkbenchState()
}

function openOutputFolder() {
  if (form.output_dir && typeof window.cs.openFile === 'function') window.cs.openFile(form.output_dir)
}

function pathLabel(path) {
  const value = String(path || '').trim()
  if (!value) return ''
  const normalized = value.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() || value
}

function previewKey(path) {
  const value = String(path || '').trim()
  return value
}

function isRemoteOrDataImage(path) {
  return /^(https?:|data:|blob:|file:)/i.test(String(path || '').trim())
}

function imagePreviewSrc(path) {
  const key = previewKey(path)
  if (!key || previewFailures.has(key)) return ''
  if (imagePreviews[key]) return imagePreviews[key]
  if (/^(https?:|data:|blob:)/i.test(key)) return key
  return ''
}

async function refreshImagePreview(path, options = {}) {
  const key = previewKey(path)
  if (!key) return
  if (!options.force && (imagePreviews[key] || previewFailures.has(key))) return
  previewFailures.delete(key)
  if (isRemoteOrDataImage(key) && !/^file:/i.test(key)) {
    imagePreviews[key] = key
    return
  }
  try {
    if (typeof window?.cs?.readLocalImagePreview === 'function') {
      const response = await window.cs.readLocalImagePreview(key)
      const dataUrl = response?.data_url || response?.dataUrl || ''
      if (dataUrl) {
        imagePreviews[key] = dataUrl
        return
      }
      if (response?.error) throw new Error(response.error)
    }
    imagePreviews[key] = localFileUrl(key)
  } catch (error) {
    previewFailures.add(key)
    logs.value.push(`图片预览失败：${pathLabel(key)} (${error.message || error})`)
  }
}

function markPreviewBroken(path) {
  const key = previewKey(path)
  if (!key) return
  previewFailures.add(key)
  delete imagePreviews[key]
}

function forgetImagePreview(path) {
  const key = previewKey(path)
  if (!key) return
  previewFailures.delete(key)
  delete imagePreviews[key]
}

function previewInitial(path) {
  const label = pathLabel(path)
  return (label.match(/[A-Za-z0-9\u4e00-\u9fa5]/u)?.[0] || '图').toUpperCase()
}

function localFileUrl(path) {
  const value = String(path || '').trim()
  if (/^file:\/\//i.test(value)) return value
  const normalized = value.replace(/\\/g, '/')
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  const encoded = withLeadingSlash
    .split('/')
    .map((segment) => (/^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/')
  return `file://${encoded}`
}
</script>

<style scoped>
.aiw-workbench {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 14px;
  padding: 18px 20px;
  background: #141418;
  color: var(--text);
}

.aiw-topbar,
.aiw-prompt-panel,
.aiw-results-grid,
.aiw-history-drawer {
  border: 1px solid #2e2e3a;
  background: #1c1c22;
}

.aiw-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 16px 18px;
  border-radius: 8px;
}

.aiw-kicker {
  margin: 0 0 6px;
  color: #ff6b2b;
  font-size: 12px;
  font-weight: 800;
}

.aiw-topbar h2 {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
}

.aiw-subtitle {
  margin: 7px 0 0;
  color: var(--text2);
  line-height: 1.5;
}

.aiw-top-actions,
.aiw-tabs,
.aiw-results-actions,
.aiw-result-card footer div:last-child {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.aiw-field,
.aiw-material-box,
.aiw-key-status,
.aiw-generate-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.aiw-field span,
.aiw-panel-head,
.aiw-field-label,
.aiw-key-status span,
.aiw-result-card footer span,
.aiw-path-button span,
.aiw-upload-tile span,
.aiw-picked-asset span,
.aiw-reference-card span,
.aiw-results-actions > span,
.aiw-empty-state span,
.aiw-history-item small,
.aiw-history-empty span {
  color: var(--text2);
  font-size: 12px;
}

.aiw-field select,
.aiw-field input,
.aiw-prompt-panel textarea,
.aiw-path-button {
  width: 100%;
  min-width: 0;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #141418;
  color: var(--text);
  font: inherit;
}

.aiw-field select,
.aiw-field input {
  height: 36px;
  padding: 0 10px;
}

.aiw-key-status {
  justify-content: center;
  padding: 7px 10px;
  border: 1px solid rgba(70, 180, 120, 0.35);
  border-radius: 8px;
  background: rgba(70, 180, 120, 0.08);
}

.aiw-key-status.missing {
  border-color: rgba(255, 107, 43, 0.45);
  background: rgba(255, 107, 43, 0.1);
}

.aiw-key-status strong {
  font-size: 13px;
}

.aiw-main-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(300px, 340px) minmax(420px, 1fr) minmax(230px, 260px);
  gap: 14px;
}

.aiw-main-grid.history-collapsed {
  grid-template-columns: minmax(340px, 380px) minmax(520px, 1fr);
}

.aiw-prompt-panel,
.aiw-history-drawer {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-radius: 8px;
  overflow: auto;
}

.aiw-task-panel {
  scrollbar-gutter: stable;
}

.aiw-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.aiw-task-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.aiw-field-wide,
.aiw-key-status {
  grid-column: 1 / -1;
}

.aiw-prompt-box textarea {
  min-height: 132px;
  resize: vertical;
  padding: 12px;
  line-height: 1.6;
}

.aiw-material-box {
  padding-top: 10px;
  border-top: 1px solid #2e2e3a;
}

.aiw-title-box {
  padding-top: 0;
  border-top: 0;
}

.aiw-path-button,
.aiw-upload-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  min-height: 68px;
  padding: 11px 12px;
  text-align: left;
}

.aiw-path-button span,
.aiw-upload-tile span,
.aiw-picked-asset span {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiw-upload-tile {
  border-style: dashed;
  background: #17181d;
}

.aiw-upload-tile.compact {
  min-height: 54px;
}

.aiw-picked-asset {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #141418;
}

.aiw-thumb {
  width: 100%;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 6px;
  background: #f4f2ee;
}

.aiw-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.aiw-preview-fallback {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: #6d6a62;
  font-size: 18px;
  font-weight: 800;
}

.aiw-picked-asset > div:not(.aiw-thumb) {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.aiw-picked-asset strong,
.aiw-reference-card span,
.aiw-result-card footer strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiw-reference-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.aiw-reference-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #141418;
}

.aiw-advanced-json {
  min-height: 82px;
  resize: vertical;
  padding: 10px;
  line-height: 1.5;
}

.aiw-results-grid {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  overflow: hidden;
  border-radius: 8px;
}

.aiw-workspace-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.aiw-workspace-head div:first-child {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.aiw-result-wall {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: auto;
  padding-right: 2px;
}

.aiw-result-queue {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 16px;
  border-bottom: 1px solid #2e2e3a;
}

.aiw-result-queue:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.aiw-result-queue-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
}

.aiw-result-queue-head > div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.aiw-result-queue-head p {
  max-width: 54%;
  margin: 0;
  color: var(--text2);
  font-size: 12px;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiw-result-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(238px, 1fr));
  align-content: start;
  gap: 12px;
}

.aiw-result-card {
  position: relative;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #242430;
  overflow: hidden;
  cursor: pointer;
}

.aiw-result-card.selected {
  border-color: #ff6b2b;
  background: #2c2927;
  box-shadow: 0 0 0 2px rgba(255, 107, 43, 0.48);
}

.aiw-result-card:focus-visible {
  outline: 2px solid rgba(255, 107, 43, 0.72);
  outline-offset: 2px;
}

.aiw-result-card.loading {
  border-color: rgba(255, 107, 43, 0.22);
  background: #1d1d25;
}

.aiw-result-card img,
.aiw-result-preview,
.aiw-loading-preview {
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
}

.aiw-result-card > img,
.aiw-preview-button,
.aiw-preview-button > img,
.aiw-preview-button > span,
.aiw-result-preview,
.aiw-loading-preview {
  flex: 1;
  min-height: 210px;
  background: #f4f2ee;
}

.aiw-preview-button {
  width: 100%;
  display: block;
  padding: 0;
  border: 0;
  border-radius: 0;
  color: inherit;
  cursor: zoom-in;
  overflow: hidden;
}

.aiw-preview-button:not(:disabled):hover {
  border-color: transparent;
  background-color: #f4f2ee;
}

.aiw-preview-button > img,
.aiw-preview-button > span {
  display: grid;
  place-items: center;
}

.aiw-result-preview,
.aiw-loading-preview {
  display: grid;
  place-items: center;
  color: #6d6a62;
  font-size: 24px;
  font-weight: 800;
}

.aiw-loading-preview {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background:
    radial-gradient(circle at 28% 22%, rgba(255, 107, 43, 0.10), transparent 30%),
    radial-gradient(circle at 72% 76%, rgba(112, 122, 180, 0.12), transparent 34%),
    linear-gradient(135deg, #202029 0%, #282832 48%, #1d1d25 100%);
  color: #d9d9e6;
  font-size: 14px;
}

.aiw-loading-preview::before {
  content: "";
  position: absolute;
  inset: -28px;
  z-index: -1;
  background:
    radial-gradient(circle at 24% 28%, rgba(255, 107, 43, 0.22), transparent 34%),
    radial-gradient(circle at 72% 68%, rgba(115, 126, 190, 0.16), transparent 38%),
    linear-gradient(135deg, #22222c 0%, #2d2d38 54%, #1f1f28 100%);
  filter: blur(18px);
  opacity: 0.95;
  transform: scale(1.05);
  animation: aiw-loading-breathe 3s ease-in-out infinite;
}

.aiw-loading-preview::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 24%, transparent 70%, rgba(0, 0, 0, 0.14)),
    radial-gradient(circle at 50% 50%, transparent 0 54%, rgba(255, 255, 255, 0.03) 55%, transparent 70%);
  pointer-events: none;
}

.aiw-loading-preview span {
  position: absolute;
  inset: -18% -48%;
  z-index: 0;
  border: 0;
  border-radius: 0;
  background:
    linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.08) 22%,
      rgba(255, 107, 43, 0.18) 42%,
      rgba(150, 158, 214, 0.14) 58%,
      transparent 78%
    );
  filter: blur(18px);
  opacity: 0.95;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 220' preserveAspectRatio='none'%3E%3Cpath d='M0 126 C80 58 150 182 230 126 C310 66 380 174 460 120 C520 80 562 88 600 124 L600 220 L0 220 Z' fill='black'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 220' preserveAspectRatio='none'%3E%3Cpath d='M0 126 C80 58 150 182 230 126 C310 66 380 174 460 120 C520 80 562 88 600 124 L600 220 L0 220 Z' fill='black'/%3E%3C/svg%3E");
  -webkit-mask-repeat: repeat-x;
  mask-repeat: repeat-x;
  -webkit-mask-size: 46% 100%;
  mask-size: 46% 100%;
  animation: aiw-wave-flow 2.6s cubic-bezier(0.22, 1, 0.36, 1) infinite;
}

.aiw-loading-preview strong {
  position: absolute;
  bottom: 18px;
  left: 18px;
  z-index: 2;
  font-size: 13px;
  text-shadow: 0 1px 12px rgba(0, 0, 0, 0.36);
}

@keyframes aiw-wave-flow {
  0% { transform: translateX(-34%); }
  100% { transform: translateX(34%); }
}

@keyframes aiw-loading-breathe {
  0%, 100% { opacity: 0.82; transform: scale(1.04); }
  50% { opacity: 1; transform: scale(1.08); }
}

.aiw-select-toggle {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  min-width: 54px;
  height: 28px;
  display: grid;
  place-items: center;
  padding: 0 10px;
  border-color: rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  background: rgba(20, 20, 24, 0.78);
  color: #fff;
  font-size: 12px;
  backdrop-filter: blur(10px);
}

.aiw-result-card.selected .aiw-select-toggle {
  border-color: rgba(255, 107, 43, 0.7);
  background: #ff6b2b;
}

.aiw-result-card footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px;
}

.aiw-result-card footer > div:first-child {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.aiw-result-card footer div:last-child {
  justify-content: flex-end;
}

.aiw-history-drawer ol {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.aiw-history-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.aiw-history-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
  padding: 11px;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #242430;
  text-align: left;
  cursor: pointer;
}

.aiw-history-item.active {
  border-color: rgba(255, 107, 43, 0.55);
  background: rgba(255, 107, 43, 0.10);
  box-shadow: 0 0 0 1px rgba(255, 107, 43, 0.18);
}

.aiw-history-item small {
  line-height: 1.4;
}

.aiw-history-thumbs {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px;
}

.aiw-history-thumb {
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 6px;
  background: #f4f2ee;
  color: #6d6a62;
  font-size: 12px;
  font-weight: 800;
}

.aiw-history-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.aiw-history-empty {
  display: grid;
  gap: 6px;
  padding: 18px 12px;
  text-align: center;
  border: 1px dashed #2e2e3a;
  border-radius: 8px;
  background: #17181d;
}

.aiw-log-panel {
  min-height: 0;
  flex: 1;
  overflow: auto;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #141418;
}

.aiw-log-panel pre {
  margin: 0;
  padding: 12px;
  white-space: pre-wrap;
  color: var(--text2);
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
}

.aiw-lightbox {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 28px;
  background: rgba(10, 10, 14, 0.82);
  backdrop-filter: blur(10px);
}

.aiw-lightbox figure {
  position: relative;
  width: min(92vw, 1120px);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
}

.aiw-lightbox img,
.aiw-lightbox-fallback {
  max-height: calc(92vh - 76px);
  width: 100%;
  object-fit: contain;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #f4f2ee;
}

.aiw-lightbox-fallback {
  min-height: 520px;
  display: grid;
  place-items: center;
  color: #6d6a62;
  font-size: 28px;
  font-weight: 800;
}

.aiw-lightbox figcaption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text);
}

.aiw-lightbox figcaption span {
  color: var(--text2);
  font-size: 12px;
}

.aiw-lightbox-close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1;
  background: rgba(20, 20, 24, 0.78);
  backdrop-filter: blur(10px);
}

.aiw-empty-state {
  min-height: 220px;
  display: grid;
  place-content: center;
  gap: 8px;
  text-align: center;
  border: 1px dashed #2e2e3a;
  border-radius: 8px;
  background: #17181d;
}

.aiw-generate-card {
  position: sticky;
  bottom: 0;
  padding-top: 10px;
  margin-top: auto;
  border-top: 1px solid #2e2e3a;
  background: #1c1c22;
}

.aiw-generate-card small {
  color: #ff8b5f;
}

button {
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #242430;
  color: var(--text);
  font: inherit;
  font-weight: 700;
  padding: 8px 12px;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

button:not(:disabled),
.aiw-path-button,
.aiw-upload-tile,
.aiw-history-item {
  transition: border-color 180ms ease, background-color 180ms ease, color 180ms ease, box-shadow 180ms ease;
}

button:not(:disabled):hover,
.aiw-path-button:hover,
.aiw-upload-tile:hover,
.aiw-history-item:hover {
  border-color: rgba(255, 107, 43, 0.5);
  background-color: rgba(255, 107, 43, 0.08);
}

button:focus-visible,
select:focus-visible,
input:focus-visible,
textarea:focus-visible,
.aiw-path-button:focus-visible,
.aiw-upload-tile:focus-visible,
.aiw-history-item:focus-visible {
  outline: 2px solid rgba(255, 107, 43, 0.72);
  outline-offset: 2px;
}

button.active,
.aiw-primary-action,
.aiw-ghost {
  border-color: rgba(255, 107, 43, 0.35);
  background: rgba(255, 107, 43, 0.1);
  color: #ff6b2b;
}

.aiw-primary-action {
  width: 100%;
  min-height: 42px;
  background: #ff6b2b;
  color: #fff;
}

.aiw-ghost {
  flex: 0 0 auto;
}

@media (max-width: 1180px) {
  .aiw-main-grid,
  .aiw-main-grid.history-collapsed,
  .aiw-result-list {
    grid-template-columns: 1fr;
  }

  .aiw-topbar,
  .aiw-workspace-head {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .aiw-loading-preview::before,
  .aiw-loading-preview span {
    animation: none;
    transform: none;
  }
}
</style>
