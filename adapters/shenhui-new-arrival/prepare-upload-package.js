;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'init'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const SEARCH_SCOPE = '["filename", "tag"]'
  const SEARCH_PAGE_SIZE = 100
  const FOLDER_PAGE_SIZE = 200
  const DEFAULT_DOWNLOAD_CONCURRENCY = 8
  const MIN_DOWNLOAD_CONCURRENCY = 1
  const MAX_DOWNLOAD_CONCURRENCY = 32
  const DOWNLOAD_RETRY_ATTEMPTS = 5
  const DOWNLOAD_RETRY_DELAY_MS = 2000
  const DOWNLOAD_TIMEOUT_SECONDS = 120
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'])
  const PDF_EXTS = new Set(['pdf'])
  const PSD_EXTS = new Set(['psd'])
  const ASSET_EXTS = new Set([...IMAGE_EXTS, ...PDF_EXTS, ...PSD_EXTS])
  const SOURCE_LABELS = Object.freeze({
    model: '模特图',
    still: '静物图',
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
    if (!raw) throw new Error('请填写云盘路径')

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
    const text = String(rawValue || '').replace(/[，、；;]/g, '\n')
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

  function normalizeFullpathKey(value) {
    return String(value || '').replace(/\\/g, '/').replace(/\s+/g, ' ').trim().toLowerCase()
  }

  function normalizeRetryFailedPlan(rawValue) {
    const rows = Array.isArray(rawValue?.rows)
      ? rawValue.rows
      : Array.isArray(rawValue)
        ? rawValue
        : []
    const paths = []
    const pathSet = new Set()
    const codes = []
    const seenCodes = new Set()

    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const status = compact(row['下载结果'])
      if (!status || status === '已下载' || status === '已跳过') continue
      const fullpath = compact(row['云盘路径'])
      const key = normalizeFullpathKey(fullpath)
      if (!key || pathSet.has(key)) continue
      pathSet.add(key)
      paths.push(key)

      const code = compact(row['输入编码'] || row['输入款号'])
      if (code && !seenCodes.has(code)) {
        seenCodes.add(code)
        codes.push(code)
      }
    }

    return {
      active: paths.length > 0,
      paths,
      codes,
      failedCount: paths.length,
    }
  }

  function filterRetryFailedItems(items, retryFailedPaths) {
    const pathSet = retryFailedPaths instanceof Set
      ? retryFailedPaths
      : new Set(Array.isArray(retryFailedPaths) ? retryFailedPaths : [])
    if (!pathSet.size) return Array.isArray(items) ? items : []
    return (Array.isArray(items) ? items : [])
      .filter(item => pathSet.has(normalizeFullpathKey(item?.fullpath || '')))
  }

  function classifyCode(code) {
    return String(code || '').includes('-') ? 'skc' : 'spu'
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
      return getExt(itemOrFilename.filename || '')
    }
    const name = String(itemOrFilename || '').trim()
    const index = name.lastIndexOf('.')
    return index >= 0 ? name.slice(index + 1).trim().toLowerCase() : ''
  }

  function isDirectoryItem(item) {
    const dir = item?.dir
    return dir === 1 || dir === '1' || dir === true
  }

  function isSupportedAssetItem(item) {
    return !isDirectoryItem(item) && ASSET_EXTS.has(getExt(item))
  }

  function isImageExt(ext) {
    return IMAGE_EXTS.has(String(ext || '').replace(/^\./, '').toLowerCase())
  }

  function isPdfExt(ext) {
    return PDF_EXTS.has(String(ext || '').replace(/^\./, '').toLowerCase())
  }

  function isPsdExt(ext) {
    return PSD_EXTS.has(String(ext || '').replace(/^\./, '').toLowerCase())
  }

  function isModelWhiteBackgroundFilename(filename) {
    const stem = compact(getFileStem(filename))
    if (!stem) return false
    return /^(?:m\(1\)\.)?\d{12}-\d{5}(?:\s*\(\d+\))?$/i.test(stem)
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function startsWithCodeToken(value, code) {
    const text = compact(value).toLowerCase()
    const target = compact(code).toLowerCase()
    if (!text || !target) return false
    return new RegExp(`^${escapeRegExp(target)}(?:$|[\\s_\\-])`, 'i').test(text)
  }

  function isSkcLikeStemForSpu(stem, code) {
    const target = compact(code)
    if (!target) return false
    const matcher = new RegExp(`^${escapeRegExp(target)}-\\d{5}(?:$|[\\s_\\-])`, 'i')
    return matcher.test(compact(stem))
  }

  function matchesFilenameCode(filename, code) {
    const stem = compact(getFileStem(filename))
    const target = compact(code)
    if (!stem || !target) return false

    if (classifyCode(target) === 'skc') {
      return startsWithCodeToken(stem, target)
    }

    return startsWithCodeToken(stem, target) || isSkcLikeStemForSpu(stem, target)
  }

  function pathSegments(fullpath) {
    return String(fullpath || '').replace(/\\/g, '/').split('/').map(compact).filter(Boolean)
  }

  function lastPathSegment(fullpath) {
    const segments = pathSegments(fullpath)
    return segments.length ? segments[segments.length - 1] : ''
  }

  function isPackagingFolderItem(item) {
    if (!isDirectoryItem(item)) return false
    const folderName = compact(item?.filename || item?.name || lastPathSegment(item?.fullpath || item?.path || ''))
    return /包装/.test(folderName)
  }

  function pathContainsCode(fullpath, code) {
    return pathSegments(fullpath).some(segment => matchesFilenameCode(segment, code) || startsWithCodeToken(segment, code))
  }

  function matchesAssetItemForCode(item, code) {
    return matchesFilenameCode(item?.filename || '', code) || pathContainsCode(item?.fullpath || '', code)
  }

  function matchesFolderItemForCode(item, code) {
    return isDirectoryItem(item) && pathContainsCode(item?.fullpath || item?.filename || '', code)
  }

  function isWithinRelativePath(fullpath, relativePath) {
    const target = String(relativePath || '').trim()
    if (!target) return true
    const normalized = String(fullpath || '').replace(/\\/g, '/')
    return normalized === target || normalized.startsWith(`${target}/`)
  }

  function getSourceMarker(sourceType) {
    return sourceType === 'model' ? '模拍原图' : '平拍原图'
  }

  function deriveBroadSourcePrefix(relativePath, sourceType) {
    const segments = pathSegments(relativePath)
    let moduleIndex = -1
    for (let index = 0; index < segments.length; index += 1) {
      if (/产品上新/.test(segments[index])) moduleIndex = index
    }
    if (moduleIndex >= 0) return segments.slice(0, moduleIndex + 1).join('/')
    const marker = getSourceMarker(sourceType)
    const markerIndex = segments.findIndex(segment => segment === marker)
    if (markerIndex > 0) return segments.slice(0, markerIndex).join('/')
    return String(relativePath || '').trim()
  }

  function isWithinBroadSourceScope(fullpath, sourceConfig, sourceType) {
    const normalized = String(fullpath || '').replace(/\\/g, '/')
    const prefix = String(sourceConfig?.broadRelativePath || '').trim()
    if (prefix && !(normalized === prefix || normalized.startsWith(`${prefix}/`))) return false
    return pathSegments(normalized).includes(getSourceMarker(sourceType))
  }

  function normalizeDuplicateMode(rawValue) {
    return String(rawValue || '').trim().toLowerCase() === 'all' ? 'all' : 'first_per_path'
  }

  function normalizeFolderScanDepth(rawValue) {
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) return 3
    return Math.max(0, Math.min(8, Math.floor(parsed)))
  }

  function normalizeDownloadConcurrency(rawValue) {
    if (String(rawValue ?? '').trim() === '') return DEFAULT_DOWNLOAD_CONCURRENCY
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) return DEFAULT_DOWNLOAD_CONCURRENCY
    return Math.max(MIN_DOWNLOAD_CONCURRENCY, Math.min(MAX_DOWNLOAD_CONCURRENCY, Math.floor(parsed)))
  }

  function dedupeItemsByFullpath(items, duplicateMode) {
    if (normalizeDuplicateMode(duplicateMode) === 'all') {
      return Array.isArray(items) ? items.slice() : []
    }
    const result = []
    const seen = new Set()
    for (const item of Array.isArray(items) ? items : []) {
      const key = String(item?.fullpath || item?.filename || '').trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      result.push(item)
    }
    return result
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

  function hasAny(text, patterns) {
    const source = String(text || '')
    return patterns.some(pattern => pattern.test(source))
  }

  function inferSopPdfType(item) {
    const text = `${item?.filename || ''} ${item?.fullpath || ''}`
    if (hasAny(text, [/洗唛|洗标|水洗/])) return 'wash_label'
    if (hasAny(text, [/吊牌|吊卡|挂牌|合格证/])) return 'hang_tag'
    return ''
  }

  function classifySopAsset(sourceType, item) {
    const ext = getExt(item)
    const text = `${item?.filename || ''} ${item?.fullpath || ''}`
    const base = {
      role: 'skip',
      keep: false,
      action: '已过滤',
      reason: '',
      packageFilename: '',
    }

    if (isPsdExt(ext)) {
      return { ...base, reason: '.psd 文件按 SOP 删除' }
    }

    if (isPdfExt(ext)) {
      const pdfType = inferSopPdfType(item)
      if (!pdfType) {
        return { ...base, reason: '非洗唛/吊牌 PDF 按 SOP 跳过' }
      }
      return {
        role: 'pdf_yq',
        keep: true,
        action: '保留PDF并自动截图',
        reason: pdfType === 'wash_label'
          ? '洗唛 PDF 将按截图模板自动生成 yq(2)'
          : '吊牌 PDF 将按截图模板自动生成 yq(1)',
        packageFilename: toSafeFilename(item?.filename || `label.${ext}`, `label.${ext || 'pdf'}`),
        pdfType,
      }
    }

    if (!isImageExt(ext) && !isPdfExt(ext)) {
      return { ...base, reason: `不支持的文件类型：${ext || '未知'}` }
    }

    if (sourceType === 'model') {
      if (isModelWhiteBackgroundFilename(item?.filename || '')) {
        return { ...base, reason: '模特图包白底图按命名规则删除' }
      }
      if (hasAny(text, [/包装/])) {
        return { ...base, reason: '模特图包包装图按 SOP 删除' }
      }
      if (hasAny(text, [/静物|平拍/])) {
        return { ...base, reason: '模特图包内静物图按 SOP 删除' }
      }
      if (hasAny(text, [/吊牌|吊卡|挂牌|水洗|洗唛|洗标|洗水|卡头|卡纸/])) {
        return { ...base, reason: '模特图包内吊牌/卡头/水洗类图片按 SOP 删除' }
      }
      return {
        role: 'image',
        keep: true,
        action: '保留模特图',
        reason: '',
        packageFilename: toSafeFilename(item?.filename || `model.${ext}`, `model.${ext || 'jpg'}`),
      }
    }

    if (hasAny(text, [/卡纸|手写/])) {
      return { ...base, reason: '静物图包内卡纸吊牌/手写水洗按 SOP 删除' }
    }
    if (hasAny(text, [/包装/])) {
      return { ...base, reason: '包装图按 SOP 删除' }
    }
    if (hasAny(text, [/吊牌|吊卡|挂牌|水洗|洗唛|洗标|洗水/])) {
      return {
        role: 'yq',
        keep: true,
        action: '保留并命名为yq',
        reason: '吊牌/水洗图片按 SOP 命名为 yq',
        packageFilename: ext ? `yq.${ext}` : 'yq.jpg',
      }
    }

    return {
      role: 'image',
      keep: true,
      action: '保留静物图',
      reason: '',
      packageFilename: toSafeFilename(item?.filename || `still.${ext}`, `still.${ext || 'jpg'}`),
    }
  }

  function buildRuntimeFilename(code, sourceType, item, itemIndex) {
    const ext = getExt(item)
    const suffix = ext ? `.${ext}` : ''
    const itemId = String(item?.id || item?.hash || item?.filehash || itemIndex + 1)
    const stem = toSafeFilename(
      `${toSafeFilename(getGroupCode(code), 'code')}__${sourceType}__${itemId}__${getFileStem(item?.filename || '')}`,
      'download',
    )
    return suffix && !stem.toLowerCase().endsWith(suffix) ? `${stem}${suffix}` : stem
  }

  function rowForAsset(inputCode, sourceType, item, classification, overrides = {}) {
    const groupCode = getGroupCode(inputCode)
    const sourceLabel = SOURCE_LABELS[sourceType] || sourceType
    return {
      '输入款号': groupCode,
      '输入编码': inputCode,
      '素材来源': sourceLabel,
      '文件名': classification.packageFilename || String(item?.filename || ''),
      '云盘路径': String(item?.fullpath || ''),
      '处理动作': classification.action,
      '下载结果': classification.keep ? '' : '已跳过',
      '本地文件': '',
      '备注': classification.reason || '',
      '__shenhui_group_code': groupCode,
      '__shenhui_source_type': sourceType,
      '__shenhui_asset_role': classification.role,
      '__package_filename': classification.packageFilename || String(item?.filename || ''),
      '__pdf_type': classification.pdfType || '',
      '__style_code': groupCode,
      '__style_color_code': classifyCode(inputCode) === 'skc' ? inputCode : '',
      ...overrides,
    }
  }

  function rowForNotice(inputCode, sourceType, action, result, note = '') {
    return {
      '输入款号': getGroupCode(inputCode),
      '输入编码': inputCode,
      '素材来源': SOURCE_LABELS[sourceType] || sourceType,
      '文件名': '',
      '云盘路径': '',
      '处理动作': action,
      '下载结果': result,
      '本地文件': '',
      '备注': note,
      '__shenhui_group_code': getGroupCode(inputCode),
      '__shenhui_source_type': sourceType,
      '__shenhui_asset_role': 'notice',
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
    if (Array.isArray(payload?.data?.items)) return payload.data.items
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
    if (fullpath || !filename || !parentFullpath) return item
    return {
      ...item,
      filename,
      fullpath: `${String(parentFullpath || '').replace(/\/+$/, '')}/${filename}`,
    }
  }

  async function fetchFolderPage(mountId, fullpath, start, method, endpoint) {
    const paramsForBody = new URLSearchParams({
      order: 'filename asc',
      size: String(FOLDER_PAGE_SIZE),
      start: String(start),
      mount_id: String(mountId || ''),
      fullpath: String(fullpath || ''),
      path: String(fullpath || ''),
      current: '1',
    })
    if (method === 'GET') {
      return fetchJson(`${endpoint}?${paramsForBody.toString()}`)
    }
    return fetchJson(endpoint, {
      method,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: paramsForBody.toString(),
    })
  }

  async function listFolderItems(mountId, fullpath) {
    const attempts = [
      { method: 'GET', endpoint: '/fengcloud/1/file/ls' },
      { method: 'GET', endpoint: '/fengcloud/2/file/list' },
      { method: 'POST', endpoint: '/fengcloud/2/file/list' },
      { method: 'GET', endpoint: '/fengcloud/1/file/list' },
      { method: 'POST', endpoint: '/fengcloud/1/file/list' },
    ]
    const errors = []

    for (const attempt of attempts) {
      try {
        const all = []
        let start = 0
        let total = null
        while (true) {
          const payload = await fetchFolderPage(mountId, fullpath, start, attempt.method, attempt.endpoint)
          const itemsRaw = extractFolderItems(payload)
          if (!Array.isArray(itemsRaw)) {
            throw new Error(`${attempt.method} ${attempt.endpoint} 未返回列表字段`)
          }
          const items = itemsRaw.map(item => normalizeListedItem(item, fullpath))
          all.push(...items)
          const pageTotal = extractFolderTotal(payload, start + items.length)
          if (total == null) total = pageTotal
          if (!items.length) break
          start += items.length
          if (start >= pageTotal) break
        }
        return { ok: true, items: all, endpoint: `${attempt.method} ${attempt.endpoint}` }
      } catch (error) {
        errors.push(String(error?.message || error))
      }
    }

    return { ok: false, items: [], error: errors[0] || '列目录失败' }
  }

  async function collectDescendantAssets(mountId, folderItem, maxDepth, remainingBudget = { value: 2000 }, options = {}) {
    const folderPath = String(folderItem?.fullpath || '').trim()
    if (!folderPath || maxDepth <= 0 || remainingBudget.value <= 0) {
      return { assets: [], errors: [] }
    }
    if (options.sourceType === 'model' && isPackagingFolderItem(folderItem)) {
      return { assets: [], errors: [] }
    }

    const listed = await listFolderItems(mountId, folderPath)
    if (!listed.ok) {
      return { assets: [], errors: [`${folderPath}: ${listed.error}`] }
    }

    const assets = []
    const errors = []
    for (const item of listed.items) {
      if (remainingBudget.value <= 0) break
      if (isDirectoryItem(item)) {
        if (options.sourceType === 'model' && isPackagingFolderItem(item)) {
          continue
        }
        const child = await collectDescendantAssets(mountId, item, maxDepth - 1, remainingBudget, options)
        assets.push(...child.assets)
        errors.push(...child.errors)
        continue
      }
      if (!isSupportedAssetItem(item)) continue
      assets.push(item)
      remainingBudget.value -= 1
    }
    return { assets, errors }
  }

  async function collectCandidateAssets(inputCode, sourceConfig, options = {}) {
    const searchItems = await searchFiles(sourceConfig.mountId, inputCode)
    const primaryScoped = searchItems.filter(item => isWithinRelativePath(item?.fullpath, sourceConfig.relativePath))
    const fallbackScoped = searchItems.filter(item => isWithinBroadSourceScope(item?.fullpath, sourceConfig, options.sourceType))
    const folderFilter = item => (
      matchesFolderItemForCode(item, inputCode) &&
      !(options.sourceType === 'model' && isPackagingFolderItem(item))
    )
    const primaryMatchedFolders = primaryScoped.filter(folderFilter)
    const fallbackMatchedFolders = fallbackScoped.filter(folderFilter)
    const matchedFolders = primaryMatchedFolders.length ? primaryMatchedFolders : fallbackMatchedFolders
    const directAssetFilter = item => isSupportedAssetItem(item) && matchesAssetItemForCode(item, inputCode)
    const primaryDirectAssets = primaryScoped.filter(directAssetFilter)
    const fallbackDirectAssets = fallbackScoped.filter(directAssetFilter)

    const expandedAssets = []
    const folderErrors = []
    const depth = normalizeFolderScanDepth(options.folderScanDepth)
    if (depth > 0) {
      for (const folder of matchedFolders) {
        const result = await collectDescendantAssets(sourceConfig.mountId, folder, depth, { value: 2000 }, options)
        expandedAssets.push(...result.assets)
        folderErrors.push(...result.errors)
      }
    }

    const directAssets = primaryDirectAssets.length ? primaryDirectAssets : fallbackDirectAssets
    const usedDirectAssetFallback = !expandedAssets.length && directAssets.length > 0
    const candidateItems = usedDirectAssetFallback ? directAssets : expandedAssets

    return {
      searchCount: searchItems.length,
      primaryScopeCount: primaryScoped.length,
      fallbackScopeCount: fallbackScoped.length,
      usedFallbackScope: !primaryMatchedFolders.length && fallbackMatchedFolders.length > 0,
      directAssetCount: directAssets.length,
      usedDirectAssetFallback,
      folderCount: matchedFolders.length,
      folderErrors,
      items: dedupeItemsByFullpath(candidateItems, options.duplicateMode),
    }
  }

  async function fetchFileInfo(mountId, fullpath) {
    const query = new URLSearchParams({
      fullpath: String(fullpath || ''),
      mount_id: String(mountId || ''),
    })
    return fetchJson(`/fengcloud/2/file/info?${query.toString()}`)
  }

  async function buildSourcePlan(inputCode, sourceType, sourceConfig, codeIndex, totalCodes, options = {}) {
    const rows = []
    const downloadItems = []
    const candidateResult = await collectCandidateAssets(inputCode, sourceConfig, {
      ...options,
      sourceType,
    })
    const candidates = filterRetryFailedItems(candidateResult.items, options.retryFailedPaths)

    if (!candidates.length) {
      const noteParts = [`搜索结果 ${candidateResult.searchCount} 条`, `款号文件夹 ${candidateResult.folderCount} 个`]
      if (candidateResult.directAssetCount) noteParts.push(`直接素材 ${candidateResult.directAssetCount} 个`)
      if (candidateResult.folderErrors.length) noteParts.push(`列目录失败 ${candidateResult.folderErrors.length} 个`)
      if (Array.isArray(options.retryFailedPaths) && options.retryFailedPaths.length) noteParts.push(`失败清单命中 0 个`)
      rows.push(rowForNotice(inputCode, sourceType, '未匹配到可处理素材', '未匹配到素材', noteParts.join('；')))
      for (const error of candidateResult.folderErrors.slice(0, 5)) {
        rows.push(rowForNotice(inputCode, sourceType, '款号文件夹列目录失败', '已跳过', error))
      }
      return { rows, downloadItems }
    }

    for (let index = 0; index < candidates.length; index += 1) {
      const item = candidates[index]
      const classification = classifySopAsset(sourceType, item)
      if (!classification.keep) {
        rows.push(rowForAsset(inputCode, sourceType, item, classification))
        continue
      }

      const baseRow = rowForAsset(inputCode, sourceType, item, classification, {
        '__code_index': codeIndex,
        '__total_codes': totalCodes,
      })

      try {
        const info = await fetchFileInfo(sourceConfig.mountId, item?.fullpath || '')
        const downloadUrl = String(info?.uri || (Array.isArray(info?.uris) ? info.uris[0] : '') || '').trim()
        if (!downloadUrl) {
          rows.push({
            ...baseRow,
            '下载结果': '获取下载链接失败',
            '备注': 'file/info 未返回 uri',
          })
          continue
        }

        const runtimeFilename = buildRuntimeFilename(inputCode, sourceType, item, index)
        rows.push({
          ...baseRow,
          '__runtime_filename': runtimeFilename,
        })
        downloadItems.push({
          url: downloadUrl,
          filename: runtimeFilename,
          label: `${SOURCE_LABELS[sourceType] || sourceType} / ${inputCode} / ${item?.filename || runtimeFilename}`,
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

    for (const error of candidateResult.folderErrors.slice(0, 5)) {
      rows.push(rowForNotice(inputCode, sourceType, '款号文件夹列目录失败', '已跳过', error))
    }

    return { rows, downloadItems }
  }

  async function buildCodePlan(inputCode, sourceConfigs, codeIndex, totalCodes, options = {}) {
    const rows = []
    const downloadItems = []
    for (const sourceType of ['model', 'still']) {
      const plan = await buildSourcePlan(inputCode, sourceType, sourceConfigs[sourceType], codeIndex, totalCodes, options)
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
      normalizeRetryFailedPlan,
      normalizeFullpathKey,
      filterRetryFailedItems,
      classifyCode,
      getGroupCode,
      getExt,
      isSupportedAssetItem,
      isModelWhiteBackgroundFilename,
      startsWithCodeToken,
      isSkcLikeStemForSpu,
      matchesFilenameCode,
      pathContainsCode,
      matchesAssetItemForCode,
      matchesFolderItemForCode,
      isPackagingFolderItem,
      deriveBroadSourcePrefix,
      isWithinBroadSourceScope,
      normalizeDuplicateMode,
      normalizeFolderScanDepth,
      normalizeDownloadConcurrency,
      dedupeItemsByFullpath,
      buildFolderHashRoute,
      buildSearchHashRoute,
      classifySopAsset,
      inferSopPdfType,
      collectCandidateAssets,
      buildRuntimeFilename,
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
      const stillPath = parseCloudPath(params.still_cloud_path)
      const modelPath = parseCloudPath(params.model_cloud_path)
      const retryPlan = normalizeRetryFailedPlan(params.retry_failed_file)
      const manualCodes = normalizeCodes(params.item_codes)
      const codes = retryPlan.active ? retryPlan.codes : manualCodes
      if (!codes.length) throw new Error('请至少输入一个款号/款色编码，或选择上一轮结果表重跑失败清单')

      const stillMount = await resolveMountId(stillPath.mountName)
      const modelMount = compact(modelPath.mountName) === compact(stillPath.mountName)
        ? stillMount
        : await resolveMountId(modelPath.mountName)

      const duplicateMode = normalizeDuplicateMode(params.duplicate_mode)
      const folderScanDepth = normalizeFolderScanDepth(params.folder_scan_depth)
      const downloadConcurrency = normalizeDownloadConcurrency(params.download_concurrency)

      return nextPhase('ensure_folder', 0, {
        source_configs: {
          still: {
            mountId: stillMount.mountId,
            mountName: stillMount.mountName,
            cloudPath: stillPath.raw,
            relativePath: stillPath.relativePath,
            broadRelativePath: deriveBroadSourcePrefix(stillPath.relativePath, 'still'),
          },
          model: {
            mountId: modelMount.mountId,
            mountName: modelMount.mountName,
            cloudPath: modelPath.raw,
            relativePath: modelPath.relativePath,
            broadRelativePath: deriveBroadSourcePrefix(modelPath.relativePath, 'model'),
          },
        },
        folder_hash: buildFolderHashRoute(stillMount.mountId, stillPath.relativePath),
        duplicate_mode: duplicateMode,
        folder_scan_depth: folderScanDepth,
        download_concurrency: downloadConcurrency,
        download_retry_attempts: DOWNLOAD_RETRY_ATTEMPTS,
        retry_failed_paths: retryPlan.paths,
        retry_failed_count: retryPlan.failedCount,
        retry_failed_only: retryPlan.active,
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
        current_store: retryPlan.active ? `深绘上新图包整理 / 重跑失败 ${retryPlan.failedCount}` : '深绘上新图包整理',
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

      const stillConfig = (shared.source_configs || {}).still || {}
      const targetHash = buildSearchHashRoute(stillConfig.mountId, currentCode)
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
      const sourceConfigs = shared.source_configs || {}

      const plan = await buildCodePlan(
        currentCode,
        sourceConfigs,
        codeIndex + 1,
        codes.length,
        {
          duplicateMode: shared.duplicate_mode,
          folderScanDepth: shared.folder_scan_depth,
          retryFailedPaths: shared.retry_failed_paths,
        },
      )

      const baseShared = {
        ...shared,
        current_exec_no: codeIndex + 1,
        current_buyer_id: currentCode,
        current_store: `深绘上新图包整理 / ${getGroupCode(currentCode)}${shared.retry_failed_only ? ' / 重跑失败' : ''}`,
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
          download_retry_attempts: DOWNLOAD_RETRY_ATTEMPTS,
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
