<template>
  <div v-if="modelValue" :class="['approval-shell', { embedded }]" @click.self="!embedded && close()">
    <aside :class="['approval-drawer', { collapsed: collapsed && !embedded, embedded }]">
      <header class="approval-head">
        <div class="approval-title-block">
          <p class="approval-kicker">生图队列 / 审批流</p>
          <h3>巴拉-AI测图审图看板</h3>
          <div class="approval-meta">
            <span v-if="batch?.batch_id">批次 {{ batch.batch_id }}</span>
            <span v-if="batch?.status">状态 {{ batch.status }}</span>
            <span v-if="batch?.created_at">创建 {{ formatDate(batch.created_at) }}</span>
          </div>
        </div>
        <div class="approval-head-actions">
          <button type="button" class="ghost-btn" @click="reload">刷新</button>
          <button v-if="!embedded" type="button" class="ghost-btn" @click="collapsed = !collapsed">{{ collapsed ? '展开' : '收起' }}</button>
          <button v-if="!embedded" type="button" class="icon-btn" aria-label="关闭审图看板" @click="close">×</button>
        </div>
      </header>

      <section v-if="!collapsed || embedded" class="approval-lifecycle">
        <div class="approval-stage done">
          <span class="stage-dot"></span>
          <div>
            <strong>生图完成</strong>
            <span>{{ summary.aiTotal }} 张 AI 图</span>
          </div>
        </div>
        <div :class="['approval-stage', summary.pending > 0 ? 'active' : 'done']">
          <span class="stage-dot"></span>
          <div>
            <strong>人工审批</strong>
            <span>确认 {{ summary.approved }} / 舍弃 {{ summary.rejected }} / 待定 {{ summary.pending }}</span>
          </div>
        </div>
        <div :class="['approval-stage', createStageClass]">
          <span class="stage-dot"></span>
          <div>
            <strong>上传创建</strong>
            <span>{{ createStageLabel }}</span>
          </div>
        </div>
      </section>

      <div v-if="!collapsed || embedded" class="approval-toolbar">
        <div class="approval-search">
          <input v-model="filterText" placeholder="筛选款号 / 商品ID / Prompt" />
        </div>
        <div class="approval-bulk">
          <button type="button" class="ghost-btn" @click="markAllPending('approved')">待定全确认</button>
          <button type="button" class="ghost-btn danger" @click="markAllPending('rejected')">待定全舍弃</button>
          <button type="button" class="primary-btn" :disabled="saving || submitting" @click="saveDecisions">
            {{ saving ? '保存中' : '保存审批状态' }}
          </button>
          <button type="button" class="primary-btn submit" :disabled="saving || submitting || summary.approved <= 0" @click="submitApproved">
            {{ submitting ? '提交中' : '提交已确认图片并创建测图任务' }}
          </button>
        </div>
      </div>

      <section v-if="(!collapsed || embedded) && showSubmitResults && hasSubmitResult" class="approval-submit-results">
        <div class="submit-result-head">
          <div>
            <strong>实际测图任务创建结果</strong>
            <span>{{ submitSummaryText }}</span>
          </div>
          <span :class="['submit-result-badge', effectiveStatus]">{{ batchStatusLabel }}</span>
        </div>
        <div class="submit-result-list">
          <div v-for="row in createRows" :key="`${row.款号 || ''}-${row.任务ID || row.备注 || ''}`" class="submit-result-row">
            <div>
              <strong>{{ row.款号 || '-' }}</strong>
              <span>商品ID {{ row.商品ID || '-' }}</span>
            </div>
            <div>
              <span>任务ID</span>
              <strong>{{ row.任务ID || '-' }}</strong>
            </div>
            <div>
              <span>上传图</span>
              <strong>{{ row.上传图数量 ?? '-' }}</strong>
            </div>
            <div>
              <span>页面回读</span>
              <strong>{{ row.页面回读 || '-' }}</strong>
            </div>
            <div class="submit-result-status">
              <span>{{ row.执行结果 || '-' }}</span>
              <small v-if="row.备注">{{ row.备注 }}</small>
            </div>
          </div>
        </div>
      </section>

      <div v-if="!collapsed || embedded" class="approval-body">
        <main class="approval-list">
          <div v-if="loading" class="approval-empty">正在读取审批批次…</div>
          <div v-else-if="error" class="approval-empty error">{{ error }}</div>
          <div v-else-if="!filteredItems.length" class="approval-empty">当前筛选没有图片</div>
          <article v-for="item in filteredItems" :key="item.id || item.style_code" class="style-row">
            <div class="style-head">
              <div>
                <h4>{{ item.style_code }}</h4>
                <p>
                  商品ID {{ item.item_id || '-' }}
                  <span>·</span>
                  {{ item.category || '-' }}
                  <span>·</span>
                  SKC {{ item.skc_code || '-' }}
                </p>
              </div>
              <span class="style-mode">参考图 {{ item.reference_mode || '-' }}</span>
            </div>
            <div class="asset-rail">
              <div
                v-for="asset in item.assets || []"
                :key="asset.id"
                :class="['asset-card', asset.kind, asset.status, { selected: selectedAsset?.id === asset.id }]"
              >
                <button
                  type="button"
                  class="asset-tile"
                  @click="selectAsset(item, asset)"
                >
                  <img :src="imageUrl(asset)" :alt="`${item.style_code} ${asset.label || ''}`" />
                  <span class="asset-label">{{ asset.label || asset.filename }}</span>
                  <span class="asset-file">{{ asset.filename || asset.path }}</span>
                  <span class="asset-status">{{ statusLabel(asset) }}</span>
                </button>
                <div v-if="asset.kind === 'ai'" class="asset-card-actions">
                  <button type="button" class="asset-action ok" @click.stop="setAssetStatus(item, asset, 'approved')">确认</button>
                  <button type="button" class="asset-action danger" @click.stop="setAssetStatus(item, asset, 'rejected')">舍弃</button>
                </div>
              </div>
            </div>
          </article>
        </main>

        <aside class="approval-inspector">
          <div v-if="!selectedAsset" class="inspector-empty">
            <strong>选择一张图</strong>
            <span>查看完整 Prompt，确认、舍弃或重新生成。</span>
          </div>
          <template v-else>
            <div class="inspector-preview">
              <img :src="imageUrl(selectedAsset)" :alt="selectedAsset.label || selectedAsset.filename" />
            </div>
            <div class="inspector-title">
              <div>
                <strong>{{ selectedItem?.style_code }} · {{ selectedAsset.label }}</strong>
                <span>{{ selectedAsset.filename || selectedAsset.path }}</span>
              </div>
              <span :class="['status-pill', selectedAsset.status]">{{ statusLabel(selectedAsset) }}</span>
            </div>

            <label class="inspector-field">
              <span>详细生图 Prompt</span>
              <textarea
                v-model="selectedAsset.custom_prompt"
                :readonly="selectedAsset.kind !== 'ai'"
                :placeholder="selectedAsset.prompt || '无 Prompt'"
              ></textarea>
            </label>

            <label v-if="selectedAsset.kind === 'ai'" class="inspector-field">
              <span>参考图路径</span>
              <textarea v-model="referenceText" placeholder="可多条，换行分隔"></textarea>
            </label>

            <div v-if="selectedAsset.kind === 'ai'" class="reference-tools">
              <button type="button" class="ghost-btn" @click="useItemReferences">使用本款参考图</button>
              <button type="button" class="ghost-btn" @click="pickReferenceFiles">选择本地参考图</button>
              <button type="button" class="primary-btn" :disabled="regenerating" @click="regenerateSelected">
                {{ regenerating ? '重新生成中' : '重试/改图' }}
              </button>
            </div>
          </template>
        </aside>
      </div>

      <div v-if="toast" class="approval-toast" :class="{ error: toastError }">{{ toast }}</div>
    </aside>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  modelValue: Boolean,
  boardUrl: String,
  embedded: Boolean,
  showSubmitResults: {
    type: Boolean,
    default: true,
  },
})
const emit = defineEmits(['update:modelValue', 'batch-updated'])

