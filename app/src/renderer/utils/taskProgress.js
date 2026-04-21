const ACTIVE_STATUSES = Object.freeze(['running', 'pausing', 'paused', 'stopping'])

const DEFAULT_PROGRESS_CONFIG = Object.freeze({
  mode: 'classic',
  usage: Object.freeze({
    sidebar: 'dot',
    scriptList: 'badge',
    taskRunner: 'classic',
  }),
})

const ENHANCED_PROGRESS_CONFIG = Object.freeze({
  mode: 'enhanced',
  usage: Object.freeze({
    sidebar: 'enhanced',
    scriptList: 'enhanced',
    taskRunner: 'enhanced',
  }),
})

// 新进度条逻辑集中定义在这里：
// 1. 默认脚本继续使用 classic，避免影响既有任务体验。
// 2. 当前只对白名单任务开启 enhanced，避免样式扩散到其他脚本。
// 3. 新任务接入前，先确认 records / shared 元数据稳定，再加规则。
const TASK_PROGRESS_RULES = Object.freeze([
  Object.freeze({
    adapterId: 'temu',
    taskId: 'goods_traffic_list',
    config: ENHANCED_PROGRESS_CONFIG,
  }),
  Object.freeze({
    adapterId: 'temu',
    taskId: 'goods_traffic_detail',
    config: ENHANCED_PROGRESS_CONFIG,
  }),
  Object.freeze({
    adapterId: 'temu',
    taskId: 'recommended_retail_price',
    config: ENHANCED_PROGRESS_CONFIG,
  }),
  Object.freeze({
    adapterId: 'temu',
    taskId: 'quality_dashboard',
    config: ENHANCED_PROGRESS_CONFIG,
  }),
  Object.freeze({
    adapterId: 'temu',
    taskId: 'fund_limited_list',
    config: ENHANCED_PROGRESS_CONFIG,
  }),
  Object.freeze({
    adapterId: 'shein-helper',
    taskId: 'merchandise_details',
    config: ENHANCED_PROGRESS_CONFIG,
  }),
])

function normalizeKeyPart(value) {
  return String(value || '').trim()
}

