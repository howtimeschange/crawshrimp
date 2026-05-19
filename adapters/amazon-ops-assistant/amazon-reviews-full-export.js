;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const DEFAULT_MAX_PAGES_PER_ASIN = 500
  const AMAZON_PUBLIC_REVIEW_PAGE_LIMIT = 10
  const DEFAULT_PAGE_DELAY_MS = 4200
  const DEFAULT_CLICK_MIN_DELAY_MS = 4200
  const DEFAULT_CLICK_MAX_DELAY_MS = 8800
  const DEFAULT_ITEM_MIN_DELAY_MS = 18000
  const DEFAULT_ITEM_MAX_DELAY_MS = 42000
  const DEFAULT_DIMENSION_MIN_DELAY_MS = 9000
  const DEFAULT_DIMENSION_MAX_DELAY_MS = 22000
  const REVIEW_SORTS = Object.freeze([
    Object.freeze({ id: 'recent', label: '最新', sortBy: 'recent' }),
    Object.freeze({ id: 'helpful', label: '最有帮助', sortBy: 'helpful' }),
  ])
  const REVIEW_MEDIA_SCOPES = Object.freeze([
    Object.freeze({ id: 'all_media', label: '全部媒体', mediaType: '' }),
    Object.freeze({ id: 'media_reviews_only', label: '图视频评价', mediaType: 'media_reviews_only' }),
  ])
  const REVIEW_SCOPES = Object.freeze([
    Object.freeze({ id: 'all', label: '全部评论', filterByStar: '' }),
    Object.freeze({ id: 'five_star', label: '5星', filterByStar: 'five_star' }),
    Object.freeze({ id: 'four_star', label: '4星', filterByStar: 'four_star' }),
    Object.freeze({ id: 'three_star', label: '3星', filterByStar: 'three_star' }),
    Object.freeze({ id: 'two_star', label: '2星', filterByStar: 'two_star' }),
    Object.freeze({ id: 'one_star', label: '1星', filterByStar: 'one_star' }),
  ])
  const FETCH_MODE_QUICK_100 = 'quick_100'
  const FETCH_MODE_FULL = 'full'
  const QUICK_REVIEW_LIMIT = 100

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function textOf(node) {
    return compact(node?.innerText || node?.textContent || '')
  }

  function attr(node, name) {
    if (!node || typeof node.getAttribute !== 'function') return ''
    return compact(node.getAttribute(name))
  }

  function queryAll(root, selector) {
    try {
      return root?.querySelectorAll ? [...root.querySelectorAll(selector)] : []
    } catch (error) {
      return []
    }
  }

  function query(root, selector) {
    try {
      return root?.querySelector ? root.querySelector(selector) : null
    } catch (error) {
      return null
    }
  }

  function firstNode(root, selectors) {
    for (const selector of selectors) {
      const node = query(root, selector)
      if (node) return node
    }
    return null
  }

  function firstText(root, selectors) {
    return textOf(firstNode(root, selectors))
  }

  function firstAttr(root, selectors, name) {
    for (const selector of selectors) {
      const value = attr(query(root, selector), name)
      if (value) return value
    }
    return ''
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  function randomInt(min, max) {
    const low = Math.ceil(Number(min) || 0)
    const high = Math.floor(Number(max) || low)
    if (high <= low) return low
    return low + Math.floor(Math.random() * (high - low + 1))
  }

  async function sleepRandom(minMs, maxMs) {
    await sleep(randomInt(minMs, maxMs))
  }

  function toInt(value, fallback, min, max) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    const integer = Math.floor(parsed)
    if (Number.isFinite(min) && integer < min) return min
    if (Number.isFinite(max) && integer > max) return max
    return integer
  }

  function getDelayRange(minParam, maxParam, defaultMin, defaultMax) {
    const minValue = toInt(params[minParam], defaultMin, 0, 10 * 60 * 1000)
    const maxValue = toInt(params[maxParam], defaultMax, 0, 10 * 60 * 1000)
    return {
      min: Math.min(minValue, maxValue),
      max: Math.max(minValue, maxValue),
    }
  }

  function randomDelayFromParams(minParam, maxParam, defaultMin, defaultMax) {
    const range = getDelayRange(minParam, maxParam, defaultMin, defaultMax)
    return randomInt(range.min, range.max)
  }

  function pageDelayMs() {
    return randomDelayFromParams('page_min_delay_ms', 'page_max_delay_ms', DEFAULT_PAGE_DELAY_MS, DEFAULT_PAGE_DELAY_MS + 2800)
  }

  function clickDelayMs() {
    return randomDelayFromParams('click_min_delay_ms', 'click_max_delay_ms', DEFAULT_CLICK_MIN_DELAY_MS, DEFAULT_CLICK_MAX_DELAY_MS)
  }

  function itemDelayMs() {
    return randomDelayFromParams('item_min_delay_ms', 'item_max_delay_ms', DEFAULT_ITEM_MIN_DELAY_MS, DEFAULT_ITEM_MAX_DELAY_MS)
  }

  function dimensionDelayMs() {
    return randomDelayFromParams('dimension_min_delay_ms', 'dimension_max_delay_ms', DEFAULT_DIMENSION_MIN_DELAY_MS, DEFAULT_DIMENSION_MAX_DELAY_MS)
  }

  function isoNow() {
    try {
      return new Date().toISOString()
    } catch (error) {
      return ''
    }
  }

  function splitInputText(value) {
    const text = String(value || '').trim()
    if (!text) return []
    const urlMatches = text.match(/(?:https?:\/\/|\/\/)?(?:www\.)?amazon\.[^\s，,；;\n\r\t]+/gi)
    if (urlMatches?.length) {
      return urlMatches.map(item => item.replace(/^[、，,;；]+|[、，,;；]+$/g, '').trim()).filter(Boolean)
    }
    return text.split(/[\n\r\t 、，,;；]+/).map(item => item.trim()).filter(Boolean)
  }

  function normalizeFetchMode(value) {
    const mode = compact(value || params.fetch_mode || params.mode || FETCH_MODE_QUICK_100).toLowerCase()
    if (['full', 'all', 'all_reviews', 'full_export', '全量', 'full_all'].includes(mode)) return FETCH_MODE_FULL
    return FETCH_MODE_QUICK_100
  }

  function isQuickMode(state = shared) {
    return normalizeFetchMode(state?.fetch_mode || params.fetch_mode) === FETCH_MODE_QUICK_100
  }

  function effectiveReviewTargetCount(rawExpected, state = shared) {
    const expected = toInt(rawExpected, 0, 0)
    if (!isQuickMode(state)) return expected
    if (expected > 0) return Math.min(expected, QUICK_REVIEW_LIMIT)
    return QUICK_REVIEW_LIMIT
  }

  function getDimensionTotal(state = shared) {
    return isQuickMode(state) ? 1 : REVIEW_SORTS.length * REVIEW_MEDIA_SCOPES.length * REVIEW_SCOPES.length
  }

  function parseUrl(raw) {
    let text = compact(raw).replace(/[、，,;；]+$/g, '')
    if (!text) return null
    if (text.startsWith('//')) text = `https:${text}`
    if (!/^https?:\/\//i.test(text)) text = `https://${text}`
    try {
      return new URL(text)
    } catch (error) {
      return null
    }
  }

  function extractAsinFromUrl(raw) {
    const text = compact(raw)
    const match =
      text.match(/\/(?:dp|gp\/product|product-reviews)\/([A-Z0-9]{10})(?:[/?#]|$)/i) ||
      text.match(/[?&](?:asin|ASIN)=([A-Z0-9]{10})(?:[&#]|$)/)
    return match ? match[1].toUpperCase() : ''
  }

  function amazonOriginFor(url) {
    const host = compact(url?.host || '')
    if (/^amazon\.com$/i.test(host)) return 'https://www.amazon.com'
    if (/amazon\./i.test(host)) return `${url.protocol || 'https:'}//${host}`
    return 'https://www.amazon.com'
  }

  function buildReviewUrls(raw) {
    const url = parseUrl(raw)
    const asin = extractAsinFromUrl(raw)
    if (!url || !asin || !/amazon\./i.test(url.host)) return null
    const origin = amazonOriginFor(url)
    return {
      asin,
      originalUrl: compact(raw),
      productUrl: `${origin}/dp/${asin}`,
      reviewsUrl: `${origin}/product-reviews/${asin}?sortBy=recent`,
    }
  }

  function buildInputQueue(value) {
    const rawItems = [
      ...splitInputText(value),
      ...splitInputText(params.review_urls),
      ...splitInputText(params.product_urls),
      ...splitInputText(params.item_links),
      ...splitInputText(params.links),
    ]
    if (!rawItems.length) rawItems.push(String(location.href || ''))

    const seen = new Set()
    const queue = []
    for (const raw of rawItems) {
      const item = buildReviewUrls(raw)
      if (!item || seen.has(item.asin)) continue
      seen.add(item.asin)
      queue.push(item)
    }
    return queue
  }

  function makeAbsoluteAmazonUrl(raw, fallbackUrl) {
    const text = compact(raw)
    if (!text) return ''
    try {
      return new URL(text, fallbackUrl || location.href || 'https://www.amazon.com/').href
    } catch (error) {
      return ''
    }
  }

  function normalizeReviewPageUrl(raw) {
    const url = parseUrl(raw)
    if (!url) return ''
    const asin = extractAsinFromUrl(url.href)
    if (!asin) return url.href
    const normalized = new URL(`${amazonOriginFor(url)}/product-reviews/${asin}`)
    const pageNumber = compact(url.searchParams.get('pageNumber'))
    if (pageNumber) normalized.searchParams.set('pageNumber', pageNumber)
    const sortBy = compact(url.searchParams.get('sortBy')) || 'recent'
    normalized.searchParams.set('sortBy', sortBy)
    for (const key of ['filterByStar', 'reviewerType', 'formatType', 'mediaType']) {
      const value = compact(url.searchParams.get(key))
      if (value) normalized.searchParams.set(key, value)
    }
    return normalized.href
  }

  function sameReviewTarget(current, target) {
    const currentUrl = parseUrl(current)
    const targetUrl = parseUrl(target)
    if (!currentUrl || !targetUrl) return false
    const currentAsin = extractAsinFromUrl(currentUrl.href)
    const targetAsin = extractAsinFromUrl(targetUrl.href)
    if (!currentAsin || currentAsin !== targetAsin) return false
    if (!/\/product-reviews\//i.test(currentUrl.pathname)) return false
    const currentPage = compact(currentUrl.searchParams.get('pageNumber') || '1')
    const targetPage = compact(targetUrl.searchParams.get('pageNumber') || '1')
    const currentFilter = compact(currentUrl.searchParams.get('filterByStar'))
    const targetFilter = compact(targetUrl.searchParams.get('filterByStar'))
    const currentSort = compact(currentUrl.searchParams.get('sortBy')) || 'recent'
    const targetSort = compact(targetUrl.searchParams.get('sortBy')) || 'recent'
    const currentMedia = compact(currentUrl.searchParams.get('mediaType'))
    const targetMedia = compact(targetUrl.searchParams.get('mediaType'))
    return currentPage === targetPage && currentFilter === targetFilter && currentSort === targetSort && currentMedia === targetMedia
  }

  function nextPhase(name, sleepMs = DEFAULT_PAGE_DELAY_MS, nextShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'next_phase',
        next_phase: name,
        sleep_ms: sleepMs,
        shared: nextShared,
      },
    }
  }

  function complete(data = [], hasMore = false, nextShared = shared, extraMeta = {}) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: hasMore,
        shared: nextShared,
        ...extraMeta,
      },
    }
  }

  function abortTask(message, nextShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'abort',
        reason: compact(message) || '任务已停止',
        shared: nextShared,
      },
    }
  }

  function fail(message) {
    return {
      success: false,
      error: compact(message) || 'Amazon reviews 全量抓取失败',
    }
  }

  function getCurrentItem(state = shared) {
    const queue = Array.isArray(state.queue) ? state.queue : []
    const index = toInt(state.current_index, 0, 0, queue.length)
    return queue[index] || null
  }

  function getCurrentScope(state = shared) {
    const index = toInt(state.current_scope_index, 0, 0, REVIEW_SCOPES.length - 1)
    return REVIEW_SCOPES[index] || REVIEW_SCOPES[0]
  }

  function getCurrentSort(state = shared) {
    const index = toInt(state.current_sort_index, 0, 0, REVIEW_SORTS.length - 1)
    return REVIEW_SORTS[index] || REVIEW_SORTS[0]
  }

  function getCurrentMediaScope(state = shared) {
    const index = toInt(state.current_media_index, 0, 0, REVIEW_MEDIA_SCOPES.length - 1)
    return REVIEW_MEDIA_SCOPES[index] || REVIEW_MEDIA_SCOPES[0]
  }

  function getNextReviewDimension(sortIndex, mediaIndex, scopeIndex) {
    const safeSortIndex = toInt(sortIndex, 0, 0, REVIEW_SORTS.length - 1)
    const safeMediaIndex = toInt(mediaIndex, 0, 0, REVIEW_MEDIA_SCOPES.length - 1)
    const safeScopeIndex = toInt(scopeIndex, 0, 0, REVIEW_SCOPES.length - 1)
    if (safeScopeIndex + 1 < REVIEW_SCOPES.length) {
      return { sortIndex: safeSortIndex, mediaIndex: safeMediaIndex, scopeIndex: safeScopeIndex + 1 }
    }
    if (safeMediaIndex + 1 < REVIEW_MEDIA_SCOPES.length) {
      return { sortIndex: safeSortIndex, mediaIndex: safeMediaIndex + 1, scopeIndex: 0 }
    }
    if (safeSortIndex + 1 < REVIEW_SORTS.length) {
      return { sortIndex: safeSortIndex + 1, mediaIndex: 0, scopeIndex: 0 }
    }
    return null
  }

  function buildScopedReviewUrl(item, scope = REVIEW_SCOPES[0], sort = REVIEW_SORTS[0], media = REVIEW_MEDIA_SCOPES[0]) {
    const base = item?.reviewsUrl || ''
    const url = parseUrl(base)
    if (!url) return base
    url.searchParams.set('sortBy', sort?.sortBy || REVIEW_SORTS[0].sortBy)
    url.searchParams.delete('pageNumber')
    url.searchParams.delete('nextPageToken')
    if (scope?.filterByStar) url.searchParams.set('filterByStar', scope.filterByStar)
    else url.searchParams.delete('filterByStar')
    if (media?.mediaType) url.searchParams.set('mediaType', media.mediaType)
    else url.searchParams.delete('mediaType')
    return url.href
  }

  function buildReviewsProgressShared(state = shared, overrides = {}) {
    const nextState = { ...(state || {}), ...(overrides || {}) }
    const queue = Array.isArray(nextState.queue) ? nextState.queue : []
    const totalItems = queue.length
    const currentIndex = toInt(nextState.current_index, 0, 0, Math.max(totalItems - 1, 0))
    const item = queue[currentIndex] || null
    const expectedCount = toInt(nextState.current_expected_reviews, 0, 0)
    const currentItemCollected = toInt(nextState.current_item_collected_reviews, 0, 0)
    const completedItems = toInt(nextState.completed_items, 0, 0, totalItems)
    const currentPage = toInt(nextState.current_review_page, 1, 1)
    const collectedReviews = toInt(nextState.collected_reviews, 0, 0)
    const sort = getCurrentSort(nextState)
    const media = getCurrentMediaScope(nextState)
    const scope = getCurrentScope(nextState)
    const dimensionTotal = getDimensionTotal(nextState)
    const currentSortIndex = toInt(nextState.current_sort_index, 0, 0, REVIEW_SORTS.length - 1)
    const currentMediaIndex = toInt(nextState.current_media_index, 0, 0, REVIEW_MEDIA_SCOPES.length - 1)
    const currentScopeIndex = toInt(nextState.current_scope_index, 0, 0, REVIEW_SCOPES.length - 1)
    const currentDimensionIndex = isQuickMode(nextState) ? 1 : (currentSortIndex * REVIEW_MEDIA_SCOPES.length * REVIEW_SCOPES.length) + (currentMediaIndex * REVIEW_SCOPES.length) + currentScopeIndex + 1
    return {
      ...nextState,
      current_sort_id: sort.id,
      current_sort_label: sort.label,
      current_media_id: media.id,
      current_media_label: media.label,
      current_scope_id: scope.id,
      current_scope_label: scope.label,
      fetch_mode: normalizeFetchMode(nextState.fetch_mode),
      fetch_mode_label: isQuickMode(nextState) ? '只取前 100 条（快速）' : '全量取（耗时长）',
      total_items: totalItems,
      total_rows: totalItems,
      current_exec_no: totalItems > 0 ? Math.min(currentIndex + 1, totalItems) : 0,
      current_store: item ? `Amazon Reviews · ${item.asin} · ${sort.label} · ${media.label} · ${scope.label}` : 'Amazon Reviews',
      current_buyer_id: item?.asin || '',
      batch_no: currentItemCollected,
      total_batches: expectedCount,
      detail_dimension_total: dimensionTotal,
      detail_dimension_index: item ? Math.min(currentDimensionIndex, dimensionTotal) : 0,
      detail_dimension_label: item ? `${sort.label} / ${media.label} / ${scope.label}` : '',
      list_total_rows: totalItems,
      list_completed_rows: completedItems,
      detail_total_targets: expectedCount,
      detail_completed_targets: currentItemCollected,
      detail_current_target_index: item ? Math.min(currentIndex + 1, totalItems) : 0,
      detail_current_target: item?.asin || '',
      detail_current_page: currentPage,
      detail_records_collected: collectedReviews,
    }
  }

  function cleanReviewTitle(value) {
    return compact(value)
      .replace(/^[0-9.]+\s+out of\s+5\s+stars\s*/i, '')
      .replace(/^Rated\s+[0-9.]+\s+out of\s+5\s+stars\s*/i, '')
      .trim()
  }

  function parseRating(value) {
    const text = compact(value)
    const match = text.match(/([0-9](?:\.[0-9])?)/)
    if (!match) return ''
    const number = Number(match[1])
    if (!Number.isFinite(number)) return match[1]
    return Number.isInteger(number) ? String(number) : String(number)
  }

  function parseReviewDate(value) {
    const text = compact(value)
    const english = text.match(/^Reviewed\s+in\s+(.+?)\s+on\s+(.+)$/i)
    if (english) {
      return {
        country: compact(english[1]).replace(/^the\s+/i, ''),
        date: compact(english[2]),
        raw: text,
      }
    }
    const onOnly = text.match(/\bon\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})$/i)
    return {
      country: '',
      date: onOnly ? compact(onOnly[1]) : text,
      raw: text,
    }
  }

  function parseHelpfulVotes(value) {
    const text = compact(value).replace(/,/g, '')
    if (/^one person found/i.test(text)) return 1
    const match = text.match(/(\d+)\s+people?\s+found/i)
    return match ? Number(match[1]) : 0
  }

  function parseReviewCountText(value) {
    const text = compact(value).replace(/,/g, '')
    const matchingCustomerReviews = text.match(/(\d+)\s+matching\s+customer\s+reviews?/i)
    if (matchingCustomerReviews) return Number(matchingCustomerReviews[1])
    const customerReviews = text.match(/(\d+)\s+customer\s+reviews?/i)
    if (customerReviews) return Number(customerReviews[1])
    const withReviews = text.match(/(\d+)\s+with\s+reviews/i)
    if (withReviews) return Number(withReviews[1])
    const noisyCustomerReviews = text.match(/(\d+)\s+cu\s*tomer\s+reviews?/i)
    if (noisyCustomerReviews) return Number(noisyCustomerReviews[1])
    return 0
  }

  function stripVariantText(value) {
    return compact(value)
      .replace(/\s*Verified Purchase\s*$/i, '')
      .replace(/\s*已验证购买\s*$/i, '')
      .trim()
  }

  function getReviewCards(doc) {
    const selectors = [
      '[data-hook="review"], div.review, li.review',
      '[data-hook="review"]',
      'div.review',
      'li.review',
      '[id^="customer_review-"]',
    ]
    const cards = []
    const seen = new Set()
    const seenReviewIds = new Set()
    for (const selector of selectors) {
      for (const card of queryAll(doc, selector)) {
        if (seen.has(card)) continue
        seen.add(card)
        const reviewId = compact(attr(card, 'id') || attr(card, 'data-review-id')).replace(/^customer_review-/, '')
        if (reviewId) {
          if (seenReviewIds.has(reviewId)) continue
          seenReviewIds.add(reviewId)
        }
        cards.push(card)
      }
    }
    return cards
  }

  function getReviewImages(card, currentUrl) {
    const selectors = [
      'img.review-image-tile, [data-hook="review-image-tile"] img, .review-image-tile-section img',
      'img.review-image-tile',
      '[data-hook="review-image-tile"] img',
      '.review-image-tile-section img',
      '.review-image-tile',
    ]
    const urls = []
    const seen = new Set()
    for (const selector of selectors) {
      for (const img of queryAll(card, selector)) {
        const url = makeAbsoluteAmazonUrl(attr(img, 'src') || img.src || attr(img, 'data-src'), currentUrl)
        if (!url || seen.has(url)) continue
        seen.add(url)
        urls.push(url)
      }
    }
    return urls
  }

  function reviewKey(row) {
    if (row.评价ID) return `${row.ASIN}|${row.评价ID}`
    return [
      row.ASIN,
      row.买家昵称,
      row.评价时间,
      row.评分,
      row.评价标题,
      row.评价内容,
    ].map(compact).join('|')
  }

  function collectResumeSeedRows(allowedAsins = []) {
    const allowed = new Set((allowedAsins || []).map(item => compact(item).toUpperCase()).filter(Boolean))
    const file = params.resume_reviews_file || params.resume_file || null
    const rows = []
    if (Array.isArray(file?.rows)) rows.push(...file.rows)
    if (file?.sheets && typeof file.sheets === 'object') {
      for (const sheet of Object.values(file.sheets)) {
        if (Array.isArray(sheet?.rows) && sheet.rows !== file.rows) rows.push(...sheet.rows)
      }
    }
    const seen = new Set()
    const seedRows = []
    const seedKeys = []
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const normalized = { ...row }
      normalized.ASIN = compact(normalized.ASIN || normalized.asin).toUpperCase()
      normalized.评价ID = compact(normalized.评价ID || normalized.review_id || normalized['Review ID'])
      const key = reviewKey(normalized)
      if (!normalized.ASIN || !key || seen.has(key)) continue
      if (allowed.size && !allowed.has(normalized.ASIN)) continue
      seen.add(key)
      seedKeys.push(key)
      seedRows.push(normalized)
    }
    return { rows: seedRows, keys: seedKeys }
  }

  function countSeedReviewsForAsin(seedKeys = [], asin = '') {
    return countSeenReviewsForAsin(new Set(seedKeys), asin)
  }

  function reviewCardIdentity(card, index = 0) {
    const reviewId = compact(attr(card, 'id') || attr(card, 'data-review-id')).replace(/^customer_review-/, '')
    if (reviewId) return reviewId
    const fallback = compact([
      firstAttr(card, ['[data-hook="review-star-rating"], [data-hook="cmps-review-star-rating"], .review-rating'], 'aria-label'),
      firstText(card, ['[data-hook="review-title"], .review-title, a.review-title']),
      firstText(card, ['[data-hook="review-date"], .review-date']),
      firstText(card, ['[data-hook="review-body"], .review-text, .review-text-content']).slice(0, 120),
    ].join('|'))
    return fallback || `review-index-${index}`
  }

  function reviewCardsSignature(doc) {
    return getReviewCards(doc).map((card, index) => reviewCardIdentity(card, index)).join('||')
  }

  function parseCurrentReviewPageNumber(raw) {
    const text = compact(raw)
    const url = parseUrl(text)
    const fromQuery = compact(url?.searchParams?.get?.('pageNumber') || '')
    const queryNumber = Number(fromQuery)
    if (Number.isFinite(queryNumber) && queryNumber > 0) return Math.floor(queryNumber)
    const refMatch = text.match(/paging_btm_(\d+)/i)
    const refNumber = Number(refMatch?.[1])
    if (Number.isFinite(refNumber) && refNumber > 0) return Math.floor(refNumber)
    return 1
  }

  function countSeenReviewsForAsin(seen, asin) {
    const prefix = `${compact(asin)}|`
    if (!prefix.trim()) return 0
    let count = 0
    for (const key of seen || []) {
      if (String(key || '').startsWith(prefix)) count += 1
    }
    return count
  }

  function normalizeReviewCard(card, context, index) {
    const reviewId = attr(card, 'id') || attr(card, 'data-review-id')
    const ratingText =
      firstAttr(card, ['[data-hook="review-star-rating"], [data-hook="cmps-review-star-rating"], .review-rating'], 'aria-label') ||
      firstAttr(card, ['[data-hook="review-star-rating"]', '[data-hook="cmps-review-star-rating"]', '.review-rating', 'i.a-icon-star'], 'aria-label') ||
      firstText(card, ['[data-hook="review-star-rating"], [data-hook="cmps-review-star-rating"], .review-rating']) ||
      firstText(card, ['[data-hook="review-star-rating"]', '[data-hook="cmps-review-star-rating"]', '.review-rating', 'i.a-icon-star'])
    const title = cleanReviewTitle(firstText(card, ['[data-hook="review-title"], .review-title, a.review-title', '[data-hook="review-title"]', '.review-title', 'a.review-title']))
    const body = firstText(card, ['[data-hook="review-body"], .review-text, .review-text-content', '[data-hook="review-body"]', '.review-text', '.review-text-content'])
    const dateInfo = parseReviewDate(firstText(card, ['[data-hook="review-date"], .review-date', '[data-hook="review-date"]', '.review-date']))
    const profileUrl = firstAttr(card, ['.a-profile a', 'a.a-profile'], 'href')
    const images = getReviewImages(card, context.currentUrl)
    const variant = stripVariantText(firstText(card, ['[data-hook="format-strip"], .review-format-strip, .a-size-mini.a-color-secondary', '[data-hook="format-strip"]', '.review-format-strip', '.a-size-mini.a-color-secondary']))
    const verified = !!firstNode(card, ['[data-hook="avp-badge"], .avp-badge', '[data-hook="avp-badge"]', '.avp-badge'])

    return {
      ASIN: context.item.asin,
      源链接: context.item.originalUrl || '',
      商品链接: context.item.productUrl || '',
      评论页链接: context.currentUrl,
      商品标题: context.productTitle || '',
      页码: context.pageNumber,
      页内序号: index + 1,
      评价ID: compact(reviewId).replace(/^customer_review-/, ''),
      买家昵称: firstText(card, ['.a-profile-name, [data-hook="review-author"]', '.a-profile-name', '[data-hook="review-author"]']) || '',
      买家主页: makeAbsoluteAmazonUrl(profileUrl, context.currentUrl),
      评分: parseRating(ratingText),
      评价标题: title,
      评价内容: body,
      评价国家: dateInfo.country,
      评价时间: dateInfo.date,
      评价时间原文: dateInfo.raw,
      变体信息: variant,
      VerifiedPurchase: verified ? '是' : '否',
      Helpful票数: parseHelpfulVotes(firstText(card, ['[data-hook="helpful-vote-statement"], .cr-vote-text', '[data-hook="helpful-vote-statement"]', '.cr-vote-text'])),
      评价图片: images.join('\n'),
      抓取时间: isoNow(),
      数据来源: 'Amazon product-reviews',
      执行结果: '成功',
      备注: '',
    }
  }

  function extractNextReviewUrl(doc, currentUrl) {
    const candidates = [
      'li.a-last a, .a-pagination .a-last a, a[aria-label="Next page"]',
      'li.a-last a',
      '.a-pagination .a-last a',
      'a[aria-label="Next page"]',
      'a[aria-label="下一页"]',
    ]
    for (const selector of candidates) {
      const link = query(doc, selector)
      if (!link) continue
      const parentDisabled = link.parentElement?.classList?.contains?.('a-disabled')
      const disabled = parentDisabled || link.classList?.contains?.('a-disabled') || attr(link, 'aria-disabled') === 'true'
      const href = attr(link, 'href') || link.href
      if (disabled || !href) continue
      const absolute = makeAbsoluteAmazonUrl(href, currentUrl)
      if (absolute && /\/product-reviews\//i.test(absolute)) return normalizeReviewPageUrl(absolute) || absolute
    }
    return ''
  }

  function getShowMoreButton(doc) {
    const button = firstNode(doc, [
      '[data-hook="show-more-button"], .cm-cr-show-more a',
      '[data-hook="show-more-button"]',
      '.cm-cr-show-more a',
    ])
    if (!button) return null
    const text = textOf(button)
    const href = attr(button, 'href') || button.href || ''
    const stateText = attr(button, 'data-reviews-state-param')
    if (!/show\s+10\s+more\s+reviews|show\s+more\s+reviews/i.test(text) && !stateText && !/paging_btm/i.test(href)) {
      return null
    }
    return button
  }

  function getExpectedReviewCount(doc) {
    const text = firstText(doc, [
      '[data-hook="cr-filter-info-review-rating-count"], .cr-filter-info-review-rating-count',
      '[data-hook="cr-filter-info-review-rating-count"]',
      '.cr-filter-info-review-rating-count',
      '#filter-info-section',
      '[data-hook="total-review-count"]',
    ])
    return parseReviewCountText(text)
  }

  async function waitForShowMoreButton(doc, timeoutMs = 8000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const button = getShowMoreButton(doc)
      if (button) return button
      await sleepRandom(450, 900)
    }
    return getShowMoreButton(doc)
  }

  async function waitForReviewCountGrowth(doc, previousCount, timeoutMs = 18000) {
    if (getReviewCards(doc).length > previousCount) return true
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (isAmazonRobotCheck()) return false
      const count = getReviewCards(doc).length
      if (count > previousCount) return true
      await sleepRandom(550, 1100)
    }
    return getReviewCards(doc).length > previousCount
  }

  async function waitForStableReviewState(doc, stableMs = 4500, timeoutMs = 18000) {
    const start = Date.now()
    let lastCount = getReviewCards(doc).length
    let stableSince = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (isAmazonRobotCheck()) {
        return { count: getReviewCards(doc).length, has_more_button: !!getShowMoreButton(doc), robot_check: true }
      }
      const count = getReviewCards(doc).length
      if (count !== lastCount) {
        lastCount = count
        stableSince = Date.now()
      }
      const hasButton = !!getShowMoreButton(doc)
      if (hasButton || Date.now() - stableSince >= stableMs) {
        return { count, has_more_button: hasButton, robot_check: false }
      }
      await sleepRandom(650, 1200)
    }
    return { count: getReviewCards(doc).length, has_more_button: !!getShowMoreButton(doc), robot_check: false }
  }

  async function prepareShowMoreClick(button) {
    if (typeof button.scrollIntoView === 'function') {
      button.scrollIntoView({ block: 'center', inline: 'nearest' })
      await sleepRandom(700, 1500)
    }
    try {
      if (typeof window.scrollBy === 'function') {
        window.scrollBy({ top: randomInt(-80, 120), left: randomInt(-12, 12), behavior: 'instant' })
        await sleepRandom(450, 1100)
      }
    } catch (error) {
      // Some test DOMs do not implement scrollBy options; the click can still proceed.
    }
    try {
      button.dispatchEvent?.(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }))
      await sleepRandom(250, 700)
    } catch (error) {
      // MouseEvent may be unavailable in the VM test harness.
    }
  }

  async function waitForReviewPageChange(doc, previousSignature, timeoutMs = 18000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (isAmazonRobotCheck()) return false
      const cards = getReviewCards(doc)
      const signature = reviewCardsSignature(doc)
      if (cards.length > 0 && signature && signature !== previousSignature) return true
      await sleepRandom(550, 1100)
    }
    return reviewCardsSignature(doc) !== previousSignature
  }

  async function clickShowMoreForNextReviewPage(doc, maxPages, state = shared) {
    const limit = toInt(maxPages, DEFAULT_MAX_PAGES_PER_ASIN, 1, DEFAULT_MAX_PAGES_PER_ASIN)
    const currentPage = Math.max(1, toInt(state.current_review_page, parseCurrentReviewPageNumber(String(location.href || '')), 1, limit))
    const pageExpectedCount = getExpectedReviewCount(doc)
    const expectedCount = effectiveReviewTargetCount(toInt(state.current_expected_reviews, 0, 0) || pageExpectedCount, state)
    const scopeExpectedCount = effectiveReviewTargetCount(toInt(state.current_scope_expected_reviews, 0, 0) || pageExpectedCount || expectedCount, state)
    const collectedForItem = toInt(state.current_item_collected_reviews, 0, 0)
    const collectedForScope = toInt(state.current_scope_collected_reviews, 0, 0)
    const currentVisibleCount = getReviewCards(doc).length

    if (currentPage >= limit) {
      return { clicked: false, reason: 'max_pages_reached', expected_count: expectedCount, current_page: currentPage }
    }
    if (expectedCount > 0 && collectedForItem >= expectedCount) {
      return { clicked: false, reason: 'expected_count_reached', expected_count: expectedCount, current_page: currentPage }
    }
    if (scopeExpectedCount > 0 && collectedForScope >= scopeExpectedCount) {
      return { clicked: false, reason: 'scope_expected_count_reached', expected_count: expectedCount, scope_expected_count: scopeExpectedCount, current_page: currentPage }
    }

    let button = getShowMoreButton(doc)
    if (!button && currentPage >= AMAZON_PUBLIC_REVIEW_PAGE_LIMIT) {
      return {
        clicked: false,
        reason: 'public_page_limit_reached',
        expected_count: expectedCount,
        scope_expected_count: scopeExpectedCount,
        current_page: currentPage,
        has_more_button: false,
      }
    }
    if (!button && expectedCount > 0 && collectedForItem < expectedCount) {
      button = await waitForShowMoreButton(doc, 20000)
    }
    if (!button) {
      const stable = expectedCount > 0 && collectedForItem + currentVisibleCount < expectedCount
        ? await waitForStableReviewState(doc, 5500, 20000)
        : { count: currentVisibleCount, has_more_button: false, robot_check: false }
      return {
        clicked: false,
        reason: stable.robot_check ? 'robot_check' : expectedCount > 0 && collectedForItem + currentVisibleCount < expectedCount ? 'no_more_button_before_expected_count' : 'no_more_button',
        expected_count: expectedCount,
        current_page: currentPage,
        has_more_button: stable.has_more_button,
      }
    }

    const beforeSignature = reviewCardsSignature(doc)
    try {
      await prepareShowMoreClick(button)
      if (typeof button.click !== 'function') {
        return {
          clicked: false,
          reason: 'show_more_button_not_clickable',
          expected_count: expectedCount,
          current_page: currentPage,
          has_more_button: true,
        }
      }
      button.click()
    } catch (error) {
      return {
        clicked: false,
        reason: `show_more_click_failed: ${error?.message || error}`,
        expected_count: expectedCount,
        current_page: currentPage,
        has_more_button: true,
      }
    }

    await sleepRandom(1600, 3200)
    const changed = await waitForReviewPageChange(doc, beforeSignature, 20000)
    return {
      clicked: true,
      changed,
      reason: changed ? 'clicked' : 'show_more_no_page_change',
      expected_count: expectedCount,
      current_page: currentPage,
      next_page: currentPage + 1,
      has_more_button: !!getShowMoreButton(doc),
    }
  }

  function extractReviewPage(doc, currentUrl, item, pageNumber = 1) {
    const productTitle = firstText(doc, [
      '#productTitle, [data-hook="product-title"], .product-title',
      '#productTitle',
      '[data-hook="product-title"]',
      '.product-title',
      'h1',
    ])
    const cards = getReviewCards(doc)
    const context = {
      item,
      currentUrl,
      pageNumber,
      productTitle,
    }
    const rows = cards
      .map((card, index) => normalizeReviewCard(card, context, index))
      .filter(row => row.评价ID || row.评价标题 || row.评价内容)
    const reviewCountText = firstText(doc, [
      '[data-hook="cr-filter-info-review-rating-count"], .cr-filter-info-review-rating-count',
      '[data-hook="cr-filter-info-review-rating-count"]',
      '.cr-filter-info-review-rating-count',
      '#filter-info-section',
      '[data-hook="total-review-count"]',
    ])
    return {
      rows,
      nextUrl: getShowMoreButton(doc) ? '' : extractNextReviewUrl(doc, currentUrl),
      summary: {
        product_title: productTitle,
        review_count_text: reviewCountText,
      },
    }
  }

  function hasReviewPageEvidence() {
    if (getReviewCards(document).length > 0) return true
    const bodyText = compact(document.body?.innerText || document.body?.textContent || '')
    return /Customer reviews|Review this product|No customer reviews|There are no reviews|global ratings/i.test(bodyText)
  }

  function isAmazonAutomatedAccessBlock() {
    const title = compact(document.title || '')
    const text = compact(document.body?.innerText || document.body?.textContent || '')
    const html = compact(document.body?.innerHTML || '')
    const combined = `${title} ${text} ${html}`
    return /automated access to Amazon data|api-services-support@amazon\.com/i.test(combined) ||
      (/Page Not Found/i.test(title) && /automated access|Amazon data|api-services-support/i.test(combined))
  }

  function isAmazonRobotCheck() {
    const text = compact(document.body?.innerText || document.body?.textContent || '')
    return /Enter the characters you see below|Sorry, we just need to make sure you're not a robot|Type the characters you see in this image/i.test(text)
  }

  async function waitForReviewPage(timeoutMs = 12000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (isAmazonRobotCheck()) return false
      if (hasReviewPageEvidence()) return true
      await sleep(500)
    }
    return hasReviewPageEvidence()
  }

  function collectReviewUrlsFromParams() {
    return [
      ...splitInputText(params.review_urls),
      ...splitInputText(params.product_urls),
      ...splitInputText(params.item_links),
      ...splitInputText(params.links),
    ].join('\n')
  }

  function initializeShared() {
    const queue = buildInputQueue(collectReviewUrlsFromParams())
    if (!queue.length) throw new Error('未解析到有效的 Amazon 商品链接或评论页链接')
    const resumeSeed = collectResumeSeedRows(queue.map(item => item.asin))
    const firstItem = queue[0] || null
    const firstItemSeedCount = firstItem ? countSeedReviewsForAsin(resumeSeed.keys, firstItem.asin) : 0
    return buildReviewsProgressShared({
      ...shared,
      queue,
      fetch_mode: normalizeFetchMode(params.fetch_mode),
      current_index: 0,
      current_sort_index: 0,
      current_media_index: 0,
      current_scope_index: 0,
      current_review_page: 1,
      next_review_url: '',
      target_url: buildScopedReviewUrl(queue[0], REVIEW_SCOPES[0], REVIEW_SORTS[0], REVIEW_MEDIA_SCOPES[0]),
      seen_review_keys: resumeSeed.keys,
      collected_reviews: resumeSeed.rows.length,
      completed_items: 0,
      current_item_collected_reviews: firstItemSeedCount,
      current_expected_reviews: 0,
      current_scope_collected_reviews: 0,
      current_scope_expected_reviews: 0,
      resume_seed_rows: resumeSeed.rows,
      resume_seed_emitted: false,
      resume_seed_row_count: resumeSeed.rows.length,
      traffic_limited: false,
      stop_reason: '',
      pending_click_summary: null,
      review_page_summaries: [],
    })
  }

  function buildNotifyTitle(state) {
    return `亚马逊Reviews全量抓取 ${Number(state.collected_reviews || 0)} 条`
  }

  function buildNotifyBody(state) {
    const queue = Array.isArray(state.queue) ? state.queue : []
    const asinList = queue.map(item => item.asin).filter(Boolean).join('、')
    return [`ASIN：${asinList}`, `评价数：${Number(state.collected_reviews || 0)}`].filter(Boolean).join('\n')
  }

  if (testExports) {
    Object.assign(testExports, {
      splitInputText,
      parseUrl,
      extractAsinFromUrl,
      buildReviewUrls,
      buildInputQueue,
      normalizeReviewPageUrl,
      parseReviewCountText,
      parseReviewDate,
      parseHelpfulVotes,
      extractReviewPage,
      getReviewCards,
      getShowMoreButton,
      clickShowMoreForNextReviewPage,
      extractNextReviewUrl,
      reviewKey,
      parseCurrentReviewPageNumber,
      buildReviewsProgressShared,
      buildScopedReviewUrl,
      getCurrentScope,
      getCurrentSort,
      getCurrentMediaScope,
      getNextReviewDimension,
      collectResumeSeedRows,
      randomDelayFromParams,
    })
    return complete([], false, shared)
  }

  try {
    if (phase === 'main' || phase === 'init') {
      const state = Array.isArray(shared.queue) ? shared : initializeShared()
      const item = getCurrentItem(state)
      if (!item) {
        return complete([], false, state, {
          notify_title: buildNotifyTitle(state),
          notify_body: buildNotifyBody(state),
        })
      }
      const targetUrl = state.next_review_url || item.reviewsUrl
      const seedRows = !state.resume_seed_emitted && Array.isArray(state.resume_seed_rows) ? state.resume_seed_rows : []
      return nextPhase('ensure_reviews_page', 0, buildReviewsProgressShared(state, {
        target_url: state.next_review_url || buildScopedReviewUrl(item, getCurrentScope(state), getCurrentSort(state), getCurrentMediaScope(state)),
        resume_seed_emitted: true,
      }), seedRows)
    }

    if (phase === 'ensure_reviews_page') {
      const item = getCurrentItem(shared)
      if (!item) return complete([], false, shared)
      const targetUrl = shared.next_review_url || shared.target_url || buildScopedReviewUrl(item, getCurrentScope(shared), getCurrentSort(shared), getCurrentMediaScope(shared))
      if (!sameReviewTarget(String(location.href || ''), targetUrl)) {
        location.href = targetUrl
      }
      return nextPhase('wait_reviews_page', DEFAULT_PAGE_DELAY_MS, buildReviewsProgressShared(shared, {
        target_url: targetUrl,
      }))
    }

    if (phase === 'wait_reviews_page') {
      if (isAmazonRobotCheck()) {
        return abortTask('Amazon 显示机器人验证，已停止并导出已抓结果；请在当前浏览器完成验证后再用导出的文件续跑', buildReviewsProgressShared(shared, {
          traffic_limited: true,
          stop_reason: 'robot_check',
        }))
      }
      if (isAmazonAutomatedAccessBlock()) {
        return abortTask('Amazon 返回自动化访问限制页（Page Not Found），已停止并导出已抓结果；请稍后再用导出的文件续跑', buildReviewsProgressShared(shared, {
          traffic_limited: true,
          stop_reason: 'automated_access_block',
        }))
      }
      const ok = await waitForReviewPage(12000)
      if (!ok) return fail('Amazon 评论页未加载出评价区域，请确认链接可访问或完成页面验证')
      return nextPhase('collect_reviews_page', randomInt(900, 1800), shared)
    }

    if (phase === 'collect_reviews_page') {
      const item = getCurrentItem(shared)
      if (!item) return complete([], false, shared)
      if (isAmazonRobotCheck()) {
        return abortTask('Amazon 显示机器人验证，已停止并导出已抓结果；请在当前浏览器完成验证后再用导出的文件续跑', buildReviewsProgressShared(shared, {
          traffic_limited: true,
          stop_reason: 'robot_check',
        }))
      }
      if (isAmazonAutomatedAccessBlock()) {
        return abortTask('Amazon 返回自动化访问限制页（Page Not Found），已停止并导出已抓结果；请稍后再用导出的文件续跑', buildReviewsProgressShared(shared, {
          traffic_limited: true,
          stop_reason: 'automated_access_block',
        }))
      }
      const currentUrl = normalizeReviewPageUrl(String(location.href || '')) || String(location.href || shared.target_url || item.reviewsUrl)
      const maxPages = toInt(params.max_pages_per_product, DEFAULT_MAX_PAGES_PER_ASIN, 1, DEFAULT_MAX_PAGES_PER_ASIN)
      const currentReviewPage = Math.max(1, toInt(shared.current_review_page, parseCurrentReviewPageNumber(String(location.href || '')), 1, maxPages))
      const sort = getCurrentSort(shared)
      const media = getCurrentMediaScope(shared)
      const scope = getCurrentScope(shared)
      const extracted = extractReviewPage(document, currentUrl, item, currentReviewPage)
      const seen = new Set(Array.isArray(shared.seen_review_keys) ? shared.seen_review_keys : [])
      const rows = []
      const newKeys = []
      for (const row of extracted.rows) {
        const key = reviewKey(row)
        if (!key || seen.has(key)) continue
        seen.add(key)
        newKeys.push(key)
        rows.push(row)
      }

      const queue = Array.isArray(shared.queue) ? shared.queue : []
      const currentIndex = toInt(shared.current_index, 0, 0, queue.length)
      const pageExpectedCount = getExpectedReviewCount(document)
      const existingExpectedCount = toInt(shared.current_expected_reviews, 0, 0)
      const existingScopeCollected = toInt(shared.current_scope_collected_reviews, 0, 0)
      const currentItemCollectedBeforeLimit = countSeenReviewsForAsin(seen, item.asin)
      const rawExpectedCount = scope.id === 'all'
        ? (pageExpectedCount || existingExpectedCount)
        : (existingExpectedCount || currentItemCollectedBeforeLimit || pageExpectedCount)
      const expectedCount = effectiveReviewTargetCount(rawExpectedCount, shared)
      let emittedRows = rows
      if (isQuickMode(shared)) {
        const alreadyCollectedBeforeThisPage = Math.max(0, currentItemCollectedBeforeLimit - rows.length)
        const remaining = Math.max(0, expectedCount - alreadyCollectedBeforeThisPage)
        emittedRows = rows.slice(0, remaining)
      }
      const currentItemCollected = isQuickMode(shared)
        ? Math.min(expectedCount, countSeenReviewsForAsin(seen, item.asin))
        : countSeenReviewsForAsin(seen, item.asin)
      const currentScopeCollected = isQuickMode(shared)
        ? Math.min(expectedCount, existingScopeCollected + emittedRows.length)
        : existingScopeCollected + extracted.rows.length
      const currentScopeExpected = effectiveReviewTargetCount(pageExpectedCount || toInt(shared.current_scope_expected_reviews, 0, 0) || expectedCount, shared)
      const collectedReviews = Number(shared.collected_reviews || 0) + emittedRows.length
      const scopeRowNote = [
        `排序：${sort.label}`,
        media.id !== 'all_media' ? `媒体范围：${media.label}` : '',
        scope.id !== 'all' ? `筛选范围：${scope.label}` : '',
      ].filter(Boolean).join('；')
      if (scopeRowNote) {
        for (const row of emittedRows) {
          row.备注 = row.备注 ? `${row.备注}；${scopeRowNote}` : scopeRowNote
        }
      }
      const hasShowMoreButton = !!getShowMoreButton(document)
      const reachedExpected = expectedCount > 0 && currentItemCollected >= expectedCount
      const reachedScopeExpected = currentScopeExpected > 0 && currentScopeCollected >= currentScopeExpected
      const reachedPublicPageLimit = currentReviewPage >= AMAZON_PUBLIC_REVIEW_PAGE_LIMIT && !hasShowMoreButton
      const canTryShowMore = hasShowMoreButton && currentReviewPage < maxPages && !reachedExpected && !reachedScopeExpected
      const pageSummary = {
        asin: item.asin,
        sort: sort.id,
        sort_label: sort.label,
        media: media.id,
        media_label: media.label,
        scope: scope.id,
        scope_label: scope.label,
        page: currentReviewPage,
        rows: emittedRows.length,
        logical_count_on_page: extracted.rows.length,
        expected_count: expectedCount,
        scope_expected_count: currentScopeExpected,
        collected_for_item: currentItemCollected,
        collected_for_scope: currentScopeCollected,
        has_more_button: hasShowMoreButton,
        stopped_reason: reachedExpected
          ? 'expected_count_reached'
          : reachedScopeExpected ? 'scope_expected_count_reached'
            : canTryShowMore ? 'page_collected_wait_next_click'
              : hasShowMoreButton ? 'max_pages_reached'
                : reachedPublicPageLimit ? 'public_page_limit_reached' : 'no_more_button',
        review_count_text: extracted.summary.review_count_text || '',
        product_title: extracted.summary.product_title || '',
      }
      const nextShared = buildReviewsProgressShared(shared, {
        current_index: currentIndex,
        current_sort_index: toInt(shared.current_sort_index, 0, 0, REVIEW_SORTS.length - 1),
        current_media_index: toInt(shared.current_media_index, 0, 0, REVIEW_MEDIA_SCOPES.length - 1),
        current_scope_index: toInt(shared.current_scope_index, 0, 0, REVIEW_SCOPES.length - 1),
        current_review_page: currentReviewPage,
        next_review_url: '',
        target_url: buildScopedReviewUrl(item, scope, sort, media),
        seen_review_keys: [...seen],
        collected_reviews: collectedReviews,
        current_item_collected_reviews: currentItemCollected,
        current_expected_reviews: expectedCount,
        current_scope_collected_reviews: currentScopeCollected,
        current_scope_expected_reviews: currentScopeExpected,
        detail_total_pages: currentScopeExpected > 0 ? Math.ceil(currentScopeExpected / 10) : (expectedCount > 0 ? Math.ceil(expectedCount / 10) : 0),
        review_page_summaries: [
          ...(Array.isArray(shared.review_page_summaries) ? shared.review_page_summaries : []),
          pageSummary,
        ],
      })
      if (canTryShowMore) {
        return nextPhase('advance_reviews_page', clickDelayMs(), nextShared, emittedRows)
      }

      const hasNextItem = currentIndex + 1 < queue.length
      const currentSortIndex = toInt(shared.current_sort_index, 0, 0, REVIEW_SORTS.length - 1)
      const currentMediaIndex = toInt(shared.current_media_index, 0, 0, REVIEW_MEDIA_SCOPES.length - 1)
      const currentScopeIndex = toInt(shared.current_scope_index, 0, 0, REVIEW_SCOPES.length - 1)
      const nextDimension = (!isQuickMode(nextShared) && currentItemCollected < expectedCount) ? getNextReviewDimension(currentSortIndex, currentMediaIndex, currentScopeIndex) : null
      const hasNextDimension = !!nextDimension
      const nextIndex = hasNextDimension ? currentIndex : hasNextItem ? currentIndex + 1 : currentIndex
      const nextSortIndex = hasNextDimension ? nextDimension.sortIndex : 0
      const nextMediaIndex = hasNextDimension ? nextDimension.mediaIndex : 0
      const nextScopeIndex = hasNextDimension ? nextDimension.scopeIndex : 0
      const nextItem = queue[nextIndex] || item
      const nextItemSeedCount = nextItem && hasNextItem && !hasNextDimension
        ? countSeenReviewsForAsin(seen, nextItem.asin)
        : 0
      const nextSort = REVIEW_SORTS[nextSortIndex] || REVIEW_SORTS[0]
      const nextMedia = REVIEW_MEDIA_SCOPES[nextMediaIndex] || REVIEW_MEDIA_SCOPES[0]
      const nextScope = REVIEW_SCOPES[nextScopeIndex] || REVIEW_SCOPES[0]
      const afterItemShared = buildReviewsProgressShared(nextShared, {
        current_index: nextIndex,
        current_sort_index: nextSortIndex,
        current_media_index: nextMediaIndex,
        current_scope_index: nextScopeIndex,
        current_review_page: 1,
        next_review_url: '',
        target_url: hasNextDimension || hasNextItem ? buildScopedReviewUrl(nextItem, nextScope, nextSort, nextMedia) : '',
        completed_items: hasNextDimension ? Number(nextShared.completed_items || 0) : Math.min(Number(nextShared.completed_items || 0) + 1, queue.length),
        current_item_collected_reviews: hasNextDimension ? currentItemCollected : hasNextItem ? nextItemSeedCount : currentItemCollected,
        current_expected_reviews: hasNextDimension ? expectedCount : hasNextItem ? 0 : expectedCount,
        current_scope_collected_reviews: 0,
        current_scope_expected_reviews: 0,
      })
      const hasMore = hasNextDimension || hasNextItem
      const extraMeta = hasMore ? {} : {
        notify_title: buildNotifyTitle(afterItemShared),
        notify_body: buildNotifyBody(afterItemShared),
      }
      return complete(emittedRows, hasMore, afterItemShared, {
        sleep_ms: hasNextDimension ? dimensionDelayMs() : hasNextItem ? itemDelayMs() : 0,
        ...extraMeta,
      })
    }

    if (phase === 'advance_reviews_page') {
      const item = getCurrentItem(shared)
      if (!item) return complete([], false, shared)
      const maxPages = toInt(params.max_pages_per_product, DEFAULT_MAX_PAGES_PER_ASIN, 1, DEFAULT_MAX_PAGES_PER_ASIN)
      const clickSummary = await clickShowMoreForNextReviewPage(document, maxPages, shared)
      if (clickSummary.reason === 'robot_check') {
        return abortTask('Amazon 显示机器人验证，已停止并导出已抓结果；请在当前浏览器完成验证后再用导出的文件续跑', buildReviewsProgressShared(shared, {
          traffic_limited: true,
          stop_reason: 'robot_check',
          pending_click_summary: clickSummary,
        }))
      }
      if (isAmazonAutomatedAccessBlock()) {
        return abortTask('Amazon 返回自动化访问限制页（Page Not Found），已停止并导出已抓结果；请稍后再用导出的文件续跑', buildReviewsProgressShared(shared, {
          traffic_limited: true,
          stop_reason: 'automated_access_block',
          pending_click_summary: clickSummary,
        }))
      }
      if (clickSummary.clicked && clickSummary.changed) {
        return nextPhase('collect_reviews_page', pageDelayMs(), buildReviewsProgressShared(shared, {
          current_review_page: clickSummary.next_page || (Number(shared.current_review_page || 1) + 1),
          pending_click_summary: clickSummary,
        }))
      }

      const queue = Array.isArray(shared.queue) ? shared.queue : []
      const currentIndex = toInt(shared.current_index, 0, 0, queue.length)
      const hasNextItem = currentIndex + 1 < queue.length
      const currentExpected = Number(shared.current_expected_reviews || 0)
      const currentCollected = Number(shared.current_item_collected_reviews || 0)
      const currentSortIndex = toInt(shared.current_sort_index, 0, 0, REVIEW_SORTS.length - 1)
      const currentMediaIndex = toInt(shared.current_media_index, 0, 0, REVIEW_MEDIA_SCOPES.length - 1)
      const currentScopeIndex = toInt(shared.current_scope_index, 0, 0, REVIEW_SCOPES.length - 1)
      const nextDimension = (!isQuickMode(shared) && currentCollected < currentExpected) ? getNextReviewDimension(currentSortIndex, currentMediaIndex, currentScopeIndex) : null
      const hasNextDimension = !!nextDimension
      const nextIndex = hasNextDimension ? currentIndex : hasNextItem ? currentIndex + 1 : currentIndex
      const nextSortIndex = hasNextDimension ? nextDimension.sortIndex : 0
      const nextMediaIndex = hasNextDimension ? nextDimension.mediaIndex : 0
      const nextScopeIndex = hasNextDimension ? nextDimension.scopeIndex : 0
      const nextItem = queue[nextIndex] || item
      const nextItemSeedCount = nextItem && hasNextItem && !hasNextDimension
        ? countSeenReviewsForAsin(Array.isArray(shared.seen_review_keys) ? shared.seen_review_keys : [], nextItem.asin)
        : 0
      const nextShared = buildReviewsProgressShared(shared, {
        current_index: nextIndex,
        current_sort_index: nextSortIndex,
        current_media_index: nextMediaIndex,
        current_scope_index: nextScopeIndex,
        current_review_page: 1,
        next_review_url: '',
        target_url: hasNextDimension || hasNextItem ? buildScopedReviewUrl(nextItem, REVIEW_SCOPES[nextScopeIndex] || REVIEW_SCOPES[0], REVIEW_SORTS[nextSortIndex] || REVIEW_SORTS[0], REVIEW_MEDIA_SCOPES[nextMediaIndex] || REVIEW_MEDIA_SCOPES[0]) : '',
        completed_items: hasNextDimension ? Number(shared.completed_items || 0) : Math.min(Number(shared.completed_items || 0) + 1, queue.length),
        current_item_collected_reviews: hasNextDimension ? currentCollected : hasNextItem ? nextItemSeedCount : currentCollected,
        current_expected_reviews: hasNextDimension ? currentExpected : hasNextItem ? 0 : currentExpected,
        current_scope_collected_reviews: 0,
        current_scope_expected_reviews: 0,
        pending_click_summary: clickSummary,
      })
      const hasMore = hasNextDimension || hasNextItem
      const extraMeta = hasMore ? {} : {
        notify_title: buildNotifyTitle(nextShared),
        notify_body: buildNotifyBody(nextShared),
      }
      return complete([], hasMore, nextShared, {
        sleep_ms: hasNextDimension ? dimensionDelayMs() : hasNextItem ? itemDelayMs() : 0,
        ...extraMeta,
      })
    }

    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || error)
  }
})()
