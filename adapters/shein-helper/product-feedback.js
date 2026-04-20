;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = Number(window.__CRAWSHRIMP_PAGE__ || 1)
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const TARGET_URL = 'https://sso.geiwohuo.com/#/mgs/store-management/product-feedback'
  const PAGE_SIZE = 200
  const CAPTURE_KEY = 'captureResult'
  const SEEN_KEY = '__CRAWSHRIMP_SHEIN_PRODUCT_FEEDBACK_SEEN__'
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
    requestedReviewDateRange: normalizeDateRangeParam(shared.requestedReviewDateRange || params.review_date_range),
  }

  function normalizeDateRangeParam(value) {
    if (!value || typeof value !== 'object') return {}
    const start = String(value.start || '').trim()
    const end = String(value.end || '').trim()
    if (!start || !end) return {}
    return { start, end }
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

  function mergeShared(next = shared) {
    return {
      ...persistedRequestShared,
      ...(next || {}),
    }
  }

  function nextPhase(name, sleepMs = 800, next = shared) {
    return {
      success: true,
      data: [],
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

  function captureClickRequests(clicks, nextPhaseName, options = {}, next = shared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'capture_click_requests',
        clicks,
        matches: options.matches || [],
        timeout_ms: options.timeout_ms || 12000,
        settle_ms: options.settle_ms == null ? 800 : options.settle_ms,
        min_matches: options.min_matches || 1,
        include_response_body: options.include_response_body !== false,
        shared_key: options.shared_key || CAPTURE_KEY,
        shared_append: !!options.shared_append,
        strict: !!options.strict,
        next_phase: nextPhaseName,
        sleep_ms: options.sleep_ms || 0,
        shared: mergeShared(next),
      },
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
      /goods\/comment\/list/i.test(String(match?.responseUrl || match?.url || '')),
    ) || null
  }

  function buildCaptureMatches() {
    return [
      { url_contains: '/goods/comment/list' },
    ]
  }

  function hasRequestedReviewDateRange() {
    return !!(persistedRequestShared.requestedReviewDateRange.start && persistedRequestShared.requestedReviewDateRange.end)
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

  function getPagerButtons() {
    return [...document.querySelectorAll('button')]
      .filter(isVisible)
      .filter(button => hasClassFragment(button, 'pagination'))
  }

  function getPagerCaptureClick() {
    return getCenterClick(getPagerCaptureButton())
  }

  function getQueryCaptureClick() {
    return getCenterClick(getQueryCaptureButton())
  }

  function getCapturePlan() {
    const queryClick = getQueryCaptureClick()
    const pagerClick = getPagerCaptureClick()
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

  async function captureListRequestViaPageActions() {
    const queryButton = getQueryCaptureButton()
    const pagerButton = getPagerCaptureButton()
    if (!queryButton && !pagerButton) {
      return { error: '未找到可用于继承当前筛选的查询或翻页控件' }
    }

    const matches = []
    const pushMatch = match => {
      if (!match) return
      const urlText = String(match.responseUrl || match.url || '')
      if (!/goods\/comment\/list/i.test(urlText)) return
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
            if (/goods\/comment\/list/i.test(String(response?.url || requestUrl || ''))) {
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
        return { error: '未捕获到商品评价列表请求，请确认当前页面筛选已生效' }
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
    return href.includes('#/mgs/store-management/product-feedback') || /商品评价|商品反馈/.test(body)
  }

  function pageReady() {
    const body = textOf(document.body)
    return /商品评价|商品反馈/.test(body) && (getPagerButtons().length > 0 || document.querySelectorAll('tbody tr').length > 0)
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

  function stripPagingFields(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
    const next = {}
    for (const [key, value] of Object.entries(payload)) {
      if (value == null) continue
      if (['page', 'perPage', 'pageNum', 'pageSize'].includes(key)) continue
      if (Array.isArray(value) && value.length === 0) continue
      if (!Array.isArray(value) && typeof value !== 'object' && String(value).trim() === '') continue
      next[key] = value
    }
    return next
  }

  function normalizeHyphenDate(value) {
    const text = String(value || '').trim()
    if (!text) return ''
    const match = text.match(/\d{4}[-/]\d{2}[-/]\d{2}/)
    if (!match) return ''
    return match[0].replace(/\//g, '-')
  }

  function buildReviewBoundary(dateText, endOfDay = false) {
    const date = normalizeHyphenDate(dateText)
    if (!date) return ''
    return `${date} ${endOfDay ? '23:59:59' : '00:00:00'}`
  }

  function buildReviewInputValue(dateText, endOfDay = false) {
    const date = normalizeHyphenDate(dateText)
    if (!date) return ''
    return `${date} ${endOfDay ? '23:59' : '00:00'}`
  }

  function formatDateToken(value) {
    const text = String(value || '').trim()
    if (!text) return ''
    const datePart = text.match(/\d{4}-\d{2}-\d{2}/)?.[0]
    return datePart || text
  }

  function applyRequestedReviewDateRange(payload, requestedRange) {
    const filterPayload = deepClone(payload, {})
    const requestedStart = buildReviewBoundary(requestedRange?.start, false)
    const requestedEnd = buildReviewBoundary(requestedRange?.end, true)
    if (!requestedStart || !requestedEnd) {
      if (requestedRange?.start || requestedRange?.end) {
        return { error: '请选择完整的评价时间范围' }
      }
      return {
        filterPayload,
        filterSummary: summarizeFilters(filterPayload),
        changed: false,
      }
    }

    const currentStart = String(filterPayload.startCommentTime || filterPayload.commentStartTime || '').trim()
    const currentEnd = String(filterPayload.commentEndTime || filterPayload.endCommentTime || '').trim()
    filterPayload.startCommentTime = requestedStart
    filterPayload.commentEndTime = requestedEnd
    if (Object.prototype.hasOwnProperty.call(filterPayload, 'commentStartTime')) {
      filterPayload.commentStartTime = requestedStart
    }
    if (Object.prototype.hasOwnProperty.call(filterPayload, 'endCommentTime')) {
      filterPayload.endCommentTime = requestedEnd
    }

    return {
      filterPayload,
      filterSummary: summarizeFilters(filterPayload),
      changed: currentStart !== requestedStart || currentEnd !== requestedEnd,
    }
  }

  function getReactFiberKey(target) {
    return Object.keys(target || {}).find(key =>
      key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'),
    ) || ''
  }

  function getReactFiber(target) {
    const fiberKey = getReactFiberKey(target)
    return fiberKey ? target[fiberKey] : null
  }

  function getReactProps(target) {
    const propsKey = Object.keys(target || {}).find(key => key.startsWith('__reactProps$')) || ''
    return propsKey ? target[propsKey] : null
  }

  function getInputPlaceholder(input) {
    return String(input?.getAttribute?.('placeholder') || input?.placeholder || '').trim()
  }

  function dispatchInputEvent(input, type) {
    const EventCtor = globalThis.Event || window?.Event
    if (!input || typeof EventCtor !== 'function') return
    try {
      input.dispatchEvent?.(new EventCtor(type, { bubbles: true }))
    } catch (error) {}
  }

  function applyInputValue(input, nextValue) {
    if (!input) return
    const hadReadonlyAttr = input?.getAttribute?.('readonly') != null
    const wasReadOnly = hadReadonlyAttr || !!input?.readOnly
    try { input.removeAttribute?.('readonly') } catch (error) {}
    try { input.readOnly = false } catch (error) {}
    try { input.value = nextValue } catch (error) {}
    dispatchInputEvent(input, 'input')
    dispatchInputEvent(input, 'change')
    try { getReactProps(input)?.onChange?.({ target: { value: nextValue } }) } catch (error) {}
    if (!wasReadOnly) return
    try { input.setAttribute?.('readonly', 'readonly') } catch (error) {}
    try { input.readOnly = true } catch (error) {}
  }

  function matchesReviewInputValue(actualValue, requestedDate, endOfDay = false) {
    const expectedDate = normalizeHyphenDate(requestedDate)
    const actualText = String(actualValue || '').trim()
    if (!expectedDate || !actualText) return false
    if (normalizeHyphenDate(actualText) !== expectedDate) return false
    return endOfDay
      ? /23:59(?::59)?/.test(actualText)
      : /00:00(?::00)?/.test(actualText)
  }

  function invokeRangeHandler(propName, handler, candidate) {
    try { handler(candidate) } catch (error) {}
    if (propName !== 'onPickerChange' || !Array.isArray(candidate)) return
    try { handler(candidate, candidate.map(item => String(item || ''))) } catch (error) {}
  }

  async function attemptInjectRequestedReviewDateRange() {
    const range = persistedRequestShared.requestedReviewDateRange
    if (!range.start || !range.end) {
      return { attempted: false, applied: false, reason: 'no_requested_range' }
    }

    const startInput = [...document.querySelectorAll('input')].find(el =>
      getInputPlaceholder(el) === '开始日期',
    ) || null
    const endInput = [...document.querySelectorAll('input')].find(el =>
      getInputPlaceholder(el) === '结束日期',
    ) || null
    if (!startInput || !endInput) {
      return { attempted: true, applied: false, reason: 'date_inputs_not_found' }
    }

    const requestedStartText = buildReviewInputValue(range.start, false)
    const requestedEndText = buildReviewInputValue(range.end, true)
    const requestedStartFull = buildReviewBoundary(range.start, false)
    const requestedEndFull = buildReviewBoundary(range.end, true)

    applyInputValue(startInput, requestedStartText)
    applyInputValue(endInput, requestedEndText)

    const candidateRanges = [
      [
        new Date(`${normalizeHyphenDate(range.start)}T00:00:00+08:00`),
        new Date(`${normalizeHyphenDate(range.end)}T23:59:59+08:00`),
      ],
      [requestedStartFull, requestedEndFull],
      [requestedStartText, requestedEndText],
    ].filter(candidate => candidate[0] && candidate[1])

    const rangeHandlers = new Map()
    for (const input of [startInput, endInput]) {
      let fiber = getReactFiber(input)
      let depth = 0
      while (fiber && depth < 20) {
        const props = fiber.memoizedProps || {}
        const looksLikeRangePicker =
          props.range ||
          (Array.isArray(props.value) && props.value.length === 2) ||
          /yyyy-MM-dd/.test(String(props.format || ''))
        if (looksLikeRangePicker) {
          for (const propName of ['onChange', 'onPickerChange']) {
            const handler = props[propName]
            if (typeof handler === 'function' && !rangeHandlers.has(handler)) {
              rangeHandlers.set(handler, propName)
            }
          }
        }
        fiber = fiber.return
        depth += 1
      }
    }

    for (const [handler, propName] of rangeHandlers.entries()) {
      for (const candidate of candidateRanges) {
        invokeRangeHandler(propName, handler, candidate)
      }
    }

    await sleep(150)

    const startValue = String(startInput.value || '').trim()
    const endValue = String(endInput.value || '').trim()
    const applied =
      matchesReviewInputValue(startValue, range.start, false) &&
      matchesReviewInputValue(endValue, range.end, true)

    return {
      attempted: true,
      applied,
      reason: applied ? '' : 'readback_mismatch',
      handler_count: rangeHandlers.size,
      startValue,
      endValue,
    }
  }

  function summarizeFilters(payload) {
    const parts = []
    const start = formatDateToken(payload.startCommentTime || payload.commentStartTime)
    const end = formatDateToken(payload.commentEndTime || payload.endCommentTime)
    if (start && end) {
      parts.push(`评价时间=${start}~${end}`)
    } else if (start || end) {
      parts.push(`评价时间=${start || end}`)
    }

    const mapping = [
      ['goodsTitle', '商品标题'],
      ['goodsName', '商品标题'],
      ['goodSn', '货号'],
      ['spu', 'SPU'],
      ['skc', 'SKC'],
      ['sku', 'SKU'],
      ['goodsCommentStarName', '星级'],
      ['dataCenterName', '数据中心'],
    ]
    for (const [key, label] of mapping) {
      const value = payload[key]
      if (value == null) continue
      const text = Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean).join(',') : String(value).trim()
      if (!text) continue
      parts.push(`${label}=${text}`)
    }

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

  function flattenImageUrls(value) {
    const urls = []
    const seen = new Set()

    const push = candidate => {
      const text = String(candidate || '').trim()
      if (!text || seen.has(text)) return
      seen.add(text)
      urls.push(text)
    }

    const visit = candidate => {
      if (!candidate) return
      if (Array.isArray(candidate)) {
        candidate.forEach(visit)
        return
      }
      if (typeof candidate === 'string') {
        push(candidate)
        return
      }
      if (typeof candidate === 'object') {
        for (const key of ['url', 'src', 'imageUrl', 'imgUrl', 'originUrl']) {
          if (candidate[key]) push(candidate[key])
        }
      }
    }

    visit(value)
    return urls
  }

  function getSeenRows() {
    if (!window[SEEN_KEY] || typeof window[SEEN_KEY] !== 'object') {
      window[SEEN_KEY] = Object.create(null)
    }
    return window[SEEN_KEY]
  }

  function resetSeenRows() {
    window[SEEN_KEY] = Object.create(null)
  }

  function dedupeRows(rows) {
    return Array.isArray(rows) ? rows : []
  }

  function buildFeedbackRow(item, filterSummary) {
    const row = {
      评价ID: String(item?.commentId || item?.id || '').trim(),
      商品标题: String(item?.goodsTitle || item?.goodsName || '').trim(),
      商品主图: String(item?.goodsThumb || item?.goodsImg || '').trim(),
      商品属性: String(item?.goodsAttribute || item?.skuAttribute || '').trim(),
      货号: String(item?.goodSn || item?.goodsSn || '').trim(),
      SPU: String(item?.spu || '').trim(),
      SKC: String(item?.skc || '').trim(),
      SKU: String(item?.sku || '').trim(),
      星级: item?.goodsCommentStar ?? item?.commentStar ?? '',
      星级标签: String(item?.goodsCommentStarName || item?.commentStarName || '').trim(),
      评价内容: String(item?.goodsCommentContent || item?.commentContent || '').trim(),
      评价时间: String(item?.commentTime || item?.createTime || '').trim(),
      供应单号: String(item?.supplyOrderNo || item?.orderNo || '').trim(),
      数据中心: String(item?.dataCenterName || '').trim(),
      筛选摘要: filterSummary || '',
    }

    flattenImageUrls(item?.goodsCommentImages).forEach((url, index) => {
      row[`评价图片${index + 1}`] = url
    })

    return row
  }

  function buildTemplateFromCapture(captureResult, options = {}) {
    const match = pickCaptureMatch(captureResult)
    if (!match) return { error: '未捕获到商品评价列表请求，请确认当前页面筛选已生效' }

    const payload = safeJsonParse(match?.postData)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { error: '未解析到商品评价列表请求参数' }
    }

    const responsePayload = safeJsonParse(match?.body) || {}
    const rawFilterPayload = stripPagingFields(payload)
    const reviewRangeResult = applyRequestedReviewDateRange(rawFilterPayload, options.reviewDateRange)
    if (reviewRangeResult.error) return { error: reviewRangeResult.error }

    const filterPayload = reviewRangeResult.filterPayload
    const filterSummary = reviewRangeResult.filterSummary
    const fullPayload = {
      ...deepClone(payload, {}),
      ...filterPayload,
    }
    const preserveCapturedTotals = !reviewRangeResult.changed
    const totalRows = preserveCapturedTotals ? resolveTotalRows(responsePayload) : 0
    const totalBatches = preserveCapturedTotals && totalRows > 0 ? Math.ceil(totalRows / PAGE_SIZE) : 0

    return {
      apiTemplate: {
        endpoint: extractPathname(match?.responseUrl || match?.url || ''),
        method: String(match?.method || 'POST').trim().toUpperCase() || 'POST',
        headers: sanitizeHeaders(match?.headers),
        payload: fullPayload,
        filter_summary: filterSummary,
        filter_payload: filterPayload,
      },
      totalRows,
      totalBatches,
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
      'Content-Type': 'application/json',
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

  function buildProgressShared(template, totalRows, totalBatches, rowsOnCurrentPage) {
    const filterSummary = String(template?.filter_summary || '').trim()
    const exactCompleted = Math.max(0, ((Math.max(1, page) - 1) * PAGE_SIZE) + Math.max(0, Number(rowsOnCurrentPage || 0)))
    const currentExecNo = totalRows > 0 ? Math.min(exactCompleted, totalRows) : exactCompleted
    return {
      ...shared,
      total_rows: totalRows,
      total_batches: totalBatches,
      batch_no: totalBatches > 0 ? Math.min(page, totalBatches) : 0,
      current_exec_no: currentExecNo,
      current_store: filterSummary || '商品评价',
    }
  }

  try {
    if (phase === 'main') {
      if (!isTargetPage()) {
        location.href = TARGET_URL
        return nextPhase('main', 1800)
      }

      if (shared.api_template) {
        return nextPhase('collect_page', 0)
      }

      if (shared[CAPTURE_KEY]) {
        return nextPhase('prepare_template', 0)
      }

      resetSeenRows()

      if (hasRequestedReviewDateRange() && !shared.review_date_range_injection_attempted) {
        return nextPhase('inject_review_date_range', 0)
      }

      const ready = await waitFor(pageReady, 10000, 250)
      if (!ready) {
        return fail('SHEIN 商品评价页面未加载完成，请确认已登录并打开商品评价列表')
      }

      const capturePlan = getCapturePlan()
      if (!capturePlan.clicks.length) {
        return fail('未找到可用于继承当前筛选的查询或翻页控件')
      }

      const captured = await captureListRequestViaPageActions()
      if (captured.error) return fail(captured.error)

      return nextPhase('prepare_template', 0, {
        ...shared,
        capture_source: captured.source || capturePlan.source,
        [CAPTURE_KEY]: captured.captureResult,
      })
    }

    if (phase === 'inject_review_date_range') {
      const ready = await waitFor(pageReady, 10000, 250)
      if (!ready) {
        return fail('SHEIN 商品评价页面未加载完成，无法设置评价时间')
      }

      const injectionMeta = await attemptInjectRequestedReviewDateRange()
      return nextPhase('main', 300, {
        ...shared,
        review_date_range_injection_attempted: true,
        review_date_range_injection_meta: injectionMeta,
      })
    }

    if (phase === 'prepare_template') {
      if (shared.api_template) {
        return nextPhase('collect_page', 0)
      }

      const prepared = buildTemplateFromCapture(shared[CAPTURE_KEY], {
        reviewDateRange: persistedRequestShared.requestedReviewDateRange,
      })
      if (prepared.error) return fail(prepared.error)

      return nextPhase('collect_page', 0, {
        ...shared,
        api_template: prepared.apiTemplate,
        total_rows: prepared.totalRows,
        total_batches: prepared.totalBatches,
        batch_no: 0,
        current_store: prepared.apiTemplate.filter_summary || '商品评价',
        [CAPTURE_KEY]: null,
      })
    }

    if (phase === 'collect_page') {
      const template = shared.api_template || {}
      const endpoint = String(template.endpoint || '').trim()
      if (!endpoint) return fail('缺少商品评价 API 模板，请重新触发一次列表请求')

      const requestPayload = deepClone(template.payload, {})
      requestPayload.page = page
      requestPayload.perPage = PAGE_SIZE

      const response = await fetch(endpoint, {
        method: String(template.method || 'POST').trim().toUpperCase() || 'POST',
        headers: buildRequestHeaders(template.headers),
        body: JSON.stringify(requestPayload),
        credentials: 'include',
      })
      const payload = await readResponseJson(response)
      if (!payload || !isSuccessPayload(payload)) {
        return fail(explainPayloadError(payload, '商品评价接口请求失败'))
      }

      const list = Array.isArray(payload?.info?.data) ? payload.info.data : []
      const totalRows = resolveTotalRows(payload, Number(shared.total_rows || 0))
      const totalBatches = totalRows > 0 ? Math.ceil(totalRows / PAGE_SIZE) : (list.length >= PAGE_SIZE ? page + 1 : page)
      const rows = dedupeRows(list.map(item => buildFeedbackRow(item, template.filter_summary)))
      const hasMore = totalRows > 0 ? page < totalBatches : list.length >= PAGE_SIZE

      return complete(rows, hasMore, {
        ...buildProgressShared(template, totalRows, totalBatches, rows.length),
        api_template: template,
      })
    }

    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || error)
  }
})()
