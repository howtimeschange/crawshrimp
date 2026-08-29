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
  const SHOE_LABEL_GENERIC_CANDIDATE_LIMIT_PER_COLOR = 8
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'])
  const PDF_EXTS = new Set(['pdf'])
  const ASSET_EXTS = new Set([...IMAGE_EXTS, ...PDF_EXTS])
  const HANG_TAG_PATTERNS = Object.freeze([/吊牌|吊卡|挂牌|商品标签|标签|合格证/])
  const WASH_LABEL_PATTERNS = Object.freeze([/水洗|洗唛|洗标|洗水/])
  const LABEL_IMAGE_PATTERNS = Object.freeze([...HANG_TAG_PATTERNS, ...WASH_LABEL_PATTERNS])
  const CARD_PAPER_PATTERNS = Object.freeze([/卡纸|手写/])
  const WASTE_LABEL_PATTERNS = Object.freeze([/无水洗|无洗唛|无洗标|无洗水|无吊牌|无吊卡|无挂牌|无合格证|废图|不要|作废|无效/])
  const TILE_IMAGE_PATTERNS = Object.freeze([/平铺|平拍|静物|白底|平面|铺拍/])
  const SHOE_LABEL_PATTERNS = Object.freeze([/鞋盒标签|鞋盒贴|鞋盒标|鞋盒图|盒标|内盒标|外盒标|电子吊牌|电商吊牌|电吊牌|商品标签|吊牌|吊卡|挂牌|合格证|标签|标贴|贴纸/])
  const SHOE_NEGATIVE_LABEL_PATTERNS = Object.freeze([/无标签|无鞋盒|无吊牌|缺标签|缺鞋盒|缺吊牌|无材质/])
  const SOURCE_LABELS = Object.freeze({
    model: '模拍路径',
    still: '平拍路径',
  })
  const ASSET_KIND_LABELS = Object.freeze({
    hang_tag: '吊牌',
    wash_label: '洗唛',
    tile: '平铺图',
    shoe_style_color: '款色图',
    shoe_label: '鞋盒标签图/电子吊牌图',
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
      raw,
    }
  }

  function normalizeCodes(rawValue) {
    const text = String(rawValue || '').replace(/[，、；;, \t]+/g, '\n')
    const result = []
    const seen = new Set()
    for (const line of text.split(/\r?\n/)) {
      const value = compact(line)
      if (!value || seen.has(value)) continue
      seen.add(value)
      result.push(value)
    }
    return result
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

  function isJunkAssetItem(item) {
    const filename = compact(item?.filename || item?.name || lastPathSegment(item?.fullpath || item?.path || ''))
    const lowered = filename.toLowerCase()
    if (lowered.startsWith('._') || ['.ds_store', 'desktop.ini', 'thumbs.db'].includes(lowered)) return true
    return pathSegments(item?.fullpath || item?.path || filename).some(segment => {
      const text = compact(segment)
      const lower = text.toLowerCase()
      return text === '__MACOSX' || text.startsWith('._') || ['.ds_store', 'desktop.ini', 'thumbs.db'].includes(lower)
    })
  }

  function isSupportedAssetItem(item) {
    return !isDirectoryItem(item) && !isJunkAssetItem(item) && ASSET_EXTS.has(getExt(item))
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

  function parentPathSegment(fullpath) {
    const segments = pathSegments(fullpath)
    return segments.length >= 2 ? segments[segments.length - 2] : ''
  }

  function isStatusNoteFolderName(folderName) {
    const text = compact(folderName)
    if (!text) return false
    if (/^\d{8,}(?:$|[\s_\-])/.test(text)) return true
    return /已补|已写|已选|回齐|回图|新回|上市|可选|导购|差\d*|缺\d*/i.test(text)
  }

  function hasAny(text, patterns) {
    const source = String(text || '')
    return patterns.some(pattern => pattern.test(source))
  }

  function hasFilenameOrExplicitParentMarker(item, patterns) {
    if (hasAny(item?.filename || item?.name || '', patterns)) return true
    const parent = parentPathSegment(item?.fullpath || item?.path || '')
    if (!parent || isStatusNoteFolderName(parent)) return false
    return hasAny(parent, patterns)
  }

  function isChatUploadImageFilename(filename) {
    const name = compact(filename)
    return /^lQLP[0-9A-Za-z_-]+\.(?:png|jpe?g|webp)$/i.test(name)
  }

  function hasLabelStatusParentMarker(item) {
    if (!isChatUploadImageFilename(item?.filename || item?.name || '')) return false
    const parent = parentPathSegment(item?.fullpath || item?.path || '')
    return isStatusNoteFolderName(parent) && hasAny(parent, LABEL_IMAGE_PATTERNS)
  }

  function hasWasteLabelMarker(item) {
    return hasFilenameOrExplicitParentMarker(item, WASTE_LABEL_PATTERNS)
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

  function isShoePathValue(value) {
    return pathSegments(value).some(segment => /鞋品/.test(segment))
  }

  function isShoeItem(item) {
    return isShoePathValue(item?.fullpath || item?.path || '')
  }

  function isShoeSourceConfig(sourceConfig) {
    return isShoePathValue(sourceConfig?.relativePath || sourceConfig?.cloudPath || '')
      || isShoePathValue(sourceConfig?.broadRelativePath || '')
  }

  function isShoeCodePlan(sourceConfigs, items) {
    if (Object.values(sourceConfigs || {}).some(isShoeSourceConfig)) return true
    return (Array.isArray(items) ? items : []).some(isShoeItem)
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
    return Math.max(1, Math.min(32, Math.floor(parsed)))
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

  function buildDownloadHeaders() {
    const headers = {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,application/pdf,*/*;q=0.8',
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

  function normalizeYqStem(filename) {
    return compact(getFileStem(filename))
      .toLowerCase()
      .replace(/[（）]/g, match => (match === '（' ? '(' : ')'))
      .replace(/\s+/g, '')
  }

  function yqKindFromFilename(filename) {
    const stem = normalizeYqStem(filename)
    if (!stem) return ''
    if (/(?:^|[^a-z0-9])yq(?:\(?1\)?|一)(?:$|[^a-z0-9])/.test(stem) || /^yq1$/i.test(stem)) return 'hang_tag'
    if (/(?:^|[^a-z0-9])yq(?:\(?2\)?|二)(?:$|[^a-z0-9])/.test(stem) || /^yq2$/i.test(stem)) return 'wash_label'
    return ''
  }

  function isCodeOnlyWashPdfItem(item, code = '') {
    if (getExt(item) !== 'pdf') return false
    const target = compact(getGroupCode(code))
    if (!target) return false
    const text = `${item?.filename || item?.name || ''} ${item?.fullpath || item?.path || ''}`
    if (hasAny(text, [...HANG_TAG_PATTERNS, /合格证|执行标准|商品标签/])) return false
    const stem = compact(getFileStem(item?.filename || item?.name || '')).replace(/\s+/g, '')
    if (!stem.startsWith(target)) return false
    const tail = stem.slice(target.length)
    return !tail || /^\(\d+\)$/.test(tail) || /^\d{8,}(?:_\d+)?$/.test(tail)
  }

  function inferLabelKind(item, code = '') {
    if (hasWasteLabelMarker(item)) return ''
    const yqKind = yqKindFromFilename(item?.filename || item?.name || '')
    if (yqKind) return yqKind
    const text = `${item?.filename || item?.name || ''} ${item?.fullpath || item?.path || ''}`
    if (hasAny(text, WASH_LABEL_PATTERNS)) return 'wash_label'
    if (hasAny(text, HANG_TAG_PATTERNS) || hasLabelStatusParentMarker(item)) return 'hang_tag'
    return ''
  }

  function labelPriority(item, kind, code = '') {
    if (yqKindFromFilename(item?.filename || item?.name || '') === kind) return 0
    if (hasFilenameOrExplicitParentMarker(item, kind === 'wash_label' ? WASH_LABEL_PATTERNS : HANG_TAG_PATTERNS)) return 20
    if (hasLabelStatusParentMarker(item)) return 30
    return 90
  }

  function selectLabelItems(items, kind, code = '') {
    const candidates = dedupeItemsByFullpath(items)
      .filter(isSupportedAssetItem)
      .filter(item => !hasWasteLabelMarker(item))
      .filter(item => inferLabelKind(item, code) === kind)
      .sort((left, right) => labelPriority(left, kind, code) - labelPriority(right, kind, code))
    const yqNamed = candidates.filter(item => yqKindFromFilename(item?.filename || item?.name || '') === kind)
    return yqNamed.length ? yqNamed : candidates
  }

  function stripModelFilenamePrefix(stem) {
    return compact(stem).replace(/^m(?:\(\d+\))?\./i, '')
  }

  function modelFilenameMatchesCode(filename, code) {
    const stem = compact(getFileStem(filename))
    const strippedStem = stripModelFilenamePrefix(stem)
    return matchesFilenameCode(stem, code) || matchesFilenameCode(strippedStem, code)
  }

  function isBacksideStyleColorFilename(filename, code) {
    const target = compact(getGroupCode(code))
    if (!target) return false
    const stem = stripModelFilenamePrefix(getFileStem(filename)).replace(/\s+/g, '')
    const matcher = new RegExp(`^${escapeRegExp(target)}[-_+][0-9A-Za-z]{3,6}[-_+](?:1|背面|反面|back|b)$`, 'i')
    return matcher.test(stem)
  }

  function isModelWhiteBackgroundFilename(filename, code = '') {
    const stem = compact(getFileStem(filename))
    if (!stem) return false
    const matched = /^(?:m\(1\)\.)?\d{12}-\d{5}(?:\s*\(\d+\))?$/i.test(stem)
    return matched && (!compact(code) || modelFilenameMatchesCode(filename, code))
  }

  function extractStyleColorKeyFromValue(value, code) {
    const target = compact(getGroupCode(code))
    if (!target) return ''
    const source = stripModelFilenamePrefix(String(value || '').replace(/\\/g, '/'))
    const matcher = new RegExp(`(?:^|[^0-9A-Za-z])${escapeRegExp(target)}\\s*[-_+]\\s*([0-9A-Za-z]{3,6})(?:$|[^0-9A-Za-z])`, 'i')
    const match = matcher.exec(source)
    if (!match) return ''
    return `${target}-${String(match[1] || '').toUpperCase()}`
  }

  function getShoeColorCodeFromInput(inputCode) {
    const value = compact(inputCode)
    if (!value.includes('-')) return ''
    const color = compact(value.split('-').slice(1).join('-'))
    return /^[0-9A-Za-z]{3,6}$/.test(color) ? color.toUpperCase() : ''
  }

  function getShoeColorCodeFromPathValue(value) {
    for (const segment of pathSegments(value).slice(0, -1).reverse()) {
      const text = compact(segment)
      if (/^\d{5}$/.test(text)) return text
    }
    return ''
  }

  function getShoeColorCodeFromItem(item, code = '') {
    const requestedColor = getShoeColorCodeFromInput(code)
    const styleColorKey = extractShoeStyleColorKeyFromFilename(item?.filename || item?.name || '', code)
    const actualColor = styleColorKey && styleColorKey.includes('-')
      ? styleColorKey.split('-').slice(1).join('-')
      : getShoeColorCodeFromPathValue(item?.fullpath || item?.path || '')
    if (requestedColor) {
      if (actualColor && actualColor !== requestedColor) return ''
      return requestedColor
    }
    return actualColor
  }

  function extractShoeStyleColorKeyFromFilename(filename, code) {
    const target = compact(getGroupCode(code))
    if (!target) return ''
    const stem = stripModelFilenamePrefix(getFileStem(filename)).replace(/\s+/g, '')
    const matcher = new RegExp(`^${escapeRegExp(target)}[-_+]([0-9A-Za-z]{3,6})(?:$|[+_\\-（(\\s].*)`, 'i')
    const match = matcher.exec(stem)
    if (!match) return ''
    const color = String(match[1] || '').toUpperCase()
    const requestedColor = getShoeColorCodeFromInput(code)
    if (requestedColor && color !== requestedColor) return ''
    return `${target}-${color}`
  }

  function isShoeStyleColorImage(item, code) {
    if (!isImageItem(item) || !isShoeItem(item)) return false
    if (hasWasteLabelMarker(item)) return false
    if (hasShoeNegativeLabelMarker(item)) return false
    if (isShoeLabelItem(item, code)) return false
    return !!extractShoeStyleColorKeyFromFilename(item?.filename || item?.name || '', code)
  }

  function shoeStyleColorPriority(item, code) {
    const filename = compact(item?.filename || item?.name || '')
    const stem = stripModelFilenamePrefix(getFileStem(filename)).replace(/\s+/g, '')
    const styleColorKey = extractShoeStyleColorKeyFromFilename(filename, code)
    const exactPattern = styleColorKey
      ? new RegExp(`^${escapeRegExp(styleColorKey)}$`, 'i')
      : null
    let score = 0
    if (exactPattern && exactPattern.test(stem)) score -= 20
    if (/\+Ai角度图/i.test(stem)) score += 10
    if (/\(\d+\)|（\d+）|拷贝|copy/i.test(stem)) score += 3
    if (getExt(item) === 'jpg' || getExt(item) === 'jpeg') score -= 1
    return score
  }

  function selectShoeStyleColorItems(items, code) {
    const groups = new Map()
    for (const item of dedupeItemsByFullpath(items).filter(candidate => isShoeStyleColorImage(candidate, code))) {
      const key = extractShoeStyleColorKeyFromFilename(item?.filename || item?.name || '', code)
      if (!key) continue
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    }
    return Array.from(groups.values()).map(groupItems => groupItems
      .slice()
      .sort((left, right) => (
        shoeStyleColorPriority(left, code) - shoeStyleColorPriority(right, code)
        || String(left?.filename || '').localeCompare(String(right?.filename || ''), 'zh-Hans-CN')
        || String(left?.fullpath || '').localeCompare(String(right?.fullpath || ''), 'zh-Hans-CN')
      ))[0])
  }

  function hasShoeNegativeLabelMarker(item) {
    const text = `${item?.filename || item?.name || ''} ${item?.fullpath || item?.path || ''}`
    return hasAny(text, SHOE_NEGATIVE_LABEL_PATTERNS)
  }

  function isShoeLabelItem(item, code = '') {
    if (!isSupportedAssetItem(item) || !isShoeItem(item)) return false
    if (hasWasteLabelMarker(item)) return false
    if (hasShoeNegativeLabelMarker(item)) return false
    const filename = item?.filename || item?.name || ''
    if (hasAny(filename, SHOE_LABEL_PATTERNS)) return true
    return hasLabelStatusParentMarker(item)
  }

  function isShoeYkFilename(filename) {
    return /^yk\s*[\d(（]/i.test(compact(getFileStem(filename)).replace(/\s+/g, ''))
  }

  function isGenericShoeLabelCandidateItem(item, code = '') {
    if (!isImageItem(item) || !isShoeItem(item)) return false
    if (hasWasteLabelMarker(item)) return false
    if (hasShoeNegativeLabelMarker(item)) return false
    const filename = item?.filename || item?.name || ''
    const stem = stripModelFilenamePrefix(getFileStem(filename)).replace(/\s+/g, '')
    if (!stem) return false
    if (isShoeLabelItem(item, code)) return false
    if (isShoeStyleColorImage(item, code)) return false
    if (isShoeYkFilename(filename)) return false
    if (/\+Ai角度图/i.test(stem)) return false
    if (/拷贝|copy|副本/i.test(stem)) return false
    if (!/^(?:GUDO|IMG|DSC|DSCF|DSCN|_MG|PXL)[-_]?\d+/i.test(stem)) return false
    return !!getShoeColorCodeFromItem(item, code)
  }

  function shoeGenericLabelCandidateNumber(item) {
    const stem = getFileStem(item?.filename || item?.name || '')
    const match = /(?:GUDO|IMG|DSC|DSCF|DSCN|_MG|PXL)[-_]?(\d+)/i.exec(stem)
    return match ? Number(match[1]) : 0
  }

  function shoeLabelPriority(item) {
    const filename = compact(item?.filename || item?.name || '')
    if (hasAny(filename, [/鞋盒标签|鞋盒标|鞋盒图|盒标|内盒标|外盒标/])) return 0
    if (hasAny(filename, [/电子吊牌|电商吊牌|电吊牌|商品标签|吊牌|吊卡|挂牌|合格证/])) return 10
    if (hasLabelStatusParentMarker(item)) return 20
    return 90
  }

  function selectShoeLabelItems(items, code = '') {
    const explicit = dedupeItemsByFullpath(items)
      .filter(item => isShoeLabelItem(item, code))
      .map(item => ({
        ...item,
        __shoe_color_code: getShoeColorCodeFromItem(item, code),
        __shoe_label_candidate_kind: 'explicit',
      }))
      .sort((left, right) => (
        shoeLabelPriority(left) - shoeLabelPriority(right)
        || String(left?.filename || '').localeCompare(String(right?.filename || ''), 'zh-Hans-CN')
        || String(left?.fullpath || '').localeCompare(String(right?.fullpath || ''), 'zh-Hans-CN')
      ))

    const genericByColor = new Map()
    for (const item of dedupeItemsByFullpath(items).filter(candidate => isGenericShoeLabelCandidateItem(candidate, code))) {
      const colorCode = getShoeColorCodeFromItem(item, code)
      if (!colorCode) continue
      if (!genericByColor.has(colorCode)) genericByColor.set(colorCode, [])
      genericByColor.get(colorCode).push(item)
    }
    const generic = []
    for (const [colorCode, colorItems] of genericByColor.entries()) {
      const capped = colorItems
        .slice()
        .sort((left, right) => (
          shoeGenericLabelCandidateNumber(left) - shoeGenericLabelCandidateNumber(right)
          || String(left?.filename || '').localeCompare(String(right?.filename || ''), 'zh-Hans-CN')
          || String(left?.fullpath || '').localeCompare(String(right?.fullpath || ''), 'zh-Hans-CN')
        ))
        .slice(-SHOE_LABEL_GENERIC_CANDIDATE_LIMIT_PER_COLOR)
        .map(item => ({
          ...item,
          __shoe_color_code: colorCode,
          __shoe_label_candidate_kind: 'generic_ocr',
        }))
      generic.push(...capped)
    }

    return [...explicit, ...generic].sort((left, right) => (
      shoeLabelPriority(left) - shoeLabelPriority(right)
      || String(left.__shoe_color_code || '').localeCompare(String(right.__shoe_color_code || ''), 'zh-Hans-CN')
      || String(left?.filename || '').localeCompare(String(right?.filename || ''), 'zh-Hans-CN')
      || String(left?.fullpath || '').localeCompare(String(right?.fullpath || ''), 'zh-Hans-CN')
    ))
  }

  function tileFolderKey(item, code) {
    const target = compact(getGroupCode(code))
    if (!target) return ''
    const segments = pathSegments(item?.fullpath || item?.path || '')
    for (let index = segments.length - 2; index >= 0; index -= 1) {
      const segment = segments[index]
      if (matchesFilenameCode(segment, target) || startsWithCodeToken(segment, target)) {
        return `${target}::folder::${segment.toLowerCase()}`
      }
    }
    return `${target}::folder`
  }

  function tileColorGroup(item, code) {
    const filename = item?.filename || item?.name || ''
    const filenameColor = extractStyleColorKeyFromValue(getFileStem(filename), code)
    if (filenameColor) return { key: filenameColor, colorKeyed: true }

    for (const segment of pathSegments(item?.fullpath || item?.path || '').slice(0, -1).reverse()) {
      const pathColor = extractStyleColorKeyFromValue(segment, code)
      if (pathColor) return { key: pathColor, colorKeyed: true }
    }

    return { key: tileFolderKey(item, code), colorKeyed: false }
  }

  function tileRepresentativePriority(item, sourceType, code) {
    const filename = compact(item?.filename || item?.name || '')
    const stem = stripModelFilenamePrefix(getFileStem(filename)).toLowerCase()
    let score = 0
    if (!modelFilenameMatchesCode(filename, code)) score += 30
    if (sourceType === 'model' && isModelWhiteBackgroundFilename(filename, code)) score -= 10
    if (hasAny(filename, TILE_IMAGE_PATTERNS)) score -= 5
    if (/透明|白底/i.test(filename)) score -= 3
    if (/(?:^|[^a-z0-9])(?:img_|nb9a|yk\d*|yak)(?:$|[^a-z0-9])/i.test(stem)) score += 10
    if (/拷贝|copy|\(\d+\)|-\d{1,2}$/i.test(stem)) score += 3
    return score
  }

  function selectOneTilePerColor(items, sourceType, code) {
    const candidates = dedupeItemsByFullpath(items).filter(item => isTileCandidate(item, sourceType, code))
    const groupedRecords = candidates.map(item => ({
      item,
      group: tileColorGroup(item, code),
    }))
    const colorKeyedRecords = groupedRecords.filter(record => record.group.colorKeyed)
    const pool = colorKeyedRecords.length ? colorKeyedRecords : groupedRecords
    const groups = new Map()
    for (const record of pool) {
      const key = record.group.key || `${getGroupCode(code)}::tile`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(record.item)
    }

    return Array.from(groups.values()).map(groupItems => groupItems
      .slice()
      .sort((left, right) => (
        tileRepresentativePriority(left, sourceType, code) - tileRepresentativePriority(right, sourceType, code)
        || String(left?.filename || '').localeCompare(String(right?.filename || ''), 'zh-Hans-CN')
        || String(left?.fullpath || '').localeCompare(String(right?.fullpath || ''), 'zh-Hans-CN')
      ))[0])
  }

  function isPackagingItem(item) {
    const text = `${item?.filename || item?.name || ''} ${item?.fullpath || item?.path || ''}`
    return /包装/.test(text)
  }

  function isTileCandidate(item, sourceType, code) {
    if (!isImageItem(item)) return false
    if (isPackagingItem(item)) return false
    if (hasWasteLabelMarker(item)) return false
    if (hasFilenameOrExplicitParentMarker(item, CARD_PAPER_PATTERNS)) return false
    if (inferLabelKind(item, code)) return false
    if (isBacksideStyleColorFilename(item?.filename || item?.name || '', code)) return false

    const text = `${item?.filename || item?.name || ''} ${item?.fullpath || item?.path || ''}`
    if (hasAny(text, TILE_IMAGE_PATTERNS)) return true
    if (sourceType === 'model') {
      return modelFilenameMatchesCode(item?.filename || item?.name || '', code)
    }
    return matchesFilenameCode(item?.filename || '', code) || pathContainsCode(item?.fullpath || item?.path || '', code)
  }

  function selectTileItems(modelItems, stillItems, code) {
    const modelTiles = selectOneTilePerColor(modelItems, 'model', code)
    if (modelTiles.length) {
      return { items: modelTiles, sourceType: 'model' }
    }
    return {
      items: selectOneTilePerColor(stillItems, 'still', code),
      sourceType: 'still',
    }
  }

  function filenameWithSuffix(filename, suffixText) {
    const ext = getExt(filename)
    const stem = toSafeFilename(getFileStem(filename) || filename, 'file')
    const suffix = ext ? `.${ext}` : ''
    if (!suffixText || stem.endsWith(suffixText)) return `${stem}${suffix}`
    return `${stem}_${suffixText}${suffix}`
  }

  function ensureFilenameStylePrefix(filename, styleCode) {
    const safe = toSafeFilename(filename, 'file')
    const stem = getFileStem(safe)
    if (startsWithCodeToken(stem, styleCode)) return safe
    return toSafeFilename(`${styleCode}_${safe}`, safe)
  }

  function buildPackageFilename(styleCode, kind, item, options = {}) {
    const ext = getExt(item)
    const suffix = ext ? `.${ext}` : ''
    const originalStem = toSafeFilename(getFileStem(item?.filename || item?.name || '') || kind, kind)
    const kindLabel = ASSET_KIND_LABELS[kind] || kind
    if (kind === 'tile') {
      const raw = filenameWithSuffix(`${originalStem}${suffix}`, options.modelMatched ? '有模拍' : '')
      return ensureFilenameStylePrefix(raw, styleCode)
    }
    return toSafeFilename(item?.filename || item?.name || `${kindLabel}${suffix}`, `${styleCode}_${kindLabel}${suffix || '.jpg'}`)
  }

  function rowForAsset(inputCode, kind, item, options = {}) {
    const groupCode = getGroupCode(inputCode)
    const sourceType = item?.__source_type || options.sourceType || ''
    const packageFilename = buildPackageFilename(groupCode, kind, item, options)
    const shoeColorCode = /^shoe_/.test(kind)
      ? (item?.__shoe_color_code || getShoeColorCodeFromItem(item, inputCode))
      : ''
    const shoeCandidateKind = item?.__shoe_label_candidate_kind || ''
    return {
      '输入款号': groupCode,
      '输入编码': inputCode,
      '素材类型': ASSET_KIND_LABELS[kind] || kind,
      '素材来源': SOURCE_LABELS[sourceType] || sourceType || '',
      '文件名': packageFilename,
      '云盘路径': String(item?.fullpath || item?.path || ''),
      '匹配策略': options.strategy || '',
      '模拍路径命中': options.modelMatched ? '是' : '否',
      '下载结果': '',
      '本地文件': '',
      '备注': options.note || '',
      '__shenhui_group_code': groupCode,
      '__shenhui_asset_role': kind,
      '__shenhui_source_type': sourceType,
      '__package_filename': packageFilename,
      '__shoe_color_code': shoeColorCode,
      '__shoe_label_candidate_kind': shoeCandidateKind,
    }
  }

  function rowForNotice(inputCode, kind, result, note = '') {
    return {
      '输入款号': getGroupCode(inputCode),
      '输入编码': inputCode,
      '素材类型': ASSET_KIND_LABELS[kind] || kind,
      '素材来源': '',
      '文件名': '',
      '云盘路径': '',
      '匹配策略': '',
      '模拍路径命中': '',
      '下载结果': result,
      '本地文件': '',
      '备注': note,
      '__shenhui_group_code': getGroupCode(inputCode),
      '__shenhui_asset_role': 'notice',
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
      const total = Number(payload?.total || start + items.length)
      all.push(...items)
      if (!items.length) break
      start += items.length
      if (start >= total) break
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
    if (method === 'GET') return fetchJson(`${endpoint}?${paramsForBody.toString()}`)
    return fetchJson(endpoint, {
      method,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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

  async function collectDescendantAssets(mountId, folderItem, maxDepth, remainingBudget = { value: 2000 }) {
    const folderPath = String(folderItem?.fullpath || '').trim()
    if (!folderPath || maxDepth <= 0 || remainingBudget.value <= 0) return { assets: [], errors: [] }

    const listed = await listFolderItems(mountId, folderPath)
    if (!listed.ok) return { assets: [], errors: [`${folderPath}: ${listed.error}`] }

    const assets = []
    const errors = []
    for (const item of listed.items) {
      if (remainingBudget.value <= 0) break
      if (isDirectoryItem(item)) {
        const child = await collectDescendantAssets(mountId, item, maxDepth - 1, remainingBudget)
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
    const sourceType = options.sourceType
    const primaryScoped = searchItems.filter(item => isWithinRelativePath(item?.fullpath, sourceConfig.relativePath))
    const fallbackScoped = searchItems.filter(item => isWithinBroadSourceScope(item?.fullpath, sourceConfig, sourceType))
    const primaryMatchedFolders = primaryScoped.filter(item => matchesFolderItemForCode(item, inputCode))
    const fallbackMatchedFolders = fallbackScoped.filter(item => matchesFolderItemForCode(item, inputCode))
    const matchedFolders = primaryMatchedFolders.length ? primaryMatchedFolders : fallbackMatchedFolders
    const directAssetFilter = item => isSupportedAssetItem(item) && matchesAssetItemForCode(item, inputCode)
    const primaryDirectAssets = primaryScoped.filter(directAssetFilter)
    const fallbackDirectAssets = fallbackScoped.filter(directAssetFilter)

    const expandedAssets = []
    const folderErrors = []
    const depth = normalizeFolderScanDepth(options.folderScanDepth)
    if (depth > 0) {
      for (const folder of matchedFolders) {
        const result = await collectDescendantAssets(sourceConfig.mountId, folder, depth, { value: 2000 })
        expandedAssets.push(...result.assets)
        folderErrors.push(...result.errors)
      }
    }

    const directAssets = primaryDirectAssets.length ? primaryDirectAssets : fallbackDirectAssets
    const usedDirectAssetFallback = !expandedAssets.length && directAssets.length > 0
    const candidateItems = usedDirectAssetFallback ? directAssets : expandedAssets
    return {
      searchCount: searchItems.length,
      folderCount: matchedFolders.length,
      usedFallbackScope: !primaryMatchedFolders.length && fallbackMatchedFolders.length > 0,
      directAssetCount: directAssets.length,
      usedDirectAssetFallback,
      folderErrors,
      items: dedupeItemsByFullpath(candidateItems).map(item => ({ ...item, __source_type: sourceType })),
    }
  }

  async function fetchFileInfo(mountId, fullpath) {
    const query = new URLSearchParams({
      fullpath: String(fullpath || ''),
      mount_id: String(mountId || ''),
    })
    return fetchJson(`/fengcloud/2/file/info?${query.toString()}`)
  }

  function resultStats(result, sourceLabel) {
    if (!result) return `${sourceLabel}未配置`
    const parts = [`${sourceLabel}搜索 ${result.searchCount} 条`, `款号文件夹 ${result.folderCount} 个`]
    if (result.directAssetCount) parts.push(`直接素材 ${result.directAssetCount} 个`)
    if (result.folderErrors?.length) parts.push(`列目录失败 ${result.folderErrors.length} 个`)
    return parts.join('；')
  }

  async function addDownloadRows(inputCode, sourceConfigs, rows, downloadItems, kind, items, options = {}) {
    if (!items.length) {
      rows.push(rowForNotice(inputCode, kind, '未匹配到素材', options.missingNote || ''))
      return
    }

    for (const item of items) {
      const sourceType = item.__source_type || options.sourceType
      const sourceConfig = sourceConfigs[sourceType]
      const row = rowForAsset(inputCode, kind, item, options)
      try {
        const info = await fetchFileInfo(sourceConfig.mountId, item?.fullpath || item?.path || '')
        const downloadUrl = String(info?.uri || (Array.isArray(info?.uris) ? info.uris[0] : '') || '').trim()
        if (!downloadUrl) {
          rows.push({ ...row, '下载结果': '获取下载链接失败', '备注': 'file/info 未返回 uri' })
          continue
        }
        const runtimeFilename = toSafeFilename(
          `${row['输入款号']}__${kind}__${sourceType || 'source'}__${getFileStem(item?.filename || item?.name || '') || 'file'}.${getExt(item) || 'bin'}`,
          `${row['输入款号']}__${kind}.${getExt(item) || 'bin'}`,
        )
        rows.push({ ...row, '__runtime_filename': runtimeFilename })
        downloadItems.push({
          url: downloadUrl,
          filename: runtimeFilename,
          label: `${row['素材类型']} / ${inputCode} / ${item?.filename || runtimeFilename}`,
          headers: buildDownloadHeaders(),
          timeout_seconds: DOWNLOAD_TIMEOUT_SECONDS,
          no_proxy: true,
        })
      } catch (error) {
        rows.push({ ...row, '下载结果': '获取下载链接失败', '备注': String(error?.message || error) })
      }
    }
  }

  async function buildCodePlan(inputCode, sourceConfigs, options = {}) {
    const rows = []
    const downloadItems = []
    const stillResult = sourceConfigs.still
      ? await collectCandidateAssets(inputCode, sourceConfigs.still, { ...options, sourceType: 'still' })
      : null
    const modelResult = sourceConfigs.model
      ? await collectCandidateAssets(inputCode, sourceConfigs.model, { ...options, sourceType: 'model' })
      : null

    const stillItems = stillResult?.items || []
    const modelItems = modelResult?.items || []
    const allLabelItems = [...stillItems, ...modelItems]
    if (isShoeCodePlan(sourceConfigs, allLabelItems)) {
      const shoeItems = allLabelItems.filter(item => isShoeItem(item) || isShoeSourceConfig(sourceConfigs?.[item?.__source_type || '']))
      const styleColorItems = selectShoeStyleColorItems(shoeItems, inputCode)
      const shoeLabelItems = selectShoeLabelItems(shoeItems, inputCode)
      const statsNote = [
        resultStats(stillResult, '平拍路径'),
        resultStats(modelResult, '模拍路径'),
      ].join('；')

      await addDownloadRows(inputCode, sourceConfigs, rows, downloadItems, 'shoe_style_color', styleColorItems, {
        strategy: '鞋品仅保留每个款色的款色命名图',
        missingNote: statsNote,
      })
      await addDownloadRows(inputCode, sourceConfigs, rows, downloadItems, 'shoe_label', shoeLabelItems, {
        strategy: shoeLabelItems.some(item => item.__shoe_label_candidate_kind === 'generic_ocr')
          ? '鞋品下载少量无语义候选，后端 OCR 识别鞋盒标签'
          : '鞋品仅保留显式鞋盒标签/电子吊牌图',
        missingNote: statsNote,
      })
      for (const error of [...(stillResult?.folderErrors || []), ...(modelResult?.folderErrors || [])].slice(0, 6)) {
        rows.push(rowForNotice(inputCode, 'shoe_style_color', '已跳过', error))
      }
      return { rows, downloadItems }
    }

    const modelMatched = !!(modelResult && (modelResult.folderCount > 0 || modelItems.length > 0))
    const hangTags = selectLabelItems(allLabelItems, 'hang_tag', inputCode)
    const washLabels = selectLabelItems(allLabelItems, 'wash_label', inputCode)
    const tileSelection = selectTileItems(modelItems, stillItems, inputCode)

    const statsNote = [
      resultStats(stillResult, '平拍路径'),
      resultStats(modelResult, '模拍路径'),
    ].join('；')

    await addDownloadRows(inputCode, sourceConfigs, rows, downloadItems, 'hang_tag', hangTags, {
      strategy: hangTags.some(item => yqKindFromFilename(item?.filename || item?.name || '') === 'hang_tag')
        ? '优先命中 yq1'
        : '按吊牌/合格证文件名查找',
      modelMatched,
      missingNote: statsNote,
    })
    await addDownloadRows(inputCode, sourceConfigs, rows, downloadItems, 'wash_label', washLabels, {
      strategy: washLabels.some(item => yqKindFromFilename(item?.filename || item?.name || '') === 'wash_label')
        ? '优先命中 yq2'
        : washLabels.some(item => isCodeOnlyWashPdfItem(item, inputCode))
          ? '按纯款号 PDF 兜底识别洗唛'
          : '按洗唛/水洗文件名查找',
      modelMatched,
      missingNote: statsNote,
    })
    await addDownloadRows(inputCode, sourceConfigs, rows, downloadItems, 'tile', tileSelection.items, {
      strategy: tileSelection.sourceType === 'model' ? '优先从模拍路径查找平铺图' : '模拍路径未命中，回退平拍路径',
      sourceType: tileSelection.sourceType,
      modelMatched,
      missingNote: statsNote,
    })

    for (const error of [...(stillResult?.folderErrors || []), ...(modelResult?.folderErrors || [])].slice(0, 6)) {
      rows.push(rowForNotice(inputCode, 'tile', '已跳过', error))
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

  function downloadUrls(items, nextPhaseName, options = {}, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'download_urls',
        items,
        shared_key: options.shared_key || 'last_code_download_result',
        strict: false,
        concurrency: normalizeDownloadConcurrency(options.concurrency),
        retry_attempts: DOWNLOAD_RETRY_ATTEMPTS,
        retry_delay_ms: DOWNLOAD_RETRY_DELAY_MS,
        timeout_seconds: DOWNLOAD_TIMEOUT_SECONDS,
        progress_total: Number(options.progress_total || 0) || undefined,
        progress_completed_offset: Number(options.progress_completed_offset || 0) || 0,
        progress_success_offset: Number(options.progress_success_offset || 0) || 0,
        progress_failed_offset: Number(options.progress_failed_offset || 0) || 0,
        next_phase: nextPhaseName,
        sleep_ms: 0,
        shared: newShared,
      },
    }
  }

  function complete(data = [], newShared = shared) {
    return { success: true, data, meta: { action: 'complete', has_more: false, shared: newShared } }
  }

  function advanceAfterCode(codes, codeIndex, currentCode, nextShared, allRows) {
    const nextIndex = codeIndex + 1
    const nextCode = String(codes[nextIndex] || '')
    if (nextCode) {
      return nextPhase('plan_code', 0, {
        ...nextShared,
        code_index: nextIndex,
        result_rows: allRows,
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
      classifyCode,
      getGroupCode,
      getExt,
      isSupportedAssetItem,
      isJunkAssetItem,
      startsWithCodeToken,
      matchesFilenameCode,
      pathContainsCode,
      matchesAssetItemForCode,
      matchesFolderItemForCode,
      deriveBroadSourcePrefix,
      isWithinBroadSourceScope,
      normalizeFolderScanDepth,
      normalizeDownloadConcurrency,
      dedupeItemsByFullpath,
      buildFolderHashRoute,
      buildSearchHashRoute,
      yqKindFromFilename,
      isCodeOnlyWashPdfItem,
      hasWasteLabelMarker,
      inferLabelKind,
      selectLabelItems,
      isModelWhiteBackgroundFilename,
      modelFilenameMatchesCode,
      isShoePathValue,
      isShoeCodePlan,
      getShoeColorCodeFromInput,
      getShoeColorCodeFromItem,
      extractShoeStyleColorKeyFromFilename,
      isShoeStyleColorImage,
      selectShoeStyleColorItems,
      isShoeLabelItem,
      isGenericShoeLabelCandidateItem,
      selectShoeLabelItems,
      isBacksideStyleColorFilename,
      extractStyleColorKeyFromValue,
      tileColorGroup,
      selectOneTilePerColor,
      isTileCandidate,
      selectTileItems,
      buildPackageFilename,
      collectCandidateAssets,
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
      const stillPath = parseCloudPath(params.still_cloud_path)
      const modelPath = String(params.model_cloud_path || '').trim() ? parseCloudPath(params.model_cloud_path) : null
      const codes = normalizeCodes(params.item_codes)
      if (!codes.length) throw new Error('请至少输入一个款号/款色编码')

      const resolvedMounts = {}
      async function mountForPath(pathConfig) {
        const key = compact(pathConfig?.mountName)
        if (!key) throw new Error('云盘路径缺少挂载点名称')
        if (!resolvedMounts[key]) resolvedMounts[key] = await resolveMountId(pathConfig.mountName)
        return resolvedMounts[key]
      }

      const stillMount = await mountForPath(stillPath)
      const sourceConfigs = {
        still: {
          mountId: stillMount.mountId,
          mountName: stillMount.mountName,
          cloudPath: stillPath.raw,
          relativePath: stillPath.relativePath,
          broadRelativePath: deriveBroadSourcePrefix(stillPath.relativePath, 'still'),
        },
      }
      if (modelPath) {
        const modelMount = await mountForPath(modelPath)
        sourceConfigs.model = {
          mountId: modelMount.mountId,
          mountName: modelMount.mountName,
          cloudPath: modelPath.raw,
          relativePath: modelPath.relativePath,
          broadRelativePath: deriveBroadSourcePrefix(modelPath.relativePath, 'model'),
        }
      }

      return nextPhase('ensure_folder', 0, {
        source_configs: sourceConfigs,
        folder_hash: buildFolderHashRoute(stillMount.mountId, stillPath.relativePath),
        folder_scan_depth: normalizeFolderScanDepth(params.folder_scan_depth),
        download_concurrency: normalizeDownloadConcurrency(params.download_concurrency),
        target_codes: codes,
        code_index: 0,
        result_rows: [],
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
        current_store: '深绘吊牌/洗唛/平铺图下载',
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
      if (!currentCode) return complete(Array.isArray(shared.result_rows) ? shared.result_rows : [], shared)
      return nextPhase('ensure_search', 0, { ...shared, current_code: currentCode })
    }

    if (phase === 'ensure_search') {
      const currentCode = String(shared.current_code || '')
      const sourceConfig = shared.source_configs?.still || shared.source_configs?.model || {}
      const targetHash = buildSearchHashRoute(sourceConfig.mountId, currentCode)
      if (targetHash && location.hash !== targetHash) {
        location.hash = targetHash
        return nextPhase('collect_code', 1500, { ...shared, search_hash: targetHash })
      }
      return nextPhase('collect_code', 0, { ...shared, search_hash: targetHash })
    }

    if (phase === 'collect_code') {
      const codes = Array.isArray(shared.target_codes) ? shared.target_codes : []
      const codeIndex = Number(shared.code_index || 0)
      const currentCode = String(shared.current_code || codes[codeIndex] || '')
      const plan = await buildCodePlan(currentCode, shared.source_configs || {}, {
        folderScanDepth: shared.folder_scan_depth,
      })
      const previousRows = Array.isArray(shared.result_rows) ? shared.result_rows : []
      const nextDownloadTotal = Number(shared.download_total_files || 0) + plan.downloadItems.length
      const baseShared = {
        ...shared,
        current_exec_no: codeIndex + 1,
        current_buyer_id: currentCode,
        current_store: `深绘吊牌/洗唛/平铺图下载 / ${getGroupCode(currentCode)}`,
        search_total_codes: codes.length,
        search_completed_codes: codeIndex + 1,
        download_total_files: nextDownloadTotal,
      }

      if (!plan.downloadItems.length) {
        const allRows = [...previousRows, ...plan.rows]
        return advanceAfterCode(codes, codeIndex, currentCode, {
          ...baseShared,
          result_rows: allRows,
          pending_code_rows: [],
        }, allRows)
      }

      return downloadUrls(
        plan.downloadItems,
        'finalize_code_download',
        {
          concurrency: shared.download_concurrency,
          progress_total: nextDownloadTotal,
          progress_completed_offset: Number(shared.download_completed_files || 0),
          progress_success_offset: Number(shared.download_success_files || 0),
          progress_failed_offset: Number(shared.download_failed_files || 0),
        },
        {
          ...baseShared,
          result_rows: previousRows,
          pending_code_rows: plan.rows,
          current_code: currentCode,
          download_concurrency: normalizeDownloadConcurrency(shared.download_concurrency),
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
      return advanceAfterCode(codes, codeIndex, currentCode, {
        ...shared,
        result_rows: allRows,
        pending_code_rows: [],
        download_completed_files: Number(shared.download_completed_files || 0) + summary.completed,
        download_success_files: Number(shared.download_success_files || 0) + summary.success,
        download_failed_files: Number(shared.download_failed_files || 0) + summary.failed,
      }, allRows)
    }

    if (phase === 'finalize_all') {
      return complete(Array.isArray(shared.result_rows) ? shared.result_rows : [], {
        ...shared,
        pending_code_rows: [],
      })
    }

    return { success: false, error: `未知 phase: ${phase}` }
  } catch (error) {
    return { success: false, error: String(error?.message || error) }
  }
})()
