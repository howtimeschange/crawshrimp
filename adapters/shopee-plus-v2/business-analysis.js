;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const TARGET_URL = 'https://seller.shopee.cn/datacenter/home'
  const ORDER_TYPE_LABELS = {
    placed: '已下订单',
    paid: '已付款订单',
    confirmed: '已确定订单',
  }

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function pad(value) {
    return String(value).padStart(2, '0')
  }

  function dateText(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }

  function parseDateText(value) {
    const text = compact(value)
    const match = text.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
    if (!match) return ''
    return `${match[1]}-${pad(match[2])}-${pad(match[3])}`
  }

  function addDays(value, days) {
    const [year, month, day] = String(value || '').split('-').map(Number)
    if (!year || !month || !day) return ''
    return dateText(new Date(year, month - 1, day + Number(days || 0)))
  }

  function shanghaiDateText(date) {
    const shifted = new Date(date.getTime() + 8 * 3600 * 1000)
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
  }

  function startEpochShanghai(dateTextValue) {
    const [year, month, day] = String(dateTextValue || '').split('-').map(Number)
    if (!year || !month || !day) return 0
    return Math.floor((Date.UTC(year, month - 1, day, 0, 0, 0) - 8 * 3600 * 1000) / 1000)
  }

  function endExclusiveEpochShanghai(dateTextValue) {
    return startEpochShanghai(addDays(dateTextValue, 1))
  }

  function nowText() {
    const date = new Date()
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  function safeJsonParse(value) {
    if (!value) return null
    if (typeof value === 'object') return value
    try {
      return JSON.parse(String(value))
    } catch (error) {
      return null
    }
  }

  function normalizeTimeRange(value) {
    const text = compact(value).toLowerCase()
    if (!text || text === 'page' || text === 'current' || text === '页面当前筛选' || text === '沿用页面当前筛选') return 'page'
    if (['real_time', 'realtime', 'today', '今日实时'].includes(text)) return 'real_time'
    if (['yesterday', '昨天'].includes(text)) return 'yesterday'
    if (['last7', 'past7days', 'recent7', '最近7天'].includes(text)) return 'past7days'
    if (['last30', 'past30days', 'recent30', '最近30天'].includes(text)) return 'past30days'
    if (['custom', '自定义', '自定义日期'].includes(text)) return 'custom'
    return text
  }

  function timeRangeLabel(value) {
    const normalized = normalizeTimeRange(value)
    if (normalized === 'real_time') return '今日实时'
    if (normalized === 'yesterday') return '昨天'
    if (normalized === 'past7days') return '最近7天'
    if (normalized === 'past30days') return '最近30天'
    if (normalized === 'custom') return '自定义日期'
    return '沿用页面当前筛选'
  }

  function dateRangeLabel(descriptor) {
    return `${descriptor.startDate} ~ ${descriptor.endDate}`
  }

  function parseDateRangeParam(value) {
    const candidates = []
    if (value && typeof value === 'object') {
      candidates.push([value.start || value.from || value.begin || value.start_date, value.end || value.to || value.finish || value.end_date])
    }
    candidates.push([
      params.custom_start || params.start_date || params.stat_start,
      params.custom_end || params.end_date || params.stat_end,
    ])
    const pair = candidates
      .map(([startValue, endValue]) => [parseDateText(startValue), parseDateText(endValue)])
      .find(([start, end]) => start && end)
    if (!pair) return null
    const [start, end] = pair
    return {
      period: 'day',
      startTime: startEpochShanghai(start),
      endTime: endExclusiveEpochShanghai(end),
      startDate: start,
      endDate: end,
      label: '自定义日期',
    }
  }

  function readPageDateDescriptor() {
    const stored = safeJsonParse(sessionStorage.getItem('datacenter.cnscHomeDateRange'))
    const startDate = stored?.startTime ? new Date(stored.startTime) : null
    const endDate = stored?.endTime ? new Date(stored.endTime) : null
    if (startDate && !Number.isNaN(startDate.getTime()) && endDate && !Number.isNaN(endDate.getTime())) {
      const shortcut = Number(stored.shortcut || 0)
      const periodByShortcut = {
        1: 'real_time',
        2: 'yesterday',
        3: 'past7days',
        4: 'past30days',
        5: 'day',
        6: 'week',
        7: 'month',
        10: 'year',
      }
      return {
        period: periodByShortcut[shortcut] || 'real_time',
        startTime: Math.floor(startDate.getTime() / 1000),
        endTime: Math.floor(endDate.getTime() / 1000),
        startDate: shanghaiDateText(startDate),
        endDate: shanghaiDateText(new Date(Math.max(startDate.getTime(), endDate.getTime() - 1000))),
        label: compact(stored.dateLabel) || timeRangeLabel(periodByShortcut[shortcut] || 'real_time'),
      }
    }
    return null
  }

  function quickDescriptor(range) {
    const today = dateText(new Date())
    if (range === 'yesterday') {
      const day = addDays(today, -1)
      return {
        period: 'yesterday',
        startTime: startEpochShanghai(day),
        endTime: endExclusiveEpochShanghai(day),
        startDate: day,
        endDate: day,
        label: '昨天',
      }
    }
    const days = range === 'past30days' ? 30 : 7
    const start = addDays(today, -days + 1)
    return {
      period: range === 'past30days' ? 'past30days' : 'past7days',
      startTime: startEpochShanghai(start),
      endTime: endExclusiveEpochShanghai(today),
      startDate: start,
      endDate: today,
      label: range === 'past30days' ? '最近30天' : '最近7天',
    }
  }

  function realTimeDescriptor() {
    const today = dateText(new Date())
    return {
      period: 'real_time',
      startTime: startEpochShanghai(today),
      endTime: Math.floor(Date.now() / 1000),
      startDate: today,
      endDate: today,
      label: '今日实时',
    }
  }

  function resolveDateDescriptor() {
    if (shared.date_descriptor && typeof shared.date_descriptor === 'object') return { ...shared.date_descriptor }
    const custom = parseDateRangeParam(params.date_range || params.custom_range || params.stat_date_range)
    if (custom) return custom
    const normalized = normalizeTimeRange(params.time_range || params.stat_time_range)
    if (normalized === 'custom') throw new Error('选择自定义日期时，请填写开始和结束日期')
    if (normalized === 'yesterday' || normalized === 'past7days' || normalized === 'past30days') return quickDescriptor(normalized)
    if (normalized === 'real_time') return realTimeDescriptor()
    return readPageDateDescriptor() || realTimeDescriptor()
  }

  function readVisibleText(selector) {
    return compact(Array.from(document.querySelectorAll(selector) || [])
      .map(el => compact(el?.innerText || el?.textContent || el?.value || ''))
      .find(Boolean))
  }

  function readShopScope() {
    const requested = compact(params.shop_scope || params.shopScope).toLowerCase()
    const pageText = readVisibleText('.shop-select') || '所有店铺'
    if (requested === 'all' || requested === 'all_shops') return { type: 'all', label: '所有店铺', pageText }
    if (requested === 'current' || requested === 'current_shop') return { type: 'current', label: pageText || '当前店铺', pageText }
    if (/所有店铺|all shops/i.test(pageText)) return { type: 'all', label: pageText || '所有店铺', pageText }
    return { type: 'current', label: pageText || '当前店铺', pageText }
  }

  function normalizeOrderType(value) {
    const text = compact(value).toLowerCase()
    if (['placed', 'paid', 'confirmed'].includes(text)) return text
    if (/已下|placed/.test(text)) return 'placed'
    if (/已付|paid/.test(text)) return 'paid'
    if (/已确|confirmed/.test(text)) return 'confirmed'
    return ''
  }

  function readOrderType() {
    const requested = normalizeOrderType(params.order_type || params.orderType)
    if (requested) return requested
    const stored = normalizeOrderType(localStorage.getItem('datacenter.orderType'))
    if (stored) return stored
    return normalizeOrderType(readVisibleText('.order-type-select')) || 'confirmed'
  }

  function currentCnscShopId() {
    try {
      return compact(new URL(location.href).searchParams.get('cnsc_shop_id'))
    } catch (error) {
      return ''
    }
  }

  function buildQuery(items) {
    return items
      .filter(([key, value]) => compact(key) && compact(value) !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&')
  }

  function buildExportUrl(descriptor, shopScope) {
    const path = shopScope.type === 'current'
      ? '/api/mydata/cnsc/shop/v2/dashboard/export/'
      : '/api/mydata/cnsc/merchant/v2/dashboard/export/'
    const query = [
      ['period', descriptor.period || 'real_time'],
      ['start_time', descriptor.startTime],
      ['end_time', descriptor.endTime],
    ]
    const shopId = currentCnscShopId()
    if (shopScope.type === 'current' && shopId) query.push(['cnsc_shop_id', shopId])
    return `${path}?${buildQuery(query)}`
  }

  function contentDispositionFilename(value) {
    const text = compact(value)
    const utf = text.match(/filename\*=UTF-8''([^;]+)/i)
    if (utf) {
      try { return decodeURIComponent(utf[1]) } catch (error) {}
    }
    const plain = text.match(/filename="?([^";]+)"?/i)
    return plain ? compact(plain[1]) : ''
  }

  function sanitizeFilename(value, fallback) {
    return compact(value || fallback)
      .replace(/[\x00-\x1f]+/g, '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '') || fallback
  }

  function isExcelBytes(buffer) {
    if (!buffer || buffer.byteLength < 4) return false
    const bytes = new Uint8Array(buffer.slice(0, 8))
    return (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0)
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer)
    const chunkSize = 0x8000
    let binary = ''
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize)
      binary += String.fromCharCode.apply(null, chunk)
    }
    return btoa(binary)
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

  function fail(message) {
    return { success: false, error: String(message || '未知错误') }
  }

  try {
    if (!/^https:\/\/seller\.shopee\.cn\/datacenter\/home/.test(String(location.href || ''))) {
      const target = params.entry_url || TARGET_URL
      location.href = target
      return nextPhase('main', 2200, { ...shared, target_url: target })
    }

    if (phase === 'after_download') {
      const result = shared.download_result || shared.downloadResult || {}
      const items = Array.isArray(result.items) ? result.items : []
      const failed = items.find(item => !item?.success)
      if (failed) return fail(`Shopee 商业分析导出下载失败：${failed.error || failed.label || '未知错误'}`)
      return complete([], {
        ...shared,
        current_exec_no: 1,
        completed_count: 1,
        total_rows: 1,
        current_store: `Shopee商业分析 / ${shared.shop_scope_label || '页面当前店铺'}`,
      })
    }

    const descriptor = resolveDateDescriptor()
    const shopScope = readShopScope()
    const orderType = readOrderType()
    const exportUrl = buildExportUrl(descriptor, shopScope)
    const response = await fetch(exportUrl, { credentials: 'include' })
    if (!response.ok) {
      return fail(`Shopee 商业分析导出接口返回失败：HTTP ${response.status}`)
    }
    const contentType = compact(response.headers?.get?.('content-type'))
    const serverFilename = contentDispositionFilename(response.headers?.get?.('content-disposition'))
    const buffer = await response.arrayBuffer()
    if (!buffer || buffer.byteLength < 4) return fail('Shopee 商业分析导出文件为空')
    if (!isExcelBytes(buffer)) {
      return fail(`Shopee 商业分析导出不是有效 Excel 文件，请确认当前页面已登录且筛选条件可导出（content-type: ${contentType || 'unknown'}）`)
    }

    const stableFilename = sanitizeFilename(
      `Shopee商业分析_${shopScope.label}_${descriptor.startDate}~${descriptor.endDate}.xlsx`,
      serverFilename || 'Shopee商业分析.xlsx',
    )
    const mimeType = contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    const dataUrl = `data:${encodeURIComponent(mimeType)};base64,${arrayBufferToBase64(buffer)}`

    const nextShared = {
      ...shared,
      date_descriptor: descriptor,
      date_range: dateRangeLabel(descriptor),
      time_range_label: descriptor.label || timeRangeLabel(descriptor.period),
      shop_scope: shopScope.type,
      shop_scope_label: shopScope.label,
      order_type: orderType,
      order_type_label: ORDER_TYPE_LABELS[orderType] || orderType,
      export_url: exportUrl,
      export_filename: stableFilename,
      server_filename: serverFilename,
      captured_at: nowText(),
      current_store: `Shopee商业分析 / ${shopScope.label}`,
      search_total_codes: 1,
      search_completed_codes: 0,
    }

    return {
      success: true,
      data: [],
      meta: {
        action: 'download_urls',
        strict: true,
        shared_key: 'download_result',
        items: [{
          label: 'Shopee 商业分析',
          filename: stableFilename,
          url: dataUrl,
          source_url: exportUrl,
          timeout_seconds: 30,
        }],
        next_phase: 'after_download',
        shared: nextShared,
      },
    }
  } catch (error) {
    return fail(error?.message || error)
  }
})()
