<template>
  <div v-if="modelValue" class="bala-material-shell" @click.self="close">
    <section class="bala-material-drawer" role="dialog" aria-modal="true" aria-label="巴拉 AI 视频素材选择">
      <header class="bala-material-head">
        <div>
          <strong>素材选择 / AI 动作</strong>
          <span>{{ batchSummary }}</span>
        </div>
        <button type="button" class="bala-icon-button" aria-label="关闭" @click="close">×</button>
      </header>

      <div v-if="error" class="bala-material-state error">{{ error }}</div>
      <div v-else-if="loading" class="bala-material-state">正在读取素材结果...</div>
      <template v-else>
        <div class="bala-material-toolbar">
          <div class="bala-source-tabs">
            <button
              v-for="tab in sourceTabs"
              :key="tab.value"
              type="button"
              :class="{ selected: activeSourceType === tab.value }"
              @click="activeSourceType = tab.value"
            >
              {{ tab.label }}
            </button>
          </div>
          <span>已选 {{ selectedAssetIds.length }} 张图片</span>
        </div>

        <div class="bala-material-body">
          <main class="bala-material-grid">
            <section v-for="item in filteredItems" :key="item.style_code" class="bala-style-section">
              <header>
                <strong>{{ item.style_code }}</strong>
                <span>{{ visibleAssets(item).length }} / {{ (item.assets || []).length }} 张</span>
              </header>
              <div class="bala-asset-grid">
                <button
                  v-for="asset in visibleAssets(item)"
                  :key="asset.id"
                  type="button"
                  :class="['bala-asset-tile', { selected: selectedAssetIds.includes(asset.id) }]"
                  @click="toggleAsset(asset.id)"
                >
                  <img :src="asset.image_url" :alt="asset.filename || asset.id" loading="lazy" />
                  <span>{{ sourceTypeLabel(asset.source_type) }}</span>
                  <strong>{{ asset.filename || asset.id }}</strong>
                </button>
              </div>
            </section>
            <div v-if="!filteredItems.length" class="bala-material-state">没有可继续处理的素材图</div>
          </main>

          <aside class="bala-operation-panel">
            <div class="bala-operation-tabs">
              <button
                v-for="operation in operations"
                :key="operation.value"
                type="button"
                :class="{ selected: selectedOperation === operation.value }"
                @click="selectedOperation = operation.value"
              >
                {{ operation.label }}
              </button>
            </div>

            <section v-if="selectedOperation === 'face_swap'" class="bala-operation-card">
              <div class="bala-field-head">
                <strong>AI 换脸</strong>
                <span>从内置素材库选择年龄和性别匹配的模特脸</span>
              </div>
              <button type="button" class="bala-picker-button" @click="modelPickerOpen = true">
                打开模特素材库
              </button>
              <div class="bala-selected-models">
                <span v-if="!selectedModelIds.length">未选择模特素材</span>
                <span v-for="item in selectedModelItems" :key="item.id">{{ item.group_label || item.group }} / {{ item.expression || item.filename }}</span>
              </div>
            </section>

            <section v-else-if="selectedOperation === 'background_swap'" class="bala-operation-card">
              <div class="bala-field-head">
                <strong>AI 换背景</strong>
                <span>输入背景要求，保留服装主体</span>
              </div>
              <textarea v-model="backgroundPrompt" rows="5" placeholder="例如：换成马尔代夫的海边"></textarea>
            </section>

            <section v-else-if="selectedOperation === 'outfit_swap'" class="bala-operation-card">
              <div class="bala-field-head">
                <strong>AI 换装</strong>
                <span>上传服装图和搭配/同款不同色参考图</span>
              </div>
              <FilePathPicker label="服装图" :paths="garmentImagePaths" @pick="pickImages('garment')" @clear="garmentImagePaths = []" />
              <FilePathPicker label="搭配参考图" :paths="outfitReferencePaths" @pick="pickImages('outfit')" @clear="outfitReferencePaths = []" />
              <FilePathPicker label="同款不同色参考图" :paths="variantReferencePaths" @pick="pickImages('variant')" @clear="variantReferencePaths = []" />
            </section>

            <section v-else class="bala-operation-card">
              <div class="bala-field-head">
                <strong>AI 换姿势</strong>
                <span>描述姿势、构图和保留要求</span>
              </div>
              <textarea v-model="posePrompt" rows="5" placeholder="例如：让模特自然侧身行走，保留服装版型和颜色"></textarea>
              <textarea v-model="promptCardsText" rows="4" placeholder="可粘贴 Prompt 卡片，一行一条"></textarea>
            </section>

            <section class="bala-operation-card">
              <div class="bala-field-head">
                <strong>补充要求</strong>
                <span>所有 AI 动作共用</span>
              </div>
              <textarea v-model="promptExtra" rows="4" placeholder="例如：无文字、无变形、画面自然、有阳光"></textarea>
            </section>
          </aside>
        </div>

        <footer class="bala-material-foot">
          <span>{{ actionHint }}</span>
          <button type="button" class="bala-secondary" @click="close">稍后处理</button>
          <button type="button" class="bala-primary" :disabled="submitting || !canExport" @click="exportToAi">
            {{ submitting ? '正在进入...' : '进入 AI 生图' }}
          </button>
        </footer>
      </template>
    </section>

    <BalaModelLibraryPickerModal
      v-model="modelPickerOpen"
      :initial-selected-ids="selectedModelIds"
      @confirm="handleModelSelection"
    />
  </div>
