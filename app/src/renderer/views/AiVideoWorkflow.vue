<template>
  <section class="aiv-workbench">
    <header class="aiv-topbar">
      <div>
        <p class="aiv-kicker">AI 视频</p>
        <h2>AI 视频工作流</h2>
        <p class="aiv-subtitle">按款号组织素材、AI 改图、审核、批量生视频和本地下载</p>
      </div>
      <div class="aiv-top-actions">
        <button type="button" class="aiv-ghost" @click="openOutputDir">打开输出目录</button>
      </div>
    </header>

    <nav class="aiv-stepper" aria-label="AI 视频工作流步骤">
      <button
        v-for="step in steps"
        :key="step.id"
        type="button"
        :class="['aiv-step', { active: activeStep === step.id, done: step.done }]"
        :aria-pressed="activeStep === step.id ? 'true' : 'false'"
        @click="selectWorkflowStep(step.id)"
      >
        <span class="aiv-step-index">{{ step.index }}</span>
        <span class="aiv-step-copy">
          <strong>{{ step.title }}</strong>
          <small>{{ step.detail }}</small>
        </span>
      </button>
    </nav>

    <main
      class="aiv-stage"
      :class="{ 'aiv-stage-material-active': activeStep === 'materials', 'aiv-stage-ai-edit-active': activeStep === 'ai-edit' }"
      :inert="hasOpenModal ? '' : null"
      :aria-busy="materialIsRunning ? 'true' : 'false'"
    >
      <section v-if="activeStep === 'materials'" :class="['aiv-stage-grid', 'aiv-material-stage', { 'params-collapsed': !materialPanelExpanded }]">
        <aside :class="['aiv-panel', 'aiv-params-panel', { collapsed: !materialPanelExpanded }]">
          <header class="aiv-panel-head">
            <div v-if="materialPanelExpanded">
              <strong>森马云盘视频素材图下载</strong>
              <span>云盘找图 · 本地规整 · 可恢复任务</span>
            </div>
            <div v-else class="aiv-collapsed-material-summary">
              <strong>找图</strong>
              <span>{{ materialIsRunning ? '进行中' : materialTask.status === 'failed' ? '失败' : '待命' }}</span>
            </div>
            <button
              type="button"
              class="aiv-collapse-action"
              :aria-expanded="materialPanelExpanded"
              aria-controls="aiv-material-params-body"
              @click="materialPanelExpanded = !materialPanelExpanded"
            >
              <span>{{ materialPanelExpanded ? '收起找图' : '展开' }}</span>
              <span class="aiv-collapse-chevron" aria-hidden="true"></span>
            </button>
          </header>
          <div v-show="materialPanelExpanded" id="aiv-material-params-body" class="aiv-panel-body">
            <label class="aiv-field">
              <span>款号</span>
              <textarea v-model="styleCodes" rows="8"></textarea>
            </label>
            <label class="aiv-field">
              <span>云盘搜索根路径</span>
              <input v-model="cloudPath" />
            </label>
            <div class="aiv-field">
              <span>工作区目录</span>
              <button type="button" class="aiv-directory-picker" @click="pickMaterialOutputDirectory">
                <span class="aiv-directory-picker-path" :title="materialOutputDir">
                  {{ materialOutputDir || '请选择 AI 视频工作区目录' }}
                </span>
                <strong>选择文件夹</strong>
              </button>
            </div>
            <label class="aiv-field">
              <span>导出包名称</span>
              <input v-model="materialPackageName" placeholder="可选，留空按时间生成" />
            </label>
            <section class="aiv-progress-overview compact" :class="materialTask.status">
              <div>
                <strong>{{ materialTask.message }}</strong>
                <span>
                  {{ materialTask.completedStyles || 0 }} / {{ materialTask.totalStyles || normalizeStyleCodeLines(styleCodes).length }} 款 ·
                  成功 {{ materialTask.downloaded || materialSummary.modelCount + materialSummary.detailCount }} ·
                  失败 {{ materialTask.failed || materialSummary.failedCount }}
                </span>
              </div>
              <div class="aiv-dual-progress">
                <div class="aiv-progress-line">
                  <span><strong>找款进度</strong><small>{{ materialTask.searchCompleted }} / {{ materialTask.searchTotal || normalizeStyleCodeLines(styleCodes).length }} 款</small></span>
                  <i class="aiv-progress-bar slim" :style="{ '--progress': `${materialTask.searchProgress || 0}%` }"></i>
                </div>
                <div class="aiv-progress-line">
                  <span><strong>下载进度</strong><small>{{ materialTask.downloadCompleted }} / {{ materialTask.downloadTotal }} 张</small></span>
                  <i class="aiv-progress-bar slim" :style="{ '--progress': `${materialTask.downloadProgress || 0}%` }"></i>
                </div>
              </div>
              <button
                v-if="materialTask.error"
                type="button"
                class="aiv-ghost small"
                @click="retryMaterialPrepare"
              >
                重试找图
              </button>
            </section>
            <div class="aiv-action-stack">
              <button
                type="button"
                class="aiv-primary wide"
                :disabled="materialIsRunning"
                @click="startMaterialPrepare"
              >
                {{ materialIsRunning ? '正在找图...' : '开始找图并回显' }}
              </button>
              <span>默认启用最新文件夹、Hash 去重和 20MB 压缩阈值</span>
            </div>
          </div>
        </aside>

        <section class="aiv-panel aiv-material-results-panel">
          <header class="aiv-panel-head">
            <div>
              <strong>素材回显</strong>
              <span>按款号分组选择进入 AI 改图的模拍图和细节图</span>
            </div>
            <span class="aiv-badge orange">已选 {{ selectedMaterialCount }} / {{ materialSummary.modelCount + materialSummary.detailCount }}</span>
          </header>
          <div class="aiv-material-style-tabs" role="tablist" aria-label="素材款号">
            <button
              v-for="item in materialGroups"
              :id="`material-style-tab-${item.styleCode}`"
              :key="item.styleCode"
              type="button"
              role="tab"
              :class="{ active: activeMaterialStyleCode === item.styleCode }"
              :aria-selected="activeMaterialStyleCode === item.styleCode"
              :aria-controls="`material-style-panel-${item.styleCode}`"
              :tabindex="activeMaterialStyleCode === item.styleCode ? 0 : -1"
              @click="selectMaterialStyle(item.styleCode)"
            >
              <strong>{{ item.styleCode }}</strong>
              <span>{{ item.modelPhotos.length }} 模拍 / {{ item.detailPhotos.length }} 细节</span>
            </button>
          </div>

          <div v-if="activeMaterialGroup" class="aiv-material-source-switcher">
            <div class="aiv-material-source-tabs" role="tablist" :aria-label="`${activeMaterialGroup.styleCode} 素材类型`">
              <button
                type="button"
                role="tab"
                :class="{ active: activeMaterialSource === 'model' }"
                :aria-selected="activeMaterialSource === 'model'"
                :aria-controls="`material-model-panel-${activeMaterialGroup.styleCode}`"
                @click="selectMaterialSource('model')"
              >
                模拍图 <strong>{{ activeMaterialGroup.modelPhotos.length }}</strong>
              </button>
              <button
                type="button"
                role="tab"
                :class="{ active: activeMaterialSource === 'detail' }"
                :aria-selected="activeMaterialSource === 'detail'"
                :aria-controls="`material-detail-panel-${activeMaterialGroup.styleCode}`"
                @click="selectMaterialSource('detail')"
              >
                细节图 <strong>{{ activeMaterialGroup.detailPhotos.length }}</strong>
              </button>
            </div>
            <span>{{ activeMaterialSource === 'model' ? '默认优先确认模拍图' : '已切换到细节图' }}</span>
          </div>

          <div class="aiv-panel-body aiv-style-list">
            <article
              v-if="activeMaterialGroup"
              :id="`material-style-panel-${activeMaterialGroup.styleCode}`"
              class="aiv-material-tab-panel"
              role="tabpanel"
              :aria-labelledby="`material-style-tab-${activeMaterialGroup.styleCode}`"
            >
              <div class="aiv-source-board compact single">
                <section
                  v-if="activeMaterialSource === 'model'"
                  :id="`material-model-panel-${activeMaterialGroup.styleCode}`"
                  role="tabpanel"
                >
                  <div class="aiv-source-title">模拍图 · 默认优先</div>
                  <div class="aiv-thumb-grid">
                    <article
                      v-for="asset in visibleMaterialAssets(activeMaterialGroup.styleCode, 'model', activeMaterialGroup.modelPhotos)"
                      :key="asset.id || asset.path"
                      :class="['aiv-thumb', { selected: asset.selected }]"
                      role="button"
                      tabindex="0"
                      :aria-pressed="asset.selected"
                      :aria-label="`${asset.selected ? '取消选择' : '选择'}模拍图 ${asset.name}`"
                      @click="toggleMaterialSelection(asset)"
                      @keydown.enter.prevent="toggleMaterialSelection(asset)"
                      @keydown.space.prevent="toggleMaterialSelection(asset)"
                    >
                      <div class="aiv-thumb-media">
                        <img
                          v-if="thumbnailSourceFor(asset) && !brokenPreviews[thumbnailSourceFor(asset)]"
                          :src="thumbnailSourceFor(asset)"
                          :alt="asset.name"
                          loading="eager"
                          decoding="async"
                          @error="markPreviewBroken(thumbnailSourceFor(asset))"
                        />
                        <template v-else>
                          <strong>{{ asset.role }}</strong>
                          <span>{{ asset.name }}</span>
                          <small>点击卡片选择</small>
                        </template>
                      </div>
                      <span class="aiv-select-ribbon">
                        {{ asset.selected ? '已选' : '选择' }}
                      </span>
                      <button type="button" class="aiv-thumb-zoom" title="查看大图" @click.stop="openImagePreview(asset, activeMaterialGroup.styleCode)">
                        <span aria-hidden="true">⌕</span>
                      </button>
                    </article>
                  </div>
                  <button
                    v-if="remainingMaterialAssetCount(activeMaterialGroup.styleCode, 'model', activeMaterialGroup.modelPhotos)"
                    type="button"
                    class="aiv-load-more"
                    @click="showMoreMaterialAssets(activeMaterialGroup.styleCode, 'model')"
                  >
                    加载更多模拍图（剩余 {{ remainingMaterialAssetCount(activeMaterialGroup.styleCode, 'model', activeMaterialGroup.modelPhotos) }} 张）
                  </button>
                </section>

                <section
                  v-else-if="activeMaterialSource === 'detail'"
                  :id="`material-detail-panel-${activeMaterialGroup.styleCode}`"
                  role="tabpanel"
                >
                  <div class="aiv-source-title">细节图</div>
                  <div class="aiv-thumb-grid">
                    <article
                      v-for="asset in visibleMaterialAssets(activeMaterialGroup.styleCode, 'detail', activeMaterialGroup.detailPhotos)"
                      :key="asset.id || asset.path"
                      :class="['aiv-thumb', { selected: asset.selected, muted: asset.muted }]"
                      role="button"
                      tabindex="0"
                      :aria-pressed="asset.selected"
                      :aria-label="`${asset.selected ? '取消选择' : '选择'}细节图 ${asset.name}`"
                      @click="toggleMaterialSelection(asset)"
                      @keydown.enter.prevent="toggleMaterialSelection(asset)"
                      @keydown.space.prevent="toggleMaterialSelection(asset)"
                    >
                      <div class="aiv-thumb-media">
                        <img
                          v-if="thumbnailSourceFor(asset) && !brokenPreviews[thumbnailSourceFor(asset)]"
                          :src="thumbnailSourceFor(asset)"
                          :alt="asset.name"
                          loading="eager"
                          decoding="async"
                          @error="markPreviewBroken(thumbnailSourceFor(asset))"
                        />
                        <template v-else>
                          <strong>{{ asset.role }}</strong>
                          <span>{{ asset.name }}</span>
                          <small>点击卡片选择</small>
                        </template>
                      </div>
                      <span class="aiv-select-ribbon">
                        {{ asset.selected ? '已选' : '选择' }}
                      </span>
                      <button type="button" class="aiv-thumb-zoom" title="查看大图" @click.stop="openImagePreview(asset, activeMaterialGroup.styleCode)">
                        <span aria-hidden="true">⌕</span>
                      </button>
                    </article>
                  </div>
                  <button
                    v-if="remainingMaterialAssetCount(activeMaterialGroup.styleCode, 'detail', activeMaterialGroup.detailPhotos)"
                    type="button"
                    class="aiv-load-more"
                    @click="showMoreMaterialAssets(activeMaterialGroup.styleCode, 'detail')"
                  >
                    加载更多细节图（剩余 {{ remainingMaterialAssetCount(activeMaterialGroup.styleCode, 'detail', activeMaterialGroup.detailPhotos) }} 张）
                  </button>
                </section>

                <section v-if="activeMaterialGroup.skippedRows?.length" class="aiv-source-issues">
                  <strong>已过滤 / 需复核</strong>
                  <span v-for="row in activeMaterialGroup.skippedRows.slice(0, 4)" :key="row.id">
                    {{ row.role }} · {{ row.name || row.action }} · {{ row.note || row.downloadResult }}
                  </span>
                </section>
              </div>
            </article>
            <div v-if="!materialGroups.length || !materialSummary.modelCount" class="aiv-empty-inline">
              输入款号后点击“开始找图并回显”，这里会按款号显示真实下载素材。
            </div>
          </div>
          <footer class="aiv-page-actions aiv-material-sticky-actions">
            <button type="button" class="aiv-primary" @click="enterAiEditWorkspace">进入 AI 改图</button>
          </footer>
        </section>
      </section>

      <section v-else-if="activeStep === 'ai-edit'" class="aiv-edit-workbench">
        <aside class="aiv-panel aiv-edit-action-panel">
          <header class="aiv-panel-head">
            <div>
              <strong>AI 改图动作</strong>
              <span>选择只表示本次操作范围，不决定审核结果</span>
            </div>
          </header>
          <div class="aiv-panel-body aiv-edit-scroll-body">
            <div class="aiv-action-grid">
              <button
                v-for="action in aiActions"
                :key="action.id"
                type="button"
                :class="['aiv-action-option', { active: activeAction === action.id }]"
                @click="activeAction = action.id"
              >
                <strong>{{ action.title }}</strong>
                <span>{{ action.detail }}</span>
              </button>
            </div>

            <div v-if="activeAction === 'face_swap'" class="aiv-picked-row aiv-selected-model-preview">
              <img
                v-if="selectedModel && previewSourceFor(selectedModel)"
                :src="previewSourceFor(selectedModel)"
                :alt="selectedModel.label"
              />
              <div>
                <span>AI 模特</span>
                <strong>{{ selectedModel?.label || '未选择' }}</strong>
              </div>
              <button type="button" class="aiv-ghost small" @click="openModelLibrary">选择模特</button>
            </div>

            <div v-if="activeAction === 'outfit_swap'" class="aiv-upload-strip vertical">
              <div class="aiv-file-picker">
                <div>
                  <strong>服装图</strong>
                  <span>{{ selectedPathSummary(garmentImagePaths) }}</span>
                </div>
                <button type="button" class="aiv-ghost small" @click="pickOutfitImages('garment')">选择</button>
                <button v-if="garmentImagePaths.length" type="button" class="aiv-ghost small" @click="clearOutfitImages('garment')">清空</button>
              </div>
              <div class="aiv-file-picker">
                <div>
                  <strong>搭配参考图</strong>
                  <span>{{ selectedPathSummary(outfitReferencePaths) }}</span>
                </div>
                <button type="button" class="aiv-ghost small" @click="pickOutfitImages('outfit')">选择</button>
                <button v-if="outfitReferencePaths.length" type="button" class="aiv-ghost small" @click="clearOutfitImages('outfit')">清空</button>
              </div>
              <div class="aiv-file-picker">
                <div>
                  <strong>同款不同色</strong>
                  <span>{{ selectedPathSummary(variantReferencePaths) }}</span>
                </div>
                <button type="button" class="aiv-ghost small" @click="pickOutfitImages('variant')">选择</button>
                <button v-if="variantReferencePaths.length" type="button" class="aiv-ghost small" @click="clearOutfitImages('variant')">清空</button>
              </div>
            </div>

            <details class="aiv-local-material-library" open>
              <summary>
                <span><strong>本地素材库</strong><small>换装与细节参考共用</small></span>
                <span>{{ localMaterialLibraryAssets.length }} 张</span>
              </summary>
              <div class="aiv-reference-kind-switcher">
                <button type="button" :class="{ active: activeLocalReferenceKind === 'garment' }" @click="activeLocalReferenceKind = 'garment'">服装图</button>
                <button type="button" :class="{ active: activeLocalReferenceKind === 'outfit' }" @click="activeLocalReferenceKind = 'outfit'">搭配参考</button>
                <button type="button" :class="{ active: activeLocalReferenceKind === 'variant' }" @click="activeLocalReferenceKind = 'variant'">同款不同色</button>
              </div>
              <div class="aiv-local-material-grid">
                <button
                  v-for="asset in localMaterialLibraryAssets"
                  :key="asset.id || asset.path"
                  type="button"
                  :class="{ selected: localReferenceSelected(asset.path, activeLocalReferenceKind) }"
                  :aria-pressed="localReferenceSelected(asset.path, activeLocalReferenceKind)"
                  @click="toggleLocalReference(asset, activeLocalReferenceKind)"
                >
                  <img v-if="thumbnailSourceFor(asset)" :src="thumbnailSourceFor(asset)" :alt="asset.name" loading="lazy" decoding="async" />
                  <span>{{ asset.role }} · {{ asset.name }}</span>
                </button>
              </div>
            </details>

            <label class="aiv-field">
              <span class="aiv-field-heading">
                {{ activePromptLabel }}
                <button v-if="activeAction === 'pose_swap'" type="button" class="aiv-text-action" @click="promptLibraryTarget = 'workspace'; promptLibraryOpen = true">从 Prompt 库选择</button>
              </span>
              <textarea v-model="aiPrompt" rows="6"></textarea>
            </label>

            <div class="aiv-generation-queue">
              <strong>待生成队列</strong>
              <span>{{ activeActionTitle }} · {{ selectedEditSourceCount }} 张输入图</span>
            </div>
            <div v-if="aiTaskState.error" class="aiv-inline-error">{{ aiTaskState.error }}</div>
          </div>
          <footer class="aiv-edit-sticky-actions">
            <div class="aiv-edit-selection-summary">
              <strong>本次操作 {{ selectedEditSourceCount }} 张图片</strong>
              <span>原图和未删除的 AI 结果会全量进入下一步审核。</span>
            </div>
            <button
              type="button"
              class="aiv-primary wide"
              :disabled="aiIsRunning"
              @click="startAiImageGeneration"
            >
              {{ aiIsRunning ? '正在生图...' : '开始生图' }}
            </button>
            <button type="button" class="aiv-ghost wide" @click="openReviewWorkspace">进入审核</button>
          </footer>
        </aside>

        <section class="aiv-panel aiv-image-workbench">
          <header class="aiv-workspace-head">
            <div>
              <strong>图片工作台</strong>
              <span>按款号分组，支持展开收起；原图在左，AI 修改版本接在后面</span>
            </div>
            <button
              type="button"
              :class="['aiv-ghost', 'small', { active: showSelectedVersionsOnly }]"
              @click="showSelectedVersionsOnly = !showSelectedVersionsOnly"
            >
              {{ showSelectedVersionsOnly ? '显示全部版本' : '只看已选版本' }}
            </button>
          </header>

          <div class="aiv-panel-body aiv-edit-style-list">
            <article v-for="style in styleWorkspaces" :key="style.styleCode" class="aiv-style-card">
              <button
                type="button"
                class="aiv-style-head aiv-collapse-head"
                :aria-expanded="isMaterialExpanded(style.styleCode) ? 'true' : 'false'"
                :aria-controls="`image-workbench-${style.styleCode}`"
                @click="toggleMaterialGroup(style.styleCode)"
              >
                <div class="aiv-style-title-block">
                  <div class="aiv-style-title-row">
                    <strong>{{ style.styleCode }} 图片工作台</strong>
                    <span class="aiv-title-meta">{{ style.modelPhotos.length }} 张模拍 · {{ style.detailPhotos.length }} 张细节 · {{ style.generated.length }} 张 AI 图</span>
                  </div>
                </div>
                <div>
                  <span class="aiv-badge orange">原图 {{ editSourcesForStyle(style).length }}</span>
                  <span class="aiv-badge">版本 {{ versionCountForStyle(style) }}</span>
                  <span class="aiv-collapse-action">
                    {{ isMaterialExpanded(style.styleCode) ? '收起素材' : '展开素材' }}
                    <span class="aiv-collapse-chevron" aria-hidden="true"></span>
                  </span>
                </div>
              </button>

              <div
                v-if="isMaterialExpanded(style.styleCode)"
                :id="`image-workbench-${style.styleCode}`"
                class="aiv-edit-queue"
              >
                <article
                  v-for="source in editSourcesForStyle(style)"
                  :key="source.name"
                  class="aiv-edit-source-row"
                >
                  <article
                    :class="['aiv-original-card', { selected: source.editSelected }]"
                    role="button"
                    tabindex="0"
                    :aria-pressed="Boolean(source.editSelected)"
                    @click="toggleEditInputSelection(source)"
                    @keydown.enter.prevent="toggleEditInputSelection(source)"
                    @keydown.space.prevent="toggleEditInputSelection(source)"
                  >
                    <img
                      v-if="previewSourceFor(source) && !brokenPreviews[previewSourceFor(source)]"
                      :src="previewSourceFor(source)"
                      :alt="source.name"
                      @error="markPreviewBroken(previewSourceFor(source))"
                    />
                    <span class="aiv-origin-label">原图</span>
                    <strong>{{ source.name }}</strong>
                    <small>{{ source.role }} · {{ style.styleCode }}</small>
                    <button type="button" class="aiv-thumb-zoom" title="大图修改" @click.stop="openImageEditor(source, style.styleCode)">
                      <span aria-hidden="true">⌕</span>
                    </button>
                  </article>
                  <div class="aiv-version-rail">
                    <article
                      v-for="version in visibleSourceVersions(source, showSelectedVersionsOnly)"
                      :key="version.id"
                      :class="['aiv-version-card', { selected: version.editSelected, loading: version.status === 'running' }]"
                      role="button"
                      tabindex="0"
                      :aria-pressed="Boolean(version.editSelected)"
                      @click="toggleEditInputSelection(version)"
                      @keydown.enter.prevent="toggleEditInputSelection(version)"
                      @keydown.space.prevent="toggleEditInputSelection(version)"
                    >
                      <span>{{ version.action }}</span>
                      <strong>{{ version.label }}</strong>
                      <small>{{ version.meta }}</small>
                      <i class="aiv-mini-progress" :style="{ '--progress': `${version.progress || 100}%` }"></i>
                      <button type="button" class="aiv-version-edit" title="大图修改" @click.stop="openImageEditor(version, style.styleCode, source)">修改</button>
                      <button type="button" class="aiv-version-delete" title="删除生成结果" @click.stop="requestDeleteGeneratedVersion(style, source, version)">删除生成结果</button>
                    </article>
                    <button type="button" class="aiv-version-card add" @click="activeAction = 'background_swap'">
                      <strong>继续改这张</strong>
                      <small>换脸 / 换背景 / 换装 / 换姿势</small>
                    </button>
                  </div>
                </article>
                <div v-if="!editSourcesForStyle(style).length" class="aiv-empty-inline">
                  本款还没有选中的模拍原图，可回到找图步骤补选。
                </div>
              </div>
            </article>
          </div>
        </section>
      </section>

      <section v-else-if="activeStep === 'review'" class="aiv-review-workbench">
        <section class="aiv-panel">
          <header class="aiv-panel-head">
            <div>
              <strong>AI 结果审核池</strong>
              <span>参考 AI 测图审图看板，支持新增图、通过、舍弃、重试和输出给视频</span>
            </div>
                <div>
                  <span class="aiv-badge success">通过 {{ reviewSummary.approved }}</span>
              <span class="aiv-badge">待审 {{ reviewSummary.pending }}</span>
              <span class="aiv-badge retry">重跑 {{ reviewSummary.retry }}</span>
            </div>
          </header>

          <div class="aiv-review-toolbar">
            <input v-model="reviewFilter" placeholder="筛选款号 / 动作 / 模特 / Prompt" />
            <select v-model="reviewStatusFilter">
              <option value="">全部状态</option>
              <option value="pending">待审</option>
              <option value="approved">已通过</option>
              <option value="rejected">已舍弃</option>
              <option value="retry">需重跑</option>
            </select>
            <button type="button" class="aiv-ghost small" @click="setPendingReviewStatus('approved')">待审全通过</button>
            <button type="button" class="aiv-ghost small danger" @click="setPendingReviewStatus('rejected')">待审全舍弃</button>
            <button type="button" class="aiv-ghost small" @click="refreshReviewBatch">刷新审核池</button>
          </div>

          <div class="aiv-panel-body aiv-review-style-list">
            <article v-for="style in filteredReviewStyles" :key="style.styleCode" class="aiv-review-style-card">
              <div class="aiv-style-head">
                <div>
                  <strong>{{ style.styleCode }}</strong>
                  <span>{{ reviewAssetCount(style, 'origin') }} 张原图 · {{ reviewAssetCount(style, 'ai') }} 张 AI 图 · {{ style.sourceAssets.length }} 张参考素材</span>
                </div>
                <div class="aiv-review-actions">
                  <button type="button" class="aiv-ghost small" @click="setStyleReviewStatus(style, 'approved')">本款全通过</button>
                  <button type="button" class="aiv-ghost small" @click="openAddImageMenu(style.styleCode)">新增图片</button>
                </div>
              </div>

              <section class="aiv-ai-asset-board">
                <article
                  v-for="asset in style.assets"
                  :key="asset.id"
                  :class="['aiv-ai-card', asset.status]"
                >
                  <button type="button" class="aiv-ai-preview" @click="openImagePreview(asset, style.styleCode)">
                    <img
                      v-if="previewSourceFor(asset) && !brokenPreviews[previewSourceFor(asset)]"
                      :src="previewSourceFor(asset)"
                      :alt="asset.label"
                      @error="markPreviewBroken(previewSourceFor(asset))"
                    />
                    <template v-else>
                      <span>{{ asset.label }}</span>
                      <small>{{ asset.action }}</small>
                    </template>
                  </button>
                  <footer>
                    <div>
                      <strong>{{ asset.label }}</strong>
                      <span>{{ asset.meta }}</span>
                    </div>
                    <div class="aiv-ai-actions">
                      <button type="button" class="ok" @click="setReviewAssetStatus(asset, 'approved')">通过</button>
                      <button type="button" class="danger" @click="setReviewAssetStatus(asset, 'rejected')">舍弃</button>
                      <button type="button" @click="requestReviewAssetRetry(asset)">重跑</button>
                    </div>
                  </footer>
                </article>

                <article class="aiv-ai-card add">
                  <button type="button" class="aiv-add-image" @click="openAddImageMenu(style.styleCode)">
                    <strong>新增图片</strong>
                    <span>上传本地图，或继续 AI 换脸/换背景/换装/换姿势</span>
                  </button>
                  <div class="aiv-add-menu" v-if="addImageMenuStyle === style.styleCode">
                    <button type="button">上传本地图</button>
                    <button type="button" @click="activeStep = 'ai-edit'; activeAction = 'face_swap'">AI 换脸</button>
                    <button type="button" @click="activeStep = 'ai-edit'; activeAction = 'background_swap'">AI 换背景</button>
                    <button type="button" @click="activeStep = 'ai-edit'; activeAction = 'outfit_swap'">AI 换装</button>
                    <button type="button" @click="activeStep = 'ai-edit'; activeAction = 'pose_swap'">AI 换姿势</button>
                  </div>
                </article>
              </section>

              <section class="aiv-source-assets-row">
                <strong>主图 / 参考图</strong>
                <button v-for="asset in style.sourceAssets" :key="asset.name" type="button" class="aiv-source-pill">
                  {{ asset.role }} · {{ asset.name }}
                </button>
              </section>
            </article>
          </div>
          <footer class="aiv-page-actions aiv-review-sticky-actions">
            <button type="button" class="aiv-ghost" @click="activeStep = 'ai-edit'">返回 AI 改图</button>
            <button type="button" class="aiv-primary" @click="sendReviewToVideo">输出到视频任务</button>
          </footer>
        </section>
      </section>

      <section v-else-if="activeStep === 'templates'" class="aiv-video-task-workbench">
        <section class="aiv-panel">
          <header class="aiv-video-toolbar">
            <div class="aiv-batch-summary inline">
              <div><strong>{{ videoJobs.length }} 款</strong><span>可建视频任务</span></div>
              <div><strong>{{ totalVideoAssetCount }} 张</strong><span>可选图片素材</span></div>
              <div><strong>{{ videoTasks.length }} 条</strong><span>已建视频任务</span></div>
            </div>
            <div class="aiv-field compact">
              <span>默认输出目录</span>
              <button type="button" class="aiv-directory-picker" @click="pickVideoOutputDirectory">
                <span class="aiv-directory-picker-path" :title="videoOutputDir">
                  {{ videoOutputDir || '请选择 AI 视频工作区目录' }}
                </span>
                <strong>选择文件夹</strong>
              </button>
            </div>
            <button type="button" class="aiv-primary" @click="openVideoTaskDialog()">新增视频任务</button>
            <button type="button" class="aiv-ghost" :disabled="videoIsRunning" @click="runAllVideoTasks('plan')">批量预检</button>
            <button type="button" class="aiv-ghost" :disabled="videoIsRunning" @click="runAllVideoTasks('live')">批量生成并下载</button>
            <button type="button" class="aiv-ghost" @click="downloadCompletedVideoResults">只下载已完成视频</button>
            <button type="button" class="aiv-ghost" @click="activeStep = 'results'">查看结果进度</button>
          </header>
        </section>

        <section class="aiv-video-task-list">
          <article v-for="task in videoTasks" :key="task.id" class="aiv-panel aiv-video-task-card">
            <header class="aiv-panel-head">
              <div>
                <strong>{{ task.styleCode }} · {{ task.title }}</strong>
                <span>{{ task.assets.length }} 张已选素材 · {{ approvedVideoTaskAssetCount(task) }} 张已审核 · {{ task.status }}</span>
              </div>
              <div class="aiv-provider-badges">
                <span :class="['aiv-badge', task.provider !== 'qn' ? 'orange' : '']">{{ providerLabel(task.provider) }}</span>
                <span :class="['aiv-badge', task.template ? 'orange' : '']">
                  {{ task.provider === 'happyhorse' ? happyHorseModeLabel(task.happyhorseMode) : (task.template ? task.template.title : '不选模板') }}
                </span>
              </div>
            </header>
            <div class="aiv-panel-body">
              <div class="aiv-video-task-assets">
                <button
                  v-for="asset in task.assets"
                  :key="asset.id"
                  type="button"
                  :class="['aiv-video-asset-card', 'selected', { pending: asset.status !== 'approved' }]"
                  @click="openImagePreview(asset, task.styleCode)"
                >
                  <img
                    v-if="previewSourceFor(asset) && !brokenPreviews[previewSourceFor(asset)]"
                    :src="previewSourceFor(asset)"
                    :alt="asset.label"
                    @error="markPreviewBroken(previewSourceFor(asset))"
                  />
                  <span :class="['aiv-status-pill', asset.status]">{{ assetStatusLabel(asset.status) }}</span>
                  <strong>{{ asset.label }}</strong>
                  <small>{{ asset.kind }}</small>
                </button>
              </div>
              <div class="aiv-video-task-meta">
                <div><strong>素材组合</strong><span>{{ task.assets.length }} 张图组成一条视频任务</span></div>
                <div><strong>Prompt</strong><span>{{ task.prompt || '生意管家页面生成可不填写 Prompt' }}</span></div>
                <div><strong>输出目录</strong><span>{{ task.outputDir }}</span></div>
              </div>
              <div v-if="task.provider !== 'qn'" class="aiv-seedance-callout">
                <strong>{{ providerLabel(task.provider) }}</strong>
                <span>凭据状态：{{ providerStatusLabel(task.provider) }}；预检不会提交，只有明确授权才会创建外部任务。</span>
                <small v-if="task.provider === 'seedance'">真人儿童图如触发隐私保护，则转为文字描述服装、场景和动作生成原创人物版本。</small>
                <small v-else>图生视频只选 1 张首帧图；参考生视频支持 1-9 张图片，成功后立即下载归档。</small>
              </div>
              <div class="aiv-inline-actions">
                <button type="button" class="aiv-ghost small" @click="openVideoTaskDialog(task.styleCode)">复制新建</button>
                <button v-if="task.provider === 'qn'" type="button" class="aiv-ghost small" @click="openTemplateLibrary(task.styleCode)">查看模板</button>
                <button v-if="task.provider !== 'qn'" type="button" class="aiv-ghost small" @click="openAiCapabilitySettings(task.provider)">打开 AI 能力配置</button>
                <button type="button" class="aiv-ghost small" :disabled="videoIsRunning" @click="runVideoTask(task, 'plan')">提交前预检</button>
                <button type="button" class="aiv-primary" :disabled="videoIsRunning" @click="runVideoTask(task, 'live')">授权生成并下载</button>
              </div>
            </div>
          </article>
          <div v-if="!videoTasks.length" class="aiv-empty-inline">
            先点击“新增视频任务”，为单个款号选择图片、供应商和 Prompt。
          </div>
        </section>
      </section>

      <section v-else class="aiv-stage-grid aiv-result-stage">
        <section class="aiv-panel">
          <header class="aiv-panel-head">
            <div>
              <strong>视频结果</strong>
              <span>展示下载后的本地 MP4、任务状态和批量进度</span>
            </div>
            <div class="aiv-inline-actions">
              <button type="button" class="aiv-ghost small" @click="refreshVideoResults">刷新状态</button>
              <button type="button" class="aiv-ghost small" @click="openOutputDir">打开输出目录</button>
            </div>
          </header>
          <div class="aiv-panel-body">
            <section class="aiv-progress-overview">
              <div>
                <strong>整体进度 {{ overallVideoProgress }}%</strong>
                <span>{{ completedVideoCount }} / {{ videoResults.length }} 个视频任务已完成</span>
              </div>
              <i class="aiv-progress-bar" :style="{ '--progress': `${overallVideoProgress}%` }"></i>
            </section>
            <div class="aiv-result-card-grid">
              <article v-for="item in videoResults" :key="item.id" class="aiv-result-card">
                <div class="aiv-result-preview">
                  <strong>{{ item.styleCode }}</strong>
                  <span>{{ item.provider }}</span>
                </div>
                <div class="aiv-result-copy">
                  <header>
                    <div>
                      <strong>{{ item.styleCode }} · {{ item.template }}</strong>
                      <span>{{ item.taskId }}</span>
                    </div>
                    <span :class="['aiv-badge', item.status === '已完成' ? 'orange' : '']">{{ item.status }}</span>
                  </header>
                  <i class="aiv-progress-bar slim" :style="{ '--progress': `${item.progress}%` }"></i>
                  <p v-if="item.error" class="aiv-result-error">{{ item.error }}</p>
                  <p v-else>{{ item.path }}</p>
                  <footer>
                    <button v-if="videoResultHasOutput(item)" type="button" class="aiv-ghost small" @click="openVideoResult(item)">预览</button>
                    <button v-if="canRetryVideoResult(item)" type="button" class="aiv-ghost small" @click="retryVideoResult(item)">重新下载</button>
                    <button v-if="videoResultHasOutput(item)" type="button" class="aiv-primary small" @click="openVideoResult(item)">打开文件</button>
                    <button
                      v-if="!videoResultHasOutput(item) && !canRetryVideoResult(item)"
                      type="button"
                      class="aiv-primary small"
                      @click="activeStep = 'templates'"
                    >
                      返回生视频
                    </button>
                  </footer>
                </div>
              </article>
            </div>
            <div class="aiv-page-actions">
              <button type="button" class="aiv-ghost" @click="activeStep = 'templates'">返回生视频</button>
              <button type="button" class="aiv-primary" @click="openOutputDir">打开结果目录</button>
            </div>
          </div>
        </section>
      </section>
    </main>

    <div v-if="previewImage" class="aiv-modal" @click.self="closePreview">
      <section
        class="aiv-preview-modal-panel aiv-image-editor-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aiv-preview-title"
        tabindex="-1"
        data-aiv-dialog
        @keydown.esc.prevent="closePreview"
        @keydown="trapDialogFocus"
      >
        <header class="aiv-modal-head">
          <div>
            <strong id="aiv-preview-title">{{ previewImage.title }}</strong>
            <span>{{ previewImage.meta }}</span>
          </div>
          <button type="button" class="aiv-ghost small" @click="closePreview">关闭</button>
        </header>
        <div class="aiv-image-editor-layout">
          <section class="aiv-image-editor-stage">
            <div class="aiv-big-preview">
              <img
                v-if="activePreviewHistoryItem?.src && !brokenPreviews[activePreviewHistoryItem.src]"
                :src="activePreviewHistoryItem.src"
                :alt="activePreviewHistoryItem.label || previewImage.title"
                @error="markPreviewBroken(activePreviewHistoryItem.src)"
              />
              <div v-else>
                <strong>{{ previewImage.title }}</strong>
                <span>{{ previewImage.meta }}</span>
              </div>
              <TldrawAnnotationLayer
                v-if="activePreviewHistoryItem?.src"
                class="aiv-image-annotation-layer"
                :class="{ active: Boolean(previewAnnotationTool) }"
                :image-src="activePreviewHistoryItem.src"
                :image-label="activePreviewHistoryItem.label || previewImage.title"
                :active-tool="previewAnnotationTool"
                :annotation-color="previewAnnotationColor"
                :clear-nonce="previewAnnotationClearNonce"
                :export-nonce="previewAnnotationExportNonce"
                @export-annotation="capturePreviewAnnotation"
                @error="handlePreviewAnnotationError"
              />
              <div class="aiv-image-annotation-toolbar" aria-label="精确标注工具">
                <button type="button" :class="{ active: previewAnnotationTool === 'draw' }" @click="previewAnnotationTool = 'draw'">画笔</button>
                <button type="button" :class="{ active: previewAnnotationTool === 'arrow' }" @click="previewAnnotationTool = 'arrow'">箭头</button>
                <button type="button" :class="{ active: previewAnnotationTool === 'text' }" @click="previewAnnotationTool = 'text'">文字</button>
                <button type="button" @click="clearPreviewAnnotation">清除标注</button>
              </div>
            </div>
            <div class="aiv-preview-history-strip" aria-label="生成历史">
              <strong>生成历史</strong>
              <button
                v-for="(item, index) in previewHistoryItems"
                :key="item.id || item.src || index"
                type="button"
                :class="{ active: previewHistoryIndex === index }"
                @click="previewHistoryIndex = index"
              >
                <img v-if="item.src" :src="item.src" :alt="item.label" />
                <span>{{ item.label }}</span>
              </button>
            </div>
          </section>
          <aside class="aiv-image-editor-tools">
            <strong>大图修改</strong>
            <span>Prompt 和精确标注只作用于当前图片</span>
            <div class="aiv-image-editor-actions">
              <button v-for="action in aiActions" :key="action.id" type="button" :class="{ active: previewEditAction === action.id }" @click="previewEditAction = action.id">
                {{ action.title }}
              </button>
            </div>
            <label class="aiv-field">
              <span>Prompt 修改</span>
              <textarea v-model="previewEditPrompt" rows="8" placeholder="描述只针对当前图片的修改要求"></textarea>
            </label>
            <button v-if="previewEditAction === 'pose_swap'" type="button" class="aiv-ghost wide" @click="promptLibraryTarget = 'preview'; promptLibraryOpen = true">从 Prompt 库选择</button>
            <div v-if="previewEditError" class="aiv-inline-error">{{ previewEditError }}</div>
            <button type="button" class="aiv-primary wide" :disabled="previewEditBusy" @click="runPreviewImageEdit">
              {{ previewEditBusy ? '修改图生成中...' : '生成当前修改' }}
            </button>
          </aside>
        </div>
      </section>
    </div>

    <div v-if="pendingVersionDeletion" class="aiv-modal" @click.self="closeDeleteConfirmation">
      <section
        class="aiv-modal-panel aiv-confirm-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="aiv-delete-title"
        aria-describedby="aiv-delete-description"
        tabindex="-1"
        data-aiv-dialog
        @keydown.esc.prevent="closeDeleteConfirmation"
        @keydown="trapDialogFocus"
      >
        <header class="aiv-modal-head">
          <div>
            <strong id="aiv-delete-title">确认删除本地图片</strong>
            <span>这会真实删除工作区里的 AI 生成文件</span>
          </div>
        </header>
        <div class="aiv-confirm-copy">
          <strong>{{ pendingVersionDeletion.version?.label || '当前 AI 结果' }}</strong>
          <span id="aiv-delete-description">删除后无法撤销，图片也会从工作台、审核池和视频素材池移除。</span>
          <code>{{ pendingVersionDeletion.path }}</code>
          <div v-if="deleteVersionError" class="aiv-inline-error">{{ deleteVersionError }}</div>
        </div>
        <footer class="aiv-modal-foot">
          <span>仅允许删除已授权工作区内的图片文件</span>
          <button type="button" class="aiv-ghost" :disabled="deleteVersionBusy" @click="closeDeleteConfirmation">取消</button>
          <button type="button" class="aiv-danger" :disabled="deleteVersionBusy" @click="confirmDeleteGeneratedVersion">
            {{ deleteVersionBusy ? '正在删除...' : '确认删除' }}
          </button>
        </footer>
      </section>
    </div>

    <PromptLibraryPickerModal
      :open="promptLibraryOpen"
      title="从 Prompt 库选择"
      subtitle="选中后回填当前姿势或大图修改 Prompt。"
      @close="promptLibraryOpen = false"
      @select="applyPromptLibrarySelection"
    />

    <div v-if="modelLibraryOpen" class="aiv-modal" @click.self="closeModelLibrary">
      <section
        class="aiv-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aiv-model-title"
        tabindex="-1"
        data-aiv-dialog
        @keydown.esc.prevent="closeModelLibrary"
        @keydown="trapDialogFocus"
      >
        <header class="aiv-modal-head">
          <div>
            <strong id="aiv-model-title">选择 AI 模特</strong>
            <span>仅 AI 换脸时使用，按年龄和性别分类</span>
          </div>
          <button type="button" class="aiv-ghost small" @click="closeModelLibrary">关闭</button>
        </header>
        <div class="aiv-modal-body">
          <aside class="aiv-modal-filter">
            <strong>年龄段</strong>
            <div class="aiv-filter-chip-row">
              <button type="button" :class="['aiv-chip', { active: !modelAgeFilter }]" @click="modelAgeFilter = ''">全部</button>
              <button v-for="age in modelAgeOptions" :key="age" type="button" :class="['aiv-chip', { active: modelAgeFilter === age }]" @click="modelAgeFilter = age">{{ age }}</button>
            </div>
            <strong>性别</strong>
            <div class="aiv-filter-chip-row">
              <button type="button" :class="['aiv-chip', { active: !modelGenderFilter }]" @click="modelGenderFilter = ''">全部</button>
              <button v-for="gender in modelGenderOptions" :key="gender" type="button" :class="['aiv-chip', { active: modelGenderFilter === gender }]" @click="modelGenderFilter = gender">{{ gender }}</button>
            </div>
            <span v-if="modelLibraryState.loading" class="aiv-filter-note">加载模特库...</span>
            <span v-if="modelLibraryState.error" class="aiv-filter-note error">{{ modelLibraryState.error }}</span>
          </aside>
          <div class="aiv-model-grid">
            <article
              v-for="model in modelSamples"
              :key="model.id"
              :class="['aiv-model-card', { selected: selectedModel?.id === model.id }]"
              role="button"
              tabindex="0"
              :aria-pressed="selectedModel?.id === model.id"
              @click="selectedModel = model"
              @keydown.enter.prevent="selectedModel = model"
              @keydown.space.prevent="selectedModel = model"
            >
              <div class="aiv-model-image">
                <img
                  v-if="!brokenPreviews[model.imageUrl || model.path]"
                  :src="model.imageUrl || localFileUrl(model.path)"
                  :alt="model.name"
                  loading="lazy"
                  decoding="async"
                  @error="markPreviewBroken(model.imageUrl || model.path)"
                />
                    <span v-else>{{ model.ageLabel }} {{ model.gender }}</span>
              </div>
              <div>
                    <strong>{{ model.ageLabel }} · {{ model.gender }}</strong>
                <span>{{ model.name }}</span>
              </div>
            </article>
            <div v-if="!modelLibraryState.loading && !modelSamples.length" class="aiv-empty-inline">
              当前筛选下没有可用模特素材。
            </div>
          </div>
        </div>
        <footer class="aiv-modal-foot">
          <span>{{ selectedModel ? `已选 ${selectedModel.label}` : '请选择一个模特素材' }}</span>
          <button type="button" class="aiv-primary" @click="closeModelLibrary">确认选择</button>
        </footer>
      </section>
    </div>

    <div v-if="templateLibraryOpen" class="aiv-modal" @click.self="closeTemplateLibrary">
      <section
        class="aiv-modal-panel wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aiv-template-title"
        tabindex="-1"
        data-aiv-dialog
        @keydown.esc.prevent="closeTemplateLibrary"
        @keydown="trapDialogFocus"
      >
        <header class="aiv-modal-head">
          <div>
            <strong id="aiv-template-title">生意管家模板库</strong>
            <span>模板可选；不选模板也可以把 AI 图上传生意管家直接生成</span>
          </div>
          <button type="button" class="aiv-ghost small" @click="closeTemplateLibrary">关闭</button>
        </header>
        <div class="aiv-modal-body template">
          <aside class="aiv-modal-filter">
            <button
              v-for="category in templateCategories"
              :key="category"
              type="button"
              :class="['aiv-chip', { active: (!templateFilter && category === '全部') || templateFilter === category }]"
              @click="templateFilter = category === '全部' ? '' : category"
            >
              {{ category }}
            </button>
            <span v-if="templateLibraryState.loading" class="aiv-filter-note">加载模板库...</span>
            <span v-if="templateLibraryState.error" class="aiv-filter-note error">{{ templateLibraryState.error }}</span>
          </aside>
          <div class="aiv-template-grid">
            <article
              v-for="template in filteredTemplateSamples"
              :key="template.id"
              :class="['aiv-template-card', { selected: selectedTemplateId === template.id }]"
              role="button"
              tabindex="0"
              :aria-pressed="selectedTemplateId === template.id"
              @click="selectedTemplateId = template.id"
              @keydown.enter.prevent="selectedTemplateId = template.id"
              @keydown.space.prevent="selectedTemplateId = template.id"
            >
              <video
                v-if="!brokenPreviews[template.video]"
                :src="localFileUrl(template.video)"
                :poster="localFileUrl(template.cover)"
                muted
                controls
                preload="metadata"
                @error="markPreviewBroken(template.video)"
              ></video>
              <div v-else class="aiv-video-fallback">{{ template.title }}</div>
              <div class="aiv-template-copy">
                <strong>{{ template.title }}</strong>
                <p>{{ template.description }}</p>
                <div>
                  <span class="aiv-badge">{{ template.duration }}s</span>
                  <span class="aiv-badge">{{ template.ratio }}</span>
                  <span class="aiv-badge">{{ template.id }}</span>
                </div>
              </div>
            </article>
            <div v-if="!templateLibraryState.loading && !filteredTemplateSamples.length" class="aiv-empty-inline">
              未读取到本地生意管家模板库。
            </div>
          </div>
        </div>
        <footer class="aiv-modal-foot">
          <span>{{ activeTemplateStyle ? `正在为 ${activeTemplateStyle} 选择模板` : '模板库仅在需要时打开' }}</span>
          <button type="button" class="aiv-ghost" @click="clearTemplateSelection">不选模板直接生成</button>
          <button type="button" class="aiv-primary" @click="confirmTemplateSelection">确认模板</button>
        </footer>
      </section>
    </div>

    <div v-if="videoTaskDialogOpen" class="aiv-modal" @click.self="closeVideoTaskDialog">
      <section
        class="aiv-modal-panel wide aiv-video-task-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aiv-video-task-title"
        tabindex="-1"
        data-aiv-dialog
        @keydown.esc.prevent="closeVideoTaskDialog"
        @keydown="trapDialogFocus"
      >
        <header class="aiv-modal-head">
          <div>
            <strong id="aiv-video-task-title">新增视频任务</strong>
            <span>一个款号可以创建多条视频任务；先从素材库选款，再组合图片、Prompt 和生成方式</span>
          </div>
          <button type="button" class="aiv-ghost small" @click="closeVideoTaskDialog">关闭</button>
        </header>
        <div class="aiv-modal-body video-task">
          <section class="aiv-video-style-library">
            <header>
              <strong>选择款号素材库</strong>
              <span>第一步找过图的款号会在这里平铺；一次任务只使用一个款号</span>
            </header>
            <div>
              <button
                v-for="job in videoJobs"
                :key="job.styleCode"
                type="button"
                :class="{ active: videoTaskDraft.styleCode === job.styleCode }"
                :aria-pressed="videoTaskDraft.styleCode === job.styleCode"
                @click="selectVideoTaskStyle(job.styleCode)"
              >
                <strong>{{ job.styleCode }}</strong>
                <span>{{ job.assets.filter(asset => asset.selectable).length }} 张已审核可选 · {{ job.assets.length }} 张可查看</span>
              </button>
            </div>
          </section>
          <aside class="aiv-video-task-form">
            <label class="aiv-field">
              <span>生成方式</span>
              <select v-model="videoTaskDraft.provider" @change="handleVideoProviderChange">
                <option value="qn">生意管家页面生成</option>
                <option value="seedance">Seedance 2.0 API</option>
                <option value="happyhorse">百炼 HappyHorse</option>
              </select>
            </label>
            <label v-if="videoTaskDraft.provider === 'happyhorse'" class="aiv-field">
              <span>HappyHorse 模式</span>
              <select v-model="videoTaskDraft.happyhorseMode" @change="handleHappyHorseModeChange">
                <option value="t2v">文生视频</option>
                <option value="i2v">图生视频</option>
                <option value="r2v">参考生视频</option>
              </select>
            </label>
            <label class="aiv-field">
              <span>Prompt</span>
              <textarea
                v-model="videoTaskDraft.prompt"
                rows="4"
                :placeholder="videoTaskDraft.provider === 'qn' ? '生意管家页面生成可不填写 Prompt' : '描述服装、场景、动作和镜头要求'"
              ></textarea>
            </label>
            <div class="aiv-field">
              <span>输出目录</span>
              <button type="button" class="aiv-directory-picker" @click="pickVideoTaskOutputDirectory">
                <span class="aiv-directory-picker-path" :title="videoTaskDraft.outputDir">
                  {{ videoTaskDraft.outputDir || '请选择 AI 视频工作区目录' }}
                </span>
                <strong>选择文件夹</strong>
              </button>
            </div>
            <div v-if="videoTaskDraft.provider === 'qn'" class="aiv-inline-actions">
              <button type="button" class="aiv-ghost small" @click="openTemplateLibrary(videoTaskDraft.styleCode)">选择生意管家模板</button>
              <button type="button" class="aiv-ghost small" @click="videoTaskDraft.templateId = ''">不选模板</button>
            </div>
            <div v-else class="aiv-seedance-callout">
              <strong>{{ providerLabel(videoTaskDraft.provider) }}</strong>
              <span>凭据状态：{{ providerStatusLabel(videoTaskDraft.provider) }}；预检通过后仍需明确授权才会生成。</span>
              <small v-if="videoTaskDraft.provider === 'seedance'">如触发隐私保护，改用服装、场景和动作文字描述生成原创人物版本。</small>
              <small v-else-if="videoTaskDraft.happyhorseMode === 't2v'">文生视频不需要图片，使用原创人物和场景描述。</small>
              <small v-else-if="videoTaskDraft.happyhorseMode === 'i2v'">图生视频只允许选择 1 张首帧图，画幅跟随图片。</small>
              <small v-else>参考生视频支持 1-9 张图片，可组合模拍图和细节图。</small>
            </div>
          </aside>
          <section class="aiv-video-task-picker">
            <header class="aiv-picker-head">
              <div>
                <strong>{{ videoTaskDraft.styleCode }} 可选图片</strong>
                    <span>只有已审核图片可选择；待审图片只读展示，已舍弃图片不会出现</span>
              </div>
              <span class="aiv-badge orange">已选 {{ selectedVideoTaskAssetCount }}</span>
            </header>
            <div class="aiv-video-task-assets picker">
              <article
                v-for="asset in videoTaskSelectableAssets"
                :key="asset.id"
                :class="['aiv-video-asset-card', { selected: videoTaskDraft.assetIds.includes(asset.id), pending: asset.status !== 'approved' }]"
                    role="button"
                    :tabindex="asset.selectable ? 0 : -1"
                    :disabled="!asset.selectable"
                    :aria-disabled="!asset.selectable"
                    :aria-pressed="videoTaskDraft.assetIds.includes(asset.id)"
                :aria-label="`${videoTaskDraft.assetIds.includes(asset.id) ? '取消选择' : '选择'}视频素材 ${asset.label}`"
                    @click="toggleVideoTaskDraftAsset(asset)"
                    @keydown.enter.prevent="toggleVideoTaskDraftAsset(asset)"
                    @keydown.space.prevent="toggleVideoTaskDraftAsset(asset)"
              >
                <img
                  v-if="previewSourceFor(asset) && !brokenPreviews[previewSourceFor(asset)]"
                  :src="previewSourceFor(asset)"
                  :alt="asset.label"
                  @error="markPreviewBroken(previewSourceFor(asset))"
                />
                <span :class="['aiv-status-pill', asset.status]">{{ assetStatusLabel(asset.status) }}</span>
                <strong>{{ asset.label }}</strong>
                <small>{{ asset.kind }}</small>
                <button
                  type="button"
                  class="aiv-video-asset-zoom"
                  title="查看大图"
                  @click.stop="openImagePreview(asset, videoTaskDraft.styleCode)"
                >
                  <span aria-hidden="true">⌕</span>
                </button>
              </article>
            </div>
          </section>
        </div>
        <footer class="aiv-modal-foot">
          <span>{{ videoTaskDraft.provider === 'qn' ? '生意管家 Prompt 可空，模板可选' : `${providerLabel(videoTaskDraft.provider)} 任务需要明确 Prompt` }}</span>
          <button type="button" class="aiv-ghost" @click="closeVideoTaskDialog">取消</button>
          <button type="button" class="aiv-primary" @click="createVideoTaskFromDraft">创建视频任务</button>
        </footer>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import PromptLibraryPickerModal from '../components/PromptLibraryPickerModal.vue'
