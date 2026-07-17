<template>
  <section class="avg-workbench" :class="{ 'avg-compact': isCompact }">
    <header class="avg-page-head" :inert="backgroundInert || undefined">
      <div class="avg-head-copy">
        <p class="avg-kicker">AI 生视频</p>
        <h1>AI 生视频工作台</h1>
        <p class="avg-subtitle">纯 prompt、参考图与动作素材驱动的视频生成工作台，复用 Seedance 与百炼视频网关能力。</p>
      </div>
      <div class="avg-head-actions">
        <button class="avg-btn ghost" type="button" @click="openHistoryDrawer($event)">历史记录</button>
        <button class="avg-btn" type="button" @click="openOutputFolder">打开输出文件夹</button>
      </div>
    </header>

    <nav class="avg-mobile-tabs" :inert="backgroundInert || undefined" aria-label="移动端视图切换">
      <button type="button" :class="{ active: compactPane === 'inputs' }" @click="compactPane = 'inputs'">输入与参数</button>
      <button type="button" :class="{ active: compactPane === 'results' }" @click="compactPane = 'results'">结果与队列</button>
    </nav>

    <div class="avg-main" :inert="backgroundInert || undefined">
      <aside class="avg-control-pane" :class="{ 'mobile-active': compactPane === 'inputs' }">
        <div class="avg-model-select-card">
          <label class="avg-model-select-label" for="avg-video-model-select">视频模型</label>
          <select id="avg-video-model-select" :value="form.provider" class="avg-model-select" @change="selectProvider($event.target.value)">
            <option v-for="model in modelOptions" :key="model.id" :value="model.id">
              {{ model.label }}
            </option>
          </select>
          <div class="avg-model-select-current" aria-live="polite">
            <img class="avg-provider-mark" :src="activeMeta.mark" alt="" />
            <div>
              <strong>{{ activeMeta.label }}</strong>
              <span>{{ activeMeta.hint }}</span>
            </div>
          </div>
        </div>

        <div class="avg-control-scroll">
          <section v-if="showPromptInput" class="avg-section avg-section-prompt">
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

          <section v-if="!isPixVerse" class="avg-section">
            <div class="avg-section-head">
              <strong>{{ referenceTitle }}</strong>
              <span>{{ referencePolicy }}</span>
            </div>
            <div class="avg-section-body avg-section-body-tight">
              <div v-if="showReferenceAssets" class="avg-ref-actions">
                <button class="avg-btn small" type="button" :disabled="form.assets.length >= assetMax" @click="chooseImages">
                  本地上传
                </button>
                <button class="avg-btn small ghost" type="button" :disabled="form.assets.length >= assetMax" @click="openImageLibrary($event)">
                  本地参考图库
                </button>
                <span class="avg-ref-count">已选 {{ form.assets.length }} / {{ assetMax }}</span>
              </div>
              <div v-if="showReferenceAssets && form.assets.length" class="avg-asset-grid">
                <article
                  v-for="(asset, index) in form.assets"
                  :key="`${asset.fileToken}-${index}`"
                  class="avg-asset-card"
                >
                  <img
                    v-if="assetKind(asset) === 'image' && previewSrc(assetPreviewToken(asset))"
                    :src="previewSrc(assetPreviewToken(asset))"
                    :alt="assetDisplayName(asset)"
                  />
                  <div v-else class="avg-asset-placeholder" :class="{ video: assetKind(asset) === 'video' }">
                    {{ assetKind(asset) === 'video' ? '视频' : '图片' }}
                  </div>
                  <div class="avg-asset-meta">
                    <strong>{{ assetDisplayName(asset) }}</strong>
                    <span>{{ assetRoleLabel(index) }}</span>
                  </div>
                  <label v-if="isKling" class="avg-asset-role-select">
                    <span>角色</span>
                    <select v-model="asset.role">
                      <option v-for="role in klingAssetRoleOptions(asset)" :key="role.value" :value="role.value">
                        {{ role.label }}
                      </option>
                    </select>
                  </label>
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
                {{ referenceEmptyText }}
              </div>
              <p class="avg-hint">{{ modeAutoHint }}</p>
              <div class="avg-error-text">{{ errors.assets }}</div>
            </div>
          </section>

          <section v-if="isPixVerse" class="avg-section">
            <div class="avg-section-head">
              <strong>PixVerse 动作模仿素材</strong>
              <span>优先本地上传</span>
            </div>
            <div class="avg-section-body avg-section-body-tight">
              <div class="avg-pixverse-local-grid">
                <button
                  class="avg-local-source-card avg-local-source-card-media"
                  :class="{ active: pixverseImageAsset }"
                  type="button"
                  @click="choosePixverseAsset('image')"
                >
                  <span>角色图</span>
                  <img
                    v-if="pixverseImageAsset && previewSrc(assetPreviewToken(pixverseImageAsset))"
                    :src="previewSrc(assetPreviewToken(pixverseImageAsset))"
                    :alt="assetDisplayName(pixverseImageAsset)"
                  />
                  <div v-else class="avg-local-source-placeholder">图片</div>
                  <strong>{{ pixverseImageAsset ? assetDisplayName(pixverseImageAsset) : '选择本地图片' }}</strong>
                </button>
                <button
                  class="avg-local-source-card avg-local-source-card-media"
                  :class="{ active: pixverseVideoAsset }"
                  type="button"
                  @click="choosePixverseAsset('video')"
                >
                  <span>动作视频</span>
                  <div class="avg-local-source-placeholder video">视频</div>
                  <strong>{{ pixverseVideoAsset ? assetDisplayName(pixverseVideoAsset) : '选择本地视频' }}</strong>
                </button>
              </div>
              <p class="avg-hint">PixVerse 不使用 Prompt；本地素材会在提交时上传到百炼 48 小时临时 OSS，再用于模型调用。</p>
              <details class="avg-advanced-panel">
                <summary>
                  <span>URL / oss URL 输入</span>
                  <em>可选，高级方式</em>
                </summary>
                <div class="avg-param-stack avg-advanced-panel-body">
                  <label class="avg-field">
                    <span>角色图 URL / oss URL</span>
                    <input v-model="form.pixverseImageUrl" placeholder="https://.../character.png 或 oss://..." />
                  </label>
                  <label class="avg-field">
                    <span>动作视频 URL / oss URL</span>
                    <input v-model="form.pixverseVideoUrl" placeholder="https://.../motion.mp4 或 oss://..." />
                  </label>
                </div>
              </details>
              <div class="avg-error-text">{{ errors.pixverse }}</div>
            </div>
          </section>

          <section v-if="isKling" class="avg-section avg-section-advanced">
            <div class="avg-section-body avg-section-body-tight">
              <details class="avg-advanced-panel">
                <summary>
                  <span>Kling 素材 URL</span>
                  <em>可选，高级方式</em>
                </summary>
                <div class="avg-param-stack avg-advanced-panel-body">
                  <div v-for="slot in klingUrlSlots" :key="slot.type" class="avg-param-row">
                    <label class="avg-field">
                      <span>{{ slot.label }}</span>
                      <input
                        :value="klingMediaUrl(slot.type)"
                        :placeholder="slot.placeholder"
                        @input="setKlingMediaUrl(slot.type, $event.target.value)"
                      />
                    </label>
                  </div>
                </div>
              </details>
              <p class="avg-hint">默认使用上方本地上传；仅当已有 HTTPS / oss:// 素材地址时再展开填写。</p>
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
                  <label v-if="showDuration" class="avg-field">
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
                  <label v-if="isKling" class="avg-field">
                    <span>模式</span>
                    <select v-model="form.klingMode">
                      <option value="std">std · 720P</option>
                      <option value="pro">pro · 1080P</option>
                    </select>
                  </label>
                  <label v-else class="avg-field">
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
                :title="outputDirectoryName || defaultOutputDirectoryName"
                @click="chooseOutputDir"
              >
                <strong>{{ outputDirectoryName || defaultOutputDirectoryName || '选择输出文件夹' }}</strong>
                <span>{{ form.outputDirToken ? '已授权输出目录' : '请选择输出目录' }}</span>
              </button>
              <div class="avg-error-text">{{ errors.outputDir }}</div>
            </div>
          </section>

          <div v-if="configHint" class="avg-config-hint">
            <span>{{ configHint }}</span>
            <button class="avg-btn small" type="button" @click="openVideoSettings">去设置</button>
          </div>
        </div>

        <footer class="avg-control-footer">
          <div class="avg-payload-note" :title="payloadNote">{{ payloadNote }}</div>
          <div v-if="showCostEstimate" class="avg-cost-card" aria-live="polite">
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
            <button type="button" @click="openHistoryDrawer($event)">历史</button>
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
                  class="avg-thumb-media avg-thumb-cover"
                  :alt="job.title || '视频封面'"
                  @error="markCoverBroken(job)"
                />
                <div
                  v-else-if="isActiveStatus(job.status)"
                  class="avg-thumb-loading"
                  aria-live="polite"
                >
                  <div class="avg-spinner" aria-hidden="true"></div>
                  <strong>{{ job.displayStatus || statusLabel(job.status) }}</strong>
                  <span>已等待 {{ formatWait(job.waitedSeconds) }} · 不显示虚构进度</span>
                </div>
                <div
                  v-else-if="jobCoverCandidatePath(job) && !brokenCovers[job.id]"
                  class="avg-thumb-loading"
                >
                  <div class="avg-spinner" aria-hidden="true"></div>
                  <strong>加载封面</strong>
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
                    v-if="canDuplicate(job)"
                    class="avg-btn small"
                    type="button"
                    :disabled="isDuplicatingJob(job)"
                    @click.stop="duplicateJob(job)"
                  >{{ isDuplicatingJob(job) ? '复制中…' : '复制为新任务' }}</button>
                  <button v-if="canEdit(job)" class="avg-btn small" type="button" @click.stop="editDraft(job)">{{ editActionLabel(job) }}</button>
                  <button
                    v-if="canRetry(job)"
                    class="avg-btn small"
                    type="button"
                    :disabled="isRetryingJob(job)"
                    @click.stop="retryJob(job)"
                  >{{ isRetryingJob(job) ? '重试中…' : '重试' }}</button>
                  <button
                    v-if="canRetryArchive(job)"
                    class="avg-btn small"
                    type="button"
                    :disabled="isRetryingArchive(job)"
                    @click.stop="retryArchive(job)"
                  >{{ isRetryingArchive(job) ? '归档中…' : '重新归档' }}</button>
                  <button
                    v-if="jobLocalVideo(job)"
                    class="avg-btn small"
                    type="button"
                    @click.stop="openLocalFile(jobLocalVideo(job))"
                  >打开文件</button>
                  <button
                    v-if="canCancelQueuedJob(job)"
                    class="avg-btn small ghost"
                    type="button"
                    @click.stop="cancelQueuedJob(job)"
                  >取消任务</button>
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
      <div ref="libraryModalRef" class="avg-library-modal" role="dialog" aria-modal="true" aria-label="本地参考图库" tabindex="-1">
        <div class="avg-modal-head">
          <div>
            <strong>本地参考图库</strong>
            <span class="avg-library-sub">{{ libraryRootLabel }}</span>
          </div>
          <button class="avg-btn icon" type="button" aria-label="关闭" @click="closeImageLibrary">×</button>
        </div>
        <div class="avg-library-toolbar">
          <button class="avg-btn small" type="button" data-library-root-trigger @click="chooseLibraryRoot">
            {{ libraryDirectoryToken ? '更换文件夹' : '选择文件夹' }}
          </button>
          <input
            v-model="libraryQuery"
            class="avg-library-search"
            type="search"
            placeholder="搜索文件名"
            :disabled="!libraryDirectoryToken"
          />
          <span>已选 {{ librarySelected.length }} · 还可加 {{ Math.max(0, assetMax - form.assets.length) }}</span>
        </div>
        <div v-if="libraryError" class="avg-error-text avg-library-pad">{{ libraryError }}</div>
        <div v-else-if="libraryLoading" class="avg-library-state">正在扫描图库…</div>
        <div v-else-if="!libraryDirectoryToken" class="avg-library-empty">
          <strong>尚未设置图库目录</strong>
          <p>请选择一个本地文件夹；桌面端会在下次启动时安全恢复该选择。</p>
          <button class="avg-btn primary" type="button" data-library-root-trigger @click="chooseLibraryRoot">选择文件夹</button>
        </div>
        <div v-else ref="libraryGridRef" class="avg-library-grid">
          <button
            v-for="item in filteredLibraryItems"
            :key="item.fileToken"
            type="button"
            class="avg-library-tile"
            :class="{ selected: librarySelected.includes(item.fileToken) }"
            :data-library-token="item.fileToken"
            @click="toggleLibraryItem(item.fileToken)"
          >
            <div class="avg-library-media">
              <img
                v-if="previewSrc(assetPreviewToken(item))"
                :src="previewSrc(assetPreviewToken(item))"
                :alt="item.name"
                decoding="async"
                @error="markImagePreviewBroken(assetPreviewToken(item))"
              />
              <div v-else class="avg-library-tile-ph" aria-hidden="true">
                <span v-if="imagePreviewLoading[assetPreviewToken(item)]">加载中</span>
                <span v-else-if="imagePreviewBroken[assetPreviewToken(item)]">无预览</span>
                <span v-else>…</span>
              </div>
            </div>
            <span class="avg-library-check">{{ librarySelected.includes(item.fileToken) ? '已选' : '选择' }}</span>
            <strong :title="item.name">{{ item.name }}</strong>
          </button>
          <div v-if="!filteredLibraryItems.length" class="avg-library-state">
            没有匹配的图片
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
    <aside class="avg-drawer" :class="{ open: openHistory }" :inert="openHistory ? undefined : true" aria-label="历史记录" :aria-hidden="openHistory ? 'false' : 'true'">
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
            @click="openHistoryItem(job, $event)"
          ></button>
          <strong>{{ job.title || job.prompt }}</strong>
          <span>{{ job.id }} · {{ modelLabel(job.model) }} · {{ job.displayStatus || statusLabel(job.status) }}</span>
          <div class="avg-task-actions">
            <button class="avg-btn small" type="button" @click="openHistoryItem(job, $event)">查看详情</button>
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
        :class="{ 'avg-modal-portrait': detailIsPortrait }"
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
          <div class="avg-modal-preview" :class="{ 'is-portrait': detailIsPortrait }">
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
                class="avg-detail-video"
                :class="{ 'is-portrait': detailIsPortrait }"
                :src="detailVideoSrc"
                controls
                playsinline
                preload="auto"
                :poster="jobCoverSrc(detailJob) || undefined"
                @error="handleDetailVideoPlaybackError"
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
              <button v-if="canDuplicate(detailJob)" class="avg-btn" type="button" :disabled="isDuplicatingJob(detailJob)" @click="duplicateJob(detailJob)">
                {{ isDuplicatingJob(detailJob) ? '复制中…' : '复制为新任务' }}
              </button>
              <button v-if="canEdit(detailJob)" class="avg-btn" type="button" @click="editDraft(detailJob); closeDetail()">{{ editActionLabel(detailJob) }}</button>
              <button v-if="canRetry(detailJob)" class="avg-btn" type="button" :disabled="isRetryingJob(detailJob)" @click="retryJob(detailJob)">
                {{ isRetryingJob(detailJob) ? '重试中…' : '重试' }}
              </button>
              <button v-if="canRetryArchive(detailJob)" class="avg-btn" type="button" :disabled="isRetryingArchive(detailJob)" @click="retryArchive(detailJob)">
                {{ isRetryingArchive(detailJob) ? '归档中…' : '重新归档' }}
              </button>
              <button
                class="avg-btn"
                type="button"
                :disabled="!jobLocalVideo(detailJob)"
                @click="openLocalFile(jobLocalVideo(detailJob))"
              >{{ jobLocalVideo(detailJob) ? '打开本地文件' : '尚无本地文件' }}</button>
              <button v-if="canCancelQueuedJob(detailJob)" class="avg-btn ghost" type="button" @click="cancelQueuedJob(detailJob)">取消任务</button>
              <button v-if="canDelete(detailJob)" class="avg-btn ghost" type="button" @click="deleteJob(detailJob)">删除记录</button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import volcengineMark from '../assets/ai-video-generation/volcengine-mark.png'
