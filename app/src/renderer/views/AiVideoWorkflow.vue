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
      <p v-if="workspacePersistenceError" class="aiv-workspace-persistence-error" role="alert">
        {{ workspacePersistenceError }}
      </p>
    </header>

    <nav class="aiv-stepper" role="tablist" aria-label="AI 视频工作流步骤">
      <button
        v-for="step in steps"
        :key="step.id"
        type="button"
        role="tab"
        :class="['aiv-step', { active: activeStep === step.id, done: step.done }]"
        :aria-pressed="activeStep === step.id ? 'true' : 'false'"
        :aria-selected="activeStep === step.id"
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
      :inert="hasOpenModal || undefined"
      :aria-busy="materialIsRunning ? 'true' : 'false'"
    >
      <section v-if="activeStep === 'materials'" :class="['aiv-stage-grid', 'aiv-material-stage', { 'params-collapsed': !materialPanelExpanded }]">
        <aside :class="['aiv-panel', 'aiv-params-panel', { collapsed: !materialPanelExpanded }]">
          <header class="aiv-panel-head">
            <div v-if="materialPanelExpanded">
              <strong>森马云盘视频素材图下载</strong>
              <span>云盘找图 · 本地规整 · 可恢复任务</span>
              <span class="aiv-material-task-state" :class="`is-${materialTaskStage.id}`">
                <i aria-hidden="true"></i>{{ materialTaskStage.label }}
              </span>
            </div>
            <div v-else class="aiv-collapsed-material-summary">
              <strong>找图</strong>
              <span>{{ materialIsRunning ? '进行中' : materialTask.status === 'failed' ? '失败' : '待命' }}</span>
            </div>
            <button
              type="button"
              :class="['aiv-collapse-action', `direction-${balaMaterialPanelControl(materialPanelExpanded).direction}`]"
              :aria-expanded="materialPanelExpanded"
              :aria-label="balaMaterialPanelControl(materialPanelExpanded).ariaLabel"
              aria-controls="aiv-material-params-body"
              @click="materialPanelExpanded = !materialPanelExpanded"
            >
              <span>{{ balaMaterialPanelControl(materialPanelExpanded).label }}</span>
              <span
                class="aiv-collapse-chevron"
                :data-direction="balaMaterialPanelControl(materialPanelExpanded).direction"
                aria-hidden="true"
              ></span>
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
            <section v-if="materialWorkspaceRequired" class="aiv-material-workspace-callout" role="alert">
              <strong>请先选择 AI 视频工作区目录</strong>
              <span>下载的素材、改图结果和视频任务都会保存在这个目录中。</span>
              <button type="button" class="aiv-primary small" @click="pickMaterialOutputDirectory">现在选择文件夹</button>
            </section>
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
          <header class="aiv-panel-head aiv-material-results-head">
            <div>
              <strong>素材回显</strong>
              <span>按款号分组选择进入 AI 改图的模拍图和细节图</span>
            </div>
            <div class="aiv-material-header-stats" aria-label="找图批次概览">
              <div class="aiv-material-stat">
                <strong>{{ materialGroups.length }}</strong>
                <span>款号</span>
              </div>
              <div class="aiv-material-stat">
                <strong>{{ materialSummary.modelCount + materialSummary.detailCount }}</strong>
                <span>已回显素材</span>
              </div>
              <div class="aiv-material-stat selected">
                <strong>{{ selectedMaterialCount }}</strong>
                <span>已选择</span>
              </div>
              <p class="aiv-material-selection-summary">{{ materialTaskStage.detail }}</p>
            </div>
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
            <div class="aiv-material-source-actions">
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
              <button
                type="button"
                class="aiv-ghost small"
                :class="{ active: materialShowSelectedOnly }"
                :aria-pressed="materialShowSelectedOnly"
                @click="materialShowSelectedOnly = !materialShowSelectedOnly"
              >
                {{ materialShowSelectedOnly ? '显示全部素材' : '只看已选素材' }}
              </button>
              <div class="aiv-material-view-switcher" role="tablist" aria-label="素材展示方式">
                <button
                  type="button"
                  role="tab"
                  :class="{ active: materialDisplayMode === 'grid' }"
                  :aria-selected="materialDisplayMode === 'grid'"
                  @click="materialDisplayMode = 'grid'"
                >平铺</button>
                <button
                  type="button"
                  role="tab"
                  :class="{ active: materialDisplayMode === 'list' }"
                  :aria-selected="materialDisplayMode === 'list'"
                  @click="materialDisplayMode = 'list'"
                >列表</button>
              </div>
              <button type="button" class="aiv-ghost small" @click="toggleStyleEditSelection(activeMaterialGroup)">
                {{ styleEditSelectionLabel(activeMaterialGroup) }}
              </button>
              <button type="button" class="aiv-ghost small" @click="toggleAllEditSelection">
                {{ allEditSelectionLabel }}
              </button>
            </div>
            <span>{{ activeMaterialSource === 'model' ? '默认优先确认模拍图' : '已切换到细节图' }}</span>
          </div>

          <div ref="materialStyleListRef" class="aiv-panel-body aiv-style-list">
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
                  <div :class="['aiv-thumb-grid', { 'is-list': materialDisplayMode === 'list' }]">
                    <article
                      v-for="asset in visibleMaterialAssets(activeMaterialGroup.styleCode, 'model', activeMaterialGroup.modelPhotos)"
                      :key="asset.id || asset.path"
                      :class="['aiv-thumb', { selected: asset.selected, 'is-list': materialDisplayMode === 'list' }]"
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
                      <span class="aiv-thumb-filename" :title="asset.name">{{ shortDisplayName(asset.name, 34) }}</span>
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
                  <div :class="['aiv-thumb-grid', { 'is-list': materialDisplayMode === 'list' }]">
                    <article
                      v-for="asset in visibleMaterialAssets(activeMaterialGroup.styleCode, 'detail', activeMaterialGroup.detailPhotos)"
                      :key="asset.id || asset.path"
                      :class="['aiv-thumb', { selected: asset.selected, muted: asset.muted, 'is-list': materialDisplayMode === 'list' }]"
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
                      <span class="aiv-thumb-filename" :title="asset.name">{{ shortDisplayName(asset.name, 34) }}</span>
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
            <div class="aiv-action-grid" role="tablist" aria-label="AI 改图动作">
              <button
                v-for="action in aiActions"
                :key="action.id"
                type="button"
                role="tab"
                :class="['aiv-action-option', { active: activeAction === action.id }]"
                :aria-selected="activeAction === action.id"
                :aria-label="`${action.title}：${activeAction === action.id ? '当前已选择' : action.requirement}`"
                @click="activeAction = action.id"
              >
                <component :is="aiActionIcons[action.id]" class="aiv-action-option-icon" aria-hidden="true" />
                <span class="aiv-action-option-copy">
                  <strong>{{ action.shortTitle }}</strong>
                </span>
              </button>
            </div>
            <p class="aiv-action-grid-hint">
              <strong>{{ activeAiAction.title }}</strong>
              <span>{{ activeAiAction.requirement }}</span>
            </p>

            <section v-if="activeAction === 'face_swap'" class="aiv-selected-model-preview" aria-label="AI 换脸模特">
              <div class="aiv-selected-model-thumb">
                <img
                  v-if="selectedModel && modelPreviewSource(selectedModel) && !brokenPreviews[modelPreviewSource(selectedModel)]"
                  :src="modelPreviewSource(selectedModel)"
                  :alt="selectedModel.label || '已选模特'"
                  @error="markPreviewBroken(modelPreviewSource(selectedModel))"
                />
                <span v-else aria-hidden="true">模特</span>
              </div>
              <div class="aiv-selected-model-copy">
                <span>AI 模特</span>
                <strong>{{ selectedModel?.label || '尚未选择模特' }}</strong>
              </div>
              <button type="button" class="aiv-ghost small" @click="openModelLibrary">
                {{ selectedModel ? '更换模特' : '选择模特' }}
              </button>
            </section>

            <div v-if="activeAction === 'outfit_swap'" class="aiv-upload-strip vertical">
              <div class="aiv-file-picker">
                <div>
                  <strong>服装图</strong>
                  <span>{{ selectedPathSummary(garmentImagePaths) }}</span>
                </div>
                <button type="button" class="aiv-ghost small" @click="openLocalMaterialLibrary('garment')">选择</button>
                <button v-if="garmentImagePaths.length" type="button" class="aiv-ghost small" @click="clearOutfitImages('garment')">清空</button>
              </div>
              <div class="aiv-file-picker">
                <div>
                  <strong>搭配参考图</strong>
                  <span>{{ selectedPathSummary(outfitReferencePaths) }}</span>
                </div>
                <button type="button" class="aiv-ghost small" @click="openLocalMaterialLibrary('outfit')">选择</button>
                <button v-if="outfitReferencePaths.length" type="button" class="aiv-ghost small" @click="clearOutfitImages('outfit')">清空</button>
              </div>
              <div class="aiv-file-picker">
                <div>
                  <strong>同款不同色</strong>
                  <span>{{ selectedPathSummary(variantReferencePaths) }}</span>
                </div>
                <button type="button" class="aiv-ghost small" @click="openLocalMaterialLibrary('variant')">选择</button>
                <button v-if="variantReferencePaths.length" type="button" class="aiv-ghost small" @click="clearOutfitImages('variant')">清空</button>
              </div>
            </div>

            <label class="aiv-field">
              <span>生图模型</span>
              <select v-if="configuredAiImageModels.length" v-model="selectedAiImageModelId" :disabled="aiIsRunning">
                <option v-for="model in configuredAiImageModels" :key="model.id" :value="model.id">{{ model.label }}</option>
              </select>
              <div v-else class="aiv-model-config-empty">
                <span>尚未配置可用生图模型</span>
                <button type="button" class="aiv-ghost small" @click="openAiImageModelSettings">去配置 1XM 图片模型</button>
              </div>
            </label>

            <label class="aiv-field">
              <span class="aiv-field-heading">
                <span>{{ activePromptLabel }}</span>
                <button
                  v-if="activeAction === 'pose_swap'"
                  type="button"
                  class="aiv-ghost small"
                  @click="promptLibraryTarget = 'workspace'; promptLibraryOpen = true"
                >从 Prompt 库选择</button>
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
              :disabled="aiIsRunning || !configuredAiImageModels.length"
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
            <div class="aiv-inline-actions">
              <button type="button" class="aiv-ghost small" @click="toggleAllEditSelection">{{ allEditSelectionLabel }}</button>
              <button
                type="button"
                :class="['aiv-ghost', 'small', { active: showSelectedVersionsOnly }]"
                @click="showSelectedVersionsOnly = !showSelectedVersionsOnly"
              >
                {{ showSelectedVersionsOnly ? '显示全部版本' : '只看已选版本' }}
              </button>
            </div>
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
                  <button type="button" class="aiv-ghost small" @click.stop="toggleStyleEditSelection(style)">{{ styleEditSelectionLabel(style) }}</button>
                  <span class="aiv-badge orange">原图 {{ editSourcesForStyle(style).length }}</span>
                  <span class="aiv-badge">版本 {{ versionCountForStyle(style) }}</span>
                  <span class="aiv-workspace-collapse" :class="{ expanded: isMaterialExpanded(style.styleCode) }">
                    <span>{{ isMaterialExpanded(style.styleCode) ? '收起图片' : '展开图片' }}</span>
                    <IconChevronDown class="aiv-workspace-collapse-icon" :size="16" :stroke-width="2.4" aria-hidden="true" />
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
                  <section class="aiv-edit-origin-zone" aria-label="原图区">
                    <div class="aiv-edit-lane-head">
                      <strong>原图区</strong>
                      <span>改图输入</span>
                    </div>
                    <article :class="['aiv-media-card', 'aiv-original-card', { selected: source.editSelected }]">
                      <button
                        type="button"
                        class="aiv-media-select"
                        :aria-pressed="Boolean(source.editSelected)"
                        :aria-label="`${source.name}：${source.editSelected ? '取消选择' : '选择'}为本次改图输入`"
                        @click="toggleEditInputSelection(source)"
                      >
                        <img
                          v-if="previewSourceFor(source) && !brokenPreviews[previewSourceFor(source)]"
                          :src="previewSourceFor(source)"
                          :alt="source.name"
                          @error="markPreviewBroken(previewSourceFor(source))"
                        />
                        <span v-if="source.editSelected" class="aiv-selected-indicator">已选</span>
                      </button>
                      <div class="aiv-media-hover-tools">
                        <div>
                          <span class="aiv-origin-label">原图</span>
                          <strong :title="source.name">{{ shortDisplayName(source.name) }}</strong>
                          <small>{{ source.role }} · {{ style.styleCode }}</small>
                        </div>
                        <button type="button" class="aiv-thumb-zoom" title="大图修改" @click="openImageEditor(source, style.styleCode)">
                          <span aria-hidden="true">⌕</span>
                        </button>
                      </div>
                    </article>
                  </section>
                  <span class="aiv-edit-lane-connector" aria-hidden="true">→</span>
                  <section class="aiv-edit-ai-zone" aria-label="AI 改图区">
                    <div class="aiv-edit-lane-head">
                      <div>
                        <strong>AI 改图区</strong>
                        <span>{{ visibleSourceVersions(source, showSelectedVersionsOnly).length }} 个版本</span>
                      </div>
                      <small>左右滑动查看</small>
                    </div>
                    <div class="aiv-version-rail">
                      <article
                        v-for="version in visibleSourceVersions(source, showSelectedVersionsOnly)"
                        :key="version.id"
                        :class="['aiv-media-card', 'aiv-version-card', { selected: version.editSelected, loading: version.status === 'running' }]"
                      >
                        <button
                          type="button"
                          class="aiv-media-select"
                          :aria-pressed="Boolean(version.editSelected)"
                          :aria-label="`${version.label || 'AI 修改'}：${version.editSelected ? '取消选择' : '选择'}为本次改图输入`"
                          @click="toggleEditInputSelection(version)"
                        >
                          <img
                            v-if="versionPreviewSource(version, source) && !brokenPreviews[versionPreviewSource(version, source)]"
                            :src="versionPreviewSource(version, source)"
                            :alt="`${version.label || 'AI 修改'}预览`"
                            @error="markPreviewBroken(versionPreviewSource(version, source))"
                          />
                          <span v-if="version.editSelected" class="aiv-selected-indicator">已选</span>
                        </button>
                        <div class="aiv-media-hover-tools">
                          <div>
                            <span>{{ version.action }}</span>
                            <strong :title="version.label">{{ shortDisplayName(version.label) }}</strong>
                            <small :title="version.meta">{{ shortDisplayName(version.meta, 36) }}</small>
                          </div>
                          <div v-if="version.status === 'running'" class="aiv-version-generation-status" role="status">
                            <span>生成中 <strong>{{ version.progress || 0 }}%</strong></span>
                            <i class="aiv-mini-progress" :style="{ '--progress': `${version.progress || 0}%` }" aria-hidden="true"></i>
                          </div>
                          <div class="aiv-version-actions">
                            <button type="button" class="aiv-version-edit" @click="openImageEditor(version, style.styleCode, source)">大图修改</button>
                            <button type="button" class="aiv-version-delete" @click="requestDeleteGeneratedVersion(style, source, version)">删除</button>
                          </div>
                        </div>
                      </article>
                      <button
                        type="button"
                        class="aiv-version-card add"
                        :title="`将 ${source.name} 选为本次改图输入，再在左侧选择动作后点开始生图`"
                        @click="continueEditingSource(source)"
                      >
                        <strong>继续改这张</strong>
                        <small>选中本图 · 用左侧动作再生成</small>
                      </button>
                    </div>
                  </section>
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
              <span>支持新增图、通过、舍弃、重试和输出到视频任务</span>
            </div>
            <div class="aiv-review-summary-badges">
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
            <div class="aiv-review-toolbar-actions">
              <button type="button" class="aiv-ghost small" @click="requestPendingReviewStatus('approved')">待审全通过</button>
              <button type="button" class="aiv-ghost small danger" @click="requestPendingReviewStatus('rejected')">待审全舍弃</button>
              <button type="button" class="aiv-ghost small" @click="refreshReviewBatch">刷新审核池</button>
            </div>
          </div>
          <div class="aiv-review-selection-bar" aria-label="批量选择审核图片">
            <div class="aiv-review-selection-copy">
              <strong>已选 {{ selectedVisibleReviewAssets.length }} 张</strong>
              <span>仅作用于当前筛选结果</span>
            </div>
            <div class="aiv-review-selection-actions">
              <button type="button" class="aiv-ghost small" :disabled="!visibleReviewAssetCount" @click="toggleAllVisibleReviewAssetSelections">
                {{ allVisibleReviewAssetsSelected ? '取消全选' : '全选当前筛选项' }}
              </button>
              <button type="button" class="aiv-ghost small" :disabled="!selectedVisibleReviewAssets.length" @click="clearReviewAssetSelection">清空</button>
              <button type="button" class="aiv-ghost small ok" :disabled="!selectedVisibleReviewAssets.length" @click="requestSelectedReviewStatus('approved')">批量通过</button>
              <button type="button" class="aiv-ghost small danger" :disabled="!selectedVisibleReviewAssets.length" @click="requestSelectedReviewStatus('rejected')">批量舍弃</button>
            </div>
          </div>
          <div v-if="reviewActionError" class="aiv-inline-error aiv-review-action-error" role="alert">{{ reviewActionError }}</div>
          <div v-if="recentReviewBulkAction" class="aiv-review-undo" role="status">
            <span>{{ recentReviewBulkAction.scopeLabel }}已{{ recentReviewBulkAction.status === 'approved' ? '通过' : '舍弃' }} {{ recentReviewBulkAction.entries.length }} 张图片。</span>
            <button type="button" class="aiv-ghost small" @click="undoReviewBulkAction">撤销本次批量操作</button>
          </div>

          <div class="aiv-panel-body aiv-review-style-list">
            <article v-for="style in filteredReviewStyles" :key="style.styleCode" class="aiv-review-style-card">
              <div class="aiv-style-head">
                <div>
                  <strong>{{ style.styleCode }}</strong>
                  <span>{{ reviewAssetCount(style, 'origin') }} 张原图 · {{ reviewAssetCount(style, 'ai') }} 张 AI 图 · {{ style.sourceAssets.length }} 张参考素材</span>
                </div>
                <div class="aiv-review-actions">
                  <button type="button" class="aiv-ghost small" @click="requestStyleReviewStatus(style, 'approved')">本款全通过</button>
                  <button type="button" class="aiv-ghost small" @click="openAddImageMenu(style.styleCode)">新增图片</button>
                </div>
              </div>

              <section class="aiv-ai-asset-board">
                <article
                  v-for="asset in style.assets"
                  :key="asset.id"
                  :class="['aiv-ai-card', asset.status, { selected: isReviewAssetSelected(asset), saving: isReviewAssetSaving(asset), 'has-feedback': reviewAssetFeedback[asset.id] }]"
                >
                  <button type="button" class="aiv-ai-preview" :title="asset.label" @click="openImagePreview(asset, style.styleCode)">
                    <img
                      v-if="previewSourceFor(asset) && !brokenPreviews[previewSourceFor(asset)]"
                      :src="previewSourceFor(asset)"
                      :alt="asset.label"
                      loading="lazy"
                      decoding="async"
                      @error="markPreviewBroken(previewSourceFor(asset))"
                    />
                    <template v-else>
                      <span>{{ asset.label }}</span>
                      <small>{{ asset.action }}</small>
                    </template>
                    <i class="aiv-ai-status-badge">{{ assetStatusLabel(asset.status) }}</i>
                    <span class="aiv-ai-preview-zoom" aria-hidden="true">
                      <IconZoomIn />
                      查看大图
                    </span>
                  </button>
                  <span v-if="reviewAssetFeedback[asset.id]" :class="['aiv-review-card-feedback', reviewAssetFeedback[asset.id]]" role="status">
                    {{ reviewAssetFeedbackLabel(asset) }}
                  </span>
                  <footer>
                    <div class="aiv-ai-card-copy">
                      <strong :title="asset.label">{{ asset.label }}</strong>
                      <span :title="asset.meta">{{ asset.meta }}</span>
                    </div>
                    <div class="aiv-ai-actions">
                      <button type="button" class="ok" :disabled="isReviewAssetSaving(asset)" @click="setReviewAssetStatus(asset, 'approved')">通过</button>
                      <button type="button" class="danger" :disabled="isReviewAssetSaving(asset)" @click="setReviewAssetStatus(asset, 'rejected')">舍弃</button>
                      <button type="button" :disabled="isReviewAssetSaving(asset)" @click="requestReviewAssetRetry(asset)">
                        {{ canRegenerateRemoteReviewAsset(asset) ? '重跑' : '继续改图' }}
                      </button>
                      <label :class="['aiv-review-card-select', { selected: isReviewAssetSelected(asset) }]" :title="`${isReviewAssetSelected(asset) ? '取消选择' : '选择'} ${asset.label}`">
                        <input
                          type="checkbox"
                          :checked="isReviewAssetSelected(asset)"
                          :disabled="isReviewAssetSaving(asset)"
                          @change="toggleReviewAssetSelection(asset)"
                        />
                        <IconCheck class="aiv-review-card-select-icon" :size="14" :stroke-width="3" aria-hidden="true" />
                        <span class="aiv-sr-only">{{ isReviewAssetSelected(asset) ? '取消选择' : '选择' }} {{ asset.label }}</span>
                      </label>
                    </div>
                  </footer>
                </article>

                <article class="aiv-ai-card add">
                  <button type="button" class="aiv-add-image" @click="openAddImageMenu(style.styleCode)">
                    <strong>新增图片</strong>
                    <span>本地上传或继续 AI 改图</span>
                  </button>
                  <div class="aiv-add-menu" v-if="addImageMenuStyle === style.styleCode">
                    <button type="button" @click="uploadLocalReviewImage(style.styleCode)">上传本地图</button>
                    <button type="button" @click="activeStep = 'ai-edit'; activeAction = 'face_swap'">AI 换脸</button>
                    <button type="button" @click="activeStep = 'ai-edit'; activeAction = 'background_swap'">AI 换背景</button>
                    <button type="button" @click="activeStep = 'ai-edit'; activeAction = 'outfit_swap'">AI 换装</button>
                    <button type="button" @click="activeStep = 'ai-edit'; activeAction = 'pose_swap'">AI 换姿势</button>
                  </div>
                </article>
              </section>

              <section class="aiv-source-assets-row">
                <strong>主图 / 参考图</strong>
                <button v-for="asset in visibleReviewSourceAssets(style)" :key="asset.name" type="button" class="aiv-source-pill">
                  {{ asset.role }} · {{ asset.name }}
                </button>
                <details v-if="hiddenReviewSourceAssetCount(style)" class="aiv-source-assets-more">
                  <summary>其余 {{ hiddenReviewSourceAssetCount(style) }} 张</summary>
                  <div>
                    <button v-for="asset in hiddenReviewSourceAssets(style)" :key="asset.name" type="button" class="aiv-source-pill">
                      {{ asset.role }} · {{ asset.name }}
                    </button>
                  </div>
                </details>
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
            <div class="aiv-video-toolbar-actions">
              <button type="button" class="aiv-primary" @click="openVideoTaskDialog()">新增视频任务</button>
              <button type="button" class="aiv-ghost" @click="activeStep = 'results'">查看结果</button>
              <button type="button" class="aiv-ghost small" :disabled="videoIsRunning || !selectedVisibleVideoTasks.length" @click="runSelectedVideoTasks('plan')">批量预检{{ selectedVisibleVideoTasks.length ? ` (${selectedVisibleVideoTasks.length})` : '' }}</button>
              <button type="button" class="aiv-primary small" :disabled="videoIsRunning || !selectedVisibleVideoTasks.length" @click="runSelectedVideoTasks('live')">批量提交{{ selectedVisibleVideoTasks.length ? ` (${selectedVisibleVideoTasks.length})` : '' }}</button>
              <button type="button" class="aiv-ghost small" :disabled="!videoResults.length" @click="downloadCompletedVideoResults">只下载已完成视频</button>
            </div>
          </header>
          <div class="aiv-video-task-filterbar">
            <div class="aiv-video-task-status-tabs" role="tablist" aria-label="视频任务状态筛选">
              <button
                v-for="tab in videoTaskStatusTabs"
                :key="tab.id"
                type="button"
                role="tab"
                :class="{ active: videoTaskStatusFilter === tab.id }"
                :aria-selected="videoTaskStatusFilter === tab.id"
                @click="videoTaskStatusFilter = tab.id"
              >
                {{ tab.label }} <strong>{{ tab.count }}</strong>
              </button>
            </div>
            <label class="aiv-video-task-select-all">
              <input
                type="checkbox"
                :checked="allVisibleVideoTasksSelected"
                :indeterminate.prop="selectedVisibleVideoTasks.length > 0 && !allVisibleVideoTasksSelected"
                :disabled="!selectableVisibleVideoTasks.length"
                @change="toggleAllVisibleVideoTaskSelection"
              />
              <span>全选当前筛选</span>
            </label>
            <span class="aiv-video-task-selection-hint">已勾选 {{ selectedVisibleVideoTasks.length }} 条可提交任务；已生成或已下载的视频不会重复提交。</span>
          </div>
          <div v-if="videoStageState.error" class="aiv-inline-error aiv-video-stage-feedback" role="alert">{{ videoStageState.error }}</div>
          <div v-else-if="videoStageState.message && videoStageState.status !== 'idle'" class="aiv-stage-feedback" role="status">{{ videoStageState.message }}</div>
        </section>

        <section class="aiv-video-task-list">
          <article v-for="task in filteredVideoTasks" :key="task.id" :class="['aiv-panel', 'aiv-video-task-card', { selected: isVideoTaskSelected(task) }]">
            <div class="aiv-video-task-row">
              <div class="aiv-video-task-assets compact">
                <label class="aiv-video-task-check" :title="videoTaskSelectionLabel(task)">
                  <input type="checkbox" :checked="isVideoTaskSelected(task)" :disabled="!isVideoTaskSubmittable(task)" @change="toggleVideoTaskSelection(task)" />
                  <span class="aiv-sr-only">{{ videoTaskSelectionLabel(task) }}</span>
                </label>
                <button
                  v-for="asset in task.assets.slice(0, 4)"
                  :key="asset.id"
                  type="button"
                  :class="['aiv-video-asset-card', 'thumb-only', 'selected', { pending: asset.status !== 'approved' }]"
                  :title="asset.label"
                  @click="openImagePreview(asset, task.styleCode)"
                >
                  <img
                    v-if="previewSourceFor(asset) && !brokenPreviews[previewSourceFor(asset)]"
                    :src="previewSourceFor(asset)"
                    :alt="asset.label"
                    @error="markPreviewBroken(previewSourceFor(asset))"
                  />
                  <span v-else class="aiv-video-thumb-fallback">图</span>
                </button>
                <span v-if="task.assets.length > 4" class="aiv-video-more-assets">+{{ task.assets.length - 4 }}</span>
              </div>
              <div class="aiv-video-task-main">
                <div class="aiv-video-task-title-line">
                  <strong :title="`${task.styleCode} · ${task.title}`">{{ task.styleCode }} · {{ task.title }}</strong>
                  <span class="aiv-video-task-stage" :class="`is-${videoTaskStage(task).id}`" :title="videoTaskStage(task).message"><i></i>{{ videoTaskStage(task).label }}</span>
                  <span class="aiv-video-task-status">{{ task.assets.length }} 张素材 · {{ approvedVideoTaskAssetCount(task) }} 已审核 · {{ task.status }}</span>
                  <span :class="['aiv-badge', task.provider !== 'qn' ? 'orange' : '']">{{ providerLabel(task.provider) }}</span>
                  <span :class="['aiv-badge', task.template ? 'orange' : '']">
                    {{ videoTaskResultTemplateLabel(task) }}
                  </span>
                </div>
                <div class="aiv-video-task-meta-line">
                  <span><strong>素材</strong>{{ task.assets.length }} 张组成一条视频</span>
                  <span
                    v-if="isApiVideoProvider(task.provider)"
                    :title="videoTaskParamSummary(task)"
                  ><strong>参数</strong>{{ videoTaskParamSummary(task) }}</span>
                  <span :title="task.prompt || '生意管家页面生成可不填写 Prompt'"><strong>Prompt</strong>{{ task.prompt || '可不填写' }}</span>
                  <span :title="task.outputDir"><strong>输出</strong>{{ shortDisplayPath(task.outputDir) }}</span>
                </div>
              </div>
              <div class="aiv-video-task-actions">
                <button type="button" class="aiv-ghost small" :disabled="isVideoTaskBusy(task)" @click="openVideoTaskDialog('', task, 'edit')">编辑</button>
                <button type="button" class="aiv-ghost small" @click="openVideoTaskDialog('', task, 'copy')">复制</button>
                <button v-if="task.provider === 'qn'" type="button" class="aiv-ghost small" @click="openTemplateLibrary(task.styleCode)">模板</button>
                <button v-if="task.provider !== 'qn'" type="button" class="aiv-ghost small" @click="openAiCapabilitySettings(task.provider)">配置</button>
                <button type="button" class="aiv-ghost small" :disabled="isVideoTaskBusy(task) || !isVideoTaskSubmittable(task)" @click="runVideoTask(task, 'plan')">预检</button>
                <button type="button" class="aiv-primary small" :disabled="isVideoTaskBusy(task) || (!isVideoTaskSubmittable(task) && !videoTaskHasViewableResult(task))" @click="handleVideoTaskAction(task)">{{ videoTaskActionLabel(task) }}</button>
              </div>
            </div>
          </article>
          <div v-if="!videoTasks.length" class="aiv-empty-inline">
            先点击“新增视频任务”，为单个款号选择图片、供应商和 Prompt。
          </div>
          <div v-else-if="!filteredVideoTasks.length" class="aiv-empty-inline">
            当前状态下没有视频任务，请切换状态筛选查看。
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
              <button type="button" class="aiv-ghost small" :disabled="videoIsRunning || !hasRefreshableVideoTask" @click="refreshVideoResults">刷新状态</button>
              <button type="button" class="aiv-ghost small" :disabled="!clearableVideoResults.length" @click="requestClearVideoHistory">清理历史</button>
              <button type="button" class="aiv-ghost small" :disabled="!videoOutputDir" @click="openOutputDir">打开输出目录</button>
            </div>
          </header>
          <div class="aiv-panel-body">
            <section class="aiv-progress-overview">
              <div>
                <strong>任务概览</strong>
                <span>{{ completedVideoCount }} 个已下载；{{ videoResults.length }} 条已有结果记录</span>
              </div>
              <div class="aiv-result-stage-summary" aria-label="视频任务阶段汇总">
                <span v-for="stage in videoResultStageSummary" :key="stage.id">{{ stage.label }} {{ stage.count }}</span>
              </div>
              <template v-if="overallVideoProgress !== null">
                <span class="aiv-live-progress-label">仅按供应商已回传的生成进度计算：{{ overallVideoProgress }}%</span>
                <i class="aiv-progress-bar" :style="{ '--progress': `${overallVideoProgress}%` }"></i>
              </template>
            </section>
            <div v-if="videoStageState.error" class="aiv-inline-error aiv-video-stage-feedback" role="alert">{{ videoStageState.error }}</div>
            <div v-else-if="videoStageState.message && videoStageState.status !== 'idle'" class="aiv-stage-feedback" role="status">{{ videoStageState.message }}</div>
            <div class="aiv-result-card-grid">
              <div v-if="!videoResults.length" class="aiv-result-empty">
                <strong>还没有视频结果</strong>
                <span>先回到“生视频”创建视频任务，完成预检后再点击“生成视频”。</span>
                <button type="button" class="aiv-primary small" @click="activeStep = 'templates'">去创建视频任务</button>
              </div>
              <article v-for="item in videoResults" :key="item.id" class="aiv-result-card">
                <div class="aiv-result-preview">
                  <video
                    :ref="element => setVideoResultElement(item, element)"
                    v-if="videoPlaybackSource(item) && !brokenPreviews[videoPlaybackSource(item)]"
                    :src="videoPlaybackSource(item)"
                    :autoplay="videoResultToPlayId === item.id"
                    :muted="videoResultToPlayId === item.id"
                    controls
                    playsinline
                    preload="metadata"
                    @canplay="handleVideoResultCanPlay(item)"
                    @error="markPreviewBroken(videoPlaybackSource(item))"
                  ></video>
                  <div v-else-if="videoResultIsLoading(item)" class="aiv-result-preview-loading" role="status" aria-live="polite">
                    <div class="aiv-result-spinner" aria-hidden="true"></div>
                    <strong>{{ item.styleCode }}</strong>
                    <span>{{ videoResultStage(item).message }}</span>
                  </div>
                  <div v-else class="aiv-result-preview-empty">
                    <strong>{{ item.styleCode }}</strong>
                    <span>{{ videoPlaybackLoading(item) ? '正在载入本地视频预览' : item.status === '已完成' ? '视频文件暂不可播放' : '等待视频生成结果' }}</span>
                  </div>
                </div>
                <div class="aiv-result-copy">
                  <header>
                    <div>
                      <strong>{{ item.styleCode }} · {{ item.template }}</strong>
                      <span>{{ item.taskId }}</span>
                    </div>
                    <span :class="['aiv-badge', { orange: videoResultStage(item).id === 'downloaded' }]">{{ videoResultStage(item).label }}</span>
                  </header>
                  <i v-if="videoResultHasLiveProgress(item)" class="aiv-progress-bar slim" :style="{ '--progress': `${item.progress}%` }"></i>
                  <p v-if="item.error" class="aiv-result-error">{{ item.error }}</p>
                  <p v-else>{{ videoResultStage(item).message }}</p>
                  <footer>
                    <button v-if="videoResultHasOutput(item)" type="button" class="aiv-ghost small" @click="openVideoResult(item)">预览</button>
                    <button v-else-if="canRefreshVideoResult(item)" type="button" class="aiv-ghost small" @click="refreshSingleVideoResult(item)">刷新状态</button>
                    <button v-else-if="canDownloadVideoResult(item)" type="button" class="aiv-ghost small" @click="downloadVideoResult(item)">下载视频</button>
                    <button v-if="videoResultHasOutput(item)" type="button" class="aiv-primary small" @click="openVideoResult(item)">打开文件</button>
                    <button v-if="isClearableVideoResult(item)" type="button" class="aiv-ghost small aiv-result-clear" @click="requestClearVideoResult(item)">清除</button>
                    <button
                      v-if="!videoResultHasOutput(item) && !canRefreshVideoResult(item) && !canDownloadVideoResult(item)"
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
              <button type="button" class="aiv-primary" :disabled="!videoOutputDir" @click="openOutputDir">打开结果目录</button>
            </div>
          </div>
        </section>
      </section>
    </main>

    <div v-if="previewImage" class="aiv-modal aiv-preview-modal" @click.self="closePreview">
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
          <div class="aiv-preview-title-block">
            <div class="aiv-preview-title-main">
              <strong id="aiv-preview-title" :title="previewImage.title">{{ shortDisplayName(previewImage.title, 42) }}</strong>
              <span class="aiv-preview-version-count">版本 {{ previewHistoryIndex + 1 }} / {{ previewHistoryItems.length }}</span>
            </div>
            <span :title="previewImage.meta">{{ previewImage.meta }}</span>
          </div>
          <button type="button" class="aiv-ghost small" @click="closePreview">关闭</button>
        </header>
        <div class="aiv-image-editor-layout">
          <section class="aiv-image-editor-stage">
            <div class="aiv-big-preview">
              <div class="aiv-big-preview-frame">
                <div class="aiv-preview-canvas-status" aria-live="polite">
                  <strong>{{ activePreviewHistoryItem?.action || '原图' }}</strong>
                  <span>当前编辑版本</span>
                </div>
                <img
                  v-if="activePreviewHistoryItem?.src && !brokenPreviews[activePreviewHistoryItem.src]"
                  class="aiv-big-preview-image"
                  :src="activePreviewHistoryItem.src"
                  :alt="activePreviewHistoryItem.label || previewImage.title"
                  @error="markPreviewBroken(activePreviewHistoryItem.src)"
                />
                <div v-else class="aiv-big-preview-placeholder">
                  <strong>{{ previewImage.title }}</strong>
                  <span>{{ previewImage.meta }}</span>
                </div>
                <TldrawAnnotationLayer
                  v-if="activePreviewHistoryItem?.src && !brokenPreviews[activePreviewHistoryItem.src]"
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
              </div>
              <div
                class="aiv-image-annotation-toolbar"
                role="toolbar"
                aria-label="精确标注工具"
                @mousedown.stop
                @pointerdown.stop
                @click.stop
              >
                <button type="button" :class="{ active: previewAnnotationTool === 'draw' }" @click="previewAnnotationTool = previewAnnotationTool === 'draw' ? '' : 'draw'">画笔</button>
                <button type="button" :class="{ active: previewAnnotationTool === 'arrow' }" @click="previewAnnotationTool = previewAnnotationTool === 'arrow' ? '' : 'arrow'">箭头</button>
                <button type="button" :class="{ active: previewAnnotationTool === 'text' }" @click="previewAnnotationTool = previewAnnotationTool === 'text' ? '' : 'text'">文字</button>
                <button type="button" @click="clearPreviewAnnotation">清除标注</button>
              </div>
            </div>
            <div class="aiv-preview-history-strip" aria-label="生成历史">
              <div class="aiv-preview-history-title">
                <strong>生成历史</strong>
                <span>{{ previewHistoryItems.length }} 个版本</span>
              </div>
              <div class="aiv-preview-history-list">
                <button
                  v-for="(item, index) in previewHistoryItems"
                  :key="item.id || item.src || index"
                  type="button"
                  :class="{ active: previewHistoryIndex === index }"
                  :aria-label="`查看版本 ${index + 1}：${item.label}`"
                  @click="previewHistoryIndex = index"
                >
                  <img v-if="item.src" :src="item.src" :alt="item.label" />
                  <span>{{ item.label }}</span>
                </button>
              </div>
            </div>
          </section>
          <aside class="aiv-image-editor-tools">
            <header class="aiv-image-editor-tools-head">
              <div>
                <strong>大图修改</strong>
                <span>修改只作用于当前历史版本</span>
              </div>
              <span class="aiv-editor-current-action">{{ previewEditActionConfig.title }}</span>
            </header>
            <div class="aiv-image-editor-actions" role="tablist" aria-label="大图修改动作">
              <button
                v-for="action in aiActions"
                :key="action.id"
                type="button"
                role="tab"
                :aria-selected="previewEditAction === action.id"
                :class="{ active: previewEditAction === action.id }"
                @click="previewEditAction = action.id"
              >
                <component :is="aiActionIcons[action.id]" aria-hidden="true" />
                <span>{{ action.shortTitle }}</span>
              </button>
            </div>
            <label class="aiv-field">
              <span>生图模型</span>
              <select
                v-if="configuredAiImageModels.length"
                v-model="selectedAiImageModelId"
                :disabled="previewEditBusy"
              >
                <option v-for="model in configuredAiImageModels" :key="model.id" :value="model.id">{{ model.label }}</option>
              </select>
              <div v-else class="aiv-model-config-empty">
                <span>尚未配置可用生图模型</span>
                <button type="button" class="aiv-ghost small" @click="openAiImageModelSettings">去配置 1XM 图片模型</button>
              </div>
            </label>
            <section v-if="previewEditAction === 'face_swap'" class="aiv-preview-model-picker" aria-label="AI 换脸模特">
              <div class="aiv-preview-model-sample">
                <img
                  v-if="selectedModel && modelPreviewSource(selectedModel) && !brokenPreviews[modelPreviewSource(selectedModel)]"
                  :src="modelPreviewSource(selectedModel)"
                  :alt="selectedModel.label"
                  @error="markPreviewBroken(modelPreviewSource(selectedModel))"
                />
                <span v-else aria-hidden="true">模特</span>
              </div>
              <div>
                <strong>AI 模特</strong>
                <span>{{ selectedModel?.label || '尚未选择模特' }}</span>
              </div>
              <button type="button" class="aiv-ghost small" @click="openModelLibrary">{{ selectedModel ? '更换模特' : '选择模特' }}</button>
            </section>
            <section v-if="previewEditAction === 'outfit_swap'" class="aiv-preview-outfit-pickers" aria-label="换装参考图">
              <div class="aiv-file-picker">
                <div>
                  <strong>服装图</strong>
                  <span>{{ selectedPathSummary(garmentImagePaths) }}</span>
                </div>
                <button type="button" class="aiv-ghost small" @click="openLocalMaterialLibrary('garment')">选择</button>
                <button v-if="garmentImagePaths.length" type="button" class="aiv-ghost small" @click="clearOutfitImages('garment')">清空</button>
              </div>
              <div class="aiv-file-picker">
                <div>
                  <strong>搭配参考图</strong>
                  <span>{{ selectedPathSummary(outfitReferencePaths) }}</span>
                </div>
                <button type="button" class="aiv-ghost small" @click="openLocalMaterialLibrary('outfit')">选择</button>
                <button v-if="outfitReferencePaths.length" type="button" class="aiv-ghost small" @click="clearOutfitImages('outfit')">清空</button>
              </div>
              <div class="aiv-file-picker">
                <div>
                  <strong>同款不同色</strong>
                  <span>{{ selectedPathSummary(variantReferencePaths) }}</span>
                </div>
                <button type="button" class="aiv-ghost small" @click="openLocalMaterialLibrary('variant')">选择</button>
                <button v-if="variantReferencePaths.length" type="button" class="aiv-ghost small" @click="clearOutfitImages('variant')">清空</button>
              </div>
            </section>
            <label class="aiv-field">
              <span class="aiv-field-heading">
                <span>当前图片修改 Prompt</span>
                <small>{{ previewEditPrompt.length }} 字</small>
              </span>
              <textarea v-model="previewEditPrompt" rows="6" placeholder="描述只针对当前图片的修改要求"></textarea>
            </label>
            <button v-if="previewEditAction === 'pose_swap'" type="button" class="aiv-ghost wide" @click="promptLibraryTarget = 'preview'; promptLibraryOpen = true">从 Prompt 库选择</button>
            <div v-if="previewEditError" class="aiv-inline-error">{{ previewEditError }}</div>
            <footer class="aiv-image-editor-tools-foot">
              <span>输出将作为当前图片的新版本加入历史</span>
              <button type="button" class="aiv-primary wide" :disabled="previewEditBusy || !configuredAiImageModels.length" @click="runPreviewImageEdit">
                {{ previewEditBusy ? '修改图生成中...' : '生成当前修改' }}
              </button>
            </footer>
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

    <div v-if="pendingVideoHistoryCleanup" class="aiv-modal" @click.self="closeVideoHistoryCleanup">
      <section
        class="aiv-modal-panel aiv-confirm-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="aiv-video-cleanup-title"
        aria-describedby="aiv-video-cleanup-description"
        tabindex="-1"
        data-aiv-dialog
        @keydown.esc.prevent="closeVideoHistoryCleanup"
        @keydown="trapDialogFocus"
      >
        <header class="aiv-modal-head">
          <div>
            <strong id="aiv-video-cleanup-title">清理视频历史</strong>
            <span>失败任务只会清除记录；已完成视频可选择是否删除本地文件。</span>
          </div>
        </header>
        <div class="aiv-confirm-copy">
          <strong>{{ pendingVideoHistoryCleanup.items.length }} 条历史记录将被清除</strong>
          <span id="aiv-video-cleanup-description">“仅清除记录”会保留本地 MP4；删除文件仅作用于抓虾登记的任务输出视频。</span>
          <div v-if="videoHistoryCleanupError" class="aiv-inline-error" role="alert">{{ videoHistoryCleanupError }}</div>
        </div>
        <footer class="aiv-modal-foot">
          <span>删除本地视频后无法恢复</span>
          <div class="aiv-modal-foot-actions">
            <button type="button" class="aiv-ghost" :disabled="videoHistoryCleanupBusy" @click="closeVideoHistoryCleanup">取消</button>
            <button type="button" class="aiv-ghost" :disabled="videoHistoryCleanupBusy" @click="confirmVideoHistoryCleanup(false)">仅清除记录</button>
            <button type="button" class="aiv-danger" :disabled="videoHistoryCleanupBusy || !pendingVideoHistoryCleanup.localPaths.length" @click="confirmVideoHistoryCleanup(true)">
              {{ videoHistoryCleanupBusy ? '正在清理...' : '同时删除本地视频' }}
            </button>
          </div>
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

    <div v-if="localMaterialLibraryOpen" class="aiv-modal aiv-modal-stacked" @click.self="closeLocalMaterialLibrary">
      <section
        class="aiv-modal-panel wide aiv-local-material-modal-panel aiv-picker-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aiv-local-material-title"
        tabindex="-1"
        data-aiv-dialog
        @keydown.esc.prevent="closeLocalMaterialLibrary"
        @keydown="trapDialogFocus"
      >
        <header class="aiv-modal-head">
          <div>
            <strong id="aiv-local-material-title">选择{{ activeLocalReferenceLabel }}</strong>
            <span>{{ localMaterialLibraryScopeLabel }} · 从素材库选取，或从本机上传补充</span>
          </div>
          <button type="button" class="aiv-ghost small" @click="closeLocalMaterialLibrary">关闭</button>
        </header>
        <div class="aiv-local-material-modal-body">
          <div class="aiv-local-material-modal-toolbar aiv-local-material-modal-toolbar-primary">
            <input
              v-model="localMaterialLibraryStyleQuery"
              class="aiv-local-material-style-search"
              type="search"
              placeholder="搜索款号 / 文件名"
              aria-label="搜索款号或文件名"
            />
            <div class="aiv-local-material-modal-toolbar-actions">
              <span>已选 {{ selectedLocalReferenceCount }} 张</span>
              <button type="button" class="aiv-ghost small" @click="uploadLocalMaterialFromDisk">从本地上传</button>
            </div>
          </div>
          <div class="aiv-local-material-style-tabs" role="tablist" aria-label="按款号筛选素材">
            <button
              type="button"
              role="tab"
              :aria-selected="localMaterialLibraryStyleFilter === 'all'"
              :class="['aiv-action-chip', { active: localMaterialLibraryStyleFilter === 'all' }]"
              @click="localMaterialLibraryStyleFilter = 'all'"
            >
              全部款号 <strong>{{ localMaterialLibraryStyleOptions.length }}</strong>
            </button>
            <button
              v-for="styleCode in localMaterialLibraryStyleOptions"
              :key="styleCode"
              type="button"
              role="tab"
              :aria-selected="localMaterialLibraryStyleFilter === styleCode"
              :class="['aiv-action-chip', { active: localMaterialLibraryStyleFilter === styleCode }]"
              @click="localMaterialLibraryStyleFilter = styleCode"
            >
              {{ styleCode }}
            </button>
          </div>
          <div class="aiv-local-material-modal-toolbar">
            <div class="aiv-reference-kind-switcher" role="tablist" aria-label="素材类型">
              <button type="button" role="tab" :aria-selected="localMaterialLibraryCategory === 'all'" :class="['aiv-action-chip', { active: localMaterialLibraryCategory === 'all' }]" @click="localMaterialLibraryCategory = 'all'">全部类型</button>
              <button type="button" role="tab" :aria-selected="localMaterialLibraryCategory === 'model'" :class="['aiv-action-chip', { active: localMaterialLibraryCategory === 'model' }]" @click="localMaterialLibraryCategory = 'model'">模特图</button>
              <button type="button" role="tab" :aria-selected="localMaterialLibraryCategory === 'detail'" :class="['aiv-action-chip', { active: localMaterialLibraryCategory === 'detail' }]" @click="localMaterialLibraryCategory = 'detail'">平拍图</button>
            </div>
            <span class="aiv-local-material-result-count">共 {{ filteredLocalMaterialLibraryAssets.length }} 张</span>
          </div>
          <div class="aiv-local-material-modal-grid">
            <article
              v-for="asset in filteredLocalMaterialLibraryAssets"
              :key="`${asset.styleCode || ''}-${asset.id || asset.path}`"
              :class="['aiv-local-material-card', { selected: localReferenceSelected(asset.path, activeLocalReferenceKind) }]"
              role="button"
              tabindex="0"
              :aria-pressed="localReferenceSelected(asset.path, activeLocalReferenceKind) ? 'true' : 'false'"
              :title="`${asset.styleCode || ''} · ${asset.name}`"
              @click="toggleLocalReference(asset, activeLocalReferenceKind)"
              @keydown.enter.prevent="toggleLocalReference(asset, activeLocalReferenceKind)"
              @keydown.space.prevent="toggleLocalReference(asset, activeLocalReferenceKind)"
            >
              <div class="aiv-local-material-card-preview">
                <img
                  v-if="thumbnailSourceFor(asset) && !brokenPreviews[thumbnailSourceFor(asset)]"
                  :src="thumbnailSourceFor(asset)"
                  :alt="asset.name"
                  loading="lazy"
                  decoding="async"
                  @error="markPreviewBroken(thumbnailSourceFor(asset))"
                />
                <span v-else class="aiv-local-material-card-fallback">{{ localMaterialCategoryLabel(asset) }}</span>
                <i v-if="localReferenceSelected(asset.path, activeLocalReferenceKind)">已选</i>
              </div>
              <p class="aiv-local-material-card-meta">
                <span>{{ asset.styleCode || '未分款' }} · {{ localMaterialCategoryLabel(asset) }}</span>
                <strong>{{ shortDisplayName(asset.name) }}</strong>
              </p>
            </article>
            <div v-if="!filteredLocalMaterialLibraryAssets.length" class="aiv-empty-inline aiv-local-material-empty">
              当前筛选下没有可用素材，可切换款号、类型或从本地上传。
            </div>
          </div>
        </div>
        <footer class="aiv-modal-foot">
          <span class="aiv-picker-selection-summary">{{ activeLocalReferenceLabel }}已选择 {{ selectedLocalReferenceCount }} 张</span>
          <button type="button" class="aiv-primary" @click="closeLocalMaterialLibrary">完成选择</button>
        </footer>
      </section>
    </div>

    <div v-if="modelLibraryOpen" class="aiv-modal aiv-model-library-modal" @click.self="closeModelLibrary">
      <section
        class="aiv-modal-panel aiv-model-library-modal-panel aiv-picker-modal-panel"
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
        <div class="aiv-modal-body model-library">
          <aside class="aiv-modal-filter aiv-model-filter-rail">
            <div class="aiv-picker-filter-group">
              <strong>年龄段</strong>
              <div class="aiv-filter-chip-row">
                <button type="button" :class="['aiv-chip', { active: !modelAgeFilter }]" @click="modelAgeFilter = ''">全部</button>
                <button v-for="age in modelAgeOptions" :key="age" type="button" :class="['aiv-chip', { active: modelAgeFilter === age }]" @click="modelAgeFilter = age">{{ age }}</button>
              </div>
            </div>
            <div class="aiv-picker-filter-group">
              <strong>性别</strong>
              <div class="aiv-filter-chip-row">
                <button type="button" :class="['aiv-chip', { active: !modelGenderFilter }]" @click="modelGenderFilter = ''">全部</button>
                <button v-for="gender in modelGenderOptions" :key="gender" type="button" :class="['aiv-chip', { active: modelGenderFilter === gender }]" @click="modelGenderFilter = gender">{{ gender }}</button>
              </div>
            </div>
            <span v-if="modelLibraryState.loading" class="aiv-filter-note">加载模特库...</span>
            <span v-if="modelLibraryState.error" class="aiv-filter-note error">{{ modelLibraryErrorMessage }}</span>
            <button v-if="modelLibraryState.error" type="button" class="aiv-ghost small aiv-model-retry" @click="loadModelLibrary">重新加载</button>
          </aside>
          <div class="aiv-model-grid-scroll">
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
                    v-if="modelPreviewSource(model) && !brokenPreviews[modelPreviewSource(model)]"
                    :src="modelPreviewSource(model)"
                    :alt="model.name"
                    loading="lazy"
                    decoding="async"
                    @error="markPreviewBroken(modelPreviewSource(model))"
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
        </div>
        <footer class="aiv-modal-foot">
          <span class="aiv-picker-selection-summary">{{ selectedModel ? `已选 ${selectedModel.label}` : '请选择一个模特素材' }}</span>
          <button type="button" class="aiv-primary" @click="closeModelLibrary">确认选择</button>
        </footer>
      </section>
    </div>

    <div v-if="templateLibraryOpen" class="aiv-modal aiv-modal-stacked" @click.self="closeTemplateLibrary">
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
                v-if="templateVideoSource(template) && !brokenPreviews[templateVideoSource(template)]"
                :src="templateVideoSource(template)"
                :poster="templatePosterSource(template)"
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
            <strong id="aiv-video-task-title">{{ editingVideoTaskId ? '编辑视频任务' : '新增视频任务' }}</strong>
            <span>{{ editingVideoTaskId ? '修改素材、Prompt、模板或供应商后，需要重新预检再生成。' : '一个款号可以创建多条视频任务；先从素材库选款，再组合图片、Prompt 和生成方式' }}</span>
          </div>
          <button type="button" class="aiv-ghost small" @click="closeVideoTaskDialog">关闭</button>
        </header>
        <div class="aiv-modal-body video-task">
          <!-- 左：操作栏（对齐 AI 生视频） -->
          <aside class="aiv-video-task-form" aria-label="视频任务参数">
            <section class="aiv-task-readiness" aria-label="视频任务创建条件">
              <div>
                <strong>任务准备</strong>
                <span>已完成 {{ videoTaskDraftCompletedCount }} / {{ videoTaskDraftRequirements.length }} 项</span>
              </div>
              <ul>
                <li v-for="requirement in videoTaskDraftRequirements" :key="requirement.id" :class="{ complete: requirement.complete }">
                  <span aria-hidden="true">{{ requirement.complete ? '✓' : '○' }}</span>{{ requirement.label }}
                </li>
              </ul>
            </section>

            <section :class="['aiv-video-style-library', { 'aiv-field-invalid': !videoTaskDraftRequirement('style')?.complete }]">
              <header>
                <strong>选择款号</strong>
                <span>{{ videoTaskDraftRequirement('style')?.complete ? '一个任务只用一个款号' : videoTaskDraftRequirement('style')?.message }}</span>
              </header>
              <div class="aiv-video-style-tabs" role="tablist" aria-label="视频任务款号">
                <button
                  v-for="job in videoJobs"
                  :id="`video-task-style-${job.styleCode}`"
                  :key="job.styleCode"
                  type="button"
                  role="tab"
                  :class="{ active: videoTaskDraft.styleCode === job.styleCode }"
                  :aria-selected="videoTaskDraft.styleCode === job.styleCode"
                  :tabindex="videoTaskDraft.styleCode === job.styleCode ? 0 : -1"
                  @click="selectVideoTaskStyle(job.styleCode)"
                  @keydown.left.prevent="moveVideoTaskStyleTab('previous')"
                  @keydown.right.prevent="moveVideoTaskStyleTab('next')"
                  @keydown.home.prevent="moveVideoTaskStyleTab('first')"
                  @keydown.end.prevent="moveVideoTaskStyleTab('last')"
                >
                  <strong>{{ job.styleCode }}</strong>
                  <span>{{ job.assets.filter(asset => asset.selectable).length }} 张已审核</span>
                </button>
              </div>
            </section>

            <div v-if="videoTaskDraftError" class="aiv-inline-error" role="alert">{{ videoTaskDraftError }}</div>

            <div class="aiv-field">
              <span>生成方式</span>
              <div class="aiv-provider-switcher" role="group" aria-label="生成方式">
                <button
                  v-for="option in videoTaskProviderOptions"
                  :key="option.id"
                  type="button"
                  class="aiv-provider-card"
                  :class="{ active: videoTaskDraft.provider === option.id }"
                  :aria-pressed="videoTaskDraft.provider === option.id ? 'true' : 'false'"
                  :title="option.title"
                  @click="selectVideoTaskProvider(option.id)"
                >
                  <div class="aiv-provider-card-head">
                    <strong>{{ option.shortLabel }}</strong>
                    <img class="aiv-provider-mark" :src="option.mark" :alt="option.markAlt" />
                  </div>
                </button>
              </div>
            </div>

            <!-- HappyHorse 模式按已选图片数自动：0=文生 / 1=图生 / 2–9=参考生（与 AI 生视频一致） -->
            <div v-if="videoTaskDraft.provider === 'happyhorse'" class="aiv-hh-mode-auto">
              <span>HappyHorse 模式</span>
              <strong>{{ happyHorseModeLabel(videoTaskDraft.happyhorseMode) }}</strong>
              <small>{{ happyHorseAutoModeHint }}</small>
            </div>

            <section
              v-if="isApiVideoProvider(videoTaskDraft.provider)"
              class="aiv-video-gen-params"
              aria-label="生成参数"
            >
              <header class="aiv-video-gen-params-head">
                <strong>生成参数</strong>
                <span>{{ videoTaskParamBadge }}</span>
              </header>
              <div class="aiv-video-gen-params-grid">
                <label class="aiv-field compact">
                  <span>时长</span>
                  <select v-model.number="videoTaskDraft.duration">
                    <option v-for="sec in videoTaskDurationOptions" :key="sec" :value="sec">{{ sec }} 秒</option>
                  </select>
                </label>
                <label v-if="videoTaskShowRatio" class="aiv-field compact">
                  <span>比例</span>
                  <select v-model="videoTaskDraft.ratio">
                    <option v-for="ratio in videoTaskRatioOptions" :key="ratio" :value="ratio">{{ ratio }}</option>
                  </select>
                </label>
                <label v-if="videoTaskShowKlingMode" class="aiv-field compact">
                  <span>模式</span>
                  <select v-model="videoTaskDraft.klingMode">
                    <option value="std">std · 720P</option>
                    <option value="pro">pro · 1080P</option>
                  </select>
                </label>
                <label v-else class="aiv-field compact">
                  <span>清晰度</span>
                  <select v-model="videoTaskDraft.resolution">
                    <option v-for="item in videoTaskResolutionOptions" :key="item" :value="item">{{ item }}</option>
                  </select>
                </label>
                <div v-if="videoTaskShowAudio" class="aiv-field compact">
                  <span>音频</span>
                  <div class="aiv-segmented" role="group" aria-label="音频开关">
                    <button type="button" :class="{ active: videoTaskDraft.generateAudio }" @click="videoTaskDraft.generateAudio = true">开</button>
                    <button type="button" :class="{ active: !videoTaskDraft.generateAudio }" @click="videoTaskDraft.generateAudio = false">关</button>
                  </div>
                </div>
                <div class="aiv-field compact">
                  <span>水印</span>
                  <div class="aiv-segmented" role="group" aria-label="水印开关">
                    <button type="button" :class="{ active: !videoTaskDraft.watermark }" @click="videoTaskDraft.watermark = false">关</button>
                    <button type="button" :class="{ active: videoTaskDraft.watermark }" @click="videoTaskDraft.watermark = true">开</button>
                  </div>
                </div>
              </div>
              <p class="aiv-video-gen-params-hint">{{ videoTaskParamHint }}</p>
            </section>

            <section
              v-if="videoTaskDraft.provider === 'pixverse-motioncontrol'"
              class="aiv-video-gen-params"
              aria-label="PixVerse 动作模仿素材"
            >
              <header class="aiv-video-gen-params-head">
                <strong>PixVerse 动作模仿素材</strong>
                <span>本地优先 · 自动上传临时 OSS</span>
              </header>
              <div class="aiv-video-gen-params-grid">
                <div class="aiv-field compact">
                  <span>角色图</span>
                  <strong class="aiv-local-media-summary">{{ selectedVideoTaskAssetCount === 1 ? '已选择 1 张本地角色图' : videoTaskDraft.pixverseImageUrl ? '已使用角色图 URL' : '请在右侧选择 1 张图片' }}</strong>
                </div>
                <div class="aiv-field compact">
                  <span>动作视频（本地）</span>
                  <button type="button" class="aiv-directory-picker compact" @click="pickPixVerseMotionVideo">
                    <span class="aiv-directory-picker-path" :title="videoTaskDraft.pixverseVideoPath">
                      {{ videoTaskDraft.pixverseVideoPath ? fileNameFromPath(videoTaskDraft.pixverseVideoPath) : '选择 MP4 / MOV / WEBM' }}
                    </span>
                  </button>
                </div>
              </div>
              <details class="aiv-video-advanced-urls">
                <summary>高级：使用素材 URL</summary>
                <div class="aiv-video-gen-params-grid">
                  <label class="aiv-field compact">
                    <span>角色图 URL</span>
                    <input v-model="videoTaskDraft.pixverseImageUrl" placeholder="https://.../character.png" />
                  </label>
                  <label class="aiv-field compact">
                    <span>动作视频 URL</span>
                    <input v-model="videoTaskDraft.pixverseVideoUrl" placeholder="https://.../motion.mp4" />
                  </label>
                </div>
              </details>
              <p class="aiv-video-gen-params-hint">优先使用本地角色图和动作视频；提交时会用百炼官方临时 OSS 转成模型可访问地址。</p>
            </section>

            <label v-if="!isPixVerseVideoProvider(videoTaskDraft.provider)" :class="['aiv-field', { 'aiv-field-invalid': !videoTaskDraftRequirement('prompt')?.complete }]">
              <span>Prompt</span>
              <textarea
                v-model="videoTaskDraft.prompt"
                rows="4"
                :placeholder="videoTaskDraft.provider === 'qn' ? '生意管家页面生成可不填写 Prompt' : '描述服装、场景、动作和镜头要求'"
              ></textarea>
            </label>

            <div :class="['aiv-field', { 'aiv-field-invalid': !videoTaskDraftRequirement('output')?.complete }]">
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
              <small v-else-if="videoTaskDraft.provider === 'kling-v3' || videoTaskDraft.provider === 'kling-omni'">Kling 可直接选择本地图片；提交时自动上传百炼临时 OSS。</small>
              <small v-else-if="videoTaskDraft.provider === 'pixverse-motioncontrol'">PixVerse 需要 1 张角色图和 1 条动作视频；优先本地选择，提交时自动上传临时 OSS。</small>
              <small v-else-if="videoTaskDraft.happyhorseMode === 't2v'">文生视频不需要图片，使用原创人物和场景描述。</small>
              <small v-else-if="videoTaskDraft.happyhorseMode === 'i2v'">图生视频只允许选择 1 张首帧图，画幅跟随图片。</small>
              <small v-else>参考生视频支持 1-9 张图片，可组合模拍图和细节图。</small>
            </div>
          </aside>

          <!-- 右：图片内容区 -->
          <section class="aiv-video-task-selection" aria-label="图片素材">
            <section class="aiv-video-task-picker">
              <header :class="['aiv-picker-head', { 'aiv-field-invalid': !videoTaskDraftRequirement('assets')?.complete }]">
                <div>
                  <strong>{{ videoTaskDraft.styleCode || '未选择款号' }} · 图片素材</strong>
                  <span>{{ videoTaskDraftRequirement('assets')?.complete ? `${activeVideoTaskAssetTab?.label || '已审核'}图片展示中；点击卡片切换选中` : videoTaskDraftRequirement('assets')?.message }}</span>
                </div>
                <span class="aiv-badge orange">已选 {{ selectedVideoTaskAssetCount }}</span>
              </header>
              <div class="aiv-video-task-asset-tabs" role="tablist" aria-label="视频任务素材状态">
                <button
                  v-for="tab in videoTaskAssetTabs"
                  :id="`video-task-asset-tab-${tab.id}`"
                  :key="tab.id"
                  type="button"
                  role="tab"
                  :class="['aiv-video-asset-filter', { active: videoTaskAssetFilter === tab.id }]"
                  :aria-selected="videoTaskAssetFilter === tab.id"
                  :tabindex="videoTaskAssetFilter === tab.id ? 0 : -1"
                  @click="selectVideoTaskAssetTab(tab.id)"
                  @keydown.left.prevent="moveVideoTaskAssetTab('previous')"
                  @keydown.right.prevent="moveVideoTaskAssetTab('next')"
                  @keydown.home.prevent="moveVideoTaskAssetTab('first')"
                  @keydown.end.prevent="moveVideoTaskAssetTab('last')"
                >
                  {{ tab.label }} <strong>{{ tab.count }}</strong>
                </button>
              </div>
              <div class="aiv-video-task-kind-tabs" role="tablist" aria-label="视频任务素材类型">
                <button
                  v-for="tab in videoTaskKindTabs"
                  :key="tab.id"
                  type="button"
                  role="tab"
                  :class="['aiv-video-asset-filter', { active: videoTaskKindFilter === tab.id }]"
                  :aria-selected="videoTaskKindFilter === tab.id"
                  @click="videoTaskKindFilter = tab.id; resetVideoTaskAssetRenderLimit()"
                >
                  {{ tab.label }} <strong>{{ tab.count }}</strong>
                </button>
              </div>
              <div
                :id="`video-task-asset-panel-${videoTaskAssetFilter}`"
                ref="videoTaskGridRef"
                class="aiv-vtask-grid"
                role="tabpanel"
                :aria-labelledby="`video-task-asset-tab-${videoTaskAssetFilter}`"
              >
                <article
                  v-for="asset in displayedVideoTaskAssets"
                  :key="asset.id"
                  class="aiv-vtask-card"
                  :class="{
                    selected: videoTaskDraft.assetIds.includes(asset.id),
                    pending: asset.status !== 'approved',
                  }"
                  :data-vtask-id="asset.id"
                >
                  <button
                    type="button"
                    class="aiv-vtask-card-hit"
                    :disabled="!asset.selectable"
                    :aria-pressed="videoTaskDraft.assetIds.includes(asset.id)"
                    :aria-label="`${asset.selectable ? (videoTaskDraft.assetIds.includes(asset.id) ? '取消选择' : '选择') : '仅查看'}视频素材 ${asset.label}`"
                    @click="toggleVideoTaskDraftAsset(asset)"
                  >
                    <img
                      v-if="videoTaskThumbSrcMap[asset.id]"
                      class="aiv-vtask-card-img"
                      :src="videoTaskThumbSrcMap[asset.id]"
                      :alt="asset.label"
                      decoding="async"
                      draggable="false"
                      @error="markVideoTaskThumbBroken(asset)"
                    />
                    <div v-else class="aiv-vtask-card-ph" aria-hidden="true">
                      <span v-if="videoTaskThumbLoading[asset.id]">加载中</span>
                      <span v-else>…</span>
                    </div>
                    <span
                      v-if="videoTaskDraft.assetIds.includes(asset.id)"
                      class="aiv-vtask-card-selected"
                      aria-hidden="true"
                    >已选</span>
                    <span class="aiv-vtask-card-status" :class="asset.status">{{ assetStatusLabel(asset.status) }}</span>
                    <span class="aiv-vtask-card-meta">
                      <strong>{{ asset.label }}</strong>
                      <small>{{ videoTaskAssetKindLabel(asset) }}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    class="aiv-vtask-card-zoom"
                    title="查看大图"
                    :aria-label="`查看 ${asset.label} 大图`"
                    @click.stop="openImagePreview(asset, videoTaskDraft.styleCode)"
                  >
                    <span aria-hidden="true">⌕</span>
                  </button>
                </article>
                <button
                  v-if="remainingVideoTaskAssetCount > 0"
                  type="button"
                  class="aiv-video-task-load-more"
                  @click="showMoreVideoTaskAssets"
                >
                  加载更多（剩余 {{ remainingVideoTaskAssetCount }} 张）
                </button>
                <div v-if="!filteredVideoTaskAssets.length" class="aiv-video-task-empty">
                  <strong>{{ activeVideoTaskAssetTab?.label || '当前' }}图片为空</strong>
                  <span v-if="videoTaskAssetFilter === 'approved' && videoTaskKindFilter === 'all'">请先在“AI 审核”中通过图片，或切换到“待审核”仅查看。</span>
                  <span v-else-if="videoTaskKindFilter !== 'all'">当前状态与类型筛选下没有图片，可切换「模特图 / 细节图 / AI 图」。</span>
                  <span v-else>当前款号没有这类图片。</span>
                </div>
              </div>
            </section>
          </section>
        </div>
        <footer class="aiv-modal-foot">
          <span>{{ videoTaskDraft.provider === 'qn' ? '生意管家 Prompt 可空，模板可选；输出目录必填' : isPixVerseVideoProvider(videoTaskDraft.provider) ? 'PixVerse 需要角色图、动作视频和输出目录' : `${providerLabel(videoTaskDraft.provider)} 需要明确 Prompt 和输出目录` }}</span>
          <div class="aiv-modal-foot-actions">
            <button type="button" class="aiv-ghost" @click="closeVideoTaskDialog">取消</button>
            <button type="button" class="aiv-primary" :disabled="!canCreateVideoTask" @click="createVideoTaskFromDraft">{{ editingVideoTaskId ? '保存任务修改' : '创建视频任务' }}</button>
          </div>
        </footer>
      </section>
    </div>

    <div v-if="reviewBulkConfirmation" class="aiv-modal" @click.self="cancelReviewBulkAction">
      <section
        class="aiv-modal-panel aiv-confirm-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="aiv-review-bulk-title"
        aria-describedby="aiv-review-bulk-description"
        tabindex="-1"
        data-aiv-dialog
        @keydown.esc.prevent="cancelReviewBulkAction"
        @keydown="trapDialogFocus"
      >
        <header class="aiv-modal-head">
          <div>
            <strong id="aiv-review-bulk-title">确认批量{{ reviewBulkConfirmation.status === 'approved' ? '通过' : '舍弃' }}</strong>
            <span>{{ reviewBulkConfirmation.scopeLabel }}</span>
          </div>
        </header>
        <div class="aiv-confirm-copy">
          <strong>{{ reviewBulkConfirmation.entries.length }} 张图片将被{{ reviewBulkConfirmation.status === 'approved' ? '通过' : '舍弃' }}</strong>
          <span id="aiv-review-bulk-description">此操作会同步到审核池；完成后可立即撤销本次批量变更。</span>
          <div v-if="reviewActionError" class="aiv-inline-error" role="alert">{{ reviewActionError }}</div>
        </div>
        <footer class="aiv-modal-foot">
          <span>请确认影响范围后继续</span>
          <div class="aiv-modal-foot-actions">
            <button type="button" class="aiv-ghost" @click="cancelReviewBulkAction">取消</button>
            <button type="button" class="aiv-primary" @click="confirmReviewBulkAction">确认{{ reviewBulkConfirmation.status === 'approved' ? '通过' : '舍弃' }}</button>
          </div>
        </footer>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { IconCheck, IconChevronDown, IconFaceId, IconPhoto, IconRun, IconShirt, IconZoomIn } from '@tabler/icons-vue'
