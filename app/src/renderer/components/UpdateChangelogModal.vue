<template>
  <div v-if="open" class="changelog-backdrop" @click.self="close">
    <section class="changelog-modal" role="dialog" aria-modal="true" aria-label="更新日志">
      <header class="changelog-head">
        <div class="changelog-title-wrap">
          <span class="changelog-kicker">抓虾新版本</span>
          <h3 class="changelog-title">v{{ versionLabel }}</h3>
          <span v-if="publishedLabel" class="changelog-date">{{ publishedLabel }}</span>
        </div>
        <button class="changelog-close" type="button" aria-label="关闭" title="关闭" @click="close">×</button>
      </header>

      <div class="changelog-body">
        <div v-if="loading" class="changelog-state">正在获取更新日志...</div>
        <div v-else-if="fetchError" class="changelog-state">
          <p>更新日志获取失败：{{ fetchError }}</p>
          <p class="changelog-hint">可在浏览器中查看：<a :href="releaseUrl" target="_blank" rel="noopener noreferrer">{{ releaseUrl }}</a></p>
        </div>
        <div v-else-if="renderedNotes" class="changelog-content" v-html="renderedNotes"></div>
        <div v-else class="changelog-state">这个版本暂时没有填写更新日志。</div>
      </div>

      <footer class="changelog-actions">
        <button class="changelog-btn ghost" type="button" @click="close">关闭</button>
        <button class="changelog-btn primary" type="button" :disabled="busy" @click="confirmDownload">
          {{ busy ? '正在开始下载...' : '确认下载' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  version: { type: String, default: '' },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'download'])

const loading = ref(true)
const fetchError = ref('')
const releaseUrl = ref('')
const publishedAt = ref('')
const notes = ref('')

const versionLabel = computed(() => props.version || '最新')
const publishedLabel = computed(() => {
  if (!publishedAt.value) return ''
  const date = new Date(publishedAt.value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
})
const renderedNotes = computed(() => renderMarkdown(notes.value))

async function loadNotes() {
  loading.value = true
  fetchError.value = ''
  try {
    const result = await window.cs.fetchUpdateReleaseNotes()
    if (result?.ok) {
      notes.value = result.body || ''
      releaseUrl.value = result.url || ''
      publishedAt.value = result.publishedAt || ''
    } else {
      fetchError.value = result?.error || '无法获取'
      releaseUrl.value = result?.url || ''
    }
  } catch (error) {
    fetchError.value = error?.message || String(error)
  } finally {
    loading.value = false
  }
}

function renderMarkdown(markdown) {
  const lines = String(markdown || '').split(/\r?\n/)
  const out = []
  let inList = false
  let inCode = false
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    if (line.trim().startsWith('```')) {
      if (inCode) {
        out.push('</code></pre>')
        inCode = false
      } else {
        if (inList) {
          out.push('</ul>')
          inList = false
        }
        out.push('<pre><code>')
        inCode = true
      }
      continue
    }
    if (inCode) {
      out.push(escapeHtml(line))
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${inline(escapeHtml(line.replace(/^\s*[-*]\s+/, '')))}</li>`)
      continue
    }
    if (inList) {
      out.push('</ul>')
      inList = false
    }
    if (/^#{1,4}\s+/.test(line)) {
      const level = Math.min(4, (line.match(/^#+/) || [''])[0].length)
      out.push(`<h${level}>${inline(escapeHtml(line.replace(/^#+\s*/, '')))}</h${level}>`)
      continue
    }
    if (!line.trim()) {
      out.push('')
      continue
    }
    out.push(`<p>${inline(escapeHtml(line))}</p>`)
  }
  if (inList) out.push('</ul>')
  if (inCode) out.push('</code></pre>')
  return out.join('\n').trim()
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function inline(text) {
  return String(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function close() {
  emit('close')
}

function confirmDownload() {
  emit('download')
}

watch(() => props.open, (openNow) => {
  if (!openNow) return
  notes.value = ''
  fetchError.value = ''
  releaseUrl.value = ''
  publishedAt.value = ''
  loadNotes()
})
</script>

<style scoped>
.changelog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--scrim);
  animation: changelog-backdrop-in 140ms ease-out;
}

.changelog-modal {
  width: min(560px, 100%);
  max-height: min(72vh, 640px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 18px 50px var(--shadow);
  animation: changelog-modal-in 160ms ease-out;
}

.changelog-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}

.changelog-title-wrap {
  flex: 1;
  min-width: 0;
}

.changelog-kicker {
  font-size: 12px;
  color: var(--orange-text);
}

.changelog-title {
  margin: 2px 0 0;
  color: var(--text);
  font-size: 17px;
  font-weight: 700;
}

.changelog-date {
  display: inline-block;
  margin-top: 2px;
  color: var(--text3);
  font-size: 12px;
}

.changelog-close {
  border: none;
  border-radius: 6px;
  padding: 4px 8px;
  background: transparent;
  color: var(--text3);
  font-size: 18px;
  line-height: 1;
}

.changelog-close:hover,
.changelog-close:focus-visible {
  background: var(--soft-fill-hover);
  color: var(--text);
  outline: none;
}

.changelog-body {
  flex: 1;
  min-height: 160px;
  overflow-y: auto;
  padding: 14px 18px;
}

.changelog-state {
  color: var(--text2);
  font-size: 13px;
  line-height: 1.6;
}

.changelog-hint {
  margin-top: 6px;
  color: var(--text3);
  font-size: 12px;
  word-break: break-all;
}

.changelog-hint a {
  color: var(--blue);
}

.changelog-content {
  color: var(--text2);
  font-size: 13px;
  line-height: 1.7;
}

.changelog-content :deep(h1),
.changelog-content :deep(h2),
.changelog-content :deep(h3),
.changelog-content :deep(h4) {
  margin: 14px 0 6px;
  color: var(--text);
  font-size: 14px;
  font-weight: 700;
}

.changelog-content :deep(h1:first-child),
.changelog-content :deep(h2:first-child),
.changelog-content :deep(h3:first-child) {
  margin-top: 0;
}

.changelog-content :deep(p) {
  margin: 6px 0;
}

.changelog-content :deep(ul) {
  margin: 6px 0;
  padding-left: 18px;
}

.changelog-content :deep(li) {
  margin: 3px 0;
}

.changelog-content :deep(code) {
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 1px 5px;
  background: var(--soft-fill);
  font-size: 12px;
}

.changelog-content :deep(pre) {
  overflow-x: auto;
  margin: 8px 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--bg3);
}

.changelog-content :deep(pre code) {
  border: none;
  padding: 0;
  background: transparent;
}

.changelog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 18px;
  border-top: 1px solid var(--border);
}

.changelog-btn {
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 8px 18px;
  background: var(--bg3);
  color: var(--text);
  font-size: 13px;
}

.changelog-btn:hover,
.changelog-btn:focus-visible {
  background: var(--soft-fill-hover);
  outline: none;
}

.changelog-btn.primary {
  border-color: var(--orange);
  background: var(--orange);
  color: var(--on-orange);
  font-weight: 600;
}

.changelog-btn.primary:hover,
.changelog-btn.primary:focus-visible {
  background: var(--orange-hover);
}

.changelog-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

@keyframes changelog-backdrop-in {
  from { opacity: 0; }
}

@keyframes changelog-modal-in {
  from { opacity: 0; transform: translateY(8px); }
}

@media (prefers-reduced-motion: reduce) {
  .changelog-backdrop,
  .changelog-modal {
    animation: none;
  }
}
</style>