import aliyunMark from '../assets/ai-video-generation/aliyun-mark.png'
import {
  estimateVideoCost,
  formatCny,
  happyHorseModeLabel,
  happyHorseModelId,
  resolveHappyHorseMode,
} from '../utils/aiVideoPricing.mjs'
import { trapDialogFocus } from '../utils/dialogAccessibility.mjs'

const emit = defineEmits(['open-settings'])

const SEEDANCE_MODEL = 'doubao-seedance-2-0-260128'
const KLING_V3_MODEL = 'kling/kling-v3-video-generation'
const KLING_OMNI_MODEL = 'kling/kling-v3-omni-video-generation'
const PIXVERSE_MOTIONCONTROL_MODEL = 'pixverse/pixverse-motioncontrol'

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
  {
    id: 'kling-v3',
    label: 'Kling v3',
    hint: '百炼可灵：文生、首帧图生、首尾帧图生。',
    mark: aliyunMark,
  },
  {
    id: 'kling-omni',
    label: 'Kling Omni',
    hint: '百炼可灵 Omni：支持参考图、首尾帧、参考/编辑视频。',
    mark: aliyunMark,
  },
  {
    id: 'pixverse-motioncontrol',
    label: 'PixVerse Motion',
    hint: '动作模仿：角色图 URL + 动作视频 URL。',
    mark: aliyunMark,
  },
]

const KLING_V3_LOCAL_ROLES = [
  { value: 'first_frame', label: '首帧图' },
  { value: 'last_frame', label: '尾帧图' },
]
const KLING_OMNI_IMAGE_ROLES = [
  { value: 'first_frame', label: '首帧图' },
  { value: 'last_frame', label: '尾帧图' },
  { value: 'refer', label: '参考图' },
]
const KLING_OMNI_VIDEO_ROLES = [
  { value: 'feature', label: '特征参考视频' },
  { value: 'base', label: '待编辑视频' },
]
const KLING_URL_SLOTS_V3 = [
  { type: 'first_frame', label: '首帧图 URL', placeholder: 'https://.../first-frame.jpg 或 oss://...' },
  { type: 'last_frame', label: '尾帧图 URL', placeholder: 'https://.../last-frame.jpg 或 oss://...' },
]
const KLING_URL_SLOTS_OMNI = [
  ...KLING_URL_SLOTS_V3,
  { type: 'refer', label: '参考图 URL', placeholder: 'https://.../reference.png 或 oss://...' },
  { type: 'feature', label: '特征参考视频 URL', placeholder: 'https://.../feature.mp4 或 oss://...' },
  { type: 'base', label: '待编辑视频 URL', placeholder: 'https://.../base.mov 或 oss://...' },
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
  klingMode: 'std',
  klingMedia: [],
  pixverseImageUrl: '',
  pixverseVideoUrl: '',
  watermark: false,
  outputDirToken: '',
})

const jobs = ref([])
const statusFilter = ref('all')
const compactPane = ref('inputs')
const isCompact = ref(false)
const submitting = ref(false)
const formError = ref('')
const errors = reactive({ prompt: '', assets: '', parameters: '', pixverse: '', outputDir: '' })
const config = ref(null)
const openHistory = ref(false)
const detailJob = ref(null)
const detailTriggerEl = ref(null)
const historyTriggerEl = ref(null)
const modalRef = ref(null)
const closeDetailBtn = ref(null)
const pollTimer = ref(null)
const outputDirectoryName = ref('')
const outputDirectorySource = ref('') // default | manual | job | ''
const defaultOutputDirectoryName = ref('抓虾AI生视频')
const brokenCovers = reactive({})
const coverUrls = reactive({})
const coverLoading = reactive({})
const coverSourceKeys = reactive({})
const coverRequestSequences = Object.create(null)
const mediaUrlCache = reactive({})
const imagePreviewUrls = reactive({})
const imagePreviewLoading = reactive({})
const detailVideoSrc = ref('')
const detailVideoLoading = ref(false)
const detailVideoError = ref('')
const libraryOpen = ref(false)
const libraryDirectoryToken = ref('')
const libraryDirectoryName = ref('')
const libraryRootSource = ref('') // saved | manual | ''
const libraryItems = ref([])
const librarySelected = ref([])
const libraryQuery = ref('')
const libraryLoading = ref(false)
const libraryError = ref('')
const imagePreviewBroken = reactive({})
const retryingJobIds = reactive(new Set())
const duplicatingJobIds = reactive(new Set())
const archivingRunIds = reactive(new Set())
const editingDraftJobId = ref('')
const requiredReusedAssetCount = ref(0)
const requiredReusedModelId = ref('')
const LEGACY_RENDERER_LIBRARY_CAPABILITY_KEYS = Object.freeze([
  'crawshrimp.ai-video.reference-library-capability',
  'crawshrimp.ai-video.reference-library-root',
  'crawshrimp.bala-ai-video.workspace-directory-token',
])
/** 缩略图并发；原图全量 base64 会卡死，只加载视口内缩略图 */
const LIBRARY_PREVIEW_CONCURRENCY = 3
const LIBRARY_THUMB_MAX_EDGE = 280
const LIBRARY_THUMB_QUALITY = 0.72
const libraryGridRef = ref(null)
const libraryModalRef = ref(null)
const libraryTriggerEl = ref(null)
let libraryPreviewObserver = null
let libraryPreviewQueue = []
let libraryPreviewActive = 0
let libraryPreviewGeneration = 0
const libraryPreviewTokens = new Set()
let imagePreviewActive = 0
const imagePreviewWaiters = []
let detailVideoRequestSequence = 0
let activationSequence = 0
let workbenchActive = false
let jobsReloadSequence = 0
let jobsReloading = 0
let libraryScanSequence = 0
let detailVideoRecoverySourceKey = ''
let detailVideoRecoveryAttempted = false
let detailVideoRecoveryInFlight = false

const activeMeta = computed(() => modelOptions.find(item => item.id === form.provider) || modelOptions[0])
const activeModelLabel = computed(() => activeMeta.value.label)
const backgroundInert = computed(() => Boolean(detailJob.value || libraryOpen.value || openHistory.value))
const isSeedance = computed(() => form.provider === 'seedance')
const isHappyHorse = computed(() => form.provider === 'happyhorse')
const isKling = computed(() => form.provider === 'kling-v3' || form.provider === 'kling-omni')
const isPixVerse = computed(() => form.provider === 'pixverse-motioncontrol')
const backendProvider = computed(() => (isSeedance.value ? 'seedance' : 'happyhorse'))
const pixverseImageAsset = computed(() => form.assets.find(asset => asset?.role === 'image_url') || null)
const pixverseVideoAsset = computed(() => form.assets.find(asset => asset?.role === 'video_url') || null)
const pixverseMediaCount = computed(() => {
  let count = 0
  if (String(form.pixverseImageUrl || '').trim() || pixverseImageAsset.value) count += 1
  if (String(form.pixverseVideoUrl || '').trim() || pixverseVideoAsset.value) count += 1
  return count
})
const klingUrlSlots = computed(() => (form.provider === 'kling-omni' ? KLING_URL_SLOTS_OMNI : KLING_URL_SLOTS_V3))
const klingUrlMedia = computed(() => form.klingMedia.filter(item => String(item?.url || '').trim()))
const klingMediaCount = computed(() => (isKling.value ? form.assets.length + klingUrlMedia.value.length : 0))
const klingLocalMediaKind = computed(() => (form.provider === 'kling-omni' ? 'image-video' : 'image'))

