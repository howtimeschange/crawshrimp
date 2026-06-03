;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const DEFAULT_STORE_KEY = 'balabala-global'
  const DEFAULT_REPORT_PATH = '/analytics/reports/sessions_over_time'
  const DEFAULT_QUERY = [
    'FROM sessions',
    'SHOW online_store_visitors,',
    '  sessions',
    "WHERE human_or_bot_session IN ('human', 'bot')",
    'TIMESERIES day',
    'WITH TOTALS, PERCENT_CHANGE',
    'SINCE startOfDay(-7d)',
    'UNTIL today',
    'COMPARE TO previous_period',
    'ORDER BY day ASC',
    'LIMIT 1000',
    'VISUALIZE sessions TYPE line',
  ].join('\n')

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function pad(value) {
    return String(value).padStart(2, '0')
  }

  function dateText(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }

  function addDays(value, days) {
    const [year, month, day] = String(value || '').split('-').map(Number)
    if (!year || !month || !day) return ''
    return dateText(new Date(year, month - 1, day + Number(days || 0)))
  }

  function parseDateText(value, defaultYear = new Date().getFullYear()) {
    let text = compact(value)
      .replace(/年年/g, '年')
      .replace(/日日/g, '日')
      .replace(/[–—]/g, '-')
    let match = text.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
    if (match) return `${match[1]}-${pad(match[2])}-${pad(match[3])}`
    match = text.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/)
    if (match) return `${match[1]}-${pad(match[2])}-${pad(match[3])}`
    match = text.match(/(\d{1,2})月\s*(\d{1,2})日/)
    if (match) return `${defaultYear}-${pad(match[1])}-${pad(match[2])}`
    return ''
  }

  function parseDateRangeText(value) {
    const text = compact(value).replace(/年年/g, '年').replace(/日日/g, '日').replace(/[–—]/g, '-')
    const dates = []
    const fullRe = /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日|(\d{4})[/-](\d{1,2})[/-](\d{1,2})/g
    for (const match of text.matchAll(fullRe)) {
      if (match[1]) dates.push(`${match[1]}-${pad(match[2])}-${pad(match[3])}`)
      else dates.push(`${match[4]}-${pad(match[5])}-${pad(match[6])}`)
    }
    if (dates.length >= 2) return { start: dates[0], end: dates[1] }
    const currentYear = dates[0] ? Number(dates[0].slice(0, 4)) : new Date().getFullYear()
    const shortMatches = Array.from(text.matchAll(/(\d{1,2})月\s*(\d{1,2})日/g))
    if (shortMatches.length >= 2) {
      return {
        start: `${currentYear}-${pad(shortMatches[0][1])}-${pad(shortMatches[0][2])}`,
        end: `${currentYear}-${pad(shortMatches[1][1])}-${pad(shortMatches[1][2])}`,
      }
    }
    const rangeMatch = text.match(/(\d{1,2})月\s*(\d{1,2})日\s*-\s*(?:(\d{4})年)?\s*(\d{1,2})月\s*(\d{1,2})日/)
    if (rangeMatch) {
      const year = Number(rangeMatch[3] || currentYear)
      return {
        start: `${year}-${pad(rangeMatch[1])}-${pad(rangeMatch[2])}`,
        end: `${year}-${pad(rangeMatch[4])}-${pad(rangeMatch[5])}`,
      }
    }
    const sameMonthMatch = text.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*-\s*(\d{1,2})日/)
    if (sameMonthMatch) {
      return {
        start: `${sameMonthMatch[1]}-${pad(sameMonthMatch[2])}-${pad(sameMonthMatch[3])}`,
        end: `${sameMonthMatch[1]}-${pad(sameMonthMatch[2])}-${pad(sameMonthMatch[4])}`,
      }
    }
    return null
  }

  function dateRangeLabel(range) {
    return range?.start && range?.end ? `${range.start} ~ ${range.end}` : ''
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(String(value || '').replace(/\+/g, '%20'))
    } catch (error) {
      return String(value || '')
    }
  }

  function readShopifyQlFromUrl() {
    try {
      return safeDecode(new URLSearchParams(location.search || '').get('ql') || '')
    } catch (error) {
      return ''
    }
  }

  function readStoreKey() {
    const paramStore = compact(params.store_key || params.store || params.shop)
    if (paramStore) return paramStore
    return currentStoreKeyFromUrl() || DEFAULT_STORE_KEY
  }

  function currentStoreKeyFromUrl() {
    const match = String(location.pathname || '').match(/\/store\/([^/]+)/)
    return match ? match[1] : ''
  }

  function readShopName() {
    const titleName = compact(document.title || '').split('·').map(compact).find(part => {
      return part && !/报告|Shopify|访问|sessions/i.test(part)
    })
    if (titleName) return titleName
    const lines = String(document.body?.innerText || '')
      .split(/\n+/)
      .map(compact)
      .filter(Boolean)
      .slice(0, 20)
    return lines.find(line => !/跳至内容|搜索|⌘|K|主页|订单|产品|客户|Shopify/i.test(line)) || ''
  }

  function normalizeTimeRange(value) {
    const text = compact(value).toLowerCase()
    if (!text || ['page', 'current', '页面当前筛选', '沿用页面当前筛选'].includes(text)) return 'page'
    if (['last7', 'recent7', '过去7天', '最近7天'].includes(text)) return 'last7'
    if (['last30', 'recent30', '过去30天', '最近30天'].includes(text)) return 'last30'
    if (['custom', '自定义', '自定义日期'].includes(text)) return 'custom'
    return text
  }

  function parseDateRangeParam(value) {
    const candidates = []
    if (value && typeof value === 'object') {
      candidates.push([
        value.start || value.from || value.begin || value.start_date,
        value.end || value.to || value.finish || value.end_date,
      ])
    }
    candidates.push([
      params.custom_start || params.start_date || params.stat_start,
      params.custom_end || params.end_date || params.stat_end,
    ])
    for (const [startValue, endValue] of candidates) {
      const start = parseDateText(startValue)
      const end = parseDateText(endValue)
      if (start && end) return { start, end }
    }
    return null
  }

  function quickDateRange(type) {
    const today = dateText(new Date())
    if (type === 'last30') return { start: addDays(today, -29), end: today }
    return { start: addDays(today, -6), end: today }
  }

  function resolveRequestedDateRange() {
    const timeRange = normalizeTimeRange(params.time_range || params.stat_time_range)
    const custom = parseDateRangeParam(params.date_range || params.custom_range || params.stat_date_range)
    if (custom) return { range: custom, label: '自定义日期', mode: 'custom' }
    if (timeRange === 'custom') throw new Error('选择自定义日期时，请填写开始和结束日期')
    if (timeRange === 'last7' || timeRange === 'last30') {
      return { range: quickDateRange(timeRange), label: timeRange === 'last30' ? '最近30天' : '最近7天', mode: timeRange }
    }
    return { range: null, label: '沿用页面当前筛选', mode: 'page' }
  }

  function replaceShopifyQlDateRange(query, range) {
    const base = compact(query) ? query : DEFAULT_QUERY
    const sinceLine = `SINCE ${range.start}`
    const untilLine = `UNTIL ${range.end}`
    let next = base
    if (/\bSINCE\b[^\n]*/i.test(next)) next = next.replace(/\bSINCE\b[^\n]*/i, sinceLine)
    else next += `\n${sinceLine}`
    if (/\bUNTIL\b[^\n]*/i.test(next)) next = next.replace(/\bUNTIL\b[^\n]*/i, untilLine)
    else next += `\n${untilLine}`
    return next
  }

  function buildReportUrl(storeKey, query) {
    const url = new URL(`/store/${storeKey}${DEFAULT_REPORT_PATH}`, 'https://admin.shopify.com')
    url.searchParams.set('ql', query || DEFAULT_QUERY)
    return url.href
  }

  function isReportPage() {
    return String(location.hostname || '') === 'admin.shopify.com' &&
      /\/store\/[^/]+\/analytics\/reports\/sessions_over_time/.test(String(location.pathname || ''))
  }

  function shouldNavigateForDate(requested) {
    if (isReportPage() && currentStoreKeyFromUrl() && currentStoreKeyFromUrl() !== readStoreKey()) return true
    if (!requested.range) return !isReportPage()
    const ql = readShopifyQlFromUrl()
    return !isReportPage() || !ql.includes(`SINCE ${requested.range.start}`) || !ql.includes(`UNTIL ${requested.range.end}`)
  }

  function readCurrency() {
    const text = compact(document.body?.innerText || '')
    const match = text.match(/\b([A-Z]{3})\s*(?:[$€£¥]|[A-Z]{0,3})\b/)
    return match ? match[1] : ''
  }

  function readTimeFilterLabel() {
    const controls = Array.from(document.querySelectorAll('button,[role="button"],input,[aria-label]') || [])
    for (const node of controls) {
      const text = compact(node.innerText || node.textContent || node.value || node.getAttribute?.('aria-label') || '')
      if (/日期范围控件|过去|最近|今天|昨天|\d{4}/.test(text) && !/比较/.test(text)) {
        return text.replace(/^日期范围控件：/, '')
      }
    }
    return ''
  }

  function readCompareLabel() {
    const controls = Array.from(document.querySelectorAll('button,[role="button"],input,[aria-label]') || [])
    for (const node of controls) {
      const text = compact(node.innerText || node.textContent || node.value || node.getAttribute?.('aria-label') || '')
      if (/比较控件|比较|previous|对比|\d{4}/i.test(text)) {
        return text.replace(/^比较控件：/, '')
      }
    }
    return ''
  }

  function readFilterSummary() {
    const text = compact(document.body?.innerText || '')
    const match = text.match(/筛选条件\s+(.+?)(?:调整侧边栏大小|自由形式|$)/)
    return compact(match?.[1] || '')
  }

  function readReportName() {
    const text = compact(document.body?.innerText || '')
    if (/访问随时间变化/.test(text)) return '访问随时间变化'
    return compact(document.title || '').split('·').map(compact).find(part => /访问|报告|sessions/i.test(part)) || '访问随时间变化'
  }

  function splitRowValues(text) {
    return compact(text).match(/(\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日-\d{4}年\d{1,2}月\d{1,2}日|\d{4}年年\d{1,2}月\d{1,2}日日-\d{1,2}日日|\d{1,3}(?:,\d{3})*(?:\.\d+)?%?|\d+(?:\.\d+)?%?|[-+]\d+(?:\.\d+)?%?)/g) || []
  }

  function extractRenderedTableRows() {
    const tables = Array.from(document.querySelectorAll('[role="table"], table') || [])
    const candidates = []
    for (const table of tables) {
      const rows = Array.from(table.querySelectorAll?.('tr,[role="row"]') || [])
        .map(row => compact(row.innerText || row.textContent || ''))
        .filter(Boolean)
      if (rows.some(row => /在线商店访客/.test(row)) && rows.some(row => /访问/.test(row))) {
        candidates.push(rows)
      }
    }
    if (candidates.length) return candidates.sort((a, b) => b.length - a.length)[0]
    return String(document.body?.innerText || '')
      .split(/\n+/)
      .map(compact)
      .filter(row => /在线商店访客|访问|\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日/.test(row))
  }

  function parseTableRows() {
    const rows = extractRenderedTableRows()
    const summaryRow = rows.find(row => /变化百分比/.test(row) && /\d/.test(row))
    const detailRows = rows.filter(row => /^\d{4}年\d{1,2}月\d{1,2}日/.test(row))
    const parsed = []
    let primaryRange = null
    let compareRange = null
    if (summaryRow) {
      const ranges = []
      const rangePattern = /(\d{1,2}月\d{1,2}日\s*-\s*\d{4}年\d{1,2}月\d{1,2}日|\d{4}年年?\d{1,2}月\d{1,2}日(?:日)?\s*-\s*\d{1,2}日(?:日)?|\d{4}年\d{1,2}月\d{1,2}日\s*-\s*\d{4}年\d{1,2}月\d{1,2}日)/g
      for (const match of summaryRow.replace(/[–—]/g, '-').matchAll(rangePattern)) {
        const range = parseDateRangeText(match[1])
        if (range) ranges.push(range)
      }
      primaryRange = ranges[0] || null
      compareRange = ranges[1] || null
      const values = splitRowValues(summaryRow)
        .filter(value => !/月|年/.test(value))
      const numericTail = values.slice(-6)
      if (numericTail.length >= 6) {
        parsed.push({
          dataType: '汇总',
          statDate: '',
          compareDate: '',
          onlineStoreVisitors: numericTail[0],
          compareOnlineStoreVisitors: numericTail[1],
          onlineStoreVisitorsChange: numericTail[2],
          sessions: numericTail[3],
          compareSessions: numericTail[4],
          sessionsChange: numericTail[5],
        })
      }
    }

    for (const row of detailRows) {
      const dates = Array.from(row.matchAll(/(\d{4}年\d{1,2}月\d{1,2}日)/g)).map(match => parseDateText(match[1]))
      const values = splitRowValues(row).filter(value => !/月|年/.test(value))
      if (dates.length >= 2 && values.length >= 4) {
        parsed.push({
          dataType: '明细',
          statDate: dates[0],
          compareDate: dates[1],
          onlineStoreVisitors: values[0],
          compareOnlineStoreVisitors: values[1],
          onlineStoreVisitorsChange: '',
          sessions: values[2],
          compareSessions: values[3],
          sessionsChange: '',
        })
      }
    }
    return { rows: parsed, primaryRange, compareRange }
  }

  function nowText() {
    const date = new Date()
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  function fail(message) {
    return { success: false, error: String(message || '未知错误') }
  }

  function nextPhase(name, sleepMs, nextShared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'next_phase',
        next_phase: name,
        sleep_ms: sleepMs,
        shared: nextShared,
      },
    }
  }

  function complete(data, nextShared) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: false,
        shared: nextShared,
      },
    }
  }

  try {
    const storeKey = readStoreKey()
    const requested = resolveRequestedDateRange()
    const currentQl = readShopifyQlFromUrl() || DEFAULT_QUERY
    if (shouldNavigateForDate(requested)) {
      const query = requested.range ? replaceShopifyQlDateRange(currentQl, requested.range) : currentQl
      const targetUrl = buildReportUrl(storeKey, query)
      location.href = targetUrl
      return nextPhase('main', 2500, {
        ...shared,
        target_url: targetUrl,
        store_key: storeKey,
        requested_date_range: requested.range ? dateRangeLabel(requested.range) : '',
      })
    }

    const table = parseTableRows()
    if (!table.rows.length) {
      return fail('未在 Shopify 报告页面读取到客流表格数据，请确认页面已加载完成并显示“天 / 在线商店访客 / 访问”表格')
    }
    const compareFromControl = parseDateRangeText(readCompareLabel())
    const dateRange = requested.range || table.primaryRange || null
    const compareRange = table.compareRange || compareFromControl || null
    const shopifyQl = readShopifyQlFromUrl() || currentQl
    const capturedAt = nowText()
    const base = {
      平台名称: 'Shopify',
      店铺标识: storeKey,
      店铺名称: readShopName(),
      报告名称: readReportName(),
      统计日期范围: dateRangeLabel(dateRange),
      对比日期范围: dateRangeLabel(compareRange),
      货币: readCurrency(),
      时间筛选: requested.mode === 'page' ? readTimeFilterLabel() : requested.label,
      筛选条件: readFilterSummary(),
      ShopifyQL: shopifyQl,
      抓取时间: capturedAt,
    }
    const data = table.rows.map(row => ({
      ...base,
      数据类型: row.dataType,
      统计日期: row.statDate,
      对比日期: row.compareDate,
      在线商店访客: row.onlineStoreVisitors,
      对比在线商店访客: row.compareOnlineStoreVisitors,
      在线商店访客变化: row.onlineStoreVisitorsChange,
      访问: row.sessions,
      对比访问: row.compareSessions,
      访问变化: row.sessionsChange,
    }))
    return complete(data, {
      ...shared,
      store_key: storeKey,
      shop_key: storeKey,
      shop_name: base.店铺名称,
      report_name: base.报告名称,
      date_range: base.统计日期范围,
      compare_date_range: base.对比日期范围,
      time_range_label: base.时间筛选,
      total_rows: data.length,
      current_exec_no: data.length,
      current_store: `Shopify客流数据 / ${storeKey}`,
      search_total_codes: 1,
      search_completed_codes: 1,
    })
  } catch (error) {
    return fail(error?.message || error)
  }
})()
