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

  function dirnameParts(path) {
    return cleanText(path).replace(/\\/g, '/').split('/').filter(Boolean)
  }

  function findProductIdFromPath(path) {
    const parts = dirnameParts(path)
    const base = parts[parts.length - 1] || ''
    const parent = parts[parts.length - 2] || ''
    return normalizeProductId(base) || normalizeProductId(parent) || ''
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

  function groupSelectedImagesByProduct(paths) {
    const grouped = {}
    for (const path of paths || []) {
      const productId = findProductIdFromPath(path)
      if (!productId) continue
      grouped[productId] = grouped[productId] || []
      grouped[productId].push(path)
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
    const refs = splitMultiValues(getRowValue(row, ['素材图片', '素材图', '图片', '图片路径', '图片URL', 'image_urls', 'images']))
    const slotMapping = []
    const slotRefs = []
    const productId = normalizeProductId(getRowValue(row, ['商品ID', '商品id', 'itemId', 'item_id', '商品链接']))
    const selected = options.selectedByProduct?.[productId] || []
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
    const rootRefs = buildRootMaterialPaths(options.materialRoot, productId, materialCount)
    if (rootRefs.length) return { refs: rootRefs, slotMapping, source: '素材根目录' }

    return { refs: [], slotMapping, source: '' }
  }

  function isInstructionOnlyRow(row) {
    const productCell = cleanText(getRowValue(row, ['商品ID', '商品id', 'itemId', 'item_id', '商品链接']))
    if (!productCell || normalizeProductId(productCell)) return false
    return /^(说明|填写说明|现在脚本|素材图片不是必填|素材根目录约定|手动多选命名约定|素材图片列支持)/.test(productCell)
  }

  function hasTaskFieldContent(row) {
    const taskFieldGroups = [
      ['商品ID', '商品id', 'itemId', 'item_id', '商品链接'],
      ['素材图片', '素材图', '图片', '图片路径', '图片URL', 'image_urls', 'images'],
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
    const jobs = []
    const invalidRows = []
    const sourceRows = Array.isArray(rows) ? rows : []
    sourceRows.forEach((row, index) => {
      const rowNo = index + 2
      if (!hasTaskFieldContent(row) || isInstructionOnlyRow(row)) return
      const productId = normalizeProductId(getRowValue(row, ['商品ID', '商品id', 'itemId', 'item_id', '商品链接']))
      const errors = []
      if (!productId) errors.push('商品ID必填')
      const category = cleanText(getRowValue(row, ['主类目', '类目', 'main_category'])) || cleanText(options.mainCategory) || DEFAULT_CATEGORY
      const mode = 'img2video'
      const ratio = normalizeRatio(getRowValue(row, ['比例', '画幅', 'ratio']), options.ratio || '3:4')
      const material = normalizeMaterialRefs(row, {
        selectedByProduct,
        materialRoot: options.materialRoot,
        defaultMaterialCount: options.defaultMaterialCount,
      })
      const prompt = cleanText(getRowValue(row, ['提示词', '文案', 'prompt']))
      const remark = cleanText(getRowValue(row, ['备注', '说明', 'remark']))
      const allowItemPicsFallback = !!options.useItemPicsFallback

      if (!material.refs.length && !allowItemPicsFallback) {
        errors.push('未找到素材图片：请在“素材图片”列填写 URL/绝对路径，或选择素材根目录/手动多选图片')
      }
      const localRefs = material.refs.filter(ref => !isRemoteImage(ref))
      const badRefs = localRefs.filter(ref => !isImagePath(ref))
      if (badRefs.length) errors.push(`素材图片扩展名不支持：${badRefs.slice(0, 3).join('、')}`)

      const job = {
        rowNo,
        productId,
        category,
        mode,
        ratio,
        templateId: '',
        templateMatch: '',
        prompt,
        remark,
        materialRefs: material.refs,
        slotMapping: material.slotMapping,
        materialSource: material.source,
        allowItemPicsFallback,
      }

      if (errors.length) {
        invalidRows.push(buildOutputRow(job, {
          status: '预检失败',
          note: errors.join('；'),
        }))
      } else {
        jobs.push(job)
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

  function safeParseJson(value, fallback) {
    if (Array.isArray(value) || (value && typeof value === 'object')) return value
    try {
      return JSON.parse(String(value || ''))
    } catch (error) {
      return fallback
    }
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
    const rowLocalRefs = localRefsForJob(job)
    const rowLocalRefsKey = refsKey(rowLocalRefs)
    if (rowLocalRefs.length && (shared.injected_job_index !== index || shared.injected_refs_key !== rowLocalRefsKey)) {
      ensureUploadInput()
      return injectFiles([{ selector: UPLOAD_INPUT_SELECTOR, files: rowLocalRefs }], 'process_row', 500, {
        ...shared,
        injected_job_index: index,
        injected_refs_key: rowLocalRefsKey,
        current_exec_no: index + 1,
        current_row_no: job.rowNo,
        current_buyer_id: job.productId,
      })
    }
    const activeShared = {
      ...shared,
      current_exec_no: index + 1,
      current_row_no: job.rowNo,
      current_buyer_id: job.productId,
    }
    try {
      const [item, material] = await Promise.all([
        searchItem(job.productId),
        fetchItemMaterial(job.productId).catch(() => ({})),
      ])
      const itemVO = normalizeItemVO(job.productId, item, material)
      let materials = await resolveMaterialUrls(job)
      if (!materials.length && job.allowItemPicsFallback) {
        materials = normalizeItemPicMaterials(material)
        job.materialSource = '商品主图兜底'
      }
      if (!materials.length) throw new Error('没有可用图片素材')
      const enrichedJob = {
        ...job,
        item: itemVO,
        resolvedMaterials: materials,
        template: null,
        materialSource: job.materialSource || materials[0]?.source || '',
      }
      window.__MOP_KOL_ACTIVE_JOB__ = enrichedJob
      return nextPhase('submit_job', 0, {
        ...activeShared,
        active_job: enrichedJob,
      })
    } catch (error) {
      const failedShared = finishCurrentJob(activeShared, buildOutputRow(job, {
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
