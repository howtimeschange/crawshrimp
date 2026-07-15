export function buildBalaAiStageRequest(exportResult = {}) {
  const next = exportResult?.next_task || {}
  return {
    adapterId: String(next.adapter_id || 'bala-ai-video-assistant'),
    taskId: String(next.task_id || 'bala_ai_face_background_generate'),
    params: next.params && typeof next.params === 'object' ? next.params : {},
  }
}

export const BALA_AI_VIDEO_ADAPTER_ID = 'bala-ai-video-assistant'
export const BALA_MATERIAL_PREPARE_TASK_ID = 'semir_video_material_prepare'
export const BALA_AI_IMAGE_TASK_ID = 'bala_ai_face_background_generate'
export const BALA_QN_VIDEO_TASK_ID = 'qn_img2video_batch'

const MATERIAL_PREPARE_DEFAULTS = Object.freeze({
  mode: 'new',
  folder_scan_depth: 2,
  duplicate_mode: 'first_per_hash',
  download_concurrency: 8,
  max_image_mb: 20,
})

export function normalizeStyleCodeLines(value = '') {
  const seen = new Set()
  return String(value || '')
    .replace(/[，、；;,]/g, '\n')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (seen.has(line)) return false
      seen.add(line)
      return true
    })
}

export function buildBalaMaterialPrepareParams({
  itemCodes = '',
  cloudPath = '',
  exportFolder = '',
  packageName = '',
} = {}) {
  const codes = Array.isArray(itemCodes)
    ? itemCodes.map(item => String(item || '').trim()).filter(Boolean)
    : normalizeStyleCodeLines(itemCodes)
  return {
    ...MATERIAL_PREPARE_DEFAULTS,
    item_codes: codes.join('\n'),
    cloud_path: String(cloudPath || '').trim(),
    export_folder: String(exportFolder || '').trim(),
    package_name: String(packageName || '').trim(),
  }
}

export function parseRunOutputFiles(value = []) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean)
  if (typeof value !== 'string') return []
  const raw = value.trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return parseRunOutputFiles(parsed)
  } catch {
    return raw.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
  }
}

function normalizedLocalPath(value = '') {
  const text = String(value || '').trim().replace(/\\/g, '/')
  if (!text) return ''
  return text.length > 1 ? text.replace(/\/+$/, '') : text
}

function pathInsideWorkspace(path = '', workspaceDir = '') {
  const candidate = normalizedLocalPath(path)
  const root = normalizedLocalPath(workspaceDir)
  return Boolean(candidate && root && candidate !== root && candidate.startsWith(`${root}/`))
}

export function rebaseBalaMaterialRowsToWorkspace({ rows = [], outputFiles = [], workspaceDir = '' } = {}) {
  const packageDir = parseRunOutputFiles(outputFiles)
    .map(normalizedLocalPath)
    .find(path => pathInsideWorkspace(path, workspaceDir) && !/\.(?:xlsx?|csv|json)$/i.test(path))
  if (!packageDir) return []

  return (rows || []).map((row) => {
    if (!row || typeof row !== 'object') return row
    const localPath = normalizedLocalPath(row['本地文件'] || row.local_file)
    if (!localPath) return { ...row }
    const styleCode = styleCodeFromRow(row, localPath)
    const sourceType = assetSourceTypeFromRow(row)
    const sourceFolder = sourceType === 'model' ? '01_模拍原图' : (sourceType === 'detail' ? '02_商品细节图' : '')
    const filename = compact(row['文件名'] || row.filename || filenameFromPath(localPath))
    const tailMatch = localPath.match(/(?:^|\/)(\d{12})\/(01_模拍原图|02_商品细节图)\/(.+)$/)
    const relativePath = tailMatch
      ? `${tailMatch[1]}/${tailMatch[2]}/${tailMatch[3]}`
      : [styleCode, sourceFolder, filename].filter(Boolean).join('/')
    const rebasedPath = relativePath ? `${packageDir}/${relativePath}` : localPath
    return {
      ...row,
      本地文件: rebasedPath,
      local_file: rebasedPath,
    }
  })
}