const libraryRootLabel = computed(() => {
  if (!libraryDirectoryToken.value) return '请先设置图库文件夹'
  const dir = libraryDirectoryName.value || '已授权图库'
  if (libraryRootSource.value === 'manual') return `${dir} · 手动选择`
  if (libraryRootSource.value === 'saved') return `${dir} · 已恢复上次选择`
  return dir
})

/** 竖屏任务详情需要更高预览区，避免 9:16 被横框裁切 */
const detailIsPortrait = computed(() => {
  const job = detailJob.value
  if (!job) return false
  const ratio = String(
    job?.parameters?.ratio
    || job?.currentRun?.inputSnapshot?.parameters?.ratio
    || '',
  ).trim()
  if (['9:16', '3:4', '2:3', '9/16', '3/4', '2/3'].includes(ratio)) return true
  // Fallback: portrait-ish when width < height in free-form size strings like "720x1280"
  const size = String(job?.parameters?.size || job?.parameters?.resolution || '').toLowerCase()
  const match = size.match(/(\d+)\s*[x×]\s*(\d+)/)
  if (match) return Number(match[1]) < Number(match[2])
  return false
})

/** HappyHorse 模式由图片数量自动判定：0=t2v, 1=i2v, 2-9=r2v */
const happyHorseMode = computed(() => resolveHappyHorseMode(form.assets.length))
const resolvedModelId = computed(() => {
  if (isSeedance.value) return SEEDANCE_MODEL
  if (form.provider === 'kling-v3') return KLING_V3_MODEL
  if (form.provider === 'kling-omni') return KLING_OMNI_MODEL
  if (isPixVerse.value) return PIXVERSE_MOTIONCONTROL_MODEL
  return happyHorseModelId(happyHorseMode.value)
})
const modeBadge = computed(() => {
  if (isSeedance.value) {
    return form.assets.length ? `参考图生视频 · ${form.assets.length} 张` : '文生 / 可加参考图'
  }
  if (isKling.value) return klingMediaCount.value ? `Kling 多模态 · ${klingMediaCount.value} 个素材` : 'Kling 文生'
  if (isPixVerse.value) return 'PixVerse 动作模仿'
  return happyHorseModeLabel(happyHorseMode.value)
})
const shortModelLabel = computed(() => {
  if (isSeedance.value) return 'Seedance 2.0'
  if (form.provider === 'kling-v3') return 'Kling v3'
  if (form.provider === 'kling-omni') return 'Kling Omni'
  if (isPixVerse.value) return 'PixVerse'
  return `HH · ${happyHorseModeLabel(happyHorseMode.value)}`
})
const assetMax = computed(() => {
  if (isSeedance.value) return 4
  if (isHappyHorse.value) return 9
  if (form.provider === 'kling-v3') return 2
  if (form.provider === 'kling-omni') return 7
  if (isPixVerse.value) return 2
  return 0
})
const showReferenceAssets = computed(() => assetMax.value > 0 && !isPixVerse.value)
const showPromptInput = computed(() => !isPixVerse.value)
const showDuration = computed(() => !isPixVerse.value)
const showRatio = computed(() => {
  if (isPixVerse.value) return false
  return !(isHappyHorse.value && happyHorseMode.value === 'i2v')
})
const showAudio = computed(() => isSeedance.value || isKling.value)
const showImageInsert = computed(() => isHappyHorse.value && happyHorseMode.value === 'r2v')
const durationMin = computed(() => (isSeedance.value ? 4 : 3))
const durationOptions = computed(() => {
  const options = []
  for (let i = durationMin.value; i <= 15; i += 1) options.push(i)
  return options
})
const ratioOptions = computed(() => {
  if (isSeedance.value) return SEEDANCE_RATIOS
  if (isKling.value) return ['16:9', '9:16', '1:1']
  return HAPPYHORSE_RATIOS
})
const resolutionOptions = computed(() => {
  if (isSeedance.value) return ['480p', '720p', '1080p']
  if (isPixVerse.value) return ['360P', '540P', '720P']
  return ['720P', '1080P']
})
const referenceTitle = computed(() => {
  if (isKling.value) return '参考素材'
  if (isPixVerse.value) return '本地参考图'
  if (isHappyHorse.value && happyHorseMode.value === 'i2v') return '首帧图'
  return '参考图'
})
const referencePolicy = computed(() => {
  if (isSeedance.value) return '可选 0-4 张'
  if (form.provider === 'kling-v3') return '可选 0-2 张首/尾帧'
  if (form.provider === 'kling-omni') return '可选图片/视频素材'
  if (isPixVerse.value) return '改用 URL 输入'
  if (happyHorseMode.value === 't2v') return '0 张 → 文生；加图将切换模式'
  if (happyHorseMode.value === 'i2v') return '1 张 → 图生视频（首帧）'
  return '2-9 张 → 参考生视频'
})
const referenceEmptyText = computed(() => {
  if (isKling.value) return '可本地上传素材，提交时自动上传到百炼临时 OSS；也可在下方直接填写 URL。'
  if (isPixVerse.value) return 'PixVerse 请在下方填写角色图 URL 和动作视频 URL。'
  return 'JPEG / PNG / WEBP · 单张 ≤ 20MB · 用上方按钮添加'
})
const modeAutoHint = computed(() => {
  if (isSeedance.value) return 'Seedance：0 张纯文生，1-4 张作为 reference_image。'
  if (isKling.value) return 'Kling：本地素材会转成百炼临时 oss:// URL；v3 仅支持首帧/尾帧，Omni 还支持参考图/视频。'
  if (isPixVerse.value) return 'PixVerse：输出动作由动作视频 URL 决定，角色由角色图 URL 决定。'
  if (happyHorseMode.value === 't2v') return '当前 0 张图 → 自动调用文生视频（t2v）。'
  if (happyHorseMode.value === 'i2v') return '当前 1 张图 → 自动调用图生视频（i2v），比例隐藏。'
  return '当前 ≥2 张图 → 自动调用参考生视频（r2v），建议 Prompt 使用 [Image n]。'
})
const promptHint = computed(() => {
  if (isPixVerse.value) return 'PixVerse 不使用 Prompt；这里可留空，主要填写角色图 URL 和动作视频 URL。'
  if (isKling.value) return 'Kling Prompt 必填；请写清主体、场景、动作、镜头和风格。'
  if (isHappyHorse.value && happyHorseMode.value === 'r2v') {
    if (/\[Image\s*\d+\]/i.test(form.prompt)) return '已检测到 Image 引用。'
    return '参考生视频可点击图片旁插入 [Image n] 写入 Prompt。'
  }
  return 'Prompt 必填。HappyHorse 会按图片数量自动选择文生 / 图生 / 参考生。'
})
const paramHint = computed(() => {
  if (isSeedance.value) return 'Seedance 默认 720p / 5 秒 / 9:16 / 音频开 / 水印关。'
  if (isKling.value) return 'Kling 默认 std / 5 秒 / 16:9 / 音频开 / 水印关；pro 对应更高清模式。'
  if (isPixVerse.value) return 'PixVerse 只提交 resolution 与 watermark，时长跟随动作参考视频。'
  if (happyHorseMode.value === 'i2v') return '图生视频隐藏比例，输出画幅跟随首帧。'
  if (happyHorseMode.value === 't2v') return '文生视频默认 720P / 5 秒 / 16:9 / 水印关。'
  return '参考生视频默认 720P / 5 秒 / 9:16 / 水印关。'
})
const costEstimate = computed(() => estimateVideoCost({
  provider: form.provider,
  resolution: form.resolution,
  duration: form.duration,
}))
const providerAllowsCostEstimate = computed(() => {
  if (backendProvider.value !== 'happyhorse') return true
  return config.value?.providers?.happyhorse?.pricingEstimateAvailable !== false
})
const showCostEstimate = computed(() => costEstimate.value?.known === true && providerAllowsCostEstimate.value)
const payloadNote = computed(() => {
  const audio = showAudio.value ? ` / 音频${form.generateAudio ? '开' : '关'}` : ''
  const ratio = showRatio.value ? ` / ${form.ratio}` : (isPixVerse.value ? '' : ' / 比例随首帧')
  const quality = isKling.value ? form.klingMode : form.resolution
  const duration = showDuration.value ? `/${form.duration}s` : ''
  const inputCount = isPixVerse.value ? `${pixverseMediaCount.value}/2 个动作模仿素材` : isKling.value ? `${klingMediaCount.value} 个素材` : `${form.assets.length} 张图`
  return `将调用 ${resolvedModelId.value} · ${modeBadge.value} · ${inputCount} · ${quality}${duration}${ratio}${audio} / 水印${form.watermark ? '开' : '关'}`
})
const configHint = computed(() => {
  const providers = config.value?.providers || {}
  const item = providers[backendProvider.value]
  if (!item) return ''
  if (!item.configured) return `当前 ${isSeedance.value ? 'Seedance' : '百炼'} 凭据未配置，请到设置 → AI 能力配置`
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
  return items.filter(item => String(item.name || item.relativePath || '').toLowerCase().includes(query))
})

function countByStatus(status) {
  return jobs.value.filter(job => job.status === status).length
}

function openVideoSettings() {
  emit('open-settings')
}

function selectProvider(provider) {
  clearReusedAssetGuard()
  const previous = form.provider
  form.provider = modelOptions.some(item => item.id === provider) ? provider : 'seedance'
  if (previous !== form.provider) {
    form.assets = []
    form.klingMedia = []
    form.pixverseImageUrl = ''
    form.pixverseVideoUrl = ''
  }
  applyProviderDefaults()
}

function applyProviderDefaults() {
  if (isSeedance.value) {
    form.ratio = '9:16'
    form.resolution = '720p'
    form.duration = 5
    form.generateAudio = true
    form.klingMode = 'std'
    form.watermark = false
    if (form.assets.length > 4) form.assets = form.assets.slice(0, 4)
    return
  }
  if (isKling.value) {
    form.ratio = '16:9'
    form.resolution = '720P'
    form.duration = 5
    form.generateAudio = true
    form.klingMode = 'std'
    form.watermark = false
    return
  }
  if (isPixVerse.value) {
    form.ratio = ''
    form.resolution = '720P'
    form.duration = 5
    form.generateAudio = false
    form.klingMode = 'std'
    form.watermark = false
    return
  }
  form.resolution = '720P'
  form.duration = 5
  form.watermark = false
  form.generateAudio = false
  form.klingMode = 'std'
  if (form.assets.length > 9) form.assets = form.assets.slice(0, 9)
  const mode = resolveHappyHorseMode(form.assets.length)
  form.ratio = mode === 'i2v' ? '' : mode === 't2v' ? '16:9' : '9:16'
}

function syncHappyHorseRatioDefault(previousMode = '') {
  if (!isHappyHorse.value) return
  const mode = resolveHappyHorseMode(form.assets.length)
  if (mode === 'i2v') {
    form.ratio = ''
    return
  }
  const modeChanged = Boolean(previousMode) && previousMode !== mode
  if (mode === 't2v') {
    if (modeChanged || !form.ratio) form.ratio = '16:9'
    return
  }
  if (modeChanged || !form.ratio) form.ratio = '9:16'
}