</template>

<script setup>
import { computed, defineComponent, h, ref, watch } from 'vue'
import BalaModelLibraryPickerModal from '../components/BalaModelLibraryPickerModal.vue'
import { buildBalaAiStageRequest, parseBalaMaterialBoardUrl } from '../utils/balaAiVideoWorkflow'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  boardUrl: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'start-ai-stage'])

const FilePathPicker = defineComponent({
  name: 'FilePathPicker',
  props: {
    label: { type: String, required: true },
    paths: { type: Array, default: () => [] },
  },
  emits: ['pick', 'clear'],
  setup(componentProps, { emit: pickerEmit }) {
    const fileName = (path) => String(path || '').split('/').pop().split('\\').pop()
    return () => h('div', { class: 'bala-file-picker' }, [
      h('div', { class: 'bala-file-picker-head' }, [
        h('strong', componentProps.label),
        h('button', { type: 'button', onClick: () => pickerEmit('pick') }, '选择图片'),
        componentProps.paths.length
          ? h('button', { type: 'button', onClick: () => pickerEmit('clear') }, '清空')
          : null,
      ]),
      h('div', { class: 'bala-file-list' }, componentProps.paths.length
        ? componentProps.paths.map(path => h('span', { key: path }, fileName(path)))
        : [h('span', '未选择')]),
    ])
  },
})

const sourceTabs = [
  { value: '', label: '全部' },
  { value: 'model', label: '模拍图' },
  { value: 'detail', label: '商品细节图' },
]
const operations = [
  { value: 'face_swap', label: 'AI 换脸' },
  { value: 'background_swap', label: 'AI 换背景' },
  { value: 'outfit_swap', label: 'AI 换装' },
  { value: 'pose_swap', label: 'AI 换姿势' },
]

const batch = ref(null)
const loading = ref(false)
const submitting = ref(false)
const error = ref('')
const activeSourceType = ref('')
const selectedAssetIds = ref([])
const selectedOperation = ref('face_swap')
const modelPickerOpen = ref(false)
const selectedModelIds = ref([])
const selectedModelItems = ref([])
const backgroundPrompt = ref('换成马尔代夫的海边')
const garmentImagePaths = ref([])
const outfitReferencePaths = ref([])
const variantReferencePaths = ref([])
const posePrompt = ref('让模特自然侧身行走，保留服装版型和颜色')
const promptCardsText = ref('')
const promptExtra = ref('无文字，无变形，保留童装版型和颜色')

