;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = Number(window.__CRAWSHRIMP_PAGE__ || 1)
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const TARGET_URL = 'https://agentseller.temu.com/goods/recommended-retail-price'
  const CANONICAL_REGIONS = ['全球', '美国', '欧区']
  const STATUS_PREFIXES = ['待填写', '待修改', '待确认', '已提交']
  const REGION_BLACKLIST = new Set(['商家中心'])
  const SEEN_ROW_KEY = '__CRAWSHRIMP_TEMU_RECOMMENDED_PRICE_SEEN__'
  const LIST_API_PAGE_SIZE = 20
  const LIST_API_REQUEST_TIMEOUT_MS = 25000
  const LIST_API_RETRY_LIMIT = 2
  const LIST_API_RETRY_BACKOFF_MS = 1500
  const TEMU_ANTI_CONTENT_MODULE_ID = '65531'
  const TEMU_LIST_ENDPOINT = '/visage-agent-seller/product/sku/site/suggestedPrice/pageQuery'

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

  function hasNoRegionAccess() {
    return /该区暂无权限/.test(textOf(document.body))
  }

  function hasRegionAuthenticationGate() {
    const href = String(location.href || '')
    const bodyText = textOf(document.body)
    return href.includes('/main/authentication') || /其他地区|敬请期待/.test(bodyText)
  }

  function getNextTargetRegion(targetRegions, currentRegion) {
    const regions = Array.isArray(targetRegions) ? targetRegions : []
    const index = regions.indexOf(currentRegion)
    return index >= 0 ? regions[index + 1] : ''
  }

  function skipBlockedRegion(next = shared) {
    const currentRegion = getResolvedRegion() || String(next.targetRegion || '').trim()
    const targetRegions = Array.isArray(next.targetRegions) ? next.targetRegions : []
    const nextRegion = getNextTargetRegion(targetRegions, currentRegion)
    if (!nextRegion) {
      return complete([], false, {
        ...next,
        currentRegion,
      })
    }
    const targetUrl = getRegionUrl(nextRegion)
    if (!targetUrl) return fail(`建议零售价地区切换失败：${nextRegion}`)
    location.href = targetUrl
    return nextPhase('wait_region_ready', 2200, {
      ...next,
      targetRegion: nextRegion,
    })
  }

  function getStatusNodes() {
    const primary = [...document.querySelectorAll('[data-testid="beast-core-tab-itemLabel-wrapper"]')]
      .filter(isVisible)
      .filter(node => STATUS_PREFIXES.some(prefix => textOf(node).startsWith(prefix)))
    if (primary.length) return primary
    return [...document.querySelectorAll('[class*="TAB_tabItem_"], [class*="TAB_line_"], div')]
      .filter(isVisible)
      .filter(node => STATUS_PREFIXES.some(prefix => textOf(node).startsWith(prefix)))
      .filter(node => /TAB_|tab/i.test(String(node.className || '')) || node.getAttribute?.('data-testid'))
  }

  function getActiveStatus() {
    const node = getStatusNodes().find(item => hasClassFragment(item, 'TAB_active_'))
    const value = textOf(node)
    return STATUS_PREFIXES.find(prefix => value.startsWith(prefix)) || STATUS_PREFIXES[0]
  }

  function getStatusNode(statusText) {
    return getStatusNodes().find(node => textOf(node).startsWith(statusText)) || null
  }

  function getStatusCodeByText(statusText) {
    const index = STATUS_PREFIXES.findIndex(item => item === String(statusText || '').trim())
    return index >= 0 ? index + 1 : 1
  }

  function getScopeProgress(region, status, targetRegions, targetStatuses) {
    const regions = Array.isArray(targetRegions) && targetRegions.length ? targetRegions : [region].filter(Boolean)
    const statuses = Array.isArray(targetStatuses) && targetStatuses.length ? targetStatuses : STATUS_PREFIXES.slice()
    const regionIndex = Math.max(0, regions.indexOf(region))
    const statusIndex = Math.max(0, statuses.indexOf(status))
    return {
      batch_no: regionIndex * statuses.length + statusIndex + 1,
      total_batches: Math.max(1, regions.length * statuses.length),
      current_store: [region, status].filter(Boolean).join(' / '),
    }
  }

  async function switchStatus(statusText) {
    const node = getStatusNode(statusText)
    if (!node) return false
    if (getActiveStatus() === statusText) return true
    const oldTotal = textOf(document.querySelector('li[class*="PGT_totalText_"], [data-testid="beast-core-pagination"]')).slice(0, 80)
    const oldFirst = textOf(getTableRows()[0] || null)
    clickLike(node)
    const changed = await waitFor(() => {
      if (getActiveStatus() !== statusText) return false
      const newTotal = textOf(document.querySelector('li[class*="PGT_totalText_"], [data-testid="beast-core-pagination"]')).slice(0, 80)
      const newFirst = textOf(getTableRows()[0] || null)
      return newTotal !== oldTotal || newFirst !== oldFirst || !getTableRows().length
    }, 12000, 300)
    if (!changed) return false
    await waitForTable(12000)
    await sleep(300)
    return true
  }

  function getTableParts() {
    const tables = [...document.querySelectorAll('table[class*="TB_tableWrapper_"], table')]
      .filter(isVisible)
    const headerTable = tables.find(table =>
      table.querySelectorAll('thead th').length > 0 &&
      table.querySelectorAll('tbody tr td').length === 0,
    ) || tables.find(table => table.querySelectorAll('thead th').length > 0) || null
    const bodyTable = tables
      .filter(table => table.querySelectorAll('tbody tr td').length > 0)
      .sort((left, right) =>
        right.querySelectorAll('tbody tr td').length - left.querySelectorAll('tbody tr td').length,
      )[0] || null
    return {
      headerTable: headerTable || bodyTable,
      bodyTable: bodyTable || headerTable,
    }
  }

  function getTableRows() {
    const { bodyTable: table } = getTableParts()
    if (!table) return []
    return [...table.querySelectorAll('tbody tr')]
      .filter(row => row.querySelector('td'))
  }

  function buildTableHeaders(table) {
    if (!table) return []
    const headRows = [...table.querySelectorAll('thead tr')]
    const grid = []
    let maxCols = 0

    headRows.forEach((row, rowIndex) => {
      grid[rowIndex] = grid[rowIndex] || []
      let colIndex = 0
      const cells = [...row.querySelectorAll('th')]
      cells.forEach(cell => {
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
        nextCarry.forEach((item, index) => {
          carry[index] = item
        })

        const values = {}
        headers.forEach((header, index) => {
          if (!header) return
          values[header] = expanded[index] ? textOf(expanded[index]) : ''
        })
        return {
          row,
          expanded,
          values,
        }
      })
  }

  function getPageSignature() {
    const rows = getTableRows()
    const total = textOf(document.querySelector('li[class*="PGT_totalText_"], [data-testid="beast-core-pagination"]')).slice(0, 80)
    const first = rows[0] ? textOf(rows[0]).slice(0, 160) : 'empty'
    const last = rows[rows.length - 1] ? textOf(rows[rows.length - 1]).slice(0, 160) : 'empty'
    return `${getResolvedRegion()}::${getActiveStatus()}::${getActivePage()}::${rows.length}::${total}::${first}::${last}`
  }

  async function waitForTable(timeout = 15000) {
    return await waitFor(() => {
      if (getTableRows().length) return true
      return /暂无数据|该区暂无权限/.test(textOf(document.body))
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
        row.地区,
        row.状态标签,
        row['Goods ID'],
        row['SKC ID'],
        row['SKU ID'],
        row.SKU属性,
      ].map(item => String(item || '').trim()).join('\u001f')
      if (seen[key]) continue
      seen[key] = 1
      results.push(row)
    }
    return results
  }

  function parseCookieValue(name) {
    const escaped = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = String(document.cookie || '').match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`))
    return match ? decodeURIComponent(match[1]) : ''
  }

  function getMallId() {
    return parseCookieValue('mallid')
  }

  function getTemuWebpackRequire() {
    if (window.__CRAWSHRIMP_TEMU_WEBPACK_REQUIRE__) return window.__CRAWSHRIMP_TEMU_WEBPACK_REQUIRE__
    const chunk = window.chunkLoadingGlobal_bgb_sca_main
      || window.chunkLoadingGlobal_temu_sca_goods
      || window.webpackChunktemu_sca_container
    if (!chunk || typeof chunk.push !== 'function') return null
    try {
      chunk.push([[`crawshrimp_temu_${Date.now()}`], {}, req => {
        window.__CRAWSHRIMP_TEMU_WEBPACK_REQUIRE__ = req
      }])
    } catch (e) {}
    return window.__CRAWSHRIMP_TEMU_WEBPACK_REQUIRE__ || null
  }

  async function getTemuAntiContent() {
    const req = getTemuWebpackRequire()
    if (!req) {
      throw new Error('未找到 Temu 页面运行时，无法生成 Anti-Content')
    }
    const antiModule = req(TEMU_ANTI_CONTENT_MODULE_ID)
    if (!antiModule || typeof antiModule.cN !== 'function') {
      throw new Error('未找到 Temu Anti-Content 模块，无法请求建议零售价列表 API')
    }
    return await antiModule.cN()
  }

  async function fetchJsonWithTimeout(url, options = {}, timeoutMs = LIST_API_REQUEST_TIMEOUT_MS) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    let timeoutTriggered = false
    let timer = null
    if (controller) {
      timer = setTimeout(() => {
        timeoutTriggered = true
        controller.abort()
      }, timeoutMs)
    }
    try {
      const response = await fetch(url, {
        ...(options || {}),
        ...(controller ? { signal: controller.signal } : {}),
      })
      const result = await response.json()
      return { response, result }
    } catch (error) {
      if (timeoutTriggered) {
        throw new Error(`建议零售价列表 API 请求超时（>${Math.round(timeoutMs / 1000)} 秒）`)
      }
      throw error
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async function callSuggestedPriceApi(statusCode, pageNo, pageSize = LIST_API_PAGE_SIZE) {
    let lastError = null
    for (let attempt = 1; attempt <= LIST_API_RETRY_LIMIT; attempt += 1) {
      try {
        const antiContent = await getTemuAntiContent()
        const mallId = getMallId()
        const { response, result } = await fetchJsonWithTimeout(TEMU_LIST_ENDPOINT, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            'Anti-Content': antiContent,
            ...(mallId ? { mallid: mallId } : {}),
          },
          body: JSON.stringify({
            pageSize,
            page: pageNo,
            status: statusCode,
          }),
        }, LIST_API_REQUEST_TIMEOUT_MS)
        if (!response.ok) {
          throw new Error(`建议零售价列表 API 请求失败：HTTP ${response.status}`)
        }
        if (!result?.success) {
          throw new Error(result?.errorMsg || '建议零售价列表 API 返回失败')
        }
        return result.result || {}
      } catch (error) {
        lastError = error
        if (attempt >= LIST_API_RETRY_LIMIT) break
        await sleep(LIST_API_RETRY_BACKOFF_MS * attempt)
      }
    }
    throw lastError || new Error('建议零售价列表 API 请求失败')
  }

  function getAmountValue(value) {
    if (value == null) return null
    if (typeof value === 'object') {
      if (value.amount == null) return null
      const amount = Number(value.amount)
      return Number.isFinite(amount) ? amount : null
    }
    const amount = Number(value)
    return Number.isFinite(amount) ? amount : null
  }

  function getCurrencyCode(sku = {}) {
    return String(
      sku?.supplierCurrency
      || sku?.priceLowerLimit?.currency
      || sku?.priceUpperLimit?.currency
      || sku?.suggestedPriceLowerLimit?.currency
      || sku?.suggestedPriceUpperLimit?.currency
      || 'CNY',
    ).trim().toUpperCase()
  }

  function getCurrencyLabel(currencyCode) {
    if (currencyCode === 'CNY') return '人民币元'
    return currencyCode || ''
  }

  function getCurrencyUnit(currencyCode) {
    if (currencyCode === 'CNY') return '元'
    return currencyCode ? ` ${currencyCode}` : ''
  }

  function formatPriceNumber(value) {
    const amount = getAmountValue(value)
    if (!Number.isFinite(amount)) return ''
    return (amount / 100).toFixed(2)
  }

  function formatPriceRange(lowerValue, upperValue, currencyCode) {
    const lower = formatPriceNumber(lowerValue)
    const upper = formatPriceNumber(upperValue)
    if (!lower && !upper) return ''
    const left = lower || upper
    const right = upper || lower
    const unit = getCurrencyUnit(currencyCode)
    return `${left}${unit} ~ ${right}${unit}`
  }

  function buildGoodsInfoText(item = {}) {
    const name = String(item.productName || '').trim()
    const goodsId = item.productId == null ? '' : String(item.productId)
    const skcId = item.productSkcId == null ? '' : String(item.productSkcId)
    return [name, goodsId ? `Goods ID：${goodsId}` : '', skcId ? `SKC ID：${skcId}` : '']
      .filter(Boolean)
      .join(' ')
      .trim()
  }

  function buildSkuInfoText(sku = {}) {
    const spec = String(sku.skuSpec || '').trim()
    const skuId = sku.productSkuId == null ? '' : String(sku.productSkuId)
    return [spec, skuId ? `SKU ID：${skuId}` : '']
      .filter(Boolean)
      .join(' ')
      .trim()
  }

  function buildSuggestedCellText(row = {}) {
    const hasMeaningfulValue = Boolean(
      row.建议零售价
      || row.建议零售价范围
      || row.同款品数
      || row.建议零售价操作
      || row.建议零售价明细 === '是',
    )
    if (!hasMeaningfulValue) return ''
    const parts = []
    if (row.建议零售价) parts.push(row.建议零售价)
    if (row.建议零售价币种) parts.push(row.建议零售价币种)
    if (row.建议零售价范围) parts.push(row.建议零售价范围)
    if (row.同款品数) parts.push(`${row.同款品数}个`)
    if (row.建议零售价明细 === '是') parts.push('明细')
    if (row.建议零售价操作) parts.push(row.建议零售价操作)
    return parts.join(' ').trim()
  }

  function buildRawRowText(row = {}) {
    return [
      row.商品SKC信息,
      row.SKU信息,
      row.日常价格范围,
      row.同款品市场价参考,
      row.建议零售价单元格文本,
    ].filter(Boolean).join(' ').trim()
  }

  async function collectCurrentPage() {
    const region = getResolvedRegion()
    const status = String(shared.currentStatus || getActiveStatus() || STATUS_PREFIXES[0]).trim() || STATUS_PREFIXES[0]
    const statusCode = Number(shared.currentStatusCode || getStatusCodeByText(status) || 1)
    const pageNo = Math.max(1, Number(shared.currentPageNo || 1))
    const scrapedAt = localNow()
    const apiResult = await callSuggestedPriceApi(statusCode, pageNo, LIST_API_PAGE_SIZE)
    const pageItems = Array.isArray(apiResult.pageItems) ? apiResult.pageItems : []
    const results = []
    let rowNo = 0

    pageItems.forEach(item => {
      const skuList = Array.isArray(item?.skuList) ? item.skuList : []
      skuList.forEach(sku => {
        rowNo += 1
        const currencyCode = getCurrencyCode(sku)
        const suggestedLower = getAmountValue(sku?.suggestedPriceLowerLimit)
        const suggestedUpper = getAmountValue(sku?.suggestedPriceUpperLimit)
        const submitLower = getAmountValue(sku?.submitPriceLowerLimit)
        const submitUpper = getAmountValue(sku?.submitPriceUpperLimit)
        const chosenLower = submitLower != null ? submitLower : suggestedLower
        const chosenUpper = submitUpper != null ? submitUpper : suggestedUpper
        const hasSuggestedValue = chosenLower != null || chosenUpper != null
        const siteCount = Array.isArray(sku?.siteIdList) ? sku.siteIdList.length : 0
        const row = {
          地区: region,
          状态标签: status,
          列表页码: pageNo,
          抓取时间: scrapedAt,
          列表行号: rowNo,
          商品名称: String(item?.productName || '').trim(),
          'Goods ID': item?.productId == null ? '' : String(item.productId),
          'SKC ID': item?.productSkcId == null ? '' : String(item.productSkcId),
          商品SKC信息: buildGoodsInfoText(item),
          SKU属性: String(sku?.skuSpec || '').trim(),
          'SKU ID': sku?.productSkuId == null ? '' : String(sku.productSkuId),
          SKU信息: buildSkuInfoText(sku),
          日常价格范围: formatPriceRange(sku?.priceLowerLimit, sku?.priceUpperLimit, currencyCode),
          同款品市场价参考: formatPriceRange(
            sku?.similarSuggestedPriceLowerLimit,
            sku?.similarSuggestedPriceUpperLimit,
            currencyCode,
          ),
          站点: '',
          建议零售价: formatPriceNumber(chosenLower),
          建议零售价币种: getCurrencyLabel(currencyCode),
          建议零售价范围: formatPriceRange(chosenLower, chosenUpper, currencyCode),
          同款品数: hasSuggestedValue && siteCount > 0 ? String(siteCount) : '',
          建议零售价明细: hasSuggestedValue ? '是' : '否',
          建议零售价操作: hasSuggestedValue ? '查看明细' : '',
        }
        row.建议零售价单元格文本 = buildSuggestedCellText(row)
        row.原始行文本 = buildRawRowText(row)
        results.push(row)
      })
    })

    return {
      rows: dedupeRows(results),
      total: Math.max(0, Number(apiResult.total || 0)),
    }
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
      if (!location.href.includes('/goods/recommended-retail-price')) {
        location.href = TARGET_URL
        return nextPhase('ensure_target', mode === 'new' ? 2200 : 1500)
      }
      const ready = await waitForTable(30000)
      if (!ready) return fail('建议零售价页面未加载完成，请确认已登录并能打开列表')
      const { available, target } = buildTargetRegions()
      if (!target.length) return fail('当前账号下没有可抓取的建议零售价地区')
      const currentRegion = getResolvedRegion() || target[0]
      if (currentRegion !== target[0]) {
        const targetUrl = getRegionUrl(target[0])
        if (!targetUrl) return fail(`建议零售价地区切换失败：${target[0]}`)
        location.href = targetUrl
        return nextPhase('wait_region_ready', 2200, {
          availableRegions: available,
          targetRegions: target,
          targetRegion: target[0],
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
        const targetUrl = getRegionUrl(nextRegion)
        if (!targetUrl) return fail(`建议零售价地区切换失败：${nextRegion}`)
        location.href = targetUrl
        return nextPhase('wait_region_ready', 2200, {
          availableRegions: available,
          targetRegions: target,
          targetRegion: nextRegion,
        })
      }
      const firstPageReady = await ensureFirstPage(12000)
      if (!firstPageReady) return fail('建议零售价列表无法回到第一页')
      const firstStatusReady = await switchStatus(STATUS_PREFIXES[0])
      if (!firstStatusReady) return fail(`建议零售价状态切换失败：${STATUS_PREFIXES[0]}`)
      return nextPhase('collect', 200, {
        availableRegions: available,
        targetRegions: target,
        targetStatuses: STATUS_PREFIXES.slice(),
        currentRegion,
        currentStatus: STATUS_PREFIXES[0],
        currentStatusCode: getStatusCodeByText(STATUS_PREFIXES[0]),
        currentPageNo: 1,
        totalRows: 0,
        totalPages: 0,
      })
    }

    if (phase === 'wait_region_ready') {
      if (hasRegionAuthenticationGate()) {
        return skipBlockedRegion(shared)
      }
      const ready = await waitForTable(30000)
      if (!ready) {
        if (hasRegionAuthenticationGate()) return skipBlockedRegion(shared)
        return fail(`建议零售价页面切换地区后未加载完成：${shared.targetRegion || '未知'}`)
      }
      if (hasNoRegionAccess()) {
        return skipBlockedRegion(shared)
      }
      const firstPageReady = await ensureFirstPage(12000)
      if (!firstPageReady) return fail(`建议零售价列表无法回到第一页：${shared.targetRegion || '未知'}`)
      const firstStatusReady = await switchStatus(STATUS_PREFIXES[0])
      if (!firstStatusReady) return fail(`建议零售价状态切换失败：${STATUS_PREFIXES[0]}`)
      return nextPhase('collect', 200, {
        ...shared,
        currentRegion: getResolvedRegion(),
        currentStatus: STATUS_PREFIXES[0],
        currentStatusCode: getStatusCodeByText(STATUS_PREFIXES[0]),
        currentPageNo: 1,
        totalRows: 0,
        totalPages: 0,
      })
    }

    if (phase === 'collect') {
      const ready = await waitForTable(12000)
      if (!ready) return fail('建议零售价列表加载超时')
      const status = String(shared.currentStatus || getActiveStatus() || STATUS_PREFIXES[0]).trim() || STATUS_PREFIXES[0]
      const currentPageNo = Math.max(1, Number(shared.currentPageNo || 1))
      const { rows, total } = await collectCurrentPage()
      return complete(rows, true, {
        ...shared,
        currentRegion: getResolvedRegion(),
        currentStatus: status,
        currentStatusCode: Number(shared.currentStatusCode || getStatusCodeByText(status) || 1),
        currentPageNo,
        totalRows: total,
        totalPages: Math.max(0, Math.ceil(total / LIST_API_PAGE_SIZE)),
        total_rows: Math.max(0, Math.ceil(total / LIST_API_PAGE_SIZE)),
        current_exec_no: currentPageNo,
        current_row_no: rows.length,
        ...getScopeProgress(
          getResolvedRegion(),
          status,
          shared.targetRegions,
          shared.targetStatuses,
        ),
      })
    }

    if (phase === 'advance_scope') {
      const ready = await waitForTable(12000)
      if (!ready) return fail('建议零售价列表加载超时')
      const currentRegion = String(shared.currentRegion || getResolvedRegion() || '').trim()
      const currentStatus = String(shared.currentStatus || getActiveStatus() || STATUS_PREFIXES[0]).trim() || STATUS_PREFIXES[0]
      const currentStatusCode = Number(shared.currentStatusCode || getStatusCodeByText(currentStatus) || 1)
      const currentPageNo = Math.max(1, Number(shared.currentPageNo || 1))
      const totalPages = Math.max(0, Number(shared.totalPages || 0))

      if (currentPageNo < totalPages) {
        return nextPhase('collect', 200, {
          ...shared,
          currentRegion,
          currentStatus,
          currentStatusCode,
          currentPageNo: currentPageNo + 1,
        })
      }

      const targetStatuses = Array.isArray(shared.targetStatuses) ? shared.targetStatuses : STATUS_PREFIXES.slice()
      const statusIndex = targetStatuses.indexOf(currentStatus)
      const nextStatus = statusIndex >= 0 ? targetStatuses[statusIndex + 1] : ''
      if (nextStatus) {
        const switched = await switchStatus(nextStatus)
        if (!switched) return fail(`建议零售价状态切换失败：${nextStatus}`)
        return nextPhase('collect', 200, {
          ...shared,
          currentRegion,
          currentStatus: nextStatus,
          currentStatusCode: getStatusCodeByText(nextStatus),
          currentPageNo: 1,
          totalRows: 0,
          totalPages: 0,
        })
      }

      const targetRegions = Array.isArray(shared.targetRegions) ? shared.targetRegions : buildTargetRegions().target
      const regionIndex = targetRegions.indexOf(currentRegion)
      const nextRegion = regionIndex >= 0 ? targetRegions[regionIndex + 1] : ''
      if (!nextRegion) {
        return complete([], false, {
          ...shared,
          currentRegion,
          currentStatus,
          currentStatusCode,
          currentPageNo,
        })
      }
      const targetUrl = getRegionUrl(nextRegion)
      if (!targetUrl) return fail(`建议零售价地区切换失败：${nextRegion}`)
      location.href = targetUrl
      return nextPhase('wait_region_ready', 2200, {
        ...shared,
        targetRegion: nextRegion,
      })
    }

    return fail(`未知执行阶段：${phase}`)
  } catch (error) {
    return fail(error?.message || String(error))
  }
})()
