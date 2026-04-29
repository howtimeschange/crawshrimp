;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'init'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const SEARCH_SCOPE = '["filename", "tag"]'
  const SEARCH_PAGE_SIZE = 100
  const FOLDER_PAGE_SIZE = 100
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'])
  const DOWNLOAD_CONCURRENCY = 10
  const DOWNLOAD_RETRY_ATTEMPTS = 3
  const DOWNLOAD_RETRY_DELAY_MS = 1200

  const STYLE_CODE_ALIASES = ['款号', '货号', 'spu', 'stylecode', 'style_code']
  const TARGET_ID_ALIASES = ['对应ID', '对应id', '对应Id', '商品ID', '商品id', 'ID', 'id', '素材ID', '搭配购ID']

  function compact(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function normalizeHeaderKey(value) {
    return compact(value)
      .toLowerCase()
      .replace(/[\s_./\\\-：:（）()]+/g, '')
  }

  function getRowEntries(row) {
    if (!row || typeof row !== 'object') return []
    return Object.entries(row)
      .map(([key, value]) => ({
        rawKey: String(key || ''),
        normalizedKey: normalizeHeaderKey(key),
        value: compact(value),
      }))
      .filter(entry => entry.rawKey)
  }

  function findRowValue(row, aliases) {
    const aliasSet = new Set((Array.isArray(aliases) ? aliases : []).map(normalizeHeaderKey))
    return getRowEntries(row).find(entry => aliasSet.has(entry.normalizedKey) && entry.value) || null
  }

  function toSafeFilename(value, fallback = 'file') {
    const text = String(value || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^_+|_+$/g, '')
    return text || fallback
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

  function isDirectoryItem(item) {
    const dir = item?.dir
    return dir === 1 || dir === '1' || dir === true
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

  function isImageItem(item) {
    return !isDirectoryItem(item) && IMAGE_EXTS.has(getExt(item))
  }

  function matchesMatchBuyImageName(filename) {
    const stem = compact(getFileStem(filename))
    return /^3(?:-\d+)?$/.test(stem)
  }

  function pathSegments(fullpath) {
    return String(fullpath || '').replace(/\\/g, '/').split('/').map(compact).filter(Boolean)
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

  function isWithinRelativePath(fullpath, relativePath) {
    const target = String(relativePath || '').trim()
    if (!target) return true
    const normalized = String(fullpath || '').replace(/\\/g, '/')
    return normalized === target || normalized.startsWith(`${target}/`)
  }

  function matchesFolderItemForCode(item, code) {
    if (!isDirectoryItem(item)) return false
    return pathSegments(item?.fullpath || item?.filename || '').some(segment => startsWithCodeToken(segment, code))
  }

  function matchesAssetItemForCode(item, code) {
    if (!isImageItem(item) || !matchesMatchBuyImageName(item?.filename || '')) return false
    return pathSegments(item?.fullpath || item?.filename || '').some(segment => startsWithCodeToken(segment, code))
  }

  function parseDateBoundary(value, endOfDay = false) {
    const text = String(value || '').trim()
    if (!text) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const suffix = endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'
      const parsed = Date.parse(`${text}${suffix}`)
      return Number.isFinite(parsed) ? parsed : null
    }
    const parsed = Date.parse(text)
    return Number.isFinite(parsed) ? parsed : null
  }

  function normalizeUploadTimeRange(rawValue) {
    const raw = rawValue && typeof rawValue === 'object' ? rawValue : {}
    const startText = compact(raw.start)
    const endText = compact(raw.end)
    const startMs = parseDateBoundary(startText, false)
    const endMs = parseDateBoundary(endText, true)
    return {
      start: startText,
      end: endText,
      startMs,
      endMs,
    }
  }

  function parseCloudTimestamp(value) {
    if (value == null || value === '') return null
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 100000000000 ? value * 1000 : value
    }
    const text = String(value || '').trim()
    if (!text) return null
    if (/^\d+(\.\d+)?$/.test(text)) {
      const numeric = Number(text)
      if (Number.isFinite(numeric)) return numeric < 100000000000 ? numeric * 1000 : numeric
    }
    const parsed = Date.parse(text)
    return Number.isFinite(parsed) ? parsed : null
  }

  function getItemTimestampMs(item) {
    const keys = [
      'upload_time',
      'uploadTime',
      'last_dateline',
      'create_dateline',
      'mtime',
      'ctime',
      'update_time',
      'updated_at',
      'modify_time',
      'created_at',
      'create_time',
    ]
    for (const key of keys) {
      const parsed = parseCloudTimestamp(item?.[key])
      if (parsed != null) return parsed
    }
    return null
  }

  function isItemWithinUploadTimeRange(item, range) {
    const timestamp = getItemTimestampMs(item)
    if (timestamp == null) return false
    if (range?.startMs != null && timestamp < range.startMs) return false
    if (range?.endMs != null && timestamp > range.endMs) return false
    return true
  }

  function formatTimestamp(timestampMs) {
    if (timestampMs == null) return ''
    const date = new Date(timestampMs)
    if (!Number.isFinite(date.getTime())) return ''
    const pad = value => String(value).padStart(2, '0')
    return [
      date.getFullYear(),
      '-',
      pad(date.getMonth() + 1),
      '-',
      pad(date.getDate()),
      ' ',
      pad(date.getHours()),
      ':',
      pad(date.getMinutes()),
      ':',
      pad(date.getSeconds()),
    ].join('')
  }

  function normalizeFolderScanDepth(rawValue) {
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) return 3
    return Math.max(0, Math.min(8, Math.floor(parsed)))
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

  function dedupeItemsByFullpath(items) {
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

  function buildPackageFilename(targetId, item, itemIndex) {
    const ext = getExt(item) || 'jpg'
    return `${toSafeFilename(targetId, 'id')}（${itemIndex + 1}）.${ext}`
  }

  function buildRuntimeFilename(job, item, itemIndex) {
    const ext = getExt(item) || 'jpg'
    const suffix = `.${ext}`
    const itemId = String(item?.id || item?.hash || item?.filehash || itemIndex + 1)
    const stem = toSafeFilename(
      `${toSafeFilename(job?.style_code, 'style')}__${toSafeFilename(job?.target_id, 'id')}__${itemId}__${getFileStem(item?.filename || '')}`,
      'download',
    )
    return stem.toLowerCase().endsWith(suffix.toLowerCase()) ? stem : `${stem}${suffix}`
  }

  function normalizeMatchBuyJobs(rows) {
    const jobs = []
    const invalidRows = []

    for (let index = 0; index < (Array.isArray(rows) ? rows.length : 0); index += 1) {
      const row = rows[index] || {}
      const rowNo = index + 2
      const styleCodeEntry = findRowValue(row, STYLE_CODE_ALIASES)
      const targetIdEntry = findRowValue(row, TARGET_ID_ALIASES)
      const styleCode = compact(styleCodeEntry?.value)
      const targetId = compact(targetIdEntry?.value)

      if (!styleCode || !targetId) {
        invalidRows.push({
          '表格行号': rowNo,
          '款号': styleCode,
          '对应ID': targetId,
          '文件名': '',
          '原文件名': '',
          '云盘路径': '',
          '文件时间': '',
          '下载结果': '已跳过',
          '本地文件': '',
          '执行结果': '参数缺失',
          '备注': !styleCode ? '缺少款号' : '缺少对应ID',
        })
        continue
      }

      jobs.push({
        row_no: rowNo,
        style_code: styleCode,
        target_id: targetId,
      })
    }

    return { jobs, invalidRows }
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

  async function fetchFolderPage(mountId, fullpath, start, method, endpoint) {
    const query = new URLSearchParams({
      order: 'filename asc',
      size: String(FOLDER_PAGE_SIZE),
      start: String(start),
      mount_id: String(mountId || ''),
      fullpath: String(fullpath || ''),
      path: String(fullpath || ''),
      current: '1',
    })
    if (method === 'GET') {
      return fetchJson(`${endpoint}?${query.toString()}`)
    }
    return fetchJson(endpoint, {
      method,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: query.toString(),
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

  async function collectDescendantMatchBuyAssets(mountId, folderItem, maxDepth, uploadTimeRange, remainingBudget = { value: 2000 }) {
    const folderPath = String(folderItem?.fullpath || '').trim()
    if (!folderPath || maxDepth <= 0 || remainingBudget.value <= 0) {
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
        const child = await collectDescendantMatchBuyAssets(
          mountId,
          item,
          maxDepth - 1,
          uploadTimeRange,
          remainingBudget,
        )
        assets.push(...child.assets)
        errors.push(...child.errors)
        continue
      }
      if (!isImageItem(item)) continue
      if (!matchesMatchBuyImageName(item?.filename || '')) continue
      if (!isItemWithinUploadTimeRange(item, uploadTimeRange)) continue
      assets.push(item)
      remainingBudget.value -= 1
    }
    return { assets, errors }
  }

  async function collectMatchBuyAssets(styleCode, sourceConfig, options = {}) {
    const uploadTimeRange = options.uploadTimeRange || normalizeUploadTimeRange(options.upload_time_range)
    const searchItems = await searchFiles(sourceConfig.mountId, styleCode)
    const scoped = searchItems.filter(item => isWithinRelativePath(item?.fullpath, sourceConfig.relativePath))
    const matchedFolders = scoped.filter(item => matchesFolderItemForCode(item, styleCode))
    const directAssets = scoped
      .filter(item => matchesAssetItemForCode(item, styleCode))
      .filter(item => isItemWithinUploadTimeRange(item, uploadTimeRange))

    const expandedAssets = []
    const folderErrors = []
    const depth = normalizeFolderScanDepth(options.folderScanDepth)
    if (depth > 0) {
      for (const folder of matchedFolders) {
        const result = await collectDescendantMatchBuyAssets(
          sourceConfig.mountId,
          folder,
          depth,
          uploadTimeRange,
          { value: 2000 },
        )
        expandedAssets.push(...result.assets)
        folderErrors.push(...result.errors)
      }
    }

    const usedDirectAssetFallback = !expandedAssets.length && directAssets.length > 0
    const candidateItems = usedDirectAssetFallback ? directAssets : expandedAssets

    return {
      searchCount: searchItems.length,
      scopeCount: scoped.length,
      folderCount: matchedFolders.length,
      directAssetCount: directAssets.length,
      usedDirectAssetFallback,
      folderErrors,
      items: dedupeItemsByFullpath(candidateItems),
    }
  }

  async function fetchFileInfo(mountId, fullpath) {
    const query = new URLSearchParams({
      fullpath: String(fullpath || ''),
      mount_id: String(mountId || ''),
    })
    return fetchJson(`/fengcloud/2/file/info?${query.toString()}`)
  }

  async function buildMatchBuyPlan(job, sourceConfig, jobIndex, totalJobs, options = {}) {
    const rows = []
    const downloadItems = []
    const candidateResult = await collectMatchBuyAssets(job.style_code, sourceConfig, options)

    if (!candidateResult.items.length) {
      const noteParts = [
        `搜索结果 ${candidateResult.searchCount} 条`,
        `款号文件夹 ${candidateResult.folderCount} 个`,
        `过滤后 0 张`,
      ]
      if (candidateResult.folderErrors.length) noteParts.push(`列目录失败 ${candidateResult.folderErrors.length} 个`)
      rows.push({
        '表格行号': job.row_no,
        '款号': job.style_code,
        '对应ID': job.target_id,
        '文件名': '',
        '原文件名': '',
        '云盘路径': '',
        '文件时间': '',
        '下载结果': '未匹配到图片',
        '本地文件': '',
        '执行结果': '未匹配到图片',
        '备注': noteParts.join('；'),
      })
      for (const error of candidateResult.folderErrors.slice(0, 5)) {
        rows.push({
          '表格行号': job.row_no,
          '款号': job.style_code,
          '对应ID': job.target_id,
          '文件名': '',
          '原文件名': '',
          '云盘路径': '',
          '文件时间': '',
          '下载结果': '已跳过',
          '本地文件': '',
          '执行结果': '款号文件夹列目录失败',
          '备注': error,
        })
      }
      return { rows, downloadItems }
    }

    for (let index = 0; index < candidateResult.items.length; index += 1) {
      const item = candidateResult.items[index]
      const packageFilename = buildPackageFilename(job.target_id, item, index)
      const timestampMs = getItemTimestampMs(item)
      const baseRow = {
        '表格行号': job.row_no,
        '款号': job.style_code,
        '对应ID': job.target_id,
        '文件名': packageFilename,
        '原文件名': String(item?.filename || ''),
        '云盘路径': String(item?.fullpath || ''),
        '文件时间': formatTimestamp(timestampMs),
        '下载结果': '',
        '本地文件': '',
        '执行结果': '',
        '备注': '',
        '__package_filename': packageFilename,
        '__code_index': jobIndex,
        '__total_codes': totalJobs,
      }

      try {
        const info = await fetchFileInfo(sourceConfig.mountId, item?.fullpath || '')
        const downloadUrl = String(info?.uri || (Array.isArray(info?.uris) ? info.uris[0] : '') || '').trim()
        if (!downloadUrl) {
          rows.push({
            ...baseRow,
            '下载结果': '获取下载链接失败',
            '执行结果': '获取下载链接失败',
            '备注': 'file/info 未返回 uri',
          })
          continue
        }

        const runtimeFilename = buildRuntimeFilename(job, item, index)
        rows.push({
          ...baseRow,
          '__runtime_filename': runtimeFilename,
        })
        downloadItems.push({
          url: downloadUrl,
          filename: runtimeFilename,
          label: `${job.style_code} / ${job.target_id} / ${item?.filename || runtimeFilename}`,
          headers: buildDownloadHeaders(),
          no_proxy: true,
        })
      } catch (error) {
        rows.push({
          ...baseRow,
          '下载结果': '获取下载链接失败',
          '执行结果': '获取下载链接失败',
          '备注': String(error?.message || error),
        })
      }
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
        '执行结果': result?.success ? '成功' : '下载失败',
        '备注': result?.success ? row['备注'] || '' : String(result?.error || '下载失败'),
      }
    })
  }

  function exposeHelpers() {
    if (!testExports || typeof testExports !== 'object') return
    Object.assign(testExports, {
      parseCloudPath,
      normalizeHeaderKey,
      normalizeMatchBuyJobs,
      matchesMatchBuyImageName,
      normalizeUploadTimeRange,
      parseCloudTimestamp,
      getItemTimestampMs,
      isItemWithinUploadTimeRange,
      formatTimestamp,
      normalizeFolderScanDepth,
      buildFolderHashRoute,
      buildSearchHashRoute,
      isDirectoryItem,
      getFileStem,
      getExt,
      isImageItem,
      pathSegments,
      startsWithCodeToken,
      isWithinRelativePath,
      matchesFolderItemForCode,
      matchesAssetItemForCode,
      collectMatchBuyAssets,
      buildPackageFilename,
      buildRuntimeFilename,
      buildMatchBuyPlan,
      finalizeRows,
    })
  }

  exposeHelpers()

  if (phase === '__exports__') {
    return complete([], shared)
  }

  try {
    if (phase === 'init' || phase === 'main') {
      const cloudConfig = parseCloudPath(params.cloud_path)
      const uploadTimeRange = normalizeUploadTimeRange(params.upload_time_range)
      if (uploadTimeRange.startMs == null || uploadTimeRange.endMs == null) {
        throw new Error('请选择文件上传时间范围')
      }

      const inputRows = Array.isArray(params.input_file?.rows) ? params.input_file.rows : []
      if (!inputRows.length) throw new Error('请上传包含“款号”“对应ID”的 Excel')

      const normalized = normalizeMatchBuyJobs(inputRows)
      if (!normalized.jobs.length && !normalized.invalidRows.length) {
        throw new Error('Excel 中未读取到任务行')
      }

      const mount = await resolveMountId(cloudConfig.mountName)
      const folderScanDepth = normalizeFolderScanDepth(params.folder_scan_depth)

      return nextPhase('ensure_folder', 0, {
        mount_id: mount.mountId,
        mount_name: mount.mountName,
        cloud_path: cloudConfig.raw,
        relative_path: cloudConfig.relativePath,
        folder_hash: buildFolderHashRoute(mount.mountId, cloudConfig.relativePath),
        upload_time_range: uploadTimeRange,
        folder_scan_depth: folderScanDepth,
        target_jobs: normalized.jobs,
        job_index: 0,
        result_rows: normalized.invalidRows,
        pending_download_items: [],
        total_rows: Math.max(inputRows.length, normalized.jobs.length),
        current_exec_no: normalized.jobs.length ? 1 : inputRows.length,
        current_buyer_id: normalized.jobs[0]?.style_code || '',
        current_store: cloudConfig.relativePath || mount.mountName,
      })
    }

    if (phase === 'ensure_folder') {
      const targetHash = String(shared.folder_hash || buildFolderHashRoute(shared.mount_id, shared.relative_path || ''))
      if (targetHash && location.hash !== targetHash) {
        location.hash = targetHash
        return nextPhase('plan_job', 1500, {
          ...shared,
          folder_hash: targetHash,
        })
      }
      return nextPhase('plan_job', 0, shared)
    }

    if (phase === 'plan_job') {
      const jobs = Array.isArray(shared.target_jobs) ? shared.target_jobs : []
      const jobIndex = Number(shared.job_index || 0)
      const job = jobs[jobIndex] || null

      if (!job) {
        const rows = Array.isArray(shared.result_rows) ? shared.result_rows : []
        return complete(rows, shared)
      }

      return nextPhase('ensure_search', 0, {
        ...shared,
        current_job: job,
        current_exec_no: jobIndex + 1,
        current_buyer_id: job.style_code,
      })
    }

    if (phase === 'ensure_search') {
      const job = shared.current_job || {}
      const styleCode = String(job.style_code || '').trim()
      if (!styleCode) return nextPhase('plan_job', 0, shared)

      const targetHash = buildSearchHashRoute(shared.mount_id, styleCode)
      if (targetHash && location.hash !== targetHash) {
        location.hash = targetHash
        return nextPhase('collect_job', 1500, {
          ...shared,
          search_hash: targetHash,
        })
      }

      return nextPhase('collect_job', 0, {
        ...shared,
        search_hash: targetHash,
      })
    }

    if (phase === 'collect_job') {
      const jobs = Array.isArray(shared.target_jobs) ? shared.target_jobs : []
      const jobIndex = Number(shared.job_index || 0)
      const job = shared.current_job || jobs[jobIndex] || null

      if (!job) return nextPhase('plan_job', 0, shared)

      const plan = await buildMatchBuyPlan(
        job,
        {
          mountId: shared.mount_id,
          relativePath: shared.relative_path,
        },
        jobIndex + 1,
        jobs.length,
        {
          uploadTimeRange: shared.upload_time_range,
          folderScanDepth: shared.folder_scan_depth,
        },
      )

      const allRows = [...(Array.isArray(shared.result_rows) ? shared.result_rows : []), ...plan.rows]
      const allDownloadItems = [...(Array.isArray(shared.pending_download_items) ? shared.pending_download_items : []), ...plan.downloadItems]
      const nextIndex = jobIndex + 1
      const nextJob = jobs[nextIndex] || null

      const baseShared = {
        ...shared,
        result_rows: allRows,
        pending_download_items: allDownloadItems,
        current_exec_no: jobIndex + 1,
        current_buyer_id: job.style_code,
        current_store: shared.relative_path || shared.mount_name || '',
      }

      if (nextJob) {
        return nextPhase('plan_job', 0, {
          ...baseShared,
          job_index: nextIndex,
          current_job: null,
          search_hash: '',
          current_exec_no: nextIndex + 1,
          current_buyer_id: nextJob.style_code,
        })
      }

      if (!allDownloadItems.length) {
        return complete(allRows, {
          ...baseShared,
          pending_download_items: [],
          current_exec_no: jobs.length || shared.total_rows || 0,
        })
      }

      return downloadUrls(
        allDownloadItems,
        'finalize_all',
        {
          shared_key: 'last_download_result',
          strict: false,
          concurrency: DOWNLOAD_CONCURRENCY,
          retry_attempts: DOWNLOAD_RETRY_ATTEMPTS,
          retry_delay_ms: DOWNLOAD_RETRY_DELAY_MS,
        },
        {
          ...baseShared,
          current_exec_no: jobs.length || shared.total_rows || 0,
        },
      )
    }

    if (phase === 'finalize_all') {
      const rows = finalizeRows(shared.result_rows, shared.last_download_result)
      return complete(rows, {
        ...shared,
        result_rows: rows,
        pending_download_items: [],
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