const boardRef = computed(() => parseBalaMaterialBoardUrl(props.boardUrl))
const allItems = computed(() => Array.isArray(batch.value?.items) ? batch.value.items : [])
const filteredItems = computed(() =>
  allItems.value
    .map(item => ({ ...item, assets: visibleAssets(item) }))
    .filter(item => item.assets.length)
)
const batchSummary = computed(() => {
  const styleCount = allItems.value.length
  const assetCount = allItems.value.reduce((sum, item) => sum + (item.assets || []).length, 0)
  return styleCount ? `${styleCount} 个款号 / ${assetCount} 张候选图` : '等待素材结果'
})
const canExport = computed(() =>
  selectedAssetIds.value.length > 0
  && (selectedOperation.value !== 'face_swap' || selectedModelIds.value.length > 0)
)
const actionHint = computed(() => {
  if (!selectedAssetIds.value.length) return '先选择要进入 AI 生图的素材图'
  if (selectedOperation.value === 'face_swap' && !selectedModelIds.value.length) return '换脸需要先选择模特素材'
  return '确认后会打开 AI 换图原子脚本并带入这些参数'
})

watch(() => props.modelValue, (open) => {
  if (open) void loadBatch()
})

watch(() => props.boardUrl, () => {
  if (props.modelValue) void loadBatch()
})

function close() {
  emit('update:modelValue', false)
}

