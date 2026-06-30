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
  const PC_DETAIL_MAX_COUNT = 30
  const UPLOAD_INPUT_ID = 'crawshrimp-tmall-packaging-upload-input'
  const UPLOAD_INPUT_SELECTOR = `#${UPLOAD_INPUT_ID}`

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
  const REQUIRED_COUNTS = {
    main_1x1: 2,
    micro_1x1: 2,
    main_3x4: 2,
    micro_3x4: 3,
    vertical: 1,
  }
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
      execute_mode: normalizeExecuteMode(rawParams.execute_mode),
      block_on_style_mismatch: parseBoolean(rawParams.block_on_style_mismatch, true),
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
          execute_mode: normalizeExecuteMode(rawParams.execute_mode),
          block_on_style_mismatch: parseBoolean(rawParams.block_on_style_mismatch, true),
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

  function classifyPackagingAssets(items) {
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
    const ratioItems = ratio => sorted.filter(item => item.__hints.ratio === ratio)
    const detailItems = sorted.filter(item => item.__hints.isDetail)

    byCategory.main_1x1.push(...assignFirst([...exact('main_1x1'), ...ratioItems('1x1')], REQUIRED_COUNTS.main_1x1, used))
    byCategory.micro_1x1.push(...assignFirst([...exact('micro_1x1'), ...ratioItems('1x1')], REQUIRED_COUNTS.micro_1x1, used))
    byCategory.main_3x4.push(...assignFirst([...exact('main_3x4'), ...ratioItems('3x4')], REQUIRED_COUNTS.main_3x4, used))
    byCategory.micro_3x4.push(...assignFirst([...exact('micro_3x4'), ...ratioItems('3x4')], REQUIRED_COUNTS.micro_3x4, used))
    byCategory.vertical.push(...assignFirst([...exact('vertical'), ...ratioItems('2x3')], REQUIRED_COUNTS.vertical, used))
    const allPcDetailPool = sortPcDetailCandidates([...exact('pc_detail'), ...detailItems, ...sorted])
      .filter(item => pcDetailAssetScore(item) > 0)
    const optimizedPcDetailPool = allPcDetailPool.filter(isOptimizedPcDetailAsset)
    const pcDetailPool = optimizedPcDetailPool.length ? optimizedPcDetailPool : allPcDetailPool
    byCategory.pc_detail.push(...assignFirst(pcDetailPool, PC_DETAIL_MAX_COUNT, used))

    const missing = Object.entries(REQUIRED_COUNTS)
      .filter(([category, count]) => byCategory[category].length < count)
      .map(([category, count]) => `${CATEGORY_LABELS[category]}缺少${count - byCategory[category].length}张`)

    return {
      byCategory,
      missing,
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

  async function resolvePackagingSourceConfig(cloudConfig, job) {
    const mounts = await fetchMounts()
    const resolved = resolveMountFromList(mounts, cloudConfig.mountName)
    if (resolved) {
      return {
        mountId: resolved.mountId,
        mountName: resolved.mountName,
        relativePath: cloudConfig.relativePath,
        rawPath: cloudConfig.raw,
        sourceWarning: '',
      }
    }

    const fallback = await findVisibleStyleFolder(mounts, job.style_code)
    if (fallback) {
      return {
        mountId: fallback.mountId,
        mountName: fallback.mountName,
        relativePath: fallback.relativePath,
        rawPath: `${fallback.mountName}//${fallback.relativePath}`,
        sourceWarning: `未找到挂载点“${cloudConfig.mountName}”，已按款号在可见挂载点“${fallback.mountName}”中定位图包`,
      }
    }

    const available = mounts.map(mountDisplayName).filter(Boolean).join('、')
    throw new Error(`未找到挂载点：${cloudConfig.mountName}；按款号 ${job.style_code} 在当前可见挂载点中也未找到图包。当前可见挂载点：${available || '无'}`)
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

  async function collectPackagingAssets(job, sourceConfig) {
    const exact = await collectDescendantImagesByPath(
      sourceConfig.mountId,
      sourceConfig.relativePath,
      job.folder_scan_depth,
      { value: 3000 },
    )
    let assets = exact.assets
    const errors = [...exact.errors]
    let searchCount = 0
    let folderCount = 0
    let searchScope = assets.length ? 'configured_path' : ''

    const collectFromSearchItems = async (searchItems, scopeLabel) => {
      const matching = searchItems.filter(item => searchItemMatchesStyle(item, job.style_code))
      const folders = matching.filter(item => {
        if (matchesStyleFolder(item, job.style_code)) return true
        if (!isDirectoryItem(item)) return false
        const fullpath = String(item?.fullpath || item?.filename || '').replace(/\\/g, '/')
        const optimized = optimizedStyleFolderPathFromFullpath(fullpath, job.style_code)
        return !!optimized && optimized === pathSegments(fullpath).join('/')
      })
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
        errors.push(...child.errors)
      }
      assets.push(...matching.filter(isImageItem))
      if (matching.length) searchScope = scopeLabel
      return matching.length
    }

    if (!assets.length) {
      const searchItems = await searchFiles(sourceConfig.mountId, job.style_code)
      searchCount = searchItems.length
      const scoped = searchItems.filter(item => isWithinRelativePath(item?.fullpath, sourceConfig.relativePath))
      await collectFromSearchItems(scoped, 'configured_search')
      if (!assets.length) {
        const mountWide = selectMountWideSearchItems(searchItems, sourceConfig.relativePath, job.style_code)
        const preferred = mountWide.filter(isPreferredPackagingSearchItem)
        await collectFromSearchItems(mountWide, preferred.length ? 'mount_packaging_search' : 'mount_search')
      }
    }

    assets = dedupeItemsByFullpath(assets)
    const plan = classifyPackagingAssets(assets)
    return {
      ...plan,
      items: assets,
      errors,
      searchCount,
      folderCount,
      searchScope,
    }
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

    if (!plan.items.length) {
      rows.push({
        ...baseOutputRow(job),
        '图片用途': '',
        '文件名': '',
        '原文件名': '',
        '云盘路径': sourceConfig.relativePath,
        '下载结果': '未匹配到图片',
        '本地文件': '',
        '上传结果': '',
        '天猫图片URL': '',
        '执行结果': '未匹配到图片',
        '备注': `搜索结果 ${plan.searchCount} 条；匹配文件夹 ${plan.folderCount} 个；搜索范围 ${plan.searchScope || '无'}；列目录问题 ${plan.errors.length} 个`,
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
        '云盘路径': sourceConfig.relativePath,
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
        '云盘路径': sourceConfig.relativePath,
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

  function currentPcDetailReplacementProbe() {
    const modularDesc = getComponentValue('modularDesc')
    if (Array.isArray(modularDesc) && modularDesc.length) {
      return buildAnchoredPcDetailModules(modularDesc, [], { probeOnly: true })
    }
    const tmDescription = getLegacyPcDetailHtml()
    if (tmDescription) return buildAnchoredPcDetailHtml(tmDescription, [], { probeOnly: true })
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

  function clickDialogConfirm(labels = ['确认', '确定']) {
    const element = findVisibleActionByText(labels, {
      dialogOnly: true,
      allowContains: false,
      maxTextLength: 12,
      preferRight: true,
      exclude: ['取消', '关闭'],
    }) || findVisibleActionByText(labels, {
      allowContains: false,
      maxTextLength: 12,
      preferRight: true,
      exclude: ['取消', '关闭'],
    })
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
    try {
      element.click()
      return true
    } catch (error) {
      return false
    }
  }

  function extractMerchantCodeFromTmallState() {
    const props = getComponentValue('itemProp') || {}
    const direct = props?.['p-13021751'] || props?.['p-20431815']
    if (direct?.text || direct?.value) return compact(direct.text || direct.value)
    const inputs = Array.from(document.querySelectorAll('input'))
    const values = inputs.map(input => compact(input.value)).filter(Boolean)
    return values.find(value => /^\d{8,}[A-Za-z0-9-]*$/.test(value)) || ''
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
        if (msg && !validationMessages.includes(msg)) validationMessages.push(msg)
      })
    })
    const merchantCode = extractMerchantCodeFromTmallState()
    return {
      url: location.href,
      title: document.title,
      itemId: normalizeItemId(location.href) || job.item_id || '',
      merchantCode,
      styleCode: job.style_code || '',
      styleMatched: !job.style_code || !merchantCode || merchantCode === job.style_code,
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

  function extractPublishStatus(job = {}) {
    const status = extractTmallStatus(job)
    const text = bodyText()
    const success = /(发布成功|提交成功|更新成功|修改成功|保存成功|操作成功|商品已发布|已提交审核|更新完毕)/.test(text)
    const hasDialog = getAccessibleDocuments().some(doc => visibleDialogRoots(doc).length > 0)
    const dialogText = compact(getAccessibleDocuments()
      .flatMap(doc => visibleDialogRoots(doc))
      .map(root => elementText(root))
      .join(' '))
    const blockingMessages = [...status.validationMessages]
    if (/必填项未填|存在错误|请完善|请填写|不能为空/.test(text) && !blockingMessages.length) {
      blockingMessages.push('页面提示存在必填项或校验错误')
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
    const confirm = clickDialogConfirm(['确认', '确定', '继续发布', '提交', '发布'])
    if (confirm.ok) return confirm
    return { ok: false, text: '' }
  }

  function findMobileDetailEditButton() {
    const contextRegex = /(手机端详情描述|手机端详情|手机详情|无线端详情|移动端详情)/
    const scoped = getAccessibleDocuments().flatMap(doc => {
      if (typeof doc.querySelectorAll !== 'function') return []
      return Array.from(doc.querySelectorAll('div,section,article,li,tr,td') || [])
        .filter(root => isVisibleElement(root) && contextRegex.test(elementText(root)))
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

  function clickMobileImportDetail() {
    if (mobileEditorSignals().importPc) return { ok: true, text: '导入电脑端详情已可见' }
    return clickVisibleActionByText(['导入详情'], {
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

  function clickMobileFullImageGenerate() {
    return clickVisibleActionByText(['全图生成'], {
      allowContains: true,
      maxTextLength: 24,
      preferRight: true,
    })
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

  function markRowsWithResult(rows, status, result, note) {
    return buildOutputStatusRows(rows, status, note).map(row => ({
      ...row,
      '执行结果': result || row['执行结果'] || '',
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

  function groupRowsByCategory(rows) {
    const grouped = Object.fromEntries(CATEGORY_ORDER.map(category => [category, []]))
    for (const row of Array.isArray(rows) ? rows : []) {
      const category = row.__category || ''
      if (grouped[category]) grouped[category].push(row)
    }
    return grouped
  }

  function hasDownloadedPcDetailRows(rows) {
    return successfulRows(rows).some(row => row.__category === 'pc_detail')
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

  function tmallUploadParamsForCategory(category) {
    if (category === 'vertical') return { picType: 'vertical' }
    return { type: 'picture', picType: 'image' }
  }

  async function uploadFileToTmall(file, category) {
    const form = new FormData()
    form.append('itemImage', file, file.name || 'image.jpg')
    const paramsForCategory = tmallUploadParamsForCategory(category)
    for (const [key, value] of Object.entries(paramsForCategory)) {
      form.append(key, String(value))
    }
    const response = await fetch('/tmall/uploadImage', {
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
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`)
    if (!payload || String(payload.code) !== '0' || !payload.imgURL) {
      throw new Error(payload?.errorInfo || payload?.message || '上传接口未返回 imgURL')
    }
    return String(payload.imgURL || '').trim()
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
  const LOWER_PRESERVE_ANCHOR_RE = /(模特信息|模特展示|宝贝模特|吊牌|吊牌展示|洗涤|水洗|洗唛|品牌介绍|品牌故事|宝贝故事|品牌说明|底部固定|宝贝底部|售后)/i
  const INFO_ANCHOR_RE = /(商品信息|宝贝信息|产品信息|想要的信息看这里|基础信息|基本信息|商品参数|宝贝参数)/i
  const FIXED_TOP_ANCHOR_RE = /(促销专区|抖音固定图|顶部展示|dy顶部图|顶部固定|固定图|底部固定|童装销售额|全亚洲|品牌背书|balabala|balaone)/i

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

  function isStopAnchorText(value) {
    return isSizeAnchorText(value) || isLowerPreserveAnchorText(value)
  }

  function isInfoAnchorText(value) {
    return INFO_ANCHOR_RE.test(String(value || ''))
  }

  function isFixedTopAnchorText(value) {
    return FIXED_TOP_ANCHOR_RE.test(String(value || ''))
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
          isStopAnchor: isStopAnchorText(context),
          isInfoAnchor: isInfoAnchorText(context),
          isFixedTop: isFixedTopAnchorText(context),
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
    const stopAnchorRe = new RegExp(`${SIZE_ANCHOR_RE.source}|${LOWER_PRESERVE_ANCHOR_RE.source}`, 'gi')
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
    if (!/旧描述/.test(compact(module.name))) return false
    return !images.some(image => image.isSizeAnchor || image.isInfoAnchor)
  }

  function shouldPreserveFirstDetailImage(firstImage) {
    return !!firstImage && (firstImage.isFixedTop || isFixedTopAnchorText(firstImage.moduleName) || isFixedTopAnchorText(firstImage.context))
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
      return false
    }).length
  }

  function findStopBoundary(modules, images, firstImage, preserveFirstImage) {
    const minGlobalIndex = firstImage.globalIndex + (preserveFirstImage ? 1 : 0)
    const imageBoundary = images.find(image => image.globalIndex >= minGlobalIndex && image.isStopAnchor)
    if (imageBoundary) {
      return {
        type: 'image',
        image: imageBoundary,
        moduleIndex: imageBoundary.moduleIndex,
        globalIndex: imageBoundary.globalIndex,
        moduleName: imageBoundary.moduleName,
        anchorKind: imageBoundary.isSizeAnchor ? 'size' : 'lower_preserve',
      }
    }

    const list = Array.isArray(modules) ? modules : []
    for (let index = firstImage.moduleIndex + (preserveFirstImage ? 1 : 0); index < list.length; index += 1) {
      const module = list[index] || {}
      const name = compact(module.name)
      if (!isStopAnchorText(name)) continue
      if (index === firstImage.moduleIndex) continue
      return {
        type: 'module',
        module,
        moduleIndex: index,
        globalIndex: images.find(image => image.moduleIndex >= index)?.globalIndex,
        moduleName: name,
        anchorKind: isSizeAnchorText(name) ? 'size' : 'lower_preserve',
      }
    }

    return null
  }

  function replaceAnchoredDetailContent(modules, firstImage, stopBoundary, detailHtml, options = {}) {
    const sourceModules = (Array.isArray(modules) ? modules : []).map(module => ({ ...module }))
    const startModuleIndex = firstImage.moduleIndex
    const endModuleIndex = stopBoundary.moduleIndex
    const preserveFirstImage = !!options.preserveFirstImage
    const startContent = String(sourceModules[startModuleIndex]?.content || '')
    const startBoundary = replacementStartBoundary(startContent, firstImage, preserveFirstImage)
    const endContent = String(sourceModules[endModuleIndex]?.content || '')
    const endBoundary = stopBoundary.type === 'module'
      ? 0
      : anchorBlockStartBeforeImage(endContent, stopBoundary.image.start, stopBoundary.image.moduleName)
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
    const detailHtml = options.probeOnly ? '<!-- crawshrimp pc detail probe -->' : buildPcDetailHtml(detailUrls)
    if (!detailHtml) {
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
    if (!images.length) {
      return {
        ok: false,
        modules: currentModules,
        note: 'PC详情中未识别到图片，已阻止自动替换',
        mode: 'blocked_no_images',
      }
    }
    if (isLegacySingleDescription(currentModules, images)) {
      return {
        ok: false,
        modules: currentModules,
        note: '旧描述单模块未识别到结构化标题或尺码视觉锚点，已按保守模式阻止自动替换',
        mode: 'blocked_legacy_visual_anchor_missing',
      }
    }

    const firstImage = images[0]
    const preserveFirstImage = shouldPreserveFirstDetailImage(firstImage)
    const stopBoundary = findStopBoundary(currentModules, images, firstImage, preserveFirstImage)
    if (!stopBoundary) {
      return {
        ok: false,
        modules: currentModules,
        note: '未识别到可保留的详情下半区锚点（尺码表/尺码测量/尺码推荐/宝贝尺寸/模特/吊牌/洗涤/品牌故事等），已阻止自动替换',
        mode: 'blocked_stop_anchor_missing',
      }
    }

    const replaceStartIndex = firstImage.globalIndex + (preserveFirstImage ? 1 : 0)
    const replacedImageCount = imageCountBeforeBoundary(images, firstImage, stopBoundary, preserveFirstImage)
    if (replacedImageCount <= 0 && stopBoundary.type === 'image' && stopBoundary.moduleIndex === firstImage.moduleIndex) {
      return {
        ok: false,
        modules: currentModules,
        note: '可替换区与保留锚点在同一图片块内且没有安全插入位置，已阻止自动替换',
        mode: 'blocked_empty_replace_range',
      }
    }

    const modules = options.probeOnly
      ? currentModules
      : replaceAnchoredDetailContent(currentModules, firstImage, stopBoundary, detailHtml, { ...options, preserveFirstImage })
    const stopImage = stopBoundary.type === 'image' ? stopBoundary.image : null
    const stopAnchor = stopImage || {
      moduleIndex: stopBoundary.moduleIndex,
      moduleName: stopBoundary.moduleName,
      imageIndex: -1,
      globalIndex: stopBoundary.globalIndex,
      src: '',
      context: stopBoundary.moduleName,
    }
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
      sizeImage: stopAnchor,
      stopAnchor,
      preserveFirstImage,
      stopBoundaryType: stopBoundary.type,
      stopAnchorKind: stopBoundary.anchorKind,
      note: replacedImageCount > 0
        ? `PC详情锚点区间替换：${preserveFirstImage ? '保留首图，' : ''}替换第${replaceStartIndex + 1}到第${replaceStartIndex + replacedImageCount}张图，${stopBoundary.anchorKind === 'size' ? '尺码锚点' : '下半区锚点'}及以下保留`
        : `PC详情锚点区间插入：${preserveFirstImage ? '保留首图，' : ''}在${stopBoundary.anchorKind === 'size' ? '尺码锚点' : '下半区锚点'}前插入新PC详情图，锚点及以下保留`,
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
      : `旧版文本PC详情未识别到可靠文本锚点（尺码表/尺码测量/尺码推荐/宝贝尺寸/模特/吊牌/洗涤/品牌故事等），已按保守模式阻止自动替换`
    return {
      ...result,
      target: 'tmDescription',
      html: nextHtml,
      sourceHtml: currentHtml,
      note,
    }
  }

  function buildTmallComponentValues(uploadedByCategory, currentValues = {}) {
    const main1x1 = [
      ...(uploadedByCategory.main_1x1 || []),
      ...(uploadedByCategory.micro_1x1 || []),
    ].map(item => ({ url: item.url, pix: item.pix, width: item.width ? String(item.width) : undefined, height: item.height ? String(item.height) : undefined }))
    const main3x4 = [
      ...(uploadedByCategory.main_3x4 || []),
      ...(uploadedByCategory.micro_3x4 || []),
    ].map(item => ({ url: item.url }))
    const vertical = (uploadedByCategory.vertical || []).slice(0, 1).map(item => ({ url: item.url }))
    const detailUrls = (uploadedByCategory.pc_detail || []).map(item => item.url)
    const currentGuide = currentValues.guideImageGroup && typeof currentValues.guideImageGroup === 'object' ? currentValues.guideImageGroup : {}
    const currentModules = Array.isArray(currentValues.modularDesc) ? currentValues.modularDesc : []
    const currentTmDescription = typeof currentValues.tmDescription === 'string' ? currentValues.tmDescription : ''
    const pcDetailReplacement = currentModules.length
      ? buildAnchoredPcDetailModules(currentModules, detailUrls)
      : buildAnchoredPcDetailHtml(currentTmDescription, detailUrls)
    const modularDesc = currentModules.length && pcDetailReplacement.ok ? pcDetailReplacement.modules : undefined
    const tmDescription = !currentModules.length && pcDetailReplacement.ok ? pcDetailReplacement.html : undefined
    return {
      mainImagesGroup: main1x1.length ? { images: main1x1 } : undefined,
      threeToFourImages: main3x4.length ? main3x4 : undefined,
      guideImageGroup: vertical.length ? { ...currentGuide, verticalImage: vertical } : undefined,
      modularDesc,
      tmDescription,
      detailHtml: pcDetailReplacement.detailHtml || '',
      pcDetailReplacement,
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
    const payload = {
      isLightCombine: global.isLightCombine,
      isSetsCombine: global.isSetsCombine,
      combineToNormal: global.combineToNormal,
      tmSpuPublishType: global.tmSpuPublishType,
      isUnBondedGift: global.isUnBondedGift,
      spu_qf_param: global.spu_qf_param,
      catId: global.catId,
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
        ;['msg', 'message', 'error', 'errorInfo', 'errorMsg', 'content'].forEach(key => {
          if (typeof value[key] === 'string') visit(value[key], depth + 1)
        })
        if (value.message && Array.isArray(value.message)) visit(value.message, depth + 1)
      }
    }
    visit(payload)
    return messages.filter(Boolean)
  }

  function apiResponseLooksSuccessful(payload) {
    if (!payload || typeof payload !== 'object') return false
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
    try {
      const response = await Promise.race([
        fetch(action, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'x-requested-with': 'XMLHttpRequest',
          },
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
    if (submitComponent) {
      const emitted = emitComponentEvent(submitComponent, 'click')
      if (emitted.ok) return { ...emitted, ok: true, note: `已通过天猫发布页 API 触发 ${submitComponent}` }
    }

    const payload = buildTmallSubmitPayload(getTmallFormValues(), getTmallGlobal(), options)
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
      let visible = false
      try {
        visible = !!engine?.getComponent?.(name)?.getProps?.()?.visible
      } catch (error) {}
      if (!visible) continue
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

  function buildShenbiMobileValueFromPcModules(modularDesc, currentValue = {}, sizeByUrl = {}) {
    const urls = extractPcDetailUrlsFromModules(modularDesc)
    const current = currentValue && typeof currentValue === 'object' ? currentValue : {}
    const descContainer = current.descContainer && typeof current.descContainer === 'object' ? current.descContainer : {}
    return {
      ...jsonClone(current),
      cid: current.cid || 0,
      descContainer: {
        ...jsonClone(descContainer),
        detail: buildWapDescDetailFromUrls(urls, sizeByUrl),
      },
      empty: urls.length === 0,
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

  async function generateMobileDescByApi(modularDesc, timeoutMs = 5000) {
    const detailHtml = (Array.isArray(modularDesc) ? modularDesc : [])
      .map(module => String(module?.content || ''))
      .join('')
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

  function applyFormValue(name, value) {
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
      }
      const componentResult = applyComponentValue(name, value)
      return {
        ok: true,
        method: componentResult.ok ? `form_model+${componentResult.method}` : 'form_model',
        componentResult,
      }
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) }
    }
  }

  async function syncMobileDetailByApi(modularDesc, options = {}) {
    const currentValues = getTmallFormValues()
    const sizeByUrl = buildImageSizeMapFromUploadedCategory(options.uploadedByCategory || {})
    const urls = extractPcDetailUrlsFromModules(modularDesc)
    if (!urls.length) return { ok: false, reason: 'PC详情中未识别到图片，无法生成手机端详情' }

    const generated = await generateMobileDescByApi(modularDesc, options.timeoutMs || 5000)
    const mobileValue = buildShenbiMobileValueFromPcModules(modularDesc, currentValues.descForShenbiMobile, sizeByUrl)
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

  function applyComponentValue(name, value) {
    const state = getSellState()
    const engine = state?.engine
    if (value === undefined) return { ok: true, method: 'skip' }
    if (!engine) return { ok: false, reason: '发布页引擎未就绪' }
    try {
      const component = typeof engine.getComponent === 'function' ? engine.getComponent(name) : null
      if (component && typeof component.emit === 'function') {
        component.emit('change', value)
        return { ok: true, method: 'emit' }
      }
      if (component && typeof component.setProps === 'function') {
        component.setProps({ value })
        return { ok: true, method: 'setProps' }
      }
      const core = engine._engine?._core
      const eventIds = core?.eventCenter?.comIdToEventIds?.[name]
      const targetId = Array.isArray(eventIds) ? eventIds[0] : name
      if (core && typeof core.changeElementValue === 'function') {
        core.changeElementValue(targetId, value, { trace: { source: 'crawshrimp-tmall-packaging', type: 'script' } })
        return { ok: true, method: 'changeElementValue' }
      }
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) }
    }
    return { ok: false, reason: `未找到组件：${name}` }
  }

  function buildOutputStatusRows(rows, tmallStatus, note) {
    return (Array.isArray(rows) ? rows : []).map(row => ({
      ...row,
      '天猫货号': tmallStatus?.merchantCode || '',
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
      publish_stage: '',
      pc_publish_note: '',
      mobile_sync_note: '',
      mobile_sync_api_result: null,
      applied_modular_desc: null,
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
      buildAnchoredPcDetailModules,
      buildAnchoredPcDetailHtml,
      buildTmallComponentValues,
      buildTmallSubmitPayload,
      extractPcDetailUrlsFromModules,
      buildWapDescDetailFromUrls,
      buildShenbiMobileValueFromPcModules,
      resolvePackagingSourceConfig,
      collectPackagingAssets,
      validateInjectedAsset,
      finalizeRows,
      mobileEditorSignals,
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
        ...shared,
        current_job: job,
        mount_id: sourceConfig.mountId,
        mount_name: sourceConfig.mountName,
        cloud_path: sourceConfig.rawPath,
        relative_path: sourceConfig.relativePath,
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
        relativePath: shared.relative_path,
      })
      const rows = shared.source_warning && plan.rows.length
        ? plan.rows.map((row, index) => index === 0 ? appendRowNote(row, shared.source_warning) : row)
        : plan.rows
      const nextShared = {
        ...shared,
        current_result_rows: rows,
        pending_download_items: plan.downloadItems,
        plan_summary: {
          total: plan.plan.total,
          selected: plan.plan.selected,
          missing: plan.plan.missing,
          searchCount: plan.plan.searchCount,
          folderCount: plan.plan.folderCount,
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
        return nextPhase('wait_tmall_ready', 2500, { ...shared, tmall_wait_attempts: 0 })
      }
      if (!location.href.includes(`id=${itemId}`)) {
        location.href = targetUrl
        return nextPhase('wait_tmall_ready', 2500, { ...shared, tmall_wait_attempts: 0 })
      }
      return nextPhase('wait_tmall_ready', 0, shared)
    }

    if (phase === 'wait_tmall_ready') {
      const job = shared.current_job || {}
      const status = extractTmallStatus(job)
      if (!status.ready) {
        const attempts = Number(shared.tmall_wait_attempts || 0)
        if (attempts < 30) {
          return nextPhase('wait_tmall_ready', 1000, {
            ...shared,
            tmall_wait_attempts: attempts + 1,
            current_store: `等待天猫编辑页 ${attempts + 1}/30`,
          })
        }
        const rows = buildOutputStatusRows(shared.current_result_rows, status, '天猫编辑页未就绪')
        return advanceToNextJob(rows, { ...shared, current_result_rows: rows, tmall_status: status })
      }
      if (status.hasReturnOldDescription) {
        const attempts = Number(shared.legacy_switch_attempts || 0)
        if (attempts < 3 && clickReturnOldDescriptionSwitch()) {
          return nextPhase('wait_tmall_ready', 2500, {
            ...shared,
            legacy_switch_attempts: attempts + 1,
            current_store: `切回旧版图文描述 ${attempts + 1}/3`,
          })
        }
      }
      if (job.block_on_style_mismatch && status.merchantCode && job.style_code && !merchantCodeMatchesStyle(status.merchantCode, job.style_code)) {
        const rows = buildOutputStatusRows(
          shared.current_result_rows,
          status,
          `已阻止上传：页面货号 ${status.merchantCode} 与云盘款号 ${job.style_code} 不一致`,
        ).map(row => row['上传结果'] ? row : { ...row, '上传结果': '已阻止', '执行结果': row['执行结果'] || '货号不一致' })
        return advanceToNextJob(rows, { ...shared, current_result_rows: rows, tmall_status: status })
      }
      if (hasDownloadedPcDetailRows(shared.current_result_rows)) {
        const replacementProbe = currentPcDetailReplacementProbe()
        if (!replacementProbe.ok) {
          const rows = buildOutputStatusRows(
            shared.current_result_rows,
            status,
            replacementProbe.note || 'PC详情锚点未识别，已阻止自动替换',
          ).map(row => row['上传结果'] ? row : { ...row, '上传结果': '已阻止', '执行结果': '预检阻止' })
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
      }

      const uploadedByPath = new Map(uploadedRows.map(row => [row['本地文件'], row]))
      const rows = shared.current_result_rows.map(row => uploadedByPath.get(row['本地文件']) || row)
      return nextPhase('apply_tmall_draft', 0, {
        ...shared,
        current_result_rows: rows,
        uploaded_by_category: uploadedByCategory,
      })
    }

    if (phase === 'apply_tmall_draft') {
      const uploadedByCategory = shared.uploaded_by_category || {}
      const componentValues = buildTmallComponentValues(uploadedByCategory, {
        guideImageGroup: getComponentValue('guideImageGroup'),
        modularDesc: getComponentValue('modularDesc'),
        tmDescription: getLegacyPcDetailHtml(),
      })
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
      const applied = {
        mainImagesGroup: applyComponentValue('mainImagesGroup', componentValues.mainImagesGroup),
        threeToFourImages: applyComponentValue('threeToFourImages', componentValues.threeToFourImages),
        guideImageGroup: applyComponentValue('guideImageGroup', componentValues.guideImageGroup),
        modularDesc: applyComponentValue('modularDesc', componentValues.modularDesc),
        tmDescription: applyFormValue('tmDescription', componentValues.tmDescription),
      }
      if (componentValues.tmDescription !== undefined) {
        applied.tmDescriptionDom = applyLegacyPcDetailDom(componentValues.tmDescription)
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
      const applyNote = [componentApplyNote, replacementNote].filter(Boolean).join('；')
      const rows = buildOutputStatusRows(
        shared.current_result_rows,
        afterStatus,
        applyNote || '已写入天猫编辑页草稿；未点击提交发布；手机端详情仍需在页面确认导入PC详情',
      )
      if (isFullPublishMode(shared.current_job?.execute_mode)) {
        if (hasApplyFailure) {
          const failedRows = rows.map(row => ({ ...row, '执行结果': '草稿写入失败' }))
          return advanceToNextJob(failedRows, {
            ...shared,
            current_result_rows: failedRows,
            tmall_status_after_apply: afterStatus,
            applied_components: applied,
          })
        }
        return nextPhase('submit_pc_publish', 800, {
          ...shared,
          current_result_rows: rows,
          tmall_status_after_apply: afterStatus,
          applied_components: applied,
          applied_modular_desc: componentValues.modularDesc || componentValues.pcDetailReplacement?.modules || getComponentValue('modularDesc'),
          publish_wait_attempts: 0,
          publish_stage: 'pc',
          current_store: '提交PC端详情发布',
        })
      }
      return advanceToNextJob(rows, {
        ...shared,
        current_result_rows: rows,
        tmall_status_after_apply: afterStatus,
        applied_components: applied,
        applied_modular_desc: componentValues.modularDesc || componentValues.pcDetailReplacement?.modules || getComponentValue('modularDesc'),
      })
    }

    if (phase === 'submit_pc_publish' || phase === 'submit_final_publish') {
      const stage = phase === 'submit_final_publish' ? 'final' : 'pc'
      const apiSubmit = await submitTmallPublishByApi({
        itemId: shared.current_job?.item_id || '',
        timeoutMs: 15000,
      })
      if (apiSubmit.ok) {
        return nextPhase('wait_publish_result', 1500, {
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

      const clicked = clickSubmitPublishButton()
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
        return failCurrentJob(`API提交失败：${apiSubmit.reason || '未知原因'}；且未找到${stage === 'pc' ? 'PC端' : '最终'}提交发布按钮`, '发布失败')
      }
      return nextPhase('wait_publish_result', 1500, {
        ...shared,
        publish_stage: stage,
        submit_click_attempts: 0,
        publish_wait_attempts: 0,
        last_submit_method: 'dom_click_fallback',
        current_store: stage === 'pc' ? '等待PC端提交发布结果' : '等待最终提交发布结果',
      })
    }

    if (phase === 'wait_publish_result') {
      const stage = shared.publish_stage || 'pc'
      const publishStatus = extractPublishStatus(shared.current_job || {})
      const apiConfirm = confirmPublishByApiIfPresent()
      if (apiConfirm.ok) {
        return nextPhase('wait_publish_result', 1500, {
          ...shared,
          publish_wait_attempts: Number(shared.publish_wait_attempts || 0) + 1,
          last_confirm_method: apiConfirm.method,
          current_store: `${stage === 'pc' ? 'PC端' : '最终'}API确认：${apiConfirm.component || ''}`,
        })
      }
      const confirm = clickPublishConfirmIfPresent()
      if (confirm.ok) {
        return nextPhase('wait_publish_result', 1500, {
          ...shared,
          publish_wait_attempts: Number(shared.publish_wait_attempts || 0) + 1,
          last_confirm_method: 'dom_click_fallback',
          current_store: `${stage === 'pc' ? 'PC端' : '最终'}提交发布确认：${confirm.text || '确认'}`,
        })
      }
      if ((publishStatus.validationMessages || []).length) {
        return failCurrentJob(
          `${stage === 'pc' ? 'PC端' : '最终'}提交发布被页面校验阻止：${publishStatus.validationMessages.join('；')}`,
          '发布失败',
        )
      }
      if (publishStatus.success) {
        if (stage === 'pc') {
          return nextPhase('reopen_after_pc_publish', 1200, {
            ...shared,
            pc_publish_note: 'PC端详情已提交发布',
            publish_wait_attempts: 0,
            current_store: '重新进入编辑页同步手机端详情',
          })
        }
        const finalNote = compact([
          shared.pc_publish_note,
          shared.mobile_sync_note,
          '最终提交发布成功，更新完毕',
        ].filter(Boolean).join('；'))
        const rows = markRowsWithResult(shared.current_result_rows, publishStatus, '更新完成', finalNote)
        return advanceToNextJob(rows, {
          ...shared,
          current_result_rows: rows,
          final_publish_status: publishStatus,
        })
      }

      const attempts = Number(shared.publish_wait_attempts || 0)
      if (attempts < 12) {
        return nextPhase('wait_publish_result', 1500, {
          ...shared,
          publish_wait_attempts: attempts + 1,
          current_store: `${stage === 'pc' ? 'PC端' : '最终'}提交发布等待 ${attempts + 1}/12`,
        })
      }
      if (stage === 'pc') {
        return nextPhase('reopen_after_pc_publish', 1200, {
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

    if (phase === 'reopen_after_pc_publish') {
      const itemId = shared.current_job?.item_id || ''
      const targetUrl = `${TMALL_PUBLISH_URL}?id=${encodeURIComponent(itemId)}`
      if (!shared.reopened_after_pc_publish) {
        if (location.href.startsWith(TMALL_PUBLISH_URL) && location.href.includes(`id=${itemId}`)) {
          try {
            location.reload()
          } catch (error) {
            location.href = targetUrl
          }
        } else {
          location.href = targetUrl
        }
        return nextPhase('wait_reopened_tmall_ready', 2500, {
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
        const attempts = Number(shared.tmall_wait_attempts || 0)
        if (attempts < 30) {
          return nextPhase('wait_reopened_tmall_ready', 1000, {
            ...shared,
            tmall_wait_attempts: attempts + 1,
            current_store: `等待重新进入编辑页 ${attempts + 1}/30`,
          })
        }
        return failCurrentJob('PC端发布后重新进入编辑页超时，未继续同步手机端详情', '手机端同步失败')
      }
      return nextPhase('sync_mobile_detail_api', 800, {
        ...shared,
        tmall_wait_attempts: 0,
        current_store: '通过API同步手机端详情',
      })
    }

    if (phase === 'sync_mobile_detail_api') {
      const modularDesc = Array.isArray(shared.applied_modular_desc)
        ? shared.applied_modular_desc
        : getComponentValue('modularDesc')
      const synced = await syncMobileDetailByApi(modularDesc, {
        uploadedByCategory: shared.uploaded_by_category || {},
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
      const clicked = clickMobileDetailEditButton()
      if (!clicked.ok) {
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
      return nextPhase('wait_mobile_editor_ready', 1500, {
        ...shared,
        mobile_action_attempts: 0,
        mobile_wait_attempts: 0,
        current_store: '等待手机端详情编辑器',
      })
    }

    if (phase === 'wait_mobile_editor_ready') {
      const signals = mobileEditorSignals()
      if (signals.ready) {
        return nextPhase('open_mobile_module_menu', 500, {
          ...shared,
          mobile_wait_attempts: 0,
          current_store: '打开手机端模块菜单',
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
      const opened = clickMobileImportMenu()
      if (!opened.ok) {
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
      return nextPhase('click_mobile_import_detail', 600, {
        ...shared,
        mobile_action_attempts: 0,
        current_store: '选择导入详情',
      })
    }

    if (phase === 'click_mobile_import_detail') {
      const clicked = clickMobileImportDetail()
      if (!clicked.ok) {
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
      return nextPhase('click_mobile_import_pc_detail', 600, {
        ...shared,
        mobile_action_attempts: 0,
        current_store: '选择导入电脑端详情',
      })
    }

    if (phase === 'click_mobile_import_pc_detail') {
      const clicked = clickMobileImportPcDetail()
      if (!clicked.ok) {
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
      return nextPhase('select_mobile_full_image', 1000, {
        ...shared,
        mobile_action_attempts: 0,
        current_store: '选择全图生成',
      })
    }

    if (phase === 'select_mobile_full_image') {
      const clicked = clickMobileFullImageGenerate()
      if (!clicked.ok) {
        const attempts = Number(shared.mobile_action_attempts || 0)
        if (attempts < 10) {
          return nextPhase('select_mobile_full_image', 800, {
            ...shared,
            mobile_action_attempts: attempts + 1,
            current_store: `选择全图生成 ${attempts + 1}/10`,
          })
        }
        return failCurrentJob('未找到“全图生成”选项', '手机端同步失败')
      }
      return nextPhase('confirm_mobile_import_pc_detail', 800, {
        ...shared,
        mobile_action_attempts: 0,
        current_store: '确认导入电脑端详情',
      })
    }

    if (phase === 'confirm_mobile_import_pc_detail') {
      clickDialogConfirm(['确认', '确定', '生成', '导入'])
      return nextPhase('finish_mobile_editor', 1500, {
        ...shared,
        current_store: '完成手机端详情编辑',
      })
    }

    if (phase === 'finish_mobile_editor') {
      const finished = clickMobileFinishEdit()
      if (!finished.ok) {
        const attempts = Number(shared.mobile_action_attempts || 0)
        if (attempts < 10) {
          return nextPhase('finish_mobile_editor', 1000, {
            ...shared,
            mobile_action_attempts: attempts + 1,
            current_store: `完成手机端详情编辑 ${attempts + 1}/10`,
          })
        }
        return failCurrentJob('未找到“确认并完成编辑/完成编辑”按钮', '手机端同步失败')
      }
      return nextPhase('wait_after_mobile_finish', 1800, {
        ...shared,
        mobile_action_attempts: 0,
        mobile_wait_attempts: 0,
        mobile_sync_note: '手机端详情已清空模块并导入电脑端详情（全图生成）',
        current_store: '返回商品编辑页准备最终提交',
      })
    }

    if (phase === 'wait_after_mobile_finish') {
      clickDialogConfirm(['确认', '确定'])
      const status = extractTmallStatus(shared.current_job || {})
      const submitButton = findVisibleActionByText(['提交发布', '提交并发布', '立即发布', '提交'], {
        allowContains: true,
        maxTextLength: 24,
        preferBottom: true,
        preferRight: true,
        exclude: ['保存草稿', '仅保存', '预览', '取消'],
      })
      if (status.ready && submitButton) {
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
    return {
      success: false,
      error: String(error?.message || error),
    }
  }
})()
