;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = Number(window.__CRAWSHRIMP_PAGE__ || 1)
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const TARGET_URL = 'https://agentseller.temu.com/labor/limited/list'
  const CANONICAL_REGIONS = ['全球', '美国', '欧区']
  const REGION_BLACKLIST = new Set(['商家中心'])
  const SEEN_ROW_KEY = '__CRAWSHRIMP_TEMU_FUND_LIMITED_SEEN__'
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

  function cdpClicks(clicks, nextPhaseName, sleepMs = 1000, next = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'cdp_clicks', clicks, next_phase: nextPhaseName, sleep_ms: sleepMs, shared: mergeShared(next) },
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

  function parseTotalCount(text) {
    const match = String(text || '').replace(/,/g, '').match(/(\d+)/)
    const value = Number(match?.[1] || 0)
    return Number.isFinite(value) ? value : 0
  }

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

  function getExpectedHostRegion(regionText) {
    if (regionText === '全球') return 'agentseller.temu.com'
    if (regionText === '美国') return 'agentseller-us.temu.com'
    if (regionText === '欧区') return 'agentseller-eu.temu.com'
    return ''
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

  function getRegionClick(regionText) {
    const node = getRegionNodes().find(item =>
      textOf(item) === regionText &&
      !hasClassFragment(item, 'index-module__disabled___'),
    )
    return getCenterClick(node)
  }

  function getRegionUrl(regionText) {
    const hostMap = {
      全球: 'agentseller.temu.com',
      美国: 'agentseller-us.temu.com',
      欧区: 'agentseller-eu.temu.com',
    }
    const host = hostMap[regionText]
    if (!host) return ''
    const url = new URL(TARGET_URL)
    url.hostname = host
    return url.toString()
  }

  async function waitForRegion(regionText, timeout = 20000) {
    return await waitFor(() => getResolvedRegion() === regionText, timeout, 300)
  }

  function getTableRows() {
    return [...document.querySelectorAll('tbody tr[class*="TB_tr_"], tr[class*="TB_tr_"]')]
      .filter(row => row.querySelector('td[class*="TB_td_"], td'))
  }

  function getTableHeaders() {
    return [...document.querySelectorAll('thead th[class*="TB_th_"], th[class*="TB_th_"], thead th')]
      .map(cell => textOf(cell))
      .filter(Boolean)
  }

  function getTotalText() {
    return textOf(document.querySelector('li[class*="PGT_totalText_"], [data-testid="beast-core-pagination"]')).slice(0, 80)
  }

  function getPageSignature() {
    const rows = getTableRows()
    const first = rows[0] ? textOf(rows[0]).slice(0, 200) : 'empty'
    const last = rows[rows.length - 1] ? textOf(rows[rows.length - 1]).slice(0, 200) : 'empty'
    return `${getResolvedRegion()}::${getActivePage()}::${rows.length}::${first}::${last}`
  }

  function hasRegionInfoBanner() {
    const bodyText = textOf(document.body)
    const region = getResolvedRegion()
    return !!(region && region !== '全球' && /为保障交易安全及消费者权益/.test(bodyText))
  }

  async function waitForTable(timeout = 20000) {
    return await waitFor(() => {
      if (getTableRows().length) return true
      const bodyText = textOf(document.body)
      if (/暂无数据|该区暂无权限/.test(bodyText)) return true
      return false
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

  async function ensureFirstPage(timeout = 15000) {
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

  function getVisibleDrawer() {
    return [
      ...document.querySelectorAll('[class*="Drawer_content_"]'),
      ...document.querySelectorAll('[class*="Drawer_outerWrapper_"]'),
      ...document.querySelectorAll('[data-testid="beast-core-drawer-content"]'),
      ...document.querySelectorAll('[data-testid="beast-core-drawer"]'),
    ].find(node => isVisible(node) && /限制详情/.test(textOf(node))) || null
  }

  async function waitForDrawer(timeout = 8000) {
    return await waitFor(() => {
      const drawer = getVisibleDrawer()
      if (!drawer) return false
      const text = textOf(drawer)
      if (/加载中/.test(text)) return false
      return /限制金额说明|限制解除条件|限制详细信息/.test(text)
    }, timeout, 200)
  }

  async function closeDrawer() {
    const drawer = getVisibleDrawer()
    if (!drawer) return true
    const closeNode = drawer.querySelector('[data-testid*="icon-close"], svg[data-testid*="icon-close"]')
      || [...document.querySelectorAll('[data-testid*="icon-close"], svg[data-testid*="icon-close"]')].find(isVisible)
      || [...drawer.querySelectorAll('button, a, div, span')].find(node => textOf(node) === '关闭')
    if (closeNode) {
      clickLike(closeNode)
    } else {
      const mask = [...document.querySelectorAll('[class*="Drawer_mask_"]')].find(isVisible)
      if (mask) clickLike(mask)
    }
    return await waitFor(() => !getVisibleDrawer(), 6000, 200)
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
        row.限制原因,
        row['当前限制总金额(CNY)'] || row.当前限制总金额,
        row.运单号,
        row.明细分组,
        row.明细序号,
      ].map(item => String(item || '').trim()).join('\u001f')
      if (seen[key]) continue
      seen[key] = 1
      results.push(row)
    }
    return results
  }

  function findRowDetailAction(row) {
    return [...row.querySelectorAll('a, button, [role="button"], span')]
      .find(node => textOf(node) === '查看详情') || null
  }

  function isPlaceholderText(value) {
    return /^[-—–\s]+$/.test(String(value || '').trim()) || String(value || '').trim() === '--'
  }

  function extractDrawerField(drawer, titleText) {
    const titleNode = [...drawer.querySelectorAll('*')]
      .find(node => textOf(node) === titleText && /detailModal_/.test(String(node.className || '')))
    if (!titleNode) return ''
    const wrapper = titleNode.parentElement
    if (!wrapper) return ''
    const valueNode = [...wrapper.querySelectorAll('*')]
      .find(node => node !== titleNode && /detailModal_(tipText|reasonText|amountItemValue)/.test(String(node.className || '')))
    return textOf(valueNode || wrapper).replace(new RegExp(`^${titleText}\\s*`), '').trim()
  }

  function extractDrawerReason(drawer) {
    return textOf(drawer.querySelector('[class*="detailModal_reasonText__"]') || null)
  }

  function extractRegionalAmountSummary(drawer) {
    const items = [...drawer.querySelectorAll('[class*="detailModal_amountItem__"]')]
      .map(node => {
        const label = textOf(node.querySelector('[class*="detailModal_amountItemLabel__"]') || null)
        const value = textOf(node.querySelector('[class*="detailModal_amountItemValue__"]') || null)
        return label && value ? `${label} ${value}` : ''
      })
      .filter(Boolean)
    return items.join('；')
  }

  function findNearestSectionTitle(node, root) {
    let current = node?.previousElementSibling || null
    while (current && root?.contains(current)) {
      const value = textOf(current)
      if (value && value.length <= 40) return value
      current = current.previousElementSibling
    }
    return ''
  }

  function scrapeDrawerDetails(baseRow) {
    const drawer = getVisibleDrawer()
    if (!drawer) {
      return [{
        __sheet_name: '详情',
        ...baseRow,
        明细分组: '错误',
        明细序号: 1,
        错误信息: '限制详情抽屉不存在',
      }]
    }

    const rows = []
    const detailTables = [...drawer.querySelectorAll('table')]
    const drawerReason = extractDrawerReason(drawer)
    const detailBaseRow = { ...baseRow }
    delete detailBaseRow.操作
    const summary = {
      ...detailBaseRow,
      限制解除条件: extractDrawerField(drawer, '限制解除条件'),
      限制金额说明: !isPlaceholderText(drawerReason) ? drawerReason : baseRow.限制金额说明 || '',
      区域限制金额明细: extractRegionalAmountSummary(drawer),
    }

    detailTables.forEach(table => {
      const headers = [...table.querySelectorAll('thead th, th')]
        .map(cell => textOf(cell))
        .filter(Boolean)
      const bodyRows = [...table.querySelectorAll('tbody tr, tr')]
        .filter(row => row.querySelector('td'))
      bodyRows.forEach((row, index) => {
        const detail = {
          __sheet_name: '详情',
          ...summary,
          明细序号: index + 1,
          明细分组: findNearestSectionTitle(table, drawer) || '限制详细信息',
        }
        const cells = [...row.querySelectorAll('td')]
        cells.forEach((cell, cellIndex) => {
          const key = headers[cellIndex] || `明细列${cellIndex + 1}`
          detail[key === '地区' ? '地区明细' : key] = textOf(cell)
        })
        rows.push(detail)
      })
    })

    if (!rows.length) {
      rows.push({
        __sheet_name: '详情',
        ...summary,
        明细分组: '限制详细信息',
        明细序号: 1,
      })
    }

    return rows
  }

  async function collectCurrentPage() {
    const region = getResolvedRegion()
    const pageNo = getActivePage()
    const scrapedAt = localNow()
    const headers = getTableHeaders()
    const rows = getTableRows()
    const results = []

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const cells = [...row.querySelectorAll('td')]
      const baseRow = {
        地区: region,
        列表页码: pageNo,
        抓取时间: scrapedAt,
        列表行号: index + 1,
      }
      cells.forEach((cell, cellIndex) => {
        const key = headers[cellIndex] || `列${cellIndex + 1}`
        baseRow[key] = textOf(cell)
      })
      baseRow.限制原因 = baseRow.限制原因 || ''
      baseRow.当前限制总金额 = baseRow['当前限制总金额(CNY)'] || baseRow.当前限制总金额 || ''
      baseRow.限制金额说明 = baseRow.限制金额说明 || ''
      results.push({
        __sheet_name: '列表',
        ...baseRow,
      })

      const action = findRowDetailAction(row)
      if (!action) {
        continue
      }

      clickLike(action)
      const opened = await waitForDrawer(8000)
      if (!opened) {
        results.push({
          __sheet_name: '详情',
          ...baseRow,
          明细分组: '错误',
          明细序号: 1,
          错误信息: '限制详情抽屉未打开',
        })
        continue
      }
      scrapeDrawerDetails(baseRow).forEach(item => results.push(item))
      const closed = await closeDrawer()
      if (!closed) {
        results.push({
          __sheet_name: '详情',
          ...baseRow,
          明细分组: '错误',
          明细序号: 999,
          错误信息: '限制详情抽屉未关闭',
        })
        break
      }
      await sleep(250)
    }

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
      if (!location.href.includes('/labor/limited/list')) {
        location.href = TARGET_URL
        return nextPhase('ensure_target', mode === 'new' ? 2200 : 1500)
      }
      const ready = await waitForTable(15000)
      if (!ready) return fail('资金限制页面未加载完成，请确认已登录并能打开列表')
      const { available, target } = buildTargetRegions()
      if (!target.length) return fail('当前账号下没有可抓取的资金限制地区')
      const currentRegion = getResolvedRegion() || target[0]
      if (currentRegion !== target[0]) {
        const targetUrl = getRegionUrl(target[0])
        if (targetUrl) {
          location.href = targetUrl
          return nextPhase('wait_region_ready', 2200, {
            availableRegions: available,
            targetRegions: target,
            targetRegion: target[0],
          })
        }
        return fail(`切换资金限制地区失败：${target[0]}`)
      }
      const firstPageReady = await ensureFirstPage(15000)
      if (!firstPageReady) return fail('资金限制列表无法回到第一页')
      return nextPhase('collect', 200, {
        availableRegions: available,
        targetRegions: target,
        targetRegion: currentRegion,
      })
    }

    if (phase === 'wait_region_ready') {
      const targetRegion = String(shared.targetRegion || '').trim()
      const ready = await waitForTable(15000)
      if (!ready && !hasRegionInfoBanner()) return fail(`资金限制页面切换地区后未加载完成：${targetRegion || '未知'}`)
      if (targetRegion) {
        const expectedHost = getExpectedHostRegion(targetRegion)
        const ok = await waitFor(() => {
          if (getResolvedRegion() === targetRegion) return true
          return expectedHost && String(location.hostname || '') === expectedHost
        }, 12000, 300)
        if (!ok) return fail(`资金限制地区切换未生效：${targetRegion}`)
      }
      const firstPageReady = await ensureFirstPage(15000)
      if (!firstPageReady && !hasRegionInfoBanner()) return fail(`资金限制页面无法回到第一页：${targetRegion || '未知'}`)
      return nextPhase('collect', 200, {
        availableRegions: shared.availableRegions || [],
        targetRegions: shared.targetRegions || [],
        targetRegion,
        forceEmptyRegion: !ready,
      })
    }

    if (phase === 'collect') {
      const ready = shared.forceEmptyRegion ? false : await waitForTable(12000)
      if (!ready && !shared.forceEmptyRegion) return fail('资金限制列表加载超时')
      const data = ready ? await collectCurrentPage() : []
      const currentRegion = getResolvedRegion()
      const currentPageNo = ready ? getActivePage() : 1
      const rowsOnPage = ready ? getTableRows().length : 0
      const targetRegions = Array.isArray(shared.targetRegions) ? shared.targetRegions : []
      const regionIndex = Math.max(0, targetRegions.indexOf(currentRegion))
      const scopePageSize = String(shared.currentScopeKey || '') === currentRegion
        ? Math.max(1, Number(shared.currentScopePageSize || 0) || rowsOnPage || DEFAULT_PAGE_SIZE)
        : Math.max(1, rowsOnPage || DEFAULT_PAGE_SIZE)
      const totalCount = ready ? parseTotalCount(getTotalText()) : 0
      const totalPages = totalCount > 0 ? Math.max(1, Math.ceil(totalCount / scopePageSize)) : (rowsOnPage > 0 ? 1 : 0)
      return complete(data, true, {
        ...shared,
        currentRegion,
        currentPageNo,
        currentScopeKey: currentRegion,
        currentScopePageSize: scopePageSize,
        currentScopeTotalPages: totalPages,
        total_rows: totalPages,
        current_exec_no: currentPageNo,
        current_row_no: rowsOnPage,
        batch_no: regionIndex + 1,
        total_batches: Math.max(1, targetRegions.length || 1),
        current_store: currentRegion,
        forceEmptyRegion: false,
      })
    }

    if (phase === 'advance_scope') {
      const ready = await waitForTable(12000)
      if (!ready) return fail('资金限制列表加载超时')
      const targetRegions = Array.isArray(shared.targetRegions) ? shared.targetRegions : buildTargetRegions().target
      if (!targetRegions.length) return fail('当前账号下没有可抓取的资金限制地区')
      const currentRegion = getResolvedRegion() || targetRegions[0]

      if (getNextPager()) {
        const paged = await advancePager()
        if (!paged) return fail(`资金限制列表翻页失败：${currentRegion}`)
        return nextPhase('collect', 200, {
          ...shared,
          currentRegion,
          currentPageNo: getActivePage(),
          currentScopeKey: currentRegion,
        })
      }

      const currentIndex = targetRegions.indexOf(currentRegion)
      const nextRegion = currentIndex >= 0 ? targetRegions[currentIndex + 1] : ''
      if (!nextRegion) {
        return complete([], false, {
          ...shared,
          currentRegion,
          currentPageNo: getActivePage(),
        })
      }

      const targetUrl = getRegionUrl(nextRegion)
      if (!targetUrl) return fail(`资金限制地区切换失败：${nextRegion}`)
      location.href = targetUrl
      return nextPhase('wait_region_ready', 2200, {
        ...shared,
        targetRegion: nextRegion,
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
