<template>
  <section class="aiw-workbench aiw-option-3">
    <header class="aiw-topbar">
      <div>
        <p class="aiw-kicker">AI 生图</p>
        <h2>AI 生图工作台</h2>
        <p class="aiw-subtitle">支持主图、参考图、Prompt、比例尺寸联动和多模型生成</p>
      </div>
      <div class="aiw-top-actions">
        <button class="aiw-top-primary" type="button" @click="createNewTask">
          <span class="aiw-icon-button-content"><AiwIcon name="plus" />新建任务</span>
        </button>
        <button class="aiw-ghost" type="button" @click="openOutputFolder">
          <span class="aiw-icon-button-content"><AiwIcon name="folder" />打开输出文件夹</span>
        </button>
        <button class="aiw-ghost" type="button" @click="openSettings">
          <span class="aiw-icon-button-content"><AiwIcon name="settings" />配置</span>
        </button>
      </div>
    </header>

    <div class="aiw-main-grid">
      <aside class="aiw-prompt-panel aiw-task-panel">
        <div class="aiw-panel-head">
          <span>当前任务</span>
          <button type="button" @click="resetForm">
            <span class="aiw-icon-button-content"><AiwIcon name="rotate-ccw" />重置</span>
          </button>
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
            <div class="aiw-panel-actions">
              <button type="button" @click="openBatchGenerationDialog">
                <span class="aiw-icon-button-content"><AiwIcon name="wand" />批量生成</span>
              </button>
              <button type="button" @click="form.prompt = ''">
                <span class="aiw-icon-button-content"><AiwIcon name="eraser" />清空</span>
              </button>
            </div>
          </div>
          <textarea v-model.trim="form.prompt" placeholder="描述商品、卖点、模特姿态、背景和禁用元素..."></textarea>
        </section>

        <section
          class="aiw-material-box"
          :class="{ 'drag-over': dragOverTarget === 'main' }"
          @dragenter.prevent="dragOverTarget = 'main'"
          @dragover.prevent="handleResultDragOver"
          @dragleave="clearDragOver('main')"
          @drop.prevent="dropResultAsMain"
        >
          <div class="aiw-panel-head">
            <span>主图</span>
            <button type="button" @click="chooseMainImage">
              <span class="aiw-icon-button-content">
                <AiwIcon name="image" />{{ form.mainImagePath ? '重新选择' : '选择文件' }}
              </span>
            </button>
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
            <button type="button" @click="removeMainImage">
              <span class="aiw-icon-button-content"><AiwIcon name="trash" />移除</span>
            </button>
          </div>
        </section>

        <section
          class="aiw-material-box"
          :class="{ 'drag-over': dragOverTarget === 'reference' }"
          @dragenter.prevent="dragOverTarget = 'reference'"
          @dragover.prevent="handleResultDragOver"
          @dragleave="clearDragOver('reference')"
          @drop.prevent="dropResultAsReference"
        >
          <div class="aiw-panel-head">
            <span>参考图</span>
            <button type="button" @click="chooseReferenceImages">
              <span class="aiw-icon-button-content"><AiwIcon name="plus" />添加文件</span>
            </button>
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
              <button type="button" @click="removeReferencePath(index)">
                <span class="aiw-icon-button-content"><AiwIcon name="trash" />移除</span>
              </button>
            </article>
          </div>
        </section>

        <section class="aiw-material-box">
          <div class="aiw-panel-head">
            <span>下次生成参数</span>
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
              <span>{{ activeNanoBanana ? '分辨率' : '尺寸' }}</span>
              <select v-model="form.size" @change="syncRatioFromSize">
                <option v-for="size in sizeOptions" :key="size" :value="size">{{ size }}</option>
              </select>
            </label>
            <label v-if="!activeNanoBanana" class="aiw-field">
              <span>质量</span>
              <select v-model="form.quality">
                <option v-for="quality in activeQualityOptions" :key="quality" :value="quality">{{ quality }}</option>
              </select>
            </label>
            <label v-if="!activeNanoBanana" class="aiw-field">
              <span>格式</span>
              <select v-model="form.format">
                <option v-for="format in AI_IMAGE_FORMATS" :key="format" :value="format">{{ format.toUpperCase() }}</option>
              </select>
            </label>
            <label class="aiw-field">
              <span>张数</span>
              <input v-model.number="form.count" type="number" min="1" :max="activeNanoBanana ? 1 : 8" :disabled="activeNanoBanana" />
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
            <button type="button" @click="chooseOutputFolder">
              <span class="aiw-icon-button-content"><AiwIcon name="folder" />选择文件夹</span>
            </button>
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
          <button class="aiw-primary-action" type="button" :disabled="generating" @click="generate">
            <span class="aiw-icon-button-content"><AiwIcon name="wand" />{{ generateLabel }}</span>
          </button>
          <small v-if="errorMessage">{{ errorMessage }}</small>
        </section>
      </aside>

      <main class="aiw-results-grid" aria-label="生成结果" :aria-busy="generating ? 'true' : 'false'">
        <div class="aiw-workspace-head">
          <div>
            <strong>任务：{{ persistedCurrentJob?.title || form.title || '本次生成' }}</strong>
          </div>
          <div class="aiw-results-actions">
            <span>{{ selectedResultItems.length ? `已选 ${selectedResultItems.length} 张` : '未选择图片' }}</span>
            <button type="button" :disabled="!allVisibleSelectableItems.length" @click="selectAllVisibleResults">
              <span class="aiw-icon-button-content">
                <AiwIcon :name="allVisibleSelected ? 'minus-square' : 'check-square'" />{{ allVisibleSelected ? '取消全选' : '全选图片' }}
              </span>
            </button>
            <button type="button" :disabled="!selectedResultItems.length" @click="saveAs(selectedResultItems)">
              <span class="aiw-icon-button-content"><AiwIcon name="download" />下载选中</span>
            </button>
            <button
              class="aiw-task-sidebar-toggle"
              type="button"
              :class="{ active: taskSidebarOpen }"
              :aria-pressed="taskSidebarOpen ? 'true' : 'false'"
              @click="toggleTaskSidebar"
            >
              <span class="aiw-icon-button-content"><AiwIcon name="sidebar" />任务</span>
            </button>
          </div>
        </div>

        <div class="aiw-workspace-body" :class="{ 'history-collapsed': !taskSidebarOpen }">
          <section class="aiw-result-wall">
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
                <div v-if="queuePromptLine(queue)" class="aiw-result-prompt-row">
                  <button
                    class="aiw-prompt-preview-button"
                    type="button"
                    :title="queuePromptLine(queue)"
                    aria-label="查看完整 Prompt"
                    @click="openPromptDialog(queue)"
                  >
                    <span>{{ queuePromptPreview(queue) }}</span>
                    <strong><AiwIcon name="eye" />查看完整</strong>
                  </button>
                </div>
              </header>
              <div class="aiw-result-list">
                <article
                  v-for="item in queue.items"
                  :key="item.key || item.path || item.url"
                  class="aiw-result-card"
                  :class="{ selected: selectedResults.has(resultKey(item)), loading: item.loading, failed: item.failed }"
                  :aria-pressed="selectedResults.has(resultKey(item)) ? 'true' : 'false'"
                  :tabindex="item.loading || item.failed ? -1 : 0"
                  :draggable="!item.loading && !item.failed"
                  role="button"
                  @click="toggleResult(item)"
                  @dragstart.stop="startResultDrag(item, $event)"
                  @dragend="endResultDrag"
                  @keydown.enter.prevent="toggleResult(item)"
                  @keydown.space.prevent="toggleResult(item)"
                >
                  <button v-if="!item.loading && !item.failed" class="aiw-select-toggle" type="button" @click.stop="toggleResult(item)">
                    {{ selectedResults.has(resultKey(item)) ? '已选' : '选择' }}
                  </button>
                  <button
                    v-if="!item.loading && !item.failed"
                    class="aiw-preview-button"
                    type="button"
                    :draggable="!item.loading"
                    @click.stop="openLightbox(item)"
                    @dragstart.stop="startResultDrag(item, $event)"
                    @dragend="endResultDrag"
                  >
                    <img
                      v-if="resultPreviewSrc(item)"
                      :src="resultPreviewSrc(item)"
                      :alt="item.label"
                      loading="lazy"
                      decoding="async"
                      @load="handleResultPreviewLoaded(item)"
                      @error="markResultPreviewBroken(item)"
                    />
                    <span v-else class="aiw-result-preview">{{ item.label }}</span>
                  </button>
                  <div v-else-if="item.loading" class="aiw-loading-preview">
                    <img
                      v-if="loadingPreviewSrc(item)"
                      class="aiw-loading-source"
                      :src="loadingPreviewSrc(item)"
                      alt=""
                      aria-hidden="true"
                      @error="markPreviewBroken(item.loadingPreviewPath)"
                    />
                    <div v-else class="aiw-loading-default-art" aria-hidden="true">
                      <span class="aiw-loading-moon"></span>
                      <span class="aiw-loading-sea sea-back"></span>
                      <span class="aiw-loading-sea sea-front"></span>
                      <span class="aiw-loading-shrimp">🦐</span>
                      <small>CRAWSHRIMP STUDIO</small>
                    </div>
                    <span class="aiw-loading-sheen" aria-hidden="true"></span>
                    <div class="aiw-loading-copy">
                      <span class="aiw-loading-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                      <strong>{{ loadingMessage(item) }}</strong>
                      <small>{{ item.label }}</small>
                    </div>
                  </div>
                  <div v-else class="aiw-failed-preview">
                    <strong>生成失败</strong>
                    <span>{{ item.error || '1XM 任务执行失败' }}</span>
                  </div>
                  <footer v-if="!item.loading && !item.failed">
                    <div class="aiw-result-card-meta">
                      <strong>{{ item.label }}</strong>
                      <span>{{ item.model || activeModel.label }} · {{ item.size || form.size }}</span>
                    </div>
                    <div class="aiw-result-card-actions">
                      <button type="button" @click.stop="setAsMain(item)">
                        <span class="aiw-icon-button-content"><AiwIcon name="image" />设为主图</span>
                      </button>
                      <button type="button" @click.stop="addAsReference(item)">
                        <span class="aiw-icon-button-content"><AiwIcon name="plus" />设为参考</span>
                      </button>
                      <button type="button" @click.stop="openLightbox(item, { mode: 'edit' })">
                        <span class="aiw-icon-button-content"><AiwIcon name="edit" />修改</span>
                      </button>
                      <button type="button" @click.stop="saveAs([item])">
                        <span class="aiw-icon-button-content"><AiwIcon name="download" />下载</span>
                      </button>
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

          <aside v-if="taskSidebarOpen" class="aiw-history-sidebar">
            <div class="aiw-panel-head">
              <span>任务记录</span>
            </div>
            <ol>
              <li v-for="job in taskRecords" :key="job.job_uid">
                <button
                  class="aiw-history-item"
                  :class="{ active: highlightedJobUid === job.job_uid }"
                  type="button"
                  @click="selectTaskRecord(job)"
                >
                  <strong>{{ job.title || job.job_uid }}</strong>
                  <div v-if="taskPreviewItems(job).length" class="aiw-history-thumbs">
                    <span
                      v-for="item in taskPreviewItems(job)"
                      :key="item.key || resultKey(item)"
                      class="aiw-history-thumb"
                    >
                      <img
                        v-if="resultPreviewSrc(item)"
                        :src="resultPreviewSrc(item)"
                        :alt="item.label"
                        loading="lazy"
                        decoding="async"
                        @load="handleResultPreviewLoaded(item)"
                        @error="markResultPreviewBroken(item)"
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
      </main>
    </div>
    <div v-if="batchGenerationDialog.open" class="aiw-batch-dialog" @click.self="closeBatchGenerationDialog">
      <section class="aiw-batch-panel" role="dialog" aria-modal="true" aria-label="批量生成">
        <header class="aiw-batch-head">
          <div>
            <strong>批量生成</strong>
            <span>统一主图、参考图和模型参数，每条 Prompt 可单独设置生成张数。</span>
          </div>
          <button type="button" :disabled="batchGenerationDialog.submitting" @click="closeBatchGenerationDialog">
            <span class="aiw-icon-button-content"><AiwIcon name="x" />关闭</span>
          </button>
        </header>

        <div class="aiw-batch-board">
          <aside class="aiw-batch-source-column">
            <label class="aiw-field">
              <span>当前任务名称</span>
              <input
                v-model.trim="batchGenerationDialog.titlePrefix"
                type="text"
                placeholder="当前任务名称"
                :disabled="batchGenerationDialog.submitting"
              />
            </label>

            <section class="aiw-batch-source-box">
              <div class="aiw-panel-head">
                <span>主图</span>
                <button type="button" :disabled="batchGenerationDialog.submitting" @click="chooseBatchMainImage">
                  <span class="aiw-icon-button-content"><AiwIcon name="image" />{{ batchGenerationDialog.mainImagePath ? '替换' : '选择' }}</span>
                </button>
              </div>
              <button
                v-if="!batchGenerationDialog.mainImagePath"
                type="button"
                class="aiw-upload-tile compact"
                :disabled="batchGenerationDialog.submitting"
                @click="chooseBatchMainImage"
              >
                <strong>选择批量主图</strong>
                <span>所有 Prompt 默认共用这一张主图</span>
              </button>
              <div v-else class="aiw-picked-asset compact">
                <div class="aiw-thumb">
                  <img
                    v-if="imagePreviewSrc(batchGenerationDialog.mainImagePath)"
                    :src="imagePreviewSrc(batchGenerationDialog.mainImagePath)"
                    :alt="pathLabel(batchGenerationDialog.mainImagePath)"
                    @error="markPreviewBroken(batchGenerationDialog.mainImagePath)"
                  />
                  <div v-else class="aiw-preview-fallback">
                    <strong>{{ previewInitial(batchGenerationDialog.mainImagePath) }}</strong>
                  </div>
                </div>
                <div>
                  <strong>{{ pathLabel(batchGenerationDialog.mainImagePath) }}</strong>
                  <span>{{ batchGenerationDialog.mainImagePath }}</span>
                </div>
                <button type="button" :disabled="batchGenerationDialog.submitting" @click="batchGenerationDialog.mainImagePath = ''">
                  <span class="aiw-icon-button-content"><AiwIcon name="trash" />移除</span>
                </button>
              </div>
            </section>

            <section class="aiw-batch-source-box">
              <div class="aiw-panel-head">
                <span>参考图</span>
                <button type="button" :disabled="batchGenerationDialog.submitting" @click="chooseBatchReferenceImages">
                  <span class="aiw-icon-button-content"><AiwIcon name="plus" />添加</span>
                </button>
              </div>
              <button
                class="aiw-upload-tile compact"
                type="button"
                :disabled="batchGenerationDialog.submitting"
                @click="chooseBatchReferenceImages"
              >
                <strong>添加批量参考图</strong>
                <span>会随每条 Prompt 一起提交</span>
              </button>
              <div v-if="batchGenerationDialog.referenceImagePaths.length" class="aiw-batch-reference-list">
                <article
                  v-for="(path, index) in batchGenerationDialog.referenceImagePaths"
                  :key="`${path}-${index}`"
                  class="aiw-reference-card"
                >
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
                  <button type="button" :disabled="batchGenerationDialog.submitting" @click="removeBatchReferencePath(index)">
                    <span class="aiw-icon-button-content"><AiwIcon name="trash" />移除</span>
                  </button>
                </article>
              </div>
            </section>

            <section class="aiw-batch-source-box aiw-batch-settings-box">
              <div class="aiw-panel-head"><span>本次批量生成参数</span></div>
              <div class="aiw-batch-settings-grid">
                <label class="aiw-field aiw-field-wide">
                  <span>模型</span>
                  <select
                    v-model="batchGenerationDialog.modelId"
                    :disabled="batchGenerationDialog.submitting"
                    @change="syncBatchModelDefaults"
                  >
                    <option v-for="model in AI_IMAGE_MODELS" :key="model.id" :value="model.id">{{ model.label }}</option>
                  </select>
                </label>
                <label class="aiw-field">
                  <span>比例</span>
                  <select
                    v-model="batchGenerationDialog.ratio"
                    :disabled="batchGenerationDialog.submitting"
                    @change="syncBatchSizeFromRatio"
                  >
                    <option v-for="ratio in AI_IMAGE_RATIOS" :key="ratio" :value="ratio">{{ ratio }}</option>
                  </select>
                </label>
                <label class="aiw-field">
                  <span>{{ batchNanoBanana ? '分辨率' : '尺寸' }}</span>
                  <select
                    v-model="batchGenerationDialog.size"
                    :disabled="batchGenerationDialog.submitting"
                    @change="syncBatchRatioFromSize"
                  >
                    <option v-for="size in batchSizeOptions" :key="size" :value="size">{{ size }}</option>
                  </select>
                </label>
                <label v-if="!batchNanoBanana" class="aiw-field">
                  <span>质量</span>
                  <select v-model="batchGenerationDialog.quality" :disabled="batchGenerationDialog.submitting">
                    <option v-for="quality in batchQualityOptions" :key="quality" :value="quality">{{ quality }}</option>
                  </select>
                </label>
                <label v-if="!batchNanoBanana" class="aiw-field">
                  <span>格式</span>
                  <select v-model="batchGenerationDialog.format" :disabled="batchGenerationDialog.submitting">
                    <option v-for="format in AI_IMAGE_FORMATS" :key="format" :value="format">{{ format.toUpperCase() }}</option>
                  </select>
                </label>
                <div class="aiw-key-status aiw-field-wide" :class="{ missing: Boolean(batchMissingKey) }">
                  <span>Key 状态</span>
                  <strong>{{ batchMissingKey ? '未配置' : '可生成' }}</strong>
                </div>
              </div>
            </section>
          </aside>

          <main class="aiw-batch-prompt-board">
            <div class="aiw-batch-board-head">
              <div>
                <strong>Prompt 任务</strong>
                <span>{{ batchPromptStats.promptCount }} 条 Prompt，预计生成 {{ batchPromptStats.totalImages }} 张图</span>
              </div>
              <button type="button" :disabled="batchGenerationDialog.submitting || batchPromptCards.length >= MAX_BATCH_PROMPTS" @click="addBatchPromptCard">
                <span class="aiw-icon-button-content"><AiwIcon name="plus" />新增 Prompt</span>
              </button>
            </div>

            <div class="aiw-batch-prompt-rail">
              <article
                v-for="(card, index) in batchPromptCards"
                :key="card.id"
                class="aiw-batch-prompt-card"
              >
                <header>
                  <input
                    v-model.trim="card.title"
                    type="text"
                    :placeholder="`Prompt ${index + 1}`"
                    :disabled="batchGenerationDialog.submitting"
                  />
                  <button
                    type="button"
                    :disabled="batchGenerationDialog.submitting || batchPromptCards.length <= 1"
                    @click="removeBatchPromptCard(card)"
                  >
                    <span class="aiw-icon-button-content"><AiwIcon name="trash" />删除</span>
                  </button>
                </header>
                <textarea
                  v-model.trim="card.prompt"
                  placeholder="手动输入 Prompt，或从 Prompt 库选择"
                  :disabled="batchGenerationDialog.submitting"
                ></textarea>
                <label class="aiw-batch-count-field">
                  <span>生成张数</span>
                  <input
                    v-model.number="card.count"
                    type="number"
                    min="1"
                    :max="batchNanoBanana ? 1 : 8"
                    :disabled="batchGenerationDialog.submitting || batchNanoBanana"
                  />
                  <small v-if="batchNanoBanana">Nano Banana 每个任务固定生成 1 张</small>
                </label>
                <div class="aiw-batch-card-actions">
                  <button type="button" :disabled="batchGenerationDialog.submitting" @click="openBatchPromptLibraryPicker(card)">从 Prompt 库选择</button>
                  <span>状态：{{ card.prompt.trim() ? '待生成' : '待填写' }}</span>
                </div>
              </article>

              <button type="button" class="aiw-batch-add-card" :disabled="batchGenerationDialog.submitting || batchPromptCards.length >= MAX_BATCH_PROMPTS" @click="addBatchPromptCard">
                <strong>+ 新增 Prompt</strong>
                <span>增加一条待生成 Prompt</span>
              </button>
            </div>
          </main>
        </div>

        <footer class="aiw-batch-footer">
          <small v-if="batchGenerationDialog.error">{{ batchGenerationDialog.error }}</small>
          <span v-else>将在当前任务下提交 {{ batchPromptStats.promptCount }} 条生成记录，预计 {{ batchPromptStats.totalImages }} 张图；最多添加 20 条 Prompt。</span>
          <div>
            <button type="button" :disabled="batchGenerationDialog.submitting" @click="closeBatchGenerationDialog">取消</button>
            <button
              type="button"
              class="aiw-primary-action"
              :class="{ loading: batchGenerationDialog.submitting }"
              :disabled="batchGenerationDialog.submitting || !batchPromptCount"
              @click="submitBatchGeneration"
            >
              <span class="aiw-icon-button-content">
                <span v-if="batchGenerationDialog.submitting" class="aiw-edit-spinner" aria-hidden="true"></span>
                <AiwIcon v-else name="wand" />{{ batchGenerationDialog.submitting ? '提交批量任务...' : '开始批量生成' }}
              </span>
            </button>
          </div>
        </footer>
      </section>
    </div>

    <PromptLibraryPickerModal
      :open="batchPromptLibraryPicker.open"
      title="从 Prompt 库选择"
      :subtitle="batchPromptLibraryPicker.card?.title || '选中后会回填当前批量 Prompt。'"
      @close="closeBatchPromptLibraryPicker"
      @select="selectBatchPromptLibraryTemplate"
    />

    <div v-if="lightboxItem" class="aiw-lightbox" @click="closeLightbox">
      <section class="aiw-lightbox-layout" role="dialog" aria-modal="true" aria-label="图片预览和二次修改" @click.stop>
        <div class="aiw-lightbox-image-pane">
          <figure>
            <div class="aiw-lightbox-canvas" :class="{ loading: lightboxActiveItem?.loading }">
              <img
                v-if="lightboxActiveSrc"
                class="aiw-lightbox-main-image"
                :class="{ blurred: lightboxActiveItem?.loading }"
                :src="lightboxActiveSrc"
                :alt="lightboxActiveItem?.label || lightboxItem.label"
                decoding="async"
                @load="handleResultPreviewLoaded(lightboxActiveItem || lightboxItem)"
                @error="markResultPreviewBroken(lightboxActiveItem || lightboxItem)"
              />
              <TldrawAnnotationLayer
                v-if="lightboxActiveSrc && !lightboxActiveItem?.loading"
                class="aiw-lightbox-annotation-layer"
                :class="{ active: Boolean(lightboxAnnotationTool) }"
                :image-src="lightboxActiveSrc"
                :image-label="lightboxActiveItem?.label || lightboxItem.label"
                :active-tool="lightboxAnnotationTool"
                :annotation-color="lightboxAnnotationColor"
                :clear-nonce="lightboxAnnotationClearNonce"
                :export-nonce="lightboxAnnotationExportNonce"
                @export-annotation="captureLightboxAnnotation"
                @error="handleLightboxAnnotationError"
              />
              <div v-if="lightboxActiveItem?.loading || lightboxEditSubmitting" class="aiw-edit-loading-overlay">
                <span class="aiw-edit-spinner" aria-hidden="true"></span>
                <strong>{{ lightboxEditActionLabel }}</strong>
              </div>
              <div
                v-if="lightboxActiveSrc && !lightboxActiveItem?.loading"
                class="aiw-lightbox-annotation-toolbar"
                role="toolbar"
                aria-label="图片标注工具"
                @mousedown.stop
                @pointerdown.stop
                @click.stop
              >
                <div class="aiw-annotation-color-strip" aria-label="标注颜色">
                  <button
                    v-for="color in AIW_ANNOTATION_COLORS"
                    :key="color.id"
                    class="aiw-annotation-color-button"
                    type="button"
                    :class="{ active: lightboxAnnotationColor === color.id }"
                    :style="{ '--aiw-annotation-color': color.hex }"
                    :title="color.label"
                    :aria-label="`标注颜色：${color.label}`"
                    @click="setLightboxAnnotationColor(color.id)"
                  ></button>
                </div>
                <button
                  type="button"
                  :class="{ active: lightboxAnnotationTool === 'draw' }"
                  title="画笔"
                  @click="setLightboxAnnotationTool('draw')"
                >
                  <span class="aiw-icon-button-content"><AiwIcon name="brush" />画笔</span>
                </button>
                <button
                  type="button"
                  :class="{ active: lightboxAnnotationTool === 'arrow' }"
                  title="箭头"
                  @click="setLightboxAnnotationTool('arrow')"
                >
                  <span class="aiw-icon-button-content"><AiwIcon name="arrow" />箭头</span>
                </button>
                <button
                  type="button"
                  :class="{ active: lightboxAnnotationTool === 'text' }"
                  title="文字"
                  @click="setLightboxAnnotationTool('text')"
                >
                  <span class="aiw-icon-button-content"><AiwIcon name="text" />文字</span>
                </button>
                <button type="button" title="清除标注" @click="clearLightboxAnnotation">
                  <span class="aiw-icon-button-content"><AiwIcon name="eraser" />清除</span>
                </button>
                <button type="button" title="退出标注" @click="exitLightboxAnnotation">
                  <span class="aiw-icon-button-content"><AiwIcon name="x" />退出标注</span>
                </button>
              </div>
              <div v-if="!lightboxActiveSrc" class="aiw-lightbox-fallback">{{ lightboxActiveItem?.label || lightboxItem.label }}</div>
            </div>
            <figcaption>
              <strong>{{ lightboxActiveItem?.label || lightboxItem.label }}</strong>
              <span>{{ lightboxActiveItem?.model || activeModel.label }} · {{ lightboxActiveItem?.size || form.size }}</span>
            </figcaption>
            <div v-if="lightboxPreviewItems.length" class="aiw-lightbox-preview-strip" aria-label="大图预览切换">
              <button
                v-for="(item, index) in lightboxPreviewItems"
                :key="item.key || item.path || item.url || index"
                type="button"
                :class="{ active: index === lightboxActiveIndex, loading: item.loading }"
                @click="selectLightboxPreview(index)"
              >
                <img
                  v-if="lightboxThumbnailSrc(item)"
                  :src="lightboxThumbnailSrc(item)"
                  :alt="item.label"
                  :class="{ blurred: item.loading }"
                  loading="lazy"
                  decoding="async"
                  @load="handleResultPreviewLoaded(item)"
                  @error="markResultPreviewBroken(item)"
                />
                <strong v-else>{{ previewInitial(resultPreviewKey(item) || item.label) }}</strong>
                <span v-if="item.loading" class="aiw-edit-spinner" aria-hidden="true"></span>
                <small>{{ item.label }}</small>
              </button>
            </div>
          </figure>
        </div>
        <aside class="aiw-lightbox-edit-panel">
          <header>
            <div>
              <strong>进行下一步修改</strong>
              <span>{{ lightboxItem.label }}</span>
            </div>
            <button class="aiw-lightbox-close" type="button" @click="closeLightbox">
              <span class="aiw-icon-button-content"><AiwIcon name="x" />关闭</span>
            </button>
          </header>
          <section class="aiw-edit-source-prompt">
            <span>Prompt 修改链</span>
            <ol class="aiw-edit-prompt-chain">
              <li v-for="entry in lightboxPromptChain" :key="entry.key || `${entry.label}-${entry.prompt}`">
                <strong>{{ entry.label }}</strong>
                <p>{{ entry.prompt || '暂无 Prompt' }}</p>
              </li>
            </ol>
          </section>
          <label class="aiw-field">
            <span>新的修改提示词</span>
            <textarea v-model.trim="lightboxEditPrompt" placeholder="描述要保留、替换、增加或删掉的内容"></textarea>
          </label>
          <section class="aiw-edit-reference-box">
            <div class="aiw-panel-head">
              <span>参考图</span>
              <button type="button" @click="chooseLightboxEditReferences">
                <span class="aiw-icon-button-content"><AiwIcon name="plus" />上传参考图</span>
              </button>
            </div>
            <div v-if="lightboxEditReferencePaths.length" class="aiw-lightbox-reference-grid">
              <article
                v-for="(path, index) in lightboxEditReferencePaths"
                :key="`${path}-${index}`"
                class="aiw-reference-card"
              >
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
                <button type="button" @click="removeLightboxEditReference(index)">
                  <span class="aiw-icon-button-content"><AiwIcon name="trash" />移除</span>
                </button>
              </article>
            </div>
            <button v-else class="aiw-upload-tile compact" type="button" @click="chooseLightboxEditReferences">
              <strong>上传参考图</strong>
              <span>可选</span>
            </button>
          </section>
          <button
            class="aiw-primary-action"
            type="button"
            :class="{ loading: lightboxEditBusy }"
            :disabled="lightboxEditBusy"
            :aria-busy="lightboxEditBusy ? 'true' : 'false'"
            aria-label="开始二次修改"
            @click="submitLightboxEdit"
          >
            <span class="aiw-icon-button-content">
              <span v-if="lightboxEditBusy" class="aiw-edit-spinner" aria-hidden="true"></span>
              <AiwIcon v-else name="wand" />{{ lightboxEditActionLabel }}
            </span>
          </button>
          <small v-if="errorMessage">{{ errorMessage }}</small>
        </aside>
      </section>
    </div>
    <div v-if="promptDialogQueue" class="aiw-prompt-dialog" @click="closePromptDialog">
      <section role="dialog" aria-modal="true" aria-label="完整 Prompt" @click.stop>
        <header>
          <div>
            <strong>完整 Prompt</strong>
            <span>{{ promptDialogQueue.title || '生成队列' }}</span>
          </div>
          <button type="button" @click="closePromptDialog">
            <span class="aiw-icon-button-content"><AiwIcon name="x" />关闭</span>
          </button>
        </header>
        <pre>{{ promptDialogPrompt }}</pre>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, h, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  AI_IMAGE_FORMATS,
  AI_IMAGE_MODELS,
  AI_IMAGE_QUALITIES,
  AI_IMAGE_RATIOS,
  defaultAiImageForm,
  defaultSizeForRatio,
  getAiImageModel,
  isNanoBananaModel,
  missingKeyForModel,
  modelIdForJob,
  outputDirHint,
  qualityOptionsForModel,
  ratioForSize,
  sizeForModel,
  sizeForRatio,
  sizeOptionsForModel,
  sizesForRatio,
} from '../utils/aiImageModels.js'
import {
  mergeCurrentJobRecord,
  promptChainFromLineage,
  resolveResultLineage,
} from '../aiImageResultLineage.mjs'
import {
  AI_IMAGE_LOADING_MESSAGES,
  loadingMessageFor,
  resolveLoadingPreviewContext,
} from '../utils/aiImageLoadingState.mjs'
import {
  batchSettingsFromForm,
  loadingSlotIndexes,
  normalizeBatchPromptCount,
  summarizeBatchPrompts,
} from '../utils/aiImageBatchGeneration.mjs'
import TldrawAnnotationLayer from '../components/TldrawAnnotationLayer.js'
import PromptLibraryPickerModal from '../components/PromptLibraryPickerModal.vue'

