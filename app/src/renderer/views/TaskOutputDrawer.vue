<template>
  <section :class="['task-output-drawer', drawerState]">
    <header class="task-output-head">
      <div class="task-output-tabs" role="tablist">
        <button
          type="button"
          :class="{ active: activeTab === 'logs' }"
          role="tab"
          :aria-selected="activeTab === 'logs'"
          @click="activeTab = 'logs'"
        >
          运行日志
        </button>
        <button
          type="button"
          :class="{ active: activeTab === 'files' }"
          role="tab"
          :aria-selected="activeTab === 'files'"
          @click="activeTab = 'files'"
        >
          输出文件
          <span>{{ outputSummary.label }}</span>
        </button>
      </div>
      <div v-if="drawerState === 'minimized' && latestLogPreview" :class="['task-output-preview', logClass(latestLogPreview)]">
        {{ latestLogPreview }}
      </div>
      <div class="task-output-actions">
        <slot name="actions" />
        <button
          v-if="activeTab === 'logs'"
          type="button"
          :disabled="!logs.length"
          @click="copyLogs"
        >
          <component :is="copyFeedback === '已复制' ? IconCheck : IconCopy" :size="15" aria-hidden="true" />
          <span aria-live="polite">{{ copyFeedback || '复制全部日志' }}</span>
        </button>
        <button
          v-if="activeTab === 'logs'"
          type="button"
          :disabled="!logs.length"
          aria-haspopup="dialog"
          @click="clearLogsDialog?.showModal()"
        >
          <IconTrash :size="15" aria-hidden="true" />
          清空日志
        </button>
        <div class="task-output-sizes" role="group" aria-label="输出面板高度">
          <button
            v-for="size in drawerSizes"
            :key="size.value"
            type="button"
            :class="{ active: drawerState === size.value }"
            :aria-pressed="drawerState === size.value"
            @click="drawerState = size.value"
          >
            <component :is="size.icon" :size="15" aria-hidden="true" />
            <span>{{ size.label }}</span>
          </button>
        </div>
      </div>
    </header>

    <div v-if="drawerState !== 'minimized'" class="task-output-body">
      <div v-show="activeTab === 'logs'" ref="logBodyEl" class="task-output-log">
        <div v-if="!logs.length" class="task-output-empty">暂无运行日志</div>
        <div v-for="(line, index) in logs" :key="index" :class="['log-line', logClass(line)]">{{ line }}</div>
      </div>
      <div v-show="activeTab === 'files'" class="task-output-files">
        <div class="task-output-summary">{{ outputSummary.label }}</div>
        <div v-if="!files.length" class="task-output-empty">暂无输出文件</div>
        <div v-for="entry in displayOutputEntries" :key="`${entry.kind}:${entry.path}`" class="task-output-file-row">
          <span class="task-output-file-info" :title="entry.detail || entry.path">
            <strong>{{ entry.label }}</strong>
            <small v-if="entry.detail">{{ entry.detail }}</small>
          </span>
          <div class="task-output-file-actions">
            <button type="button" @click="$emit('open-file', entry.path)">{{ entry.actionLabel }}</button>
            <slot name="file-actions" :file="entry.path" />
          </div>
        </div>
      </div>
    </div>

    <dialog
      ref="clearLogsDialog"
      class="clear-logs-dialog"
      role="alertdialog"
      :aria-labelledby="clearLogsTitleId"
      :aria-describedby="clearLogsDescriptionId"
    >
      <form @submit.prevent="confirmClearLogs">
        <h2 :id="clearLogsTitleId">清空运行日志？</h2>
        <p :id="clearLogsDescriptionId">清空后，当前任务已有的运行日志无法恢复。</p>
        <div class="clear-logs-dialog-actions">
          <button type="button" autofocus @click="clearLogsDialog?.close()">取消</button>
          <button type="submit" class="confirm-clear-logs">确认清空</button>
        </div>
      </form>
    </dialog>
  </section>
</template>

<script setup>
import { computed, nextTick, onUnmounted, ref, useId, watch } from 'vue'
import { IconCheck, IconCopy, IconLayoutBottombar, IconMaximize, IconMinus, IconTrash } from '@tabler/icons-vue'
import { buildOutputFileEntries, summarizeOutputFiles } from '../utils/taskOutputSummary'

const props = defineProps({
  logs: { type: Array, default: () => [] },
  files: { type: Array, default: () => [] },
  logClass: { type: Function, default: () => '' },
  autoOpenOnFirstLog: { type: Boolean, default: true },
  autoOpenOnOutputFiles: { type: Boolean, default: true },
})

const emit = defineEmits(['clear-logs', 'open-file'])

const activeTab = ref('logs')
const drawerState = ref('minimized')
const clearLogsDialog = ref(null)
const clearLogsTitleId = useId()
const clearLogsDescriptionId = useId()

function confirmClearLogs() {
  clearLogsDialog.value?.close()
  emit('clear-logs')
}

const drawerSizes = [
  { value: 'minimized', label: '收起面板', icon: IconMinus },
  { value: 'half', label: '半高查看', icon: IconLayoutBottombar },
  { value: 'expanded', label: '展开面板', icon: IconMaximize },
]
const copyFeedback = ref('')
let copyFeedbackTimer

async function copyLogs() {
  const text = props.logs.join('\n')
  if (!text) return
  clearTimeout(copyFeedbackTimer)
  try {
    await navigator.clipboard.writeText(text)
    copyFeedback.value = '已复制'
  } catch {
    copyFeedback.value = '复制失败'
  }
  copyFeedbackTimer = setTimeout(() => { copyFeedback.value = '' }, 2500)
}