import TldrawAnnotationLayer from '../components/TldrawAnnotationLayer.js'
import {
  BALA_AI_IMAGE_TASK_ID,
  BALA_AI_VIDEO_ADAPTER_ID,
  BALA_MATERIAL_PREPARE_TASK_ID,
  BALA_QN_VIDEO_TASK_ID,
  buildBalaAiStageRequest,
  buildBalaMaterialPrepareParams,
  buildBalaReviewWorkspaceStyles,
  buildBalaVideoAssetPool,
  collectVideoResultRows,
  collectDownloadedMaterialRows,
  filterBalaModelLibraryItems,
  formatBalaModelDisplayLabel,
  hasApprovedBalaVideoAsset,
  hasGeneratingBalaReviewAssets,
  isSeedancePrivacyProtectionError,
  isActiveWorkflowStatus,
  latestRunForTaskData,
  mergeBalaReviewWorkspaceStyles,
  mergeBalaWorkspaceVersions,
  migrateBalaBusinessManagerText,
  normalizeBalaMaterialGroups,
  normalizeBalaMaterialProgress,
  normalizeBalaReviewBatchStyles,
  normalizeBalaReviewStatus,
  normalizeStyleCodeLines,
  normalizeBalaTemplateCatalog,
  normalizeBalaVideoTaskProvider,
  normalizeBalaVideoResultRows,
  normalizeWorkflowStageStatus,
  parseBalaMaterialBoardUrl,
  parseBalaReviewBoardUrl,
  parseRunOutputFiles,
  qnTerminalRunFailure,
  qnVideoResultFailure,
  rebaseBalaMaterialRowsToWorkspace,
  restoreBalaImageWorkspaceState,
  selectEditableSourcesForStyle,
  selectNewTaskRun,
  selectVisibleEditableVersions,
  serializeBalaImageWorkspaceState,
  shouldCreateBalaVideoProviderRun,
  summarizeBalaMaterialGroups,
  toBalaBridgeStringArray,
  waitForNewTaskRun,
} from '../utils/balaAiVideoWorkflow'

