<template>
  <div class="task-center">
    <header class="tc-head">
      <div>
        <h2>任务中心</h2>
        <p>实例化管理脚本任务、审批状态和历史结果</p>
      </div>
      <button type="button" class="tc-primary" :disabled="creating" @click="createAiImageTask">
        {{ creating ? '创建中...' : '新增 AI 测图任务' }}
      </button>
    </header>

    <section class="tc-toolbar">
      <div class="tc-tabs" role="tablist">
        <button
          v-for="tab in groups"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="activeGroup === tab.id"
          :class="{ active: activeGroup === tab.id }"
          @click="activeGroup = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>
      <div class="tc-search">
        <input
          v-model.trim="keyword"
          type="search"
          placeholder="搜索脚本、任务、实例"
          @keydown.enter="loadInstances"
        />
        <button type="button" :disabled="loading" @click="loadInstances">
          {{ loading ? '刷新中...' : '刷新' }}
        </button>
      </div>
    </section>

    <section class="tc-content">
      <div v-if="error" class="tc-state error">{{ error }}</div>
      <div v-else-if="loading" class="tc-state">加载中...</div>
      <div v-else-if="!items.length" class="tc-state">暂无任务</div>
      <button
        v-for="item in items"
        v-else
        :key="item.instance_uid"
        type="button"
        class="tc-row"
        @click="$emit('open-instance', item.instance_uid)"
      >
        <div class="tc-row-main">
          <strong>{{ item.title || '未命名任务' }}</strong>
          <span>{{ item.adapter_id }} / {{ item.task_id }}</span>
        </div>
        <div class="tc-row-meta">
          <span :class="['tc-status', statusTone(item.status)]">{{ statusLabel(item.status) }}</span>
          <span>{{ formatTime(item.updated_at || item.created_at) }}</span>
        </div>
      </button>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue'

const emit = defineEmits(['open-instance'])

const groups = [
  { id: 'current', label: '当前任务' },
  { id: 'pending', label: '待处理' },
  { id: 'history', label: '历史任务' },
]

const activeGroup = ref('current')
const keyword = ref('')
const items = ref([])
const loading = ref(false)
const creating = ref(false)
const error = ref('')

async function loadInstances() {
  loading.value = true
  error.value = ''
  try {
    const result = await window.cs.listTaskInstances({
      status_group: activeGroup.value,
      keyword: keyword.value,
    })
    items.value = Array.isArray(result?.items) ? result.items : []
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

async function createAiImageTask() {
  creating.value = true
  error.value = ''
  try {
    const result = await window.cs.createTaskInstance({
      adapter_id: 'tmall-ops-assistant',
      task_id: 'tmall_ai_image_test_chain',
      title: `AI测图任务 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      params: {},
    })
    await loadInstances()
    if (result?.instance_uid) emit('open-instance', result.instance_uid)
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    creating.value = false
  }
}

function statusLabel(status) {
  const labels = {
    draft: '草稿',
    queued: '排队中',
    running: '运行中',
    generating: '生图中',
    waiting_approval: '待审批',
    creating: '创建中',
    completed: '已完成',
    stopped: '已停止',
    failed: '失败',
    create_failed: '创建失败',
    partial_failed: '部分失败',
    archived: '已归档',
  }
  return labels[String(status || '').trim()] || status || '-'
}

function statusTone(status) {
  const value = String(status || '').trim()
  if (['failed', 'create_failed', 'partial_failed'].includes(value)) return 'error'
  if (['completed', 'archived'].includes(value)) return 'done'
  if (['waiting_approval'].includes(value)) return 'pending'
  if (['running', 'generating', 'creating', 'queued'].includes(value)) return 'active'
  return 'neutral'
}

function formatTime(value) {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return value
  }
}

watch(activeGroup, loadInstances)
onMounted(loadInstances)
</script>

<style scoped>
.task-center {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.tc-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border);
}
.tc-head h2 {
  color: var(--text);
  font-size: 18px;
  font-weight: 800;
}
.tc-head p {
  margin-top: 4px;
  color: var(--text3);
  font-size: 12px;
}
.tc-primary,
.tc-search button,
.tc-tabs button {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text2);
  padding: 8px 12px;
  font-size: 12px;
}
.tc-primary {
  border-color: rgba(255, 107, 43, .48);
  background: var(--orange);
  color: #fff;
  font-weight: 700;
}
.tc-primary:disabled,
.tc-search button:disabled {
  cursor: not-allowed;
  opacity: .6;
}
.tc-toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
}
.tc-tabs,
.tc-search {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.tc-tabs button.active {
  border-color: rgba(255, 107, 43, .48);
  background: var(--orange-bg);
  color: var(--orange);
}
.tc-search input {
  width: min(320px, 32vw);
  min-width: 180px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text);
  padding: 8px 11px;
  outline: none;
}
.tc-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 24px 24px;
}
.tc-state {
  display: grid;
  place-items: center;
  min-height: 180px;
  color: var(--text3);
  font-size: 13px;
}
.tc-state.error {
  color: var(--red);
}
.tc-row {
  width: 100%;
  min-height: 72px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  color: inherit;
  text-align: left;
  margin-bottom: 8px;
}
.tc-row:hover {
  border-color: rgba(255, 107, 43, .34);
  background: color-mix(in srgb, var(--bg2) 88%, var(--orange) 12%);
}
.tc-row-main,
.tc-row-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tc-row-main strong {
  color: var(--text);
  font-size: 14px;
}
.tc-row-main span,
.tc-row-meta span:last-child {
  color: var(--text3);
  font-size: 12px;
}
.tc-row-meta {
  align-items: flex-end;
  text-align: right;
}
.tc-status {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 4px 9px;
  color: var(--text2);
  font-size: 12px;
}
.tc-status.active { border-color: rgba(96, 165, 250, .35); color: #93c5fd; }
.tc-status.pending { border-color: rgba(251, 191, 36, .35); color: #fbbf24; }
.tc-status.done { border-color: rgba(74, 222, 128, .32); color: #86efac; }
.tc-status.error { border-color: rgba(248, 113, 113, .34); color: #fca5a5; }
@media (max-width: 760px) {
  .tc-head,
  .tc-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .tc-search input {
    width: 100%;
  }
  .tc-row {
    grid-template-columns: minmax(0, 1fr);
  }
  .tc-row-meta {
    align-items: flex-start;
    text-align: left;
  }
}
</style>
