;(async () => {
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__

  const UPLOAD_INPUT_ID = 'crawshrimp-mop-dress-collocation-input'
  const UPLOAD_INPUT_SELECTOR = `#${UPLOAD_INPUT_ID}`
  const DEFAULT_ENTRY_URL = 'https://qn.taobao.com/home.htm/qianniu_dress_collocation/create?source=sucaizhongxin&isNew=true'
  const LIST_URL = 'https://qn.taobao.com/home.htm/material-center/material-management?tab=recommend&subTab=SCU'
  const SCENARIO_ORIGIN = 'https://scenario-front.taobao.com'
  const TARGET_WIDTH = 750
  const TARGET_HEIGHT = 1000
  const MAX_IMAGE_COUNT = 9
  const TITLE_MAX = 30
  const DESCRIPTION_MAX = 1000
  const REMOTE_IMAGE_RE = /^(?:https?:)?\/\//i
  const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp)$/i
  const DRAFT_STATUS_RE = /草稿|draft/i
  const SELECTOR_IFRAME_RE = /sucai-selector-ng/i
  const PICTURE_CENTER_UPLOAD_ENDPOINT = 'https://stream-upload.taobao.com/api/upload.api'

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

  function parseInteger(value, fallback = 0) {
    const n = parseInt(String(value ?? '').trim(), 10)
    return Number.isFinite(n) ? n : fallback
  }

  function normalizeProductId(value) {
    const text = compact(value)
    const match = text.match(/\d{8,}/)
    return match ? match[0] : ''
  }

  function splitMultiValues(value) {
    if (Array.isArray(value)) return value.map(cleanText).filter(Boolean)
    return String(value ?? '')
      .split(/[\n\r,，;；|]+/g)
      .map(cleanText)
      .filter(Boolean)
  }

  function normalizeProductIds(value) {
    const seen = new Set()
    const ids = []
    for (const item of splitMultiValues(value)) {
      const id = normalizeProductId(item)
      if (id && !seen.has(id)) {
        seen.add(id)
        ids.push(id)
      }
    }
    return ids
  }

  function normalizeRemoteImageUrl(value) {
    const text = cleanText(value)
    if (!REMOTE_IMAGE_RE.test(text)) {
      if (/^(?:imgextra|bao\/uploaded)\//i.test(text)) return `https://img.alicdn.com/${text}`
      if (/^\/\/(?:img|gw)\.alicdn\.com\//i.test(text)) return `https:${text}`
      return ''
    }
    return text.startsWith('//') ? `https:${text}` : text
  }

  function isRemoteImage(value) {
    return Boolean(normalizeRemoteImageUrl(value))
  }

  function pathBasename(value) {
    const text = cleanText(value).replace(/\\/g, '/')
    return text.split('/').filter(Boolean).pop() || text
  }

  function normalizeImageRefs(value) {
    const refs = []
    const pushRef = item => {
      if (!item) return
      if (typeof item === 'string') {
        const text = cleanText(item)
        if (text) refs.push(text)
        return
      }
      if (typeof item === 'object') {
        const text = cleanText(item.path || item.file || item.name || item.url || item.fullPath || '')
        if (text) refs.push(text)
      }
    }
    if (Array.isArray(value)) value.forEach(pushRef)
    else splitMultiValues(value).forEach(pushRef)
    return [...new Set(refs)].slice(0, MAX_IMAGE_COUNT)
  }

  function normalizeMaterialRefs(options = params) {
    return normalizeImageRefs(
      options.material_images ||
      options.material_image ||
      options.image_file ||
      options.image_files ||
      options.images ||
      options.image_urls ||
      '',
    )
  }

  function rowValue(row, aliases) {
    for (const alias of aliases) {
      if (row && Object.prototype.hasOwnProperty.call(row, alias)) {
        const value = cleanText(row[alias])
        if (value) return value
      }
    }
    const wanted = aliases.map(alias => compact(alias).toLowerCase())
    for (const [key, value] of Object.entries(row || {})) {
      if (wanted.includes(compact(key).toLowerCase())) {
        const text = cleanText(value)
        if (text) return text
      }
    }
    return ''
  }

  function stripDuplicateFolderSuffix(folderName) {
    return cleanText(folderName).replace(/\s*\(\d+\)\s*$/, '').trim()
  }

  function splitStyleCodesFromFolderName(folderName) {
    return stripDuplicateFolderSuffix(folderName)
      .split('+')
      .map(cleanText)
      .filter(Boolean)
  }

  function normalizeStyleCode(value) {
    return compact(value).toUpperCase()
  }

  function normalizeFolderIdentity(value, { stripDuplicate = false } = {}) {
    const text = stripDuplicate ? stripDuplicateFolderSuffix(value) : cleanText(value)
    return compact(text).toUpperCase()
  }

  function firstPathSegmentForFolder(relativePath, folderName) {
    const segments = cleanText(relativePath).replace(/\\/g, '/').split('/').filter(Boolean)
    const exact = normalizeFolderIdentity(folderName)
    const base = normalizeFolderIdentity(folderName, { stripDuplicate: true })
    return segments.find(segment => normalizeFolderIdentity(segment) === exact) ||
      segments.find(segment => normalizeFolderIdentity(segment, { stripDuplicate: true }) === base) ||
      ''
  }

  function normalizeDirectoryFileEntry(entry, root = '') {
    if (!entry) return null
    const rawPath = cleanText(entry.path || entry.fullPath || entry.file || entry.name || '')
    const relativePath = cleanText(entry.relativePath || entry.relative_path || entry.localPath || entry.name || rawPath)
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
    const absolutePath = rawPath || (root && relativePath ? `${String(root).replace(/\/+$/, '')}/${relativePath}` : relativePath)
    if (!absolutePath && !relativePath) return null
    return {
      ...entry,
      path: absolutePath,
      relativePath: relativePath || pathBasename(absolutePath),
      name: pathBasename(relativePath || absolutePath),
    }
  }

  function directoryFileEntries(options = params) {
    const listing = options.material_root_files || options.materialRootFiles || {}
    const root = cleanText(listing.root || options.material_root || options.materialRoot || '')
    const paths = Array.isArray(listing.paths)
      ? listing.paths
      : Array.isArray(options.material_root_files)
        ? options.material_root_files
        : []
    return paths
      .map(entry => normalizeDirectoryFileEntry(entry, root))
      .filter(entry => entry && IMAGE_EXT_RE.test(entry.path || entry.relativePath || entry.name || ''))
  }

  function styleSetFromFolderSegment(segment) {
    return new Set(splitStyleCodesFromFolderName(segment).map(normalizeStyleCode).filter(Boolean))
  }

  function fileStem(value) {
    return pathBasename(value).replace(/\.[^.]+$/, '')
  }

  function findCollocationImagesForJob(job, options = params) {
    const entries = directoryFileEntries(options)
    const folderName = cleanText(job.folderName || job.collocationFolderName || '')
    const styleCodes = (job.styleCodes || []).map(normalizeStyleCode).filter(Boolean)
    const primaryStyleCode = normalizeStyleCode(job.primaryStyleCode || styleCodes[0] || '')
    const exactMatches = []
    const baseMatches = []
    const filenameMatches = []
    const styleMatches = []

    for (const entry of entries) {
      const rel = cleanText(entry.relativePath || entry.path || '').replace(/\\/g, '/')
      const segments = rel.split('/').filter(Boolean)
      if (!segments.length) continue
      if (folderName) {
        const exactIdentity = normalizeFolderIdentity(folderName)
        const baseIdentity = normalizeFolderIdentity(folderName, { stripDuplicate: true })
        const exactSegment = segments.find(segment => normalizeFolderIdentity(segment) === exactIdentity)
        if (exactSegment) {
          exactMatches.push({ ...entry, folderSegment: exactSegment, source: 'material-root-folder-exact' })
          continue
        }
        const baseSegment = segments.find(segment => normalizeFolderIdentity(segment, { stripDuplicate: true }) === baseIdentity)
        if (baseSegment) {
          baseMatches.push({ ...entry, folderSegment: baseSegment, source: 'material-root-folder-base' })
          continue
        }
      }
      if (primaryStyleCode) {
        const nameKey = normalizeStyleCode(fileStem(entry.name || entry.relativePath || entry.path || ''))
        if (nameKey.includes(primaryStyleCode)) {
          filenameMatches.push({ ...entry, folderSegment: segments[0] || '', source: 'material-root-primary-style-filename' })
          continue
        }
      }
      if (styleCodes.length) {
        const matchedSegment = segments.find(segment => {
          const set = styleSetFromFolderSegment(segment)
          return styleCodes.every(code => set.has(code))
        })
        if (matchedSegment) styleMatches.push({ ...entry, folderSegment: matchedSegment, source: 'material-root-style-set' })
      }
    }

    const matched = exactMatches.length ? exactMatches : (baseMatches.length ? baseMatches : (filenameMatches.length ? filenameMatches : styleMatches))
    return matched
      .sort((a, b) => cleanText(a.relativePath || a.path).localeCompare(cleanText(b.relativePath || b.path), 'zh-Hans-CN'))
      .slice(0, MAX_IMAGE_COUNT)
      .map(entry => entry.path)
      .filter(Boolean)
  }

  function findCollocationFolderSegmentForJob(job, options = params) {
    const refs = findCollocationImagesForJob(job, options)
    if (!refs.length) return ''
    const entries = directoryFileEntries(options)
    const firstEntry = entries.find(entry => refs.includes(entry.path))
    const segments = cleanText(firstEntry?.relativePath || firstEntry?.path || '').replace(/\\/g, '/').split('/').filter(Boolean)
    const folderName = cleanText(job.folderName || job.collocationFolderName || '')
    if (folderName) {
      const matchedFolder = firstPathSegmentForFolder(firstEntry?.relativePath || firstEntry?.path || '', folderName)
      if (matchedFolder) return matchedFolder
    }
    const primaryStyleCode = normalizeStyleCode(job.primaryStyleCode || job.styleCodes?.[0] || '')
    if (primaryStyleCode && normalizeStyleCode(fileStem(firstEntry?.name || firstEntry?.relativePath || firstEntry?.path || '')).includes(primaryStyleCode)) {
      return primaryStyleCode
    }
    const styleCodes = (job.styleCodes || []).map(normalizeStyleCode).filter(Boolean)
    return segments.find(segment => {
      const set = styleSetFromFolderSegment(segment)
      return styleCodes.length && styleCodes.every(code => set.has(code))
    }) || ''
  }

  function numberedRowValue(row, prefixes, index) {
    const aliases = []
    for (const prefix of prefixes) {
      aliases.push(`${prefix}${index}`, `${prefix} ${index}`, `${prefix}_${index}`, `${prefix}-${index}`)
    }
    return rowValue(row, aliases)
  }

  function collectStyleProductPairs(row) {
    const pairs = []
    for (let index = 1; index <= 6; index += 1) {
      const styleCode = numberedRowValue(row, ['款号', '搭配款号', 'style', 'style_code'], index)
      const productId = normalizeProductId(numberedRowValue(row, ['商品ID', '商品 ID', 'itemId', 'item_id', 'productId', 'product_id'], index))
      const category = numberedRowValue(row, ['品类', '商品品类', '类目', '商品类目', '分类', '角色', '标签', '搭配标签', '位置'], index)
      const itemTitle = numberedRowValue(row, ['商品标题', '商品名称', '商品名', '宝贝标题', '货品标题', 'title', 'name'], index)
      if (styleCode || productId) pairs.push({
        styleCode: cleanText(styleCode),
        productId,
        category: cleanText(category),
        itemTitle: cleanText(itemTitle),
        index,
      })
    }
    if (pairs.length) return pairs

    const styles = splitMultiValues(rowValue(row, ['款号', '搭配款号', '商家编码', '货号', 'style_codes', 'style_code']))
    const productIds = normalizeProductIds(rowValue(row, ['商品ID', '商品 ID', '商品id', 'itemIds', 'item_ids', 'product_ids', 'productIds']))
    return styles.map((styleCode, index) => ({ styleCode, productId: productIds[index] || '', index: index + 1 }))
  }

  function normalizeBatchJobs(options = params) {
    const rows = Array.isArray(options.input_file?.rows) ? options.input_file.rows : []
    return rows.map((row, rowIndex) => {
      const folderName = rowValue(row, ['文件夹名', '搭配方式', '顶层文件夹', '素材文件夹', '文件夹'])
      const pairs = collectStyleProductPairs(row)
      const styleCodes = pairs.map(pair => cleanText(pair.styleCode)).filter(Boolean)
      const productIds = pairs.map(pair => pair.productId).filter(Boolean)
      const inferredStyles = styleCodes.length ? styleCodes : splitStyleCodesFromFolderName(folderName)
      const primaryStyleCode = cleanText(pairs[0]?.styleCode || inferredStyles[0] || '')
      const searchFolderName = folderName || inferredStyles.join('+')
      const matchSeed = { folderName: searchFolderName, styleCodes: inferredStyles, primaryStyleCode }
      const materialRefs = findCollocationImagesForJob(matchSeed, options)
      const matchedFolderName = findCollocationFolderSegmentForJob(matchSeed, options)
      const fallbackRefs = materialRefs.length ? materialRefs : normalizeImageRefs(rowValue(row, ['素材图片', '素材路径', '图片', 'material_images', 'images']))
      return normalizeJob({
        ...options,
        product_ids: productIds.join('\n'),
        title: rowValue(row, ['标题', '搭配标题', '添加标题', 'title']) || options.title,
        description: rowValue(row, ['文案', '描述', '内容描述', 'description', 'copy']) || options.description,
        material_images: fallbackRefs,
        draft_id: rowValue(row, ['草稿ID', '草稿 ID', '搭配ID', 'scuId', 'draft_id']) || options.draft_id,
        execute_mode: hasInputRows(options) ? 'live_publish' : (options.execute_mode || 'plan'),
        folderName: folderName || matchedFolderName,
        collocationFolderName: folderName || matchedFolderName,
        styleCodes: inferredStyles,
        primaryStyleCode,
        styleProductPairs: pairs,
        tableRowNumber: rowValue(row, ['表格行号', '行号', '序号']) || String(rowIndex + 2),
        materialSource: materialRefs.length ? `本地素材目录/${matchedFolderName || primaryStyleCode || inferredStyles.join('+')}` : '',
      })
    })
  }

  function buildSafeThreeFourPlan(width, height, options = {}) {
    const sourceWidth = Number(width || 0)
    const sourceHeight = Number(height || 0)
    const targetWidth = parseInteger(options.targetWidth, TARGET_WIDTH)
    const targetHeight = parseInteger(options.targetHeight, TARGET_HEIGHT)
    if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
      return {
        targetWidth,
        targetHeight,
        targetRatio: '3:4',
        mode: 'unknown-source-size',
        preservesFullSubject: true,
      }
    }
    const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
    const drawWidth = Math.max(1, Math.round(sourceWidth * scale))
    const drawHeight = Math.max(1, Math.round(sourceHeight * scale))
    const offsetX = Math.round((targetWidth - drawWidth) / 2)
    const offsetY = Math.round((targetHeight - drawHeight) / 2)
    const sourceRatio = sourceWidth / sourceHeight
    return {
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
      targetRatio: '3:4',
      sourceRatio: Number(sourceRatio.toFixed(4)),
      mode: Math.abs(sourceRatio - 0.75) < 0.01 ? 'matched' : 'contain-with-soft-background',
      scale: Number(scale.toFixed(6)),
      drawWidth,
      drawHeight,
      offsetX,
      offsetY,
      pads: {
        left: Math.max(0, offsetX),
        right: Math.max(0, targetWidth - drawWidth - offsetX),
        top: Math.max(0, offsetY),
        bottom: Math.max(0, targetHeight - drawHeight - offsetY),
      },
      preservesFullSubject: true,
      note: '输出固定 3:4，前景图片完整等比放入画布；多余区域使用柔化背景填充，避免裁掉人物主图。',
    }
  }

  function defaultAnchors(productIds) {
    const ids = productIds || []
    const positions = [
      { x: 0.52, y: 0.38, role: '上装/马甲' },
      { x: 0.54, y: 0.64, role: '下装/牛仔裤' },
    ]
    return ids.map((id, index) => ({
      itemId: id,
      productId: id,
      x: positions[index]?.x || 0.5,
      y: positions[index]?.y || Math.min(0.82, 0.38 + index * 0.18),
      role: positions[index]?.role || `搭配商品${index + 1}`,
      text: positions[index]?.role || `商品${index + 1}`,
    }))
  }

  const GARMENT_ROLE_PRESETS = {
    top: { x: 0.52, y: 0.38, role: '上装', text: '上装' },
    bottom: { x: 0.54, y: 0.64, role: '下装', text: '下装' },
    onepiece: { x: 0.52, y: 0.5, role: '连体/套装', text: '连体/套装' },
  }

  function textIncludesAny(text, keywords) {
    return keywords.some(keyword => text.includes(keyword))
  }

  function classifyGarmentRole(value) {
    const text = cleanText(Array.isArray(value) ? value.filter(Boolean).join(' ') : value)
    if (!text) return null
    const bottomKeywords = ['下装', '裤', '长裤', '短裤', '阔腿裤', '直筒裤', '牛仔裤', '休闲裤', '西裤', '半裙', '短裙', '长裙', '裙裤', 'A字裙', 'a字裙']
    const topKeywords = ['上装', '上衣', '针织衫', 'T恤', 't恤', '衬衫', '卫衣', '毛衣', '马甲', '背心', '吊带', '外套', '西装', '开衫', '短袖', '长袖', '小高领', '打底衫', '夹克', '风衣']
    const onepieceKeywords = ['连衣裙', '连体裤', '套装']
    if (textIncludesAny(text, bottomKeywords)) return { kind: 'bottom', ...GARMENT_ROLE_PRESETS.bottom }
    if (textIncludesAny(text, topKeywords)) return { kind: 'top', ...GARMENT_ROLE_PRESETS.top }
    if (textIncludesAny(text, onepieceKeywords)) return { kind: 'onepiece', ...GARMENT_ROLE_PRESETS.onepiece }
    return null
  }

  function extractGarmentRoleHints(text) {
    const source = cleanText(text)
    if (!source) return []
    const segments = source
      .split(/[\n\r,，。；;、|/]+|搭配|配/)
      .map(segment => cleanText(segment))
      .filter(Boolean)
    const hints = []
    for (const segment of segments) {
      const role = classifyGarmentRole(segment)
      if (role && hints[hints.length - 1]?.kind !== role.kind) hints.push(role)
    }
    return hints
  }

  function applyGarmentRoleToAnchor(anchor, role, source) {
    if (!role) return anchor
    return {
      ...anchor,
      x: role.x,
      y: role.y,
      role: role.role,
      text: role.text,
      garmentRole: role.kind,
      roleSource: source || anchor.roleSource || '',
    }
  }

  function roleAwareAnchors(productIds, pairs = [], context = {}) {
    const fallback = defaultAnchors(productIds)
    const hints = extractGarmentRoleHints(`${context.description || ''}\n${context.title || ''}`)
    return (productIds || []).map((id, index) => {
      const pair = pairs.find(item => item.productId && String(item.productId) === String(id)) || pairs[index] || {}
      const pairRole = classifyGarmentRole([pair.category, pair.role, pair.itemTitle, pair.title, pair.name].filter(Boolean).join(' '))
      const rowHintRole = hints[index] || null
      const role = pairRole || rowHintRole
      return applyGarmentRoleToAnchor(fallback[index] || {}, role, pairRole ? 'row-category' : (rowHintRole ? 'row-copy' : ''))
    })
  }

  function normalizeJob(options = params) {
    const productIds = normalizeProductIds(options.product_ids || options.item_ids || options.products || options.product_id)
    const title = cleanText(options.title || options.short_title || '')
    const description = cleanText(options.description || options.copy || options.body || options.content || '')
    const materialRefs = normalizeMaterialRefs(options)
    const draftId = cleanText(options.draft_id || options.id || currentDraftIdFromLocation() || '')
    const executeMode = cleanText(options.execute_mode || 'plan') || 'plan'
    const styleProductPairs = Array.isArray(options.styleProductPairs) ? options.styleProductPairs : []
    const anchors = Array.isArray(options.anchors) && options.anchors.length
      ? options.anchors
      : roleAwareAnchors(productIds, styleProductPairs, { title, description })
    return {
      productIds,
      title,
      description,
      materialRefs,
      draftId,
      executeMode,
      anchors,
      folderName: cleanText(options.folderName || options.collocationFolderName || ''),
      styleCodes: Array.isArray(options.styleCodes) ? options.styleCodes.map(cleanText).filter(Boolean) : [],
      primaryStyleCode: cleanText(options.primaryStyleCode || ''),
      styleProductPairs,
      tableRowNumber: cleanText(options.tableRowNumber || ''),
      materialSource: cleanText(options.materialSource || ''),
    }
  }

  function isPublishMode(job) {
    return cleanText(job?.executeMode || '') === 'live_publish'
  }

  function isLiveMode(job) {
    const mode = cleanText(job?.executeMode || 'plan')
    return mode === 'live' || mode === 'live_publish'
  }

  function validateJob(job) {
    const errors = []
    if (!job.productIds.length) errors.push('至少填写 1 个商品 ID')
    if (job.productIds.length > 6) errors.push('搭配商品数量过多，建议不超过 6 个')
    if (!job.title) errors.push('标题不能为空')
    if (job.title.length > TITLE_MAX) errors.push(`标题不能超过 ${TITLE_MAX} 字`)
    if (!job.description) errors.push('文案不能为空')
    if (job.description.length > DESCRIPTION_MAX) errors.push(`文案不能超过 ${DESCRIPTION_MAX} 字`)
    if (!job.materialRefs.length) errors.push('至少选择 1 张素材图片')
    if (job.materialRefs.length > MAX_IMAGE_COUNT) errors.push(`素材图片不能超过 ${MAX_IMAGE_COUNT} 张`)
    const missingProductStyles = (job.styleProductPairs || [])
      .filter(pair => cleanText(pair.styleCode) && !normalizeProductId(pair.productId))
      .map(pair => cleanText(pair.styleCode))
    if (missingProductStyles.length) errors.push(`款号缺少商品ID：${missingProductStyles.join('、')}`)
    return errors
  }

  function outputRow(job, extra = {}) {
    const materials = extra.materials || job.materials || []
    return {
      表格行号: cleanText(job.tableRowNumber || ''),
      文件夹名: cleanText(job.folderName || ''),
      款号: (job.styleCodes || []).join(','),
      搭配ID: cleanText(extra.draftId || job.draftId || ''),
      发布内容ID: cleanText(extra.contentId || ''),
      商品ID: (job.productIds || []).join(','),
      标题: cleanText(job.title || ''),
      文案: cleanText(job.description || ''),
      素材来源: cleanText(job.materialSource || ''),
      素材数量: materials.length || (job.materialRefs || []).length || '',
      素材明细: (materials.length ? materials : (job.materialRefs || []).map(ref => ({ ref })))
        .map(item => cleanText(item.url || item.ref || item.name || ''))
        .filter(Boolean)
        .join('\n'),
      切图策略: cleanText(extra.cropMode || '3:4安全切图'),
      执行结果: cleanText(extra.status || ''),
      备注: cleanText(extra.note || ''),
      抓取时间: nowText(),
    }
  }

  function nextPhase(name, sleepMs = 0, newShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: { action: 'next_phase', next_phase: name, sleep_ms: Number(sleepMs || 0), shared: newShared },
    }
  }

  function injectFiles(items, nextPhaseName, sleepMs = 500, newShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: { action: 'inject_files', items, next_phase: nextPhaseName, sleep_ms: Number(sleepMs || 0), shared: newShared },
    }
  }

  function cdpClicks(clicks, nextPhaseName, sleepMs = 500, newShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: { action: 'cdp_clicks', clicks, next_phase: nextPhaseName, sleep_ms: Number(sleepMs || 0), shared: newShared },
    }
  }

  function fileChooserUpload(items, nextPhaseName, sleepMs = 500, newShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'file_chooser_upload',
        items,
        strict: true,
        shared_key: 'file_chooser_upload_result',
        next_phase: nextPhaseName,
        sleep_ms: Number(sleepMs || 0),
        shared: newShared,
      },
    }
  }

  function prepareImageFiles(items, nextPhaseName, sleepMs = 0, newShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'prepare_image_files',
        items,
        strict: true,
        shared_key: 'prepared_image_files',
        next_phase: nextPhaseName,
        sleep_ms: Number(sleepMs || 0),
        shared: newShared,
      },
    }
  }

  function cdpTargetEval(expression, nextPhaseName, options = {}, newShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'cdp_target_eval',
        expression,
        target_url_contains: options.targetUrlContains || options.target_url_contains || ['qn.taobao.com'],
        target_types: options.targetTypes || options.target_types || ['page', 'iframe'],
        shared_key: options.sharedKey || options.shared_key || 'cdp_target_eval_result',
        next_phase: nextPhaseName,
        sleep_ms: Number(options.sleepMs ?? options.sleep_ms ?? 0),
        shared: newShared,
      },
    }
  }

  function complete(data = [], newShared = shared) {
    return { success: true, data, meta: { action: 'complete', has_more: false, shared: newShared } }
  }

  function redactImageDataUrlFields(item) {
    if (!item || typeof item !== 'object') return item
    const { dataUrl, ...rest } = item
    return { ...rest, ...(dataUrl ? { dataUrlRedacted: true } : {}) }
  }

  function withoutPreparedImageDataUrls(value = shared.prepared_image_files) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.items)) return value
    return {
      ...value,
      items: value.items.map(redactImageDataUrlFields),
    }
  }

  function fail(message) {
    return { success: false, error: String(message || 'MOP 搭配素材草稿执行失败') }
  }

  function hasInputRows(options = params) {
    return Array.isArray(options.input_file?.rows)
  }

  function hasBatchRun(state = shared) {
    return Array.isArray(state.jobs)
  }

  function collectLocalRefs(jobs) {
    const seen = new Set()
    const refs = []
    for (const job of jobs || []) {
      for (const ref of job.materialRefs || []) {
        if (!isRemoteImage(ref) && !seen.has(ref)) {
          seen.add(ref)
          refs.push(ref)
        }
      }
    }
    return refs
  }

  function buildBatchShared(jobs, previewRows = [], options = {}) {
    return {
      ...shared,
      jobs,
      results: options.initialResults || [],
      preview_rows: previewRows,
      job_index: 0,
      total_rows: previewRows.length || jobs.length,
      execute_mode: options.executeMode || params.execute_mode || 'plan',
      submit_delay_ms: parseInteger(options.submitDelayMs ?? params.submit_delay_ms, 2500),
      local_refs: collectLocalRefs(jobs),
    }
  }

  function finishBatchJob(row, state = shared, extra = {}) {
    const results = [...(state.results || []), row]
    return {
      ...state,
      ...extra,
      prepared_image_files: withoutPreparedImageDataUrls(state.prepared_image_files),
      materials: [],
      selected_materials: [],
      api_upload_result: null,
      job: null,
      results,
      job_index: Number(state.job_index || 0) + 1,
    }
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
      input.setAttribute('data-crawshrimp-upload', 'mop-dress-collocation')
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
    for (const file of files) byName.set(cleanText(file.name), file)
    return byName
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(reader.error || new Error(`读取图片失败：${file?.name || ''}`))
      reader.readAsDataURL(file)
    })
  }

  function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('图片解码失败，无法生成 3:4 安全图'))
      image.src = dataUrl
    })
  }

  function canvasToDataUrl(canvas, mimeType = 'image/jpeg', quality = 0.92) {
    try {
      return canvas.toDataURL(mimeType, quality)
    } catch (error) {
      return canvas.toDataURL('image/png')
    }
  }

  async function cropFileToSafeThreeFourDataUrl(file) {
    if (typeof document === 'undefined' || typeof Image !== 'function') {
      throw new Error('当前页面无法使用 canvas 切图')
    }
    const sourceDataUrl = await fileToDataUrl(file)
    const image = await loadImageFromDataUrl(sourceDataUrl)
    const plan = buildSafeThreeFourPlan(image.naturalWidth || image.width, image.naturalHeight || image.height)
    const canvas = document.createElement('canvas')
    canvas.width = plan.targetWidth
    canvas.height = plan.targetHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('当前页面无法创建图片画布')

    const coverScale = Math.max(plan.targetWidth / plan.sourceWidth, plan.targetHeight / plan.sourceHeight)
    const coverWidth = Math.max(1, Math.round(plan.sourceWidth * coverScale))
    const coverHeight = Math.max(1, Math.round(plan.sourceHeight * coverScale))
    const coverX = Math.round((plan.targetWidth - coverWidth) / 2)
    const coverY = Math.round((plan.targetHeight - coverHeight) / 2)
    ctx.save()
    ctx.filter = 'blur(18px) brightness(1.06) saturate(0.9)'
    ctx.drawImage(image, coverX, coverY, coverWidth, coverHeight)
    ctx.restore()
    ctx.fillStyle = 'rgba(255,255,255,0.16)'
    ctx.fillRect(0, 0, plan.targetWidth, plan.targetHeight)
    ctx.drawImage(image, plan.offsetX, plan.offsetY, plan.drawWidth, plan.drawHeight)
    return {
      dataUrl: canvasToDataUrl(canvas, 'image/jpeg', 0.92),
      name: `${pathBasename(file.name).replace(/\.[^.]+$/, '')}_3x4_safe.jpg`,
      width: plan.targetWidth,
      height: plan.targetHeight,
      cropPlan: plan,
    }
  }

  function findFirstRemoteUrl(value, depth = 0) {
    if (value === null || value === undefined || depth > 6) return ''
    if (typeof value === 'string') return normalizeRemoteImageUrl(value)
    if (Array.isArray(value)) {
      for (const item of value) {
        const matched = findFirstRemoteUrl(item, depth + 1)
        if (matched) return matched
      }
      return ''
    }
    if (typeof value !== 'object') return ''
    for (const key of ['fullUrl', 'url', 'imageUrl', 'ossUrl', 'cdnUrl', 'path', 'picUrl', 'pictureUrl']) {
      const matched = findFirstRemoteUrl(value[key], depth + 1)
      if (matched) return matched
    }
    for (const item of Object.values(value)) {
      const matched = findFirstRemoteUrl(item, depth + 1)
      if (matched) return matched
    }
    return ''
  }

  async function uploadDataUrlWithPageHelper(dataUrl, name) {
    if (typeof window.$startFileUpload === 'function') {
      const uploaded = await window.$startFileUpload(dataUrl)
      if (!uploaded || typeof uploaded !== 'object') throw new Error(`图片上传未返回结果：${name}`)
      if (uploaded.success === false) throw new Error(uploaded.message || `图片上传失败：${name}`)
      const url = findFirstRemoteUrl(uploaded)
      if (!url) throw new Error(`图片上传未返回 URL：${name}`)
      return { url, name, uploadResult: uploaded }
    }
    if (typeof window.ImageSpaceUploader === 'function') {
      return await uploadDataUrlWithImageSpaceUploader(dataUrl, name)
    }
    throw new Error('当前页面未暴露图片上传工具，请停留在千牛搭配素材创建/编辑页后重试')
  }

  function uploadDataUrlWithImageSpaceUploader(dataUrl, name) {
    return new Promise((resolve, reject) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.style.position = 'fixed'
      button.style.left = '-9999px'
      button.style.top = '-9999px'
      ;(document.body || document.documentElement).appendChild(button)
      const uploader = new window.ImageSpaceUploader({
        button,
        appkey: 'tu',
        auto: true,
        multiple: false,
        maxCount: 1,
        filters: {
          mimeTypes: 'jpg,jpeg,png',
          maxFileSize: '5mb',
          minWidth: TARGET_WIDTH,
          minHeight: TARGET_HEIGHT,
        },
      })
      const cleanup = () => {
        try { uploader.destroy?.() } catch (error) {}
        try { button.remove?.() } catch (error) {}
      }
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error(`图片上传超时：${name}`))
      }, 45000)
      const samples = []
      const sampleText = () => {
        try {
          return JSON.stringify(samples).slice(0, 600)
        } catch (error) {
          return String(samples).slice(0, 600)
        }
      }
      const remember = payload => {
        if (payload !== undefined) samples.push(payload)
      }
      const done = payload => {
        remember(payload)
        clearTimeout(timeout)
        cleanup()
        const list = []
        for (const sample of samples) {
          if (Array.isArray(sample)) list.push(...sample)
          else list.push(sample)
        }
        const first = list.find(Boolean) || payload
        const url = findFirstRemoteUrl(list) || findFirstRemoteUrl(first)
        if (!url) {
          reject(new Error(`图片空间上传未返回 URL：${name}；返回样本 ${sampleText()}`))
          return
        }
        resolve({ url, name, uploadResult: first })
      }
      const failed = error => {
        clearTimeout(timeout)
        cleanup()
        reject(new Error(error?.message || error?.errorCode || `图片上传失败：${name}`))
      }
      uploader.on('FileSuccess', remember)
      uploader.on('UploadComplete', done)
      uploader.on('UploadError', failed)
      uploader.addBase64File(dataUrl, name)
      uploader.start()
    })
  }

  async function resolveAndUploadMaterials(job) {
    const filesByName = getInjectedFilesByName()
    const cache = window.__MOP_DRESS_COLLOCATION_UPLOAD_CACHE__ = window.__MOP_DRESS_COLLOCATION_UPLOAD_CACHE__ || {}
    const materials = []
    for (const ref of job.materialRefs || []) {
      if (isRemoteImage(ref)) {
        materials.push({ ref, url: normalizeRemoteImageUrl(ref), width: TARGET_WIDTH, height: TARGET_HEIGHT, cropStatus: 'remote-not-recoded' })
        continue
      }
      if (cache[ref]) {
        materials.push({ ref, ...cache[ref], source: 'local-cache' })
        continue
      }
      const base = pathBasename(ref)
      const file = filesByName.get(base)
      if (!file) throw new Error(`本地图片未注入或文件名不匹配：${ref}`)
      const cropped = await cropFileToSafeThreeFourDataUrl(file)
      const uploaded = await uploadDataUrlWithPageHelper(cropped.dataUrl, cropped.name)
      const stored = {
        url: uploaded.url,
        width: cropped.width,
        height: cropped.height,
        cropStatus: cropped.cropPlan.mode,
        cropPlan: cropped.cropPlan,
        source: 'local-upload-safe-3x4',
      }
      cache[ref] = stored
      materials.push({ ref, ...stored })
    }
    return materials
  }

  function currentDraftIdFromLocation() {
    try {
      const url = new URL(String(location?.href || ''))
      return cleanText(url.searchParams.get('id') || '')
    } catch (error) {
      return ''
    }
  }

  function apiUrl(path, query = {}) {
    const url = new URL(path, SCENARIO_ORIGIN)
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && cleanText(value) !== '') url.searchParams.set(key, String(value))
    })
    return url.toString()
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json, text/plain, */*', ...(options.headers || {}) },
      ...options,
    })
    const text = await response.text()
    let payload = null
    try {
      payload = JSON.parse(text)
    } catch (error) {
      payload = { rawText: text }
    }
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}: ${cleanText(text).slice(0, 180)}`)
    if (payload?.success === false || payload?.code === 'FAIL') {
      throw new Error(payload?.message || payload?.msg || `${url} 返回失败`)
    }
    return payload
  }

  async function fetchJsonAllowBusinessFailure(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json, text/plain, */*', ...(options.headers || {}) },
      ...options,
    })
    const text = await response.text()
    let payload = null
    try {
      payload = JSON.parse(text)
    } catch (error) {
      payload = { rawText: text }
    }
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}: ${cleanText(text).slice(0, 180)}`)
    return payload
  }

  function unwrapData(payload) {
    if (!payload || typeof payload !== 'object') return payload
    return payload.data?.data || payload.data?.result || payload.data || payload.result || payload.model || payload
  }

  async function queryDraftById(id) {
    if (!id) return null
    const payload = await fetchJson(apiUrl('/api/collocate/queryById', { scuId: id }))
    return unwrapData(payload)
  }

  function flattenListPayload(value) {
    if (!value) return []
    if (Array.isArray(value)) return value
    for (const key of ['list', 'records', 'items', 'data']) {
      const nested = value[key]
      if (Array.isArray(nested)) return nested
      const nestedList = flattenListPayload(nested)
      if (nestedList.length) return nestedList
    }
    return []
  }

  function itemProductIds(item) {
    const text = JSON.stringify(item || {})
    return [...new Set((text.match(/\d{8,}/g) || []))]
  }

  function collocationMatchesJob(item, job, options = {}) {
    const title = cleanText(item?.title || item?.name || item?.shortTitle || item?.contentTitle || '')
    const ids = itemProductIds(item)
    const status = cleanText(item?.statusName || item?.statusDesc || item?.stateName || item?.status || '')
    const titleOk = title && job.title && title.includes(job.title)
    const idsOk = job.productIds.every(id => ids.includes(id))
    const draftOk = !status || DRAFT_STATUS_RE.test(status) || String(item?.status ?? '').includes('0')
    return (titleOk || idsOk) && (!options.requireDraft || draftOk)
  }

  function draftMatchesJob(item, job) {
    return collocationMatchesJob(item, job, { requireDraft: true })
  }

  function collocationIdFromItem(item) {
    return cleanText(item?.scuId || item?.id || item?.collocateId || item?.collocationId)
  }

  async function findCollocationForJob(job, options = {}) {
    if (job.draftId) return { id: job.draftId, source: 'param-or-url' }
    const requireDraft = options.requireDraft !== false
    const candidates = [
      apiUrl('/api/collocate/list', { page: 1, pageSize: 20, status: 0 }),
      apiUrl('/api/collocate/list', { pageNo: 1, pageSize: 20, status: 0 }),
      apiUrl('/api/collocate/list', { page: 1, pageSize: 50 }),
      apiUrl('/api/collocate/list', { pageNo: 1, pageSize: 50 }),
    ]
    for (const url of candidates) {
      try {
        const payload = await fetchJson(url)
        const list = flattenListPayload(unwrapData(payload))
        const matched = list.find(item => collocationMatchesJob(item, job, { requireDraft }))
        const id = collocationIdFromItem(matched)
        if (matched) {
          return { id, item: matched, source: url, draft: requireDraft }
        }
      } catch (error) {
        window.__MOP_DRESS_COLLOCATION_LAST_LIST_ERROR__ = String(error?.message || error)
      }
    }
    return null
  }

  async function findDraftForJob(job) {
    return findCollocationForJob(job, { requireDraft: true })
  }

  async function findPublishCollocationForJob(job) {
    return (await findCollocationForJob(job, { requireDraft: true })) ||
      (await findCollocationForJob(job, { requireDraft: false }))
  }

  function firstExistingArray(record, keys) {
    for (const key of keys) {
      if (Array.isArray(record?.[key])) return record[key]
    }
    return []
  }

  function buildPictureList(record, materials) {
    const existing = firstExistingArray(record, ['normalImgList', 'pics', 'pictures', 'images', 'picList', 'materialList'])
    return materials.map((material, index) => ({
      ...(existing[index] && typeof existing[index] === 'object' ? existing[index] : {}),
      imgUrl: material.url,
      url: material.url,
      picUrl: material.url,
      imageUrl: material.url,
      width: material.width || TARGET_WIDTH,
      height: material.height || TARGET_HEIGHT,
      pix: `${material.width || TARGET_WIDTH}x${material.height || TARGET_HEIGHT}`,
      type: existing[index]?.type || 'anchor',
      anchors: existing[index]?.anchors || [],
      sort: index,
    }))
  }

  function buildItemList(record, job) {
    const existing = firstExistingArray(record, ['items', 'itemList', 'products', 'productList', 'goodsList'])
    return job.productIds.map((id, index) => {
      const old = existing.find(item => String(item?.itemId || item?.id || item?.productId || '').includes(id)) || existing[index] || {}
      const baseAnchor = job.anchors[index] || defaultAnchors(job.productIds)[index]
      const titleRole = classifyGarmentRole([old.label, old.rawTitle, old.title].filter(Boolean).join(' '))
      const anchor = baseAnchor?.garmentRole && baseAnchor.roleSource !== 'row-copy'
        ? baseAnchor
        : applyGarmentRoleToAnchor(baseAnchor, titleRole, titleRole ? 'item-title' : '')
      return {
        ...old,
        itemId: id,
        productId: id,
        id: old.id,
        itemUrl: old.itemUrl || `//item.taobao.com/item.htm?id=${id}`,
        coverUrl: old.coverUrl || old.picUrl || '',
        rawTitle: old.rawTitle || old.title || '',
        x: old.x ?? anchor.x,
        y: old.y ?? anchor.y,
        anchorX: old.anchorX ?? anchor.x,
        anchorY: old.anchorY ?? anchor.y,
        label: anchor.text || anchor.role || old.label || '',
      }
    })
  }

  function buildDraftScuPayload(record, job, materials) {
    const id = cleanText(record?.scuId || record?.id || record?.collocateId || record?.collocationId || job.draftId)
    const items = buildItemList(record, job)
    const existingImages = firstExistingArray(record, ['normalImgList'])
    const fallbackAnchors = defaultAnchors(job.productIds)
    const normalImgList = materials.map((material, imageIndex) => {
      const existing = existingImages[imageIndex] || {}
      const existingAnchors = Array.isArray(existing.anchors) ? existing.anchors : []
      const anchors = (existingAnchors.length ? existingAnchors : items.map((item, index) => {
        const anchor = job.anchors[index] || fallbackAnchors[index] || {}
        const x = Number(item.x ?? item.anchorX ?? anchor.x ?? 0.5)
        const y = Number(item.y ?? item.anchorY ?? anchor.y ?? Math.min(0.82, 0.38 + index * 0.18))
        return {
          x: Number((x * 100).toFixed(2)),
          y: Number((y * 100).toFixed(2)),
          itemId: item.itemId,
          itemUrl: item.itemUrl || `//item.taobao.com/item.htm?id=${item.itemId}`,
          coverUrl: item.coverUrl || item.picUrl || '',
          rawTitle: item.rawTitle || item.title || '',
          title: item.label || anchor.text || anchor.role || item.title || '',
          type: 'item',
        }
      })).map((anchor, index) => {
        const matched = items.find(item => String(item.itemId) === String(anchor.itemId)) || items[index] || {}
        const roleTitle = cleanText(matched.label || '')
        return {
          x: anchor.x,
          y: anchor.y,
          direction: anchor.direction ?? null,
          title: roleTitle || anchor.title || anchor.tagName || matched.title || '',
          rawTitle: anchor.rawTitle || matched.rawTitle || matched.title || '',
          itemId: anchor.itemId || matched.itemId,
          itemUrl: anchor.itemUrl || matched.itemUrl || `//item.taobao.com/item.htm?id=${anchor.itemId || matched.itemId || ''}`,
          coverUrl: anchor.coverUrl || matched.coverUrl || matched.picUrl || '',
          images: anchor.images ?? null,
          itemPrice: anchor.itemPrice ?? matched.price ?? matched.icPrice ?? null,
          type: anchor.type || 'item',
        }
      }).filter(anchor => anchor.itemId)
      return {
        ...existing,
        imgUrl: material.url,
        type: existing.type || 'anchor',
        width: String(material.width || TARGET_WIDTH),
        height: String(material.height || TARGET_HEIGHT),
        pix: existing.pix || `${material.width || TARGET_WIDTH}x${material.height || TARGET_HEIGHT}`,
        url: material.url,
        anchors,
        size: material.size || existing.size || 0,
      }
    })
    const item916List = firstExistingArray(record, ['item916List']).length ? firstExistingArray(record, ['item916List']) : items
    const displayChannels = Array.isArray(record?.displayChannels) && record.displayChannels.length ? record.displayChannels : [1, 6, 7]
    const payload = {
      ...(record && typeof record === 'object' ? record : {}),
      id: undefined,
      title: job.title,
      name: job.title,
      description: job.description,
      items,
      itemList: items,
      normalImgList,
      item916List,
      normalImg916List: firstExistingArray(record, ['normalImg916List']),
      displayChannels,
      useAlgo: 0,
      displayType: 3,
      scuSource: record?.scuSource ?? 2,
      scuEntrySource: record?.scuEntrySource ?? 4,
    }
    if (id) payload.scuId = parseInteger(id, id)
    delete payload.id
    return payload
  }

  async function saveDraftViaDraftScu(record, job, materials) {
    const payload = buildDraftScuPayload(record, job, materials)
    const result = await fetchJson(apiUrl('/api/collocate/draftScu'), {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(payload),
    })
    return { result, payloadShape: 'draftScu', payload }
  }

  async function publishViaCreateScu(record, job, materials) {
    const payload = buildDraftScuPayload(record, job, materials)
    let precheck = null
    let precheckPassed = true
    let precheckNote = ''
    try {
      precheck = await fetchJson(apiUrl('/api/collocate/preCheck'), {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(payload),
      })
      if (precheck?.success === false || precheck?.data?.success === false) {
        precheckPassed = false
        precheckNote = cleanText(precheck?.message || precheck?.msg || precheck?.data?.message || '同商品组合发布前校验提示，按授权继续发布')
      }
    } catch (error) {
      precheckPassed = false
      precheckNote = `preCheck 异常，按页面逻辑继续发布：${cleanText(error?.message || error).slice(0, 160)}`
    }
    const result = await fetchJsonAllowBusinessFailure(apiUrl('/api/collocate/createScu'), {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ ...payload, skipSameItemCheck: true }),
    })
    const businessOk = !(result?.success === false || result?.data?.success === false)
    const contentId = businessOk ? cleanText(result?.data?.data || result?.data || result?.result || result?.model || '') : ''
    const businessMessage = cleanText(result?.message || result?.msg || result?.data?.message || result?.errorCode || '')
    return { result, precheck, precheckPassed, precheckNote, payloadShape: 'createScu', payload, contentId, businessOk, businessMessage }
  }

  function readVisibleDraftText() {
    const text = cleanText(document?.body?.innerText || '')
    return {
      titleVisible: params.title ? text.includes(cleanText(params.title)) : false,
      descriptionVisible: params.description ? text.includes(cleanText(params.description)) : false,
      textSample: text.slice(0, 500),
    }
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, Number(ms || 0)))
  }

  function visibleRect(el) {
    const r = el?.getBoundingClientRect?.()
    if (!r) return null
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
  }

  function centerOfRect(rect) {
    if (!rect) return null
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
  }

  function selectorIframeRect() {
    if (typeof document === 'undefined') return null
    const iframe = Array.from(document.querySelectorAll('iframe'))
      .find(item => SELECTOR_IFRAME_RE.test(String(item.src || '')))
    return iframe ? visibleRect(iframe) : null
  }

  function selectorPoint(localX, localY) {
    const rect = selectorIframeRect()
    if (!rect) return null
    return { x: Math.round(rect.x + Number(localX || 0)), y: Math.round(rect.y + Number(localY || 0)) }
  }

  function preparedLocalMaterials(uploadResult = shared.prepared_image_files) {
    const result = uploadResult && typeof uploadResult === 'object' ? uploadResult : {}
    return Array.isArray(result.items) ? result.items.filter(item => item?.success && item.path) : []
  }

  function buildApiUploadExpression(preparedItems) {
    const seed = (preparedItems || []).map(item => ({
      ref: cleanText(item.sourcePath || item.ref || item.path || ''),
      path: cleanText(item.path || ''),
      name: cleanText(item.name || pathBasename(item.path || item.sourcePath || 'mop-dress-collocation.jpg')),
      mime: cleanText(item.mime || 'image/jpeg'),
      dataUrl: cleanText(item.dataUrl || ''),
      width: item.width || TARGET_WIDTH,
      height: item.height || TARGET_HEIGHT,
      cropStatus: cleanText(item.cropStatus || ''),
      preservesFullSubject: item.preservesFullSubject !== false,
    }))
    return `
(async () => {
  const items = ${JSON.stringify(seed)};
  const endpoint = ${JSON.stringify(PICTURE_CENTER_UPLOAD_ENDPOINT)};
  const cleanText = value => String(value ?? '').replace(/\\s+/g, ' ').trim();
  const getCookie = name => {
    const escaped = String(name).replace(/([.*+?^=!:()|[\\]\\\\])/g, '\\\\$1');
    const match = String(document.cookie || '').match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  };
  const normalizeRemote = value => {
    const text = cleanText(value);
    if (!text) return '';
    if (text.startsWith('//')) return 'https:' + text;
    if (/^https?:\\/\\//i.test(text)) return text;
    if (/^(?:imgextra|bao\\/uploaded)\\//i.test(text)) return 'https://img.alicdn.com/' + text;
    return '';
  };
  const findUrl = (value, depth = 0) => {
    if (value == null || depth > 7) return '';
    if (typeof value === 'string') return normalizeRemote(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const url = findUrl(item, depth + 1);
        if (url) return url;
      }
      return '';
    }
    if (typeof value !== 'object') return '';
    for (const key of ['fullUrl', 'url', 'imageUrl', 'ossUrl', 'cdnUrl', 'path', 'picUrl', 'pictureUrl']) {
      const url = findUrl(value[key], depth + 1);
      if (url) return url;
    }
    for (const item of Object.values(value)) {
      const url = findUrl(item, depth + 1);
      if (url) return url;
    }
    return '';
  };
  const dataUrlToBlob = async dataUrl => {
    if (!String(dataUrl || '').startsWith('data:')) throw new Error('预处理图片缺少 dataUrl，无法 API 上传');
    const parts = String(dataUrl).split(',');
    const meta = parts.shift() || '';
    const body = parts.join(',');
    const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    if (!body) throw new Error('预处理图片 dataUrl 内容为空');
    const binary = meta.includes(';base64') ? atob(body) : decodeURIComponent(body);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mime });
  };
  const uploaded = [];
  const errors = [];
  for (const item of items) {
    try {
      if (!item.dataUrl) throw new Error('预处理图片缺少 dataUrl');
      const query = new URLSearchParams({
        _input_charset: 'utf-8',
        appkey: 'tu',
        folderId: '0',
        picCompress: 'false',
        watermark: 'false',
      });
      const form = new FormData();
      form.append('water', 'false');
      form.append('name', item.name || 'mop-dress-collocation-3x4.jpg');
      form.append('_tb_token_', getCookie('_tb_token_'));
      form.append('file', await dataUrlToBlob(item.dataUrl), item.name || 'mop-dress-collocation-3x4.jpg');
      const response = await fetch(endpoint + '?' + query.toString(), {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : {}; } catch (error) { payload = { rawText: text }; }
      if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + cleanText(text).slice(0, 180));
      if (!payload || payload.success === false) throw new Error(payload?.message || payload?.msg || 'upload success=false');
      const url = normalizeRemote(payload?.object?.url || findUrl(payload));
      if (!url) throw new Error('上传接口未返回 URL');
      uploaded.push({
        ref: item.ref || item.path || item.name,
        path: item.path,
        name: item.name,
        url,
        fileId: cleanText(payload?.object?.fileId || ''),
        folderId: cleanText(payload?.object?.folderId || ''),
        pixel: cleanText(payload?.object?.pix || ''),
        size: payload?.object?.size || item.size || '',
        width: item.width || 750,
        height: item.height || 1000,
        cropStatus: item.cropStatus || 'api-upload-safe-3x4',
        preservesFullSubject: item.preservesFullSubject !== false,
        source: 'local-upload-api-stream-upload',
      });
    } catch (error) {
      errors.push({ ref: item.ref || item.path || item.name, error: cleanText(error?.message || error) });
    }
  }
  return {
    ok: errors.length === 0 && uploaded.length === items.length,
    endpoint,
    total: items.length,
    uploaded,
    errors,
  };
})()
`.trim()
  }

  function selectedLocalUploadedMaterials() {
    const apiResult = shared.api_upload_result?.value || shared.api_upload_result || {}
    if (Array.isArray(apiResult.uploaded) && apiResult.uploaded.length) return apiResult.uploaded
    if (Array.isArray(shared.materials) && shared.materials.length) return shared.materials
    if (Array.isArray(shared.selected_materials) && shared.selected_materials.length) return shared.selected_materials
    return []
  }

  function applyApiUploadResult(job = shared.job || normalizeJob(params)) {
    const evalResult = shared.api_upload_result || {}
    const value = evalResult.value || {}
    if (evalResult.ok !== true) {
      throw new Error(`API 上传执行失败：${cleanText(evalResult.error || 'cdp_target_eval 未成功')}`)
    }
    if (value.ok !== true || !Array.isArray(value.uploaded) || !value.uploaded.length) {
      const errors = Array.isArray(value.errors) ? value.errors.map(item => cleanText(item.error)).filter(Boolean).join('；') : ''
      throw new Error(`API 上传未返回完整成功结果：${errors || JSON.stringify(value).slice(0, 240)}`)
    }
    const prepared = preparedLocalMaterials()
    if (value.uploaded.length < prepared.length) {
      throw new Error(`API 上传数量不足：${value.uploaded.length}/${prepared.length}`)
    }
    return value.uploaded.map((item, index) => ({
      ref: item.ref || prepared[index]?.sourcePath || prepared[index]?.path || item.url,
      url: normalizeRemoteImageUrl(item.url),
      width: item.width || TARGET_WIDTH,
      height: item.height || TARGET_HEIGHT,
      cropStatus: item.cropStatus || prepared[index]?.cropStatus || 'api-upload-safe-3x4',
      cropPlan: redactImageDataUrlFields(prepared[index] || null),
      fileId: item.fileId || '',
      folderId: item.folderId || '',
      pixel: item.pixel || '',
      source: item.source || 'local-upload-api-stream-upload',
    })).filter(item => item.url)
  }

  function findPrimarySelectedDressImages() {
    if (typeof document === 'undefined') return []
    return Array.from(document.querySelectorAll('img'))
      .map((el, index) => {
        const src = normalizeRemoteImageUrl(el.currentSrc || el.src || '')
        const width = Number(el.naturalWidth || 0)
        const height = Number(el.naturalHeight || 0)
        return {
          index,
          url: src,
          width,
          height,
          ratio: width > 0 && height > 0 ? Number((width / height).toFixed(4)) : 0,
          alt: cleanText(el.alt || ''),
          className: cleanText(el.className || ''),
          rect: visibleRect(el),
          source: 'selector-ui-return',
        }
      })
      .filter(item => item.url && item.width >= TARGET_WIDTH && item.height >= TARGET_HEIGHT)
      .filter(item => Math.abs(item.ratio - 0.75) < 0.03)
      .filter(item => /商品图片|TaggedImageLite_backgroundImg|打点底图/i.test(`${item.alt} ${item.className}`))
  }

  function findExistingDressImages() {
    if (typeof document === 'undefined') return []
    return Array.from(document.querySelectorAll('img'))
      .map((el, index) => {
        const width = Number(el.naturalWidth || 0)
        const height = Number(el.naturalHeight || 0)
        const src = normalizeRemoteImageUrl(el.currentSrc || el.src || '')
        const ratio = width > 0 && height > 0 ? width / height : 0
        return {
          index,
          url: src,
          width,
          height,
          ratio: Number(ratio.toFixed(4)),
          alt: cleanText(el.alt || ''),
          className: cleanText(el.className || ''),
          rect: visibleRect(el),
        }
      })
      .filter(item => item.url && item.width >= TARGET_WIDTH && item.height >= TARGET_HEIGHT)
      .filter(item => Math.abs(item.ratio - 0.75) < 0.03)
      .filter(item => /TaggedImageLite_backgroundImg|RecommendCard_imageLong|打点底图|imgextra/i.test(`${item.className} ${item.alt} ${item.url}`))
  }

  function setInputValue(el, value) {
    if (!el) return false
    const nextValue = String(value ?? '')
    const proto = Object.getPrototypeOf(el)
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
    if (descriptor?.set) descriptor.set.call(el, nextValue)
    else el.value = nextValue
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }

  function fillDraftTextareas(job) {
    const textareas = Array.from(document.querySelectorAll('textarea'))
      .filter(el => !el.disabled)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
    const titleOk = setInputValue(textareas[0], job.title)
    const descOk = setInputValue(textareas[1], job.description)
    return {
      titleOk,
      descOk,
      titleValue: cleanText(textareas[0]?.value || ''),
      descriptionValue: cleanText(textareas[1]?.value || ''),
    }
  }

  function findButtonByText(text) {
    const target = cleanText(text)
    return Array.from(document.querySelectorAll('button,[role=button],a'))
      .find(el => cleanText(el.innerText || el.textContent || el.getAttribute('aria-label') || el.title || '') === target)
  }

  function findClickableByText(text, options = {}) {
    const target = cleanText(text)
    const exact = options.exact !== false
    const candidates = Array.from(document.querySelectorAll('button,[role=button],a,label,div,span'))
      .filter(el => visibleRect(el))
    return candidates.find(el => {
      const value = cleanText(el.innerText || el.textContent || el.getAttribute?.('aria-label') || el.title || '')
      return exact ? value === target : value.includes(target)
    })
  }

  function findVisibleActionByText(text, options = {}) {
    const target = cleanText(text)
    const exact = options.exact !== false
    const selectors = options.selectors || 'button,[role=button],a'
    const candidates = Array.from(document.querySelectorAll(selectors))
      .map(el => ({
        el,
        text: cleanText(el.innerText || el.textContent || el.getAttribute?.('aria-label') || el.title || ''),
        rect: visibleRect(el),
        primary: String(el.tagName || '').toUpperCase() === 'BUTTON' || el.getAttribute?.('role') === 'button',
      }))
      .filter(item => item.rect && item.rect.width > 0 && item.rect.height > 0)
      .filter(item => exact ? item.text === target : item.text.includes(target))
      .sort((a, b) => {
        if (a.primary !== b.primary) return a.primary ? -1 : 1
        const areaA = a.rect.width * a.rect.height
        const areaB = b.rect.width * b.rect.height
        return areaA - areaB
      })
    return candidates[0]?.el || null
  }

  function findAddDressImageButton() {
    return findVisibleActionByText('更换搭配图片', { selectors: 'button,[role=button],a' }) ||
      findVisibleActionByText('添加搭配图', { selectors: 'button,[role=button],a,div,span' }) ||
      findVisibleActionByText('添加搭配图片', { selectors: 'button,[role=button],a,div,span' })
  }

  function selectorIframeVisible() {
    return Boolean(selectorIframeRect())
  }

  function selectorTextIncludes(pattern) {
    if (typeof document === 'undefined') return false
    const text = cleanText(document.body?.innerText || '')
    if (pattern instanceof RegExp) return pattern.test(text)
    return text.includes(cleanText(pattern))
  }

  function selectedSelectorClick(localX, localY) {
    const point = selectorPoint(localX, localY)
    return point ? [point] : []
  }

  function selectorUploadInputClick() {
    return selectedSelectorClick(530, 247)
  }

  function selectorFinishUploadClick() {
    return selectedSelectorClick(1002, 666)
  }

  function selectorFirstUploadedTileClick() {
    return selectedSelectorClick(265, 203)
  }

  function selectorConfirmClick() {
    return selectedSelectorClick(982, 678)
  }

  function materialUrlFingerprint(url) {
    const text = cleanText(url)
    const match = text.match(/\/(O1CN[^/?_]+)[^/]*\.(?:jpg|jpeg|png|webp)/i)
    return match ? match[1] : text.replace(/[?#].*$/, '')
  }

  function uniqueMaterials(items) {
    const seen = new Set()
    const result = []
    for (const item of items || []) {
      const url = normalizeRemoteImageUrl(item?.url || '')
      if (!url) continue
      const key = materialUrlFingerprint(url)
      if (seen.has(key)) continue
      seen.add(key)
      result.push({ ...item, url })
    }
    return result
  }

  function findReturnedLocalUploadMaterials() {
    const before = new Set((shared.before_material_urls || []).map(materialUrlFingerprint))
    const names = preparedLocalMaterials().map(item => pathBasename(item.sourcePath || item.path || '')).filter(Boolean)
    const candidates = uniqueMaterials(findPrimarySelectedDressImages())
      .filter(item => !before.has(materialUrlFingerprint(item.url)))
    if (candidates.length) {
      return candidates.map((item, index) => ({
        ref: names[index] || item.url,
        ...item,
        cropStatus: preparedLocalMaterials()[index]?.cropStatus || 'selector-ui-return',
        source: 'local-upload-sucai-selector',
      }))
    }
    return []
  }

  function localUploadReady() {
    const prepared = preparedLocalMaterials()
    const chooser = shared.file_chooser_upload_result || {}
    const chooserOk = chooser.ok === true && Array.isArray(chooser.items) && chooser.items.every(item => item.success)
    return prepared.length > 0 && chooserOk
  }

  function selectorBodyHasUploadedNames() {
    const text = cleanText(document?.body?.innerText || '')
    const prepared = preparedLocalMaterials()
    if (!prepared.length) return false
    return prepared.some(item => text.includes(pathBasename(item.sourcePath || item.path || '').slice(0, 44)) || text.includes(pathBasename(item.path || '').slice(0, 44)))
  }

  async function saveDraftViaDom(job) {
    if (typeof document === 'undefined') throw new Error('当前页面没有 document，无法保存草稿')
    const materials = findExistingDressImages()
    if (!materials.length) {
      throw new Error('页面没有可沿用的 750x1000 搭配图，无法执行 DOM 草稿保存兜底')
    }
    const filled = fillDraftTextareas(job)
    const saveButton = findButtonByText('保存草稿')
    if (!saveButton) throw new Error('没有找到“保存草稿”按钮')
    saveButton.scrollIntoView?.({ block: 'center', inline: 'center' })
    saveButton.click()
    await wait(2500)
    const text = cleanText(document.body?.innerText || '')
    return {
      materials,
      filled,
      buttonRect: visibleRect(saveButton),
      titleOk: !job.title || text.includes(job.title) || filled.titleValue === job.title,
      descOk: !job.description || text.includes(job.description) || filled.descriptionValue === job.description,
      idsOk: (job.productIds || []).every(id => text.includes(id) || JSON.stringify(document.body?.innerText || '').includes(id)),
      statusText: text.includes('草稿') ? '页面包含草稿文案' : '',
      visible: readVisibleDraftText(),
    }
  }

  function planRow(job, errors = []) {
    const cropPlans = (job.materialRefs || []).map(ref => ({
      ref,
      targetWidth: TARGET_WIDTH,
      targetHeight: TARGET_HEIGHT,
      targetRatio: '3:4',
      strategy: 'contain-with-soft-background',
      preservesFullSubject: true,
    }))
    return outputRow(job, {
      status: errors.length ? '预检失败' : '预检通过',
      cropMode: '3:4安全切图',
      note: errors.length ? errors.join('；') : `计划上传 ${job.materialRefs.length} 张 3:4 安全图，${isPublishMode(job) ? '真实发布内容' : '保存草稿，不发布'}`,
      materials: cropPlans,
    })
  }

  async function runMainPhase() {
    if (hasInputRows(params)) return runBatchMainPhase()
    const job = normalizeJob(params)
    const errors = validateJob(job)
    const preview = planRow(job, errors)
    if (!isLiveMode(job)) {
      return complete([preview], { ...shared, job, results: [preview] })
    }
    if (errors.length) return complete([preview], { ...shared, job, results: [preview] })

    const localRefs = job.materialRefs.filter(ref => !isRemoteImage(ref))
    if (localRefs.length) {
      const beforeMaterials = findPrimarySelectedDressImages()
      return prepareImageFiles(localRefs.map(path => ({ path })), 'api_upload_materials', 0, {
        ...shared,
        job,
        before_material_urls: beforeMaterials.map(item => item.url),
        results: [],
      })
    }
    return nextPhase(isPublishMode(job) ? 'publish_content' : 'save_draft', 0, { ...shared, job, results: [] })
  }

  async function runBatchMainPhase() {
    const jobs = normalizeBatchJobs(params)
    if (!jobs.length) {
      return complete([outputRow({}, { status: '预检失败', note: 'Excel 没有可执行数据行' })], shared)
    }
    const assessed = jobs.map(job => ({ job, errors: validateJob(job) }))
    const previewRows = assessed.map(item => planRow(item.job, item.errors))
    if (params.execute_mode !== 'live_publish') {
      return complete(previewRows, {
        ...shared,
        total_rows: previewRows.length,
        results: previewRows,
      })
    }
    const validJobs = assessed.filter(item => !item.errors.length).map(item => item.job)
    const invalidRows = assessed.filter(item => item.errors.length).map(item => planRow(item.job, item.errors))
    if (!validJobs.length) {
      return complete(previewRows, {
        ...shared,
        total_rows: previewRows.length,
        results: previewRows,
      })
    }
    return nextPhase('process_batch_row', 0, buildBatchShared(validJobs, previewRows, {
      executeMode: 'live_publish',
      submitDelayMs: params.submit_delay_ms,
      initialResults: invalidRows,
    }))
  }

  async function runProcessBatchRowPhase() {
    const jobs = Array.isArray(shared.jobs) ? shared.jobs : []
    const index = Number(shared.job_index || 0)
    const job = jobs[index]
    if (!job) {
      return complete(shared.results || [], {
        ...shared,
        prepared_image_files: withoutPreparedImageDataUrls(shared.prepared_image_files),
      })
    }
    const errors = validateJob(job)
    if (errors.length) {
      const row = planRow(job, errors)
      return nextPhase('process_batch_row', shared.submit_delay_ms || 0, finishBatchJob(row, {
        ...shared,
        job,
      }))
    }
    const localRefs = job.materialRefs.filter(ref => !isRemoteImage(ref))
    if (localRefs.length) {
      const beforeMaterials = findPrimarySelectedDressImages()
      return prepareImageFiles(localRefs.map(path => ({ path })), 'api_upload_materials', 0, {
        ...shared,
        job,
        before_material_urls: beforeMaterials.map(item => item.url),
      })
    }
    return nextPhase('publish_content', 0, {
      ...shared,
      job,
      selected_materials: [],
      materials: [],
    })
  }

  async function runOpenMaterialSelectorPhase() {
    const job = shared.job || normalizeJob(params)
    if (selectorIframeVisible()) return nextPhase('open_local_upload_panel', 0, { ...shared, job })
    const addButton = findAddDressImageButton()
    const point = centerOfRect(visibleRect(addButton))
    if (!point) return fail('没有找到“添加搭配图/更换搭配图片”入口，无法上传真实图片')
    return cdpClicks([point], 'open_local_upload_panel', 1600, { ...shared, job })
  }

  async function runApiUploadMaterialsPhase() {
    const job = shared.job || normalizeJob(params)
    const prepared = preparedLocalMaterials()
    if (!prepared.length) return fail('3:4 预处理图片缺失，无法 API 上传')
    const missingDataUrl = prepared.find(item => !item.dataUrl)
    if (missingDataUrl) return fail(`预处理图片缺少 dataUrl，无法 API 上传：${missingDataUrl.path || missingDataUrl.sourcePath || ''}`)
    return cdpTargetEval(
      buildApiUploadExpression(prepared),
      'apply_api_upload_result',
      {
        targetUrlContains: ['https://qn.taobao.com/home.htm/material-center/material-management'],
        targetTypes: ['page'],
        sharedKey: 'api_upload_result',
        sleepMs: 500,
      },
      { ...shared, job },
    )
  }

  async function runApplyApiUploadResultPhase() {
    const job = shared.job || normalizeJob(params)
    try {
      const materials = applyApiUploadResult(job)
      if (!materials.length) return fail('API 上传成功结果里没有可用图片 URL')
      return nextPhase(isPublishMode(job) ? 'publish_content' : 'save_draft', 0, {
        ...shared,
        job,
        selected_materials: materials,
        materials,
      })
    } catch (error) {
      return fail(cleanText(error?.message || error))
    }
  }

  async function runOpenLocalUploadPanelPhase() {
    const job = shared.job || normalizeJob(params)
    if (!selectorIframeVisible()) return fail('素材选择器 iframe 未打开，无法继续本地上传')
    if (selectorTextIncludes('上传结果') && selectorTextIncludes(/文件上传成功|上传成功/)) {
      return nextPhase('finish_upload_panel', 0, { ...shared, job })
    }
    if (selectorBodyHasUploadedNames()) {
      return nextPhase('select_uploaded_material', 0, { ...shared, job })
    }
    const point = selectorPoint(968, 100)
    if (!point) return fail('无法定位素材选择器“本地上传”按钮')
    return cdpClicks([point], 'upload_local_files', 1000, { ...shared, job })
  }

  async function runUploadLocalFilesPhase() {
    const job = shared.job || normalizeJob(params)
    const prepared = preparedLocalMaterials()
    if (!prepared.length) return fail('3:4 预处理图片缺失，无法打开原生文件选择器上传')
    if (selectorTextIncludes('上传结果') && selectorTextIncludes(/文件上传成功|上传成功/)) {
      return nextPhase('finish_upload_panel', 0, { ...shared, job })
    }
    if (selectorBodyHasUploadedNames()) {
      return nextPhase('select_uploaded_material', 0, { ...shared, job })
    }
    const clicks = selectorUploadInputClick()
    if (!clicks.length) return fail('无法定位素材选择器上传文件输入区域')
    return fileChooserUpload([{
      label: 'MOP 搭配素材本地图片上传',
      clicks,
      files: prepared.map(item => item.path),
      timeout_ms: 15000,
      settle_ms: 1200,
    }], 'finish_upload_panel', 2500, { ...shared, job })
  }

  async function runFinishUploadPanelPhase() {
    const job = shared.job || normalizeJob(params)
    if (!localUploadReady() && !selectorTextIncludes(/文件上传成功|上传成功/)) {
      return fail('原生文件选择器上传未成功，无法完成上传结果面板')
    }
    const clicks = selectorFinishUploadClick()
    if (!clicks.length) return fail('无法定位上传结果“完成”按钮')
    return cdpClicks(clicks, 'select_uploaded_material', 2500, { ...shared, job })
  }

  async function runSelectUploadedMaterialPhase() {
    const job = shared.job || normalizeJob(params)
    if (!selectorIframeVisible()) return fail('上传结果完成后素材选择器已关闭，未能选择上传图片')
    if (!selectorBodyHasUploadedNames()) return fail('素材选择器列表未显示刚上传的文件，无法确认真实图片')
    const clicks = selectorFirstUploadedTileClick()
    if (!clicks.length) return fail('无法定位刚上传图片的素材卡片')
    return cdpClicks(clicks, 'confirm_material_selector', 1000, { ...shared, job })
  }

  async function runConfirmMaterialSelectorPhase() {
    const job = shared.job || normalizeJob(params)
    const clicks = selectorConfirmClick()
    if (!clicks.length) return fail('无法定位素材选择器底部“确定”按钮')
    return cdpClicks(clicks, 'save_anchor_dialog', 2500, { ...shared, job })
  }

  async function runSaveAnchorDialogPhase() {
    const job = shared.job || normalizeJob(params)
    if (selectorIframeVisible()) return fail('素材选择器确认后仍未关闭，真实图片未回填到主编辑页')
    const returned = findReturnedLocalUploadMaterials()
    if (!returned.length) {
      return fail('真实上传图片未在主编辑页回填；拒绝沿用页面旧图保存')
    }
    const saveButton = findClickableByText('保存')
    const point = centerOfRect(visibleRect(saveButton))
    if (point && cleanText(saveButton?.innerText || saveButton?.textContent || '') === '保存') {
      return cdpClicks([point], 'save_draft', 1200, {
        ...shared,
        job,
        selected_materials: returned,
        materials: returned,
      })
    }
    return nextPhase('save_draft', 0, {
      ...shared,
      job,
      selected_materials: returned,
      materials: returned,
    })
  }

  async function runSaveDraftPhase() {
    const job = shared.job || normalizeJob(params)
    const expectsLocalUpload = (job.materialRefs || []).some(ref => !isRemoteImage(ref))
    let materials = []
    let saved = null
    let readback = null
    let readbackText = ''
    let titleOk = false
    let descOk = false
    let idsOk = false
    let urlsOk = false
    let visible = {}
    let status = ''
    let noteParts = []
    let draftId = job.draftId
    try {
      materials = expectsLocalUpload ? selectedLocalUploadedMaterials() : await resolveAndUploadMaterials(job)
      if (expectsLocalUpload && !materials.length) {
        throw new Error('真实本地图片尚未通过素材选择器上传并回填，拒绝沿用页面旧图')
      }
      const found = await findDraftForJob(job)
      if (!found?.id) {
        throw new Error('未找到可更新的搭配素材草稿；请先在千牛创建草稿或传入 draft_id')
      }
      draftId = found.id
      const record = await queryDraftById(found.id)
      saved = await saveDraftViaDraftScu(record || { scuId: found.id }, { ...job, draftId: found.id }, materials)
      readback = await queryDraftById(found.id)
      readbackText = JSON.stringify(readback || {})
      titleOk = !job.title || readbackText.includes(job.title)
      descOk = !job.description || readbackText.includes(job.description)
      idsOk = job.productIds.every(id => readbackText.includes(id))
      urlsOk = materials.every(material => readbackText.includes(material.url))
      visible = typeof document !== 'undefined' ? readVisibleDraftText() : {}
      status = titleOk && descOk && idsOk ? '草稿保存成功' : '草稿已提交但读回不完整'
      noteParts = [
        `payload=${saved.payloadShape}`,
        titleOk ? '标题已读回' : '标题未读回',
        descOk ? '文案已读回' : '文案未读回',
        idsOk ? '商品已读回' : '商品未读回',
        urlsOk ? '图片URL已读回' : '图片URL未完全读回',
      ]
    } catch (error) {
      if (expectsLocalUpload) {
        throw new Error(`真实图片上传/保存未完成：${cleanText(error?.message || error)}`)
      }
      const domSaved = await saveDraftViaDom(job)
      materials = domSaved.materials
      titleOk = domSaved.titleOk
      descOk = domSaved.descOk
      idsOk = domSaved.idsOk
      urlsOk = true
      visible = domSaved.visible
      status = titleOk && descOk ? '草稿保存成功（沿用页面已有3:4图）' : '草稿保存后页面读回不完整'
      noteParts = [
        `DOM兜底保存`,
        `上传/API路径未完成：${cleanText(error?.message || error).slice(0, 160)}`,
        `页面已有合规图 ${materials.length} 张`,
        titleOk ? '标题已读回' : '标题未读回',
        descOk ? '文案已读回' : '文案未读回',
      ]
    }
    const ok = titleOk && descOk && idsOk
    const row = outputRow({ ...job, draftId }, {
      draftId,
      materials,
      status,
      cropMode: '3:4安全切图',
      note: noteParts.join('；'),
    })
    return complete([row], {
      ...shared,
      prepared_image_files: withoutPreparedImageDataUrls(),
      job: { ...job, draftId },
      materials,
      draft_id: draftId,
      readback: { titleOk, descOk, idsOk, urlsOk, visible },
      results: [row],
    })
  }

  async function runPublishContentPhase() {
    const job = shared.job || normalizeJob({ ...params, execute_mode: 'live_publish' })
    const expectsLocalUpload = (job.materialRefs || []).some(ref => !isRemoteImage(ref))
    let materials = []
    let published = null
    let readback = null
    let readbackText = ''
    let titleOk = false
    let descOk = false
    let idsOk = false
    let urlsOk = false
    let visible = {}
    let status = ''
    let noteParts = []
    let draftId = job.draftId
    let contentId = ''
    try {
      materials = expectsLocalUpload ? selectedLocalUploadedMaterials() : await resolveAndUploadMaterials(job)
      if (expectsLocalUpload && !materials.length) {
        throw new Error('真实本地图片尚未通过 API 上传，拒绝沿用页面旧图发布')
      }
      const found = await findPublishCollocationForJob(job)
      draftId = found?.id || ''
      const record = draftId ? await queryDraftById(draftId) : {}
      published = await publishViaCreateScu(record || (draftId ? { scuId: draftId } : {}), { ...job, draftId, executeMode: 'live_publish' }, materials)
      contentId = published.contentId || ''
      readback = await queryDraftById(contentId || draftId)
      readbackText = JSON.stringify(readback || {})
      titleOk = !job.title || readbackText.includes(job.title)
      descOk = !job.description || readbackText.includes(job.description)
      idsOk = job.productIds.every(id => readbackText.includes(id))
      urlsOk = materials.every(material => readbackText.includes(material.url))
      visible = typeof document !== 'undefined' ? readVisibleDraftText() : {}
      status = published.contentId && titleOk && descOk && idsOk ? '发布成功' : '发布失败'
      noteParts = [
        `payload=${published.payloadShape}`,
        found?.source ? `匹配已有搭配=${found.id}` : '新建图文搭配',
        published.precheckPassed ? 'preCheck通过' : `preCheck提示：${published.precheckNote || '已按授权继续'}`,
        published.contentId ? `发布内容ID=${contentId}` : `平台未返回发布内容ID：${published.businessMessage || '发布接口返回失败'}`,
        titleOk ? '标题已读回' : '标题未读回',
        descOk ? '文案已读回' : '文案未读回',
        idsOk ? '商品已读回' : '商品未读回',
        urlsOk ? '图片URL已读回' : '图片URL未完全读回',
      ].filter(Boolean)
    } catch (error) {
      const message = `真实发布未完成：${cleanText(error?.message || error)}`
      if (hasBatchRun(shared)) {
        const row = outputRow(job, {
          materials,
          status: '发布失败',
          cropMode: '3:4安全切图',
          note: message,
        })
        return nextPhase('process_batch_row', shared.submit_delay_ms || 0, finishBatchJob(row, {
          ...shared,
          job,
        }))
      }
      throw new Error(message)
    }
    const row = outputRow({ ...job, draftId }, {
      draftId,
      contentId,
      materials,
      status,
      cropMode: '3:4安全切图',
      note: noteParts.join('；'),
    })
    if (hasBatchRun(shared)) {
      return nextPhase('process_batch_row', shared.submit_delay_ms || 0, finishBatchJob(row, {
        ...shared,
        job: { ...job, draftId, executeMode: 'live_publish' },
        materials,
        draft_id: draftId,
        content_id: contentId,
        publish_result: {
          contentId,
          precheckPassed: Boolean(published?.precheckPassed),
          precheckNote: cleanText(published?.precheckNote || ''),
        },
        readback: { titleOk, descOk, idsOk, urlsOk, visible },
      }))
    }
    return complete([row], {
      ...shared,
      prepared_image_files: withoutPreparedImageDataUrls(),
      job: { ...job, draftId, executeMode: 'live_publish' },
      materials,
      draft_id: draftId,
      content_id: contentId,
      publish_result: {
        contentId,
        precheckPassed: Boolean(published?.precheckPassed),
        precheckNote: cleanText(published?.precheckNote || ''),
      },
      readback: { titleOk, descOk, idsOk, urlsOk, visible },
      results: [row],
    })
  }

  function exposeHelpers() {
    if (!testExports || typeof testExports !== 'object') return
    Object.assign(testExports, {
      cleanText,
      splitMultiValues,
      normalizeProductId,
      normalizeProductIds,
      normalizeImageRefs,
      normalizeMaterialRefs,
      stripDuplicateFolderSuffix,
      splitStyleCodesFromFolderName,
      normalizeStyleCode,
      directoryFileEntries,
      findCollocationImagesForJob,
      normalizeBatchJobs,
      buildSafeThreeFourPlan,
      defaultAnchors,
      normalizeJob,
      validateJob,
      outputRow,
      buildPictureList,
      buildItemList,
      buildDraftScuPayload,
      publishViaCreateScu,
      uploadDataUrlWithPageHelper,
      findExistingDressImages,
      findPrimarySelectedDressImages,
      materialUrlFingerprint,
    draftMatchesJob,
    itemProductIds,
      buildApiUploadExpression,
      applyApiUploadResult,
      TARGET_WIDTH,
      TARGET_HEIGHT,
      MAX_IMAGE_COUNT,
    })
  }

  exposeHelpers()

  if (phase === '__exports__') return complete([], shared)

  try {
    if (phase === 'main' || phase === 'init') return await runMainPhase()
    if (phase === 'process_batch_row') return await runProcessBatchRowPhase()
    if (phase === 'api_upload_materials') return await runApiUploadMaterialsPhase()
    if (phase === 'apply_api_upload_result') return await runApplyApiUploadResultPhase()
    if (phase === 'open_material_selector') return await runOpenMaterialSelectorPhase()
    if (phase === 'open_local_upload_panel') return await runOpenLocalUploadPanelPhase()
    if (phase === 'upload_local_files') return await runUploadLocalFilesPhase()
    if (phase === 'finish_upload_panel') return await runFinishUploadPanelPhase()
    if (phase === 'select_uploaded_material') return await runSelectUploadedMaterialPhase()
    if (phase === 'confirm_material_selector') return await runConfirmMaterialSelectorPhase()
    if (phase === 'save_anchor_dialog') return await runSaveAnchorDialogPhase()
    if (phase === 'save_draft') return await runSaveDraftPhase()
    if (phase === 'publish_content') return await runPublishContentPhase()
    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || error)
  }
})()