const emit = defineEmits(['open-settings'])

const BALA_AI_VIDEO_WORKSPACE_STORAGE_KEY = 'crawshrimp.bala-ai-video.workspace-dir'
const BALA_AI_VIDEO_STATE_STORAGE_KEY = 'crawshrimp.bala-ai-video.workflow-state.v1'
const BALA_AI_IMAGE_WORKSPACE_STATE_STORAGE_KEY = 'crawshrimp.bala-ai-video.image-workspace-state.v1'
const MATERIAL_RENDER_CHUNK = 20
let aiImageWorkspaceStateHydrated = false

function loadStoredWorkspaceDir() {
  try {
    return String(localStorage.getItem(BALA_AI_VIDEO_WORKSPACE_STORAGE_KEY) || '').trim()
  } catch {
    return ''
  }
}

const workspaceDir = ref(loadStoredWorkspaceDir())
const materialOutputDir = workspaceDir
const videoOutputDir = workspaceDir

const activeStep = ref('materials')
const activeAction = ref('face_swap')
const materialPanelExpanded = ref(true)
const selectedTemplateId = ref('')
const selectedModel = ref(null)
const showSelectedVersionsOnly = ref(false)
const previewImage = ref(null)
const modelLibraryOpen = ref(false)
const templateLibraryOpen = ref(false)
const videoTaskDialogOpen = ref(false)
const lastFocusedElement = ref(null)
const activeTemplateStyle = ref('')
const addImageMenuStyle = ref('')
const reviewFilter = ref('')
const reviewStatusFilter = ref('')
const promptLibraryOpen = ref(false)
const promptLibraryTarget = ref('workspace')
const activeLocalReferenceKind = ref('garment')
const previewEditAction = ref('background_swap')
const previewEditPrompt = ref('')
const previewEditBusy = ref(false)
const previewEditError = ref('')
const previewHistoryIndex = ref(0)
const previewAnnotationTool = ref('draw')
const previewAnnotationColor = ref('red')
const previewAnnotationClearNonce = ref(0)
const previewAnnotationExportNonce = ref(0)
const pendingVersionDeletion = ref(null)
const deleteVersionBusy = ref(false)
const deleteVersionError = ref('')
const brokenPreviews = reactive({})
const materialBatch = ref(null)
const materialBoardUrl = ref('')
const reviewBatch = ref(null)
const reviewBoardUrl = ref('')
const aiStageRequest = ref(null)
const videoTaskDraft = reactive({
  styleCode: '208326102205',
  provider: 'qn',
  happyhorseMode: 'i2v',
  prompt: '',
  outputDir: workspaceDir.value,
  templateId: '',
  assetIds: [],
})
const materialExpanded = reactive({
  '208326102205': true,
  '208326105214': true,
  '208326108104': false,
})
const materialRenderLimits = reactive({})

const styleCodes = ref('208326102205\n208326105214\n208326108104')
const cloudPath = ref('巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/')
const materialPackageName = ref('')
const aiPrompt = ref('保留童装版型和颜色，画面自然，无文字，无品牌外露风险。')
const garmentImagePaths = ref([])
const outfitReferencePaths = ref([])
const variantReferencePaths = ref([])
const materialTask = reactive({
  status: 'idle',
  message: '等待输入款号后开始找图',
  progress: 0,
  searchProgress: 0,
  downloadProgress: 0,
  currentStyle: '',
  totalStyles: 0,
  completedStyles: 0,
  searchTotal: 0,
  searchCompleted: 0,
  downloadTotal: 0,
  downloadCompleted: 0,
  downloaded: 0,
  failed: 0,
  runId: '',
  error: '',
  logs: [],
  outputFiles: [],
})
const aiTaskState = reactive({
  status: 'idle',
  message: '选择素材和动作后生成预检任务',
  error: '',
  progress: 0,
  runId: '',
  outputFiles: [],
  logs: [],
})
const videoStageState = reactive({
  status: 'idle',
  message: '先创建视频任务，再做预检或等待授权生成',
  error: '',
  progress: 0,
})
const modelLibraryState = reactive({
  loading: false,
  error: '',
  groups: [],
  items: [],
})
const modelAgeFilter = ref('')
const modelGenderFilter = ref('')
const templateLibraryState = reactive({
  loading: false,
  error: '',
  source: '',
})
const templateSamples = reactive([])
const templateFilter = ref('')
const videoProviderStatus = reactive({
  seedance: { configured: false, source: '未配置' },
  happyhorse: { configured: false, source: '未配置' },
})

const stepDefinitions = [
  { id: 'materials', index: 1, title: '找图', detail: '森马云盘素材下载' },
  { id: 'ai-edit', index: 2, title: 'AI 改图', detail: '按款号图片工作台' },
  { id: 'review', index: 3, title: '审核', detail: '新增图、通过和重跑' },
  { id: 'templates', index: 4, title: '生视频', detail: '按款号批量上传生成' },
  { id: 'results', index: 5, title: '结果', detail: '视频下载和回显' },
]

const completedSteps = new Set(['materials'])
const steps = computed(() => stepDefinitions.map(step => ({
  ...step,
  done: completedSteps.has(step.id) && activeStep.value !== step.id,
})))

const aiActions = [
  { id: 'face_swap', title: 'AI 换脸', detail: '选择模特素材库，保留服装版型' },
  { id: 'background_swap', title: 'AI 换背景', detail: '输入背景 Prompt' },
  { id: 'outfit_swap', title: 'AI 换装', detail: '服装图、搭配图、同款不同色参考' },
  { id: 'pose_swap', title: 'AI 换姿势', detail: '输入姿势 Prompt' },
]

const activeActionConfig = computed(() => aiActions.find(action => action.id === activeAction.value) || aiActions[0])
const activeActionTitle = computed(() => activeActionConfig.value.title)
const activeActionDetail = computed(() => activeActionConfig.value.detail)
const activePromptLabel = computed(() => {
  if (activeAction.value === 'background_swap') return '背景 Prompt'
  if (activeAction.value === 'outfit_swap') return '换装补充要求'
  if (activeAction.value === 'pose_swap') return '姿势 Prompt'
  return '换脸补充要求'
})

const styleWorkspaces = reactive(normalizeBalaMaterialGroups({
  fallbackCodes: normalizeStyleCodeLines(styleCodes.value),
}))

const materialGroups = styleWorkspaces
const activeMaterialStyleCode = ref(styleWorkspaces[0]?.styleCode || '')
const activeMaterialSource = ref('model')
const activeMaterialGroup = computed(() => (
  materialGroups.find(item => item.styleCode === activeMaterialStyleCode.value)
  || materialGroups[0]
  || null
))
const materialSummary = computed(() => summarizeBalaMaterialGroups(materialGroups))
const selectedMaterialCount = computed(() => materialSummary.value.selectedCount)
const selectedEditSourceCount = computed(() => (
  styleWorkspaces.reduce((sum, style) => sum + (style.modelPhotos || []).reduce((inner, source) => (
    inner + (source.editSelected ? 1 : 0) + visibleSourceVersions(source).filter(version => version.editSelected).length
  ), 0), 0)
))
const selectedEditVersionCount = computed(() => (
  styleWorkspaces.reduce((sum, style) => (
    sum + editSourcesForStyle(style).reduce((inner, source) => inner + visibleSourceVersions(source).filter(version => version.editSelected).length, 0)
  ), 0)
))

const modelGroups = computed(() => modelLibraryState.groups)
const modelSamples = computed(() => filterBalaModelLibraryItems(modelLibraryState.items, {
  age: modelAgeFilter.value,
  gender: modelGenderFilter.value,
}))
const modelAgeOptions = computed(() => [...new Set([
  ...modelLibraryState.groups.map(group => group.ageLabel),
  ...modelLibraryState.items.map(item => item.ageLabel),
].filter(Boolean))])
const modelGenderOptions = computed(() => [...new Set([
  ...modelLibraryState.groups.map(group => group.gender),
  ...modelLibraryState.items.map(item => item.gender),
].filter(Boolean))])
const localMaterialLibraryAssets = computed(() => {
  const group = activeMaterialGroup.value
  if (!group) return []
  return [...(group.modelPhotos || []), ...(group.detailPhotos || [])]
})
const previewHistoryItems = computed(() => {
  if (!previewImage.value) return []
  const items = Array.isArray(previewImage.value.history) ? previewImage.value.history : []
  return items.filter(item => item && !item.deleted).map(item => ({
    ...item,
    src: previewSourceFor(item),
    label: item.label || item.name || '图片',
  }))
})
const activePreviewHistoryItem = computed(() => {
  const items = previewHistoryItems.value
  if (!items.length) return null
  return items[Math.min(Math.max(previewHistoryIndex.value, 0), items.length - 1)]
})

const reviewStyles = reactive([])

const videoJobs = reactive([])
const videoTasks = reactive([])
const videoResults = reactive([])

function persistAiImageWorkspaceState() {
  if (!aiImageWorkspaceStateHydrated) return
  try {
    localStorage.setItem(
      BALA_AI_IMAGE_WORKSPACE_STATE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        styles: serializeBalaImageWorkspaceState(styleWorkspaces),
      }),
    )
  } catch {
    // Persistence is best-effort; review batches remain the durable fallback.
  }
}

function restoreAiImageWorkspaceState() {
  try {
    const raw = localStorage.getItem(BALA_AI_IMAGE_WORKSPACE_STATE_STORAGE_KEY)
    if (!raw) return false
    const saved = JSON.parse(raw)
    restoreBalaImageWorkspaceState(styleWorkspaces, Array.isArray(saved?.styles) ? saved.styles : [])
    return true
  } catch {
    localStorage.removeItem(BALA_AI_IMAGE_WORKSPACE_STATE_STORAGE_KEY)
    return false
  }
}

function persistedVideoAsset(asset = {}) {
  return {
    id: String(asset.id || ''),
    label: String(asset.label || asset.name || ''),
    name: String(asset.name || ''),
    kind: String(asset.kind || ''),
    operationType: String(asset.operationType || ''),
    status: String(asset.status || ''),
    sourceAssetId: String(asset.sourceAssetId || ''),
    styleCode: String(asset.styleCode || ''),
    path: String(asset.path || ''),
    previewPath: String(asset.previewPath || ''),
    selectable: Boolean(asset.selectable),
  }
}

function persistedVideoTask(task = {}) {
  const template = task.template && typeof task.template === 'object'
    ? {
        id: String(task.template.id || ''),
        title: migrateBalaBusinessManagerText(task.template.title),
        duration: Number(task.template.duration || 0),
        ratio: String(task.template.ratio || ''),
      }
    : null
  return {
    id: String(task.id || ''),
    title: migrateBalaBusinessManagerText(task.title),
    styleCode: String(task.styleCode || ''),
    provider: normalizeBalaVideoTaskProvider(task.provider),
    happyhorseMode: String(task.happyhorseMode || ''),
    prompt: migrateBalaBusinessManagerText(task.prompt),
    outputDir: String(task.outputDir || ''),
    template,
    status: migrateBalaBusinessManagerText(task.status),
    providerTaskId: String(task.providerTaskId || ''),
    runId: String(task.runId || ''),
    assets: (task.assets || []).map(persistedVideoAsset),
  }
}

function persistedVideoResult(item = {}) {
  return {
    id: String(item.id || ''),
    taskRefId: String(item.taskRefId || ''),
    styleCode: String(item.styleCode || ''),
    template: migrateBalaBusinessManagerText(item.template),
    provider: migrateBalaBusinessManagerText(item.provider),
    providerKey: normalizeBalaVideoTaskProvider(item.providerKey || item.provider),
    providerTaskId: String(item.providerTaskId || item.taskId || ''),
    taskId: String(item.taskId || item.providerTaskId || ''),
    providerStatus: migrateBalaBusinessManagerText(item.providerStatus),
    status: migrateBalaBusinessManagerText(item.status),
    progress: Number(item.progress || 0),
    path: String(item.path || ''),
    videoUrl: String(item.videoUrl || ''),
    error: migrateBalaBusinessManagerText(item.error),
  }
}

function persistVideoWorkflowState() {
  try {
    localStorage.setItem(BALA_AI_VIDEO_STATE_STORAGE_KEY, JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      videoTasks: videoTasks.map(persistedVideoTask),
      videoResults: videoResults.map(persistedVideoResult),
    }))
  } catch {
    // Persistence is best-effort; the live task remains available in memory.
  }
}

