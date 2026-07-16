<template>
  <section class="avg-workbench" :class="{ 'avg-compact': isCompact }">
    <header class="avg-page-head">
      <div class="avg-head-copy">
        <p class="avg-kicker">一级菜单入口 · AI 生视频</p>
        <h1>AI 生视频工作台</h1>
        <p class="avg-subtitle">纯 prompt 与参考图驱动的视频生成工作台，复用 Seedance 与 HappyHorse CLI 能力。</p>
      </div>
      <div class="avg-head-actions">
        <button class="avg-btn ghost" type="button" @click="openHistory = true">历史记录</button>
        <button class="avg-btn" type="button" @click="openOutputFolder">打开输出文件夹</button>
      </div>
    </header>

    <nav class="avg-mobile-tabs" aria-label="移动端视图切换">
      <button type="button" :class="{ active: compactPane === 'inputs' }" @click="compactPane = 'inputs'">输入与参数</button>
      <button type="button" :class="{ active: compactPane === 'results' }" @click="compactPane = 'results'">结果与队列</button>
    </nav>

    <div class="avg-main">
      <aside class="avg-control-pane" :class="{ 'mobile-active': compactPane === 'inputs' }">
        <div class="avg-model-switcher avg-model-switcher-2" role="group" aria-label="模型选择">
          <button
            v-for="model in modelOptions"
            :key="model.id"
            type="button"
            class="avg-model-card"
            :class="{ active: form.provider === model.id }"
            :aria-pressed="form.provider === model.id ? 'true' : 'false'"
            @click="selectProvider(model.id)"
          >
            <div class="avg-model-head">
              <strong>{{ model.label }}</strong>
              <img class="avg-provider-mark" :src="model.mark" alt="" />
            </div>
            <span>{{ model.hint }}</span>
          </button>
        </div>

        <div class="avg-control-scroll">
          <section class="avg-section avg-section-prompt">
            <div class="avg-section-head">
              <strong>Prompt</strong>
              <span>{{ modeBadge }}</span>
            </div>
            <div class="avg-section-body avg-section-body-tight">
              <textarea
                v-model="form.prompt"
                class="avg-prompt-input"
                maxlength="4000"
                placeholder="描述画面主体、动作、镜头和风格…"
              ></textarea>
              <div class="avg-error-text">{{ errors.prompt }}</div>
              <p class="avg-hint">{{ promptHint }}</p>
            </div>
          </section>

          <section class="avg-section">
            <div class="avg-section-head">
              <strong>{{ referenceTitle }}</strong>
              <span>{{ referencePolicy }}</span>
            </div>
            <div class="avg-section-body avg-section-body-tight">
              <div class="avg-ref-actions">
                <button class="avg-btn small" type="button" :disabled="form.assets.length >= assetMax" @click="chooseImages">
                  本地上传
                </button>
                <button class="avg-btn small ghost" type="button" :disabled="form.assets.length >= assetMax" @click="openImageLibrary">
                  本地参考图库
                </button>
                <span class="avg-ref-count">已选 {{ form.assets.length }} / {{ assetMax }}</span>
              </div>
              <div v-if="form.assets.length" class="avg-asset-grid">
                <article
                  v-for="(asset, index) in form.assets"
                  :key="`${asset.path}-${index}`"
                  class="avg-asset-card"
                >
                  <img v-if="previewSrc(asset.path)" :src="previewSrc(asset.path)" :alt="pathLabel(asset.path)" />
                  <div class="avg-asset-meta">
                    <strong>{{ pathLabel(asset.path) }}</strong>
                    <span>{{ assetRoleLabel(index) }}</span>
                  </div>
                  <div class="avg-asset-actions">
                    <button
                      v-if="showImageInsert"
                      class="avg-btn small"
                      type="button"
                      title="插入 [Image n]"
                      @click="insertImageRef(index + 1)"
                    >[Image {{ index + 1 }}]</button>
                    <button class="avg-btn small ghost" type="button" @click="removeAsset(index)">移除</button>
                  </div>
                </article>
              </div>
              <div v-else class="avg-drop-zone avg-drop-zone-static">
                JPEG / PNG / WEBP · 单张 ≤ 20MB · 用上方按钮添加
              </div>
              <p class="avg-hint">{{ modeAutoHint }}</p>
              <div class="avg-error-text">{{ errors.assets }}</div>
            </div>
          </section>

          <section class="avg-section">
            <div class="avg-section-head">
              <strong>生成参数</strong>
              <span :title="resolvedModelId">{{ shortModelLabel }}</span>
            </div>
            <div class="avg-section-body avg-section-body-tight">
              <div class="avg-param-stack">
                <div class="avg-param-row">
                  <label class="avg-field">
                    <span>时长</span>
                    <select v-model.number="form.duration">
                      <option v-for="sec in durationOptions" :key="sec" :value="sec">{{ sec }} 秒</option>
                    </select>
                  </label>
                  <label v-if="showRatio" class="avg-field">
                    <span>比例</span>
                    <select v-model="form.ratio">
                      <option v-for="ratio in ratioOptions" :key="ratio" :value="ratio">{{ ratio }}</option>
                    </select>
                  </label>
                  <label v-else class="avg-field">
                    <span>清晰度</span>
                    <select v-model="form.resolution">
                      <option v-for="item in resolutionOptions" :key="item" :value="item">{{ item }}</option>
                    </select>
                  </label>
                </div>

                <div v-if="showRatio" class="avg-param-row">
                  <label class="avg-field">
                    <span>清晰度</span>
                    <select v-model="form.resolution">
                      <option v-for="item in resolutionOptions" :key="item" :value="item">{{ item }}</option>
                    </select>
                  </label>
                  <div v-if="showAudio" class="avg-field">
                    <span>音频</span>
                    <div class="avg-segmented" role="group" aria-label="音频开关">
                      <button type="button" :class="{ active: form.generateAudio }" @click="form.generateAudio = true">开</button>
                      <button type="button" :class="{ active: !form.generateAudio }" @click="form.generateAudio = false">关</button>
                    </div>
                  </div>
                  <div v-else class="avg-field">
                    <span>水印</span>
                    <div class="avg-segmented" role="group" aria-label="水印开关">
                      <button type="button" :class="{ active: !form.watermark }" @click="form.watermark = false">关</button>
                      <button type="button" :class="{ active: form.watermark }" @click="form.watermark = true">开</button>
                    </div>
                  </div>
                </div>

                <div v-if="showAudio" class="avg-param-row">
                  <div class="avg-field">
                    <span>水印</span>
                    <div class="avg-segmented" role="group" aria-label="水印开关">
                      <button type="button" :class="{ active: !form.watermark }" @click="form.watermark = false">关</button>
                      <button type="button" :class="{ active: form.watermark }" @click="form.watermark = true">开</button>
                    </div>
                  </div>
                  <div class="avg-field avg-field-spacer" aria-hidden="true"></div>
                </div>

                <div v-else-if="!showRatio" class="avg-param-row">
                  <div class="avg-field">
                    <span>水印</span>
                    <div class="avg-segmented" role="group" aria-label="水印开关">
                      <button type="button" :class="{ active: !form.watermark }" @click="form.watermark = false">关</button>
                      <button type="button" :class="{ active: form.watermark }" @click="form.watermark = true">开</button>
                    </div>
                  </div>
                  <div class="avg-field avg-field-spacer" aria-hidden="true"></div>
                </div>
              </div>
              <p class="avg-hint">{{ paramHint }}</p>
              <div class="avg-error-text">{{ errors.parameters }}</div>
            </div>
          </section>

          <section class="avg-section">
            <div class="avg-section-head">
              <strong>输出目录</strong>
              <button class="avg-btn small ghost" type="button" @click="chooseOutputDir">选择</button>
            </div>
            <div class="avg-section-body">
              <button
                class="avg-path-btn"
                type="button"
                :title="form.outputDir || defaultOutputDir"
                @click="chooseOutputDir"
              >
                <strong>{{ form.outputDir ? pathLabel(form.outputDir) : '选择输出文件夹' }}</strong>
                <span>{{ shortDirLabel(form.outputDir || defaultOutputDir) }}</span>
              </button>
              <div class="avg-error-text">{{ errors.outputDir }}</div>
            </div>
          </section>

          <p v-if="configHint" class="avg-config-hint">{{ configHint }}</p>
        </div>

        <footer class="avg-control-footer">
          <div class="avg-payload-note" :title="payloadNote">{{ payloadNote }}</div>
          <div class="avg-cost-card" aria-live="polite">
            <div class="avg-cost-main">
              <span>预估花费</span>
              <strong>{{ formatCny(costEstimate.total) }}</strong>
            </div>
            <p class="avg-cost-formula">{{ costEstimate.formula }} · {{ modeBadge }}</p>
            <p class="avg-cost-disclaimer">{{ costEstimate.disclaimer }}</p>
          </div>
          <div class="avg-submit-line">
            <button class="avg-btn ghost" type="button" @click="resetForm">重置</button>
            <button class="avg-btn primary" type="button" :disabled="submitting" @click="submitJob">
              {{ submitting ? '提交中…' : '生成视频' }}
            </button>
          </div>
          <div v-if="formError" class="avg-error-text">{{ formError }}</div>
        </footer>
      </aside>

      <section class="avg-result-pane" :class="{ 'mobile-active': compactPane === 'results' }">
        <div class="avg-result-toolbar">
          <div class="avg-summary-strip">
            <span class="avg-pill orange">{{ activeModelLabel }}</span>
            <span class="avg-pill">任务 {{ jobs.length }}</span>
            <span class="avg-pill yellow">生成中 {{ countByStatus('running') }}</span>
            <span class="avg-pill green">完成 {{ countByStatus('completed') }}</span>
            <span class="avg-pill red">失败 {{ countByStatus('failed') }}</span>
          </div>
          <div class="avg-filter-tabs" role="tablist" aria-label="任务状态筛选">
            <button
              v-for="item in statusFilters"
              :key="item.value"
              type="button"
              :class="{ active: statusFilter === item.value }"
              @click="statusFilter = item.value"
            >
              {{ item.label }}
            </button>
            <button type="button" @click="openHistory = true">历史</button>
          </div>
        </div>

        <div class="avg-result-body">
          <div class="avg-result-grid-head">
            <strong>视频任务</strong>
            <span>所有任务同级平铺 · 点击任意卡片查看详情</span>
          </div>

          <div v-if="!filteredJobs.length" class="avg-empty visible">
            当前筛选下没有任务。切换状态筛选，或在左侧填写 Prompt 后点击「生成视频」。
          </div>

          <section v-else class="avg-task-grid">
            <article
              v-for="job in filteredJobs"
              :key="job.id"
              class="avg-task-card"
            >
              <button
                class="avg-card-open-surface"
                type="button"
                :aria-label="`查看任务详情：${job.title || job.id}`"
                @click="openDetail(job, $event)"
              ></button>
              <div class="avg-thumb">
                <img
                  v-if="jobCoverSrc(job)"
                  :src="jobCoverSrc(job)"
                  class="avg-thumb-media"
                  :alt="job.title || '视频封面'"
                  @error="markCoverBroken(job)"
                />
                <video
                  v-else-if="jobLocalVideo(job)"
                  :src="videoCoverSrc(jobLocalVideo(job))"
                  muted
                  playsinline
                  preload="auto"
                  class="avg-thumb-media"
                  @loadeddata="seekThumbFrame"
                  @loadedmetadata="seekThumbFrame"
                ></video>
                <div
                  v-else-if="isActiveStatus(job.status)"
                  class="avg-thumb-loading"
                  aria-live="polite"
                >
                  <div class="avg-spinner" aria-hidden="true"></div>
                  <strong>{{ job.displayStatus || statusLabel(job.status) }}</strong>
                  <span>已等待 {{ formatWait(job.waitedSeconds) }} · 不显示虚构进度</span>
                </div>
                <div v-else class="avg-thumb-fallback">
                  <strong>{{ job.displayStatus || statusLabel(job.status) }}</strong>
                  <span>{{ stageNote(job) }}</span>
                </div>
                <span class="avg-status-chip" :class="job.status">{{ job.displayStatus || statusLabel(job.status) }}</span>
                <span class="avg-stage-note">{{ stageNote(job) }}</span>
              </div>
              <div class="avg-task-body">
                <div class="avg-task-title">
                  <strong>{{ job.title || job.prompt }}</strong>
                  <span>{{ modelLabel(job.model) }}</span>
                </div>
                <p>{{ job.prompt }}</p>
                <div class="avg-task-actions">
                  <button class="avg-btn small avg-details-task" type="button" @click.stop="openDetail(job, $event)">查看详情</button>
                  <button class="avg-btn small" type="button" @click.stop="reuseParams(job)">复用参数</button>
                  <button
                    v-if="canRetry(job)"
                    class="avg-btn small"
                    type="button"
                    @click.stop="retryJob(job)"
                  >重试</button>
                  <button
                    v-if="canRetryArchive(job)"
                    class="avg-btn small"
                    type="button"
                    @click.stop="retryArchive(job)"
                  >重新归档</button>
                  <button
                    v-if="jobLocalVideo(job)"
                    class="avg-btn small"
                    type="button"
                    @click.stop="openLocalFile(jobLocalVideo(job))"
                  >打开文件</button>
                  <button
                    v-if="canDelete(job)"
                    class="avg-btn small ghost"
                    type="button"
                    @click.stop="deleteJob(job)"
                  >删除</button>
                </div>
              </div>
            </article>
          </section>
        </div>
      </section>
    </div>

    <!-- 本地参考图库 -->
    <div v-if="libraryOpen" class="avg-overlay open" @click.self="closeImageLibrary">
      <div class="avg-library-modal" role="dialog" aria-modal="true" aria-label="本地参考图库">
        <div class="avg-modal-head">
          <div>
            <strong>本地参考图库</strong>
            <span class="avg-library-sub">{{ libraryRoot ? shortDirLabel(libraryRoot) : '请先选择图库文件夹' }}</span>
          </div>
          <button class="avg-btn icon" type="button" aria-label="关闭" @click="closeImageLibrary">×</button>
        </div>
        <div class="avg-library-toolbar">
          <button class="avg-btn small" type="button" @click="chooseLibraryRoot">选择/更换文件夹</button>
          <input
            v-model="libraryQuery"
            class="avg-library-search"
            type="search"
            placeholder="搜索文件名"
          />
          <span>已选 {{ librarySelected.length }} · 还可加 {{ Math.max(0, assetMax - form.assets.length) }}</span>
        </div>
        <div v-if="libraryError" class="avg-error-text avg-library-pad">{{ libraryError }}</div>
        <div v-else-if="libraryLoading" class="avg-library-state">正在扫描图库…</div>
        <div v-else class="avg-library-grid">
          <button
            v-for="item in filteredLibraryItems"
            :key="item.path"
            type="button"
            class="avg-library-tile"
            :class="{ selected: librarySelected.includes(item.path) }"
            @click="toggleLibraryItem(item.path)"
          >
            <img :src="previewSrc(item.path)" :alt="item.name" loading="lazy" />
            <span class="avg-library-check">{{ librarySelected.includes(item.path) ? '已选' : '选择' }}</span>
            <strong>{{ item.name }}</strong>
          </button>
          <div v-if="!filteredLibraryItems.length" class="avg-library-state">
            {{ libraryRoot ? '没有匹配的图片' : '请选择本地参考图库文件夹' }}
          </div>
        </div>
        <div class="avg-library-foot">
          <button class="avg-btn ghost" type="button" @click="librarySelected = []">清空选择</button>
          <button class="avg-btn primary" type="button" :disabled="!librarySelected.length" @click="confirmLibrarySelection">
            确认添加
          </button>
        </div>
      </div>
    </div>

    <div v-if="openHistory" class="avg-drawer-mask" @click="closeHistory"></div>
    <aside class="avg-drawer" :class="{ open: openHistory }" aria-label="历史记录" :aria-hidden="openHistory ? 'false' : 'true'">
      <div class="avg-drawer-head">
        <div>
          <strong>历史记录</strong>
          <span>最近生成与失败任务，支持复用参数</span>
        </div>
        <button class="avg-btn icon" type="button" aria-label="关闭历史记录" @click="closeHistory">×</button>
      </div>
      <div class="avg-history-list">
        <div v-for="job in jobs" :key="`hist-${job.id}`" class="avg-history-item">
          <button
            class="avg-history-open-surface"
            type="button"
            :aria-label="`查看历史任务详情：${job.title || job.id}`"
            @click="openHistoryItem(job)"
          ></button>
          <strong>{{ job.title || job.prompt }}</strong>
          <span>{{ job.id }} · {{ modelLabel(job.model) }} · {{ job.displayStatus || statusLabel(job.status) }}</span>
          <div class="avg-task-actions">
            <button class="avg-btn small" type="button" @click="openHistoryItem(job)">查看详情</button>
            <button class="avg-btn small" type="button" @click="reuseParams(job); closeHistory()">复用参数</button>
          </div>
        </div>
      </div>
    </aside>

    <div
      v-if="detailJob"
      class="avg-overlay open"
      @click.self="closeDetail"
    >
      <div
        class="avg-modal"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="'avg-modal-title'"
        ref="modalRef"
      >
        <div class="avg-modal-head">
          <strong id="avg-modal-title">{{ detailJob.title || '任务' }} · 任务详情</strong>
          <button class="avg-btn icon" type="button" aria-label="关闭任务详情" ref="closeDetailBtn" @click="closeDetail">×</button>
        </div>
        <div class="avg-modal-body">
          <div class="avg-modal-preview">
            <template v-if="jobLocalVideo(detailJob)">
              <div v-if="detailVideoLoading" class="avg-thumb-loading avg-modal-loading">
                <div class="avg-spinner" aria-hidden="true"></div>
                <strong>正在加载视频</strong>
                <span>本地成片准备中…</span>
              </div>
              <div v-else-if="detailVideoError" class="avg-thumb-fallback avg-modal-loading">
                <strong>视频暂不可预览</strong>
                <span>{{ detailVideoError }}</span>
                <button class="avg-btn small" type="button" @click="openLocalFile(jobLocalVideo(detailJob))">打开本地文件</button>
              </div>
              <video
                v-else-if="detailVideoSrc"
                :src="detailVideoSrc"
                controls
                playsinline
                preload="auto"
                :poster="jobCoverSrc(detailJob) || undefined"
              ></video>
            </template>
            <template v-else-if="isActiveStatus(detailJob.status)">
              <div class="avg-thumb-loading avg-modal-loading">
                <div class="avg-spinner" aria-hidden="true"></div>
                <strong>{{ detailJob.displayStatus || statusLabel(detailJob.status) }}</strong>
                <span>已等待 {{ formatWait(detailJob.waitedSeconds) }} · {{ stageNote(detailJob) }}</span>
              </div>
            </template>
            <template v-else>
              <div class="avg-modal-preview-pending"></div>
              <div class="avg-modal-state-overlay">
                <strong>{{ detailJob.displayStatus || statusLabel(detailJob.status) }}</strong>
                <span>{{ stageNote(detailJob) }}</span>
              </div>
            </template>
          </div>
          <aside class="avg-modal-side">
            <div class="avg-modal-title-line">
              <h3>{{ detailJob.title || detailJob.prompt }}</h3>
              <span class="avg-detail-status" :class="detailJob.status">{{ detailJob.displayStatus || statusLabel(detailJob.status) }}</span>
            </div>
            <div class="avg-detail-meta">
              <div class="avg-kv"><span>任务 ID</span><strong>{{ detailJob.id }}</strong></div>
              <div class="avg-kv"><span>模型</span><strong>{{ modelLabel(detailJob.model) }}</strong></div>
              <div class="avg-kv"><span>创建时间</span><strong>{{ formatTime(detailJob.createdAt) }}</strong></div>
              <div class="avg-kv"><span>任务阶段</span><strong>{{ stageNote(detailJob) }}</strong></div>
            </div>
            <div class="avg-detail-section">
              <span>完整 Prompt</span>
              <p>{{ detailJob.prompt }}</p>
            </div>
            <div class="avg-detail-section">
              <span>生成参数</span>
              <p>{{ paramSummary(detailJob) }}</p>
            </div>
            <div class="avg-detail-section">
              <span>本地归档</span>
              <p>{{ archiveDisplay(detailJob) }}</p>
            </div>
            <div v-if="detailJob.currentRun?.error?.message" class="avg-detail-section">
              <span>错误摘要</span>
              <p>{{ detailJob.currentRun.error.message }}</p>
              <p v-if="detailJob.currentRun.error.safeSuggestion">{{ detailJob.currentRun.error.safeSuggestion }}</p>
            </div>
            <div class="avg-detail-actions">
              <button class="avg-btn primary" type="button" @click="reuseParams(detailJob); closeDetail()">复用参数</button>
              <button v-if="canRetry(detailJob)" class="avg-btn" type="button" @click="retryJob(detailJob)">重试</button>
              <button v-if="canRetryArchive(detailJob)" class="avg-btn" type="button" @click="retryArchive(detailJob)">重新归档</button>
              <button
                class="avg-btn"
                type="button"
                :disabled="!jobLocalVideo(detailJob)"
                @click="openLocalFile(jobLocalVideo(detailJob))"
              >{{ jobLocalVideo(detailJob) ? '打开本地文件' : '尚无本地文件' }}</button>
              <button v-if="canDelete(detailJob)" class="avg-btn ghost" type="button" @click="deleteJob(detailJob)">删除记录</button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import volcengineMark from '../assets/ai-video-generation/volcengine-mark.png'
