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
    adapterId: 'shein-helper',
    taskId: 'commodity_quality',
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
    taskId: 'tmall_material_new_624',
    config: ENHANCED_TASK_RUNNER_ONLY_CONFIG,
  }),
  Object.freeze({
    adapterId: 'semir-cloud-drive',
    taskId: 'batch_ai_generate',
    config: ENHANCED_TASK_RUNNER_ONLY_CONFIG,
  }),
  Object.freeze({
    adapterId: 'tmall-ops-assistant',
    taskId: 'tmall_ai_image_test_chain',
    config: ENHANCED_TASK_RUNNER_ONLY_CONFIG,
  }),
  Object.freeze({
    adapterId: 'tmall-ops-assistant',
    taskId: 'tmall_material_test_data_export',
    config: ENHANCED_TASK_RUNNER_ONLY_CONFIG,
  }),
  Object.freeze({
    adapterId: 'shenhui-new-arrival',
    taskId: 'prepare_upload_package',
    config: ENHANCED_TASK_RUNNER_ONLY_CONFIG,
  }),
  Object.freeze({
    adapterId: 'tiktok-ops-assistant',
    taskId: 'creator_video_download',
    config: ENHANCED_TASK_RUNNER_ONLY_CONFIG,
  }),
  Object.freeze({
    adapterId: 'amazon-ops-assistant',
    taskId: 'amazon_reviews_full_export',
    config: ENHANCED_PROGRESS_CONFIG,
  }),
  Object.freeze({
    adapterId: 'aliexpress-ops-assistant',
    taskId: 'product_cutout_download',
    config: ENHANCED_PROGRESS_CONFIG,
  }),
  Object.freeze({
    adapterId: 'doudian-ops-assistant',
    taskId: 'mixed_fund_signup_monitor',
    config: ENHANCED_PROGRESS_CONFIG,
  }),
  Object.freeze({
    adapterId: 'doudian-ops-assistant',
    taskId: 'mixed_fund_order_replay',
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
    'tmall_material_new_624',
  ].includes(normalizeKeyPart(taskId))
}

function isSemirBatchAiGenerateTask(adapterId, taskId) {
  return normalizeKeyPart(adapterId) === 'semir-cloud-drive' && normalizeKeyPart(taskId) === 'batch_ai_generate'
}

function isTmallAiImageTestChainTask(adapterId, taskId) {
  return normalizeKeyPart(adapterId) === 'tmall-ops-assistant' && normalizeKeyPart(taskId) === 'tmall_ai_image_test_chain'
}

function isShenhuiPrepareUploadPackageTask(adapterId, taskId) {
  return normalizeKeyPart(adapterId) === 'shenhui-new-arrival' && normalizeKeyPart(taskId) === 'prepare_upload_package'
}

function isTiktokCreatorVideoDownloadTask(adapterId, taskId) {
  return normalizeKeyPart(adapterId) === 'tiktok-ops-assistant' && normalizeKeyPart(taskId) === 'creator_video_download'
}

function isSheinCommodityQualityTask(adapterId, taskId) {
  return normalizeKeyPart(adapterId) === 'shein-helper' && normalizeKeyPart(taskId) === 'commodity_quality'
}

function isAmazonReviewsFullExportTask(adapterId, taskId) {
  return normalizeKeyPart(adapterId) === 'amazon-ops-assistant' && normalizeKeyPart(taskId) === 'amazon_reviews_full_export'
}

function isDoudianMixedFundSignupTask(adapterId, taskId) {
  return normalizeKeyPart(adapterId) === 'doudian-ops-assistant' && normalizeKeyPart(taskId) === 'mixed_fund_signup_monitor'
}

function isDoudianMixedFundOrderReplayTask(adapterId, taskId) {
  return normalizeKeyPart(adapterId) === 'doudian-ops-assistant' && normalizeKeyPart(taskId) === 'mixed_fund_order_replay'
}

function doudianStageLabel(stage, fallback = '进行中') {
  const normalized = normalizeKeyPart(stage)
  if (normalized === 'signup_activity') return '读取活动入口'
  if (normalized === 'signup_products') return '抓取报名商品'
  if (normalized === 'order_list') return '抓取订单列表'
  if (normalized === 'order_details') return '抓取订单详情优惠'
  if (normalized === 'finalize') return '汇总导出'
  return fallback
}

function progressState(done, total, active = false) {
  if (total > 0 && done >= total) return 'complete'
  return active || done > 0 ? 'active' : 'pending'
}

