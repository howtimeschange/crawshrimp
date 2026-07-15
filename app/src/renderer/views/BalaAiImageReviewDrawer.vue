<template>
  <div v-if="modelValue" class="bala-review-shell" @click.self="close">
    <section class="bala-review-drawer" role="dialog" aria-modal="true" aria-label="巴拉 AI 图片审核">
      <header class="bala-review-head">
        <div>
          <strong>巴拉 AI 图片审核</strong>
          <span>{{ summaryText }}</span>
        </div>
        <button type="button" class="bala-icon-button" aria-label="关闭" @click="close">×</button>
      </header>

      <div v-if="error" class="bala-review-state error">{{ error }}</div>
      <div v-else-if="loading" class="bala-review-state">正在读取审核批次...</div>
      <template v-else>
        <div class="bala-review-toolbar">
          <div class="bala-review-tabs">
            <button
              v-for="tab in statusTabs"
              :key="tab.value"
              type="button"
              :class="{ selected: activeStatus === tab.value }"
              @click="activeStatus = tab.value"
            >
              {{ tab.label }}
            </button>
          </div>
          <div class="bala-review-actions">
            <button type="button" class="bala-secondary" :disabled="refreshing" @click="refreshBatch">
              {{ refreshing ? '刷新中...' : '刷新结果' }}
            </button>
          </div>
        </div>

        <div class="bala-review-body">
          <main class="bala-review-grid">
            <section v-for="item in filteredItems" :key="item.style_code" class="bala-style-section">
              <header>
                <strong>{{ item.style_code }}</strong>
                <span>{{ item.assets.length }} 张</span>
              </header>
              <div class="bala-asset-grid">
                <article
                  v-for="asset in item.assets"
                  :key="asset.id"
                  :class="['bala-review-card', statusClass(asset.status)]"
                >
                  <div class="bala-image-frame">
                    <img v-if="asset.image_url" :src="asset.image_url" :alt="asset.filename || asset.id" loading="lazy" />
                    <span v-else>{{ statusLabel(asset.status) }}</span>
                  </div>
                  <div class="bala-card-meta">
                    <span>{{ operationLabel(asset.operation_type) }}</span>
                    <strong>{{ asset.filename || asset.id }}</strong>
                    <small>{{ asset.prompt || asset.background_prompt || asset.pose_prompt || '' }}</small>
                  </div>
                  <div class="bala-card-actions">
                    <button type="button" :class="{ selected: asset.status === 'approved' }" @click="saveDecision(asset.id, 'approved')">批准</button>
                    <button type="button" :class="{ selected: asset.status === 'rejected' }" @click="saveDecision(asset.id, 'rejected')">拒绝</button>
                    <button type="button" :class="{ selected: asset.status === 'pending' }" @click="saveDecision(asset.id, 'pending')">待定</button>
                    <button type="button" :disabled="regeneratingAssetId === asset.id" @click="regenerateAsset(asset)">
                      {{ regeneratingAssetId === asset.id ? '重跑中...' : '重跑' }}
                    </button>
                  </div>
                </article>
              </div>
            </section>
            <div v-if="!filteredItems.length" class="bala-review-state">暂无匹配图片</div>
          </main>

          <aside class="bala-video-panel">
            <section class="bala-video-card">
              <strong>视频阶段</strong>
              <label>
                <span>模板 ID</span>
                <input v-model="templateId" type="text" placeholder="可选" />
              </label>
              <label>
                <span>模板匹配</span>
                <input v-model="templateMatch" type="text" placeholder="标题/描述关键词，可选" />
              </label>
              <label>
                <span>视频 Prompt</span>
                <textarea v-model="videoPrompt" rows="5" placeholder="可选，自定义图生视频提示词"></textarea>
              </label>
            </section>
          </aside>
        </div>

        <footer class="bala-review-foot">
          <span>{{ footerText }}</span>
          <button type="button" class="bala-secondary" @click="close">稍后处理</button>
          <button type="button" class="bala-primary" :disabled="exporting || !approvedCount" @click="exportToVideo">
            {{ exporting ? '正在进入...' : '进入视频生成' }}
          </button>
        </footer>
      </template>
    </section>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import {
  buildBalaVideoStageRequest,
  parseBalaReviewBoardUrl,
  summarizeBalaReviewBatch,
} from '../utils/balaAiVideoWorkflow'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  boardUrl: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'start-video-stage', 'batch-updated'])