import aliyunMark from '../assets/ai-video-generation/aliyun-mark.png'
import {
  estimateVideoCost,
  formatCny,
  happyHorseModeLabel,
  happyHorseModelId,
  resolveHappyHorseMode,
} from '../utils/aiVideoPricing.mjs'

const emit = defineEmits(['open-settings'])

const SEEDANCE_MODEL = 'doubao-seedance-2-0-260128'

const modelOptions = [
  {
    id: 'seedance',
    label: 'Seedance 2.0',
    hint: '统一入口：Prompt + 可选 0-4 张参考图。',
    mark: volcengineMark,
  },
  {
    id: 'happyhorse',
    label: 'HappyHorse 1.1',
    hint: '按是否传图与数量自动切换：文生 / 图生 / 参考生。',
    mark: aliyunMark,
  },
]

const statusFilters = [
  { value: 'all', label: '全部' },
  { value: 'queued', label: '排队' },
  { value: 'running', label: '生成中' },
  { value: 'downloading', label: '下载归档' },
  { value: 'completed', label: '已完成' },
  { value: 'needs_config', label: '待配置' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
  { value: 'expired', label: '已过期' },
]

const SEEDANCE_RATIOS = ['16:9', '9:16', '1:1', '3:4', '4:3', '21:9', 'adaptive']
const HAPPYHORSE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '5:4', '9:21', '21:9']