export function latestRunForTaskData(payload = {}, preferredRunId = '') {
  const runs = Array.isArray(payload?.runs) ? payload.runs : []
  const target = String(preferredRunId || '').trim()
  if (target) {
    const matched = runs.find(run => String(run?.id || run?.run_id || '').trim() === target)
    if (matched) return matched
  }
  return runs[0] || null
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function styleCodeFromRow(row = {}, fallbackPath = '') {
  const explicit = compact(row['输入款号'] || row['款号'] || row.style_code)
  if (explicit) return explicit
  const match = String(fallbackPath || '').match(/\b(\d{12})\b/)
  return match ? match[1] : 'unknown'
}

function assetRole(sourceType = '') {
  if (sourceType === 'model') return '模拍'
  if (sourceType === 'detail') return '细节'
  return '素材'
}

function assetSourceTypeFromRow(row = {}) {
  const text = compact(row['素材来源'] || row.source_type)
  if (text.includes('模拍')) return 'model'
  if (text.includes('细节') || text.includes('商品') || text.includes('平拍')) return 'detail'
  return 'other'
}

function filenameFromPath(value = '') {
  return String(value || '').split('/').pop().split('\\').pop()
}

function normalizeBatchAsset(asset = {}) {
  const sourceType = compact(asset.source_type || asset.sourceType || 'other') || 'other'
  return {
    id: compact(asset.id || asset.asset_id || asset.path || asset.filename),
    role: assetRole(sourceType),
    sourceType,
    name: compact(asset.filename || filenameFromPath(asset.path) || asset.id),
    filename: compact(asset.filename || filenameFromPath(asset.path)),
    path: compact(asset.path),
    imageUrl: compact(asset.image_url || asset.imageUrl),
    thumbnailUrl: compact(asset.thumbnail_url || asset.thumbnailUrl),
    selected: asset.selected === true,
    downloadResult: compact(asset.download_result || asset.downloadResult || '已下载'),
    action: compact(asset.action),
    note: compact(asset.note),
    fileSizeMb: asset.file_size_mb || asset.fileSizeMb || '',
    folder: compact(asset.folder || asset.cloud_folder || ''),
    versions: [],
  }
}

function downloadedAssetForMaterial(row = {}) {
  const localPath = compact(row['本地文件'] || row.local_file)
  const downloadResult = compact(row['下载结果'] || row.download_result)
  if (!localPath || ['已跳过', '失败', '下载失败'].includes(downloadResult)) return null
  const sourceType = assetSourceTypeFromRow(row)
  const styleCode = styleCodeFromRow(row, localPath)
  const filename = compact(row['文件名'] || row.filename || filenameFromPath(localPath))
  return {
    id: `${styleCode}-${sourceType}-row-${localPath}`,
    styleCode,
    role: assetRole(sourceType),
    sourceType,
    name: filename,
    filename,
    path: localPath,
    imageUrl: compact(row.image_url || row.imageUrl),
    thumbnailUrl: compact(row.thumbnail_url || row.thumbnailUrl),
    selected: false,
    downloadResult: downloadResult || '已下载',
    action: compact(row['处理动作'] || row.action),
    note: compact(row['备注'] || row.note),
    fileSizeMb: row['文件大小MB'] || row.file_size_mb || '',
    folder: compact(row['选择文件夹'] || row.folder || row.cloud_folder),
    versions: [],
  }
}

function skippedRowForMaterial(row = {}) {
  const localPath = compact(row['本地文件'] || row.local_file)
  const downloadResult = compact(row['下载结果'] || row.download_result)
  if (localPath && !['已跳过', '失败', '下载失败'].includes(downloadResult)) return null
  const sourceType = assetSourceTypeFromRow(row)
  const styleCode = styleCodeFromRow(row, localPath)
  const note = compact(row['备注'] || row.note || downloadResult)
  return {
    id: `${styleCode}-${sourceType}-skip-${compact(row['文件名'] || row['云盘路径'] || note)}`,
    styleCode,
    sourceType,
    role: assetRole(sourceType),
    name: compact(row['文件名'] || row.filename || '未下载素材'),
    action: compact(row['处理动作'] || row.action || '未处理'),
    downloadResult,
    note,
  }
}

export function normalizeBalaMaterialGroups({ batch = null, rows = [], fallbackCodes = [] } = {}) {
  const byStyle = new Map()
  const representedPaths = new Set()
  const ensure = (styleCode) => {
    const key = compact(styleCode) || 'unknown'
    if (!byStyle.has(key)) {
      byStyle.set(key, {
        styleCode: key,
        modelPhotos: [],
        detailPhotos: [],
        otherPhotos: [],
        skippedRows: [],
        errors: [],
        generated: [],
      })
    }
    return byStyle.get(key)
  }

  for (const code of fallbackCodes || []) ensure(code)

  const preserveBatchSelection = compact(batch?.status) === 'selected'
  for (const item of batch?.items || []) {
    const group = ensure(item?.style_code || item?.styleCode)
    for (const rawAsset of item?.assets || []) {
      const asset = normalizeBatchAsset(rawAsset)
      asset.selected = preserveBatchSelection && asset.selected
      if (!asset.id) continue
      if (asset.path) representedPaths.add(asset.path)
      if (asset.sourceType === 'model') group.modelPhotos.push(asset)
      else if (asset.sourceType === 'detail') group.detailPhotos.push(asset)
      else group.otherPhotos.push(asset)
    }
  }

  for (const row of rows || []) {
    const downloaded = downloadedAssetForMaterial(row)
    if (downloaded && !representedPaths.has(downloaded.path)) {
      representedPaths.add(downloaded.path)
      const group = ensure(downloaded.styleCode)
      if (downloaded.sourceType === 'model') group.modelPhotos.push(downloaded)
      else if (downloaded.sourceType === 'detail') group.detailPhotos.push(downloaded)
      else group.otherPhotos.push(downloaded)
    }
    const skipped = skippedRowForMaterial(row)
    if (!skipped) continue
    const group = ensure(skipped.styleCode)
    group.skippedRows.push(skipped)
    if (skipped.downloadResult && skipped.downloadResult !== '已跳过') {
      group.errors.push(skipped)
    }
  }

  return Array.from(byStyle.values())
}

function progressPercent(completed, total) {
  if (!(total > 0)) return 0
  return Math.max(0, Math.min(100, Math.round((Math.min(completed, total) / total) * 100)))
}

export function normalizeBalaMaterialProgress(live = {}) {
  const searchTotal = Number(live?.search_total_codes || live?.total || 0)
  const searchCompleted = Number(live?.search_completed_codes || live?.current || 0)
  const downloadTotal = Number(live?.download_total || live?.download_total_files || 0)
  const downloadCompleted = Number(live?.download_completed || live?.download_completed_files || 0)
  return {
    searchTotal,
    searchCompleted,
    searchProgress: progressPercent(searchCompleted, searchTotal),
    downloadTotal,
    downloadCompleted,
    downloadProgress: progressPercent(downloadCompleted, downloadTotal),
    downloaded: Number(live?.download_success || live?.download_success_files || live?.records || 0),
    failed: Number(live?.download_failed || live?.download_failed_files || 0),
  }
}

export function selectNewTaskRun(status = {}, previousRunId = '') {
  const previous = String(previousRunId || '').trim()
  const candidates = [
    { source: 'live', snapshot: status?.live, id: status?.live?.run_id },
    { source: 'last_run', snapshot: status?.last_run, id: status?.last_run?.id || status?.last_run?.run_id },
  ]
  for (const candidate of candidates) {
    const runId = String(candidate.id || '').trim()
    if (!runId || runId === previous) continue
    return {
      runId,
      status: normalizeWorkflowStageStatus(candidate.snapshot?.status),
      source: candidate.source,
      snapshot: candidate.snapshot,
    }
  }
  return null
}

export async function waitForNewTaskRun({
  getStatus,
  previousRunId = '',
  attempts = 40,
  delayMs = 300,
  sleepFn = ms => new Promise(resolve => setTimeout(resolve, ms)),
  errorMessage = '任务未成功启动，请重试。',
} = {}) {
  if (typeof getStatus !== 'function') throw new TypeError('getStatus must be a function')
  const maxAttempts = Math.max(1, Number(attempts) || 1)
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = selectNewTaskRun(await getStatus(), previousRunId)
    if (candidate) return candidate
    if (attempt + 1 < maxAttempts) await sleepFn(Math.max(0, Number(delayMs) || 0))
  }
  throw new Error(errorMessage)
}

