<template>
  <div v-if="modelValue" :class="['approval-shell', { embedded }]" @click.self="!embedded && close()">
    <aside :class="['approval-drawer', { collapsed: collapsed && !embedded, embedded }]">
      <header class="approval-head">
        <div class="approval-title-block">
          <p v-if="!embedded" class="approval-kicker">生图队列 / 审批流</p>
          <h3 v-if="!embedded">巴拉-AI测图审图看板</h3>
          <div class="approval-meta">
            <span v-if="batch?.batch_id">批次 {{ batch.batch_id }}</span>
            <span v-if="batch?.status">状态 {{ batch.status }}</span>
            <span v-if="batch?.created_at">创建 {{ formatDate(batch.created_at) }}</span>
          </div>
        </div>
        <div class="approval-head-actions">
          <button type="button" class="ghost-btn" @click="reload()">刷新</button>
          <button v-if="!embedded" type="button" class="ghost-btn" @click="collapsed = !collapsed">{{ collapsed ? '展开' : '收起' }}</button>
          <button v-if="!embedded" type="button" class="icon-btn" aria-label="关闭审图看板" @click="close">×</button>
        </div>
      </header>

      <div v-if="!collapsed || embedded" class="approval-toolbar">
        <div class="approval-search">
          <input v-model="filterText" placeholder="筛选款号 / 商品ID / Prompt" />
        </div>
        <div class="approval-bulk">
          <template v-if="isGenerationConfirmation">
            <button type="button" class="primary-btn submit" :disabled="generationSubmitting || generationPromptCount <= 0" @click="submitGenerationConfirmation">
              {{ generationSubmitting ? '生图中' : '确认提交生图任务' }}
            </button>
          </template>
          <template v-else>
            <button type="button" class="ghost-btn" @click="markAllPending('approved')">待定全确认</button>
            <button type="button" class="ghost-btn danger" @click="markAllPending('rejected')">待定全舍弃</button>
            <button type="button" class="primary-btn" :disabled="saving || submitting" @click="saveDecisions">
              {{ saving ? '保存中' : '保存审批状态' }}
            </button>
            <button type="button" class="primary-btn submit" :disabled="saving || submitting || summary.approved <= 0" @click="submitApproved">
              {{ submitting ? '提交中' : '提交已确认图片并创建测图任务' }}
            </button>
          </template>
        </div>
      </div>

      <section v-if="(!collapsed || embedded) && showSubmitProgress" class="approval-submit-progress">
        <div class="submit-progress-head">
          <div>
            <strong>提交测图任务</strong>
            <span>{{ submitProgressText }}</span>
          </div>
          <span class="submit-progress-percent">{{ submitProgressPercent }}%</span>
        </div>
        <div class="submit-progress-bar" role="progressbar" :aria-valuenow="submitProgressPercent" aria-valuemin="0" aria-valuemax="100">
          <span :style="{ width: `${submitProgressPercent}%` }"></span>
        </div>
        <div class="submit-progress-meta">
          <span>已处理 {{ submitProgressCompleted }} / {{ submitProgressTotal }} 款</span>
          <span>成功 {{ createSummary.succeeded }} / 失败 {{ createSummary.failed }}</span>
          <span v-if="submitProgress.current_style">当前 {{ submitProgress.current_style }}</span>
        </div>
      </section>

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
              <button
                v-if="row.测图详情URL"
                type="button"
                class="tmall-detail-link"
                @click="openTmallDetailUrl(row.测图详情URL)"
              >
                查看详情
              </button>
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
              <div class="style-actions">
                <span class="style-mode">参考图 {{ item.reference_mode || '-' }}</span>
                <button v-if="isGenerationConfirmation" type="button" class="ghost-btn" @click="openPromptEditor(item)">新增 Prompt</button>
              </div>
            </div>
            <div v-if="!isGenerationConfirmation" class="asset-rail">
              <div
                v-for="asset in item.assets || []"
                :key="asset.id"
                :class="['asset-card', asset.kind, asset.status]"
              >
                <button
                  type="button"
                  class="asset-tile"
                  @click="openImagePreview(asset, item)"
                >
                  <img :src="imageUrlWithVersion(asset)" :alt="`${item.style_code} ${asset.label || ''}`" />
                  <span class="asset-label">{{ asset.label || asset.filename }}</span>
                  <span class="asset-file">{{ asset.filename || asset.path }}</span>
                  <span class="asset-status">{{ statusLabel(asset) }}</span>
                </button>
                <div v-if="asset.kind === 'ai'" class="asset-card-actions">
                  <button type="button" class="asset-action ok" @click.stop="setAssetStatus(item, asset, 'approved')">确认</button>
                  <button type="button" class="asset-action danger" @click.stop="setAssetStatus(item, asset, 'rejected')">舍弃</button>
                </div>
              </div>
              <button
                type="button"
                class="asset-card add-card"
                @click="openManualGenerate(item)"
              >
                <span class="add-icon">+</span>
                <strong>新增生图</strong>
                <small>单独为本款补一张 AI 图</small>
              </button>
            </div>
            <div v-if="isGenerationConfirmation" class="generation-confirm-list">
              <article
                v-for="prompt in activeGenerationPrompts(item)"
                :key="prompt.id"
                class="generation-prompt-card"
              >
                <header class="generation-prompt-head">
                  <input v-model="prompt.prompt_name" class="prompt-name-input" placeholder="Prompt 名称" />
                  <button type="button" class="ghost-btn" @click="openPromptLibraryPicker(item, prompt)">从 Prompt 库选择</button>
                  <button type="button" class="ghost-btn" @click="openPromptEditor(item, prompt)">弹窗编辑</button>
                  <button type="button" class="ghost-btn danger" @click="removeGenerationPrompt(item, prompt)">删除</button>
                </header>
                <textarea v-model="prompt.custom_prompt" placeholder="确认或修改本条生图 Prompt"></textarea>

                <div class="confirmation-image-slots">
                  <section class="main-image-slot">
                    <div class="slot-head">
                      <div>
                        <strong>主图位</strong>
                        <span>默认参与生图</span>
                      </div>
                    </div>
                    <figure v-if="itemMainAsset(item)" class="slot-card selected">
                      <button type="button" class="slot-image-button" @click="openImagePreview(itemMainAsset(item), item)">
                        <img :src="referenceImageUrl(itemMainAsset(item).path)" :alt="referenceFileName(itemMainAsset(item).path)" />
                      </button>
                      <figcaption>{{ referenceFileName(itemMainAsset(item).path) }}</figcaption>
                      <div class="slot-actions">
                        <button type="button" class="ghost-btn" @click="replaceItemMainImage(item)">替换</button>
                        <button type="button" class="ghost-btn danger" @click="clearItemMainImage(item)">删除</button>
                      </div>
                    </figure>
                    <button v-else type="button" class="empty-slot" @click="replaceItemMainImage(item)">选择主图</button>
                  </section>

                  <section class="reference-image-slots">
                    <div class="slot-head">
                      <div>
                        <strong>参考图位</strong>
                        <span>默认不参与生图，可按 Prompt 勾选</span>
                      </div>
                      <button type="button" class="ghost-btn" :disabled="itemImageCount(item) >= MAX_CONFIRMATION_IMAGES" @click="addItemReferenceImage(item)">新增参考图</button>
                    </div>
                    <div v-if="itemReferenceAssets(item).length" class="reference-slot-grid">
                      <figure
                        v-for="asset in itemReferenceAssets(item)"
                        :key="asset.id"
                        :class="['reference-image-slot', { selected: referenceImageSelected(prompt, asset) }]"
                      >
                        <label class="slot-check">
                          <input
                            type="checkbox"
                            :checked="referenceImageSelected(prompt, asset)"
                            :disabled="!referenceImageSelected(prompt, asset) && promptImageCount(prompt) >= MAX_CONFIRMATION_IMAGES"
                            @change="togglePromptReferenceImage(prompt, asset)"
                          />
                          <span>参与</span>
                        </label>
                        <button type="button" class="slot-image-button" @click="openImagePreview(asset, item)">
                          <img :src="referenceImageUrl(asset.path)" :alt="referenceFileName(asset.path)" />
                        </button>
                        <figcaption>{{ referenceFileName(asset.path) }}</figcaption>
                        <div class="slot-actions">
                          <button type="button" class="ghost-btn" @click="replaceItemReference(item, asset)">替换</button>
                          <button type="button" class="ghost-btn danger" @click="clearItemReference(item, asset)">删除</button>
                        </div>
                      </figure>
                    </div>
                    <button v-else type="button" class="empty-slot" @click="addItemReferenceImage(item)">新增参考图</button>
                  </section>
                </div>
              </article>
            </div>
          </article>
        </main>
      </div>

      <div v-if="manualGenerate.open" class="manual-modal-backdrop" @click.self="closeManualGenerate">
        <section class="manual-modal">
          <header class="manual-modal-head">
            <div>
              <strong>{{ manualGenerate.item?.style_code || '-' }} 新增生图</strong>
              <span>单独补充一张 AI 图，完成后追加到本款审批列表。</span>
            </div>
            <button type="button" class="icon-btn" aria-label="关闭新增生图" :disabled="manualGenerating" @click="closeManualGenerate">×</button>
          </header>

          <label class="inspector-field">
            <span>Prompt</span>
            <textarea v-model="manualGenerate.prompt" placeholder="输入本次新增生图 Prompt"></textarea>
          </label>

          <div class="manual-image-columns">
            <div class="manual-image-panel">
              <div class="manual-panel-head">
                <strong>主图</strong>
                <div>
                  <button type="button" class="ghost-btn" @click="useManualItemMain">使用本款主图</button>
                  <button type="button" class="ghost-btn" @click="pickManualMainImage">选择主图</button>
                </div>
              </div>
              <figure v-if="manualGenerate.mainImagePath" class="manual-main-preview">
                <img :src="referenceImageUrl(manualGenerate.mainImagePath)" :alt="referenceFileName(manualGenerate.mainImagePath)" />
                <figcaption>{{ referenceFileName(manualGenerate.mainImagePath) }}</figcaption>
              </figure>
              <div v-else class="reference-empty">请选择主图</div>
            </div>

            <div class="manual-image-panel">
              <div class="manual-panel-head">
                <strong>参考图</strong>
                <div>
                  <button type="button" class="ghost-btn" @click="useManualItemReferences">使用本款参考图</button>
                  <button type="button" class="ghost-btn" @click="pickManualReferenceFiles({ replace: true })">替换</button>
                  <button type="button" class="ghost-btn" @click="pickManualReferenceFiles({ replace: false })">追加</button>
                </div>
              </div>
              <div v-if="manualGenerate.referencePaths.length" class="reference-preview-grid">
                <figure v-for="path in manualGenerate.referencePaths" :key="path" class="reference-preview-card">
                  <img :src="referenceImageUrl(path)" :alt="referenceFileName(path)" />
                  <figcaption>{{ referenceFileName(path) }}</figcaption>
                  <button type="button" aria-label="移除参考图" @click="removeManualReferencePath(path)">×</button>
                </figure>
              </div>
              <div v-else class="reference-empty">可选，多张参考图会一起提交</div>
            </div>
          </div>

          <footer class="manual-modal-actions">
            <button type="button" class="ghost-btn" :disabled="manualGenerating" @click="closeManualGenerate">取消</button>
            <button type="button" class="primary-btn" :disabled="manualGenerating || !canSubmitManualGenerate" @click="submitManualGenerate">
              {{ manualGenerating ? '生图中' : '开始生图' }}
            </button>
          </footer>
        </section>
      </div>

      <div v-if="promptEditor.open" class="prompt-editor-modal" @click.self="closePromptEditor">
        <section class="prompt-editor-panel">
          <header class="manual-modal-head">
            <div>
              <strong>{{ promptEditor.prompt ? '编辑 Prompt' : '新增 Prompt' }}</strong>
              <span>{{ promptEditor.item?.style_code || '-' }}，保存后会作为一条生图任务提交。</span>
            </div>
            <button type="button" class="icon-btn" aria-label="关闭 Prompt 弹窗" @click="closePromptEditor">×</button>
          </header>

          <label class="inspector-field">
            <span>Prompt 名称</span>
            <input v-model="promptEditor.promptName" class="prompt-editor-input" placeholder="例如 动态定格 · 全身展示" />
          </label>

          <label class="inspector-field">
            <span>Prompt 内容</span>
            <textarea v-model="promptEditor.promptText" placeholder="输入完整生图 Prompt"></textarea>
          </label>

          <footer class="manual-modal-actions">
            <button type="button" class="ghost-btn" @click="closePromptEditor">取消</button>
            <button type="button" class="primary-btn" :disabled="!promptEditor.promptText.trim()" @click="savePromptEditor">保存</button>
          </footer>
        </section>
      </div>

      <div v-if="promptLibraryPicker.open" class="prompt-library-picker-modal" @click.self="closePromptLibraryPicker">
        <section class="prompt-library-picker-panel">
          <header class="manual-modal-head">
            <div>
              <strong>从 Prompt 库选择</strong>
              <span>{{ promptLibraryPicker.item?.style_code || '-' }}，选中后会回填当前 Prompt。</span>
            </div>
            <button type="button" class="icon-btn" aria-label="关闭 Prompt 库选择" @click="closePromptLibraryPicker">×</button>
          </header>

          <div class="prompt-library-picker-filters">
            <select v-model="promptLibraryPicker.selectedLibraryId" class="prompt-library-select" @change="loadPromptLibraryTemplates(promptLibraryPicker.selectedLibraryId)">
              <option value="">选择 Prompt 库</option>
              <option v-for="library in promptLibraryPicker.libraries" :key="library.id" :value="String(library.id)">
                {{ library.name || `Prompt 库 ${library.id}` }}
              </option>
            </select>
            <input v-model="promptLibrarySearch" class="prompt-library-search" placeholder="搜索 Prompt 名称 / 内容" />
            <select v-model="promptLibraryCategory" class="prompt-library-category">
              <option value="">全部分类</option>
              <option v-for="category in promptLibraryCategories" :key="category" :value="category">{{ category }}</option>
            </select>
            <button type="button" class="ghost-btn" :disabled="promptLibraryPicker.loading" @click="loadPromptLibraries">
              {{ promptLibraryPicker.loading ? '刷新中' : '刷新' }}
            </button>
          </div>

          <div v-if="promptLibraryPicker.error" class="prompt-library-picker-empty error">{{ promptLibraryPicker.error }}</div>
          <div v-else-if="promptLibraryPicker.loading || promptLibraryPicker.templatesLoading" class="prompt-library-picker-empty">正在读取 Prompt 库…</div>
          <div v-else class="prompt-library-template-list">
            <button
              v-for="template in filteredPromptLibraryTemplates"
              :key="template.template_id || template.id || `${template.group_name}-${template.field_name}`"
              type="button"
              class="prompt-library-template-row"
              @click="selectPromptLibraryTemplate(template)"
            >
              <span>{{ template.group_name || '未分类' }}</span>
              <strong>{{ template.field_name || '未命名 Prompt' }}</strong>
              <p>{{ template.prompt_text || template.prompt || '' }}</p>
            </button>
            <div v-if="!filteredPromptLibraryTemplates.length" class="prompt-library-picker-empty">没有匹配的 Prompt</div>
          </div>
        </section>
      </div>

      <div v-if="imagePreview.open" class="image-preview-modal" @click.self="closeImagePreview">
        <section class="image-preview-panel">
          <header class="manual-modal-head">
            <div>
              <strong>{{ imagePreview.title }}</strong>
              <span>{{ imagePreview.subtitle }}</span>
            </div>
            <button type="button" class="icon-btn" aria-label="关闭图片预览" @click="closeImagePreview">×</button>
          </header>
          <div class="image-preview-stage">
            <img :src="imagePreview.src" :alt="imagePreview.title" />
          </div>
        </section>
      </div>

      <div v-if="toast" class="approval-toast" :class="{ error: toastError }">{{ toast }}</div>
    </aside>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  modelValue: Boolean,
  boardUrl: String,
  embedded: Boolean,
  showSubmitResults: {
    type: Boolean,
    default: true,
  },
})
const emit = defineEmits(['update:modelValue', 'batch-updated', 'submit-started', 'committed'])