function restoreVideoWorkflowState() {
  try {
    const raw = localStorage.getItem(BALA_AI_VIDEO_STATE_STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    const tasks = Array.isArray(saved?.videoTasks) ? saved.videoTasks.map(persistedVideoTask).filter(item => item.id) : []
    const results = Array.isArray(saved?.videoResults) ? saved.videoResults.map(persistedVideoResult).filter(item => item.id) : []
    videoTasks.splice(0, videoTasks.length, ...tasks)
    videoResults.splice(0, videoResults.length, ...results)
  } catch {
    localStorage.removeItem(BALA_AI_VIDEO_STATE_STORAGE_KEY)
  }
}

const completedVideoCount = computed(() => videoResults.filter(item => item.status === '已完成').length)
const overallVideoProgress = computed(() => {
  if (!videoResults.length) return 0
  const total = videoResults.reduce((sum, item) => sum + (Number(item.progress) || 0), 0)
  return Math.round(total / videoResults.length)
})
const totalVideoAssetCount = computed(() => (
  videoJobs.reduce((sum, job) => sum + (job.assets || []).length, 0)
))
const activeVideoAssetPool = computed(() => (
  videoJobs.find(job => job.styleCode === videoTaskDraft.styleCode) || videoJobs[0] || { assets: [] }
))
const videoTaskSelectableAssets = computed(() => activeVideoAssetPool.value?.assets || [])
const selectedVideoTaskAssetCount = computed(() => videoTaskDraft.assetIds.length)
const materialIsRunning = computed(() => isActiveWorkflowStatus(materialTask.status))
const aiIsRunning = computed(() => isActiveWorkflowStatus(aiTaskState.status))
const videoIsRunning = computed(() => isActiveWorkflowStatus(videoStageState.status))
const hasOpenModal = computed(() => Boolean(
  previewImage.value || pendingVersionDeletion.value || modelLibraryOpen.value || templateLibraryOpen.value || videoTaskDialogOpen.value || promptLibraryOpen.value,
))
const templateCategories = computed(() => {
  const names = [...new Set(templateSamples.map(item => item.title).filter(Boolean))]
  return ['全部', ...names.slice(0, 8)]
})
const filteredTemplateSamples = computed(() => {
  if (!templateFilter.value) return templateSamples
  return templateSamples.filter(item => item.title === templateFilter.value || String(item.description || '').includes(templateFilter.value))
})
const filteredReviewStyles = computed(() => {
  const keyword = String(reviewFilter.value || '').trim().toLowerCase()
  const status = String(reviewStatusFilter.value || '').trim()
  return reviewStyles.map((style) => {
    const assets = (style.assets || []).filter((asset) => {
      const normalizedStatus = normalizeBalaReviewStatus(asset.status)
      if (status && normalizedStatus !== status) return false
      if (!keyword) return true
      return [
        style.styleCode,
        asset.label,
        asset.action,
        asset.meta,
      ].join(' ').toLowerCase().includes(keyword)
    })
    return { ...style, assets }
  }).filter(style => style.assets.length || !status)
})

let materialPollTimer = null
let materialPollRunId = ''
let aiPollTimer = null
let aiPollRunId = ''
let aiReviewPollToken = 0
let videoPollTimer = null
let previewAnnotationResolve = null
let previewAnnotationReject = null
let previewAnnotationTimer = null

function replaceStyleWorkspaces(groups = []) {
  for (const key of Object.keys(materialRenderLimits)) delete materialRenderLimits[key]
  styleWorkspaces.splice(0, styleWorkspaces.length, ...groups)
  if (!groups.some(group => group.styleCode === activeMaterialStyleCode.value)) {
    activeMaterialStyleCode.value = groups[0]?.styleCode || ''
  }
  activeMaterialSource.value = 'model'
  for (const group of groups) {
    if (!Object.prototype.hasOwnProperty.call(materialExpanded, group.styleCode)) {
      materialExpanded[group.styleCode] = true
    }
  }
}

function selectMaterialStyle(styleCode) {
  const next = String(styleCode || '').trim()
  if (!materialGroups.some(item => item.styleCode === next)) return
  activeMaterialStyleCode.value = next
  activeMaterialSource.value = 'model'
}

function selectMaterialSource(sourceType) {
  activeMaterialSource.value = sourceType === 'detail' ? 'detail' : 'model'
}

function materialRenderKey(styleCode, sourceType) {
  return `${styleCode}:${sourceType}`
}

function materialRenderLimit(styleCode, sourceType) {
  return materialRenderLimits[materialRenderKey(styleCode, sourceType)] || MATERIAL_RENDER_CHUNK
}

function visibleMaterialAssets(styleCode, sourceType, assets = []) {
  return (assets || []).slice(0, materialRenderLimit(styleCode, sourceType))
}

function remainingMaterialAssetCount(styleCode, sourceType, assets = []) {
  return Math.max(0, (assets || []).length - materialRenderLimit(styleCode, sourceType))
}

function showMoreMaterialAssets(styleCode, sourceType) {
  const key = materialRenderKey(styleCode, sourceType)
  materialRenderLimits[key] = materialRenderLimit(styleCode, sourceType) + MATERIAL_RENDER_CHUNK
}

function resetDraftMaterialGroups() {
  if (materialBatch.value || materialTask.status !== 'idle') return
  replaceStyleWorkspaces(normalizeBalaMaterialGroups({
    fallbackCodes: normalizeStyleCodeLines(styleCodes.value),
  }))
}

watch(styleCodes, resetDraftMaterialGroups)

function absoluteApiUrl(value = '') {
  const url = String(value || '').trim()
  if (!url) return ''
  if (/^(https?:|data:|blob:|file:)/i.test(url)) return url
  if (!url.startsWith('/')) return url
  const base = typeof window.cs?.getApiBase === 'function' ? window.cs.getApiBase() : ''
  return `${String(base || '').replace(/\/+$/, '')}${url}`
}

function previewSourceFor(asset = {}) {
  return absoluteApiUrl(asset.imageUrl || asset.image_url) || localFileUrl(asset.path || asset.previewPath || '')
}

function thumbnailSourceFor(asset = {}) {
  return absoluteApiUrl(asset.thumbnailUrl || asset.thumbnail_url) || previewSourceFor(asset)
}

function normalizeModelLibraryItem(item = {}) {
  const displayLabel = formatBalaModelDisplayLabel(item)
  return {
    id: String(item.id || '').trim(),
    group: String(item.group || '').trim(),
    groupLabel: String(item.group_label || item.group || '').trim(),
    ageLabel: String(item.age_label || '').trim(),
    gender: String(item.gender || '').trim(),
    expression: String(item.expression || '').trim(),
    name: displayLabel,
    label: displayLabel,
    imageUrl: absoluteApiUrl(item.image_url || item.imageUrl),
    path: '',
  }
}

async function loadModelLibrary() {
  if (typeof window.cs?.listBalaModelLibrary !== 'function') return
  modelLibraryState.loading = true
  modelLibraryState.error = ''
  try {
    const payload = await window.cs.listBalaModelLibrary({
      age_label: modelAgeFilter.value || '',
      gender: modelGenderFilter.value || '',
    })
    const groupsPayload = payload?.groups && typeof payload.groups === 'object' ? payload.groups : {}
    modelLibraryState.groups = Object.entries(groupsPayload).map(([id, group]) => ({
      id,
      label: String(group?.label || id),
      ageLabel: String(group?.age_label || ''),
      gender: String(group?.gender || ''),
    }))
    modelLibraryState.items = (payload?.items || []).map(normalizeModelLibraryItem).filter(item => item.id)
  } catch (error) {
    modelLibraryState.error = error?.message || String(error)
  } finally {
    modelLibraryState.loading = false
  }
}

async function loadTemplateCatalog() {
  if (typeof window.cs?.listBalaVideoTemplates !== 'function') return
  templateLibraryState.loading = true
  templateLibraryState.error = ''
  try {
    const payload = await window.cs.listBalaVideoTemplates({})
    const templates = normalizeBalaTemplateCatalog(payload)
    templateSamples.splice(0, templateSamples.length, ...templates)
    templateLibraryState.source = String(payload?.source || '')
    if (!selectedTemplateId.value && templates[0]?.id) selectedTemplateId.value = templates[0].id
  } catch (error) {
    templateLibraryState.error = error?.message || String(error)
  } finally {
    templateLibraryState.loading = false
  }
}

watch([modelAgeFilter, modelGenderFilter], () => {
  void loadModelLibrary()
})

function updateMaterialTask(patch = {}) {
  Object.assign(materialTask, patch)
}

function resetMaterialPoll() {
  if (materialPollTimer) clearTimeout(materialPollTimer)
  materialPollTimer = null
}

function scheduleMaterialPoll() {
  resetMaterialPoll()
  materialPollTimer = setTimeout(() => {
    void pollMaterialTask()
  }, 900)
}

function persistWorkspaceDir(path = '') {
  try {
    localStorage.setItem(BALA_AI_VIDEO_WORKSPACE_STORAGE_KEY, String(path || '').trim())
  } catch {
    // The selected path still works for this session when storage is unavailable.
  }
}

function resetMaterialWorkspace() {
  resetMaterialPoll()
  materialPollRunId = ''
  materialBatch.value = null
  materialBoardUrl.value = ''
  for (const key of Object.keys(brokenPreviews)) delete brokenPreviews[key]
  replaceStyleWorkspaces(normalizeBalaMaterialGroups({
    fallbackCodes: normalizeStyleCodeLines(styleCodes.value),
  }))
  updateMaterialTask({
    status: 'idle',
    message: '工作区已切换，请开始找图并回显当前工作区素材。',
    progress: 0,
    searchProgress: 0,
    downloadProgress: 0,
    currentStyle: '',
    totalStyles: 0,
    completedStyles: 0,
    searchTotal: 0,
    searchCompleted: 0,
    downloadTotal: 0,
    downloadCompleted: 0,
    downloaded: 0,
    failed: 0,
    runId: '',
    error: '',
    logs: [],
    outputFiles: [],
  })
}

function applyWorkspaceDirectory(path = '') {
  const next = String(path || '').trim()
  if (!next) return
  const changed = next !== workspaceDir.value
  workspaceDir.value = next
  videoTaskDraft.outputDir = next
  persistWorkspaceDir(next)
  if (changed) resetMaterialWorkspace()
}

async function pickMaterialOutputDirectory() {
  try {
    const selected = await window.cs.selectBalaWorkspace({
      title: '选择 AI 视频工作区目录',
      defaultPath: workspaceDir.value,
    })
    const path = Array.isArray(selected) ? selected[0] : selected
    applyWorkspaceDirectory(path)
  } catch (error) {
    updateMaterialTask({
      status: 'failed',
      error: error?.message || String(error),
      message: `选择导出目录失败：${error?.message || String(error)}`,
    })
  }
}

async function pickVideoOutputDirectory() {
  try {
    const selected = await window.cs.selectBalaWorkspace({
      title: '选择 AI 视频工作区目录',
      defaultPath: workspaceDir.value,
    })
    const path = Array.isArray(selected) ? selected[0] : selected
    applyWorkspaceDirectory(path)
  } catch (error) {
    videoStageState.status = 'failed'
    videoStageState.error = error?.message || String(error)
    videoStageState.message = `选择工作区目录失败：${videoStageState.error}`
  }
}

async function pickVideoTaskOutputDirectory() {
  try {
    const selected = await window.cs.browseFile({
      directory: true,
      title: '选择视频任务输出目录',
      defaultPath: videoTaskDraft.outputDir || workspaceDir.value,
    })
    const path = Array.isArray(selected) ? selected[0] : selected
    if (String(path || '').trim()) videoTaskDraft.outputDir = String(path).trim()
  } catch (error) {
    videoStageState.status = 'failed'
    videoStageState.error = error?.message || String(error)
    videoStageState.message = `选择视频任务输出目录失败：${videoStageState.error}`
  }
}

function materialRunParams() {
  return buildBalaMaterialPrepareParams({
    itemCodes: styleCodes.value,
    cloudPath: cloudPath.value,
    exportFolder: materialOutputDir.value,
    packageName: materialPackageName.value,
  })
}

function applyMaterialLiveStatus(live = {}) {
  const status = normalizeWorkflowStageStatus(live?.status)
  const progress = normalizeBalaMaterialProgress(live)
  const total = progress.searchTotal
  const completed = progress.searchCompleted
  const downloaded = progress.downloaded
  const failed = progress.failed
  updateMaterialTask({
    status,
    progress: status === 'done' ? 100 : Math.round((progress.searchProgress + progress.downloadProgress) / 2),
    searchProgress: status === 'done' ? 100 : progress.searchProgress,
    downloadProgress: status === 'done' && progress.downloadTotal > 0 ? 100 : progress.downloadProgress,
    currentStyle: String(live?.buyer_id || live?.current_buyer_id || '').trim(),
    totalStyles: total,
    completedStyles: completed,
    searchTotal: total,
    searchCompleted: completed,
    downloadTotal: progress.downloadTotal,
    downloadCompleted: progress.downloadCompleted,
    downloaded,
    failed,
    runId: String(live?.run_id || materialTask.runId || '').trim(),
    error: String(live?.error || '').trim(),
    message: materialStatusMessage({ status, total, completed, downloaded, failed, live }),
  })
}

function materialStatusMessage({ status, total, completed, downloaded, failed, live } = {}) {
  if (status === 'failed') return materialTask.error || '找图任务失败，可查看原因后重试失败范围。'
  if (status === 'stopped') return '找图任务已停止，已保留当前已完成结果。'
  if (status === 'done') return `找图完成：${downloaded || 0} 张已下载，${failed || 0} 张失败。`
  if (status === 'partial') return `部分完成：${downloaded || 0} 张已下载，${failed || 0} 张需要重试。`
  if (status === 'running') {
    const phase = String(live?.phase || '').trim()
    const current = String(live?.buyer_id || live?.current_buyer_id || '').trim()
    const parts = []
    if (total > 0) parts.push(`款号 ${completed || 0}/${total}`)
    if (current) parts.push(`当前 ${current}`)
    if (downloaded || failed) parts.push(`下载成功 ${downloaded || 0} / 失败 ${failed || 0}`)
    if (phase) parts.push(`阶段 ${phase}`)
    return parts.join(' · ') || '正在找图和下载素材...'
  }
  return '等待输入款号后开始找图'
}

function isTerminalMaterialStatus(status) {
  return ['done', 'failed', 'stopped', 'partial'].includes(normalizeWorkflowStageStatus(status))
}

async function waitForMaterialRunStart(previousRunId = '', timeoutMs = 12000) {
  return waitForNewTaskRun({
    getStatus: () => window.cs.getTaskStatus(BALA_AI_VIDEO_ADAPTER_ID, BALA_MATERIAL_PREPARE_TASK_ID),
    previousRunId,
    attempts: Math.max(1, Math.ceil(timeoutMs / 300)),
    delayMs: 300,
    sleepFn: sleep,
    errorMessage: '素材下载页面或任务未成功启动，请检查 9222 浏览器登录态后重试。',
  })
}

async function waitForAiImageRunStart(previousRunId = '') {
  return waitForNewTaskRun({
    getStatus: () => window.cs.getTaskStatus(BALA_AI_VIDEO_ADAPTER_ID, BALA_AI_IMAGE_TASK_ID),
    previousRunId,
    sleepFn: sleep,
    errorMessage: 'AI 改图任务未成功启动，请重试。',
  })
}

async function waitForQnVideoRunStart(previousRunId = '') {
  return waitForNewTaskRun({
    getStatus: () => window.cs.getTaskStatus(BALA_AI_VIDEO_ADAPTER_ID, BALA_QN_VIDEO_TASK_ID),
    previousRunId,
    sleepFn: sleep,
    errorMessage: '生意管家视频任务未成功启动，请检查 9222 页面状态后重试。',
  })
}

async function startMaterialPrepare() {
  resetMaterialPoll()
  const params = materialRunParams()
  if (!params.item_codes) {
    updateMaterialTask({ status: 'failed', error: '请先输入至少一个款号', message: '请先输入至少一个款号。' })
    return
  }
  if (!params.cloud_path) {
    updateMaterialTask({ status: 'failed', error: '请填写云盘搜索根路径', message: '请填写云盘搜索根路径。' })
    return
  }
  if (!params.export_folder) {
    updateMaterialTask({ status: 'failed', error: '请先选择 AI 视频工作区目录', message: '请先选择 AI 视频工作区目录。' })
    return
  }
  const previousStatus = await window.cs.getTaskStatus(
    BALA_AI_VIDEO_ADAPTER_ID,
    BALA_MATERIAL_PREPARE_TASK_ID,
  ).catch(() => null)
  const previousRunId = String(
    previousStatus?.live?.run_id || previousStatus?.last_run?.id || '',
  ).trim()
  updateMaterialTask({
    status: 'running',
    message: '正在提交素材下载任务...',
    progress: 0,
    searchProgress: 0,
    downloadProgress: 0,
    currentStyle: '',
    totalStyles: normalizeStyleCodeLines(params.item_codes).length,
    completedStyles: 0,
    searchTotal: normalizeStyleCodeLines(params.item_codes).length,
    searchCompleted: 0,
    downloadTotal: 0,
    downloadCompleted: 0,
    downloaded: 0,
    failed: 0,
    runId: '',
    error: '',
    logs: [],
    outputFiles: [],
  })
  try {
    const result = await window.cs.runTask(BALA_AI_VIDEO_ADAPTER_ID, BALA_MATERIAL_PREPARE_TASK_ID, params, {})
    if (!result?.ok) throw new Error(result?.message || result?.error || '素材下载任务启动失败')
    const launch = await waitForMaterialRunStart(previousRunId)
    materialPollRunId = launch.runId
    updateMaterialTask({ runId: materialPollRunId })
    const launchSnapshot = launch.source === 'live'
      ? launch.snapshot
      : {
          ...launch.snapshot,
          run_id: launch.runId,
          records: launch.snapshot?.records_count,
        }
    applyMaterialLiveStatus(launchSnapshot)
    if (launch.status === 'failed') {
      throw new Error(launch.snapshot?.error || '素材下载页面或任务未成功启动，请检查 9222 浏览器登录态后重试。')
    }
    if (isTerminalMaterialStatus(launch.status)) {
      await finalizeMaterialTask(materialPollRunId)
      return
    }
    await pollMaterialTask()
  } catch (error) {
    updateMaterialTask({
      status: 'failed',
      error: error?.message || String(error),
      message: error?.message || String(error),
    })
  }
}

async function restoreLatestMaterialTask() {
  try {
    const status = await window.cs.getTaskStatus(BALA_AI_VIDEO_ADAPTER_ID, BALA_MATERIAL_PREPARE_TASK_ID)
    const live = status?.live
    const liveRunId = String(live?.run_id || '').trim()
    if (liveRunId && isActiveWorkflowStatus(live?.status)) {
      materialPollRunId = liveRunId
      applyMaterialLiveStatus(live)
      scheduleMaterialPoll()
      return
    }
    const last = status?.last_run
    const lastRunId = String(last?.id || last?.run_id || '').trim()
    if (!lastRunId || !isTerminalMaterialStatus(last?.status)) return
    materialPollRunId = lastRunId
    applyMaterialLiveStatus({
      ...last,
      run_id: lastRunId,
      records: last?.records_count,
    })
    if (normalizeWorkflowStageStatus(last?.status) === 'done' || normalizeWorkflowStageStatus(last?.status) === 'partial') {
      await finalizeMaterialTask(lastRunId)
      return
    }
    updateMaterialTask({
      error: String(last?.error || '').trim(),
      message: String(last?.error || materialTask.message).trim(),
    })
  } catch (error) {
    updateMaterialTask({
      status: 'failed',
      error: error?.message || String(error),
      message: `恢复最近素材任务失败：${error?.message || String(error)}`,
    })
  }
}

async function pollMaterialTask() {
  try {
    const status = await window.cs.getTaskStatus(BALA_AI_VIDEO_ADAPTER_ID, BALA_MATERIAL_PREPARE_TASK_ID)
    const logPayload = await window.cs.getTaskLogs(BALA_AI_VIDEO_ADAPTER_ID, BALA_MATERIAL_PREPARE_TASK_ID).catch(() => null)
    if (Array.isArray(logPayload?.logs)) materialTask.logs = logPayload.logs.slice(-80)
    const live = status?.live
    if (live && (!materialPollRunId || String(live.run_id || '') === materialPollRunId)) {
      applyMaterialLiveStatus(live)
      if (!isTerminalMaterialStatus(live.status)) {
        scheduleMaterialPoll()
        return
      }
      await finalizeMaterialTask(String(live.run_id || materialPollRunId || ''))
      return
    }

    const last = status?.last_run
    if (last && (!materialPollRunId || String(last.id || '') === materialPollRunId)) {
      applyMaterialLiveStatus({
        ...last,
        status: last.status,
        run_id: last.id,
        records: last.records_count,
      })
      if (isTerminalMaterialStatus(last.status)) {
        await finalizeMaterialTask(String(last.id || materialPollRunId || ''))
        return
      }
    }
    scheduleMaterialPoll()
  } catch (error) {
    updateMaterialTask({
      status: 'failed',
      error: error?.message || String(error),
      message: `读取任务状态失败：${error?.message || String(error)}`,
    })
  }
}

async function readRowsFromOutputFiles(files = []) {
  const rows = []
  for (const file of files.filter(file => /\.(xlsx|xls)$/i.test(String(file || ''))).slice(0, 3)) {
    try {
      const payload = await window.cs.readExcel(file)
      if (Array.isArray(payload?.rows)) rows.push(...payload.rows)
    } catch (error) {
      materialTask.logs.push(`读取结果表失败：${error?.message || String(error)}`)
    }
  }
  return rows
}

async function finalizeMaterialTask(runId = '') {
  resetMaterialPoll()
  const data = await window.cs.getData(BALA_AI_VIDEO_ADAPTER_ID, BALA_MATERIAL_PREPARE_TASK_ID)
  const run = latestRunForTaskData(data, runId || materialTask.runId)
  const outputFiles = parseRunOutputFiles(run?.output_files)
  const sourceRows = await readRowsFromOutputFiles(outputFiles)
  const rows = rebaseBalaMaterialRowsToWorkspace({
    rows: sourceRows,
    outputFiles,
    workspaceDir: workspaceDir.value,
  })
  if (sourceRows.length && !rows.length) {
    materialTask.logs.push('最近素材任务不属于当前工作区，已忽略旧目录中的素材。')
  }
  const downloadedRows = collectDownloadedMaterialRows({ rows })
  let batch = null
  if (downloadedRows.length && typeof window.cs.createBalaMaterialBatch === 'function') {
    try {
      batch = await window.cs.createBalaMaterialBatch(downloadedRows, {
        adapter_id: BALA_AI_VIDEO_ADAPTER_ID,
        task_id: BALA_MATERIAL_PREPARE_TASK_ID,
        run_id: runId || materialTask.runId,
      })
      materialBatch.value = batch
      materialBoardUrl.value = String(batch?.board_url || '')
    } catch (error) {
      materialTask.logs.push(`创建素材审核批次失败，已回退到本地结果回显：${error?.message || String(error)}`)
    }
  }
  const rowStyleCodes = [...new Set(rows
    .map(row => String(row?.输入款号 || row?.款号 || row?.style_code || '').trim())
    .filter(Boolean))]
  if (rowStyleCodes.length) styleCodes.value = rowStyleCodes.join('\n')
  const groups = normalizeBalaMaterialGroups({
    batch,
    rows,
    fallbackCodes: rowStyleCodes.length ? rowStyleCodes : normalizeStyleCodeLines(styleCodes.value),
  })
  replaceStyleWorkspaces(groups)
  const summary = summarizeBalaMaterialGroups(groups)
  const nextStatus = summary.failedCount > 0 ? 'partial' : 'done'
  updateMaterialTask({
    status: nextStatus,
    progress: 100,
    searchProgress: 100,
    downloadProgress: downloadedRows.length ? 100 : 0,
    searchTotal: rowStyleCodes.length || summary.styleCount,
    searchCompleted: rowStyleCodes.length || summary.styleCount,
    downloadTotal: downloadedRows.length + summary.failedCount,
    downloadCompleted: downloadedRows.length + summary.failedCount,
    outputFiles,
    downloaded: summary.modelCount + summary.detailCount,
    failed: summary.failedCount,
    message: rows.length && summary.styleCount
      ? `找图完成：${summary.styleCount} 个款号，${summary.modelCount} 张模拍，${summary.detailCount} 张细节。`
      : (sourceRows.length
          ? '最近任务不属于当前工作区，请在当前工作区重新开始找图。'
          : '找图完成，但没有可进入下一步的素材。'),
  })
}

async function retryMaterialPrepare() {
  await startMaterialPrepare()
}

function openAddImageMenu(styleCode) {
  addImageMenuStyle.value = addImageMenuStyle.value === styleCode ? '' : styleCode
}

function isMaterialExpanded(styleCode) {
  return materialExpanded[styleCode] !== false
}

function toggleMaterialGroup(styleCode) {
  materialExpanded[styleCode] = !isMaterialExpanded(styleCode)
}

function toggleMaterialSelection(asset) {
  asset.selected = !asset.selected
}

function toggleVersionSelection(version) {
  toggleEditInputSelection(version)
}

function toggleEditInputSelection(asset) {
  asset.editSelected = !asset.editSelected
}

function enterAiEditWorkspace() {
  for (const style of styleWorkspaces) {
    for (const source of style.modelPhotos || []) {
      source.editSelected = false
      for (const version of source.versions || []) version.editSelected = false
    }
  }
  activeStep.value = 'ai-edit'
}

function visibleSourceVersions(source = {}, selectedOnly = false) {
  return selectVisibleEditableVersions(source, selectedOnly)
}

function requestDeleteGeneratedVersion(style, source, version) {
  const filePath = String(version?.previewPath || version?.path || '').trim()
  pendingVersionDeletion.value = { style, source, version, path: filePath }
  deleteVersionBusy.value = false
  deleteVersionError.value = filePath ? '' : '当前结果没有可删除的本地图片文件'
}

function closeDeleteConfirmation() {
  if (deleteVersionBusy.value) return
  pendingVersionDeletion.value = null
  deleteVersionError.value = ''
}

function sameDeletedVersion(asset, target) {
  if (!asset || !target) return false
  const targetId = String(target.id || '').trim()
  const targetPath = String(target.previewPath || target.path || '').trim()
  const assetId = String(asset.id || '').replace(/^vasset-/, '').trim()
  const assetPath = String(asset.previewPath || asset.path || '').trim()
  return Boolean((targetId && (asset.id === targetId || assetId === targetId)) || (targetPath && assetPath === targetPath))
}

function purgeDeletedGeneratedVersion({ style, source, version }) {
  const sourceVersions = Array.isArray(source?.versions) ? source.versions : []
  const sourceIndex = sourceVersions.findIndex(item => sameDeletedVersion(item, version))
  if (sourceIndex >= 0) sourceVersions.splice(sourceIndex, 1)

  for (const reviewStyle of reviewStyles) {
    reviewStyle.assets = (reviewStyle.assets || []).filter(asset => !sameDeletedVersion(asset, version))
  }
  for (const job of videoJobs) {
    job.assets = (job.assets || []).filter(asset => !sameDeletedVersion(asset, version))
  }
  for (const task of videoTasks) {
    task.assets = (task.assets || []).filter(asset => !sameDeletedVersion(asset, version))
  }
  videoTaskDraft.assetIds = videoTaskDraft.assetIds.filter((assetId) => !sameDeletedVersion({ id: assetId }, version))

  if (previewImage.value?.history) {
    previewImage.value.history = previewImage.value.history.filter(item => !sameDeletedVersion(item, version))
    previewHistoryIndex.value = Math.max(0, Math.min(previewHistoryIndex.value, previewImage.value.history.length - 1))
  }
  if (style?.styleCode) buildVideoJobsFromReview()
}

async function confirmDeleteGeneratedVersion() {
  const target = pendingVersionDeletion.value
  if (!target || deleteVersionBusy.value) return
  if (!target.path) {
    deleteVersionError.value = '当前结果没有可删除的本地图片文件'
    return
  }
  if (!workspaceDir.value) {
    deleteVersionError.value = '请先使用第一步的系统文件夹选择器选择工作区'
    return
  }
  deleteVersionBusy.value = true
  deleteVersionError.value = ''
  try {
    if (!target.localDeleted) {
      await window.cs.deleteBalaWorkspaceImage(workspaceDir.value, target.path)
      target.localDeleted = true
    }
    const reviewAsset = reviewStyles
      .flatMap(style => style.assets || [])
      .find(asset => asset.kind === 'ai' && sameDeletedVersion(asset, target.version))
    const remoteAssetId = String(reviewAsset?.remoteAssetId || '').trim()
    const boardUrl = reviewAsset?.reviewBoardUrl
    const ref = parseBalaReviewBoardUrl(boardUrl)
    if (reviewAsset && remoteAssetId && ref) {
      const batch = await window.cs.deleteBalaReviewAsset(
        ref.batchId,
        ref.token,
        remoteAssetId,
      )
      reviewBatch.value = batch
    }
    purgeDeletedGeneratedVersion(target)
    updateAiTaskState({
      status: 'done',
      error: '',
      message: `已删除本地图片并移出工作流：${target.version?.label || 'AI 结果'}`,
    })
    pendingVersionDeletion.value = null
  } catch (error) {
    const detail = error?.message || String(error)
    deleteVersionError.value = target.localDeleted
      ? `本地图片已删除，但审核池同步失败，请再次确认重试：${detail}`
      : detail
  } finally {
    deleteVersionBusy.value = false
  }
}

function referencePathsForKind(kind) {
  if (kind === 'garment') return garmentImagePaths
  if (kind === 'variant') return variantReferencePaths
  return outfitReferencePaths
}

function localReferenceSelected(path, kind) {
  return referencePathsForKind(kind).value.includes(String(path || '').trim())
}

function toggleLocalReference(asset, kind) {
  const path = String(asset?.path || '').trim()
  if (!path) return
  const target = referencePathsForKind(kind)
  const values = [...target.value]
  const index = values.indexOf(path)
  if (index >= 0) values.splice(index, 1)
  else values.push(path)
  target.value = values
}

function selectedMaterialAssetIds(options = {}) {
  return styleWorkspaces.flatMap(style => [
    ...(style.modelPhotos || []),
    ...(options.modelOnly ? [] : (style.detailPhotos || [])),
  ]).filter(asset => asset.selected && asset.id).map(asset => asset.id)
}

function selectedSourceAssetsForAi() {
  return styleWorkspaces.flatMap(style => (style.modelPhotos || []).flatMap((asset) => [
    ...(asset.editSelected ? [{ style, asset, version: null }] : []),
    ...visibleSourceVersions(asset)
      .filter(version => version.editSelected)
      .map(version => ({ style, asset, version })),
  ]))
}

function buildReviewWorkspaceStyles() {
  const localStyles = buildBalaReviewWorkspaceStyles(styleWorkspaces)
  return mergeBalaReviewWorkspaceStyles(localStyles, reviewStyles)
}

async function openReviewWorkspace() {
  if (reviewBoardUrl.value && !reviewStyles.length) await loadReviewBatchFromBoard(reviewBoardUrl.value)
  const styles = buildReviewWorkspaceStyles()
  reviewStyles.splice(0, reviewStyles.length, ...styles)
  if (!reviewStyles.length) {
    updateAiTaskState({ status: 'failed', error: '当前没有可审核的原图或 AI 结果', message: '当前没有可审核的原图或 AI 结果' })
    return
  }
  activeStep.value = 'review'
}

function operationMetaForDraft() {
  if (activeAction.value === 'face_swap') return selectedModel.value?.label || '等待模特素材确认'
  if (activeAction.value === 'background_swap') return aiPrompt.value || '背景 Prompt'
  if (activeAction.value === 'outfit_swap') return selectedPathSummary([...garmentImagePaths.value, ...outfitReferencePaths.value, ...variantReferencePaths.value])
  if (activeAction.value === 'pose_swap') return aiPrompt.value || '姿势 Prompt'
  return activeActionDetail.value
}

function selectedPathSummary(paths = []) {
  const values = Array.isArray(paths) ? paths.filter(Boolean) : []
  if (!values.length) return '未选择'
  if (values.length === 1) return fileNameFromPath(values[0])
  return `${values.length} 张 · ${fileNameFromPath(values[0])}`
}

function fileNameFromPath(path = '') {
  return String(path || '').split('/').pop().split('\\').pop()
}

async function pickOutfitImages(kind) {
  if (typeof window.cs?.browseFile !== 'function') {
    updateAiTaskState({ status: 'failed', error: '当前环境不支持系统文件选择器，请在抓虾桌面端使用', message: '当前环境不支持系统文件选择器，请在抓虾桌面端使用' })
    return
  }
  try {
    const selected = await window.cs.browseFile({
      title: kind === 'garment' ? '选择服装图' : kind === 'variant' ? '选择同款不同色参考图' : '选择搭配参考图',
      images: true,
      multi: true,
    })
    const paths = Array.isArray(selected)
      ? selected.map(item => String(item || '').trim()).filter(Boolean)
      : String(selected || '').split(',').map(item => item.trim()).filter(Boolean)
    if (kind === 'garment') garmentImagePaths.value = paths
    else if (kind === 'variant') variantReferencePaths.value = paths
    else outfitReferencePaths.value = paths
  } catch (error) {
    updateAiTaskState({ status: 'failed', error: error?.message || String(error), message: error?.message || String(error) })
  }
}

function clearOutfitImages(kind) {
  if (kind === 'garment') garmentImagePaths.value = []
  else if (kind === 'variant') variantReferencePaths.value = []
  else outfitReferencePaths.value = []
}

function appendAiDraftVersions() {
  const label = activeActionTitle.value
  const meta = operationMetaForDraft()
  const now = Date.now()
  for (const { style, asset } of selectedSourceAssetsForAi()) {
    asset.versions = Array.isArray(asset.versions) ? asset.versions : []
    const index = asset.versions.filter(version => version.action === label).length + 1
    asset.versions.push({
      id: `${style.styleCode}-${asset.id || asset.name}-${activeAction.value}-${now}-${index}`,
      action: label,
      operationType: activeAction.value,
      label: `${label.replace(/^AI\s*/, '')} ${String(index).padStart(2, '0')}`,
      meta,
      selected: true,
      status: 'draft',
      progress: 0,
      sourceAssetId: asset.id,
      sourcePath: asset.path,
      previewPath: asset.path,
    })
  }
}

function resetAiPoll() {
  if (aiPollTimer) clearTimeout(aiPollTimer)
  aiPollTimer = null
}

function scheduleAiPoll() {
  resetAiPoll()
  aiPollTimer = setTimeout(() => {
    void pollAiImageTask()
  }, 1200)
}

function updateAiTaskState(patch = {}) {
  Object.assign(aiTaskState, patch)
}

function applyAiLiveStatus(live = {}) {
  const status = normalizeWorkflowStageStatus(live?.status)
  const total = Number(live?.total || live?.records || 0)
  const current = Number(live?.current || live?.current_row || 0)
  const progress = total > 0 ? Math.round((Math.min(current, total) / total) * 100) : aiTaskState.progress
  updateAiTaskState({
    status,
    progress: status === 'done' ? 100 : progress,
    runId: String(live?.run_id || aiTaskState.runId || '').trim(),
    error: String(live?.error || '').trim(),
    message: aiStatusMessage(status, { total, current, live }),
  })
}

function aiStatusMessage(status, { total, current, live } = {}) {
  if (status === 'failed') return aiTaskState.error || 'AI 改图任务失败，可检查配置后重试。'
  if (status === 'done') return 'AI 改图任务已完成，正在回填审核池。'
  if (status === 'partial') return 'AI 改图部分完成，已回填可审核结果。'
  if (status === 'running') {
    const phase = String(live?.phase || '').trim()
    const count = total ? `任务 ${current || 0}/${total}` : '正在创建并提交 AI 生图任务'
    return [count, phase].filter(Boolean).join(' · ')
  }
  return '选择素材和动作后生成 AI 改图任务'
}

function isTerminalAiStatus(status) {
  return ['done', 'failed', 'stopped', 'partial'].includes(normalizeWorkflowStageStatus(status))
}

function isBalaReviewBoardUrl(value = '') {
  return String(value || '').includes('/bala-ai-video-review/')
}

async function findBalaReviewBoardUrlFromExcel(files = []) {
  for (const file of (files || []).filter(file => /\.(xlsx|xls)$/i.test(String(file || ''))).slice(0, 3)) {
    try {
      const payload = await window.cs.readExcel(file)
      const rows = Array.isArray(payload?.rows) ? payload.rows : []
      const row = rows.find(item => isBalaReviewBoardUrl(item?.审批看板))
      const boardUrl = String(row?.审批看板 || '').trim()
      if (boardUrl) return boardUrl
    } catch (error) {
      aiTaskState.logs.push(`读取 AI 结果表失败：${error?.message || String(error)}`)
    }
  }
  return ''
}

function findBalaReviewBoardUrl(files = [], result = null) {
  const direct = String(result?.bala_review_board_url || '').trim()
  if (direct) return direct
  return (files || []).map(file => String(file || '').trim()).find(isBalaReviewBoardUrl) || ''
}

async function startAiImageGeneration() {
  aiTaskState.error = ''
  const selectedSources = selectedSourceAssetsForAi()
  if (!selectedSources.length) {
    updateAiTaskState({ status: 'failed', error: '请先在找图步骤选择至少一张模拍原图', message: '请先在找图步骤选择至少一张模拍原图' })
    return
  }
  const selectedInputPaths = selectedSources.map(({ asset, version }) => (
    String(version?.previewPath || version?.path || asset?.path || '').trim()
  )).filter(Boolean)
  if (selectedInputPaths.length !== selectedSources.length) {
    updateAiTaskState({ status: 'failed', error: '选中的图片中有尚未落盘的结果，请等待图片下载完成后重试', message: '选中的图片中有尚未落盘的结果，请等待图片下载完成后重试' })
    return
  }
  if (activeAction.value === 'face_swap' && !selectedModel.value) {
    updateAiTaskState({ status: 'failed', error: 'AI 换脸需要先选择模特素材', message: 'AI 换脸需要先选择模特素材' })
    return
  }
  if (activeAction.value === 'background_swap' && !String(aiPrompt.value || '').trim()) {
    updateAiTaskState({ status: 'failed', error: 'AI 换背景需要填写背景 Prompt', message: 'AI 换背景需要填写背景 Prompt' })
    return
  }
  if (activeAction.value === 'outfit_swap' && !garmentImagePaths.value.length) {
    updateAiTaskState({ status: 'failed', error: 'AI 换装需要至少选择一张服装图', message: 'AI 换装需要至少选择一张服装图' })
    return
  }
  if (activeAction.value === 'pose_swap' && !String(aiPrompt.value || '').trim()) {
    updateAiTaskState({ status: 'failed', error: 'AI 换姿势需要填写姿势 Prompt', message: 'AI 换姿势需要填写姿势 Prompt' })
    return
  }

  resetAiPoll()
  aiReviewPollToken += 1
  updateAiTaskState({
    status: 'running',
    message: '正在创建并提交 AI 改图任务...',
    error: '',
    progress: 0,
    runId: '',
    outputFiles: [],
    logs: [],
  })
  try {
    const ref = parseBalaMaterialBoardUrl(materialBoardUrl.value)
    if (!ref) throw new Error('缺少素材批次，请先完成找图并生成素材回显')
    const selectedIds = selectedMaterialAssetIds()
    const sourceIds = [...new Set(selectedSources.map(({ asset }) => asset?.id).filter(Boolean))]
    await window.cs.saveBalaMaterialSelection(ref.batchId, ref.token, selectedIds)
    const exportResult = await window.cs.exportBalaAiInput(ref.batchId, ref.token, {
      operation_type: activeAction.value,
      selected_asset_ids: sourceIds,
      model_ref_ids: selectedModel.value ? [selectedModel.value.id] : [],
      background_prompt: activeAction.value === 'background_swap' ? aiPrompt.value : '',
      garment_images: activeAction.value === 'outfit_swap' ? { paths: toBalaBridgeStringArray(garmentImagePaths.value) } : { paths: [] },
      outfit_reference_images: activeAction.value === 'outfit_swap' ? { paths: toBalaBridgeStringArray(outfitReferencePaths.value) } : { paths: [] },
      variant_reference_images: activeAction.value === 'outfit_swap' ? { paths: toBalaBridgeStringArray(variantReferencePaths.value) } : { paths: [] },
      pose_prompt: activeAction.value === 'pose_swap' ? aiPrompt.value : '',
      prompt_extra: aiPrompt.value,
      generation_mode: 'submit_async',
      review_mode: 'create_review_batch',
      model: 'gpt-image-2',
      model_key_tier: '4k',
      image_size: '1536x2048',
      quality: 'high',
      output_format: 'png',
    })
    const request = buildBalaAiStageRequest(exportResult)
    const params = {
      ...request.params,
      source_images: { paths: selectedInputPaths },
      source_limit: selectedInputPaths.length,
      generation_mode: 'submit_async',
      review_mode: 'create_review_batch',
      model: 'gpt-image-2',
      model_key_tier: '4k',
      image_size: '1536x2048',
      quality: 'high',
      output_format: 'png',
    }
    aiStageRequest.value = { ...request, params }
    const previousStatus = await window.cs.getTaskStatus(
      BALA_AI_VIDEO_ADAPTER_ID,
      BALA_AI_IMAGE_TASK_ID,
    ).catch(() => null)
    const previousRunId = String(
      previousStatus?.live?.run_id || previousStatus?.last_run?.id || '',
    ).trim()
    const result = await window.cs.runTask(
      request.adapterId || BALA_AI_VIDEO_ADAPTER_ID,
      request.taskId || BALA_AI_IMAGE_TASK_ID,
      params,
      {},
    )
    if (!result?.ok) throw new Error(result?.message || result?.error || 'AI 改图任务启动失败')
    const launch = await waitForAiImageRunStart(previousRunId)
    aiPollRunId = launch.runId
    updateAiTaskState({ runId: aiPollRunId })
    const launchSnapshot = launch.source === 'live'
      ? launch.snapshot
      : { ...launch.snapshot, run_id: launch.runId, records: launch.snapshot?.records_count }
    applyAiLiveStatus(launchSnapshot)
    if (launch.status === 'failed') {
      throw new Error(launch.snapshot?.error || 'AI 改图任务未成功启动，请重试。')
    }
    if (isTerminalAiStatus(launch.status)) {
      await finalizeAiImageTask(aiPollRunId)
      return
    }
    await pollAiImageTask()
  } catch (error) {
    updateAiTaskState({
      status: 'failed',
      error: error?.message || String(error),
      message: error?.message || String(error),
    })
  }
}

async function pollAiImageTask() {
  try {
    const status = await window.cs.getTaskStatus(BALA_AI_VIDEO_ADAPTER_ID, BALA_AI_IMAGE_TASK_ID)
    const logPayload = await window.cs.getTaskLogs(BALA_AI_VIDEO_ADAPTER_ID, BALA_AI_IMAGE_TASK_ID).catch(() => null)
    if (Array.isArray(logPayload?.logs)) aiTaskState.logs = logPayload.logs.slice(-80)
    const live = status?.live
    if (live && (!aiPollRunId || String(live.run_id || '') === aiPollRunId)) {
      applyAiLiveStatus(live)
      if (!isTerminalAiStatus(live.status)) {
        scheduleAiPoll()
        return
      }
      await finalizeAiImageTask(String(live.run_id || aiPollRunId || ''))
      return
    }
    const last = status?.last_run
    if (last && (!aiPollRunId || String(last.id || '') === aiPollRunId)) {
      applyAiLiveStatus({ ...last, run_id: last.id, records: last.records_count })
      if (isTerminalAiStatus(last.status)) {
        await finalizeAiImageTask(String(last.id || aiPollRunId || ''))
        return
      }
    }
    scheduleAiPoll()
  } catch (error) {
    updateAiTaskState({
      status: 'failed',
      error: error?.message || String(error),
      message: `读取 AI 改图状态失败：${error?.message || String(error)}`,
    })
  }
}

async function finalizeAiImageTask(runId = '') {
  resetAiPoll()
  const data = await window.cs.getData(BALA_AI_VIDEO_ADAPTER_ID, BALA_AI_IMAGE_TASK_ID)
  const run = latestRunForTaskData(data, runId || aiTaskState.runId)
  const outputFiles = parseRunOutputFiles(run?.output_files)
  const boardUrl = findBalaReviewBoardUrl(outputFiles, run) || await findBalaReviewBoardUrlFromExcel(outputFiles)
  updateAiTaskState({ outputFiles, progress: 100 })
  if (!boardUrl) {
    updateAiTaskState({
      status: 'partial',
      message: 'AI 改图任务完成，但没有找到审核池链接；请查看任务详情。',
    })
    return
  }
  let batch = await loadReviewBatchFromBoard(boardUrl)
  if (hasGeneratingBalaReviewAssets(batch)) {
    batch = await waitForAiReviewResults(boardUrl, batch)
  }
  if (hasGeneratingBalaReviewAssets(batch)) {
    updateAiTaskState({
      status: 'partial',
      message: 'AI 图片仍在生成，可稍后进入审核刷新结果。',
    })
    return
  }
  updateAiTaskState({
    status: 'done',
    message: `AI 改图已回填图片工作台：${reviewSummary.value.pending} 张新结果。可继续修改、删除或进入审核。`,
  })
}

async function waitForAiReviewResults(boardUrl, initialBatch = null) {
  const ref = parseBalaReviewBoardUrl(boardUrl)
  if (!ref) throw new Error('审核池链接无效')
  const pollToken = ++aiReviewPollToken
  let batch = initialBatch
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (pollToken !== aiReviewPollToken) return batch
    if (attempt > 0 || !batch) {
      batch = await window.cs.refreshBalaReviewBatch(ref.batchId, ref.token)
      reviewBatch.value = batch
      applyReviewBatchStyles(normalizeBalaReviewBatchStyles(batch, { reviewBoardUrl: boardUrl }))
    }
    if (!hasGeneratingBalaReviewAssets(batch)) return batch
    updateAiTaskState({
      status: 'running',
      progress: Math.max(90, aiTaskState.progress || 0),
      error: '',
      message: 'AI 图片仍在生成，正在等待真实结果落盘...',
    })
    await sleep(3000)
  }
  return batch
}