function buildDoudianMixedFundSignupProgress(live = {}, liveStatus = '', isRunning = false) {
  if (!isRunning && !isTaskLiveActive(liveStatus || live?.status)) return null

  const statusLabel = getStatusLabel(liveStatus || live?.status)
  const stage = normalizeKeyPart(live?.doudian_stage || live?.phase)
  const stageLabel = doudianStageLabel(stage, statusLabel)
  const activityTotal = toInt(live?.doudian_activity_total) || toInt(live?.total)
  const activityCompleted = activityTotal > 0 ? Math.min(toInt(live?.doudian_activity_completed), activityTotal) : toInt(live?.doudian_activity_completed)
  const productTotal = toInt(live?.doudian_current_product_total)
  const productCompleted = productTotal > 0 ? Math.min(toInt(live?.doudian_current_product_completed), productTotal) : toInt(live?.doudian_current_product_completed)
  const currentActivity = String(live?.doudian_current_activity || '').trim()
  const detailRows = toInt(live?.doudian_detail_rows || live?.records || live?.completed)
  const activityPercent = activityTotal > 0 ? clampPercent((activityCompleted / activityTotal) * 100) : 0
  const productPercent = productTotal > 0 ? clampPercent((productCompleted / productTotal) * 100) : 0

  const tracks = [
    buildTrack({
      id: 'doudian-signup-activity',
      title: '活动入口',
      main: activityTotal > 0 ? `${activityCompleted} / ${activityTotal} 个入口` : '读取入口中',
      percentValue: activityPercent,
      percentLabel: activityTotal > 0 ? `${activityPercent}%` : statusLabel,
      caption: currentActivity,
      detail: detailRows > 0 ? `已拉取明细 ${detailRows} 条` : '',
      status: progressState(activityCompleted, activityTotal, stage === 'signup_activity') === 'complete' ? '已完成' : '进行中',
      tone: 'primary',
      state: progressState(activityCompleted, activityTotal, stage === 'signup_activity'),
      indeterminate: activityTotal <= 0,
    }),
    buildTrack({
      id: 'doudian-signup-products',
      title: '当前入口商品',
      main: productTotal > 0 ? `${productCompleted} / ${productTotal} 个商品` : (stage === 'signup_products' ? '读取商品数中' : '等待入口'),
      percentValue: productPercent,
      percentLabel: productTotal > 0 ? `${productPercent}%` : (stage === 'signup_products' ? statusLabel : '待开始'),
      caption: currentActivity,
      detail: detailRows > 0 ? `累计明细 ${detailRows} 条` : '',
      status: progressState(productCompleted, productTotal, stage === 'signup_products') === 'complete' ? '已完成' : stage === 'signup_products' ? '进行中' : '待开始',
      tone: 'secondary',
      state: progressState(productCompleted, productTotal, stage === 'signup_products'),
      indeterminate: stage === 'signup_products' && productTotal <= 0,
    }),
  ]

  return {
    title: '商城混资报名进度',
    main: stageLabel,
    percentValue: activityTotal > 0 ? activityPercent : 0,
    percentLabel: stageLabel,
    completed: detailRows,
    completedText: detailRows > 0 ? `已拉取报名明细 ${detailRows} 条` : '',
    targetText: currentActivity ? `当前 ${currentActivity}` : '',
    storeText: '',
    phaseText: live?.phase ? `阶段 ${live.phase}` : '',
    indeterminate: activityTotal <= 0,
    ariaLabel: '抖店商城混资报名进度',
    ariaText: [stageLabel, activityTotal > 0 ? `${activityCompleted}/${activityTotal} 个入口` : '', productTotal > 0 ? `${productCompleted}/${productTotal} 个商品` : ''].filter(Boolean).join('，'),
    metaItems: buildMetaItems([
      activityTotal > 0 ? `入口 ${activityCompleted}/${activityTotal}` : '',
      productTotal > 0 ? `商品 ${productCompleted}/${productTotal}` : '',
      detailRows > 0 ? `明细 ${detailRows}` : '',
      currentActivity,
    ]),
    tracks,
    sub: [stageLabel, currentActivity, detailRows > 0 ? `已拉取 ${detailRows} 条明细` : ''].filter(Boolean).join(' · ') || statusLabel,
  }
}