const MAX_CONFIRMATION_IMAGES = 10

const collapsed = ref(false)
const loading = ref(false)
const saving = ref(false)
const submitting = ref(false)
const generationSubmitting = ref(false)
const regenerating = ref(false)
const manualGenerating = ref(false)
const error = ref('')
const toast = ref('')
const toastError = ref(false)
const filterText = ref('')
const batch = ref(null)
const selectedItem = ref(null)
const selectedAsset = ref(null)
const imagePreview = ref({
  open: false,
  src: '',
  title: '',
  subtitle: '',
})
const promptEditor = ref({
  open: false,
  item: null,
  prompt: null,
  promptName: '',
  promptText: '',
})
const promptLibrarySearch = ref('')
const promptLibraryCategory = ref('')
const promptLibraryPicker = ref({
  open: false,
  item: null,
  prompt: null,
  loading: false,
  templatesLoading: false,
  error: '',
  libraries: [],
  selectedLibraryId: '',
  templates: [],
})
const manualGenerate = ref({
  open: false,
  item: null,
  prompt: '',
  mainImagePath: '',
  referencePaths: [],
})

const approvalRef = computed(() => parseApprovalUrl(props.boardUrl))
const isGenerationConfirmation = computed(() =>
  String(batch.value?.status || '').trim() === 'pending_generation_confirmation'
)
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
const submitProgress = computed(() => batch.value?.submit_progress || {})
const hasSubmitResult = computed(() => createRows.value.length > 0)
const effectiveStatus = computed(() => {
  const status = String(batch.value?.status || '').trim()
  if (String(submitProgress.value?.status || '').trim() === 'running') return 'submitting'
  if (status === 'submitted' && createRows.value.some(row => String(row?.执行结果 || '').includes('失败'))) {
    return 'partial_failed'
  }
  return status
})
const createStartedStatuses = new Set(['submitting', 'submitted', 'created', 'partial_failed', 'create_failed'])
const createStarted = computed(() =>
  hasSubmitResult.value || createStartedStatuses.has(effectiveStatus.value)
)
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
const approvedSubmitStyleCount = computed(() =>
  (batch.value?.items || []).filter(item =>
    (item.assets || []).some(asset => asset.kind === 'ai' && asset.status === 'approved')
  ).length
)
const generationPromptCount = computed(() =>
  (batch.value?.items || []).reduce((total, item) => total + activeGenerationPrompts(item).length, 0)
)
const submitProgressTotal = computed(() => {
  const total = Number(submitProgress.value?.total || 0)
  if (Number.isFinite(total) && total > 0) return total
  return createSummary.value.attempted || approvedSubmitStyleCount.value || createRows.value.length
})
const submitProgressCompleted = computed(() => {
  const completed = Number(submitProgress.value?.completed ?? submitProgress.value?.attempted ?? 0)
  if (Number.isFinite(completed) && completed > 0) return Math.min(completed, submitProgressTotal.value || completed)
  return createSummary.value.attempted || createRows.value.length || 0
})
const submitProgressPercent = computed(() => {
  const total = submitProgressTotal.value
  if (!total) return 0
  return Math.max(0, Math.min(100, Math.round((submitProgressCompleted.value / total) * 100)))
})
const showSubmitProgress = computed(() =>
  submitting.value || generationSubmitting.value || submitProgressTotal.value > 0 || createStarted.value
)
const submitProgressText = computed(() => {
  const message = String(submitProgress.value?.message || '').trim()
  if (message) return message
  if (submitting.value || effectiveStatus.value === 'submitting') return '正在提交已确认图片并创建测图任务'
  if (effectiveStatus.value === 'created') return '全部测图任务已提交'
  if (['partial_failed', 'create_failed'].includes(effectiveStatus.value)) return '提交完成，存在失败款'
  return '审批完成后提交到天猫后台'
})
const generationStageClass = computed(() => {
  if (isGenerationConfirmation.value) return 'active'
  if (summary.value.aiTotal > 0 || createStarted.value) return 'done'
  if (loading.value || batch.value?.batch_id || effectiveStatus.value === 'generating') return 'active'
  return 'pending'
})
const generationStageLabel = computed(() => {
  if (isGenerationConfirmation.value) return `${generationPromptCount.value} 条 Prompt 待确认`
  if (summary.value.aiTotal > 0) return `${summary.value.aiTotal} 张 AI 图`
  if (generationSubmitting.value) return '正在批量生图'
  if (loading.value) return '正在读取批次'
  if (batch.value?.batch_id || effectiveStatus.value === 'generating') return '等待 AI 图生成'
  return '未开始'
})
const approvalStageClass = computed(() => {
  if (createStarted.value) return 'done'
  if (isGenerationConfirmation.value) return 'pending'
  if (summary.value.aiTotal <= 0) return 'pending'
  if (summary.value.pending > 0) return 'active'
  if (summary.value.approved > 0) return 'done'
  if (summary.value.rejected > 0) return 'error'
  return 'pending'
})
const approvalStageLabel = computed(() => {
  if (isGenerationConfirmation.value) return '确认提交后进入审批'
  if (summary.value.aiTotal <= 0) return '等待生图完成'
  return `确认 ${summary.value.approved} / 舍弃 ${summary.value.rejected} / 待定 ${summary.value.pending}`
})
const createStageClass = computed(() => {
  if (['created'].includes(effectiveStatus.value)) return 'done'
  if (['partial_failed', 'create_failed'].includes(effectiveStatus.value)) return 'error'
  if (createStarted.value) return 'active'
  return 'pending'
})
const createStageLabel = computed(() => {
  if (effectiveStatus.value === 'submitting') return `提交 ${submitProgressCompleted.value}/${submitProgressTotal.value || '?'} 款`
  if (effectiveStatus.value === 'created') return `创建成功 ${createSummary.value.succeeded} 款`
  if (effectiveStatus.value === 'partial_failed') return `部分失败 ${createSummary.value.failed} 款`
  if (effectiveStatus.value === 'create_failed') return '创建失败'
  if (effectiveStatus.value === 'submitted') return '已提交，等待回读'
  return '确认后触发'
})
const batchStatusLabel = computed(() => {
  if (effectiveStatus.value === 'submitting') return '提交中'
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
const selectedReferencePaths = computed(() => plainStringArray(selectedAsset.value?.reference_paths))
const canSubmitManualGenerate = computed(() =>
  Boolean(String(manualGenerate.value.prompt || '').trim()
  && String(manualGenerate.value.mainImagePath || '').trim())
)
const promptLibraryCategories = computed(() => {
  const seen = new Set()
  for (const template of promptLibraryPicker.value.templates || []) {
    const group = String(template?.group_name || '').trim()
    if (group) seen.add(group)
  }
  return Array.from(seen)
})
const filteredPromptLibraryTemplates = computed(() => {
  const search = promptLibrarySearch.value.trim().toLowerCase()
  const category = promptLibraryCategory.value.trim()
  return (promptLibraryPicker.value.templates || []).filter(template => {
    if (category && String(template?.group_name || '').trim() !== category) return false
    if (!search) return true
    const haystack = [
      template?.group_name,
      template?.field_name,
      template?.prompt_text,
      template?.prompt,
      template?.size_label,
    ].join(' ').toLowerCase()
    return haystack.includes(search)
  })
})

watch(() => [props.modelValue, props.boardUrl], ([open]) => {
  if (open) reload()
}, { immediate: true })
watch(selectedAsset, (asset) => {
  prepareEditableAsset(asset)
}, { immediate: true })

let submitPollTimer = null

function stopSubmitProgressPolling() {
  if (!submitPollTimer) return
  window.clearInterval(submitPollTimer)
  submitPollTimer = null
}

function startSubmitProgressPolling() {
  stopSubmitProgressPolling()
  submitPollTimer = window.setInterval(() => {
    if (!submitting.value) {
      stopSubmitProgressPolling()
      return
    }
    void reload('', { silent: true })
  }, 1600)
}

onBeforeUnmount(() => {
  stopSubmitProgressPolling()
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

async function reload(preferredAssetId = '', options = {}) {
  const ref = approvalRef.value
  if (!ref.batchId || !ref.token) {
    error.value = '审批批次链接无效'
    return
  }
  if (!options.silent) loading.value = true
  error.value = ''
  try {
    const payload = await window.cs.getTmallApprovalBatch(ref.batchId, ref.token)
    if (payload?.detail) throw new Error(payload.detail)
    prepareEditableBatch(payload)
    batch.value = payload
    emit('batch-updated', payload)
    const preferredId = String(preferredAssetId || selectedAsset.value?.id || '').trim()
    const matchedItem = preferredId
      ? (payload?.items || []).find(item => (item.assets || []).some(asset => asset.id === preferredId))
      : null
    selectedItem.value = matchedItem || payload?.items?.[0] || null
    selectedAsset.value = preferredId
      ? (selectedItem.value?.assets || []).find(asset => asset.id === preferredId) || null
      : null
    if (!selectedAsset.value) {
      selectedAsset.value = selectedItem.value?.assets?.find(asset => asset.kind === 'ai') || selectedItem.value?.assets?.[0] || null
    }
    prepareEditableAsset(selectedAsset.value)
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    if (!options.silent) loading.value = false
  }
}

function close() {
  emit('update:modelValue', false)
}

function normalizeUrlBase(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function tmallApprovalApiBase() {
  const bridgeBase = normalizeUrlBase(window.cs?.getApiBase?.())
  if (bridgeBase) return bridgeBase
  return normalizeUrlBase(approvalRef.value?.origin) || 'http://127.0.0.1:18765'
}

function imageUrl(asset) {
  const ref = approvalRef.value
  if (!ref.batchId || !asset?.id) return ''
  return `${tmallApprovalApiBase()}/tmall-ai-image-approval/api/${encodeURIComponent(ref.batchId)}/image/${encodeURIComponent(asset.id)}?token=${encodeURIComponent(ref.token)}`
}

function referenceImageUrl(path) {
  const ref = approvalRef.value
  if (!ref.batchId || !path) return ''
  return `${tmallApprovalApiBase()}/tmall-ai-image-approval/api/${encodeURIComponent(ref.batchId)}/reference-image?token=${encodeURIComponent(ref.token)}&path=${encodeURIComponent(path)}`
}

function assetImageVersion(asset) {
  return encodeURIComponent(String(asset?.updated_at || asset?.regenerated_at || asset?.created_at || batch.value?.updated_at || ''))
}

function imageUrlWithVersion(asset) {
  if (isGenerationConfirmation.value && asset?.kind !== 'ai' && asset?.path) {
    return referenceImageUrl(asset.path)
  }
  const url = imageUrl(asset)
  const version = assetImageVersion(asset)
  return version ? `${url}&v=${version}` : url
}

function selectAsset(item, asset) {
  selectedItem.value = item
  selectedAsset.value = asset
  prepareEditableAsset(asset)
}

function prepareEditableAsset(asset) {
  if (!asset || asset.kind !== 'ai') return
  if (!String(asset.custom_prompt || '').trim()) {
    asset.custom_prompt = String(asset.prompt || asset.generation_row?.完整Prompt || asset.generation_row?.最终提示词 || '')
  }
  if (!Array.isArray(asset.reference_paths) || !asset.reference_paths.length) {
    asset.reference_paths = plainStringArray(asset.generation_row?.参考图文件)
  }
}

function prepareReferenceAsset(asset) {
  if (!asset || asset.kind === 'ai') return
  if (asset.kind === 'origin') {
    asset.slot = 'main'
    asset.use_for_generation = true
    return
  }
  asset.slot = asset.slot || 'reference'
  asset.use_for_generation = Boolean(asset.use_for_generation)
}

function prepareEditableBatch(payload) {
  const confirmation = String(payload?.status || '').trim() === 'pending_generation_confirmation'
  for (const item of payload?.items || []) {
    for (const asset of item?.assets || []) {
      prepareReferenceAsset(asset)
      prepareEditableAsset(asset)
    }
    for (const prompt of item?.generation_prompts || []) {
      if (!String(prompt.custom_prompt || '').trim()) {
        prompt.custom_prompt = String(prompt.prompt || prompt.generation_row?.完整Prompt || prompt.generation_row?.最终提示词 || '')
      }
      prompt.reference_paths = plainStringArray(prompt.reference_paths?.length ? prompt.reference_paths : prompt.generation_row?.参考图文件)
      if (confirmation) {
        prompt.reference_paths = normalizePromptReferencePaths(item, prompt)
      }
    }
  }
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

function itemMainAsset(item) {
  return (item?.assets || []).find(asset =>
    asset?.kind === 'origin' || asset?.slot === 'main'
  ) || null
}

function itemReferenceAssets(item) {
  return (item?.assets || []).filter(asset =>
    asset?.kind !== 'ai'
    && asset?.path
    && asset?.kind !== 'origin'
    && asset?.slot !== 'main'
  )
}

function itemImageCount(item) {
  return (item?.assets || []).filter(asset => asset?.kind !== 'ai' && asset?.path).length
}

function promptImageCount(prompt) {
  return plainStringArray(prompt?.reference_paths).length
}

function normalizePromptReferencePaths(item, prompt) {
  const refs = plainStringArray(prompt?.reference_paths)
  const mainPath = String(itemMainAsset(item)?.path || item?.origin_path || '').trim()
  const selectedReferences = refs.filter(path => path && path !== mainPath)
  const initiallySelectedReferences = selectedReferences.filter(path => {
    const asset = itemReferenceAssets(item).find(row => row.path === path)
    return Boolean(asset?.use_for_generation)
  })
  return Array.from(new Set([mainPath, ...initiallySelectedReferences].filter(Boolean))).slice(0, MAX_CONFIRMATION_IMAGES)
}

function referenceImageSelected(prompt, asset) {
  const path = String(asset?.path || '').trim()
  return Boolean(path && plainStringArray(prompt?.reference_paths).includes(path))
}

function togglePromptReferenceImage(prompt, asset) {
  const path = String(asset?.path || '').trim()
  if (!path) return
  const current = plainStringArray(prompt.reference_paths)
  if (current.includes(path)) {
    prompt.reference_paths = current.filter(item => item !== path)
    return
  }
  if (current.length >= MAX_CONFIRMATION_IMAGES) {
    showToast(`单条 Prompt 最多选择 ${MAX_CONFIRMATION_IMAGES} 张图`, true)
    return
  }
  prompt.reference_paths = [...current, path]
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
  prepareEditableBatch(batch.value)
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

async function saveDecisions(options = {}) {
  const ref = approvalRef.value
  saving.value = true
  try {
    const result = await window.cs.saveTmallApprovalDecisions(ref.batchId, ref.token, decisionsPayload())
    if (result?.detail || result?.error) throw new Error(result.detail || result.error)
    if (!options.silent) showToast('审批状态已保存')
    return true
  } catch (err) {
    if (!options.silent) showToast(err?.message || String(err), true)
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
    const total = approvedSubmitStyleCount.value || summary.value.styles || 0
    batch.value = {
      ...(batch.value || {}),
      status: 'submitting',
      submit_progress: {
        status: 'running',
        total,
        completed: 0,
        attempted: 0,
        succeeded: 0,
        failed: 0,
        current_style: '',
        message: '正在提交已确认图片并创建测图任务',
      },
    }
    emit('batch-updated', batch.value)
    emit('submit-started', batch.value)
    showToast('正在提交已确认图片并创建测图任务')
    startSubmitProgressPolling()
    const result = await window.cs.submitTmallApprovalBatch(ref.batchId, ref.token)
    if (result?.detail || result?.error) throw new Error(result.detail || result.error)
    if (result?.ok === false || result?.failed > 0) {
      showToast(`创建结果异常：成功 ${result?.succeeded || 0} / 尝试 ${result?.attempted || 0}`, true)
    } else {
      showToast(`创建成功 ${result?.succeeded || result?.submitted || 0} 款测图任务`)
    }
    await reload()
    emit('committed', batch.value)
  } catch (err) {
    showToast(err?.message || String(err), true)
  } finally {
    submitting.value = false
    stopSubmitProgressPolling()
  }
}

function activeGenerationPrompts(item) {
  return (item?.generation_prompts || []).filter(prompt =>
    !['removed', 'deleted', 'disabled', 'skip', 'skipped'].includes(String(prompt?.status || '').trim().toLowerCase())
  )
}

function generationConfirmationPayload() {
  return {
    items: (batch.value?.items || []).map(item => {
      const main = itemMainAsset(item)
      const references = itemReferenceAssets(item)
      return {
        id: String(item.id || ''),
        style_code: String(item.style_code || ''),
        item_id: String(item.item_id || ''),
        origin_path: String(main?.path || item.origin_path || ''),
        detail_reference_path: String(item.detail_reference_path || references[0]?.path || ''),
        reference_assets: references.map(asset => ({
          id: String(asset.id || ''),
          kind: String(asset.kind || 'detail_reference'),
          slot: 'reference',
          label: String(asset.label || '参考图'),
          path: String(asset.path || ''),
          filename: String(asset.filename || referenceFileName(asset.path)),
          use_for_generation: false,
        })),
        generation_prompts: activeGenerationPrompts(item).map((prompt, index) => ({
          id: String(prompt.id || ''),
          prompt_index: Number(prompt.prompt_index || index + 1),
          prompt_name: String(prompt.prompt_name || `Prompt ${index + 1}`),
          prompt_group: String(prompt.prompt_group || ''),
          prompt: String(prompt.custom_prompt || prompt.prompt || ''),
          custom_prompt: String(prompt.custom_prompt || ''),
          reference_paths: plainStringArray(prompt.reference_paths).slice(0, MAX_CONFIRMATION_IMAGES),
          status: String(prompt.status || 'pending'),
          generation_row: prompt.generation_row || {},
        })),
      }
    }),
  }
}

async function submitGenerationConfirmation() {
  const ref = approvalRef.value
  generationSubmitting.value = true
  try {
    const result = await window.cs.submitTmallApprovalGeneration(ref.batchId, ref.token, generationConfirmationPayload())
    if (result?.detail || result?.error) throw new Error(result.detail || result.error)
    if (result?.batch) {
      prepareEditableBatch(result.batch)
      batch.value = result.batch
      emit('batch-updated', result.batch)
    } else {
      await reload()
    }
    showToast(`生图完成：${result?.generated || summary.value.aiTotal || 0} 张`)
  } catch (err) {
    showToast(err?.message || String(err), true)
  } finally {
    generationSubmitting.value = false
  }
}

function useItemReferences() {
  if (!selectedAsset.value || !selectedItem.value) return
  const refs = (selectedItem.value.assets || [])
    .filter(asset => asset.kind !== 'ai' && asset.path)
    .map(asset => asset.path)
  selectedAsset.value.reference_paths = refs
}

function updateReferenceAssetLocal(asset, path) {
  asset.slot = asset.kind === 'origin' ? 'main' : (asset.slot || 'reference')
  asset.use_for_generation = asset.kind === 'origin'
  asset.path = String(path || '').trim()
  asset.filename = referenceFileName(asset.path)
  asset.updated_at = new Date().toISOString()
}

async function replaceItemReference(item, asset) {
  try {
    const path = await window.cs.browseFile?.({
      title: asset?.kind === 'origin' ? '选择主图' : '选择参考图',
      images: true,
    })
    const importedPaths = await importApprovalImageFiles(path ? [path] : [])
    if (!importedPaths.length) return
    const selected = importedPaths[0]
    const previousPath = String(asset?.path || '').trim()
    if (asset.kind === 'origin') item.origin_path = selected
    if (asset.kind === 'detail_reference' && (!item.detail_reference_path || item.detail_reference_path === previousPath)) {
      item.detail_reference_path = selected
    }
    updateReferenceAssetLocal(asset, selected)
    for (const prompt of item.generation_prompts || []) {
      const refs = plainStringArray(prompt.reference_paths)
      prompt.reference_paths = refs.map(ref => ref === previousPath ? selected : ref)
      if (asset.kind === 'origin' && !prompt.reference_paths.includes(selected)) {
        prompt.reference_paths = [selected, ...prompt.reference_paths].slice(0, MAX_CONFIRMATION_IMAGES)
      }
    }
  } catch (err) {
    showToast(err?.message || String(err), true)
  }
}

async function replaceItemMainImage(item) {
  let asset = itemMainAsset(item)
  if (!asset) {
    asset = {
      id: `${item.style_code || 'style'}-origin-${Date.now()}`,
      kind: 'origin',
      label: '原图/主图',
      slot: 'main',
      status: 'reference',
      use_for_generation: true,
      path: '',
      filename: '',
    }
    item.assets = [asset, ...(item.assets || [])]
  }
  await replaceItemReference(item, asset)
}

function clearItemMainImage(item) {
  const asset = itemMainAsset(item)
  if (!asset) return
  const removedPath = String(asset.path || '').trim()
  item.origin_path = ''
  item.assets = (item.assets || []).filter(row => row !== asset)
  for (const prompt of item.generation_prompts || []) {
    prompt.reference_paths = plainStringArray(prompt.reference_paths).filter(path => path !== removedPath)
  }
}

function clearItemReference(item, asset) {
  if (!asset || asset.kind === 'origin' || asset.slot === 'main') return
  const removedPath = String(asset.path || '').trim()
  if (String(item.detail_reference_path || '').trim() === removedPath) item.detail_reference_path = ''
  item.assets = (item.assets || []).filter(row => row.id !== asset.id)
  for (const prompt of item.generation_prompts || []) {
    prompt.reference_paths = plainStringArray(prompt.reference_paths).filter(path => path !== removedPath)
  }
}

function createReferenceAsset(item, path, index = 1) {
  return {
    id: `${item.style_code || 'style'}-reference-${Date.now()}-${index}`,
    kind: 'detail_reference',
    label: '参考图',
    slot: 'reference',
    status: 'reference',
    use_for_generation: false,
    path,
    filename: referenceFileName(path),
    updated_at: new Date().toISOString(),
  }
}

async function addItemReferenceImage(item) {
  if (itemImageCount(item) >= MAX_CONFIRMATION_IMAGES) {
    showToast(`每款最多保留 ${MAX_CONFIRMATION_IMAGES} 张确认图片`, true)
    return
  }
  try {
    const paths = await window.cs.browseFile?.({
      title: '选择参考图',
      images: true,
      multi: true,
      multiSelections: true,
    })
    const importedPaths = await importApprovalImageFiles(paths)
    if (!importedPaths.length) return
    const remaining = Math.max(0, MAX_CONFIRMATION_IMAGES - itemImageCount(item))
    const assets = importedPaths.slice(0, remaining).map((path, index) => createReferenceAsset(item, path, index + 1))
    item.assets = [...(item.assets || []), ...assets]
    if (!String(item.detail_reference_path || '').trim() && assets[0]?.path) {
      item.detail_reference_path = assets[0].path
    }
    if (importedPaths.length > remaining) {
      showToast(`已达到 ${MAX_CONFIRMATION_IMAGES} 张上限，超出图片未加入`, true)
    }
  } catch (err) {
    showToast(err?.message || String(err), true)
  }
}

function addGenerationPrompt(item, values = {}) {
  const prompts = item.generation_prompts || []
  const first = prompts[0] || {}
  const nextIndex = prompts.length + 1
  const mainPath = String(itemMainAsset(item)?.path || item.origin_path || '').trim()
  const prompt = {
    id: `${item.style_code || 'style'}-manual-${Date.now()}`,
    prompt_index: nextIndex,
    prompt_name: String(values.promptName || `新增 Prompt ${nextIndex}`),
    prompt_group: first.prompt_group || '',
    prompt: String(values.promptText || ''),
    custom_prompt: String(values.promptText || ''),
    reference_paths: mainPath ? [mainPath] : [],
    status: 'pending',
    generation_row: first.generation_row || {},
  }
  item.generation_prompts = [...prompts, prompt]
}

async function openPromptLibraryPicker(item, prompt) {
  promptLibraryPicker.value = {
    ...promptLibraryPicker.value,
    open: true,
    item,
    prompt,
    error: '',
  }
  if (!(promptLibraryPicker.value.libraries || []).length) {
    await loadPromptLibraries()
  } else if (promptLibraryPicker.value.selectedLibraryId) {
    await loadPromptLibraryTemplates(promptLibraryPicker.value.selectedLibraryId)
  }
}

function closePromptLibraryPicker() {
  promptLibraryPicker.value.open = false
}

async function loadPromptLibraries() {
  promptLibraryPicker.value.loading = true
  promptLibraryPicker.value.error = ''
  try {
    const payload = await window.cs.listCloudPromptLibraries()
    if (payload?.detail || payload?.error) throw new Error(payload.detail || payload.error)
    const libraries = Array.isArray(payload?.libraries) ? payload.libraries : []
    promptLibraryPicker.value.libraries = libraries
    const nextLibraryId = String(promptLibraryPicker.value.selectedLibraryId || libraries[0]?.id || '').trim()
    promptLibraryPicker.value.selectedLibraryId = nextLibraryId
    if (nextLibraryId) await loadPromptLibraryTemplates(nextLibraryId)
  } catch (err) {
    promptLibraryPicker.value.error = err?.message || String(err)
  } finally {
    promptLibraryPicker.value.loading = false
  }
}

async function loadPromptLibraryTemplates(libraryId) {
  const id = String(libraryId || '').trim()
  if (!id) {
    promptLibraryPicker.value.templates = []
    return
  }
  promptLibraryPicker.value.templatesLoading = true
  promptLibraryPicker.value.error = ''
  try {
    const payload = await window.cs.resolveCloudPromptTemplates(id, { limit: 500 })
    if (payload?.detail || payload?.error) throw new Error(payload.detail || payload.error)
    promptLibraryPicker.value.templates = Array.isArray(payload?.templates) ? payload.templates : []
    promptLibraryCategory.value = ''
  } catch (err) {
    promptLibraryPicker.value.error = err?.message || String(err)
    promptLibraryPicker.value.templates = []
  } finally {
    promptLibraryPicker.value.templatesLoading = false
  }
}

function selectPromptLibraryTemplate(template) {
  const item = promptLibraryPicker.value.item
  const prompt = promptLibraryPicker.value.prompt
  const promptText = String(template?.prompt_text || template?.prompt || '').trim()
  if (!item || !promptText) return
  const promptName = String(template?.field_name || template?.name || 'Prompt').trim()
  if (prompt) {
    prompt.prompt_name = promptName
    prompt.prompt_group = String(template?.group_name || prompt.prompt_group || '')
    prompt.prompt = promptText
    prompt.custom_prompt = promptText
  } else {
    addGenerationPrompt(item, {
      promptName,
      promptText,
    })
  }
  closePromptLibraryPicker()
}

function openPromptEditor(item, prompt = null) {
  promptEditor.value = {
    open: true,
    item,
    prompt,
    promptName: String(prompt?.prompt_name || ''),
    promptText: String(prompt?.custom_prompt || prompt?.prompt || ''),
  }
}

function closePromptEditor() {
  promptEditor.value = {
    open: false,
    item: null,
    prompt: null,
    promptName: '',
    promptText: '',
  }
}

function savePromptEditor() {
  const editor = promptEditor.value
  const item = editor.item
  const promptText = String(editor.promptText || '').trim()
  if (!item || !promptText) return
  if (editor.prompt) {
    editor.prompt.prompt_name = String(editor.promptName || editor.prompt.prompt_name || 'Prompt')
    editor.prompt.prompt = promptText
    editor.prompt.custom_prompt = promptText
  } else {
    addGenerationPrompt(item, {
      promptName: String(editor.promptName || '').trim(),
      promptText,
    })
  }
  closePromptEditor()
}

function openImagePreview(asset, item = null) {
  if (!asset) return
  imagePreview.value = {
    open: true,
    src: asset.kind === 'ai' ? imageUrlWithVersion(asset) : referenceImageUrl(asset.path),
    title: `${item?.style_code || ''} ${asset.label || asset.filename || '图片'}`.trim(),
    subtitle: asset.filename || asset.path || '',
  }
}

function closeImagePreview() {
  imagePreview.value = {
    open: false,
    src: '',
    title: '',
    subtitle: '',
  }
}

function removeGenerationPrompt(item, prompt) {
  prompt.status = 'removed'
  item.generation_prompts = (item.generation_prompts || []).filter(row => row !== prompt)
}

function useItemReferencesForPrompt(item, prompt) {
  prompt.reference_paths = itemReferencePaths(item)
}

async function pickPromptReferenceFiles(prompt, options = {}) {
  try {
    const paths = await window.cs.browseFile?.({
      title: '选择参考图',
      images: true,
      multi: true,
      multiSelections: true,
    })
    const importedPaths = await importApprovalImageFiles(paths)
    if (!importedPaths.length) return
    prompt.reference_paths = options.replace
      ? importedPaths
      : Array.from(new Set([...plainStringArray(prompt.reference_paths), ...importedPaths]))
  } catch (err) {
    showToast(err?.message || String(err), true)
  }
}

function removePromptReferencePath(prompt, path) {
  prompt.reference_paths = plainStringArray(prompt.reference_paths).filter(item => item !== path)
}

async function pickReferenceFiles(options = {}) {
  const ref = approvalRef.value
  const paths = await window.cs.browseFile?.({
    title: '选择参考图',
    images: true,
    multi: true,
    multiSelections: true,
  })
  const selected = plainStringArray(paths)
  if (!selected.length || !selectedAsset.value) return
  const imported = await window.cs.importTmallApprovalReferenceFiles?.(ref.batchId, ref.token, selected)
  if (imported?.detail || imported?.error) {
    showToast(imported.detail || imported.error, true)
    return
  }
  const importedPaths = plainStringArray(imported?.paths)
  if (!importedPaths.length) {
    showToast('未导入可用参考图', true)
    return
  }
  const refs = options.replace ? importedPaths : [...plainStringArray(selectedAsset.value.reference_paths), ...importedPaths]
  selectedAsset.value.reference_paths = Array.from(new Set(refs))
  await saveDecisions({ silent: true })
}

async function importApprovalImageFiles(paths) {
  const ref = approvalRef.value
  const selected = plainStringArray(paths)
  if (!selected.length) return []
  const imported = await window.cs.importTmallApprovalReferenceFiles?.(ref.batchId, ref.token, selected)
  if (imported?.detail || imported?.error) {
    throw new Error(imported.detail || imported.error)
  }
  return plainStringArray(imported?.paths)
}

function removeReferencePath(path) {
  if (!selectedAsset.value) return
  selectedAsset.value.reference_paths = plainStringArray(selectedAsset.value.reference_paths)
    .filter(item => item !== path)
}

function itemReferencePaths(item, excludePath = '') {
  const blocked = String(excludePath || '').trim()
  return Array.from(new Set((item?.assets || [])
    .filter(asset => asset.kind !== 'ai' && asset.path)
    .map(asset => asset.path)
    .filter(path => !blocked || path !== blocked)))
}

function openManualGenerate(item) {
  const firstAi = (item?.assets || []).find(asset => asset.kind === 'ai')
  const mainImagePath = String(item?.origin_path || '').trim()
  manualGenerate.value = {
    open: true,
    item,
    prompt: String(firstAi?.custom_prompt || firstAi?.prompt || firstAi?.generation_row?.完整Prompt || firstAi?.generation_row?.最终提示词 || ''),
    mainImagePath,
    referencePaths: itemReferencePaths(item, mainImagePath),
  }
}

function openTmallDetailUrl(url) {
  const target = String(url || '').trim()
  if (!target) return
  window.cs.openFile(target)
}

function closeManualGenerate(force = false) {
  if (manualGenerating.value && !force) return
  manualGenerate.value = {
    open: false,
    item: null,
    prompt: '',
    mainImagePath: '',
    referencePaths: [],
  }
}

function useManualItemMain() {
  const item = manualGenerate.value.item
  manualGenerate.value.mainImagePath = String(item?.origin_path || '').trim()
}

function useManualItemReferences() {
  const item = manualGenerate.value.item
  manualGenerate.value.referencePaths = itemReferencePaths(item, manualGenerate.value.mainImagePath)
}

async function pickManualMainImage() {
  try {
    const path = await window.cs.browseFile?.({
      title: '选择主图',
      images: true,
    })
    const importedPaths = await importApprovalImageFiles(path ? [path] : [])
    if (importedPaths.length) manualGenerate.value.mainImagePath = importedPaths[0]
  } catch (err) {
    showToast(err?.message || String(err), true)
  }
}

async function pickManualReferenceFiles(options = {}) {
  try {
    const paths = await window.cs.browseFile?.({
      title: '选择参考图',
      images: true,
      multi: true,
      multiSelections: true,
    })
    const importedPaths = await importApprovalImageFiles(paths)
    if (!importedPaths.length) return
    const refs = options.replace
      ? importedPaths
      : [...plainStringArray(manualGenerate.value.referencePaths), ...importedPaths]
    manualGenerate.value.referencePaths = Array.from(new Set(refs))
  } catch (err) {
    showToast(err?.message || String(err), true)
  }
}

function removeManualReferencePath(path) {
  manualGenerate.value.referencePaths = plainStringArray(manualGenerate.value.referencePaths)
    .filter(item => item !== path)
}

async function submitManualGenerate() {
  const ref = approvalRef.value
  const item = manualGenerate.value.item
  if (!item) return
  manualGenerating.value = true
  try {
    const result = await window.cs.generateTmallApprovalAsset(ref.batchId, ref.token, {
      item_id: String(item.id || ''),
      style_code: String(item.style_code || ''),
      prompt: String(manualGenerate.value.prompt || ''),
      main_image_path: String(manualGenerate.value.mainImagePath || ''),
      reference_paths: plainStringArray(manualGenerate.value.referencePaths),
    })
    if (result?.detail || result?.error) throw new Error(result.detail || result.error)
    const asset = result.asset
    if (asset?.id) {
      const targetItem = (batch.value?.items || []).find(row => row.id === item.id || row.style_code === item.style_code) || item
      targetItem.assets = [...(targetItem.assets || []), asset]
      selectAsset(targetItem, asset)
    }
    showToast('新增生图完成')
    closeManualGenerate(true)
    await reload(asset?.id || '')
  } catch (err) {
    showToast(err?.message || String(err), true)
  } finally {
    manualGenerating.value = false
  }
}

async function regenerateSelected() {
  const ref = approvalRef.value
  const asset = selectedAsset.value
  if (!asset?.id) return
  regenerating.value = true
  const previousStatus = asset.status
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
    prepareEditableAsset(asset)
    showToast('重新生成完成')
  } catch (err) {
    asset.status = previousStatus || 'pending'
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

function referenceFileName(path) {
  return String(path || '').split('/').pop().split('\\').pop() || '参考图'
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
  overflow: hidden;
}
.approval-drawer.embedded {
  width: 100%;
  height: calc(100vh - 96px);
  min-height: 560px;
  max-height: 900px;
  border: 0;
  border-radius: 10px;
  box-shadow: none;
  overflow: hidden;
}
.approval-drawer.embedded .approval-body {
  min-height: 420px;
}
.approval-drawer.embedded .approval-head {
  padding: 10px 14px;
  align-items: center;
}
.approval-drawer.embedded .approval-meta {
  margin-top: 0;
}
.approval-drawer.embedded .approval-toolbar {
  padding: 9px 14px;
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
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  overflow: hidden;
}
.approval-submit-progress {
  border-bottom: 1px solid var(--border);
  background: rgba(255, 255, 255, .018);
  padding: 12px 22px;
  display: grid;
  gap: 9px;
}
.approval-drawer.embedded .approval-submit-progress {
  padding: 10px 14px;
}
.submit-progress-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.submit-progress-head strong,
.submit-progress-head span {
  display: block;
}
.submit-progress-head strong {
  color: var(--text);
  font-size: 13px;
}
.submit-progress-head span {
  margin-top: 3px;
  color: var(--text3);
  font-size: 12px;
}
.submit-progress-percent {
  color: var(--orange);
  font-size: 13px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}
.submit-progress-bar {
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255, 255, 255, .07);
}
.submit-progress-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #f97316, #22c55e);
  transition: width .22s ease;
}
.submit-progress-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  color: var(--text3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
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
.tmall-detail-link {
  display: inline-block;
  margin-top: 6px;
  border: 0;
  background: transparent;
  color: var(--orange);
  padding: 0;
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  text-align: left;
  cursor: pointer;
}
.tmall-detail-link:hover {
  text-decoration: underline;
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
  height: 100%;
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
  align-items: flex-start;
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
.style-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}
.style-actions .style-mode {
  margin: 0;
}
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
.add-card {
  min-height: 100%;
  border-style: dashed;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 18px 12px;
  color: var(--text2);
  cursor: pointer;
}
.add-card:hover {
  border-color: var(--orange);
  background: rgba(255, 106, 41, .07);
}
.add-icon {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 106, 41, .42);
  color: var(--orange);
  font-size: 24px;
  line-height: 1;
}
.add-card strong,
.add-card small {
  display: block;
  text-align: center;
}
.add-card strong {
  color: var(--text);
  font-size: 13px;
}
.add-card small {
  color: var(--text3);
  font-size: 11px;
  line-height: 1.35;
}
.reference-tools {
  margin-top: 14px;
}
.reference-tools.inline {
  margin-top: 10px;
}
.generation-confirm-list {
  display: grid;
  gap: 12px;
  padding: 0 16px 16px;
}
.generation-prompt-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  padding: 12px;
}
.generation-prompt-head {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
}
.prompt-name-input {
  min-width: 0;
  flex: 1;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg2);
  color: var(--text);
}
.generation-prompt-card textarea {
  width: 100%;
  min-height: 76px;
  resize: vertical;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg2);
  color: var(--text);
}
.confirmation-image-slots {
  margin-top: 12px;
  display: grid;
  grid-template-columns: minmax(132px, 168px) minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
}
.main-image-slot,
.reference-image-slots {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, .018);
  padding: 10px;
}
.slot-head {
  min-height: 32px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}
.slot-head strong,
.slot-head span {
  display: block;
}
.slot-head strong {
  color: var(--text);
  font-size: 12px;
}
.slot-head span {
  margin-top: 2px;
  color: var(--text3);
  font-size: 11px;
}
.slot-card,
.reference-image-slot {
  position: relative;
  min-width: 0;
  margin: 0;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--bg3);
  overflow: hidden;
}
.slot-card.selected,
.reference-image-slot.selected {
  border-color: rgba(31, 184, 156, .68);
  box-shadow: inset 0 0 0 1px rgba(31, 184, 156, .18);
}
.slot-image-button {
  width: 100%;
  border: 0;
  background: transparent;
  padding: 0;
  display: block;
  cursor: zoom-in;
}
.slot-image-button img {
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  display: block;
  background: rgba(255, 255, 255, .04);
}
.slot-card figcaption,
.reference-image-slot figcaption {
  padding: 7px 8px 0;
  color: var(--text3);
  font-size: 11px;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.slot-actions {
  display: flex;
  gap: 6px;
  padding: 8px;
}
.slot-actions .ghost-btn {
  flex: 1;
  padding: 6px 8px;
}
.reference-slot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 10px;
}
.slot-check {
  position: absolute;
  z-index: 2;
  top: 6px;
  left: 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  background: rgba(0, 0, 0, .62);
  color: #fff;
  padding: 4px 7px;
  font-size: 11px;
  font-weight: 800;
}
.slot-check input {
  width: 13px;
  height: 13px;
  margin: 0;
  accent-color: #1fb89c;
}
.empty-slot {
  width: 100%;
  min-height: 118px;
  border: 1px dashed var(--border);
  border-radius: 9px;
  background: transparent;
  color: var(--text2);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}
.empty-slot:hover {
  border-color: var(--orange);
  color: var(--text);
}
.reference-preview-grid.compact {
  margin-top: 10px;
}
.reference-preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(94px, 1fr));
  gap: 10px;
}
.reference-preview-card {
  position: relative;
  min-width: 0;
  margin: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg3);
}
.reference-preview-card img {
  width: 100%;
  aspect-ratio: 1;
  display: block;
  object-fit: cover;
  background: rgba(255, 255, 255, .04);
}
.reference-preview-card figcaption {
  padding: 7px 8px;
  color: var(--text3);
  font-size: 11px;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.reference-preview-card button {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  border: 1px solid rgba(0, 0, 0, .2);
  border-radius: 50%;
  background: rgba(0, 0, 0, .58);
  color: #fff;
  cursor: pointer;
  line-height: 1;
}
.reference-empty {
  border: 1px dashed var(--border);
  border-radius: 10px;
  padding: 18px 12px;
  color: var(--text3);
  text-align: center;
  font-size: 12px;
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
.prompt-editor-input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg3);
  color: var(--text);
  padding: 10px 11px;
  font-size: 13px;
  outline: none;
}
.prompt-editor-input:focus {
  border-color: var(--orange);
}
.manual-modal-backdrop {
  position: absolute;
  inset: 0;
  z-index: 8;
  background: rgba(3, 5, 12, .68);
  display: grid;
  place-items: center;
  padding: 24px;
}
.manual-modal {
  width: min(880px, 100%);
  max-height: calc(100vh - 72px);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg);
  box-shadow: 0 24px 80px rgba(0, 0, 0, .42);
  padding: 18px;
}
.prompt-editor-modal,
.prompt-library-picker-modal,
.image-preview-modal {
  position: absolute;
  inset: 0;
  z-index: 9;
  background: rgba(3, 5, 12, .72);
  display: grid;
  place-items: center;
  padding: 24px;
}
.prompt-editor-panel {
  width: min(720px, 100%);
  max-height: calc(100vh - 72px);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg);
  box-shadow: 0 24px 80px rgba(0, 0, 0, .42);
  padding: 18px;
}
.prompt-library-picker-panel {
  width: min(920px, 100%);
  max-height: calc(100vh - 72px);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg);
  box-shadow: 0 24px 80px rgba(0, 0, 0, .42);
  padding: 18px;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
}
.prompt-library-picker-filters {
  margin-top: 14px;
  display: grid;
  grid-template-columns: minmax(160px, .75fr) minmax(220px, 1.1fr) minmax(130px, .55fr) auto;
  gap: 10px;
  align-items: center;
}
.prompt-library-select,
.prompt-library-search,
.prompt-library-category {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--bg3);
  color: var(--text);
  padding: 9px 10px;
  font-size: 12px;
  outline: none;
}
.prompt-library-select:focus,
.prompt-library-search:focus,
.prompt-library-category:focus {
  border-color: var(--orange);
}
.prompt-library-template-list {
  min-height: 0;
  overflow: auto;
  margin-top: 12px;
  display: grid;
  align-content: start;
  gap: 8px;
}
.prompt-library-template-row {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg2);
  color: var(--text);
  text-align: left;
  padding: 10px 12px;
  cursor: pointer;
}
.prompt-library-template-row:hover {
  border-color: var(--orange);
  background: rgba(255, 106, 41, .07);
}
.prompt-library-template-row span {
  color: var(--orange);
  font-size: 11px;
  font-weight: 800;
}
.prompt-library-template-row strong {
  display: block;
  margin-top: 3px;
  color: var(--text);
  font-size: 13px;
}
.prompt-library-template-row p {
  margin: 6px 0 0;
  max-height: 42px;
  overflow: hidden;
  color: var(--text3);
  font-size: 11px;
  line-height: 1.45;
}
.prompt-library-picker-empty {
  border: 1px dashed var(--border);
  border-radius: 10px;
  color: var(--text3);
  padding: 24px;
  text-align: center;
}
.prompt-library-picker-empty.error {
  color: #fca5a5;
  border-color: rgba(248, 113, 113, .36);
}
.image-preview-panel {
  width: min(920px, 100%);
  max-height: calc(100vh - 72px);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg);
  box-shadow: 0 24px 80px rgba(0, 0, 0, .42);
  padding: 18px;
}
.image-preview-stage {
  margin-top: 14px;
  display: grid;
  place-items: center;
  min-height: 0;
}
.image-preview-stage img {
  max-width: 100%;
  max-height: min(72vh, 720px);
  border-radius: 10px;
  border: 1px solid var(--border);
  object-fit: contain;
  background: rgba(255, 255, 255, .04);
}
.manual-modal-head,
.manual-modal-actions,
.manual-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}
.manual-modal-head {
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}
.manual-modal-head strong,
.manual-modal-head span {
  display: block;
}
.manual-modal-head strong {
  color: var(--text);
  font-size: 16px;
}
.manual-modal-head span {
  margin-top: 5px;
  color: var(--text3);
  font-size: 12px;
}
.manual-image-columns {
  margin-top: 14px;
  display: grid;
  grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr);
  gap: 14px;
}
.manual-image-panel {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg2);
  padding: 12px;
}
.manual-panel-head {
  margin-bottom: 10px;
}
.manual-panel-head strong {
  color: var(--text2);
  font-size: 12px;
}
.manual-panel-head > div {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
.manual-main-preview {
  margin: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg3);
}
.manual-main-preview img {
  width: 100%;
  display: block;
  aspect-ratio: 3 / 4;
  object-fit: cover;
}
.manual-main-preview figcaption {
  padding: 8px 10px;
  color: var(--text3);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.manual-modal-actions {
  justify-content: flex-end;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
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
  .approval-drawer.embedded { height: auto; max-height: none; overflow: visible; }
  .approval-toolbar { flex-direction: column; }
  .approval-body { grid-template-columns: 1fr; overflow: visible; }
  .approval-list { height: auto; max-height: none; }
  .style-head { flex-direction: column; }
  .style-actions { justify-content: flex-start; }
  .confirmation-image-slots { grid-template-columns: 1fr; }
  .manual-image-columns { grid-template-columns: 1fr; }
  .submit-result-row { grid-template-columns: 1fr; }
}
</style>
