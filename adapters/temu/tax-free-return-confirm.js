;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = Number(window.__CRAWSHRIMP_PAGE__ || 1)
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const TARGET_URL = 'https://seller.kuajingmaihuo.com/wms/tax-free-return-mgt/return-confirm'
  const STATUS_PREFIXES = ['待确认', '已确认']
  const SEEN_ROW_KEY = '__CRAWSHRIMP_TEMU_TAX_FREE_RETURN_SEEN__'

  const requestedShared = {
    requestedMode: String(shared.requestedMode || params.mode || 'current').trim().toLowerCase(),
    requestedReturnTimeField: String(shared.requestedReturnTimeField || params.return_time_field || '发起确认时间').trim(),
    requestedCustomReturnTimeRange: normalizeDateRangeParam(shared.requestedCustomReturnTimeRange || params.custom_return_time_range),
  }

  const mode = requestedShared.requestedMode

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

  function formatDate(date) {
    const pad = value => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }

  function buildRangeFromOption(optionText) {
    if (!optionText) return {}
    const today = new Date()
    const current = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const end = new Date(current)
    const start = new Date(current)
    if (optionText === '今日') {
      return { start: formatDate(start), end: formatDate(end) }
    }
    if (optionText === '昨日') {
      start.setDate(start.getDate() - 1)
      end.setDate(end.getDate() - 1)
      return { start: formatDate(start), end: formatDate(end) }
    }
    if (optionText === '近7日') {
      start.setDate(start.getDate() - 6)
      return { start: formatDate(start), end: formatDate(end) }
    }
    if (optionText === '近30日') {
      start.setDate(start.getDate() - 29)
      return { start: formatDate(start), end: formatDate(end) }
    }
    return {}
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

  function getRangePickerInput() {
    return document.querySelector('input[data-testid="beast-core-rangePicker-htmlInput"]')
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
        if (!props || typeof props.onChange !== 'function') {
          fiber = fiber.return
          continue
        }
        if (Array.isArray(props.value) || Array.isArray(props.utcValue)) {
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
    const values = Array.isArray(props?.value)
      ? props.value
      : (Array.isArray(props?.utcValue) ? props.utcValue : null)
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
    const expectedRange = `${startDate} 00:00:00 ~ ${endDate} 23:59:59`
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

  function getTimeTypeInput() {
    return [...document.querySelectorAll('input[data-testid="beast-core-select-htmlInput"]')]
      .find(input => {
        const placeholder = String(input?.placeholder || '').trim()
        const value = String(input?.value || '').trim()
        return placeholder === '时间类型' || value === '发起确认时间' || value === '确认完成时间'
      }) || null
  }

  function getTimeTypeOption(value) {
    return [...document.querySelectorAll('[role="option"], li, div, span')]
      .find(node => isVisible(node) && textOf(node) === value) || null
  }

  async function selectTimeType(value) {
    const targetValue = String(value || '').trim()
    if (!targetValue) return true
    const input = getTimeTypeInput()
    if (!input) return false
    if (String(input.value || '').trim() === targetValue) return true
    clickLike(input.closest('[class*="ST_outerWrapper_"], [data-testid="beast-core-select"], [class*="IPT_outerWrapper_"]') || input)
    const optionReady = await waitFor(() => !!getTimeTypeOption(targetValue), 5000, 200)
    if (!optionReady) return false
    clickLike(getTimeTypeOption(targetValue))
    return await waitFor(() => String(getTimeTypeInput()?.value || '').trim() === targetValue, 5000, 200)
  }

  function getTableRows() {
    return [...document.querySelectorAll('tbody tr[class*="TB_tr_"], tr[class*="TB_tr_"]')]
      .filter(row => row.querySelector('td[class*="TB_td_"], td'))
  }

  function getRawTableHeaders() {
    return [...document.querySelectorAll('thead th[class*="TB_th_"], th[class*="TB_th_"], thead th')]
      .map(cell => textOf(cell))
  }

  function normalizeColumnLabel(value) {
    const clean = String(value || '').replace(/\s+/g, '').trim()
    if (!clean) return ''
    if (clean === '完成确认时间') return '确认完成时间'
    return clean
  }

  function shouldSkipColumnLabel(value) {
    return !value || ['序号', '操作', '全选'].includes(value)
  }

  function getExpectedColumnsByStatus(status) {
    if (status === '已确认') {
      return ['确认单号', 'SKU', 'SPU', '商品信息', '申报价（元）', '件数', '发起确认时间', '确认完成时间', '处理方式', '是否默认弃货', '是否逾期视为同意弃货']
    }
    return ['确认单号', 'SKU', 'SPU', '商品信息', '申报价（元）', '件数', '发起确认时间', '剩余确认时间']
  }

  function mapRowCellsByExpectedColumns(status, rawHeaders, cells) {
    const expectedColumns = getExpectedColumnsByStatus(status)
    const filteredValues = []
    for (let index = 0; index < cells.length; index += 1) {
      const label = normalizeColumnLabel(rawHeaders[index] || '')
      if (shouldSkipColumnLabel(label)) continue
      filteredValues.push(textOf(cells[index]))
    }
    const mapped = {}
    expectedColumns.forEach((key, index) => {
      mapped[key] = filteredValues[index] || ''
    })
    return mapped
  }

  function getPageSignature() {
    const rows = getTableRows()
    const first = rows[0] ? textOf(rows[0]).slice(0, 160) : 'empty'
    const last = rows[rows.length - 1] ? textOf(rows[rows.length - 1]).slice(0, 160) : 'empty'
    return `${getActiveStatus()}::${getActivePage()}::${rows.length}::${first}::${last}`
  }

  async function waitForTable(timeout = 15000) {
    return await waitFor(() => {
      if (getTableRows().length) return true
      return /退货确认单|暂无数据|共有\s*\d+\s*条/.test(textOf(document.body))
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

  function getStatusNodes() {
    return [...document.querySelectorAll('label[data-testid="beast-core-radio"], label')]
      .filter(isVisible)
      .filter(node => STATUS_PREFIXES.some(prefix => textOf(node).startsWith(prefix)))
  }

  function getActiveStatus() {
    const node = getStatusNodes().find(item =>
      item.getAttribute?.('data-checked') === 'true' ||
      hasClassFragment(item, 'RD_active_') ||
      hasClassFragment(item, 'RDG_active_'),
    )
    const value = textOf(node)
    return STATUS_PREFIXES.find(prefix => value.startsWith(prefix)) || STATUS_PREFIXES[0]
  }

  function getStatusNode(statusText) {
    return getStatusNodes().find(node => textOf(node).startsWith(statusText)) || null
  }

  async function switchStatus(statusText) {
    const node = getStatusNode(statusText)
    if (!node) return false
    if (getActiveStatus() === statusText) return true
    const oldSig = getPageSignature()
    const target = node.querySelector('input[type="radio"]') || node
    clickLike(target)
    const changed = await waitFor(() => getPageSignature() !== oldSig || getActiveStatus() === statusText, 10000, 300)
    if (!changed) return false
    await waitForTable(12000)
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
        row.状态标签,
        row.确认单号,
        row.SKU,
        row.SPU,
        row['发起确认时间'] || row['完成确认时间'],
      ].map(item => String(item || '').trim()).join('\u001f')
      if (seen[key]) continue
      seen[key] = 1
      results.push(row)
    }
    return results
  }

  async function applyRequestedTimeRange() {
    const range = requestedShared.requestedCustomReturnTimeRange
    if (!range.start || !range.end) return true
    const selected = await selectTimeType(requestedShared.requestedReturnTimeField)
    if (!selected) return false
    const injected = await injectDateRange(range.start, range.end)
    if (!injected) return false
    const query = getQueryButton()
    if (!query) return false
    const oldSig = getPageSignature()
    clickLike(query)
    const changed = await waitFor(() => getPageSignature() !== oldSig, 12000, 300)
    if (!changed && !hasExpectedRange(range.start, range.end)) return false
    return await waitForTable(12000)
  }

  async function collectCurrentPage() {
    const status = getActiveStatus()
    const pageNo = getActivePage()
    const scrapedAt = localNow()
    const rawHeaders = getRawTableHeaders()
    const rows = getTableRows()
    const results = []

    rows.forEach((row, index) => {
      const cells = [...row.querySelectorAll('td')]
      const item = {
        状态标签: status,
        列表页码: pageNo,
        抓取时间: scrapedAt,
        列表行号: index + 1,
        时间筛选字段: requestedShared.requestedReturnTimeField || String(getTimeTypeInput()?.value || '').trim() || '当前页面',
      }
      rawHeaders.forEach((header, headerIndex) => {
        const key = normalizeColumnLabel(header)
        if (shouldSkipColumnLabel(key)) return
        item[key] = textOf(cells[headerIndex])
      })
      Object.assign(item, mapRowCellsByExpectedColumns(status, rawHeaders, cells), item)
      item.确认单号 = item.确认单号 || ''
      item.SKU = item.SKU || ''
      item.SPU = item.SPU || ''
      item.商品信息 = item.商品信息 || ''
      item['申报价（元）'] = item['申报价（元）'] || ''
      item.件数 = item.件数 || ''
      item['发起确认时间'] = item['发起确认时间'] || ''
      item['确认完成时间'] = item['确认完成时间'] || ''
      item['剩余确认时间'] = item['剩余确认时间'] || ''
      item.处理方式 = item.处理方式 || ''
      item.是否默认弃货 = item.是否默认弃货 || ''
      item.是否逾期视为同意弃货 = item.是否逾期视为同意弃货 || ''
      item.原始行文本 = textOf(row)
      results.push(item)
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
      if (!location.href.includes('/wms/tax-free-return-mgt/return-confirm')) {
        location.href = TARGET_URL
        return nextPhase('ensure_target', mode === 'new' ? 2200 : 1500)
      }
      const ready = await waitForTable(15000)
      if (!ready) return fail('保税仓退货页面未加载完成，请确认已登录并能打开列表')
      if (requestedShared.requestedCustomReturnTimeRange.start) {
        const applied = await applyRequestedTimeRange()
        if (!applied) return fail('保税仓退货时间筛选设置失败')
      }
      const firstPageReady = await ensureFirstPage(15000)
      if (!firstPageReady) return fail('保税仓退货列表无法回到第一页')
      const firstStatusReady = await switchStatus(STATUS_PREFIXES[0])
      if (!firstStatusReady) return fail(`保税仓退货状态切换失败：${STATUS_PREFIXES[0]}`)
      return nextPhase('collect', 200, {
        targetStatuses: STATUS_PREFIXES.slice(),
        targetStatus: STATUS_PREFIXES[0],
      })
    }

    if (phase === 'collect') {
      const ready = await waitForTable(12000)
      if (!ready) return fail('保税仓退货列表加载超时')
      const data = await collectCurrentPage()
      return complete(data, true, {
        ...shared,
        currentStatus: getActiveStatus(),
        currentPageNo: getActivePage(),
      })
    }

    if (phase === 'advance_scope') {
      const ready = await waitForTable(12000)
      if (!ready) return fail('保税仓退货列表加载超时')
      const currentStatus = getActiveStatus()

      if (getNextPager()) {
        const paged = await advancePager()
        if (!paged) return fail(`保税仓退货列表翻页失败：${currentStatus}`)
        return nextPhase('collect', 200, {
          ...shared,
          currentStatus,
          currentPageNo: getActivePage(),
        })
      }

      const targetStatuses = Array.isArray(shared.targetStatuses) ? shared.targetStatuses : STATUS_PREFIXES.slice()
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
      if (!switched) return fail(`保税仓退货状态切换失败：${nextStatus}`)
      const firstPageReady = await ensureFirstPage(12000)
      if (!firstPageReady) return fail(`保税仓退货列表无法回到第一页：${nextStatus}`)
      return nextPhase('collect', 200, {
        ...shared,
        currentStatus: nextStatus,
        currentPageNo: getActivePage(),
      })
    }

    return fail(`未知执行阶段：${phase}`)
  } catch (error) {
    return fail(error?.message || String(error))
  }
})()
