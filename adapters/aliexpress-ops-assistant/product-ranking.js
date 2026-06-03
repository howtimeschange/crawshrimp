;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const DEFAULT_CHANNEL_ID = '125417'
  const TARGET_PATH = '/m_apps/csp-sycm-new/productRank'
  const TABLE_API = 'mtop.aliexpress.seller.business.advice.table.query'
  const DATA_DELAY_API = 'mtop.aliexpress.seller.data.delay.plan'
  const DEFAULT_PAGE_SIZE = 50
  const MAX_PAGE_SIZE = 100
  const DEFAULT_MAX_PAGES = 500
  const RANK_TYPE_LABELS = {
    pay_amt: '支付榜',
    item_uv: '访客榜',
    wishlist: '收藏量',
    item_add_wishlist_buyer_cnt: '收藏量',
    addcart: '加购榜',
    item_add_cart_buyer_cnt: '加购榜',
  }
  const FIRST_ONLINE_LABELS = {
    false: '全部商品',
    true: '30天内上架新品',
    isPremiumQuality: '品质商品',
  }
  const BIZ_TYPE_LABELS = {
    ALL: '全部业务模式',
    choice: '已加入半托管',
    can_join_choice: '可加入半托管',
  }

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function numeric(value) {
    if (value == null || value === '') return ''
    if (typeof value === 'number' && Number.isFinite(value)) return value
    const text = compact(value).replace(/,/g, '')
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
    return compact(value)
  }

  function positiveInt(value, fallback = 0) {
    const number = Number.parseInt(value, 10)
    return Number.isFinite(number) && number > 0 ? number : fallback
  }

  function clamp(value, fallback, min, max) {
    const number = Number(value)
    const candidate = Number.isFinite(number) ? number : fallback
    return Math.max(min, Math.min(max, candidate))
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

  function dateToLocalTimestamp(value) {
    const [year, month, day] = String(value || '').split('-').map(Number)
    if (!year || !month || !day) return Date.now()
    return new Date(year, month - 1, day).getTime()
  }

  function normalizeDateType(value) {
    const text = compact(value).toLowerCase()
    if (!text || text === 'page' || text === 'current') return 'page'
    if (['recent1', 'last1', '最近1天', '最近一天'].includes(text)) return 'recent1'
    if (['recent7', 'last7', '最近7天'].includes(text)) return 'recent7'
    if (['recent30', 'last30', '最近30天'].includes(text)) return 'recent30'
    if (['day', '自然日'].includes(text)) return 'day'
    if (['week', '自然周'].includes(text)) return 'week'
    if (['month', '自然月'].includes(text)) return 'month'
    return text
  }

  function dateTypeLabel(value) {
    const normalized = normalizeDateType(value)
    if (normalized === 'recent7') return '最近7天'
    if (normalized === 'recent30') return '最近30天'
    if (normalized === 'day') return '自然日'
    if (normalized === 'week') return '自然周'
    if (normalized === 'month') return '自然月'
    return '最近1天'
  }

  function dateRangeLabel(start, end) {
    return `${start} ~ ${end || start}`
  }

  function ratioText(value) {
    if (value == null || value === '') return ''
    const number = Number(value)
    if (!Number.isFinite(number)) return compact(value)
    return `${(number * 100).toFixed(2)}%`
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

  function readInputById(id) {
    const node = Array.from(document.querySelectorAll('input') || [])
      .find(input => compact(input?.id) === id)
    return compact(node?.value || node?.getAttribute?.('value') || '')
  }

  function readInputDates() {
    return Array.from(document.querySelectorAll('input') || [])
      .map(input => ({
        value: parseDateText(input?.value || input?.getAttribute?.('value') || ''),
        placeholder: compact(input?.placeholder || input?.getAttribute?.('placeholder') || ''),
      }))
      .filter(item => item.value)
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

  function resolvePlatform() {
    const code = compact(params.platform || shared.platform_code)
    if (code && !/^page$/i.test(code)) {
      return {
        code,
        label: compact(params.platform_label || shared.platform_label) || (code === 'ALL' ? '所有平台' : code),
      }
    }
    return { code: 'ALL', label: '所有平台' }
  }

  function resolveBizType() {
    const code = compact(params.biz_type || params.bizType || shared.biz_type_code)
    if (code && !/^page$/i.test(code)) {
      return {
        code,
        label: compact(params.biz_type_label || shared.biz_type_label) || BIZ_TYPE_LABELS[code] || code,
      }
    }
    return { code: 'ALL', label: '全部业务模式' }
  }

  function resolveCategory() {
    const raw = compact(params.category_id || params.categoryId || shared.category_id)
    const level = positiveInt(params.category_level || params.categoryLevel || shared.category_level, raw && raw !== '-9999' ? 4 : 1)
    return {
      id: raw || '-9999',
      level,
      label: compact(params.category_label || shared.category_label) || (raw && raw !== '-9999' ? raw : '所有类目'),
    }
  }

  function resolveFirstOnline30d() {
    const raw = compact(params.first_online_30d ?? params.firstOnline30d ?? shared.first_online_30d)
    if (!raw || /^page$/i.test(raw)) return false
    if (/isPremiumQuality|品质/i.test(raw)) return 'isPremiumQuality'
    if (/^(true|1|yes|new|新品)$/i.test(raw)) return true
    return 'false'
  }

  function normalizeRankType(value) {
    const text = compact(value).toLowerCase()
    if (!text || text === 'page' || text === 'pay' || text === '支付榜') return 'pay_amt'
    if (['visitor', 'visitors', 'uv', 'item_uv', '访客榜'].includes(text)) return 'item_uv'
    if (['wishlist', 'wish', 'favorite', '收藏量'].includes(text)) return 'wishlist'
    if (['cart', 'addcart', 'add_cart', '加购榜'].includes(text)) return 'addcart'
    return compact(value)
  }

  function resolveRankType() {
    return normalizeRankType(params.rank_type || params.rankType || shared.rank_type)
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
      const model = models.find(item => item?.pageModel === 'productRank' || item?.pageModel === 'productRankSource')
      if (model && Number.isFinite(Number(model.dateSub))) {
        return addDays(todayText(), Number(model.dateSub))
      }
    } catch (error) {}
    return defaultAvailableStatDate()
  }

  async function resolveDateContext(channelId) {
    const requestedType = normalizeDateType(params.time_range || params.date_type || shared.date_type)
    const inputDates = readInputDates().map(item => item.value)
    const explicitStart = parseDateText(params.stat_start || params.start_date || params.date_range?.start || params.stat_date_range?.start)
    const explicitEnd = parseDateText(params.stat_end || params.end_date || params.date_range?.end || params.stat_date_range?.end)
    const explicitDate = parseDateText(params.stat_date || params.date || params.target_date)
    let start = explicitStart || inputDates[0] || ''
    let end = explicitEnd || inputDates[1] || inputDates[0] || ''
    if (explicitDate) {
      start = explicitDate
      end = explicitDate
    }
    if (!start || !end) {
      const available = await resolveAvailableStatDate(channelId)
      start = start || available
      end = end || available
    }
    return {
      dateType: requestedType === 'page' ? inferDateTypeFromRange(start, end) : requestedType,
      start,
      end,
      statDate: end || start,
    }
  }

  function inferDateTypeFromRange(start, end) {
    if (!start || !end) return 'recent1'
    const startTime = new Date(`${start}T00:00:00`).getTime()
    const endTime = new Date(`${end}T00:00:00`).getTime()
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 'recent1'
    const days = Math.round((endTime - startTime) / 86400000) + 1
    if (days >= 28) return 'recent30'
    if (days >= 7) return 'recent7'
    return 'recent1'
  }

  function pageSize() {
    return Math.floor(clamp(params.page_size || shared.page_size, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE))
  }

  function maxPages() {
    return positiveInt(params.max_pages || params.max_pages_per_filter || shared.max_pages, DEFAULT_MAX_PAGES)
  }

  function buildRequestData(context, current) {
    const data = {
      categoryLevel: context.category.level,
      categoryId: context.category.id,
      statDate: dateToLocalTimestamp(context.date.statDate),
      dateType: context.date.dateType,
      current,
      pageSize: context.pageSize,
      firstOnline30d: context.firstOnline30d,
      rankType: context.rankType,
      bizType: context.bizType.code,
      url: '/api/goods-rank-new/indicator',
      platform: context.platform.code,
      country: context.country.code,
    }
    const itemId = compact(params.item_id || params.itemId || readInputById('itemId') || shared.item_id)
    if (itemId) data.itemId = itemId
    return data
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
    if (!mtop) throw new Error('当前页面未找到 window.lib.mtop.request，请在已登录的速卖通商品排行页面运行')
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

  function extractRows(payload) {
    const source = payload?.data?.dataSource || payload?.data?.data?.dataSource || []
    return Array.isArray(source) ? source : []
  }

  function extractTotal(payload, fallback) {
    const candidates = [
      payload?.data?.recordCount,
      payload?.data?.total,
      payload?.data?.totalCount,
      payload?.data?.pageInfo?.total,
      payload?.data?.pageInfo?.recordCount,
    ]
    for (const value of candidates) {
      const total = positiveInt(value, 0)
      if (total > 0) return total
    }
    return fallback
  }

  function buildRow(item, context, pageNo, indexInPage, fallbackRank) {
    const firstOnlineKey = String(context.firstOnline30d)
    return {
      平台名称: 'AliExpress',
      店铺名称: context.shopName,
      channelId: context.channelId,
      榜单类型: RANK_TYPE_LABELS[context.rankType] || context.rankType,
      统计日期: parseDateText(item.statDate) || context.date.statDate,
      统计日期范围: dateRangeLabel(context.date.start, context.date.end),
      时间筛选: dateTypeLabel(context.date.dateType),
      国家: context.country.label,
      国家编码: context.country.code,
      平台筛选: context.platform.label,
      平台编码: context.platform.code,
      类目: compact(item.cateLeafName || context.category.label),
      类目路径: compact(item.cateLeafPathName),
      类目ID: compact(item.cateId || context.category.id),
      业务模式: BIZ_TYPE_LABELS[context.bizType.code] || context.bizType.label,
      业务模式编码: context.bizType.code,
      商品筛选: FIRST_ONLINE_LABELS[firstOnlineKey] || context.firstOnline30d,
      页码: pageNo,
      页内序号: indexInPage + 1,
      排行: numeric(item.rank || fallbackRank),
      商品ID: compact(item.itemId),
      商品名称: compact(item.title),
      商品图片: compact(item.imageUrl),
      商品链接: compact(item.detailPageUrl),
      最低价: compact(item.minPrice),
      最高价: compact(item.maxPrice),
      商品状态: compact(item.status),
      Choice商品: item.choice === true ? '是' : item.choice === false ? '否' : '',
      首次上架时间: item.firstOnlineDate ? dateText(new Date(Number(item.firstOnlineDate))) : '',
      支付金额: numeric(item.payAmt),
      支付金额环比: ratioText(item.payAmtChainRatio),
      税费: numeric(item.divPayableTaxAmt),
      税费环比: ratioText(item.divPayableTaxAmtChainRatio),
      商品访客数: numeric(item.uv),
      商品访客数环比: ratioText(item.uvChainRatio),
      新访客数: numeric(item.newVisitorCnt),
      新访客数环比: ratioText(item.newVisitorCntChainRatio),
      老访客数: numeric(item.oldVisitorCnt),
      老访客数环比: ratioText(item.oldVisitorCntChainRatio),
      支付买家数: numeric(item.payBuyerCnt),
      支付买家数环比: ratioText(item.payBuyerCntChainRatio),
      新支付买家数: numeric(item.payNewBuyerCnt),
      新支付买家数环比: ratioText(item.payNewBuyerCntChainRatio),
      老支付买家数: numeric(item.payOldBuyerCnt),
      老支付买家数环比: ratioText(item.payOldBuyerCntChainRatio),
      支付转化率: ratioText(item.payConversionRate),
      支付转化率环比: ratioText(item.payConversionRateChainRatio),
      客单价: numeric(item.payPerBuyerAmt),
      客单价环比: ratioText(item.payPerBuyerAmtChainRatio),
      支付件数: numeric(item.payItemQty),
      支付件数环比: ratioText(item.payItemQtyChainRatio),
      支付订单数: numeric(item.payMordCnt),
      支付订单数环比: ratioText(item.payMordCntChainRatio),
      下单金额: numeric(item.orderAmt),
      下单金额环比: ratioText(item.orderAmtChainRatio),
      下单买家数: numeric(item.orderBuyerCnt),
      下单买家数环比: ratioText(item.orderBuyerCntChainRatio),
      下单件数: numeric(item.orderItemQty),
      下单件数环比: ratioText(item.orderItemQtyChainRatio),
      下单转化率: ratioText(item.orderConversionRate),
      下单转化率环比: ratioText(item.orderConversionRateChainRatio),
      搜索曝光次数: numeric(item.searchExpPv),
      搜索曝光次数环比: ratioText(item.searchExpPvChainRatio),
      加购买家数: numeric(item.itemAddCartBuyerCnt),
      加购买家数环比: ratioText(item.itemAddCartBuyerCntChainRatio),
      收藏买家数: numeric(item.itemAddWishListBuyerCnt),
      收藏买家数环比: ratioText(item.itemAddWishListBuyerCntChainRatio),
      详情到下单转化率: ratioText(item.l2dUvRate),
      详情到下单转化率环比: ratioText(item.l2dUvRateChainRatio),
      退款金额: numeric(item.refundAmt),
      退款金额环比: ratioText(item.refundAmtChainRatio),
      停留时长: numeric(item.avgStayTime),
      停留时长环比: ratioText(item.avgStayTimeChainRatio),
      环比标签: compact(item.chainRatioText),
      抓取时间: context.capturedAt,
    }
  }

  function nextPhase(name, sleepMs, nextShared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'next_phase',
        next_phase: name,
        sleep_ms: sleepMs,
        has_more: true,
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

  async function buildContext() {
    const channelId = normalizeChannelId(params.channel_id || shared.channel_id)
    const date = shared.date_context || await resolveDateContext(channelId)
    return {
      channelId,
      shopName: compact(shared.shop_name || params.shop_name) || readShopName(),
      country: shared.country || resolveCountry(),
      platform: shared.platform || resolvePlatform(),
      bizType: shared.biz_type || resolveBizType(),
      category: shared.category || resolveCategory(),
      firstOnline30d: shared.first_online_30d ?? resolveFirstOnline30d(),
      rankType: compact(shared.rank_type || resolveRankType()),
      date,
      pageSize: positiveInt(shared.page_size, pageSize()),
      maxPages: positiveInt(shared.max_pages, maxPages()),
      capturedAt: compact(shared.captured_at) || nowText(),
    }
  }

  try {
    if (!isTargetPage()) {
      const targetUrl = buildTargetUrl()
      location.assign?.(targetUrl)
      if (location.href !== targetUrl) location.href = targetUrl
      return nextPhase('main', 2200, { ...shared, target_url: targetUrl }, [])
    }

    const context = await buildContext()
    const currentPage = positiveInt(shared.next_page, 1)
    const payload = await callMtop({
      api: TABLE_API,
      type: 'GET',
      data: buildRequestData(context, currentPage),
    })
    const apiRows = extractRows(payload)
    const completedBefore = positiveInt(shared.completed_count, 0)
    const fallbackTotal = completedBefore + apiRows.length
    const totalRows = extractTotal(payload, positiveInt(shared.total_rows, fallbackTotal))
    const rows = apiRows.map((item, index) => buildRow(
      item,
      context,
      currentPage,
      index,
      completedBefore + index + 1,
    ))
    const completedCount = completedBefore + rows.length
    const hasMore = rows.length > 0 &&
      completedCount < totalRows &&
      currentPage < context.maxPages
    const nextShared = {
      ...shared,
      channel_id: context.channelId,
      shop_name: context.shopName,
      country: context.country,
      platform: context.platform,
      biz_type: context.bizType,
      category: context.category,
      first_online_30d: context.firstOnline30d,
      rank_type: context.rankType,
      date_context: context.date,
      page_size: context.pageSize,
      max_pages: context.maxPages,
      captured_at: context.capturedAt,
      total_rows: totalRows,
      completed_count: completedCount,
      current_exec_no: completedCount,
      current_row_no: completedCount,
      current_buyer_id: rows[rows.length - 1]?.商品ID || shared.current_buyer_id || '',
      current_store: `速卖通商品排行 / ${RANK_TYPE_LABELS[context.rankType] || context.rankType} / ${dateRangeLabel(context.date.start, context.date.end)}`,
      batch_no: currentPage,
      total_batches: Math.max(currentPage, Math.ceil(totalRows / context.pageSize)),
      next_page: currentPage + 1,
    }
    if (hasMore) return nextPhase('main', 500, nextShared, rows)
    return complete(rows, nextShared)
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
