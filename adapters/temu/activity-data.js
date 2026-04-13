;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = Number(window.__CRAWSHRIMP_PAGE__ || 1)
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const TARGET_URL = 'https://agentseller.temu.com/main/act/data-full'
  const LIST_BUSY_RETRY_LIMIT = 30
  const LIST_PAGE_RECOVERY_LIMIT = 30
  const SAFE_PAGE_LOOP_LIMIT = 120
  const PAGER_THROTTLE_MS = 1200

  const OUTER_SITE_BLACKLIST = new Set(['商家中心'])
  const CANONICAL_OUTER_SITE_ORDER = ['全球', '美国', '欧区']
  const ACTIVITY_METRIC_COLUMN_KEYS = [
    '活动成交额',
    '活动销量',
    '总访客数',
    '点击访客数',
    '支付访客数',
    '访客点击转化率',
    '访客支付转化率',
    '销量趋势',
  ]

  function normalizeArray(value) {
    if (!Array.isArray(value)) return []
    return value.map(item => String(item || '').trim()).filter(Boolean)
  }

  function normalizeDateRangeParam(value) {
    if (!value || typeof value !== 'object') return {}
    const start = String(value.start || '').trim()
    const end = String(value.end || '').trim()
    if (!start || !end) return {}
    return { start, end }
  }

  const persistedRequestShared = {
    requestedOuterSites: normalizeArray(shared.requestedOuterSites || params.outer_sites),
    requestedActivityType: String(shared.requestedActivityType || params.activity_type || '').trim(),
    requestedActivityTheme: String(shared.requestedActivityTheme || params.activity_theme || '').trim(),
    requestedSpuIdQuery: String(shared.requestedSpuIdQuery || params.spu_id_query || '').trim(),
    requestedStatDateRange: normalizeDateRangeParam(shared.requestedStatDateRange || params.stat_date_range),
  }

  const mode = String(params.mode || 'current').trim().toLowerCase()
  const outerSitesParam = persistedRequestShared.requestedOuterSites
  const activityTypeParam = persistedRequestShared.requestedActivityType
  const activityThemeParam = persistedRequestShared.requestedActivityTheme
  const spuIdQuery = persistedRequestShared.requestedSpuIdQuery
  const statDateRange = persistedRequestShared.requestedStatDateRange

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

  function textOf(el) {
    return String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim()
  }

  function compact(value) {
    return String(value || '').replace(/\s+/g, '').trim()
  }

  function isVisible(el) {
    if (!el || typeof el.getClientRects !== 'function') return false
    return el.getClientRects().length > 0
  }

  function hasClassFragment(el, fragment) {
    return String(el?.className || '').includes(fragment)
  }

  function localNow() {
    const d = new Date()
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  function mergeShared(newShared = shared) {
    return {
      ...persistedRequestShared,
      ...(newShared || {}),
    }
  }

  function nextPhase(name, sleepMs = 800, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'next_phase', next_phase: name, sleep_ms: sleepMs, shared: mergeShared(newShared) },
    }
  }

  function cdpClicks(clicks, nextPhaseName, sleepMs = 800, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'cdp_clicks', clicks, next_phase: nextPhaseName, sleep_ms: sleepMs, shared: mergeShared(newShared) },
    }
  }

  function reloadPage(nextPhaseName, sleepMs = 2000, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'reload_page', next_phase: nextPhaseName, sleep_ms: sleepMs, shared: mergeShared(newShared) },
    }
  }

  function complete(data, hasMore = false, newShared = shared) {
    return {
      success: true,
      data,
      meta: { action: 'complete', has_more: hasMore, shared: mergeShared(newShared) },
    }
  }

  function fail(message) {
    return { success: false, error: message }
  }

  function clickLike(el) {
    if (!el) return false
    try { el.scrollIntoView({ block: 'center', inline: 'center' }) } catch (e) {}
    try { el.focus?.() } catch (e) {}
    try { el.click?.() } catch (e) {}
    for (const eventName of ['pointerenter', 'pointerdown', 'pointerup']) {
      try {
        if (typeof PointerEvent !== 'undefined') {
          el.dispatchEvent(new PointerEvent(eventName, { bubbles: true, cancelable: true }))
        }
      } catch (e) {}
    }
    for (const eventName of ['mouseenter', 'mousedown', 'mouseup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true }))
      } catch (e) {}
    }
    return true
  }

  function clickPagerLike(el) {
    if (!el) return false
    try { el.scrollIntoView({ block: 'center', inline: 'center' }) } catch (e) {}
    try { el.focus?.() } catch (e) {}
    try { el.click?.() } catch (e) {}
    return true
  }

  function getCenterClick(el, delayMs = 120) {
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      delay_ms: delayMs,
    }
  }

  async function waitFor(condition, timeout = 8000, interval = 200) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (condition()) return true
      await sleep(interval)
    }
    return false
  }

  function hasBusyWarning() {
    return /Too many visitors, please try again later\./i.test(textOf(document.body))
  }

  function getVisibleDrawer() {
    const candidates = [
      ...document.querySelectorAll('[class*="Drawer_content_"]'),
      ...document.querySelectorAll('[class*="Drawer_outerWrapper_"]'),
    ].filter(isVisible)
    return candidates.find(el => el.querySelector('table') || /商品数据分析/.test(textOf(el))) || null
  }

  function isInsideVisibleDrawer(el) {
    const drawer = getVisibleDrawer()
    return !!(drawer && el && drawer.contains(el))
  }

  function getOuterSiteNodes() {
    return [...document.querySelectorAll('a[class*="index-module__drItem___"]')]
      .filter(isVisible)
      .filter(node => {
        const label = textOf(node)
        return label && !OUTER_SITE_BLACKLIST.has(label)
      })
  }

  function getAvailableOuterSites() {
    return getOuterSiteNodes()
      .filter(node => !hasClassFragment(node, 'index-module__disabled___'))
      .map(node => ({
        text: textOf(node),
        active: hasClassFragment(node, 'index-module__active___'),
      }))
  }

  function getActiveOuterSite() {
    const node = getOuterSiteNodes().find(item => hasClassFragment(item, 'index-module__active___'))
    return textOf(node)
  }

  function buildTargetOuterSites() {
    const available = CANONICAL_OUTER_SITE_ORDER.filter(site =>
      getAvailableOuterSites().some(item => item.text === site),
    )
    const requested = outerSitesParam.length
      ? outerSitesParam.filter(item => available.includes(item))
      : available
    const target = CANONICAL_OUTER_SITE_ORDER.filter(site => requested.includes(site))
    return { available, target }
  }

  function getOuterSiteClick(siteLabel) {
    const node = getOuterSiteNodes().find(item =>
      textOf(item) === siteLabel &&
      !hasClassFragment(item, 'index-module__disabled___'),
    )
    return getCenterClick(node)
  }

  function getOuterSiteUrl(siteLabel) {
    const hostMap = {
      '全球': 'agentseller.temu.com',
      '美国': 'agentseller-us.temu.com',
      '欧区': 'agentseller-eu.temu.com',
    }
    const host = hostMap[siteLabel]
    if (!host) return ''
    const url = new URL(TARGET_URL)
    url.hostname = host
    return url.toString()
  }

  function getOuterSiteFromHostname() {
    const host = String(location.hostname || '').trim()
    if (host === 'agentseller.temu.com') return '全球'
    if (host === 'agentseller-us.temu.com') return '美国'
    if (host === 'agentseller-eu.temu.com') return '欧区'
    return ''
  }

  function getResolvedOuterSite() {
    return getOuterSiteFromHostname() || getActiveOuterSite() || ''
  }

  async function waitForTargetOuterSite(targetSite, timeout = 30000) {
    if (!targetSite) return true
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (getResolvedOuterSite() === targetSite) return true
      await sleep(200)
    }
    return false
  }

  async function waitForTargetReady(timeout = 15000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const hasSites = getAvailableOuterSites().length > 0
      const hasFilters = /活动类型/.test(textOf(document.body)) && /统计日期/.test(textOf(document.body))
      const hasButtons = !!findMainButton('查询') && !!findMainButton('重置')
      const hasTable = !!getMainListTable() || !!getMainListHeaderTable()
      if (hasSites && hasFilters && hasButtons && hasTable) return true
      await sleep(400)
    }
    return false
  }

  function countTableBodyRows(table) {
    if (!table) return 0
    return [...table.querySelectorAll('tbody tr[class*="TB_tr_"], tr[class*="TB_tr_"]')]
      .filter(row => isVisible(row) && row.querySelectorAll('td').length > 0)
      .length
  }

  function countTableHeaderCells(table) {
    if (!table) return 0
    return [...table.querySelectorAll('thead tr')]
      .filter(isVisible)
      .reduce((total, row) => {
        const cells = [...row.children].filter(cell => /^(TH|TD)$/i.test(cell.tagName))
        return total + cells.length
      }, 0)
  }

  function getVisibleMainListTables() {
    return [...document.querySelectorAll('table')]
      .filter(isVisible)
      .filter(table => !isInsideVisibleDrawer(table))
  }

  function getMainListTable() {
    const candidates = getVisibleMainListTables()
      .map(table => ({
        table,
        rowCount: countTableBodyRows(table),
        score: countTableBodyRows(table) + (/查看/.test(textOf(table)) ? 1000 : 0),
      }))
      .filter(item => item.rowCount > 0 || /查看/.test(textOf(item.table)))
      .sort((a, b) => b.score - a.score)
    return candidates[0]?.table || null
  }

  function getMainListHeaderTable() {
    const candidates = getVisibleMainListTables()
      .map(table => ({
        table,
        headerCount: countTableHeaderCells(table),
        text: textOf(table),
      }))
      .filter(item => item.headerCount > 0)
      .sort((a, b) => {
        const aScore = a.headerCount + (/活动类型|活动成交额|活动销量|销量趋势/.test(a.text) ? 1000 : 0)
        const bScore = b.headerCount + (/活动类型|活动成交额|活动销量|销量趋势/.test(b.text) ? 1000 : 0)
        return bScore - aScore
      })
    return candidates[0]?.table || null
  }

  function getMainListRows() {
    const table = getMainListTable()
    if (!table) return []
    return [...table.querySelectorAll('tbody tr[class*="TB_tr_"], tr[class*="TB_tr_"]')]
      .filter(row => isVisible(row) && row.querySelectorAll('td').length > 0)
  }

  function getMainPagerRoot() {
    const next = [...document.querySelectorAll('li[class*="PGT_next_"]')]
      .filter(isVisible)
      .find(el => !isInsideVisibleDrawer(el))
    return next?.closest('[class*="PGT_outerWrapper_"], [class*="PGT_pagerWrapper_"], ul, div') || document
  }

  function getListPageNo() {
    const active = getMainPagerRoot().querySelector('li[class*="PGT_pagerItemActive_"]')
    const value = parseInt(textOf(active), 10)
    return Number.isFinite(value) && value > 0 ? value : 1
  }

  function getListTotalCount() {
    const text = textOf(getMainPagerRoot())
    const match = text.match(/共有\s*(\d+)\s*条/)
    return match ? Number(match[1]) : 0
  }

  function hasNextListPage() {
    const next = getMainPagerRoot().querySelector('li[class*="PGT_next_"]')
    return !!(next && !hasClassFragment(next, 'PGT_disabled_'))
  }

  function hasPrevListPage() {
    const prev = getMainPagerRoot().querySelector('li[class*="PGT_prev_"]')
    return !!(prev && !hasClassFragment(prev, 'PGT_disabled_'))
  }

  function listShouldHaveMorePages(currentPageNo = getListPageNo()) {
    const totalCount = getListTotalCount()
    return totalCount > Math.max(1, Number(currentPageNo || 1)) * 100
  }

  function clickNextListPage() {
    const next = getMainPagerRoot().querySelector('li[class*="PGT_next_"]')
    if (!next || hasClassFragment(next, 'PGT_disabled_')) return false
    return clickPagerLike(next)
  }

  function clickPrevListPage() {
    const prev = getMainPagerRoot().querySelector('li[class*="PGT_prev_"]')
    if (!prev || hasClassFragment(prev, 'PGT_disabled_')) return false
    return clickPagerLike(prev)
  }

  function getListRowSampleTexts(rows, sampleSize = 3) {
    if (!rows.length) return []
    const indexes = []
    const headCount = Math.min(sampleSize, rows.length)
    const tailStart = Math.max(headCount, rows.length - sampleSize)
    for (let index = 0; index < headCount; index += 1) indexes.push(index)
    for (let index = tailStart; index < rows.length; index += 1) indexes.push(index)
    return [...new Set(indexes)]
      .map(index => compact(textOf(rows[index])).slice(0, 120))
      .filter(Boolean)
  }

  function getListPageSignature() {
    const rows = getMainListRows()
    if (!rows.length) {
      return `list:empty:${compact(textOf(getMainListTable() || getMainListHeaderTable())).slice(0, 120)}`
    }
    return `list:${rows.length}:${getListRowSampleTexts(rows).join('|')}`
  }

  async function waitForListReady(timeout = 15000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const rows = getMainListRows()
      const empty = !!document.querySelector('[class*="TB_empty_"]')
      const busy = hasBusyWarning() && rows.length === 0
      if (rows.length > 0 || empty || busy) {
        return { ready: true, rows, empty, busy }
      }
      await sleep(500)
    }
    return {
      ready: false,
      rows: getMainListRows(),
      empty: !!document.querySelector('[class*="TB_empty_"]'),
      busy: hasBusyWarning(),
    }
  }

  async function waitListPageChange(oldSignature, oldPageNo = 0, timeout = 10000, expectedPageNo = 0) {
    const deadline = Date.now() + timeout
    let stableSignature = ''
    let stableHits = 0
    while (Date.now() < deadline) {
      const rows = getMainListRows()
      const empty = !!document.querySelector('[class*="TB_empty_"]')
      const busy = hasBusyWarning() && rows.length === 0
      if (busy) return false

      const currentPageNo = getListPageNo()
      const currentSignature = rows.length > 0 || empty ? getListPageSignature() : ''
      const pageChanged = expectedPageNo > 0
        ? currentPageNo === expectedPageNo
        : (oldPageNo > 0 ? currentPageNo !== oldPageNo : true)
      const signatureChanged = !!currentSignature && currentSignature !== oldSignature

      if (pageChanged && signatureChanged) {
        if (stableSignature === currentSignature) {
          stableHits += 1
        } else {
          stableSignature = currentSignature
          stableHits = 1
        }
        if (stableHits >= 2) return true
      } else {
        stableSignature = ''
        stableHits = 0
      }

      await sleep(300)
    }
    return false
  }

  async function ensureListPageNo(targetPage, timeout = 30000) {
    const deadline = Date.now() + timeout
    let guard = 0
    while (Date.now() < deadline && guard < SAFE_PAGE_LOOP_LIMIT) {
      guard += 1
      const current = getListPageNo()
      if (current === targetPage) return true
      const oldSig = getListPageSignature()
      const oldPageNo = current
      const expectedPageNo = current < targetPage ? oldPageNo + 1 : oldPageNo - 1
      await sleep(PAGER_THROTTLE_MS)
      const moved = current < targetPage ? clickNextListPage() : clickPrevListPage()
      if (!moved) return false
      const changed = await waitListPageChange(oldSig, oldPageNo, 10000, expectedPageNo)
      if (!changed) return false
      const ready = await waitForListReady(12000)
      if (!ready.ready || ready.busy) return false
    }
    return getListPageNo() === targetPage
  }

  function setNativeInputValue(input, value) {
    if (!input) return false
    try { input.focus?.() } catch (e) {}
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(input, value)
    else input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }

  function getLabeledContainer(labelText) {
    const rowCandidates = [...document.querySelectorAll('div[class*="index-module__row___"]')]
      .filter(isVisible)
    for (const row of rowCandidates) {
      const label = [...row.querySelectorAll('div, label, span')]
        .filter(isVisible)
        .find(el => textOf(el) === labelText)
      if (label) return row
    }

    const candidates = [...document.querySelectorAll('div, label, span')]
      .filter(isVisible)
      .filter(el => textOf(el) === labelText)
    for (const label of candidates) {
      let cursor = label
      for (let depth = 0; depth < 4 && cursor; depth += 1) {
        if (cursor.querySelector?.('input, [class*="ST_outerWrapper_"], [class*="CSD_cascaderWrapper_"], [class*="RPR_inputWrapper_"]')) {
          return cursor
        }
        cursor = cursor.parentElement
      }
    }
    return null
  }

  function findMainButton(text) {
    return [...document.querySelectorAll('button')]
      .filter(isVisible)
      .find(btn => !isInsideVisibleDrawer(btn) && textOf(btn) === text) || null
  }

  function clickOption(optionText) {
    const options = [...document.querySelectorAll(
      '[class*="ST_option_"], [class*="ST_item_"], [class*="cIL_item_"], [role="option"], li[class*="option"]',
    )].filter(isVisible)
    const target = options.find(opt => textOf(opt) === optionText)
    if (!target) return false
    clickLike(target)
    return true
  }

  async function setMainSelectByLabel(labelText, optionLabel) {
    const container = getLabeledContainer(labelText)
    if (!container) return false
    const input = container.querySelector('input[data-testid="beast-core-select-htmlInput"]')
    if (String(input?.value || '').trim() === optionLabel) return true
    const wrapper = input?.closest('[class*="ST_outerWrapper_"]') || container.querySelector('[class*="ST_outerWrapper_"]') || container
    clickLike(wrapper)
    await sleep(350)
    if (!clickOption(optionLabel)) {
      clickLike(document.body)
      return false
    }
    return await waitFor(() => String(input?.value || '').trim() === optionLabel, 4000, 200)
  }

  async function waitForSelectEnabled(labelText, timeout = 5000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const container = getLabeledContainer(labelText)
      const input = container?.querySelector('input[data-testid="beast-core-select-htmlInput"]') || null
      if (input && !hasClassFragment(input, 'IPT_disabled_')) return true
      await sleep(200)
    }
    return false
  }

  function getMainTextInputByLabel(labelText) {
    const container = getLabeledContainer(labelText)
    if (!container) return null
    return [...container.querySelectorAll('input')].find(input => {
      const testId = String(input.getAttribute('data-testid') || '')
      return testId !== 'beast-core-select-htmlInput' && testId !== 'beast-core-cascader-htmlInput' && testId !== 'beast-core-rangePicker-htmlInput'
    }) || null
  }

  async function setMainTextInput(labelText, value) {
    const input = getMainTextInputByLabel(labelText)
    if (!input) return false
    return setNativeInputValue(input, value)
  }

  function getRangePickerInputByLabel(labelText) {
    const container = getLabeledContainer(labelText)
    const rootCandidates = [
      ...(container ? container.querySelectorAll('[data-testid="beast-core-rangePicker-input"], [class*="RPR_inputWrapper_"]') : []),
      ...document.querySelectorAll('[data-testid="beast-core-rangePicker-input"], [class*="RPR_inputWrapper_"]'),
    ].filter(isVisible)
    for (const root of rootCandidates) {
      const input = [...root.querySelectorAll('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]')]
        .find(isVisible)
      if (input) return input
    }

    const candidates = [
      ...(container ? container.querySelectorAll('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]') : []),
      ...document.querySelectorAll('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]'),
    ]
    return candidates.find(isVisible) || null
  }

  function getRangePickerRootByLabel(labelText) {
    const input = getRangePickerInputByLabel(labelText)
    return input?.closest('[data-testid="beast-core-rangePicker-input"]') ||
      input?.closest('[class*="RPR_inputWrapper_"]') ||
      input?.parentElement ||
      null
  }

  function getRangePickerReactProps(labelText) {
    const root = getRangePickerRootByLabel(labelText) || getRangePickerInputByLabel(labelText)
    if (!root) return null

    const fiberKey = Object.keys(root).find(k => k.startsWith('__reactFiber')) || ''
    let fiber = fiberKey ? root[fiberKey] : null
    while (fiber) {
      const props = fiber.memoizedProps || null
      if (props && typeof props.onChange === 'function' && Array.isArray(props.value) && props.value.length === 2) {
        return props
      }
      fiber = fiber.return
    }
    return null
  }

  function getRangePickerInputCandidates(labelText) {
    const container = getLabeledContainer(labelText)
    const roots = [
      ...(container ? container.querySelectorAll('[data-testid="beast-core-rangePicker-input"], [class*="RPR_inputWrapper_"]') : []),
      ...document.querySelectorAll('[data-testid="beast-core-rangePicker-input"], [class*="RPR_inputWrapper_"]'),
    ].filter(isVisible)

    const inputs = []
    const seen = new Set()
    const pushInput = input => {
      if (!input || seen.has(input)) return
      seen.add(input)
      inputs.push(input)
    }

    for (const root of roots) {
      const rootInputs = [...root.querySelectorAll('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]')]
        .filter(isVisible)
      rootInputs.forEach(pushInput)
    }

    const fallbackInputs = [
      ...(container ? container.querySelectorAll('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]') : []),
      ...document.querySelectorAll('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]'),
    ].filter(isVisible)
    fallbackInputs.forEach(pushInput)
    return inputs
  }

  function getRangePickerReactPropsFromInput(input) {
    const roots = [
      input,
      input?.closest('[data-testid="beast-core-rangePicker-input"]') || null,
      input?.closest('[class*="RPR_inputWrapper_"]') || null,
      input?.parentElement || null,
    ].filter(Boolean)

    for (const root of roots) {
      const fiberKey = Object.keys(root).find(k => k.startsWith('__reactFiber')) || ''
      let fiber = fiberKey ? root[fiberKey] : null
      while (fiber) {
        const props = fiber.memoizedProps || null
        if (props && typeof props.onChange === 'function' && Array.isArray(props.value) && props.value.length === 2) {
          return props
        }
        fiber = fiber.return
      }
    }
    return null
  }

  async function waitForRangePickerReactProps(labelText, timeout = 4000) {
    const deadline = Date.now() + timeout
    let fallbackInput = null
    while (Date.now() < deadline) {
      const inputs = getRangePickerInputCandidates(labelText)
      const candidates = inputs.length ? inputs : [getRangePickerInputByLabel(labelText)].filter(Boolean)
      for (const input of candidates) {
        if (!fallbackInput) fallbackInput = input
        const props = getRangePickerReactPropsFromInput(input)
        if (props) return { input, props }
      }
      await sleep(200)
    }
    return { input: fallbackInput || getRangePickerInputByLabel(labelText), props: null }
  }

  function readRangeValueByLabel(labelText) {
    return String(getRangePickerInputByLabel(labelText)?.value || '').trim()
  }

  async function injectRangeByLabel(labelText, startDate, endDate) {
    const start = new Date(`${startDate}T00:00:00`)
    const end = new Date(`${endDate}T00:00:00`)
    if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return false

    const expectedRange = `${startDate} ~ ${endDate}`
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { input, props } = await waitForRangePickerReactProps(labelText, 4000)
      if (props && typeof props.onChange === 'function') {
        try {
          props.onChange([start, end])
        } catch (e) {}
      }

      let matched = await waitFor(() => readRangeValueByLabel(labelText) === expectedRange, 5000, 200)
      if (!matched && input) {
        setNativeInputValue(input, expectedRange)
        matched = await waitFor(() => readRangeValueByLabel(labelText) === expectedRange, 3000, 200)
      }
      if (matched) {
        await sleep(1000)
        if (readRangeValueByLabel(labelText) === expectedRange) return true
      }

      await sleep(600)
    }

    return false
  }

  function clickQueryButton() {
    const btn = findMainButton('查询')
    if (!btn) return false
    clickLike(btn)
    return true
  }

  function clickResetButton() {
    const btn = findMainButton('重置')
    if (!btn) return false
    clickLike(btn)
    return true
  }

  function getTableHeaders(table) {
    if (!table) return []
    const headerRows = [...table.querySelectorAll('thead tr')].filter(isVisible)
    if (!headerRows.length) return []

    const grid = []
    headerRows.forEach((row, rowIndex) => {
      grid[rowIndex] = grid[rowIndex] || []
      let colIndex = 0
      const cells = [...row.children].filter(cell => /^(TH|TD)$/i.test(cell.tagName))
      for (const cell of cells) {
        while (grid[rowIndex][colIndex]) colIndex += 1
        const label = textOf(cell)
        const colspan = parseInt(cell.getAttribute('colspan') || '1', 10) || 1
        const rowspan = parseInt(cell.getAttribute('rowspan') || '1', 10) || 1
        for (let r = 0; r < rowspan; r += 1) {
          grid[rowIndex + r] = grid[rowIndex + r] || []
          for (let c = 0; c < colspan; c += 1) {
            grid[rowIndex + r][colIndex + c] = label
          }
        }
        colIndex += colspan
      }
    })

    const maxCols = Math.max(...grid.map(row => row.length))
    const used = Object.create(null)
    const headers = []
    for (let col = 0; col < maxCols; col += 1) {
      const path = []
      for (let row = 0; row < grid.length; row += 1) {
        const label = String(grid[row]?.[col] || '').trim()
        if (!label) continue
        if (path[path.length - 1] !== label) path.push(label)
      }
      let header = path.join('/') || `列${col + 1}`
      if (!used[header]) {
        used[header] = 1
      } else {
        used[header] += 1
        header = `${header}_${used[header]}`
      }
      headers.push(header)
    }
    return headers
  }

  function mapCellsToColumnKeys(cells, columnKeys) {
    const mapped = {}
    columnKeys.forEach((columnKey, index) => {
      mapped[columnKey] = textOf(cells[index])
    })
    return mapped
  }

  function parseActivityInfoCell(cell) {
    if (!cell) return {}
    const rawText = textOf(cell)
    const spuMatch = rawText.match(/SPU ID[:：]?\s*([0-9]+)/i)
    const productName = rawText.split(/SPU ID[:：]?/i)[0].trim()
    return {
      商品名称: productName || rawText,
      SPU: spuMatch?.[1] || '',
      商品信息: rawText,
    }
  }

  function getActivityTypeValue() {
    return String(getLabeledContainer('活动类型')?.querySelector('input[data-testid="beast-core-select-htmlInput"]')?.value || '').trim()
  }

  function getActivityThemeValue() {
    return String(getLabeledContainer('活动主题')?.querySelector('input[data-testid="beast-core-select-htmlInput"]')?.value || '').trim()
  }

  function getStatDateRangeValue() {
    return readRangeValueByLabel('统计日期')
  }

  function getStatSummaryRanges() {
    return [...textOf(document.body).matchAll(/统计时间段[:：]\s*([0-9-]+)\s*[～~]\s*([0-9-]+)/g)]
      .map(match => `${match[1]} ~ ${match[2]}`)
  }

  function getNormalizedStatSummaryRanges() {
    return getStatSummaryRanges()
      .map(normalizeDateRangeText)
      .filter(Boolean)
  }

  function isStatDateSurfaceConsistent() {
    const inputRange = normalizeDateRangeText(getStatDateRangeValue())
    const summaryRanges = getNormalizedStatSummaryRanges()
    if (!inputRange || !summaryRanges.length) return false
    return summaryRanges.every(range => range === inputRange)
  }

  function getResolvedStatDateRangeValue() {
    const inputRange = getStatDateRangeValue()
    const summaryRanges = getStatSummaryRanges()
    if (isStatDateSurfaceConsistent()) {
      return summaryRanges[0] || inputRange
    }
    return inputRange
  }

  function getFilterSurfaceSignature() {
    return [
      normalizeDateRangeText(getStatDateRangeValue()),
      getNormalizedStatSummaryRanges().join(','),
      getListPageNo(),
      getListTotalCount(),
      getListPageSignature(),
    ].join('|')
  }

  function normalizeDateRangeText(value) {
    return String(value || '')
      .replace(/\s+/g, '')
      .replace(/[～~]/g, '~')
      .replace(/[至到]/g, '~')
      .trim()
  }

  async function waitForFilterSurfaceStable(timeout = 8000) {
    const deadline = Date.now() + timeout
    let stableSignature = ''
    let stableHits = 0
    while (Date.now() < deadline) {
      const rows = getMainListRows()
      const busy = hasBusyWarning() && rows.length === 0
      if (busy) return false

      const signature = getFilterSurfaceSignature()
      const hasInput = !!getRangePickerInputByLabel('统计日期')
      const hasSummary = getStatSummaryRanges().length > 0
      if (hasInput && hasSummary) {
        if (stableSignature === signature) {
          stableHits += 1
        } else {
          stableSignature = signature
          stableHits = 1
        }
        if (stableHits >= 3) return true
      } else {
        stableSignature = ''
        stableHits = 0
      }

      await sleep(250)
    }
    return false
  }

  function hasExpectedSummaryRange(startDate, endDate) {
    const expected = normalizeDateRangeText(`${startDate} ~ ${endDate}`)
    return getStatSummaryRanges().some(range => normalizeDateRangeText(range) === expected)
  }

  async function waitForDateFilteredList(startDate, endDate, baseline = {}, timeout = 15000) {
    const expectedRange = normalizeDateRangeText(`${startDate} ~ ${endDate}`)
    const deadline = Date.now() + timeout
    let stableMarker = ''
    let stableHits = 0
    while (Date.now() < deadline) {
      const rows = getMainListRows()
      const empty = !!document.querySelector('[class*="TB_empty_"]')
      const busy = hasBusyWarning() && rows.length === 0
      if (busy) return false

      const currentPageNo = getListPageNo()
      const currentSignature = rows.length > 0 || empty ? getListPageSignature() : ''
      const currentTotalCount = getListTotalCount()
      const inputOk = normalizeDateRangeText(getStatDateRangeValue()) === expectedRange
      const summaryOk = hasExpectedSummaryRange(startDate, endDate)
      const pageOk = currentPageNo === 1
      const resultReady = rows.length > 0 || empty
      const signatureChanged = !!currentSignature && currentSignature !== String(baseline.signature || '')
      const totalChanged = Number.isFinite(baseline.totalCount) &&
        baseline.totalCount > 0 &&
        currentTotalCount > 0 &&
        currentTotalCount !== baseline.totalCount

      if (inputOk && summaryOk && pageOk && resultReady && (signatureChanged || totalChanged || empty)) {
        const marker = `${currentPageNo}:${currentTotalCount}:${currentSignature}:${empty ? 'empty' : 'rows'}`
        if (stableMarker === marker) {
          stableHits += 1
        } else {
          stableMarker = marker
          stableHits = 1
        }
        if (stableHits >= 2) return true
      } else {
        stableMarker = ''
        stableHits = 0
      }

      await sleep(300)
    }
    return false
  }

  async function applyStatDateRange(startDate, endDate) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const dateOk = await injectRangeByLabel('统计日期', startDate, endDate)
      if (!dateOk) {
        await sleep(500)
        continue
      }

      const baseline = {
        pageNo: getListPageNo(),
        totalCount: getListTotalCount(),
        signature: getListPageSignature(),
        inputRange: getStatDateRangeValue(),
        summaryRange: getStatSummaryRanges()[0] || getResolvedStatDateRangeValue(),
      }
      if (!clickQueryButton()) return false
      const filteredOk = await waitForDateFilteredList(startDate, endDate, baseline, 15000)
      if (filteredOk) return true

      await sleep(800)
    }

    return false
  }

  function scrapeCurrentPage(currentOuterSite) {
    const rows = getMainListRows()
    const headerTable = getMainListHeaderTable() || getMainListTable()
    const headers = getTableHeaders(headerTable)
    const dataHeaders = headers[0] === '列1' ? headers.slice(1) : headers.slice()
    const activeOuterSite = getResolvedOuterSite() || currentOuterSite || ''

    return rows.map((row, index) => {
      const cells = [...row.querySelectorAll('td')].filter(td => !hasClassFragment(td, 'TB_checkCell_'))
      const infoCell = cells[0] || cells[1] || cells[0]
      const info = parseActivityInfoCell(infoCell)
      const metricCells = cells.slice(1)
      const metricHeaders = dataHeaders.slice(1)
      return {
        外层站点: activeOuterSite,
        活动类型: getActivityTypeValue(),
        活动主题: getActivityThemeValue(),
        统计日期范围: getResolvedStatDateRangeValue(),
        列表页码: getListPageNo(),
        抓取时间: localNow(),
        列表行号: index + 1,
        ...info,
        ...mapCellsToColumnKeys(metricCells, metricHeaders),
      }
    })
  }

  function buildRowDedupeKey(row) {
    const transientKeys = new Set(['列表页码', '列表行号', '抓取时间'])
    return Object.keys(row || {})
      .filter(key => !transientKeys.has(key))
      .sort()
      .map(key => `${key}:${compact(row[key])}`)
      .join('|')
  }

  function appendUniqueRows(rows, sharedState) {
    const seenRowKeys = Array.isArray(sharedState.seenRowKeys) ? sharedState.seenRowKeys.slice() : []
    const seen = new Set(seenRowKeys)
    const uniqueRows = []
    let skipped = 0

    for (const row of rows) {
      const key = buildRowDedupeKey(row)
      if (!key || !seen.has(key)) {
        uniqueRows.push(row)
        if (key) {
          seen.add(key)
          seenRowKeys.push(key)
        }
        continue
      }
      skipped += 1
    }

    return { rows: uniqueRows, seenRowKeys, skipped }
  }

  function nextOuterSite(targetSites, currentSite) {
    const idx = targetSites.indexOf(currentSite)
    if (idx < 0 || idx + 1 >= targetSites.length) return ''
    return targetSites[idx + 1]
  }

  function moreOuterSitesRemain(targetSites, currentSite) {
    return !!nextOuterSite(targetSites, currentSite)
  }

  function scheduleListPageRecovery(sharedState, reason, targetPageNo, targetSite) {
    const retry = Number(sharedState.listPageRetry || 0)
    if (retry >= LIST_PAGE_RECOVERY_LIMIT) {
      return fail(`活动数据列表分页重试 ${retry} 次后仍失败：${reason}`)
    }
    return reloadPage('recover_list_page', 2200, {
      ...sharedState,
      listBusyRetry: 0,
      listPageRetry: retry + 1,
      listPageRetryReason: reason,
      recoverPageNo: Math.max(1, Number(targetPageNo || 1)),
      recoverOuterSite: targetSite || sharedState.currentOuterSite || getResolvedOuterSite() || '',
    })
  }

  function buildBusyReload(nextPhaseName, sharedState) {
    const retry = Number(sharedState.listBusyRetry || 0)
    const currentPageNo = Math.max(1, Number(sharedState.lastCollectedPageNo || sharedState.currentPageNo || getListPageNo() || 1))
    const currentSite = sharedState.targetOuterSite || sharedState.currentOuterSite || getResolvedOuterSite() || ''
    if (retry >= LIST_BUSY_RETRY_LIMIT) {
      return fail('Temu 活动数据列表连续出现 “Too many visitors...” 空表，刷新补偿后仍未恢复')
    }
    return scheduleListPageRecovery({
      ...sharedState,
      listBusyRetry: retry + 1,
      recoverPageNo: currentPageNo,
      recoverOuterSite: currentSite,
    }, 'Temu 活动数据列表出现 “Too many visitors...” 空表', currentPageNo, currentSite)
  }

  async function prepareCurrentSite(sharedState, nextPhaseName = 'collect', extraShared = {}) {
    const ready = await waitForListReady(12000)
    if (!ready.ready) return fail('活动数据列表加载超时')
    if (ready.busy) return buildBusyReload('prepare_current_site', sharedState)
    const stableBeforeReset = await waitForFilterSurfaceStable(8000)
    if (!stableBeforeReset) return fail('活动数据筛选面板未稳定，无法继续执行')

    if (!clickResetButton()) {
      return fail('未找到活动数据列表的「重置」按钮')
    }
    const stableAfterReset = await waitForFilterSurfaceStable(10000)
    if (!stableAfterReset) return fail('点击重置后活动数据筛选面板未稳定')

    if (activityTypeParam) {
      const typeOk = await setMainSelectByLabel('活动类型', activityTypeParam)
      if (!typeOk) return fail(`活动类型切换失败：${activityTypeParam}`)
    }

    if (activityThemeParam) {
      if (!activityTypeParam) return fail('活动主题需要先指定活动类型')
      const themeReady = await waitForSelectEnabled('活动主题', 5000)
      if (!themeReady) return fail('活动主题下拉未启用，请先选择活动类型')
      const themeOk = await setMainSelectByLabel('活动主题', activityThemeParam)
      if (!themeOk) return fail(`活动主题切换失败：${activityThemeParam}`)
    }

    if (spuIdQuery) {
      const spuOk = await setMainTextInput('SPU ID', spuIdQuery)
      if (!spuOk) return fail('填写「SPU ID」失败')
    }

    if (statDateRange?.start && statDateRange?.end) {
      const dateOk = await applyStatDateRange(statDateRange.start, statDateRange.end)
      if (!dateOk) return fail(`统计日期设置失败：${statDateRange.start} ~ ${statDateRange.end}`)
    }

    return nextPhase(nextPhaseName, 200, {
      ...sharedState,
      ...extraShared,
    })
  }

  async function advanceCursor(sharedState) {
    const ready = await waitForTargetReady(15000)
    if (!ready) return fail('活动数据页面状态丢失，无法继续翻页')

    const { available, target } = buildTargetOuterSites()
    if (!target.length) return fail(`未找到可抓取的外层站点，可用站点：${available.join(' / ') || '无'}`)

    const currentSite = sharedState.currentOuterSite || getResolvedOuterSite() || target[0]
    const currentPageNo = getListPageNo()

    if (hasNextListPage()) {
      const oldSig = getListPageSignature()
      const oldPageNo = currentPageNo
      await sleep(PAGER_THROTTLE_MS)
      if (!clickNextListPage()) {
        return fail('活动数据列表翻页失败：无法点击下一页')
      }
      const changed = await waitListPageChange(oldSig, oldPageNo, 10000, oldPageNo + 1)
      if (!changed) {
        return scheduleListPageRecovery(sharedState, '活动数据列表翻页后页码/数据未更新', oldPageNo + 1, currentSite)
      }
      return nextPhase('after_list_page_turn', 200, {
        ...sharedState,
        targetOuterSites: target,
        currentOuterSite: currentSite,
        lastCollectedPageNo: Number(sharedState.currentPageNo || oldPageNo),
      })
    }

    if (listShouldHaveMorePages(currentPageNo)) {
      return scheduleListPageRecovery(
        sharedState,
        `活动数据列表分页状态异常：第 ${currentPageNo} 页显示共有 ${getListTotalCount()} 条，但下一页按钮不可用`,
        currentPageNo,
        currentSite,
      )
    }

    const nextSite = nextOuterSite(target, currentSite)
    if (!nextSite) return complete([], false)

    const targetUrl = getOuterSiteUrl(nextSite)
    if (!targetUrl) return fail(`切换外层站点失败：${nextSite}`)
    location.href = targetUrl
    return nextPhase('after_outer_site_switch', 2600, {
      targetOuterSites: target,
      targetOuterSite: nextSite,
    })
  }

  try {
    if (phase === 'main') {
      if (page === 1) return nextPhase('ensure_target', 0)
      return nextPhase('advance_cursor', 0)
    }

    if (phase === 'ensure_target') {
      if (!location.href.includes('/main/act/data-full')) {
        location.href = TARGET_URL
        return nextPhase('ensure_target', mode === 'new' ? 2000 : 1400)
      }

      const ready = await waitForTargetReady(15000)
      if (!ready) return fail('Temu 活动数据页面未加载，请确认已登录并能打开「后台-活动数据」页面')

      const { available, target } = buildTargetOuterSites()
      if (!target.length) return fail(`未找到可抓取的外层站点，可用站点：${available.join(' / ') || '无'}`)

      const activeSite = getResolvedOuterSite() || target[0]
      if (activeSite !== target[0]) {
        const targetUrl = getOuterSiteUrl(target[0])
        if (!targetUrl) return fail(`外层站点切换失败：${target[0]}`)
        location.href = targetUrl
        return nextPhase('after_outer_site_switch', 2600, {
          targetOuterSites: target,
          targetOuterSite: target[0],
        })
      }

      return nextPhase('prepare_current_site', 200, {
        targetOuterSites: target,
      })
    }

    if (phase === 'after_outer_site_switch') {
      const targetSite = shared.targetOuterSite || ''
      const switched = await waitForTargetOuterSite(targetSite, 30000)
      if (!switched) {
        return fail(`外层站点切换未生效：期望 ${targetSite || '未知站点'}，当前 ${getResolvedOuterSite() || '未知站点'}`)
      }
      const ready = await waitForTargetReady(30000)
      if (!ready) return fail(`切换外层站点后活动数据页面未恢复：${targetSite || '未知站点'}`)
      const state = await waitForListReady(12000)
      if (!state.ready) return fail(`切换外层站点后活动数据列表未加载：${targetSite || '未知站点'}`)
      if (state.busy) return buildBusyReload('after_outer_site_switch', shared)
      return nextPhase(shared.resume_phase || 'prepare_current_site', 200, {
        ...shared,
        currentOuterSite: getResolvedOuterSite() || targetSite || '',
        targetOuterSites: shared.targetOuterSites || buildTargetOuterSites().target,
        resume_phase: '',
      })
    }

    if (phase === 'prepare_current_site') {
      return await prepareCurrentSite(shared, 'collect', {
        currentOuterSite: shared.currentOuterSite || getActiveOuterSite() || '',
      })
    }

    if (phase === 'recover_list_page') {
      const targetSite = shared.recoverOuterSite || shared.currentOuterSite || getResolvedOuterSite() || ''
      const targetUrl = getOuterSiteUrl(targetSite) || TARGET_URL
      if (location.href !== targetUrl) {
        location.href = targetUrl
        return nextPhase('recover_list_page', mode === 'new' ? 2600 : 2200, shared)
      }

      const switched = await waitForTargetOuterSite(targetSite, 30000)
      if (!switched) {
        return fail(`活动数据页面恢复失败：未能切回站点 ${targetSite || '未知站点'}`)
      }

      const ready = await waitForTargetReady(30000)
      if (!ready) return fail('活动数据页面恢复失败：页面未完成加载')

      return nextPhase('recover_list_page_prepare', 0, shared)
    }

    if (phase === 'recover_list_page_prepare') {
      return await prepareCurrentSite(shared, 'restore_list_page', {
        currentOuterSite: shared.recoverOuterSite || shared.currentOuterSite || getResolvedOuterSite() || '',
      })
    }

    if (phase === 'restore_list_page') {
      const targetPageNo = Math.max(1, Number(shared.recoverPageNo || 1))
      const targetSite = shared.recoverOuterSite || shared.currentOuterSite || getResolvedOuterSite() || ''
      if (targetPageNo > 1) {
        await sleep(PAGER_THROTTLE_MS)
        const restored = await ensureListPageNo(targetPageNo, 60000)
        if (!restored) {
          return scheduleListPageRecovery(shared, `恢复到第 ${targetPageNo} 页失败`, targetPageNo, targetSite)
        }
      }

      const state = await waitForListReady(15000)
      if (!state.ready) {
        return scheduleListPageRecovery(shared, `恢复后的第 ${targetPageNo} 页加载超时`, targetPageNo, targetSite)
      }
      if (state.busy) {
        return scheduleListPageRecovery(shared, `恢复后的第 ${targetPageNo} 页出现 Too many visitors`, targetPageNo, targetSite)
      }

      return nextPhase('collect', 200, {
        ...shared,
        currentOuterSite: targetSite,
        recoverPageNo: 0,
        recoverOuterSite: '',
        listPageRetry: 0,
        listPageRetryReason: '',
      })
    }

    if (phase === 'after_list_page_turn') {
      const state = await waitForListReady(15000)
      const targetSite = shared.currentOuterSite || getActiveOuterSite()
      const targetPageNo = Math.max(1, Number(shared.lastCollectedPageNo || shared.currentPageNo || 0) + 1)
      if (!state.ready) return scheduleListPageRecovery(shared, '活动数据翻页后加载超时', targetPageNo, targetSite)
      if (state.busy) return scheduleListPageRecovery(shared, '活动数据翻页后出现 Too many visitors', targetPageNo, targetSite)
      return nextPhase('collect', 200, {
        ...shared,
        currentOuterSite: targetSite,
      })
    }

    if (phase === 'advance_cursor') {
      return await advanceCursor(shared)
    }

    if (phase === 'collect') {
      const currentOuterSite = getResolvedOuterSite() || shared.currentOuterSite || ''
      const targetOuterSites = shared.targetOuterSites || buildTargetOuterSites().target
      const currentPageNo = getListPageNo()
      const pageData = scrapeCurrentPage(currentOuterSite)
      const deduped = appendUniqueRows(pageData, shared)
      const more = hasNextListPage() || moreOuterSitesRemain(targetOuterSites, currentOuterSite)
      return complete(deduped.rows, more, {
        ...shared,
        targetOuterSites,
        currentOuterSite,
        currentPageNo,
        lastCollectedPageNo: currentPageNo,
        seenRowKeys: deduped.seenRowKeys,
        skippedDuplicateRows: Number(shared.skippedDuplicateRows || 0) + deduped.skipped,
      })
    }

    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || String(error))
  }
})()
