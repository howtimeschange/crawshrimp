<template>
  <div :class="['runner', { 'ai-chain-runner': isTmallAiImageChainTask }]">
    <!-- 页头 -->
    <header class="runner-header">
      <h2>{{ task?.task_name }}</h2>
      <p v-if="task?.description" class="desc">{{ task.description }}</p>
    </header>

    <nav v-if="isTmallAiImageChainTask" class="ai-chain-tabs" role="tablist" aria-label="巴拉-AI测图全链路步骤">
      <button
        v-for="step in aiChainSteps"
        :key="step.id"
        type="button"
        role="tab"
        :aria-selected="aiChainActiveStep === step.id"
        :class="['ai-chain-tab', step.state, { selected: aiChainActiveStep === step.id }]"
        @click="setAiChainActiveStep(step.id)"
      >
        <span class="ai-chain-tab-index">{{ step.index }}</span>
        <div>
          <strong>{{ step.title }}</strong>
          <span>{{ step.detail }}</span>
        </div>
      </button>
    </nav>

    <div class="runner-body">
      <!-- 参数面板 -->
      <div
        v-if="(!isTmallAiImageChainTask || aiChainActiveStep === 'config') && visibleParams.length"
        :class="['params-panel', { 'ai-chain-step-panel': isTmallAiImageChainTask }]"
      >
        <div v-if="isTmallAiImageChainTask" class="ai-chain-panel-head">
          <span>01</span>
          <div>
            <strong>任务配置</strong>
            <small>选择导入表、提示词库、云盘路径和执行模式</small>
          </div>
        </div>
        <div v-if="hasParamProbeScript && (dynamicParamProbeLoading || dynamicParamProbeError)" class="probe-note">
          <span v-if="dynamicParamProbeLoading">正在探测页面筛选项…</span>
          <span v-else>{{ dynamicParamProbeError }}</span>
        </div>
        <div :class="['params-grid', paramsGridClass]">
          <div v-for="param in visibleParams" :key="param.id" :class="['param-group', paramLayoutClass(param)]">
            <label class="param-label">
              {{ param.label }}
              <span v-if="param.required" class="required">*</span>
            </label>

            <!-- 文本输入 -->
            <template v-if="param.type === 'text'">
              <input
                v-model="values[param.id]"
                :placeholder="param.placeholder || ''"
                class="input"
              />
              <div v-if="getQuickFillOptions(param).length" class="param-quick-fill-list">
                <button
                  v-for="option in getQuickFillOptions(param)"
                  :key="option"
                  type="button"
                  class="param-quick-fill-chip"
                  @click="applyQuickFill(param, option)"
                >
                  {{ option }}
                </button>
              </div>
              <p v-if="param.hint" class="hint">{{ param.hint }}</p>
            </template>

            <template v-else-if="param.type === 'directory'">
              <div class="file-picker">
                <div class="file-chosen" :class="{ empty: !values[param.id] }" @click="pickDirectory(param)">
                  <span class="f-ico">📁</span>
                  <span class="f-label">{{ values[param.id] ? fileName(values[param.id]) : (param.placeholder || '点击选择目录…') }}</span>
                  <span v-if="values[param.id]" class="f-clear" @click.stop="clearDirectory(param.id)">✕</span>
                </div>
                <div class="file-picker-actions">
                  <button class="btn-pick" @click="pickDirectory(param)">选择目录</button>
                </div>
              </div>
              <p v-if="param.include_file_listing && directoryListingLoading[param.id]" class="hint">正在扫描目录文件…</p>
              <p v-else-if="param.include_file_listing && directoryListingError[param.id]" class="hint">{{ directoryListingError[param.id] }}</p>
              <p v-else-if="param.include_file_listing && (values[param.id + '_files'] || []).length" class="hint">已扫描 {{ values[param.id + '_files'].length }} 个文件</p>
              <p v-if="param.hint" class="hint">{{ param.hint }}</p>
            </template>

            <template v-else-if="param.type === 'textarea' && !isLineListParam(param)">
              <textarea
                v-model="values[param.id]"
                :placeholder="param.placeholder || ''"
                :class="['textarea', { 'textarea-compact': getTextareaRows(param) <= 3 }]"
                :rows="getTextareaRows(param)"
              ></textarea>
              <div v-if="getQuickFillOptions(param).length" class="param-quick-fill-list">
                <button
                  v-for="option in getQuickFillOptions(param)"
                  :key="option"
                  type="button"
                  class="param-quick-fill-chip"
                  @click="applyQuickFill(param, option)"
                >
                  {{ option }}
                </button>
              </div>
              <p v-if="param.hint" class="hint">{{ param.hint }}</p>
            </template>

            <template v-else-if="isLineListParam(param)">
              <div class="line-list">
                <div
                  v-for="(line, index) in getLineListRows(param.id)"
                  :key="`${param.id}-${index}`"
                  class="line-list-row"
                >
                  <input
                    :value="line"
                    :placeholder="param.placeholder || ''"
                    class="input line-list-input"
                    @input="event => updateLineListRow(param.id, index, event.target.value)"
                  />
                  <button
                    type="button"
                    class="line-list-remove"
                    :disabled="getLineListRows(param.id).length <= 1"
                    title="删除这一行"
                    aria-label="删除这一行"
                    @click="removeLineListRow(param.id, index)"
                  >
                    ×
                  </button>
                </div>
                <button type="button" class="line-list-add" @click="addLineListRow(param.id)">
                  + {{ param.add_label || '新增一行' }}
                </button>
              </div>
              <p v-if="param.hint" class="hint">{{ param.hint }}</p>
            </template>

            <!-- 单选框 -->
            <template v-else-if="param.type === 'radio'">
              <div class="radio-group">
                <label v-for="opt in param.options" :key="opt.value" class="radio-item">
                  <input
                    type="radio"
                    :name="param.id"
                    :value="opt.value"
                    v-model="values[param.id]"
                  />
                  <span class="radio-label">{{ opt.label }}</span>
                </label>
              </div>
            </template>

            <!-- 下拉选择 -->
            <template v-else-if="param.type === 'select'">
              <select v-model="values[param.id]" class="select">
                <option v-for="opt in param.options" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
              <template v-if="shouldShowInlineCustomDate(param)">
                <div class="custom-date-hint">自定义范围</div>
                <div class="date-range" style="margin-top:6px">
                  <input type="date" v-model="values['_custom_start_' + param.id]" class="input" />
                  <span class="date-sep">~</span>
                  <input type="date" v-model="values['_custom_end_' + param.id]" class="input" />
                </div>
              </template>
              <p v-if="param.hint" class="hint">{{ param.hint }}</p>
            </template>

            <!-- 复选框组 -->
            <template v-else-if="param.type === 'checkbox'">
              <div v-if="isCheckboxDropdown(param)" class="multi-select" data-multi-select-root>
                <button
                  type="button"
                  :class="['multi-select-trigger', { open: isMultiSelectOpen(param.id), empty: !(values[param.id] || []).length }]"
                  @click="toggleMultiSelect(param.id)"
                >
                  <span class="multi-select-trigger-text">{{ getCheckboxSelectionSummary(param) }}</span>
                  <span class="multi-select-trigger-icon">{{ isMultiSelectOpen(param.id) ? '▴' : '▾' }}</span>
                </button>
                <div v-if="isMultiSelectOpen(param.id)" class="multi-select-panel">
                  <div class="multi-select-head">
                    <span>支持复选</span>
                    <button
                      v-if="(values[param.id] || []).length"
                      type="button"
                      class="multi-select-clear"
                      @click.stop="clearCheckboxSelection(param.id)"
                    >
                      清空
                    </button>
                  </div>
                  <div class="multi-select-options">
                    <label v-for="opt in param.options" :key="opt.value" class="multi-select-option">
                      <input
                        type="checkbox"
                        :value="opt.value"
                        v-model="values[param.id]"
                      />
                      <span class="multi-select-option-label">{{ opt.label }}</span>
                    </label>
                  </div>
                </div>
              </div>
              <div v-else class="checkbox-group">
                <label v-for="opt in param.options" :key="opt.value" class="checkbox-item">
                  <input
                    type="checkbox"
                    :value="opt.value"
                    v-model="values[param.id]"
                  />
                  <span class="checkbox-label">{{ opt.label }}</span>
                </label>
              </div>
              <p v-if="param.hint" class="hint">{{ param.hint }}</p>
            </template>

            <!-- 日期区间 -->
            <template v-else-if="isRangeParamType(param.type)">
              <div v-if="shouldShowDateRangeParam(param)" class="date-range-panel">
                <div class="date-range">
                  <div
                    class="date-card"
                    role="button"
                    tabindex="0"
                    @click="openDatePicker(param.id + '_start')"
                    @keydown.enter.prevent="openDatePicker(param.id + '_start')"
                    @keydown.space.prevent="openDatePicker(param.id + '_start')"
                  >
                    <input
                      :ref="el => setDateInputRef(param.id + '_start', el)"
                      :type="getTemporalInputType(param.type)"
                      v-model="values[param.id + '_start']"
                      class="date-card-input"
                    />
                    <span :class="['date-card-value', { placeholder: !values[param.id + '_start'] }]">
                      {{ formatTemporalDisplay(values[param.id + '_start'], param.type) }}
                    </span>
                    <span class="date-card-icon" aria-hidden="true">选择</span>
                  </div>
                  <span class="date-sep">至</span>
                  <div
                    class="date-card"
                    role="button"
                    tabindex="0"
                    @click="openDatePicker(param.id + '_end')"
                    @keydown.enter.prevent="openDatePicker(param.id + '_end')"
                    @keydown.space.prevent="openDatePicker(param.id + '_end')"
                  >
                    <input
                      :ref="el => setDateInputRef(param.id + '_end', el)"
                      :type="getTemporalInputType(param.type)"
                      v-model="values[param.id + '_end']"
                      class="date-card-input"
                    />
                    <span :class="['date-card-value', { placeholder: !values[param.id + '_end'] }]">
                      {{ formatTemporalDisplay(values[param.id + '_end'], param.type) }}
                    </span>
                    <span class="date-card-icon" aria-hidden="true">选择</span>
                  </div>
                </div>
              </div>
            </template>

            <template v-else-if="isSingleTemporalParamType(param.type)">
              <div class="date-range-panel">
                <div class="date-range">
                  <div
                    class="date-card"
                    role="button"
                    tabindex="0"
                    @click="openDatePicker(param.id)"
                    @keydown.enter.prevent="openDatePicker(param.id)"
                    @keydown.space.prevent="openDatePicker(param.id)"
                  >
                    <input
                      :ref="el => setDateInputRef(param.id, el)"
                      :type="getTemporalInputType(param.type)"
                      v-model="values[param.id]"
                      class="date-card-input"
                    />
                    <span :class="['date-card-value', { placeholder: !values[param.id] }]">
                      {{ formatTemporalDisplay(values[param.id], param.type) }}
                    </span>
                    <span class="date-card-icon" aria-hidden="true">选择</span>
                  </div>
                </div>
                <p v-if="param.hint" class="hint">{{ param.hint }}</p>
              </div>
            </template>

            <!-- 数字 -->
            <template v-else-if="param.type === 'number'">
              <input
                type="number"
                v-model.number="values[param.id]"
                :min="param.min" :max="param.max" :step="param.step || 1"
                class="input input-number"
              />
            </template>

            <!-- Excel / CSV 文件上传 -->
            <template v-else-if="param.type === 'file_excel'">
              <div class="file-picker">
                <div class="file-chosen" :class="{ empty: !values[param.id + '_path'] }" @click="pickExcel(param.id)">
                  <span class="f-ico">📊</span>
                  <span class="f-label">{{ values[param.id + '_path'] ? fileName(values[param.id + '_path']) : '点击选择 Excel / CSV 文件…' }}</span>
                  <span v-if="values[param.id + '_path']" class="f-clear" @click.stop="clearExcel(param.id)">✕</span>
                </div>
                <div class="file-picker-actions">
                  <button class="btn-pick" @click="pickExcel(param.id)">选择文件</button>
                </div>
              </div>
              <div v-if="getParamTemplates(param).length" class="template-list">
                <div
                  v-for="(template, index) in getParamTemplates(param)"
                  :key="template.file || index"
                  class="template-card"
                >
                  <div class="template-main">
                    <div class="template-title-row">
                      <span class="template-name">{{ template.label || fileName(template.file || '') }}</span>
                      <span class="template-ext">{{ templateExtension(template) }}</span>
                      <span v-if="template.version" class="template-version">v{{ template.version }}</span>
                    </div>
                    <p v-if="template.description" class="template-desc">{{ template.description }}</p>
                  </div>
                  <button
                    class="btn-template"
                    :disabled="!canDownloadTemplate(template)"
                    @click="downloadTemplate(task, param, template)"
                  >
                    下载
                  </button>
                </div>
              </div>
              <div
                v-if="templateFeedback[param.id]"
                :class="['template-feedback', templateFeedback[param.id].ok ? 'ok' : 'err']"
              >
                {{ templateFeedback[param.id].msg }}
              </div>
              <div v-if="values[param.id + '_rows']?.length" class="excel-preview">
                <span class="preview-count">已读取 {{ values[param.id + '_rows'].length }} 行</span>
                <span class="preview-cols">列：{{ values[param.id + '_headers']?.join(' / ') }}</span>
              </div>
              <div v-if="excelLoading[param.id]" class="excel-loading">读取文件中…</div>
              <p v-if="param.hint" class="hint">{{ param.hint }}</p>
            </template>

            <!-- 多图上传 -->
            <template v-else-if="param.type === 'file_images'">
              <div class="file-picker">
                <div class="file-chosen" :class="{ empty: !(values[param.id + '_paths'] || []).length }" @click="pickImages(param)">
                  <span class="f-ico">🖼</span>
                  <span class="f-label">
                    {{ imageSummary(param) }}
                  </span>
                  <span v-if="(values[param.id + '_paths'] || []).length" class="f-clear" @click.stop="clearImages(param.id)">✕</span>
                </div>
                <div class="file-picker-actions">
                  <button class="btn-pick" @click="pickImages(param)">选择图片</button>
                </div>
              </div>
              <div v-if="(values[param.id + '_paths'] || []).length" class="image-file-list">
                <span
                  v-for="path in values[param.id + '_paths']"
                  :key="path"
                  class="image-file-chip"
                >
                  {{ fileName(path) }}
                </span>
              </div>
              <p v-if="param.hint" class="hint">{{ param.hint }}</p>
            </template>

            <template v-else-if="param.type === 'file_zip' || param.type === 'file_pdf'">
              <div class="file-picker">
                <div class="file-chosen" :class="{ empty: !(values[param.id + '_paths'] || []).length }" @click="pickFilePaths(param)">
                  <span class="f-ico">{{ filePickerIcon(param) }}</span>
                  <span class="f-label">
                    {{ filePathsSummary(param) }}
                  </span>
                  <span v-if="(values[param.id + '_paths'] || []).length" class="f-clear" @click.stop="clearFilePaths(param.id)">✕</span>
                </div>
                <div class="file-picker-actions">
                  <button class="btn-pick" @click="pickFilePaths(param)">{{ filePickerButtonLabel(param) }}</button>
                </div>
              </div>
              <div v-if="(values[param.id + '_paths'] || []).length" class="image-file-list">
                <span
                  v-for="path in values[param.id + '_paths']"
                  :key="path"
                  class="image-file-chip"
                >
                  {{ fileName(path) }}
                </span>
              </div>
              <div v-if="pdfCropTypeForFilesParam(param)" class="pdf-crop-actions">
                <button type="button" class="btn-pick" @click="openPdfCropModal(pdfCropTypeForFilesParam(param))">{{ pdfCropButtonLabel(pdfCropTypeForFilesParam(param)) }}</button>
                <span class="pdf-crop-status">{{ pdfCropTemplateSummaryForType(pdfCropTypeForFilesParam(param)) }}</span>
              </div>
              <p v-if="param.hint" class="hint">{{ param.hint }}</p>
            </template>
          </div>
        </div>

        <!-- 执行按钮 -->
        <div class="action-row">
          <button
            class="run-btn"
            :class="{ running: isRunning }"
            :disabled="isRunning || missingRequired"
            @click="runTask"
          >
            <span v-if="isRunning">{{ runningLabel }}</span>
            <span v-else>▶ 立即执行</span>
          </button>
          <button
            v-if="isTaskOdpsSyncable"
            class="run-sub-btn run-sync-btn"
            :disabled="isRunning || missingRequired"
            @click="runTaskAndSyncOdps"
          >
            立即执行并同步DataWorks
          </button>
          <button
            v-if="autoPrecheckFlow"
            class="run-sub-btn"
            :disabled="isRunning || missingRequired"
            @click="runValidationOnly"
          >
            {{ validationOnlyLabel }}
          </button>
          <button
            v-if="isRunning && liveStatus === 'running'"
            class="run-sub-btn"
            @click="pauseCurrentTask"
          >
            暂停
          </button>
          <button
            v-if="isRunning && (liveStatus === 'paused' || liveStatus === 'pausing')"
            class="run-sub-btn"
            @click="resumeCurrentTask"
          >
            继续
          </button>
          <button
            v-if="isRunning"
            class="run-sub-btn run-sub-btn-stop"
            :disabled="liveStatus === 'stopping'"
            @click="stopCurrentTask"
          >
            停止
          </button>
          <span v-if="autoPrecheckFlow" class="action-note">{{ autoPrecheckNote }}</span>
          <span v-if="isRunning" class="reset-link" @click="forceReset">重置</span>
          <span v-if="missingRequired" class="missing-hint">请填写必填项</span>
          <span v-if="lastResult" :class="['result-badge', lastResult.ok ? 'ok' : 'err']">
            {{ lastResult.msg }}
          </span>
          <button
            v-if="approvalBoardUrl && !isTmallAiImageChainTask"
            type="button"
            class="run-sub-btn"
            @click="openApprovalDrawer"
          >
            审图看板
          </button>
        </div>
      </div>

      <!-- 无参数任务的执行按钮 -->
      <div
        v-else-if="!isTmallAiImageChainTask || aiChainActiveStep === 'config'"
        :class="['params-panel', { 'ai-chain-step-panel': isTmallAiImageChainTask }]"
      >
        <div v-if="isTmallAiImageChainTask" class="ai-chain-panel-head">
          <span>01</span>
          <div>
            <strong>任务配置</strong>
            <small>当前任务无额外参数</small>
          </div>
        </div>
        <div class="action-row">
          <button
            class="run-btn"
            :class="{ running: isRunning }"
            :disabled="isRunning"
            @click="runTask"
          >
            <span v-if="isRunning">{{ runningLabel }}</span>
            <span v-else>▶ 立即执行</span>
          </button>
          <button
            v-if="isTaskOdpsSyncable"
            class="run-sub-btn run-sync-btn"
            :disabled="isRunning"
            @click="runTaskAndSyncOdps"
          >
            立即执行并同步DataWorks
          </button>
          <button
            v-if="isRunning && liveStatus === 'running'"
            class="run-sub-btn"
            @click="pauseCurrentTask"
          >
            暂停
          </button>
          <button
            v-if="isRunning && (liveStatus === 'paused' || liveStatus === 'pausing')"
            class="run-sub-btn"
            @click="resumeCurrentTask"
          >
            继续
          </button>
          <button
            v-if="isRunning"
            class="run-sub-btn run-sub-btn-stop"
            :disabled="liveStatus === 'stopping'"
            @click="stopCurrentTask"
          >
            停止
          </button>
          <span v-if="isRunning" class="reset-link" @click="forceReset">重置</span>
          <button
            v-if="approvalBoardUrl && !isTmallAiImageChainTask"
            type="button"
            class="run-sub-btn"
            @click="openApprovalDrawer"
          >
            审图看板
          </button>
        </div>
      </div>

      <section
        v-if="isTmallAiImageChainTask && aiChainActiveStep === 'approval'"
        class="ai-chain-step-panel ai-chain-approval-panel"
      >
        <div class="ai-chain-panel-head">
          <span>02</span>
          <div>
            <strong>生图看板 / 审批</strong>
            <small>{{ approvalBoardUrl ? '查看本批次原图、AI 图和 Prompt，确认后触发创建' : '任务生图完成后会自动显示图片看板' }}</small>
          </div>
        </div>
        <TmallAiApprovalDrawer
          v-if="approvalBoardUrl"
          :model-value="true"
          :board-url="approvalBoardUrl"
          embedded
          :show-submit-results="false"
          @batch-updated="handleApprovalBatchUpdated"
        />
        <div v-else class="ai-chain-empty-panel">
          <strong>等待生图批次</strong>
          <span>执行第一步后，这里会展示原图、AI 图、Prompt 和确认/舍弃状态。</span>
        </div>
      </section>

      <section
        v-if="isTmallAiImageChainTask && aiChainActiveStep === 'create'"
        class="ai-chain-step-panel ai-chain-result-panel"
      >
        <div class="ai-chain-panel-head">
          <span>03</span>
          <div>
            <strong>实际测图任务创建结果</strong>
            <small>{{ aiChainCreateSummary }}</small>
          </div>
        </div>
        <div v-if="aiChainCreateRows.length" class="ai-chain-result-list">
          <div
            v-for="row in aiChainCreateRows"
            :key="`${row.款号 || ''}-${row.任务ID || row.备注 || ''}`"
            :class="['ai-chain-result-row', String(row.执行结果 || '').includes('失败') ? 'error' : 'ok']"
          >
            <div class="ai-chain-result-main">
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
            <div class="ai-chain-result-note">
              <span>{{ row.执行结果 || '-' }}</span>
              <small v-if="row.备注">{{ row.备注 }}</small>
            </div>
          </div>
        </div>
        <div v-else class="ai-chain-empty-panel compact">
          <strong>尚未创建测图任务</strong>
          <span>第二步提交后，这里会显示任务 ID、上传数量、页面回读和失败原因。</span>
        </div>
      </section>

      <!-- 运行日志 -->
      <div class="log-panel">
        <div class="log-header">
          <span>运行日志</span>
          <div class="log-actions">
            <span v-if="outputFiles.length" class="output-count" @click="showFiles = !showFiles">
              📁 {{ outputFiles.length }} 个输出项
            </span>
            <button
              v-if="canSyncOdps && latestExcelOutput"
              class="clear-btn sync-btn"
              :disabled="syncingOdps"
              @click="syncLatestOdps"
            >
              {{ syncingOdps ? '同步中…' : '同步至数仓' }}
            </button>
            <button class="clear-btn" @click="clearLogs">清空</button>
          </div>
        </div>

        <div v-if="progressSummary && useEnhancedProgressUi" class="progress-strip" aria-live="polite">
          <div class="progress-strip-head">
            <div class="progress-strip-main">
              <span class="progress-strip-title">{{ progressSummary.title }}</span>
              <span class="progress-strip-value">{{ progressSummary.main }}</span>
              <span class="progress-strip-percent">{{ progressSummary.percentLabel }}</span>
            </div>
            <div class="progress-strip-meta">
              <span
                v-for="metaItem in (progressSummary.metaItems || []).filter(Boolean)"
                :key="metaItem"
              >{{ metaItem }}</span>
            </div>
          </div>
          <div class="progress-strip-stack progress-stage-stack">
            <div
              v-for="track in (progressSummary.tracks || [])"
              :key="track.id || track.title"
              :class="[
                'progress-stage-card',
                `progress-stage-card-${track.tone || 'primary'}`,
                `progress-stage-card-${track.state || 'pending'}`,
              ]"
            >
              <div class="progress-stage-card-head">
                <div class="progress-stage-card-kicker">
                  <span class="progress-stage-card-title">{{ track.title }}</span>
                  <span v-if="track.status" class="progress-stage-card-status">{{ track.status }}</span>
                </div>
                <div class="progress-stage-card-mainline">
                  <span class="progress-stage-card-main">{{ track.main }}</span>
                  <span class="progress-stage-card-percent">{{ track.percentLabel }}</span>
                </div>
              </div>

              <div v-if="track.caption || track.detail" class="progress-stage-card-meta">
                <span v-if="track.caption">{{ track.caption }}</span>
                <span v-if="track.detail">{{ track.detail }}</span>
              </div>

              <div
                :class="[
                  'progress-strip-bar',
                  'progress-stage-bar',
                  track.tone === 'secondary' ? 'progress-strip-bar-secondary' : '',
                  { indeterminate: track.indeterminate }
                ]"
                role="progressbar"
                :aria-label="track.ariaLabel || progressSummary.ariaLabel"
                :aria-valuenow="track.indeterminate ? null : track.percentValue"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuetext="track.ariaText || progressSummary.ariaText"
                :aria-busy="track.indeterminate ? 'true' : 'false'"
              >
                <div
                  :class="[
                    'progress-strip-bar-fill',
                    track.tone === 'secondary' ? 'progress-strip-bar-fill-secondary' : '',
                    { indeterminate: track.indeterminate }
                  ]"
                  :style="track.indeterminate ? undefined : { width: `${track.percentValue}%` }"
                ></div>
              </div>
            </div>
          </div>
          <div class="progress-strip-sub">{{ progressSummary.sub }}</div>
        </div>

        <div v-else-if="progressSummary" class="progress-strip" aria-live="polite">
          <div class="progress-strip-head">
            <div class="progress-strip-main">
              <span class="progress-strip-title">批处理进度</span>
              <span class="progress-strip-value">{{ progressSummary.main }}</span>
              <span class="progress-strip-percent">{{ progressSummary.percentLabel }}</span>
            </div>
            <div class="progress-strip-meta">
              <span>已完成 {{ progressSummary.completed }} 条</span>
              <span v-if="progressSummary.batchText">{{ progressSummary.batchText }}</span>
              <span v-if="progressSummary.rowText">{{ progressSummary.rowText }}</span>
              <span v-if="progressSummary.targetText">{{ progressSummary.targetText }}</span>
            </div>
          </div>
          <div
            class="progress-strip-bar"
            role="progressbar"
            :aria-label="progressSummary.ariaLabel"
            :aria-valuenow="progressSummary.percentValue"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuetext="progressSummary.ariaText"
          >
            <div class="progress-strip-bar-fill" :style="{ width: `${progressSummary.percentValue}%` }"></div>
          </div>
          <div class="progress-strip-sub">{{ progressSummary.sub }}</div>
        </div>

        <!-- 输出文件列表 -->
        <div v-if="showFiles && outputFiles.length" class="file-list">
          <div v-for="f in outputFiles" :key="f" class="file-item">
            <div class="file-item-main" @click="openFile(f)">
              <span class="file-icon">{{ outputPathIcon(f) }}</span>
              <span class="file-name">{{ fileName(f) }}</span>
              <span class="file-open">打开 →</span>
            </div>
            <button
              v-if="canSyncOdps && isExcelFile(f)"
              class="file-sync"
              :disabled="syncingOdps"
              @click.stop="syncOdpsFiles([f])"
            >
              同步
            </button>
          </div>
        </div>

        <div class="log-body" ref="logEl">
          <div v-if="!logs.length" class="log-empty">等待任务执行…</div>
          <div v-for="(line, i) in logs" :key="i" :class="['log-line', logClass(line)]">{{ line }}</div>
        </div>
      </div>
    </div>

    <div v-if="pdfCropModal.open" class="pdf-crop-modal" @click.self="closePdfCropModal">
      <div class="pdf-crop-dialog">
        <div class="pdf-crop-head">
          <div>
            <div class="pdf-crop-title">{{ pdfCropModal.type === 'wash_label' ? '洗唛截图框模板' : '吊牌截图框模板' }}</div>
            <div class="pdf-crop-subtitle">拖动矩形移动位置，拖动边角或边线调整宽高；保存后同类型 PDF 的每一页都会套用该模板。</div>
          </div>
          <button type="button" class="pdf-crop-close" @click="closePdfCropModal">×</button>
        </div>

        <div class="pdf-crop-toolbar">
          <select v-model="pdfCropModal.previewPath" class="select" @change="event => loadPdfCropPreview(event.target.value)">
            <option
              v-for="path in pdfCropSourcePaths"
              :key="path"
              :value="path"
            >
              {{ fileName(path) }}
            </option>
          </select>
          <div class="pdf-crop-page-controls">
            <button type="button" class="pdf-crop-page-step" :disabled="!canGoPrevPdfCropPage" @click="setPdfCropPage(pdfCropModal.pageIndex - 1)">上一页</button>
            <span class="pdf-crop-page-current">{{ currentPdfCropPageText }}</span>
            <button type="button" class="pdf-crop-page-step" :disabled="!canGoNextPdfCropPage" @click="setPdfCropPage(pdfCropModal.pageIndex + 1)">下一页</button>
          </div>
          <div class="pdf-crop-zoom-controls">
            <button type="button" class="pdf-crop-page-step" @click="adjustPdfCropZoom(-0.25)">缩小</button>
            <input
              class="pdf-crop-zoom-range"
              type="range"
              min="0.5"
              max="4"
              step="0.05"
              v-model.number="pdfCropModal.zoom"
            />
            <button type="button" class="pdf-crop-page-step" @click="adjustPdfCropZoom(0.25)">放大</button>
            <button type="button" class="pdf-crop-page-step" @click="resetPdfCropZoom">适合</button>
            <span class="pdf-crop-zoom-value">{{ pdfCropZoomText }}</span>
          </div>
          <span class="pdf-crop-template-current">{{ currentPdfCropTemplateText }}</span>
        </div>

        <div class="pdf-crop-template-manager">
          <select
            v-model="pdfCropModal.activeTemplateId"
            class="select"
            @change="event => applySavedPdfCropTemplate(event.target.value)"
          >
            <option value="">本地模板：未选择</option>
            <option
              v-for="template in currentPdfCropSavedTemplates"
              :key="template.id"
              :value="template.id"
            >
              {{ template.name }}
            </option>
          </select>
          <input
            v-model="pdfCropModal.templateNameDraft"
            class="input pdf-crop-template-name"
            type="text"
            placeholder="本地模板名称"
          />
          <button type="button" class="run-sub-btn" @click="saveCurrentPdfCropAsLocalTemplate">保存为本地模板</button>
          <button type="button" class="run-sub-btn" :disabled="!pdfCropModal.activeTemplateId" @click="updateCurrentPdfCropLocalTemplate">更新选中模板</button>
          <button type="button" class="run-sub-btn danger" :disabled="!pdfCropModal.activeTemplateId" @click="deleteCurrentPdfCropLocalTemplate">删除选中模板</button>
        </div>

        <div v-if="pdfCropModal.error" :class="['pdf-crop-error', { compact: hasPdfCropPreview }]">{{ pdfCropModal.error }}</div>
        <div v-if="pdfCropModal.loading" class="pdf-crop-loading">正在生成 PDF 预览…</div>
        <div
          v-else-if="currentPdfCropPage"
          :class="['pdf-crop-workspace', { 'no-pages': pdfCropModal.pages.length <= 1 }]"
        >
          <div v-if="pdfCropModal.pages.length > 1" class="pdf-crop-page-list" aria-label="PDF 页缩略图">
            <button
              v-for="(page, index) in pdfCropModal.pages"
              :key="`${pdfCropModal.previewPath}-${page.page || index}`"
              type="button"
              :class="['pdf-crop-page-button', { active: index === pdfCropModal.pageIndex }]"
              @click="setPdfCropPage(index)"
            >
              <img :src="page.data_url" draggable="false" alt="" />
              <span>第{{ page.page || index + 1 }}页</span>
            </button>
          </div>
          <div class="pdf-crop-stage">
            <div class="pdf-crop-canvas" :style="pdfCropCanvasStyle" @pointerdown="startPdfCropSelection">
              <img
                ref="pdfCropImageRef"
                class="pdf-crop-preview"
                :style="pdfCropCanvasStyle"
                :src="currentPdfCropPage.data_url"
                draggable="false"
                alt="PDF preview"
              />
              <div
                v-if="pdfCropModal.selection"
                class="pdf-crop-selection"
                :style="pdfCropSelectionStyle"
                @pointerdown.stop="startPdfCropMove"
              >
                <span
                  v-for="handle in pdfCropResizeHandles"
                  :key="handle"
                  :class="['pdf-crop-handle', `handle-${handle}`]"
                  @pointerdown.stop="event => startPdfCropResize(event, handle)"
                ></span>
              </div>
            </div>
          </div>
        </div>

        <div class="pdf-crop-foot">
          <span class="pdf-crop-selection-text">{{ pdfCropSelectionText }}</span>
          <div class="pdf-crop-buttons">
            <button type="button" class="run-sub-btn" @click="clearPdfCropSelection">清除选区</button>
            <button type="button" class="run-sub-btn" @click="savePdfCropSelection('append')">追加到模板</button>
            <button type="button" class="run-btn mini" @click="savePdfCropSelection('replace')">替换模板</button>
          </div>
        </div>
      </div>
    </div>

    <TmallAiApprovalDrawer
      v-if="!isTmallAiImageChainTask"
      v-model="approvalDrawerOpen"
      :board-url="approvalBoardUrl"
      @batch-updated="handleApprovalBatchUpdated"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import TmallAiApprovalDrawer from './TmallAiApprovalDrawer.vue'
