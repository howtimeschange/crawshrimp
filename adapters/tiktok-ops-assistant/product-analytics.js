;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const DEFAULT_REGION = 'US'
  const DEFAULT_SHOP_ID = '7496042382582647544'
  const KNOWN_REGIONS = ['US', 'GB', 'FR', 'DE', 'IT', 'ES']
  const PRODUCT_KEY_METRIC_IDS = [
    7468,
    7517,
    7459,
    7582,
  ]

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function splitValues(value) {
    if (Array.isArray(value)) return value.map(item => compact(item)).filter(Boolean)
    return compact(value)
      .split(/[\s,，;；、]+/)
      .map(item => item.trim())
      .filter(Boolean)
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

  function getCookieValue(name) {
    const escaped = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = String(document.cookie || '').match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`))
    return match ? decodeURIComponent(match[1]) : ''
  }

  function readAccountInfo() {
    const candidates = [
      safeJsonParse(localStorage.getItem('ecom_seller_base_account_info')),
      safeJsonParse(sessionStorage.getItem('ecom_seller_base_account_info')),
    ].filter(Boolean)
    for (const candidate of candidates) {
      const value = candidate?.value || candidate
      const data = value?.data || value
      const shop = data?.shop || {}
      const globalSeller = data?.global_seller || {}
      if (shop.shop_id || globalSeller.global_seller_id) {
        return { shop, globalSeller }
      }
    }
    return { shop: {}, globalSeller: {} }
  }

  function readPageShopName() {
    const lines = String(document.body?.innerText || '')
      .split(/\n+/)
      .map(compact)
      .filter(Boolean)
      .slice(0, 30)
    const wrapped = lines.find(line => /^\([^)]+\)$/.test(line))
    return wrapped ? wrapped.replace(/^\(|\)$/g, '').trim() : ''
  }

  function readSellerStores() {
    const candidates = [
      window.__SELLER_USER_STORE__,
      window.__SELLER_FETCH_STORE__?.userStore,
      window.__SELLER_FETCH_STORE__?.sellerUserStore,
      window.__SELLER_FETCH_STORE__?.sellerStore,
      window.__SELLER_STORE__,
    ].filter(Boolean)
    return candidates.filter(item => item && typeof item === 'object')
  }

  function readRegionSellerMap() {
    const byRegion = {}
    const add = (regionValue, sellerIdValue) => {
      const region = compact(regionValue).toUpperCase()
      const sellerId = compact(sellerIdValue)
      if (/^[A-Z]{2}$/.test(region) && sellerId) byRegion[region] = sellerId
    }

    for (const store of readSellerStores()) {
      add(store.region || store.currentRegion || store.shopRegion, store.localSellerId || store.sellerId || store.shopId)
      const regions = store.regions || store.regionMap || store.sellerRegions
      if (regions && typeof regions === 'object') {
        for (const [sellerId, region] of Object.entries(regions)) {
          add(region, sellerId)
        }
      }
      const shops = store.shops || store.shopList || store.sellerList || store.availableShops
      if (Array.isArray(shops)) {
        for (const shop of shops) {
          add(
            shop?.region || shop?.shop_region || shop?.country_code || shop?.country,
            shop?.seller_id || shop?.sellerId || shop?.shop_id || shop?.shopId || shop?.id,
          )
        }
      }
    }
    return byRegion
  }

  function readAvailableRegions(account) {
    const regions = new Set()
    const addRegion = value => {
      const region = compact(value).toUpperCase()
      if (/^[A-Z]{2}$/.test(region)) regions.add(region)
    }

    addRegion(new URLSearchParams(location.search || '').get('shop_region'))
    addRegion(account?.shop?.region)
    addRegion(localStorage.getItem('ecom-seller-affiliate-selected-shop-region'))
    for (const region of Object.keys(readRegionSellerMap())) {
      addRegion(region)
    }
    for (const text of [
      localStorage.getItem('ecom_seller_base_account_info') || '',
      localStorage.getItem('ecom_seller_base_menu') || '',
      localStorage.getItem('ecom_seller_base_platform_config') || '',
      String(document.body?.innerText || ''),
    ]) {
      for (const match of String(text || '').matchAll(/\b(US|GB|FR|DE|IT|ES|MX|BR|JP|MY|TH|VN|PH|SG|ID)\b/g)) {
        addRegion(match[1])
      }
    }
    return Array.from(regions)
  }

  function resolveContext() {
    const account = readAccountInfo()
    const query = new URLSearchParams(location.search || '')
    const regionSellerMap = readRegionSellerMap()
    const shopId =
      compact(query.get('shop_id')) ||
      compact(getCookieValue('global_seller_id_unified_seller_env')) ||
      compact(getCookieValue('oec_seller_id_unified_seller_env')) ||
      compact(account.shop?.shop_id) ||
      compact(account.globalSeller?.global_seller_id) ||
      DEFAULT_SHOP_ID
    const currentRegion =
      compact(query.get('shop_region')).toUpperCase() ||
      compact(account.shop?.region).toUpperCase() ||
      compact(localStorage.getItem('ecom-seller-affiliate-selected-shop-region')).toUpperCase() ||
      DEFAULT_REGION
    const requestedRegions = splitValues(params.shop_regions || params.regions)
      .map(item => item.toUpperCase())
      .filter(Boolean)
    let regions = requestedRegions.includes('ALL')
      ? readAvailableRegions(account)
      : requestedRegions.filter(item => /^[A-Z]{2}$/.test(item))
    if (!regions.length) regions = [currentRegion]
    regions = Array.from(new Set(regions.length ? regions : [DEFAULT_REGION]))
    const knownFirst = regions.filter(item => KNOWN_REGIONS.includes(item))
    const extra = regions.filter(item => !KNOWN_REGIONS.includes(item))
    return {
      shopId,
      shopName: compact(account.shop?.shop_name || account.globalSeller?.global_seller_name || readPageShopName()),
      currentRegion,
      regions: [...knownFirst, ...extra],
      regionSellerMap,
    }
  }

  function sellerHostForRegion(region) {
    const normalized = compact(region).toUpperCase()
    return normalized && normalized !== 'US'
      ? 'seller.eu.tiktokshopglobalselling.com'
      : 'seller.us.tiktokshopglobalselling.com'
  }

  function sellerIdForRegion(context, region) {
    const normalized = compact(region).toUpperCase()
    return compact(context.regionSellerMap?.[normalized]) || context.shopId || DEFAULT_SHOP_ID
  }

  function browserName() {
    return compact(navigator.appCodeName) || 'Mozilla'
  }

  function buildUrl(context) {
    const url = new URL('/api/v2/insights/seller/unified/query/product_key_metric', `https://${sellerHostForRegion(context.region)}`)
    url.searchParams.set('locale', 'zh-CN')
    url.searchParams.set('language', 'zh-CN')
    url.searchParams.set('oec_seller_id', context.shopId)
    url.searchParams.set('aid', '6556')
    url.searchParams.set('app_name', 'i18n_ecom_shop')
    url.searchParams.set('device_platform', 'web')
    url.searchParams.set('cookie_enabled', 'true')
    url.searchParams.set('screen_width', compact(screen.width))
    url.searchParams.set('screen_height', compact(screen.height))
    url.searchParams.set('browser_language', compact(navigator.language || navigator.browserLanguage || 'zh-CN'))
    url.searchParams.set('browser_platform', compact(navigator.platform))
    url.searchParams.set('browser_name', browserName())
    url.searchParams.set('browser_version', compact(navigator.userAgent))
    url.searchParams.set('browser_online', 'true')
    const timezoneName = typeof Intl !== 'undefined'
      ? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai')
      : 'Asia/Shanghai'
    url.searchParams.set('timezone_name', timezoneName)
    url.searchParams.set('use_content_type_definition', '1')
    const webId = getCookieValue('s_v_web_id')
    if (webId) url.searchParams.set('fp', webId)
    return url.href
  }

  function buildTargetUrl(context, region) {
    const url = new URL(`https://${sellerHostForRegion(region || context.currentRegion)}/compass/product-traffic-analysis`)
    url.searchParams.set('shop_region', region || context.currentRegion || DEFAULT_REGION)
    url.searchParams.set('shop_id', context.shopId || DEFAULT_SHOP_ID)
    const descriptor = resolveDateDescriptor()
    if (descriptor?.apiEndExclusive) {
      url.searchParams.set('timeRange', `${descriptor.start}|${descriptor.apiEndExclusive}`)
    }
    return url.href
  }

  function isTargetPage(context, region) {
    const query = new URLSearchParams(location.search || '')
    const actualRegion = compact(query.get('shop_region')).toUpperCase()
    const expectedRegion = compact(region || context.currentRegion || DEFAULT_REGION).toUpperCase()
    return String(location.hostname || '').toLowerCase() === sellerHostForRegion(expectedRegion) &&
      /\/compass\/product-traffic-analysis/.test(String(location.pathname || '')) &&
      (!actualRegion || actualRegion === expectedRegion)
  }

  function pad(number) {
    return String(number).padStart(2, '0')
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

  function parseDateRangeParam(value) {
    if (!value || typeof value !== 'object') return null
    const start = parseDateText(value.start || value.from || value.begin)
    const end = parseDateText(value.end || value.to || value.finish)
    if (!start || !end) return null
    return { start, end, apiEndExclusive: addDays(end, 1) }
  }

  function addDays(value, days) {
    const [year, month, day] = String(value).split('-').map(Number)
    const date = new Date(year, month - 1, day + Number(days || 0))
    return dateText(date)
  }

  function defaultLast7Descriptor() {
    const endExclusive = new Date()
    endExclusive.setHours(0, 0, 0, 0)
    const start = new Date(endExclusive)
    start.setDate(start.getDate() - 7)
    return {
      start: dateText(start),
      end: addDays(dateText(endExclusive), -1),
      apiEndExclusive: dateText(endExclusive),
    }
  }

  function readPageDateDescriptorFromUrl() {
    const query = new URLSearchParams(location.search || '')
    const timeRange = compact(query.get('timeRange'))
    if (!timeRange) return null
    const parts = timeRange.split('|').map(parseDateText).filter(Boolean)
    if (parts.length < 2) return null
    return {
      start: parts[0],
      end: addDays(parts[1], -1),
      apiEndExclusive: parts[1],
    }
  }

  function readPageDateDescriptorFromDom() {
    const selectors = [
      '.m4b-date-picker-range',
      '.gec-date-picker-range',
      '[class*="date-picker-range"]',
      '[class*="DatePickerRange"]',
    ]
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector) || [])
      for (const node of nodes) {
        const inputs = Array.from(node.querySelectorAll?.('input') || [])
          .map(input => parseDateText(input?.value || input?.placeholder || ''))
          .filter(Boolean)
        if (inputs.length >= 2) {
          return {
            start: inputs[0],
            end: inputs[1],
            apiEndExclusive: addDays(inputs[1], 1),
          }
        }
      }
    }
    return null
  }

  function normalizeTimeRange(value) {
    const text = compact(value).toLowerCase()
    if (!text || text === 'page' || text === 'current' || text === '页面当前筛选' || text === '沿用页面当前筛选') return 'page'
    if (text === 'last7' || text === 'recent7' || text === '最近7天') return 'last7'
    if (text === 'custom' || text === '自定义' || text === '自定义日期') return 'custom'
    return text
  }

  function resolveDateDescriptor() {
    if (shared.date_descriptor && typeof shared.date_descriptor === 'object') {
      return { ...shared.date_descriptor }
    }
    const customRange = parseDateRangeParam(params.date_range || params.custom_range || params.stat_date_range)
    const timeRange = normalizeTimeRange(params.time_range || params.stat_time_range)
    if (customRange) return customRange
    if (timeRange === 'custom') throw new Error('选择自定义日期时，请填写开始和结束日期')
    if (timeRange === 'last7') return defaultLast7Descriptor()
    return readPageDateDescriptorFromUrl() || readPageDateDescriptorFromDom() || defaultLast7Descriptor()
  }

  function previousDateDescriptor(descriptor) {
    const days = Math.max(1, Math.round((new Date(`${descriptor.apiEndExclusive}T00:00:00`).getTime() - new Date(`${descriptor.start}T00:00:00`).getTime()) / 86400000))
    const compareEndExclusive = descriptor.start
    const compareStart = addDays(compareEndExclusive, -days)
    return {
      start: compareStart,
      end: addDays(compareEndExclusive, -1),
      apiEndExclusive: compareEndExclusive,
    }
  }

  function dateRangeLabel(descriptor) {
    return `${descriptor.start} ~ ${descriptor.end}`
  }

  function nowText() {
    const date = new Date()
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  function parseMetricValue(value) {
    if (value == null) return ''
    if (typeof value === 'string') {
      const parsed = safeJsonParse(value)
      if (parsed && typeof parsed === 'object') return compact(parsed.value ?? parsed.amount ?? value)
      return compact(value)
    }
    if (typeof value === 'object') return compact(value.value ?? value.amount ?? value.amount_delimited ?? value.amount_formatted)
    return compact(value)
  }

  function firstInterval(payload) {
    const data = Array.isArray(payload?.data) ? payload.data[0] : null
    const intervals = Array.isArray(data?.intervals) ? data.intervals : []
    return intervals[0] || {}
  }

  function extractValues(payload) {
    const interval = firstInterval(payload)
    const rows = Array.isArray(interval.rows) ? interval.rows : []
    const values = rows[0]?.values || {}
    return {
      interval,
      values,
      orders: parseMetricValue(values.pay_main_order_cnt || values[7517]),
      impressions: parseMetricValue(values.product_show_cnt || values[7459] || values.product_impression_pv),
      clicks: parseMetricValue(values.product_click_cnt || values[7582] || values.product_click_pv),
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

  function complete(data, hasMore, nextShared) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: !!hasMore,
        shared: nextShared,
      },
    }
  }

  function fail(message) {
    return { success: false, error: String(message || '未知错误') }
  }

  try {
    const context = resolveContext()
    const regionIndex = Math.max(0, Math.min(Number(shared.region_index || 0) || 0, Math.max(context.regions.length - 1, 0)))
    const region = context.regions[regionIndex] || context.currentRegion || DEFAULT_REGION
    if (!isTargetPage(context, region)) {
      const targetUrl = buildTargetUrl(context, region)
      location.href = targetUrl
      return nextPhase('main', 2200, {
        ...shared,
        target_url: targetUrl,
        region_index: regionIndex,
        regions: context.regions,
        shop_id: context.shopId,
      })
    }

    const dateDescriptor = resolveDateDescriptor()
    const compareDescriptor = previousDateDescriptor(dateDescriptor)
    const requestContext = {
      ...context,
      region,
      shopId: sellerIdForRegion(context, region),
    }
    const body = {
      query_condition: [
        {
          query_time: {
            start: dateDescriptor.start,
            end: dateDescriptor.end,
          },
          compare_to_time: {
            start: compareDescriptor.start,
            end: compareDescriptor.end,
          },
          where_filter: {
            attributed_types: {
              value_list: ['overview'],
            },
          },
          metrics: PRODUCT_KEY_METRIC_IDS.map(metricId => ({ metric_id: metricId })),
          abilities: [
            {
              ability_code: 'CompareAbility',
            },
          ],
        },
      ],
    }
    const response = await fetch(buildUrl(requestContext), {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'X-Tt-Oec-Region': region,
      },
      body: JSON.stringify(body),
    })
    const payload = await response.json()
    if (payload?.code !== 0) {
      return fail(`商品数据分析接口返回失败：${payload?.message || payload?.code || response.status}`)
    }

    const metrics = extractValues(payload)
    const resolvedDateDescriptor = metrics.interval?.start_date && metrics.interval?.end_date
      ? {
        start: metrics.interval.start_date,
        end: addDays(metrics.interval.end_date, -1),
        apiEndExclusive: metrics.interval.end_date,
      }
      : dateDescriptor
    const row = {
      平台名称: 'TikTok',
      区域: region,
      店铺ID: requestContext.shopId,
      店铺名称: context.shopName,
      统计日期范围: dateRangeLabel(resolvedDateDescriptor),
      对比日期范围: dateRangeLabel(compareDescriptor),
      抓取时间: nowText(),
      订单数: metrics.orders,
      商品曝光次数: metrics.impressions,
      商品点击量: metrics.clicks,
    }
    const hasMore = regionIndex + 1 < context.regions.length
    const nextRegionIndex = hasMore ? regionIndex + 1 : regionIndex
    const nextShared = {
      ...shared,
      regions: context.regions,
      current_region: region,
      region_index: nextRegionIndex,
      shop_id: requestContext.shopId,
      shop_name: context.shopName,
      date_descriptor: resolvedDateDescriptor,
      date_range: dateRangeLabel(resolvedDateDescriptor),
      compare_date_range: dateRangeLabel(compareDescriptor),
      total_rows: (Number(shared.total_rows) || 0) + 1,
      current_exec_no: (Number(shared.current_exec_no) || 0) + 1,
      current_store: `TikTok商品数据分析 / ${region}`,
      search_total_codes: context.regions.length,
      search_completed_codes: (Number(shared.search_completed_codes) || 0) + 1,
    }
    if (hasMore) {
      return {
        success: true,
        data: [row],
        meta: {
          action: 'next_phase',
          next_phase: 'main',
          sleep_ms: 800,
          has_more: true,
          shared: nextShared,
        },
      }
    }
    return complete([row], false, nextShared)
  } catch (error) {
    return fail(error?.message || error)
  }
})()
