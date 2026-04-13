;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = window.__CRAWSHRIMP_PAGE__ || 1
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const TARGET_URL = 'https://agentseller.temu.com/main/flux-analysis-full'
  const LIST_BUSY_RETRY_LIMIT = 30
  const LIST_PAGE_RECOVERY_LIMIT = 30
  const SAFE_PAGE_LOOP_LIMIT = 120
  const PAGER_THROTTLE_MS = 2200

  const mode = String(params.mode || 'current').trim().toLowerCase()
  const outerSitesParam = normalizeArray(params.outer_sites)
  const listTimeRange = String(params.list_time_range || '').trim()
  const quickFilter = String(params.quick_filter || '全部').trim() || '全部'
  const productIdType = String(params.product_id_type || 'SPU').trim() || 'SPU'
  const productIdQuery = String(params.product_id_query || '').trim()
  const goodsNoType = String(params.goods_no_type || 'SKC货号').trim() || 'SKC货号'
  const goodsNoQuery = String(params.goods_no_query || '').trim()
  const categoryPath = String(params.category_path || '').trim()
  const productName = String(params.product_name || '').trim()

  const OUTER_SITE_BLACKLIST = new Set(['商家中心'])
  const QUICK_FILTER_OPTIONS = ['流量待增长', '短期增长中', '长期增长中']
  const LIST_METRIC_COLUMN_KEYS = [
    '流量情况/曝光量',
    '流量情况/点击量',
    '流量情况/访客数',
    '流量情况/浏览量',
    '流量情况/加购人数',
    '流量情况/收藏人数',
    '流量情况/支付件数',
    '支付情况/支付订单数',
    '支付情况/买家数',
    '转化情况/转化率',
    '转化情况/点击率',
    '转化情况/点击后支付率',
    '搜索数据/曝光量',
    '搜索数据/点击量',
    '搜索数据/支付订单数',
    '搜索数据/支付件数',
    '推荐数据/曝光量',
    '推荐数据/点击量',
    '推荐数据/支付订单数',
    '推荐数据/支付件数',
    '增长潜力',
    '操作',
  ]

  function normalizeArray(value) {
    if (!Array.isArray(value)) return []
    return value.map(item => String(item || '').trim()).filter(Boolean)
  }

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

  function nextPhase(name, sleepMs = 1200, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'next_phase', next_phase: name, sleep_ms: sleepMs, shared: newShared },
    }
  }

  function cdpClicks(clicks, nextPhaseName, sleepMs = 1200, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'cdp_clicks', clicks, next_phase: nextPhaseName, sleep_ms: sleepMs, shared: newShared },
    }
  }

  function reloadPage(nextPhaseName, sleepMs = 2000, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'reload_page', next_phase: nextPhaseName, sleep_ms: sleepMs, shared: newShared },
    }
  }

  function complete(data, hasMore = false, newShared = shared) {
    return {
      success: true,
      data,
      meta: { action: 'complete', has_more: hasMore, shared: newShared },
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

  async function waitFor(condition, timeout = 8000, interval = 300) {
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

  function findMainButton(text) {
    return [...document.querySelectorAll('button')]
      .filter(isVisible)
      .find(btn => !isInsideVisibleDrawer(btn) && textOf(btn) === text) || null
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
    const available = getAvailableOuterSites().map(item => item.text)
    const requested = outerSitesParam.length ? outerSitesParam.filter(item => available.includes(item)) : available
    return { available, target: [...new Set(requested)] }
  }

  function getOuterSiteClick(siteLabel) {
    const node = getOuterSiteNodes().find(item =>
      textOf(item) === siteLabel &&
      !hasClassFragment(item, 'index-module__disabled___'),
    )
    return getCenterClick(node)
  }

  async function waitForTargetReady(timeout = 15000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const hasSites = getAvailableOuterSites().length > 0
      const hasProductSection = /商品明细/.test(textOf(document.body))
      const hasQuery = !!findMainButton('查询')
      if (hasSites && hasProductSection && hasQuery) return true
      await sleep(600)
    }
    return false
  }

  async function ensureProductTrafficSection() {
    if (/商品明细/.test(textOf(document.body))) return true
    const bodyReady = await waitFor(() => /商品明细/.test(textOf(document.body)), 3000, 400)
    if (bodyReady) return true
    const tab = [...document.querySelectorAll('button, a, div, span')]
      .filter(isVisible)
      .find(el => !isInsideVisibleDrawer(el) && compact(textOf(el)) === compact('商品流量'))
    if (!tab) return false
    clickLike(tab)
    return await waitFor(() => /商品明细/.test(textOf(document.body)), 5000, 400)
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
        score: countTableBodyRows(table) + (/查看详情/.test(textOf(table)) ? 1000 : 0),
      }))
      .filter(item => item.rowCount > 0 || /查看详情/.test(textOf(item.table)))
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
        const aScore = a.headerCount + (/商品信息|流量情况|增长潜力|操作/.test(a.text) ? 1000 : 0)
        const bScore = b.headerCount + (/商品信息|流量情况|增长潜力|操作/.test(b.text) ? 1000 : 0)
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

  function hasNextListPage() {
    const next = getMainPagerRoot().querySelector('li[class*="PGT_next_"]')
    return !!(next && !hasClassFragment(next, 'PGT_disabled_'))
  }

  function hasPrevListPage() {
    const prev = getMainPagerRoot().querySelector('li[class*="PGT_prev_"]')
    return !!(prev && !hasClassFragment(prev, 'PGT_disabled_'))
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

  function getListPageSignature() {
    const rows = getMainListRows()
    if (!rows.length) {
      return `list:empty:${compact(textOf(getMainListTable() || getMainListHeaderTable())).slice(0, 120)}`
    }
    const first = compact(textOf(rows[0])).slice(0, 120)
    const last = compact(textOf(rows[rows.length - 1])).slice(0, 120)
    return `list:${rows.length}:${first}:${last}`
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
      await sleep(700)
    }
    return {
      ready: false,
      rows: getMainListRows(),
      empty: !!document.querySelector('[class*="TB_empty_"]'),
      busy: hasBusyWarning(),
    }
  }

  async function waitListPageChange(oldSignature, oldPageNo = 0, timeout = 10000) {
    return await waitFor(() => {
      if (oldPageNo > 0 && getListPageNo() !== oldPageNo) return true
      return getListPageSignature() !== oldSignature
    }, timeout, 700)
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
      await sleep(PAGER_THROTTLE_MS)
      const moved = current < targetPage ? clickNextListPage() : clickPrevListPage()
      if (!moved) return false
      const changed = await waitListPageChange(oldSig, oldPageNo, 10000)
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
    const candidates = [...document.querySelectorAll('div, label, span')]
      .filter(isVisible)
      .filter(el => textOf(el) === labelText)
    for (const label of candidates) {
      let cursor = label
      for (let depth = 0; depth < 4 && cursor; depth += 1) {
        if (cursor.querySelector?.('input, [class*="ST_outerWrapper_"], [class*="CSD_cascaderWrapper_"]')) {
          return cursor
        }
        cursor = cursor.parentElement
      }
    }
    return null
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
    await sleep(600)
    if (!clickOption(optionLabel)) {
      clickLike(document.body)
      return false
    }
    return await waitFor(() => String(input?.value || '').trim() === optionLabel, 4000, 400)
  }

  function getMainTextInputByLabel(labelText) {
    const container = getLabeledContainer(labelText)
    if (!container) return null
    return [...container.querySelectorAll('input')].find(input => {
      const testId = String(input.getAttribute('data-testid') || '')
      return testId !== 'beast-core-select-htmlInput' && testId !== 'beast-core-cascader-htmlInput'
    }) || null
  }

  async function setMainTextInput(labelText, value) {
    const input = getMainTextInputByLabel(labelText)
    if (!input) return false
    return setNativeInputValue(input, value)
  }

  async function setCategoryPath(pathText) {
    if (!pathText) return true
    const input = document.querySelector('input[data-testid="beast-core-cascader-htmlInput"]')
    if (!input || isInsideVisibleDrawer(input)) return false
    clickLike(input)
    await sleep(500)
    const segments = String(pathText)
      .split(/>|\/|｜|\|/g)
      .map(item => item.trim())
      .filter(Boolean)
    if (!segments.length) return false
    for (const segment of segments) {
      const items = [...document.querySelectorAll('[class*="CSD_menuItem_"]')].filter(isVisible)
      const node = items.find(item => textOf(item) === segment)
      if (!node) {
        clickLike(document.body)
        return false
      }
      clickLike(node)
      await sleep(700)
    }
    clickLike(document.body)
    await sleep(300)
    return true
  }

  async function clickCapsule(label) {
    const capsule = [...document.querySelectorAll('[class*="TAB_capsule_"]')]
      .filter(isVisible)
      .find(el => !isInsideVisibleDrawer(el) && textOf(el) === label)
    if (!capsule) return false
    if (hasClassFragment(capsule, 'TAB_active_')) return true
    clickLike(capsule)
    await sleep(800)
    return true
  }

  function findQuickFilterCard(label) {
    const root = [...document.querySelectorAll('div, section')]
      .filter(isVisible)
      .find(el => /快速筛选/.test(textOf(el)) && QUICK_FILTER_OPTIONS.some(option => compact(textOf(el)).includes(compact(option))))
    if (!root) return null
    return [...root.querySelectorAll('div, button')]
      .filter(isVisible)
      .find(el => compact(textOf(el)).startsWith(compact(label))) || null
  }

  async function clickQuickFilter(label) {
    if (!label || label === '全部') return true
    const card = findQuickFilterCard(label)
    if (!card) return false
    clickLike(card)
    await sleep(1600)
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

  function extractBackgroundImageUrl(value) {
    const matched = String(value || '').match(/url\((['"]?)(.*?)\1\)/i)
    return matched?.[2] || ''
  }

  function parseProductInfoCell(cell) {
    if (!cell) return {}
    const rawText = textOf(cell)
    const imageNode = cell.querySelector('[class*="index-module__img___"]')
    const styleValue = String(imageNode?.style?.backgroundImage || imageNode?.getAttribute('style') || '')
    const spuMatch = rawText.match(/SPU[:：]?\s*([0-9]+)/i)
    return {
      商品名称: textOf(cell.querySelector('[class*="hooks_goodsName__"]')) || rawText.split('SPU')[0].trim(),
      商品分类: textOf(cell.querySelector('[class*="hooks_category__"]')),
      SPU: textOf(cell.querySelector('[class*="hooks_spuId__"]')).replace(/^SPU[:：]?\s*/i, '') || spuMatch?.[1] || '',
      商品图片: extractBackgroundImageUrl(styleValue),
      商品信息: rawText,
    }
  }

  function getProductInfoCellIndex(cells) {
    const byContent = cells.findIndex(cell => {
      const rawText = textOf(cell)
      return (
        /SPU[:：]?\s*[0-9]+/i.test(rawText) ||
        !!cell.querySelector('[class*="index-module__img___"]') ||
        !!cell.querySelector('[class*="hooks_goodsName__"]')
      )
    })
    if (byContent >= 0) return byContent
    return cells.length > LIST_METRIC_COLUMN_KEYS.length ? cells.length - LIST_METRIC_COLUMN_KEYS.length - 1 : 0
  }

  function mapCellsToColumnKeys(cells, columnKeys) {
    const mapped = {}
    columnKeys.forEach((columnKey, index) => {
      mapped[columnKey] = textOf(cells[index])
    })
    return mapped
  }

  function scrapeCurrentPage(currentOuterSite) {
    const rows = getMainListRows()
    return rows.map((row, index) => {
      const cells = [...row.querySelectorAll('td')]
      const productInfoCellIndex = getProductInfoCellIndex(cells)
      const productInfo = parseProductInfoCell(cells[productInfoCellIndex] || cells[1] || cells[0])
      const metricCells = cells.slice(productInfoCellIndex + 1)
      const data = {
        外层站点: currentOuterSite,
        列表页码: getListPageNo(),
        抓取时间: localNow(),
        列表时间范围: listTimeRange || '当前页面',
        快速筛选: quickFilter || '全部',
        列表行号: index + 1,
        ...productInfo,
        ...mapCellsToColumnKeys(metricCells, LIST_METRIC_COLUMN_KEYS),
      }
      return data
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

  function buildBusyReload(nextPhaseName, sharedState) {
    const retry = Number(sharedState.listBusyRetry || 0)
    const currentPageNo = Math.max(1, Number(sharedState.lastCollectedPageNo || getListPageNo() || 1))
    const currentSite = sharedState.targetOuterSite || sharedState.currentOuterSite || getActiveOuterSite() || ''
    if (retry >= LIST_BUSY_RETRY_LIMIT) {
      return fail('Temu 商品流量列表连续出现 “Too many visitors...” 空表，刷新补偿后仍未恢复')
    }
    return scheduleListPageRecovery({
      ...sharedState,
      listBusyRetry: retry + 1,
      recoverPageNo: currentPageNo,
      recoverOuterSite: currentSite,
    }, 'Temu 商品流量列表出现 “Too many visitors...” 空表', currentPageNo, currentSite)
  }

  async function prepareCurrentSite(sharedState, nextPhaseName = 'collect', extraShared = {}) {
    const productOk = await ensureProductTrafficSection()
    if (!productOk) return fail('未能切回「商品流量」tab')

    const state = await waitForListReady(12000)
    if (!state.ready) return fail('商品流量列表加载超时')
    if (state.busy) return buildBusyReload('prepare_current_site', sharedState)

    if (!clickLike(findMainButton('重置'))) {
      return fail('未找到商品流量列表的「重置」按钮')
    }
    await sleep(1200)

    if (listTimeRange) {
      const timeOk = await clickCapsule(listTimeRange)
      if (!timeOk) return fail(`列表统计时间切换失败：${listTimeRange}`)
    }

    if (productIdQuery) {
      const typeOk = await setMainSelectByLabel('商品ID查询', productIdType)
      if (!typeOk) return fail(`商品ID查询类型切换失败：${productIdType}`)
      const inputOk = await setMainTextInput('商品ID查询', productIdQuery)
      if (!inputOk) return fail('填写「商品ID查询」失败')
    }

    if (goodsNoQuery) {
      const typeOk = await setMainSelectByLabel('货号查询', goodsNoType)
      if (!typeOk) return fail(`货号查询类型切换失败：${goodsNoType}`)
      const inputOk = await setMainTextInput('货号查询', goodsNoQuery)
      if (!inputOk) return fail('填写「货号查询」失败')
    }

    if (categoryPath) {
      const categoryOk = await setCategoryPath(categoryPath)
      if (!categoryOk) return fail(`商品分类设置失败：${categoryPath}`)
    }

    if (productName) {
      const nameOk = await setMainTextInput('商品名称', productName)
      if (!nameOk) return fail('填写「商品名称」失败')
    }

    const quickOk = await clickQuickFilter(quickFilter)
    if (!quickOk) return fail(`快速筛选切换失败：${quickFilter}`)

    if (!clickLike(findMainButton('查询'))) {
      return fail('未找到商品流量列表的「查询」按钮')
    }
    await sleep(1800)

    const afterQuery = await waitForListReady(15000)
    if (!afterQuery.ready) return fail('列表查询后加载超时')
    if (afterQuery.busy) return buildBusyReload('prepare_current_site', sharedState)

    const pageResetOk = await ensureListPageNo(1, 30000)
    if (!pageResetOk) return fail('商品流量列表未能回到第一页')

    return nextPhase(nextPhaseName, 400, {
      ...sharedState,
      ...extraShared,
      listBusyRetry: 0,
    })
  }

  function scheduleListPageRecovery(sharedState, reason, targetPageNo, targetSite) {
    const retry = Number(sharedState.listPageRetry || 0)
    if (retry >= LIST_PAGE_RECOVERY_LIMIT) {
      return fail(`商品流量列表分页重试 ${retry} 次后仍失败：${reason}`)
    }
    return reloadPage('recover_list_page', 2200, {
      ...sharedState,
      listBusyRetry: 0,
      listPageRetry: retry + 1,
      listPageRetryReason: reason,
      recoverPageNo: Math.max(1, Number(targetPageNo || 1)),
      recoverOuterSite: targetSite || sharedState.currentOuterSite || getActiveOuterSite() || '',
    })
  }

  try {
    if (phase === 'main') {
      if (page === 1) return nextPhase('ensure_target', 0)
      return nextPhase('advance_cursor', 0)
    }

    if (phase === 'ensure_target') {
      if (!location.href.includes('/main/flux-analysis-full')) {
        location.href = TARGET_URL
        return nextPhase('ensure_target', mode === 'new' ? 3000 : 2200)
      }

      const ready = await waitForTargetReady(15000)
      if (!ready) return fail('Temu 商品流量页面未加载，请确认已登录并能打开「后台-商品流量」页面')

      const { available, target } = buildTargetOuterSites()
      if (!target.length) return fail(`未找到可抓取的外层站点，可用站点：${available.join(' / ') || '无'}`)

      const activeSite = getActiveOuterSite() || target[0]
      if (activeSite !== target[0]) {
        const click = getOuterSiteClick(target[0])
        if (!click) return fail(`外层站点切换失败：${target[0]}`)
        return cdpClicks([click], 'after_outer_site_switch', 3600, {
          targetOuterSites: target,
          targetOuterSite: target[0],
        })
      }

      return nextPhase('prepare_current_site', 400, {
        targetOuterSites: target,
        listPageRetry: 0,
      })
    }

    if (phase === 'after_outer_site_switch') {
      const ready = await waitForTargetReady(15000)
      if (!ready) return fail(`切换外层站点后页面未恢复：${shared.targetOuterSite || '未知站点'}`)
      const state = await waitForListReady(12000)
      if (!state.ready) return fail(`切换外层站点后列表未加载：${shared.targetOuterSite || '未知站点'}`)
      if (state.busy) return buildBusyReload('after_outer_site_switch', shared)
      return nextPhase(shared.resume_phase || 'prepare_current_site', 400, {
        ...shared,
        listBusyRetry: 0,
        resume_phase: '',
      })
    }

    if (phase === 'prepare_current_site') {
      return await prepareCurrentSite(shared)
    }

    if (phase === 'recover_list_page') {
      if (!location.href.includes('/main/flux-analysis-full')) {
        location.href = TARGET_URL
        return nextPhase('recover_list_page', mode === 'new' ? 3000 : 2200, shared)
      }

      const ready = await waitForTargetReady(15000)
      if (!ready) return fail('商品流量页面恢复失败：页面未完成加载')

      const targetSite = shared.recoverOuterSite || shared.currentOuterSite || getActiveOuterSite() || ''
      if (targetSite && getActiveOuterSite() !== targetSite) {
        const click = getOuterSiteClick(targetSite)
        if (!click) {
          return fail(`商品流量页面恢复失败：无法切换到站点 ${targetSite}`)
        }
        return cdpClicks([click], 'after_outer_site_switch', 3600, {
          ...shared,
          targetOuterSite: targetSite,
          resume_phase: 'recover_list_page_prepare',
        })
      }

      return nextPhase('recover_list_page_prepare', 0, shared)
    }

    if (phase === 'recover_list_page_prepare') {
      return await prepareCurrentSite(shared, 'restore_list_page', {
        currentOuterSite: shared.recoverOuterSite || shared.currentOuterSite || getActiveOuterSite() || '',
      })
    }

    if (phase === 'restore_list_page') {
      const targetPageNo = Math.max(1, Number(shared.recoverPageNo || 1))
      const targetSite = shared.recoverOuterSite || shared.currentOuterSite || getActiveOuterSite() || ''
      if (targetPageNo > 1) {
        await sleep(PAGER_THROTTLE_MS)
        const restored = await ensureListPageNo(targetPageNo, 60000)
        if (!restored) {
          return scheduleListPageRecovery(
            shared,
            `恢复到第 ${targetPageNo} 页失败`,
            targetPageNo,
            targetSite,
          )
        }
      }

      const state = await waitForListReady(15000)
      if (!state.ready) {
        return scheduleListPageRecovery(
          shared,
          `恢复后的第 ${targetPageNo} 页加载超时`,
          targetPageNo,
          targetSite,
        )
      }
      if (state.busy) {
        return scheduleListPageRecovery(
          shared,
          `恢复后的第 ${targetPageNo} 页出现 Too many visitors`,
          targetPageNo,
          targetSite,
        )
      }

      return nextPhase('collect', 400, {
        ...shared,
        currentOuterSite: targetSite,
        recoverPageNo: 0,
        recoverOuterSite: '',
        listPageRetry: 0,
        listPageRetryReason: '',
      })
    }

    if (phase === 'advance_cursor') {
      const ready = await waitForTargetReady(15000)
      if (!ready) return fail('商品流量页面状态丢失，无法继续翻页')

      const { available, target } = buildTargetOuterSites()
      if (!target.length) return fail(`未找到可抓取的外层站点，可用站点：${available.join(' / ') || '无'}`)

      const currentSite = getActiveOuterSite() || target[0]
      if (hasNextListPage()) {
        const oldSig = getListPageSignature()
        const oldPageNo = getListPageNo()
        await sleep(PAGER_THROTTLE_MS)
        if (!clickNextListPage()) {
          return scheduleListPageRecovery(
            shared,
            '商品流量列表翻页失败：无法点击下一页',
            oldPageNo + 1,
            currentSite,
          )
        }
        const changed = await waitListPageChange(oldSig, oldPageNo, 10000)
        if (!changed) {
          return scheduleListPageRecovery(
            shared,
            '商品流量列表翻页后页码/数据未更新',
            oldPageNo + 1,
            currentSite,
          )
        }
        return nextPhase('after_list_page_turn', 400, {
          targetOuterSites: target,
          currentOuterSite: currentSite,
          lastCollectedPageNo: Number(shared.lastCollectedPageNo || oldPageNo),
        })
      }

      const nextSite = nextOuterSite(target, currentSite)
      if (!nextSite) return complete([], false)

      const click = getOuterSiteClick(nextSite)
      if (!click) return fail(`切换外层站点失败：${nextSite}`)
      return cdpClicks([click], 'after_outer_site_switch', 3600, {
        targetOuterSites: target,
        targetOuterSite: nextSite,
      })
    }

    if (phase === 'after_list_page_turn') {
      const state = await waitForListReady(15000)
      const targetPageNo = Number(shared.lastCollectedPageNo || 0) + 1 || getListPageNo()
      const targetSite = shared.currentOuterSite || getActiveOuterSite()
      if (!state.ready) {
        return scheduleListPageRecovery(shared, '商品流量列表翻页后加载超时', targetPageNo, targetSite)
      }
      if (state.busy) {
        return scheduleListPageRecovery(shared, '商品流量列表翻页后出现 Too many visitors', targetPageNo, targetSite)
      }
      return nextPhase('collect', 400, {
        ...shared,
        listBusyRetry: 0,
        listPageRetry: 0,
      })
    }

    if (phase === 'collect') {
      const currentOuterSite = shared.currentOuterSite || getActiveOuterSite()
      const targetOuterSites = shared.targetOuterSites || buildTargetOuterSites().target
      const currentPageNo = getListPageNo()
      const data = scrapeCurrentPage(currentOuterSite)
      const more = hasNextListPage() || moreOuterSitesRemain(targetOuterSites, currentOuterSite)
      return complete(data, more, {
        targetOuterSites,
        currentOuterSite,
        lastCollectedPageNo: currentPageNo,
        recoverPageNo: 0,
        recoverOuterSite: '',
        listPageRetry: 0,
        listPageRetryReason: '',
      })
    }

    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || String(error))
  }
})()
