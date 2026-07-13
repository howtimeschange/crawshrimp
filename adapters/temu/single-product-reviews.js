;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'

  const DEFAULT_PAGE_SIZE = 10
  const DEFAULT_MAX_PAGES = 20
  const DEFAULT_BUSY_RETRIES = 3
  const BUSY_RETRY_MS = 5000
  const PAGE_DELAY_MS = 1200
  const API_PATH_PREFIX = '/api/bg/engels/reviews'

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function toNumber(value, fallback, min, max) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    const integer = Math.floor(parsed)
    if (Number.isFinite(min) && integer < min) return min
    if (Number.isFinite(max) && integer > max) return max
    return integer
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  function fail(message) {
    return { success: false, error: message }
  }

  function describeError(error) {
    const direct = compact(error?.message || error?.reason || error?.error || error?.detail || error?.name)
    if (direct) return direct
    if (typeof error === 'string' && compact(error)) return compact(error)
    if (error == null || error === '') return '未返回错误详情'
    try {
      const encoded = JSON.stringify(error)
      if (encoded && encoded !== '{}' && encoded !== '[]') return encoded
    } catch (jsonError) {
      // Some browser exceptions are not JSON serializable; fall back to String below.
    }
    const fallback = compact(String(error))
    return fallback && fallback !== '[object Object]' ? fallback : '未返回错误详情'
  }

  function buildDiagnosticError(error) {
    const details = describeError(error)
    const parts = [`phase=${phase}`]
    let goodsId = ''
    let productUrl = ''
    try {
      goodsId = getGoodsId()
    } catch (goodsError) {
      goodsId = ''
    }
    try {
      productUrl = compact(getProductInput())
    } catch (productError) {
      productUrl = ''
    }
    if (goodsId) parts.push(`goods_id=${goodsId}`)
    if (productUrl) parts.push(`product_url=${productUrl.slice(0, 180)}`)
    const currentUrl = compact(location.href)
    if (currentUrl && currentUrl !== productUrl) parts.push(`current_url=${currentUrl.slice(0, 180)}`)
    return `Temu 单款商品评价脚本执行失败：${details}（${parts.join('，')}）`
  }

  function nextPhase(name, sleepMs = 800, next = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'next_phase',
        next_phase: name,
        sleep_ms: sleepMs,
        shared: next,
      },
    }
  }

  function complete(data, next = shared, options = {}) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: Boolean(options.hasMore),
        sleep_ms: options.sleepMs || 0,
        shared: next,
      },
    }
  }

  function normalizeUrl(rawUrl) {
    const text = compact(rawUrl)
    if (!text) return ''
    if (text.startsWith('//')) return `https:${text}`
    if (/^https?:\/\//i.test(text)) return text
    try {
      return new URL(text, location.href).href
    } catch (error) {
      return text
    }
  }

  function parseUrl(rawUrl) {
    const text = compact(rawUrl)
    if (!text) return null
    try {
      return new URL(text)
    } catch (error) {
      try {
        return new URL(text, String(location.href || 'https://www.temu.com'))
      } catch (nestedError) {
        return null
      }
    }
  }

  function parseGoodsId(rawInput) {
    const text = compact(rawInput)
    const url = parseUrl(text)
    const fromQuery = compact(
      url?.searchParams?.get('goods_id') ||
      url?.searchParams?.get('goodsId') ||
      url?.searchParams?.get('goodsid') ||
      url?.searchParams?.get('product_id'),
    )
    if (/^\d{8,}$/.test(fromQuery)) return fromQuery

    const match =
      text.match(/(?:^|[?&#])goods[_-]?id=(\d{8,})/i) ||
      text.match(/-g-(\d{8,})(?:[./?#]|$)/i) ||
      text.match(/\/goods(?:\\.html)?[?&#][^\\s]*goods_id=(\d{8,})/i)
    return match ? match[1] : ''
  }

  function appendProductInput(target, value) {
    if (Array.isArray(value)) {
      value.forEach(item => appendProductInput(target, item))
      return
    }
    if (value && typeof value === 'object') {
      const rows = value.rows || value.urls || value.links || value.product_urls || value.productUrls
      if (Array.isArray(rows)) {
        rows.forEach(item => appendProductInput(target, item))
        return
      }
    }
    const text = compact(value)
    if (!text) return
    const matches = text.match(/https?:\/\/[^\s,，;；、]+/gi)
    if (matches?.length) {
      matches.forEach(item => target.push(compact(item).replace(/[，,；;、]+$/g, '')))
      return
    }
    target.push(text)
  }

  function getProductInputs() {
    const raw = []
    appendProductInput(raw, params.product_urls)
    appendProductInput(raw, params.productUrls)
    appendProductInput(raw, params.product_url)
    appendProductInput(raw, params.goods_url)
    appendProductInput(raw, params.item_url)
    appendProductInput(raw, params.url)
    appendProductInput(raw, shared.product_urls)
    appendProductInput(raw, shared.productUrls)
    appendProductInput(raw, shared.product_url)
    if (!raw.length) appendProductInput(raw, location.href)

    const seen = new Set()
    return raw.filter(item => {
      const key = compact(item)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  function getProductIndex(productInputs) {
    return toNumber(shared.product_index, 0, 0, Math.max(0, productInputs.length - 1))
  }

  function getProductInput() {
    const productInputs = getProductInputs()
    return productInputs[getProductIndex(productInputs)] || productInputs[0] || location.href
  }

  function getGoodsId() {
    return parseGoodsId(params.goods_id) || parseGoodsId(getProductInput()) || parseGoodsId(location.href)
  }

  function getCurrentGoodsId() {
    return parseGoodsId(location.href)
  }

  function getLocalePrefix() {
    const path = String(location.pathname || '')
    const match = path.match(/^\/([a-z]{2}(?:-[a-z]{2})?)\//i)
    return match ? `/${match[1]}` : ''
  }

  function buildApiUrl(path, query) {
    const localePrefix = compact(shared.locale_prefix || getLocalePrefix())
    const url = new URL(`${localePrefix}${API_PATH_PREFIX}${path}`, location.origin)
    url.searchParams.set('is_back', '1')
    for (const [key, value] of Object.entries(query || {})) {
      if (value != null && value !== '') url.searchParams.set(key, String(value))
    }
    return url.href
  }

  function safeJsonParse(value) {
    if (value == null || value === '') return null
    if (typeof value === 'object') return value
    try {
      return JSON.parse(String(value))
    } catch (error) {
      return null
    }
  }

  async function fetchJson(url) {
    let response
    try {
      response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          Accept: 'application/json,text/plain,*/*',
        },
      })
    } catch (error) {
      const wrapped = new Error(`Temu 评论接口请求失败：${describeError(error)}`)
      wrapped.isBusy = true
      wrapped.cause = error
      throw wrapped
    }
    let payload = null
    try {
      payload = await response.clone().json()
    } catch (error) {
      try {
        payload = safeJsonParse(await response.text())
      } catch (nestedError) {
        payload = null
      }
    }
    if (!response.ok || isBusyPayload(payload)) {
      const message = getPayloadMessage(payload) || `HTTP ${response.status}`
      const error = new Error(message)
      error.status = response.status
      error.payload = payload
      error.isBusy = response.status === 429 || isBusyPayload(payload)
      throw error
    }
    return payload
  }

  function getPayloadMessage(payload) {
    if (!payload || typeof payload !== 'object') return ''
    return compact(payload.error_msg || payload.errorMessage || payload.message || payload.msg || payload.error)
  }

  function isBusyPayload(payload) {
    if (!payload || typeof payload !== 'object') return false
    const code = compact(payload.error_code || payload.errorCode || payload.code)
    const message = getPayloadMessage(payload)
    return code === '40002' || /system busy|too many|busy|429|访问频繁|系统繁忙/i.test(message)
  }

  function firstArray(payload, paths) {
    for (const path of paths) {
      let current = payload
      for (const key of path) {
        if (current == null || typeof current !== 'object') {
          current = null
          break
        }
        current = current[key]
      }
      if (Array.isArray(current)) return current
    }
    return []
  }

  function firstValue(payload, paths) {
    for (const path of paths) {
      let current = payload
      for (const key of path) {
        if (current == null || typeof current !== 'object') {
          current = undefined
          break
        }
        current = current[key]
      }
      if (current != null && current !== '') return current
    }
    return undefined
  }

  function extractReviewItems(payload) {
    return firstArray(payload, [
      ['data'],
      ['result', 'data'],
      ['result', 'reviews'],
      ['result', 'list'],
      ['reviews'],
      ['list'],
      ['items'],
    ])
  }

  function getTotalCount(payload) {
    return toNumber(firstValue(payload, [
      ['total'],
      ['total_count'],
      ['totalCount'],
      ['review_count'],
      ['result', 'total'],
      ['result', 'total_count'],
      ['result', 'totalCount'],
      ['data', 'total'],
      ['data', 'total_count'],
      ['data', 'totalCount'],
      ['data', 'review_count'],
    ]), 0, 0, Number.MAX_SAFE_INTEGER)
  }

  function hasMore(payload, rows, page, pageSize, total, observedPageSize = 0) {
    const explicit = firstValue(payload, [
      ['has_more'],
      ['hasMore'],
      ['result', 'has_more'],
      ['result', 'hasMore'],
    ])
    if (explicit === true) return true
    if (explicit === false) return false
    const text = compact(explicit).toLowerCase()
    if (['true', '1', 'yes'].includes(text)) return true
    if (['false', '0', 'no'].includes(text)) return false
    if (total && page * pageSize < total) return true
    const effectivePageSize = Math.max(1, Math.min(pageSize, observedPageSize || pageSize))
    return Array.isArray(rows) && rows.length >= effectivePageSize
  }

  function normalizeSpecs(value) {
    const parsed = safeJsonParse(value)
    if (Array.isArray(parsed)) {
      return parsed
        .map(item => `${compact(item.spec_key || item.specKey || item.key || item.name)}: ${compact(item.spec_value || item.specValue || item.value)}`)
        .filter(item => !/^:\s*$/.test(item))
        .join('; ')
    }
    if (Array.isArray(value)) return normalizeSpecs(JSON.stringify(value))
    if (value && typeof value === 'object') {
      return Object.entries(value)
        .map(([key, val]) => `${compact(key)}: ${compact(val)}`)
        .filter(item => !/^:\s*$/.test(item))
        .join('; ')
    }
    return compact(value)
  }

  function normalizeImageList(value) {
    const list = Array.isArray(value) ? value : (value ? [value] : [])
    return list
      .map(item => {
        if (typeof item === 'string') return normalizeUrl(item)
        if (item && typeof item === 'object') return normalizeUrl(item.url || item.picUrl || item.imgUrl || item.imageUrl || item.src)
        return ''
      })
      .filter(Boolean)
  }

  function formatEpoch(value) {
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) return ''
    const ms = n > 10_000_000_000 ? n : n * 1000
    const date = new Date(ms)
    if (Number.isNaN(date.getTime())) return ''
    const pad = item => String(item).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }

  function parseCountry(rawText) {
    const text = compact(rawText)
    const match = text.match(/\bin\s+(.+?)\s+on\s+/i)
    return match ? match[1].trim() : ''
  }

  function normalizeReview(review, context) {
    const translated = compact(
      review?.review_lang?.translate_comment ||
      review?.review_lang?.translateComment ||
      review?.reviewLang?.translate_comment ||
      review?.reviewLang?.translateComment ||
      review?.translate_comment ||
      review?.translateComment ||
      review?.translated_comment ||
      review?.translatedComment,
    )
    const original = compact(review?.comment || review?.review_text || review?.content || review?.text)
    const timeText = compact(review?.concat_time_lang || review?.concatTimeLang || review?.time_text || review?.timeText || review?.date_text || review?.dateText)
    const ariaTime = compact(
      review?.concat_rich_text?.aria_label ||
      review?.concat_rich_text?.ariaLabel ||
      review?.concatRichText?.aria_label ||
      review?.concatRichText?.ariaLabel ||
      review?.aria_label ||
      review?.ariaLabel,
    )
    const goodsInfo = review?.goods_info || {}
    const goodsId = compact(review?.goods_id || review?.goodsId || goodsInfo.goods_id || goodsInfo.goodsId || context.goodsId)
    const productTitle = compact(context.productTitle || goodsInfo.goods_name || goodsInfo.goodsName || review?.goods_name || review?.goodsName)
    return {
      商品ID: goodsId,
      商品标题: productTitle,
      商品链接: context.productUrl,
      商品图片: normalizeUrl(context.productImage || goodsInfo.thumb_url || goodsInfo.thumbUrl || review?.thumb_url || review?.thumbUrl),
      评论页码: context.page,
      评论序号: context.index,
      评价ID: compact(review?.review_id || review?.reviewId || review?.id || review?.comment_id || review?.commentId),
      买家昵称: compact(review?.name || review?.user_name || review?.userName || review?.nickname),
      评分: review?.score ?? review?.rating ?? '',
      SKU_ID: compact(review?.sku_id || review?.skuId),
      规格: normalizeSpecs(review?.specs || review?.spec_list || review?.specList || review?.sku_info || review?.skuInfo),
      合身情况: compact(review?.goods_specific_review_level_info?.text || review?.goodsSpecificReviewLevelInfo?.text || review?.fit_text || review?.fitText || review?.overall_fit || review?.overallFit),
      评价内容: translated || original,
      评价原文: translated && original && translated !== original ? original : '',
      评价国家: parseCountry(ariaTime || timeText),
      评价时间: formatEpoch(review?.time_ms || review?.time) || compact(review?.review_time || review?.date),
      评价时间原文: ariaTime || timeText,
      评价图片: normalizeImageList(review?.pictures || review?.pic_list || review?.picList || review?.images || review?.list).join('\n'),
      头像: normalizeUrl(review?.avatar),
      数据来源: context.source,
      执行结果: '成功',
      备注: '',
    }
  }

  function reviewKey(row) {
    if (row.评价ID) return `${row.商品ID}|${row.评价ID}`
    return [row.商品ID, row.买家昵称, row.评价时间, row.规格, row.评价内容].map(compact).join('\u001f')
  }

  function dedupeRows(rows) {
    const seen = new Set()
    return rows.filter(row => {
      const key = reviewKey(row)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  function extractProductInfoFromInfoPayload(payload, goodsId) {
    const info = firstValue(payload, [
      ['data', 'goods_info'],
      ['result', 'goods_info'],
      ['goods_info'],
      ['data', 'goodsInfo'],
      ['result', 'goodsInfo'],
      ['goodsInfo'],
      ['data'],
      ['result'],
    ]) || {}
    return {
      goodsId,
      productTitle: compact(info.goods_name || info.goodsName || info.title || info.name || firstValue(payload, [['data', 'goods_name'], ['result', 'goods_name']])),
      productImage: normalizeUrl(info.thumb_url || info.image_url || info.img_url || info.goods_img || info.goodsImage),
      score: firstValue(payload, [['data', 'score'], ['result', 'score'], ['score']]),
      reviewCountText: compact(firstValue(payload, [['data', 'review_num_text'], ['result', 'review_num_text'], ['review_num_text']])),
      reviewCount: getTotalCount(payload),
    }
  }

  async function fetchProductInfo(goodsId) {
    const url = buildApiUrl('/info', {
      goods_id: goodsId,
      need_fill_goods_info: 'true',
    })
    const payload = await fetchJson(url)
    return extractProductInfoFromInfoPayload(payload, goodsId)
  }

  async function fetchOptionalProductInfo(goodsId) {
    try {
      return await fetchProductInfo(goodsId)
    } catch (error) {
      return {
        goodsId,
        productTitle: '',
        productImage: '',
        score: '',
        reviewCountText: '',
        reviewCount: 0,
        infoError: error?.message || String(error),
        infoBusy: !!error?.isBusy,
      }
    }
  }

  async function fetchReviewPage(goodsId, page, pageSize, sortType) {
    const url = buildApiUrl('/list', {
      goods_id: goodsId,
      page,
      size: pageSize,
      need_max_size: 'true',
      sort_type: sortType,
      goods_review_label_show: 'true',
    })
    return await fetchJson(url)
  }

  async function fetchSimilarReviewPage(goodsId, page, pageSize) {
    const url = buildApiUrl('/similar/list', {
      goods_id: goodsId,
      page,
      size: pageSize,
      need_max_size: 'true',
    })
    return await fetchJson(url)
  }

  function isSameGoodsRow(row, goodsId) {
    return compact(row.商品ID) === compact(goodsId)
  }

  function normalizeReviewItems(items, goodsId, info, options, page, source, baseIndex = 0) {
    return items.map((item, index) => normalizeReview(item, {
      goodsId,
      productTitle: info.productTitle,
      productImage: info.productImage,
      productUrl: options.productUrl,
      page,
      index: baseIndex + index + 1,
      source,
    })).filter(row => isSameGoodsRow(row, goodsId))
  }

  async function collectApiReviews(goodsId, options) {
    const info = await fetchOptionalProductInfo(goodsId)
    const rows = []
    let apiTotal = info.reviewCount || 0
    let observedPageSize = 0
    for (let page = 1; page <= options.maxPages; page += 1) {
      const payload = await fetchReviewPage(goodsId, page, options.pageSize, options.sortType)
      const items = extractReviewItems(payload)
      const total = getTotalCount(payload)
      if (total) apiTotal = total
      if (!items.length) break
      observedPageSize = Math.max(observedPageSize, items.length)
      rows.push(...normalizeReviewItems(items, goodsId, info, options, page, 'engels/reviews/list', rows.length))
      if (!hasMore(payload, items, page, options.pageSize, apiTotal, observedPageSize)) break
      await sleep(PAGE_DELAY_MS)
    }
    return {
      rows: dedupeRows(rows),
      info,
      apiTotal,
    }
  }

  async function collectSimilarApiReviews(goodsId, options) {
    const info = await fetchOptionalProductInfo(goodsId)
    const rows = []
    let apiTotal = 0
    let observedPageSize = 0
    for (let page = 1; page <= options.maxPages; page += 1) {
      const payload = await fetchSimilarReviewPage(goodsId, page, options.pageSize)
      const items = extractReviewItems(payload)
      const total = getTotalCount(payload)
      if (total) apiTotal = total
      if (!items.length) break
      observedPageSize = Math.max(observedPageSize, items.length)
      rows.push(...normalizeReviewItems(items, goodsId, info, options, page, 'engels/reviews/similar/list', rows.length))
      if (!hasMore(payload, items, page, options.pageSize, apiTotal, observedPageSize)) break
      await sleep(PAGE_DELAY_MS)
    }
    return {
      rows: dedupeRows(rows),
      info,
      apiTotal,
    }
  }

  function getVisibleCenter(el) {
    if (!el?.getBoundingClientRect) return null
    const rect = el.getBoundingClientRect()
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : {}
    if (!rect || rect.width <= 0 || rect.height <= 0) return null
    if (style.display === 'none' || style.visibility === 'hidden') return null
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  }

  function findAllReviewsTrigger() {
    const selectors = ['button,a,[role="button"],div,span']
    const candidates = []
    for (const selector of selectors) {
      for (const el of document.querySelectorAll?.(selector) || []) {
        const text = textOf(el)
        if (!/^see all reviews$/i.test(text) && !/\bsee all reviews\b/i.test(text)) continue
        try {
          el.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'instant' })
        } catch (error) {
          try {
            el.scrollIntoView?.()
          } catch (nestedError) {
            // Ignore scroll failures; visibility checks below still protect the click.
          }
        }
        const center = getVisibleCenter(el)
        if (!center) continue
        candidates.push({ el, center, area: center.width * center.height, text })
      }
    }
    candidates.sort((a, b) => a.area - b.area)
    return candidates[0] || null
  }

  function getDialogScrollerCenter() {
    const dialog = document.querySelector?.('[role="dialog"]')
    if (!dialog) return null
    const root = dialog
    const candidates = []
    for (const el of root.querySelectorAll?.('*') || []) {
      const center = getVisibleCenter(el)
      if (!center) continue
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : {}
      const overflowY = compact(style.overflowY)
      const scrollHeight = Number(el.scrollHeight || 0)
      const clientHeight = Number(el.clientHeight || 0)
      if (!/(auto|scroll)/i.test(overflowY) || scrollHeight <= clientHeight + 50) continue
      candidates.push({
        center,
        scrollable: scrollHeight - clientHeight,
        area: center.width * center.height,
      })
    }
    candidates.sort((a, b) => b.scrollable - a.scrollable || b.area - a.area)
    return candidates[0]?.center || null
  }

  function listApiMatcher() {
    return [{ url_contains: '/api/bg/engels/reviews/list', method: 'GET', status: 200 }]
  }

  function requestDialogClickCapture(goodsId, productUrl, options, productShared, errorMessage, busyRetryCount) {
    const target = findAllReviewsTrigger()
    if (!target) return null
    return {
      success: true,
      data: [],
      meta: {
        action: 'capture_click_requests',
        clicks: [{ x: target.center.x, y: target.center.y, delay_ms: 120 }],
        matches: listApiMatcher(),
        min_matches: 1,
        timeout_ms: 12000,
        settle_ms: 1000,
        include_response_body: true,
        strict: false,
        shared_key: 'dialog_click_capture',
        next_phase: 'parse_dialog_click_capture',
        sleep_ms: 300,
        shared: buildBusyShared({
          ...productShared,
          goods_id: goodsId,
          product_url: productUrl,
          busy_retry_count: busyRetryCount,
          api_busy_message: errorMessage,
          dialog_reviews: [],
          dialog_loaded_pages: [],
          dialog_api_total: 0,
          dialog_last_page_size: 0,
          dialog_click_capture: null,
          dialog_wheel_captures: null,
          page_size: options.pageSize,
          max_pages: options.maxPages,
          sort_type: options.sortType,
          pending_navigation: false,
        }),
      },
    }
  }

  function normalizeCaptureValues(value) {
    if (!value) return []
    if (Array.isArray(value)) return value.flatMap(item => normalizeCaptureValues(item))
    if (Array.isArray(value.matches)) return value.matches
    if (value.url || value.body) return [value]
    return []
  }

  function getCapturedListMatches(keys) {
    return keys.flatMap(key => normalizeCaptureValues(shared[key]))
  }

  function decodeCapturedBody(match) {
    const body = match?.body
    if (typeof body !== 'string' || !body) return null
    if (match?.base64Encoded && typeof atob === 'function') {
      try {
        return atob(body)
      } catch (error) {
        return body
      }
    }
    return body
  }

  function pageFromCapturedMatch(match, fallback) {
    try {
      const url = new URL(String(match?.responseUrl || match?.url || ''), location.href)
      return toNumber(url.searchParams.get('page'), fallback, 1, Number.MAX_SAFE_INTEGER)
    } catch (error) {
      return fallback
    }
  }

  function rawReviewKey(item) {
    const id = compact(item?.review_id || item?.reviewId || item?.id || item?.comment_id || item?.commentId)
    if (id) return id
    return [
      item?.goods_id || item?.goodsId,
      item?.sku_id || item?.skuId,
      item?.name,
      item?.time_ms || item?.time,
      item?.comment || item?.content,
    ].map(compact).join('\u001f')
  }

  function mergeDialogCaptureState(goodsId, captureKeys, options) {
    const existingItems = Array.isArray(shared.dialog_reviews) ? shared.dialog_reviews : []
    const existingPages = new Set((Array.isArray(shared.dialog_loaded_pages) ? shared.dialog_loaded_pages : []).map(page => Number(page)).filter(Boolean))
    const seenItems = new Set(existingItems.map(rawReviewKey).filter(Boolean))
    const items = [...existingItems]
    let apiTotal = toNumber(shared.dialog_api_total, 0, 0, Number.MAX_SAFE_INTEGER)
    let lastPageSize = toNumber(shared.dialog_last_page_size, 0, 0, Number.MAX_SAFE_INTEGER)
    let newestPage = 0
    let addedItems = 0
    let addedPages = 0

    for (const match of getCapturedListMatches(captureKeys)) {
      if (!String(match?.url || match?.responseUrl || '').includes('/api/bg/engels/reviews/list')) continue
      const payload = safeJsonParse(decodeCapturedBody(match))
      if (!payload || isBusyPayload(payload)) continue
      const page = pageFromCapturedMatch(match, existingPages.size + 1)
      const pageItems = extractReviewItems(payload).filter(item => compact(item?.goods_id || item?.goodsId || goodsId) === compact(goodsId))
      const total = getTotalCount(payload)
      if (total) apiTotal = Math.max(apiTotal, total)
      if (pageItems.length) {
        if (!existingPages.has(page)) addedPages += 1
        existingPages.add(page)
        newestPage = Math.max(newestPage, page)
        lastPageSize = pageItems.length
      }
      for (const item of pageItems) {
        const enriched = {
          ...item,
          __crawshrimp_dialog_page: page,
        }
        const key = rawReviewKey(enriched)
        if (key && seenItems.has(key)) continue
        if (key) seenItems.add(key)
        items.push(enriched)
        addedItems += 1
      }
    }

    return {
      items,
      loadedPages: [...existingPages].sort((a, b) => a - b),
      apiTotal,
      lastPageSize,
      newestPage,
      addedItems,
      addedPages,
      noProgressRounds: addedItems || addedPages ? 0 : toNumber(shared.dialog_no_progress_rounds, 0, 0, 100) + 1,
    }
  }

  function getPageInfo(goodsId) {
    return {
      goodsId,
      productTitle: compact(shared.product_title || document.querySelector?.('h1')?.textContent || document.title).replace(/\s*-\s*Temu.*$/i, ''),
      productImage: normalizeUrl(shared.product_image || document.querySelector?.('img[src*="kwcdn.com/product"]')?.getAttribute?.('src')),
      score: shared.product_score || '',
      reviewCountText: shared.review_count_text || '',
      reviewCount: toNumber(shared.dialog_api_total, 0, 0, Number.MAX_SAFE_INTEGER),
    }
  }

  function normalizeDialogRows(goodsId, dialogItems, info, options) {
    return dedupeRows(dialogItems.map((item, index) => normalizeReview(item, {
      goodsId,
      productTitle: info.productTitle,
      productImage: info.productImage,
      productUrl: options.productUrl,
      page: toNumber(item.__crawshrimp_dialog_page, Math.floor(index / options.pageSize) + 1, 1, Number.MAX_SAFE_INTEGER),
      index: index + 1,
      source: 'dialog-engels/reviews/list',
    })).filter(row => isSameGoodsRow(row, goodsId)))
  }

  function shouldContinueDialogCapture(state, options) {
    if (!state.items.length) return false
    if (state.noProgressRounds >= 2) return false
    if (state.loadedPages.length >= options.maxPages) return false
    if (state.apiTotal && state.items.length >= state.apiTotal) return false
    if (state.apiTotal && state.items.length < state.apiTotal) return true
    return state.lastPageSize >= options.pageSize
  }

  function requestDialogWheelCapture(state, options) {
    const center = getDialogScrollerCenter()
    if (!center) return null
    const wheels = Array.from({ length: 3 }, () => ({
      x: center.x,
      y: center.y,
      delta_y: 700,
      delay_ms: 700,
    }))
    return {
      success: true,
      data: [],
      meta: {
        action: 'capture_wheel_requests',
        wheels,
        matches: listApiMatcher(),
        min_matches: 1,
        timeout_ms: 12000,
        settle_ms: 1000,
        include_response_body: true,
        strict: false,
        shared_key: 'dialog_wheel_captures',
        shared_append: true,
        next_phase: 'parse_dialog_wheel_capture',
        sleep_ms: 300,
        shared: {
          ...shared,
          dialog_reviews: state.items,
          dialog_loaded_pages: state.loadedPages,
          dialog_api_total: state.apiTotal,
          dialog_last_page_size: state.lastPageSize,
          dialog_no_progress_rounds: state.noProgressRounds,
        },
      },
    }
  }

  function requestOpenDialogWheelCapture(goodsId, productUrl, options, productShared, errorMessage, busyRetryCount) {
    const initialState = {
      items: Array.isArray(shared.dialog_reviews) ? shared.dialog_reviews : [],
      loadedPages: Array.isArray(shared.dialog_loaded_pages) ? shared.dialog_loaded_pages : [],
      apiTotal: toNumber(shared.dialog_api_total, 0, 0, Number.MAX_SAFE_INTEGER),
      lastPageSize: toNumber(shared.dialog_last_page_size, 0, 0, Number.MAX_SAFE_INTEGER),
      noProgressRounds: toNumber(shared.dialog_no_progress_rounds, 0, 0, 100),
    }
    const request = requestDialogWheelCapture(initialState, options)
    if (!request) return null
    request.meta.shared = buildBusyShared({
      ...request.meta.shared,
      ...productShared,
      goods_id: goodsId,
      product_url: productUrl,
      busy_retry_count: busyRetryCount,
      api_busy_message: errorMessage,
      page_size: options.pageSize,
      max_pages: options.maxPages,
      sort_type: options.sortType,
      dialog_no_progress_rounds: 0,
      pending_navigation: false,
    })
    return request
  }

  function completeDialogCapture(goodsId, productUrl, options, productShared, hasNextProduct, productIndex, state) {
    const info = getPageInfo(goodsId)
    const rows = normalizeDialogRows(goodsId, state.items, info, options)
    return complete(rows, buildBusyShared({
      ...productShared,
      goods_id: goodsId,
      product_url: productUrl,
      total_reviews: rows.length,
      api_total_reviews: state.apiTotal || rows.length,
      product_title: info.productTitle,
      product_score: info.score,
      review_count_text: info.reviewCountText,
      page_size: options.pageSize,
      max_pages: options.maxPages,
      sort_type: options.sortType,
      api_fallback: rows.length ? 'dialog-engels/reviews/list' : 'none',
      dialog_loaded_pages: state.loadedPages,
      dialog_api_total: state.apiTotal,
      dialog_no_progress_rounds: state.noProgressRounds,
      product_index: hasNextProduct ? productIndex + 1 : productIndex,
      pending_navigation: false,
    }), {
      hasMore: hasNextProduct,
      sleepMs: hasNextProduct ? 1200 : 0,
    })
  }

  function getEmbeddedReviewItems() {
    const store = window.rawData?.store || window.__INITIAL_PROPS__?.store || {}
    const reviewStore = store.reviewStore || store.review_store || {}
    const candidates = []

    if (Array.isArray(reviewStore.commentList)) candidates.push(reviewStore.commentList)
    if (Array.isArray(reviewStore.comment_list)) candidates.push(reviewStore.comment_list)

    for (const mapKey of ['pageReviewListMap', 'initPageReviewListMap', 'page_review_list_map', 'init_page_review_list_map']) {
      const value = reviewStore[mapKey]
      if (!value || typeof value !== 'object') continue
      for (const list of Object.values(value)) {
        if (Array.isArray(list)) candidates.push(list)
      }
    }

    const seen = new Set()
    const items = []
    for (const list of candidates) {
      for (const item of list) {
        if (!item || typeof item !== 'object') continue
        const id = compact(item.review_id || item.reviewId || item.id || item.comment_id || item.commentId)
        const key = id || JSON.stringify([
          item.goods_id || item.goodsId,
          item.sku_id || item.skuId,
          item.name,
          item.time_ms || item.time,
          item.comment,
        ])
        if (seen.has(key)) continue
        seen.add(key)
        items.push(item)
      }
    }
    return items
  }

  function collectEmbeddedReviews(goodsId, options) {
    const info = {
      productTitle: compact(document.querySelector?.('h1')?.textContent || document.title).replace(/\s*-\s*Temu.*$/i, ''),
      productImage: normalizeUrl(document.querySelector?.('img[src*="kwcdn.com/product"]')?.getAttribute?.('src')),
    }
    const items = getEmbeddedReviewItems()
    const rows = normalizeReviewItems(items, goodsId, info, options, 1, 'page-embedded-review-state')
    return {
      rows: dedupeRows(rows),
      info,
      apiTotal: rows.length,
    }
  }

  function textOf(el) {
    return compact(el?.innerText || el?.textContent)
  }

  function getDomReviewCards() {
    const selectors = ['div._9WTBQrvq', '._9WTBQrvq', '[class*="_9WTBQrvq"]']
    for (const selector of selectors) {
      const cards = [...(document.querySelectorAll ? document.querySelectorAll(selector) : [])]
      if (cards.length) return cards
    }
    return []
  }

  function getDialogDomReviewCards() {
    const selectors = [
      '[role="dialog"] ._9WTBQrvq,[role="dialog"] [class*="_9WTBQrvq"]',
      '[role="dialog"] div._9WTBQrvq',
      '[role="dialog"] ._9WTBQrvq',
    ]
    for (const selector of selectors) {
      const cards = [...(document.querySelectorAll ? document.querySelectorAll(selector) : [])]
      if (cards.length) return cards
    }
    const dialog = document.querySelector?.('[role="dialog"]')
    if (!dialog) return []
    return [...(dialog.querySelectorAll?.('div._9WTBQrvq,._9WTBQrvq,[class*="_9WTBQrvq"]') || [])]
  }

  function getVisibleReviewTotal() {
    const sources = [
      textOf(document.querySelector?.('[role="dialog"]')),
      textOf(document.body),
    ].filter(Boolean)
    for (const text of sources) {
      const match = text.match(/([0-9][0-9,.]*)\s+reviews\b/i)
      if (!match) continue
      const value = Number(String(match[1]).replace(/[,.]/g, ''))
      if (Number.isFinite(value) && value > 0) return value
    }
    const store = window.rawData?.store || window.__INITIAL_PROPS__?.store || {}
    const reviewStore = store.reviewStore || store.review_store || {}
    return toNumber(reviewStore.reviewNum || reviewStore.review_num, 0, 0, Number.MAX_SAFE_INTEGER)
  }

  function extractDomRating(card) {
    const starEl = card.querySelector?.('._21WXPU_9,[aria-label*="stars"],[aria-label*="out of five"]')
    const text = [
      starEl?.getAttribute?.('aria-label'),
      ...[...(starEl?.querySelectorAll?.('[aria-label]') || [])].map(el => el.getAttribute?.('aria-label')),
      textOf(starEl),
    ].map(compact).find(item => /stars|out of five/i.test(item)) || ''
    const match = text.match(/([0-9]+(?:[.,][0-9]+)?)/)
    return match ? match[1].replace(',', '.') : ''
  }

  function firstDomText(card, selectors) {
    for (const selector of selectors) {
      const text = textOf(card.querySelector?.(selector))
      if (text) return text
    }
    return ''
  }

  function cleanDomPrefix(text, pattern) {
    return compact(text).replace(pattern, '').trim()
  }

  function extractDomReviewImages(card) {
    return [...(card.querySelectorAll?.('img') || [])]
      .map(img => ({
        alt: compact(img.getAttribute?.('alt')),
        src: normalizeUrl(img.getAttribute?.('src')),
        className: compact(img.className),
      }))
      .filter(img => /review/i.test(img.alt) || /rewimg/i.test(img.src) || /_17EhhWj_/.test(img.className))
      .map(img => img.src)
      .filter(Boolean)
      .join('\n')
  }

  function extractDomAvatar(card) {
    return normalizeUrl(card.querySelector?.('[aria-label="avatar"] img, img[alt="avatar"]')?.getAttribute?.('src'))
  }

  function extractDomOriginalText(card) {
    const text = firstDomText(card, ['.tbAzrtq-', '._2uEYFs0B'])
    return cleanDomPrefix(text, /^Review before translation:\s*/i)
  }

  function extractDomHelpfulCount(card) {
    const candidates = [
      ...[...(card.querySelectorAll?.('[aria-label]') || [])].map(el => compact(el.getAttribute?.('aria-label'))),
      ...[...(card.querySelectorAll?.('*') || [])].map(textOf),
      textOf(card),
    ].filter(Boolean)
    for (const text of candidates) {
      if (!/helpful|approve/i.test(text)) continue
      const match = text.match(/([0-9][0-9,.]*)\s*(?:people|person)/i)
      if (match) return match[1].replace(/,/g, '')
      if (/Helpful\s+Report/i.test(text)) return '0'
    }
    return ''
  }

  function extractDomPurchaseTimes(card) {
    const match = textOf(card).match(/Purchased\s+([0-9][0-9,.]*)\s+times/i)
    return match ? match[1].replace(/,/g, '') : ''
  }

  function extractDomMeta(card) {
    const meta = card.querySelector?.('._3OHJMKy5') || card.children?.[0] || null
    const ariaCandidates = [
      meta?.getAttribute?.('aria-label'),
      ...[...(meta?.querySelectorAll?.('[aria-label]') || [])].map(el => el.getAttribute?.('aria-label')),
    ].map(compact).filter(Boolean)
    const aria = ariaCandidates.find(item => parseCountry(item)) || ariaCandidates[0] || ''
    const visibleText = textOf(meta)
    const name = compact(visibleText.replace(/\s+in\s+.*$/i, '').replace(/\s+on\s+.*$/i, ''))
    const timeSource = aria || visibleText
    const country = parseCountry(timeSource)
    const dateMatch = timeSource.match(/\bon\s+(.+)$/i)
    return {
      name,
      country,
      timeRaw: timeSource,
      timeText: dateMatch ? dateMatch[1].trim() : '',
    }
  }

  function extractDomReviewText(card) {
    const direct = card.querySelector?.('._2Zm74do1, .N4fQ1-w3, ._2EO0yd2j')
    if (direct && textOf(direct)) return textOf(direct)
    const blocks = [...(card.children || [])].map(el => textOf(el)).filter(Boolean)
    return blocks.find(text =>
      !/^Purchased:/i.test(text) &&
      !/^Overall fit:/i.test(text) &&
      !/^Share\b|^Helpful\b|^Report\b/i.test(text) &&
      !/\bin\s+.*\bon\s+/i.test(text) &&
      text.length > 5
    ) || ''
  }

  function collectDomReviews(goodsId, productUrl) {
    const cards = getDomReviewCards()
    return collectDomReviewCards(cards, goodsId, productUrl, 'dom-visible-cards', '本商品评论接口繁忙，已导出当前页面可见评论')
  }

  function collectDomReviewCards(cards, goodsId, productUrl, source, note, options = {}) {
    const rows = []
    for (const [index, card] of cards.entries()) {
      if (/This review is for:|Reviews from similar items/i.test(textOf(card))) continue
      const content = extractDomReviewText(card)
      const meta = extractDomMeta(card)
      const specs = cleanDomPrefix(firstDomText(card, ['._2Y-spytg', '._2QI6iM-X']), /^Purchased:\s*/i)
      const fitText = cleanDomPrefix(firstDomText(card, ['._35Cqvk-G']), /^Overall fit:\s*/i)
      if (!content && !meta.name) continue
      rows.push({
        商品ID: goodsId,
        商品标题: '',
        商品链接: productUrl,
        商品图片: '',
        评论页码: 1,
        评论序号: index + 1,
        评价ID: '',
        买家昵称: meta.name,
        评分: extractDomRating(card),
        SKU_ID: '',
        规格: specs,
        合身情况: fitText,
        评价内容: content,
        评价原文: extractDomOriginalText(card),
        评价国家: meta.country,
        评价时间: '',
        评价时间原文: meta.timeRaw || meta.timeText,
        评价图片: extractDomReviewImages(card),
        头像: extractDomAvatar(card),
        有帮助人数: extractDomHelpfulCount(card),
        购买次数: extractDomPurchaseTimes(card),
        数据来源: source,
        执行结果: '成功',
        备注: note,
      })
    }
    return options.dedupe === false ? rows : dedupeRows(rows)
  }

  function collectLoadedDialogDomReviews(goodsId, productUrl) {
    const cards = getDialogDomReviewCards()
    return collectDomReviewCards(
      cards,
      goodsId,
      productUrl,
      'dialog-dom-loaded-cards',
      '本商品评论接口繁忙，已导出弹层已加载评论卡片',
      { dedupe: false },
    )
  }

  function buildBusyShared(next = {}) {
    return {
      ...shared,
      ...next,
      api_busy: true,
      api_busy_message: next.api_busy_message || shared.api_busy_message || 'Temu 评论接口返回 System busy',
    }
  }

  try {
    const allowedPhases = new Set(['main', 'parse_dialog_click_capture', 'parse_dialog_wheel_capture'])
    if (!allowedPhases.has(phase)) return fail(`未知 phase: ${phase}`)

    const productInputs = getProductInputs()
    const productIndex = getProductIndex(productInputs)
    const productInput = productInputs[productIndex] || getProductInput()
    const hasNextProduct = productIndex + 1 < productInputs.length
    const productShared = {
      product_urls: productInputs,
      product_index: productIndex,
      total_products: productInputs.length,
    }
    const goodsId = getGoodsId()
    if (!goodsId) return fail('请填写有效的 Temu 商品链接，或在 Temu 商品详情页运行当前页面模式')

    const productUrl = productInput || location.href
    const currentGoodsId = getCurrentGoodsId()
    if (productUrl && currentGoodsId && currentGoodsId !== goodsId) {
      location.href = productUrl
      return nextPhase('main', 1800, {
        ...shared,
        ...productShared,
        goods_id: goodsId,
        product_url: productUrl,
        pending_navigation: true,
      })
    }
    if (productUrl && !currentGoodsId && parseGoodsId(productUrl)) {
      location.href = productUrl
      return nextPhase('main', 1800, {
        ...shared,
        ...productShared,
        goods_id: goodsId,
        product_url: productUrl,
        pending_navigation: true,
      })
    }

    const pageSize = toNumber(params.page_size, DEFAULT_PAGE_SIZE, 1, 20)
    const maxPages = toNumber(params.max_pages, DEFAULT_MAX_PAGES, 1, 100)
    const sortType = toNumber(params.sort_type, 0, 0, 10)
    const maxBusyRetries = toNumber(params.max_busy_retries, DEFAULT_BUSY_RETRIES, 0, 10)
    const busyRetryCount = Number(shared.busy_retry_count || 0)
    const collectOptions = {
      productUrl,
      pageSize,
      maxPages,
      sortType,
    }

    if (phase === 'parse_dialog_click_capture' || phase === 'parse_dialog_wheel_capture') {
      const state = mergeDialogCaptureState(goodsId, phase === 'parse_dialog_click_capture'
        ? ['dialog_click_capture']
        : ['dialog_wheel_captures'], collectOptions)
      if (shouldContinueDialogCapture(state, collectOptions)) {
        const wheelRequest = requestDialogWheelCapture(state, collectOptions)
        if (wheelRequest) return wheelRequest
      }
      if (state.items.length) {
        return completeDialogCapture(goodsId, productUrl, collectOptions, productShared, hasNextProduct, productIndex, state)
      }
      const dialogDomRows = collectLoadedDialogDomReviews(goodsId, productUrl)
      if (dialogDomRows.length) {
        return complete(dialogDomRows, buildBusyShared({
          ...productShared,
          goods_id: goodsId,
          product_url: productUrl,
          busy_retry_count: busyRetryCount,
          total_reviews: dialogDomRows.length,
          api_total_reviews: getVisibleReviewTotal() || dialogDomRows.length,
          api_fallback: 'dialog-dom-loaded-cards',
          product_index: hasNextProduct ? productIndex + 1 : productIndex,
          pending_navigation: false,
        }), {
          hasMore: hasNextProduct,
          sleepMs: hasNextProduct ? 1200 : 0,
        })
      }
      const embeddedCollected = collectEmbeddedReviews(goodsId, collectOptions)
      if (embeddedCollected.rows.length) {
        return complete(embeddedCollected.rows, buildBusyShared({
          ...productShared,
          goods_id: goodsId,
          product_url: productUrl,
          busy_retry_count: busyRetryCount,
          total_reviews: embeddedCollected.rows.length,
          api_total_reviews: embeddedCollected.apiTotal || embeddedCollected.rows.length,
          product_title: embeddedCollected.info.productTitle,
          api_fallback: 'page-embedded-review-state',
          product_index: hasNextProduct ? productIndex + 1 : productIndex,
          pending_navigation: false,
        }), {
          hasMore: hasNextProduct,
          sleepMs: hasNextProduct ? 1200 : 0,
        })
      }
      const fallbackRows = collectDomReviews(goodsId, productUrl)
      return complete(fallbackRows, buildBusyShared({
        ...productShared,
        goods_id: goodsId,
        product_url: productUrl,
        busy_retry_count: busyRetryCount,
        total_reviews: fallbackRows.length,
        api_fallback: fallbackRows.length ? 'dom-visible-cards' : 'none',
        product_index: hasNextProduct ? productIndex + 1 : productIndex,
        pending_navigation: false,
      }), {
        hasMore: hasNextProduct,
        sleepMs: hasNextProduct ? 1200 : 0,
      })
    }

    try {
      const collected = await collectApiReviews(goodsId, collectOptions)
      return complete(collected.rows, {
        ...shared,
        ...productShared,
        goods_id: goodsId,
        product_url: productUrl,
        total_reviews: collected.rows.length,
        api_total_reviews: collected.apiTotal || collected.rows.length,
        product_title: collected.info.productTitle,
        product_score: collected.info.score,
        review_count_text: collected.info.reviewCountText,
        page_size: pageSize,
        max_pages: maxPages,
        sort_type: sortType,
        busy_retry_count: 0,
        api_busy: false,
        api_busy_message: '',
        product_index: hasNextProduct ? productIndex + 1 : productIndex,
        pending_navigation: false,
      }, {
        hasMore: hasNextProduct,
        sleepMs: hasNextProduct ? 1200 : 0,
      })
    } catch (error) {
      if (error?.isBusy) {
        if (busyRetryCount < maxBusyRetries) {
          return nextPhase('main', BUSY_RETRY_MS, buildBusyShared({
            ...productShared,
            goods_id: goodsId,
            product_url: productUrl,
            busy_retry_count: busyRetryCount + 1,
            api_busy_message: error.message,
          }))
        }
        const openDialogWheelRequest = requestOpenDialogWheelCapture(
          goodsId,
          productUrl,
          collectOptions,
          productShared,
          error.message,
          busyRetryCount,
        )
        if (openDialogWheelRequest) return openDialogWheelRequest
        const dialogRequest = requestDialogClickCapture(
          goodsId,
          productUrl,
          collectOptions,
          productShared,
          error.message,
          busyRetryCount,
        )
        if (dialogRequest) return dialogRequest
        const dialogDomRows = collectLoadedDialogDomReviews(goodsId, productUrl)
        if (dialogDomRows.length) {
          return complete(dialogDomRows, buildBusyShared({
            ...productShared,
            goods_id: goodsId,
            product_url: productUrl,
            busy_retry_count: busyRetryCount,
            total_reviews: dialogDomRows.length,
            api_total_reviews: getVisibleReviewTotal() || dialogDomRows.length,
            api_busy_message: error.message,
            api_fallback: 'dialog-dom-loaded-cards',
            product_index: hasNextProduct ? productIndex + 1 : productIndex,
            pending_navigation: false,
          }), {
            hasMore: hasNextProduct,
            sleepMs: hasNextProduct ? 1200 : 0,
          })
        }
        try {
          const similarCollected = await collectSimilarApiReviews(goodsId, collectOptions)
          if (similarCollected.rows.length) {
            return complete(similarCollected.rows, {
              ...shared,
              ...productShared,
              goods_id: goodsId,
              product_url: productUrl,
              total_reviews: similarCollected.rows.length,
              api_total_reviews: similarCollected.apiTotal || similarCollected.rows.length,
              product_title: similarCollected.info.productTitle,
              product_score: similarCollected.info.score,
              review_count_text: similarCollected.info.reviewCountText,
              page_size: pageSize,
              max_pages: maxPages,
              sort_type: sortType,
              busy_retry_count: busyRetryCount,
              api_busy: false,
              api_busy_message: '',
              api_fallback: 'engels/reviews/similar/list',
              product_index: hasNextProduct ? productIndex + 1 : productIndex,
              pending_navigation: false,
            }, {
              hasMore: hasNextProduct,
              sleepMs: hasNextProduct ? 1200 : 0,
            })
          }
        } catch (similarError) {
          // Fall through to page-state / DOM fallbacks when the available API surfaces are also busy.
        }
        const embeddedCollected = collectEmbeddedReviews(goodsId, {
          productUrl,
          pageSize,
          maxPages,
          sortType,
        })
        if (embeddedCollected.rows.length) {
          return complete(embeddedCollected.rows, buildBusyShared({
            ...productShared,
            goods_id: goodsId,
            product_url: productUrl,
            busy_retry_count: busyRetryCount,
            total_reviews: embeddedCollected.rows.length,
            api_total_reviews: embeddedCollected.apiTotal || embeddedCollected.rows.length,
            product_title: embeddedCollected.info.productTitle,
            api_busy_message: error.message,
            api_fallback: 'page-embedded-review-state',
            product_index: hasNextProduct ? productIndex + 1 : productIndex,
            pending_navigation: false,
          }), {
            hasMore: hasNextProduct,
            sleepMs: hasNextProduct ? 1200 : 0,
          })
        }
        const fallbackRows = collectDomReviews(goodsId, productUrl)
        return complete(fallbackRows, buildBusyShared({
          ...productShared,
          goods_id: goodsId,
          product_url: productUrl,
          busy_retry_count: busyRetryCount,
          total_reviews: fallbackRows.length,
          api_busy_message: error.message,
          api_fallback: fallbackRows.length ? 'dom-visible-cards' : 'none',
          product_index: hasNextProduct ? productIndex + 1 : productIndex,
          pending_navigation: false,
        }), {
          hasMore: hasNextProduct,
          sleepMs: hasNextProduct ? 1200 : 0,
        })
      }
      throw error
    }
  } catch (error) {
    return fail(buildDiagnosticError(error))
  }
})()