import PromptLibraryPickerModal from '../components/PromptLibraryPickerModal.vue'
import TldrawAnnotationLayer from '../components/TldrawAnnotationLayer.js'
import volcengineMark from '../assets/ai-video-generation/volcengine-mark.png'
import aliyunMark from '../assets/ai-video-generation/aliyun-mark.png'
import webPageMark from '../assets/ai-video-generation/web-page-mark.svg'
import { resolveHappyHorseMode } from '../utils/aiVideoPricing.mjs'
import {
  BALA_AI_IMAGE_TASK_ID,
  BALA_AI_VIDEO_ADAPTER_ID,
  BALA_MATERIAL_PREPARE_TASK_ID,
  BALA_QN_VIDEO_TASK_ID,
  balaMaterialPanelControl,
  buildBalaAiStageRequest,
  buildBalaMaterialPrepareParams,
  buildBalaReviewWorkspaceStyles,
  buildBalaVideoAssetPool,
  collectVideoResultRows,
  collectDownloadedMaterialRows,
  clearBalaVideoTaskHistory,
  filterBalaModelLibraryItems,
  formatBalaModelDisplayLabel,
  hasApprovedBalaVideoAsset,
  hasGeneratingBalaReviewAssets,
  isBalaVideoFilePath,
  isSeedancePrivacyProtectionError,
  isActiveWorkflowStatus,
  latestRunForTaskData,
  mergeBalaVideoResults,
  mergeBalaReviewWorkspaceStyles,
  mergeBalaMaterialGroups,
  mergeBalaWorkspaceVersions,
  migrateBalaBusinessManagerText,
  isBalaAiNamedMaterial,
  normalizeBalaMaterialGroups,
  normalizeBalaMaterialProgress,
  normalizeBalaReviewBatchStyles,
  normalizeBalaReviewStatus,
  normalizeOperationType,
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
  resolveBalaAssetPreviewSource,
  resolveBalaVersionPreviewSource,
  resolveBalaVideoPlaybackSource,
  sortBalaMaterialAssets,
  selectEditableSourcesForStyle,
  selectNewTaskRun,
  selectVisibleEditableVersions,
  isBalaVideoTaskSubmitEligible,
  summarizeBalaMaterialGroups,
  toBalaBridgeStringArray,
  waitForNewTaskRun,
} from '../utils/balaAiVideoWorkflow'
import {
  AI_IMAGE_MODELS,
  getAiImageModel,
  isNanoBananaModel,
  missingKeyForModel,
  normalizeSettings,
  sizeForModel,
} from '../utils/aiImageModels.js'

const emit = defineEmits(['open-settings'])