const form = reactive({
  provider: 'seedance',
  prompt: '',
  assets: [],
  ratio: '9:16',
  resolution: '720p',
  duration: 5,
  generateAudio: true,
  watermark: false,
  outputDir: '',
})

const jobs = ref([])
const statusFilter = ref('all')
const compactPane = ref('inputs')
const isCompact = ref(false)
const submitting = ref(false)
const formError = ref('')
const errors = reactive({ prompt: '', assets: '', parameters: '', outputDir: '' })
const config = ref(null)
const openHistory = ref(false)
const detailJob = ref(null)
const detailTriggerEl = ref(null)
const modalRef = ref(null)
const closeDetailBtn = ref(null)
const pollTimer = ref(null)
const defaultOutputDir = ref('~/Downloads/抓虾AI生视频')
const brokenCovers = reactive({})
const mediaUrlCache = reactive({})
const detailVideoSrc = ref('')
const detailVideoLoading = ref(false)
const detailVideoError = ref('')
const libraryOpen = ref(false)
const libraryRoot = ref('')
const libraryItems = ref([])
const librarySelected = ref([])
const libraryQuery = ref('')
const libraryLoading = ref(false)
const libraryError = ref('')
const LIBRARY_ROOT_KEY = 'crawshrimp.ai-video.reference-library-root'

const activeMeta = computed(() => modelOptions.find(item => item.id === form.provider) || modelOptions[0])
const activeModelLabel = computed(() => activeMeta.value.label)