async function resumeAiReviewResults(boardUrl, batch) {
  if (!hasGeneratingBalaReviewAssets(batch)) return
  try {
    const settled = await waitForAiReviewResults(boardUrl, batch)
    updateAiTaskState({
      status: hasGeneratingBalaReviewAssets(settled) ? 'partial' : 'done',
      progress: hasGeneratingBalaReviewAssets(settled) ? 90 : 100,
      error: '',
      message: hasGeneratingBalaReviewAssets(settled)
        ? 'AI 图片仍在生成，可稍后进入审核刷新结果。'
        : `AI 改图结果已落盘：${reviewSummary.value.pending} 张待审，${reviewSummary.value.approved} 张已通过。`,
    })
  } catch (error) {
    updateAiTaskState({
      status: 'partial',
      error: error?.message || String(error),
      message: `AI 任务已提交，但结果刷新失败：${error?.message || String(error)}`,
    })
  }
}

async function loadReviewBatchFromBoard(boardUrl = reviewBoardUrl.value) {
  const ref = parseBalaReviewBoardUrl(boardUrl)
  if (!ref) throw new Error('审核池链接无效')
  const batch = await window.cs.getBalaReviewBatch(ref.batchId, ref.token)
  reviewBatch.value = batch
  reviewBoardUrl.value = boardUrl
  const styles = normalizeBalaReviewBatchStyles(batch, { reviewBoardUrl: boardUrl })
  applyReviewBatchStyles(styles)
  return batch
}

async function restoreReviewWorkspaceBatches({ silent = false } = {}) {
  try {
    const styleCodeValues = styleWorkspaces.map(style => style.styleCode).filter(Boolean)
    const payload = await window.cs.listBalaReviewWorkspaceBatches({
      style_codes: styleCodeValues.join(','),
      limit: 100,
    })
    const batches = Array.isArray(payload?.items) ? payload.items : []
    if (!batches.length) return 0
    for (const batch of batches) {
      const batchBoardUrl = String(batch?.board_url || batch?.boardUrl || '').trim()
      const styles = normalizeBalaReviewBatchStyles(batch, { reviewBoardUrl: batchBoardUrl })
      applyReviewBatchStyles(styles)
    }
    const latest = batches[batches.length - 1]
    reviewBatch.value = latest
    reviewBoardUrl.value = String(latest?.board_url || latest?.boardUrl || reviewBoardUrl.value || '').trim()
    updateAiTaskState({
      status: 'done',
      progress: 100,
      error: '',
      message: `已恢复 ${batches.length} 个审核批次和全部 AI 修改版本。`,
    })
    return batches.length
  } catch (error) {
    if (!silent) {
      updateAiTaskState({
        status: 'failed',
        error: error?.message || String(error),
        message: error?.message || String(error),
      })
    }
    return 0
  }
}

async function restoreLatestReviewBatch({ silent = false } = {}) {
  try {
    const data = await window.cs.getData(BALA_AI_VIDEO_ADAPTER_ID, BALA_AI_IMAGE_TASK_ID)
    const run = latestRunForTaskData(data)
    if (!run) throw new Error('还没有可刷新的审核池')
    const outputFiles = parseRunOutputFiles(run?.output_files)
    const boardUrl = findBalaReviewBoardUrl(outputFiles, run) || await findBalaReviewBoardUrlFromExcel(outputFiles)
    if (!boardUrl) throw new Error('最近的 AI 改图任务没有审核池链接')
    const batch = await loadReviewBatchFromBoard(boardUrl)
    updateAiTaskState({
      status: 'done',
      progress: 100,
      runId: String(run?.id || run?.run_id || '').trim(),
      outputFiles,
      error: '',
      message: `已恢复审核池：${reviewSummary.value.pending} 张待审，${reviewSummary.value.approved} 张已通过。`,
    })
    if (hasGeneratingBalaReviewAssets(batch)) void resumeAiReviewResults(boardUrl, batch)
    return batch
  } catch (error) {
    if (!silent) {
      updateAiTaskState({
        status: 'failed',
        error: error?.message || String(error),
        message: error?.message || String(error),
      })
    }
    return null
  }
}

async function loadLatestReviewBatch() {
  try {
    if (reviewBoardUrl.value) {
      await loadReviewBatchFromBoard(reviewBoardUrl.value)
      activeStep.value = 'review'
      return
    }
    if (aiTaskState.outputFiles?.length) {
      const boardUrl = findBalaReviewBoardUrl(aiTaskState.outputFiles) || await findBalaReviewBoardUrlFromExcel(aiTaskState.outputFiles)
      if (boardUrl) {
        await loadReviewBatchFromBoard(boardUrl)
        activeStep.value = 'review'
        return
      }
    }
    const restored = await restoreLatestReviewBatch()
    if (restored) {
      activeStep.value = 'review'
      return
    }
    throw new Error('还没有可刷新的审核池')
  } catch (error) {
    updateAiTaskState({ status: 'failed', error: error?.message || String(error), message: error?.message || String(error) })
  }
}

async function selectWorkflowStep(stepId) {
  if (stepId === 'review') {
    if (!reviewStyles.length) await loadLatestReviewBatch()
    await openReviewWorkspace()
    return
  }
  if (stepId === 'templates') {
    if (!reviewStyles.length) {
      await loadLatestReviewBatch()
    }
    buildVideoJobsFromReview()
  }
  activeStep.value = stepId
}

function syncWorkspaceVersionsFromReviewStyles(styles = reviewStyles) {
  for (const reviewStyle of styles || []) {
    const workspace = styleWorkspaces.find(item => item.styleCode === reviewStyle.styleCode)
    if (!workspace) continue
    for (const origin of (reviewStyle.sourceAssets || []).filter(asset => asset.kind === 'origin')) {
      const source = (workspace.modelPhotos || []).find(item => (
        (item.path && origin.path && item.path === origin.path)
        || (item.path && origin.sourcePath && item.path === origin.sourcePath)
        || (item.id && origin.sourceAssetId && item.id === origin.sourceAssetId)
      ))
      if (source) {
        source.reviewStatus = origin.status
        source.remoteAssetId = origin.remoteAssetId || origin.id
        source.reviewBoardUrl = origin.reviewBoardUrl
      }
    }
    for (const asset of reviewStyle.assets || []) {
      const source = (workspace.modelPhotos || []).find(item => (
        item.path && asset.sourcePath && item.path === asset.sourcePath
      )) || (workspace.modelPhotos || [])[0]
      if (!source) continue
      const nextVersion = {
        remoteAssetId: asset.remoteAssetId || asset.id,
        action: asset.action,
        operationType: asset.operationType,
        label: asset.label,
        meta: asset.meta,
        selected: asset.status === 'approved',
        status: asset.status === 'generating' ? 'running' : asset.status,
        progress: asset.status === 'generating' ? 45 : 100,
        sourceAssetId: asset.sourceAssetId,
        sourcePath: asset.sourcePath,
        previewPath: asset.path,
        imageUrl: asset.imageUrl,
        jobUid: asset.jobUid,
        runUid: asset.runUid,
        reviewBoardUrl: asset.reviewBoardUrl,
      }
      source.versions = mergeBalaWorkspaceVersions(source.versions, [nextVersion])
    }
  }
}

function applyReviewBatchStyles(styles = []) {
  syncWorkspaceVersionsFromReviewStyles(styles)
  const localStyles = buildBalaReviewWorkspaceStyles(styleWorkspaces)
  const merged = mergeBalaReviewWorkspaceStyles(localStyles, styles)
  reviewStyles.splice(0, reviewStyles.length, ...merged)
}

function syncWorkspaceReviewDecision(asset, status) {
  for (const style of styleWorkspaces) {
    for (const source of style.modelPhotos || []) {
      if (asset.kind === 'origin') {
        const sameOrigin = (
          (asset.sourceAssetId && source.id === asset.sourceAssetId)
          || (asset.path && source.path === asset.path)
          || (asset.sourcePath && source.path === asset.sourcePath)
        )
        if (sameOrigin) {
          source.reviewStatus = status
          source.remoteAssetId = asset.remoteAssetId || asset.id
          source.reviewBoardUrl = asset.reviewBoardUrl || source.reviewBoardUrl
        }
        continue
      }
      const version = (source.versions || []).find(candidate => (
        (asset.jobUid && candidate.jobUid === asset.jobUid)
        || (
          asset.reviewBoardUrl
          && candidate.reviewBoardUrl === asset.reviewBoardUrl
          && String(candidate.remoteAssetId || '') === String(asset.remoteAssetId || asset.id || '')
        )
        || (asset.path && String(candidate.previewPath || candidate.path || '') === asset.path)
      ))
      if (!version) continue
      version.status = status
      version.reviewStatus = status
      version.remoteAssetId = asset.remoteAssetId || asset.id
      version.reviewBoardUrl = asset.reviewBoardUrl || version.reviewBoardUrl
    }
  }
  persistAiImageWorkspaceState()
}

function applyLocalReviewDecision(asset, status) {
  const normalized = normalizeBalaReviewStatus(status)
  const baseMeta = String(asset.meta || asset.action || '').replace(/\s*·\s*(?:已通过|已舍弃)\s*$/, '')
  asset.status = normalized
  if (normalized === 'approved') asset.meta = `${baseMeta} · 已通过`
  else if (normalized === 'rejected') asset.meta = `${baseMeta} · 已舍弃`
  syncWorkspaceReviewDecision(asset, normalized)
}

async function setReviewAssetStatus(asset, status) {
  const normalized = normalizeBalaReviewStatus(status)
  try {
    const boardUrl = asset.reviewBoardUrl
    const ref = parseBalaReviewBoardUrl(boardUrl)
    if (!ref) {
      applyLocalReviewDecision(asset, normalized)
      return
    }
    const savedStatus = normalized === 'rejected' ? 'rejected' : normalized === 'approved' ? 'approved' : 'pending'
    const batch = await window.cs.saveBalaReviewDecisions(ref.batchId, ref.token, {
      [asset.remoteAssetId || asset.id]: { status: savedStatus },
    })
    reviewBatch.value = batch
    const styles = normalizeBalaReviewBatchStyles(batch, { reviewBoardUrl: boardUrl })
    applyReviewBatchStyles(styles)
  } catch (error) {
    aiTaskState.status = 'failed'
    aiTaskState.error = error?.message || String(error)
    aiTaskState.message = aiTaskState.error
  }
}

async function setStyleReviewStatus(style, status) {
  if (status !== 'approved' && status !== 'rejected') return
  await saveReviewAssetsStatus(style.assets || [], status)
}

async function setPendingReviewStatus(status) {
  const assets = reviewStyles.flatMap(style => style.assets || []).filter(asset => asset.status === 'pending')
  await saveReviewAssetsStatus(assets, status)
}

async function saveReviewAssetsStatus(assets = [], status = 'pending') {
  if (!assets.length) return
  try {
    const grouped = new Map()
    const localAssets = []
    for (const asset of assets) {
      const boardUrl = asset.reviewBoardUrl
      const ref = parseBalaReviewBoardUrl(boardUrl)
      if (!ref) {
        localAssets.push(asset)
        continue
      }
      if (!grouped.has(boardUrl)) grouped.set(boardUrl, { ref, decisions: {} })
      grouped.get(boardUrl).decisions[asset.remoteAssetId || asset.id] = { status }
    }
    for (const [boardUrl, group] of grouped) {
      const batch = await window.cs.saveBalaReviewDecisions(group.ref.batchId, group.ref.token, group.decisions)
      reviewBatch.value = batch
      const styles = normalizeBalaReviewBatchStyles(batch, { reviewBoardUrl: boardUrl })
      applyReviewBatchStyles(styles)
    }
    for (const asset of localAssets) applyLocalReviewDecision(asset, status)
  } catch (error) {
    aiTaskState.status = 'failed'
    aiTaskState.error = error?.message || String(error)
    aiTaskState.message = aiTaskState.error
  }
}

async function refreshReviewBatch() {
  try {
    const boardUrls = [...new Set(reviewStyles.flatMap(style => style.assets || []).map(asset => asset.reviewBoardUrl).filter(Boolean))]
    if (!boardUrls.length && reviewBoardUrl.value) boardUrls.push(reviewBoardUrl.value)
    if (!boardUrls.length) {
      await loadLatestReviewBatch()
      return
    }
    for (const boardUrl of boardUrls) {
      const ref = parseBalaReviewBoardUrl(boardUrl)
      if (!ref) continue
      const batch = await window.cs.refreshBalaReviewBatch(ref.batchId, ref.token)
      reviewBatch.value = batch
      const styles = normalizeBalaReviewBatchStyles(batch, { reviewBoardUrl: boardUrl })
      applyReviewBatchStyles(styles)
    }
  } catch (error) {
    aiTaskState.status = 'failed'
    aiTaskState.error = error?.message || String(error)
    aiTaskState.message = aiTaskState.error
  }
}

async function requestReviewAssetRetry(asset) {
  const retryPrompt = String(asset.prompt || '').trim()
  asset.status = 'retry'
  asset.meta = `${asset.meta || asset.action} · 已请求重跑`
  try {
    const boardUrl = asset.reviewBoardUrl || reviewBoardUrl.value
    const ref = parseBalaReviewBoardUrl(boardUrl)
    if (!ref) return
    const result = await window.cs.regenerateBalaReviewAsset(ref.batchId, ref.token, {
      asset_id: asset.remoteAssetId || asset.id,
      prompt: retryPrompt,
      submit_async: true,
    })
    const batch = result?.batch || await window.cs.refreshBalaReviewBatch(ref.batchId, ref.token)
    reviewBatch.value = batch
    const styles = normalizeBalaReviewBatchStyles(batch, { reviewBoardUrl: boardUrl })
    applyReviewBatchStyles(styles)
  } catch (error) {
    aiTaskState.status = 'failed'
    aiTaskState.error = error?.message || String(error)
    aiTaskState.message = aiTaskState.error
  }
}

function reviewSummaryCounts() {
  const counts = { approved: 0, pending: 0, retry: 0, rejected: 0 }
  for (const style of reviewStyles) {
    for (const asset of style.assets || []) {
      const status = asset.status || 'pending'
      if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1
    }
  }
  return counts
}

const reviewSummary = computed(reviewSummaryCounts)

function buildVideoJobsFromReview() {
  const jobs = []
  for (const style of reviewStyles) {
    const materialStyle = styleWorkspaces.find(item => item.styleCode === style.styleCode)
    const assets = buildBalaVideoAssetPool({ reviewStyle: style, materialStyle })
    if (!hasApprovedBalaVideoAsset(assets)) continue
    jobs.push({
      styleCode: style.styleCode,
      provider: 'qn',
      assets,
      details: assets.filter(asset => asset.kind === '细节图').length,
      template: null,
      status: '待建任务',
      prompt: '',
    })
  }
  videoJobs.splice(0, videoJobs.length, ...jobs)
}

function sendReviewToVideo() {
  buildVideoJobsFromReview()
  if (!videoJobs.length) {
    videoStageState.status = 'failed'
    videoStageState.error = '审核池里还没有可进入视频阶段的图片'
    videoStageState.message = videoStageState.error
    return
  }
  videoStageState.status = 'done'
  videoStageState.message = `已输出 ${videoJobs.length} 个款号素材池，可创建视频任务。`
  activeStep.value = 'templates'
  resetVideoTaskDraftAssets()
}