function assetRoleLabel(index) {
  const asset = form.assets[index]
  if (isKling.value) {
    const role = klingAssetRoleOptions(asset).find(item => item.value === asset?.role)
    return role?.label || 'Kling 素材'
  }
  if (isPixVerse.value) return asset?.role === 'video_url' ? '动作视频' : '角色图'
  if (isHappyHorse.value && happyHorseMode.value === 'i2v') return '首帧'
  return `参考图 ${index + 1}`
}

function assetFileToken(asset) {
  return String(asset?.fileToken || '').trim()
}

function assetPreviewToken(asset) {
  return String(asset?.previewToken || asset?.fileToken || '').trim()
}

function assetDisplayName(asset) {
  return String(asset?.name || asset?.relativePath || (assetKind(asset) === 'video' ? '本地视频' : '本地图片')).trim() || '本地图片'
}

function assetKind(asset) {
  const kind = String(asset?.kind || '').trim()
  if (kind) return kind
  const mime = String(asset?.mimeType || '').trim()
  if (mime.startsWith('video/')) return 'video'
  return 'image'
}

function klingAssetRoleOptions(asset) {
  if (form.provider === 'kling-v3') return KLING_V3_LOCAL_ROLES
  return assetKind(asset) === 'video'
    ? KLING_OMNI_VIDEO_ROLES
    : KLING_OMNI_IMAGE_ROLES
}

function defaultKlingAssetRole(asset, index = 0) {
  if (form.provider === 'kling-v3') return index === 0 ? 'first_frame' : 'last_frame'
  if (assetKind(asset) === 'video') {
    return form.assets.some(item => item?.role === 'feature') ? 'base' : 'feature'
  }
  return index === 0 ? 'first_frame' : 'refer'
}

function normalizeSelectedAsset(item) {
  const fileToken = String(item?.fileToken || '').trim()
  if (!fileToken) return null
  return {
    fileToken,
    previewToken: String(item?.previewToken || '').trim() || undefined,
    name: String(item?.name || '本地图片').trim() || '本地图片',
    relativePath: String(item?.relativePath || '').trim() || undefined,
    kind: String(item?.kind || '').trim() || undefined,
    mimeType: String(item?.mimeType || '').trim() || undefined,
    role: String(item?.role || '').trim() || undefined,
    size: Number.isFinite(Number(item?.size)) ? Number(item.size) : undefined,
  }
}

function clearReusedAssetGuard() {
  requiredReusedAssetCount.value = 0
  requiredReusedModelId.value = ''
}

function clearReusedAssetGuardWhenRecovered() {
  if (!requiredReusedAssetCount.value) return
  if (form.assets.length < requiredReusedAssetCount.value) return
  if (requiredReusedModelId.value && requiredReusedModelId.value !== resolvedModelId.value) return
  clearReusedAssetGuard()
  if (/参考图不可用/.test(formError.value)) formError.value = ''
}

function resetForm() {
  editingDraftJobId.value = ''
  clearReusedAssetGuard()
  form.prompt = ''
  form.assets = []
  form.klingMedia = []
  form.pixverseImageUrl = ''
  form.pixverseVideoUrl = ''
  applyProviderDefaults()
  formError.value = ''
  errors.prompt = ''
  errors.assets = ''
  errors.parameters = ''
  errors.pixverse = ''
  errors.outputDir = ''
}

function thumbCacheKey(path) {
  return `thumb:${String(path || '').trim()}`
}

function previewSrc(path) {
  const key = String(path || '').trim()
  if (!key || imagePreviewBroken[key]) return ''
  // Prefer compressed thumbnails; never fall back to direct filesystem URLs.
  return imagePreviewUrls[thumbCacheKey(key)] || imagePreviewUrls[key] || ''
}

function markImagePreviewBroken(path) {
  const key = String(path || '').trim()
  if (!key) return
  imagePreviewBroken[key] = true
  delete imagePreviewUrls[key]
  delete imagePreviewUrls[thumbCacheKey(key)]
  delete mediaUrlCache[key]
  delete mediaUrlCache[thumbCacheKey(key)]
}

function clearImagePreviewCache(path) {
  const key = String(path || '').trim()
  if (!key) return
  delete imagePreviewUrls[key]
  delete imagePreviewUrls[thumbCacheKey(key)]
  delete imagePreviewLoading[key]
  delete imagePreviewLoading[thumbCacheKey(key)]
  delete imagePreviewBroken[key]
  delete mediaUrlCache[key]
  delete mediaUrlCache[thumbCacheKey(key)]
}

function formUsesPreviewToken(path) {
  const key = String(path || '').trim()
  return Boolean(key) && form.assets.some(asset => assetPreviewToken(asset) === key)
}

function resetLibraryPreviewGeneration() {
  libraryPreviewGeneration += 1
  for (const token of libraryPreviewTokens) {
    if (!formUsesPreviewToken(token)) clearImagePreviewCache(token)
  }
  libraryPreviewTokens.clear()
  return libraryPreviewGeneration
}

function registerLibraryPreviewTokens(items, generation) {
  if (generation !== libraryPreviewGeneration) return
  for (const item of items || []) {
    const token = assetPreviewToken(item)
    if (token) libraryPreviewTokens.add(token)
  }
}

function isStaleLibraryPreviewRequest(path, generation) {
  if (!Number.isInteger(generation) || generation === libraryPreviewGeneration) return false
  const key = String(path || '').trim()
  return !libraryPreviewTokens.has(key) && !formUsesPreviewToken(key)
}

async function ensureImagePreview(path, { thumbnail = true, libraryGeneration = null } = {}) {
  const key = String(path || '').trim()
  if (!key || imagePreviewBroken[key]) return ''
  const cacheKey = thumbnail ? thumbCacheKey(key) : key
  if (imagePreviewUrls[cacheKey] || imagePreviewLoading[cacheKey]) {
    return imagePreviewUrls[cacheKey] || ''
  }
  imagePreviewLoading[cacheKey] = true
  // Also mark path loading so tile UI can show spinner via imagePreviewLoading[path]
  if (thumbnail) imagePreviewLoading[key] = true
  try {
    const src = await withImagePreviewSlot(() => resolveLocalImageSrc(key, { thumbnail }))
    if (isStaleLibraryPreviewRequest(key, libraryGeneration)) {
      clearImagePreviewCache(key)
      return ''
    }
    if (!src) throw new Error('预览不可用')
    imagePreviewUrls[cacheKey] = src
    delete imagePreviewBroken[key]
  } catch {
    if (isStaleLibraryPreviewRequest(key, libraryGeneration)) {
      clearImagePreviewCache(key)
    } else {
      imagePreviewBroken[key] = true
      delete imagePreviewUrls[cacheKey]
    }
  } finally {
    delete imagePreviewLoading[cacheKey]
    if (thumbnail) delete imagePreviewLoading[key]
  }
  return imagePreviewUrls[cacheKey] || ''
}

async function withImagePreviewSlot(task) {
  if (imagePreviewActive >= LIBRARY_PREVIEW_CONCURRENCY) {
    await new Promise(resolve => imagePreviewWaiters.push(resolve))
  }
  imagePreviewActive += 1
  try {
    return await task()
  } finally {
    imagePreviewActive = Math.max(0, imagePreviewActive - 1)
    imagePreviewWaiters.shift()?.()
  }
}

async function resolveLocalImageSrc(filePath, { thumbnail = false } = {}) {
  const key = String(filePath || '').trim()
  if (!key) return ''
  const cacheKey = thumbnail ? thumbCacheKey(key) : key
  if (mediaUrlCache[cacheKey]) return mediaUrlCache[cacheKey]

  // Grid / library previews must stay bounded. Resolve the compressed thumbnail
  // before considering the original media stream.
  if (thumbnail && typeof window?.cs?.readAiVideoImageThumbnail === 'function') {
    try {
      const response = await window.cs.readAiVideoImageThumbnail(key, {
        maxEdge: LIBRARY_THUMB_MAX_EDGE,
        quality: LIBRARY_THUMB_QUALITY,
      })
      if (response?.ok === false) throw new Error(response?.error || '本地缩略图不可用')
      const dataUrl = String(response?.data_url || response?.dataUrl || '').trim()
      if (!dataUrl) throw new Error(response?.error || '本地缩略图不可用')
      mediaUrlCache[cacheKey] = dataUrl
      return dataUrl
    } catch {
      // Fall through to the capability-backed original only when thumbnailing fails.
    }
  }

  // Opaque file capabilities can be streamed through crawshrimp-media without
  // materializing the original image as a Base64 string in renderer memory.
  if (typeof window?.cs?.getAiVideoMediaUrl === 'function') {
    try {
      const mediaUrl = await resolvePlayableMediaUrl(key)
      if (mediaUrl) {
        mediaUrlCache[cacheKey] = mediaUrl
        return mediaUrl
      }
    } catch {
      // Fall through to the full preview IPC when the protocol is unavailable.
    }
  }

  // Full preview path (selected assets / detail).
  if (typeof window?.cs?.readAiVideoImagePreview === 'function') {
    const response = await window.cs.readAiVideoImagePreview(key)
    if (response?.ok === false) {
      throw new Error(response?.error || '本地图片预览不可用')
    }
    const dataUrl = String(response?.data_url || response?.dataUrl || '').trim()
    if (!dataUrl) throw new Error(response?.error || '本地图片预览不可用')
    mediaUrlCache[cacheKey] = dataUrl
    return dataUrl
  }

  if (typeof window?.cs?.getAiVideoMediaUrl === 'function') {
    return resolvePlayableMediaUrl(key)
  }
  return ''
}

function enqueueLibraryPreview(path, generation = libraryPreviewGeneration) {
  const key = String(path || '').trim()
  if (!key || imagePreviewBroken[key] || previewSrc(key) || imagePreviewLoading[key]) return
  if (libraryPreviewQueue.some(item => item.key === key && item.generation === generation)) return
  libraryPreviewQueue.push({ key, generation })
  pumpLibraryPreviewQueue()
}

function pumpLibraryPreviewQueue() {
  while (libraryPreviewActive < LIBRARY_PREVIEW_CONCURRENCY && libraryPreviewQueue.length) {
    const next = libraryPreviewQueue.shift()
    if (!next?.key || previewSrc(next.key) || imagePreviewBroken[next.key]) continue
    libraryPreviewActive += 1
    void ensureImagePreview(next.key, {
      thumbnail: true,
      libraryGeneration: next.generation,
    })
      .catch(() => {})
      .finally(() => {
        libraryPreviewActive = Math.max(0, libraryPreviewActive - 1)
        pumpLibraryPreviewQueue()
      })
  }
}

function disconnectLibraryPreviewObserver() {
  if (libraryPreviewObserver) {
    libraryPreviewObserver.disconnect()
    libraryPreviewObserver = null
  }
  libraryPreviewQueue = []
  libraryPreviewActive = 0
}

function observeLibraryTiles() {
  disconnectLibraryPreviewObserver()
  const root = libraryGridRef.value
  if (!root || typeof IntersectionObserver === 'undefined') {
    // Fallback: only warm a small first page of thumbs.
    for (const item of (filteredLibraryItems.value || []).slice(0, 24)) {
      enqueueLibraryPreview(assetPreviewToken(item))
    }
    return
  }
  libraryPreviewObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const fileToken = entry.target?.getAttribute?.('data-library-token')
      if (fileToken) enqueueLibraryPreview(fileToken)
    }
  }, {
    root,
    rootMargin: '160px 0px',
    threshold: 0.01,
  })
  const tiles = root.querySelectorAll('[data-library-token]')
  tiles.forEach((el) => libraryPreviewObserver.observe(el))
}