import { summarizePrecheckRows } from '../utils/precheckSummary'
import { buildTaskRunnerProgressSummary, resolveTaskProgressConfig } from '../utils/taskProgress'
import { buildOdpsSyncFile, isOdpsSyncableFile, isOdpsSyncableTask } from '../utils/odpsSyncTasks'
import { shouldResetTaskValues, taskIdentityKey } from '../utils/taskRunnerState'

const props = defineProps({
  adapterId: String,
  task: Object,
})
const emit = defineEmits(['status-change'])

const values = ref({})
const logs = ref([])
const isRunning = ref(false)
const lastResult = ref(null)
const logEl = ref(null)
const outputFiles = ref([])
const approvalBoardUrl = ref('')
const approvalBatch = ref(null)
const approvalDrawerOpen = ref(false)
const aiChainActiveStep = ref('config')
const showFiles = ref(false)
const syncingOdps = ref(false)
const excelLoading = ref({})
const directoryListingLoading = ref({})
const directoryListingError = ref({})
const templateFeedback = ref({})
const runStage = ref('')
const dynamicParamPatches = ref({})
const dynamicParamProbeLoading = ref(false)
const dynamicParamProbeError = ref('')
const multiSelectOpenId = ref('')
const pdfCropImageRef = ref(null)
const pdfCropResizeHandles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const PDF_CROP_MIN_SIZE = 0.005
const PDF_CROP_TEMPLATE_STORAGE_KEY = 'crawshrimp:shenhui-pdf-crop-templates:v1'
const pdfCropModal = ref({
  open: false,
  type: 'wash_label',
  previewPath: '',
  dataUrl: '',
  pages: [],
  pageIndex: 0,
  activeTemplateId: '',
  templateNameDraft: '',
  zoom: 1,
  loading: false,
  error: '',
  selection: null,
  interaction: null,
})
const pdfCropSavedTemplates = ref({
  wash_label: [],
  hang_tag: [],
})
const pdfCropSavedTemplatesLoaded = ref(false)
const pdfCropManifestDefaultValues = {
  wash_crop_boxes: {
    '[{"x":0.0892,"y":0.2084,"width":0.4189,"height":0.7546}]': true,
  },
  tag_crop_boxes: {
    '[{"x":0.0113,"y":0.2352,"width":0.1535,"height":0.5058}]': true,
  },
}
const dateInputRefs = new Map()
let pollTimer = null
let currentRunId = null   // 当前触发的任务 run_id，用于轮询匹配
let runAbortToken = 0
let dynamicParamProbeToken = 0
let activeTaskIdentityKey = ''

