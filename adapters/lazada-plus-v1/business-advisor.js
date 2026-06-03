;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const SITE_MAP = {
    MY: { code: 'MY', label: 'Malaysia', domain: 'https://sellercenter.lazada.com.my' },
    SG: { code: 'SG', label: 'Singapore', domain: 'https://sellercenter.lazada.sg' },
    ID: { code: 'ID', label: 'Indonesia', domain: 'https://sellercenter.lazada.co.id' },
    PH: { code: 'PH', label: 'Philippines', domain: 'https://sellercenter.lazada.com.ph' },
    TH: { code: 'TH', label: 'Thailand', domain: 'https://sellercenter.lazada.co.th' },
    VN: { code: 'VN', label: 'Vietnam', domain: 'https://sellercenter.lazada.vn' },
  }
  const DEFAULT_COUNTRY_ORDER = ['MY', 'SG', 'ID', 'PH', 'TH', 'VN']

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

  function splitValues(value) {
    if (Array.isArray(value)) return value.flatMap(splitValues)
    return compact(value)
      .split(/[\s,，;；、]+/)
      .map(item => item.trim())
      .filter(Boolean)
  }

  function unique(values) {
    const seen = new Set()
    const result = []
    for (const value of values || []) {
      const text = compact(value)
      if (!text || seen.has(text)) continue
      seen.add(text)
      result.push(text)
    }
    return result
  }

  function currentCountryFromHref(href = location.href) {
    let host = ''
    try {
      host = new URL(href).hostname.toLowerCase()
    } catch (error) {
      host = String(location.hostname || '').toLowerCase()
    }
    return Object.values(SITE_MAP).find(site => {
      try {
        return new URL(site.domain).hostname.toLowerCase() === host
      } catch (error) {
        return false
      }
    })?.code || compact(window.__venture__).toUpperCase() || 'PH'
  }

  function normalizeCountry(value) {
    const text = compact(value).toUpperCase()
    if (text === 'ALL') return 'ALL'
    if (SITE_MAP[text]) return text
    const matched = Object.values(SITE_MAP).find(site => {
      return site.label.toUpperCase() === text || site.code === text
    })
    return matched?.code || ''
  }

  function resolveCountries() {
    if (Array.isArray(shared.countries) && shared.countries.length) return [...shared.countries]
    const requested = splitValues(params.countries || params.country_codes || params.country || params.regions)
      .map(normalizeCountry)
      .filter(Boolean)
    if (requested.some(item => item === 'ALL')) return [...DEFAULT_COUNTRY_ORDER]
    const selected = requested.filter(code => SITE_MAP[code])
    return unique(selected.length ? selected : [currentCountryFromHref()])
  }

  function normalizeTimeRange(value) {
    const text = compact(value).toLowerCase()
    if (!text || ['page', 'current', '页面当前筛选', '沿用页面当前筛选'].includes(text)) return 'page'
    if (['recent1', 'yesterday', 'last1', '昨天'].includes(text)) return 'recent1'
    if (['recent7', 'last7', '最近7天'].includes(text)) return 'recent7'
    if (['recent30', 'last30', '最近30天'].includes(text)) return 'recent30'
    if (['day', '按日', '日'].includes(text)) return 'day'
    if (['week', '按周', '周'].includes(text)) return 'week'
    if (['month', '按月', '月'].includes(text)) return 'month'
    if (['custom', '自定义', '自定义日期'].includes(text)) return 'custom'
    return text
  }

  function timeRangeLabel(dateType) {
    const type = normalizeTimeRange(dateType)
    if (type === 'recent1') return '昨天'
    if (type === 'recent7') return '最近7天'
    if (type === 'recent30') return '最近30天'
    if (type === 'day') return '按日'
    if (type === 'week') return '按周'
    if (type === 'month') return '按月'
    if (type === 'custom') return '自定义日期'
    return '沿用页面当前筛选'
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

  function dateRangeLabel(descriptor) {
    return `${descriptor.start} ~ ${descriptor.end}`
  }

  function readPageDateDescriptor() {
    try {
      const query = new URLSearchParams(location.search || '')
      const dateRange = compact(query.get('dateRange'))
      const parts = dateRange.split('|').map(parseDateText).filter(Boolean)
      if (parts.length >= 2) {
        return {
          start: parts[0],
          end: parts[1],
          dateType: compact(query.get('dateType')) || 'day',
          label: timeRangeLabel(query.get('dateType')),
        }
      }
    } catch (error) {}
    return null
  }

  function quickDescriptor(type) {
    const today = dateText(new Date())
    const end = addDays(today, -1)
    if (type === 'recent1') return { start: end, end, dateType: 'recent1', label: '昨天' }
    const days = type === 'recent30' ? 30 : 7
    return {
      start: addDays(end, -days + 1),
      end,
      dateType: type === 'recent30' ? 'recent30' : 'recent7',
      label: type === 'recent30' ? '最近30天' : '最近7天',
    }
  }

  function resolveDateDescriptor() {
    if (shared.date_descriptor && typeof shared.date_descriptor === 'object') return { ...shared.date_descriptor }
    const custom = parseDateRangeParam(params.date_range || params.custom_range || params.stat_date_range)
    const normalized = normalizeTimeRange(params.time_range || params.stat_time_range)
    if (custom) return { ...custom, dateType: 'day', label: normalized === 'custom' ? '自定义日期' : timeRangeLabel(normalized) }
    if (normalized === 'custom') throw new Error('选择自定义日期时，请填写开始和结束日期')
    if (['recent1', 'recent7', 'recent30'].includes(normalized)) return quickDescriptor(normalized)
    if (['day', 'week', 'month'].includes(normalized)) {
      return readPageDateDescriptor() || { ...quickDescriptor('recent1'), dateType: normalized, label: timeRangeLabel(normalized) }
    }
    return readPageDateDescriptor() || quickDescriptor('recent1')
  }

  function readSellerId() {
    const state = (() => {
      try { return window.store?.getState?.() || {} } catch (error) { return {} }
    })()
    return compact(window.sellerId || state?.seller?.sellerId || state?.user?.sellerId)
  }

  function buildDashboardUrl(country, descriptor) {
    const site = SITE_MAP[country] || SITE_MAP.PH
    const url = new URL('/ba/dashboard', site.domain)
    url.searchParams.set('dateRange', `${descriptor.start}|${descriptor.end}`)
    url.searchParams.set('dateType', descriptor.dateType || 'day')
    return url.href
  }

  function buildExportUrl(country, descriptor, sellerId) {
    const site = SITE_MAP[country] || SITE_MAP.PH
    const url = new URL('/ba/sycm/lazada/dashboard/key/overview/sycmExportV2.json', site.domain)
    url.searchParams.set('dateRange', `${descriptor.start}|${descriptor.end}`)
    url.searchParams.set('dateType', descriptor.dateType || 'day')
    url.searchParams.set('venture', country)
    if (sellerId) url.searchParams.set('sellerId', sellerId)
    return url.href
  }

  function sanitizeFilename(value) {
    return compact(value)
      .replace(/[\x00-\x1f]+/g, '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '')
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

  async function buildDownloadItem(exportUrl, filename, label) {
    if (typeof fetch !== 'function') {
      return {
        label,
        url: exportUrl,
        filename,
        browser_session: true,
        timeout_seconds: 90,
      }
    }

    const response = await fetch(exportUrl, { credentials: 'include' })
    if (!response.ok) {
      return fail(`Lazada 生意参谋导出接口返回失败：HTTP ${response.status}`)
    }
    const contentType = compact(response.headers?.get?.('content-type'))
    const serverFilename = contentDispositionFilename(response.headers?.get?.('content-disposition'))
    const buffer = await response.arrayBuffer()
    if (!buffer || buffer.byteLength < 4) return fail('Lazada 生意参谋导出文件为空')
    if (!isExcelBytes(buffer)) {
      let preview = ''
      try { preview = new TextDecoder().decode(buffer.slice(0, 240)) } catch (error) {}
      return fail(`Lazada 生意参谋导出不是有效 Excel 文件，请确认当前账号与筛选条件可导出（content-type: ${contentType || 'unknown'}${preview ? `, body: ${preview}` : ''}）`)
    }

    const mimeType = contentType || 'application/msexcel'
    return {
      label,
      filename,
      url: `data:${encodeURIComponent(mimeType)};base64,${arrayBufferToBase64(buffer)}`,
      source_url: exportUrl,
      server_filename: serverFilename,
      timeout_seconds: 30,
    }
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

  function complete(nextShared) {
    return {
      success: true,
      data: [],
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
    const countries = resolveCountries()
    const descriptor = resolveDateDescriptor()
    const countryIndex = Math.max(0, Math.min(Number(shared.country_index || 0) || 0, Math.max(countries.length - 1, 0)))
    const country = countries[countryIndex] || currentCountryFromHref()
    const currentCountry = currentCountryFromHref()
    const targetUrl = buildDashboardUrl(country, descriptor)

    if (!/\/ba\/dashboard/.test(String(location.pathname || '')) || currentCountry !== country) {
      location.href = targetUrl
      return nextPhase('main', 2200, {
        ...shared,
        countries,
        country_index: countryIndex,
        date_descriptor: descriptor,
        date_range: dateRangeLabel(descriptor),
        date_type: descriptor.dateType || 'day',
        time_range_label: descriptor.label || timeRangeLabel(descriptor.dateType),
        target_url: targetUrl,
        current_store: `Lazada生意参谋 / ${country}`,
      })
    }

    if (phase === 'after_download') {
      const result = shared.download_result || shared.downloadResult || {}
      const items = Array.isArray(result.items) ? result.items : []
      const failed = items.find(item => !item?.success)
      if (failed) return fail(`Lazada 生意参谋 ${country} 导出下载失败：${failed.error || failed.label || '未知错误'}`)
      const hasMore = countryIndex + 1 < countries.length
      const nextShared = {
        ...shared,
        countries,
        country_index: hasMore ? countryIndex + 1 : countryIndex,
        completed_count: (Number(shared.completed_count) || 0) + 1,
        total_rows: countries.length,
        current_exec_no: (Number(shared.current_exec_no) || 0) + 1,
        search_total_codes: countries.length,
        search_completed_codes: (Number(shared.search_completed_codes) || 0) + 1,
        current_country: country,
        current_store: `Lazada生意参谋 / ${country}`,
      }
      if (hasMore) return nextPhase('main', 800, nextShared)
      return complete(nextShared)
    }

    const sellerId = readSellerId()
    const exportUrl = buildExportUrl(country, descriptor, sellerId)
    const filename = sanitizeFilename(`Lazada生意参谋_${country}_${descriptor.start}~${descriptor.end}.xls`)
    const nextShared = {
      ...shared,
      countries,
      country_index: countryIndex,
      current_country: country,
      seller_id: sellerId,
      date_descriptor: descriptor,
      date_range: dateRangeLabel(descriptor),
      date_type: descriptor.dateType || 'day',
      time_range_label: descriptor.label || timeRangeLabel(descriptor.dateType),
      export_url: exportUrl,
      export_filename: filename,
      target_url: targetUrl,
      total_rows: countries.length,
      current_exec_no: countryIndex + 1,
      current_store: `Lazada生意参谋 / ${country}`,
      search_total_codes: countries.length,
      search_completed_codes: Number(shared.search_completed_codes) || 0,
    }

    const downloadItem = await buildDownloadItem(exportUrl, filename, `Lazada 生意参谋 / ${country}`)
    if (downloadItem && downloadItem.success === false) return downloadItem

    return {
      success: true,
      data: [],
      meta: {
        action: 'download_urls',
        strict: true,
        shared_key: 'download_result',
        concurrency: 1,
        retry_attempts: 2,
        retry_delay_ms: 1200,
        timeout_seconds: 90,
        progress_total: countries.length,
        progress_completed_offset: countryIndex,
        progress_success_offset: countryIndex,
        items: [downloadItem],
        next_phase: 'after_download',
        shared: nextShared,
      },
    }
  } catch (error) {
    return fail(error?.message || error)
  }
})()