async function restoreSavedLibraryDirectory({ surfaceError = false, shouldCommit = () => true } = {}) {
  if (typeof window?.cs?.getSavedAiVideoDirectory !== 'function') return false
  try {
    const result = await window.cs.getSavedAiVideoDirectory('input')
    if (!shouldCommit()) return false
    const saved = result?.data || result || null
    const directoryToken = String(saved?.directoryToken || '').trim()
    if (!directoryToken) return false
    libraryDirectoryToken.value = directoryToken
    libraryDirectoryName.value = String(saved?.name || '已授权图库')
    libraryRootSource.value = 'saved'
    return true
  } catch (error) {
    if (surfaceError && shouldCommit()) libraryError.value = error?.message || String(error)
    return false
  }
}

function clearLegacyLibraryCapabilities() {
  for (const key of LEGACY_RENDERER_LIBRARY_CAPABILITY_KEYS) {
    try { window.localStorage?.removeItem(key) } catch { /* best-effort migration cleanup */ }
  }
}

function isPathCapabilityError(error) {
  const code = String(error?.code || error?.response?.code || '').trim().toUpperCase()
  if (code === 'PATH_CAPABILITY_EXPIRED' || code === 'PATH_CAPABILITY_INVALID') return true
  return /capability.*(?:过期|无效|签名|不匹配)|授权.*(?:过期|无效)/i.test(String(error?.message || error || ''))
}

function modelLabel(model) {
  const value = String(model || '')
  if (value.includes('seedance') || value === SEEDANCE_MODEL) return 'Seedance 2.0'
  if (value === KLING_V3_MODEL || value.includes('kling-v3-video-generation')) return 'Kling v3'
  if (value === KLING_OMNI_MODEL || value.includes('kling-v3-omni-video-generation')) return 'Kling Omni'
  if (value === PIXVERSE_MOTIONCONTROL_MODEL || value.includes('pixverse-motioncontrol')) return 'PixVerse Motion Control'
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
  if (job?.model === KLING_V3_MODEL || job?.model === KLING_OMNI_MODEL) {
    if (params.mode) parts.push(params.mode)
    if (params.duration) parts.push(`${params.duration} 秒`)
    if (params.aspect_ratio) parts.push(params.aspect_ratio)
    if (params.audio != null) parts.push(`音频${params.audio ? '开' : '关'}`)
    parts.push(`水印${params.watermark ? '开' : '关'}`)
    return parts.join(' · ')
  }
  if (job?.model === PIXVERSE_MOTIONCONTROL_MODEL) {
    if (params.resolution) parts.push(params.resolution)
    parts.push(`水印${params.watermark ? '开' : '关'}`)
    parts.push(params.imageUrl && params.videoUrl ? '角色图 + 动作视频 URL' : 'URL 待补齐')
    return parts.join(' · ')
  }
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
  if (output.videoFileName) return output.videoFileName
  if (job?.status === 'completed') return '本地 MP4 已归档'
  if (job?.displayStatus === '待归档') return '待重新归档'
  return '等待 provider 完成'
}

function jobLocalVideo(job) {
  return String(job?.currentRun?.output?.localVideoToken || '').trim()
}

function jobRunId(job) {
  return String(job?.currentRun?.id || job?.currentRunId || '').trim()
}

function jobLocalVideoSourceKey(job) {
  if (!jobLocalVideo(job)) return ''
  const output = job?.currentRun?.output || {}
  const runId = jobRunId(job) || `job-${String(job?.id || 'unknown')}`
  const fileName = String(output.videoFileName || 'output.mp4').trim() || 'output.mp4'
  return `video:${runId}:${fileName}`
}

function jobPosterPath(job) {
  return String(job?.currentRun?.output?.localPosterToken || '').trim()
}

function jobCoverCandidatePath(job) {
  const poster = jobPosterPath(job)
  if (poster) return poster
  // Fallback: first input reference image while poster is missing.
  const assets = job?.assets || job?.currentRun?.inputSnapshot?.assets || []
  const first = assets.find(item => item?.fileToken)
  return String(first?.previewToken || first?.fileToken || '').trim()
}

function jobCoverSourceKey(job) {
  const poster = jobPosterPath(job)
  if (poster) {
    const output = job?.currentRun?.output || {}
    const runId = jobRunId(job) || `job-${String(job?.id || 'unknown')}`
    const fileName = String(output.posterFileName || 'poster.jpg').trim() || 'poster.jpg'
    return `poster:${runId}:${fileName}`
  }
  const assets = job?.assets || job?.currentRun?.inputSnapshot?.assets || []
  const index = assets.findIndex(item => item?.fileToken)
  if (index < 0) return ''
  const asset = assets[index] || {}
  const identity = [
    asset.id,
    asset.sha256,
    asset.originalName || asset.name,
    asset.sizeBytes ?? asset.size,
    asset.width,
    asset.height,
    asset.mtimeMs,
    asset.relativePath,
    asset.sortOrder ?? index,
  ].map(value => String(value ?? '').trim()).join(':')
  return `asset:${String(job?.id || 'unknown')}:${identity}`
}

function jobCoverSrc(job) {
  const id = job?.id || ''
  if (!id || brokenCovers[id]) return ''
  return coverUrls[id] || ''
}

function markCoverBroken(job) {
  const id = job?.id
  if (id) {
    brokenCovers[id] = true
    delete coverUrls[id]
  }
}

async function resolvePlayableMediaUrl(filePath) {
  const key = String(filePath || '').trim()
  if (!key) return ''
  if (mediaUrlCache[key]) return mediaUrlCache[key]
  if (typeof window?.cs?.getAiVideoMediaUrl !== 'function') {
    throw new Error('当前版本不支持 AI 视频媒体预览，请完整重启桌面端')
  }
  const response = await window.cs.getAiVideoMediaUrl(key)
  if (response?.ok === false) {
    throw new Error(response?.error || response?.message || '本地媒体预览不可用')
  }
  const mediaUrl = String(response?.media_url || response?.mediaUrl || '').trim()
  if (!mediaUrl) throw new Error(response?.error || '本地媒体预览不可用')
  mediaUrlCache[key] = mediaUrl
  return mediaUrl
}

async function ensureJobCover(job) {
  const id = job?.id || ''
  const candidate = jobCoverCandidatePath(job)
  const sourceKey = jobCoverSourceKey(job)
  if (!id || !candidate || !sourceKey) return
  if (coverUrls[id] && coverSourceKeys[id] === sourceKey) return
  if (coverLoading[id] === sourceKey) return
  const requestId = (coverRequestSequences[id] || 0) + 1
  coverRequestSequences[id] = requestId
  coverSourceKeys[id] = sourceKey
  delete coverUrls[id]
  delete brokenCovers[id]
  coverLoading[id] = sourceKey
  try {
    const src = await resolveLocalImageSrc(candidate, { thumbnail: false })
    if (!src) throw new Error('封面地址为空')
    if (coverRequestSequences[id] !== requestId || coverSourceKeys[id] !== sourceKey) return
    coverUrls[id] = src
    delete brokenCovers[id]
  } catch {
    if (coverRequestSequences[id] !== requestId || coverSourceKeys[id] !== sourceKey) return
    // Mark broken so the card exits the loading spinner and shows fallback.
    brokenCovers[id] = true
    delete coverUrls[id]
  } finally {
    if (coverLoading[id] === sourceKey) delete coverLoading[id]
  }
}

function preloadJobCovers(list = []) {
  for (const job of list) {
    if (!job?.id) continue
    if (jobLocalVideo(job) || jobPosterPath(job) || jobCoverCandidatePath(job)) {
      void ensureJobCover(job)
    }
  }
}

async function loadDetailVideo(job) {
  const requestId = ++detailVideoRequestSequence
  const jobId = String(job?.id || '').trim()
  const videoSourceKey = jobLocalVideoSourceKey(job)
  if (videoSourceKey !== detailVideoRecoverySourceKey) {
    detailVideoRecoverySourceKey = videoSourceKey
    detailVideoRecoveryAttempted = false
  }
  detailVideoSrc.value = ''
  detailVideoError.value = ''
  detailVideoLoading.value = false
  const videoPath = jobLocalVideo(job)
  if (!videoPath || !videoSourceKey) return
  detailVideoLoading.value = true
  try {
    const mediaUrl = await resolvePlayableMediaUrl(videoPath)
    if (!isCurrentDetailVideoRequest(requestId, jobId, videoSourceKey)) return
    detailVideoSrc.value = mediaUrl
    // Ensure poster is ready for the video poster attribute.
    void ensureJobCover(job)
  } catch (error) {
    if (!isCurrentDetailVideoRequest(requestId, jobId, videoSourceKey)) return
    detailVideoError.value = error?.message || String(error)
  } finally {
    if (isCurrentDetailVideoRequest(requestId, jobId, videoSourceKey)) {
      detailVideoLoading.value = false
    }
  }
}

async function handleDetailVideoPlaybackError() {
  const job = detailJob.value
  const sourceKey = jobLocalVideoSourceKey(job)
  const previousToken = jobLocalVideo(job)
  detailVideoSrc.value = ''
  if (!sourceKey || !previousToken) {
    detailVideoLoading.value = false
    detailVideoError.value = '视频播放失败，请尝试打开本地文件。'
    return
  }
  if (detailVideoRecoveryInFlight) return
  if (sourceKey !== detailVideoRecoverySourceKey) {
    detailVideoRecoverySourceKey = sourceKey
    detailVideoRecoveryAttempted = false
  }
  if (detailVideoRecoveryAttempted) {
    detailVideoLoading.value = false
    detailVideoError.value = '视频播放失败，请尝试打开本地文件。'
    return
  }

  detailVideoRecoveryAttempted = true
  detailVideoRecoveryInFlight = true
  detailVideoLoading.value = true
  detailVideoError.value = ''
  delete mediaUrlCache[previousToken]
  try {
    await reloadJobs()
    const latest = detailJob.value
    const latestToken = jobLocalVideo(latest)
    if (!detailVideoSrc.value && latestToken && latestToken !== previousToken) {
      await loadDetailVideo(latest)
    }
    if (!detailVideoSrc.value && !detailVideoError.value) {
      detailVideoError.value = '视频播放失败，请尝试打开本地文件。'
    }
  } catch (error) {
    detailVideoError.value = error?.message || '视频播放失败，请尝试打开本地文件。'
  } finally {
    detailVideoRecoveryInFlight = false
    if (!detailVideoSrc.value) detailVideoLoading.value = false
  }
}

function isCurrentDetailVideoRequest(requestId, jobId, videoSourceKey) {
  return requestId === detailVideoRequestSequence
    && String(detailJob.value?.id || '').trim() === jobId
    && jobLocalVideoSourceKey(detailJob.value) === videoSourceKey
}

function canRetry(job) {
  const error = job?.currentRun?.error || {}
  const code = String(error.code || '').trim().toUpperCase()
  if (['SUBMIT_RESULT_UNKNOWN', 'UNKNOWN_SUBMIT_RESULT'].includes(code)) return false
  if (String(job?.status || '') === 'needs_config') {
    const provider = String(job?.provider || job?.currentRun?.provider || '').includes('happy')
      ? 'happyhorse'
      : 'seedance'
    const providerConfig = config.value?.providers?.[provider]
    return providerConfig?.configured === true && providerConfig?.cliReady === true
  }
  return !canRetryArchive(job)
    && ['failed', 'needs_config', 'expired'].includes(String(job?.status || ''))
    && error.retryable === true
}

function canEdit(job) {
  const code = String(job?.currentRun?.error?.code || '').trim().toUpperCase()
  if (['SUBMIT_RESULT_UNKNOWN', 'UNKNOWN_SUBMIT_RESULT'].includes(code)) return false
  if (canRetryArchive(job)) return false
  return ['draft', 'needs_config', 'failed', 'expired'].includes(String(job?.status || ''))
}

