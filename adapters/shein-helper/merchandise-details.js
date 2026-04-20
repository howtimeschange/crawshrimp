;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = Number(window.__CRAWSHRIMP_PAGE__ || 1)
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const TARGET_URL = 'https://sso.geiwohuo.com/#/sbn/merchandise/details'
  const PAGE_SIZE = 200
  const CAPTURE_KEY = 'captureResult'
  const SEEN_KEY = '__CRAWSHRIMP_SHEIN_MERCHANDISE_DETAILS_SEEN__'
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
    requestedDimensionScope: normalizeDimensionScope(shared.requestedDimensionScope || params.dimension_scope),
    requestedTimeMode: normalizeTimeMode(shared.requestedTimeMode || params.time_mode),
    requestedCustomDateRange: normalizeDateRangeParam(shared.requestedCustomDateRange || params.custom_date_range),
  }

  function normalizeDimensionScope(value) {
    const text = String(value || '').trim().toLowerCase()
    if (['skc', 'skc_only'].includes(text)) return 'skc'
    if (['spu', 'spu_only'].includes(text)) return 'spu'
    if (['both', 'all'].includes(text)) return 'both'
    return 'current'
  }

  function normalizeTimeMode(value) {
    const text = String(value || '').trim().toLowerCase()
    if (['yesterday', 'last7', 'last30', 'custom'].includes(text)) return text
    return 'current'
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

  function looksActiveColor(colorText) {
    const parts = String(colorText || '').match(/\d+/g)?.map(Number) || []
    if (parts.length < 3) return false
    const [r, g, b] = parts
    return Number.isFinite(b) && b >= 180 && b > r + 20 && b > g + 20
  }

  function getDimensionTabs() {
    return [...document.querySelectorAll('[class*="soui-tabs-tab"]')]
      .filter(isVisible)
      .filter(tab => /\bsoui-tabs-tab\b/.test(String(tab.className || '')))
      .filter(tab => !!normalizeDimensionLabel(textOf(tab)))
  }

  function isActiveDimensionTab(tab) {
    if (!tab) return false
    if (hasClassFragment(tab, 'active')) return true
    if (String(tab.getAttribute?.('aria-selected') || '').toLowerCase() === 'true') return true
    try {
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(tab) : null
      if (looksActiveColor(style?.color)) return true
    } catch (error) {}
    return false
  }

  function detectCurrentDimension() {
    const tabs = getDimensionTabs()
    const active = tabs.find(isActiveDimensionTab) || null
    const label = textOf(active || tabs[0] || null)
    if (/SPU/i.test(label)) return 'SPU列表'
    if (/SKC/i.test(label)) return 'SKC列表'
    if (/SPU/i.test(shared.current_dimension || '')) return 'SPU列表'
    return 'SKC列表'
  }

  function normalizeDimensionLabel(value) {
    const text = String(value || '').trim()
    if (/SPU/i.test(text)) return 'SPU列表'
    if (/SKC/i.test(text)) return 'SKC列表'
    return ''
  }

  function resolveRequestedCaptureDimensions(currentDimension = detectCurrentDimension()) {
    const scope = normalizeDimensionScope(persistedRequestShared.requestedDimensionScope)
    if (scope === 'both') return ['SKC列表', 'SPU列表']
    if (scope === 'skc') return ['SKC列表']
    if (scope === 'spu') return ['SPU列表']
    return [normalizeDimensionLabel(currentDimension) || 'SKC列表']
  }

  function getDimensionTabByLabel(targetDimension) {
    const normalized = normalizeDimensionLabel(targetDimension)
    if (!normalized) return null
    return getDimensionTabs().find(tab => normalizeDimensionLabel(textOf(tab)) === normalized) || null
  }

  async function activateDimensionTab(targetDimension) {
    const normalized = normalizeDimensionLabel(targetDimension)
    if (!normalized) {
      return { error: `未知商品明细维度: ${targetDimension}` }
    }

    if (detectCurrentDimension() === normalized) {
      return { attempted: false, applied: true, dimension: normalized }
    }

    const tab = getDimensionTabByLabel(normalized)
    if (!tab) {
      return { error: `未找到 ${normalized} 维度切换控件` }
    }

    const clickTargets = [tab.querySelector?.('span') || null, tab.firstElementChild || null, tab]
      .filter(Boolean)
      .filter((target, index, list) => list.indexOf(target) === index)

    for (const target of clickTargets) {
      try { target.dispatchEvent?.(new MouseEvent('mousedown', { bubbles: true })) } catch (error) {}
      try { target.dispatchEvent?.(new MouseEvent('mouseup', { bubbles: true })) } catch (error) {}
      try { target.dispatchEvent?.(new MouseEvent('click', { bubbles: true })) } catch (error) {}
      try { target.click?.() } catch (error) {}
      await sleep(180)
      if (detectCurrentDimension() === normalized) {
        return { attempted: true, applied: true, dimension: normalized }
      }
    }

    const switched = await waitFor(() => detectCurrentDimension() === normalized, 5000, 120)
    if (!switched) {
      return { error: `切换到 ${normalized} 失败` }
    }

    await sleep(150)
    return { attempted: true, applied: true, dimension: normalized }
  }

  function normalizeCaptureMap(raw) {
    const result = {}
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result
    for (const [rawKey, rawValue] of Object.entries(raw)) {
      const key = normalizeDimensionLabel(rawKey)
      if (!key || !readCaptureMatches(rawValue).length) continue
      result[key] = deepClone(rawValue, {})
    }
    return result
  }

  function hasCapturedDimensions(raw) {
    return Object.keys(normalizeCaptureMap(raw)).length > 0
  }

  function readCaptureMatches(captureResult) {
    return Array.isArray(captureResult?.matches) ? captureResult.matches : []
  }

  function buildCaptureMatches() {
    return [
      { url_contains: '/sbn/new_goods/get_skc_diagnose_list' },
      { url_contains: '/sbn/new_goods/get_diagnose_list' },
      { url_contains: '/sbn/new_goods/get_spu_diagnose_list' },
    ]
  }

  function isCaptureUrl(urlText) {
    return /get_skc_diagnose_list|get_diagnose_list|get_spu_diagnose_list/i.test(String(urlText || ''))
  }

  function inferDimensionFromEndpoint(endpoint, payload = null, fallback = '') {
    const text = String(endpoint || '').trim()
    const groupType = String(payload?.groupType || payload?.dimension || '').trim().toLowerCase()
    if (/get_skc_diagnose_list/i.test(text)) return 'SKC列表'
    if (/get_spu_diagnose_list/i.test(text)) return 'SPU列表'
    if (/get_diagnose_list/i.test(text)) {
      if (groupType === 'total' || groupType === 'spu') return 'SPU列表'
    }
    return fallback || ''
  }

  function pickCaptureMatch(captureResult, preferredDimension) {
    const matches = readCaptureMatches(captureResult)
    if (!matches.length) return null

    const pickByPattern = pattern => matches.find(match =>
      pattern.test(String(match?.responseUrl || match?.url || '')),
    ) || null

    if (preferredDimension === 'SKC列表') {
      return pickByPattern(/get_skc_diagnose_list/i) ||
        pickByPattern(/get_diagnose_list/i) ||
        pickByPattern(/get_spu_diagnose_list/i)
    }

    if (preferredDimension === 'SPU列表') {
      return pickByPattern(/get_diagnose_list/i) ||
        pickByPattern(/get_spu_diagnose_list/i) ||
        pickByPattern(/get_skc_diagnose_list/i)
    }

    return pickByPattern(/get_skc_diagnose_list|get_diagnose_list|get_spu_diagnose_list/i)
  }

  function getPagerButtons() {
    return [...document.querySelectorAll('button')]
      .filter(isVisible)
      .filter(button => hasClassFragment(button, 'pagination'))
  }

  function getPagerCaptureClick() {
    return getCenterClick(getPagerCaptureButton())
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
      if (!isCaptureUrl(urlText)) return
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
            if (isCaptureUrl(String(response?.url || requestUrl || ''))) {
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
        return { error: '未捕获到商品明细列表请求，请确认当前页面筛选已生效' }
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
    const hasVisibleDetailsControls = getDimensionTabs().length > 0 && !!getQueryCaptureButton()
    return href.includes('#/sbn/merchandise/details') || (/商品分析|商品明细/.test(body) && hasVisibleDetailsControls)
  }

  function pageReady() {
    const body = textOf(document.body)
    return isTargetPage() && /商品分析|商品明细/.test(body) && (
      getPagerButtons().length > 0 ||
      getDimensionTabs().length > 0 ||
      document.querySelectorAll('tbody tr').length > 0
    )
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

  function compactDateToken(value) {
    const text = String(value || '').trim()
    if (!text) return ''
    const digits = text.replace(/[^\d]/g, '')
    if (digits.length >= 8) return digits.slice(0, 8)
    return ''
  }

  function hyphenDateToken(value) {
    const compact = compactDateToken(value)
    if (!compact) return ''
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
  }

  function addDays(compactDate, offset) {
    const hyphen = hyphenDateToken(compactDate)
    if (!hyphen) return ''
    const date = new Date(`${hyphen}T00:00:00`)
    if (Number.isNaN(date.getTime())) return ''
    date.setDate(date.getDate() + offset)
    const year = String(date.getFullYear()).padStart(4, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}${month}${day}`
  }

  function normalizeTimeRange(payload, timeMode, customRange) {
    const mode = normalizeTimeMode(timeMode)
    const filterPayload = deepClone(payload, {})
    const currentStart = compactDateToken(filterPayload.startDate || filterPayload.dt)
    const currentEnd = compactDateToken(filterPayload.endDate || filterPayload.dt || currentStart)
    const anchor = currentEnd || currentStart
    let start = currentStart
    let end = currentEnd || currentStart

    if (mode === 'yesterday' && anchor) {
      start = anchor
      end = anchor
    } else if (mode === 'last7' && anchor) {
      end = anchor
      start = addDays(anchor, -6) || anchor
    } else if (mode === 'last30' && anchor) {
      end = anchor
      start = addDays(anchor, -29) || anchor
    } else if (mode === 'custom') {
      const customStart = compactDateToken(customRange?.start)
      const customEnd = compactDateToken(customRange?.end)
      if (!customStart || !customEnd) {
        return { error: '请选择完整的自定义统计时间范围' }
      }
      start = customStart
      end = customEnd
    }

    if (mode !== 'current') {
      filterPayload.startDate = start
      filterPayload.endDate = end
      filterPayload.dt = end
    }

    return {
      filterPayload,
      filterSummary: summarizeFilters(filterPayload),
    }
  }

  function shouldAttemptRequestedTimeInjection() {
    return ['yesterday', 'last7', 'last30'].includes(normalizeTimeMode(persistedRequestShared.requestedTimeMode))
  }

  function isCheckedTimeButton(button) {
    if (!button) return false
    if (hasClassFragment(button, 'checked') || hasClassFragment(button, 'Checked')) return true
    const radio = button.querySelector?.('input[type="radio"], input')
    return !!radio?.checked
  }

  function getTimeModeButton(mode) {
    const labelMap = {
      yesterday: '昨天',
      last7: '近7天',
      last30: '近30天',
    }
    const target = String(labelMap[normalizeTimeMode(mode)] || '').trim()
    if (!target) return null
    return [...document.querySelectorAll('button')]
      .filter(isVisible)
      .find(button => textOf(button) === target) || null
  }

  function getCustomTimeButton() {
    return [...document.querySelectorAll('button')]
      .filter(isVisible)
      .find(button => /^自定义(\s*~)?$/.test(textOf(button))) || null
  }

  function getReactFiberKey(target) {
    return Object.keys(target || {}).find(key => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) || ''
  }

  function getReactFiber(target) {
    const fiberKey = getReactFiberKey(target)
    return fiberKey ? target[fiberKey] : null
  }

  function getReactProps(target) {
    const propsKey = Object.keys(target || {}).find(key => key.startsWith('__reactProps$')) || ''
    return propsKey ? target[propsKey] : null
  }

  function slashDateToken(value) {
    const hyphen = hyphenDateToken(value)
    return hyphen ? hyphen.replace(/-/g, '/') : ''
  }

  async function attemptInjectRequestedTimeRange() {
    const mode = normalizeTimeMode(persistedRequestShared.requestedTimeMode)
    if (mode === 'current') {
      return { attempted: false, applied: false, reason: 'current_mode' }
    }

    if (mode !== 'custom') {
      const presetButton = getTimeModeButton(mode)
      if (!presetButton) {
        return { attempted: true, applied: false, reason: `missing_${mode}_button` }
      }
      try { presetButton.click?.() } catch (error) {}
      await sleep(120)
      return {
        attempted: true,
        applied: isCheckedTimeButton(presetButton),
        mode,
        label: textOf(presetButton),
      }
    }

    const range = persistedRequestShared.requestedCustomDateRange
    const start = slashDateToken(range?.start)
    const end = slashDateToken(range?.end)
    if (!start || !end) {
      return { attempted: true, applied: false, reason: 'missing_custom_range' }
    }

    const customButton = getCustomTimeButton()
    if (!customButton) {
      return { attempted: true, applied: false, reason: 'missing_custom_button' }
    }

    try { customButton.click?.() } catch (error) {}
    await sleep(120)

    const dateInputs = [...customButton.querySelectorAll('input')]
    const startInput = dateInputs.find(input => /开始/.test(String(input?.placeholder || ''))) || null
    const endInput = dateInputs.find(input => /结束/.test(String(input?.placeholder || ''))) || null
    if (!startInput || !endInput) {
      return { attempted: true, applied: isCheckedTimeButton(customButton), reason: 'missing_custom_inputs' }
    }

    const applyInputValue = (input, nextValue) => {
      try { input.removeAttribute?.('readonly') } catch (error) {}
      try { input.value = nextValue } catch (error) {}
      try { input.dispatchEvent?.(new Event('input', { bubbles: true })) } catch (error) {}
      try { input.dispatchEvent?.(new Event('change', { bubbles: true })) } catch (error) {}
      try { getReactProps(input)?.onChange?.({ target: { value: nextValue } }) } catch (error) {}
    }

    applyInputValue(startInput, start)
    applyInputValue(endInput, end)

    const candidateRanges = [
      [start, end],
      [hyphenDateToken(start), hyphenDateToken(end)],
      [new Date(`${hyphenDateToken(start)}T00:00:00+08:00`), new Date(`${hyphenDateToken(end)}T00:00:00+08:00`)],
    ].filter(candidate => candidate[0] && candidate[1])

    const rangeHandlers = new Set()
    let fiber = getReactFiber(startInput)
    let depth = 0
    while (fiber && depth < 20) {
      const props = fiber.memoizedProps || {}
      if (props.range && typeof props.onChange === 'function' && !rangeHandlers.has(props.onChange)) {
        rangeHandlers.add(props.onChange)
        for (const candidate of candidateRanges) {
          try { props.onChange(candidate) } catch (error) {}
        }
      }
      fiber = fiber.return
      depth += 1
    }

    await sleep(150)
    return {
      attempted: true,
      applied: isCheckedTimeButton(customButton),
      mode,
      startValue: String(startInput.value || '').trim(),
      endValue: String(endInput.value || '').trim(),
    }
  }

  function summarizeFilters(payload) {
    const parts = []
    const sites = Array.isArray(payload.countrySite)
      ? payload.countrySite.map(item => String(item || '').trim()).filter(Boolean)
      : (payload.countrySite ? [String(payload.countrySite).trim()] : [])
    if (sites.length) {
      parts.push(`站点=${sites.join(',')}`)
    }

    const startDate = compactDateToken(payload.startDate)
    const endDate = compactDateToken(payload.endDate)
    const dt = compactDateToken(payload.dt)
    if (startDate && endDate) {
      parts.push(startDate === endDate ? `统计日期=${startDate}` : `统计区间=${startDate}~${endDate}`)
    } else if (dt) {
      parts.push(`统计日期=${dt}`)
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

  function buildPromotionLabel(promCampaign) {
    const labels = []
    const seen = new Set()
    const push = value => {
      const text = String(value || '').trim()
      if (!text || seen.has(text)) return
      seen.add(text)
      labels.push(text)
    }

    const inProgress = Array.isArray(promCampaign?.promInfIng) ? promCampaign.promInfIng : []
    const upcoming = Array.isArray(promCampaign?.promInfReady) ? promCampaign.promInfReady : []
    if (inProgress.length) push('活动中')
    if (upcoming.length) push('即将开始活动')

    if (!labels.length) {
      const tag = String(promCampaign?.promTag || '').trim()
      if (tag) {
        String(tag)
          .split(/[，,]/)
          .map(item => item.trim())
          .filter(Boolean)
          .forEach(push)
      }
    }

    return labels.join(' / ') || '暂无生效活动'
  }

  function numericCell(value) {
    if (value == null || value === '') return 0
    return value
  }

  function formatFlag(value) {
    const text = String(value || '').trim()
    if (!text) return ''
    if (text === '1' || /^true$/i.test(text)) return '是'
    if (text === '0' || /^false$/i.test(text)) return '否'
    return text
  }

  function joinCategoryPath(item) {
    return ['newCate1Nm', 'newCate2Nm', 'newCate3Nm', 'newCate4Nm']
      .map(key => String(item?.[key] || '').trim())
      .filter(Boolean)
      .join(' / ')
  }

  function buildGoodsTags(item, dimension) {
    if (dimension !== 'SKC列表') return ''

    const tags = []
    const seen = new Set()
    const push = value => {
      const text = String(value || '').trim()
      if (!text || seen.has(text)) return
      seen.add(text)
      tags.push(text)
    }

    const newGoodsTag = String(item?.newGoodsTag || '').trim()
    if (newGoodsTag === '2') push('新品畅销')
    else if (newGoodsTag === '1') push('新品')

    push(item?.layerNm)

    if (String(item?.onsaleFlag || '').trim() === '1') push('在售')
    else if (String(item?.onsaleFlag || '').trim() === '0') push('停售')

    if (String(item?.saleFlag || '').trim() === '1') push('上架')
    else if (String(item?.saleFlag || '').trim() === '0') push('下架')

    return tags.join(' / ')
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

  function buildMerchandiseRow(item, dimension, filterSummary) {
    const row = {
      __sheet_name: dimension,
      __spu: String(item?.spu || '').trim(),
      __skc: String(item?.skc || '').trim(),
      __goodsn: String(item?.skuSupplierNo || item?.goodSn || '').trim(),
      '商品字段/商品名称': String(item?.goodsName || item?.title || '').trim(),
      '商品字段/SPU': String(item?.spu || '').trim(),
      '商品字段/标签': buildGoodsTags(item, dimension),
      操作: dimension === 'SKC列表' ? '查看趋势 / 质量分析' : '查看趋势',
      筛选摘要: filterSummary || '',
    }

    if (dimension === 'SKC列表') {
      row['商品字段/SKC'] = String(item?.skc || '').trim()
      row['商品字段/货号'] = String(item?.skuSupplierNo || item?.goodSn || '').trim()
      row['商品字段/品类'] = joinCategoryPath(item)
      row['商品基本信息/活动标签'] = buildPromotionLabel(item?.promCampaign)
      row['商品基本信息/是否35天转备货'] = formatFlag(item?.layerNm35dFlag)
      row['交易/销量'] = numericCell(item?.saleCnt ?? item?.c1dSaleCnt)
      row['交易/支付订单数'] = numericCell(item?.payOrderCnt ?? item?.c1dOrderCnt ?? item?.c1dPmsOrderCnt)
      row['流量/商品访客数'] = numericCell(item?.goodsUv ?? item?.c1dGoodsUvAgg ?? item?.c1dGoodsUvAggIntfAgg)
      row['流量/支付人数'] = numericCell(item?.payUv ?? item?.payUserCnt ?? item?.payUserCntIntfAgg)
      row['备货/备货订单数'] = numericCell(item?.pcsOrderCnt ?? item?.stockOrderCnt ?? item?.prepareOrderCnt)
      row['备货/备货件数'] = numericCell(item?.pcsQty ?? item?.stockQty ?? item?.prepareQty)
      return row
    }

    row['商品基本信息/活动标签'] = buildPromotionLabel(item?.promCampaign)
    row['交易/销量'] = numericCell(item?.saleCnt ?? item?.c1dSaleCnt)
    row['交易/支付订单数'] = numericCell(item?.payOrderCnt ?? item?.c1dOrderCnt ?? item?.c1dPmsOrderCnt)
    row['流量/商详访客'] = numericCell(item?.goodsUv ?? item?.c1dGoodsUvAgg ?? item?.c1dGoodsUvAggIntfAgg)
    row['流量/支付人数'] = numericCell(item?.payUv ?? item?.payUserCnt ?? item?.payUserCntIntfAgg)
    return row
  }

  function buildTemplateFromCapture(captureResult, preferredDimension) {
    const match = pickCaptureMatch(captureResult, preferredDimension)
    if (!match) return { error: '未捕获到商品明细列表请求，请确认当前页面筛选已生效' }

    const payload = safeJsonParse(match?.postData)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { error: '未解析到商品明细列表请求参数' }
    }

    const endpoint = extractPathname(match?.responseUrl || match?.url || '')
    const responsePayload = safeJsonParse(match?.body) || {}
    const filterPayload = stripPagingFields(payload)
    const dimension = inferDimensionFromEndpoint(endpoint, payload, preferredDimension || 'SKC列表') || preferredDimension || 'SKC列表'
    const filterSummary = summarizeFilters(filterPayload)
    const totalRows = resolveTotalRows(responsePayload)
    const totalBatches = totalRows > 0 ? Math.ceil(totalRows / PAGE_SIZE) : 0

    return {
      apiTemplate: {
        endpoint,
        method: String(match?.method || 'POST').trim().toUpperCase() || 'POST',
        headers: sanitizeHeaders(match?.headers),
        payload: deepClone(payload, {}),
        dimension,
        filter_summary: filterSummary,
        filter_payload: filterPayload,
        total_rows: totalRows,
        total_batches: totalBatches,
      },
    }
  }

  function buildSingleTemplateQueue(baseTemplate, options = {}) {
    const timeResult = normalizeTimeRange(baseTemplate.filter_payload || baseTemplate.payload || {}, options.timeMode, options.customDateRange)
    if (timeResult.error) return { error: timeResult.error }

    const preserveCapturedTotals = normalizeTimeMode(options.timeMode) === 'current'
    const template = deepClone(baseTemplate, {})
    template.payload = {
      ...stripPagingFields(baseTemplate.payload || {}),
      ...timeResult.filterPayload,
    }
    template.filter_payload = deepClone(timeResult.filterPayload, {})
    template.filter_summary = timeResult.filterSummary
    if (!preserveCapturedTotals) {
      template.total_rows = 0
      template.total_batches = 0
    }
    return { templates: [template] }
  }

  function buildTemplateQueueFromCapturedDimensions(captureMap, options = {}) {
    const dimensions = resolveRequestedCaptureDimensions(options.currentDimension)
    const templates = []
    const preserveCapturedTotals = normalizeTimeMode(options.timeMode) === 'current'

    for (const dimension of dimensions) {
      const captureResult = captureMap[dimension]
      if (!captureResult) {
        return { error: `缺少 ${dimension} 列表请求模板，请重新触发一次列表请求` }
      }

      const prepared = buildTemplateFromCapture(captureResult, dimension)
      if (prepared.error) return prepared

      const timeResult = normalizeTimeRange(prepared.apiTemplate.filter_payload || prepared.apiTemplate.payload || {}, options.timeMode, options.customDateRange)
      if (timeResult.error) return { error: timeResult.error }

      const template = deepClone(prepared.apiTemplate, {})
      template.payload = {
        ...stripPagingFields(prepared.apiTemplate.payload || {}),
        ...timeResult.filterPayload,
      }
      template.filter_payload = deepClone(timeResult.filterPayload, {})
      template.filter_summary = timeResult.filterSummary
      if (!preserveCapturedTotals) {
        template.total_rows = 0
        template.total_batches = 0
      }
      templates.push(template)
    }

    return { templates }
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

  function normalizeTemplateQueue(rawTemplates) {
    const templates = Array.isArray(rawTemplates) ? rawTemplates : []
    return templates
      .map(item => deepClone(item, null))
      .filter(Boolean)
      .filter(item => String(item.endpoint || '').trim())
  }

  function resolveTemplateQueue() {
    const queue = normalizeTemplateQueue(shared.api_templates)
    if (queue.length) return queue
    if (shared.api_template && String(shared.api_template.endpoint || '').trim()) {
      return [deepClone(shared.api_template, {})]
    }
    return []
  }

  function sumKnownField(templates, key) {
    return templates.reduce((acc, item) => {
      const value = Number(item?.[key] || 0)
      return Number.isFinite(value) ? acc + value : acc
    }, 0)
  }

  function buildProgressShared(templates, activeTemplateIndex, currentLocalPage, rowsOnCurrentPage, nextTemplateIndex, nextLocalPage, currentTemplate) {
    const safeTemplates = normalizeTemplateQueue(templates)
    const totalRows = sumKnownField(safeTemplates, 'total_rows')
    const totalBatches = sumKnownField(safeTemplates, 'total_batches')
    const dimension = String(currentTemplate?.dimension || '').trim()
    const filterSummary = String(currentTemplate?.filter_summary || '').trim()
    const nextTemplate = safeTemplates[nextTemplateIndex] || currentTemplate || {}
    const completedBeforeCurrentTemplate = safeTemplates
      .slice(0, activeTemplateIndex)
      .reduce((acc, item) => acc + Math.max(0, Number(item?.total_rows || 0)), 0)
    const currentTemplateTotalRows = Math.max(0, Number(currentTemplate?.total_rows || 0))
    const exactCurrentCompleted = Math.max(0, ((Math.max(1, currentLocalPage) - 1) * PAGE_SIZE) + Math.max(0, Number(rowsOnCurrentPage || 0)))
    const completedInCurrentTemplate = currentTemplateTotalRows > 0
      ? Math.min(exactCurrentCompleted, currentTemplateTotalRows)
      : exactCurrentCompleted
    const currentExecNo = completedBeforeCurrentTemplate + completedInCurrentTemplate
    return {
      ...shared,
      api_templates: safeTemplates,
      api_template: safeTemplates[0] || currentTemplate || null,
      active_template_index: nextTemplateIndex,
      local_page: nextLocalPage,
      current_dimension: String(nextTemplate.dimension || dimension || detectCurrentDimension()).trim() || 'SKC列表',
      total_rows: totalRows,
      total_batches: totalBatches,
      batch_no: Math.max(1, currentLocalPage),
      current_exec_no: currentExecNo,
      current_store: [dimension, filterSummary].filter(Boolean).join(' / ') || '商品分析-商品明细',
    }
  }

  try {
    if (phase === 'main') {
      if (!isTargetPage()) {
        location.href = TARGET_URL
        return nextPhase('main', 1800)
      }

      if (resolveTemplateQueue().length) {
        return nextPhase('collect_page', 0)
      }

      if (hasCapturedDimensions(shared.dimension_captures)) {
        return nextPhase('prepare_template', 0)
      }

      if (shared[CAPTURE_KEY]) {
        return nextPhase('prepare_template', 0)
      }

      resetSeenRows()

      const ready = await waitFor(pageReady, 10000, 250)
      if (!ready) {
        return fail('SHEIN 商品分析-商品明细页面未加载完成，请确认已登录并打开页面')
      }

      if (shouldAttemptRequestedTimeInjection() && !shared.time_injection_attempted) {
        return nextPhase('inject_time_range', 0)
      }

      const currentDimension = detectCurrentDimension()
      const requestedDimensions = resolveRequestedCaptureDimensions(currentDimension)
      if (
        requestedDimensions.length !== 1 ||
        requestedDimensions[0] !== currentDimension
      ) {
        return nextPhase('capture_dimension_template', 0, {
          ...shared,
          current_dimension: currentDimension,
          capture_dimensions: requestedDimensions,
          capture_dimension_index: 0,
          dimension_captures: normalizeCaptureMap(shared.dimension_captures),
        })
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
        current_dimension: currentDimension,
        [CAPTURE_KEY]: captured.captureResult,
      })
    }

    if (phase === 'inject_time_range') {
      const ready = await waitFor(pageReady, 10000, 250)
      if (!ready) {
        return fail('SHEIN 商品分析-商品明细页面未加载完成，无法设置统计时间')
      }

      const injectionMeta = await attemptInjectRequestedTimeRange()
      return nextPhase('main', 300, {
        ...shared,
        time_injection_attempted: true,
        time_injection_meta: injectionMeta,
      })
    }

    if (phase === 'capture_dimension_template') {
      const ready = await waitFor(pageReady, 10000, 250)
      if (!ready) {
        return fail('SHEIN 商品分析-商品明细页面未加载完成，请确认已登录并打开页面')
      }

      const captureDimensions = Array.isArray(shared.capture_dimensions)
        ? shared.capture_dimensions.map(normalizeDimensionLabel).filter(Boolean)
        : resolveRequestedCaptureDimensions(shared.current_dimension || detectCurrentDimension())
      if (!captureDimensions.length) {
        return fail('未解析到需要继承的商品明细维度')
      }

      const captureIndex = Math.max(0, Math.min(Number(shared.capture_dimension_index || 0), captureDimensions.length - 1))
      const targetDimension = captureDimensions[captureIndex] || detectCurrentDimension()
      const activateResult = await activateDimensionTab(targetDimension)
      if (activateResult.error) return fail(activateResult.error)

      const capturePlan = getCapturePlan()
      if (!capturePlan.clicks.length) {
        return fail('未找到可用于继承当前筛选的查询或翻页控件')
      }

      const captured = await captureListRequestViaPageActions()
      if (captured.error) return fail(captured.error)

      const nextCaptureMap = {
        ...normalizeCaptureMap(shared.dimension_captures),
        [targetDimension]: captured.captureResult,
      }
      const nextShared = {
        ...shared,
        capture_dimensions: captureDimensions,
        capture_dimension_index: captureIndex + 1,
        current_dimension: targetDimension,
        capture_source: captured.source || capturePlan.source,
        dimension_captures: nextCaptureMap,
      }

      if (captureIndex + 1 < captureDimensions.length) {
        return nextPhase('capture_dimension_template', 0, nextShared)
      }

      return nextPhase('prepare_template', 0, nextShared)
    }

    if (phase === 'prepare_template') {
      const existingQueue = resolveTemplateQueue()
      if (existingQueue.length) {
        return nextPhase('collect_page', 0)
      }

      let templates = []
      const captureMap = normalizeCaptureMap(shared.dimension_captures)
      if (Object.keys(captureMap).length) {
        const queueResult = buildTemplateQueueFromCapturedDimensions(captureMap, {
          currentDimension: shared.current_dimension || detectCurrentDimension(),
          timeMode: persistedRequestShared.requestedTimeMode,
          customDateRange: persistedRequestShared.requestedCustomDateRange,
        })
        if (queueResult.error) return fail(queueResult.error)
        templates = queueResult.templates || []
      } else {
        const prepared = buildTemplateFromCapture(shared[CAPTURE_KEY], shared.current_dimension || detectCurrentDimension())
        if (prepared.error) return fail(prepared.error)

        const queueResult = buildSingleTemplateQueue(prepared.apiTemplate, {
          timeMode: persistedRequestShared.requestedTimeMode,
          customDateRange: persistedRequestShared.requestedCustomDateRange,
        })
        if (queueResult.error) return fail(queueResult.error)
        templates = queueResult.templates || []
      }

      const firstTemplate = templates[0] || null
      if (!firstTemplate) {
        return fail('未生成商品明细 API 模板，请重新触发一次列表请求')
      }
      return nextPhase('collect_page', 0, {
        ...shared,
        api_templates: templates,
        api_template: firstTemplate,
        active_template_index: 0,
        local_page: 1,
        current_dimension: firstTemplate.dimension,
        total_rows: sumKnownField(templates, 'total_rows'),
        total_batches: sumKnownField(templates, 'total_batches'),
        batch_no: 0,
        current_store: [firstTemplate.dimension, firstTemplate.filter_summary].filter(Boolean).join(' / '),
        [CAPTURE_KEY]: null,
        dimension_captures: null,
      })
    }

    if (phase === 'collect_page') {
      const templates = resolveTemplateQueue()
      if (!templates.length) {
        return fail('缺少商品明细 API 模板，请重新触发一次列表请求')
      }

      const activeTemplateIndex = Math.max(0, Math.min(Number(shared.active_template_index || 0), templates.length - 1))
      const currentTemplate = templates[activeTemplateIndex] || {}
      const endpoint = String(currentTemplate.endpoint || '').trim()
      if (!endpoint) return fail('缺少商品明细 API 模板 endpoint')

      const localPage = Math.max(1, Number(shared.local_page || 1))
      const requestPayload = deepClone(currentTemplate.payload, {})
      requestPayload.pageNum = localPage
      requestPayload.pageSize = PAGE_SIZE

      const response = await fetch(endpoint, {
        method: String(currentTemplate.method || 'POST').trim().toUpperCase() || 'POST',
        headers: buildRequestHeaders(currentTemplate.headers),
        body: JSON.stringify(requestPayload),
        credentials: 'include',
      })
      const payload = await readResponseJson(response)
      if (!payload || !isSuccessPayload(payload)) {
        return fail(explainPayloadError(payload, '商品明细接口请求失败'))
      }

      const list = Array.isArray(payload?.info?.data) ? payload.info.data : []
      const totalRows = resolveTotalRows(payload, Number(currentTemplate.total_rows || 0))
      const totalBatches = totalRows > 0 ? Math.ceil(totalRows / PAGE_SIZE) : (list.length >= PAGE_SIZE ? localPage + 1 : localPage)
      const dimension = String(
        currentTemplate.dimension ||
        inferDimensionFromEndpoint(endpoint, requestPayload, shared.current_dimension || '') ||
        shared.current_dimension ||
        'SKC列表',
      ).trim()

      const updatedTemplate = {
        ...currentTemplate,
        dimension,
        total_rows: totalRows,
        total_batches: totalBatches,
      }
      templates[activeTemplateIndex] = updatedTemplate

      const rows = dedupeRows(list.map(item => buildMerchandiseRow(item, dimension, updatedTemplate.filter_summary)))

      let hasMore = false
      let nextTemplateIndex = activeTemplateIndex
      let nextLocalPage = localPage

      if (localPage < totalBatches) {
        hasMore = true
        nextLocalPage = localPage + 1
      } else if (activeTemplateIndex < templates.length - 1) {
        hasMore = true
        nextTemplateIndex = activeTemplateIndex + 1
        nextLocalPage = 1
      }

      return complete(rows, hasMore, buildProgressShared(
        templates,
        activeTemplateIndex,
        localPage,
        rows.length,
        nextTemplateIndex,
        nextLocalPage,
        updatedTemplate,
      ))
    }

    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || error)
  }
})()
