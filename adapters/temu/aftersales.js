;(async () => {
  const params  = window.__CRAWSHRIMP_PARAMS__ || {}
  const page    = window.__CRAWSHRIMP_PAGE__ || 1
  const mode    = params.mode || 'current'
  const regions = params.regions || []   // [] = 全部

  const AFTERSALES_URL = 'https://agentseller.temu.com/main/aftersales/information'

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

  // ── 导航 ─────────────────────────────────────────────────────
  if (page === 1 && mode === 'new') {
    if (!location.href.includes('/aftersales')) {
      location.href = AFTERSALES_URL
      await sleep(4000)
    }
  }

  // ── 地区列表 ─────────────────────────────────────────────────
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
        a.click(); return true
      }
    }
    return false
  }

  function getTotal() {
    const el = document.querySelector('.PGT_totalText_5-120-1')
    if (!el) return 0
    const m = el.innerText.match(/\d+/)
    return m ? parseInt(m[0]) : 0
  }

  // ── 当前页数据 ────────────────────────────────────────────────
  function scrapePage() {
    const allRows = [...document.querySelectorAll('tr.TB_tr_5-120-1')]
    const dataRows = allRows.filter(row => row.querySelector('td') !== null)
    return dataRows.map(row => {
      const tds = row.querySelectorAll('td.TB_td_5-120-1')
      return [...tds].map(td => td.innerText.trim())
    })
  }

  function hasNextPage() {
    const next = document.querySelector('li.PGT_next_5-120-1')
    return next && !next.classList.contains('PGT_disabled_5-120-1')
  }

  function clickNextPage() {
    const next = document.querySelector('li.PGT_next_5-120-1')
    if (next && !next.classList.contains('PGT_disabled_5-120-1')) { next.click(); return true }
    return false
  }

  function getFirstCell() {
    const allRows = [...document.querySelectorAll('tr.TB_tr_5-120-1')]
    const dataRows = allRows.filter(r => r.querySelector('td') !== null)
    if (!dataRows.length) return ''
    return dataRows[0].querySelector('td.TB_td_5-120-1')?.innerText.trim() || ''
  }

  async function waitPageChange(oldFirst, timeout = 10000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      await sleep(500)
      const cur = getFirstCell()
      if (cur && cur !== oldFirst) { await sleep(300); return true }
    }
    return false
  }

  // ── 等待表格就绪 ──────────────────────────────────────────────
  async function waitForTable(timeout = 12000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const rows = [...document.querySelectorAll('tr.TB_tr_5-120-1')]
        .filter(r => r.querySelector('td'))
      if (rows.length > 0) return true
      await sleep(700)
    }
    return false
  }

  // ── 当前激活地区 ─────────────────────────────────────────────
  function getActiveRegion() {
    const active = document.querySelector('a.index-module__drItem___3eLtO.index-module__active___2QJPF')
    return active?.innerText.trim() || ''
  }

  // ── 主逻辑：js_runner 每次调用一页 ───────────────────────────
  // 策略：第一次调用（page=1）确定地区顺序 + 切到第一个地区 + 抓第一页
  // 后续：has_more=true 继续当前地区；地区内翻完后切换下个地区（通过 meta 传递状态）
  //
  // 注意：crawshrimp js_runner 是单页循环模式，每次 page++ 重新执行脚本。
  // 为简化实现，每次调用都先确认当前地区+当前页，完整抓取当前页数据。
  // meta.has_more=true 驱动下一次调用。

  // 读取已持久化的抓取状态（通过 window.__CRAWSHRIMP_AFTERSALES_STATE__）
  if (page === 1) {
    window.__CRAWSHRIMP_AFTERSALES_STATE__ = null  // 重置
  }
  let state = window.__CRAWSHRIMP_AFTERSALES_STATE__ || {
    availableRegions: [],
    targetRegions: [],
    regionIdx: 0,
    allData: [],
    initialized: false
  }

  // 第一页初始化
  if (!state.initialized) {
    await waitForTable(12000)
    const available = getAvailableRegions().map(r => r.text)

    // 地区映射
    const REGION_MAP = { '全球': '全球', '美国': '美国', '欧区': '欧区' }
    let target = regions.length > 0
      ? regions.map(r => REGION_MAP[r] || r).filter(r => available.includes(r))
      : available

    if (!target.length) {
      return { success: false, error: '没有可用的地区' }
    }

    // 切到第一个地区
    if (target[0] !== getActiveRegion()) {
      switchRegion(target[0])
      await sleep(2500)
      await waitForTable(10000)
    }

    state.availableRegions = available
    state.targetRegions = target
    state.regionIdx = 0
    state.allData = []
    state.initialized = true
    window.__CRAWSHRIMP_AFTERSALES_STATE__ = state
  }

  // 当前地区
  const curRegion = state.targetRegions[state.regionIdx]
  const total = getTotal()

  // 抓当前页
  const rows = scrapePage()

  const HEADERS = ['序号','单号','货品SKU ID','商品名称','品质分','售后问题处理倍数','消费者售后申请原因','消费者售后申请时间']
  const data = rows.map(r => {
    const obj = { _region: curRegion }
    HEADERS.forEach((h, i) => { obj[h] = r[i] || '' })
    return obj
  })
  state.allData.push(...data)

  // 判断是否还有下一页
  if (hasNextPage()) {
    const first = getFirstCell()
    clickNextPage()
    await waitPageChange(first, 10000)
    await sleep(300)
    window.__CRAWSHRIMP_AFTERSALES_STATE__ = state
    return { success: true, data, meta: { has_more: true } }
  }

  // 当前地区抓完，切换下一地区
  state.regionIdx++
  if (state.regionIdx < state.targetRegions.length) {
    const nextRegion = state.targetRegions[state.regionIdx]
    switchRegion(nextRegion)
    await sleep(2500)
    await waitForTable(12000)
    window.__CRAWSHRIMP_AFTERSALES_STATE__ = state
    return { success: true, data, meta: { has_more: true } }
  }

  // 全部地区抓完
  window.__CRAWSHRIMP_AFTERSALES_STATE__ = null
  return { success: true, data, meta: { has_more: false } }
})()