/** HappyHorse 模式由图片数量自动判定：0=t2v, 1=i2v, 2-9=r2v */
const happyHorseMode = computed(() => resolveHappyHorseMode(form.assets.length))
const resolvedModelId = computed(() => {
  if (form.provider === 'seedance') return SEEDANCE_MODEL
  return happyHorseModelId(happyHorseMode.value)
})
const modeBadge = computed(() => {
  if (form.provider === 'seedance') {
    return form.assets.length ? `参考图生视频 · ${form.assets.length} 张` : '文生 / 可加参考图'
  }
  return happyHorseModeLabel(happyHorseMode.value)
})
const shortModelLabel = computed(() => {
  if (form.provider === 'seedance') return 'Seedance 2.0'
  return `HH · ${happyHorseModeLabel(happyHorseMode.value)}`
})
const assetMax = computed(() => (form.provider === 'seedance' ? 4 : 9))
const showRatio = computed(() => !(form.provider === 'happyhorse' && happyHorseMode.value === 'i2v'))
const showAudio = computed(() => form.provider === 'seedance')
const showImageInsert = computed(() => form.provider === 'happyhorse' && happyHorseMode.value === 'r2v')
const durationMin = computed(() => (form.provider === 'seedance' ? 4 : 3))
const durationOptions = computed(() => {
  const options = []
  for (let i = durationMin.value; i <= 15; i += 1) options.push(i)
  return options
})
const ratioOptions = computed(() => (form.provider === 'seedance' ? SEEDANCE_RATIOS : HAPPYHORSE_RATIOS))
const resolutionOptions = computed(() => (form.provider === 'seedance' ? ['480p', '720p', '1080p'] : ['720P', '1080P']))
const referenceTitle = computed(() => {
  if (form.provider === 'happyhorse' && happyHorseMode.value === 'i2v') return '首帧图'
  return '参考图'
})
const referencePolicy = computed(() => {
  if (form.provider === 'seedance') return '可选 0-4 张'
  if (happyHorseMode.value === 't2v') return '0 张 → 文生；加图将切换模式'
  if (happyHorseMode.value === 'i2v') return '1 张 → 图生视频（首帧）'
  return '2-9 张 → 参考生视频'
})
const modeAutoHint = computed(() => {
  if (form.provider === 'seedance') return 'Seedance：0 张纯文生，1-4 张作为 reference_image。'
  if (happyHorseMode.value === 't2v') return '当前 0 张图 → 自动调用文生视频（t2v）。'
  if (happyHorseMode.value === 'i2v') return '当前 1 张图 → 自动调用图生视频（i2v），比例隐藏。'
  return '当前 ≥2 张图 → 自动调用参考生视频（r2v），建议 Prompt 使用 [Image n]。'
})
const promptHint = computed(() => {
  if (form.provider === 'happyhorse' && happyHorseMode.value === 'r2v') {
    if (/\[Image\s*\d+\]/i.test(form.prompt)) return '已检测到 Image 引用。'
    return '参考生视频可点击图片旁插入 [Image n] 写入 Prompt。'
  }
  return 'Prompt 必填。HappyHorse 会按图片数量自动选择文生 / 图生 / 参考生。'
})
const paramHint = computed(() => {
  if (form.provider === 'seedance') return 'Seedance 默认 720p / 5 秒 / 9:16 / 音频开 / 水印关。'
  if (happyHorseMode.value === 'i2v') return '图生视频隐藏比例，输出画幅跟随首帧。'
  if (happyHorseMode.value === 't2v') return '文生视频默认 720P / 5 秒 / 16:9 / 水印关。'
  return '参考生视频默认 720P / 5 秒 / 9:16 / 水印关。'
})
const costEstimate = computed(() => estimateVideoCost({
  provider: form.provider,
  resolution: form.resolution,
  duration: form.duration,
}))
const payloadNote = computed(() => {
  const audio = showAudio.value ? ` / 音频${form.generateAudio ? '开' : '关'}` : ''
  const ratio = showRatio.value ? ` / ${form.ratio}` : ' / 比例随首帧'
  return `将调用 ${resolvedModelId.value} · ${modeBadge.value} · ${form.assets.length} 张图 · ${form.resolution}/${form.duration}s${ratio}${audio} / 水印${form.watermark ? '开' : '关'}`
})
const configHint = computed(() => {
  const providers = config.value?.providers || {}
  const item = providers[form.provider]
  if (!item) return ''
  if (!item.configured) return `当前 ${form.provider === 'seedance' ? 'Seedance' : 'HappyHorse'} 凭据未配置，请到设置 → AI 能力配置`
  if (item.cliReady === false) return '共享 CLI 能力未就绪'
  return ''
})
const filteredJobs = computed(() => {
  if (statusFilter.value === 'all') return jobs.value
  return jobs.value.filter(job => {
    if (statusFilter.value === 'failed' && job.displayStatus === '待归档') return true
    return job.status === statusFilter.value
  })
})
const filteredLibraryItems = computed(() => {
  const query = String(libraryQuery.value || '').trim().toLowerCase()
  const items = libraryItems.value || []
  if (!query) return items
  return items.filter(item => String(item.name || item.path || '').toLowerCase().includes(query))
})

function countByStatus(status) {
  return jobs.value.filter(job => job.status === status).length
}

function selectProvider(provider) {
  form.provider = provider === 'happyhorse' ? 'happyhorse' : 'seedance'
  applyProviderDefaults()
}

function applyProviderDefaults() {
  if (form.provider === 'seedance') {
    form.ratio = '9:16'
    form.resolution = '720p'
    form.duration = 5
    form.generateAudio = true
    form.watermark = false
    if (form.assets.length > 4) form.assets = form.assets.slice(0, 4)
    return
  }
  form.resolution = '720P'
  form.duration = 5
  form.watermark = false
  form.generateAudio = false
  if (form.assets.length > 9) form.assets = form.assets.slice(0, 9)
  syncHappyHorseRatioDefault()
}

function syncHappyHorseRatioDefault() {
  if (form.provider !== 'happyhorse') return
  const mode = resolveHappyHorseMode(form.assets.length)
  if (mode === 'i2v') {
    form.ratio = ''
    return
  }
  if (mode === 't2v') {
    if (!form.ratio || form.ratio === '') form.ratio = '16:9'
    return
  }
  if (!form.ratio || form.ratio === '') form.ratio = '9:16'
}

function assetRoleLabel(index) {
  if (form.provider === 'happyhorse' && happyHorseMode.value === 'i2v') return '首帧'
  return `参考图 ${index + 1}`
}

function resetForm() {
  form.prompt = ''
  form.assets = []
  applyProviderDefaults()
  formError.value = ''
  errors.prompt = ''
  errors.assets = ''
  errors.parameters = ''
  errors.outputDir = ''
}

function pathLabel(path) {
  const value = String(path || '')
  const parts = value.split(/[/\\]/)
  return parts[parts.length - 1] || value
}

function shortDirLabel(path) {
  const value = String(path || '').trim()
  if (!value) return ''
  const normalized = value.replace(/\\/g, '/')
  if (normalized.includes('/Downloads/')) {
    const idx = normalized.indexOf('/Downloads/')
    return `~${normalized.slice(idx)}`
  }
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 3) return value
  return `…/${parts.slice(-3).join('/')}`
}

function localFileUrl(path) {
  const value = String(path || '').trim()
  if (!value) return ''
  if (value.startsWith('file://') || value.startsWith('data:')) return value
  const normalized = value.replace(/\\/g, '/')
  const encoded = normalized.split('/').map(part => encodeURIComponent(part)).join('/')
  return encoded.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`
}

/** Force first-frame cover in Electron where metadata-only preload often stays black. */
function videoCoverSrc(path) {
  const base = localFileUrl(path)
  if (!base || base.includes('#')) return base
  return `${base}#t=0.1`
}

function seekThumbFrame(event) {
  const video = event?.target
  if (!video || typeof video.currentTime !== 'number') return
  try {
    if (video.currentTime < 0.05) video.currentTime = 0.1
    video.pause?.()
  } catch {
    // Some local files reject seeking; #t=0.1 is still the best-effort fallback.
  }
}

function previewSrc(path) {
  return localFileUrl(path)
}

function modelLabel(model) {
  const value = String(model || '')
  if (value.includes('seedance') || value === SEEDANCE_MODEL) return 'Seedance 2.0'
  if (value.includes('happyhorse') || value === 'happyhorse') {
    if (value.includes('i2v')) return 'HappyHorse 1.1 · 图生'
    if (value.includes('r2v')) return 'HappyHorse 1.1 · 参考生'
    if (value.includes('t2v')) return 'HappyHorse 1.1 · 文生'
    return 'HappyHorse 1.1'
  }
  return value || '-'
}

function statusLabel(status) {
  return ({
    draft: '草稿',
    queued: '排队',
    running: '生成中',
    downloading: '下载归档',
    completed: '已完成',
    needs_config: '待配置',
    failed: '失败',
    cancelled: '已取消',
    expired: '已过期',
  })[status] || status || '未知'
}

function isActiveStatus(status) {
  return ['queued', 'running', 'downloading'].includes(String(status || ''))
}