function buildDoudianMixedFundOrderReplayProgress(live = {}, liveStatus = '', isRunning = false) {
  if (!isRunning && !isTaskLiveActive(liveStatus || live?.status)) return null

  const statusLabel = getStatusLabel(liveStatus || live?.status)
  const stage = normalizeKeyPart(live?.doudian_stage || live?.phase)
  const stageLabel = doudianStageLabel(stage, statusLabel)
  const signupTotal = toInt(live?.doudian_signup_total || live?.doudian_activity_total)
  const signupCompleted = signupTotal > 0 ? Math.min(toInt(live?.doudian_signup_completed || live?.doudian_activity_completed), signupTotal) : toInt(live?.doudian_signup_completed || live?.doudian_activity_completed)
  const orderTotal = toInt(live?.list_total_rows)
  const orderCompleted = orderTotal > 0 ? Math.min(toInt(live?.list_completed_rows), orderTotal) : toInt(live?.list_completed_rows)
  const detailTotal = toInt(live?.detail_total_targets)
  const detailCompleted = detailTotal > 0 ? Math.min(toInt(live?.detail_completed_targets), detailTotal) : toInt(live?.detail_completed_targets)
  const currentOrder = String(live?.detail_current_target || '').trim()
  const mixedRows = toInt(live?.doudian_mixed_rows || live?.records || live?.completed)
  const currentActivity = String(live?.doudian_current_activity || '').trim()
  const signupPercent = signupTotal > 0 ? clampPercent((signupCompleted / signupTotal) * 100) : 0
  const orderPercent = orderTotal > 0 ? clampPercent((orderCompleted / orderTotal) * 100) : 0
  const detailPercent = detailTotal > 0 ? clampPercent((detailCompleted / detailTotal) * 100) : 0
  const detailStarted = detailTotal > 0 || stage === 'order_details' || stage === 'finalize'

  const tracks = [
    buildTrack({
      id: 'doudian-replay-signup',
      title: '报名商品归因',
      main: signupTotal > 0 ? `${signupCompleted} / ${signupTotal} 个入口` : '准备报名商品索引',
      percentValue: signupPercent,
      percentLabel: signupTotal > 0 ? `${signupPercent}%` : statusLabel,
      caption: currentActivity,
      detail: toInt(live?.doudian_detail_rows) > 0 ? `报名明细 ${toInt(live?.doudian_detail_rows)} 条` : '',
      status: progressState(signupCompleted, signupTotal, stage === 'signup_activity' || stage === 'signup_products') === 'complete' ? '已完成' : '进行中',
      tone: 'primary',
      state: progressState(signupCompleted, signupTotal, stage === 'signup_activity' || stage === 'signup_products'),
      indeterminate: signupTotal <= 0,
    }),
    buildTrack({
      id: 'doudian-replay-order-list',
      title: '订单列表',
      main: orderTotal > 0 ? `${orderCompleted} / ${orderTotal} 条订单` : (stage === 'order_list' ? '读取订单总数中' : '等待订单阶段'),
      percentValue: orderPercent,
      percentLabel: orderTotal > 0 ? `${orderPercent}%` : (stage === 'order_list' ? statusLabel : '待开始'),
      caption: toInt(live?.doudian_order_window_total) > 0 ? `时间窗口 ${toInt(live?.doudian_order_window_completed)}/${toInt(live?.doudian_order_window_total)}` : '',
      detail: '',
      status: progressState(orderCompleted, orderTotal, stage === 'order_list') === 'complete' ? '已完成' : stage === 'order_list' ? '进行中' : '待开始',
      tone: 'primary',
      state: progressState(orderCompleted, orderTotal, stage === 'order_list'),
      indeterminate: stage === 'order_list' && orderTotal <= 0,
    }),
    buildTrack({
      id: 'doudian-replay-order-details',
      title: '订单详情优惠',
      main: detailTotal > 0 ? `${detailCompleted} / ${detailTotal} 个订单` : (detailStarted ? '等待详情队列' : '订单列表完成后开始'),
      percentValue: detailPercent,
      percentLabel: detailStarted ? `${detailPercent}%` : '待开始',
      caption: mixedRows > 0 ? `已归因混资订单 ${mixedRows} 条` : '',
      detail: currentOrder ? `当前订单 ${currentOrder}` : '',
      status: progressState(detailCompleted, detailTotal, stage === 'order_details') === 'complete' ? '已完成' : stage === 'order_details' ? '进行中' : '待开始',
      tone: 'secondary',
      state: progressState(detailCompleted, detailTotal, stage === 'order_details'),
      indeterminate: stage === 'order_details' && detailTotal <= 0,
    }),
  ]

  const overallPercent = detailStarted
    ? clampPercent(66 + (detailPercent * 0.34))
    : orderTotal > 0
      ? clampPercent(33 + (orderPercent * 0.33))
      : clampPercent(signupPercent * 0.33)

  return {
    title: '商城混资复盘进度',
    main: stageLabel,
    percentValue: overallPercent,
    percentLabel: stageLabel,
    completed: mixedRows,
    completedText: mixedRows > 0 ? `已归因混资订单 ${mixedRows} 条` : '',
    targetText: currentOrder ? `订单 ${currentOrder}` : '',
    storeText: '',
    phaseText: live?.phase ? `阶段 ${live.phase}` : '',
    indeterminate: signupTotal <= 0 && orderTotal <= 0 && detailTotal <= 0,
    ariaLabel: '抖店商城混资复盘进度',
    ariaText: [stageLabel, signupTotal > 0 ? `报名 ${signupCompleted}/${signupTotal}` : '', orderTotal > 0 ? `订单 ${orderCompleted}/${orderTotal}` : '', detailTotal > 0 ? `详情 ${detailCompleted}/${detailTotal}` : ''].filter(Boolean).join('，'),
    metaItems: buildMetaItems([
      signupTotal > 0 ? `报名 ${signupCompleted}/${signupTotal}` : '',
      orderTotal > 0 ? `订单 ${orderCompleted}/${orderTotal}` : '',
      detailTotal > 0 ? `详情 ${detailCompleted}/${detailTotal}` : '',
      mixedRows > 0 ? `混资 ${mixedRows}` : '',
      currentOrder ? `订单 ${currentOrder}` : '',
    ]),
    tracks,
    sub: [stageLabel, currentOrder ? `当前订单 ${currentOrder}` : '', mixedRows > 0 ? `已归因 ${mixedRows} 条` : ''].filter(Boolean).join(' · ') || statusLabel,
  }
}

