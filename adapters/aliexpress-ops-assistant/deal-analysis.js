;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const DEFAULT_CHANNEL_ID = '125417'
  const TARGET_PATH = '/m_apps/sycm/MakeBargainAnalysis'
  const TARGET_URL = `https://csp.aliexpress.com${TARGET_PATH}?channelId=${DEFAULT_CHANNEL_ID}`
  const DPS_API = 'mtop.aliexpress.dps.query'
  const DATA_DELAY_API = 'mtop.aliexpress.seller.data.delay.plan'
  const OVERVIEW_SERVICE_KEY = 'tradeOverviewCard'
  const TREND_SERVICE_KEY = 'tradeTrend'
  const OVERVIEW_INDICATORS = [
    'payAmt',
    'divPayableTaxAmt',
    'payBuyerCnt',
    'vstPayRate',
    'avgPayAmt',
    'payOldBuyerCntRate',
    'payOrderCnt',
    'payItemQty',
  ]
  const METRIC_GROUP = {
    payAmt: '支付',
    divPayableTaxAmt: '支付',
    payBuyerCnt: '支付',
    vstPayRate: '支付',
    avgPayAmt: '支付',
    payOldBuyerCntRate: '支付',
    payOrderCnt: '支付',
    payItemQty: '支付',
    payOrderAmt: '支付',
    uv: '流量',
    payAmtAvg: '支付',
  }

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function numberOrString(value) {
    if (value == null || value === '') return ''
    if (typeof value === 'number' && Number.isFinite(value)) return value
    const text = compact(value).replace(/,/g, '')
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
    return compact(value)
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

  function todayText() {
    return dateText(new Date())
  }

  function nowText() {
    const date = new Date()
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  function dateRangeLabel(descriptor) {
    return `${descriptor.start} ~ ${descriptor.end}`
  }

  function readUrlParam(name, href = String(location.href || '')) {
    try {
      return new URL(href).searchParams.get(name) || ''
    } catch (error) {
      return ''
    }
  }

  function normalizeChannelId(value) {
    return compact(value) || compact(readUrlParam('channelId')) || DEFAULT_CHANNEL_ID
  }

  function buildTargetUrl() {
    const channelId = normalizeChannelId(params.channel_id)
    return `https://csp.aliexpress.com${TARGET_PATH}?channelId=${encodeURIComponent(channelId)}`
  }

  function isTargetPage() {
    return /csp\.aliexpress\.com$/i.test(String(location.hostname || '')) &&
      String(location.pathname || '').includes(TARGET_PATH)
  }

  function readShopName() {
    const lines = String(document.body?.innerText || '')
      .split(/\n+/)
      .map(compact)
      .filter(Boolean)
    const marker = lines.find(line => /Official Store|Store|Tienda|店/i.test(line))
    return marker || lines[0] || ''
  }

  function readInputDates() {
    return Array.from(document.querySelectorAll('input') || [])
      .map(input => parseDateText(input?.value || input?.getAttribute?.('value') || ''))
      .filter(Boolean)
  }

  function normalizeTimeRange(value) {
    const text = compact(value).toLowerCase()
    if (!text || text === 'page' || text === 'current') return 'page'
    if (['recent1', 'last1', 'day', '最近一天'].includes(text)) return 'recent1'
    if (['recent7', 'last7', '最近7天', '最近七天'].includes(text)) return 'recent7'
    if (['recent30', 'last30', '最近30天', '最近三十天'].includes(text)) return 'recent30'
    return text
  }

  function timeRangeLabel(dateType) {
    const normalized = normalizeTimeRange(dateType)
    if (normalized === 'recent7') return '最近7天'
    if (normalized === 'recent30') return '最近30天'
    return '最近一天'
  }

  function readPageDateType() {
    const text = String(document.body?.innerText || '')
    if (/最近\s*30\s*天/.test(text)) return 'recent30'
    if (/最近\s*7\s*天/.test(text)) return 'recent7'
    if (/最近\s*(一|1)\s*天/.test(text)) return 'recent1'
    return 'recent1'
  }

  function daysForDateType(dateType) {
    const normalized = normalizeTimeRange(dateType)
    if (normalized === 'recent7') return 7
    if (normalized === 'recent30') return 30
    return 1
  }

  function defaultAvailableStatDate() {
    return addDays(todayText(), -2) || todayText()
  }

  async function resolveAvailableStatDate(channelId) {
    try {
      const payload = await callMtop({
        api: DATA_DELAY_API,
        type: 'POST',
        data: { channelId },
      })
      const models = Array.isArray(payload?.data?.pageModels) ? payload.data.pageModels : []
      const model = models.find(item => item?.pageModel === 'MakeBargainAnalysis')
      if (model && Number.isFinite(Number(model.dateSub))) {
        return addDays(todayText(), Number(model.dateSub))
      }
    } catch (error) {}
    return defaultAvailableStatDate()
  }

  function resolveStatDate(channelId) {
    const explicit = parseDateText(params.stat_date || params.date || params.target_date)
    if (explicit) return explicit
    if (shared.stat_date) return compact(shared.stat_date)
    const dates = readInputDates()
    return dates[0] || ''
  }

  function resolveCountry() {
    const code = compact(params.country || params.country_id || shared.country_code)
    if (code && !/^page$/i.test(code)) {
      return {
        code,
        label: compact(params.country_label || shared.country_label) || (code === 'AllCountries' ? '全部国家' : code),
      }
    }
    return {
      code: 'AllCountries',
      label: '全部国家',
    }
  }

  function resolveBizType() {
    const code = compact(params.biz_type || params.bizType || shared.biz_type_code)
    if (code && !/^page$/i.test(code)) {
      return {
        code,
        label: compact(params.biz_type_label || shared.biz_type_label) || (code === 'ALL' ? '全部' : code),
      }
    }
    return {
      code: 'ALL',
      label: '全部',
    }
  }

  function resolveDateDescriptor(statDate, dateType) {
    const days = daysForDateType(dateType)
    return {
      start: addDays(statDate, -days + 1) || statDate,
      end: statDate,
    }
  }

  function buildBaseRow(context, dataType, statDate, metric) {
    return {
      平台名称: 'AliExpress',
      店铺名称: context.shopName,
      channelId: context.channelId,
      数据类型: dataType,
      统计日期: statDate,
      统计日期范围: dateRangeLabel(context.dateDescriptor),
      时间筛选: timeRangeLabel(context.dateType),
      国家: context.country.label,
      国家编码: context.country.code,
      业务模式: context.bizType.label,
      业务模式编码: context.bizType.code,
      指标分组: METRIC_GROUP[metric.key] || '其他',
      指标编码: compact(metric.key),
      指标名称: compact(metric.label || metric.key),
      指标值: numberOrString(metric.value),
      环比标签: compact(metric.cycleLabel),
      环比值: numberOrString(metric.cycleData),
      同比标签: compact(metric.lineLabel),
      同比值: numberOrString(metric.lineData),
      抓取时间: context.capturedAt,
    }
  }

  function overviewRows(payload, context) {
    const source = Array.isArray(payload?.data?.dataSource) ? payload.data.dataSource : []
    return source
      .filter(item => item && compact(item.key))
      .map(item => buildBaseRow(context, '核心指标', context.statDate, item))
  }

  function trendRows(payload, context) {
    const source = Array.isArray(payload?.data?.dataSource) ? payload.data.dataSource : []
    return source
      .filter(item => item && compact(item.key) && compact(item.statDate))
      .map(item => buildBaseRow(context, '趋势明细', compact(item.statDate), item))
  }

  function getMtopClient() {
    const mtop = window?.lib?.mtop
    if (!mtop || typeof mtop.request !== 'function') return null
    return mtop
  }

  function getPayloadError(payload) {
    if (!payload || typeof payload !== 'object') return ''
    const ret = Array.isArray(payload.ret) ? payload.ret.join(';') : compact(payload.ret)
    if (/SUCCESS/i.test(ret)) return ''
    if (/FAIL|ERROR|DENY|LOGIN|验证|风控/i.test(ret)) return ret
    return ''
  }

  function callMtop(options) {
    const mtop = getMtopClient()
    if (!mtop) throw new Error('当前页面未找到 window.lib.mtop.request，请在已登录的速卖通生意参谋页面运行')
    const request = {
      v: '1.0',
      dataType: 'json',
      valueType: 'original',
      timeout: 30000,
      H5Request: true,
      ...options,
    }
    return new Promise((resolve, reject) => {
      function finish(payload) {
        const error = getPayloadError(payload)
        if (error) {
          reject(new Error(error))
          return
        }
        resolve(payload)
      }
      function fail(error) {
        reject(new Error(compact(error?.message) || getPayloadError(error) || JSON.stringify(error) || String(error)))
      }
      try {
        mtop.request(request, finish, fail)
      } catch (error) {
        fail(error)
      }
    })
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
    if (!isTargetPage()) {
      const targetUrl = buildTargetUrl()
      location.assign?.(targetUrl)
      if (location.href !== targetUrl) location.href = targetUrl
      return nextPhase('main', 2200, { ...shared, target_url: targetUrl })
    }

    const channelId = normalizeChannelId(params.channel_id)
    const dateType = normalizeTimeRange(params.time_range || params.date_type || shared.date_type)
    let statDate = resolveStatDate(channelId)
    if (!statDate || dateType !== 'page' && /^auto$/i.test(statDate)) {
      statDate = await resolveAvailableStatDate(channelId)
    }
    if (!statDate) statDate = await resolveAvailableStatDate(channelId)
    const normalizedDateType = dateType === 'page' ? readPageDateType() : dateType
    const context = {
      channelId,
      shopName: compact(shared.shop_name || params.shop_name) || readShopName(),
      statDate,
      dateType: normalizedDateType,
      dateDescriptor: resolveDateDescriptor(statDate, normalizedDateType),
      country: resolveCountry(),
      bizType: resolveBizType(),
      capturedAt: nowText(),
    }
    const overviewPayload = await callMtop({
      api: DPS_API,
      type: 'POST',
      data: {
        channelId,
        serviceKey: OVERVIEW_SERVICE_KEY,
        statDate,
        dateType: normalizedDateType,
        indicators: OVERVIEW_INDICATORS.join(','),
        bizType: context.bizType.code,
        params: JSON.stringify({ countryId: context.country.code }),
      },
    })
    const trendPayload = await callMtop({
      api: DPS_API,
      type: 'POST',
      data: {
        channelId,
        serviceKey: TREND_SERVICE_KEY,
        statDate,
        dateType: normalizedDateType,
        indicators: compact(params.trend_metric || shared.trend_metric) || 'payAmt',
        bizType: context.bizType.code,
        params: JSON.stringify({ countryId: context.country.code }),
      },
    })
    const rows = [
      ...overviewRows(overviewPayload, context),
      ...trendRows(trendPayload, context),
    ]
    return complete(rows, {
      ...shared,
      channel_id: channelId,
      shop_name: context.shopName,
      stat_date: statDate,
      date_range: dateRangeLabel(context.dateDescriptor),
      date_type: normalizedDateType,
      country_code: context.country.code,
      country_label: context.country.label,
      biz_type_code: context.bizType.code,
      biz_type_label: context.bizType.label,
      total_rows: rows.length,
      completed_count: rows.length,
      current_exec_no: rows.length,
      current_store: `速卖通成交分析 / ${timeRangeLabel(normalizedDateType)} / ${context.country.label}`,
    })
  } catch (error) {
    return {
      success: false,
      error: String(error?.message || error),
      meta: {
        action: 'complete',
        has_more: false,
        shared,
      },
    }
  }
})()