function buildDefaultValues(params = []) {
  const next = {}
  for (const p of (params || [])) {
    if (p.type === 'checkbox') next[p.id] = Array.isArray(p.default) ? [...p.default] : []
    else if (isLineListParam(p)) next[p.id] = normalizeLineListRows(p.default, true)
    else if (isSingleTemporalParamType(p.type)) next[p.id] = p.default ?? ''
    else if (isRangeParamType(p.type)) { next[p.id + '_start'] = ''; next[p.id + '_end'] = '' }
    else if (p.type === 'file_excel') {
      next[p.id + '_path'] = ''
      next[p.id + '_rows'] = []
      next[p.id + '_headers'] = []
    }
    else if (p.type === 'directory') {
      next[p.id] = p.default ?? ''
      if (p.include_file_listing) next[p.id + '_files'] = []
    }
    else if (p.type === 'file_images') {
      next[p.id + '_paths'] = normalizeImagePaths(p.default?.paths, imageParamLimit(p))
    }
    else if (isMultiFileParamType(p.type)) {
      next[p.id + '_paths'] = normalizeFilePaths(p.default?.paths)
    }
    else next[p.id] = p.default ?? ''
  }
  return next
}

function getTextareaRows(param) {
  const rows = Number(param?.rows || 0)
  if (Number.isFinite(rows) && rows > 0) return Math.max(2, Math.min(8, Math.floor(rows)))
  return 4
}

function getQuickFillOptions(param) {
  return Array.isArray(param?.quick_fill_options)
    ? param.quick_fill_options.map(item => String(item || '').trim()).filter(Boolean)
    : []
}

function applyQuickFill(param, value) {
  const paramId = String(param?.id || '').trim()
  if (!paramId) return
  values.value[paramId] = String(value || '')
}

function isLineListParam(param) {
  return param?.type === 'line_list' || String(param?.ui_variant || '').trim().toLowerCase() === 'line_list'
}

function normalizeLineListRows(value, keepOneEmpty = false, keepEmptyRows = false) {
  let rows = []
  if (Array.isArray(value)) {
    rows = value
  } else if (value && typeof value === 'object') {
    rows = Array.isArray(value.rows)
      ? value.rows
      : Array.isArray(value.activities)
        ? value.activities
        : []
  } else {
    rows = String(value || '').split(/\n+/)
  }
  const normalized = rows
    .map(row => {
      if (row && typeof row === 'object') {
        return String(row.url || row.link || row.entranceUrl || row.entrance_url || row.activityId || row.activity_id || row.id || '').trim()
      }
      return String(row || '').trim()
    })
    .filter(row => keepEmptyRows || row)
  return normalized.length || !keepOneEmpty ? normalized : ['']
}

function getLineListRows(paramId) {
  return normalizeLineListRows(values.value[paramId], true, true)
}

function updateLineListRow(paramId, index, value) {
  const rows = normalizeLineListRows(values.value[paramId], true, true)
  rows[index] = String(value || '')
  values.value[paramId] = rows
}

function addLineListRow(paramId) {
  values.value[paramId] = [...normalizeLineListRows(values.value[paramId], true, true), '']
}

function removeLineListRow(paramId, index) {
  const rows = normalizeLineListRows(values.value[paramId], true, true)
  if (rows.length <= 1) {
    values.value[paramId] = ['']
    return
  }
  rows.splice(index, 1)
  values.value[paramId] = rows.length ? rows : ['']
}

function lineListParamValue(paramId) {
  return normalizeLineListRows(values.value[paramId], false).join('\n')
}

function mergeTaskParams(baseParams = [], patchMap = {}) {
  return (baseParams || []).map(param => {
    const patch = patchMap?.[param.id]
    return patch ? { ...param, ...patch } : param
  })
}

function normalizeSelectFallback(param) {
  const options = Array.isArray(param?.options) ? param.options : []
  const defaultValue = param?.default ?? ''
  if (options.some(opt => opt?.value === defaultValue)) return defaultValue
  if (options.some(opt => opt?.value === '')) return ''
  return options[0]?.value ?? ''
}

function reconcileValuesWithParams(params = []) {
  const next = { ...values.value }
  let changed = false

  for (const p of (params || [])) {
    if (p.type === 'checkbox') {
      const current = Array.isArray(next[p.id]) ? next[p.id].map(v => String(v)) : []
      const valid = new Set((p.options || []).map(opt => String(opt?.value ?? '')))
      const filtered = valid.size ? current.filter(value => valid.has(value)) : current
      const normalized = Array.isArray(next[p.id]) ? filtered : (Array.isArray(p.default) ? [...p.default] : [])
      if (JSON.stringify(next[p.id]) !== JSON.stringify(normalized)) {
        next[p.id] = normalized
        changed = true
      }
      continue
    }

    if (isRangeParamType(p.type)) {
      if (!Object.prototype.hasOwnProperty.call(next, p.id + '_start')) {
        next[p.id + '_start'] = ''
        changed = true
      }
      if (!Object.prototype.hasOwnProperty.call(next, p.id + '_end')) {
        next[p.id + '_end'] = ''
        changed = true
      }
      continue
    }

    if (isSingleTemporalParamType(p.type)) {
      if (!Object.prototype.hasOwnProperty.call(next, p.id)) {
        next[p.id] = p.default ?? ''
        changed = true
      }
      continue
    }

    if (p.type === 'file_excel') {
      for (const suffix of ['_path', '_rows', '_headers']) {
        const key = p.id + suffix
        if (!Object.prototype.hasOwnProperty.call(next, key)) {
          next[key] = suffix === '_path' ? '' : []
          changed = true
        }
      }
      continue
    }

    if (p.type === 'file_images') {
      const key = p.id + '_paths'
      if (!Object.prototype.hasOwnProperty.call(next, key)) {
        next[key] = normalizeImagePaths(p.default?.paths, imageParamLimit(p))
        changed = true
      }
      continue
    }

    if (isMultiFileParamType(p.type)) {
      const key = p.id + '_paths'
      if (!Object.prototype.hasOwnProperty.call(next, key)) {
        next[key] = normalizeFilePaths(p.default?.paths)
        changed = true
      }
      continue
    }

    if (p.type === 'directory' && p.include_file_listing) {
      if (!Object.prototype.hasOwnProperty.call(next, p.id)) {
        next[p.id] = p.default ?? ''
        changed = true
      }
      const filesKey = p.id + '_files'
      if (!Object.prototype.hasOwnProperty.call(next, filesKey)) {
        next[filesKey] = []
        changed = true
      }
      continue
    }

    if (!Object.prototype.hasOwnProperty.call(next, p.id)) {
      next[p.id] = p.default ?? ''
      changed = true
      continue
    }

    if (p.type === 'select') {
      const current = next[p.id]
      const valid = new Set((p.options || []).map(opt => opt?.value))
      if (valid.size && !valid.has(current)) {
        next[p.id] = normalizeSelectFallback(p)
        changed = true
      }
    }
  }

  if (changed) values.value = next
}

const taskParams = computed(() =>
  mergeTaskParams(props.task?.params || [], dynamicParamPatches.value)
)

const hasParamProbeScript = computed(() =>
  !!String(props.task?.param_probe_script || '').trim()
)

// 初始化默认值
watch(() => [props.adapterId, props.task], ([adapterId, task]) => {
  if (!task) return
  if (!shouldResetTaskValues(activeTaskIdentityKey, task, adapterId)) return
  activeTaskIdentityKey = taskIdentityKey(adapterId, task)
  dynamicParamProbeToken += 1
  dynamicParamPatches.value = {}
  dynamicParamProbeLoading.value = false
  dynamicParamProbeError.value = ''
  values.value = buildDefaultValues(task.params || [])
  if (pdfCropSavedTemplatesLoaded.value) applyDefaultPdfCropTemplatesToValues()
  templateFeedback.value = {}
  // 切换 task 时保留/恢复历史日志，不清空
  outputFiles.value = []
  approvalBoardUrl.value = ''
  approvalBatch.value = null
  approvalDrawerOpen.value = false
  aiChainActiveStep.value = 'config'
  syncingOdps.value = false
  isRunning.value = false
  lastResult.value = null
  runStage.value = ''
  // 异步加载该任务的历史日志
  nextTick(async () => {
    try {
      const logR = await window.cs.getTaskLogs(props.adapterId, task.task_id)
      if (logR.logs) logs.value = logR.logs
      const taskStatus = await window.cs.getTaskStatus(props.adapterId, task.task_id)
      const live = taskStatus?.live
      const last = taskStatus?.last_run
      if (live && isTaskActiveStatus(live.status)) {
        isRunning.value = true
        currentRunId = live.run_id ?? last?.id ?? null
        emit('status-change', live)
      }
      if (last?.output_files) {
        await refreshOutputFiles()
      }
      scrollToBottom()
    } catch {}
    if (hasParamProbeScript.value) {
      void refreshDynamicParamPatches()
    }
  })
}, { immediate: true })

const executeModeParam = computed(() =>
  taskParams.value.find(p =>
    p?.id === 'execute_mode' &&
    p?.type === 'radio' &&
    (p?.options || []).some(opt => opt?.value === 'plan') &&
    (p?.options || []).some(opt => opt?.value === 'live')
  ) || null
)

const autoPrecheckFlow = computed(() =>
  props.task?.execution_ui_mode === 'precheck_before_live' && !!executeModeParam.value
)

const visibleParams = computed(() =>
  orderVisibleParams(taskParams.value.filter(isParamVisibleInForm))
)

const validationOnlyLabel = computed(() =>
  props.task?.validation_only_label || '仅校验 Excel'
)

const autoPrecheckNote = computed(() =>
  props.task?.auto_precheck_note || '执行前会自动做 Excel 预检'
)

const liveStatus = computed(() => props.task?.live?.status || '')
const liveProgress = computed(() => props.task?.live || {})
const paramsGridClass = computed(() =>
  props.adapterId === 'shopee-webchat-bulk-reply' ? 'params-grid-shopee-bulk' : ''
)
const useEnhancedProgressUi = computed(() =>
  resolveTaskProgressConfig(props.adapterId, props.task?.task_id).usage.taskRunner === 'enhanced'
)
const isTaskOdpsSyncable = computed(() =>
  isOdpsSyncableTask(props.adapterId, props.task?.task_id)
)
const isTmallAiImageChainTask = computed(() =>
  props.adapterId === 'tmall-ops-assistant' && props.task?.task_id === 'tmall_ai_image_test_chain'
)
const aiChainAssets = computed(() =>
  (approvalBatch.value?.items || []).flatMap(item => item.assets || [])
)
const aiChainAiAssets = computed(() =>
  aiChainAssets.value.filter(asset => asset.kind === 'ai')
)
const aiChainCreateRows = computed(() =>
  (approvalBatch.value?.submit_result_rows || []).filter(row => row?.阶段 === '天猫上传/创建测图任务')
)
const aiChainCreateStatus = computed(() => {
  const status = String(approvalBatch.value?.status || '').trim()
  if (status === 'submitted' && aiChainCreateRows.value.some(row => String(row?.执行结果 || '').includes('失败'))) {
    return 'partial_failed'
  }
  return status
})
const aiChainCreateCounts = computed(() => {
  const submitSummary = approvalBatch.value?.submit_summary || {}
  const attempted = Number(submitSummary.attempted ?? aiChainCreateRows.value.length ?? 0)
  const succeeded = Number(submitSummary.succeeded ?? aiChainCreateRows.value.filter(row => String(row?.执行结果 || '').includes('已创建')).length)
  const failed = Number(submitSummary.failed ?? aiChainCreateRows.value.filter(row => String(row?.执行结果 || '').includes('失败')).length)
  return {
    attempted: Number.isFinite(attempted) ? attempted : 0,
    succeeded: Number.isFinite(succeeded) ? succeeded : 0,
    failed: Number.isFinite(failed) ? failed : 0,
  }
})
const aiChainCreateSummary = computed(() => {
  if (!approvalBoardUrl.value) return '等待审批批次生成'
  if (!aiChainCreateRows.value.length) return '确认图片后触发上传和创建'
  const counts = aiChainCreateCounts.value
  return `尝试 ${counts.attempted || aiChainCreateRows.value.length} 款 / 成功 ${counts.succeeded} / 失败 ${counts.failed}`
})
const aiChainSteps = computed(() => {
  const approved = aiChainAiAssets.value.filter(asset => asset.status === 'approved').length
  const rejected = aiChainAiAssets.value.filter(asset => asset.status === 'rejected').length
  const pending = aiChainAiAssets.value.filter(asset => !['approved', 'rejected'].includes(asset.status)).length
  const createStatus = aiChainCreateStatus.value
  return [
    {
      id: 'config',
      index: '01',
      title: '任务配置',
      detail: approvalBoardUrl.value || isRunning.value ? '已启动本批次' : '填写导入表、提示词库和执行模式',
      state: approvalBoardUrl.value || isRunning.value ? 'done' : 'active',
    },
    {
      id: 'approval',
      index: '02',
      title: '生图看板 / 审批',
      detail: approvalBoardUrl.value
        ? `AI 图 ${aiChainAiAssets.value.length} 张，确认 ${approved} / 舍弃 ${rejected} / 待定 ${pending}`
        : '生图完成后显示图片看板',
      state: approvalBoardUrl.value ? (pending > 0 ? 'active' : 'done') : 'pending',
    },
    {
      id: 'create',
      index: '03',
      title: '创建结果',
      detail: aiChainCreateSummary.value,
      state: createStatus === 'created'
        ? 'done'
        : ['partial_failed', 'create_failed'].includes(createStatus)
          ? 'error'
          : 'pending',
    },
  ]
})
function hasAiChainCreateRows(batch) {
  return (batch?.submit_result_rows || []).some(row => row?.阶段 === '天猫上传/创建测图任务')
}

function setAiChainActiveStep(stepId) {
  const next = String(stepId || '').trim()
  if (!['config', 'approval', 'create'].includes(next)) return
  aiChainActiveStep.value = next
}

watch(approvalBoardUrl, (url, previousUrl) => {
  if (!isTmallAiImageChainTask.value || !url || previousUrl) return
  if (aiChainActiveStep.value === 'config') aiChainActiveStep.value = 'approval'
})

const odpsSyncFiles = computed(() =>
  outputFiles.value
    .map(path => buildOdpsSyncFile(props.adapterId, props.task?.task_id, path))
    .filter(isOdpsSyncableFile)
)
const canSyncOdps = computed(() => odpsSyncFiles.value.length > 0)
const latestExcelOutput = computed(() => odpsSyncFiles.value[0]?.path || '')

function isTaskActiveStatus(status) {
  return ['running', 'pausing', 'paused', 'stopping'].includes(status)
}

const runningLabel = computed(() => {
  if (liveStatus.value === 'pausing') return '⏳ 暂停中…'
  if (liveStatus.value === 'paused') return '⏸ 已暂停'
  if (liveStatus.value === 'stopping') return '⏳ 停止中…'
  if (runStage.value === 'plan') return '⏳ 预检中…'
  if (runStage.value === 'live') return '⏳ live 执行中…'
  if (runStage.value === 'sync') return '⏳ 同步DataWorks…'
  return '⏳ 进行中…'
})

const missingRequired = computed(() => {
  if (!props.task) return false
  return visibleParams.value.some(p => {
    if (!p.required) return false
    if (p.type === 'checkbox') return !(values.value[p.id] || []).length
    if (isLineListParam(p)) return !lineListParamValue(p.id)
    if (p.type === 'file_excel') return !values.value[p.id + '_path']
    if (p.type === 'file_images') return !(values.value[p.id + '_paths'] || []).length
    if (isMultiFileParamType(p.type)) return !(values.value[p.id + '_paths'] || []).length
    if (isSingleTemporalParamType(p.type)) return !values.value[p.id]
    if (isRangeParamType(p.type)) {
      return !values.value[p.id + '_start'] || !values.value[p.id + '_end']
    }
    return !values.value[p.id]
  })
})

const progressSummary = computed(() =>
  buildTaskRunnerProgressSummary({
    adapterId: props.adapterId,
    taskId: props.task?.task_id,
    live: liveProgress.value,
    liveStatus: liveStatus.value,
    isRunning: isRunning.value,
  })
)

const pdfCropSourcePaths = computed(() =>
  pdfCropSourcePathsForType(pdfCropModal.value.type)
)