function editActionLabel(job) {
  return String(job?.status || '') === 'draft' ? '编辑草稿' : '编辑并重试'
}

function canDuplicate(job) {
  return ['failed', 'completed', 'expired', 'cancelled'].includes(String(job?.status || ''))
}

function canRetryArchive(job) {
  return job?.displayStatus === '待归档' || job?.currentRun?.archiveStatus === 'archive_failed'
}

function canDelete(job) {
  if (isActiveStatus(job?.status)) return false
  return ['draft', 'needs_config', 'failed', 'expired', 'completed', 'cancelled'].includes(String(job?.status || ''))
}

function canCancelQueuedJob(job) {
  return String(job?.status || '') === 'queued'
    && !String(job?.currentRun?.providerTaskId || '').trim()
}

function isProviderMediaUrl(value) {
  return /^(https?:\/\/|oss:\/\/)/i.test(String(value || '').trim())
}

function klingMediaUrl(type) {
  return String(form.klingMedia.find(item => item.type === type)?.url || '')
}

function setKlingMediaUrl(type, url) {
  const mediaType = String(type || '').trim()
  if (!mediaType) return
  const value = String(url || '').trim()
  const existing = form.klingMedia.find(item => item.type === mediaType)
  if (existing) {
    existing.url = value
  } else {
    form.klingMedia.push({ type: mediaType, url: value })
  }
}

function buildParameters() {
  if (isKling.value) {
    const params = {
      mode: form.klingMode || 'std',
      aspect_ratio: form.ratio || '16:9',
      duration: Number(form.duration || 5),
      audio: Boolean(form.generateAudio),
      watermark: Boolean(form.watermark),
    }
    const media = form.klingMedia
      .map(item => ({
        type: String(item?.type || '').trim(),
        url: String(item?.url || '').trim(),
      }))
      .filter(item => item.type && item.url)
    if (media.length) params.media = media
    return params
  }
  if (isPixVerse.value) {
    return {
      imageUrl: String(form.pixverseImageUrl || '').trim(),
      videoUrl: String(form.pixverseVideoUrl || '').trim(),
      resolution: form.resolution || '720P',
      watermark: Boolean(form.watermark),
    }
  }
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
  if (isPixVerse.value) {
    return form.assets.map((asset, index) => ({
      role: asset.role,
      sourceType: 'local_file',
      fileToken: assetFileToken(asset),
      sortOrder: index,
    })).filter(asset => asset.fileToken && asset.role)
  }
  if (!showReferenceAssets.value) return []
  if (isKling.value) {
    return form.assets.map((asset, index) => ({
      role: asset.role || defaultKlingAssetRole(asset, index),
      sourceType: 'local_file',
      fileToken: assetFileToken(asset),
      sortOrder: index,
    })).filter(asset => asset.fileToken && asset.role)
  }
  const role = isHappyHorse.value && happyHorseMode.value === 'i2v'
    ? 'first_frame'
    : 'reference_image'
  return form.assets.map((asset, index) => ({
    role,
    sourceType: 'local_file',
    fileToken: assetFileToken(asset),
    sortOrder: index,
  })).filter(asset => asset.fileToken)
}

function validateLocal() {
  errors.prompt = ''
  errors.assets = ''
  errors.parameters = ''
  errors.pixverse = ''
  errors.outputDir = ''
  formError.value = ''
  const prompt = String(form.prompt || '').trim()
  if (!isPixVerse.value && !prompt) errors.prompt = 'Prompt 必填。'
  if (prompt.length > 4000) errors.prompt = 'Prompt 不能超过 4000 字符'
  if (isSeedance.value && form.assets.length > 4) {
    errors.assets = 'Seedance 最多支持 4 张参考图。'
  }
  if (isHappyHorse.value && form.assets.length > 9) {
    errors.assets = 'HappyHorse 参考生最多 9 张图。'
  }
  if (isKling.value) {
    for (const item of klingUrlMedia.value) {
      if (!isProviderMediaUrl(item.url)) errors.assets = 'Kling 素材 URL 必须是 HTTP/HTTPS 或百炼 oss:// 地址。'
    }
    const klingMediaRoles = [
      ...form.assets.map(asset => asset.role),
      ...klingUrlMedia.value.map(item => item.type),
    ]
    const firstCount = klingMediaRoles.filter(role => role === 'first_frame').length
    const lastCount = klingMediaRoles.filter(role => role === 'last_frame').length
    const featureCount = klingMediaRoles.filter(role => role === 'feature').length
    const baseCount = klingMediaRoles.filter(role => role === 'base').length
    if (form.provider === 'kling-v3' && klingMediaRoles.some(role => !['first_frame', 'last_frame'].includes(role))) {
      errors.assets = 'Kling v3 素材仅支持首帧图 / 尾帧图。'
    } else if (lastCount && firstCount !== 1) {
      errors.assets = 'Kling 尾帧图必须与 1 张首帧图配对。'
    } else if (firstCount > 1 || lastCount > 1 || featureCount > 1 || baseCount > 1) {
      errors.assets = 'Kling 首帧、尾帧、feature、base 各最多 1 个。'
    }
  }
  if (isPixVerse.value) {
    const hasImageUrl = Boolean(String(form.pixverseImageUrl || '').trim())
    const hasVideoUrl = Boolean(String(form.pixverseVideoUrl || '').trim())
    if (hasImageUrl && !isProviderMediaUrl(form.pixverseImageUrl)) {
      errors.pixverse = 'PixVerse 角色图 URL 必须是 HTTP/HTTPS 或百炼 oss:// 地址。'
    } else if (hasVideoUrl && !isProviderMediaUrl(form.pixverseVideoUrl)) {
      errors.pixverse = 'PixVerse 动作视频 URL 必须是 HTTP/HTTPS 或百炼 oss:// 地址。'
    } else if (hasImageUrl && pixverseImageAsset.value) {
      errors.pixverse = '角色图请在本地素材和 URL 中二选一。'
    } else if (hasVideoUrl && pixverseVideoAsset.value) {
      errors.pixverse = '动作视频请在本地素材和 URL 中二选一。'
    } else if (!hasImageUrl && !pixverseImageAsset.value) {
      errors.pixverse = '请选择本地角色图或填写角色图 URL。'
    } else if (!hasVideoUrl && !pixverseVideoAsset.value) {
      errors.pixverse = '请选择本地动作视频或填写动作视频 URL。'
    }
  }
  if (
    requiredReusedAssetCount.value > form.assets.length
    || (requiredReusedModelId.value && requiredReusedModelId.value !== resolvedModelId.value)
  ) {
    errors.assets = `原任务有 ${requiredReusedAssetCount.value} 张参考图不可用，请重新选择后再生成，避免静默切换模型。`
  }
  const duration = Number(form.duration)
  if (showDuration.value && !Number.isInteger(duration)) errors.parameters = '时长必须是整数'
  else if (isSeedance.value && (duration < 4 || duration > 15)) errors.parameters = 'Seedance 时长需 4-15 秒'
  else if ((isHappyHorse.value || isKling.value) && (duration < 3 || duration > 15)) errors.parameters = `${shortModelLabel.value} 时长需 3-15 秒`
  if (!String(form.outputDirToken || '').trim()) errors.outputDir = '请选择输出目录'
  return !errors.prompt && !errors.assets && !errors.parameters && !errors.pixverse && !errors.outputDir
}

function insertImageRef(index) {
  const token = `[Image ${index}]`
  const current = String(form.prompt || '')
  form.prompt = current ? `${current.trim()} ${token}` : token
}

function addAssetItems(items) {
  const previousMode = isHappyHorse.value
    ? resolveHappyHorseMode(form.assets.length)
    : ''
  const remain = Math.max(0, assetMax.value - form.assets.length)
  const list = (Array.isArray(items) ? items : [items])
    .map(normalizeSelectedAsset)
    .filter(Boolean)
  let added = 0
  for (const asset of list) {
    if (added >= remain) break
    if (form.assets.some(item => assetFileToken(item) === asset.fileToken)) continue
    if (isKling.value && !asset.role) {
      asset.role = defaultKlingAssetRole(asset, form.assets.length)
    }
    form.assets.push(asset)
    if (assetKind(asset) === 'image') void ensureImagePreview(assetPreviewToken(asset))
    added += 1
  }
  syncHappyHorseRatioDefault(previousMode)
  clearReusedAssetGuardWhenRecovered()
  return added
}

async function chooseImages() {
  const selectMedia = window?.cs?.selectAiVideoMedia || window?.cs?.selectAiVideoImages
  if (typeof selectMedia !== 'function') {
    formError.value = '当前环境不支持系统文件选择器'
    return
  }
  const remain = Math.max(0, assetMax.value - form.assets.length)
  if (!remain) {
    formError.value = `最多添加 ${assetMax.value} 张图`
    return
  }
  formError.value = ''
  try {
    const selected = await selectMedia({
      maxCount: remain,
      mediaKind: klingLocalMediaKind.value,
      title: isKling.value ? '选择 Kling 本地素材' : '选择 AI 视频参考图',
    })
    addAssetItems(selected?.items || [])
  } catch (error) {
    formError.value = error?.message || String(error)
  }
}

async function choosePixverseAsset(kind) {
  const mediaKind = kind === 'video' ? 'video' : 'image'
  const role = mediaKind === 'video' ? 'video_url' : 'image_url'
  const selectMedia = window?.cs?.selectAiVideoMedia || window?.cs?.selectAiVideoImages
  if (typeof selectMedia !== 'function') {
    formError.value = '当前环境不支持系统文件选择器'
    return
  }
  formError.value = ''
  try {
    const selected = await selectMedia({
      maxCount: 1,
      mediaKind,
      title: mediaKind === 'video' ? '选择 PixVerse 动作视频' : '选择 PixVerse 角色图',
    })
    const asset = normalizeSelectedAsset((selected?.items || [])[0])
    if (!asset) return
    asset.role = role
    form.assets = form.assets.filter(item => item.role !== role)
    form.assets.push(asset)
    if (assetKind(asset) === 'image') void ensureImagePreview(assetPreviewToken(asset))
  } catch (error) {
    formError.value = error?.message || String(error)
  }
}

async function openImageLibrary(event) {
  libraryTriggerEl.value = event?.currentTarget || document.activeElement
  libraryOpen.value = true
  libraryError.value = ''
  librarySelected.value = []
  libraryQuery.value = ''
  if (!libraryDirectoryToken.value) await restoreSavedLibraryDirectory({ surfaceError: true })
  if (libraryDirectoryToken.value) {
    await scanLibrary(libraryDirectoryToken.value)
  } else {
    libraryItems.value = []
  }
  if (!libraryOpen.value) return
  await nextTick()
  const initialSelector = libraryItems.value.length
    ? '[data-library-token]'
    : '[data-library-root-trigger]'
  const initialControl = libraryModalRef.value?.querySelector?.(initialSelector)
  initialControl?.focus?.()
}

function closeImageLibrary() {
  libraryOpen.value = false
  libraryError.value = ''
  libraryScanSequence += 1
  disconnectLibraryPreviewObserver()
  resetLibraryPreviewGeneration()
  nextTick(() => {
    libraryTriggerEl.value?.focus?.()
    libraryTriggerEl.value = null
  })
}