const BALA_AI_VIDEO_WORKSPACE_STORAGE_KEY = 'crawshrimp.bala-ai-video.workspace-dir'
const BALA_AI_VIDEO_WORKSPACE_STATE_STORAGE_KEY = 'crawshrimp.bala-ai-video.workspace-state.v2'
const MATERIAL_RENDER_CHUNK = 20
let workspaceStateHydrated = false

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
const workspacePersistenceError = ref('')
let workspaceManifestWriteTimer = null

const activeStep = ref('materials')
const activeAction = ref('face_swap')
const materialPanelExpanded = ref(true)
const materialShowSelectedOnly = ref(false)
const materialDisplayMode = ref('grid')
const selectedTemplateId = ref('')
const selectedModel = ref(null)
const showSelectedVersionsOnly = ref(false)
const previewImage = ref(null)
const localMaterialLibraryOpen = ref(false)
const localMaterialLibraryCategory = ref('all')
const localMaterialLibraryStyleFilter = ref('all')
const localMaterialLibraryStyleQuery = ref('')
const aiImageSettings = ref({})
const selectedAiImageModelId = ref('')
const modelLibraryOpen = ref(false)
const templateLibraryOpen = ref(false)
const videoTaskDialogOpen = ref(false)
const editingVideoTaskId = ref('')
const videoTaskDraftError = ref('')
const lastFocusedElement = ref(null)
const activeTemplateStyle = ref('')
const addImageMenuStyle = ref('')
const reviewFilter = ref('')
const reviewStatusFilter = ref('')
const videoTaskAssetFilter = ref('approved')
const videoTaskKindFilter = ref('all')
const reviewBulkConfirmation = ref(null)
const recentReviewBulkAction = ref(null)
const reviewActionError = ref('')
const selectedReviewAssetIds = reactive(new Set())
const reviewAssetFeedback = reactive({})
const reviewAssetSavingIds = reactive(new Set())
const reviewFeedbackTimers = new Map()
const promptLibraryOpen = ref(false)
const promptLibraryTarget = ref('workspace')
const activeLocalReferenceKind = ref('garment')
const previewEditAction = ref('background_swap')
const previewEditPrompt = ref('')
const previewEditBusy = ref(false)
const previewEditError = ref('')
const previewHistoryIndex = ref(0)
const previewAnnotationTool = ref('')
const previewAnnotationColor = ref('red')
const previewAnnotationClearNonce = ref(0)
const previewAnnotationExportNonce = ref(0)
const pendingVersionDeletion = ref(null)
const deleteVersionBusy = ref(false)
const deleteVersionError = ref('')
const brokenPreviews = reactive({})
const localImagePreviews = reactive({})
const localImagePreviewLoading = new Set()
const localVideoPreviews = reactive({})
const localVideoPreviewLoading = new Set()
const videoResultToPlayId = ref('')
const videoResultElements = new Map()
const materialBatch = ref(null)
const materialBoardUrl = ref('')
const reviewBatch = ref(null)
const reviewBoardUrl = ref('')
const aiStageRequest = ref(null)
const SEEDANCE_RATIOS = ['16:9', '9:16', '1:1', '3:4', '4:3', '21:9', 'adaptive']
const HAPPYHORSE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '5:4', '9:21', '21:9']
const KLING_RATIOS = ['16:9', '9:16', '1:1']
const BAILIAN_VIDEO_PROVIDERS = ['happyhorse', 'kling-v3', 'kling-omni', 'pixverse-motioncontrol']

/** 简写按钮卡：与 AI 生视频工作台同风格，侧栏三列紧凑展示 */
const videoTaskProviderOptions = [
  {
    id: 'qn',
    shortLabel: '生意管家',
    title: '生意管家页面生成（图生视频网页）',
    mark: webPageMark,
    markAlt: '网页',
  },
  {
    id: 'seedance',
    shortLabel: 'Seedance 2.0',
    title: 'Seedance 2.0 API · 火山引擎',
    mark: volcengineMark,
    markAlt: '火山引擎',
  },
  {
    id: 'happyhorse',
    shortLabel: 'HappyHorse 1.1',
    title: '百炼 HappyHorse 1.1 · 阿里云',
    mark: aliyunMark,
    markAlt: '阿里云',
  },
  {
    id: 'kling-v3',
    shortLabel: 'Kling v3',
    title: '百炼 Kling v3 · 阿里云',
    mark: aliyunMark,
    markAlt: '阿里云',
  },
  {
    id: 'kling-omni',
    shortLabel: 'Kling Omni',
    title: '百炼 Kling Omni · 阿里云',
    mark: aliyunMark,
    markAlt: '阿里云',
  },
  {
    id: 'pixverse-motioncontrol',
    shortLabel: 'PixVerse',
    title: '百炼 PixVerse Motion Control · 阿里云',
    mark: aliyunMark,
    markAlt: '阿里云',
  },
]

const videoTaskDraft = reactive({
  styleCode: '208326102205',
  provider: 'qn',
  happyhorseMode: 'i2v',
  prompt: '',
  outputDir: workspaceDir.value,
  templateId: '',
  assetIds: [],
  // 与 AI 生视频工作台对齐的生成参数
  duration: 5,
  resolution: '720p',
  ratio: '9:16',
  generateAudio: true,
  klingMode: 'std',
  pixverseImageUrl: '',
  pixverseImagePath: '',
  pixverseVideoUrl: '',
  pixverseVideoPath: '',
  watermark: false,
})
const materialExpanded = reactive({
  '208326102205': true,
  '208326105214': true,
  '208326108104': false,
})
const materialRenderLimits = reactive({})
const materialStyleListRef = ref(null)

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
const materialWorkspaceRequired = ref(false)
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
  message: '先创建视频任务，再做预检或生成视频',
  error: '',
  progress: 0,
})
const videoTaskBusyIds = reactive(new Set())
const pendingVideoHistoryCleanup = ref(null)
const videoHistoryCleanupBusy = ref(false)
const videoHistoryCleanupError = ref('')
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
  { id: 'face_swap', title: 'AI 换脸', shortTitle: '换脸', detail: '替换人物面部，保留服装版型', requirement: '选择模特' },
  { id: 'background_swap', title: 'AI 换背景', shortTitle: '换背景', detail: '只改场景，不改变人物与服装', requirement: '填写背景 Prompt' },
  { id: 'outfit_swap', title: 'AI 换装', shortTitle: '换装', detail: '按服装与搭配参考完成替换', requirement: '选择服装图' },
  { id: 'pose_swap', title: 'AI 换姿势', shortTitle: '换姿势', detail: '调整人物姿势，保留人物与服装', requirement: '填写姿势 Prompt' },
]

const activeAiAction = computed(() => aiActions.find(action => action.id === activeAction.value) || aiActions[0])
const previewEditActionConfig = computed(() => aiActions.find(action => action.id === previewEditAction.value) || aiActions[0])

const aiActionIcons = {
  face_swap: IconFaceId,
  background_swap: IconPhoto,
  outfit_swap: IconShirt,
  pose_swap: IconRun,
}

const activeActionConfig = computed(() => aiActions.find(action => action.id === activeAction.value) || aiActions[0])
const activeActionTitle = computed(() => activeActionConfig.value.title)
const activeActionDetail = computed(() => activeActionConfig.value.detail)
const activePromptLabel = computed(() => {
  if (activeAction.value === 'background_swap') return '背景 Prompt'
  if (activeAction.value === 'outfit_swap') return '换装补充要求'
  if (activeAction.value === 'pose_swap') return '姿势 Prompt'
  return '换脸补充要求'
})

const styleWorkspaces = reactive([])

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
const materialTaskStage = computed(() => {
  if (materialTask.error || materialTask.status === 'failed') {
    return { id: 'failed', label: '需要处理', detail: '找图失败，可查看提示后重试。' }
  }
  if (materialIsRunning.value) {
    return { id: 'running', label: '正在找图', detail: materialTask.message || '正在读取并规整素材。' }
  }
  if (materialGroups.length) {
    return { id: 'ready', label: '素材已就绪', detail: '可继续筛选素材并进入 AI 改图。' }
  }
  return { id: 'idle', label: '等待找图', detail: '输入款号后开始从云盘获取素材。' }
})
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
const modelLibraryErrorMessage = computed(() => {
  const message = String(modelLibraryState.error || '').trim()
  if (!message) return ''
  if (/failed to fetch|networkerror|network request failed/i.test(message)) return '模特库暂时无法加载，请检查网络后重试。'
  return message
})
const modelAgeOptions = computed(() => [...new Set([
  ...modelLibraryState.groups.map(group => group.ageLabel),
  ...modelLibraryState.items.map(item => item.ageLabel),
].filter(Boolean))])
const modelGenderOptions = computed(() => [...new Set([
  ...modelLibraryState.groups.map(group => group.gender),
  ...modelLibraryState.items.map(item => item.gender),
].filter(Boolean))])
const localMaterialLibraryStyleOptions = computed(() => (
  [...new Set(styleWorkspaces.map(style => String(style.styleCode || '').trim()).filter(Boolean))]
))
const localMaterialLibraryAssets = computed(() => {
  const styles = localMaterialLibraryStyleFilter.value === 'all'
    ? styleWorkspaces
    : styleWorkspaces.filter(style => style.styleCode === localMaterialLibraryStyleFilter.value)
  return styles.flatMap(style => {
    const styleCode = String(style.styleCode || '').trim()
    return [
      ...(style.modelPhotos || []).map(asset => ({ ...asset, styleCode: asset.styleCode || styleCode })),
      ...(style.detailPhotos || []).map(asset => ({ ...asset, styleCode: asset.styleCode || styleCode })),
    ]
  })
})
const filteredLocalMaterialLibraryAssets = computed(() => {
  let assets = localMaterialLibraryAssets.value
  const query = String(localMaterialLibraryStyleQuery.value || '').trim().toLowerCase()
  if (query) {
    assets = assets.filter(asset => (
      String(asset.styleCode || '').toLowerCase().includes(query)
      || String(asset.name || '').toLowerCase().includes(query)
      || String(asset.role || '').toLowerCase().includes(query)
    ))
  }
  if (localMaterialLibraryCategory.value === 'model') {
    assets = assets.filter(asset => asset.sourceType === 'model')
  } else if (localMaterialLibraryCategory.value === 'detail') {
    assets = assets.filter(asset => asset.sourceType === 'detail')
  }
  return assets
})
const localMaterialLibraryScopeLabel = computed(() => {
  if (localMaterialLibraryStyleFilter.value !== 'all') return localMaterialLibraryStyleFilter.value
  const count = localMaterialLibraryStyleOptions.value.length
  return count ? `工作区 ${count} 个款号` : '当前工作区'
})
const activeLocalReferenceLabel = computed(() => ({
  garment: '服装图',
  outfit: '搭配参考图',
  variant: '同款不同色',
}[activeLocalReferenceKind.value] || '素材'))
const selectedLocalReferenceCount = computed(() => {
  if (activeLocalReferenceKind.value === 'garment') return garmentImagePaths.value.length
  if (activeLocalReferenceKind.value === 'variant') return variantReferencePaths.value.length
  return outfitReferencePaths.value.length
})
const configuredAiImageModels = computed(() => {
  const settings = normalizeSettings(aiImageSettings.value)
  return AI_IMAGE_MODELS.filter(model => !missingKeyForModel(model.id, settings))
})
const selectedAiImageModel = computed(() => getAiImageModel(selectedAiImageModelId.value || configuredAiImageModels.value[0]?.id))
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
const selectedVideoTaskIds = reactive(new Set())
const videoTaskStatusFilter = ref('all')

function cloneWorkspaceValue(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return fallback
  }
}

function workspaceStateRegistry() {
  try {
    const saved = JSON.parse(localStorage.getItem(BALA_AI_VIDEO_WORKSPACE_STATE_STORAGE_KEY) || '{}')
    if (saved?.version === 2 && saved.workspaces && typeof saved.workspaces === 'object') return saved
  } catch {
    // A damaged local snapshot must never block the live workflow.
  }
  return { version: 2, activeWorkspace: '', workspaces: {} }
}

function workspaceSnapshotStep() {
  return activeStep.value === 'results' ? 'templates' : activeStep.value
}

function restoreWorkspaceActiveStep(snapshot = {}) {
  const restoredStep = String(snapshot.activeStep || '') === 'results' ? 'templates' : String(snapshot.activeStep || '')
  if (!stepDefinitions.some(step => step.id === restoredStep)) return false
  activeStep.value = restoredStep
  return true
}

function workspaceSnapshot() {
  return {
    version: 2,
    workspaceDir: workspaceDir.value,
    updatedAt: new Date().toISOString(),
    activeStep: workspaceSnapshotStep(),
    input: {
      styleCodes: styleCodes.value,
      cloudPath: cloudPath.value,
      materialPackageName: materialPackageName.value,
      activeMaterialStyleCode: activeMaterialStyleCode.value,
      activeMaterialSource: activeMaterialSource.value,
      materialDisplayMode: materialDisplayMode.value,
    },
    material: {
      task: cloneWorkspaceValue(materialTask, {}),
      batch: cloneWorkspaceValue(materialBatch.value, null),
      boardUrl: materialBoardUrl.value,
    },
    image: {
      styles: cloneWorkspaceValue(styleWorkspaces, []),
      reviewStyles: cloneWorkspaceValue(reviewStyles, []),
      reviewBatch: cloneWorkspaceValue(reviewBatch.value, null),
      reviewBoardUrl: reviewBoardUrl.value,
      task: cloneWorkspaceValue(aiTaskState, {}),
      activeAction: activeAction.value,
      prompt: aiPrompt.value,
      selectedModel: cloneWorkspaceValue(selectedModel.value, null),
      garmentImagePaths: [...garmentImagePaths.value],
      outfitReferencePaths: [...outfitReferencePaths.value],
      variantReferencePaths: [...variantReferencePaths.value],
    },
    video: {
      tasks: videoTasks.map(persistedVideoTask),
      results: videoResults.map(persistedVideoResult),
    },
  }
}

function workspaceRecoveryManifest() {
  const snapshot = workspaceSnapshot()
  return {
    version: 1,
    workspaceDir: snapshot.workspaceDir,
    updatedAt: snapshot.updatedAt,
    activeStep: snapshot.activeStep,
    video: snapshot.video,
  }
}

function restoreWorkspaceVideoManifest(snapshot = {}, workspace = workspaceDir.value) {
  if (!snapshot || snapshot.workspaceDir !== workspace) return false
  const video = snapshot.video || {}
  const tasks = Array.isArray(video.tasks) ? video.tasks.map(persistedVideoTask).filter(item => item.id) : []
  const results = Array.isArray(video.results) ? video.results.map(persistedVideoResult).filter(item => item.id) : []
  if (!tasks.length && !results.length) return false
  videoTasks.splice(0, videoTasks.length, ...tasks)
  videoResults.splice(0, videoResults.length, ...results)
  restoreWorkspaceActiveStep(snapshot)
  return true
}

function scheduleWorkspaceManifestPersist() {
  if (!workspaceStateHydrated || !workspaceDir.value) return
  if (workspaceManifestWriteTimer) clearTimeout(workspaceManifestWriteTimer)
  workspaceManifestWriteTimer = setTimeout(() => {
    workspaceManifestWriteTimer = null
    void flushWorkspaceManifest()
  }, 450)
}

async function flushWorkspaceManifest(workspace = workspaceDir.value) {
  const targetWorkspace = String(workspace || '').trim()
  if (!targetWorkspace) return false
  if (workspaceManifestWriteTimer) {
    clearTimeout(workspaceManifestWriteTimer)
    workspaceManifestWriteTimer = null
  }
  if (typeof window.cs?.writeBalaWorkspaceManifest !== 'function') {
    workspacePersistenceError.value = '当前运行环境无法保存工作区恢复清单；请在 Electron 客户端中继续操作。'
    return false
  }
  try {
    await window.cs.writeBalaWorkspaceManifest(targetWorkspace, workspaceRecoveryManifest())
    if (workspaceDir.value === targetWorkspace) workspacePersistenceError.value = ''
    return true
  } catch (error) {
    if (workspaceDir.value === targetWorkspace) {
      workspacePersistenceError.value = `工作区恢复清单未保存：${error?.message || String(error)}`
    }
    return false
  }
}

async function restoreWorkspaceManifest(workspace = workspaceDir.value) {
  const targetWorkspace = String(workspace || '').trim()
  if (!targetWorkspace || typeof window.cs?.readBalaWorkspaceManifest !== 'function') return false
  try {
    const snapshot = await window.cs.readBalaWorkspaceManifest(targetWorkspace)
    if (!snapshot) return false
    const restored = restoreWorkspaceVideoManifest(snapshot, targetWorkspace)
    if (restored) workspacePersistenceError.value = ''
    return restored
  } catch (error) {
    if (workspaceDir.value === targetWorkspace) {
      workspacePersistenceError.value = `工作区恢复清单不可用：${error?.message || String(error)}`
    }
    return false
  }
}

function persistWorkspaceState() {
  if (!workspaceStateHydrated || !workspaceDir.value) return
  try {
    const registry = workspaceStateRegistry()
    registry.activeWorkspace = workspaceDir.value
    registry.workspaces[workspaceDir.value] = workspaceSnapshot()
    localStorage.setItem(BALA_AI_VIDEO_WORKSPACE_STATE_STORAGE_KEY, JSON.stringify(registry))
  } catch (error) {
    workspacePersistenceError.value = `浏览器缓存未保存：${error?.message || String(error)}`
  }
  scheduleWorkspaceManifestPersist()
}

function restoreWorkspaceSnapshot(path = workspaceDir.value) {
  const workspace = String(path || '').trim()
  if (!workspace) return false
  const snapshot = workspaceStateRegistry().workspaces?.[workspace]
  if (!snapshot || snapshot.workspaceDir !== workspace) return false

  const input = snapshot.input || {}
  styleCodes.value = String(input.styleCodes || styleCodes.value)
  cloudPath.value = String(input.cloudPath || cloudPath.value)
  materialPackageName.value = String(input.materialPackageName || '')
  activeMaterialStyleCode.value = String(input.activeMaterialStyleCode || '')
  activeMaterialSource.value = input.activeMaterialSource === 'detail' ? 'detail' : 'model'
  materialDisplayMode.value = input.materialDisplayMode === 'list' ? 'list' : 'grid'

  const material = snapshot.material || {}
  materialBatch.value = cloneWorkspaceValue(material.batch, null)
  materialBoardUrl.value = String(material.boardUrl || '')
  Object.assign(materialTask, cloneWorkspaceValue(material.task, {}))

  const image = snapshot.image || {}
  const savedStyles = Array.isArray(image.styles) ? cloneWorkspaceValue(image.styles, []) : []
  replaceStyleWorkspaces(savedStyles.length ? savedStyles : [])
  reviewStyles.splice(0, reviewStyles.length, ...(cloneWorkspaceValue(image.reviewStyles, []) || []))
  reviewBatch.value = cloneWorkspaceValue(image.reviewBatch, null)
  reviewBoardUrl.value = String(image.reviewBoardUrl || '')
  Object.assign(aiTaskState, cloneWorkspaceValue(image.task, {}))
  activeAction.value = aiActions.some(action => action.id === image.activeAction) ? image.activeAction : activeAction.value
  aiPrompt.value = String(image.prompt || aiPrompt.value)
  selectedModel.value = cloneWorkspaceValue(image.selectedModel, null)
  garmentImagePaths.value = Array.isArray(image.garmentImagePaths) ? image.garmentImagePaths.filter(Boolean) : []
  outfitReferencePaths.value = Array.isArray(image.outfitReferencePaths) ? image.outfitReferencePaths.filter(Boolean) : []
  variantReferencePaths.value = Array.isArray(image.variantReferencePaths) ? image.variantReferencePaths.filter(Boolean) : []

  const video = snapshot.video || {}
  const tasks = Array.isArray(video.tasks) ? video.tasks.map(persistedVideoTask).filter(item => item.id) : []
  const results = Array.isArray(video.results) ? video.results.map(persistedVideoResult).filter(item => item.id) : []
  videoTasks.splice(0, videoTasks.length, ...tasks)
  videoResults.splice(0, videoResults.length, ...results)
  videoTaskDraft.outputDir = workspace
  restoreWorkspaceActiveStep(snapshot)
  if (reviewStyles.length) buildVideoJobsFromReview()
  return true
}

function persistAiImageWorkspaceState() {
  persistWorkspaceState()
}

function restoreAiImageWorkspaceState() {
  return restoreWorkspaceSnapshot(workspaceDir.value)
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
  const gen = videoTaskGenerationParams(task)
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
    duration: Number(task.duration ?? gen.duration ?? 5),
    resolution: String(task.resolution || gen.resolution || ''),
    ratio: String(task.ratio ?? gen.ratio ?? ''),
    klingMode: String(task.klingMode || gen.mode || 'std'),
    pixverseImagePath: String(task.pixverseImagePath || gen.imagePath || ''),
    pixverseImageUrl: String(task.pixverseImageUrl || gen.imageUrl || ''),
    pixverseVideoPath: String(task.pixverseVideoPath || gen.videoPath || ''),
    pixverseVideoUrl: String(task.pixverseVideoUrl || gen.videoUrl || ''),
    generateAudio: normalizeBalaVideoTaskProvider(task.provider) === 'seedance'
      || isKlingVideoProvider(normalizeBalaVideoTaskProvider(task.provider))
      ? task.generateAudio !== false && task.generateAudio !== 0
      : Boolean(task.generateAudio),
    watermark: Boolean(task.watermark),
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
    progressSource: String(item.progressSource || ''),
    path: String(item.path || ''),
    videoUrl: String(item.videoUrl || ''),
    error: migrateBalaBusinessManagerText(item.error),
  }
}

function persistVideoWorkflowState() {
  persistWorkspaceState()
}

function restoreVideoWorkflowState() {
  return restoreWorkspaceSnapshot(workspaceDir.value)
}

const completedVideoCount = computed(() => videoResults.filter(item => videoResultStage(item).id === 'downloaded').length)
const overallVideoProgress = computed(() => {
  const activeProgress = videoResults.filter(videoResultHasLiveProgress).map(item => Number(item.progress))
  if (!activeProgress.length) return null
  return Math.round(activeProgress.reduce((sum, progress) => sum + progress, 0) / activeProgress.length)
})
const videoResultStageSummary = computed(() => {
  const counts = { pending: 0, authorization: 0, submitted: 0, queued: 0, generating: 0, ready: 0, downloaded: 0, failed: 0 }
  for (const item of videoResults) counts[videoResultStage(item).id] += 1
  return [
    { id: 'pending', label: '待生成', count: counts.pending },
    { id: 'authorization', label: '待授权', count: counts.authorization },
    { id: 'submitted', label: '已提交', count: counts.submitted },
    { id: 'queued', label: '排队中', count: counts.queued },
    { id: 'generating', label: '生成中', count: counts.generating },
    { id: 'ready', label: '待下载', count: counts.ready },
    { id: 'downloaded', label: '已下载', count: counts.downloaded },
    { id: 'failed', label: '失败', count: counts.failed },
  ].filter(stage => stage.count)
})
const clearableVideoResults = computed(() => videoResults.filter(isClearableVideoResult))
const totalVideoAssetCount = computed(() => (
  videoJobs.reduce((sum, job) => sum + (job.assets || []).length, 0)
))
const videoTaskStatusTabs = computed(() => {
  const counts = { pending: 0, authorization: 0, submitted: 0, queued: 0, generating: 0, ready: 0, downloaded: 0, failed: 0 }
  for (const task of videoTasks) counts[videoTaskStage(task).id] += 1
  return [
    { id: 'all', label: '全部', count: videoTasks.length },
    { id: 'pending', label: '待生成', count: counts.pending },
    { id: 'authorization', label: '待授权', count: counts.authorization },
    { id: 'submitted', label: '已提交', count: counts.submitted },
    { id: 'queued', label: '排队中', count: counts.queued },
    { id: 'generating', label: '生成中', count: counts.generating },
    { id: 'ready', label: '待下载', count: counts.ready },
    { id: 'downloaded', label: '已下载', count: counts.downloaded },
    { id: 'failed', label: '失败', count: counts.failed },
  ]
})
const filteredVideoTasks = computed(() => {
  const status = videoTaskStatusFilter.value
  if (status === 'all') return videoTasks
  return videoTasks.filter(task => videoTaskStage(task).id === status)
})
const selectableVisibleVideoTasks = computed(() => (
  filteredVideoTasks.value.filter(task => isVideoTaskSubmittable(task))
))
const selectedVisibleVideoTasks = computed(() => (
  selectableVisibleVideoTasks.value.filter(task => selectedVideoTaskIds.has(String(task.id || '')))
))
const allVisibleVideoTasksSelected = computed(() => (
  selectableVisibleVideoTasks.value.length > 0 && selectedVisibleVideoTasks.value.length === selectableVisibleVideoTasks.value.length
))
const activeVideoAssetPool = computed(() => (
  videoJobs.find(job => job.styleCode === videoTaskDraft.styleCode) || videoJobs[0] || { assets: [] }
))
const videoTaskSelectableAssets = computed(() => activeVideoAssetPool.value?.assets || [])
const videoTaskAssetTabs = computed(() => {
  const assets = videoTaskSelectableAssets.value
  return [
    { id: 'approved', label: '已审核', count: assets.filter(asset => asset.status === 'approved').length },
    { id: 'pending', label: '待审核', count: assets.filter(asset => asset.status === 'pending' || asset.status === 'retry').length },
    { id: 'all', label: '全部', count: assets.length },
  ]
})
const videoTaskKindTabs = computed(() => {
  const assets = videoTaskSelectableAssets.value
  return [
    { id: 'all', label: '全部类型', count: assets.length },
    // 模特图 / 细节图按文件夹来源；AI 图是叠加属性，可与前两者重叠计数
    { id: 'model', label: '模特图', count: assets.filter(asset => videoTaskAssetSourceType(asset) === 'model').length },
    { id: 'detail', label: '细节图', count: assets.filter(asset => videoTaskAssetSourceType(asset) === 'detail').length },
    { id: 'ai', label: 'AI 图', count: assets.filter(asset => videoTaskAssetIsAi(asset)).length },
  ]
})
const activeVideoTaskAssetTab = computed(() => (
  videoTaskAssetTabs.value.find(tab => tab.id === videoTaskAssetFilter.value) || videoTaskAssetTabs.value[0]
))
const filteredVideoTaskAssets = computed(() => {
  const statusFilter = videoTaskAssetFilter.value
  const kindFilter = videoTaskKindFilter.value
  return videoTaskSelectableAssets.value.filter((asset) => {
    if (statusFilter === 'approved' && asset.status !== 'approved') return false
    if (statusFilter === 'pending' && !(asset.status === 'pending' || asset.status === 'retry')) return false
    if (kindFilter === 'ai') return videoTaskAssetIsAi(asset)
    if (kindFilter === 'model' || kindFilter === 'detail') {
      return videoTaskAssetSourceType(asset) === kindFilter
    }
    return true
  })
})
/** 多图分页 + 缩略图队列：首屏少挂载，禁止全量原图 base64 */
const VIDEO_TASK_ASSET_CHUNK = 20
const VIDEO_TASK_THUMB_CONCURRENCY = 3
const videoTaskAssetRenderLimit = ref(VIDEO_TASK_ASSET_CHUNK)
const videoTaskThumbSrcMap = reactive({})
const videoTaskThumbLoading = reactive({})
const videoTaskGridRef = ref(null)
let videoTaskThumbQueue = []
let videoTaskThumbActive = 0
let videoTaskThumbObserver = null

const displayedVideoTaskAssets = computed(() => (
  filteredVideoTaskAssets.value.slice(0, videoTaskAssetRenderLimit.value)
))
const remainingVideoTaskAssetCount = computed(() => (
  Math.max(0, filteredVideoTaskAssets.value.length - videoTaskAssetRenderLimit.value)
))
function showMoreVideoTaskAssets() {
  videoTaskAssetRenderLimit.value += VIDEO_TASK_ASSET_CHUNK
  nextTick(() => {
    scheduleVideoTaskThumbs(displayedVideoTaskAssets.value)
    observeVideoTaskThumbs()
  })
}
function resetVideoTaskAssetRenderLimit() {
  videoTaskAssetRenderLimit.value = VIDEO_TASK_ASSET_CHUNK
  videoTaskThumbQueue = []
  videoTaskThumbActive = 0
}
const selectedVideoTaskAssetCount = computed(() => videoTaskDraft.assetIds.length)
const selectedVideoTaskDraftAssets = computed(() => videoTaskSelectableAssets.value.filter(asset => (
  asset.selectable && videoTaskDraft.assetIds.includes(asset.id)
)))
function isBailianVideoProvider(provider = '') {
  return BAILIAN_VIDEO_PROVIDERS.includes(String(provider || '').trim())
}
function isKlingVideoProvider(provider = '') {
  return ['kling-v3', 'kling-omni'].includes(String(provider || '').trim())
}
function isPixVerseVideoProvider(provider = '') {
  return String(provider || '').trim() === 'pixverse-motioncontrol'
}
function isApiVideoProvider(provider = '') {
  const key = String(provider || '').trim()
  return key === 'seedance' || isBailianVideoProvider(key)
}
function providerUsesLocalImages(provider = '', mode = '') {
  if (provider === 'qn') return true
  if (provider === 'seedance') return true
  if (provider === 'happyhorse') return mode !== 't2v'
  if (isKlingVideoProvider(provider)) return true
  if (isPixVerseVideoProvider(provider)) return true
  return false
}
function videoTaskResultTemplateLabel(task = {}) {
  const provider = String(task?.provider || '').trim()
  if (provider === 'seedance') return 'Seedance'
  if (provider === 'happyhorse') return happyHorseModeLabel(task?.happyhorseMode)
  if (provider === 'kling-v3') return 'Kling v3'
  if (provider === 'kling-omni') return 'Kling Omni'
  if (provider === 'pixverse-motioncontrol') return 'PixVerse Motion'
  return task?.template?.title || '不选模板'
}
const videoTaskDraftRequirements = computed(() => {
  const provider = videoTaskDraft.provider
  const happyHorseMode = videoTaskDraft.happyhorseMode
  const textOnly = provider === 'happyhorse' && happyHorseMode === 't2v'
  const pixverse = isPixVerseVideoProvider(provider)
  const assets = selectedVideoTaskDraftAssets.value
  const pixverseImageReady = !pixverse || assets.length === 1 || /^https?:\/\//i.test(String(videoTaskDraft.pixverseImageUrl || '').trim())
  const pixverseMotionReady = !pixverse || Boolean(String(videoTaskDraft.pixverseVideoPath || '').trim()) || /^https?:\/\//i.test(String(videoTaskDraft.pixverseVideoUrl || '').trim())
  const assetRequirement = textOnly
    ? { id: 'assets', label: '素材（文生视频无需图片）', complete: true, message: '' }
    : isKlingVideoProvider(provider)
      ? { id: 'assets', label: '本地参考图（可选，最多 2 张）', complete: assets.length <= 2, message: 'Kling 本地参考图最多选择 2 张（首帧 / 尾帧）' }
      : pixverse
        ? { id: 'assets', label: '角色图（恰好 1 张）', complete: pixverseImageReady, message: 'PixVerse 需要选择 1 张本地角色图，或在高级配置里填写角色图 URL' }
    : provider === 'happyhorse' && happyHorseMode === 'i2v'
      ? { id: 'assets', label: '首帧图（恰好 1 张）', complete: assets.length === 1, message: 'HappyHorse 图生视频需要恰好选择 1 张首帧图' }
      : provider === 'happyhorse' && happyHorseMode === 'r2v'
        ? { id: 'assets', label: '参考图片（1–9 张）', complete: assets.length >= 1 && assets.length <= 9, message: 'HappyHorse 参考生视频需要选择 1–9 张图片' }
        : { id: 'assets', label: '已审核素材（至少 1 张）', complete: assets.length > 0, message: '请选择至少 1 张已审核素材' }
  return [
    { id: 'style', label: '款号素材库', complete: Boolean(videoTaskDraft.styleCode), message: '请先选择一个款号素材库' },
    assetRequirement,
    { id: 'prompt', label: provider === 'qn' || pixverse ? 'Prompt（可选）' : 'Prompt', complete: provider === 'qn' || pixverse || Boolean(videoTaskDraft.prompt.trim()), message: `${providerLabel(provider)} 任务需要填写 Prompt` },
    { id: 'pixverse', label: '动作视频', complete: pixverseMotionReady, message: 'PixVerse 需要选择 1 条本地动作视频，或在高级配置里填写动作视频 URL' },
    { id: 'output', label: '输出目录', complete: Boolean(videoTaskDraft.outputDir.trim()), message: '请选择视频结果输出目录' },
  ].filter(item => item.id !== 'pixverse' || pixverse)
})
const videoTaskDraftCompletedCount = computed(() => videoTaskDraftRequirements.value.filter(item => item.complete).length)
const canCreateVideoTask = computed(() => videoTaskDraftRequirements.value.every(item => item.complete))

const videoTaskShowRatio = computed(() => !(
  (videoTaskDraft.provider === 'happyhorse' && videoTaskDraft.happyhorseMode === 'i2v')
  || isPixVerseVideoProvider(videoTaskDraft.provider)
))
const videoTaskShowAudio = computed(() => videoTaskDraft.provider === 'seedance' || isKlingVideoProvider(videoTaskDraft.provider))
const videoTaskShowKlingMode = computed(() => isKlingVideoProvider(videoTaskDraft.provider))
const videoTaskDurationOptions = computed(() => {
  const min = videoTaskDraft.provider === 'seedance' ? 4 : 3
  const options = []
  for (let i = min; i <= 15; i += 1) options.push(i)
  return options
})
const videoTaskRatioOptions = computed(() => (
  videoTaskDraft.provider === 'seedance'
    ? SEEDANCE_RATIOS
    : isKlingVideoProvider(videoTaskDraft.provider)
      ? KLING_RATIOS
      : HAPPYHORSE_RATIOS
))
const videoTaskResolutionOptions = computed(() => {
  if (videoTaskDraft.provider === 'seedance') return ['480p', '720p', '1080p']
  if (isPixVerseVideoProvider(videoTaskDraft.provider)) return ['360P', '540P', '720P']
  return ['720P', '1080P']
})
const videoTaskParamBadge = computed(() => {
  if (videoTaskDraft.provider === 'seedance') return 'Seedance 2.0'
  if (videoTaskDraft.provider === 'kling-v3') return 'Kling v3'
  if (videoTaskDraft.provider === 'kling-omni') return 'Kling Omni'
  if (isPixVerseVideoProvider(videoTaskDraft.provider)) return 'PixVerse Motion'
  return `HH · ${happyHorseModeLabel(videoTaskDraft.happyhorseMode)}`
})
const happyHorseAutoModeHint = computed(() => {
  const n = selectedVideoTaskAssetCount.value
  if (n <= 0) return '当前 0 张图 → 自动文生视频（t2v）'
  if (n === 1) return '当前 1 张图 → 自动图生视频（i2v），画幅随首帧'
  return `当前 ${n} 张图 → 自动参考生视频（r2v，最多 9 张）`
})
const videoTaskParamHint = computed(() => {
  if (videoTaskDraft.provider === 'seedance') {
    return `Seedance 默认 720p / 5 秒 / 9:16 / 音频开 / 水印关。当前：${videoTaskDraft.resolution} · ${videoTaskDraft.duration}s · ${videoTaskDraft.ratio} · 音频${videoTaskDraft.generateAudio ? '开' : '关'} · 水印${videoTaskDraft.watermark ? '开' : '关'}`
  }
  if (isKlingVideoProvider(videoTaskDraft.provider)) {
    return `Kling 默认 std / 5 秒 / 16:9 / 音频开 / 水印关。当前：${videoTaskDraft.klingMode || 'std'} · ${videoTaskDraft.duration}s · ${videoTaskDraft.ratio || '16:9'} · 音频${videoTaskDraft.generateAudio ? '开' : '关'} · 水印${videoTaskDraft.watermark ? '开' : '关'}`
  }
  if (isPixVerseVideoProvider(videoTaskDraft.provider)) {
    return `PixVerse 默认 720P / 水印关；输出时长跟随动作参考视频。当前：${videoTaskDraft.resolution || '720P'} · 水印${videoTaskDraft.watermark ? '开' : '关'}`
  }
  if (videoTaskDraft.happyhorseMode === 'i2v') {
    return `图生视频默认 720P / 5 秒 / 比例随首帧 / 水印关。当前：${videoTaskDraft.resolution} · ${videoTaskDraft.duration}s · 水印${videoTaskDraft.watermark ? '开' : '关'}`
  }
  if (videoTaskDraft.happyhorseMode === 't2v') {
    return `文生视频默认 720P / 5 秒 / 16:9 / 水印关。当前：${videoTaskDraft.resolution} · ${videoTaskDraft.duration}s · ${videoTaskDraft.ratio || '16:9'} · 水印${videoTaskDraft.watermark ? '开' : '关'}`
  }
  return `参考生视频默认 720P / 5 秒 / 9:16 / 水印关。当前：${videoTaskDraft.resolution} · ${videoTaskDraft.duration}s · ${videoTaskDraft.ratio || '9:16'} · 水印${videoTaskDraft.watermark ? '开' : '关'}`
})