function formatWait(seconds) {
  const value = Number(seconds || 0)
  if (!Number.isFinite(value) || value < 0) return '00:00'
  const mins = Math.floor(value / 60)
  const secs = Math.floor(value % 60)
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function formatTime(value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  try {
    const date = new Date(raw)
    if (Number.isNaN(date.getTime())) return raw
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  } catch {
    return raw
  }
}

function stageNote(job) {
  const status = String(job?.status || '')
  if (status === 'completed') return '本地 MP4 已归档'
  if (status === 'downloading') return 'provider 已完成 · 正在本地归档'
  if (status === 'running') {
    const waited = formatWait(job.waitedSeconds)
    return `provider 生成中 · 已等待 ${waited} · 未返回进度`
  }
  if (status === 'queued') return '等待后台 worker 提交'
  if (status === 'needs_config') return '等待配置凭据后继续'
  if (status === 'failed' && job?.displayStatus === '待归档') return 'provider 已成功 · 本地待归档'
  if (status === 'failed') return job?.currentRun?.error?.message || '真实错误摘要已保留'
  if (status === 'cancelled') return '任务已取消'
  if (status === 'expired') return '查询有效期已过'
  return job?.displayStatus || statusLabel(status)
}

function paramSummary(job) {
  const params = job?.parameters || {}
  const parts = []
  if (params.resolution) parts.push(params.resolution)
  if (params.duration) parts.push(`${params.duration} 秒`)
  if (params.ratio) parts.push(params.ratio)
  else if (job?.model?.includes('i2v')) parts.push('比例随参考图')
  if (params.generateAudio != null && job.provider === 'seedance') parts.push(`音频${params.generateAudio ? '开' : '关'}`)
  parts.push(`水印${params.watermark ? '开' : '关'}`)
  return parts.join(' · ')
}

function archiveDisplay(job) {
  const output = job?.currentRun?.output || {}
  if (output.fileName) return output.fileName
  if (output.localVideoPath) return pathLabel(output.localVideoPath)
  if (job?.status === 'completed') return '本地 MP4 已归档'
  if (job?.displayStatus === '待归档') return '待重新归档'
  return '等待 provider 完成'
}

function jobLocalVideo(job) {
  return String(job?.currentRun?.output?.localVideoPath || '').trim()
}

function jobPosterPath(job) {
  return String(job?.currentRun?.output?.localPosterPath || '').trim()
}

function jobCoverSrc(job) {
  const id = job?.id || ''
  if (id && brokenCovers[id]) return ''
  const poster = jobPosterPath(job)
  if (poster) return localFileUrl(poster)
  // Fallback: first input reference image while poster is missing.
  const assets = job?.assets || job?.currentRun?.inputSnapshot?.assets || []
  const first = assets.find(item => item?.localPath)
  if (first?.localPath) return localFileUrl(first.localPath)
  return ''
}

function markCoverBroken(job) {
  const id = job?.id
  if (id) brokenCovers[id] = true
}

async function resolvePlayableMediaUrl(filePath) {
  const key = String(filePath || '').trim()
  if (!key) return ''
  if (mediaUrlCache[key]) return mediaUrlCache[key]
  if (typeof window?.cs?.getLocalMediaUrl !== 'function') {
    // Browser/dev fallback only.
    return localFileUrl(key)
  }
  const response = await window.cs.getLocalMediaUrl(key)
  const mediaUrl = String(response?.media_url || response?.mediaUrl || '').trim()
  if (!mediaUrl) throw new Error(response?.error || '本地视频预览不可用')
  mediaUrlCache[key] = mediaUrl
  return mediaUrl
}

async function loadDetailVideo(job) {
  detailVideoSrc.value = ''
  detailVideoError.value = ''
  detailVideoLoading.value = false
  const videoPath = jobLocalVideo(job)
  if (!videoPath) return
  detailVideoLoading.value = true
  try {
    // Authorize output dir parent so sibling files are streamable.
    if (job?.outputDir && typeof window?.cs?.authorizeLocalMediaRoot === 'function') {
      try { await window.cs.authorizeLocalMediaRoot(job.outputDir) } catch { /* ignore */ }
    }
    detailVideoSrc.value = await resolvePlayableMediaUrl(videoPath)
  } catch (error) {
    detailVideoError.value = error?.message || String(error)
  } finally {
    detailVideoLoading.value = false
  }
}

function canRetry(job) {
  return ['failed', 'needs_config', 'expired'].includes(String(job?.status || ''))
}

function canRetryArchive(job) {
  return job?.displayStatus === '待归档' || job?.currentRun?.archiveStatus === 'archive_failed'
}

function canDelete(job) {
  if (isActiveStatus(job?.status)) return false
  return ['draft', 'needs_config', 'failed', 'expired', 'completed', 'cancelled'].includes(String(job?.status || ''))
}

function buildParameters() {
  const params = {
    resolution: form.resolution,
    duration: Number(form.duration || 5),
    watermark: Boolean(form.watermark),
  }
  if (showRatio.value) params.ratio = form.ratio
  if (showAudio.value) params.generateAudio = Boolean(form.generateAudio)
  return params
}

function buildAssetsPayload() {
  const role = form.provider === 'happyhorse' && happyHorseMode.value === 'i2v'
    ? 'first_frame'
    : 'reference_image'
  return form.assets.map((asset, index) => ({
    role,
    sourceType: 'local_file',
    localPath: asset.path,
    fileToken: asset.path,
    sortOrder: index,
  }))
}

function validateLocal() {
  errors.prompt = ''
  errors.assets = ''
  errors.parameters = ''
  errors.outputDir = ''
  formError.value = ''
  const prompt = String(form.prompt || '').trim()
  if (!prompt) errors.prompt = 'Prompt 必填。'
  if (prompt.length > 4000) errors.prompt = 'Prompt 不能超过 4000 字符'
  if (form.provider === 'seedance' && form.assets.length > 4) {
    errors.assets = 'Seedance 最多支持 4 张参考图。'
  }
  if (form.provider === 'happyhorse' && form.assets.length > 9) {
    errors.assets = 'HappyHorse 参考生最多 9 张图。'
  }
  const duration = Number(form.duration)
  if (!Number.isInteger(duration)) errors.parameters = '时长必须是整数'
  else if (form.provider === 'seedance' && (duration < 4 || duration > 15)) errors.parameters = 'Seedance 时长需 4-15 秒'
  else if (form.provider === 'happyhorse' && (duration < 3 || duration > 15)) errors.parameters = 'HappyHorse 时长需 3-15 秒'
  if (!String(form.outputDir || '').trim()) errors.outputDir = '请选择输出目录'
  return !errors.prompt && !errors.assets && !errors.parameters && !errors.outputDir
}

function insertImageRef(index) {
  const token = `[Image ${index}]`
  const current = String(form.prompt || '')
  form.prompt = current ? `${current.trim()} ${token}` : token
}

function addAssetPaths(paths) {
  const remain = Math.max(0, assetMax.value - form.assets.length)
  const list = (Array.isArray(paths) ? paths : [paths])
    .map(item => String(item || '').trim())
    .filter(Boolean)
  let added = 0
  for (const path of list) {
    if (added >= remain) break
    if (form.assets.some(item => item.path === path)) continue
    form.assets.push({ path, role: 'reference_image' })
    added += 1
  }
  syncHappyHorseRatioDefault()
  return added
}

async function chooseImages() {
  if (typeof window?.cs?.browseFile !== 'function') {
    formError.value = '当前环境不支持系统文件选择器'
    return
  }
  const remain = Math.max(0, assetMax.value - form.assets.length)
  if (!remain) {
    formError.value = `最多添加 ${assetMax.value} 张图`
    return
  }
  const selected = await window.cs.browseFile({
    title: '本地上传参考图',
    images: true,
    multi: true,
  })
  addAssetPaths(selected)
}

async function openImageLibrary() {
  libraryOpen.value = true
  libraryError.value = ''
  librarySelected.value = []
  libraryQuery.value = ''
  if (!libraryRoot.value) {
    try {
      libraryRoot.value = window.localStorage?.getItem(LIBRARY_ROOT_KEY) || ''
    } catch {
      libraryRoot.value = ''
    }
  }
  if (libraryRoot.value) await scanLibrary(libraryRoot.value)
}

function closeImageLibrary() {
  libraryOpen.value = false
  libraryError.value = ''
}

async function chooseLibraryRoot() {
  if (typeof window?.cs?.browseFile !== 'function') {
    libraryError.value = '当前环境不支持系统文件夹选择器'
    return
  }
  const directory = await window.cs.browseFile({
    title: '选择本地参考图库文件夹',
    directory: true,
    defaultPath: libraryRoot.value || undefined,
  })
  if (!directory) return
  libraryRoot.value = directory
  try {
    window.localStorage?.setItem(LIBRARY_ROOT_KEY, directory)
  } catch { /* ignore */ }
  await scanLibrary(directory)
}

async function scanLibrary(rootPath) {
  libraryLoading.value = true
  libraryError.value = ''
  libraryItems.value = []
  try {
    if (typeof window?.cs?.listDirectoryFiles !== 'function') {
      throw new Error('当前环境不支持扫描本地目录')
    }
    const result = await window.cs.listDirectoryFiles(rootPath, {
      extensions: ['jpg', 'jpeg', 'png', 'webp'],
      maxFiles: 500,
    })
    if (result?.ok === false) throw new Error(result?.error || '扫描失败')
    const paths = Array.isArray(result?.paths) ? result.paths : []
    libraryItems.value = paths.map(entry => {
      const path = String(entry?.path || entry || '').trim()
      return {
        path,
        name: pathLabel(path),
        relativePath: entry?.relativePath || '',
      }
    }).filter(item => item.path)
  } catch (error) {
    libraryError.value = error?.message || String(error)
  } finally {
    libraryLoading.value = false
  }
}

function toggleLibraryItem(path) {
  const value = String(path || '').trim()
  if (!value) return
  const index = librarySelected.value.indexOf(value)
  if (index >= 0) {
    librarySelected.value.splice(index, 1)
    return
  }
  const remain = Math.max(0, assetMax.value - form.assets.length - librarySelected.value.length)
  if (!remain) {
    libraryError.value = `本次最多再选 ${Math.max(0, assetMax.value - form.assets.length)} 张`
    return
  }
  if (form.assets.some(item => item.path === value)) {
    libraryError.value = '该图片已在当前任务中'
    return
  }
  librarySelected.value.push(value)
  libraryError.value = ''
}

function confirmLibrarySelection() {
  addAssetPaths(librarySelected.value)
  closeImageLibrary()
}

function removeAsset(index) {
  form.assets.splice(index, 1)
  syncHappyHorseRatioDefault()
}

async function chooseOutputDir() {
  if (typeof window?.cs?.browseFile !== 'function') {
    formError.value = '当前环境不支持系统文件夹选择器'
    return
  }
  const directory = await window.cs.browseFile({
    title: '选择 AI 生视频输出目录',
    directory: true,
    defaultPath: form.outputDir || undefined,
  })
  if (directory) {
    form.outputDir = directory
    if (typeof window?.cs?.authorizeLocalMediaRoot === 'function') {
      try { await window.cs.authorizeLocalMediaRoot(directory) } catch { /* ignore */ }
    }
  }
}

async function openOutputFolder() {
  const target = form.outputDir || defaultOutputDir.value
  if (typeof window?.cs?.openFile === 'function' && target) {
    try {
      await window.cs.openFile(target)
      return
    } catch {
      // fall through
    }
  }
  await chooseOutputDir()
}

function requestUid() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

async function submitJob() {
  if (submitting.value) return
  if (!validateLocal()) {
    formError.value = '请先修正表单错误'
    return
  }
  submitting.value = true
  formError.value = ''
  try {
    const payload = {
      requestUid: requestUid(),
      provider: form.provider,
      model: resolvedModelId.value,
      prompt: String(form.prompt || '').trim(),
      assets: buildAssetsPayload(),
      parameters: buildParameters(),
      outputDir: form.outputDir,
    }
    const result = await window.cs.createAiVideoJob(payload)
    if (result?.ok === false) throw new Error(result?.error?.message || '创建失败')
    const job = result?.data?.job || result?.job
    if (job) upsertJob(job)
    statusFilter.value = 'all'
    if (isCompact.value) compactPane.value = 'results'
    await reloadJobs()
  } catch (error) {
    formError.value = error?.message || String(error)
  } finally {
    submitting.value = false
  }
}

function upsertJob(job) {
  if (!job?.id) return
  const next = [...jobs.value]
  const index = next.findIndex(item => item.id === job.id)
  if (index >= 0) next[index] = job
  else next.unshift(job)
  jobs.value = next
}

async function reloadJobs() {
  if (typeof window?.cs?.listAiVideoJobs !== 'function') return
  try {
    const result = await window.cs.listAiVideoJobs({ limit: 50 })
    const list = result?.data?.jobs || result?.jobs || []
    jobs.value = Array.isArray(list) ? list : []
    if (detailJob.value?.id) {
      const latest = jobs.value.find(item => item.id === detailJob.value.id)
      if (latest) detailJob.value = latest
    }
  } catch (error) {
    formError.value = error?.message || String(error)
  }
}

async function loadConfig() {
  if (typeof window?.cs?.getAiVideoConfig !== 'function') return
  try {
    const result = await window.cs.getAiVideoConfig()
    config.value = result?.data || result || null
    if (!form.outputDir) {
      form.outputDir = config.value?.defaultOutputDir || defaultOutputDir.value
    }
    defaultOutputDir.value = config.value?.defaultOutputDir || defaultOutputDir.value
  } catch (error) {
    formError.value = error?.message || String(error)
  }
}

async function retryJob(job) {
  try {
    const result = await window.cs.retryAiVideoJob(job.id, { requestUid: requestUid() })
    if (result?.ok === false) throw new Error(result?.error?.message || '重试失败')
    await reloadJobs()
  } catch (error) {
    formError.value = error?.message || String(error)
  }
}

function reuseParams(job) {
  if (!job) return
  form.provider = String(job.provider || '').includes('happy') ? 'happyhorse' : 'seedance'
  applyProviderDefaults()
  form.prompt = job.prompt || ''
  form.outputDir = job.outputDir || form.outputDir
  const params = job.parameters || {}
  if (params.ratio) form.ratio = params.ratio
  if (params.resolution) form.resolution = params.resolution
  if (params.duration != null) form.duration = params.duration
  if (params.generateAudio != null) form.generateAudio = Boolean(params.generateAudio)
  if (params.watermark != null) form.watermark = Boolean(params.watermark)
  form.assets = (job.assets || [])
    .map(asset => ({ path: asset.localPath, role: asset.role }))
    .filter(item => item.path)
  syncHappyHorseRatioDefault()
  compactPane.value = 'inputs'
}

async function retryArchive(job) {
  const runId = job?.currentRunId || job?.currentRun?.id
  if (!runId) return
  try {
    const result = await window.cs.retryAiVideoArchive(runId)
    if (result?.ok === false) throw new Error(result?.error?.message || '重新归档失败')
    await reloadJobs()
  } catch (error) {
    formError.value = error?.message || String(error)
  }
}

async function deleteJob(job) {
  try {
    const result = await window.cs.deleteAiVideoJobRecord(job.id)
    if (result?.ok === false) throw new Error(result?.error?.message || '删除失败')
    if (detailJob.value?.id === job.id) closeDetail()
    await reloadJobs()
  } catch (error) {
    formError.value = error?.message || String(error)
  }
}

async function openLocalFile(path) {
  if (!path || typeof window?.cs?.openFile !== 'function') return
  try {
    await window.cs.openFile(path)
  } catch (error) {
    formError.value = error?.message || String(error)
  }
}

function openDetail(job, event) {
  detailTriggerEl.value = event?.currentTarget || document.activeElement
  detailJob.value = job
  void loadDetailVideo(job)
  nextTick(() => {
    closeDetailBtn.value?.focus?.()
  })
}

function closeDetail() {
  detailJob.value = null
  detailVideoSrc.value = ''
  detailVideoError.value = ''
  detailVideoLoading.value = false
  nextTick(() => {
    detailTriggerEl.value?.focus?.()
    detailTriggerEl.value = null
  })
}

function closeHistory() {
  openHistory.value = false
}

function openHistoryItem(job) {
  openHistory.value = false
  openDetail(job)
}

function updateCompact() {
  isCompact.value = window.innerWidth < 1060
}

function onKeydown(event) {
  if (event.key === 'Escape' && detailJob.value) {
    event.preventDefault()
    closeDetail()
  } else if (event.key === 'Escape' && openHistory.value) {
    event.preventDefault()
    closeHistory()
  }
}

function startPolling() {
  stopPolling()
  pollTimer.value = window.setInterval(() => {
    const hasActive = jobs.value.some(job => isActiveStatus(job.status))
    if (hasActive) reloadJobs()
  }, 4000)
}

function stopPolling() {
  if (pollTimer.value) {
    clearInterval(pollTimer.value)
    pollTimer.value = null
  }
}

watch(() => form.assets.length, () => {
  syncHappyHorseRatioDefault()
})

onMounted(async () => {
  updateCompact()
  window.addEventListener('resize', updateCompact)
  window.addEventListener('keydown', onKeydown)
  applyProviderDefaults()
  await loadConfig()
  if (form.outputDir && typeof window?.cs?.authorizeLocalMediaRoot === 'function') {
    try { await window.cs.authorizeLocalMediaRoot(form.outputDir) } catch { /* ignore */ }
  }
  await reloadJobs()
  startPolling()
})

onUnmounted(() => {
  window.removeEventListener('resize', updateCompact)
  window.removeEventListener('keydown', onKeydown)
  stopPolling()
})
</script>

<style scoped>
.avg-workbench {
  --orange: #ff6b2b;
  --orange-soft: rgba(255, 107, 43, 0.13);
  --orange-line: rgba(255, 107, 43, 0.42);
  --bg: #141418;
  --bg2: #1c1c22;
  --bg3: #242430;
  --border: #2e2e3a;
  --text: #e2e0f0;
  --text2: #aaa8ba;
  --text3: #737184;
  --green: #4ade80;
  --yellow: #facc15;
  --red: #f87171;
  --blue: #60a5fa;
  --shadow: rgba(0, 0, 0, 0.32);
  height: 100%;
  max-height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  color: var(--text);
  background: var(--bg);
  overflow: hidden;
  font-size: 13px;
}

.avg-page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 13px 18px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.avg-kicker {
  margin: 0 0 4px;
  color: var(--orange);
  font-size: 11px;
  font-weight: 800;
}

.avg-page-head h1 {
  margin: 0;
  font-size: 22px;
  line-height: 1.1;
}

.avg-subtitle {
  margin: 6px 0 0;
  color: var(--text2);
  font-size: 12px;
}

.avg-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.avg-mobile-tabs {
  display: none;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
}

.avg-mobile-tabs button {
  height: 34px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text2);
  font-weight: 750;
}