async function chooseLibraryRoot() {
  if (typeof window?.cs?.selectAiVideoDirectory !== 'function') {
    libraryError.value = '当前环境不支持系统文件夹选择器'
    return
  }
  libraryError.value = ''
  try {
    const directory = await window.cs.selectAiVideoDirectory({
      scope: 'input',
      title: '选择本地参考图库文件夹',
    })
    if (!directory?.directoryToken) return
    libraryDirectoryToken.value = String(directory.directoryToken)
    libraryDirectoryName.value = String(directory.name || '已授权图库')
    libraryRootSource.value = 'manual'
    await scanLibrary(libraryDirectoryToken.value)
  } catch (error) {
    libraryError.value = error?.message || String(error)
  }
}

async function scanLibrary(directoryToken, { allowCapabilityRecovery = true } = {}) {
  const requestId = ++libraryScanSequence
  disconnectLibraryPreviewObserver()
  const previewGeneration = resetLibraryPreviewGeneration()
  libraryLoading.value = true
  libraryError.value = ''
  libraryItems.value = []
  try {
    if (typeof window?.cs?.listAiVideoDirectory !== 'function') {
      throw new Error('当前环境不支持扫描本地目录')
    }
    const result = await window.cs.listAiVideoDirectory(directoryToken, {
      extensions: ['jpg', 'jpeg', 'png', 'webp'],
      maxFiles: 500,
    })
    if (requestId !== libraryScanSequence) return
    if (result?.ok === false) throw new Error(result?.error || '扫描失败')
    const nextItems = (Array.isArray(result?.items) ? result.items : [])
      .map(normalizeSelectedAsset)
      .filter(Boolean)
    registerLibraryPreviewTokens(nextItems, previewGeneration)
    libraryItems.value = nextItems
    // 缩略图 + 视口懒加载：禁止对工作区数百张 10MB 原图做全量 base64。
    await nextTick()
    if (requestId !== libraryScanSequence) return
    observeLibraryTiles()
    // Warm first visible rows immediately.
    for (const item of libraryItems.value.slice(0, 16)) {
      enqueueLibraryPreview(assetPreviewToken(item))
    }
  } catch (error) {
    if (requestId !== libraryScanSequence) return
    if (allowCapabilityRecovery && isPathCapabilityError(error)) {
      const restored = await restoreSavedLibraryDirectory({
        shouldCommit: () => requestId === libraryScanSequence,
      })
      if (requestId !== libraryScanSequence) return
      const refreshedToken = String(libraryDirectoryToken.value || '').trim()
      if (restored && refreshedToken && refreshedToken !== String(directoryToken || '').trim()) {
        await scanLibrary(refreshedToken, { allowCapabilityRecovery: false })
        return
      }
    }
    libraryError.value = error?.message || String(error)
  } finally {
    if (requestId === libraryScanSequence) libraryLoading.value = false
  }
}

function toggleLibraryItem(fileToken) {
  const value = String(fileToken || '').trim()
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
  if (form.assets.some(item => assetFileToken(item) === value)) {
    libraryError.value = '该图片已在当前任务中'
    return
  }
  librarySelected.value.push(value)
  libraryError.value = ''
}

function confirmLibrarySelection() {
  addAssetItems(librarySelected.value
    .map(fileToken => libraryItems.value.find(item => item.fileToken === fileToken))
    .filter(Boolean))
  closeImageLibrary()
}

function removeAsset(index) {
  const previousMode = isHappyHorse.value
    ? resolveHappyHorseMode(form.assets.length)
    : ''
  const [removed] = form.assets.splice(index, 1)
  const removedPreviewToken = assetPreviewToken(removed)
  if (removedPreviewToken && !libraryPreviewTokens.has(removedPreviewToken)) {
    clearImagePreviewCache(removedPreviewToken)
  }
  syncHappyHorseRatioDefault(previousMode)
}

async function chooseOutputDir() {
  if (typeof window?.cs?.selectAiVideoDirectory !== 'function') {
    formError.value = '当前环境不支持系统文件夹选择器'
    return
  }
  formError.value = ''
  try {
    const directory = await window.cs.selectAiVideoDirectory({
      scope: 'output',
      title: '选择 AI 生视频输出目录',
    })
    if (directory?.directoryToken) {
      form.outputDirToken = String(directory.directoryToken)
      outputDirectoryName.value = String(directory.name || '已选输出目录')
      outputDirectorySource.value = 'manual'
    }
  } catch (error) {
    formError.value = error?.message || String(error)
  }
}

async function openOutputFolder() {
  formError.value = ''
  try {
    if (form.outputDirToken && typeof window?.cs?.openAiVideoDirectory === 'function') {
      const result = await window.cs.openAiVideoDirectory(form.outputDirToken)
      if (result?.ok === false) throw new Error(result?.error || result?.message || '打开输出目录失败')
      return
    }
    await chooseOutputDir()
  } catch (error) {
    formError.value = error?.message || String(error)
  }
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
    const draftPayload = {
      provider: backendProvider.value,
      model: resolvedModelId.value,
      prompt: String(form.prompt || '').trim(),
      assets: buildAssetsPayload(),
      parameters: buildParameters(),
      outputDirToken: form.outputDirToken,
    }
    let result
    if (editingDraftJobId.value) {
      const draftJobId = editingDraftJobId.value
      const updated = await window.cs.updateAiVideoJob(draftJobId, draftPayload)
      if (updated?.ok === false) throw new Error(updated?.error?.message || '保存草稿失败')
      result = await window.cs.retryAiVideoJob(draftJobId, { requestUid: requestUid() })
    } else {
      result = await window.cs.createAiVideoJob({
        requestUid: requestUid(),
        ...draftPayload,
      })
    }
    if (result?.ok === false) throw new Error(result?.error?.message || '创建失败')
    const job = result?.data?.job || result?.job
    if (job) upsertJob(job)
    editingDraftJobId.value = ''
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
  const requestId = ++jobsReloadSequence
  jobsReloading += 1
  try {
    const result = await window.cs.listAiVideoJobs({ limit: 50 })
    if (requestId !== jobsReloadSequence) return
    const list = result?.data?.jobs || result?.jobs || []
    jobs.value = Array.isArray(list) ? list : []
    if (detailJob.value?.id) {
      const previousVideoSourceKey = jobLocalVideoSourceKey(detailJob.value)
      const latest = jobs.value.find(item => item.id === detailJob.value.id)
      if (latest) {
        detailJob.value = latest
        const nextVideoToken = jobLocalVideo(latest)
        const nextVideoSourceKey = jobLocalVideoSourceKey(latest)
        if (nextVideoToken && (nextVideoSourceKey !== previousVideoSourceKey || !detailVideoSrc.value)) {
          await loadDetailVideo(latest)
        }
      }
    }
    if (requestId !== jobsReloadSequence) return
    // Clear previous cover failures so refreshed posters can load.
    for (const key of Object.keys(brokenCovers)) delete brokenCovers[key]
    preloadJobCovers(jobs.value)
  } catch (error) {
    if (requestId === jobsReloadSequence) formError.value = error?.message || String(error)
  } finally {
    jobsReloading = Math.max(0, jobsReloading - 1)
  }
}

async function loadConfig() {
  if (typeof window?.cs?.getAiVideoConfig !== 'function') return
  try {
    const result = await window.cs.getAiVideoConfig()
    config.value = result?.data || result || null
    const defaultOutputToken = String(config.value?.defaultOutputDirToken || '').trim()
    if (defaultOutputToken && (!form.outputDirToken || ['', 'default'].includes(outputDirectorySource.value))) {
      form.outputDirToken = defaultOutputToken
      outputDirectoryName.value = String(config.value?.defaultOutputDirName || '')
      outputDirectorySource.value = 'default'
    }
    defaultOutputDirectoryName.value = String(config.value?.defaultOutputDirName || defaultOutputDirectoryName.value)
  } catch (error) {
    formError.value = error?.message || String(error)
  }
}

async function retryJob(job) {
  const jobId = String(job?.id || '').trim()
  if (!jobId || retryingJobIds.has(jobId)) return
  retryingJobIds.add(jobId)
  try {
    const result = await window.cs.retryAiVideoJob(jobId, { requestUid: requestUid() })
    if (result?.ok === false) throw new Error(result?.error?.message || '重试失败')
    await reloadJobs()
  } catch (error) {
    formError.value = error?.message || String(error)
  } finally {
    retryingJobIds.delete(jobId)
  }
}

function isRetryingJob(job) {
  return retryingJobIds.has(String(job?.id || '').trim())
}

async function duplicateJob(job) {
  const jobId = String(job?.id || '').trim()
  if (!jobId || duplicatingJobIds.has(jobId)) return
  duplicatingJobIds.add(jobId)
  try {
    const result = await window.cs.duplicateAiVideoJob(jobId)
    if (result?.ok === false) throw new Error(result?.error?.message || '复制失败')
    const draft = result?.data?.job || result?.job
    if (!draft?.id || draft.status !== 'draft') {
      throw new Error('复制接口未返回可编辑草稿，为避免意外生成已停止后续操作')
    }
    upsertJob(draft)
    editDraft(draft)
    statusFilter.value = 'all'
  } catch (error) {
    formError.value = error?.message || String(error)
  } finally {
    duplicatingJobIds.delete(jobId)
  }
}

function isDuplicatingJob(job) {
  return duplicatingJobIds.has(String(job?.id || '').trim())
}

function reuseParams(job, { editingDraft = false } = {}) {
  if (!job) return
  clearReusedAssetGuard()
  formError.value = ''
  errors.prompt = ''
  errors.assets = ''
  errors.parameters = ''
  errors.pixverse = ''
  errors.outputDir = ''
  form.provider = modelChoiceForJob(job)
  const sourceAssets = Array.isArray(job.assets) ? job.assets : []
  form.assets = sourceAssets
    .map(normalizeSelectedAsset)
    .filter(Boolean)
  if (form.assets.length < sourceAssets.length) {
    requiredReusedAssetCount.value = sourceAssets.length
    requiredReusedModelId.value = String(job.model || '').trim()
    formError.value = `原任务有 ${sourceAssets.length - form.assets.length} 张参考图不可用，请重新选择后再生成。`
  }
  applyProviderDefaults()
  form.prompt = job.prompt || ''
  if (job.outputDirToken) {
    form.outputDirToken = job.outputDirToken
    outputDirectoryName.value = job.outputDirName || outputDirectoryName.value
    outputDirectorySource.value = 'job'
  }
  const params = job.parameters || {}
  if (params.ratio) form.ratio = params.ratio
  if (params.aspect_ratio) form.ratio = params.aspect_ratio
  if (params.resolution) form.resolution = params.resolution
  if (params.duration != null) form.duration = params.duration
  if (params.generateAudio != null) form.generateAudio = Boolean(params.generateAudio)
  if (params.audio != null) form.generateAudio = Boolean(params.audio)
  if (params.mode) form.klingMode = params.mode
  form.klingMedia = Array.isArray(params.media)
    ? params.media.map(item => ({
      type: String(item?.type || '').trim(),
      url: String(item?.url || '').trim(),
    })).filter(item => item.type && item.url)
    : []
  if (params.imageUrl) form.pixverseImageUrl = params.imageUrl
  if (params.videoUrl) form.pixverseVideoUrl = params.videoUrl
  if (params.watermark != null) form.watermark = Boolean(params.watermark)
  for (const asset of form.assets) {
    if (assetKind(asset) === 'image') void ensureImagePreview(assetPreviewToken(asset))
  }
  syncHappyHorseRatioDefault()
  editingDraftJobId.value = editingDraft ? String(job.id || '') : ''
  compactPane.value = 'inputs'
}

function editDraft(job) {
  reuseParams(job, { editingDraft: true })
}

function modelChoiceForJob(job = {}) {
  const model = String(job?.model || '').trim()
  if (model === KLING_V3_MODEL) return 'kling-v3'
  if (model === KLING_OMNI_MODEL) return 'kling-omni'
  if (model === PIXVERSE_MOTIONCONTROL_MODEL) return 'pixverse-motioncontrol'
  if (model.includes('happyhorse') || String(job?.provider || '').includes('happy')) return 'happyhorse'
  return 'seedance'
}