export function summarizeBalaMaterialGroups(groups = []) {
  const summary = {
    styleCount: 0,
    modelCount: 0,
    detailCount: 0,
    selectedCount: 0,
    skippedCount: 0,
    failedCount: 0,
  }
  for (const group of groups || []) {
    summary.styleCount += 1
    summary.modelCount += (group.modelPhotos || []).length
    summary.detailCount += (group.detailPhotos || []).length
    summary.selectedCount += [...(group.modelPhotos || []), ...(group.detailPhotos || [])].filter(asset => asset.selected).length
    summary.skippedCount += (group.skippedRows || []).length
    summary.failedCount += (group.errors || []).length
  }
  return summary
}

export function normalizeWorkflowStageStatus(value = '') {
  const status = String(value || '').trim().toLowerCase()
  if (['queued', 'running', 'pausing', 'paused', 'stopping'].includes(status)) return 'running'
  if (['done', 'completed', 'success'].includes(status)) return 'done'
  if (['partial', 'partial_failed'].includes(status)) return 'partial'
  if (['error', 'failed', 'failure'].includes(status)) return 'failed'
  if (['stopped', 'cancelled', 'canceled'].includes(status)) return 'stopped'
  return 'idle'
}

export function isSeedancePrivacyProtectionError(error) {
  const message = String(error?.message || error?.error || error || '')
  return message.includes('InputImageSensitiveContentDetected.PrivacyInformation')
}