function buildAmazonReviewsFullExportProgress(live = {}, liveStatus = '', isRunning = false) {
  if (!isRunning && !isTaskLiveActive(liveStatus || live?.status)) return null

  const statusLabel = getStatusLabel(liveStatus || live?.status)
  const phase = normalizeKeyPart(live?.phase)
  const asin = String(live?.buyer_id || live?.detail_current_target || '').trim()
  const store = String(live?.store || '').trim()
  const records = toInt(live?.records || live?.completed)
  const dimensionLabel = String(live?.detail_dimension_label || '').trim()
  const dimensionIndex = toInt(live?.detail_dimension_index)
  const dimensionTotal = toInt(live?.detail_dimension_total)

  const totalItems = toInt(live?.list_total_rows) || toInt(live?.total)
  const rawItemIndex = toInt(live?.detail_current_target_index) || toInt(live?.current)
  const currentItemIndex = totalItems > 0 ? Math.min(Math.max(rawItemIndex, 1), totalItems) : rawItemIndex
  const completedItems = toInt(live?.list_completed_rows)
  const itemPercent = totalItems > 0 ? clampPercent((Math.max(completedItems, currentItemIndex) / totalItems) * 100) : 0

  const expectedReviews = toInt(live?.detail_total_targets) || toInt(live?.total_batches)
  const collectedForItemRaw = toInt(live?.detail_completed_targets) || toInt(live?.batch_no)
  const collectedForItem = expectedReviews > 0 ? Math.min(collectedForItemRaw, expectedReviews) : collectedForItemRaw
  const reviewPercent = expectedReviews > 0 ? clampPercent((collectedForItem / expectedReviews) * 100) : (collectedForItem > 0 ? 0 : 0)
  const currentPage = toInt(live?.detail_current_page)
  const totalPages = toInt(live?.detail_total_pages)
  const allItemsDone = totalItems > 0 && completedItems >= totalItems
  const currentItemDone = expectedReviews > 0 && collectedForItem >= expectedReviews

  const phaseLabel = phase === 'advance_reviews_page'
    ? '展开下一批评论'
    : phase === 'collect_reviews_page'
      ? '抓取当前评论'
      : phase === 'ensure_reviews_page' || phase === 'wait_reviews_page'
        ? '打开评论页'
        : allItemsDone ? '抓取完成' : statusLabel

  const itemMain = totalItems > 0
    ? allItemsDone ? `${totalItems} / ${totalItems} 个商品已完成` : `第 ${currentItemIndex} / ${totalItems} 个商品`
    : (statusLabel || '等待开始')
  const reviewMain = expectedReviews > 0
    ? `${collectedForItem} / ${expectedReviews} 条评论`
    : collectedForItem > 0
      ? `已抓取 ${collectedForItem} 条评论`
      : '读取评论总数'

  const itemState = allItemsDone ? 'complete' : currentItemIndex > 0 ? 'active' : 'pending'
  const reviewState = currentItemDone ? 'complete' : asin ? 'active' : 'pending'
  const pageText = currentPage > 0 && totalPages > 0
    ? `页 ${currentPage}/${totalPages}`
    : currentPage > 0 ? `页 ${currentPage}` : ''
  const dimensionText = dimensionIndex > 0 && dimensionTotal > 0
    ? `维度 ${dimensionIndex}/${dimensionTotal}${dimensionLabel ? ` ${dimensionLabel}` : ''}`
    : dimensionLabel

  const tracks = [
    buildTrack({
      id: 'amazon-review-products',
      title: '上层 · 商品链接',
      main: itemMain,
      percentValue: itemPercent,
      percentLabel: `${itemPercent}%`,
      caption: [completedItems > 0 ? `已完成 ${Math.min(completedItems, totalItems)} 个` : '', asin ? `当前 ASIN ${asin}` : ''].filter(Boolean).join(' · '),
      detail: store,
      status: itemState === 'complete' ? '已完成' : itemState === 'active' ? '进行中' : '待开始',
      tone: 'primary',
      state: itemState,
      ariaLabel: '商品链接抓取进度',
      ariaText: [itemMain, `${itemPercent}%`, asin ? `当前 ASIN ${asin}` : ''].filter(Boolean).join('，'),
    }),
    buildTrack({
      id: 'amazon-review-current',
      title: '下层 · 当前链接评论',
      main: reviewMain,
      percentValue: reviewPercent,
      percentLabel: expectedReviews > 0 ? `${reviewPercent}%` : '读取中',
      caption: [dimensionText, pageText, records > 0 ? `总计 ${records} 条` : ''].filter(Boolean).join(' · '),
      detail: asin ? `ASIN ${asin}` : '',
      status: reviewState === 'complete' ? '已完成' : reviewState === 'active' ? '进行中' : '待开始',
      tone: 'secondary',
      state: reviewState,
      ariaLabel: '当前链接评论抓取进度',
      ariaText: [reviewMain, expectedReviews > 0 ? `${reviewPercent}%` : '读取中', pageText].filter(Boolean).join('，'),
    }),
  ]

  return {
    title: '双层进度',
    main: phaseLabel,
    percentValue: clampPercent((itemPercent * 0.45) + (reviewPercent * 0.55)),
    percentLabel: phaseLabel,
    completed: records,
    completedText: records > 0 ? `已抓取 ${records} 条评论` : '',
    batchText: expectedReviews > 0 ? `当前评论 ${collectedForItem}/${expectedReviews}` : '',
    rowText: '',
    targetText: asin ? `ASIN ${asin}` : '',
    storeText: store,
    phaseText: phase ? `阶段 ${phase}` : '',
    indeterminate: expectedReviews <= 0,
    ariaLabel: 'Amazon Reviews 双层进度',
    ariaText: [phaseLabel, itemMain, reviewMain].filter(Boolean).join('，'),
    metaItems: buildMetaItems([
      totalItems > 0 ? `商品 ${Math.min(completedItems, totalItems)}/${totalItems}` : '',
      expectedReviews > 0 ? `当前评论 ${collectedForItem}/${expectedReviews}` : '',
      dimensionText,
      pageText,
      records > 0 ? `总计 ${records}` : '',
    ]),
    tracks,
    sub: [phaseLabel, asin ? `当前 ASIN ${asin}` : '', records > 0 ? `已抓取 ${records} 条评论` : ''].filter(Boolean).join(' · ') || statusLabel,
  }
}

function getTiktokCreatorVideoPhaseLabel(phase, downloadStarted, downloadActive, downloadCompleted, downloadTotal) {
  const normalizedPhase = normalizeKeyPart(phase)
  if (normalizedPhase === 'after_download' || downloadActive) return '批量下载'
  if (downloadStarted && downloadTotal > 0 && downloadCompleted >= downloadTotal) return '下载完成'
  if (normalizedPhase === 'main') return '探查视频'
  return '准备中'
}

