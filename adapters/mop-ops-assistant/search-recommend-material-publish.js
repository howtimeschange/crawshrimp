;(async () => {
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__

  const UPLOAD_INPUT_ID = 'crawshrimp-mop-search-recommend-material-input'
  const UPLOAD_INPUT_SELECTOR = `#${UPLOAD_INPUT_ID}`
  const REMOTE_IMAGE_RE = /^(?:https?:)?\/\//i
  const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp']
  const SOURCE = 'qn_material_center'
  const DEFAULT_SCENE = 'material_center'
  const DEFAULT_PUBLISH_SCENE = 'qn_material_manager'
  const DEFAULT_BIZ_CODE = 's_upload_feeds'
  const DEFAULT_CROP_RATIO = '3:4'
  const ALLOWED_CROP_RATIOS = ['3:4', '1:1']
  const CROP_RATIO_TOLERANCE = 0.01
  const MIN_CROP_SIDE = 720
  const MIN_IMAGE_COUNT = 3
  const MAX_IMAGE_COUNT = 9
  const TITLE_MAX = 20
  const DESCRIPTION_MAX = 1000
  const PRODUCT_ID_ALIASES = ['商品ID', '商品id', 'itemId', 'item_id', '商品链接']
  const MERCHANT_CODE_ALIASES = ['商家编码', '商家编号', '商家货号', '商家SKU编码', '商家SKU', '货号', '编码', 'outerId', 'outer_id', 'skuCode', 'sku_code']
  const CREATOR_ALIASES = ['达人', '达人名称', '达人文件夹', '图片包', '图片包名称', 'KOL', 'kol', 'creator']
  const MATERIAL_IMAGE_ALIASES = ['素材图片', '搜推图片', '图片', '图片路径', '图片URL', 'image_urls', 'images']
  const KOC_MERCHANT_CODE_RE = /\d{6}[A-Z]\d{4}[A-Z]/gi

  function cleanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim()
  }

  function compact(value) {
    return cleanText(value).replace(/\s+/g, '')
  }

  function nowText() {
    try {
      return new Date().toLocaleString('zh-CN', { hour12: false })
    } catch (error) {
      return new Date().toISOString()
    }
  }

  function normalizeHeader(value) {
    return compact(value).replace(/[()（）\[\]【】:_：\-.]/g, '').toLowerCase()
  }

  function getRowValue(row, candidates) {
    if (!row || typeof row !== 'object') return ''
    const normalized = new Map()
    Object.keys(row).forEach(key => normalized.set(normalizeHeader(key), key))
    for (const candidate of candidates) {
      const direct = row[candidate]
      if (direct !== undefined && direct !== null && cleanText(direct) !== '') return direct
      const matchedKey = normalized.get(normalizeHeader(candidate))
      if (matchedKey && row[matchedKey] !== undefined && cleanText(row[matchedKey]) !== '') return row[matchedKey]
    }
    return ''
  }

  function splitMultiValues(value) {
    if (Array.isArray(value)) return value.map(cleanText).filter(Boolean)
    const normalized = String(value ?? '')
      .replace(/(\s+)(?=(?:https?:\/\/|\/|[A-Za-z]:[\\/]))/g, '\n')
    return normalized
      .split(/[\n\r;；|]+/g)
      .map(cleanText)
      .filter(Boolean)
  }

  function parseInteger(value, fallback = 0) {
    const n = parseInt(String(value ?? '').trim(), 10)
    return Number.isFinite(n) ? n : fallback
  }

  function normalizeProductId(value) {
    const text = compact(value)
    const match = text.match(/\d{8,}/)
    return match ? match[0] : ''
  }

  function normalizeMerchantCode(value) {
    return compact(value)
  }

  function normalizeCreatorName(value) {
    return cleanText(value)
  }

  function normalizeCreatorKey(value) {
    return compact(value).toLowerCase()
  }

  function isRemoteImage(value) {
    return REMOTE_IMAGE_RE.test(cleanText(value))
  }

  function normalizeRemoteImageUrl(value) {
    const text = cleanText(value)
    if (!REMOTE_IMAGE_RE.test(text)) return ''
    return text.startsWith('//') ? `https:${text}` : text
  }

  function findFirstRemoteUrl(value, depth = 0) {
    if (value === null || value === undefined || depth > 5) return ''
    if (typeof value === 'string') {
      return normalizeRemoteImageUrl(value)
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const matched = findFirstRemoteUrl(item, depth + 1)
        if (matched) return matched
      }
      return ''
    }
    if (typeof value !== 'object') return ''
    const preferredKeys = ['fullUrl', 'url', 'imageUrl', 'ossUrl', 'cdnUrl', 'path']
    for (const key of preferredKeys) {
      const matched = findFirstRemoteUrl(value[key], depth + 1)
      if (matched) return matched
    }
    for (const item of Object.values(value)) {
      const matched = findFirstRemoteUrl(item, depth + 1)
      if (matched) return matched
    }
    return ''
  }

  function normalizeCropRatioParts(width, height) {
    const w = Number(width)
    const h = Number(height)
    if (!Number.isFinite(w) || !Number.isFinite(h)) return ''
    const normalized = `${Math.trunc(w)}:${Math.trunc(h)}`
    return ALLOWED_CROP_RATIOS.includes(normalized) ? normalized : ''
  }

  function parseCropRatio(value) {
    if (value && typeof value === 'object') {
      const clockCandidates = []
      if (typeof value.getHours === 'function' && typeof value.getMinutes === 'function') {
        clockCandidates.push([value.getHours(), value.getMinutes()])
      }
      if (typeof value.getUTCHours === 'function' && typeof value.getUTCMinutes === 'function') {
        clockCandidates.push([value.getUTCHours(), value.getUTCMinutes()])
      }
      for (const [hours, minutes] of clockCandidates) {
        const clockRatio = normalizeCropRatioParts(hours, minutes)
        if (clockRatio) return clockRatio
      }
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      const totalMinutes = Math.round(value * 24 * 60)
      const serialRatio = normalizeCropRatioParts(Math.floor(totalMinutes / 60), totalMinutes % 60)
      if (serialRatio) return serialRatio
    }

    const text = compact(value)
    if (ALLOWED_CROP_RATIOS.includes(text)) return text
    const numericText = Number(text)
    if (Number.isFinite(numericText) && numericText > 0 && numericText < 1) {
      const totalMinutes = Math.round(numericText * 24 * 60)
      const serialRatio = normalizeCropRatioParts(Math.floor(totalMinutes / 60), totalMinutes % 60)
      if (serialRatio) return serialRatio
    }
    const timeLike = text.match(/^0*(\d+):0*(\d+)(?::0+)?$/)
    if (timeLike) {
      const ratio = normalizeCropRatioParts(timeLike[1], timeLike[2])
      if (ratio) return ratio
    }
    return DEFAULT_CROP_RATIO
  }

  function cropRatioNumber(value) {
    const ratio = parseCropRatio(value)
    const [width, height] = ratio.split(':').map(part => parseInteger(part, 0))
    return width > 0 && height > 0 ? width / height : 1
  }

  function isAliCdnCropSupported(url) {
    const text = normalizeRemoteImageUrl(url)
    return text.startsWith('https://img.alicdn.com/imgextra/') && text.includes('_!!')
  }

  function buildAliCdnCropUrl(url, left, top, width, height) {
    const text = normalizeRemoteImageUrl(url)
    if (!isAliCdnCropSupported(text)) return ''
    const existing = text.match(/~crop,(\d+),(\d+),\d+,\d+~/) || []
    const existingLeft = parseInteger(existing[1], 0)
    const existingTop = parseInteger(existing[2], 0)
    const crop = `~crop,${Math.floor(left) + existingLeft},${Math.floor(top) + existingTop},${Math.round(width)},${Math.round(height)}~`
    const next = existing.length
      ? text.replace(/~crop(,\d+){4}~/, crop)
      : text.replace(/(_!!)/, `${crop}$1`)
    return next.replace(/~+(crop,\d+,\d+,\d+,\d+)~+/g, '~$1~')
  }

  function buildCenterCropBox(width, height, ratio = DEFAULT_CROP_RATIO) {
    const sourceWidth = Number(width || 0)
    const sourceHeight = Number(height || 0)
    if (!(sourceWidth > 0) || !(sourceHeight > 0)) return null
    const target = cropRatioNumber(ratio)
    const current = sourceWidth / sourceHeight
    if (Math.abs(current - target) < CROP_RATIO_TOLERANCE) {
      return {
        left: 0,
        top: 0,
        width: Math.round(sourceWidth),
        height: Math.round(sourceHeight),
        ratio: parseCropRatio(ratio),
        needsCrop: false,
      }
    }
    let cropWidth = sourceWidth
    let cropHeight = sourceHeight
    let left = 0
    let top = 0
    if (current > target) {
      cropWidth = sourceHeight * target
      left = (sourceWidth - cropWidth) / 2
    } else {
      cropHeight = sourceWidth / target
      top = (sourceHeight - cropHeight) / 2
    }
    return {
      left: Math.max(0, left),
      top: Math.max(0, top),
      width: Math.round(cropWidth),
      height: Math.round(cropHeight),
      ratio: parseCropRatio(ratio),
      needsCrop: true,
    }
  }

  function loadImageSize(url) {
    return new Promise((resolve, reject) => {
      if (typeof Image !== 'function') {
        reject(new Error('当前环境无法读取图片尺寸'))
        return
      }
      const image = new Image()
      image.onload = () => {
        resolve({
          width: Number(image.naturalWidth || image.width || 0),
          height: Number(image.naturalHeight || image.height || 0),
        })
      }
      image.onerror = () => reject(new Error(`读取图片尺寸失败：${url}`))
      image.src = url
    })
  }

  function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.96) {
    return new Promise((resolve, reject) => {
      if (!canvas?.toBlob) {
        reject(new Error('当前浏览器不支持图片裁剪导出'))
        return
      }
      canvas.toBlob(blob => {
        if (blob) resolve(blob)
        else reject(new Error('图片裁剪导出失败'))
      }, type, quality)
    })
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(reader.error || new Error('读取裁剪图片失败'))
      reader.readAsDataURL(blob)
    })
  }

  async function cropFileToDataUrl(file, ratio = DEFAULT_CROP_RATIO) {
    if (typeof Image !== 'function' || typeof document === 'undefined') {
      throw new Error('当前页面不支持本地图片自动裁剪')
    }
    const sourceDataUrl = await fileToDataUrl(file)
    const image = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`读取图片尺寸失败：${file?.name || ''}`))
      img.src = sourceDataUrl
    })
    const width = Number(image.naturalWidth || image.width || 0)
    const height = Number(image.naturalHeight || image.height || 0)
    const box = buildCenterCropBox(width, height, ratio)
    if (!box) throw new Error(`无法识别图片尺寸：${file?.name || ''}`)
    if (Math.min(box.width, box.height) < MIN_CROP_SIDE) {
      throw new Error(`图片裁剪后宽高不得低于 ${MIN_CROP_SIDE}px：${file?.name || ''}`)
    }
    if (!box.needsCrop) {
      return { dataUrl: sourceDataUrl, width: box.width, height: box.height, cropRatio: box.ratio, cropStatus: 'matched' }
    }
    const canvas = document.createElement('canvas')
    canvas.width = box.width
    canvas.height = box.height
    const ctx = canvas.getContext?.('2d')
    if (!ctx) throw new Error('当前页面不支持 Canvas 裁剪')
    ctx.drawImage(image, box.left, box.top, box.width, box.height, 0, 0, box.width, box.height)
    const blob = await canvasToBlob(canvas, file.type && file.type !== 'image/webp' ? file.type : 'image/jpeg', 0.96)
    return { dataUrl: await blobToDataUrl(blob), width: box.width, height: box.height, cropRatio: box.ratio, cropStatus: 'center-cropped', cropBox: box }
  }

  function extensionOf(path) {
    const match = cleanText(path).split(/[?#]/)[0].match(/\.([a-zA-Z0-9]+)$/)
    return match ? match[1].toLowerCase() : ''
  }

  function isImagePath(path) {
    const ext = extensionOf(path)
    return IMAGE_EXTS.includes(ext)
  }

  function pathBasename(path) {
    return cleanText(path).replace(/\\/g, '/').split('/').filter(Boolean).pop() || cleanText(path)
  }

  function pathStem(path) {
    return pathBasename(path).replace(/\.[a-zA-Z0-9]+$/i, '')
  }

  function dirnameParts(path) {
    return cleanText(path).replace(/\\/g, '/').split('/').filter(Boolean)
  }

  function findProductIdFromPath(path) {
    const parts = dirnameParts(path)
    const base = parts[parts.length - 1] || ''
    const parent = parts[parts.length - 2] || ''
    return normalizeProductId(base) || normalizeProductId(parent) || ''
  }

  function materialKeysFromPath(path) {
    const parts = dirnameParts(path)
    const keys = new Set()
    const productId = findProductIdFromPath(path)
    if (productId) keys.add(productId)
    const base = normalizeMerchantCode(pathStem(path))
    const parent = normalizeMerchantCode(parts[parts.length - 2] || '')
    if (parent) keys.add(parent)
    if (base) {
      keys.add(base)
      const prefix = base.match(/^(.+?)[_-]\d{1,4}$/)
      if (prefix?.[1]) keys.add(normalizeMerchantCode(prefix[1]))
    }
    return [...keys].filter(Boolean)
  }

  function normalizeSelectedImagePaths(materialImages) {
    const paths = Array.isArray(materialImages?.paths) ? materialImages.paths : []
    return paths.map(cleanText).filter(Boolean).filter(isImagePath)
  }

  function normalizeDirectoryListingFiles(materialRootFiles) {
    const paths = Array.isArray(materialRootFiles?.paths) ? materialRootFiles.paths : []
    return paths
      .map((entry, index) => {
        const rawPath = typeof entry === 'string' ? entry : entry?.path
        const filePath = cleanText(rawPath)
        if (!filePath || !isImagePath(filePath)) return null
        return {
          path: filePath,
          relativePath: cleanText(entry?.relativePath || ''),
          mtimeMs: Number.isFinite(Number(entry?.mtimeMs)) ? Number(entry.mtimeMs) : index,
          order: index,
        }
      })
      .filter(Boolean)
  }

  function normalizePathParts(path) {
    return cleanText(path).replace(/\\/g, '/').split('/').filter(Boolean)
  }

  function pathStartsWithParts(parts, rootParts) {
    if (!rootParts.length || parts.length < rootParts.length) return false
    return rootParts.every((part, index) => parts[index] === part)
  }

  function relativePartsForListingFile(file, root) {
    if (file.relativePath) return normalizePathParts(file.relativePath)
    const parts = normalizePathParts(file.path)
    const rootParts = normalizePathParts(root)
    return pathStartsWithParts(parts, rootParts) ? parts.slice(rootParts.length) : parts
  }

  function extractKocMerchantCodes(text) {
    const matches = cleanText(text).match(KOC_MERCHANT_CODE_RE) || []
    return [...new Set(matches.map(item => normalizeMerchantCode(item.toUpperCase())).filter(Boolean))]
  }

  function findKocMainImageMeta(file, root) {
    const parts = relativePartsForListingFile(file, root)
    if (parts.length < 5) return null
    const topFolder = parts[0] || ''
    const imageDirIndex = parts.findIndex(part => /^图片(?:\(\d+\))?$/.test(part))
    if (imageDirIndex < 0) return null
    const mainIndex = imageDirIndex + 1
    if (parts[mainIndex] !== '主图') return null
    const creator = parts[mainIndex + 1] || ''
    const fileName = parts[parts.length - 1] || ''
    if (!creator || !fileName || parts.length <= mainIndex + 2) return null
    const codes = extractKocMerchantCodes(topFolder)
    if (!codes.length) return null
    return { codes, creator, fileName, topFolder }
  }

  function groupKocMainImageGroupsByMerchantCode(materialRootFiles, root) {
    const grouped = {}
    const files = normalizeDirectoryListingFiles(materialRootFiles)
      .map(file => ({ file, meta: findKocMainImageMeta(file, materialRootFiles?.root || root) }))
      .filter(item => item.meta)
      .sort((a, b) => (
        a.meta.topFolder.localeCompare(b.meta.topFolder, 'zh-CN', { numeric: true }) ||
        a.meta.creator.localeCompare(b.meta.creator, 'zh-CN', { numeric: true }) ||
        (a.file.mtimeMs - b.file.mtimeMs) ||
        a.meta.fileName.localeCompare(b.meta.fileName, 'zh-CN', { numeric: true }) ||
        (a.file.order - b.file.order)
      ))
    for (const item of files) {
      for (const code of item.meta.codes) {
        grouped[code] = grouped[code] || []
        const key = `${item.meta.topFolder}\n${item.meta.creator}`
        let group = grouped[code].find(entry => entry.key === key)
        if (!group) {
          group = {
            key,
            topFolder: item.meta.topFolder,
            creator: item.meta.creator,
            refs: [],
          }
          grouped[code].push(group)
        }
        group.refs.push(item.file.path)
      }
    }
    Object.keys(grouped).forEach(code => {
      grouped[code] = grouped[code]
        .map(group => ({ ...group, refs: [...new Set(group.refs)] }))
        .filter(group => group.refs.length)
    })
    return grouped
  }

  function groupKocMainImagesByMerchantCode(materialRootFiles, root) {
    const grouped = groupKocMainImageGroupsByMerchantCode(materialRootFiles, root)
    const flattened = {}
    Object.entries(grouped).forEach(([code, groups]) => {
      flattened[code] = [...new Set(groups.flatMap(group => group.refs || []))]
    })
    return flattened
  }

  function groupSelectedImagesByProduct(paths) {
    const grouped = {}
    for (const path of paths || []) {
      for (const key of materialKeysFromPath(path)) {
        grouped[key] = grouped[key] || []
        grouped[key].push(path)
      }
    }
    Object.values(grouped).forEach(list => list.sort((a, b) => pathBasename(a).localeCompare(pathBasename(b), 'zh-CN')))
    return grouped
  }

  function buildRootMaterialPaths(root, productId, count) {
    const base = cleanText(root).replace(/[\\/]+$/g, '')
    if (!base || !productId || count <= 0) return []
    const list = []
    for (let index = 1; index <= count; index += 1) {
      list.push(`${base}/${productId}/${String(index).padStart(2, '0')}.jpg`)
    }
    return list
  }

  function uniqueRefs(list) {
    const seen = new Set()
    return (list || []).filter(ref => {
      const key = cleanText(ref)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  function selectedValuesForKeyMap(map, keys, cloneValue) {
    const values = []
    const seen = new Set()
    for (const key of keys || []) {
      const normalized = normalizeMerchantCode(key)
      const lookupKeys = [...new Set([normalized, normalized.toUpperCase()].filter(Boolean))]
      for (const lookupKey of lookupKeys) {
        for (const value of map?.[lookupKey] || []) {
          const valueKey = cleanText(value?.key || value)
          if (!valueKey || seen.has(valueKey)) continue
          seen.add(valueKey)
          values.push(cloneValue ? cloneValue(value) : value)
        }
      }
    }
    return values
  }

  function selectedRefsForKeyMap(map, keys) {
    return selectedValuesForKeyMap(map, keys)
  }

  function selectedKocGroupsForKeyMap(map, keys, materialCount) {
    return selectedValuesForKeyMap(map, keys, group => ({
      topFolder: group.topFolder || '',
      creator: group.creator || '',
      refs: [...new Set(group.refs || [])].slice(0, materialCount),
    })).filter(group => group.refs.length)
  }

  function hasKocGroupsForMerchant(map, merchantCode) {
    return selectedValuesForKeyMap(map, [merchantCode]).length > 0
  }

  function buildKocAssignmentKey(row, selectedByProduct, kocMainImageGroupsByCode) {
    const productId = normalizeProductId(getRowValue(row, PRODUCT_ID_ALIASES))
    const merchantCode = normalizeMerchantCode(getRowValue(row, MERCHANT_CODE_ALIASES))
    if (!merchantCode || !hasKocGroupsForMerchant(kocMainImageGroupsByCode, merchantCode)) return ''
    const refs = splitMultiValues(getRowValue(row, MATERIAL_IMAGE_ALIASES))
    const selected = selectedRefsForKeyMap(selectedByProduct, [productId, merchantCode])
    if (refs.length || selected.length) return ''
    return merchantCode.toUpperCase()
  }

  function buildKocAssignmentCounts(rows, selectedByProduct, kocMainImageGroupsByCode) {
    const counts = {}
    for (const row of rows || []) {
      if (!hasTaskFieldContent(row) || isInstructionOnlyRow(row)) continue
      const key = buildKocAssignmentKey(row, selectedByProduct, kocMainImageGroupsByCode)
      if (!key) continue
      counts[key] = (counts[key] || 0) + 1
    }
    return counts
  }

  function buildMaterialVariants(material, context = {}) {
    if (!material.kocGroups?.length) {
      return [{
        refs: material.refs,
        creator: material.creator || '',
        materialTopFolder: '',
        source: material.source,
      }]
    }

    const requestedCreator = normalizeCreatorName(context.requestedCreator)
    const requestedCreatorKey = normalizeCreatorKey(requestedCreator)
    let groups = material.kocGroups
    if (requestedCreatorKey) {
      groups = groups.filter(group => normalizeCreatorKey(group.creator) === requestedCreatorKey)
      if (!groups.length) {
        return [{
          refs: [],
          creator: requestedCreator,
          materialTopFolder: '',
          source: material.source,
          assignmentError: `未找到达人图片包：${requestedCreator}`,
        }]
      }
    } else if (Number(context.duplicateCount || 0) > 1) {
      const index = Number(context.duplicateIndex || 0)
      const group = groups[index]
      if (!group) {
        return [{
          refs: [],
          creator: '',
          materialTopFolder: '',
          source: material.source,
          assignmentError: `重复商家编码第 ${index + 1} 行未分配到达人图片包：仅找到 ${groups.length} 个达人图片包`,
        }]
      }
      groups = [group]
    }

    return groups.map(group => ({
      refs: group.refs,
      creator: group.creator,
      materialTopFolder: group.topFolder,
      source: material.source,
    }))
  }

  function normalizeMaterialRefs(row, options) {
    const productId = normalizeProductId(getRowValue(row, PRODUCT_ID_ALIASES))
    const merchantCode = normalizeMerchantCode(getRowValue(row, MERCHANT_CODE_ALIASES))
    const materialKey = productId || merchantCode
    const refs = splitMultiValues(getRowValue(row, MATERIAL_IMAGE_ALIASES))
    const selected = selectedRefsForKeyMap(options.selectedByProduct, [productId, merchantCode])
    if (refs.length || selected.length) {
      return {
        refs: uniqueRefs(refs.length ? refs : selected),
        source: refs.length ? 'Excel素材图片' : '手动选择素材图片',
      }
    }

    const materialCount = parseInteger(getRowValue(row, ['素材张数', '图片张数', 'material_count']), parseInteger(options.defaultMaterialCount, MIN_IMAGE_COUNT))
    const kocGroups = selectedKocGroupsForKeyMap(options.kocMainImageGroupsByCode, [merchantCode], materialCount)
    if (kocGroups.length) {
      return {
        refs: kocGroups[0].refs,
        source: '达人图包主图',
        creator: kocGroups[0].creator,
        kocGroups,
      }
    }

    const rootRefs = buildRootMaterialPaths(options.materialRoot, materialKey, materialCount)
    if (rootRefs.length) return { refs: rootRefs, source: '素材根目录' }

    return { refs: [], source: '' }
  }

  function hasTaskFieldContent(row) {
    const taskFieldGroups = [
      PRODUCT_ID_ALIASES,
      MERCHANT_CODE_ALIASES,
      CREATOR_ALIASES,
      MATERIAL_IMAGE_ALIASES,
      ['素材张数', '图片张数', 'material_count'],
      ['添加标题', '标题', 'title'],
      ['内容描述', '描述', '正文', 'description', 'content'],
      ['裁剪比例', '图片比例', 'crop_ratio', 'ratio'],
      ['备注', '说明', 'remark'],
    ]
    return taskFieldGroups.some(candidates => cleanText(getRowValue(row, candidates)) !== '')
  }

  function isInstructionOnlyRow(row) {
    const productCell = cleanText(getRowValue(row, PRODUCT_ID_ALIASES))
    if (!productCell || normalizeProductId(productCell)) return false
    return /^(说明|填写说明|素材图片|搜推素材|标题|内容描述|图片要求|手动多选命名约定|素材根目录约定)/.test(productCell)
  }

  function validateTitle(title) {
    const text = cleanText(title)
    if (!text) return '添加标题必填'
    if (text.length > TITLE_MAX) return `添加标题最多 ${TITLE_MAX} 个字符`
    return ''
  }

  function validateDescription(description) {
    const text = cleanText(description)
    if (!text) return '内容描述必填'
    if (text.length > DESCRIPTION_MAX) return `内容描述最多 ${DESCRIPTION_MAX} 个字符`
    return ''
  }

  function normalizeJobs(rows, options = {}) {
    const selectedPaths = normalizeSelectedImagePaths(options.materialImages || {})
    const selectedByProduct = groupSelectedImagesByProduct(selectedPaths)
    const kocMainImageGroupsByCode = groupKocMainImageGroupsByMerchantCode(options.materialRootFiles || {}, options.materialRoot)
    const jobs = []
    const invalidRows = []
    const sourceRows = Array.isArray(rows) ? rows : []
    const kocAssignmentCounts = buildKocAssignmentCounts(sourceRows, selectedByProduct, kocMainImageGroupsByCode)
    const kocAssignmentSeen = {}
    sourceRows.forEach((row, index) => {
      const rowNo = index + 2
      if (!hasTaskFieldContent(row) || isInstructionOnlyRow(row)) return
      const productId = normalizeProductId(getRowValue(row, PRODUCT_ID_ALIASES))
      const merchantCode = normalizeMerchantCode(getRowValue(row, MERCHANT_CODE_ALIASES))
      const title = cleanText(getRowValue(row, ['添加标题', '标题', 'title']))
      const description = cleanText(getRowValue(row, ['内容描述', '描述', '正文', 'description', 'content']))
      const cropRatio = parseCropRatio(getRowValue(row, ['裁剪比例', '图片比例', 'crop_ratio', 'ratio']) || options.cropRatio || DEFAULT_CROP_RATIO)
      const remark = cleanText(getRowValue(row, ['备注', '说明', 'remark']))
      const material = normalizeMaterialRefs(row, {
        selectedByProduct,
        kocMainImageGroupsByCode,
        materialRoot: options.materialRoot,
        defaultMaterialCount: options.defaultMaterialCount,
      })
      const errors = []
      if (!productId && !merchantCode) errors.push('商品ID或商家编码必填')
      const titleError = validateTitle(title)
      if (titleError) errors.push(titleError)
      const descriptionError = validateDescription(description)
      if (descriptionError) errors.push(descriptionError)
      const assignmentKey = buildKocAssignmentKey(row, selectedByProduct, kocMainImageGroupsByCode)
      const duplicateIndex = assignmentKey ? (kocAssignmentSeen[assignmentKey] || 0) : 0
      if (assignmentKey) kocAssignmentSeen[assignmentKey] = duplicateIndex + 1
      const variants = buildMaterialVariants(material, {
        requestedCreator: getRowValue(row, CREATOR_ALIASES),
        duplicateCount: kocAssignmentCounts[assignmentKey] || 0,
        duplicateIndex,
      })

      for (const variant of variants) {
        const variantErrors = [...errors]
        if (variant.assignmentError) variantErrors.push(variant.assignmentError)
        if (variant.refs.length < MIN_IMAGE_COUNT) variantErrors.push(`素材图片至少 ${MIN_IMAGE_COUNT} 张`)
        if (variant.refs.length > MAX_IMAGE_COUNT) variantErrors.push(`素材图片最多 ${MAX_IMAGE_COUNT} 张`)
        const localRefs = variant.refs.filter(ref => !isRemoteImage(ref))
        const badRefs = localRefs.filter(ref => !isImagePath(ref))
        if (badRefs.length) variantErrors.push(`素材图片扩展名不支持：${badRefs.slice(0, 3).join('、')}`)

        const job = {
          rowNo,
          productId,
          merchantCode,
          productIdSource: productId ? '表格商品ID' : '',
          creator: variant.creator,
          materialTopFolder: variant.materialTopFolder,
          title,
          description,
          cropRatio,
          remark,
          materialRefs: variant.refs,
          materialSource: variant.source,
        }

        if (variantErrors.length) {
          invalidRows.push(buildOutputRow(job, {
            status: '预检失败',
            note: variantErrors.join('；'),
          }))
        } else {
          jobs.push(job)
        }
      }
    })
    return { jobs, invalidRows, selectedPaths }
  }

  function collectLocalRefs(jobs) {
    const set = new Set()
    for (const job of jobs || []) {
      for (const ref of job.materialRefs || []) {
        if (ref && !isRemoteImage(ref)) set.add(ref)
      }
    }
    return [...set]
  }

  function localRefsForJob(job) {
    const set = new Set()
    for (const ref of job?.materialRefs || []) {
      if (ref && !isRemoteImage(ref)) set.add(ref)
    }
    return [...set]
  }

  function refsKey(refs) {
    return (refs || []).map(cleanText).sort().join('\n')
  }

  function outputMaterialDetail(materials) {
    return (materials || [])
      .map(item => {
        const url = item.url || item.ref || item.path || ''
        const crop = item.cropStatus ? ` [${item.cropRatio || ''}:${item.cropStatus}]` : ''
        return `${url}${crop}`
      })
      .filter(Boolean)
      .join('\n')
  }

  function describeError(error, fallback = '') {
    if (!error) return fallback || ''
    if (typeof error === 'string') return cleanText(error)
    if (error instanceof Error && error.message) return cleanText(error.message)
    if (typeof error !== 'object') return cleanText(error)
    const retText = Array.isArray(error.ret) ? error.ret.join('；') : ''
    const data = error.data || error.result || {}
    const parts = [
      data.errorMsg,
      data.message,
      error.message,
      error.msg,
      retText,
      data.errorCode ? `errorCode=${data.errorCode}` : '',
      error.traceId ? `traceId=${error.traceId}` : '',
    ].map(cleanText).filter(Boolean)
    if (parts.length) return parts.join('；')
    try {
      return JSON.stringify(error)
    } catch (jsonError) {
      return fallback || String(error)
    }
  }

  function buildOutputRow(job, extra = {}) {
    const item = extra.item || job?.item || {}
    const materials = extra.materials || job?.uploadedMaterials || job?.resolvedMaterials || []
    return {
      表格行号: job?.rowNo || '',
      商品ID: job?.productId || '',
      商家编码: job?.merchantCode || '',
      达人: cleanText(job?.creator || ''),
      商品标题: cleanText(item.title || item.itemTitle || item.name || job?.itemTitle || ''),
      添加标题: cleanText(job?.title || ''),
      内容描述: cleanText(job?.description || ''),
      裁剪比例: cleanText(job?.cropRatio || extra.cropRatio || ''),
      素材来源: cleanText(extra.materialSource || job?.materialSource || ''),
      素材数量: materials.length || (job?.materialRefs || []).length || '',
      素材明细: outputMaterialDetail(materials.length ? materials : (job?.materialRefs || []).map(ref => ({ ref }))),
      发布内容ID: cleanText(extra.contentId || ''),
      执行结果: cleanText(extra.status || ''),
      备注: cleanText(extra.note || job?.remark || ''),
      抓取时间: nowText(),
    }
  }

  function nextPhase(name, sleepMs = 0, newShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'next_phase',
        next_phase: name,
        sleep_ms: Number(sleepMs || 0),
        shared: newShared,
      },
    }
  }

  function injectFiles(items, nextPhaseName, sleepMs = 500, newShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'inject_files',
        items,
        next_phase: nextPhaseName,
        sleep_ms: Number(sleepMs || 0),
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

  function fail(message) {
    return { success: false, error: String(message || 'MOP 搜推素材执行失败') }
  }

  function ensureUploadInput() {
    if (typeof document === 'undefined') throw new Error('当前页面没有 document，无法注入本地图片')
    let input = document.querySelector?.(UPLOAD_INPUT_SELECTOR)
    if (!input) {
      input = document.createElement('input')
      input.type = 'file'
      input.id = UPLOAD_INPUT_ID
      input.multiple = true
      input.accept = 'image/png,image/jpeg,image/jpg,image/webp'
      input.setAttribute('data-crawshrimp-upload', 'mop-search-recommend-material')
      input.style.position = 'fixed'
      input.style.left = '-9999px'
      input.style.top = '-9999px'
      input.style.width = '1px'
      input.style.height = '1px'
      input.style.opacity = '0'
      ;(document.body || document.documentElement).appendChild(input)
    }
    return input
  }

  function getInjectedFilesByName() {
    const input = typeof document !== 'undefined' ? document.querySelector?.(UPLOAD_INPUT_SELECTOR) : null
    const files = Array.from(input?.files || [])
    const byName = new Map()
    for (const file of files) {
      byName.set(cleanText(file.name), file)
    }
    return byName
  }

  function findInjectedFileForRef(ref, filesByName) {
    const base = pathBasename(ref)
    return filesByName.get(base) || null
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(reader.error || new Error(`读取图片失败：${file?.name || ''}`))
      reader.readAsDataURL(file)
    })
  }

  async function uploadDataUrlWithPageHelper(dataUrl, name) {
    if (typeof window.$startFileUpload !== 'function') {
      throw new Error('当前页面未暴露图片上传工具 $startFileUpload，请刷新千牛素材中心搜推素材页后重试')
    }
    const uploaded = await window.$startFileUpload(dataUrl)
    if (!uploaded || typeof uploaded !== 'object') {
      throw new Error(`图片上传未返回结果：${name}`)
    }
    if (uploaded.success === false) throw new Error(uploaded.message || `图片上传失败：${name}`)
    const url = findFirstRemoteUrl(uploaded)
    if (!url) throw new Error(`图片上传未返回 URL：${name}`)
    return {
      url,
      name,
      width: parseInteger(uploaded.width || uploaded.imageWidth || uploaded.data?.width, 0),
      height: parseInteger(uploaded.height || uploaded.imageHeight || uploaded.data?.height, 0),
      uploadResult: uploaded,
    }
  }

  async function resolveMaterialUrls(job) {
    const filesByName = getInjectedFilesByName()
    const cache = window.__MOP_SEARCH_RECOMMEND_UPLOAD_CACHE__ = window.__MOP_SEARCH_RECOMMEND_UPLOAD_CACHE__ || {}
    const materials = []
    for (const ref of job.materialRefs || []) {
      if (isRemoteImage(ref)) {
        materials.push({ ref, url: normalizeRemoteImageUrl(ref), source: 'remote' })
        continue
      }
      if (cache[ref]) {
        materials.push({ ref, ...cache[ref], source: 'local-cache' })
        continue
      }
      const file = findInjectedFileForRef(ref, filesByName)
      if (!file) throw new Error(`本地图片未注入或文件名不匹配：${ref}`)
      const cropped = await cropFileToDataUrl(file, job.cropRatio || DEFAULT_CROP_RATIO)
      const uploaded = await uploadDataUrlWithPageHelper(cropped.dataUrl, file.name)
      const stored = {
        url: uploaded.url,
        width: cropped.width || uploaded.width,
        height: cropped.height || uploaded.height,
        cropRatio: cropped.cropRatio,
        cropStatus: cropped.cropStatus,
        ...(cropped.cropBox ? { cropBox: cropped.cropBox } : {}),
      }
      cache[ref] = stored
      materials.push({ ref, ...stored, source: 'local-upload' })
    }
    return materials
  }

  async function autoCropMaterial(material, ratio = DEFAULT_CROP_RATIO) {
    const normalizedRatio = parseCropRatio(ratio)
    let width = Number(material.width || 0)
    let height = Number(material.height || 0)
    if (!(width > 0) || !(height > 0)) {
      const size = await loadImageSize(material.url)
      width = size.width
      height = size.height
    }
    const box = buildCenterCropBox(width, height, normalizedRatio)
    if (!box) return { ...material, cropRatio: normalizedRatio, cropStatus: 'skip:no-size' }
    if (Math.min(box.width, box.height) < MIN_CROP_SIDE) {
      throw new Error(`图片裁剪后宽高不得低于 ${MIN_CROP_SIDE}px：${material.ref || material.url}`)
    }
    if (!box.needsCrop) {
      return {
        ...material,
        width: box.width,
        height: box.height,
        cropRatio: normalizedRatio,
        cropStatus: 'matched',
      }
    }
    const croppedUrl = buildAliCdnCropUrl(material.url, box.left, box.top, box.width, box.height)
    if (!croppedUrl) {
      throw new Error(`图片比例不符合 ${normalizedRatio}，且当前 URL 不支持自动 CDN 裁剪：${material.ref || material.url}`)
    }
    return {
      ...material,
      originalUrl: material.url,
      url: croppedUrl,
      width: box.width,
      height: box.height,
      cropRatio: normalizedRatio,
      cropStatus: 'center-cropped',
      cropBox: box,
    }
  }

  async function autoCropMaterials(materials, ratio = DEFAULT_CROP_RATIO) {
    const list = []
    for (const material of materials || []) {
      list.push(await autoCropMaterial(material, ratio))
    }
    return list
  }

  function unwrapMtopPayload(payload, api) {
    if (!payload || typeof payload !== 'object') return payload
    if (payload.ret && Array.isArray(payload.ret)) {
      const failed = payload.ret.find(item => !/^SUCCESS/i.test(String(item || '')))
      if (failed) throw new Error(`${api} 返回失败：${describeError(payload, payload.ret.join('；'))}`)
    }
    if (payload.data !== undefined) return payload.data
    return payload
  }

  async function callMtop(api, data = {}, options = {}) {
    const client = window.lib?.mtop || window.mtop
    if (!client || typeof client.request !== 'function') {
      throw new Error('未找到千牛页面 MTop 客户端，请确认当前 tab 是素材中心搜推素材页')
    }
    try {
      const payload = await client.request({
        api,
        v: options.v || '1.0',
        type: options.type || 'POST',
        dataType: options.dataType || 'json',
        H5Request: true,
        preventFallback: true,
        data,
      })
      return unwrapMtopPayload(payload, api)
    } catch (error) {
      throw new Error(`${api} 返回失败：${describeError(error, '未知错误')}`)
    }
  }

  function safeParseJson(value, fallback = null) {
    if (Array.isArray(value) || (value && typeof value === 'object')) return value
    try {
      return JSON.parse(String(value || ''))
    } catch (error) {
      return fallback
    }
  }

  function itemDescText(item) {
    const desc = item?.itemDesc?.desc
    const parts = []
    if (Array.isArray(desc)) {
      for (const entry of desc) {
        parts.push(entry?.copyText, entry?.text)
      }
    }
    parts.push(item?.title, item?.itemTitle, item?.name, item?.outerId, item?.outer_id)
    return parts.map(cleanText).filter(Boolean).join(' ')
  }

  function extractMerchantCodeFromItem(item) {
    const direct = cleanText(item?.outerId || item?.outer_id || item?.outerID || item?.merchantCode || item?.sellerCode || item?.skuOuterId || '')
    if (direct) return direct
    const text = itemDescText(item)
    const match = text.match(/(?:编码|商家编码|outerId)[:：]\s*([A-Za-z0-9._-]+)/i)
    return match ? cleanText(match[1]) : ''
  }

  function normalizeSellManageItem(item) {
    const itemId = normalizeProductId(item?.itemId || item?.id || item?.item_id || itemDescText(item))
    const desc = Array.isArray(item?.itemDesc?.desc) ? item.itemDesc.desc : []
    const titleEntry = desc.find(entry => cleanText(entry?.copyText || entry?.text) && !/^ID[:：]/i.test(cleanText(entry?.text)) && !/编码[:：]/.test(cleanText(entry?.text)))
    const title = cleanText(item?.title || item?.itemTitle || item?.name || titleEntry?.copyText || titleEntry?.text)
    const picUrl = item?.picUrl || item?.image || item?.itemPic || item?.itemDesc?.img || ''
    return {
      ...item,
      itemId,
      id: itemId,
      title,
      itemTitle: title,
      picUrl: normalizeRemoteImageUrl(picUrl) || cleanText(picUrl),
      merchantCode: extractMerchantCodeFromItem(item),
    }
  }

  function extractSellManageItems(data) {
    const raw = data?.result || data?.model || data
    const parsed = safeParseJson(raw, raw)
    const payload = parsed?.data || parsed?.result || parsed
    const table = payload?.table || payload?.data?.table || {}
    const list = table.dataSource || table.list || payload?.dataSource || payload?.list || payload?.items || []
    return (Array.isArray(list) ? list : []).map(normalizeSellManageItem).filter(item => item.itemId)
  }

  async function searchSellManageItemsByMerchantCode(merchantCode) {
    const code = normalizeMerchantCode(merchantCode)
    if (!code) return []
    const data = await callMtop('mtop.tmall.sell.pc.manage.async', {
      url: '/tmall/manager/table.htm',
      jsonBody: JSON.stringify({
        tab: 'on_sale',
        pagination: { current: 1, pageSize: 20 },
        filtertab: '',
        filter: { queryOuterId: code },
        table: {},
      }),
    })
    return extractSellManageItems(data)
  }

  async function resolveProductIdFromMerchantCode(job) {
    if (job?.productId) return { ...job }
    const code = normalizeMerchantCode(job?.merchantCode)
    if (!code) throw new Error('商品ID或商家编码必填')
    const items = await searchSellManageItemsByMerchantCode(code)
    if (!items.length) throw new Error(`商家编码未匹配到商品ID：${code}`)
    const exactItems = items.filter(item => normalizeMerchantCode(item.merchantCode) === code)
    const candidates = exactItems.length ? exactItems : items
    const chosen = candidates[0]
    const note = candidates.length > 1
      ? `商家编码 ${code} 匹配到 ${candidates.length} 个商品，默认使用 ${chosen.itemId}`
      : `已按商家编码 ${code} 解析商品ID ${chosen.itemId}`
    return {
      ...job,
      productId: chosen.itemId,
      productIdSource: '商家编码解析',
      itemLookup: {
        merchantCode: code,
        matchedCount: candidates.length,
        totalCount: items.length,
        resolvedItemId: chosen.itemId,
      },
      item: chosen,
      itemTitle: chosen.title || job.itemTitle || '',
      remark: cleanText([job.remark, note].filter(Boolean).join('；')),
    }
  }

  async function fetchItemFromFeedsList(productId) {
    try {
      const data = await callMtop('mtop.taobao.feeds.material.item.list', {
        pageNo: 1,
        pageSize: 10,
        scene: DEFAULT_SCENE,
        condition: JSON.stringify({ itemId: String(productId) }),
        orderBys: '',
        source: SOURCE,
      }, { type: 'GET' })
      const result = data?.result || data?.model || data
      const list = result?.data || result?.list || result?.items || []
      const items = Array.isArray(list) ? list : []
      return items.find(item => cleanText(item.itemId || item.id || item.item_id) === String(productId)) || items[0] || null
    } catch (error) {
      return null
    }
  }

  async function searchItem(productId) {
    try {
      const data = await callMtop('mtop.taobao.qianniu.shop.item.search', {
        searchType: 'all',
        param: JSON.stringify({ currentPage: 1, pageSize: 24, k: productId }),
      })
      const result = data?.result || data
      const list = result?.list || result?.items || result?.data || []
      const items = Array.isArray(list) ? list : []
      return items.find(item => cleanText(item.itemId || item.id || item.item_id) === String(productId)) || items[0] || null
    } catch (error) {
      return null
    }
  }

  async function fetchItemMaterial(productId) {
    try {
      const data = await callMtop('mtop.taobao.qn.copilot.item.material.get', { itemId: productId })
      return data?.result || data || {}
    } catch (error) {
      return {}
    }
  }

  async function fetchPublishRuntimeConfig(job) {
    const defaults = {
      bizCode: DEFAULT_BIZ_CODE,
      ugcScene: DEFAULT_PUBLISH_SCENE,
      publishParams: {},
      publishSession: '',
    }
    const configInput = {
      contentType: 'article',
      ugcScene: DEFAULT_PUBLISH_SCENE,
      contentId: '',
      dataSession: cleanText(window.dataSession || ''),
      itemId: cleanText(job?.productId || ''),
    }
    try {
      const configData = await callMtop('mtop.taobao.spongebob.item.material.publish.config', configInput)
      const config = configData?.result || configData?.model || configData || {}
      defaults.bizCode = cleanText(config.bizCode || defaults.bizCode)
      defaults.publishParams = config.publishParams && typeof config.publishParams === 'object' ? config.publishParams : {}
    } catch (error) {}

    try {
      const sessionData = await callMtop('mtop.taobao.media.guang.session.generate', {
        request: JSON.stringify({ ugcScene: DEFAULT_PUBLISH_SCENE }),
      })
      const session = sessionData?.result || sessionData?.model || sessionData || {}
      defaults.publishSession = cleanText(session.publishSession || session.session || '')
    } catch (error) {}

    return defaults
  }

  function normalizeItemVO(productId, item, material) {
    const source = item || {}
    const title = cleanText(source.title || source.itemTitle || source.name || source.itemName || material?.title || material?.itemTitle || '')
    const picUrl = source.picUrl || source.image || source.itemPic || source.itemPicUrl || source.pic || material?.itemPics?.[0] || ''
    return {
      ...source,
      itemId: cleanText(source.itemId || source.id || productId),
      id: cleanText(source.id || source.itemId || productId),
      title,
      itemTitle: title,
      picUrl: normalizeRemoteImageUrl(picUrl) || cleanText(picUrl),
    }
  }

  function createRequestId() {
    try {
      if (window.crypto?.randomUUID) return window.crypto.randomUUID()
    } catch (error) {}
    return `crawshrimp-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  function buildPublishRequest(job, itemVO, materials, options = {}) {
    if (!job?.productId) throw new Error('商品ID为空')
    if (!cleanText(job.title)) throw new Error('添加标题必填')
    if (cleanText(job.title).length > TITLE_MAX) {
      throw new Error(`添加标题最多 ${TITLE_MAX} 个字符`)
    }
    if (!cleanText(job.description)) throw new Error('内容描述必填')
    if (cleanText(job.description).length > DESCRIPTION_MAX) {
      throw new Error(`内容描述最多 ${DESCRIPTION_MAX} 个字符`)
    }
    if (!Array.isArray(materials) || materials.length < MIN_IMAGE_COUNT) {
      throw new Error(`素材图片至少 ${MIN_IMAGE_COUNT} 张`)
    }
    if (materials.length > MAX_IMAGE_COUNT) {
      throw new Error(`素材图片最多 ${MAX_IMAGE_COUNT} 张`)
    }
    const pics = materials.slice(0, MAX_IMAGE_COUNT).map((item, index) => ({
      id: item.id ?? index,
      url: item.url,
      ...(item.width ? { width: item.width } : {}),
      ...(item.height ? { height: item.height } : {}),
    }))
    const cover = pics.find(item => item.url === options.coverUrl) || pics[0]
    const publishExtra = {
      ...(options.publishParams && typeof options.publishParams === 'object' ? options.publishParams : {}),
      ...(options.publishExtra && typeof options.publishExtra === 'object' ? options.publishExtra : {}),
      qn_aigc_task_id: cleanText(options.taskId || job.taskId || ''),
      publish_ai_tool_type: cleanText(options.publishAiToolType || ''),
      publish_ai_tool_info: cleanText(options.publishAiToolInfo || ''),
      text_type: cleanText(options.textType || '0'),
      post_channel: cleanText(options.postChannel || 'normal'),
      is_rcmd_publisher: '1',
    }
    if (cleanText(window.dataSession || '')) publishExtra.dataSession = cleanText(window.dataSession)
    return {
      contentType: 'article',
      bizCode: options.bizCode || DEFAULT_BIZ_CODE,
      ugcScene: options.ugcScene || DEFAULT_PUBLISH_SCENE,
      requestId: options.requestId || createRequestId(),
      shortTitle: encodeURIComponent(cleanText(job.title)),
      title: encodeURIComponent(cleanText(job.description)),
      pics,
      items: [{
        itemId: String(job.productId),
        picUrl: cleanText(itemVO?.picUrl || ''),
        title: cleanText(itemVO?.title || itemVO?.itemTitle || ''),
        source: 'selfShop',
      }],
      publishExtra,
      ...(options.publishSession ? { publishSession: options.publishSession } : {}),
      ...(cover ? { coverPic: { url: cover.url, ...(cover.width ? { width: cover.width } : {}), ...(cover.height ? { height: cover.height } : {}) } } : {}),
    }
  }

  function buildPublishPayload(job, itemVO, materials, options = {}) {
    return {
      api: 'mtop.taobao.spongebob.item.material.publish',
      data: {
        request: JSON.stringify(buildPublishRequest(job, itemVO, materials, options)),
      },
      options: { type: 'POST' },
    }
  }

  function extractContentId(result) {
    const data = result?.result || result?.model || result?.data || result
    return cleanText(data?.contentId || data?.id || result?.contentId || '')
  }

  function buildRunShared(jobs, options = {}) {
    return {
      jobs,
      results: options.results || [],
      invalid_rows: options.invalidRows || [],
      job_index: 0,
      total_rows: jobs.length + (options.invalidRows?.length || 0),
      current_exec_no: 0,
      current_row_no: 0,
      current_buyer_id: '',
      current_store: '千牛素材中心',
      batch_no: 1,
      total_batches: 1,
      execute_mode: options.executeMode || 'plan',
      submit_delay_ms: parseInteger(options.submitDelayMs, 2500),
      local_refs: options.localRefs || [],
      injected_job_index: null,
      injected_refs_key: '',
    }
  }

  function finishCurrentJob(newShared, row) {
    const results = [...(newShared.results || []), row]
    return {
      ...newShared,
      results,
      job_index: Number(newShared.job_index || 0) + 1,
      current_exec_no: Number(newShared.job_index || 0) + 1,
      current_row_no: row.表格行号 || 0,
      current_buyer_id: row.商品ID || '',
    }
  }

  async function runMainPhase() {
    const rows = params.input_file?.rows || []
    const parsed = normalizeJobs(rows, {
      materialImages: params.material_images,
      materialRoot: params.material_root,
      materialRootFiles: params.material_root_files,
      defaultMaterialCount: params.default_material_count,
      cropRatio: params.crop_ratio,
    })
    if (!rows.length) return complete([buildOutputRow({}, { status: '预检失败', note: 'Excel 没有可执行数据行' })], shared)
    const previewRows = [
      ...parsed.invalidRows,
      ...parsed.jobs.map(job => buildOutputRow(job, {
        status: '预检通过',
        note: `计划发布 ${job.materialRefs.length} 张图片`,
      })),
    ]
    if (params.execute_mode !== 'live') {
      return complete(previewRows, {
        ...shared,
        total_rows: previewRows.length,
        results: previewRows,
      })
    }
    if (parsed.invalidRows.length) {
      return complete(previewRows, {
        ...shared,
        total_rows: previewRows.length,
        results: previewRows,
      })
    }
    const localRefs = collectLocalRefs(parsed.jobs)
    const runShared = buildRunShared(parsed.jobs, {
      invalidRows: parsed.invalidRows,
      executeMode: params.execute_mode,
      submitDelayMs: params.submit_delay_ms,
      localRefs,
    })
    return nextPhase('process_row', 0, runShared)
  }

  async function runProcessRowPhase() {
    const jobs = Array.isArray(shared.jobs) ? shared.jobs : []
    const index = Number(shared.job_index || 0)
    const job = jobs[index]
    if (!job) {
      const rows = [...(shared.invalid_rows || []), ...(shared.results || [])]
      return complete(rows, shared)
    }
    let resolvedJob = job
    try {
      resolvedJob = await resolveProductIdFromMerchantCode(job)
    } catch (error) {
      const failedShared = finishCurrentJob({
        ...shared,
        current_exec_no: index + 1,
        current_row_no: job.rowNo,
        current_buyer_id: job.productId || job.merchantCode || '',
      }, buildOutputRow(job, {
        status: '解析失败',
        note: describeError(error),
      }))
      return nextPhase('process_row', shared.submit_delay_ms || 0, failedShared)
    }
    const nextJobs = [...jobs]
    nextJobs[index] = resolvedJob
    const rowLocalRefs = localRefsForJob(resolvedJob)
    const rowLocalRefsKey = refsKey(rowLocalRefs)
    if (rowLocalRefs.length && (shared.injected_job_index !== index || shared.injected_refs_key !== rowLocalRefsKey)) {
      ensureUploadInput()
      return injectFiles([{ selector: UPLOAD_INPUT_SELECTOR, files: rowLocalRefs }], 'process_row', 500, {
        ...shared,
        jobs: nextJobs,
        injected_job_index: index,
        injected_refs_key: rowLocalRefsKey,
        current_exec_no: index + 1,
        current_row_no: resolvedJob.rowNo,
        current_buyer_id: resolvedJob.productId || resolvedJob.merchantCode,
      })
    }
    const activeShared = {
      ...shared,
      jobs: nextJobs,
      current_exec_no: index + 1,
      current_row_no: resolvedJob.rowNo,
      current_buyer_id: resolvedJob.productId || resolvedJob.merchantCode,
    }
    try {
      const [feedsItem, shopItem, material] = await Promise.all([
        fetchItemFromFeedsList(resolvedJob.productId),
        searchItem(resolvedJob.productId),
        fetchItemMaterial(resolvedJob.productId),
      ])
      const itemVO = normalizeItemVO(resolvedJob.productId, feedsItem || shopItem || resolvedJob.item, material)
      const materials = await autoCropMaterials(await resolveMaterialUrls(resolvedJob), resolvedJob.cropRatio || params.crop_ratio || DEFAULT_CROP_RATIO)
      const publishOptions = await fetchPublishRuntimeConfig(resolvedJob)
      const enrichedJob = {
        ...resolvedJob,
        item: itemVO,
        resolvedMaterials: materials,
        publishOptions,
        materialSource: resolvedJob.materialSource || materials[0]?.source || '',
      }
      window.__MOP_SEARCH_RECOMMEND_ACTIVE_JOB__ = enrichedJob
      return nextPhase('submit_job', 0, {
        ...activeShared,
        active_job: enrichedJob,
      })
    } catch (error) {
      const failedShared = finishCurrentJob(activeShared, buildOutputRow(resolvedJob, {
        status: '发布失败',
        note: describeError(error),
      }))
      return nextPhase('process_row', shared.submit_delay_ms || 0, failedShared)
    }
  }

  async function runSubmitJobPhase() {
    const activeJob = shared.active_job || window.__MOP_SEARCH_RECOMMEND_ACTIVE_JOB__
    if (!activeJob) return nextPhase('process_row', 0, shared)
    try {
      const payload = buildPublishPayload(activeJob, activeJob.item, activeJob.resolvedMaterials || [], activeJob.publishOptions || {})
      const result = await callMtop(payload.api, payload.data, payload.options)
      const contentId = extractContentId(result)
      const successShared = finishCurrentJob(shared, buildOutputRow(activeJob, {
        status: contentId ? '发布成功' : '提交成功',
        contentId,
        item: activeJob.item,
        materials: activeJob.resolvedMaterials || [],
        materialSource: activeJob.materialSource,
        note: contentId ? '' : '接口已返回成功，但未识别到内容ID，请在千牛搜推素材列表中确认',
      }))
      return nextPhase('process_row', shared.submit_delay_ms || 0, { ...successShared, active_job: null })
    } catch (error) {
      const failedShared = finishCurrentJob(shared, buildOutputRow(activeJob, {
        status: '发布失败',
        item: activeJob.item,
        materials: activeJob.resolvedMaterials || [],
        materialSource: activeJob.materialSource,
        note: describeError(error),
      }))
      return nextPhase('process_row', shared.submit_delay_ms || 0, { ...failedShared, active_job: null })
    }
  }

  function exposeHelpers() {
    if (!testExports || typeof testExports !== 'object') return
    Object.assign(testExports, {
      cleanText,
      normalizeHeader,
      getRowValue,
      splitMultiValues,
      parseInteger,
      normalizeProductId,
      normalizeRemoteImageUrl,
      findFirstRemoteUrl,
      parseCropRatio,
      cropRatioNumber,
      buildAliCdnCropUrl,
      buildCenterCropBox,
      autoCropMaterial,
      autoCropMaterials,
      describeError,
      normalizeSelectedImagePaths,
      normalizeDirectoryListingFiles,
      extractKocMerchantCodes,
      groupKocMainImageGroupsByMerchantCode,
      groupKocMainImagesByMerchantCode,
      groupSelectedImagesByProduct,
      buildRootMaterialPaths,
      normalizeMaterialRefs,
      normalizeJobs,
      collectLocalRefs,
      localRefsForJob,
      refsKey,
      buildPublishRequest,
      buildPublishPayload,
      fetchPublishRuntimeConfig,
      buildRunShared,
      buildOutputRow,
      extractContentId,
      MIN_IMAGE_COUNT,
      MAX_IMAGE_COUNT,
      TITLE_MAX,
      DESCRIPTION_MAX,
      DEFAULT_CROP_RATIO,
    })
  }

  exposeHelpers()

  if (phase === '__exports__') return complete([], shared)

  try {
    if (phase === 'main' || phase === 'init') return await runMainPhase()
    if (phase === 'process_row') return await runProcessRowPhase()
    if (phase === 'submit_job') return await runSubmitJobPhase()
    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || error)
  }
})()