export function isActiveWorkflowStatus(value = '') {
  return normalizeWorkflowStageStatus(value) === 'running'
}

export function parseBalaMaterialBoardUrl(url = '') {
  try {
    const parsed = new URL(String(url || ''))
    if (!parsed.pathname.includes('/bala-ai-video-materials/')) return null
    const parts = parsed.pathname.split('/').filter(Boolean)
    const batchId = parts[parts.length - 1] || ''
    const token = parsed.searchParams.get('token') || ''
    if (!batchId || !token) return null
    return { batchId, token }
  } catch {
    return null
  }
}

export function parseBalaReviewBoardUrl(url = '') {
  try {
    const parsed = new URL(String(url || ''))
    if (!parsed.pathname.includes('/bala-ai-video-review/')) return null
    const parts = parsed.pathname.split('/').filter(Boolean)
    const batchId = parts[parts.length - 1] || ''
    const token = parsed.searchParams.get('token') || ''
    if (!batchId || !token) return null
    return { batchId, token }
  } catch {
    return null
  }
}

export function buildBalaVideoStageRequest(exportResult = {}) {
  const next = exportResult?.next_task || {}
  return {
    adapterId: String(next.adapter_id || 'bala-ai-video-assistant'),
    taskId: String(next.task_id || 'qn_img2video_batch'),
    params: next.params && typeof next.params === 'object' ? next.params : {},
  }
}

