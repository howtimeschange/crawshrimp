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
        @click="activeStep = step.id"
      >
        <span class="aiv-step-index">{{ step.index }}</span>
        <span class="aiv-step-copy">
          <strong>{{ step.title }}</strong>
          <small>{{ step.detail }}</small>
        </span>
      </button>
    </nav>

    <main class="aiv-stage" :inert="hasOpenModal ? '' : null" :aria-busy="materialIsRunning ? 'true' : 'false'">
      <section v-if="activeStep === 'materials'" class="aiv-stage-grid aiv-material-stage">
        <aside class="aiv-panel aiv-params-panel">
          <header class="aiv-panel-head">
            <div>
              <strong>森马云盘视频素材图下载</strong>
              <span>云盘找图 · 本地规整 · 可恢复任务</span>
            </div>
          </header>
          <div class="aiv-panel-body">
            <label class="aiv-field">
              <span>款号</span>
              <textarea v-model="styleCodes" rows="8"></textarea>
            </label>
            <label class="aiv-field">
              <span>云盘搜索根路径</span>
              <input v-model="cloudPath" />
            </label>
            <label class="aiv-field">
              <span>导出目录</span>
              <input v-model="materialOutputDir" />
            </label>
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
              <i class="aiv-progress-bar slim" :style="{ '--progress': `${materialTask.progress || 0}%` }"></i>
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

        <section class="aiv-panel">
          <header class="aiv-panel-head">
            <div>
              <strong>素材回显</strong>
              <span>按款号分组选择进入 AI 改图的模拍图和细节图</span>
            </div>
            <span class="aiv-badge orange">已选 {{ selectedMaterialCount }} / {{ materialSummary.modelCount + materialSummary.detailCount }}</span>
          </header>
          <div class="aiv-panel-body aiv-style-list">
            <article v-for="item in materialGroups" :key="item.styleCode" class="aiv-style-card">
              <button type="button" class="aiv-style-head aiv-collapse-head" @click="toggleMaterialGroup(item.styleCode)">
                <div class="aiv-style-title-block">
                  <div class="aiv-style-title-row">
                    <span :class="['aiv-collapse-icon', { expanded: isMaterialExpanded(item.styleCode) }]" aria-hidden="true"></span>
                    <strong>{{ item.styleCode }}</strong>
                    <span class="aiv-title-meta">{{ isMaterialExpanded(item.styleCode) ? '已展开' : '已收起' }} · 先确认模拍图，再确认细节图</span>
                  </div>
                </div>
                <div>
                  <span class="aiv-badge orange">模拍 {{ item.modelPhotos.length }}</span>
                  <span class="aiv-badge">细节 {{ item.detailPhotos.length }}</span>
                  <span class="aiv-collapse-mark">{{ isMaterialExpanded(item.styleCode) ? '收起' : '展开' }}</span>
                </div>
              </button>
              <div v-if="isMaterialExpanded(item.styleCode)" class="aiv-source-board compact">
                <section>
                  <div class="aiv-source-title">模拍图</div>
                  <div class="aiv-thumb-grid">
                    <article
                      v-for="asset in item.modelPhotos"
                      :key="asset.name"
                      :class="['aiv-thumb', { selected: asset.selected }]"
                    >
                      <button type="button" class="aiv-thumb-preview-button" @click="openImagePreview(asset, item.styleCode)">
                        <img
                          v-if="previewSourceFor(asset) && !brokenPreviews[previewSourceFor(asset)]"
                          :src="previewSourceFor(asset)"
                          :alt="asset.name"
                          @error="markPreviewBroken(previewSourceFor(asset))"
                        />
                        <template v-else>
                          <strong>{{ asset.role }}</strong>
                          <span>{{ asset.name }}</span>
                          <small>点击查看大图</small>
                        </template>
                      </button>
                      <button type="button" class="aiv-select-ribbon" @click.stop="toggleMaterialSelection(asset)">
                        {{ asset.selected ? '已选' : '选择' }}
                      </button>
                    </article>
                  </div>
                </section>
                <section>
                  <div class="aiv-source-title">细节图</div>
                  <div class="aiv-thumb-grid">
                    <article
                      v-for="asset in item.detailPhotos"
                      :key="asset.name"
                      :class="['aiv-thumb', { selected: asset.selected, muted: asset.muted }]"
                    >
                      <button type="button" class="aiv-thumb-preview-button" @click="openImagePreview(asset, item.styleCode)">
                        <img
                          v-if="previewSourceFor(asset) && !brokenPreviews[previewSourceFor(asset)]"
                          :src="previewSourceFor(asset)"
                          :alt="asset.name"
                          @error="markPreviewBroken(previewSourceFor(asset))"
                        />
                        <template v-else>
                          <strong>{{ asset.role }}</strong>
                          <span>{{ asset.name }}</span>
                          <small>点击查看大图</small>
                        </template>
                      </button>
                      <button type="button" class="aiv-select-ribbon" @click.stop="toggleMaterialSelection(asset)">
                        {{ asset.selected ? '已选' : '选择' }}
                      </button>
                    </article>
                  </div>
                </section>
                <section v-if="item.skippedRows?.length" class="aiv-source-issues">
                  <strong>已过滤 / 需复核</strong>
                  <span v-for="row in item.skippedRows.slice(0, 4)" :key="row.id">
                    {{ row.role }} · {{ row.name || row.action }} · {{ row.note || row.downloadResult }}
                  </span>
                </section>
              </div>
            </article>
            <div v-if="!materialGroups.length || !materialSummary.modelCount" class="aiv-empty-inline">
              输入款号后点击“开始找图并回显”，这里会按款号显示真实下载素材。
            </div>
          </div>
          <footer class="aiv-page-actions">
            <button type="button" class="aiv-primary" @click="activeStep = 'ai-edit'">进入 AI 改图</button>
          </footer>
        </section>
      </section>

      <section v-else-if="activeStep === 'ai-edit'" class="aiv-edit-workbench">
        <aside class="aiv-panel aiv-edit-action-panel">
          <header class="aiv-panel-head">
            <div>
              <strong>AI 改图动作</strong>
              <span>先选动作，再在右侧按款号挑原图</span>
            </div>
          </header>
          <div class="aiv-panel-body">
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

            <div v-if="activeAction === 'face_swap'" class="aiv-picked-row">
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

            <label class="aiv-field">
              <span>{{ activePromptLabel }}</span>
              <textarea v-model="aiPrompt" rows="6"></textarea>
            </label>

            <div class="aiv-generation-queue">
              <strong>待生成队列</strong>
              <span>{{ activeActionTitle }} · {{ selectedEditSourceCount }} 张原图 · {{ selectedEditVersionCount }} 个已选版本</span>
            </div>
            <div v-if="aiTaskState.error" class="aiv-inline-error">{{ aiTaskState.error }}</div>
            <div class="aiv-edit-selection-summary">
              <strong>当前已选 {{ selectedEditVersionCount }} 个 AI 结果版本</strong>
              <span>选中的版本会进入审核池，原图和未选版本保留在图片工作台。</span>
            </div>
            <button
              type="button"
              class="aiv-primary wide"
              :disabled="aiIsRunning"
              @click="startAiImageGeneration"
            >
              {{ aiIsRunning ? '正在生图...' : '开始生图' }}
            </button>
            <button type="button" class="aiv-ghost wide" @click="loadLatestReviewBatch">刷新审核池</button>
          </div>
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
              <button type="button" class="aiv-style-head aiv-collapse-head" @click="toggleMaterialGroup(style.styleCode)">
                <div class="aiv-style-title-block">
                  <div class="aiv-style-title-row">
                    <span :class="['aiv-collapse-icon', { expanded: isMaterialExpanded(style.styleCode) }]" aria-hidden="true"></span>
                    <strong>{{ style.styleCode }} 图片工作台</strong>
                    <span class="aiv-title-meta">{{ style.modelPhotos.length }} 张模拍 · {{ style.detailPhotos.length }} 张细节 · {{ style.generated.length }} 张 AI 图</span>
                  </div>
                </div>
                <div>
                  <span class="aiv-badge orange">原图 {{ editSourcesForStyle(style).length }}</span>
                  <span class="aiv-badge">版本 {{ versionCountForStyle(style) }}</span>
                  <span class="aiv-collapse-mark">{{ isMaterialExpanded(style.styleCode) ? '收起' : '展开' }}</span>
                </div>
              </button>

              <div v-if="isMaterialExpanded(style.styleCode)" class="aiv-edit-queue">
                <article
                  v-for="source in editSourcesForStyle(style)"
                  :key="source.name"
                  class="aiv-edit-source-row"
                >
                  <button type="button" class="aiv-original-card" @click="openImagePreview(source, style.styleCode)">
                    <img
                      v-if="previewSourceFor(source) && !brokenPreviews[previewSourceFor(source)]"
                      :src="previewSourceFor(source)"
                      :alt="source.name"
                      @error="markPreviewBroken(previewSourceFor(source))"
                    />
                    <span class="aiv-origin-label">原图</span>
                    <strong>{{ source.name }}</strong>
                    <small>{{ source.role }} · {{ style.styleCode }}</small>
                  </button>
                  <div class="aiv-version-rail">
                    <button
                      v-for="version in source.versions"
                      :key="version.id"
                      type="button"
                      :class="['aiv-version-card', { selected: version.selected, loading: version.status === 'running' }]"
                      @click="toggleVersionSelection(version)"
                      @dblclick="openImagePreview(version, style.styleCode)"
                    >
                      <span>{{ version.action }}</span>
                      <strong>{{ version.label }}</strong>
                      <small>{{ version.meta }}</small>
                      <i class="aiv-mini-progress" :style="{ '--progress': `${version.progress || 100}%` }"></i>
                    </button>
                    <button type="button" class="aiv-version-card add" @click="activeAction = 'background_swap'">
                      <strong>继续改这张</strong>
                    <small>换脸 / 换背景 / 换装 / 换姿势</small>
                  </button>
                  </div>
                </article>

                <section class="aiv-reference-strip">
                  <strong>细节参考</strong>
                  <button
                    v-for="asset in style.detailPhotos"
                    :key="asset.name"
                    type="button"
                    :class="['aiv-source-pill', { selected: asset.selected }]"
                    @click="toggleMaterialSelection(asset)"
                  >
                    {{ asset.role }} · {{ asset.name }}
                  </button>
                </section>
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
                  <span>{{ style.assets.length }} 张 AI 图 · {{ style.sourceAssets.length }} 张源图</span>
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
              <div><strong>3 款</strong><span>可建视频任务</span></div>
              <div><strong>{{ totalVideoAssetCount }} 张</strong><span>可选图片素材</span></div>
              <div><strong>{{ videoTasks.length }} 条</strong><span>已建视频任务</span></div>
            </div>
            <label class="aiv-field compact">
              <span>默认输出目录</span>
              <input v-model="videoOutputDir" />
            </label>
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
                <span :class="['aiv-badge', task.provider === 'seedance' ? 'orange' : '']">{{ providerLabel(task.provider) }}</span>
                <span :class="['aiv-badge', task.template ? 'orange' : '']">
                  {{ task.template ? task.template.title : '不选模板' }}
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
                <div><strong>生成方式</strong><span>{{ groupModeLabel(task.groupMode) }}</span></div>
                <div><strong>Prompt</strong><span>{{ task.prompt || '软件管家页面生成可不填写 Prompt' }}</span></div>
                <div><strong>输出目录</strong><span>{{ task.outputDir }}</span></div>
              </div>
              <div v-if="task.provider === 'seedance'" class="aiv-seedance-callout">
                <strong>Seedance 2.0</strong>
                <span>通过项目 AI 能力配置读取凭据；真人儿童图如触发隐私保护，则转为原创人物安全重试。</span>
                <small>真人儿童图如触发隐私保护，则转为文字描述服装、场景和动作生成原创人物版本。</small>
              </div>
              <div class="aiv-inline-actions">
                <button type="button" class="aiv-ghost small" @click="openVideoTaskDialog(task.styleCode)">复制新建</button>
                <button v-if="task.provider === 'qn'" type="button" class="aiv-ghost small" @click="openTemplateLibrary(task.styleCode)">查看模板</button>
                <button v-if="task.provider === 'seedance'" type="button" class="aiv-ghost small" @click="openAiCapabilitySettings">打开 AI 能力配置</button>
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
              <button type="button" class="aiv-ghost small" @click="activeStep = 'results'">刷新状态</button>
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
                  <p>{{ item.path }}</p>
                  <footer>
                    <button type="button" class="aiv-ghost small" @click="openVideoResult(item)">预览</button>
                    <button type="button" class="aiv-ghost small" @click="retryVideoResult(item)">重新下载</button>
                    <button type="button" class="aiv-primary small" @click="openVideoResult(item)">打开文件</button>
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
        class="aiv-preview-modal-panel"
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
        <div class="aiv-big-preview">
          <img
            v-if="previewImage.src && !brokenPreviews[previewImage.src]"
            :src="previewImage.src"
            :alt="previewImage.title"
            @error="markPreviewBroken(previewImage.src)"
          />
          <div v-else>
            <strong>{{ previewImage.title }}</strong>
            <span>{{ previewImage.meta }}</span>
          </div>
        </div>
      </section>
    </div>

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
            <button
              type="button"
              :class="['aiv-chip', { active: !modelGroupFilter }]"
              @click="modelGroupFilter = ''"
            >
              全部
            </button>
            <button
              v-for="group in modelGroups"
              :key="group.id"
              type="button"
              :class="['aiv-chip', { active: modelGroupFilter === group.id }]"
              @click="modelGroupFilter = group.id"
            >
              {{ group.label }}
            </button>
            <span v-if="modelLibraryState.loading" class="aiv-filter-note">加载模特库...</span>
            <span v-if="modelLibraryState.error" class="aiv-filter-note error">{{ modelLibraryState.error }}</span>
          </aside>
          <div class="aiv-model-grid">
            <article
              v-for="model in modelSamples"
              :key="model.id"
              :class="['aiv-model-card', { selected: selectedModel?.id === model.id }]"
              @click="selectedModel = model"
            >
              <div class="aiv-model-image">
                <img
                  v-if="!brokenPreviews[model.imageUrl || model.path]"
                  :src="model.imageUrl || localFileUrl(model.path)"
                  :alt="model.name"
                  @error="markPreviewBroken(model.imageUrl || model.path)"
                />
                <span v-else>{{ model.group }}</span>
              </div>
              <div>
                <strong>{{ model.groupLabel || model.group }}</strong>
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
            <strong id="aiv-template-title">软件管家模板库</strong>
            <span>模板可选；不选模板也可以把 AI 图上传软件管家直接生成</span>
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
              @click="selectedTemplateId = template.id"
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
              未读取到本地软件管家模板库。
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
            <span>一个款号可以创建多条视频任务；先选生成方式、款号、图片和 Prompt，再进入提交队列</span>
          </div>
          <button type="button" class="aiv-ghost small" @click="closeVideoTaskDialog">关闭</button>
        </header>
        <div class="aiv-modal-body video-task">
          <aside class="aiv-video-task-form">
            <label class="aiv-field">
              <span>款号</span>
              <select v-model="videoTaskDraft.styleCode" @change="resetVideoTaskDraftAssets">
                <option v-for="job in videoJobs" :key="job.styleCode" :value="job.styleCode">{{ job.styleCode }}</option>
              </select>
            </label>
            <label class="aiv-field">
              <span>生成方式</span>
              <select v-model="videoTaskDraft.provider">
                <option value="qn">软件管家页面生成</option>
                <option value="seedance">Seedance 2.0 API</option>
              </select>
            </label>
            <label class="aiv-field">
              <span>成片拆分</span>
              <select v-model="videoTaskDraft.groupMode">
                <option value="all_images_one_video">多张图进入一个视频任务</option>
                <option value="one_image_per_video">每张图单独生成一条视频</option>
                <option value="multi_slot_template">多张图进入同一个多槽位模板</option>
              </select>
            </label>
            <label class="aiv-field">
              <span>Prompt</span>
              <textarea
                v-model="videoTaskDraft.prompt"
                rows="4"
                :placeholder="videoTaskDraft.provider === 'qn' ? '软件管家页面生成可不填写 Prompt' : '描述服装、场景、动作和镜头要求'"
              ></textarea>
            </label>
            <label class="aiv-field">
              <span>输出目录</span>
              <input v-model="videoTaskDraft.outputDir" />
            </label>
            <div v-if="videoTaskDraft.provider === 'qn'" class="aiv-inline-actions">
              <button type="button" class="aiv-ghost small" @click="openTemplateLibrary(videoTaskDraft.styleCode)">选择软件管家模板</button>
              <button type="button" class="aiv-ghost small" @click="videoTaskDraft.templateId = ''">不选模板</button>
            </div>
            <div v-else class="aiv-seedance-callout">
              <strong>Seedance 2.0</strong>
              <span>通过项目 AI 能力配置读取凭据，预检通过后等待明确授权再生成。</span>
              <small>如触发隐私保护，改用服装、场景和动作文字描述生成原创人物版本。</small>
            </div>
          </aside>
          <section class="aiv-video-task-picker">
            <header class="aiv-picker-head">
              <div>
                <strong>{{ videoTaskDraft.styleCode }} 可选图片</strong>
                <span>可选已审核和未审核图片，卡片会保留审核状态标签</span>
              </div>
              <span class="aiv-badge orange">已选 {{ selectedVideoTaskAssetCount }}</span>
            </header>
            <div class="aiv-video-task-assets picker">
              <button
                v-for="asset in videoTaskSelectableAssets"
                :key="asset.id"
                type="button"
                :class="['aiv-video-asset-card', { selected: videoTaskDraft.assetIds.includes(asset.id), pending: asset.status !== 'approved' }]"
                @click="toggleVideoTaskDraftAsset(asset.id)"
                @dblclick="openImagePreview(asset, videoTaskDraft.styleCode)"
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
          </section>
        </div>
        <footer class="aiv-modal-foot">
          <span>{{ videoTaskDraft.provider === 'qn' ? '软件管家 Prompt 可空，模板可选' : 'Seedance 任务需要明确 Prompt' }}</span>
          <button type="button" class="aiv-ghost" @click="closeVideoTaskDialog">取消</button>
          <button type="button" class="aiv-primary" @click="createVideoTaskFromDraft">创建视频任务</button>
        </footer>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  BALA_AI_IMAGE_TASK_ID,
  BALA_AI_VIDEO_ADAPTER_ID,
  BALA_MATERIAL_PREPARE_TASK_ID,
  BALA_QN_VIDEO_TASK_ID,
  buildBalaAiStageRequest,
  buildBalaMaterialPrepareParams,
  collectVideoResultRows,
  collectDownloadedMaterialRows,
  isActiveWorkflowStatus,
  latestRunForTaskData,
  normalizeBalaMaterialGroups,
  normalizeBalaReviewBatchStyles,
  normalizeBalaReviewStatus,
  normalizeStyleCodeLines,
  normalizeBalaTemplateCatalog,
  normalizeBalaVideoResultRows,
  normalizeWorkflowStageStatus,
  parseBalaMaterialBoardUrl,
  parseBalaReviewBoardUrl,
  parseRunOutputFiles,
  summarizeBalaMaterialGroups,
} from '../utils/balaAiVideoWorkflow'