function applyVideoTaskProviderDefaults(provider = videoTaskDraft.provider) {
  if (provider === 'seedance') {
    videoTaskDraft.ratio = '9:16'
    videoTaskDraft.resolution = '720p'
    videoTaskDraft.duration = 5
    videoTaskDraft.generateAudio = true
    videoTaskDraft.klingMode = 'std'
    videoTaskDraft.watermark = false
    return
  }
  if (provider === 'happyhorse') {
    videoTaskDraft.resolution = '720P'
    videoTaskDraft.duration = 5
    videoTaskDraft.generateAudio = false
    videoTaskDraft.watermark = false
    syncHappyHorseModeFromAssetCount()
    return
  }
  if (isKlingVideoProvider(provider)) {
    videoTaskDraft.ratio = '16:9'
    videoTaskDraft.resolution = '720P'
    videoTaskDraft.duration = 5
    videoTaskDraft.generateAudio = true
    videoTaskDraft.klingMode = 'std'
    videoTaskDraft.watermark = false
    return
  }
  if (isPixVerseVideoProvider(provider)) {
    videoTaskDraft.ratio = ''
    videoTaskDraft.resolution = '720P'
    videoTaskDraft.duration = 5
    videoTaskDraft.generateAudio = false
    videoTaskDraft.klingMode = 'std'
    videoTaskDraft.watermark = false
  }
}

/** 0 张 → t2v，1 张 → i2v，2–9 张 → r2v（与 AI 生视频工作台一致） */
function syncHappyHorseModeFromAssetCount() {
  if (videoTaskDraft.provider !== 'happyhorse') return
  let count = selectedVideoTaskAssetCount.value
  // 参考生最多 9 张；超出时裁剪并按 9 计
  if (count > 9) {
    videoTaskDraft.assetIds = videoTaskDraft.assetIds.slice(0, 9)
    count = 9
  }
  const nextMode = resolveHappyHorseMode(count)
  if (videoTaskDraft.happyhorseMode !== nextMode) {
    videoTaskDraft.happyhorseMode = nextMode
  }
  syncVideoTaskHappyHorseRatioDefault()
}

function syncVideoTaskHappyHorseRatioDefault() {
  if (videoTaskDraft.provider !== 'happyhorse') return
  const mode = videoTaskDraft.happyhorseMode || 'i2v'
  if (mode === 'i2v') {
    videoTaskDraft.ratio = ''
    return
  }
  if (mode === 't2v') {
    if (!videoTaskDraft.ratio) videoTaskDraft.ratio = '16:9'
    return
  }
  if (!videoTaskDraft.ratio) videoTaskDraft.ratio = '9:16'
}

function videoTaskGenerationParams(task = videoTaskDraft) {
  const provider = String(task?.provider || '').trim()
  const duration = Number(task?.duration || 5)
  const watermark = Boolean(task?.watermark)
  if (provider === 'seedance') {
    return {
      duration: Number.isFinite(duration) ? Math.max(4, Math.min(15, duration)) : 5,
      resolution: String(task?.resolution || '720p').trim() || '720p',
      ratio: String(task?.ratio || '9:16').trim() || '9:16',
      generateAudio: task?.generateAudio !== false,
      watermark,
    }
  }
  if (provider === 'happyhorse') {
    const mode = String(task?.happyhorseMode || 'i2v').trim() || 'i2v'
    const params = {
      duration: Number.isFinite(duration) ? Math.max(3, Math.min(15, duration)) : 5,
      resolution: String(task?.resolution || '720P').trim().toUpperCase() || '720P',
      watermark,
    }
    if (mode !== 'i2v') {
      params.ratio = String(task?.ratio || (mode === 't2v' ? '16:9' : '9:16')).trim()
        || (mode === 't2v' ? '16:9' : '9:16')
    }
    return params
  }
  if (isKlingVideoProvider(provider)) {
    return {
      duration: Number.isFinite(duration) ? Math.max(3, Math.min(15, duration)) : 5,
      mode: String(task?.klingMode || task?.mode || 'std').trim() || 'std',
      aspect_ratio: String(task?.ratio || task?.aspect_ratio || '16:9').trim() || '16:9',
      audio: task?.generateAudio !== false,
      watermark,
    }
  }
  if (isPixVerseVideoProvider(provider)) {
    return {
      resolution: String(task?.resolution || '720P').trim().toUpperCase() || '720P',
      imagePath: String(task?.pixverseImagePath || task?.imagePath || '').trim(),
      imageUrl: String(task?.pixverseImageUrl || task?.imageUrl || '').trim(),
      videoPath: String(task?.pixverseVideoPath || task?.videoPath || '').trim(),
      videoUrl: String(task?.pixverseVideoUrl || task?.videoUrl || '').trim(),
      watermark,
    }
  }
  return {}
}

function videoTaskParamSummary(task = {}) {
  const gen = videoTaskGenerationParams(task)
  if (!gen || !Object.keys(gen).length) return ''
  if (isKlingVideoProvider(task.provider)) {
    return [
      gen.mode || 'std',
      gen.duration != null ? `${gen.duration}s` : '',
      gen.aspect_ratio || '16:9',
      `音频${gen.audio !== false ? '开' : '关'}`,
      `水印${gen.watermark ? '开' : '关'}`,
    ].filter(Boolean).join(' · ')
  }
  if (isPixVerseVideoProvider(task.provider)) {
    return [
      gen.resolution || '720P',
      `水印${gen.watermark ? '开' : '关'}`,
      (gen.imagePath || gen.imageUrl) && (gen.videoPath || gen.videoUrl) ? '角色图 + 动作视频' : '素材待补齐',
    ].filter(Boolean).join(' · ')
  }
  const parts = [
    gen.resolution,
    gen.duration != null ? `${gen.duration}s` : '',
    gen.ratio || (task.provider === 'happyhorse' && task.happyhorseMode === 'i2v' ? '随首帧' : ''),
  ]
  if (task.provider === 'seedance') {
    parts.push(`音频${gen.generateAudio !== false ? '开' : '关'}`)
  }
  parts.push(`水印${gen.watermark ? '开' : '关'}`)
  return parts.filter(Boolean).join(' · ')
}
const hasRefreshableVideoTask = computed(() => videoTasks.some(task => String(task.providerTaskId || task.runId || '').trim()))
const materialIsRunning = computed(() => isActiveWorkflowStatus(materialTask.status))
const aiIsRunning = computed(() => isActiveWorkflowStatus(aiTaskState.status))
const videoIsRunning = computed(() => isActiveWorkflowStatus(videoStageState.status))
function isVideoTaskBusy(task = {}) {
  return videoTaskBusyIds.has(String(task?.id || ''))
}

function isVideoTaskSelected(task = {}) {
  return isVideoTaskSubmittable(task) && selectedVideoTaskIds.has(String(task?.id || ''))
}

function isVideoTaskSubmittable(task = {}) {
  return isBalaVideoTaskSubmitEligible(task, videoResultForTask(task))
}

function videoTaskSelectionLabel(task = {}) {
  if (!isVideoTaskSubmittable(task)) return `${task.styleCode} 视频已生成或已下载，不可重复提交`
  return `${isVideoTaskSelected(task) ? '取消勾选' : '勾选'} ${task.styleCode} 视频任务`
}

function toggleVideoTaskSelection(task = {}) {
  const id = String(task?.id || '').trim()
  if (!id) return
  if (!isVideoTaskSubmittable(task)) {
    selectedVideoTaskIds.delete(id)
    return
  }
  if (selectedVideoTaskIds.has(id)) selectedVideoTaskIds.delete(id)
  else selectedVideoTaskIds.add(id)
}