export function summarizeBalaReviewBatch(batch = {}) {
  const summary = {
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    generating: 0,
    failed: 0,
  }
  for (const item of batch?.items || []) {
    for (const asset of item?.assets || []) {
      if (asset?.kind !== 'ai') continue
      summary.total += 1
      const status = String(asset.status || 'pending')
      if (Object.prototype.hasOwnProperty.call(summary, status)) summary[status] += 1
    }
  }
  return summary
}

export function normalizeBalaReviewStatus(value = '') {
  const status = String(value || '').trim()
  if (status === 'approved') return 'approved'
  if (status === 'rejected') return 'rejected'
  if (status === 'retry' || status === 'retry_requested') return 'retry'
  if (status === 'generating' || status === 'running' || status === 'queued') return 'generating'
  if (status === 'failed' || status === 'error') return 'failed'
  return 'pending'
}

export function normalizeBalaReviewBatchStyles(batch = {}) {
  return (batch?.items || []).map((item) => {
    const styleCode = compact(item?.style_code || item?.styleCode || 'unknown')
    const sourceAssets = []
    const assets = []
    for (const rawAsset of item?.assets || []) {
      const kind = compact(rawAsset?.kind || 'ai')
      const base = {
        id: compact(rawAsset?.id),
        label: compact(rawAsset?.filename || rawAsset?.label || rawAsset?.id || '图片'),
        action: operationLabel(rawAsset?.operation_type || rawAsset?.operationType),
        operationType: normalizeOperationType(rawAsset?.operation_type || rawAsset?.operationType),
        status: normalizeBalaReviewStatus(rawAsset?.status),
        meta: compact(rawAsset?.review_note || rawAsset?.prompt || rawAsset?.model_id || rawAsset?.modelId),
        path: compact(rawAsset?.path || rawAsset?.source_path || rawAsset?.sourcePath),
        imageUrl: compact(rawAsset?.image_url || rawAsset?.imageUrl),
        sourcePath: compact(rawAsset?.source_path || rawAsset?.sourcePath),
        sourceAssetId: compact(rawAsset?.source_asset_id || rawAsset?.sourceAssetId),
        jobUid: compact(rawAsset?.job_uid || rawAsset?.jobUid),
        runUid: compact(rawAsset?.run_uid || rawAsset?.runUid),
        kind,
      }
      if (!base.id) continue
      if (kind === 'ai') {
        assets.push({
          ...base,
          label: base.label === base.id ? `${base.action.replace(/^AI/, '')} ${String(assets.length + 1).padStart(2, '0')}` : base.label,
        })
      } else {
        sourceAssets.push({
          ...base,
          role: kind === 'origin' ? '原图' : '参考图',
          name: base.label,
          sourceType: kind === 'origin' ? 'model' : 'detail',
        })
      }
    }
    return { styleCode, assets, sourceAssets }
  }).filter(item => item.assets.length || item.sourceAssets.length)
}

export function normalizeOperationType(value = '') {
  const text = compact(value).toLowerCase()
  if (['background_swap', 'background', '换背景', 'ai换背景'].includes(text)) return 'background_swap'
  if (['outfit_swap', 'outfit', '换装', 'ai换装'].includes(text)) return 'outfit_swap'
  if (['pose_swap', 'pose', '换姿势', 'ai换姿势'].includes(text)) return 'pose_swap'
  return 'face_swap'
}

export function operationLabel(value = '') {
  const operationType = normalizeOperationType(value)
  if (operationType === 'background_swap') return 'AI 换背景'
  if (operationType === 'outfit_swap') return 'AI 换装'
  if (operationType === 'pose_swap') return 'AI 换姿势'
  return 'AI 换脸'
}