const pdfCropTemplateSummary = computed(() => {
  const wash = String(values.value.wash_crop_boxes || '').trim() ? '洗唛已设置' : '洗唛未设置'
  const tag = String(values.value.tag_crop_boxes || '').trim() ? '吊牌已设置' : '吊牌未设置'
  return `${wash} / ${tag}`
})

const currentPdfCropSavedTemplates = computed(() =>
  pdfCropSavedTemplates.value[pdfCropModal.value.type] || []
)

const currentPdfCropTemplateText = computed(() => {
  const field = pdfCropTemplateField(pdfCropModal.value.type)
  const boxes = parsePdfCropTemplate(values.value[field])
  const templateText = boxes.length ? `当前模板 ${boxes.length} 个截图框` : '当前模板未设置'
  const pageCount = pdfCropModal.value.pages.length
  return pageCount > 1 ? `${templateText} / 预览 ${pageCount} 页` : templateText
})

const currentPdfCropPage = computed(() => {
  const pages = Array.isArray(pdfCropModal.value.pages) ? pdfCropModal.value.pages : []
  return pages[pdfCropModal.value.pageIndex] || pages[0] || null
})

const currentPdfCropPageText = computed(() => {
  const pages = Array.isArray(pdfCropModal.value.pages) ? pdfCropModal.value.pages : []
  if (!pages.length) return '未生成页面'
  const page = currentPdfCropPage.value
  return `第 ${page?.page || pdfCropModal.value.pageIndex + 1} / ${pages.length} 页`
})

const canGoPrevPdfCropPage = computed(() => pdfCropModal.value.pageIndex > 0)
const canGoNextPdfCropPage = computed(() => pdfCropModal.value.pageIndex < pdfCropModal.value.pages.length - 1)

const hasPdfCropPreview = computed(() =>
  Boolean(pdfCropModal.value.dataUrl || pdfCropModal.value.pages.length)
)

const pdfCropBaseDisplayWidth = computed(() => {
  const page = currentPdfCropPage.value
  const width = Number(page?.width || 0)
  const height = Number(page?.height || 0)
  if (pdfCropModal.value.type === 'wash_label') {
    return Math.max(720, Math.min(980, width || 820))
  }
  const scaled = width ? width * 0.44 : 1320
  return Math.max(1100, Math.min(1650, scaled))
})

const pdfCropCanvasDisplayWidth = computed(() =>
  Math.round(pdfCropBaseDisplayWidth.value * clampPdfCropZoom(pdfCropModal.value.zoom))
)

const pdfCropCanvasStyle = computed(() => ({
  width: `${pdfCropCanvasDisplayWidth.value}px`,
}))

const pdfCropZoomText = computed(() =>
  `${Math.round(clampPdfCropZoom(pdfCropModal.value.zoom) * 100)}%`
)

const pdfCropSelectionStyle = computed(() => {
  const selection = pdfCropModal.value.selection
  if (!selection) return {}
  return {
    left: `${selection.x * 100}%`,
    top: `${selection.y * 100}%`,
    width: `${selection.width * 100}%`,
    height: `${selection.height * 100}%`,
  }
})

const pdfCropSelectionText = computed(() => {
  const selection = pdfCropModal.value.selection
  if (!selection) return '未选择截图范围'
  return `x=${selection.x.toFixed(4)}, y=${selection.y.toFixed(4)}, w=${selection.width.toFixed(4)}, h=${selection.height.toFixed(4)}`
})

function paramLayoutClass(param) {
  if (!param) return 'param-span-compact'
  const explicitSpan = normalizeParamUiSpan(param.ui_span)
  if (explicitSpan) return explicitSpan
  if (props.adapterId === 'shopee-webchat-bulk-reply') {
    if (['mode', 'run_mode'].includes(param.id)) {
      return 'param-span-half'
    }
    if (['start_row', 'end_row', 'batch_size'].includes(param.id)) {
      return 'param-span-third'
    }
  }
  if (param.type === 'directory' || param.type === 'file_excel' || param.type === 'file_images' || isMultiFileParamType(param.type) || param.type === 'checkbox' || param.type === 'textarea' || isLineListParam(param) || isRangeParamType(param.type) || isSingleTemporalParamType(param.type)) {
    return 'param-span-full'
  }
  if (param.type === 'radio' && (param.options?.length || 0) > 2) {
    return 'param-span-full'
  }
  return 'param-span-compact'
}

function normalizeParamUiSpan(uiSpan) {
  const raw = String(uiSpan || '').trim().toLowerCase()
  if (raw === 'full') return 'param-span-full'
  if (raw === 'half') return 'param-span-half'
  if (raw === 'third') return 'param-span-third'
  if (raw === 'compact') return 'param-span-compact'
  return ''
}

function isCheckboxDropdown(param) {
  return param?.type === 'checkbox' && String(param?.ui_variant || '').trim().toLowerCase() === 'dropdown_multi'
}

function getCheckboxSelectedLabels(param) {
  const selected = Array.isArray(values.value[param?.id]) ? values.value[param.id].map(v => String(v)) : []
  if (!selected.length) return []
  const optionMap = new Map((param?.options || []).map(opt => [String(opt?.value ?? ''), String(opt?.label ?? opt?.value ?? '')]))
  return selected
    .map(value => optionMap.get(value) || value)
    .filter(Boolean)
}

function getCheckboxSelectionSummary(param) {
  const labels = getCheckboxSelectedLabels(param)
  if (!labels.length) return param?.placeholder || '请选择，可多选'
  if (labels.length <= 2) return labels.join('、')
  return `已选 ${labels.length} 项：${labels.slice(0, 2).join('、')}…`
}

function isMultiSelectOpen(paramId) {
  return multiSelectOpenId.value === paramId
}

function toggleMultiSelect(paramId) {
  multiSelectOpenId.value = multiSelectOpenId.value === paramId ? '' : paramId
}

function clearCheckboxSelection(paramId) {
  values.value[paramId] = []
}

function closeMultiSelect() {
  multiSelectOpenId.value = ''
}

function extractProbeErrorMessage(payload) {
  if (!payload) return ''
  if (typeof payload === 'string') return payload.trim()
  if (typeof payload?.detail === 'string' && payload.detail.trim()) return payload.detail.trim()
  if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error.trim()
  if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim()
  return ''
}

function shouldSilenceProbeError(rawMessage) {
  const text = String(rawMessage || '').trim()
  if (!text) return true
  return (
    text.includes('请先登录后再运行 probe') ||
    text.includes('当前页面未登录') ||
    text.includes('未登录 Shein 运营助手')
  )
}

function formatProbeErrorMessage(error) {
  const raw = extractProbeErrorMessage(error) || String(error?.message || error || '').trim()
  if (shouldSilenceProbeError(raw)) return ''
  if (!raw) {
    return '页面筛选项探测失败，请确认当前标签页已打开 SHEIN 商品分析-商品明细页并已完成加载'
  }
  if (raw.startsWith('页面筛选项探测失败：')) return raw
  if (raw === '页面筛选项探测失败') {
    return '页面筛选项探测失败，请确认当前标签页已打开 SHEIN 商品分析-商品明细页并已完成加载'
  }
  return `页面筛选项探测失败：${raw}`
}

function handleDocumentPointerDown(event) {
  if (!multiSelectOpenId.value) return
  const target = event?.target
  if (typeof target?.closest === 'function' && target.closest('[data-multi-select-root]')) return
  closeMultiSelect()
}

function handleDocumentKeydown(event) {
  if (event?.key === 'Escape') closeMultiSelect()
}

function imageParamLimit(param) {
  const value = Number(param?.max || 0)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function normalizeImagePaths(paths, maxCount = 0) {
  const normalized = Array.isArray(paths)
    ? paths.map(path => String(path || '').trim()).filter(Boolean)
    : []
  return maxCount > 0 ? normalized.slice(0, maxCount) : normalized
}

function isMultiFileParamType(type) {
  return ['file_zip', 'file_pdf'].includes(String(type || ''))
}

function normalizeFilePaths(paths) {
  const normalized = Array.isArray(paths)
    ? paths.map(path => String(path || '').trim()).filter(Boolean)
    : []
  return [...new Set(normalized)]
}

function normalizeDirectoryFileListing(files) {
  const source = Array.isArray(files?.paths) ? files.paths : (Array.isArray(files) ? files : [])
  const seen = new Set()
  const normalized = []
  for (const entry of source) {
    const rawPath = typeof entry === 'string' ? entry : entry?.path
    const filePath = String(rawPath || '').trim()
    if (!filePath || seen.has(filePath)) continue
    seen.add(filePath)
    if (entry && typeof entry === 'object') {
      normalized.push({
        path: filePath,
        relativePath: String(entry.relativePath || '').trim(),
        mtimeMs: Number.isFinite(Number(entry.mtimeMs)) ? Number(entry.mtimeMs) : 0,
        size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : 0,
      })
    } else {
      normalized.push({ path: filePath, relativePath: '', mtimeMs: 0, size: 0 })
    }
  }
  return normalized
}

function imageSummary(param) {
  const count = (values.value[param.id + '_paths'] || []).length
  const maxCount = imageParamLimit(param)
  if (!count) {
    return maxCount > 0
      ? `点击选择图片（支持多选，最多 ${maxCount} 张）…`
      : '点击选择图片（支持多选）…'
  }
  return maxCount > 0 ? `${count} / ${maxCount} 张图片` : `${count} 张图片`
}

function filePickerIcon(param) {
  if (param?.type === 'file_zip') return '🗜'
  if (param?.type === 'file_pdf') return '📄'
  return '📎'
}

function filePickerButtonLabel(param) {
  if (param?.type === 'file_zip') return '选择 ZIP'
  if (param?.type === 'file_pdf') return '选择 PDF'
  return '选择文件'
}

function filePathsSummary(param) {
  const count = (values.value[param.id + '_paths'] || []).length
  if (count) {
    if (param?.type === 'file_zip') return `${count} 个 ZIP 压缩包`
    if (param?.type === 'file_pdf') return `${count} 个 PDF 文件`
    return `${count} 个文件`
  }
  if (param?.type === 'file_zip') return '点击批量选择 ZIP 压缩包…'
  if (param?.type === 'file_pdf') return '点击批量选择 PDF 文件…'
  return '点击批量选择文件…'
}

function orderVisibleParams(params) {
  const list = [...(params || [])]
  if (props.adapterId !== 'shopee-webchat-bulk-reply') return list

  const order = {
    mode: 1,
    run_mode: 2,
    start_row: 3,
    end_row: 4,
    batch_size: 5,
    input_file: 6,
  }

  return list.sort((a, b) => {
    const ao = order[a.id] ?? 999
    const bo = order[b.id] ?? 999
    if (ao !== bo) return ao - bo
    return String(a.label || '').localeCompare(String(b.label || ''), 'zh-CN')
  })
}

function isRangeParamType(type) {
  return ['date_range'].includes(String(type || ''))
}

function isSingleTemporalParamType(type) {
  return ['week', 'month', 'week_range', 'month_range'].includes(String(type || ''))
}

function normalizeRuleValues(value) {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null) return []
  return [value]
}

function matchesVisibleWhen(rule) {
  if (!rule || typeof rule !== 'object') return true
  const field = String(rule.field || rule.param_id || rule.id || '').trim()
  if (!field) return true

  const currentValue = values.value[field]
  if (Object.prototype.hasOwnProperty.call(rule, 'equals')) {
    return currentValue === rule.equals
  }
  if (Object.prototype.hasOwnProperty.call(rule, 'not_equals')) {
    return currentValue !== rule.not_equals
  }

  const oneOf = normalizeRuleValues(rule.in ?? rule.one_of)
  if (oneOf.length) return oneOf.includes(currentValue)

  const notIn = normalizeRuleValues(rule.not_in)
  if (notIn.length) return !notIn.includes(currentValue)

  return true
}

function isParamVisibleByRule(param) {
  const visibleWhen = param?.visible_when
  if (!visibleWhen) return true
  const rules = Array.isArray(visibleWhen) ? visibleWhen : [visibleWhen]
  return rules.every(matchesVisibleWhen)
}

function isParamVisibleInForm(param) {
  if (param?.hidden) return false
  if (autoPrecheckFlow.value && param?.id === 'execute_mode') return false
  return isParamVisibleByRule(param)
}

function forceReset() {
  clearInterval(pollTimer)
  pollTimer = null
  runAbortToken += 1
  isRunning.value = false
  currentRunId = null
  runStage.value = ''
  logs.value.push('[重置] 已强制重置运行状态')
}

watch(taskParams, (params) => {
  if (!props.task) return
  reconcileValuesWithParams(params || [])
}, { deep: true })

watch(() => `${props.adapterId || ''}::${props.task?.task_id || ''}::${values.value.mode || ''}`, () => {
  if (!props.task || !hasParamProbeScript.value) return
  void refreshDynamicParamPatches()
})

watch(() => props.task?.task_id, () => {
  closeMultiSelect()
})

async function refreshDynamicParamPatches() {
  const task = props.task
  if (!task || !hasParamProbeScript.value) {
    dynamicParamPatches.value = {}
    dynamicParamProbeLoading.value = false
    dynamicParamProbeError.value = ''
    return
  }

  const requestToken = ++dynamicParamProbeToken
  dynamicParamProbeLoading.value = true
  dynamicParamProbeError.value = ''

  try {
    const probeParams = buildRunParams()
    const mode = String(probeParams.mode || '').trim().toLowerCase() || 'current'
    if (mode === 'new') {
      dynamicParamProbeLoading.value = false
      dynamicParamProbeError.value = ''
      return
    }
    const currentTabId = await resolveCurrentTabId(probeParams)
    if (mode === 'current' && !currentTabId) {
      dynamicParamPatches.value = {}
      dynamicParamProbeError.value = ''
      return
    }
    const res = await window.cs.probeTaskParams(props.adapterId, task.task_id, probeParams, {
      current_tab_id: currentTabId,
    })
    if (requestToken !== dynamicParamProbeToken) return
    if (!res?.ok) throw new Error(extractProbeErrorMessage(res) || '页面筛选项探测失败')
    dynamicParamPatches.value = Object.fromEntries((res.patches || [])
      .filter(item => item && item.id)
      .map(item => [item.id, item]))
  } catch (error) {
    if (requestToken !== dynamicParamProbeToken) return
    dynamicParamPatches.value = {}
    dynamicParamProbeError.value = formatProbeErrorMessage(error)
  } finally {
    if (requestToken === dynamicParamProbeToken) {
      dynamicParamProbeLoading.value = false
    }
  }
}

function buildRunParams(overrides = {}) {
  const params = {}
  for (const p of taskParams.value) {
    if (!isParamVisibleInForm(p)) continue

    if (isSingleTemporalParamType(p.type)) {
      params[p.id] = values.value[p.id] || ''
      continue
    }

    if (isRangeParamType(p.type)) {
      params[p.id] = {
        start: values.value[p.id + '_start'] || '',
        end: values.value[p.id + '_end'] || '',
      }
      continue
    }

    if (p.type === 'select') {
      const v = values.value[p.id]
      params[p.id] = v
      if (v === '自定义') {
        const linkedRangeId = getLinkedDateRangeIdForSelect(p.id)
        const startKey = linkedRangeId ? linkedRangeId + '_start' : '_custom_start_' + p.id
        const endKey = linkedRangeId ? linkedRangeId + '_end' : '_custom_end_' + p.id
        params['custom_start'] = values.value[startKey] || ''
        params['custom_end'] = values.value[endKey] || ''
        params['custom_range'] = {
          start: params['custom_start'],
          end: params['custom_end'],
        }
      }
      continue
    }

    if (p.type === 'file_excel') {
      params[p.id] = {
        path: values.value[p.id + '_path'],
      }
      continue
    }

    if (p.type === 'file_images') {
      const maxCount = imageParamLimit(p)
      params[p.id] = {
        paths: normalizeImagePaths(values.value[p.id + '_paths'], maxCount),
      }
      continue
    }

    if (isLineListParam(p)) {
      params[p.id] = lineListParamValue(p.id)
      continue
    }

    if (isMultiFileParamType(p.type)) {
      params[p.id] = {
        paths: normalizeFilePaths(values.value[p.id + '_paths']),
      }
      continue
    }

    if (p.type === 'directory' && p.include_file_listing) {
      const root = values.value[p.id] || ''
      params[p.id] = root
      params[p.id + '_files'] = {
        root,
        paths: normalizeDirectoryFileListing(values.value[p.id + '_files']),
      }
      continue
    }

    params[p.id] = values.value[p.id]
  }
  return JSON.parse(JSON.stringify({ ...params, ...overrides }))
}

async function resolveCurrentTabId(params) {
  let currentTabId = ''
  if (String(params.mode || '').trim().toLowerCase() === 'current') {
    try {
      const tab = await window.cs.getCurrentChromeTab?.()
      if (tab?.id) currentTabId = String(tab.id)
    } catch {}
  }
  return currentTabId
}

function resetRunUi() {
  lastResult.value = null
  outputFiles.value = []
  approvalBoardUrl.value = ''
  approvalBatch.value = null
  approvalDrawerOpen.value = false
  if (isTmallAiImageChainTask.value) aiChainActiveStep.value = 'config'
  showFiles.value = false
  syncingOdps.value = false
}