function videoTaskForResult(item = {}) {
  const taskRefId = String(item.taskRefId || item.id || '')
  return videoTasks.find(task => task.id === taskRefId || String(item.id || '').startsWith(`${task.id}-`)) || null
}

function isProviderTaskSucceeded(provider, status) {
  const normalized = String(status || '').trim().toLowerCase()
  return provider === 'happyhorse' ? normalized === 'succeeded' : normalized === 'succeeded'
}

function providerTaskDisplayStatus(provider, status, localPath = '') {
  if (String(localPath || '').trim()) return '已完成'
  const normalized = String(status || '').trim().toLowerCase()
  if (isProviderTaskSucceeded(provider, status)) return '生成完成待下载'
  if (['failed', 'error', 'canceled', 'cancelled', 'unknown'].includes(normalized)) return '失败'
  if (['running', 'processing', 'in_progress'].includes(normalized)) return '生成中'
  if (['pending', 'queued', 'waiting'].includes(normalized)) return '排队中'
  return status || '已提交'
}

async function refreshProviderVideoResult(item, { download = false } = {}) {
  const task = videoTaskForResult(item)
  const provider = String(task?.provider || item?.providerKey || '').trim()
  const providerTaskId = String(task?.providerTaskId || item?.providerTaskId || item?.taskId || '').trim()
  if (!['seedance', 'happyhorse'].includes(provider) || !providerTaskId) {
    throw new Error('缺少可刷新的 provider task ID')
  }
  const existingLocalPath = /\.mp4$/i.test(String(item?.path || '').trim()) ? String(item.path).trim() : ''
  const result = await window.cs.refreshBalaVideoProviderTask({
    provider,
    task_id: providerTaskId,
    style_code: task?.styleCode || item?.styleCode || '',
    output_dir: task?.outputDir || videoOutputDir.value,
    output_path: download ? existingLocalPath : '',
    download,
    interval_seconds: 5,
    timeout_seconds: 1800,
  })
  if (!result?.ok) throw new Error(result?.error || '视频任务刷新失败')
  const localPath = String(result.local_video_path || existingLocalPath || '').trim()
  if (task) {
    task.providerTaskId = String(result.task_id || providerTaskId)
    task.status = providerTaskDisplayStatus(provider, result.status, localPath)
  }
  const next = {
    ...item,
    id: item?.id || task?.id || `video-result-${providerTaskId}`,
    taskRefId: item?.taskRefId || task?.id || '',
    styleCode: item?.styleCode || task?.styleCode || '',
    template: item?.template || (provider === 'seedance' ? 'Seedance' : happyHorseModeLabel(task?.happyhorseMode)),
    provider: providerLabel(provider),
    providerKey: provider,
    providerTaskId: String(result.task_id || providerTaskId),
    taskId: String(result.task_id || providerTaskId),
    providerStatus: String(result.status || ''),
    status: providerTaskDisplayStatus(provider, result.status, localPath),
    progress: ['已完成', '生成完成待下载', '失败'].includes(providerTaskDisplayStatus(provider, result.status, localPath)) ? 100 : 70,
    path: localPath,
    videoUrl: String(result.video_url || item?.videoUrl || ''),
    error: providerTaskDisplayStatus(provider, result.status, localPath) === '失败' ? String(result.error || result.status || '视频生成失败') : '',
  }
  upsertVideoResults([next])
  return { result, item: next }
}

async function refreshQnVideoTask(task) {
  const runId = String(task?.runId || task?.providerTaskId || '').trim()
  if (!runId) throw new Error(`${task?.styleCode || '生意管家'} 缺少运行 ID`)
  const status = await window.cs.getTaskStatus(BALA_AI_VIDEO_ADAPTER_ID, BALA_QN_VIDEO_TASK_ID)
  const snapshot = [status?.live, status?.last_run].find(candidate => (
    String(candidate?.run_id || candidate?.id || '').trim() === runId
  ))
  if (!snapshot) throw new Error(`${task.styleCode} 未找到对应的生意管家运行记录`)
  const normalized = normalizeWorkflowStageStatus(snapshot.status)
  if (['done', 'failed', 'stopped', 'partial'].includes(normalized)) {
    await finalizeQnVideoTask(task, runId, 'live', snapshot)
    task.status = normalized === 'done' ? '已完成' : '失败'
    return
  }
  task.status = normalized === 'running' ? '生成中' : '已提交'
  upsertVideoResults([{
    id: task.id,
    taskRefId: task.id,
    styleCode: task.styleCode,
    template: task.template?.title || '不选模板',
    provider: providerLabel(task.provider),
    providerKey: task.provider,
    providerTaskId: runId,
    taskId: runId,
    providerStatus: normalized,
    status: normalized === 'running' ? '生成中' : '已提交',
    progress: normalized === 'running' ? 60 : 20,
    path: '',
    error: '',
  }])
}

async function refreshVideoResults() {
  activeStep.value = 'results'
  const refreshable = videoTasks.filter(task => String(task.providerTaskId || task.runId || '').trim())
  if (!refreshable.length) {
    videoStageState.status = 'failed'
    videoStageState.error = '当前没有可刷新的视频任务 ID'
    videoStageState.message = videoStageState.error
    return
  }
  videoStageState.status = 'running'
  videoStageState.error = ''
  videoStageState.message = `正在刷新 ${refreshable.length} 条视频任务...`
  const errors = []
  for (const task of refreshable) {
    try {
      if (task.provider === 'qn') await refreshQnVideoTask(task)
      else {
        const item = videoResults.find(result => videoTaskForResult(result)?.id === task.id) || {
          id: task.id,
          taskRefId: task.id,
          styleCode: task.styleCode,
          providerKey: task.provider,
          providerTaskId: task.providerTaskId,
        }
        await refreshProviderVideoResult(item)
      }
    } catch (error) {
      errors.push(`${task.styleCode}: ${error?.message || String(error)}`)
    }
  }
  videoStageState.status = errors.length ? 'partial' : 'done'
  videoStageState.error = errors.join('；')
  videoStageState.message = errors.length
    ? `状态刷新完成，${errors.length} 条失败：${errors.join('；')}`
    : `已刷新 ${refreshable.length} 条视频任务。`
}

