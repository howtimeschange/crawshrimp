;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'init'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const SEARCH_SCOPE = '["filename", "tag"]'
  const SEARCH_PAGE_SIZE = 100
  const FOLDER_PAGE_SIZE = 200
  const DEFAULT_DOWNLOAD_CONCURRENCY = 8
  const DOWNLOAD_RETRY_ATTEMPTS = 5
  const DOWNLOAD_RETRY_DELAY_MS = 2000
  const DOWNLOAD_TIMEOUT_SECONDS = 120
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'])
  const SOURCE_LABELS = Object.freeze({
    model: '模拍图',
    detail: '商品细节图',
  })
  const SOURCE_FOLDER_NAMES = Object.freeze({
    model: '01_模拍原图',
    detail: '02_商品细节图',
  })

  function compact(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function toSafeFilename(value, fallback = 'file') {
    const text = String(value || '').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ')
    return text.replace(/^_+|_+$/g, '') || fallback
  }

  function parseCloudPath(rawValue) {
    const raw = String(rawValue || '').trim()
    if (!raw) throw new Error('请填写云盘搜索根路径')

    const divider = raw.indexOf('//')
    if (divider < 0) throw new Error('云盘路径格式不正确，需要使用“挂载点//目录/子目录”')

    const mountName = compact(raw.slice(0, divider))
    const relativeRaw = raw.slice(divider + 2).replace(/\\/g, '/')
    const relativePath = relativeRaw.split('/').map(compact).filter(Boolean).join('/')

    if (!mountName) throw new Error('云盘路径缺少挂载点名称')

    return {
      mountName,
      relativePath,
      relativePrefix: relativePath ? `${relativePath}/` : '',
      raw,
    }
  }

  function normalizeCodes(rawValue) {
    const text = String(rawValue || '').replace(/[，、；;,]/g, '\n')
    const deduped = []
    const seen = new Set()
    for (const line of text.split(/\r?\n/)) {
      const value = compact(line)
      if (!value || seen.has(value)) continue
      seen.add(value)
      deduped.push(value)
    }
    return deduped
  }

  function getGroupCode(code) {
    const value = compact(code)
    return value.includes('-') ? value.split('-')[0] : value
  }

  function getFileStem(filename) {
    const name = String(filename || '').trim()
    if (!name) return ''
    const index = name.lastIndexOf('.')
    return index > 0 ? name.slice(0, index) : name
  }

  function getExt(itemOrFilename) {
    if (itemOrFilename && typeof itemOrFilename === 'object') {
      const explicit = String(itemOrFilename.ext || '').trim().toLowerCase()
      if (explicit) return explicit.replace(/^\./, '')
      return getExt(itemOrFilename.filename || itemOrFilename.name || '')
    }
    const name = String(itemOrFilename || '').trim()
    const index = name.lastIndexOf('.')
    return index >= 0 ? name.slice(index + 1).trim().toLowerCase() : ''
  }

  function isDirectoryItem(item) {
    const dir = item?.dir
    return dir === 1 || dir === '1' || dir === true
  }

  function isImageItem(item) {
    return !isDirectoryItem(item) && IMAGE_EXTS.has(getExt(item))
  }

  function pathSegments(fullpath) {
    return String(fullpath || '').replace(/\\/g, '/').split('/').map(compact).filter(Boolean)
  }

  function lastPathSegment(fullpath) {
    const segments = pathSegments(fullpath)
    return segments.length ? segments[segments.length - 1] : ''
  }

  function itemName(item) {
    return compact(item?.filename || item?.name || lastPathSegment(item?.fullpath || item?.path || ''))
  }

  function itemText(item) {
    return `${itemName(item)} ${item?.fullpath || item?.path || ''}`
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function startsWithCodeToken(value, code) {
    const text = compact(value).toLowerCase()
    const target = compact(code).toLowerCase()
    if (!text || !target) return false
    return new RegExp(`^${escapeRegExp(target)}(?:$|[\\s_+\\-])`, 'i').test(text)
  }

  function pathContainsCode(fullpath, code) {
    const styleCode = getGroupCode(code)
    return pathSegments(fullpath).some(segment => startsWithCodeToken(segment, styleCode))
  }

  function matchesFolderItemForCode(item, code) {
    return isDirectoryItem(item) && pathContainsCode(item?.fullpath || itemName(item), code)
  }

  function isWithinRelativePath(fullpath, relativePath) {
    const target = String(relativePath || '').trim()
    if (!target) return true
    const normalized = String(fullpath || '').replace(/\\/g, '/')
    return normalized === target || normalized.startsWith(`${target}/`)
  }

  function sourceMarker(sourceType) {
    return sourceType === 'model' ? '模拍原图' : '平拍原图'
  }

  function pathContainsSourceMarker(fullpath, sourceType) {
    const marker = sourceMarker(sourceType)
    return pathSegments(fullpath).some(segment => segment.includes(marker))
  }

  function isPackagingPath(fullpath) {
    return /包装/.test(String(fullpath || ''))
  }

  function isCandidateFolder(item, code, relativePath, sourceType) {
    const fullpath = String(item?.fullpath || item?.path || '')
    return (
      matchesFolderItemForCode(item, code) &&
      isWithinRelativePath(fullpath, relativePath) &&
      pathContainsSourceMarker(fullpath, sourceType) &&
      !isPackagingPath(fullpath)
    )
  }

  function normalizedTimestamp(item) {
    const fields = [
      item?.last_dateline,
      item?.dateline,
      item?.update_time,
      item?.modify_time,
      item?.modified,
      item?.create_dateline,
      item?.add_dateline,
      item?.ctime,
      item?.mtime,
      item?.addtime,
    ]
    for (const raw of fields) {
      if (raw == null || raw === '') continue
      const text = String(raw).trim()
      const numeric = Number(text)
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric > 100000000000 ? Math.floor(numeric / 1000) : numeric
      }
      const parsed = Date.parse(text)
      if (Number.isFinite(parsed)) return Math.floor(parsed / 1000)
    }
    return 0
  }

  function folderRank(item, sourceType, code) {
    const name = itemName(item)
    const text = itemText(item)
    const styleCode = getGroupCode(code)
    if (sourceType === 'model') {
      if (/已选/.test(text)) return 0
      if (/可选|AI已回|导购|回齐|新回|回图/i.test(text)) return 2
      return 8
    }
    if (/已写/.test(text)) return 0
    if (startsWithCodeToken(name, styleCode)) return 1
    return 8
  }

  function pickBestFolder(items, sourceType, code, relativePath) {
    const candidates = (Array.isArray(items) ? items : [])
      .filter(item => isCandidateFolder(item, code, relativePath, sourceType))
      .map(item => ({
        item,
        rank: folderRank(item, sourceType, code),
        timestamp: normalizedTimestamp(item),
      }))
      .sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank
        if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp
        return itemName(a.item).localeCompare(itemName(b.item), 'zh-Hans-CN')
      })
    return {
      selected: candidates[0]?.item || null,
      candidates: candidates.map(entry => entry.item),
      usedFallback: !!candidates[0] && candidates[0].rank > 1,
    }
  }

  function normalizeFolderScanDepth(rawValue) {
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) return 2
    return Math.max(1, Math.min(8, Math.floor(parsed)))
  }

  function normalizeDownloadConcurrency(rawValue) {
    if (String(rawValue ?? '').trim() === '') return DEFAULT_DOWNLOAD_CONCURRENCY
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) return DEFAULT_DOWNLOAD_CONCURRENCY
    return Math.max(1, Math.min(32, Math.floor(parsed)))
  }

  function normalizeMaxImageMb(rawValue) {
    if (String(rawValue ?? '').trim() === '') return 10
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) return 10
    return Math.max(1, Math.min(80, Math.floor(parsed)))
  }

  function normalizeDuplicateMode(rawValue) {
    return String(rawValue || '').trim().toLowerCase() === 'all' ? 'all' : 'first_per_hash'
  }

  function fileSizeBytes(item) {
    const parsed = Number(item?.filesize ?? item?.file_size ?? item?.size ?? 0)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }

  function fileSizeMb(item) {
    const bytes = fileSizeBytes(item)
    return bytes ? Number((bytes / 1024 / 1024).toFixed(2)) : ''
  }

  function isModelWhiteBackgroundFilename(filename) {
    const stem = compact(getFileStem(filename))
    if (!stem) return false
    return /^(?:m\(1\)\.)?\d{12}-\d{5}(?:\s*\(\d+\))?$/i.test(stem)
  }

  function hasAny(text, patterns) {
    const source = String(text || '')
    return patterns.some(pattern => pattern.test(source))
  }

  function classifyVideoAsset(sourceType, item) {
    const ext = getExt(item)
    const filename = itemName(item)
    const text = itemText(item)
    const base = {
      keep: false,
      action: '已过滤',
      reason: '',
      packageFilename: toSafeFilename(filename || `asset.${ext}`, `asset.${ext || 'jpg'}`),
    }

    if (!isImageItem(item)) {
      return { ...base, reason: `非图片文件：${ext || '未知'}` }
    }
    if (isPackagingPath(text)) {
      return { ...base, reason: '包装图按视频素材规则过滤' }
    }
    if (/白底/.test(text)) {
      return { ...base, reason: '白底图按视频素材规则过滤' }
    }

    if (sourceType === 'model') {
      if (isModelWhiteBackgroundFilename(filename)) {
        return { ...base, reason: '模拍目录中的白底/款色平铺图按命名规则过滤' }
      }
      if (hasAny(text, [/平拍|静物|细节|吊牌|水洗|洗标|合格证|卡纸|手写/])) {
        return { ...base, reason: '模拍目录中的非模拍素材已过滤' }
      }
      return {
        ...base,
        keep: true,
        action: /AI|换头|换脸/i.test(text) ? '保留AI模拍图' : '保留模拍图',
        reason: '',
      }
    }

    if (hasAny(text, [/吊牌|水洗|洗标|合格证|卡纸|手写/])) {
      return { ...base, reason: '商品细节目录中的标签/洗唛类素材已过滤' }
    }
    return {
      ...base,
      keep: true,
      action: '保留商品细节图',
      reason: '',
    }
  }

  function dedupeAssets(items, duplicateMode) {
    if (normalizeDuplicateMode(duplicateMode) === 'all') {
      return Array.isArray(items) ? items.slice() : []
    }
    const result = []
    const seen = new Set()
    for (const item of Array.isArray(items) ? items : []) {
      const hash = compact(item?.filehash || '')
      const key = hash || compact(getFileStem(itemName(item))).toLowerCase() || compact(item?.fullpath || '').toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      result.push(item)
    }
    return result
  }

  function buildRuntimeFilename(code, sourceType, item, itemIndex) {
    const ext = getExt(item)
    const suffix = ext ? `.${ext}` : ''
    const itemId = String(item?.id || item?.hash || item?.filehash || itemIndex + 1)
    const stem = toSafeFilename(
      `${toSafeFilename(getGroupCode(code), 'code')}__${sourceType}__${itemId}__${getFileStem(itemName(item))}`,
      'download',
    )
    return suffix && !stem.toLowerCase().endsWith(suffix) ? `${stem}${suffix}` : stem
  }

  function buildDownloadHeaders() {
    const headers = {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    }
    const userAgent = typeof navigator !== 'undefined' ? String(navigator.userAgent || '').trim() : ''
    if (userAgent) headers['User-Agent'] = userAgent
    const origin = typeof location !== 'undefined' ? String(location.origin || '').trim() : ''
    if (origin) headers.Referer = `${origin}/`
    return headers
  }

  function buildFolderHashRoute(mountId, relativePath) {
    const base = `#/home/file/mount/${encodeURIComponent(String(mountId || '').trim())}`
    const normalized = String(relativePath || '').trim()
    return normalized ? `${base}?path=${encodeURIComponent(normalized)}` : base
  }

  function buildSearchHashRoute(mountId, keyword) {
    const mount = encodeURIComponent(String(mountId || '').trim())
    const query = new URLSearchParams({
      keyword: String(keyword || '').trim(),
      mount_id: String(mountId || '').trim(),
      scope: SEARCH_SCOPE,
    })
    return `#/home/file/mount/${mount}/search?${query.toString()}`
  }

  function rowForAsset(inputCode, sourceType, folderItem, item, classification, overrides = {}) {
    const styleCode = getGroupCode(inputCode)
    const sourceLabel = SOURCE_LABELS[sourceType] || sourceType
    return {
      '输入款号': styleCode,
      '输入编码': inputCode,
      '素材来源': sourceLabel,
      '选择文件夹': String(folderItem?.fullpath || ''),
      '文件名': classification.packageFilename || itemName(item),
      '云盘路径': String(item?.fullpath || ''),
      '文件大小MB': fileSizeMb(item),
      '处理动作': classification.action,
      '下载结果': classification.keep ? '' : '已跳过',
      '本地文件': '',
      '压缩结果': classification.keep ? '待检查' : '',
      '备注': classification.reason || '',
      '__bala_group_code': styleCode,
      '__bala_source_type': sourceType,
      '__package_filename': classification.packageFilename || itemName(item),
      '__cloud_folder_path': String(folderItem?.fullpath || ''),
      ...overrides,
    }
  }

  function rowForNotice(inputCode, sourceType, action, result, note = '') {
    const styleCode = getGroupCode(inputCode)
    return {
      '输入款号': styleCode,
      '输入编码': inputCode,
      '素材来源': SOURCE_LABELS[sourceType] || sourceType,
      '选择文件夹': '',
      '文件名': '',
      '云盘路径': '',
      '文件大小MB': '',
      '处理动作': action,
      '下载结果': result,
      '本地文件': '',
      '压缩结果': '',
      '备注': note,
      '__bala_group_code': styleCode,
      '__bala_source_type': sourceType,
    }
  }

  function nextPhase(name, sleepMs = 0, newShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'next_phase',
        next_phase: name,
        sleep_ms: sleepMs,
        shared: newShared,
      },
    }
  }

  function downloadUrls(items, nextPhaseName, options = {}, newShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'download_urls',
        items,
        shared_key: options.shared_key || 'downloadResults',
        shared_append: !!options.shared_append,
        strict: !!options.strict,
        concurrency: Number(options.concurrency || 1),
        retry_attempts: Number(options.retry_attempts || 1),
        retry_delay_ms: Number(options.retry_delay_ms || 0),
        timeout_seconds: Number(options.timeout_seconds || 0) || undefined,
        progress_total: Number(options.progress_total || 0) || undefined,
        progress_completed_offset: Number(options.progress_completed_offset || 0) || 0,
        progress_success_offset: Number(options.progress_success_offset || 0) || 0,
        progress_failed_offset: Number(options.progress_failed_offset || 0) || 0,
        next_phase: nextPhaseName,
        sleep_ms: options.sleep_ms || 0,
        shared: newShared,
      },
    }
  }

  function complete(data = [], newShared = shared) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: false,
        shared: newShared,
      },
    }
  }

  async function fetchJson(url, init = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      ...init,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 240) || response.statusText}`)
    }
    return response.json()
  }

  async function fetchMounts() {
    const payload = await fetchJson('/fengcloud/1/account/mount')
    if (Array.isArray(payload)) return payload
    if (Array.isArray(payload?.list)) return payload.list
    return []
  }

  async function resolveMountId(mountName) {
    const mounts = await fetchMounts()
    const target = mounts.find(item => compact(item?.org_name) === compact(mountName))
    if (!target) throw new Error(`未找到挂载点：${mountName}`)
    return {
      mountId: String(target.mount_id || ''),
      mountName: compact(target.org_name),
    }
  }

  async function searchFiles(mountId, keyword) {
    const all = []
    let start = 0
    let total = null

    while (true) {
      const body = new URLSearchParams({
        size: String(SEARCH_PAGE_SIZE),
        start: String(start),
        keyword: String(keyword || ''),
        mount_id: String(mountId || ''),
        scope: SEARCH_SCOPE,
      })

      const payload = await fetchJson('/fengcloud/2/file/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      })

      const items = Array.isArray(payload?.list) ? payload.list : []
      const pageTotal = Number(payload?.total || 0)
      if (total == null) total = pageTotal
      all.push(...items)

      if (!items.length) break
      start += items.length
      if (start >= pageTotal) break
    }

    return all
  }

  function extractFolderItems(payload) {
    if (Array.isArray(payload)) return payload
    if (Array.isArray(payload?.list)) return payload.list
    if (Array.isArray(payload?.items)) return payload.items
    if (Array.isArray(payload?.files)) return payload.files
    if (Array.isArray(payload?.data)) return payload.data
    if (Array.isArray(payload?.data?.list)) return payload.data.list
    return null
  }

  function extractFolderTotal(payload, fallbackCount) {
    const candidates = [payload?.total, payload?.count, payload?.data?.total, payload?.data?.count]
    const total = candidates.map(Number).find(value => Number.isFinite(value) && value >= 0)
    return total == null ? fallbackCount : total
  }

  function normalizeListedItem(item, parentFullpath) {
    if (!item || typeof item !== 'object') return item
    const filename = String(item.filename || item.name || '').trim()
    const fullpath = String(item.fullpath || item.path || '').trim()
    const ext = String(item.ext || getExt(filename) || '').replace(/^\./, '').toLowerCase()
    const normalized = { ...item, filename, ext }
    if (fullpath || !filename || !parentFullpath) return normalized
    return {
      ...normalized,
      fullpath: `${String(parentFullpath || '').replace(/\/+$/, '')}/${filename}`,
    }
  }

  async function listFolderItems(mountId, fullpath) {
    const paramsForBody = new URLSearchParams({
      order: 'filename asc',
      size: String(FOLDER_PAGE_SIZE),
      start: '0',
      mount_id: String(mountId || ''),
      fullpath: String(fullpath || ''),
      path: String(fullpath || ''),
      current: '1',
    })
    const all = []
    let start = 0
    let total = null
    while (true) {
      paramsForBody.set('start', String(start))
      const payload = await fetchJson(`/fengcloud/1/file/ls?${paramsForBody.toString()}`)
      const itemsRaw = extractFolderItems(payload)
      if (!Array.isArray(itemsRaw)) {
        throw new Error('GET /fengcloud/1/file/ls 未返回列表字段')
      }
      const items = itemsRaw.map(item => normalizeListedItem(item, fullpath))
      all.push(...items)
      const pageTotal = extractFolderTotal(payload, start + items.length)
      if (total == null) total = pageTotal
      if (!items.length) break
      start += items.length
      if (start >= pageTotal) break
    }
    return all
  }

  async function collectDescendantImages(mountId, folderItem, maxDepth, remainingBudget = { value: 2000 }) {
    const folderPath = String(folderItem?.fullpath || '').trim()
    if (!folderPath || maxDepth <= 0 || remainingBudget.value <= 0) {
      return { assets: [], errors: [] }
    }

    let listed = []
    try {
      listed = await listFolderItems(mountId, folderPath)
    } catch (error) {
      return { assets: [], errors: [`${folderPath}: ${String(error?.message || error)}`] }
    }

    const assets = []
    const errors = []
    for (const item of listed) {
      if (remainingBudget.value <= 0) break
      if (isDirectoryItem(item)) {
        if (isPackagingPath(item?.fullpath || itemName(item))) continue
        const child = await collectDescendantImages(mountId, item, maxDepth - 1, remainingBudget)
        assets.push(...child.assets)
        errors.push(...child.errors)
        continue
      }
      if (!isImageItem(item)) continue
      assets.push(item)
      remainingBudget.value -= 1
    }
    return { assets, errors }
  }

  async function fetchFileInfo(mountId, fullpath) {
    const query = new URLSearchParams({
      fullpath: String(fullpath || ''),
      mount_id: String(mountId || ''),
    })
    return fetchJson(`/fengcloud/2/file/info?${query.toString()}`)
  }

  async function buildSourcePlan(inputCode, sourceType, sourceConfig, searchItems, codeIndex, totalCodes, options = {}) {
    const rows = []
    const downloadItems = []
    const folderChoice = pickBestFolder(searchItems, sourceType, inputCode, sourceConfig.relativePath)

    if (!folderChoice.selected) {
      rows.push(rowForNotice(inputCode, sourceType, '未找到素材文件夹', '未匹配到素材', `搜索结果 ${searchItems.length} 条，未命中 ${sourceMarker(sourceType)} 下的款号文件夹`))
      return { rows, downloadItems }
    }

    const folderItem = folderChoice.selected
    const collected = await collectDescendantImages(sourceConfig.mountId, folderItem, options.folderScanDepth || 2)
    const classifiedRows = []
    const keptItems = []
    for (const item of collected.assets) {
      const classification = classifyVideoAsset(sourceType, item)
      if (!classification.keep) {
        classifiedRows.push(rowForAsset(inputCode, sourceType, folderItem, item, classification))
        continue
      }
      keptItems.push({ item, classification })
    }

    const dedupedItems = dedupeAssets(keptItems.map(entry => entry.item), options.duplicateMode)
    const keptByPath = new Set(dedupedItems.map(item => String(item?.fullpath || itemName(item))))
    for (const entry of keptItems) {
      const pathKey = String(entry.item?.fullpath || itemName(entry.item))
      if (keptByPath.has(pathKey)) continue
      classifiedRows.push(rowForAsset(inputCode, sourceType, folderItem, entry.item, {
        ...entry.classification,
        keep: false,
        action: '已过滤',
        reason: '重复图片已过滤',
      }))
    }

    const finalItems = keptItems.filter(entry => keptByPath.has(String(entry.item?.fullpath || itemName(entry.item))))
    if (!finalItems.length) {
      rows.push(rowForNotice(inputCode, sourceType, '文件夹内无可用图片', '未匹配到素材', `已选择文件夹：${folderItem.fullpath || itemName(folderItem)}；候选图片 ${collected.assets.length} 张，过滤后 0 张`))
      rows.push(...classifiedRows)
      for (const error of collected.errors.slice(0, 5)) {
        rows.push(rowForNotice(inputCode, sourceType, '子文件夹列目录失败', '已跳过', error))
      }
      return { rows, downloadItems }
    }

    for (let index = 0; index < finalItems.length; index += 1) {
      const { item, classification } = finalItems[index]
      const baseRow = rowForAsset(inputCode, sourceType, folderItem, item, classification, {
        '__code_index': codeIndex,
        '__total_codes': totalCodes,
        '__compress_threshold_bytes': Number(options.maxImageMb || 20) * 1024 * 1024,
      })
      if (fileSizeBytes(item) > Number(baseRow.__compress_threshold_bytes || 0)) {
        baseRow['压缩结果'] = '待压缩'
      }
      if (folderChoice.usedFallback) {
        baseRow['备注'] = baseRow['备注'] || '未命中首选命名，使用同源款号文件夹'
      }

      try {
        const info = await fetchFileInfo(sourceConfig.mountId, item?.fullpath || '')
        const downloadUrl = String(info?.uri || (Array.isArray(info?.uris) ? info.uris[0] : '') || '').trim()
        if (!downloadUrl) {
          rows.push({
            ...baseRow,
            '下载结果': '获取下载链接失败',
            '备注': baseRow['备注'] || 'file/info 未返回 uri',
          })
          continue
        }

        const runtimeFilename = buildRuntimeFilename(inputCode, sourceType, item, index)
        const downloadFilename = toSafeFilename(classification.packageFilename || runtimeFilename, runtimeFilename)
        rows.push({
          ...baseRow,
          '__runtime_filename': runtimeFilename,
        })
        downloadItems.push({
          url: downloadUrl,
          filename: runtimeFilename,
          target_relative_path: `${toSafeFilename(getGroupCode(inputCode), 'code')}/${SOURCE_FOLDER_NAMES[sourceType] || sourceType}/${downloadFilename}`,
          label: `${SOURCE_LABELS[sourceType] || sourceType} / ${inputCode} / ${itemName(item) || runtimeFilename}`,
          headers: buildDownloadHeaders(),
          timeout_seconds: DOWNLOAD_TIMEOUT_SECONDS,
          no_proxy: true,
        })
      } catch (error) {
        rows.push({
          ...baseRow,
          '下载结果': '获取下载链接失败',
          '备注': String(error?.message || error),
        })
      }
    }

    rows.push(...classifiedRows)
    for (const error of collected.errors.slice(0, 5)) {
      rows.push(rowForNotice(inputCode, sourceType, '子文件夹列目录失败', '已跳过', error))
    }

    return { rows, downloadItems }
  }

  async function buildCodePlan(inputCode, sourceConfig, codeIndex, totalCodes, options = {}) {
    const styleCode = getGroupCode(inputCode)
    const searchItems = await searchFiles(sourceConfig.mountId, styleCode)
    const rows = []
    const downloadItems = []

    for (const sourceType of ['model', 'detail']) {
      const plan = await buildSourcePlan(
        inputCode,
        sourceType,
        sourceConfig,
        searchItems,
        codeIndex,
        totalCodes,
        options,
      )
      rows.push(...plan.rows)
      downloadItems.push(...plan.downloadItems)
    }
    return { rows, downloadItems }
  }

  function finalizeRows(plannedRows, downloadResult) {
    const items = Array.isArray(downloadResult?.items) ? downloadResult.items : []
    let downloadIndex = 0

    return (Array.isArray(plannedRows) ? plannedRows : []).map(row => {
      if (row['下载结果']) return row

      const result = items[downloadIndex] || {}
      downloadIndex += 1
      return {
        ...row,
        '下载结果': result?.success ? '已下载' : '下载失败',
        '本地文件': String(result?.path || ''),
        '备注': result?.success ? row['备注'] || '' : String(result?.error || '下载失败'),
      }
    })
  }

  function summarizeDownloadResult(downloadResult) {
    const items = Array.isArray(downloadResult?.items) ? downloadResult.items : []
    return {
      completed: items.length,
      success: items.filter(item => item?.success).length,
      failed: items.filter(item => !item?.success).length,
    }
  }

  function advanceAfterCode(codes, codeIndex, currentCode, nextShared, allRows) {
    const nextIndex = codeIndex + 1
    const nextCode = String(codes[nextIndex] || '')
    if (nextCode) {
      return nextPhase('plan_code', 0, {
        ...nextShared,
        code_index: nextIndex,
        result_rows: allRows,
        pending_download_items: [],
        pending_code_rows: [],
        last_code_download_result: null,
        current_code: '',
        search_hash: '',
        current_exec_no: nextIndex + 1,
        current_buyer_id: nextCode,
      })
    }

    return nextPhase('finalize_all', 0, {
      ...nextShared,
      result_rows: allRows,
      pending_download_items: [],
      pending_code_rows: [],
      last_code_download_result: null,
      current_code: currentCode,
      current_exec_no: codes.length,
      current_buyer_id: currentCode,
      search_total_codes: codes.length,
      search_completed_codes: codes.length,
    })
  }

  function exposeHelpers() {
    if (!testExports || typeof testExports !== 'object') return
    Object.assign(testExports, {
      parseCloudPath,
      normalizeCodes,
      getGroupCode,
      getExt,
      isImageItem,
      pathContainsCode,
      matchesFolderItemForCode,
      isWithinRelativePath,
      pathContainsSourceMarker,
      normalizedTimestamp,
      folderRank,
      pickBestFolder,
      normalizeFolderScanDepth,
      normalizeDownloadConcurrency,
      normalizeMaxImageMb,
      normalizeDuplicateMode,
      fileSizeBytes,
      fileSizeMb,
      isModelWhiteBackgroundFilename,
      classifyVideoAsset,
      dedupeAssets,
      buildRuntimeFilename,
      buildFolderHashRoute,
      buildSearchHashRoute,
      listFolderItems,
      collectDescendantImages,
      buildSourcePlan,
      buildCodePlan,
      finalizeRows,
      summarizeDownloadResult,
    })
  }

  exposeHelpers()

  if (phase === '__exports__') {
    return complete([], shared)
  }

  try {
    if (phase === 'init' || phase === 'main') {
      const cloudConfig = parseCloudPath(params.cloud_path)
      const codes = normalizeCodes(params.item_codes)
      if (!codes.length) throw new Error('请至少输入一个款号')
      const mount = await resolveMountId(cloudConfig.mountName)

      const sourceConfig = {
        mountId: mount.mountId,
        mountName: mount.mountName,
        cloudPath: cloudConfig.raw,
        relativePath: cloudConfig.relativePath,
      }
      const folderScanDepth = normalizeFolderScanDepth(params.folder_scan_depth)
      const downloadConcurrency = normalizeDownloadConcurrency(params.download_concurrency)
      const duplicateMode = normalizeDuplicateMode(params.duplicate_mode)
      const maxImageMb = normalizeMaxImageMb(params.max_image_mb)

      return nextPhase('ensure_folder', 0, {
        source_config: sourceConfig,
        folder_hash: buildFolderHashRoute(mount.mountId, cloudConfig.relativePath),
        folder_scan_depth: folderScanDepth,
        duplicate_mode: duplicateMode,
        download_concurrency: downloadConcurrency,
        max_image_mb: maxImageMb,
        compress_threshold_bytes: maxImageMb * 1024 * 1024,
        target_codes: codes,
        code_index: 0,
        result_rows: [],
        pending_download_items: [],
        pending_code_rows: [],
        download_total_files: 0,
        download_completed_files: 0,
        download_success_files: 0,
        download_failed_files: 0,
        total_rows: codes.length,
        search_total_codes: codes.length,
        search_completed_codes: 0,
        current_exec_no: 1,
        current_buyer_id: codes[0] || '',
        current_store: '巴拉AI视频素材准备',
      })
    }

    if (phase === 'ensure_folder') {
      const targetHash = String(shared.folder_hash || '')
      if (targetHash && location.hash !== targetHash) {
        location.hash = targetHash
        return nextPhase('plan_code', 1500, shared)
      }
      return nextPhase('plan_code', 0, shared)
    }

    if (phase === 'plan_code') {
      const codes = Array.isArray(shared.target_codes) ? shared.target_codes : []
      const codeIndex = Number(shared.code_index || 0)
      const currentCode = String(codes[codeIndex] || '')

      if (!currentCode) {
        return complete(Array.isArray(shared.result_rows) ? shared.result_rows : [], shared)
      }

      return nextPhase('ensure_search', 0, {
        ...shared,
        current_code: currentCode,
      })
    }

    if (phase === 'ensure_search') {
      const currentCode = String(shared.current_code || '')
      if (!currentCode) return nextPhase('plan_code', 0, shared)
      const sourceConfig = shared.source_config || {}
      const targetHash = buildSearchHashRoute(sourceConfig.mountId, getGroupCode(currentCode))
      if (targetHash && location.hash !== targetHash) {
        location.hash = targetHash
        return nextPhase('collect_code', 1500, {
          ...shared,
          search_hash: targetHash,
        })
      }
      return nextPhase('collect_code', 0, {
        ...shared,
        search_hash: targetHash,
      })
    }

    if (phase === 'collect_code') {
      const codes = Array.isArray(shared.target_codes) ? shared.target_codes : []
      const codeIndex = Number(shared.code_index || 0)
      const currentCode = String(shared.current_code || codes[codeIndex] || '')
      const sourceConfig = shared.source_config || {}

      const plan = await buildCodePlan(
        currentCode,
        sourceConfig,
        codeIndex + 1,
        codes.length,
        {
          duplicateMode: shared.duplicate_mode,
          folderScanDepth: shared.folder_scan_depth,
          maxImageMb: shared.max_image_mb,
        },
      )

      const baseShared = {
        ...shared,
        current_exec_no: codeIndex + 1,
        current_buyer_id: currentCode,
        current_store: `巴拉AI视频素材准备 / ${getGroupCode(currentCode)}`,
        search_total_codes: codes.length,
        search_completed_codes: codeIndex + 1,
      }

      const previousRows = Array.isArray(shared.result_rows) ? shared.result_rows : []
      const nextDownloadTotal = Number(shared.download_total_files || 0) + plan.downloadItems.length
      const codeShared = {
        ...baseShared,
        download_total_files: nextDownloadTotal,
        download_completed_files: Number(shared.download_completed_files || 0),
        download_success_files: Number(shared.download_success_files || 0),
        download_failed_files: Number(shared.download_failed_files || 0),
      }

      if (!plan.downloadItems.length) {
        const allRows = [...previousRows, ...plan.rows]
        return advanceAfterCode(codes, codeIndex, currentCode, {
          ...codeShared,
          result_rows: allRows,
          pending_download_items: [],
          pending_code_rows: [],
        }, allRows)
      }

      return downloadUrls(
        plan.downloadItems,
        'finalize_code_download',
        {
          shared_key: 'last_code_download_result',
          strict: false,
          concurrency: normalizeDownloadConcurrency(shared.download_concurrency),
          retry_attempts: DOWNLOAD_RETRY_ATTEMPTS,
          retry_delay_ms: DOWNLOAD_RETRY_DELAY_MS,
          timeout_seconds: DOWNLOAD_TIMEOUT_SECONDS,
          progress_total: nextDownloadTotal,
          progress_completed_offset: Number(shared.download_completed_files || 0),
          progress_success_offset: Number(shared.download_success_files || 0),
          progress_failed_offset: Number(shared.download_failed_files || 0),
        },
        {
          ...codeShared,
          result_rows: previousRows,
          pending_code_rows: plan.rows,
          pending_download_items: plan.downloadItems,
          current_code: currentCode,
          current_exec_no: codeIndex + 1,
          current_buyer_id: currentCode,
          download_concurrency: normalizeDownloadConcurrency(shared.download_concurrency),
          batch_no: 1,
          total_batches: plan.downloadItems.length,
        },
      )
    }

    if (phase === 'finalize_code_download') {
      const codes = Array.isArray(shared.target_codes) ? shared.target_codes : []
      const codeIndex = Number(shared.code_index || 0)
      const currentCode = String(shared.current_code || codes[codeIndex] || '')
      const finalizedRows = finalizeRows(shared.pending_code_rows, shared.last_code_download_result)
      const summary = summarizeDownloadResult(shared.last_code_download_result)
      const allRows = [...(Array.isArray(shared.result_rows) ? shared.result_rows : []), ...finalizedRows]
      const nextShared = {
        ...shared,
        result_rows: allRows,
        pending_download_items: [],
        pending_code_rows: [],
        download_completed_files: Number(shared.download_completed_files || 0) + summary.completed,
        download_success_files: Number(shared.download_success_files || 0) + summary.success,
        download_failed_files: Number(shared.download_failed_files || 0) + summary.failed,
        batch_no: 0,
        total_batches: 0,
      }

      return advanceAfterCode(codes, codeIndex, currentCode, nextShared, allRows)
    }

    if (phase === 'finalize_all') {
      return complete(Array.isArray(shared.result_rows) ? shared.result_rows : [], {
        ...shared,
        pending_download_items: [],
        pending_code_rows: [],
      })
    }

    return { success: false, error: `未知 phase: ${phase}` }
  } catch (error) {
    return {
      success: false,
      error: String(error?.message || error),
    }
  }
})()