function toggleAllVisibleVideoTaskSelection() {
  if (allVisibleVideoTasksSelected.value) {
    for (const task of selectableVisibleVideoTasks.value) selectedVideoTaskIds.delete(String(task.id || ''))
    return
  }
  for (const task of selectableVisibleVideoTasks.value) {
    const id = String(task.id || '').trim()
    if (id) selectedVideoTaskIds.add(id)
  }
}
const hasOpenModal = computed(() => Boolean(
  previewImage.value || pendingVersionDeletion.value || pendingVideoHistoryCleanup.value || localMaterialLibraryOpen.value || modelLibraryOpen.value || templateLibraryOpen.value || videoTaskDialogOpen.value || reviewBulkConfirmation.value || promptLibraryOpen.value,
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
const selectedVisibleReviewAssets = computed(() => filteredReviewStyles.value
  .flatMap(style => style.assets || [])
  .filter(asset => selectedReviewAssetIds.has(reviewAssetFeedbackKey(asset))))
const visibleReviewAssetCount = computed(() => filteredReviewStyles.value
  .reduce((total, style) => total + (style.assets || []).length, 0))
const allVisibleReviewAssetsSelected = computed(() => (
  visibleReviewAssetCount.value > 0 && selectedVisibleReviewAssets.value.length === visibleReviewAssetCount.value
))

watch([reviewFilter, reviewStatusFilter], () => {
  selectedReviewAssetIds.clear()
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
let workspaceFileSyncTimer = null

function replaceStyleWorkspaces(groups = [], { preserveView = false } = {}) {
  if (!preserveView) {
    for (const key of Object.keys(materialRenderLimits)) delete materialRenderLimits[key]
  }
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

function preserveMaterialScrollPosition() {
  const element = materialStyleListRef.value
  if (!element) return () => {}
  const top = element.scrollTop
  const distanceFromBottom = Math.max(0, element.scrollHeight - element.clientHeight - top)
  return () => {
    void nextTick().then(() => {
      requestAnimationFrame(() => {
        const current = materialStyleListRef.value
        if (!current) return
        const maxTop = Math.max(0, current.scrollHeight - current.clientHeight)
        current.scrollTop = distanceFromBottom <= 2
          ? maxTop
          : Math.min(top, maxTop)
      })
    })
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

function materialAssetsForDisplay(assets = []) {
  const source = sortBalaMaterialAssets(assets)
  return materialShowSelectedOnly.value ? source.filter(asset => asset.selected) : source
}

function visibleMaterialAssets(styleCode, sourceType, assets = []) {
  return materialAssetsForDisplay(assets).slice(0, materialRenderLimit(styleCode, sourceType))
}

function remainingMaterialAssetCount(styleCode, sourceType, assets = []) {
  return Math.max(0, materialAssetsForDisplay(assets).length - materialRenderLimit(styleCode, sourceType))
}

function showMoreMaterialAssets(styleCode, sourceType) {
  const key = materialRenderKey(styleCode, sourceType)
  materialRenderLimits[key] = materialRenderLimit(styleCode, sourceType) + MATERIAL_RENDER_CHUNK
}

function absoluteApiUrl(value = '') {
  const url = String(value || '').trim()
  if (!url) return ''
  if (/^(https?:|data:|blob:|file:)/i.test(url)) return url
  if (!url.startsWith('/')) return url
  const base = typeof window.cs?.getApiBase === 'function' ? window.cs.getApiBase() : ''
  return `${String(base || '').replace(/\/+$/, '')}${url}`
}

function localImagePathFor(asset = {}, thumbnail = false) {
  const candidates = [
    asset.path,
    asset.previewPath,
    thumbnail ? asset.thumbnailUrl : asset.imageUrl,
    thumbnail ? asset.thumbnail_url : asset.image_url,
  ]
  return candidates
    .map(value => String(value || '').trim())
    .find(value => value && !/^(https?:|data:|blob:)/i.test(value)) || ''
}

function resolveRemoteImageUrl(value = '') {
  const url = String(value || '').trim()
  if (!url || /^file:/i.test(url)) return ''
  if (/^(https?:|data:|blob:)/i.test(url)) return url
  if (/^\/(?:Users|Volumes|private|var|tmp|home)\//.test(url)) return ''
  return absoluteApiUrl(url)
}

function localImageCacheKey(path = '', thumbnail = false) {
  const key = String(path || '').trim()
  if (!key) return ''
  return thumbnail ? `thumb:${key}` : key
}

async function loadLocalImagePreview(path = '', { thumbnail = false } = {}) {
  const key = String(path || '').trim()
  if (!key) return
  const cacheKey = localImageCacheKey(key, thumbnail)
  if (!cacheKey || localImagePreviews[cacheKey] || brokenPreviews[cacheKey] || localImagePreviewLoading.has(cacheKey)) return
  localImagePreviewLoading.add(cacheKey)
  try {
    let dataUrl = ''
    const workspaceRoot = String(workspaceDir.value || '').trim()
    const workspaceReader = thumbnail
      ? window.cs?.readBalaWorkspaceImageThumbnail
      : window.cs?.readBalaWorkspaceImagePreview
    if (workspaceRoot && typeof workspaceReader === 'function') {
      try {
        const response = thumbnail
          ? await workspaceReader(workspaceRoot, key, { maxEdge: 280, quality: 0.72 })
          : await workspaceReader(workspaceRoot, key)
        if (response?.ok !== false) {
          dataUrl = String(response?.data_url || response?.dataUrl || '').trim()
        }
      } catch {
        // Assets outside the current workspace can still use the existing local-media bridge.
      }
    }
    // Grid / dense lists: compressed thumbnails only (full base64 of 10MB originals freezes the UI).
    if (!dataUrl && thumbnail && typeof window.cs?.readLocalImageThumbnail === 'function') {
      const response = await window.cs.readLocalImageThumbnail(key, { maxEdge: 280, quality: 0.72 })
      if (response?.ok === false) throw new Error(response?.error || '本地缩略图不可用')
      dataUrl = String(response?.data_url || response?.dataUrl || '').trim()
    }
    if (!dataUrl && typeof window.cs?.readLocalImagePreview === 'function') {
      const response = await window.cs.readLocalImagePreview(key)
      if (response?.ok === false) throw new Error(response?.error || '本地图片预览不可用')
      dataUrl = String(response?.data_url || response?.dataUrl || '').trim()
    }
    if (!dataUrl) throw new Error(thumbnail ? '本地缩略图不可用' : '本地图片预览不可用')
    localImagePreviews[cacheKey] = dataUrl
  } catch {
    brokenPreviews[cacheKey] = true
  } finally {
    localImagePreviewLoading.delete(cacheKey)
  }
}

function imagePreviewSource(asset = {}, { thumbnail = false } = {}) {
  const localPath = localImagePathFor(asset, thumbnail)
  if (localPath) {
    const cacheKey = localImageCacheKey(localPath, thumbnail)
    if (localImagePreviews[cacheKey]) return localImagePreviews[cacheKey]
    // Full preview may already be cached under raw path — allow reuse for non-thumb.
    if (!thumbnail && localImagePreviews[localPath]) return localImagePreviews[localPath]
    if (!brokenPreviews[cacheKey]) {
      void loadLocalImagePreview(localPath, { thumbnail })
      return ''
    }
  }

  // Local files are the stable source for workspace assets. A short-lived remote
  // batch URL remains a fallback if the local file is unavailable or unreadable.
  const remote = resolveRemoteImageUrl(
    thumbnail
      ? (asset.thumbnailUrl || asset.thumbnail_url || asset.imageUrl || asset.image_url)
      : (asset.imageUrl || asset.image_url || asset.thumbnailUrl || asset.thumbnail_url),
  )
  if (remote) return remote

  // Fallback to shared resolver (remote / cached full previews).
  return resolveBalaAssetPreviewSource(
    { ...asset, path: localPath },
    { localPreviews: localImagePreviews, thumbnail, resolveRemote: resolveRemoteImageUrl },
  )
}

function previewSourceFor(asset = {}) {
  return imagePreviewSource(asset, { thumbnail: false })
}

function videoTaskThumbLocalPath(asset = {}) {
  return String(asset?.path || asset?.previewPath || '').trim()
}

// Signed batch URLs are short-lived. Use them only after the local image preview fails.
function videoTaskThumbRemoteSource(asset = {}) {
  return resolveRemoteImageUrl(asset.thumbnailUrl || asset.thumbnail_url)
}

function enqueueVideoTaskThumb(asset = {}) {
  const id = String(asset?.id || '').trim()
  if (!id) return
  if (videoTaskThumbSrcMap[id] || videoTaskThumbLoading[id]) return
  const path = videoTaskThumbLocalPath(asset)
  const remoteSrc = videoTaskThumbRemoteSource(asset)
  if (path && !brokenPreviews[localImageCacheKey(path, true)]) {
    if (videoTaskThumbQueue.some(item => item.id === id)) return
    videoTaskThumbQueue.push({ id, path, remoteSrc })
    pumpVideoTaskThumbQueue()
    return
  }
  if (remoteSrc) videoTaskThumbSrcMap[id] = remoteSrc
}

function pumpVideoTaskThumbQueue() {
  while (videoTaskThumbActive < VIDEO_TASK_THUMB_CONCURRENCY && videoTaskThumbQueue.length) {
    const next = videoTaskThumbQueue.shift()
    if (!next?.id || !next?.path) continue
    if (videoTaskThumbSrcMap[next.id] || videoTaskThumbLoading[next.id]) continue
    videoTaskThumbActive += 1
    videoTaskThumbLoading[next.id] = true
    void loadLocalImagePreview(next.path, { thumbnail: true })
      .then(() => {
        const cacheKey = localImageCacheKey(next.path, true)
        const src = localImagePreviews[cacheKey] || ''
        if (src) videoTaskThumbSrcMap[next.id] = src
        else if (next.remoteSrc) videoTaskThumbSrcMap[next.id] = next.remoteSrc
        else brokenPreviews[cacheKey] = true
      })
      .catch(() => {
        const cacheKey = localImageCacheKey(next.path, true)
        if (next.remoteSrc) videoTaskThumbSrcMap[next.id] = next.remoteSrc
        else brokenPreviews[cacheKey] = true
      })
      .finally(() => {
        delete videoTaskThumbLoading[next.id]
        videoTaskThumbActive = Math.max(0, videoTaskThumbActive - 1)
        pumpVideoTaskThumbQueue()
      })
  }
}

function scheduleVideoTaskThumbs(assets = []) {
  for (const asset of assets || []) enqueueVideoTaskThumb(asset)
}

function disconnectVideoTaskThumbObserver() {
  if (videoTaskThumbObserver) {
    videoTaskThumbObserver.disconnect()
    videoTaskThumbObserver = null
  }
}

function observeVideoTaskThumbs() {
  disconnectVideoTaskThumbObserver()
  const root = videoTaskGridRef.value
  if (!root || typeof IntersectionObserver === 'undefined') {
    scheduleVideoTaskThumbs(displayedVideoTaskAssets.value)
    return
  }
  videoTaskThumbObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const id = entry.target?.getAttribute?.('data-vtask-id')
      if (!id) continue
      const asset = displayedVideoTaskAssets.value.find(item => String(item.id) === id)
      if (asset) enqueueVideoTaskThumb(asset)
    }
  }, { root, rootMargin: '180px 0px', threshold: 0.01 })
  root.querySelectorAll('[data-vtask-id]').forEach((el) => videoTaskThumbObserver.observe(el))
}

function markVideoTaskThumbBroken(asset = {}) {
  const id = String(asset?.id || '').trim()
  const path = videoTaskThumbLocalPath(asset)
  const cacheKey = localImageCacheKey(path, true)
  if (cacheKey) {
    brokenPreviews[cacheKey] = true
    delete localImagePreviews[cacheKey]
  }
  if (id) {
    delete videoTaskThumbSrcMap[id]
    delete videoTaskThumbLoading[id]
  }
}

function versionPreviewSource(version = {}, source = {}) {
  return resolveBalaVersionPreviewSource(version, source, {
    resolvePreview: previewSourceFor,
    brokenSources: brokenPreviews,
  })
}

function thumbnailSourceFor(asset = {}) {
  return imagePreviewSource(asset, { thumbnail: true })
}

function modelPreviewSource(model = {}) {
  return previewSourceFor({ imageUrl: model.imageUrl, path: model.path })
}

function localVideoPathFor(item = {}) {
  return [item.path, item.local_video_path, item.videoUrl, item.video_url]
    .map(value => String(value || '').trim())
    .find(value => value && !/^(https?:|data:|blob:)/i.test(value) && isBalaVideoFilePath(value)) || ''
}

function resolveRemoteVideoUrl(value = '') {
  const url = String(value || '').trim()
  if (!url || /^file:/i.test(url)) return ''
  if (/^(https?:|data:|blob:)/i.test(url)) return url
  if (/^\/(?:Users|Volumes|private|var|tmp|home)\//.test(url)) return ''
  return absoluteApiUrl(url)
}

async function loadLocalVideoPreview(path = '') {
  const key = String(path || '').trim()
  if (!key || localVideoPreviews[key] || brokenPreviews[key] || localVideoPreviewLoading.has(key)) return
  if (!workspaceDir.value || typeof window.cs?.getBalaWorkspaceVideoMedia !== 'function') return
  localVideoPreviewLoading.add(key)
  try {
    const response = await window.cs.getBalaWorkspaceVideoMedia(workspaceDir.value, key)
    const mediaUrl = String(response?.media_url || response?.mediaUrl || '').trim()
    if (!mediaUrl) throw new Error(response?.error || '本地视频预览不可用')
    localVideoPreviews[key] = mediaUrl
  } catch {
    brokenPreviews[key] = true
  } finally {
    localVideoPreviewLoading.delete(key)
  }
}

function mediaPlaybackSource(item = {}) {
  const localPath = localVideoPathFor(item)
  const remote = resolveBalaVideoPlaybackSource(
    { ...item, path: '', local_video_path: '' },
    { resolveRemote: resolveRemoteVideoUrl },
  )
  if (remote) return remote
  const localPreview = localVideoPreviews[localPath]
  if (!localPreview && localPath) void loadLocalVideoPreview(localPath)
  return localPreview || ''
}

function videoPlaybackSource(item = {}) {
  return mediaPlaybackSource(item)
}

function videoPlaybackLoading(item = {}) {
  return localVideoPreviewLoading.has(localVideoPathFor(item))
}

function templateVideoSource(template = {}) {
  return mediaPlaybackSource({ videoUrl: template.remoteVideo || template.video, path: template.video })
}

function templatePosterSource(template = {}) {
  return imagePreviewSource({ imageUrl: template.remoteCover, path: template.cover })
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
  replaceStyleWorkspaces([])
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

function releaseWorkspacePreviews() {
  for (const key of Object.keys(localVideoPreviews)) delete localVideoPreviews[key]
  for (const key of Object.keys(localImagePreviews)) delete localImagePreviews[key]
  for (const key of Object.keys(brokenPreviews)) delete brokenPreviews[key]
}

function workspaceAssetFromFile(file = {}) {
  return {
    id: `workspace-${String(file.path || '').trim()}`,
    path: String(file.path || '').trim(),
    name: String(file.name || fileNameFromPath(file.path)).trim(),
    filename: String(file.name || fileNameFromPath(file.path)).trim(),
    styleCode: String(file.styleCode || '').trim(),
    sourceType: String(file.sourceType || 'other').trim(),
    role: String(file.sourceType || '') === 'model' ? '模拍' : (String(file.sourceType || '') === 'detail' ? '细节' : '素材'),
    fileVersion: String(file.version || '').trim(),
    selected: Boolean(file.isAi) || isBalaAiNamedMaterial(String(file.name || '')),
    editSelected: false,
    versions: [],
  }
}

function applyWorkspaceFileSync(files = []) {
  const restoreScroll = preserveMaterialScrollPosition()
  const byPath = new Map((files || []).map(file => [String(file?.path || '').trim(), file]).filter(([path]) => path))
  let changed = false
  for (const style of styleWorkspaces) {
    for (const key of ['modelPhotos', 'detailPhotos', 'otherPhotos']) {
      const kept = []
      for (const asset of style[key] || []) {
        const current = byPath.get(String(asset?.path || '').trim())
        if (!current) {
          changed = true
          continue
        }
        if (String(asset.fileVersion || '') !== String(current.version || '')) {
          asset.fileVersion = String(current.version || '')
          changed = true
        }
        asset.versions = (asset.versions || []).filter(version => !version.previewPath || byPath.has(String(version.previewPath)))
        kept.push(asset)
        byPath.delete(String(asset.path || ''))
      }
      style[key] = kept
    }
  }
  for (const file of byPath.values()) {
    if (!file.styleCode || !['model', 'detail'].includes(file.sourceType)) continue
    let style = styleWorkspaces.find(item => item.styleCode === file.styleCode)
    if (!style) {
      style = { styleCode: file.styleCode, modelPhotos: [], detailPhotos: [], otherPhotos: [], skippedRows: [], errors: [], generated: [] }
      styleWorkspaces.push(style)
    }
    style[file.sourceType === 'model' ? 'modelPhotos' : 'detailPhotos'].push(workspaceAssetFromFile(file))
    changed = true
  }
  if (changed) {
    const deduped = mergeBalaMaterialGroups([], styleWorkspaces)
    styleWorkspaces.splice(0, styleWorkspaces.length, ...deduped)
    releaseWorkspacePreviews()
    restoreScroll()
  }
}

async function syncWorkspaceFiles() {
  if (!workspaceDir.value || typeof window.cs?.listBalaWorkspaceImages !== 'function') return
  try {
    applyWorkspaceFileSync(await window.cs.listBalaWorkspaceImages(workspaceDir.value))
  } catch {
    // Folder changes can race Finder writes; the next poll will retry safely.
  }
}

function resetWorkflowWorkspace() {
  resetMaterialWorkspace()
  resetAiPoll()
  aiReviewPollToken += 1
  reviewBatch.value = null
  reviewBoardUrl.value = ''
  reviewStyles.splice(0, reviewStyles.length)
  videoJobs.splice(0, videoJobs.length)
  videoTasks.splice(0, videoTasks.length)
  videoResults.splice(0, videoResults.length)
  activeAction.value = 'face_swap'
  selectedModel.value = null
  garmentImagePaths.value = []
  outfitReferencePaths.value = []
  variantReferencePaths.value = []
  Object.assign(aiTaskState, {
    status: 'idle',
    message: '选择素材和动作后生成预检任务',
    error: '',
    progress: 0,
    runId: '',
    outputFiles: [],
    logs: [],
  })
  releaseWorkspacePreviews()
}

async function applyWorkspaceDirectory(path = '') {
  const next = String(path || '').trim()
  if (!next) return
  const changed = next !== workspaceDir.value
  if (changed) {
    persistWorkspaceState()
    await flushWorkspaceManifest(workspaceDir.value)
  }
  workspaceDir.value = next
  videoTaskDraft.outputDir = next
  persistWorkspaceDir(next)
  if (changed) {
    resetWorkflowWorkspace()
    restoreWorkspaceSnapshot(next)
    await restoreWorkspaceManifest(next)
  }
  workspaceStateHydrated = true
  persistWorkspaceState()
}

async function pickMaterialOutputDirectory() {
  try {
    const selected = await window.cs.selectBalaWorkspace({
      title: '选择 AI 视频工作区目录',
      defaultPath: workspaceDir.value,
    })
    const path = Array.isArray(selected) ? selected[0] : selected
    await applyWorkspaceDirectory(path)
    if (String(path || '').trim()) materialWorkspaceRequired.value = false
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
    await applyWorkspaceDirectory(path)
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

async function pickPixVerseMotionVideo() {
  if (typeof window.cs?.browseFile !== 'function') {
    videoTaskDraftError.value = '当前环境不支持系统文件选择器，请在抓虾桌面端使用'
    return
  }
  try {
    const selected = await window.cs.browseFile({
      title: '选择 PixVerse 动作视频',
      filters: [
        { name: '视频文件', extensions: ['mp4', 'mov', 'm4v', 'webm'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    const path = Array.isArray(selected) ? selected[0] : selected
    if (String(path || '').trim()) {
      if (!isSupportedLocalVideoPath(path)) {
        videoTaskDraftError.value = 'PixVerse 动作视频仅支持 MP4、MOV、M4V、WEBM'
        return
      }
      videoTaskDraft.pixverseVideoPath = String(path).trim()
      videoTaskDraft.pixverseVideoUrl = ''
      videoTaskDraftError.value = ''
    }
  } catch (error) {
    videoTaskDraftError.value = error?.message || String(error)
  }
}

function materialRunParams() {
  return {
    ...buildBalaMaterialPrepareParams({
      itemCodes: styleCodes.value,
      cloudPath: cloudPath.value,
      exportFolder: materialOutputDir.value,
      packageName: materialPackageName.value,
    }),
    workspace_dir: workspaceDir.value,
  }
}

function normalizedWorkspacePath(value = '') {
  return String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

function runBelongsToCurrentWorkspace(run = {}) {
  const workspace = normalizedWorkspacePath(workspaceDir.value)
  if (!workspace) return false
  const params = run?.params && typeof run.params === 'object' ? run.params : {}
  const candidates = [
    run?.workspace_dir,
    run?.workspaceDir,
    run?.output_dir,
    run?.outputDir,
    params.workspace_dir,
    params.workspaceDir,
    params.export_folder,
    params.output_dir,
    ...parseRunOutputFiles(run?.output_files),
  ].map(normalizedWorkspacePath).filter(Boolean)
  return candidates.some(candidate => candidate === workspace || candidate.startsWith(`${workspace}/`))
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
    materialWorkspaceRequired.value = true
    updateMaterialTask({ status: 'failed', error: '请先选择 AI 视频工作区目录', message: '请先选择 AI 视频工作区目录。' })
    return
  }
  materialWorkspaceRequired.value = false
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
    if (!workspaceDir.value) return
    const status = await window.cs.getTaskStatus(BALA_AI_VIDEO_ADAPTER_ID, BALA_MATERIAL_PREPARE_TASK_ID)
    const live = status?.live
    const liveRunId = String(live?.run_id || '').trim()
    if (liveRunId && isActiveWorkflowStatus(live?.status) && runBelongsToCurrentWorkspace(live)) {
      materialPollRunId = liveRunId
      applyMaterialLiveStatus(live)
      scheduleMaterialPoll()
      return
    }
    const last = status?.last_run
    const lastRunId = String(last?.id || last?.run_id || '').trim()
    if (!lastRunId || !isTerminalMaterialStatus(last?.status) || !runBelongsToCurrentWorkspace(last)) return
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
  const groups = normalizeBalaMaterialGroups({
    batch,
    rows: downloadedRows,
  })
  const mergedGroups = mergeBalaMaterialGroups(styleWorkspaces, groups)
  replaceStyleWorkspaces(mergedGroups, { preserveView: true })
  const summary = summarizeBalaMaterialGroups(mergedGroups)
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

function normalizeSelectedFilePaths(selected) {
  if (Array.isArray(selected)) {
    return selected.map(item => String(item || '').trim()).filter(Boolean)
  }
  return String(selected || '').split(',').map(item => item.trim()).filter(Boolean)
}

function isSupportedLocalImagePath(path = '') {
  return /\.(?:png|jpe?g|webp)$/i.test(String(path || '').trim())
}

function isSupportedLocalVideoPath(path = '') {
  return /\.(?:mp4|mov|m4v|webm)$/i.test(String(path || '').trim())
}

async function uploadLocalReviewImage(styleCode = '') {
  const targetStyleCode = String(styleCode || '').trim()
  if (!targetStyleCode) return
  if (typeof window.cs?.browseFile !== 'function') {
    reviewActionError.value = '当前环境不支持系统文件选择器，请在抓虾桌面端使用'
    aiTaskState.status = 'failed'
    aiTaskState.error = reviewActionError.value
    aiTaskState.message = reviewActionError.value
    return
  }
  try {
    const selected = await window.cs.browseFile({
      title: '上传本地图到审图池',
      images: true,
      multi: true,
    })
    const pickedPaths = normalizeSelectedFilePaths(selected)
    const paths = pickedPaths.filter(isSupportedLocalImagePath)
    if (!paths.length) {
      if (pickedPaths.length) {
        reviewActionError.value = '请选择 JPG、PNG 或 WEBP 图片'
        aiTaskState.status = 'failed'
        aiTaskState.error = reviewActionError.value
        aiTaskState.message = reviewActionError.value
      }
      return
    }
    let style = reviewStyles.find(item => item.styleCode === targetStyleCode)
    if (!style) {
      style = { styleCode: targetStyleCode, assets: [], sourceAssets: [] }
      reviewStyles.push(style)
    }
    style.assets = Array.isArray(style.assets) ? style.assets : []
    const now = Date.now()
    paths.forEach((path, index) => {
      const name = fileNameFromPath(path) || `本地图 ${index + 1}`
      style.assets.push({
        id: `local-review-${targetStyleCode}-${now}-${index}`,
        label: name,
        action: '本地上传',
        operationType: 'local_upload',
        status: 'pending',
        meta: '本地上传 · 待审核',
        path,
        previewPath: path,
        sourcePath: path,
        sourceAssetId: '',
        imageUrl: '',
        jobUid: '',
        runUid: '',
        reviewBoardUrl: '',
        kind: 'ai',
      })
    })
    addImageMenuStyle.value = ''
    reviewActionError.value = ''
    aiTaskState.status = 'done'
    aiTaskState.error = ''
    const ignoredCount = pickedPaths.length - paths.length
    aiTaskState.message = `已上传 ${paths.length} 张本地图到 ${targetStyleCode} 审图池${ignoredCount ? `，已忽略 ${ignoredCount} 个非图片文件` : ''}`
    persistAiImageWorkspaceState()
    buildVideoJobsFromReview()
  } catch (error) {
    reviewActionError.value = error?.message || String(error)
    aiTaskState.status = 'failed'
    aiTaskState.error = reviewActionError.value
    aiTaskState.message = reviewActionError.value
  }
}

function isMaterialExpanded(styleCode) {
  return materialExpanded[styleCode] !== false
}

function expandAllMaterialGroups() {
  for (const style of styleWorkspaces) materialExpanded[style.styleCode] = true
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

function editableInputsForStyle(style = {}) {
  return (style.modelPhotos || []).flatMap(source => [source, ...visibleSourceVersions(source)])
}

function styleEditSelectionLabel(style = {}) {
  const inputs = editableInputsForStyle(style)
  return inputs.length && inputs.every(asset => asset.editSelected) ? '本款取消全选' : '本款全选改图'
}

function toggleStyleEditSelection(style = {}) {
  const inputs = editableInputsForStyle(style)
  const next = !inputs.length || !inputs.every(asset => asset.editSelected)
  for (const asset of inputs) asset.editSelected = next
}

const allEditSelectionLabel = computed(() => {
  const inputs = styleWorkspaces.flatMap(style => editableInputsForStyle(style))
  return inputs.length && inputs.every(asset => asset.editSelected) ? '整列取消全选' : '整列全选改图'
})

function toggleAllEditSelection() {
  const inputs = styleWorkspaces.flatMap(style => editableInputsForStyle(style))
  const next = !inputs.length || !inputs.every(asset => asset.editSelected)
  for (const asset of inputs) asset.editSelected = next
}

/** Select this original as an AI-edit input so the left action can generate more versions. */
function continueEditingSource(source = {}) {
  if (!source || typeof source !== 'object') return
  source.editSelected = true
}

function enterAiEditWorkspace() {
  expandAllMaterialGroups()
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
  ]).filter(asset => asset.selected && asset.id && !asset.localReviewOnly).map(asset => asset.id)
}

function selectedSourceAssetsForAi() {
  return styleWorkspaces.flatMap(style => (style.modelPhotos || []).flatMap((asset) => [
    ...(asset.editSelected ? [{ style, asset, version: null }] : []),
    ...visibleSourceVersions(asset)
      .filter(version => version.editSelected)
      .map(version => ({ style, asset, version })),
  ]))
}

function compactText(value = '') {
  return String(value || '').trim()
}

function reviewAssetLocalPath(asset = {}) {
  return compactText(asset?.path || asset?.previewPath || asset?.sourcePath)
}

function reviewAssetPathCandidates(asset = {}) {
  return [
    asset?.path,
    asset?.previewPath,
    asset?.sourcePath,
  ].map(compactText).filter(Boolean)
}

function reviewAssetRemoteId(asset = {}) {
  return compactText(asset?.remoteAssetId || asset?.remote_asset_id)
}

function canRegenerateRemoteReviewAsset(asset = {}) {
  return Boolean(reviewAssetRemoteId(asset) && parseBalaReviewBoardUrl(asset?.reviewBoardUrl))
}

function reviewAssetIdentityMatches(left = {}, right = {}) {
  if (!left || !right) return false
  if (left === right) return true
  const leftRemoteId = reviewAssetRemoteId(left)
  const rightRemoteId = reviewAssetRemoteId(right)
  if (leftRemoteId && rightRemoteId && leftRemoteId === rightRemoteId) return true
  const leftId = compactText(left.id)
  const rightId = compactText(right.id)
  if (leftId && rightId && leftId === rightId) return true
  const rightPaths = new Set(reviewAssetPathCandidates(right))
  return reviewAssetPathCandidates(left).some(path => rightPaths.has(path))
}

function reviewStyleCodeForAsset(asset = {}) {
  const direct = compactText(asset?.styleCode || asset?.style_code || asset?.itemCode || asset?.item_code)
  if (direct) return direct
  const owner = reviewStyles.find(style => (style.assets || []).some(candidate => reviewAssetIdentityMatches(candidate, asset)))
  return compactText(owner?.styleCode)
}

function workspaceStylesForReviewAsset(asset = {}) {
  const styleCode = reviewStyleCodeForAsset(asset)
  const exact = styleCode ? styleWorkspaces.filter(style => style.styleCode === styleCode) : []
  const others = styleWorkspaces.filter(style => !styleCode || style.styleCode !== styleCode)
  return [...exact, ...others]
}

function findAiEditInputForReviewAsset(asset = {}) {
  const paths = new Set(reviewAssetPathCandidates(asset))
  const remoteId = reviewAssetRemoteId(asset)
  const sourceAssetId = compactText(asset?.sourceAssetId || asset?.source_asset_id)
  const jobUid = compactText(asset?.jobUid || asset?.job_uid)
  const runUid = compactText(asset?.runUid || asset?.run_uid)
  for (const style of workspaceStylesForReviewAsset(asset)) {
    for (const source of style.modelPhotos || []) {
      const sourcePath = compactText(source.path)
      const sourceId = compactText(source.id)
      if (
        asset.kind === 'origin'
        && (
          (sourceAssetId && sourceId === sourceAssetId)
          || (sourcePath && paths.has(sourcePath))
        )
      ) {
        return { style, source, version: null }
      }
      const version = (source.versions || []).find(candidate => (
        (jobUid && compactText(candidate.jobUid || candidate.job_uid) === jobUid)
        || (runUid && compactText(candidate.runUid || candidate.run_uid) === runUid)
        || (remoteId && compactText(candidate.remoteAssetId || candidate.remote_asset_id) === remoteId)
        || paths.has(compactText(candidate.previewPath || candidate.path))
      ))
      if (version) return { style, source, version }
      if (sourcePath && paths.has(sourcePath)) return { style, source, version: null }
    }
  }
  return null
}

function findParentAiEditSourceForReviewAsset(asset = {}) {
  const sourceAssetId = compactText(asset?.sourceAssetId || asset?.source_asset_id)
  const sourcePath = compactText(asset?.sourcePath || asset?.source_path)
  for (const style of workspaceStylesForReviewAsset(asset)) {
    for (const source of style.modelPhotos || []) {
      const sourceId = compactText(source.id)
      const path = compactText(source.path)
      if ((sourceAssetId && sourceId === sourceAssetId) || (sourcePath && path === sourcePath)) {
        return { style, source }
      }
    }
  }
  return null
}

function ensureAiEditStyleForReviewAsset(asset = {}) {
  const styleCode = reviewStyleCodeForAsset(asset)
  let style = styleWorkspaces.find(item => item.styleCode === styleCode)
  if (!style && styleCode) {
    style = { styleCode, modelPhotos: [], detailPhotos: [], skippedRows: [] }
    styleWorkspaces.push(style)
  }
  return style || styleWorkspaces[0] || null
}

function createAiEditVersionFromReviewAsset(asset = {}) {
  const path = reviewAssetLocalPath(asset)
  if (!path || asset?.kind === 'origin') return null
  const parent = findParentAiEditSourceForReviewAsset(asset)
  if (!parent?.source) return null
  parent.source.versions = Array.isArray(parent.source.versions) ? parent.source.versions : []
  const operationType = normalizeOperationType(compactText(asset.operationType || asset.operation_type || asset.action).replace(/\s+/g, ''))
  const version = {
    id: compactText(asset.id || path),
    remoteAssetId: reviewAssetRemoteId(asset),
    action: compactText(asset.action || activeActionTitle.value),
    operationType,
    label: compactText(asset.label || fileNameFromPath(path) || 'AI 结果'),
    meta: compactText(asset.meta || ''),
    selected: normalizeBalaReviewStatus(asset.status) === 'approved',
    status: normalizeBalaReviewStatus(asset.status),
    progress: 100,
    sourceAssetId: compactText(parent.source.id),
    sourcePath: compactText(parent.source.path),
    previewPath: path,
    imageUrl: '',
    jobUid: compactText(asset.jobUid || asset.job_uid),
    runUid: compactText(asset.runUid || asset.run_uid),
    reviewBoardUrl: compactText(asset.reviewBoardUrl),
    editSelected: true,
  }
  parent.source.versions.push(version)
  return { ...parent, version }
}

function createAiEditSourceFromReviewAsset(asset = {}) {
  const path = reviewAssetLocalPath(asset)
  if (!path) return null
  const style = ensureAiEditStyleForReviewAsset(asset)
  if (!style) return null
  style.modelPhotos = Array.isArray(style.modelPhotos) ? style.modelPhotos : []
  const id = compactText(asset.kind === 'origin' ? (asset.sourceAssetId || asset.id || path) : (asset.id || path)) || `review-local-${Date.now()}`
  const source = {
    id,
    role: '审图图片',
    sourceType: 'model',
    name: compactText(asset.label || asset.name || fileNameFromPath(path) || '本地审图图片'),
    filename: fileNameFromPath(path),
    path,
    imageUrl: '',
    thumbnailUrl: '',
    selected: true,
    editSelected: true,
    localReviewOnly: true,
    downloadResult: '本地审图图片',
    action: compactText(asset.action || '继续改图'),
    note: compactText(asset.meta || ''),
    reviewStatus: normalizeBalaReviewStatus(asset.status),
    remoteAssetId: reviewAssetRemoteId(asset),
    reviewBoardUrl: compactText(asset.reviewBoardUrl),
    versions: [],
  }
  style.modelPhotos.push(source)
  return { style, source, version: null }
}

function activateAiEditInputForReviewAsset(match, asset = {}) {
  if (!match?.source) return false
  if (match.version) match.version.editSelected = true
  else match.source.editSelected = true
  const rawOperation = compactText(asset?.operationType || asset?.operation_type || asset?.action)
  if (rawOperation && asset?.kind !== 'origin') activeAction.value = normalizeOperationType(rawOperation.replace(/\s+/g, ''))
  activeStep.value = 'ai-edit'
  reviewActionError.value = ''
  addImageMenuStyle.value = ''
  updateAiTaskState({
    status: 'idle',
    error: '',
    message: '已选中这张图，请在左侧选择动作后点击开始生图',
  })
  persistAiImageWorkspaceState()
  return true
}

function queueLocalReviewAssetForAiEdit(asset = {}) {
  const match = findAiEditInputForReviewAsset(asset) || createAiEditVersionFromReviewAsset(asset) || createAiEditSourceFromReviewAsset(asset)
  if (match) return activateAiEditInputForReviewAsset(match, asset)
  const message = '这张图片没有可用的本地文件，无法继续改图。请先上传本地图，或回到找图步骤补选素材。'
  reviewActionError.value = message
  updateAiTaskState({
    status: 'failed',
    error: message,
    message,
  })
  return false
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

function shortDisplayName(value = '', max = 28) {
  const text = String(value || '').trim()
  if (!text || text.length <= max) return text
  const head = Math.max(8, Math.floor((max - 1) * 0.55))
  const tail = Math.max(6, max - head - 1)
  return `${text.slice(0, head)}…${text.slice(-tail)}`
}

function shortDisplayPath(path = '', max = 42) {
  const text = String(path || '').trim()
  if (!text || text.length <= max) return text
  return `…${text.slice(-(max - 1))}`
}

function localMaterialCategoryLabel(asset = {}) {
  if (asset?.sourceType === 'model') return '模特图'
  if (asset?.sourceType === 'detail') return '平拍图'
  return asset?.role || '素材'
}

function clearOutfitImages(kind) {
  if (kind === 'garment') garmentImagePaths.value = []
  else if (kind === 'variant') variantReferencePaths.value = []
  else outfitReferencePaths.value = []
}

function ensureAiImageModelSelected() {
  const configured = configuredAiImageModels.value
  if (!configured.length) {
    selectedAiImageModelId.value = ''
    return false
  }
  if (!configured.some(model => model.id === selectedAiImageModelId.value)) {
    selectedAiImageModelId.value = configured[0].id
  }
  return true
}

async function loadAiImageSettings() {
  try {
    aiImageSettings.value = typeof window.cs?.getSettings === 'function'
      ? await window.cs.getSettings()
      : {}
  } catch {
    aiImageSettings.value = {}
  }
  ensureAiImageModelSelected()
}

function openAiImageModelSettings() {
  emit('open-settings', 'ai-1xm')
}

function resolveSelectedAiImageGenerationParams() {
  const model = selectedAiImageModel.value
  const ratio = '3:4'
  const size = isNanoBananaModel(model.id)
    ? (model.size || '2K')
    : sizeForModel(model.id, ratio, model.size)
  return {
    model,
    modelKey: model.key,
    modelKeyTier: model.keyTier,
    size,
    quality: isNanoBananaModel(model.id) ? undefined : 'high',
    outputFormat: 'png',
  }
}

async function uploadLocalMaterialFromDisk() {
  if (typeof window.cs?.browseFile !== 'function') {
    updateAiTaskState({
      status: 'failed',
      error: '当前环境不支持系统文件选择器，请在抓虾桌面端使用',
      message: '当前环境不支持系统文件选择器，请在抓虾桌面端使用',
    })
    return
  }
  try {
    const selected = await window.cs.browseFile({
      title: `上传${activeLocalReferenceLabel.value}`,
      images: true,
      multi: true,
    })
    const paths = Array.isArray(selected)
      ? selected.map(item => String(item || '').trim()).filter(Boolean)
      : String(selected || '').split(',').map(item => item.trim()).filter(Boolean)
    if (!paths.length) return
    const target = referencePathsForKind(activeLocalReferenceKind.value)
    target.value = [...new Set([...target.value, ...paths])]
  } catch (error) {
    updateAiTaskState({
      status: 'failed',
      error: error?.message || String(error),
      message: error?.message || String(error),
    })
  }
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
  if (!ensureAiImageModelSelected()) {
    updateAiTaskState({ status: 'failed', error: '尚未配置可用生图模型，请先到设置页配置 1XM 图片模型', message: '尚未配置可用生图模型，请先到设置页配置 1XM 图片模型' })
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

  const generation = resolveSelectedAiImageGenerationParams()
  resetAiPoll()
  aiReviewPollToken += 1
  updateAiTaskState({
    status: 'running',
    message: `正在用 ${generation.model.label} 创建并提交 AI 改图任务...`,
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
      model: generation.modelKey,
      model_key_tier: generation.modelKeyTier,
      image_size: generation.size,
      quality: generation.quality || 'high',
      output_format: generation.outputFormat,
    })
    const request = buildBalaAiStageRequest(exportResult)
    const params = {
      ...request.params,
      workflow: BALA_AI_IMAGE_TASK_ID,
      surface: 'ai-video-workflow',
      workspace_dir: workspaceDir.value,
      source_images: { paths: selectedInputPaths },
      source_limit: selectedInputPaths.length,
      generation_mode: 'submit_async',
      review_mode: 'create_review_batch',
      model: generation.modelKey,
      model_key_tier: generation.modelKeyTier,
      image_size: generation.size,
      quality: generation.quality || 'high',
      output_format: generation.outputFormat,
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
      workspace_dir: workspaceDir.value,
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
    if (!workspaceDir.value) throw new Error('请先选择 AI 视频工作区目录')
    const data = await window.cs.getData(BALA_AI_VIDEO_ADAPTER_ID, BALA_AI_IMAGE_TASK_ID)
    const run = latestRunForTaskData(data)
    if (!run) throw new Error('还没有可刷新的审核池')
    if (!runBelongsToCurrentWorkspace(run)) throw new Error('最近的 AI 改图任务不属于当前工作区')
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
  if (stepId === 'ai-edit') {
    expandAllMaterialGroups()
    void loadAiImageSettings()
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

function reviewAssetFeedbackKey(asset = {}) {
  return String(asset?.id || asset?.remoteAssetId || '').trim()
}

function isReviewAssetSelected(asset = {}) {
  const key = reviewAssetFeedbackKey(asset)
  return Boolean(key && selectedReviewAssetIds.has(key))
}

function toggleReviewAssetSelection(asset = {}) {
  const key = reviewAssetFeedbackKey(asset)
  if (!key || isReviewAssetSaving(asset)) return
  if (selectedReviewAssetIds.has(key)) selectedReviewAssetIds.delete(key)
  else selectedReviewAssetIds.add(key)
}

function clearReviewAssetSelection(assets = []) {
  if (!assets.length) {
    selectedReviewAssetIds.clear()
    return
  }
  for (const asset of assets) {
    const key = reviewAssetFeedbackKey(asset)
    if (key) selectedReviewAssetIds.delete(key)
  }
}

function toggleAllVisibleReviewAssetSelections() {
  const assets = filteredReviewStyles.value.flatMap(style => style.assets || [])
  if (!assets.length) return
  if (allVisibleReviewAssetsSelected.value) {
    clearReviewAssetSelection(assets)
    return
  }
  for (const asset of assets) {
    const key = reviewAssetFeedbackKey(asset)
    if (key && !isReviewAssetSaving(asset)) selectedReviewAssetIds.add(key)
  }
}

function isReviewAssetSaving(asset = {}) {
  const key = reviewAssetFeedbackKey(asset)
  return Boolean(key && reviewAssetSavingIds.has(key))
}

function reviewAssetFeedbackLabel(asset = {}) {
  const status = reviewAssetFeedback[reviewAssetFeedbackKey(asset)]
  if (status === 'approved') return '已通过'
  if (status === 'rejected') return '已舍弃'
  if (status === 'retry') return '已加入重跑队列'
  return ''
}

function flashReviewAssetFeedback(asset = {}, status = '') {
  const key = reviewAssetFeedbackKey(asset)
  if (!key || !status) return
  const previousTimer = reviewFeedbackTimers.get(key)
  if (previousTimer) clearTimeout(previousTimer)
  reviewAssetFeedback[key] = status
  reviewFeedbackTimers.set(key, setTimeout(() => {
    delete reviewAssetFeedback[key]
    reviewFeedbackTimers.delete(key)
  }, 900))
}

async function setReviewAssetStatus(asset, status) {
  const key = reviewAssetFeedbackKey(asset)
  if (!key || reviewAssetSavingIds.has(key)) return
  reviewAssetSavingIds.add(key)
  try {
    const saved = await saveReviewAssetDecisions([{ asset, status }])
    if (saved) {
      clearReviewAssetSelection([asset])
      flashReviewAssetFeedback(asset, status)
    }
  } finally {
    reviewAssetSavingIds.delete(key)
  }
}

function requestStyleReviewStatus(style, status) {
  if (status !== 'approved' && status !== 'rejected') return
  requestReviewBulkAction(style.assets || [], status, `${style.styleCode} 本款审核`)
}

function requestPendingReviewStatus(status) {
  const assets = reviewStyles.flatMap(style => style.assets || []).filter(asset => asset.status === 'pending')
  requestReviewBulkAction(assets, status, '当前筛选范围内的待审图片')
}

function requestSelectedReviewStatus(status) {
  const assets = selectedVisibleReviewAssets.value
  if (!assets.length) {
    reviewActionError.value = '请先选择需要处理的图片'
    return
  }
  requestReviewBulkAction(assets, status, '已选图片')
}

function requestReviewBulkAction(assets = [], status = 'pending', scopeLabel = '批量审核') {
  const entries = assets
    .filter(Boolean)
    .map(asset => ({ asset, status: normalizeBalaReviewStatus(status), previousStatus: normalizeBalaReviewStatus(asset.status) }))
  if (!entries.length) {
    reviewActionError.value = '当前范围内没有可批量处理的图片'
    return
  }
  reviewActionError.value = ''
  recentReviewBulkAction.value = null
  lastFocusedElement.value = document.activeElement
  reviewBulkConfirmation.value = { status: normalizeBalaReviewStatus(status), scopeLabel, entries }
}

function cancelReviewBulkAction() {
  reviewBulkConfirmation.value = null
  reviewActionError.value = ''
}

async function confirmReviewBulkAction() {
  const confirmation = reviewBulkConfirmation.value
  if (!confirmation) return
  reviewActionError.value = ''
  const saved = await saveReviewAssetDecisions(confirmation.entries)
  if (!saved) return
  recentReviewBulkAction.value = {
    scopeLabel: confirmation.scopeLabel,
    status: confirmation.status,
    entries: confirmation.entries.map(entry => ({ ...entry })),
  }
  clearReviewAssetSelection(confirmation.entries.map(entry => entry.asset))
  reviewBulkConfirmation.value = null
}

async function undoReviewBulkAction() {
  const action = recentReviewBulkAction.value
  if (!action) return
  reviewActionError.value = ''
  const restored = await saveReviewAssetDecisions(action.entries.map(entry => ({
    asset: entry.asset,
    status: entry.previousStatus,
  })))
  if (restored) recentReviewBulkAction.value = null
}

async function saveReviewAssetDecisions(entries = []) {
  if (!entries.length) return true
  try {
    const grouped = new Map()
    const localEntries = []
    for (const entry of entries) {
      const asset = entry.asset
      const status = normalizeBalaReviewStatus(entry.status)
      if (!asset) continue
      const boardUrl = asset.reviewBoardUrl
      const ref = parseBalaReviewBoardUrl(boardUrl)
      if (!ref) {
        localEntries.push({ asset, status })
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
    for (const entry of localEntries) applyLocalReviewDecision(entry.asset, entry.status)
    return true
  } catch (error) {
    reviewActionError.value = error?.message || String(error)
    aiTaskState.status = 'failed'
    aiTaskState.error = reviewActionError.value
    aiTaskState.message = aiTaskState.error
    return false
  }
}

function visibleReviewSourceAssets(style = {}) {
  return (style.sourceAssets || []).slice(0, 3)
}

function hiddenReviewSourceAssets(style = {}) {
  return (style.sourceAssets || []).slice(3)
}

function hiddenReviewSourceAssetCount(style = {}) {
  return hiddenReviewSourceAssets(style).length
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
  if (!asset) return
  const retryPrompt = String(asset.prompt || '').trim()
  if (!canRegenerateRemoteReviewAsset(asset)) {
    queueLocalReviewAssetForAiEdit(asset)
    return
  }
  const key = reviewAssetFeedbackKey(asset)
  if (!key || reviewAssetSavingIds.has(key)) return
  reviewAssetSavingIds.add(key)
  const previousStatus = asset.status
  const previousMeta = asset.meta
  clearReviewAssetSelection([asset])
  asset.status = 'retry'
  asset.meta = `${asset.meta || asset.action} · 已请求重跑`
  flashReviewAssetFeedback(asset, 'retry')
  try {
    const boardUrl = asset.reviewBoardUrl
    const ref = parseBalaReviewBoardUrl(boardUrl)
    if (!ref) return
    const remoteAssetId = reviewAssetRemoteId(asset)
    const result = await window.cs.regenerateBalaReviewAsset(ref.batchId, ref.token, {
      asset_id: remoteAssetId,
      prompt: retryPrompt,
      submit_async: true,
    })
    const batch = result?.batch || await window.cs.refreshBalaReviewBatch(ref.batchId, ref.token)
    reviewBatch.value = batch
    const styles = normalizeBalaReviewBatchStyles(batch, { reviewBoardUrl: boardUrl })
    applyReviewBatchStyles(styles)
  } catch (error) {
    const detail = error?.message || String(error)
    if (/Bala review asset not found/i.test(detail)) {
      asset.status = previousStatus
      asset.meta = previousMeta
      if (queueLocalReviewAssetForAiEdit(asset)) return
      const message = '这张图不在当前审核批次里，请先上传本地图，或回到 AI 改图重新生成。'
      aiTaskState.status = 'failed'
      aiTaskState.error = message
      aiTaskState.message = message
      return
    }
    aiTaskState.status = 'failed'
    aiTaskState.error = detail
    aiTaskState.message = aiTaskState.error
  } finally {
    reviewAssetSavingIds.delete(key)
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

function videoResultForTask(task = {}) {
  const taskId = String(task?.id || '').trim()
  if (!taskId) return null
  return videoResults.find(item => {
    const itemId = String(item?.id || '')
    return String(item?.taskRefId || '') === taskId || itemId === taskId || itemId.startsWith(`${taskId}-`)
  }) || null
}

function videoTaskHasViewableResult(task = {}) {
  const result = videoResultForTask(task)
  return Boolean(
    result
      && videoResultHasOutput(result)
      && ['downloaded', 'ready'].includes(videoResultStage(result).id),
  )
}

function videoTaskActionLabel(task = {}) {
  return videoTaskHasViewableResult(task) ? '查看视频' : '生成视频'
}

function setVideoResultElement(item = {}, element = null) {
  const id = String(item?.id || '').trim()
  if (!id) return
  if (element) videoResultElements.set(id, element)
  else videoResultElements.delete(id)
}

async function playVideoResult(item = {}) {
  const id = String(item?.id || '').trim()
  if (!id) return
  activeStep.value = 'results'
  videoResultToPlayId.value = id
  await nextTick()
  const element = videoResultElements.get(id)
  if (!element) return
  try {
    await element.play()
  } catch {
    // The native controls remain available when autoplay is blocked by the runtime.
  }
}

async function handleVideoResultCanPlay(item = {}) {
  if (videoResultToPlayId.value !== String(item?.id || '').trim()) return
  const element = videoResultElements.get(videoResultToPlayId.value)
  if (!element) return
  try {
    await element.play()
  } catch {
    // The native controls remain available when autoplay is blocked by the runtime.
  }
}

async function handleVideoTaskAction(task = {}) {
  const result = videoResultForTask(task)
  if (result && videoTaskHasViewableResult(task)) {
    await playVideoResult(result)
    return
  }
  await runVideoTask(task, 'live')
}

function videoTaskDraftRequirement(id = '') {
  return videoTaskDraftRequirements.value.find(item => item.id === id) || null
}

function videoResultStage(item = {}) {
  const status = String(item.status || '').trim()
  const providerStatus = String(item.providerStatus || '').trim().toLowerCase()
  const normalized = status.toLowerCase()
  if (item.error || /失败|error|failed|cancelled|canceled|stopped|partial/.test(`${normalized} ${providerStatus}`)) {
    return { id: 'failed', label: '失败', message: '任务失败。请检查错误信息后返回生视频修改并重新预检。' }
  }
  if (localVideoPathFor(item)) {
    return { id: 'downloaded', label: '已下载', message: '视频已下载到本地，可直接预览或打开文件。' }
  }
  if (/待授权|预检完成/.test(status)) {
    return { id: 'authorization', label: '待授权', message: '预检已完成，返回生视频后明确授权才会创建外部视频任务。' }
  }
  if (/生成完成待下载|已完成/.test(status) || /succeeded|completed/.test(providerStatus)) {
    return { id: 'ready', label: '生成完成待下载', message: item.videoUrl ? '供应商已返回在线视频，可预览或下载归档。' : '供应商已完成生成，可下载视频到输出目录。' }
  }
  if (/生成中|运行中/.test(status) || /running|processing|in_progress/.test(providerStatus)) {
    const progress = Number(item.progress)
    const hasProgress = ['provider', 'workflow'].includes(String(item.progressSource || '')) && Number.isFinite(progress) && progress >= 0 && progress <= 100
    return { id: 'generating', label: '生成中', message: hasProgress ? `供应商正在生成，当前已回传 ${Math.round(progress)}% 进度。` : '供应商正在生成；尚未回传可用百分比，可稍后刷新状态。' }
  }
  if (/排队/.test(status) || /pending|queued|waiting/.test(providerStatus)) {
    return { id: 'queued', label: '排队中', message: '任务正在等待供应商处理，稍后刷新状态即可。' }
  }
  if (/已提交/.test(status) || item.providerTaskId || item.taskId) {
    return { id: 'submitted', label: '已提交', message: '任务已提交，供应商尚未返回排队或生成状态；可刷新状态。' }
  }
  return { id: 'pending', label: '待生成', message: '尚未创建外部视频任务，请返回生视频完成预检并点击“生成视频”。' }
}

function videoTaskStage(task = {}) {
  const result = videoResultForTask(task)
  if (result) return videoResultStage(result)
  return videoResultStage({
    status: task.status,
    providerStatus: task.providerStatus,
    providerTaskId: task.providerTaskId,
    taskId: task.runId,
    error: task.error,
  })
}

function videoResultHasLiveProgress(item = {}) {
  const progress = Number(item.progress)
  return videoResultStage(item).id === 'generating'
    && ['provider', 'workflow'].includes(String(item.progressSource || ''))
    && Number.isFinite(progress)
    && progress >= 0
    && progress <= 100
}

function videoResultIsLoading(item = {}) {
  return ['submitted', 'queued', 'generating'].includes(videoResultStage(item).id)
}

function extractLiveVideoProgress(payload = {}) {
  const raw = [payload?.progress, payload?.percentage, payload?.percent]
    .map(value => Number(value))
    .find(value => Number.isFinite(value) && value >= 0)
  if (!Number.isFinite(raw)) return null
  const normalized = raw <= 1 ? raw * 100 : raw
  return normalized <= 100 ? Math.round(normalized) : null
}

function workflowRunProgress(snapshot = {}) {
  const total = Number(snapshot?.total_rows || snapshot?.total || 0)
  const current = Number(snapshot?.current_row_no || snapshot?.current || 0)
  if (total > 0 && current >= 0) return Math.round((Math.min(current, total) / total) * 100)
  return extractLiveVideoProgress(snapshot)
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
  if (!isApiVideoProvider(provider) || !providerTaskId) {
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
    task.providerStatus = String(result.status || '')
    task.status = providerTaskDisplayStatus(provider, result.status, localPath)
  }
  const displayStatus = providerTaskDisplayStatus(provider, result.status, localPath)
  const liveProgress = displayStatus === '生成中' ? extractLiveVideoProgress(result) : null
  const next = {
    ...item,
    id: item?.id || task?.id || `video-result-${providerTaskId}`,
    taskRefId: item?.taskRefId || task?.id || '',
    styleCode: item?.styleCode || task?.styleCode || '',
    template: item?.template || videoTaskResultTemplateLabel(task),
    provider: providerLabel(provider),
    providerKey: provider,
    providerTaskId: String(result.task_id || providerTaskId),
    taskId: String(result.task_id || providerTaskId),
    providerStatus: String(result.status || ''),
    status: displayStatus,
    progress: liveProgress ?? 0,
    progressSource: liveProgress === null ? '' : 'provider',
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
  const liveProgress = normalized === 'running' ? workflowRunProgress(snapshot) : null
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
    progress: liveProgress ?? 0,
    progressSource: liveProgress === null ? '' : 'workflow',
    path: '',
    error: '',
  }])
}

function resetVideoResultPoll() {
  if (videoPollTimer) clearTimeout(videoPollTimer)
  videoPollTimer = null
}

function videoTaskNeedsResultPoll(task = {}) {
  if (!String(task?.providerTaskId || task?.runId || '').trim()) return false
  if (task.provider === 'qn') return !['已完成', '失败'].includes(String(task.status || '').trim())
  const providerStatus = String(task?.providerStatus || '').trim().toLowerCase()
  return !['succeeded', 'failed', 'error', 'canceled', 'cancelled', 'unknown'].includes(providerStatus)
}

function scheduleVideoResultPoll() {
  resetVideoResultPoll()
  if (!videoTasks.some(videoTaskNeedsResultPoll)) return
  videoPollTimer = setTimeout(async () => {
    videoPollTimer = null
    try {
      await refreshVideoResults({ silent: true })
    } finally {
      scheduleVideoResultPoll()
    }
  }, 5000)
}

async function refreshVideoResults({ silent = false } = {}) {
  if (!silent) activeStep.value = 'results'
  const refreshable = videoTasks.filter(task => String(task.providerTaskId || task.runId || '').trim())
  if (!refreshable.length) {
    if (!silent) {
      videoStageState.status = 'failed'
      videoStageState.error = '当前没有可刷新的视频任务 ID'
      videoStageState.message = videoStageState.error
    }
    return
  }
  if (!silent) {
    videoStageState.status = 'running'
    videoStageState.error = ''
    videoStageState.message = `正在刷新 ${refreshable.length} 条视频任务...`
  }
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
  if (!silent) {
    videoStageState.status = errors.length ? 'partial' : 'done'
    videoStageState.error = errors.join('；')
    videoStageState.message = errors.length
      ? `状态刷新完成，${errors.length} 条失败：${errors.join('；')}`
      : `已刷新 ${refreshable.length} 条视频任务。`
  }
}

async function downloadCompletedVideoResults() {
  activeStep.value = 'results'
  const providerResults = videoResults.filter(item => isApiVideoProvider(String(item.providerKey || videoTaskForResult(item)?.provider || '')))
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

function videoTaskVideoPaths(task) {
  return [task?.pixverseVideoPath, ...(task?.videoPaths || [])]
    .map(item => String(item || '').trim())
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
  const trackedTaskIds = new Set(videoTasks.map(task => String(task?.id || '').trim()).filter(Boolean))
  const trackedResults = (results || []).filter(item => {
    const taskRefId = String(item?.taskRefId || item?.id || '').trim()
    return !taskRefId || trackedTaskIds.has(taskRefId)
  })
  if (!trackedResults.length) return
  videoResults.splice(0, videoResults.length, ...mergeBalaVideoResults(videoResults, trackedResults))
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
      status: mode === 'live' ? '生成完成待下载' : '待授权',
      progress: 0,
      progressSource: '',
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
  const gen = videoTaskGenerationParams(task)
  const provider = String(task?.provider || '').trim()
  const usesLocalImages = providerUsesLocalImages(provider, task?.happyhorseMode)
  const imagePaths = isPixVerseVideoProvider(provider) && (gen.imageUrl || task.pixverseImageUrl)
    ? []
    : (usesLocalImages ? videoTaskImagePaths(task) : [])
  const payload = {
    provider,
    style_code: task.styleCode,
    mode: task.happyhorseMode || 'i2v',
    prompt: String(task.prompt || '').trim(),
    image_paths: imagePaths,
    video_paths: videoTaskVideoPaths(task),
    output_dir: task.outputDir || videoOutputDir.value,
    resolution: gen.resolution || (provider === 'seedance' ? '720p' : '720P'),
    duration: gen.duration || 5,
    generate_audio: isKlingVideoProvider(provider) ? gen.audio !== false : gen.generateAudio !== false,
    kling_mode: gen.mode || task.klingMode || 'std',
    pixverse_image_path: gen.imagePath || task.pixverseImagePath || '',
    pixverse_image_url: gen.imageUrl || task.pixverseImageUrl || '',
    pixverse_video_path: gen.videoPath || task.pixverseVideoPath || '',
    pixverse_video_url: gen.videoUrl || task.pixverseVideoUrl || '',
    watermark: Boolean(gen.watermark),
  }
  // HappyHorse 图生不允许 ratio；PixVerse 不接受 ratio/duration 类 Kling 参数。
  if (!(provider === 'happyhorse' && task.happyhorseMode === 'i2v') && !isPixVerseVideoProvider(provider)) {
    payload.ratio = gen.aspect_ratio || gen.ratio || '9:16'
  }
  const result = await window.cs.preflightBalaVideoProvider(payload)
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
  const gen = videoTaskGenerationParams(task)
  const payload = {
    style_code: task.styleCode,
    prompt,
    image_paths: videoTaskImagePaths(task).slice(0, 4),
    output_dir: task.outputDir || videoOutputDir.value,
    ratio: gen.ratio || '9:16',
    resolution: gen.resolution || '720p',
    duration: gen.duration || 5,
    generate_audio: gen.generateAudio !== false,
    watermark: Boolean(gen.watermark),
    wait: false,
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
  const displayStatus = providerTaskDisplayStatus(task.provider, result?.status, result?.local_video_path)
  const liveProgress = displayStatus === '生成中' ? extractLiveVideoProgress(result) : null
  task.status = displayStatus
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
    status: displayStatus,
    progress: liveProgress ?? 0,
    progressSource: liveProgress === null ? '' : 'provider',
    path: result?.local_video_path || '',
    videoUrl: result?.video_url || '',
    error: '',
  }])
  activeStep.value = 'results'
}

async function runHappyHorseVideoTask(task, mode = 'plan') {
  const provider = String(task?.provider || 'happyhorse').trim()
  const templateLabel = videoTaskResultTemplateLabel(task)
  if (mode !== 'live') {
    await preflightVideoProviderTask(task)
    task.status = '预检完成，等待授权生成'
    upsertVideoResults([{
      id: task.id,
      taskRefId: task.id,
      styleCode: task.styleCode,
      template: templateLabel,
      provider: providerLabel(provider),
      providerKey: provider,
      providerTaskId: task.providerTaskId || '',
      taskId: '预检草稿',
      status: '待授权',
      progress: 0,
      path: task.outputDir || videoOutputDir.value,
    }])
    return
  }
  const prompt = String(task.prompt || '').trim()
  if (!prompt && !isPixVerseVideoProvider(provider)) throw new Error(`${providerLabel(provider)} 任务需要填写 Prompt`)
  const gen = videoTaskGenerationParams(task)
  const imagePaths = isPixVerseVideoProvider(provider) && (gen.imageUrl || task.pixverseImageUrl)
    ? []
    : (providerUsesLocalImages(provider, task.happyhorseMode) ? videoTaskImagePaths(task) : [])
  const payload = {
    provider,
    style_code: task.styleCode,
    mode: task.happyhorseMode || 'i2v',
    prompt,
    image_paths: imagePaths,
    video_paths: videoTaskVideoPaths(task),
    output_dir: task.outputDir || videoOutputDir.value,
    resolution: gen.resolution || '720P',
    duration: gen.duration || 5,
    generate_audio: isKlingVideoProvider(provider) ? gen.audio !== false : false,
    kling_mode: gen.mode || task.klingMode || 'std',
    pixverse_image_path: gen.imagePath || task.pixverseImagePath || '',
    pixverse_image_url: gen.imageUrl || task.pixverseImageUrl || '',
    pixverse_video_path: gen.videoPath || task.pixverseVideoPath || '',
    pixverse_video_url: gen.videoUrl || task.pixverseVideoUrl || '',
    watermark: Boolean(gen.watermark),
    wait: false,
  }
  if (!isPixVerseVideoProvider(provider) && !(provider === 'happyhorse' && task.happyhorseMode === 'i2v')) {
    payload.ratio = gen.aspect_ratio || gen.ratio || '9:16'
  }
  const result = await window.cs.runBalaHappyHorseVideo(payload)
  if (!result?.ok) throw new Error(result?.error || `${providerLabel(provider)} 视频任务未能启动`)
  task.providerTaskId = String(result?.task_id || task.providerTaskId || '')
  const displayStatus = providerTaskDisplayStatus(provider, result?.status, result?.local_video_path)
  const liveProgress = displayStatus === '生成中' ? extractLiveVideoProgress(result) : null
  task.status = displayStatus
  upsertVideoResults([{
    id: task.id,
    taskRefId: task.id,
    styleCode: task.styleCode,
    template: templateLabel,
    provider: providerLabel(provider),
    providerKey: provider,
    providerTaskId: task.providerTaskId,
    taskId: result?.task_id || '',
    providerStatus: result?.status || '',
    status: displayStatus,
    progress: liveProgress ?? 0,
    progressSource: liveProgress === null ? '' : 'provider',
    path: result?.local_video_path || '',
    videoUrl: result?.video_url || '',
    error: '',
  }])
  activeStep.value = 'results'
}

async function runVideoTaskInternal(task, mode = 'plan') {
  const provider = String(task?.provider || '').trim()
  const pixverseUsesImageUrl = isPixVerseVideoProvider(provider) && /^https?:\/\//i.test(String(task?.pixverseImageUrl || '').trim())
  const requiresLocalImages = provider === 'qn'
    || provider === 'seedance'
    || (provider === 'happyhorse' && task?.happyhorseMode !== 't2v')
    || (isPixVerseVideoProvider(provider) && !pixverseUsesImageUrl)
  if (requiresLocalImages && !task?.assets?.length) {
    videoStageState.status = 'failed'
    videoStageState.error = '视频任务缺少素材图片'
    videoStageState.message = videoStageState.error
    return
  }
  if (requiresLocalImages && !videoTaskImagePaths(task).length) {
    videoStageState.status = 'failed'
    videoStageState.error = '视频任务缺少可用的本地图片文件'
    videoStageState.message = videoStageState.error
    return
  }
  if (isPixVerseVideoProvider(provider) && !videoTaskVideoPaths(task).length && !/^https?:\/\//i.test(String(task?.pixverseVideoUrl || '').trim())) {
    videoStageState.status = 'failed'
    videoStageState.error = 'PixVerse 任务缺少本地动作视频或动作视频 URL'
    videoStageState.message = videoStageState.error
    return
  }
  videoStageState.status = 'running'
  videoStageState.error = ''
  videoStageState.progress = 0
  videoStageState.message = `${task.styleCode} 正在${mode === 'live' ? '提交视频生成任务' : '预检视频任务'}...`
  task.status = mode === 'live' ? '生成中' : '预检中'
  try {
    if (task.provider === 'seedance') {
      await runSeedanceVideoTask(task, mode)
    } else if (isBailianVideoProvider(task.provider)) {
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
      const launchStatus = normalizeWorkflowStageStatus(launch.status)
      if (mode === 'live' && !['done', 'failed', 'stopped', 'partial'].includes(launchStatus)) {
        const liveProgress = launchStatus === 'running' ? workflowRunProgress(launch.snapshot) : null
        task.status = liveProgress !== null ? '生成中' : '已提交'
        upsertVideoResults([{
          id: task.id,
          taskRefId: task.id,
          styleCode: task.styleCode,
          template: task.template?.title || '不选模板',
          provider: providerLabel(task.provider),
          providerKey: task.provider,
          providerTaskId: runId,
          taskId: runId,
          providerStatus: launchStatus,
          status: task.status,
          progress: liveProgress ?? 0,
          progressSource: liveProgress === null ? '' : 'workflow',
          path: '',
          error: '',
        }])
        activeStep.value = 'results'
      } else {
        await waitForQnVideoTask(task, runId, mode)
        task.status = mode === 'live' ? '已提交 / 查看结果' : '预检完成，等待授权生成'
      }
    }
    if (mode === 'live') scheduleVideoResultPoll()
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

async function runVideoTask(task, mode = 'plan') {
  if (!isVideoTaskSubmittable(task)) {
    const stage = videoTaskStage(task)
    videoStageState.status = 'done'
    videoStageState.error = ''
    videoStageState.message = ['ready', 'downloaded'].includes(stage.id)
      ? `${task.styleCode} 视频已${stage.label}，不能重复提交；如需新版本请复制任务后生成。`
      : `${task.styleCode} 这条视频任务已提交，请到结果页刷新或复制新建后再次生成。`
    activeStep.value = 'results'
    return
  }
  const taskId = String(task?.id || '').trim()
  if (!taskId || videoTaskBusyIds.has(taskId)) return
  videoTaskBusyIds.add(taskId)
  try {
    await runVideoTaskInternal(task, mode)
  } finally {
    videoTaskBusyIds.delete(taskId)
  }
}

async function runSelectedVideoTasks(mode = 'plan') {
  const tasks = selectedVisibleVideoTasks.value.slice()
  if (!tasks.length) {
    videoStageState.status = 'idle'
    videoStageState.error = '请先勾选当前状态筛选中的视频任务。'
    videoStageState.message = videoStageState.error
    return
  }
  videoStageState.error = ''
  videoStageState.status = 'running'
  videoStageState.message = `正在${mode === 'live' ? '提交' : '预检'}已勾选的 ${tasks.length} 条视频任务。`
  for (const task of tasks) {
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
    meta: [styleCode, asset?.role || asset?.action, shortDisplayName(asset?.meta || '', 48)].filter(Boolean).join(' · '),
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
  previewAnnotationTool.value = ''
  previewAnnotationClearNonce.value += 1
  void loadAiImageSettings()
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
  if (!ensureAiImageModelSelected()) {
    previewEditError.value = '尚未配置可用生图模型，请先到设置页配置 1XM 图片模型'
    return
  }
  if (previewEditAction.value === 'face_swap' && !selectedModel.value) {
    previewEditError.value = 'AI 换脸需要先选择模特'
    return
  }
  if (previewEditAction.value === 'outfit_swap' && !garmentImagePaths.value.length) {
    previewEditError.value = 'AI 换装需要至少选择一张服装图'
    return
  }
  previewEditBusy.value = true
  previewEditError.value = ''
  try {
    const generation = resolveSelectedAiImageGenerationParams()
    const annotationDataUrl = previewAnnotationTool.value
      ? await requestPreviewAnnotationExport()
      : ''
    const created = await window.cs.createAiImageJob({
      title: `${previewImage.value?.styleCode || 'AI 视频'} · 大图修改`,
      prompt,
      model_key: generation.modelKey,
      status: 'draft',
      output_dir: workspaceDir.value,
      params: {
        workflow: BALA_AI_IMAGE_TASK_ID,
        surface: 'ai-video-workflow',
        workspace_dir: workspaceDir.value,
        size: generation.size,
        quality: generation.quality || 'high',
        response_format: generation.outputFormat,
        n: 1,
        model_key_tier: generation.modelKeyTier,
        main_image_path: mainPath,
        reference_image_paths: [],
      },
      summary: {
        workflow: BALA_AI_IMAGE_TASK_ID,
        surface: 'ai-video-workflow',
        workspace_dir: workspaceDir.value,
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
        workflow: BALA_AI_IMAGE_TASK_ID,
        surface: 'ai-video-workflow',
        workspace_dir: workspaceDir.value,
        size: generation.size,
        quality: generation.quality || 'high',
        response_format: generation.outputFormat,
        n: 1,
        model_key_tier: generation.modelKeyTier,
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
  if (provider === 'kling-v3') return '百炼 Kling v3'
  if (provider === 'kling-omni') return '百炼 Kling Omni'
  if (provider === 'pixverse-motioncontrol') return '百炼 PixVerse'
  return '生意管家'
}

function happyHorseModeLabel(mode) {
  if (mode === 't2v') return '文生视频'
  if (mode === 'r2v') return '参考生视频'
  return '图生视频'
}

function providerStatusLabel(provider) {
  const statusKey = isBailianVideoProvider(provider) ? 'happyhorse' : provider
  const status = videoProviderStatus[statusKey]
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
  if (!providerUsesLocalImages(videoTaskDraft.provider, videoTaskDraft.happyhorseMode)) {
    videoTaskDraft.assetIds = []
    syncHappyHorseModeFromAssetCount()
    return
  }
  // 默认勾选已审核图；HappyHorse 再按数量自动切模式（不强制清空）
  videoTaskDraft.assetIds = assets.filter(asset => asset.selectable).map(asset => asset.id)
  if (videoTaskDraft.provider === 'happyhorse' && videoTaskDraft.assetIds.length > 9) {
    videoTaskDraft.assetIds = videoTaskDraft.assetIds.slice(0, 9)
  }
  if (videoTaskDraft.provider === 'seedance' && videoTaskDraft.assetIds.length > 4) {
    videoTaskDraft.assetIds = videoTaskDraft.assetIds.slice(0, 4)
  }
  if (isKlingVideoProvider(videoTaskDraft.provider) && videoTaskDraft.assetIds.length > 2) {
    videoTaskDraft.assetIds = videoTaskDraft.assetIds.slice(0, 2)
  }
  if (isPixVerseVideoProvider(videoTaskDraft.provider) && videoTaskDraft.assetIds.length > 1) {
    videoTaskDraft.assetIds = videoTaskDraft.assetIds.slice(0, 1)
  }
  syncHappyHorseModeFromAssetCount()
}

function openVideoTaskDialog(styleCode = '', sourceTask = null, mode = 'new') {
  lastFocusedElement.value = document.activeElement
  videoTaskDraftError.value = ''
  videoTaskAssetFilter.value = 'approved'
  videoTaskKindFilter.value = 'all'
  resetVideoTaskAssetRenderLimit()
  // 用最新审核池/素材文件夹重算款号池，保证细节图·AI 图分类字段最新
  if (reviewStyles.length) buildVideoJobsFromReview()
  const task = sourceTask && typeof sourceTask === 'object' ? sourceTask : null
  editingVideoTaskId.value = mode === 'edit' && task?.id ? String(task.id) : ''
  videoTaskDraft.styleCode = task?.styleCode || styleCode || videoJobs[0]?.styleCode || ''
  videoTaskDraft.provider = task?.provider || 'qn'
  videoTaskDraft.happyhorseMode = task?.happyhorseMode || 'i2v'
  videoTaskDraft.prompt = task?.prompt || ''
  videoTaskDraft.outputDir = task?.outputDir || videoOutputDir.value
  videoTaskDraft.templateId = task?.template?.id || ''
  videoTaskDraft.pixverseImagePath = ''
  videoTaskDraft.pixverseImageUrl = ''
  videoTaskDraft.pixverseVideoPath = ''
  videoTaskDraft.pixverseVideoUrl = ''
  selectedTemplateId.value = videoTaskDraft.templateId
  if (task) {
    videoTaskDraft.assetIds = (task.assets || []).map(asset => asset?.id).filter(Boolean)
    const gen = videoTaskGenerationParams(task)
    videoTaskDraft.duration = Number(task.duration ?? gen.duration ?? 5)
    videoTaskDraft.resolution = String(task.resolution || gen.resolution || '')
    videoTaskDraft.ratio = String(task.ratio ?? gen.ratio ?? gen.aspect_ratio ?? '')
    videoTaskDraft.klingMode = String(task.klingMode || gen.mode || 'std')
    videoTaskDraft.pixverseImagePath = String(task.pixverseImagePath || gen.imagePath || '')
    videoTaskDraft.pixverseImageUrl = String(task.pixverseImageUrl || gen.imageUrl || '')
    videoTaskDraft.pixverseVideoPath = String(task.pixverseVideoPath || gen.videoPath || '')
    videoTaskDraft.pixverseVideoUrl = String(task.pixverseVideoUrl || gen.videoUrl || '')
    videoTaskDraft.generateAudio = videoTaskDraft.provider === 'seedance'
      || isKlingVideoProvider(videoTaskDraft.provider)
      ? task.generateAudio !== false && task.generateAudio !== 0
      : Boolean(task.generateAudio)
    videoTaskDraft.watermark = Boolean(task.watermark)
    if (videoTaskDraft.provider === 'seedance' || isBailianVideoProvider(videoTaskDraft.provider)) {
      if (!videoTaskDraft.resolution) applyVideoTaskProviderDefaults(videoTaskDraft.provider)
    }
    // 编辑/复制时也按当前勾选图数量重算 HH 模式
    syncHappyHorseModeFromAssetCount()
  } else {
    applyVideoTaskProviderDefaults(videoTaskDraft.provider)
    resetVideoTaskDraftAssets()
  }
  videoTaskDialogOpen.value = true
  nextTick(() => {
    scheduleVideoTaskThumbs(displayedVideoTaskAssets.value)
    observeVideoTaskThumbs()
  })
}

function handleVideoProviderChange() {
  videoTaskDraftError.value = ''
  videoTaskDraft.templateId = ''
  applyVideoTaskProviderDefaults(videoTaskDraft.provider)
  resetVideoTaskDraftAssets()
}

function selectVideoTaskProvider(provider) {
  const next = String(provider || '').trim()
  if (!next || next === videoTaskDraft.provider) return
  videoTaskDraft.provider = next
  handleVideoProviderChange()
}

function selectVideoTaskStyle(styleCode) {
  videoTaskDraftError.value = ''
  videoTaskDraft.styleCode = String(styleCode || '').trim()
  resetVideoTaskAssetRenderLimit()
  resetVideoTaskDraftAssets()
  syncHappyHorseModeFromAssetCount()
}

function cyclingTabIndex(currentIndex, total, direction) {
  if (!total) return -1
  if (direction === 'first') return 0
  if (direction === 'last') return total - 1
  const offset = direction === 'previous' ? -1 : 1
  return (currentIndex + offset + total) % total
}

function focusVideoTaskTab(id) {
  void nextTick(() => {
    document.getElementById(id)?.focus()
  })
}

function moveVideoTaskStyleTab(direction) {
  const styles = videoJobs.map(job => job.styleCode)
  const currentIndex = Math.max(0, styles.indexOf(videoTaskDraft.styleCode))
  const nextStyleCode = styles[cyclingTabIndex(currentIndex, styles.length, direction)]
  if (!nextStyleCode) return
  selectVideoTaskStyle(nextStyleCode)
  focusVideoTaskTab(`video-task-style-${nextStyleCode}`)
}

function selectVideoTaskAssetTab(filter) {
  if (!videoTaskAssetTabs.value.some(tab => tab.id === filter)) return
  videoTaskAssetFilter.value = filter
  resetVideoTaskAssetRenderLimit()
}

function moveVideoTaskAssetTab(direction) {
  const tabs = videoTaskAssetTabs.value
  const currentIndex = Math.max(0, tabs.findIndex(tab => tab.id === videoTaskAssetFilter.value))
  const nextTab = tabs[cyclingTabIndex(currentIndex, tabs.length, direction)]
  if (!nextTab) return
  selectVideoTaskAssetTab(nextTab.id)
  focusVideoTaskTab(`video-task-asset-tab-${nextTab.id}`)
}

function toggleVideoTaskDraftAsset(asset) {
  if (!asset?.selectable) return
  videoTaskDraftError.value = ''
  if (!providerUsesLocalImages(videoTaskDraft.provider, videoTaskDraft.happyhorseMode)) {
    videoTaskDraftError.value = `${providerLabel(videoTaskDraft.provider)} 当前不使用本地图片素材`
    return
  }
  const assetId = asset.id
  const index = videoTaskDraft.assetIds.indexOf(assetId)
  if (index >= 0) {
    videoTaskDraft.assetIds.splice(index, 1)
    syncHappyHorseModeFromAssetCount()
    return
  }
  // Seedance 最多 4 张；HappyHorse 最多 9 张；Kling/PixVerse 按模型角色限制
  if (videoTaskDraft.provider === 'happyhorse' && videoTaskDraft.assetIds.length >= 9) {
    videoTaskDraftError.value = 'HappyHorse 最多选择 9 张图片'
    return
  }
  if (videoTaskDraft.provider === 'seedance' && videoTaskDraft.assetIds.length >= 4) {
    videoTaskDraftError.value = 'Seedance 最多选择 4 张参考图'
    return
  }
  if (isKlingVideoProvider(videoTaskDraft.provider) && videoTaskDraft.assetIds.length >= 2) {
    videoTaskDraftError.value = 'Kling 最多选择 2 张图片（首帧 / 尾帧）'
    return
  }
  if (isPixVerseVideoProvider(videoTaskDraft.provider) && videoTaskDraft.assetIds.length >= 1) {
    videoTaskDraftError.value = 'PixVerse 只能选择 1 张角色图'
    return
  }
  videoTaskDraft.assetIds.push(assetId)
  syncHappyHorseModeFromAssetCount()
}

function createVideoTaskFromDraft() {
  const incomplete = videoTaskDraftRequirements.value.find(requirement => !requirement.complete)
  if (incomplete) {
    videoTaskDraftError.value = incomplete.message || `请完善${incomplete.label}`
    videoStageState.status = 'failed'
    videoStageState.error = videoTaskDraftError.value
    videoStageState.message = videoStageState.error
    return
  }
  const assets = selectedVideoTaskDraftAssets.value
  const template = videoTaskDraft.provider === 'qn'
    ? templateSamples.find(item => item.id === videoTaskDraft.templateId) || null
    : null
  const providerName = providerLabel(videoTaskDraft.provider)
  const currentTask = videoTasks.find(task => task.id === editingVideoTaskId.value)
  const taskIndex = videoTasks.length + 1
  const gen = videoTaskGenerationParams(videoTaskDraft)
  const nextTask = {
    styleCode: videoTaskDraft.styleCode,
    provider: videoTaskDraft.provider,
    happyhorseMode: videoTaskDraft.happyhorseMode,
    prompt: videoTaskDraft.prompt.trim(),
    outputDir: videoTaskDraft.outputDir.trim(),
    template,
    status: '待预检',
    providerTaskId: '',
    runId: '',
    assets: assets.map(asset => ({ ...asset })),
    duration: gen.duration ?? videoTaskDraft.duration,
    resolution: gen.resolution || videoTaskDraft.resolution,
    ratio: gen.ratio ?? gen.aspect_ratio ?? videoTaskDraft.ratio,
    klingMode: gen.mode || videoTaskDraft.klingMode,
    pixverseImagePath: gen.imagePath || videoTaskDraft.pixverseImagePath,
    pixverseImageUrl: gen.imageUrl || videoTaskDraft.pixverseImageUrl,
    pixverseVideoPath: gen.videoPath || videoTaskDraft.pixverseVideoPath,
    pixverseVideoUrl: gen.videoUrl || videoTaskDraft.pixverseVideoUrl,
    generateAudio: isKlingVideoProvider(videoTaskDraft.provider)
      ? gen.audio !== false
      : gen.generateAudio !== false,
    watermark: Boolean(gen.watermark),
  }
  if (currentTask) {
    Object.assign(currentTask, nextTask)
  } else {
    videoTasks.unshift({
      id: `video-task-${Date.now()}`,
      title: `${providerName} 视频任务 ${String(taskIndex).padStart(2, '0')}`,
      ...nextTask,
    })
  }
  videoTaskDraftError.value = ''
  videoStageState.status = 'done'
  videoStageState.error = ''
  videoStageState.message = currentTask ? `${nextTask.styleCode} 视频任务已更新，需重新预检。` : `${nextTask.styleCode} 视频任务已创建，下一步可提交预检。`
  editingVideoTaskId.value = ''
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
  const localTarget = localVideoPathFor(item)
  const remoteTarget = [item?.videoUrl, item?.video_url, item?.url, item?.download_url]
    .map(value => String(value || '').trim())
    .find(value => /^https?:\/\//i.test(value)) || ''
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
  const localTarget = localVideoPathFor(item)
  const remoteTarget = [item?.videoUrl, item?.video_url, item?.url, item?.download_url]
    .map(value => String(value || '').trim())
    .find(value => /^https?:\/\//i.test(value)) || ''
  return Boolean(localTarget || remoteTarget)
}

function isClearableVideoResult(item = {}) {
  return ['failed', 'ready', 'downloaded'].includes(videoResultStage(item).id)
}

function videoResultLocalPath(item = {}) {
  return String(localVideoPathFor(item) || '').trim()
}

function requestClearVideoResult(item = {}) {
  if (!isClearableVideoResult(item)) return
  if (videoResultStage(item).id === 'failed') {
    void clearVideoHistoryRecords([item])
    return
  }
  openVideoHistoryCleanup([item])
}

function requestClearVideoHistory() {
  const items = clearableVideoResults.value
  if (!items.length) return
  const successful = items.filter(item => videoResultStage(item).id !== 'failed')
  if (!successful.length) {
    void clearVideoHistoryRecords(items)
    return
  }
  openVideoHistoryCleanup(items)
}

function openVideoHistoryCleanup(items = []) {
  const localPaths = [...new Set(items.map(videoResultLocalPath).filter(Boolean))]
  pendingVideoHistoryCleanup.value = { items: [...items], localPaths }
  videoHistoryCleanupBusy.value = false
  videoHistoryCleanupError.value = ''
}

function closeVideoHistoryCleanup() {
  if (videoHistoryCleanupBusy.value) return
  pendingVideoHistoryCleanup.value = null
  videoHistoryCleanupError.value = ''
}

function removeClearedVideoTasks(taskRefIds = []) {
  const removedTaskIds = new Set((taskRefIds || []).map(item => String(item || '').trim()).filter(Boolean))
  for (let index = videoTasks.length - 1; index >= 0; index -= 1) {
    const task = videoTasks[index]
    if (!removedTaskIds.has(String(task?.id || '').trim())) continue
    videoTasks.splice(index, 1)
  }
}

async function clearVideoHistoryRecords(items = []) {
  const cleared = clearBalaVideoTaskHistory(videoResults, items)
  if (!cleared.taskRefIds.length) return
  const removed = videoResults.filter(item => !cleared.results.includes(item))
  videoResults.splice(0, videoResults.length, ...cleared.results)
  removeClearedVideoTasks(cleared.taskRefIds)
  resetVideoResultPoll()
  for (const item of removed) {
    delete videoResultElements[String(item.id || '')]
    if (videoResultToPlayId.value === item.id) videoResultToPlayId.value = ''
  }
  await flushWorkspaceManifest()
  videoStageState.status = 'done'
  videoStageState.error = ''
  videoStageState.message = `已清除 ${removed.length} 条视频历史记录。`
}

async function confirmVideoHistoryCleanup(deleteFiles = false) {
  const target = pendingVideoHistoryCleanup.value
  if (!target || videoHistoryCleanupBusy.value) return
  const localPaths = deleteFiles ? target.localPaths : []
  videoHistoryCleanupBusy.value = true
  videoHistoryCleanupError.value = ''
  try {
    if (localPaths.length) {
      const result = await window.cs.deleteFiles(localPaths)
      if (!result?.ok || Number(result.failed_count || 0) > 0) {
        throw new Error(result?.error || '本地视频删除失败，历史记录未清除')
      }
    }
    await clearVideoHistoryRecords(target.items)
    pendingVideoHistoryCleanup.value = null
  } catch (error) {
    videoHistoryCleanupError.value = error?.message || String(error)
  } finally {
    videoHistoryCleanupBusy.value = false
  }
}

function canRefreshVideoResult(item) {
  const stage = videoResultStage(item).id
  if (!['submitted', 'queued', 'generating'].includes(stage)) return false
  const task = videoTaskForResult(item)
  const providerTaskId = String(task?.providerTaskId || task?.runId || item?.providerTaskId || '').trim()
  return Boolean(task && providerTaskId)
}

function canDownloadVideoResult(item) {
  const task = videoTaskForResult(item)
  if (videoResultStage(item).id !== 'ready' || !task) return false
  return Boolean(String(task.providerTaskId || task.runId || item.providerTaskId || '').trim())
}

async function refreshSingleVideoResult(item) {
  const task = videoTaskForResult(item)
  if (!task) return
  try {
    if (isApiVideoProvider(task.provider)) {
      await refreshProviderVideoResult(item)
    } else {
      await refreshQnVideoTask(task)
    }
    videoStageState.status = 'done'
    videoStageState.error = ''
    videoStageState.message = `${task.styleCode} 视频任务状态已刷新。`
  } catch (error) {
    videoStageState.status = 'failed'
    videoStageState.error = error?.message || String(error)
    videoStageState.message = videoStageState.error
  }
}

async function downloadVideoResult(item) {
  const task = videoTaskForResult(item)
  if (!task) return
  try {
    if (isApiVideoProvider(task.provider)) {
      await refreshProviderVideoResult(item, { download: true })
    } else {
      await refreshQnVideoTask(task)
    }
    videoStageState.status = 'done'
    videoStageState.error = ''
    videoStageState.message = `${task.styleCode} 已请求下载视频结果。`
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

function openLocalMaterialLibrary(kind = 'garment') {
  activeLocalReferenceKind.value = ['garment', 'outfit', 'variant'].includes(kind) ? kind : 'garment'
  localMaterialLibraryCategory.value = 'all'
  localMaterialLibraryStyleFilter.value = 'all'
  localMaterialLibraryStyleQuery.value = ''
  if (previewImage.value?.styleCode) {
    activeMaterialStyleCode.value = previewImage.value.styleCode
  }
  lastFocusedElement.value = document.activeElement
  localMaterialLibraryOpen.value = true
}

/**
 * 文件夹来源：模特图 / 细节图（互斥）。
 * AI 是叠加属性（videoTaskAssetIsAi），不占用这一维。
 */
function videoTaskAssetSourceType(asset = {}) {
  const explicit = String(asset.sourceType || '').toLowerCase()
  if (explicit === 'detail' || explicit === 'reference') return 'detail'
  if (explicit === 'model' || explicit === 'origin') return 'model'

  const path = String(asset.path || asset.previewPath || asset.sourcePath || '').replace(/\\/g, '/')
  if (/02[_-]?商品细节|商品细节图|细节图|\/detail(?:s)?\//i.test(path)) return 'detail'
  if (/01[_-]?模拍|模拍原图|\/model(?:s)?\//i.test(path)) return 'model'

  const kind = String(asset.kind || '').toLowerCase()
  if (kind === 'reference' || kind === '素材' || kind === '细节图') return 'detail'
  if (kind === 'origin' || kind === '模拍' || kind === '模特图' || kind === '原图') return 'model'
  // AI 结果优先看 sourcePath 所属文件夹，默认归模拍
  if (kind === 'ai') {
    const sourcePath = String(asset.sourcePath || '').replace(/\\/g, '/')
    if (/02[_-]?商品细节|商品细节图|细节图/i.test(sourcePath)) return 'detail'
    return 'model'
  }
  return 'model'
}

/** AI 叠加属性：任意 AI 生成图（可同时是模特图或细节图） */
function videoTaskAssetIsAi(asset = {}) {
  if (asset?.isAi === true || asset?.is_ai === true) return true
  const kind = String(asset.kind || '').toLowerCase()
  if (kind === 'origin' || kind === '原图' || kind === '模拍') return false
  if (kind === 'ai') return true
  if (asset.jobUid || asset.job_uid || asset.runUid || asset.run_uid) return true
  const op = String(asset.operationType || asset.action || '').trim()
  if (op && !['origin', '原图', ''].includes(op.toLowerCase())) return true
  const label = String(asset.label || asset.displayKind || '')
  return /ai\s*结果|换脸|换背景|换装|换姿势|ai图|ai·/i.test(label)
}

/** @deprecated use sourceType / isAi; kept for any residual callers */
function videoTaskAssetKind(asset = {}) {
  if (videoTaskAssetIsAi(asset) && videoTaskKindFilter.value === 'ai') return 'ai'
  return videoTaskAssetSourceType(asset)
}

function videoTaskAssetKindLabel(asset = {}) {
  const source = videoTaskAssetSourceType(asset)
  const base = source === 'detail' ? '细节图' : '模特图'
  return videoTaskAssetIsAi(asset) ? `AI·${source === 'detail' ? '细节' : '模拍'}` : base
}

function closePreview() {
  clearPreviewAnnotationRequest()
  previewImage.value = null
  previewEditError.value = ''
}

function closeModelLibrary() {
  modelLibraryOpen.value = false
}

function closeLocalMaterialLibrary() {
  localMaterialLibraryOpen.value = false
}

function closeTemplateLibrary() {
  templateLibraryOpen.value = false
}

function closeVideoTaskDialog() {
  videoTaskDialogOpen.value = false
  editingVideoTaskId.value = ''
  videoTaskDraftError.value = ''
  disconnectVideoTaskThumbObserver()
  videoTaskThumbQueue = []
  videoTaskThumbActive = 0
}

function closeTopDialog() {
  if (pendingVersionDeletion.value) closeDeleteConfirmation()
  else if (previewImage.value) closePreview()
  else if (videoTaskDialogOpen.value) closeVideoTaskDialog()
  else if (reviewBulkConfirmation.value) cancelReviewBulkAction()
  else if (templateLibraryOpen.value) closeTemplateLibrary()
  else if (localMaterialLibraryOpen.value) closeLocalMaterialLibrary()
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

watch(
  () => [
    videoTaskDraft.styleCode,
    videoTaskDraft.provider,
    videoTaskDraft.happyhorseMode,
    videoTaskDraft.prompt,
    videoTaskDraft.outputDir,
    videoTaskDraft.assetIds.join('|'),
  ],
  () => {
    if (videoTaskDraftError.value) videoTaskDraftError.value = ''
  },
)

watch(styleWorkspaces, () => {
  persistAiImageWorkspaceState()
}, { deep: true })

watch([
  activeStep,
  materialTask,
  aiTaskState,
  reviewStyles,
  materialBatch,
  materialBoardUrl,
  reviewBatch,
  reviewBoardUrl,
  activeAction,
  aiPrompt,
  selectedModel,
  garmentImagePaths,
  outfitReferencePaths,
  variantReferencePaths,
  styleCodes,
  cloudPath,
  materialPackageName,
  activeMaterialStyleCode,
  activeMaterialSource,
  materialDisplayMode,
], () => {
  persistWorkspaceState()
}, { deep: true })

onMounted(() => {
  workspaceStateHydrated = true
  const restoredWorkspace = restoreWorkspaceSnapshot(workspaceDir.value)
  void (async () => {
    const restoredManifest = await restoreWorkspaceManifest(workspaceDir.value)
    if (!restoredWorkspace && workspaceDir.value) {
      await restoreLatestMaterialTask()
      const restoredBatchCount = await restoreReviewWorkspaceBatches({ silent: true })
      if (!restoredBatchCount) await restoreLatestReviewBatch({ silent: true })
    }
    if (restoredManifest && !restoredWorkspace) videoStageState.message = '已从当前工作区恢复视频任务和结果。'
    await syncWorkspaceFiles()
    persistWorkspaceState()
    scheduleVideoResultPoll()
  })()
  workspaceFileSyncTimer = setInterval(() => { void syncWorkspaceFiles() }, 4000)
  void loadAiImageSettings()
  void loadModelLibrary()
  void loadTemplateCatalog()
  void loadVideoProviderStatus()
})

// 筛选/款号切换后重绑缩略图观察
watch([displayedVideoTaskAssets, () => videoTaskDialogOpen.value], async ([, open]) => {
  if (!open) {
    disconnectVideoTaskThumbObserver()
    return
  }
  await nextTick()
  scheduleVideoTaskThumbs(displayedVideoTaskAssets.value)
  observeVideoTaskThumbs()
})

onBeforeUnmount(() => {
  resetMaterialPoll()
  resetAiPoll()
  aiReviewPollToken += 1
  resetVideoResultPoll()
  if (workspaceFileSyncTimer) clearInterval(workspaceFileSyncTimer)
  workspaceFileSyncTimer = null
  if (workspaceManifestWriteTimer) clearTimeout(workspaceManifestWriteTimer)
  clearPreviewAnnotationRequest()
  disconnectVideoTaskThumbObserver()
  for (const timer of reviewFeedbackTimers.values()) clearTimeout(timer)
  reviewFeedbackTimers.clear()
  void flushWorkspaceManifest()
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
  position: relative;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.aiv-workspace-persistence-error {
  position: absolute;
  z-index: 2;
  right: 22px;
  bottom: 8px;
  max-width: min(640px, calc(100% - 44px));
  margin: 0;
  padding: 5px 8px;
  border: 1px solid rgba(248, 113, 113, .36);
  border-radius: 6px;
  color: #fecaca;
  background: rgba(127, 29, 29, .26);
  font-size: 12px;
  line-height: 1.45;
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
  color: var(--on-orange);
  font-weight: 700;
}

.aiv-primary:disabled,
.aiv-ghost:disabled,
.aiv-action-option:disabled {
  opacity: .55;
  cursor: not-allowed;
}

.aiv-workbench button:focus-visible,
.aiv-workbench [role="button"]:focus-visible,
.aiv-workbench input:focus-visible,
.aiv-workbench select:focus-visible,
.aiv-workbench textarea:focus-visible,
.aiv-workbench summary:focus-visible {
  outline: 2px solid var(--orange);
  outline-offset: 2px;
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

.aiv-material-workspace-callout {
  display: grid;
  gap: 7px;
  padding: 10px;
  border: 1px solid rgba(251, 146, 60, .62);
  border-radius: 10px;
  background: rgba(154, 52, 18, .2);
}

.aiv-material-workspace-callout strong {
  color: #fed7aa;
  font-size: 12px;
}

.aiv-material-workspace-callout span {
  color: var(--text2);
  font-size: 11px;
  line-height: 1.5;
}

.aiv-material-workspace-callout .aiv-primary {
  justify-self: start;
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
  gap: 6px;
  padding: 8px 22px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
}

.aiv-step {
  min-width: 0;
  height: 46px;
  padding: 6px 9px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, .10);
  background: rgba(255, 255, 255, .025);
  color: var(--text2);
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  text-align: left;
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .025);
  transition: border-color .16s ease, background-color .16s ease, color .16s ease, box-shadow .16s ease, transform .16s ease;
}

.aiv-step:hover:not(.active),
.aiv-step:focus-visible:not(.active) {
  border-color: rgba(255, 107, 43, .38);
  color: var(--text);
  background: rgba(255, 107, 43, .06);
  box-shadow: 0 5px 14px rgba(0, 0, 0, .14);
  outline: none;
  transform: translateY(-1px);
}

.aiv-step.active {
  border-color: var(--orange);
  background: linear-gradient(90deg, rgba(255, 107, 43, .16), rgba(255, 107, 43, .06));
  color: var(--text);
  box-shadow: inset 0 0 0 1px rgba(255, 107, 43, .14), 0 5px 14px rgba(0, 0, 0, .16);
}

.aiv-step.done .aiv-step-index {
  color: var(--green);
}

.aiv-step-index {
  width: 24px;
  height: 24px;
  border-radius: 7px;
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
  margin-bottom: 1px;
  color: inherit;
  font-size: 12px;
  line-height: 1.15;
}

.aiv-step-copy small {
  color: var(--text3);
  font-size: 10px;
  line-height: 1.15;
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
  justify-content: flex-start;
  gap: 14px;
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

.aiv-material-task-state {
  width: fit-content;
  min-height: 22px;
  margin-top: 8px !important;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  display: inline-flex !important;
  align-items: center;
  gap: 6px;
  color: var(--text2) !important;
  background: var(--bg3);
  font-size: 10px !important;
  font-weight: 750;
  line-height: 1;
  letter-spacing: .01em;
}

.aiv-material-task-state i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 16%, transparent);
}

.aiv-material-task-state.is-idle { color: var(--text3) !important; }
.aiv-material-task-state.is-running { border-color: rgba(96, 165, 250, .48); color: #60a5fa; background: rgba(96, 165, 250, .10); }
.aiv-material-task-state.is-running i { animation: aiv-status-pulse 1.2s ease-in-out infinite; }
.aiv-material-task-state.is-ready { border-color: rgba(74, 222, 128, .42); color: var(--green) !important; background: rgba(74, 222, 128, .09); }
.aiv-material-task-state.is-failed { border-color: rgba(248, 113, 113, .5); color: #f87171 !important; background: rgba(248, 113, 113, .10); }

.aiv-params-panel.collapsed .aiv-collapse-action {
  order: -1;
  width: 40px;
  min-height: 40px;
  padding: 0;
  justify-content: center;
}

.aiv-params-panel.collapsed .aiv-collapse-action > span:first-child {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.aiv-material-results-panel {
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
}

.aiv-material-results-head {
  min-height: 66px;
}

.aiv-material-header-stats {
  min-width: 0;
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 0;
}

.aiv-material-stat {
  min-width: 72px;
  padding: 0 12px;
  border-left: 1px solid var(--border);
  display: grid;
  align-content: center;
  gap: 2px;
}

.aiv-material-stat strong {
  color: var(--text);
  font-size: 16px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.aiv-material-stat span,
.aiv-material-selection-summary {
  margin: 0;
  color: var(--text3);
  font-size: 10px;
  line-height: 1.35;
}

.aiv-material-stat.selected strong { color: var(--orange); }

.aiv-material-selection-summary {
  max-width: 250px;
  padding-left: 12px;
  color: var(--text2);
}

.aiv-material-results-head .aiv-material-stat span,
.aiv-material-results-head .aiv-material-selection-summary {
  margin-top: 0;
}

.aiv-material-results-head .aiv-material-stat span {
  white-space: nowrap;
}

.aiv-params-panel .aiv-panel-body,
.aiv-material-results-panel .aiv-style-list {
  min-height: 0;
  overflow-y: auto;
  align-content: start;
}

.aiv-material-results-panel .aiv-style-list {
  overscroll-behavior-y: contain;
  overflow-anchor: none;
  scrollbar-gutter: stable;
}

.aiv-material-sticky-actions {
  position: relative;
  z-index: 4;
  flex: 0 0 auto;
  background: var(--bg2);
  box-shadow: 0 -10px 24px rgba(0, 0, 0, 0.18);
}

/* 找图页保持运营台密度，但将表单、标签、媒体卡统一为同一套精致的表面语言。 */
.aiv-material-stage .aiv-panel {
  border-color: rgba(255, 255, 255, .10);
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(255, 255, 255, .022), transparent 76px), var(--bg2);
  box-shadow: 0 12px 28px rgba(0, 0, 0, .16);
}

.aiv-material-stage .aiv-panel-head {
  padding: 13px 14px;
  background: rgba(255, 255, 255, .012);
}

.aiv-material-stage .aiv-panel-body {
  gap: 11px;
}

.aiv-material-stage .aiv-field {
  gap: 5px;
}

.aiv-material-stage .aiv-field input,
.aiv-material-stage .aiv-field textarea {
  border-color: rgba(255, 255, 255, .11);
  border-radius: 9px;
  background: rgba(7, 8, 12, .42);
  transition: border-color .16s ease, background-color .16s ease, box-shadow .16s ease;
}

.aiv-material-stage .aiv-field input:hover,
.aiv-material-stage .aiv-field textarea:hover,
.aiv-material-stage .aiv-field input:focus,
.aiv-material-stage .aiv-field textarea:focus {
  border-color: rgba(255, 107, 43, .58);
  background: rgba(12, 12, 17, .78);
  box-shadow: 0 0 0 3px rgba(255, 107, 43, .08);
}

.aiv-material-stage .aiv-directory-picker,
.aiv-material-stage .aiv-progress-overview {
  border-color: rgba(255, 255, 255, .11);
  border-radius: 10px;
  background: rgba(7, 8, 12, .34);
}

.aiv-material-stage .aiv-material-style-tabs {
  padding: 10px 14px 11px;
  background: rgba(255, 255, 255, .012);
}

.aiv-material-stage .aiv-material-style-tabs button {
  min-height: 54px;
  padding: 9px 11px;
  border-color: rgba(255, 255, 255, .09);
  border-radius: 10px;
  background: rgba(255, 255, 255, .026);
  transition: border-color .16s ease, background-color .16s ease, box-shadow .16s ease, transform .16s ease;
}

.aiv-material-stage .aiv-material-style-tabs button:hover {
  border-color: rgba(255, 107, 43, .48);
  background: rgba(255, 107, 43, .065);
  transform: translateY(-1px);
}

.aiv-material-stage .aiv-material-source-switcher {
  min-height: 56px;
  background: linear-gradient(90deg, rgba(255, 107, 43, .035), transparent 35%), rgba(255, 255, 255, .018);
}

.aiv-material-stage .aiv-material-source-tabs {
  border-color: rgba(255, 255, 255, .11);
  border-radius: 9px;
  background: rgba(7, 8, 12, .46);
}

.aiv-material-stage .aiv-thumb {
  border-color: rgba(255, 255, 255, .11);
  border-radius: 10px;
  background: var(--bg3);
  transition: border-color .16s ease, box-shadow .16s ease, transform .16s ease;
}

.aiv-material-stage .aiv-thumb:hover,
.aiv-material-stage .aiv-thumb:focus-within {
  border-color: rgba(255, 107, 43, .48);
  transform: translateY(-2px);
}

.aiv-edit-workbench {
  grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
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
  grid-template-rows: auto auto;
  align-content: start;
}

.aiv-video-task-workbench > .aiv-panel:first-child {
  align-self: start;
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

.aiv-field-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

.aiv-field-heading .aiv-ghost {
  flex: 0 0 auto;
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

.aiv-directory-picker.compact {
  min-height: 32px;
  padding: 0 9px;
  justify-content: flex-start;
}

.aiv-local-media-summary {
  min-height: 32px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--text2);
  background: var(--bg);
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
}

.aiv-video-advanced-urls {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}

.aiv-video-advanced-urls summary {
  min-height: 34px;
  padding: 0 10px;
  color: var(--text2);
  cursor: pointer;
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 650;
}

.aiv-video-advanced-urls[open] {
  padding-bottom: 10px;
}

.aiv-video-advanced-urls[open] .aiv-video-gen-params-grid {
  padding: 0 10px;
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
  box-shadow: inset 0 -2px 0 var(--orange), 0 6px 16px rgba(255, 107, 43, .12);
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
  justify-content: flex-start;
  gap: 10px;
}

.aiv-material-source-switcher > span {
  margin-left: auto;
  color: var(--text3);
  font-size: 11px;
  white-space: nowrap;
}

.aiv-material-source-actions {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.aiv-material-source-tabs {
  padding: 3px;
  display: inline-grid;
  grid-template-columns: repeat(2, minmax(112px, auto));
  gap: 4px;
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

.aiv-review-style-card {
  gap: 8px;
  padding-bottom: 12px;
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

.aiv-params-panel:not(.collapsed) .aiv-collapse-action {
  min-height: 30px;
  padding: 4px 7px 4px 9px;
  border-radius: 7px;
  box-shadow: inset 0 0 0 1px rgba(255, 107, 43, .08);
  font-size: 11px;
  font-weight: 750;
}

.aiv-params-panel:not(.collapsed) .aiv-collapse-action:hover {
  border-color: rgba(255, 107, 43, .62);
  background: rgba(255, 107, 43, .14);
}

.aiv-collapse-chevron {
  width: 7px;
  height: 7px;
  display: inline-block;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transition: transform 0.16s ease;
}

.aiv-collapse-action.direction-left {
  border-color: rgba(255, 107, 43, 0.38);
  color: var(--orange);
  background: var(--orange-bg);
}

.aiv-collapse-head[aria-expanded="true"] .aiv-collapse-action {
  border-color: rgba(255, 107, 43, 0.38);
  color: var(--orange);
  background: var(--orange-bg);
}

.aiv-collapse-chevron[data-direction="left"] {
  transform: rotate(135deg);
}

.aiv-collapse-chevron[data-direction="right"] {
  transform: rotate(-45deg);
}

.aiv-style-head span,
.aiv-section-head span {
  display: block;
  margin-top: 3px;
  color: var(--text3);
  font-size: 11px;
}

.aiv-workspace-collapse {
  min-height: 30px;
  margin-top: 0 !important;
  padding: 0 6px 0 9px;
  border: 1px solid rgba(255, 255, 255, .12);
  border-radius: 7px;
  color: var(--text2) !important;
  background: rgba(255, 255, 255, .025);
  display: inline-flex !important;
  align-items: center;
  gap: 5px;
  font-size: 11px !important;
  font-weight: 750;
  line-height: 1;
  white-space: nowrap;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .035);
  transition: border-color .16s ease, color .16s ease, background-color .16s ease, box-shadow .16s ease, transform .14s ease;
}

.aiv-workspace-collapse > span {
  margin: 0 !important;
  color: inherit !important;
  font: inherit !important;
}

.aiv-workspace-collapse-icon {
  flex: 0 0 auto;
  color: currentColor;
  transition: transform .2s cubic-bezier(.16, 1, .3, 1);
}

.aiv-workspace-collapse.expanded {
  border-color: rgba(255, 107, 43, .46);
  color: var(--orange) !important;
  background: rgba(255, 107, 43, .095);
  box-shadow: inset 0 0 0 1px rgba(255, 107, 43, .08), 0 4px 10px rgba(0, 0, 0, .1);
}

.aiv-workspace-collapse.expanded .aiv-workspace-collapse-icon {
  transform: rotate(180deg);
}

.aiv-collapse-head:hover .aiv-workspace-collapse {
  border-color: rgba(255, 107, 43, .58);
  color: var(--text) !important;
  background: rgba(255, 107, 43, .11);
}

.aiv-collapse-head:hover .aiv-workspace-collapse.expanded {
  color: var(--orange) !important;
}

.aiv-collapse-head:active .aiv-workspace-collapse {
  transform: scale(.97);
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

.aiv-material-tab-panel .aiv-thumb-grid {
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}

.aiv-material-view-switcher {
  display: inline-flex;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg3);
}

.aiv-material-view-switcher button {
  min-height: 28px;
  padding: 4px 9px;
  border: 0;
  border-left: 1px solid var(--border);
  color: var(--text3);
  background: transparent;
  font-size: 11px;
}

.aiv-material-view-switcher button:first-child { border-left: 0; }

.aiv-material-view-switcher button.active {
  color: var(--on-orange);
  background: var(--orange);
  font-weight: 700;
}

.aiv-material-tab-panel .aiv-thumb-grid.is-list {
  grid-template-columns: minmax(0, 1fr);
  gap: 7px;
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

.aiv-thumb.is-list {
  min-height: 94px;
  aspect-ratio: auto;
  display: block;
  padding-left: 132px;
}

.aiv-thumb.is-list .aiv-thumb-media {
  right: auto;
  width: 122px;
}

.aiv-thumb.is-list .aiv-thumb-media::after {
  background: none;
}

.aiv-thumb.is-list .aiv-thumb-filename {
  top: 20px;
  right: 60px;
  bottom: auto;
  left: 142px;
  color: var(--text) !important;
  font-size: 13px !important;
  text-shadow: none;
}

.aiv-thumb.is-list .aiv-select-ribbon { right: 10px; }

.aiv-thumb.is-list .aiv-thumb-zoom {
  left: 61px;
  top: 47px;
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

.aiv-thumb.selected {
  border-color: var(--orange);
  color: var(--text);
  box-shadow: inset 0 0 0 2px var(--orange), 0 0 0 3px rgba(255, 107, 43, .16);
}

.aiv-large-thumb.selected {
  border-color: var(--orange);
  color: var(--text);
  box-shadow: inset 0 0 0 2px var(--orange), 0 0 0 3px rgba(255, 107, 43, .16);
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
  color: var(--on-orange) !important;
  background: var(--orange);
  font-size: 10px !important;
  font-weight: 700;
}

.aiv-thumb:not(.selected) .aiv-select-ribbon {
  color: var(--text2) !important;
  background: var(--bg);
  border: 1px solid var(--border);
}

.aiv-thumb-filename {
  position: absolute;
  z-index: 3;
  right: 7px;
  bottom: 7px;
  left: 7px;
  overflow: hidden;
  color: #fff !important;
  font-size: 11px !important;
  font-weight: 650;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: 0 1px 3px rgba(0, 0, 0, .8);
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
  color: var(--on-orange);
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

.aiv-edit-workbench .aiv-action-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  flex: 0 0 auto;
  align-content: start;
}

.aiv-edit-workbench .aiv-action-option {
  min-width: 0;
  min-height: 48px;
  max-width: 100%;
  padding: 7px 4px 8px;
  border: 1px solid transparent;
  border-bottom-color: var(--border);
  border-radius: 7px 7px 3px 3px;
  color: var(--text2);
  background: rgba(255, 255, 255, .018);
  text-align: center;
  overflow: hidden;
  cursor: pointer;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 3px;
  transition: border-color .16s ease, background-color .16s ease, color .16s ease, box-shadow .16s ease, transform .16s ease;
}

.aiv-edit-workbench .aiv-action-option.active {
  border-color: rgba(255, 107, 43, .44);
  border-bottom-color: var(--orange);
  color: var(--text);
  background: linear-gradient(180deg, rgba(255, 107, 43, .12), rgba(255, 107, 43, .035));
  box-shadow: inset 0 -2px 0 var(--orange), inset 0 0 0 1px rgba(255, 107, 43, .08);
}

.aiv-edit-workbench .aiv-action-option:hover:not(.active) {
  border-bottom-color: rgba(255, 107, 43, .54);
  color: var(--text);
  background: rgba(255, 255, 255, .05);
  transform: translateY(-1px);
}

.aiv-edit-workbench .aiv-action-option:focus-visible {
  outline: 2px solid rgba(255, 107, 43, .78);
  outline-offset: 2px;
}

.aiv-edit-workbench .aiv-action-option-copy,
.aiv-edit-workbench .aiv-action-option-copy strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-edit-workbench .aiv-action-option-copy strong {
  font-size: 12px;
  font-weight: 750;
  line-height: 1.25;
}

.aiv-edit-workbench .aiv-action-option-icon {
  width: 18px;
  height: 18px;
  stroke-width: 1.9;
  color: var(--text3);
}

.aiv-edit-workbench .aiv-action-option.active .aiv-action-option-icon {
  color: var(--orange);
}

.aiv-action-grid-hint {
  min-height: 28px;
  margin: 7px 0 0;
  padding: 6px 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  border-left: 2px solid var(--orange);
  border-radius: 0 6px 6px 0;
  color: var(--text3);
  background: rgba(255, 107, 43, .06);
  font-size: 11px;
  line-height: 1.2;
}

.aiv-action-grid-hint strong {
  flex: 0 0 auto;
  color: var(--orange);
  font-size: 11px;
}

.aiv-action-grid-hint span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Face-swap model picker: compact strip, never let model photo expand the rail */
.aiv-selected-model-preview {
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(255, 107, 43, .36);
  border-radius: 8px;
  background: var(--orange-bg);
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.aiv-selected-model-thumb {
  width: 44px;
  height: 56px;
  min-width: 44px;
  min-height: 56px;
  max-width: 44px;
  max-height: 56px;
  overflow: hidden;
  border: 1px solid rgba(255, 107, 43, .38);
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: var(--orange);
  background: var(--bg);
  font-size: 10px;
}

.aiv-selected-model-thumb img {
  width: 100%;
  height: 100%;
  max-width: 44px;
  max-height: 56px;
  display: block;
  object-fit: cover;
}

.aiv-selected-model-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.aiv-selected-model-copy span,
.aiv-selected-model-copy strong {
  min-width: 0;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-selected-model-copy span {
  color: var(--text3);
  font-size: 11px;
}

.aiv-selected-model-copy strong {
  color: var(--text);
  font-size: 12px;
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
  grid-template-columns: 148px 24px minmax(0, 1fr);
  gap: 10px;
}

.aiv-edit-origin-zone,
.aiv-edit-ai-zone {
  min-width: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 7px;
}

.aiv-edit-lane-head {
  min-height: 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 7px;
}

.aiv-edit-lane-head > div {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.aiv-edit-lane-head strong {
  color: var(--text);
  font-size: 11px;
  font-weight: 800;
}

.aiv-edit-lane-head span,
.aiv-edit-lane-head small {
  color: var(--text3);
  font-size: 10px;
  line-height: 1.2;
  white-space: nowrap;
}

.aiv-edit-origin-zone .aiv-edit-lane-head {
  padding: 0 3px;
}

.aiv-edit-origin-zone .aiv-edit-lane-head strong {
  color: var(--orange);
}

.aiv-edit-ai-zone .aiv-edit-lane-head {
  padding: 0 2px 0 4px;
}

.aiv-edit-lane-connector {
  align-self: center;
  width: 24px;
  height: 24px;
  border: 1px solid rgba(255, 107, 43, .28);
  border-radius: 999px;
  color: var(--orange);
  background: var(--orange-bg);
  display: grid;
  place-items: center;
  font-size: 14px;
  line-height: 1;
  box-shadow: 0 4px 10px rgba(0, 0, 0, .14);
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
  overflow: hidden;
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
  padding: 2px 3px 7px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scrollbar-gutter: stable;
}

.aiv-version-rail > .aiv-version-card {
  flex: 0 0 144px;
}

.aiv-version-card {
  aspect-ratio: 3 / 4;
  min-height: 0;
  text-align: left;
  overflow: hidden;
}

.aiv-version-preview {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--bg);
}

.aiv-version-preview img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.aiv-version-card:not(.add)::after {
  content: none;
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
  padding: 10px;
  display: grid;
  border-style: dashed;
  align-content: center;
  justify-items: center;
  text-align: center;
}

.aiv-media-card {
  position: relative;
  min-width: 0;
  overflow: hidden;
  isolation: isolate;
}

.aiv-media-card::after,
.aiv-original-card::after {
  content: none;
}

.aiv-media-select {
  position: absolute;
  z-index: 0;
  inset: 0;
  width: 100%;
  min-height: 0;
  padding: 0;
  border: 0;
  border-radius: inherit;
  background: var(--bg);
  cursor: pointer;
}

.aiv-media-select img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.aiv-selected-indicator {
  position: absolute;
  z-index: 2;
  top: 8px;
  left: 8px;
  min-height: 24px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, .34);
  color: #fff !important;
  background: #f26322;
  box-shadow: 0 3px 10px rgba(0, 0, 0, .28);
  font-size: 11px;
  font-weight: 800;
  line-height: 18px;
  letter-spacing: .01em;
  text-shadow: 0 1px 1px rgba(91, 28, 4, .36);
}

.aiv-version-card .aiv-selected-indicator {
  color: #fff !important;
  font-size: 11px;
}

.aiv-media-hover-tools {
  position: absolute;
  z-index: 2;
  inset: auto 0 0;
  min-width: 0;
  max-width: 100%;
  padding: 26px 10px 10px;
  display: grid;
  gap: 7px;
  color: var(--text);
  background: linear-gradient(180deg, transparent, rgba(8, 8, 12, .92) 38%);
  opacity: 0;
  pointer-events: none;
  transform: translateY(8px);
  transition: opacity .18s ease-out, transform .18s ease-out;
  overflow: hidden;
}

.aiv-media-hover-tools > div {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.aiv-media-hover-tools strong,
.aiv-media-hover-tools small,
.aiv-media-hover-tools span {
  min-width: 0;
  max-width: 100%;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-media-hover-tools small,
.aiv-media-hover-tools > div > span:not(.aiv-origin-label) {
  color: rgba(226, 224, 240, .76);
  font-size: 11px;
}

.aiv-media-card:hover .aiv-media-hover-tools,
.aiv-media-hover-tools:focus-within {
  opacity: 1;
  transform: translateY(0);
}

.aiv-media-hover-tools button {
  pointer-events: auto;
}

.aiv-media-select:focus-visible {
  outline: 2px solid rgba(255, 107, 43, .78);
  outline-offset: -3px;
}

.aiv-media-card.selected {
  border-color: var(--orange);
  box-shadow: inset 0 0 0 2px var(--orange), 0 0 0 1px rgba(255, 107, 43, .24);
}

.aiv-media-card.selected .aiv-media-select {
  box-shadow: inset 0 0 0 3px var(--orange);
}

/* 改图工作台：画面默认保持干净，悬浮时再显露信息与操作。 */
.aiv-edit-workbench .aiv-edit-source-row {
  padding: 11px;
  border-color: rgba(255, 255, 255, .09);
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(255, 255, 255, .018), transparent 42%), var(--bg);
}

.aiv-edit-workbench .aiv-media-card {
  border-color: rgba(255, 255, 255, .11);
  border-radius: 10px;
  background: var(--bg3);
  box-shadow: 0 6px 16px rgba(0, 0, 0, .11);
  transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease;
}

.aiv-edit-workbench .aiv-media-card:hover,
.aiv-edit-workbench .aiv-media-card:focus-within {
  border-color: rgba(255, 107, 43, .58);
  box-shadow: 0 12px 22px rgba(0, 0, 0, .22), 0 0 0 1px rgba(255, 107, 43, .14);
  transform: translateY(-2px);
}

.aiv-edit-workbench .aiv-media-select img {
  transition: transform .24s ease, filter .24s ease;
}

.aiv-edit-workbench .aiv-media-card:hover .aiv-media-select img,
.aiv-edit-workbench .aiv-media-card:focus-within .aiv-media-select img {
  filter: brightness(.86) saturate(.94);
  transform: scale(1.018);
}

.aiv-edit-workbench .aiv-media-hover-tools {
  padding: 42px 10px 10px;
  background: linear-gradient(180deg, transparent, rgba(8, 8, 12, .95) 46%);
  transition: opacity .18s ease-out, transform .18s ease-out, backdrop-filter .18s ease-out;
}

.aiv-edit-workbench .aiv-media-card:hover .aiv-media-hover-tools,
.aiv-edit-workbench .aiv-media-card:focus-within .aiv-media-hover-tools {
  backdrop-filter: blur(3px);
}

.aiv-edit-workbench .aiv-media-card.selected {
  border-color: var(--orange);
  box-shadow: inset 0 0 0 2px var(--orange), 0 0 0 2px rgba(255, 107, 43, .14);
}

.aiv-edit-workbench .aiv-media-card.selected:hover,
.aiv-edit-workbench .aiv-media-card.selected:focus-within {
  box-shadow: inset 0 0 0 2px var(--orange), 0 12px 22px rgba(0, 0, 0, .24), 0 0 0 3px rgba(255, 107, 43, .18);
}

.aiv-media-card .aiv-thumb-zoom {
  position: absolute;
  inset: auto 10px 10px auto;
  width: 30px;
  height: 30px;
  opacity: 1;
  transform: none;
}

.aiv-version-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
}

.aiv-version-generation-status {
  display: grid;
  gap: 5px;
  padding: 6px 7px;
  border: 1px solid rgba(255, 107, 43, .32);
  border-radius: 6px;
  background: rgba(255, 107, 43, .1);
}

.aiv-version-generation-status > span {
  display: flex !important;
  align-items: center;
  justify-content: space-between;
  color: rgba(255, 236, 226, .9) !important;
  font-size: 10px !important;
  font-weight: 700;
}

.aiv-version-generation-status > span strong {
  color: var(--orange);
  font-size: 10px;
}

.aiv-version-actions .aiv-version-delete {
  width: auto;
}

.aiv-version-edit,
.aiv-version-delete,
.aiv-ai-actions button,
.aiv-add-menu button {
  min-height: 28px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text2);
  background: var(--bg);
  font-size: 11px;
  line-height: 1.2;
}

.aiv-version-edit,
.aiv-version-delete {
  width: 100%;
}

.aiv-version-edit:hover,
.aiv-version-edit:focus-visible,
.aiv-ai-actions button:hover,
.aiv-ai-actions button:focus-visible,
.aiv-add-menu button:hover,
.aiv-add-menu button:focus-visible {
  border-color: rgba(255, 107, 43, 0.55);
  color: var(--orange);
  background: var(--orange-bg);
}

.aiv-version-delete:hover,
.aiv-version-delete:focus-visible,
.aiv-ai-actions .danger:hover,
.aiv-ai-actions .danger:focus-visible {
  border-color: rgba(248, 113, 113, 0.5);
  color: #f87171;
  background: rgba(248, 113, 113, 0.08);
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

.aiv-review-summary-badges {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.aiv-review-workbench .aiv-review-summary-badges .aiv-badge {
  min-height: 26px;
  padding-right: 9px;
  padding-left: 9px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .05);
  font-variant-numeric: tabular-nums;
  transition: transform .16s ease, border-color .16s ease, background-color .16s ease;
}

.aiv-review-workbench .aiv-review-summary-badges .aiv-badge:hover {
  transform: translateY(-1px);
}

.aiv-review-toolbar {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, .09);
  display: grid;
  grid-template-columns: minmax(160px, 1fr) 128px auto;
  gap: 8px;
  align-items: center;
  background: linear-gradient(90deg, rgba(255, 255, 255, .012), transparent 65%);
}

.aiv-review-toolbar-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.aiv-review-selection-bar {
  min-height: 44px;
  padding: 7px 12px;
  border-bottom: 1px solid rgba(255, 107, 43, .17);
  background: linear-gradient(90deg, rgba(255, 107, 43, .08), rgba(255, 107, 43, .018) 48%, transparent);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.aiv-review-selection-copy {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 7px;
}

.aiv-review-selection-copy strong {
  color: var(--text);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.aiv-review-selection-copy span {
  overflow: hidden;
  color: var(--text3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-review-selection-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
}

.aiv-review-selection-actions .ok:not(:disabled) {
  border-color: rgba(74, 222, 128, .36);
  color: var(--green);
}

.aiv-review-selection-actions .ok:hover:not(:disabled),
.aiv-review-selection-actions .ok:focus-visible:not(:disabled) {
  border-color: rgba(74, 222, 128, .58);
  color: #78e7a1;
  background: rgba(74, 222, 128, .09);
}

.aiv-ai-asset-board {
  display: grid;
  /* Match AI-edit version cards (~112–160px) for denser review scanning */
  grid-template-columns: repeat(auto-fill, minmax(132px, 148px));
  justify-content: start;
  align-content: start;
  gap: 8px;
}

.aiv-ai-card {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  box-shadow: 0 4px 12px rgba(0, 0, 0, .12);
  transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease, opacity .18s ease;
}

.aiv-ai-card:hover,
.aiv-ai-card:focus-within {
  border-color: rgba(255, 107, 43, .5);
  box-shadow: 0 12px 24px rgba(0, 0, 0, .26), 0 0 0 1px rgba(255, 107, 43, .12);
  transform: translateY(-2px);
}

.aiv-ai-card.approved {
  border-color: rgba(74, 222, 128, 0.45);
  box-shadow: inset 0 0 0 1px rgba(74, 222, 128, .08), 0 4px 12px rgba(0, 0, 0, .12);
}

.aiv-ai-card.retry {
  border-color: rgba(255, 107, 43, 0.55);
  box-shadow: inset 0 0 0 1px rgba(255, 107, 43, .1), 0 4px 12px rgba(0, 0, 0, .12);
}

.aiv-ai-card.rejected {
  border-color: rgba(248, 113, 113, 0.4);
  opacity: 0.88;
}

.aiv-ai-card.selected {
  border-color: rgba(255, 107, 43, .62);
  box-shadow: 0 0 0 2px rgba(255, 107, 43, .18), 0 9px 20px rgba(0, 0, 0, .2);
}

.aiv-ai-card.saving {
  pointer-events: none;
}

.aiv-ai-card.saving .aiv-ai-preview {
  opacity: .72;
}

.aiv-ai-card.has-feedback {
  animation: aiv-review-card-feedback .9s cubic-bezier(.16, 1, .3, 1);
}

.aiv-ai-card.add {
  position: relative;
  border-style: dashed;
}

.aiv-ai-card .aiv-ai-preview,
.aiv-ai-card .aiv-add-image {
  position: relative;
  overflow: hidden;
  width: 100%;
  aspect-ratio: 3 / 4;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: var(--bg);
}

.aiv-ai-actions .aiv-review-card-select {
  position: relative;
  flex: 0 0 22px;
  width: 22px;
  height: 22px;
  margin-left: auto;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, .26);
  border-radius: 6px;
  color: var(--text3);
  background: rgba(255, 255, 255, .035);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .035);
  cursor: pointer;
  transition: border-color .16s ease, color .16s ease, background-color .16s ease, box-shadow .16s ease, transform .16s ease;
}

.aiv-ai-actions .aiv-review-card-select:hover,
.aiv-ai-actions .aiv-review-card-select:focus-within {
  border-color: rgba(255, 107, 43, .62);
  color: #ffd4c1;
  background: rgba(255, 107, 43, .11);
  transform: translateY(-1px);
}

.aiv-review-card-select.selected {
  border-color: rgba(255, 107, 43, .82);
  color: #fff;
  background: var(--orange);
  box-shadow: 0 3px 9px rgba(255, 107, 43, .22), inset 0 1px 0 rgba(255, 255, 255, .2);
}

.aiv-review-card-select input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: inherit;
}

.aiv-review-card-select input:disabled {
  cursor: default;
}

.aiv-review-card-select-icon {
  opacity: 0;
  transform: scale(.72);
  transition: opacity .14s ease, transform .16s cubic-bezier(.16, 1, .3, 1);
}

.aiv-review-card-select.selected .aiv-review-card-select-icon {
  opacity: 1;
  transform: scale(1);
}

.aiv-ai-card .aiv-ai-preview img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  transition: filter .22s ease, transform .26s cubic-bezier(.16, 1, .3, 1);
}

.aiv-ai-card:hover .aiv-ai-preview img,
.aiv-ai-card:focus-within .aiv-ai-preview img {
  filter: brightness(.88) saturate(.94);
  transform: scale(1.035);
}

.aiv-ai-card .aiv-add-image {
  padding: 10px 8px;
  gap: 6px;
  color: var(--text2);
  background: linear-gradient(135deg, rgba(255,255,255,0.04), transparent 45%), var(--bg3);
}

.aiv-ai-card .aiv-add-image strong {
  font-size: 12px;
}

.aiv-ai-preview small,
.aiv-add-image span {
  color: var(--text3);
  font-size: 10px;
  text-align: center;
  line-height: 1.35;
}

.aiv-ai-status-badge {
  position: absolute;
  z-index: 2;
  top: 6px;
  left: 6px;
  min-height: 18px;
  padding: 1px 6px;
  border-radius: 999px;
  color: var(--text);
  background: rgba(12, 12, 16, 0.78);
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
  line-height: 16px;
  pointer-events: none;
}

.aiv-ai-preview-zoom {
  position: absolute;
  z-index: 2;
  right: 6px;
  bottom: 6px;
  min-height: 24px;
  padding: 3px 7px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid rgba(255, 255, 255, .22);
  border-radius: 6px;
  color: #fff;
  background: rgba(12, 12, 16, .72);
  font-size: 10px;
  font-weight: 700;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity .16s ease, transform .16s ease, background-color .16s ease;
  pointer-events: none;
}

.aiv-ai-preview-zoom svg {
  width: 13px;
  height: 13px;
  stroke-width: 2;
}

.aiv-ai-card:hover .aiv-ai-preview-zoom,
.aiv-ai-card:focus-within .aiv-ai-preview-zoom {
  opacity: 1;
  transform: translateY(0);
}

.aiv-ai-card.approved .aiv-ai-status-badge {
  color: #102016;
  background: rgba(74, 222, 128, 0.92);
}

.aiv-ai-card.retry .aiv-ai-status-badge {
  color: var(--on-orange);
  background: var(--orange);
}

.aiv-ai-card.rejected .aiv-ai-status-badge {
  color: #fff;
  background: rgba(248, 113, 113, 0.92);
}

.aiv-ai-card footer {
  padding: 6px 7px 7px;
  display: grid;
  gap: 6px;
  align-content: start;
}

.aiv-review-card-feedback {
  position: absolute;
  z-index: 4;
  top: 50%;
  left: 50%;
  min-width: 78px;
  padding: 7px 9px;
  border: 1px solid rgba(255, 255, 255, .24);
  border-radius: 7px;
  color: #fff;
  background: rgba(15, 17, 22, .82);
  box-shadow: 0 10px 26px rgba(0, 0, 0, .28);
  font-size: 11px;
  font-weight: 800;
  text-align: center;
  transform: translate(-50%, -50%);
  pointer-events: none;
  animation: aiv-review-feedback-label .9s cubic-bezier(.16, 1, .3, 1) both;
}

.aiv-review-card-feedback.approved {
  border-color: rgba(74, 222, 128, .56);
  background: rgba(24, 92, 53, .9);
}

.aiv-review-card-feedback.rejected {
  border-color: rgba(248, 113, 113, .56);
  background: rgba(130, 42, 42, .9);
}

.aiv-review-card-feedback.retry {
  border-color: rgba(255, 107, 43, .56);
  background: rgba(136, 62, 29, .9);
}

.aiv-ai-card-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.aiv-ai-card footer strong,
.aiv-ai-card footer span,
.aiv-ai-card-copy strong,
.aiv-ai-card-copy span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-ai-card footer strong,
.aiv-ai-card-copy strong {
  color: var(--text);
  font-size: 11px;
  line-height: 1.25;
}

.aiv-ai-card footer span,
.aiv-ai-card-copy span {
  margin-top: 0;
  color: var(--text3);
  font-size: 10px;
  line-height: 1.3;
}

.aiv-ai-card .aiv-ai-actions {
  gap: 4px;
}

.aiv-ai-actions button,
.aiv-add-menu button {
  min-height: 22px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text2);
  background: var(--bg);
  font-size: 10px;
  transition: border-color .15s ease, color .15s ease, background-color .15s ease, transform .15s ease;
}

.aiv-ai-actions .ok {
  color: var(--green);
}

.aiv-ai-actions button:hover:not(:disabled),
.aiv-ai-actions button:focus-visible:not(:disabled) {
  border-color: rgba(255, 107, 43, .45);
  color: var(--text);
  background: rgba(255, 255, 255, .07);
  outline: none;
  transform: translateY(-1px);
}

.aiv-ai-actions .ok:hover:not(:disabled),
.aiv-ai-actions .ok:focus-visible:not(:disabled) {
  border-color: rgba(74, 222, 128, .5);
  color: #78e7a1;
  background: rgba(74, 222, 128, .09);
}

.aiv-ai-actions .danger:hover:not(:disabled),
.aiv-ai-actions .danger:focus-visible:not(:disabled) {
  border-color: rgba(248, 113, 113, .52);
  color: #f99a9a;
  background: rgba(248, 113, 113, .09);
}

.aiv-ai-actions button:active:not(:disabled) {
  transform: translateY(0) scale(.96);
}

@keyframes aiv-review-card-feedback {
  0% { transform: scale(.98); }
  32% { transform: scale(1.018); }
  100% { transform: scale(1); }
}

@keyframes aiv-review-feedback-label {
  0% { opacity: 0; transform: translate(-50%, -42%) scale(.92); }
  18%, 72% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -58%) scale(.98); }
}

.aiv-add-menu {
  position: absolute;
  z-index: 3;
  left: 6px;
  right: 6px;
  bottom: 6px;
  padding: 6px;
  display: grid;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.32);
}

.aiv-source-assets-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}

.aiv-source-assets-row strong {
  margin-right: 6px;
}

.aiv-source-assets-more {
  min-width: 0;
}

.aiv-source-assets-more summary {
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  color: var(--text2);
  font-size: 11px;
  cursor: pointer;
}

.aiv-source-assets-more > div {
  max-width: 100%;
  padding-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.aiv-review-action-error {
  margin: 0 14px 12px;
}

.aiv-review-undo {
  margin: 0 14px 12px;
  padding: 8px 10px;
  border: 1px solid rgba(74, 222, 128, .32);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--text2);
  background: rgba(74, 222, 128, .07);
  font-size: 12px;
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
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  gap: 8px;
}

.aiv-video-task-card {
  overflow: hidden;
  border-left: 3px solid transparent;
  transition: border-color .2s ease, background-color .2s ease;
}

.aiv-video-task-card.selected {
  border-left-color: var(--orange);
  background: linear-gradient(90deg, rgba(255, 107, 43, .08), transparent 22%);
}

.aiv-video-task-row {
  min-width: 0;
  padding: 10px 12px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
}

.aiv-video-task-assets.compact {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.aiv-video-task-check {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  display: inline-grid;
  place-items: center;
  cursor: pointer;
}

.aiv-video-task-check input,
.aiv-video-task-select-all input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--orange);
  cursor: pointer;
}

.aiv-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.aiv-video-task-assets.compact .aiv-video-asset-card.thumb-only {
  position: relative;
  width: 48px;
  height: 64px;
  min-width: 48px;
  aspect-ratio: auto;
  padding: 0;
  overflow: hidden;
  border-radius: 6px;
}

.aiv-video-task-assets.compact .aiv-video-asset-card.thumb-only img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.aiv-video-thumb-fallback {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--text3);
  font-size: 11px;
  background: var(--bg3);
}

.aiv-video-task-main {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.aiv-video-task-title-line {
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
}

.aiv-video-task-title-line > strong {
  min-width: 0;
  max-width: min(420px, 100%);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: 13px;
}

.aiv-video-task-status {
  color: var(--text3);
  font-size: 11px;
}

.aiv-video-task-stage {
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text2);
  background: var(--bg3);
  font-size: 11px;
  font-weight: 750;
  line-height: 1;
  white-space: nowrap;
}

.aiv-video-task-stage i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 16%, transparent);
}

.aiv-video-task-stage.is-pending { color: var(--text3); }
.aiv-video-task-stage.is-authorization,
.aiv-video-task-stage.is-ready { border-color: rgba(251, 191, 36, .48); color: #fbbf24; background: rgba(251, 191, 36, .10); }
.aiv-video-task-stage.is-submitted,
.aiv-video-task-stage.is-queued { border-color: rgba(96, 165, 250, .48); color: #60a5fa; background: rgba(96, 165, 250, .10); }
.aiv-video-task-stage.is-generating { border-color: rgba(192, 132, 252, .52); color: #c084fc; background: rgba(192, 132, 252, .10); }
.aiv-video-task-stage.is-generating i { animation: aiv-status-pulse 1.2s ease-in-out infinite; }
.aiv-video-task-stage.is-downloaded { border-color: rgba(74, 222, 128, .48); color: var(--green); background: rgba(74, 222, 128, .10); }
.aiv-video-task-stage.is-failed { border-color: rgba(248, 113, 113, .5); color: #f87171; background: rgba(248, 113, 113, .10); }

@keyframes aiv-status-pulse {
  50% { transform: scale(1.45); opacity: .55; }
}

.aiv-video-task-meta-line {
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 14px;
  color: var(--text2);
  font-size: 11px;
}

.aiv-video-task-meta-line > span {
  min-width: 0;
  max-width: min(360px, 100%);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-video-task-meta-line strong {
  margin-right: 4px;
  color: var(--text3);
  font-weight: 600;
}

.aiv-video-task-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
  max-width: 420px;
}

.aiv-video-more-assets {
  min-width: 28px;
  height: 28px;
  border-radius: 999px;
  display: inline-grid;
  place-items: center;
  color: var(--text2);
  background: var(--bg3);
  font-size: 11px;
  font-weight: 700;
}

.aiv-video-toolbar {
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.aiv-video-toolbar-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.aiv-video-task-filterbar {
  min-height: 46px;
  padding: 0 14px 10px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.aiv-video-task-status-tabs {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.aiv-video-task-status-tabs button {
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--text3);
  background: transparent;
  font-size: 11px;
  white-space: nowrap;
}

.aiv-video-task-status-tabs button strong {
  margin-left: 3px;
  color: var(--text2);
  font-variant-numeric: tabular-nums;
}

.aiv-video-task-status-tabs button:hover,
.aiv-video-task-status-tabs button.active {
  border-color: rgba(255, 107, 43, .42);
  color: var(--orange);
  background: var(--orange-bg);
}

.aiv-video-task-status-tabs button.active strong { color: inherit; }

.aiv-video-task-select-all {
  min-height: 28px;
  padding-left: 10px;
  border-left: 1px solid var(--border);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text2);
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}

.aiv-video-task-selection-hint {
  color: var(--text3);
  font-size: 11px;
}

.aiv-batch-actions {
  position: relative;
}

.aiv-batch-actions summary {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  color: var(--text2);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
}

.aiv-batch-actions[open] summary {
  border-color: rgba(255, 107, 43, .45);
  color: var(--orange);
  background: var(--orange-bg);
}

.aiv-batch-actions > div {
  width: min(320px, 100%);
  position: absolute;
  z-index: 12;
  right: 0;
  margin-top: 6px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  display: grid;
  gap: 8px;
  background: var(--bg2);
}

.aiv-batch-actions > div > span {
  color: var(--text3);
  font-size: 11px;
  line-height: 1.45;
}

.aiv-video-stage-feedback,
.aiv-stage-feedback {
  margin: 0 14px 12px;
}

.aiv-stage-feedback {
  padding: 8px 10px;
  border: 1px solid rgba(255, 107, 43, .24);
  border-radius: 8px;
  color: var(--text2);
  background: var(--orange-bg);
  font-size: 12px;
  line-height: 1.45;
}

.aiv-batch-summary.inline {
  display: flex;
  align-items: center;
  gap: 12px;
}

.aiv-batch-summary.inline div {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  display: flex;
  align-items: baseline;
  gap: 5px;
}

.aiv-batch-summary.inline span {
  margin: 0;
}

.aiv-field.compact {
  align-self: stretch;
  flex: 1 1 300px;
  max-width: 520px;
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

.aiv-video-task-layout {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.aiv-video-task-layout .aiv-video-task-assets {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: 5px;
}

.aiv-video-task-details {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 10px;
}

.aiv-video-task-layout .aiv-video-task-meta {
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
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

.aiv-video-asset-select {
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 10px;
  border: 0;
  border-radius: 7px;
  color: inherit;
  background: transparent;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  cursor: pointer;
}

.aiv-video-asset-select:disabled {
  cursor: default;
}

.aiv-video-asset-card-actions {
  position: absolute;
  z-index: 3;
  top: 7px;
  right: 7px;
  opacity: 0;
  transform: translateY(-3px);
  transition: opacity .16s ease, transform .16s ease;
}

.aiv-video-asset-zoom {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, .26);
  border-radius: 6px;
  color: #fff;
  background: rgba(15, 17, 23, .82);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.aiv-video-asset-zoom:hover,
.aiv-video-asset-zoom:focus-visible {
  border-color: var(--orange);
  color: var(--orange);
  background: var(--bg);
}

.aiv-video-task-assets.picker .aiv-video-asset-select > strong,
.aiv-video-task-assets.picker .aiv-video-asset-select > small,
.aiv-video-task-assets.picker .aiv-video-asset-select > .aiv-status-pill {
  position: relative;
  z-index: 2;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity .16s ease, transform .16s ease;
}

.aiv-video-task-assets.picker .aiv-video-asset-card:hover .aiv-video-asset-card-actions,
.aiv-video-task-assets.picker .aiv-video-asset-card:focus-within .aiv-video-asset-card-actions,
.aiv-video-task-assets.picker .aiv-video-asset-card:hover .aiv-video-asset-select > strong,
.aiv-video-task-assets.picker .aiv-video-asset-card:hover .aiv-video-asset-select > small,
.aiv-video-task-assets.picker .aiv-video-asset-card:hover .aiv-video-asset-select > .aiv-status-pill,
.aiv-video-task-assets.picker .aiv-video-asset-card:focus-within .aiv-video-asset-select > strong,
.aiv-video-task-assets.picker .aiv-video-asset-card:focus-within .aiv-video-asset-select > small,
.aiv-video-task-assets.picker .aiv-video-asset-card:focus-within .aiv-video-asset-select > .aiv-status-pill,
.aiv-video-task-assets.picker .aiv-video-asset-card:not(.has-preview) .aiv-video-asset-select > strong,
.aiv-video-task-assets.picker .aiv-video-asset-card:not(.has-preview) .aiv-video-asset-select > small,
.aiv-video-task-assets.picker .aiv-video-asset-card:not(.has-preview) .aiv-video-asset-select > .aiv-status-pill {
  opacity: 1;
  transform: translateY(0);
}

.aiv-video-task-layout .aiv-video-asset-card {
  min-width: 0;
  padding: 4px;
}

.aiv-video-task-layout .aiv-video-asset-card strong,
.aiv-video-task-layout .aiv-video-asset-card small,
.aiv-video-task-layout .aiv-video-asset-card .aiv-status-pill {
  display: none;
}

.aiv-video-more-assets {
  min-height: 48px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: var(--text2);
  font-size: 12px;
}

.aiv-video-asset-card.selected {
  border-color: var(--orange);
  color: var(--text);
  background: var(--orange-bg);
  box-shadow:
    0 0 0 2px var(--orange),
    0 0 0 5px rgba(255, 107, 43, 0.28),
    inset 0 0 0 1px rgba(255, 107, 43, 0.55);
}

.aiv-video-task-assets.picker .aiv-video-asset-card.selected {
  transform: translateY(-1px);
}

.aiv-video-asset-selected-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 3;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 107, 43, 0.75);
  background: rgba(255, 107, 43, 0.95);
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.02em;
  display: inline-flex;
  align-items: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
}

.aiv-video-task-assets.picker .aiv-video-asset-card.selected .aiv-status-pill {
  top: 8px;
  right: 8px;
  left: auto;
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
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.aiv-video-task-meta strong,
.aiv-video-task-meta span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-video-task-card .aiv-panel-head {
  min-height: 48px;
  padding: 10px 12px;
}

.aiv-video-task-card .aiv-panel-body {
  padding: 12px;
}

.aiv-video-task-card .aiv-seedance-callout {
  padding: 8px 9px;
}

.aiv-video-task-card .aiv-inline-actions {
  gap: 6px;
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

.aiv-result-stage-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.aiv-result-stage-summary span {
  margin: 0;
  padding: 3px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text2);
  background: var(--bg2);
  font-size: 11px;
}

.aiv-live-progress-label {
  margin: 0 !important;
  color: var(--text2) !important;
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
  grid-template-columns: repeat(auto-fill, minmax(228px, 280px));
  justify-content: start;
  gap: 18px;
}

.aiv-result-empty {
  grid-column: 1 / -1;
  min-height: 180px;
  padding: 18px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  display: grid;
  align-content: center;
  justify-items: start;
  gap: 8px;
  color: var(--text2);
  background: var(--bg);
}

.aiv-result-empty strong,
.aiv-result-empty span {
  display: block;
}

.aiv-result-empty span {
  max-width: 48ch;
  color: var(--text3);
  font-size: 12px;
  line-height: 1.5;
}

.aiv-result-card {
  min-width: 0;
  aspect-ratio: 9 / 16;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #111116;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  box-shadow: 0 16px 34px rgba(0, 0, 0, 0.22);
}

.aiv-result-preview {
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  max-height: none;
  overflow: hidden;
  aspect-ratio: 9 / 16;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  background: linear-gradient(135deg, rgba(255,255,255,0.07), transparent 45%), var(--bg);
  color: var(--text2);
}

.aiv-result-preview video {
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  display: block;
  object-fit: cover;
  background: #09090b;
}

.aiv-result-preview-empty {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
}

.aiv-result-preview-loading {
  min-width: 0;
  max-width: 100%;
  padding: 16px;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 8px;
  text-align: center;
}

.aiv-result-preview-loading strong,
.aiv-result-preview-loading span {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.aiv-result-spinner {
  width: 28px;
  height: 28px;
  border: 2px solid rgba(255, 255, 255, 0.12);
  border-top-color: var(--orange);
  border-radius: 50%;
  animation: aiv-result-spin 0.8s linear infinite;
}

@keyframes aiv-result-spin {
  to { transform: rotate(360deg); }
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
  padding: 11px 12px 12px;
  display: grid;
  gap: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: linear-gradient(180deg, rgba(30, 30, 38, 0.98), rgba(18, 18, 23, 0.98));
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

.aiv-result-clear {
  margin-left: auto;
  color: #f6b29f;
  border-color: rgba(244, 118, 74, 0.42);
}

.aiv-preview-modal-panel {
  width: min(1440px, calc(100vw - 48px));
  height: min(920px, calc(100vh - 48px));
  max-height: none;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  box-shadow: 0 22px 80px rgba(0, 0, 0, 0.42);
}

.aiv-preview-title-block {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.aiv-preview-title-main {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.aiv-preview-title-main > strong {
  flex: 0 1 auto;
}

.aiv-preview-version-count,
.aiv-editor-current-action {
  flex: 0 0 auto;
  padding: 3px 7px;
  border: 1px solid rgba(255, 107, 43, .34);
  border-radius: 999px;
  color: var(--orange);
  background: rgba(255, 107, 43, .08);
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.aiv-preview-title-block strong,
.aiv-preview-title-block span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-image-editor-layout {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(340px, 380px);
  overflow: hidden;
}

.aiv-image-editor-stage {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(255, 255, 255, .018), transparent 42%), var(--bg);
}

.aiv-big-preview {
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 0;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(255, 255, 255, .018), transparent 54%), var(--bg);
}

.aiv-big-preview-frame {
  position: absolute;
  inset: 14px 18px;
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 10px;
  background:
    radial-gradient(circle at 50% 42%, rgba(255, 255, 255, .035), transparent 48%),
    #0f1016;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .035);
}

.aiv-big-preview-image,
.aiv-big-preview img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 14px 34px rgba(0, 0, 0, .22);
}

.aiv-preview-canvas-status {
  position: absolute;
  z-index: 4;
  top: 12px;
  left: 12px;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid rgba(255, 255, 255, .13);
  border-radius: 7px;
  background: rgba(11, 12, 18, .7);
  backdrop-filter: blur(8px);
  pointer-events: none;
}

.aiv-preview-canvas-status strong,
.aiv-preview-canvas-status span {
  display: block;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-preview-canvas-status strong {
  color: var(--text);
  font-size: 11px;
}

.aiv-preview-canvas-status span {
  margin-top: 2px;
  color: var(--text3);
  font-size: 10px;
}

.aiv-big-preview-placeholder {
  width: min(360px, 80%);
  aspect-ratio: 3 / 4;
  max-height: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text2);
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 8px;
}

.aiv-image-annotation-layer {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
}

.aiv-image-annotation-layer.active {
  pointer-events: auto;
}

.aiv-image-annotation-layer :deep(.aiw-tldraw-host),
.aiv-image-annotation-layer :deep(.aiw-tldraw-root),
.aiv-image-annotation-layer :deep(.tl-container),
.aiv-image-annotation-layer :deep(.tl-canvas) {
  min-height: 0;
  width: 100%;
  height: 100%;
  touch-action: none;
}

.aiv-image-annotation-layer :deep(.tl-container) {
  --tl-color-background: transparent;
}

.aiv-image-annotation-layer :deep(.tl-background),
.aiv-image-annotation-layer :deep(.tl-background__wrapper) {
  background: transparent !important;
}

.aiv-image-annotation-toolbar {
  position: absolute;
  z-index: 5;
  right: 30px;
  top: 30px;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  max-width: calc(100% - 56px);
  pointer-events: auto;
}

.aiv-model-config-empty {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px dashed rgba(255, 107, 43, .4);
  border-radius: 8px;
  background: var(--orange-bg);
}

.aiv-model-config-empty > span {
  color: var(--text2);
  font-size: 12px;
  line-height: 1.4;
}

.aiv-image-annotation-toolbar button,
.aiv-image-editor-actions button {
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--text2);
  background: rgba(20, 20, 24, .88);
  font-size: 11px;
}

.aiv-image-annotation-toolbar button.active,
.aiv-image-editor-actions button.active {
  border-color: var(--orange);
  color: var(--orange);
  background: var(--orange-bg);
}

.aiv-preview-history-strip {
  min-height: 98px;
  padding: 10px 14px;
  border-top: 1px solid rgba(255, 255, 255, .08);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  background: rgba(255, 255, 255, .012);
}

.aiv-preview-history-title {
  flex: 0 0 auto;
  display: grid;
  gap: 3px;
  padding-right: 2px;
}

.aiv-preview-history-title strong {
  color: var(--text2);
  font-size: 11px;
}

.aiv-preview-history-title span {
  color: var(--text3);
  font-size: 10px;
  white-space: nowrap;
}

.aiv-preview-history-list {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  padding: 1px 1px 3px;
}

.aiv-preview-history-strip button {
  flex: 0 0 58px;
  height: 70px;
  overflow: hidden;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--text3);
  background: var(--bg3);
}

.aiv-preview-history-strip button.active {
  border-color: var(--orange);
  box-shadow: 0 0 0 1px rgba(255, 107, 43, .22);
}

.aiv-preview-history-strip img {
  width: 100%;
  height: 48px;
  display: block;
  object-fit: cover;
}

.aiv-preview-history-list button span {
  display: block;
  padding: 3px 4px;
  overflow: hidden;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-image-editor-tools {
  min-width: 0;
  padding: 14px;
  border-left: 1px solid rgba(255, 255, 255, .1);
  background: linear-gradient(180deg, rgba(255, 255, 255, .018), transparent 160px), var(--bg2);
  display: grid;
  align-content: start;
  gap: 10px;
  overflow-y: auto;
}

.aiv-image-editor-tools-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.aiv-image-editor-tools-head > div {
  min-width: 0;
}

.aiv-image-editor-tools-head strong,
.aiv-image-editor-tools-head span {
  display: block;
}

.aiv-image-editor-tools-head > div > span {
  color: var(--text3);
  font-size: 11px;
  line-height: 1.45;
}

.aiv-image-editor-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.aiv-image-editor-actions button {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(255, 255, 255, .018);
  transition: border-color .16s ease, color .16s ease, background-color .16s ease, transform .16s ease;
}

.aiv-image-editor-actions button:hover:not(.active) {
  border-color: rgba(255, 107, 43, .48);
  color: var(--text);
  background: rgba(255, 255, 255, .05);
  transform: translateY(-1px);
}

.aiv-image-editor-actions button svg {
  width: 15px;
  height: 15px;
  stroke-width: 1.9;
}

.aiv-image-editor-actions button span {
  font-size: 11px;
  font-weight: 700;
}

.aiv-image-editor-tools .aiv-field-heading small {
  color: var(--text3);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.aiv-image-editor-tools-foot {
  margin-top: 2px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, .08);
  display: grid;
  gap: 8px;
}

.aiv-image-editor-tools-foot > span {
  color: var(--text3);
  font-size: 10px;
  line-height: 1.4;
}

.aiv-preview-model-picker {
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(255, 107, 43, .36);
  border-radius: 8px;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  background: var(--orange-bg);
}

.aiv-preview-model-sample {
  width: 44px;
  height: 54px;
  overflow: hidden;
  border: 1px solid rgba(255, 107, 43, .38);
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: var(--orange);
  background: var(--bg);
  font-size: 10px;
}

.aiv-preview-model-sample img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.aiv-preview-model-picker strong,
.aiv-preview-model-picker span {
  min-width: 0;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-preview-model-picker span {
  margin-top: 3px;
  color: var(--text3);
  font-size: 11px;
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

.aiv-preview-modal {
  z-index: 90;
}

/* The model picker can be opened from the large-image editor. Keep it above
   that editor instead of rendering it behind the existing preview backdrop. */
.aiv-modal.aiv-model-library-modal {
  z-index: 110;
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

.aiv-modal-panel.aiv-local-material-modal-panel,
.aiv-modal-panel.aiv-model-library-modal-panel {
  height: min(780px, calc(100vh - 56px));
}

/* 两类改图选择器共享层级：标题与选择状态固定，筛选与素材区各自滚动。 */
.aiv-picker-modal-panel {
  border-color: rgba(255, 255, 255, .12);
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(255, 255, 255, .025), transparent 100px), var(--bg2);
  box-shadow: 0 26px 90px rgba(0, 0, 0, .52);
}

.aiv-picker-modal-panel .aiv-modal-head {
  min-height: 64px;
  padding: 14px 16px;
  background: rgba(255, 255, 255, .014);
}

.aiv-picker-modal-panel .aiv-modal-foot {
  min-height: 58px;
  padding: 11px 16px;
  background: rgba(7, 8, 12, .46);
}

.aiv-picker-selection-summary {
  min-height: 26px;
  margin-top: 0 !important;
  padding: 4px 8px;
  border: 1px solid rgba(255, 107, 43, .30);
  border-radius: 6px;
  color: var(--text2) !important;
  background: rgba(255, 107, 43, .065);
  font-variant-numeric: tabular-nums;
}

.aiv-local-material-modal-body {
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  overflow: hidden;
}

.aiv-local-material-modal-toolbar {
  min-width: 0;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.aiv-local-material-modal-toolbar-primary {
  gap: 10px;
}

.aiv-local-material-style-search {
  flex: 1 1 auto;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  background: var(--bg);
  font-size: 12px;
}

.aiv-local-material-style-tabs {
  min-width: 0;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  max-height: 88px;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.aiv-local-material-style-tabs .aiv-action-chip strong {
  margin-left: 4px;
  font-weight: 700;
}

.aiv-local-material-result-count {
  flex: 0 0 auto;
  color: var(--text3);
  font-size: 11px;
}

.aiv-local-material-modal-toolbar > span,
.aiv-local-material-modal-toolbar-actions {
  flex: 0 0 auto;
  color: var(--text2);
  font-size: 11px;
}

.aiv-local-material-modal-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.aiv-picker-modal-panel .aiv-local-material-modal-toolbar {
  padding-right: 16px;
  padding-left: 16px;
  background: rgba(255, 255, 255, .012);
}

.aiv-picker-modal-panel .aiv-local-material-style-search:focus {
  border-color: rgba(255, 107, 43, .64);
  box-shadow: 0 0 0 3px rgba(255, 107, 43, .09);
  outline: none;
}

.aiv-reference-kind-switcher {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.aiv-local-material-modal-grid {
  min-height: 0;
  padding: 14px;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  align-items: flex-start;
  gap: 12px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.aiv-local-material-empty {
  flex: 1 1 100%;
}

.aiv-local-material-card {
  box-sizing: border-box;
  flex: 0 0 148px;
  width: 148px;
  max-width: 100%;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text2);
  background: var(--bg3);
  overflow: hidden;
  cursor: pointer;
  display: block;
  position: relative;
  isolation: isolate;
  box-shadow: 0 5px 14px rgba(0, 0, 0, .12);
  transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease;
}

.aiv-local-material-card:hover,
.aiv-local-material-card:focus-visible {
  border-color: rgba(255, 107, 43, .56);
  box-shadow: 0 12px 22px rgba(0, 0, 0, .24), 0 0 0 1px rgba(255, 107, 43, .14);
  outline: none;
  transform: translateY(-2px);
}

.aiv-local-material-card.selected {
  border-color: var(--orange);
  box-shadow: inset 0 0 0 2px var(--orange), 0 0 0 2px rgba(255, 107, 43, .14);
}

/* padding-top % is relative to width — reliable 3:4 thumbnail height */
.aiv-local-material-card-preview {
  position: relative;
  width: 100%;
  height: 0;
  padding-top: 133.333%;
  margin: 0;
  overflow: hidden;
  background: #121218;
}

.aiv-local-material-card-preview img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  border: 0;
  display: block;
  object-fit: cover;
  object-position: center center;
  transition: transform .24s ease, filter .24s ease;
}

.aiv-local-material-card:hover .aiv-local-material-card-preview img,
.aiv-local-material-card:focus-visible .aiv-local-material-card-preview img {
  filter: brightness(.92);
  transform: scale(1.025);
}

.aiv-local-material-card-fallback {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text3);
  font-size: 11px;
}

.aiv-local-material-card-preview i {
  position: absolute;
  z-index: 2;
  top: 8px;
  right: 8px;
  padding: 3px 7px;
  border-radius: 999px;
  color: var(--on-orange);
  background: var(--orange);
  font-size: 10px;
  font-style: normal;
  font-weight: 800;
  line-height: 1.2;
}

.aiv-local-material-card-meta {
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: 7px 9px 9px;
  display: block;
  background: var(--bg3);
}

.aiv-local-material-card-meta span,
.aiv-local-material-card-meta strong {
  display: block;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-local-material-card-meta span {
  color: var(--text3);
  font-size: 10px;
  line-height: 1.3;
}

.aiv-local-material-card-meta strong {
  margin-top: 2px;
  color: var(--text);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.3;
}

.aiv-preview-outfit-pickers {
  display: grid;
  gap: 8px;
}

.aiv-preview-outfit-pickers .aiv-file-picker {
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 6px;
}

.aiv-preview-outfit-pickers .aiv-file-picker > div {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.aiv-preview-outfit-pickers .aiv-file-picker strong {
  color: var(--text);
  font-size: 12px;
}

.aiv-preview-outfit-pickers .aiv-file-picker span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text3);
  font-size: 11px;
}

.aiv-modal.aiv-modal-stacked {
  z-index: 90;
}

.aiv-local-material-summary {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.aiv-modal-panel.aiv-video-task-modal-panel {
  width: min(1240px, 100%);
  height: min(820px, calc(100vh - 48px));
  max-height: min(820px, calc(100vh - 48px));
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

.aiv-modal-foot-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
  flex: 0 0 auto;
}

.aiv-hh-mode-auto {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  align-items: baseline;
}

.aiv-hh-mode-auto > span {
  color: var(--text3);
  font-size: 11px;
}

.aiv-hh-mode-auto strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 750;
}

.aiv-hh-mode-auto small {
  grid-column: 1 / -1;
  color: var(--text3);
  font-size: 11px;
  line-height: 1.4;
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

/* 左操作栏 + 右图片区（对齐 AI 生视频） */
.aiv-modal-body.video-task {
  grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
  padding: 12px;
}

.aiv-modal-body.model-library {
  grid-template-columns: 190px minmax(0, 1fr);
  overflow: hidden;
  background: rgba(7, 8, 12, .20);
}

.aiv-model-filter-rail {
  padding: 16px 14px;
  border-right: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(255, 255, 255, .018), transparent 46%), var(--bg2);
  gap: 14px;
}

.aiv-picker-filter-group {
  display: grid;
  gap: 7px;
}

.aiv-picker-filter-group > strong {
  color: var(--text2);
  font-size: 11px;
  font-weight: 750;
}

.aiv-model-filter-rail .aiv-filter-chip-row {
  gap: 6px;
}

.aiv-model-filter-rail .aiv-chip {
  min-height: 26px;
  padding: 3px 8px;
  border-radius: 6px;
  transition: border-color .16s ease, background-color .16s ease, color .16s ease;
}

.aiv-model-filter-rail .aiv-filter-note {
  margin-top: 2px;
  line-height: 1.45;
}

.aiv-model-retry {
  justify-self: start;
}

.aiv-task-readiness {
  padding: 10px;
  border: 1px solid rgba(255, 107, 43, .32);
  border-radius: 8px;
  display: grid;
  gap: 8px;
  background: var(--orange-bg);
}

.aiv-task-readiness > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.aiv-task-readiness strong,
.aiv-task-readiness span {
  display: block;
}

.aiv-task-readiness span {
  color: var(--text2);
  font-size: 11px;
}

.aiv-task-readiness ul {
  margin: 0;
  padding: 0;
  display: grid;
  gap: 5px;
  list-style: none;
}

.aiv-task-readiness li {
  color: var(--text3);
  font-size: 11px;
}

.aiv-task-readiness li span {
  display: inline;
  margin-right: 5px;
  color: var(--text3);
}

.aiv-task-readiness li.complete,
.aiv-task-readiness li.complete span {
  color: var(--green);
}

.aiv-field-invalid {
  border-color: rgba(248, 113, 113, .68) !important;
}

.aiv-field-invalid > span:first-child {
  color: #fca5a5 !important;
}

.aiv-picker-head.aiv-field-invalid {
  background: rgba(248, 113, 113, .06);
}

.aiv-video-task-form {
  min-width: 0;
  min-height: 0;
  max-height: 100%;
  padding: 12px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  display: grid;
  align-content: start;
  gap: 10px;
  order: 0;
}

.aiv-video-task-selection {
  min-width: 0;
  min-height: 0;
  max-height: 100%;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  gap: 0;
  overflow: hidden;
  order: 1;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  padding: 10px;
}

.aiv-video-style-library {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  display: grid;
  gap: 8px;
}

.aiv-video-task-form .aiv-video-style-tabs {
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  max-height: 120px;
}

.aiv-video-task-form .aiv-video-style-tabs button {
  flex: 0 0 auto;
  width: 100%;
  min-height: 44px;
}

.aiv-video-style-library header strong,
.aiv-video-style-library header span {
  display: block;
}

.aiv-video-style-library header span {
  margin-top: 3px;
  color: var(--text3);
  font-size: 11px;
}

.aiv-video-style-tabs {
  min-width: 0;
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-gutter: stable;
}

.aiv-video-style-tabs button {
  flex: 0 0 170px;
  min-height: 52px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--text2);
  background: var(--bg3);
  text-align: left;
}

.aiv-video-style-tabs button.active {
  border-color: var(--orange);
  color: var(--text);
  background: var(--orange-bg);
  box-shadow: inset 0 0 0 1px var(--orange);
}

.aiv-video-style-tabs strong,
.aiv-video-style-tabs span {
  min-width: 0;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiv-video-style-tabs span {
  margin-top: 4px;
  color: var(--text3);
  font-size: 11px;
}

.aiv-video-task-picker {
  min-width: 0;
  min-height: 0;
  display: grid;
  /* head + status tabs + kind tabs + asset grid */
  grid-template-rows: auto auto auto minmax(0, 1fr);
  gap: 8px;
  overflow: hidden;
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

.aiv-video-task-asset-tabs,
.aiv-video-task-kind-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  flex: 0 0 auto;
  min-height: 0;
  /* 防止被 grid 1fr 行撑高后筛选项纵向分散 */
  align-content: flex-start;
  margin: 0;
  padding: 0;
}

.aiv-video-task-kind-tabs {
  margin-top: 0;
}

.aiv-video-asset-filter {
  flex: 0 0 auto;
  min-height: 28px;
  height: 28px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--text2);
  background: var(--bg3);
  font-size: 11px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
}

.aiv-video-asset-filter strong {
  margin-left: 4px;
  color: inherit;
}

.aiv-video-asset-filter.active {
  border-color: var(--orange);
  color: var(--orange);
  background: var(--orange-bg);
}

/* 独立缩略图网格：不复用 .aiv-video-asset-card，避免全局 grid/absolute 冲突导致条状堆叠 */
.aiv-vtask-grid {
  min-height: 0;
  height: 100%;
  padding: 2px 2px 4px 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  grid-auto-rows: min-content;
  gap: 10px;
  align-content: start;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.aiv-vtask-card {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: #101015;
  contain: layout paint;
}

.aiv-vtask-card.selected {
  border-color: var(--orange);
  box-shadow:
    0 0 0 2px var(--orange),
    0 0 0 5px rgba(255, 107, 43, 0.28);
}

.aiv-vtask-card.pending {
  border-style: dashed;
}

.aiv-vtask-card-hit {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  overflow: hidden;
  display: block;
}

.aiv-vtask-card-hit:disabled {
  cursor: default;
}

.aiv-vtask-card-img,
.aiv-vtask-card-ph {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  object-position: center center;
}

.aiv-vtask-card-ph {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text3);
  font-size: 11px;
  background: linear-gradient(145deg, #17171f, #0d0d12 55%, #1a1a22);
}

.aiv-vtask-card-selected {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 3;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 107, 43, 0.75);
  background: rgba(255, 107, 43, 0.95);
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}

.aiv-vtask-card-status {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 3;
  min-height: 20px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: rgba(20, 20, 24, 0.88);
  color: var(--text2);
  font-size: 10px;
  font-weight: 700;
  pointer-events: none;
}

.aiv-vtask-card-meta {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  padding: 22px 8px 8px;
  display: grid;
  gap: 2px;
  text-align: left;
  background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.72));
  pointer-events: none;
}

.aiv-vtask-card-meta strong,
.aiv-vtask-card-meta small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65);
}

.aiv-vtask-card-meta strong {
  font-size: 11px;
}

.aiv-vtask-card-meta small {
  font-size: 10px;
  opacity: 0.9;
}

.aiv-vtask-card-zoom {
  position: absolute;
  z-index: 4;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.26);
  border-radius: 6px;
  color: #fff;
  background: rgba(15, 17, 23, 0.82);
  display: none;
  place-items: center;
  cursor: pointer;
}

.aiv-vtask-card:hover .aiv-vtask-card-zoom,
.aiv-vtask-card:focus-within .aiv-vtask-card-zoom {
  display: grid;
}

.aiv-vtask-card:hover .aiv-vtask-card-status,
.aiv-vtask-card:focus-within .aiv-vtask-card-status {
  right: 40px;
}

.aiv-video-task-load-more {
  grid-column: 1 / -1;
  min-height: 40px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  color: var(--text2);
  background: var(--bg3);
  font-size: 12px;
  cursor: pointer;
}

.aiv-video-task-load-more:hover {
  border-color: var(--orange);
  color: var(--orange);
}

/* 生成方式：对齐 AI 生视频模型卡，侧栏三列简写 */
.aiv-provider-switcher {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  min-width: 0;
}

.aiv-provider-card {
  min-width: 0;
  min-height: 52px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text2);
  cursor: pointer;
  display: grid;
  align-content: center;
  gap: 0;
  text-align: left;
}

.aiv-provider-card.active {
  border-color: var(--orange);
  background: var(--orange-bg);
  color: var(--text);
  box-shadow: inset 0 0 0 1px var(--orange);
}

.aiv-provider-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  min-width: 0;
}

.aiv-provider-card-head strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 750;
  line-height: 1.25;
}

.aiv-provider-mark {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  object-fit: contain;
  background: rgba(255, 255, 255, 0.06);
}

/* 侧栏生成参数：复用生视频工作台能力，紧凑两列 */
.aiv-video-gen-params {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  display: grid;
  gap: 8px;
}

.aiv-video-gen-params-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.aiv-video-gen-params-head strong {
  font-size: 12px;
}

.aiv-video-gen-params-head span {
  color: var(--text3);
  font-size: 11px;
}

.aiv-video-gen-params-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.aiv-video-gen-params .aiv-field.compact {
  gap: 4px;
  min-width: 0;
}

.aiv-video-gen-params .aiv-field.compact > span {
  font-size: 11px;
  color: var(--text3);
}

.aiv-segmented {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  min-height: 32px;
}

.aiv-segmented button {
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--text2);
  background: var(--bg);
  font-size: 12px;
  font-weight: 600;
}

.aiv-segmented button.active {
  border-color: var(--orange);
  color: var(--orange);
  background: var(--orange-bg);
  box-shadow: inset 0 0 0 1px var(--orange);
}

.aiv-video-gen-params-hint {
  margin: 0;
  color: var(--text3);
  font-size: 11px;
  line-height: 1.45;
}

.aiv-video-task-empty {
  grid-column: 1 / -1;
  min-height: 180px;
  padding: 18px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  color: var(--text2);
  background: var(--bg);
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 7px;
  text-align: center;
}

.aiv-video-task-empty strong,
.aiv-video-task-empty span {
  display: block;
}

.aiv-video-task-empty span {
  max-width: 42ch;
  color: var(--text3);
  font-size: 11px;
  line-height: 1.5;
}

.aiv-modal-filter {
  display: grid;
  align-content: start;
  gap: 8px;
}

.aiv-model-grid-scroll {
  min-width: 0;
  min-height: 0;
  padding: 16px;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.aiv-model-grid,
.aiv-template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(156px, 1fr));
  gap: 12px;
}

.aiv-template-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.aiv-model-card,
.aiv-template-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg3);
  cursor: pointer;
  box-shadow: 0 6px 16px rgba(0, 0, 0, .12);
  transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease;
}

.aiv-model-card:hover,
.aiv-model-card:focus-visible {
  border-color: rgba(255, 107, 43, .56);
  box-shadow: 0 12px 24px rgba(0, 0, 0, .24), 0 0 0 1px rgba(255, 107, 43, .14);
  outline: none;
  transform: translateY(-2px);
}

.aiv-model-card.selected,
.aiv-template-card.selected {
  border-color: var(--orange);
  box-shadow: inset 0 0 0 2px var(--orange), 0 0 0 2px rgba(255, 107, 43, .14);
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
  transition: transform .24s ease, filter .24s ease;
}

.aiv-model-card:hover .aiv-model-image img,
.aiv-model-card:focus-visible .aiv-model-image img {
  filter: brightness(.93);
  transform: scale(1.025);
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

  .aiv-stage.aiv-stage-ai-edit-active {
    overflow: auto;
  }

  .aiv-material-stage {
    height: auto;
  }

  .aiv-edit-workbench {
    height: auto;
  }

  .aiv-edit-action-panel {
    grid-template-rows: auto auto auto;
  }

  .aiv-edit-action-panel .aiv-panel-body {
    overflow-y: visible;
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
  .aiv-workspace-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .aiv-edit-workbench .aiv-edit-source-row {
    grid-template-columns: 128px 20px minmax(0, 1fr);
    gap: 8px;
  }

  .aiv-edit-workbench .aiv-version-rail > .aiv-version-card {
    flex-basis: 132px;
  }

  .aiv-review-preview {
    position: static;
  }
}

@media (max-width: 980px) {
  .aiv-modal-body.video-task {
    grid-template-columns: minmax(0, 1fr);
    overflow: auto;
  }

  .aiv-video-task-form {
    order: 0;
    max-height: none;
  }

  .aiv-video-task-selection {
    order: 1;
    min-height: 420px;
  }

  .aiv-video-task-form,
  .aiv-video-task-assets.picker {
    overflow-y: visible;
  }
}

@media (max-width: 900px) {
  .aiv-modal {
    padding: 12px;
  }

  .aiv-preview-modal-panel {
    height: calc(100vh - 24px);
    max-height: calc(100vh - 24px);
  }

  .aiv-image-editor-layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
    overflow: hidden;
  }

  .aiv-image-editor-stage {
    min-height: 0;
  }

  .aiv-big-preview-frame {
    inset: 12px;
  }

  .aiv-image-editor-tools {
    max-height: 42vh;
    border-top: 1px solid var(--border);
    border-left: 0;
    overflow-y: auto;
  }

  .aiv-video-task-row {
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
  }

  .aiv-video-task-actions {
    max-width: none;
    justify-content: flex-start;
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

  .aiv-review-toolbar-actions {
    justify-content: flex-start;
  }

  .aiv-ai-asset-board {
    grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
  }

  .aiv-edit-workbench .aiv-edit-source-row {
    grid-template-columns: 112px 16px minmax(0, 1fr);
    padding: 8px;
    gap: 6px;
  }

  .aiv-edit-workbench .aiv-version-rail {
    gap: 6px;
  }

  .aiv-edit-workbench .aiv-version-rail > .aiv-version-card {
    flex-basis: 120px;
  }

  .aiv-edit-workbench .aiv-edit-lane-connector {
    width: 16px;
    height: 16px;
    font-size: 10px;
  }

  .aiv-result-card-grid {
    grid-template-columns: minmax(0, 360px);
    justify-content: center;
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
    margin-left: 0;
    white-space: normal;
  }

  .aiv-material-source-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .aiv-material-source-tabs {
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .aiv-review-undo {
    align-items: flex-start;
    flex-direction: column;
  }

  .aiv-video-toolbar-actions {
    grid-template-columns: repeat(2, max-content);
    justify-content: flex-start;
  }

  .aiv-batch-actions {
    justify-self: start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .aiv-workbench *,
  .aiv-workbench *::before,
  .aiv-workbench *::after {
    transition-duration: .01ms !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
  }
}
</style>