const emit = defineEmits(['open-settings'])

const STORAGE_KEY = 'crawshrimp.aiImageWorkbench.state.v2'
const AUTOSAVE_DELAY_MS = 700
const MAX_BATCH_PROMPTS = 20
const AIW_ANNOTATION_PROMPT_GUIDANCE = '标注参考图仅用于定位需要修改的区域；请不要在结果中保留或复刻任何彩色标注线、框、箭头或文字。'
const AIW_ANNOTATION_COLORS = [
  { id: 'red', label: '红色', hex: '#ff3737' },
  { id: 'orange', label: '橙色', hex: '#ff802b' },
  { id: 'yellow', label: '黄色', hex: '#ffd43b' },
  { id: 'green', label: '绿色', hex: '#39b178' },
  { id: 'blue', label: '蓝色', hex: '#4263eb' },
  { id: 'white', label: '白色', hex: '#ffffff' },
  { id: 'black', label: '黑色', hex: '#111111' },
]
const AIW_ICON_NODES = {
  plus: [{ tag: 'path', attrs: { d: 'M12 5v14M5 12h14' } }],
  folder: [
    { tag: 'path', attrs: { d: 'M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z' } },
  ],
  settings: [
    { tag: 'path', attrs: { d: 'M12 3v3M12 18v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M3 12h3M18 12h3M4.9 19.1 7 17M17 7l2.1-2.1' } },
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '3.5' } },
  ],
  'rotate-ccw': [
    { tag: 'path', attrs: { d: 'M4 7v5h5' } },
    { tag: 'path', attrs: { d: 'M5.2 16A7 7 0 1 0 6 7.5L4 12' } },
  ],
  eraser: [
    { tag: 'path', attrs: { d: 'm7 21 10-10a3 3 0 0 0 0-4l-2-2a3 3 0 0 0-4 0L3 13a3 3 0 0 0 0 4l4 4Z' } },
    { tag: 'path', attrs: { d: 'm14 14-5-5M7 21h14' } },
  ],
  brush: [
    { tag: 'path', attrs: { d: 'M9.5 16.5 5 21l-2-2 4.5-4.5' } },
    { tag: 'path', attrs: { d: 'M14 4.5 19.5 10 11 18.5 5.5 13 14 4.5Z' } },
    { tag: 'path', attrs: { d: 'm15 6 3 3' } },
  ],
  arrow: [
    { tag: 'path', attrs: { d: 'M7 17 17 7' } },
    { tag: 'path', attrs: { d: 'M9 7h8v8' } },
  ],
  text: [
    { tag: 'path', attrs: { d: 'M5 5h14M12 5v14M8 19h8' } },
  ],
  sidebar: [
    { tag: 'rect', attrs: { x: '4', y: '5', width: '16', height: '14', rx: '2' } },
    { tag: 'path', attrs: { d: 'M14 5v14' } },
    { tag: 'path', attrs: { d: 'M7 9h4M7 13h4' } },
  ],
  image: [
    { tag: 'rect', attrs: { x: '4', y: '5', width: '16', height: '14', rx: '2' } },
    { tag: 'circle', attrs: { cx: '9', cy: '10', r: '1.5' } },
    { tag: 'path', attrs: { d: 'm6.5 17 4.5-4.5 3 3 2-2 2.5 3.5' } },
  ],
  trash: [
    { tag: 'path', attrs: { d: 'M5 7h14M10 11v6M14 11v6M9 7l1-2h4l1 2M7 7l1 13h8l1-13' } },
  ],
  wand: [
    { tag: 'path', attrs: { d: 'm4 20 11-11M13 5l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3ZM19 3l.5 1.5L21 5l-1.5.5L19 7l-.5-1.5L17 5l1.5-.5L19 3Z' } },
  ],
  'check-square': [
    { tag: 'rect', attrs: { x: '4', y: '4', width: '16', height: '16', rx: '2' } },
    { tag: 'path', attrs: { d: 'm8 12 2.5 2.5L16 9' } },
  ],
  'minus-square': [
    { tag: 'rect', attrs: { x: '4', y: '4', width: '16', height: '16', rx: '2' } },
    { tag: 'path', attrs: { d: 'M8 12h8' } },
  ],
  download: [
    { tag: 'path', attrs: { d: 'M12 4v10M8 10l4 4 4-4M5 20h14' } },
  ],
  edit: [
    { tag: 'path', attrs: { d: 'M4 20h4l10.5-10.5a2.1 2.1 0 0 0 0-3L17.5 5.5a2.1 2.1 0 0 0-3 0L4 16v4Z' } },
    { tag: 'path', attrs: { d: 'm13.5 6.5 4 4' } },
  ],
  eye: [
    { tag: 'path', attrs: { d: 'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z' } },
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '2.5' } },
  ],
  x: [{ tag: 'path', attrs: { d: 'M6 6l12 12M18 6 6 18' } }],
}
const AiwIcon = {
  props: {
    name: { type: String, required: true },
  },
  setup(props) {
    return () => h(
      'svg',
      {
        class: 'aiw-button-icon',
        viewBox: '0 0 24 24',
        'aria-hidden': 'true',
        focusable: 'false',
      },
      (AIW_ICON_NODES[props.name] || AIW_ICON_NODES.plus).map((node, index) => h(node.tag, { ...node.attrs, key: index })),
    )
  },
}