.avg-mobile-tabs button.active {
  color: var(--orange);
  border-color: var(--orange);
  background: var(--orange-soft);
}

.avg-main {
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-columns: 374px minmax(0, 1fr);
  background: var(--bg);
  overflow: hidden;
}

.avg-control-pane {
  min-height: 0;
  height: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  background: var(--bg2);
  overflow: hidden;
}

.avg-model-switcher {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  z-index: 2;
}

.avg-model-switcher-2 {
  grid-template-columns: 1fr 1fr;
}

.avg-cost-card {
  padding: 8px 10px;
  border: 1px solid var(--orange-line);
  border-radius: 8px;
  background: var(--orange-soft);
  display: grid;
  gap: 2px;
}

.avg-cost-main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.avg-cost-main span {
  color: var(--text2);
  font-size: 12px;
  font-weight: 700;
}

.avg-cost-main strong {
  color: var(--orange);
  font-size: 18px;
  font-weight: 850;
  letter-spacing: 0.02em;
}

.avg-cost-formula,
.avg-cost-disclaimer {
  margin: 0;
  color: var(--text3);
  font-size: 11px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.avg-cost-disclaimer {
  opacity: 0.9;
}

.avg-model-card {
  min-height: 82px;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text2);
  padding: 9px;
  display: grid;
  gap: 7px;
  cursor: pointer;
}

.avg-model-card.active {
  border-color: var(--orange);
  background: var(--orange-soft);
  color: var(--text);
}