async function downloadCompletedVideoResults() {
  activeStep.value = 'results'
  const providerResults = videoResults.filter(item => ['seedance', 'happyhorse'].includes(String(item.providerKey || videoTaskForResult(item)?.provider || '')))
  let downloaded = 0
  const errors = []
  for (const item of providerResults) {
    try {
      const refreshed = await refreshProviderVideoResult(item)
      const provider = refreshed.item.providerKey
      if (!isProviderTaskSucceeded(provider, refreshed.result.status)) continue
      await refreshProviderVideoResult(refreshed.item, { download: true })
      downloaded += 1
    } catch (error) {
      errors.push(`${item.styleCode || item.id}: ${error?.message || String(error)}`)
    }
  }
  const localQnCount = videoResults.filter(item => item.providerKey === 'qn' && /\.mp4$/i.test(String(item.path || ''))).length
  if (!downloaded && !localQnCount && !errors.length) {
    videoStageState.status = 'failed'
    videoStageState.error = '还没有已完成的视频结果可下载'
    videoStageState.message = videoStageState.error
    return
  }
  videoStageState.status = errors.length ? 'partial' : 'done'
  videoStageState.error = errors.join('；')
  videoStageState.message = `已下载 ${downloaded} 个供应商视频，生意管家本地结果 ${localQnCount} 个${errors.length ? `；${errors.length} 条失败` : ''}。`
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function videoTaskImagePaths(task) {
  return (task?.assets || [])
    .map(asset => String(asset.path || asset.previewPath || '').trim())
    .filter(Boolean)
}

function buildQnVideoTaskParams(task, mode = 'plan') {
  return {
    execute_mode: mode,
    material_images: { paths: videoTaskImagePaths(task) },
    group_mode: 'all_images_one_video',
    template_id: task.template?.id || task.templateId || '',
    template_match: task.template?.title || '',
    prompt: task.prompt || '',
    custom_prompt: task.prompt || '',
    ratio: '3:4',
    output_dir: task.outputDir || videoOutputDir.value,
    download_template_previews: Boolean(task.template),
    download_videos: mode === 'live',
    poll_timeout_minutes: 20,
    poll_interval_seconds: 20,
    submit_delay_ms: 1200,
    download_concurrency: 1,
  }
}

function upsertVideoResults(results = []) {
  for (const item of results) {
    const index = videoResults.findIndex(existing => existing.id === item.id)
    if (index >= 0) videoResults.splice(index, 1, item)
    else videoResults.unshift(item)
  }
}

async function readVideoRowsFromOutputFiles(files = []) {
  const rows = []
  for (const file of (files || []).filter(file => /\.(xlsx|xls)$/i.test(String(file || ''))).slice(0, 3)) {
    try {
      const payload = await window.cs.readExcel(file)
      if (Array.isArray(payload?.rows)) rows.push(...payload.rows)
    } catch (error) {
      videoStageState.error = `读取视频结果表失败：${error?.message || String(error)}`
    }
  }
  return rows
}

async function finalizeQnVideoTask(task, runId = '', mode = 'plan', terminalSnapshot = null) {
  const terminalFailure = qnTerminalRunFailure(terminalSnapshot)
  if (terminalFailure) {
    task.status = '失败'
    upsertVideoResults([{
      id: task.id,
      taskRefId: task.id,
      styleCode: task.styleCode,
      template: task.template?.title || '不选模板',
      provider: providerLabel(task.provider),
      providerKey: task.provider,
      providerTaskId: runId || task.providerTaskId || '',
      taskId: runId || task.providerTaskId || '',
      providerStatus: normalizeWorkflowStageStatus(terminalSnapshot?.status),
      status: '失败',
      progress: 100,
      path: '',
      error: terminalFailure,
    }])
    throw new Error(terminalFailure)
  }
  const data = await window.cs.getData(BALA_AI_VIDEO_ADAPTER_ID, BALA_QN_VIDEO_TASK_ID)
  const run = latestRunForTaskData(data, runId)
  const outputFiles = parseRunOutputFiles(run?.output_files)
  const rows = collectVideoResultRows({ rows: await readVideoRowsFromOutputFiles(outputFiles) })
  const normalized = normalizeBalaVideoResultRows(rows, {
    ...task,
    providerLabel: providerLabel(task.provider),
  })
  const rowFailure = qnVideoResultFailure(normalized)
  if (normalized.length) {
    upsertVideoResults(normalized.map(item => ({
      ...item,
      id: `${task.id}-${item.id}`,
      taskRefId: task.id,
      provider: providerLabel(task.provider),
      providerKey: task.provider,
      providerTaskId: runId || task.providerTaskId || '',
    })))
    if (rowFailure) throw new Error(rowFailure)
  } else {
    upsertVideoResults([{
      id: task.id,
      taskRefId: task.id,
      styleCode: task.styleCode,
      template: task.template?.title || '不选模板',
      provider: providerLabel(task.provider),
      providerKey: task.provider,
      providerTaskId: runId || task.providerTaskId || '',
      taskId: runId || '任务草稿',
      status: mode === 'live' ? '运行中' : '预检完成',
      progress: mode === 'live' ? 60 : 100,
      path: task.outputDir || videoOutputDir.value,
    }])
  }
  activeStep.value = mode === 'live' ? 'results' : activeStep.value
}

async function waitForQnVideoTask(task, runId = '', mode = 'plan') {
  for (let attempt = 0; attempt < 720; attempt += 1) {
    const status = await window.cs.getTaskStatus(BALA_AI_VIDEO_ADAPTER_ID, BALA_QN_VIDEO_TASK_ID)
    const live = status?.live
    if (live && (!runId || String(live.run_id || '') === runId)) {
      const normalized = normalizeWorkflowStageStatus(live.status)
      const total = Number(live.total_rows || live.total || 0)
      const current = Number(live.current_row_no || live.current || 0)
      const progress = total > 0 ? Math.round((Math.min(current, total) / total) * 100) : videoStageState.progress
      videoStageState.status = normalized
      videoStageState.progress = normalized === 'done' ? 100 : progress
      videoStageState.message = normalized === 'running'
        ? `${task.styleCode} 视频任务运行中 ${current || 0}/${total || '?'}`
        : `${task.styleCode} 视频任务 ${normalized}`
      if (!['done', 'failed', 'stopped', 'partial'].includes(normalized)) {
        await sleep(2000)
        continue
      }
      await finalizeQnVideoTask(task, String(live.run_id || runId || ''), mode, live)
      return
    }
    const last = status?.last_run
    if (last && (!runId || String(last.id || '') === runId)) {
      const normalized = normalizeWorkflowStageStatus(last.status)
      if (['done', 'failed', 'stopped', 'partial'].includes(normalized)) {
        await finalizeQnVideoTask(task, String(last.id || runId || ''), mode, last)
        return
      }
    }
    await sleep(2000)
  }
  throw new Error('视频任务轮询超时')
}

async function preflightVideoProviderTask(task) {
  const result = await window.cs.preflightBalaVideoProvider({
    provider: task.provider,
    style_code: task.styleCode,
    mode: task.happyhorseMode || 'i2v',
    prompt: String(task.prompt || '').trim(),
    image_paths: task.provider === 'happyhorse' && task.happyhorseMode === 't2v'
      ? []
      : videoTaskImagePaths(task),
    output_dir: task.outputDir || videoOutputDir.value,
    resolution: '720P',
    ratio: '3:4',
    duration: 5,
    generate_audio: true,
  })
  if (!result?.ok) throw new Error(result?.error || `${providerLabel(task.provider)} 预检失败`)
  return result
}

async function runSeedanceVideoTask(task, mode = 'plan') {
  if (mode !== 'live') {
    await preflightVideoProviderTask(task)
    task.status = '预检完成，等待授权生成'
    upsertVideoResults([{
      id: task.id,
      taskRefId: task.id,
      styleCode: task.styleCode,
      template: 'Seedance',
      provider: providerLabel(task.provider),
      providerKey: task.provider,
      providerTaskId: task.providerTaskId || '',
      taskId: '预检草稿',
      status: '待授权',
      progress: 0,
      path: '',
    }])
    return
  }
  const prompt = String(task.prompt || '').trim()
  if (!prompt) throw new Error('Seedance 任务需要填写 Prompt')
  const payload = {
    style_code: task.styleCode,
    prompt,
    image_paths: videoTaskImagePaths(task).slice(0, 4),
    output_dir: task.outputDir || videoOutputDir.value,
    ratio: '3:4',
    duration: 5,
    wait: true,
  }
  let result
  let usedTextOnlyFallback = false
  try {
    result = await window.cs.runBalaSeedanceVideo(payload)
    if (!result?.ok) throw new Error(result?.error || 'Seedance 视频任务未能启动')
  } catch (error) {
    if (!isSeedancePrivacyProtectionError(error)) throw error
    usedTextOnlyFallback = true
    result = await window.cs.runBalaSeedanceVideo({
      ...payload,
      prompt: `${prompt}\n使用原创虚构儿童模特，不参考或复刻任何真实人物身份与面部特征。`,
      image_paths: [],
    })
  }
  if (!result?.ok) throw new Error(result?.error || 'Seedance 视频任务未能启动')
  task.providerTaskId = String(result?.task_id || task.providerTaskId || '')
  task.status = result?.local_video_path ? '已下载' : (result?.status || '已提交')
  upsertVideoResults([{
    id: task.id,
    taskRefId: task.id,
    styleCode: task.styleCode,
    template: usedTextOnlyFallback ? 'Seedance 原创人物' : 'Seedance',
    provider: providerLabel(task.provider),
    providerKey: task.provider,
    providerTaskId: task.providerTaskId,
    taskId: result?.task_id || '',
    providerStatus: result?.status || '',
    status: result?.local_video_path ? '已完成' : (result?.status || '已提交'),
    progress: result?.local_video_path ? 100 : 80,
    path: result?.local_video_path || '',
    videoUrl: result?.video_url || '',
    error: '',
  }])
  activeStep.value = 'results'
}

async function runHappyHorseVideoTask(task, mode = 'plan') {
  if (mode !== 'live') {
    await preflightVideoProviderTask(task)
    task.status = '预检完成，等待授权生成'
    upsertVideoResults([{
      id: task.id,
      taskRefId: task.id,
      styleCode: task.styleCode,
      template: happyHorseModeLabel(task.happyhorseMode),
      provider: providerLabel(task.provider),
      providerKey: task.provider,
      providerTaskId: task.providerTaskId || '',
      taskId: '预检草稿',
      status: '待授权',
      progress: 0,
      path: task.outputDir || videoOutputDir.value,
    }])
    return
  }
  const prompt = String(task.prompt || '').trim()
  if (!prompt) throw new Error('HappyHorse 任务需要填写 Prompt')
  const result = await window.cs.runBalaHappyHorseVideo({
    style_code: task.styleCode,
    mode: task.happyhorseMode || 'i2v',
    prompt,
    image_paths: videoTaskImagePaths(task),
    output_dir: task.outputDir || videoOutputDir.value,
    resolution: '720P',
    ratio: '3:4',
    duration: 5,
    wait: true,
  })
  if (!result?.ok) throw new Error(result?.error || 'HappyHorse 视频任务未能启动')
  task.providerTaskId = String(result?.task_id || task.providerTaskId || '')
  task.status = result?.local_video_path ? '已下载' : (result?.status || '已提交')
  upsertVideoResults([{
    id: task.id,
    taskRefId: task.id,
    styleCode: task.styleCode,
    template: happyHorseModeLabel(task.happyhorseMode),
    provider: providerLabel(task.provider),
    providerKey: task.provider,
    providerTaskId: task.providerTaskId,
    taskId: result?.task_id || '',
    providerStatus: result?.status || '',
    status: result?.local_video_path ? '已完成' : (result?.status || '已提交'),
    progress: result?.local_video_path ? 100 : 80,
    path: result?.local_video_path || '',
    videoUrl: result?.video_url || '',
    error: '',
  }])
  activeStep.value = 'results'
}

async function runVideoTask(task, mode = 'plan') {
  if (!shouldCreateBalaVideoProviderRun(task)) {
    videoStageState.status = 'done'
    videoStageState.error = ''
    videoStageState.message = `${task.styleCode} 这条视频任务已提交，请到结果页刷新或复制新建后再次生成。`
    activeStep.value = 'results'
    return
  }
  const textOnlyHappyHorse = task?.provider === 'happyhorse' && task?.happyhorseMode === 't2v'
  if (!textOnlyHappyHorse && !task?.assets?.length) {
    videoStageState.status = 'failed'
    videoStageState.error = '视频任务缺少素材图片'
    videoStageState.message = videoStageState.error
    return
  }
  if (!textOnlyHappyHorse && !videoTaskImagePaths(task).length) {
    videoStageState.status = 'failed'
    videoStageState.error = '视频任务缺少可用的本地图片文件'
    videoStageState.message = videoStageState.error
    return
  }
  videoStageState.status = 'running'
  videoStageState.error = ''
  videoStageState.progress = 0
  videoStageState.message = `${task.styleCode} 正在${mode === 'live' ? '生成并下载视频' : '预检视频任务'}...`
  task.status = mode === 'live' ? '生成中' : '预检中'
  try {
    if (task.provider === 'seedance') {
      await runSeedanceVideoTask(task, mode)
    } else if (task.provider === 'happyhorse') {
      await runHappyHorseVideoTask(task, mode)
    } else {
      const params = buildQnVideoTaskParams(task, mode)
      const previousStatus = await window.cs.getTaskStatus(
        BALA_AI_VIDEO_ADAPTER_ID,
        BALA_QN_VIDEO_TASK_ID,
      ).catch(() => null)
      const previousRunId = String(
        previousStatus?.live?.run_id || previousStatus?.last_run?.id || '',
      ).trim()
      const result = await window.cs.runTask(BALA_AI_VIDEO_ADAPTER_ID, BALA_QN_VIDEO_TASK_ID, params, {})
      if (!result?.ok) throw new Error(result?.message || result?.error || '视频任务启动失败')
      const launch = await waitForQnVideoRunStart(previousRunId)
      const runId = launch.runId
      task.runId = runId
      task.providerTaskId = runId
      if (launch.status === 'failed') {
        throw new Error(launch.snapshot?.error || '生意管家视频任务未成功启动，请重试。')
      }
      await waitForQnVideoTask(task, runId, mode)
      task.status = mode === 'live' ? '已提交 / 查看结果' : '预检完成，等待授权生成'
    }
    videoStageState.status = 'done'
    videoStageState.progress = 100
    videoStageState.message = `${task.styleCode} 视频任务${mode === 'live' ? '已完成提交链路' : '预检完成'}。`
  } catch (error) {
    task.status = '失败'
    videoStageState.status = 'failed'
    videoStageState.error = error?.message || String(error)
    videoStageState.message = videoStageState.error
    upsertVideoResults([{
      id: task.id,
      taskRefId: task.id,
      styleCode: task.styleCode,
      template: task.template?.title || '不选模板',
      provider: providerLabel(task.provider),
      providerKey: task.provider,
      providerTaskId: task.providerTaskId || '',
      taskId: '',
      status: '失败',
      progress: 100,
      path: task.outputDir || videoOutputDir.value,
      error: videoStageState.error,
    }])
  }
}

async function runAllVideoTasks(mode = 'plan') {
  for (const task of videoTasks) {
    await runVideoTask(task, mode)
  }
}

function editSourcesForStyle(style) {
  return selectEditableSourcesForStyle(style, showSelectedVersionsOnly.value)
}

function versionCountForStyle(style) {
  return editSourcesForStyle(style).reduce((sum, source) => sum + (source.versions || []).length, 0)
}

function approvedVideoAssetCount(job) {
  return (job?.assets || []).filter(asset => asset.status === 'approved').length
}

function reviewAssetCount(style, kind) {
  return (style?.assets || []).filter(asset => asset.kind === kind).length
}

function approvedVideoTaskAssetCount(task) {
  return (task?.assets || []).filter(asset => asset.status === 'approved').length
}

function assetStatusLabel(status) {
  if (status === 'approved') return '已审核'
  if (status === 'pending') return '待审'
  if (status === 'retry') return '需重跑'
  if (status === 'rejected') return '已舍弃'
  if (status === 'generating') return '生成中'
  if (status === 'failed') return '失败'
  return '素材'
}

function openImageEditor(asset, styleCode = '', sourceAsset = null) {
  lastFocusedElement.value = document.activeElement
  const source = sourceAsset || (asset?.versions ? asset : null)
  const history = source
    ? [source, ...visibleSourceVersions(source)]
    : [asset]
  const selectedIndex = Math.max(0, history.findIndex(item => item === asset || (item.id && item.id === asset?.id)))
  previewImage.value = {
    title: asset?.label || asset?.name || '图片预览',
    meta: [styleCode, asset?.role || asset?.action, asset?.meta].filter(Boolean).join(' · '),
    path: String(asset?.path || asset?.previewPath || '').trim(),
    src: previewSourceFor(asset || {}),
    asset,
    source,
    styleCode,
    history,
  }
  previewHistoryIndex.value = selectedIndex
  previewEditAction.value = asset?.operationType || activeAction.value || 'background_swap'
  previewEditPrompt.value = String(asset?.prompt || asset?.meta || aiPrompt.value || '').trim()
  previewEditError.value = ''
  previewAnnotationTool.value = 'draw'
  previewAnnotationClearNonce.value += 1
}

function openImagePreview(asset, styleCode = '') {
  openImageEditor(asset, styleCode)
}

function applyPromptLibrarySelection(template = {}) {
  const prompt = String(template?.prompt_text || template?.prompt || '').trim()
  if (promptLibraryTarget.value === 'preview') previewEditPrompt.value = prompt
  else aiPrompt.value = prompt
  promptLibraryOpen.value = false
  promptLibraryTarget.value = 'workspace'
}

function clearPreviewAnnotation() {
  previewAnnotationClearNonce.value += 1
}

function capturePreviewAnnotation(dataUrl) {
  if (previewAnnotationResolve) previewAnnotationResolve(String(dataUrl || ''))
  clearPreviewAnnotationRequest()
}

function handlePreviewAnnotationError(error) {
  const normalized = error instanceof Error ? error : new Error(String(error || '标注导出失败'))
  if (previewAnnotationReject) previewAnnotationReject(normalized)
  else previewEditError.value = normalized.message
  clearPreviewAnnotationRequest()
}

function clearPreviewAnnotationRequest() {
  if (previewAnnotationTimer) clearTimeout(previewAnnotationTimer)
  previewAnnotationTimer = null
  previewAnnotationResolve = null
  previewAnnotationReject = null
}

function requestPreviewAnnotationExport() {
  if (!activePreviewHistoryItem.value?.src) return Promise.resolve('')
  return new Promise((resolve, reject) => {
    clearPreviewAnnotationRequest()
    previewAnnotationResolve = resolve
    previewAnnotationReject = reject
    previewAnnotationTimer = setTimeout(() => {
      if (previewAnnotationReject) previewAnnotationReject(new Error('标注导出超时，请重试'))
      clearPreviewAnnotationRequest()
    }, 8000)
    previewAnnotationExportNonce.value += 1
  })
}

function editPromptText(operationType, instruction = '') {
  const requirement = String(instruction || '').trim()
  const prefixes = {
    face_swap: '替换人物面部为参考模特，严格保留服装款式、颜色、纹理和画面构图。',
    outfit_swap: '根据服装与搭配参考图完成换装，严格保留人物身份、姿势和场景。',
    background_swap: '只修改画面背景，严格保留人物、服装款式、颜色和姿势。',
    pose_swap: '只调整人物姿势，严格保留人物身份、服装款式、颜色和背景。',
  }
  return [prefixes[operationType], requirement].filter(Boolean).join('\n')
}

function previewEditPromptText() {
  return editPromptText(previewEditAction.value, previewEditPrompt.value)
}

function latestAiJobOutput(job = {}) {
  const runs = Array.isArray(job?.summary?.runs) ? job.summary.runs : []
  const latest = runs[runs.length - 1] || job?.summary || {}
  return {
    path: (latest.output_files || job?.summary?.output_files || [])[0] || '',
    url: (latest.image_urls || job?.summary?.image_urls || [])[0] || '',
    runUid: latest.run_uid || latest.task_id || '',
  }
}

async function materializePreviewReference(jobUid, value, filename) {
  const source = String(value || '').trim()
  if (!source || typeof window.cs?.materializeAiImageResult !== 'function') return ''
  const payload = source.startsWith('data:')
    ? { data_url: source, filename }
    : { url: source, filename }
  const result = await window.cs.materializeAiImageResult(jobUid, payload)
  return String(result?.path || '').trim()
}

async function archivePreviewOutputToWorkspace(jobUid, output = {}) {
  const source = String(output?.url || output?.path || '').trim()
  if (!source) return ''
  const saved = await window.cs.saveAsAiImageJob(jobUid, {
    directory: workspaceDir.value,
    files: [source],
  })
  return String(saved?.files?.[0] || '').trim()
}

async function runPreviewImageEdit() {
  if (previewEditBusy.value) return
  const current = activePreviewHistoryItem.value
  const mainPath = String(current?.path || current?.previewPath || previewImage.value?.path || '').trim()
  const prompt = previewEditPromptText()
  if (!mainPath) {
    previewEditError.value = '当前图片没有可用于修改的本地文件'
    return
  }
  if (!workspaceDir.value) {
    previewEditError.value = '请先在第一步选择工作区目录'
    return
  }
  if (!prompt) {
    previewEditError.value = '请填写当前图片的修改要求'
    return
  }
  if (previewEditAction.value === 'face_swap' && !selectedModel.value) {
    previewEditError.value = 'AI 换脸需要先选择模特'
    return
  }
  previewEditBusy.value = true
  previewEditError.value = ''
  try {
    const annotationDataUrl = await requestPreviewAnnotationExport()
    const created = await window.cs.createAiImageJob({
      title: `${previewImage.value?.styleCode || 'AI 视频'} · 大图修改`,
      prompt,
      model_key: 'gpt-image-2',
      status: 'draft',
      output_dir: workspaceDir.value,
      params: {
        size: '1536x2048',
        quality: 'high',
        response_format: 'png',
        n: 1,
        model_key_tier: '4k',
        main_image_path: mainPath,
        reference_image_paths: [],
      },
    })
    const jobUid = String(created?.job_uid || '').trim()
    if (!jobUid) throw new Error('AI 生图服务没有返回任务 ID')
    const references = []
    if (annotationDataUrl) {
      const path = await materializePreviewReference(jobUid, annotationDataUrl, 'bala-video-annotation.png')
      if (path) references.push(path)
    }
    if (previewEditAction.value === 'face_swap' && selectedModel.value?.imageUrl) {
      const path = await materializePreviewReference(jobUid, selectedModel.value.imageUrl, 'bala-video-model-reference.png')
      if (path) references.push(path)
    }
    if (previewEditAction.value === 'outfit_swap') {
      references.push(...garmentImagePaths.value, ...outfitReferencePaths.value, ...variantReferencePaths.value)
    }
    await window.cs.updateAiImageJob(jobUid, {
      prompt,
      status: 'draft',
      params: {
        ...created.params,
        size: '1536x2048',
        quality: 'high',
        response_format: 'png',
        n: 1,
        model_key_tier: '4k',
        main_image_path: mainPath,
        reference_image_paths: [...new Set(references.filter(Boolean))],
      },
    })
    const runResult = await window.cs.runAiImageJob(jobUid)
    if (runResult?.ok === false) throw new Error(runResult?.summary?.error || '大图修改失败')
    const latest = await window.cs.getAiImageJob(jobUid)
    const output = latestAiJobOutput(latest)
    if (!output.path && !output.url) throw new Error('大图修改完成但没有返回结果图片')
    const localOutputPath = await archivePreviewOutputToWorkspace(jobUid, output)
    if (!localOutputPath) throw new Error('大图修改结果未能保存到当前工作区')
    const source = previewImage.value?.source || previewImage.value?.asset
    source.versions = Array.isArray(source.versions) ? source.versions : []
    const version = {
      id: `${jobUid}-${output.runUid || Date.now()}`,
      action: aiActions.find(action => action.id === previewEditAction.value)?.title || 'AI 修改',
      operationType: previewEditAction.value,
      label: `大图修改 ${source.versions.length + 1}`,
      meta: prompt,
      prompt,
      selected: false,
      status: 'pending',
      progress: 100,
      sourceAssetId: source.id || '',
      sourcePath: mainPath,
      previewPath: localOutputPath,
      imageUrl: output.url,
      jobUid,
      runUid: output.runUid,
    }
    source.versions.push(version)
    previewImage.value.history = [source, ...visibleSourceVersions(source)]
    previewHistoryIndex.value = previewImage.value.history.length - 1
    previewAnnotationClearNonce.value += 1
  } catch (error) {
    previewEditError.value = error?.message || String(error)
  } finally {
    previewEditBusy.value = false
  }
}

function providerLabel(provider) {
  if (provider === 'seedance') return 'Seedance 2.0'
  if (provider === 'happyhorse') return '百炼 HappyHorse'
  return '生意管家'
}

function happyHorseModeLabel(mode) {
  if (mode === 't2v') return '文生视频'
  if (mode === 'r2v') return '参考生视频'
  return '图生视频'
}

function providerStatusLabel(provider) {
  const status = videoProviderStatus[provider]
  if (!status) return '无需单独配置'
  return status.configured ? `已配置（${status.source || '本机'}）` : '未配置'
}

function openTemplateLibrary(styleCode = '') {
  lastFocusedElement.value = document.activeElement
  activeTemplateStyle.value = styleCode
  templateLibraryOpen.value = true
}

function confirmTemplateSelection() {
  if (videoTaskDialogOpen.value) {
    videoTaskDraft.templateId = selectedTemplateId.value
  }
  templateLibraryOpen.value = false
}

function clearTemplateSelection() {
  if (videoTaskDialogOpen.value) {
    videoTaskDraft.templateId = ''
  } else {
    selectedTemplateId.value = ''
  }
  templateLibraryOpen.value = false
}

function resetVideoTaskDraftAssets() {
  const assets = videoTaskSelectableAssets.value || []
  if (videoTaskDraft.provider === 'happyhorse' && videoTaskDraft.happyhorseMode === 't2v') {
    videoTaskDraft.assetIds = []
    return
  }
  videoTaskDraft.assetIds = assets.filter(asset => asset.selectable).map(asset => asset.id)
  if (videoTaskDraft.provider === 'happyhorse' && videoTaskDraft.happyhorseMode === 'i2v') {
    videoTaskDraft.assetIds = videoTaskDraft.assetIds.slice(0, 1)
  }
}

function openVideoTaskDialog(styleCode = '') {
  lastFocusedElement.value = document.activeElement
  videoTaskDraft.styleCode = styleCode || videoJobs[0]?.styleCode || ''
  videoTaskDraft.provider = 'qn'
  videoTaskDraft.happyhorseMode = 'i2v'
  videoTaskDraft.prompt = ''
  videoTaskDraft.outputDir = videoOutputDir.value
  videoTaskDraft.templateId = ''
  resetVideoTaskDraftAssets()
  videoTaskDialogOpen.value = true
}

function handleVideoProviderChange() {
  videoTaskDraft.templateId = ''
  resetVideoTaskDraftAssets()
}

function handleHappyHorseModeChange() {
  resetVideoTaskDraftAssets()
}

function selectVideoTaskStyle(styleCode) {
  videoTaskDraft.styleCode = String(styleCode || '').trim()
  resetVideoTaskDraftAssets()
}

function toggleVideoTaskDraftAsset(asset) {
  if (!asset?.selectable) return
  const assetId = asset.id
  const index = videoTaskDraft.assetIds.indexOf(assetId)
  if (index >= 0) {
    videoTaskDraft.assetIds.splice(index, 1)
    return
  }
  videoTaskDraft.assetIds.push(assetId)
}

function createVideoTaskFromDraft() {
  const assets = videoTaskSelectableAssets.value.filter(asset => asset.selectable && videoTaskDraft.assetIds.includes(asset.id))
  const textOnlyHappyHorse = videoTaskDraft.provider === 'happyhorse' && videoTaskDraft.happyhorseMode === 't2v'
  if (!videoTaskDraft.styleCode || (!textOnlyHappyHorse && !assets.length)) {
    videoStageState.status = 'failed'
    videoStageState.error = '请先选择款号和至少一张素材图片'
    videoStageState.message = videoStageState.error
    return
  }
  if (videoTaskDraft.provider !== 'qn' && !videoTaskDraft.prompt.trim()) {
    videoStageState.status = 'failed'
    videoStageState.error = `${providerLabel(videoTaskDraft.provider)} 任务需要填写 Prompt`
    videoStageState.message = videoStageState.error
    return
  }
  if (videoTaskDraft.provider === 'happyhorse' && videoTaskDraft.happyhorseMode === 'i2v' && assets.length !== 1) {
    videoStageState.status = 'failed'
    videoStageState.error = 'HappyHorse 图生视频只允许选择 1 张首帧图'
    videoStageState.message = videoStageState.error
    return
  }
  if (videoTaskDraft.provider === 'happyhorse' && videoTaskDraft.happyhorseMode === 'r2v' && (assets.length < 1 || assets.length > 9)) {
    videoStageState.status = 'failed'
    videoStageState.error = 'HappyHorse 参考生视频需要选择 1-9 张图片'
    videoStageState.message = videoStageState.error
    return
  }
  const template = videoTaskDraft.provider === 'qn'
    ? templateSamples.find(item => item.id === videoTaskDraft.templateId) || null
    : null
  const providerName = providerLabel(videoTaskDraft.provider)
  const taskIndex = videoTasks.length + 1
  videoTasks.unshift({
    id: `video-task-${Date.now()}`,
    title: `${providerName} 视频任务 ${String(taskIndex).padStart(2, '0')}`,
    styleCode: videoTaskDraft.styleCode,
    provider: videoTaskDraft.provider,
    happyhorseMode: videoTaskDraft.happyhorseMode,
    prompt: videoTaskDraft.prompt.trim(),
    outputDir: videoTaskDraft.outputDir.trim() || videoOutputDir.value,
    template,
    status: '待预检',
    providerTaskId: '',
    runId: '',
    assets: assets.map(asset => ({ ...asset })),
  })
  videoTaskDialogOpen.value = false
}

async function openOutputDir() {
  const target = String(videoOutputDir.value || '').trim()
  if (!target) return
  try {
    await window.cs.openFile(target)
  } catch (error) {
    videoStageState.status = 'failed'
    videoStageState.error = error?.message || String(error)
    videoStageState.message = videoStageState.error
  }
}

async function openVideoResult(item) {
  const localTarget = String(item?.path || '').trim()
  const remoteTarget = String(item?.videoUrl || '').trim()
  if (!localTarget && !remoteTarget) {
    videoStageState.status = 'failed'
    videoStageState.error = '该视频结果还没有本地文件'
    videoStageState.message = videoStageState.error
    return
  }
  try {
    if (localTarget) await window.cs.openFile(localTarget)
    else await window.cs.openExternalUrl(remoteTarget)
  } catch (error) {
    videoStageState.status = 'failed'
    videoStageState.error = error?.message || String(error)
    videoStageState.message = videoStageState.error
  }
}

function videoResultHasOutput(item) {
  const localTarget = String(item?.path || '').trim()
  const remoteTarget = String(item?.videoUrl || '').trim()
  return /\.mp4(?:$|[?#])/i.test(localTarget) || /^https?:\/\//i.test(remoteTarget)
}

function canRetryVideoResult(item) {
  if (String(item?.status || '').trim() === '失败') return false
  const task = videoTaskForResult(item)
  const providerTaskId = String(task?.providerTaskId || task?.runId || item?.providerTaskId || '').trim()
  return Boolean(task && providerTaskId)
}

async function retryVideoResult(item) {
  const task = videoTaskForResult(item)
  if (!task) return
  try {
    if (['seedance', 'happyhorse'].includes(task.provider)) {
      await refreshProviderVideoResult(item, { download: true })
    } else {
      await refreshQnVideoTask(task)
    }
    videoStageState.status = 'done'
    videoStageState.error = ''
    videoStageState.message = `${task.styleCode} 已使用原任务 ID 重新读取并下载结果。`
  } catch (error) {
    videoStageState.status = 'failed'
    videoStageState.error = error?.message || String(error)
    videoStageState.message = videoStageState.error
  }
}

function openAiCapabilitySettings(provider = '') {
  videoStageState.status = 'done'
  videoStageState.message = `请在抓虾 AI 能力配置中确认${provider ? ` ${providerLabel(provider)}` : '视频模型'}凭据；本页面不会保存密钥。`
  emit('open-settings', 'ai-video')
}

async function loadVideoProviderStatus() {
  try {
    const status = await window.cs.getBalaVideoProviderStatus()
    for (const provider of ['seedance', 'happyhorse']) {
      if (status?.[provider]) Object.assign(videoProviderStatus[provider], status[provider])
    }
  } catch {
    // Keep the safe unconfigured state until the backend is reachable.
  }
}

function openModelLibrary() {
  lastFocusedElement.value = document.activeElement
  modelLibraryOpen.value = true
}

function closePreview() {
  clearPreviewAnnotationRequest()
  previewImage.value = null
  previewEditError.value = ''
}

function closeModelLibrary() {
  modelLibraryOpen.value = false
}

function closeTemplateLibrary() {
  templateLibraryOpen.value = false
}

function closeVideoTaskDialog() {
  videoTaskDialogOpen.value = false
}

function closeTopDialog() {
  if (pendingVersionDeletion.value) closeDeleteConfirmation()
  else if (previewImage.value) closePreview()
  else if (videoTaskDialogOpen.value) closeVideoTaskDialog()
  else if (templateLibraryOpen.value) closeTemplateLibrary()
  else if (modelLibraryOpen.value) closeModelLibrary()
}

function trapDialogFocus(event) {
  if (event.key !== 'Tab') return
  const root = event.currentTarget
  const focusable = Array.from(root.querySelectorAll([
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(','))).filter(element => element.offsetParent !== null)
  if (!focusable.length) {
    event.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(hasOpenModal, async (open) => {
  if (!open) {
    await nextTick()
    if (lastFocusedElement.value && typeof lastFocusedElement.value.focus === 'function') {
      lastFocusedElement.value.focus()
    }
    return
  }
  await nextTick()
  const dialog = document.querySelector('[data-aiv-dialog]')
  const target = dialog?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || dialog
  if (target && typeof target.focus === 'function') target.focus()
})

watch([videoTasks, videoResults], () => {
  persistVideoWorkflowState()
}, { deep: true })

watch(styleWorkspaces, () => {
  persistAiImageWorkspaceState()
}, { deep: true })

onMounted(() => {
  restoreVideoWorkflowState()
  void (async () => {
    await restoreLatestMaterialTask()
    restoreAiImageWorkspaceState()
    const restoredBatchCount = await restoreReviewWorkspaceBatches({ silent: true })
    if (!restoredBatchCount) await restoreLatestReviewBatch({ silent: true })
    aiImageWorkspaceStateHydrated = true
    persistAiImageWorkspaceState()
  })()
  void loadModelLibrary()
  void loadTemplateCatalog()
  void loadVideoProviderStatus()
})

onBeforeUnmount(() => {
  resetMaterialPoll()
  resetAiPoll()
  aiReviewPollToken += 1
  if (videoPollTimer) clearTimeout(videoPollTimer)
  clearPreviewAnnotationRequest()
})

function markPreviewBroken(path) {
  if (path) brokenPreviews[path] = true
}

function localFileUrl(path) {
  const value = String(path || '').trim()
  if (!value || /^(https?:|data:|blob:|file:)/i.test(value)) return value
  const normalized = value.replace(/\\/g, '/')
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  const encoded = withLeadingSlash
    .split('/')
    .map(segment => (/^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/')
  return `file://${encoded}`
}
</script>

<style scoped>
.aiv-workbench {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  background: var(--bg);
}

.aiv-topbar {
  min-height: 86px;
  padding: 18px 22px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.aiv-kicker {
  margin: 0 0 4px;
  color: var(--orange);
  font-size: 11px;
  font-weight: 700;
}

.aiv-topbar h2 {
  margin: 0 0 6px;
  font-size: 22px;
  line-height: 1.15;
}

.aiv-subtitle {
  margin: 0;
  color: var(--text2);
  font-size: 12px;
}

.aiv-top-actions,
.aiv-workspace-actions,
.aiv-inline-actions,
.aiv-review-actions,
.aiv-ai-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.aiv-primary,
.aiv-ghost,
.aiv-action-chip,
.aiv-chip,
.aiv-style-tab,
.aiv-source-pill {
  border-radius: 8px;
  border: 1px solid var(--border);
  color: var(--text);
  background: var(--bg3);
}

.aiv-primary,
.aiv-ghost {
  height: 32px;
  padding: 0 12px;
}

.aiv-primary.small {
  height: 28px;
  padding: 0 9px;
  font-size: 12px;
}

.aiv-primary {
  border-color: var(--orange);
  background: var(--orange);
  color: #fff;
  font-weight: 700;
}

.aiv-primary:disabled,
.aiv-ghost:disabled,
.aiv-action-option:disabled {
  opacity: .55;
  cursor: not-allowed;
}

.aiv-primary.wide,
.aiv-ghost.wide {
  width: 100%;
}

.aiv-ghost {
  color: var(--text2);
  background: transparent;
}

.aiv-ghost.active {
  border-color: rgba(255, 107, 43, 0.45);
  color: var(--orange);
  background: var(--orange-bg);
}

.aiv-ghost.small {
  height: 28px;
  padding: 0 9px;
  font-size: 12px;
}

.aiv-ghost.danger,
.aiv-ai-actions .danger {
  color: var(--red);
}

.aiv-action-stack {
  display: grid;
  gap: 8px;
}

.aiv-action-stack span {
  color: var(--text3);
  font-size: 11px;
  line-height: 1.5;
}

.aiv-page-actions {
  padding: 12px 14px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.aiv-stepper {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  padding: 12px 22px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
}

.aiv-step {
  min-width: 0;
  height: 58px;
  padding: 9px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg3);
  color: var(--text2);
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  text-align: left;
}

.aiv-step.active {
  border-color: var(--orange);
  background: var(--orange-bg);
  color: var(--text);
}

.aiv-step.done .aiv-step-index {
  color: var(--green);
}

.aiv-step-index {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--bg);
  border: 1px solid var(--border);
  font-weight: 800;
  font-size: 12px;
}

.aiv-step-copy {
  min-width: 0;
}

.aiv-step-copy strong,
.aiv-step-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-step-copy strong {
  margin-bottom: 3px;
  color: inherit;
}

.aiv-step-copy small {
  color: var(--text3);
}

.aiv-stage {
  min-height: 0;
  overflow: auto;
  padding: 18px 22px 24px;
}

.aiv-stage.aiv-stage-material-active {
  overflow: hidden;
}

.aiv-stage.aiv-stage-ai-edit-active {
  overflow: hidden;
}

.aiv-stage-grid,
.aiv-edit-workbench,
.aiv-review-workbench,
.aiv-video-workbench,
.aiv-video-task-workbench {
  min-height: 100%;
  display: grid;
  gap: 14px;
}

.aiv-stage-grid {
  grid-template-columns: 360px minmax(0, 1fr);
}

.aiv-material-stage {
  height: 100%;
  min-height: 0;
  transition: grid-template-columns .18s ease;
}

.aiv-material-stage.params-collapsed {
  grid-template-columns: 56px minmax(0, 1fr);
}

.aiv-params-panel,
.aiv-material-results-panel {
  min-height: 0;
  display: grid;
}

.aiv-params-panel {
  grid-template-rows: auto minmax(0, 1fr);
}

.aiv-params-panel.collapsed {
  grid-template-rows: minmax(0, 1fr);
}

.aiv-params-panel.collapsed .aiv-panel-head {
  height: 100%;
  min-height: 0;
  padding: 10px 7px;
  flex-direction: column;
  justify-content: space-between;
  text-align: center;
}

.aiv-collapsed-material-summary {
  display: grid;
  gap: 8px;
  justify-items: center;
}

.aiv-collapsed-material-summary strong {
  writing-mode: vertical-rl;
  letter-spacing: .16em;
}

.aiv-collapsed-material-summary span {
  margin: 0;
  writing-mode: vertical-rl;
  font-size: 10px;
}

.aiv-params-panel.collapsed .aiv-collapse-action {
  width: 40px;
  min-height: 42px;
  padding: 5px 0;
  flex-direction: column;
  gap: 3px;
}

.aiv-params-panel.collapsed .aiv-collapse-action > span:first-child {
  margin: 0;
  font-size: 10px;
}

.aiv-material-results-panel {
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
}

.aiv-params-panel .aiv-panel-body,
.aiv-material-results-panel .aiv-style-list {
  min-height: 0;
  overflow-y: auto;
  align-content: start;
}

.aiv-material-sticky-actions {
  position: relative;
  z-index: 4;
  flex: 0 0 auto;
  background: var(--bg2);
  box-shadow: 0 -10px 24px rgba(0, 0, 0, 0.18);
}

.aiv-edit-workbench {
  grid-template-columns: 320px minmax(0, 1fr);
  height: 100%;
  min-height: 0;
}

.aiv-review-workbench {
  grid-template-columns: minmax(0, 1fr);
}

.aiv-video-workbench {
  grid-template-columns: 320px minmax(0, 1fr);
}

.aiv-result-stage {
  grid-template-columns: minmax(0, 1fr);
}

.aiv-video-task-workbench {
  grid-template-columns: minmax(0, 1fr);
}

.aiv-panel {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
}

.aiv-panel-head,
.aiv-workspace-head {
  min-height: 52px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.aiv-panel-head strong,
.aiv-panel-head span,
.aiv-workspace-head strong,
.aiv-workspace-head span {
  display: block;
}

.aiv-panel-head strong,
.aiv-workspace-head strong {
  font-size: 14px;
}

.aiv-panel-head span,
.aiv-workspace-head span {
  margin-top: 3px;
  color: var(--text3);
  font-size: 11px;
}

.aiv-panel-body {
  padding: 14px;
  display: grid;
  gap: 12px;
}

.aiv-field {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.aiv-field span,
.aiv-source-title {
  color: var(--text2);
  font-size: 12px;
  font-weight: 650;
}

.aiv-field input,
.aiv-field textarea,
.aiv-field select,
.aiv-review-toolbar input,
.aiv-review-toolbar select {
  width: 100%;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
}

.aiv-field input,
.aiv-field select,
.aiv-review-toolbar input,
.aiv-review-toolbar select {
  height: 34px;
  padding: 0 10px;
}

.aiv-field textarea {
  resize: none;
  padding: 10px;
  line-height: 1.5;
}

.aiv-directory-picker {
  width: 100%;
  min-width: 0;
  min-height: 38px;
  padding: 0 8px 0 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  text-align: left;
}

.aiv-directory-picker:hover,
.aiv-directory-picker:focus-visible {
  border-color: rgba(255, 107, 43, 0.55);
}

.aiv-directory-picker .aiv-directory-picker-path {
  min-width: 0;
  overflow: hidden;
  color: var(--text2);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-directory-picker strong {
  min-height: 26px;
  padding: 0 9px;
  flex: 0 0 auto;
  border-radius: 6px;
  color: var(--orange);
  background: var(--orange-bg);
  display: inline-flex;
  align-items: center;
  font-size: 11px;
}

.aiv-default-grid,
.aiv-batch-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.aiv-batch-summary {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.aiv-default-grid div,
.aiv-batch-summary div,
.aiv-generation-queue,
.aiv-picked-row,
.aiv-preview-meta {
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
}

.aiv-default-grid strong,
.aiv-default-grid span,
.aiv-batch-summary strong,
.aiv-batch-summary span,
.aiv-generation-queue strong,
.aiv-generation-queue span,
.aiv-picked-row strong,
.aiv-picked-row span,
.aiv-preview-meta strong,
.aiv-preview-meta span {
  display: block;
}

.aiv-default-grid span,
.aiv-batch-summary span,
.aiv-generation-queue span,
.aiv-picked-row span,
.aiv-preview-meta span {
  margin-top: 4px;
  color: var(--text3);
  font-size: 11px;
}

.aiv-style-list,
.aiv-review-style-list,
.aiv-video-style-list,
.aiv-video-task-list,
.aiv-result-list,
.aiv-style-tabs,
.aiv-edit-style-list {
  gap: 12px;
}

.aiv-material-style-tabs {
  min-width: 0;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  gap: 8px;
  overflow-x: auto;
  background: var(--bg2);
  scrollbar-width: thin;
}

.aiv-material-style-tabs button {
  min-width: 158px;
  padding: 8px 10px;
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text2);
  background: var(--bg3);
  text-align: left;
  cursor: pointer;
}

.aiv-material-style-tabs button:hover {
  border-color: rgba(255, 107, 43, 0.34);
}

.aiv-material-style-tabs button:focus-visible,
.aiv-material-source-tabs button:focus-visible {
  outline: 2px solid rgba(255, 107, 43, 0.72);
  outline-offset: 2px;
}

.aiv-material-style-tabs button.active {
  border-color: var(--orange);
  color: var(--text);
  background: var(--orange-bg);
  box-shadow: inset 0 -2px 0 var(--orange);
}

.aiv-material-style-tabs strong,
.aiv-material-style-tabs span {
  display: block;
  white-space: nowrap;
}

.aiv-material-style-tabs span {
  margin-top: 4px;
  color: var(--text3);
  font-size: 11px;
}

.aiv-material-tab-panel {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 10px;
}

.aiv-material-source-switcher {
  min-width: 0;
  min-height: 54px;
  margin: 0;
  padding: 9px 14px;
  border: 1px solid var(--border);
  border-left: 0;
  border-right: 0;
  border-radius: 0;
  background: var(--bg3);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.aiv-material-source-switcher > span {
  color: var(--text3);
  font-size: 11px;
  white-space: nowrap;
}

.aiv-material-source-tabs {
  padding: 3px;
  display: inline-grid;
  grid-template-columns: repeat(2, minmax(112px, auto));
  gap: 3px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}

.aiv-material-source-tabs button {
  min-height: 28px;
  padding: 4px 10px;
  border: 0;
  border-radius: 6px;
  color: var(--text2);
  background: transparent;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.aiv-material-source-tabs button:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.04);
}

.aiv-material-source-tabs button.active {
  color: var(--orange);
  background: var(--orange-bg);
  box-shadow: inset 0 0 0 1px rgba(255, 107, 43, 0.34);
}

.aiv-material-source-tabs strong {
  margin-left: 5px;
  display: inline;
  color: inherit;
}

.aiv-style-card,
.aiv-review-style-card {
  display: grid;
  gap: 10px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}

.aiv-style-card:last-child,
.aiv-review-style-card:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.aiv-style-head,
.aiv-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.aiv-collapse-head {
  width: 100%;
  min-height: 46px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--text);
  background: rgba(255, 255, 255, 0.015);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.16s ease, background-color 0.16s ease, transform 0.12s ease;
}

.aiv-collapse-head:hover {
  border-color: rgba(255, 107, 43, 0.34);
  background: rgba(255, 107, 43, 0.055);
}

.aiv-collapse-head:focus-visible {
  outline: 2px solid rgba(255, 107, 43, 0.72);
  outline-offset: 2px;
}

.aiv-collapse-head:active {
  transform: translateY(1px);
}

.aiv-collapse-head[aria-expanded="true"] {
  border-color: var(--border);
  background: var(--bg3);
}

.aiv-style-title-block {
  min-width: 0;
}

.aiv-style-title-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

.aiv-style-title-row strong {
  flex: 0 0 auto;
}

.aiv-style-title-row .aiv-title-meta {
  min-width: 0;
  margin-top: 0;
  display: inline;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-collapse-head > div:last-child {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.aiv-collapse-action {
  min-height: 26px;
  margin-top: 0;
  padding: 4px 9px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text2);
  background: var(--bg);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.aiv-collapse-chevron {
  width: 7px;
  height: 7px;
  margin-top: -3px;
  display: inline-block;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg);
  transition: transform 0.16s ease;
}

.aiv-collapse-head[aria-expanded="true"] .aiv-collapse-action {
  border-color: rgba(255, 107, 43, 0.38);
  color: var(--orange);
  background: var(--orange-bg);
}

.aiv-collapse-head[aria-expanded="true"] .aiv-collapse-chevron {
  margin-top: 3px;
  transform: rotate(-135deg);
}

.aiv-style-head span,
.aiv-section-head span {
  display: block;
  margin-top: 3px;
  color: var(--text3);
  font-size: 11px;
}

.aiv-badge,
.aiv-chip {
  min-height: 22px;
  padding: 3px 8px;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg3);
  color: var(--text2);
  font-size: 11px;
  white-space: nowrap;
}

.aiv-chip.active {
  border-color: var(--orange);
  color: var(--orange);
  background: var(--orange-bg);
}

.aiv-filter-note {
  display: block;
  color: var(--text3);
  font-size: 11px;
  line-height: 1.45;
}

.aiv-filter-note.error {
  color: #fca5a5;
}

.aiv-badge.orange {
  border-color: rgba(255, 107, 43, 0.45);
  color: var(--orange);
  background: var(--orange-bg);
}

.aiv-badge.success {
  border-color: rgba(74, 222, 128, 0.36);
  color: var(--green);
  background: rgba(74, 222, 128, 0.09);
}

.aiv-badge.retry {
  border-color: rgba(251, 191, 36, 0.38);
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.09);
}

.aiv-source-board {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
}

.aiv-source-board.compact {
  gap: 12px;
}

.aiv-source-board.compact.single {
  grid-template-columns: minmax(0, 1fr);
}

.aiv-source-board.compact section,
.aiv-source-column {
  display: grid;
  align-content: start;
  align-self: start;
  gap: 8px;
}

.aiv-thumb-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-content: start;
  gap: 8px;
}

.aiv-large-thumb-grid,
.aiv-video-images {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.aiv-thumb,
.aiv-large-thumb,
.aiv-preview-box,
.aiv-ai-preview,
.aiv-add-image,
.aiv-upload-card,
.aiv-video-fallback {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(255,255,255,0.06), transparent 45%), var(--bg3);
  color: var(--text2);
}

.aiv-thumb,
.aiv-large-thumb {
  position: relative;
  aspect-ratio: 3 / 4;
  contain: layout paint style;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  padding: 8px;
  overflow: hidden;
}

.aiv-load-more {
  width: 100%;
  min-height: 34px;
  padding: 7px 10px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  color: var(--text2);
  background: var(--bg);
  font-size: 11px;
}

.aiv-load-more:hover,
.aiv-load-more:focus-visible {
  border-color: rgba(255, 107, 43, 0.55);
  color: var(--orange);
  background: var(--orange-bg);
}

.aiv-thumb.selected,
.aiv-large-thumb.selected {
  border-color: var(--orange);
  color: var(--text);
  box-shadow: inset 0 0 0 1px var(--orange);
}

.aiv-thumb.muted {
  opacity: 0.48;
}

.aiv-thumb span,
.aiv-thumb small,
.aiv-large-thumb span {
  color: var(--text3);
  font-size: 11px;
}

.aiv-select-ribbon {
  position: absolute;
  top: 7px;
  right: 7px;
  min-height: 20px;
  padding: 2px 6px;
  border: 0;
  border-radius: 999px;
  color: #fff !important;
  background: var(--orange);
  font-size: 10px !important;
  font-weight: 700;
}

.aiv-thumb:not(.selected) .aiv-select-ribbon {
  color: var(--text2) !important;
  background: var(--bg);
  border: 1px solid var(--border);
}

.aiv-thumb-media {
  position: absolute;
  inset: 0;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  color: inherit;
}

.aiv-thumb-media img,
.aiv-original-card img,
.aiv-ai-preview img,
.aiv-video-asset-card img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.aiv-thumb-media::after,
.aiv-original-card::after,
.aiv-ai-preview::after,
.aiv-video-asset-card::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(180deg, transparent 45%, rgba(0, 0, 0, 0.62));
}

.aiv-thumb-media strong,
.aiv-thumb-media span,
.aiv-thumb-media small,
.aiv-original-card strong,
.aiv-original-card small,
.aiv-original-card .aiv-origin-label,
.aiv-ai-preview span,
.aiv-ai-preview small,
.aiv-video-asset-card strong,
.aiv-video-asset-card small,
.aiv-video-asset-card .aiv-status-pill {
  position: relative;
  z-index: 1;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.56);
}

.aiv-thumb-media strong,
.aiv-thumb-media span,
.aiv-thumb-media small {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-thumb-zoom {
  position: absolute;
  z-index: 3;
  left: 50%;
  top: 50%;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 50%;
  color: #fff;
  background: rgba(8, 8, 10, 0.76);
  display: grid;
  place-items: center;
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.92);
  transition: opacity 0.16s ease, transform 0.16s ease, background 0.16s ease;
}

.aiv-thumb-zoom span {
  color: inherit;
  font-size: 22px;
  line-height: 1;
}

.aiv-thumb:hover .aiv-thumb-zoom,
.aiv-thumb:focus-within .aiv-thumb-zoom,
.aiv-thumb-zoom:focus-visible {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}

.aiv-thumb-zoom:hover,
.aiv-thumb-zoom:focus-visible {
  border-color: var(--orange);
  background: rgba(255, 107, 43, 0.92);
}

.aiv-style-tab {
  width: 100%;
  min-height: 62px;
  padding: 10px;
  text-align: left;
  color: var(--text2);
}

.aiv-style-tab.active {
  border-color: var(--orange);
  background: var(--orange-bg);
  color: var(--orange);
}

.aiv-style-tab strong,
.aiv-style-tab span {
  display: block;
}

.aiv-style-tab span {
  margin-top: 5px;
  color: var(--text3);
  font-size: 11px;
}

.aiv-edit-action-panel {
  min-height: 0;
  align-self: stretch;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
}

.aiv-edit-action-panel .aiv-panel-body {
  min-height: 0;
  overflow-y: auto;
  align-content: start;
  scrollbar-gutter: stable;
}

.aiv-edit-sticky-actions {
  position: relative;
  z-index: 4;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
  background: var(--bg2);
  display: grid;
  gap: 8px;
  box-shadow: 0 -10px 24px rgba(0, 0, 0, .18);
}

.aiv-edit-style-list {
  min-height: 0;
  overflow-y: auto;
  align-content: start;
  scrollbar-gutter: stable;
}

.aiv-edit-style-list .aiv-style-card {
  align-self: start;
}

.aiv-action-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.aiv-action-option {
  min-height: 76px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text2);
  background: var(--bg3);
  text-align: left;
}

.aiv-action-option.active {
  border-color: var(--orange);
  color: var(--orange);
  background: var(--orange-bg);
  box-shadow: inset 0 0 0 1px var(--orange);
}

.aiv-action-option strong,
.aiv-action-option span {
  display: block;
}

.aiv-action-option span {
  margin-top: 5px;
  color: var(--text3);
  font-size: 11px;
}

.aiv-image-workbench {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.aiv-workspace-body {
  min-height: 0;
  padding: 14px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 14px;
}

.aiv-action-chip {
  height: 28px;
  padding: 0 10px;
  color: var(--text2);
}

.aiv-action-chip.active {
  border-color: var(--orange);
  color: var(--orange);
  background: var(--orange-bg);
}

.aiv-generate-panel {
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}

.aiv-edit-queue {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 12px;
}

.aiv-edit-source-row {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  gap: 10px;
}

.aiv-original-card,
.aiv-version-card {
  position: relative;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(255,255,255,0.06), transparent 45%), var(--bg3);
  color: var(--text2);
}

.aiv-original-card {
  aspect-ratio: 3 / 4;
  padding: 10px;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
}

.aiv-origin-label {
  min-height: 20px;
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--orange);
  background: var(--orange-bg);
  font-size: 10px;
  font-weight: 700;
}

.aiv-original-card strong,
.aiv-original-card small,
.aiv-version-card strong,
.aiv-version-card small,
.aiv-version-card span {
  display: block;
}

.aiv-original-card small,
.aiv-version-card small,
.aiv-version-card span {
  color: var(--text3);
  font-size: 11px;
}

.aiv-version-rail {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(112px, 1fr));
  gap: 8px;
}

.aiv-version-card {
  min-height: 132px;
  padding: 10px;
  display: grid;
  align-content: end;
  gap: 6px;
  text-align: left;
}

.aiv-version-card.selected {
  border-color: var(--orange);
  color: var(--text);
  box-shadow: inset 0 0 0 1px var(--orange);
}

.aiv-version-card.loading {
  border-color: rgba(255, 107, 43, 0.55);
}

.aiv-version-card.add {
  border-style: dashed;
  align-content: center;
  justify-items: center;
  text-align: center;
}

.aiv-mini-progress,
.aiv-progress-bar {
  width: 100%;
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--border);
}

.aiv-mini-progress::before,
.aiv-progress-bar::before {
  content: "";
  width: var(--progress, 0%);
  height: 100%;
  display: block;
  border-radius: inherit;
  background: var(--orange);
}

.aiv-reference-strip {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.aiv-reference-strip strong {
  margin-right: 4px;
}

.aiv-picked-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.aiv-upload-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.aiv-upload-strip.vertical {
  grid-template-columns: minmax(0, 1fr);
}

.aiv-upload-card {
  min-height: 58px;
}

.aiv-file-picker {
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
}

.aiv-file-picker strong,
.aiv-file-picker span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-file-picker span {
  margin-top: 3px;
  color: var(--text3);
  font-size: 11px;
}

.aiv-empty-inline {
  padding: 14px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  color: var(--text3);
  background: var(--bg);
  font-size: 12px;
}

.aiv-inline-error {
  padding: 9px 10px;
  border: 1px solid rgba(248, 113, 113, .34);
  border-radius: 8px;
  color: #fca5a5;
  background: rgba(248, 113, 113, .08);
  font-size: 12px;
  line-height: 1.45;
}

.aiv-source-issues {
  display: grid;
  gap: 6px;
  padding: 10px;
  border: 1px solid rgba(251, 191, 36, .25);
  border-radius: 8px;
  color: #fbbf24;
  background: rgba(251, 191, 36, .07);
}

.aiv-source-issues strong,
.aiv-source-issues span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-source-issues span {
  color: var(--text2);
  font-size: 11px;
}

.aiv-edit-selection-summary {
  padding: 9px 10px;
  border: 1px solid rgba(255, 107, 43, 0.35);
  border-radius: 8px;
  background: var(--orange-bg);
  display: grid;
  gap: 4px;
}

.aiv-edit-selection-summary strong,
.aiv-edit-selection-summary span {
  display: block;
}

.aiv-edit-selection-summary span {
  color: var(--text2);
  font-size: 11px;
  line-height: 1.45;
}

.aiv-review-workbench {
  align-items: start;
}

.aiv-review-workbench .aiv-panel {
  overflow: visible;
}

.aiv-review-sticky-actions {
  position: sticky;
  bottom: 0;
  z-index: 5;
  border-top-color: rgba(255, 107, 43, 0.22);
  background: linear-gradient(180deg, rgba(31, 31, 31, 0.92), var(--bg2));
  backdrop-filter: blur(10px);
}

.aiv-review-toolbar {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 140px auto auto auto;
  gap: 8px;
  align-items: center;
}

.aiv-ai-asset-board {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.aiv-ai-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
}

.aiv-ai-card.approved {
  border-color: rgba(74, 222, 128, 0.45);
}

.aiv-ai-card.retry {
  border-color: rgba(255, 107, 43, 0.55);
}

.aiv-ai-card.add {
  position: relative;
  border-style: dashed;
}

.aiv-ai-preview,
.aiv-add-image {
  position: relative;
  overflow: hidden;
  width: 100%;
  aspect-ratio: 3 / 4;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 8px;
  padding: 10px;
}

.aiv-ai-preview small,
.aiv-add-image span {
  color: var(--text3);
  font-size: 11px;
  text-align: center;
}

.aiv-ai-card footer {
  padding: 9px;
  display: grid;
  gap: 8px;
}

.aiv-ai-card footer strong,
.aiv-ai-card footer span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-ai-card footer span {
  margin-top: 3px;
  color: var(--text3);
  font-size: 11px;
}

.aiv-ai-actions button,
.aiv-add-menu button {
  min-height: 24px;
  padding: 0 7px;
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--text2);
  background: var(--bg);
  font-size: 11px;
}

.aiv-ai-actions .ok {
  color: var(--green);
}

.aiv-add-menu {
  position: absolute;
  z-index: 3;
  left: 8px;
  right: 8px;
  bottom: 8px;
  padding: 8px;
  display: grid;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.32);
}

.aiv-source-assets-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}

