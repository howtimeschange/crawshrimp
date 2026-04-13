;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = Number(window.__CRAWSHRIMP_PAGE__ || 1)
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const TARGET_URL = 'https://agentseller.temu.com/main/mall-flux-analysis-full'
  const LIST_BUSY_RETRY_LIMIT = 30
  const LIST_PAGE_RECOVERY_LIMIT = 30
  const LIST_READY_TIMEOUT_MS = 30000
  const SAFE_PAGE_LOOP_LIMIT = 120
  const PAGER_THROTTLE_MS = 1200

  const OUTER_SITE_BLACKLIST = new Set(['商家中心'])
  const CANONICAL_OUTER_SITE_ORDER = ['全球', '美国', '欧区']
  const GRAIN_OPTIONS = ['按日', '按周', '按月']

  function normalizeArray(value) {
    if (!Array.isArray(value)) return []
    return value.map(item => String(item || '').trim()).filter(Boolean)
  }

  function normalizeDateRangeParam(value) {
    if (!value || typeof value !== 'object') return {}
    const start = String(value.start || '').trim()
    const end = String(value.end || '').trim()
    if (start && !end) return { start, end: start }
    if (end && !start) return { start: end, end }
    if (!start || !end) return {}
    return { start, end }
  }

  function normalizeSingleTemporalRequest(value) {
    if (typeof value === 'string') return String(value || '').trim()
    if (!value || typeof value !== 'object') return ''
    const direct = String(value.value || '').trim()
    const start = String(value.start || '').trim()
    const end = String(value.end || '').trim()
    return direct || start || end
  }

  const persistedRequestShared = {
    requestedMode: String(shared.requestedMode || params.mode || 'current').trim().toLowerCase(),
    requestedOuterSites: normalizeArray(shared.requestedOuterSites || params.outer_sites),
    requestedStatGrain: String(shared.requestedStatGrain || params.stat_grain || '').trim(),
    requestedStatDateRange: normalizeDateRangeParam(shared.requestedStatDateRange || params.stat_date_range),
    requestedStatWeek: normalizeSingleTemporalRequest(shared.requestedStatWeek || params.stat_week || params.stat_week_range),
    requestedStatMonth: normalizeSingleTemporalRequest(shared.requestedStatMonth || params.stat_month || params.stat_month_range),
  }

  const mode = persistedRequestShared.requestedMode
  const outerSitesParam = persistedRequestShared.requestedOuterSites
  const statDateRange = persistedRequestShared.requestedStatDateRange
  const statWeekParam = persistedRequestShared.requestedStatWeek
  const statMonthParam = persistedRequestShared.requestedStatMonth
  const statGrainParam = persistedRequestShared.requestedStatGrain

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

  async function waitForActiveOuterSite(targetSite, timeout = 30000) {
    if (!targetSite) return true
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (getResolvedOuterSite() === targetSite) return true
      await sleep(200)
    }
    return false
  }

  async function clickCapsule(label) {
    if (!label) return true
    const capsule = [...document.querySelectorAll('[class*="TAB_capsule_"]')]
      .filter(isVisible)
      .find(el => textOf(el) === label)
    if (!capsule) return false
    if (hasClassFragment(capsule, 'TAB_active_')) return true
    clickLike(capsule)
    const switched = await waitFor(() => getActiveGrainValue() === label, 5000, 200)
    if (switched) await sleep(600)
    return switched
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
        score: countTableBodyRows(table) + (/2026-|总浏览量|总访客数|店铺页支付转化率/.test(textOf(table)) ? 1000 : 0),
      }))
      .filter(item => item.rowCount > 0 || /总浏览量|总访客数|店铺页支付转化率/.test(textOf(item.table)))
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
        const aScore = a.headerCount + (/总数据|商品数据|店铺数据|日期/.test(a.text) ? 1000 : 0)
        const bScore = b.headerCount + (/总数据|商品数据|店铺数据|日期/.test(b.text) ? 1000 : 0)
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

  function getVisibleMainListEmptyNode() {
    return [...document.querySelectorAll('[class*="TB_empty_"]')]
      .filter(isVisible)
      .find(node => !isInsideVisibleDrawer(node)) || null
  }

  function hasVisibleMainListEmpty() {
    return !!getVisibleMainListEmptyNode()
  }

  function getListPageNo() {
    const active = getMainPagerRoot().querySelector('li[class*="PGT_pagerItemActive_"]')
    const value = parseInt(textOf(active), 10)
    return Number.isFinite(value) && value > 0 ? value : 1
  }

  function hasNextListPage() {
    const next = getMainPagerRoot().querySelector('li[class*="PGT_next_"]')
    return !!(next && !hasClassFragment(next, 'PGT_disabled_'))
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
      const empty = hasVisibleMainListEmpty()
      const busy = hasBusyWarning() && rows.length === 0
      if (rows.length > 0 || empty || busy) {
        return { ready: true, rows, empty, busy }
      }
      await sleep(500)
    }
    return {
      ready: false,
      rows: getMainListRows(),
      empty: hasVisibleMainListEmpty(),
      busy: hasBusyWarning(),
    }
  }

  async function waitListPageChange(oldSignature, oldPageNo = 0, timeout = 10000, expectedPageNo = 0) {
    const deadline = Date.now() + timeout
    let stableSignature = ''
    let stableHits = 0
    while (Date.now() < deadline) {
      const rows = getMainListRows()
      const empty = hasVisibleMainListEmpty()
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

  function formatDateValue(date) {
    if (!date || Number.isNaN(date.valueOf?.())) return ''
    const pad = value => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }

  function parseDateValue(value) {
    const text = String(value || '').trim()
    if (!text) return null
    const d = new Date(`${text}T00:00:00`)
    if (Number.isNaN(d.valueOf())) return null
    d.setHours(0, 0, 0, 0)
    return d
  }

  function parseDateLikeValue(value) {
    if (!value) return null
    if (typeof value === 'string') return parseDateValue(value.slice(0, 10))
    if (typeof value === 'object' && typeof value.getFullYear === 'function') {
      const cloned = new Date(value.valueOf())
      if (Number.isNaN(cloned.valueOf())) return null
      cloned.setHours(0, 0, 0, 0)
      return cloned
    }
    return null
  }

  function normalizeRangeParam(value) {
    const start = String(value?.start || '').trim()
    const end = String(value?.end || '').trim()
    if (start && !end) return { start, end: start }
    if (end && !start) return { start: end, end }
    return { start, end }
  }

  function normalizeSingleTemporalParam(value) {
    if (typeof value === 'string') return String(value || '').trim()
    if (!value || typeof value !== 'object') return ''
    const direct = String(value.value || '').trim()
    const start = String(value.start || '').trim()
    const end = String(value.end || '').trim()
    return direct || start || end
  }

  function normalizeDateRangeText(value) {
    return String(value || '')
      .replace(/\s+/g, '')
      .replace(/[～~]/g, '~')
      .replace(/[至到]/g, '~')
      .trim()
  }

  function normalizeOrderedDateRange(range) {
    const startDate = parseDateValue(range?.start)
    const endDate = parseDateValue(range?.end)
    if (!startDate || !endDate) return { start: '', end: '' }
    if (startDate <= endDate) {
      return {
        start: formatDateValue(startDate),
        end: formatDateValue(endDate),
      }
    }
    return {
      start: formatDateValue(endDate),
      end: formatDateValue(startDate),
    }
  }

  function expandWeekValue(value) {
    const match = String(value || '').trim().match(/^(\d{4})-W(\d{2})$/i)
    if (!match) return null
    const year = Number(match[1])
    const week = Number(match[2])
    if (!Number.isFinite(year) || !Number.isFinite(week) || week < 1 || week > 53) return null

    const jan4 = new Date(year, 0, 4)
    jan4.setHours(0, 0, 0, 0)
    const jan4Day = jan4.getDay() || 7
    const start = new Date(jan4)
    start.setDate(jan4.getDate() - jan4Day + 1 + ((week - 1) * 7))
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    end.setHours(0, 0, 0, 0)
    return {
      start: formatDateValue(start),
      end: formatDateValue(end),
    }
  }

  function expandMonthValue(value) {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})$/)
    if (!match) return null
    const year = Number(match[1])
    const month = Number(match[2])
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null

    const start = new Date(year, month - 1, 1)
    start.setHours(0, 0, 0, 0)
    const end = new Date(year, month, 0)
    end.setHours(0, 0, 0, 0)
    return {
      start: formatDateValue(start),
      end: formatDateValue(end),
    }
  }

  function resolveRequestedStatWeekValue() {
    return normalizeSingleTemporalParam(statWeekParam)
  }

  function resolveRequestedStatMonthValue() {
    return normalizeSingleTemporalParam(statMonthParam)
  }

  function formatWeekPickerDisplayValue(value) {
    const match = String(value || '').trim().match(/^(\d{4})-W(\d{2})$/i)
    if (!match) return String(value || '').trim()
    return `${match[1]} 第 ${match[2]} 周`
  }

  function formatMonthPickerDisplayValue(value) {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})$/)
    if (!match) return String(value || '').trim()
    return `${match[1]}年${match[2]}月`
  }

  function resolveRequestedStatGrain() {
    if (GRAIN_OPTIONS.includes(statGrainParam)) return statGrainParam
    if (resolveRequestedStatWeekValue()) return '按周'
    if (resolveRequestedStatMonthValue()) return '按月'
    const dayRange = normalizeRangeParam(statDateRange)
    if (dayRange.start || dayRange.end) return '按日'
    return ''
  }

  function resolveRequestedStatRange(grain = resolveRequestedStatGrain()) {
    if (grain === '按周') {
      const range = expandWeekValue(resolveRequestedStatWeekValue())
      return normalizeOrderedDateRange({
        start: range?.start || '',
        end: range?.end || '',
      })
    }
    if (grain === '按月') {
      const range = expandMonthValue(resolveRequestedStatMonthValue())
      return normalizeOrderedDateRange({
        start: range?.start || '',
        end: range?.end || '',
      })
    }
    return normalizeOrderedDateRange(normalizeRangeParam(statDateRange))
  }

  function resolveRequestedStatRangeDisplay(grain = resolveRequestedStatGrain()) {
    if (grain === '按周') {
      return resolveRequestedStatWeekValue()
    }
    if (grain === '按月') {
      return resolveRequestedStatMonthValue()
    }

    const orderedRange = normalizeOrderedDateRange(normalizeRangeParam(statDateRange))
    if (!orderedRange.start || !orderedRange.end) return ''
    return orderedRange.start === orderedRange.end
      ? orderedRange.start
      : `${orderedRange.start} ~ ${orderedRange.end}`
  }

  function getStatPickerInputCandidates(selectors) {
    const candidates = [...document.querySelectorAll(selectors)]
    const visible = candidates.filter(isVisible)
    return visible.length ? visible : candidates
  }

  function getWeekPickerInput() {
    return getStatPickerInputCandidates('input[data-testid="beast-core-weekPicker-htmlInput"], input[class*="WPR_input_"]').find(Boolean) || null
  }

  function getMonthPickerInput() {
    return getStatPickerInputCandidates('input[data-testid="beast-core-monthPicker-htmlInput"], input[class*="MPR_input_"]').find(Boolean) || null
  }

  function getSingleValuePickerReactPropsFromInput(input) {
    const roots = [
      input,
      input?.closest('[data-testid]') || null,
      input?.parentElement || null,
    ].filter(Boolean)

    for (const root of roots) {
      const fiberKey = Object.keys(root).find(key => key.startsWith('__reactFiber')) || ''
      let fiber = fiberKey ? root[fiberKey] : null
      while (fiber) {
        const props = fiber.memoizedProps || null
        if (props && typeof props.onChange === 'function' && typeof props.value === 'string') {
          return props
        }
        fiber = fiber.return
      }
    }
    return null
  }

  function getDateValuePickerReactPropsFromInput(input) {
    const roots = [
      input,
      input?.closest('[data-testid]') || null,
      input?.parentElement || null,
    ].filter(Boolean)

    for (const root of roots) {
      const fiberKey = Object.keys(root).find(key => key.startsWith('__reactFiber')) || ''
      let fiber = fiberKey ? root[fiberKey] : null
      while (fiber) {
        const props = fiber.memoizedProps || null
        const value = props?.value
        if (props && typeof props.onChange === 'function' && value && typeof value.getFullYear === 'function') {
          return props
        }
        fiber = fiber.return
      }
    }
    return null
  }

  async function waitForSingleValuePickerReactProps(getInput, timeout = 4000) {
    const deadline = Date.now() + timeout
    let fallbackInput = null
    while (Date.now() < deadline) {
      const input = getInput()
      if (input && !fallbackInput) fallbackInput = input
      const props = input ? getSingleValuePickerReactPropsFromInput(input) : null
      if (props) return { input, props }
      await sleep(200)
    }
    const input = fallbackInput || getInput()
    return { input, props: input ? getSingleValuePickerReactPropsFromInput(input) : null }
  }

  function readWeekPickerDisplayValue() {
    return String(getWeekPickerInput()?.value || '').trim()
  }

  function readMonthPickerDisplayValue() {
    return String(getMonthPickerInput()?.value || '').trim()
  }

  function isWeekPickerValueMatch(weekValue) {
    const requested = String(weekValue || '').trim()
    if (!requested) return false
    const display = readWeekPickerDisplayValue()
    const expectedDisplay = formatWeekPickerDisplayValue(requested)
    return compact(display) === compact(expectedDisplay) || compact(display) === compact(requested)
  }

  function isMonthPickerValueMatch(monthValue) {
    const requested = String(monthValue || '').trim()
    if (!requested) return false
    const display = readMonthPickerDisplayValue()
    const expectedDisplay = formatMonthPickerDisplayValue(requested)
    return compact(display) === compact(expectedDisplay) || compact(display) === compact(requested)
  }

  function resolveWeekPickerTargetDate(weekValue) {
    const range = expandWeekValue(weekValue)
    const start = parseDateValue(range?.start || '')
    if (!start) return null
    const target = new Date(start)
    target.setDate(start.getDate() + 3)
    target.setHours(0, 0, 0, 0)
    return target
  }

  function resolveMonthPickerTargetDate(monthValue) {
    const range = expandMonthValue(monthValue)
    const start = parseDateValue(range?.start || '')
    if (!start) return null
    start.setHours(0, 0, 0, 0)
    return start
  }

  async function injectDateValuePicker(getInput, targetDate, verify) {
    if (!targetDate || Number.isNaN(targetDate.valueOf?.())) return false

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const input = getInput()
      const pickerProps = input ? getDateValuePickerReactPropsFromInput(input) : null
      if (pickerProps && typeof pickerProps.onChange === 'function') {
        try { pickerProps.onChange(new Date(targetDate.valueOf())) } catch (e) {}
        const matched = await waitFor(() => verify(), 3200, 200)
        if (matched) {
          await sleep(500)
          if (verify()) return true
        }
      }
      await sleep(300)
    }

    return false
  }

  async function injectSingleValuePicker(getInput, targetValue, expectedDisplay) {
    const requestedValue = String(targetValue || '').trim()
    const requestedDisplay = String(expectedDisplay || requestedValue).trim()
    if (!requestedValue || !requestedDisplay) return false

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { input, props } = await waitForSingleValuePickerReactProps(getInput, 3000)
      if (props && typeof props.onChange === 'function') {
        try { props.onChange(requestedDisplay) } catch (e) {}
        let matched = await waitFor(
          () => compact(String(getInput()?.value || '')) === compact(requestedDisplay),
          1200,
          200,
        )
        if (!matched && requestedDisplay !== requestedValue) {
          try { props.onChange(requestedValue) } catch (e) {}
          matched = await waitFor(
            () => compact(String(getInput()?.value || '')) === compact(requestedDisplay),
            1200,
            200,
          )
        }
        if (matched) {
          await sleep(500)
          if (compact(String(getInput()?.value || '')) === compact(requestedDisplay)) {
            return true
          }
        }
      }

      let matched = await waitFor(
        () => compact(String(getInput()?.value || '')) === compact(requestedDisplay),
        2500,
        200,
      )

      if (!matched && input) {
        setNativeInputValue(input, requestedDisplay)
        matched = await waitFor(
          () => compact(String(getInput()?.value || '')) === compact(requestedDisplay),
          2000,
          200,
        )
      }

      if (matched) {
        await sleep(500)
        if (compact(String(getInput()?.value || '')) === compact(requestedDisplay)) {
          return true
        }
      }

      await sleep(400)
    }

    return false
  }

  async function injectWeekPickerValue(weekValue) {
    const requested = String(weekValue || '').trim()
    if (!requested) return false
    if (isWeekPickerValueMatch(requested)) return true

    const dateMatched = await injectDateValuePicker(
      getWeekPickerInput,
      resolveWeekPickerTargetDate(requested),
      () => isWeekPickerValueMatch(requested),
    )
    if (dateMatched) return true

    return injectSingleValuePicker(getWeekPickerInput, requested, formatWeekPickerDisplayValue(requested))
  }

  async function injectMonthPickerValue(monthValue) {
    const requested = String(monthValue || '').trim()
    if (!requested) return false
    if (isMonthPickerValueMatch(requested)) return true

    const dateMatched = await injectDateValuePicker(
      getMonthPickerInput,
      resolveMonthPickerTargetDate(requested),
      () => isMonthPickerValueMatch(requested),
    )
    if (dateMatched) return true

    return injectSingleValuePicker(getMonthPickerInput, requested, formatMonthPickerDisplayValue(requested))
  }

  function getRangePickerInput(labelText = '统计日期') {
    return getRangePickerInputCandidates(labelText)[0] || null
  }

  function getRangePickerInputByLabel(labelText = '统计日期') {
    return getRangePickerInput(labelText)
  }

  function getRangePickerRootByLabel(labelText = '统计日期') {
    const input = getRangePickerInputByLabel(labelText)
    return input?.closest('[data-testid="beast-core-rangePicker-input"]') ||
      input?.closest('[class*="RPR_inputWrapper_"]') ||
      input?.parentElement ||
      null
  }

  function getRangePickerInputCandidates(labelText = '统计日期') {
    const container = getLabeledContainer(labelText)
    const rawRoots = [
      ...(container ? container.querySelectorAll('[data-testid="beast-core-rangePicker-input"], [class*="RPR_inputWrapper_"]') : []),
      ...document.querySelectorAll('[data-testid="beast-core-rangePicker-input"], [class*="RPR_inputWrapper_"]'),
    ]
    const roots = rawRoots.filter(isVisible).length
      ? rawRoots.filter(isVisible)
      : rawRoots.filter(Boolean)

    const inputs = []
    const seen = new Set()
    const pushInput = input => {
      if (!input || seen.has(input)) return
      seen.add(input)
      inputs.push(input)
    }

    for (const root of roots) {
      const rawRootInputs = [...root.querySelectorAll('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]')]
      const rootInputs = rawRootInputs.filter(isVisible).length
        ? rawRootInputs.filter(isVisible)
        : rawRootInputs
      rootInputs.forEach(pushInput)
    }

    const fallbackInputs = [
      ...(container ? container.querySelectorAll('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]') : []),
      ...document.querySelectorAll('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]'),
    ]
    const visibleFallbackInputs = fallbackInputs.filter(isVisible)
    ;(visibleFallbackInputs.length ? visibleFallbackInputs : fallbackInputs).forEach(pushInput)
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
      const fiberKey = Object.keys(root).find(key => key.startsWith('__reactFiber')) || ''
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

  function getRangePickerReactPropsByLabel(labelText = '统计日期') {
    const candidates = getRangePickerInputCandidates(labelText)
    for (const input of candidates) {
      const props = getRangePickerReactPropsFromInput(input)
      if (props) return props
    }
    return null
  }

  async function waitForRangePickerReactProps(labelText = '统计日期', timeout = 4000) {
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

  function readRangeDisplayValueByLabel(labelText = '统计日期') {
    return String(getRangePickerInputByLabel(labelText)?.value || '').trim()
  }

  function readRangeModelValueByLabel(labelText = '统计日期') {
    const candidates = getRangePickerInputCandidates(labelText)
    for (const input of candidates) {
      const props = getRangePickerReactPropsFromInput(input)
      const values = Array.isArray(props?.value) ? props.value : null
      if (!values || values.length !== 2) continue
      const start = parseDateLikeValue(values[0])
      const end = parseDateLikeValue(values[1])
      if (!start || !end) continue
      return {
        start: formatDateValue(start),
        end: formatDateValue(end),
      }
    }
    return null
  }

  function hasExpectedRangeModel(labelText, startDate, endDate) {
    const model = readRangeModelValueByLabel(labelText)
    return !!(model && model.start === startDate && model.end === endDate)
  }

  async function injectRangeByLabel(labelText, startDate, endDate, grain = '') {
    const start = parseDateValue(startDate)
    const end = parseDateValue(endDate)
    if (!start || !end) return false

    const expectedRange = normalizeDateRangeText(`${startDate} ~ ${endDate}`)
    const targetGrain = grain || getActiveGrainValue()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { input, props } = await waitForRangePickerReactProps(labelText, 4000)
      if (props && typeof props.onChange === 'function') {
        try {
          props.onChange([start, end])
        } catch (e) {}
      }

      let matched = await waitFor(() => {
        if (hasExpectedRangeModel(labelText, startDate, endDate)) return true
        if (targetGrain === '按日') {
          return normalizeDateRangeText(readRangeDisplayValueByLabel(labelText)) === expectedRange
        }
        return false
      }, 4000, 200)

      if (!matched && input && targetGrain === '按日') {
        setNativeInputValue(input, `${startDate} ~ ${endDate}`)
        matched = await waitFor(
          () => normalizeDateRangeText(readRangeDisplayValueByLabel(labelText)) === expectedRange,
          2000,
          200,
        )
      }

      if (matched) {
        await sleep(600)
        if (
          hasExpectedRangeModel(labelText, startDate, endDate) ||
          (targetGrain === '按日' && normalizeDateRangeText(readRangeDisplayValueByLabel(labelText)) === expectedRange)
        ) {
          return true
        }
      }

      await sleep(600)
    }

    return false
  }

  function getActiveStatDateTrigger(grain = getActiveGrainClassValue(), labelText = '统计日期') {
    if (grain === '按周') return getWeekPickerInput()
    if (grain === '按月') return getMonthPickerInput()
    return getRangePickerRootByLabel(labelText) || getRangePickerInputByLabel(labelText)
  }

  async function openStatDatePickerPanel(grain = getActiveGrainClassValue(), labelText = '统计日期') {
    const trigger = getActiveStatDateTrigger(grain, labelText)
    if (!trigger) return false
    clickLike(trigger)
    await sleep(400)
    return true
  }

  function findVisibleButtonByText(labels) {
    if (!Array.isArray(labels) || !labels.length) return null
    return [...document.querySelectorAll('button, [role="button"], div, span')]
      .filter(isVisible)
      .find(el => labels.includes(textOf(el)) && !isInsideVisibleDrawer(el)) || null
  }

  async function tryCommitStatDateSelection(grain = getActiveGrainClassValue(), labelText = '统计日期') {
    await openStatDatePickerPanel(grain, labelText)

    const confirmed = await waitFor(() => !!findVisibleButtonByText(['确认', '确定']), 1800, 200)
    if (confirmed) {
      const confirmButton = findVisibleButtonByText(['确认', '确定'])
      if (confirmButton) {
        clickLike(confirmButton)
        await sleep(500)
        return true
      }
    }

    try { clickLike(document.body) } catch (e) {}
    await sleep(250)
    return false
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

  function getActiveGrainClassValue() {
    return getActiveGrainValue()
  }

  function hasExpectedStatPickerValue(grain = getActiveGrainClassValue()) {
    if (grain === '按周') {
      const weekValue = resolveRequestedStatWeekValue()
      return !weekValue || isWeekPickerValueMatch(weekValue)
    }
    if (grain === '按月') {
      const monthValue = resolveRequestedStatMonthValue()
      return !monthValue || isMonthPickerValueMatch(monthValue)
    }
    return false
  }

  function getStatDateRangeValue() {
    const activeGrain = getActiveGrainClassValue()
    if (activeGrain === '按周') {
      const weekDisplay = readWeekPickerDisplayValue()
      if (weekDisplay) return weekDisplay
    }
    if (activeGrain === '按月') {
      const monthDisplay = readMonthPickerDisplayValue()
      if (monthDisplay) return monthDisplay
    }

    const model = readRangeModelValueByLabel('统计日期')
    if (model?.start && model?.end) return `${model.start} ~ ${model.end}`
    const displayValue = readRangeDisplayValueByLabel('统计日期')
    if (displayValue) return displayValue

    const requestedGrain = resolveRequestedStatGrain()
    const requestedRange = resolveRequestedStatRange(requestedGrain)
    const requestedDisplay = resolveRequestedStatRangeDisplay(requestedGrain)
    if (
      requestedDisplay &&
      requestedGrain &&
      requestedGrain === activeGrain &&
      requestedRange.start &&
      requestedRange.end &&
      doesCurrentRowsMatchRange(parseDateValue(requestedRange.start), parseDateValue(requestedRange.end), requestedGrain)
    ) {
      return requestedDisplay
    }

    return ''
  }

  function getActiveGrainValue() {
    const active = [...document.querySelectorAll('[class*="TAB_capsule_"][class*="TAB_active_"]')]
      .find(isVisible)
    return textOf(active)
  }

  function getCurrentRowDates() {
    return getMainListRows()
      .map(row => {
        const cells = [...row.querySelectorAll('td')].filter(td => textOf(td) !== '')
        return String(textOf(cells[0]) || '').trim()
      })
      .filter(Boolean)
  }

  function getListTotalCount() {
    const pagerText = textOf(getMainPagerRoot())
    const match = pagerText.match(/共有\s*(\d+)\s*条/)
    return match ? Number(match[1]) : 0
  }

  function getExpectedRowKindByGrain(grain) {
    if (grain === '按周') return 'week'
    if (grain === '按月') return 'month'
    if (grain === '按日') return 'day'
    return ''
  }

  function parseDateCellRange(value) {
    const normalized = normalizeDateRangeText(value)
    if (!normalized) return null

    const singleDayMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})$/)
    if (singleDayMatch) {
      const date = parseDateValue(singleDayMatch[1])
      if (!date) return null
      return {
        kind: 'day',
        start: date,
        end: date,
      }
    }

    const weekMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})$/)
    if (weekMatch) {
      const start = parseDateValue(weekMatch[1])
      const end = parseDateValue(weekMatch[2])
      if (!start || !end) return null
      return {
        kind: 'week',
        start,
        end,
      }
    }

    const monthMatch = normalized.match(/^(\d{4})-(\d{2})$/)
    if (monthMatch) {
      const expanded = expandMonthValue(normalized)
      const start = parseDateValue(expanded?.start)
      const end = parseDateValue(expanded?.end)
      if (!start || !end) return null
      return {
        kind: 'month',
        start,
        end,
      }
    }

    return null
  }

  function doesCurrentRowsMatchRange(startDate, endDate, grain) {
    const empty = hasVisibleMainListEmpty()
    const rows = getMainListRows()
    if (!rows.length) return empty

    const expectedKind = getExpectedRowKindByGrain(grain)
    const rowDates = getCurrentRowDates()
    if (!rowDates.length) return false

    return rowDates.every(dateText => {
      const parsed = parseDateCellRange(dateText)
      if (!parsed) return false
      if (expectedKind && parsed.kind !== expectedKind) return false
      return parsed.start >= startDate && parsed.end <= endDate
    })
  }

  function buildDateFilterBaseline() {
    return {
      pageNo: getListPageNo(),
      totalCount: getListTotalCount(),
      signature: getListPageSignature(),
      grain: getActiveGrainClassValue(),
    }
  }

  async function waitForGrainSurfaceReady(grain, timeout = 8000) {
    const expectedKind = getExpectedRowKindByGrain(grain)
    if (!grain || !expectedKind) return true

    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const ready = await waitForListReady(3000)
      if (ready.busy) return false

      const activeGrain = getActiveGrainClassValue()
      if (activeGrain !== grain) {
        await sleep(300)
        continue
      }

      const rowDates = getCurrentRowDates()
      const empty = hasVisibleMainListEmpty()
      if (!rowDates.length && empty) return true
      if (rowDates.length && rowDates.every(dateText => parseDateCellRange(dateText)?.kind === expectedKind)) {
        return true
      }

      await sleep(300)
    }
    return false
  }

  async function waitForDateFilteredRows(startDateText, endDateText, options = {}, timeout = 15000) {
    const startDate = parseDateValue(startDateText)
    const endDate = parseDateValue(endDateText)
    if (!startDate || !endDate) return false

    const grain = String(options?.grain || '').trim()
    const baseline = options?.baseline || {}
    const expectedRange = normalizeDateRangeText(`${startDateText} ~ ${endDateText}`)
    let stableMarker = ''
    let stableHits = 0

    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const ready = await waitForListReady(3000)
      if (ready.busy) return false

      const rows = getMainListRows()
      const empty = hasVisibleMainListEmpty()
      const signature = rows.length > 0 || empty ? getListPageSignature() : ''
      const currentPageNo = getListPageNo()
      const totalCount = getListTotalCount()
      const grainOk = !grain || getActiveGrainClassValue() === grain
      const inputOk = grain === '按周'
        ? hasExpectedStatPickerValue('按周') || !readWeekPickerDisplayValue()
        : grain === '按月'
          ? hasExpectedStatPickerValue('按月') || !readMonthPickerDisplayValue()
          : (
            hasExpectedRangeModel('统计日期', startDateText, endDateText) ||
            normalizeDateRangeText(getStatDateRangeValue()) === expectedRange
          )
      const pageOk = currentPageNo === 1
      const rowsOk = doesCurrentRowsMatchRange(startDate, endDate, grain)
      const signatureChanged = !!signature && signature !== String(baseline.signature || '')
      const totalChanged = Number.isFinite(baseline.totalCount) &&
        baseline.totalCount > 0 &&
        totalCount > 0 &&
        totalCount !== baseline.totalCount
      const pageChanged = Number.isFinite(baseline.pageNo) && baseline.pageNo > 1 && currentPageNo === 1
      const grainChanged = !!grain && String(baseline.grain || '') !== grain
      const changed = empty || signatureChanged || totalChanged || pageChanged || grainChanged || !baseline.signature
      const allowUnchangedMatch = !!(grain && grain !== '按日')

      if (grainOk && inputOk && pageOk && rowsOk && (changed || allowUnchangedMatch)) {
        const marker = `${currentPageNo}:${totalCount}:${signature}:${empty ? 'empty' : 'rows'}`
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

      await sleep(500)
    }
    return false
  }

  async function applyStatDateRange(startDate, endDate, grain = '') {
    const startDateValue = parseDateValue(startDate)
    const endDateValue = parseDateValue(endDate)
    if (!startDateValue || !endDateValue) return false

    const targetGrain = grain || getActiveGrainClassValue()
    const inputAlreadyOk = targetGrain === '按周'
      ? hasExpectedStatPickerValue('按周')
      : targetGrain === '按月'
        ? hasExpectedStatPickerValue('按月')
        : (
          hasExpectedRangeModel('统计日期', startDate, endDate) ||
          normalizeDateRangeText(getStatDateRangeValue()) === normalizeDateRangeText(`${startDate} ~ ${endDate}`)
        )
    if (
      getListPageNo() === 1 &&
      inputAlreadyOk &&
      doesCurrentRowsMatchRange(startDateValue, endDateValue, targetGrain)
    ) {
      return true
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const baseline = buildDateFilterBaseline()
      const dateOk = targetGrain === '按周'
        ? await injectWeekPickerValue(resolveRequestedStatWeekValue())
        : targetGrain === '按月'
          ? await injectMonthPickerValue(resolveRequestedStatMonthValue())
          : await injectRangeByLabel('统计日期', startDate, endDate, targetGrain)
      if (!dateOk) {
        await sleep(500)
        continue
      }

      const autoRefreshOk = await waitForDateFilteredRows(startDate, endDate, {
        grain: targetGrain,
        baseline,
      }, 3500)
      if (autoRefreshOk) return true

      await tryCommitStatDateSelection(targetGrain, '统计日期')
      const filteredOk = await waitForDateFilteredRows(startDate, endDate, {
        grain: targetGrain,
        baseline,
      }, 15000)
      if (filteredOk) return true

      await sleep(800)
    }

    return false
  }

  function scrapeCurrentPage(currentOuterSite) {
    const rows = getMainListRows()
    const headerTable = getMainListHeaderTable() || getMainListTable()
    const headers = getTableHeaders(headerTable)
    const activeOuterSite = getResolvedOuterSite() || currentOuterSite || ''
    return rows.map((row, index) => {
      const cells = [...row.querySelectorAll('td')].filter(td => textOf(td) !== '')
      return {
        外层站点: activeOuterSite,
        统计日期范围: getStatDateRangeValue(),
        统计粒度: getActiveGrainClassValue(),
        列表页码: getListPageNo(),
        抓取时间: localNow(),
        列表行号: index + 1,
        ...mapCellsToColumnKeys(cells, headers),
      }
    })
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
      return fail(`店铺流量列表分页重试 ${retry} 次后仍失败：${reason}`)
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
      return fail('Temu 店铺流量列表连续出现 “Too many visitors...” 空表，刷新补偿后仍未恢复')
    }
    return scheduleListPageRecovery({
      ...sharedState,
      listBusyRetry: retry + 1,
      recoverPageNo: currentPageNo,
      recoverOuterSite: currentSite,
    }, 'Temu 店铺流量列表出现 “Too many visitors...” 空表', currentPageNo, currentSite)
  }

  async function waitForTargetReady(timeout = 15000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const hasSites = getAvailableOuterSites().length > 0
      const hasGrains = GRAIN_OPTIONS.some(option => compact(textOf(document.body)).includes(compact(option)))
      const hasTable = !!getMainListTable() || !!getMainListHeaderTable()
      if (hasSites && hasGrains && hasTable) return true
      await sleep(400)
    }
    return false
  }

  async function prepareCurrentSite(sharedState, nextPhaseName = 'collect', extraShared = {}) {
    const currentSite = sharedState.currentOuterSite || sharedState.targetOuterSite || getResolvedOuterSite() || ''
    const currentPageNo = Math.max(1, Number(sharedState.currentPageNo || getListPageNo() || 1))
    const ready = await waitForListReady(LIST_READY_TIMEOUT_MS)
    if (!ready.ready) {
      return scheduleListPageRecovery(sharedState, '店铺流量列表初始加载超时', currentPageNo, currentSite)
    }
    if (ready.busy) return buildBusyReload('prepare_current_site', sharedState)

    const targetGrain = resolveRequestedStatGrain()
    const targetRange = resolveRequestedStatRange(targetGrain)

    if (targetGrain && GRAIN_OPTIONS.includes(targetGrain)) {
      const grainOk = await clickCapsule(targetGrain)
      if (!grainOk) return fail(`统计粒度切换失败：${targetGrain}`)
      const grainReady = await waitForGrainSurfaceReady(targetGrain, 10000)
      if (!grainReady) return fail(`统计粒度切换后页面未稳定：${targetGrain}`)
    }

    if (targetRange.start && targetRange.end) {
      const dateOk = await applyStatDateRange(targetRange.start, targetRange.end, targetGrain)
      if (!dateOk) {
        return fail(`统计日期筛选后列表未按目标区间刷新：${targetRange.start} ~ ${targetRange.end}`)
      }
    }

    return nextPhase(nextPhaseName, 200, {
      ...sharedState,
      ...extraShared,
    })
  }

  async function advanceCursor(sharedState) {
    const ready = await waitForTargetReady(15000)
    if (!ready) return fail('店铺流量页面状态丢失，无法继续翻页')

    const { available, target } = buildTargetOuterSites()
    if (!target.length) return fail(`未找到可抓取的外层站点，可用站点：${available.join(' / ') || '无'}`)

    const currentSite = sharedState.currentOuterSite || getResolvedOuterSite() || target[0]

    if (hasNextListPage()) {
      const oldSig = getListPageSignature()
      const oldPageNo = getListPageNo()
      await sleep(PAGER_THROTTLE_MS)
      if (!clickNextListPage()) {
        return fail('店铺流量列表翻页失败：无法点击下一页')
      }
      const changed = await waitListPageChange(oldSig, oldPageNo, 10000, oldPageNo + 1)
      if (!changed) {
        return scheduleListPageRecovery(sharedState, '店铺流量列表翻页后页码/数据未更新', oldPageNo + 1, currentSite)
      }
      return nextPhase('after_list_page_turn', 200, {
        ...sharedState,
        targetOuterSites: target,
        currentOuterSite: currentSite,
        lastCollectedPageNo: Number(sharedState.currentPageNo || oldPageNo),
      })
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
      if (!location.href.includes('/main/mall-flux-analysis-full')) {
        location.href = TARGET_URL
        return nextPhase('ensure_target', mode === 'new' ? 2000 : 1400)
      }

      const ready = await waitForTargetReady(15000)
      if (!ready) return fail('Temu 店铺流量页面未加载，请确认已登录并能打开「后台-店铺流量」页面')

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
      const switched = await waitForActiveOuterSite(targetSite, 30000)
      if (!switched) {
        return fail(`外层站点切换未生效：期望 ${targetSite || '未知站点'}，当前 ${getResolvedOuterSite() || '未知站点'}`)
      }
      const ready = await waitForTargetReady(15000)
      if (!ready) return fail(`切换外层站点后店铺流量页面未恢复：${targetSite || '未知站点'}`)
      const state = await waitForListReady(LIST_READY_TIMEOUT_MS)
      if (!state.ready) {
        return scheduleListPageRecovery(shared, `切换外层站点后店铺流量列表未加载：${targetSite || '未知站点'}`, 1, targetSite)
      }
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
        currentOuterSite: shared.currentOuterSite || getResolvedOuterSite() || '',
      })
    }

    if (phase === 'recover_list_page') {
      const targetSite = shared.recoverOuterSite || shared.currentOuterSite || getResolvedOuterSite() || ''
      const targetUrl = getOuterSiteUrl(targetSite) || TARGET_URL
      if (location.href !== targetUrl) {
        location.href = targetUrl
        return nextPhase('recover_list_page', mode === 'new' ? 2600 : 2200, shared)
      }

      const switched = await waitForActiveOuterSite(targetSite, 30000)
      if (!switched) {
        return fail(`店铺流量页面恢复失败：未能切回站点 ${targetSite || '未知站点'}`)
      }

      const ready = await waitForTargetReady(30000)
      if (!ready) return fail('店铺流量页面恢复失败：页面未完成加载')

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
      const targetSite = shared.currentOuterSite || getResolvedOuterSite()
      const targetPageNo = Math.max(1, Number(shared.lastCollectedPageNo || shared.currentPageNo || 0) + 1)
      if (!state.ready) return scheduleListPageRecovery(shared, '店铺流量翻页后加载超时', targetPageNo, targetSite)
      if (state.busy) return scheduleListPageRecovery(shared, '店铺流量翻页后出现 Too many visitors', targetPageNo, targetSite)
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
      const data = scrapeCurrentPage(currentOuterSite)
      const more = hasNextListPage() || moreOuterSitesRemain(targetOuterSites, currentOuterSite)
      return complete(data, more, {
        ...shared,
        targetOuterSites,
        currentOuterSite,
        currentPageNo,
        lastCollectedPageNo: currentPageNo,
      })
    }

    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || String(error))
  }
})()