function buildTiktokCreatorVideoDownloadProgress(live = {}, liveStatus = '', isRunning = false) {
  if (!isRunning && !isTaskLiveActive(liveStatus || live?.status)) return null

  const phase = String(live?.phase || '').trim()
  const statusLabel = getStatusLabel(liveStatus || live?.status)
  const currentVideoId = String(live?.buyer_id || '').trim()
  const store = String(live?.store || '').trim()

  const searchTotal = toInt(live?.search_total_codes) || toInt(live?.total)
  const searchCompletedRaw = toInt(live?.search_completed_codes) || toInt(live?.current)
  const searchCompleted = searchTotal > 0 ? Math.min(searchCompletedRaw, searchTotal) : searchCompletedRaw
  const searchPercent = searchTotal > 0 ? clampPercent((searchCompleted / searchTotal) * 100) : 0

  const downloadTotal = toInt(live?.download_total)
  const downloadCompletedRaw = toInt(live?.download_completed)
  const downloadCompleted = downloadTotal > 0 ? Math.min(downloadCompletedRaw, downloadTotal) : downloadCompletedRaw
  const downloadSuccess = toInt(live?.download_success)
  const downloadFailed = toInt(live?.download_failed)
  const downloadConcurrency = toInt(live?.download_concurrency)
  const downloadRetryAttempts = toInt(live?.download_retry_attempts)
  const downloadCurrentLabel = String(live?.download_current_label || '').trim()
  const downloadLastLabel = String(live?.download_last_label || '').trim()
  const downloadStarted = Boolean(live?.download_started) || downloadTotal > 0
  const downloadActive = Boolean(live?.download_active) || (downloadStarted && downloadTotal > 0 && downloadCompleted < downloadTotal)
  const downloadPercent = downloadTotal > 0
    ? clampPercent((downloadCompleted / downloadTotal) * 100)
    : (downloadStarted && !downloadActive ? 100 : 0)

  const phaseLabel = getTiktokCreatorVideoPhaseLabel(phase, downloadStarted, downloadActive, downloadCompleted, downloadTotal) || statusLabel

  const tracks = [
    buildTrack({
      id: 'tiktok-probe',
      title: '第一阶段 · 探查视频',
      main: searchTotal > 0 ? `${searchCompleted} / ${searchTotal} 条视频` : (statusLabel || '等待开始'),
      percentValue: searchPercent,
      percentLabel: `${searchPercent}%`,
      caption: currentVideoId ? `当前视频 ${currentVideoId}` : '',
      detail: store || '',
      status: downloadStarted || (searchTotal > 0 && searchCompleted >= searchTotal) ? '已完成' : '进行中',
      tone: 'primary',
      state: downloadStarted || (searchTotal > 0 && searchCompleted >= searchTotal) ? 'complete' : (searchCompleted > 0 ? 'active' : 'pending'),
      ariaLabel: '探查视频进度',
      ariaText: [searchTotal > 0 ? `${searchCompleted}/${searchTotal} 条视频` : '', `${searchPercent}%`, currentVideoId ? `当前视频 ${currentVideoId}` : '', store].filter(Boolean).join('，'),
    }),
    buildTrack({
      id: 'tiktok-download',
      title: '第二阶段 · 批量下载',
      main: downloadTotal > 0 ? `${downloadCompleted} / ${downloadTotal} 个视频` : (downloadStarted ? '等待下载进度' : '探查完成后自动开始'),
      percentValue: downloadPercent,
      percentLabel: downloadStarted ? `${downloadPercent}%` : '待开始',
      caption: [
        downloadSuccess > 0 ? `成功 ${downloadSuccess}` : '',
        downloadFailed > 0 ? `失败 ${downloadFailed}` : '',
        downloadConcurrency > 0 ? `并发 ${downloadConcurrency}` : '',
        downloadRetryAttempts > 1 ? `重试 ${downloadRetryAttempts} 次` : '',
      ].filter(Boolean).join(' · ') || (downloadStarted ? '正在汇总下载结果' : '探查完成后进入下载阶段'),
      detail: downloadCurrentLabel
        ? `正在下载 ${downloadCurrentLabel}`
        : (downloadLastLabel ? `最近视频 ${downloadLastLabel}` : ''),
      status: !downloadStarted ? '待开始' : downloadCompleted >= downloadTotal && downloadTotal > 0 ? '已完成' : '进行中',
      tone: 'secondary',
      state: !downloadStarted ? 'pending' : downloadCompleted >= downloadTotal && downloadTotal > 0 ? 'complete' : 'active',
      ariaLabel: '批量下载进度',
      ariaText: [downloadTotal > 0 ? `${downloadCompleted}/${downloadTotal} 个视频` : '', downloadStarted ? `${downloadPercent}%` : '待开始', downloadCurrentLabel || downloadLastLabel].filter(Boolean).join('，'),
    }),
  ]

  return {
    title: '双阶段进度',
    main: phaseLabel,
    percentValue: downloadStarted ? clampPercent(50 + (downloadPercent * 0.5)) : clampPercent(searchPercent * 0.5),
    percentLabel: phaseLabel,
    completed: downloadSuccess,
    completedText: downloadSuccess > 0 ? `已下载 ${downloadSuccess} 个视频` : '',
    batchText: '',
    rowText: '',
    targetText: currentVideoId ? `视频 ${currentVideoId}` : '',
    storeText: store || '',
    phaseText: phase ? `阶段 ${phase}` : '',
    indeterminate: false,
    ariaLabel: 'TikTok 达人视频双阶段进度',
    ariaText: [phaseLabel, searchTotal > 0 ? `${searchCompleted}/${searchTotal} 条视频` : '', downloadTotal > 0 ? `${downloadCompleted}/${downloadTotal} 个视频` : ''].filter(Boolean).join('，'),
    metaItems: buildMetaItems([
      searchTotal > 0 ? `探查 ${searchCompleted}/${searchTotal}` : '',
      downloadTotal > 0 ? `下载 ${downloadCompleted}/${downloadTotal}` : '',
      currentVideoId ? `视频 ${currentVideoId}` : '',
      store,
    ]),
    tracks,
    sub: [phaseLabel, downloadFailed > 0 ? `下载失败 ${downloadFailed} 个` : '', store].filter(Boolean).join(' · ') || statusLabel,
  }
}