async function pauseCurrentTask() {
  if (!isRunning.value || liveStatus.value !== 'running') return
  try {
    await window.cs.pauseTask(props.adapterId, props.task.task_id)
    logs.value.push(`[${now()}] 已发送暂停指令`)
    emit('status-change', { status: 'pausing', run_id: currentRunId })
    scrollToBottom()
  } catch (e) {
    logs.value.push(`[错误] ${e?.message || String(e)}`)
  }
}

async function resumeCurrentTask() {
  if (!isRunning.value || !['paused', 'pausing'].includes(liveStatus.value)) return
  try {
    await window.cs.resumeTask(props.adapterId, props.task.task_id)
    logs.value.push(`[${now()}] 已发送继续指令`)
    emit('status-change', { status: 'running', run_id: currentRunId })
    scrollToBottom()
  } catch (e) {
    logs.value.push(`[错误] ${e?.message || String(e)}`)
  }
}

async function stopCurrentTask() {
  if (!isRunning.value || liveStatus.value === 'stopping') return
  try {
    await window.cs.stopTask(props.adapterId, props.task.task_id)
    logs.value.push(`[${now()}] 已发送停止指令`)
    emit('status-change', { status: 'stopping', run_id: currentRunId })
    scrollToBottom()
  } catch (e) {
    logs.value.push(`[错误] ${e?.message || String(e)}`)
  }
}

async function startTaskRun(params, pendingMessage) {
  const currentTabId = await resolveCurrentTabId(params)
  const r = await window.cs.runTask(props.adapterId, props.task.task_id, params, {
    current_tab_id: currentTabId,
  })
  if (!r.ok) throw new Error(r.message || JSON.stringify(r))
  logs.value.push(`[${now()}] ${pendingMessage}`)
  emit('status-change', { status: 'running' })
  await new Promise(res => setTimeout(res, 600))
  const initStatus = await window.cs.getTaskStatus(props.adapterId, props.task.task_id)
  currentRunId = initStatus?.live?.run_id ?? initStatus?.last_run?.id ?? null
  const token = runAbortToken
  return await new Promise((resolve) => {
    pollTimer = setInterval(async () => {
      if (token !== runAbortToken) {
        clearInterval(pollTimer)
        pollTimer = null
        resolve({ status: 'cancelled' })
        return
      }
      const result = await pollStatusOnce()
      if (!result) return
      clearInterval(pollTimer)
      pollTimer = null
      resolve(result)
    }, 800)
  })
}

async function pollStatusOnce() {
  const r = await window.cs.getTaskStatus(props.adapterId, props.task.task_id)
  const live = r.live
  const logR = await window.cs.getTaskLogs(props.adapterId, props.task.task_id)

  if (logR.logs) logs.value = logR.logs
  if (live) emit('status-change', live)
  scrollToBottom()

  // live 有值且是当前任务正在跑 → 继续等
  if (live && isTaskActiveStatus(live.status)) return null

  // live 为 null 时：检查 last_run 是否是我们触发的这次（匹配 run_id）
  if (!live) {
    const last = r.last_run
    // 还没有 run_id（任务刚提交还没写入）→ 继续等
    if (!currentRunId) return null
    // last_run 不是当前任务 → 继续等
    if (!last || last.id !== currentRunId) return null
    // last_run 是当前任务但还在跑 → 继续等
    if (isTaskActiveStatus(last.status)) return null
    // last_run 是当前任务且已完成 → 用 last 作为结果
    const syntheticLive = { status: last.status, records: last.records_count, error: last.error, run_id: last.id }
    return syntheticLive
  }

  // live 有值且不是 running（done/error）且匹配当前 run_id
  if (currentRunId && live.run_id && live.run_id !== currentRunId) return null
  return live
}

function scrollToBottom() {
  nextTick(() => { if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight })
}

async function refreshOutputFiles() {
  const dataR = await window.cs.getData(props.adapterId, props.task.task_id)
  if (!dataR.runs?.[0]?.output_files) return []
  try {
    const files = typeof dataR.runs[0].output_files === 'string'
      ? JSON.parse(dataR.runs[0].output_files)
      : dataR.runs[0].output_files
    const allFiles = Array.isArray(files) ? files : []
    outputFiles.value = visibleOutputFiles(allFiles)
    approvalBoardUrl.value = findApprovalBoardUrl(allFiles)
    if (!approvalBoardUrl.value) approvalBatch.value = null
    showFiles.value = outputFiles.value.length > 0
    return allFiles
  } catch {
    return []
  }
}

async function finishRun(result, options = {}) {
  clearInterval(pollTimer)
  pollTimer = null
  const keepRunning = !!options.keepRunning
  if (!keepRunning) {
    isRunning.value = false
    currentRunId = null
    runStage.value = ''
  } else {
    currentRunId = null
  }
  emit('status-change', result)

  if (result.status === 'done') {
    const files = await refreshOutputFiles()
    approvalBoardUrl.value = findApprovalBoardUrl(files, result)
    if (options.message) {
      lastResult.value = { ok: !!options.ok, msg: options.message }
    } else {
      lastResult.value = { ok: true, msg: `✓ 完成，共 ${result.records ?? result.records_count ?? 0} 条记录` }
    }
  } else if (result.status === 'stopped') {
    await refreshOutputFiles()
    lastResult.value = {
      ok: false,
      msg: options.message || `■ 已停止，保留 ${result.records ?? result.records_count ?? 0} 条结果`,
    }
  } else if (result.status === 'error') {
    lastResult.value = { ok: false, msg: options.message || `✗ 失败: ${result.error || '未知错误'}` }
  }
}

async function finishRunAndSyncOdps(result) {
  if (result.status !== 'done') {
    await finishRun(result)
    return
  }
  await finishRun(result, { keepRunning: true })
  if (!odpsSyncFiles.value.length) {
    lastResult.value = { ok: false, msg: '任务完成，但没有找到可同步 DataWorks 的 Excel 输出' }
    isRunning.value = false
    runStage.value = ''
    return
  }
  runStage.value = 'sync'
  logs.value.push(`[${now()}] 开始同步 DataWorks…`)
  scrollToBottom()
  try {
    await syncOdpsFiles(odpsSyncFiles.value.map(file => file.path))
  } finally {
    isRunning.value = false
    runStage.value = ''
  }
}

async function inspectLatestPlanOutput() {
  const files = await refreshOutputFiles()
  const xlsx = files.find(f => String(f || '').toLowerCase().endsWith('.xlsx'))
  if (!xlsx) {
    return { pass: false, summary: '未找到预检结果文件' }
  }
  const sheet = await window.cs.readExcel(xlsx)
  const rows = Array.isArray(sheet?.rows) ? sheet.rows : []
  if (!rows.length) {
    return { pass: false, summary: '预检结果为空' }
  }
  return summarizePrecheckRows(rows)
}

async function runValidationOnly() {
  if (isRunning.value) return
  isRunning.value = true
  resetRunUi()
  runStage.value = 'plan'
  try {
    const result = await startTaskRun(await prepareRunParams({ execute_mode: 'plan' }), 'Excel 预检已启动…')
    if (result.status === 'cancelled') return
    const gate = result.status === 'done' ? await inspectLatestPlanOutput() : null
    if (result.status === 'done') {
      await finishRun(result, {
        ok: gate?.pass !== false,
        message: gate?.summary
          ? `${gate?.pass === false ? '✗' : '✓'} 预检${gate?.pass === false ? '未通过' : '完成'}：${gate.summary}`
          : `✓ 预检完成，共 ${result.records ?? result.records_count ?? 0} 条记录`,
      })
      return
    }
    await finishRun(result)
  } catch (e) {
    isRunning.value = false
    runStage.value = ''
    currentRunId = null
    lastResult.value = { ok: false, msg: `✗ 失败: ${e?.message || String(e)}` }
    logs.value.push(`[错误] ${e?.message || String(e)}`)
  }
}

async function runTask(options = {}) {
  if (isRunning.value) return
  const finish = options.syncOdpsAfterDone ? finishRunAndSyncOdps : finishRun
  if (!autoPrecheckFlow.value) {
    isRunning.value = true
    resetRunUi()
    runStage.value = 'live'
    try {
      const result = await startTaskRun(await prepareRunParams(), '任务已启动，等待执行…')
      if (result.status === 'cancelled') return
      await finish(result)
    } catch (e) {
      isRunning.value = false
      runStage.value = ''
      currentRunId = null
      lastResult.value = { ok: false, msg: `✗ 失败: ${e?.message || String(e)}` }
      logs.value.push(`[错误] ${e?.message || String(e)}`)
    }
    return
  }

  isRunning.value = true
  resetRunUi()
  try {
    runStage.value = 'plan'
    const planResult = await startTaskRun(await prepareRunParams({ execute_mode: 'plan' }), 'Excel 预检已启动…')
    if (planResult.status === 'cancelled') return
    if (planResult.status !== 'done') {
      await finish(planResult)
      return
    }
    const gate = await inspectLatestPlanOutput()
    logs.value.push(`[${now()}] 预检结果：${gate.summary}`)
    scrollToBottom()
    if (!gate.pass) {
      await finishRun(planResult, {
        ok: false,
        message: `✗ 预检未通过：${gate.summary}`,
      })
      return
    }

    runStage.value = 'live'
    const liveResult = await startTaskRun(await prepareRunParams({ execute_mode: 'live' }), '预检通过，开始 live 执行…')
    if (liveResult.status === 'cancelled') return
    await finish(liveResult)
  } catch (e) {
    isRunning.value = false
    runStage.value = ''
    currentRunId = null
    lastResult.value = { ok: false, msg: `✗ 失败: ${e?.message || String(e)}` }
    logs.value.push(`[错误] ${e?.message || String(e)}`)
  }
}

async function runTaskAndSyncOdps() {
  if (!isTaskOdpsSyncable.value) return
  await runTask({ syncOdpsAfterDone: true })
}

async function clearLogs() {
  logs.value = []
  try {
    await window.cs.clearTaskLogs(props.adapterId, props.task.task_id)
  } catch {}
}

function logClass(line) {
  if (line.includes('ERROR') || line.includes('错误') || line.includes('失败')) return 'err'
  if (line.includes('[ok]') || line.includes('完成') || line.includes('Done')) return 'ok'
  if (line.includes('[warn]') || line.includes('警告')) return 'warn'
  return ''
}

function now() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

function fileName(path) {
  if (isHttpUrl(path)) {
    try {
      const parsed = new URL(String(path || ''))
      if (parsed.pathname.includes('/tmall-ai-image-approval/')) return '审批看板'
      return parsed.hostname
    } catch {}
  }
  return String(path || '').split('/').pop().split('\\').pop()
}

function openFile(path) {
  if (isApprovalBoardUrl(path)) {
    approvalBoardUrl.value = String(path || '').trim()
    openApprovalDrawer()
    return
  }
  window.cs.openFile(path)
}

function openApprovalDrawer() {
  if (!approvalBoardUrl.value) return
  if (isTmallAiImageChainTask.value) return
  approvalDrawerOpen.value = true
}

function handleApprovalBatchUpdated(payload) {
  approvalBatch.value = payload || null
  if (isTmallAiImageChainTask.value && hasAiChainCreateRows(payload)) {
    aiChainActiveStep.value = 'create'
  }
}

function isHttpUrl(path) {
  return /^https?:\/\//i.test(String(path || '').trim())
}

function isApprovalBoardUrl(path) {
  return isHttpUrl(path) && String(path || '').includes('/tmall-ai-image-approval/')
}

function visibleOutputFiles(files = []) {
  return (files || []).map(file => String(file || '').trim()).filter(file => file && !isApprovalBoardUrl(file))
}

function findApprovalBoardUrl(files = [], result = null) {
  const direct = String(result?.approval_board_url || '').trim()
  if (direct) return direct
  return (files || []).map(file => String(file || '').trim()).find(isApprovalBoardUrl) || ''
}

function isExcelFile(path) {
  return /\.(xlsx|xlsm|xls)$/i.test(String(path || ''))
}

function outputPathIcon(path) {
  const text = String(path || '').trim()
  const lower = text.toLowerCase()
  if (isHttpUrl(text)) return '🔗'
  if (isExcelFile(text)) return '📊'
  if (lower.endsWith('.zip')) return '🗜'
  if (!/\.[^\\/]+$/.test(text)) return '📁'
  return '📄'
}

async function syncOdpsFiles(paths) {
  const targets = (paths || [])
    .map(path => buildOdpsSyncFile(props.adapterId, props.task?.task_id, path))
    .filter(isOdpsSyncableFile)
  if (!targets.length || syncingOdps.value) return
  syncingOdps.value = true
  try {
    const syncTask = targets[0]
    const result = await window.cs.syncOdpsFiles({
      adapter_id: syncTask.adapter_id,
      task_id: syncTask.task_id,
      paths: targets.map(file => file.path),
    })
    const failedCount = Number(result?.failed_count || 0)
    const syncedCount = Number(result?.synced_count || 0)
    if (!result?.ok && failedCount && !syncedCount) {
      throw new Error(result.failed?.[0]?.error || '同步失败')
    }
    lastResult.value = {
      ok: failedCount === 0,
      msg: failedCount
        ? `同步完成：成功 ${syncedCount} 个，失败 ${failedCount} 个`
        : `同步成功：${syncedCount} 个文件`,
    }
  } catch (e) {
    lastResult.value = { ok: false, msg: `同步失败：${e?.message || String(e)}` }
  } finally {
    syncingOdps.value = false
  }
}

async function syncLatestOdps() {
  if (!latestExcelOutput.value) return
  await syncOdpsFiles([latestExcelOutput.value])
}

function isCustomDateSelected(paramId) {
  const v = values.value[paramId]
  return v === '自定义' || v === 'custom'
}

function selectSupportsCustom(param) {
  return (param?.options || []).some(opt =>
    opt?.value === '自定义' ||
    opt?.value === 'custom' ||
    String(opt?.label || '').includes('自定义')
  )
}

function getLinkedDateRangeIdForSelect(paramId) {
  const params = props.task?.params || []
  const selectParam = params.find(p => p.id === paramId)
  if (!selectSupportsCustom(selectParam)) return null
  const explicit = params.find(p => isRangeParamType(p.type) && p.id === 'custom_range')
  if (explicit) return explicit.id
  const samePrefix = params.find(p => isRangeParamType(p.type) && p.id === paramId.replace(/_range$/, '') + '_range')
  if (samePrefix) return samePrefix.id
  const matchingVisible = params.find(p =>
    isRangeParamType(p.type) &&
    normalizeVisibleWhenRules(p.visible_when).some(rule =>
      String(rule.field || rule.param_id || rule.id || '').trim() === paramId
    )
  )
  if (matchingVisible) return matchingVisible.id
  const dateRanges = params.filter(p => isRangeParamType(p.type))
  return dateRanges.length === 1 ? dateRanges[0].id : null
}

function getControllerSelectForDateRange(paramId) {
  const params = props.task?.params || []
  if (paramId === 'custom_range') {
    return params.find(p => p.type === 'select' && selectSupportsCustom(p)) || null
  }
  const rangeParam = params.find(p => p.id === paramId)
  const visibleRules = normalizeVisibleWhenRules(rangeParam?.visible_when)
  for (const rule of visibleRules) {
    const field = String(rule.field || rule.param_id || rule.id || '').trim()
    const select = params.find(p => p.id === field && p.type === 'select' && selectSupportsCustom(p))
    if (select) return select
  }
  return null
}

function normalizeVisibleWhenRules(visibleWhen) {
  if (!visibleWhen) return []
  return Array.isArray(visibleWhen) ? visibleWhen : [visibleWhen]
}

function shouldShowInlineCustomDate(param) {
  return isCustomDateSelected(param.id) && !getLinkedDateRangeIdForSelect(param.id)
}

function shouldShowDateRangeParam(param) {
  if (!isParamVisibleByRule(param)) return false
  const controller = getControllerSelectForDateRange(param.id)
  if (!controller) return true
  return isCustomDateSelected(controller.id)
}

function getTemporalInputType(type) {
  if (type === 'week') return 'week'
  if (type === 'month') return 'month'
  if (type === 'week_range') return 'week'
  if (type === 'month_range') return 'month'
  return 'date'
}

function formatTemporalDisplay(value, type) {
  if (!value) {
    if (type === 'week') return '年 / 第几周'
    if (type === 'month') return '年 / 月'
    if (type === 'week_range') return '年 / 第几周'
    if (type === 'month_range') return '年 / 月'
    return '年 / 月 / 日'
  }

  if (type === 'week') {
    const match = String(value).match(/^(\d{4})-W(\d{2})$/i)
    if (match) return `${match[1]} / 第 ${match[2]} 周`
  }

  if (type === 'month') {
    return String(value).replace(/-/g, ' / ')
  }

  if (type === 'week_range') {
    const match = String(value).match(/^(\d{4})-W(\d{2})$/i)
    if (match) return `${match[1]} / 第 ${match[2]} 周`
  }

  if (type === 'month_range') {
    return String(value).replace(/-/g, ' / ')
  }

  return String(value).replace(/-/g, ' / ')
}

function setDateInputRef(key, el) {
  if (el) {
    dateInputRefs.set(key, el)
  } else {
    dateInputRefs.delete(key)
  }
}

function openDatePicker(key) {
  const input = dateInputRefs.get(key)
  if (!input) return
  input.focus({ preventScroll: true })
  if (typeof input.showPicker === 'function') {
    input.showPicker()
    return
  }
  input.click()
}