const collapsed = ref(false)
const loading = ref(false)
const saving = ref(false)
const submitting = ref(false)
const regenerating = ref(false)
const error = ref('')
const toast = ref('')
const toastError = ref(false)
const filterText = ref('')
const batch = ref(null)
const selectedItem = ref(null)
const selectedAsset = ref(null)
const referenceText = ref('')

const approvalRef = computed(() => parseApprovalUrl(props.boardUrl))
const filteredItems = computed(() => {
  const text = filterText.value.trim().toLowerCase()
  const items = batch.value?.items || []
  if (!text) return items
  return items.filter(item => {
    const haystack = [
      item.style_code,
      item.item_id,
      item.category,
      item.skc_code,
      ...(item.assets || []).flatMap(asset => [asset.label, asset.filename, asset.prompt_name, asset.prompt]),
    ].join(' ').toLowerCase()
    return haystack.includes(text)
  })
})
const summary = computed(() => {
  const aiAssets = (batch.value?.items || [])
    .flatMap(item => item.assets || [])
    .filter(asset => asset.kind === 'ai')
  return {
    styles: batch.value?.items?.length || 0,
    aiTotal: aiAssets.length,
    approved: aiAssets.filter(asset => asset.status === 'approved').length,
    rejected: aiAssets.filter(asset => asset.status === 'rejected').length,
    pending: aiAssets.filter(asset => !['approved', 'rejected'].includes(asset.status)).length,
  }
})
const createRows = computed(() =>
  (batch.value?.submit_result_rows || []).filter(row => row?.阶段 === '天猫上传/创建测图任务')
)
const hasSubmitResult = computed(() => createRows.value.length > 0)
const effectiveStatus = computed(() => {
  const status = String(batch.value?.status || '').trim()
  if (status === 'submitted' && createRows.value.some(row => String(row?.执行结果 || '').includes('失败'))) {
    return 'partial_failed'
  }
  return status
})
const createSummary = computed(() => {
  const summaryPayload = batch.value?.submit_summary || {}
  const attempted = Number(summaryPayload.attempted ?? createRows.value.length ?? 0)
  const succeeded = Number(summaryPayload.succeeded ?? createRows.value.filter(row => String(row?.执行结果 || '').includes('已创建')).length)
  const failed = Number(summaryPayload.failed ?? createRows.value.filter(row => String(row?.执行结果 || '').includes('失败')).length)
  return {
    attempted: Number.isFinite(attempted) ? attempted : 0,
    succeeded: Number.isFinite(succeeded) ? succeeded : 0,
    failed: Number.isFinite(failed) ? failed : 0,
  }
})
const createStageClass = computed(() => {
  if (['created'].includes(effectiveStatus.value)) return 'done'
  if (['partial_failed', 'create_failed'].includes(effectiveStatus.value)) return 'error'
  if (hasSubmitResult.value) return 'active'
  return 'pending'
})
const createStageLabel = computed(() => {
  if (effectiveStatus.value === 'created') return `创建成功 ${createSummary.value.succeeded} 款`
  if (effectiveStatus.value === 'partial_failed') return `部分失败 ${createSummary.value.failed} 款`
  if (effectiveStatus.value === 'create_failed') return '创建失败'
  if (effectiveStatus.value === 'submitted') return '已提交，等待回读'
  return '确认后触发'
})
const batchStatusLabel = computed(() => {
  if (effectiveStatus.value === 'created') return '创建成功'
  if (effectiveStatus.value === 'partial_failed') return '部分失败'
  if (effectiveStatus.value === 'create_failed') return '创建失败'
  if (effectiveStatus.value === 'submitted') return '已提交'
  if (effectiveStatus.value === 'pending_approval') return '待审批'
  return effectiveStatus.value || '未开始'
})
const submitSummaryText = computed(() => {
  if (!hasSubmitResult.value) return '暂无创建结果'
  const { attempted, succeeded, failed } = createSummary.value
  return `尝试 ${attempted || createRows.value.length} 款 / 成功 ${succeeded} / 失败 ${failed}`
})

