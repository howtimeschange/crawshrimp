;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'

  const DEFAULT_REGION = 'US'
  const DEFAULT_SHOP_ID = '7496042382582647544'
  const KNOWN_REGIONS = ['US', 'GB', 'FR', 'DE', 'IT', 'ES']
  const METRIC_TYPES = [1, 2, 5, 11, 14, 15, 16, 12]
  const GMT8_OFFSET_SECONDS = -28800
  const DAY_SECONDS = 86400
  const TIKTOK_MAX_RANGE_DAYS = 90

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function clampInt(value, fallback, min, max) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    const integer = Math.floor(parsed)
    if (Number.isFinite(min) && integer < min) return min
    if (Number.isFinite(max) && integer > max) return max
    return integer
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

  function readAvailableRegions(account) {
    const regions = new Set()
    const addRegion = value => {
      const region = compact(value).toUpperCase()
      if (/^[A-Z]{2}$/.test(region)) regions.add(region)
    }
    const query = new URLSearchParams(location.search || '')
    addRegion(query.get('shop_region'))
    addRegion(account?.shop?.region)
    addRegion(localStorage.getItem('ecom-seller-affiliate-selected-shop-region'))
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
      shopName: compact(account.shop?.shop_name || account.globalSeller?.global_seller_name),
      currentRegion,
      regions: [...knownFirst, ...extra],
    }
  }

  function parseDateRangeParam(value) {
    if (!value || typeof value !== 'object') return null
    const start = compact(value.start || value.from || value.begin)
    const end = compact(value.end || value.to || value.finish)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null
    return { start, end }
  }

  function dateToEpochAtOffset(dateText, offsetSeconds, endOfDay = false) {
    const [year, month, day] = dateText.split('-').map(Number)
    const utcMs = Date.UTC(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0)
    return Math.floor(utcMs / 1000) - offsetSeconds
  }

  function localDateToEpochAtOffset(date, offsetSeconds, endOfDay = false) {
    const utcMs = Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
    )
    return Math.floor(utcMs / 1000) - offsetSeconds
  }

  function epochToDateTextAtOffset(epochSeconds, offsetSeconds) {
    const date = new Date((epochSeconds + offsetSeconds) * 1000)
    const pad = number => String(number).padStart(2, '0')
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  }

  function createTimeDescriptor(startTime, endTime) {
    return {
      granularity_type: 1,
      timezone_offset: GMT8_OFFSET_SECONDS,
      start_time: startTime,
      end_time: endTime,
    }
  }

  function latestSelectableDateStartTime() {
    const now = new Date()
    const latestLocalMs = Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 2,
      0,
      0,
      0,
    )
    return Math.floor(latestLocalMs / 1000) - GMT8_OFFSET_SECONDS
  }

  function latestSelectableEndTime() {
    return latestSelectableDateStartTime() + DAY_SECONDS
  }

  function recentDaysTimeDescriptor(days) {
    const endTime = latestSelectableEndTime()
    return createTimeDescriptor(endTime - clampInt(days, 7, 1, TIKTOK_MAX_RANGE_DAYS) * DAY_SECONDS, endTime)
  }

  function previousWeekTimeDescriptor() {
    const now = new Date()
    const shifted = new Date(now.getTime() + GMT8_OFFSET_SECONDS * 1000)
    const dayOfWeek = shifted.getUTCDay()
    const daysSinceMonday = (dayOfWeek + 6) % 7
    const currentWeekStartLocalMs = Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() - daysSinceMonday,
      0,
      0,
      0,
    )
    const currentWeekStartUtc = Math.floor(currentWeekStartLocalMs / 1000) - GMT8_OFFSET_SECONDS
    return createTimeDescriptor(currentWeekStartUtc - 7 * DAY_SECONDS, currentWeekStartUtc)
  }

  function validateCustomTimeRange(range) {
    if (!range) throw new Error('选择自定义日期时，请填写开始和结束日期')
    const startTime = dateToEpochAtOffset(range.start, GMT8_OFFSET_SECONDS, false)
    const endTime = dateToEpochAtOffset(range.end, GMT8_OFFSET_SECONDS, true) + 1
    if (endTime <= startTime) throw new Error('自定义日期结束时间不能早于开始时间')

    const latestEnd = latestSelectableEndTime()
    if (endTime > latestEnd) {
      throw new Error(`TikTok 页面最晚只能选择到 ${epochToDateTextAtOffset(latestSelectableDateStartTime(), GMT8_OFFSET_SECONDS)}，请调整自定义日期范围`)
    }
    const earliestStart = latestEnd - TIKTOK_MAX_RANGE_DAYS * DAY_SECONDS
    if (startTime < earliestStart || endTime - startTime > TIKTOK_MAX_RANGE_DAYS * DAY_SECONDS) {
      throw new Error('TikTok 页面仅显示过去 90 天的数据，请缩短或调整自定义日期范围')
    }
    return createTimeDescriptor(startTime, endTime)
  }

  function validatePublishDateRange(range) {
    if (!range) return null
    const startTime = dateToEpochAtOffset(range.start, GMT8_OFFSET_SECONDS, false)
    const endTime = dateToEpochAtOffset(range.end, GMT8_OFFSET_SECONDS, true) + 1
    if (endTime <= startTime) throw new Error('视频发布时间结束时间不能早于开始时间')

    const latestEnd = latestSelectableEndTime()
    if (endTime > latestEnd) {
      throw new Error(`TikTok 页面最晚只能选择到 ${epochToDateTextAtOffset(latestSelectableDateStartTime(), GMT8_OFFSET_SECONDS)}，请调整视频发布时间范围`)
    }
    const earliestStart = latestEnd - TIKTOK_MAX_RANGE_DAYS * DAY_SECONDS
    if (startTime < earliestStart || endTime - startTime > TIKTOK_MAX_RANGE_DAYS * DAY_SECONDS) {
      throw new Error('TikTok 页面仅显示过去 90 天的视频发布时间，请缩短或调整筛选范围')
    }
    return {
      start_time: startTime,
      end_time: endTime,
      timezone_offset: GMT8_OFFSET_SECONDS,
    }
  }

  function normalizeTimeRange(value) {
    const text = compact(value).toLowerCase()
    if (!text || text === 'page' || text === 'current' || text === '页面当前筛选' || text === '沿用页面当前筛选') return 'page'
    if (text === 'last7' || text === 'recent7' || text === '最近7天') return 'last7'
    if (text === 'last28' || text === 'recent28' || text === '最近28天') return 'last28'
    if (text === 'last_week' || text === 'lastweek' || text === '上周') return 'last_week'
    if (text === 'custom' || text === '自定义' || text === '自定义日期') return 'custom'
    return text
  }

  function defaultTimeDescriptor() {
    return recentDaysTimeDescriptor(7)
  }

  function parsePageDateText(value) {
    const text = compact(value)
    const match = text.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
    if (!match) return ''
    return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`
  }

  function readPageTimeDescriptor() {
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
          .map(input => parsePageDateText(input?.value || input?.placeholder || ''))
          .filter(Boolean)
        if (inputs.length >= 2) {
          const startTime = dateToEpochAtOffset(inputs[0], GMT8_OFFSET_SECONDS, false)
          const endTime = dateToEpochAtOffset(inputs[1], GMT8_OFFSET_SECONDS, true) + 1
          if (endTime > startTime) return createTimeDescriptor(startTime, endTime)
        }
      }
    }
    return null
  }

  function resolveTimeDescriptor() {
    if (shared.time_descriptor && typeof shared.time_descriptor === 'object') {
      return { ...shared.time_descriptor }
    }
    const range = parseDateRangeParam(params.date_range || params.video_date_range || params.custom_range)
    const timeRange = normalizeTimeRange(params.time_range || params.video_time_range)
    if (range) {
      return validateCustomTimeRange(range)
    }
    if (timeRange === 'custom') {
      return validateCustomTimeRange(range)
    }
    if (timeRange === 'last28') {
      return recentDaysTimeDescriptor(28)
    }
    if (timeRange === 'last_week') {
      return previousWeekTimeDescriptor()
    }
    if (timeRange === 'last7') {
      return defaultTimeDescriptor()
    }
    return readPageTimeDescriptor() || defaultTimeDescriptor()
  }

  function resolvePublishDateDescriptor() {
    if (shared.publish_date_descriptor && typeof shared.publish_date_descriptor === 'object') {
      return { ...shared.publish_date_descriptor }
    }
    const range = parseDateRangeParam(
      params.publish_date_range ||
      params.video_publish_date_range ||
      params.video_post_date ||
      params.post_date_range
    )
    return validatePublishDateRange(range)
  }

  function buildUrl(context, region) {
    const url = new URL('/api/v1/oec/affiliate/compass/transaction/detail_list/get', location.origin)
    url.searchParams.set('user_language', 'zh-CN')
    url.searchParams.set('aid', '6556')
    url.searchParams.set('app_name', 'i18n_ecom_alliance')
    url.searchParams.set('device_platform', 'web')
    url.searchParams.set('cookie_enabled', 'true')
    url.searchParams.set('browser_online', 'true')
    url.searchParams.set('timezone_name', Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai')
    url.searchParams.set('oec_seller_id', context.shopId)
    url.searchParams.set('shop_region', region)
    return url.href
  }

  function buildTargetUrl(context, region) {
    const url = new URL('https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis')
    url.searchParams.set('shop_region', region || context.currentRegion || DEFAULT_REGION)
    url.searchParams.set('shop_id', context.shopId || DEFAULT_SHOP_ID)
    return url.href
  }

  function isTargetPage() {
    return /affiliate\.tiktokshopglobalselling\.com$/i.test(String(location.hostname || '')) && /\/insights\/transaction-analysis/.test(String(location.pathname || ''))
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

  function amount(value) {
    return compact(value?.amount_formatted || value?.amount_delimited || value?.amount || '')
  }

  function metricValue(value) {
    return compact(value?.value_delimited || value?.value_kmb_formatted || value?.value || '')
  }

  function firstUrl(value) {
    if (!value) return ''
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return compact(value[0])
    if (typeof value === 'object') return firstUrl(value.url_list || value.thumb_url_list || value.url || value.src)
    return ''
  }

  function joinCategories(categories) {
    return Array.isArray(categories)
      ? categories.map(item => compact(item?.category_name || item?.name)).filter(Boolean).join(' / ')
      : ''
  }

  function formatTikTokTime(value) {
    const text = compact(value)
    if (!text || text === '0') return ''
    let ms = Number(text)
    if (!Number.isFinite(ms)) return text
    if (ms > 0 && ms < 100000000000) ms *= 1000
    const date = new Date(ms - 8 * 3600 * 1000)
    if (Number.isNaN(date.getTime())) return text
    const pad = number => String(number).padStart(2, '0')
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  }

  function safeFilename(value) {
    return compact(value).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  }

  function resolveProductIdFilter() {
    return compact(params.product_id || params.productId || params.item_id || params.itemId)
  }

  function buildRequestFilter(productIdFilter, publishDateDescriptor) {
    const filter = {}
    if (productIdFilter) filter.product_id = productIdFilter
    if (publishDateDescriptor) filter.video_post_date = publishDateDescriptor
    return filter
  }

  function filenameTime(value) {
    const formatted = formatTikTokTime(value)
    return formatted ? formatted.replace(' ', '_').replace(/:/g, '-') : compact(value) || 'unknown_time'
  }

  function filenameSoldCount(value) {
    const text = compact(value)
    if (!text) return '0件'
    const numberText = text.replace(/,/g, '')
    const numeric = Number(numberText)
    if (Number.isFinite(numeric)) return `${Math.max(0, Math.floor(numeric))}件`
    return `${text}件`
  }

  function pickPlayUrl(playInfo) {
    const urls = Array.isArray(playInfo?.play_urls) ? playInfo.play_urls : []
    return compact(urls.find(url => /mime_type=video_mp4|\.mp4|v16m-default/i.test(String(url || ''))) || urls[0])
  }

  function buildPlannedFilename(region, creatorAccount, videoId, productId, timePart, soldCountPart) {
    const parts = [
      safeFilename(soldCountPart || '0件'),
      safeFilename(region || DEFAULT_REGION),
      safeFilename(creatorAccount || 'unknown_creator'),
      safeFilename(videoId || 'unknown_video'),
      safeFilename(productId || 'unknown_product'),
      safeFilename(timePart || 'unknown_time'),
    ].filter(Boolean)
    return `${parts.join('_')}.mp4`
  }

  function parseSoldCount(value) {
    const text = compact(value)
    if (!text) return 0
    const match = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
    if (!match) return 0
    const numeric = Number(match[0])
    return Number.isFinite(numeric) ? numeric : 0
  }

  function sortNormalizedBySoldCount(items) {
    return items
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        const diff = parseSoldCount(right.item?.row?.视频归因成交件数) - parseSoldCount(left.item?.row?.视频归因成交件数)
        return diff || left.index - right.index
      })
      .map(entry => entry.item)
  }

  function normalizeVideo(item, context, pageNo, index) {
    const video = item?.video_info || {}
    const creator = item?.creator_base || {}
    const product = item?.product_base || {}
    const metrics = item?.video_metrics || {}
    const playInfo = video.play_info || {}
    const videoId = compact(video.item_id || video.video_id)
    const creatorId = compact(creator.oec_id || creator.creator_id || creator.user_id || creator.handle_name)
    const creatorAccount = compact(creator.handle_name || creator.unique_id || creatorId)
    const productId = compact(product.id || product.product_id)
    const timePart = filenameTime(video.create_time)
    const soldCount = metricValue(metrics.video_items_sold_cnt)
    const filename = buildPlannedFilename(context.region, creatorAccount, videoId, productId, timePart, filenameSoldCount(soldCount))
    const playUrl = pickPlayUrl(playInfo)

    const row = {
      区域: context.region,
      店铺ID: context.shopId,
      店铺名称: context.shopName,
      页码: pageNo,
      序号: ((pageNo - 1) * context.pageSize) + index + 1,
      视频ID: videoId,
      播放ID: compact(playInfo.id),
      视频标题: compact(video.title),
      视频发布时间: formatTikTokTime(video.create_time),
      视频发布时间戳: compact(video.create_time),
      达人ID: creatorId,
      达人账号: compact(creator.handle_name),
      达人昵称: compact(creator.nick_name || creator.nickname),
      粉丝数: compact(creator.follower_cnt),
      商品ID: productId,
      商品名称: compact(product.title || product.product_name),
      类目: joinCategories(item?.categories),
      联盟视频归因GMV: amount(metrics.video_gmv),
      视频归因成交件数: soldCount,
      退款金额: amount(metrics.video_refunded_gmv),
      已退款的商品件数: metricValue(metrics.video_refunded_items_cnt),
      归因于视频的订单数: metricValue(metrics.video_orders_cnt),
      平均订单金额: amount(metrics.video_average_order_value),
      每位客户的平均GMV: amount(metrics.video_average_gmv_per_buyer),
      预计佣金: amount(metrics.video_estimated_commission),
      视频时长秒: playInfo.duration ? Math.round(Number(playInfo.duration) / 1000) : '',
      视频宽度: playInfo.width || '',
      视频高度: playInfo.height || '',
      视频封面: firstUrl(video.cover),
      视频下载URL: playUrl,
      计划文件名: filename,
      下载结果: playUrl ? '待下载' : '无下载地址',
      本地文件: '',
      下载备注: '',
    }

    return {
      row,
      download: playUrl ? {
        url: playUrl,
        filename,
        label: `${context.region || DEFAULT_REGION} / ${videoId || playInfo.id || 'video'} / ${creator.handle_name || creatorId || 'creator'}`,
        headers: {
          Referer: 'https://affiliate.tiktokshopglobalselling.com/',
          'User-Agent': (typeof navigator !== 'undefined' && navigator.userAgent) || 'Mozilla/5.0',
        },
        timeout_seconds: 180,
      } : null,
    }
  }

  function downloadUrls(items, nextShared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'download_urls',
        items,
        strict: false,
        concurrency: clampInt(params.download_concurrency, 2, 1, 4),
        retry_attempts: 2,
        retry_delay_ms: 1000,
        recovery_concurrency: 1,
        recovery_retry_attempts: 2,
        recovery_retry_delay_ms: 5000,
        timeout_seconds: 180,
        shared_key: 'downloadResults',
        next_phase: 'after_download',
        sleep_ms: 0,
        progress_total: Number(nextShared.download_total_files || 0) || undefined,
        progress_completed_offset: 0,
        progress_success_offset: 0,
        progress_failed_offset: 0,
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

  function mergeDownloadResults(rows, result) {
    const items = Array.isArray(result?.items) ? result.items : []
    return rows.map((row, index) => {
      const item = items[index] || {}
      if (!row.视频下载URL) return row
      return {
        ...row,
        下载结果: item.success ? '已下载' : '下载失败',
        本地文件: compact(item.path),
        下载备注: item.success
          ? compact(item.skipped_existing ? '已存在，跳过重复下载' : `文件=${item.filename || row.计划文件名}; 字节=${item.bytes || ''}`)
          : compact(item.error || '下载失败'),
      }
    })
  }

  function summarizeDownloadResult(result) {
    const items = Array.isArray(result?.items) ? result.items : []
    let completed = 0
    let success = 0
    let failed = 0
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      completed += 1
      if (item.success) success += 1
      else failed += 1
    }
    return { completed, success, failed }
  }

  function nextCursorState(current, total, rowCount) {
    const nextPage = current.pageNo + 1
    const hasNextInRegion = rowCount > 0 && nextPage <= current.maxPages && nextPage <= Math.ceil(Math.max(total, rowCount) / current.pageSize)
    if (hasNextInRegion) {
      return {
        regionIndex: current.regionIndex,
        pageNo: nextPage,
        hasMore: true,
      }
    }
    if (current.regionIndex + 1 < current.regions.length) {
      return {
        regionIndex: current.regionIndex + 1,
        pageNo: 1,
        hasMore: true,
      }
    }
    return {
      regionIndex: current.regionIndex,
      pageNo: nextPage,
      hasMore: false,
    }
  }

  try {
    const context = resolveContext()
    const pageSize = clampInt(params.page_size, 20, 1, 100)
    const maxPages = clampInt(params.max_pages_per_region, 50, 1, 500)

    if (phase === 'after_download') {
      const pendingRows = Array.isArray(shared.pendingRows) ? shared.pendingRows : []
      const rows = mergeDownloadResults(pendingRows, shared.downloadResults || {})
      const summary = summarizeDownloadResult(shared.downloadResults || {})
      return complete(rows, !!shared.next_has_more, {
        ...shared,
        region_index: shared.next_region_index,
        page_no: shared.next_page_no,
        pendingRows: [],
        pendingDownloads: [],
        downloadResults: null,
        download_completed_files: summary.completed,
        download_success_files: summary.success,
        download_failed_files: summary.failed,
      })
    }

    const regionIndex = clampInt(shared.region_index, 0, 0, Math.max(context.regions.length - 1, 0))
    const pageNo = clampInt(shared.page_no, 1, 1, maxPages)
    const region = context.regions[regionIndex] || context.currentRegion || DEFAULT_REGION
    if (!region) return fail('未识别到 TikTok 店铺区域，请在参数里选择区域')
    if (!isTargetPage()) {
      const targetUrl = buildTargetUrl(context, region)
      location.href = targetUrl
      return nextPhase('main', 2600, {
        ...shared,
        target_url: targetUrl,
        region_index: regionIndex,
        page_no: pageNo,
        regions: context.regions,
        shop_id: context.shopId,
      })
    }

    const timeDescriptor = resolveTimeDescriptor()
    const productIdFilter = resolveProductIdFilter()
    const publishDateDescriptor = resolvePublishDateDescriptor()
    const requestContext = {
      ...context,
      region,
      pageSize,
    }
    const body = {
      params: {
        detail_list_type: 3,
        video_list_params: [
          {
            time_descriptor: timeDescriptor,
            metric_types: METRIC_TYPES,
            page_param: {
              page_no: pageNo,
              page_size: pageSize,
            },
            sorter: {
              sort_type: 1,
              order_type: 1,
            },
            filter: buildRequestFilter(productIdFilter, publishDateDescriptor),
          },
        ],
      },
    }

    const response = await fetch(buildUrl(requestContext, region), {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const payload = await response.json()
    if (payload?.code !== 0) {
      return fail(`达人视频列表接口返回失败：${payload?.message || payload?.code || response.status}`)
    }

    const segment = Array.isArray(payload?.data?.video_list_segments) ? payload.data.video_list_segments[0] || {} : {}
    const list = Array.isArray(segment.video_performances) ? segment.video_performances : []
    const total = clampInt(segment.total, list.length, 0, Number.MAX_SAFE_INTEGER)
    const normalized = list.map((item, index) => normalizeVideo(item, requestContext, pageNo, index))
    const filteredNormalized = productIdFilter
      ? normalized.filter(item => compact(item?.row?.商品ID) === productIdFilter)
      : normalized
    const sortedPageItems = sortNormalizedBySoldCount(filteredNormalized)
    const rows = sortedPageItems.map(item => item.row)
    const downloads = sortedPageItems.map(item => item.download).filter(Boolean)
    const cursor = nextCursorState({
      regionIndex,
      pageNo,
      pageSize,
      maxPages,
      regions: context.regions,
    }, total, list.length)
    const totalRows = Math.max(
      Number(shared.total_rows || 0),
      regionIndex === 0 ? total : Number(shared.total_rows || 0),
      (Array.isArray(shared.pendingRows) ? shared.pendingRows.length : 0) + rows.length,
    )
    const accumulatedItems = sortNormalizedBySoldCount([
      ...(Array.isArray(shared.pendingRows) ? shared.pendingRows : []).map((row, index) => ({
        row,
        download: Array.isArray(shared.pendingDownloads) ? shared.pendingDownloads[index] || null : null,
      })),
      ...sortedPageItems,
    ])
    const accumulatedRows = accumulatedItems.map(item => item.row)
    const accumulatedDownloads = accumulatedItems.map(item => item.download).filter(Boolean)
    const searchCompletedCodes = Math.min(accumulatedRows.length, totalRows || accumulatedRows.length)
    const nextShared = {
      ...shared,
      regions: context.regions,
      current_region: region,
      shop_id: context.shopId,
      shop_name: context.shopName,
      page_size: pageSize,
      max_pages_per_region: maxPages,
      time_descriptor: segment.time_descriptor || timeDescriptor,
      publish_date_descriptor: publishDateDescriptor,
      pendingRows: accumulatedRows,
      pendingDownloads: accumulatedDownloads,
      next_region_index: cursor.regionIndex,
      next_page_no: cursor.pageNo,
      next_has_more: cursor.hasMore,
      region_index: cursor.regionIndex,
      page_no: cursor.pageNo,
      region_totals: {
        ...(shared.region_totals || {}),
        [region]: total,
      },
      total_rows: totalRows || accumulatedRows.length,
      current_exec_no: searchCompletedCodes,
      current_buyer_id: rows[rows.length - 1]?.视频ID || accumulatedRows[accumulatedRows.length - 1]?.视频ID || '',
      current_store: `TikTok达人视频下载 / ${region}`,
      search_total_codes: totalRows || accumulatedRows.length,
      search_completed_codes: searchCompletedCodes,
      download_total_files: accumulatedDownloads.length,
      download_completed_files: 0,
      download_success_files: 0,
      download_failed_files: 0,
      region_scope: context.regions.join('_'),
    }

    if (cursor.hasMore) {
      return nextPhase('main', 0, nextShared)
    }

    if (accumulatedDownloads.length) return downloadUrls(accumulatedDownloads, nextShared)
    return complete(rows, cursor.hasMore, {
      ...nextShared,
      pendingRows: [],
      pendingDownloads: [],
    })
  } catch (error) {
    return fail(error?.message || error)
  }
})()
