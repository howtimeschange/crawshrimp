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

const ENHANCED_TASK_RUNNER_ONLY_CONFIG = Object.freeze({
  mode: 'enhanced',
  usage: Object.freeze({
    sidebar: 'dot',
    scriptList: 'badge',
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
  Object.freeze({
    adapterId: 'semir-cloud-drive',
    taskId: 'batch_image_download',
    config: ENHANCED_TASK_RUNNER_ONLY_CONFIG,
  }),
  Object.freeze({
    adapterId: 'semir-cloud-drive',
    taskId: 'tmall_material_match_buy',
    config: ENHANCED_TASK_RUNNER_ONLY_CONFIG,
  }),
  Object.freeze({
    adapterId: 'semir-cloud-drive',
    taskId: 'batch_ai_generate',
    config: ENHANCED_TASK_RUNNER_ONLY_CONFIG,
  }),
  Object.freeze({
    adapterId: 'shenhui-new-arrival',
    taskId: 'prepare_upload_package',
    config: ENHANCED_TASK_RUNNER_ONLY_CONFIG,
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

function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  const digits = size >= 100 || unitIndex === 0 ? 0 : size >= 10 ? 1 : 2
  return `${size.toFixed(digits)} ${units[unitIndex]}`
}

function formatSpeed(bytesPerSecond) {
  const label = formatBytes(bytesPerSecond)
  return label ? `${label}/s` : ''
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

function buildTrack({
  id,
  title,
  main,
  percentValue = 0,
  percentLabel = '',
  caption = '',
  detail = '',
  status = '',
  tone = 'primary',
  state = 'pending',
  indeterminate = false,
  ariaLabel = '',
  ariaText = '',
} = {}) {
  return {
    id: normalizeKeyPart(id) || normalizeKeyPart(title) || `track-${Date.now()}`,
    title: normalizeKeyPart(title),
    main: normalizeKeyPart(main),
    percentValue: clampPercent(percentValue),
    percentLabel: normalizeKeyPart(percentLabel) || `${clampPercent(percentValue)}%`,
    caption: normalizeKeyPart(caption),
    detail: normalizeKeyPart(detail),
    status: normalizeKeyPart(status),
    tone: tone === 'secondary' ? 'secondary' : 'primary',
    state: ['active', 'complete'].includes(normalizeKeyPart(state)) ? normalizeKeyPart(state) : 'pending',
    indeterminate: !!indeterminate,
    ariaLabel: normalizeKeyPart(ariaLabel) || normalizeKeyPart(title) || '进度',
    ariaText: normalizeKeyPart(ariaText) || [main, percentLabel, caption, detail].filter(Boolean).join('，'),
  }
}

function buildMetaItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
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
  const batchText = batchNo > 0 && totalBatches > 0 ? `批次 ${batchNo}/${totalBatches}` : ''

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

  const tracks = [
    buildTrack({
      id: 'overall',
      title: hasBoundedProgress ? '总进度' : '执行状态',
      main,
      percentValue,
      percentLabel: indeterminate ? statusLabel : `${percentValue}%`,
      caption: parts[0] || statusLabel,
      detail: [targetId ? `目标 ${targetId}` : '', store, phase ? `阶段 ${phase}` : ''].filter(Boolean).join(' · '),
      status: statusLabel,
      tone: 'primary',
      state: indeterminate ? 'active' : percentValue >= 100 ? 'complete' : 'active',
      indeterminate,
      ariaLabel: hasBoundedProgress ? '批处理总进度' : '执行状态',
      ariaText: [main, indeterminate ? statusLabel : `${percentValue}%`, ...parts].filter(Boolean).join('，'),
    }),
  ]

  if (batchPercentValue > 0) {
    tracks.push(buildTrack({
      id: 'batch',
      title: '当前条目',
      main: batchText || `第 ${Math.max(batchNo, 0)} / ${totalBatches} 批`,
      percentValue: batchPercentValue,
      percentLabel: `${batchPercentValue}%`,
      caption: targetId ? `目标 ${targetId}` : '',
      detail: rowNo > 0 ? `源表行 ${rowNo}` : '',
      status: batchPercentValue >= 100 ? '已完成' : '处理中',
      tone: 'secondary',
      state: batchPercentValue >= 100 ? 'complete' : 'active',
      ariaLabel: '当前条目进度',
      ariaText: [`${batchText || `第 ${Math.max(batchNo, 0)} / ${totalBatches} 批`}`, `${batchPercentValue}%`].filter(Boolean).join('，'),
    }))
  }

  return {
    title: hasBoundedProgress ? '批处理进度' : '执行进度',
    main,
    percentValue,
    percentLabel: indeterminate ? statusLabel : `${percentValue}%`,
    completed,
    completedText: completed > 0 ? `已完成 ${completed} 条` : '',
    batchText,
    rowText: rowNo > 0 ? `源表行 ${rowNo}` : '',
    targetText: targetId ? `目标 ${targetId}` : '',
    storeText: store || '',
    phaseText: phase ? `阶段 ${phase}` : '',
    indeterminate,
    ariaLabel: hasBoundedProgress ? '批处理进度' : '执行进度',
    ariaText: [main, indeterminate ? statusLabel : `${percentValue}%`, ...parts].filter(Boolean).join('，'),
    metaItems: buildMetaItems([
      completed > 0 ? `已完成 ${completed} 条` : '',
      batchText,
      rowNo > 0 ? `源表行 ${rowNo}` : '',
      targetId ? `目标 ${targetId}` : '',
      store,
      phase ? `阶段 ${phase}` : '',
    ]),
    tracks,
    sub: parts.join(' · ') || statusLabel,
  }
}

function isSemirBatchImageDownloadTask(adapterId, taskId) {
  return normalizeKeyPart(adapterId) === 'semir-cloud-drive' && [
    'batch_image_download',
    'tmall_material_match_buy',
  ].includes(normalizeKeyPart(taskId))
}

function isSemirBatchAiGenerateTask(adapterId, taskId) {
  return normalizeKeyPart(adapterId) === 'semir-cloud-drive' && normalizeKeyPart(taskId) === 'batch_ai_generate'
}

function isShenhuiPrepareUploadPackageTask(adapterId, taskId) {
  return normalizeKeyPart(adapterId) === 'shenhui-new-arrival' && normalizeKeyPart(taskId) === 'prepare_upload_package'
}

function getSemirPhaseLabel(phase, downloadStarted, downloadActive, downloadCompleted, downloadTotal) {
  const normalizedPhase = normalizeKeyPart(phase)
  if (normalizedPhase === 'finalize_all') return '整理打包'
  if (downloadActive) return '批量下载'
  if (downloadStarted && downloadTotal > 0 && downloadCompleted >= downloadTotal) return '下载完成'
  if (['ensure_folder', 'plan_code', 'ensure_search', 'collect_code'].includes(normalizedPhase)) return '检索链接'
  return '准备中'
}

function buildSemirBatchImageDownloadProgress(live = {}, liveStatus = '', isRunning = false) {
  if (!isRunning && !isTaskLiveActive(liveStatus || live?.status)) return null

  const scanCurrentRaw = toInt(live?.current)
  const scanTotal = toInt(live?.total)
  const scanCurrent = scanTotal > 0 ? Math.min(scanCurrentRaw, scanTotal) : scanCurrentRaw
  const currentCode = String(live?.buyer_id || '').trim()
  const store = String(live?.store || '').trim()
  const phase = String(live?.phase || '').trim()
  const statusLabel = getStatusLabel(liveStatus || live?.status)

  const downloadTotal = toInt(live?.download_total)
  const downloadCompletedRaw = toInt(live?.download_completed)
  const downloadCompleted = downloadTotal > 0 ? Math.min(downloadCompletedRaw, downloadTotal) : downloadCompletedRaw
  const downloadSuccess = toInt(live?.download_success)
  const downloadFailed = toInt(live?.download_failed)
  const downloadConcurrency = toInt(live?.download_concurrency)
  const downloadRetryAttempts = toInt(live?.download_retry_attempts)
  const downloadLastLabel = String(live?.download_last_label || '').trim()
  const downloadStarted = Boolean(live?.download_started) || downloadTotal > 0 || normalizeKeyPart(phase) === 'finalize_all'
  const downloadActive = Boolean(live?.download_active) || (downloadStarted && downloadTotal > 0 && downloadCompleted < downloadTotal)

  const scanPercent = scanTotal > 0 ? clampPercent((scanCurrent / scanTotal) * 100) : 0
  const downloadPercent = downloadTotal > 0
    ? clampPercent((downloadCompleted / downloadTotal) * 100)
    : (downloadStarted && !downloadActive ? 100 : 0)

  const scanState = downloadStarted || (scanTotal > 0 && scanCurrent >= scanTotal)
    ? 'complete'
    : scanCurrent > 0 ? 'active' : 'pending'
  const downloadState = !downloadStarted
    ? 'pending'
    : normalizeKeyPart(phase) === 'finalize_all'
      ? 'active'
      : downloadTotal > 0 && downloadCompleted >= downloadTotal
        ? 'complete'
        : 'active'

  const phaseLabel = getSemirPhaseLabel(phase, downloadStarted, downloadActive, downloadCompleted, downloadTotal) || statusLabel
  const scanStatus = scanState === 'complete' ? '已完成' : scanState === 'active' ? '进行中' : '待开始'
  const downloadStatus = downloadState === 'complete'
    ? '已完成'
    : downloadState === 'active'
      ? (normalizeKeyPart(phase) === 'finalize_all' ? '打包中' : '进行中')
      : '待开始'

  const scanMain = scanTotal > 0 ? `${scanCurrent} / ${scanTotal} 个编码` : (statusLabel || '等待开始')
  const downloadMain = downloadTotal > 0
    ? `${downloadCompleted} / ${downloadTotal} 个文件`
    : downloadStarted
      ? '等待下载进度'
      : '检索完成后自动开始'

  const downloadCaptionParts = []
  if (downloadSuccess > 0) downloadCaptionParts.push(`成功 ${downloadSuccess}`)
  if (downloadFailed > 0) downloadCaptionParts.push(`失败 ${downloadFailed}`)
  if (downloadConcurrency > 0) downloadCaptionParts.push(`并发 ${downloadConcurrency}`)
  if (downloadRetryAttempts > 1) downloadCaptionParts.push(`重试 ${downloadRetryAttempts} 次`)

  const tracks = [
    buildTrack({
      id: 'semir-search',
      title: '上层 · 检索链接',
      main: scanMain,
      percentValue: scanPercent,
      percentLabel: `${scanPercent}%`,
      caption: currentCode ? `当前目标 ${currentCode}` : '',
      detail: store ? `搜索范围 ${store}` : '',
      status: scanStatus,
      tone: 'primary',
      state: scanState,
      ariaLabel: '检索链接进度',
      ariaText: [scanMain, `${scanPercent}%`, currentCode ? `当前目标 ${currentCode}` : '', store ? `搜索范围 ${store}` : ''].filter(Boolean).join('，'),
    }),
    buildTrack({
      id: 'semir-download',
      title: '下层 · 批量下载',
      main: downloadMain,
      percentValue: downloadPercent,
      percentLabel: downloadStarted ? `${downloadPercent}%` : '待开始',
      caption: downloadCaptionParts.join(' · ') || (downloadStarted ? '正在汇总下载结果' : '检索完成后进入下载阶段'),
      detail: downloadLastLabel ? `最近文件 ${downloadLastLabel}` : (currentCode ? `最近目标 ${currentCode}` : ''),
      status: downloadStatus,
      tone: 'secondary',
      state: downloadState,
      ariaLabel: '批量下载进度',
      ariaText: [downloadMain, downloadStarted ? `${downloadPercent}%` : '待开始', downloadCaptionParts.join(' · '), downloadLastLabel].filter(Boolean).join('，'),
    }),
  ]

  return {
    title: '双阶段进度',
    main: phaseLabel,
    percentValue: downloadStarted ? clampPercent(50 + (downloadPercent * 0.5)) : clampPercent(scanPercent * 0.5),
    percentLabel: phaseLabel,
    completed: downloadSuccess,
    completedText: downloadSuccess > 0 ? `已下载 ${downloadSuccess} 个文件` : '',
    batchText: '',
    rowText: '',
    targetText: currentCode ? `目标 ${currentCode}` : '',
    storeText: store || '',
    phaseText: phase ? `阶段 ${phase}` : '',
    indeterminate: false,
    ariaLabel: '森马云盘双阶段进度',
    ariaText: [phaseLabel, scanMain, downloadMain].filter(Boolean).join('，'),
    metaItems: buildMetaItems([
      scanTotal > 0 ? `已检索 ${scanCurrent}/${scanTotal}` : '',
      downloadTotal > 0 ? `已下载 ${downloadCompleted}/${downloadTotal}` : '',
      currentCode ? `目标 ${currentCode}` : '',
      store,
    ]),
    tracks,
    sub: [
      phaseLabel,
      downloadFailed > 0 ? `下载失败 ${downloadFailed} 个` : '',
      normalizeKeyPart(phase) === 'finalize_all' ? '正在整理压缩包' : '',
    ].filter(Boolean).join(' · ') || statusLabel,
  }
}

function getShenhuiPrepareUploadPhaseLabel(phase, downloadStarted, downloadActive, downloadCompleted, downloadTotal) {
  const normalizedPhase = normalizeKeyPart(phase)
  if (normalizedPhase === 'finalize_all') return '整理打包'
  if (downloadActive) return '下载图片'
  if (downloadStarted && downloadTotal > 0 && downloadCompleted >= downloadTotal) return '下载完成'
  if (['ensure_folder', 'plan_code', 'ensure_search', 'collect_code'].includes(normalizedPhase)) return '找款任务'
  return '准备中'
}

function buildShenhuiPrepareUploadPackageProgress(live = {}, liveStatus = '', isRunning = false) {
  if (!isRunning && !isTaskLiveActive(liveStatus || live?.status)) return null

  const phase = String(live?.phase || '').trim()
  const normalizedPhase = normalizeKeyPart(phase)
  const statusLabel = getStatusLabel(liveStatus || live?.status)
  const currentCode = String(live?.buyer_id || '').trim()
  const store = String(live?.store || '').trim()

  const downloadTotal = toInt(live?.download_total)
  const downloadCompletedRaw = toInt(live?.download_completed)
  const downloadCompleted = downloadTotal > 0 ? Math.min(downloadCompletedRaw, downloadTotal) : downloadCompletedRaw
  const downloadSuccess = toInt(live?.download_success)
  const downloadFailed = toInt(live?.download_failed)
  const downloadConcurrency = toInt(live?.download_concurrency)
  const downloadRetryAttempts = toInt(live?.download_retry_attempts)
  const downloadLastLabel = String(live?.download_last_label || '').trim()
  const downloadCurrentLabel = String(live?.download_current_label || '').trim()
  const downloadActiveCount = toInt(live?.download_active_count)
  const downloadSpeed = formatSpeed(live?.download_speed_bps)
  const downloadBytes = formatBytes(live?.download_bytes_completed)
  const downloadStarted = Boolean(live?.download_started) || downloadTotal > 0 || normalizedPhase === 'finalize_all'
  const downloadActive = Boolean(live?.download_active) || (downloadStarted && downloadTotal > 0 && downloadCompleted < downloadTotal)

  const scanTotal = toInt(live?.search_total_codes) || toInt(live?.total)
  const searchCompleted = toInt(live?.search_completed_codes)
  const currentRaw = toInt(live?.current)
  const fallbackCompleted = downloadStarted ? scanTotal : Math.max(currentRaw - 1, 0)
  const scanCompletedRaw = searchCompleted > 0 || downloadStarted ? searchCompleted : fallbackCompleted
  const scanCompleted = scanTotal > 0 ? Math.min(scanCompletedRaw, scanTotal) : scanCompletedRaw
  const scanPercent = scanTotal > 0 ? clampPercent((scanCompleted / scanTotal) * 100) : 0
  const scanPhaseActive = ['ensure_folder', 'plan_code', 'ensure_search', 'collect_code'].includes(normalizedPhase)
  const scanState = downloadStarted || (scanTotal > 0 && scanCompleted >= scanTotal)
    ? 'complete'
    : (scanPhaseActive || scanCompleted > 0 || currentCode)
      ? 'active'
      : 'pending'

  const downloadPercent = downloadTotal > 0
    ? clampPercent((downloadCompleted / downloadTotal) * 100)
    : (downloadStarted && !downloadActive ? 100 : 0)
  const downloadState = !downloadStarted
    ? 'pending'
    : normalizedPhase === 'finalize_all'
      ? 'active'
      : downloadTotal > 0 && downloadCompleted >= downloadTotal
        ? 'complete'
        : 'active'

  const phaseLabel = getShenhuiPrepareUploadPhaseLabel(phase, downloadStarted, downloadActive, downloadCompleted, downloadTotal) || statusLabel
  const scanStatus = scanState === 'complete' ? '已完成' : scanState === 'active' ? '进行中' : '待开始'
  const downloadStatus = downloadState === 'complete'
    ? '已完成'
    : downloadState === 'active'
      ? (normalizedPhase === 'finalize_all' ? '打包中' : '进行中')
      : '待开始'

  const scanMain = scanTotal > 0 ? `${scanCompleted} / ${scanTotal} 个款号` : (statusLabel || '等待开始')
  const downloadMain = downloadTotal > 0
    ? `${downloadCompleted} / ${downloadTotal} 个文件`
    : downloadStarted
      ? '等待下载进度'
      : '找款完成后自动开始'

  const downloadCaptionParts = []
  if (downloadSuccess > 0) downloadCaptionParts.push(`成功 ${downloadSuccess}`)
  if (downloadFailed > 0) downloadCaptionParts.push(`失败 ${downloadFailed}`)
  if (downloadSpeed) downloadCaptionParts.push(downloadSpeed)
  if (downloadBytes) downloadCaptionParts.push(downloadBytes)
  if (downloadConcurrency > 0) downloadCaptionParts.push(`并发 ${downloadConcurrency}`)
  if (downloadRetryAttempts > 1) downloadCaptionParts.push(`重试 ${downloadRetryAttempts} 次`)
  const downloadDetail = downloadCurrentLabel
    ? `正在下载 ${downloadCurrentLabel}${downloadActiveCount > 1 ? ` 等 ${downloadActiveCount} 个` : ''}`
    : downloadLastLabel
      ? `最近文件 ${downloadLastLabel}`
      : (currentCode ? `最近款号 ${currentCode}` : '')

  const tracks = [
    buildTrack({
      id: 'shenhui-search',
      title: '找款任务',
      main: scanMain,
      percentValue: scanPercent,
      percentLabel: `${scanPercent}%`,
      caption: currentCode && scanState !== 'complete' ? `当前款号 ${currentCode}` : '',
      detail: store || '',
      status: scanStatus,
      tone: 'primary',
      state: scanState,
      ariaLabel: '找款任务进度',
      ariaText: [scanMain, `${scanPercent}%`, currentCode ? `当前款号 ${currentCode}` : '', store].filter(Boolean).join('，'),
    }),
    buildTrack({
      id: 'shenhui-download',
      title: '下载任务',
      main: downloadMain,
      percentValue: downloadPercent,
      percentLabel: downloadStarted ? `${downloadPercent}%` : '待开始',
      caption: downloadCaptionParts.join(' · ') || (downloadStarted ? '正在汇总下载结果' : '找款完成后进入下载阶段'),
      detail: downloadDetail,
      status: downloadStatus,
      tone: 'secondary',
      state: downloadState,
      ariaLabel: '下载任务进度',
      ariaText: [downloadMain, downloadStarted ? `${downloadPercent}%` : '待开始', downloadCaptionParts.join(' · '), downloadDetail].filter(Boolean).join('，'),
    }),
  ]

  return {
    title: '双任务进度',
    main: phaseLabel,
    percentValue: downloadStarted ? clampPercent(50 + (downloadPercent * 0.5)) : clampPercent(scanPercent * 0.5),
    percentLabel: phaseLabel,
    completed: downloadSuccess,
    completedText: downloadSuccess > 0 ? `已下载 ${downloadSuccess} 个文件` : '',
    batchText: '',
    rowText: '',
    targetText: currentCode ? `款号 ${currentCode}` : '',
    storeText: store || '',
    phaseText: phase ? `阶段 ${phase}` : '',
    indeterminate: false,
    ariaLabel: '深绘上新图包整理双任务进度',
    ariaText: [phaseLabel, scanMain, downloadMain].filter(Boolean).join('，'),
    metaItems: buildMetaItems([
      scanTotal > 0 ? `找款 ${scanCompleted}/${scanTotal}` : '',
      downloadTotal > 0 ? `下载 ${downloadCompleted}/${downloadTotal}` : '',
      currentCode ? `款号 ${currentCode}` : '',
      store,
    ]),
    tracks,
    sub: [
      phaseLabel,
      downloadFailed > 0 ? `下载失败 ${downloadFailed} 个` : '',
      normalizedPhase === 'finalize_all' ? '正在整理压缩包' : '',
    ].filter(Boolean).join(' · ') || statusLabel,
  }
}

function isSemirAiSearchPhase(phase) {
  return ['semir_plan_code', 'semir_ensure_search', 'semir_collect_code', 'semir_finalize_downloads', 'build_job_queue'].includes(normalizeKeyPart(phase))
}

function getSemirAiSourcePhaseLabel(phase, searchDone, downloadActive, downloadCompleted, downloadTotal) {
  const normalizedPhase = normalizeKeyPart(phase)
  if (downloadActive) return '批量下载素材'
  if (searchDone && downloadTotal > 0 && downloadCompleted >= downloadTotal) return '素材已就绪'
  if (normalizedPhase === 'build_job_queue') return '整理执行队列'
  if (['semir_plan_code', 'semir_ensure_search', 'semir_collect_code'].includes(normalizedPhase)) return '检索素材图'
  return searchDone ? '素材已就绪' : '准备中'
}

function getSemirAiGenerationPhaseLabel(phase, generationCompleted, generationTotal) {
  const normalizedPhase = normalizeKeyPart(phase)
  if (normalizedPhase === 'finalize_all') return '整理结果'
  if (['provider_open_home', 'provider_wait_ready'].includes(normalizedPhase)) return '打开 AI 站点'
  if (['ai_plan_job', 'doubao_reset_job', 'gemini_reset_job', 'doubao_wait_ready', 'gemini_wait_ready', 'gemini_wait_tool'].includes(normalizedPhase)) return '准备生图画布'
  if (['doubao_fill_prompt', 'doubao_wait_submit', 'gemini_open_upload_menu', 'gemini_wait_upload_menu', 'gemini_fill_prompt', 'gemini_wait_submit'].includes(normalizedPhase)) return '上传素材并提交'
  if (['doubao_wait_completion', 'gemini_wait_completion'].includes(normalizedPhase)) return 'AI 生图中'
  if (['doubao_finalize_downloads', 'gemini_finalize_downloads'].includes(normalizedPhase)) return '下载结果图'
  if (generationTotal > 0 && generationCompleted >= generationTotal) return '生图完成'
  return '待开始'
}

function buildSemirBatchAiGenerateProgress(live = {}, liveStatus = '', isRunning = false) {
  if (!isRunning && !isTaskLiveActive(liveStatus || live?.status)) return null

  const phase = String(live?.phase || '').trim()
  const statusLabel = getStatusLabel(liveStatus || live?.status)
  const currentCode = String(live?.buyer_id || '').trim()
  const store = String(live?.store || '').trim()
  const currentSourceFilename = String(live?.current_source_filename || '').trim()

  const searchTotal = toInt(live?.search_total_codes)
  const searchCompletedRaw = toInt(live?.search_completed_codes)
  const searchCompleted = searchTotal > 0 ? Math.min(searchCompletedRaw, searchTotal) : searchCompletedRaw
  const searchPercent = searchTotal > 0 ? clampPercent((searchCompleted / searchTotal) * 100) : 0

  const downloadTotal = toInt(live?.download_total)
  const downloadCompletedRaw = toInt(live?.download_completed)
  const downloadCompleted = downloadTotal > 0 ? Math.min(downloadCompletedRaw, downloadTotal) : downloadCompletedRaw
  const downloadSuccess = toInt(live?.download_success)
  const downloadFailed = toInt(live?.download_failed)
  const downloadConcurrency = toInt(live?.download_concurrency)
  const downloadRetryAttempts = toInt(live?.download_retry_attempts)
  const downloadLastLabel = String(live?.download_last_label || '').trim()
  const downloadStarted = Boolean(live?.download_started) || downloadTotal > 0
  const downloadActive = Boolean(live?.download_active)
  const downloadPercent = downloadTotal > 0
    ? clampPercent((downloadCompleted / downloadTotal) * 100)
    : (downloadStarted && !downloadActive ? 100 : 0)

  const sourceStagePercent = downloadStarted
    ? clampPercent((searchPercent * 0.45) + (downloadPercent * 0.55))
    : searchPercent
  const searchDone = searchTotal > 0 && searchCompleted >= searchTotal
  const sourcePhaseLabel = getSemirAiSourcePhaseLabel(phase, searchDone, downloadActive, downloadCompleted, downloadTotal)
  const sourceStageComplete = searchDone && (!downloadStarted || downloadTotal <= 0 || downloadCompleted >= downloadTotal) && !isSemirAiSearchPhase(phase)
  const sourceStageState = sourceStageComplete
    ? 'complete'
    : (searchCompleted > 0 || downloadStarted || isSemirAiSearchPhase(phase))
      ? 'active'
      : 'pending'

  const generationTotal = toInt(live?.generation_total_jobs)
  const generationCompletedRaw = toInt(live?.generation_completed_jobs)
  const generationCompleted = generationTotal > 0 ? Math.min(generationCompletedRaw, generationTotal) : generationCompletedRaw
  const generationCurrent = toInt(live?.current)
  const generationPercent = generationTotal > 0 ? clampPercent((generationCompleted / generationTotal) * 100) : 0
  const generationPhaseLabel = getSemirAiGenerationPhaseLabel(phase, generationCompleted, generationTotal)
  const generationStageActive = generationTotal > 0 && !isSemirAiSearchPhase(phase) && normalizeKeyPart(phase) !== 'finalize_all'
  const generationStageState = generationTotal <= 0
    ? (sourceStageComplete ? 'complete' : 'pending')
    : generationCompleted >= generationTotal
      ? 'complete'
      : generationStageActive
        ? 'active'
        : 'pending'

  const sourceCaptionParts = []
  if (downloadTotal > 0) sourceCaptionParts.push(`素材 ${downloadCompleted}/${downloadTotal}`)
  if (downloadSuccess > 0) sourceCaptionParts.push(`成功 ${downloadSuccess}`)
  if (downloadFailed > 0) sourceCaptionParts.push(`失败 ${downloadFailed}`)
  if (downloadConcurrency > 0) sourceCaptionParts.push(`并发 ${downloadConcurrency}`)
  if (downloadRetryAttempts > 1) sourceCaptionParts.push(`重试 ${downloadRetryAttempts} 次`)

  const generationCaptionParts = []
  if (generationTotal > 0) generationCaptionParts.push(`已完成 ${generationCompleted}/${generationTotal}`)
  if (currentCode) generationCaptionParts.push(`当前 ${currentCode}`)

  const tracks = [
    buildTrack({
      id: 'semir-ai-source',
      title: '上层 · 找图和下图',
      main: searchTotal > 0 ? `${searchCompleted} / ${searchTotal} 个编码` : (sourcePhaseLabel || statusLabel),
      percentValue: sourceStagePercent,
      percentLabel: `${sourceStagePercent}%`,
      caption: sourceCaptionParts.join(' · ') || (downloadStarted ? '正在汇总素材下载结果' : '先按编码检索云盘素材'),
      detail: [currentCode ? `当前目标 ${currentCode}` : '', downloadLastLabel ? `最近素材 ${downloadLastLabel}` : ''].filter(Boolean).join(' · '),
      status: sourceStageState === 'complete' ? '已完成' : sourceStageState === 'active' ? '进行中' : '待开始',
      tone: 'primary',
      state: sourceStageState,
      ariaLabel: '找图和下图进度',
      ariaText: [sourcePhaseLabel, `${sourceStagePercent}%`, searchTotal > 0 ? `${searchCompleted}/${searchTotal} 个编码` : '', downloadTotal > 0 ? `${downloadCompleted}/${downloadTotal} 个素材` : ''].filter(Boolean).join('，'),
    }),
    buildTrack({
      id: 'semir-ai-generate',
      title: '下层 · AI 生图',
      main: generationTotal > 0 ? `${generationCompleted} / ${generationTotal} 张已完成` : (sourceStageComplete ? '等待生图队列' : '素材完成后自动开始'),
      percentValue: generationPercent,
      percentLabel: generationTotal > 0 ? `${generationPercent}%` : '待开始',
      caption: generationCaptionParts.join(' · ') || generationPhaseLabel,
      detail: [currentSourceFilename ? `当前素材 ${currentSourceFilename}` : '', store ? store : ''].filter(Boolean).join(' · '),
      status: generationStageState === 'complete' ? '已完成' : generationStageState === 'active' ? generationPhaseLabel : '待开始',
      tone: 'secondary',
      state: generationStageState,
      ariaLabel: 'AI 生图进度',
      ariaText: [generationPhaseLabel, generationTotal > 0 ? `${generationCompleted}/${generationTotal}` : '待开始', currentSourceFilename].filter(Boolean).join('，'),
    }),
  ]

  const overallLabel = generationStageActive || generationStageState === 'complete'
    ? generationPhaseLabel
    : sourcePhaseLabel
  const overallPercent = generationTotal > 0
    ? clampPercent(50 + generationPercent * 0.5)
    : clampPercent(sourceStagePercent * 0.5)

  return {
    title: '双阶段进度',
    main: overallLabel,
    percentValue: overallPercent,
    percentLabel: overallLabel,
    completed: generationCompleted,
    completedText: generationCompleted > 0 ? `已生图 ${generationCompleted} 张` : '',
    batchText: '',
    rowText: '',
    targetText: currentCode ? `目标 ${currentCode}` : '',
    storeText: store || '',
    phaseText: phase ? `阶段 ${phase}` : '',
    indeterminate: false,
    ariaLabel: '森马云盘 AI 双阶段进度',
    ariaText: [overallLabel, `${searchCompleted}/${searchTotal} 个编码`, generationTotal > 0 ? `${generationCompleted}/${generationTotal} 张生图` : ''].filter(Boolean).join('，'),
    metaItems: buildMetaItems([
      searchTotal > 0 ? `编码 ${searchCompleted}/${searchTotal}` : '',
      downloadTotal > 0 ? `素材 ${downloadCompleted}/${downloadTotal}` : '',
      generationTotal > 0 ? `生图 ${generationCompleted}/${generationTotal}` : '',
      currentCode ? `目标 ${currentCode}` : '',
    ]),
    tracks,
    sub: [overallLabel, currentSourceFilename ? `当前素材 ${currentSourceFilename}` : '', downloadFailed > 0 ? `素材失败 ${downloadFailed} 张` : ''].filter(Boolean).join(' · ') || statusLabel,
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
  if (config.mode === 'enhanced' && isSemirBatchImageDownloadTask(adapterId, taskId)) {
    return buildSemirBatchImageDownloadProgress(live, liveStatus, isRunning)
  }
  if (config.mode === 'enhanced' && isShenhuiPrepareUploadPackageTask(adapterId, taskId)) {
    return buildShenhuiPrepareUploadPackageProgress(live, liveStatus, isRunning)
  }
  if (config.mode === 'enhanced' && isSemirBatchAiGenerateTask(adapterId, taskId)) {
    return buildSemirBatchAiGenerateProgress(live, liveStatus, isRunning)
  }
  return config.mode === 'enhanced'
    ? buildEnhancedTaskRunnerProgress(live, liveStatus, isRunning)
    : buildClassicTaskRunnerProgress(live, isRunning)
}
