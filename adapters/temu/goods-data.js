;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = window.__CRAWSHRIMP_PAGE__ || 1
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const mode = String(params.mode || 'new').trim().toLowerCase()
  const timeRange = String(params.time_range || '').trim()
  const customRange = params.custom_range || {}

  const GOODS_URL = 'https://agentseller.temu.com/newon/goods-data'

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

  const SEEN_ROWS_KEY = '__CRAWSHRIMP_TEMU_GOODS_SEEN__'

  function nextPhase(name, sleepMs = 800, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'next_phase', next_phase: name, sleep_ms: sleepMs, shared: newShared }
    }
  }

  function cdpClicks(clicks, nextPhaseName, sleepMs = 800, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'cdp_clicks', clicks, next_phase: nextPhaseName, sleep_ms: sleepMs, shared: newShared }
    }
  }

  function complete(data, hasMore = false, newShared = shared, extraMeta = {}) {
    return {
      success: true,
      data,
      meta: { action: 'complete', has_more: hasMore, shared: newShared, ...extraMeta }
    }
  }

  function hasClassFragment(el, fragment) {
    return String(el?.className || '').includes(fragment)
  }

  function clickLike(el) {
    if (!el) return false
    try { el.scrollIntoView({ block: 'center', inline: 'center' }) } catch (e) {}
    try { el.focus?.() } catch (e) {}
    try { el.click?.() } catch (e) {}
    const pointerEvents = ['pointerenter', 'pointerdown', 'pointerup']
    for (const ev of pointerEvents) {
      try {
        if (typeof PointerEvent !== 'undefined') {
          el.dispatchEvent(new PointerEvent(ev, { bubbles: true, cancelable: true }))
        }
      } catch (e) {}
    }
    for (const ev of ['mouseenter', 'mousedown', 'mouseup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true }))
      } catch (e) {}
    }
    return true
  }

  function getCenterClick(el, delayMs = 120) {
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      delay_ms: delayMs
    }
  }

  function getSeenRows() {
    if (!window[SEEN_ROWS_KEY] || typeof window[SEEN_ROWS_KEY] !== 'object') {
      window[SEEN_ROWS_KEY] = Object.create(null)
    }
    return window[SEEN_ROWS_KEY]
  }

  function resetSeenRows() {
    window[SEEN_ROWS_KEY] = Object.create(null)
  }

  function makeRowKey(row) {
    return row.map(v => String(v || '').trim()).join('\u001f')
  }

  function dedupeRows(rows) {
    const seen = getSeenRows()
    const result = []
    for (const row of rows) {
      const key = makeRowKey(row)
      if (seen[key]) continue
      seen[key] = 1
      result.push(row)
    }
    return result
  }

  function getTimeRangeRow() {
    return [...document.querySelectorAll('[class*="index-module__row___"]')]
      .find(row => row.querySelector('[class*="index-module__row_label___"]')?.textContent?.trim() === '时间区间') || null
  }

  function getTimeRangeSelect() {
    return getTimeRangeRow()?.querySelector('[class*="ST_outerWrapper_"]') || null
  }

  function getTimeRangeSelectInput() {
    return getTimeRangeSelect()?.querySelector('input[data-testid="beast-core-select-htmlInput"], input') || null
  }

  function getTimeRangeRangeInput() {
    return getRangePickerInputCandidates()[0] ||
      getTimeRangeRow()?.querySelector('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]') ||
      document.querySelector('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]')
  }

  function readTimeRangeValue() {
    return getTimeRangeSelectInput()?.value?.trim() || ''
  }

  function readCustomRangeValue() {
    return getTimeRangeRangeInput()?.value?.trim() || ''
  }

  async function waitForValue(readValue, expected, timeout = 5000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (readValue() === expected) return true
      await sleep(200)
    }
    return false
  }

  function formatDateRangeValue(startDate, endDate) {
    return `${startDate} ~ ${endDate}`
  }

  async function waitForTable(timeout = 15000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const n = document.querySelectorAll('tbody tr[class*="TB_tr_"]').length
      const emptyReady =
        !!document.querySelector('[class*="TB_empty_"]') ||
        /共有\s*0\s*条/.test(document.body?.innerText || '')
      if (n > 0 || emptyReady) return n
      await sleep(800)
    }
    return 0
  }

  function openTimeDropdown() {
    const select = getTimeRangeSelect()
    if (select) {
      const head = select.querySelector('[data-testid="beast-core-select-header"], [class*="ST_head_"]') || select
      clickLike(head)
      return true
    }
    return false
  }

  function clickOption(optionText) {
    const selectors = [
      '[class*="ST_option_"]', '[class*="ST_item_"]', '[class*="cIL_item_"]', '[class*="SLT_option"]',
      '[class*="Select_option"]', '[role="option"]', 'li[class*="option"]'
    ]
    for (const sel of selectors) {
      const options = [...document.querySelectorAll(sel)]
      for (const opt of options) {
        if (opt.textContent.trim() === optionText) {
          clickLike(opt)
          return true
        }
      }
    }
    return false
  }

  function clickQueryButton() {
    for (const btn of document.querySelectorAll('button')) {
      if (btn.textContent.trim() === '查询') {
        clickLike(btn)
        return true
      }
    }
    return false
  }

  function getRPRPanel() {
    for (const p of document.querySelectorAll('[class*="PP_outerWrapper"]')) {
      if (p.querySelector('[class*="RPR_outerPickerWrapper"]')) return p
    }
    return null
  }

  function getRangePickerInputCandidates() {
    const row = getTimeRangeRow()
    const roots = [
      ...(row ? row.querySelectorAll('[data-testid="beast-core-rangePicker-input"], [class*="RPR_inputWrapper_"]') : []),
      ...document.querySelectorAll('[data-testid="beast-core-rangePicker-input"], [class*="RPR_inputWrapper_"]'),
    ]

    const inputs = []
    const seen = new Set()
    const pushInput = input => {
      if (!input || seen.has(input)) return
      seen.add(input)
      inputs.push(input)
    }

    for (const root of roots) {
      const rootInputs = [...root.querySelectorAll('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]')]
      rootInputs.forEach(pushInput)
    }

    const fallbackInputs = [
      ...(row ? row.querySelectorAll('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]') : []),
      ...document.querySelectorAll('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]'),
    ]
    fallbackInputs.forEach(pushInput)
    return inputs
  }

  function getTimeRangeSelectReactProps() {
    const root = getTimeRangeSelect()
    if (!root) return null

    const fiberKey = Object.keys(root).find(k => k.startsWith('__reactFiber')) || ''
    let fiber = fiberKey ? root[fiberKey] : null
    while (fiber) {
      const props = fiber.memoizedProps || null
      if (props && typeof props.onChange === 'function' && Array.isArray(props.options)) {
        return props
      }
      fiber = fiber.return
    }
    return null
  }

  async function injectTimeRangeOption(optionText) {
    const props = getTimeRangeSelectReactProps()
    if (!props || typeof props.onChange !== 'function' || !Array.isArray(props.options)) return false

    const target = props.options.find(opt => String(opt?.label || '').trim() === optionText)
    if (!target) return false

    try {
      props.onChange(target.value)
    } catch (e) {
      return false
    }

    return await waitForValue(readTimeRangeValue, optionText, 3000)
  }

  function getCalendarState() {
    const pp = getRPRPanel()
    if (!pp) return null
    const yearInputs = [...pp.querySelectorAll('input')].filter(i => i.value && i.value.includes('年'))
    const years = yearInputs.map(i => parseInt(i.value, 10)).filter(Boolean)
    const monthSpans = pp.querySelectorAll('[class*="RPR_dateText"]')
    const months = [...monthSpans].map(s => {
      const idx = s.textContent.indexOf('月')
      return idx > 0 ? parseInt(s.textContent.slice(0, idx), 10) : 0
    }).filter(Boolean)
    const tds = [...pp.querySelectorAll('td[role="date-cell"]')].map((td, idx) => ({
      idx,
      day: parseInt(td.textContent.trim(), 10) || 0,
      outOfMonth: hasClassFragment(td, 'RPR_outOfMonth_'),
      disabled: hasClassFragment(td, 'RPR_disabled_')
    }))
    return { years, months, cells: tds }
  }

  function getVisibleCalendarPanel(year, month, state = getCalendarState()) {
    if (!state || !state.years.length || !state.months.length) return null
    const leftYear = state.years[0]
    const leftMonth = state.months[0]
    const rightYear = state.years[1] || leftYear
    const rightMonth = state.months[1] || leftMonth

    if (year === leftYear && month === leftMonth) return 'left'
    if (year === rightYear && month === rightMonth) return 'right'
    return null
  }

  async function clickCalendarArrow(direction, panelSide) {
    const testid = direction === 'next' ? 'beast-core-icon-right' : 'beast-core-icon-left'
    const idx = panelSide === 'left' ? 0 : 1
    const pp = getRPRPanel()
    if (!pp) return false
    const arrows = pp.querySelectorAll(`[data-testid="${testid}"]`)
    const a = arrows[idx]
    if (!a) return false
    const w = a.closest('[class*="ICN_outerWrapper"]') || a.parentElement || a
    clickLike(w)
    await sleep(350)
    return true
  }

  async function navigatePanelToMonth(panelSide, curYear, curMonth, tgtYear, tgtMonth) {
    const diff = (tgtYear - curYear) * 12 + (tgtMonth - curMonth)
    if (diff === 0) return true
    const dir = diff > 0 ? 'next' : 'prev'
    for (let i = 0; i < Math.abs(diff); i++) {
      const ok = await clickCalendarArrow(dir, panelSide)
      if (!ok) return false
    }
    await sleep(200)
    return true
  }

  function openRangePicker() {
    const row = getTimeRangeRow()
    const targets = [
      row?.querySelector('[class*="RPR_inputWrapper_"]'),
      row?.querySelector('[data-testid="beast-core-rangePicker-input"]'),
      row?.querySelector('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]'),
      row?.querySelector('[data-testid="beast-core-icon-calendar"]')?.closest('[class*="ICN_outerWrapper"]'),
    ].filter(Boolean)

    for (const el of targets) {
      clickLike(el)
    }

    return targets.length > 0
  }

  function getRangePickerOpenClick() {
    const row = getTimeRangeRow()
    const input = getTimeRangeRangeInput()
    return getCenterClick(
      input?.closest('[data-testid="beast-core-rangePicker-input"]') ||
      input?.closest('[class*="RPR_inputWrapper_"]') ||
      row?.querySelector('[class*="RPR_inputWrapper_"]') ||
      row?.querySelector('[data-testid="beast-core-rangePicker-input"]') ||
      row?.querySelector('[data-testid="beast-core-icon-calendar"]')?.closest('[class*="ICN_outerWrapper"]') ||
      input ||
      row?.querySelector('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]')
    )
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

  function getRangePickerReactProps() {
    const candidates = getRangePickerInputCandidates()
    for (const input of candidates) {
      const props = getRangePickerReactPropsFromInput(input)
      if (props) return props
    }
    return null
  }

  async function waitForRangePickerReactProps(timeout = 4000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const props = getRangePickerReactProps()
      if (props) return props
      await sleep(200)
    }
    return null
  }

  async function injectCustomDateRange(startDate, endDate, timeout = 4000) {
    const props = await waitForRangePickerReactProps(timeout)
    if (!props || typeof props.onChange !== 'function') return false

    const start = new Date(`${startDate}T00:00:00`)
    const end = new Date(`${endDate}T00:00:00`)
    if (isNaN(start) || isNaN(end)) return false

    const expectedRange = formatDateRangeValue(startDate, endDate)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        props.onChange([start, end])
      } catch (e) {
        return false
      }

      if (await waitForValue(readCustomRangeValue, expectedRange, 2000)) return true
      await sleep(250)
    }

    return false
  }

  async function clickDayInCalendar(year, month, day) {
    const state = getCalendarState()
    if (!state) return false
    const { years, months, cells } = state
    if (!years.length || !months.length) return false

    const leftYear = years[0], leftMonth = months[0]
    const rightYear = years[1] || leftYear, rightMonth = months[1] || leftMonth

    let panelIdx = -1
    if (year === leftYear && month === leftMonth) panelIdx = 0
    else if (year === rightYear && month === rightMonth) panelIdx = 1
    else return false

    const panelCells = cells.slice(panelIdx * 42, (panelIdx + 1) * 42)
    const target = panelCells.find(c => c.day === day && !c.outOfMonth && !c.disabled)
    if (!target) return false

    const pp = getRPRPanel()
    if (!pp) return false
    const tds = pp.querySelectorAll('td[role="date-cell"]')
    const td = tds[target.idx]
    if (!td) return false
    clickLike(td)
    await sleep(300)
    return true
  }

  function clickConfirmButton() {
    const scope = getRPRPanel() || document
    for (const btn of scope.querySelectorAll('button')) {
      const t = btn.textContent.trim()
      if (t === '确认' || t === '确定' || t === 'OK') {
        clickLike(btn)
        return true
      }
    }
    return false
  }

  async function ensureCustomRangePanel(startDate, endDate) {
    if (readTimeRangeValue() !== '自定义') {
      const injectedSelect = await injectTimeRangeOption('自定义')
      if (!injectedSelect) {
        if (!openTimeDropdown()) return { success: false, error: '无法打开时间区间下拉框' }
        await sleep(500)
        if (!clickOption('自定义')) return { success: false, error: '无法选择自定义日期' }
        const selectReady = await waitForValue(readTimeRangeValue, '自定义', 3000)
        if (!selectReady) return { success: false, error: '自定义时间区间未生效' }
        await sleep(600)
      }
    }

    const injected = await injectCustomDateRange(startDate, endDate)
    if (injected) {
      return nextPhase('run_query', 500, {
        ...shared,
        customRange: { start: startDate, end: endDate },
      })
    }

    if (getRPRPanel()) {
      return nextPhase('apply_custom_range', 0, {
        ...shared,
        customRange: { start: startDate, end: endDate },
        customRangeOpenAttempts: shared.customRangeOpenAttempts || 0,
      })
    }

    if (openRangePicker()) {
      await sleep(1200)
      if (getRPRPanel()) {
        return nextPhase('apply_custom_range', 0, {
          ...shared,
          customRange: { start: startDate, end: endDate },
          customRangeOpenAttempts: shared.customRangeOpenAttempts || 0,
        })
      }
    }

    const click = getRangePickerOpenClick()
    if (!click) return { success: false, error: '无法定位自定义日期输入框，请检查页面状态' }

    return cdpClicks([click], 'apply_custom_range', 900, {
      ...shared,
      customRange: { start: startDate, end: endDate },
      customRangeOpenAttempts: (shared.customRangeOpenAttempts || 0) + 1,
    })
  }

  async function applyCustomDateRange(startDate, endDate) {
    const s = new Date(startDate)
    const e = new Date(endDate)
    if (isNaN(s) || isNaN(e) || e < s) return false
    if ((e - s) / 86400000 > 31) return false
    const expectedRange = formatDateRangeValue(startDate, endDate)
    if (readCustomRangeValue() === expectedRange) return true

    let state = getCalendarState()
    if (!state) return false

    if (!getVisibleCalendarPanel(s.getFullYear(), s.getMonth() + 1, state)) {
      const ok = await navigatePanelToMonth('left', state.years[0], state.months[0], s.getFullYear(), s.getMonth() + 1)
      if (!ok) return false
      await sleep(400)
    }

    state = getCalendarState()
    if (!state) return false

    if (!getVisibleCalendarPanel(e.getFullYear(), e.getMonth() + 1, state)) {
      const ry = state.years[1] || state.years[0]
      const rm = state.months[1] || state.months[0]
      const ok = await navigatePanelToMonth('right', ry, rm, e.getFullYear(), e.getMonth() + 1)
      if (!ok) return false
      await sleep(400)
    }

    const okStart = await clickDayInCalendar(s.getFullYear(), s.getMonth() + 1, s.getDate())
    if (!okStart) return false
    await sleep(300)
    if (readCustomRangeValue() === expectedRange) return true

    state = getCalendarState()
    if (!state) return readCustomRangeValue() === expectedRange
    if (!getVisibleCalendarPanel(e.getFullYear(), e.getMonth() + 1, state)) return false

    const okEnd = await clickDayInCalendar(e.getFullYear(), e.getMonth() + 1, e.getDate())
    if (!okEnd) return false
    await sleep(300)
    if (readCustomRangeValue() === expectedRange) return true

    if (!clickConfirmButton()) return readCustomRangeValue() === expectedRange

    return await waitForValue(readCustomRangeValue, expectedRange, 5000)
  }

  function scrapePage() {
    const results = []
    const rows = document.querySelectorAll('tbody tr[class*="TB_tr_"]')
    for (const row of rows) {
      const tds = [...row.querySelectorAll('td[class*="TB_td_"]')]
        .filter(td => !hasClassFragment(td, 'TB_checkCell_'))
      if (tds.length < 3) continue
      const infoText = tds[0].innerText.trim()
      const lines = infoText.split('\n').map(s => s.trim()).filter(Boolean)
      let goodsName = '', category = '', spu = '', skc = ''
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] === 'SPU：') { spu = lines[i + 1] || ''; i++ }
        else if (lines[i] === 'SKC：') { skc = lines[i + 1] || ''; i++ }
        else if (!goodsName) goodsName = lines[i]
        else if (!category) category = lines[i]
      }
      const country = tds[1]?.innerText.trim() || ''
      const payText = tds[2]?.innerText.trim() || ''
      const payLines = payText.split('\n').map(s => s.trim()).filter(Boolean)
      const payCount = payLines[0] || ''
      const trend = payLines[1] || ''
      if (goodsName || spu) results.push([goodsName, category, spu, skc, country, payCount, trend])
    }
    return results
  }

  function getPageSignature() {
    const rows = document.querySelectorAll('tbody tr[class*="TB_tr_"]')
    if (!rows.length) return ''
    const first = rows[0].innerText.trim().slice(0, 50)
    const last = rows[rows.length - 1].innerText.trim().slice(0, 50)
    return `${first}|||${last}|||${rows.length}`
  }

  function getActivePage() {
    const active =
      document.querySelector('li[class*="PGT_pagerItemActive_"]') ||
      document.querySelector('li[aria-current="page"]')
    const value = parseInt(active?.textContent?.trim() || '', 10)
    return Number.isFinite(value) ? value : 1
  }

  function hasNextPage() {
    const next = document.querySelector('[class*="PGT_next_"]')
    return !!(next && !hasClassFragment(next, 'PGT_disabled_'))
  }

  function clickNextPage() {
    const next = document.querySelector('[class*="PGT_next_"]')
    if (next && !hasClassFragment(next, 'PGT_disabled_')) {
      next.click()
      return true
    }
    return false
  }

  async function waitPageChange(oldSig, timeout = 10000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      await sleep(400)
      const sig = getPageSignature()
      if (sig && sig !== oldSig) {
        await sleep(200)
        return true
      }
    }
    return false
  }

  async function waitPageAdvance(oldPage, timeout = 10000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      await sleep(300)
      const currentPage = getActivePage()
      if (currentPage === oldPage + 1) return { ok: true, currentPage }
      if (currentPage > oldPage + 1) return { ok: false, jumped: true, currentPage }
    }
    return { ok: false, currentPage: getActivePage() }
  }

  try {
    if (phase === 'main') {
      if (page === 1) resetSeenRows()
      if (page === 1) return nextPhase('ensure_target', 0)
      return nextPhase('turn_page', 0)
    }

    if (phase === 'ensure_target') {
      if (!location.href.includes('/newon/goods-data')) {
        location.href = GOODS_URL
        return nextPhase('ensure_target', mode === 'new' ? 1800 : 1200)
      }
      await waitForTable(15000)
      const ready =
        document.querySelectorAll('tbody tr[class*="TB_tr_"]').length > 0 ||
        !!document.querySelector('[class*="TB_empty_"]')
      if (!ready) return { success: false, error: '页面未加载或未登录，请先打开 Temu 商品数据页面' }
      return nextPhase('prepare_page1', 200)
    }

    if (phase === 'prepare_page1') {
      await waitForTable(15000)
      const ready =
        document.querySelectorAll('tbody tr[class*="TB_tr_"]').length > 0 ||
        !!document.querySelector('[class*="TB_empty_"]')
      if (!ready) return { success: false, error: '页面未加载或未登录，请先打开 Temu 商品数据页面' }

      if (timeRange) {
        if (timeRange === '自定义') {
          const start = customRange.start || ''
          const end = customRange.end || ''
          if (!start || !end) return { success: false, error: '请选择完整的自定义日期范围' }
          return await ensureCustomRangePanel(start, end)
        } else {
          const injectedSelect = await injectTimeRangeOption(timeRange)
          if (injectedSelect) return nextPhase('run_query', 500)
          if (openTimeDropdown()) {
            await sleep(500)
            if (!clickOption(timeRange)) return { success: false, error: `选择时间区间失败：${timeRange}` }
            const selected = await waitForValue(readTimeRangeValue, timeRange, 3000)
            if (!selected) return { success: false, error: `时间区间未生效：${timeRange}` }
            return nextPhase('run_query', 500)
          }
          return { success: false, error: '无法打开时间区间下拉框' }
        }
      }

      return nextPhase('run_query', 0)
    }

    if (phase === 'apply_custom_range') {
      const start = shared.customRange?.start || customRange.start || ''
      const end = shared.customRange?.end || customRange.end || ''
      if (!start || !end) return { success: false, error: '缺少自定义日期范围参数' }

      const injected = await injectCustomDateRange(start, end, 6000)
      if (injected) return nextPhase('run_query', 500, shared)

      if (!getRPRPanel()) {
        const attempts = shared.customRangeOpenAttempts || 0
        if (attempts >= 2) {
          return { success: false, error: '设置自定义日期失败：日期选择框未成功打开' }
        }
        const click = getRangePickerOpenClick()
        if (!click) return { success: false, error: '设置自定义日期失败：无法定位日期输入框' }
        return cdpClicks([click], 'apply_custom_range', 900, {
          ...shared,
          customRange: { start, end },
          customRangeOpenAttempts: attempts + 1,
        })
      }

      const reinjected = await injectCustomDateRange(start, end, 8000)
      if (reinjected) return nextPhase('run_query', 500, shared)

      const ok = await applyCustomDateRange(start, end)
      if (!ok) {
        const repaired = await injectCustomDateRange(start, end, 8000)
        if (!repaired) return { success: false, error: '设置自定义日期失败，请检查日期区间或页面状态' }
      }
      return nextPhase('run_query', 500)
    }

    if (phase === 'run_query') {
      clickQueryButton()
      await sleep(2500)
      return nextPhase('collect', 200)
    }

    if (phase === 'turn_page') {
      await waitForTable(15000)
      const ready =
        document.querySelectorAll('tbody tr[class*="TB_tr_"]').length > 0 ||
        !!document.querySelector('[class*="TB_empty_"]')
      if (!ready) return { success: false, error: '商品数据列表加载超时' }
      const oldPage = getActivePage()
      const sig = getPageSignature()
      if (!hasNextPage()) return complete([], false)
      clickNextPage()
      const pageAdvanced = await waitPageAdvance(oldPage, 10000)
      if (!pageAdvanced.ok) {
        if (pageAdvanced.jumped) {
          return { success: false, error: `翻页异常，页码从 ${oldPage} 跳到了 ${pageAdvanced.currentPage}` }
        }
        return { success: false, error: `翻页失败，页码未从 ${oldPage} 前进到 ${oldPage + 1}` }
      }
      const changed = await waitPageChange(sig, 10000)
      if (!changed) return { success: false, error: '翻页失败，商品数据列表未更新' }
      return nextPhase('collect', 200)
    }

    if (phase === 'collect') {
      const rows = dedupeRows(scrapePage())
      const headers = ['商品名称', '商品分类', 'SPU', 'SKC', '国家/地区', '支付件数', '销售趋势']
      const data = rows.map(r => {
        const obj = {}
        headers.forEach((h, i) => { obj[h] = r[i] || '' })
        return obj
      })
      return complete(data, hasNextPage())
    }

    return { success: false, error: `未知 phase: ${phase}` }
  } catch (e) {
    return { success: false, error: e.message }
  }
})()