const emit = defineEmits(['open-settings'])

const activeStep = ref('materials')
const activeAction = ref('face_swap')
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
const brokenPreviews = reactive({})
const materialBatch = ref(null)
const materialBoardUrl = ref('')
const reviewBatch = ref(null)
const reviewBoardUrl = ref('')
const aiStageRequest = ref(null)
const videoTaskDraft = reactive({
  styleCode: '208326102205',
  provider: 'qn',
  groupMode: 'all_images_one_video',
  prompt: '',
  outputDir: '/Users/xingyicheng/Downloads/巴拉AI视频成片',
  templateId: '',
  assetIds: [],
})
const materialExpanded = reactive({
  '208326102205': true,
  '208326105214': true,
  '208326108104': false,
})

const styleCodes = ref('208326102205\n208326105214\n208326108104')
const cloudPath = ref('巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/')
const materialOutputDir = ref('/Users/xingyicheng/Downloads/巴拉AI视频素材')
const materialPackageName = ref('')
const aiPrompt = ref('保留童装版型和颜色，画面自然，无文字，无品牌外露风险。')
const videoOutputDir = ref('/Users/xingyicheng/Downloads/巴拉AI视频成片')
const garmentImagePaths = ref([])
const outfitReferencePaths = ref([])
const variantReferencePaths = ref([])
const materialTask = reactive({
  status: 'idle',
  message: '等待输入款号后开始找图',
  progress: 0,
  currentStyle: '',
  totalStyles: 0,
  completedStyles: 0,
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
const modelGroupFilter = ref('')
const templateLibraryState = reactive({
  loading: false,
  error: '',
  source: '',
})
const templateSamples = reactive([])
const templateFilter = ref('')

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
const materialSummary = computed(() => summarizeBalaMaterialGroups(materialGroups))
const selectedMaterialCount = computed(() => materialSummary.value.selectedCount)
const selectedEditSourceCount = computed(() => (
  styleWorkspaces.reduce((sum, style) => sum + editSourcesForStyle(style).length, 0)
))
const selectedEditVersionCount = computed(() => (
  styleWorkspaces.reduce((sum, style) => (
    sum + editSourcesForStyle(style).reduce((inner, source) => inner + (source.versions || []).filter(version => version.selected).length, 0)
  ), 0)
))

const modelGroups = computed(() => modelLibraryState.groups)
const modelSamples = computed(() => modelLibraryState.items)

const reviewStyles = reactive([])

const videoJobs = reactive([])
const videoTasks = reactive([])
const videoResults = reactive([])

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
  previewImage.value || modelLibraryOpen.value || templateLibraryOpen.value || videoTaskDialogOpen.value,
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
let videoPollTimer = null

function replaceStyleWorkspaces(groups = []) {
  styleWorkspaces.splice(0, styleWorkspaces.length, ...groups)
  for (const group of groups) {
    if (!Object.prototype.hasOwnProperty.call(materialExpanded, group.styleCode)) {
      materialExpanded[group.styleCode] = true
    }
  }
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

function normalizeModelLibraryItem(item = {}) {
  return {
    id: String(item.id || '').trim(),
    group: String(item.group || '').trim(),
    groupLabel: String(item.group_label || item.group || '').trim(),
    ageLabel: String(item.age_label || '').trim(),
    gender: String(item.gender || '').trim(),
    expression: String(item.expression || '').trim(),
    name: [item.age_label, item.gender, item.expression].filter(Boolean).join(' / '),
    label: [item.group_label || item.group, item.expression].filter(Boolean).join(' / '),
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
      group: modelGroupFilter.value || '',
    })
    const groupsPayload = payload?.groups && typeof payload.groups === 'object' ? payload.groups : {}
    modelLibraryState.groups = Object.entries(groupsPayload).map(([id, group]) => ({
      id,
      label: String(group?.label || id),
      ageLabel: String(group?.age_label || ''),
      gender: String(group?.gender || ''),
    }))
    modelLibraryState.items = (payload?.items || []).map(normalizeModelLibraryItem).filter(item => item.id)
    if (!selectedModel.value && modelLibraryState.items[0]) selectedModel.value = modelLibraryState.items[0]
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

watch(modelGroupFilter, () => {
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
  const total = Number(live?.search_total_codes || live?.total || 0)
  const completed = Number(live?.search_completed_codes || live?.current || 0)
  const downloaded = Number(live?.download_success || live?.records || 0)
  const failed = Number(live?.download_failed || 0)
  const explicitPercent = Number(live?.percent)
  const progress = Number.isFinite(explicitPercent) && explicitPercent > 0
    ? Math.max(0, Math.min(100, explicitPercent))
    : (total > 0 ? Math.round((Math.min(completed, total) / total) * 100) : materialTask.progress)
  updateMaterialTask({
    status,
    progress: status === 'done' ? 100 : progress,
    currentStyle: String(live?.buyer_id || live?.current_buyer_id || '').trim(),
    totalStyles: total,
    completedStyles: completed,
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
  updateMaterialTask({
    status: 'running',
    message: '正在提交素材下载任务...',
    progress: 0,
    currentStyle: '',
    totalStyles: normalizeStyleCodeLines(params.item_codes).length,
    completedStyles: 0,
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
    await new Promise(resolve => setTimeout(resolve, 600))
    const initial = await window.cs.getTaskStatus(BALA_AI_VIDEO_ADAPTER_ID, BALA_MATERIAL_PREPARE_TASK_ID)
    materialPollRunId = String(initial?.live?.run_id || initial?.last_run?.id || '').trim()
    updateMaterialTask({ runId: materialPollRunId })
    await pollMaterialTask()
  } catch (error) {
    updateMaterialTask({
      status: 'failed',
      error: error?.message || String(error),
      message: error?.message || String(error),
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
  const rows = await readRowsFromOutputFiles(outputFiles)
  const downloadedRows = collectDownloadedMaterialRows({ rows })
  let batch = null
  if (downloadedRows.length && typeof window.cs.createBalaMaterialBatch === 'function') {
    batch = await window.cs.createBalaMaterialBatch(downloadedRows, {
      adapter_id: BALA_AI_VIDEO_ADAPTER_ID,
      task_id: BALA_MATERIAL_PREPARE_TASK_ID,
      run_id: runId || materialTask.runId,
    })
    materialBatch.value = batch
    materialBoardUrl.value = String(batch?.board_url || '')
  }
  const groups = normalizeBalaMaterialGroups({
    batch,
    rows,
    fallbackCodes: normalizeStyleCodeLines(styleCodes.value),
  })
  replaceStyleWorkspaces(groups)
  const summary = summarizeBalaMaterialGroups(groups)
  const nextStatus = summary.failedCount > 0 ? 'partial' : 'done'
  updateMaterialTask({
    status: nextStatus,
    progress: 100,
    outputFiles,
    downloaded: summary.modelCount + summary.detailCount,
    failed: summary.failedCount,
    message: summary.styleCount
      ? `找图完成：${summary.styleCount} 个款号，${summary.modelCount} 张模拍，${summary.detailCount} 张细节。`
      : '找图完成，但没有可进入下一步的素材。',
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
  version.selected = !version.selected
}

function selectedMaterialAssetIds(options = {}) {
  return styleWorkspaces.flatMap(style => [
    ...(style.modelPhotos || []),
    ...(options.modelOnly ? [] : (style.detailPhotos || [])),
  ]).filter(asset => asset.selected && asset.id).map(asset => asset.id)
}

function selectedSourceAssetsForAi() {
  return styleWorkspaces.flatMap(style => (
    (style.modelPhotos || [])
      .filter(asset => asset.selected)
      .map(asset => ({ style, asset }))
  ))
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
    const sourceIds = selectedMaterialAssetIds({ modelOnly: true })
    await window.cs.saveBalaMaterialSelection(ref.batchId, ref.token, selectedIds)
    const exportResult = await window.cs.exportBalaAiInput(ref.batchId, ref.token, {
      operation_type: activeAction.value,
      selected_asset_ids: sourceIds,
      model_ref_ids: selectedModel.value ? [selectedModel.value.id] : [],
      background_prompt: activeAction.value === 'background_swap' ? aiPrompt.value : '',
      garment_images: activeAction.value === 'outfit_swap' ? { paths: garmentImagePaths.value } : { paths: [] },
      outfit_reference_images: activeAction.value === 'outfit_swap' ? { paths: outfitReferencePaths.value } : { paths: [] },
      variant_reference_images: activeAction.value === 'outfit_swap' ? { paths: variantReferencePaths.value } : { paths: [] },
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
    aiStageRequest.value = request
    const params = {
      ...request.params,
      generation_mode: 'submit_async',
      review_mode: 'create_review_batch',
      model: 'gpt-image-2',
      model_key_tier: '4k',
      image_size: '1536x2048',
      quality: 'high',
      output_format: 'png',
    }
    const result = await window.cs.runTask(
      request.adapterId || BALA_AI_VIDEO_ADAPTER_ID,
      request.taskId || BALA_AI_IMAGE_TASK_ID,
      params,
      {},
    )
    if (!result?.ok) throw new Error(result?.message || result?.error || 'AI 改图任务启动失败')
    await new Promise(resolve => setTimeout(resolve, 800))
    const initial = await window.cs.getTaskStatus(BALA_AI_VIDEO_ADAPTER_ID, BALA_AI_IMAGE_TASK_ID)
    aiPollRunId = String(initial?.live?.run_id || initial?.last_run?.id || '').trim()
    updateAiTaskState({ runId: aiPollRunId })
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
  await loadReviewBatchFromBoard(boardUrl)
  updateAiTaskState({
    status: 'done',
    message: `已回填审核池：${reviewSummary.value.pending} 张待审，${reviewSummary.value.approved} 张已通过。`,
  })
  activeStep.value = 'review'
}

async function loadReviewBatchFromBoard(boardUrl = reviewBoardUrl.value) {
  const ref = parseBalaReviewBoardUrl(boardUrl)
  if (!ref) throw new Error('审核池链接无效')
  const batch = await window.cs.getBalaReviewBatch(ref.batchId, ref.token)
  reviewBatch.value = batch
  reviewBoardUrl.value = boardUrl
  const styles = normalizeBalaReviewBatchStyles(batch)
  reviewStyles.splice(0, reviewStyles.length, ...styles)
  syncWorkspaceVersionsFromReviewStyles(styles)
  return batch
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
    throw new Error('还没有可刷新的审核池')
  } catch (error) {
    updateAiTaskState({ status: 'failed', error: error?.message || String(error), message: error?.message || String(error) })
  }
}

function syncWorkspaceVersionsFromReviewStyles(styles = reviewStyles) {
  for (const style of styleWorkspaces) {
    for (const source of style.modelPhotos || []) source.versions = []
  }
  for (const reviewStyle of styles || []) {
    const workspace = styleWorkspaces.find(item => item.styleCode === reviewStyle.styleCode)
    if (!workspace) continue
    for (const asset of reviewStyle.assets || []) {
      const source = (workspace.modelPhotos || []).find(item => (
        item.path && asset.sourcePath && item.path === asset.sourcePath
      )) || (workspace.modelPhotos || [])[0]
      if (!source) continue
      source.versions = Array.isArray(source.versions) ? source.versions : []
      source.versions.push({
        id: asset.id,
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
      })
    }
  }
}

function sendSelectedVersionsToReview() {
  const nextStyles = []
  for (const style of styleWorkspaces) {
    const assets = []
    for (const source of style.modelPhotos || []) {
      for (const version of source.versions || []) {
        if (!version.selected) continue
        assets.push({
          id: version.id,
          label: version.label,
          action: version.action,
          status: version.status === 'retry' ? 'retry' : 'pending',
          meta: version.meta || '',
          path: version.previewPath || version.path || source.path || '',
          sourcePath: source.path || '',
          sourceAssetId: source.id || '',
          operationType: version.operationType || activeAction.value,
        })
      }
    }
    if (!assets.length) continue
    nextStyles.push({
      styleCode: style.styleCode,
      assets,
      sourceAssets: [
        ...(style.modelPhotos || []).filter(asset => asset.selected),
        ...(style.detailPhotos || []).filter(asset => asset.selected),
      ],
    })
  }
  reviewStyles.splice(0, reviewStyles.length, ...nextStyles)
  if (!reviewStyles.length) {
    aiTaskState.status = 'failed'
    aiTaskState.error = '请先在图片工作台选择至少一个 AI 版本'
    aiTaskState.message = aiTaskState.error
    return
  }
  aiTaskState.status = 'done'
  aiTaskState.message = `已送审 ${reviewStyles.reduce((sum, style) => sum + style.assets.length, 0)} 张 AI 版本。`
  activeStep.value = 'review'
}

async function setReviewAssetStatus(asset, status) {
  const normalized = normalizeBalaReviewStatus(status)
  asset.status = normalized
  if (normalized === 'approved') asset.meta = `${asset.meta || asset.action} · 已通过`
  if (normalized === 'rejected') asset.meta = `${asset.meta || asset.action} · 已舍弃`
  try {
    const ref = parseBalaReviewBoardUrl(reviewBoardUrl.value)
    if (!ref) return
    const savedStatus = normalized === 'rejected' ? 'rejected' : normalized === 'approved' ? 'approved' : 'pending'
    const batch = await window.cs.saveBalaReviewDecisions(ref.batchId, ref.token, {
      [asset.id]: { status: savedStatus },
    })
    reviewBatch.value = batch
    const styles = normalizeBalaReviewBatchStyles(batch)
    reviewStyles.splice(0, reviewStyles.length, ...styles)
    syncWorkspaceVersionsFromReviewStyles(styles)
  } catch (error) {
    aiTaskState.status = 'failed'
    aiTaskState.error = error?.message || String(error)
    aiTaskState.message = aiTaskState.error
  }
}

async function setStyleReviewStatus(style, status) {
  const decisions = {}
  for (const asset of style.assets || []) {
    if (status === 'approved' || status === 'rejected') {
      asset.status = status
      decisions[asset.id] = { status }
    }
  }
  await saveReviewDecisions(decisions)
}

async function setPendingReviewStatus(status) {
  const decisions = {}
  for (const style of reviewStyles) {
    for (const asset of style.assets || []) {
      if (asset.status !== 'pending') continue
      asset.status = status
      decisions[asset.id] = { status }
    }
  }
  await saveReviewDecisions(decisions)
}

async function saveReviewDecisions(decisions = {}) {
  if (!Object.keys(decisions).length) return
  try {
    const ref = parseBalaReviewBoardUrl(reviewBoardUrl.value)
    if (!ref) return
    const batch = await window.cs.saveBalaReviewDecisions(ref.batchId, ref.token, decisions)
    reviewBatch.value = batch
    const styles = normalizeBalaReviewBatchStyles(batch)
    reviewStyles.splice(0, reviewStyles.length, ...styles)
    syncWorkspaceVersionsFromReviewStyles(styles)
  } catch (error) {
    aiTaskState.status = 'failed'
    aiTaskState.error = error?.message || String(error)
    aiTaskState.message = aiTaskState.error
  }
}

async function refreshReviewBatch() {
  try {
    const ref = parseBalaReviewBoardUrl(reviewBoardUrl.value)
    if (!ref) return
    const batch = await window.cs.refreshBalaReviewBatch(ref.batchId, ref.token)
    reviewBatch.value = batch
    const styles = normalizeBalaReviewBatchStyles(batch)
    reviewStyles.splice(0, reviewStyles.length, ...styles)
    syncWorkspaceVersionsFromReviewStyles(styles)
  } catch (error) {
    aiTaskState.status = 'failed'
    aiTaskState.error = error?.message || String(error)
    aiTaskState.message = aiTaskState.error
  }
}

async function requestReviewAssetRetry(asset) {
  asset.status = 'retry'
  asset.meta = `${asset.meta || asset.action} · 已请求重跑`
  try {
    const ref = parseBalaReviewBoardUrl(reviewBoardUrl.value)
    if (!ref) return
    const result = await window.cs.regenerateBalaReviewAsset(ref.batchId, ref.token, {
      asset_id: asset.id,
      prompt: asset.meta || '',
      submit_async: true,
    })
    const batch = result?.batch || await window.cs.refreshBalaReviewBatch(ref.batchId, ref.token)
    reviewBatch.value = batch
    const styles = normalizeBalaReviewBatchStyles(batch)
    reviewStyles.splice(0, reviewStyles.length, ...styles)
    syncWorkspaceVersionsFromReviewStyles(styles)
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
    const assets = []
    for (const asset of style.assets || []) {
      assets.push({
        id: `vasset-${asset.id}`,
        label: asset.label,
        kind: 'AI 图',
        status: asset.status === 'approved' ? 'approved' : asset.status === 'retry' ? 'retry' : 'pending',
        selected: asset.status === 'approved',
        path: asset.path,
      })
    }
    for (const asset of style.sourceAssets || []) {
      assets.push({
        id: `vasset-${style.styleCode}-source-${asset.id || asset.name}`,
        label: asset.name || asset.filename || '细节图',
        kind: asset.sourceType === 'model' ? '原始模拍' : '细节图',
        status: 'source',
        selected: false,
        path: asset.path,
        imageUrl: asset.imageUrl,
      })
    }
    const materialStyle = styleWorkspaces.find(item => item.styleCode === style.styleCode)
    for (const asset of [
      ...((materialStyle?.modelPhotos || []).filter(item => item.selected)),
      ...((materialStyle?.detailPhotos || []).filter(item => item.selected)),
    ]) {
      const id = `vasset-${style.styleCode}-material-${asset.id || asset.name}`
      if (assets.some(item => item.id === id || item.path === asset.path)) continue
      assets.push({
        id,
        label: asset.name || asset.filename || '素材图',
        kind: asset.sourceType === 'model' ? '原始模拍' : '细节图',
        status: 'source',
        selected: false,
        path: asset.path,
        imageUrl: asset.imageUrl,
      })
    }
    if (!assets.length) continue
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

async function downloadCompletedVideoResults() {
  const completed = videoResults.filter(item => item.status === '已完成')
  if (!completed.length) {
    videoStageState.status = 'failed'
    videoStageState.error = '还没有已完成的视频结果可下载'
    videoStageState.message = videoStageState.error
    activeStep.value = 'results'
    return
  }
  const firstLocal = completed.find(item => String(item.path || '').trim())
  if (firstLocal) {
    await openVideoResult(firstLocal)
  } else {
    await openOutputDir()
  }
  videoStageState.status = 'done'
  videoStageState.message = `已定位 ${completed.length} 个已完成视频，本地文件由生成任务下载归档。`
  activeStep.value = 'results'
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
    group_mode: task.groupMode === 'multi_slot_template' ? 'all_images_one_video' : task.groupMode,
    template_id: task.template?.id || task.templateId || '',
    template_match: task.template?.title || '',
    prompt: task.prompt || '',
    custom_prompt: task.prompt || '',
    output_dir: task.outputDir || videoOutputDir.value,
    download_template_previews: true,
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

async function finalizeQnVideoTask(task, runId = '', mode = 'plan') {
  const data = await window.cs.getData(BALA_AI_VIDEO_ADAPTER_ID, BALA_QN_VIDEO_TASK_ID)
  const run = latestRunForTaskData(data, runId)
  const outputFiles = parseRunOutputFiles(run?.output_files)
  const rows = collectVideoResultRows({ rows: await readVideoRowsFromOutputFiles(outputFiles) })
  const normalized = normalizeBalaVideoResultRows(rows, {
    ...task,
    providerLabel: providerLabel(task.provider),
  })
  if (normalized.length) {
    upsertVideoResults(normalized.map(item => ({
      ...item,
      id: `${task.id}-${item.id}`,
      provider: providerLabel(task.provider),
    })))
  } else {
    upsertVideoResults([{
      id: task.id,
      styleCode: task.styleCode,
      template: task.template?.title || '不选模板',
      provider: providerLabel(task.provider),
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
      await finalizeQnVideoTask(task, String(live.run_id || runId || ''), mode)
      return
    }
    const last = status?.last_run
    if (last && (!runId || String(last.id || '') === runId)) {
      const normalized = normalizeWorkflowStageStatus(last.status)
      if (['done', 'failed', 'stopped', 'partial'].includes(normalized)) {
        await finalizeQnVideoTask(task, String(last.id || runId || ''), mode)
        return
      }
    }
    await sleep(2000)
  }
  throw new Error('视频任务轮询超时')
}

async function runSeedanceVideoTask(task, mode = 'plan') {
  if (mode !== 'live') {
    task.status = '预检完成，等待授权生成'
    upsertVideoResults([{
      id: task.id,
      styleCode: task.styleCode,
      template: 'Seedance',
      provider: providerLabel(task.provider),
      taskId: '预检草稿',
      status: '待授权',
      progress: 0,
      path: task.outputDir || videoOutputDir.value,
    }])
    return
  }
  const prompt = String(task.prompt || '').trim()
  if (!prompt) throw new Error('Seedance 任务需要填写 Prompt')
  const result = await window.cs.runBalaSeedanceVideo({
    style_code: task.styleCode,
    prompt,
    image_paths: videoTaskImagePaths(task).slice(0, 4),
    output_dir: task.outputDir || videoOutputDir.value,
    ratio: '3:4',
    duration: 8,
    wait: true,
  })
  task.status = result?.local_video_path ? '已下载' : (result?.status || '已提交')
  upsertVideoResults([{
    id: task.id,
    styleCode: task.styleCode,
    template: 'Seedance',
    provider: providerLabel(task.provider),
    taskId: result?.task_id || '',
    status: result?.local_video_path ? '已完成' : (result?.status || '已提交'),
    progress: result?.local_video_path ? 100 : 80,
    path: result?.local_video_path || result?.video_url || task.outputDir || videoOutputDir.value,
    error: '',
  }])
  activeStep.value = 'results'
}

async function runVideoTask(task, mode = 'plan') {
  if (!task?.assets?.length) {
    videoStageState.status = 'failed'
    videoStageState.error = '视频任务缺少素材图片'
    videoStageState.message = videoStageState.error
    return
  }
  if (!videoTaskImagePaths(task).length) {
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
    } else {
      const params = buildQnVideoTaskParams(task, mode)
      const result = await window.cs.runTask(BALA_AI_VIDEO_ADAPTER_ID, BALA_QN_VIDEO_TASK_ID, params, {})
      if (!result?.ok) throw new Error(result?.message || result?.error || '视频任务启动失败')
      await sleep(800)
      const initial = await window.cs.getTaskStatus(BALA_AI_VIDEO_ADAPTER_ID, BALA_QN_VIDEO_TASK_ID)
      const runId = String(initial?.live?.run_id || initial?.last_run?.id || '').trim()
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
      styleCode: task.styleCode,
      template: task.template?.title || '不选模板',
      provider: providerLabel(task.provider),
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
  return (style?.modelPhotos || [])
    .filter(asset => asset.selected || (asset.versions || []).length)
    .map((asset) => {
      const versions = (asset.versions || []).filter(version => !showSelectedVersionsOnly.value || version.selected)
      return { ...asset, versions }
    })
    .filter(asset => !showSelectedVersionsOnly.value || asset.versions.length)
}

function versionCountForStyle(style) {
  return editSourcesForStyle(style).reduce((sum, source) => sum + (source.versions || []).length, 0)
}

function approvedVideoAssetCount(job) {
  return (job?.assets || []).filter(asset => asset.status === 'approved').length
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

function openImagePreview(asset, styleCode = '') {
  lastFocusedElement.value = document.activeElement
  const src = previewSourceFor(asset || {})
  previewImage.value = {
    title: asset?.label || asset?.name || '图片预览',
    meta: [styleCode, asset?.role || asset?.action, asset?.meta].filter(Boolean).join(' · '),
    path: String(asset?.path || asset?.previewPath || '').trim(),
    src,
  }
}

function providerLabel(provider) {
  return provider === 'seedance' ? 'Seedance 2.0' : '软件管家'
}

function groupModeLabel(mode) {
  if (mode === 'one_image_per_video') return '每张图单独生成一条视频'
  if (mode === 'multi_slot_template') return '多张图进入同一个多槽位模板'
  return '多张图进入一个视频任务'
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
  videoTaskDraft.assetIds = assets.filter(asset => asset.status === 'approved').map(asset => asset.id)
  if (!videoTaskDraft.assetIds.length && assets[0]?.id) {
    videoTaskDraft.assetIds = [assets[0].id]
  }
}

function openVideoTaskDialog(styleCode = '') {
  lastFocusedElement.value = document.activeElement
  videoTaskDraft.styleCode = styleCode || videoJobs[0]?.styleCode || ''
  videoTaskDraft.provider = 'qn'
  videoTaskDraft.groupMode = 'all_images_one_video'
  videoTaskDraft.prompt = ''
  videoTaskDraft.outputDir = videoOutputDir.value
  videoTaskDraft.templateId = ''
  resetVideoTaskDraftAssets()
  videoTaskDialogOpen.value = true
}

function toggleVideoTaskDraftAsset(assetId) {
  const index = videoTaskDraft.assetIds.indexOf(assetId)
  if (index >= 0) {
    videoTaskDraft.assetIds.splice(index, 1)
    return
  }
  videoTaskDraft.assetIds.push(assetId)
}

function createVideoTaskFromDraft() {
  const assets = videoTaskSelectableAssets.value.filter(asset => videoTaskDraft.assetIds.includes(asset.id))
  if (!videoTaskDraft.styleCode || !assets.length) {
    videoStageState.status = 'failed'
    videoStageState.error = '请先选择款号和至少一张素材图片'
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
    groupMode: videoTaskDraft.groupMode,
    prompt: videoTaskDraft.prompt.trim(),
    outputDir: videoTaskDraft.outputDir.trim() || videoOutputDir.value,
    template,
    status: '待预检',
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
  const target = String(item?.path || '').trim()
  if (!target) {
    videoStageState.status = 'failed'
    videoStageState.error = '该视频结果还没有本地文件'
    videoStageState.message = videoStageState.error
    return
  }
  try {
    await window.cs.openFile(target)
  } catch (error) {
    videoStageState.status = 'failed'
    videoStageState.error = error?.message || String(error)
    videoStageState.message = videoStageState.error
  }
}

async function retryVideoResult(item) {
  const task = videoTasks.find(candidate => candidate.id === item?.id || String(item?.id || '').startsWith(`${candidate.id}-`))
  if (task) await runVideoTask(task, 'live')
}

function openAiCapabilitySettings() {
  videoStageState.status = 'done'
  videoStageState.message = '请在抓虾 AI 能力配置中确认 Seedance / Ark 凭据；本页面不会保存密钥。'
  emit('open-settings')
}

function openModelLibrary() {
  lastFocusedElement.value = document.activeElement
  modelLibraryOpen.value = true
}

function closePreview() {
  previewImage.value = null
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
  if (previewImage.value) closePreview()
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

onMounted(() => {
  void loadModelLibrary()
  void loadTemplateCatalog()
})

onBeforeUnmount(() => {
  resetMaterialPoll()
  resetAiPoll()
  if (videoPollTimer) clearTimeout(videoPollTimer)
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

.aiv-edit-workbench {
  grid-template-columns: 320px minmax(0, 1fr);
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
  padding: 0;
  border: 0;
  color: var(--text);
  background: transparent;
  text-align: left;
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

.aiv-collapse-icon {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg3);
  display: grid;
  place-items: center;
}

.aiv-collapse-icon::before {
  content: "";
  width: 6px;
  height: 6px;
  border-right: 1px solid var(--text2);
  border-bottom: 1px solid var(--text2);
  transform: rotate(-45deg);
  transition: transform 0.16s ease;
}

.aiv-collapse-icon.expanded::before {
  transform: rotate(45deg);
}

.aiv-collapse-mark {
  min-height: 22px;
  padding: 3px 8px;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text2);
  background: var(--bg3);
  font-size: 11px;
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

.aiv-source-board.compact section,
.aiv-source-column {
  display: grid;
  gap: 8px;
}

.aiv-thumb-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
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
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  padding: 8px;
  overflow: hidden;
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

.aiv-thumb-preview-button {
  position: relative;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
}

.aiv-thumb-preview-button img,
.aiv-original-card img,
.aiv-ai-preview img,
.aiv-video-asset-card img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.aiv-thumb-preview-button::after,
.aiv-original-card::after,
.aiv-ai-preview::after,
.aiv-video-asset-card::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(180deg, transparent 45%, rgba(0, 0, 0, 0.62));
}

.aiv-thumb-preview-button strong,
.aiv-thumb-preview-button span,
.aiv-thumb-preview-button small,
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

.aiv-thumb-preview-button strong,
.aiv-thumb-preview-button span,
.aiv-thumb-preview-button small {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  align-self: stretch;
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
}
</style>