async function loadBatch() {
  const ref = boardRef.value
  if (!ref) {
    error.value = '素材选择链接无效'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const payload = await window.cs.getBalaMaterialBatch(ref.batchId, ref.token)
    batch.value = payload
    selectedAssetIds.value = defaultSelectedAssetIds(payload)
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

function defaultSelectedAssetIds(payload) {
  return (payload?.items || [])
    .flatMap(item => item.assets || [])
    .filter(asset => asset.selected)
    .map(asset => asset.id)
}

function visibleAssets(item) {
  const tab = activeSourceType.value
  return (item?.assets || []).filter(asset => !tab || asset.source_type === tab)
}

function toggleAsset(assetId) {
  const id = String(assetId || '').trim()
  if (!id) return
  selectedAssetIds.value = selectedAssetIds.value.includes(id)
    ? selectedAssetIds.value.filter(item => item !== id)
    : [...selectedAssetIds.value, id]
}

function sourceTypeLabel(sourceType) {
  if (sourceType === 'model') return '模拍图'
  if (sourceType === 'detail') return '商品细节图'
  return '其他'
}

function handleModelSelection(payload) {
  selectedModelIds.value = payload?.selectedModelIds || []
  selectedModelItems.value = payload?.selectedModelItems || []
}

async function pickImages(kind) {
  const selected = await window.cs.browseFile({
    title: '选择图片',
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    multi: true,
    multiSelections: true,
  })
  const paths = Array.isArray(selected)
    ? selected
    : String(selected || '').split(',').map(item => item.trim()).filter(Boolean)
  if (kind === 'garment') garmentImagePaths.value = paths
  if (kind === 'outfit') outfitReferencePaths.value = paths
  if (kind === 'variant') variantReferencePaths.value = paths
}

function promptCards() {
  return promptCardsText.value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((prompt, index) => ({ id: `pose-${index + 1}`, prompt }))
}

async function exportToAi() {
  const ref = boardRef.value
  if (!ref || !canExport.value) return
  submitting.value = true
  error.value = ''
  try {
    await window.cs.saveBalaMaterialSelection(ref.batchId, ref.token, selectedAssetIds.value)
    const result = await window.cs.exportBalaAiInput(ref.batchId, ref.token, {
      operation_type: selectedOperation.value,
      selected_asset_ids: selectedAssetIds.value,
      model_ref_ids: selectedModelIds.value,
      background_prompt: backgroundPrompt.value,
      garment_images: { paths: garmentImagePaths.value },
      outfit_reference_images: { paths: outfitReferencePaths.value },
      variant_reference_images: { paths: variantReferencePaths.value },
      pose_prompt: posePrompt.value,
      prompt_cards: promptCards(),
      prompt_extra: promptExtra.value,
    })
    emit('start-ai-stage', buildBalaAiStageRequest(result))
    close()
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.bala-material-shell {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  justify-content: flex-end;
  background: rgba(15, 23, 42, 0.38);
}

.bala-material-drawer {
  width: min(1180px, 96vw);
  height: 100%;
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  background: #f8fafc;
  border-left: 1px solid #cbd5e1;
  box-shadow: -24px 0 48px rgba(15, 23, 42, 0.16);
}

.bala-material-head,
.bala-material-toolbar,
.bala-material-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
}

.bala-material-head {
  justify-content: space-between;
}

.bala-material-head div,
.bala-field-head {
  display: grid;
  gap: 4px;
}

.bala-material-head strong {
  font-size: 16px;
}

.bala-material-head span,
.bala-material-toolbar span,
.bala-field-head span,
.bala-file-list,
.bala-asset-tile span {
  color: #64748b;
  font-size: 12px;
}

.bala-icon-button,
.bala-source-tabs button,
.bala-operation-tabs button,
.bala-picker-button,
.bala-secondary,
.bala-primary,
.bala-file-picker button {
  height: 32px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
  color: #334155;
  cursor: pointer;
}

.bala-icon-button {
  width: 32px;
  font-size: 18px;
}

.bala-material-toolbar {
  justify-content: space-between;
}

.bala-source-tabs,
.bala-operation-tabs,
.bala-selected-models,
.bala-file-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.bala-source-tabs button,
.bala-operation-tabs button,
.bala-picker-button,
.bala-secondary,
.bala-primary,
.bala-file-picker button {
  padding: 0 12px;
}

.bala-source-tabs button.selected,
.bala-operation-tabs button.selected,
.bala-asset-tile.selected {
  border-color: #0f766e;
  background: #ccfbf1;
  color: #115e59;
}

.bala-material-body {
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 0;
}

.bala-material-grid {
  overflow: auto;
  padding: 16px 18px 28px;
}

.bala-style-section {
  margin-bottom: 18px;
}

.bala-style-section header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.bala-asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 10px;
}

.bala-asset-tile {
  display: grid;
  gap: 5px;
  padding: 8px;
  text-align: left;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
}

.bala-asset-tile img {
  width: 100%;
  aspect-ratio: 4 / 5;
  object-fit: cover;
  border-radius: 6px;
  background: #e2e8f0;
}

.bala-asset-tile strong {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bala-operation-panel {
  overflow: auto;
  padding: 16px;
  border-left: 1px solid #e2e8f0;
  background: #ffffff;
}

.bala-operation-tabs {
  margin-bottom: 14px;
}

.bala-operation-card {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.bala-operation-card textarea {
  width: 100%;
  resize: vertical;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 8px 10px;
  background: #ffffff;
  color: #0f172a;
}

.bala-selected-models span,
.bala-file-list span {
  padding: 4px 8px;
  border-radius: 999px;
  background: #e2e8f0;
  color: #334155;
}

.bala-file-picker {
  display: grid;
  gap: 8px;
}

.bala-file-picker-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bala-file-picker-head strong {
  flex: 1;
}

.bala-material-foot {
  justify-content: flex-end;
  border-top: 1px solid #e2e8f0;
  border-bottom: 0;
}

.bala-material-foot span {
  flex: 1;
  color: #64748b;
  font-size: 12px;
}

.bala-primary {
  border-color: #0f766e;
  background: #0f766e;
  color: #ffffff;
}

.bala-primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.bala-material-state {
  padding: 18px;
  color: #64748b;
}

.bala-material-state.error {
  color: #b91c1c;
}
</style>