function toInt(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function clampPercent(rawValue, fallbackValue = 0) {
  const candidate = Number.isFinite(Number(rawValue)) ? Number(rawValue) : Number(fallbackValue)
  if (!Number.isFinite(candidate)) return 0
  return Math.min(100, Math.max(0, Number(candidate.toFixed(1))))
}

function getStatusLabel(status) {
  const normalized = normalizeKeyPart(status)
  if (normalized === 'pausing') return '暂停中'
  if (normalized === 'paused') return '已暂停'
  if (normalized === 'stopping') return '停止中'
  return '进行中'
}

function buildEnhancedOverviewProgress(live = {}) {
  const current = toInt(live?.current)
  const total = toInt(live?.total)
  const completed = toInt(live?.completed || live?.records)
  const batchNo = toInt(live?.batch_no)
  const totalBatches = toInt(live?.total_batches)
  const rowNo = toInt(live?.row_no)
  const buyerId = String(live?.buyer_id || '').trim()
  const store = String(live?.store || '').trim()
  const phase = String(live?.phase || '').trim()

  const overallPercentValue = total > 0
    ? clampPercent(live?.percent, (current / total) * 100)
    : 0
  const batchPercentValue = totalBatches > 0
    ? clampPercent((batchNo / totalBatches) * 100)
    : 0

  const overall = total > 0 ? {
    main: `第 ${current} / ${total} 条`,
    percentValue: overallPercentValue,
    percentLabel: `${overallPercentValue}%`,
    ariaLabel: `任务总进度 第 ${current} / ${total} 条`,
  } : null

  const batch = totalBatches > 0 ? {
    main: `当前条目 ${Math.max(batchNo, 0)} / ${totalBatches} 批`,
    percentValue: batchPercentValue,
    percentLabel: `${batchPercentValue}%`,
    ariaLabel: `当前条目进度 第 ${Math.max(batchNo, 0)} / ${totalBatches} 批`,
  } : null

  const metaParts = []
  if (completed > 0) metaParts.push(`已完成 ${completed} 条`)
  if (rowNo > 0) metaParts.push(`源表行 ${rowNo}`)
  if (buyerId) metaParts.push(`目标 ${buyerId}`)
  if (store) metaParts.push(store)
  if (phase) metaParts.push(`阶段 ${phase}`)

  return {
    current,
    total,
    completed,
    batchNo,
    totalBatches,
    rowNo,
    buyerId,
    store,
    phase,
    overall,
    batch,
    percentLabel: overall?.percentLabel || batch?.percentLabel || '',
    completedText: completed > 0 ? `已完成 ${completed} 条` : '',
    rowText: rowNo > 0 ? `源表行 ${rowNo}` : '',
    targetText: buyerId ? `目标 ${buyerId}` : '',
    storeText: store || '',
    phaseText: phase ? `阶段 ${phase}` : '',
    metaLine: metaParts.join(' · '),
  }
}

function buildClassicTaskRunnerProgress(live = {}, isRunning = false) {
  const current = Number(live?.current || 0)
  const total = Number(live?.total || 0)
  if (!isRunning || total <= 0) return null

  const completed = Number(live?.completed || live?.records || 0)
  const batchNo = Number(live?.batch_no || 0)
  const totalBatches = Number(live?.total_batches || 0)
  const rowNo = Number(live?.row_no || 0)
  const targetId = String(live?.buyer_id || '').trim()
  const rawPercent = Number(live?.percent)
  const percentValue = Number.isFinite(rawPercent) && rawPercent > 0
    ? Math.min(100, Math.max(0, Number(rawPercent.toFixed(1))))
    : Math.min(100, Math.max(0, Number(((current / total) * 100).toFixed(1))))

  const parts = [`已完成 ${completed} 条`]
  if (batchNo > 0 && totalBatches > 0) parts.push(`批次 ${batchNo}/${totalBatches}`)
  if (rowNo > 0) parts.push(`源表行 ${rowNo}`)
  if (targetId) parts.push(`目标 ${targetId}`)

  return {
    title: '批处理进度',
    main: `第 ${current} / ${total} 条`,
    percentValue,
    percentLabel: `${percentValue}%`,
    completed,
    completedText: `已完成 ${completed} 条`,
    batchText: batchNo > 0 && totalBatches > 0 ? `批次 ${batchNo}/${totalBatches}` : '',
    rowText: rowNo > 0 ? `源表行 ${rowNo}` : '',
    targetText: targetId ? `目标 ${targetId}` : '',
    storeText: '',
    phaseText: '',
    ariaLabel: `批处理进度 第 ${current} / ${total} 条`,
    ariaText: [`第 ${current} / ${total} 条`, `${percentValue}%`, ...parts].join('，'),
    sub: parts.join(' · '),
  }
}

function buildEnhancedTaskRunnerProgress(live = {}, liveStatus = '', isRunning = false) {
  if (!isRunning && !isTaskLiveActive(liveStatus || live?.status)) return null

  const current = Number(live?.current || 0)
  const total = Number(live?.total || 0)
  const completed = Number(live?.completed || live?.records || 0)
  const batchNo = Number(live?.batch_no || 0)
  const totalBatches = Number(live?.total_batches || 0)
  const rowNo = Number(live?.row_no || 0)
  const targetId = String(live?.buyer_id || '').trim()
  const store = String(live?.store || '').trim()
  const phase = String(live?.phase || '').trim()
  const progressText = String(live?.progress_text || '').trim()
  const statusLabel = getStatusLabel(liveStatus || live?.status)
  const rawPercent = Number(live?.percent)
  const hasBoundedProgress = total > 0
  const hasPercent = Number.isFinite(rawPercent) && rawPercent > 0
  const indeterminate = !hasBoundedProgress && !hasPercent
  const percentValue = hasPercent
    ? Math.min(100, Math.max(0, Number(rawPercent.toFixed(1))))
    : hasBoundedProgress
      ? Math.min(100, Math.max(0, Number((((current || completed) / total) * 100).toFixed(1))))
      : 0
  const batchPercentValue = totalBatches > 0
    ? Math.min(100, Math.max(0, Number(((Math.max(batchNo, 0) / totalBatches) * 100).toFixed(1))))
    : 0

  const main = hasBoundedProgress
    ? `第 ${Math.max(current || completed, 0)} / ${total} 条`
    : completed > 0
      ? `已抓取 ${completed} 条`
      : (progressText || statusLabel)

  const parts = []
  if (completed > 0 && !main.includes(String(completed))) parts.push(`已完成 ${completed} 条`)
  if (batchNo > 0 && totalBatches > 0) parts.push(`批次 ${batchNo}/${totalBatches}`)
  if (rowNo > 0) parts.push(`源表行 ${rowNo}`)
  if (targetId) parts.push(`目标 ${targetId}`)
  if (store) parts.push(store)
  if (phase) parts.push(`阶段 ${phase}`)
  if (progressText && progressText !== main) parts.push(progressText)
  if (statusLabel && !parts.includes(statusLabel)) parts.push(statusLabel)

  return {
    title: hasBoundedProgress ? '批处理进度' : '执行进度',
    trackTitle: hasBoundedProgress ? '总进度' : '执行状态',
    main,
    percentValue,
    batchPercentValue,
    percentLabel: indeterminate ? statusLabel : `${percentValue}%`,
    completed,
    completedText: completed > 0 ? `已完成 ${completed} 条` : '',
    batchText: batchNo > 0 && totalBatches > 0 ? `批次 ${batchNo}/${totalBatches}` : '',
    rowText: rowNo > 0 ? `源表行 ${rowNo}` : '',
    targetText: targetId ? `目标 ${targetId}` : '',
    storeText: store || '',
    phaseText: phase ? `阶段 ${phase}` : '',
    indeterminate,
    ariaLabel: hasBoundedProgress ? '批处理进度' : '执行进度',
    ariaText: [main, indeterminate ? statusLabel : `${percentValue}%`, ...parts].filter(Boolean).join('，'),
    sub: parts.join(' · ') || statusLabel,
  }
}

export function isTaskLiveActive(status) {
  return ACTIVE_STATUSES.includes(normalizeKeyPart(status))
}

export function resolveTaskProgressConfig(adapterId, taskId) {
  const normalizedAdapterId = normalizeKeyPart(adapterId)
  const normalizedTaskId = normalizeKeyPart(taskId)
  const matchedRule = TASK_PROGRESS_RULES.find(rule =>
    normalizedAdapterId === rule.adapterId && normalizedTaskId === rule.taskId
  )
  return matchedRule?.config || DEFAULT_PROGRESS_CONFIG
}

export function isEnhancedProgressTask(adapterId, taskId) {
  return resolveTaskProgressConfig(adapterId, taskId).mode === 'enhanced'
}

// 侧边栏 / 脚本列表只在 enhanced 任务上展示富进度块。
export function buildTaskOverviewProgress(adapterId, taskId, live = {}) {
  if (!isTaskLiveActive(live?.status)) return null
  const config = resolveTaskProgressConfig(adapterId, taskId)
  if (config.mode !== 'enhanced') return null
  return buildEnhancedOverviewProgress(live)
}

// 详情页根据任务配置自动选择 classic 或 enhanced。
export function buildTaskRunnerProgressSummary({
  adapterId,
  taskId,
  live = {},
  liveStatus = '',
  isRunning = false,
} = {}) {
  const config = resolveTaskProgressConfig(adapterId, taskId)
  return config.mode === 'enhanced'
    ? buildEnhancedTaskRunnerProgress(live, liveStatus, isRunning)
    : buildClassicTaskRunnerProgress(live, isRunning)
}