function getTmallAiImageChainPhaseLabel(phase, generationStarted, generationDone, statusLabel) {
  const normalizedPhase = normalizeKeyPart(phase)
  if (normalizedPhase === 'tmall_ai_chain_semir') return '找图中'
  if (normalizedPhase === 'tmall_ai_chain_generate') return generationDone ? '生图完成' : '批量生图'
  if (normalizedPhase === 'tmall_ai_chain_tmall') return '上传创建'
  if (generationDone) return '整理审批'
  return generationStarted ? '批量生图' : statusLabel
}

function parseTmallAiImageGenerationProgressText(value) {
  const text = String(value || '').trim()
  if (!text) return { count: 0, total: 0, kind: '' }
  const match = text.match(/(?:1XM\s*)?生图(?:批量提交|提交|完成)?\s*([0-9]+)\s*\/\s*([0-9]+)/i)
  if (!match) return { count: 0, total: 0, kind: '' }
  return {
    count: toInt(match[1]),
    total: toInt(match[2]),
    kind: text.includes('提交') ? 'submitted' : (text.includes('完成') ? 'completed' : ''),
  }
}

function buildTmallAiImageTestChainProgress(live = {}, liveStatus = '', isRunning = false) {
  if (!isRunning && !isTaskLiveActive(liveStatus || live?.status)) return null

  const phase = String(live?.phase || '').trim()
  const statusLabel = getStatusLabel(liveStatus || live?.status)
  const currentStyle = String(live?.buyer_id || '').trim()
  const store = String(live?.store || '').trim()
  const currentPrompt = String(live?.current_source_filename || '').trim()
  const generationTextProgress = parseTmallAiImageGenerationProgressText(store)

  const searchTotal = toInt(live?.search_total_codes) || toInt(live?.total)
  const searchCompletedRaw = toInt(live?.search_completed_codes) || (normalizeKeyPart(phase) === 'tmall_ai_chain_generate' ? searchTotal : toInt(live?.current))
  const searchCompleted = searchTotal > 0 ? Math.min(searchCompletedRaw, searchTotal) : searchCompletedRaw
  const searchPercent = searchTotal > 0 ? clampPercent((searchCompleted / searchTotal) * 100) : 0

  const generationTotal = toInt(live?.generation_total_jobs) || generationTextProgress.total
  const generationSubmittedRaw = toInt(live?.generation_submitted_jobs) || (generationTextProgress.kind === 'submitted' ? generationTextProgress.count : 0)
  const generationCompletedRaw = toInt(live?.generation_completed_jobs) || (generationTextProgress.kind === 'completed' ? generationTextProgress.count : 0)
  const generationSubmitted = generationTotal > 0 ? Math.min(generationSubmittedRaw, generationTotal) : generationSubmittedRaw
  const generationCompleted = generationTotal > 0 ? Math.min(generationCompletedRaw, generationTotal) : generationCompletedRaw
  const generationProgressTotal = generationSubmitted > 0
    ? Math.max(generationSubmitted, generationCompleted)
    : generationTotal
  const generationPercent = generationProgressTotal > 0 ? clampPercent((generationCompleted / generationProgressTotal) * 100) : 0
  const generationStarted = generationTotal > 0 || normalizeKeyPart(phase) === 'tmall_ai_chain_generate' || normalizeKeyPart(phase) === 'tmall_ai_chain_tmall'
  const generationDone = generationTotal > 0 && generationCompleted >= generationTotal
  const phaseLabel = getTmallAiImageChainPhaseLabel(phase, generationStarted, generationDone, statusLabel)

  const searchState = generationStarted || (searchTotal > 0 && searchCompleted >= searchTotal)
    ? 'complete'
    : searchCompleted > 0 || currentStyle
      ? 'active'
      : 'pending'
  const generationState = !generationStarted
    ? 'pending'
    : generationDone
      ? 'complete'
      : 'active'

  const tracks = [
    buildTrack({
      id: 'tmall-ai-find-images',
      title: '找图进度',
      main: searchTotal > 0 ? `${searchCompleted} / ${searchTotal} 款` : (statusLabel || '等待开始'),
      percentValue: searchPercent,
      percentLabel: `${searchPercent}%`,
      caption: currentStyle && searchState !== 'complete' ? `当前款号 ${currentStyle}` : '',
      detail: searchState === 'complete' ? '云盘找图阶段已完成' : store,
      status: searchState === 'complete' ? '已完成' : searchState === 'active' ? '进行中' : '待开始',
      tone: 'primary',
      state: searchState,
      ariaLabel: '找图进度',
      ariaText: [searchTotal > 0 ? `${searchCompleted}/${searchTotal} 款` : '', `${searchPercent}%`, currentStyle ? `当前款号 ${currentStyle}` : ''].filter(Boolean).join('，'),
    }),
    buildTrack({
      id: 'tmall-ai-generate',
      title: '生图进度',
      main: generationProgressTotal > 0 ? `${generationCompleted} / ${generationProgressTotal} 张` : (generationStarted ? '等待生图队列' : '找图完成后批量开始'),
      percentValue: generationPercent,
      percentLabel: generationStarted ? `${generationPercent}%` : '待开始',
      caption: generationTotal > 0
        ? [
            generationSubmitted > 0 ? `已提交 ${generationSubmitted}/${generationTotal}` : '',
            generationCompleted > 0 ? `已完成 ${generationCompleted}/${generationTotal}` : '等待生成回传',
          ].filter(Boolean).join(' · ')
        : '找图完成后统一提交 1XM',
      detail: [currentStyle ? `当前款号 ${currentStyle}` : '', currentPrompt ? `当前提示词 ${currentPrompt}` : '', store].filter(Boolean).join(' · '),
      status: generationState === 'complete' ? '已完成' : generationState === 'active' ? '进行中' : '待开始',
      tone: 'secondary',
      state: generationState,
      indeterminate: generationStarted && generationTotal <= 0,
      ariaLabel: '生图进度',
      ariaText: [generationTotal > 0 ? `${generationCompleted}/${generationTotal} 张` : '', generationStarted ? `${generationPercent}%` : '待开始', currentStyle ? `当前款号 ${currentStyle}` : ''].filter(Boolean).join('，'),
    }),
  ]

  return {
    title: '双阶段进度',
    main: phaseLabel,
    percentValue: generationStarted ? clampPercent(50 + generationPercent * 0.5) : clampPercent(searchPercent * 0.5),
    percentLabel: phaseLabel,
    completed: generationCompleted,
    completedText: generationCompleted > 0
      ? `已生图 ${generationCompleted} 张`
      : (generationSubmitted > 0 ? `已提交 ${generationSubmitted} 张` : ''),
    batchText: '',
    rowText: '',
    targetText: currentStyle ? `款号 ${currentStyle}` : '',
    storeText: store || '',
    phaseText: phase ? `阶段 ${phase}` : '',
    indeterminate: false,
    ariaLabel: '巴拉 AI 测图双阶段进度',
    ariaText: [phaseLabel, searchTotal > 0 ? `${searchCompleted}/${searchTotal} 款` : '', generationTotal > 0 ? `${generationCompleted}/${generationTotal} 张` : ''].filter(Boolean).join('，'),
    metaItems: buildMetaItems([
      searchTotal > 0 ? `找图 ${searchCompleted}/${searchTotal}` : '',
      generationProgressTotal > 0 ? `生图 ${generationCompleted}/${generationProgressTotal}` : '',
      currentStyle ? `款号 ${currentStyle}` : '',
    ]),
    tracks,
    sub: [phaseLabel, generationStarted ? '1XM 并发队列' : '', currentStyle ? `当前款号 ${currentStyle}` : ''].filter(Boolean).join(' · ') || statusLabel,
  }
}

