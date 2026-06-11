;(async () => {
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__

  const UPLOAD_INPUT_ID = 'crawshrimp-mop-kol-material-input'
  const UPLOAD_INPUT_SELECTOR = `#${UPLOAD_INPUT_ID}`
  const DEFAULT_PROVIDER = '法象'
  const DEFAULT_CATEGORY = '女装/女士精品'
  const REMOTE_IMAGE_RE = /^(?:https?:)?\/\//i
  const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp']
  const PRODUCT_ID_ALIASES = ['商品ID', '商品id', 'itemId', 'item_id', '商品链接']
  const MERCHANT_CODE_ALIASES = ['商家编码', '商家编号', '商家货号', '商家SKU编码', '商家SKU', '货号', '编码', 'outerId', 'outer_id', 'skuCode', 'sku_code']
  const CREATOR_ALIASES = ['达人', '达人名称', '达人文件夹', '图片包', '图片包名称', 'KOL', 'kol', 'creator']
  const MATERIAL_IMAGE_ALIASES = ['素材图片', '素材图', '图片', '图片路径', '图片URL', 'image_urls', 'images']
  const KOC_MERCHANT_CODE_RE = /\d{6}[A-Z]\d{4}[A-Z]/gi
  const FUNC_TYPE = {
    IMG_2_VIDEO: 'model_img2video',
    TEMPLATE_2_VIDEO: 'template_img2video',
    TEMPLATE_2_VIDEO_V2: 'template_img2video_v2',
  }

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

  function normalizeMode(value, fallback = 'template') {
    return 'img2video'
  }

  function normalizeRatio(value, fallback = '3:4') {
    const text = compact(value || fallback).replace(/[：]/g, ':')
    return ['3:4', '1:1', '9:16', '16:9'].includes(text) ? text : fallback
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
    const preferredKeys = ['fullUrl', 'url', 'imageUrl', 'ossUrl', 'cdnUrl']
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

  function parseSlotMapping(value) {
    const entries = splitMultiValues(value)
    const mapping = []
    for (const entry of entries) {
      const match = entry.match(/^\s*([^=：:]+)\s*[=：:]\s*(.+?)\s*$/)
      if (!match) continue
      mapping.push({
        slotCode: cleanText(match[1]),
        ref: cleanText(match[2]),
      })
    }
    return mapping
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

  function normalizeMaterialRefs(row, options) {
    const refs = splitMultiValues(getRowValue(row, MATERIAL_IMAGE_ALIASES))
    const slotMapping = []
    const slotRefs = []
    const productId = normalizeProductId(getRowValue(row, PRODUCT_ID_ALIASES))
    const merchantCode = normalizeMerchantCode(getRowValue(row, MERCHANT_CODE_ALIASES))
    const materialKey = productId || merchantCode
    const selected = selectedRefsForKeyMap(options.selectedByProduct, [productId, merchantCode])
    const explicitRefs = refs.length ? refs : selected
    const uniqueRefs = list => {
      const seen = new Set()
      return (list || []).filter(ref => {
        const key = cleanText(ref)
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      })
    }
    if (explicitRefs.length || slotRefs.length) {
      return {
        refs: uniqueRefs([...explicitRefs, ...slotRefs]),
        slotMapping,
        source: refs.length ? 'Excel素材图片' : '手动选择素材图片',
      }
    }

    const materialCount = parseInteger(getRowValue(row, ['素材张数', '图片张数', 'material_count']), parseInteger(options.defaultMaterialCount, 3))
    const kocGroups = selectedKocGroupsForKeyMap(options.kocMainImageGroupsByCode, [merchantCode], materialCount)
    if (kocGroups.length) {
      return {
        refs: kocGroups[0].refs,
        slotMapping,
        source: '达人图包主图',
        creator: kocGroups[0].creator,
        kocGroups,
      }
    }

    const rootRefs = buildRootMaterialPaths(options.materialRoot, materialKey, materialCount)
    if (rootRefs.length) return { refs: rootRefs, slotMapping, source: '素材根目录' }

    return { refs: [], slotMapping, source: '' }
  }

  function isInstructionOnlyRow(row) {
    const productCell = cleanText(getRowValue(row, PRODUCT_ID_ALIASES))
    if (!productCell || normalizeProductId(productCell)) return false
    return /^(说明|填写说明|现在脚本|素材图片不是必填|素材根目录约定|手动多选命名约定|素材图片列支持)/.test(productCell)
  }

  function hasTaskFieldContent(row) {
    const taskFieldGroups = [
      PRODUCT_ID_ALIASES,
      MERCHANT_CODE_ALIASES,
      CREATOR_ALIASES,
      MATERIAL_IMAGE_ALIASES,
      ['素材张数', '图片张数', 'material_count'],
      ['槽位映射', '槽位图片', 'slot_mapping'],
      ['比例', '画幅', 'ratio'],
      ['提示词', '文案', 'prompt'],
      ['备注', '说明', 'remark'],
    ]
    return taskFieldGroups.some(candidates => cleanText(getRowValue(row, candidates)) !== '')
  }

  function normalizeJobs(rows, options = {}) {
    const selectedPaths = normalizeSelectedImagePaths(options.materialImages || {})
    const selectedByProduct = groupSelectedImagesByProduct(selectedPaths)
    const kocMainImageGroupsByCode = groupKocMainImageGroupsByMerchantCode(options.materialRootFiles || {}, options.materialRoot)
    const sourceRows = Array.isArray(rows) ? rows : []
    const kocAssignmentCounts = buildKocAssignmentCounts(sourceRows, selectedByProduct, kocMainImageGroupsByCode)
    const kocAssignmentSeen = {}
    const jobs = []
    const invalidRows = []
    sourceRows.forEach((row, index) => {
      const rowNo = index + 2
      if (!hasTaskFieldContent(row) || isInstructionOnlyRow(row)) return
      const productId = normalizeProductId(getRowValue(row, PRODUCT_ID_ALIASES))
      const merchantCode = normalizeMerchantCode(getRowValue(row, MERCHANT_CODE_ALIASES))
      const errors = []
      if (!productId && !merchantCode) errors.push('商品ID或商家编码必填')
      const category = cleanText(getRowValue(row, ['主类目', '类目', 'main_category'])) || cleanText(options.mainCategory) || DEFAULT_CATEGORY
      const mode = 'img2video'
      const ratio = normalizeRatio(getRowValue(row, ['比例', '画幅', 'ratio']), options.ratio || '3:4')
      const material = normalizeMaterialRefs(row, {
        selectedByProduct,
        kocMainImageGroupsByCode,
        materialRoot: options.materialRoot,
        defaultMaterialCount: options.defaultMaterialCount,
      })
      const prompt = cleanText(getRowValue(row, ['提示词', '文案', 'prompt']))
      const remark = cleanText(getRowValue(row, ['备注', '说明', 'remark']))
      const allowItemPicsFallback = !!options.useItemPicsFallback
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
        if (!variant.refs.length && !allowItemPicsFallback) {
          variantErrors.push('未找到素材图片：请在“素材图片”列填写 URL/绝对路径，或选择素材根目录/手动多选图片')
        }
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
          category,
          mode,
          ratio,
          templateId: '',
          templateMatch: '',
          prompt,
          remark,
          materialRefs: variant.refs,
          slotMapping: material.slotMapping,
          materialSource: variant.source,
          allowItemPicsFallback,
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
      for (const item of job.slotMapping || []) {
        if (item.ref && !isRemoteImage(item.ref)) set.add(item.ref)
      }
    }
    return [...set]
  }

  function localRefsForJob(job) {
    const set = new Set()
    for (const ref of job?.materialRefs || []) {
      if (ref && !isRemoteImage(ref)) set.add(ref)
    }
    for (const item of job?.slotMapping || []) {
      if (item.ref && !isRemoteImage(item.ref)) set.add(item.ref)
    }
    return [...set]
  }

  function refsKey(refs) {
    return (refs || []).map(cleanText).sort().join('\n')
  }

  function outputMaterialDetail(materials) {
    return (materials || []).map(item => item.url || item.ref || item.path || '').filter(Boolean).join('\n')
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
      比例: job?.ratio || '',
      素材来源: cleanText(extra.materialSource || job?.materialSource || ''),
      素材数量: materials.length || (job?.materialRefs || []).length || '',
      素材明细: outputMaterialDetail(materials.length ? materials : (job?.materialRefs || []).map(ref => ({ ref }))),
      提交任务ID: cleanText(extra.taskId || ''),
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
    return { success: false, error: String(message || 'MOP 批量KOL素材转短视频执行失败') }
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
      input.setAttribute('data-crawshrimp-upload', 'mop-kol-material-img2video')
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
      throw new Error('当前页面未暴露图片上传工具 $startFileUpload，请刷新千牛素材中心视频生产页后重试')
    }
    const uploaded = await window.$startFileUpload(dataUrl)
    if (!uploaded || typeof uploaded !== 'object') {
      throw new Error(`图片上传未返回结果：${name}`)
    }
    if (uploaded.success === false) throw new Error(uploaded.message || `图片上传失败：${name}`)
    const url = findFirstRemoteUrl(uploaded)
    if (!url) throw new Error(`图片上传未返回 URL：${name}`)
    return { url, name, uploadResult: uploaded }
  }

  async function resolveMaterialUrls(job) {
    const filesByName = getInjectedFilesByName()
    const cache = window.__MOP_KOL_UPLOAD_CACHE__ = window.__MOP_KOL_UPLOAD_CACHE__ || {}
    const materials = []
    for (const ref of job.materialRefs || []) {
      if (isRemoteImage(ref)) {
        materials.push({ ref, url: normalizeRemoteImageUrl(ref), source: 'remote' })
        continue
      }
      if (cache[ref]) {
        materials.push({ ref, url: cache[ref], source: 'local-cache' })
        continue
      }
      const file = findInjectedFileForRef(ref, filesByName)
      if (!file) throw new Error(`本地图片未注入或文件名不匹配：${ref}`)
      const dataUrl = await fileToDataUrl(file)
      const uploaded = await uploadDataUrlWithPageHelper(dataUrl, file.name)
      cache[ref] = uploaded.url
      materials.push({ ref, url: uploaded.url, source: 'local-upload' })
    }
    return materials
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
      throw new Error('未找到千牛页面 MTop 客户端，请确认当前 tab 是素材中心视频生产页')
    }
    try {
      const payload = await client.request({
        api,
        v: options.v || '1.0',
        type: options.type || 'POST',
        dataType: 'json',
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

  async function fetchSellerCategory() {
    try {
      const data = await callMtop('mtop.taobao.qn.copilot.node.aigc.seller.category.get', {})
      return data?.result || data || {}
    } catch (error) {
      return {}
    }
  }

  async function fetchTemplates(category) {
    const data = await callMtop('mtop.taobao.qn.copilot.video.template.list', { mainCategory: category || DEFAULT_CATEGORY })
    const result = data?.result || data
    if (Array.isArray(result)) return result
    if (Array.isArray(result?.templates)) return result.templates
    if (Array.isArray(result?.list)) return result.list
    return []
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
    const data = await callMtop('mtop.taobao.qn.copilot.item.material.get', { itemId: productId })
    return data?.result || data || {}
  }

  function normalizeItemVO(productId, item, material) {
    const source = item || {}
    return {
      ...source,
      itemId: source.itemId || source.id || productId,
      id: source.id || source.itemId || productId,
      title: cleanText(source.title || source.itemTitle || source.name || material?.title || material?.itemTitle || ''),
      picUrl: source.picUrl || source.image || source.itemPic || material?.itemPics?.[0] || '',
    }
  }

  function normalizeItemPicMaterials(material) {
    const pics = material?.itemPics || material?.images || []
    return (Array.isArray(pics) ? pics : []).map((item, index) => {
      const url = typeof item === 'string' ? item : (item.url || item.imageUrl || item.picUrl || item.fullUrl)
      return cleanText(url) ? { ref: `itemPic:${index + 1}`, url: cleanText(url), source: '商品主图兜底' } : null
    }).filter(Boolean)
  }

  function getTemplateSlots(template) {
    const slots = safeParseJson(template?.inputImages, [])
    if (!Array.isArray(slots)) return []
    return slots.map((slot, index) => ({
      ...slot,
      code: cleanText(slot.code ?? slot.slotCode ?? slot.id ?? index),
      required: slot.required !== false && slot.optional !== true,
    }))
  }

  function templateText(template) {
    return cleanText([
      template?.templateId,
      template?.name,
      template?.title,
      template?.description,
      template?.category,
      template?.type,
    ].filter(Boolean).join(' '))
  }

  function chooseTemplate(templates, job, materialCount = 0) {
    const list = Array.isArray(templates) ? templates : []
    if (!list.length) return null
    if (job.templateId) {
      const exact = list.find(template => cleanText(template.templateId) === cleanText(job.templateId))
      if (exact) return exact
    }
    if (job.templateMatch) {
      const needle = compact(job.templateMatch).toLowerCase()
      const matched = list.find(template => compact(templateText(template)).toLowerCase().includes(needle))
      if (matched) return matched
    }
    const ranked = list
      .map(template => {
        const slots = getTemplateSlots(template)
        const requiredCount = slots.filter(slot => slot.required).length || slots.length || 1
        const usableCount = Math.min(requiredCount, Math.max(materialCount, 1))
        const fitScore = requiredCount <= Math.max(materialCount, 1) ? 100 + usableCount * 5 : 20 - requiredCount
        const typeScore = template.type === 'action' ? -2 : 0
        return { template, score: fitScore + typeScore }
      })
      .sort((a, b) => b.score - a.score)
    return ranked[0]?.template || list[0]
  }

  function mapMaterialsToTemplateSlots(template, materials, slotMapping = []) {
    const slots = getTemplateSlots(template)
    const materialByRef = new Map((materials || []).map(item => [cleanText(item.ref), item]))
    const used = new Set()
    const mapped = []
    for (const mapping of slotMapping || []) {
      const material = materialByRef.get(cleanText(mapping.ref)) || (materials || []).find(item => item.url === mapping.ref)
      if (material) {
        mapped.push({ slotCode: cleanText(mapping.slotCode), url: material.url, ref: material.ref })
        used.add(material.ref)
      }
    }
    const remaining = (materials || []).filter(item => !used.has(item.ref))
    if (!slots.length) {
      remaining.forEach((item, index) => mapped.push({ slotCode: String(index), url: item.url, ref: item.ref }))
      return mapped
    }
    let index = 0
    for (const slot of slots) {
      if (mapped.some(item => String(item.slotCode) === String(slot.code))) continue
      const material = remaining[index]
      if (!material) break
      mapped.push({ slotCode: String(slot.code), url: material.url, ref: material.ref })
      index += 1
    }
    return mapped
  }

  function buildFallbackModelImages(template, inputImages, materials) {
    const modelSlotCodes = new Set(['0'])
    const mappedModel = (inputImages || []).find(item => modelSlotCodes.has(String(item.slotCode)))
    const slotModel = getTemplateSlots(template).find(slot => modelSlotCodes.has(String(slot.code)))
    const url = mappedModel?.url || materials?.[0]?.url || cleanText(slotModel?.imageUrl || '')
    if (!url) return null
    return {
      front: url,
      back: '',
      left: '',
      right: '',
    }
  }

  function buildTemplatePayload(job, template, materials, selectedModelImage = null) {
    if (!template) throw new Error('未找到可用模板')
    if (!materials.length) throw new Error('没有可用图片素材')
    const provider = template.provider || DEFAULT_PROVIDER
    if (template.type === 'action') {
      return {
        api: 'mtop.taobao.qn.copilot.img2video.template.video.generate',
        data: {
          templateId: template.templateId,
          templateVO: JSON.stringify(template),
          imageUrl: materials[0].url,
          prompt: job.prompt || template.description || '',
          provider,
        },
      }
    }
    const inputImages = mapMaterialsToTemplateSlots(template, materials, job.slotMapping)
    if (!inputImages.length) throw new Error('模板槽位没有匹配到图片素材')
    const selectedModel = selectedModelImage || null
    const modelImages = selectedModel
      ? (typeof selectedModel.totalImgs === 'string' ? safeParseJson(selectedModel.totalImgs, {}) : selectedModel.totalImgs)
      : buildFallbackModelImages(template, inputImages, materials)
    return {
      api: 'mtop.taobao.qn.copilot.video.template.generate',
      data: {
        templateId: template.templateId,
        templateVO: JSON.stringify(template),
        modelVO: selectedModel ? JSON.stringify(selectedModel) : '',
        provider,
        modelImages: modelImages ? JSON.stringify(modelImages) : '',
        inputImages: JSON.stringify(inputImages.map(item => ({ code: item.slotCode, imageUrl: item.url }))),
      },
    }
  }

  function buildImg2VideoPayload(job, itemVO, materials) {
    if (!materials.length) throw new Error('图生视频模式没有可用图片素材')
    return {
      api: 'mtop.taobao.qn.copilot.image.generate.video.submit',
      data: {
        clips: JSON.stringify(materials.map(item => ({
          modelUrl: item.url,
          prompt: job.prompt || '',
          itemId: job.productId,
        }))),
        qualityMode: 'highQuality',
        ratio: job.ratio || '3:4',
        selectFirstLastFrame: 'false',
        itemVO: JSON.stringify(itemVO || { itemId: job.productId }),
        funcType: FUNC_TYPE.IMG_2_VIDEO,
      },
    }
  }

  function extractTaskId(result) {
    const task = result?.task || result?.result?.task || result?.videoTask || result?.data?.task || result
    return cleanText(task?.id || task?.taskId || task?.videoTaskId || result?.id || result?.taskId || '')
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
      generation_mode: 'img2video',
      submit_delay_ms: parseInteger(options.submitDelayMs, 2500),
      main_category: options.mainCategory || DEFAULT_CATEGORY,
      local_refs: options.localRefs || [],
      local_files_injected: false,
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
      mainCategory: params.main_category,
      generationMode: 'img2video',
      ratio: params.ratio,
      useItemPicsFallback: params.use_item_pics_fallback,
    })
    if (!rows.length) return complete([buildOutputRow({}, { status: '预检失败', note: 'Excel 没有可执行数据行' })], shared)
    const previewRows = [
      ...parsed.invalidRows,
      ...parsed.jobs.map(job => buildOutputRow(job, {
        status: '预检通过',
        note: job.materialRefs.length ? `计划使用 ${job.materialRefs.length} 张素材` : '将使用商品主图兜底',
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
      generationMode: 'img2video',
      submitDelayMs: params.submit_delay_ms,
      mainCategory: params.main_category,
      localRefs,
    })
    return nextPhase('process_row', 0, runShared)
  }

  async function runPrepareTemplatesPhase() {
    const sellerCategory = await fetchSellerCategory()
    const defaultCategory = cleanText(shared.main_category) || cleanText(sellerCategory.mainCateName) || DEFAULT_CATEGORY
    const categories = new Set([defaultCategory])
    for (const job of shared.jobs || []) categories.add(job.category || defaultCategory)
    const templateCache = {}
    for (const category of categories) {
      if (!category) continue
      templateCache[category] = await fetchTemplates(category)
    }
    window.__MOP_KOL_TEMPLATE_CACHE__ = templateCache
    return nextPhase('process_row', 0, {
      ...shared,
      template_categories: Object.fromEntries(Object.entries(templateCache).map(([key, value]) => [key, value.length])),
      seller_category: sellerCategory,
      local_files_injected: false,
      injected_job_index: null,
      injected_refs_key: '',
    })
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
      const [item, material] = await Promise.all([
        searchItem(resolvedJob.productId),
        fetchItemMaterial(resolvedJob.productId).catch(() => ({})),
      ])
      const itemVO = normalizeItemVO(resolvedJob.productId, item || resolvedJob.item, material)
      let materials = await resolveMaterialUrls(resolvedJob)
      if (!materials.length && resolvedJob.allowItemPicsFallback) {
        materials = normalizeItemPicMaterials(material)
        resolvedJob.materialSource = '商品主图兜底'
      }
      if (!materials.length) throw new Error('没有可用图片素材')
      const enrichedJob = {
        ...resolvedJob,
        item: itemVO,
        resolvedMaterials: materials,
        template: null,
        materialSource: resolvedJob.materialSource || materials[0]?.source || '',
      }
      window.__MOP_KOL_ACTIVE_JOB__ = enrichedJob
      return nextPhase('submit_job', 0, {
        ...activeShared,
        active_job: enrichedJob,
      })
    } catch (error) {
      const failedShared = finishCurrentJob(activeShared, buildOutputRow(resolvedJob, {
        status: '提交失败',
        note: describeError(error),
      }))
      return nextPhase('process_row', shared.submit_delay_ms || 0, failedShared)
    }
  }

  async function runSubmitJobPhase() {
    const activeJob = shared.active_job || window.__MOP_KOL_ACTIVE_JOB__
    if (!activeJob) return nextPhase('process_row', 0, shared)
    try {
      const payload = activeJob.mode === 'img2video'
        ? buildImg2VideoPayload(activeJob, activeJob.item, activeJob.resolvedMaterials || [])
        : buildImg2VideoPayload(activeJob, activeJob.item, activeJob.resolvedMaterials || [])
      const result = await callMtop(payload.api, payload.data, { type: 'POST' })
      const taskId = extractTaskId(result)
      const successShared = finishCurrentJob(shared, buildOutputRow(activeJob, {
        status: '提交成功',
        taskId,
        item: activeJob.item,
        materials: activeJob.resolvedMaterials || [],
        materialSource: activeJob.materialSource,
        note: taskId ? '' : '接口已返回成功，但未识别到任务ID，请在千牛生成记录中确认',
      }))
      return nextPhase('process_row', shared.submit_delay_ms || 0, { ...successShared, active_job: null })
    } catch (error) {
      const failedShared = finishCurrentJob(shared, buildOutputRow(activeJob, {
        status: '提交失败',
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
      parseSlotMapping,
      normalizeProductId,
      normalizeMode,
      normalizeRatio,
      normalizeRemoteImageUrl,
      findFirstRemoteUrl,
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
      getTemplateSlots,
      chooseTemplate,
      mapMaterialsToTemplateSlots,
      buildFallbackModelImages,
      buildTemplatePayload,
      buildImg2VideoPayload,
      buildRunShared,
      buildOutputRow,
      extractTaskId,
      FUNC_TYPE,
    })
  }

  exposeHelpers()

  if (phase === '__exports__') return complete([], shared)

  try {
    if (phase === 'main' || phase === 'init') return await runMainPhase()
    if (phase === 'prepare_templates') return await runPrepareTemplatesPhase()
    if (phase === 'process_row') return await runProcessRowPhase()
    if (phase === 'submit_job') return await runSubmitJobPhase()
    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || error)
  }
})()
