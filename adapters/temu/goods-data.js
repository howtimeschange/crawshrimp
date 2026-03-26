;(async () => {
  const params   = window.__CRAWSHRIMP_PARAMS__ || {}
  const page     = window.__CRAWSHRIMP_PAGE__ || 1
  const mode     = params.mode || 'current'
  const timeRange = params.time_range || ''
  const customRange = params.custom_range || {}

  const GOODS_URL = 'https://agentseller.temu.com/newon/goods-data'

  // ── 工具函数 ────────────────────────────────────────────────
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

  function cdpClick(selector) {
    const el = document.querySelector(selector)
    if (el) { el.click(); return true }
    return false
  }

  // ── 页面导航（mode=new 时） ──────────────────────────────────
  if (page === 1 && mode === 'new') {
    if (!location.href.includes('agentseller.temu.com/newon/goods-data')) {
      location.href = GOODS_URL
      await sleep(4000)
    }
  }

  // ── 等待表格加载 ─────────────────────────────────────────────
  async function waitForTable(timeout = 15000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const n = document.querySelectorAll('tbody tr.TB_tr_5-120-1').length
      if (n > 0) return n
      await sleep(800)
    }
    return 0
  }

  // ── 时间区间筛选 ─────────────────────────────────────────────
  function openTimeDropdown() {
    // 找「时间区间」label 旁的 select trigger（Beast Select）
    const all = document.querySelectorAll('*')
    for (const el of all) {
      if (el.children.length === 0 && el.textContent.trim() === '时间区间') {
        let parent = el.parentElement
        for (let d = 0; d < 6 && parent; d++) {
          const trigger = parent.querySelector('[class*="ST_selector_"],[class*="ST_selector"],[class*="SLT_selector"]')
          if (trigger) { trigger.click(); return true }
          const arr = parent.querySelector('[class*="arrow"],[class*="Arrow"],[class*="suffix"]')
          if (arr) { arr.parentElement.click(); return true }
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
      '[class*="ST_option_"]','[class*="ST_item_"]','[class*="SLT_option"]',
      '[class*="Select_option"]','[role="option"]','li[class*="option"]'
    ]
    for (const sel of selectors) {
      const opts = document.querySelectorAll(sel)
      for (const opt of opts) {
        if (opt.textContent.trim() === optionText) { opt.click(); return true }
      }
    }
    return false
  }

  function clickQueryButton() {
    const btns = document.querySelectorAll('button')
    for (const btn of btns) {
      if (btn.textContent.trim() === '查询') { btn.click(); return true }
    }
    return false
  }

  // ── 自定义日期：Beast RPR 日历操作 ───────────────────────────
  function getRPRPanel() {
    const panels = document.querySelectorAll('[class*="PP_outerWrapper"]')
    for (const p of panels) {
      if (p.querySelector('[class*="RPR_outerPickerWrapper"]')) return p
    }
    return null
  }

  function getCalendarState() {
    const pp = getRPRPanel()
    if (!pp) return null
    const yearInputs = [...pp.querySelectorAll('input')].filter(i => i.value && i.value.includes('年'))
    const years = yearInputs.map(i => parseInt(i.value))
    const monthSpans = pp.querySelectorAll('[class*="RPR_dateText"]')
    const months = [...monthSpans].map(s => {
      const idx = s.textContent.indexOf('月')
      return idx > 0 ? parseInt(s.textContent.slice(0, idx)) : 0
    }).filter(Boolean)
    const tds = [...pp.querySelectorAll('td[role="date-cell"]')].map((td, idx) => ({
      idx,
      day: parseInt(td.textContent.trim()) || 0,
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
    const w = a.closest('[class*="ICN_outerWrapper"]') || a.parentElement
    for (const ev of ['mouseenter','mousedown','mouseup','click']) {
      w.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true }))
    }
    await sleep(350)
    return true
  }

  async function navigatePanelToMonth(panelSide, curYear, curMonth, tgtYear, tgtMonth) {
    const diff = (tgtYear - curYear) * 12 + (tgtMonth - curMonth)
    if (diff === 0) return
    const dir = diff > 0 ? 'next' : 'prev'
    for (let i = 0; i < Math.abs(diff); i++) {
      await clickCalendarArrow(dir, panelSide)
    }
    await sleep(200)
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
    for (const ev of ['mouseenter','mousedown','mouseup','click']) {
      td.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true }))
    }
    await sleep(300)
    return true
  }

  function clickConfirmButton() {
    const pp = getRPRPanel() || document
    const btns = pp.querySelectorAll('button')
    for (const btn of btns) {
      const t = btn.textContent.trim()
      if (t === '确认' || t === '确定' || t === 'OK') { btn.click(); return true }
    }
    return false
  }

  async function setCustomDateRange(startDate, endDate) {
    const s = new Date(startDate), e = new Date(endDate)
    if (isNaN(s) || isNaN(e) || e < s) return false
    if ((e - s) / 86400000 > 31) return false

    // 选「自定义」
    if (!openTimeDropdown()) return false
    await sleep(500)
    if (!clickOption('自定义')) return false
    await sleep(800)

    // 点 RPR 输入框弹出日历
    const rprInput = document.querySelector('input.RPR_input_5-120-1')
    if (rprInput) rprInput.click()
    await sleep(1200)

    // 获取当前视图，翻月
    let state = getCalendarState()
    if (!state) return false
    const { years, months } = state

    // 左月翻到 start
    if (!(s.getFullYear() === years[0] && s.getMonth() + 1 === months[0])) {
      await navigatePanelToMonth('left', years[0], months[0], s.getFullYear(), s.getMonth() + 1)
      await sleep(400)
    }
    // 右月翻到 end
    state = getCalendarState()
    if (state && state.years.length > 1) {
      const ry = state.years[1], rm = state.months[1]
      if (!(e.getFullYear() === ry && e.getMonth() + 1 === rm)) {
        await navigatePanelToMonth('right', ry, rm, e.getFullYear(), e.getMonth() + 1)
        await sleep(400)
      }
    }

    // 点日期
    const okStart = await clickDayInCalendar(s.getFullYear(), s.getMonth() + 1, s.getDate())
    if (!okStart) return false
    await sleep(400)
    const okEnd = await clickDayInCalendar(e.getFullYear(), e.getMonth() + 1, e.getDate())
    if (!okEnd) return false
    await sleep(400)

    return clickConfirmButton()
  }

  // ── 数据抓取 ─────────────────────────────────────────────────
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
        if (lines[i] === 'SPU：') { spu = lines[i+1] || ''; i++ }
        else if (lines[i] === 'SKC：') { skc = lines[i+1] || ''; i++ }
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
    return next && !next.classList.contains('PGT_disabled_5-120-1')
  }

  function clickNextPage() {
    const next = document.querySelector('.PGT_next_5-120-1')
    if (next && !next.classList.contains('PGT_disabled_5-120-1')) { next.click(); return true }
    return false
  }

  async function waitPageChange(oldSig, timeout = 10000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      await sleep(400)
      const sig = getPageSignature()
      if (sig && sig !== oldSig) { await sleep(200); return true }
    }
    return false
  }

  // ── 第一页：初始化 + 时间筛选 + 抓第1页 ─────────────────────
  if (page === 1) {
    const n = await waitForTable(15000)
    if (n === 0) return { success: false, error: '页面未加载或未登录，请先打开 Temu 运营后台' }

    if (timeRange) {
      if (timeRange === '自定义') {
        const start = customRange.start || ''
        const end   = customRange.end   || ''
        if (start && end) {
          await setCustomDateRange(start, end)
          await sleep(500)
          clickQueryButton()
          await sleep(2500)
        }
      } else {
        // 预设时间
        if (openTimeDropdown()) {
          await sleep(500)
          clickOption(timeRange)
          await sleep(500)
          clickQueryButton()
          await sleep(2500)
        }
      }
    } else {
      clickQueryButton()
      await sleep(2000)
    }
  } else {
    // 第 N 页：直接翻页（由 js_runner 循环调用）
    const sig = getPageSignature()
    if (!hasNextPage()) return { success: true, data: [], meta: { has_more: false } }
    clickNextPage()
    const changed = await waitPageChange(sig, 10000)
    if (!changed) return { success: true, data: [], meta: { has_more: false } }
    await sleep(300)
  }

  const rows = scrapePage()
  const headers = ['商品名称', '商品分类', 'SPU', 'SKC', '国家/地区', '支付件数', '销售趋势']
  const data = rows.map(r => {
    const obj = {}
    headers.forEach((h, i) => { obj[h] = r[i] || '' })
    return obj
  })

  return {
    success: true,
    data,
    meta: { has_more: page === 1 ? hasNextPage() : hasNextPage() }
  }
})()