async function pickExcel(paramId) {
  const path = await window.cs.browseFile({
    title: '选择 Excel 或 CSV 文件',
    excel: true,
  })
  if (!path) return
  values.value[paramId + '_path'] = path
  values.value[paramId + '_rows'] = []
  values.value[paramId + '_headers'] = []
  excelLoading.value[paramId] = true
  try {
    const r = await window.cs.readExcel(path)
    if (r.rows) {
      values.value[paramId + '_rows'] = r.rows
      values.value[paramId + '_headers'] = r.headers
    }
  } catch (e) {
    values.value[paramId + '_path'] = ''
  } finally {
    excelLoading.value[paramId] = false
  }
}

function clearExcel(paramId) {
  values.value[paramId + '_path'] = ''
  values.value[paramId + '_rows'] = []
  values.value[paramId + '_headers'] = []
}

async function pickDirectory(param) {
  const paramId = param?.id
  if (!paramId) return
  const path = await window.cs.browseFile({
    title: param?.label ? `选择${param.label}` : '选择目录',
    directory: true,
  })
  if (!path) return
  values.value[paramId] = path
  if (param.include_file_listing) await refreshDirectoryFileListing(param, path)
}

function clearDirectory(paramId) {
  values.value[paramId] = ''
  values.value[paramId + '_files'] = []
  directoryListingError.value[paramId] = ''
  directoryListingLoading.value[paramId] = false
}

async function refreshDirectoryFileListing(param, rootPath) {
  const paramId = param?.id
  if (!paramId || !rootPath) return []
  directoryListingLoading.value[paramId] = true
  directoryListingError.value[paramId] = ''
  values.value[paramId + '_files'] = []
  try {
    if (typeof window.cs.listDirectoryFiles !== 'function') {
      throw new Error('当前客户端不支持目录文件清单')
    }
    const result = await window.cs.listDirectoryFiles(rootPath, {
      extensions: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'm4v'],
      max_files: 10000,
    })
    const files = normalizeDirectoryFileListing(result)
    values.value[paramId + '_files'] = files
    if (result?.truncated) {
      directoryListingError.value[paramId] = `目录文件较多，已读取前 ${files.length} 个文件`
    }
    return files
  } catch (error) {
    directoryListingError.value[paramId] = `目录扫描失败：${error?.message || String(error)}`
    values.value[paramId + '_files'] = []
    return []
  } finally {
    directoryListingLoading.value[paramId] = false
  }
}

async function ensureDirectoryListingsForRun() {
  for (const param of taskParams.value) {
    if (!isParamVisibleInForm(param)) continue
    if (param.type !== 'directory' || !param.include_file_listing) continue
    const rootPath = values.value[param.id]
    if (!rootPath) continue
    const currentFiles = normalizeDirectoryFileListing(values.value[param.id + '_files'])
    if (currentFiles.length) continue
    const files = await refreshDirectoryFileListing(param, rootPath)
    if (directoryListingError.value[param.id]) {
      logs.value.push(`[${now()}] ${directoryListingError.value[param.id]}`)
      scrollToBottom()
    } else if (files.length) {
      logs.value.push(`[${now()}] 已扫描${param.label || '目录'}：${files.length} 个文件`)
      scrollToBottom()
    }
    if (!files.length && /不支持目录文件清单/.test(directoryListingError.value[param.id] || '')) {
      throw new Error(`${param.label || '素材根目录'}需要目录文件清单能力，请重启开发版后再运行`)
    }
  }
}

async function prepareRunParams(overrides = {}) {
  await ensureDirectoryListingsForRun()
  return buildRunParams(overrides)
}

async function pickImages(param) {
  const paramId = param?.id
  if (!paramId) return
  const paths = await window.cs.browseFile({
    title: '选择图片文件',
    images: true,
    multi: true,
  })
  if (!Array.isArray(paths) || !paths.length) return
  values.value[paramId + '_paths'] = normalizeImagePaths(paths, imageParamLimit(param))
}

function clearImages(paramId) {
  values.value[paramId + '_paths'] = []
}

async function pickFilePaths(param) {
  const paramId = param?.id
  if (!paramId) return
  const paths = await window.cs.browseFile({
    title: param?.label ? `选择${param.label}` : filePickerButtonLabel(param),
    zip: param?.type === 'file_zip',
    pdf: param?.type === 'file_pdf',
    multi: true,
  })
  if (!Array.isArray(paths) || !paths.length) return
  values.value[paramId + '_paths'] = normalizeFilePaths(paths)
}

function clearFilePaths(paramId) {
  values.value[paramId + '_paths'] = []
}

function isShenhuiPdfScreenshotTask() {
  return props.adapterId === 'shenhui-new-arrival'
    && props.task?.task_id === 'pdf_batch_screenshot'
}

function isShenhuiPrepareUploadPackageTask() {
  return props.adapterId === 'shenhui-new-arrival'
    && props.task?.task_id === 'prepare_upload_package'
}

function isShenhuiPdfCropTemplateTask() {
  return isShenhuiPdfScreenshotTask() || isShenhuiPrepareUploadPackageTask()
}

function pdfCropTypeForFilesParam(param) {
  if (!isShenhuiPdfScreenshotTask() || param?.type !== 'file_pdf') return ''
  if (param?.id === 'wash_pdf_files') return 'wash_label'
  if (param?.id === 'tag_pdf_files') return 'hang_tag'
  if (param?.id === 'pdf_files') return 'auto'
  return ''
}

function pdfCropButtonLabel(type) {
  if (type === 'hang_tag') return '框选吊牌模板'
  if (type === 'wash_label') return '框选洗唛模板'
  return '框选截图模板'
}

function pdfCropTemplateSummaryForType(type) {
  const field = pdfCropTemplateField(type)
  const boxes = parsePdfCropTemplate(values.value[field])
  const savedCount = (pdfCropSavedTemplates.value[type] || []).length
  const status = boxes.length ? `已设置 ${boxes.length} 个截图框` : '未设置'
  return savedCount ? `${status} / 本地 ${savedCount} 个模板` : status
}

function pdfCropTemplateField(type) {
  return type === 'hang_tag' ? 'tag_crop_boxes' : 'wash_crop_boxes'
}

function pdfCropFileParamIdForType(type) {
  return type === 'hang_tag' ? 'tag_pdf_files' : 'wash_pdf_files'
}

function pdfCropSourcePathsForType(type) {
  const rolePaths = normalizeFilePaths(values.value[`${pdfCropFileParamIdForType(type)}_paths`] || [])
  if (rolePaths.length) return rolePaths
  return normalizeFilePaths(values.value.pdf_files_paths || [])
}

function candidatePdfPathForType(type) {
  const paths = pdfCropSourcePathsForType(type)
  if (!paths.length) return ''
  return paths[0]
}

function clampPdfCropZoom(value) {
  return Math.min(4, Math.max(0.5, Number(value) || 1))
}

function clampPdfCropValue(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0))
}

function normalizePdfCropBox(box) {
  if (!box) return null
  const x = Array.isArray(box) ? Number(box[0]) : Number(box.x ?? box.left)
  const y = Array.isArray(box) ? Number(box[1]) : Number(box.y ?? box.top)
  const width = Array.isArray(box) ? Number(box[2]) : Number(box.width ?? box.w)
  const height = Array.isArray(box) ? Number(box[3]) : Number(box.height ?? box.h)
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null
  const left = clampPdfCropValue(x)
  const top = clampPdfCropValue(y)
  const right = clampPdfCropValue(x + width)
  const bottom = clampPdfCropValue(y + height)
  if (right - left < PDF_CROP_MIN_SIZE || bottom - top < PDF_CROP_MIN_SIZE) return null
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

function parsePdfCropTemplate(rawValue) {
  const raw = String(rawValue || '').trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    const items = Array.isArray(parsed) ? parsed : [parsed]
    return items.map(normalizePdfCropBox).filter(Boolean)
  } catch {
    return []
  }
}

function roundedPdfCropBox(selection) {
  const normalized = normalizePdfCropBox(selection)
  if (!normalized) return null
  return {
    x: Number(normalized.x.toFixed(4)),
    y: Number(normalized.y.toFixed(4)),
    width: Number(normalized.width.toFixed(4)),
    height: Number(normalized.height.toFixed(4)),
  }
}

function pdfCropTemplatesState() {
  return {
    wash_label: [],
    hang_tag: [],
  }
}

function normalizePdfCropTemplateRecord(record, fallbackIndex = 0) {
  const boxes = Array.isArray(record?.boxes)
    ? record.boxes.map(normalizePdfCropBox).filter(Boolean)
    : []
  if (!boxes.length) return null
  const now = Date.now()
  return {
    id: String(record?.id || `template-${now}-${fallbackIndex}`),
    name: String(record?.name || `模板 ${fallbackIndex + 1}`).trim() || `模板 ${fallbackIndex + 1}`,
    boxes,
    updatedAt: Number(record?.updatedAt) || now,
  }
}