const statusTabs = [
  { value: '', label: '全部' },
  { value: 'pending', label: '待定' },
  { value: 'approved', label: '已批准' },
  { value: 'rejected', label: '已拒绝' },
  { value: 'generating', label: '生成中' },
  { value: 'failed', label: '失败' },
]

const batch = ref(null)
const loading = ref(false)
const refreshing = ref(false)
const exporting = ref(false)
const error = ref('')
const activeStatus = ref('')
const templateId = ref('')
const templateMatch = ref('')
const videoPrompt = ref('')
const regeneratingAssetId = ref('')

const boardRef = computed(() => parseBalaReviewBoardUrl(props.boardUrl))
const allItems = computed(() => Array.isArray(batch.value?.items) ? batch.value.items : [])
const summary = computed(() => summarizeBalaReviewBatch(batch.value || {}))
const approvedCount = computed(() => summary.value.approved)
const summaryText = computed(() => {
  const value = summary.value
  return value.total
    ? `${value.total} 张 AI 图 / ${value.approved} 已批准 / ${value.pending} 待定 / ${value.generating} 生成中`
    : '等待 AI 生成结果'
})
const footerText = computed(() =>
  approvedCount.value
    ? `${approvedCount.value} 张已批准图片将进入 qn_img2video_batch`
    : '先批准至少一张图片'
)
const filteredItems = computed(() =>
  allItems.value
    .map(item => ({
      ...item,
      assets: (item.assets || []).filter(asset =>
        ['origin', 'ai'].includes(asset?.kind)
        && (!activeStatus.value || String(asset.status || '') === activeStatus.value)
      ),
    }))
    .filter(item => item.assets.length)
)

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
    error.value = '审核链接无效'
    return
  }
  loading.value = true
  error.value = ''
  try {
    batch.value = await window.cs.getBalaReviewBatch(ref.batchId, ref.token)
    emit('batch-updated', batch.value)
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

async function refreshBatch() {
  const ref = boardRef.value
  if (!ref) return
  refreshing.value = true
  error.value = ''
  try {
    batch.value = await window.cs.refreshBalaReviewBatch(ref.batchId, ref.token)
    emit('batch-updated', batch.value)
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    refreshing.value = false
  }
}

async function saveDecision(assetId, status) {
  const ref = boardRef.value
  if (!ref) return
  error.value = ''
  try {
    batch.value = await window.cs.saveBalaReviewDecisions(ref.batchId, ref.token, {
      [assetId]: { status },
    })
    emit('batch-updated', batch.value)
  } catch (err) {
    error.value = err?.message || String(err)
  }
}

async function regenerateAsset(asset) {
  const ref = boardRef.value
  if (!ref || !asset?.id) return
  regeneratingAssetId.value = asset.id
  error.value = ''
  try {
    const result = await window.cs.regenerateBalaReviewAsset(ref.batchId, ref.token, {
      asset_id: asset.id,
      prompt: asset.prompt || asset.background_prompt || asset.pose_prompt || '',
      submit_async: true,
    })
    batch.value = result?.batch || batch.value
    emit('batch-updated', batch.value)
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    regeneratingAssetId.value = ''
  }
}

async function exportToVideo() {
  const ref = boardRef.value
  if (!ref || !approvedCount.value) return
  exporting.value = true
  error.value = ''
  try {
    const result = await window.cs.exportBalaVideoInput(ref.batchId, ref.token, {
      provider: 'qn_img2video',
      template_id: templateId.value,
      template_match: templateMatch.value,
      prompt: videoPrompt.value,
      download_videos: true,
    })
    emit('start-video-stage', buildBalaVideoStageRequest(result))
    close()
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    exporting.value = false
  }
}

function operationLabel(value) {
  if (value === 'background_swap') return 'AI 换背景'
  if (value === 'outfit_swap') return 'AI 换装'
  if (value === 'pose_swap') return 'AI 换姿势'
  return 'AI 换脸'
}

function statusLabel(value) {
  if (value === 'approved') return '已批准'
  if (value === 'rejected') return '已拒绝'
  if (value === 'generating') return '生成中'
  if (value === 'failed') return '失败'
  return '待定'
}

function statusClass(value) {
  return `status-${String(value || 'pending')}`
}
</script>

<style scoped>
.bala-review-shell {
  position: fixed;
  inset: 0;
  z-index: 72;
  display: flex;
  justify-content: flex-end;
  background: rgba(15, 23, 42, 0.38);
}

.bala-review-drawer {
  width: min(1180px, 96vw);
  height: 100%;
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  background: #f8fafc;
  border-left: 1px solid #cbd5e1;
  box-shadow: -24px 0 48px rgba(15, 23, 42, 0.16);
}

.bala-review-head,
.bala-review-toolbar,
.bala-review-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
}

