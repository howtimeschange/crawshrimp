;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = Number(window.__CRAWSHRIMP_PAGE__ || 1)
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const TARGET_URL = 'https://agentseller.temu.com/main/evaluate/evaluate-list'
  const OUTER_SITE_BLACKLIST = new Set(['商家中心'])
  const CANONICAL_OUTER_SITE_ORDER = ['全球', '美国', '欧区']
  const QUICK_TIME_RANGE_OPTIONS = ['近30天', '近60天', '近90天', '自定义']
  const SEEN_ROW_KEY = '__CRAWSHRIMP_TEMU_EVALUATE_LIST_SEEN__'

  const requestedShared = {
    requestedRegions: normalizeArray(shared.requestedRegions || params.regions),
    requestedReviewTimeRange: String(shared.requestedReviewTimeRange || params.review_time_range || '').trim(),
    requestedCustomReviewTimeRange: normalizeDateRangeParam(
      shared.requestedCustomReviewTimeRange || params.custom_review_time_range,
    ),
  }

  const mode = String(params.mode || 'current').trim().toLowerCase()

  function normalizeArray(value) {
    if (!Array.isArray(value)) return []
    return value.map(item => String(item || '').trim()).filter(Boolean)
  }

  function normalizeDateRangeParam(value) {
    if (!value || typeof value !== 'object') return {}
    const start = String(value.start || '').trim()
    const end = String(value.end || '').trim()
    if (!start || !end) return {}
    return { start, end }
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
      try {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
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
      delay_ms: delayMs,
    }
  }

  function setNativeInputValue(input, value) {
    if (!input) return false
    try { input.focus?.() } catch (e) {}
    const setter = window.HTMLInputElement
      ? Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      : null
    if (setter) setter.call(input, value)
    else input.value = value
    try { input.dispatchEvent(new Event('input', { bubbles: true })) } catch (e) {}
    try { input.dispatchEvent(new Event('change', { bubbles: true })) } catch (e) {}
    return true
  }

  function localNow() {
    const d = new Date()
    const pad = value => String(value).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
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
    const result = []
    for (const row of rows) {
      const key = [
        row.地区,
        row.商品名称,
        row.SPU,
        row.SKU,
        row.评价时间,
        row.评价内容,
      ].map(item => String(item || '').trim()).join('\u001f')
      if (!key.replace(/\u001f/g, '')) {
        result.push(row)
        continue
      }
      if (seen[key]) continue
      seen[key] = 1
      result.push(row)
    }
    return result
  }

  function waitFor(check, timeout = 8000, interval = 200) {
    const deadline = Date.now() + timeout
    return (async () => {
      while (Date.now() < deadline) {
        if (check()) return true
        await sleep(interval)
      }
      return false
    })()
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
    return textOf(
      getOuterSiteNodes().find(node => hasClassFragment(node, 'index-module__active___')) || null,
    )
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

  function buildTargetOuterSites() {
    const available = CANONICAL_OUTER_SITE_ORDER.filter(site =>
      getAvailableOuterSites().some(item => item.text === site),
    )
    const requested = requestedShared.requestedRegions.length
      ? requestedShared.requestedRegions.filter(item => available.includes(item))
      : available
    return {
      available,
      target: CANONICAL_OUTER_SITE_ORDER.filter(site => requested.includes(site)),
    }
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
      全球: 'agentseller.temu.com',
      美国: 'agentseller-us.temu.com',
      欧区: 'agentseller-eu.temu.com',
    }
    const host = hostMap[siteLabel]
    if (!host) return ''
    const url = new URL(TARGET_URL)
    url.hostname = host
    return url.toString()
  }

  function findMainButton(text) {
    return [...document.querySelectorAll('button')]
      .filter(isVisible)
      .find(btn => textOf(btn) === text) || null
  }

  function getFilterContainers() {
    return [
      ...document.querySelectorAll('div[class*="index-module__row___"]'),
      ...document.querySelectorAll('tr'),
      ...document.querySelectorAll('[class*="filter"], [class*="Filter"]'),
    ].filter(isVisible)
  }

  function getLabeledContainer(labelText) {
    const normalizedLabel = compact(labelText)
    for (const container of getFilterContainers()) {
      const labels = [...container.querySelectorAll('div, label, span, td, th')].filter(isVisible)
      if (labels.some(node => compact(textOf(node)) === normalizedLabel)) return container
    }
    return null
  }

  function getRangePickerInputByLabel(labelText) {
    const container = getLabeledContainer(labelText)
    if (!container) return null
    const rootCandidates = [
      ...container.querySelectorAll('[data-testid="beast-core-rangePicker-input"], [class*="RPR_inputWrapper_"]'),
      ...container.querySelectorAll('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]'),
    ]
    for (const node of rootCandidates) {
      if (!isVisible(node)) continue
      if (String(node.tagName || '').toUpperCase() === 'INPUT') return node
      const input = [...node.querySelectorAll('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]')]
        .find(isVisible)
      if (input) return input
    }
    return null
  }

  function getRangePickerRootByLabel(labelText) {
    const input = getRangePickerInputByLabel(labelText)
    return input?.closest?.('[data-testid="beast-core-rangePicker-input"]') ||
      input?.closest?.('[class*="RPR_inputWrapper_"]') ||
      input?.parentElement ||
      null
  }

  function getRangePickerReactPropsFromInput(input) {
    const roots = [
      input,
      input?.closest?.('[data-testid="beast-core-rangePicker-input"]') || null,
      input?.closest?.('[class*="RPR_inputWrapper_"]') || null,
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

  async function waitForRangePickerReactProps(labelText, timeout = 4000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const input = getRangePickerInputByLabel(labelText)
      const props = input ? getRangePickerReactPropsFromInput(input) : null
      if (input || props) return { input, props }
      await sleep(200)
    }
    return {
      input: getRangePickerInputByLabel(labelText),
      props: null,
    }
  }

  function readRangeValueByLabel(labelText) {
    return String(getRangePickerInputByLabel(labelText)?.value || '').trim()
  }

  async function injectRangeByLabel(labelText, startDate, endDate) {
    const start = new Date(`${startDate}T00:00:00`)
    const end = new Date(`${endDate}T00:00:00`)
    if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return false
    const expectedRange = `${startDate} ~ ${endDate}`
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { input, props } = await waitForRangePickerReactProps(labelText, 4000)
      if (props && typeof props.onChange === 'function') {
        try { props.onChange([start, end]) } catch (e) {}
      }
      let matched = await waitFor(() => readRangeValueByLabel(labelText) === expectedRange, 2500, 200)
      if (!matched && input) {
        setNativeInputValue(input, expectedRange)
        matched = await waitFor(() => readRangeValueByLabel(labelText) === expectedRange, 2000, 200)
      }
      if (matched) return true
      await sleep(300)
    }
    return false
  }

  function getQuickTimeOptionNodes() {
    return getReviewTimeCapsuleNodes()
      .filter(node => QUICK_TIME_RANGE_OPTIONS.includes(textOf(node)))
  }

  function getQuickTimeOption(optionText) {
    return getQuickTimeOptionNodes().find(node => textOf(node) === optionText) || null
  }

  function isOptionActive(node) {
    if (!node) return false
    const classText = String(node.className || '')
    const ariaSelected = String(node.getAttribute?.('aria-selected') || '').trim()
    const ariaChecked = String(node.getAttribute?.('aria-checked') || '').trim()
    return (
      /active|selected|checked|current/i.test(classText) ||
      ariaSelected === 'true' ||
      ariaChecked === 'true'
    )
  }

  function getActiveQuickTimeRange() {
    const active = getReviewTimeCapsuleNodes().find(isOptionActive)
    return textOf(active)
  }

  function getCustomRangeCapsuleNode() {
    return getReviewTimeCapsuleNodes().find(node => textOf(node) === '自定义') || null
  }

  function nodeContainsLabel(node, labelText) {
    if (!node || !labelText) return false
    if (textOf(node).includes(labelText)) return true
    const descendants = [
      ...node.querySelectorAll('div, label, span, td, th'),
      ...node.querySelectorAll('div, span, button, a, label'),
    ]
    return descendants.some(child => textOf(child).includes(labelText))
  }

  function getReviewTimeFieldNode() {
    const flatItem = [...document.querySelectorAll('[class*="flat-field_item__"]')]
      .find(node => nodeContainsLabel(node, '评价时间'))
    if (flatItem) return flatItem
    return getLabeledContainer('评价时间')
  }

  function getReviewTimeCapsuleNodes() {
    const field = getReviewTimeFieldNode()
    if (!field) return []

    const explicitCapsules = [...field.querySelectorAll('[class*="flat-field_capsule__"]')]
      .filter(isVisible)
      .filter(node => textOf(node))
    if (explicitCapsules.length) return explicitCapsules

    return [...field.querySelectorAll('div, span, button, a, label')]
      .filter(isVisible)
      .filter(node => textOf(node))
  }

  function getCustomRangeReactProps() {
    const candidates = [
      getCustomRangeCapsuleNode(),
      ...getReviewTimeCapsuleNodes(),
      ...document.querySelectorAll('[class*="flat-field_flat-range-picker__"]'),
      getReviewTimeFieldNode(),
      ...document.querySelectorAll('[class*="flat-field_item__"]'),
    ].filter(Boolean)

    for (const node of candidates) {
      const fiberKey = Object.keys(node).find(key => key.startsWith('__reactFiber')) || ''
      let fiber = fiberKey ? node[fiberKey] : null
      while (fiber) {
        const props = fiber.memoizedProps || null
        if (
          props &&
          typeof props.onChange === 'function' &&
          (
            Array.isArray(props.selectedDate) ||
            Array.isArray(props.pickerRange) ||
            typeof props.inputValue === 'string'
          )
        ) {
          return props
        }
        fiber = fiber.return
      }
    }
    return null
  }

  async function injectCustomReviewTimeRange(startDate, endDate) {
    const props = getCustomRangeReactProps()
    if (!props || typeof props.onChange !== 'function') return false

    const start = new Date(`${startDate}T00:00:00+08:00`)
    const end = new Date(`${endDate}T23:59:59+08:00`)
    if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return false

    const expected = `${startDate} ~ ${endDate}`
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        props.onChange([start, end])
      } catch (error) {
        return false
      }
      const matched = await waitFor(() => getActiveQuickTimeRange() === expected, 4000, 200)
      if (matched) return true
      await sleep(300)
    }

    return false
  }

  function getResolvedReviewTimeScope() {
    const requested = requestedShared.requestedReviewTimeRange
    if (requested === '自定义') {
      const range = requestedShared.requestedCustomReviewTimeRange
      if (range.start && range.end) return `${range.start} ~ ${range.end}`
    }
    return requested || getActiveQuickTimeRange() || readRangeValueByLabel('评价时间') || '当前页面'
  }

  async function waitForTargetReady(timeout = 20000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const hasRegions = getAvailableOuterSites().length > 0
      const body = textOf(document.body)
      const hasFilters = /商品评价/.test(body) && /评价时间/.test(body)
      const hasButtons = !!findMainButton('查询')
      const hasTable = !!getMainListTable() || !!getMainListHeaderTable()
      if (hasRegions && hasFilters && hasButtons && hasTable) return true
      await sleep(400)
    }
    return false
  }

  function getVisibleMainListTables() {
    return [...document.querySelectorAll('table')].filter(isVisible)
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
      .reduce((total, row) => total + [...row.children].filter(cell => /^(TH|TD)$/i.test(cell.tagName)).length, 0)
  }

  function getMainListTable() {
    const candidates = getVisibleMainListTables()
      .map(table => ({
        table,
        rowCount: countTableBodyRows(table),
        score: countTableBodyRows(table) + (/商品信息|评价时间|审核状态|申诉/.test(textOf(table)) ? 1000 : 0),
      }))
      .filter(item => item.rowCount > 0)
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
        const aScore = a.headerCount + (/商品信息|SKU属性|评价星级|评价信息|评价时间|审核状态/.test(a.text) ? 1000 : 0)
        const bScore = b.headerCount + (/商品信息|SKU属性|评价星级|评价信息|评价时间|审核状态/.test(b.text) ? 1000 : 0)
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

  function getListPageNo() {
    const active = document.querySelector('li[class*="PGT_pagerItemActive_"], li[aria-current="page"]')
    const value = parseInt(textOf(active), 10)
    return Number.isFinite(value) && value > 0 ? value : 1
  }

  function hasNextListPage() {
    const next = document.querySelector('li[class*="PGT_next_"]')
    return !!(next && !hasClassFragment(next, 'PGT_disabled_'))
  }

  function hasPrevListPage() {
    const prev = document.querySelector('li[class*="PGT_prev_"]')
    return !!(prev && !hasClassFragment(prev, 'PGT_disabled_'))
  }

  function clickNextListPage() {
    const next = document.querySelector('li[class*="PGT_next_"]')
    if (!next || hasClassFragment(next, 'PGT_disabled_')) return false
    return clickLike(next)
  }

  function clickPrevListPage() {
    const prev = document.querySelector('li[class*="PGT_prev_"]')
    if (!prev || hasClassFragment(prev, 'PGT_disabled_')) return false
    return clickLike(prev)
  }

  function getListPageSignature() {
    const rows = getMainListRows()
    if (!rows.length) return `empty:${compact(textOf(document.body)).slice(0, 200)}`
    const samples = rows.slice(0, 2).concat(rows.slice(-2)).map(row => compact(textOf(row)).slice(0, 120))
    return `p:${getListPageNo()}::${samples.join('|')}`
  }

  async function waitForListReady(timeout = 15000) {
    const deadline = Date.now() + timeout
    let emptySince = 0
    while (Date.now() < deadline) {
      const rows = getMainListRows()
      const empty = !!document.querySelector('[class*="TB_empty_"]') || /暂无数据|无数据/.test(textOf(document.body))
      if (rows.length > 0) {
        return { ready: true, rows, empty: false }
      }
      if (empty) {
        if (!emptySince) emptySince = Date.now()
        if (Date.now() - emptySince >= 1200) {
          return { ready: true, rows, empty: true }
        }
      } else {
        emptySince = 0
      }
      await sleep(400)
    }
    return { ready: false, rows: getMainListRows(), empty: false }
  }

  async function waitListPageChange(oldSignature, oldPageNo = 0, timeout = 10000, requirePageNoChange = false) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const currentPageNo = getListPageNo()
      const signature = getListPageSignature()
      if (
        signature &&
        signature !== oldSignature &&
        (!requirePageNoChange || !oldPageNo || currentPageNo !== oldPageNo)
      ) {
        await sleep(250)
        return true
      }
      await sleep(300)
    }
    return false
  }

  async function ensureFirstListPage(timeout = 30000) {
    const deadline = Date.now() + timeout
    let guard = 0
    while (Date.now() < deadline && guard < 30) {
      guard += 1
      const currentPageNo = getListPageNo()
      if (currentPageNo <= 1) return true
      if (!hasPrevListPage()) return false
      const oldSig = getListPageSignature()
      const oldPage = currentPageNo
      clickPrevListPage()
      const changed = await waitListPageChange(oldSig, oldPage, 10000, true)
      if (!changed) return false
      const ready = await waitForListReady(12000)
      if (!ready.ready) return false
    }
    return getListPageNo() <= 1
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
        const colspan = parseInt(cell.getAttribute?.('colspan') || '1', 10) || 1
        const rowspan = parseInt(cell.getAttribute?.('rowspan') || '1', 10) || 1
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
    const headers = []
    const used = Object.create(null)
    for (let col = 0; col < maxCols; col += 1) {
      const path = []
      for (let row = 0; row < grid.length; row += 1) {
        const label = String(grid[row]?.[col] || '').trim()
        if (!label) continue
        if (path[path.length - 1] !== label) path.push(label)
      }
      let header = path.filter(Boolean).join('/')
      if (!header) header = `列${col + 1}`
      const count = used[header] || 0
      used[header] = count + 1
      if (count > 0) header = `${header}_${count + 1}`
      headers.push(header)
    }
    return headers
  }

  function parseKeyValueLine(lines, key) {
    const direct = lines.find(line => line.startsWith(`${key}：`) || line.startsWith(`${key}:`))
    if (direct) return direct.replace(new RegExp(`^${key}[：:]\\s*`), '').trim()
    const index = lines.findIndex(line => line === `${key}：` || line === `${key}:`)
    if (index >= 0) return String(lines[index + 1] || '').trim()
    return ''
  }

  function getCellLines(cell) {
    return String(cell?.innerText || cell?.textContent || '')
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
  }

  function collectImageUrls(root) {
    const urls = []
    const pushUrl = value => {
      const url = String(value || '').trim()
      if (!url) return
      if (urls.includes(url)) return
      urls.push(url)
    }

    for (const img of root.querySelectorAll('img')) {
      pushUrl(img.getAttribute?.('src') || img.src || '')
    }

    for (const el of root.querySelectorAll('*')) {
      const style = String(el.getAttribute?.('style') || '')
      const match = style.match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i)
      if (match?.[2]) pushUrl(match[2])
    }

    return urls
  }

  function parseGoodsCell(cell) {
    const lines = getCellLines(cell)
    const productName = lines.find(line =>
      line &&
      !/^共\d+张$/.test(line) &&
      !/^类目[：:]/.test(line) &&
      !/^(SPU|SKC)[：:]?$/.test(line) &&
      !/^(在售|停售)$/.test(line),
    ) || ''
    return {
      productName,
      category: parseKeyValueLine(lines, '类目'),
      spu: parseKeyValueLine(lines, 'SPU'),
      skc: parseKeyValueLine(lines, 'SKC'),
      saleStatus: lines.find(line => /^(在售|停售)$/.test(line)) || '',
      productImages: collectImageUrls(cell).join('\n'),
    }
  }

  function parseSkuCell(cell) {
    const lines = getCellLines(cell)
    return {
      skuAttr: lines.find(line => !/^(SKU)[：:]?$/.test(line) && !/^SKU[：:]/.test(line)) || '',
      sku: parseKeyValueLine(lines, 'SKU'),
    }
  }

  function parseRatingCell(cell) {
    const text = textOf(cell)
    const starMatch = text.match(/([1-5](?:\.\d+)?)\s*分/) || text.match(/([1-5])\s*星/)
    return {
      ratingText: text,
      star: starMatch ? starMatch[1] : '',
    }
  }

  function parseReviewInfoCell(cell) {
    const lines = getCellLines(cell)
    const rawText = lines.join('\n')
    const fitMatch = lines.find(line => /^合身情况[：:]/.test(line))
    const unfitMatch = lines.find(line => /^不合身原因[：:]/.test(line))
    const reviewText = lines
      .filter(line => !/^合身情况[：:]/.test(line))
      .filter(line => !/^不合身原因[：:]/.test(line))
      .join('\n')
    return {
      reviewText,
      fit: fitMatch ? fitMatch.replace(/^合身情况[：:]\s*/, '').trim() : '',
      unfitReason: unfitMatch ? unfitMatch.replace(/^不合身原因[：:]\s*/, '').trim() : '',
      reviewImages: collectImageUrls(cell).join('\n'),
    }
  }

  function scrapeCurrentPage(outerSite, reviewTimeScope) {
    const table = getMainListTable()
    const headers = getTableHeaders(getMainListHeaderTable() || table)
    const rows = getMainListRows()
    const collectedAt = localNow()
    const pageNo = getListPageNo()
    const results = []

    rows.forEach((row, rowIndex) => {
      const cells = [...row.querySelectorAll('td[class*="TB_td_"], td')].filter(td => isVisible(td))
      if (!cells.length) return
      const record = {
        地区: outerSite,
        评价时间范围: reviewTimeScope,
        列表页码: pageNo,
        抓取时间: collectedAt,
        列表行号: rowIndex + 1,
        商品名称: '',
        商品类目: '',
        SPU: '',
        SKC: '',
        SKU属性: '',
        SKU: '',
        评价星级: '',
        评价星级文本: '',
        评价内容: '',
        合身情况: '',
        不合身原因: '',
        评价图片: '',
        商品图片: '',
        评价时间: '',
        审核状态: '',
        操作: '',
        原始行文本: textOf(row),
      }

      headers.forEach((header, index) => {
        if (cells[index]) record[header] = textOf(cells[index])
      })

      const goods = parseGoodsCell(cells[0] || row)
      const sku = parseSkuCell(cells[1] || row)
      const rating = parseRatingCell(cells[2] || row)
      const review = parseReviewInfoCell(cells[3] || row)

      record.商品名称 = goods.productName
      record.商品类目 = goods.category
      record.SPU = goods.spu
      record.SKC = goods.skc
      record.SKU属性 = sku.skuAttr
      record.SKU = sku.sku
      record.评价星级 = rating.star
      record.评价星级文本 = rating.ratingText
      record.评价内容 = review.reviewText
      record.合身情况 = review.fit
      record.不合身原因 = review.unfitReason
      record.评价图片 = review.reviewImages
      record.商品图片 = goods.productImages
      record.评价时间 = textOf(cells[4] || null)
      record.审核状态 = textOf(cells[5] || null)
      record.操作 = textOf(cells[6] || null)

      results.push(record)
    })

    return dedupeRows(results)
  }

  async function runQueryAndWait(expectRefresh = false) {
    const button = findMainButton('查询')
    if (!button) return false
    const oldSig = getListPageSignature()
    const oldPageNo = getListPageNo()
    clickLike(button)
    await sleep(500)
    const ready = await waitForListReady(15000)
    if (!ready.ready) return false
    if (oldPageNo > 1 && getListPageNo() !== 1) {
      const resetOk = await ensureFirstListPage(20000)
      if (!resetOk) return false
    } else {
      const changed = await waitListPageChange(oldSig, oldPageNo, expectRefresh ? 8000 : 3000, false)
      if (!changed) {
        await sleep(expectRefresh ? 2500 : 1200)
      }
      const settled = await waitForListReady(expectRefresh ? 15000 : 8000)
      if (!settled.ready) return false
    }
    return true
  }

  try {
    if (phase === 'main') {
      if (page === 1) return nextPhase('ensure_target', 0, mergeShared())
      return nextPhase('advance_cursor', 0, mergeShared(shared))
    }

    if (phase === 'ensure_target') {
      if (page === 1) resetSeenRows()
      if (location.href.includes('/main/authentication')) {
        return fail('当前 Temu 账号被重定向到认证页，暂无商品评价页面访问权限')
      }
      if (!location.href.includes('/main/evaluate/evaluate-list')) {
        location.href = TARGET_URL
        return nextPhase('ensure_target', mode === 'new' ? 1800 : 1200)
      }
      const ready = await waitForTargetReady(20000)
      if (!ready) return fail('Temu 商品评价页面未加载完成，请确认已登录并能打开商品评价列表')
      return nextPhase('prepare_scope', 200, {
        ...shared,
        currentOuterSite: '',
        pendingTargetOuterSite: '',
      })
    }

    if (phase === 'prepare_scope') {
      const ready = await waitForTargetReady(20000)
      if (!ready) return fail('商品评价页面加载超时')
      const { available, target } = buildTargetOuterSites()
      if (!target.length) return fail('没有可用的地区可供抓取')

      const targetOuterSite = String(shared.pendingTargetOuterSite || shared.currentOuterSite || target[0]).trim() || target[0]
      const resolvedOuterSite = getResolvedOuterSite()
      if (targetOuterSite !== resolvedOuterSite) {
        const oldSignature = getListPageSignature()
        const click = getOuterSiteClick(targetOuterSite)
        if (click) {
          return cdpClicks([click], 'after_outer_site_switch', 2500, {
            ...shared,
            availableOuterSites: available,
            targetOuterSites: target,
            pendingTargetOuterSite: targetOuterSite,
            pendingOuterSiteOldSignature: oldSignature,
          })
        }
        const outerSiteUrl = getOuterSiteUrl(targetOuterSite)
        if (outerSiteUrl) {
          location.href = outerSiteUrl
          return nextPhase('after_outer_site_switch', 2500, {
            ...shared,
            availableOuterSites: available,
            targetOuterSites: target,
            pendingTargetOuterSite: targetOuterSite,
            pendingOuterSiteOldSignature: oldSignature,
          })
        }
        return fail(`无法切换地区：${targetOuterSite}`)
      }

      return nextPhase('apply_review_time_range', 200, {
        ...shared,
        availableOuterSites: available,
        targetOuterSites: target,
        currentOuterSite: targetOuterSite,
        pendingTargetOuterSite: '',
      })
    }

    if (phase === 'after_outer_site_switch') {
      const targetOuterSite = String(shared.pendingTargetOuterSite || '').trim()
      const oldSignature = String(shared.pendingOuterSiteOldSignature || '').trim()
      const ready = await waitForTargetReady(25000)
      if (!ready) return fail(`切换地区后页面未恢复：${targetOuterSite || '未知地区'}`)
      const matched = await waitFor(() => !targetOuterSite || getResolvedOuterSite() === targetOuterSite, 12000, 300)
      if (!matched && targetOuterSite) return fail(`切换地区后未进入目标范围：${targetOuterSite}`)
      if (oldSignature) {
        const refreshed = await waitFor(() => {
          const signature = getListPageSignature()
          return signature && signature !== oldSignature
        }, 12000, 300)
        if (!refreshed) return fail(`切换地区后列表未刷新：${targetOuterSite || '未知地区'}`)
      }
      return nextPhase('apply_review_time_range', 300, {
        ...shared,
        currentOuterSite: targetOuterSite || getResolvedOuterSite(),
        pendingTargetOuterSite: '',
        pendingOuterSiteOldSignature: '',
        justSwitchedOuterSite: true,
      })
    }

    if (phase === 'apply_review_time_range') {
      const requestedTimeRange = requestedShared.requestedReviewTimeRange
      const currentOuterSite = String(shared.currentOuterSite || getResolvedOuterSite() || '').trim()
      if (!requestedTimeRange) {
        return nextPhase('run_query', 0, {
          ...shared,
          currentOuterSite,
          currentReviewTimeScope: getResolvedReviewTimeScope(),
        })
      }

      if (requestedTimeRange === '自定义') {
        const customRange = requestedShared.requestedCustomReviewTimeRange
        if (!customRange.start || !customRange.end) return fail('请选择完整的自定义评价时间范围')
        const expectedRange = `${customRange.start} ~ ${customRange.end}`
        if (getActiveQuickTimeRange() === expectedRange || readRangeValueByLabel('评价时间') === expectedRange) {
          return nextPhase('run_query', 0, {
            ...shared,
            currentOuterSite,
            currentReviewTimeScope: expectedRange,
          })
        }
        const injected = await injectCustomReviewTimeRange(customRange.start, customRange.end)
        if (!injected) {
          const customNode = getQuickTimeOption('自定义')
          if (customNode && !isOptionActive(customNode)) {
            clickLike(customNode)
            await sleep(700)
          }
        }
        const repaired = injected || await injectRangeByLabel('评价时间', customRange.start, customRange.end)
        if (!repaired) return fail(`自定义评价时间设置失败：${customRange.start} ~ ${customRange.end}`)
        return nextPhase('run_query', 300, {
          ...shared,
          currentOuterSite,
          currentReviewTimeScope: expectedRange,
        })
      }

      if (getActiveQuickTimeRange() !== requestedTimeRange) {
        const optionNode = getQuickTimeOption(requestedTimeRange)
        if (!optionNode) return fail(`未找到评价时间选项：${requestedTimeRange}`)
        clickLike(optionNode)
        const switched = await waitFor(() => getActiveQuickTimeRange() === requestedTimeRange, 4000, 200)
        if (!switched) return fail(`评价时间选项未生效：${requestedTimeRange}`)
      }

      return nextPhase('run_query', 200, {
        ...shared,
        currentOuterSite,
        currentReviewTimeScope: requestedTimeRange,
      })
    }

    if (phase === 'run_query') {
      const ok = await runQueryAndWait(Boolean(shared.justSwitchedOuterSite))
      if (!ok) return fail('商品评价查询失败或列表未刷新')
      return nextPhase('collect', 200, {
        ...shared,
        currentOuterSite: String(shared.currentOuterSite || getResolvedOuterSite() || '').trim(),
        currentReviewTimeScope: String(shared.currentReviewTimeScope || getResolvedReviewTimeScope()).trim(),
        justSwitchedOuterSite: false,
      })
    }

    if (phase === 'advance_cursor') {
      const ready = await waitForListReady(15000)
      if (!ready.ready) return fail('商品评价列表加载超时')
      const { available, target } = buildTargetOuterSites()
      if (!target.length) return fail('没有可用的地区可供抓取')
      const currentOuterSite = String(shared.currentOuterSite || getResolvedOuterSite() || target[0]).trim()
      const currentIndex = target.indexOf(currentOuterSite)
      if (currentIndex < 0) return fail(`当前地区不在目标列表中：${currentOuterSite || '未知'}`)

      if (hasNextListPage()) {
        const oldSig = getListPageSignature()
        const oldPageNo = getListPageNo()
        if (!clickNextListPage()) return fail('商品评价列表翻页失败')
        const changed = await waitListPageChange(oldSig, oldPageNo, 10000, true)
        if (!changed) return fail('商品评价列表翻页后未检测到新页面')
        const nextReady = await waitForListReady(15000)
        if (!nextReady.ready) return fail('商品评价列表翻页后未恢复')
        return nextPhase('collect', 200, {
          ...shared,
          availableOuterSites: available,
          targetOuterSites: target,
          currentOuterSite,
        })
      }

      if (currentIndex + 1 >= target.length) {
        return complete([], false, {
          ...shared,
          availableOuterSites: available,
          targetOuterSites: target,
          currentOuterSite,
        })
      }

      return nextPhase('prepare_scope', 0, {
        ...shared,
        availableOuterSites: available,
        targetOuterSites: target,
        currentOuterSite: '',
        pendingTargetOuterSite: target[currentIndex + 1],
      })
    }

    if (phase === 'collect') {
      const ready = await waitForListReady(15000)
      if (!ready.ready) return fail('商品评价列表加载超时')
      const { available, target } = buildTargetOuterSites()
      if (!target.length) return fail('没有可用的地区可供抓取')

      const currentOuterSite = String(shared.currentOuterSite || getResolvedOuterSite() || target[0]).trim()
      const currentIndex = target.indexOf(currentOuterSite)
      if (currentIndex < 0) return fail(`当前地区不在目标列表中：${currentOuterSite || '未知'}`)

      const reviewTimeScope = String(shared.currentReviewTimeScope || getResolvedReviewTimeScope()).trim()
      const rows = scrapeCurrentPage(currentOuterSite, reviewTimeScope)
      const hasMore = hasNextListPage() || (currentIndex + 1 < target.length)

      return complete(rows, hasMore, {
        ...shared,
        availableOuterSites: available,
        targetOuterSites: target,
        currentOuterSite,
        currentReviewTimeScope: reviewTimeScope,
        currentPageNo: getListPageNo(),
        current_store: [currentOuterSite, reviewTimeScope].filter(Boolean).join(' / '),
      })
    }

    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || String(error || '脚本执行失败'))
  }
})()
