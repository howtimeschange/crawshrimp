;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = Number(window.__CRAWSHRIMP_PAGE__ || 1)
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const DEFAULT_SEARCH_URL = 'https://us.shein.com/Store/dian-pu-xuan-pin-7859875567-sc-102146671.html?adp=&child_cat_id=2057&force_send_adp=1&fromPageType=store&recommend_context_params=%7B%22select_id%22%3A%22102146671%22%2C%22sc_url_id%22%3A%22102146671%22%2C%22service_type%22%3A6%7D&recommend_page_type=storeSelectListPageRec&src_identifier=si%3D7859875567%60fc%3DKids%60sc%3DKids%20Shoes%60tc%3DAll%20Items%60ps%3D1_4_1%60jc%3DitemPicking_2057&src_module=storeCat&src_tab_page_id=page_store1777019784211&st=7859875567&store_code=7859875567'
  const CAPTURE_KEY = 'detail_capture'
  const DEFAULT_MAX_PRODUCTS = 0
  const DEFAULT_MAX_LIST_PAGES = 4
  const DEFAULT_LIST_PAGE_DELAY_MS = 1600
  const DEFAULT_MAX_SCROLL_ROUNDS = 8
  const DEFAULT_DETAIL_DELAY_MS = 2600
  const DEFAULT_RETRY_COOLDOWN_MS = 12000
  const DEFAULT_MAX_DETAIL_RETRIES = 2
  const DEFAULT_CAPTCHA_WAIT_MS = 5000
  const DEFAULT_MAX_VERIFICATION_WAIT_ROUNDS = 12

  const persistedRequestShared = {
    requestedMode: String(shared.requestedMode || params.mode || 'current').trim().toLowerCase() || 'current',
    requestedSearchUrl: normalizeSearchUrl(shared.requestedSearchUrl || params.search_url || DEFAULT_SEARCH_URL),
    requestedMaxProducts: normalizeInteger(shared.requestedMaxProducts ?? params.max_products, DEFAULT_MAX_PRODUCTS, 0, 1000),
    requestedMaxListPages: normalizeInteger(shared.requestedMaxListPages ?? params.max_list_pages, DEFAULT_MAX_LIST_PAGES, 1, 80),
    requestedMaxScrollRounds: normalizeInteger(shared.requestedMaxScrollRounds ?? params.max_scroll_rounds, DEFAULT_MAX_SCROLL_ROUNDS, 0, 80),
    requestedDetailDelayMs: normalizeInteger(shared.requestedDetailDelayMs ?? params.detail_delay_ms, DEFAULT_DETAIL_DELAY_MS, 800, 60000),
    requestedRetryCooldownMs: normalizeInteger(shared.requestedRetryCooldownMs ?? params.retry_cooldown_ms, DEFAULT_RETRY_COOLDOWN_MS, 3000, 180000),
    requestedMaxDetailRetries: normalizeInteger(shared.requestedMaxDetailRetries ?? params.max_detail_retries, DEFAULT_MAX_DETAIL_RETRIES, 0, 5),
    requestedCaptchaWaitMs: normalizeInteger(shared.requestedCaptchaWaitMs ?? params.captcha_wait_ms, DEFAULT_CAPTCHA_WAIT_MS, 2000, 120000),
    requestedMaxVerificationWaitRounds: normalizeInteger(shared.requestedMaxVerificationWaitRounds ?? params.max_verification_wait_rounds, DEFAULT_MAX_VERIFICATION_WAIT_ROUNDS, 1, 120),
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

  function normalizeInteger(value, fallback, min, max) {
    const num = Number(value)
    if (!Number.isFinite(num)) return fallback
    return Math.max(min, Math.min(max, Math.floor(num)))
  }

  function normalizeSearchUrl(value) {
    const raw = String(value || '').trim()
    try {
      return new URL(raw || DEFAULT_SEARCH_URL, DEFAULT_SEARCH_URL).href
    } catch (error) {
      return DEFAULT_SEARCH_URL
    }
  }

  function withJitter(ms, ratio = 0.3) {
    const base = Math.max(0, Number(ms) || 0)
    const spread = Math.max(0, Math.min(1, Number(ratio) || 0)) * base
    return Math.round(base + ((Math.random() * 2 - 1) * spread))
  }

  function mergeShared(next = shared) {
    return {
      ...persistedRequestShared,
      ...(next || {}),
    }
  }

  function nextPhase(name, sleepMs = 800, next = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'next_phase', next_phase: name, sleep_ms: sleepMs, shared: mergeShared(next) },
    }
  }

  function complete(data, hasMore = false, next = shared) {
    return {
      success: true,
      data,
      meta: { action: 'complete', has_more: hasMore, shared: mergeShared(next) },
    }
  }

  function captureUrlRequests(url, nextPhaseName, options = {}, next = shared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'capture_url_requests',
        url,
        matches: options.matches || [],
        timeout_ms: options.timeout_ms || 18000,
        settle_ms: options.settle_ms == null ? 900 : options.settle_ms,
        min_matches: options.min_matches || 1,
        include_response_body: options.include_response_body !== false,
        shared_key: options.shared_key || CAPTURE_KEY,
        shared_append: !!options.shared_append,
        strict: !!options.strict,
        next_phase: nextPhaseName,
        sleep_ms: options.sleep_ms || 0,
        shared: mergeShared(next),
      },
    }
  }

  function fail(message) {
    return { success: false, error: String(message || '未知错误') }
  }

  function lowerText(value) {
    return String(value || '').toLowerCase()
  }

  function textOf(el) {
    return String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim()
  }

  function isVisible(el) {
    if (!el || typeof el.getClientRects !== 'function') return false
    return el.getClientRects().length > 0
  }

  function detectProtectionText(value) {
    const text = lowerText(value)
    const patterns = [
      /验证码/,
      /安全验证/,
      /人机验证/,
      /滑块验证/,
      /请完成验证/,
      /验证后继续/,
      /captcha/,
      /security check/,
      /verify you are human/,
      /human verification/,
      /one more step/,
      /just a moment/,
      /checking your browser/,
      /access denied/,
      /blocked for security reasons/,
      /unusual traffic/,
      /suspicious activity/,
      /robot/,
    ]
    const pattern = patterns.find(item => item.test(text))
    return pattern ? { present: true, reason: `text:${pattern.source}` } : { present: false, reason: '' }
  }

  function detectCaptchaState() {
    const textState = detectProtectionText(`${document.title || ''}\n${document.body?.innerText || document.body?.textContent || ''}`)
    if (textState.present) return textState

    const selectors = [
      'iframe[src*="captcha"]',
      'iframe[src*="challenge"]',
      'iframe[src*="verify"]',
      'iframe[src*="recaptcha"]',
      'iframe[src*="hcaptcha"]',
      '[id*="captcha"]',
      '[class*="captcha"]',
      '[id*="challenge"]',
      '[class*="challenge"]',
      'input[name*="captcha"]',
      'form[action*="captcha"]',
    ]

    for (const selector of selectors) {
      try {
        if (document.querySelector(selector)) {
          return { present: true, reason: `selector:${selector}` }
        }
      } catch (error) {}
    }

    return { present: false, reason: '' }
  }

  function detectLoginOrRiskState() {
    const href = String(location.href || '')
    const text = lowerText(`${document.title || ''}\n${document.body?.innerText || document.body?.textContent || ''}`)
    if (/\/user\/auth\/login/i.test(href)) return { present: true, reason: 'login_redirect' }
    if (/[?&](activity_sign|risk-id|login_force)=/i.test(href)) return { present: true, reason: 'risk_login_redirect' }
    if (/\bsign in\b|\blog in\b|登录|登入/.test(text)) return { present: true, reason: 'login_page' }
    return { present: false, reason: '' }
  }

  function buildVerificationTimeoutMessage(reason) {
    const text = String(reason || '').trim()
    return text ? `验证/登录等待超时: ${text}` : '验证/登录等待超时'
  }

  function pauseForCaptcha(resumePhase, sharedState, sleepMs = persistedRequestShared.requestedCaptchaWaitMs, reason = '') {
    return nextPhase('wait_verification', sleepMs, {
      ...sharedState,
      pause_reason: 'captcha',
      captcha_reason: reason || sharedState?.captcha_reason || 'captcha',
      resume_phase: resumePhase,
      captcha_wait_rounds: Number(sharedState?.captcha_wait_rounds || 0),
    })
  }

  function parseProductIdFromUrl(urlText) {
    const match = String(urlText || '').match(/-p-(\d+)\.html/i)
    return match ? match[1] : ''
  }

  function normalizeDetailUrl(rawHref) {
    const href = String(rawHref || '').trim()
    if (!href) return ''
    try {
      return new URL(href, location.href || persistedRequestShared.requestedSearchUrl).href
    } catch (error) {
      return href
    }
  }

  function normalizeProtocolUrl(urlText) {
    const raw = String(urlText || '').trim()
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    return raw
  }

  function isSheinHost(urlText) {
    try {
      const url = new URL(String(urlText || location.href || ''), persistedRequestShared.requestedSearchUrl)
      return /(^|\.)shein\.com$/i.test(url.hostname)
    } catch (error) {
      return false
    }
  }

  function getProductAnchors() {
    return [...document.querySelectorAll('a[href]')]
      .filter(anchor => /-p-\d+\.html/i.test(String(anchor.href || anchor.getAttribute?.('href') || '')))
      .filter(anchor => isVisible(anchor) || anchor.dataset?.id || anchor.dataset?.sku)
  }

  function isListPage() {
    const body = textOf(document.body)
    return isSheinHost(location.href) && (
      /\/Store\//i.test(String(location.href || '')) ||
      /PRODUCT LIST|Sort By|Filter/i.test(body) ||
      getProductAnchors().length > 0
    )
  }

  function formatMoneyFromDataset(value) {
    const text = String(value || '').trim()
    if (!text) return ''
    if (/^[A-Z]{3}\s+/i.test(text) || /^[$£€]/.test(text)) return text
    return text
  }

  function formatMoneyFromAny(value) {
    if (!value) return ''
    if (typeof value === 'object') {
      const money = pickAmount(value)
      return String(money.display || money.amount || '').trim()
    }
    return formatMoneyFromDataset(value)
  }

  function buildDetailUrlForGoodsId(baseUrl, goodsId) {
    const id = String(goodsId || '').trim()
    if (!id) return ''
    try {
      const url = new URL(String(baseUrl || location.href || persistedRequestShared.requestedSearchUrl), persistedRequestShared.requestedSearchUrl)
      if (/-p-\d+\.html/i.test(url.pathname)) {
        url.pathname = url.pathname.replace(/-p-\d+\.html/i, `-p-${id}.html`)
        return url.href
      }
    } catch (error) {}
    return ''
  }

  function resolveObjectDetailUrl(item, sourceUrl) {
    const direct = firstNonEmpty(
      item?.detail_url,
      item?.detailUrl,
      item?.goods_url,
      item?.goodsUrl,
      item?.url,
      item?.href,
      item?.link,
    )
    if (direct) {
      const normalized = normalizeDetailUrl(direct)
      if (/-p-\d+\.html/i.test(normalized)) return normalized
    }

    const goodsId = firstNonEmpty(item?.goods_id, item?.goodsId, item?.product_id, item?.id)
    const urlName = firstNonEmpty(item?.goods_url_name, item?.goodsUrlName, item?.url_name)
    if (goodsId && urlName) {
      const path = String(urlName).includes('-p-')
        ? String(urlName)
        : `${String(urlName).replace(/\.html$/i, '')}-p-${goodsId}.html`
      return normalizeDetailUrl(path.startsWith('/') ? path : `/${path}`)
    }

    return buildDetailUrlForGoodsId(sourceUrl, goodsId)
  }

  function productFromObject(item, sourceUrl, inherited = {}) {
    if (!item || typeof item !== 'object') return null
    const detailUrl = resolveObjectDetailUrl(item, sourceUrl || inherited.detail_url || '')
    const productId = String(firstNonEmpty(
      item.goods_id,
      item.goodsId,
      item.product_id,
      item.productId,
      item.id,
      parseProductIdFromUrl(detailUrl),
    ) || '').trim()
    if (!productId || !detailUrl) return null

    const salePrice = formatMoneyFromAny(firstNonEmpty(
      item.salePrice,
      item.sale_price,
      item.price,
      item.usPrice,
      item.priceInfo?.salePrice,
      item.mall_price?.[0]?.salePrice,
    ))
    const retailPrice = formatMoneyFromAny(firstNonEmpty(
      item.retailPrice,
      item.retail_price,
      item.originPrice,
      item.usOriginPrice,
      item.priceInfo?.retailPrice,
      item.mall_price?.[0]?.retailPrice,
    ))

    return {
      product_id: productId,
      detail_url: detailUrl,
      list_title: String(firstNonEmpty(item.goods_name, item.goodsName, item.title, item.name, inherited.list_title) || '').trim(),
      list_spu: String(firstNonEmpty(item.productRelationID, item.product_relation_id, item.spu, inherited.list_spu) || '').trim(),
      list_skc: String(firstNonEmpty(item.goods_sn, item.goodsSn, item.sku, item.skc, inherited.list_skc) || '').trim(),
      list_price: salePrice || String(inherited.list_price || '').trim(),
      list_original_price: retailPrice || String(inherited.list_original_price || '').trim(),
      list_discount: String(firstNonEmpty(item.discount, item.unitDiscount, item.priceInfo?.unitDiscount, inherited.list_discount) || '').trim(),
      cat_id: String(firstNonEmpty(item.cat_id, item.catId, inherited.cat_id) || '').trim(),
      store_code: String(firstNonEmpty(item.store_code, item.storeCode, inherited.store_code) || '').trim(),
      list_color: String(firstNonEmpty(item.attr_value, item.attrValue, item.color, inherited.list_color) || '').trim(),
      list_image: normalizeProtocolUrl(firstNonEmpty(item.goods_img, item.goods_image, item.goods_thumb, item.image, item.img, inherited.list_image) || ''),
      source_url: inherited.source_url || sourceUrl || '',
    }
  }

  function productFromAnchor(anchor, sourceUrl) {
    const dataset = anchor?.dataset || {}
    const detailUrl = normalizeDetailUrl(anchor?.href || anchor?.getAttribute?.('href') || '')
    const productId = String(dataset.id || dataset.goodsId || parseProductIdFromUrl(detailUrl) || '').trim()
    if (!productId || !detailUrl) return null
    const title = String(dataset.title || textOf(anchor) || '').replace(/^-\d+%\s*/, '').trim()
    return {
      product_id: productId,
      detail_url: detailUrl,
      list_title: title,
      list_spu: String(dataset.spu || '').trim(),
      list_skc: String(dataset.sku || dataset.skc || '').trim(),
      list_price: formatMoneyFromDataset(dataset.usPrice || dataset.price || dataset.salePrice || ''),
      list_original_price: formatMoneyFromDataset(dataset.usOriginPrice || dataset.originPrice || dataset.retailPrice || ''),
      list_discount: String(dataset.discount || '').trim(),
      cat_id: String(dataset.cat_id || dataset.catId || '').trim(),
      store_code: String(dataset.store_code || dataset.storeCode || '').trim(),
      source_url: sourceUrl,
    }
  }

  function mergeProductByKey(map, product) {
    if (!product) return
    const key = product.product_id || product.detail_url
    const existing = map.get(key)
    if (!existing) {
      map.set(key, product)
      return
    }
    map.set(key, {
      ...existing,
      ...Object.fromEntries(Object.entries(product).filter(([, value]) => String(value || '').trim())),
      list_title: existing.list_title || product.list_title,
      list_spu: existing.list_spu || product.list_spu,
      list_skc: existing.list_skc || product.list_skc,
      list_price: existing.list_price || product.list_price,
      list_original_price: existing.list_original_price || product.list_original_price,
    })
  }

  function collectProductsOnce(sourceUrl) {
    const map = new Map()
    for (const product of collectProductsFromKnownState(sourceUrl)) {
      mergeProductByKey(map, product)
    }
    for (const anchor of getProductAnchors()) {
      mergeProductByKey(map, productFromAnchor(anchor, sourceUrl))
    }
    return [...map.values()]
  }

  function looksLikeProductObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const hasId = firstNonEmpty(value.goods_id, value.goodsId, value.product_id, value.productId, value.id)
    if (!hasId) return false
    return !!firstNonEmpty(
      value.goods_sn,
      value.goodsSn,
      value.goods_url_name,
      value.goodsUrlName,
      value.detail_url,
      value.detailUrl,
      value.goods_name,
      value.goodsName,
      value.productRelationID,
      value.price,
      value.salePrice,
      value.priceInfo?.salePrice,
    )
  }

  function collectProductsDeep(root, sourceUrl, maxDepth = 7) {
    const products = []
    const seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null

    function visit(value, depth) {
      if (!value || typeof value !== 'object' || depth > maxDepth || products.length >= 1200) return
      if (seen) {
        if (seen.has(value)) return
        seen.add(value)
      }

      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1)
        return
      }

      if (looksLikeProductObject(value)) {
        const product = productFromObject(value, sourceUrl)
        if (product) products.push(product)
      }

      for (const [key, child] of Object.entries(value)) {
        if (child == null || typeof child !== 'object') continue
        if (/^(window|document|parent|top|opener|self)$/i.test(key)) continue
        visit(child, depth + 1)
      }
    }

    visit(root, 0)
    return products
  }

  function collectProductsFromKnownState(sourceUrl) {
    const roots = [
      window.gbRawData,
      window.__INITIAL_STATE__,
      window.__NUXT__,
      window.__NEXT_DATA__,
      window.__SHEIN_INITIAL_STATE__,
    ].filter(Boolean)
    const map = new Map()
    for (const root of roots) {
      for (const product of collectProductsDeep(root, sourceUrl)) {
        mergeProductByKey(map, product)
      }
    }
    return [...map.values()]
  }

  async function clickLoadMoreIfPresent() {
    const button = [...document.querySelectorAll('button')]
      .filter(isVisible)
      .find(item => /^(Load More|View More|Show More|More)$/i.test(textOf(item)))
    if (!button) return false
    try { button.click?.() } catch (error) {}
    await sleep(800)
    return true
  }

  async function collectProductsFromPage() {
    const sourceUrl = String(location.href || persistedRequestShared.requestedSearchUrl)
    const maxProducts = persistedRequestShared.requestedMaxProducts
    const maxScrollRounds = persistedRequestShared.requestedMaxScrollRounds
    const map = new Map()
    let stableRounds = 0
    let lastCount = -1

    for (let round = 0; round <= maxScrollRounds; round += 1) {
      for (const product of collectProductsOnce(sourceUrl)) {
        mergeProductByKey(map, product)
      }
      if (maxProducts > 0 && map.size >= maxProducts) break

      if (round >= maxScrollRounds) break

      const clicked = await clickLoadMoreIfPresent()
      try { window.scrollTo?.(0, Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0)) } catch (error) {}
      await sleep(clicked ? 900 : 700)

      if (map.size <= lastCount) stableRounds += 1
      else stableRounds = 0
      lastCount = map.size
      if (stableRounds >= 2) break
    }

    const products = [...map.values()]
    return (maxProducts > 0 ? products.slice(0, maxProducts) : products)
      .map((product, index) => ({
        ...product,
        序号: index + 1,
        source_url: product.source_url || sourceUrl,
      }))
  }

  function getProductQueueKey(product) {
    return String(product?.product_id || product?.list_skc || product?.detail_url || '').trim()
  }

  function mergeProductQueues(existingProducts, newProducts, maxProducts = persistedRequestShared.requestedMaxProducts) {
    const map = new Map()
    for (const product of normalizeProductQueue(existingProducts)) {
      mergeProductByKey(map, product)
    }
    const before = map.size
    for (const product of Array.isArray(newProducts) ? newProducts : []) {
      mergeProductByKey(map, product)
      if (maxProducts > 0 && map.size >= maxProducts) break
    }
    const products = [...map.values()]
      .slice(0, maxProducts > 0 ? maxProducts : undefined)
      .map((product, index) => ({ ...product, 序号: index + 1 }))
    return {
      products,
      added: Math.max(0, products.length - before),
    }
  }

  function getPageNumberFromUrl(urlText) {
    try {
      const url = new URL(String(urlText || ''), persistedRequestShared.requestedSearchUrl)
      const direct = Number(url.searchParams.get('page') || url.searchParams.get('pageNum') || url.searchParams.get('page_no') || '')
      if (Number.isFinite(direct) && direct > 0) return Math.floor(direct)
    } catch (error) {}
    return 0
  }

  function setPageNumberOnUrl(urlText, pageNo) {
    try {
      const url = new URL(String(urlText || persistedRequestShared.requestedSearchUrl), persistedRequestShared.requestedSearchUrl)
      url.searchParams.set('page', String(Math.max(1, Number(pageNo) || 1)))
      return url.href
    } catch (error) {
      return ''
    }
  }

  function detectCurrentListPageNo(fallback = 1) {
    const urlPage = getPageNumberFromUrl(location.href)
    if (urlPage > 0) return urlPage
    const active = [...document.querySelectorAll('[aria-current="page"], .active, [class*="active"], [class*="current"]')]
      .map(textOf)
      .map(text => Number((text.match(/\d+/) || [])[0] || 0))
      .find(num => Number.isFinite(num) && num > 0)
    return active || Math.max(1, Number(fallback || 1))
  }

  function getMaxPageNumberFromDom() {
    const nums = []
    for (const el of [...document.querySelectorAll('a[href], button, [role="button"]')]) {
      const textNum = Number((textOf(el).match(/^\s*(\d{1,3})\s*$/) || [])[1] || 0)
      if (Number.isFinite(textNum) && textNum > 0) nums.push(textNum)
      const hrefPage = getPageNumberFromUrl(el.href || el.getAttribute?.('href') || '')
      if (hrefPage > 0) nums.push(hrefPage)
      const labelNum = Number((String(el.getAttribute?.('aria-label') || '').match(/(\d{1,3})/) || [])[1] || 0)
      if (Number.isFinite(labelNum) && labelNum > 0) nums.push(labelNum)
    }
    return nums.length ? Math.max(...nums) : 0
  }

  function getTotalPagesFromKnownState() {
    const roots = [window.gbRawData, window.__INITIAL_STATE__, window.__SHEIN_INITIAL_STATE__].filter(Boolean)
    const seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null
    let maxPage = 0

    function visit(value, depth) {
      if (!value || typeof value !== 'object' || depth > 6) return
      if (seen) {
        if (seen.has(value)) return
        seen.add(value)
      }
      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1)
        return
      }
      for (const [key, raw] of Object.entries(value)) {
        if (/^(total_?pages?|page_?total|pages)$/i.test(key)) {
          const num = Number(raw)
          if (Number.isFinite(num) && num > maxPage) maxPage = Math.floor(num)
        }
        if (raw && typeof raw === 'object') visit(raw, depth + 1)
      }
    }

    for (const root of roots) visit(root, 0)
    return maxPage
  }

  function findExplicitNextPageUrl(currentPageNo) {
    const nextPage = Math.max(1, Number(currentPageNo || 1)) + 1
    const anchors = [...document.querySelectorAll('a[href]')].filter(isVisible)
    const nextByRel = anchors.find(anchor => /next/i.test(String(anchor.getAttribute?.('rel') || anchor.getAttribute?.('aria-label') || textOf(anchor) || '')))
    if (nextByRel?.href) return normalizeDetailUrl(nextByRel.href)
    const nextByPage = anchors.find(anchor => {
      const hrefPage = getPageNumberFromUrl(anchor.href || anchor.getAttribute?.('href') || '')
      const textPage = Number((textOf(anchor).match(/^\s*(\d{1,3})\s*$/) || [])[1] || 0)
      return hrefPage === nextPage || textPage === nextPage
    })
    return nextByPage?.href ? normalizeDetailUrl(nextByPage.href) : ''
  }

  function resolveNextListPageUrl(currentPageNo, productsOnPage) {
    const maxListPages = persistedRequestShared.requestedMaxListPages
    if (currentPageNo >= maxListPages) return ''

    const explicitUrl = findExplicitNextPageUrl(currentPageNo)
    if (explicitUrl) return explicitUrl

    const knownTotalPages = Math.max(getTotalPagesFromKnownState(), getMaxPageNumberFromDom())
    if (knownTotalPages > 0 && currentPageNo >= knownTotalPages) return ''

    if ((knownTotalPages > currentPageNo || maxListPages > currentPageNo) && (productsOnPage || []).length) {
      return setPageNumberOnUrl(location.href || persistedRequestShared.requestedSearchUrl, currentPageNo + 1)
    }
    return ''
  }

  function buildListProgressShared(products, listPageNo, next = shared) {
    return {
      ...next,
      products,
      list_page_no: listPageNo,
      total_rows: products.length,
      total_batches: products.length,
      current_exec_no: 0,
      batch_no: 0,
      current_store: `SHEIN 列表页 ${listPageNo} / 已收集 ${products.length} 个商品`,
    }
  }

  function normalizeProductQueue(raw) {
    return (Array.isArray(raw) ? raw : [])
      .map(item => item && typeof item === 'object' ? item : null)
      .filter(Boolean)
      .filter(item => String(item.detail_url || '').trim())
  }

  function getCurrentProduct() {
    const products = normalizeProductQueue(shared.products)
    const index = Math.max(0, Number(shared.detail_index || 0))
    return { products, index, product: products[index] || null }
  }

  function getDetailPacingMs(index = 0) {
    const base = persistedRequestShared.requestedDetailDelayMs
    const burstCooldown = index > 0 && index % 12 === 0 ? Math.max(base * 4, 12000) : 0
    return withJitter(base + burstCooldown, 0.28)
  }

  function detailUrlMatchToken(product) {
    const productId = String(product?.product_id || parseProductIdFromUrl(product?.detail_url) || '').trim()
    if (productId) return `-p-${productId}.html`
    try {
      return new URL(product?.detail_url || '').pathname
    } catch (error) {
      return String(product?.detail_url || '').slice(0, 120)
    }
  }

  function firstNonEmpty(...values) {
    for (const value of values) {
      if (value != null && String(value).trim() !== '') return value
    }
    return ''
  }

  function pickAmount(value) {
    if (!value || typeof value !== 'object') return { display: String(value || '').trim(), amount: String(value || '').trim(), currency: '' }
    return {
      display: String(firstNonEmpty(value.amountWithSymbol, value.usdAmountWithSymbol, value.amount, value.usdAmount) || '').trim(),
      amount: String(firstNonEmpty(value.amount, value.usdAmount) || '').trim(),
      currency: String(value.currency || '').trim(),
    }
  }

  function firstMoney(...values) {
    for (const value of values) {
      const picked = pickAmount(value)
      if (picked.display || picked.amount) return picked
    }
    return { display: '', amount: '', currency: '' }
  }

  function findHtmlMatch(captureResult, product) {
    const matches = Array.isArray(captureResult?.matches) ? captureResult.matches : []
    const token = detailUrlMatchToken(product)
    return matches.find(match =>
      String(match?.mimeType || '').includes('text/html') &&
      String(match?.body || '').includes('window.gbRawData') &&
      (!token || String(match?.responseUrl || match?.url || '').includes(token))
    ) || matches.find(match =>
      String(match?.body || '').includes('window.gbRawData')
    ) || null
  }

  function parseRealtimeApiRaw(body) {
    let payload = null
    try {
      payload = JSON.parse(String(body || ''))
    } catch (error) {
      return null
    }
    if (String(payload?.code ?? '') !== '0' || !payload?.info || typeof payload.info !== 'object') return null
    return { modules: payload.info }
  }

  function findRealtimeApiMatch(captureResult, product) {
    const matches = Array.isArray(captureResult?.matches) ? captureResult.matches : []
    const productId = String(product?.product_id || '').trim()
    return matches.find(match => {
      const url = String(match?.responseUrl || match?.url || '')
      if (!url.includes('/bff-api/product/get_goods_detail_realtime_data')) return false
      if (productId && !url.includes(`goods_id=${productId}`)) return false
      return !!parseRealtimeApiRaw(match?.body)
    }) || null
  }

  function findProtectionMatch(captureResult) {
    const matches = Array.isArray(captureResult?.matches) ? captureResult.matches : []
    return matches.find(match => detectProtectionText(`${match?.responseUrl || match?.url || ''}\n${match?.body || ''}`).present) || null
  }

  function extractAssignedJsonObject(html, marker) {
    const source = String(html || '')
    const markerIndex = source.indexOf(marker)
    if (markerIndex < 0) return null
    const eqIndex = source.indexOf('=', markerIndex + marker.length)
    if (eqIndex < 0) return null
    const start = source.indexOf('{', eqIndex)
    if (start < 0) return null

    let depth = 0
    let inString = false
    let escape = false
    for (let i = start; i < source.length; i += 1) {
      const ch = source[i]
      if (inString) {
        if (escape) {
          escape = false
        } else if (ch === '\\') {
          escape = true
        } else if (ch === '"') {
          inString = false
        }
        continue
      }

      if (ch === '"') {
        inString = true
      } else if (ch === '{') {
        depth += 1
      } else if (ch === '}') {
        depth -= 1
        if (depth === 0) return source.slice(start, i + 1)
      }
    }
    return null
  }

  function parseDetailRawData(html) {
    const jsonText = extractAssignedJsonObject(html, 'window.gbRawData')
    if (!jsonText) return null
    try {
      return JSON.parse(jsonText)
    } catch (error) {
      return null
    }
  }

  function getColorFromDetails(productInfo) {
    const details = [
      ...(Array.isArray(productInfo?.productDescriptionInfo?.productDetails) ? productInfo.productDescriptionInfo.productDetails : []),
      ...(Array.isArray(productInfo?.productDescriptionInfo?.completeProductDetails) ? productInfo.productDescriptionInfo.completeProductDetails : []),
    ]
    const color = details.find(item => /color/i.test(String(item?.attr_name_en || item?.attr_name || '')))
    return String(color?.attr_value || color?.attr_value_en || '').trim()
  }

  function buildSkuPriceDetails(skuList) {
    const rows = []
    const seen = new Set()
    for (const sku of Array.isArray(skuList) ? skuList : []) {
      const attrs = Array.isArray(sku?.sku_sale_attr) ? sku.sku_sale_attr : []
      const label = attrs.map(attr => String(attr?.attr_value_name || attr?.attr_value_name_en || attr?.attr_value || '').trim()).filter(Boolean).join('/')
      const money = firstMoney(
        sku?.priceInfo?.salePrice,
        sku?.price?.salePrice,
        Array.isArray(sku?.mall_price) ? sku.mall_price[0]?.salePrice : null,
      )
      const text = [label || sku?.sku_code || '', money.display || money.amount].filter(Boolean).join(': ')
      if (!text || seen.has(text)) continue
      seen.add(text)
      rows.push(text)
      if (rows.length >= 30) break
    }
    return rows.join('; ')
  }

  function buildDetailFromRaw(raw, product, priceSource = '商详页') {
    if (!raw) {
      return { error: '商详页未解析到 gbRawData' }
    }
    const modules = raw.modules || {}
    const productInfo = modules.productInfo || {}
    const saleAttr = modules.saleAttr || {}
    const priceInfo = modules.priceInfo || {}
    const mainInfo = Array.isArray(saleAttr?.mainSaleAttribute?.info) ? saleAttr.mainSaleAttribute.info : []
    const productId = String(product?.product_id || '').trim()
    const currentGoodsId = String(productInfo.goods_id || '').trim()
    const mainItem = mainInfo.find(item => String(item?.goods_id || '') === productId) ||
      mainInfo.find(item => String(item?.goods_id || '') === currentGoodsId) ||
      mainInfo.find(item => String(item?.goods_sn || '') === String(productInfo.goods_sn || '')) ||
      mainInfo[0] ||
      {}
    const skuList = Array.isArray(saleAttr?.multiLevelSaleAttribute?.sku_list)
      ? saleAttr.multiLevelSaleAttribute.sku_list
      : []

    const salePrice = firstMoney(
      priceInfo.salePrice,
      skuList[0]?.priceInfo?.salePrice,
      skuList[0]?.price?.salePrice,
      Array.isArray(skuList[0]?.mall_price) ? skuList[0].mall_price[0]?.salePrice : null,
    )
    const retailPrice = firstMoney(
      priceInfo.retailPrice,
      skuList[0]?.priceInfo?.retailPrice,
      skuList[0]?.price?.retailPrice,
      Array.isArray(skuList[0]?.mall_price) ? skuList[0].mall_price[0]?.retailPrice : null,
    )
    const showPrice = firstMoney(
      priceInfo.showPrice,
      skuList[0]?.price?.showPrice,
      Array.isArray(skuList[0]?.mall_price) ? skuList[0].mall_price[0]?.showPrice : null,
    )

    return {
      goods_id: firstNonEmpty(productInfo.goods_id, mainItem.goods_id, product?.product_id),
      skc: firstNonEmpty(productInfo.goods_sn, mainItem.goods_sn, saleAttr?.multiLevelSaleAttribute?.goods_sn, product?.list_skc),
      spu: firstNonEmpty(productInfo.productRelationID, product?.list_spu),
      title: firstNonEmpty(productInfo.goods_name, productInfo.goods_name_en, productInfo.title, product?.list_title),
      color: firstNonEmpty(mainItem.attr_value, getColorFromDetails(productInfo)),
      cat_id: firstNonEmpty(productInfo.cat_id, mainItem.cat_id, product?.cat_id),
      category: firstNonEmpty(productInfo.cate_name),
      image: normalizeProtocolUrl(firstNonEmpty(productInfo.goods_img, productInfo.goods_thumb, mainItem.goods_image, mainItem.goods_color_image)),
      sale_price: salePrice,
      retail_price: retailPrice,
      show_price: showPrice,
      discount: firstNonEmpty(priceInfo.unitDiscount, priceInfo.discountValue, skuList[0]?.priceInfo?.unitDiscount, skuList[0]?.price?.unit_discount),
      stock: firstNonEmpty(productInfo.stock),
      is_on_sale: firstNonEmpty(productInfo.is_on_sale),
      store_code: firstNonEmpty(modules.storeInfo?.store_code, product?.store_code),
      store_name: firstNonEmpty(modules.storeInfo?.title),
      sku_price_details: buildSkuPriceDetails(skuList),
      price_source: priceSource,
    }
  }

  function getMainSaleItems(raw) {
    const info = raw?.modules?.saleAttr?.mainSaleAttribute?.info
    return Array.isArray(info) ? info.filter(item => item && typeof item === 'object') : []
  }

  function discoverSiblingSkcProducts(raw, product) {
    const productInfo = raw?.modules?.productInfo || {}
    const inherited = {
      ...product,
      list_title: firstNonEmpty(productInfo.goods_name, product?.list_title),
      list_spu: firstNonEmpty(productInfo.productRelationID, product?.list_spu),
      cat_id: firstNonEmpty(productInfo.cat_id, product?.cat_id),
      store_code: firstNonEmpty(raw?.modules?.storeInfo?.store_code, product?.store_code),
      source_url: product?.source_url || persistedRequestShared.requestedSearchUrl,
    }
    return getMainSaleItems(raw)
      .map(item => productFromObject(item, product?.detail_url || location.href, inherited))
      .filter(Boolean)
  }

  function expandProductQueueWithDetailRaw(products, raw, product) {
    const discovered = discoverSiblingSkcProducts(raw, product)
    if (!discovered.length) return { products, added: 0 }
    return mergeProductQueues(products, discovered)
  }

  function buildDetailFromHtml(html, product) {
    const raw = parseDetailRawData(html)
    return buildDetailFromRaw(raw, product)
  }

  function buildFailureRow(product, errorMessage) {
    const fallbackPrice = String(product?.list_price || '').trim()
    const fallbackOriginalPrice = String(product?.list_original_price || '').trim()
    return {
      序号: product?.序号 || '',
      商品ID: product?.product_id || '',
      SPU: product?.list_spu || '',
      SKC: product?.list_skc || '',
      商品名称: product?.list_title || '',
      颜色: '',
      价格: fallbackPrice,
      价格数值: fallbackPrice.replace(/[^\d.]/g, ''),
      原价: fallbackOriginalPrice,
      展示价: fallbackPrice,
      折扣: product?.list_discount || '',
      币种: '',
      库存: '',
      店铺ID: product?.store_code || '',
      店铺名称: '',
      类目ID: product?.cat_id || '',
      类目: '',
      图片: '',
      商品链接: product?.detail_url || '',
      来源列表URL: product?.source_url || '',
      列表页价格: fallbackPrice,
      列表页原价: fallbackOriginalPrice,
      价格来源: fallbackPrice ? '列表页兜底' : '商详页解析失败',
      商详抓取状态: String(errorMessage || '商详页解析失败'),
      尺码价格明细: '',
    }
  }

  function buildExportRow(product, detail) {
    if (detail?.error) return buildFailureRow(product, detail.error)
    const salePrice = detail.sale_price || {}
    const retailPrice = detail.retail_price || {}
    const showPrice = detail.show_price || {}
    return {
      序号: product?.序号 || '',
      商品ID: detail.goods_id || product?.product_id || '',
      SPU: detail.spu || product?.list_spu || '',
      SKC: detail.skc || product?.list_skc || '',
      商品名称: detail.title || product?.list_title || '',
      颜色: detail.color || '',
      价格: salePrice.display || salePrice.amount || '',
      价格数值: salePrice.amount || '',
      原价: retailPrice.display || retailPrice.amount || '',
      展示价: showPrice.display || showPrice.amount || '',
      折扣: detail.discount ? `${detail.discount}%` : (product?.list_discount ? `${product.list_discount}%` : ''),
      币种: salePrice.currency || '',
      库存: detail.stock || '',
      店铺ID: detail.store_code || product?.store_code || '',
      店铺名称: detail.store_name || '',
      类目ID: detail.cat_id || product?.cat_id || '',
      类目: detail.category || '',
      图片: detail.image || '',
      商品链接: product?.detail_url || '',
      来源列表URL: product?.source_url || '',
      列表页价格: product?.list_price || '',
      列表页原价: product?.list_original_price || '',
      价格来源: detail.price_source || '商详页',
      商详抓取状态: '成功',
      尺码价格明细: detail.sku_price_details || '',
    }
  }

  function completeDetailRow(product, detail, products, index, next = shared) {
    const row = buildExportRow(product, detail)
    const nextIndex = index + 1
    const hasMore = nextIndex < products.length

    return complete([row], hasMore, {
      ...next,
      products,
      detail_index: nextIndex,
      [CAPTURE_KEY]: null,
      detail_capture_retries: 0,
      total_rows: products.length,
      total_batches: products.length,
      current_exec_no: nextIndex,
      batch_no: nextIndex,
      current_store: `SHEIN 搜索结果 ${nextIndex}/${products.length}`,
      pause_reason: '',
      captcha_reason: '',
      captcha_wait_rounds: 0,
      resume_phase: '',
    })
  }

  function processCapturedDetail() {
    const { products, index, product } = getCurrentProduct()
    if (!product) return complete([], false, { ...shared, products, detail_index: index })

    const apiMatch = findRealtimeApiMatch(shared[CAPTURE_KEY], product)
    const match = findHtmlMatch(shared[CAPTURE_KEY], product)
    const protectionMatch = findProtectionMatch(shared[CAPTURE_KEY])
    if (!apiMatch && !match && protectionMatch) {
      const protection = detectProtectionText(`${protectionMatch.responseUrl || protectionMatch.url || ''}\n${protectionMatch.body || ''}`)
      return nextPhase('open_manual_verification', 0, {
        ...shared,
        products,
        detail_index: index,
        [CAPTURE_KEY]: null,
        pause_reason: 'captcha',
        captcha_reason: protection.reason || 'detail_protection',
        resume_phase: 'process_manual_detail',
        captcha_wait_rounds: 0,
      })
    }

    if (!apiMatch && !match) {
      const retryCount = Number(shared.detail_capture_retries || 0)
      if (retryCount < persistedRequestShared.requestedMaxDetailRetries) {
        return nextPhase('request_detail_capture', withJitter(persistedRequestShared.requestedRetryCooldownMs, 0.3), {
          ...shared,
          products,
          detail_index: index,
          [CAPTURE_KEY]: null,
          detail_capture_retries: retryCount + 1,
          detail_capture_error: 'no_detail_html_match',
        })
      }
      return nextPhase('open_manual_verification', 0, {
        ...shared,
        products,
        detail_index: index,
        [CAPTURE_KEY]: null,
        pause_reason: 'manual_detail',
        captcha_reason: 'detail_capture_failed',
        resume_phase: 'process_manual_detail',
        captcha_wait_rounds: 0,
      })
    }

    const raw = apiMatch
      ? parseRealtimeApiRaw(apiMatch.body)
      : parseDetailRawData(String(match.body || ''))
    const expanded = expandProductQueueWithDetailRaw(products, raw, product)
    const expandedProducts = expanded.products || products
    const detail = buildDetailFromRaw(raw, product, apiMatch ? '商详 API' : '商详页')
    const sourceBody = String((apiMatch || match)?.body || '')
    if (detail?.error && detectProtectionText(sourceBody).present) {
      return nextPhase('open_manual_verification', 0, {
        ...shared,
        products: expandedProducts,
        detail_index: index,
        [CAPTURE_KEY]: null,
        pause_reason: 'captcha',
        captcha_reason: detectProtectionText(sourceBody).reason || 'detail_protection',
        resume_phase: 'process_manual_detail',
        captcha_wait_rounds: 0,
      })
    }

    return completeDetailRow(product, detail, expandedProducts, index, {
      ...shared,
      skc_expanded_total: Number(shared.skc_expanded_total || 0) + Number(expanded.added || 0),
    })
  }

  function processManualDetail() {
    const captcha = detectCaptchaState()
    if (captcha.present) {
      return pauseForCaptcha('process_manual_detail', shared, withJitter(persistedRequestShared.requestedCaptchaWaitMs, 0.25), captcha.reason)
    }

    const { products, index, product } = getCurrentProduct()
    if (!product) return complete([], false, { ...shared, products, detail_index: index })
    const expanded = expandProductQueueWithDetailRaw(products, window.gbRawData, product)
    const expandedProducts = expanded.products || products
    const detail = buildDetailFromRaw(window.gbRawData, product)
    if (detail?.error) {
      const rounds = Number(shared.captcha_wait_rounds || 0)
      if (rounds >= persistedRequestShared.requestedMaxVerificationWaitRounds) {
        return completeDetailRow(product, { error: buildVerificationTimeoutMessage('waiting_detail_raw_data') }, expandedProducts, index, shared)
      }
      return nextPhase('wait_verification', withJitter(persistedRequestShared.requestedCaptchaWaitMs, 0.25), {
        ...shared,
        products: expandedProducts,
        detail_index: index,
        pause_reason: 'manual_detail',
        captcha_reason: 'waiting_detail_raw_data',
        resume_phase: 'process_manual_detail',
        captcha_wait_rounds: Number(shared.captcha_wait_rounds || 0),
      })
    }
    return completeDetailRow(product, detail, expandedProducts, index, {
      ...shared,
      skc_expanded_total: Number(shared.skc_expanded_total || 0) + Number(expanded.added || 0),
    })
  }

  try {
    if (phase === 'main') {
      const existingProducts = normalizeProductQueue(shared.products)
      const detailIndex = Math.max(0, Number(shared.detail_index || 0))
      if (existingProducts.length && detailIndex < existingProducts.length) {
        return nextPhase('request_detail_capture', getDetailPacingMs(detailIndex), {
          ...shared,
          products: existingProducts,
          detail_index: detailIndex,
        })
      }
      if (existingProducts.length && detailIndex >= existingProducts.length) {
        return complete([], false, shared)
      }

      if (!isListPage()) {
        location.href = persistedRequestShared.requestedSearchUrl
        return nextPhase('main', 1800, { ...shared, navigated_to_search_url: true })
      }

      return nextPhase('collect_list_page', 0, {
        ...shared,
        products: [],
        list_page_no: detectCurrentListPageNo(1),
        source_url: String(location.href || persistedRequestShared.requestedSearchUrl),
      })
    }

    if (phase === 'collect_list_page') {
      if (!isListPage()) {
        location.href = shared.next_list_url || persistedRequestShared.requestedSearchUrl
        return nextPhase('collect_list_page', 1800, shared)
      }

      const currentListPageNo = detectCurrentListPageNo(shared.list_page_no || 1)
      const productsOnPage = await collectProductsFromPage()
      const existingProducts = normalizeProductQueue(shared.products)
      const merged = mergeProductQueues(existingProducts, productsOnPage)
      if (!merged.products.length) {
        return fail('未在 SHEIN 搜索结果页识别到商品卡片，请确认当前页面已加载商品列表')
      }

      const maxProducts = persistedRequestShared.requestedMaxProducts
      const reachedProductLimit = maxProducts > 0 && merged.products.length >= maxProducts
      const noNewProducts = existingProducts.length > 0 && Number(merged.added || 0) === 0
      const nextListUrl = (!reachedProductLimit && !noNewProducts)
        ? resolveNextListPageUrl(currentListPageNo, productsOnPage)
        : ''

      if (nextListUrl) {
        location.href = nextListUrl
        return nextPhase('collect_list_page', DEFAULT_LIST_PAGE_DELAY_MS, {
          ...buildListProgressShared(merged.products, currentListPageNo + 1, shared),
          list_collection_done: false,
          next_list_url: nextListUrl,
          source_url: shared.source_url || String(location.href || persistedRequestShared.requestedSearchUrl),
        })
      }

      const products = merged.products.map((product, index) => ({ ...product, 序号: index + 1 }))
      return nextPhase('request_detail_capture', getDetailPacingMs(0), {
        ...buildListProgressShared(products, currentListPageNo, shared),
        list_collection_done: true,
        detail_index: 0,
        source_url: shared.source_url || String(location.href || persistedRequestShared.requestedSearchUrl),
        total_rows: products.length,
        total_batches: products.length,
        current_exec_no: 0,
        batch_no: 0,
        current_store: `SHEIN 搜索结果 0/${products.length}`,
      })
    }

    if (phase === 'request_detail_capture') {
      const { products, index, product } = getCurrentProduct()
      if (!product) return complete([], false, { ...shared, products, detail_index: index })

      const matchToken = detailUrlMatchToken(product)
      return captureUrlRequests(product.detail_url, 'process_detail_capture', {
        matches: [
          { url_contains: '/bff-api/product/get_goods_detail_realtime_data', mime_type_contains: 'application/json' },
          ...(matchToken ? [{ url_contains: matchToken, mime_type_contains: 'text/html' }] : [{ mime_type_contains: 'text/html' }]),
        ],
        timeout_ms: 22000,
        settle_ms: 1800,
        min_matches: 1,
        shared_key: CAPTURE_KEY,
        include_response_body: true,
      }, {
        ...shared,
        products,
        detail_index: index,
        current_store: `SHEIN 商详 ${index + 1}/${products.length}`,
        current_exec_no: index,
        total_rows: products.length,
        total_batches: products.length,
        batch_no: index + 1,
      })
    }

    if (phase === 'process_detail_capture') {
      return processCapturedDetail()
    }

    if (phase === 'open_manual_verification') {
      const { products, index, product } = getCurrentProduct()
      if (!product) return complete([], false, { ...shared, products, detail_index: index })
      if (parseProductIdFromUrl(location.href) !== String(product.product_id || '')) {
        location.href = product.detail_url
      }
      return nextPhase('wait_verification', withJitter(persistedRequestShared.requestedCaptchaWaitMs, 0.25), {
        ...shared,
        products,
        detail_index: index,
        pause_reason: shared.pause_reason || 'captcha',
        captcha_reason: shared.captcha_reason || 'manual_verification_required',
        resume_phase: 'process_manual_detail',
        captcha_wait_rounds: Number(shared.captcha_wait_rounds || 0),
        manual_verification_url: product.detail_url,
      })
    }

    if (phase === 'wait_verification') {
      const captcha = detectCaptchaState()
      const loginOrRisk = detectLoginOrRiskState()
      const rounds = Number(shared.captcha_wait_rounds || 0) + 1
      const timeoutReason = captcha.present
        ? captcha.reason
        : (loginOrRisk.present ? loginOrRisk.reason : 'waiting_detail_raw_data')
      if (rounds >= persistedRequestShared.requestedMaxVerificationWaitRounds) {
        const { products, index, product } = getCurrentProduct()
        if (product) {
          return completeDetailRow(product, { error: buildVerificationTimeoutMessage(timeoutReason) }, products, index, {
            ...shared,
            products,
            detail_index: index,
          })
        }
      }
      if (captcha.present) {
        return nextPhase('wait_verification', withJitter(rounds < 3 ? persistedRequestShared.requestedCaptchaWaitMs : Math.max(persistedRequestShared.requestedCaptchaWaitMs, 8000), 0.25), {
          ...shared,
          pause_reason: 'captcha',
          captcha_reason: captcha.reason,
          captcha_wait_rounds: rounds,
        })
      }
      if (!window.gbRawData?.modules?.productInfo) {
        return nextPhase('wait_verification', withJitter(persistedRequestShared.requestedCaptchaWaitMs, 0.25), {
          ...shared,
          pause_reason: loginOrRisk.present ? 'login_or_risk' : (shared.pause_reason || 'manual_detail'),
          captcha_reason: timeoutReason,
          captcha_wait_rounds: rounds,
        })
      }
      return nextPhase(String(shared.resume_phase || 'process_manual_detail'), 300, {
        ...shared,
        pause_reason: '',
        captcha_reason: '',
        captcha_wait_rounds: 0,
      })
    }

    if (phase === 'process_manual_detail') {
      return processManualDetail()
    }

    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || error)
  }
})()
