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
        <button v-if="activeTab === 'logs'" type="button" @click="$emit('clear-logs')">清空</button>
        <button
          type="button"
          class="task-output-icon-btn"
          :class="{ active: drawerState === 'minimized' }"
          title="最小化"
          aria-label="最小化输出面板"
          @click="drawerState = 'minimized'"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          class="task-output-icon-btn"
          :class="{ active: drawerState === 'half' }"
          title="半高"
          aria-label="半高显示输出面板"
          @click="drawerState = 'half'"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="5" width="16" height="14" rx="2" />
            <path d="M4 13h16" />
          </svg>
        </button>
        <button
          type="button"
          class="task-output-icon-btn"
          :class="{ active: drawerState === 'expanded' }"
          title="展开"
          aria-label="展开输出面板"
          @click="drawerState = 'expanded'"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 3H5a2 2 0 0 0-2 2v3" />
            <path d="M16 3h3a2 2 0 0 1 2 2v3" />
            <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
            <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
        </button>
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
        <div v-for="file in files" :key="file" class="task-output-file-row">
          <span :title="file">{{ fileName(file) }}</span>
          <div class="task-output-file-actions">
            <button type="button" @click="$emit('open-file', file)">打开</button>
            <slot name="file-actions" :file="file" />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { summarizeOutputFiles } from '../utils/taskOutputSummary'

const props = defineProps({
  logs: { type: Array, default: () => [] },
  files: { type: Array, default: () => [] },
  logClass: { type: Function, default: () => '' },
  autoOpenOnFirstLog: { type: Boolean, default: true },
  autoOpenOnOutputFiles: { type: Boolean, default: true },
})

defineEmits(['clear-logs', 'open-file'])

const activeTab = ref('logs')
const drawerState = ref('minimized')
const logBodyEl = ref(null)
const outputSummary = computed(() => summarizeOutputFiles(props.files))
const latestLogPreview = computed(() => {
  const latest = props.logs?.length ? props.logs[props.logs.length - 1] : ''
  return String(latest || '').replace(/\s+/g, ' ').trim()
})

function fileName(path) {
  return String(path || '').split('/').pop().split('\\').pop()
}

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
.task-output-drawer {
  flex: 0 0 auto;
  min-height: 42px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg2);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.task-output-drawer.minimized { height: 42px; }
.task-output-drawer.half { height: min(240px, 28vh); }
.task-output-drawer.expanded { height: min(420px, 46vh); }
.task-output-head {
  min-height: 42px;
  display: flex;
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
.task-output-preview {
  flex: 1 1 auto;
  min-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text3);
  font-family: 'Menlo', 'Monaco', monospace;
  font-size: 12px;
}
.task-output-preview.ok { color: #86efac; }
.task-output-preview.err { color: #fca5a5; }
.task-output-preview.warn { color: #fde68a; }
.task-output-tabs button,
.task-output-actions button {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text2);
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}
.task-output-actions .task-output-icon-btn {
  width: 34px;
  height: 30px;
  padding: 0;
  display: inline-grid;
  place-items: center;
}
.task-output-icon-btn svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.task-output-actions button.active,
.task-output-tabs button.active {
  border-color: rgba(255, 106, 41, .48);
  color: var(--orange);
  background: rgba(255, 106, 41, .1);
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
  border-bottom: 1px solid rgba(255, 255, 255, .04);
}
.task-output-file-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.task-output-file-row button {
  border: 0;
  background: transparent;
  color: var(--orange);
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
  background: var(--bg3);
  color: var(--text2);
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
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
  color: #86efac;
}
.task-output-actions :slotted(.task-output-sync-btn:hover:not(:disabled)),
.task-output-file-actions :slotted(.task-output-file-sync:hover:not(:disabled)) {
  background: rgba(74, 222, 128, .14);
  color: #bbf7d0;
}
.log-line {
  color: var(--text2);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Menlo', 'Monaco', monospace;
  font-size: 12px;
  line-height: 1.7;
}
.log-line.ok { color: #4ade80; }
.log-line.err { color: #f87171; }
.log-line.warn { color: #fbbf24; }
@media (max-width: 720px) {
  .task-output-head {
    align-items: stretch;
    flex-direction: column;
    padding: 8px;
  }
  .task-output-drawer.minimized { height: 82px; }
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