.avg-model-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.avg-model-head strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.avg-provider-mark {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  object-fit: cover;
  flex: 0 0 auto;
}

.avg-model-card span {
  color: var(--text3);
  font-size: 11px;
  line-height: 1.35;
}

.avg-control-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 12px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
}

.avg-section {
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  overflow: visible;
}

.avg-section-head {
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

.avg-section-head strong { font-size: 12px; }
.avg-section-head span {
  color: var(--text3);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 58%;
}

.avg-section-body {
  padding: 12px;
  display: grid;
  gap: 12px;
}

.avg-section-body-tight {
  gap: 8px;
  padding: 10px 12px 12px;
}

.avg-prompt-input {
  width: 100%;
  min-height: 108px;
  max-height: 220px;
  resize: vertical;
  padding: 10px;
  line-height: 1.5;
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  background: var(--bg2);
  color: var(--text);
  font: inherit;
}

.avg-prompt-input:focus {
  border-color: var(--orange-line);
}

.avg-ref-actions {
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: center;
  gap: 8px;
}

.avg-ref-count {
  justify-self: end;
  color: var(--text3);
  font-size: 11px;
}

.avg-drop-zone-static {
  cursor: default;
  min-height: 56px;
}

.avg-param-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.avg-param-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  align-items: start;
}

.avg-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  min-height: 58px;
}

.avg-field-spacer {
  min-height: 0;
  visibility: hidden;
  pointer-events: none;
}

.avg-field > span {
  color: var(--text2);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  flex: 0 0 auto;
}

.avg-field input,
.avg-field select,
.avg-path-btn {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  background: var(--bg2);
  color: var(--text);
  font: inherit;
}

.avg-field input,
.avg-field select {
  flex: 0 0 auto;
  height: 34px;
  min-height: 34px;
  padding: 0 10px;
  -webkit-appearance: menulist;
  appearance: menulist;
}

.avg-field select:focus,
.avg-field input:focus {
  border-color: var(--orange-line);
}

.avg-segmented {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  flex: 0 0 auto;
}

.avg-segmented button {
  height: 34px;
  min-height: 34px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  color: var(--text2);
  cursor: pointer;
}

.avg-segmented button.active {
  border-color: var(--orange);
  color: var(--orange);
  background: var(--orange-soft);
  font-weight: 800;
}

.avg-asset-grid {
  display: grid;
  gap: 8px;
}

.avg-asset-card {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  min-height: 70px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
}

.avg-asset-card img {
  width: 58px;
  height: 52px;
  border-radius: 7px;
  object-fit: cover;
  border: 1px solid var(--border);
}

.avg-asset-meta { min-width: 0; }
.avg-asset-meta strong,
.avg-asset-meta span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.avg-asset-meta span {
  margin-top: 4px;
  color: var(--text3);
  font-size: 11px;
}

.avg-asset-actions {
  display: flex;
  align-items: center;
  gap: 5px;
}

.avg-drop-zone {
  min-height: 74px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  display: grid;
  place-items: center;
  text-align: center;
  padding: 10px;
  color: var(--text3);
  background: var(--bg2);
  font-size: 11px;
  line-height: 1.45;
  cursor: pointer;
}

.avg-reference-limit {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--text3);
  font-size: 11px;
}

.avg-path-btn {
  min-height: 56px;
  display: grid;
  gap: 4px;
  padding: 10px;
  text-align: left;
  cursor: pointer;
}

.avg-path-btn strong,
.avg-path-btn span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.avg-path-btn span {
  color: var(--text3);
  font-size: 11px;
  line-height: 1.4;
}

.avg-control-footer {
  flex: 0 0 auto;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg2);
  display: grid;
  gap: 8px;
  z-index: 2;
  box-shadow: 0 -8px 20px rgba(0, 0, 0, 0.18);
}

.avg-payload-note {
  min-height: 32px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text3);
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.avg-submit-line {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
}

.avg-result-pane {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: var(--bg);
}

.avg-result-toolbar {
  min-height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
}

.avg-summary-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.avg-pill {
  height: 26px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text2);
  font-size: 12px;
  white-space: nowrap;
}

.avg-pill.orange { color: var(--orange); border-color: var(--orange-line); background: var(--orange-soft); }
.avg-pill.green { color: var(--green); border-color: rgba(74, 222, 128, 0.32); }
.avg-pill.yellow { color: var(--yellow); border-color: rgba(250, 204, 21, 0.32); }
.avg-pill.red { color: var(--red); border-color: rgba(248, 113, 113, 0.32); }

.avg-filter-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.avg-filter-tabs button {
  height: 28px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text2);
  font-size: 12px;
  cursor: pointer;
}

.avg-filter-tabs button.active {
  color: var(--orange);
  border-color: var(--orange);
  background: var(--orange-soft);
  font-weight: 800;
}

.avg-result-body {
  min-height: 0;
  overflow: auto;
  padding: 14px;
  display: grid;
  align-content: start;
  gap: 10px;
}

.avg-result-grid-head {
  min-height: 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text3);
  font-size: 11px;
}

.avg-result-grid-head strong {
  color: var(--text);
  font-size: 13px;
}

.avg-result-grid-head span { text-align: right; }

.avg-task-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.avg-task-card {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  overflow: hidden;
  display: grid;
  grid-template-rows: auto 1fr;
  min-height: 302px;
  cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease, transform 140ms ease;
}

.avg-task-card:hover {
  border-color: var(--orange-line);
  background: #202027;
  transform: translateY(-1px);
}

.avg-task-card:has(.avg-card-open-surface:focus-visible) {
  outline: 2px solid var(--orange);
  outline-offset: 2px;
  border-color: var(--orange);
}

.avg-card-open-surface,
.avg-history-open-surface {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  border-radius: inherit;
  background: transparent;
  cursor: pointer;
}

.avg-card-open-surface:focus-visible,
.avg-history-open-surface:focus-visible {
  outline: 0;
}

.avg-thumb {
  height: 168px;
  position: relative;
  overflow: hidden;
  background: #101015;
}

.avg-thumb-media,
.avg-thumb video,
.avg-thumb-fallback,
.avg-thumb-loading {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  background: linear-gradient(145deg, #17171f, #0d0d12 55%, #1a1a22);
}

.avg-thumb-media {
  opacity: 0.96;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.avg-library-modal {
  width: min(920px, 100%);
  max-height: min(760px, 92vh);
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg2);
  box-shadow: 0 28px 70px var(--shadow);
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  overflow: hidden;
}

.avg-library-sub {
  display: block;
  margin-top: 4px;
  color: var(--text3);
  font-size: 11px;
}

.avg-library-toolbar {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text3);
  font-size: 12px;
}

.avg-library-search {
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  padding: 0 10px;
  font: inherit;
}

.avg-library-grid {
  min-height: 0;
  overflow: auto;
  padding: 12px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  align-content: start;
}

.avg-library-tile {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  overflow: hidden;
  padding: 0 0 8px;
  text-align: left;
  color: inherit;
  cursor: pointer;
  display: grid;
  gap: 6px;
}

.avg-library-tile.selected {
  border-color: var(--orange);
  box-shadow: 0 0 0 1px var(--orange-line);
}

.avg-library-tile img {
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  display: block;
  background: #101015;
}

.avg-library-tile strong {
  padding: 0 8px;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.avg-library-check {
  position: absolute;
  top: 8px;
  left: 8px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(20, 20, 24, 0.82);
  border: 1px solid var(--border);
  color: var(--text2);
  font-size: 11px;
  font-weight: 750;
  display: inline-flex;
  align-items: center;
}

.avg-library-tile.selected .avg-library-check {
  color: var(--orange);
  border-color: var(--orange-line);
  background: var(--orange-soft);
}

.avg-library-state,
.avg-library-pad {
  padding: 24px 12px;
  text-align: center;
  color: var(--text3);
}

.avg-library-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
}

