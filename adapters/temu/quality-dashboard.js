;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = Number(window.__CRAWSHRIMP_PAGE__ || 1)
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const ANALYSIS_URL = 'https://agentseller.temu.com/main/quality/dashboard'
  const OPTIMIZE_URL = 'https://agentseller.temu.com/main/quality/optimize'
  const CANONICAL_REGIONS = ['全球', '美国', '欧区']
  const ANALYSIS_ROUTE = '品质分析'
  const OPTIMIZE_ROUTE = '品质优化'
  const REGION_BLACKLIST = new Set(['商家中心'])
  const SEEN_ROW_KEY = '__CRAWSHRIMP_TEMU_QUALITY_DASHBOARD_SEEN__'
  const DEFAULT_PAGE_SIZE = 20

  const requestedShared = {
    requestedMode: String(shared.requestedMode || params.mode || 'current').trim().toLowerCase(),
    requestedRegions: normalizeArray(shared.requestedRegions || params.regions),
  }

  const mode = requestedShared.requestedMode

  function normalizeArray(value) {
    if (!Array.isArray(value)) return []
    return value.map(item => String(item || '').trim()).filter(Boolean)
  }

  function mergeShared(next = shared) {
    return {
      ...requestedShared,
      ...(next || {}),
    }
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

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

  function fail(message) {
    return { success: false, error: message }
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

  function clickLike(el) {
    if (!el) return false
    try { el.scrollIntoView({ block: 'center', inline: 'center' }) } catch (e) {}
    try { el.focus?.() } catch (e) {}
    try { el.click?.() } catch (e) {}
    for (const type of ['pointerenter', 'pointerdown', 'pointerup']) {
      try {
        if (typeof PointerEvent !== 'undefined') {
          el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true }))
        }
      } catch (e) {}
    }
    for (const type of ['mouseenter', 'mousedown', 'mouseup', 'click']) {
      try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })) } catch (e) {}
    }
    return true
  }

  function localNow() {
    const date = new Date()
    const pad = value => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  async function waitFor(check, timeout = 10000, interval = 200) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (check()) return true
      await sleep(interval)
    }
    return false
  }

  function getCurrentRoute() {
    return String(location.pathname || '').includes('/main/quality/optimize') ? OPTIMIZE_ROUTE : ANALYSIS_ROUTE
  }

  function parseTotalCount(text) {
    const match = String(text || '').replace(/,/g, '').match(/(\d+)/)
    const value = Number(match?.[1] || 0)
    return Number.isFinite(value) ? value : 0
  }

  function getScopeBatchProgress(regionText, routeLabel, targetRegions, routeOrder) {
    const regions = Array.isArray(targetRegions) && targetRegions.length ? targetRegions : [regionText].filter(Boolean)
    const routes = Array.isArray(routeOrder) && routeOrder.length ? routeOrder : [routeLabel].filter(Boolean)
    const regionIndex = Math.max(0, regions.indexOf(regionText))
    const routeIndex = Math.max(0, routes.indexOf(routeLabel))
    return {
      batch_no: regionIndex * routes.length + routeIndex + 1,
      total_batches: Math.max(1, regions.length * routes.length),
      current_store: [regionText, routeLabel].filter(Boolean).join(' / '),
    }
  }

  function getRouteUrl(routeLabel, regionText) {
    const hostMap = {
      全球: 'agentseller.temu.com',
      美国: 'agentseller-us.temu.com',
      欧区: 'agentseller-eu.temu.com',
    }
    const host = hostMap[regionText || '全球'] || hostMap['全球']
    const base = routeLabel === OPTIMIZE_ROUTE ? OPTIMIZE_URL : ANALYSIS_URL
    const url = new URL(base)
    url.hostname = host
    return url.toString()
  }

  function getRegionNodes() {
    return [...document.querySelectorAll('a[class*="index-module__drItem___"]')]
      .filter(isVisible)
      .filter(node => {
        const label = textOf(node)
        return label && !REGION_BLACKLIST.has(label)
      })
  }

  function getAvailableRegions() {
    return getRegionNodes()
      .filter(node => !hasClassFragment(node, 'index-module__disabled___'))
      .map(node => ({
        text: textOf(node),
        active: hasClassFragment(node, 'index-module__active___'),
      }))
  }

  function getActiveRegion() {
    return textOf(getRegionNodes().find(node => hasClassFragment(node, 'index-module__active___')) || null)
  }

  function getRegionFromHostname() {
    const host = String(location.hostname || '')
    if (host === 'agentseller.temu.com') return '全球'
    if (host === 'agentseller-us.temu.com') return '美国'
    if (host === 'agentseller-eu.temu.com') return '欧区'
    return ''
  }

  function getResolvedRegion() {
    return getActiveRegion() || getRegionFromHostname() || ''
  }

  function hasNoRegionAccess() {
    return /该区暂无权限/.test(textOf(document.body))
  }

  function buildTargetRegions() {
    const available = CANONICAL_REGIONS.filter(region =>
      getAvailableRegions().some(item => item.text === region),
    )
    const requested = requestedShared.requestedRegions.length
      ? CANONICAL_REGIONS.filter(item => requestedShared.requestedRegions.includes(item))
      : available
    return {
      available,
      target: requested.length ? requested : available,
    }
  }

  function getNextTargetRegion(targetRegions, currentRegion) {
    const regions = Array.isArray(targetRegions) ? targetRegions : []
    const index = regions.indexOf(currentRegion)
    return index >= 0 ? regions[index + 1] : ''
  }

  function getMainTable() {
    return [...document.querySelectorAll('table[class*="TB_tableWrapper_"], table')]
      .find(table => isVisible(table) && table.querySelector('tbody tr td')) || null
  }

  function getTableRows() {
    const table = getMainTable()
    if (!table) return []
    return [...table.querySelectorAll('tbody tr')].filter(row => row.querySelector('td'))
  }

  function buildTableHeaders(table) {
    if (!table) return []
    const headRows = [...table.querySelectorAll('thead tr')]
    const grid = []
    let maxCols = 0
    headRows.forEach((row, rowIndex) => {
      grid[rowIndex] = grid[rowIndex] || []
      let colIndex = 0
      ;[...row.querySelectorAll('th')].forEach(cell => {
        while (grid[rowIndex][colIndex]) colIndex += 1
        const rowSpan = Math.max(Number(cell.rowSpan) || 1, 1)
        const colSpan = Math.max(Number(cell.colSpan) || 1, 1)
        for (let y = 0; y < rowSpan; y += 1) {
          grid[rowIndex + y] = grid[rowIndex + y] || []
          for (let x = 0; x < colSpan; x += 1) {
            grid[rowIndex + y][colIndex + x] = cell
          }
        }
        colIndex += colSpan
        maxCols = Math.max(maxCols, colIndex)
      })
    })
    return Array.from({ length: maxCols }, (_, columnIndex) => {
      const labels = []
      const seen = new Set()
      grid.forEach(row => {
        const value = textOf(row?.[columnIndex] || null)
        if (!value || seen.has(value)) return
        seen.add(value)
        labels.push(value)
      })
      if (!labels.length) return ''
      if (labels.length === 1) return labels[0]
      return `${labels[0]}/${labels[labels.length - 1]}`
    })
  }

  function buildTableBody(table, headers) {
    if (!table) return []
    const carry = []
    return [...table.querySelectorAll('tbody tr')]
      .filter(row => row.querySelector('td'))
      .map(row => {
        const expanded = Array.from({ length: headers.length }, () => null)
        const nextCarry = []
        for (let index = 0; index < headers.length; index += 1) {
          const item = carry[index]
          if (!item) continue
          expanded[index] = item.cell
          if (item.remaining > 1) {
            nextCarry[index] = { cell: item.cell, remaining: item.remaining - 1 }
          }
        }
        let columnIndex = 0
        ;[...row.querySelectorAll('td')].forEach(cell => {
          while (expanded[columnIndex]) columnIndex += 1
          const rowSpan = Math.max(Number(cell.rowSpan) || 1, 1)
          const colSpan = Math.max(Number(cell.colSpan) || 1, 1)
          for (let offset = 0; offset < colSpan; offset += 1) {
            expanded[columnIndex + offset] = cell
            if (rowSpan > 1) {
              nextCarry[columnIndex + offset] = { cell, remaining: rowSpan - 1 }
            }
          }
          columnIndex += colSpan
        })
        carry.length = 0
        nextCarry.forEach((item, index) => { carry[index] = item })
        const values = {}
        headers.forEach((header, index) => {
          if (!header) return
          values[header] = expanded[index] ? textOf(expanded[index]) : ''
        })
        return { row, expanded, values }
      })
  }

  function getTotalText() {
    return textOf(document.querySelector('li[class*="PGT_totalText_"], [data-testid="beast-core-pagination"]')).slice(0, 80)
  }

  function getPageSignature() {
    const rows = getTableRows()
    const first = rows[0] ? textOf(rows[0]).slice(0, 160) : 'empty'
    const last = rows[rows.length - 1] ? textOf(rows[rows.length - 1]).slice(0, 160) : 'empty'
    return `${getResolvedRegion()}::${getCurrentRoute()}::${getActiveDimension()}::${getActivePage()}::${rows.length}::${getTotalText()}::${first}::${last}`
  }

  async function waitForTable(timeout = 30000) {
    return await waitFor(() => {
      if (getTableRows().length) return true
      return /暂无数据|该区暂无权限|共有\s*0\s*条/.test(textOf(document.body))
    }, timeout, 300)
  }

  function getActivePage() {
    const node = document.querySelector('li[class*="PGT_pagerItemActive_"], li[aria-current="page"]')
    const value = parseInt(textOf(node), 10)
    return Number.isFinite(value) ? value : 1
  }

  function getPrevPager() {
    const node = document.querySelector('li[class*="PGT_prev_"]')
    if (!node || hasClassFragment(node, 'PGT_disabled_')) return null
    return node
  }

  function getNextPager() {
    const node = document.querySelector('li[class*="PGT_next_"]')
    if (!node || hasClassFragment(node, 'PGT_disabled_')) return null
    return node
  }

  async function ensureFirstPage(timeout = 12000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (getActivePage() <= 1) return true
      const prev = getPrevPager()
      if (!prev) return false
      const oldSig = getPageSignature()
      clickLike(prev)
      const changed = await waitFor(() => getPageSignature() !== oldSig, 10000, 300)
      if (!changed) return false
      await waitForTable(10000)
    }
    return getActivePage() <= 1
  }

  async function advancePager() {
    const next = getNextPager()
    if (!next) return false
    const oldSig = getPageSignature()
    clickLike(next)
    const changed = await waitFor(() => getPageSignature() !== oldSig, 10000, 300)
    if (!changed) return false
    await waitForTable(10000)
    return true
  }

  function getAnalysisBucketNodes() {
    if (getCurrentRoute() !== ANALYSIS_ROUTE) return []
    return [...document.querySelectorAll('[data-testid="beast-core-tab-itemLabel-wrapper"], [class*="TAB_tabItem_"], [class*="TAB_reunit_"]')]
      .filter(isVisible)
      .filter(node => {
        const value = textOf(node)
        return /品质分/.test(value) && /商品数/.test(value)
      })
  }

  function getOptimizeStatusNodes() {
    if (getCurrentRoute() !== OPTIMIZE_ROUTE) return []
    return [...document.querySelectorAll('[data-testid="beast-core-tab-itemLabel-wrapper"], [class*="TAB_tabItem_"], [class*="TAB_line_"]')]
      .filter(isVisible)
      .filter(node => /^(全部|可优化|已处理|超时未处理)/.test(textOf(node)))
  }

  function normalizeAnalysisDimensionLabel(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/商品数\s*[-0-9]+\s*(?=\()/, '商品数 ')
      .trim()
  }

  function normalizeDimensionLabel(value, routeLabel = getCurrentRoute()) {
    const clean = String(value || '').replace(/\s+/g, ' ').trim()
    return routeLabel === ANALYSIS_ROUTE ? normalizeAnalysisDimensionLabel(clean) : clean
  }

  function getRouteDimensions() {
    if (getCurrentRoute() === ANALYSIS_ROUTE) {
      return getAnalysisBucketNodes().map(node => normalizeDimensionLabel(textOf(node), ANALYSIS_ROUTE)).filter(Boolean)
    }
    return getOptimizeStatusNodes().map(node => normalizeDimensionLabel(textOf(node), OPTIMIZE_ROUTE)).filter(Boolean)
  }

  function getActiveDimension() {
    const routeLabel = getCurrentRoute()
    const nodes = routeLabel === ANALYSIS_ROUTE ? getAnalysisBucketNodes() : getOptimizeStatusNodes()
    const active = nodes.find(node => hasClassFragment(node, 'TAB_active_'))
    return normalizeDimensionLabel(textOf(active || null), routeLabel)
  }

  function getDimensionNode(label) {
    const routeLabel = getCurrentRoute()
    const nodes = routeLabel === ANALYSIS_ROUTE ? getAnalysisBucketNodes() : getOptimizeStatusNodes()
    const targetLabel = normalizeDimensionLabel(label, routeLabel)
    return nodes.find(node => normalizeDimensionLabel(textOf(node), routeLabel) === targetLabel) || null
  }

  async function switchDimension(label) {
    const routeLabel = getCurrentRoute()
    const targetLabel = normalizeDimensionLabel(label, routeLabel)
    const node = getDimensionNode(targetLabel)
    if (!node) return false
    if (getActiveDimension() === targetLabel) return true
    const oldTotal = getTotalText()
    const oldFirst = textOf(getTableRows()[0] || null)
    clickLike(node)
    const changed = await waitFor(() => {
      if (getActiveDimension() !== targetLabel) return false
      return getTotalText() !== oldTotal || textOf(getTableRows()[0] || null) !== oldFirst || !getTableRows().length
    }, 15000, 300)
    if (!changed) return false
    await waitForTable(12000)
    await sleep(400)
    return getActiveDimension() === targetLabel
  }

  async function navigateToRoute(routeLabel, regionText) {
    const targetUrl = getRouteUrl(routeLabel, regionText)
    if (!targetUrl) return false
    if (String(location.href || '').startsWith(targetUrl)) return true
    location.href = targetUrl
    return true
  }

  function getSeenRows() {
    if (!window[SEEN_ROW_KEY] || typeof window[SEEN_ROW_KEY] !== 'object') {
      window[SEEN_ROW_KEY] = Object.create(null)
    }
    return window[SEEN_ROW_KEY]
  }

  function resetSeenRows() {
    window[SEEN_ROW_KEY] = Object.create(null)
  }

  function dedupeRows(rows) {
    const seen = getSeenRows()
    const results = []
    for (const row of rows) {
      const key = [
        row.__sheet_name,
        row.地区,
        row.子Tab标签,
        row.商品信息,
        row.SPU,
        row.列表页码,
        row.列表行号,
      ].map(item => String(item || '').trim()).join('\u001f')
      if (seen[key]) continue
      seen[key] = 1
      results.push(row)
    }
    return results
  }

  function parseSpuFromText(text) {
    const match = String(text || '').match(/(?:SPU[:：]|货品SPU ID[:：])\s*([0-9]+)/)
    return match ? match[1] : ''
  }

  function textFromExpanded(entry, index) {
    return textOf(entry?.expanded?.[index] || null)
  }

  function mapAnalysisRow(common, raw, rowText) {
    return {
      __sheet_name: '品质分析',
      ...common,
      商品信息: raw['商品信息'] || '',
      SPU: parseSpuFromText(raw['商品信息'] || ''),
      品质分: raw['品质分'] || '',
      '主要品质问题/售后问题': raw['主要品质问题/售后问题'] || '',
      '主要品质问题/负向评价类型': raw['主要品质问题/负向评价类型'] || '',
      建议优化方案: raw['建议优化方案'] || '',
      '售后情况/品质售后率': raw['售后情况/品质售后率'] || '',
      '售后情况/品质售后次数': raw['售后情况/品质售后次数'] || '',
      '售后情况/尺码售后率': raw['售后情况/尺码售后率'] || '',
      '售后情况/尺码售后次数': raw['售后情况/尺码售后次数'] || '',
      '用户评价情况/评价数': raw['用户评价情况/评价数'] || '',
      '用户评价情况/评价均分': raw['用户评价情况/评价均分'] || '',
      '用户评价情况/合身情况': raw['用户评价情况/合身情况'] || '',
      '用户评价情况/负向评价关键词': raw['用户评价情况/负向评价关键词'] || '',
      原始行文本: rowText,
    }
  }

  function mapAnalysisRowByPosition(common, entry, rowText) {
    const goodsInfo = textFromExpanded(entry, 0)
    return {
      __sheet_name: '品质分析',
      ...common,
      商品信息: goodsInfo,
      SPU: parseSpuFromText(goodsInfo),
      品质分: textFromExpanded(entry, 1),
      '主要品质问题/售后问题': textFromExpanded(entry, 2),
      '主要品质问题/负向评价类型': textFromExpanded(entry, 3),
      建议优化方案: textFromExpanded(entry, 4),
      '售后情况/品质售后率': textFromExpanded(entry, 5),
      '售后情况/品质售后次数': textFromExpanded(entry, 6),
      '售后情况/尺码售后率': textFromExpanded(entry, 7),
      '售后情况/尺码售后次数': textFromExpanded(entry, 8),
      '用户评价情况/评价数': textFromExpanded(entry, 9),
      '用户评价情况/评价均分': textFromExpanded(entry, 10),
      '用户评价情况/合身情况': textFromExpanded(entry, 11),
      '用户评价情况/负向评价关键词': textFromExpanded(entry, 12),
      原始行文本: rowText,
    }
  }

  function mapOptimizeRow(common, raw, rowText) {
    return {
      __sheet_name: '品质优化',
      ...common,
      商品信息: raw['商品信息'] || '',
      SPU: parseSpuFromText(raw['商品信息'] || ''),
      状态: raw['状态'] || '',
      参考完成时间: raw['参考完成时间'] || '',
      优化方式: raw['优化方式'] || '',
      问题描述: raw['问题描述'] || '',
      参考优化内容: raw['参考优化内容'] || '',
      是否优化: raw['是否优化'] || '',
      操作: raw['操作'] || '',
      原始行文本: rowText,
    }
  }

  async function collectCurrentPage() {
    const region = getResolvedRegion()
    const route = getCurrentRoute()
    const dimension = getActiveDimension() || route
    const pageNo = getActivePage()
    const scrapedAt = localNow()
    const table = getMainTable()
    const headers = buildTableHeaders(table)
    const rows = buildTableBody(table, headers)
    const results = []

    rows.forEach((entry, index) => {
      const raw = entry.values || {}
      const common = {
        地区: region,
        子Tab标签: dimension,
        列表页码: pageNo,
        抓取时间: scrapedAt,
        列表行号: index + 1,
      }
      const rowText = textOf(entry.row)
      if (route === ANALYSIS_ROUTE) {
        results.push(mapAnalysisRowByPosition(common, entry, rowText))
      } else {
        results.push(mapOptimizeRow(common, raw, rowText))
      }
    })

    return dedupeRows(results)
  }

  try {
    if (phase === 'main') {
      if (page === 1) {
        resetSeenRows()
        return nextPhase('ensure_target', 0)
      }
      return nextPhase('advance_scope', 0)
    }

    if (phase === 'ensure_target') {
      if (!/\/main\/quality\/(dashboard|optimize)/.test(String(location.href || ''))) {
        location.href = ANALYSIS_URL
        return nextPhase('ensure_target', mode === 'new' ? 2200 : 1500)
      }
      const ready = await waitForTable(30000)
      if (!ready) return fail('商品品质分析页面未加载完成，请确认已登录并能打开列表')
      const { available, target } = buildTargetRegions()
      if (!target.length) return fail('当前账号下没有可抓取的商品品质分析地区')
      const currentRegion = getResolvedRegion() || target[0]
      if (currentRegion !== target[0] || getCurrentRoute() !== ANALYSIS_ROUTE) {
        await navigateToRoute(ANALYSIS_ROUTE, target[0])
        return nextPhase('wait_route_ready', 2200, {
          availableRegions: available,
          targetRegions: target,
          currentRegion: target[0],
          targetRoute: ANALYSIS_ROUTE,
        })
      }
      if (hasNoRegionAccess()) {
        const nextRegion = getNextTargetRegion(target, currentRegion)
        if (!nextRegion) {
          return complete([], false, {
            availableRegions: available,
            targetRegions: target,
            currentRegion,
          })
        }
        await navigateToRoute(ANALYSIS_ROUTE, nextRegion)
        return nextPhase('wait_route_ready', 2200, {
          availableRegions: available,
          targetRegions: target,
          currentRegion: nextRegion,
          targetRoute: ANALYSIS_ROUTE,
        })
      }
      const firstPageReady = await ensureFirstPage(12000)
      if (!firstPageReady) return fail('商品品质分析列表无法回到第一页')
      const dimensions = getRouteDimensions()
      const firstDimension = dimensions[0] || ANALYSIS_ROUTE
      if (dimensions.length) {
        const switched = await switchDimension(firstDimension)
        if (!switched) return fail(`商品品质分析子 Tab 切换失败：${firstDimension}`)
      }
      return nextPhase('collect', 300, {
        availableRegions: available,
        targetRegions: target,
        targetRouteOrder: [ANALYSIS_ROUTE, OPTIMIZE_ROUTE],
        currentRegion,
      })
    }

    if (phase === 'wait_route_ready') {
      const ready = await waitForTable(30000)
      if (!ready) return fail(`商品品质分析页面切换后未加载完成：${shared.targetRoute || '未知页面'}`)
      if (hasNoRegionAccess()) {
        const currentRegion = getResolvedRegion() || String(shared.currentRegion || '').trim()
        const targetRegions = Array.isArray(shared.targetRegions) ? shared.targetRegions : []
        const nextRegion = getNextTargetRegion(targetRegions, currentRegion)
        if (!nextRegion) {
          return complete([], false, {
            ...shared,
            currentRegion,
          })
        }
        await navigateToRoute(ANALYSIS_ROUTE, nextRegion)
        return nextPhase('wait_route_ready', 2200, {
          ...shared,
          currentRegion: nextRegion,
          targetRoute: ANALYSIS_ROUTE,
        })
      }
      const firstPageReady = await ensureFirstPage(12000)
      if (!firstPageReady) return fail(`商品品质分析列表无法回到第一页：${shared.targetRoute || '未知页面'}`)
      const dimensions = getRouteDimensions()
      const firstDimension = dimensions[0] || getCurrentRoute()
      if (dimensions.length) {
        const switched = await switchDimension(firstDimension)
        if (!switched) return fail(`商品品质分析子 Tab 切换失败：${firstDimension}`)
      }
      return nextPhase('collect', 300, {
        ...shared,
        currentRegion: getResolvedRegion(),
      })
    }

    if (phase === 'collect') {
      const ready = await waitForTable(20000)
      if (!ready) return fail('商品品质分析列表加载超时')
      const data = await collectCurrentPage()
      const currentRegion = getResolvedRegion()
      const currentRoute = getCurrentRoute()
      const currentDimension = getActiveDimension()
      const currentPageNo = getActivePage()
      const rowsOnPage = getTableRows().length
      const scopeKey = [currentRegion, currentRoute, currentDimension].join('::')
      const previousScopeKey = String(shared.currentScopeKey || '').trim()
      const scopePageSize = previousScopeKey === scopeKey
        ? Math.max(1, Number(shared.currentScopePageSize || 0) || rowsOnPage || DEFAULT_PAGE_SIZE)
        : Math.max(1, rowsOnPage || DEFAULT_PAGE_SIZE)
      const totalCount = parseTotalCount(getTotalText())
      const totalPages = totalCount > 0 ? Math.max(1, Math.ceil(totalCount / scopePageSize)) : (rowsOnPage > 0 ? 1 : 0)
      return complete(data, true, {
        ...shared,
        currentRegion,
        currentRoute,
        currentDimension,
        currentPageNo,
        currentScopeKey: scopeKey,
        currentScopePageSize: scopePageSize,
        currentScopeTotalPages: totalPages,
        total_rows: totalPages,
        current_exec_no: currentPageNo,
        current_row_no: rowsOnPage,
        current_buyer_id: currentDimension || '',
        ...getScopeBatchProgress(
          currentRegion,
          currentRoute,
          shared.targetRegions,
          shared.targetRouteOrder,
        ),
      })
    }

    if (phase === 'advance_scope') {
      const ready = await waitForTable(20000)
      if (!ready) return fail('商品品质分析列表加载超时')
      const currentRegion = getResolvedRegion()
      const currentRoute = getCurrentRoute()
      const currentDimension = getActiveDimension() || currentRoute

      if (getNextPager()) {
        const paged = await advancePager()
        if (!paged) return fail(`商品品质分析列表翻页失败：${currentRegion} / ${currentRoute} / ${currentDimension}`)
        return nextPhase('collect', 300, {
          ...shared,
          currentRegion,
          currentRoute,
          currentDimension,
          currentPageNo: getActivePage(),
          currentScopeKey: [currentRegion, currentRoute, currentDimension].join('::'),
        })
      }

      const dimensions = getRouteDimensions()
      const dimensionIndex = dimensions.indexOf(currentDimension)
      const nextDimension = dimensionIndex >= 0 ? dimensions[dimensionIndex + 1] : ''
      if (nextDimension) {
        const switched = await switchDimension(nextDimension)
        if (!switched) return fail(`商品品质分析子 Tab 切换失败：${nextDimension}`)
        const firstPageReady = await ensureFirstPage(12000)
        if (!firstPageReady) return fail(`商品品质分析列表无法回到第一页：${nextDimension}`)
        return nextPhase('collect', 300, {
          ...shared,
          currentRegion,
          currentRoute,
          currentDimension: nextDimension,
          currentPageNo: getActivePage(),
          currentScopeKey: '',
          currentScopePageSize: 0,
          currentScopeTotalPages: 0,
        })
      }

      const routeOrder = Array.isArray(shared.targetRouteOrder) ? shared.targetRouteOrder : [ANALYSIS_ROUTE, OPTIMIZE_ROUTE]
      const routeIndex = routeOrder.indexOf(currentRoute)
      const nextRoute = routeIndex >= 0 ? routeOrder[routeIndex + 1] : ''
      if (nextRoute) {
        await navigateToRoute(nextRoute, currentRegion)
        return nextPhase('wait_route_ready', 2200, {
          ...shared,
          currentRegion,
          targetRoute: nextRoute,
          currentScopeKey: '',
          currentScopePageSize: 0,
          currentScopeTotalPages: 0,
        })
      }

      const targetRegions = Array.isArray(shared.targetRegions) ? shared.targetRegions : buildTargetRegions().target
      const regionIndex = targetRegions.indexOf(currentRegion)
      const nextRegion = regionIndex >= 0 ? targetRegions[regionIndex + 1] : ''
      if (!nextRegion) {
        return complete([], false, {
          ...shared,
          currentRegion,
          currentRoute,
          currentDimension,
          currentPageNo: getActivePage(),
        })
      }

      await navigateToRoute(ANALYSIS_ROUTE, nextRegion)
      return nextPhase('wait_route_ready', 2200, {
        ...shared,
        currentRegion: nextRegion,
        targetRoute: ANALYSIS_ROUTE,
        currentScopeKey: '',
        currentScopePageSize: 0,
        currentScopeTotalPages: 0,
      })
    }

    return fail(`未知执行阶段：${phase}`)
  } catch (error) {
    return fail(error?.message || String(error))
  }
})()