const form = reactive(defaultAiImageForm())
const jobs = ref([])
const settings = ref({})
const currentJob = ref(null)
const selectedResults = reactive(new Set())
const taskSidebarOpen = ref(true)
const generating = ref(false)
const errorMessage = ref('')
const logs = ref([])
const loadingMessageTick = ref(0)
const imagePreviews = reactive({})
const previewFailures = reactive(new Set())
const resultCachePaths = reactive({})
const resultCachePending = reactive(new Set())
const taskDrafts = reactive({})
const pendingActiveJobUid = ref('')
const lightboxItem = ref(null)
const lightboxEditPrompt = ref('')
const lightboxEditReferencePaths = ref([])
const lightboxEditResults = ref([])
const lightboxEditSubmitting = ref(false)
const lightboxActiveIndex = ref(0)
const lightboxMode = ref('preview')
const lightboxAnnotationDataUrl = ref('')
const lightboxAnnotationTool = ref('draw')
const lightboxAnnotationColor = ref('red')
const lightboxAnnotationClearNonce = ref(0)
const lightboxAnnotationExportNonce = ref(0)
const promptDialogQueue = ref(null)
const batchGenerationDialog = reactive({
  open: false,
  submitting: false,
  error: '',
  titlePrefix: '',
  mainImagePath: '',
  referenceImagePaths: [],
  modelId: '',
  ratio: '1:1',
  size: '',
  quality: 'auto',
  format: 'png',
  prompts: [],
})
const batchPromptLibraryPicker = reactive({
  open: false,
  card: null,
})
const draggingResultKey = ref('')
const dragOverTarget = ref('')
let autosaveTimer = null
let restoringState = false
let lightboxAnnotationExportResolve = null
let lightboxAnnotationExportReject = null
let lightboxAnnotationExportTimer = null
let resultCacheQueue = Promise.resolve()
let jobPollingTimer = null
let jobPollingUid = ''
let jobPollingInFlight = false
let loadingMessageTimer = null

const activeModel = computed(() => getAiImageModel(form.modelId))
const activeNanoBanana = computed(() => isNanoBananaModel(form.modelId))
const activeMissingKey = computed(() => missingKeyForModel(form.modelId, settings.value))
const batchActiveModel = computed(() => getAiImageModel(batchGenerationDialog.modelId || form.modelId))
const batchNanoBanana = computed(() => isNanoBananaModel(batchActiveModel.value.id))
const batchSizeOptions = computed(() => sizeOptionsForModel(batchActiveModel.value.id, batchGenerationDialog.ratio))
const batchQualityOptions = computed(() => qualityOptionsForModel(batchActiveModel.value.id))
const batchMissingKey = computed(() => missingKeyForModel(batchActiveModel.value.id, settings.value))
const activeJobUid = computed(() => currentJob.value?.job_uid || '')
const persistedCurrentJob = computed(() => mergeCurrentJobRecord(currentJob.value, jobs.value))
const highlightedJobUid = computed(() => pendingActiveJobUid.value || activeJobUid.value)
const resultQueues = computed(() => collectResultQueues(currentJob.value))
const resultCards = computed(() => resultQueues.value.flatMap((queue) => queue.items || []))
const loadingResultCards = computed(() => {
  if (!generating.value) return []
  const count = normalizeImageCount(form.count)
  const context = resolveLoadingPreviewContext(currentJob.value || {}, {}, {
    mainImagePath: form.mainImagePath,
    referenceImagePaths: form.referenceImagePaths,
  })
  return Array.from({ length: count }, (_, index) => ({
    key: `loading-${index + 1}`,
    label: `生成中 ${index + 1}`,
    loadingPreviewPath: context.previewPath,
    loadingMode: context.mode,
    loadingMessageOffset: index,
    loading: true,
  }))
})
const loadingResultQueue = computed(() => ({
  key: 'loading-current-run',
  title: '正在生成',
  createdAt: '',
  prompt: currentJob.value?.prompt || form.prompt,
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
const sizeOptions = computed(() => sizeOptionsForModel(form.modelId, form.ratio))
const activeQualityOptions = computed(() => qualityOptionsForModel(form.modelId))
const selectedResultItems = computed(() => resultCards.value.filter((item) => selectedResults.has(resultKey(item))))
const generateLabel = computed(() => activeMissingKey.value ? '配置' : generating.value ? '生成中...' : '开始生成')
const batchPromptCards = computed(() => batchGenerationDialog.prompts)
const batchPromptStats = computed(() => summarizeBatchPrompts(batchPromptCards.value, {
  forceSingle: batchNanoBanana.value,
}))
const batchPromptCount = computed(() => batchPromptStats.value.promptCount)
const lightboxSrc = computed(() => lightboxItem.value ? resultPreviewSrc(lightboxItem.value) : '')
const lightboxEditBusy = computed(() => generating.value || lightboxEditSubmitting.value)
const lightboxEditActionLabel = computed(() => lightboxEditBusy.value ? '修改图生成中...' : '开始二次修改')
const lightboxPreviewItems = computed(() => {
  if (!lightboxItem.value) return []
  return dedupeLightboxItems([
    ...lightboxHistoryItems(lightboxItem.value),
    lightboxItem.value,
    ...lightboxEditResults.value,
  ])
})
const lightboxActiveItem = computed(() => {
  const items = lightboxPreviewItems.value
  if (!items.length) return null
  const index = Math.min(Math.max(lightboxActiveIndex.value, 0), items.length - 1)
  return items[index] || items[0] || null
})
const lightboxActiveSrc = computed(() => lightboxThumbnailSrc(lightboxActiveItem.value))
const lightboxSourcePrompt = computed(() => String(
  latestPromptForItem(lightboxActiveItem.value || lightboxItem.value) || currentJob.value?.prompt || form.prompt || '',
).trim())
const lightboxPromptChain = computed(() => promptChainForItem(lightboxActiveItem.value || lightboxItem.value))
const promptDialogPrompt = computed(() => queuePromptText(promptDialogQueue.value))
const taskRecords = computed(() => {
  const records = []
  const seen = new Set()
  for (const job of jobs.value) {
    const jobUid = job?.job_uid
    if (!jobUid || seen.has(jobUid)) continue
    const source = jobUid === activeJobUid.value && currentJob.value?.job_uid === jobUid
      ? { ...job, ...currentJob.value }
      : job
    records.push(mergeJobWithDraft(source, { includeGeneratedDrafts: false }))
    seen.add(jobUid)
  }
  if (currentJob.value?.job_uid && !seen.has(currentJob.value.job_uid)) {
    records.unshift(mergeJobWithDraft(currentJob.value, { includeGeneratedDrafts: false }))
    seen.add(currentJob.value.job_uid)
  }
  return records
})
onMounted(async () => {
  restorePersistedWorkbench()
  await Promise.all([loadSettings(), loadJobs()])
  await restoreInitialTask()
  if (hasActiveRuns(currentJob.value)) startJobPolling(currentJob.value?.job_uid)
  loadingMessageTimer = setInterval(() => {
    if (visibleResultCards.value.some((item) => item.loading)) {
      loadingMessageTick.value = (loadingMessageTick.value + 1) % AI_IMAGE_LOADING_MESSAGES.length
    }
  }, 2400)
})

onBeforeUnmount(() => {
  if (autosaveTimer) clearTimeout(autosaveTimer)
  if (loadingMessageTimer) clearInterval(loadingMessageTimer)
  stopJobPolling()
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
  refreshResultPreviewCandidates(cards)
  cards.forEach((card) => queueResultCache(card))
})

watch(visibleResultCards, (cards) => {
  cards.forEach((item) => {
    if (item.loading && item.loadingPreviewPath) void refreshImagePreview(item.loadingPreviewPath)
  })
})

watch(taskRecords, (records) => {
  records.forEach((job) => {
    refreshResultPreviewCandidates(taskPreviewItems(job))
  })
})

watch(form, () => {
  if (restoringState) return
  saveDraftForCurrentTask()
  persistWorkbenchState()
  scheduleTaskAutosave()
}, { deep: true })

watch([currentJob, taskSidebarOpen], () => {
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
    referenceImagePaths: filterGeneratedAnnotationReferences(snapshot.referenceImagePaths),
  }
  Object.assign(form, next)
}

function isGeneratedAnnotationReferencePath(path) {
  const filename = String(path || '').split(/[\\/]/).pop().toLowerCase()
  return /^annotation(?:-|_)/.test(filename)
}

function filterGeneratedAnnotationReferences(paths = []) {
  return (Array.isArray(paths) ? paths : [])
    .map((path) => String(path || '').trim())
    .filter((path) => path && !isGeneratedAnnotationReferencePath(path))
}

function clearSubmittedTaskInputs(snapshot = formSnapshot()) {
  restoringState = true
  applyFormSnapshot({
    ...snapshot,
    prompt: '',
    mainImagePath: '',
    referenceImagePaths: [],
  })
  restoringState = false
  saveDraftForCurrentTask({ submittedInputsCleared: true })
  persistWorkbenchState()
}

function saveDraftForCurrentTask(extra = {}) {
  const key = activeJobUid.value || 'latest'
  const existing = taskDrafts[key] || {}
  taskDrafts[key] = {
    ...formSnapshot(),
    ...(existing.submittedInputsCleared ? { submittedInputsCleared: true } : {}),
    ...extra,
  }
}

function mergeJobWithDraft(job = {}, options = {}) {
  if (!options.includeGeneratedDrafts && hasGeneratedResults(job)) return job
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
      ...Object.fromEntries(Object.entries(draftParams).filter(([key, value]) => (
        value !== undefined && (key === 'main_image_path' || value !== '')
      ))),
    },
  }
}

function hasGeneratedResults(job = {}) {
  const summary = job.summary && typeof job.summary === 'object' ? job.summary : {}
  const runs = Array.isArray(summary.runs) ? summary.runs : []
  if (runs.some((run) => (
    Array.isArray(run?.image_urls) && run.image_urls.length
  ) || (
    Array.isArray(run?.output_files) && run.output_files.length
  ))) {
    return true
  }
  if (Array.isArray(summary.image_urls) && summary.image_urls.length) return true
  if (Array.isArray(summary.output_files) && summary.output_files.length) return true
  return Array.isArray(job.assets) && job.assets.some((asset) => asset.kind === 'output' || asset.kind === 'result')
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
    if (typeof saved?.taskSidebarOpen === 'boolean') taskSidebarOpen.value = saved.taskSidebarOpen
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
      taskSidebarOpen: taskSidebarOpen.value,
      logs: logs.value.slice(-80),
    }))
  } catch {}
}