function loadPdfCropSavedTemplates() {
  const next = pdfCropTemplatesState()
  try {
    const raw = window.localStorage?.getItem(PDF_CROP_TEMPLATE_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    for (const type of ['wash_label', 'hang_tag']) {
      next[type] = Array.isArray(parsed?.[type])
        ? parsed[type].map(normalizePdfCropTemplateRecord).filter(Boolean)
        : []
    }
  } catch {}
  pdfCropSavedTemplates.value = next
  pdfCropSavedTemplatesLoaded.value = true
}

function persistPdfCropSavedTemplates() {
  try {
    window.localStorage?.setItem(PDF_CROP_TEMPLATE_STORAGE_KEY, JSON.stringify(pdfCropSavedTemplates.value))
  } catch {}
}

function boxesToPdfCropTemplateValue(boxes) {
  return JSON.stringify((boxes || []).map(box => roundedPdfCropBox(box)).filter(Boolean))
}

function applyDefaultPdfCropTemplatesToValues() {
  if (!isShenhuiPdfCropTemplateTask()) return
  for (const type of ['wash_label', 'hang_tag']) {
    const field = pdfCropTemplateField(type)
    const currentValue = String(values.value[field] || '').trim()
    if (currentValue && !pdfCropManifestDefaultValues[field]?.[currentValue]) continue
    const template = pdfCropSavedTemplates.value[type]?.[0]
    if (template?.boxes?.length) values.value[field] = boxesToPdfCropTemplateValue(template.boxes)
  }
}

function activePdfCropTemplate() {
  const activeId = pdfCropModal.value.activeTemplateId
  if (!activeId) return null
  return (pdfCropSavedTemplates.value[pdfCropModal.value.type] || []).find(template => template.id === activeId) || null
}

function currentPdfCropBoxesForLocalTemplate() {
  const selectedBox = roundedPdfCropBox(pdfCropModal.value.selection)
  if (selectedBox) return [selectedBox]
  const field = pdfCropTemplateField(pdfCropModal.value.type)
  return parsePdfCropTemplate(values.value[field])
}

function applySavedPdfCropTemplate(templateId) {
  const template = (pdfCropSavedTemplates.value[pdfCropModal.value.type] || []).find(item => item.id === templateId)
  if (!template) {
    pdfCropModal.value.activeTemplateId = ''
    pdfCropModal.value.templateNameDraft = ''
    return
  }
  const field = pdfCropTemplateField(pdfCropModal.value.type)
  values.value[field] = boxesToPdfCropTemplateValue(template.boxes)
  pdfCropModal.value.selection = normalizePdfCropBox(template.boxes[0])
  pdfCropModal.value.activeTemplateId = template.id
  pdfCropModal.value.templateNameDraft = template.name
  pdfCropModal.value.error = ''
}

function saveCurrentPdfCropAsLocalTemplate() {
  const boxes = currentPdfCropBoxesForLocalTemplate()
  if (!boxes.length) {
    pdfCropModal.value.error = '请先设置一个有效截图框，再保存本地模板。'
    return
  }
  const defaultName = pdfCropModal.value.type === 'hang_tag' ? '吊牌模板' : '洗唛模板'
  const cleanName = String(pdfCropModal.value.templateNameDraft || '').trim()
    || `${defaultName} ${currentPdfCropSavedTemplates.value.length + 1}`
  const template = {
    id: `template-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: cleanName,
    boxes: boxes.map(normalizePdfCropBox).filter(Boolean),
    updatedAt: Date.now(),
  }
  values.value[pdfCropTemplateField(pdfCropModal.value.type)] = boxesToPdfCropTemplateValue(template.boxes)
  pdfCropSavedTemplates.value[pdfCropModal.value.type] = [
    template,
    ...(pdfCropSavedTemplates.value[pdfCropModal.value.type] || []),
  ]
  persistPdfCropSavedTemplates()
  pdfCropModal.value.activeTemplateId = template.id
  pdfCropModal.value.templateNameDraft = template.name
  pdfCropModal.value.error = ''
}

function updateCurrentPdfCropLocalTemplate() {
  const template = activePdfCropTemplate()
  if (!template) return
  const boxes = currentPdfCropBoxesForLocalTemplate()
  if (!boxes.length) {
    pdfCropModal.value.error = '请先设置一个有效截图框，再更新本地模板。'
    return
  }
  const list = pdfCropSavedTemplates.value[pdfCropModal.value.type] || []
  const nextBoxes = boxes.map(normalizePdfCropBox).filter(Boolean)
  const nextName = String(pdfCropModal.value.templateNameDraft || '').trim() || template.name
  pdfCropSavedTemplates.value[pdfCropModal.value.type] = list.map(item =>
    item.id === template.id
      ? { ...item, name: nextName, boxes: nextBoxes, updatedAt: Date.now() }
      : item
  )
  values.value[pdfCropTemplateField(pdfCropModal.value.type)] = boxesToPdfCropTemplateValue(nextBoxes)
  persistPdfCropSavedTemplates()
  pdfCropModal.value.error = ''
}

function deleteCurrentPdfCropLocalTemplate() {
  const template = activePdfCropTemplate()
  if (!template) return
  const confirmed = window.confirm?.(`删除本地模板“${template.name}”？`) ?? true
  if (!confirmed) return
  pdfCropSavedTemplates.value[pdfCropModal.value.type] = (pdfCropSavedTemplates.value[pdfCropModal.value.type] || [])
    .filter(item => item.id !== template.id)
  persistPdfCropSavedTemplates()
  pdfCropModal.value.activeTemplateId = ''
  pdfCropModal.value.templateNameDraft = ''
  pdfCropModal.value.error = ''
}

function firstPdfCropTemplateBox(type) {
  const field = pdfCropTemplateField(type)
  return parsePdfCropTemplate(values.value[field])[0] || null
}

function normalizePdfPreviewPages(result) {
  const rawPages = Array.isArray(result?.pages) ? result.pages : []
  const pages = rawPages
    .map((page, index) => ({
      page: Number(page?.page) || index + 1,
      data_url: String(page?.data_url || ''),
      preview_path: String(page?.preview_path || ''),
      width: Number(page?.width) || 0,
      height: Number(page?.height) || 0,
    }))
    .filter(page => page.data_url)
  if (pages.length) return pages
  if (result?.data_url) return [{ page: 1, data_url: result.data_url, preview_path: result.preview_path || '', width: 0, height: 0 }]
  return []
}

function makePdfCropModalState(overrides = {}) {
  return {
    open: false,
    type: 'wash_label',
    previewPath: '',
    dataUrl: '',
    pages: [],
    pageIndex: 0,
    activeTemplateId: '',
    templateNameDraft: '',
    zoom: 1,
    loading: false,
    error: '',
    selection: null,
    interaction: null,
    ...overrides,
  }
}

function stopPdfCropInteraction() {
  window.removeEventListener('pointermove', handlePdfCropPointerMove)
  window.removeEventListener('pointerup', finishPdfCropSelection)
  window.removeEventListener('pointercancel', finishPdfCropSelection)
  pdfCropModal.value.interaction = null
}

function closePdfCropModal() {
  stopPdfCropInteraction()
  pdfCropModal.value = makePdfCropModalState()
}

async function openPdfCropModal(type) {
  const previewPath = candidatePdfPathForType(type)
  const defaultName = type === 'hang_tag' ? '吊牌模板' : '洗唛模板'
  const savedCount = (pdfCropSavedTemplates.value[type] || []).length
  pdfCropModal.value = makePdfCropModalState({
    open: true,
    type,
    previewPath,
    templateNameDraft: `${defaultName} ${savedCount + 1}`,
    selection: firstPdfCropTemplateBox(type),
  })
  if (!previewPath) {
    pdfCropModal.value.error = '请先选择至少一个 PDF 文件。'
    return
  }
  await loadPdfCropPreview(previewPath)
}

async function loadPdfCropPreview(previewPath) {
  if (!previewPath) return
  stopPdfCropInteraction()
  pdfCropModal.value.previewPath = previewPath
  pdfCropModal.value.loading = true
  pdfCropModal.value.error = ''
  pdfCropModal.value.dataUrl = ''
  pdfCropModal.value.pages = []
  pdfCropModal.value.pageIndex = 0
  pdfCropModal.value.zoom = 1
  pdfCropModal.value.selection = firstPdfCropTemplateBox(pdfCropModal.value.type)
  try {
    if (typeof window.cs.renderPdfPreview !== 'function') {
      throw new Error('PDF 预览能力尚未加载，请重启抓虾客户端后再框选。')
    }
    const result = await window.cs.renderPdfPreview(previewPath)
    const pages = normalizePdfPreviewPages(result)
    if (!result?.ok || !pages.length) {
      throw new Error(result?.error || 'PDF 预览生成失败')
    }
    pdfCropModal.value.pages = pages
    pdfCropModal.value.dataUrl = pages[0]?.data_url || ''
    resetPdfCropZoom()
  } catch (error) {
    pdfCropModal.value.error = error?.message || String(error)
  } finally {
    pdfCropModal.value.loading = false
  }
}

function setPdfCropPage(index) {
  const pages = pdfCropModal.value.pages
  if (!pages.length) return
  pdfCropModal.value.pageIndex = Math.min(pages.length - 1, Math.max(0, Number(index) || 0))
}

function resetPdfCropZoom() {
  pdfCropModal.value.zoom = 1
}

function adjustPdfCropZoom(delta) {
  pdfCropModal.value.zoom = clampPdfCropZoom((Number(pdfCropModal.value.zoom) || 1) + delta)
}

function pdfCropPointFromEvent(event) {
  const image = pdfCropImageRef.value
  if (!image) return null
  const rect = image.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  const x = clampPdfCropValue((event.clientX - rect.left) / rect.width)
  const y = clampPdfCropValue((event.clientY - rect.top) / rect.height)
  return { x, y }
}

function selectionFromEdges(left, top, right, bottom) {
  const safeLeft = clampPdfCropValue(Math.min(left, right))
  const safeTop = clampPdfCropValue(Math.min(top, bottom))
  const safeRight = clampPdfCropValue(Math.max(left, right))
  const safeBottom = clampPdfCropValue(Math.max(top, bottom))
  return {
    x: safeLeft,
    y: safeTop,
    width: Math.max(0, safeRight - safeLeft),
    height: Math.max(0, safeBottom - safeTop),
  }
}

function movePdfCropBox(startSelection, dx, dy) {
  const width = startSelection.width
  const height = startSelection.height
  return {
    x: clampPdfCropValue(startSelection.x + dx, 0, Math.max(0, 1 - width)),
    y: clampPdfCropValue(startSelection.y + dy, 0, Math.max(0, 1 - height)),
    width,
    height,
  }
}

function resizePdfCropBox(startSelection, handle, dx, dy) {
  let left = startSelection.x
  let top = startSelection.y
  let right = startSelection.x + startSelection.width
  let bottom = startSelection.y + startSelection.height

  if (handle.includes('w')) left += dx
  if (handle.includes('e')) right += dx
  if (handle.includes('n')) top += dy
  if (handle.includes('s')) bottom += dy

  left = clampPdfCropValue(left)
  right = clampPdfCropValue(right)
  top = clampPdfCropValue(top)
  bottom = clampPdfCropValue(bottom)

  if (right - left < PDF_CROP_MIN_SIZE) {
    if (handle.includes('w')) left = Math.max(0, right - PDF_CROP_MIN_SIZE)
    else right = Math.min(1, left + PDF_CROP_MIN_SIZE)
  }
  if (bottom - top < PDF_CROP_MIN_SIZE) {
    if (handle.includes('n')) top = Math.max(0, bottom - PDF_CROP_MIN_SIZE)
    else bottom = Math.min(1, top + PDF_CROP_MIN_SIZE)
  }

  return selectionFromEdges(left, top, right, bottom)
}

function beginPdfCropInteraction(event, interaction) {
  if (event.button != null && event.button !== 0) return
  event.preventDefault()
  stopPdfCropInteraction()
  pdfCropModal.value.error = ''
  pdfCropModal.value.interaction = interaction
  window.addEventListener('pointermove', handlePdfCropPointerMove)
  window.addEventListener('pointerup', finishPdfCropSelection)
  window.addEventListener('pointercancel', finishPdfCropSelection)
}

function startPdfCropSelection(event) {
  if (!hasPdfCropPreview.value || pdfCropModal.value.loading) return
  const point = pdfCropPointFromEvent(event)
  if (!point) return
  pdfCropModal.value.selection = { x: point.x, y: point.y, width: 0, height: 0 }
  beginPdfCropInteraction(event, {
    mode: 'create',
    startPoint: point,
    startSelection: { x: point.x, y: point.y, width: 0, height: 0 },
  })
}

function startPdfCropMove(event) {
  const point = pdfCropPointFromEvent(event)
  const selection = normalizePdfCropBox(pdfCropModal.value.selection)
  if (!point || !selection) return
  beginPdfCropInteraction(event, {
    mode: 'move',
    startPoint: point,
    startSelection: selection,
  })
}

function startPdfCropResize(event, handle) {
  const point = pdfCropPointFromEvent(event)
  const selection = normalizePdfCropBox(pdfCropModal.value.selection)
  if (!point || !selection) return
  beginPdfCropInteraction(event, {
    mode: 'resize',
    handle,
    startPoint: point,
    startSelection: selection,
  })
}

function handlePdfCropPointerMove(event) {
  const interaction = pdfCropModal.value.interaction
  const current = pdfCropPointFromEvent(event)
  if (!interaction || !current) return
  event.preventDefault()
  const start = interaction.startPoint
  const selection = interaction.startSelection
  const dx = current.x - start.x
  const dy = current.y - start.y

  if (interaction.mode === 'create') {
    pdfCropModal.value.selection = selectionFromEdges(start.x, start.y, current.x, current.y)
  } else if (interaction.mode === 'move') {
    pdfCropModal.value.selection = movePdfCropBox(selection, dx, dy)
  } else if (interaction.mode === 'resize') {
    pdfCropModal.value.selection = resizePdfCropBox(selection, interaction.handle, dx, dy)
  }
}

function finishPdfCropSelection(event) {
  if (pdfCropModal.value.interaction && event) handlePdfCropPointerMove(event)
  stopPdfCropInteraction()
}

function clearPdfCropSelection() {
  stopPdfCropInteraction()
  pdfCropModal.value.selection = null
}

function savePdfCropSelection(mode) {
  const nextBox = roundedPdfCropBox(pdfCropModal.value.selection)
  if (!nextBox) {
    pdfCropModal.value.error = '请先拖拽选择一个有效截图范围。'
    return
  }
  const field = pdfCropTemplateField(pdfCropModal.value.type)
  const existing = mode === 'append' ? parsePdfCropTemplate(values.value[field]) : []
  values.value[field] = JSON.stringify([...existing, nextBox])
  pdfCropModal.value.error = ''
  closePdfCropModal()
}

function getParamTemplates(param) {
  const templates = Array.isArray(param?.templates) ? param.templates.filter(Boolean) : []
  if (templates.length) return templates
  if (param?.template_file) {
    return [{
      file: param.template_file,
      label: param.template_label,
      path: param.template_path,
    }]
  }
  return []
}

function templateExtension(template) {
  const raw = template?.file || template?.path || ''
  const ext = raw.split('.').pop()?.toUpperCase()
  return ext ? `.${ext}` : '模板'
}

function canDownloadTemplate(template) {
  return Boolean(template?.path || template?.file)
}

async function downloadTemplate(task, param, template) {
  if (!canDownloadTemplate(template)) return
  delete templateFeedback.value[param.id]
  try {
    const r = await window.cs.saveAdapterTemplate(props.adapterId, template.file || '', template.path || '')
    if (r?.ok && r.dest) {
      templateFeedback.value[param.id] = {
        ok: true,
        msg: `${template.label || fileName(template.file || template.path)} 已保存：${fileName(r.dest)}`,
      }
    }
  } catch (e) {
    templateFeedback.value[param.id] = {
      ok: false,
      msg: `模板下载失败：${e?.message || String(e)}`,
    }
  }
}

onMounted(() => {
  loadPdfCropSavedTemplates()
  applyDefaultPdfCropTemplatesToValues()
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  document.addEventListener('keydown', handleDocumentKeydown)
})

onUnmounted(() => {
  clearInterval(pollTimer)
  stopPdfCropInteraction()
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  document.removeEventListener('keydown', handleDocumentKeydown)
})
</script>

<style scoped>
.runner { height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }

.runner-header {
  padding: 20px 24px 14px;
  border-bottom: 1px solid var(--border);
}
.runner-header h2 { font-size: 18px; font-weight: 700; color: var(--text); }
.desc { font-size: 12px; color: var(--text3); margin-top: 4px; }

.runner-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.ai-chain-runner .runner-body {
  padding: 16px 18px 24px;
  display: grid;
  gap: 16px;
  background: color-mix(in srgb, var(--bg) 88%, #111827 12%);
}
.ai-chain-tabs {
  padding: 10px 18px 0;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.ai-chain-tab {
  appearance: none;
  min-width: 0;
  min-height: 74px;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 12px 12px 0 0;
  background: transparent;
  color: inherit;
  padding: 10px 12px 12px;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  text-align: left;
  cursor: pointer;
  transition: background .16s, border-color .16s, transform .16s;
}
.ai-chain-tab:hover {
  background: rgba(255, 255, 255, .035);
}
.ai-chain-tab:active {
  transform: translateY(1px);
}
.ai-chain-tab:focus-visible {
  outline: 2px solid rgba(255, 106, 41, .58);
  outline-offset: -2px;
}
.ai-chain-tab.selected {
  border-color: var(--border);
  background: var(--bg);
  box-shadow: inset 0 2px 0 var(--orange);
}
.ai-chain-tab.active .ai-chain-tab-index {
  color: var(--orange);
  background: rgba(255, 106, 41, .1);
}
.ai-chain-tab.done .ai-chain-tab-index {
  color: #86efac;
  background: rgba(74, 222, 128, .1);
}
.ai-chain-tab.error .ai-chain-tab-index {
  color: #fca5a5;
  background: rgba(248, 113, 113, .06);
}
.ai-chain-tab-index {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, .055);
  color: var(--text);
  font-size: 12px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.ai-chain-tab strong,
.ai-chain-tab span {
  min-width: 0;
  display: block;
}
.ai-chain-tab strong {
  color: var(--text);
  font-size: 13px;
}
.ai-chain-tab div > span {
  margin-top: 5px;
  color: var(--text3);
  font-size: 12px;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ai-chain-step-panel {
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
  background: var(--bg2);
}
.ai-chain-runner .params-panel,
.ai-chain-runner .log-panel {
  border-bottom: 0;
}
.ai-chain-runner .log-panel {
  min-height: 240px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg2);
}
.ai-chain-panel-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  margin: -20px -24px 2px;
  border-bottom: 1px solid var(--border);
  background: rgba(255, 255, 255, .018);
}
.ai-chain-panel-head > span {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: var(--bg3);
  color: var(--orange);
  font-size: 12px;
  font-weight: 900;
}
.ai-chain-panel-head strong,
.ai-chain-panel-head small {
  display: block;
}
.ai-chain-panel-head strong {
  color: var(--text);
  font-size: 14px;
}
.ai-chain-panel-head small {
  margin-top: 3px;
  color: var(--text3);
  font-size: 12px;
}
.ai-chain-approval-panel,
.ai-chain-result-panel {
  padding: 20px 24px;
  display: grid;
  gap: 16px;
}
.ai-chain-approval-panel .ai-chain-panel-head,
.ai-chain-result-panel .ai-chain-panel-head {
  margin: -20px -24px 0;
}
.ai-chain-empty-panel {
  border: 1px dashed var(--border);
  border-radius: 12px;
  padding: 30px 18px;
  display: grid;
  gap: 6px;
  place-items: center;
  text-align: center;
  color: var(--text3);
}
.ai-chain-empty-panel.compact {
  padding: 20px 16px;
}
.ai-chain-empty-panel strong {
  color: var(--text);
}
.ai-chain-result-list {
  display: grid;
  gap: 10px;
}
.ai-chain-result-row {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg3);
  padding: 12px;
  display: grid;
  grid-template-columns: minmax(150px, 1.2fr) minmax(88px, .65fr) minmax(70px, .45fr) minmax(160px, 1fr) minmax(240px, 1.7fr);
  gap: 12px;
  align-items: start;
}
.ai-chain-result-row.ok {
  border-color: rgba(74, 222, 128, .26);
}
.ai-chain-result-row.error {
  border-color: rgba(248, 113, 113, .36);
}
.ai-chain-result-row span,
.ai-chain-result-row strong,
.ai-chain-result-row small {
  display: block;
  min-width: 0;
}
.ai-chain-result-row span {
  color: var(--text3);
  font-size: 11px;
}
.ai-chain-result-row strong {
  margin-top: 3px;
  color: var(--text);
  font-size: 12px;
  word-break: break-word;
}
.ai-chain-result-note span {
  color: var(--text);
  font-weight: 800;
}
.ai-chain-result-note small {
  margin-top: 5px;
  max-height: 54px;
  overflow: auto;
  color: #fca5a5;
  font-size: 11px;
  line-height: 1.45;
}

/* 参数面板 */
.params-panel {
  padding: 20px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.params-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px 20px;
  align-items: start;
}
.params-grid-shopee-bulk {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}
.param-group { min-width: 0; display: flex; flex-direction: column; gap: 7px; }
.param-span-full { grid-column: 1 / -1; }
.param-span-compact { grid-column: span 1; }
.param-span-half { grid-column: span 3; }
.param-span-third { grid-column: span 2; }
.param-label { font-size: 12px; color: var(--text2); font-weight: 500; }
.required { color: var(--orange); margin-left: 3px; }
.hint { font-size: 11px; color: var(--text3); line-height: 1.5; }
.probe-note {
  font-size: 12px;
  color: var(--text2);
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
}

.input {
  background: var(--bg3); border: 1px solid var(--border); border-radius: 8px;
  padding: 9px 12px; color: var(--text); font-size: 13px; outline: none;
  transition: border-color 0.15s; width: 100%;
}
.input:focus { border-color: var(--orange); }
.textarea {
  min-height: 104px;
  resize: vertical;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--text);
  font-size: 13px;
  line-height: 1.5;
  outline: none;
  width: 100%;
}
.textarea:focus { border-color: var(--orange); }
.textarea-compact { min-height: 78px; }
.line-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.line-list-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  gap: 8px;
  align-items: center;
}
.line-list-input {
  min-width: 0;
}
.line-list-remove {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg3);
  color: var(--text2);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.line-list-remove:hover:not(:disabled) {
  border-color: rgba(255, 99, 35, 0.75);
  color: var(--orange);
  background: rgba(255, 99, 35, 0.08);
}
.line-list-remove:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
.line-list-add {
  align-self: flex-start;
  border: 1px solid rgba(255, 99, 35, 0.45);
  background: rgba(255, 99, 35, 0.08);
  color: var(--orange);
  border-radius: 8px;
  padding: 7px 11px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.line-list-add:hover {
  border-color: var(--orange);
  background: rgba(255, 99, 35, 0.14);
}
.input-number { width: 100%; }
.select {
  background: var(--bg3); border: 1px solid var(--border); border-radius: 8px;
  padding: 9px 12px; color: var(--text); font-size: 13px; outline: none;
  cursor: pointer; width: 100%;
}
.select:focus { border-color: var(--orange); }

.multi-select {
  position: relative;
}
.multi-select-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 42px;
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg3);
  color: var(--text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.multi-select-trigger:hover,
.multi-select-trigger.open {
  border-color: var(--orange);
}
.multi-select-trigger:focus-visible {
  border-color: var(--orange);
  outline: none;
}
.multi-select-trigger.empty {
  color: var(--text3);
}
.multi-select-trigger-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.multi-select-trigger-icon {
  flex-shrink: 0;
  color: var(--text2);
  font-size: 14px;
  line-height: 1;
}
.multi-select-panel {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 20;
  padding: 10px 12px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg2);
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.28);
}
.multi-select-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--text2);
}
.multi-select-clear {
  border: none;
  background: transparent;
  color: var(--orange);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}
.multi-select-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow: auto;
  padding-right: 2px;
}
.multi-select-option {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}
.multi-select-option input[type=checkbox] {
  accent-color: var(--orange);
  width: 14px;
  height: 14px;
  cursor: pointer;
}
.multi-select-option-label {
  min-width: 0;
}

.radio-group { display: flex; gap: 20px; flex-wrap: wrap; }
.radio-item { display: flex; align-items: center; gap: 7px; cursor: pointer; }
.radio-item input[type=radio] { accent-color: var(--orange); width: 15px; height: 15px; cursor: pointer; }
.radio-label { font-size: 13px; color: var(--text); }

.checkbox-group { display: flex; gap: 16px; flex-wrap: wrap; }
.checkbox-item { display: flex; align-items: center; gap: 7px; cursor: pointer; }
.checkbox-item input[type=checkbox] { accent-color: var(--orange); width: 14px; height: 14px; cursor: pointer; }
.checkbox-label { font-size: 13px; color: var(--text); }

.date-range-panel {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg3);
}
.date-range { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.date-sep { font-size: 12px; color: var(--text2); }
.date-range .input { width: 160px; }
.custom-date-hint { font-size: 11px; color: var(--text3); margin-top: 10px; font-weight: 600; letter-spacing: 0.04em; }
.date-card {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 180px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg2);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform 0.15s;
  overflow: hidden;
}
.date-card:hover { border-color: var(--orange); background: rgba(255,255,255,0.04); transform: translateY(-1px); }
.date-card:focus-within { border-color: var(--orange); box-shadow: 0 0 0 3px rgba(255, 106, 41, 0.12); }
.date-card-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  pointer-events: none;
}
.date-card-value {
  font-size: 13px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.date-card-value.placeholder { color: var(--text3); }
.date-card-icon {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text3);
  pointer-events: none;
}

/* 执行按钮 */
.action-row { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding-top: 4px; }
.run-btn {
  padding: 10px 28px; border-radius: 10px; border: none;
  background: var(--orange); color: white;
  font-size: 14px; font-weight: 700;
  transition: all 0.15s; letter-spacing: 0.03em;
}
.run-btn:hover:not(:disabled) { background: var(--orange-dim); transform: translateY(-1px); }
.run-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.run-btn.running { background: #555; }
.run-btn.mini { padding: 10px 18px; font-size: 13px; }
.run-sub-btn {
  padding: 10px 18px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg3);
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  transition: all 0.15s;
}
.run-sub-btn:hover:not(:disabled) { border-color: var(--orange); color: var(--orange); transform: translateY(-1px); }
.run-sub-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
.run-sync-btn {
  min-width: 184px;
  border-color: rgba(34,197,94,0.55);
  background: #16a34a;
  color: #fff;
}
.run-sync-btn:hover:not(:disabled) {
  border-color: rgba(74,222,128,0.8);
  background: #15803d;
  color: #fff;
}
.run-sub-btn-stop { border-color: rgba(248,113,113,0.35); color: #fca5a5; }
.run-sub-btn-stop:hover:not(:disabled) { border-color: #f87171; color: #f87171; }
.action-note { font-size: 12px; color: var(--text3); }
.missing-hint { font-size: 12px; color: var(--text3); }
.reset-link { font-size: 12px; color: var(--text3); cursor: pointer; text-decoration: underline; }
.reset-link:hover { color: #f87171; }
.result-badge { font-size: 12px; padding: 4px 10px; border-radius: 6px; }
.result-badge.ok  { background: rgba(74,222,128,0.12); color: #4ade80; }
.result-badge.err { background: rgba(248,113,113,0.12); color: #f87171; }

/* 日志面板 */
.log-panel {
  min-height: 280px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.log-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 16px; background: var(--bg2); border-bottom: 1px solid var(--border);
}
.log-header > span { font-size: 12px; color: var(--text2); font-weight: 600; }
.log-actions { display: flex; align-items: center; gap: 12px; }
.progress-strip {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(255,106,41,0.08), rgba(255,106,41,0.03));
}
.progress-strip-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.progress-strip-main {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  flex-wrap: wrap;
}
.progress-strip-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px 16px;
  flex-wrap: wrap;
  min-width: 0;
  text-align: right;
  font-size: 12px;
  color: var(--text2);
}
.progress-strip-title {
  font-size: 11px;
  color: var(--text3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.progress-strip-value {
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.progress-strip-percent {
  font-size: 12px;
  color: var(--orange);
  font-weight: 700;
}
.progress-strip-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.progress-stage-stack {
  gap: 12px;
}
.progress-track {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.progress-track-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  color: var(--text2);
  font-variant-numeric: tabular-nums;
}
.progress-track-secondary .progress-track-label {
  color: var(--text3);
}
.progress-strip-bar {
  position: relative;
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,106,41,0.18);
}
.progress-strip-bar.indeterminate {
  background: rgba(255,255,255,0.06);
}
.progress-strip-bar-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--orange), #ff9a5f);
  box-shadow: 0 0 12px rgba(255,106,41,0.25);
  transition: width 180ms ease;
}
.progress-strip-bar-secondary {
  border-color: rgba(124, 139, 255, 0.18);
  background: rgba(124, 139, 255, 0.08);
}
.progress-strip-bar-fill-secondary {
  background: linear-gradient(90deg, #7c8bff, #9dc1ff);
  box-shadow: 0 0 12px rgba(124, 139, 255, 0.22);
}
.progress-strip-bar-fill.indeterminate {
  width: 36%;
  min-width: 120px;
  border-radius: 999px;
  animation: progress-slide 1.6s ease-in-out infinite;
}
.progress-stage-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 13px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.06);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.018)),
    rgba(9, 11, 18, 0.26);
  overflow: hidden;
}
.progress-stage-card::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(circle at top right, rgba(255,255,255,0.07), transparent 44%);
  opacity: 0.55;
}
.progress-stage-card-primary {
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03), 0 10px 28px rgba(255,106,41,0.06);
}
.progress-stage-card-secondary {
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03), 0 10px 28px rgba(124,139,255,0.05);
}
.progress-stage-card-active {
  border-color: rgba(255,255,255,0.1);
}
.progress-stage-card-complete {
  border-color: rgba(255,255,255,0.08);
}
.progress-stage-card-head,
.progress-stage-card-kicker,
.progress-stage-card-mainline,
.progress-stage-card-meta {
  position: relative;
  z-index: 1;
}
.progress-stage-card-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.progress-stage-card-kicker {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.progress-stage-card-title {
  font-size: 11px;
  color: var(--text3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.progress-stage-card-status {
  font-size: 11px;
  line-height: 1;
  padding: 5px 8px;
  border-radius: 999px;
  color: var(--text2);
  background: rgba(255,255,255,0.06);
}
.progress-stage-card-mainline {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.progress-stage-card-main {
  font-size: 19px;
  font-weight: 800;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.progress-stage-card-percent {
  font-size: 12px;
  font-weight: 700;
  color: var(--text2);
  font-variant-numeric: tabular-nums;
}
.progress-stage-card-primary .progress-stage-card-percent,
.progress-stage-card-primary .progress-stage-card-status {
  color: #ffb182;
}
.progress-stage-card-secondary .progress-stage-card-percent,
.progress-stage-card-secondary .progress-stage-card-status {
  color: #b9c4ff;
}
.progress-stage-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-size: 12px;
  color: var(--text2);
}
.progress-stage-bar {
  position: relative;
  z-index: 1;
}
.progress-strip-sub {
  font-size: 12px;
  color: var(--text2);
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@keyframes progress-slide {
  0% { transform: translateX(-110%); }
  50% { transform: translateX(90%); }
  100% { transform: translateX(240%); }
}
.output-count {
  font-size: 11px; color: var(--orange); cursor: pointer;
  padding: 2px 8px; border-radius: 5px; background: var(--orange-bg);
}
.clear-btn {
  font-size: 11px; color: var(--text3); background: transparent; border: none;
  padding: 2px 8px; border-radius: 5px;
}
.clear-btn:hover { color: var(--text2); background: var(--bg3); }
.sync-btn { color: #86efac; border: 1px solid rgba(74,222,128,0.18); }
.sync-btn:hover:not(:disabled) { color: #bbf7d0; background: rgba(74,222,128,0.08); }
.sync-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.file-list {
  background: var(--bg3); border-bottom: 1px solid var(--border);
  padding: 8px 16px; display: flex; flex-direction: column; gap: 4px;
}
.file-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; border-radius: 7px;
  transition: background 0.1s;
}
.file-item:hover { background: var(--bg2); }
.file-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.file-icon { font-size: 14px; }
.file-name { flex: 1; min-width: 0; font-size: 12px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-open { font-size: 11px; color: var(--orange); }
.file-sync {
  border: 1px solid rgba(74,222,128,0.25);
  background: rgba(74,222,128,0.06);
  color: #86efac;
  border-radius: 6px;
  padding: 4px 9px;
  font-size: 11px;
}
.file-sync:disabled { opacity: 0.45; cursor: not-allowed; }
.file-sync:hover:not(:disabled) { background: rgba(74,222,128,0.12); }

.log-body {
  flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px;
  font-family: 'Menlo', 'Monaco', monospace; font-size: 12px; line-height: 1.7;
}
.log-empty { color: var(--text3); text-align: center; padding: 40px 0; }
.log-line { color: var(--text2); white-space: pre-wrap; word-break: break-all; }
.log-line.ok   { color: #4ade80; }
.log-line.err  { color: #f87171; }
.log-line.warn { color: #fbbf24; }

/* 文件选择控件 */
.file-picker { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.file-chosen {
  flex: 1; display: flex; align-items: center; gap: 8px;
  background: var(--bg3); border: 1px solid var(--border); border-radius: 8px;
  padding: 8px 12px; cursor: pointer; transition: border-color 0.15s;
  min-width: 0;
}
.file-chosen:hover { border-color: var(--orange); }
.file-chosen.empty .f-label { color: var(--text3); }
.file-picker-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.f-ico { font-size: 15px; flex-shrink: 0; }
.f-label { flex: 1; font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.f-clear { font-size: 12px; color: var(--text3); flex-shrink: 0; line-height: 1; }
.f-clear:hover { color: #f87171; }
.btn-pick {
  padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--bg3); color: var(--text2); font-size: 12px; white-space: nowrap;
}
.btn-pick:hover { background: var(--orange-bg); color: var(--orange); border-color: var(--orange); }
.pdf-crop-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 2px;
}
.pdf-crop-status {
  font-size: 11px;
  color: var(--text3);
}
.pdf-crop-modal {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.56);
}
.pdf-crop-dialog {
  width: min(1480px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg2);
  box-shadow: 0 24px 72px rgba(0, 0, 0, 0.42);
}
.pdf-crop-head {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
}
.pdf-crop-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}
.pdf-crop-subtitle {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text3);
  line-height: 1.5;
}
.pdf-crop-close {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg3);
  color: var(--text2);
  font-size: 20px;
  line-height: 1;
}
.pdf-crop-close:hover { border-color: var(--orange); color: var(--orange); }
.pdf-crop-toolbar {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) auto auto auto;
  gap: 12px;
  align-items: center;
}
.pdf-crop-page-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.pdf-crop-page-step {
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg3);
  color: var(--text2);
  font-size: 12px;
}
.pdf-crop-page-step:hover:not(:disabled) {
  color: var(--orange);
  border-color: var(--orange);
}
.pdf-crop-page-step:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.pdf-crop-page-current {
  min-width: 76px;
  font-size: 12px;
  color: var(--text2);
  text-align: center;
}
.pdf-crop-zoom-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.pdf-crop-zoom-range {
  width: 120px;
  accent-color: var(--orange);
}
.pdf-crop-zoom-value {
  min-width: 44px;
  font-size: 12px;
  color: var(--text2);
  text-align: right;
}
.pdf-crop-template-manager {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(180px, 260px) auto auto auto;
  gap: 10px;
  align-items: center;
}
.pdf-crop-template-name {
  min-width: 0;
}
.run-sub-btn.danger {
  color: #fca5a5;
}
.run-sub-btn.danger:hover:not(:disabled) {
  border-color: rgba(248, 113, 113, 0.45);
  background: rgba(248, 113, 113, 0.1);
}
.pdf-crop-template-current,
.pdf-crop-selection-text {
  font-size: 12px;
  color: var(--text3);
}
.pdf-crop-error,
.pdf-crop-loading {
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--border);
  border-radius: 10px;
  color: var(--text3);
}
.pdf-crop-error { color: #fca5a5; }
.pdf-crop-error.compact {
  min-height: 0;
  justify-content: flex-start;
  padding: 8px 10px;
  border-style: solid;
}
.pdf-crop-workspace {
  min-height: 0;
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 14px;
}
.pdf-crop-workspace.no-pages {
  grid-template-columns: minmax(0, 1fr);
}
.pdf-crop-page-list {
  max-height: min(62vh, 760px);
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
}
.pdf-crop-page-button {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  padding: 8px;
  margin-bottom: 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text3);
}
.pdf-crop-page-button:last-child { margin-bottom: 0; }
.pdf-crop-page-button img {
  width: 100%;
  max-height: 132px;
  object-fit: contain;
  border-radius: 6px;
  background: #fff;
}
.pdf-crop-page-button span {
  font-size: 12px;
}
.pdf-crop-page-button:hover,
.pdf-crop-page-button.active {
  border-color: var(--orange);
  color: var(--orange);
  background: rgba(255, 106, 41, 0.1);
}
.pdf-crop-stage {
  position: relative;
  min-width: 0;
  max-width: 100%;
  max-height: min(62vh, 760px);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
  user-select: none;
}
.pdf-crop-canvas {
  position: relative;
  display: inline-block;
  line-height: 0;
  cursor: crosshair;
}
.pdf-crop-preview {
  display: block;
  height: auto;
}
.pdf-crop-selection {
  position: absolute;
  border: 2px solid var(--orange);
  background: rgba(255, 106, 41, 0.16);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.12);
  box-sizing: border-box;
  cursor: move;
  pointer-events: auto;
}
.pdf-crop-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  border: 2px solid #fff;
  border-radius: 999px;
  background: var(--orange);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
}
.pdf-crop-handle.handle-nw { left: -7px; top: -7px; cursor: nwse-resize; }
.pdf-crop-handle.handle-n { left: 50%; top: -7px; transform: translateX(-50%); cursor: ns-resize; }
.pdf-crop-handle.handle-ne { right: -7px; top: -7px; cursor: nesw-resize; }
.pdf-crop-handle.handle-e { right: -7px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
.pdf-crop-handle.handle-se { right: -7px; bottom: -7px; cursor: nwse-resize; }
.pdf-crop-handle.handle-s { left: 50%; bottom: -7px; transform: translateX(-50%); cursor: ns-resize; }
.pdf-crop-handle.handle-sw { left: -7px; bottom: -7px; cursor: nesw-resize; }
.pdf-crop-handle.handle-w { left: -7px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
.pdf-crop-foot {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
}
.pdf-crop-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}
@media (max-width: 760px) {
  .pdf-crop-modal { padding: 12px; }
  .pdf-crop-dialog {
    width: calc(100vw - 24px);
    max-height: calc(100vh - 24px);
  }
  .pdf-crop-toolbar,
  .pdf-crop-template-manager,
  .pdf-crop-foot {
    grid-template-columns: 1fr;
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
  .pdf-crop-workspace {
    grid-template-columns: 1fr;
  }
  .pdf-crop-page-list {
    max-height: none;
    display: flex;
    overflow-x: auto;
  }
  .pdf-crop-page-button {
    flex: 0 0 112px;
    margin-bottom: 0;
  }
}
.btn-template {
  padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(255, 106, 41, 0.28);
  background: rgba(255, 106, 41, 0.1); color: var(--orange); font-size: 12px; font-weight: 600;
  white-space: nowrap;
}
.btn-template:hover { background: rgba(255, 106, 41, 0.16); border-color: rgba(255, 106, 41, 0.42); }
.btn-template:disabled { opacity: 0.45; cursor: not-allowed; }
.template-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 2px;
}
.template-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
}
.template-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.template-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.template-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}
.template-ext,
.template-version {
  font-size: 10px;
  color: var(--text3);
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--bg2);
  border: 1px solid var(--border);
  letter-spacing: 0.04em;
}
.template-desc {
  margin: 0;
  font-size: 11px;
  color: var(--text3);
  line-height: 1.45;
}
.excel-preview {
  display: flex; gap: 12px; align-items: center;
  padding: 5px 10px; background: rgba(74,222,128,0.07); border-radius: 6px;
}
.preview-count { font-size: 12px; color: #4ade80; font-weight: 600; }
.preview-cols { font-size: 11px; color: var(--text3); }
.excel-loading { font-size: 12px; color: var(--text3); padding: 4px 0; }
.template-feedback { font-size: 12px; padding: 4px 0; }
.template-feedback.ok { color: #4ade80; }
.template-feedback.err { color: #f87171; }
.image-file-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.param-quick-fill-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.param-quick-fill-chip {
  max-width: 100%;
  font-size: 11px;
  line-height: 1.35;
  color: var(--text2);
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg3);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.param-quick-fill-chip:hover {
  border-color: var(--orange);
  color: var(--text);
}
.image-file-chip {
  max-width: 100%;
  font-size: 11px;
  color: var(--text2);
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--bg3);
  border: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 1040px) {
  .ai-chain-tabs {
    grid-template-columns: repeat(3, minmax(220px, 1fr));
    overflow-x: auto;
  }
  .ai-chain-tab {
    min-width: 220px;
  }
  .ai-chain-result-row {
    grid-template-columns: 1fr 1fr;
  }
  .params-grid {
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }
  .params-grid-shopee-bulk {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }

  .progress-strip {
    gap: 8px;
  }

  .progress-strip-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .progress-strip-meta {
    justify-content: flex-start;
    text-align: left;
  }

  .progress-strip-sub {
    text-align: left;
    white-space: normal;
  }
}

@media (max-width: 900px) {
  .ai-chain-runner .runner-body {
    padding: 12px;
  }
  .ai-chain-approval-panel,
  .ai-chain-result-panel {
    padding: 16px;
  }
  .ai-chain-approval-panel .ai-chain-panel-head,
  .ai-chain-result-panel .ai-chain-panel-head {
    margin: -16px -16px 0;
  }
  .params-grid-shopee-bulk {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .param-span-half,
  .param-span-third { grid-column: span 1; }
  .progress-stage-card-kicker,
  .progress-stage-card-mainline {
    flex-direction: column;
    align-items: flex-start;
  }
  .progress-strip-sub {
    text-align: left;
    white-space: normal;
  }
}

@media (max-width: 640px) {
  .ai-chain-tabs {
    padding: 8px 12px 0;
  }
  .ai-chain-tab {
    min-height: 68px;
    padding: 9px 10px 10px;
  }
  .ai-chain-panel-head {
    margin-left: -16px;
    margin-right: -16px;
  }
  .ai-chain-result-row {
    grid-template-columns: 1fr;
  }
  .params-grid-shopee-bulk { grid-template-columns: minmax(0, 1fr); }
}
</style>