.aiv-source-assets-row strong {
  margin-right: 6px;
}

.aiv-source-pill {
  min-height: 24px;
  padding: 0 8px;
  color: var(--text2);
  font-size: 11px;
}

.aiv-source-pill.selected {
  border-color: rgba(255, 107, 43, 0.45);
  color: var(--orange);
  background: var(--orange-bg);
}

.aiv-review-preview {
  position: sticky;
  top: 0;
}

.aiv-preview-box {
  aspect-ratio: 3 / 4;
  display: grid;
  place-items: center;
  color: var(--text3);
}

.aiv-video-style-list {
  display: grid;
  gap: 14px;
}

.aiv-video-task-list {
  display: grid;
  gap: 14px;
}

.aiv-video-toolbar {
  padding: 12px 14px;
  display: grid;
  grid-template-columns: minmax(260px, 0.9fr) minmax(280px, 1fr) auto auto auto auto auto;
  gap: 10px;
  align-items: end;
}

.aiv-batch-summary.inline {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.aiv-field.compact {
  align-self: stretch;
}

.aiv-provider-badges {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;
}

.aiv-video-images {
  grid-template-columns: repeat(5, minmax(0, 120px));
}

.aiv-video-config-grid {
  display: grid;
  grid-template-columns: 180px minmax(220px, 0.8fr) minmax(260px, 1.2fr);
  gap: 12px;
}

.aiv-seedance-callout {
  padding: 10px 12px;
  border: 1px solid rgba(255, 107, 43, 0.35);
  border-radius: 8px;
  background: var(--orange-bg);
  display: grid;
  gap: 4px;
}

.aiv-seedance-callout strong,
.aiv-seedance-callout span,
.aiv-seedance-callout small {
  display: block;
}

.aiv-seedance-callout span,
.aiv-seedance-callout small {
  color: var(--text2);
  font-size: 11px;
  line-height: 1.5;
}

.aiv-video-task-assets {
  display: grid;
  grid-template-columns: repeat(6, minmax(104px, 1fr));
  gap: 8px;
}

.aiv-video-asset-card {
  position: relative;
  aspect-ratio: 3 / 4;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text2);
  background: linear-gradient(135deg, rgba(255,255,255,0.06), transparent 45%), var(--bg3);
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
}

.aiv-video-asset-card.selected {
  border-color: var(--orange);
  color: var(--text);
  box-shadow: inset 0 0 0 1px var(--orange);
}

.aiv-video-asset-card.pending {
  border-style: dashed;
}

.aiv-video-asset-card strong,
.aiv-video-asset-card small {
  max-width: 100%;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-video-asset-card small {
  color: var(--text3);
  font-size: 11px;
}

.aiv-status-pill {
  position: absolute;
  top: 7px;
  right: 7px;
  min-height: 20px;
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text2);
  background: var(--bg);
  font-size: 10px;
  font-weight: 700;
}

.aiv-status-pill.approved {
  border-color: rgba(74, 222, 128, 0.45);
  color: var(--green);
}

.aiv-status-pill.pending,
.aiv-status-pill.retry {
  border-color: rgba(255, 107, 43, 0.45);
  color: var(--orange);
  background: var(--orange-bg);
}

.aiv-status-pill.source {
  color: var(--text2);
}

.aiv-video-task-config {
  display: grid;
  grid-template-columns: 190px minmax(220px, 0.8fr) minmax(320px, 1.4fr);
  gap: 12px;
}

.aiv-video-task-meta {
  display: grid;
  grid-template-columns: 200px minmax(260px, 1fr) minmax(260px, 1fr);
  gap: 10px;
}

.aiv-video-task-meta div {
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}

.aiv-video-task-meta strong,
.aiv-video-task-meta span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-video-task-meta span {
  margin-top: 4px;
  color: var(--text3);
  font-size: 11px;
}

.aiv-progress-overview {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  display: grid;
  gap: 10px;
}

.aiv-progress-overview.compact {
  padding: 10px;
  background: var(--bg);
}

.aiv-progress-overview.failed {
  border-color: rgba(248, 113, 113, .34);
}

.aiv-progress-overview.partial,
.aiv-progress-overview.stopped {
  border-color: rgba(251, 191, 36, .32);
}

.aiv-progress-overview strong,
.aiv-progress-overview span {
  display: block;
}

.aiv-dual-progress {
  display: grid;
  gap: 9px;
}

.aiv-progress-line {
  display: grid;
  gap: 5px;
}

.aiv-progress-overview .aiv-progress-line > span {
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.aiv-progress-line > span strong,
.aiv-progress-line > span small {
  color: var(--text2);
  font-size: 11px;
}

.aiv-progress-line > span small {
  color: var(--text3);
}

.aiv-progress-overview span {
  margin-top: 4px;
  color: var(--text3);
  font-size: 11px;
}

.aiv-progress-bar {
  display: block;
  height: 7px;
}

.aiv-progress-bar.slim {
  height: 5px;
}

.aiv-result-card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.aiv-result-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  display: grid;
  grid-template-rows: auto 1fr;
}

.aiv-result-preview {
  aspect-ratio: 16 / 9;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  background: linear-gradient(135deg, rgba(255,255,255,0.07), transparent 45%), var(--bg);
  color: var(--text2);
}

.aiv-result-preview strong,
.aiv-result-preview span,
.aiv-result-copy strong,
.aiv-result-copy span {
  display: block;
}

.aiv-result-preview span,
.aiv-result-copy span {
  color: var(--text3);
  font-size: 11px;
}

.aiv-result-copy {
  padding: 10px;
  display: grid;
  gap: 9px;
}

.aiv-result-copy header,
.aiv-result-copy footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.aiv-result-copy p {
  min-height: 32px;
  margin: 0;
  color: var(--text3);
  font-size: 11px;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.aiv-result-copy .aiv-result-error {
  color: #f87171;
}

.aiv-preview-modal-panel {
  width: min(960px, 100%);
  max-height: min(820px, 92vh);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  box-shadow: 0 22px 80px rgba(0, 0, 0, 0.42);
}

.aiv-big-preview {
  min-height: 0;
  padding: 14px;
  display: grid;
  place-items: center;
  background: var(--bg);
}

.aiv-big-preview img {
  max-width: 100%;
  max-height: 74vh;
  object-fit: contain;
  border-radius: 8px;
}

.aiv-big-preview div {
  width: min(520px, 100%);
  aspect-ratio: 3 / 4;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text2);
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 8px;
}

.aiv-modal {
  position: fixed;
  z-index: 80;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 28px;
  background: rgba(0, 0, 0, 0.56);
}

.aiv-modal-panel {
  width: min(920px, 100%);
  max-height: min(780px, 92vh);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  box-shadow: 0 22px 80px rgba(0, 0, 0, 0.42);
}

.aiv-modal-panel.wide {
  width: min(1080px, 100%);
}

.aiv-modal-panel.aiv-video-task-modal-panel {
  width: min(1160px, 100%);
}

.aiv-modal-panel.aiv-confirm-panel {
  width: min(520px, 100%);
}

.aiv-confirm-copy {
  min-height: 0;
  padding: 18px;
  display: grid;
  gap: 10px;
}

.aiv-confirm-copy strong,
.aiv-confirm-copy span,
.aiv-confirm-copy code {
  display: block;
}

.aiv-confirm-copy span,
.aiv-confirm-copy code {
  color: var(--text3);
  font-size: 12px;
  line-height: 1.55;
}

.aiv-confirm-copy code {
  padding: 9px 10px;
  overflow-wrap: anywhere;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}

.aiv-danger {
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid rgba(248, 113, 113, .52);
  border-radius: 8px;
  color: #fff;
  background: #b91c1c;
}

.aiv-modal-head,
.aiv-modal-foot {
  min-height: 56px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.aiv-modal-foot {
  border-top: 1px solid var(--border);
  border-bottom: 0;
}

.aiv-modal-head strong,
.aiv-modal-head span,
.aiv-modal-foot span {
  display: block;
}

.aiv-modal-head span,
.aiv-modal-foot span {
  margin-top: 3px;
  color: var(--text3);
  font-size: 11px;
}

.aiv-modal-body {
  min-height: 0;
  overflow: auto;
  padding: 14px;
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 14px;
}

.aiv-modal-body.template {
  grid-template-columns: 160px minmax(0, 1fr);
}

.aiv-modal-body.video-task {
  grid-template-columns: 320px minmax(0, 1fr);
}

.aiv-video-task-form {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 12px;
}

.aiv-video-task-picker {
  min-width: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
}

.aiv-picker-head {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.aiv-picker-head strong,
.aiv-picker-head span {
  display: block;
}

.aiv-picker-head span {
  margin-top: 3px;
  color: var(--text3);
  font-size: 11px;
}

.aiv-video-task-assets.picker {
  grid-template-columns: repeat(4, minmax(112px, 1fr));
  align-content: start;
}

.aiv-modal-filter {
  display: grid;
  align-content: start;
  gap: 8px;
}

.aiv-model-grid,
.aiv-template-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.aiv-template-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.aiv-model-card,
.aiv-template-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
}

.aiv-model-card.selected,
.aiv-template-card.selected {
  border-color: var(--orange);
  box-shadow: inset 0 0 0 1px var(--orange);
}

.aiv-model-image,
.aiv-template-card video,
.aiv-video-fallback {
  width: 100%;
  aspect-ratio: 3 / 4;
  display: grid;
  place-items: center;
  background: var(--bg);
  color: var(--text3);
}

.aiv-model-image img,
.aiv-template-card video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.aiv-model-card div:last-child,
.aiv-template-copy {
  padding: 9px;
  display: grid;
  gap: 5px;
}

.aiv-model-card strong,
.aiv-model-card span,
.aiv-template-copy strong,
.aiv-template-copy p {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.aiv-model-card span {
  color: var(--text3);
  font-size: 11px;
  white-space: nowrap;
}

.aiv-template-copy strong {
  white-space: nowrap;
}

.aiv-template-copy p {
  min-height: 34px;
  margin: 0;
  color: var(--text3);
  font-size: 11px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

@media (max-width: 1180px) {
  .aiv-stage.aiv-stage-material-active {
    overflow: auto;
  }

  .aiv-material-stage {
    height: auto;
  }

  .aiv-params-panel,
  .aiv-material-results-panel {
    display: block;
    overflow: hidden;
  }

  .aiv-params-panel .aiv-panel-body,
  .aiv-material-results-panel .aiv-style-list {
    overflow-y: visible;
  }

  .aiv-stage-grid,
  .aiv-edit-workbench,
  .aiv-review-workbench,
  .aiv-video-workbench,
  .aiv-video-toolbar,
  .aiv-video-task-config,
  .aiv-video-task-meta,
  .aiv-workspace-body,
  .aiv-edit-source-row,
  .aiv-modal-body.video-task {
    grid-template-columns: minmax(0, 1fr);
  }

  .aiv-review-preview {
    position: static;
  }
}

@media (max-width: 760px) {
  .aiv-topbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .aiv-stepper,
  .aiv-source-board,
  .aiv-default-grid,
  .aiv-model-grid,
  .aiv-template-grid,
  .aiv-ai-asset-board,
  .aiv-video-config-grid,
  .aiv-result-card-grid,
  .aiv-version-rail,
  .aiv-video-task-assets,
  .aiv-video-task-assets.picker,
  .aiv-action-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .aiv-review-toolbar {
    grid-template-columns: minmax(0, 1fr);
  }

  .aiv-style-head,
  .aiv-section-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .aiv-style-title-row {
    align-items: flex-start;
    flex-wrap: wrap;
    white-space: normal;
  }

  .aiv-style-title-row .aiv-title-meta {
    flex-basis: 100%;
    white-space: normal;
  }

  .aiv-collapse-head > div:last-child {
    max-width: 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .aiv-material-source-switcher {
    align-items: stretch;
    flex-direction: column;
  }

  .aiv-material-source-switcher > span {
    white-space: normal;
  }

  .aiv-material-source-tabs {
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