async function restoreInitialTask() {
  if (activeJobUid.value) {
    const matching = jobs.value.find((job) => job.job_uid === activeJobUid.value) || currentJob.value
    const restored = await restoreJob(matching, { preserveCurrentDraft: false })
    if (restored) return
    if (jobs.value[0]) await restoreJob(jobs.value[0], { preserveCurrentDraft: false })
    return
  }
  if (jobs.value[0]) await restoreJob(jobs.value[0], { preserveCurrentDraft: false })
}

function syncModelDefaults() {
  const model = activeModel.value
  form.model_key = model.key
  form.model_key_tier = model.keyTier
  form.size = sizeForModel(model.id, form.ratio, model.size)
  if (activeNanoBanana.value) {
    form.count = 1
    return
  }
  if (!activeQualityOptions.value.includes(form.quality)) form.quality = activeQualityOptions.value[0] || 'auto'
  syncRatioFromSize()
}

function syncSizeFromRatio() {
  form.size = sizeForModel(form.modelId, form.ratio, form.size)
}

function syncRatioFromSize() {
  if (activeNanoBanana.value) return
  form.ratio = ratioForSize(form.size, form.ratio)
}

function syncBatchModelDefaults() {
  const model = batchActiveModel.value
  batchGenerationDialog.size = sizeForModel(model.id, batchGenerationDialog.ratio, model.size)
  if (batchNanoBanana.value) {
    batchGenerationDialog.prompts.forEach((card) => { card.count = 1 })
    return
  }
  if (!batchQualityOptions.value.includes(batchGenerationDialog.quality)) {
    batchGenerationDialog.quality = batchQualityOptions.value[0] || 'auto'
  }
  syncBatchRatioFromSize()
}

function syncBatchSizeFromRatio() {
  batchGenerationDialog.size = sizeForModel(
    batchActiveModel.value.id,
    batchGenerationDialog.ratio,
    batchGenerationDialog.size,
  )
}

function syncBatchRatioFromSize() {
  if (batchNanoBanana.value) return
  batchGenerationDialog.ratio = ratioForSize(batchGenerationDialog.size, batchGenerationDialog.ratio)
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

function mergeResultCacheFromJob(job) {
  const cache = job?.summary?.result_cache
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return
  Object.entries(cache).forEach(([url, path]) => {
    const remoteUrl = String(url || '').trim()
    const localPath = String(path || '').trim()
    if (remoteUrl && localPath) resultCachePaths[remoteUrl] = localPath
  })
}

async function loadJobs() {
  try {
    const response = await window.cs.listAiImageJobs()
    jobs.value = Array.isArray(response) ? response : response?.items || []
    jobs.value.forEach((job) => mergeResultCacheFromJob(job))
  } catch (error) {
    logs.value.push(`读取历史失败：${error.message || error}`)
  }
}

function hasActiveRuns(job) {
  const runs = Array.isArray(job?.summary?.runs) ? job.summary.runs : []
  return runs.some((run) => ['queued', 'running'].includes(String(run?.status || '').toLowerCase()))
}

function stopJobPolling() {
  if (jobPollingTimer) clearTimeout(jobPollingTimer)
  jobPollingTimer = null
  jobPollingUid = ''
  jobPollingInFlight = false
}

function startJobPolling(jobUid) {
  const uid = String(jobUid || '').trim()
  stopJobPolling()
  if (!uid) return
  jobPollingUid = uid
  jobPollingTimer = setTimeout(pollActiveJob, 1000)
}

async function pollActiveJob() {
  const uid = jobPollingUid
  jobPollingTimer = null
  if (!uid || jobPollingInFlight) return
  jobPollingInFlight = true
  try {
    const latest = await window.cs.getAiImageJob(uid)
    if (uid !== jobPollingUid) return
    mergeResultCacheFromJob(latest)
    upsertJob(latest)
    if (currentJob.value?.job_uid === uid) {
      currentJob.value = latest
      refreshResultPreviewCandidates(collectResultCards(latest))
    }
    if (!hasActiveRuns(latest)) {
      stopJobPolling()
      return
    }
  } catch (error) {
    logs.value.push(`刷新批量任务状态失败：${error.message || error}`)
  } finally {
    jobPollingInFlight = false
  }
  if (uid === jobPollingUid) jobPollingTimer = setTimeout(pollActiveJob, 1000)
}

function parseAdvancedJsonValue(value, options = {}) {
  if (!value) return {}
  try {
    return JSON.parse(value)
  } catch (error) {
    if (options.silent) return {}
    throw error
  }
}

function parseAdvancedJson(options = {}) {
  return parseAdvancedJsonValue(form.advancedJson, options)
}

function buildJobPayload(options = {}) {
  const normalizedSize = sizeForModel(form.modelId, form.ratio, form.size)
  if (normalizedSize !== form.size) form.size = normalizedSize
  const requestedCount = activeNanoBanana.value ? 1 : normalizeImageCount(form.count)
  const params = {
    ...parseAdvancedJson({ silent: options.silentAdvanced }),
    size: normalizedSize,
    ratio: form.ratio,
    quality: form.quality,
    response_format: form.format,
    n: requestedCount,
    model_key_tier: activeModel.value.keyTier,
    main_image_path: form.mainImagePath,
    reference_image_paths: [...form.referenceImagePaths],
  }
  params.size = sizeForModel(form.modelId, form.ratio, params.size)
  params.n = requestedCount
  params.model_key_tier = activeModel.value.keyTier
  return {
    title: form.title || 'AI 生图任务',
    prompt: form.prompt,
    model_key: activeModel.value.key,
    output_dir: form.output_dir,
    params,
  }
}

function buildBatchJobPayload(snapshot = {}, card = {}, index = 0) {
  const model = getAiImageModel(snapshot.modelId || form.modelId)
  const ratio = snapshot.ratio || form.ratio
  const normalizedSize = sizeForModel(model.id, ratio, snapshot.size || form.size)
  const batchSnapshot = { ...snapshot }
  const requestedCount = normalizeBatchPromptCount(card.count, { forceSingle: isNanoBananaModel(model.id) })
  const promptText = String(card.prompt || '').trim()
  const promptTitle = String(card.title || `Prompt ${index + 1}`).trim()
  const params = {
    ...parseAdvancedJsonValue(batchSnapshot.advancedJson, { silent: true }),
    size: normalizedSize,
    ratio,
    quality: batchSnapshot.quality || form.quality,
    response_format: batchSnapshot.format || form.format,
    n: requestedCount,
    model_key_tier: model.keyTier,
    main_image_path: batchSnapshot.mainImagePath || '',
    reference_image_paths: [...(Array.isArray(batchSnapshot.referenceImagePaths) ? batchSnapshot.referenceImagePaths : [])],
  }
  params.n = requestedCount
  params.model_key_tier = model.keyTier
  return {
    title: `${batchSnapshot.titlePrefix || batchSnapshot.title || '批量生图'} · ${promptTitle}`,
    prompt: promptText,
    model_key: model.key,
    output_dir: batchSnapshot.output_dir || '',
    params,
  }
}

function normalizeImageCount(value) {
  const count = Number.parseInt(String(value || 1), 10)
  if (!Number.isFinite(count)) return 1
  return Math.max(1, Math.min(8, count))
}

function scheduleTaskAutosave() {
  if (!currentJob.value?.job_uid || typeof window?.cs?.updateAiImageJob !== 'function') return
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null
    void autosaveCurrentTask()
  }, AUTOSAVE_DELAY_MS)
}

async function autosaveCurrentTask(options = {}) {
  const jobUid = activeJobUid.value
  if (!jobUid || typeof window?.cs?.updateAiImageJob !== 'function') return null
  if (!options.allowDuringGeneration && generating.value) return null
  if (!options.force && hasGeneratedResults(persistedCurrentJob.value)) return null
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
    if (isAiImageJobNotFoundError(error)) {
      logs.value.push(`任务记录已失效，生成前会自动创建新任务：${jobUid}`)
    } else {
      logs.value.push(`自动保存任务失败：${error.message || error}`)
    }
    return null
  }
}

function upsertJob(job) {
  if (!job?.job_uid) return
  mergeResultCacheFromJob(job)
  const index = jobs.value.findIndex((item) => item.job_uid === job.job_uid)
  if (index >= 0) jobs.value.splice(index, 1, job)
  else jobs.value.unshift(job)
}

async function ensureCurrentTask() {
  if (currentJob.value?.job_uid) {
    const saved = await autosaveCurrentTask({ force: true, allowDuringGeneration: true })
    if (saved) return saved
    try {
      const existing = await window.cs.getAiImageJob(currentJob.value.job_uid)
      if (existing?.job_uid) return existing
    } catch (error) {
      if (!isAiImageJobNotFoundError(error)) throw error
      forgetStaleJob(currentJob.value.job_uid)
    }
  }
  const created = await createTaskFromCurrentForm('draft')
  return created
}

async function createTaskFromCurrentForm(status = 'draft') {
  const created = await window.cs.createAiImageJob({ ...buildJobPayload({ silentAdvanced: true }), status })
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
  restoringState = false
  try {
    const created = await window.cs.createAiImageJob({ ...buildJobPayload({ silentAdvanced: true }), status: 'draft' })
    currentJob.value = created
    upsertJob(created)
    taskDrafts[created.job_uid] = formSnapshot()
    logs.value.push(`新建生图任务：${created.job_uid}`)
  } catch (error) {
    currentJob.value = null
    errorMessage.value = error.message || String(error)
    logs.value.push(`新建任务失败：${errorMessage.value}`)
  } finally {
    persistWorkbenchState()
  }
}

