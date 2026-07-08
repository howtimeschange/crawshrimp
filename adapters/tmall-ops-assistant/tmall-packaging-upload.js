;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'init'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const SEMIR_ENTRY_URL = 'https://fmp.semirapp.com/web/index#/home/file'
  const TMALL_PUBLISH_URL = 'https://sell.publish.tmall.com/tmall/publish.htm'
  const SEARCH_SCOPE = '["filename", "tag"]'
  const SEARCH_PAGE_SIZE = 100
  const FOLDER_PAGE_SIZE = 100
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'])
  const DOWNLOAD_CONCURRENCY = 8
  const DOWNLOAD_RETRY_ATTEMPTS = 3
  const DOWNLOAD_RETRY_DELAY_MS = 1200
  const SEARCH_FALLBACK_FOLDER_LIMIT = 8
  const SEARCH_FALLBACK_IMAGE_LIMIT = 80
  const SEARCH_FALLBACK_ASSET_BUDGET = 1200
  const MIN_USEFUL_FALLBACK_SELECTED_ASSETS = 4
  const PC_DETAIL_MAX_COUNT = 30
  const OCR_DEFAULT_MAX_IMAGES = Number.POSITIVE_INFINITY
  const OCR_PER_IMAGE_TIMEOUT_MS = 18000
  const OCR_TOTAL_TIMEOUT_MS = 120000
  const CRAW_SHRIMP_LOCAL_BASE_URL = 'http://127.0.0.1:18765'
  const TESSERACT_VENDOR_PATH = '/adapter-assets/tmall-ops-assistant/vendor/tesseract'
  const TESSERACT_SCRIPT_URL = `${CRAW_SHRIMP_LOCAL_BASE_URL}${TESSERACT_VENDOR_PATH}/tesseract.min.js`
  const TESSERACT_WORKER_URL = `${CRAW_SHRIMP_LOCAL_BASE_URL}${TESSERACT_VENDOR_PATH}/worker.min.js`
  const TESSERACT_CORE_PATH = `${CRAW_SHRIMP_LOCAL_BASE_URL}${TESSERACT_VENDOR_PATH}`
  const TESSERACT_LANG_PATH = `${CRAW_SHRIMP_LOCAL_BASE_URL}${TESSERACT_VENDOR_PATH}/lang`
  const TESSERACT_LANG = 'chi_sim+eng'
  const UPLOAD_INPUT_ID = 'crawshrimp-tmall-packaging-upload-input'
  const UPLOAD_INPUT_SELECTOR = `#${UPLOAD_INPUT_ID}`
  const PICTURE_CENTER_UPLOAD_ENDPOINT = 'https://stream-upload.taobao.com/api/upload.api'
  const TMALL_PAGE_WAIT_MS = Math.max(3000, Number(params.tmall_page_wait_ms || 3000) || 3000)
  const TMALL_PUBLISH_WAIT_MS = Math.max(8000, Number(params.tmall_publish_wait_ms || 8000) || 8000)
  const TMALL_PUBLISH_CONFIRM_WAIT_MS = Math.max(10000, Number(params.tmall_publish_confirm_wait_ms || 10000) || 10000)
  const TMALL_SPEED_LIMIT_COOLDOWN_MS = Math.max(60000, Number(params.tmall_speed_limit_cooldown_ms || 90000) || 90000)
  const TMALL_UPLOAD_BETWEEN_FILES_MS = Math.max(0, Number(params.tmall_upload_between_files_ms ?? 0) || 0)
  const TMALL_SUBMIT_MODE = compact(params.tmall_submit_mode || 'dom').toLowerCase()
  const TMALL_ALLOW_API_SUBMIT_FALLBACK = params.tmall_allow_api_submit_fallback === true || TMALL_SUBMIT_MODE === 'api' || TMALL_SUBMIT_MODE === 'api_first'
  const TMALL_ALLOW_API_CONFIRM_FALLBACK = params.tmall_allow_api_confirm_fallback === true
  const AGGREGATE_NEW_DESC_HYDRATE_WAIT_ATTEMPTS = Math.max(0, Number(params.aggregate_new_desc_hydrate_wait_attempts ?? 6) || 0)
  const SEMIR_LOGIN_WAIT_MS = Math.max(1000, Number(params.semir_login_wait_ms || 60000) || 60000)
  const SEMIR_LOGIN_RETRY_MS = Math.min(5000, Math.max(1000, Number(params.semir_login_retry_ms || 5000) || 5000))
  const SEMIR_LOGIN_WAIT_MAX_ATTEMPTS = Math.max(1, Math.ceil(SEMIR_LOGIN_WAIT_MS / SEMIR_LOGIN_RETRY_MS))

  const CATEGORY_ORDER = [
    'main_1x1',
    'micro_1x1',
    'main_3x4',
    'micro_3x4',
    'vertical',
    'pc_detail',
  ]
  const CATEGORY_LABELS = {
    main_1x1: '1:1主图',
    micro_1x1: '1:1微详情',
    main_3x4: '3:4主图',
    micro_3x4: '3:4微详情',
    vertical: '商品竖图',
    pc_detail: 'PC详情',
  }
  const CATEGORY_PREFIXES = {
    main_1x1: '01_1比1主图',
    micro_1x1: '02_1比1微详情',
    main_3x4: '03_3比4主图',
    micro_3x4: '04_3比4微详情',
    vertical: '05_商品竖图',
    pc_detail: '06_PC详情',
  }
  const DOWNLOAD_PACKAGE_FOLDER_LABELS = {
    main_1x1: '01_1比1主图',
    micro_1x1: '01_1比1主图',
    main_3x4: '02_3比4主图',
    micro_3x4: '02_3比4主图',
    vertical: '03_商品竖图',
    pc_detail: '04_商详页',
  }
  const REQUIRED_COUNTS = {
    main_1x1: 2,
    micro_1x1: 2,
    main_3x4: 2,
    micro_3x4: 3,
    vertical: 1,
  }
  const TMALL_MAIN_IMAGE_MAX_COUNT = 5
  const MICRO_1X1_MAX_COUNT = 2
  const MICRO_3X4_MAX_COUNT = 3
  const COMMON_IMAGE_DIMENSIONS = new Set([
    640, 700, 720, 750, 800, 900, 950, 960,
    1000, 1080, 1125, 1200, 1242, 1280, 1440, 1500,
    1600, 1920, 2160,
  ])

  function compact(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function normalizeKey(value) {
    return compact(value).toLowerCase().replace(/[\s_./\\\-：:（）()]+/g, '')
  }

  function toSafeFilename(value, fallback = 'file') {
    const text = String(value || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^_+|[ ._]+$/g, '')
    return text || fallback
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

  function isImageItem(item) {
    return !isDirectoryItem(item) && IMAGE_EXTS.has(getExt(item))
  }

  function isDirectoryItem(item) {
    const dir = item?.dir
    return dir === 1 || dir === '1' || dir === true
  }

  function naturalCompare(a, b) {
    return String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN', {
      numeric: true,
      sensitivity: 'base',
    })
  }

  function pathSegments(fullpath) {
    return String(fullpath || '').replace(/\\/g, '/').split('/').map(compact).filter(Boolean)
  }

  function isProductPackagingSegment(segment) {
    return /^0?1[-_\s]*产品包装$/i.test(compact(segment))
  }

  function isUnderProductPackagingDirectory(fullpath) {
    return pathSegments(fullpath).some(isProductPackagingSegment)
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

  function normalizeExecuteMode(value) {
    const mode = compact(value).toLowerCase()
    if (mode === 'upload_draft' || mode === 'live') return 'upload_draft'
    if (mode === 'publish_and_sync_mobile' || mode === 'full_publish' || mode === 'publish_mobile') return 'publish_and_sync_mobile'
    return 'plan'
  }

  function isTmallUploadMode(value) {
    const mode = normalizeExecuteMode(value)
    return mode === 'upload_draft' || mode === 'publish_and_sync_mobile'
  }

  function isFullPublishMode(value) {
    return normalizeExecuteMode(value) === 'publish_and_sync_mobile'
  }

  function normalizeItemId(value) {
    const text = compact(value)
    const match = text.match(/\d{8,}/)
    return match ? match[0] : ''
  }

  function normalizeStyleCode(value) {
    return compact(value)
  }

  function merchantCodeMatchesStyle(merchantCode, styleCode) {
    const merchant = compact(merchantCode).replace(/\s+/g, '')
    const style = normalizeStyleCode(styleCode).replace(/\s+/g, '')
    if (!merchant || !style) return false
    if (merchant === style) return true
    return new RegExp(`^${escapeRegExp(style)}(?:[-_][A-Za-z0-9]{1,8}){1,2}$`).test(merchant)
  }

  function positiveInt(value, fallback = 0) {
    const number = Number.parseInt(value, 10)
    return Number.isFinite(number) && number > 0 ? number : fallback
  }

  function columnValue(row, names = []) {
    if (!row || typeof row !== 'object') return ''
    const normalizedNames = names.map(normalizeKey)
    for (const [key, value] of Object.entries(row)) {
      if (normalizedNames.includes(normalizeKey(key))) return compact(value)
    }
    return ''
  }

  function excelRowNumber(row, index) {
    const explicit = positiveInt(
      row?.__row_number || row?.__row_no || row?.row_no || row?.行号 || row?.源表行号 || row?.表格行号,
      0,
    )
    return explicit || index + 2
  }

  function normalizeItemIds(value) {
    const text = String(value || '').replace(/[，、；;, \t]+/g, '\n')
    const ids = []
    const seen = new Set()
    const pushId = id => {
      if (!id || seen.has(id)) return
      seen.add(id)
      ids.push(id)
    }
    for (const line of text.split(/\r?\n/)) {
      const queryIds = [...String(line || '').matchAll(/(?:[?&]|^)(?:id|item_id|itemId|itemIdNum)=([0-9]{8,})/gi)]
        .map(match => match[1])
      if (queryIds.length) {
        queryIds.forEach(pushId)
        continue
      }
      const found = line.match(/\d{8,}/g) || []
      found.forEach(pushId)
    }
    return ids
  }

  const STYLE_CODE_COLUMNS = [
    '款号',
    '编码',
    '商品编码',
    '商品款号',
    '商家编码',
    '货号',
    'style_code',
    'styleCode',
    'item_codes',
    'spu_code',
    'SPU',
  ]
  const TMALL_ITEM_ID_COLUMNS = [
    '天猫商品ID',
    '天猫商品id',
    '商品ID',
    '商品id',
    '宝贝ID',
    '宝贝id',
    '商品链接',
    '宝贝链接',
    '链接',
    'item_id',
    'itemId',
    'tmall_item_id',
    'tmallItemId',
    'product_id',
    'productId',
  ]
  const CLOUD_PATH_COLUMNS = [
    '云盘路径',
    '图包路径',
    '森马云盘路径',
    'cloud_path',
    'cloudPath',
    'semir_path',
    'semirPath',
  ]

  const CANDIDATE_CLOUD_PATH_COLUMNS = [
    '候选云盘路径',
    '候选图包路径',
    '候选目录',
    'candidate_cloud_paths',
    'candidateCloudPaths',
    'fallback_cloud_paths',
    'fallbackCloudPaths',
  ]

  function looksLikeStylePathSegment(segment) {
    const text = compact(segment)
    return /^\d{8,}[A-Za-z0-9_-]*$/i.test(text) || /^[A-Za-z]+\d{8,}[A-Za-z0-9_-]*$/i.test(text)
  }

  function deriveJobCloudPath(rawCloudPath, styleCode, rowCloudPath = '') {
    const override = compact(rowCloudPath)
    if (override) return override
    const raw = String(rawCloudPath || '').trim()
    const target = compact(styleCode)
    if (!raw || !target) return raw

    const divider = raw.indexOf('//')
    const prefix = divider >= 0 ? raw.slice(0, divider + 2) : ''
    const relativeRaw = divider >= 0 ? raw.slice(divider + 2) : raw
    const trailingSlash = /[\\/]$/.test(relativeRaw)
    const parts = relativeRaw.replace(/\\/g, '/').split('/').map(part => part.trim()).filter(Boolean)
    if (!parts.length) return raw
    const lastIndex = parts.length - 1
    if (looksLikeStylePathSegment(parts[lastIndex]) && parts[lastIndex] !== target) {
      parts[lastIndex] = target
      return `${prefix}${parts.join('/')}${trailingSlash ? '/' : ''}`
    }
    return raw
  }

  function splitCloudPathList(value) {
    if (Array.isArray(value)) return value.flatMap(splitCloudPathList)
    return String(value || '')
      .split(/\r?\n|[；;]/)
      .map(compact)
      .filter(Boolean)
  }

  function normalizeCandidateCloudPaths(value, styleCode) {
    const seen = new Set()
    const result = []
    for (const entry of splitCloudPathList(value)) {
      const normalized = deriveJobCloudPath(entry, styleCode)
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      result.push(normalized)
    }
    return result
  }

  function parseBoolean(value, fallback = true) {
    if (value === undefined || value === null || value === '') return fallback
    if (typeof value === 'boolean') return value
    const text = compact(value).toLowerCase()
    if (['0', 'false', '否', 'no', 'off'].includes(text)) return false
    if (['1', 'true', '是', 'yes', 'on'].includes(text)) return true
    return fallback
  }

  function normalizeFolderScanDepth(rawValue) {
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) return 3
    return Math.max(0, Math.min(8, Math.floor(parsed)))
  }

  function normalizePackagingJob(rawParams = params) {
    const styleCode = normalizeStyleCode(rawParams.style_code || rawParams.item_codes || rawParams.spu_code)
    const itemId = normalizeItemId(rawParams.item_id || rawParams.product_id || rawParams.tmall_item_id)
    if (!styleCode) throw new Error('请填写款号')
    if (!itemId) throw new Error('请填写天猫商品ID')
    return {
      row_no: positiveInt(rawParams.row_no || rawParams['表格行号'], 1),
      style_code: styleCode,
      item_id: itemId,
      cloud_path: deriveJobCloudPath(rawParams.cloud_path, styleCode, rawParams.row_cloud_path || rawParams.cloud_path_override),
      candidate_cloud_paths: normalizeCandidateCloudPaths(rawParams.candidate_cloud_paths || rawParams.candidate_cloud_path || rawParams.fallback_cloud_paths, styleCode),
      execute_mode: normalizeExecuteMode(rawParams.execute_mode),
      block_on_style_mismatch: parseBoolean(rawParams.block_on_style_mismatch, false),
      folder_scan_depth: normalizeFolderScanDepth(rawParams.folder_scan_depth),
    }
  }

  function buildParameterErrorRow(rowNo, styleCode, itemId, note) {
    return {
      '表格行号': rowNo || '',
      '款号': styleCode || '',
      '商品ID': itemId || '',
      '图片用途': '',
      '文件名': '',
      '原文件名': '',
      '云盘路径': '',
      '下载结果': '已跳过',
      '本地文件': '',
      '上传结果': '',
      '天猫图片URL': '',
      '天猫货号': '',
      '天猫商家编码': '',
      '页面校验': '',
      '执行结果': '参数错误',
      '备注': note || '款号或天猫商品ID缺失',
    }
  }

  function normalizePackagingJobs(rawParams = params) {
    const rows = Array.isArray(rawParams.input_file?.rows) ? rawParams.input_file.rows : []
    const jobs = []
    const invalidRows = []
    const seen = new Set()
    const addJob = job => {
      const key = `${job.style_code}\n${job.item_id}`
      if (seen.has(key)) {
        invalidRows.push(buildParameterErrorRow(job.row_no, job.style_code, job.item_id, '重复任务已跳过'))
        return
      }
      seen.add(key)
      jobs.push({
        ...job,
        exec_no: jobs.length + 1,
      })
    }

    if (rows.length) {
      rows.forEach((row, index) => {
        const rowNo = excelRowNumber(row, index)
        const styleCode = normalizeStyleCode(columnValue(row, STYLE_CODE_COLUMNS))
        const itemIds = normalizeItemIds(columnValue(row, TMALL_ITEM_ID_COLUMNS))
        const rowCloudPath = columnValue(row, CLOUD_PATH_COLUMNS)
        const rowCandidateCloudPaths = columnValue(row, CANDIDATE_CLOUD_PATH_COLUMNS)
        if (!styleCode || !itemIds.length) {
          const missing = [
            !styleCode ? '款号' : '',
            !itemIds.length ? '天猫商品ID' : '',
          ].filter(Boolean).join('、')
          invalidRows.push(buildParameterErrorRow(rowNo, styleCode, itemIds.join('、'), `缺少${missing}`))
          return
        }
        itemIds.forEach(itemId => addJob({
          row_no: rowNo,
          style_code: styleCode,
          item_id: itemId,
          cloud_path: deriveJobCloudPath(rawParams.cloud_path, styleCode, rowCloudPath),
          candidate_cloud_paths: normalizeCandidateCloudPaths(rowCandidateCloudPaths || rawParams.candidate_cloud_paths || rawParams.candidate_cloud_path || rawParams.fallback_cloud_paths, styleCode),
          execute_mode: normalizeExecuteMode(rawParams.execute_mode),
          block_on_style_mismatch: parseBoolean(rawParams.block_on_style_mismatch, false),
          folder_scan_depth: normalizeFolderScanDepth(rawParams.folder_scan_depth),
        }))
      })
      return { jobs, invalidRows, inputCount: rows.length }
    }

    const job = normalizePackagingJob(rawParams)
    addJob(job)
    return { jobs, invalidRows, inputCount: jobs.length }
  }

  function buildFolderHashRoute(mountId, relativePath) {
    const base = `#/home/file/mount/${encodeURIComponent(String(mountId || '').trim())}`
    const normalized = String(relativePath || '').trim()
    return normalized ? `${base}?path=${encodeURIComponent(normalized)}` : base
  }

  function isCloudMountRouteActive(mountId) {
    const mount = encodeURIComponent(String(mountId || '').trim())
    return !!mount && String(location.hash || '').startsWith(`#/home/file/mount/${mount}`)
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

  function isWithinRelativePath(fullpath, relativePath) {
    const target = String(relativePath || '').trim()
    if (!target) return true
    const normalized = String(fullpath || '').replace(/\\/g, '/')
    return normalized === target || normalized.startsWith(`${target}/`)
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

  function equalsStyleCodeSegment(value, code) {
    const text = compact(value).toLowerCase()
    const target = compact(code).toLowerCase()
    return !!text && !!target && text === target
  }

  function exactStyleFolderPathFromFullpath(fullpath, styleCode) {
    const segments = pathSegments(fullpath)
    const index = segments.findIndex(segment => equalsStyleCodeSegment(segment, styleCode))
    return index >= 0 ? segments.slice(0, index + 1).join('/') : ''
  }

  function isOptimizedStyleFolderSegment(segment, styleCode) {
    const text = compact(segment).toLowerCase()
    const target = compact(styleCode).toLowerCase()
    return !!text && !!target && text === `${target}-优化`
  }

  function optimizedStyleFolderPathFromFullpath(fullpath, styleCode) {
    const segments = pathSegments(fullpath)
    const index = segments.findIndex(segment => isOptimizedStyleFolderSegment(segment, styleCode))
    if (index < 0) return ''
    const before = segments.slice(0, index).join('/')
    if (!/优化/.test(before)) return ''
    return segments.slice(0, index + 1).join('/')
  }

  function matchesStyleFolder(item, styleCode) {
    if (!isDirectoryItem(item)) return false
    const fullpath = String(item?.fullpath || item?.filename || '').replace(/\\/g, '/')
    const styleFolder = exactStyleFolderPathFromFullpath(fullpath, styleCode)
    return !!styleFolder && styleFolder === pathSegments(fullpath).join('/')
  }

  function searchItemMatchesStyle(item, styleCode) {
    if (matchesStyleFolder(item, styleCode)) return true
    const fullpath = String(item?.fullpath || item?.filename || '').replace(/\\/g, '/')
    if (isDirectoryItem(item) && optimizedStyleFolderPathFromFullpath(fullpath, styleCode) === pathSegments(fullpath).join('/')) return true
    if (!isImageItem(item)) return false
    return !!(exactStyleFolderPathFromFullpath(item?.fullpath || '', styleCode) || optimizedStyleFolderPathFromFullpath(item?.fullpath || '', styleCode))
  }

  function isPreferredPackagingSearchItem(item) {
    const fullpath = String(item?.fullpath || item?.path || item?.filename || '').replace(/\\/g, '/')
    if (!fullpath) return false
    if (/\/1-企划拍摄\//.test(fullpath)) return false
    if (!/(^|\/)(?:01-|2-)产品包装(\/|$)|包装图|包装图示/.test(fullpath)) return false
    if (isDirectoryItem(item) && /(^|\/)01-产品包装(\/|$)/.test(fullpath)) return true
    return /(^|\/)2-详情(\/|$)|(^|\/)1-主图(\/|$)|主图微详情|创意拍切图|导购素材|商品竖图|竖图|\/images(\/|$)/.test(fullpath)
  }

  function packagingSearchScore(item) {
    const fullpath = String(item?.fullpath || item?.path || item?.filename || '').replace(/\\/g, '/')
    let score = 0
    if (/\/1-企划拍摄\//.test(fullpath)) score -= 1000
    if (/\/01-产品包装\//.test(fullpath)) score += 100
    if (/\/2-产品包装\//.test(fullpath)) score += 100
    if (/\/2-详情\//.test(fullpath)) score += 80
    if (/\/images(\/|$)/.test(fullpath)) score += 75
    if (/主图微详情/.test(fullpath)) score += 70
    if (/导购切图|创意拍切图/.test(fullpath)) score += 60
    if (/导购素材|商品竖图|竖图/.test(fullpath)) score += 60
    if (/\/1-主图\//.test(fullpath)) score += 50
    if (/包装图|包装图示/.test(fullpath)) score += 40
    if (isDirectoryItem(item)) score += 10
    if (isImageItem(item)) score += 5
    return score
  }

  function selectMountWideSearchItems(searchItems, sourceRelativePath, styleCode) {
    const mountWide = (Array.isArray(searchItems) ? searchItems : [])
      .filter(item => !isWithinRelativePath(item?.fullpath, sourceRelativePath))
      .filter(item => searchItemMatchesStyle(item, styleCode))
    const preferred = mountWide.filter(isPreferredPackagingSearchItem)
    const candidates = preferred
      .slice()
      .sort((a, b) => {
        const scoreDelta = packagingSearchScore(b) - packagingSearchScore(a)
        return scoreDelta || naturalCompare(a.fullpath || a.filename, b.fullpath || b.filename)
      })
    const folders = candidates.filter(item => {
      if (matchesStyleFolder(item, styleCode)) return true
      if (!isDirectoryItem(item)) return false
      const fullpath = String(item?.fullpath || item?.filename || '').replace(/\\/g, '/')
      const optimized = optimizedStyleFolderPathFromFullpath(fullpath, styleCode)
      return !!optimized && optimized === pathSegments(fullpath).join('/')
    }).slice(0, SEARCH_FALLBACK_FOLDER_LIMIT)
    const selectedFolderPaths = folders.map(item => String(item.fullpath || item.filename || '').replace(/\\/g, '/')).filter(Boolean)
    const images = candidates
      .filter(isImageItem)
      .filter(item => {
        const fullpath = String(item.fullpath || '').replace(/\\/g, '/')
        return !selectedFolderPaths.some(folderPath => fullpath.startsWith(`${folderPath}/`))
      })
      .slice(0, SEARCH_FALLBACK_IMAGE_LIMIT)
    return [...folders, ...images]
  }

  function parseDimensionFromText(text) {
    const normalized = String(text || '').replace(/[×X＊*]/g, 'x')
    const match = normalized.match(/(?:^|[^\d])(\d{3,4})\s*[x_-]\s*(\d{3,6})(?=[^\d]|$)/)
    if (!match) return null
    const width = Number(match[1])
    const height = normalizeDimensionToken(match[2])
    if (!(width > 0) || !(height > 0)) return null
    return { width, height }
  }

  function normalizeDimensionToken(rawToken) {
    const token = String(rawToken || '')
    const candidates = []
    for (const length of [4, 3]) {
      if (token.length < length) continue
      const value = Number(token.slice(0, length))
      const suffixLength = token.length - length
      if (value >= 300 && value <= 3000 && suffixLength <= 2) {
        candidates.push({
          value,
          exact: suffixLength === 0,
          suffixLength,
          common: COMMON_IMAGE_DIMENSIONS.has(value),
        })
      }
    }
    if (!candidates.length) return Number(token)
    candidates.sort((a, b) => {
      if (a.exact !== b.exact) return a.exact ? -1 : 1
      if (a.common !== b.common) return a.common ? -1 : 1
      if (a.suffixLength !== b.suffixLength) return a.suffixLength - b.suffixLength
      return b.value - a.value
    })
    return candidates[0].value
  }

  function ratioName(width, height) {
    const w = Number(width || 0)
    const h = Number(height || 0)
    if (!(w > 0) || !(h > 0)) return ''
    const ratio = w / h
    if (Math.abs(ratio - 1) <= 0.03) return '1x1'
    if (Math.abs(ratio - 0.75) <= 0.04) return '3x4'
    if (Math.abs(ratio - (2 / 3)) <= 0.04) return '2x3'
    return ''
  }

  function inferAssetHints(item) {
    const filename = compact(item?.filename || item?.name)
    const fullpath = compact(item?.fullpath || item?.path)
    const haystack = `${filename} ${fullpath}`.toLowerCase()
    const dim = parseDimensionFromText(haystack)
    const ratio = dim ? ratioName(dim.width, dim.height) : ''
    const isMicro = /微详情|微详|微.?detail|micro/.test(haystack)
    const isMain = /主图|main/.test(haystack)
    const isVertical = /竖图|长图|vertical|800\s*x\s*1200|1440\s*x\s*2160/.test(haystack) || ratio === '2x3'
    const isDetail = /详情|detail|pc|电脑|包装图示|包装|参数|尺码|细节|品牌故事/.test(haystack)

    let category = ''
    if (isVertical) category = 'vertical'
    else if (isDetail && !isMain && !isMicro && ratio !== '1x1' && ratio !== '3x4') category = 'pc_detail'
    else if (ratio === '1x1' && isMicro) category = 'micro_1x1'
    else if (ratio === '1x1' && isMain) category = 'main_1x1'
    else if (ratio === '3x4' && isMicro) category = 'micro_3x4'
    else if (ratio === '3x4' && isMain) category = 'main_3x4'

    return {
      filename,
      fullpath,
      dimension: dim || null,
      ratio,
      category,
      isMicro,
      isMain,
      isDetail,
      isVertical,
    }
  }

  function itemKey(item) {
    return compact(item?.fullpath || item?.filename || item?.name).toLowerCase()
  }

  function assignFirst(pool, count, used) {
    const result = []
    for (const item of pool) {
      const key = itemKey(item)
      if (!key || used.has(key)) continue
      used.add(key)
      result.push(item)
      if (result.length >= count) break
    }
    return result
  }

  function normalizedAssetFullpath(item) {
    return String(item?.fullpath || item?.path || item?.filename || item?.name || '').replace(/\\/g, '/')
  }

  function assetFilename(item) {
    return String(item?.filename || item?.name || '').trim()
  }

  function assetText(item) {
    return `${normalizedAssetFullpath(item)} ${assetFilename(item)}`
  }

  function isTmallChannelAsset(item) {
    return /天猫|tmall/i.test(assetText(item))
  }

  function isMainImageFolderAsset(item) {
    const fullpath = normalizedAssetFullpath(item)
    return /(^|\/)(?:1-)?主图(\/|$)|主图微详情/.test(fullpath) && !/(^|\/)微详情(\/|$)/.test(fullpath)
  }

  function isMicroDetailFolderAsset(item) {
    const fullpath = normalizedAssetFullpath(item)
    return /(^|\/)微详情(\/|$)|主图微详情/.test(fullpath)
  }

  const CLOUD_ITEM_TIME_FIELDS = [
    'last_dateline',
    'dateline',
    'update_time',
    'updated_at',
    'updatedAt',
    'modify_time',
    'modified_time',
    'mtime',
    'lastModified',
    'last_modified',
    'lastModifiedTime',
    'file_update_time',
    'fileUpdateTime',
    '更新时间',
    '修改时间',
  ]

  function parseCloudItemTime(value) {
    if (value == null || value === '') return 0
    if (value instanceof Date) {
      const time = value.getTime()
      return Number.isFinite(time) ? time : 0
    }
    const text = String(value).trim()
    if (!text) return 0
    let match = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)
    if (match) {
      const time = new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
        Number(match[6]),
      ).getTime()
      return Number.isFinite(time) ? time : 0
    }
    match = text.match(/^(\d{4})(\d{2})(\d{2})$/)
    if (match) {
      const time = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
      return Number.isFinite(time) ? time : 0
    }
    const numeric = Number(text)
    if (Number.isFinite(numeric) && numeric > 0) {
      if (numeric > 1000000000000) return numeric
      if (numeric > 1000000000) return numeric * 1000
      return numeric
    }
    match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
    if (match) {
      const time = new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4] || 0),
        Number(match[5] || 0),
        Number(match[6] || 0),
      ).getTime()
      return Number.isFinite(time) ? time : 0
    }
    const parsed = Date.parse(text)
    return Number.isFinite(parsed) ? parsed : 0
  }

  function itemUpdatedAtMs(item) {
    if (!item || typeof item !== 'object') return 0
    for (const field of CLOUD_ITEM_TIME_FIELDS) {
      const parsed = parseCloudItemTime(item[field])
      if (parsed) return parsed
    }
    return 0
  }

  function styleRootPathFromFullpath(fullpath, styleCode) {
    return optimizedStyleFolderPathFromFullpath(fullpath, styleCode) || exactStyleFolderPathFromFullpath(fullpath, styleCode)
  }

  function collectStyleRootCandidates(items, styleCode) {
    const roots = new Map()
    ;(Array.isArray(items) ? items : []).forEach((item, index) => {
      const fullpath = normalizedAssetFullpath(item)
      if (!isUnderProductPackagingDirectory(fullpath)) return
      const rootPath = styleRootPathFromFullpath(fullpath, styleCode)
      if (!rootPath) return
      const directRoot = isDirectoryItem(item) && pathSegments(fullpath).join('/') === rootPath
      const timestamp = itemUpdatedAtMs(item)
      const current = roots.get(rootPath) || {
        path: rootPath,
        timestamp: 0,
        rootTimestamp: 0,
        directRoot: false,
        count: 0,
        sourceIndex: index,
      }
      current.count += 1
      current.sourceIndex = Math.min(current.sourceIndex, index)
      if (timestamp > current.timestamp) current.timestamp = timestamp
      if (directRoot) {
        current.directRoot = true
        if (timestamp > current.rootTimestamp) current.rootTimestamp = timestamp
      }
      roots.set(rootPath, current)
    })
    return Array.from(roots.values())
  }

  function selectLatestStyleRoot(items, styleCode) {
    const candidates = collectStyleRootCandidates(items, styleCode)
    if (!candidates.some(candidate => candidate.timestamp || candidate.rootTimestamp)) return null
    candidates.sort((a, b) => {
      const timeDelta = (b.timestamp || b.rootTimestamp || 0) - (a.timestamp || a.rootTimestamp || 0)
      if (timeDelta) return timeDelta
      const directDelta = Number(b.directRoot) - Number(a.directRoot)
      if (directDelta) return directDelta
      return naturalCompare(a.path, b.path)
    })
    return candidates[0] || null
  }

  function itemIsUnderStyleRoot(item, rootPath) {
    const root = String(rootPath || '').replace(/\\/g, '/').replace(/\/+$/, '')
    if (!root) return true
    const fullpath = normalizedAssetFullpath(item).replace(/\/+$/, '')
    return fullpath === root || fullpath.startsWith(`${root}/`)
  }

  function filterItemsByStyleRoot(items, rootPath) {
    return (Array.isArray(items) ? items : []).filter(item => itemIsUnderStyleRoot(item, rootPath))
  }

  function isExactDimension(item, width, height) {
    const dim = item?.__hints?.dimension || inferAssetHints(item).dimension
    return !!dim && dim.width === width && dim.height === height
  }

  function sizePriority(item, preferredSizes = []) {
    const index = preferredSizes.findIndex(size => isExactDimension(item, size[0], size[1]))
    return index >= 0 ? index : preferredSizes.length
  }

  function sortAssetsBySizePriority(items, preferredSizes = []) {
    return (Array.isArray(items) ? items : [])
      .slice()
      .sort((a, b) => {
        const priorityDelta = sizePriority(a, preferredSizes) - sizePriority(b, preferredSizes)
        if (priorityDelta) return priorityDelta
        const sourceDelta = Number(a.__source_index || 0) - Number(b.__source_index || 0)
        return sourceDelta || naturalCompare(a.fullpath || a.filename, b.fullpath || b.filename)
      })
  }

  function preferExactDimensionsIfAvailable(items, preferredSizes = []) {
    const list = Array.isArray(items) ? items : []
    const preferred = list.filter(item => preferredSizes.some(size => isExactDimension(item, size[0], size[1])))
    return preferred.length ? preferred : list
  }

  function selectUploadAssets(pool, maxCount, used) {
    return assignFirst(pool, Math.max(0, Number(maxCount || 0)), used)
  }

  function pcDetailAssetScore(item) {
    const fullpath = String(item?.fullpath || item?.path || '').replace(/\\/g, '/')
    const filename = String(item?.filename || item?.name || '')
    const text = `${fullpath} ${filename}`
    let score = 0
    if (/\/2-详情\//.test(fullpath)) score += 1000
    if (/\/详情\//.test(fullpath)) score += 700
    if (/\/images(\/|$)/i.test(fullpath)) score += 650
    if (/详情|detail|pc|电脑/.test(text)) score += 400
    if (/\/jpg\//i.test(fullpath)) score += 120
    if (/[0-9]{9,}[_-]\d{1,3}\.(?:jpe?g|png|gif|webp)$/i.test(filename)) score += 100
    if (/产品信息|商品信息|宝贝信息|想要的信息看这里|包装图示/.test(text)) score += 80
    if (/主图微详情|微详情|导购切图|创意拍切图|\/(?:1-)?主图(\/|$)/.test(fullpath)) score -= 700
    if (/唯品|vip|京东|抖音|小红书|拼多多|得物/i.test(text)) score -= 800
    if (/尺码|尺码表|洗涤|水洗|吊牌|合格证|品牌故事|售后/.test(text)) score -= 500
    return score
  }

  function isOptimizedPcDetailAsset(item) {
    const fullpath = String(item?.fullpath || item?.path || '').replace(/\\/g, '/')
    return /\/[^/]*优化[^/]*\/[^/]+-优化\/images\//.test(fullpath)
  }

  function sortPcDetailCandidates(items) {
    return (Array.isArray(items) ? items : [])
      .slice()
      .sort((a, b) => {
        const scoreDelta = pcDetailAssetScore(b) - pcDetailAssetScore(a)
        return scoreDelta || naturalCompare(a.fullpath || a.filename, b.fullpath || b.filename)
      })
  }

  function pcDetailSequenceToken(item) {
    const stem = getFileStem(assetFilename(item))
    const match = stem.match(/(?:^|[_\-\s])(\d{1,3})(?:\D*)$/) || stem.match(/(\d{1,3})$/)
    if (!match) return ''
    const value = Number(match[1])
    if (!Number.isFinite(value) || value <= 0 || value > 200) return ''
    return String(value).padStart(3, '0')
  }

  function pcDetailAssetBlockText(items) {
    return (Array.isArray(items) ? items : [])
      .map(item => `${assetFilename(item)} ${normalizedAssetFullpath(item)}`)
      .join(' ')
  }

  function pcDetailBlockLooksGenericTemplate(items) {
    return /模版|模板|template|通用|标准版|固定图|公共图/i.test(pcDetailAssetBlockText(items))
  }

  function pcDetailBlockLooksStyleSpecific(items, styleCode) {
    const style = compact(styleCode)
    if (!style) return false
    return (Array.isArray(items) ? items : [])
      .some(item => startsWithCodeToken(getFileStem(assetFilename(item)), style))
  }

  function dedupePcDetailDuplicateSequences(items, options = {}) {
    const list = Array.isArray(items) ? items.slice() : []
    const styleCode = compact(options.styleCode)
    if (list.length < 6) return { items: list, removed: 0, reason: '' }

    for (let blockSize = Math.floor(list.length / 2); blockSize >= 3; blockSize -= 1) {
      if (list.length % blockSize !== 0) continue
      const repeatCount = list.length / blockSize
      if (repeatCount < 2) continue
      const blocks = Array.from({ length: repeatCount }, (_, index) => list.slice(index * blockSize, (index + 1) * blockSize))
      const signatures = blocks.map(block => block.map(pcDetailSequenceToken))
      if (signatures.some(signature => signature.some(token => !token))) continue
      const firstSignature = signatures[0].join(',')
      if (!firstSignature || !signatures.every(signature => signature.join(',') === firstSignature)) continue

      const styleBlockIndex = styleCode
        ? blocks.findIndex(block => pcDetailBlockLooksStyleSpecific(block, styleCode))
        : -1
      const templateBlockIndex = blocks.findIndex(pcDetailBlockLooksGenericTemplate)
      if (styleBlockIndex < 0 || templateBlockIndex < 0 || styleBlockIndex === templateBlockIndex) continue

      const keptBlock = blocks[styleBlockIndex]
      return {
        items: keptBlock,
        removed: list.length - blockSize,
        reason: `PC详情候选检测到 ${repeatCount} 段重复 ${blockSize} 张序列（款号图+模版图），源素材异常，已保留款号序列并剔除模版重复图`,
      }
    }
    return { items: list, removed: 0, reason: '' }
  }

  function classifyPackagingAssets(items, options = {}) {
    const sorted = (Array.isArray(items) ? items : [])
      .filter(isImageItem)
      .slice()
      .sort((a, b) => naturalCompare(a.fullpath || a.filename, b.fullpath || b.filename))
      .map((item, index) => ({
        ...item,
        __source_index: index,
        __hints: inferAssetHints(item),
      }))

    const byCategory = Object.fromEntries(CATEGORY_ORDER.map(category => [category, []]))
    const used = new Set()
    const exact = category => sorted.filter(item => item.__hints.category === category)
    const detailItems = sorted.filter(item => item.__hints.isDetail)

    const mainTmallAssets = sorted.filter(item => isMainImageFolderAsset(item) && isTmallChannelAsset(item))
    const microAssets = sorted.filter(item => isMicroDetailFolderAsset(item) && !isTmallChannelAsset(item))

    const main1x1Pool = sortAssetsBySizePriority(
      preferExactDimensionsIfAvailable(
        mainTmallAssets.filter(item => item.__hints.ratio === '1x1'),
        [[1440, 1440]],
      ),
      [[1440, 1440]],
    )
    byCategory.main_1x1.push(...selectUploadAssets(main1x1Pool, REQUIRED_COUNTS.main_1x1, used))

    const micro1x1Pool = sortAssetsBySizePriority(
      preferExactDimensionsIfAvailable(
        microAssets.filter(item => item.__hints.ratio === '1x1'),
        [[1440, 1440]],
      ),
      [[1440, 1440]],
    )
    byCategory.micro_1x1.push(...selectUploadAssets(
      micro1x1Pool,
      MICRO_1X1_MAX_COUNT,
      used,
    ))

    const main3x4Pool = sortAssetsBySizePriority(
      mainTmallAssets.filter(item => isExactDimension(item, 1440, 1920)),
      [[1440, 1920]],
    )
    byCategory.main_3x4.push(...selectUploadAssets(main3x4Pool, REQUIRED_COUNTS.main_3x4, used))

    const micro3x4Pool = sortAssetsBySizePriority(
      microAssets.filter(item => isExactDimension(item, 1440, 1920)),
      [[1440, 1920]],
    )
    byCategory.micro_3x4.push(...selectUploadAssets(
      micro3x4Pool,
      MICRO_3X4_MAX_COUNT,
      used,
    ))

    const verticalPool = sortAssetsBySizePriority(
      mainTmallAssets.filter(item => isExactDimension(item, 1440, 2160)),
      [[1440, 2160]],
    )
    byCategory.vertical.push(...selectUploadAssets(verticalPool, 1, used))
    const allPcDetailPool = sortPcDetailCandidates([...exact('pc_detail'), ...detailItems, ...sorted])
      .filter(item => pcDetailAssetScore(item) > 0)
    const optimizedPcDetailPool = allPcDetailPool.filter(isOptimizedPcDetailAsset)
    const pcDetailPool = optimizedPcDetailPool.length ? optimizedPcDetailPool : allPcDetailPool
    const selectedPcDetail = assignFirst(pcDetailPool, PC_DETAIL_MAX_COUNT, used)
    const pcDetailDedupe = dedupePcDetailDuplicateSequences(selectedPcDetail, options)
    byCategory.pc_detail.push(...pcDetailDedupe.items)

    const missing = []
    const warnings = pcDetailDedupe.reason ? [pcDetailDedupe.reason] : []

    return {
      byCategory,
      missing,
      warnings,
      pcDetailDedupedCount: pcDetailDedupe.removed,
      total: sorted.length,
      selected: CATEGORY_ORDER.reduce((sum, category) => sum + byCategory[category].length, 0),
    }
  }

  function buildPackageFilename(job, item, category, categoryIndex) {
    const ext = getExt(item) || 'jpg'
    const prefix = CATEGORY_PREFIXES[category] || '99_未分类'
    const seq = String(categoryIndex + 1).padStart(2, '0')
    const originalStem = toSafeFilename(getFileStem(item?.filename || item?.name || ''), `${job.style_code}_${seq}`)
    return `${prefix}_${seq}_${originalStem}.${ext}`
  }

  function buildRuntimeFilename(job, item, index) {
    const ext = getExt(item) || 'jpg'
    const stem = toSafeFilename(`${job.style_code}_${job.item_id || 'tmall'}__${index + 1}__${getFileStem(item?.filename || item?.name || '')}`, 'download')
    return stem.toLowerCase().endsWith(`.${ext}`) ? stem : `${stem}.${ext}`
  }

  function localPathSeparator(path) {
    const raw = String(path || '')
    return raw.includes('\\') && !raw.includes('/') ? '\\' : '/'
  }

  function joinLocalPath(...parts) {
    const cleanParts = parts
      .map(part => String(part || '').trim())
      .filter(Boolean)
    if (!cleanParts.length) return ''
    const sep = localPathSeparator(cleanParts[0])
    const first = cleanParts.shift()
    const firstClean = sep === '\\'
      ? first.replace(/[\\/]+$/g, '')
      : first.replace(/\/+$/g, '')
    const rest = cleanParts.map(part => sep === '\\'
      ? part.replace(/^[\\/]+|[\\/]+$/g, '')
      : part.replace(/^\/+|\/+$/g, ''))
    return [firstClean, ...rest].filter(Boolean).join(sep)
  }

  function runtimePathInfo(rawParams = params) {
    const runtimeDir = compact(rawParams.__crawshrimp_runtime_artifact_dir || rawParams.runtime_artifact_dir || rawParams.artifact_dir)
    if (!runtimeDir) return { runtimeDir: '', taskRoot: '', runId: '' }
    const normalized = runtimeDir.replace(/\\/g, '/').replace(/\/+$/g, '')
    const marker = '/runtime/'
    const markerIndex = normalized.lastIndexOf(marker)
    const taskRoot = markerIndex >= 0 ? normalized.slice(0, markerIndex) : normalized.replace(/\/[^/]*$/g, '')
    const runId = markerIndex >= 0 ? normalized.slice(markerIndex + marker.length).split('/')[0] : ''
    return { runtimeDir, taskRoot, runId }
  }

  function packagingLocalDownloadRoot(job, rawParams = params) {
    const info = runtimePathInfo(rawParams)
    const runFolder = toSafeFilename(info.runId || `run_${Date.now()}`, 'run')
    const styleFolder = toSafeFilename(`${job?.style_code || 'unknown'}_${job?.item_id || 'tmall'}`, 'tmall_item')
    const exportFolder = compact(rawParams.export_folder)
    if (exportFolder) return joinLocalPath(exportFolder, '下载素材', runFolder, styleFolder)
    const explicit = compact(
      rawParams.packaging_download_dir ||
      rawParams.local_download_dir ||
      rawParams.download_dir ||
      rawParams.download_folder,
    )
    if (explicit) return joinLocalPath(explicit, styleFolder)
    if (!info.taskRoot) return ''
    return joinLocalPath(info.taskRoot, 'downloaded-materials', runFolder, styleFolder)
  }

  function baseOutputRow(job) {
    return {
      '表格行号': job.row_no || '',
      '款号': job.style_code || '',
      '商品ID': job.item_id || '',
      '输入编码': job.style_code || '',
    }
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

  function dedupeItemsByFullpath(items) {
    const result = []
    const seen = new Set()
    for (const item of Array.isArray(items) ? items : []) {
      const key = itemKey(item)
      if (!key || seen.has(key)) continue
      seen.add(key)
      result.push(item)
    }
    return result
  }

  function annotateItemsWithSource(items, sourceConfig = {}) {
    return (Array.isArray(items) ? items : []).map(item => ({
      ...(item || {}),
      __mount_id: String(item?.mount_id || item?.mountId || sourceConfig.mountId || '').trim(),
      __mount_name: compact(item?.mount_name || item?.mountName || sourceConfig.mountName || ''),
      __source_relative_path: compact(sourceConfig.relativePath || ''),
      __source_raw_path: compact(sourceConfig.rawPath || ''),
    }))
  }

  function selectedPackagingAssetCount(items) {
    return classifyPackagingAssets(dedupeItemsByFullpath(items)).selected
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

  function waitMs(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)))
  }

  function isSemirLoginTimeoutPayload(payload) {
    if (!payload || typeof payload !== 'object') return false
    const code = String(payload.error_code ?? payload.errorCode ?? payload.code ?? '').trim()
    const message = compact(payload.error_msg || payload.errorMsg || payload.message || payload.msg)
    return code === '40106' || /登录超时|login\s*timeout/i.test(message)
  }

  function isSemirLoginTimeoutText(text) {
    return /40106|登录超时|login\s*timeout/i.test(String(text || ''))
  }

  function createSemirLoginTimeoutError(url, response, payload, text) {
    const error = new Error(`森马云盘登录超时，请在当前浏览器完成登录后继续：${String(url || '')}`)
    error.isSemirLoginTimeout = true
    error.status = response?.status || 0
    error.payload = payload || null
    error.responseText = String(text || '')
    return error
  }

  function isSemirLoginTimeoutError(error) {
    return !!(error?.isSemirLoginTimeout || isSemirLoginTimeoutPayload(error?.payload) || isSemirLoginTimeoutText(error?.message || error?.responseText))
  }

  function isSemirLoginWaitPhase(name) {
    return new Set(['prepare_job', 'collect_cloud_assets']).has(String(name || ''))
  }

  function semirLoginWaitMessage(attempts) {
    const waitedMs = Math.min(SEMIR_LOGIN_WAIT_MS, Math.max(0, Number(attempts || 0)) * SEMIR_LOGIN_RETRY_MS)
    return `等待森马云盘登录 ${Math.ceil(waitedMs / 1000)}/${Math.ceil(SEMIR_LOGIN_WAIT_MS / 1000)}秒；请在当前云盘页面完成登录，登录恢复后脚本会继续`
  }

  function clearSemirLoginWaitState(state = shared) {
    const next = { ...state }
    delete next.semir_login_wait_attempts
    delete next.semir_login_wait_error
    return next
  }

  function waitForSemirLogin(name, state = shared, error = null) {
    const attempts = Math.max(0, Number(state.semir_login_wait_attempts || 0) || 0)
    if (attempts >= SEMIR_LOGIN_WAIT_MAX_ATTEMPTS) {
      return {
        success: false,
        error: `等待森马云盘登录超过${Math.ceil(SEMIR_LOGIN_WAIT_MS / 1000)}秒，最后错误：${String(error?.message || error || '登录超时')}`,
      }
    }
    const nextAttempts = attempts + 1
    return nextPhase(name, SEMIR_LOGIN_RETRY_MS, {
      ...state,
      semir_login_wait_attempts: nextAttempts,
      semir_login_wait_error: String(error?.message || error || ''),
      current_store: semirLoginWaitMessage(nextAttempts),
    })
  }

  function tmallTimingConfig() {
    return {
      pageWaitMs: TMALL_PAGE_WAIT_MS,
      publishWaitMs: TMALL_PUBLISH_WAIT_MS,
      publishConfirmWaitMs: TMALL_PUBLISH_CONFIRM_WAIT_MS,
      speedLimitCooldownMs: TMALL_SPEED_LIMIT_COOLDOWN_MS,
      uploadBetweenFilesMs: TMALL_UPLOAD_BETWEEN_FILES_MS,
      submitMode: TMALL_SUBMIT_MODE,
      allowApiSubmitFallback: TMALL_ALLOW_API_SUBMIT_FALLBACK,
      allowApiConfirmFallback: TMALL_ALLOW_API_CONFIRM_FALLBACK,
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

  function injectFiles(items, nextPhaseName, sleepMs = 500, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'inject_files',
        items,
        next_phase: nextPhaseName,
        sleep_ms: sleepMs,
        shared: newShared,
      },
    }
  }

  function cdpClicks(clicks, nextPhaseName, sleepMs = 500, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'cdp_clicks',
        clicks,
        next_phase: nextPhaseName,
        sleep_ms: sleepMs,
        shared: newShared,
      },
    }
  }

  function cdpTargetEval(expression, nextPhaseName, sleepMs = 500, newShared = shared, options = {}) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'cdp_target_eval',
        expression,
        target_url_contains: Array.isArray(options.target_url_contains) ? options.target_url_contains : [],
        target_url_regex: options.target_url_regex || '',
        target_types: Array.isArray(options.target_types) ? options.target_types : ['page', 'iframe'],
        shared_key: options.shared_key || '',
        user_gesture: !!options.user_gesture,
        next_phase: nextPhaseName,
        sleep_ms: sleepMs,
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
    const text = await response.text()
    let payload = null
    try {
      payload = text ? JSON.parse(text) : {}
    } catch (error) {
      payload = null
    }
    if (isSemirLoginTimeoutPayload(payload) || (!response.ok && response.status === 401 && isSemirLoginTimeoutText(text))) {
      throw createSemirLoginTimeoutError(url, response, payload, text)
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 240) || response.statusText}`)
    }
    if (payload == null) throw new Error(`接口未返回 JSON：${url}`)
    return payload
  }

  async function fetchMounts() {
    const payload = await fetchJson('/fengcloud/1/account/mount')
    if (Array.isArray(payload)) return payload
    if (Array.isArray(payload?.list)) return payload.list
    throw new Error('森马云盘挂载点接口异常，请确认当前浏览器已登录森马云盘')
  }

  function mountDisplayName(item) {
    return compact(item?.org_name || item?.name || item?.title)
  }

  function mountIdValue(item) {
    return String(item?.mount_id || item?.id || '').trim()
  }

  function resolveMountFromList(mounts, mountName) {
    const target = (Array.isArray(mounts) ? mounts : []).find(item => mountDisplayName(item) === compact(mountName))
    if (!target) return null
    return {
      mountId: mountIdValue(target),
      mountName: mountDisplayName(target),
    }
  }

  async function resolveMountId(mountName) {
    const mounts = await fetchMounts()
    const resolved = resolveMountFromList(mounts, mountName)
    if (resolved) return resolved
    const available = mounts.map(mountDisplayName).filter(Boolean).join('、')
    throw new Error(`未找到挂载点：${mountName}；当前可见挂载点：${available || '无'}`)
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
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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

  function parentFullpath(fullpath) {
    const segments = pathSegments(fullpath)
    segments.pop()
    return segments.join('/')
  }

  function candidateFolderFromSearchItem(item, styleCode) {
    if (matchesStyleFolder(item, styleCode)) {
      return String(item?.fullpath || item?.filename || '').replace(/\\/g, '/')
    }
    if (isDirectoryItem(item)) {
      const fullpath = String(item?.fullpath || item?.filename || '').replace(/\\/g, '/')
      const optimized = optimizedStyleFolderPathFromFullpath(fullpath, styleCode)
      if (optimized && optimized === pathSegments(fullpath).join('/')) return optimized
    }
    if (isImageItem(item)) return exactStyleFolderPathFromFullpath(item?.fullpath || '', styleCode)
    return ''
  }

  async function findVisibleStyleFolder(mounts, styleCode) {
    const candidates = []
    for (const mount of Array.isArray(mounts) ? mounts : []) {
      const mountId = mountIdValue(mount)
      const mountName = mountDisplayName(mount)
      if (!mountId || !mountName) continue
      try {
        const searchItems = await searchFiles(mountId, styleCode)
        for (const item of searchItems) {
          const folderPath = candidateFolderFromSearchItem(item, styleCode)
          if (!folderPath) continue
          candidates.push({
            mountId,
            mountName,
            relativePath: folderPath,
            searchCount: searchItems.length,
          })
        }
      } catch (error) {
        // Some visible mounts can deny search; skip them and keep probing.
      }
    }
    const deduped = []
    const seen = new Set()
    for (const candidate of candidates) {
      const key = `${candidate.mountId}\n${candidate.relativePath}`
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(candidate)
    }
    deduped.sort((a, b) => naturalCompare(a.relativePath, b.relativePath))
    return deduped[0] || null
  }

  function resolveCandidateSourceConfigs(mounts, candidateCloudPaths = [], styleCode = '') {
    const configs = []
    const seen = new Set()
    for (const rawPath of Array.isArray(candidateCloudPaths) ? candidateCloudPaths : []) {
      const cloudConfig = parseCloudPath(deriveJobCloudPath(rawPath, styleCode))
      const resolved = resolveMountFromList(mounts, cloudConfig.mountName)
      if (!resolved) {
        const available = mounts.map(mountDisplayName).filter(Boolean).join('、')
        throw new Error(`候选云盘路径未找到挂载点：${cloudConfig.mountName}；当前可见挂载点：${available || '无'}`)
      }
      const key = `${resolved.mountId}\n${cloudConfig.relativePath}`
      if (seen.has(key)) continue
      seen.add(key)
      configs.push({
        mountId: resolved.mountId,
        mountName: resolved.mountName,
        relativePath: cloudConfig.relativePath,
        rawPath: cloudConfig.raw,
        restrictSearchToRelativePath: true,
        searchOnly: !styleRootPathFromFullpath(cloudConfig.relativePath, styleCode),
        sourceWarning: `主目录素材不足时使用候选目录：${resolved.mountName}//${cloudConfig.relativePath}`,
      })
    }
    return configs
  }

  async function resolvePackagingSourceConfig(cloudConfig, job) {
    const mounts = await fetchMounts()
    const resolved = resolveMountFromList(mounts, cloudConfig.mountName)
    if (resolved) {
      return {
        mountId: resolved.mountId,
        mountName: resolved.mountName,
        relativePath: cloudConfig.relativePath,
        rawPath: cloudConfig.raw,
        candidateSources: resolveCandidateSourceConfigs(mounts, job.candidate_cloud_paths || [], job.style_code),
        sourceWarning: '',
      }
    }

    const available = mounts.map(mountDisplayName).filter(Boolean).join('、')
    throw new Error(`未找到挂载点：${cloudConfig.mountName}。如需从其它挂载点取图，请在“候选云盘路径”中显式配置。当前可见挂载点：${available || '无'}`)
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
    if (method === 'GET') return fetchJson(`${endpoint}?${query.toString()}`)
    return fetchJson(endpoint, {
      method,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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

  async function collectDescendantImagesByPath(mountId, folderPath, maxDepth, remainingBudget = { value: 3000 }) {
    if (!folderPath || maxDepth < 0 || remainingBudget.value <= 0) return { assets: [], errors: [] }
    const listed = await listFolderItems(mountId, folderPath)
    if (!listed.ok) return { assets: [], errors: [`${folderPath}: ${listed.error}`] }

    const assets = []
    const errors = []
    for (const item of listed.items) {
      if (remainingBudget.value <= 0) break
      if (isDirectoryItem(item)) {
        if (maxDepth <= 0) continue
        const child = await collectDescendantImagesByPath(
          mountId,
          item?.fullpath || item?.filename || '',
          maxDepth - 1,
          remainingBudget,
        )
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

  async function collectPackagingAssetsFromSource(job, sourceConfig) {
    const exact = sourceConfig.searchOnly
      ? { assets: [], errors: [] }
      : await collectDescendantImagesByPath(
        sourceConfig.mountId,
        sourceConfig.relativePath,
        job.folder_scan_depth,
        { value: 3000 },
      )
    let assets = exact.assets
    const listingIssues = [...exact.errors]
    let searchCount = 0
    let folderCount = 0
    let searchScope = assets.length ? 'configured_path' : ''
    let selectedStyleRoot = ''
    let searchItems = []

    try {
      searchItems = await searchFiles(sourceConfig.mountId, job.style_code)
      searchCount = searchItems.length
    } catch (error) {
      listingIssues.push(`搜索款号失败：${String(error?.message || error)}`)
    }

    const scopedSearchItems = sourceConfig.restrictSearchToRelativePath
      ? searchItems.filter(item => isWithinRelativePath(item?.fullpath, sourceConfig.relativePath))
      : searchItems
    const rootCandidates = collectStyleRootCandidates([...scopedSearchItems, ...assets], job.style_code)
    const latestRoot = selectLatestStyleRoot([...scopedSearchItems, ...assets], job.style_code)
    if (latestRoot?.path) {
      folderCount = rootCandidates.length
      selectedStyleRoot = latestRoot.path
      const alreadyCollected = filterItemsByStyleRoot(assets, selectedStyleRoot)
      if (alreadyCollected.length) {
        assets = alreadyCollected
        searchScope = searchScope || (isWithinRelativePath(selectedStyleRoot, sourceConfig.relativePath) ? 'configured_latest_root' : 'mount_latest_root')
      } else {
        const child = await collectDescendantImagesByPath(
          sourceConfig.mountId,
          selectedStyleRoot,
          job.folder_scan_depth,
          { value: SEARCH_FALLBACK_ASSET_BUDGET },
        )
        assets = child.assets
        listingIssues.push(...child.errors)
        searchScope = isWithinRelativePath(selectedStyleRoot, sourceConfig.relativePath) ? 'configured_latest_root' : 'mount_latest_root'
      }
    }

    const collectFromSearchItems = async (searchItems, scopeLabel) => {
      const matching = searchItems.filter(item => searchItemMatchesStyle(item, job.style_code))
      const folders = matching.filter(item => {
        if (matchesStyleFolder(item, job.style_code)) return true
        if (!isDirectoryItem(item)) return false
        const fullpath = String(item?.fullpath || item?.filename || '').replace(/\\/g, '/')
        const optimized = optimizedStyleFolderPathFromFullpath(fullpath, job.style_code)
        return !!optimized && optimized === pathSegments(fullpath).join('/')
      })
      if (!selectedStyleRoot && folders.length) {
        const rankedFolders = [...folders].sort((a, b) => {
          const timeDelta = itemUpdatedAtMs(b) - itemUpdatedAtMs(a)
          if (timeDelta) return timeDelta
          return naturalCompare(normalizedAssetFullpath(a), normalizedAssetFullpath(b))
        })
        selectedStyleRoot = normalizedAssetFullpath(rankedFolders[0])
      }
      folderCount += folders.length
      const folderBudget = { value: SEARCH_FALLBACK_ASSET_BUDGET }
      for (const folder of folders) {
        if (folderBudget.value <= 0) break
        const child = await collectDescendantImagesByPath(
          sourceConfig.mountId,
          folder?.fullpath || folder?.filename || '',
          job.folder_scan_depth,
          folderBudget,
        )
        assets.push(...child.assets)
        listingIssues.push(...child.errors)
      }
      assets.push(...matching.filter(isImageItem))
      if (matching.length) searchScope = scopeLabel
      return matching.length
    }

    if (selectedPackagingAssetCount(assets) < MIN_USEFUL_FALLBACK_SELECTED_ASSETS) {
      const scoped = scopedSearchItems.filter(item => isWithinRelativePath(item?.fullpath, sourceConfig.relativePath))
      await collectFromSearchItems(scoped, sourceConfig.restrictSearchToRelativePath ? 'candidate_search' : 'configured_search')
      if (selectedPackagingAssetCount(assets) < MIN_USEFUL_FALLBACK_SELECTED_ASSETS) {
        const mountWide = sourceConfig.restrictSearchToRelativePath
          ? []
          : selectMountWideSearchItems(searchItems, sourceConfig.relativePath, job.style_code)
        const preferred = mountWide.filter(isPreferredPackagingSearchItem)
        await collectFromSearchItems(mountWide, preferred.length ? 'mount_packaging_search' : 'mount_search')
      }
    }

    assets = annotateItemsWithSource(dedupeItemsByFullpath(assets), sourceConfig)
    const plan = classifyPackagingAssets(assets, { styleCode: job.style_code })
    const errors = plan.selected > 0 ? [] : listingIssues
    return {
      ...plan,
      items: assets,
      errors,
      warnings: plan.selected > 0 ? [...(plan.warnings || []), ...listingIssues] : (plan.warnings || []),
      searchCount,
      folderCount,
      searchScope,
      selectedStyleRoot,
      sourceMountId: sourceConfig.mountId,
      sourceMountName: sourceConfig.mountName,
      sourceRelativePath: sourceConfig.relativePath,
      sourceRawPath: sourceConfig.rawPath,
    }
  }

  function planCoverageScore(plan = {}) {
    const byCategory = plan.byCategory || {}
    const categoryHits = CATEGORY_ORDER.reduce((sum, category) => sum + ((byCategory[category] || []).length ? 1 : 0), 0)
    const detailCount = (byCategory.pc_detail || []).length
    const mainCount = (byCategory.main_1x1 || []).length + (byCategory.main_3x4 || []).length
    return Number(plan.selected || 0) * 10 + categoryHits * 4 + detailCount * 2 + mainCount
  }

  async function collectPackagingAssets(job, sourceConfig) {
    const primary = await collectPackagingAssetsFromSource(job, sourceConfig)
    const candidates = Array.isArray(sourceConfig.candidateSources) ? sourceConfig.candidateSources : []
    if (primary.selected >= MIN_USEFUL_FALLBACK_SELECTED_ASSETS || !candidates.length) return primary

    let best = primary
    const candidateIssues = []
    for (const candidate of candidates) {
      const plan = await collectPackagingAssetsFromSource(job, candidate)
      candidateIssues.push(...(plan.errors || []), ...(plan.warnings || []))
      if (planCoverageScore(plan) > planCoverageScore(best)) {
        best = {
          ...plan,
          warnings: [
            `主目录素材不足（选中 ${primary.selected} 张），已使用候选目录：${candidate.mountName}//${candidate.relativePath}`,
            ...(primary.errors || []),
            ...(primary.warnings || []),
            ...(plan.warnings || []),
          ],
        }
      }
    }
    if (best === primary && candidateIssues.length) {
      return {
        ...primary,
        warnings: [...(primary.warnings || []), ...candidateIssues],
      }
    }
    return best
  }

  async function fetchFileInfo(mountId, fullpath) {
    const query = new URLSearchParams({
      fullpath: String(fullpath || ''),
      mount_id: String(mountId || ''),
    })
    return fetchJson(`/fengcloud/2/file/info?${query.toString()}`)
  }

  async function buildPackagingDownloadPlan(job, sourceConfig) {
    const plan = await collectPackagingAssets(job, sourceConfig)
    const rows = []
    const downloadItems = []
    let globalIndex = 0
    const planSourcePath = plan.sourceRelativePath || sourceConfig.relativePath
    const localDownloadRoot = packagingLocalDownloadRoot(job)

    if (!plan.items.length) {
      rows.push({
        ...baseOutputRow(job),
        '图片用途': '',
        '文件名': '',
        '原文件名': '',
        '云盘路径': planSourcePath,
        '下载结果': '未匹配到图片',
        '本地文件': '',
        '上传结果': '',
        '天猫图片URL': '',
        '执行结果': '未匹配到图片',
        '备注': `搜索结果 ${plan.searchCount} 条；匹配文件夹 ${plan.folderCount} 个；选用图包 ${plan.selectedStyleRoot || '无'}；搜索范围 ${plan.searchScope || '无'}；列目录问题 ${plan.errors.length} 个`,
      })
      return { rows, downloadItems, plan }
    }

    for (const category of CATEGORY_ORDER) {
      const items = plan.byCategory[category] || []
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        const packageFilename = buildPackageFilename(job, item, category, index)
        const baseRow = {
          ...baseOutputRow(job),
          '图片用途': CATEGORY_LABELS[category] || category,
          '文件名': packageFilename,
          '原文件名': String(item?.filename || item?.name || ''),
          '云盘路径': String(item?.fullpath || ''),
          '下载结果': '',
          '本地文件': '',
          '上传结果': '',
          '天猫图片URL': '',
          '执行结果': '',
          '备注': '',
          '__category': category,
          '__package_filename': packageFilename,
          '__source_index': item.__source_index,
        }
        try {
          const info = await fetchFileInfo(item?.__mount_id || sourceConfig.mountId, item?.fullpath || '')
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
          const runtimeFilename = buildRuntimeFilename(job, item, globalIndex)
          globalIndex += 1
          rows.push({
            ...baseRow,
            '__runtime_filename': runtimeFilename,
          })
          downloadItems.push({
            url: downloadUrl,
            filename: runtimeFilename,
            label: `${job.style_code} / ${CATEGORY_LABELS[category]} / ${item?.filename || runtimeFilename}`,
            headers: buildDownloadHeaders(),
            target_dir: localDownloadRoot,
            target_relative_path: localDownloadRoot ? `${CATEGORY_PREFIXES[category] || '99_未分类'}/${packageFilename}` : '',
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
    }

    for (const note of plan.missing) {
      rows.push({
        ...baseOutputRow(job),
        '图片用途': '',
        '文件名': '',
        '原文件名': '',
        '云盘路径': planSourcePath,
        '下载结果': '已跳过',
        '本地文件': '',
        '上传结果': '',
        '天猫图片URL': '',
        '执行结果': '素材不足',
        '备注': note,
      })
    }

    for (const error of plan.errors.slice(0, 5)) {
      rows.push({
        ...baseOutputRow(job),
        '图片用途': '',
        '文件名': '',
        '原文件名': '',
        '云盘路径': planSourcePath,
        '下载结果': '已跳过',
        '本地文件': '',
        '上传结果': '',
        '天猫图片URL': '',
        '执行结果': '列目录失败',
        '备注': error,
      })
    }

    return { rows, downloadItems, plan }
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
        '执行结果': result?.success ? '已下载' : '下载失败',
        '备注': result?.success ? row['备注'] || '' : String(result?.error || '下载失败'),
      }
    })
  }

  function ensureUploadInput() {
    let input = document.querySelector(UPLOAD_INPUT_SELECTOR)
    if (!input) {
      input = document.createElement('input')
      input.id = UPLOAD_INPUT_ID
      input.type = 'file'
      input.multiple = true
      input.accept = 'image/*'
      input.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;'
      document.body.appendChild(input)
    }
    return input
  }

  function getSellState() {
    return window.__SELL_STATE__ && typeof window.__SELL_STATE__.getState === 'function'
      ? window.__SELL_STATE__.getState()
      : null
  }

  function getComponentValue(name) {
    const state = getSellState()
    if (!state || typeof state.getComponentValue !== 'function') return undefined
    try {
      return state.getComponentValue(name)
    } catch (error) {
      return undefined
    }
  }

  function getComponentProps(name) {
    const engine = getTmallEngine()
    try {
      const component = engine && typeof engine.getComponent === 'function' ? engine.getComponent(name) : null
      return component && typeof component.getProps === 'function' ? component.getProps() || {} : {}
    } catch (error) {
      return {}
    }
  }

  function componentVisible(name) {
    const props = getComponentProps(name)
    return props.visible === true || props.vis === true
  }

  function findLegacyPcDetailTextarea() {
    const candidates = getAccessibleDocuments().flatMap(doc => Array.from(doc.querySelectorAll?.('textarea.ks-editor-textarea,textarea[id^="ks-editor-textarea"],textarea') || []))
      .filter(element => {
        const value = String(element.value || '')
        if (!value || !/<img\b/i.test(value)) return false
        const context = elementContextText(element, 5)
        return /电脑端描述|文本PC详情|使用文本编辑|源码|图片空间|本地上传图片/.test(context) || /ks-editor-textarea/.test(String(element.className || ''))
      })
      .sort((a, b) => String(b.value || '').length - String(a.value || '').length)
    return candidates[0] || null
  }

  function getLegacyPcDetailHtml() {
    const componentValue = getComponentValue('tmDescription')
    if (typeof componentValue === 'string' && /<img\b/i.test(componentValue)) return componentValue
    const formValue = getTmallFormValues().tmDescription
    if (typeof formValue === 'string' && /<img\b/i.test(formValue)) return formValue
    const textarea = findLegacyPcDetailTextarea()
    return textarea ? String(textarea.value || '') : ''
  }

  function getNewDescValue(sourceValues = null) {
    const source = sourceValues && typeof sourceValues === 'object' ? sourceValues : null
    if (source && source.descRepublicOfSell) return source.descRepublicOfSell
    return getComponentValue('descRepublicOfSell') || getTmallFormValues().descRepublicOfSell || null
  }

  function parseNewDescTemplateContent(value) {
    const source = value && typeof value === 'object' && value.descPageCommitParam
      ? value.descPageCommitParam.templateContent
      : value
    if (!source) return { ok: false, reason: '新版详情模板为空', template: null, templateContent: '' }
    if (typeof source === 'object') {
      return { ok: true, template: jsonClone(source), templateContent: JSON.stringify(source) }
    }
    const text = String(source || '')
    try {
      return { ok: true, template: JSON.parse(text), templateContent: text }
    } catch (error) {
      return { ok: false, reason: `新版详情模板解析失败：${String(error?.message || error)}`, template: null, templateContent: text }
    }
  }

  function newDescPicUrl(component = {}) {
    const box = component?.boxStyle || {}
    return compact(box['background-image'] || box.backgroundImage || component.url || component.src || component.picUrl || component.imageUrl || '')
  }

  function flattenNewDescPicComponents(value) {
    const parsed = parseNewDescTemplateContent(value)
    if (!parsed.ok) return []
    const groups = Array.isArray(parsed.template?.groups) ? parsed.template.groups : []
    const pics = []
    groups.forEach((group, groupIndex) => {
      const components = Array.isArray(group?.components) ? group.components : []
      components.forEach((component, componentIndex) => {
        if (compact(component?.componentType).toLowerCase() !== 'pic') return
        const src = newDescPicUrl(component)
        if (!src) return
        const box = component.boxStyle || {}
        pics.push({
          group,
          component,
          groupIndex,
          componentIndex,
          moduleIndex: pics.length,
          imageIndex: 0,
          globalIndex: pics.length,
          moduleName: compact(group?.bizName || group?.groupName || '图文模块'),
          groupId: compact(group?.groupId),
          componentId: compact(component?.componentId),
          src,
          width: positiveInt(box.width || group?.boxStyle?.width, 0),
          height: positiveInt(box.height || group?.boxStyle?.height, 0),
          context: compact([group?.bizName, group?.groupName, component?.componentName].filter(Boolean).join(' ')),
        })
      })
    })
    return pics
  }

  function isAggregateItemImagesGroup(group = {}) {
    const type = compact(group?.type || group?.componentType || group?.groupType).toLowerCase()
    const bizName = compact(group?.bizName || group?.groupName)
    return Array.isArray(group?.imgList) && (type === 'itemimages' || bizName.includes('商品图片'))
  }

  function summarizeNewDescTemplate(value) {
    const parsed = parseNewDescTemplateContent(value)
    if (!parsed.ok) {
      return {
        ok: false,
        reason: parsed.reason || '',
        groupCount: 0,
        visibleGroupCount: 0,
        componentPicCount: 0,
        aggregateItemImagesGroupCount: 0,
        aggregateItemImagesImageCount: 0,
        aggregateItemImagesOnly: false,
      }
    }
    const groups = Array.isArray(parsed.template?.groups) ? parsed.template.groups : []
    const visibleGroups = groups.filter(group => group?.hide !== true)
    const pics = flattenNewDescPicComponents(parsed.template)
    const aggregateGroups = groups.filter(isAggregateItemImagesGroup)
    const aggregateItemImagesImageCount = aggregateGroups.reduce(
      (sum, group) => sum + (Array.isArray(group?.imgList) ? group.imgList.length : 0),
      0,
    )
    return {
      ok: true,
      groupCount: groups.length,
      visibleGroupCount: visibleGroups.length,
      componentPicCount: pics.length,
      aggregateItemImagesGroupCount: aggregateGroups.length,
      aggregateItemImagesImageCount,
      aggregateItemImagesOnly: groups.length > 0 && pics.length === 0 && aggregateGroups.length > 0,
    }
  }

  function shouldFallbackAggregateNewDescToLegacy(value = getNewDescValue()) {
    const summary = summarizeNewDescTemplate(value)
    return summary.ok &&
      summary.aggregateItemImagesOnly &&
      summary.componentPicCount === 0 &&
      summary.aggregateItemImagesGroupCount > 0 &&
      summary.visibleGroupCount <= 2 &&
      summary.aggregateItemImagesImageCount >= 1 &&
      summary.aggregateItemImagesImageCount <= 2
  }

  function shouldWaitForAggregateNewDescHydration(value = getNewDescValue(), state = shared) {
    if (!shouldFallbackAggregateNewDescToLegacy(value)) return false
    if (state.prefer_legacy_pc_detail || state.new_desc_aggregate_legacy_fallback) return false
    const attempts = Number(state.aggregate_new_desc_hydrate_wait_attempts || 0)
    return attempts < AGGREGATE_NEW_DESC_HYDRATE_WAIT_ATTEMPTS
  }

  function waitForAggregateNewDescHydration(state = shared, extra = {}) {
    const attempts = Number(state.aggregate_new_desc_hydrate_wait_attempts || 0)
    return nextPhase('wait_tmall_ready', TMALL_PAGE_WAIT_MS, {
      ...state,
      ...extra,
      aggregate_new_desc_hydrate_wait_attempts: attempts + 1,
      current_store: `等待新版详情图文模块完整加载 ${attempts + 1}/${AGGREGATE_NEW_DESC_HYDRATE_WAIT_ATTEMPTS}`,
    })
  }

  function aggregateNewDescLegacyFallbackLabel(value = getNewDescValue()) {
    const summary = summarizeNewDescTemplate(value)
    const moduleCount = summary.visibleGroupCount || summary.groupCount || summary.aggregateItemImagesGroupCount || 1
    const imageCount = summary.aggregateItemImagesImageCount || 0
    return `新版详情是${moduleCount}个商品图片聚合模块${imageCount ? `（imgList ${imageCount}张）` : ''}，不是可逐张锚点替换的图文模块`
  }

  function hasAggregateNewDescTemplate(value = getNewDescValue()) {
    const summary = summarizeNewDescTemplate(value)
    return summary.ok &&
      summary.aggregateItemImagesOnly &&
      summary.aggregateItemImagesGroupCount > 0
  }

  function escapeHtmlAttribute(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  function newDescPicsToModules(pics) {
    return (Array.isArray(pics) ? pics : []).map(pic => ({
      id: pic.componentId || `new-desc-${pic.globalIndex}`,
      name: pic.moduleName || '图文模块',
      content: `<p><img src="${escapeHtmlAttribute(pic.src)}"/></p>`,
      custom: false,
      __newDescPic: pic,
    }))
  }

  function hasUsableNewDescTemplate(value = getNewDescValue()) {
    return flattenNewDescPicComponents(value).length > 0
  }

  function buildImageDimensionMap(items = []) {
    const result = {}
    ;(Array.isArray(items) ? items : []).forEach(item => {
      const url = compact(item?.url || item?.src || item?.picUrl || item?.imageUrl || item?.img)
      if (!url) return
      result[comparableImageUrl(url)] = {
        width: positiveInt(item?.width, 0),
        height: positiveInt(item?.height, 0),
      }
    })
    return result
  }

  function imageDimensionsForUrl(url, maps = []) {
    const key = comparableImageUrl(url)
    for (const map of maps) {
      const found = map?.[key]
      if (found && (found.width || found.height)) return found
    }
    return {}
  }

  function aggregateNewDescImageItemsFromUrls(urls = [], currentImgList = [], uploadedDetailItems = []) {
    const currentMap = buildImageDimensionMap((Array.isArray(currentImgList) ? currentImgList : []).map(item => ({
      ...item,
      url: item?.img || item?.url,
    })))
    const uploadedMap = buildImageDimensionMap(uploadedDetailItems)
    return (Array.isArray(urls) ? urls : [])
      .map(compact)
      .filter(Boolean)
      .map((url, index) => {
        const current = (Array.isArray(currentImgList) ? currentImgList : [])[index] || {}
        const dims = imageDimensionsForUrl(url, [uploadedMap, currentMap])
        const width = positiveInt(dims.width || current.width, 620) || 620
        const height = positiveInt(dims.height || current.height, 0) || 827
        return {
          hotAreaList: Array.isArray(current.hotAreaList) ? jsonClone(current.hotAreaList) : [],
          img: url,
          width,
          height,
        }
      })
  }

  function buildAggregateNewDescFromPcModules(newDescValue, modules = [], uploadedDetailItems = []) {
    const parsed = parseNewDescTemplateContent(newDescValue)
    if (!parsed.ok) return null
    const template = jsonClone(parsed.template)
    const groups = Array.isArray(template?.groups) ? template.groups : []
    const aggregateIndex = groups.findIndex(isAggregateItemImagesGroup)
    if (aggregateIndex < 0) return null
    const urls = pcDetailUrlsFromSource(modules)
    if (!urls.length) return null
    const currentImgList = Array.isArray(groups[aggregateIndex]?.imgList) ? groups[aggregateIndex].imgList : []
    groups[aggregateIndex] = {
      ...groups[aggregateIndex],
      imgList: aggregateNewDescImageItemsFromUrls(urls, currentImgList, uploadedDetailItems),
    }
    template.groups = groups
    return {
      ...(newDescValue && typeof newDescValue === 'object' ? newDescValue : {}),
      descPageCommitParam: {
        ...((newDescValue && typeof newDescValue === 'object' ? newDescValue.descPageCommitParam : {}) || {}),
        templateContent: JSON.stringify(template),
        changed: true,
      },
    }
  }

  function normalizeDetailImage(item) {
    if (typeof item === 'string') return { url: compact(item), width: 0, height: 0 }
    return {
      ...(item || {}),
      url: compact(item?.url || item?.src || item?.picUrl || item?.imageUrl || ''),
      width: positiveInt(item?.width, 0),
      height: positiveInt(item?.height, 0),
    }
  }

  function resizeNewDescPicGroup(group, image) {
    const clone = jsonClone(group)
    const component = Array.isArray(clone.components)
      ? clone.components.find(item => compact(item?.componentType).toLowerCase() === 'pic') || clone.components[0]
      : null
    const box = component?.boxStyle || {}
    const groupBox = clone.boxStyle || {}
    const targetWidth = positiveInt(box.width || groupBox.width, 620) || 620
    const targetHeight = image.width && image.height
      ? Math.max(1, Math.round(targetWidth * image.height / image.width))
      : (positiveInt(box.height || groupBox.height, 0) || 794)
    clone.boxStyle = {
      ...groupBox,
      width: String(targetWidth),
      height: String(targetHeight),
    }
    if (component) {
      component.boxStyle = {
        ...box,
        top: '0',
        left: '0',
        width: String(targetWidth),
        height: String(targetHeight),
        'background-image': image.url,
      }
      component.imgStyle = {
        ...(component.imgStyle || {}),
        top: '0',
        left: '0',
        width: String(targetWidth),
        height: String(targetHeight),
      }
    }
    return clone
  }

  function cloneNewDescPicGroup(group, image, index, options = {}) {
    const cloned = resizeNewDescPicGroup(group, image)
    const prefix = compact(options.idPrefix) || `crawshrimp${Date.now()}`
    const groupId = `group${prefix}${index}`
    const componentId = `component${prefix}${index}`
    cloned.groupId = groupId
    if (Array.isArray(cloned.components)) {
      cloned.components.forEach(component => {
        component.groupId = groupId
        if (compact(component?.componentType).toLowerCase() === 'pic') {
          component.componentId = componentId
        }
      })
    }
    return cloned
  }

  function fixedTopNewDescPicIndex(pics = [], options = {}) {
    const list = Array.isArray(pics) ? pics : []
    const anchors = normalizeVisualAnchors(options.visualAnchors)
    if (anchors.fixedTopImageIndex !== null && list[anchors.fixedTopImageIndex]) return anchors.fixedTopImageIndex
    const signatureIndex = list.findIndex(pic => isFixedTopAnchorImage(pic?.src))
    return signatureIndex >= 0 ? signatureIndex : -1
  }

  function buildNewDescImageCountFallback(parsed, newDescValue, pics = [], detailList = [], options = {}) {
    if (!options.allowLegacyCountImageReplace) return null
    if (!detailList.length) return null
    const groups = Array.isArray(parsed?.template?.groups) ? parsed.template.groups : []
    const fixedTopImageIndex = fixedTopNewDescPicIndex(pics, options)
    const preserveTopImageCount = fixedTopImageIndex >= 0 ? fixedTopImageIndex + 1 : 0
    const replaceStartIndex = preserveTopImageCount
    if (pics.length < replaceStartIndex + detailList.length) return null
    const startPic = pics[replaceStartIndex]
    const stopPic = pics[replaceStartIndex + detailList.length]
    const referenceGroup = startPic?.group || pics[0]?.group
    if (!startPic || !referenceGroup) return null
    const template = jsonClone(parsed.template)
    const newGroups = detailList.map((item, index) => cloneNewDescPicGroup(referenceGroup, item, index, options))
    template.groups = [
      ...groups.slice(0, startPic.groupIndex),
      ...newGroups,
      ...groups.slice(stopPic ? stopPic.groupIndex : groups.length),
    ]
    const nextValue = {
      ...(newDescValue && typeof newDescValue === 'object' ? newDescValue : {}),
      descPageCommitParam: {
        ...((newDescValue && typeof newDescValue === 'object' ? newDescValue.descPageCommitParam : {}) || {}),
        templateContent: JSON.stringify(template),
        changed: true,
      },
    }
    const replaceEndIndex = stopPic ? stopPic.globalIndex : pics.length
    const fixedTopImage = fixedTopImageIndex >= 0 ? pics[fixedTopImageIndex] : null
    const fallbackProbe = {
      target: 'descRepublicOfSell',
      mode: 'new_desc_legacy_count_replace',
      pics,
      replacedImageCount: detailList.length,
      preserveTopImageCount,
    }
    if (options.requireVisualAnchors && isUnsafeNewDescCountFallbackProbe(fallbackProbe)) return null
    const topLabel = pcDetailTopPreserveLabel(!!fixedTopImage, fixedTopImageIndex)
    const tailLabel = stopPic ? `，保留第${replaceEndIndex + 1}张及以下尾部` : ''
    return {
      ok: true,
      target: 'descRepublicOfSell',
      mode: 'new_desc_legacy_count_replace',
      value: nextValue,
      template,
      modules: newDescPicsToModules(flattenNewDescPicComponents(template)),
      pics,
      insertedGroupCount: newGroups.length,
      replacedGroupStartIndex: startPic.groupIndex,
      replacedGroupEndIndex: stopPic ? stopPic.groupIndex : groups.length,
      replaceStartIndex,
      replaceEndIndex,
      replacedImageCount: detailList.length,
      insertedImageCount: detailList.length,
	      fixedTopImage,
	      fixedTopImageIndex: fixedTopImageIndex >= 0 ? fixedTopImageIndex : null,
	      preserveTopImageCount,
	      stopAnchor: stopPic || {
	        groupIndex: groups.length,
	        globalIndex: pics.length,
	        src: '',
	      },
	      stopImageIndex: stopPic ? stopPic.globalIndex : pics.length,
	      stopAnchorKind: 'legacy_count_tail',
	      currentReplacementUrls: pics.slice(replaceStartIndex, replaceEndIndex).map(pic => pic.src).filter(Boolean),
	      note: `新版图片详情未识别到可靠文字锚点，已按产品包装PC详情图数量替换：${topLabel}替换第${replaceStartIndex + 1}到第${replaceEndIndex}张${tailLabel}`,
	    }
	  }

  function legacyCountProbeDetailImages(options = {}) {
    if (!options.probeOnly || !options.allowLegacyCountImageReplace) return []
    const count = Math.max(0, Math.floor(Number(options.legacyCountDetailImageCount || 0) || 0))
    return Array.from({ length: count }, (_, index) => ({
      url: `__crawshrimp_pc_detail_probe_${index + 1}__`,
      width: 1440,
      height: 1920,
    }))
  }

  function buildAnchoredNewDescTemplateContent(newDescValue, detailImages = [], options = {}) {
    const parsed = parseNewDescTemplateContent(newDescValue)
    const detailList = (Array.isArray(detailImages) ? detailImages : [])
      .map(normalizeDetailImage)
      .filter(item => item.url)
    const detailListForCountFallback = detailList.length ? detailList : legacyCountProbeDetailImages(options)
    if (!parsed.ok) {
      return {
        ok: false,
        target: 'descRepublicOfSell',
        mode: 'blocked_new_desc_parse_failed',
        note: parsed.reason || '新版详情模板解析失败',
        value: newDescValue,
        modules: [],
      }
    }
    const template = jsonClone(parsed.template)
    const pics = flattenNewDescPicComponents(template)
    const modules = newDescPicsToModules(pics)
    if (!pics.length) {
      return {
        ok: false,
        target: 'descRepublicOfSell',
        mode: 'blocked_new_desc_no_pics',
        note: '新版详情模板中未识别到图片组件，已阻止自动替换',
        value: newDescValue,
        modules,
      }
    }
    const range = buildAnchoredPcDetailModules(modules, detailList.map(item => item.url), {
      ...options,
      probeOnly: true,
    })
    if (!detailList.length || !range.ok) {
      const countFallback = detailListForCountFallback.length
        ? buildNewDescImageCountFallback(parsed, newDescValue, pics, detailListForCountFallback, options)
        : null
      if (countFallback) return countFallback
      return {
        ...range,
        target: 'descRepublicOfSell',
        value: newDescValue,
        template,
        modules,
        pics,
        note: detailList.length
          ? range.note
          : '新版详情模板可解析，等待OCR锚点后再替换',
      }
    }
    const startPic = pics[Number(range.replaceStartIndex)]
    const stopPic = pics[Number(range.replaceEndIndex)]
    const groups = Array.isArray(template.groups) ? template.groups : []
    const referenceGroup = startPic?.group || pics[0]?.group
    if (!startPic || !referenceGroup) {
      return {
        ...range,
        ok: false,
        target: 'descRepublicOfSell',
        mode: 'blocked_new_desc_range_missing',
        value: newDescValue,
        template,
        modules,
        pics,
        note: '新版详情模板替换区间缺少起始图片组件，已阻止自动替换',
      }
    }
    const startGroupIndex = startPic.groupIndex
    const stopGroupIndex = stopPic ? stopPic.groupIndex : groups.length
    if (stopGroupIndex < startGroupIndex) {
      return {
        ...range,
        ok: false,
        target: 'descRepublicOfSell',
        mode: 'blocked_new_desc_invalid_range',
        value: newDescValue,
        template,
        modules,
        pics,
        note: '新版详情模板替换区间异常，已阻止自动替换',
      }
    }
    const newGroups = detailList.map((item, index) => cloneNewDescPicGroup(referenceGroup, item, index, options))
    template.groups = [
      ...groups.slice(0, startGroupIndex),
      ...newGroups,
      ...groups.slice(stopGroupIndex),
    ]
    const nextValue = {
      ...(newDescValue && typeof newDescValue === 'object' ? newDescValue : {}),
      descPageCommitParam: {
        ...((newDescValue && typeof newDescValue === 'object' ? newDescValue.descPageCommitParam : {}) || {}),
        templateContent: JSON.stringify(template),
        changed: true,
      },
    }
    return {
      ...range,
      target: 'descRepublicOfSell',
      value: nextValue,
      template,
      modules: newDescPicsToModules(flattenNewDescPicComponents(template)),
      pics,
      insertedGroupCount: newGroups.length,
      replacedGroupStartIndex: startGroupIndex,
      replacedGroupEndIndex: stopGroupIndex,
      note: `新版详情模板${range.note || '已完成锚点区间替换'}`,
    }
  }

  function legacyPcDetailReplacementProbe(options = {}) {
    const modularDesc = getComponentValue('modularDesc')
    if (Array.isArray(modularDesc) && modularDesc.length) {
      return buildAnchoredPcDetailModules(modularDesc, [], {
        probeOnly: true,
        visualAnchors: options.visualAnchors,
        requireVisualAnchors: options.requireVisualAnchors,
        allowLegacyCountImageReplace: options.allowLegacyCountImageReplace,
        legacyCountDetailImageCount: options.legacyCountDetailImageCount,
      })
    }
    const tmDescription = getLegacyPcDetailHtml()
    if (tmDescription) {
      return buildAnchoredPcDetailHtml(tmDescription, [], {
        probeOnly: true,
        visualAnchors: options.visualAnchors,
        requireVisualAnchors: options.requireVisualAnchors,
        allowLegacyCountImageReplace: options.allowLegacyCountImageReplace,
        legacyCountDetailImageCount: options.legacyCountDetailImageCount,
      })
    }
    return null
  }

  function currentPcDetailReplacementProbe(options = {}) {
    const preferLegacy = !!options.preferLegacyPcDetail
    if (!preferLegacy) {
      const newDescValue = getNewDescValue()
      if (hasUsableNewDescTemplate(newDescValue)) {
        return buildAnchoredNewDescTemplateContent(newDescValue, [], {
          probeOnly: true,
          visualAnchors: options.visualAnchors,
          requireVisualAnchors: options.requireVisualAnchors,
          allowLegacyCountImageReplace: options.allowLegacyCountImageReplace,
          legacyCountDetailImageCount: options.legacyCountDetailImageCount,
        })
      }
    }
    const legacyProbe = legacyPcDetailReplacementProbe(options)
    if (legacyProbe) return legacyProbe
    const newDescValue = getNewDescValue()
    if (hasUsableNewDescTemplate(newDescValue)) {
      return buildAnchoredNewDescTemplateContent(newDescValue, [], {
        probeOnly: true,
        visualAnchors: options.visualAnchors,
        requireVisualAnchors: options.requireVisualAnchors,
        allowLegacyCountImageReplace: options.allowLegacyCountImageReplace,
        legacyCountDetailImageCount: options.legacyCountDetailImageCount,
      })
    }
    return {
      ok: false,
      modules: [],
      note: '未读到旧版PC详情模块或旧版文本PC详情，已阻止自动替换',
      mode: 'blocked_pc_detail_missing',
    }
  }

  function applyLegacyPcDetailDom(html) {
    const value = String(html || '')
    const textarea = findLegacyPcDetailTextarea()
    if (!textarea) return { ok: false, reason: '未找到旧版文本PC详情 textarea' }
    try {
      textarea.value = value
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.dispatchEvent(new Event('change', { bubbles: true }))
      const root = textarea.closest?.('.ks-editor, .next-form-item, .rax-view, div') || textarea.parentElement
      const iframe = root?.querySelector?.('iframe.ks-editor-iframe') || document.querySelector('iframe.ks-editor-iframe')
      const doc = iframe?.contentDocument
      if (doc?.body) doc.body.innerHTML = value
      return { ok: true, method: 'textarea' }
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) }
    }
  }

  function isVisibleElement(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return false
    const rect = element.getBoundingClientRect()
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(element) : null
    return rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden'
  }

  function elementText(element) {
    if (!element) return ''
    const parts = [
      element.innerText,
      element.textContent,
      typeof element.getAttribute === 'function' ? element.getAttribute('aria-label') : '',
      typeof element.getAttribute === 'function' ? element.getAttribute('title') : '',
      element.value,
    ]
    const seen = new Set()
    return compact(parts
      .map(part => compact(part))
      .filter(part => part && !seen.has(part) && seen.add(part))
      .join(' '))
  }

  function elementContextText(element, maxDepth = 4) {
    const parts = []
    let node = element
    for (let depth = 0; node && depth <= maxDepth; depth += 1) {
      const text = elementText(node)
      if (text) parts.push(text)
      node = node.parentElement
    }
    return compact(parts.join(' '))
  }

  function isDisabledElement(element) {
    if (!element) return true
    const disabledAttr = typeof element.getAttribute === 'function'
      ? compact([
        element.getAttribute('disabled'),
        element.getAttribute('aria-disabled'),
        element.getAttribute('data-disabled'),
      ].filter(Boolean).join(' '))
      : ''
    const className = compact(element.className || '')
    return !!element.disabled ||
      /^(true|disabled)$/i.test(disabledAttr) ||
      /\b(disabled|is-disabled|next-btn-disabled|ant-btn-disabled)\b/i.test(className)
  }

  function getAccessibleDocuments(rootDocument = document, seen = new Set()) {
    const docs = []
    const visit = doc => {
      if (!doc || seen.has(doc) || typeof doc.querySelectorAll !== 'function') return
      seen.add(doc)
      docs.push(doc)
      const frames = Array.from(doc.querySelectorAll('iframe') || [])
      frames.forEach(frame => {
        try {
          visit(frame.contentDocument || frame.contentWindow?.document)
        } catch (error) {
          // Cross-origin editor frames are ignored; the page-level controls remain searchable.
        }
      })
    }
    visit(rootDocument)
    return docs
  }

  function uniqueElements(elements) {
    const seen = new Set()
    const result = []
    for (const element of Array.isArray(elements) ? elements : []) {
      if (!element || seen.has(element)) continue
      seen.add(element)
      result.push(element)
    }
    return result
  }

  function isActionCandidate(element) {
    return isVisibleElement(element) && !isDisabledElement(element)
  }

  function smartClick(element) {
    if (!element) return false
    try {
      element.scrollIntoView?.({ block: 'center', inline: 'center' })
    } catch (error) {}
    try {
      const view = element.ownerDocument?.defaultView || window
      const eventInit = { bubbles: true, cancelable: true, view }
      ;['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(type => {
        const Ctor = type.startsWith('pointer') ? (view.PointerEvent || view.MouseEvent) : view.MouseEvent
        if (Ctor) element.dispatchEvent(new Ctor(type, eventInit))
      })
    } catch (error) {}
    try {
      element.click?.()
      return true
    } catch (error) {
      return false
    }
  }

  const ACTION_SELECTOR = 'button,a,[role="button"],[role="menuitem"],li,span,div'
  const DIALOG_SELECTOR = [
    '[role="dialog"]',
    '[aria-modal="true"]',
    '.next-dialog',
    '.next-overlay-wrapper',
    '.ant-modal',
    '.ant-modal-root',
    '.semi-modal',
    '.el-dialog',
    '.rax-dialog',
    '[class*="Dialog"]',
    '[class*="dialog"]',
    '[class*="Modal"]',
    '[class*="modal"]',
    '[class*="Popup"]',
    '[class*="popup"]',
  ].join(',')

  function labelMatches(text, label, options = {}) {
    const normalizedText = compact(text).replace(/\s+/g, '')
    const normalizedLabel = compact(label).replace(/\s+/g, '')
    if (!normalizedText || !normalizedLabel) return false
    if (normalizedText === normalizedLabel) return true
    if (options.allowContains !== false && normalizedText.includes(normalizedLabel)) return true
    return false
  }

  function candidateScore(element, label, options = {}) {
    const text = elementText(element)
    let score = 0
    if (compact(text).replace(/\s+/g, '') === compact(label).replace(/\s+/g, '')) score += 100
    if (/^(BUTTON|A)$/i.test(element.tagName || '')) score += 20
    if (String(element.getAttribute?.('role') || '').toLowerCase() === 'button') score += 10
    const className = compact(element.className || '')
    if (/(primary|submit|confirm|next-btn-primary|ant-btn-primary)/i.test(className)) score += 15
    const rect = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null
    if (options.preferBottom && rect) score += Math.max(0, Math.min(20, rect.top / 100))
    if (options.preferRight && rect) score += Math.max(0, Math.min(20, rect.left / 100))
    if (options.preferLeft && rect) score += Math.max(0, Math.min(40, (420 - rect.left) / 8))
    if (options.contextRegex && options.contextRegex.test(elementContextText(element, options.contextDepth || 5))) score += 30
    return score
  }

  function findVisibleActionByText(labels, options = {}) {
    const labelList = Array.isArray(labels) ? labels : [labels]
    const roots = options.root
      ? [options.root]
      : getAccessibleDocuments().flatMap(doc => options.dialogOnly ? visibleDialogRoots(doc) : [doc])
    const selector = options.selector || ACTION_SELECTOR
    const excludes = (Array.isArray(options.exclude) ? options.exclude : [options.exclude]).filter(Boolean)
    const matches = []
    for (const root of roots) {
      if (!root || typeof root.querySelectorAll !== 'function') continue
      const candidates = uniqueElements(Array.from(root.querySelectorAll(selector) || []))
      for (const element of candidates) {
        if (!isActionCandidate(element)) continue
        const text = elementText(element)
        if (!text) continue
        if (options.maxTextLength && text.length > options.maxTextLength) continue
        if (excludes.some(exclude => labelMatches(text, exclude, { allowContains: true }))) continue
        if (options.contextRegex && !options.contextRegex.test(elementContextText(element, options.contextDepth || 5))) continue
        const label = labelList.find(item => labelMatches(text, item, options))
        if (!label) continue
        matches.push({ element, label, score: candidateScore(element, label, options), text })
      }
    }
    matches.sort((a, b) => b.score - a.score)
    return matches[0]?.element || null
  }

  function visibleDialogRoots(rootDocument = document) {
    if (!rootDocument || typeof rootDocument.querySelectorAll !== 'function') return []
    return Array.from(rootDocument.querySelectorAll(DIALOG_SELECTOR) || [])
      .filter(root => isVisibleElement(root))
  }

  function clickVisibleActionByText(labels, options = {}) {
    const element = findVisibleActionByText(labels, options)
    return {
      ok: smartClick(element),
      text: element ? elementText(element) : '',
    }
  }

  function clickDialogConfirm(labels = ['确认', '确定'], options = {}) {
    const dialogElement = findVisibleActionByText(labels, {
      dialogOnly: true,
      allowContains: false,
      maxTextLength: 12,
      preferRight: true,
      exclude: ['取消', '关闭'],
    })
    const element = dialogElement || (options.allowPageFallback === false ? null : findVisibleActionByText(labels, {
      allowContains: false,
      maxTextLength: 12,
      preferRight: true,
      exclude: ['取消', '关闭'],
    }))
    return {
      ok: smartClick(element),
      text: element ? elementText(element) : '',
    }
  }

  function clickCloudMountTabByName(mountName) {
    const text = compact(mountName)
    const labels = [
      text,
      text.slice(0, 14),
      text.split(/[-－]/)[0],
    ].map(compact).filter(Boolean)
    return clickVisibleActionByText(labels, {
      allowContains: true,
      maxTextLength: 80,
      selector: 'li,div,span,a,[role="button"]',
      preferRight: false,
      preferLeft: true,
    })
  }

  function isCloudMountTabActive(mountName) {
    const text = compact(mountName)
    if (!text || !document?.querySelectorAll) return false
    const labels = [
      text,
      text.slice(0, 14),
      text.split(/[-－]/)[0],
    ].map(compact).filter(Boolean)
    const candidates = uniqueElements(Array.from(document.querySelectorAll('li,div,span,a,[role="button"]') || []))
    return candidates.some(element => {
      if (!isVisibleElement(element)) return false
      const elementLabel = elementText(element)
      if (!labels.some(label => labelMatches(elementLabel, label, { allowContains: true }))) return false
      const className = compact(element.className || '')
      const ariaSelected = compact(element.getAttribute?.('aria-selected'))
      const selected = compact(element.getAttribute?.('selected'))
      const current = compact(element.getAttribute?.('aria-current'))
      return /(^|\s)(active|selected|current|is-active|is-selected)(\s|$)/i.test(className) ||
        /selected|active|current/i.test(className) ||
        /^(true|page|step)$/i.test(ariaSelected || current || selected)
    })
  }

  function findReturnOldDescriptionSwitch() {
    if (!document?.querySelectorAll) return null
    const candidates = Array.from(document.querySelectorAll('button,a,span,div'))
    return candidates.find(element => {
      const text = compact(element?.innerText || element?.textContent)
      if (!text || text.length > 40) return false
      return text.includes('返回旧版图文描述') && isVisibleElement(element)
    }) || null
  }

  function hasReturnOldDescriptionSwitch() {
    return !!findReturnOldDescriptionSwitch()
  }

  function clickReturnOldDescriptionSwitch() {
    const element = findReturnOldDescriptionSwitch()
    if (!element) return false
    return smartClick(element)
  }

  function returnOldDescriptionConfirmRoots() {
    return getAccessibleDocuments()
      .flatMap(doc => visibleDialogRoots(doc))
      .filter(root => /确认返回旧版吗|返回旧版后无法切回新版/.test(elementText(root)))
  }

  function findReturnOldDescriptionConfirmElement() {
    for (const root of returnOldDescriptionConfirmRoots()) {
      const element = findVisibleActionByText(['确定', '确认'], {
        root,
        allowContains: false,
        maxTextLength: 8,
        preferRight: true,
        exclude: ['取消', '关闭'],
      })
      if (element) return element
    }
    return null
  }

  function extractFieldTextValue(value) {
    if (value == null) return ''
    if (typeof value === 'string' || typeof value === 'number') return compact(value)
    if (Array.isArray(value)) {
      for (const item of value) {
        const text = extractFieldTextValue(item)
        if (text) return text
      }
      return ''
    }
    if (typeof value === 'object') {
      const direct = value.text ?? value.value ?? value.label ?? value.name
      if (direct != null && typeof direct !== 'object') return compact(direct)
      if (direct != null) {
        const text = extractFieldTextValue(direct)
        if (text) return text
      }
    }
    return ''
  }

  function extractComponentValueText(names = []) {
    for (const name of names) {
      const text = extractFieldTextValue(getComponentValue(name))
      if (text) return text
    }
    return ''
  }

  function extractFormModelValueText(names = []) {
    try {
      const state = getSellState()
      const models = state?.engine && typeof state.engine.getModels === 'function'
        ? state.engine.getModels()
        : null
      const formValues = models?.formValues || {}
      for (const name of names) {
        const text = extractFieldTextValue(formValues?.[name])
        if (text) return text
      }
    } catch (error) {
      return ''
    }
    return ''
  }

  function extractInputValueBySelectors(selectors = []) {
    const docs = typeof getAccessibleDocuments === 'function'
      ? getAccessibleDocuments()
      : [document]
    for (const doc of docs) {
      for (const selector of selectors) {
        const element = doc?.querySelector?.(selector) ||
          Array.from(doc?.querySelectorAll?.(selector) || [])[0]
        const text = extractFieldTextValue(element?.value ?? element?.textContent)
        if (text) return text
      }
    }
    return ''
  }

  function extractItemPropCodeFromTmallState() {
    const props = getComponentValue('itemProp') || {}
    const direct = props?.['p-13021751'] || props?.['p-20431815']
    return extractFieldTextValue(direct)
  }

  function extractMerchantCodeFromTmallState() {
    return extractComponentValueText(['outerId']) ||
      extractFormModelValueText(['outerId']) ||
      extractInputValueBySelectors([
        '#sell-field-outerId input',
        '#struct-outerId input',
        'input[name="outerId"]',
        '[id*="outerId"] input',
      ])
  }

  function isBlockingTmallValidationMessage(message) {
    const text = compact(message)
    if (!text) return false
    if (text.includes('请至少维护1个商品视频')) return false
    return true
  }

  function extractTmallStatus(job = {}) {
    const text = String(document.body?.innerText || '')
    const validationMessages = []
    if (text.includes('必填项鞋帮高度不能为空')) validationMessages.push('必填项鞋帮高度不能为空')
    const itemPropProps = (() => {
      try {
        const state = getSellState()
        return state?.getComponentProps ? state.getComponentProps('itemProp') : null
      } catch (error) {
        return null
      }
    })()
    const itemMessage = itemPropProps?.itemMessage || {}
    Object.values(itemMessage).forEach(entry => {
      const messages = Array.isArray(entry?.message) ? entry.message : []
      messages.forEach(message => {
        const msg = compact(message?.msg)
        if (isBlockingTmallValidationMessage(msg) && !validationMessages.includes(msg)) validationMessages.push(msg)
      })
    })
    const merchantCode = extractMerchantCodeFromTmallState()
    const itemPropCode = extractItemPropCodeFromTmallState()
    return {
      url: location.href,
      title: document.title,
      itemId: normalizeItemId(location.href) || job.item_id || '',
      merchantCode,
      itemPropCode,
      styleCode: job.style_code || '',
      styleMatched: !job.style_code || !merchantCode || merchantCodeMatchesStyle(merchantCode, job.style_code),
      validationMessages,
      hasReturnOldDescription: hasReturnOldDescriptionSwitch(),
      ready: !!getSellState() && typeof getComponentValue('mainImagesGroup') !== 'undefined',
      currentCounts: {
        main1x1: (getComponentValue('mainImagesGroup')?.images || []).length,
        main3x4: (getComponentValue('threeToFourImages') || []).length,
        vertical: (getComponentValue('guideImageGroup')?.verticalImage || []).length,
        pcModules: (getComponentValue('modularDesc') || []).length,
      },
    }
  }

  function bodyText() {
    return compact(getAccessibleDocuments()
      .map(doc => String(doc.body?.innerText || doc.body?.textContent || ''))
      .join('\n'))
  }

  function detectTmallSpeedLimitWarning(text = bodyText()) {
    return /操作速度太快|稍等一会儿再试|访问过于频繁|请求过于频繁/.test(text)
  }

  function detectTmallCaptchaWarning(text = bodyText()) {
    return /验证码|安全验证|滑块验证|请完成验证/.test(text)
  }

  function clickSpeedLimitConfirmIfPresent() {
    const roots = getAccessibleDocuments()
      .flatMap(doc => visibleDialogRoots(doc))
      .filter(root => /操作速度太快|稍等一会儿再试|访问过于频繁|请求过于频繁/.test(elementText(root)))
    for (const root of roots) {
      const element = findVisibleActionByText(['确定', '确认'], {
        root,
        allowContains: false,
        maxTextLength: 8,
        preferRight: true,
        exclude: ['返回修改', '取消', '关闭'],
      })
      if (smartClick(element)) {
        return { ok: true, text: elementText(element) || '确定' }
      }
    }
    return { ok: false, text: '' }
  }

  function tmallAttributeUpdateConfirmToken(state = shared, stage = 'pc') {
    const normalizedStage = compact(stage || 'pc') || 'pc'
    const itemId = compact(state?.current_job?.item_id || normalizeItemId(location.href) || 'current')
    return `${normalizedStage}:${itemId}`
  }

  function getTmallAttributeUpdateConfirmedTokens(state = shared) {
    const value = state?.tmall_attribute_update_confirmed_tokens
    if (Array.isArray(value)) return value.map(item => compact(item)).filter(Boolean)
    if (typeof value === 'string') return value.split('|').map(item => compact(item)).filter(Boolean)
    return []
  }

  function hasConfirmedTmallAttributeUpdate(state = shared, stage = 'pc') {
    return getTmallAttributeUpdateConfirmedTokens(state).includes(tmallAttributeUpdateConfirmToken(state, stage))
  }

  function markTmallAttributeUpdateConfirmed(state = shared, stage = 'pc') {
    const tokens = getTmallAttributeUpdateConfirmedTokens(state)
    const token = tmallAttributeUpdateConfirmToken(state, stage)
    return {
      ...state,
      tmall_attribute_update_confirmed_tokens: tokens.includes(token) ? tokens : [...tokens, token],
    }
  }

  function tmallAttributeUpdateDialogRoots() {
    return getAccessibleDocuments()
      .flatMap(doc => visibleDialogRoots(doc))
      .filter(root => {
        const text = elementText(root)
        return /商品属性信息更新确定/.test(text) &&
          /平台识别到.*商品属性信息存在更新/.test(text)
      })
  }

  function hasTmallAttributeUpdateDialog() {
    return tmallAttributeUpdateDialogRoots().length > 0
  }

  function clickAttributeUpdateConfirmIfPresent() {
    const roots = tmallAttributeUpdateDialogRoots()
    for (const root of roots) {
      const element = findVisibleActionByText(['确定'], {
        root,
        allowContains: false,
        maxTextLength: 8,
        preferRight: true,
        exclude: ['取消', '关闭', '不采纳'],
      })
      if (smartClick(element)) {
        return { ok: true, text: elementText(element) || '确定' }
      }
    }
    return { ok: false, text: '' }
  }

  function extractPublishStatus(job = {}) {
    const status = extractTmallStatus(job)
    const text = bodyText()
    const success = /\/success\.htm/i.test(location.href) || /[?&]isSuccess=true(?:&|$)/i.test(location.href) ||
      /(发布成功|提交成功|更新成功|修改成功|保存成功|操作成功|商品已发布|已提交审核|更新完毕)/.test(text)
    const hasDialog = getAccessibleDocuments().some(doc => visibleDialogRoots(doc).length > 0)
    const dialogText = compact(getAccessibleDocuments()
      .flatMap(doc => visibleDialogRoots(doc))
      .map(root => elementText(root))
      .join(' '))
    const blockingMessages = [...status.validationMessages]
    if (/必填项未填|存在错误|请完善|请填写|不能为空/.test(text) && !blockingMessages.length) {
      blockingMessages.push('页面提示存在必填项或校验错误')
    }
    if (/类目为空或不存在/.test(text) && !blockingMessages.includes('类目为空或不存在')) {
      blockingMessages.push('类目为空或不存在')
    }
    return {
      ...status,
      success,
      hasDialog,
      dialogText,
      blockingMessages,
    }
  }

  function clickSubmitPublishButton() {
    return clickVisibleActionByText(['提交发布', '提交并发布', '立即发布'], {
      allowContains: false,
      maxTextLength: 16,
      preferBottom: true,
      preferRight: true,
      exclude: ['保存草稿', '仅保存', '预览', '取消'],
    }).ok
      ? { ok: true, text: '提交发布' }
      : clickVisibleActionByText(['提交发布', '提交并发布', '立即发布', '发布', '提交'], {
        allowContains: true,
        maxTextLength: 24,
        preferBottom: true,
        preferRight: true,
        exclude: ['保存草稿', '仅保存', '预览', '取消'],
      })
  }

  function clickPublishConfirmIfPresent() {
    const confirm = clickDialogConfirm(['确认提交', '确认', '确定', '继续发布', '提交', '发布'], {
      allowPageFallback: false,
    })
    if (confirm.ok) return confirm
    return { ok: false, text: '' }
  }

  function hasTmallDetailEditorUpgradePrompt(text = bodyText()) {
    return /图文详情编辑器升级提示/.test(String(text || ''))
  }

  function tmallUpgradePromptConfirmToken(state = shared, stage = 'pc') {
    const normalizedStage = compact(stage || 'pc') || 'pc'
    const itemId = compact(state?.current_job?.item_id || normalizeItemId(location.href) || 'current')
    return `${normalizedStage}:${itemId}`
  }

  function getTmallUpgradePromptConfirmedTokens(state = shared) {
    const value = state?.tmall_upgrade_prompt_confirmed_tokens
    if (Array.isArray(value)) return value.map(item => compact(item)).filter(Boolean)
    if (typeof value === 'string') return value.split('|').map(item => compact(item)).filter(Boolean)
    return []
  }

  function hasConfirmedTmallUpgradePrompt(state = shared, stage = 'pc') {
    return getTmallUpgradePromptConfirmedTokens(state).includes(tmallUpgradePromptConfirmToken(state, stage))
  }

  function markTmallUpgradePromptConfirmed(state = shared, stage = 'pc') {
    const tokens = getTmallUpgradePromptConfirmedTokens(state)
    const token = tmallUpgradePromptConfirmToken(state, stage)
    return {
      ...state,
      tmall_upgrade_prompt_confirmed_tokens: tokens.includes(token) ? tokens : [...tokens, token],
    }
  }

  function isTmallSubmitSuccessPage() {
    return /\/success\.htm/i.test(location.href) || /商品提交成功/.test(bodyText())
  }

  function findTmallSuccessEditElement() {
    return findVisibleActionByText(['编辑商品'], {
      allowContains: false,
      maxTextLength: 8,
      preferRight: true,
      exclude: ['查看商品', '继续发布'],
    })
  }

  function reenterTmallEditorFromSuccess(job = {}, state = shared) {
    const itemId = job.item_id || normalizeItemId(location.href)
    const nextShared = {
      ...state,
      reopened_after_pc_publish: true,
      tmall_wait_attempts: 0,
      current_store: '从成功页进入编辑商品',
    }
    const editElement = findTmallSuccessEditElement()
    const href = editElement?.href || (itemId
      ? `https://upload.taobao.com/auction/publish/edit.htm?item_num_id=${encodeURIComponent(itemId)}&auto=false`
      : `${TMALL_PUBLISH_URL}?id=${encodeURIComponent(itemId)}`)
    try {
      // Assigning location keeps navigation in the current tab; clicking the success-page link opens a new tab.
      location.href = href
    } catch (error) {}
    return nextPhase('wait_reopened_tmall_ready', TMALL_PAGE_WAIT_MS, nextShared)
  }

  function findMobileDetailEditButton() {
    const contextRegex = /(手机端详情描述|手机端详情|手机详情|无线端详情|移动端详情)/
    const exact = getAccessibleDocuments().flatMap(doc => {
      if (typeof doc.querySelectorAll !== 'function') return []
      return Array.from(doc.querySelectorAll('.sell-mobile-detail-header-edit-btn, button') || [])
        .filter(element => {
          if (!isVisibleElement(element)) return false
          const className = compact(element.className || '')
          const text = compact(elementText(element))
          return /sell-mobile-detail-header-edit-btn/.test(className) && /编辑详情|编辑/.test(text)
        })
    })
    if (exact.length) return exact[0]
    const scoped = getAccessibleDocuments().flatMap(doc => {
      if (typeof doc.querySelectorAll !== 'function') return []
      return Array.from(doc.querySelectorAll('div,section,article,li,tr,td') || [])
        .filter(root => isVisibleElement(root) && contextRegex.test(elementText(root)))
        .sort((a, b) => elementText(a).length - elementText(b).length)
        .map(root => findVisibleActionByText(['编辑详情', '编辑'], {
          root,
          allowContains: true,
          maxTextLength: 16,
          preferRight: true,
        }))
        .filter(Boolean)
    })
    if (scoped.length) return scoped[0]
    return findVisibleActionByText(['编辑详情', '编辑'], {
      allowContains: true,
      maxTextLength: 16,
      contextRegex,
      contextDepth: 8,
      preferRight: true,
    })
  }

  function clickMobileDetailEditButton() {
    const element = findMobileDetailEditButton()
    return {
      ok: smartClick(element),
      text: element ? elementText(element) : '',
    }
  }

  function mobileEditorSignals() {
    const text = bodyText()
    return {
      ready: /(清除所有模块|导入电脑端详情|导入详情|全图生成|完成编辑|确认并完成编辑)/.test(text),
      clearModules: /清除所有模块/.test(text),
      importPc: /导入电脑端详情/.test(text),
      fullImage: /全图生成/.test(text),
      finishEdit: /(完成编辑|确认并完成编辑)/.test(text),
      textSample: text.slice(0, 500),
    }
  }

  function findVisibleMobileDetailIframe() {
    const frames = getAccessibleDocuments().flatMap(doc => {
      if (typeof doc.querySelectorAll !== 'function') return []
      return Array.from(doc.querySelectorAll('iframe') || [])
    })
    return frames.find(frame => {
      if (!isVisibleElement(frame)) return false
      const src = compact(frame.getAttribute?.('src') || frame.src || '')
      const className = compact(frame.className || frame.getAttribute?.('class') || '')
      const title = compact(frame.getAttribute?.('title') || frame.getAttribute?.('name') || '')
      return /sell-detail-iframe/.test(className) ||
        /sell\.xiangqing\.taobao\.com\/sell\/transit\/gotoEdit\.do/i.test(src) ||
        (/clientType=1/.test(src) && /itemId=\d+/.test(src)) ||
        /手机详情|无线详情|mobile/i.test(title)
    }) || null
  }

  function findVisibleMobileEditorContainer() {
    const iframe = findVisibleMobileDetailIframe()
    const iframeRect = iframe?.getBoundingClientRect?.()
    const candidates = getAccessibleDocuments().flatMap(doc => {
      if (typeof doc.querySelectorAll !== 'function') return []
      return Array.from(doc.querySelectorAll([
        '.detail-editor-dialog',
        '[class*="detail-editor-dialog"]',
        '[class*="mobile-detail"]',
        '[class*="sell-detail"]',
        '[role="dialog"]',
        '.next-dialog',
        '.next-overlay-wrapper',
      ].join(',')) || [])
    }).filter(element => {
      if (!isVisibleElement(element)) return false
      const text = elementText(element)
      const className = compact(element.className || element.getAttribute?.('class') || '')
      if (/手机详情|无线详情|移动端详情|detail-editor|sell-detail|mobile-detail/i.test(`${text} ${className}`)) return true
      if (!iframeRect) return false
      const rect = element.getBoundingClientRect()
      const rectRight = Number(rect.right || (Number(rect.left) + Number(rect.width || 0)))
      const rectBottom = Number(rect.bottom || (Number(rect.top) + Number(rect.height || 0)))
      const iframeRight = Number(iframeRect.right || (Number(iframeRect.left) + Number(iframeRect.width || 0)))
      const iframeBottom = Number(iframeRect.bottom || (Number(iframeRect.top) + Number(iframeRect.height || 0)))
      return rect.left <= iframeRect.left + 8 &&
        rect.top <= iframeRect.top + 8 &&
        rectRight >= iframeRight - 8 &&
        rectBottom >= iframeBottom - 8
    })
    candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect()
      const br = b.getBoundingClientRect()
      return (ar.width * ar.height) - (br.width * br.height)
    })
    return candidates[0] || iframe || null
  }

  function mobileEditorFrameRect() {
    const container = findVisibleMobileEditorContainer()
    if (!container || typeof container.getBoundingClientRect !== 'function') return null
    const rect = container.getBoundingClientRect()
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null
    return rect
  }

  function visibleCrossOriginMobileEditor() {
    return !!findVisibleMobileDetailIframe()
  }

  function mobileEditorPoint(name) {
    const rect = mobileEditorFrameRect()
    if (!rect) return null
    const offset = {
      importMenu: [0.187, 38],
      importDetail: [0.194, 87],
      importPcDetail: [0.292, 130],
      fullImage: [0.330, 463],
      confirm: [0.757, 644],
      save: [0.848, 31],
      finish: [0.942, 31],
    }[name]
    if (!offset) return null
    const x = Number(rect.left) + Math.max(8, Math.min(Number(rect.width) - 8, Number(rect.width) * offset[0]))
    const y = Number(rect.top) + Math.max(8, Math.min(Number(rect.height) - 8, offset[1]))
    return { x, y }
  }

  function cdpMobileEditorClick(pointName, nextPhaseName, sleepMs = 500, newShared = shared, type = 'click') {
    const point = mobileEditorPoint(pointName)
    if (!point) return null
    const event = type === 'move'
      ? { type: 'move', x: point.x, y: point.y, delay_ms: sleepMs }
      : { x: point.x, y: point.y, delay_ms: sleepMs }
    return cdpClicks([event], nextPhaseName, 120, newShared)
  }

  function mobileEditorTargetUrlContains(state = shared) {
    const itemId = compact(state?.current_job?.item_id || state?.current_job?.itemId || state?.item_id || state?.itemId)
    const contains = ['sell.xiangqing.taobao.com/new_user_panel.htm']
    if (itemId) contains.push(`itemId=${itemId}`)
    return contains
  }

  function mobileEditorClearCanvasExpression() {
    return String.raw`(async () => {
  const compact = value => String(value || '').trim().replace(/\s+/g, ' ')
  const visible = element => {
    if (!element || typeof element.getBoundingClientRect !== 'function') return false
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0
  }
  const findCanvasProps = () => {
    const seen = new Set()
    let canvasProps = null
    const walk = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || seen.has(value) || depth > 8 || canvasProps) return
      seen.add(value)
      const props = value.props || value
      if (props && typeof props.clear === 'function' && Array.isArray(props.components) && Array.isArray(props.layout)) {
        canvasProps = props
        return
      }
      const keys = ['stateNode', '_instance', '_owner', '_currentElement', '_renderedComponent', '_renderedChildren', '_hostParent', 'return', 'child', 'sibling', 'alternate']
      keys.forEach(key => {
        try {
          const next = value[key]
          if (!next) return
          if (key === '_renderedChildren' && typeof next === 'object') {
            Object.values(next).slice(0, 50).forEach(item => walk(item, depth + 1))
          } else {
            walk(next, depth + 1)
          }
        } catch (error) {}
      })
      try {
        const ownerInstance = value._currentElement?._owner?._instance
        if (ownerInstance) walk(ownerInstance, depth + 1)
      } catch (error) {}
    }
    Array.from(document.querySelectorAll('*') || []).forEach(element => {
      const key = Object.keys(element).find(name => name.startsWith('__reactInternalInstance$') || name.startsWith('__reactFiber$'))
      if (key) walk(element[key], 0)
      const fiberKey = Object.keys(element).find(name => name.startsWith('__reactFiber$'))
      if (fiberKey && fiberKey !== key) walk(element[fiberKey], 0)
    })
    return canvasProps
  }
  const summarize = props => {
    const text = compact(document.body?.innerText || '')
    const images = Array.from(document.images || [])
      .filter(img => visible(img))
      .map(img => img.currentSrc || img.src || '')
      .filter(src => /imgextra|alicdn/i.test(src) && !/TB18VOYJ|spaceball\.gif/i.test(src))
    const groups = Array.isArray(props?.components) ? props.components.filter(item => item?.type === 'group') : []
    return {
      componentCount: Array.isArray(props?.components) ? props.components.length : null,
      groupCount: groups.length,
      visibleImageCount: images.length,
      moduleTextCount: (text.match(/图文模块/g) || []).length,
      hasEmptyNotice: /您还未添加任何模块|请在左侧通过点击选择模块进行装修/.test(text),
      textSample: text.slice(-500),
    }
  }
  const props = findCanvasProps()
  if (!props) return { ok: false, reason: '未找到手机详情编辑器画布' }
  const before = summarize(props)
  try {
    props.clear()
  } catch (error) {
    return { ok: false, reason: String(error?.message || error), before }
  }
  await new Promise(resolve => setTimeout(resolve, 600))
  const afterProps = findCanvasProps() || props
  const after = summarize(afterProps)
  const cleared = after.hasEmptyNotice || (after.visibleImageCount === 0 && after.moduleTextCount === 0)
  return { ok: cleared, before, after }
})()`
  }

  function clearMobileEditorModulesViaTarget(newShared = shared) {
    return cdpTargetEval(
      mobileEditorClearCanvasExpression(),
      'verify_mobile_editor_modules_cleared',
      800,
      {
        ...newShared,
        current_store: '清空旧手机端详情模块',
      },
      {
        target_url_contains: mobileEditorTargetUrlContains(newShared),
        target_types: ['page', 'iframe'],
        shared_key: 'mobile_editor_clear_result',
        user_gesture: true,
      },
    )
  }

  function mobileEditorExpectedImportImageCount(state = shared) {
    const detailCount = downloadedPcDetailRowCount(state?.current_result_rows || [])
    if (!detailCount) return 3
    return Math.max(1, Math.min(5, detailCount))
  }

  function mobileEditorImportPcDetailExpression(minExpectedImages = 3, itemId = '', options = {}) {
    const expected = Math.max(1, Number(minExpectedImages || 3))
    const expectedJson = JSON.stringify(expected)
    const itemIdJson = JSON.stringify(compact(itemId || ''))
    const generateOp = Number(options.generateOp) === 1 ? 1 : 0
    const generateOpJson = JSON.stringify(generateOp)
    const expectedUrlsJson = JSON.stringify(uniqueImageUrls(options.expectedUrls || []))
    return String.raw`(async () => {
  const minExpectedImages = ${expectedJson}
  const expectedItemId = ${itemIdJson}
  const generateOp = ${generateOpJson}
  const expectedUrls = ${expectedUrlsJson}
  const compact = value => String(value || '').trim().replace(/\s+/g, ' ')
  const comparableImageUrl = value => {
    const raw = String(value || '').trim().replace(/^https?:/i, '').split('?')[0].toLowerCase()
    return raw
  }
  const imageUrlMatches = (actual, expected) => {
    const actualKey = comparableImageUrl(actual)
    const expectedKey = comparableImageUrl(expected)
    return !!actualKey && !!expectedKey && (actualKey === expectedKey || actualKey.includes(expectedKey) || expectedKey.includes(actualKey))
  }
  const visible = element => {
    if (!element || typeof element.getBoundingClientRect !== 'function') return false
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0
  }
  const reactProps = element => {
    const key = Object.keys(element || {}).find(name => name.startsWith('__reactInternalInstance$') || name.startsWith('__reactFiber$'))
    const node = key ? element[key] : null
    return node?.memoizedProps || node?.pendingProps || node?._currentElement?.props || node?._instance?.props || null
  }
  const clickReact = (element, names = ['onClick']) => {
    if (!element) return []
    const props = reactProps(element) || {}
    const event = {
      target: element,
      currentTarget: element,
      type: 'click',
      preventDefault() {},
      stopPropagation() {},
      nativeEvent: new MouseEvent('click', { bubbles: true, cancelable: true, view: window }),
    }
    const calls = []
    names.forEach(name => {
      if (typeof props[name] !== 'function') return
      try {
        props[name](event)
        calls.push(name + ':ok')
      } catch (error) {
        calls.push(name + ':ERR:' + String(error?.message || error))
      }
    })
    if (!calls.length) {
      try { element.click?.() } catch (error) { calls.push('native:ERR:' + String(error?.message || error)) }
    }
    return calls
  }
  const findCanvasProps = () => {
    const seen = new Set()
    let canvasProps = null
    const walk = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || seen.has(value) || depth > 9 || canvasProps) return
      seen.add(value)
      const props = value.props || value.memoizedProps || value.pendingProps || value._currentElement?.props || value._instance?.props || value
      if (props && typeof props.clear === 'function' && Array.isArray(props.components) && Array.isArray(props.layout)) {
        canvasProps = props
        return
      }
      const keys = ['stateNode', '_instance', '_owner', '_currentElement', '_renderedComponent', '_renderedChildren', 'return', 'child', 'sibling', 'alternate']
      keys.forEach(key => {
        try {
          const next = value[key]
          if (!next) return
          if (key === '_renderedChildren' && typeof next === 'object') {
            Object.values(next).slice(0, 80).forEach(item => walk(item, depth + 1))
          } else {
            walk(next, depth + 1)
          }
        } catch (error) {}
      })
    }
    Array.from(document.querySelectorAll('*') || []).forEach(element => {
      Object.keys(element).filter(key => key.startsWith('__reactInternalInstance$') || key.startsWith('__reactFiber$')).forEach(key => walk(element[key], 0))
    })
    return canvasProps
  }
  const summarize = () => {
    const props = findCanvasProps()
    const text = compact(document.body?.innerText || '')
    let allText = ''
    try { allText = JSON.stringify({ components: props?.components, layout: props?.layout }) } catch (error) {}
    const canvasUrls = Array.from(new Set(
      (allText.match(/https?:\\?\/\\?\/[^"'\\]+/g) || [])
        .map(url => url.replace(/\\\//g, '/'))
        .filter(url => /imgextra|alicdn/i.test(url) && !/spaceball\.gif|W0rsa3mTBu/i.test(url))
    ))
    const images = Array.from(document.images || [])
      .filter(visible)
      .map(img => img.currentSrc || img.src || '')
      .filter(url => /imgextra|alicdn/i.test(url) && !/TB18VOYJ|spaceball\.gif|W0rsa3mTBu/i.test(url))
    const groups = Array.isArray(props?.components) ? props.components.filter(item => item?.type === 'group') : []
    const canvasExpectedHits = expectedUrls.filter(expected => canvasUrls.some(url => imageUrlMatches(url, expected)))
    const visibleExpectedHits = expectedUrls.filter(expected => images.some(url => imageUrlMatches(url, expected)))
    const dialogText = compact(Array.from(document.querySelectorAll('.next-dialog,[role="dialog"],.next-message,.next-feedback,.next-notice') || [])
      .filter(visible)
      .map(element => element.innerText || element.textContent || '')
      .join(' | '))
    return {
      componentCount: Array.isArray(props?.components) ? props.components.length : null,
      groupCount: groups.length,
      visibleImageCount: images.length,
      canvasImageCount: canvasUrls.length,
      expectedUrlCount: expectedUrls.length,
      canvasExpectedHitCount: canvasExpectedHits.length,
      visibleExpectedHitCount: visibleExpectedHits.length,
      hasEmptyNotice: /您还未添加任何模块|请在左侧通过点击选择模块进行装修/.test(text),
      dialogText: dialogText.slice(0, 1000),
      textSample: text.slice(-800),
      imageSamples: Array.from(new Set([...canvasUrls, ...images])).slice(0, 8),
      canvasExpectedHits: canvasExpectedHits.slice(0, 20),
    }
  }
  const findImportInstance = () => {
    const seen = new Set()
    let found = null
    const walk = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || seen.has(value) || depth > 12 || found) return
      seen.add(value)
      const instance = value._instance || value.stateNode || value
      const stateItemId = compact(instance?.state?.itemId || '')
      if (
        instance &&
        typeof instance.select === 'function' &&
        typeof instance.process === 'function' &&
        instance.state &&
        (!expectedItemId || stateItemId === expectedItemId)
      ) {
        found = instance
        return
      }
      const keys = ['stateNode', '_instance', '_owner', '_currentElement', '_renderedComponent', '_renderedChildren', 'return', 'child', 'sibling', 'alternate']
      keys.forEach(key => {
        try {
          const next = value[key]
          if (!next) return
          if (key === '_renderedChildren' && typeof next === 'object') {
            Object.values(next).slice(0, 80).forEach(item => walk(item, depth + 1))
          } else {
            walk(next, depth + 1)
          }
        } catch (error) {}
      })
    }
    Array.from(document.querySelectorAll('*') || []).forEach(element => {
      Object.keys(element).filter(key => key.startsWith('__reactInternalInstance$') || key.startsWith('__reactFiber$')).forEach(key => walk(element[key], 0))
    })
    return found
  }
  const exactText = label => Array.from(document.querySelectorAll('button,a,li,div,span,[role="menuitem"]') || [])
    .filter(visible)
    .find(element => compact(element.innerText || element.textContent) === label)
  const importSuccessConfirmButton = snapshot => /导入电脑端详情成功/.test(snapshot?.dialogText || '')
    ? Array.from(document.querySelectorAll('.next-dialog button,button') || [])
      .filter(visible)
      .find(element => compact(element.innerText || element.textContent) === '确认')
    : null
  const waitFor = async (predicate, attempts = 20, delay = 300) => {
    for (let i = 0; i < attempts; i += 1) {
      const value = predicate()
      if (value) return value
      await new Promise(resolve => setTimeout(resolve, delay))
    }
    return null
  }

  const before = summarize()
  const importButton = Array.from(document.querySelectorAll('button') || []).filter(visible).find(element => compact(element.innerText || element.textContent) === '导入') || exactText('导入')
  if (!importButton) return { ok: false, reason: '未找到“导入”按钮', before }
  const calls = []
  calls.push(...clickReact(importButton, ['onMouseEnter', 'onClick']))
  await waitFor(() => exactText('导入详情'), 20, 300)
  const importDetail = Array.from(document.querySelectorAll('.next-menu-submenu-title,li,div') || [])
    .filter(visible)
    .find(element => compact(element.innerText || element.textContent) === '导入详情' && /submenu-title/.test(String(element.className || ''))) || exactText('导入详情')
  if (!importDetail) return { ok: false, reason: '未找到“导入详情”菜单', before, calls }
  calls.push(...clickReact(importDetail, ['onMouseEnter', 'onClick']))
  const importPc = await waitFor(() => exactText('导入电脑端详情'), 20, 300)
  if (!importPc) return { ok: false, reason: '未找到“导入电脑端详情”菜单项', before, calls, textSample: compact(document.body?.innerText || '').slice(-1000) }
  calls.push(...clickReact(importPc, ['onClick']))
  const importInstance = await waitFor(() => findImportInstance(), 30, 500)
  if (!importInstance) return { ok: false, reason: '未找到导入电脑端详情弹窗实例', before, calls, afterMenu: summarize() }
  try {
    if (importInstance.state?.op !== generateOp) importInstance.select(generateOp)
  } catch (error) {
    return { ok: false, reason: '选择手机端生成方式失败：' + String(error?.message || error), before, calls, generateOp }
  }
  await new Promise(resolve => setTimeout(resolve, 500))
  if ((findImportInstance() || importInstance)?.state?.op !== generateOp) {
    return { ok: false, reason: generateOp === 0 ? '全图生成未选中' : '图文分离未选中', before, calls, importState: importInstance.state, generateOp }
  }
  try {
    ;(findImportInstance() || importInstance).process()
  } catch (error) {
    return { ok: false, reason: '导入电脑端详情失败：' + String(error?.message || error), before, calls, importState: importInstance.state }
  }
  const snapshots = []
  for (let i = 0; i < 75; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    const snapshot = summarize()
    const currentInstance = findImportInstance()
    snapshots.push({
      i: i + 1,
      componentCount: snapshot.componentCount,
      groupCount: snapshot.groupCount,
      visibleImageCount: snapshot.visibleImageCount,
      canvasImageCount: snapshot.canvasImageCount,
      canvasExpectedHitCount: snapshot.canvasExpectedHitCount,
      expectedUrlCount: snapshot.expectedUrlCount,
      hasEmptyNotice: snapshot.hasEmptyNotice,
      dialogText: snapshot.dialogText.slice(0, 160),
      stage: currentInstance?.state?.stage,
      op: currentInstance?.state?.op,
    })
    const successConfirmButton = importSuccessConfirmButton(snapshot)
    if (successConfirmButton) {
      const closeCalls = clickReact(successConfirmButton, ['onClick'])
      await new Promise(resolve => setTimeout(resolve, 1500))
      const afterConfirm = summarize()
      return {
        ok: true,
        before,
        after: {
          ...afterConfirm,
          importSuccessDialog: true,
          importSuccessDialogText: snapshot.dialogText,
        },
        minExpectedImages,
        generateOp,
        calls,
        importSuccessClosed: true,
        closeCalls,
        snapshots: snapshots.slice(-10),
        importState: currentInstance ? {
          visible: currentInstance.state?.visible,
          op: currentInstance.state?.op,
          stage: currentInstance.state?.stage,
          message: currentInstance.state?.message,
        } : null,
      }
    }
    if (
      snapshot.canvasImageCount >= minExpectedImages &&
      snapshot.groupCount >= 1 &&
      !snapshot.hasEmptyNotice
    ) {
      if (expectedUrls.length && snapshot.canvasExpectedHitCount < expectedUrls.length) {
        return {
          ok: false,
          reason: '导入后手机画布未命中本次PC详情图：' + snapshot.canvasExpectedHitCount + '/' + expectedUrls.length,
          before,
          after: snapshot,
          minExpectedImages,
          generateOp,
          calls,
          snapshots: snapshots.slice(-10),
        }
      }
      const confirmButton = importSuccessConfirmButton(snapshot)
      const closeCalls = confirmButton ? clickReact(confirmButton, ['onClick']) : []
      if (confirmButton) await new Promise(resolve => setTimeout(resolve, 500))
      return {
        ok: true,
        before,
        after: {
          ...snapshot,
          importSuccessDialog: !!confirmButton,
          importSuccessDialogText: confirmButton ? snapshot.dialogText : '',
        },
        minExpectedImages,
        generateOp,
        calls,
        importSuccessClosed: !!confirmButton,
        closeCalls,
        snapshots: snapshots.slice(-10),
        importState: currentInstance ? {
          visible: currentInstance.state?.visible,
          op: currentInstance.state?.op,
          stage: currentInstance.state?.stage,
          message: currentInstance.state?.message,
        } : null,
      }
    }
    if (/失败|错误|异常/.test(snapshot.dialogText)) {
      return { ok: false, reason: '导入电脑端详情弹窗报错', before, after: snapshot, calls, snapshots: snapshots.slice(-10) }
    }
  }
  return { ok: false, reason: '导入后未出现新手机详情模块', before, after: summarize(), calls, generateOp, snapshots: snapshots.slice(-20) }
})()`
  }

  function importMobilePcDetailViaTarget(newShared = shared) {
    const itemId = compact(newShared?.current_job?.item_id || newShared?.current_job?.itemId || newShared?.item_id || newShared?.itemId)
    const generateOp = Number(newShared.mobile_import_generate_op) === 1 ? 1 : 0
    return cdpTargetEval(
      mobileEditorImportPcDetailExpression(mobileEditorExpectedImportImageCount(newShared), itemId, {
        generateOp,
        expectedUrls: expectedPcDetailUrlsFromShared(newShared),
      }),
      'verify_mobile_editor_imported',
      1000,
      {
        ...newShared,
        mobile_import_generate_op: generateOp,
        mobile_generate_mode: generateOp === 1 ? '图文分离' : '全图生成',
        current_store: generateOp === 1 ? '手机端导入电脑端详情（图文分离）' : '手机端导入电脑端详情（全图生成）',
      },
      {
        target_url_contains: mobileEditorTargetUrlContains(newShared),
        target_types: ['page', 'iframe'],
        shared_key: 'mobile_editor_import_result',
        user_gesture: true,
      },
    )
  }

  function mobileEditorSaveExpression() {
    return String.raw`(async () => {
  const compact = value => String(value || '').trim().replace(/\s+/g, ' ')
  const visible = element => {
    if (!element || typeof element.getBoundingClientRect !== 'function') return false
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0
  }
  const reactProps = element => {
    const key = Object.keys(element || {}).find(name => name.startsWith('__reactInternalInstance$') || name.startsWith('__reactFiber$'))
    const node = key ? element[key] : null
    return node?.memoizedProps || node?.pendingProps || node?._currentElement?.props || node?._instance?.props || null
  }
  const clickReact = element => {
    const props = reactProps(element) || {}
    const event = { target: element, currentTarget: element, type: 'click', preventDefault() {}, stopPropagation() {}, nativeEvent: new MouseEvent('click', { bubbles: true, cancelable: true, view: window }) }
    const calls = []
    if (typeof props.onClick === 'function') {
      try { props.onClick(event); calls.push('onClick:ok') } catch (error) { calls.push('onClick:ERR:' + String(error?.message || error)) }
    }
    if (!calls.length) {
      try { element.click?.() } catch (error) { calls.push('native:ERR:' + String(error?.message || error)) }
    }
    return calls
  }
  const findCanvasProps = () => {
    const seen = new Set()
    let canvasProps = null
    const walk = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || seen.has(value) || depth > 9 || canvasProps) return
      seen.add(value)
      const props = value.props || value.memoizedProps || value.pendingProps || value._currentElement?.props || value._instance?.props || value
      if (props && typeof props.clear === 'function' && Array.isArray(props.components) && Array.isArray(props.layout)) {
        canvasProps = props
        return
      }
      ;['stateNode', '_instance', '_owner', '_currentElement', '_renderedComponent', '_renderedChildren', 'return', 'child', 'sibling', 'alternate'].forEach(key => {
        try {
          const next = value[key]
          if (!next) return
          if (key === '_renderedChildren' && typeof next === 'object') Object.values(next).slice(0, 80).forEach(item => walk(item, depth + 1))
          else walk(next, depth + 1)
        } catch (error) {}
      })
    }
    Array.from(document.querySelectorAll('*') || []).forEach(element => Object.keys(element).filter(key => key.startsWith('__reactInternalInstance$') || key.startsWith('__reactFiber$')).forEach(key => walk(element[key], 0)))
    return canvasProps
  }
  const summarize = () => {
    const props = findCanvasProps()
    let allText = ''
    try { allText = JSON.stringify({ components: props?.components, layout: props?.layout }) } catch (error) {}
    const imageUrls = Array.from(new Set((allText.match(/https?:\\?\/\\?\/[^"'\\]+/g) || []).map(url => url.replace(/\\\//g, '/')).filter(url => /imgextra|alicdn/i.test(url) && !/spaceball\.gif/i.test(url))))
    const groups = Array.isArray(props?.components) ? props.components.filter(item => item?.type === 'group') : []
    const text = compact(document.body?.innerText || '')
    const dialogText = compact(Array.from(document.querySelectorAll('.next-dialog,.next-message,.next-feedback,.next-notice') || []).filter(visible).map(element => element.innerText || element.textContent || '').join(' | '))
    return {
      componentCount: Array.isArray(props?.components) ? props.components.length : null,
      groupCount: groups.length,
      canvasImageCount: imageUrls.length,
      dialogText: dialogText.slice(0, 800),
      textSample: text.slice(-500),
      imageSamples: imageUrls.slice(0, 5),
    }
  }
  const before = summarize()
  const save = Array.from(document.querySelectorAll('a,button,div') || []).filter(visible).find(element => compact(element.innerText || element.textContent) === '保存')
  if (!save) return { ok: false, reason: '未找到“保存”按钮', before }
  const calls = clickReact(save)
  const snapshots = []
  for (let i = 0; i < 60; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 600))
    const snapshot = summarize()
    snapshots.push({ i: i + 1, componentCount: snapshot.componentCount, groupCount: snapshot.groupCount, canvasImageCount: snapshot.canvasImageCount, dialogText: snapshot.dialogText.slice(0, 160), textSample: snapshot.textSample.slice(-160) })
    if (/保存成功|保存已成功|保存完成|操作成功|成功/.test(snapshot.dialogText + ' ' + snapshot.textSample)) {
      return { ok: true, before, after: snapshot, calls, snapshots: snapshots.slice(-8) }
    }
    if (/失败|错误|异常/.test(snapshot.dialogText)) {
      return { ok: false, reason: '保存手机端详情报错', before, after: snapshot, calls, snapshots: snapshots.slice(-8) }
    }
  }
  return { ok: false, reason: '保存后未确认成功', before, after: summarize(), calls, snapshots: snapshots.slice(-10) }
})()`
  }

  function saveMobileEditorViaTarget(newShared = shared) {
    return cdpTargetEval(
      mobileEditorSaveExpression(),
      'verify_mobile_editor_saved',
      1000,
      {
        ...newShared,
        current_store: '保存手机端详情编辑',
      },
      {
        target_url_contains: mobileEditorTargetUrlContains(newShared),
        target_types: ['page', 'iframe'],
        shared_key: 'mobile_editor_save_result',
        user_gesture: true,
      },
    )
  }

  function mobileEditorFinishExpression() {
    return String.raw`(async () => {
  const compact = value => String(value || '').trim().replace(/\s+/g, ' ')
  const visible = element => {
    if (!element || typeof element.getBoundingClientRect !== 'function') return false
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0
  }
  const reactProps = element => {
    const key = Object.keys(element || {}).find(name => name.startsWith('__reactInternalInstance$') || name.startsWith('__reactFiber$'))
    const node = key ? element[key] : null
    return node?.memoizedProps || node?.pendingProps || node?._currentElement?.props || node?._instance?.props || null
  }
  const finish = Array.from(document.querySelectorAll('a,button,div') || []).filter(visible).find(element => compact(element.innerText || element.textContent) === '完成编辑')
  if (!finish) return { ok: false, reason: '未找到“完成编辑”按钮', textSample: compact(document.body?.innerText || '').slice(-1000) }
  const props = reactProps(finish) || {}
  const event = { target: finish, currentTarget: finish, type: 'click', preventDefault() {}, stopPropagation() {}, nativeEvent: new MouseEvent('click', { bubbles: true, cancelable: true, view: window }) }
  const calls = []
  if (typeof props.onClick === 'function') {
    try { props.onClick(event); calls.push('onClick:ok') } catch (error) { calls.push('onClick:ERR:' + String(error?.message || error)) }
  }
  if (!calls.length) {
    try { finish.click?.() } catch (error) { calls.push('native:ERR:' + String(error?.message || error)) }
  }
  await new Promise(resolve => setTimeout(resolve, 1200))
  return { ok: true, calls, textSample: compact(document.body?.innerText || '').slice(-1000), href: location.href }
})()`
  }

  function finishMobileEditorViaTarget(newShared = shared) {
    return cdpTargetEval(
      mobileEditorFinishExpression(),
      'wait_after_mobile_finish',
      1200,
      {
        ...newShared,
        mobile_action_attempts: 0,
        mobile_wait_attempts: 0,
        mobile_sync_note: newShared.mobile_sync_note || `手机端详情已导入电脑端详情（${newShared.mobile_generate_mode || '全图生成'}），并已点击保存`,
        current_store: '手机端详情完成编辑，等待返回商品编辑页',
      },
      {
        target_url_contains: mobileEditorTargetUrlContains(newShared),
        target_types: ['page', 'iframe'],
        shared_key: 'mobile_editor_finish_result',
        user_gesture: true,
      },
    )
  }

  function clickMobileModuleMenu() {
    if (mobileEditorSignals().clearModules) return { ok: true, text: '清除所有模块已可见' }
    const labels = ['模块', '组件', '图文模块', '模块管理']
    const byText = clickVisibleActionByText(labels, {
      allowContains: true,
      maxTextLength: 18,
      preferBottom: false,
      exclude: ['添加模块', '保存模块'],
    })
    if (byText.ok) return byText

    const candidates = getAccessibleDocuments().flatMap(doc => Array.from(doc.querySelectorAll('button,[role="button"],a') || []))
      .filter(element => isActionCandidate(element))
      .filter(element => {
        const attrs = compact([
          element.getAttribute?.('aria-label'),
          element.getAttribute?.('title'),
          element.getAttribute?.('class'),
          element.getAttribute?.('data-spm-click'),
        ].filter(Boolean).join(' '))
        return /(module|modules|component|grid|square|模块|组件|宫格|方块)/i.test(attrs)
      })
    const element = candidates[0] || null
    return {
      ok: smartClick(element),
      text: element ? elementText(element) || compact(element.getAttribute?.('aria-label') || element.getAttribute?.('title') || '') : '',
    }
  }

  function clickClearAllMobileModules() {
    const clear = clickVisibleActionByText(['清除所有模块'], {
      allowContains: false,
      maxTextLength: 16,
      preferRight: true,
    }) || { ok: false }
    if (clear.ok) return clear
    return clickVisibleActionByText(['清除所有模块'], {
      allowContains: true,
      maxTextLength: 24,
      preferRight: true,
    })
  }

  function clickMobileImportMenu() {
    if (mobileEditorSignals().importPc) return { ok: true, text: '导入电脑端详情已可见' }
    return clickVisibleActionByText(['导入'], {
      allowContains: false,
      maxTextLength: 12,
      preferRight: true,
      exclude: ['导入电脑端详情'],
    })
  }

  function findMobileImportMenuElement() {
    if (mobileEditorSignals().importPc) return null
    return findVisibleActionByText(['导入'], {
      allowContains: false,
      maxTextLength: 12,
      preferRight: true,
      exclude: ['导入电脑端详情'],
    })
  }

  function clickMobileImportDetail() {
    if (mobileEditorSignals().importPc) return { ok: true, text: '导入电脑端详情已可见' }
    return clickVisibleActionByText(['导入详情'], {
      allowContains: true,
      maxTextLength: 20,
      preferRight: true,
    })
  }

  function findMobileImportDetailElement() {
    if (mobileEditorSignals().importPc) return null
    return findVisibleActionByText(['导入详情'], {
      allowContains: true,
      maxTextLength: 20,
      preferRight: true,
    })
  }

  function clickMobileImportPcDetail() {
    return clickVisibleActionByText(['导入电脑端详情'], {
      allowContains: true,
      maxTextLength: 24,
      preferRight: true,
    })
  }

  function findMobileImportPcDetailElement() {
    return findVisibleActionByText(['导入电脑端详情'], {
      allowContains: true,
      maxTextLength: 24,
      preferRight: true,
    })
  }

  function clickMobileFullImageGenerate() {
    return clickVisibleActionByText(['全图生成', '图文分离'], {
      allowContains: true,
      maxTextLength: 24,
      preferRight: true,
    })
  }

  function elementCenter(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return null
    try {
      element.scrollIntoView?.({ block: 'center', inline: 'center' })
    } catch (error) {}
    const rect = element.getBoundingClientRect()
    if (!rect || !Number.isFinite(Number(rect.left)) || !Number.isFinite(Number(rect.top))) return null
    return {
      x: Number(rect.left) + Number(rect.width || 0) / 2,
      y: Number(rect.top) + Number(rect.height || 0) / 2,
    }
  }

  function cdpMoveElement(element, nextPhaseName, sleepMs = 500, newShared = shared) {
    const center = elementCenter(element)
    if (!center) return null
    return cdpClicks([{ type: 'move', x: center.x, y: center.y, delay_ms: sleepMs }], nextPhaseName, 120, newShared)
  }

  function cdpClickElement(element, nextPhaseName, sleepMs = 500, newShared = shared) {
    const center = elementCenter(element)
    if (!center) return null
    return cdpClicks([{ x: center.x, y: center.y, delay_ms: sleepMs }], nextPhaseName, 120, newShared)
  }

  function findMobileGenerateOption(label) {
    const labelText = compact(label)
    const candidates = getAccessibleDocuments().flatMap(doc => {
      if (typeof doc.querySelectorAll !== 'function') return []
      return Array.from(doc.querySelectorAll('li,label,span,div') || [])
    }).filter(element => {
      if (!isVisibleElement(element)) return false
      const text = compact(elementText(element)).replace(/\s+/g, '')
      return text === labelText || text.startsWith(labelText)
    })
    const element = candidates.find(candidate => compact(elementText(candidate)).replace(/\s+/g, '') === labelText) || candidates[0] || null
    if (!element) return null
    const container = typeof element.closest === 'function' ? (element.closest('li') || element.closest('label') || element) : element
    const input = typeof container.querySelector === 'function' ? container.querySelector('input[type="radio"]') : null
    return {
      element: input || element,
      text: labelText,
      disabled: !!input?.disabled || /disabled/i.test(compact(container?.className || element.className || '')),
      selected: !!input?.checked || /(^|\s)checked(\s|$)/i.test(compact(container?.className || '')),
    }
  }

  function selectMobileGenerateOptionByPriority() {
    const fullImage = findMobileGenerateOption('全图生成')
    if (fullImage && !fullImage.disabled) return fullImage
    const split = findMobileGenerateOption('图文分离')
    return split || fullImage
  }

  function clickMobileFinishEdit() {
    const finish = clickVisibleActionByText(['确认并完成编辑', '完成编辑', '完成'], {
      allowContains: true,
      maxTextLength: 24,
      preferBottom: true,
      preferRight: true,
      exclude: ['取消', '关闭'],
    })
    if (finish.ok) return finish
    return clickDialogConfirm(['确认', '确定'])
  }

  function findMobileSaveEditElement() {
    return findVisibleActionByText(['保存'], {
      allowContains: false,
      maxTextLength: 8,
      preferBottom: false,
      preferRight: true,
      exclude: ['保存模块', '保存草稿', '仅保存', '另存为'],
    })
  }

  function findMobileFinishEditElement() {
    return findVisibleActionByText(['确认并完成编辑', '完成编辑', '完成'], {
      allowContains: true,
      maxTextLength: 24,
      preferBottom: true,
      preferRight: true,
      exclude: ['取消', '关闭'],
    }) || findVisibleActionByText(['确认', '确定'], {
      dialogOnly: true,
      allowContains: false,
      maxTextLength: 12,
      preferRight: true,
      exclude: ['取消', '关闭'],
    })
  }

  function findMobileImportConfirmElement() {
    return findVisibleActionByText(['确认', '确定', '生成', '导入'], {
      dialogOnly: true,
      allowContains: false,
      maxTextLength: 12,
      preferRight: true,
      exclude: ['取消', '关闭'],
    }) || findVisibleActionByText(['确认', '确定', '生成', '导入'], {
      allowContains: false,
      maxTextLength: 12,
      preferRight: true,
      exclude: ['取消', '关闭'],
    })
  }

  function findReactInstancesInDocument(doc, predicate, limit = 20) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return []
    const results = []
    const seen = new Set()
    const walk = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || seen.has(value) || depth > 9 || results.length >= limit) return
      seen.add(value)
      try {
        if (predicate(value)) results.push(value)
      } catch (error) {}
      const keys = [
        'stateNode',
        '_instance',
        '_owner',
        '_currentElement',
        '_renderedComponent',
        '_renderedChildren',
        '_hostParent',
        'return',
        'child',
        'sibling',
        'alternate',
      ]
      keys.forEach(key => {
        try {
          const next = value[key]
          if (!next) return
          if (key === '_renderedChildren' && typeof next === 'object') {
            Object.values(next).slice(0, 30).forEach(item => walk(item, depth + 1))
          } else {
            walk(next, depth + 1)
          }
        } catch (error) {}
      })
      try {
        const ownerInstance = value._currentElement?._owner?._instance
        if (ownerInstance) walk(ownerInstance, depth + 1)
      } catch (error) {}
    }
    Array.from(doc.querySelectorAll('*') || []).forEach(element => {
      const key = Object.keys(element).find(name => name.startsWith('__reactInternalInstance$') || name.startsWith('__reactFiber$'))
      if (key) walk(element[key], 0)
    })
    return results
  }

  function findMobileEditorCanvasProps() {
    const predicate = instance => !!(
      instance?.props &&
      typeof instance.props.addGroup === 'function' &&
      typeof instance.props.addComponent === 'function'
    )
    for (const doc of getAccessibleDocuments()) {
      const found = findReactInstancesInDocument(doc, predicate, 1)[0]
      if (found?.props) return found.props
    }
    return null
  }

  function mobileEditorCanvasText(value) {
    try {
      return JSON.stringify(value || '')
    } catch (error) {
      return ''
    }
  }

  function isBadMobileEditorImportedNode(value) {
    return /spaceball\.gif|图片在图片空间被删除/.test(mobileEditorCanvasText(value))
  }

  function cleanupMobileEditorImportedCanvas() {
    const canvasProps = findMobileEditorCanvasProps()
    if (!canvasProps) return { ok: false, reason: '未找到旧版手机详情编辑器画布' }
    const components = Array.isArray(canvasProps.components) ? canvasProps.components : []
    const badGroupIds = components
      .filter(item => item?.type === 'group' && isBadMobileEditorImportedNode(item))
      .map(item => compact(item.id || item.props?.groupId || item.props?.id))
      .filter(Boolean)
    const badGroupIdSet = new Set(badGroupIds)
    const badComponentIds = components
      .filter(item => {
        const id = compact(item.id || item.props?.componentId || item.props?.id)
        const groupId = compact(item.props?.groupId || item.groupId)
        return id && item?.type !== 'group' && (badGroupIdSet.has(groupId) || isBadMobileEditorImportedNode(item))
      })
      .map(item => compact(item.id || item.props?.componentId || item.props?.id))
      .filter(Boolean)

    const removedGroups = []
    const removedComponents = []
    badGroupIds.forEach(id => {
      try {
        canvasProps.removeGroup?.(id)
        removedGroups.push(id)
      } catch (error) {
        removedGroups.push(`ERR:${id}:${String(error?.message || error)}`)
      }
    })
    badComponentIds.forEach(id => {
      try {
        canvasProps.removeComponent?.(id)
        removedComponents.push(id)
      } catch (error) {
        removedComponents.push(`ERR:${id}:${String(error?.message || error)}`)
      }
    })

    const allText = mobileEditorCanvasText({
      layout: canvasProps.layout,
      components: canvasProps.components,
    })
    const imageUrls = uniqueImageUrls(collectRemoteImageUrls(allText)).filter(url => !/spaceball\.gif/i.test(url))
    const remainingErrors = (allText.match(/图片在图片空间被删除|spaceball\.gif|单个图文模块高度不得超过12000px/g) || [])
    return {
      ok: true,
      removedGroupCount: badGroupIds.length,
      removedComponentCount: badComponentIds.length,
      removedGroups,
      removedComponents,
      imageCount: imageUrls.length,
      remainingErrorCount: remainingErrors.length,
      remainingErrors: remainingErrors.slice(0, 10),
    }
  }

  function markRowsWithResult(rows, status, result, note) {
    return buildOutputStatusRows(rows, status, note).map(row => ({
      ...row,
      '执行结果': result || row['执行结果'] || '',
    }))
  }

  function markRowsBlockedBeforeUpload(rows, status, result, note) {
    return buildOutputStatusRows(rows, status, note).map(row => ({
      ...row,
      '上传结果': row['上传结果'] || '已阻止',
      '执行结果': result || '预检阻止',
    }))
  }

  function failCurrentJob(note, result = '执行失败') {
    const status = extractPublishStatus(shared.current_job || {})
    const rows = markRowsWithResult(shared.current_result_rows, status, result, note)
    return advanceToNextJob(rows, {
      ...shared,
      current_result_rows: rows,
      tmall_status_after_failure: status,
    })
  }

  function successfulRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter(row => row && row['下载结果'] === '已下载' && row['本地文件'])
  }

  function downloadedPcDetailRowCount(rows) {
    return successfulRows(rows).filter(row => row.__category === 'pc_detail').length
  }

  function blockingUploadFailureRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter(row => {
      if (!row || row['下载结果'] !== '已下载' || !row['本地文件']) return false
      return row['上传结果'] !== '已上传'
    })
  }

  function isProductPackagingPcDetailRow(row) {
    if (!row || row.__category !== 'pc_detail') return false
    const fullpath = String(row['云盘路径'] || row.fullpath || '').replace(/\\/g, '/')
    return isUnderProductPackagingDirectory(fullpath) && /\/(?:images|PC详情|pc_detail|详情|商详)(?:\/|$)/i.test(fullpath)
  }

  function shouldAllowLegacyCountPcDetailReplace(rows, job = {}, rawParams = params) {
    if (parseBoolean(rawParams.allow_legacy_count_pc_detail_replace, false)) return true
    if (parseBoolean(job.allow_legacy_count_pc_detail_replace, false)) return true
    if (!isFullPublishMode(job.execute_mode)) return false
    const pcRows = successfulRows(rows).filter(row => row.__category === 'pc_detail')
    return pcRows.length > 0 && pcRows.every(isProductPackagingPcDetailRow)
  }

  function groupRowsByCategory(rows) {
    const grouped = Object.fromEntries(CATEGORY_ORDER.map(category => [category, []]))
    for (const row of Array.isArray(rows) ? rows : []) {
      const category = row.__category || ''
      if (grouped[category]) grouped[category].push(row)
    }
    return grouped
  }

  function hasDownloadedPcDetailRows(rows) {
    return downloadedPcDetailRowCount(rows) > 0
  }

  function fileListFromInput() {
    const input = document.querySelector(UPLOAD_INPUT_SELECTOR)
    return input?.files ? Array.from(input.files) : []
  }

  function loadImageDimensions(file) {
    return new Promise(resolve => {
      if (!file) return resolve({ width: 0, height: 0 })
      const url = URL.createObjectURL(file)
      const image = new Image()
      image.onload = () => {
        URL.revokeObjectURL(url)
        resolve({ width: image.naturalWidth || image.width || 0, height: image.naturalHeight || image.height || 0 })
      }
      image.onerror = () => {
        URL.revokeObjectURL(url)
        resolve({ width: 0, height: 0 })
      }
      image.src = url
    })
  }

  function validateInjectedAsset(row, dimensions) {
    const category = row.__category || ''
    const ratio = ratioName(dimensions.width, dimensions.height)
    if (category.endsWith('_1x1') && ratio !== '1x1') return `尺寸不是1:1（${dimensions.width}x${dimensions.height}）`
    if (category.endsWith('_3x4') && ratio !== '3x4') return `尺寸不是3:4（${dimensions.width}x${dimensions.height}）`
    if (category === 'vertical' && ratio !== '2x3') return `尺寸不是商品竖图比例2:3（${dimensions.width}x${dimensions.height}）`
    return ''
  }

  function getCookieValue(name) {
    const key = `${String(name || '')}=`
    const cookies = String(document?.cookie || '').split(';')
    for (const item of cookies) {
      const trimmed = item.trim()
      if (trimmed.startsWith(key)) return decodeURIComponent(trimmed.slice(key.length))
    }
    return ''
  }

  function truncateUploadFileName(fileName, maxLength = 100) {
    const raw = compact(fileName || 'image.jpg')
    const index = raw.lastIndexOf('.')
    const ext = index > -1 ? raw.slice(index) : ''
    const base = index > -1 ? raw.slice(0, index) : raw
    const limit = Math.max(1, Number(maxLength || 100) - ext.length)
    return `${base.length > limit ? base.slice(0, limit) : base}${ext}`
  }

  function normalizeRemoteUrl(url) {
    const raw = compact(url)
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    return raw
  }

  function findFirstRemoteUrl(value, seen = new Set()) {
    if (!value) return ''
    if (typeof value === 'string') {
      const direct = normalizeRemoteUrl(value)
      return /^https?:\/\//i.test(direct) || /^\/\//.test(value) ? direct : ''
    }
    if (typeof value !== 'object' || seen.has(value)) return ''
    seen.add(value)
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findFirstRemoteUrl(item, seen)
        if (found) return found
      }
      return ''
    }
    for (const key of ['url', 'picUrl', 'imageUrl', 'materialUrl', 'downloadUrl', 'fileUrl', 'src']) {
      const found = findFirstRemoteUrl(value[key], seen)
      if (found) return found
    }
    for (const item of Object.values(value)) {
      const found = findFirstRemoteUrl(item, seen)
      if (found) return found
    }
    return ''
  }

  function uploadErrorMessage(error) {
    return compact(error?.message || error)
  }

  function isRetryableTmallImageUploadError(message) {
    return /(图片存在安全问题|安全问题|图片格式|格式不支持|文件格式|图片损坏|解码失败|image\s+(format|decode)|invalid\s+image)/i.test(String(message || ''))
  }

  function uploadRetryFileName(fileName) {
    const raw = truncateUploadFileName(fileName || 'image.jpg', 92)
    const index = raw.lastIndexOf('.')
    const base = index > -1 ? raw.slice(0, index) : raw
    return `${base}_reencoded.jpg`
  }

  function imageElementFromFile(file) {
    return new Promise((resolve, reject) => {
      if (typeof Image !== 'function' || !URL?.createObjectURL) {
        reject(new Error('当前页面不支持图片重编码'))
        return
      }
      const url = URL.createObjectURL(file)
      const image = new Image()
      image.onload = () => {
        URL.revokeObjectURL(url)
        resolve(image)
      }
      image.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('图片重编码前读取失败'))
      }
      image.src = url
    })
  }

  async function reencodeImageFileForUpload(file, fileName) {
    if (!file || !document?.createElement || typeof File !== 'function') return null
    const image = await imageElementFromFile(file)
    const width = image.naturalWidth || image.width || 0
    const height = image.naturalHeight || image.height || 0
    if (!width || !height) return null
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext?.('2d')
    if (!ctx || typeof canvas.toBlob !== 'function') return null
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0, width, height)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (!blob || !blob.size) return null
    return new File([blob], uploadRetryFileName(fileName || file?.name || 'image.jpg'), { type: 'image/jpeg' })
  }

  async function uploadFileToTmallOnce(file, fileName) {
    if (typeof FormData !== 'function') throw new Error('当前页面不支持 FormData 上传')
    const uploadName = truncateUploadFileName(fileName || file?.name || 'image.jpg')
    const query = new URLSearchParams({
      appkey: 'tu',
      folderId: '0',
      watermark: 'false',
      picCompress: 'true',
      _input_charset: 'utf-8',
    })
    const form = new FormData()
    form.append('water', 'false')
    form.append('name', uploadName)
    form.append('_tb_token_', getCookieValue('_tb_token_'))
    form.append('file', file, uploadName)
    const response = await fetch(`${PICTURE_CENTER_UPLOAD_ENDPOINT}?${query.toString()}`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    })
    const text = await response.text()
    let payload = null
    try {
      payload = text ? JSON.parse(text) : {}
    } catch (error) {
      payload = null
    }
    if (!response.ok) throw new Error(`图片上传 HTTP ${response.status}: ${text.slice(0, 240)}`)
    if (!payload || payload.success === false) throw new Error(payload?.message || payload?.msg || `图片上传失败：${uploadName}`)
    const url = normalizeRemoteUrl(payload?.object?.url || findFirstRemoteUrl(payload))
    if (!url) throw new Error(`图片上传未返回 URL：${uploadName}`)
    return url
  }

  async function uploadFileToTmall(file, category) {
    const fileName = truncateUploadFileName(file?.name || 'image.jpg')
    try {
      return await uploadFileToTmallOnce(file, fileName)
    } catch (error) {
      const firstMessage = uploadErrorMessage(error)
      if (!isRetryableTmallImageUploadError(firstMessage)) throw error
      let retryFile = null
      try {
        retryFile = await reencodeImageFileForUpload(file, fileName)
      } catch (retryPrepareError) {
        throw new Error(`${firstMessage}；重编码重试准备失败：${uploadErrorMessage(retryPrepareError) || '未知原因'}`)
      }
      if (!retryFile) throw error
      try {
        return await uploadFileToTmallOnce(retryFile, retryFile.name)
      } catch (retryError) {
        throw new Error(`${firstMessage}；重编码重试失败：${uploadErrorMessage(retryError) || '未知原因'}`)
      }
    }
  }

  function buildPcDetailHtml(urls) {
    const imgs = (Array.isArray(urls) ? urls : [])
      .map(url => compact(url))
      .filter(Boolean)
      .map(url => `<img src="${url}" align="absmiddle"/>`)
      .join('')
    return imgs ? `<p style="text-align:center;">${imgs}</p>` : ''
  }

  const SIZE_ANCHOR_RE = /(尺码表|尺码测量|尺码推荐|尺码推荐表|宝贝尺寸|宝贝尺码|商品尺码表|尺码信息|测量图)/i
  const WANTED_INFO_ANCHOR_RE = /(想要的信息看这里|想看的信息在这里|想要的信息|信息看这里)/i
  const WASH_FALLBACK_ANCHOR_RE = /(不同材质这样洗|不同材质|衣物洗涤|洗涤|水洗|洗唛)/i
  const LOWER_PRESERVE_ANCHOR_RE = /(模特信息|模特展示|宝贝模特|吊牌|吊牌展示|洗涤|水洗|洗唛|不同材质这样洗|不同材质|衣物洗涤|品牌介绍|品牌故事|宝贝故事|品牌说明|底部固定|宝贝底部|售后)/i
  const INFO_ANCHOR_RE = /(商品信息|宝贝信息|产品信息|基础信息|基本信息|商品参数|宝贝参数)/i
  const FIXED_TOP_ANCHOR_RE = /(童装销售额|全亚洲|亚洲第一|全球大奖|国际大奖|专业国际奖项|国际奖项|国际设计奖项|红点设计奖|IDA设计金奖|MUSE设计金奖|Titan创新奖|纽约产品设计奖|香港设计奖|IDPA设计奖|沸腾质量奖)/i
  const FIXED_TOP_IMAGE_SIGNATURE_RE = /(O1CN01UAicBE1IH8XX4tcs7)/i
  const MARKETING_TOP_ANCHOR_RE = /(会员专属礼赠|淘金币补贴|下单链路|送IP周边|IP周边礼盒|周边礼盒|送T恤水杯|送T恤|加购商品|加购过tab|加购过|千款满\s*\d+\s*减\s*\d+|满\s*\d+\s*减\s*\d+)/i

  function decodeHtmlText(value) {
    return String(value || '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  }

  function htmlAnchorText(value) {
    return decodeHtmlText(String(value || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '))
  }

  function isSizeAnchorText(value) {
    return SIZE_ANCHOR_RE.test(String(value || ''))
  }

  function isLowerPreserveAnchorText(value) {
    return LOWER_PRESERVE_ANCHOR_RE.test(String(value || ''))
  }

  function isWantedInfoAnchorText(value) {
    return WANTED_INFO_ANCHOR_RE.test(String(value || ''))
  }

  function isWashFallbackAnchorText(value) {
    return WASH_FALLBACK_ANCHOR_RE.test(String(value || ''))
  }

  function isStopAnchorText(value) {
    return isWantedInfoAnchorText(value) || isWashFallbackAnchorText(value) || isSizeAnchorText(value) || isLowerPreserveAnchorText(value)
  }

  function isInfoAnchorText(value) {
    return INFO_ANCHOR_RE.test(String(value || ''))
  }

  function isFixedTopAnchorText(value) {
    return FIXED_TOP_ANCHOR_RE.test(String(value || ''))
  }

  function isFixedTopAnchorImage(value) {
    return FIXED_TOP_IMAGE_SIGNATURE_RE.test(String(value || ''))
  }

  function isMarketingTopAnchorText(value) {
    return MARKETING_TOP_ANCHOR_RE.test(String(value || ''))
  }

  function hasTrustedFixedTopAnchorEvidence(value = {}) {
    const source = value && typeof value === 'object' ? value : {}
    const kind = compact(source.fixedTopAnchorKind || source.topAnchorKind || source.anchorKind)
    if (kind === 'fixed_top' || kind === 'marketing_top') return true
    if (isFixedTopAnchorText(source.fixedTopText || source.text || source.matchedText || '')) return true
    if (isMarketingTopAnchorText(source.fixedTopText || source.text || source.matchedText || '')) return true
    if (isFixedTopAnchorImage(source.fixedTopImageUrl || source.imageUrl || source.src || source.url || '')) return true
    return false
  }

  function ocrAnchorText(value) {
    const raw = compact(value)
    const joined = raw.replace(/[\s:：,，.。;；|｜_\\/\-—~～]+/g, '')
    return `${raw} ${joined}`
  }

  function classifyOcrAnchorText(value) {
    const text = ocrAnchorText(value)
    if (isFixedTopAnchorText(text)) return 'fixed_top'
    if (isWantedInfoAnchorText(text)) return 'wanted_info'
    if (isWashFallbackAnchorText(text)) return 'wash_fallback'
    if (isSizeAnchorText(text)) return 'size'
    if (isLowerPreserveAnchorText(text)) return 'lower_preserve'
    if (isMarketingTopAnchorText(text)) return 'marketing_top'
    return ''
  }

  function ocrResultIndex(result, fallbackIndex = 0) {
    const candidates = [result?.globalIndex, result?.imageIndex, result?.index, fallbackIndex]
    for (const value of candidates) {
      const number = Number(value)
      if (Number.isFinite(number) && number >= 0) return number
    }
    return fallbackIndex
  }

  function buildPcDetailVisualAnchorsFromOcrResults(images = [], ocrResults = [], options = {}) {
    const imageList = Array.isArray(images) ? images : []
    const resultList = (Array.isArray(ocrResults) ? ocrResults : [])
      .map((result, index) => ({
        ...result,
        globalIndex: ocrResultIndex(result, index),
        text: compact(result?.text || result?.data?.text || ''),
        confidence: Number(result?.confidence ?? result?.data?.confidence ?? 0) || 0,
      }))
      .map(result => ({ ...result, anchorKind: classifyOcrAnchorText(result.text) }))
      .filter(result => result.text && !result.error)
      .sort((a, b) => a.globalIndex - b.globalIndex)

    const imageByIndex = new Map(imageList.map((image, index) => [Number(image?.globalIndex ?? index), image]))
    const imageFixedTopResults = imageList
      .map((image, index) => ({
        globalIndex: Number(image?.globalIndex ?? index),
        text: compact(image?.src || image?.tag || image?.context || ''),
        confidence: 100,
        anchorKind: 'fixed_top',
        fromImageSignature: true,
      }))
      .filter(result => Number.isFinite(result.globalIndex) && isFixedTopAnchorImage(result.text))
    const fixedTopResults = [
      ...resultList.filter(result => {
        if (!imageByIndex.has(result.globalIndex) && imageList.length) return false
        return result.anchorKind === 'fixed_top'
      }),
      ...imageFixedTopResults,
    ].sort((a, b) => a.globalIndex - b.globalIndex)
    const marketingTopResults = resultList.filter(result => {
      if (!imageByIndex.has(result.globalIndex) && imageList.length) return false
      return result.anchorKind === 'marketing_top'
    })
    const trustedTopResults = [
      ...fixedTopResults,
      ...marketingTopResults,
    ].sort((a, b) => a.globalIndex - b.globalIndex)
    let fixedTopResult = null
    let fixedTopAnchorKind = ''
    const priorities = [
      ['wanted_info', 'wanted_info'],
      ['wash_fallback', 'wash_fallback'],
      ['size', 'size'],
      ['lower_preserve', 'lower_preserve'],
    ]

    function findStopAfter(minStopIndex) {
      for (const [kind, anchorKind] of priorities) {
        const found = resultList.find(result => {
          if (result.globalIndex < minStopIndex) return false
          if (!imageByIndex.has(result.globalIndex) && imageList.length) return false
          return result.anchorKind === kind
        })
        if (found) return { stop: found, stopAnchorKind: anchorKind }
      }
      return { stop: null, stopAnchorKind: '' }
    }

    let minStopIndex = 0
    let { stop, stopAnchorKind } = findStopAfter(minStopIndex)
    const topResultsBeforeStop = trustedTopResults.filter(result => !stop || result.globalIndex < stop.globalIndex)
    if (topResultsBeforeStop.length) {
      fixedTopResult = topResultsBeforeStop[topResultsBeforeStop.length - 1]
      fixedTopAnchorKind = fixedTopResult.anchorKind
      minStopIndex = fixedTopResult.globalIndex + 1
      if (stop && stop.globalIndex < minStopIndex) {
        ;({ stop, stopAnchorKind } = findStopAfter(minStopIndex))
      }
    }
    const fixedTopImageIndex = fixedTopResult ? fixedTopResult.globalIndex : null

    const anchors = {
      ocrStatus: stop ? 'recognized' : (resultList.length ? 'no_anchor' : 'no_text'),
      preserveFirstImage: !!fixedTopResult,
      source: compact(options.source || 'tesseract_ocr'),
      confidence: stop ? stop.confidence : (fixedTopResult?.confidence || 0),
      fixedTopImageIndex,
      fixedTopAnchorKind,
      stopImageIndex: stop ? stop.globalIndex : null,
      stopAnchorKind,
      matchedText: stop ? stop.text.slice(0, 120) : '',
      fixedTopText: fixedTopResult ? fixedTopResult.text.slice(0, 120) : '',
    }
    if (!stop) {
      delete anchors.stopImageIndex
      delete anchors.stopAnchorKind
    }
    if (!fixedTopResult) {
      delete anchors.fixedTopImageIndex
      delete anchors.fixedTopAnchorKind
    }
    return anchors
  }

  function pcDetailAnchorPriority(kind) {
    const normalized = compact(kind)
    if (normalized === 'wanted_info') return 50
    if (normalized === 'wash_fallback') return 40
    if (normalized === 'white_black_fallback') return 30
    if (normalized === 'size' || normalized === 'visual_size') return 20
    if (normalized === 'lower_preserve' || normalized === 'visual_lower_preserve') return 10
    return 0
  }

  function mergePcDetailVisualFallbackAnchors(ocrAnchors = {}, visualFallback = {}) {
    const fallbackKind = compact(visualFallback.stopAnchorKind || visualFallback.anchorKind)
    if (!fallbackKind) return ocrAnchors
    if (pcDetailAnchorPriority(fallbackKind) <= pcDetailAnchorPriority(ocrAnchors.stopAnchorKind)) return ocrAnchors
    const fixedTopImageIndex = Number.isFinite(Number(ocrAnchors.fixedTopImageIndex))
      ? Number(ocrAnchors.fixedTopImageIndex)
      : (Number.isFinite(Number(visualFallback.fixedTopImageIndex)) ? Number(visualFallback.fixedTopImageIndex) : null)
    return {
      ...ocrAnchors,
      ocrStatus: 'recognized',
      preserveFirstImage: !!ocrAnchors.preserveFirstImage || fixedTopImageIndex !== null || !!visualFallback.preserveFirstImage,
      source: compact(visualFallback.source || 'visual_canvas_white_black'),
      confidence: Number(visualFallback.confidence || ocrAnchors.confidence || 0),
      fixedTopImageIndex,
      fixedTopAnchorKind: compact(ocrAnchors.fixedTopAnchorKind || visualFallback.fixedTopAnchorKind),
      stopImageIndex: Number(visualFallback.stopImageIndex),
      stopAnchorKind: fallbackKind,
      matchedText: compact(ocrAnchors.matchedText),
      fixedTopText: compact(ocrAnchors.fixedTopText),
    }
  }

  function extractImgSrc(imgTag) {
    const match = String(imgTag || '').match(/\s(?:src|data-src|data-ks-lazyload|data-lazy-src)=["']([^"']+)["']/i)
    return match ? decodeHtmlText(match[1]).trim() : ''
  }

  function nearestAnchorContext(content, imgStart, previousImageEnd = 0) {
    const raw = String(content || '')
    const windowStart = Math.max(0, Math.min(previousImageEnd || 0, imgStart - 1800))
    const before = raw.slice(windowStart, imgStart)
    const text = htmlAnchorText(before)
    return `${before} ${text}`
  }

  function nearestFixedTopContext(content, imgStart, previousImageEnd = 0) {
    const raw = String(content || '')
    const priorImageEnd = Number(previousImageEnd || 0)
    const windowStart = priorImageEnd > 0 ? Math.min(priorImageEnd, imgStart) : Math.max(0, imgStart - 600)
    const before = raw.slice(windowStart, imgStart)
    const text = htmlAnchorText(before)
    return `${before} ${text}`
  }

  function flattenModularDescImages(modules) {
    const images = []
    const sourceModules = Array.isArray(modules) ? modules : []
    sourceModules.forEach((module, moduleIndex) => {
      const content = String(module?.content || module?.html || '')
      const moduleName = compact(module?.name)
      const imageMatches = [...content.matchAll(/<img\b[^>]*>/gi)]
      let previousImageEnd = 0
      imageMatches.forEach((match, imageIndex) => {
        const start = Number(match.index || 0)
        const tag = String(match[0] || '')
        const end = start + tag.length
        const context = `${moduleName} ${nearestAnchorContext(content, start, previousImageEnd)} ${tag}`
        const fixedTopContext = `${moduleName} ${nearestFixedTopContext(content, start, previousImageEnd)} ${tag}`
        images.push({
          module,
          moduleIndex,
          moduleName,
          imageIndex,
          globalIndex: images.length,
          start,
          end,
          tag,
          src: extractImgSrc(tag),
          context,
          isSizeAnchor: isSizeAnchorText(context),
          isWantedInfoAnchor: isWantedInfoAnchorText(context),
          isWashFallbackAnchor: isWashFallbackAnchorText(context),
          isStopAnchor: isStopAnchorText(context),
          isInfoAnchor: isInfoAnchorText(context),
          isFixedTop: isFixedTopAnchorText(fixedTopContext) || isFixedTopAnchorImage(tag),
        })
        previousImageEnd = end
      })
    })
    return images
  }

  function closingBlockEndAfterImage(content, imageEnd) {
    const html = String(content || '')
    const tail = html.slice(imageEnd, imageEnd + 500)
    const match = tail.match(/^\s*(?:<\/(?:p|div|section|li|td|tr|table)>)+/i)
    return imageEnd + (match ? match[0].length : 0)
  }

  function nearestTagStartBefore(content, index, tagNames = ['p', 'div', 'section', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    const html = String(content || '')
    const limit = Math.max(0, index - 1800)
    let best = -1
    for (const tagName of tagNames) {
      const re = new RegExp(`<${tagName}\\b`, 'gi')
      let match
      while ((match = re.exec(html)) && match.index < index) {
        if (match.index >= limit && match.index > best) best = match.index
      }
    }
    return best
  }

  function anchorBlockStartBeforeImage(content, imageStart, moduleName = '') {
    const html = String(content || '')
    if (isStopAnchorText(moduleName)) return 0
    const limit = Math.max(0, imageStart - 1800)
    const before = html.slice(limit, imageStart)
    const stopAnchorRe = new RegExp(`${WANTED_INFO_ANCHOR_RE.source}|${WASH_FALLBACK_ANCHOR_RE.source}|${SIZE_ANCHOR_RE.source}|${LOWER_PRESERVE_ANCHOR_RE.source}`, 'gi')
    const matches = [...before.matchAll(stopAnchorRe)]
    if (!matches.length) return imageStart
    const anchorAbs = limit + Number(matches[matches.length - 1].index || 0)
    const tagStart = nearestTagStartBefore(html, anchorAbs)
    if (tagStart >= limit) return tagStart
    const rawTagStart = html.lastIndexOf('<', anchorAbs)
    return rawTagStart >= limit ? rawTagStart : anchorAbs
  }

  function isLegacySingleDescription(modules, images) {
    const list = Array.isArray(modules) ? modules : []
    if (list.length !== 1) return false
    const module = list[0] || {}
    if (!/(旧描述|文本PC详情)/.test(compact(module.name))) return false
    return !images.some(image => image.isSizeAnchor || image.isInfoAnchor || image.isVisualStopAnchor)
  }

  function normalizeVisualAnchors(value) {
    const source = value && typeof value === 'object' ? value : {}
    const hasFixedTopImageIndex = Number.isFinite(Number(source.fixedTopImageIndex)) && hasTrustedFixedTopAnchorEvidence(source)
    const fixedTopImageIndex = hasFixedTopImageIndex ? Number(source.fixedTopImageIndex) : null
    const stopImageIndex = Number.isFinite(Number(source.stopImageIndex)) ? Number(source.stopImageIndex) : null
    const rawKind = compact(source.stopAnchorKind || source.anchorKind || 'lower_preserve')
    const stopAnchorKind = /wanted|想要/.test(rawKind)
      ? 'wanted_info'
      : /wash|洗|材质/.test(rawKind)
        ? 'wash_fallback'
        : /white|black|白底|黑字/.test(rawKind)
          ? 'white_black_fallback'
          : rawKind === 'size' ? 'visual_size' : 'visual_lower_preserve'
    return {
      preserveFirstImage: fixedTopImageIndex !== null,
      fixedTopImageIndex,
      stopImageIndex,
      stopAnchorKind,
      source: compact(source.source || 'visual_anchor'),
    }
  }

  function applyVisualAnchorsToImages(images, visualAnchors) {
    const list = Array.isArray(images) ? images : []
    const anchors = normalizeVisualAnchors(visualAnchors)
    const fixedTopIndex = anchors.fixedTopImageIndex !== null ? anchors.fixedTopImageIndex : null
    if (fixedTopIndex !== null && list[fixedTopIndex]) {
      list[fixedTopIndex].isFixedTop = true
      list[fixedTopIndex].isVisualFixedTop = true
      list[fixedTopIndex].context = `${list[fixedTopIndex].context || ''} 视觉固定头图`
    }
    if (anchors.stopImageIndex !== null && list[anchors.stopImageIndex]) {
      const image = list[anchors.stopImageIndex]
      image.isStopAnchor = true
      image.isVisualStopAnchor = true
      image.visualStopAnchorKind = anchors.stopAnchorKind
      image.context = `${image.context || ''} ${anchors.source} 视觉保留下半区锚点`
      if (anchors.stopAnchorKind === 'visual_size') image.isSizeAnchor = true
      if (anchors.stopAnchorKind === 'wanted_info') image.isWantedInfoAnchor = true
      if (anchors.stopAnchorKind === 'wash_fallback') image.isWashFallbackAnchor = true
      if (anchors.stopAnchorKind === 'white_black_fallback') image.isWhiteBlackFallbackAnchor = true
    }
    return anchors
  }

  function shouldPreserveFirstDetailImage(firstImage, options = {}) {
    return !!firstImage && (
      firstImage.isFixedTop ||
      options.preserveFirstImage ||
      isFixedTopAnchorImage(firstImage.src) ||
      isFixedTopAnchorImage(firstImage.tag) ||
      isFixedTopAnchorText(firstImage.moduleName) ||
      isFixedTopAnchorText(firstImage.context)
    )
  }

  function fixedTopDetailImage(images, fallbackImage) {
    const list = Array.isArray(images) ? images : []
    const fixed = list.filter(image => image.isFixedTop)
    return fixed.length ? fixed[fixed.length - 1] : (fallbackImage || null)
  }

  function canUseLegacyImageCountFallback(images, detailUrls, preserveFirstImage, startImage) {
    const detailCount = (Array.isArray(detailUrls) ? detailUrls : []).filter(Boolean).length
    if (!preserveFirstImage) return false
    if (detailCount < 3) return false
    if (!Array.isArray(images) || images.length <= detailCount + 2) return false
    const startIndex = Number(startImage?.globalIndex ?? 0)
    const stopIndex = startIndex + 1 + detailCount
    if (stopIndex <= startIndex + 1 || stopIndex >= images.length) return false
    return images.length - stopIndex >= 2
  }

  function legacyImageCountStopBoundary(images, firstImage, detailUrls, preserveFirstImage, options = {}) {
    if (!options.allowLegacyImageCountFallback) return null
    if (!canUseLegacyImageCountFallback(images, detailUrls, preserveFirstImage, firstImage)) return null
    const detailCount = (Array.isArray(detailUrls) ? detailUrls : []).filter(Boolean).length
    const stopImage = images[firstImage.globalIndex + 1 + detailCount]
    if (!stopImage) return null
    stopImage.isStopAnchor = true
    stopImage.isVisualStopAnchor = true
    stopImage.visualStopAnchorKind = 'legacy_image_count'
    stopImage.context = `${stopImage.context || ''} 旧版纯图片详情按PC详情图数量兜底锚点`
    return {
      type: 'image',
      image: stopImage,
      moduleIndex: stopImage.moduleIndex,
      globalIndex: stopImage.globalIndex,
      moduleName: stopImage.moduleName,
      anchorKind: 'legacy_image_count',
    }
  }

  function replacementStartBoundary(content, firstImage, preserveFirstImage) {
    if (preserveFirstImage) return closingBlockEndAfterImage(content, firstImage.end)
    const tagStart = nearestTagStartBefore(content, firstImage.start)
    return tagStart >= 0 ? tagStart : firstImage.start
  }

  function imageCountBeforeBoundary(images, firstImage, boundary, preserveFirstImage) {
    const list = Array.isArray(images) ? images : []
    return list.filter(image => {
      if (preserveFirstImage && image.globalIndex <= firstImage.globalIndex) return false
      if (!preserveFirstImage && image.globalIndex < firstImage.globalIndex) return false
      if (boundary.type === 'image') return image.globalIndex < boundary.image.globalIndex
      if (boundary.type === 'module') return image.moduleIndex < boundary.moduleIndex
      if (boundary.type === 'end') return image.globalIndex < boundary.globalIndex
      return false
    }).length
  }

  function visualFixedTopImage(images, visualAnchors = {}) {
    const rawIndex = visualAnchors?.fixedTopImageIndex
    if (rawIndex === null || rawIndex === undefined || rawIndex === '') return null
    const index = Number(rawIndex)
    if (!Number.isFinite(index) || index < 0) return null
    return (Array.isArray(images) ? images : []).find(image => Number(image.globalIndex) === index) || null
  }

  function findStopBoundary(modules, images, firstImage, preserveFirstImage, options = {}) {
    const minGlobalIndex = firstImage.globalIndex + (preserveFirstImage ? 1 : 0)
    if (options.visualAnchorsOnly) {
      const visualImageBoundary = images.find(image => image.globalIndex >= minGlobalIndex && image.isVisualStopAnchor)
      if (!visualImageBoundary) return null
      return {
        type: 'image',
        image: visualImageBoundary,
        moduleIndex: visualImageBoundary.moduleIndex,
        globalIndex: visualImageBoundary.globalIndex,
        moduleName: visualImageBoundary.moduleName,
        anchorKind: visualImageBoundary.visualStopAnchorKind || 'visual_lower_preserve',
      }
    }
    const imageBoundary = [
      image => image.isWantedInfoAnchor,
      image => image.isWashFallbackAnchor,
      image => image.isWhiteBlackFallbackAnchor,
      image => image.isSizeAnchor,
      image => image.isStopAnchor,
    ].map(predicate => images.find(image => image.globalIndex >= minGlobalIndex && predicate(image))).find(Boolean)
    if (imageBoundary) {
      return {
        type: 'image',
        image: imageBoundary,
        moduleIndex: imageBoundary.moduleIndex,
        globalIndex: imageBoundary.globalIndex,
        moduleName: imageBoundary.moduleName,
        anchorKind: imageBoundary.visualStopAnchorKind || (
          imageBoundary.isWantedInfoAnchor ? 'wanted_info'
            : imageBoundary.isWashFallbackAnchor ? 'wash_fallback'
              : imageBoundary.isWhiteBlackFallbackAnchor ? 'white_black_fallback'
                : imageBoundary.isSizeAnchor ? 'size'
                  : 'lower_preserve'
        ),
      }
    }

    const list = Array.isArray(modules) ? modules : []
    const modulePredicates = [
      { kind: 'wanted_info', test: isWantedInfoAnchorText },
      { kind: 'wash_fallback', test: isWashFallbackAnchorText },
      { kind: 'size', test: isSizeAnchorText },
      { kind: 'lower_preserve', test: isLowerPreserveAnchorText },
    ]
    for (const { kind, test } of modulePredicates) {
      for (let index = firstImage.moduleIndex + (preserveFirstImage ? 1 : 0); index < list.length; index += 1) {
        const module = list[index] || {}
        const name = compact(module.name)
        if (!test(name)) continue
        if (index === firstImage.moduleIndex) continue
        return {
          type: 'module',
          module,
          moduleIndex: index,
          globalIndex: images.find(image => image.moduleIndex >= index)?.globalIndex,
          moduleName: name,
          anchorKind: kind,
        }
      }
    }

    return null
  }

  function pcDetailStopAnchorLabel(kind) {
    if (kind === 'wanted_info') return '想要的信息看这里锚点'
    if (kind === 'wash_fallback') return '不同材质/洗涤兜底锚点'
    if (kind === 'white_black_fallback') return '白底黑字兜底图锚点'
    if (kind === 'size' || kind === 'visual_size') return '尺码锚点'
    if (kind === 'legacy_image_count') return '旧版纯图片数量兜底锚点'
    if (kind === 'visual_lower_preserve') return '视觉下半区锚点'
    return '下半区锚点'
  }

  function pcDetailTopPreserveLabel(preserveFirstImage, fixedTopImageIndex) {
    if (!preserveFirstImage) return ''
    const index = Number(fixedTopImageIndex)
    if (Number.isFinite(index) && index > 0) return `保留第1到第${index + 1}张固定头图区，`
    return '保留首图，'
  }

  function replaceAnchoredDetailContent(modules, firstImage, stopBoundary, detailHtml, options = {}) {
    const sourceModules = (Array.isArray(modules) ? modules : []).map(module => ({ ...module }))
    const startModuleIndex = firstImage.moduleIndex
    const endModuleIndex = stopBoundary.type === 'end'
      ? Math.max(startModuleIndex, Math.min(sourceModules.length - 1, Number(stopBoundary.moduleIndex)))
      : stopBoundary.moduleIndex
    const preserveFirstImage = !!options.preserveFirstImage
    const startContent = String(sourceModules[startModuleIndex]?.content || '')
    const startBoundary = replacementStartBoundary(startContent, firstImage, preserveFirstImage)
    const endContent = String(sourceModules[endModuleIndex]?.content || '')
    const endBoundary = stopBoundary.type === 'end'
      ? endContent.length
      : (stopBoundary.type === 'module'
          ? 0
          : anchorBlockStartBeforeImage(endContent, stopBoundary.image.start, stopBoundary.image.moduleName))
    const insertHtml = options.probeOnly ? '' : detailHtml

    if (startModuleIndex === endModuleIndex) {
      sourceModules[startModuleIndex] = {
        ...sourceModules[startModuleIndex],
        content: `${startContent.slice(0, startBoundary)}${insertHtml}${startContent.slice(endBoundary)}`,
      }
      return sourceModules
    }

    const result = []
    for (let index = 0; index < sourceModules.length; index += 1) {
      const module = sourceModules[index]
      if (index < startModuleIndex || index > endModuleIndex) {
        result.push(module)
      } else if (index === startModuleIndex) {
        result.push({
          ...module,
          content: `${String(module.content || '').slice(0, startBoundary)}${insertHtml}`,
        })
      } else if (index === endModuleIndex) {
        result.push({
          ...module,
          content: String(module.content || '').slice(endBoundary),
        })
      }
    }
    return result.filter(module => String(module?.content || '').trim() || module.custom || module.id === sourceModules[startModuleIndex]?.id || module.id === sourceModules[endModuleIndex]?.id)
  }

	  function buildAnchoredPcDetailModules(modularDesc, detailUrls = [], options = {}) {
    const currentModules = Array.isArray(modularDesc) ? modularDesc : []
    const normalizedDetailUrls = (Array.isArray(detailUrls) ? detailUrls : []).map(compact).filter(Boolean)
    const probeDetailUrls = normalizedDetailUrls.length
      ? normalizedDetailUrls
      : legacyCountProbeDetailImages(options).map(item => item.url).filter(Boolean)
    const detailHtml = options.probeOnly ? '<!-- crawshrimp pc detail probe -->' : buildPcDetailHtml(normalizedDetailUrls)
    if (!detailHtml && !probeDetailUrls.length) {
      return {
        ok: true,
        modules: currentModules,
        note: '未上传PC详情图，保留原PC详情',
        mode: 'no_detail_images',
      }
    }
    if (!currentModules.length) {
      return {
        ok: false,
        modules: currentModules,
        note: '未读到旧版PC详情模块，已阻止自动替换',
        mode: 'blocked_empty_modular_desc',
      }
    }

    const images = flattenModularDescImages(currentModules)
    const isNewDescModuleSource = currentModules.some(module => module && module.__newDescPic)
    const visualAnchors = applyVisualAnchorsToImages(images, options.visualAnchors)
    const requireVisualAnchors = !!options.requireVisualAnchors
    if (!images.length) {
      return {
        ok: false,
        modules: currentModules,
        note: 'PC详情中未识别到图片，已阻止自动替换',
        mode: 'blocked_no_images',
      }
    }
    const firstImage = images[0]
    const legacySingleDescription = isLegacySingleDescription(currentModules, images)
    const detectedFixedTopImage = requireVisualAnchors
      ? visualFixedTopImage(images, visualAnchors)
      : fixedTopDetailImage(images, null)
    let preserveFirstImage = !!detectedFixedTopImage || (!requireVisualAnchors && shouldPreserveFirstDetailImage(firstImage, {
      preserveFirstImage: visualAnchors.preserveFirstImage || visualAnchors.fixedTopImageIndex === 0,
    }))
    let startImage = preserveFirstImage ? (detectedFixedTopImage || firstImage) : firstImage
    if (startImage && startImage.globalIndex > firstImage.globalIndex) preserveFirstImage = true
    let stopBoundary = findStopBoundary(currentModules, images, startImage, preserveFirstImage, {
      visualAnchorsOnly: requireVisualAnchors,
    })
    if (!stopBoundary && legacySingleDescription && options.allowLegacyImageCountFallback) {
      if (preserveFirstImage) startImage = fixedTopDetailImage(images, firstImage) || firstImage
      stopBoundary = requireVisualAnchors
        ? null
        : legacyImageCountStopBoundary(images, startImage, detailUrls, preserveFirstImage, options)
    }
    if (legacySingleDescription && !stopBoundary) {
	      const detailUrlCount = probeDetailUrls.length
	      const replacementStartIndex = Number(startImage?.globalIndex ?? firstImage.globalIndex) + (preserveFirstImage ? 1 : 0)
	      if (options.allowLegacyCountImageReplace && detailUrlCount && images.length >= replacementStartIndex + detailUrlCount) {
        const firstSegment = images.slice(replacementStartIndex, replacementStartIndex + detailUrlCount)
        const secondSegment = images.slice(replacementStartIndex + detailUrlCount, replacementStartIndex + detailUrlCount * 2)
        const duplicated = secondSegment.length === detailUrlCount &&
          imageUrlSequenceMatches(
            firstSegment.map(image => image.src),
            secondSegment.map(image => image.src),
          )
        const endIndex = replacementStartIndex + detailUrlCount * (duplicated ? 2 : 1)
        const tailImage = images[endIndex]
        stopBoundary = tailImage
          ? {
              type: 'image',
              image: tailImage,
              moduleIndex: tailImage.moduleIndex,
              globalIndex: tailImage.globalIndex,
              moduleName: tailImage.moduleName,
              anchorKind: duplicated ? 'duplicate_detail_tail' : 'legacy_count_tail',
            }
          : {
              type: 'end',
              moduleIndex: images[images.length - 1]?.moduleIndex ?? currentModules.length - 1,
              globalIndex: images.length,
              moduleName: '详情尾部',
              anchorKind: duplicated ? 'duplicate_detail_tail' : 'legacy_count_tail',
            }
        const modules = options.probeOnly
          ? currentModules
          : replaceAnchoredDetailContent(currentModules, startImage, stopBoundary, detailHtml, { ...options, preserveFirstImage })
        const fixedTopImageIndex = preserveFirstImage ? Number(startImage?.globalIndex ?? firstImage.globalIndex) : null
        const topLabel = pcDetailTopPreserveLabel(preserveFirstImage, fixedTopImageIndex)
        const replaceRangeLabel = `${topLabel}替换第${replacementStartIndex + 1}到第${endIndex}张`
        const tailLabel = tailImage ? `，保留第${endIndex + 1}张及以下尾部` : ''
        return {
          ok: true,
          modules,
          detailHtml,
          mode: duplicated
            ? 'legacy_count_duplicate_cleanup'
            : 'legacy_count_replace',
          replaceStartIndex: replacementStartIndex,
          replaceEndIndex: stopBoundary.globalIndex,
          replacedImageCount: duplicated ? detailUrlCount * 2 : detailUrlCount,
          insertedImageCount: detailUrlCount,
          duplicateSequenceCount: duplicated ? 2 : 1,
          requiresAlreadyMatch: duplicated,
          firstImage,
          startImage,
          fixedTopImage: preserveFirstImage ? startImage : null,
          fixedTopImageIndex,
          preserveTopImageCount: preserveFirstImage ? fixedTopImageIndex + 1 : 0,
          sizeImage: tailImage || null,
          stopAnchor: tailImage || {
            moduleIndex: stopBoundary.moduleIndex,
            moduleName: stopBoundary.moduleName,
            imageIndex: -1,
            globalIndex: stopBoundary.globalIndex,
            src: '',
            context: stopBoundary.moduleName,
          },
	          preserveFirstImage,
	          stopBoundaryType: stopBoundary.type,
	          stopAnchorKind: stopBoundary.anchorKind,
	          currentReplacementUrls: images.slice(replacementStartIndex, endIndex).map(image => image.src).filter(Boolean),
	          note: duplicated
	            ? `旧版纯图片PC详情检测到产品包装详情图重复${detailUrlCount}张 x 2，已按本次素材重写为一遍：${replaceRangeLabel}`
	            : `旧版纯图片PC详情未识别到可靠文字锚点，已按产品包装PC详情图数量替换：${replaceRangeLabel}${tailLabel}`,
	        }
	      }
      return {
        ok: false,
        modules: currentModules,
        note: '旧描述单模块未识别到结构化标题或尺码视觉锚点，已按保守模式阻止自动替换',
        mode: 'blocked_legacy_visual_anchor_missing',
      }
    }
    if (!stopBoundary) {
      const detailUrlCount = probeDetailUrls.length
      if (!isNewDescModuleSource && options.allowLegacyCountImageReplace && detailUrlCount) {
        const replaceStartIndexForCount = Number(startImage?.globalIndex ?? firstImage.globalIndex) + (preserveFirstImage ? 1 : 0)
        const firstSegment = images.slice(replaceStartIndexForCount, replaceStartIndexForCount + detailUrlCount)
        if (firstSegment.length === detailUrlCount) {
          const secondSegment = images.slice(replaceStartIndexForCount + detailUrlCount, replaceStartIndexForCount + detailUrlCount * 2)
          const duplicated = secondSegment.length === detailUrlCount &&
            imageUrlSequenceMatches(
              firstSegment.map(image => image.src),
              secondSegment.map(image => image.src),
            )
          const endIndex = replaceStartIndexForCount + detailUrlCount * (duplicated ? 2 : 1)
          const tailImage = images[endIndex]
          const countStopBoundary = tailImage
            ? {
                type: 'image',
                image: tailImage,
                moduleIndex: tailImage.moduleIndex,
                globalIndex: tailImage.globalIndex,
                moduleName: tailImage.moduleName,
                anchorKind: duplicated ? 'duplicate_detail_tail' : 'legacy_count_tail',
              }
            : {
                type: 'end',
                moduleIndex: images[images.length - 1]?.moduleIndex ?? currentModules.length - 1,
                globalIndex: images.length,
                moduleName: '详情尾部',
                anchorKind: duplicated ? 'duplicate_detail_tail' : 'legacy_count_tail',
              }
          const modules = options.probeOnly
            ? currentModules
            : replaceAnchoredDetailContent(currentModules, startImage, countStopBoundary, detailHtml, { ...options, preserveFirstImage })
          const fixedTopImageIndex = preserveFirstImage ? Number(startImage?.globalIndex ?? firstImage.globalIndex) : null
          const topLabel = pcDetailTopPreserveLabel(preserveFirstImage, fixedTopImageIndex)
          const replaceRangeLabel = `${topLabel}替换第${replaceStartIndexForCount + 1}到第${endIndex}张`
          const tailLabel = tailImage ? `，保留第${endIndex + 1}张及以下尾部` : ''
          return {
            ok: true,
            modules,
            detailHtml,
            mode: duplicated
              ? 'legacy_count_duplicate_cleanup'
              : 'legacy_count_replace',
            replaceStartIndex: replaceStartIndexForCount,
            replaceEndIndex: countStopBoundary.globalIndex,
            replacedImageCount: duplicated ? detailUrlCount * 2 : detailUrlCount,
            insertedImageCount: detailUrlCount,
            duplicateSequenceCount: duplicated ? 2 : 1,
            requiresAlreadyMatch: duplicated,
            firstImage,
            startImage,
            fixedTopImage: preserveFirstImage ? startImage : null,
            fixedTopImageIndex,
            preserveTopImageCount: preserveFirstImage ? fixedTopImageIndex + 1 : 0,
            sizeImage: tailImage || null,
            stopAnchor: tailImage || {
              moduleIndex: countStopBoundary.moduleIndex,
              moduleName: countStopBoundary.moduleName,
              imageIndex: -1,
              globalIndex: countStopBoundary.globalIndex,
              src: '',
              context: countStopBoundary.moduleName,
            },
            preserveFirstImage,
            stopBoundaryType: countStopBoundary.type,
            stopAnchorKind: countStopBoundary.anchorKind,
            currentReplacementUrls: images.slice(replaceStartIndexForCount, endIndex).map(image => image.src).filter(Boolean),
            note: duplicated
              ? `旧版纯图片PC详情检测到产品包装详情图重复${detailUrlCount}张 x 2，已按本次素材重写为一遍：${replaceRangeLabel}`
              : `旧版纯图片PC详情未识别到可靠文字锚点，已按产品包装PC详情图数量替换：${replaceRangeLabel}${tailLabel}`,
          }
        }
      }
      return {
        ok: false,
        modules: currentModules,
        note: '未识别到可保留的详情下半区锚点（想要的信息看这里/不同材质这样洗/白底黑字图/尺码表/模特/吊牌/品牌故事等），已阻止自动替换',
        mode: 'blocked_stop_anchor_missing',
      }
    }

    const fixedTopImageIndex = preserveFirstImage ? Number(startImage?.globalIndex ?? firstImage.globalIndex) : null
    const replaceStartIndex = startImage.globalIndex + (preserveFirstImage ? 1 : 0)
    const replacedImageCount = imageCountBeforeBoundary(images, startImage, stopBoundary, preserveFirstImage)
    if (replacedImageCount <= 0 && stopBoundary.type === 'image' && stopBoundary.moduleIndex === startImage.moduleIndex) {
      return {
        ok: false,
        modules: currentModules,
        note: '可替换区与保留锚点在同一图片块内且没有安全插入位置，已阻止自动替换',
        mode: 'blocked_empty_replace_range',
      }
    }

    const modules = options.probeOnly
      ? currentModules
      : replaceAnchoredDetailContent(currentModules, startImage, stopBoundary, detailHtml, { ...options, preserveFirstImage })
	    const stopImage = stopBoundary.type === 'image' ? stopBoundary.image : null
	    const stopAnchor = stopImage || {
      moduleIndex: stopBoundary.moduleIndex,
      moduleName: stopBoundary.moduleName,
      imageIndex: -1,
      globalIndex: stopBoundary.globalIndex,
      src: '',
	      context: stopBoundary.moduleName,
	    }
	    const currentReplacementUrls = images
	      .filter(image => {
	        if (image.globalIndex < replaceStartIndex) return false
	        if (stopBoundary.type === 'image') return image.globalIndex < stopBoundary.image.globalIndex
	        if (stopBoundary.type === 'module') return image.moduleIndex < stopBoundary.moduleIndex
	        if (stopBoundary.type === 'end') return image.globalIndex < stopBoundary.globalIndex
	        return false
	      })
	      .map(image => image.src)
	      .filter(Boolean)
	    return {
	      ok: true,
	      modules,
      detailHtml,
      mode: 'anchored_replace',
      replaceStartIndex,
      replaceEndIndex: stopBoundary.type === 'image' ? stopBoundary.image.globalIndex : stopBoundary.globalIndex,
      replacedImageCount,
      insertedImageCount: (Array.isArray(detailUrls) ? detailUrls : []).filter(Boolean).length,
      firstImage,
      startImage,
      fixedTopImage: preserveFirstImage ? startImage : null,
      fixedTopImageIndex,
      preserveTopImageCount: preserveFirstImage ? fixedTopImageIndex + 1 : 0,
      sizeImage: stopAnchor,
      stopAnchor,
	      preserveFirstImage,
	      stopBoundaryType: stopBoundary.type,
	      stopAnchorKind: stopBoundary.anchorKind,
	      currentReplacementUrls,
	      note: replacedImageCount > 0
	        ? `PC详情锚点区间替换：${pcDetailTopPreserveLabel(preserveFirstImage, fixedTopImageIndex)}替换第${replaceStartIndex + 1}到第${replaceStartIndex + replacedImageCount}张图，${pcDetailStopAnchorLabel(stopBoundary.anchorKind)}及以下保留`
	        : `PC详情锚点区间插入：${pcDetailTopPreserveLabel(preserveFirstImage, fixedTopImageIndex)}在${pcDetailStopAnchorLabel(stopBoundary.anchorKind)}前插入新PC详情图，锚点及以下保留`,
    }
  }

  function buildAnchoredPcDetailHtml(html, detailUrls = [], options = {}) {
    const currentHtml = String(html || '')
    const result = buildAnchoredPcDetailModules([
      {
        id: 'tmDescription',
        name: '文本PC详情',
        content: currentHtml,
        custom: true,
      },
    ], detailUrls, options)
    const nextHtml = result.ok
      ? String(result.modules?.[0]?.content ?? currentHtml)
      : currentHtml
    const note = result.ok
      ? `旧版文本PC详情${result.note ? `：${result.note}` : '已完成锚点区间替换'}`
      : `旧版文本PC详情未识别到可靠锚点（想要的信息看这里/不同材质这样洗/白底黑字图/尺码表/模特/吊牌/品牌故事等），已按保守模式阻止自动替换`
    return {
      ...result,
      target: 'tmDescription',
      html: nextHtml,
      sourceHtml: currentHtml,
      note,
    }
  }

  function mergeReplacementImages(currentImages, replacementImages, maxCount = TMALL_MAIN_IMAGE_MAX_COUNT) {
    const replacements = Array.isArray(replacementImages) ? replacementImages.filter(Boolean) : []
    if (!replacements.length) return undefined
    const limit = Math.max(1, Number(maxCount || replacements.length))
    const merged = Array.isArray(currentImages) ? currentImages.slice(0, limit) : []
    for (let index = 0; index < replacements.length && index < limit; index += 1) {
      merged[index] = replacements[index]
    }
    return merged.slice(0, Math.min(limit, Math.max(merged.length, replacements.length)))
  }

  function buildTmallComponentValues(uploadedByCategory, currentValues = {}) {
    const replacementMain1x1 = [
      ...(uploadedByCategory.main_1x1 || []),
      ...(uploadedByCategory.micro_1x1 || []),
    ].map(item => ({ url: item.url, pix: item.pix, width: item.width ? String(item.width) : undefined, height: item.height ? String(item.height) : undefined }))
    const replacementMain3x4 = [
      ...(uploadedByCategory.main_3x4 || []),
      ...(uploadedByCategory.micro_3x4 || []),
    ].map(item => ({ url: item.url }))
    const vertical = (uploadedByCategory.vertical || []).slice(0, 1).map(item => ({ url: item.url }))
    const currentMainGroup = currentValues.mainImagesGroup && typeof currentValues.mainImagesGroup === 'object' ? currentValues.mainImagesGroup : {}
    const currentMainImages = Array.isArray(currentMainGroup.images) ? currentMainGroup.images : []
    const currentThreeToFourImages = Array.isArray(currentValues.threeToFourImages) ? currentValues.threeToFourImages : []
    const main1x1 = mergeReplacementImages(currentMainImages, replacementMain1x1, TMALL_MAIN_IMAGE_MAX_COUNT)
    const main3x4 = mergeReplacementImages(currentThreeToFourImages, replacementMain3x4, TMALL_MAIN_IMAGE_MAX_COUNT)
    const currentGuide = currentValues.guideImageGroup && typeof currentValues.guideImageGroup === 'object' ? currentValues.guideImageGroup : {}
    const currentNewDesc = getNewDescValue(currentValues)
    const currentModules = Array.isArray(currentValues.modularDesc) ? currentValues.modularDesc : []
    const currentTmDescription = typeof currentValues.tmDescription === 'string' ? currentValues.tmDescription : ''
    const currentDescForShenbiPc = currentValues.descForShenbiPc && typeof currentValues.descForShenbiPc === 'object'
      ? currentValues.descForShenbiPc
      : {}
    const detailUrls = (uploadedByCategory.pc_detail || []).map(item => item.url)
    const legacyPcDetailReplacement = () => currentModules.length
      ? buildAnchoredPcDetailModules(currentModules, detailUrls, {
          visualAnchors: currentValues.pcDetailVisualAnchors,
          requireVisualAnchors: currentValues.requirePcDetailVisualAnchors,
          allowLegacyCountImageReplace: currentValues.allowLegacyCountPcDetailReplace,
        })
      : currentTmDescription
        ? buildAnchoredPcDetailHtml(currentTmDescription, detailUrls, {
          visualAnchors: currentValues.pcDetailVisualAnchors,
          requireVisualAnchors: currentValues.requirePcDetailVisualAnchors,
          allowLegacyCountImageReplace: currentValues.allowLegacyCountPcDetailReplace,
        })
        : null
    const newDescPcDetailReplacement = () => buildAnchoredNewDescTemplateContent(currentNewDesc, uploadedByCategory.pc_detail || [], {
          visualAnchors: currentValues.pcDetailVisualAnchors,
          requireVisualAnchors: currentValues.requirePcDetailVisualAnchors,
          allowLegacyCountImageReplace: currentValues.allowLegacyCountPcDetailReplace,
        })
    const pcDetailReplacement = currentValues.preferLegacyPcDetail
      ? (legacyPcDetailReplacement() || newDescPcDetailReplacement())
      : (hasUsableNewDescTemplate(currentNewDesc)
        ? newDescPcDetailReplacement()
        : (legacyPcDetailReplacement() || newDescPcDetailReplacement()))
    const replacementModules = Array.isArray(pcDetailReplacement?.modules) ? pcDetailReplacement.modules : []
    const useTextPcDetailForShenbi = !!(
      pcDetailReplacement?.ok &&
      currentValues.descForShenbiPcVisible &&
      currentModules.length &&
      replacementModules.length
    )
    const useShenbiPc = false
    const aggregateNewDescValue = !useTextPcDetailForShenbi && !useShenbiPc && pcDetailReplacement?.ok && !currentValues.modularDescVisible && hasAggregateNewDescTemplate(currentNewDesc)
      ? buildAggregateNewDescFromPcModules(currentNewDesc, replacementModules, uploadedByCategory.pc_detail || [])
      : null
    const pcDetailReplacementTarget = pcDetailReplacement?.target ||
      (useTextPcDetailForShenbi ? 'modularDesc' : '') ||
      (useShenbiPc ? 'descForShenbiPc' : '') ||
      (aggregateNewDescValue ? 'descRepublicOfSell' : '') ||
      (pcDetailReplacement?.ok && currentModules.length ? 'modularDesc' : '') ||
      (pcDetailReplacement?.ok && currentTmDescription ? 'tmDescription' : '')
    const useTextPcDetailForLegacyHtml = !!(pcDetailReplacement?.ok && pcDetailReplacementTarget === 'tmDescription')
    const useTextPcDetail = useTextPcDetailForShenbi || useTextPcDetailForLegacyHtml
    const normalizedPcDetailReplacement = pcDetailReplacement
      ? {
          ...pcDetailReplacement,
          target: pcDetailReplacementTarget,
          textPcDetailMode: useTextPcDetail,
          note: useTextPcDetailForShenbi
            ? compact([pcDetailReplacement.note, '旺铺PC详情组件不可直接表单持久化，已自动切换为“使用文本编辑”并回写文本PC详情模块'].filter(Boolean).join('；'))
            : useTextPcDetailForLegacyHtml
              ? compact([pcDetailReplacement.note, '已自动切换为“使用文本编辑”并回写旧版文本PC详情'].filter(Boolean).join('；'))
              : pcDetailReplacement.note,
        }
      : pcDetailReplacement
    const modularDesc = currentModules.length && pcDetailReplacementTarget === 'modularDesc' && pcDetailReplacement.ok ? pcDetailReplacement.modules : undefined
    const tmDescription = pcDetailReplacementTarget === 'tmDescription' && pcDetailReplacement.ok ? pcDetailReplacement.html : undefined
    const descRepublicOfSell = pcDetailReplacementTarget === 'descRepublicOfSell' && pcDetailReplacement.ok
      ? (aggregateNewDescValue || pcDetailReplacement.value)
      : undefined
    const descForShenbiPc = pcDetailReplacementTarget === 'descForShenbiPc' && pcDetailReplacement.ok
      ? buildShenbiPcValueFromPcModules(replacementModules, currentDescForShenbiPc)
      : undefined
    return {
      mainImagesGroup: main1x1?.length ? { ...currentMainGroup, images: main1x1 } : undefined,
      threeToFourImages: main3x4?.length ? main3x4 : undefined,
      guideImageGroup: vertical.length ? { ...currentGuide, verticalImage: vertical } : undefined,
      descRepublicOfSell,
      descForShenbiPc,
      descType: useTextPcDetail ? buildTextPcDescTypeValue(currentValues.descType) : undefined,
      modularDesc,
      tmDescription,
      detailHtml: pcDetailReplacement.detailHtml || '',
      pcDetailReplacement: normalizedPcDetailReplacement,
    }
  }

  function getTmallEngine() {
    const state = getSellState()
    return state?.engine || null
  }

  function getTmallModels() {
    const engine = getTmallEngine()
    try {
      return engine && typeof engine.getModels === 'function' ? engine.getModels() || {} : {}
    } catch (error) {
      return {}
    }
  }

  function getTmallGlobal() {
    const state = getSellState()
    try {
      const globalValue = typeof state?.getGlobal === 'function' ? state.getGlobal() : null
      if (globalValue && typeof globalValue === 'object') return globalValue
    } catch (error) {}
    const models = getTmallModels()
    return models.global && typeof models.global === 'object' ? models.global : {}
  }

  function getTmallFormValues() {
    const models = getTmallModels()
    return models.formValues && typeof models.formValues === 'object' ? models.formValues : {}
  }

  function firstScalarValue(value, seen = new Set()) {
    if (value == null || value === '') return ''
    if (typeof value === 'number' || typeof value === 'bigint') return String(value)
    if (typeof value === 'string') return compact(value)
    if (typeof value !== 'object' || seen.has(value)) return ''
    seen.add(value)
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        const found = firstScalarValue(value[index], seen)
        if (found) return found
      }
      return ''
    }
    for (const key of ['submitId', 'catId', 'categoryId', 'cid', 'id', 'value']) {
      const found = firstScalarValue(value[key], seen)
      if (found) return found
    }
    return ''
  }

  function resolveTmallCatId(globalValue = getTmallGlobal(), formValues = getTmallFormValues()) {
    const global = globalValue && typeof globalValue === 'object' ? globalValue : {}
    const form = formValues && typeof formValues === 'object' ? formValues : {}
    return compact(
      global.catId ||
      global.categoryId ||
      global.cid ||
      firstScalarValue(form.catId) ||
      firstScalarValue(form.categoryId) ||
      firstScalarValue(form.cid) ||
      firstScalarValue(form.category?.categorySelect) ||
      firstScalarValue(form.category)
    )
  }

  function jsonClone(value) {
    if (value == null) return value
    try {
      return JSON.parse(JSON.stringify(value))
    } catch (error) {
      return value
    }
  }

  function stringifyFieldValue(value) {
    if (value == null) return ''
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    try {
      return JSON.stringify(value)
    } catch (error) {
      return String(value)
    }
  }

  function buildTmallSubmitPayload(formValues = getTmallFormValues(), globalValue = getTmallGlobal(), options = {}) {
    const global = globalValue && typeof globalValue === 'object' ? globalValue : {}
    const itemId = normalizeItemId(global.id || global.itemId || global.requestItemId || options.itemId || location.href)
    const catId = resolveTmallCatId(global, formValues)
    const payload = {
      isLightCombine: global.isLightCombine,
      isSetsCombine: global.isSetsCombine,
      combineToNormal: global.combineToNormal,
      tmSpuPublishType: global.tmSpuPublishType,
      isUnBondedGift: global.isUnBondedGift,
      spu_qf_param: global.spu_qf_param,
      catId,
      itemId,
      submitUrlDataKey: global.scUrlDataComp || global.mergePublishUrlKey,
      roleType: global.roleType,
      globalScmExtendInfo: global.scmExtendInfo,
      globalBizExtendInfo: global.bizExtendInfo,
      jsonBody: JSON.stringify(formValues || {}),
    }
    if (global._tb_token_) payload._tb_token_ = global._tb_token_
    return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, stringifyFieldValue(value)]))
  }

  function buildTextPcDescTypeValue(currentValue = {}) {
    const current = currentValue && typeof currentValue === 'object' ? jsonClone(currentValue) : {}
    return {
      ...current,
      text: '使用文本编辑',
      value: 0,
    }
  }

  function newDescCommitEndpoint(value = {}) {
    return compact(value?.descPageRenderModel?.extendConfig?.httpRequestUrlConfig?.url) ||
      'https://xiangqing.wangpu.taobao.com/template/ajax/commit_item_description.do'
  }

  async function commitNewDescByApi(value, timeoutMs = 15000) {
    if (!value) return { ok: true, method: 'skip' }
    const commitParam = value.descPageCommitParam && typeof value.descPageCommitParam === 'object'
      ? value.descPageCommitParam
      : {}
    if (!commitParam.templateContent) {
      return { ok: false, method: 'new_desc_commit', reason: '新版详情模板缺少 templateContent，已阻止提交发布' }
    }
    const endpoint = newDescCommitEndpoint(value)
    const payload = { ...commitParam, changed: true }
    const global = getTmallGlobal()
    const token = getCookieValue('_tb_token_') || compact(global._tb_token_ || global.value?._tb_token_)
    if (token && !payload._tb_token_) payload._tb_token_ = token
    const result = await postTmallForm(endpoint, payload, timeoutMs)
    if (result.ok || result.successful) {
      return {
        ...result,
        ok: true,
        method: 'new_desc_commit',
        endpoint,
        note: '已通过新版详情接口保存 descRepublicOfSell',
      }
    }
    return {
      ...result,
      ok: false,
      method: 'new_desc_commit',
      endpoint,
      reason: result.reason || `新版详情接口保存失败${result.status ? ` HTTP ${result.status}` : ''}`,
    }
  }

  function parseTmallApiPayload(text) {
    const raw = String(text || '')
    if (!raw) return {}
    try {
      return JSON.parse(raw)
    } catch (error) {}
    const match = raw.match(/^[^(]*\(([\s\S]*)\)\s*;?$/)
    if (match) {
      try {
        return JSON.parse(match[1])
      } catch (error) {}
    }
    return { raw }
  }

  function apiResponseHasErrors(payload) {
    const messages = []
    const visit = (value, depth = 0) => {
      if (depth > 5 || value == null) return
      if (typeof value === 'string') {
        if (/失败|错误|不能为空|请填写|必填项|error/i.test(value)) messages.push(value)
        return
      }
      if (Array.isArray(value)) {
        value.slice(0, 20).forEach(item => visit(item, depth + 1))
        return
      }
      if (typeof value === 'object') {
        if (value.error === true) messages.push(compact(value.msg || value.message || value.errorMsg || '接口返回 error=true'))
        if (value.success === false) messages.push(compact(value.msg || value.message || value.errorMsg || '接口返回 success=false'))
        if (value.ok === false) messages.push(compact(value.msg || value.message || value.errorMsg || '接口返回 ok=false'))
        if (value.code != null && value.code !== 0 && value.code !== '0' && value.error === true) {
          messages.push(compact(value.msg || value.message || value.errorMsg || `接口返回 code=${value.code}`))
        }
        ;['msg', 'message', 'error', 'errorInfo', 'errorMsg', 'content'].forEach(key => {
          if (typeof value[key] === 'string') visit(value[key], depth + 1)
        })
        if (value.message && Array.isArray(value.message)) visit(value.message, depth + 1)
      }
    }
    visit(payload)
    const seen = new Set()
    return messages
      .filter(Boolean)
      .filter(message => !seen.has(message) && seen.add(message))
  }

  function apiResponseLooksSuccessful(payload) {
    if (!payload || typeof payload !== 'object') return false
    if (apiResponseHasErrors(payload).length) return false
    if (payload.success === true || payload.ok === true) return true
    if (payload.code === 0 || payload.code === '0') return true
    if (payload.ret && Array.isArray(payload.ret) && payload.ret.some(item => /SUCCESS/i.test(String(item)))) return true
    if (payload.models || payload.components || payload.globalMessage) return !apiResponseHasErrors(payload).length
    return false
  }

  async function postTmallForm(action, payload, timeoutMs = 15000) {
    if (typeof fetch !== 'function') return { ok: false, method: 'http_post', reason: '当前环境不支持 fetch' }
    const body = new URLSearchParams()
    Object.entries(payload || {}).forEach(([key, value]) => body.set(key, stringifyFieldValue(value)))
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
    const originFromUrl = (value, base = '') => {
      const text = String(value || '')
      const baseText = String(base || '')
      if (typeof URL === 'function') {
        try { return new URL(text, baseText || undefined).origin } catch (error) {}
      }
      const absolute = /^https?:\/\//i.test(text)
        ? text
        : (/^\/\//.test(text) ? `https:${text}` : baseText)
      const match = absolute.match(/^(https?:)\/\/([^/?#]+)/i)
      return match ? `${match[1]}//${match[2]}`.toLowerCase() : ''
    }
    let sameOrigin = true
    try {
      const currentHref = typeof location !== 'undefined' && location.href ? location.href : 'https://sell.publish.tmall.com/'
      sameOrigin = originFromUrl(action, currentHref) === originFromUrl(currentHref)
    } catch (error) {}
    const headers = {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    }
    if (sameOrigin) headers['x-requested-with'] = 'XMLHttpRequest'
    try {
      const response = await Promise.race([
        fetch(action, {
          method: 'POST',
          credentials: 'include',
          headers,
          body,
          signal: controller?.signal,
        }),
        new Promise(resolve => setTimeout(() => resolve({ __timeout: true }), timeoutMs + 500)),
      ])
      if (response?.__timeout) return { ok: false, method: 'http_post', reason: `API 请求超时 ${timeoutMs}ms` }
      const text = await response.text()
      const payloadJson = parseTmallApiPayload(text)
      const errors = apiResponseHasErrors(payloadJson)
      return {
        ok: response.ok && !errors.length,
        method: 'http_post',
        status: response.status,
        payload: payloadJson,
        reason: errors.join('；') || (!response.ok ? `HTTP ${response.status}` : ''),
        successful: apiResponseLooksSuccessful(payloadJson),
      }
    } catch (error) {
      return { ok: false, method: 'http_post', reason: String(error?.message || error) }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  function emitComponentEvent(name, eventName) {
    const engine = getTmallEngine()
    if (!engine || typeof engine.getComponent !== 'function') return { ok: false, reason: '发布页引擎未就绪' }
    try {
      const component = engine.getComponent(name)
      if (!component || typeof component.emit !== 'function') return { ok: false, reason: `未找到组件事件：${name}` }
      component.emit(eventName)
      return { ok: true, method: 'icmp_event', component: name, eventName }
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) }
    }
  }

  function visibleSubmitComponentNames() {
    const engine = getTmallEngine()
    if (!engine || typeof engine.getComponent !== 'function') return []
    return ['button-submit', 'button-submitMp', 'button-submitEaMp']
      .filter(name => {
        try {
          const props = engine.getComponent(name)?.getProps?.() || {}
          return props.visible !== false
        } catch (error) {
          return false
        }
      })
  }

  async function submitTmallPublishByApi(options = {}) {
    const submitComponent = visibleSubmitComponentNames()[0]
    if (submitComponent && !options.forceHttpPost) {
      const emitted = emitComponentEvent(submitComponent, 'click')
      if (emitted.ok) return { ...emitted, ok: true, note: `已通过天猫发布页 API 触发 ${submitComponent}` }
    }
    if (options.allowHttpPost === false) {
      return {
        ok: false,
        method: 'api',
        reason: '当前阶段只允许通过天猫发布页组件触发提交，未执行 submit.htm 原始表单提交',
      }
    }

    const payload = buildTmallSubmitPayload(getTmallFormValues(), getTmallGlobal(), options)
    if (!compact(payload.catId)) {
      return {
        ok: false,
        method: 'api',
        reason: '发布页未读取到商品类目 catId，已阻止提交发布，避免天猫返回“类目为空或不存在”',
        payload,
      }
    }
    const direct = await postTmallForm('submit.htm', payload, options.timeoutMs || 15000)
    if (direct.ok || direct.successful) {
      return {
        ...direct,
        ok: true,
        method: 'http_post',
        note: '已通过 submit.htm API 提交',
      }
    }
    return {
      ok: false,
      method: 'api',
      reason: direct.reason || '未能通过 API 提交',
      direct,
    }
  }

  function confirmPublishByApiIfPresent() {
    const candidates = ['riskWarning', 'feedbackSubmit_catErrorWarning', 'fakeCredit', 'skuCheckDialog', 'knivesCommitment']
    for (const name of candidates) {
      const engine = getTmallEngine()
      let props = {}
      try {
        props = engine?.getComponent?.(name)?.getProps?.() || {}
      } catch (error) {}
      if (!props.visible || props.vis === false || props.loading === true) continue
      const ok = emitComponentEvent(name, 'ok')
      if (ok.ok) return { ...ok, note: `已通过天猫确认 API 处理 ${name}` }
      const upper = emitComponentEvent(name, 'oK')
      if (upper.ok) return { ...upper, note: `已通过天猫确认 API 处理 ${name}` }
    }
    return { ok: false, reason: '没有可见确认组件' }
  }

  function extractPcDetailUrlsFromModules(modularDesc) {
    return flattenModularDescImages(Array.isArray(modularDesc) ? modularDesc : [])
      .map(image => compact(image.src))
      .filter(Boolean)
  }

  function extractPcDetailUrlsFromHtml(html) {
    const value = String(html || '')
    if (!value) return []
    return extractPcDetailUrlsFromModules([{
      id: 'tmDescription',
      name: '文本PC详情',
      content: value,
      custom: true,
    }])
  }

  function pcDetailHtmlFromSource(modularDesc, pcDetailHtml = '') {
    if (Array.isArray(modularDesc) && modularDesc.length) {
      const html = modularDesc.map(module => String(module?.content || '')).join('')
      if (html) return html
    }
    return String(pcDetailHtml || '')
  }

  function pcDetailUrlsFromSource(modularDesc, pcDetailHtml = '') {
    const moduleUrls = extractPcDetailUrlsFromModules(modularDesc)
    return moduleUrls.length ? moduleUrls : extractPcDetailUrlsFromHtml(pcDetailHtml)
  }

  function collectRemoteImageUrls(value, seen = new Set()) {
    if (value == null) return []
    if (typeof value === 'string') {
      const urls = []
      const remoteRe = /(?:https?:)?\/\/[^"' <>()\]]+/ig
      let match = null
      while ((match = remoteRe.exec(value))) {
        const url = normalizeRemoteUrl(match[0]).replace(/&amp;/g, '&')
        if (/\.(?:jpg|jpeg|png|webp|gif)(?:[._?]|$)/i.test(url) || /alicdn\.com/i.test(url)) urls.push(url)
      }
      return urls
    }
    if (typeof value !== 'object' || seen.has(value)) return []
    seen.add(value)
    const urls = []
    if (Array.isArray(value)) {
      value.forEach(item => urls.push(...collectRemoteImageUrls(item, seen)))
      return urls
    }
    for (const key of ['url', 'src', 'picUrl', 'imageUrl', 'background-image', 'backgroundImage']) {
      urls.push(...collectRemoteImageUrls(value[key], seen))
    }
    Object.values(value).forEach(item => urls.push(...collectRemoteImageUrls(item, seen)))
    return urls
  }

  function uniqueImageUrls(urls = []) {
    const seen = new Set()
    return (Array.isArray(urls) ? urls : [])
      .map(normalizeRemoteUrl)
      .filter(Boolean)
      .filter(url => !seen.has(url) && seen.add(url))
  }

  function comparableImageUrl(value) {
    const raw = normalizeRemoteUrl(value).replace(/^https?:/i, '')
    if (!raw) return ''
    try {
      const parsed = new URL(raw.startsWith('//') ? `https:${raw}` : raw, location.href)
      return `//${parsed.host}${parsed.pathname}`.toLowerCase()
    } catch (error) {
      return raw.split('?')[0].toLowerCase()
    }
  }

	  function imageUrlMatches(actual, expected) {
	    const actualKey = comparableImageUrl(actual)
	    const expectedKey = comparableImageUrl(expected)
	    if (!actualKey || !expectedKey) return false
	    return actualKey === expectedKey || actualKey.includes(expectedKey) || expectedKey.includes(actualKey)
	  }

	  function imageUrlSequenceMatches(actualUrls = [], expectedUrls = []) {
	    const actual = (Array.isArray(actualUrls) ? actualUrls : []).map(compact).filter(Boolean)
	    const expected = (Array.isArray(expectedUrls) ? expectedUrls : []).map(compact).filter(Boolean)
	    return actual.length === expected.length &&
	      expected.length > 0 &&
	      actual.every((url, index) => imageUrlMatches(url, expected[index]))
	  }

	  function hammingDistance(left = '', right = '') {
	    const a = String(left || '')
	    const b = String(right || '')
	    const length = Math.min(a.length, b.length)
	    let distance = Math.abs(a.length - b.length)
	    for (let index = 0; index < length; index += 1) {
	      if (a[index] !== b[index]) distance += 1
	    }
	    return distance
	  }

	  async function imageVisualFingerprint(src, options = {}) {
	    const url = thumbUrlForVisualFeature(src)
	    const size = Math.max(8, Math.min(32, positiveInt(options.size, 16)))
	    const timeoutMs = positiveInt(options.timeoutMs, 5000)
	    if (!url || typeof fetch !== 'function' || typeof createImageBitmap !== 'function' || !document?.createElement) {
	      return { ok: false, url, reason: '当前页面不支持图片视觉指纹' }
	    }
	    try {
	      const response = await withTimeout(fetch(url, { credentials: 'omit' }), timeoutMs, `图片视觉指纹${url}`)
	      if (!response.ok) throw new Error(`HTTP ${response.status}`)
	      const blob = await response.blob()
	      const bitmap = await createImageBitmap(blob)
	      const canvas = document.createElement('canvas')
	      canvas.width = size
	      canvas.height = size
	      const ctx = canvas.getContext?.('2d', { willReadFrequently: true })
	      if (!ctx) throw new Error('无法创建 canvas 2d context')
	      ctx.drawImage(bitmap, 0, 0, size, size)
	      const data = ctx.getImageData(0, 0, size, size).data
	      const grays = []
	      for (let offset = 0; offset < data.length; offset += 4) {
	        grays.push(Math.round((data[offset] + data[offset + 1] + data[offset + 2]) / 3))
	      }
	      const avg = grays.reduce((sum, value) => sum + value, 0) / Math.max(1, grays.length)
	      return {
	        ok: true,
	        url,
	        size,
	        hash: grays.map(value => (value >= avg ? '1' : '0')).join(''),
	      }
	    } catch (error) {
	      return { ok: false, url, reason: String(error?.message || error) }
	    }
	  }

	  async function mapWithConcurrency(items = [], concurrency = 3, mapper = async item => item) {
	    const source = Array.isArray(items) ? items : []
	    const limit = Math.max(1, positiveInt(concurrency, 3))
	    const results = new Array(source.length)
	    let cursor = 0
	    const workers = Array.from({ length: Math.min(limit, source.length) }, async () => {
	      while (cursor < source.length) {
	        const index = cursor
	        cursor += 1
	        results[index] = await mapper(source[index], index)
	      }
	    })
	    await Promise.all(workers)
	    return results
	  }

	  async function imageUrlSequenceVisuallyMatches(actualUrls = [], expectedUrls = [], options = {}) {
	    const actual = (Array.isArray(actualUrls) ? actualUrls : []).map(compact).filter(Boolean)
	    const expected = (Array.isArray(expectedUrls) ? expectedUrls : []).map(compact).filter(Boolean)
	    if (!actual.length || actual.length !== expected.length) {
	      return { ok: false, matched: false, reason: `图片数量不一致：当前${actual.length}张，本次${expected.length}张` }
	    }
	    const maxImages = positiveInt(options.maxImages, 30)
	    if (actual.length > maxImages) {
	      return { ok: false, matched: false, reason: `图片数量${actual.length}超过视觉比对上限${maxImages}` }
	    }
	    const concurrency = positiveInt(options.concurrency, 3)
	    const timeoutMs = positiveInt(options.timeoutMs, 5000)
	    const fingerprints = await mapWithConcurrency(
	      actual.map((url, index) => ({ actualUrl: url, expectedUrl: expected[index], index })),
	      concurrency,
	      async pair => ({
	        index: pair.index,
	        actual: await imageVisualFingerprint(pair.actualUrl, { timeoutMs }),
	        expected: await imageVisualFingerprint(pair.expectedUrl, { timeoutMs }),
	      }),
	    )
	    const failed = fingerprints.find(item => !item.actual.ok || !item.expected.ok)
	    if (failed) {
	      return {
	        ok: false,
	        matched: false,
	        reason: `第${failed.index + 1}张图片视觉指纹失败：${failed.actual.reason || failed.expected.reason || '未知原因'}`,
	        fingerprints,
	      }
	    }
	    const threshold = positiveInt(options.threshold, 30)
	    const distances = fingerprints.map(item => hammingDistance(item.actual.hash, item.expected.hash))
	    const matched = distances.every(distance => distance <= threshold)
	    return {
	      ok: true,
	      matched,
	      distances,
	      threshold,
	      reason: matched
	        ? `当前PC详情替换区与本次素材视觉一致：${actual.length}张`
	        : `当前PC详情替换区与本次素材视觉不一致：最大差异${Math.max(...distances)}/${threshold}`,
	    }
	  }

  function missingImageUrls(expectedUrls = [], actualUrls = []) {
    const actual = uniqueImageUrls(actualUrls)
    return uniqueImageUrls(expectedUrls).filter(expected => !actual.some(url => imageUrlMatches(url, expected)))
  }

	  function uploadedPcDetailUrlsFromShared(state = shared) {
	    return uniqueImageUrls((state?.uploaded_by_category?.pc_detail || []).map(item => item?.url))
	  }

	  function matchedCurrentPcDetailUrlsFromShared(state = shared) {
	    if (!state?.pc_detail_skip_replacement || !state?.pc_detail_already_match?.matched) return []
	    return uniqueImageUrls(state.pc_detail_already_match.currentUrls || [])
	  }

	  function expectedPcDetailUrlsFromShared(state = shared) {
	    return matchedCurrentPcDetailUrlsFromShared(state).length
	      ? matchedCurrentPcDetailUrlsFromShared(state)
	      : uploadedPcDetailUrlsFromShared(state)
	  }

	  function hasNextPendingJob(state = shared) {
	    const jobs = Array.isArray(state?.jobs) ? state.jobs : []
	    const index = Number(state?.job_index || 0)
	    return !!jobs[index + 1]
	  }

	  function uploadedPcDetailItems(uploadedByCategory = {}) {
	    return (uploadedByCategory?.pc_detail || [])
	      .map(item => ({
	        ...item,
	        url: compact(item?.url || item?.src || item?.picUrl || item?.imageUrl || ''),
	      }))
	      .filter(item => item.url)
	  }

	  async function detectPcDetailAlreadyMatchesUpload(pcDetailReplacement = {}, uploadedItems = [], rawParams = params) {
	    const expectedUrls = uploadedPcDetailItems({ pc_detail: uploadedItems }).map(item => item.url)
	    const currentUrls = (Array.isArray(pcDetailReplacement?.currentReplacementUrls)
	      ? pcDetailReplacement.currentReplacementUrls
	      : [])
	      .map(compact)
	      .filter(Boolean)
	    if (!expectedUrls.length) return { matched: false, skipped: true, reason: '本次没有PC详情图' }
	    if (!pcDetailReplacement?.ok) return { matched: false, reason: 'PC详情替换预检未通过' }
	    if (!currentUrls.length) return { matched: false, reason: '未读到当前PC详情替换区图片' }
	    const visualOptions = {
	      maxImages: positiveInt(rawParams.pc_detail_duplicate_compare_max_images, 30),
	      concurrency: positiveInt(rawParams.pc_detail_duplicate_compare_concurrency, 3),
	      timeoutMs: positiveInt(rawParams.pc_detail_duplicate_compare_timeout_ms, 5000),
	      threshold: positiveInt(rawParams.pc_detail_duplicate_compare_threshold, 30),
	    }
	    const duplicateSequenceCount = positiveInt(pcDetailReplacement?.duplicateSequenceCount, 0)
	    if (
	      duplicateSequenceCount > 1 &&
	      currentUrls.length === expectedUrls.length * duplicateSequenceCount
	    ) {
	      const firstSegment = currentUrls.slice(0, expectedUrls.length)
	      const firstSegmentMatchesByUrl = imageUrlSequenceMatches(firstSegment, expectedUrls)
	      if (firstSegmentMatchesByUrl) {
	        return {
	          matched: false,
	          duplicateCleanup: true,
	          method: 'url_sequence_duplicate_cleanup',
	          reason: `当前PC详情已有${duplicateSequenceCount}遍重复详情图，第一遍URL与本次素材一致，将清理为一遍`,
	          currentUrls,
	          expectedUrls,
	          compareUrls: firstSegment,
	        }
	      }
	      const duplicateVisual = await imageUrlSequenceVisuallyMatches(firstSegment, expectedUrls, visualOptions)
	      if (duplicateVisual.ok && duplicateVisual.matched) {
	        return {
	          matched: false,
	          duplicateCleanup: true,
	          method: 'visual_hash_duplicate_cleanup',
	          reason: `当前PC详情已有${duplicateSequenceCount}遍重复详情图，第一遍与本次素材视觉一致，将清理为一遍`,
	          visual: duplicateVisual,
	          currentUrls,
	          expectedUrls,
	          compareUrls: firstSegment,
	        }
	      }
	      return {
	        matched: false,
	        method: duplicateVisual.ok ? 'visual_hash_duplicate_cleanup' : 'visual_hash_unavailable',
	        reason: duplicateVisual.reason || `当前PC详情疑似重复${duplicateSequenceCount}遍，但与本次素材不一致，不能自动清理`,
	        visual: duplicateVisual,
	        currentUrls,
	        expectedUrls,
	        compareUrls: firstSegment,
	      }
	    }
	    if (currentUrls.length !== expectedUrls.length) {
	      return {
	        matched: false,
	        reason: `当前PC详情替换区${currentUrls.length}张，本次素材${expectedUrls.length}张，不能跳过替换`,
	        currentUrls,
	        expectedUrls,
	      }
	    }
	    if (imageUrlSequenceMatches(currentUrls, expectedUrls)) {
	      return {
	        matched: true,
	        method: 'url_sequence',
	        reason: `当前PC详情替换区URL已与本次素材一致：${expectedUrls.length}张`,
	        currentUrls,
	        expectedUrls,
	      }
	    }
	    const visual = await imageUrlSequenceVisuallyMatches(currentUrls, expectedUrls, visualOptions)
	    if (visual.ok && visual.matched) {
	      return {
	        matched: true,
	        method: 'visual_hash',
	        reason: visual.reason,
	        visual,
	        currentUrls,
	        expectedUrls,
	      }
	    }
	    return {
	      matched: false,
	      method: visual.ok ? 'visual_hash' : 'visual_hash_unavailable',
	      reason: visual.reason || '当前PC详情替换区与本次素材不一致',
	      visual,
	      currentUrls,
	      expectedUrls,
	    }
	  }

	  function markPcDetailReplacementSkipped(componentValues = {}, currentValues = {}, match = {}) {
	    const currentModules = Array.isArray(currentValues.modularDesc) ? currentValues.modularDesc : []
	    const currentTmDescription = typeof currentValues.tmDescription === 'string' ? currentValues.tmDescription : ''
	    const replacement = componentValues.pcDetailReplacement && typeof componentValues.pcDetailReplacement === 'object'
	      ? componentValues.pcDetailReplacement
	      : {}
	    const replacementModules = Array.isArray(replacement.modules) ? replacement.modules : []
	    const preferReplacementModules = compact(replacement.target) === 'descRepublicOfSell' && replacementModules.length
	    const sourceModules = preferReplacementModules
	      ? replacementModules
	      : (currentModules.length ? currentModules : replacementModules)
	    const existingDetailHtml = pcDetailHtmlFromSource(sourceModules, currentTmDescription) || replacement.detailHtml || ''
	    return {
	      ...componentValues,
	      descRepublicOfSell: undefined,
	      descForShenbiPc: undefined,
	      descType: undefined,
	      modularDesc: undefined,
	      tmDescription: undefined,
	      detailHtml: existingDetailHtml,
	      pcDetailReplacement: {
	        ...replacement,
	        ok: true,
	        skippedBecauseAlreadyMatches: true,
	        skipMethod: match.method || '',
	        mode: 'already_matches',
	        modules: sourceModules,
	        html: currentTmDescription || replacement.html,
	        detailHtml: existingDetailHtml,
	        note: compact([
	          compact(replacement.target) === 'descRepublicOfSell'
	            ? '新版详情PC详情区与本次素材一致，跳过替换，仅继续最终发布读回校验'
	            : 'PC详情与本次素材一致，跳过PC替换，仅继续手机端详情同步',
	          match.reason,
	        ].filter(Boolean).join('；')),
	      },
	    }
	  }

  function currentPcDetailReadbackUrls() {
    const modularDescUrls = extractPcDetailUrlsFromModules(getComponentValue('modularDesc'))
    const legacyHtmlUrls = extractPcDetailUrlsFromHtml(getLegacyPcDetailHtml())
    const newDescValue = getNewDescValue()
    const newDescUrls = [
      ...flattenNewDescPicComponents(newDescValue).map(pic => pic.src),
      ...collectRemoteImageUrls(newDescValue),
    ]
    const shenbiPcUrls = collectRemoteImageUrls(getComponentValue('descForShenbiPc') || getTmallFormValues().descForShenbiPc)
    return uniqueImageUrls([...modularDescUrls, ...legacyHtmlUrls, ...newDescUrls, ...shenbiPcUrls])
  }

	  function currentMobileDetailReadbackUrls() {
	    return uniqueImageUrls(collectRemoteImageUrls(getComponentValue('descForShenbiMobile') || getTmallFormValues().descForShenbiMobile))
	  }

	  function verifyPublishedDetailReadback(state = shared) {
    const expected = expectedPcDetailUrlsFromShared(state)
    if (!expected.length) {
      return { ok: true, skipped: true, reason: '本次没有PC详情图，跳过详情读回校验', expectedCount: 0 }
    }
	    const pcUrls = currentPcDetailReadbackUrls()
	    const currentMobileValue = getComponentValue('descForShenbiMobile') || getTmallFormValues().descForShenbiMobile
	    const mobileUrls = uniqueImageUrls(collectRemoteImageUrls(currentMobileValue))
	    const pcMissing = missingImageUrls(expected, pcUrls)
	    const mobileMissing = missingImageUrls(expected, mobileUrls)
	    const mobileDuplicateProbe = cleanDuplicateShenbiMobileImages(currentMobileValue)
	    const pcAlreadyMatched = !!(
	      state?.pc_detail_skip_replacement &&
	      state?.pc_detail_already_match &&
	      state.pc_detail_already_match.matched
	    )
	    const visualMobileEditorVerified = !!(
	      state?.mobile_editor_imported ||
	      state?.mobile_editor_saved ||
	      state?.mobile_editor_finish_result
	    )
	    const transformedMobileOk = visualMobileEditorVerified &&
	      mobileUrls.length >= expected.length &&
	      !mobileDuplicateProbe.changed
	    const mobileOk = mobileMissing.length === 0 || transformedMobileOk
	    const newDescSameComponent = isNewDescPcDetailTarget(state)
	    const pcOk = pcMissing.length === 0 || pcAlreadyMatched
	    const ok = pcOk && (newDescSameComponent || mobileOk)
	    const pcReason = pcAlreadyMatched
	      ? `PC详情本轮跳过替换，已在写入前确认与本次素材一致（${state.pc_detail_already_match.method || 'already_match'}）${pcMissing.length === 0 ? `；PC详情 ${pcUrls.length} 张，本次PC详情图 ${expected.length} 张均已匹配` : ''}`
	      : (pcMissing.length === 0
	          ? `PC详情 ${pcUrls.length} 张，本次PC详情图 ${expected.length} 张均已匹配`
	          : `PC缺失 ${pcMissing.length}/${expected.length} 张`)
	    const mobileReason = newDescSameComponent
	      ? `新版详情同组件发布，无需旧版手机端导入；以PC图文详情读回 ${pcUrls.length} 张为准`
	      : (mobileMissing.length === 0
	          ? `手机详情 ${mobileUrls.length} 张，本次PC详情图 ${expected.length} 张均已匹配`
	          : transformedMobileOk
	            ? `手机详情 ${mobileUrls.length} 张，旧版手机编辑器已导入保存；天猫已重生成手机图URL，按数量和去重校验通过`
	            : `手机缺失 ${mobileMissing.length}/${expected.length} 张${mobileDuplicateProbe.changed ? '，且检测到重复图' : ''}`)
	    return {
	      ok,
	      expectedCount: expected.length,
	      pcImageCount: pcUrls.length,
	      mobileImageCount: mobileUrls.length,
	      pcMissing,
	      mobileMissing,
	      pcAlreadyMatchedAccepted: pcAlreadyMatched && pcMissing.length > 0,
	      mobileTransformedUrlAccepted: transformedMobileOk && mobileMissing.length > 0,
	      mobileDuplicateCount: (mobileDuplicateProbe.removedDetailCount || 0) + (mobileDuplicateProbe.removedNativeCount || 0),
	      reason: ok
	        ? `发布后读回校验通过：${pcReason}；${mobileReason}`
	        : `发布后读回校验失败：${pcReason}；${mobileReason}`,
	    }
	  }

  function currentLegacyPcDetailModulesForOcr() {
    const modularDesc = getComponentValue('modularDesc')
    if (Array.isArray(modularDesc) && modularDesc.length) {
      return {
        target: 'modularDesc',
        modules: modularDesc,
      }
    }
    const tmDescription = getLegacyPcDetailHtml()
    if (tmDescription) {
      return {
        target: 'tmDescription',
        modules: [{
          id: 'tmDescription',
          name: '文本PC详情',
          content: tmDescription,
          custom: true,
        }],
      }
    }
    return null
  }

  function currentPcDetailModulesForOcr(options = {}) {
    if (!options.preferLegacyPcDetail) {
      const newDescValue = getNewDescValue()
      if (hasUsableNewDescTemplate(newDescValue)) {
        return {
          target: 'descRepublicOfSell',
          modules: newDescPicsToModules(flattenNewDescPicComponents(newDescValue)),
        }
      }
    }
    const legacySource = currentLegacyPcDetailModulesForOcr()
    if (legacySource) return legacySource
    const newDescValue = getNewDescValue()
    if (hasUsableNewDescTemplate(newDescValue)) {
      return {
        target: 'descRepublicOfSell',
        modules: newDescPicsToModules(flattenNewDescPicComponents(newDescValue)),
      }
    }
    return {
      target: '',
      modules: [],
    }
  }

  function ocrMaxImages(rawParams = params) {
    const value = rawParams.ocr_max_images
    if (value == null || value === '') return OCR_DEFAULT_MAX_IMAGES
    if (/^(all|full|全部|所有|无限)$/i.test(compact(value))) return Number.POSITIVE_INFINITY
    return Math.max(1, positiveInt(value, OCR_DEFAULT_MAX_IMAGES))
  }

  function tesseractRuntimeConfig(rawParams = params) {
    const assetBase = compact(
      rawParams.ocr_asset_base_url || rawParams.__crawshrimp_api_base_url || CRAW_SHRIMP_LOCAL_BASE_URL,
    ).replace(/\/+$/, '')
    const localVendorPath = `${assetBase}${TESSERACT_VENDOR_PATH}`
    return {
      scriptUrl: compact(rawParams.tesseract_script_url || rawParams.ocr_tesseract_url || `${localVendorPath}/tesseract.min.js` || TESSERACT_SCRIPT_URL),
      workerPath: compact(rawParams.tesseract_worker_url || `${localVendorPath}/worker.min.js` || TESSERACT_WORKER_URL),
      corePath: compact(rawParams.tesseract_core_path || localVendorPath || TESSERACT_CORE_PATH),
      langPath: compact(rawParams.tesseract_lang_path || `${localVendorPath}/lang` || TESSERACT_LANG_PATH),
      lang: compact(rawParams.tesseract_lang || rawParams.ocr_lang || TESSERACT_LANG),
      maxImages: ocrMaxImages(rawParams),
      perImageTimeoutMs: positiveInt(rawParams.ocr_per_image_timeout_ms, OCR_PER_IMAGE_TIMEOUT_MS),
      totalTimeoutMs: positiveInt(rawParams.ocr_total_timeout_ms, OCR_TOTAL_TIMEOUT_MS),
    }
  }

  function withTimeout(promise, timeoutMs, label) {
    let timer = null
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label || '操作'}超时 ${timeoutMs}ms`)), timeoutMs)
    })
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer)
    })
  }

  function ensureAbsoluteImageUrl(src) {
    const raw = compact(src)
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    try {
      return new URL(raw, location.href).href
    } catch (error) {
      return raw
    }
  }

  async function loadScriptTag(url) {
    if (typeof document === 'undefined' || !document.createElement) throw new Error('当前页面不支持动态加载脚本')
    await new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = url
      script.async = true
      script.onload = resolve
      script.onerror = () => reject(new Error(`加载 Tesseract.js 失败: ${url}`))
      ;(document.head || document.documentElement || document.body).appendChild(script)
    })
  }

  async function loadTesseractRuntime(config = tesseractRuntimeConfig()) {
    if (window.Tesseract) return window.Tesseract
    if (window.__CRAWSHRIMP_TESSERACT_LOADING__) return window.__CRAWSHRIMP_TESSERACT_LOADING__
    window.__CRAWSHRIMP_TESSERACT_LOADING__ = (async () => {
      try {
        await loadScriptTag(config.scriptUrl)
      } catch (scriptError) {
        if (typeof fetch !== 'function') throw scriptError
        const response = await fetch(config.scriptUrl, { credentials: 'omit' })
        if (!response.ok) throw scriptError
        const code = await response.text()
        ;(0, eval)(`${code}\n//# sourceURL=${config.scriptUrl}`)
      }
      if (!window.Tesseract) throw new Error('Tesseract.js 已加载但未暴露 window.Tesseract')
      return window.Tesseract
    })()
    try {
      return await window.__CRAWSHRIMP_TESSERACT_LOADING__
    } finally {
      window.__CRAWSHRIMP_TESSERACT_LOADING__ = null
    }
  }

  async function createTesseractWorker(Tesseract, config) {
    const engineOptions = {
      workerPath: config.workerPath,
      corePath: config.corePath,
      langPath: config.langPath,
      logger: () => {},
    }
    if (!Tesseract?.createWorker) return null
    let firstError = null
    try {
      const worker = await Tesseract.createWorker(config.lang, 1, engineOptions)
      if (worker?.recognize) return worker
    } catch (error) {
      firstError = error
    }
    try {
      const worker = await Tesseract.createWorker(engineOptions)
      if (worker?.loadLanguage) await worker.loadLanguage(config.lang)
      if (worker?.initialize) await worker.initialize(config.lang)
      if (worker?.recognize) return worker
    } catch (error) {
      if (firstError) throw firstError
      throw error
    }
    return null
  }

  async function imageSourceForOcr(src) {
    const url = ensureAbsoluteImageUrl(src)
    if (!url || typeof fetch !== 'function' || typeof URL === 'undefined' || !URL.createObjectURL) {
      return { source: url, cleanup: () => {} }
    }
    try {
      const response = await fetch(url, { credentials: 'omit' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      return {
        source: objectUrl,
        cleanup: () => {
          try { URL.revokeObjectURL(objectUrl) } catch (error) {}
        },
      }
    } catch (error) {
      return { source: url, cleanup: () => {} }
    }
  }

  function thumbUrlForVisualFeature(src) {
    const url = ensureAbsoluteImageUrl(src)
    if (!/alicdn\.com/i.test(url)) return url
    if (/[._](?:jpg|jpeg|png|webp)(?:\?.*)?$/i.test(url)) return url.replace(/(\.(?:jpg|jpeg|png|webp))(\?.*)?$/i, '$1_160x160.jpg$2')
    return `${url}_160x160.jpg`
  }

  function largestBlackComponentRatio(blackMask, width, height) {
    const seen = new Uint8Array(width * height)
    let largest = 0
    const queue = []
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const start = y * width + x
        if (!blackMask[start] || seen[start]) continue
        let size = 0
        queue.length = 0
        queue.push(start)
        seen[start] = 1
        while (queue.length) {
          const current = queue.pop()
          size += 1
          const cx = current % width
          const cy = Math.floor(current / width)
          const neighbors = [
            cy > 0 ? current - width : -1,
            cy < height - 1 ? current + width : -1,
            cx > 0 ? current - 1 : -1,
            cx < width - 1 ? current + 1 : -1,
          ]
          for (const next of neighbors) {
            if (next < 0 || !blackMask[next] || seen[next]) continue
            seen[next] = 1
            queue.push(next)
          }
        }
        if (size > largest) largest = size
      }
    }
    return largest / Math.max(1, width * height)
  }

  function classifyWhiteBlackVisualFeature(feature) {
    if (!feature || feature.ok === false) return false
    const whiteRatio = Number(feature.whiteRatio || 0)
    const blackRatio = Number(feature.blackRatio || 0)
    const saturationAvg = Number(feature.saturationAvg || 0)
    const largestBlackRatio = Number(feature.largestBlackComponentRatio || 0)
    return whiteRatio >= 0.62 &&
      blackRatio >= 0.025 &&
      blackRatio <= 0.28 &&
      saturationAvg <= 0.2 &&
      largestBlackRatio <= 0.055
  }

  async function visualFeatureForImage(image, timeoutMs = 6000) {
    const index = Number(image?.globalIndex ?? 0)
    const url = thumbUrlForVisualFeature(image?.src)
    try {
      const response = await withTimeout(fetch(url, { credentials: 'omit' }), timeoutMs, `视觉识别图片${index + 1}`)
      const blob = await response.blob()
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = 32
      canvas.height = 32
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(bitmap, 0, 0, 32, 32)
      const data = ctx.getImageData(0, 0, 32, 32).data
      let white = 0
      let black = 0
      let saturation = 0
      const blackMask = new Uint8Array(32 * 32)
      for (let offset = 0; offset < data.length; offset += 4) {
        const r = data[offset], g = data[offset + 1], b = data[offset + 2]
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        if (r >= 235 && g >= 235 && b >= 235) white += 1
        if (r <= 65 && g <= 65 && b <= 65) {
          black += 1
          blackMask[offset / 4] = 1
        }
        saturation += max === 0 ? 0 : (max - min) / max
      }
      const pixels = data.length / 4
      return {
        index,
        ok: true,
        whiteRatio: white / pixels,
        blackRatio: black / pixels,
        saturationAvg: saturation / pixels,
        largestBlackComponentRatio: largestBlackComponentRatio(blackMask, 32, 32),
      }
    } catch (error) {
      return { index, ok: false, error: String(error?.message || error) }
    }
  }

  async function detectWhiteBlackVisualFallback(images = [], anchors = {}, rawParams = params) {
    const currentPriority = pcDetailAnchorPriority(anchors.stopAnchorKind)
    if (currentPriority >= pcDetailAnchorPriority('white_black_fallback')) return null
    const fixedTopIndex = Number(anchors.fixedTopImageIndex)
    const minIndex = Number.isFinite(fixedTopIndex) ? fixedTopIndex + 1 : 0
    const timeoutMs = positiveInt(rawParams.visual_per_image_timeout_ms, 6000)
    for (const image of Array.isArray(images) ? images : []) {
      if (Number(image?.globalIndex) < minIndex || !compact(image?.src)) continue
      const feature = await visualFeatureForImage(image, timeoutMs)
      if (!classifyWhiteBlackVisualFeature(feature)) continue
      return {
        stopImageIndex: Number(image.globalIndex),
        stopAnchorKind: 'white_black_fallback',
        source: 'visual_canvas_white_black',
        confidence: 0.74,
      }
    }
    return null
  }

  async function recognizeImageWithTesseract(Tesseract, worker, image, config) {
    const prepared = await imageSourceForOcr(image.src)
    try {
      if (!prepared.source) throw new Error('图片 URL 为空')
      const run = worker?.recognize
        ? worker.recognize(prepared.source)
        : Tesseract.recognize(prepared.source, config.lang, {
          workerPath: config.workerPath,
          corePath: config.corePath,
          langPath: config.langPath,
          logger: () => {},
        })
      const result = await withTimeout(run, config.perImageTimeoutMs, `OCR图片${image.globalIndex + 1}`)
      return {
        globalIndex: image.globalIndex,
        imageIndex: image.imageIndex,
        src: image.src,
        text: compact(result?.data?.text || result?.text || ''),
        confidence: Number(result?.data?.confidence ?? result?.confidence ?? 0) || 0,
      }
    } finally {
      prepared.cleanup()
    }
  }

  async function runTesseractOcrForImages(images = [], rawParams = params) {
    const config = tesseractRuntimeConfig(rawParams)
    const candidates = (Array.isArray(images) ? images : [])
      .filter(image => compact(image?.src))
      .slice(0, config.maxImages)
    if (!candidates.length) return { ok: false, reason: 'PC详情中没有可 OCR 的图片', results: [] }
    const totalTimeoutMs = Math.max(
      Number(config.totalTimeoutMs || 0),
      candidates.length * Number(config.perImageTimeoutMs || 0) + 60000,
    )

    return withTimeout((async () => {
      const Tesseract = await loadTesseractRuntime(config)
      let worker = null
      const results = []
      try {
        worker = await createTesseractWorker(Tesseract, config)
        for (const image of candidates) {
          try {
            results.push(await recognizeImageWithTesseract(Tesseract, worker, image, config))
          } catch (error) {
            results.push({
              globalIndex: image.globalIndex,
              imageIndex: image.imageIndex,
              src: image.src,
              text: '',
              confidence: 0,
              error: String(error?.message || error),
            })
          }
        }
      } finally {
        try { await worker?.terminate?.() } catch (error) {}
      }
      return {
        ok: true,
        engine: 'tesseract.js',
        lang: config.lang,
        scanned: results.length,
        results,
      }
    })(), totalTimeoutMs, 'Tesseract OCR')
  }

  async function detectPcDetailOcrAnchors(rawParams = params, options = {}) {
    const source = currentPcDetailModulesForOcr({
      preferLegacyPcDetail: !!options.preferLegacyPcDetail,
    })
    const images = flattenModularDescImages(source.modules)
    if (!images.length) {
      return {
        ok: false,
        reason: 'PC详情中未识别到图片，无法 OCR 锚点',
        source,
        images,
        anchors: { ocrStatus: 'no_images' },
      }
    }
    try {
      const ocr = await runTesseractOcrForImages(images, rawParams)
      const ocrAnchors = buildPcDetailVisualAnchorsFromOcrResults(images, ocr.results, {
        source: 'tesseract_ocr',
      })
      const visualFallback = await detectWhiteBlackVisualFallback(images, ocrAnchors, rawParams)
      const anchors = mergePcDetailVisualFallbackAnchors(ocrAnchors, visualFallback || {})
      const probe = currentPcDetailReplacementProbe({
        visualAnchors: anchors,
        requireVisualAnchors: true,
        allowLegacyCountImageReplace: options.allowLegacyCountImageReplace || parseBoolean(rawParams.allow_legacy_count_pc_detail_replace, false),
        legacyCountDetailImageCount: options.legacyCountDetailImageCount,
      })
      return {
        ok: !!probe.ok,
        reason: probe.ok ? '' : (probe.note || 'OCR 未识别到可靠锚点'),
        source,
        images,
        ocr,
        anchors,
        probe,
      }
    } catch (error) {
      return {
        ok: false,
        reason: String(error?.message || error),
        source,
        images,
        anchors: { ocrStatus: 'failed', source: 'tesseract_ocr' },
      }
    }
  }

  function escapeXmlText(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function buildWapDescDetailFromUrls(urls, sizeByUrl = {}) {
    const imgs = (Array.isArray(urls) ? urls : [])
      .map(url => compact(url))
      .filter(Boolean)
      .map(url => {
        const size = positiveInt(sizeByUrl[url], 0)
        return `<img size="${size}">${escapeXmlText(url)}</img>`
      })
      .join('')
    return `<wapDesc>${imgs}</wapDesc>`
  }

  function parseNativeDetailJson(value) {
    if (!value) return null
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch (error) {
      return null
    }
  }

  function buildNativeDetailFromUrls(urls, currentNativeDetail = '', sizeByUrl = {}) {
    const current = parseNativeDetailJson(currentNativeDetail) || {}
    const currentData = current.data && typeof current.data === 'object' ? current.data : {}
    const timestamp = Date.now()
    const children = (Array.isArray(urls) ? urls : [])
      .map(url => compact(url))
      .filter(Boolean)
      .map((url, index) => {
        const params = {
          childrenStyle: 'sequence',
          picUrl: url,
        }
        const size = sizeByUrl[url]
        if (size && typeof size === 'object' && (size.width || size.height)) {
          params.size = {
            width: String(size.width || ''),
            height: String(size.height || ''),
          }
        }
        return {
          ID: `detail_pic_${timestamp}_${index + 1}`,
          type: 'native',
          key: 'detail_container_style7',
          params,
          putID: -1,
        }
      })
    const data = {
      ID: currentData.ID || `detail_layout_${timestamp}`,
      type: currentData.type || 'native',
      key: currentData.key || 'sys_list',
      params: {
        ...(currentData.params && typeof currentData.params === 'object' ? jsonClone(currentData.params) : {}),
        requestMap: currentData.params?.requestMap || '{"see_more":true}',
      },
      putID: currentData.putID ?? -1,
      children,
    }
    return JSON.stringify({ data })
  }

	  function buildShenbiMobileValueFromPcUrls(urls, currentValue = {}, sizeByUrl = {}) {
	    const normalizedUrls = (Array.isArray(urls) ? urls : []).map(compact).filter(Boolean)
	    const current = currentValue && typeof currentValue === 'object' ? currentValue : {}
	    const descContainer = current.descContainer && typeof current.descContainer === 'object' ? current.descContainer : {}
    const detail = buildWapDescDetailFromUrls(normalizedUrls, sizeByUrl)
    return {
      ...jsonClone(current),
      cid: current.cid || 0,
      descContainer: {
        ...jsonClone(descContainer),
        detail,
        nativeDetail: buildNativeDetailFromUrls(normalizedUrls, descContainer.nativeDetail, sizeByUrl),
      },
	      empty: normalizedUrls.length === 0,
	    }
	  }

	  function wapDescImageAttr(attrs = '', name = '') {
	    const re = new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i')
	    const match = String(attrs || '').match(re)
	    return match ? decodeHtmlText(match[1]) : ''
	  }

	  function parseWapDescImageEntries(detail = '') {
	    const value = String(detail || '')
	    const entries = []
	    const re = /<img\b([^>]*)>([\s\S]*?)<\/img>/gi
	    let match = null
	    while ((match = re.exec(value))) {
	      entries.push({
	        attrs: String(match[1] || ''),
	        url: compact(decodeHtmlText(match[2] || '')),
	        size: wapDescImageAttr(match[1], 'size'),
	      })
	    }
	    return entries
	  }

	  function rebuildWapDescDetail(originalDetail = '', entries = []) {
	    const source = String(originalDetail || '')
	    const body = entries
	      .map(entry => `<img${entry.attrs || ''}>${escapeXmlText(entry.url)}</img>`)
	      .join('')
	    if (/<wapDesc\b[^>]*>[\s\S]*?<\/wapDesc>/i.test(source)) {
	      return source.replace(/(<wapDesc\b[^>]*>)[\s\S]*?(<\/wapDesc>)/i, `$1${body}$2`)
	    }
	    return `<wapDesc>${body}</wapDesc>`
	  }

	  function dedupeImageEntries(entries = []) {
	    const seen = new Set()
	    const kept = []
	    const removed = []
	    ;(Array.isArray(entries) ? entries : []).forEach((entry, index) => {
	      const url = compact(entry?.url)
	      const key = comparableImageUrl(url)
	      if (!key) {
	        kept.push(entry)
	        return
	      }
	      if (seen.has(key)) {
	        removed.push({ ...entry, index, key })
	        return
	      }
	      seen.add(key)
	      kept.push(entry)
	    })
	    return { kept, removed }
	  }

	  function cleanWapDescDuplicateImages(detail = '') {
	    const entries = parseWapDescImageEntries(detail)
	    if (!entries.length) return { changed: false, detail, removed: [], imageCount: 0 }
	    const deduped = dedupeImageEntries(entries)
	    if (!deduped.removed.length) return { changed: false, detail, removed: [], imageCount: entries.length }
	    return {
	      changed: true,
	      detail: rebuildWapDescDetail(detail, deduped.kept),
	      removed: deduped.removed,
	      imageCount: deduped.kept.length,
	    }
	  }

	  function cleanNativeDetailDuplicateImages(nativeDetail = '') {
	    const parsed = parseNativeDetailJson(nativeDetail)
	    if (!parsed) return { changed: false, nativeDetail, removed: [], imageCount: 0 }
	    const clone = jsonClone(parsed)
	    const seen = new Set()
	    const removed = []
	    let imageCount = 0
	    const cleanChildren = children => {
	      if (!Array.isArray(children)) return children
	      const result = []
	      children.forEach((child, index) => {
	        const node = child && typeof child === 'object' ? jsonClone(child) : child
	        const url = compact(node?.params?.picUrl || node?.params?.url || node?.picUrl || node?.url || '')
	        const key = comparableImageUrl(url)
	        if (key) {
	          if (seen.has(key)) {
	            removed.push({ index, url, key })
	            return
	          }
	          seen.add(key)
	          imageCount += 1
	        }
	        if (node && typeof node === 'object' && Array.isArray(node.children)) {
	          node.children = cleanChildren(node.children)
	        }
	        result.push(node)
	      })
	      return result
	    }
	    if (clone.data && typeof clone.data === 'object' && Array.isArray(clone.data.children)) {
	      clone.data.children = cleanChildren(clone.data.children)
	    } else if (Array.isArray(clone.children)) {
	      clone.children = cleanChildren(clone.children)
	    }
	    if (!removed.length) return { changed: false, nativeDetail, removed: [], imageCount }
	    return {
	      changed: true,
	      nativeDetail: JSON.stringify(clone),
	      removed,
	      imageCount,
	    }
	  }

	  function cleanDuplicateShenbiMobileImages(currentValue = {}) {
	    const source = currentValue && typeof currentValue === 'object' ? currentValue : {}
	    const descContainer = source.descContainer && typeof source.descContainer === 'object' ? source.descContainer : {}
	    const detailClean = cleanWapDescDuplicateImages(descContainer.detail || '')
	    const nativeClean = cleanNativeDetailDuplicateImages(descContainer.nativeDetail || '')
	    const changed = detailClean.changed || nativeClean.changed
	    if (!changed) {
	      return {
	        ok: true,
	        changed: false,
	        value: source,
	        removedDetailCount: 0,
	        removedNativeCount: 0,
	        imageCount: Math.max(detailClean.imageCount || 0, nativeClean.imageCount || 0),
	        note: '手机端详情没有检测到重复图片',
	      }
	    }
	    return {
	      ok: true,
	      changed: true,
	      value: {
	        ...jsonClone(source),
	        descContainer: {
	          ...jsonClone(descContainer),
	          detail: detailClean.changed ? detailClean.detail : descContainer.detail,
	          nativeDetail: nativeClean.changed ? nativeClean.nativeDetail : descContainer.nativeDetail,
	        },
	      },
	      removedDetailCount: detailClean.removed.length,
	      removedNativeCount: nativeClean.removed.length,
	      imageCount: Math.max(detailClean.imageCount || 0, nativeClean.imageCount || 0),
	      removedDetailUrls: detailClean.removed.map(item => item.url).filter(Boolean),
	      removedNativeUrls: nativeClean.removed.map(item => item.url).filter(Boolean),
	      note: `已清理手机端详情重复图片：wapDesc ${detailClean.removed.length} 张，nativeDetail ${nativeClean.removed.length} 张`,
	    }
	  }

	  function buildShenbiMobileValueFromPcModules(modularDesc, currentValue = {}, sizeByUrl = {}) {
	    return buildShenbiMobileValueFromPcUrls(extractPcDetailUrlsFromModules(modularDesc), currentValue, sizeByUrl)
	  }

  function buildShenbiPcDetailFromUrls(urls = []) {
    const imgs = (Array.isArray(urls) ? urls : [])
      .map(compact)
      .filter(Boolean)
      .map(url => `<img src="${escapeHtmlAttribute(url)}" style="display:block;width:750.0px;height:auto;margin:0;padding:0;border:0;"/>`)
      .join('')
    return `<div style="width: 750.0px;height: auto;overflow: hidden;">${imgs}</div>`
  }

  function buildShenbiPcValueFromPcModules(modularDesc, currentValue = {}) {
    const current = currentValue && typeof currentValue === 'object' ? currentValue : {}
    const urls = extractPcDetailUrlsFromModules(modularDesc)
    return {
      ...jsonClone(current),
      detail: buildShenbiPcDetailFromUrls(urls),
    }
  }

  function findGeneratedWapDesc(payload) {
    const seen = new Set()
    const visit = (value, depth = 0) => {
      if (depth > 7 || value == null) return ''
      if (typeof value === 'string') return value.includes('<wapDesc') ? value : ''
      if (typeof value !== 'object' || seen.has(value)) return ''
      seen.add(value)
      if (value.descContainer?.detail && String(value.descContainer.detail).includes('<wapDesc')) {
        return String(value.descContainer.detail)
      }
      if (value.detail && String(value.detail).includes('<wapDesc')) return String(value.detail)
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = visit(item, depth + 1)
          if (found) return found
        }
      } else {
        for (const item of Object.values(value)) {
          const found = visit(item, depth + 1)
          if (found) return found
        }
      }
      return ''
    }
    return visit(payload)
  }

  async function generateMobileDescByApi(modularDesc, timeoutMs = 5000, pcDetailHtml = '') {
    const detailHtml = pcDetailHtmlFromSource(modularDesc, pcDetailHtml)
    if (!detailHtml) return { ok: false, reason: 'PC详情为空' }
    const global = getTmallGlobal()
    const result = await postTmallForm('asyncOpt.htm?optType=wapDescAutoGen', {
      catId: global.catId || '',
      jsonBody: JSON.stringify({ desc: detailHtml }),
    }, timeoutMs)
    if (!result.ok && !result.successful) return { ok: false, reason: result.reason || '无线详情生成接口失败', result }
    const detail = findGeneratedWapDesc(result.payload)
    if (!detail) return { ok: false, reason: '无线详情生成接口未返回 wapDesc', result }
    return { ok: true, detail, result }
  }

  function buildImageSizeMapFromUploadedCategory(uploadedByCategory = {}) {
    const entries = []
    Object.values(uploadedByCategory || {}).forEach(list => {
      ;(Array.isArray(list) ? list : []).forEach(item => {
        if (item?.url) entries.push([item.url, item.size || item.fileSize || item.row?.__file_size || 0])
      })
    })
    return Object.fromEntries(entries)
  }

  function setTmallFormModelValue(name, value) {
    if (value === undefined) return { ok: true, method: 'skip' }
    const engine = getTmallEngine()
    if (!engine || typeof engine.getModels !== 'function') return { ok: false, reason: '发布页引擎未就绪' }
    try {
      const models = engine.getModels() || {}
      const formValues = {
        ...(models.formValues || {}),
        [name]: value,
      }
      if (typeof engine.updateModels === 'function') {
        engine.updateModels({ formValues })
      } else {
        models.formValues = formValues
      }
      return {
        ok: true,
        method: typeof engine.updateModels === 'function' ? 'form_model' : 'form_model_mutation',
        formValues,
      }
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) }
    }
  }

  function applyFormValue(name, value) {
    if (value === undefined) return { ok: true, method: 'skip' }
    const modelResult = setTmallFormModelValue(name, value)
    if (!modelResult.ok) return modelResult
    const componentResult = applyComponentValue(name, value, { skipModelUpdate: true })
    const finalModelResult = setTmallFormModelValue(name, value)
    if (!finalModelResult.ok) return finalModelResult
    return {
      ok: true,
      method: componentResult.ok
        ? `${modelResult.method}+${componentResult.method}+${finalModelResult.method}`
        : `${modelResult.method}+${finalModelResult.method}`,
      modelResult,
      componentResult,
      finalModelResult,
    }
  }

  async function syncMobileDetailByApi(modularDesc, options = {}) {
	    const currentValues = getTmallFormValues()
	    const sizeByUrl = buildImageSizeMapFromUploadedCategory(options.uploadedByCategory || {})
	    const pcDetailHtml = options.pcDetailHtml || ''
	    const urls = uniqueImageUrls(options.pcDetailUrls || pcDetailUrlsFromSource(modularDesc, pcDetailHtml))
    if (!urls.length) return { ok: false, reason: 'PC详情中未识别到图片，无法生成手机端详情' }

    const generated = await generateMobileDescByApi(modularDesc, options.timeoutMs || 5000, pcDetailHtml)
    const mobileValue = buildShenbiMobileValueFromPcUrls(urls, currentValues.descForShenbiMobile, sizeByUrl)
    if (generated.ok) {
      mobileValue.descContainer.detail = generated.detail
    }
    const applied = applyFormValue('descForShenbiMobile', mobileValue)
    if (!applied.ok) return { ok: false, reason: applied.reason || '写入手机端详情模型失败', generated }
    return {
      ok: true,
      method: generated.ok ? 'wapDescAutoGen+form_model' : 'form_model',
      imageCount: urls.length,
      generatedOk: generated.ok,
      generatedReason: generated.reason || '',
      note: generated.ok
        ? `已通过API导入电脑端详情并全图生成手机端详情，共 ${urls.length} 张图`
        : `无线详情生成接口不可用，已按PC详情图片直接生成手机端详情模型，共 ${urls.length} 张图；${generated.reason || ''}`,
      applied,
    }
  }

  function applyComponentValue(name, value, options = {}) {
    const state = getSellState()
    const engine = state?.engine
    if (value === undefined) return { ok: true, method: 'skip' }
    if (!engine) return { ok: false, reason: '发布页引擎未就绪' }
    const finish = result => {
      if (!result?.ok) return result
      if (options.skipModelUpdate) return result
      const modelResult = setTmallFormModelValue(name, value)
      if (!modelResult.ok) return { ok: false, method: result.method, reason: modelResult.reason, componentResult: result, modelResult }
      return {
        ...result,
        method: `${result.method}+${modelResult.method}`,
        modelResult,
      }
    }
    try {
      const component = typeof engine.getComponent === 'function' ? engine.getComponent(name) : null
      if (component && typeof component.emit === 'function') {
        component.emit('change', value)
        return finish({ ok: true, method: 'emit' })
      }
      if (component && typeof component.setProps === 'function') {
        component.setProps({ value })
        return finish({ ok: true, method: 'setProps' })
      }
      const core = engine._engine?._core
      const eventIds = core?.eventCenter?.comIdToEventIds?.[name]
      const targetId = Array.isArray(eventIds) ? eventIds[0] : name
      if (core && typeof core.changeElementValue === 'function') {
        core.changeElementValue(targetId, value, { trace: { source: 'crawshrimp-tmall-packaging', type: 'script' } })
        return finish({ ok: true, method: 'changeElementValue' })
      }
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) }
    }
    const modelResult = options.skipModelUpdate ? { ok: false, reason: `未找到组件：${name}` } : setTmallFormModelValue(name, value)
    if (modelResult.ok) return { ok: true, method: modelResult.method, modelResult }
    return { ok: false, reason: `未找到组件：${name}` }
  }

  function buildOutputStatusRows(rows, tmallStatus, note) {
    return (Array.isArray(rows) ? rows : []).map(row => ({
      ...row,
      '天猫货号': tmallStatus?.itemPropCode || '',
      '天猫商家编码': tmallStatus?.merchantCode || '',
      '页面校验': (tmallStatus?.validationMessages || []).join('；'),
      '备注': compact([row['备注'], note].filter(Boolean).join('；')),
    }))
  }

  function appendRowNote(row, note) {
    return {
      ...row,
      '备注': compact([row?.['备注'], note].filter(Boolean).join('；')),
    }
  }

  function isNewDescPcDetailTarget(state = shared) {
    return compact(state?.pc_detail_target || state?.pc_detail_replacement_probe?.target) === 'descRepublicOfSell'
  }

  function isModularPcDetailTarget(state = shared) {
    return compact(state?.pc_detail_target || state?.pc_detail_replacement_probe?.target) === 'modularDesc'
  }

  function isShenbiPcDetailTarget(state = shared) {
    return compact(state?.pc_detail_target || state?.pc_detail_replacement_probe?.target) === 'descForShenbiPc'
  }

  function isLegacyHtmlPcDetailTarget(state = shared) {
    return compact(state?.pc_detail_target || state?.pc_detail_replacement_probe?.target) === 'tmDescription'
  }

  function shouldUseVisualMobileEditorSync(state = shared, rawParams = params) {
    if (parseBoolean(rawParams.force_mobile_editor_sync, false)) return true
    const target = compact(state?.pc_detail_target || state?.pc_detail_replacement_probe?.target)
    return !!(
      state?.prefer_legacy_pc_detail ||
      state?.applied_desc_type ||
      target === 'tmDescription' ||
      target === 'modularDesc' ||
      target === 'descForShenbiPc'
    )
  }

  function isSparseNewDescOcrFailure(detected) {
    if (!detected || detected.ok) return false
    if (compact(detected.source?.target) !== 'descRepublicOfSell') return false
    const imageCount = Array.isArray(detected.images) ? detected.images.length : 0
    if (imageCount < 1 || imageCount > 2) return false
    const ocrResults = Array.isArray(detected.ocr?.results) ? detected.ocr.results : []
    const hasReadableText = ocrResults.some(item => compact(item?.text))
    return !hasReadableText || /未识别|无法 OCR|OCR|锚点/.test(String(detected.reason || detected.probe?.note || ''))
  }

  function isUnsafeNewDescCountFallbackProbe(probe = null) {
    if (!probe || compact(probe.target) !== 'descRepublicOfSell') return false
    if (compact(probe.mode) !== 'new_desc_legacy_count_replace') return false
    const picCount = Array.isArray(probe.pics) ? probe.pics.length : 0
    const replacedCount = positiveInt(probe.replacedImageCount, 0)
    const preservedTopCount = positiveInt(probe.preserveTopImageCount, 0)
    const tailCount = Math.max(0, picCount - replacedCount - preservedTopCount)
    return picCount >= 10 && tailCount >= 3
  }

  function currentJobFromShared(state = shared) {
    const jobs = Array.isArray(state.jobs) ? state.jobs : []
    const index = Number(state.job_index || 0)
    return {
      jobs,
      index,
      job: state.current_job || jobs[index] || null,
    }
  }

  function cleanJobRuntimeState(state, rows) {
    return {
      ...state,
      result_rows: rows,
      current_job: null,
      current_result_rows: [],
      pending_download_items: [],
      last_download_result: null,
      uploaded_by_category: null,
      injected_file_paths: [],
      tmall_wait_attempts: 0,
      legacy_switch_attempts: 0,
      publish_wait_attempts: 0,
      mobile_wait_attempts: 0,
      mobile_action_attempts: 0,
      mobile_api_attempts: 0,
      cloud_mount_activated: false,
      cloud_mount_tab_clicked: false,
      semir_login_wait_attempts: 0,
      semir_login_wait_error: '',
      publish_stage: '',
      pc_publish_note: '',
      mobile_sync_note: '',
      mobile_sync_api_result: null,
      applied_modular_desc: null,
      applied_pc_detail_html: '',
      applied_desc_type: null,
      pc_detail_target: '',
      pc_detail_replacement_probe: null,
      pc_detail_visual_anchors: null,
      pc_detail_ocr_result: null,
      pc_detail_ocr_attempted: false,
      prefer_legacy_pc_detail: false,
      legacy_wait_attempts: 0,
      return_old_confirm_attempts: 0,
      return_old_confirm_wait_attempts: 0,
      new_desc_sparse_ocr_fallback: false,
      new_desc_aggregate_legacy_fallback: false,
	      final_detail_readback_verified: false,
	      final_detail_readback_note: '',
	      final_readback_returned_old: false,
	      pc_detail_already_match: null,
	      pc_detail_skip_replacement: false,
	      mobile_detail_duplicates_cleaned: false,
	      mobile_detail_duplicate_cleanup: null,
	    }
	  }

  function advanceToNextJob(currentRows = [], state = shared, sleepMs = 0) {
    const jobs = Array.isArray(state.jobs) ? state.jobs : []
    const index = Number(state.job_index || 0)
    const allRows = [
      ...(Array.isArray(state.result_rows) ? state.result_rows : []),
      ...(Array.isArray(currentRows) ? currentRows : []),
    ]
    const nextIndex = index + 1
    const nextJob = jobs[nextIndex] || null
    const baseShared = cleanJobRuntimeState(state, allRows)
    if (!nextJob) {
      return complete(allRows, {
        ...baseShared,
        job_index: nextIndex,
        current_exec_no: jobs.length || state.total_rows || allRows.length,
        current_buyer_id: '',
        current_store: '全部任务完成',
      })
    }
    return nextPhase('prepare_job', sleepMs, {
      ...baseShared,
      job_index: nextIndex,
      current_exec_no: nextIndex + 1,
      current_buyer_id: nextJob.item_id,
      current_store: nextJob.cloud_path || '',
    })
  }

  function exposeHelpers() {
    if (!testExports || typeof testExports !== 'object') return
    Object.assign(testExports, {
      parseCloudPath,
      normalizePackagingJob,
      normalizePackagingJobs,
      deriveJobCloudPath,
      normalizeExecuteMode,
      isTmallUploadMode,
      isFullPublishMode,
      normalizeItemId,
      merchantCodeMatchesStyle,
      buildFolderHashRoute,
      buildSearchHashRoute,
      isCloudMountRouteActive,
      parseDimensionFromText,
      ratioName,
      inferAssetHints,
      pcDetailAssetScore,
      classifyPackagingAssets,
      buildPackageFilename,
      buildRuntimeFilename,
      buildPcDetailHtml,
      flattenModularDescImages,
      classifyOcrAnchorText,
      buildPcDetailVisualAnchorsFromOcrResults,
      mergePcDetailVisualFallbackAnchors,
      tesseractRuntimeConfig,
      buildAnchoredPcDetailModules,
      buildAnchoredPcDetailHtml,
      parseNewDescTemplateContent,
      flattenNewDescPicComponents,
      summarizeNewDescTemplate,
      shouldFallbackAggregateNewDescToLegacy,
      buildAnchoredNewDescTemplateContent,
      buildTmallComponentValues,
      buildTmallSubmitPayload,
      apiResponseHasErrors,
      apiResponseLooksSuccessful,
      resolveTmallCatId,
      DOWNLOAD_PACKAGE_FOLDER_LABELS,
      extractPcDetailUrlsFromModules,
      extractPcDetailUrlsFromHtml,
      pcDetailUrlsFromSource,
      collectRemoteImageUrls,
	      missingImageUrls,
	      expectedPcDetailUrlsFromShared,
	      verifyPublishedDetailReadback,
	      buildWapDescDetailFromUrls,
	      parseWapDescImageEntries,
	      cleanWapDescDuplicateImages,
	      cleanNativeDetailDuplicateImages,
	      cleanDuplicateShenbiMobileImages,
	      detectPcDetailAlreadyMatchesUpload,
	      buildShenbiMobileValueFromPcUrls,
	      buildShenbiMobileValueFromPcModules,
      resolvePackagingSourceConfig,
      collectPackagingAssets,
      validateInjectedAsset,
      uploadFileToTmall,
      blockingUploadFailureRows,
	      shouldAllowLegacyCountPcDetailReplace,
	      isUnsafeNewDescCountFallbackProbe,
	      finalizeRows,
      mobileEditorSignals,
      cleanupMobileEditorImportedCanvas,
      tmallTimingConfig,
    })
  }

  exposeHelpers()

  if (phase === '__exports__') {
    return complete([], shared)
  }

  try {
    if (phase === 'init' || phase === 'main') {
      if (!/^https:\/\/fmp\.semirapp\.com\//i.test(location.href)) {
        location.href = SEMIR_ENTRY_URL
        return nextPhase('init', 2000, shared)
      }
      let normalized
      try {
        normalized = normalizePackagingJobs(params)
      } catch (error) {
        throw new Error('请上传包含“款号”“天猫商品ID”的 Excel / CSV')
      }
      if (!normalized.jobs.length) {
        if (normalized.invalidRows.length) {
          return complete(normalized.invalidRows, {
            jobs: [],
            job_index: 0,
            result_rows: normalized.invalidRows,
            total_rows: normalized.inputCount || normalized.invalidRows.length,
            current_exec_no: normalized.inputCount || normalized.invalidRows.length,
            current_buyer_id: '',
            current_store: '表格参数错误',
          })
        }
        throw new Error('Excel 中未读取到有效任务行')
      }
      return nextPhase('prepare_job', 0, {
        jobs: normalized.jobs,
        job_index: 0,
        global_cloud_path: params.cloud_path || '',
        result_rows: normalized.invalidRows,
        current_result_rows: [],
        pending_download_items: [],
        total_rows: Math.max(normalized.inputCount || 0, normalized.jobs.length + normalized.invalidRows.length),
        current_exec_no: 1,
        current_buyer_id: normalized.jobs[0]?.item_id || '',
        current_store: normalized.jobs[0]?.cloud_path || '',
      })
    }

    if (phase === 'prepare_job') {
      if (!/^https:\/\/fmp\.semirapp\.com\//i.test(location.href)) {
        location.href = SEMIR_ENTRY_URL
        return nextPhase('prepare_job', 2000, shared)
      }

      const { jobs, index, job } = currentJobFromShared(shared)
      if (!job) {
        const rows = Array.isArray(shared.result_rows) ? shared.result_rows : []
        return complete(rows, shared)
      }

      const cloudConfig = parseCloudPath(job.cloud_path || deriveJobCloudPath(shared.global_cloud_path, job.style_code))
      const sourceConfig = await resolvePackagingSourceConfig(cloudConfig, job)
      return nextPhase('ensure_cloud_folder', 0, {
        ...clearSemirLoginWaitState(shared),
        current_job: job,
        mount_id: sourceConfig.mountId,
        mount_name: sourceConfig.mountName,
        cloud_path: sourceConfig.rawPath,
        relative_path: sourceConfig.relativePath,
        candidate_sources: sourceConfig.candidateSources || [],
        source_warning: sourceConfig.sourceWarning,
        mount_hash: buildFolderHashRoute(sourceConfig.mountId, ''),
        folder_hash: buildFolderHashRoute(sourceConfig.mountId, sourceConfig.relativePath),
        search_hash: buildSearchHashRoute(sourceConfig.mountId, job.style_code),
        current_result_rows: [],
        pending_download_items: [],
        current_exec_no: index + 1,
        current_buyer_id: job.item_id,
        current_store: sourceConfig.relativePath,
        total_rows: shared.total_rows || jobs.length,
      })
    }

    if (phase === 'ensure_cloud_folder') {
      const mountHash = String(shared.mount_hash || buildFolderHashRoute(shared.mount_id, ''))
      if (mountHash && location.hash !== mountHash && !isCloudMountRouteActive(shared.mount_id)) {
        location.hash = mountHash
        return nextPhase('ensure_cloud_folder', 1500, {
          ...shared,
          cloud_mount_activated: false,
          current_store: `切换到森马云盘库：${shared.mount_name || shared.mount_id}`,
        })
      }

      const tabActive = isCloudMountTabActive(shared.mount_name || '')
      if (!tabActive && !shared.cloud_mount_tab_clicked) {
        const clicked = clickCloudMountTabByName(shared.mount_name || '')
        return nextPhase('ensure_cloud_folder', 1500, {
          ...shared,
          cloud_mount_activated: false,
          cloud_mount_tab_clicked: clicked.ok,
          current_store: clicked.ok
            ? `点击森马云盘库：${clicked.text || shared.mount_name || shared.mount_id}`
            : `等待森马云盘库切换：${shared.mount_name || shared.mount_id}`,
        })
      }

      if (!isCloudMountRouteActive(shared.mount_id)) {
        return nextPhase('ensure_cloud_folder', 1000, {
          ...shared,
          cloud_mount_activated: false,
          current_store: `等待森马云盘库切换：${shared.mount_name || shared.mount_id}`,
        })
      }

      return nextPhase('ensure_cloud_search', 0, {
        ...shared,
        cloud_mount_activated: true,
        current_store: `已选中森马云盘库：${shared.mount_name || shared.mount_id}`,
      })
    }

    if (phase === 'ensure_cloud_search') {
      if (!isCloudMountRouteActive(shared.mount_id)) {
        return nextPhase('ensure_cloud_folder', 0, {
          ...shared,
          cloud_mount_activated: false,
        })
      }
      const job = shared.current_job || currentJobFromShared(shared).job || {}
      const targetHash = String(shared.search_hash || buildSearchHashRoute(shared.mount_id, job.style_code))
      if (targetHash && location.hash !== targetHash) {
        location.hash = targetHash
        return nextPhase('collect_cloud_assets', 1500, {
          ...shared,
          search_hash: targetHash,
          current_store: `搜索森马云盘款号：${job.style_code || ''}`,
        })
      }
      return nextPhase('collect_cloud_assets', 0, {
        ...shared,
        search_hash: targetHash,
      })
    }

    if (phase === 'collect_cloud_assets') {
      const job = shared.current_job || currentJobFromShared(shared).job || {}
      const plan = await buildPackagingDownloadPlan(job, {
        mountId: shared.mount_id,
        mountName: shared.mount_name,
        relativePath: shared.relative_path,
        rawPath: shared.cloud_path,
        candidateSources: shared.candidate_sources || [],
      })
      const planWarnings = Array.isArray(plan.plan?.warnings) ? plan.plan.warnings.filter(Boolean) : []
      const leadingWarnings = [shared.source_warning, ...planWarnings].filter(Boolean)
      const rows = leadingWarnings.length && plan.rows.length
        ? plan.rows.map((row, index) => index === 0 ? appendRowNote(row, leadingWarnings.join('；')) : row)
        : plan.rows
      const nextShared = {
        ...clearSemirLoginWaitState(shared),
        current_result_rows: rows,
        pending_download_items: plan.downloadItems,
        plan_summary: {
          total: plan.plan.total,
          selected: plan.plan.selected,
          missing: plan.plan.missing,
          warnings: planWarnings,
          pcDetailDedupedCount: plan.plan.pcDetailDedupedCount || 0,
          searchCount: plan.plan.searchCount,
          folderCount: plan.plan.folderCount,
          selectedStyleRoot: plan.plan.selectedStyleRoot,
        },
      }
      if (!plan.downloadItems.length) return advanceToNextJob(rows, nextShared)
      return downloadUrls(
        plan.downloadItems,
        'after_download',
        {
          shared_key: 'last_download_result',
          strict: false,
          concurrency: DOWNLOAD_CONCURRENCY,
          retry_attempts: DOWNLOAD_RETRY_ATTEMPTS,
          retry_delay_ms: DOWNLOAD_RETRY_DELAY_MS,
        },
        nextShared,
      )
    }

    if (phase === 'after_download') {
      const rows = finalizeRows(shared.current_result_rows, shared.last_download_result)
      const nextShared = {
        ...shared,
        current_result_rows: rows,
        pending_download_items: [],
      }
      if (!isTmallUploadMode(shared.current_job?.execute_mode)) return advanceToNextJob(rows, nextShared)
      const downloaded = successfulRows(rows)
      if (!downloaded.length) return advanceToNextJob(rows, nextShared)
      return nextPhase('navigate_tmall', 0, nextShared)
    }

    if (phase === 'navigate_tmall') {
      const itemId = shared.current_job?.item_id || ''
      const targetUrl = `${TMALL_PUBLISH_URL}?id=${encodeURIComponent(itemId)}`
      if (!location.href.startsWith(TMALL_PUBLISH_URL)) {
        location.href = targetUrl
        return nextPhase('wait_tmall_ready', TMALL_PAGE_WAIT_MS, { ...shared, tmall_wait_attempts: 0 })
      }
      if (!location.href.includes(`id=${itemId}`)) {
        location.href = targetUrl
        return nextPhase('wait_tmall_ready', TMALL_PAGE_WAIT_MS, { ...shared, tmall_wait_attempts: 0 })
      }
      return nextPhase('wait_tmall_ready', 0, shared)
    }

    if (phase === 'wait_tmall_ready') {
      const job = shared.current_job || {}
      const status = extractTmallStatus(job)
      if (!status.ready) {
        const attempts = Number(shared.tmall_wait_attempts || 0)
        if (attempts < 30) {
          return nextPhase('wait_tmall_ready', TMALL_PAGE_WAIT_MS, {
            ...shared,
            tmall_wait_attempts: attempts + 1,
            current_store: `等待天猫编辑页 ${attempts + 1}/30`,
          })
        }
        const rows = buildOutputStatusRows(shared.current_result_rows, status, '天猫编辑页未就绪')
        return advanceToNextJob(rows, { ...shared, current_result_rows: rows, tmall_status: status })
      }
      const legacyPcDetailHtml = getLegacyPcDetailHtml()
      const newDescValue = getNewDescValue()
      const newDescTemplateAvailable = hasUsableNewDescTemplate(newDescValue)
      const returnOldSwitch = findReturnOldDescriptionSwitch()
      const legacyProbeBeforeSwitch = legacyPcDetailReplacementProbe({
        allowLegacyCountImageReplace: shouldAllowLegacyCountPcDetailReplace(shared.current_result_rows, job),
      })
      if (returnOldSwitch && shouldWaitForAggregateNewDescHydration(newDescValue, shared)) {
        return waitForAggregateNewDescHydration(shared, {
          tmall_status: status,
        })
      }
      const aggregateNewDescNeedsLegacy = !!returnOldSwitch &&
        !shared.prefer_legacy_pc_detail &&
        shouldFallbackAggregateNewDescToLegacy(newDescValue)
      const legacyFallbackPending = !!(shared.prefer_legacy_pc_detail || shared.new_desc_aggregate_legacy_fallback || aggregateNewDescNeedsLegacy)
      const returnOldConfirm = findReturnOldDescriptionConfirmElement()
      if (returnOldConfirm && legacyFallbackPending) {
        const confirmAttempts = Number(shared.return_old_confirm_attempts || 0)
        if (confirmAttempts < 1) {
          const nextShared = {
            ...shared,
            prefer_legacy_pc_detail: true,
            return_old_confirm_attempts: confirmAttempts + 1,
            return_old_confirm_wait_attempts: 0,
            current_store: '确认切回旧版图文描述',
          }
          const cdpClick = cdpClickElement(returnOldConfirm, 'wait_tmall_ready', 2000, nextShared)
          if (cdpClick) return cdpClick
          if (smartClick(returnOldConfirm)) {
            return nextPhase('wait_tmall_ready', TMALL_PAGE_WAIT_MS, nextShared)
          }
        }
        const waitAttempts = Number(shared.return_old_confirm_wait_attempts || 0)
        if (waitAttempts < 6) {
          return nextPhase('wait_tmall_ready', TMALL_PAGE_WAIT_MS, {
            ...shared,
            prefer_legacy_pc_detail: true,
            return_old_confirm_wait_attempts: waitAttempts + 1,
            current_store: `等待切回旧版确认弹窗关闭 ${waitAttempts + 1}/6`,
          })
        }
        return failCurrentJob('切回旧版图文描述确认弹窗未关闭，已阻止继续发布', '预检阻止')
      }
      if (returnOldSwitch && (shared.prefer_legacy_pc_detail || aggregateNewDescNeedsLegacy)) {
        const attempts = Number(shared.legacy_switch_attempts || 0)
        if (attempts < 5) {
          const reason = aggregateNewDescNeedsLegacy
            ? aggregateNewDescLegacyFallbackLabel(newDescValue)
            : '切回旧版图文描述'
          const nextShared = {
            ...shared,
            prefer_legacy_pc_detail: true,
            legacy_switch_attempts: attempts + 1,
            legacy_wait_attempts: 0,
            pc_detail_ocr_attempted: false,
            new_desc_aggregate_legacy_fallback: !!(shared.new_desc_aggregate_legacy_fallback || aggregateNewDescNeedsLegacy),
            current_store: `${reason}，切回旧版图文描述 ${attempts + 1}/5`,
          }
          const cdpClick = cdpClickElement(returnOldSwitch, 'wait_tmall_ready', 2500, nextShared)
          if (cdpClick) return cdpClick
          if (clickReturnOldDescriptionSwitch()) {
            return nextPhase('wait_tmall_ready', TMALL_PAGE_WAIT_MS, nextShared)
          }
        }
        return failCurrentJob('已决定走旧版图文描述，但页面仍停留在新版详情，未能切回旧版，已阻止继续发布', '预检阻止')
      }
      if (returnOldSwitch && !legacyProbeBeforeSwitch && (!newDescTemplateAvailable || shared.prefer_legacy_pc_detail)) {
        const attempts = Number(shared.legacy_switch_attempts || 0)
        if (attempts < 5) {
          const nextShared = {
            ...shared,
            prefer_legacy_pc_detail: true,
            legacy_switch_attempts: attempts + 1,
            current_store: `切回旧版图文描述 ${attempts + 1}/5`,
          }
          const cdpClick = cdpClickElement(returnOldSwitch, 'wait_tmall_ready', 2500, nextShared)
          if (cdpClick) return cdpClick
          if (clickReturnOldDescriptionSwitch()) {
            return nextPhase('wait_tmall_ready', TMALL_PAGE_WAIT_MS, nextShared)
          }
        }
        return failCurrentJob('检测到新版商详页，但未能切回“旧版图文描述”，已阻止继续写入和发布', '预检阻止')
      }
      if (shared.prefer_legacy_pc_detail && !legacyProbeBeforeSwitch) {
        const attempts = Number(shared.legacy_wait_attempts || 0)
        if (attempts < 10) {
          return nextPhase('wait_tmall_ready', TMALL_PAGE_WAIT_MS, {
            ...shared,
            legacy_wait_attempts: attempts + 1,
            current_store: `等待旧版图文描述加载 ${attempts + 1}/10`,
          })
        }
        return failCurrentJob('新版详情仅有1-2张图且OCR识别失败，已尝试切回旧版，但未读到旧版PC详情，已阻止继续发布', '预检阻止')
      }
      if (job.block_on_style_mismatch && status.merchantCode && job.style_code && !merchantCodeMatchesStyle(status.merchantCode, job.style_code)) {
        const rows = markRowsBlockedBeforeUpload(
          shared.current_result_rows,
          status,
          '商家编码不一致',
          `已阻止上传：页面商家编码 ${status.merchantCode} 与云盘款号 ${job.style_code} 不一致`,
        )
        return advanceToNextJob(rows, { ...shared, current_result_rows: rows, tmall_status: status })
      }
      if (hasDownloadedPcDetailRows(shared.current_result_rows)) {
        const allowLegacyCountImageReplace = shouldAllowLegacyCountPcDetailReplace(shared.current_result_rows, job)
        const replacementProbe = currentPcDetailReplacementProbe({
          visualAnchors: shared.pc_detail_visual_anchors,
          requireVisualAnchors: !!shared.pc_detail_ocr_attempted,
          allowLegacyCountImageReplace,
          legacyCountDetailImageCount: downloadedPcDetailRowCount(shared.current_result_rows),
          preferLegacyPcDetail: !!shared.prefer_legacy_pc_detail,
        })
        if (!shared.pc_detail_ocr_attempted) {
          return nextPhase('detect_pc_detail_ocr_anchors', 0, {
            ...shared,
            tmall_status: status,
            pc_detail_replacement_probe: replacementProbe,
            pc_detail_ocr_attempted: true,
            pc_detail_allow_legacy_count_replace: allowLegacyCountImageReplace,
            current_store: 'OCR识别PC详情锚点',
          })
        }
        const unsafeNewDescCountFallback = isUnsafeNewDescCountFallbackProbe(replacementProbe)
        if (!replacementProbe.ok || unsafeNewDescCountFallback) {
          const rows = markRowsBlockedBeforeUpload(
            shared.current_result_rows,
            status,
            '预检阻止',
            unsafeNewDescCountFallback
              ? '新版详情未识别到“想要的信息看这里/尺码/洗涤”等可靠下半区锚点，且页面存在明显尾部固定信息区，已阻止按数量兜底替换'
              : (replacementProbe.note || 'PC详情锚点未识别，已阻止自动替换'),
          )
          return advanceToNextJob(rows, {
            ...shared,
            current_result_rows: rows,
            tmall_status: status,
            pc_detail_replacement_probe: replacementProbe,
          })
        }
      }
      return nextPhase('inject_local_files', 0, { ...shared, tmall_status: status })
    }

    if (phase === 'detect_pc_detail_ocr_anchors') {
      const job = shared.current_job || {}
      const status = extractTmallStatus(job)
      if (!status.ready) {
        return nextPhase('wait_tmall_ready', TMALL_PAGE_WAIT_MS, {
          ...shared,
          tmall_status: status,
          current_store: '等待天猫编辑页恢复后再OCR',
        })
      }
      const returnOldSwitchBeforeOcr = findReturnOldDescriptionSwitch()
      const newDescValueBeforeOcr = getNewDescValue()
      if (returnOldSwitchBeforeOcr && shouldWaitForAggregateNewDescHydration(newDescValueBeforeOcr, shared)) {
        return waitForAggregateNewDescHydration(shared, {
          tmall_status: status,
          pc_detail_ocr_attempted: false,
          pc_detail_visual_anchors: null,
        })
      }
      const aggregateNewDescNeedsLegacyBeforeOcr = !!returnOldSwitchBeforeOcr &&
        !shared.prefer_legacy_pc_detail &&
        shouldFallbackAggregateNewDescToLegacy(newDescValueBeforeOcr)
      const legacyFallbackPendingBeforeOcr = !!(shared.prefer_legacy_pc_detail || shared.new_desc_aggregate_legacy_fallback || aggregateNewDescNeedsLegacyBeforeOcr)
      const returnOldConfirmBeforeOcr = findReturnOldDescriptionConfirmElement()
      if (returnOldConfirmBeforeOcr && legacyFallbackPendingBeforeOcr) {
        const confirmAttempts = Number(shared.return_old_confirm_attempts || 0)
        if (confirmAttempts < 1) {
          const nextShared = {
            ...shared,
            tmall_status: status,
            prefer_legacy_pc_detail: true,
            return_old_confirm_attempts: confirmAttempts + 1,
            return_old_confirm_wait_attempts: 0,
            pc_detail_ocr_attempted: false,
            current_store: '确认切回旧版图文描述',
          }
          const cdpClick = cdpClickElement(returnOldConfirmBeforeOcr, 'wait_tmall_ready', 2000, nextShared)
          if (cdpClick) return cdpClick
          if (smartClick(returnOldConfirmBeforeOcr)) {
            return nextPhase('wait_tmall_ready', TMALL_PAGE_WAIT_MS, nextShared)
          }
        }
        const waitAttempts = Number(shared.return_old_confirm_wait_attempts || 0)
        if (waitAttempts < 6) {
          return nextPhase('wait_tmall_ready', TMALL_PAGE_WAIT_MS, {
            ...shared,
            tmall_status: status,
            prefer_legacy_pc_detail: true,
            return_old_confirm_wait_attempts: waitAttempts + 1,
            pc_detail_ocr_attempted: false,
            current_store: `等待切回旧版确认弹窗关闭 ${waitAttempts + 1}/6`,
          })
        }
        return failCurrentJob('切回旧版图文描述确认弹窗未关闭，已阻止继续发布', '预检阻止')
      }
      if (returnOldSwitchBeforeOcr && (shared.prefer_legacy_pc_detail || aggregateNewDescNeedsLegacyBeforeOcr)) {
        const attempts = Number(shared.legacy_switch_attempts || 0)
        if (attempts < 5) {
          const reason = aggregateNewDescNeedsLegacyBeforeOcr
            ? aggregateNewDescLegacyFallbackLabel(newDescValueBeforeOcr)
            : '切回旧版图文描述'
          const nextShared = {
            ...shared,
            tmall_status: status,
            prefer_legacy_pc_detail: true,
            legacy_switch_attempts: attempts + 1,
            legacy_wait_attempts: 0,
            pc_detail_ocr_attempted: false,
            pc_detail_visual_anchors: null,
            new_desc_aggregate_legacy_fallback: !!(shared.new_desc_aggregate_legacy_fallback || aggregateNewDescNeedsLegacyBeforeOcr),
            current_store: `${reason}，切回旧版图文描述 ${attempts + 1}/5`,
          }
          const cdpClick = cdpClickElement(returnOldSwitchBeforeOcr, 'wait_tmall_ready', 2500, nextShared)
          if (cdpClick) return cdpClick
          if (clickReturnOldDescriptionSwitch()) {
            return nextPhase('wait_tmall_ready', TMALL_PAGE_WAIT_MS, nextShared)
          }
        }
        return failCurrentJob('已决定走旧版图文描述，但页面仍停留在新版详情，未能切回旧版，已阻止继续发布', '预检阻止')
      }
      const allowLegacyCountImageReplace = shouldAllowLegacyCountPcDetailReplace(shared.current_result_rows, job) ||
        !!shared.pc_detail_allow_legacy_count_replace
      const detected = await detectPcDetailOcrAnchors(params, {
        allowLegacyCountImageReplace,
        legacyCountDetailImageCount: downloadedPcDetailRowCount(shared.current_result_rows),
        preferLegacyPcDetail: !!shared.prefer_legacy_pc_detail,
      })
      const ocrSummary = {
        ok: detected.ok,
        reason: detected.reason || '',
        target: detected.source?.target || '',
        scanned: detected.ocr?.scanned || 0,
        anchors: detected.anchors || {},
        probeMode: detected.probe?.mode || '',
        probeNote: detected.probe?.note || '',
      }
      const unsafeDetectedNewDescCountFallback = isUnsafeNewDescCountFallbackProbe(detected.probe)
      if (detected.ok && !unsafeDetectedNewDescCountFallback) {
        return nextPhase('inject_local_files', 0, {
          ...shared,
          tmall_status: status,
          pc_detail_visual_anchors: detected.anchors,
          pc_detail_ocr_result: ocrSummary,
          pc_detail_replacement_probe: detected.probe,
          pc_detail_allow_legacy_count_replace: allowLegacyCountImageReplace,
          current_store: 'OCR锚点已识别，开始上传图片',
        })
      }
      if (isSparseNewDescOcrFailure(detected)) {
        const returnOldSwitch = findReturnOldDescriptionSwitch()
        const attempts = Number(shared.legacy_switch_attempts || 0)
        if (returnOldSwitch && attempts < 5) {
          const nextShared = {
            ...shared,
            tmall_status: status,
            prefer_legacy_pc_detail: true,
            legacy_switch_attempts: attempts + 1,
            legacy_wait_attempts: 0,
            pc_detail_visual_anchors: null,
            pc_detail_ocr_result: ocrSummary,
            pc_detail_replacement_probe: detected.probe || shared.pc_detail_replacement_probe,
            pc_detail_ocr_attempted: false,
            pc_detail_allow_legacy_count_replace: allowLegacyCountImageReplace,
            new_desc_sparse_ocr_fallback: true,
            current_store: `新版详情仅${detected.images.length}张图且OCR失败，切回旧版图文描述 ${attempts + 1}/5`,
          }
          const cdpClick = cdpClickElement(returnOldSwitch, 'wait_tmall_ready', 2500, nextShared)
          if (cdpClick) return cdpClick
          if (clickReturnOldDescriptionSwitch()) {
            return nextPhase('wait_tmall_ready', TMALL_PAGE_WAIT_MS, nextShared)
          }
        }
        return failCurrentJob('新版详情仅有1-2张图且OCR识别失败，但未能切回旧版图文描述，已阻止继续发布', '预检阻止')
      }
      if (shared.pc_detail_replacement_probe?.ok && !isUnsafeNewDescCountFallbackProbe(shared.pc_detail_replacement_probe)) {
        return nextPhase('inject_local_files', 0, {
          ...shared,
          tmall_status: status,
          pc_detail_ocr_result: ocrSummary,
          pc_detail_replacement_probe: shared.pc_detail_replacement_probe,
          pc_detail_structure_anchor_fallback: true,
          pc_detail_allow_legacy_count_replace: allowLegacyCountImageReplace,
          current_store: 'OCR未识别锚点，使用页面结构锚点继续上传',
        })
      }
      const note = compact([
        'OCR未识别到可靠PC详情锚点，已阻止自动替换',
        unsafeDetectedNewDescCountFallback
          ? '新版详情存在明显尾部固定信息区，不能按产品包装图数量兜底替换'
          : '',
        detected.reason,
      ].filter(Boolean).join('；'))
      const rows = markRowsBlockedBeforeUpload(
        shared.current_result_rows,
        status,
        '预检阻止',
        note,
      )
      return advanceToNextJob(rows, {
        ...shared,
        current_result_rows: rows,
        tmall_status: status,
        pc_detail_ocr_result: ocrSummary,
        pc_detail_replacement_probe: detected.probe || shared.pc_detail_replacement_probe,
        pc_detail_allow_legacy_count_replace: allowLegacyCountImageReplace,
      })
    }

    if (phase === 'inject_local_files') {
      const rows = successfulRows(shared.current_result_rows)
      const files = rows.map(row => row['本地文件']).filter(Boolean)
      if (!files.length) return advanceToNextJob(shared.current_result_rows, shared)
      ensureUploadInput()
      return injectFiles(
        [{ selector: UPLOAD_INPUT_SELECTOR, files }],
        'upload_to_tmall',
        800,
        {
          ...shared,
          injected_file_paths: files,
        },
      )
    }

    if (phase === 'upload_to_tmall') {
      const downloaded = successfulRows(shared.current_result_rows)
      const files = fileListFromInput()
      if (files.length < downloaded.length) {
        const rows = shared.current_result_rows.map(row => row['下载结果'] === '已下载'
          ? { ...row, '上传结果': '文件注入失败', '执行结果': '文件注入失败', '备注': compact([row['备注'], `仅注入 ${files.length}/${downloaded.length} 个文件`].filter(Boolean).join('；')) }
          : row)
        return advanceToNextJob(rows, { ...shared, current_result_rows: rows })
      }

      const uploadedRows = []
      const uploadedByCategory = Object.fromEntries(CATEGORY_ORDER.map(category => [category, []]))
      for (let index = 0; index < downloaded.length; index += 1) {
        const row = downloaded[index]
        const file = files[index]
        const dimensions = await loadImageDimensions(file)
        const validation = validateInjectedAsset(row, dimensions)
        if (validation) {
          uploadedRows.push({
            ...row,
            '上传结果': '已跳过',
            '执行结果': '尺寸校验失败',
            '备注': compact([row['备注'], validation].filter(Boolean).join('；')),
          })
          continue
        }
        try {
          const url = await uploadFileToTmall(file, row.__category)
          uploadedRows.push({
            ...row,
            '上传结果': '已上传',
            '天猫图片URL': url,
            '执行结果': '已上传',
            '备注': row['备注'] || '',
          })
          uploadedByCategory[row.__category].push({
            row,
            url,
            width: dimensions.width,
            height: dimensions.height,
            size: file?.size || 0,
            pix: dimensions.width && dimensions.height ? `${dimensions.width}x${dimensions.height}` : '',
          })
        } catch (error) {
          uploadedRows.push({
            ...row,
            '上传结果': '上传失败',
            '执行结果': '上传失败',
            '备注': compact([row['备注'], String(error?.message || error)].filter(Boolean).join('；')),
          })
        }
        if (TMALL_UPLOAD_BETWEEN_FILES_MS > 0 && index < downloaded.length - 1) {
          await waitMs(TMALL_UPLOAD_BETWEEN_FILES_MS)
        }
      }

      const uploadedByPath = new Map(uploadedRows.map(row => [row['本地文件'], row]))
      const rows = shared.current_result_rows.map(row => uploadedByPath.get(row['本地文件']) || row)
      const uploadFailures = blockingUploadFailureRows(rows)
      if (uploadFailures.length) {
        const status = extractTmallStatus(shared.current_job || {})
        const sample = uploadFailures.slice(0, 3)
          .map(row => `${CATEGORY_LABELS[row.__category] || row.__category || '图片'}:${row['文件名'] || row['本地文件'] || row['备注'] || '未知文件'}`)
          .join('；')
        const failedRows = rows.map(row => appendRowNote(row, `上传阶段失败 ${uploadFailures.length} 张，已阻止写入和发布${sample ? `：${sample}` : ''}`))
        return advanceToNextJob(failedRows, {
          ...shared,
          current_result_rows: failedRows,
          tmall_status_after_failure: status,
          uploaded_by_category: uploadedByCategory,
        })
      }
      return nextPhase('apply_tmall_draft', 0, {
        ...shared,
        current_result_rows: rows,
        uploaded_by_category: uploadedByCategory,
      })
    }

	    if (phase === 'apply_tmall_draft') {
	      const uploadedByCategory = shared.uploaded_by_category || {}
	      const currentDraftValues = {
	        mainImagesGroup: getComponentValue('mainImagesGroup'),
	        threeToFourImages: getComponentValue('threeToFourImages'),
	        guideImageGroup: getComponentValue('guideImageGroup'),
	        descRepublicOfSell: getNewDescValue(),
	        descForShenbiPc: getComponentValue('descForShenbiPc'),
        modularDesc: getComponentValue('modularDesc'),
        tmDescription: getLegacyPcDetailHtml(),
        modularDescVisible: componentVisible('modularDesc'),
        descForShenbiPcVisible: componentVisible('descForShenbiPc'),
        pcDetailVisualAnchors: shared.pc_detail_visual_anchors,
        requirePcDetailVisualAnchors: hasDownloadedPcDetailRows(shared.current_result_rows) && !shared.pc_detail_structure_anchor_fallback,
	        allowLegacyCountPcDetailReplace: shouldAllowLegacyCountPcDetailReplace(shared.current_result_rows, shared.current_job || {}) ||
	          !!shared.pc_detail_allow_legacy_count_replace,
	        preferLegacyPcDetail: !!shared.prefer_legacy_pc_detail,
	      }
	      let componentValues = buildTmallComponentValues(uploadedByCategory, currentDraftValues)
	      const pcReplacementBlocked = componentValues.pcDetailReplacement?.ok === false
	      if (pcReplacementBlocked) {
        const afterStatus = extractTmallStatus(shared.current_job || {})
        const rows = markRowsWithResult(
          shared.current_result_rows,
          afterStatus,
          '预检阻止',
          componentValues.pcDetailReplacement?.note || 'PC详情锚点区间未通过预检，已阻止写入和发布',
        )
        return advanceToNextJob(rows, {
          ...shared,
          current_result_rows: rows,
          tmall_status_after_apply: afterStatus,
          applied_components: {},
	          applied_modular_desc: getComponentValue('modularDesc'),
	        })
	      }
	      let pcDetailAlreadyMatch = null
	      if (
	        parseBoolean(params.enable_pc_detail_already_match_skip, true) &&
	        hasDownloadedPcDetailRows(shared.current_result_rows) &&
	        componentValues.pcDetailReplacement?.ok &&
	        !componentValues.pcDetailReplacement?.skippedBecauseAlreadyMatches
	      ) {
	        pcDetailAlreadyMatch = await detectPcDetailAlreadyMatchesUpload(
	          componentValues.pcDetailReplacement,
	          uploadedByCategory.pc_detail || [],
	          params,
	        )
	        if (pcDetailAlreadyMatch.matched) {
	          componentValues = markPcDetailReplacementSkipped(componentValues, currentDraftValues, pcDetailAlreadyMatch)
	        }
	        if (
	          componentValues.pcDetailReplacement?.requiresAlreadyMatch &&
	          !pcDetailAlreadyMatch.matched &&
	          !pcDetailAlreadyMatch.duplicateCleanup
	        ) {
	          const afterStatus = extractTmallStatus(shared.current_job || {})
	          const rows = markRowsWithResult(
	            shared.current_result_rows,
	            afterStatus,
	            '预检阻止',
	            pcDetailAlreadyMatch.reason || '当前PC详情无可靠下半区锚点，且与本次素材不一致，已阻止自动替换',
	          )
	          return advanceToNextJob(rows, {
	            ...shared,
	            current_result_rows: rows,
	            tmall_status_after_apply: afterStatus,
	            pc_detail_already_match: pcDetailAlreadyMatch,
	            pc_detail_replacement_probe: componentValues.pcDetailReplacement,
	            applied_components: {},
	            applied_modular_desc: getComponentValue('modularDesc'),
	          })
	        }
	      }
	      const applied = {
	        mainImagesGroup: applyComponentValue('mainImagesGroup', componentValues.mainImagesGroup),
        threeToFourImages: applyComponentValue('threeToFourImages', componentValues.threeToFourImages),
        guideImageGroup: applyComponentValue('guideImageGroup', componentValues.guideImageGroup),
        descType: applyFormValue('descType', componentValues.descType),
        descRepublicOfSell: applyFormValue('descRepublicOfSell', componentValues.descRepublicOfSell),
        descForShenbiPc: applyFormValue('descForShenbiPc', componentValues.descForShenbiPc),
        modularDesc: applyComponentValue('modularDesc', componentValues.modularDesc),
        tmDescription: applyFormValue('tmDescription', componentValues.tmDescription),
      }
      if (componentValues.tmDescription !== undefined) {
        applied.tmDescriptionDom = applyLegacyPcDetailDom(componentValues.tmDescription)
      }
      const fullPublishMode = isFullPublishMode(shared.current_job?.execute_mode)
      if (fullPublishMode && componentValues.descRepublicOfSell !== undefined) {
        applied.descRepublicOfSellCommit = await commitNewDescByApi(componentValues.descRepublicOfSell, 15000)
        if (!applied.descRepublicOfSellCommit.ok) {
          const returnOldSwitch = findReturnOldDescriptionSwitch()
          const attempts = Number(shared.legacy_switch_attempts || 0)
          if (returnOldSwitch && attempts < 5) {
            const nextShared = {
              ...shared,
              prefer_legacy_pc_detail: true,
              legacy_switch_attempts: attempts + 1,
              legacy_wait_attempts: 0,
              pc_detail_visual_anchors: null,
              pc_detail_replacement_probe: null,
              pc_detail_ocr_attempted: false,
              new_desc_aggregate_legacy_fallback: true,
              current_store: `新版详情接口保存失败（${applied.descRepublicOfSellCommit.reason || '未知原因'}），切回旧版图文描述 ${attempts + 1}/5`,
            }
            const cdpClick = cdpClickElement(returnOldSwitch, 'wait_tmall_ready', 2500, nextShared)
            if (cdpClick) return cdpClick
            if (clickReturnOldDescriptionSwitch()) {
              return nextPhase('wait_tmall_ready', TMALL_PAGE_WAIT_MS, nextShared)
            }
          }
        }
      }
      const afterStatus = extractTmallStatus(shared.current_job || {})
      const componentApplyNote = Object.entries(applied)
        .filter(([, result]) => result && result.ok === false)
        .map(([name, result]) => `${name}:${result.reason}`)
        .join('；')
      const hasApplyFailure = Object.values(applied).some(result => result && result.ok === false)
	      const replacementNote = componentValues.pcDetailReplacement?.mode === 'anchored_replace' || componentValues.pcDetailReplacement?.ok === false
	        ? componentValues.pcDetailReplacement?.note
	        : ''
	      const newDescCommitNote = applied.descRepublicOfSellCommit?.ok ? applied.descRepublicOfSellCommit.note : ''
	      const alreadyMatchNote = componentValues.pcDetailReplacement?.skippedBecauseAlreadyMatches
	        ? componentValues.pcDetailReplacement.note
	        : ''
	      const duplicateCleanupNote = pcDetailAlreadyMatch?.duplicateCleanup ? pcDetailAlreadyMatch.reason : ''
	      const applyNote = [componentApplyNote, replacementNote, duplicateCleanupNote, alreadyMatchNote, newDescCommitNote].filter(Boolean).join('；')
      const rows = buildOutputStatusRows(
        shared.current_result_rows,
        afterStatus,
        applyNote || '已写入天猫编辑页草稿；未点击提交发布；手机端详情仍需在页面确认导入PC详情',
      )
      const pcDetailTarget = componentValues.pcDetailReplacement?.target || ''
      if (fullPublishMode) {
        if (hasApplyFailure) {
          const failedRows = rows.map(row => ({ ...row, '执行结果': '草稿写入失败' }))
          return advanceToNextJob(failedRows, {
            ...shared,
            current_result_rows: failedRows,
            tmall_status_after_apply: afterStatus,
            applied_components: applied,
          })
        }
        const nextSubmitPhase = pcDetailTarget === 'descRepublicOfSell' ? 'submit_final_publish' : 'submit_pc_publish'
        return nextPhase(nextSubmitPhase, TMALL_PAGE_WAIT_MS, {
          ...shared,
          current_result_rows: rows,
          tmall_status_after_apply: afterStatus,
          applied_components: applied,
          applied_modular_desc: componentValues.modularDesc || componentValues.pcDetailReplacement?.modules || getComponentValue('modularDesc'),
          applied_pc_detail_html: componentValues.detailHtml || componentValues.tmDescription || getComponentValue('tmDescription') || getLegacyPcDetailHtml(),
	          applied_desc_republic_of_sell: componentValues.descRepublicOfSell || null,
	          applied_desc_for_shenbi_pc: componentValues.descForShenbiPc || null,
	          applied_desc_type: componentValues.descType || null,
	          pc_detail_target: pcDetailTarget,
          pc_detail_already_match: pcDetailAlreadyMatch,
          pc_detail_skip_replacement: !!componentValues.pcDetailReplacement?.skippedBecauseAlreadyMatches,
          publish_wait_attempts: 0,
          publish_stage: nextSubmitPhase === 'submit_final_publish' ? 'final' : 'pc',
          current_store: nextSubmitPhase === 'submit_final_publish' ? '提交新版详情发布' : '提交PC端详情发布',
        })
      }
      return advanceToNextJob(rows, {
        ...shared,
        current_result_rows: rows,
        tmall_status_after_apply: afterStatus,
        applied_components: applied,
        applied_modular_desc: componentValues.modularDesc || componentValues.pcDetailReplacement?.modules || getComponentValue('modularDesc'),
        applied_pc_detail_html: componentValues.detailHtml || componentValues.tmDescription || getComponentValue('tmDescription') || getLegacyPcDetailHtml(),
	        applied_desc_republic_of_sell: componentValues.descRepublicOfSell || null,
	        applied_desc_for_shenbi_pc: componentValues.descForShenbiPc || null,
	        applied_desc_type: componentValues.descType || null,
	        pc_detail_target: pcDetailTarget,
	        pc_detail_already_match: pcDetailAlreadyMatch,
	        pc_detail_skip_replacement: !!componentValues.pcDetailReplacement?.skippedBecauseAlreadyMatches,
	      })
	    }

    if (phase === 'submit_pc_publish' || phase === 'submit_final_publish') {
      const stage = phase === 'submit_final_publish' ? 'final' : 'pc'
      const oldDetailMobileEditorFlow = shouldUseVisualMobileEditorSync(shared)
      const shouldPreferPayloadSubmit = !oldDetailMobileEditorFlow && (
        uploadedPcDetailUrlsFromShared(shared).length > 0 ||
        !!shared.applied_desc_republic_of_sell ||
        isNewDescPcDetailTarget(shared) ||
        !!shared.mobile_sync_note
      )
      const shouldTryApiBeforeDom = TMALL_SUBMIT_MODE === 'api' || TMALL_SUBMIT_MODE === 'api_first' || shouldPreferPayloadSubmit
      if (shouldTryApiBeforeDom) {
        const apiSubmit = await submitTmallPublishByApi({
          itemId: shared.current_job?.item_id || '',
          timeoutMs: 15000,
          forceHttpPost: TMALL_SUBMIT_MODE === 'api' || (!oldDetailMobileEditorFlow && (stage === 'final' || shouldPreferPayloadSubmit)),
          allowHttpPost: !(oldDetailMobileEditorFlow && stage === 'pc' && TMALL_SUBMIT_MODE !== 'api'),
        })
        if (apiSubmit.ok) {
          return nextPhase('wait_publish_result', TMALL_PUBLISH_WAIT_MS, {
            ...shared,
            publish_stage: stage,
            submit_click_attempts: 0,
            publish_wait_attempts: 0,
            last_submit_method: apiSubmit.method,
            current_store: stage === 'pc'
              ? `等待PC端API提交发布结果：${apiSubmit.method}`
              : `等待最终API提交发布结果：${apiSubmit.method}`,
          })
        }
      }

      const clicked = clickSubmitPublishButton()
      if (clicked.ok) {
        return nextPhase('wait_publish_result', TMALL_PUBLISH_WAIT_MS, {
          ...shared,
          publish_stage: stage,
          submit_click_attempts: 0,
          publish_wait_attempts: 0,
          last_submit_method: 'dom_click',
          current_store: stage === 'pc' ? '等待PC端DOM提交发布结果' : '等待最终DOM提交发布结果',
        })
      }

      if (TMALL_ALLOW_API_SUBMIT_FALLBACK) {
        const apiSubmit = await submitTmallPublishByApi({
          itemId: shared.current_job?.item_id || '',
          timeoutMs: 15000,
          forceHttpPost: stage === 'final',
          allowHttpPost: !(oldDetailMobileEditorFlow && stage === 'pc'),
        })
        if (apiSubmit.ok) {
          return nextPhase('wait_publish_result', TMALL_PUBLISH_WAIT_MS, {
            ...shared,
            publish_stage: stage,
            submit_click_attempts: 0,
            publish_wait_attempts: 0,
            last_submit_method: apiSubmit.method,
            current_store: stage === 'pc'
              ? `等待PC端API提交发布结果：${apiSubmit.method}`
              : `等待最终API提交发布结果：${apiSubmit.method}`,
          })
        }
      }

      if (!clicked.ok) {
        const attempts = Number(shared.submit_click_attempts || 0)
        if (attempts < 6) {
          try { window.scrollTo?.({ top: document.body?.scrollHeight || 0, behavior: 'smooth' }) } catch (error) {}
          return nextPhase(phase, 1000, {
            ...shared,
            submit_click_attempts: attempts + 1,
            publish_stage: stage,
            current_store: `${stage === 'pc' ? 'PC端' : '最终'}提交发布按钮重试 ${attempts + 1}/6`,
          })
        }
        return failCurrentJob(`未找到${stage === 'pc' ? 'PC端' : '最终'}提交发布按钮，未执行API提交`, '发布失败')
      }
    }

    if (phase === 'wait_publish_result') {
      const stage = shared.publish_stage || 'pc'
      const publishStatus = extractPublishStatus(shared.current_job || {})
      const publishText = compact([bodyText(), publishStatus.dialogText].filter(Boolean).join(' '))
      if (detectTmallCaptchaWarning(publishText)) {
        return failCurrentJob(
          `${stage === 'pc' ? 'PC端' : '最终'}提交发布触发淘宝安全验证/验证码，已停止自动重试，请人工处理后再运行`,
          '发布失败',
        )
      }
      if (detectTmallSpeedLimitWarning(publishText)) {
        const speedConfirm = clickSpeedLimitConfirmIfPresent()
        return nextPhase('wait_publish_result', TMALL_SPEED_LIMIT_COOLDOWN_MS, {
          ...shared,
          publish_speed_limit_count: Number(shared.publish_speed_limit_count || 0) + 1,
          current_store: `${stage === 'pc' ? 'PC端' : '最终'}检测到淘宝操作频率限制，冷却 ${Math.round(TMALL_SPEED_LIMIT_COOLDOWN_MS / 1000)} 秒${speedConfirm.ok ? '并关闭提示' : ''}`,
        })
      }
      const attributeConfirm = clickAttributeUpdateConfirmIfPresent()
      if (attributeConfirm.ok) {
        const nextShared = markTmallAttributeUpdateConfirmed(shared, stage)
        return nextPhase('wait_publish_result', TMALL_PUBLISH_CONFIRM_WAIT_MS, {
          ...nextShared,
          publish_wait_attempts: Number(nextShared.publish_wait_attempts || 0) + 1,
          last_confirm_method: 'dom_click_attribute_update',
          current_store: `${stage === 'pc' ? 'PC端' : '最终'}商品属性信息更新确认：${attributeConfirm.text || '确定'}`,
        })
      }
      if (hasTmallAttributeUpdateDialog() && hasConfirmedTmallAttributeUpdate(shared, stage)) {
        const attempts = Number(shared.publish_wait_attempts || 0)
        return nextPhase('wait_publish_result', TMALL_PUBLISH_WAIT_MS, {
          ...shared,
          publish_wait_attempts: attempts + 1,
          current_store: `${stage === 'pc' ? 'PC端' : '最终'}商品属性信息更新弹窗已确认，等待页面继续`,
        })
      }
      if (publishStatus.success) {
        if (stage === 'pc') {
          if (isNewDescPcDetailTarget(shared)) {
            const pcNote = compact([
              'PC端新版详情已提交发布',
              '手机端详情随新版详情同组件同步，无需旧版手机端导入',
            ].join('；'))
            return nextPhase('reopen_after_final_publish', TMALL_PUBLISH_WAIT_MS, {
              ...shared,
              pc_publish_note: pcNote,
              final_publish_status: publishStatus,
              publish_wait_attempts: 0,
              tmall_wait_attempts: 0,
              current_store: '新版详情发布成功，重新进入编辑页读回校验详情',
            })
          }
          return nextPhase('reopen_after_pc_publish', TMALL_PUBLISH_WAIT_MS, {
            ...shared,
            pc_publish_note: 'PC端详情已提交发布',
            publish_wait_attempts: 0,
            current_store: '重新进入编辑页同步手机端详情',
          })
        }
        if (shared.after_final_readback_exit_submit) {
          const rows = Array.isArray(shared.final_readback_completed_rows) && shared.final_readback_completed_rows.length
            ? shared.final_readback_completed_rows
            : markRowsWithResult(shared.current_result_rows, publishStatus, '更新完成', compact([
              shared.pc_publish_note,
              shared.mobile_sync_note,
              shared.final_detail_readback_note,
              '读回校验后已再次提交以退出天猫编辑页',
            ].filter(Boolean).join('；')))
          return advanceToNextJob(rows, {
            ...shared,
            current_result_rows: rows,
            final_publish_status: publishStatus,
            after_final_readback_exit_submit: false,
            final_readback_completed_rows: [],
          })
        }
        const finalNote = compact([
          shared.pc_publish_note,
          shared.mobile_sync_note,
          '最终提交发布成功，准备读回校验PC/手机详情',
        ].filter(Boolean).join('；'))
        if (uploadedPcDetailUrlsFromShared(shared).length && !shared.final_detail_readback_verified) {
          return nextPhase('reopen_after_final_publish', TMALL_PUBLISH_WAIT_MS, {
            ...shared,
            pc_publish_note: finalNote,
            final_publish_status: publishStatus,
            publish_wait_attempts: 0,
            tmall_wait_attempts: 0,
            current_store: '最终发布成功，重新进入编辑页读回校验详情',
          })
        }
        const rows = markRowsWithResult(shared.current_result_rows, publishStatus, '更新完成', compact([
          finalNote,
          shared.final_detail_readback_note,
        ].filter(Boolean).join('；')))
        return advanceToNextJob(rows, {
          ...shared,
          current_result_rows: rows,
          final_publish_status: publishStatus,
        })
      }
      const hasUpgradePrompt = hasTmallDetailEditorUpgradePrompt(publishText)
      const upgradePromptAlreadyConfirmed = hasUpgradePrompt && hasConfirmedTmallUpgradePrompt(shared, stage)
      const confirm = upgradePromptAlreadyConfirmed
        ? { ok: false, text: '' }
        : clickPublishConfirmIfPresent()
      if (confirm.ok) {
        const nextShared = hasUpgradePrompt
          ? markTmallUpgradePromptConfirmed(shared, stage)
          : shared
        return nextPhase('wait_publish_result', TMALL_PUBLISH_CONFIRM_WAIT_MS, {
          ...nextShared,
          publish_wait_attempts: Number(nextShared.publish_wait_attempts || 0) + 1,
          last_confirm_method: 'dom_click',
          current_store: `${stage === 'pc' ? 'PC端' : '最终'}提交发布确认：${confirm.text || '确认'}`,
        })
      }
      if (!upgradePromptAlreadyConfirmed && TMALL_ALLOW_API_CONFIRM_FALLBACK) {
        const apiConfirm = confirmPublishByApiIfPresent()
        if (apiConfirm.ok) {
          return nextPhase('wait_publish_result', TMALL_PUBLISH_CONFIRM_WAIT_MS, {
            ...shared,
            publish_wait_attempts: Number(shared.publish_wait_attempts || 0) + 1,
            last_confirm_method: apiConfirm.method,
            current_store: `${stage === 'pc' ? 'PC端' : '最终'}API确认：${apiConfirm.component || ''}`,
          })
        }
      }
      if ((publishStatus.validationMessages || []).length) {
        return failCurrentJob(
          `${stage === 'pc' ? 'PC端' : '最终'}提交发布被页面校验阻止：${publishStatus.validationMessages.join('；')}`,
          '发布失败',
        )
      }

      const attempts = Number(shared.publish_wait_attempts || 0)
      if (attempts < 12) {
        return nextPhase('wait_publish_result', TMALL_PUBLISH_WAIT_MS, {
          ...shared,
          publish_wait_attempts: attempts + 1,
          current_store: `${stage === 'pc' ? 'PC端' : '最终'}提交发布等待 ${attempts + 1}/12`,
        })
      }
      if (stage === 'pc') {
        if (isNewDescPcDetailTarget(shared)) {
          const finalNote = compact([
            'PC端新版详情提交已触发，未识别明确成功提示',
            '手机端详情随新版详情同步，无需旧版手机端导入',
            '请在天猫后台确认',
          ].join('；'))
          const rows = markRowsWithResult(shared.current_result_rows, publishStatus, '提交待确认', finalNote)
          return advanceToNextJob(rows, {
            ...shared,
            current_result_rows: rows,
            pc_publish_note: finalNote,
            final_publish_status: publishStatus,
          })
        }
        return nextPhase('reopen_after_pc_publish', TMALL_PUBLISH_WAIT_MS, {
          ...shared,
          pc_publish_note: 'PC端提交已触发，未识别明确成功提示，继续同步手机端详情',
          publish_wait_attempts: 0,
          current_store: '重新进入编辑页同步手机端详情',
        })
      }
      const finalNote = compact([
        shared.pc_publish_note,
        shared.mobile_sync_note,
        '最终提交已触发，但未识别明确成功提示，请在天猫后台确认',
      ].filter(Boolean).join('；'))
      const rows = markRowsWithResult(shared.current_result_rows, publishStatus, '提交待确认', finalNote)
      return advanceToNextJob(rows, {
        ...shared,
        current_result_rows: rows,
        final_publish_status: publishStatus,
      })
    }

    if (phase === 'reopen_after_final_publish') {
      const itemId = shared.current_job?.item_id || ''
      const targetUrl = `${TMALL_PUBLISH_URL}?id=${encodeURIComponent(itemId)}`
      if (isTmallSubmitSuccessPage() || !location.href.startsWith(TMALL_PUBLISH_URL) || !location.href.includes(`id=${itemId}`)) {
        location.href = targetUrl
      } else {
        try {
          location.reload()
        } catch (error) {
          location.href = targetUrl
        }
      }
      return nextPhase('wait_final_readback_tmall_ready', TMALL_PAGE_WAIT_MS, {
        ...shared,
        tmall_wait_attempts: 0,
        current_store: '等待最终发布后编辑页读回',
      })
    }

    if (phase === 'wait_final_readback_tmall_ready') {
      const status = extractTmallStatus(shared.current_job || {})
      if (!status.ready) {
        if (isTmallSubmitSuccessPage()) {
          const itemId = shared.current_job?.item_id || normalizeItemId(location.href)
          if (itemId) location.href = `${TMALL_PUBLISH_URL}?id=${encodeURIComponent(itemId)}`
        }
        const attempts = Number(shared.tmall_wait_attempts || 0)
        if (attempts < 30) {
          return nextPhase('wait_final_readback_tmall_ready', TMALL_PAGE_WAIT_MS, {
            ...shared,
            tmall_wait_attempts: attempts + 1,
            current_store: `等待最终发布后编辑页读回 ${attempts + 1}/30`,
          })
        }
        return failCurrentJob('最终发布后重新进入编辑页超时，无法校验PC/手机详情是否真实更新', '发布后校验失败')
      }
      if (shared.prefer_legacy_pc_detail && !legacyPcDetailReplacementProbe({}) && findReturnOldDescriptionSwitch()) {
        const attempts = Number(shared.legacy_switch_attempts || 0)
        if (attempts < 5) {
          const nextShared = {
            ...shared,
            legacy_switch_attempts: attempts + 1,
            current_store: `读回校验前切回旧版图文描述 ${attempts + 1}/5`,
          }
          const cdpClick = cdpClickElement(findReturnOldDescriptionSwitch(), 'wait_final_readback_tmall_ready', 2500, nextShared)
          if (cdpClick) return cdpClick
          if (clickReturnOldDescriptionSwitch()) {
            return nextPhase('wait_final_readback_tmall_ready', TMALL_PAGE_WAIT_MS, nextShared)
          }
        }
      }
      const verification = verifyPublishedDetailReadback(shared)
      const returnOldForReadback = findReturnOldDescriptionSwitch()
      const pcTarget = compact(shared.pc_detail_target || '')
      const shouldTryOldReadback = returnOldForReadback && !shared.final_readback_returned_old && (
        !verification.ok ||
        pcTarget === 'tmDescription' ||
        pcTarget === 'modularDesc' ||
        !!shared.prefer_legacy_pc_detail
      )
      if (shouldTryOldReadback) {
        const nextShared = {
          ...shared,
          final_readback_returned_old: true,
          current_store: verification.ok
            ? '最终读回校验前切回旧版图文描述复核'
            : '当前详情读回缺少本次素材，切回旧版图文描述复核',
        }
        const cdpClick = cdpClickElement(returnOldForReadback, 'wait_final_readback_tmall_ready', 2500, nextShared)
        if (cdpClick) return cdpClick
        if (clickReturnOldDescriptionSwitch()) {
          return nextPhase('wait_final_readback_tmall_ready', TMALL_PAGE_WAIT_MS, nextShared)
        }
      }
      if (!verification.ok) {
        return failCurrentJob(`${verification.reason}；请人工打开编辑页确认，脚本不再标记更新完成`, '发布后校验失败')
      }
      const finalStatus = extractPublishStatus(shared.current_job || {})
      const note = compact([
        shared.pc_publish_note,
        shared.mobile_sync_note,
        verification.reason,
        '更新完毕',
      ].filter(Boolean).join('；'))
      const rows = markRowsWithResult(shared.current_result_rows, finalStatus, '更新完成', note)
      if (hasNextPendingJob(shared) && location.href.startsWith(TMALL_PUBLISH_URL)) {
        return nextPhase('submit_after_final_readback_exit', 0, {
          ...shared,
          current_result_rows: rows,
          final_readback_completed_rows: rows,
          final_publish_status: finalStatus,
          final_detail_readback_verified: true,
          final_detail_readback_note: verification.reason,
          submit_click_attempts: 0,
          publish_wait_attempts: 0,
          current_store: '读回校验通过，提交一次退出天猫编辑页后继续下一款',
        })
      }
      return advanceToNextJob(rows, {
        ...shared,
        current_result_rows: rows,
        final_publish_status: finalStatus,
        final_detail_readback_verified: true,
        final_detail_readback_note: verification.reason,
      })
    }

    if (phase === 'submit_after_final_readback_exit') {
      const clicked = clickSubmitPublishButton()
      if (clicked.ok) {
        return nextPhase('wait_publish_result', TMALL_PUBLISH_WAIT_MS, {
          ...shared,
          after_final_readback_exit_submit: true,
          publish_stage: 'final',
          submit_click_attempts: 0,
          publish_wait_attempts: 0,
          last_submit_method: 'dom_click_exit_after_readback',
          current_store: '等待读回校验后二次提交结果，成功后继续下一款',
        })
      }
      const attempts = Number(shared.submit_click_attempts || 0)
      if (attempts < 6) {
        try { window.scrollTo?.({ top: document.body?.scrollHeight || 0, behavior: 'smooth' }) } catch (error) {}
        return nextPhase('submit_after_final_readback_exit', 1000, {
          ...shared,
          submit_click_attempts: attempts + 1,
          current_store: `读回校验后退出编辑页提交按钮重试 ${attempts + 1}/6`,
        })
      }
      return failCurrentJob(
        '读回校验已通过，但未找到二次提交按钮，已停止跳转下一款以避免天猫编辑页离开确认卡住流程',
        '退出编辑页失败',
      )
    }

    if (phase === 'reopen_after_pc_publish') {
      const itemId = shared.current_job?.item_id || ''
      const targetUrl = `${TMALL_PUBLISH_URL}?id=${encodeURIComponent(itemId)}`
      if (!shared.reopened_after_pc_publish) {
        if (isTmallSubmitSuccessPage()) {
          return reenterTmallEditorFromSuccess(shared.current_job || {}, shared)
        }
        if (location.href.startsWith(TMALL_PUBLISH_URL) && location.href.includes(`id=${itemId}`)) {
          try {
            location.reload()
          } catch (error) {
            location.href = targetUrl
          }
        } else {
          location.href = targetUrl
        }
        return nextPhase('wait_reopened_tmall_ready', TMALL_PAGE_WAIT_MS, {
          ...shared,
          reopened_after_pc_publish: true,
          tmall_wait_attempts: 0,
          current_store: '重新加载天猫编辑页',
        })
      }
      return nextPhase('wait_reopened_tmall_ready', 0, shared)
    }

    if (phase === 'wait_reopened_tmall_ready') {
      const status = extractTmallStatus(shared.current_job || {})
      if (!status.ready) {
        if (isTmallSubmitSuccessPage()) {
          return reenterTmallEditorFromSuccess(shared.current_job || {}, shared)
        }
        const attempts = Number(shared.tmall_wait_attempts || 0)
        if (attempts < 30) {
          return nextPhase('wait_reopened_tmall_ready', TMALL_PAGE_WAIT_MS, {
            ...shared,
            tmall_wait_attempts: attempts + 1,
            current_store: `等待重新进入编辑页 ${attempts + 1}/30`,
          })
        }
        return failCurrentJob('PC端发布后重新进入编辑页超时，未继续同步手机端详情', '手机端同步失败')
      }
      if (isNewDescPcDetailTarget(shared)) {
        return nextPhase('wait_final_readback_tmall_ready', 0, {
          ...shared,
          tmall_wait_attempts: 0,
          pc_publish_note: compact([
            shared.pc_publish_note,
            '新版详情同组件，无需旧版手机端详情同步',
          ].filter(Boolean).join('；')),
          current_store: '新版详情无需手机端同步，进入最终读回校验',
        })
      }
      if (isModularPcDetailTarget(shared) && Array.isArray(shared.applied_modular_desc) && shared.applied_modular_desc.length && !shared.modular_desc_reapplied_after_reopen) {
        const descTypeApplied = shared.applied_desc_type ? applyFormValue('descType', shared.applied_desc_type) : { ok: true }
        if (!descTypeApplied.ok) {
          return failCurrentJob(`重新进入编辑页后切换文本PC详情失败：${descTypeApplied.reason || '未知原因'}`, 'PC详情回写失败')
        }
        const applied = applyComponentValue('modularDesc', shared.applied_modular_desc)
        if (!applied.ok) {
          return failCurrentJob(`重新进入编辑页后写入PC详情模块失败：${applied.reason || '未知原因'}`, 'PC详情回写失败')
        }
        return nextPhase('sync_mobile_detail_api', TMALL_PAGE_WAIT_MS, {
          ...shared,
          tmall_wait_attempts: 0,
          modular_desc_reapplied_after_reopen: true,
          pc_publish_note: compact([shared.pc_publish_note, shared.applied_desc_type ? '重新进入编辑页后已切换文本PC详情并回写PC详情模块' : '重新进入编辑页后已回写PC详情模块'].filter(Boolean).join('；')),
          current_store: shared.applied_desc_type ? '文本PC详情模块已回写，继续同步手机端详情' : 'PC详情模块已回写，继续同步手机端详情',
        })
      }
      if (isShenbiPcDetailTarget(shared) && shared.applied_desc_for_shenbi_pc && !shared.shenbi_pc_reapplied_after_reopen) {
        const applied = applyFormValue('descForShenbiPc', shared.applied_desc_for_shenbi_pc)
        if (!applied.ok) {
          return failCurrentJob(`重新进入编辑页后写入神笔PC详情失败：${applied.reason || '未知原因'}`, 'PC详情回写失败')
        }
        return nextPhase('sync_mobile_detail_api', TMALL_PAGE_WAIT_MS, {
          ...shared,
          tmall_wait_attempts: 0,
          shenbi_pc_reapplied_after_reopen: true,
          pc_publish_note: compact([shared.pc_publish_note, '重新进入编辑页后已回写神笔PC详情'].filter(Boolean).join('；')),
          current_store: '神笔PC详情已回写，继续同步手机端详情',
        })
      }
      if (isLegacyHtmlPcDetailTarget(shared) && shared.applied_pc_detail_html && !shared.legacy_html_reapplied_after_reopen) {
        const descTypeApplied = shared.applied_desc_type ? applyFormValue('descType', shared.applied_desc_type) : { ok: true }
        if (!descTypeApplied.ok) {
          return failCurrentJob(`重新进入编辑页后切换文本PC详情失败：${descTypeApplied.reason || '未知原因'}`, 'PC详情回写失败')
        }
        const modelApplied = applyFormValue('tmDescription', shared.applied_pc_detail_html)
        const domApplied = applyLegacyPcDetailDom(shared.applied_pc_detail_html)
        if (!modelApplied.ok) {
          return failCurrentJob(`重新进入编辑页后写入旧版PC详情模型失败：${modelApplied.reason || '未知原因'}`, 'PC详情回写失败')
        }
        return nextPhase('sync_mobile_detail_api', TMALL_PAGE_WAIT_MS, {
          ...shared,
          tmall_wait_attempts: 0,
          legacy_html_reapplied_after_reopen: true,
          pc_publish_note: compact([shared.pc_publish_note, `${shared.applied_desc_type ? '重新进入编辑页后已切换文本PC详情并回写旧版PC详情' : '重新进入编辑页后已回写旧版PC详情'}${domApplied.ok ? '' : '（未找到可见textarea，仅写入模型）'}`].filter(Boolean).join('；')),
          current_store: shared.applied_desc_type ? '文本旧版PC详情已回写，继续同步手机端详情' : '旧版PC详情已回写，继续同步手机端详情',
        })
      }
      return nextPhase('sync_mobile_detail_api', TMALL_PAGE_WAIT_MS, {
        ...shared,
        tmall_wait_attempts: 0,
        current_store: '通过API同步手机端详情',
      })
    }

    if (phase === 'sync_mobile_detail_api') {
      const visualMobileFallbackEligible = shouldUseVisualMobileEditorSync(shared)
      if (parseBoolean(params.force_mobile_editor_sync, false) || visualMobileFallbackEligible) {
        return nextPhase('open_mobile_detail_editor', 800, {
          ...shared,
          mobile_sync_note: parseBoolean(params.force_mobile_editor_sync, false)
            ? '已按参数强制使用手机端详情编辑器同步，跳过表单API同步'
            : '旧版/文本PC详情按页面完整链路同步：编辑手机端详情、导入电脑端详情、保存、完成编辑',
          current_store: '打开手机端详情编辑器同步',
        })
      }
      const modularDesc = Array.isArray(shared.applied_modular_desc)
        ? shared.applied_modular_desc
        : getComponentValue('modularDesc')
      const pcDetailHtml = shared.applied_pc_detail_html || getComponentValue('tmDescription') || getLegacyPcDetailHtml()
      const synced = await syncMobileDetailByApi(modularDesc, {
        uploadedByCategory: shared.uploaded_by_category || {},
        pcDetailHtml,
        pcDetailUrls: expectedPcDetailUrlsFromShared(shared),
        timeoutMs: 5000,
      })
      if (synced.ok) {
        return nextPhase('submit_final_publish', 800, {
          ...shared,
          mobile_sync_note: synced.note,
          mobile_sync_api_result: synced,
          publish_wait_attempts: 0,
          publish_stage: 'final',
          current_store: `手机端详情API同步完成：${synced.method}`,
        })
      }
      const attempts = Number(shared.mobile_api_attempts || 0)
      if (attempts < 2) {
        return nextPhase('sync_mobile_detail_api', 1000, {
          ...shared,
          mobile_api_attempts: attempts + 1,
          mobile_sync_api_result: synced,
          current_store: `手机端详情API同步重试 ${attempts + 1}/2`,
        })
      }
      return nextPhase('open_mobile_detail_editor', 800, {
        ...shared,
        mobile_sync_api_result: synced,
        mobile_sync_note: `手机端API同步失败，改用页面兜底：${synced.reason || '未知原因'}`,
        current_store: 'API失败，打开手机端详情编辑器兜底',
      })
    }

    if (phase === 'open_mobile_detail_editor') {
      const editElement = findMobileDetailEditButton()
      const clicked = cdpClickElement(editElement, 'wait_mobile_editor_ready', 1500, {
        ...shared,
        mobile_action_attempts: 0,
        mobile_wait_attempts: 0,
        current_store: '等待手机端详情编辑器',
      })
      if (!clicked) {
        const attempts = Number(shared.mobile_action_attempts || 0)
        if (attempts < 10) {
          try { window.scrollTo?.({ top: document.body?.scrollHeight || 0, behavior: 'smooth' }) } catch (error) {}
          return nextPhase('open_mobile_detail_editor', 1000, {
            ...shared,
            mobile_action_attempts: attempts + 1,
            current_store: `查找手机端编辑详情入口 ${attempts + 1}/10`,
          })
        }
        return failCurrentJob('未找到“手机端详情描述”的“编辑详情”入口', '手机端同步失败')
      }
      return clicked
    }

    if (phase === 'wait_mobile_editor_ready') {
      const signals = mobileEditorSignals()
      if (signals.ready) {
        return nextPhase('clear_mobile_editor_modules', 500, {
          ...shared,
          mobile_wait_attempts: 0,
          current_store: '准备清空旧手机端详情模块',
        })
      }
      if (visibleCrossOriginMobileEditor()) {
        return nextPhase('clear_mobile_editor_modules', 500, {
          ...shared,
          mobile_wait_attempts: 0,
          mobile_cross_origin_editor: true,
          current_store: '检测到跨域手机端详情编辑器，准备清空旧模块',
        })
      }
      const attempts = Number(shared.mobile_wait_attempts || 0)
      if (attempts < 20) {
        return nextPhase('wait_mobile_editor_ready', 1000, {
          ...shared,
          mobile_wait_attempts: attempts + 1,
          current_store: `等待手机端详情编辑器 ${attempts + 1}/20`,
        })
      }
      return failCurrentJob('手机端详情编辑器未出现“清除所有模块/导入详情/全图生成”等信号', '手机端同步失败')
    }

    if (phase === 'clear_mobile_editor_modules') {
      return clearMobileEditorModulesViaTarget({
        ...shared,
        mobile_clear_attempts: Number(shared.mobile_clear_attempts || 0),
      })
    }

    if (phase === 'verify_mobile_editor_modules_cleared') {
      const clearEval = shared.mobile_editor_clear_result || {}
      const clearValue = clearEval.value || {}
      if (clearEval.ok && clearValue.ok) {
        return nextPhase('import_mobile_pc_detail_via_target', 500, {
          ...shared,
          mobile_editor_cleared: clearValue,
          mobile_action_attempts: 0,
          mobile_import_attempts: 0,
          current_store: '旧手机端详情模块已清空，导入电脑端详情',
        })
      }
      const attempts = Number(shared.mobile_clear_attempts || 0)
      if (attempts < 3) {
        return nextPhase('clear_mobile_editor_modules', 1000, {
          ...shared,
          mobile_clear_attempts: attempts + 1,
          current_store: `清空旧手机端详情模块重试 ${attempts + 1}/3：${clearValue.reason || clearEval.error || '未确认清空'}`,
        })
      }
      return failCurrentJob(`清空旧手机端详情模块失败：${clearValue.reason || clearEval.error || '未确认清空'}`, '手机端同步失败')
    }

    if (phase === 'import_mobile_pc_detail_via_target') {
      return importMobilePcDetailViaTarget({
        ...shared,
        mobile_import_attempts: Number(shared.mobile_import_attempts || 0),
      })
    }

    if (phase === 'verify_mobile_editor_imported') {
      const importEval = shared.mobile_editor_import_result || {}
      const importValue = importEval.value || {}
      const after = importValue.after || {}
      const generateOp = Number(importValue.generateOp ?? shared.mobile_import_generate_op) === 1 ? 1 : 0
      const expectedUrlCount = Number(after.expectedUrlCount || 0)
      const expectedHitCount = Math.max(
        Number(after.canvasExpectedHitCount || 0),
        Number(after.visibleExpectedHitCount || 0),
      )
      const importSuccessDialogConfirmed = !!(after.importSuccessDialog || importValue.importSuccessClosed)
      const imageCountImported = !!(
        Number(after.canvasImageCount || after.visibleImageCount || 0) >= mobileEditorExpectedImportImageCount(shared) &&
        Number(after.groupCount || 0) >= 1 &&
        !after.hasEmptyNotice
      )
      const imported = !!(
        importEval.ok &&
        importValue.ok &&
        (importSuccessDialogConfirmed || imageCountImported) &&
        (!expectedUrlCount || importSuccessDialogConfirmed || expectedHitCount >= expectedUrlCount)
      )
      if (imported) {
        const modeName = generateOp === 1 ? '图文分离' : '全图生成'
        const importedImageCount = Number(after.canvasImageCount || after.visibleImageCount || 0)
        return nextPhase('save_mobile_editor', 800, {
          ...shared,
          mobile_editor_imported: importValue,
          mobile_action_attempts: 0,
          mobile_save_attempts: 0,
          mobile_generate_mode: modeName,
          mobile_full_image_disabled: generateOp !== 0,
          current_store: importSuccessDialogConfirmed
            ? `手机端已导入电脑端详情（${modeName}），已确认成功弹窗，准备保存`
            : `手机端已导入电脑端详情（${modeName}）：${importedImageCount} 张图`,
        })
      }
      const mismatchReason = compact(importValue.reason || importEval.error || '')
      const shouldRetryAsSplit = generateOp === 0 && (
        /未命中本次PC详情图/.test(mismatchReason) ||
        (expectedUrlCount > 0 && expectedHitCount < expectedUrlCount)
      )
      if (shouldRetryAsSplit) {
        return nextPhase('clear_mobile_editor_modules', 1000, {
          ...shared,
          mobile_import_generate_op: 1,
          mobile_import_attempts: 0,
          mobile_clear_attempts: 0,
          mobile_editor_import_full_image_mismatch: importValue,
          current_store: `全图生成未命中本次素材，改用图文分离重试：${expectedHitCount}/${expectedUrlCount || uploadedPcDetailUrlsFromShared(shared).length}`,
        })
      }
      const attempts = Number(shared.mobile_import_attempts || 0)
      if (attempts < 2) {
        return nextPhase('clear_mobile_editor_modules', 1000, {
          ...shared,
          mobile_import_attempts: attempts + 1,
          mobile_clear_attempts: 0,
          current_store: `导入电脑端详情未确认，清空后重试 ${attempts + 1}/2：${importValue.reason || importEval.error || '未出现新模块'}`,
        })
      }
      return failCurrentJob(`导入电脑端详情失败：${importValue.reason || importEval.error || '未出现新手机详情模块'}`, '手机端同步失败')
    }

    if (phase === 'open_mobile_module_menu') {
      const opened = clickMobileModuleMenu()
      if (!opened.ok) {
        const attempts = Number(shared.mobile_action_attempts || 0)
        if (attempts < 8) {
          return nextPhase('open_mobile_module_menu', 800, {
            ...shared,
            mobile_action_attempts: attempts + 1,
            current_store: `打开手机端模块菜单 ${attempts + 1}/8`,
          })
        }
        return failCurrentJob('未找到手机端详情编辑器的小方块/模块菜单入口', '手机端同步失败')
      }
      return nextPhase('clear_mobile_modules', 800, {
        ...shared,
        mobile_action_attempts: 0,
        current_store: '清除手机端所有模块',
      })
    }

    if (phase === 'clear_mobile_modules') {
      const cleared = clickClearAllMobileModules()
      if (!cleared.ok) {
        const attempts = Number(shared.mobile_action_attempts || 0)
        if (attempts < 8) {
          return nextPhase('clear_mobile_modules', 800, {
            ...shared,
            mobile_action_attempts: attempts + 1,
            current_store: `查找清除所有模块 ${attempts + 1}/8`,
          })
        }
        return failCurrentJob('未找到“清除所有模块”操作', '手机端同步失败')
      }
      return nextPhase('confirm_clear_mobile_modules', 800, {
        ...shared,
        mobile_action_attempts: 0,
        current_store: '确认清除手机端所有模块',
      })
    }

    if (phase === 'confirm_clear_mobile_modules') {
      clickDialogConfirm(['确认', '确定'])
      return nextPhase('open_mobile_import_menu', 1000, {
        ...shared,
        current_store: '手机端导入电脑端详情',
      })
    }

    if (phase === 'open_mobile_import_menu') {
      if (mobileEditorSignals().importPc) {
        return nextPhase('click_mobile_import_pc_detail', 600, {
          ...shared,
          mobile_action_attempts: 0,
          current_store: '导入电脑端详情已可见',
        })
      }
      const element = findMobileImportMenuElement()
      const moved = cdpMoveElement(element, 'click_mobile_import_detail', 700, {
        ...shared,
        mobile_action_attempts: 0,
        current_store: '鼠标移入手机端“导入”菜单',
      })
      if (!moved && visibleCrossOriginMobileEditor()) {
        const clicked = cdpMobileEditorClick('importMenu', 'click_mobile_import_detail', 700, {
          ...shared,
          mobile_action_attempts: 0,
          mobile_cross_origin_editor: true,
          current_store: '点击跨域手机端“导入”菜单',
        })
        if (clicked) return clicked
      }
      if (!moved) {
        const attempts = Number(shared.mobile_action_attempts || 0)
        if (attempts < 8) {
          return nextPhase('open_mobile_import_menu', 800, {
            ...shared,
            mobile_action_attempts: attempts + 1,
            current_store: `打开导入菜单 ${attempts + 1}/8`,
          })
        }
        return failCurrentJob('未找到手机端“导入”菜单', '手机端同步失败')
      }
      return moved
    }

    if (phase === 'click_mobile_import_detail') {
      if (mobileEditorSignals().importPc) {
        return nextPhase('click_mobile_import_pc_detail', 600, {
          ...shared,
          mobile_action_attempts: 0,
          current_store: '导入电脑端详情已可见',
        })
      }
      const element = findMobileImportDetailElement()
      const moved = cdpMoveElement(element, 'click_mobile_import_pc_detail', 700, {
        ...shared,
        mobile_action_attempts: 0,
        current_store: '鼠标移入手机端“导入详情”菜单',
      })
      if (!moved && visibleCrossOriginMobileEditor()) {
        const crossMoved = cdpMobileEditorClick('importDetail', 'click_mobile_import_pc_detail', 700, {
          ...shared,
          mobile_action_attempts: 0,
          mobile_cross_origin_editor: true,
          current_store: '鼠标移入跨域手机端“导入详情”菜单',
        }, 'move')
        if (crossMoved) return crossMoved
      }
      if (!moved) {
        const attempts = Number(shared.mobile_action_attempts || 0)
        if (attempts < 8) {
          return nextPhase('click_mobile_import_detail', 800, {
            ...shared,
            mobile_action_attempts: attempts + 1,
            current_store: `选择导入详情 ${attempts + 1}/8`,
          })
        }
        return failCurrentJob('未找到“导入详情”菜单项', '手机端同步失败')
      }
      return moved
    }

    if (phase === 'click_mobile_import_pc_detail') {
      const element = findMobileImportPcDetailElement()
      const clicked = cdpClickElement(element, 'select_mobile_full_image', 1000, {
        ...shared,
        mobile_action_attempts: 0,
        current_store: '点击导入电脑端详情',
      })
      if (!clicked && visibleCrossOriginMobileEditor()) {
        const crossClicked = cdpMobileEditorClick('importPcDetail', 'select_mobile_full_image', 1000, {
          ...shared,
          mobile_action_attempts: 0,
          mobile_cross_origin_editor: true,
          current_store: '点击跨域手机端“导入电脑端详情”',
        })
        if (crossClicked) return crossClicked
      }
      if (!clicked) {
        const attempts = Number(shared.mobile_action_attempts || 0)
        if (attempts < 8) {
          return nextPhase('click_mobile_import_pc_detail', 800, {
            ...shared,
            mobile_action_attempts: attempts + 1,
            current_store: `选择导入电脑端详情 ${attempts + 1}/8`,
          })
        }
        return failCurrentJob('未找到“导入电脑端详情”菜单项', '手机端同步失败')
      }
      return clicked
    }

    if (phase === 'select_mobile_full_image') {
      const option = selectMobileGenerateOptionByPriority()
      if (option?.selected) {
        return nextPhase('confirm_mobile_import_pc_detail', 500, {
          ...shared,
          mobile_action_attempts: 0,
          mobile_generate_mode: option.text || '图文分离',
          mobile_full_image_disabled: option.text !== '全图生成',
          current_store: `已选择${option.text || '手机端生成方式'}`,
        })
      }
      const clicked = cdpClickElement(option?.element, 'confirm_mobile_import_pc_detail', 500, {
        ...shared,
        mobile_action_attempts: 0,
        mobile_generate_mode: option?.text || '图文分离',
        mobile_full_image_disabled: option?.text !== '全图生成',
        current_store: `选择${option?.text || '手机端生成方式'}`,
      })
      if (!clicked && visibleCrossOriginMobileEditor()) {
        const crossClicked = cdpMobileEditorClick('fullImage', 'confirm_mobile_import_pc_detail', 500, {
          ...shared,
          mobile_action_attempts: 0,
          mobile_generate_mode: '全图生成',
          mobile_full_image_disabled: false,
          mobile_cross_origin_editor: true,
          current_store: '选择跨域手机端“全图生成”',
        })
        if (crossClicked) return crossClicked
      }
      if (!clicked) {
        const attempts = Number(shared.mobile_action_attempts || 0)
        if (attempts < 10) {
          return nextPhase('select_mobile_full_image', 800, {
            ...shared,
            mobile_action_attempts: attempts + 1,
            current_store: `选择全图生成 ${attempts + 1}/10`,
          })
        }
        return failCurrentJob('未找到“全图生成/图文分离”选项', '手机端同步失败')
      }
      return clicked
    }

    if (phase === 'confirm_mobile_import_pc_detail') {
      const confirmed = cdpClickElement(findMobileImportConfirmElement(), 'cleanup_mobile_editor_import', 1500, {
        ...shared,
        current_store: '清理手机端导入结果',
      })
      if (confirmed) return confirmed
      if (visibleCrossOriginMobileEditor()) {
        const crossConfirmed = cdpMobileEditorClick('confirm', 'cleanup_mobile_editor_import', 1800, {
          ...shared,
          mobile_cross_origin_editor: true,
          mobile_import_confirm_clicked: true,
          current_store: '确认跨域手机端导入电脑端详情',
        })
        if (crossConfirmed) return crossConfirmed
      }
      clickDialogConfirm(['确认', '确定', '生成', '导入'])
      return nextPhase('cleanup_mobile_editor_import', 1500, {
        ...shared,
        current_store: '清理手机端导入结果',
      })
    }

    if (phase === 'cleanup_mobile_editor_import') {
      const cleanup = cleanupMobileEditorImportedCanvas()
      if (cleanup.ok) {
        return nextPhase('save_mobile_editor', 800, {
          ...shared,
          mobile_editor_cleanup: cleanup,
          current_store: cleanup.removedGroupCount || cleanup.removedComponentCount
            ? `已清理手机端导入占位图：组 ${cleanup.removedGroupCount} 个，组件 ${cleanup.removedComponentCount} 个`
            : '手机端导入结果无需清理，准备保存',
        })
      }
      if (visibleCrossOriginMobileEditor()) {
        const attempts = Number(shared.mobile_cleanup_attempts || 0)
        if (attempts < 4) {
          return nextPhase('cleanup_mobile_editor_import', 1000, {
            ...shared,
            mobile_cleanup_attempts: attempts + 1,
            mobile_cross_origin_editor: true,
            current_store: `等待跨域手机端导入完成 ${attempts + 1}/4`,
          })
        }
        return nextPhase('save_mobile_editor', 800, {
          ...shared,
          mobile_editor_cleanup: cleanup,
          mobile_cross_origin_editor: true,
          current_store: `跨域手机端编辑器无法读取画布，继续保存：${cleanup.reason || '浏览器跨域限制'}`,
        })
      }
      const attempts = Number(shared.mobile_cleanup_attempts || 0)
      if (attempts < 8) {
        return nextPhase('cleanup_mobile_editor_import', 800, {
          ...shared,
          mobile_cleanup_attempts: attempts + 1,
          current_store: `等待手机端导入画布可清理 ${attempts + 1}/8`,
        })
      }
      return nextPhase('save_mobile_editor', 800, {
        ...shared,
        mobile_editor_cleanup: cleanup,
        current_store: `未能读取手机端导入画布，继续尝试保存：${cleanup.reason || '未知原因'}`,
      })
    }

    if (phase === 'verify_mobile_editor_saved') {
      const saveEval = shared.mobile_editor_save_result || {}
      const saveValue = saveEval.value || {}
      if (saveEval.ok && saveValue.ok) {
        return nextPhase('finish_mobile_editor', 800, {
          ...shared,
          mobile_editor_saved: saveValue,
          mobile_action_attempts: 0,
          mobile_sync_note: compact([shared.mobile_sync_note, `手机端详情已导入电脑端详情（${shared.mobile_generate_mode || '全图生成'}），并已点击保存`].filter(Boolean).join('；')),
          current_store: '手机端详情保存成功，准备完成编辑',
        })
      }
      const attempts = Number(shared.mobile_save_attempts || 0)
      if (attempts < 2) {
        return nextPhase('save_mobile_editor', 1200, {
          ...shared,
          mobile_save_attempts: attempts + 1,
          current_store: `保存手机端详情重试 ${attempts + 1}/2：${saveValue.reason || saveEval.error || '未确认保存成功'}`,
        })
      }
      return failCurrentJob(`保存手机端详情失败：${saveValue.reason || saveEval.error || '未确认保存成功'}`, '手机端同步失败')
    }

    if (phase === 'save_mobile_editor') {
      return saveMobileEditorViaTarget({
        ...shared,
        mobile_save_attempts: Number(shared.mobile_save_attempts || 0),
      })
    }

    if (phase === 'finish_mobile_editor') {
      return finishMobileEditorViaTarget({
        ...shared,
      })
    }

    if (phase === 'wait_after_mobile_finish') {
      clickDialogConfirm(['确认', '确定'])
      if (visibleCrossOriginMobileEditor()) {
        const attempts = Number(shared.mobile_wait_attempts || 0)
        if (attempts < 20) {
          return nextPhase('wait_after_mobile_finish', 1000, {
            ...shared,
            mobile_wait_attempts: attempts + 1,
            mobile_cross_origin_editor: true,
            current_store: `等待跨域手机端编辑器关闭 ${attempts + 1}/20`,
          })
        }
      }
      const status = extractTmallStatus(shared.current_job || {})
      const submitButton = findVisibleActionByText(['提交发布', '提交并发布', '立即发布', '提交'], {
        allowContains: true,
        maxTextLength: 24,
        preferBottom: true,
        preferRight: true,
        exclude: ['保存草稿', '仅保存', '预览', '取消'],
      })
	      if (status.ready && submitButton) {
	        if (!shared.mobile_detail_duplicates_cleaned) {
	          const currentMobileValue = getComponentValue('descForShenbiMobile') || getTmallFormValues().descForShenbiMobile
	          const cleaned = cleanDuplicateShenbiMobileImages(currentMobileValue)
	          if (cleaned.changed) {
	            const applied = applyFormValue('descForShenbiMobile', cleaned.value)
	            if (!applied.ok) {
	              return failCurrentJob(`清理手机端重复详情图失败：${applied.reason || '未能写入descForShenbiMobile'}`, '手机端同步失败')
	            }
	            return nextPhase('wait_after_mobile_finish', 600, {
	              ...shared,
	              mobile_detail_duplicates_cleaned: true,
	              mobile_detail_duplicate_cleanup: cleaned,
	              mobile_sync_note: compact([shared.mobile_sync_note, cleaned.note].filter(Boolean).join('；')),
	              current_store: '已清理手机端重复详情图，准备最终提交',
	            })
	          }
	          return nextPhase('submit_final_publish', 800, {
	            ...shared,
	            mobile_detail_duplicates_cleaned: true,
	            mobile_detail_duplicate_cleanup: cleaned,
	            publish_wait_attempts: 0,
	            publish_stage: 'final',
	            current_store: '最终提交发布',
	          })
	        }
	        return nextPhase('submit_final_publish', 800, {
	          ...shared,
	          publish_wait_attempts: 0,
	          publish_stage: 'final',
          current_store: '最终提交发布',
        })
      }
      const attempts = Number(shared.mobile_wait_attempts || 0)
      if (attempts < 12) {
        return nextPhase('wait_after_mobile_finish', 1000, {
          ...shared,
          mobile_wait_attempts: attempts + 1,
          current_store: `等待返回商品编辑页 ${attempts + 1}/12`,
        })
      }
      return failCurrentJob('手机端详情完成后未返回可提交的商品编辑页', '手机端同步失败')
    }

    return { success: false, error: `未知 phase: ${phase}` }
  } catch (error) {
    if (isSemirLoginTimeoutError(error) && isSemirLoginWaitPhase(phase)) {
      return waitForSemirLogin(phase, shared, error)
    }
    return {
      success: false,
      error: String(error?.message || error),
    }
  }
})()