export function normalizeBalaTemplateCatalog(payload = {}) {
  const templates = Array.isArray(payload?.templates) ? payload.templates : (Array.isArray(payload?.items) ? payload.items : [])
  return templates.map((item, index) => {
    const id = compact(item?.id || item?.templateId || item?.模板ID)
    if (!id) return null
    const slotDescription = compact(item?.slotDescription || item?.slot_description || item?.槽位说明)
    return {
      id,
      templateId: id,
      index: Number(item?.index || item?.序号 || index + 1),
      title: compact(item?.title || item?.模板标题 || id),
      description: compact(item?.description || item?.描述 || slotDescription || '软件管家模板未返回描述'),
      slotDescription,
      type: compact(item?.type || item?.类型 || 'action'),
      ratio: compact(item?.ratio || item?.比例 || '3:4'),
      duration: Number(item?.duration || item?.时长秒 || item?.durationSeconds || 0),
      video: compact(item?.localPreviewVideo || item?.local_preview_video || item?.本地预览视频 || item?.video || item?.videoUrl),
      cover: compact(item?.localCoverImage || item?.local_cover_image || item?.本地封面 || item?.cover || item?.coverUrl),
      remoteVideo: compact(item?.videoUrl || item?.远程预览视频),
      remoteCover: compact(item?.coverUrl || item?.远程封面),
      slots: Array.isArray(item?.slots) ? item.slots : [],
    }
  }).filter(Boolean)
}

export function collectVideoResultRows(payload = {}) {
  const rows = []
  const appendRows = (value) => {
    if (Array.isArray(value)) {
      for (const row of value) {
        if (row && typeof row === 'object') rows.push(row)
      }
    }
  }
  appendRows(payload?.rows)
  appendRows(payload?.data)
  appendRows(payload?.records)
  appendRows(payload?.result?.rows)
  appendRows(payload?.result?.data)
  appendRows(payload?.meta?.results)
  return rows
}

export function normalizeBalaVideoResultRows(rows = [], fallbackTask = {}) {
  return (rows || []).map((row, index) => {
    const result = compact(row?.执行结果 || row?.result || row?.状态 || row?.status)
    const localPath = compact(row?.本地视频文件 || row?.本地文件 || row?.local_video_path || row?.localVideoPath)
    const taskId = compact(row?.视频任务ID || row?.提交任务ID || row?.任务ID || row?.task_id || row?.taskId || fallbackTask?.id)
    const failed = /失败|超时|错误|failed|error|timeout/i.test(result)
    const done = Boolean(localPath) || /成功|已下载|已生成|completed|succeeded/i.test(result)
    return {
      id: compact(row?.id || taskId || `${fallbackTask?.id || 'video-result'}-${index + 1}`),
      styleCode: compact(row?.款号 || row?.style_code || row?.styleCode || fallbackTask?.styleCode),
      template: compact(row?.模板标题 || row?.模板名称 || row?.模板ID || row?.template || fallbackTask?.template?.title || '不选模板'),
      provider: compact(row?.供应商 || row?.provider || fallbackTask?.providerLabel || fallbackTask?.provider || '软件管家'),
      taskId,
      status: failed ? '失败' : (done ? '已完成' : (result || '运行中')),
      progress: failed ? 100 : (done ? 100 : Number(row?.progress || 60)),
      path: localPath || compact(row?.视频URL || row?.video_url || row?.videoUrl || fallbackTask?.outputDir),
      error: failed ? compact(row?.备注 || row?.note || row?.error || result) : '',
      raw: row,
    }
  })
}

export function collectDownloadedMaterialRows(payload = {}) {
  const rows = []
  const appendRows = (value) => {
    if (Array.isArray(value)) {
      for (const row of value) {
        if (row && typeof row === 'object') rows.push(row)
      }
    }
  }
  appendRows(payload?.rows)
  appendRows(payload?.data)
  appendRows(payload?.records)
  appendRows(payload?.result?.rows)
  appendRows(payload?.result?.data)
  return rows.filter(row =>
    String(row?.本地文件 || row?.local_file || '').trim()
    && !['已跳过', '失败', '下载失败'].includes(String(row?.下载结果 || '').trim())
  )
}