async function retryArchive(job) {
  const runId = String(job?.currentRunId || job?.currentRun?.id || '').trim()
  if (!runId || archivingRunIds.has(runId)) return
  archivingRunIds.add(runId)
  try {
    const result = await window.cs.retryAiVideoArchive(runId)
    if (result?.ok === false) throw new Error(result?.error?.message || '重新归档失败')
    await reloadJobs()
  } catch (error) {
    formError.value = error?.message || String(error)
  } finally {
    archivingRunIds.delete(runId)
  }
}

function isRetryingArchive(job) {
  const runId = String(job?.currentRunId || job?.currentRun?.id || '').trim()
  return Boolean(runId) && archivingRunIds.has(runId)
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

async function cancelQueuedJob(job) {
  if (!canCancelQueuedJob(job)) return
  await deleteJob(job)
}

async function openLocalFile(fileToken) {
  if (!fileToken) return
  if (typeof window?.cs?.openAiVideoFile !== 'function') {
    formError.value = '当前版本不支持安全打开 AI 视频文件，请完整重启桌面端'
    return
  }
  try {
    const result = await window.cs.openAiVideoFile(fileToken)
    if (result?.ok === false) throw new Error(result?.error || result?.message || '打开文件失败')
  } catch (error) {
    formError.value = error?.message || String(error)
  }
}

function openDetail(job, event, returnFocusOverride = null) {
  detailTriggerEl.value = returnFocusOverride || event?.currentTarget || document.activeElement
  detailJob.value = job
  void loadDetailVideo(job)
  nextTick(() => {
    closeDetailBtn.value?.focus?.()
  })
}

function closeDetail() {
  detailVideoRequestSequence += 1
  detailJob.value = null
  detailVideoSrc.value = ''
  detailVideoError.value = ''
  detailVideoLoading.value = false
  detailVideoRecoverySourceKey = ''
  detailVideoRecoveryAttempted = false
  detailVideoRecoveryInFlight = false
  nextTick(() => {
    detailTriggerEl.value?.focus?.()
    detailTriggerEl.value = null
  })
}

function closeHistory() {
  openHistory.value = false
  nextTick(() => historyTriggerEl.value?.focus?.())
}

function openHistoryDrawer(event) {
  historyTriggerEl.value = event?.currentTarget || document.activeElement
  openHistory.value = true
}

function openHistoryItem(job, event) {
  openHistory.value = false
  openDetail(job, event, historyTriggerEl.value)
}

function updateCompact() {
  isCompact.value = window.innerWidth < 1060
}

function onKeydown(event) {
  if (event.key === 'Tab' && detailJob.value) {
    trapDialogFocus(event, modalRef.value)
  } else if (event.key === 'Tab' && libraryOpen.value) {
    trapDialogFocus(event, libraryModalRef.value)
  } else if (event.key === 'Escape' && detailJob.value) {
    event.preventDefault()
    closeDetail()
  } else if (event.key === 'Escape' && libraryOpen.value) {
    event.preventDefault()
    closeImageLibrary()
  } else if (event.key === 'Escape' && openHistory.value) {
    event.preventDefault()
    closeHistory()
  }
}

function startPolling() {
  stopPolling()
  pollTimer.value = window.setInterval(() => {
    const hasActive = jobs.value.some(job => isActiveStatus(job.status))
    if (hasActive && jobsReloading === 0) reloadJobs()
  }, 4000)
}

function stopPolling() {
  if (pollTimer.value) {
    window.clearInterval(pollTimer.value)
    pollTimer.value = null
  }
}

async function activateWorkbench() {
  workbenchActive = true
  const requestId = ++activationSequence
  await loadConfig()
  await restoreSavedLibraryDirectory()
  await reloadJobs()
  if (workbenchActive && requestId === activationSequence) startPolling()
}

function deactivateWorkbench() {
  workbenchActive = false
  activationSequence += 1
  stopPolling()
  disconnectLibraryPreviewObserver()
}

// Re-bind viewport observer when search filter changes or library reopens.
watch([filteredLibraryItems, libraryOpen], async ([, open]) => {
  if (!open) {
    disconnectLibraryPreviewObserver()
    return
  }
  await nextTick()
  observeLibraryTiles()
})

onMounted(() => {
  updateCompact()
  window.addEventListener('resize', updateCompact)
  window.addEventListener('keydown', onKeydown)
  applyProviderDefaults()
  clearLegacyLibraryCapabilities()
})

onActivated(activateWorkbench)
onDeactivated(deactivateWorkbench)

onUnmounted(() => {
  window.removeEventListener('resize', updateCompact)
  window.removeEventListener('keydown', onKeydown)
  deactivateWorkbench()
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

.avg-model-select-card {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  z-index: 2;
}

.avg-model-select-label {
  color: var(--text3);
  font-size: 11px;
  font-weight: 800;
}

.avg-model-select-current {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 10px;
  min-height: 54px;
  padding: 10px;
  border: 1px solid var(--orange-line);
  border-radius: 10px;
  background: var(--orange-soft);
}

.avg-model-select-current strong,
.avg-model-select-current span {
  display: block;
}

.avg-model-select-current strong {
  color: var(--text);
  font-size: 13px;
}

.avg-model-select-current span {
  margin-top: 3px;
  color: var(--text3);
  font-size: 11px;
  line-height: 1.35;
}

.avg-model-select {
  width: 100%;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #20202a;
  color: var(--text);
  padding: 0 34px 0 12px;
  font: inherit;
  font-size: 13px;
  font-weight: 760;
  outline: none;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  color-scheme: dark;
}

.avg-model-select:hover,
.avg-model-select:focus {
  border-color: var(--orange-line);
  background: #242430;
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

.avg-asset-placeholder {
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: 8px;
  display: grid;
  place-items: center;
  border: 1px dashed var(--border);
  background: var(--bg2);
  color: var(--text3);
  font-size: 12px;
  font-weight: 800;
}

.avg-asset-placeholder.video {
  background: #111827;
  color: #fff;
}

.avg-asset-role-select {
  display: grid;
  gap: 4px;
  font-size: 11px;
  color: var(--text3);
}

.avg-asset-role-select select {
  min-height: 30px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #20202a;
  color: var(--text);
  padding: 0 26px 0 9px;
  font-size: 12px;
  font-weight: 740;
  outline: none;
  color-scheme: dark;
}

.avg-asset-role-select select:focus {
  border-color: var(--orange-line);
}

.avg-pixverse-local-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.avg-local-source-card {
  min-height: 68px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: var(--bg3);
  color: var(--text2);
  padding: 10px;
  text-align: left;
  display: grid;
  gap: 4px;
  cursor: pointer;
}

.avg-local-source-card.active {
  border-style: solid;
  border-color: var(--orange-line);
  background: rgba(255, 107, 43, 0.08);
}

.avg-local-source-card-media {
  grid-template-columns: 58px minmax(0, 1fr);
  align-items: center;
  column-gap: 10px;
}

.avg-local-source-card span {
  color: var(--text3);
  font-size: 11px;
  font-weight: 800;
}

.avg-local-source-card-media span {
  grid-column: 2;
}

.avg-local-source-card strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.avg-local-source-card-media strong {
  grid-column: 2;
}

.avg-local-source-card-media img,
.avg-local-source-placeholder {
  grid-row: 1 / span 2;
  width: 58px;
  height: 48px;
  border-radius: 8px;
  object-fit: cover;
  border: 1px solid var(--border);
  background: var(--bg2);
}

.avg-local-source-placeholder {
  display: grid;
  place-items: center;
  color: var(--text3);
  font-size: 11px;
  font-weight: 850;
}

.avg-local-source-placeholder.video {
  background: linear-gradient(135deg, #111827, #242430);
  color: #fff;
}

.avg-section-advanced {
  border-style: dashed;
}

.avg-advanced-panel {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg3);
  overflow: hidden;
}

.avg-advanced-panel summary {
  min-height: 38px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--text2);
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.avg-advanced-panel summary::-webkit-details-marker {
  display: none;
}

.avg-advanced-panel summary::after {
  content: '展开';
  flex: 0 0 auto;
  color: var(--orange);
  font-size: 11px;
  font-weight: 850;
}

.avg-advanced-panel[open] summary {
  border-bottom: 1px solid var(--border);
}

.avg-advanced-panel[open] summary::after {
  content: '收起';
}

.avg-advanced-panel summary span {
  color: var(--text);
  font-size: 12px;
  font-weight: 800;
}

.avg-advanced-panel summary em {
  margin-left: auto;
  color: var(--text3);
  font-size: 11px;
  font-style: normal;
}

.avg-advanced-panel-body {
  padding: 10px;
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
  align-items: start;
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
  grid-template-rows: auto minmax(0, 1fr);
  gap: 6px;
  min-width: 0;
  align-content: start;
}

.avg-library-tile.selected {
  border-color: var(--orange);
  box-shadow: 0 0 0 1px var(--orange-line);
}

/* Fixed 3:4 media box prevents collapsed / striped tiles while thumbs load */
.avg-library-media {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  min-height: 96px;
  overflow: hidden;
  background: #101015;
}

.avg-library-media img,
.avg-library-tile-ph {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  background: #101015;
}

.avg-library-tile-ph {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text3);
  font-size: 11px;
  background: linear-gradient(145deg, #17171f, #0d0d12 55%, #1a1a22);
}

.avg-library-empty {
  display: grid;
  place-content: center;
  gap: 10px;
  padding: 40px 24px;
  text-align: center;
  color: var(--text2);
  min-height: 280px;
}

.avg-library-empty strong {
  font-size: 14px;
  color: var(--text);
}

.avg-library-empty p {
  margin: 0 auto;
  max-width: 420px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text3);
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
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
  max-height: min(92vh, 860px);
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  box-shadow: 0 28px 70px var(--shadow);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}

/* 竖屏任务：加高预览区，侧栏略收，完整显示 9:16 */
.avg-modal.avg-modal-portrait {
  width: min(980px, 100%);
  max-height: min(94vh, 920px);
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
  overflow: hidden;
}

.avg-modal.avg-modal-portrait .avg-modal-body {
  grid-template-columns: minmax(0, 1.1fr) 320px;
}

.avg-modal-preview {
  position: relative;
  min-height: 420px;
  height: min(70vh, 640px);
  max-height: min(70vh, 640px);
  background: #0d0d12;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 0;
}

.avg-modal-preview.is-portrait {
  height: min(82vh, 760px);
  max-height: min(82vh, 760px);
  min-height: 520px;
}

/* 绝对铺满 + contain：竖屏完整显示、横屏同样不裁切 */
.avg-modal-preview video,
.avg-detail-video {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  object-position: center center;
  background: #0d0d12;
}

.avg-modal-preview-pending {
  width: 100%;
  height: 100%;
  min-height: 360px;
  opacity: 0.42;
  background:
    radial-gradient(circle at 30% 40%, rgba(255, 107, 43, 0.18), transparent 40%),
    linear-gradient(160deg, #15151c, #0d0d12 60%);
}

.avg-modal-loading {
  position: relative;
  z-index: 1;
  min-height: 360px;
  width: 100%;
  height: 100%;
}

.avg-thumb-cover {
  object-fit: cover;
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
  .avg-model-select-card,
  .avg-param-row,
  .avg-ref-actions,
  .avg-library-toolbar,
  .avg-detail-meta {
    grid-template-columns: 1fr;
  }
  .avg-pixverse-local-grid { grid-template-columns: 1fr; }
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
