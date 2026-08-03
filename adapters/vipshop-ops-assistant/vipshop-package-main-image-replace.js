;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const SUMMARY_SHEET = '执行摘要'
  const DETAIL_SHEET = '包装主图替换计划'
  const SEMIR_ENTRY_URL = 'https://fmp.semirapp.com/web/index#/home/file'
  const VIPSHOP_NOV_ENTRY_URL = 'https://nov-admin.vip.com/admin/index.html#/normal/normalMerchandise'
  const VIPSHOP_MERCHANDISE_QUERY_URL = 'https://nov-admin.vip.com/normal/normalMerchandiseQuery'
  const PDC_PRODUCT_DETAIL_URL = 'https://pdc-portal.vip.com/product/queryVendorProductByVpIdForVc'
  const PDC_UNPUBLISH_URL = 'https://pdc-portal.vip.com/product/unPublishProduct'
  const PDC_PUBLISH_URL = 'https://pdc-portal.vip.com/product/publishProduct'
  const PDC_UPLOAD_SQUARE_IMAGE_URL = 'https://pdc-portal.vip.com/product/uploadSquareImage'
  const UPLOAD_INPUT_ID = 'crawshrimp-vipshop-package-main-image-files'
  const UPLOAD_INPUT_SELECTOR = `#${UPLOAD_INPUT_ID}`
  const DEFAULT_PAGE_SIZE = 200
  const DEFAULT_MAX_PAGES = 20
  const SEARCH_SCOPE = '["filename", "tag"]'
  const SEARCH_PAGE_SIZE = 100
  const FOLDER_PAGE_SIZE = 100
  const DOWNLOAD_CONCURRENCY = 8
  const DOWNLOAD_RETRY_ATTEMPTS = 3
  const DOWNLOAD_RETRY_DELAY_MS = 1200
  const SEARCH_FALLBACK_ASSET_BUDGET = 1200
  const DEFAULT_FOLDER_SCAN_DEPTH = 5
  const DEFAULT_PACKAGE_SEMIR_CLOUD_PATH = '巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/'
  const DEFAULT_SEMIR_CLOUD_PATH = DEFAULT_PACKAGE_SEMIR_CLOUD_PATH
  const DEFAULT_MAIN_IMAGE_SEMIR_CLOUD_ROOT = '巴拉巴拉品牌事业部-市场系统//品牌视觉部/'
  const DEFAULT_MAIN_IMAGE_PATH_FEATURES = ['主图打标', '京东唯品', '回图/唯品']
  const OCR_DEFAULT_MAX_IMAGES = Number.POSITIVE_INFINITY
  const OCR_PER_IMAGE_TIMEOUT_MS = 18000
  const OCR_TOTAL_TIMEOUT_MS = 120000
  const CRAW_SHRIMP_LOCAL_BASE_URL = 'http://127.0.0.1:18765'
  const TESSERACT_VENDOR_PATH = '/adapter-assets/tmall-ops-assistant/vendor/tesseract'
  const TESSERACT_LANG = 'chi_sim+eng'
  const SEMIR_LOGIN_WAIT_MS = Math.max(1000, Number(params.semir_login_wait_ms || 60000) || 60000)
  const SEMIR_LOGIN_RETRY_MS = Math.min(5000, Math.max(1000, Number(params.semir_login_retry_ms || 5000) || 5000))
  const SEMIR_LOGIN_WAIT_MAX_ATTEMPTS = Math.max(1, Math.ceil(SEMIR_LOGIN_WAIT_MS / SEMIR_LOGIN_RETRY_MS))
  const VIPSHOP_PAGE_WAIT_MS = Math.max(1000, Number(params.vipshop_page_wait_ms || 3000) || 3000)
  const VIPSHOP_SAVE_WAIT_MS = Math.max(2000, Number(params.vipshop_save_wait_ms || 6000) || 6000)
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'])
  const LIVE_AUTH_MESSAGE = '线上替换需要 execute_mode=live 且 allow_live=true；本脚本会取消审核/撤回、上传图片、保存并提交审核。'

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function normalizeCode(value) {
    return compact(value).replace(/[\s"'`]+/g, '').toUpperCase()
  }

  function normalizeComparableCode(value) {
    return normalizeCode(value).replace(/[^0-9A-Z]+/g, '')
  }

  function normalizeHeader(value) {
    return normalizeCode(value).replace(/[：:（）()\-_./\\]/g, '')
  }

  function normalizePath(value) {
    return compact(value).replace(/\\/g, '/')
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

  function naturalCompare(a, b) {
    return String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN', {
      numeric: true,
      sensitivity: 'base',
    })
  }

  function pathSegments(fullpath) {
    return normalizePath(fullpath).split('/').map(compact).filter(Boolean)
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function equalsStyleCodeSegment(value, code) {
    const text = compact(value).toLowerCase()
    const target = compact(code).toLowerCase()
    return !!text && !!target && text === target
  }

  function startsWithCodeToken(value, code) {
    const text = compact(value).toLowerCase()
    const target = compact(code).toLowerCase()
    if (!text || !target) return false
    return new RegExp(`^${escapeRegExp(target)}(?:$|[\\s_\\-])`, 'i').test(text)
  }

  function isProductPackagingSegment(segment) {
    const text = compact(segment)
    return /^0?1[-_\s]*产品包装$/i.test(text) || /^(?:\d+)?包装图(?:示)?$/i.test(text) || /产品包装/.test(text)
  }

  function isUnderProductPackagingDirectory(fullpath) {
    return pathSegments(fullpath).some(isProductPackagingSegment)
  }

  function rowValue(row, aliases) {
    const wanted = new Set((aliases || []).map(normalizeHeader))
    for (const [key, value] of Object.entries(row || {})) {
      if (wanted.has(normalizeHeader(key)) && compact(value)) return compact(value)
    }
    return ''
  }

  function positiveInt(value, fallback = 0) {
    const number = Number.parseInt(value, 10)
    return Number.isFinite(number) && number > 0 ? number : fallback
  }

  function collectFileRows(file) {
    const rows = []
    const seen = new Set()
    const pushRows = items => {
      for (const row of Array.isArray(items) ? items : []) {
        if (!row || typeof row !== 'object') continue
        const key = JSON.stringify(row)
        if (seen.has(key)) continue
        seen.add(key)
        rows.push(row)
      }
    }
    const sheets = file?.sheets && typeof file.sheets === 'object' ? file.sheets : null
    if (sheets && Object.keys(sheets).length) {
      for (const sheet of Object.values(sheets)) pushRows(sheet?.rows)
    } else {
      pushRows(file?.rows)
    }
    return rows
  }

  function excelRowNumber(row, index) {
    return positiveInt(row?.__row_number || row?.__row_no || row?.row_no || row?.行号 || row?.源表行号, index + 2)
  }

  function splitCodes(value) {
    if (Array.isArray(value)) return value.map(normalizeCode).filter(Boolean)
    return String(value || '')
      .split(/[\n,，、;；\t ]+/)
      .map(normalizeCode)
      .filter(Boolean)
  }

  function normalizeExecuteMode(value) {
    const mode = compact(value).toLowerCase()
    if (['live', 'upload', 'upload_and_submit', 'save_and_submit', 'replace'].includes(mode)) return 'live'
    return 'plan'
  }

  function hasScope(scope, key) {
    if (!scope || (Array.isArray(scope) && scope.length === 0)) return true
    if (Array.isArray(scope)) return scope.includes(key)
    return String(scope).split(/[,，、\s]+/).includes(key)
  }

  function truthy(value) {
    if (value === true) return true
    const text = compact(value).toLowerCase()
    return ['1', 'true', 'yes', 'y', 'on', '是'].includes(text)
  }

  function falsey(value) {
    if (value === false) return true
    const text = compact(value).toLowerCase()
    return ['0', 'false', 'no', 'n', 'off', '否'].includes(text)
  }

  function shouldUseCloudLookup(rawParams = params, rawShared = shared) {
    if (truthy(rawParams.use_semir_cloud) || truthy(rawParams.use_cloud_lookup)) return true
    if (falsey(rawParams.use_semir_cloud) || falsey(rawParams.use_cloud_lookup)) return false
    if (
      rawParams.cloud_path || rawParams.semir_path || rawParams.candidate_cloud_paths || rawParams.fallback_cloud_paths
      || rawParams.main_image_cloud_path || rawParams.main_image_cloud_root
      || rawParams.main_image_candidate_cloud_paths || rawParams.main_image_fallback_cloud_paths
    ) return true
    return collectAssetFiles(rawParams, rawShared).length === 0
  }

  function allowLiveExecution(rawParams = params) {
    return normalizeExecuteMode(rawParams.execute_mode) === 'live'
      && (truthy(rawParams.allow_live) || truthy(rawParams.allow_save) || truthy(rawParams.confirm_live))
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

  function normalizeCandidateCloudPaths(value, styleCode = '') {
    const values = Array.isArray(value)
      ? value
      : String(value || '').split(/\r?\n|[,，；;]/)
    return values
      .map(item => deriveJobCloudPath(item, styleCode))
      .map(compact)
      .filter(Boolean)
  }

  function defaultSemirCloudPath(rawParams = params) {
    if (falsey(rawParams.use_default_cloud_path)) return ''
    return DEFAULT_SEMIR_CLOUD_PATH
  }

  function defaultVipshopMainImageCloudRoot(rawParams = params) {
    if (falsey(rawParams.use_default_main_image_cloud_path) || falsey(rawParams.use_default_main_image_cloud_root)) return ''
    return DEFAULT_MAIN_IMAGE_SEMIR_CLOUD_ROOT
  }

  function normalizeMainImageFeatureText(value) {
    return normalizePath(value)
      .replace(/（/g, '(')
      .replace(/）/g, ')')
      .replace(/\s+/g, '')
      .toLowerCase()
  }

  function normalizeMainImagePathFeatures(value) {
    const rawValues = Array.isArray(value)
      ? value
      : String(value || '').split(/\r?\n|[,，；;]/)
    const features = rawValues.map(compact).filter(Boolean)
    return (features.length ? features : DEFAULT_MAIN_IMAGE_PATH_FEATURES)
      .map(normalizeMainImageFeatureText)
      .filter(Boolean)
  }

  function pathMatchesMainImagePathFeatures(itemOrPath, features = DEFAULT_MAIN_IMAGE_PATH_FEATURES) {
    const path = typeof itemOrPath === 'string' ? itemOrPath : normalizedAssetFullpath(itemOrPath)
    const text = normalizeMainImageFeatureText(path)
    const normalizedFeatures = normalizeMainImagePathFeatures(features)
    return normalizedFeatures.every(feature => text.includes(feature))
  }

  function deriveJobCloudPath(rawPath, styleCode, overridePath = '') {
    const override = compact(overridePath)
    if (override) return override
    const raw = compact(rawPath)
    if (!raw) return ''
    const style = compact(styleCode)
    if (!style) return raw
    try {
      const parsed = parseCloudPath(raw)
      const parts = pathSegments(parsed.relativePath)
      if (parts.length && /^\d{9,15}$/.test(parts[parts.length - 1])) {
        parts[parts.length - 1] = style
        return `${parsed.mountName}//${parts.join('/')}`
      }
    } catch (error) {
      return raw
    }
    return raw
  }

  function normalizePackageMainJobs(inputFile, rawParams = params) {
    const rows = collectFileRows(inputFile || rawParams.input_file || { rows: rawParams.rows || rawParams.jobs || [] })
    const jobs = []
    const invalidRows = []
    const seen = new Set()
    rows.forEach((row, index) => {
      const rowNo = excelRowNumber(row, index)
      const styleCodes = splitCodes(rowValue(row, [
        '款号', '商品款号', '唯品款号', '大货款号', 'style', 'styleCode', 'style_code', 'osn', 'sn',
      ]))
      const goodsCodes = splitCodes(rowValue(row, [
        '货号', '商品货号', '款色号', '色号', '唯品货号', 'goodsCode', 'goods_code', 'msn', 'colourGSN',
      ]))
      const note = compact(rowValue(row, ['备注', 'note']))
      const rowCloudPath = rowValue(row, [
        '云盘路径', '森马云盘路径', '图包地址', '包装云盘路径', '包装地址', 'cloud_path', 'semir_path', 'cloudPath',
      ])
      const rowCandidateCloudPaths = rowValue(row, [
        '候选云盘路径', '备用云盘路径', 'candidate_cloud_paths', 'fallback_cloud_paths',
      ])
      const rowMainImageCloudPath = rowValue(row, [
        '主图云盘路径', '主图打标路径', '主图地址', '主图图源', 'main_image_cloud_path', 'main_image_cloud_root',
        'mainImageCloudPath', 'mainImageCloudRoot',
      ])
      const rowMainImageCandidateCloudPaths = rowValue(row, [
        '主图候选云盘路径', '主图备用云盘路径', 'main_image_candidate_cloud_paths', 'main_image_fallback_cloud_paths',
      ])
      if (!styleCodes.length || !goodsCodes.length) {
        invalidRows.push(buildOutputRow({
          rowNo,
          styleCode: styleCodes.join('\n'),
          goodsCode: goodsCodes.join('\n'),
        }, {
          status: '预检失败',
          note: '缺少「款号」或「货号」',
          task: '输入校验',
        }))
        return
      }
      for (const styleCode of styleCodes) {
        for (const goodsCode of goodsCodes) {
          const key = `${styleCode}|${goodsCode}`
          if (seen.has(key)) {
            invalidRows.push(buildOutputRow({ rowNo, styleCode, goodsCode }, {
              status: '跳过重复',
              note: '同一款号+货号在输入表中重复',
              task: '输入校验',
            }))
            continue
          }
          seen.add(key)
          jobs.push({
            rowNo,
            styleCode,
            goodsCode,
            note,
            executeMode: normalizeExecuteMode(rawParams.execute_mode),
            operationScope: rawParams.operation_scope || ['package', 'main_image'],
            cloudPath: deriveJobCloudPath(
              rawParams.cloud_path || rawParams.semir_path || rawParams.cloudPath || defaultSemirCloudPath(rawParams),
              styleCode,
              rowCloudPath,
            ),
            mainImageCloudPath: deriveJobCloudPath(
              rawParams.main_image_cloud_path || rawParams.main_image_cloud_root || rawParams.mainImageCloudPath || rawParams.mainImageCloudRoot
                || defaultVipshopMainImageCloudRoot(rawParams),
              styleCode,
              rowMainImageCloudPath,
            ),
            mainImagePathFeatures: normalizeMainImagePathFeatures(rawParams.main_image_path_features || rawParams.mainImagePathFeatures),
            candidateCloudPaths: normalizeCandidateCloudPaths(
              rowCandidateCloudPaths || rawParams.candidate_cloud_paths || rawParams.candidate_cloud_path || rawParams.fallback_cloud_paths,
              styleCode,
            ),
            mainImageCandidateCloudPaths: normalizeCandidateCloudPaths(
              rowMainImageCandidateCloudPaths
                || rawParams.main_image_candidate_cloud_paths
                || rawParams.main_image_candidate_cloud_path
                || rawParams.main_image_fallback_cloud_paths,
              styleCode,
            ),
            folderScanDepth: Math.max(1, Math.min(10, positiveInt(rawParams.folder_scan_depth, DEFAULT_FOLDER_SCAN_DEPTH))),
          })
        }
      }
    })
    return { jobs, invalidRows, totalRows: rows.length }
  }

  function fileNameOf(item) {
    return compact(item?.filename || item?.name || item?.path?.split(/[\\/]/).pop() || item?.fullpath?.split(/[\\/]/).pop() || item)
  }

  function semanticFileNameOf(item) {
    return compact(item?.originalFilename || item?.original_filename || item?.sourceFilename || item?.source_filename || fileNameOf(item))
  }

  function filePathOf(item) {
    if (typeof item === 'string') return normalizePath(item)
    const localPath = normalizePath(item?.localPath || '')
    if (localPath) return localPath
    const fullpath = normalizePath(item?.fullpath || item?.relativePath || item?.relative_path || '')
    const pathValue = normalizePath(item?.path || '')
    const filename = fileNameOf(item)
    if (fullpath && (!pathValue || pathValue === filename || !pathValue.includes('/'))) return fullpath
    return normalizePath(pathValue || fullpath || filename || item?.name || '')
  }

  function fileExt(item) {
    const explicit = compact(item?.ext).replace(/^\./, '').toLowerCase()
    if (explicit) return explicit
    const filename = fileNameOf(item)
    const dot = filename.lastIndexOf('.')
    return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
  }

  function isImageFile(item) {
    if (!item) return false
    const dir = item?.dir
    if (dir === 1 || dir === '1' || dir === true || item?.isDirectory) return false
    return IMAGE_EXTS.has(fileExt(item))
  }

  function parseImageDimensions(item) {
    const width = positiveInt(item?.width || item?.imageWidth || item?.naturalWidth, 0)
    const height = positiveInt(item?.height || item?.imageHeight || item?.naturalHeight, 0)
    if (width && height) return { width, height, source: 'metadata' }
    const text = `${fileNameOf(item)} ${filePathOf(item)}`
    const match = text.match(/(?:^|[^0-9])([1-9]\d{2,4})\s*(?:x|X|\*|＊|_|-)\s*([1-9]\d{2,4})(?:[^0-9]|$)/)
    if (!match) return { width: 0, height: 0, source: '' }
    return { width: normalizeDimensionToken(match[1]), height: normalizeDimensionToken(match[2]), source: 'filename' }
  }

  function normalizeDimensionToken(value) {
    const raw = String(value || '')
    const direct = Number(raw)
    if (raw.length <= 4) return direct
    const four = Number(raw.slice(0, 4))
    if ([750, 800, 950, 1200, 1440, 1785, 1920].includes(four)) return four
    const three = Number(raw.slice(0, 3))
    if ([750, 800, 950].includes(three)) return three
    return direct
  }

  function isPreviewFile(item) {
    const text = `${fileNameOf(item)} ${filePathOf(item)}`.toLowerCase()
    return /(?:预览|效果图|整图|源文件|preview|overview|source)/i.test(text)
  }

  function pathHasAny(item, words) {
    const text = `${fileNameOf(item)} ${filePathOf(item)}`.toLowerCase()
    return words.some(word => text.includes(String(word).toLowerCase()))
  }

  function fileNameMatchesGoodsCode(item, goodsCode) {
    const target = normalizeComparableCode(goodsCode)
    if (!target) return false
    return normalizeComparableCode(fileNameOf(item) || semanticFileNameOf(item)).includes(target)
  }

  function isExplicitVipshopMainName(item) {
    const stem = normalizePath(getFileStem(fileNameOf(item) || semanticFileNameOf(item))).toLowerCase()
    return /(?:^|[-_\s])1200(?:$|[-_\s])/.test(stem) || /1200[_xX*＊-]1200/.test(stem)
  }

  function isExplicitVipshopListName(item) {
    const stem = normalizePath(getFileStem(fileNameOf(item) || semanticFileNameOf(item))).toLowerCase()
    return /(?:^|[-_\s])950(?:$|[-_\s])/.test(stem) || /950[_xX*＊-]1200|1200[_xX*＊-]950/.test(stem)
  }

  function isLikelyVipshopMainSearchHit(item, styleCode, goodsCode) {
    if (!isImageFile(item)) return false
    if (!fileNameMatchesGoodsCode(item, goodsCode)) return false
    if (hasOtherStyleFolder(item, styleCode)) return false
    if (pathHasAny(item, ['物流图片', '物流图', '内容营销素材', '达人', '尺码表', '效果预览', '源文件'])) return false
    const sourceHint = pathHasAny(item, ['主图', '打标', '平拍原图/全域', '模拍原图/全域', '3p', '5p', '7p', '已写', '已选', 'main'])
    return sourceHint || isExplicitVipshopMainName(item) || isExplicitVipshopListName(item)
  }

  function isStyleSequenceDetailFile(item, styleCode) {
    const style = normalizeComparableCode(styleCode)
    if (!style) return false
    const names = Array.from(new Set([fileNameOf(item), semanticFileNameOf(item)].map(getFileStem).map(normalizeComparableCode)))
    return names.some(stem => {
      if (!stem.startsWith(style)) return false
      const suffix = stem.slice(style.length)
      return /^\d{1,3}$/.test(suffix)
    })
  }

  function hasOtherStyleFolder(item, styleCode) {
    const style = normalizeComparableCode(styleCode)
    if (!style) return false
    const parts = pathSegments(filePathOf({ ...item, localPath: '' }))
    const folderParts = isImageFile(item) ? parts.slice(0, -1) : parts
    return folderParts.some(part => {
      const match = normalizeComparableCode(part).match(/\d{12}/)
      return match && match[0] !== style
    })
  }

  function vipshopMainAssetPriority(item) {
    const text = normalizePath(`${item.file || ''} ${item.filename || ''}`)
    let score = 0
    if (Number(item.width) === 1200 && Number(item.height) === 1200) score += 120
    if (/1200[_xX*＊-]1200/.test(text)) score += 80
    if (/950[_xX*＊-]1200|1200[_xX*＊-]950/.test(text)) score -= 80
    if (/平拍原图\/全域/i.test(text)) score += 80
    if (/模拍原图\/全域/i.test(text)) score += 40
    if (/\/3p(\/|$)|\/3P(\/|$)/.test(text)) score += 20
    if (/\bm\(/i.test(text) || /\/5p(\/|$)|\/7p(\/|$)/i.test(text)) score -= 30
    if (/-\d{5}\.jpe?g$/i.test(text)) score += 10
    if (/-\d{5}-1\.jpe?g$/i.test(text)) score += 5
    if (/\/\d{12}\.jpe?g$/i.test(text) || /^\d{12}\.jpe?g$/i.test(compact(item.filename))) score -= 100
    return score
  }

  function collectAssetFiles(rawParams = params, rawShared = shared) {
    const result = []
    const push = value => {
      if (!value) return
      if (Array.isArray(value)) result.push(...value)
      else if (Array.isArray(value.paths)) result.push(...value.paths)
      else if (Array.isArray(value.files)) result.push(...value.files)
      else if (typeof value === 'object') result.push(value)
      else result.push(value)
    }
    push(rawParams.material_images)
    push(rawParams.main_images)
    push(rawParams.asset_files)
    push(rawParams.local_asset_files)
    push(rawParams.material_root_files)
    push(rawShared.asset_files)
    push(rawShared.local_asset_files)
    push(rawShared.downloaded_files)
    push(rawShared.downloaded_asset_files)
    return result
  }

  function classifyVipshopAssets(job, files) {
    const goodsCode = normalizeComparableCode(job?.goodsCode)
    const styleCode = normalizeComparableCode(job?.styleCode)
    const groups = {
      mainSquare: [],
      listImage: [],
      packageMicroSquare: [],
      detailSlices: [],
      unmatched: [],
    }
    const goodsMatched = []
    const styleFallback = []

    for (const item of files || []) {
      if (!isImageFile(item)) continue
      const fullpath = filePathOf(item) || fileNameOf(item)
      const normalizedPath = normalizeComparableCode(fullpath)
      if (goodsCode && normalizedPath.includes(goodsCode)) goodsMatched.push(item)
      else if (styleCode && normalizedPath.includes(styleCode)) styleFallback.push(item)
    }
    const candidates = []
    const seenCandidates = new Set()
    for (const item of [...goodsMatched, ...styleFallback]) {
      const key = `${filePathOf(item) || fileNameOf(item)}`
      if (!key || seenCandidates.has(key)) continue
      seenCandidates.add(key)
      candidates.push(item)
    }

    candidates.forEach((item, index) => {
      const fullpath = filePathOf(item) || fileNameOf(item)
      const normalizedPath = normalizeComparableCode(fullpath)
      const matchedByGoods = goodsCode && normalizedPath.includes(goodsCode)
      const dimension = parseImageDimensions(item)
      const file = {
        file: fullpath,
        filename: fileNameOf(item),
        fullpath,
        __mount_id: item?.__mount_id || '',
        __mount_name: item?.__mount_name || '',
        __source_relative_path: item?.__source_relative_path || '',
        __source_purpose: item?.__source_purpose || '',
        width: dimension.width,
        height: dimension.height,
        dimensionSource: dimension.source,
        sourceMatch: matchedByGoods ? '货号' : '款号',
        sequence: index + 1,
      }
      const square = dimension.width === 1200 && dimension.height === 1200
      const largeSquare = dimension.width === dimension.height && dimension.width >= 1200
      const listDimension = (dimension.width === 950 && dimension.height === 1200) || (dimension.width === 1200 && dimension.height === 950)
      const detailHint = pathHasAny(item, ['images', '切片', '详情', '商详', '商品详情', 'pc详情', 'detail'])
      const microHint = pathHasAny(item, ['微详情', '微详', 'weixiangqing', 'micro'])
      const mainHint = pathHasAny(item, ['主图', '打标', 'main'])
      const vipMainFolderHint = pathHasAny(item, ['平拍原图/全域', '模拍原图/全域', '3p', '已写', '已选'])
      const listHint = pathHasAny(item, ['列表图', '950', '1200x950', '1200_950', '950x1200', '950_1200'])
      const packageRootHint = pathHasAny(item, ['326包装图', '包装图', '01-产品包装', '产品包装', '服饰产品包装'])
      const styleSequenceDetail = isStyleSequenceDetailFile(item, styleCode)
      const otherStyleFolder = hasOtherStyleFolder(item, styleCode)
      const filenameMatchesGoods = fileNameMatchesGoodsCode(item, goodsCode)
      const canUseAsMainImage = matchedByGoods && filenameMatchesGoods && !otherStyleFolder
      const explicitMainName = isExplicitVipshopMainName(item)
      const explicitListName = isExplicitVipshopListName(item)
      const mainSourceHint = mainHint || vipMainFolderHint || explicitMainName || (!packageRootHint && !detailHint && !microHint)
      const probableSquare = canUseAsMainImage && mainSourceHint && !detailHint && !microHint && !listHint && !explicitListName
        && (largeSquare || (!dimension.width && !dimension.height))
      const probableList = canUseAsMainImage && !detailHint && !microHint
        && (listDimension || listHint || explicitListName)
      const probableMicro = square || (!dimension.width && !dimension.height && microHint)
      let recognized = false

      if (isPreviewFile(item) && detailHint) {
        groups.unmatched.push({ ...file, reason: '疑似整张预览或源文件，详情切片跳过' })
        return
      }
      if (probableMicro && (microHint || packageRootHint)) {
        groups.packageMicroSquare.push({ ...file, usage: '包装-微详情1200x1200' })
        recognized = true
      }
      if (probableSquare) {
        groups.mainSquare.push({ ...file, usage: '主图-商品图片1200x1200' })
        recognized = true
      }
      if (probableList) {
        groups.listImage.push({
          ...file,
          usage: '主图-商品列表图950x1200',
          note: dimension.width === 1200 ? '文件名/元数据为1200x950，已按文档950x1200类目兼容识别' : '',
        })
        recognized = true
      }
      if (detailHint && styleSequenceDetail && !square && !listDimension) {
        groups.detailSlices.push({ ...file, usage: '包装-商品详情切片' })
        recognized = true
      }
      if (!recognized) groups.unmatched.push({ ...file, reason: otherStyleFolder ? '命中货号但位于其它款号文件夹，已跳过' : '未识别为唯品会主图、列表图、微详情或详情切片' })
    })

    const natural = (a, b) => String(a.file).localeCompare(String(b.file), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
    const mainNatural = (a, b) => {
      const priorityDelta = vipshopMainAssetPriority(b) - vipshopMainAssetPriority(a)
      return priorityDelta || natural(a, b)
    }
    groups.mainSquare.sort(mainNatural)
    groups.listImage.sort(mainNatural)
    groups.packageMicroSquare.sort(natural)
    groups.detailSlices.sort(natural)
    groups.unmatched.sort(natural)
    if (!groups.listImage.length) {
      const firstMain = groups.mainSquare[0]?.file || ''
      const fallbackList = groups.mainSquare.find(item => !item.width && !item.height && item.file !== firstMain)
      if (fallbackList) {
        groups.listImage.push({
          ...fallbackList,
          usage: '主图-商品列表图950x1200',
          note: compact([fallbackList.note, '尺寸未知，线上上传前会校验950x1200/1200x950'].filter(Boolean).join('；')),
        })
      }
    }
    return {
      goodsMatched: goodsMatched.length,
      styleFallback: styleFallback.length,
      groups,
    }
  }

  function selectedVipshopAssetEntries(job, assetPlan) {
    const entries = []
    const push = (scope, usageKey, usage, imageIndex, item, index) => {
      if (!item) return
      entries.push({
        ...item,
        scope,
        usageKey,
        usage,
        imageIndex,
        uploadOrder: entries.length,
        groupIndex: index,
      })
    }
    if (hasScope(job.operationScope, 'main_image')) {
      const listFile = assetPlan.groups.listImage[0]?.file || ''
      assetPlan.groups.mainSquare.filter(item => item.file !== listFile).slice(0, 1).forEach((item, index) => {
        push('main_image', 'main_square', '主图-商品图片1200x1200', 1, item, index)
      })
      assetPlan.groups.listImage.slice(0, 1).forEach((item, index) => {
        push('main_image', 'list_image', '主图-商品列表图950x1200', 50, item, index)
      })
    }
    if (hasScope(job.operationScope, 'package')) {
      assetPlan.groups.packageMicroSquare.slice(0, 2).forEach((item, index) => {
        push('package', 'package_micro_square', '包装-微详情1200x1200', index + 3, item, index)
      })
      assetPlan.groups.detailSlices.slice(0, 50).forEach((item, index) => {
        push('package', 'detail_slice', '包装-商品详情切片', 601 + index, item, index)
      })
    }
    return entries
  }

  function isSharedDetailAsset(asset) {
    return asset?.usageKey === 'detail_slice'
  }

  function detailShareKey(context) {
    return [
      compact(context?.vendorProductId),
      normalizeCode(context?.job?.styleCode),
    ].join('|')
  }

  function coalesceLiveDetailContexts(contexts = []) {
    const productStyleCodes = new Map()
    const detailGroups = new Map()
    for (const context of Array.isArray(contexts) ? contexts : []) {
      if (!context || !context.vendorProductId) continue
      const styleCode = normalizeCode(context.job?.styleCode)
      if (!styleCode) continue
      if (!productStyleCodes.has(context.vendorProductId)) productStyleCodes.set(context.vendorProductId, new Set())
      productStyleCodes.get(context.vendorProductId).add(styleCode)
      if (!(context.assets || []).some(isSharedDetailAsset)) continue
      const key = detailShareKey(context)
      if (!detailGroups.has(key)) detailGroups.set(key, [])
      detailGroups.get(key).push(context)
    }

    return (Array.isArray(contexts) ? contexts : []).map(context => {
      if (!context) return context
      const key = detailShareKey(context)
      const group = detailGroups.get(key) || []
      const productHasMultipleStyles = (productStyleCodes.get(context.vendorProductId)?.size || 0) > 1
      const detailSharedGoodsCodes = group.map(item => normalizeCode(item.job?.goodsCode)).filter(Boolean)
      const base = {
        ...context,
        merged: Boolean(context.merged || productHasMultipleStyles),
        forceColorSpecificDetail: Boolean(context.forceColorSpecificDetail || productHasMultipleStyles),
        detailSharedKey: key,
        detailSharedGoodsCodes: detailSharedGoodsCodes.length ? detailSharedGoodsCodes : [normalizeCode(context.job?.goodsCode)].filter(Boolean),
      }
      if (!group.length || group[0] === context) {
        return {
          ...base,
          detailShareRole: group.length > 1 ? 'primary' : 'single',
        }
      }
      return {
        ...base,
        assets: (context.assets || []).filter(asset => !isSharedDetailAsset(asset)),
        detailShareRole: 'shared_skip',
        detailSharedFromGoodsCode: normalizeCode(group[0].job?.goodsCode),
      }
    })
  }

  function buildMerchandiseQueryPayload(goodsCodes, pageNo = 1, pageSize = DEFAULT_PAGE_SIZE) {
    return {
      pageNo,
      pageSize,
      param: {
        msnSet: Array.from(new Set((goodsCodes || []).map(normalizeCode).filter(Boolean))),
      },
    }
  }

  function buildProductDetailPayload(vendorProductId, vendorType = 1) {
    return new URLSearchParams({
      vendorProductId: compact(vendorProductId),
      vendorType: String(vendorType || 1),
    }).toString()
  }

  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    let json
    try {
      json = JSON.parse(text)
    } catch (error) {
      throw new Error(`${url} 返回非 JSON：${text.slice(0, 160)}`)
    }
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}：${compact(json.message || json.msg || text.slice(0, 160))}`)
    if (json.code && String(json.code) !== '200') throw new Error(`${url} 返回 code=${json.code}：${compact(json.message || json.msg || '接口失败')}`)
    return json
  }

  async function postForm(url, formBody) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: formBody,
    })
    const text = await response.text()
    let json
    try {
      json = JSON.parse(text)
    } catch (error) {
      throw new Error(`${url} 返回非 JSON：${text.slice(0, 160)}`)
    }
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}：${compact(json.msg || text.slice(0, 160))}`)
    if (json.code && String(json.code) !== '200') throw new Error(`${url} 返回 code=${json.code}：${compact(json.msg || json.message || '接口失败')}`)
    return json
  }

  async function queryMerchandiseRows(goodsCodes, rawParams = params) {
    const pageSize = Math.max(1, Math.min(500, positiveInt(rawParams.page_size, DEFAULT_PAGE_SIZE)))
    const maxPages = Math.max(1, Math.min(100, positiveInt(rawParams.max_pages, DEFAULT_MAX_PAGES)))
    const allRows = []
    let total = 0
    for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
      const payload = buildMerchandiseQueryPayload(goodsCodes, pageNo, pageSize)
      const json = await postJson(VIPSHOP_MERCHANDISE_QUERY_URL, payload)
      const rows = Array.isArray(json.data) ? json.data : []
      total = Number(json.total || rows.length || total)
      allRows.push(...rows)
      if (!rows.length || allRows.length >= total) break
    }
    return { rows: allRows, total }
  }

  async function queryProductDetail(vendorProductId, vendorType = 1) {
    const json = await postForm(PDC_PRODUCT_DETAIL_URL, buildProductDetailPayload(vendorProductId, vendorType))
    return json.result || {}
  }

  function merchandiseRowKey(row) {
    return normalizeCode(row?.msn || row?.goodsNo || row?.货号)
  }

  function indexMerchandiseRows(rows) {
    const map = new Map()
    ;(rows || []).forEach(row => {
      const key = merchandiseRowKey(row)
      if (key && !map.has(key)) map.set(key, row)
    })
    return map
  }

  function statusLabel(status) {
    const text = compact(status)
    if (text === '11') return '草稿/可编辑'
    if (text === '12') return '审核通过'
    if (text === '13') return '已提交审核'
    if (text === '14') return '审核驳回/可编辑'
    return text
  }

  function findTargetColor(product, goodsCode) {
    const target = normalizeCode(goodsCode)
    const colors = Array.isArray(product?.itemSkuAttr) ? product.itemSkuAttr : []
    return colors.find(item => normalizeCode(item.colourGSN) === target) || null
  }

  function isMergedStyle(job, product) {
    const expected = normalizeCode(job?.styleCode)
    const actual = normalizeCode(product?.sn || product?.osn)
    return Boolean(expected && actual && expected !== actual)
  }

  function outputBase(job = {}, merchandise = {}, product = {}, color = {}) {
    return {
      __sheet_name: DETAIL_SHEET,
      表格行号: job.rowNo || '',
      款号: compact(job.styleCode),
      货号: compact(job.goodsCode),
      商品ID: compact(merchandise.merchandiseNo),
      V_SPU: compact(merchandise.vendorSpuId || product.vendorProductId),
      P_SPU: compact(merchandise.prodSpuId),
      商品状态: statusLabel(product.status || merchandise.skuStatus),
      商品名称: compact(merchandise.name || product.title),
      后台款号: compact(product.sn || merchandise.osn),
      是否拼款: product.vendorProductId ? (isMergedStyle(job, product) ? '是' : '否') : '',
      目标颜色: compact(color.colourName),
      目标色号: compact(color.colourGSN),
      颜色匹配: color.colourGSN ? '已匹配' : '',
      操作范围: '',
      图片用途: '',
      图片索引: '',
      本地文件: '',
      识别尺寸: '',
      接口路径: '',
      执行结果: '',
      备注: '',
    }
  }

  function buildOutputRow(job = {}, options = {}) {
    return {
      __sheet_name: DETAIL_SHEET,
      表格行号: job.rowNo || '',
      款号: compact(job.styleCode),
      货号: compact(job.goodsCode),
      商品ID: compact(options.merchandiseNo),
      V_SPU: compact(options.vendorSpuId),
      P_SPU: compact(options.prodSpuId),
      商品状态: compact(options.productStatus),
      商品名称: compact(options.productName),
      后台款号: compact(options.backendStyle),
      是否拼款: compact(options.mergedStyle),
      目标颜色: compact(options.colorName),
      目标色号: compact(options.colorCode),
      颜色匹配: compact(options.colorMatch),
      操作范围: compact(options.scope),
      图片用途: compact(options.usage || options.task),
      图片索引: compact(options.imageIndex),
      本地文件: compact(options.file),
      识别尺寸: compact(options.dimension),
      接口路径: compact(options.endpoint),
      执行结果: compact(options.status),
      备注: compact(options.note),
    }
  }

  function appendAssetRows(rows, job, merchandise, product, color, assetPlan) {
    const base = outputBase(job, merchandise, product, color)
    const scope = job.operationScope
    const addMissing = (task, note) => {
      rows.push({
        ...base,
        操作范围: task.startsWith('包装') ? 'package' : 'main_image',
        图片用途: task,
        执行结果: '缺少素材',
        备注: note,
      })
    }
    const addFile = (task, item, index, endpoint, imageIndex) => {
      rows.push({
        ...base,
        操作范围: task.startsWith('包装') ? 'package' : 'main_image',
        图片用途: task,
        图片索引: imageIndex || '',
        本地文件: item.file,
        识别尺寸: item.width && item.height ? `${item.width}x${item.height}` : '',
        接口路径: endpoint,
        执行结果: '计划替换',
        备注: compact([item.note, item.sourceMatch === '款号' ? '未匹配完整货号，按款号候选素材列入预检' : '', `顺序${index + 1}`].filter(Boolean).join('；')),
      })
    }

    if (hasScope(scope, 'main_image')) {
      const main = assetPlan.groups.mainSquare[0]
      const list = assetPlan.groups.listImage[0]
      if (main) addFile('主图-商品图片1200x1200', main, 0, '/product/uploadSquareImage', '1')
      else addMissing('主图-商品图片1200x1200', '未找到文件名或路径包含完整货号的1200x1200主图')
      if (list) addFile('主图-商品列表图950x1200', list, 0, '/product/uploadSquareImage', '50')
      else addMissing('主图-商品列表图950x1200', '未找到文件名或路径包含完整货号的950x1200列表图')
    }

    if (hasScope(scope, 'package')) {
      const micro = assetPlan.groups.packageMicroSquare.slice(0, 2)
      if (micro.length) micro.forEach((item, index) => addFile('包装-微详情1200x1200', item, index, '/product/uploadSquareImage', String(index + 3)))
      else addMissing('包装-微详情1200x1200', '未找到微详情目录下的1200x1200图片')
      const detail = assetPlan.groups.detailSlices
      if (detail.length) detail.forEach((item, index) => addFile('包装-商品详情切片', item, index, '/product/uploadSquareImage', String(601 + index)))
      else addMissing('包装-商品详情切片', '未找到 images/切片/商品详情 目录下的详情切片')
    }
  }

  function buildJobPlanRows(job, merchandise, product, color, assetPlan) {
    const rows = []
    const base = outputBase(job, merchandise, product, color)
    const liveNote = job.executeMode === 'live' && !allowLiveExecution() ? LIVE_AUTH_MESSAGE : ''
    const statusNeedsUnpublish = ['12', '13'].includes(compact(product.status))
    rows.push({
      ...base,
      图片用途: '商品资料预检',
      接口路径: `${VIPSHOP_MERCHANDISE_QUERY_URL}；${PDC_PRODUCT_DETAIL_URL}`,
      执行结果: color?.colourGSN ? '预检通过' : '预检失败',
      备注: compact([
        isMergedStyle(job, product) ? '拼款：只允许更新目标货号对应颜色' : '',
        statusNeedsUnpublish ? '当前状态需先取消提交审核/撤回后才能编辑' : '',
        assetPlan.goodsMatched ? `素材按完整货号匹配 ${assetPlan.goodsMatched} 个` : '',
        assetPlan.styleFallback ? `未找到完整货号素材，按款号候选 ${assetPlan.styleFallback} 个` : '',
        liveNote,
      ].filter(Boolean).join('；')),
    })
    if (!color?.colourGSN) return rows
    appendAssetRows(rows, job, merchandise, product, color, assetPlan)
    return rows
  }

  function summaryRow(message, status = '完成') {
    return {
      __sheet_name: SUMMARY_SHEET,
      表格行号: '',
      款号: '',
      货号: '',
      商品ID: '',
      V_SPU: '',
      P_SPU: '',
      商品状态: '',
      商品名称: '',
      后台款号: '',
      是否拼款: '',
      目标颜色: '',
      目标色号: '',
      颜色匹配: '',
      操作范围: '',
      图片用途: '执行摘要',
      图片索引: '',
      本地文件: '',
      识别尺寸: '',
      接口路径: '',
      执行结果: status,
      备注: message,
    }
  }

  function isSupportedExecutionOrigin() {
    return /^https:\/\/nov-admin\.vip\.com\//i.test(String(location.href || ''))
  }

  function liveBlockedRows(jobs) {
    return jobs.map(job => buildOutputRow(job, {
      task: '线上执行安全闸门',
      status: '已阻断',
      note: LIVE_AUTH_MESSAGE,
    }))
  }

  function nextPhase(name, sleepMs = 0, nextShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'next_phase',
        next_phase: name,
        sleep_ms: sleepMs,
        shared: nextShared,
      },
    }
  }

  function navigateTo(url, nextPhaseName, sleepMs = 1500, nextShared = shared) {
    if (String(location.href || '') !== String(url || '')) location.href = url
    return nextPhase(nextPhaseName, sleepMs, nextShared)
  }

  function reloadPage(nextPhaseName, sleepMs = 1500, nextShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'reload_page',
        next_phase: nextPhaseName,
        sleep_ms: sleepMs,
        shared: nextShared,
      },
    }
  }

  function downloadUrls(items, nextPhaseName, options = {}, nextShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'download_urls',
        items,
        shared_key: options.shared_key || 'download_result',
        shared_append: !!options.shared_append,
        strict: !!options.strict,
        concurrency: Number(options.concurrency || 1),
        retry_attempts: Number(options.retry_attempts || 1),
        retry_delay_ms: Number(options.retry_delay_ms || 0),
        next_phase: nextPhaseName,
        sleep_ms: options.sleep_ms || 0,
        shared: nextShared,
      },
    }
  }

  function injectFiles(items, nextPhaseName, sleepMs = 500, nextShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'inject_files',
        items,
        next_phase: nextPhaseName,
        sleep_ms: sleepMs,
        shared: nextShared,
      },
    }
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

  function isSemirLoginTimeoutText(text) {
    return /登录|login|unauthorized|会话|session/i.test(String(text || ''))
  }

  function isSemirLoginTimeoutPayload(payload) {
    const code = compact(payload?.code || payload?.status)
    const message = compact(payload?.msg || payload?.message || payload?.error)
    return ['401', '403', '10001', '10002'].includes(code) || isSemirLoginTimeoutText(message)
  }

  async function fetchSemirJson(url, init = {}) {
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
    if (payload == null) throw new Error(`森马云盘接口未返回 JSON：${url}；${text.slice(0, 160)}`)
    if (!response.ok || isSemirLoginTimeoutPayload(payload)) {
      const message = compact(payload?.msg || payload?.message || text.slice(0, 160) || response.statusText)
      const error = new Error(`森马云盘接口失败 ${response.status}：${message}`)
      error.isSemirLoginTimeout = response.status === 401 || response.status === 403 || isSemirLoginTimeoutPayload(payload)
      throw error
    }
    return payload
  }

  async function fetchMounts() {
    const payload = await fetchSemirJson('/fengcloud/1/account/mount')
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
      const payload = await fetchSemirJson('/fengcloud/2/file/search', {
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

  function isDirectoryItem(item) {
    const dir = item?.dir
    return dir === 1 || dir === '1' || dir === true || item?.isDirectory
  }

  function normalizedAssetFullpath(item) {
    return normalizePath(item?.fullpath || item?.file || item?.path || item?.filename || item?.name || '')
  }

  function itemUpdatedAtMs(item) {
    const raw = item?.updated_at || item?.update_time || item?.mtime || item?.modified || item?.last_modified || item?.created_at
    if (!raw) return 0
    if (Number.isFinite(Number(raw))) {
      const num = Number(raw)
      return num > 1e12 ? num : num * 1000
    }
    const parsed = Date.parse(String(raw))
    return Number.isFinite(parsed) ? parsed : 0
  }

  function searchItemMatchesStyle(item, styleCode) {
    if (matchesStyleFolder(item, styleCode)) return true
    if (!isImageFile(item)) return false
    return !!styleRootPathFromFullpath(item?.fullpath || item?.path || '', styleCode, item)
  }

  function exactStyleFolderPathFromFullpath(fullpath, styleCode) {
    const parts = pathSegments(fullpath)
    const index = parts.findIndex(part => equalsStyleCodeSegment(part, styleCode))
    return index >= 0 ? parts.slice(0, index + 1).join('/') : ''
  }

  function isOptimizedStyleFolderSegment(segment, styleCode) {
    const text = compact(segment).toLowerCase()
    const target = compact(styleCode).toLowerCase()
    return !!text && !!target && text === `${target}-优化`
  }

  function optimizedStyleFolderPathFromFullpath(fullpath, styleCode) {
    const parts = pathSegments(fullpath)
    const index = parts.findIndex(part => isOptimizedStyleFolderSegment(part, styleCode))
    if (index < 0) return ''
    const before = parts.slice(0, index).join('/')
    if (!/优化/.test(before)) return ''
    return parts.slice(0, index + 1).join('/')
  }

  function matchesStyleFolder(item, styleCode) {
    if (!isDirectoryItem(item)) return false
    const fullpath = normalizedAssetFullpath(item)
    const styleFolder = exactStyleFolderPathFromFullpath(fullpath, styleCode)
    return !!styleFolder && styleFolder === pathSegments(fullpath).join('/')
  }

  function styleRootPathFromFullpath(fullpath, styleCode, item = null) {
    return optimizedStyleFolderPathFromFullpath(fullpath, styleCode) || exactStyleFolderPathFromFullpath(fullpath, styleCode)
  }

  function packagingSearchScore(itemOrPath) {
    const path = normalizePath(typeof itemOrPath === 'string'
      ? itemOrPath
      : itemOrPath?.fullpath || itemOrPath?.path || itemOrPath?.filename || '')
    let score = 0
    if (/\/1-企划拍摄\//.test(path)) score -= 1000
    if (/\/01-产品包装\//.test(path)) score += 100
    if (/\/2-产品包装\//.test(path)) score += 100
    if (/\/2-详情\//.test(path)) score += 80
    if (/\/images(\/|$)/.test(path)) score += 75
    if (/主图微详情/.test(path)) score += 70
    if (/导购切图|创意拍切图/.test(path)) score += 60
    if (/导购素材|商品竖图|竖图/.test(path)) score += 60
    if (/\/1-主图\//.test(path)) score += 50
    if (/包装图|包装图示/.test(path)) score += 40
    if (typeof itemOrPath === 'object' && isDirectoryItem(itemOrPath)) score += 10
    if (typeof itemOrPath === 'object' && isImageFile(itemOrPath)) score += 5
    if (/物流图片|物流图|内容营销素材|达人|海外|尺码表|源文件|预览|效果图|整图/i.test(path)) score -= 250
    if (/\.(?:psd|ai|pdf|xlsx?|zip|rar|7z)$/i.test(path)) score -= 300
    return score
  }

  function vipshopCloudPathScore(value) {
    return packagingSearchScore(value)
  }

  function collectStyleRootCandidates(items, styleCode) {
    const seen = new Map()
    ;(Array.isArray(items) ? items : []).forEach((item, index) => {
      const fullpath = normalizedAssetFullpath(item)
      if (!isUnderProductPackagingDirectory(fullpath)) return
      const root = isDirectoryItem(item) && searchItemMatchesStyle(item, styleCode)
        ? fullpath
        : styleRootPathFromFullpath(fullpath, styleCode, item)
      if (!root) return
      const existing = seen.get(root)
      const updatedAt = itemUpdatedAtMs(item)
      const score = Math.max(packagingSearchScore(root), packagingSearchScore(item))
      if (!existing) {
        seen.set(root, {
          path: root,
          updatedAt,
          score,
          count: 1,
          directRoot: isDirectoryItem(item) && normalizePath(fullpath) === root,
          sourceIndex: index,
        })
        return
      }
      existing.count += 1
      existing.sourceIndex = Math.min(existing.sourceIndex, index)
      if (updatedAt > existing.updatedAt) existing.updatedAt = updatedAt
      if (score > existing.score) existing.score = score
      if (isDirectoryItem(item) && normalizePath(fullpath) === root) existing.directRoot = true
    })
    return Array.from(seen.values()).sort((a, b) => {
      const scoreDelta = b.score - a.score
      if (scoreDelta) return scoreDelta
      const countDelta = b.count - a.count
      if (countDelta) return countDelta
      const directDelta = Number(b.directRoot) - Number(a.directRoot)
      if (directDelta) return directDelta
      const timeDelta = b.updatedAt - a.updatedAt
      if (timeDelta) return timeDelta
      return naturalCompare(a.path, b.path)
    })
  }

  function selectLatestStyleRoot(items, styleCode) {
    return collectStyleRootCandidates(items, styleCode)[0] || null
  }

  function extractFolderItems(payload) {
    if (Array.isArray(payload?.list)) return payload.list
    if (Array.isArray(payload?.data)) return payload.data
    if (Array.isArray(payload?.items)) return payload.items
    if (Array.isArray(payload?.result?.list)) return payload.result.list
    if (Array.isArray(payload?.result?.data)) return payload.result.data
    return null
  }

  function extractFolderTotal(payload, fallback) {
    return Number(payload?.total || payload?.count || payload?.result?.total || fallback || 0)
  }

  function normalizeListedItem(item, parentFullpath) {
    const filename = compact(item?.filename || item?.name || item?.file_name || item?.fileName)
    const explicitFullpath = normalizePath(item?.fullpath || item?.full_path || item?.relativePath || item?.relative_path || '')
    const pathValue = normalizePath(item?.path || '')
    const candidateFullpath = explicitFullpath || pathValue
    const parent = normalizePath(parentFullpath)
    const looksLikeOnlyFilename = candidateFullpath && filename && normalizePath(candidateFullpath) === normalizePath(filename)
    const fullpath = (!candidateFullpath || looksLikeOnlyFilename || (!candidateFullpath.includes('/') && parent))
      ? [parent, filename || candidateFullpath].filter(Boolean).join('/')
      : candidateFullpath
    return {
      ...item,
      filename,
      name: filename || item?.name,
      fullpath,
    }
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
    if (method === 'GET') return fetchSemirJson(`${endpoint}?${query.toString()}`)
    return fetchSemirJson(endpoint, {
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
          if (!Array.isArray(itemsRaw)) throw new Error(`${attempt.method} ${attempt.endpoint} 未返回列表字段`)
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

  async function collectDescendantImagesByPath(mountId, folderPath, maxDepth, remainingBudget = { value: SEARCH_FALLBACK_ASSET_BUDGET }) {
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
      if (!isImageFile(item)) continue
      assets.push(item)
      remainingBudget.value -= 1
    }
    return { assets, errors }
  }

  function dedupeItemsByFullpath(items) {
    const result = []
    const seen = new Set()
    for (const item of Array.isArray(items) ? items : []) {
      const key = normalizedAssetFullpath(item)
      if (!key || seen.has(key)) continue
      seen.add(key)
      result.push(item)
    }
    return result
  }

  function itemIsUnderStyleRoot(item, rootPath) {
    const root = normalizePath(rootPath).replace(/\/+$/g, '')
    if (!root) return true
    const fullpath = normalizedAssetFullpath(item).replace(/\/+$/g, '')
    return fullpath === root || fullpath.startsWith(`${root}/`)
  }

  function annotateItemsWithSource(items, sourceConfig) {
    return (Array.isArray(items) ? items : []).map((item, index) => ({
      ...item,
      __source_index: index,
      __mount_id: item?.__mount_id || sourceConfig.mountId,
      __mount_name: item?.__mount_name || sourceConfig.mountName,
      __source_relative_path: sourceConfig.relativePath,
      __source_purpose: item?.__source_purpose || sourceConfig.purpose || '',
      path: item?.fullpath || item?.path,
    }))
  }

  function isWithinRelativePath(fullpath, relativePath) {
    const path = normalizePath(fullpath)
    const prefix = normalizePath(relativePath).replace(/\/+$/g, '')
    return !prefix || path === prefix || path.startsWith(`${prefix}/`)
  }

  function parentFolderPath(fullpath) {
    const parts = pathSegments(fullpath)
    if (parts.length <= 1) return ''
    return parts.slice(0, -1).join('/')
  }

  function itemMatchesMainImageSource(item, job, sourceConfig) {
    const fullpath = normalizedAssetFullpath(item)
    if (!fullpath) return false
    if (sourceConfig?.relativePath && !isWithinRelativePath(fullpath, sourceConfig.relativePath)) return false
    if (!pathMatchesMainImagePathFeatures(fullpath, sourceConfig?.pathFeatures || job?.mainImagePathFeatures)) return false
    if (pathHasAny(item, ['物流图片', '物流图', '内容营销素材', '达人', '尺码表', '服饰产品包装', '01-产品包装', '产品包装'])) return false
    const comparable = normalizeComparableCode(fullpath)
    const goodsCode = normalizeComparableCode(job?.goodsCode)
    const styleCode = normalizeComparableCode(job?.styleCode)
    return Boolean((goodsCode && comparable.includes(goodsCode)) || (styleCode && comparable.includes(styleCode)))
  }

  function mainImageSourceSearchScore(item, job) {
    const fullpath = normalizedAssetFullpath(item)
    let score = 0
    if (normalizeComparableCode(fullpath).includes(normalizeComparableCode(job?.goodsCode))) score += 100
    if (fileNameMatchesGoodsCode(item, job?.goodsCode)) score += 80
    if (isImageFile(item)) score += 40
    if (isDirectoryItem(item)) score += 20
    if (isExplicitVipshopMainName(item) || isExplicitVipshopListName(item)) score += 30
    if (/\/回图\/唯品(\/|$)/.test(normalizeMainImageFeatureText(fullpath))) score += 25
    score += Math.min(20, pathSegments(fullpath).length)
    return score
  }

  function selectMainImageSearchRoot(items, job, sourceConfig) {
    const roots = []
    const seen = new Set()
    for (const item of Array.isArray(items) ? items : []) {
      if (!itemMatchesMainImageSource(item, job, sourceConfig)) continue
      const fullpath = normalizedAssetFullpath(item)
      const root = isDirectoryItem(item) ? fullpath : parentFolderPath(fullpath)
      if (!root || seen.has(root)) continue
      seen.add(root)
      roots.push({
        path: root,
        score: mainImageSourceSearchScore(item, job),
        updatedAt: itemUpdatedAtMs(item),
      })
    }
    roots.sort((a, b) => {
      const scoreDelta = b.score - a.score
      if (scoreDelta) return scoreDelta
      const timeDelta = b.updatedAt - a.updatedAt
      if (timeDelta) return timeDelta
      return naturalCompare(a.path, b.path)
    })
    return roots[0] || null
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

  async function findVisibleStyleFolder(mounts, styleCode) {
    const candidates = []
    for (const mount of Array.isArray(mounts) ? mounts : []) {
      const mountId = mountIdValue(mount)
      const mountName = mountDisplayName(mount)
      if (!mountId || !mountName) continue
      try {
        const searchItems = await searchFiles(mountId, styleCode)
        const roots = collectStyleRootCandidates(searchItems, styleCode)
        roots.forEach(root => candidates.push({
          mountId,
          mountName,
          relativePath: root.path,
          rawPath: `${mountName}//${root.path}`,
          updatedAt: root.updatedAt,
          searchCount: searchItems.length,
        }))
      } catch (error) {
        // Some visible mounts can deny search; skip them and keep probing.
      }
    }
    candidates.sort((a, b) => {
      const timeDelta = b.updatedAt - a.updatedAt
      if (timeDelta) return timeDelta
      return naturalCompare(`${a.mountName}//${a.relativePath}`, `${b.mountName}//${b.relativePath}`)
    })
    return candidates[0] || null
  }

  function resolveConfiguredCloudSource(mounts, rawPath, styleCode, candidateCloudPaths = [], options = {}) {
    const normalizedRawPath = deriveJobCloudPath(rawPath, styleCode)
    if (!normalizedRawPath) return null
    const cloudConfig = parseCloudPath(normalizedRawPath)
    const resolved = resolveMountFromList(mounts, cloudConfig.mountName)
    if (!resolved) {
      const available = mounts.map(mountDisplayName).filter(Boolean).join('、')
      throw new Error(`${options.missingMountPrefix || '未找到挂载点'}：${cloudConfig.mountName}。当前可见挂载点：${available || '无'}`)
    }
    return {
      mountId: resolved.mountId,
      mountName: resolved.mountName,
      relativePath: cloudConfig.relativePath,
      rawPath: cloudConfig.raw,
      candidateSources: resolveCandidateSourceConfigs(mounts, candidateCloudPaths || [], styleCode)
        .map(candidate => ({
          ...candidate,
          purpose: options.purpose || candidate.purpose || '',
          pathFeatures: options.pathFeatures || candidate.pathFeatures,
          searchOnly: options.forceSearchOnly ? true : candidate.searchOnly,
        })),
      restrictSearchToRelativePath: options.restrictSearchToRelativePath !== false,
      searchOnly: options.forceSearchOnly ? true : !styleRootPathFromFullpath(cloudConfig.relativePath, styleCode),
      sourceWarning: options.sourceWarning || '',
      purpose: options.purpose || '',
      pathFeatures: options.pathFeatures,
    }
  }

  async function resolveVipshopPackageCloudSource(job, mounts = null) {
    const visibleMounts = mounts || await fetchMounts()
    const rawPath = deriveJobCloudPath(job.cloudPath, job.styleCode)
    if (rawPath) {
      return resolveConfiguredCloudSource(visibleMounts, rawPath, job.styleCode, job.candidateCloudPaths || [], {
        purpose: 'package',
      })
    }
    const visible = await findVisibleStyleFolder(visibleMounts, job.styleCode)
    if (!visible) {
      const available = visibleMounts.map(mountDisplayName).filter(Boolean).join('、')
      throw new Error(`未在森马云盘可见挂载点中搜索到款号 ${job.styleCode} 的图包；当前可见挂载点：${available || '无'}`)
    }
    return {
      ...visible,
      candidateSources: resolveCandidateSourceConfigs(visibleMounts, job.candidateCloudPaths || [], job.styleCode),
      purpose: 'package',
      sourceWarning: `未配置云盘路径，已按款号跨挂载点搜索并选用：${visible.mountName}//${visible.relativePath}`,
    }
  }

  async function resolveVipshopMainImageCloudSource(job, mounts = null) {
    const visibleMounts = mounts || await fetchMounts()
    const pathFeatures = normalizeMainImagePathFeatures(job.mainImagePathFeatures)
    const rawPath = deriveJobCloudPath(job.mainImageCloudPath || defaultVipshopMainImageCloudRoot(), job.styleCode)
    if (!rawPath) return null
    const source = resolveConfiguredCloudSource(visibleMounts, rawPath, job.styleCode, job.mainImageCandidateCloudPaths || [], {
      purpose: 'main_image',
      pathFeatures,
      forceSearchOnly: true,
      missingMountPrefix: '主图源未找到挂载点',
    })
    return {
      ...source,
      sourceWarning: `主图/列表图仅从路径特征「${DEFAULT_MAIN_IMAGE_PATH_FEATURES.join(' / ')}」的森马云盘结果中选取`,
    }
  }

  async function resolveVipshopCloudSource(job) {
    return resolveVipshopPackageCloudSource(job)
  }

  async function resolveVipshopCloudSources(job) {
    const mounts = await fetchMounts()
    const packageSource = hasScope(job.operationScope, 'package')
      ? await resolveVipshopPackageCloudSource(job, mounts)
      : null
    const mainImageSource = hasScope(job.operationScope, 'main_image')
      ? await resolveVipshopMainImageCloudSource(job, mounts)
      : null
    return {
      packageSource,
      mainImageSource,
      mountNames: mounts.map(mountDisplayName).filter(Boolean),
    }
  }

  async function collectVipshopAssetsFromSource(job, sourceConfig) {
    let assets = []
    const listingIssues = []
    const exact = sourceConfig.searchOnly
      ? { assets: [], errors: [] }
      : await collectDescendantImagesByPath(
        sourceConfig.mountId,
        sourceConfig.relativePath,
        job.folderScanDepth || DEFAULT_FOLDER_SCAN_DEPTH,
        { value: SEARCH_FALLBACK_ASSET_BUDGET },
      )
    assets.push(...exact.assets)
    listingIssues.push(...exact.errors)

    let searchItems = []
    let goodsSearchItems = []
    let searchCount = 0
    try {
      searchItems = await searchFiles(sourceConfig.mountId, job.styleCode)
      searchCount += searchItems.length
    } catch (error) {
      listingIssues.push(`搜索款号失败：${String(error?.message || error)}`)
    }
    if (normalizeComparableCode(job.goodsCode) && normalizeComparableCode(job.goodsCode) !== normalizeComparableCode(job.styleCode)) {
      try {
        goodsSearchItems = await searchFiles(sourceConfig.mountId, job.goodsCode)
        searchCount += goodsSearchItems.length
      } catch (error) {
        listingIssues.push(`搜索货号失败：${String(error?.message || error)}`)
      }
    }

    const combinedSearchItems = dedupeItemsByFullpath([...searchItems, ...goodsSearchItems])
    const scopedSearchItems = sourceConfig.restrictSearchToRelativePath
      ? combinedSearchItems.filter(item => isWithinRelativePath(normalizedAssetFullpath(item), sourceConfig.relativePath))
      : combinedSearchItems

    if (sourceConfig.purpose === 'main_image' || (Array.isArray(sourceConfig.pathFeatures) && sourceConfig.pathFeatures.length)) {
      const featureSearchItems = scopedSearchItems.filter(item => itemMatchesMainImageSource(item, job, sourceConfig))
      const featureExactItems = assets.filter(item => itemMatchesMainImageSource(item, job, sourceConfig))
      const selectedMainRoot = selectMainImageSearchRoot([...featureSearchItems, ...featureExactItems], job, sourceConfig)
      const descendantAssets = []
      const descendantErrors = []
      const candidateDirs = dedupeItemsByFullpath(featureSearchItems.filter(isDirectoryItem))
        .sort((a, b) => mainImageSourceSearchScore(b, job) - mainImageSourceSearchScore(a, job) || naturalCompare(normalizedAssetFullpath(a), normalizedAssetFullpath(b)))
        .slice(0, 8)
      for (const dir of candidateDirs) {
        const child = await collectDescendantImagesByPath(
          sourceConfig.mountId,
          normalizedAssetFullpath(dir),
          job.folderScanDepth || DEFAULT_FOLDER_SCAN_DEPTH,
          { value: SEARCH_FALLBACK_ASSET_BUDGET },
        )
        descendantAssets.push(...child.assets)
        descendantErrors.push(...child.errors)
      }
      const featureImages = dedupeItemsByFullpath([
        ...featureExactItems,
        ...featureSearchItems,
        ...descendantAssets,
      ]).filter(isImageFile)
      assets = annotateItemsWithSource(featureImages, sourceConfig)
      const plan = classifyVipshopAssets(job, assets)
      const selected = selectedVipshopAssetEntries(job, plan).length
      const featureNote = `主图源需在「${sourceConfig.mountName}//${sourceConfig.relativePath}」下，路径同时包含：${DEFAULT_MAIN_IMAGE_PATH_FEATURES.join('、')}`
      const noFeatureHit = !featureSearchItems.length && !featureExactItems.length && !descendantAssets.length
      const featureIssues = [
        ...listingIssues,
        ...descendantErrors,
        noFeatureHit ? `${featureNote}；当前搜索款号/货号未命中，常见原因是该路径无权限或文件名未包含款号/货号` : '',
      ].filter(Boolean)
      return {
        plan,
        items: assets,
        selected,
        errors: selected ? [] : featureIssues,
        warnings: selected ? featureIssues : [],
        searchCount,
        selectedStyleRoot: selectedMainRoot?.path || sourceConfig.relativePath,
        sourceMountId: sourceConfig.mountId,
        sourceMountName: sourceConfig.mountName,
        sourceRelativePath: sourceConfig.relativePath,
        sourceRawPath: sourceConfig.rawPath,
        sourceWarning: sourceConfig.sourceWarning,
      }
    }

    const latestRoot = selectLatestStyleRoot([...scopedSearchItems, ...assets], job.styleCode)
    let selectedStyleRoot = ''
    let selectedRootAssets = assets
    if (latestRoot?.path && latestRoot.path !== sourceConfig.relativePath) {
      selectedStyleRoot = latestRoot.path
      const child = await collectDescendantImagesByPath(
        sourceConfig.mountId,
        selectedStyleRoot,
        job.folderScanDepth || DEFAULT_FOLDER_SCAN_DEPTH,
        { value: SEARCH_FALLBACK_ASSET_BUDGET },
      )
      selectedRootAssets = child.assets
      listingIssues.push(...child.errors)
    } else {
      selectedStyleRoot = sourceConfig.relativePath
      selectedRootAssets = assets.filter(item => itemIsUnderStyleRoot(item, selectedStyleRoot))
    }

    const selectedSearchImages = scopedSearchItems
      .filter(isImageFile)
      .filter(item => itemIsUnderStyleRoot(item, selectedStyleRoot))
    const goodsSpecificMainImages = scopedSearchItems
      .filter(item => isLikelyVipshopMainSearchHit(item, job.styleCode, job.goodsCode))
    assets = annotateItemsWithSource(dedupeItemsByFullpath([...selectedRootAssets, ...selectedSearchImages, ...goodsSpecificMainImages]), sourceConfig)
    const plan = classifyVipshopAssets(job, assets)
    const selected = selectedVipshopAssetEntries(job, plan).length
    return {
      plan,
      items: assets,
      selected,
      errors: selected ? [] : listingIssues,
      warnings: selected ? listingIssues : [],
      searchCount,
      selectedStyleRoot,
      sourceMountId: sourceConfig.mountId,
      sourceMountName: sourceConfig.mountName,
      sourceRelativePath: sourceConfig.relativePath,
      sourceRawPath: sourceConfig.rawPath,
    }
  }

  function planCoverageScore(plan = {}) {
    const groups = plan.plan?.groups || {}
    return Number(plan.selected || 0) * 10
      + (groups.mainSquare?.length ? 8 : 0)
      + (groups.listImage?.length ? 8 : 0)
      + (groups.packageMicroSquare?.length ? 4 : 0)
      + (groups.detailSlices?.length || 0)
  }

  function planHasRequiredAssets(job, collected = {}) {
    const groups = collected.plan?.groups || {}
    if (hasScope(job.operationScope, 'main_image')) {
      if (!groups.mainSquare?.length || !groups.listImage?.length) return false
    }
    if (hasScope(job.operationScope, 'package')) {
      if (!groups.packageMicroSquare?.length || !groups.detailSlices?.length) return false
    }
    return true
  }

  function mergeCollectedAssetPlans(job, primary, candidates) {
    const usableCandidates = Array.isArray(candidates) ? candidates : []
    const items = dedupeItemsByFullpath([
      ...(Array.isArray(primary?.items) ? primary.items : []),
      ...usableCandidates.flatMap(item => Array.isArray(item?.items) ? item.items : []),
    ])
    const plan = classifyVipshopAssets(job, items)
    return {
      ...primary,
      plan,
      items,
      selected: selectedVipshopAssetEntries(job, plan).length,
      warnings: [
        ...(primary?.warnings || []),
        ...usableCandidates.flatMap(item => item?.warnings || []),
      ],
    }
  }

  async function collectVipshopAssets(job, sourceConfig) {
    const primary = await collectVipshopAssetsFromSource(job, sourceConfig)
    const candidates = Array.isArray(sourceConfig.candidateSources) ? sourceConfig.candidateSources : []
    if (planHasRequiredAssets(job, primary) || !candidates.length) return primary
    let best = primary
    const candidateIssues = []
    const candidatePlans = []
    for (const candidate of candidates) {
      const plan = await collectVipshopAssetsFromSource(job, candidate)
      candidatePlans.push(plan)
      candidateIssues.push(...(plan.errors || []), ...(plan.warnings || []))
      if (planCoverageScore(plan) > planCoverageScore(best)) {
        best = {
          ...plan,
          warnings: [
            `主目录未匹配到可用素材，已使用候选目录：${candidate.mountName}//${candidate.relativePath}`,
            ...(primary.errors || []),
            ...(primary.warnings || []),
            ...(plan.warnings || []),
          ],
        }
      }
    }
    const merged = mergeCollectedAssetPlans(job, primary, candidatePlans)
    if (planCoverageScore(merged) > planCoverageScore(best)) {
      best = {
        ...merged,
        warnings: [
          '已合并主目录与候选目录素材以补齐包装和对应货号主图',
          ...(primary.errors || []),
          ...(primary.warnings || []),
          ...candidateIssues,
        ],
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

  function scopedJob(job, scope) {
    return {
      ...job,
      operationScope: Array.isArray(scope) ? scope : [scope],
    }
  }

  async function collectVipshopAssetsFromSources(job, sourcesConfig) {
    if (!sourcesConfig || (!sourcesConfig.packageSource && !sourcesConfig.mainImageSource)) {
      return collectVipshopAssets(job, sourcesConfig)
    }
    const collections = []
    if (hasScope(job.operationScope, 'package') && sourcesConfig.packageSource) {
      collections.push({
        scope: 'package',
        result: await collectVipshopAssets(scopedJob(job, 'package'), sourcesConfig.packageSource),
      })
    }
    if (hasScope(job.operationScope, 'main_image') && sourcesConfig.mainImageSource) {
      collections.push({
        scope: 'main_image',
        result: await collectVipshopAssets(scopedJob(job, 'main_image'), sourcesConfig.mainImageSource),
      })
    }
    const items = dedupeItemsByFullpath(collections.flatMap(item => item.result?.items || []))
    const packagePlan = collections.find(item => item.scope === 'package')?.result?.plan || {}
    const mainPlan = collections.find(item => item.scope === 'main_image')?.result?.plan || {}
    const plan = {
      goodsMatched: Number(packagePlan.goodsMatched || 0) + Number(mainPlan.goodsMatched || 0),
      styleFallback: Number(packagePlan.styleFallback || 0) + Number(mainPlan.styleFallback || 0),
      groups: {
        mainSquare: mainPlan.groups?.mainSquare || [],
        listImage: mainPlan.groups?.listImage || [],
        packageMicroSquare: packagePlan.groups?.packageMicroSquare || [],
        detailSlices: packagePlan.groups?.detailSlices || [],
        unmatched: [
          ...(packagePlan.groups?.unmatched || []),
          ...(mainPlan.groups?.unmatched || []),
        ],
      },
    }
    const selected = selectedVipshopAssetEntries(job, plan).length
    const warnings = collections.flatMap(item => item.result?.warnings || [])
    const errors = collections.flatMap(item => item.result?.errors || [])
    const sourceSummary = collections
      .map(item => {
        const result = item.result || {}
        const source = result.sourceRawPath || [result.sourceMountName, result.sourceRelativePath].filter(Boolean).join('//')
        const root = result.selectedStyleRoot && result.selectedStyleRoot !== result.sourceRelativePath ? ` -> ${result.selectedStyleRoot}` : ''
        return `${item.scope}:${source}${root}`
      })
      .filter(Boolean)
      .join('；')
    return {
      plan,
      items,
      selected,
      errors: selected ? [] : errors,
      warnings: selected ? [...warnings, ...errors] : warnings,
      searchCount: collections.reduce((sum, item) => sum + Number(item.result?.searchCount || 0), 0),
      selectedStyleRoot: sourceSummary,
      sourceMountId: sourcesConfig.packageSource?.mountId || sourcesConfig.mainImageSource?.mountId,
      sourceMountName: sourcesConfig.packageSource?.mountName || sourcesConfig.mainImageSource?.mountName,
      sourceRelativePath: sourceSummary || sourcesConfig.packageSource?.relativePath || sourcesConfig.mainImageSource?.relativePath,
      sourceRawPath: sourceSummary || sourcesConfig.packageSource?.rawPath || sourcesConfig.mainImageSource?.rawPath,
      sourceWarning: collections.map(item => item.result?.sourceWarning).filter(Boolean).join('；'),
    }
  }

  async function fetchFileInfo(mountId, fullpath) {
    const query = new URLSearchParams({
      fullpath: String(fullpath || ''),
      mount_id: String(mountId || ''),
    })
    return fetchSemirJson(`/fengcloud/2/file/info?${query.toString()}`)
  }

  function buildDownloadHeaders() {
    const headers = {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    }
    const userAgent = typeof navigator !== 'undefined' ? String(navigator.userAgent || '').trim() : ''
    if (userAgent) headers['User-Agent'] = userAgent
    return headers
  }

  function buildRuntimeFilename(job, item, entry, index) {
    const ext = fileExt(item) || 'jpg'
    const stem = toSafeFilename(
      `${job.styleCode}_${job.goodsCode}__${entry.usageKey || 'asset'}__${index + 1}__${getFileStem(item?.filename || item?.name || '')}`,
      'vipshop_asset',
    )
    return stem.toLowerCase().endsWith(`.${ext}`) ? stem : `${stem}.${ext}`
  }

  async function buildVipshopDownloadPlan(job, sourceConfig) {
    const plan = (sourceConfig?.packageSource || sourceConfig?.mainImageSource)
      ? await collectVipshopAssetsFromSources(job, sourceConfig)
      : await collectVipshopAssets(job, sourceConfig)
    const entries = selectedVipshopAssetEntries(job, plan.plan)
    const rows = []
    const downloadItems = []
    const planSourcePath = plan.sourceRelativePath || sourceConfig?.relativePath || ''

    if (!entries.length) {
      rows.push(buildOutputRow(job, {
        task: '森马云盘找图',
        status: '未匹配到图片',
        endpoint: planSourcePath,
        note: compact([
          `搜索结果 ${plan.searchCount || 0} 条`,
          `选用图包 ${plan.selectedStyleRoot || '无'}`,
          ...(plan.errors || []).slice(0, 3),
        ].filter(Boolean).join('；')),
      }))
      return { rows, downloadItems, plan }
    }

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]
      const baseRow = buildOutputRow(job, {
        task: entry.usage,
        scope: entry.scope,
        file: normalizedAssetFullpath(entry),
        dimension: entry.width && entry.height ? `${entry.width}x${entry.height}` : '',
        endpoint: '/fengcloud/2/file/info',
        imageIndex: String(entry.imageIndex),
        status: '',
        note: compact([plan.sourceWarning, ...(plan.warnings || []).slice(0, 2)].filter(Boolean).join('；')),
      })
      try {
        const info = await fetchFileInfo(entry.__mount_id || sourceConfig?.mountId, entry.file || entry.fullpath || entry.path || '')
        const downloadUrl = String(info?.uri || (Array.isArray(info?.uris) ? info.uris[0] : '') || '').trim()
        if (!downloadUrl) {
          rows.push({
            ...baseRow,
            执行结果: '获取下载链接失败',
            备注: compact([baseRow.备注, 'file/info 未返回 uri'].filter(Boolean).join('；')),
          })
          continue
        }
        const runtimeFilename = buildRuntimeFilename(job, entry, entry, index)
        rows.push({
          ...baseRow,
          __download_asset: {
            ...entry,
            file: normalizedAssetFullpath(entry),
            originalFilename: fileNameOf(entry),
            runtimeFilename,
          },
        })
        downloadItems.push({
          url: downloadUrl,
          filename: runtimeFilename,
          label: `${job.styleCode} / ${job.goodsCode} / ${entry.usage} / ${entry.filename || runtimeFilename}`,
          headers: buildDownloadHeaders(),
          no_proxy: true,
        })
      } catch (error) {
        rows.push({
          ...baseRow,
          执行结果: '获取下载链接失败',
          备注: String(error?.message || error),
        })
      }
    }
    return { rows, downloadItems, plan }
  }

  function finalizeDownloadRows(plannedRows, downloadResult) {
    const items = Array.isArray(downloadResult?.items) ? downloadResult.items : []
    let downloadIndex = 0
    const assetFiles = []
    const rows = (Array.isArray(plannedRows) ? plannedRows : []).map(row => {
      if (row.执行结果) return row
      const result = items[downloadIndex] || {}
      downloadIndex += 1
      const asset = row.__download_asset || {}
      if (result?.success) {
        assetFiles.push({
          ...asset,
          path: String(result.path || ''),
          fullpath: asset.file || '',
          filename: String(result.filename || asset.runtimeFilename || asset.filename || ''),
          localPath: String(result.path || ''),
        })
      }
      return {
        ...row,
        本地文件: String(result?.path || ''),
        执行结果: result?.success ? '已下载' : '下载失败',
        备注: result?.success ? row.备注 || '' : String(result?.error || '下载失败'),
      }
    })
    return { rows, assetFiles }
  }

  function currentJobFromShared(state = shared) {
    const jobs = Array.isArray(state.jobs) ? state.jobs : []
    const index = Math.max(0, Number(state.job_index || 0) || 0)
    return {
      jobs,
      index,
      job: jobs[index] || null,
    }
  }

  function advanceCloudJob(currentRows = [], currentAssets = [], state = shared, sleepMs = 0) {
    const jobs = Array.isArray(state.jobs) ? state.jobs : []
    const index = Number(state.job_index || 0)
    const allRows = [
      ...(Array.isArray(state.result_rows) ? state.result_rows : []),
      ...(Array.isArray(currentRows) ? currentRows : []),
    ]
    const allAssets = [
      ...(Array.isArray(state.downloaded_asset_files) ? state.downloaded_asset_files : []),
      ...(Array.isArray(currentAssets) ? currentAssets : []),
    ]
    const nextIndex = index + 1
    const nextJob = jobs[nextIndex] || null
    const baseShared = {
      ...state,
      result_rows: allRows,
      downloaded_asset_files: allAssets,
      job_index: nextIndex,
      current_job: null,
      current_result_rows: [],
      last_download_result: null,
      pending_download_items: [],
      current_exec_no: Math.min(nextIndex + 1, jobs.length || nextIndex + 1),
      current_store: nextJob?.cloudPath || '',
    }
    if (!nextJob) return nextPhase('navigate_nov_admin', sleepMs, baseShared)
    return nextPhase('collect_cloud_assets', sleepMs, baseShared)
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

  function pdcEditUrl(vendorProductId, vendorType = 1) {
    return `https://vis.vip.com/portal-iframe.php#!/app-v/pdc-vue/product/edit/${encodeURIComponent(vendorProductId)}/${encodeURIComponent(vendorType || 1)}`
  }

  function isPdcOrigin() {
    return /^https:\/\/vis\.vip\.com\/portal-iframe\.php/i.test(String(location.href || ''))
  }

  function isNovOrigin() {
    return /^https:\/\/nov-admin\.vip\.com\//i.test(String(location.href || ''))
  }

  function collectVueInstances(limit = 1000) {
    const roots = Array.from(document.querySelectorAll('*')).map(el => el.__vue__).filter(Boolean)
    const seen = new Set()
    const result = []
    const walk = vue => {
      if (!vue || seen.has(vue) || result.length >= limit) return
      seen.add(vue)
      result.push(vue)
      if (vue.$root && vue.$root !== vue) walk(vue.$root)
      ;(Array.isArray(vue.$children) ? vue.$children : []).forEach(walk)
    }
    roots.forEach(walk)
    return result
  }

  function findRootProductVue() {
    return collectVueInstances()
      .find(v => v && v.$data && v.$data.editData && (v.$data.info || v.$data.editData.vendorProductId || v.$data.vendorProductId)) || null
  }

  function findEditableProductVue(vendorProductId = '') {
    const target = compact(vendorProductId)
    const candidates = collectVueInstances()
      .filter(v => typeof v?.saveAndApprove === 'function' || typeof v?.$options?.methods?.saveAndApprove === 'function')
    if (!target) return candidates[0] || null
    return candidates.find(v => compact(v.info?.vendorProductId || v.$data?.info?.vendorProductId) === target) || candidates[0] || null
  }

  function getPdcEditState(vendorProductId = '') {
    const root = findRootProductVue()
    const editable = findEditableProductVue(vendorProductId)
    const info = editable?.info || editable?.$data?.info || root?.$data?.info || {}
    const editData = editable?.opts || editable?.$data?.opts || root?.$data?.editData || {}
    return {
      rootFound: !!root,
      editableFound: !!editable,
      vendorProductId: compact(info.vendorProductId || editData.vendorProductId || root?.$data?.vendorProductId),
      status: compact(info.status || editData.status || root?.$data?.info?.status),
      title: compact(info.title || editData.title || root?.$data?.info?.title),
      sn: compact(info.sn || editData.sn),
      saveMethods: editable ? Object.keys(editable.$options?.methods || {}).filter(key => /save|approve|publish|precheck|dosave/i.test(key)) : [],
    }
  }

  function isEditableStatus(status) {
    const text = compact(status)
    return !text || ['11', '14'].includes(text)
  }

  async function unpublishProduct(vendorProductId, vendorType = 1) {
    const body = new URLSearchParams({
      vendorProductIdList: compact(vendorProductId),
      vendorType: String(vendorType || 1),
    }).toString()
    return postForm(PDC_UNPUBLISH_URL, body)
  }

  async function publishProduct(vendorProductId, vendorType = 1, operatorId = '') {
    const body = new URLSearchParams({
      vendorProductIdList: compact(vendorProductId),
      operatorId: compact(operatorId),
      vendorType: String(vendorType || 1),
    }).toString()
    return postForm(PDC_PUBLISH_URL, body)
  }

  function fileMimeType(filename) {
    const ext = fileExt(filename)
    if (ext === 'png') return 'image/png'
    if (ext === 'webp') return 'image/webp'
    if (ext === 'gif') return 'image/gif'
    return 'image/jpeg'
  }

  async function uploadVipshopImageFile(file, imageIndex, vendorType = 1) {
    const form = new FormData()
    form.append('image', file)
    form.append('type', String(imageIndex))
    form.append('vendorType', String(vendorType || 1))
    const response = await fetch(PDC_UPLOAD_SQUARE_IMAGE_URL, {
      method: 'POST',
      credentials: 'include',
      body: form,
    })
    const text = await response.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch (error) {
      throw new Error(`上传图片返回非 JSON：${text.slice(0, 160)}`)
    }
    if (!response.ok) throw new Error(`上传图片 HTTP ${response.status}：${compact(json?.msg || text.slice(0, 160))}`)
    if (json.code && String(json.code) !== '200') throw new Error(`上传图片 code=${json.code}：${compact(json.msg || json.message || '接口失败')}`)
    const result = json.result
    if (typeof result === 'string') return result
    if (Array.isArray(result) && result[0]) return result[0].big || result[0].url || result[0].imageUrl || result[0]
    if (result && typeof result === 'object') return result.big || result.url || result.imageUrl || result.path || ''
    return ''
  }

  function imageSizeOf(asset) {
    return asset?.width && asset?.height ? `${asset.width}x${asset.height}` : compact(asset?.imageSize)
  }

  function buildSavedImage(url, imageIndex, asset = {}, index = 0, square = false) {
    return {
      itemId: asset.itemId || '',
      imageUrl: url,
      imageIndex,
      status: null,
      progress: 0,
      request: null,
      file: null,
      imageQcDetail: asset.imageQcDetail || [],
      imageSize: imageSizeOf(asset),
      imageFlag: asset.imageFlag || 0,
      imageType: fileExt(asset.filename || asset.path || asset.file) || 'jpg',
      isSquare: square,
      isBeautyImage: false,
      index,
    }
  }

  function replaceArrayContents(target, nextItems) {
    if (!Array.isArray(target)) return nextItems
    target.splice(0, target.length, ...nextItems)
    return target
  }

  function replaceByImageIndex(existing, replacements, allowedIndexes) {
    const byIndex = new Map()
    ;(Array.isArray(existing) ? existing : []).forEach(item => {
      if (item && item.imageUrl) byIndex.set(Number(item.imageIndex), { ...item })
    })
    replacements.forEach(item => {
      if (item && item.imageUrl) byIndex.set(Number(item.imageIndex), { ...item })
    })
    return allowedIndexes
      .map((imageIndex, index) => byIndex.has(Number(imageIndex)) ? { ...byIndex.get(Number(imageIndex)), imageIndex: Number(imageIndex), index } : null)
      .filter(Boolean)
  }

  const SIZE_ANCHOR_RE = /(尺码表|尺码测量|尺码推荐|尺码推荐表|宝贝尺寸|宝贝尺码|商品尺码表|尺码信息|测量图)/i
  const WANTED_INFO_ANCHOR_RE = /(想要的信息看这里|想看的信息在这里|想要的信息|信息看这里)/i
  const WASH_FALLBACK_ANCHOR_RE = /(不同材质这样洗|不同材质|衣物洗涤|洗涤|水洗|洗唛)/i
  const LOWER_PRESERVE_ANCHOR_RE = /(模特信息|模特展示|宝贝模特|吊牌|吊牌展示|洗涤|水洗|洗唛|不同材质这样洗|不同材质|衣物洗涤|品牌介绍|品牌故事|品牌说明|底部固定|宝贝底部|售后)/i
  const BALAONE_HEAD_ANCHOR_RE = /(bala\s*one|balaone|balabala\s*one|bala\s*1|线上专属|专属产品线|one\s*系列)/i

  function ocrAnchorText(value) {
    const raw = compact(value)
    const joined = raw.replace(/[\s:：,，.。;；|｜_\\/\-—~～]+/g, '')
    return `${raw} ${joined}`
  }

  function isWantedInfoAnchorText(value) {
    return WANTED_INFO_ANCHOR_RE.test(String(value || ''))
  }

  function isWashFallbackAnchorText(value) {
    return WASH_FALLBACK_ANCHOR_RE.test(String(value || ''))
  }

  function isSizeAnchorText(value) {
    return SIZE_ANCHOR_RE.test(String(value || ''))
  }

  function isLowerPreserveAnchorText(value) {
    return LOWER_PRESERVE_ANCHOR_RE.test(String(value || ''))
  }

  function isBalaOneAnchorText(value) {
    return BALAONE_HEAD_ANCHOR_RE.test(ocrAnchorText(value))
  }

  function classifyVipshopOcrAnchorText(value) {
    const text = ocrAnchorText(value)
    if (isBalaOneAnchorText(text)) return 'balaone_head'
    if (isWantedInfoAnchorText(text)) return 'wanted_info'
    if (isWashFallbackAnchorText(text)) return 'wash_fallback'
    if (isSizeAnchorText(text)) return 'size'
    if (isLowerPreserveAnchorText(text)) return 'lower_preserve'
    return ''
  }

  function ocrResultIndex(result, fallbackIndex = 0) {
    const candidates = [result?.globalIndex, result?.index, fallbackIndex]
    for (const value of candidates) {
      const number = Number(value)
      if (Number.isFinite(number) && number >= 0) return number
    }
    return fallbackIndex
  }

  function vipshopDetailAnchorPriority(kind) {
    const normalized = compact(kind)
    if (normalized === 'wanted_info') return 50
    if (normalized === 'wash_fallback') return 40
    if (normalized === 'size') return 20
    if (normalized === 'lower_preserve') return 10
    return 0
  }

  function imageSourceTextForAnchor(item = {}) {
    return [
      item.filename,
      item.originalFilename,
      item.fullpath,
      item.path,
      item.file,
      item.localPath,
      item.imageUrl,
      item.src,
      item.url,
      item.tag,
      item.context,
    ].map(compact).filter(Boolean).join(' ')
  }

  function isBalaOneImageSource(item = {}) {
    return isBalaOneAnchorText(imageSourceTextForAnchor(item))
  }

  function buildVipshopDetailAnchorsFromOcrResults(images = [], ocrResults = [], options = {}) {
    const imageList = Array.isArray(images) ? images : []
    const imageByIndex = new Map(imageList.map((image, index) => [Number(image?.globalIndex ?? index), image]))
    const ocrList = (Array.isArray(ocrResults) ? ocrResults : [])
      .map((result, index) => ({
        ...result,
        globalIndex: ocrResultIndex(result, index),
        text: compact(result?.text || result?.data?.text || ''),
        confidence: Number(result?.confidence ?? result?.data?.confidence ?? 0) || 0,
      }))
      .map(result => ({ ...result, anchorKind: classifyVipshopOcrAnchorText(result.text) }))
      .filter(result => result.text && !result.error)
      .filter(result => !imageList.length || imageByIndex.has(result.globalIndex))
      .sort((a, b) => a.globalIndex - b.globalIndex)

    const sourceBalaOneResults = imageList
      .map((image, index) => ({
        globalIndex: Number(image?.globalIndex ?? index),
        text: imageSourceTextForAnchor(image),
        confidence: 100,
        anchorKind: 'balaone_head',
        fromImageSource: true,
      }))
      .filter(result => Number.isFinite(result.globalIndex) && isBalaOneAnchorText(result.text))
    const balaOneResults = [
      ...ocrList.filter(result => result.anchorKind === 'balaone_head'),
      ...sourceBalaOneResults,
    ].sort((a, b) => a.globalIndex - b.globalIndex)

    const priorities = [
      ['wanted_info', 'wanted_info'],
      ['wash_fallback', 'wash_fallback'],
      ['size', 'size'],
      ['lower_preserve', 'lower_preserve'],
    ]
    let stop = null
    let stopAnchorKind = ''
    for (const [kind, anchorKind] of priorities) {
      const found = ocrList.find(result => result.anchorKind === kind)
      if (!found) continue
      if (!stop || vipshopDetailAnchorPriority(anchorKind) > vipshopDetailAnchorPriority(stopAnchorKind)) {
        stop = found
        stopAnchorKind = anchorKind
      }
    }
    const balaOneBeforeStop = balaOneResults.find(result => !stop || result.globalIndex < stop.globalIndex) || null
    const anchors = {
      ocrStatus: stop ? 'recognized' : (ocrList.length || sourceBalaOneResults.length ? 'no_stop_anchor' : 'no_text'),
      source: compact(options.source || 'tesseract_ocr'),
      confidence: stop ? stop.confidence : (balaOneBeforeStop?.confidence || 0),
      stopImageIndex: stop ? stop.globalIndex : null,
      stopAnchorKind,
      matchedText: stop ? stop.text.slice(0, 120) : '',
      balaOneImageIndex: balaOneBeforeStop ? balaOneBeforeStop.globalIndex : null,
      balaOneText: balaOneBeforeStop ? balaOneBeforeStop.text.slice(0, 120) : '',
      preserveFirstImage: !!balaOneBeforeStop,
      fixedTopImageIndex: balaOneBeforeStop ? balaOneBeforeStop.globalIndex : null,
      fixedTopAnchorKind: balaOneBeforeStop ? 'balaone_head' : '',
      fixedTopText: balaOneBeforeStop ? balaOneBeforeStop.text.slice(0, 120) : '',
    }
    if (!stop) {
      delete anchors.stopImageIndex
      delete anchors.stopAnchorKind
    }
    if (!balaOneBeforeStop) {
      delete anchors.balaOneImageIndex
      delete anchors.balaOneText
      delete anchors.fixedTopImageIndex
      delete anchors.fixedTopAnchorKind
      delete anchors.fixedTopText
    }
    return anchors
  }

  function normalizeVipshopDetailImagesForOcr(images = []) {
    return (Array.isArray(images) ? images : [])
      .map((item, index) => ({
        ...item,
        globalIndex: index,
        index,
        imageIndex: Number.isFinite(Number(item?.imageIndex)) ? Number(item.imageIndex) : 601 + index,
        src: compact(item?.imageUrl || item?.src || item?.url),
      }))
      .filter(item => compact(item.src || item.imageUrl))
  }

  function orderUploadedVipshopDetailImages(uploadedDetailImages = [], uploadedOcrResults = []) {
    const ocrByIndex = new Map((Array.isArray(uploadedOcrResults) ? uploadedOcrResults : []).map((result, index) => [
      ocrResultIndex(result, index),
      result,
    ]))
    return (Array.isArray(uploadedDetailImages) ? uploadedDetailImages : [])
      .map((item, index) => {
        const ocr = ocrByIndex.get(index)
        const isBalaOne = isBalaOneImageSource(item) || isBalaOneAnchorText(ocr?.text || '')
        return {
          ...item,
          __detailOriginalOrder: index,
          __balaOneHead: !!isBalaOne,
          __balaOneText: isBalaOne ? compact(ocr?.text || imageSourceTextForAnchor(item)).slice(0, 120) : '',
        }
      })
      .sort((a, b) => Number(b.__balaOneHead) - Number(a.__balaOneHead) || a.__detailOriginalOrder - b.__detailOriginalOrder)
  }

  function reindexVipshopDetailImages(images = []) {
    return (Array.isArray(images) ? images : [])
      .filter(item => item?.imageUrl)
      .slice(0, 50)
      .map((item, index) => ({
        ...item,
        imageIndex: 601 + index,
        index,
      }))
  }

  function buildAnchoredVipshopDetailImages(existingDetailImages = [], uploadedDetailImages = [], anchors = {}, options = {}) {
    const existing = normalizeVipshopDetailImagesForOcr(existingDetailImages)
    const uploaded = orderUploadedVipshopDetailImages(uploadedDetailImages, options.uploadedOcrResults || [])
    const stopIndex = Number(anchors?.stopImageIndex)
    if (!Number.isFinite(stopIndex) || stopIndex < 0 || stopIndex >= existing.length) {
      return {
        ok: false,
        images: [],
        note: `OCR 未识别到可靠商详保留锚点，已阻断详情图替换；状态=${compact(anchors?.ocrStatus || 'not_run')}`,
      }
    }
    if (!uploaded.length) {
      return {
        ok: false,
        images: [],
        note: '没有可替换的包装详情切片，已阻断详情图替换',
      }
    }
    const uploadedHasBalaOne = uploaded.some(item => item.__balaOneHead)
    const fixedTopIndex = Number(anchors?.balaOneImageIndex ?? anchors?.fixedTopImageIndex)
    const preserveExistingBalaOne = !uploadedHasBalaOne &&
      Number.isFinite(fixedTopIndex) &&
      fixedTopIndex >= 0 &&
      fixedTopIndex < stopIndex
    const preservedTop = preserveExistingBalaOne ? [existing[fixedTopIndex]] : []
    const preservedTail = existing.slice(stopIndex)
    const seen = new Set()
    const merged = []
    for (const item of [...preservedTop, ...uploaded, ...preservedTail]) {
      const url = compact(item?.imageUrl || item?.src || item?.url)
      if (!url || seen.has(url)) continue
      seen.add(url)
      merged.push({ ...item, imageUrl: url })
    }
    const images = reindexVipshopDetailImages(merged)
    const note = compact([
      `OCR锚点=${compact(anchors.stopAnchorKind)}@${stopIndex + 1}`,
      anchors.matchedText ? `命中文本=${anchors.matchedText}` : '',
      uploadedHasBalaOne ? 'balaOne新图已置首位' : '',
      preserveExistingBalaOne ? '保留原balaOne头图置首位' : '',
      `替换原中段${Math.max(0, stopIndex - (preserveExistingBalaOne ? 1 : 0))}张`,
      `保留锚点及之后${preservedTail.length}张`,
    ].filter(Boolean).join('；'))
    return {
      ok: true,
      images,
      note,
      replaceStartIndex: preserveExistingBalaOne ? fixedTopIndex + 1 : 0,
      stopImageIndex: stopIndex,
      preservedTailCount: preservedTail.length,
      preservedTopCount: preservedTop.length,
      uploadedHasBalaOne,
      preserveExistingBalaOne,
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
    const vendorPath = compact(rawParams.tesseract_vendor_path || rawParams.ocr_tesseract_vendor_path || TESSERACT_VENDOR_PATH)
    const localVendorPath = `${assetBase}${vendorPath.startsWith('/') ? vendorPath : `/${vendorPath}`}`
    return {
      scriptUrl: compact(rawParams.tesseract_script_url || rawParams.ocr_tesseract_url || `${localVendorPath}/tesseract.min.js`),
      workerPath: compact(rawParams.tesseract_worker_url || `${localVendorPath}/worker.min.js`),
      corePath: compact(rawParams.tesseract_core_path || localVendorPath),
      langPath: compact(rawParams.tesseract_lang_path || `${localVendorPath}/lang`),
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
    if (/^http:\/\/(?:[a-z0-9-]+\.)?vpimg\d*\.com\//i.test(raw)) return raw.replace(/^http:/i, 'https:')
    try {
      const url = new URL(raw, location.href).href
      if (/^http:\/\/(?:[a-z0-9-]+\.)?vpimg\d*\.com\//i.test(url)) return url.replace(/^http:/i, 'https:')
      return url
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

  async function recognizeImageWithTesseract(Tesseract, worker, image, config) {
    const prepared = await imageSourceForOcr(image.src || image.imageUrl)
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
      const result = await withTimeout(run, config.perImageTimeoutMs, `OCR图片${Number(image.globalIndex || 0) + 1}`)
      return {
        globalIndex: Number(image.globalIndex || 0),
        imageIndex: image.imageIndex,
        src: image.src || image.imageUrl,
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
      .filter(image => compact(image?.src || image?.imageUrl))
      .slice(0, config.maxImages)
    if (!candidates.length) return { ok: false, reason: '没有可 OCR 的图片', results: [] }
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
              globalIndex: Number(image.globalIndex || 0),
              imageIndex: image.imageIndex,
              src: image.src || image.imageUrl,
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

  function makeDetailImages(uploadedDetailImages, existingDetailImages) {
    const seenUrls = new Set()
    const merged = []
    for (const item of [...uploadedDetailImages, ...(Array.isArray(existingDetailImages) ? existingDetailImages : [])]) {
      if (!item?.imageUrl || seenUrls.has(item.imageUrl)) continue
      seenUrls.add(item.imageUrl)
      merged.push({ ...item })
      if (merged.length >= 50) break
    }
    return merged.map((item, index) => ({
      ...item,
      imageIndex: 601 + index,
      index,
    }))
  }

  function findStateTargetColor(state, goodsCode) {
    const colors = state.editData?.itemSkuAttr || state.info?.itemSkuAttr || []
    return colors.find(item => normalizeCode(item.colourGSN) === normalizeCode(goodsCode)) || null
  }

  function findStateTargetColors(state, goodsCodes = []) {
    const colors = state.editData?.itemSkuAttr || state.info?.itemSkuAttr || []
    const wanted = new Set((Array.isArray(goodsCodes) ? goodsCodes : [goodsCodes]).map(normalizeCode).filter(Boolean))
    const matched = []
    for (const color of Array.isArray(colors) ? colors : []) {
      if (wanted.has(normalizeCode(color?.colourGSN))) matched.push(color)
    }
    return matched
  }

  function cloneImageList(images = []) {
    return (Array.isArray(images) ? images : []).map(item => ({ ...item }))
  }

  function colorSquareImageArray(color) {
    if (!color) return []
    if (Array.isArray(color.squareMainImages)) return color.squareMainImages
    if (Array.isArray(color.squareImages)) return color.squareImages
    color.squareMainImages = []
    return color.squareMainImages
  }

  function syncSquareAliases(color) {
    if (!color || !Array.isArray(color.squareMainImages) || !Array.isArray(color.squareImages)) return
    if (color.squareMainImages !== color.squareImages) replaceArrayContents(color.squareImages, color.squareMainImages)
  }

  function applySquareReplacementsToColor(color, replacements, allowedIndexes) {
    if (!color || !Array.isArray(replacements) || !replacements.length) return
    const target = colorSquareImageArray(color)
    replaceArrayContents(target, replaceByImageIndex(target, replacements, allowedIndexes))
    syncSquareAliases(color)
  }

  function currentDetailImagesForContext(context, editable = null, root = null, targetColor = null, merged = false) {
    const editData = editable?.opts || editable?.$data?.opts || root?.$data?.editData || {}
    if (merged && Array.isArray(targetColor?.detailImages)) return targetColor.detailImages
    if (Array.isArray(editData.detailImages)) return editData.detailImages
    if (Array.isArray(targetColor?.detailImages)) return targetColor.detailImages
    if (Array.isArray(context?.product?.detailImages)) return context.product.detailImages
    return []
  }

  function needsVipshopDetailAnchorDetection(context, rawParams = params) {
    if (!hasScope(context?.job?.operationScope, 'package')) return false
    const assets = Array.isArray(context?.assets) ? context.assets : []
    if (!assets.some(asset => asset.usageKey === 'detail_slice')) return false
    return !falsey(rawParams.enable_ocr_anchor_detection)
  }

  function getCurrentVipshopDetailImages(context) {
    const editable = findEditableProductVue(context.vendorProductId)
    const root = findRootProductVue()
    const info = editable?.info || editable?.$data?.info || root?.$data?.info || {}
    const editData = editable?.opts || editable?.$data?.opts || root?.$data?.editData || {}
    const targetColor = findStateTargetColor({ info, editData }, context.job.goodsCode)
    const productForMerge = {
      vendorProductId: context.vendorProductId,
      sn: compact(info.sn || editData.sn || context.product?.sn),
    }
    const merged = Boolean(context.forceColorSpecificDetail || context.merged || isMergedStyle(context.job, productForMerge))
    return normalizeVipshopDetailImagesForOcr(currentDetailImagesForContext(context, editable, root, targetColor, merged))
  }

  async function detectVipshopDetailOcrAnchors(context, rawParams = params) {
    const images = getCurrentVipshopDetailImages(context)
    if (!images.length) {
      return {
        ok: false,
        reason: 'PDC 商详当前没有可 OCR 的图片，无法定位保留锚点',
        images,
        ocr: { ok: false, scanned: 0, results: [] },
        anchors: { ocrStatus: 'no_images', source: 'tesseract_ocr' },
      }
    }
    try {
      const ocr = await runTesseractOcrForImages(images, rawParams)
      const anchors = buildVipshopDetailAnchorsFromOcrResults(images, ocr.results, { source: 'tesseract_ocr' })
      return {
        ok: Number.isFinite(Number(anchors.stopImageIndex)),
        reason: Number.isFinite(Number(anchors.stopImageIndex)) ? '' : 'OCR 未识别到“想要的信息看这里”或洗涤/尺码等可靠保留锚点',
        images,
        ocr,
        anchors,
      }
    } catch (error) {
      return {
        ok: false,
        reason: String(error?.message || error),
        images,
        ocr: { ok: false, scanned: 0, results: [] },
        anchors: { ocrStatus: 'failed', source: 'tesseract_ocr' },
      }
    }
  }

  async function detectUploadedVipshopDetailBalaOne(uploadRecords = [], rawParams = params) {
    const detailRecords = (Array.isArray(uploadRecords) ? uploadRecords : [])
      .filter(record => record.usageKey === 'detail_slice')
    if (!detailRecords.length) return { ok: true, scanned: 0, results: [] }
    if (detailRecords.some(record => isBalaOneImageSource(record.asset || record))) return { ok: true, scanned: 0, results: [] }
    const maxImages = positiveInt(rawParams.balaone_ocr_max_images || rawParams.uploaded_balaone_ocr_max_images, 12)
    const images = detailRecords.map((record, index) => ({
      globalIndex: index,
      imageIndex: record.imageIndex,
      src: record.imageUrl,
      imageUrl: record.imageUrl,
      filename: record.asset?.filename,
      path: record.asset?.path,
      originalFilename: record.asset?.originalFilename,
    }))
    try {
      return await runTesseractOcrForImages(images, {
        ...rawParams,
        ocr_max_images: maxImages,
        ocr_total_timeout_ms: positiveInt(rawParams.uploaded_balaone_ocr_total_timeout_ms, 90000),
      })
    } catch (error) {
      return {
        ok: false,
        scanned: 0,
        results: [],
        error: String(error?.message || error),
      }
    }
  }

  function applyUploadedImagesToPdcState(context, uploadRecords, detailOptions = {}) {
    const editable = findEditableProductVue(context.vendorProductId)
    const root = findRootProductVue()
    const info = editable?.info || editable?.$data?.info || root?.$data?.info || {}
    const editData = editable?.opts || editable?.$data?.opts || root?.$data?.editData || {}
    const targetColor = findStateTargetColor({ info, editData }, context.job.goodsCode)
    if (!targetColor) throw new Error(`PDC 编辑页未找到目标货号颜色：${context.job.goodsCode}`)

    const productForMerge = {
      vendorProductId: context.vendorProductId,
      sn: compact(info.sn || editData.sn || context.product?.sn),
    }
    const merged = Boolean(context.forceColorSpecificDetail || context.merged || isMergedStyle(context.job, productForMerge))
    const mainRecords = uploadRecords.filter(record => record.usageKey === 'main_square')
    const listRecords = uploadRecords.filter(record => record.usageKey === 'list_image')
    const microRecords = uploadRecords.filter(record => record.usageKey === 'package_micro_square')
    const detailRecords = uploadRecords.filter(record => record.usageKey === 'detail_slice')
    const detailTargetGoodsCodes = Array.from(new Set(
      (Array.isArray(context.detailSharedGoodsCodes) && context.detailSharedGoodsCodes.length
        ? context.detailSharedGoodsCodes
        : [context.job.goodsCode]).map(normalizeCode).filter(Boolean),
    ))
    const detailTargetColors = findStateTargetColors({ info, editData }, detailTargetGoodsCodes)
    if (detailRecords.length && !detailTargetColors.length) {
      throw new Error(`PDC 编辑页未找到同款商品详情图目标货号颜色：${detailTargetGoodsCodes.join('、')}`)
    }

    const mainSquareReplacements = []
    mainRecords.forEach((record, index) => {
      const imageIndex = index === 0 ? 1 : 2
      mainSquareReplacements.push(buildSavedImage(record.imageUrl, imageIndex, record.asset, index, true))
    })
    if (mainSquareReplacements.length) {
      applySquareReplacementsToColor(targetColor, mainSquareReplacements, [1, 2, 3, 4, 15, 16, 17, 18, 19, 20, 21, 22])
    }

    const microSquareReplacements = []
    microRecords.forEach((record, index) => {
      const imageIndex = 3 + index
      microSquareReplacements.push(buildSavedImage(record.imageUrl, imageIndex, record.asset, index + 2, true))
    })
    if (microSquareReplacements.length) {
      applySquareReplacementsToColor(targetColor, microSquareReplacements, [1, 2, 3, 4, 15, 16, 17, 18, 19, 20, 21, 22])
    }

    if (listRecords.length) {
      const list = buildSavedImage(listRecords[0].imageUrl, 50, listRecords[0].asset, 0, false)
      replaceArrayContents(targetColor.listImages || targetColor.listPics || [], [list])
      if (Array.isArray(targetColor.list_5_7)) replaceArrayContents(targetColor.list_5_7, targetColor.list_5_7)
    }

    if (detailRecords.length) {
      const uploadedDetail = detailRecords.map((record, index) => buildSavedImage(record.imageUrl, 601 + index, record.asset, index, false))
      const requireAnchors = detailOptions.requireAnchors !== false && needsVipshopDetailAnchorDetection(context)
      const anchors = detailOptions.anchors || {}
      const existingForAnchor = Array.isArray(detailOptions.existingDetailImages) && detailOptions.existingDetailImages.length
        ? detailOptions.existingDetailImages
        : currentDetailImagesForContext(context, editable, root, targetColor, merged)
      const anchored = requireAnchors
        ? buildAnchoredVipshopDetailImages(existingForAnchor, uploadedDetail, anchors, {
          uploadedOcrResults: detailOptions.uploadedOcrResults || [],
        })
        : { ok: true, images: makeDetailImages(uploadedDetail, merged ? targetColor.detailImages || [] : editData.detailImages || []), note: '未启用OCR锚点，使用旧合并逻辑' }
      if (!anchored.ok) throw new Error(anchored.note || '商详 OCR 锚点校验失败')
      if (merged) {
        info.shareDetailPic = false
        if (root?.$data?.info) root.$data.info.shareDetailPic = false
        for (const color of detailTargetColors) {
          if (!Array.isArray(color.detailImages)) color.detailImages = []
          replaceArrayContents(color.detailImages, cloneImageList(anchored.images))
        }
      } else {
        const current = editData.detailImages || []
        replaceArrayContents(current, anchored.images)
        editData.detailImages = current
        info.shareDetailPic = true
        if (root?.$data?.info) root.$data.info.shareDetailPic = true
      }
      detailOptions.detailApplyResult = anchored
    }

    if (editable && typeof editable.$nextTick === 'function') editable.$nextTick(() => {})
    return {
      editableFound: !!editable,
      merged,
      targetColorName: compact(targetColor.aliasesName || targetColor.colourName),
      targetSquareCount: (targetColor.squareMainImages || targetColor.squareImages || []).filter(item => item?.imageUrl).length,
      targetListCount: (targetColor.listImages || targetColor.listPics || []).filter(item => item?.imageUrl).length,
      targetDetailCount: (merged ? targetColor.detailImages || [] : editData.detailImages || []).filter(item => item?.imageUrl).length,
      detailApplyResult: detailOptions.detailApplyResult || null,
    }
  }

  async function waitForImageUploadSettled(timeoutMs = 120000) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const input = document.querySelector(UPLOAD_INPUT_SELECTOR)
      if (!input) return
      await new Promise(resolve => setTimeout(resolve, 500))
      return
    }
  }

  function loadImageDimensions(file) {
    return new Promise(resolve => {
      if (!file || typeof URL === 'undefined' || typeof Image === 'undefined') return resolve({ width: 0, height: 0 })
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

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      if (!file || typeof URL === 'undefined' || typeof Image === 'undefined') return reject(new Error('当前浏览器不支持图片读取'))
      const url = URL.createObjectURL(file)
      const image = new Image()
      image.onload = () => {
        URL.revokeObjectURL(url)
        resolve(image)
      }
      image.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error(`图片读取失败：${file.name || 'unknown'}`))
      }
      image.src = url
    })
  }

  function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.94) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob)
        else reject(new Error('图片规格转换失败：canvas 未返回 blob'))
      }, type, quality)
    })
  }

  async function buildResizedUploadFile(file, targetWidth, targetHeight, filename) {
    const image = await loadImageElement(file)
    const sourceWidth = image.naturalWidth || image.width || 0
    const sourceHeight = image.naturalHeight || image.height || 0
    if (sourceWidth < targetWidth || sourceHeight < targetHeight) {
      throw new Error(`源图尺寸${sourceWidth}x${sourceHeight}小于目标${targetWidth}x${targetHeight}`)
    }
    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('当前浏览器不支持图片规格转换')
    const sourceRatio = sourceWidth / sourceHeight
    const targetRatio = targetWidth / targetHeight
    let sx = 0
    let sy = 0
    let sw = sourceWidth
    let sh = sourceHeight
    if (sourceRatio > targetRatio) {
      sw = Math.round(sourceHeight * targetRatio)
      sx = Math.round((sourceWidth - sw) / 2)
    } else if (sourceRatio < targetRatio) {
      sh = Math.round(sourceWidth / targetRatio)
      sy = Math.round((sourceHeight - sh) / 2)
    }
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, targetWidth, targetHeight)
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight)
    const blob = await canvasToBlob(canvas)
    const name = toSafeFilename(filename || file.name || `vipshop_${targetWidth}x${targetHeight}.jpg`)
    if (typeof File === 'function') return new File([blob], name, { type: 'image/jpeg' })
    blob.name = name
    return blob
  }

  async function normalizeVipshopUploadFile(asset, file, dimensions) {
    const width = Number(dimensions?.width || 0)
    const height = Number(dimensions?.height || 0)
    if (asset.usageKey === 'main_square' && !(width === 1200 && height === 1200)) {
      const nextFile = await buildResizedUploadFile(file, 1200, 1200, `vipshop_1200x1200_${file.name || asset.filename || 'main.jpg'}`)
      return { file: nextFile, dimensions: { width: 1200, height: 1200 }, transformed: true }
    }
    if (asset.usageKey === 'list_image' && !((width === 950 && height === 1200) || (width === 1200 && height === 950))) {
      const nextFile = await buildResizedUploadFile(file, 950, 1200, `vipshop_950x1200_${file.name || asset.filename || 'list.jpg'}`)
      return { file: nextFile, dimensions: { width: 950, height: 1200 }, transformed: true }
    }
    return { file, dimensions: { width, height }, transformed: false }
  }

  function validateInjectedVipshopAsset(asset, dimensions) {
    const width = Number(dimensions?.width || 0)
    const height = Number(dimensions?.height || 0)
    const size = `${width}x${height}`
    if (!width || !height) return `无法读取图片尺寸：${asset.filename || asset.path || asset.file || 'unknown'}`
    if (asset.usageKey === 'main_square' && !(width === 1200 && height === 1200)) return `主图要求1200x1200，当前${size}`
    if (asset.usageKey === 'package_micro_square' && !(width === 1200 && height === 1200)) return `包装微详情要求1200x1200，当前${size}`
    if (asset.usageKey === 'list_image' && !((width === 950 && height === 1200) || (width === 1200 && height === 950))) {
      return `商品列表图要求950x1200或1200x950，当前${size}`
    }
    return ''
  }

  async function uploadInjectedFilesAndApply(context, assets, detailOptions = {}) {
    const input = document.querySelector(UPLOAD_INPUT_SELECTOR)
    const files = Array.from(input?.files || [])
    if (files.length < assets.length) throw new Error(`文件注入失败：仅注入 ${files.length}/${assets.length} 个文件`)
    const enrichedAssets = []
    const uploadFiles = []
    const validationErrors = []
    for (let index = 0; index < assets.length; index += 1) {
      const sourceDimensions = await loadImageDimensions(files[index])
      let normalized = null
      try {
        normalized = await normalizeVipshopUploadFile(assets[index], files[index], sourceDimensions)
      } catch (error) {
        validationErrors.push(`${assets[index].usage || assets[index].usageKey || '图片'}：${String(error?.message || error)}`)
        normalized = { file: files[index], dimensions: sourceDimensions, transformed: false }
      }
      const dimensions = normalized.dimensions
      const asset = {
        ...assets[index],
        width: dimensions.width || assets[index]?.width || 0,
        height: dimensions.height || assets[index]?.height || 0,
        imageSize: dimensions.width && dimensions.height ? `${dimensions.width}x${dimensions.height}` : imageSizeOf(assets[index]),
        transformNote: normalized.transformed ? `由云盘原图${sourceDimensions.width || 0}x${sourceDimensions.height || 0}生成唯品规格${dimensions.width}x${dimensions.height}` : '',
      }
      const validation = validateInjectedVipshopAsset(asset, dimensions)
      if (validation) validationErrors.push(`${asset.usage || asset.usageKey || '图片'}：${validation}`)
      enrichedAssets.push(asset)
      uploadFiles.push(normalized.file)
    }
    if (validationErrors.length) throw new Error(`上传前尺寸校验失败：${validationErrors.slice(0, 6).join('；')}`)
    const uploadRecords = []
    for (let index = 0; index < enrichedAssets.length; index += 1) {
      const asset = enrichedAssets[index]
      const file = uploadFiles[index]
      const imageUrl = await uploadVipshopImageFile(file, asset.imageIndex, context.vendorType)
      if (!imageUrl) throw new Error(`上传成功但未返回图片 URL：${asset.filename || file.name}`)
      uploadRecords.push({ asset, imageUrl, usageKey: asset.usageKey, usage: asset.usage, imageIndex: asset.imageIndex })
    }
    await waitForImageUploadSettled()
    const uploadedDetailOcr = await detectUploadedVipshopDetailBalaOne(uploadRecords, params)
    const applyResult = applyUploadedImagesToPdcState(context, uploadRecords, {
      ...detailOptions,
      uploadedOcrResults: uploadedDetailOcr.results || [],
    })
    if (applyResult.detailApplyResult && uploadedDetailOcr.error) {
      applyResult.detailApplyResult = {
        ...applyResult.detailApplyResult,
        note: compact([applyResult.detailApplyResult.note, `新图balaOne OCR失败，已按文件名兜底：${uploadedDetailOcr.error}`].filter(Boolean).join('；')),
      }
    }
    return { uploadRecords, applyResult }
  }

  function isVisibleElement(el) {
    return !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
  }

  function clickVisibleAlertConfirm(textPattern = null) {
    const dialogSelectors = [
      '.bootbox.modal.in',
      '.modal.in',
      '.modal[style*="display: block"]',
      '[role="dialog"]',
      '.ant-modal',
      '.el-message-box',
      '.ivu-modal',
    ]
    const seen = new Set()
    const dialogs = []
    for (const selector of dialogSelectors) {
      for (const dialog of Array.from(document.querySelectorAll(selector))) {
        if (!isVisibleElement(dialog) || seen.has(dialog)) continue
        seen.add(dialog)
        dialogs.push(dialog)
      }
    }
    const matchingDialogs = dialogs.filter(dialog => {
      const text = compact(dialog.innerText || dialog.textContent || '')
      return !textPattern || textPattern.test(text)
    })
    const dialog = matchingDialogs[matchingDialogs.length - 1]
    if (!dialog) return false
    const buttons = Array.from(dialog.querySelectorAll('button, a, [role="button"]'))
      .filter(isVisibleElement)
      .filter(el => /确定|确认|知道|继续|OK/i.test(compact(el.innerText || el.textContent || el.getAttribute?.('aria-label') || '')))
    const primary = buttons.find(el => /primary|confirm|ok/i.test(String(el.className || '')))
    const button = primary || buttons[buttons.length - 1]
    if (!button) return false
    button.click()
    return true
  }

  function callSaveAndApprove(context) {
    const editable = findEditableProductVue(context.vendorProductId)
    if (!editable) throw new Error('PDC 编辑组件未进入可保存状态')
    editable.fromSaveAndApprove = true
    editable.__timeStart = +new Date()
    if (typeof editable.saveAndApprove === 'function') editable.saveAndApprove()
    else if (editable.$options?.methods?.saveAndApprove) editable.$options.methods.saveAndApprove.call(editable)
    else throw new Error('PDC 编辑组件缺少 saveAndApprove 方法')
    return true
  }

  function continueEditPreCheckIfVisible(context) {
    const editable = findEditableProductVue(context.vendorProductId)
    if (!editable) return false
    const preview = editable.editPreCheck?.previewData || editable.$data?.editPreCheck?.previewData || []
    if (Array.isArray(preview) && preview.length && typeof editable.doSave === 'function') {
      editable.doSave()
      return true
    }
    return false
  }

  function buildLiveContextRows(context, status, note = '') {
    const sharedDetailNote = context.detailSharedFromGoodsCode
      ? `商品详情图与同商品同款货号 ${context.detailSharedFromGoodsCode} 共用，未重复上传详情切片`
      : ''
    return [buildOutputRow(context.job, {
      task: '线上替换',
      status,
      merchandiseNo: context.merchandise?.merchandiseNo,
      vendorSpuId: context.vendorProductId,
      prodSpuId: context.merchandise?.prodSpuId,
      productStatus: statusLabel(context.product?.status),
      productName: context.merchandise?.name || context.product?.title,
      backendStyle: context.product?.sn || context.merchandise?.osn,
      mergedStyle: context.merged ? '是' : '否',
      colorName: context.color?.aliasesName || context.color?.colourName,
      colorCode: context.color?.colourGSN,
      colorMatch: context.color?.colourGSN ? '已匹配' : '',
      endpoint: PDC_UPLOAD_SQUARE_IMAGE_URL,
      note: compact([sharedDetailNote, note].filter(Boolean).join('；')),
    })]
  }

  function currentPdcStateSnapshotForVerify(context) {
    const editable = findEditableProductVue(context?.vendorProductId)
    const root = findRootProductVue()
    const info = editable?.info || editable?.$data?.info || root?.$data?.info || {}
    const editData = editable?.opts || editable?.$data?.opts || root?.$data?.editData || {}
    const targetColor = context?.job?.goodsCode ? findStateTargetColor({ info, editData }, context.job.goodsCode) : null
    const detailPageImages = collectVueInstances()
      .filter(v => ['draft-images', 'publish-images'].includes(v?.$options?.name || ''))
      .flatMap(v => (Array.isArray(v?.$data?.imageTabs) ? v.$data.imageTabs : []))
      .flatMap(tab => [
        ...(Array.isArray(tab?.images) ? tab.images : []),
        ...(Array.isArray(tab?.imgs) ? tab.imgs : []),
        ...(Array.isArray(tab?.list) ? tab.list : []),
        ...(Array.isArray(tab?.pics) ? tab.pics : []),
        ...(Array.isArray(tab?.value) ? tab.value : []),
      ])
      .map(item => compact(item?.imageUrl || item?.url || item?.src))
      .filter(Boolean)
    return {
      info: {
        vendorProductId: info.vendorProductId,
        status: info.status,
        sn: info.sn,
        shareDetailPic: info.shareDetailPic,
      },
      editData: {
        vendorProductId: editData.vendorProductId,
        status: editData.status,
        sn: editData.sn,
        detailImages: editData.detailImages,
      },
      targetColor,
      detailPageImages,
    }
  }

  function verifyImageUrlInDetail(url, product, context = null) {
    const text = JSON.stringify({
      product: product || {},
      pageState: context ? currentPdcStateSnapshotForVerify(context) : {},
    })
    return !!url && text.includes(url)
  }

  function buildJobContexts(parsed, merchandiseResult, assetFiles, rawParams = params) {
    const merchandiseByGoods = indexMerchandiseRows(merchandiseResult.rows)
    return Promise.all(parsed.jobs.map(async job => {
      const merchandise = merchandiseByGoods.get(normalizeCode(job.goodsCode))
      if (!merchandise) {
        return { job, merchandise: null, error: '按完整货号查询唯品会商品资料未命中' }
      }
      const product = await queryProductDetail(merchandise.vendorSpuId, rawParams.vendor_type || 1)
      const color = findTargetColor(product, job.goodsCode)
      const assetPlan = classifyVipshopAssets(job, assetFiles)
      return {
        job,
        merchandise,
        product,
        color,
        assetPlan,
        assets: selectedVipshopAssetEntries(job, assetPlan).map(entry => ({
          ...entry,
          path: entry.path || entry.localPath || entry.file,
        })),
        vendorProductId: compact(merchandise.vendorSpuId || product.vendorProductId),
        vendorType: rawParams.vendor_type || 1,
        merged: isMergedStyle(job, product),
      }
    }))
  }

  function requiredAssetMissing(context) {
    const plan = context?.assetPlan || {}
    const missing = []
    if (hasScope(context.job.operationScope, 'main_image')) {
      if (!plan.groups?.mainSquare?.[0]) missing.push('主图-商品图片1200x1200')
      if (!plan.groups?.listImage?.[0]) missing.push('主图-商品列表图950x1200')
    }
    if (hasScope(context.job.operationScope, 'package')) {
      if (!plan.groups?.packageMicroSquare?.length) missing.push('包装-微详情1200x1200')
      if (!plan.groups?.detailSlices?.length) missing.push('包装-商品详情切片')
    }
    return missing
  }

  function currentLiveContext(state = shared) {
    const contexts = Array.isArray(state.live_contexts) ? state.live_contexts : []
    const index = Math.max(0, Number(state.live_index || 0) || 0)
    return {
      contexts,
      index,
      context: contexts[index] || null,
    }
  }

  function advanceLiveJob(currentRows = [], state = shared, sleepMs = 0) {
    const contexts = Array.isArray(state.live_contexts) ? state.live_contexts : []
    const index = Number(state.live_index || 0)
    const allRows = [
      ...(Array.isArray(state.live_rows) ? state.live_rows : []),
      ...(Array.isArray(currentRows) ? currentRows : []),
    ]
    const nextIndex = index + 1
    const nextContext = contexts[nextIndex] || null
    const nextShared = {
      ...state,
      live_rows: allRows,
      live_index: nextIndex,
      current_live_uploads: [],
      current_injected_assets: [],
      pdc_wait_attempts: 0,
      live_verify_attempts: 0,
      current_unpublished: false,
      precheck_continued: false,
      publish_fallback_called: false,
      apply_result: null,
      current_detail_ocr_attempted: false,
      current_detail_ocr_anchors: null,
      current_detail_ocr_result: null,
      current_detail_existing_images: [],
      current_exec_no: Math.min(nextIndex + 1, contexts.length || nextIndex + 1),
      current_buyer_id: nextContext?.job?.goodsCode || '',
      current_store: nextContext?.vendorProductId || '',
    }
    if (!nextContext) {
      const allData = [
        ...(Array.isArray(state.result_rows) ? state.result_rows : []),
        ...allRows,
      ]
      return complete(allData, {
        ...nextShared,
        current_exec_no: contexts.length,
        current_buyer_id: '',
        current_store: '全部线上替换任务完成',
      })
    }
    return nextPhase('process_live_job', sleepMs, nextShared)
  }

  function complete(data = [], nextShared = shared) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: false,
        shared: nextShared,
      },
    }
  }

  function exposeHelpers() {
    if (!testExports) return
    Object.assign(testExports, {
      compact,
      normalizeCode,
      rowValue,
      splitCodes,
      normalizeExecuteMode,
      normalizePackageMainJobs,
      parseCloudPath,
      deriveJobCloudPath,
      normalizeCandidateCloudPaths,
      defaultSemirCloudPath,
      defaultVipshopMainImageCloudRoot,
      normalizeMainImagePathFeatures,
      pathMatchesMainImagePathFeatures,
      shouldUseCloudLookup,
      allowLiveExecution,
      parseImageDimensions,
      classifyVipshopAssets,
      selectedVipshopAssetEntries,
      coalesceLiveDetailContexts,
      findStateTargetColors,
      styleRootPathFromFullpath,
      collectStyleRootCandidates,
      itemMatchesMainImageSource,
      resolveVipshopCloudSources,
      collectVipshopAssetsFromSources,
      buildVipshopDownloadPlan,
      vipshopCloudPathScore,
      vipshopMainAssetPriority,
      hasOtherStyleFolder,
      validateInjectedVipshopAsset,
      collectAssetFiles,
      buildMerchandiseQueryPayload,
      buildProductDetailPayload,
      indexMerchandiseRows,
      findTargetColor,
      isMergedStyle,
      buildJobPlanRows,
      statusLabel,
      hasScope,
      isSupportedExecutionOrigin,
      replaceByImageIndex,
      makeDetailImages,
      classifyVipshopOcrAnchorText,
      buildVipshopDetailAnchorsFromOcrResults,
      buildAnchoredVipshopDetailImages,
      orderUploadedVipshopDetailImages,
      tesseractRuntimeConfig,
      needsVipshopDetailAnchorDetection,
      clickVisibleAlertConfirm,
    })
  }

  exposeHelpers()
  if (phase === '__exports__') return complete([], shared)

  try {
    if (phase === 'main' || phase === 'init') {
      const parsed = normalizePackageMainJobs(params.input_file, params)
      if (!parsed.totalRows) return complete([summaryRow('输入表为空，请上传包含「款号」「货号」两列的 Excel。', '预检失败')], shared)
      if (!parsed.jobs.length) return complete([summaryRow(`输入表 ${parsed.totalRows} 行，没有可执行款号+货号。`, '预检失败'), ...parsed.invalidRows], shared)

      if (normalizeExecuteMode(params.execute_mode) === 'live' && !allowLiveExecution(params)) {
        return complete([
          summaryRow(`${LIVE_AUTH_MESSAGE} 本次仅输出 ${parsed.jobs.length} 行安全阻断结果。`, '已阻断'),
          ...parsed.invalidRows,
          ...liveBlockedRows(parsed.jobs),
        ], {
          ...shared,
          execute_mode: 'live',
          live_blocked: true,
          total_jobs: parsed.jobs.length,
        })
      }

      const nextShared = {
        ...shared,
        jobs: parsed.jobs,
        job_index: 0,
        result_rows: parsed.invalidRows,
        downloaded_asset_files: collectAssetFiles(params, shared),
        total_input_rows: parsed.totalRows,
        total_jobs: parsed.jobs.length,
        execute_mode: normalizeExecuteMode(params.execute_mode),
        use_cloud_lookup: shouldUseCloudLookup(params, shared),
        current_exec_no: 1,
        current_buyer_id: parsed.jobs[0]?.goodsCode || '',
        current_store: parsed.jobs[0]?.cloudPath || '',
      }

      if (nextShared.use_cloud_lookup) {
        if (!/^https:\/\/fmp\.semirapp\.com\//i.test(String(location.href || ''))) {
          return navigateTo(SEMIR_ENTRY_URL, 'collect_cloud_assets', 2000, nextShared)
        }
        return nextPhase('collect_cloud_assets', 0, nextShared)
      }
      return nextPhase('navigate_nov_admin', 0, nextShared)
    }

    if (phase === 'collect_cloud_assets') {
      if (!/^https:\/\/fmp\.semirapp\.com\//i.test(String(location.href || ''))) {
        return navigateTo(SEMIR_ENTRY_URL, 'collect_cloud_assets', 2000, shared)
      }
      const { job } = currentJobFromShared(shared)
      if (!job) return nextPhase('navigate_nov_admin', 0, shared)
      try {
        const sourceConfig = await resolveVipshopCloudSources(job)
        const plan = await buildVipshopDownloadPlan(job, sourceConfig)
        const sourceLabel = [
          sourceConfig.packageSource ? `包装:${sourceConfig.packageSource.mountName}//${sourceConfig.packageSource.relativePath}` : '',
          sourceConfig.mainImageSource ? `主图:${sourceConfig.mainImageSource.mountName}//${sourceConfig.mainImageSource.relativePath}` : '',
        ].filter(Boolean).join('；')
        const nextShared = {
          ...clearSemirLoginWaitState(shared),
          current_job: job,
          current_result_rows: plan.rows,
          pending_download_items: plan.downloadItems,
          last_download_result: null,
          current_buyer_id: job.goodsCode,
          current_store: sourceLabel,
          plan_summary: {
            selected: plan.plan?.selected,
            searchCount: plan.plan?.searchCount,
            selectedStyleRoot: plan.plan?.selectedStyleRoot,
          },
        }
        if (!plan.downloadItems.length) return advanceCloudJob(plan.rows, [], nextShared)
        return downloadUrls(plan.downloadItems, 'after_cloud_download', {
          shared_key: 'last_download_result',
          strict: false,
          concurrency: DOWNLOAD_CONCURRENCY,
          retry_attempts: DOWNLOAD_RETRY_ATTEMPTS,
          retry_delay_ms: DOWNLOAD_RETRY_DELAY_MS,
        }, nextShared)
      } catch (error) {
        if (error?.isSemirLoginTimeout) return waitForSemirLogin('collect_cloud_assets', shared, error)
        const rows = [buildOutputRow(job, {
          task: '森马云盘找图',
          status: '找图失败',
          endpoint: SEMIR_ENTRY_URL,
          note: error.message || String(error),
        })]
        return advanceCloudJob(rows, [], {
          ...clearSemirLoginWaitState(shared),
          current_job: job,
        })
      }
    }

    if (phase === 'after_cloud_download') {
      const finalized = finalizeDownloadRows(shared.current_result_rows, shared.last_download_result)
      return advanceCloudJob(finalized.rows, finalized.assetFiles, {
        ...shared,
        current_result_rows: finalized.rows,
        pending_download_items: [],
      })
    }

    if (phase === 'navigate_nov_admin') {
      if (!isNovOrigin()) return navigateTo(VIPSHOP_NOV_ENTRY_URL, 'query_vipshop', 2500, shared)
      return nextPhase('query_vipshop', 0, shared)
    }

    if (phase === 'query_vipshop') {
      if (!isNovOrigin()) return navigateTo(VIPSHOP_NOV_ENTRY_URL, 'query_vipshop', 2500, shared)
      const jobs = Array.isArray(shared.jobs) ? shared.jobs : []
      if (!jobs.length) return complete([summaryRow('没有可执行任务。', '预检失败')], shared)
      const goodsCodes = jobs.map(job => job.goodsCode)
      const assetFiles = collectAssetFiles(params, shared)
      const merchandiseResult = await queryMerchandiseRows(goodsCodes, params)
      const merchandiseByGoods = indexMerchandiseRows(merchandiseResult.rows)
      const outputRows = [...(Array.isArray(shared.result_rows) ? shared.result_rows : [])]
      const liveContexts = []
      let detailReads = 0

      for (const job of jobs) {
        const merchandise = merchandiseByGoods.get(normalizeCode(job.goodsCode))
        if (!merchandise) {
          outputRows.push(buildOutputRow(job, {
            task: '商品资料预检',
            status: '未找到商品',
            endpoint: '/normal/normalMerchandiseQuery',
            note: '按完整货号查询唯品会商品资料未命中',
          }))
          continue
        }
        try {
          const product = await queryProductDetail(merchandise.vendorSpuId, params.vendor_type || 1)
          detailReads += 1
          const color = findTargetColor(product, job.goodsCode)
          const assetPlan = classifyVipshopAssets(job, assetFiles)
          const context = {
            job,
            merchandise,
            product,
            color,
            assetPlan,
            assets: selectedVipshopAssetEntries(job, assetPlan).map(entry => ({
              ...entry,
              path: entry.path || entry.localPath || entry.file,
            })),
            vendorProductId: compact(merchandise.vendorSpuId || product.vendorProductId),
            vendorType: params.vendor_type || 1,
            merged: isMergedStyle(job, product),
          }
          outputRows.push(...buildJobPlanRows(job, merchandise, product, color, assetPlan))
          const missing = color?.colourGSN ? requiredAssetMissing(context) : ['目标颜色未匹配']
          if (allowLiveExecution(params) && !missing.length) {
            liveContexts.push(context)
          } else if (allowLiveExecution(params) && missing.length) {
            outputRows.push(buildOutputRow(job, {
              task: '线上替换',
              status: '未执行',
              merchandiseNo: merchandise.merchandiseNo,
              vendorSpuId: merchandise.vendorSpuId,
              prodSpuId: merchandise.prodSpuId,
              productStatus: statusLabel(product.status),
              productName: merchandise.name || product.title,
              backendStyle: product.sn || merchandise.osn,
              mergedStyle: context.merged ? '是' : '否',
              colorName: color?.aliasesName || color?.colourName,
              colorCode: color?.colourGSN,
              colorMatch: color?.colourGSN ? '已匹配' : '',
              note: `素材或颜色不完整：${missing.join('、')}`,
            }))
          }
        } catch (error) {
          outputRows.push(buildOutputRow(job, {
            task: 'PDC详情预检',
            status: '详情读取失败',
            merchandiseNo: merchandise.merchandiseNo,
            vendorSpuId: merchandise.vendorSpuId,
            prodSpuId: merchandise.prodSpuId,
            productName: merchandise.name,
            backendStyle: merchandise.osn,
            endpoint: '/product/queryVendorProductByVpIdForVc',
            note: error.message || String(error),
          }))
        }
      }

      const executableLiveContexts = coalesceLiveDetailContexts(liveContexts)
      const sharedDetailSkips = executableLiveContexts.filter(context => context.detailShareRole === 'shared_skip').length
      const summary = [
        `输入 ${shared.total_input_rows || jobs.length} 行，生成 ${jobs.length} 个款色任务`,
        `商品资料命中 ${merchandiseByGoods.size}/${jobs.length}`,
        `PDC详情读取 ${detailReads}`,
        `素材候选 ${assetFiles.length} 个`,
        sharedDetailSkips ? `同商品同款商品详情图共享跳过 ${sharedDetailSkips} 次重复上传` : '',
        allowLiveExecution(params) ? `待线上替换 ${liveContexts.length} 个` : '未执行取消审核、上传、保存或提交审核',
      ].filter(Boolean).join('；')
      outputRows.unshift(summaryRow(summary, outputRows.some(row => ['预检失败', '未找到商品', '详情读取失败', '找图失败', '下载失败'].includes(row.执行结果)) ? '部分预检失败' : '预检完成'))

      const nextShared = {
        ...shared,
        result_rows: outputRows,
        live_contexts: executableLiveContexts,
        live_index: 0,
        live_rows: [],
        merchandise_rows: merchandiseResult.rows.length,
        merchandise_total: merchandiseResult.total,
        pdc_detail_reads: detailReads,
        asset_files: assetFiles.length,
        current_exec_no: 1,
        current_buyer_id: executableLiveContexts[0]?.job?.goodsCode || '',
        current_store: executableLiveContexts[0]?.vendorProductId || '',
      }
      if (!allowLiveExecution(params)) return complete(outputRows, nextShared)
      if (!executableLiveContexts.length) return complete(outputRows, nextShared)
      return nextPhase('process_live_job', 0, nextShared)
    }

    if (phase === 'process_live_job') {
      const { context } = currentLiveContext(shared)
      if (!context) return advanceLiveJob([], shared)
      const targetUrl = pdcEditUrl(context.vendorProductId, context.vendorType)
      if (!isPdcOrigin() || !String(location.href || '').includes(encodeURIComponent(context.vendorProductId)) && !String(location.href || '').includes(context.vendorProductId)) {
        return navigateTo(targetUrl, 'process_live_job', VIPSHOP_PAGE_WAIT_MS, {
          ...shared,
          pdc_wait_attempts: 0,
          current_buyer_id: context.job.goodsCode,
          current_store: context.vendorProductId,
        })
      }
      const state = getPdcEditState(context.vendorProductId)
      const attempts = Math.max(0, Number(shared.pdc_wait_attempts || 0) || 0)
      if (!state.rootFound && attempts < 30) {
        return nextPhase('process_live_job', 1000, { ...shared, pdc_wait_attempts: attempts + 1 })
      }
      if (!state.rootFound) {
        return advanceLiveJob(buildLiveContextRows(context, 'PDC页面加载失败', '等待编辑页 Vue 状态超时'), shared)
      }
      const latestDetail = await queryProductDetail(context.vendorProductId, context.vendorType)
      const latestStatus = compact(latestDetail.status || state.status)
      if (!isEditableStatus(latestStatus) && !shared.current_unpublished) {
        await unpublishProduct(context.vendorProductId, context.vendorType)
        clickVisibleAlertConfirm(/取消提交审核|撤回|取消发布|取消商品/)
        return reloadPage('process_live_job', VIPSHOP_PAGE_WAIT_MS, {
          ...shared,
          current_unpublished: true,
          pdc_wait_attempts: 0,
          current_store: `已取消审核/撤回：${context.vendorProductId}`,
        })
      }
      if (!state.editableFound && attempts < 30) {
        return nextPhase('process_live_job', 1000, { ...shared, pdc_wait_attempts: attempts + 1 })
      }
      if (!state.editableFound) {
        return advanceLiveJob(buildLiveContextRows(context, 'PDC不可编辑', `状态=${statusLabel(latestStatus)}，未找到保存组件`), shared)
      }
      if (needsVipshopDetailAnchorDetection(context, params) && !shared.current_detail_ocr_attempted) {
        return nextPhase('detect_vipshop_detail_ocr_anchors', 0, {
          ...shared,
          current_detail_ocr_attempted: true,
          current_store: `OCR识别商详保留锚点：${context.vendorProductId}`,
        })
      }
      ensureUploadInput()
      const files = context.assets.map(asset => asset.path).filter(Boolean)
      return injectFiles([{
        selector: UPLOAD_INPUT_SELECTOR,
        files,
      }], 'after_files_injected', 800, {
        ...shared,
        current_injected_assets: context.assets,
        current_unpublished: false,
      })
    }

    if (phase === 'detect_vipshop_detail_ocr_anchors') {
      const { context } = currentLiveContext(shared)
      if (!context) return advanceLiveJob([], shared)
      if (!needsVipshopDetailAnchorDetection(context, params)) {
        return nextPhase('process_live_job', 0, {
          ...shared,
          current_detail_ocr_attempted: true,
          current_detail_ocr_anchors: null,
          current_detail_ocr_result: null,
          current_detail_existing_images: [],
        })
      }
      const detected = await detectVipshopDetailOcrAnchors(context, params)
      if (!detected.ok) {
        return advanceLiveJob(buildLiveContextRows(
          context,
          '商详OCR阻断',
          compact([
            detected.reason || 'OCR 未识别到可靠保留锚点',
            `已扫${detected.ocr?.scanned || 0}/${detected.images?.length || 0}张`,
            `状态=${detected.anchors?.ocrStatus || ''}`,
          ].filter(Boolean).join('；')),
        ), shared)
      }
      return nextPhase('process_live_job', 0, {
        ...shared,
        current_detail_ocr_attempted: true,
        current_detail_ocr_anchors: detected.anchors,
        current_detail_ocr_result: {
          ok: !!detected.ocr?.ok,
          engine: detected.ocr?.engine || 'tesseract.js',
          lang: detected.ocr?.lang || '',
          scanned: detected.ocr?.scanned || 0,
          results: (detected.ocr?.results || []).map(result => ({
            globalIndex: result.globalIndex,
            imageIndex: result.imageIndex,
            text: compact(result.text).slice(0, 160),
            confidence: Number(result.confidence || 0),
            error: compact(result.error),
          })),
        },
        current_detail_existing_images: detected.images,
        current_store: compact([
          `OCR锚点=${detected.anchors.stopAnchorKind}@${Number(detected.anchors.stopImageIndex) + 1}`,
          detected.anchors.balaOneImageIndex != null ? `balaOne@${Number(detected.anchors.balaOneImageIndex) + 1}` : '',
        ].filter(Boolean).join('；')),
      })
    }

    if (phase === 'after_files_injected') {
      const { context } = currentLiveContext(shared)
      if (!context) return advanceLiveJob([], shared)
      try {
        const injectedAssets = Array.isArray(shared.current_injected_assets) ? shared.current_injected_assets : context.assets
        const result = await uploadInjectedFilesAndApply(context, injectedAssets, {
          requireAnchors: needsVipshopDetailAnchorDetection(context, params),
          anchors: shared.current_detail_ocr_anchors || {},
          existingDetailImages: shared.current_detail_existing_images || [],
        })
        callSaveAndApprove(context)
        const rows = result.uploadRecords.map(record => buildOutputRow(context.job, {
          task: record.usage,
          scope: record.asset.scope,
          imageIndex: String(record.imageIndex),
          file: record.asset.path,
          dimension: imageSizeOf(record.asset),
          endpoint: PDC_UPLOAD_SQUARE_IMAGE_URL,
          status: '已上传待保存',
          merchandiseNo: context.merchandise?.merchandiseNo,
          vendorSpuId: context.vendorProductId,
          prodSpuId: context.merchandise?.prodSpuId,
          productStatus: statusLabel(context.product?.status),
          productName: context.merchandise?.name || context.product?.title,
          backendStyle: context.product?.sn || context.merchandise?.osn,
          mergedStyle: context.merged ? '是' : '否',
          colorName: context.color?.aliasesName || context.color?.colourName,
          colorCode: context.color?.colourGSN,
          colorMatch: context.color?.colourGSN ? '已匹配' : '',
          note: compact([
            record.asset.transformNote,
            record.usageKey === 'detail_slice' ? result.applyResult?.detailApplyResult?.note : '',
            record.imageUrl,
          ].filter(Boolean).join('；')),
        }))
        return nextPhase('verify_live_job', VIPSHOP_SAVE_WAIT_MS, {
          ...shared,
          current_live_uploads: result.uploadRecords,
          live_rows: [...(Array.isArray(shared.live_rows) ? shared.live_rows : []), ...rows],
          live_verify_attempts: 0,
          apply_result: result.applyResult,
        })
      } catch (error) {
        return advanceLiveJob(buildLiveContextRows(context, '上传/保存触发失败', error.message || String(error)), shared)
      }
    }

    if (phase === 'verify_live_job') {
      const { context } = currentLiveContext(shared)
      if (!context) return advanceLiveJob([], shared)
      const attempts = Math.max(0, Number(shared.live_verify_attempts || 0) || 0)
      if (!shared.precheck_continued && continueEditPreCheckIfVisible(context)) {
        return nextPhase('verify_live_job', VIPSHOP_SAVE_WAIT_MS, { ...shared, precheck_continued: true, live_verify_attempts: attempts + 1 })
      }
      clickVisibleAlertConfirm()
      const product = await queryProductDetail(context.vendorProductId, context.vendorType)
      const uploads = Array.isArray(shared.current_live_uploads) ? shared.current_live_uploads : []
      const missingUrls = uploads.map(record => record.imageUrl).filter(url => !verifyImageUrlInDetail(url, product, context))
      const status = compact(product.status)
      const submitted = ['12', '13'].includes(status)
      if (!missingUrls.length && !submitted && attempts >= 3 && !shared.publish_fallback_called && params.allow_publish_fallback !== false) {
        await publishProduct(context.vendorProductId, context.vendorType, params.operator_id || '')
        return nextPhase('verify_live_job', VIPSHOP_SAVE_WAIT_MS, {
          ...shared,
          publish_fallback_called: true,
          live_verify_attempts: attempts + 1,
        })
      }
      if ((missingUrls.length || !submitted) && attempts < 20) {
        return nextPhase('verify_live_job', 1500, { ...shared, live_verify_attempts: attempts + 1 })
      }
      const rows = buildLiveContextRows(
        context,
        !missingUrls.length && submitted ? '保存并提交审核成功' : '保存读回异常',
        compact([
          `读回状态=${statusLabel(status)}`,
          missingUrls.length ? `未在详情读回中找到 ${missingUrls.length} 个新图URL` : `已读回 ${uploads.length} 个新图URL`,
          shared.publish_fallback_called ? '已调用提交审核兜底接口' : '',
        ].filter(Boolean).join('；')),
      )
      return advanceLiveJob(rows, shared)
    }

    return { success: false, error: `未知执行相位：${phase}` }
  } catch (error) {
    return { success: false, error: error.message || String(error) }
  }
})()