.bala-review-head,
.bala-review-toolbar,
.bala-review-foot {
  justify-content: space-between;
}

.bala-review-head div {
  display: grid;
  gap: 4px;
}

.bala-review-head strong {
  font-size: 16px;
}

.bala-review-head span,
.bala-review-toolbar span,
.bala-card-meta small,
.bala-card-meta span,
.bala-style-section header span,
.bala-video-card label span,
.bala-review-foot span {
  color: #64748b;
  font-size: 12px;
}

.bala-icon-button,
.bala-review-tabs button,
.bala-card-actions button,
.bala-secondary,
.bala-primary {
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

.bala-review-tabs,
.bala-review-actions,
.bala-card-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.bala-review-tabs button,
.bala-card-actions button,
.bala-secondary,
.bala-primary {
  padding: 0 12px;
}

.bala-review-tabs button.selected,
.bala-card-actions button.selected {
  border-color: #0f766e;
  background: #ccfbf1;
  color: #115e59;
}

.bala-review-body {
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 340px;
}

.bala-review-grid {
  overflow: auto;
  padding: 16px 18px 28px;
}

.bala-style-section {
  margin-bottom: 18px;
}

.bala-style-section header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
}

.bala-asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 12px;
}

.bala-review-card {
  display: grid;
  gap: 9px;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
}

.bala-review-card.status-approved {
  border-color: #0f766e;
}

.bala-review-card.status-rejected {
  border-color: #ef4444;
}

.bala-review-card.status-generating {
  border-style: dashed;
}

.bala-image-frame {
  display: grid;
  place-items: center;
  aspect-ratio: 4 / 5;
  border-radius: 6px;
  overflow: hidden;
  background: #e2e8f0;
  color: #64748b;
}

.bala-image-frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.bala-card-meta {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.bala-card-meta strong,
.bala-card-meta small {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bala-video-panel {
  overflow: auto;
  padding: 16px;
  border-left: 1px solid #e2e8f0;
  background: #ffffff;
}

.bala-video-card {
  display: grid;
  gap: 12px;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.bala-video-card label {
  display: grid;
  gap: 6px;
}

.bala-video-card input,
.bala-video-card textarea {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 8px;
  background: #ffffff;
  color: #0f172a;
}

.bala-review-state {
  margin: 18px;
  padding: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
  color: #475569;
}

.bala-review-state.error {
  border-color: #fecaca;
  background: #fef2f2;
  color: #991b1b;
}

.bala-primary {
  border-color: #0f766e;
  background: #0f766e;
  color: #ffffff;
}

button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