.avg-thumb-loading,
.avg-thumb-fallback {
  display: grid;
  place-content: center;
  gap: 8px;
  text-align: center;
  padding: 16px 12px;
  color: var(--text2);
  background:
    radial-gradient(circle at 50% 38%, rgba(255, 107, 43, 0.14), transparent 42%),
    linear-gradient(160deg, #17171f, #0d0d12 60%);
}

.avg-thumb-loading strong,
.avg-thumb-fallback strong {
  font-size: 13px;
  color: var(--text);
}

.avg-thumb-loading span,
.avg-thumb-fallback span {
  color: var(--text3);
  font-size: 11px;
  line-height: 1.4;
  max-width: 92%;
  margin: 0 auto;
}

.avg-spinner {
  width: 28px;
  height: 28px;
  margin: 0 auto 2px;
  border: 2px solid rgba(255, 255, 255, 0.12);
  border-top-color: var(--orange);
  border-radius: 50%;
  animation: avg-spin 0.8s linear infinite;
}

@keyframes avg-spin {
  to { transform: rotate(360deg); }
}

.avg-thumb::after {
  content: "";
  position: absolute;
  inset: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .avg-spinner {
    animation: none;
    border-top-color: var(--orange);
    opacity: 0.85;
  }
}

.avg-status-chip {
  position: absolute;
  left: 9px;
  top: 9px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border-radius: 8px;
  background: rgba(20, 20, 24, 0.82);
  border: 1px solid var(--border);
  font-size: 11px;
  font-weight: 800;
}

.avg-status-chip.queued { color: var(--text2); }
.avg-status-chip.running { color: var(--yellow); border-color: rgba(250, 204, 21, 0.38); }
.avg-status-chip.completed { color: var(--green); border-color: rgba(74, 222, 128, 0.34); }
.avg-status-chip.downloading { color: var(--blue); border-color: rgba(96, 165, 250, 0.34); }
.avg-status-chip.needs_config { color: var(--orange); border-color: var(--orange-line); }
.avg-status-chip.cancelled,
.avg-status-chip.expired { color: var(--text3); }
.avg-status-chip.failed { color: var(--red); border-color: rgba(248, 113, 113, 0.34); }

.avg-stage-note {
  position: absolute;
  left: 9px;
  bottom: 9px;
  max-width: calc(100% - 18px);
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(20, 20, 24, 0.84);
  color: var(--text2);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.avg-task-body {
  padding: 10px;
  display: grid;
  align-content: start;
  gap: 8px;
}

.avg-task-title {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}

.avg-task-title strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.avg-task-title span {
  color: var(--text3);
  font-size: 11px;
  white-space: nowrap;
}

.avg-task-card p {
  margin: 0;
  color: var(--text3);
  font-size: 11px;
  line-height: 1.45;
  min-height: 34px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.avg-task-actions {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.avg-task-actions .avg-details-task {
  color: var(--orange);
  border-color: var(--orange-line);
  background: var(--orange-soft);
}

.avg-empty {
  min-height: 200px;
  display: none;
  place-items: center;
  text-align: center;
  color: var(--text3);
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: var(--bg2);
  padding: 18px;
  line-height: 1.55;
}

.avg-empty.visible { display: grid; }

.avg-btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text);
  font-weight: 650;
  cursor: pointer;
  font: inherit;
}

.avg-btn:hover { border-color: var(--orange-line); }
.avg-btn.primary { background: var(--orange); border-color: var(--orange); color: #fff; }
.avg-btn.ghost { background: transparent; color: var(--text2); }
.avg-btn.small { height: 28px; padding: 0 9px; font-size: 12px; }
.avg-btn.icon {
  width: 30px;
  padding: 0;
  display: grid;
  place-items: center;
  font-size: 18px;
  line-height: 1;
}
.avg-btn:disabled { opacity: 0.46; cursor: not-allowed; }

.avg-btn:focus-visible,
.avg-model-card:focus-visible,
.avg-filter-tabs button:focus-visible,
.avg-mobile-tabs button:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible {
  outline: 2px solid var(--orange-line);
  outline-offset: 2px;
}

.avg-hint,
.avg-error-text,
.avg-config-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
}

.avg-hint { color: var(--text3); }
.avg-error-text {
  color: var(--red);
  min-height: 15px;
}
.avg-config-hint {
  padding: 10px;
  border: 1px solid var(--orange-line);
  border-radius: 8px;
  background: var(--orange-soft);
  color: var(--orange);
}

.avg-drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.28);
  z-index: 20;
}

.avg-drawer {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 360px;
  max-width: calc(100vw - 24px);
  transform: translateX(104%);
  transition: transform 160ms ease;
  z-index: 21;
  background: var(--bg2);
  border-left: 1px solid var(--border);
  box-shadow: -20px 0 44px var(--shadow);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.avg-drawer.open { transform: translateX(0); }

.avg-drawer-head {
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px;
  border-bottom: 1px solid var(--border);
}

.avg-drawer-head strong,
.avg-drawer-head span { display: block; }
.avg-drawer-head span {
  margin-top: 4px;
  color: var(--text3);
  font-size: 11px;
}

.avg-history-list {
  min-height: 0;
  overflow: auto;
  padding: 12px;
  display: grid;
  align-content: start;
  gap: 9px;
}

.avg-history-item {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  padding: 10px;
  display: grid;
  gap: 8px;
}

.avg-history-item:hover {
  border-color: var(--orange-line);
  background: #1f1f26;
}

.avg-history-item strong,
.avg-history-item span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.avg-history-item span {
  color: var(--text3);
  font-size: 11px;
}

.avg-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.56);
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 22px;
}

.avg-modal {
  width: min(1040px, 100%);
  max-height: min(760px, 92vh);
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  box-shadow: 0 28px 70px var(--shadow);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}

.avg-modal-head {
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}

.avg-modal-body {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) 360px;
  overflow: auto;
}

.avg-modal-preview {
  min-height: 420px;
  position: relative;
  background: #0d0d12;
  display: grid;
  place-items: center;
  overflow: hidden;
}

.avg-modal-preview video,
.avg-modal-preview-pending {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #0d0d12;
}

.avg-modal-preview-pending {
  opacity: 0.42;
  background:
    radial-gradient(circle at 30% 40%, rgba(255, 107, 43, 0.18), transparent 40%),
    linear-gradient(160deg, #15151c, #0d0d12 60%);
}

.avg-modal-loading {
  min-height: 420px;
  width: 100%;
  height: 100%;
}

.avg-modal-state-overlay {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(320px, calc(100% - 36px));
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(20, 20, 24, 0.9);
  text-align: center;
  box-shadow: 0 18px 40px var(--shadow);
}

.avg-modal-state-overlay strong,
.avg-modal-state-overlay span { display: block; }
.avg-modal-state-overlay strong {
  margin-bottom: 6px;
  font-size: 14px;
}
.avg-modal-state-overlay span {
  color: var(--text2);
  font-size: 12px;
  line-height: 1.5;
}

.avg-modal-side {
  padding: 14px;
  border-left: 1px solid var(--border);
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 0;
  overflow: auto;
}

.avg-modal-title-line {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.avg-modal-side h3 {
  margin: 0;
  font-size: 16px;
  line-height: 1.35;
}

.avg-detail-status {
  flex: 0 0 auto;
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  font-size: 11px;
  font-weight: 800;
}

.avg-detail-status.queued { color: var(--text2); }
.avg-detail-status.running { color: var(--yellow); border-color: rgba(250, 204, 21, 0.38); }
.avg-detail-status.completed { color: var(--green); border-color: rgba(74, 222, 128, 0.34); }
.avg-detail-status.downloading { color: var(--blue); border-color: rgba(96, 165, 250, 0.34); }
.avg-detail-status.needs_config { color: var(--orange); border-color: var(--orange-line); }
.avg-detail-status.cancelled,
.avg-detail-status.expired { color: var(--text3); }
.avg-detail-status.failed { color: var(--red); border-color: rgba(248, 113, 113, 0.34); }

.avg-detail-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.avg-kv {
  min-width: 0;
  padding: 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
}

.avg-kv span,
.avg-kv strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.avg-kv span {
  color: var(--text3);
  font-size: 11px;
  margin-bottom: 5px;
}

.avg-kv strong { font-size: 12px; }

.avg-detail-section {
  display: grid;
  gap: 6px;
  padding-top: 11px;
  border-top: 1px solid var(--border);
}

.avg-detail-section > span {
  color: var(--text3);
  font-size: 11px;
}

.avg-detail-section p {
  margin: 0;
  color: var(--text2);
  font-size: 12px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.avg-detail-actions {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  padding-top: 2px;
}

@media (max-width: 1180px) {
  .avg-task-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 1059px) {
  .avg-page-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .avg-head-actions { justify-content: flex-start; }
  .avg-mobile-tabs { display: grid; }
  .avg-main {
    display: block;
    min-height: 0;
    overflow: hidden;
  }
  .avg-control-pane,
  .avg-result-pane {
    display: none;
    min-height: 0;
    height: 100%;
  }
  .avg-control-pane.mobile-active,
  .avg-result-pane.mobile-active {
    display: flex;
  }
  .avg-control-pane.mobile-active {
    flex-direction: column;
  }
  .avg-control-pane { border-right: 0; }
  .avg-result-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
  .avg-filter-tabs { justify-content: flex-start; }
  .avg-task-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .avg-modal-body { grid-template-columns: 1fr; }
  .avg-modal-side {
    border-left: 0;
    border-top: 1px solid var(--border);
  }
}

@media (max-width: 900px) {
  .avg-library-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (max-width: 620px) {
  .avg-model-switcher,
  .avg-param-row,
  .avg-ref-actions,
  .avg-library-toolbar,
  .avg-detail-meta {
    grid-template-columns: 1fr;
  }
  .avg-library-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .avg-ref-count { justify-self: start; }
  .avg-field-spacer { display: none; }
  .avg-task-grid { grid-template-columns: 1fr; }
  .avg-result-grid-head { align-items: flex-start; }
  .avg-result-grid-head span { max-width: 180px; }
  .avg-overlay { padding: 8px; }
  .avg-modal { max-height: 94vh; }
  .avg-modal-preview { min-height: 260px; }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
</style>
