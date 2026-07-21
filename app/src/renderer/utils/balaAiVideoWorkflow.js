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

const LEGACY_BALA_BUSINESS_MANAGER_NAME = ['软件', '管家'].join('')

function balaPreviewValue(value = '') {
  return String(value || '').trim()
}

export function isBalaVideoFilePath(path = '') {
  return /\.(?:mp4|m4v|mov|webm)(?:$|[?#])/i.test(balaPreviewValue(path))
}

function balaLocalFileUrl(path = '') {
  const value = balaPreviewValue(path)
  if (!value || !isBalaVideoFilePath(value)) return ''
  if (/^(https?:|data:|blob:|file:)/i.test(value)) return value
  const normalized = value.replace(/\\/g, '/')
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  const encoded = withLeadingSlash
    .split('/')
    .map(segment => (/^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/')
  return `file://${encoded}`
}

export function resolveBalaAssetPreviewSource(asset = {}, {
  localPreviews = {},
  thumbnail = false,
  resolveRemote = value => value,
} = {}) {
  const remoteCandidate = thumbnail
    ? (asset.thumbnailUrl || asset.thumbnail_url || asset.imageUrl || asset.image_url)
    : (asset.imageUrl || asset.image_url)
  const remote = balaPreviewValue(resolveRemote(remoteCandidate))
  if (remote) return remote
  const localPath = balaPreviewValue(asset.path || asset.previewPath)
  return balaPreviewValue(localPreviews?.[localPath])
}

export function resolveBalaVersionPreviewSource(version = {}, source = {}, {
  resolvePreview = asset => resolveBalaAssetPreviewSource(asset),
  brokenSources = {},
} = {}) {
  for (const asset of [version, source]) {
    const preview = balaPreviewValue(resolvePreview(asset))
    if (preview && !brokenSources?.[preview]) return preview
  }
  return ''
}

export function balaMaterialPanelControl(expanded) {
  return expanded
    ? { label: '收起', ariaLabel: '向左收起找图面板', direction: 'left' }
    : { label: '展开', ariaLabel: '向右展开找图面板', direction: 'right' }
}

export function resolveBalaVideoPlaybackSource(result = {}, { resolveRemote = value => value } = {}) {
  const remote = balaPreviewValue(resolveRemote(result.videoUrl || result.video_url))
  if (remote) return remote
  return balaLocalFileUrl(result.path || result.local_video_path)
}

export function migrateBalaBusinessManagerText(value = '') {
  return String(value || '').split(LEGACY_BALA_BUSINESS_MANAGER_NAME).join('生意管家')
}

export function normalizeBalaVideoTaskProvider(value = '') {
  const provider = String(value || '').trim()
  if (provider === 'qn' || provider === BALA_QN_VIDEO_TASK_ID) return 'qn'
  if (migrateBalaBusinessManagerText(provider).includes('生意管家')) return 'qn'
  return provider
}

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

export function toBalaBridgeStringArray(value = []) {
  return Array.from(value || [], item => String(item || '').trim()).filter(Boolean)
}

export function hasGeneratingBalaReviewAssets(batch = {}) {
  return (Array.isArray(batch?.items) ? batch.items : []).some(item => (
    (Array.isArray(item?.assets) ? item.assets : []).some(asset => (
      ['generating', 'running', 'queued', 'pending_generation'].includes(
        String(asset?.status || '').trim().toLowerCase(),
      )
    ))
  ))
}

export function selectVisibleEditableVersions(source = {}, selectedOnly = false) {
  return (source?.versions || []).filter(version => (
    !version?.deleted && (!selectedOnly || Boolean(version.editSelected))
  ))
}

export function selectEditableSourcesForStyle(style = {}, selectedOnly = false) {
  return (style?.modelPhotos || []).filter((asset) => {
    const versions = selectVisibleEditableVersions(asset)
    if (!asset?.selected && !versions.length) return false
    if (!selectedOnly) return true
    return Boolean(asset.editSelected) || versions.some(version => version.editSelected)
  })
}

export function filterBalaModelLibraryItems(items = [], { age = '', gender = '' } = {}) {
  const expectedAge = String(age || '').trim()
  const expectedGender = String(gender || '').trim()
  return (items || []).filter(item => (
    (!expectedAge || String(item?.ageLabel || '').trim() === expectedAge)
    && (!expectedGender || String(item?.gender || '').trim() === expectedGender)
  ))
}

export function formatBalaModelDisplayLabel(item = {}) {
  return [
    item?.age_label || item?.ageLabel,
    item?.gender,
    item?.expression,
  ].map(value => String(value || '').trim()).filter(Boolean).join(' / ')
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

export function isBalaAiNamedMaterial(value = '') {
  return /AI/i.test(compact(filenameFromPath(value)))
}

function materialFilenameKey(asset = {}) {
  return compact(asset?.filename || asset?.name || filenameFromPath(asset?.path)).toLocaleLowerCase()
}

export function sortBalaMaterialAssets(assets = []) {
  return [...(assets || [])].sort((left, right) => {
    const selection = Number(Boolean(right?.selected)) - Number(Boolean(left?.selected))
    if (selection) return selection
    return materialFilenameKey(left).localeCompare(materialFilenameKey(right), 'zh-Hans-CN', { numeric: true })
  })
}

function mergeMaterialAsset(existing = {}, incoming = {}) {
  return {
    ...existing,
    ...incoming,
    // Repeated searches may place the same filename under a different batch
    // directory. Keep the first usable local file so a later recall cannot
    // turn a stable card into a duplicate card or a broken preview.
    id: compact(existing?.id) || compact(incoming?.id),
    path: compact(existing?.path) || compact(incoming?.path),
    name: compact(existing?.name) || compact(incoming?.name),
    filename: compact(existing?.filename) || compact(incoming?.filename),
    selected: Boolean(existing?.selected || incoming?.selected),
    editSelected: Boolean(existing?.editSelected || incoming?.editSelected),
    versions: mergeBalaWorkspaceVersions(existing?.versions, incoming?.versions),
  }
}

export function mergeBalaMaterialAssets(existingAssets = [], incomingAssets = []) {
  const merged = (existingAssets || []).map(asset => ({ ...asset, versions: [...(asset?.versions || [])] }))
  for (const candidate of incomingAssets || []) {
    const candidatePath = compact(candidate?.path)
    const candidateId = compact(candidate?.id)
    const candidateFilename = materialFilenameKey(candidate)
    const index = merged.findIndex((asset) => (
      (candidatePath && compact(asset?.path) === candidatePath)
      || (candidateId && compact(asset?.id) === candidateId)
      || (candidateFilename && materialFilenameKey(asset) === candidateFilename)
    ))
    if (index < 0) merged.push({ ...candidate, versions: [...(candidate?.versions || [])] })
    else merged[index] = mergeMaterialAsset(merged[index], candidate)
  }
  return merged
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
    selected: asset.selected === true || isBalaAiNamedMaterial(asset.filename || filenameFromPath(asset.path)),
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
    selected: isBalaAiNamedMaterial(filename),
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

  for (const item of batch?.items || []) {
    const group = ensure(item?.style_code || item?.styleCode)
    for (const rawAsset of item?.assets || []) {
      const asset = normalizeBatchAsset(rawAsset)
      // AI-tagged local material is an explicit operator signal: it must stay
      // selected on first recall as well as after a batch is restored.
      asset.selected = Boolean(asset.selected || isBalaAiNamedMaterial(asset.filename || asset.path))
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

  return Array.from(byStyle.values()).map(dedupeBalaMaterialGroup)
}

function dedupeBalaMaterialGroup(group = {}) {
  const result = {
    ...group,
    modelPhotos: mergeBalaMaterialAssets([], group.modelPhotos),
    detailPhotos: mergeBalaMaterialAssets([], group.detailPhotos),
    otherPhotos: mergeBalaMaterialAssets([], group.otherPhotos),
  }
  // A workspace can contain a legacy batch folder plus the new direct style
  // folder. Cards are business-facing by style and filename, not by where a
  // particular recall happened to save the same image.
  const seenFilenames = new Set()
  for (const key of ['modelPhotos', 'detailPhotos', 'otherPhotos']) {
    result[key] = result[key].filter((asset) => {
      asset.selected = Boolean(asset.selected || isBalaAiNamedMaterial(asset.filename || asset.name || asset.path))
      const filename = materialFilenameKey(asset)
      if (!filename || !seenFilenames.has(filename)) {
        if (filename) seenFilenames.add(filename)
        return true
      }
      return false
    })
  }
  return result
}

/**
 * Incorporate a later material-download batch without discarding prior style
 * workspaces, user selections, or AI-edit history.
 */
export function mergeBalaMaterialGroups(existingGroups = [], incomingGroups = []) {
  const byStyle = new Map()
  const addGroup = (group = {}) => {
    const styleCode = compact(group.styleCode || group.style_code)
    if (!styleCode) return
    const existing = byStyle.get(styleCode)
    if (!existing) {
      byStyle.set(styleCode, dedupeBalaMaterialGroup({
        ...group,
        styleCode,
        skippedRows: [...(group.skippedRows || [])],
        errors: [...(group.errors || [])],
        generated: [...(group.generated || [])],
      }))
      return
    }
    existing.modelPhotos = mergeBalaMaterialAssets(existing.modelPhotos, group.modelPhotos)
    existing.detailPhotos = mergeBalaMaterialAssets(existing.detailPhotos, group.detailPhotos)
    existing.otherPhotos = mergeBalaMaterialAssets(existing.otherPhotos, group.otherPhotos)
    existing.skippedRows = [...existing.skippedRows, ...(group.skippedRows || [])]
    existing.errors = [...existing.errors, ...(group.errors || [])]
    existing.generated = [...existing.generated, ...(group.generated || [])]
  }
  for (const group of existingGroups || []) addGroup(group)
  for (const group of incomingGroups || []) addGroup(group)
  return [...byStyle.values()].map(dedupeBalaMaterialGroup)
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

export function qnTerminalRunFailure(snapshot = {}) {
  const status = normalizeWorkflowStageStatus(snapshot?.status)
  if (!['failed', 'stopped', 'partial'].includes(status)) return ''
  const explicit = String(snapshot?.error || snapshot?.message || '').trim()
  if (explicit) return explicit
  if (status === 'stopped') return '生意管家视频任务已停止'
  if (status === 'partial') return '生意管家视频任务部分失败'
  return '生意管家视频任务失败'
}

export function isSeedancePrivacyProtectionError(error) {
  const message = String(error?.message || error?.error || error || '')
  return message.includes('InputImageSensitiveContentDetected.PrivacyInformation')
}

export function isActiveWorkflowStatus(value = '') {
  return normalizeWorkflowStageStatus(value) === 'running'
}

export function shouldCreateBalaVideoProviderRun(task = {}) {
  const providerTaskId = String(task?.providerTaskId || task?.runId || '').trim()
  if (!providerTaskId) return true
  const status = String(task?.status || '').trim().toLowerCase()
  return /失败|错误|failed|error/.test(status) || /待预检|预检完成/.test(status)
}

export function isBalaVideoTaskSubmitEligible(task = {}, result = {}) {
  const status = [task?.status, result?.status, result?.providerStatus]
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ')
  const hasGeneratedOutput = Boolean(
    String(result?.path || result?.local_video_path || result?.videoUrl || result?.video_url || '').trim(),
  )
  if (hasGeneratedOutput || /已下载|已生成|生成完成|已完成|downloaded|completed|succeeded/.test(status)) {
    return false
  }
  return shouldCreateBalaVideoProviderRun(task)
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
      if (!['origin', 'ai'].includes(asset?.kind)) continue
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

export function normalizeBalaReviewBatchStyles(batch = {}, { reviewBoardUrl = '' } = {}) {
  const resolvedReviewBoardUrl = compact(reviewBoardUrl || batch?.board_url || batch?.boardUrl)
  return (batch?.items || []).map((item) => {
    const styleCode = compact(item?.style_code || item?.styleCode || 'unknown')
    const sourceAssets = []
    const assets = []
    for (const rawAsset of item?.assets || []) {
      const kind = compact(rawAsset?.kind || 'ai')
      const operationType = kind === 'origin'
        ? 'origin'
        : kind === 'reference'
          ? 'reference'
          : normalizeOperationType(rawAsset?.operation_type || rawAsset?.operationType)
      const base = {
        id: compact(rawAsset?.id),
        remoteAssetId: compact(rawAsset?.id),
        label: compact(rawAsset?.filename || rawAsset?.label || rawAsset?.id || '图片'),
        action: kind === 'origin' ? '原图' : kind === 'reference' ? '素材' : operationLabel(operationType),
        operationType,
        status: normalizeBalaReviewStatus(rawAsset?.status),
        meta: compact(rawAsset?.review_note || rawAsset?.prompt || rawAsset?.model_id || rawAsset?.modelId),
        prompt: compact(rawAsset?.prompt || rawAsset?.background_prompt || rawAsset?.pose_prompt),
        path: compact(rawAsset?.path || rawAsset?.source_path || rawAsset?.sourcePath),
        imageUrl: compact(rawAsset?.image_url || rawAsset?.imageUrl),
        sourcePath: compact(rawAsset?.source_path || rawAsset?.sourcePath),
        sourceAssetId: compact(rawAsset?.source_asset_id || rawAsset?.sourceAssetId),
        jobUid: compact(rawAsset?.job_uid || rawAsset?.jobUid),
        runUid: compact(rawAsset?.run_uid || rawAsset?.runUid),
        reviewBoardUrl: resolvedReviewBoardUrl,
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

function balaWorkspaceVersionIdentity(asset = {}) {
  const jobUid = compact(asset.jobUid || asset.job_uid)
  if (jobUid) return `job-${jobUid}`
  const runUid = compact(asset.runUid || asset.run_uid)
  if (runUid) return `run-${runUid}`
  const path = compact(asset.previewPath || asset.path)
  if (path) return `path-${path}`
  return ''
}

export function mergeBalaWorkspaceVersions(existingVersions = [], remoteAssets = []) {
  const result = (existingVersions || []).map(version => ({ ...version }))
  for (const remoteAsset of remoteAssets || []) {
    const remoteAssetId = compact(remoteAsset.remoteAssetId || remoteAsset.id)
    const identity = balaWorkspaceVersionIdentity(remoteAsset)
    const operationType = normalizeOperationType(remoteAsset.operationType || remoteAsset.operation_type || remoteAsset.action)
    let index = result.findIndex(version => {
      const leftIdentity = balaWorkspaceVersionIdentity(version)
      return Boolean(identity && leftIdentity && identity === leftIdentity)
    })
    if (index < 0 && identity) {
      index = result.findIndex(version => (
        !balaWorkspaceVersionIdentity(version)
        && !compact(version.remoteAssetId)
        && normalizeOperationType(version.operationType || version.operation_type || version.action) === operationType
        && ['draft', 'running', 'queued', 'generating'].includes(compact(version.status).toLowerCase())
      ))
    }
    if (index < 0 && !identity && remoteAssetId) {
      index = result.findIndex(version => (
        compact(version.remoteAssetId || version.id) === remoteAssetId
        && !balaWorkspaceVersionIdentity(version)
      ))
    }
    const stableId = identity ? `${remoteAssetId || 'ai-result'}-${identity}` : (remoteAssetId || `ai-result-${result.length + 1}`)
    const next = {
      ...remoteAsset,
      id: stableId,
      remoteAssetId,
      operationType,
      previewPath: compact(remoteAsset.previewPath || remoteAsset.path),
      jobUid: compact(remoteAsset.jobUid || remoteAsset.job_uid),
      runUid: compact(remoteAsset.runUid || remoteAsset.run_uid),
    }
    if (index >= 0) result[index] = { ...result[index], ...next }
    else result.push(next)
  }
  return result
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

function reviewAssetStatus(value = '') {
  const normalized = normalizeBalaReviewStatus(value)
  return normalized === 'generating' || normalized === 'failed' ? normalized : normalized
}

export function buildBalaReviewWorkspaceStyles(styleWorkspaces = []) {
  return (styleWorkspaces || []).map((style) => {
    const assets = []
    for (const source of style?.modelPhotos || []) {
      if (!source?.selected && !(source?.versions || []).length) continue
      assets.push({
        id: compact(source.id || source.path || source.name),
        remoteAssetId: compact(source.remoteAssetId || source.remote_asset_id),
        label: compact(source.name || source.filename || '原图'),
        action: '原图',
        operationType: 'origin',
        status: normalizeBalaReviewStatus(source.reviewStatus || source.status),
        meta: compact(source.note || source.action || '第一步已选模拍图'),
        path: compact(source.path),
        imageUrl: compact(source.imageUrl || source.image_url),
        sourcePath: compact(source.path),
        sourceAssetId: compact(source.id),
        reviewBoardUrl: compact(source.reviewBoardUrl || source.review_board_url),
        kind: 'origin',
      })
      for (const version of source?.versions || []) {
        if (version?.deleted) continue
        assets.push({
          id: compact(version.id || version.previewPath || version.path),
          remoteAssetId: compact(version.remoteAssetId || version.remote_asset_id),
          label: compact(version.label || 'AI 结果'),
          action: operationLabel(version.operationType || version.operation_type || version.action),
          operationType: normalizeOperationType(version.operationType || version.operation_type || version.action),
          status: normalizeBalaReviewStatus(version.reviewStatus || version.status),
          meta: compact(version.meta || version.prompt),
          prompt: compact(version.prompt || version.meta),
          path: compact(version.previewPath || version.path),
          imageUrl: compact(version.imageUrl || version.image_url),
          sourcePath: compact(source.path),
          sourceAssetId: compact(source.id),
          jobUid: compact(version.jobUid || version.job_uid),
          runUid: compact(version.runUid || version.run_uid),
          reviewBoardUrl: compact(version.reviewBoardUrl || version.review_board_url),
          kind: 'ai',
        })
      }
    }
    const sourceAssets = (style?.detailPhotos || []).map(asset => ({
      id: compact(asset.id || asset.path || asset.name),
      label: compact(asset.name || asset.filename || '素材'),
      name: compact(asset.name || asset.filename || '素材'),
      role: '参考图',
      sourceType: 'detail',
      status: normalizeBalaReviewStatus(asset.reviewStatus || asset.status),
      path: compact(asset.path),
      imageUrl: compact(asset.imageUrl || asset.image_url),
      kind: 'reference',
    }))
    return {
      styleCode: compact(style?.styleCode || style?.style_code),
      assets: mergeBalaMaterialAssets([], assets),
      sourceAssets: mergeBalaMaterialAssets([], sourceAssets),
    }
  }).filter(style => style.styleCode && (style.assets.length || style.sourceAssets.length))
}

function reviewAssetKind(asset = {}) {
  if (asset.kind === 'origin' || asset.operationType === 'origin' || asset.sourceType === 'model') return 'origin'
  if (asset.kind === 'reference' || asset.sourceType === 'detail') return 'reference'
  return 'ai'
}

function sameReviewAsset(left = {}, right = {}) {
  const kind = reviewAssetKind(left)
  if (kind !== reviewAssetKind(right)) return false
  if (kind === 'ai') {
    const leftJobUid = compact(left.jobUid || left.job_uid)
    const rightJobUid = compact(right.jobUid || right.job_uid)
    if (leftJobUid && rightJobUid) return leftJobUid === rightJobUid
    const leftBoard = compact(left.reviewBoardUrl || left.review_board_url)
    const rightBoard = compact(right.reviewBoardUrl || right.review_board_url)
    const leftRemoteId = compact(left.remoteAssetId || left.remote_asset_id || left.id)
    const rightRemoteId = compact(right.remoteAssetId || right.remote_asset_id || right.id)
    if (leftBoard && rightBoard && leftRemoteId && rightRemoteId) {
      return leftBoard === rightBoard && leftRemoteId === rightRemoteId
    }
  }
  const leftId = compact(left.id)
  const rightId = compact(right.id)
  if (leftId && rightId && leftId === rightId) return true
  const leftPath = compact(left.path || left.previewPath || left.sourcePath)
  const rightPath = compact(right.path || right.previewPath || right.sourcePath)
  if (leftPath && rightPath && leftPath === rightPath) return true
  const leftName = compact(left.label || left.name || left.filename || filenameFromPath(leftPath)).toLocaleLowerCase()
  const rightName = compact(right.label || right.name || right.filename || filenameFromPath(rightPath)).toLocaleLowerCase()
  return Boolean(leftName && rightName && leftName === rightName)
}

function mergeBalaReviewAssets(assets = []) {
  const result = []
  for (const candidate of assets || []) {
    const index = result.findIndex(asset => sameReviewAsset(asset, candidate))
    if (index < 0) result.push({ ...candidate })
    else result[index] = { ...result[index], ...candidate }
  }
  return result
}

function persistedBalaWorkspaceVersion(version = {}) {
  return {
    id: compact(version.id),
    remoteAssetId: compact(version.remoteAssetId || version.remote_asset_id),
    action: compact(version.action),
    operationType: normalizeOperationType(version.operationType || version.operation_type || version.action),
    label: compact(version.label),
    meta: compact(version.meta),
    prompt: compact(version.prompt),
    status: normalizeBalaReviewStatus(version.reviewStatus || version.status),
    sourceAssetId: compact(version.sourceAssetId || version.source_asset_id),
    sourcePath: compact(version.sourcePath || version.source_path),
    previewPath: compact(version.previewPath || version.path),
    imageUrl: compact(version.imageUrl || version.image_url),
    jobUid: compact(version.jobUid || version.job_uid),
    runUid: compact(version.runUid || version.run_uid),
    reviewBoardUrl: compact(version.reviewBoardUrl || version.review_board_url),
  }
}

export function serializeBalaImageWorkspaceState(styleWorkspaces = []) {
  return (styleWorkspaces || []).map(style => ({
    styleCode: compact(style?.styleCode || style?.style_code),
    modelPhotos: (style?.modelPhotos || []).map(source => ({
      id: compact(source?.id),
      path: compact(source?.path),
      reviewStatus: normalizeBalaReviewStatus(source?.reviewStatus || source?.status),
      remoteAssetId: compact(source?.remoteAssetId || source?.remote_asset_id),
      reviewBoardUrl: compact(source?.reviewBoardUrl || source?.review_board_url),
      versions: (source?.versions || [])
        .filter(version => !version?.deleted)
        .map(persistedBalaWorkspaceVersion),
    })).filter(source => source.id || source.path),
  })).filter(style => style.styleCode && style.modelPhotos.length)
}

export function restoreBalaImageWorkspaceState(styleWorkspaces = [], snapshot = []) {
  const savedStyles = new Map((snapshot || []).map(style => [compact(style?.styleCode || style?.style_code), style]))
  for (const style of styleWorkspaces || []) {
    const savedStyle = savedStyles.get(compact(style?.styleCode || style?.style_code))
    if (!savedStyle) continue
    for (const source of style?.modelPhotos || []) {
      const savedSource = (savedStyle.modelPhotos || []).find(candidate => (
        (compact(source?.id) && compact(source?.id) === compact(candidate?.id))
        || (compact(source?.path) && compact(source?.path) === compact(candidate?.path))
      ))
      if (!savedSource) continue
      source.reviewStatus = normalizeBalaReviewStatus(savedSource.reviewStatus)
      source.remoteAssetId = compact(savedSource.remoteAssetId || savedSource.remote_asset_id)
      source.reviewBoardUrl = compact(savedSource.reviewBoardUrl || savedSource.review_board_url)
      source.versions = mergeBalaWorkspaceVersions(source.versions, savedSource.versions)
    }
  }
  return styleWorkspaces
}

export function mergeBalaReviewWorkspaceStyles(localStyles = [], remoteStyles = []) {
  const remoteByStyle = new Map((remoteStyles || []).map(style => [compact(style.styleCode || style.style_code), style]))
  const merged = []
  const seenStyles = new Set()

  for (const localStyle of localStyles || []) {
    const styleCode = compact(localStyle.styleCode || localStyle.style_code)
    const remoteStyle = remoteByStyle.get(styleCode) || { assets: [], sourceAssets: [] }
    const remoteReviewAssets = [
      ...(remoteStyle.assets || []),
      ...(remoteStyle.sourceAssets || []).filter(asset => reviewAssetKind(asset) === 'origin'),
    ]
    const remoteReferences = (remoteStyle.sourceAssets || []).filter(asset => reviewAssetKind(asset) === 'reference')
    const usedReviewAssets = new Set()
    const usedReferences = new Set()

    const assets = (localStyle.assets || []).map((localAsset) => {
      const index = remoteReviewAssets.findIndex((remoteAsset, candidateIndex) => (
        !usedReviewAssets.has(candidateIndex) && sameReviewAsset(localAsset, remoteAsset)
      ))
      if (index < 0) return { ...localAsset }
      usedReviewAssets.add(index)
      return { ...localAsset, ...remoteReviewAssets[index] }
    })
    remoteReviewAssets.forEach((asset, index) => {
      if (!usedReviewAssets.has(index)) assets.push({ ...asset })
    })

    const sourceAssets = (localStyle.sourceAssets || []).map((localAsset) => {
      const index = remoteReferences.findIndex((remoteAsset, candidateIndex) => (
        !usedReferences.has(candidateIndex) && sameReviewAsset(localAsset, remoteAsset)
      ))
      if (index < 0) return { ...localAsset }
      usedReferences.add(index)
      return { ...localAsset, ...remoteReferences[index] }
    })
    remoteReferences.forEach((asset, index) => {
      if (!usedReferences.has(index)) sourceAssets.push({ ...asset })
    })

    merged.push({
      ...localStyle,
      styleCode,
      assets: mergeBalaReviewAssets(assets),
      sourceAssets: mergeBalaReviewAssets(sourceAssets),
    })
    seenStyles.add(styleCode)
  }

  for (const remoteStyle of remoteStyles || []) {
    const styleCode = compact(remoteStyle.styleCode || remoteStyle.style_code)
    if (!styleCode || seenStyles.has(styleCode)) continue
    merged.push({
      ...remoteStyle,
      styleCode,
      assets: mergeBalaReviewAssets([
        ...(remoteStyle.assets || []),
        ...(remoteStyle.sourceAssets || []).filter(asset => reviewAssetKind(asset) === 'origin'),
      ].map(asset => ({ ...asset }))),
      sourceAssets: mergeBalaReviewAssets((remoteStyle.sourceAssets || [])
        .filter(asset => reviewAssetKind(asset) === 'reference')
        .map(asset => ({ ...asset }))),
    })
  }
  return merged
}

function videoBusinessKind(asset = {}, fallback = '素材') {
  if (asset.kind === 'origin' || asset.sourceType === 'model') return '模拍'
  if (asset.kind === 'reference' || asset.sourceType === 'detail') return '素材'
  return operationLabel(asset.operationType || asset.operation_type || asset.action || fallback)
}

/**
 * Folder source (model / detail) from path conventions + explicit fields.
 * AI is a separate overlay flag — an AI result can still be model or detail.
 */
export function resolveVideoAssetTaxonomy(asset = {}, { folderHint = '' } = {}) {
  const path = compact(asset?.path || asset?.previewPath || asset?.sourcePath).replace(/\\/g, '/')
  const sourcePath = compact(asset?.sourcePath || asset?.source_path).replace(/\\/g, '/')
  const kindRaw = compact(asset?.kind)
  const kind = kindRaw.toLowerCase()
  const sourceTypeRaw = compact(asset?.sourceType || asset?.source_type || folderHint).toLowerCase()
  // normalizeOperationType('') defaults to face_swap — only normalize when explicitly set
  const rawOperation = compact(asset?.operationType || asset?.operation_type || asset?.action)
  const operationType = rawOperation ? normalizeOperationType(rawOperation) : ''
  const label = compact(asset?.label || asset?.name || asset?.action)

  const pathLooksDetail = (value = '') => (
    /02[_-]?商品细节|商品细节图|细节图|\/detail(?:s)?\//i.test(value)
  )
  const pathLooksModel = (value = '') => (
    /01[_-]?模拍|模拍原图|\/model(?:s)?\//i.test(value)
  )

  let sourceType = ''
  if (sourceTypeRaw === 'detail' || sourceTypeRaw === 'reference') sourceType = 'detail'
  else if (sourceTypeRaw === 'model' || sourceTypeRaw === 'origin') sourceType = 'model'
  else if (kind === 'reference' || kindRaw === '素材' || kindRaw === '细节图') sourceType = 'detail'
  else if (kind === 'origin' || kindRaw === '模拍' || kindRaw === '模特图' || kindRaw === '原图') sourceType = 'model'
  else if (pathLooksDetail(path) || pathLooksDetail(sourcePath)) sourceType = 'detail'
  else if (pathLooksModel(path) || pathLooksModel(sourcePath)) sourceType = 'model'
  else if (folderHint === 'detail') sourceType = 'detail'
  else if (folderHint === 'model') sourceType = 'model'
  else sourceType = 'model'

  // AI 是叠加属性：kind=ai / 有 job·run / 明确 AI 操作；原图 origin 不算 AI
  const isAi = kind !== 'origin' && Boolean(
    kind === 'ai'
    || sourceTypeRaw === 'ai'
    || asset?.isAi === true
    || asset?.is_ai === true
    || compact(asset?.jobUid || asset?.job_uid)
    || compact(asset?.runUid || asset?.run_uid)
    || (operationType && operationType !== 'origin')
    || /ai\s*结果|换脸|换背景|换装|换姿势|ai图/i.test(label)
  )

  return {
    sourceType, // model | detail — from folder / source
    isAi, // overlay attribute
    displayKind: isAi
      ? (sourceType === 'detail' ? 'AI·细节' : 'AI·模拍')
      : (sourceType === 'detail' ? '细节图' : '模特图'),
  }
}

export function buildBalaVideoAssetPool({ reviewStyle = {}, materialStyle = null } = {}) {
  const styleCode = compact(reviewStyle?.styleCode || reviewStyle?.style_code || materialStyle?.styleCode)
  const output = []
  const seenPaths = new Set()
  const append = (asset, { source = false, folderHint = '' } = {}) => {
    const status = reviewAssetStatus(asset?.status)
    if (['rejected', 'failed', 'generating'].includes(status)) return
    const path = compact(asset?.path || asset?.previewPath)
    if (!path || seenPaths.has(path)) return
    seenPaths.add(path)
    const rawId = compact(asset?.id || path)
    const taxonomy = resolveVideoAssetTaxonomy(asset, { folderHint })
    // Preserve structural kind for downstream: origin | reference | ai
    const structuralKind = taxonomy.isAi
      ? 'ai'
      : (taxonomy.sourceType === 'detail' ? 'reference' : 'origin')
    output.push({
      id: source ? `vasset-${styleCode}-source-${rawId}` : `vasset-${rawId}`,
      label: compact(asset?.label || asset?.name || asset?.filename || '图片'),
      kind: structuralKind,
      sourceType: taxonomy.sourceType,
      isAi: taxonomy.isAi,
      businessKind: videoBusinessKind({ ...asset, kind: structuralKind, sourceType: taxonomy.sourceType }),
      displayKind: taxonomy.displayKind,
      status,
      selected: status === 'approved',
      selectable: status === 'approved',
      path,
      sourcePath: compact(asset?.sourcePath || asset?.source_path),
      imageUrl: compact(asset?.imageUrl || asset?.image_url),
      thumbnailUrl: compact(asset?.thumbnailUrl || asset?.thumbnail_url),
      operationType: normalizeOperationType(asset?.operationType || asset?.operation_type || asset?.action),
      jobUid: compact(asset?.jobUid || asset?.job_uid),
      runUid: compact(asset?.runUid || asset?.run_uid),
    })
  }

  for (const asset of reviewStyle?.assets || []) append(asset)
  for (const asset of reviewStyle?.sourceAssets || []) append(asset, { source: true })

  for (const asset of materialStyle?.modelPhotos || []) {
    append({ ...asset, kind: 'origin', sourceType: 'model', status: asset.reviewStatus || 'pending' }, {
      source: true,
      folderHint: 'model',
    })
  }
  for (const asset of materialStyle?.detailPhotos || []) {
    append({ ...asset, kind: 'reference', sourceType: 'detail', status: asset.reviewStatus || 'pending' }, {
      source: true,
      folderHint: 'detail',
    })
  }
  return output
}

export function hasApprovedBalaVideoAsset(assets = []) {
  return (assets || []).some(asset => asset?.status === 'approved' && asset?.selectable === true)
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
      description: compact(item?.description || item?.描述 || slotDescription || '生意管家模板未返回描述'),
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
    const videoUrl = compact(
      row?.视频URL || row?.视频链接 || row?.video_url || row?.videoUrl || row?.url || row?.download_url || row?.downloadUrl,
    )
    const taskId = compact(row?.视频任务ID || row?.提交任务ID || row?.任务ID || row?.task_id || row?.taskId || fallbackTask?.id)
    const failed = /失败|超时|错误|failed|error|timeout/i.test(result)
    const done = Boolean(localPath || videoUrl) || /成功|已下载|已生成|completed|succeeded/i.test(result)
    return {
      id: compact(row?.id || taskId || `${fallbackTask?.id || 'video-result'}-${index + 1}`),
      styleCode: compact(row?.款号 || row?.style_code || row?.styleCode || fallbackTask?.styleCode),
      template: compact(row?.模板标题 || row?.模板名称 || row?.模板ID || row?.template || fallbackTask?.template?.title || '不选模板'),
      provider: compact(row?.供应商 || row?.provider || fallbackTask?.providerLabel || fallbackTask?.provider || '生意管家'),
      taskId,
      status: failed ? '失败' : (done ? '已完成' : (result || '运行中')),
      progress: failed ? 100 : (done ? 100 : Number(row?.progress || 60)),
      path: localPath,
      videoUrl,
      error: failed ? compact(row?.备注 || row?.note || row?.error || result) : '',
      raw: row,
    }
  })
}

function balaVideoResultHasOutput(result = {}) {
  return Boolean(compact(result?.path || result?.videoUrl || result?.video_url))
}

function balaVideoResultSettlesTask(result = {}) {
  if (balaVideoResultHasOutput(result) || compact(result?.error)) return true
  const status = [result?.status, result?.providerStatus]
    .map(value => compact(value).toLowerCase())
    .filter(Boolean)
    .join(' ')
  return /失败|error|failed|cancelled|canceled|stopped|partial|已完成|生成完成|已下载|succeeded|completed|downloaded/.test(status)
}

export function clearBalaVideoTaskHistory(existingResults = [], targets = []) {
  const taskRefIds = [...new Set((targets || [])
    .map(item => compact(item?.taskRefId || item?.id))
    .filter(Boolean))]
  const clearedTaskRefIds = new Set(taskRefIds)
  return {
    taskRefIds,
    results: (existingResults || []).filter(item => !clearedTaskRefIds.has(compact(item?.taskRefId || item?.id))),
  }
}

export function mergeBalaVideoResults(existingResults = [], incomingResults = []) {
  const merged = [...(existingResults || [])]
  for (const item of incomingResults || []) {
    const itemId = compact(item?.id)
    const taskRefId = compact(item?.taskRefId || itemId)
    const exactIndex = merged.findIndex(existing => compact(existing?.id) === itemId)
    if (exactIndex >= 0) {
      merged.splice(exactIndex, 1, item)
      continue
    }

    const loadingIndex = balaVideoResultSettlesTask(item)
      ? merged.findIndex(existing => (
        compact(existing?.taskRefId || existing?.id) === taskRefId
        && !balaVideoResultSettlesTask(existing)
      ))
      : -1
    if (loadingIndex >= 0) merged.splice(loadingIndex, 1, item)
    else merged.unshift(item)
  }
  return merged
}

export function qnVideoResultFailure(rows = []) {
  const failed = (rows || []).filter(row => String(row?.status || '').trim() === '失败')
  if (!failed.length) return ''
  const details = failed
    .map(row => compact(row?.error || row?.taskId || row?.styleCode))
    .filter(Boolean)
    .slice(0, 3)
    .join('；')
  return `生意管家视频结果 ${failed.length} 条失败${details ? `：${details}` : ''}`
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
