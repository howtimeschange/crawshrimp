<template>
  <footer
    class="sidebar-update-footer"
    :class="[`tone-${presentation.tone}`, { collapsed }]"
  >
    <button
      v-if="presentation.action"
      class="update-control"
      type="button"
      :title="tooltipText"
      :data-tooltip="collapsed ? tooltipText : null"
      :aria-label="ariaLabel"
      :aria-busy="busy ? 'true' : undefined"
      :disabled="busy"
      @click="onAction"
    >
      <span v-if="presentation.label" class="status-icon" aria-hidden="true">{{ statusIcon }}</span>
      <span class="version-label">{{ presentation.versionLabel }}</span>
      <span v-if="!collapsed && presentation.label" class="update-copy">
        <span class="update-title">{{ presentation.label }}</span>
        <span class="update-detail">{{ presentation.title }}</span>
      </span>
    </button>
    <div
      v-else
      class="update-control"
      :title="tooltipText"
      :data-tooltip="collapsed ? tooltipText : null"
      :aria-label="ariaLabel"
      :aria-busy="busy ? 'true' : undefined"
      :tabindex="collapsed ? 0 : undefined"
      :role="collapsed ? 'status' : undefined"
      aria-live="polite"
    >
      <span v-if="presentation.label" class="status-icon" aria-hidden="true">{{ statusIcon }}</span>
      <span class="version-label">{{ presentation.versionLabel }}</span>
      <span v-if="!collapsed && presentation.label" class="update-copy">
        <span class="update-title">{{ presentation.label }}</span>
        <span class="update-detail">{{ presentation.title }}</span>
      </span>
    </div>

    <div
      v-if="presentation.tone === 'downloading'"
      class="download-progress"
      role="progressbar"
      :aria-label="presentation.title"
      :aria-valuenow="presentation.percent"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <span class="download-progress-fill" :style="{ width: `${presentation.percent || 0}%` }"></span>
    </div>
  </footer>
</template>

<script setup>
import { computed } from 'vue'
import { buildSidebarUpdatePresentation } from '../utils/updateDisplay.js'

const props = defineProps({
  updateStatus: {
    type: Object,
    default: () => ({}),
  },
  collapsed: {
    type: Boolean,
    default: false,
  },
  busy: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['download', 'install', 'retry'])

const presentation = computed(() =>
  buildSidebarUpdatePresentation(props.updateStatus, props.collapsed)
)

const tooltipText = computed(() => {
  if (props.updateStatus?.status === 'waiting-for-tasks') {
    const labels = Array.isArray(props.updateStatus.blockers)
      ? props.updateStatus.blockers.map(blocker => String(blocker?.label || blocker?.id || '')).filter(Boolean)
      : []
    if (labels.length > 0) return `${presentation.value.title}：${labels.join('、')}`
  }
  return presentation.value.title
})

const ariaLabel = computed(() =>
  props.collapsed ? tooltipText.value : undefined
)

const statusIcon = computed(() => {
  const tone = presentation.value.tone
  if (tone === 'available') return '⬇'
  if (tone === 'downloading') return '↓'
  if (tone === 'waiting') return '…'
  if (tone === 'ready') return '↻'
  if (tone === 'error') return '!'
  if (tone === 'disabled') return '-'
  if (tone === 'checking') return '⟳'
  if (tone === 'installing') return '↻'
  return '✓'
})

function onAction() {
  if (props.busy) return
  if (!presentation.value.action) return
  emit(presentation.value.action)
}
</script>

<style scoped>
.sidebar-update-footer {
  margin-top: auto;
  padding: 8px;
  border-top: 1px solid var(--border);
}

.update-control {
  position: relative;
  width: 100%;
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--text2);
  padding: 8px;
  text-align: left;
}

button.update-control {
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

button.update-control:hover {
  border-color: rgba(var(--orange-rgb), 0.46);
  background: var(--orange-bg);
  color: var(--text);
}

button.update-control:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}

button.update-control:focus-visible {
  outline: 2px solid var(--orange);
  outline-offset: 2px;
}

.status-icon {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.07);
  color: var(--text2);
  font-size: 12px;
  font-weight: 700;
}

.version-label {
  flex: 0 0 auto;
  color: var(--text);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.update-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.update-title {
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
}

.update-detail {
  color: var(--text3);
  font-size: 11px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.download-progress {
  position: relative;
  height: 5px;
  margin: 6px 4px 0;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
}

.download-progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--orange);
}

.sidebar-update-footer.collapsed {
  padding-inline: 6px;
  overflow: visible;
}

.collapsed .update-control {
  min-height: 48px;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 6px 4px;
}

.collapsed .status-icon {
  width: 22px;
  height: 22px;
}

.collapsed .version-label {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}

.collapsed .update-control::after {
  content: attr(data-tooltip);
  position: absolute;
  left: calc(100% + 8px);
  bottom: 6px;
  z-index: 30;
  max-width: 260px;
  padding: 6px 8px;
  border: 1px solid var(--subtle-border);
  border-radius: 6px;
  background: var(--tooltip-bg);
  color: #f7f7fa;
  font-size: 12px;
  line-height: 1.35;
  white-space: normal;
  box-shadow: var(--shadow-soft);
  opacity: 0;
  pointer-events: none;
  transform: translateX(-4px);
  transition: opacity 0.12s, transform 0.12s;
}

.collapsed .update-control:hover::after,
.collapsed .update-control:focus-visible::after {
  opacity: 1;
  transform: translateX(0);
}

.tone-available .status-icon,
.tone-ready .status-icon {
  background: var(--orange-bg);
  color: var(--orange-text);
}

.tone-downloading .status-icon,
.tone-checking .status-icon,
.tone-installing .status-icon {
  background: rgba(74, 222, 128, 0.12);
  color: var(--green);
}

.tone-error .status-icon {
  background: rgba(248, 113, 113, 0.14);
  color: var(--red);
}

.tone-disabled .update-control {
  opacity: 0.72;
}
</style>