function createBatchPromptCard(values = {}) {
  return {
    id: `batch-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: String(values.title || values.promptName || '').trim(),
    prompt: String(values.prompt || values.promptText || '').trim(),
    count: normalizeBatchPromptCount(values.count, { forceSingle: batchNanoBanana.value }),
  }
}

function openBatchGenerationDialog() {
  if (generating.value) return
  const snapshot = formSnapshot()
  const initialPrompt = String(snapshot.prompt || '').trim()
  batchGenerationDialog.open = true
  batchGenerationDialog.submitting = false
  batchGenerationDialog.error = ''
  batchGenerationDialog.titlePrefix = snapshot.title || nextTaskTitle()
  batchGenerationDialog.mainImagePath = snapshot.mainImagePath || ''
  batchGenerationDialog.referenceImagePaths = [...snapshot.referenceImagePaths]
  Object.assign(batchGenerationDialog, batchSettingsFromForm(snapshot))
  batchGenerationDialog.prompts = [
    createBatchPromptCard({ title: initialPrompt ? 'Prompt 1' : '', prompt: initialPrompt }),
    createBatchPromptCard({ title: initialPrompt ? 'Prompt 2' : '', prompt: '' }),
    createBatchPromptCard({ title: initialPrompt ? 'Prompt 3' : '', prompt: '' }),
  ]
  if (!initialPrompt) {
    batchGenerationDialog.prompts = [
      createBatchPromptCard({ title: 'Prompt 1' }),
      createBatchPromptCard({ title: 'Prompt 2' }),
      createBatchPromptCard({ title: 'Prompt 3' }),
    ]
  }
  void refreshImagePreview(batchGenerationDialog.mainImagePath)
  batchGenerationDialog.referenceImagePaths.forEach((path) => void refreshImagePreview(path))
}

function closeBatchGenerationDialog() {
  if (batchGenerationDialog.submitting) return
  batchGenerationDialog.open = false
  batchGenerationDialog.error = ''
  closeBatchPromptLibraryPicker()
}

function addBatchPromptCard(values = {}) {
  if (batchGenerationDialog.submitting) return
  if (batchPromptCards.value.length >= MAX_BATCH_PROMPTS) {
    batchGenerationDialog.error = '最多添加 20 条 Prompt'
    return
  }
  batchGenerationDialog.error = ''
  batchGenerationDialog.prompts.push(createBatchPromptCard({
    title: values.title || `Prompt ${batchGenerationDialog.prompts.length + 1}`,
    prompt: values.prompt || '',
    count: values.count,
  }))
}

function removeBatchPromptCard(card) {
  if (batchGenerationDialog.submitting || batchGenerationDialog.prompts.length <= 1) return
  batchGenerationDialog.prompts = batchGenerationDialog.prompts.filter((item) => item !== card)
}

async function chooseBatchMainImage() {
  if (batchGenerationDialog.submitting) return
  const path = await choosePath({ title: '选择批量生成主图', images: true })
  if (!path) return
  batchGenerationDialog.mainImagePath = path
  await refreshImagePreview(path, { force: true })
}

async function chooseBatchReferenceImages() {
  if (batchGenerationDialog.submitting) return
  const paths = await choosePath({
    title: '选择批量生成参考图',
    images: true,
    multi: true,
  })
  const nextPaths = (Array.isArray(paths) ? paths : [paths])
    .map((path) => String(path || '').trim())
    .filter(Boolean)
  batchGenerationDialog.referenceImagePaths = appendUniquePaths([
    ...batchGenerationDialog.referenceImagePaths,
    ...nextPaths,
  ])
  for (const path of nextPaths) {
    await refreshImagePreview(path, { force: true })
  }
}

function removeBatchReferencePath(index) {
  if (batchGenerationDialog.submitting) return
  batchGenerationDialog.referenceImagePaths.splice(index, 1)
}

function openBatchPromptLibraryPicker(card) {
  if (batchGenerationDialog.submitting) return
  batchPromptLibraryPicker.open = true
  batchPromptLibraryPicker.card = card
}

function closeBatchPromptLibraryPicker() {
  batchPromptLibraryPicker.open = false
  batchPromptLibraryPicker.card = null
}

function selectBatchPromptLibraryTemplate(template) {
  const card = batchPromptLibraryPicker.card
  const promptText = String(template?.prompt_text || template?.prompt || '').trim()
  if (!card || !promptText) return
  card.title = String(template?.field_name || template?.name || card.title || 'Prompt').trim()
  card.prompt = promptText
  closeBatchPromptLibraryPicker()
}

async function submitBatchGeneration() {
  batchGenerationDialog.error = ''
  if (batchMissingKey.value) {
    openSettings()
    return
  }
  if (generating.value || batchGenerationDialog.submitting) return
  const promptCards = batchPromptCards.value
    .map((card) => ({
      ...card,
      prompt: String(card.prompt || '').trim(),
      title: String(card.title || '').trim(),
    }))
    .filter((card) => card.prompt)
  const promptStats = { ...batchPromptStats.value }
  if (!promptCards.length) {
    batchGenerationDialog.error = '请至少填写一条 Prompt'
    return
  }
  const snapshot = formSnapshot()
  const batchSnapshot = {
    ...snapshot,
    titlePrefix: batchGenerationDialog.titlePrefix || snapshot.title || nextTaskTitle(),
    mainImagePath: batchGenerationDialog.mainImagePath,
    referenceImagePaths: [...batchGenerationDialog.referenceImagePaths],
    modelId: batchGenerationDialog.modelId,
    ratio: batchGenerationDialog.ratio,
    size: batchGenerationDialog.size,
    quality: batchGenerationDialog.quality,
    format: batchGenerationDialog.format,
  }
  batchGenerationDialog.submitting = true
  generating.value = true
  selectedResults.clear()
  try {
    const activeTask = await ensureCurrentTask()
    const jobUid = activeTask?.job_uid
    if (!jobUid) throw new Error('后端未返回 job_uid')
    const firstPayload = buildBatchJobPayload(batchSnapshot, promptCards[0], 0)
    const sharedPayload = {
      ...firstPayload,
      title: batchSnapshot.titlePrefix || activeTask.title || form.title || 'AI 生图任务',
      prompt: activeTask.prompt || snapshot.prompt || '',
      status: 'running',
    }
    const updated = await window.cs.updateAiImageJob(jobUid, sharedPayload)
    currentJob.value = updated || activeTask
    upsertJob(currentJob.value)
    const requestUid = globalThis.crypto?.randomUUID?.()
      || `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    logs.value.push(`提交批量生成：${promptStats.promptCount} 条 Prompt，预计 ${promptStats.totalImages} 张图`)
    const batchResult = await window.cs.batchRunAiImageJob(jobUid, {
      request_uid: requestUid,
      prompts: promptCards.map((card, index) => ({
        title: card.title || `Prompt ${index + 1}`,
        prompt: card.prompt,
        count: normalizeBatchPromptCount(card.count, { forceSingle: batchNanoBanana.value }),
      })),
    })
    if (!batchResult?.accepted) throw new Error('后端未接受批量生成任务')
    currentJob.value = batchResult.job || currentJob.value
    upsertJob(currentJob.value)
    clearSubmittedTaskInputs(snapshot)
    batchGenerationDialog.open = false
    closeBatchPromptLibraryPicker()
    logs.value.push(`批量任务已提交：${promptStats.promptCount} 条 Prompt，预计 ${promptStats.totalImages} 张图`)
    if (hasActiveRuns(currentJob.value)) startJobPolling(jobUid)
  } catch (error) {
    const message = normalizeGenerateError(error)
    batchGenerationDialog.error = message
    errorMessage.value = message
    logs.value.push(`批量生成失败：${message}`)
  } finally {
    batchGenerationDialog.submitting = false
    generating.value = false
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
    const payload = buildJobPayload({ silentAdvanced: true })
    const submittedSnapshot = formSnapshot()
    currentJob.value = {
      ...activeTask,
      ...payload,
      job_uid: jobUid,
      status: 'running',
      summary: previousSummary,
    }
    logs.value.push(`提交生成任务：${jobUid}`)
    clearSubmittedTaskInputs(submittedSnapshot)
    const runResult = await window.cs.runAiImageJob(jobUid)
    const latest = await window.cs.getAiImageJob(jobUid)
    currentJob.value = latest || activeTask
    upsertJob(latest || activeTask)
    if (runResult && runResult.ok === false) {
      throw new Error(runResult.summary?.error || '生成任务失败，请查看日志')
    }
    const warning = runResult?.summary?.warning || latest?.summary?.warning || ''
    if (warning) logs.value.push(warning)
    selectedResults.clear()
    refreshResultPreviewCandidates(resultCards.value, { force: true })
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
    return '当前任务记录不存在，请重新新建任务后再生成'
  }
  if (/not implemented|not available|unsupported|window\.cs|runAiImageJob|createAiImageJob/i.test(text)) {
    return '本地 AI 生图服务未就绪，请重启抓虾客户端后再试'
  }
  return text || '生成失败，请查看日志'
}

function isAiImageJobNotFoundError(error) {
  const detail = error?.detail?.message || error?.detail || error?.message || String(error || '')
  return /^not found$/i.test(String(detail || '').trim()) || /ai image job not found/i.test(String(detail || ''))
}

