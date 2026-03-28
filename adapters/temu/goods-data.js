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

  function nextPhase(name, sleepMs = 800, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'next_phase', next_phase: name, sleep_ms: sleepMs, shared: newShared }
    }
  }

  function complete(data, hasMore = false, newShared = shared) {
    return {
      success: true,
      data,
      meta: { action: 'complete', has_more: hasMore, shared: newShared }
    }
  }

  async function waitForTable(timeout = 15000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const n = document.querySelectorAll('tbody tr.TB_tr_5-120-1').length
      const emptyReady =
        !!document.querySelector('.TB_empty_5-120-1') ||
        /共有\s*0\s*条/.test(document.body?.innerText || '')
      if (n > 0 || emptyReady) return n
      await sleep(800)
    }
    return 0
  }

  function openTimeDropdown() {
    const all = document.querySelectorAll('*')
    for (const el of all) {
      if (el.children.length === 0 && el.textContent.trim() === '时间区间') {
        let parent = el.parentElement
        for (let d = 0; d < 6 && parent; d++) {
          const trigger = parent.querySelector('[class*="ST_selector_"],[class*="ST_selector"],[class*="SLT_selector"]')
          if (trigger) { trigger.click(); return true }
          const arr = parent.querySelector('[class*="arrow"],[class*="Arrow"],[class*="suffix"]')
          if (arr) { (arr.parentElement || arr).click(); return true }
          parent = parent.parentElement
        }
      }
    }
    const fb = document.querySelector('[class*="ST_selector_"],[class*="ST_selector"]')
    if (fb) { fb.click(); return true }
    return false
  }

  function clickOption(optionText) {
    const selectors = [
      '[class*="ST_option_"]', '[class*="ST_item_"]', '[class*="SLT_option"]',
      '[class*="Select_option"]', '[role="option"]', 'li[class*="option"]'
    ]
    for (const sel of selectors) {
      for (const opt of document.querySelectorAll(sel)) {
        if (opt.textContent.trim() === optionText) {
          opt.click()
          return true
        }
      }
    }
    return false
  }

  function clickQueryButton() {
    for (const btn of document.querySelectorAll('button')) {
      if (btn.textContent.trim() === '查询') {
        btn.click()
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
      outOfMonth: td.classList.contains('RPR_outOfMonth_5-120-1'),
      disabled: td.classList.contains('RPR_disabled_5-120-1')
    }))
    return { years, months, cells: tds }
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
    for (const ev of ['mouseenter', 'mousedown', 'mouseup', 'click']) {
      w.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true }))
    }
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
    for (const ev of ['mouseenter', 'mousedown', 'mouseup', 'click']) {
      td.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true }))
    }
    await sleep(300)
    return true
  }

  function clickConfirmButton() {
    const scope = getRPRPanel() || document
    for (const btn of scope.querySelectorAll('button')) {
      const t = btn.textContent.trim()
      if (t === '确认' || t === '确定' || t === 'OK') {
        btn.click()
        return true
      }
    }
    return false
  }

  async function setCustomDateRange(startDate, endDate) {
    const s = new Date(startDate)
    const e = new Date(endDate)
    if (isNaN(s) || isNaN(e) || e < s) return false
    if ((e - s) / 86400000 > 31) return false

    if (!openTimeDropdown()) return false
    await sleep(500)
    if (!clickOption('自定义')) return false
    await sleep(800)

    const rprInput = document.querySelector('input.RPR_input_5-120-1')
    if (rprInput) rprInput.click()
    await sleep(1200)

    let state = getCalendarState()
    if (!state) return false

    if (!(s.getFullYear() === state.years[0] && s.getMonth() + 1 === state.months[0])) {
      const ok = await navigatePanelToMonth('left', state.years[0], state.months[0], s.getFullYear(), s.getMonth() + 1)
      if (!ok) return false
      await sleep(400)
    }

    state = getCalendarState()
    if (state && state.years.length > 1) {
      const ry = state.years[1], rm = state.months[1]
      if (!(e.getFullYear() === ry && e.getMonth() + 1 === rm)) {
        const ok = await navigatePanelToMonth('right', ry, rm, e.getFullYear(), e.getMonth() + 1)
        if (!ok) return false
        await sleep(400)
      }
    }

    const okStart = await clickDayInCalendar(s.getFullYear(), s.getMonth() + 1, s.getDate())
    if (!okStart) return false
    await sleep(300)
    const okEnd = await clickDayInCalendar(e.getFullYear(), e.getMonth() + 1, e.getDate())
    if (!okEnd) return false
    await sleep(300)

    return clickConfirmButton()
  }

  function scrapePage() {
    const results = []
    const rows = document.querySelectorAll('tbody tr.TB_tr_5-120-1')
    for (const row of rows) {
      const tds = row.querySelectorAll('td.TB_td_5-120-1:not(.TB_checkCell_5-120-1)')
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
    const rows = document.querySelectorAll('tbody tr.TB_tr_5-120-1')
    if (!rows.length) return ''
    const first = rows[0].innerText.trim().slice(0, 50)
    const last = rows[rows.length - 1].innerText.trim().slice(0, 50)
    return `${first}|||${last}|||${rows.length}`
  }

  function hasNextPage() {
    const next = document.querySelector('.PGT_next_5-120-1')
    return !!(next && !next.classList.contains('PGT_disabled_5-120-1'))
  }

  function clickNextPage() {
    const next = document.querySelector('.PGT_next_5-120-1')
    if (next && !next.classList.contains('PGT_disabled_5-120-1')) {
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

  try {
    if (phase === 'main') {
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
        document.querySelectorAll('tbody tr.TB_tr_5-120-1').length > 0 ||
        !!document.querySelector('.TB_empty_5-120-1')
      if (!ready) return { success: false, error: '页面未加载或未登录，请先打开 Temu 商品数据页面' }
      return nextPhase('prepare_page1', 200)
    }

    if (phase === 'prepare_page1') {
      await waitForTable(15000)
      const ready =
        document.querySelectorAll('tbody tr.TB_tr_5-120-1').length > 0 ||
        !!document.querySelector('.TB_empty_5-120-1')
      if (!ready) return { success: false, error: '页面未加载或未登录，请先打开 Temu 商品数据页面' }

      if (timeRange) {
        if (timeRange === '自定义') {
          const start = customRange.start || ''
          const end = customRange.end || ''
          if (start && end) {
            const ok = await setCustomDateRange(start, end)
            if (!ok) return { success: false, error: '设置自定义日期失败，请检查日期区间或页面状态' }
            await sleep(500)
          }
        } else if (openTimeDropdown()) {
          await sleep(500)
          clickOption(timeRange)
          await sleep(500)
        }
      }

      clickQueryButton()
      await sleep(2500)
      return nextPhase('collect', 200)
    }

    if (phase === 'turn_page') {
      await waitForTable(15000)
      const ready =
        document.querySelectorAll('tbody tr.TB_tr_5-120-1').length > 0 ||
        !!document.querySelector('.TB_empty_5-120-1')
      if (!ready) return { success: false, error: '商品数据列表加载超时' }
      const sig = getPageSignature()
      if (!hasNextPage()) return complete([], false)
      clickNextPage()
      const changed = await waitPageChange(sig, 10000)
      if (!changed) return { success: false, error: '翻页失败，商品数据列表未更新' }
      return nextPhase('collect', 200)
    }

    if (phase === 'collect') {
      const rows = scrapePage()
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
