;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'init'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const SEMIR_ENTRY_URL = 'https://fmp.semirapp.com/web/index#/home/file'
  const TMALL_TEST_URL = 'https://myseller.taobao.com/home.htm/material-center/material-test/common_test?testStatus=1&testChannel=common_search'
  const TMALL_MATERIAL_SELECTOR_URL = 'https://market.m.taobao.com/app/crs-qn/sucai-selector-ng/index'
  const PICTURE_CENTER_UPLOAD_ENDPOINT = 'https://stream-upload.taobao.com/api/upload.api'
  const PICTURE_CENTER_UPLOAD_COLLECT_ENDPOINT = 'https://stream-upload.taobao.com/api/collect_client_upload_rt.api'
  const SEARCH_SCOPE = '["filename", "tag"]'
  const SEARCH_PAGE_SIZE = 100
  const DEFAULT_PAGE_SIZE = 10
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'])
  const BLOCKED_EXTS = new Set(['psd', 'pdf', 'ai', 'cdr', 'zip', 'rar', '7z'])
  const SOURCE_LABELS = {
    common_search: '搜索测图',
    COMMON_SEARCH: '搜索测图',
  }
  const STATUS_LABELS = {
    '-1': '已暂停',
    0: '未开始',
    1: '测试中',
    2: '已结束',
    3: '已完成',
  }

  function compact(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function normalizeKey(value) {
    return compact(value).toLowerCase().replace(/[\s_./\\\-：:（）()]+/g, '')
  }

  function getExt(itemOrFilename) {
    if (itemOrFilename && typeof itemOrFilename === 'object') {
      const explicit = compact(itemOrFilename.ext).toLowerCase()
      if (explicit) return explicit.replace(/^\./, '')
      return getExt(itemOrFilename.filename || itemOrFilename.name || itemOrFilename.fullpath || '')
    }
    const name = compact(itemOrFilename)
    const index = name.lastIndexOf('.')
    return index >= 0 ? name.slice(index + 1).trim().toLowerCase() : ''
  }

  function isDirectoryItem(item) {
    const dir = item?.dir
    return dir === 1 || dir === '1' || dir === true || item?.type === 'folder'
  }

  function isImageItem(item) {
    const ext = getExt(item)
    return !isDirectoryItem(item) && IMAGE_EXTS.has(ext) && !BLOCKED_EXTS.has(ext)
  }

  function naturalCompare(a, b) {
    return String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN', {
      numeric: true,
      sensitivity: 'base',
    })
  }

  function normalizeRemoteUrl(value) {
    const url = compact(value)
    if (!url) return ''
    if (url.startsWith('//')) return `https:${url}`
    return url
  }

  function normalizeItemId(value) {
    const match = compact(value).match(/\d{8,}/)
    return match ? match[0] : ''
  }

  function normalizeStyleCode(value) {
    return compact(value)
  }

  function normalizeSource(value) {
    const text = compact(value).toLowerCase()
    if (!text || text === 'common_search' || text === 'commonsearch' || text === 'search') return 'common_search'
    if (text === 'common_search'.toLowerCase()) return 'common_search'
    if (text === 'common_search'.replace('_', '')) return 'common_search'
    if (text === 'common_search'.toUpperCase().toLowerCase()) return 'common_search'
    return text
  }

  function toMtopSource(value) {
    const source = normalizeSource(value)
    if (source === 'common_search') return 'COMMON_SEARCH'
    return source.toUpperCase()
  }

  function getSourceLabel(value) {
    return SOURCE_LABELS[value] || SOURCE_LABELS[normalizeSource(value)] || SOURCE_LABELS[toMtopSource(value)] || compact(value) || '未知渠道'
  }

  function getStatusLabel(value) {
    const key = String(value ?? '').trim()
    return STATUS_LABELS[key] || compact(value) || ''
  }

  function parseListInput(value) {
    if (Array.isArray(value)) return value
    return String(value || '')
      .split(/[\n,，、；;]+/)
      .map(compact)
      .filter(Boolean)
  }

  function safeJsonParse(value, fallback = null) {
    if (Array.isArray(value) || (value && typeof value === 'object')) return value
    try {
      return JSON.parse(String(value || ''))
    } catch (error) {
      return fallback
    }
  }

  function formatDateTime(value) {
    if (value == null || value === '') return ''
    const number = Number(value)
    const date = Number.isFinite(number) ? new Date(number < 100000000000 ? number * 1000 : number) : new Date(value)
    if (!Number.isFinite(date.getTime())) return compact(value)
    return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
  }

  function formatPercent(numerator, denominator) {
    const top = Number(numerator)
    const bottom = Number(denominator)
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) return ''
    return `${((top / bottom) * 100).toFixed(2)}%`
  }

  function describeError(error, fallback = '未知错误') {
    if (!error) return fallback
    if (typeof error === 'string') return error
    if (Array.isArray(error.ret)) return error.ret.join('；')
    return error.message || error.msg || error.errorMsg || fallback
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

  function fail(message) {
    return { success: false, error: String(message || '天猫素材测图探路执行失败') }
  }

  function parseCloudPath(rawValue) {
    const raw = compact(rawValue)
    if (!raw) throw new Error('请填写云盘路径')
    const divider = raw.indexOf('//')
    if (divider < 0) throw new Error('云盘路径格式不正确，需要使用“挂载点//目录/子目录”')
    const mountName = compact(raw.slice(0, divider))
    const relativePath = raw.slice(divider + 2).replace(/\\/g, '/').split('/').map(compact).filter(Boolean).join('/')
    if (!mountName) throw new Error('云盘路径缺少挂载点名称')
    return {
      mountName,
      relativePath,
      relativePrefix: relativePath ? `${relativePath}/` : '',
      raw,
    }
  }

  async function fetchJson(url, init = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      ...init,
    })
    const text = typeof response.text === 'function' ? await response.text() : ''
    let payload = null
    try {
      payload = text ? JSON.parse(text) : (typeof response.json === 'function' ? await response.json() : {})
    } catch (error) {
      payload = null
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 240) || response.statusText || url}`)
    }
    if (payload == null) throw new Error(`接口未返回 JSON：${url}`)
    return payload
  }

  async function fetchMounts() {
    const payload = await fetchJson('/fengcloud/1/account/mount')
    if (Array.isArray(payload)) return payload
    if (Array.isArray(payload?.list)) return payload.list
    if (Array.isArray(payload?.data?.list)) return payload.data.list
    return []
  }

  async function resolveMountId(mountName) {
    const mounts = await fetchMounts()
    const target = mounts.find(item => compact(item?.org_name || item?.name) === compact(mountName))
    if (!target) throw new Error(`未找到挂载点：${mountName}`)
    return {
      mountId: String(target.mount_id || target.id || ''),
      mountName: compact(target.org_name || target.name || mountName),
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
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
      const items = Array.isArray(payload?.list) ? payload.list : Array.isArray(payload?.data?.list) ? payload.data.list : []
      const pageTotal = Number(payload?.total || payload?.data?.total || items.length || 0)
      if (total == null) total = pageTotal
      all.push(...items)
      if (!items.length) break
      start += items.length
      if (start >= pageTotal) break
    }

    return all
  }

  async function fetchFileInfo(mountId, fullpath) {
    const query = new URLSearchParams({
      fullpath: String(fullpath || ''),
      mount_id: String(mountId || ''),
    })
    return fetchJson(`/fengcloud/2/file/info?${query.toString()}`)
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
    const filename = compact(item.filename || item.name || '')
    const fullpath = compact(item.fullpath || item.path || '')
    if (fullpath || !filename || !parentFullpath) return item
    return { ...item, filename, fullpath: `${String(parentFullpath || '').replace(/\/+$/, '')}/${filename}` }
  }

  async function fetchFolderPage(mountId, fullpath, start, method, endpoint) {
    const query = new URLSearchParams({
      order: 'filename asc',
      size: String(SEARCH_PAGE_SIZE),
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
        while (true) {
          const payload = await fetchFolderPage(mountId, fullpath, start, attempt.method, attempt.endpoint)
          const itemsRaw = extractFolderItems(payload)
          if (!Array.isArray(itemsRaw)) throw new Error(`${attempt.method} ${attempt.endpoint} 未返回列表字段`)
          const items = itemsRaw.map(item => normalizeListedItem(item, fullpath))
          all.push(...items)
          const pageTotal = extractFolderTotal(payload, start + items.length)
          if (!items.length) break
          start += items.length
          if (start >= pageTotal) break
        }
        return { ok: true, items: all }
      } catch (error) {
        errors.push(describeError(error))
      }
    }
    return { ok: false, items: [], error: errors[0] || '列目录失败' }
  }

  async function collectDescendantImages(mountId, folderPath, maxDepth, remainingBudget = { value: 600 }) {
    if (!folderPath || maxDepth < 0 || remainingBudget.value <= 0) return { assets: [], errors: [] }
    const listed = await listFolderItems(mountId, folderPath)
    if (!listed.ok) return { assets: [], errors: [`${folderPath}: ${listed.error}`] }
    const assets = []
    const errors = []
    for (const item of listed.items) {
      if (remainingBudget.value <= 0) break
      if (isDirectoryItem(item)) {
        if (maxDepth <= 0) continue
        const child = await collectDescendantImages(mountId, item?.fullpath || item?.filename || '', maxDepth - 1, remainingBudget)
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

  function pathSegments(fullpath) {
    return String(fullpath || '').replace(/\\/g, '/').split('/').map(compact).filter(Boolean)
  }

  function parentFullpath(fullpath) {
    const segments = pathSegments(fullpath)
    segments.pop()
    return segments.join('/')
  }

  function folderPathsFromSearchItem(item, styleCode) {
    const style = compact(styleCode)
    if (!style) return []
    const fullpath = String(item?.fullpath || item?.filename || '').replace(/\\/g, '/')
    const segments = pathSegments(fullpath)
    const paths = []
    const addPath = (value) => {
      const path = compact(value)
      if (path && !paths.includes(path)) paths.push(path)
    }
    if (isDirectoryItem(item) && fullpath.includes(style)) {
      addPath(fullpath)
    } else if (isImageItem(item) && parentFullpath(fullpath).includes(style)) {
      addPath(parentFullpath(fullpath))
    }
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      if (!segments[index].includes(style)) continue
      if (isImageItem(item) && index === segments.length - 1) {
        const parent = parentFullpath(fullpath)
        if (parent.includes(style)) addPath(parent)
      } else {
        addPath(segments.slice(0, index + 1).join('/'))
      }
    }
    return paths
  }

  function itemKey(item) {
    return compact(item?.fullpath || item?.path || item?.filename || item?.name)
  }

  function dedupeItemsByPath(items) {
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

  function pathTextForCandidate(item) {
    return `${item?.fullpath || ''}/${item?.filename || item?.name || ''}`.replace(/\\/g, '/')
  }

  function basenameOf(value) {
    return compact(value).replace(/\\/g, '/').split('/').filter(Boolean).pop() || compact(value)
  }

  function startsWithCodeToken(value, code) {
    const text = compact(value).toLowerCase()
    const target = compact(code).toLowerCase()
    if (!text || !target) return false
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`^${escaped}(?:$|[^0-9a-z])`, 'i').test(text)
  }

  function isShowcaseOneName(filename) {
    return /橱窗\s*0?1(?!\d)/i.test(compact(filename))
  }

  function isYzOneName(filename) {
    const name = compact(filename)
    return /(^|[^0-9a-z])yz\s*[\(（]\s*0?1\s*[\)）]/i.test(name)
  }

  function isMainReferenceName(filename) {
    const name = basenameOf(filename)
    return isShowcaseOneName(name) || isYzOneName(name)
  }

  function skcCodeFromStyleName(filename, styleCode) {
    const style = compact(styleCode)
    if (!style) return ''
    const escaped = style.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = basenameOf(filename).match(new RegExp(`^(${escaped}[-_][0-9]{5})(?=$|[^0-9])`, 'i'))
    return match ? match[1] : ''
  }

  function isSkcDetailReferenceName(filename, skcCode) {
    const skc = compact(skcCode)
    return Boolean(skc) && startsWithCodeToken(basenameOf(filename), skc)
  }

  function getCandidateRole(flags) {
    if (flags.isShowcase1) return 'origin_showcase1'
    if (flags.isYz1) return 'origin_yz1'
    if (flags.isSkcDetail) return 'detail_skc_flat'
    return 'candidate'
  }

  function scoreSemirCandidate(item, options = {}) {
    const filename = compact(item?.filename || item?.name)
    const fullpath = compact(item?.fullpath || item?.path)
    const ext = getExt(item)
    const full = pathTextForCandidate(item)
    const name = basenameOf(filename || fullpath)
    const skcCode = compact(options.skcCode || options.skc_code)
    const styleCode = compact(options.styleCode || options.style_code)
    const stylePathOk = !styleCode || full.includes(styleCode)

    if (!isImageItem({ ...item, filename })) return null
    if (BLOCKED_EXTS.has(ext)) return null
    if (/尺码表|尺寸表|规格表|吊牌|制单|pdf|psd|源文件|视觉推荐|视频|模特卡/i.test(full)) return null

    const flags = {
      isShowcase1: isShowcaseOneName(name),
      isYz1: isYzOneName(name),
      isSkcDetail: isSkcDetailReferenceName(name, skcCode) || Boolean(skcCodeFromStyleName(name, styleCode)),
      isFlatPath: /平拍|平铺|白底|静物|正面|front/i.test(full),
      isSelectedPath: /已选/.test(full),
      isModelPath: /模拍|已选/.test(full),
      isFront: /正面|前面|front/i.test(name),
      isBack: /背面|后面|back/i.test(name),
    }
    const isMain = (flags.isShowcase1 || flags.isYz1) && stylePathOk
    const isDetail = flags.isSkcDetail
    if (!isMain && !isDetail) return null
    const mainRank = (flags.isShowcase1 ? 20 : flags.isYz1 ? 10 : 0) + (flags.isSelectedPath ? 2 : 0) + (flags.isModelPath ? 1 : 0)
    const detailRank = (flags.isFlatPath ? 6 : 0) + (flags.isFront ? 2 : flags.isBack ? 0 : 1) - (flags.isModelPath ? 2 : 0)
    const score = isMain ? 300 + mainRank * 20 : 200 + detailRank * 10

    return {
      ...item,
      filename,
      fullpath,
      ext,
      role: getCandidateRole(flags),
      score,
      mainRank,
      detailRank,
      flags,
      skcCode: flags.isSkcDetail ? (skcCode || skcCodeFromStyleName(name, styleCode)) : '',
    }
  }

  function rankSemirMaterialCandidates(items, options = {}) {
    const limit = Math.max(1, Number(options.limit || 12))
    const scored = []
    for (const item of Array.isArray(items) ? items : []) {
      const candidate = scoreSemirCandidate(item, options)
      if (candidate) scored.push(candidate)
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return naturalCompare(a.fullpath || a.filename, b.fullpath || b.filename)
    })
    return dedupeItemsByPath(scored).slice(0, limit)
  }

  function buildThreeFourMaterialPayloads(value, options = {}) {
    const list = parseListInput(value)
    const materials = []
    for (const item of list) {
      const rawUrl = typeof item === 'string' ? item : (item?.picUrl || item?.url || item?.imageUrl || item?.materialUrl || '')
      const picUrl = normalizeRemoteUrl(rawUrl)
      if (!picUrl) continue
      const material = {
        sourceType: Number(options.sourceType || item?.sourceType || 4),
        picUrl,
        size: options.size || item?.size || '3:4',
      }
      const attributes = options.attributes || item?.attributes
      if (attributes && typeof attributes === 'object') material.attributes = attributes
      materials.push(material)
    }
    return materials
  }

  function buildCreateTaskPayload(itemId, sources = ['common_search']) {
    const normalizedSources = [...new Set(parseListInput(sources).map(toMtopSource).filter(Boolean))]
    return {
      source: 'qn',
      itemId: String(itemId || ''),
      imageTestSources: JSON.stringify(normalizedSources.length ? normalizedSources : ['COMMON_SEARCH']),
    }
  }

  function buildBatchAddPayload(experimentTaskId, itemId, materials, source = 'common_search') {
    return {
      experimentTaskId: String(experimentTaskId || ''),
      itemId: String(itemId || ''),
      source: normalizeSource(source),
      materials: JSON.stringify(Array.isArray(materials) ? materials : []),
    }
  }

  function buildOnlinePayload(itemId, taskStatusList) {
    const list = (Array.isArray(taskStatusList) ? taskStatusList : [])
      .map(item => ({
        experimentTaskId: String(item?.experimentTaskId || item?.taskId || ''),
        source: normalizeSource(item?.source || item?.imageTestSource || 'common_search'),
      }))
      .filter(item => item.experimentTaskId)
    return {
      source: 'qn',
      itemId: String(itemId || ''),
      taskStatusList: JSON.stringify(list),
    }
  }

  function buildDownloadDataPayload(itemIds, statisticType, startDate, endDate) {
    return {
      startDate: String(startDate || ''),
      endDate: String(endDate || ''),
      itemIds: JSON.stringify(parseListInput(itemIds).map(normalizeItemId).filter(Boolean)),
      statisticType: compact(statisticType) || 'ACCUMULATE_30_DAYS',
    }
  }

  function appendSelectorParam(query, key, value) {
    if (value === undefined || value === null || value === '') return
    if (typeof value === 'boolean') {
      query.append(key, value ? 'true' : 'false')
      return
    }
    query.append(key, String(value))
  }

  function buildMaterialSelectorUrl(options = {}) {
    const query = new URLSearchParams()
    appendSelectorParam(query, 'type', options.type || 'pic')
    appendSelectorParam(query, 'mime', options.mime || 'png,jpg')
    appendSelectorParam(query, 'needCrop', options.needCrop !== undefined ? options.needCrop : true)
    appendSelectorParam(query, 'handleId', options.handleId || 'pic_space')
    appendSelectorParam(query, 'picMaxSize', options.picMaxSize || '20MB')
    appendSelectorParam(query, 'needClose', options.needClose !== undefined ? options.needClose : true)
    appendSelectorParam(query, 'minWidth', options.minWidth !== undefined ? options.minWidth : 'undefined')
    appendSelectorParam(query, 'bizScene', options.bizScene || 'material_test')
    appendSelectorParam(query, 'max', options.max || 5)
    appendSelectorParam(query, 'aspectRatio', options.aspectRatio || '1:1')
    return `${TMALL_MATERIAL_SELECTOR_URL}?${query.toString()}`
  }

  function buildPictureCenterUploadPlan(options = {}) {
    const originSize = options.originSize === true || options.originSize === 'true'
    return {
      mode: 'stream_upload',
      endpoint: PICTURE_CENTER_UPLOAD_ENDPOINT,
      method: 'POST',
      query: {
        appkey: options.appkey || 'tu',
        folderId: String(options.folderId || options.dirId || '0'),
        watermark: options.watermark === true || options.watermark === 'true',
        picCompress: !originSize,
        _input_charset: 'utf-8',
      },
      multipartFields: ['file', '_tb_token_', 'name', 'water', 'ua(optional)'],
      responseMap: {
        fileId: 'object.fileId',
        folderId: 'object.folderId',
        fullUrl: 'object.url',
        pixel: 'object.pix',
        size: 'object.size',
        quality: 'object.quality',
      },
    }
  }

  function truncateUploadFileName(fileName, maxLength = 100) {
    const raw = compact(fileName || 'image.jpg')
    const index = raw.lastIndexOf('.')
    const ext = index > -1 ? raw.slice(index) : ''
    const base = index > -1 ? raw.slice(0, index) : raw
    const limit = Math.max(1, Number(maxLength || 100) - ext.length)
    return `${base.length > limit ? base.slice(0, limit) : base}${ext}`
  }

  function buildPictureCenterMultipartUploadPlan(options = {}) {
    const fileName = truncateUploadFileName(options.fileName || options.name || 'image.jpg')
    return {
      mode: 'multipart_mtop',
      config: {
        api: 'mtop.taobao.mediacenter.pc.image.upload.config',
        data: { bizCode: options.bizCode || 'tu' },
      },
      init: {
        api: 'mtop.taobao.mediacenter.pc.image.upload.init',
        data: {
          sha256: options.sha256 || '<sha256>',
          bizCode: options.bizCode || 'tu',
          fileSize: Number(options.fileSize || 0),
          fileName,
          dirId: String(options.dirId || options.folderId || '0'),
          clientType: 1,
          pixel: options.pixel || '<width>x<height>',
          fileType: getExt(fileName),
        },
      },
      uploadPart: {
        method: 'PUT',
        contentType: 'application/octet-stream',
        urlSource: 'init.model.uploadUrlList[].url',
        etagSource: 'ETag response header',
      },
      complete: {
        api: 'mtop.taobao.mediacenter.pc.image.upload.complete',
        type: 'POST',
        data: {
          bizCode: options.bizCode || 'tu',
          uploadId: options.uploadId || '<uploadId>',
          clientType: '1',
          partList: '<JSON.stringify(partList.map(JSON.stringify))>',
        },
      },
      responseMap: {
        fileId: 'model.imageUploadDTO.fileId',
        fullUrl: 'model.imageUploadDTO.url',
        pixel: 'model.imageUploadDTO.pixel',
        quality: 'model.imageUploadDTO.quality',
      },
    }
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
      throw new Error('未找到千牛页面 MTop 客户端，请确认当前 tab 是天猫素材中心页面')
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

  function extractArray(payload, keys = []) {
    if (Array.isArray(payload)) return payload
    for (const key of keys) {
      const value = key.split('.').reduce((target, part) => target?.[part], payload)
      if (Array.isArray(value)) return value
    }
    return []
  }

  async function searchTmallItem(itemId) {
    const id = normalizeItemId(itemId)
    if (!id) throw new Error('请填写天猫商品 ID')
    const payload = await callMtop('mtop.taobao.qianniu.shop.item.search', {
      searchType: 'all',
      param: JSON.stringify({
        currentPage: 1,
        pageSize: 24,
        k: id,
      }),
    })
    const items = extractArray(payload, ['items', 'list', 'data.items', 'data.list', 'result.items', 'result.list'])
    return items.find(item => normalizeItemId(item?.itemId || item?.id || item?.auctionId) === id) || items[0] || null
  }

  async function searchMaterialTestTasks(itemId, filters = {}) {
    const source = normalizeSource(filters.source || filters.testChannel || 'common_search')
    const paramsPayload = {
      tabCode: filters.tabCode || 'all',
      testChannel: source,
    }
    if (filters.testStatus !== undefined && filters.testStatus !== null && filters.testStatus !== '') {
      paramsPayload.testStatus = String(filters.testStatus)
    }
    const id = normalizeItemId(itemId)
    if (id) paramsPayload.itemIdOrName = id
    const payload = await callMtop('mtop.taobao.qn.copilot.framework.listmodel.data.search', {
      modelCode: filters.modelCode || 'image_test_mgr',
      params: JSON.stringify(paramsPayload),
      currentPage: Number(filters.currentPage || 1),
      pageSize: Number(filters.pageSize || DEFAULT_PAGE_SIZE),
    })
    const rows = extractArray(payload, ['list', 'records', 'data', 'data.list', 'data.records', 'modelDataList'])
    const total = Number(payload?.total || payload?.count || payload?.data?.total || rows.length || 0)
    return {
      total: Number.isFinite(total) ? total : rows.length,
      rows,
      raw: payload,
      requestParams: paramsPayload,
    }
  }

  async function downloadMaterialTestData(itemIds, statisticType, startDate, endDate) {
    const payload = await callMtop('mtop.taobao.qn.copilot.test.image.data.download', buildDownloadDataPayload(
      itemIds,
      statisticType,
      startDate,
      endDate,
    ))
    return payload
  }

  async function createImageTestTask(itemId, sources = ['common_search']) {
    return callMtop('mtop.taobao.qn.copilot.test.image.task.create', buildCreateTaskPayload(itemId, sources))
  }

  async function batchAddTaskMaterials(experimentTaskId, itemId, materials, source = 'common_search') {
    return callMtop('mtop.taobao.qn.copilot.test.image.batch.add', buildBatchAddPayload(
      experimentTaskId,
      itemId,
      materials,
      source,
    ))
  }

  async function onlineImageTestTask(itemId, taskStatusList) {
    return callMtop('mtop.taobao.qn.copilot.test.image.task.online', buildOnlinePayload(itemId, taskStatusList))
  }

  function normalizeTmallTaskRows(inputRows) {
    const rows = []
    for (const row of Array.isArray(inputRows) ? inputRows : []) {
      const itemId = compact(row?.domainId || row?.itemId || row?.id)
      const title = compact(row?.head?.itemTitle || row?.head?.title || row?.itemTitle || row?.title)
      const itemStatus = compact(row?.head?.itemStatusName || row?.itemStatusName || row?.statusName)
      const testData = row?.columns?.test_data || row?.test_data || row?.testData || {}
      const dataList = Array.isArray(testData?.dataList) ? testData.dataList : Array.isArray(testData) ? testData : []
      if (!dataList.length) {
        rows.push({
          商品ID: itemId,
          商品标题: title,
          商品状态: itemStatus,
          测试渠道: '',
          任务ID: '',
          测试状态: '未找到测图任务',
          最优素材: '',
          测试素材数: 0,
        })
        continue
      }
      for (const item of dataList) {
        const metrics = item?.testImageMetrics || item?.imageMetrics || {}
        const count = Object.values(metrics).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0)
        rows.push({
          商品ID: itemId,
          商品标题: title,
          商品状态: itemStatus,
          测试渠道: getSourceLabel(item?.imageTestSource || item?.source || item?.testChannel),
          任务ID: compact(item?.experimentTaskId || item?.taskId || item?.id),
          测试状态: getStatusLabel(item?.testStatus || item?.status),
          开始时间: formatDateTime(item?.testStartTime || item?.startTime),
          最优素材: normalizeRemoteUrl(item?.bestTestImage?.imageUrl || item?.bestImage?.imageUrl || item?.bestTestImageUrl || ''),
          测试素材数: count,
        })
      }
    }
    return rows
  }

  function normalizeDownloadDataRows(inputRows, statisticType = '') {
    return (Array.isArray(inputRows) ? inputRows : []).map(row => {
      const searchExposure = Number(row?.searchExposure || 0)
      const searchClick = Number(row?.searchClick || 0)
      const detailExposure = Number(row?.detailExposure || 0)
      const detailClick = Number(row?.detailClick || 0)
      const detailAddCart = Number(row?.detailAddCart || 0)
      const detailPayConversion = Number(row?.detailPayConversion || 0)
      return {
        统计口径: compact(statisticType),
        统计日期: compact(row?.statisticDate),
        商品ID: compact(row?.itemId),
        图片类型: compact(row?.imageType),
        素材ID: compact(row?.materialId),
        素材比例: compact(row?.materialRatio),
        素材URL: normalizeRemoteUrl(row?.materialUrl || row?.imageUrl || ''),
        搜索曝光: searchExposure,
        搜索点击: searchClick,
        搜索点击率: formatPercent(searchClick, searchExposure),
        详情曝光: detailExposure,
        详情点击: detailClick,
        详情点击率: formatPercent(detailClick, detailExposure),
        详情加购: detailAddCart,
        详情支付转化: detailPayConversion,
        详情支付转化率: formatPercent(detailPayConversion, detailExposure),
      }
    })
  }

  function findFirstRemoteUrl(value, seen = new Set()) {
    if (!value) return ''
    if (typeof value === 'string') {
      const direct = normalizeRemoteUrl(value)
      return /^https?:\/\//i.test(direct) || /^\/\//.test(value) ? direct : ''
    }
    if (typeof value !== 'object' || seen.has(value)) return ''
    seen.add(value)
    for (const key of ['url', 'picUrl', 'imageUrl', 'materialUrl', 'downloadUrl', 'fileUrl', 'src']) {
      const found = findFirstRemoteUrl(value[key], seen)
      if (found) return found
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findFirstRemoteUrl(item, seen)
        if (found) return found
      }
    } else {
      for (const item of Object.values(value)) {
        const found = findFirstRemoteUrl(item, seen)
        if (found) return found
      }
    }
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

  async function dataUrlToBlob(dataUrl) {
    const raw = String(dataUrl || '')
    if (!raw.startsWith('data:')) throw new Error('uploadDataUrlWithPageHelper 需要 data: URL')
    if (typeof fetch === 'function') {
      const response = await fetch(raw)
      return response.blob()
    }
    throw new Error('当前页面不支持 data URL 转 Blob')
  }

  async function uploadDataUrlWithPageHelper(dataUrl, name, options = {}) {
    const allowLiveUpload = options.allowLiveUpload === true
      || options.allow_live_upload === true
      || params.allow_live_upload === true
      || params.allow_live_upload === 'true'
    if (!allowLiveUpload) {
      throw new Error(`真实素材上传会写入天猫图片空间，需要 allow_live_upload=true；已捕获端点 ${PICTURE_CENTER_UPLOAD_ENDPOINT}`)
    }
    if (typeof FormData !== 'function') throw new Error('当前页面不支持 FormData 上传')

    const fileName = truncateUploadFileName(name || options.fileName || 'material-test.png')
    const plan = buildPictureCenterUploadPlan({
      folderId: options.folderId || options.dirId || '0',
      originSize: options.originSize,
      watermark: options.watermark,
    })
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(plan.query)) query.append(key, String(value))
    const endpoint = `${plan.endpoint}?${query.toString()}`
    const form = new FormData()
    form.append('water', String(plan.query.watermark))
    form.append('name', fileName)
    form.append('_tb_token_', options.tbToken || getCookieValue('_tb_token_'))
    form.append('file', await dataUrlToBlob(dataUrl), fileName)

    const response = await fetch(endpoint, {
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
    if (!payload || payload.success === false) throw new Error(payload?.message || payload?.msg || `图片上传失败：${fileName}`)
    const url = normalizeRemoteUrl(payload?.object?.url || findFirstRemoteUrl(payload))
    if (!url) throw new Error(`图片上传未返回 URL：${fileName}`)
    return {
      url,
      name: fileName,
      fileId: compact(payload?.object?.fileId),
      folderId: compact(payload?.object?.folderId),
      pixel: compact(payload?.object?.pix),
      size: payload?.object?.size,
      quality: payload?.object?.quality,
      uploadResult: payload,
    }
  }

  function extractCreateTaskStatusList(payload, source = 'common_search') {
    const targetSource = normalizeSource(source)
    const candidates = extractArray(payload, ['result', 'list', 'data', 'data.result', 'data.list'])
    return candidates
      .map(item => ({
        experimentTaskId: compact(item?.experimentTaskId || item?.taskId || item?.id),
        source: normalizeSource(item?.source || item?.imageTestSource || targetSource),
      }))
      .filter(item => item.experimentTaskId && item.source === targetSource)
  }

  function currentHref() {
    return String(window.location?.href || globalThis.location?.href || '')
  }

  function isSemirPage() {
    return /^https:\/\/fmp\.semirapp\.com\//i.test(currentHref())
  }

  function isTmallMaterialPage() {
    return /^https:\/\/myseller\.taobao\.com\//i.test(currentHref())
  }

  async function runSemirPlan() {
    const styleCode = normalizeStyleCode(params.style_code || params.styleCode || params.code || '208326121203')
    const skcCode = normalizeStyleCode(params.skc_code || params.skcCode || params.skc || '')
    const rows = []
    let allItems = []
    const scanErrors = []
    const configuredPath = compact(params.cloud_path)
    const mountsToSearch = []

    if (configuredPath) {
      const cloudPath = parseCloudPath(configuredPath)
      const mount = await resolveMountId(cloudPath.mountName)
      mountsToSearch.push({ ...mount, relativePath: cloudPath.relativePath, source: 'configured' })
    } else {
      const mounts = await fetchMounts()
      for (const mount of mounts) {
        mountsToSearch.push({
          mountId: String(mount.mount_id || mount.id || ''),
          mountName: compact(mount.org_name || mount.name),
          relativePath: '',
          source: 'mounted-global',
        })
      }
    }

    for (const mount of mountsToSearch.filter(item => item.mountId)) {
      const keywords = [...new Set([styleCode, skcCode].map(compact).filter(Boolean))]
      for (const keyword of keywords) {
        const items = await searchFiles(mount.mountId, keyword)
        const scoped = mount.relativePath
          ? items.filter(item => String(item?.fullpath || '').replace(/\\/g, '/').startsWith(mount.relativePath))
          : items
        allItems.push(...scoped.map(item => ({ ...item, mountId: mount.mountId, mountName: mount.mountName })))
        const folderPaths = []
        for (const item of scoped) {
          for (const folderPath of folderPathsFromSearchItem(item, styleCode)) {
            if (folderPath && !folderPaths.includes(folderPath)) folderPaths.push(folderPath)
          }
        }
        for (const folderPath of folderPaths.slice(0, 8)) {
          const descendants = await collectDescendantImages(mount.mountId, folderPath, Number(params.folder_scan_depth || 3))
          scanErrors.push(...descendants.errors)
          allItems.push(...descendants.assets.map(item => ({ ...item, mountId: mount.mountId, mountName: mount.mountName })))
        }
        rows.push({
          款号: styleCode,
          SKC编码: skcCode,
          商品ID: normalizeItemId(params.item_id || params.itemId),
          阶段: '森马云盘找图',
          云盘路径: mount.relativePath ? `${mount.mountName}//${mount.relativePath}` : mount.mountName,
          文件名: '',
          素材URL: '',
          执行结果: scoped.length ? '已找到候选' : '未匹配到图片',
          备注: `挂载点 ${mount.mountId} 关键词 ${keyword} 搜索 ${items.length} 条，路径内 ${scoped.length} 条，扫描目录 ${folderPaths.length} 个`,
        })
      }
    }

    allItems = dedupeItemsByPath(allItems)
    const candidates = rankSemirMaterialCandidates(allItems, {
      styleCode,
      skcCode,
      limit: Number(params.candidate_limit || 12),
    })

    for (const [index, item] of candidates.entries()) {
      let materialUrl = ''
      if (index < 5 && item.mountId && item.fullpath) {
        try {
          materialUrl = findFirstRemoteUrl(await fetchFileInfo(item.mountId, item.fullpath))
        } catch (error) {
          materialUrl = ''
        }
      }
      rows.push({
        款号: styleCode,
        SKC编码: skcCode,
        商品ID: normalizeItemId(params.item_id || params.itemId),
        阶段: '森马云盘候选图',
        云盘路径: item.fullpath,
        文件名: item.filename,
        素材URL: materialUrl,
        执行结果: '候选',
        备注: `${item.mountName || ''}；${item.role}；score=${item.score}`,
      })
    }

    const newShared = {
      ...shared,
      semir_material_test: {
        styleCode,
        candidates,
        scanErrors: scanErrors.slice(0, 10),
        rowCount: rows.length,
      },
    }

    if (params.auto_continue_to_tmall === true || params.auto_continue_to_tmall === 'true') {
      window.location.href = TMALL_TEST_URL
      return nextPhase('tmall_plan', 3000, newShared, rows)
    }
    return complete(rows, newShared)
  }

  async function runTmallPlan() {
    const itemId = normalizeItemId(params.item_id || params.itemId || '1060862679580')
    const styleCode = normalizeStyleCode(params.style_code || params.styleCode || '208326121203')
    const executeMode = compact(params.execute_mode || 'plan')
    const materialUrls = parseListInput(params.material_urls || params.materialUrls)
    const rows = []

    let item = null
    try {
      item = await searchTmallItem(itemId)
      rows.push({
        款号: styleCode,
        商品ID: itemId,
        阶段: '天猫商品查询',
        商品标题: compact(item?.title || item?.itemTitle || item?.name),
        素材URL: normalizeRemoteUrl(item?.picUrl || item?.itemPic || ''),
        执行结果: item ? '商品存在' : '未查询到商品',
        备注: item ? `库存 ${item.quantity || item.num || ''}；状态 ${item.status || item.itemStatus || ''}` : '',
      })
    } catch (error) {
      rows.push({
        款号: styleCode,
        商品ID: itemId,
        阶段: '天猫商品查询',
        执行结果: '查询失败',
        备注: describeError(error),
      })
    }

    try {
      const taskResult = await searchMaterialTestTasks(itemId, {
        source: params.test_channel || 'common_search',
        testStatus: params.test_status,
      })
      const taskRows = normalizeTmallTaskRows(taskResult.rows)
      if (taskRows.length) {
        rows.push(...taskRows.map(row => ({
          款号: styleCode,
          商品ID: row.商品ID || itemId,
          阶段: '天猫测图任务',
          商品标题: row.商品标题,
          素材URL: row.最优素材,
          任务ID: row.任务ID,
          测试状态: row.测试状态,
          执行结果: '已读取',
          备注: `${row.测试渠道 || ''}；${row.测试素材数 || 0} 张`,
        })))
      } else {
        rows.push({
          款号: styleCode,
          商品ID: itemId,
          阶段: '天猫测图任务',
          执行结果: '未找到测图任务',
          备注: `total=${taskResult.total}`,
        })
      }
    } catch (error) {
      rows.push({
        款号: styleCode,
        商品ID: itemId,
        阶段: '天猫测图任务',
        执行结果: '读取失败',
        备注: describeError(error),
      })
    }

    if (params.download_start_date && params.download_end_date) {
      try {
        const payload = await downloadMaterialTestData(
          [itemId],
          params.download_statistic_type || 'ACCUMULATE_30_DAYS',
          params.download_start_date,
          params.download_end_date,
        )
        const dataRows = normalizeDownloadDataRows(
          extractArray(payload, ['list', 'rows', 'data', 'data.list', 'data.rows']),
          params.download_statistic_type || 'ACCUMULATE_30_DAYS',
        )
        rows.push(...dataRows.map(row => ({
          款号: styleCode,
          商品ID: row.商品ID || itemId,
          阶段: '测图数据导出',
          素材URL: row.素材URL,
          搜索曝光: row.搜索曝光,
          搜索点击率: row.搜索点击率,
          执行结果: '已读取',
          备注: `${row.统计日期 || ''}；${row.素材比例 || ''}`,
        })))
        if (!dataRows.length) {
          rows.push({
            款号: styleCode,
            商品ID: itemId,
            阶段: '测图数据导出',
            执行结果: '接口已返回',
            备注: '未解析到明细行，原始返回可能是下载链接或异步任务',
          })
        }
      } catch (error) {
        rows.push({
          款号: styleCode,
          商品ID: itemId,
          阶段: '测图数据导出',
          执行结果: '读取失败',
          备注: describeError(error),
        })
      }
    }

    rows.push({
      款号: styleCode,
      商品ID: itemId,
      阶段: '素材上传端点',
      素材URL: buildMaterialSelectorUrl({ aspectRatio: '1:1', max: 5 }),
      执行结果: '已捕获',
      备注: JSON.stringify({
        selector: {
          app: 'crs-qn/sucai-selector-ng@0.0.78',
          component: 'sucai-center-components@0.0.50/PicUpload',
        },
        streamUpload: buildPictureCenterUploadPlan({ folderId: '0', originSize: false }),
        multipartUpload: buildPictureCenterMultipartUploadPlan({
          fileName: `${styleCode || 'image'}-material-test.jpg`,
          fileSize: 0,
          sha256: '<sha256>',
          pixel: '<width>x<height>',
          dirId: '0',
        }),
        collect: PICTURE_CENTER_UPLOAD_COLLECT_ENDPOINT,
      }),
    })

    const materials = buildThreeFourMaterialPayloads(materialUrls)
    if (executeMode === 'create_and_online') {
      if (params.allow_live_mutation !== true && params.allow_live_mutation !== 'true') {
        rows.push({
          款号: styleCode,
          商品ID: itemId,
          阶段: '创建并上线测图任务',
          执行结果: '已阻止',
          备注: '创建/加图/上线属于线上状态变更，需要 allow_live_mutation=true 才会执行',
        })
        return complete(rows, shared)
      }
      if (!materials.length) {
        rows.push({
          款号: styleCode,
          商品ID: itemId,
          阶段: '创建并上线测图任务',
          执行结果: '已阻止',
          备注: '缺少 material_urls，无法执行 batch.add',
        })
        return complete(rows, shared)
      }

      const createResult = await createImageTestTask(itemId, ['common_search'])
      let taskStatusList = extractCreateTaskStatusList(createResult, 'common_search')
      if (!taskStatusList.length && params.experiment_task_id) {
        taskStatusList = [{ experimentTaskId: compact(params.experiment_task_id), source: 'common_search' }]
      }
      const firstTask = taskStatusList[0]
      if (!firstTask) throw new Error('创建测图任务后未解析到 COMMON_SEARCH 任务 ID')
      await batchAddTaskMaterials(firstTask.experimentTaskId, itemId, materials, 'common_search')
      await onlineImageTestTask(itemId, taskStatusList)
      rows.push({
        款号: styleCode,
        商品ID: itemId,
        阶段: '创建并上线测图任务',
        任务ID: firstTask.experimentTaskId,
        执行结果: '已执行',
        备注: `已添加 ${materials.length} 张 3:4 素材并调用上线 API`,
      })
    } else {
      rows.push({
        款号: styleCode,
        商品ID: itemId,
        阶段: '测图 API 计划',
        素材URL: materials.map(item => item.picUrl).join('\n'),
        执行结果: '仅计划',
        备注: JSON.stringify({
          create: buildCreateTaskPayload(itemId, ['common_search']),
          batchAdd: materials.length ? buildBatchAddPayload('<experimentTaskId>', itemId, materials, 'common_search') : null,
          online: buildOnlinePayload(itemId, [{ experimentTaskId: '<experimentTaskId>', source: 'common_search' }]),
        }),
      })
    }

    return complete(rows, shared)
  }

  function exposeHelpers() {
    if (!testExports) return
    Object.assign(testExports, {
      parseCloudPath,
      fetchMounts,
      resolveMountId,
      searchFiles,
      fetchFileInfo,
      listFolderItems,
      collectDescendantImages,
      folderPathsFromSearchItem,
      isMainReferenceName,
      isSkcDetailReferenceName,
      rankSemirMaterialCandidates,
      buildThreeFourMaterialPayloads,
      buildCreateTaskPayload,
      buildBatchAddPayload,
      buildOnlinePayload,
      buildDownloadDataPayload,
      buildMaterialSelectorUrl,
      buildPictureCenterUploadPlan,
      buildPictureCenterMultipartUploadPlan,
      unwrapMtopPayload,
      callMtop,
      searchTmallItem,
      searchMaterialTestTasks,
      downloadMaterialTestData,
      normalizeTmallTaskRows,
      normalizeDownloadDataRows,
      uploadDataUrlWithPageHelper,
      extractCreateTaskStatusList,
    })
  }

  exposeHelpers()
  if (phase === '__exports__') return complete([], shared)

  try {
    if (phase === 'semir_plan' || isSemirPage()) return await runSemirPlan()
    if (phase === 'tmall_plan' || isTmallMaterialPage()) return await runTmallPlan()
    return complete([{
      款号: normalizeStyleCode(params.style_code || '208326121203'),
      商品ID: normalizeItemId(params.item_id || '1060862679580'),
      阶段: '页面检查',
      执行结果: '未在支持页面',
      备注: `请在森马云盘 ${SEMIR_ENTRY_URL} 或天猫素材测试页 ${TMALL_TEST_URL} 运行；当前 ${currentHref() || 'unknown'}`,
    }], shared)
  } catch (error) {
    return fail(describeError(error))
  }
})()