function buildSheinCommodityQualityProgress(live = {}, liveStatus = '', isRunning = false) {
  if (!isRunning && !isTaskLiveActive(liveStatus || live?.status)) return null

  const phase = String(live?.phase || '').trim()
  const normalizedPhase = normalizeKeyPart(phase)
  const statusLabel = getStatusLabel(liveStatus || live?.status)
  const store = String(live?.store || '').trim()

  const listTotal = toInt(live?.list_total_rows) || toInt(live?.total)
  const listCompletedRaw = toInt(live?.list_completed_rows) || toInt(live?.current)
  const listCompleted = listTotal > 0 ? Math.min(listCompletedRaw, listTotal) : listCompletedRaw
  const listPercent = listTotal > 0 ? clampPercent((listCompleted / listTotal) * 100) : 0
  const listTotalBatches = toInt(live?.list_total_batches) || toInt(live?.total_batches)
  const listCompletedBatches = toInt(live?.list_completed_batches) || toInt(live?.batch_no)

  const detailTotal = toInt(live?.detail_total_targets)
  const detailCompletedRaw = toInt(live?.detail_completed_targets)
  const detailCompleted = detailTotal > 0 ? Math.min(detailCompletedRaw, detailTotal) : detailCompletedRaw
  const detailPercent = detailTotal > 0 ? clampPercent((detailCompleted / detailTotal) * 100) : 0
  const detailCurrentTargetIndex = toInt(live?.detail_current_target_index)
  const detailCurrentTarget = String(live?.detail_current_target || '').trim()
  const detailCurrentPage = toInt(live?.detail_current_page)
  const detailTotalPages = toInt(live?.detail_total_pages)
  const detailTotalRows = toInt(live?.detail_total_rows)
  const detailRequestCount = toInt(live?.detail_request_count)
  const detailRecordsCollected = toInt(live?.detail_records_collected)
  const detailStarted = detailTotal > 0 || normalizedPhase === 'collect_detail_page'
  const detailDone = detailTotal > 0 && detailCompleted >= detailTotal && normalizedPhase !== 'collect_detail_page'

  const listState = detailStarted || (listTotal > 0 && listCompleted >= listTotal)
    ? 'complete'
    : listCompleted > 0 ? 'active' : 'pending'
  const detailState = !detailStarted
    ? 'pending'
    : detailDone
      ? 'complete'
      : 'active'

  const phaseLabel = normalizedPhase === 'collect_detail_page'
    ? '抓取客退详情'
    : normalizedPhase === 'collect_list_page' || normalizedPhase === 'prepare_list_shards'
      ? '抓取商品质量列表'
      : detailDone
        ? '客退详情完成'
        : statusLabel

  const listCaptionParts = []
  if (listTotalBatches > 0) listCaptionParts.push(`批次 ${Math.min(listCompletedBatches, listTotalBatches)}/${listTotalBatches}`)
  if (store && !detailStarted) listCaptionParts.push(store)

  const detailCaptionParts = []
  if (detailCurrentTargetIndex > 0 && detailTotal > 0) detailCaptionParts.push(`当前 ${detailCurrentTargetIndex}/${detailTotal}`)
  if (detailRequestCount > 0) detailCaptionParts.push(`请求 ${detailRequestCount} 次`)
  if (detailRecordsCollected > 0) detailCaptionParts.push(`明细 ${detailRecordsCollected} 条`)

  const detailMetaParts = []
  if (detailCurrentTarget) detailMetaParts.push(`当前 SKC ${detailCurrentTarget}`)
  if (detailCurrentPage > 0 && detailTotalPages > 0) detailMetaParts.push(`页 ${detailCurrentPage}/${detailTotalPages}`)
  if (detailTotalRows > 0) detailMetaParts.push(`当前 SKC 明细 ${detailTotalRows} 条`)
  if (!detailMetaParts.length && store && detailStarted) detailMetaParts.push(store)

  const tracks = [
    buildTrack({
      id: 'shein-quality-list',
      title: '第一阶段 · 商品质量列表',
      main: listTotal > 0 ? `${listCompleted} / ${listTotal} 条商品` : (statusLabel || '等待开始'),
      percentValue: listPercent,
      percentLabel: `${listPercent}%`,
      caption: listCaptionParts.join(' · '),
      detail: listState === 'complete' ? '列表已完成' : '',
      status: listState === 'complete' ? '已完成' : listState === 'active' ? '进行中' : '待开始',
      tone: 'primary',
      state: listState,
      ariaLabel: '商品质量列表进度',
      ariaText: [listTotal > 0 ? `${listCompleted}/${listTotal} 条商品` : '', `${listPercent}%`, listCaptionParts.join(' · ')].filter(Boolean).join('，'),
    }),
    buildTrack({
      id: 'shein-quality-return-detail',
      title: '第二阶段 · 客退详情',
      main: detailTotal > 0 ? `${detailCompleted} / ${detailTotal} 个 SKC` : (detailStarted ? '等待详情队列' : '列表完成后自动开始'),
      percentValue: detailPercent,
      percentLabel: detailStarted ? `${detailPercent}%` : '待开始',
      caption: detailCaptionParts.join(' · ') || (detailStarted ? '正在抓取客退详情' : '列表完成后进入详情阶段'),
      detail: detailMetaParts.join(' · '),
      status: detailState === 'complete' ? '已完成' : detailState === 'active' ? '进行中' : '待开始',
      tone: 'secondary',
      state: detailState,
      ariaLabel: '客退详情进度',
      ariaText: [detailTotal > 0 ? `${detailCompleted}/${detailTotal} 个 SKC` : '', detailStarted ? `${detailPercent}%` : '待开始', detailMetaParts.join(' · ')].filter(Boolean).join('，'),
    }),
  ]

  return {
    title: '双阶段进度',
    main: phaseLabel,
    percentValue: detailStarted ? clampPercent(50 + (detailPercent * 0.5)) : clampPercent(listPercent * 0.5),
    percentLabel: phaseLabel,
    completed: detailRecordsCollected || toInt(live?.completed || live?.records),
    completedText: detailRecordsCollected > 0 ? `已抓取客退明细 ${detailRecordsCollected} 条` : '',
    batchText: listTotalBatches > 0 ? `列表批次 ${Math.min(listCompletedBatches, listTotalBatches)}/${listTotalBatches}` : '',
    rowText: '',
    targetText: detailCurrentTarget ? `SKC ${detailCurrentTarget}` : '',
    storeText: store || '',
    phaseText: phase ? `阶段 ${phase}` : '',
    indeterminate: false,
    ariaLabel: 'SHEIN 商品质量双阶段进度',
    ariaText: [phaseLabel, listTotal > 0 ? `${listCompleted}/${listTotal} 条商品` : '', detailTotal > 0 ? `${detailCompleted}/${detailTotal} 个 SKC` : ''].filter(Boolean).join('，'),
    metaItems: buildMetaItems([
      listTotal > 0 ? `列表 ${listCompleted}/${listTotal}` : '',
      detailTotal > 0 ? `客退 ${detailCompleted}/${detailTotal}` : '',
      detailCurrentTarget ? `SKC ${detailCurrentTarget}` : '',
      detailRecordsCollected > 0 ? `明细 ${detailRecordsCollected}` : '',
    ]),
    tracks,
    sub: [phaseLabel, detailCurrentTarget ? `当前 SKC ${detailCurrentTarget}` : '', detailRecordsCollected > 0 ? `已收集明细 ${detailRecordsCollected} 条` : ''].filter(Boolean).join(' · ') || statusLabel,
  }
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
  if (config.mode === 'enhanced' && isTiktokCreatorVideoDownloadTask(adapterId, taskId)) {
    return buildTiktokCreatorVideoDownloadProgress(live, liveStatus, isRunning)
  }
  if (config.mode === 'enhanced' && isTmallAiImageTestChainTask(adapterId, taskId)) {
    return buildTmallAiImageTestChainProgress(live, liveStatus, isRunning)
  }
  if (config.mode === 'enhanced' && isSheinCommodityQualityTask(adapterId, taskId)) {
    return buildSheinCommodityQualityProgress(live, liveStatus, isRunning)
  }
  if (config.mode === 'enhanced' && isSemirBatchAiGenerateTask(adapterId, taskId)) {
    return buildSemirBatchAiGenerateProgress(live, liveStatus, isRunning)
  }
  if (config.mode === 'enhanced' && isAmazonReviewsFullExportTask(adapterId, taskId)) {
    return buildAmazonReviewsFullExportProgress(live, liveStatus, isRunning)
  }
  if (config.mode === 'enhanced' && isDoudianMixedFundSignupTask(adapterId, taskId)) {
    return buildDoudianMixedFundSignupProgress(live, liveStatus, isRunning)
  }
  if (config.mode === 'enhanced' && isDoudianMixedFundOrderReplayTask(adapterId, taskId)) {
    return buildDoudianMixedFundOrderReplayProgress(live, liveStatus, isRunning)
  }
  return config.mode === 'enhanced'
    ? buildEnhancedTaskRunnerProgress(live, liveStatus, isRunning)
    : buildClassicTaskRunnerProgress(live, isRunning)
}
