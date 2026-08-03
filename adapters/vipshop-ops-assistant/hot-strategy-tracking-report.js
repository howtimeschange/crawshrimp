;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const SUMMARY_SHEET = '执行摘要'
  const COMPASS_SHEET = '魔方罗盘销售明细'
  const VZD_SHEET = '唯直达投放效果'
  const TMAX_SHEET = 'T-max效果'
  const BCT_GIFT_SHEET = '中台礼金'
  const BCT_SCENE_SHEET = '中台购物车跨品类券'

  const COMPASS_PAGE_URL = 'https://compass.vip.com/frontend/index.html#/product/details'
  const BCT_PAGE_URL = 'https://bct.vip.com/vendor_new_v2/index.html#/frontend/strategyEffect?tab=userLifecycle'
  const VIPDIRECT_PAGE_URL = 'https://e.vip.com/upgrade.html#/promotion/insite/search/report'
  const TMAX_PAGE_URL = 'https://e.vip.com/upgrade.html#/promotion/tmax/sptg/report-goods'
  const GOODS_DETAIL_URL = '/product/detail/getGoodsList'
  const BCT_AVAILABLE_BRAND_URL = '/bcc/authority/available_brand?_check_empty=1'
  const BCT_TOOLBOX_LIST_URL = '/bcc/toolbox_task/list'
  const MARKETING_CURRENT_USER_URL = '/user/current'
  const VIPDIRECT_REPORT_TABLE_URL = '/ck/report/table'
  const TMAX_GOODS_REPORT_URL = '/spugoods/report/table'
  const TMAX_HOT_GOODS_PERMISSION = 'vip:tmax:hot:goods:whitelist'
  const VIPDIRECT_DEFAULT_COLUMNS = [
    'COST',
    'IMPRESSION_COUNT',
    'CLICK_COUNT',
    'CLICK_RATE',
    'COST_PER_MILLE',
    'COST_PER_CLICK',
    'APP_UV',
    'MINIAPP_UV',
    'DETAIL_UV_1D',
    'BRAND_UV',
    'LIKE_CNT_1D',
    'ADDCART_CNT_1D',
    'COST_PER_ADDCART_1D',
    'BOOK_CUSTOMER_IN_24HOUR',
    'BOOK_ORDERS_24HOUR',
    'COST_PER_ORDER_1D',
    'BOOK_SALES_24HOUR',
    'BOOK_ROI_IN_24HOUR',
    'CUSTOMER_IN_24HOUR',
    'SALES_24HOUR',
    'ROI_IN_24HOUR',
    'GOODS_LIKE_CNT_1D',
    'GOODS_ADDCART_CNT_1D',
    'GOODS_COST_PER_ADDCART_1D',
    'GOODS_BOOK_CUSTOMER_IN_24HOUR',
    'GOODS_BOOK_ORDERS_24HOUR',
    'GOODS_COST_PER_ORDER_1D',
    'GOODS_BOOK_SALES_24HOUR',
    'GOODS_BOOK_ROI_IN_24HOUR',
    'GOODS_CUSTOMER_IN_24HOUR',
    'GOODS_SALES_24HOUR',
    'GOODS_ROI_IN_24HOUR',
  ]
  const VIPDIRECT_DEFAULT_REPORT_CHANNEL_TYPES = ['VSM']
  const VIPDIRECT_DEFAULT_DEAL_TYPES = ['RTB']
  const TMAX_DEFAULT_COLUMNS = '1,2,3,4,73'
  const TMAX_DEFAULT_MARKETING_SCENES = '3,4,5'
  const CHINA_TIMEZONE_OFFSET_HOURS = 8
  const DEFAULT_PAGE_SIZE = 300
  const DEFAULT_MAX_PAGES = 80
  const DEFAULT_DELAY_MS = 80
  const SUCCESS_CODES = ['0', '1', '200']

  const DEFAULT_REPORT_SCOPE = [
    'compass_sales_detail',
    'vipdirect_ads',
    'tmax_goods',
    'bct_gift',
    'bct_scene',
  ]

  const BCT_LIFECYCLE_TASK_TYPES = [13, 14, 15, 16, 17, 18, 19, 20, 23, 25, 32, 34, 35, 36]
  const BCT_SCENE_TASK_TYPES = [21, 22, 24, 26, 27, 28, 29, 30, 33, 37]

  const BCT_TASK_TYPE_LABELS = {
    13: '首单礼金',
    14: '二单礼金',
    15: '首单买赠',
    16: '二单买赠',
    17: '老客买赠',
    18: '首单品牌券',
    19: '二单品牌券',
    20: '老客品牌券',
    21: '惊喜品牌券',
    22: '购物车挽回',
    23: '二单复购营销',
    24: '跨品类营销',
    25: '老友品牌券',
    26: '周期购',
    27: '机会人群营销',
    28: '分享裂变',
    29: '试用派券',
    30: '特卖团',
    31: '营销快车-品牌券',
    32: '重逢礼金',
    33: '营销快车',
    34: '老友礼金',
    35: '惊喜码',
    36: '复购无忧',
    37: '实时营销',
    38: '智能优惠',
  }

  const BCT_STATUS_LABELS = {
    0: '草稿',
    1: '未开始',
    2: '进行中',
    3: '已结束',
    4: '已下线',
    5: '系统审核中',
    6: '审核不通过',
    7: '审核失败',
  }

  const RAW_PREFIX = '源字段/'

  function compact(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim()
  }

  function hasText(value) {
    return compact(value) !== ''
  }

  function normalizeCode(value) {
    return compact(value).replace(/[\s"'`]+/g, '').toUpperCase()
  }

  function normalizeDateValue(value) {
    const text = compact(value)
    if (!text) return ''
    const match = text.match(/(20\d{2})[-/.年]?\s*(\d{1,2})[-/.月]?\s*(\d{1,2})/)
    if (!match) return ''
    const [, year, month, day] = match
    return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`
  }

  function formatDate(value) {
    const ymd = normalizeDateValue(value)
    if (!ymd) return compact(value)
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
  }

  function normalizeDateTime(value, endOfDay = false) {
    const text = compact(value)
    const ymd = normalizeDateValue(text)
    if (!ymd) return ''
    const dateText = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
    const timeMatch = text.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/)
    if (timeMatch) {
      const parts = timeMatch[1].split(':')
      const hour = String(parts[0]).padStart(2, '0')
      const minute = String(parts[1] || '00').padStart(2, '0')
      const second = String(parts[2] || '00').padStart(2, '0')
      return `${dateText} ${hour}:${minute}:${second}`
    }
    return `${dateText} ${endOfDay ? '23:59:59' : '00:00:00'}`
  }

  function firstNonEmpty(...values) {
    for (const value of values) {
      if (hasText(value)) return compact(value)
    }
    return ''
  }

  function normalizeScope(rawScope = params.report_scope) {
    if (Array.isArray(rawScope)) {
      const values = rawScope.map(compact).filter(Boolean)
      return values.length ? values : DEFAULT_REPORT_SCOPE
    }
    const text = compact(rawScope)
    if (!text) return DEFAULT_REPORT_SCOPE
    return text.split(/[,，、\s]+/).map(compact).filter(Boolean)
  }

  function hasScope(scope, key) {
    return normalizeScope(scope).includes(key)
  }

  function wantsAny(scope, keys) {
    return keys.some(key => hasScope(scope, key))
  }

  function parseList(value) {
    if (Array.isArray(value)) return value.map(compact).filter(Boolean)
    return compact(value).split(/[\n,，、\s]+/).map(compact).filter(Boolean)
  }

  function parseNumberList(value) {
    return parseList(value).map(item => Number(item)).filter(item => Number.isFinite(item))
  }

  function getPageSize(kind = 'default', rawParams = params) {
    const max = kind === 'bct' ? 300 : 500
    const min = kind === 'bct' ? 10 : 20
    const specificKey = `${kind}_page_size`
    const raw = Number(rawParams[specificKey] || rawParams.page_size || DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE
    return Math.max(min, Math.min(max, raw))
  }

  function getMaxPages(rawParams = params) {
    return Math.max(1, Math.min(1000, Number(rawParams.max_pages || DEFAULT_MAX_PAGES) || DEFAULT_MAX_PAGES))
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  function currentHref() {
    return String(location?.href || '')
  }

  function isCompassPage(href = currentHref()) {
    return /^https:\/\/compass\.vip\.com\/.*#\/product\/details/i.test(String(href || ''))
  }

  function isBctPage(href = currentHref()) {
    return /^https:\/\/bct\.vip\.com\//i.test(String(href || ''))
  }

  function isMarketingLoggedInPage(href = currentHref(), bodyText = document?.body?.innerText || '') {
    const text = compact(bodyText)
    return /^https:\/\/e\.vip\.com\//i.test(String(href || ''))
      && !/passport\.vip\.com|登录|扫码登录|账号登录/i.test(`${href} ${text}`)
      && /唯直达|Target-Max|T-max|广告|投放|商品打爆|营销平台|账户/i.test(text)
  }

  function complete(data = [], nextShared = shared) {
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

  function nextPhase(nextPhaseName, data = [], nextShared = shared, sleepMs = 600) {
    return {
      success: true,
      data,
      meta: {
        action: 'next_phase',
        next_phase: nextPhaseName,
        sleep_ms: sleepMs,
        shared: nextShared,
      },
    }
  }

  function describeApiError(json, fallback = '接口失败') {
    const error = json?.error || {}
    const status = compact(error.statusCode)
    const message = compact(error.message || error.rawMessage || json?.message || json?.msg || fallback)
    return status ? `${status}：${message}` : message
  }

  async function postJson(url, payload, extraHeaders = {}) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        ...extraHeaders,
      },
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    let json
    try {
      json = JSON.parse(text)
    } catch (error) {
      throw new Error(`${url} 返回非 JSON：${text.slice(0, 160)}`)
    }
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}：${describeApiError(json, text.slice(0, 160))}`)
    if (json?.error) throw new Error(`${url} 返回错误：${describeApiError(json)}`)
    if (json && json.success === false) throw new Error(`${url} 返回失败：${describeApiError(json)}`)
    if (json && json.code != null && !SUCCESS_CODES.includes(String(json.code))) {
      throw new Error(`${url} 返回 code=${json.code}：${describeApiError(json)}`)
    }
    return json
  }

  async function getJson(url, extraHeaders = {}) {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest', ...extraHeaders },
    })
    const text = await response.text()
    let json
    try {
      json = JSON.parse(text)
    } catch (error) {
      throw new Error(`${url} 返回非 JSON：${text.slice(0, 160)}`)
    }
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}：${describeApiError(json, text.slice(0, 160))}`)
    if (json?.error) throw new Error(`${url} 返回错误：${describeApiError(json)}`)
    if (json && json.success === false) throw new Error(`${url} 返回失败：${describeApiError(json)}`)
    if (json && json.code != null && !SUCCESS_CODES.includes(String(json.code))) {
      throw new Error(`${url} 返回 code=${json.code}：${describeApiError(json)}`)
    }
    return json
  }

  async function getTmaxJson(url, advertiserId) {
    if (!hasText(advertiserId)) throw new Error('营销平台当前用户未返回 advertiserId，无法读取 T-max 商品打爆报表。')
    return getJson(url, { advid: advertiserId })
  }

  async function collectPagedRows(options) {
    const rows = []
    let total = null
    let pages = 0
    for (let pageNo = 1; pageNo <= options.maxPages; pageNo += 1) {
      const json = await postJson(options.url, options.buildPayload(pageNo, options.pageSize))
      const pageRows = options.extractRows(json)
      const reportedTotal = Number(options.extractTotal(json))
      if (Number.isFinite(reportedTotal) && reportedTotal > 0 && total == null) total = reportedTotal
      pages = pageNo
      rows.push(...pageRows)
      if (!pageRows.length) break
      if (total && rows.length >= total) break
      if (pageRows.length < options.pageSize) break
      await sleep(DEFAULT_DELAY_MS)
    }
    return { rows, total: total || rows.length, pages }
  }

  function ymdToOffsetMidnightMs(ymd, offsetHours = CHINA_TIMEZONE_OFFSET_HOURS) {
    const text = normalizeDateValue(ymd)
    if (!text) return 0
    const year = Number(text.slice(0, 4))
    const month = Number(text.slice(4, 6))
    const day = Number(text.slice(6, 8))
    return Date.UTC(year, month - 1, day) - offsetHours * 60 * 60 * 1000
  }

  function ymdFromOffsetMs(ms, offsetHours = CHINA_TIMEZONE_OFFSET_HOURS) {
    const date = new Date(Number(ms) + offsetHours * 60 * 60 * 1000)
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')
    return `${year}${month}${day}`
  }

  function shiftYmd(ymd, days) {
    return ymdFromOffsetMs(ymdToOffsetMidnightMs(ymd) + Number(days || 0) * 24 * 60 * 60 * 1000)
  }

  function extractTmaxDateRange(rawParams = params, nowMs = Date.now()) {
    const explicitStart = normalizeDateValue(
      rawParams.tmax_start_date || rawParams.marketing_start_date || rawParams.start_date,
    )
    const explicitEnd = normalizeDateValue(
      rawParams.tmax_end_date || rawParams.marketing_end_date || rawParams.end_date,
    )
    const startYmd = explicitStart || explicitEnd
    const endYmd = explicitEnd || explicitStart
    if (startYmd) {
      return {
        startYmd,
        endYmd,
        startMs: ymdToOffsetMidnightMs(startYmd),
        endMs: ymdToOffsetMidnightMs(endYmd),
        source: '参数',
      }
    }

    const yesterday = shiftYmd(ymdFromOffsetMs(nowMs), -1)
    const start = shiftYmd(yesterday, -14)
    return {
      startYmd: start,
      endYmd: yesterday,
      startMs: ymdToOffsetMidnightMs(start),
      endMs: ymdToOffsetMidnightMs(yesterday),
      source: '默认近15天',
    }
  }

  function extractVipDirectDateRange(rawParams = params, nowMs = Date.now()) {
    const explicitStart = normalizeDateValue(
      rawParams.vipdirect_start_date || rawParams.marketing_start_date || rawParams.tmax_start_date || rawParams.start_date,
    )
    const explicitEnd = normalizeDateValue(
      rawParams.vipdirect_end_date || rawParams.marketing_end_date || rawParams.tmax_end_date || rawParams.end_date,
    )
    const startYmd = explicitStart || explicitEnd
    const endYmd = explicitEnd || explicitStart
    if (startYmd) {
      return {
        startYmd,
        endYmd,
        startMs: ymdToOffsetMidnightMs(startYmd),
        endMs: ymdToOffsetMidnightMs(endYmd),
        source: '参数',
      }
    }

    const yesterday = shiftYmd(ymdFromOffsetMs(nowMs), -1)
    const start = shiftYmd(yesterday, -14)
    return {
      startYmd: start,
      endYmd: yesterday,
      startMs: ymdToOffsetMidnightMs(start),
      endMs: ymdToOffsetMidnightMs(yesterday),
      source: '默认近15天',
    }
  }

  function parseBooleanFlag(value, fallback = false) {
    if (value == null || value === '') return fallback
    if (typeof value === 'boolean') return value
    return /^(1|true|yes|y|是)$/i.test(compact(value))
  }

  function vipDirectColumnList(rawParams = params) {
    const provided = parseList(rawParams.vipdirect_columns || rawParams.marketing_columns)
    return provided.length ? provided : VIPDIRECT_DEFAULT_COLUMNS
  }

  function buildVipDirectReportPayload(pageNo, pageSize, dateRange, user = {}, rawParams = params) {
    const advertiserIds = parseList(rawParams.vipdirect_advertiser_ids || rawParams.advertiser_ids)
    const reportChannelTypes = parseList(rawParams.vipdirect_report_channel_types || rawParams.report_channel_types)
    const dealTypes = parseList(rawParams.vipdirect_deal_type || rawParams.deal_type)
    const payload = {
      layer: compact(rawParams.vipdirect_layer || rawParams.marketing_layer || 'ALL') || 'ALL',
      startDate: dateRange.startMs,
      endDate: dateRange.endMs,
      columnList: vipDirectColumnList(rawParams),
      reportChannelTypes: reportChannelTypes.length ? reportChannelTypes : VIPDIRECT_DEFAULT_REPORT_CHANNEL_TYPES,
      advertiserIds: advertiserIds.length ? advertiserIds : [user.advertiserId].filter(Boolean),
      showHour: parseBooleanFlag(rawParams.vipdirect_show_hour || rawParams.show_hour, false),
      unionLayer: compact(rawParams.vipdirect_union_layer || rawParams.union_layer || 'NONE') || 'NONE',
      dealType: dealTypes.length ? dealTypes : VIPDIRECT_DEFAULT_DEAL_TYPES,
      pageIndex: pageNo,
      pageCount: pageSize,
    }

    const passthrough = {
      sort: rawParams.vipdirect_sort || rawParams.marketing_sort,
      orderBy: rawParams.vipdirect_orderby || rawParams.vipdirect_order_by || rawParams.marketing_orderby,
      campaignTitle: rawParams.vipdirect_campaign_title || rawParams.campaign_title,
      adTitle: rawParams.vipdirect_ad_title || rawParams.ad_title,
      keywordTitle: rawParams.vipdirect_keyword_title || rawParams.keyword_title,
      brandCategoryIds: rawParams.vipdirect_brand_category_ids || rawParams.brand_category_ids,
    }
    for (const [key, value] of Object.entries(passthrough)) {
      if (hasText(value)) payload[key] = value
    }
    return payload
  }

  function buildQueryString(fields) {
    return Object.entries(fields)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value ?? '')}`)
      .join('&')
  }

  function buildTmaxGoodsReportUrl(pageNo, pageSize, dateRange, rawParams = params) {
    return `${TMAX_GOODS_REPORT_URL}?${buildQueryString({
      sd: dateRange.startMs,
      ed: dateRange.endMs,
      advid: '',
      pi: pageNo,
      pc: pageSize,
      sort: rawParams.tmax_sort ?? 1,
      orderby: rawParams.tmax_orderby ?? 0,
      spuId: rawParams.tmax_spu_id || rawParams.spu_id || '',
      goodsName: rawParams.tmax_goods_name || rawParams.goods_name || '',
      adsTitle: rawParams.tmax_ads_title || rawParams.ads_title || '',
      reportType: rawParams.tmax_report_type ?? 0,
      columns: rawParams.tmax_columns || TMAX_DEFAULT_COLUMNS,
      msList: rawParams.tmax_ms_list || TMAX_DEFAULT_MARKETING_SCENES,
    })}`
  }

  function extractCompassDateRange(rawParams = params) {
    const explicitStart = normalizeDateValue(rawParams.start_date || rawParams.compass_start_date || rawParams.startDt)
    const explicitEnd = normalizeDateValue(rawParams.end_date || rawParams.compass_end_date || rawParams.endDt)
    if (explicitStart) return { startDt: explicitStart, endDt: explicitEnd || explicitStart, source: '参数' }

    const bodyText = compact(document?.body?.innerText || '')
    const statMatch = bodyText.match(/统计日期[\s\S]{0,120}?(20\d{2}[-/.年]\s*\d{1,2}[-/.月]\s*\d{1,2})/)
    const pageDate = normalizeDateValue(statMatch?.[1] || '')
    if (pageDate) return { startDt: pageDate, endDt: pageDate, source: '页面统计日期' }

    const firstDate = normalizeDateValue(bodyText)
    if (firstDate) return { startDt: firstDate, endDt: firstDate, source: '页面首个日期' }
    throw new Error('未能从当前罗盘页读取统计日期，请填写「数据开始日期」。')
  }

  function buildGoodsDetailPayload(pageNo, pageSize, dateRange, rawParams = params) {
    return {
      brandStoreSn: compact(rawParams.brand_store_sn || 'all') || 'all',
      dtType: 0,
      calType: 1,
      startDt: dateRange.startDt,
      endDt: dateRange.endDt,
      queryHll: false,
      pageNo,
      pageSize,
      dimType: 0,
      channelType: 1,
    }
  }

  function deriveStyleFromSku(value) {
    const sku = normalizeCode(value)
    if (!sku) return ''
    if (/^[A-Z0-9]{8,}\d{3}$/.test(sku)) return sku.slice(0, -3)
    return sku
  }

  function inferStyleCode(row) {
    for (const value of [row?.osn, row?.styleCode, row?.style_code, row?.styleNo, row?.大货款号, row?.款号]) {
      const normalized = normalizeCode(value)
      if (normalized) return normalized
    }
    for (const value of [row?.msn, row?.goodsNo, row?.货号]) {
      const derived = deriveStyleFromSku(value)
      if (derived) return derived
    }
    return ''
  }

  function joinList(value) {
    if (Array.isArray(value)) return value.map(compact).filter(Boolean).join('、')
    if (value && typeof value === 'object') {
      return Object.entries(value)
        .filter(([, enabled]) => Boolean(enabled))
        .map(([key]) => key)
        .join('、')
    }
    return compact(value)
  }

  function formatSellChannel(value) {
    const text = compact(value)
    if (text === '1000' || text === '1') return '特卖会主站'
    return text
  }

  function normalizeStatus(value) {
    const text = compact(value)
    if (text === '0') return '可售'
    if (text === '1') return '在售'
    return text
  }

  function rawValue(value) {
    if (value == null) return ''
    if (Array.isArray(value)) return value.map(rawValue).filter(Boolean).join('、')
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value)
      } catch (error) {
        return compact(value)
      }
    }
    return compact(value)
  }

  function formatCents(value) {
    if (!hasText(value)) return ''
    const number = Number(value)
    if (!Number.isFinite(number)) return compact(value)
    return (number / 100).toFixed(2)
  }

  function formatRatio(value) {
    if (!hasText(value)) return ''
    const number = Number(value)
    if (!Number.isFinite(number)) return compact(value)
    return String(number)
  }

  function formatPercent(value) {
    if (!hasText(value)) return ''
    const number = Number(value)
    if (!Number.isFinite(number)) return compact(value)
    return `${(number * 100).toFixed(2)}%`
  }

  function appendRawFields(output, row, knownKeys) {
    const known = new Set(knownKeys || [])
    for (const key of Object.keys(row || {}).sort()) {
      if (known.has(key)) continue
      const value = rawValue(row[key])
      if (!value) continue
      output[`${RAW_PREFIX}${key}`] = value
    }
    return output
  }

  function normalizeCompassSalesRow(row) {
    const knownKeys = [
      'actureAmt', 'actureNum', 'brandStoreName', 'brandStoreSn', 'channelName', 'channelType',
      'dt', 'firstCateName', 'goodsActureAmt', 'goodsActureNum', 'goodsName', 'goodsNo', 'imgUrl',
      'leavingNum', 'merTypeList', 'merchandiseNo', 'minMarketPrice', 'minPayPrice', 'minVipshopPrice',
      'onSellLeavingNum', 'osn', 'productSellAge', 'secCateName', 'status', 'thirdCateName',
      'userNum', 'uv', 'visitorNum', 'exposureUserNum', 'clickUserNum', 'collectNum', 'cartNum',
      'orderUserNum', 'orderAmt', 'roi',
    ]
    const output = {
      __sheet_name: COMPASS_SHEET,
      报表来源: '魔方罗盘销售明细',
      数据分组: '商品明细',
      品牌编码: compact(row.brandStoreSn),
      品牌名称: compact(row.brandStoreName),
      统计日期: formatDate(row.dt),
      款号: inferStyleCode(row),
      货号: compact(row.goodsNo || row.msn),
      商品ID: compact(row.merchandiseNo),
      商品名称: compact(row.goodsName),
      一级品类: compact(row.firstCateName),
      二级品类: compact(row.secCateName),
      三级品类: compact(row.thirdCateName),
      售卖渠道: formatSellChannel(row.channelType || row.channelName),
      市场价: compact(row.minMarketPrice),
      唯品价: compact(row.minVipshopPrice),
      到手价: compact(row.minPayPrice),
      销售额: firstNonEmpty(row.goodsActureAmt, row.actureAmt, row.salesAmt, row.saleAmt, row.payAmt),
      销售数量: firstNonEmpty(row.goodsActureNum, row.actureNum, row.salesNum, row.saleNum),
      客户数: firstNonEmpty(row.userNum, row.customNum, row.customerNum),
      商详UV: firstNonEmpty(row.uv, row.detailUv, row.goodsUv),
      曝光人数: firstNonEmpty(row.exposureUserNum, row.exposeUserNum),
      点击人数: firstNonEmpty(row.clickUserNum, row.clickNum),
      收藏数: firstNonEmpty(row.collectNum, row.favNum, row.favoriteNum),
      加购数: firstNonEmpty(row.cartNum, row.addCartNum, row.addToCartNum),
      下单客户数: firstNonEmpty(row.orderUserNum, row.orderCustomerNum),
      订单额: firstNonEmpty(row.orderAmt, row.orderAmount),
      ROI: firstNonEmpty(row.roi, row.dealRoi),
      在售库存: compact(row.onSellLeavingNum ?? row.leavingNum),
      库存天数: compact(row.canSellStockDay),
      售龄: compact(row.productSellAge),
      商品状态: normalizeStatus(row.status),
      商品标签: joinList(row.merTypeList),
      图片链接: compact(row.imgUrl),
      数据来源接口: GOODS_DETAIL_URL,
      执行结果: '已抓取',
      备注: '',
    }
    return appendRawFields(output, row, knownKeys)
  }

  async function collectCompassSalesRows(rawParams = params) {
    const dateRange = extractCompassDateRange(rawParams)
    const pageSize = getPageSize('compass', rawParams)
    const maxPages = getMaxPages(rawParams)
    const result = await collectPagedRows({
      url: GOODS_DETAIL_URL,
      pageSize,
      maxPages,
      buildPayload: (pageNo, size) => buildGoodsDetailPayload(pageNo, size, dateRange, rawParams),
      extractRows: json => Array.isArray(json?.data?.goodsList) ? json.data.goodsList : [],
      extractTotal: json => json?.data?.total,
    })
    return {
      rows: result.rows.map(normalizeCompassSalesRow),
      total: result.total,
      pages: result.pages,
      dateRange,
    }
  }

  function vipDirectLayerLabel(value) {
    const text = compact(value)
    const labels = {
      ALL: '汇总',
      CAMPAIGN: '推广计划',
      ADVERTISE: '广告',
      KEYWORDS: '关键词',
      PLACEMENT: '资源位',
      HOLE_SN: '坑位类型',
      ADVERTISE_HOLE_SN: '广告坑位',
    }
    return labels[text] || text || '汇总'
  }

  function normalizeVipDirectAdsRow(row, user = {}, payload = {}) {
    const stat = row?.statistics || {}
    const knownKeys = [
      'advertiserId', 'advertiserTitle', 'agentTitle', 'brandCategoryTitles', 'campaignId', 'campaignTitle',
      'adId', 'adTitle', 'advertiseId', 'keywordId', 'keywordTitle', 'searchWord', 'date', 'dateString',
      'deliveryChannel', 'deliveryChannelTitle', 'reportChannelType', 'reportChannelTypeTitle', 'site',
      'siteTitle', 'siteType', 'placementId', 'placementTitle', 'scheduleId', 'scheduleName',
      'statistics',
    ]
    const layer = vipDirectLayerLabel(payload.layer)
    const output = {
      __sheet_name: VZD_SHEET,
      报表来源: '唯直达投放效果',
      数据分组: layer,
      品牌名称: compact(user.advertiserTitle || row?.advertiserTitle),
      统计日期: formatDate(row?.dateString || row?.date),
      活动ID: firstNonEmpty(row?.campaignId, row?.campaignNo),
      活动名称: firstNonEmpty(row?.campaignTitle, row?.scheduleName),
      推广ID: firstNonEmpty(row?.adId, row?.advertiseId, row?.keywordId, row?.placementId),
      广告名称: compact(row?.adTitle),
      关键词: firstNonEmpty(row?.keywordTitle, row?.searchWord),
      营销渠道: firstNonEmpty(row?.reportChannelTypeTitle, row?.deliveryChannelTitle, '唯直达'),
      花费: formatCents(stat.cost),
      曝光量: compact(stat.impressionCount),
      点击量: compact(stat.clickCount),
      点击率: formatPercent(stat.clickRate),
      千次曝光均价: formatCents(stat.costPerMille),
      点击均价: formatCents(stat.costPerClick),
      APP端UV: compact(stat.appUV),
      小程序UV: compact(stat.miniappUV),
      商品详情页UV: compact(stat.detailUV1d),
      品牌UV: compact(stat.brandUV),
      '24小时收藏数(商家)': compact(stat.likeCnt1d),
      '24小时加购数(商家)': compact(stat.addcartCnt1d),
      '24小时加购成本(商家)': formatCents(stat.costPerAddcart1d),
      '24小时下单客户数(商家)': compact(stat.bookCustomerIn24Hour),
      '24小时下单量(商家)': compact(stat.bookOrdersIn24Hour),
      '24小时订单额(商家)': formatCents(stat.bookSalesIn24Hour),
      '24小时下单ROI(商家)': formatRatio(stat.bookRoiIn24Hour),
      '24小时成交客户数(商家)': compact(stat.customerIn24Hour),
      '24小时销售额(商家)': formatCents(stat.salesIn24Hour),
      '24小时成交ROI(商家)': formatRatio(stat.roiIn24Hour),
      '24小时收藏数(商品)': compact(stat.goodsLikeCnt1d),
      '24小时加购数(商品)': compact(stat.goodsAddcartCnt1d),
      '24小时加购成本(商品)': formatCents(stat.goodsCostPerAddcart1d),
      '24小时下单客户数(商品)': compact(stat.goodsBookCustomerIn24Hour),
      '24小时下单量(商品)': compact(stat.goodsBookOrdersIn24Hour),
      '24小时订单额(商品)': formatCents(stat.goodsBookSalesIn24Hour),
      '24小时下单ROI(商品)': formatRatio(stat.goodsBookRoiIn24Hour),
      '24小时成交客户数(商品)': compact(stat.goodsCustomerIn24Hour),
      '24小时销售额(商品)': formatCents(stat.goodsSalesIn24Hour),
      '24小时成交ROI(商品)': formatRatio(stat.goodsRoiIn24Hour),
      数据来源接口: VIPDIRECT_REPORT_TABLE_URL,
      执行结果: '已抓取',
      备注: '指标口径：唯直达 VSM/RTB，24小时商家与商品转化指标；接口为只读查询。',
    }
    return appendRawFields(output, row, knownKeys)
  }

  async function collectVipDirectAdsRows(rawParams = params) {
    const dateRange = extractVipDirectDateRange(rawParams)
    const pageSize = getPageSize('vipdirect', rawParams)
    const maxPages = getMaxPages(rawParams)
    const user = await loadMarketingUser({ requireTmaxPermission: false })
    const rows = []
    let total = null
    let pages = 0
    let payloadForRows = null
    for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
      const payload = buildVipDirectReportPayload(pageNo, pageSize, dateRange, user, rawParams)
      payloadForRows = payload
      const json = await postJson(VIPDIRECT_REPORT_TABLE_URL, payload, { advid: user.advertiserId })
      const pageRows = Array.isArray(json?.data?.reports) ? json.data.reports : []
      const reportedTotal = Number(json?.pageInfo?.totalElements ?? json?.data?.page?.totalCount)
      if (Number.isFinite(reportedTotal) && reportedTotal > 0 && total == null) total = reportedTotal
      pages = pageNo
      rows.push(...pageRows)
      if (!pageRows.length) break
      if (total && rows.length >= total) break
      if (pageRows.length < pageSize) break
      await sleep(DEFAULT_DELAY_MS)
    }
    return {
      rows: rows.map(row => normalizeVipDirectAdsRow(row, user, payloadForRows || {})),
      total: total || rows.length,
      pages,
      dateRange,
    }
  }

  function normalizeTmaxGoodsRow(row, user = {}) {
    const stat = row?.statistics || {}
    const actionType = compact(row?.actionType)
    const chargeType = compact(row?.chargeType)
    return {
      __sheet_name: TMAX_SHEET,
      报表来源: 'T-max效果数据',
      数据分组: '商品打爆',
      品牌名称: compact(user.advertiserTitle || row?.advertiserTitle),
      活动ID: compact(row?.campaignId),
      活动名称: compact(row?.adsTitle),
      推广ID: compact(row?.adId),
      商品ID: compact(row?.spuId),
      货号: compact(row?.goodsId === '汇总' ? '' : row?.goodsId),
      商品名称: compact(row?.goodsName),
      运营方式: firstNonEmpty(row?.marketingSceneName, actionType ? `actionType=${actionType}` : ''),
      营销渠道: firstNonEmpty(row?.deliveryChannelName, hasText(row?.deliveryChannel) ? `deliveryChannel=${compact(row?.deliveryChannel)}` : ''),
      出价: formatCents(row?.bidPrice),
      行动出价: formatCents(row?.actionPrice),
      计费类型: chargeType,
      曝光人数: compact(stat.impressionCount),
      点击人数: compact(stat.clickCount),
      收藏数: compact(stat.goodsLikeCnt1d),
      加购数: compact(stat.goodsAddcartCnt1d),
      加购成本: formatCents(stat.goodsCostPerAddcart1d),
      销售额: formatCents(stat.goodsBookSalesIn24Hour),
      ROI: formatRatio(stat.goodsRoiIn24Hour),
      活动成本: formatCents(stat.cost),
      数据来源接口: TMAX_GOODS_REPORT_URL,
      执行结果: '已抓取',
      备注: '指标口径：商品 24 小时收藏、加购、加购成本、销售额、成交ROI；接口为只读查询。',
    }
  }

  async function loadMarketingUser(options = {}) {
    const requireTmaxPermission = options.requireTmaxPermission !== false
    const json = await getJson(MARKETING_CURRENT_USER_URL)
    const data = json?.data || {}
    const advertiserId = compact(data.advertiserId || data.advertiser?.id)
    const advertiserTitle = compact(data.advertiser?.title || data.advertiserTitle)
    const permissions = Array.isArray(data.permissions) ? data.permissions : []
    const privileges = data.privileges || {}
    const hasTmaxPermission = permissions.includes(TMAX_HOT_GOODS_PERMISSION) || Boolean(privileges[TMAX_HOT_GOODS_PERMISSION])
    if (!hasText(advertiserId)) throw new Error('营销平台当前用户未返回 advertiserId，无法读取营销报表。')
    if (requireTmaxPermission && !hasTmaxPermission) throw new Error(`当前营销平台账号缺少 ${TMAX_HOT_GOODS_PERMISSION} 权限。`)
    return { advertiserId, advertiserTitle, hasTmaxPermission }
  }

  async function collectTmaxGoodsRows(rawParams = params) {
    const dateRange = extractTmaxDateRange(rawParams)
    const pageSize = getPageSize('tmax', rawParams)
    const maxPages = getMaxPages(rawParams)
    const user = await loadMarketingUser({ requireTmaxPermission: true })
    const rows = []
    let total = null
    let pages = 0
    for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
      const url = buildTmaxGoodsReportUrl(pageNo, pageSize, dateRange, rawParams)
      const json = await getTmaxJson(url, user.advertiserId)
      const pageRows = Array.isArray(json?.data) ? json.data : []
      const reportedTotal = Number(json?.pageInfo?.totalElements)
      if (Number.isFinite(reportedTotal) && reportedTotal > 0 && total == null) total = reportedTotal
      pages = pageNo
      rows.push(...pageRows)
      if (!pageRows.length) break
      if (total && rows.length >= total) break
      if (pageRows.length < pageSize) break
      await sleep(DEFAULT_DELAY_MS)
    }
    return {
      rows: rows.map(row => normalizeTmaxGoodsRow(row, user)),
      total: total || rows.length,
      pages,
      dateRange,
    }
  }

  function brandHaystack(brand, root) {
    return [
      brand?.brandName,
      brand?.brandSn,
      brand?.vendorCode,
      brand?.vendorName,
      root?.vendorCode,
    ].map(compact).filter(Boolean).join(' ')
  }

  function selectBctBrand(json, keyword = '巴拉巴拉') {
    const root = json?.data || {}
    const brands = Array.isArray(root.brands) ? root.brands : (Array.isArray(root) ? root : [])
    if (!brands.length) throw new Error('中台未返回可用品牌，请确认当前账号有 BCT 策略效果权限。')
    const wanted = compact(keyword || '巴拉巴拉')
    const matched = wanted
      ? brands.find(brand => brandHaystack(brand, root).includes(wanted))
      : null
    const brand = matched || brands[0]
    const vendorId = brand.id ?? brand.vendorId ?? root.id ?? root.vendorId
    const vendorCode = compact(brand.vendorCode || root.vendorCode)
    const brandSn = brand.brandSn ?? brand.value
    if (!hasText(brandSn) || !hasText(vendorId)) {
      throw new Error('中台品牌信息缺少 brandSn/vendorId，无法构造策略效果查询。')
    }
    return {
      brandSn: compact(brandSn),
      brandName: compact(brand.brandName || brand.label),
      vendorCode,
      vendorId,
      matchedBy: matched ? '品牌关键词' : '首个可用品牌',
    }
  }

  function bctTaskTypesForGroup(group, rawParams = params) {
    if (group === 'lifecycle') {
      return parseNumberList(rawParams.bct_lifecycle_task_types || rawParams.lifecycle_task_types).length
        ? parseNumberList(rawParams.bct_lifecycle_task_types || rawParams.lifecycle_task_types)
        : BCT_LIFECYCLE_TASK_TYPES
    }
    return parseNumberList(rawParams.bct_scene_task_types || rawParams.scene_task_types).length
      ? parseNumberList(rawParams.bct_scene_task_types || rawParams.scene_task_types)
      : BCT_SCENE_TASK_TYPES
  }

  function addOptionalPayloadField(payload, key, value) {
    if (Array.isArray(value) && value.length) payload[key] = value
    else if (!Array.isArray(value) && hasText(value)) payload[key] = value
  }

  function buildBctToolboxPayload(group, pageNum, pageSize, brand, rawParams = params) {
    const payload = {
      vendorId: brand.vendorId,
      taskTypeList: bctTaskTypesForGroup(group, rawParams),
      source: Number(rawParams.bct_source ?? rawParams.source ?? 0) || 0,
      pageNum,
      pageSize,
    }

    addOptionalPayloadField(payload, 'taskName', rawParams.bct_task_name || rawParams.task_name)
    addOptionalPayloadField(payload, 'couponNos', parseList(rawParams.bct_coupon_nos || rawParams.coupon_nos))
    addOptionalPayloadField(payload, 'promotionNos', parseList(rawParams.bct_promotion_nos || rawParams.promotion_nos))
    addOptionalPayloadField(payload, 'statusList', parseNumberList(rawParams.bct_status_list || rawParams.status_list))
    addOptionalPayloadField(payload, 'idList', parseList(rawParams.bct_id_list || rawParams.id_list))
    addOptionalPayloadField(payload, 'jointTaskId', rawParams.bct_joint_task_id || rawParams.joint_task_id)

    const activityStart = normalizeDateTime(rawParams.bct_activity_start || rawParams.activity_start)
    const activityEnd = normalizeDateTime(rawParams.bct_activity_end || rawParams.activity_end, true)
    addOptionalPayloadField(payload, 'startTimeBegin', activityStart)
    addOptionalPayloadField(payload, 'startTimeEnd', activityEnd || activityStart)

    const createStart = normalizeDateTime(rawParams.bct_create_start || rawParams.create_start)
    const createEnd = normalizeDateTime(rawParams.bct_create_end || rawParams.create_end, true)
    addOptionalPayloadField(payload, 'createTimeBegin', createStart)
    addOptionalPayloadField(payload, 'createTimeEnd', createEnd || createStart)

    return payload
  }

  function formatBctChannels(value) {
    if (Array.isArray(value)) return value.map(compact).filter(Boolean).join('、')
    return compact(value).split(',').map(compact).filter(Boolean).join('、')
  }

  function normalizeBctTaskRow(row, group, brand) {
    const sheet = group === 'lifecycle' ? BCT_GIFT_SHEET : BCT_SCENE_SHEET
    const sourceLabel = group === 'lifecycle' ? '中台营销：礼金' : '中台营销：购物车和跨品类券'
    const knownKeys = [
      'activityCost', 'appendGoodsNum', 'buyAmt', 'buyTotal', 'couponNo', 'couponNos', 'createTime',
      'customNum', 'endTime', 'exposureUserNum', 'id', 'jointTaskId', 'newUserNum', 'offlinePerson',
      'offlineStatus', 'offlineTime', 'orderNum', 'promotionNo', 'roi', 'sceneType', 'startTime',
      'status', 'taskChannels', 'taskName', 'taskType', 'unitPrice', 'userNum', 'userSalePer',
      'uspGroupCnt', 'uspGroupName', 'visitorNum',
    ]
    const taskType = Number(row.taskType)
    const status = Number(row.status)
    const output = {
      __sheet_name: sheet,
      报表来源: sourceLabel,
      数据分组: group === 'lifecycle' ? '用户生命周期运营' : '场景营销',
      品牌编码: compact(brand.brandSn),
      品牌名称: compact(brand.brandName),
      供应商编码: compact(brand.vendorCode),
      活动ID: compact(row.id || row.taskId),
      联合提报ID: compact(row.jointTaskId),
      活动名称: compact(row.taskName),
      人群名称: compact(row.uspGroupName),
      运营方式: compact(row.taskTypeName || BCT_TASK_TYPE_LABELS[taskType] || row.taskType),
      营销渠道: formatBctChannels(row.taskChannels),
      活动状态: compact(row.statusName || BCT_STATUS_LABELS[status] || row.status),
      计划开始: compact(row.startTime),
      计划结束: compact(row.endTime),
      创建时间: compact(row.createTime),
      下线时间: compact(row.offlineTime),
      下线人: compact(row.offlinePerson),
      券ID: joinList(row.couponNos || row.couponNo),
      推广ID: compact(row.promotionNo),
      触达用户数: firstNonEmpty(row.touchUserNum, row.marketUserNum),
      曝光人数: compact(row.exposureUserNum),
      访问人数: compact(row.visitorNum),
      客户数: firstNonEmpty(row.customNum, row.userNum),
      销售额: firstNonEmpty(row.buyTotal, row.buyAmt),
      订单数: compact(row.orderNum),
      客单价: firstNonEmpty(row.userSalePer, row.unitPrice),
      活动成本: compact(row.activityCost),
      ROI: compact(row.roi),
      数据来源接口: BCT_TOOLBOX_LIST_URL,
      执行结果: '已抓取',
      备注: '',
    }
    return appendRawFields(output, row, knownKeys)
  }

  async function collectBctGroupRows(group, brand, rawParams = params) {
    const pageSize = getPageSize('bct', rawParams)
    const maxPages = getMaxPages(rawParams)
    const result = await collectPagedRows({
      url: BCT_TOOLBOX_LIST_URL,
      pageSize,
      maxPages,
      buildPayload: (pageNo, size) => buildBctToolboxPayload(group, pageNo, size, brand, rawParams),
      extractRows: json => Array.isArray(json?.data?.taskList) ? json.data.taskList : [],
      extractTotal: json => json?.data?.totalCount,
    })
    return {
      rows: result.rows.map(row => normalizeBctTaskRow(row, group, brand)),
      total: result.total,
      pages: result.pages,
    }
  }

  async function loadBctBrand(rawParams = params) {
    const json = await getJson(BCT_AVAILABLE_BRAND_URL)
    return selectBctBrand(json, rawParams.brand_keyword || '巴拉巴拉')
  }

  function summaryRow(source, message, status = '完成') {
    return {
      __sheet_name: SUMMARY_SHEET,
      报表来源: source,
      数据分组: '',
      品牌编码: '',
      品牌名称: '',
      统计日期: '',
      活动ID: '',
      活动名称: '',
      运营方式: '',
      营销渠道: '',
      活动状态: '',
      计划开始: '',
      计划结束: '',
      创建时间: '',
      券ID: '',
      推广ID: '',
      商品ID: '',
      款号: '',
      货号: '',
      商品名称: '',
      销售额: '',
      订单额: '',
      客户数: '',
      订单数: '',
      收藏数: '',
      加购数: '',
      ROI: '',
      活动成本: '',
      数据来源接口: '',
      执行结果: status,
      备注: message,
    }
  }

  function marketingPreflightRow(sheet, source, route, requiredMetrics, href = currentHref(), bodyText = document?.body?.innerText || '') {
    const loggedIn = isMarketingLoggedInPage(href, bodyText)
    return {
      __sheet_name: sheet,
      报表来源: source,
      数据分组: route,
      数据来源接口: 'https://e.vip.com/upgrade.html',
      执行结果: loggedIn ? '待捕获登录后接口' : '需要营销平台登录',
      备注: [
        `需求截图路径：${route}`,
        `需导出/自定义列：${requiredMetrics.join('、')}`,
        loggedIn
          ? '当前检测到营销平台页面，但本次未捕获到登录后列表/导出 API；请先用此预检 sheet 保留操作路径，后续可补充官方导出接口。'
          : '当前 9222 会话打开营销平台后台会跳转 passport.vip.com 登录页，未拿到唯直达/T-max 登录后接口；脚本未伪造未验证 API。',
      ].join('；'),
    }
  }

  function buildMarketingPreflightRows(rawParams = params, href = currentHref(), bodyText = document?.body?.innerText || '') {
    const scope = normalizeScope(rawParams.report_scope)
    const rows = []
    if (hasScope(scope, 'vipdirect_ads')) {
      rows.push(marketingPreflightRow(
        VZD_SHEET,
        '唯直达投放效果',
        '唯直达 > 广告 > 导出 > 自定义列',
        ['24小时收藏数', '24小时下单客户数', '24小时订单额', '24小时成交ROI'],
        href,
        bodyText,
      ))
    }
    if (hasScope(scope, 'tmax_goods')) {
      rows.push(marketingPreflightRow(
        TMAX_SHEET,
        'T-max效果数据',
        'Target-Max > 商品打爆 > 商品 > 导出报表 > 自定义列',
        ['24小时收藏数', '加购数', '加购成本', '销售额', '成交ROI'],
        href,
        bodyText,
      ))
    }
    return rows
  }

  function nextPhaseAfterCompass(scope = normalizeScope()) {
    if (wantsAny(scope, ['bct_gift', 'bct_scene'])) return 'bct_reports'
    if (wantsAny(scope, ['vipdirect_ads', 'tmax_goods'])) return 'marketing_reports'
    return ''
  }

  function firstExecutionPhase(scope = normalizeScope()) {
    if (hasScope(scope, 'compass_sales_detail')) return 'compass_sales'
    const afterCompass = nextPhaseAfterCompass(scope)
    return afterCompass || 'marketing_reports'
  }

  function exposeHelpers() {
    if (!testExports) return
    Object.assign(testExports, {
      compact,
      normalizeCode,
      normalizeDateValue,
      normalizeDateTime,
      normalizeScope,
      hasScope,
      firstExecutionPhase,
      nextPhaseAfterCompass,
      extractCompassDateRange,
      buildGoodsDetailPayload,
      normalizeCompassSalesRow,
      extractVipDirectDateRange,
      buildVipDirectReportPayload,
      normalizeVipDirectAdsRow,
      collectVipDirectAdsRows,
      extractTmaxDateRange,
      buildTmaxGoodsReportUrl,
      normalizeTmaxGoodsRow,
      selectBctBrand,
      bctTaskTypesForGroup,
      buildBctToolboxPayload,
      normalizeBctTaskRow,
      loadMarketingUser,
      collectTmaxGoodsRows,
      buildMarketingPreflightRows,
      isMarketingLoggedInPage,
      isCompassPage,
      isBctPage,
      getPageSize,
    })
  }

  exposeHelpers()
  if (phase === '__exports__') return complete([], shared)

  try {
    const scope = normalizeScope(params.report_scope)

    if (phase === 'main') {
      return nextPhase(firstExecutionPhase(scope), [], shared, 10)
    }

    if (phase === 'compass_sales') {
      if (!hasScope(scope, 'compass_sales_detail')) {
        const nextName = nextPhaseAfterCompass(scope)
        return nextName ? nextPhase(nextName, [], shared, 10) : complete([], shared)
      }
      if (!isCompassPage()) {
        location.href = COMPASS_PAGE_URL
        return nextPhase('compass_sales', [], { ...shared, compass_target_url: COMPASS_PAGE_URL }, 1800)
      }
      try {
        const result = await collectCompassSalesRows(params)
        const rows = [
          summaryRow('魔方罗盘销售明细', `商品明细日期 ${result.dateRange.startDt}-${result.dateRange.endDt}（${result.dateRange.source}）；扫描 ${result.total} 行，实际输出 ${result.rows.length} 行，分页 ${result.pages} 页`, '完成'),
          ...result.rows,
        ]
        const nextName = nextPhaseAfterCompass(scope)
        const nextShared = {
          ...shared,
          compass_sales_rows: result.rows.length,
          compass_sales_total: result.total,
          compass_sales_pages: result.pages,
        }
        return nextName ? nextPhase(nextName, rows, nextShared, 600) : complete(rows, nextShared)
      } catch (error) {
        const rows = [
          summaryRow('魔方罗盘销售明细', `读取失败：${error.message || error}`, '部分失败'),
        ]
        const nextName = nextPhaseAfterCompass(scope)
        return nextName ? nextPhase(nextName, rows, { ...shared, compass_sales_error: error.message || String(error) }, 600) : complete(rows, shared)
      }
    }

    if (phase === 'bct_reports') {
      if (!wantsAny(scope, ['bct_gift', 'bct_scene'])) {
        return wantsAny(scope, ['vipdirect_ads', 'tmax_goods'])
          ? nextPhase('marketing_reports', [], shared, 10)
          : complete([], shared)
      }
      if (!isBctPage()) {
        location.href = BCT_PAGE_URL
        return nextPhase('bct_reports', [], { ...shared, bct_target_url: BCT_PAGE_URL }, 2200)
      }

      const rows = []
      const stats = {}
      try {
        const brand = await loadBctBrand(params)
        stats.bct_brand = `${brand.brandName || brand.brandSn}/${brand.vendorCode || ''}`
        if (hasScope(scope, 'bct_gift')) {
          const result = await collectBctGroupRows('lifecycle', brand, params)
          stats.bct_gift_rows = result.rows.length
          rows.push(summaryRow('中台营销：礼金', `品牌 ${brand.brandName || brand.brandSn}（${brand.matchedBy}）；扫描 ${result.total} 行，输出 ${result.rows.length} 行，分页 ${result.pages} 页`, '完成'))
          rows.push(...result.rows)
        }
        if (hasScope(scope, 'bct_scene')) {
          const result = await collectBctGroupRows('scene', brand, params)
          stats.bct_scene_rows = result.rows.length
          rows.push(summaryRow('中台营销：购物车和跨品类券', `品牌 ${brand.brandName || brand.brandSn}（${brand.matchedBy}）；扫描 ${result.total} 行，输出 ${result.rows.length} 行，分页 ${result.pages} 页`, '完成'))
          rows.push(...result.rows)
        }
      } catch (error) {
        rows.push(summaryRow('中台营销', `读取失败：${error.message || error}`, '部分失败'))
        stats.bct_error = error.message || String(error)
      }

      const nextShared = { ...shared, ...stats }
      return wantsAny(scope, ['vipdirect_ads', 'tmax_goods'])
        ? nextPhase('marketing_reports', rows, nextShared, 600)
        : complete(rows, nextShared)
    }

    if (phase === 'marketing_preflight' || phase === 'marketing_reports') {
      if (wantsAny(scope, ['vipdirect_ads', 'tmax_goods']) && !isMarketingLoggedInPage()) {
        const targetUrl = hasScope(scope, 'vipdirect_ads') ? VIPDIRECT_PAGE_URL : TMAX_PAGE_URL
        location.href = targetUrl
        return nextPhase('marketing_reports', [], { ...shared, marketing_target_url: targetUrl }, 2200)
      }

      const rows = []
      const stats = {}
      if (hasScope(scope, 'vipdirect_ads')) {
        try {
          const result = await collectVipDirectAdsRows(params)
          rows.push(summaryRow(
            '营销投放数据：唯直达',
            `唯直达投放效果 ${formatDate(result.dateRange.startYmd)}-${formatDate(result.dateRange.endYmd)}（${result.dateRange.source}）；扫描 ${result.total} 行，输出 ${result.rows.length} 行，分页 ${result.pages} 页`,
            '完成',
          ))
          rows.push(...result.rows)
          stats.vipdirect_ads_rows = result.rows.length
          stats.vipdirect_ads_total = result.total
          stats.vipdirect_ads_pages = result.pages
        } catch (error) {
          rows.push(summaryRow('营销投放数据：唯直达', `读取失败：${error.message || error}`, '部分失败'))
          stats.vipdirect_ads_error = error.message || String(error)
        }
      }

      if (hasScope(scope, 'tmax_goods')) {
        try {
          const result = await collectTmaxGoodsRows(params)
          rows.push(summaryRow(
            '营销投放数据：T-max商品打爆',
            `T-max商品打爆 ${formatDate(result.dateRange.startYmd)}-${formatDate(result.dateRange.endYmd)}（${result.dateRange.source}）；扫描 ${result.total} 行，输出 ${result.rows.length} 行，分页 ${result.pages} 页`,
            '完成',
          ))
          rows.push(...result.rows)
          stats.tmax_goods_rows = result.rows.length
          stats.tmax_goods_total = result.total
          stats.tmax_goods_pages = result.pages
        } catch (error) {
          rows.push(summaryRow('营销投放数据：T-max商品打爆', `读取失败：${error.message || error}`, '部分失败'))
          stats.tmax_goods_error = error.message || String(error)
        }
      }
      return complete(rows, {
        ...shared,
        ...stats,
      })
    }

    return nextPhase(firstExecutionPhase(scope), [], shared, 10)
  } catch (error) {
    return { success: false, error: error.message || String(error) }
  }
})()
