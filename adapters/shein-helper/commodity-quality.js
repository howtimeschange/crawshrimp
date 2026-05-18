;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = Number(window.__CRAWSHRIMP_PAGE__ || 1)
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const TARGET_URL = 'https://sso.geiwohuo.com/#/pqmp/commoditiesQuality/list'
  const PAGE_SIZE = 200
  const DETAIL_PAGE_SIZE = 200
  const DETAIL_BATCH_REQUESTS = 10
  const DETAIL_MONTH_SCAN_LIMIT = 12
  const ES_PAGE_LIMIT = 10000
  const QUALITY_LEVEL_SHARD_VALUES = [0, 12, 13, 14, 15]
  const PRODUCT_LEVEL_SHARD_VALUES = [0, 4, 7, 10, 17, 67, 87, 107, 220, 227, 228, 232, 236]
  const PRODUCT_LEVEL_DISCOVERY_MAX = 300
  const CAPTURE_KEY = 'captureResult'
  const LIST_ENDPOINT_PATTERN = /quality_analysis\/new_list/i
  const DETAIL_ENDPOINT = '/pqmp-api-prefix/pqmp/quality_analysis/get_customer_return_reason'
  const FORBIDDEN_HEADER_KEYS = new Set([
    'accept-encoding',
    'connection',
    'content-length',
    'cookie',
    'host',
    'origin',
    'referer',
    'user-agent',
  ])

  const persistedRequestShared = {
    requestedMode: String(shared.requestedMode || params.mode || 'current').trim().toLowerCase() || 'current',
    requestedSkcList: normalizeMultilineParam(shared.requestedSkcList || params.filter_skc),
    requestedSpuList: normalizeMultilineParam(shared.requestedSpuList || params.filter_spu),
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

  function normalizeMultilineParam(value) {
    if (Array.isArray(value)) {
      return value.map(item => String(item || '').trim()).filter(Boolean)
    }
    return String(value || '')
      .split(/[\r\n,，;；]+/)
      .map(item => item.trim())
      .filter(Boolean)
  }

  function mergeShared(next = shared) {
    return {
      ...persistedRequestShared,
      ...(next || {}),
    }
  }

  function nextPhase(name, sleepMs = 800, next = shared, data = []) {
    return {
      success: true,
      data,
      meta: { action: 'next_phase', next_phase: name, sleep_ms: sleepMs, shared: mergeShared(next) },
    }
  }

  function complete(data, hasMore = false, next = shared) {
    return {
      success: true,
      data,
      meta: { action: 'complete', has_more: hasMore, shared: mergeShared(next) },
    }
  }

  function fail(message) {
    return { success: false, error: String(message || '未知错误') }
  }

  function textOf(el) {
    return String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim()
  }

  function isVisible(el) {
    if (!el || typeof el.getClientRects !== 'function') return false
    return el.getClientRects().length > 0
  }

  function hasClassFragment(el, fragment) {
    return String(el?.className || '').includes(fragment)
  }

  function isDisabled(el) {
    return (
      !!el &&
      (
        hasClassFragment(el, 'disabled') ||
        hasClassFragment(el, 'Disabled') ||
        String(el.getAttribute?.('aria-disabled') || '').toLowerCase() === 'true'
      )
    )
  }

  function getCenterClick(el, delayMs = 120) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      delay_ms: delayMs,
    }
  }

  async function waitFor(check, timeout = 8000, interval = 250) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (check()) return true
      await sleep(interval)
    }
    return false
  }

  function safeJsonParse(raw) {
    if (raw == null || raw === '') return null
    if (typeof raw === 'object') return raw
    try {
      return JSON.parse(String(raw))
    } catch (error) {
      return null
    }
  }

  function deepClone(value, fallback) {
    const parsed = safeJsonParse(JSON.stringify(value))
    if (parsed == null) return fallback
    return parsed
  }

  function normalizeRequestHeaders(headers) {
    if (!headers) return {}
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      return Object.fromEntries(headers.entries())
    }
    if (Array.isArray(headers)) {
      return Object.fromEntries(headers
        .map(item => Array.isArray(item) ? item : [])
        .filter(item => item.length >= 2)
        .map(item => [String(item[0] || ''), String(item[1] || '')]))
    }
    if (typeof headers === 'object') {
      return Object.fromEntries(Object.entries(headers).map(([key, value]) => [String(key || ''), String(value || '')]))
    }
    return {}
  }

  function sanitizeHeaders(headers) {
    const result = {}
    for (const [rawKey, rawValue] of Object.entries(headers || {})) {
      const key = String(rawKey || '').trim()
      const value = String(rawValue || '').trim()
      if (!key || !value) continue
      const lowerKey = key.toLowerCase()
      if (FORBIDDEN_HEADER_KEYS.has(lowerKey)) continue
      if (lowerKey.startsWith('sec-')) continue
      result[key] = value
    }
    return result
  }

  function extractPathname(urlText) {
    const raw = String(urlText || '').trim()
    if (!raw) return ''
    try {
      const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, TARGET_URL)
      return url.pathname
    } catch (error) {
      const match = raw.match(/https?:\/\/[^/]+(\/[^?#]*)/i)
      if (match) return match[1]
      return raw.split('?')[0]
    }
  }

  function readCaptureMatches(captureResult) {
    return Array.isArray(captureResult?.matches) ? captureResult.matches : []
  }

  function pickCaptureMatch(captureResult) {
    return readCaptureMatches(captureResult).find(match =>
      LIST_ENDPOINT_PATTERN.test(String(match?.responseUrl || match?.url || '')),
    ) || null
  }

  function getPagerButtons() {
    return [...document.querySelectorAll('button')]
      .filter(isVisible)
      .filter(button => hasClassFragment(button, 'pagination'))
  }

  function getQueryCaptureButton() {
    return [...document.querySelectorAll('button')]
      .filter(isVisible)
      .find(item => /^(查询|搜索|Search)$/i.test(textOf(item))) || null
  }

  function getPagerCaptureButton() {
    const pagerButtons = getPagerButtons()
    if (!pagerButtons.length) return null
    return [...pagerButtons].reverse().find(button =>
      !isDisabled(button) && !/^\d+$/.test(textOf(button)),
    ) || [...pagerButtons].reverse().find(button => !isDisabled(button)) || null
  }

  function getCapturePlan() {
    const queryClick = getCenterClick(getQueryCaptureButton())
    const pagerClick = getCenterClick(getPagerCaptureButton())
    const clicks = []
    if (queryClick) clicks.push(queryClick)
    if (
      pagerClick &&
      !clicks.some(click => click.x === pagerClick.x && click.y === pagerClick.y)
    ) {
      clicks.push(pagerClick)
    }
    return {
      source: clicks.length === 2 ? 'query+pagersafe' : queryClick ? 'query' : pagerClick ? 'pager' : '',
      clicks,
    }
  }

  async function captureListRequestViaPageActions() {
    const queryButton = getQueryCaptureButton()
    const pagerButton = getPagerCaptureButton()
    if (!queryButton && !pagerButton) {
      return { error: '未找到可用于继承当前筛选的搜索或翻页控件' }
    }

    const matches = []
    const pushMatch = match => {
      if (!match) return
      const urlText = String(match.responseUrl || match.url || '')
      if (!LIST_ENDPOINT_PATTERN.test(urlText)) return
      matches.push({
        url: String(match.url || ''),
        responseUrl: urlText,
        method: String(match.method || 'GET').trim().toUpperCase() || 'GET',
        headers: sanitizeHeaders(match.headers),
        postData: typeof match.postData === 'string' ? match.postData : '',
        body: typeof match.body === 'string' ? match.body : '',
      })
    }

    const originalFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : null
    const originalWindowFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null
    const originalXHROpen = typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest.prototype.open : null
    const originalXHRSend = typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest.prototype.send : null
    const originalXHRSetRequestHeader = typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest.prototype.setRequestHeader : null

    try {
      if (originalFetch) {
        const captureFetch = async function(input, init = {}) {
          const requestUrl = String(typeof input === 'string' ? input : input?.url || '')
          const method = String(init?.method || (typeof input === 'object' ? input?.method : '') || 'GET')
          const headers = normalizeRequestHeaders(init?.headers || (typeof input === 'object' ? input?.headers : null))
          const postData = typeof init?.body === 'string' ? init.body : ''
          const response = await originalFetch(input, init)
          try {
            if (LIST_ENDPOINT_PATTERN.test(String(response?.url || requestUrl || ''))) {
              const clone = typeof response?.clone === 'function' ? response.clone() : null
              const body = clone && typeof clone.text === 'function' ? await clone.text() : ''
              pushMatch({
                url: requestUrl,
                responseUrl: String(response?.url || requestUrl || ''),
                method,
                headers,
                postData,
                body,
              })
            }
          } catch (error) {}
          return response
        }
        globalThis.fetch = captureFetch
        window.fetch = captureFetch
      }

      if (originalXHROpen && originalXHRSend) {
        XMLHttpRequest.prototype.open = function(method, url) {
          this.__crawshrimpCaptureMeta = {
            method: String(method || 'GET'),
            url: String(url || ''),
            headers: {},
          }
          return originalXHROpen.apply(this, arguments)
        }
        if (originalXHRSetRequestHeader) {
          XMLHttpRequest.prototype.setRequestHeader = function(key, value) {
            if (this.__crawshrimpCaptureMeta && key) {
              this.__crawshrimpCaptureMeta.headers[String(key)] = String(value || '')
            }
            return originalXHRSetRequestHeader.apply(this, arguments)
          }
        }
        XMLHttpRequest.prototype.send = function(body) {
          const meta = this.__crawshrimpCaptureMeta || {}
          this.addEventListener('loadend', () => {
            pushMatch({
              url: meta.url,
              responseUrl: String(this.responseURL || meta.url || ''),
              method: meta.method,
              headers: meta.headers,
              postData: typeof body === 'string' ? body : '',
              body: typeof this.responseText === 'string' ? this.responseText : '',
            })
          }, { once: true })
          return originalXHRSend.apply(this, arguments)
        }
      }

      const clickAndWait = async (button, timeoutMs = 5000) => {
        if (!button) return false
        try { button.click?.() } catch (error) {}
        return waitFor(() => matches.length > 0, timeoutMs, 200)
      }

      let source = ''
      if (await clickAndWait(queryButton, 5000)) {
        source = 'query'
      } else if (await clickAndWait(pagerButton, 5000)) {
        source = queryButton ? 'query+pagersafe' : 'pager'
      }

      if (!matches.length) {
        return { error: '未捕获到商品质量列表请求，请确认当前页面筛选已生效' }
      }

      return {
        source: source || (queryButton ? 'query' : 'pager'),
        captureResult: { matches },
      }
    } finally {
      if (originalFetch) {
        globalThis.fetch = originalFetch
        window.fetch = originalWindowFetch || originalFetch
      }
      if (originalXHROpen && originalXHRSend) {
        XMLHttpRequest.prototype.open = originalXHROpen
        XMLHttpRequest.prototype.send = originalXHRSend
      }
      if (originalXHRSetRequestHeader) {
        XMLHttpRequest.prototype.setRequestHeader = originalXHRSetRequestHeader
      }
    }
  }

  function isTargetPage() {
    const href = String(location.href || '')
    const body = textOf(document.body)
    return href.includes('#/pqmp/commoditiesQuality/list') || /商品质量/.test(body)
  }

  function pageReady() {
    const body = textOf(document.body)
    return isTargetPage() && /商品质量/.test(body) && (
      getPagerButtons().length > 0 ||
      document.querySelectorAll('tbody tr').length > 0 ||
      LIST_ENDPOINT_PATTERN.test(body)
    )
  }

  function stripPagingFields(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
    const next = {}
    for (const [key, value] of Object.entries(payload)) {
      if (value == null) continue
      if (['page', 'perPage', 'pageNum', 'pageSize', 'page_num', 'page_size'].includes(key)) continue
      if (Array.isArray(value) && value.length === 0) continue
      if (!Array.isArray(value) && typeof value !== 'object' && String(value).trim() === '') continue
      next[key] = value
    }
    return next
  }

  function applyRequestedFilterOverrides(payload) {
    const next = deepClone(payload, {})
    if (persistedRequestShared.requestedSkcList.length) {
      next.sType = 1
      next.skc_name_list = deepClone(persistedRequestShared.requestedSkcList, [])
      delete next.spu_name_list
    } else if (persistedRequestShared.requestedSpuList.length) {
      next.sType = 2
      next.spu_name_list = deepClone(persistedRequestShared.requestedSpuList, [])
      delete next.skc_name_list
    }
    return next
  }

  function summarizeFilters(payload) {
    const parts = []
    const skcValues = (Array.isArray(payload.skc_name_list) ? payload.skc_name_list : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
    if (skcValues.length) parts.push(`SKC=${skcValues.length}项`)
    const spuValues = (Array.isArray(payload.spu_name_list) ? payload.spu_name_list : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
    if (spuValues.length) parts.push(`SPU=${spuValues.length}项`)

    const qualityLevels = (Array.isArray(payload.goods_quality_level_list) ? payload.goods_quality_level_list : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
    if (qualityLevels.length) parts.push(`质量等级=${qualityLevels.join(',')}`)

    const alertTypes = (Array.isArray(payload.alert_type_list) ? payload.alert_type_list : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
    if (alertTypes.length) parts.push(`预警场景=${alertTypes.join(',')}`)

    const optimizeStatuses = (Array.isArray(payload.optimize_status_list) ? payload.optimize_status_list : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
    if (optimizeStatuses.length) parts.push(`优化状态=${optimizeStatuses.join(',')}`)

    const quickFilter = String(payload.quick_filter || '').trim()
    if (quickFilter) parts.push(`快捷筛选=${quickFilter}`)
    return parts.join('; ')
  }

  function resolveTotalRows(payload, fallback = 0) {
    const candidates = [
      payload?.info?.meta?.count,
      payload?.info?.count,
      payload?.meta?.count,
      payload?.count,
      fallback,
    ]
    for (const item of candidates) {
      const num = Number(item)
      if (Number.isFinite(num) && num >= 0) return num
    }
    return 0
  }

  function resolveStrictTotalRows(payload) {
    const candidates = [
      payload?.info?.meta?.count,
      payload?.info?.count,
      payload?.meta?.count,
      payload?.count,
    ]
    for (const item of candidates) {
      const num = Number(item)
      if (Number.isFinite(num) && num >= 0) return num
    }
    const data = payload?.info?.data
    if (isSuccessPayload(payload) && Array.isArray(data) && data.length === 0) return 0
    return null
  }

  function isSuccessPayload(payload) {
    const code = payload?.code
    return code == null || code === 0 || code === '0' || code === 200 || code === '200'
  }

  function explainPayloadError(payload, fallback) {
    return String(
      payload?.msg ||
      payload?.message ||
      payload?.errorMsg ||
      payload?.error ||
      fallback,
    ).trim()
  }

  function normalizeShardValue(value) {
    const text = String(value ?? '').trim()
    if (!text) return ''
    const numeric = Number(text)
    return Number.isFinite(numeric) ? numeric : text
  }

  function uniqueShardValues(value, fallbackValues) {
    const source = Array.isArray(value) && value.length ? value : fallbackValues
    const seen = new Set()
    const result = []
    for (const item of source || []) {
      const normalized = normalizeShardValue(item)
      if (normalized === '') continue
      const key = JSON.stringify(normalized)
      if (seen.has(key)) continue
      seen.add(key)
      result.push(normalized)
    }
    return result
  }

  async function discoverAdditionalProductLevelShards(template, basePayload, parentLabel, knownValues) {
    const knownKeys = new Set((knownValues || []).map(value => JSON.stringify(normalizeShardValue(value))))
    const shards = []
    for (let productLevel = 0; productLevel <= PRODUCT_LEVEL_DISCOVERY_MAX; productLevel += 1) {
      if (knownKeys.has(JSON.stringify(productLevel))) continue
      const payload = {
        ...deepClone(basePayload, {}),
        product_level_list: [productLevel],
      }
      const label = `${parentLabel} / 商品层次=${productLevel}`
      const probed = await probeListCount(template, payload, label)
      if (probed.error) return { error: probed.error }
      if (probed.count <= 0) continue
      if (probed.count > ES_PAGE_LIMIT) {
        return { error: `商品质量列表分片仍超过 ${ES_PAGE_LIMIT} 条：${label}=${probed.count} 条，请先在页面缩小筛选范围后重试` }
      }
      knownKeys.add(JSON.stringify(productLevel))
      shards.push(buildShard(label, payload, probed.count))
    }
    return { shards }
  }

  function buildShard(label, payload, totalRows) {
    const rows = Math.max(0, Number(totalRows || 0))
    return {
      label,
      payload: deepClone(payload, {}),
      total_rows: rows,
      total_batches: rows > 0 ? Math.ceil(rows / PAGE_SIZE) : 0,
    }
  }

  function shardTotalRows(shards) {
    return (Array.isArray(shards) ? shards : [])
      .reduce((sum, shard) => sum + Math.max(0, Number(shard?.total_rows || 0)), 0)
  }

  function shardTotalBatches(shards) {
    return (Array.isArray(shards) ? shards : [])
      .reduce((sum, shard) => sum + Math.max(0, Number(shard?.total_batches || 0)), 0)
  }

  function completedRowsBeforeShard(shards, activeShardIndex) {
    return (Array.isArray(shards) ? shards : [])
      .slice(0, Math.max(0, Number(activeShardIndex || 0)))
      .reduce((sum, shard) => sum + Math.max(0, Number(shard?.total_rows || 0)), 0)
  }

  function completedBatchesBeforeShard(shards, activeShardIndex) {
    return (Array.isArray(shards) ? shards : [])
      .slice(0, Math.max(0, Number(activeShardIndex || 0)))
      .reduce((sum, shard) => sum + Math.max(0, Number(shard?.total_batches || 0)), 0)
  }

  async function probeListCount(template, payload, label = '当前筛选') {
    const endpoint = String(template?.endpoint || '').trim()
    if (!endpoint) return { error: '缺少商品质量列表 API 模板 endpoint' }

    const response = await fetch(`${endpoint}?page_num=1&page_size=1`, {
      method: String(template.method || 'POST').trim().toUpperCase() || 'POST',
      headers: buildRequestHeaders(template.headers),
      body: JSON.stringify(deepClone(payload, {})),
      credentials: 'include',
    })
    const responsePayload = await readResponseJson(response)
    if (!responsePayload || !isSuccessPayload(responsePayload)) {
      return { error: explainPayloadError(responsePayload, `商品质量列表分片探测失败：${label}`) }
    }

    const count = resolveStrictTotalRows(responsePayload)
    if (count == null) {
      return { error: `商品质量列表分片探测未返回总数：${label}` }
    }
    return { count, payload: responsePayload }
  }

  async function splitByProductLevel(template, basePayload, parentCount, parentLabel) {
    const productValues = uniqueShardValues(basePayload.product_level_list, PRODUCT_LEVEL_SHARD_VALUES)
    const shards = []
    for (const productLevel of productValues) {
      const payload = {
        ...deepClone(basePayload, {}),
        product_level_list: [productLevel],
      }
      const label = `${parentLabel} / 商品层次=${productLevel}`
      const probed = await probeListCount(template, payload, label)
      if (probed.error) return { error: probed.error }
      if (probed.count <= 0) continue
      if (probed.count > ES_PAGE_LIMIT) {
        return { error: `商品质量列表分片仍超过 ${ES_PAGE_LIMIT} 条：${label}=${probed.count} 条，请先在页面缩小筛选范围后重试` }
      }
      shards.push(buildShard(label, payload, probed.count))
    }

    let covered = shardTotalRows(shards)
    if (covered !== Number(parentCount || 0)) {
      const discovered = await discoverAdditionalProductLevelShards(template, basePayload, parentLabel, productValues)
      if (discovered.error) return { error: discovered.error }
      if (Array.isArray(discovered.shards) && discovered.shards.length) {
        shards.push(...discovered.shards)
        covered = shardTotalRows(shards)
      }
    }

    if (covered !== Number(parentCount || 0)) {
      return { error: `商品质量列表商品层次分片覆盖不完整：${parentLabel} ${covered}/${parentCount} 条，请先在页面缩小筛选范围后重试` }
    }
    return { shards }
  }

  async function buildListShards(template) {
    const basePayload = deepClone(template?.payload, {})
    const baseProbe = await probeListCount(template, basePayload, '当前筛选')
    if (baseProbe.error) return { error: baseProbe.error }

    const baseCount = baseProbe.count
    if (baseCount <= ES_PAGE_LIMIT) {
      const shard = buildShard('当前筛选', basePayload, baseCount)
      return {
        shards: [shard],
        totalRows: baseCount,
        totalBatches: shard.total_batches,
      }
    }

    const qualityValues = uniqueShardValues(basePayload.goods_quality_level_list, QUALITY_LEVEL_SHARD_VALUES)
    const shards = []
    for (const qualityLevel of qualityValues) {
      const payload = {
        ...deepClone(basePayload, {}),
        goods_quality_level_list: [qualityLevel],
      }
      const label = `质量等级=${qualityLevel}`
      const probed = await probeListCount(template, payload, label)
      if (probed.error) return { error: probed.error }
      if (probed.count <= 0) continue

      if (probed.count > ES_PAGE_LIMIT) {
        const productSplit = await splitByProductLevel(template, payload, probed.count, label)
        if (productSplit.error) return { error: productSplit.error }
        shards.push(...productSplit.shards)
        continue
      }

      shards.push(buildShard(label, payload, probed.count))
    }

    const covered = shardTotalRows(shards)
    if (covered !== baseCount) {
      return { error: `商品质量列表质量等级分片覆盖不完整：${covered}/${baseCount} 条，请先在页面缩小筛选范围后重试` }
    }

    return {
      shards,
      totalRows: baseCount,
      totalBatches: shardTotalBatches(shards),
    }
  }

  function buildTemplateFromCapture(captureResult) {
    const match = pickCaptureMatch(captureResult)
    if (!match) return { error: '未捕获到商品质量列表请求，请确认当前页面筛选已生效' }

    const payload = safeJsonParse(match?.postData)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { error: '未解析到商品质量列表请求参数' }
    }

    const endpoint = extractPathname(match?.responseUrl || match?.url || '')
    const responsePayload = safeJsonParse(match?.body) || {}
    const filterPayload = applyRequestedFilterOverrides(stripPagingFields(payload))
    const totalRows = resolveTotalRows(responsePayload)
    const totalBatches = totalRows > 0 ? Math.ceil(totalRows / PAGE_SIZE) : 0

    return {
      listTemplate: {
        endpoint,
        method: String(match?.method || 'POST').trim().toUpperCase() || 'POST',
        headers: sanitizeHeaders(match?.headers),
        payload: deepClone(filterPayload, {}),
        filter_summary: summarizeFilters(filterPayload),
        filter_payload: filterPayload,
        total_rows: totalRows,
        total_batches: totalBatches,
      },
    }
  }

  async function readResponseJson(response) {
    if (!response) return null
    if (typeof response.json === 'function') {
      try {
        return await response.json()
      } catch (error) {}
    }
    if (typeof response.text === 'function') {
      try {
        return safeJsonParse(await response.text())
      } catch (error) {}
    }
    return null
  }

  function buildRequestHeaders(headers) {
    const merged = {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json; charset=utf-8',
      ...sanitizeHeaders(headers),
    }
    const result = {}
    const keyMap = new Map()
    for (const [rawKey, rawValue] of Object.entries(merged)) {
      const key = String(rawKey || '').trim()
      const value = String(rawValue || '').trim()
      if (!key || !value) continue
      const lowerKey = key.toLowerCase()
      const existingKey = keyMap.get(lowerKey)
      if (existingKey) {
        result[existingKey] = value
        continue
      }
      keyMap.set(lowerKey, key)
      result[key] = value
    }
    return result
  }

  function formatPercent(value) {
    if (value == null || value === '') return ''
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return String(value)
    return `${(numeric * 100).toFixed(2)}%`
  }

  function numericCell(value) {
    if (value == null || value === '') return ''
    return value
  }

  function firstValue(...values) {
    for (const value of values) {
      if (value != null && value !== '') return value
    }
    return undefined
  }

  function imageUrl(image) {
    if (!image || typeof image !== 'object') return ''
    return String(image.image_url || image.image_medium_url || image.image_small_url || '').trim()
  }

  function buildCountRateText(count, rate) {
    const countText = count == null || count === '' ? '' : String(count)
    const rateText = formatPercent(rate)
    if (countText && rateText) return `${countText} / ${rateText}`
    return countText || rateText || ''
  }

  function buildComparedRateText(prefix, ownRate, sameRate) {
    const own = Number(ownRate)
    const same = Number(sameRate)
    if (!Number.isFinite(own) || !Number.isFinite(same)) return ''
    const diff = (own - same) * 100
    if (diff > 0) return `${prefix}高于同品类${diff.toFixed(2)}%`
    if (diff < 0) return `${prefix}低于同品类${Math.abs(diff).toFixed(2)}%`
    return `${prefix}等于同品类`
  }

  function buildListRow(item, filterSummary) {
    const skcInfo = item?.skc_info || {}
    const spuInfo = item?.spu_info || {}
    const skc = String(skcInfo.skc_name || item?.skc || '').trim()
    const spu = String(spuInfo.spu_name || item?.spu || '').trim()
    const productName = String(skcInfo.product_name_multi || spuInfo.product_name_multi || item?.product_name_multi || item?.goods_name || '').trim()
    const qualityReturnVolume = firstValue(item?.quality_return_volume, item?.quality_return_cnt)
    const returnVolume = firstValue(item?.return_volume, item?.return_cnt)
    const qualityReturnRate = firstValue(item?.quality_return_rate, item?.qualityReturnRate)
    const badEvalRate = firstValue(item?.bad_eval_rate, item?.badEvalRate)
    const badEvalCnt = firstValue(item?.bad_eval_cnt, item?.badEvalCnt)
    const hasReturnDetail = canFetchReturnDetail(item, qualityReturnVolume, returnVolume)

    return {
      __sheet_name: '质量列表',
      __skc: skc,
      __spu: spu,
      商品名称: productName,
      SKC: skc,
      SPU: spu,
      SKC编码: String(skcInfo.skc_code || '').trim(),
      SPU编码: String(spuInfo.spu_code || '').trim(),
      商品图片: imageUrl(skcInfo.main_image_thumbnail),
      分类: String(item?.category_name || (Array.isArray(item?.category_name_list) ? item.category_name_list.join(' / ') : '') || '').trim(),
      商品层级: String(item?.product_grade || '').trim(),
      在售状态: formatOnSaleStatus(item?.on_sale_status),
      近7日销量: numericCell(item?.sales_volume7_days),
      质量等级: String(item?.goods_quality_level || '').trim(),
      质量等级类型: String(item?.goods_quality_level_type || '').trim(),
      风险等级: String(item?.od_risk_level || '').trim(),
      质量变化: String(item?.quality_level_change_desc || item?.quality_change_desc || '').trim(),
      '差评数/差评率': buildCountRateText(badEvalCnt, badEvalRate),
      同品类差评率: formatPercent(item?.same_cate_bad_eval_rate),
      差评率对比: buildComparedRateText('差评率', badEvalRate, item?.same_cate_bad_eval_rate),
      差评问题: String(item?.bad_label_text || '').replace(/\s+/g, ' ').trim(),
      '品退数/品退率': buildCountRateText(qualityReturnVolume, qualityReturnRate),
      退货量: numericCell(returnVolume),
      同品类品退率: formatPercent(item?.same_cate_quality_return_rate),
      品退率对比: buildComparedRateText('品退率', qualityReturnRate, item?.same_cate_quality_return_rate),
      售后服务量: numericCell(item?.refund_cnt),
      售后表现分: item?.last_score === -1 ? '暂无评分' : numericCell(item?.last_score),
      是否可查看客退详情: hasReturnDetail ? '是' : '否',
      筛选摘要: filterSummary || '',
    }
  }

  function formatOnSaleStatus(value) {
    const text = String(value ?? '').trim()
    if (!text) return ''
    if (text === '1') return '待售'
    if (text === '2') return '在售'
    if (text === '3') return '停售'
    return text
  }

  function canFetchReturnDetail(item, qualityReturnVolume, returnVolume) {
    if (item?.is_show_customer_return_reason === 0) return false
    if (item?.is_show_customer_return_reason === 1) return true
    return Number(qualityReturnVolume || 0) > 0 || Number(returnVolume || 0) > 0
  }

  function resolveMonthToken(...sources) {
    for (const source of sources) {
      if (source == null) continue
      if (typeof source === 'string' && /^\d{4}-\d{2}$/.test(source.trim())) return source.trim()
      if (typeof source !== 'object') continue
      const candidates = [
        source.month,
        source.return_month,
        source.stat_month,
        source.dt,
        Array.isArray(source.month_list) ? source.month_list[0] : '',
      ]
      for (const candidate of candidates) {
        const text = String(candidate || '').trim()
        const match = text.match(/^(\d{4})-?(\d{2})/)
        if (match) return `${match[1]}-${match[2]}`
      }
    }
    return currentMonthToken()
  }

  function readMonthToken(...sources) {
    for (const source of sources) {
      if (source == null) continue
      if (typeof source === 'string' && /^\d{4}-\d{2}$/.test(source.trim())) return source.trim()
      if (typeof source !== 'object') continue
      const candidates = [
        source.month,
        source.return_month,
        source.stat_month,
        source.dt,
        Array.isArray(source.month_list) ? source.month_list[0] : '',
      ]
      for (const candidate of candidates) {
        const text = String(candidate || '').trim()
        const match = text.match(/^(\d{4})-?(\d{2})/)
        if (match) return `${match[1]}-${match[2]}`
      }
    }
    return ''
  }

  function monthOffset(monthToken, offset) {
    const match = String(monthToken || '').match(/^(\d{4})-(\d{2})$/)
    const date = match
      ? new Date(Number(match[1]), Number(match[2]) - 1 + offset, 1)
      : new Date()
    const year = String(date.getFullYear()).padStart(4, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    return `${year}-${month}`
  }

  function recentMonthTokens(startMonth = currentMonthToken(), limit = DETAIL_MONTH_SCAN_LIMIT) {
    const count = Math.max(1, Number(limit || DETAIL_MONTH_SCAN_LIMIT))
    const months = []
    const seen = new Set()
    for (let index = 0; index < count; index += 1) {
      const month = monthOffset(startMonth, -index)
      if (seen.has(month)) continue
      seen.add(month)
      months.push(month)
    }
    return months
  }

  function hasRequestedProductSearch(filterPayload = {}) {
    return (
      (Array.isArray(filterPayload.skc_name_list) && filterPayload.skc_name_list.length > 0) ||
      (Array.isArray(filterPayload.spu_name_list) && filterPayload.spu_name_list.length > 0)
    )
  }

  function resolveDetailMonths(item, filterPayload = {}) {
    const explicitMonth = readMonthToken(item, filterPayload)
    if (explicitMonth) return [explicitMonth]
    if (hasRequestedProductSearch(filterPayload)) {
      return recentMonthTokens(currentMonthToken(), DETAIL_MONTH_SCAN_LIMIT)
    }
    return [currentMonthToken()]
  }

  function buildDetailQueueItem(item, filterPayload = {}) {
    const listRow = buildListRow(item, '')
    const skc = listRow.SKC
    const qualityReturnVolume = firstValue(item?.quality_return_volume, item?.quality_return_cnt)
    const returnVolume = firstValue(item?.return_volume, item?.return_cnt)
    if (!skc || !canFetchReturnDetail(item, qualityReturnVolume, returnVolume)) return null
    const months = resolveDetailMonths(item, filterPayload)
    return {
      skc,
      spu: listRow.SPU,
      product_name: listRow.商品名称,
      month: months[0] || resolveMonthToken(item, filterPayload),
      months,
      return_volume: returnVolume,
      quality_return_volume: qualityReturnVolume,
      quality_return_rate: firstValue(item?.quality_return_rate, item?.qualityReturnRate),
      same_cate_quality_return_rate: firstValue(item?.same_cate_quality_return_rate, item?.sameCateQualityReturnRate),
    }
  }

  function normalizeTargetMonths(target) {
    const months = Array.isArray(target?.months) && target.months.length
      ? target.months
      : [target?.month || currentMonthToken()]
    const seen = new Set()
    return months
      .map(item => readMonthToken(String(item || '')) || String(item || '').trim())
      .filter(Boolean)
      .filter(item => {
        if (seen.has(item)) return false
        seen.add(item)
        return true
      })
  }

  function currentMonthToken() {
    const date = new Date()
    const year = String(date.getFullYear()).padStart(4, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    return `${year}-${month}`
  }

  function ensureDetailTemplate() {
    const template = shared.detail_template && typeof shared.detail_template === 'object'
      ? deepClone(shared.detail_template, {})
      : null
    if (template && String(template.endpoint || '').trim()) return template
    const listTemplate = shared.list_template && typeof shared.list_template === 'object'
      ? shared.list_template
      : {}
    return {
      endpoint: DETAIL_ENDPOINT,
      method: 'POST',
      headers: sanitizeHeaders(listTemplate.headers),
      payload: {},
    }
  }

  function buildDetailRow(item, target, indexOffset = 0) {
    const qualityFlag = String(item?.quality_flag ?? '').trim()
    return {
      __sheet_name: '客退详情',
      SKC: target.skc || '',
      SPU: target.spu || '',
      商品名称: target.product_name || '',
      退货月份: target.month || '',
      品退数: numericCell(target.quality_return_volume),
      退货量: numericCell(target.return_volume),
      品退率: formatPercent(target.quality_return_rate),
      同品类品退率: formatPercent(target.same_cate_quality_return_rate),
      序号: String(item?.return_order_id || item?.order_no || indexOffset || '').trim(),
      退货时间: String(item?.return_order_time || item?.return_time || '').trim(),
      站点: String(item?.country_site || item?.site || '').trim(),
      是否品退: qualityFlag === '1' ? '是' : qualityFlag === '0' ? '否' : qualityFlag,
      SKU: String(item?.sku || item?.sku_code || '').trim(),
      客退原因: String(item?.return_reason_nm || item?.return_reason || '').trim(),
    }
  }

  function updateListProgressShared(next = {}) {
    return {
      ...shared,
      ...next,
      current_store: next.current_store || shared.current_store || '商品质量列表',
    }
  }

  function buildListStageShared(next = {}) {
    const totalRows = Math.max(0, Number(next.total_rows ?? shared.total_rows ?? 0))
    const currentRows = Math.max(0, Number(next.current_exec_no ?? shared.current_exec_no ?? 0))
    const totalBatches = Math.max(0, Number(next.total_batches ?? shared.total_batches ?? 0))
    const completedBatches = Math.max(0, Number(next.batch_no ?? shared.batch_no ?? 0))
    return {
      list_total_rows: totalRows,
      list_completed_rows: Math.min(currentRows, totalRows || currentRows),
      list_total_batches: totalBatches,
      list_completed_batches: Math.min(completedBatches, totalBatches || completedBatches),
    }
  }

  function buildDetailStageShared(queue, next = {}) {
    const targets = Array.isArray(queue) ? queue : []
    const detailIndex = Math.max(0, Number(next.detail_index ?? shared.detail_index ?? 0))
    const hasMore = detailIndex < targets.length
    const target = hasMore ? (targets[detailIndex] || {}) : {}
    const currentTargetIndex = hasMore ? detailIndex + 1 : targets.length
    return {
      detail_total_targets: targets.length,
      detail_completed_targets: Math.min(detailIndex, targets.length),
      detail_current_target_index: currentTargetIndex,
      detail_current_target: hasMore ? String(target.skc || '').trim() : '',
      detail_records_collected: Math.max(0, Number(next.detail_records_collected ?? shared.detail_records_collected ?? 0)),
    }
  }

  try {
    if (phase === 'main') {
      if (!isTargetPage()) {
        location.href = TARGET_URL
        return nextPhase('main', 1800)
      }

      if (shared.list_done && Array.isArray(shared.detail_queue) && shared.detail_index < shared.detail_queue.length) {
        return nextPhase('collect_detail_page', 0)
      }

      if (shared.list_template && !shared.list_shards) {
        return nextPhase('prepare_list_shards', 0)
      }

      if (shared.list_template) {
        return nextPhase('collect_list_page', 0)
      }

      if (shared[CAPTURE_KEY]) {
        return nextPhase('prepare_template', 0)
      }

      const ready = await waitFor(pageReady, 10000, 250)
      if (!ready) {
        return fail('SHEIN 商品质量页面未加载完成，请确认已登录并打开页面')
      }

      const capturePlan = getCapturePlan()
      if (!capturePlan.clicks.length) {
        return fail('未找到可用于继承当前筛选的搜索或翻页控件')
      }

      const captured = await captureListRequestViaPageActions()
      if (captured.error) return fail(captured.error)

      return nextPhase('prepare_template', 0, {
        ...shared,
        capture_source: captured.source || capturePlan.source,
        [CAPTURE_KEY]: captured.captureResult,
      })
    }

    if (phase === 'prepare_template') {
      if (shared.list_template) {
        return nextPhase('collect_list_page', 0)
      }

      if (persistedRequestShared.requestedSkcList.length && persistedRequestShared.requestedSpuList.length) {
        return fail('SKC 和 SPU 批量搜索一次只能选择一种，请分次运行')
      }

      const prepared = buildTemplateFromCapture(shared[CAPTURE_KEY])
      if (prepared.error) return fail(prepared.error)

      return nextPhase('prepare_list_shards', 0, {
        ...shared,
        list_template: prepared.listTemplate,
        list_page: 1,
        active_shard_index: 0,
        detail_queue: [],
        detail_index: 0,
        detail_page: 1,
        total_rows: prepared.listTemplate.total_rows || 0,
        total_batches: prepared.listTemplate.total_batches || 0,
        batch_no: 0,
        current_exec_no: 0,
        current_store: ['商品质量列表', prepared.listTemplate.filter_summary].filter(Boolean).join(' / '),
        [CAPTURE_KEY]: null,
      })
    }

    if (phase === 'prepare_list_shards') {
      const template = shared.list_template || {}
      if (!String(template.endpoint || '').trim()) return fail('缺少商品质量列表 API 模板 endpoint')

      if (Array.isArray(shared.list_shards) && shared.list_shards.length) {
        return nextPhase('collect_list_page', 0)
      }

      const preparedShards = await buildListShards(template)
      if (preparedShards.error) return fail(preparedShards.error)

      const totalRows = Number(preparedShards.totalRows || 0)
      const totalBatches = Number(preparedShards.totalBatches || 0)
      const nextTemplate = {
        ...template,
        total_rows: totalRows,
        total_batches: totalBatches,
      }

      return nextPhase('collect_list_page', 0, {
        ...shared,
        list_template: nextTemplate,
        list_shards: preparedShards.shards,
        active_shard_index: 0,
        list_page: 1,
        total_rows: totalRows,
        total_batches: totalBatches,
        batch_no: 0,
        current_exec_no: 0,
        ...buildListStageShared({
          total_rows: totalRows,
          total_batches: totalBatches,
          batch_no: 0,
          current_exec_no: 0,
        }),
        current_store: ['商品质量列表', template.filter_summary, preparedShards.shards.length > 1 ? `${preparedShards.shards.length} 个分片` : ''].filter(Boolean).join(' / '),
      })
    }

    if (phase === 'collect_list_page') {
      const template = shared.list_template || {}
      const endpoint = String(template.endpoint || '').trim()
      if (!endpoint) return fail('缺少商品质量列表 API 模板 endpoint')

      const listShards = Array.isArray(shared.list_shards) && shared.list_shards.length
        ? shared.list_shards
        : [buildShard('当前筛选', template.payload || {}, Number(template.total_rows || 0))]
      const activeShardIndex = Math.max(0, Math.min(listShards.length - 1, Number(shared.active_shard_index || 0)))
      const activeShard = listShards[activeShardIndex] || listShards[0] || buildShard('当前筛选', template.payload || {}, 0)
      const listPage = Math.max(1, Number(shared.list_page || page || 1))
      const requestPayload = deepClone(activeShard.payload || template.payload, {})
      const response = await fetch(`${endpoint}?page_num=${listPage}&page_size=${PAGE_SIZE}`, {
        method: String(template.method || 'POST').trim().toUpperCase() || 'POST',
        headers: buildRequestHeaders(template.headers),
        body: JSON.stringify(requestPayload),
        credentials: 'include',
      })
      const payload = await readResponseJson(response)
      if (!payload || !isSuccessPayload(payload)) {
        return fail(explainPayloadError(payload, '商品质量列表接口请求失败'))
      }

      const list = Array.isArray(payload?.info?.data) ? payload.info.data : []
      const shardTotal = resolveTotalRows(payload, Number(activeShard.total_rows || 0))
      const shardBatches = shardTotal > 0 ? Math.ceil(shardTotal / PAGE_SIZE) : (list.length >= PAGE_SIZE ? listPage + 1 : listPage)
      const nextListShards = listShards.map((shard, index) => index === activeShardIndex
        ? {
            ...shard,
            total_rows: shardTotal,
            total_batches: shardBatches,
          }
        : shard)
      const totalRows = shardTotalRows(nextListShards) || resolveTotalRows(payload, Number(template.total_rows || 0))
      const totalBatches = shardTotalBatches(nextListShards) || Number(template.total_batches || shardBatches)
      const completedRowsBefore = completedRowsBeforeShard(nextListShards, activeShardIndex)
      const completedBatchesBefore = completedBatchesBeforeShard(nextListShards, activeShardIndex)
      const listRows = list.map(item => buildListRow(item, template.filter_summary))
      const nextDetailQueue = [
        ...(Array.isArray(shared.detail_queue) ? shared.detail_queue : []),
        ...list.map(item => buildDetailQueueItem(item, activeShard.payload || template.payload)).filter(Boolean),
      ]

      const nextListTemplate = {
        ...template,
        total_rows: totalRows,
        total_batches: totalBatches,
      }

      if (listPage < shardBatches) {
        return complete(listRows, true, updateListProgressShared({
          list_template: nextListTemplate,
          list_shards: nextListShards,
          active_shard_index: activeShardIndex,
          list_page: listPage + 1,
          detail_queue: nextDetailQueue,
          total_rows: totalRows,
          total_batches: totalBatches,
          batch_no: completedBatchesBefore + listPage,
          current_exec_no: Math.min(completedRowsBefore + listPage * PAGE_SIZE, totalRows || completedRowsBefore + listPage * PAGE_SIZE),
          ...buildListStageShared({
            total_rows: totalRows,
            total_batches: totalBatches,
            batch_no: completedBatchesBefore + listPage,
            current_exec_no: Math.min(completedRowsBefore + listPage * PAGE_SIZE, totalRows || completedRowsBefore + listPage * PAGE_SIZE),
          }),
          ...buildDetailStageShared(nextDetailQueue, {
            detail_index: Math.max(0, Number(shared.detail_index || 0)),
            detail_records_collected: Number(shared.detail_records_collected || 0),
          }),
          current_store: ['商品质量列表', activeShard.label, template.filter_summary].filter(Boolean).join(' / '),
        }))
      }

      const hasNextShard = activeShardIndex + 1 < nextListShards.length
      if (hasNextShard) {
        return complete(listRows, true, updateListProgressShared({
          list_template: nextListTemplate,
          list_shards: nextListShards,
          active_shard_index: activeShardIndex + 1,
          list_page: 1,
          detail_queue: nextDetailQueue,
          total_rows: totalRows,
          total_batches: totalBatches,
          batch_no: completedBatchesBefore + shardBatches,
          current_exec_no: Math.min(completedRowsBefore + shardTotal, totalRows || completedRowsBefore + shardTotal),
          ...buildListStageShared({
            total_rows: totalRows,
            total_batches: totalBatches,
            batch_no: completedBatchesBefore + shardBatches,
            current_exec_no: Math.min(completedRowsBefore + shardTotal, totalRows || completedRowsBefore + shardTotal),
          }),
          ...buildDetailStageShared(nextDetailQueue, {
            detail_index: Math.max(0, Number(shared.detail_index || 0)),
            detail_records_collected: Number(shared.detail_records_collected || 0),
          }),
          current_store: ['商品质量列表', nextListShards[activeShardIndex + 1]?.label || '', template.filter_summary].filter(Boolean).join(' / '),
        }))
      }

      if (nextDetailQueue.length) {
        return nextPhase('collect_detail_page', 0, updateListProgressShared({
          list_template: nextListTemplate,
          list_shards: nextListShards,
          active_shard_index: activeShardIndex,
          list_page: listPage,
          detail_queue: nextDetailQueue,
          detail_index: Math.max(0, Number(shared.detail_index || 0)),
          detail_page: Math.max(1, Number(shared.detail_page || 1)),
          list_done: true,
          total_rows: totalRows,
          total_batches: totalBatches,
          batch_no: totalBatches,
          current_exec_no: totalRows || ((listPage - 1) * PAGE_SIZE + listRows.length),
          ...buildListStageShared({
            total_rows: totalRows,
            total_batches: totalBatches,
            batch_no: totalBatches,
            current_exec_no: totalRows || ((listPage - 1) * PAGE_SIZE + listRows.length),
          }),
          ...buildDetailStageShared(nextDetailQueue, {
            detail_index: Math.max(0, Number(shared.detail_index || 0)),
            detail_records_collected: Number(shared.detail_records_collected || 0),
          }),
          current_store: '商品质量列表已完成，开始抓取客退详情',
        }), listRows)
      }

      return complete(listRows, false, updateListProgressShared({
        list_template: nextListTemplate,
        list_shards: nextListShards,
        active_shard_index: activeShardIndex,
        detail_queue: nextDetailQueue,
        total_rows: totalRows,
        total_batches: totalBatches,
        batch_no: totalBatches,
        current_exec_no: totalRows || ((listPage - 1) * PAGE_SIZE + listRows.length),
        ...buildListStageShared({
          total_rows: totalRows,
          total_batches: totalBatches,
          batch_no: totalBatches,
          current_exec_no: totalRows || ((listPage - 1) * PAGE_SIZE + listRows.length),
        }),
        ...buildDetailStageShared(nextDetailQueue, {
          detail_index: Math.max(0, Number(shared.detail_index || 0)),
          detail_records_collected: Number(shared.detail_records_collected || 0),
        }),
        current_store: '商品质量列表',
      }))
    }

    if (phase === 'collect_detail_page') {
      const queue = Array.isArray(shared.detail_queue) ? shared.detail_queue : []
      let detailIndex = Math.max(0, Number(shared.detail_index || 0))
      if (detailIndex >= queue.length) {
        return complete([], false, {
          ...shared,
          current_store: '客退详情抓取完成',
        })
      }

      const template = ensureDetailTemplate()
      const endpoint = String(template.endpoint || DETAIL_ENDPOINT).trim()
      let detailPage = Math.max(1, Number(shared.detail_page || 1))
      let detailMonthIndex = Math.max(0, Number(shared.detail_month_index || 0))
      let detailTotalRows = 0
      let detailTotalPages = 0
      const rows = []
      let requestCount = 0
      const startingDetailRecords = Math.max(0, Number(shared.detail_records_collected || 0))

      while (detailIndex < queue.length && requestCount < DETAIL_BATCH_REQUESTS) {
        const target = queue[detailIndex] || {}
        const targetMonths = normalizeTargetMonths(target)
        const activeMonth = targetMonths[Math.min(detailMonthIndex, targetMonths.length - 1)] || target.month || currentMonthToken()
        const basePayload = deepClone(template.payload || {}, {})
        delete basePayload.page_num
        delete basePayload.page_size
        const requestPayload = {
          ...basePayload,
          month: activeMonth || basePayload.month || currentMonthToken(),
          skc: target.skc,
        }

        const response = await fetch(`${endpoint}?page_num=${detailPage}&page_size=${DETAIL_PAGE_SIZE}`, {
          method: String(template.method || 'POST').trim().toUpperCase() || 'POST',
          headers: buildRequestHeaders(template.headers),
          body: JSON.stringify(requestPayload),
          credentials: 'include',
        })
        const payload = await readResponseJson(response)
        if (!payload || !isSuccessPayload(payload)) {
          return fail(explainPayloadError(payload, `客退详情接口请求失败：${target.skc || '未知 SKC'}`))
        }

        const list = Array.isArray(payload?.info?.data) ? payload.info.data : []
        const totalRows = resolveTotalRows(payload, 0)
        const totalPages = totalRows > 0
          ? Math.ceil(totalRows / DETAIL_PAGE_SIZE)
          : (list.length >= DETAIL_PAGE_SIZE ? detailPage + 1 : detailPage)
        const offset = (detailPage - 1) * DETAIL_PAGE_SIZE
        const monthTarget = { ...target, month: activeMonth }
        rows.push(...list.map((item, index) => buildDetailRow(item, monthTarget, offset + index + 1)))

        detailTotalRows = totalRows
        detailTotalPages = totalPages
        requestCount += 1

        if (detailPage < totalPages) {
          detailPage += 1
          break
        }

        detailMonthIndex += 1
        if (detailMonthIndex >= targetMonths.length) {
          detailIndex += 1
          detailMonthIndex = 0
        }
        detailPage = 1
      }

      const hasMore = detailIndex < queue.length
      const currentTarget = queue[detailIndex] || queue[Math.max(0, detailIndex - 1)] || {}
      const detailCurrentStore = hasMore
        ? detailPage > 1
          ? `客退详情 ${currentTarget.skc || ''} ${detailPage - 1}/${detailTotalPages || detailPage}`
          : `客退详情 ${currentTarget.skc || ''} ${detailIndex + 1}/${queue.length}`
        : '客退详情抓取完成'

      const nextShared = {
        ...shared,
        detail_template: template,
        detail_index: detailIndex,
        detail_page: detailPage,
        detail_month_index: detailMonthIndex,
        ...buildDetailStageShared(queue, {
          detail_index: detailIndex,
          detail_records_collected: startingDetailRecords + rows.length,
        }),
        list_total_rows: Math.max(0, Number(shared.list_total_rows || shared.total_rows || 0)),
        list_completed_rows: Math.max(0, Number(shared.list_completed_rows || shared.current_exec_no || shared.total_rows || 0)),
        list_total_batches: Math.max(0, Number(shared.list_total_batches || shared.total_batches || 0)),
        list_completed_batches: Math.max(0, Number(shared.list_completed_batches || shared.batch_no || shared.total_batches || 0)),
        detail_total_rows: detailTotalRows,
        detail_total_pages: detailTotalPages,
        detail_current_page: Math.max(1, detailPage > 1 ? detailPage - 1 : detailPage),
        detail_request_count: Number(shared.detail_request_count || 0) + requestCount,
        current_store: detailCurrentStore,
      }

      if (hasMore) {
        return nextPhase('collect_detail_page', 120, nextShared, rows)
      }

      return complete(rows, false, nextShared)
    }

    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || error)
  }
})()
