;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'init'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const SEARCH_SCOPE = '["filename", "tag"]'
  const SEARCH_PAGE_SIZE = 100
  const FOLDER_PAGE_SIZE = 200
  const MAX_MODEL_IMAGES_PER_ROW = 500
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'])
  const DOWNLOAD_CONCURRENCY = 8
  const DOWNLOAD_RETRY_ATTEMPTS = 3
  const DOWNLOAD_RETRY_DELAY_MS = 1200
  const DEFAULT_MODEL_FOLDER_SCAN_DEPTH = 4
  const MAX_MODEL_FOLDER_SCAN_DEPTH = 4
  const DEFAULT_MODEL_SCAN_MAX_FOLDERS = 500
  const DEFAULT_MODEL_FILE_INFO_BATCH_SIZE = 5
  const CLOUD_REQUEST_TIMEOUT_MS = 60000
  const DEFAULT_FLAT_CLOUD_PATH = '巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/'

  const INVALID_MODEL_NAME_PATTERN = /(平铺|静物|细节|详情|吊牌|洗唛|尺码|尺寸|包装|包裝|色卡|面料|辅料|logo|主图|透明底|抠图|pdf|zip)/i
  const INVALID_FLAT_NAME_PATTERN = /(模拍|真人|买家秀|买家秀|场景|穿搭|详情|吊牌|洗唛|尺码|尺寸|包装|包裝|色卡|视频|mp4|pdf|zip)/i

  function compact(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function compactCode(value) {
    return String(value || '').replace(/\s+/g, '').trim()
  }

  function normalizeHeaderKey(value) {
    return compact(value).toLowerCase().replace(/[\s_./\\\-：:（）()]+/g, '')
  }

  function toSafeFilename(value, fallback = 'file') {
    const text = String(value || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
    return text.replace(/^_+|_+$/g, '') || fallback
  }

  function getRowEntries(row) {
    if (!row || typeof row !== 'object') return []
    return Object.entries(row)
      .map(([key, value]) => ({
        rawKey: String(key || ''),
        normalizedKey: normalizeHeaderKey(key),
        value: compact(value),
      }))
      .filter(item => item.rawKey)
  }

  function findRowValue(row, aliases) {
    const aliasSet = new Set((Array.isArray(aliases) ? aliases : []).map(normalizeHeaderKey))
    const match = getRowEntries(row).find(item => aliasSet.has(item.normalizedKey) && item.value)
    return match ? match.value : ''
  }

  function parseCloudPath(rawValue, label = '云盘路径') {
    const raw = String(rawValue || '').trim()
    if (!raw) throw new Error(`请填写${label}`)
    const divider = raw.indexOf('//')
    if (divider < 0) throw new Error(`${label}格式不正确，需要使用“挂载点//目录/子目录”`)
    const mountName = compact(raw.slice(0, divider))
    const relativeRaw = raw.slice(divider + 2).replace(/\\/g, '/')
    const relativePath = relativeRaw.split('/').map(compact).filter(Boolean).join('/')
    if (!mountName) throw new Error(`${label}缺少挂载点名称`)
    return {
      mountName,
      relativePath,
      relativePrefix: relativePath ? `${relativePath}/` : '',
      raw,
    }
  }

  function normalizePath(value) {
    return String(value || '').replace(/\\/g, '/').split('/').map(compact).filter(Boolean).join('/')
  }

  function parentPath(value) {
    const normalized = normalizePath(value)
    if (!normalized) return ''
    const parts = normalized.split('/')
    parts.pop()
    return parts.join('/')
  }

  function relativeModelSubfolder(fullpath, rootPath) {
    const parent = parentPath(fullpath)
    const root = normalizePath(rootPath)
    if (!parent || !root || parent === root) return ''
    if (parent.startsWith(`${root}/`)) return parent.slice(root.length + 1)
    const marker = `/${root}/`
    const markerIndex = parent.indexOf(marker)
    if (markerIndex >= 0) return parent.slice(markerIndex + marker.length)
    return ''
  }

  function isImageItem(item) {
    const ext = String(item?.ext || '').trim().toLowerCase()
    return IMAGE_EXTS.has(ext)
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

  function styleCodeFromSkc(code) {
    const raw = compactCode(code)
    if (!raw) return ''
    if (raw.includes('-')) return raw.split('-', 1)[0] || raw
    const normalized = raw.replace(/-/g, '')
    if (/^[A-Za-z0-9]+$/.test(normalized) && normalized.length >= 17) {
      return normalized.slice(0, -5)
    }
    return raw
  }

  function hyphenatedStyleColorCode(code) {
    const raw = compactCode(code)
    if (!raw) return ''
    if (raw.includes('-')) return raw
    const normalized = raw.replace(/-/g, '')
    if (/^[A-Za-z0-9]+$/.test(normalized) && normalized.length >= 17) {
      return `${normalized.slice(0, -5)}-${normalized.slice(-5)}`
    }
    return raw
  }

  function styleColorSearchCodes(code) {
    const raw = compactCode(code)
    const variants = []
    const push = value => {
      const normalized = compactCode(value)
      if (normalized && !variants.includes(normalized)) variants.push(normalized)
    }
    push(raw)
    push(hyphenatedStyleColorCode(raw))
    push(raw.replace(/-/g, ''))
    push(styleCodeFromSkc(raw))
    return variants
  }

  function isWithinRelativePath(fullpath, relativePath) {
    const target = normalizePath(relativePath)
    if (!target) return true
    const full = normalizePath(fullpath)
    return full === target ||
      full.startsWith(`${target}/`) ||
      full.endsWith(`/${target}`) ||
      full.includes(`/${target}/`)
  }

  function normalizeListedItem(item, parentFullpath = '') {
    const filename = compact(item?.filename || item?.name)
    const fullpath = normalizePath(item?.fullpath || item?.path || item?.webpath || '')
    return {
      ...(item || {}),
      filename,
      fullpath: fullpath || normalizePath(`${parentFullpath}/${filename}`),
      ext: compact(item?.ext || (filename.includes('.') ? filename.split('.').pop() : '')).toLowerCase(),
    }
  }

  function extractItems(payload) {
    if (Array.isArray(payload)) return payload
    for (const key of ['list', 'items', 'files', 'data']) {
      const value = payload?.[key]
      if (Array.isArray(value)) return value
      if (Array.isArray(value?.list)) return value.list
      if (Array.isArray(value?.items)) return value.items
    }
    return []
  }

  function extractTotal(payload, fallback) {
    const candidates = [
      payload?.total,
      payload?.count,
      payload?.data?.total,
      payload?.data?.count,
    ]
    for (const value of candidates) {
      const total = Number(value)
      if (Number.isFinite(total) && total >= 0) return total
    }
    return fallback
  }

  function filterModelShotItems(items, relativePath, options = {}) {
    const maxItems = Math.max(1, Math.min(500, Number(options.maxItems || MAX_MODEL_IMAGES_PER_ROW)))
    const seen = new Set()
    const result = []
    for (const item of Array.isArray(items) ? items : []) {
      if (isDirectoryItem(item) || !isImageItem(item)) continue
      if (!isWithinRelativePath(item?.fullpath, relativePath)) continue
      const filename = compact(item?.filename)
      const pathText = `${filename} ${item?.fullpath || ''}`
      if (INVALID_MODEL_NAME_PATTERN.test(pathText)) continue
      const key = compact(item?.fullpath || filename).toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      result.push(item)
      if (result.length >= maxItems) break
    }
    return result
  }

  function normalizeModelFolderScanDepth(value) {
    if (value === undefined || value === null || value === '') return DEFAULT_MODEL_FOLDER_SCAN_DEPTH
    const depth = Number(value)
    if (!Number.isFinite(depth)) return DEFAULT_MODEL_FOLDER_SCAN_DEPTH
    return Math.max(0, Math.min(MAX_MODEL_FOLDER_SCAN_DEPTH, Math.floor(depth)))
  }

  function normalizeModelScanMaxFolders(value) {
    const total = Number(value || DEFAULT_MODEL_SCAN_MAX_FOLDERS)
    if (!Number.isFinite(total)) return DEFAULT_MODEL_SCAN_MAX_FOLDERS
    return Math.max(1, Math.min(500, Math.floor(total)))
  }

  function normalizeModelFileInfoBatchSize(value) {
    const total = Number(value || DEFAULT_MODEL_FILE_INFO_BATCH_SIZE)
    if (!Number.isFinite(total)) return DEFAULT_MODEL_FILE_INFO_BATCH_SIZE
    return Math.max(1, Math.min(100, Math.floor(total)))
  }

  function shouldEnforceUsageRecordMode(value) {
    return compact(value || 'enforce').toLowerCase() !== 'ignore'
  }

  async function collectModelShotItems(mountId, rootPath, options = {}) {
    const maxItems = Math.max(1, Math.min(500, Number(options.maxItems || MAX_MODEL_IMAGES_PER_ROW)))
    const scanDepth = normalizeModelFolderScanDepth(options.scanDepth)
    const maxFolders = normalizeModelScanMaxFolders(options.maxFolders)
    const listItems = typeof options.listItems === 'function' ? options.listItems : listFolderItems
    const queue = [{ path: normalizePath(rootPath), depth: 0 }]
    const seenFolders = new Set()
    const allItems = []
    let scannedFolders = 0
    let truncated = false

    while (queue.length) {
      if (scannedFolders >= maxFolders) {
        truncated = true
        break
      }
      const current = queue.shift()
      const folderPath = normalizePath(current?.path)
      if (!folderPath || seenFolders.has(folderPath)) continue
      seenFolders.add(folderPath)
      scannedFolders += 1
      const listed = await listItems(mountId, folderPath)
      for (const rawItem of Array.isArray(listed) ? listed : []) {
        const item = normalizeListedItem(rawItem, folderPath)
        allItems.push(item)
        if (current.depth < scanDepth && isDirectoryItem(item)) {
          const childPath = normalizePath(item?.fullpath || `${folderPath}/${item?.filename || ''}`)
          if (childPath && !seenFolders.has(childPath)) {
            queue.push({ path: childPath, depth: current.depth + 1 })
          }
        }
      }
    }

    return {
      items: filterModelShotItems(allItems, rootPath, { maxItems }),
      scannedFolders,
      scannedItems: allItems.length,
      scannedImages: allItems.filter(item => !isDirectoryItem(item) && isImageItem(item)).length,
      scannedDirectories: allItems.filter(item => isDirectoryItem(item)).length,
      truncated,
    }
  }

  function scoreFlatReferenceItem(item, styleColorCode) {
    const stem = compactCode(getFileStem(item?.filename || '')).toLowerCase()
    const variants = styleColorSearchCodes(styleColorCode).map(value => value.toLowerCase())
    const skc = variants[0] || ''
    const hyphenated = hyphenatedStyleColorCode(styleColorCode).toLowerCase()
    const noHyphen = compactCode(styleColorCode).replace(/-/g, '').toLowerCase()
    const spu = styleCodeFromSkc(styleColorCode).toLowerCase()
    if (!stem || !skc) return 0
    if (hyphenated && stem === hyphenated) return 102
    if (stem === skc) return 100
    if (noHyphen && stem === noHyphen) return 98
    if (hyphenated && (stem.startsWith(`${hyphenated}_`) || stem.startsWith(`${hyphenated}-`))) return 94
    if (stem.startsWith(`${skc}_`) || stem.startsWith(`${skc}-`)) return 92
    if (noHyphen && (stem.startsWith(`${noHyphen}_`) || stem.startsWith(`${noHyphen}-`))) return 88
    if (hyphenated && stem.includes(hyphenated)) return 86
    if (stem.includes(skc)) return 84
    if (noHyphen && stem.includes(noHyphen)) return 82
    if (spu && stem === spu) return 54
    if (spu && stem.startsWith(`${spu}-`)) return 46
    if (spu && stem.includes(spu)) return 36
    return 0
  }

  function filterFlatReferenceItems(items, styleColorCode, relativePath) {
    return (Array.isArray(items) ? items : [])
      .filter(item => !isDirectoryItem(item))
      .filter(isImageItem)
      .filter(item => isWithinRelativePath(item?.fullpath, relativePath))
      .filter(item => !INVALID_FLAT_NAME_PATTERN.test(`${item?.filename || ''} ${item?.fullpath || ''}`))
      .map(item => ({ item, score: scoreFlatReferenceItem(item, styleColorCode) }))
      .filter(entry => entry.score > 0)
      .sort((left, right) => right.score - left.score || String(left.item?.filename || '').localeCompare(String(right.item?.filename || '')))
      .map(entry => entry.item)
  }

  function normalizeBuyerShowRows(rows) {
    const jobs = []
    const invalidRows = []
    for (let index = 0; index < (Array.isArray(rows) ? rows.length : 0); index += 1) {
      const raw = rows[index] || {}
      const rowNo = index + 2
      const orderNo = findRowValue(raw, ['订单号', '订单编号'])
      const styleColorCode = findRowValue(raw, ['款色号', '款色编码', 'SKC', 'skc'])
      const size = findRowValue(raw, ['尺码', '规格'])
      const uniqueValue = findRowValue(raw, ['唯一值', '唯一键']) || compact(`${orderNo}${styleColorCode}`)
      const modelCloudPath = findRowValue(raw, ['AI素材库路径', 'AI 素材库路径', '素材库路径', '模拍路径', '买家秀图库路径'])
      const packageName = findRowValue(raw, ['AI图包文件夹命名', 'AI 图包文件夹命名', '图包文件夹命名']) || uniqueValue
      const targetAddress = findRowValue(raw, ['存放地址', '回传地址', '输出地址'])

      const base = {
        '表格行号': rowNo,
        '订单号': orderNo,
        '款色号': styleColorCode,
        '货号': styleCodeFromSkc(styleColorCode),
        '尺码': size,
        '唯一值': uniqueValue,
        'AI素材库路径': modelCloudPath,
        'AI图包文件夹命名': packageName,
        '存放地址': targetAddress,
        '__source_row': raw,
      }
      if (!styleColorCode || !modelCloudPath) {
        invalidRows.push({
          ...base,
          '模拍下载结果': '参数缺失',
          '平铺下载结果': '',
          '生图结果': '参数缺失',
          '备注': !styleColorCode ? '缺少款色号' : '缺少 AI素材库路径',
        })
        continue
      }
      jobs.push(base)
    }
    return { jobs, invalidRows }
  }

  function buildFolderHashRoute(mountId, relativePath) {
    const base = `#/home/file/mount/${encodeURIComponent(String(mountId || '').trim())}`
    const normalized = normalizePath(relativePath)
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
        shared_key: options.shared_key || 'download_result',
        shared_append: false,
        strict: false,
        concurrency: Number(options.concurrency || DOWNLOAD_CONCURRENCY),
        retry_attempts: Number(options.retry_attempts || DOWNLOAD_RETRY_ATTEMPTS),
        retry_delay_ms: Number(options.retry_delay_ms || DOWNLOAD_RETRY_DELAY_MS),
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
    const { timeoutMs, timeout_ms: timeoutMsAlias, ...fetchInit } = init || {}
    const timeout = Number(timeoutMs || timeoutMsAlias || 0)
    const controller = timeout > 0 && typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null
    let response
    try {
      response = await fetch(url, { credentials: 'include', ...fetchInit, ...(controller ? { signal: controller.signal } : {}) })
    } catch (error) {
      if (String(error?.name || '') === 'AbortError') {
        throw new Error(`请求超时 ${timeout}ms: ${String(url || '').split('?')[0]}`)
      }
      throw error
    } finally {
      if (timer) clearTimeout(timer)
    }
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

  async function resolveMountId(mountName, mountCache = {}) {
    const key = compact(mountName)
    if (mountCache[key]) return mountCache[key]
    const mounts = await fetchMounts()
    const target = mounts.find(item => compact(item?.org_name) === key)
    if (!target) throw new Error(`未找到挂载点：${mountName}`)
    mountCache[key] = {
      mountId: String(target.mount_id || ''),
      mountName: compact(target.org_name),
    }
    return mountCache[key]
  }

  async function searchFiles(mountId, keyword) {
    const all = []
    let start = 0
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
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        timeoutMs: CLOUD_REQUEST_TIMEOUT_MS,
      })
      const items = extractItems(payload).map(item => normalizeListedItem(item))
      const total = extractTotal(payload, start + items.length)
      all.push(...items)
      if (!items.length) break
      start += items.length
      if (start >= total) break
    }
    return all
  }

  async function searchFilesForKeywords(mountId, keywords) {
    const all = []
    const seen = new Set()
    for (const keyword of Array.isArray(keywords) ? keywords : []) {
      const clean = compactCode(keyword)
      if (!clean) continue
      const items = await searchFiles(mountId, clean)
      for (const item of items) {
        const key = `${normalizePath(item?.fullpath)}::${compact(item?.filename).toLowerCase()}`
        if (!key || seen.has(key)) continue
        seen.add(key)
        all.push(item)
      }
    }
    return all
  }

  async function listFolderItems(mountId, fullpath) {
    const all = []
    let start = 0
    while (true) {
      const query = new URLSearchParams({
        order: 'filename asc',
        size: String(FOLDER_PAGE_SIZE),
        start: String(start),
        fullpath: String(fullpath || ''),
        path: String(fullpath || ''),
        mount_id: String(mountId || ''),
        current: '1',
      })
      const payload = await fetchJson(`/fengcloud/1/file/ls?${query.toString()}`, { timeoutMs: CLOUD_REQUEST_TIMEOUT_MS })
      const items = extractItems(payload).map(item => normalizeListedItem(item, fullpath))
      const total = extractTotal(payload, start + items.length)
      all.push(...items)
      if (!items.length) break
      start += items.length
      if (start >= total) break
    }
    return all
  }

  async function fetchFileInfo(mountId, fullpath) {
    const query = new URLSearchParams({ fullpath: String(fullpath || ''), mount_id: String(mountId || '') })
    return fetchJson(`/fengcloud/2/file/info?${query.toString()}`, { timeoutMs: CLOUD_REQUEST_TIMEOUT_MS })
  }

  function downloadUrlFromInfo(info) {
    return compact(info?.uri || (Array.isArray(info?.uris) ? info.uris[0] : '') || info?.url)
  }

  function buildRuntimeFilename(prefix, row, item, index) {
    const ext = compact(item?.ext || (item?.filename || '').split('.').pop()).toLowerCase()
    const suffix = ext ? `.${ext}` : ''
    const stem = toSafeFilename([
      prefix,
      row['唯一值'] || row['款色号'] || row['货号'],
      index + 1,
      getFileStem(item?.filename || ''),
    ].filter(Boolean).join('__'), prefix)
    return suffix && !stem.toLowerCase().endsWith(suffix) ? `${stem}${suffix}` : stem
  }

  async function ensureDownloadItem(item, row, kind, downloadItems, downloadIndexByKey, mountId, filenameIndex, baseDownloadOffset = 0) {
    const fullpath = normalizePath(item?.fullpath)
    const key = `${kind}:${mountId}:${fullpath}`
    if (downloadIndexByKey[key] !== undefined) return downloadIndexByKey[key]
    const info = await fetchFileInfo(mountId, fullpath)
    const url = downloadUrlFromInfo(info)
    if (!url) throw new Error('file/info 未返回 uri')
    const index = Number(baseDownloadOffset || 0) + downloadItems.length
    downloadIndexByKey[key] = index
    downloadItems.push({
      url,
      filename: buildRuntimeFilename(kind, row, item, filenameIndex),
      label: `${kind === 'model' ? '模拍' : '平铺'} / ${row['款色号']} / ${item?.filename || ''}`,
    })
    return index
  }

  async function collectJobRows(job, sharedState, jobIndex, totalJobs) {
    const mountCache = sharedState.mount_cache || {}
    const flatConfig = sharedState.flat_config
    const flatMount = sharedState.flat_mount
    const modelConfig = parseCloudPath(job['AI素材库路径'], 'AI素材库路径')
    const modelMount = await resolveMountId(modelConfig.mountName, mountCache)
    let activePlan = sharedState.active_job_plan
    if (!activePlan || Number(activePlan.job_index) !== Number(jobIndex - 1) || compact(activePlan.style_color_code) !== compact(job['款色号'])) {
      const modelScan = await collectModelShotItems(modelMount.mountId, modelConfig.relativePath, {
        maxItems: sharedState.max_model_images_per_row || MAX_MODEL_IMAGES_PER_ROW,
        scanDepth: sharedState.model_folder_scan_depth,
        maxFolders: sharedState.model_folder_scan_max_folders,
      })
      const searchKeywords = styleColorSearchCodes(job['款色号'])
      const searchItems = await searchFilesForKeywords(flatMount.mountId, searchKeywords)
      let flatItems = filterFlatReferenceItems(searchItems, job['款色号'], flatConfig.relativePath)
      if (!flatItems.length) {
        const fallbackItems = await searchFiles(flatMount.mountId, job['货号'])
        flatItems = filterFlatReferenceItems(fallbackItems, job['款色号'], flatConfig.relativePath)
      }
      activePlan = {
        job_index: jobIndex - 1,
        style_color_code: job['款色号'],
        model_items: modelScan.items,
        model_scan: modelScan,
        flat_item: flatItems[0] || null,
        flat_search_count: searchItems.length,
      }
    }

    const modelScan = activePlan.model_scan || {}
    const allModelItems = Array.isArray(activePlan.model_items) ? activePlan.model_items : []
    const modelItemOffset = Math.max(0, Number(sharedState.model_item_offset || 0))
    const modelFileInfoBatchSize = normalizeModelFileInfoBatchSize(sharedState.model_file_info_batch_size)
    const modelItems = allModelItems.slice(modelItemOffset, modelItemOffset + modelFileInfoBatchSize)
    const nextModelItemOffset = Math.min(modelItemOffset + modelItems.length, allModelItems.length)
    const jobDone = nextModelItemOffset >= allModelItems.length
    const flatItem = activePlan.flat_item || null

    const rows = []
    const downloadItems = []
    const baseDownloadOffset = Array.isArray(sharedState.pending_download_items) ? sharedState.pending_download_items.length : 0
    const downloadIndexByKey = { ...(sharedState.download_index_by_key || {}) }
    const batchSeenUsage = new Set(Array.isArray(sharedState.batch_seen_usage) ? sharedState.batch_seen_usage : [])
    const enforceUsage = shouldEnforceUsageRecordMode(sharedState.usage_record_mode)

    if (!allModelItems.length) {
      rows.push({
        ...job,
        '模拍文件': '',
        '模拍云盘路径': '',
        '模拍细分文件夹': '',
        '模拍下载结果': '未匹配到模拍图',
        '平铺参考图': flatItem?.filename || '',
        '平铺云盘路径': flatItem?.fullpath || '',
        '平铺下载结果': flatItem ? '' : '未匹配到平铺参考图',
        '备注': `模拍扫描 ${modelScan.scannedFolders} 个文件夹，目录项 ${modelScan.scannedItems} 个，图片 ${modelScan.scannedImages} 张，过滤后 0 张${modelScan.truncated ? '；已达到扫描上限' : ''}`,
      })
      return {
        rows,
        downloadItems,
        downloadIndexByKey,
        batchSeenUsage: Array.from(batchSeenUsage),
        mountCache,
        nextModelItemOffset: 0,
        modelItemCount: 0,
        jobDone: true,
        activeJobPlan: null,
      }
    }

    for (let index = 0; index < modelItems.length; index += 1) {
      const modelItem = modelItems[index]
      const usageKey = `${job['款色号']}::${normalizePath(modelItem?.fullpath)}`
      const modelSubfolder = relativeModelSubfolder(modelItem?.fullpath, modelConfig.relativePath)
      const base = {
        ...job,
        '模拍文件': compact(modelItem?.filename),
        '模拍云盘路径': normalizePath(modelItem?.fullpath),
        '模拍细分文件夹': modelSubfolder,
        '模拍下载结果': '',
        '模拍本地文件': '',
        '平铺参考图': flatItem?.filename || '',
        '平铺云盘路径': flatItem?.fullpath || '',
        '平铺下载结果': '',
        '平铺本地文件': '',
        '生图结果': '待生成',
        '备注': '',
        '__job_index': jobIndex,
        '__total_jobs': totalJobs,
      }

      if (enforceUsage && batchSeenUsage.has(usageKey)) {
        rows.push({
          ...base,
          '模拍下载结果': '已跳过',
          '平铺下载结果': flatItem ? '已跳过' : '未匹配到平铺参考图',
          '生图结果': '已跳过',
          '备注': '本批次同款色号已使用过这张模拍图',
        })
        continue
      }
      if (enforceUsage) batchSeenUsage.add(usageKey)

      base.__model_download_index = await ensureDownloadItem(
        modelItem,
        base,
        'model',
        downloadItems,
        downloadIndexByKey,
        modelMount.mountId,
        modelItemOffset + index,
        baseDownloadOffset,
      )

      if (!flatItem) {
        rows.push({
          ...base,
          '平铺下载结果': '未匹配到平铺参考图',
          '备注': `平铺搜索 ${Number(activePlan.flat_search_count || 0)} 条，过滤后 0 条`,
        })
        continue
      }

      base.__ref_download_index = await ensureDownloadItem(
        flatItem,
        base,
        'flat',
        downloadItems,
        downloadIndexByKey,
        flatMount.mountId,
        0,
        baseDownloadOffset,
      )
      rows.push(base)
    }

    return {
      rows,
      downloadItems,
      downloadIndexByKey,
      batchSeenUsage: Array.from(batchSeenUsage),
      mountCache,
      nextModelItemOffset,
      modelItemCount: allModelItems.length,
      jobDone,
      activeJobPlan: activePlan,
    }
  }

  function applyDownloadResult(row, result, resultKey, pathKey) {
    if (row[resultKey]) return row
    if (!result) {
      return {
        ...row,
        [resultKey]: '下载失败',
        '备注': [compact(row['备注']), '下载结果缺失'].filter(Boolean).join('；'),
      }
    }
    if (result.success) {
      return {
        ...row,
        [resultKey]: '已下载',
        [pathKey]: compact(result.path),
      }
    }
    return {
      ...row,
      [resultKey]: '下载失败',
      '备注': [compact(row['备注']), compact(result.error) || '下载失败'].filter(Boolean).join('；'),
    }
  }

  function finalizeRowsWithDownloads(rows, downloadResult) {
    const items = Array.isArray(downloadResult?.items) ? downloadResult.items : []
    return (Array.isArray(rows) ? rows : []).map(source => {
      let row = { ...source }
      if (row.__model_download_index !== undefined) {
        row = applyDownloadResult(row, items[Number(row.__model_download_index)], '模拍下载结果', '模拍本地文件')
      }
      if (row.__ref_download_index !== undefined) {
        row = applyDownloadResult(row, items[Number(row.__ref_download_index)], '平铺下载结果', '平铺本地文件')
      }
      if (!row['生图结果']) row['生图结果'] = '待生成'
      return row
    })
  }

  function exposeHelpers() {
    if (!testExports || typeof testExports !== 'object') return
    Object.assign(testExports, {
      parseCloudPath,
      normalizeBuyerShowRows,
      filterModelShotItems,
      collectModelShotItems,
      filterFlatReferenceItems,
      finalizeRowsWithDownloads,
      buildFolderHashRoute,
      buildSearchHashRoute,
      relativeModelSubfolder,
      scoreFlatReferenceItem,
      styleCodeFromSkc,
      hyphenatedStyleColorCode,
      styleColorSearchCodes,
      normalizeModelFolderScanDepth,
      normalizeModelScanMaxFolders,
      normalizeModelFileInfoBatchSize,
      shouldEnforceUsageRecordMode,
      collectJobRows,
    })
  }

  exposeHelpers()

  if (phase === '__exports__') {
    return complete([], shared)
  }

  try {
    if (phase === 'init' || phase === 'main') {
      const parsed = normalizeBuyerShowRows(params?.input_file?.rows || [])
      if (!parsed.jobs.length && parsed.invalidRows.length) return complete(parsed.invalidRows, { invalid_rows: parsed.invalidRows })
      if (!parsed.jobs.length) throw new Error('Excel 中没有可执行行，请检查“款色号”和“AI素材库路径”列')
      const flatConfig = parseCloudPath(params.flat_cloud_path || DEFAULT_FLAT_CLOUD_PATH, '平铺参考图库路径')
      const mountCache = {}
      const flatMount = await resolveMountId(flatConfig.mountName, mountCache)
      return nextPhase('plan_job', 0, {
        flat_config: flatConfig,
        flat_mount: flatMount,
        jobs: parsed.jobs,
        invalid_rows: parsed.invalidRows,
        job_index: 0,
        result_rows: [],
        pending_download_items: [],
        download_index_by_key: {},
        batch_seen_usage: [],
        mount_cache: mountCache,
        max_model_images_per_row: Math.max(1, Math.min(500, Number(params.max_model_images_per_row || MAX_MODEL_IMAGES_PER_ROW))),
        model_folder_scan_depth: normalizeModelFolderScanDepth(params.model_folder_scan_depth),
        model_folder_scan_max_folders: normalizeModelScanMaxFolders(params.model_folder_scan_max_folders),
        model_file_info_batch_size: normalizeModelFileInfoBatchSize(params.model_file_info_batch_size),
        usage_record_mode: compact(params.usage_record_mode || 'enforce').toLowerCase(),
        active_job_plan: null,
        model_item_offset: 0,
        total_rows: parsed.jobs.length,
        current_exec_no: 1,
        current_row_no: Number(parsed.jobs[0]?.['表格行号'] || 0),
        current_buyer_id: parsed.jobs[0]?.['款色号'] || '',
        current_store: parsed.jobs[0]?.['AI素材库路径'] || '',
        search_total_codes: parsed.jobs.length,
        search_completed_codes: 0,
      })
    }

    if (phase === 'plan_job') {
      const jobs = Array.isArray(shared.jobs) ? shared.jobs : []
      const jobIndex = Number(shared.job_index || 0)
      const job = jobs[jobIndex]
      if (!job) {
        const downloads = Array.isArray(shared.pending_download_items) ? shared.pending_download_items : []
        if (!downloads.length) {
          return complete([...(Array.isArray(shared.invalid_rows) ? shared.invalid_rows : []), ...(Array.isArray(shared.result_rows) ? shared.result_rows : [])], shared)
        }
        return downloadUrls(downloads, 'finalize_all', {
          shared_key: 'download_result',
          concurrency: DOWNLOAD_CONCURRENCY,
          retry_attempts: DOWNLOAD_RETRY_ATTEMPTS,
          retry_delay_ms: DOWNLOAD_RETRY_DELAY_MS,
        }, shared)
      }

      const plan = await collectJobRows(job, shared, jobIndex + 1, jobs.length)
      const allRows = [...(Array.isArray(shared.result_rows) ? shared.result_rows : []), ...plan.rows]
      const allDownloads = [...(Array.isArray(shared.pending_download_items) ? shared.pending_download_items : []), ...plan.downloadItems]
      const nextIndex = plan.jobDone ? jobIndex + 1 : jobIndex
      const nextJob = jobs[nextIndex]
      const nextOffset = plan.jobDone ? 0 : Number(plan.nextModelItemOffset || 0)
      return nextPhase('plan_job', 0, {
        ...shared,
        job_index: nextIndex,
        model_item_offset: nextOffset,
        result_rows: allRows,
        pending_download_items: allDownloads,
        download_index_by_key: plan.downloadIndexByKey,
        batch_seen_usage: plan.batchSeenUsage,
        active_job_plan: plan.jobDone ? null : plan.activeJobPlan,
        mount_cache: plan.mountCache,
        current_exec_no: Math.min(nextIndex + 1, jobs.length),
        current_row_no: Number((plan.jobDone ? nextJob : job)?.['表格行号'] || job?.['表格行号'] || 0),
        current_buyer_id: (plan.jobDone ? nextJob : job)?.['款色号'] || job?.['款色号'] || '',
        current_store: (plan.jobDone ? nextJob : job)?.['AI素材库路径'] || job?.['AI素材库路径'] || '',
        search_completed_codes: plan.jobDone ? nextIndex : jobIndex,
        current_source_filename: plan.jobDone ? '' : `模拍链接 ${nextOffset}/${plan.modelItemCount || 0}`,
      })
    }

    if (phase === 'finalize_all') {
      const rows = finalizeRowsWithDownloads(shared.result_rows || [], shared.download_result)
      return complete([...(Array.isArray(shared.invalid_rows) ? shared.invalid_rows : []), ...rows], {
        ...shared,
        result_rows: rows,
        generation_total_jobs: rows.filter(row => row['模拍下载结果'] === '已下载' && row['平铺下载结果'] === '已下载').length,
      })
    }

    return complete([...(Array.isArray(shared.invalid_rows) ? shared.invalid_rows : []), ...(Array.isArray(shared.result_rows) ? shared.result_rows : [])], shared)
  } catch (error) {
    return {
      success: false,
      error: String(error?.message || error),
      data: [...(Array.isArray(shared.invalid_rows) ? shared.invalid_rows : []), ...(Array.isArray(shared.result_rows) ? shared.result_rows : [])],
      meta: { action: 'complete', has_more: false, shared },
    }
  }
})()