onUnmounted(() => clearTimeout(copyFeedbackTimer))
const logBodyEl = ref(null)
const outputSummary = computed(() => summarizeOutputFiles(props.files))
const displayOutputEntries = computed(() => buildOutputFileEntries(props.files))
const latestLogPreview = computed(() => {
  const latest = props.logs?.length ? props.logs[props.logs.length - 1] : ''
  return String(latest || '').replace(/\s+/g, ' ').trim()
})

watch(() => props.logs.length, (nextLength, previousLength) => {
  if (props.autoOpenOnFirstLog && nextLength > previousLength && previousLength === 0 && drawerState.value === 'minimized') {
    drawerState.value = 'half'
    activeTab.value = 'logs'
  }
  nextTick(() => {
    if (logBodyEl.value) logBodyEl.value.scrollTop = logBodyEl.value.scrollHeight
  })
})

watch(() => props.files.length, (nextLength, previousLength) => {
  if (!props.autoOpenOnOutputFiles || nextLength <= 0 || nextLength <= previousLength) return
  activeTab.value = 'files'
  drawerState.value = 'half'
})
</script>

<style scoped>
.clear-logs-dialog {
  width: min(360px, calc(100% - 32px));
  margin: auto;
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg2);
  color: var(--text);
}
.clear-logs-dialog::backdrop { background: rgba(0, 0, 0, .5); }
.clear-logs-dialog h2 { font-size: 16px; }
.clear-logs-dialog p { margin-top: 8px; color: var(--text2); }
.clear-logs-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.clear-logs-dialog-actions button {
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--soft-fill);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.clear-logs-dialog-actions .confirm-clear-logs {
  color: var(--red);
  border-color: color-mix(in srgb, var(--red) 40%, transparent);
}
.task-output-drawer {
  flex: 0 0 auto;
  min-height: 42px;
  container-type: inline-size;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg2);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.task-output-actions {
  grid-column: 3;
  max-width: 100%;
  flex-wrap: wrap;
}
.task-output-drawer.half { height: min(240px, 28vh); }
.task-output-drawer.expanded { height: min(420px, 46vh); }
.task-output-head {
  min-height: 42px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
}
.task-output-tabs,
.task-output-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.task-output-tabs {
  flex: 0 0 auto;
}
.task-output-sizes {
  display: flex;
  flex: 0 0 auto;
  max-width: 100%;
  flex-wrap: wrap;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.task-output-preview {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text3);
  font-family: 'Menlo', 'Monaco', monospace;
  font-size: 12px;
}
.task-output-preview.ok { color: var(--green); }
.task-output-preview.err { color: var(--red); }
.task-output-preview.warn { color: var(--yellow); }
.task-output-tabs button,
.task-output-actions button {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--soft-fill);
  color: var(--text2);
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}
.task-output-tabs button:hover,
.task-output-actions button:hover {
  border-color: var(--border-strong);
  background: var(--soft-fill-hover);
}
.task-output-sizes button:not(.active):not(:hover) {
  border-color: transparent;
  background: transparent;
}
.task-output-actions button {
  white-space: nowrap;
}
.task-output-actions button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.task-output-actions button:disabled {
  cursor: default;
  opacity: .55;
}
.task-output-actions button.active,
.task-output-tabs button.active {
  border-color: rgba(var(--orange-rgb), .48);
  color: var(--orange-text);
  background: rgba(var(--orange-rgb), .08);
}
.task-output-tabs span {
  margin-left: 8px;
  color: var(--text3);
}
.task-output-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.task-output-log,
.task-output-files {
  height: 100%;
  overflow-y: auto;
  padding: 12px 16px;
}
.task-output-empty {
  color: var(--text3);
  text-align: center;
  padding: 28px 0;
}
.task-output-summary {
  color: var(--text2);
  font-size: 12px;
  margin-bottom: 10px;
}
.task-output-file-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--subtle-border);
}
.task-output-file-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.task-output-file-info strong,
.task-output-file-info small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-output-file-info strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}
.task-output-file-info small {
  color: var(--text3);
  font-size: 11px;
}
.task-output-file-row button {
  border: 0;
  background: transparent;
  color: var(--orange-text);
  font-size: 12px;
  cursor: pointer;
}
.task-output-file-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.task-output-actions :slotted(button),
.task-output-file-actions :slotted(button) {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--soft-fill);
  color: var(--text2);
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}
.task-output-actions :slotted(button:hover:not(:disabled)),
.task-output-file-actions :slotted(button:hover:not(:disabled)) {
  border-color: var(--border-strong);
  background: var(--soft-fill-hover);
}
.task-output-actions :slotted(button:disabled),
.task-output-file-actions :slotted(button:disabled) {
  cursor: not-allowed;
  opacity: .55;
}
.task-output-actions :slotted(.task-output-sync-btn),
.task-output-file-actions :slotted(.task-output-file-sync) {
  border-color: rgba(74, 222, 128, .25);
  background: rgba(74, 222, 128, .08);
  color: var(--green);
}
.task-output-actions :slotted(.task-output-sync-btn:hover:not(:disabled)),
.task-output-file-actions :slotted(.task-output-file-sync:hover:not(:disabled)) {
  background: rgba(74, 222, 128, .14);
  color: var(--green);
}
.log-line {
  color: var(--text2);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Menlo', 'Monaco', monospace;
  font-size: 12px;
  line-height: 1.7;
}
.log-line.ok { color: var(--green); }
.log-line.err { color: var(--red); }
.log-line.warn { color: var(--yellow); }
@container (max-width: 640px) {
  .task-output-head {
    display: flex;
    align-items: stretch;
    flex-direction: column;
    padding: 8px;
  }
  .task-output-tabs,
  .task-output-actions {
    flex-wrap: wrap;
  }
  .task-output-preview {
    order: 3;
    width: 100%;
  }
}
</style>
