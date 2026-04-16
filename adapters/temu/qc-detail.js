;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = Number(window.__CRAWSHRIMP_PAGE__ || 1)
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const TARGET_URL = 'https://seller.kuajingmaihuo.com/wms/qc-detail'
  const STATUS_OPTIONS = ['抽检不合格', '抽检完成']
  const SEEN_ROW_KEY = '__CRAWSHRIMP_TEMU_QC_DETAIL_SEEN__'
  const DETAIL_ROWS_PER_PHASE = 3

  const requestedShared = {
    requestedMode: String(shared.requestedMode || params.mode || 'current').trim().toLowerCase(),
    requestedStatuses: normalizeStatusValues(shared.requestedStatuses || params.qc_statuses),
    requestedCustomQcTimeRange: normalizeDateRangeParam(shared.requestedCustomQcTimeRange || params.custom_qc_time_range),
  }

  const mode = requestedShared.requestedMode

  function normalizeDateRangeParam(value) {
    if (!value || typeof value !== 'object') return {}
    const start = String(value.start || '').trim()
    const end = String(value.end || '').trim()
    if (!start || !end) return {}
    return { start, end }
  }

  function normalizeStatusValues(value) {
    let raw = []
    if (Array.isArray(value)) {
      raw = value
    } else if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) {
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          try {
            const parsed = JSON.parse(trimmed)
            raw = Array.isArray(parsed) ? parsed : [trimmed]
          } catch (e) {
            raw = trimmed.split(',')
          }
        } else if (trimmed.includes(',')) {
          raw = trimmed.split(',')
        } else {
          raw = [trimmed]
        }
      }
    } else if (value) {
      raw = [value]
    }
    const normalized = [...new Set(raw.map(item => String(item || '').trim()).filter(Boolean))]
      .filter(item => STATUS_OPTIONS.includes(item))
    return normalized.length ? normalized : [STATUS_OPTIONS[0]]
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

  function nextPhaseWithData(name, data, sleepMs = 800, next = shared) {
    return {
      success: true,
      data: Array.isArray(data) ? data : [],
      meta: { action: 'next_phase', next_phase: name, sleep_ms: sleepMs, shared: mergeShared(next) },
    }
  }

  function recoverAuthRedirect(reason, data = [], next = shared) {
    try { location.href = TARGET_URL } catch (e) {}
    return nextPhaseWithData('recover_auth_redirect', data, mode === 'new' ? 2500 : 1800, {
      ...next,
      authRecoverReason: reason,
    })
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

  function isLoginPage() {
    const href = String(location.href || '')
    const bodyText = textOf(document.body)
    return href.includes('/login') || /扫码登录|账号登录|还没有店铺/.test(bodyText)
  }

  function isAuthRedirectPage() {
    const href = String(location.href || '')
    return isLoginPage() || href.includes('/settle/site-main')
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

  function formatDate(date) {
    const pad = value => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }

  function parseDateValue(dateText) {
    const match = String(dateText || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!match) return null
    const [, year, month, day] = match
    const value = new Date(Number(year), Number(month) - 1, Number(day))
    return Number.isNaN(value.getTime()) ? null : value
  }

  function parseDateLikeValue(value) {
    if (!value) return null
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value
    }
    if (typeof value === 'string') return parseDateValue(value.slice(0, 10))
    if (typeof value === 'number') {
      const parsed = new Date(value)
      return Number.isNaN(parsed.getTime()) ? null : parsed
    }
    if (typeof value === 'object') {
      if (typeof value.toDate === 'function') {
        const parsed = value.toDate()
        if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) return parsed
      }
      if (typeof value.toISOString === 'function') {
        const parsed = new Date(value.toISOString())
        if (!Number.isNaN(parsed.getTime())) return parsed
      }
    }
    return null
  }

  function formatQueryRange(startDate, endDate) {
    return `${startDate} ~ ${endDate}`
  }

  function getRangePickerInput() {
    return document.querySelector('input[data-testid="beast-core-rangePicker-htmlInput"]')
  }

  function setNativeInputValue(input, value) {
    if (!input) return false
    try { input.focus?.() } catch (e) {}
    const proto = window.HTMLInputElement?.prototype || null
    const setter = proto ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : null
    if (setter) setter.call(input, value)
    else input.value = value
    try { input.dispatchEvent(new Event('input', { bubbles: true })) } catch (e) {}
    try { input.dispatchEvent(new Event('change', { bubbles: true })) } catch (e) {}
    try { input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })) } catch (e) {}
    try { input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' })) } catch (e) {}
    return true
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
        if (props && typeof props.onChange === 'function' && Array.isArray(props.value)) {
          return props
        }
        fiber = fiber.return
      }
    }
    return null
  }

  async function waitForRangePickerReactProps(timeout = 4000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const input = getRangePickerInput()
      const props = input ? getRangePickerReactPropsFromInput(input) : null
      if (input || props) return { input, props }
      await sleep(200)
    }
    return {
      input: getRangePickerInput(),
      props: null,
    }
  }

  function readDateInputValue() {
    return String(getRangePickerInput()?.value || '').trim()
  }

  function readRangeInputValue() {
    const matches = readDateInputValue().match(/\d{4}-\d{2}-\d{2}/g) || []
    if (matches.length < 2) return null
    return { start: matches[0], end: matches[1] }
  }

  function readRangeModelValue() {
    const input = getRangePickerInput()
    const props = input ? getRangePickerReactPropsFromInput(input) : null
    const values = Array.isArray(props?.value) ? props.value : null
    if (!values || values.length !== 2) return null
    const start = parseDateLikeValue(values[0])
    const end = parseDateLikeValue(values[1])
    if (!start || !end) return null
    return {
      start: formatDate(start),
      end: formatDate(end),
    }
  }

  function hasExpectedRange(startDate, endDate) {
    const model = readRangeModelValue()
    if (model && model.start === startDate && model.end === endDate) return true
    const inputRange = readRangeInputValue()
    return !!(inputRange && inputRange.start === startDate && inputRange.end === endDate)
  }

  async function injectDateRange(startDate, endDate) {
    const startBase = parseDateValue(startDate)
    const endBase = parseDateValue(endDate)
    const start = startBase ? new Date(startBase.getFullYear(), startBase.getMonth(), startBase.getDate(), 0, 0, 0) : null
    const end = endBase ? new Date(endBase.getFullYear(), endBase.getMonth(), endBase.getDate(), 23, 59, 59) : null
    if (!start || !end) return false
    const expectedRange = formatQueryRange(startDate, endDate)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { input, props } = await waitForRangePickerReactProps(4000)
      if (props && typeof props.onChange === 'function') {
        try { props.onChange([start, end]) } catch (e) {}
      }
      let matched = await waitFor(() => hasExpectedRange(startDate, endDate), 3000, 200)
      if (!matched && input) {
        setNativeInputValue(input, expectedRange)
        matched = await waitFor(() => hasExpectedRange(startDate, endDate), 2000, 200)
      }
      if (matched) return true
      await sleep(300)
    }
    return false
  }

  function getQueryButton() {
    return [...document.querySelectorAll('button')].find(node => textOf(node) === '查询') || null
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

  function getPageSignature() {
    return `${getActiveStatus()}::${getTableSignature()}`
  }

  function getTableSignature() {
    const rows = getTableRows()
    const first = rows[0] ? textOf(rows[0]).slice(0, 160) : 'empty'
    const last = rows[rows.length - 1] ? textOf(rows[rows.length - 1]).slice(0, 160) : 'empty'
    const total = textOf(document.querySelector('li[class*="PGT_totalText_"], [data-testid="beast-core-pagination"]')).slice(0, 80)
    return `${getActivePage()}::${rows.length}::${total}::${first}::${last}`
  }

  async function waitForTable(timeout = 15000) {
    return await waitFor(() => {
      if (getTableRows().length) return true
      return /抽检结果明细|暂无数据|共有\s*\d+\s*条/.test(textOf(document.body))
    }, timeout, 300)
  }

  function getStatusNodes() {
    const wrapperNodes = [...document.querySelectorAll('[data-testid="beast-core-tab-itemLabel-wrapper"]')]
      .filter(isVisible)
      .filter(node => STATUS_OPTIONS.includes(textOf(node)))
    if (wrapperNodes.length) return wrapperNodes

    const labelNodes = [...document.querySelectorAll('[data-testid="beast-core-tab-itemLabel"]')]
      .filter(isVisible)
      .filter(node => STATUS_OPTIONS.includes(textOf(node)))
      .map(node => node.parentElement || node)
      .filter(Boolean)
    if (labelNodes.length) return labelNodes

    return [...document.querySelectorAll('[class*="TAB_tabItem_"], [class*="TAB_line_"], [role="tab"]')]
      .filter(isVisible)
      .filter(node => STATUS_OPTIONS.includes(textOf(node)))
  }

  function matchStatusLabel(value) {
    return STATUS_OPTIONS.find(prefix => String(value || '').startsWith(prefix)) || ''
  }

  function getActiveStatus() {
    const node = getStatusNodes().find(item => hasClassFragment(item, 'TAB_active_'))
    if (node) return matchStatusLabel(textOf(node))
    const firstVisible = getStatusNodes().map(item => matchStatusLabel(textOf(item))).find(Boolean)
    return firstVisible || ''
  }

  function getStatusNode(statusText) {
    return getStatusNodes().find(node => textOf(node).startsWith(statusText)) || null
  }

  async function switchStatus(statusText) {
    const node = getStatusNode(statusText)
    if (!node) return false
    const currentStatus = getActiveStatus()
    if (currentStatus && currentStatus === statusText) return true
    const oldTableSig = getTableSignature()
    clickLike(node)
    const changed = await waitFor(() => getActiveStatus() === statusText, 10000, 300)
    if (!changed) return false
    await waitFor(() => getTableSignature() !== oldTableSig, 12000, 300)
    await waitForTable(12000)
    await sleep(250)
    return getActiveStatus() === statusText
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

  async function ensurePageNo(targetPageNo, timeout = 30000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const currentPageNo = getActivePage()
      if (currentPageNo === targetPageNo) return true
      const pager = currentPageNo < targetPageNo ? getNextPager() : getPrevPager()
      if (!pager) return false
      const oldSig = getPageSignature()
      clickLike(pager)
      const changed = await waitFor(() => getPageSignature() !== oldSig, 10000, 300)
      if (!changed) return false
      const ready = await waitForTable(10000)
      if (!ready) return false
    }
    return getActivePage() === targetPageNo
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
    ].find(node => isVisible(node) && /抽检记录/.test(textOf(node))) || null
  }

  async function waitForDrawer(timeout = 8000) {
    return await waitFor(() => {
      const drawer = getVisibleDrawer()
      return !!drawer && !/加载中/.test(textOf(drawer))
    }, timeout, 200)
  }

  async function expandDrawerDetails(timeout = 6000) {
    const drawer = getVisibleDrawer()
    if (!drawer) return false
    if (/收起/.test(textOf(drawer)) || drawer.querySelector('table')) return true
    const expandNode = [...drawer.querySelectorAll('a, button, span, div')]
      .find(node => isVisible(node) && textOf(node) === '展开')
    if (!expandNode) return true
    clickLike(expandNode)
    return await waitFor(() => {
      const current = getVisibleDrawer()
      if (!current) return false
      const currentText = textOf(current)
      return /收起/.test(currentText) || !!current.querySelector('table')
    }, timeout, 200)
  }

  async function closeDrawer() {
    const drawer = getVisibleDrawer()
    if (!drawer) return true
    const closeNode = [
      ...drawer.querySelectorAll('[data-testid*="icon-close"], svg[data-testid*="icon-close"]'),
      ...document.querySelectorAll('[data-testid*="icon-close"], svg[data-testid*="icon-close"]'),
    ].find(isVisible)
    if (closeNode) clickLike(closeNode.parentElement || closeNode)
    let closed = await waitFor(() => !getVisibleDrawer(), 2500, 200)
    if (!closed) {
      try {
        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }))
        document.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Escape' }))
      } catch (e) {}
      closed = await waitFor(() => !getVisibleDrawer(), 2000, 200)
    }
    if (!closed) {
      const mask = [...document.querySelectorAll('[class*="Drawer_mask_"]')].find(isVisible)
      if (mask) clickLike(mask)
      closed = await waitFor(() => !getVisibleDrawer(), 2000, 200)
    }
    return closed
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
        row.状态标签,
        row.备货单号,
        row['SKU ID'] || row['SKU 信息'] || row.SKU信息,
        row.抽检记录类型,
        row.字段名,
        row.疵点序号,
        row['尺寸/cm'],
        row.明细序号,
      ].map(item => String(item || '').trim()).join('\u001f')
      if (seen[key]) continue
      seen[key] = 1
      results.push(row)
    }
    return results
  }

  function parseDrawerBasicText(drawerText) {
    const result = {}
    const patterns = [
      ['SKU ID', /SKU ID[:：]\s*([^\s]+)/],
      ['抽检记录备货单号', /备货单号[:：]\s*([^\s]+)/],
      ['抽检时间', /抽检时间[:：]\s*([0-9-:\s]+)/],
      ['抽检结果', /抽检结果\s*(抽检不合格|抽检完成|不合格|合格)/],
    ]
    patterns.forEach(([key, pattern]) => {
      const match = pattern.exec(drawerText)
      result[key] = match ? match[1].trim() : ''
    })
    return result
  }

  function getSectionTitleForTable(table, drawer) {
    let current = table?.previousElementSibling || null
    while (current && drawer?.contains(current)) {
      const value = textOf(current)
      if (value && value.length <= 40) return value
      current = current.previousElementSibling
    }
    const ownerText = textOf(table?.parentElement || null)
    if (ownerText.includes('尺码检查')) return '尺码检查'
    if (ownerText.includes('工艺检查')) return '工艺检查'
    return '抽检记录明细'
  }

  function findHeaderIndex(headers, patterns, fallbackIndex = -1) {
    const index = headers.findIndex(header => patterns.some(pattern => pattern.test(String(header || ''))))
    return index >= 0 ? index : fallbackIndex
  }

  function getExpandedValue(entry, index) {
    return textOf(entry?.expanded?.[index] || null)
  }

  function isSizeCheckSection(sectionTitle, headers) {
    if (sectionTitle === '尺码检查') return true
    const joined = headers.join(' ')
    return /尺码SKU/.test(joined) || (/标/.test(joined) && /测/.test(joined) && /偏差/.test(joined))
  }

  function formatSizeDimension(entry, headers) {
    const combinedIndex = findHeaderIndex(headers, [/尺寸\/cm/, /^字段值$/], 0)
    const combined = getExpandedValue(entry, combinedIndex)
    if (combined && /cm|毫米|mm|CM/i.test(combined)) return combined
    const nameIndex = findHeaderIndex(headers, [/尺寸|字段名|段值/], 0)
    const unitIndex = findHeaderIndex(headers, [/^cm$|单位/], 1)
    const name = getExpandedValue(entry, nameIndex)
    const unit = getExpandedValue(entry, unitIndex)
    if (name && unit && !name.includes(unit)) return `${name}（${unit}）`
    return name || combined || unit
  }

  function scrapeDrawerDetails(baseRow) {
    const drawer = getVisibleDrawer()
    if (!drawer) return []
    const drawerText = textOf(drawer)
    const basic = parseDrawerBasicText(drawerText)
    const rows = [{
      __sheet_name: '详情',
      ...baseRow,
      ...basic,
      抽检记录类型: '抽检结果',
      明细序号: 1,
      字段名: '抽检结果',
      字段值: basic.抽检结果 || '',
    }]
    ;[
      ['SKU ID', basic['SKU ID']],
      ['备货单号', basic['抽检记录备货单号']],
      ['抽检时间', basic['抽检时间']],
    ].forEach(([fieldName, fieldValue], index) => {
      if (!fieldValue) return
      rows.push({
        __sheet_name: '详情',
        ...baseRow,
        ...basic,
        抽检记录类型: '抽检结果',
        明细序号: index + 2,
        字段名: fieldName,
        字段值: fieldValue,
      })
    })
    const tables = [...drawer.querySelectorAll('table')]
    tables.forEach(table => {
      const headers = buildTableHeaders(table)
      const sectionTitle = getSectionTitleForTable(table, drawer)
      const bodyRows = buildTableBody(table, headers)
      bodyRows.forEach((entry, index) => {
        const item = {
          __sheet_name: '详情',
          ...baseRow,
          ...basic,
          抽检记录类型: sectionTitle,
          明细序号: index + 1,
        }
        if (isSizeCheckSection(sectionTitle, headers)) {
          const sizeSkuIndex = findHeaderIndex(headers, [/尺码SKU/], 2)
          const markIndex = findHeaderIndex(headers, [/(^|\/)标$/], 3)
          const measureIndex = findHeaderIndex(headers, [/(^|\/)测$/], 4)
          const diffIndex = findHeaderIndex(headers, [/(^|\/)偏差$/], 5)
          const issueSeqIndex = findHeaderIndex(headers, [/疵点序号/], 6)
          item.抽检记录类型 = '尺码检查'
          item['尺寸/cm'] = formatSizeDimension(entry, headers)
          item.尺码SKU = entry.values['尺码SKU'] || getExpandedValue(entry, sizeSkuIndex)
          item['尺码检查/标'] = entry.values['尺码检查/标'] || entry.values['标'] || getExpandedValue(entry, markIndex)
          item['尺码检查/测'] = entry.values['尺码检查/测'] || entry.values['测'] || getExpandedValue(entry, measureIndex)
          item['尺码检查/偏差'] = entry.values['尺码检查/偏差'] || entry.values['偏差'] || getExpandedValue(entry, diffIndex)
          item.疵点序号 = entry.values.疵点序号 || getExpandedValue(entry, issueSeqIndex)
        } else {
          headers.forEach(header => {
            if (!header) return
            item[header] = entry.values[header] || ''
          })
        }
        rows.push(item)
      })
    })
    return rows
  }

  function findRecordAction(row) {
    return [...row.querySelectorAll('a, button, span')]
      .find(node => textOf(node) === '查看抽检记录') || null
  }

  async function applyRequestedTimeRange() {
    const timeRange = requestedShared.requestedCustomQcTimeRange
    if (!timeRange.start || !timeRange.end) return true
    const injected = await injectDateRange(timeRange.start, timeRange.end)
    if (!injected) return false
    const query = getQueryButton()
    if (!query) return false
    const oldSig = getPageSignature()
    clickLike(query)
    const changed = await waitFor(() => getPageSignature() !== oldSig, 12000, 300)
    if (!changed && !hasExpectedRange(timeRange.start, timeRange.end)) return false
    return await waitForTable(12000)
  }

  async function collectCurrentPageChunk(startIndex = 0, limit = DETAIL_ROWS_PER_PHASE) {
    const status = getActiveStatus()
    const pageNo = getActivePage()
    const scrapedAt = localNow()
    const table = getMainTable()
    const headers = buildTableHeaders(table)
    const rows = buildTableBody(table, headers)
    const results = []
    const safeStartIndex = Math.max(0, Number(startIndex) || 0)
    const safeLimit = Math.max(1, Number(limit) || DETAIL_ROWS_PER_PHASE)
    const endIndex = Math.min(rows.length, safeStartIndex + safeLimit)
    let aborted = false

    for (let index = safeStartIndex; index < endIndex; index += 1) {
      if (isAuthRedirectPage()) {
        return {
          data: dedupeRows(results),
          done: false,
          nextRowCursor: index,
          rowCount: rows.length,
          authRedirect: true,
        }
      }
      const entry = rows[index]
      const baseRow = {
        状态标签: status,
        列表页码: pageNo,
        抓取时间: scrapedAt,
        列表行号: index + 1,
      }
      headers.forEach(header => {
        if (!header) return
        if (header === '操作') return
        baseRow[header] = entry.values[header] || ''
      })
      baseRow.商品信息 = baseRow.商品信息 || ''
      baseRow['SKU 信息'] = baseRow['SKU 信息'] || ''
      baseRow.备货单号 = baseRow.备货单号 || ''
      baseRow.最新抽检时间 = baseRow.最新抽检时间 || ''

      results.push({
        __sheet_name: '列表',
        ...baseRow,
      })

      const action = findRecordAction(entry.row)
      if (!action) {
        continue
      }

      clickLike(action)
      const opened = await waitForDrawer(8000)
      if (!opened) {
        results.push({
          __sheet_name: '详情',
          ...baseRow,
          抽检记录类型: '错误',
          字段名: '错误信息',
          字段值: '抽检记录抽屉未打开',
        })
        continue
      }
      const expanded = await expandDrawerDetails(6000)
      if (!expanded && /抽检不合格/.test(String(baseRow.状态标签 || ''))) {
        results.push({
          __sheet_name: '详情',
          ...baseRow,
          抽检记录类型: '错误',
          字段名: '错误信息',
          字段值: '抽检记录明细未展开',
        })
      }
      scrapeDrawerDetails(baseRow).forEach(item => results.push(item))
      const closed = await closeDrawer()
      if (!closed) {
        results.push({
          __sheet_name: '详情',
          ...baseRow,
          抽检记录类型: '错误',
          字段名: '错误信息',
          字段值: '抽检记录抽屉未关闭',
        })
        aborted = true
        break
      }
      await sleep(250)
    }

    return {
      data: dedupeRows(results),
      done: aborted || endIndex >= rows.length,
      nextRowCursor: aborted ? rows.length : endIndex,
      rowCount: rows.length,
      authRedirect: false,
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
      if (!location.href.includes('/wms/qc-detail')) {
        location.href = TARGET_URL
        return nextPhase('ensure_target', mode === 'new' ? 2200 : 1500)
      }
      const targetStatuses = requestedShared.requestedStatuses.slice()
      const ready = await waitForTable(15000)
      if (!ready) return fail('抽检结果明细页面未加载完成，请确认已登录并能打开列表')
      if (requestedShared.requestedCustomQcTimeRange.start) {
        const applied = await applyRequestedTimeRange()
        if (!applied) return fail('抽检结果时间筛选设置失败')
      }
      const firstPageReady = await ensureFirstPage(15000)
      if (!firstPageReady) return fail('抽检结果列表无法回到第一页')
      const firstStatus = targetStatuses[0] || STATUS_OPTIONS[0]
      const firstStatusReady = await switchStatus(firstStatus)
      if (!firstStatusReady) return fail(`抽检结果状态切换失败：${firstStatus}`)
      return nextPhase('collect', 200, {
        targetStatuses,
        targetStatus: firstStatus,
        currentStatus: firstStatus,
        currentPageNo: getActivePage(),
        rowCursor: 0,
      })
    }

    if (phase === 'recover_auth_redirect') {
      if (!location.href.includes('/wms/qc-detail')) {
        location.href = TARGET_URL
        return nextPhase('recover_auth_redirect', mode === 'new' ? 2200 : 1500, shared)
      }
      const ready = await waitForTable(15000)
      if (!ready) {
        return fail(`抽检结果页面恢复失败：${shared.authRecoverReason || '登录状态失效'}`)
      }
      if (requestedShared.requestedCustomQcTimeRange.start) {
        const applied = await applyRequestedTimeRange()
        if (!applied) return fail('抽检结果页面恢复失败：时间筛选设置失败')
      }
      const firstPageReady = await ensureFirstPage(15000)
      if (!firstPageReady) return fail('抽检结果页面恢复失败：无法回到第一页')
      const targetStatus = String(shared.currentStatus || shared.targetStatus || STATUS_OPTIONS[0]).trim()
      if (targetStatus) {
        const switched = await switchStatus(targetStatus)
        if (!switched) return fail(`抽检结果页面恢复失败：状态切换失败：${targetStatus}`)
      }
      const targetPageNo = Math.max(1, Number(shared.currentPageNo || 1))
      if (targetPageNo > 1) {
        const restored = await ensurePageNo(targetPageNo, 30000)
        if (!restored) return fail(`抽检结果页面恢复失败：无法回到第 ${targetPageNo} 页`)
      }
      return nextPhase(shared.resumePhase || 'collect', 200, {
        ...shared,
        authRecoverReason: '',
      })
    }

    if (phase === 'collect') {
      if (isAuthRedirectPage()) {
        return recoverAuthRedirect('采集抽检明细时跳转到登录页', [], {
          ...shared,
          resumePhase: 'collect',
        })
      }
      const ready = await waitForTable(12000)
      if (!ready) {
        if (isAuthRedirectPage()) {
          return recoverAuthRedirect('采集抽检明细时登录态失效', [], {
            ...shared,
            resumePhase: 'collect',
          })
        }
        return fail('抽检结果列表加载超时')
      }
      const rowCursor = Math.max(0, Number(shared.rowCursor || 0))
      const chunk = await collectCurrentPageChunk(rowCursor, DETAIL_ROWS_PER_PHASE)
      const nextShared = {
        ...shared,
        currentStatus: getActiveStatus(),
        currentPageNo: getActivePage(),
        rowCursor: chunk.done ? 0 : chunk.nextRowCursor,
      }
      if (chunk.authRedirect) {
        return recoverAuthRedirect('采集抽检明细时登录态失效', chunk.data, {
          ...nextShared,
          resumePhase: 'collect',
        })
      }
      if (!chunk.done) {
        return nextPhaseWithData('collect', chunk.data, 150, nextShared)
      }
      return complete(chunk.data, true, nextShared)
    }

    if (phase === 'advance_scope') {
      if (isAuthRedirectPage()) {
        return recoverAuthRedirect('切换抽检范围时跳转到登录页', [], {
          ...shared,
          resumePhase: 'advance_scope',
        })
      }
      const ready = await waitForTable(12000)
      if (!ready) {
        if (isAuthRedirectPage()) {
          return recoverAuthRedirect('切换抽检范围时登录态失效', [], {
            ...shared,
            resumePhase: 'advance_scope',
          })
        }
        return fail('抽检结果列表加载超时')
      }
      const currentStatus = getActiveStatus()

      if (getNextPager()) {
        const paged = await advancePager()
        if (!paged) return fail(`抽检结果列表翻页失败：${currentStatus}`)
        return nextPhase('collect', 200, {
          ...shared,
          currentStatus,
          currentPageNo: getActivePage(),
          rowCursor: 0,
        })
      }

      const targetStatuses = normalizeStatusValues(shared.targetStatuses)
      const currentIndex = targetStatuses.indexOf(currentStatus)
      const nextStatus = currentIndex >= 0 ? targetStatuses[currentIndex + 1] : ''
      if (!nextStatus) {
        return complete([], false, {
          ...shared,
          currentStatus,
          currentPageNo: getActivePage(),
        })
      }

      const switched = await switchStatus(nextStatus)
      if (!switched) return fail(`抽检结果状态切换失败：${nextStatus}`)
      const firstPageReady = await ensureFirstPage(12000)
      if (!firstPageReady) return fail(`抽检结果列表无法回到第一页：${nextStatus}`)
      return nextPhase('collect', 200, {
        ...shared,
        currentStatus: nextStatus,
        currentPageNo: getActivePage(),
        rowCursor: 0,
      })
    }

    return fail(`未知执行阶段：${phase}`)
  } catch (error) {
    return fail(error?.message || String(error))
  }
})()