watch(() => props.modelValue, (open) => {
  if (open) reload()
})
watch(selectedAsset, (asset) => {
  referenceText.value = (asset?.reference_paths || []).join('\n')
})
watch(referenceText, (value) => {
  if (selectedAsset.value?.kind !== 'ai') return
  selectedAsset.value.reference_paths = splitLines(value)
})

function parseApprovalUrl(url) {
  try {
    const parsed = new URL(String(url || ''))
    const parts = parsed.pathname.split('/').filter(Boolean)
    const batchId = parts[parts.length - 1] || ''
    return {
      origin: parsed.origin,
      batchId,
      token: parsed.searchParams.get('token') || '',
    }
  } catch {
    return { origin: 'http://127.0.0.1:18765', batchId: '', token: '' }
  }
}

async function reload() {
  const ref = approvalRef.value
  if (!ref.batchId || !ref.token) {
    error.value = '审批批次链接无效'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const payload = await window.cs.getTmallApprovalBatch(ref.batchId, ref.token)
    if (payload?.detail) throw new Error(payload.detail)
    batch.value = payload
    emit('batch-updated', payload)
    selectedItem.value = payload?.items?.[0] || null
    selectedAsset.value = selectedItem.value?.assets?.find(asset => asset.kind === 'ai') || selectedItem.value?.assets?.[0] || null
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

function close() {
  emit('update:modelValue', false)
}

function imageUrl(asset) {
  const ref = approvalRef.value
  if (!ref.batchId || !asset?.id) return ''
  return `${ref.origin}/tmall-ai-image-approval/api/${encodeURIComponent(ref.batchId)}/image/${encodeURIComponent(asset.id)}?token=${encodeURIComponent(ref.token)}`
}

function selectAsset(item, asset) {
  selectedItem.value = item
  selectedAsset.value = asset
}

function statusLabel(asset) {
  const status = String(asset?.status || '').trim()
  if (asset?.kind !== 'ai') return '参考图'
  if (status === 'approved') return '已确认'
  if (status === 'rejected') return '已舍弃'
  if (status === 'generating') return '生成中'
  if (status === 'generated') return '已重试'
  return '待审批'
}

function setAssetStatus(item, asset, status) {
  selectAsset(item, asset)
  Object.assign(asset, { status })
}

function markAllPending(status) {
  for (const item of batch.value?.items || []) {
    for (const asset of item.assets || []) {
      if (asset.kind === 'ai' && !['approved', 'rejected'].includes(asset.status)) {
        asset.status = status
      }
    }
  }
}

function decisionsPayload() {
  const decisions = {}
  for (const item of batch.value?.items || []) {
    for (const asset of item.assets || []) {
      if (asset.kind !== 'ai') continue
      decisions[asset.id] = {
        status: String(asset.status || 'pending'),
        custom_prompt: String(asset.custom_prompt || ''),
        reference_paths: plainStringArray(asset.reference_paths),
        review_note: String(asset.review_note || ''),
      }
    }
  }
  return decisions
}

async function saveDecisions() {
  const ref = approvalRef.value
  saving.value = true
  try {
    const result = await window.cs.saveTmallApprovalDecisions(ref.batchId, ref.token, decisionsPayload())
    if (result?.detail || result?.error) throw new Error(result.detail || result.error)
    showToast('审批状态已保存')
    return true
  } catch (err) {
    showToast(err?.message || String(err), true)
    return false
  } finally {
    saving.value = false
  }
}

async function submitApproved() {
  const ref = approvalRef.value
  submitting.value = true
  try {
    const saved = await saveDecisions()
    if (!saved) return
    const result = await window.cs.submitTmallApprovalBatch(ref.batchId, ref.token)
    if (result?.detail || result?.error) throw new Error(result.detail || result.error)
    if (result?.ok === false || result?.failed > 0) {
      showToast(`创建结果异常：成功 ${result?.succeeded || 0} / 尝试 ${result?.attempted || 0}`, true)
    } else {
      showToast(`创建成功 ${result?.succeeded || result?.submitted || 0} 款测图任务`)
    }
    await reload()
  } catch (err) {
    showToast(err?.message || String(err), true)
  } finally {
    submitting.value = false
  }
}

function useItemReferences() {
  if (!selectedAsset.value || !selectedItem.value) return
  const refs = (selectedItem.value.assets || [])
    .filter(asset => asset.kind !== 'ai' && asset.path)
    .map(asset => asset.path)
  selectedAsset.value.reference_paths = refs
  referenceText.value = refs.join('\n')
}

async function pickReferenceFiles() {
  const paths = await window.cs.browseFile?.({
    title: '选择参考图',
    images: true,
    multi: true,
  })
  if (!Array.isArray(paths) || !paths.length || !selectedAsset.value) return
  const refs = [...(selectedAsset.value.reference_paths || []), ...paths]
  selectedAsset.value.reference_paths = Array.from(new Set(refs))
  referenceText.value = selectedAsset.value.reference_paths.join('\n')
}

async function regenerateSelected() {
  const ref = approvalRef.value
  const asset = selectedAsset.value
  if (!asset?.id) return
  regenerating.value = true
  asset.status = 'generating'
  try {
    const result = await window.cs.regenerateTmallApprovalAsset(ref.batchId, ref.token, {
      asset_id: String(asset.id),
      prompt: String(asset.custom_prompt || asset.prompt || ''),
      reference_paths: plainStringArray(asset.reference_paths),
    })
    if (result?.detail || result?.error) throw new Error(result.detail || result.error)
    Object.assign(asset, result.asset || {})
    selectedAsset.value = asset
    referenceText.value = (asset.reference_paths || []).join('\n')
    showToast('重新生成完成')
  } catch (err) {
    asset.status = 'pending'
    showToast(err?.message || String(err), true)
  } finally {
    regenerating.value = false
  }
}

function splitLines(value) {
  return String(value || '').split(/[\n\r,，、；;]+/).map(item => item.trim()).filter(Boolean)
}

function plainStringArray(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean)
  return splitLines(value)
}

function formatDate(value) {
  return String(value || '').replace('T', ' ').replace(/\+\d\d:\d\d$/, '')
}

function showToast(message, isError = false) {
  toast.value = message
  toastError.value = isError
  window.clearTimeout(showToast.timer)
  showToast.timer = window.setTimeout(() => {
    toast.value = ''
    toastError.value = false
  }, 2600)
}
</script>

<style scoped>
.approval-shell {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(3, 5, 12, 0.56);
  display: flex;
  justify-content: flex-end;
}
.approval-shell.embedded {
  position: static;
  inset: auto;
  z-index: auto;
  background: transparent;
  display: block;
}
.approval-drawer {
  width: min(1480px, calc(100vw - 38px));
  height: 100%;
  background: var(--bg);
  border-left: 1px solid var(--border);
  box-shadow: -18px 0 60px rgba(0, 0, 0, 0.36);
  display: flex;
  flex-direction: column;
  position: relative;
}
.approval-drawer.embedded {
  width: 100%;
  height: auto;
  min-height: 560px;
  border: 0;
  border-radius: 10px;
  box-shadow: none;
  overflow: hidden;
}
.approval-drawer.embedded .approval-body {
  min-height: 420px;
}
.approval-drawer.collapsed {
  width: min(520px, calc(100vw - 28px));
  height: auto;
  max-height: 160px;
  align-self: flex-start;
  margin-top: 18px;
  border-bottom: 1px solid var(--border);
  border-radius: 14px 0 0 14px;
}
.approval-head {
  padding: 18px 22px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}
.approval-kicker {
  margin: 0 0 6px;
  color: var(--orange);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.approval-title-block h3 {
  margin: 0;
  font-size: 20px;
  line-height: 1.2;
  color: var(--text);
}
.approval-meta {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  color: var(--text3);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.approval-head-actions,
.approval-bulk,
.reference-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.icon-btn,
.ghost-btn,
.primary-btn {
  border-radius: 9px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color .16s, background .16s, color .16s, transform .16s;
}
.icon-btn {
  width: 34px;
  height: 34px;
  border: 1px solid var(--border);
  background: var(--bg3);
  color: var(--text2);
  font-size: 20px;
  line-height: 1;
}
.ghost-btn {
  border: 1px solid var(--border);
  background: var(--bg3);
  color: var(--text);
  padding: 8px 12px;
}
.primary-btn {
  border: 1px solid rgba(255, 106, 41, 0.42);
  background: var(--orange);
  color: #fff;
  padding: 9px 14px;
}
.primary-btn.submit {
  background: #168b77;
  border-color: rgba(31, 184, 156, 0.52);
}
.ghost-btn:hover,
.icon-btn:hover,
.primary-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: var(--orange);
}
.primary-btn:disabled {
  opacity: .48;
  cursor: not-allowed;
}
.ghost-btn.danger {
  color: #fca5a5;
  border-color: rgba(248, 113, 113, .28);
}
.ghost-btn.ok {
  color: #86efac;
  border-color: rgba(74, 222, 128, .24);
}
.approval-lifecycle {
  padding: 14px 22px;
  border-bottom: 1px solid var(--border);
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  background: linear-gradient(180deg, rgba(255, 106, 41, .06), rgba(255, 255, 255, .015));
}
.approval-stage {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px;
  background: var(--bg2);
  display: flex;
  gap: 10px;
}
.stage-dot {
  width: 9px;
  height: 9px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--text3);
}
.approval-stage.done .stage-dot { background: #4ade80; }
.approval-stage.active .stage-dot { background: var(--orange); }
.approval-stage.error .stage-dot { background: #f87171; }
.approval-stage.error {
  border-color: rgba(248, 113, 113, .34);
  background: rgba(248, 113, 113, .055);
}
.approval-stage strong {
  display: block;
  color: var(--text);
  font-size: 13px;
}
.approval-stage span:last-child {
  display: block;
  margin-top: 4px;
  color: var(--text3);
  font-size: 12px;
}
.approval-toolbar {
  padding: 12px 22px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  display: flex;
  justify-content: space-between;
  gap: 14px;
}
.approval-search {
  flex: 1;
  max-width: 360px;
}
.approval-search input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--bg3);
  color: var(--text);
  padding: 9px 12px;
  font-size: 13px;
  outline: none;
}
.approval-search input:focus {
  border-color: var(--orange);
}
.approval-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
}
.approval-submit-results {
  border-bottom: 1px solid var(--border);
  background: rgba(255, 255, 255, .018);
  padding: 14px 22px;
}
.submit-result-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 12px;
}
.submit-result-head strong,
.submit-result-head span {
  display: block;
}
.submit-result-head strong {
  color: var(--text);
  font-size: 13px;
}
.submit-result-head span {
  margin-top: 4px;
  color: var(--text3);
  font-size: 12px;
}
.submit-result-badge {
  white-space: nowrap;
  border-radius: 999px;
  padding: 6px 9px;
  background: var(--bg3);
  color: var(--text2);
  font-size: 11px;
  font-weight: 800;
}
.submit-result-badge.created {
  color: #86efac;
  background: rgba(74, 222, 128, .10);
}
.submit-result-badge.partial_failed,
.submit-result-badge.create_failed {
  color: #fecaca;
  background: rgba(248, 113, 113, .12);
}
.submit-result-list {
  display: grid;
  gap: 8px;
}
.submit-result-row {
  display: grid;
  grid-template-columns: minmax(140px, 1.2fr) minmax(88px, .7fr) minmax(70px, .45fr) minmax(160px, 1fr) minmax(220px, 1.6fr);
  gap: 12px;
  align-items: start;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg2);
  padding: 10px 12px;
}
.submit-result-row strong,
.submit-result-row span,
.submit-result-row small {
  display: block;
  min-width: 0;
}
.submit-result-row span {
  color: var(--text3);
  font-size: 11px;
}
.submit-result-row strong {
  margin-top: 3px;
  color: var(--text);
  font-size: 12px;
  word-break: break-word;
}
.submit-result-status span {
  color: var(--text);
  font-weight: 800;
}
.submit-result-status small {
  margin-top: 5px;
  max-height: 46px;
  overflow: auto;
  color: #fca5a5;
  font-size: 11px;
  line-height: 1.45;
}
.approval-list {
  min-width: 0;
  overflow: auto;
  padding: 18px 22px 32px;
}
.style-row {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg2);
  overflow: hidden;
  margin-bottom: 14px;
}
.style-head {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.style-head h4 {
  margin: 0;
  color: var(--text);
  font-size: 17px;
}
.style-head p,
.style-mode {
  margin: 5px 0 0;
  color: var(--text3);
  font-size: 12px;
}
.style-head p span { margin: 0 6px; }
.asset-rail {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(164px, 1fr));
  gap: 12px;
  padding: 14px 16px 16px;
}
.asset-card {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg3);
  color: var(--text);
  overflow: hidden;
  transition: border-color .16s, transform .16s, background .16s;
}
.asset-card:hover,
.asset-card.selected {
  border-color: var(--orange);
  transform: translateY(-1px);
}
.asset-card.reference {
  background: rgba(255, 255, 255, .025);
}
.asset-card.approved { border-color: rgba(74, 222, 128, .42); }
.asset-card.rejected { opacity: .58; border-color: rgba(248, 113, 113, .35); }
.asset-tile {
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  cursor: pointer;
}
.asset-tile img {
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  display: block;
  background: rgba(255, 255, 255, .04);
}
.asset-label,
.asset-file,
.asset-status {
  display: block;
  padding: 0 10px;
}
.asset-label {
  padding-top: 10px;
  font-size: 13px;
  font-weight: 800;
}
.asset-file {
  margin-top: 4px;
  color: var(--text3);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.asset-status {
  padding-top: 8px;
  padding-bottom: 10px;
  color: var(--text2);
  font-size: 12px;
}
.asset-card-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 0 10px 10px;
}
.asset-action {
  border-radius: 8px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, .035);
  color: var(--text);
  padding: 7px 8px;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  transition: border-color .16s, background .16s, transform .16s;
}
.asset-action:hover {
  transform: translateY(-1px);
  border-color: var(--orange);
}
.asset-action.ok {
  color: #86efac;
  border-color: rgba(74, 222, 128, .28);
}
.asset-action.danger {
  color: #fca5a5;
  border-color: rgba(248, 113, 113, .32);
}
.asset-card.approved .asset-action.ok {
  background: rgba(74, 222, 128, .14);
}
.asset-card.rejected .asset-action.danger {
  background: rgba(248, 113, 113, .14);
}
.approval-inspector {
  min-width: 0;
  border-left: 1px solid var(--border);
  background: var(--bg2);
  overflow: auto;
  padding: 18px;
}
.inspector-empty {
  min-height: 180px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text3);
  text-align: center;
}
.inspector-empty strong { color: var(--text); }
.inspector-preview img {
  width: 100%;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg3);
  aspect-ratio: 3 / 4;
  object-fit: cover;
}
.inspector-title {
  margin-top: 14px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.inspector-title strong,
.inspector-title span {
  display: block;
}
.inspector-title strong {
  color: var(--text);
  font-size: 14px;
}
.inspector-title span {
  color: var(--text3);
  font-size: 11px;
  margin-top: 4px;
  word-break: break-all;
}
.status-pill {
  align-self: flex-start;
  white-space: nowrap;
  border-radius: 999px;
  padding: 5px 8px;
  background: var(--bg3);
  color: var(--text2);
  font-size: 11px;
}
.status-pill.approved { color: #86efac; background: rgba(74, 222, 128, .08); }
.status-pill.rejected { color: #fca5a5; background: rgba(248, 113, 113, .08); }
.reference-tools {
  margin-top: 14px;
}
.inspector-field {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.inspector-field span {
  color: var(--text2);
  font-size: 12px;
  font-weight: 700;
}
.inspector-field textarea {
  min-height: 132px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg3);
  color: var(--text);
  padding: 10px 11px;
  line-height: 1.55;
  font-size: 12px;
  outline: none;
}
.inspector-field textarea:focus {
  border-color: var(--orange);
}
.approval-empty {
  border: 1px dashed var(--border);
  border-radius: 12px;
  color: var(--text3);
  padding: 36px;
  text-align: center;
}
.approval-empty.error {
  color: #fca5a5;
  border-color: rgba(248, 113, 113, .36);
}
.approval-toast {
  position: absolute;
  right: 22px;
  bottom: 18px;
  border: 1px solid rgba(74, 222, 128, .24);
  background: rgba(14, 54, 42, .96);
  color: #bbf7d0;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 12px;
  box-shadow: 0 12px 28px rgba(0,0,0,.25);
}
.approval-toast.error {
  border-color: rgba(248, 113, 113, .36);
  background: rgba(69, 22, 31, .96);
  color: #fecaca;
}
@media (max-width: 980px) {
  .approval-drawer { width: 100vw; }
  .approval-lifecycle { grid-template-columns: 1fr; }
  .approval-toolbar { flex-direction: column; }
  .approval-body { grid-template-columns: 1fr; }
  .approval-inspector { border-left: none; border-top: 1px solid var(--border); }
  .submit-result-row { grid-template-columns: 1fr; }
}
</style>
