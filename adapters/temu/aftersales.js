;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = window.__CRAWSHRIMP_PAGE__ || 1
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const mode = String(params.mode || 'new').trim().toLowerCase()
  const regions = Array.isArray(params.regions) ? params.regions : []

  const AFTERSALES_URL = 'https://agentseller.temu.com/main/aftersales/information'

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

  function getAvailableRegions() {
    const items = document.querySelectorAll('a.index-module__drItem___3eLtO')
    return [...items]
      .filter(a => !a.classList.contains('index-module__disabled___3n06o'))
      .map(a => ({ text: a.innerText.trim(), active: a.classList.contains('index-module__active___2QJPF') }))
  }

  function switchRegion(regionText) {
    const items = document.querySelectorAll('a.index-module__drItem___3eLtO')
    for (const a of items) {
      if (a.innerText.trim() === regionText && !a.classList.contains('index-module__disabled___3n06o')) {
        a.click()
        return true
      }
    }
    return false
  }

  function scrapePage(regionText) {
    const allRows = [...document.querySelectorAll('tr.TB_tr_5-120-1')]
    const dataRows = allRows.filter(row => row.querySelector('td') !== null)
    const headers = ['序号', '单号', '货品SKU ID', '商品名称', '品质分', '售后问题处理倍数', '消费者售后申请原因', '消费者售后申请时间']
    return dataRows.map(row => {
      const tds = row.querySelectorAll('td.TB_td_5-120-1')
      const obj = { 地区: regionText }
      headers.forEach((h, i) => { obj[h] = tds[i]?.innerText.trim() || '' })
      return obj
    })
  }

  function hasNextPage() {
    const next = document.querySelector('li.PGT_next_5-120-1')
    return !!(next && !next.classList.contains('PGT_disabled_5-120-1'))
  }

  function clickNextPage() {
    const next = document.querySelector('li.PGT_next_5-120-1')
    if (next && !next.classList.contains('PGT_disabled_5-120-1')) {
      next.click()
      return true
    }
    return false
  }

  function clickPrevPage() {
    const prev = document.querySelector('li.PGT_prev_5-120-1')
    if (prev && !prev.classList.contains('PGT_disabled_5-120-1')) {
      prev.click()
      return true
    }
    return false
  }

  function getActivePage() {
    const active = document.querySelector('li.PGT_pagerItemActive_5-120-1')
    const value = parseInt(active?.innerText.trim() || '', 10)
    return Number.isFinite(value) ? value : 1
  }

  function getPageSignature() {
    const allRows = [...document.querySelectorAll('tr.TB_tr_5-120-1')]
    const dataRows = allRows.filter(r => r.querySelector('td') !== null)
    if (!dataRows.length) return `page:${getActivePage()}::empty`
    const first = dataRows[0].innerText.trim().slice(0, 80)
    const last = dataRows[dataRows.length - 1].innerText.trim().slice(0, 80)
    return `page:${getActivePage()}::${dataRows.length}::${first}::${last}`
  }

  async function waitPageChange(oldSig, timeout = 10000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      await sleep(500)
      const cur = getPageSignature()
      if (cur && cur !== oldSig) {
        await sleep(300)
        return true
      }
    }
    return false
  }

  async function waitForTable(timeout = 12000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const rows = [...document.querySelectorAll('tr.TB_tr_5-120-1')].filter(r => r.querySelector('td'))
      if (rows.length > 0) return true
      await sleep(700)
    }
    return false
  }

  function getActiveRegion() {
    const active = document.querySelector('a.index-module__drItem___3eLtO.index-module__active___2QJPF')
    return active?.innerText.trim() || ''
  }

  function buildTargetRegions() {
    const available = getAvailableRegions().map(r => r.text)
    const regionMap = { '全球': '全球', '美国': '美国', '欧区': '欧区' }
    const target = regions.length > 0
      ? regions.map(r => regionMap[r] || r).filter(r => available.includes(r))
      : available
    return { available, target }
  }

  async function ensureFirstPage(timeout = 12000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (getActivePage() <= 1) return true
      const oldSig = getPageSignature()
      if (!clickPrevPage()) return false
      const changed = await waitPageChange(oldSig, 10000)
      if (!changed) return false
      await waitForTable(10000)
    }
    return getActivePage() <= 1
  }

  try {
    if (phase === 'main') {
      if (page === 1) {
        return nextPhase('ensure_target', 0)
      }
      return nextPhase('advance_cursor', 0)
    }

    if (phase === 'ensure_target') {
      if (location.href.includes('/main/authentication')) {
        return { success: false, error: '当前 Temu 账号被重定向到认证页，暂无售后数据访问权限' }
      }
      if (!location.href.includes('/aftersales')) {
        location.href = AFTERSALES_URL
        return nextPhase('ensure_target', mode === 'new' ? 1800 : 1200)
      }
      const ok = await waitForTable(12000)
      if (!ok) return { success: false, error: 'Temu 售后页面未加载，请确认已登录并能打开售后列表' }
      return nextPhase('prepare_page1', 200)
    }

    if (phase === 'prepare_page1') {
      const ok = await waitForTable(12000)
      if (!ok) return { success: false, error: 'Temu 售后列表加载超时' }

      const { available, target } = buildTargetRegions()
      if (!target.length) return { success: false, error: '没有可用的地区可供抓取' }

      if (target[0] !== getActiveRegion()) {
        switchRegion(target[0])
        await sleep(2500)
        await waitForTable(10000)
      }

      const pageResetOk = await ensureFirstPage(12000)
      if (!pageResetOk) return { success: false, error: '售后列表无法回到第一页' }

      return nextPhase('collect', 200, {
        availableRegions: available,
        targetRegions: target,
        regionIdx: 0,
        initialized: true
      })
    }

    if (phase === 'advance_cursor') {
      const state = shared
      if (!state || !state.initialized) return { success: false, error: '售后抓取状态丢失，请重新运行任务' }

      const ok = await waitForTable(12000)
      if (!ok) return { success: false, error: 'Temu 售后列表加载超时' }

      if (hasNextPage()) {
        const sig = getPageSignature()
        clickNextPage()
        const changed = await waitPageChange(sig, 10000)
        if (!changed) return { success: false, error: '售后列表翻页失败' }
        return nextPhase('collect', 200, state)
      }

      const nextState = {
        ...state,
        regionIdx: (state.regionIdx || 0) + 1,
      }
      if (nextState.regionIdx >= nextState.targetRegions.length) {
        return complete([], false)
      }

      const nextRegion = nextState.targetRegions[nextState.regionIdx]
      const switched = switchRegion(nextRegion)
      if (!switched) return { success: false, error: `切换售后地区失败：${nextRegion}` }
      await sleep(2500)
      const tableOk = await waitForTable(12000)
      if (!tableOk) return { success: false, error: `切换地区后列表未加载：${nextRegion}` }
      const pageResetOk = await ensureFirstPage(12000)
      if (!pageResetOk) return { success: false, error: `切换地区后无法回到第一页：${nextRegion}` }
      return nextPhase('collect', 200, nextState)
    }

    if (phase === 'collect') {
      const state = shared
      if (!state || !state.initialized) return { success: false, error: '售后抓取状态丢失，请重新运行任务' }
      const curRegion = state.targetRegions[state.regionIdx]
      const data = scrapePage(curRegion)
      const more = hasNextPage() || (state.regionIdx + 1 < state.targetRegions.length)
      return complete(data, more, state)
    }

    return { success: false, error: `未知 phase: ${phase}` }
  } catch (e) {
    return { success: false, error: e.message }
  }
})()