function forgetStaleJob(jobUid) {
  const uid = String(jobUid || '').trim()
  if (!uid) return
  delete taskDrafts[uid]
  jobs.value = jobs.value.filter((job) => job.job_uid !== uid)
  if (currentJob.value?.job_uid === uid) currentJob.value = null
  if (pendingActiveJobUid.value === uid) pendingActiveJobUid.value = ''
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

function workbenchRunPlaceholders(job, run, index) {
  const status = String(run?.status || '').toLowerCase()
  if (['queued', 'running'].includes(status)) {
    const loadingContext = resolveLoadingPreviewContext(job, run)
    return loadingSlotIndexes(run).map((slotIndex) => ({
      key: `${run.run_uid || run.task_id || index}-loading-${slotIndex + 1}`,
      label: `${status === 'queued' ? '排队中' : '生成中'} ${slotIndex + 1}`,
      prompt: run.prompt || '',
      jobUid: job?.job_uid || '',
      runUid: run.run_uid || '',
      requested_count: Number(run.requested_count || 1),
      loadingPreviewPath: loadingContext.previewPath,
      loadingMode: loadingContext.mode,
      loadingMessageOffset: index + slotIndex,
      loading: true,
    }))
  }
  if (status === 'failed') {
    return [{
      key: `${run.run_uid || run.task_id || index}-failed`,
      label: '生成失败',
      prompt: run.prompt || '',
      error: run.error || '1XM 任务执行失败',
      jobUid: job?.job_uid || '',
      runUid: run.run_uid || '',
      failed: true,
    }]
  }
  return []
}

function collectResultQueues(job) {
  const summary = job?.summary && typeof job.summary === 'object' ? job.summary : {}
  const runs = Array.isArray(summary.runs) ? summary.runs : []
  if (runs.length) {
    const queues = runs
      .map((run, index) => {
        const resultItems = collectResultCardsFromRun(job, run, index)
        const placeholders = resultItems.length ? [] : workbenchRunPlaceholders(job, run, index)
        return {
          key: run.run_uid || run.task_id || `run-${index + 1}`,
          title: `队列 ${index + 1}`,
          createdAt: run.created_at || '',
          prompt: run.prompt || '',
          status: run.status || job?.status || '',
          items: resultItems.length ? resultItems : placeholders,
        }
      })
      .filter((queue) => queue.items.length)
    const flatItems = queues.flatMap((queue) => queue.items)
    for (const item of flatItems) {
      const lineage = resolveResultLineage(item, flatItems)
      item.historyItems = lineage.slice(0, -1)
      item.promptChain = promptChainFromLineage(lineage)
    }
    return queues.reverse()
  }
  const legacySummary = {
    ...summary,
    image_urls: Array.isArray(summary.image_urls) ? summary.image_urls : [],
    output_files: Array.isArray(summary.output_files) ? summary.output_files : [],
  }
  const items = collectResultCardsFromRun(job, legacySummary, 0, { includeOutputAssets: true })
  for (const item of items) {
    item.historyItems = []
    item.promptChain = promptChainFromLineage([item])
  }
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
      jobUid: job?.job_uid || '',
      runUid: run?.run_uid || run?.task_id || '',
      sourceJobUid: job?.job_uid || '',
      editSource: run?.edit_source || null,
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
      jobUid: job?.job_uid || '',
      runUid: run?.run_uid || run?.task_id || '',
      sourceJobUid: job?.job_uid || '',
      editSource: run?.edit_source || null,
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
  const prompt = queuePromptText(queue)
  return prompt ? `Prompt：${prompt}` : ''
}

function queuePromptText(queue = {}) {
  return String(queue?.prompt || '').trim()
}

function queuePromptPreview(queue = {}) {
  const line = queuePromptLine(queue)
  return line.length > 120 ? `${line.slice(0, 120)}...` : line
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

function loadingMessage(item) {
  return loadingMessageFor(loadingMessageTick.value, item?.loadingMessageOffset || 0)
}

function loadingPreviewSrc(item) {
  const path = String(item?.loadingPreviewPath || '').trim()
  return path ? imagePreviewSrc(path) : ''
}

function resultKey(item) {
  return item?.url || item?.path || ''
}

function resultPreviewKey(item) {
  return resultPreviewCandidates(item)[0] || ''
}

function cachedResultPath(url) {
  return resultCachePaths[String(url || '').trim()] || ''
}

function resultPreviewCandidates(item) {
  const seen = new Set()
  return [cachedResultPath(item?.url), item?.path, item?.url]
    .map((value) => String(value || '').trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false
      seen.add(value)
      return true
    })
}

function resultPreviewSrc(item) {
  for (const key of resultPreviewCandidates(item)) {
    const src = imagePreviewSrc(key)
    if (src) return src
    if (!isRemoteOrDataImage(key) && !previewFailures.has(key)) continue
  }
  return ''
}

function lightboxThumbnailSrc(item) {
  if (!item) return ''
  return item.previewSrc || resultPreviewSrc(item)
}

function activeResultPreviewKey(item) {
  for (const key of resultPreviewCandidates(item)) {
    if (imagePreviewSrc(key)) return key
  }
  return resultPreviewKey(item)
}

function markResultPreviewBroken(item) {
  const failedKey = activeResultPreviewKey(item)
  if (failedKey) markPreviewBroken(failedKey)
  for (const key of resultPreviewCandidates(item)) {
    if (key && key !== failedKey && !previewFailures.has(key)) {
      void refreshImagePreview(key, { force: true })
      break
    }
  }
}

function refreshResultPreviewCandidates(items, options = {}) {
  for (const item of items || []) {
    resultPreviewCandidates(item).forEach((key) => {
      void refreshImagePreview(key, options)
    })
  }
}

function rememberResultCache(jobUid, url, path) {
  const uid = String(jobUid || '').trim()
  const remoteUrl = String(url || '').trim()
  const localPath = String(path || '').trim()
  if (!remoteUrl || !localPath) return
  resultCachePaths[remoteUrl] = localPath

  const withCache = (job) => {
    if (!job || job.job_uid !== uid) return job
    const summary = job.summary && typeof job.summary === 'object' ? job.summary : {}
    const resultCache = summary.result_cache && typeof summary.result_cache === 'object'
      ? summary.result_cache
      : {}
    return {
      ...job,
      summary: {
        ...summary,
        result_cache: { ...resultCache, [remoteUrl]: localPath },
      },
    }
  }

  if (currentJob.value?.job_uid === uid) currentJob.value = withCache(currentJob.value)
  const index = jobs.value.findIndex((job) => job?.job_uid === uid)
  if (index >= 0) jobs.value.splice(index, 1, withCache(jobs.value[index]))
}

function queueResultCache(item) {
  const url = String(item?.url || '').trim()
  const jobUid = resultOwnerJobUid(item)
  const existingPath = cachedResultPath(url)
  if (!url || !jobUid || typeof window?.cs?.materializeAiImageResult !== 'function') return
  if (existingPath && !previewFailures.has(existingPath)) return
  if (resultCachePending.has(url)) return

  resultCachePending.add(url)
  resultCacheQueue = resultCacheQueue
    .catch(() => {})
    .then(async () => {
      try {
        const result = await window.cs.materializeAiImageResult(jobUid, { url })
        const path = String(result?.path || '').trim()
        if (!path) throw new Error('缓存接口未返回本地路径')
        rememberResultCache(jobUid, url, path)
        await refreshImagePreview(path, { force: true })
      } catch (error) {
        logs.value.push(`图片缓存失败：${pathLabel(url)} (${error.message || error})`)
      } finally {
        resultCachePending.delete(url)
      }
    })
}

function handleResultPreviewLoaded(item) {
  const url = String(item?.url || '').trim()
  if (!url || activeResultPreviewKey(item) !== url) return
  queueResultCache(item)
}

function toggleResult(item) {
  if (item?.loading || item?.failed) return
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

function startResultDrag(item, event) {
  if (item?.loading) return
  const key = resultKey(item)
  if (!key) return
  draggingResultKey.value = key
  if (event?.dataTransfer) {
    event.dataTransfer.setData('text/plain', key)
    event.dataTransfer.effectAllowed = 'copy'
  }
}

function endResultDrag() {
  draggingResultKey.value = ''
  dragOverTarget.value = ''
}

function handleResultDragOver(event) {
  if (event?.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function clearDragOver(target) {
  if (dragOverTarget.value === target) dragOverTarget.value = ''
}

function resolveDroppedResult(event) {
  const key = String(event?.dataTransfer?.getData('text/plain') || draggingResultKey.value || '').trim()
  if (!key) return null
  return allVisibleSelectableItems.value.find((item) => resultKey(item) === key) || resultCards.value.find((item) => resultKey(item) === key) || null
}

async function dropResultAsMain(event) {
  const item = resolveDroppedResult(event)
  dragOverTarget.value = ''
  if (!item) return
  await setAsMain(item)
}

async function dropResultAsReference(event) {
  const item = resolveDroppedResult(event)
  dragOverTarget.value = ''
  if (!item) return
  await addAsReference(item)
}

function resetLightboxEditDraft(item) {
  lightboxEditPrompt.value = latestPromptForItem(item)
  lightboxEditReferencePaths.value = []
  lightboxEditResults.value = []
  lightboxActiveIndex.value = lightboxHistoryItems(item).length
  resetLightboxAnnotationState({ clearLayer: true })
}

function openLightbox(item, options = {}) {
  if (item?.loading || !resultKey(item)) return
  lightboxItem.value = item
  lightboxMode.value = options.mode === 'edit' ? 'edit' : 'preview'
  resetLightboxEditDraft(item)
  void refreshImagePreview(resultPreviewKey(item))
}

function closeLightbox() {
  clearLightboxAnnotationExport()
  lightboxItem.value = null
  lightboxMode.value = 'preview'
  lightboxEditPrompt.value = ''
  lightboxEditReferencePaths.value = []
  lightboxEditResults.value = []
  lightboxActiveIndex.value = 0
  resetLightboxAnnotationState({ clearLayer: true })
}

function selectLightboxPreview(index) {
  const safeIndex = Math.min(Math.max(Number(index) || 0, 0), Math.max(0, lightboxPreviewItems.value.length - 1))
  lightboxActiveIndex.value = safeIndex
  resetLightboxAnnotationState({ clearLayer: true })
}

function resetLightboxAnnotationState(options = {}) {
  lightboxAnnotationTool.value = 'draw'
  lightboxAnnotationDataUrl.value = ''
  if (options.clearLayer) lightboxAnnotationClearNonce.value += 1
}

function setLightboxAnnotationTool(tool) {
  lightboxAnnotationTool.value = tool
}

function setLightboxAnnotationColor(color) {
  if (!AIW_ANNOTATION_COLORS.some((item) => item.id === color)) return
  lightboxAnnotationColor.value = color
}

function clearLightboxAnnotation() {
  lightboxAnnotationDataUrl.value = ''
  lightboxAnnotationClearNonce.value += 1
}

function exitLightboxAnnotation() {
  lightboxAnnotationTool.value = ''
}

function clearLightboxAnnotationExport() {
  if (lightboxAnnotationExportTimer) clearTimeout(lightboxAnnotationExportTimer)
  lightboxAnnotationExportTimer = null
  lightboxAnnotationExportResolve = null
  lightboxAnnotationExportReject = null
}

function captureLightboxAnnotation(dataUrl) {
  lightboxAnnotationDataUrl.value = String(dataUrl || '')
  if (lightboxAnnotationExportResolve) {
    lightboxAnnotationExportResolve(lightboxAnnotationDataUrl.value)
    clearLightboxAnnotationExport()
  }
}

function handleLightboxAnnotationError(message) {
  const error = new Error(String(message || '标注导出失败'))
  if (lightboxAnnotationExportReject) {
    lightboxAnnotationExportReject(error)
    clearLightboxAnnotationExport()
    return
  }
  errorMessage.value = error.message
}

function requestLightboxAnnotationExport() {
  if (!lightboxActiveSrc.value || lightboxActiveItem.value?.loading) return Promise.resolve('')
  return new Promise((resolve, reject) => {
    clearLightboxAnnotationExport()
    lightboxAnnotationExportResolve = resolve
    lightboxAnnotationExportReject = reject
    lightboxAnnotationExportTimer = setTimeout(() => {
      if (lightboxAnnotationExportReject) lightboxAnnotationExportReject(new Error('标注截图导出超时，请稍后再试'))
      clearLightboxAnnotationExport()
    }, 8000)
    lightboxAnnotationExportNonce.value += 1
  })
}

async function materializeLightboxAnnotation(jobUid, dataUrl) {
  const source = String(dataUrl || '').trim()
  if (!source) return ''
  if (typeof window?.cs?.materializeAiImageResult !== 'function') {
    throw new Error('本地 AI 生图服务未就绪，无法保存标注截图')
  }
  const result = await window.cs.materializeAiImageResult(jobUid, {
    data_url: source,
    filename: 'annotation-edit.png',
  })
  const path = result?.path || ''
  if (path) await refreshImagePreview(path, { force: true })
  return path
}

function lightboxItemIdentity(item) {
  return resultKey(item) || item?.key || ''
}

function dedupeLightboxItems(items = []) {
  const seen = new Set()
  return (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .filter((item) => {
      const identity = lightboxItemIdentity(item)
      if (!identity || seen.has(identity)) return false
      seen.add(identity)
      return true
    })
}

function buildBasePromptChain(prompt) {
  const value = String(prompt || '').trim()
  return [{
    key: 'prompt-original',
    label: '原图 Prompt',
    prompt: value,
  }]
}

function promptChainForItem(item) {
  const chain = Array.isArray(item?.promptChain) ? item.promptChain : []
  const normalized = chain
    .map((entry, index) => ({
      key: entry?.key || `prompt-${index}`,
      label: String(entry?.label || (index === 0 ? '原图 Prompt' : `修改 Prompt ${index}`)).trim(),
      prompt: String(entry?.prompt || '').trim(),
    }))
    .filter((entry, index) => entry.prompt || index === 0)
  if (normalized.length) return normalized
  return buildBasePromptChain(item?.prompt || currentJob.value?.prompt || form.prompt || '')
}

function latestPromptForItem(item) {
  const chain = promptChainForItem(item)
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const prompt = String(chain[index]?.prompt || '').trim()
    if (prompt) return prompt
  }
  return String(item?.prompt || '').trim()
}

function lightboxHistoryItems(item) {
  return dedupeLightboxItems(Array.isArray(item?.historyItems) ? item.historyItems : [])
}

function resultOwnerJobUid(item) {
  return String(item?.jobUid || item?.job_uid || item?.sourceJobUid || item?.source_job_uid || currentJob.value?.job_uid || '').trim()
}

function buildEditSource(item) {
  return {
    job_uid: resultOwnerJobUid(item),
    run_uid: String(item?.runUid || item?.run_uid || '').trim(),
    result_key: resultKey(item),
  }
}

function lightboxHistorySnapshot(item) {
  if (!item || !resultKey(item)) return null
  return {
    key: item.key || resultKey(item),
    path: item.path || '',
    url: item.url || '',
    label: item.label || '历史图片',
    model: item.model || activeModel.value.label,
    size: item.size || form.size,
    prompt: latestPromptForItem(item),
    createdAt: item.createdAt || '',
    previewSrc: lightboxThumbnailSrc(item),
    jobUid: resultOwnerJobUid(item),
    runUid: item.runUid || item.run_uid || '',
    sourceJobUid: item.sourceJobUid || item.source_job_uid || resultOwnerJobUid(item),
    editSource: item.editSource || item.edit_source || null,
    promptChain: promptChainForItem(item),
    historyItems: lightboxHistoryItems(item),
  }
}

function buildLightboxEditHistory(sourceItem) {
  return dedupeLightboxItems([
    ...lightboxHistoryItems(sourceItem),
    lightboxHistorySnapshot(sourceItem),
  ])
}

function buildLightboxPromptChain(sourceItem, prompt) {
  const chain = promptChainForItem(sourceItem)
  const editCount = chain.filter((entry) => String(entry?.label || '').includes('修改 Prompt')).length + 1
  return [
    ...chain,
    {
      key: `prompt-edit-${editCount}`,
      label: `修改 Prompt ${editCount}`,
      prompt: String(prompt || '').trim(),
    },
  ]
}

function preserveLightboxEditMetadata(item) {
  return {
    historyItems: lightboxHistoryItems(item),
    promptChain: promptChainForItem(item),
    editSource: item?.editSource || item?.edit_source || null,
    sourceJobUid: item?.sourceJobUid || item?.source_job_uid || '',
    sourceResultKey: item?.sourceResultKey || '',
  }
}

function openPromptDialog(queue) {
  if (!queuePromptText(queue)) return
  promptDialogQueue.value = {
    title: queue?.title || '',
    prompt: queuePromptText(queue),
  }
}

function closePromptDialog() {
  promptDialogQueue.value = null
}

async function materializeResultForInput(item) {
  const key = resultKey(item)
  if (!key) return ''
  const remoteUrl = String(item?.url || '').trim()
  const localPath = String(item?.path || '').trim()
  if (!/^https?:\/\//i.test(remoteUrl)) return localPath || key
  const ownerJobUid = resultOwnerJobUid(item)
  if (!ownerJobUid) {
    if (localPath) return localPath
    throw new Error('当前任务不存在，无法把远程结果加入输入图')
  }
  if (typeof window?.cs?.materializeAiImageResult !== 'function') {
    if (localPath) return localPath
    throw new Error('本地 AI 生图服务未就绪，无法缓存远程结果')
  }
  const result = await window.cs.materializeAiImageResult(ownerJobUid, {
    file: resultKey(item),
    url: remoteUrl,
  })
  return result?.path || item?.path || ''
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

async function setAsMain(item) {
  try {
    const key = await materializeResultForInput(item)
    if (!key) return
    form.mainImagePath = key
    void refreshImagePreview(key, { force: true })
  } catch (error) {
    errorMessage.value = error.message || String(error)
  }
}

async function addAsReference(item) {
  try {
    const key = await materializeResultForInput(item)
    if (key && !form.referenceImagePaths.includes(key)) form.referenceImagePaths.push(key)
    void refreshImagePreview(key, { force: true })
  } catch (error) {
    errorMessage.value = error.message || String(error)
  }
}

async function chooseLightboxEditReferences() {
  const paths = await choosePath({
    title: '选择二次修改参考图',
    images: true,
    multi: true,
  })
  const nextPaths = (Array.isArray(paths) ? paths : [paths])
    .map((path) => String(path || '').trim())
    .filter(Boolean)
  for (const path of nextPaths) {
    if (!lightboxEditReferencePaths.value.includes(path)) lightboxEditReferencePaths.value.push(path)
    await refreshImagePreview(path, { force: true })
  }
}

function removeLightboxEditReference(index) {
  const [removed] = lightboxEditReferencePaths.value.splice(index, 1)
  if (removed && !form.referenceImagePaths.includes(removed)) forgetImagePreview(removed)
}

function buildAnnotationEditPrompt(prompt, hasAnnotation) {
  const value = String(prompt || '').trim()
  if (!hasAnnotation || value.includes(AIW_ANNOTATION_PROMPT_GUIDANCE)) return value
  return `${value}\n\n${AIW_ANNOTATION_PROMPT_GUIDANCE}`
}

async function submitLightboxEdit() {
  if (!lightboxActiveItem.value || lightboxEditBusy.value) return
  const nextPrompt = String(lightboxEditPrompt.value || lightboxSourcePrompt.value || '').trim()
  if (!nextPrompt) {
    errorMessage.value = '请输入新的修改提示词'
    return
  }
  if (activeMissingKey.value) {
    openSettings()
    return
  }
  let placeholder = null
  try {
    lightboxEditSubmitting.value = true
    errorMessage.value = ''
    const sourceItem = lightboxActiveItem.value
    placeholder = appendLightboxEditPlaceholder(sourceItem, nextPrompt, { activate: false })
    const annotationDataUrl = await requestLightboxAnnotationExport()
    activateLightboxEditPlaceholder(placeholder)
    const mainPath = await materializeResultForInput(sourceItem)
    if (!mainPath) throw new Error('当前图片无法作为二次修改主图')
    await refreshImagePreview(mainPath, { force: true })
    logs.value.push(`基于 ${sourceItem.label || pathLabel(mainPath)} 发起二次修改`)
    await runLightboxEditGeneration({
      sourceItem,
      mainPath,
      prompt: nextPrompt,
      referencePaths: [...lightboxEditReferencePaths.value],
      annotationDataUrl,
      placeholder,
    })
    placeholder = null
  } catch (error) {
    if (placeholder) removeLightboxEditPlaceholder(placeholder)
    errorMessage.value = error.message || String(error)
  } finally {
    lightboxEditSubmitting.value = false
  }
}

function appendUniquePaths(paths) {
  const seen = new Set()
  return paths
    .map((path) => String(path || '').trim())
    .filter((path) => {
      if (!path || seen.has(path)) return false
      seen.add(path)
      return true
    })
}

function lightboxEditResultOffset() {
  if (!lightboxItem.value) return 0
  return lightboxHistoryItems(lightboxItem.value).length + 1
}

function activateLightboxEditPlaceholder(placeholder) {
  const index = lightboxEditResults.value.indexOf(placeholder)
  if (index >= 0) lightboxActiveIndex.value = lightboxEditResultOffset() + index
}

function removeLightboxEditPlaceholder(placeholder) {
  lightboxEditResults.value = lightboxEditResults.value.filter((item) => item !== placeholder)
  lightboxActiveIndex.value = Math.min(lightboxActiveIndex.value, Math.max(0, lightboxPreviewItems.value.length - 1))
}

function appendLightboxEditPlaceholder(sourceItem, prompt, options = {}) {
  const placeholder = {
    key: `edit-pending-${Date.now()}`,
    label: `修改中 ${lightboxEditResults.value.length + 1}`,
    loading: true,
    previewSrc: lightboxThumbnailSrc(sourceItem),
    prompt,
    model: sourceItem?.model || activeModel.value.label,
    size: sourceItem?.size || form.size,
    jobUid: '',
    sourceJobUid: resultOwnerJobUid(sourceItem),
    sourceResultKey: resultKey(sourceItem),
    editSource: buildEditSource(sourceItem),
    historyItems: buildLightboxEditHistory(sourceItem),
    promptChain: buildLightboxPromptChain(sourceItem, prompt),
  }
  lightboxEditResults.value.push(placeholder)
  if (options.activate !== false) activateLightboxEditPlaceholder(placeholder)
  return placeholder
}

function applyLightboxEditResult(placeholder, latestJob) {
  const latestQueue = collectResultQueues(latestJob)[0]
  const result = latestQueue?.items?.[0] || null
  const editMetadata = preserveLightboxEditMetadata(placeholder)
  if (!result) {
    Object.assign(placeholder, {
      ...editMetadata,
      loading: false,
      label: '修改结果',
      previewSrc: lightboxThumbnailSrc(placeholder),
      jobUid: latestJob?.job_uid || placeholder.jobUid || '',
    })
    return
  }
  Object.assign(placeholder, {
    ...result,
    ...editMetadata,
    key: `edit-${Date.now()}-${resultKey(result)}`,
    label: result.label || '修改结果',
    prompt: placeholder.prompt || result.prompt || '',
    jobUid: latestJob?.job_uid || result.jobUid || '',
    loading: false,
    previewSrc: '',
  })
  void refreshImagePreview(resultPreviewKey(placeholder), { force: true })
  const index = lightboxEditResults.value.indexOf(placeholder)
  if (index >= 0) lightboxActiveIndex.value = index + 1
}

async function runLightboxEditGeneration({ sourceItem, mainPath, prompt, referencePaths = [], annotationDataUrl = '', placeholder: existingPlaceholder = null }) {
  if (activeMissingKey.value) {
    openSettings()
    return
  }
  const snapshot = formSnapshot()
  const placeholder = existingPlaceholder || appendLightboxEditPlaceholder(sourceItem, prompt)
  let submittedInputsCleared = false
  activateLightboxEditPlaceholder(placeholder)
  generating.value = true
  selectedResults.clear()
  try {
    const activeTask = await ensureCurrentTask()
    const jobUid = activeTask?.job_uid
    if (!jobUid) throw new Error('后端未返回 job_uid')
    const annotationPath = await materializeLightboxAnnotation(jobUid, annotationDataUrl)
    const effectivePrompt = buildAnnotationEditPrompt(prompt, Boolean(annotationPath))
    const retainedSnapshotReferences = filterGeneratedAnnotationReferences(snapshot.referenceImagePaths)
    restoringState = true
    form.prompt = effectivePrompt
    form.mainImagePath = mainPath
    form.referenceImagePaths = appendUniquePaths([
      ...retainedSnapshotReferences,
      ...referencePaths,
      annotationPath,
    ])
    form.count = 1
    const basePayload = buildJobPayload({ silentAdvanced: true })
    const payload = {
      ...basePayload,
      prompt: effectivePrompt,
      params: {
        ...basePayload.params,
        n: 1,
        main_image_path: mainPath,
        reference_image_paths: [...form.referenceImagePaths],
        edit_source: buildEditSource(sourceItem),
      },
    }
    const updated = await window.cs.updateAiImageJob(jobUid, { ...payload, status: 'running' })
    restoringState = false
    currentJob.value = {
      ...(updated || activeTask),
      summary: currentJob.value?.summary || activeTask.summary || {},
      status: 'running',
    }
    upsertJob(currentJob.value)
    clearSubmittedTaskInputs(snapshot)
    submittedInputsCleared = true
    const runResult = await window.cs.runAiImageJob(jobUid)
    const latest = await window.cs.getAiImageJob(jobUid)
    currentJob.value = latest || currentJob.value
    upsertJob(currentJob.value)
    if (runResult && runResult.ok === false) {
      throw new Error(runResult.summary?.error || '生成任务失败，请查看日志')
    }
    applyLightboxEditResult(placeholder, currentJob.value)
    refreshResultPreviewCandidates(resultCards.value, { force: true })
    await loadJobs()
  } catch (error) {
    removeLightboxEditPlaceholder(placeholder)
    throw error
  } finally {
    if (!submittedInputsCleared) {
      restoringState = true
      applyFormSnapshot(snapshot)
      restoringState = false
      persistWorkbenchState()
    }
    generating.value = false
    persistWorkbenchState()
  }
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
      if (isAiImageJobNotFoundError(error)) {
        logs.value.push(`任务记录不存在，已从本地草稿移除：${job.job_uid}`)
        forgetStaleJob(job.job_uid)
        persistWorkbenchState()
        return null
      }
      logs.value.push(`读取任务详情失败：${error.message || error}`)
    }
  }
  const submittedDraft = detail?.job_uid ? taskDrafts[detail.job_uid] : null
  const submittedInputsCleared = Boolean(submittedDraft?.submittedInputsCleared)
  const formDetail = mergeJobWithDraft(detail, { includeGeneratedDrafts: true })
  mergeResultCacheFromJob(detail)
  restoringState = true
  currentJob.value = detail
  pendingActiveJobUid.value = ''
  form.title = formDetail.title || form.title
  form.prompt = formDetail.prompt || ''
  form.modelId = modelIdForJob(formDetail)
  form.model_key = activeModel.value.key
  form.model_key_tier = activeModel.value.keyTier
  form.output_dir = formDetail.output_dir || form.output_dir
  if (formDetail.params && typeof formDetail.params === 'object') {
    const nextSize = formDetail.params.size || form.size
    const nextRatio = formDetail.params.ratio || ratioForSize(nextSize, form.ratio)
    form.ratio = nextRatio
    form.size = sizeForModel(form.modelId, nextRatio, nextSize)
    form.quality = formDetail.params.quality || form.quality
    form.format = formDetail.params.response_format || form.format
    form.count = activeNanoBanana.value ? 1 : normalizeImageCount(formDetail.params.n || form.count)
    if (Object.prototype.hasOwnProperty.call(formDetail.params, 'main_image_path')) {
      form.mainImagePath = formDetail.params.main_image_path || ''
    }
    if (Array.isArray(formDetail.params.reference_image_paths)) {
      form.referenceImagePaths = filterGeneratedAnnotationReferences(formDetail.params.reference_image_paths)
    }
  }
  const assets = Array.isArray(detail.assets) ? detail.assets : []
  const mainAsset = assets.find((asset) => asset.kind === 'main' && asset.path)
  if (!submittedInputsCleared && !form.mainImagePath) form.mainImagePath = mainAsset?.path || ''
  if (!submittedInputsCleared && !form.referenceImagePaths.length) {
    form.referenceImagePaths = assets
      .filter((asset) => asset.kind === 'reference' && asset.path)
      .map((asset) => asset.path)
      .filter((path) => !isGeneratedAnnotationReferencePath(path))
  }
  taskDrafts[detail.job_uid] = {
    ...formSnapshot(),
    ...(submittedInputsCleared ? { submittedInputsCleared: true } : {}),
  }
  restoringState = false
  await Promise.all([
    refreshImagePreview(form.mainImagePath),
    ...form.referenceImagePaths.map((path) => refreshImagePreview(path)),
    ...resultCards.value.flatMap((item) => resultPreviewCandidates(item).map((key) => refreshImagePreview(key, { force: true }))),
  ])
  selectedResults.clear()
  if (hasActiveRuns(detail)) startJobPolling(detail.job_uid)
  else if (jobPollingUid === detail.job_uid) stopJobPolling()
  persistWorkbenchState()
  return detail
}

async function selectTaskRecord(job) {
  await restoreJob(job)
}

function toggleTaskSidebar() {
  taskSidebarOpen.value = !taskSidebarOpen.value
}

async function openOutputFolder() {
  const directory = form.output_dir || currentJob.value?.output_dir || ''
  if (!directory) {
    errorMessage.value = '请先选择输出文件夹'
    logs.value.push(errorMessage.value)
    return
  }
  try {
    let result = null
    if (typeof window?.cs?.openFile === 'function') {
      result = await window.cs.openFile(directory)
    } else if (typeof window?.cs?.revealFile === 'function') {
      result = await window.cs.revealFile(directory)
    } else {
      throw new Error('当前环境不支持直接打开输出文件夹')
    }
    if (result && result.ok === false) throw new Error(result.error || '打开输出文件夹失败')
    logs.value.push(`打开输出文件夹：${directory}`)
  } catch (error) {
    errorMessage.value = error.message || String(error)
    logs.value.push(`打开输出文件夹失败：${errorMessage.value}`)
  }
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
.aiw-results-grid {
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
.aiw-results-actions {
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
.aiw-result-card-meta span,
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
.aiw-lightbox-edit-panel textarea,
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
  grid-template-columns: minmax(320px, 360px) minmax(520px, 1fr);
  gap: 14px;
}

.aiw-prompt-panel {
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

.aiw-panel-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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

.aiw-material-box.drag-over {
  border-color: rgba(255, 107, 43, 0.62);
  background: rgba(255, 107, 43, 0.08);
  box-shadow: inset 0 0 0 1px rgba(255, 107, 43, 0.26);
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
.aiw-result-card-meta strong {
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

.aiw-batch-dialog {
  position: fixed;
  inset: 0;
  z-index: 88;
  display: grid;
  place-items: center;
  padding: 28px;
  background: rgba(10, 10, 14, 0.82);
  backdrop-filter: blur(10px);
}

.aiw-batch-panel {
  width: min(1480px, 94vw);
  height: min(760px, calc(100vh - 56px));
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 14px;
  padding: 16px;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #1c1c22;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.44);
}

.aiw-batch-head,
.aiw-batch-board-head,
.aiw-batch-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.aiw-batch-head {
  padding-bottom: 12px;
  border-bottom: 1px solid #2e2e3a;
}

.aiw-batch-head div,
.aiw-batch-board-head div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.aiw-batch-head span,
.aiw-batch-board-head span,
.aiw-batch-footer,
.aiw-batch-card-actions span {
  color: var(--text2);
  font-size: 12px;
}

.aiw-batch-board {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: 14px;
}

.aiw-batch-source-column,
.aiw-batch-prompt-board,
.aiw-batch-source-box,
.aiw-batch-prompt-card {
  min-width: 0;
}

.aiw-batch-source-column {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
  padding: 12px;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #17181d;
}

.aiw-batch-source-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid #2e2e3a;
}

.aiw-batch-reference-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.aiw-batch-settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.aiw-batch-settings-grid .aiw-field-wide {
  grid-column: 1 / -1;
}

.aiw-batch-settings-grid select,
.aiw-batch-count-field input {
  width: 100%;
  min-width: 0;
}

.aiw-batch-prompt-board {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
  padding: 12px;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #141418;
}

.aiw-batch-prompt-rail {
  min-height: 0;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(230px, 270px);
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.aiw-batch-prompt-card {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(130px, 1fr) auto auto;
  gap: 10px;
  padding: 12px;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #202028;
}

.aiw-batch-prompt-card header,
.aiw-batch-card-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.aiw-batch-prompt-card input,
.aiw-batch-prompt-card textarea,
.aiw-batch-panel .aiw-field input {
  width: 100%;
  min-width: 0;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #141418;
  color: var(--text);
  font: inherit;
}

.aiw-batch-prompt-card input,
.aiw-batch-panel .aiw-field input {
  height: 36px;
  padding: 0 10px;
}

.aiw-batch-prompt-card textarea {
  min-height: 0;
  resize: none;
  padding: 10px;
  line-height: 1.55;
}

.aiw-batch-count-field {
  display: grid;
  grid-template-columns: auto minmax(64px, 88px);
  align-items: center;
  gap: 6px 8px;
  color: var(--text2);
  font-size: 12px;
}

.aiw-batch-count-field input {
  justify-self: end;
}

.aiw-batch-count-field small {
  grid-column: 1 / -1;
  color: var(--text2);
}

.aiw-batch-card-actions {
  align-items: flex-end;
}

.aiw-batch-add-card {
  min-height: 0;
  display: grid;
  place-content: center;
  gap: 6px;
  border-style: dashed;
  background: #17181d;
  color: var(--text);
}

.aiw-batch-add-card span {
  color: var(--text2);
  font-size: 12px;
}

.aiw-batch-footer {
  padding-top: 12px;
  border-top: 1px solid #2e2e3a;
}

.aiw-batch-footer small {
  color: #ff8b5f;
}

.aiw-batch-footer > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.aiw-batch-footer .aiw-primary-action {
  width: auto;
  min-width: 154px;
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

.aiw-task-sidebar-toggle.active {
  border-color: rgba(255, 107, 43, 0.55);
  background: rgba(255, 107, 43, 0.12);
  color: #ff6b2b;
}

.aiw-workspace-body {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 240px);
  gap: 10px;
  overflow: hidden;
}

.aiw-workspace-body.history-collapsed {
  grid-template-columns: minmax(0, 1fr);
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

.aiw-result-prompt-row {
  max-width: min(560px, 58%);
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.aiw-prompt-preview-button {
  min-width: 0;
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 6px 8px;
  border-color: rgba(255, 107, 43, 0.22);
  background: rgba(255, 107, 43, 0.06);
  color: var(--text2);
}

.aiw-prompt-preview-button span {
  min-width: 0;
  font-size: 12px;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiw-prompt-preview-button strong {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #ff8b5f;
  font-size: 12px;
  line-height: 1;
}

.aiw-result-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
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
  background: #10131d;
  color: #fff;
  font-size: 14px;
}

.aiw-loading-source {
  position: absolute;
  inset: -7%;
  z-index: -2;
  width: 114%;
  height: 114%;
  min-height: 0;
  aspect-ratio: auto;
  object-fit: cover;
  filter: blur(18px) saturate(0.72) brightness(0.66);
  transform: scale(1.08);
  animation: aiw-loading-source-breathe 4.8s ease-in-out infinite;
}

.aiw-loading-preview::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    radial-gradient(circle at 24% 22%, rgba(255, 113, 51, 0.26), transparent 34%),
    linear-gradient(180deg, rgba(10, 13, 23, 0.18), rgba(10, 12, 20, 0.70));
}

.aiw-loading-preview::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent 26%, transparent 64%, rgba(4, 6, 13, 0.54)),
    radial-gradient(circle at 50% 48%, transparent 0 52%, rgba(255, 255, 255, 0.035) 53%, transparent 70%);
  pointer-events: none;
}

.aiw-loading-default-art {
  position: absolute;
  inset: 0;
  z-index: -2;
  overflow: hidden;
  background:
    radial-gradient(circle at 72% 26%, rgba(255, 138, 79, 0.26), transparent 28%),
    linear-gradient(155deg, #171a2a 0%, #111827 48%, #07131d 100%);
}

.aiw-loading-default-art::before {
  content: "";
  position: absolute;
  inset: 0;
  opacity: 0.34;
  background-image: radial-gradient(rgba(255, 255, 255, 0.72) 0.8px, transparent 0.8px);
  background-size: 22px 22px;
  mask-image: linear-gradient(180deg, #000, transparent 72%);
}

.aiw-loading-moon {
  position: absolute;
  top: 17%;
  right: 16%;
  width: 24%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: linear-gradient(145deg, #ff9a64, #ff6633);
  box-shadow: 0 0 42px rgba(255, 104, 51, 0.34);
  animation: aiw-loading-moon-drift 5.4s ease-in-out infinite;
}

.aiw-loading-sea {
  position: absolute;
  left: -18%;
  width: 136%;
  height: 38%;
  border-radius: 48% 56% 0 0;
  transform: rotate(-4deg);
}

.aiw-loading-sea.sea-back {
  bottom: 8%;
  background: rgba(57, 76, 119, 0.72);
  animation: aiw-loading-sea-drift 5.8s ease-in-out infinite alternate;
}

.aiw-loading-sea.sea-front {
  bottom: -8%;
  background: rgba(10, 29, 47, 0.96);
  animation: aiw-loading-sea-drift 4.6s ease-in-out -1.2s infinite alternate-reverse;
}

.aiw-loading-shrimp {
  position: absolute;
  top: 40%;
  left: 50%;
  z-index: 1;
  font-size: clamp(38px, 5vw, 64px);
  filter: drop-shadow(0 12px 20px rgba(0, 0, 0, 0.34));
  transform: translate(-50%, -50%) rotate(-8deg);
  animation: aiw-loading-shrimp-float 3.6s ease-in-out infinite;
}

.aiw-loading-default-art > small {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 1;
  color: rgba(255, 255, 255, 0.46);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.aiw-loading-sheen {
  position: absolute;
  inset: -28% -70%;
  z-index: 2;
  background: linear-gradient(100deg, transparent 34%, rgba(255, 255, 255, 0.16) 49%, transparent 64%);
  filter: blur(12px);
  transform: translateX(-32%);
  animation: aiw-loading-sheen 2.8s ease-in-out infinite;
}

.aiw-loading-copy {
  position: absolute;
  right: 14px;
  bottom: 14px;
  left: 14px;
  z-index: 3;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  background: rgba(10, 12, 20, 0.62);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(14px);
}

.aiw-loading-copy strong {
  overflow: hidden;
  color: #fff;
  font-size: 13px;
  text-overflow: ellipsis;
  text-shadow: 0 1px 12px rgba(0, 0, 0, 0.36);
  white-space: nowrap;
}

.aiw-loading-copy small {
  color: rgba(255, 255, 255, 0.58);
  font-size: 10px;
  white-space: nowrap;
}

.aiw-loading-dots {
  display: inline-flex;
  gap: 3px;
}

.aiw-loading-dots i {
  width: 4px;
  height: 4px;
  display: block;
  border-radius: 50%;
  background: #ff6b2b;
  animation: aiw-loading-dot 1.2s ease-in-out infinite;
}

.aiw-loading-dots i:nth-child(2) { animation-delay: 160ms; }
.aiw-loading-dots i:nth-child(3) { animation-delay: 320ms; }

@keyframes aiw-loading-source-breathe {
  0%, 100% { transform: scale(1.08); }
  50% { transform: scale(1.14); }
}

@keyframes aiw-loading-sheen {
  0% { transform: translateX(-34%); opacity: 0; }
  30%, 65% { opacity: 0.9; }
  100% { transform: translateX(34%); opacity: 0; }
}

@keyframes aiw-loading-sea-drift {
  from { transform: translateX(-2%) rotate(-4deg); }
  to { transform: translateX(3%) rotate(2deg); }
}

@keyframes aiw-loading-moon-drift {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(8px); }
}

@keyframes aiw-loading-shrimp-float {
  0%, 100% { transform: translate(-50%, -50%) rotate(-8deg); }
  50% { transform: translate(-50%, calc(-50% - 8px)) rotate(3deg); }
}

@keyframes aiw-loading-dot {
  0%, 70%, 100% { opacity: 0.34; transform: translateY(0); }
  35% { opacity: 1; transform: translateY(-3px); }
}

.aiw-failed-preview {
  min-height: 214px;
  display: grid;
  place-content: center;
  gap: 8px;
  padding: 18px;
  background: rgba(166, 48, 48, 0.12);
  color: #ffb3a7;
  text-align: center;
}

.aiw-failed-preview span {
  color: var(--text2);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
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
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}

.aiw-result-card-meta {
  min-width: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.aiw-result-card-meta span {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiw-result-card-actions {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.aiw-result-card-actions button {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 7px 4px;
  font-size: 11px;
  white-space: nowrap;
}

.aiw-result-card-actions .aiw-icon-button-content {
  gap: 4px;
}

.aiw-history-sidebar {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #141418;
  overflow: auto;
}

.aiw-history-sidebar ol {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
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

.aiw-lightbox-layout {
  width: min(94vw, 1360px);
  height: calc(100vh - 56px);
  max-height: calc(100vh - 56px);
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 380px);
  gap: 14px;
  overflow: hidden;
}

.aiw-lightbox-image-pane,
.aiw-lightbox-edit-panel {
  min-height: 0;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #141418;
}

.aiw-lightbox-image-pane {
  min-width: 0;
  height: 100%;
  display: flex;
  padding: 12px;
  overflow: hidden;
}

.aiw-lightbox figure {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto auto;
  gap: 10px;
  margin: 0;
  overflow: hidden;
}

.aiw-lightbox-canvas,
.aiw-lightbox-fallback {
  min-height: 0;
  height: 100%;
  width: 100%;
  border-radius: 8px;
}

.aiw-lightbox-canvas {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #2e2e3a;
  background: #0f1016;
}

.aiw-lightbox-main-image {
  width: 100%;
  height: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 8px;
}

.aiw-lightbox-main-image.blurred,
.aiw-lightbox-preview-strip img.blurred {
  filter: blur(6px) saturate(0.82);
  transform: scale(1.02);
}

.aiw-lightbox-fallback {
  display: grid;
  place-items: center;
  background: #f4f2ee;
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

.aiw-lightbox-preview-strip {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 76px;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 1px 4px;
}

.aiw-lightbox-preview-strip button {
  position: relative;
  min-width: 0;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  overflow: hidden;
  padding: 0;
  border-color: #2e2e3a;
  background: #242430;
  color: #fff;
}

.aiw-lightbox-preview-strip button.active {
  border-color: rgba(255, 107, 43, 0.78);
  box-shadow: 0 0 0 2px rgba(255, 107, 43, 0.18);
}

.aiw-lightbox-preview-strip img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.aiw-lightbox-preview-strip small {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 4px;
  overflow: hidden;
  background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.72));
  color: #fff;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiw-edit-loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-content: center;
  gap: 10px;
  background: rgba(20, 20, 24, 0.26);
  color: #fff;
  pointer-events: auto;
  text-shadow: 0 1px 14px rgba(0, 0, 0, 0.36);
}

.aiw-edit-spinner {
  width: 26px;
  height: 26px;
  display: inline-block;
  border: 2px solid rgba(255, 255, 255, 0.28);
  border-top-color: #ff6b2b;
  border-radius: 999px;
  animation: aiw-edit-spin 820ms linear infinite;
}

.aiw-lightbox-preview-strip .aiw-edit-spinner {
  position: absolute;
  width: 24px;
  height: 24px;
}

.aiw-lightbox-annotation-layer {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
}

.aiw-lightbox-annotation-layer.active {
  pointer-events: auto;
}

.aiw-lightbox-annotation-layer :deep(.aiw-tldraw-host),
.aiw-lightbox-annotation-layer :deep(.aiw-tldraw-root),
.aiw-lightbox-annotation-layer :deep(.tl-container),
.aiw-lightbox-annotation-layer :deep(.tl-canvas) {
  min-height: 0;
  height: 100%;
  width: 100%;
  background: transparent !important;
  overscroll-behavior: contain;
  touch-action: none;
}

.aiw-lightbox-annotation-layer :deep(.tl-container) {
  --tl-color-background: transparent;
}

.aiw-lightbox-annotation-layer :deep(.tl-background),
.aiw-lightbox-annotation-layer :deep(.tl-background__wrapper) {
  background: transparent !important;
}

.aiw-lightbox-annotation-toolbar {
  position: absolute;
  left: 50%;
  bottom: 14px;
  z-index: 6;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  padding: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(20, 20, 24, 0.86);
  backdrop-filter: blur(12px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.36);
}

.aiw-annotation-color-strip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 5px 0 1px;
  border-right: 1px solid rgba(255, 255, 255, 0.12);
}

.aiw-annotation-color-button {
  width: 22px;
  height: 22px;
  min-height: 0;
  display: block;
  padding: 0;
  border-color: rgba(255, 255, 255, 0.2);
  border-radius: 999px;
  background: var(--aiw-annotation-color);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.28);
}

.aiw-annotation-color-button.active {
  border-color: #fff;
  box-shadow: 0 0 0 2px rgba(255, 107, 43, 0.55), inset 0 0 0 1px rgba(0, 0, 0, 0.28);
}

.aiw-lightbox-annotation-toolbar > button {
  min-height: 28px;
  padding: 6px 9px;
  border-color: rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font-size: 12px;
}

.aiw-lightbox-annotation-toolbar > button.active {
  border-color: rgba(255, 107, 43, 0.6);
  background: #ff6b2b;
  color: #fff;
}

@keyframes aiw-edit-spin {
  to { transform: rotate(360deg); }
}

.aiw-lightbox-edit-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  overflow: auto;
}

.aiw-lightbox-edit-panel header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid #2e2e3a;
}

.aiw-lightbox-edit-panel header div,
.aiw-edit-source-prompt,
.aiw-edit-reference-box {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.aiw-lightbox-edit-panel header span,
.aiw-edit-source-prompt span,
.aiw-lightbox-edit-panel small {
  color: var(--text2);
  font-size: 12px;
}

.aiw-edit-source-prompt {
  padding: 10px;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #1c1c22;
}

.aiw-edit-prompt-chain {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 178px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.aiw-edit-prompt-chain li {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.aiw-edit-prompt-chain li:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.aiw-edit-prompt-chain strong {
  color: #ff8b5f;
  font-size: 12px;
}

.aiw-edit-prompt-chain p {
  max-height: 132px;
  margin: 0;
  overflow: auto;
  color: var(--text);
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.aiw-lightbox-edit-panel textarea {
  min-height: 116px;
  resize: vertical;
  padding: 10px;
  line-height: 1.6;
}

.aiw-lightbox-reference-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.aiw-lightbox-close {
  flex: 0 0 auto;
}

.aiw-prompt-dialog {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 28px;
  background: rgba(10, 10, 14, 0.82);
  backdrop-filter: blur(10px);
}

.aiw-prompt-dialog section {
  width: min(760px, 92vw);
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #1c1c22;
}

.aiw-prompt-dialog header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.aiw-prompt-dialog header div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.aiw-prompt-dialog header span {
  color: var(--text2);
  font-size: 12px;
}

.aiw-prompt-dialog pre {
  min-height: 180px;
  max-height: 64vh;
  margin: 0;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 14px;
  border: 1px solid #2e2e3a;
  border-radius: 8px;
  background: #141418;
  color: var(--text);
  font: 13px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace;
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

.aiw-icon-button-content {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  line-height: 1;
  white-space: nowrap;
}

.aiw-button-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
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
.aiw-top-primary,
.aiw-ghost {
  border-color: rgba(255, 107, 43, 0.35);
  background: rgba(255, 107, 43, 0.1);
  color: #ff6b2b;
}

.aiw-primary-action,
.aiw-top-primary {
  width: 100%;
  min-height: 42px;
  background: #ff6b2b;
  color: #fff;
}

.aiw-primary-action.loading {
  cursor: wait;
  opacity: 0.86;
}

.aiw-primary-action .aiw-edit-spinner {
  width: 16px;
  height: 16px;
  border-width: 2px;
}

.aiw-top-primary {
  width: auto;
}

.aiw-ghost {
  flex: 0 0 auto;
}

@media (max-width: 1060px) {
  .aiw-main-grid,
  .aiw-result-list {
    grid-template-columns: 1fr;
  }

  .aiw-lightbox-layout {
    grid-template-columns: 1fr;
    overflow: auto;
  }

  .aiw-topbar,
  .aiw-workspace-head {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 760px) {
  .aiw-batch-dialog {
    padding: 14px;
  }

  .aiw-batch-board {
    grid-template-columns: 1fr;
    grid-template-rows: max-content minmax(340px, auto);
    overflow: auto;
  }

  .aiw-batch-source-column {
    min-height: auto;
    overflow: visible;
  }

  .aiw-batch-prompt-board {
    min-height: 340px;
  }

  .aiw-batch-panel {
    width: 100%;
    height: calc(100vh - 28px);
    padding: 12px;
  }

  .aiw-batch-head,
  .aiw-batch-board-head,
  .aiw-batch-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .aiw-batch-footer > div {
    width: 100%;
  }

  .aiw-batch-footer button {
    flex: 1 1 0;
  }

  .aiw-workspace-body {
    grid-template-columns: 1fr;
  }
}

  @media (prefers-reduced-motion: reduce) {
    .aiw-loading-source,
    .aiw-loading-sheen,
    .aiw-loading-moon,
    .aiw-loading-sea,
    .aiw-loading-shrimp,
    .aiw-loading-dots i {
      animation: none;
    }
  }
</style>
