;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const DEFAULT_SOURCE_URL = 'https://www.macys.com/shop/kids-baby/shoes/Pageindex/2?id=48561'
  const BRAND_SHEET = '品牌维度'
  const CATEGORY_SHEET = '品类维度'
  const DETAIL_SHEET = '产品明细'
  const NON_SHOE_CATEGORY = '非鞋类/广告商品'

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  function toInt(value, fallback, min, max) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    const integer = Math.floor(parsed)
    if (Number.isFinite(min) && integer < min) return min
    if (Number.isFinite(max) && integer > max) return max
    return integer
  }

  function boolParam(value, fallback = false) {
    if (value == null || value === '') return fallback
    if (typeof value === 'boolean') return value
    return /^(?:1|true|yes|y|on)$/i.test(String(value).trim())
  }

  function absoluteUrl(raw, fallbackBase = DEFAULT_SOURCE_URL) {
    let text = compact(raw)
    if (!text) return ''
    if (text.startsWith('//')) text = `https:${text}`
    try {
      return new URL(text, fallbackBase).href
    } catch (error) {
      return text
    }
  }

  function decodeHtml(value) {
    const text = String(value == null ? '' : value)
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const textarea = document.createElement('textarea')
      textarea.innerHTML = text
      return textarea.value
    }
    return text
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
  }

  function stripTags(value) {
    return compact(decodeHtml(String(value || '').replace(/<[^>]*>/g, ' ')))
  }

  function extractAttr(html, attrName) {
    const pattern = new RegExp(`${attrName}\\s*=\\s*["']([^"']+)["']`, 'i')
    const match = String(html || '').match(pattern)
    return match ? decodeHtml(match[1]) : ''
  }

  function extractClassText(html, classPattern) {
    const pattern = new RegExp(`<[^>]+class=["'][^"']*(?:${classPattern})[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i')
    const match = String(html || '').match(pattern)
    return match ? stripTags(match[1]) : ''
  }

  function extractFirstMoneyAfter(text, labelPattern) {
    const pattern = new RegExp(`${labelPattern}[^$]{0,40}\\$\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i')
    const match = compact(text).match(pattern)
    return match ? parseMoney(match[1]) : null
  }

  function parseMoney(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return roundMoney(value)
    const text = compact(value)
    if (!text) return null
    const normalized = text.replace(/[^\d.-]/g, '')
    if (!normalized) return null
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? roundMoney(parsed) : null
  }

  function roundMoney(value) {
    return Math.round(Number(value) * 100) / 100
  }

  function extractDiscountPercent(value) {
    const text = compact(value)
    if (!text) return null
    const match = text.match(/(\d+(?:\.\d+)?)\s*%\s*off/i) || text.match(/\((\d+(?:\.\d+)?)\s*%\)/i)
    if (!match) return null
    const parsed = Number(match[1])
    return Number.isFinite(parsed) ? Math.round(parsed) : null
  }

  function parsePriceDetails(value) {
    const text = compact(value)
    const moneyValues = [...text.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/g)]
      .map(match => parseMoney(match[1]))
      .filter(item => item != null)
    const discountPercent = extractDiscountPercent(text)
    let salePrice =
      extractFirstMoneyAfter(text, '(?:Current price|Now|Sale|Final price|With offer)') ??
      (moneyValues.length >= 2 && moneyValues[0] > moneyValues[1] ? moneyValues[1] : moneyValues[0] ?? null)
    let originalPrice = extractFirstMoneyAfter(text, '(?:Reg\\.?|Orig\\.?|Original|Was|List price)')

    if (originalPrice == null && moneyValues.length >= 2 && moneyValues[0] > moneyValues[1]) {
      originalPrice = moneyValues[0]
    }
    if (salePrice == null && originalPrice != null) salePrice = originalPrice
    if (originalPrice == null && salePrice != null && discountPercent != null && discountPercent > 0 && discountPercent < 100) {
      originalPrice = roundMoney(salePrice / (1 - discountPercent / 100))
    }
    if (originalPrice == null) originalPrice = salePrice

    let normalizedDiscount = discountPercent
    if (normalizedDiscount == null && originalPrice != null && salePrice != null && originalPrice > salePrice) {
      normalizedDiscount = Math.round((1 - salePrice / originalPrice) * 100)
    }

    return {
      originalPrice,
      salePrice,
      discountPercent: normalizedDiscount,
    }
  }

  function inferAge(productName) {
    const text = compact(productName)
    if (/\bbig\s+kid(?:s)?\b|\bbig\s+(?:boys?|girls?)\b/i.test(text)) return 'Big Kid'
    if (/\blittle\s+kid(?:s)?\b|\blittle\s+(?:boys?|girls?)\b/i.test(text)) return 'Little Kid'
    if (/\btoddler(?:s)?\b|\btoddler\s+(?:boys?|girls?)\b/i.test(text)) return 'Toddler'
    if (/\bbaby\b|\binfant\b|\bcrib\b|\bfirst\s+walker\b/i.test(text)) return 'Baby'
    if (/\bkids?\b|\bboys?\b|\bgirls?\b|\bchildren\b/i.test(text)) return 'Kids'
    return '未标注'
  }

  function inferCategory(productName) {
    const text = compact(productName)
    if (/\b(?:romper|bodysuit|shortall|rashguard|trunk|t-?shirt|tee|shorts?|diaper|sleeveless|top|set|dress|pajama|onesie)\b/i.test(text)) {
      return NON_SHOE_CATEGORY
    }
    if (/\b(?:sandal|sandals|slide|slides|flip[-\s]?flop|fisherman)\b/i.test(text)) return 'Sandals'
    if (/\b(?:boot|boots|bootie|booties|rain\s*boot|snow\s*boot|hiker|hiking)\b/i.test(text)) return 'Boots'
    if (/\b(?:clog|clogs|crocs?)\b/i.test(text)) return 'Clogs'
    if (/\b(?:slipper|slippers|moccasin)\b/i.test(text)) return 'Slippers'
    if (/\b(?:loafer|loafers|oxford|mary\s*jane|ballet|flat|flats|dress\s+shoe|dress\s+shoes)\b/i.test(text)) return 'Dress Shoes/Flats'
    if (/\b(?:water\s+shoe|aqua\s+sock|swim\s+shoe)\b/i.test(text)) return 'Water Shoes'
    if (/\b(?:sneaker|sneakers|trainer|trainers|running|runner|athletic|court|tennis|basketball|jordan|air\s+max|air\s+force|skate|shoe|shoes)\b/i.test(text)) return 'Sneakers'
    return 'Other Shoes'
  }

  function nodeText(root, selector) {
    try {
      return compact(root.querySelector(selector)?.innerText || root.querySelector(selector)?.textContent || '')
    } catch (error) {
      return ''
    }
  }

  function closestProductContainer(thumb) {
    if (!thumb) return null
    if (typeof thumb.closest === 'function') {
      return thumb.closest('.product-thumbnail-container') || thumb.closest('li') || thumb.parentElement
    }
    return thumb.parentElement || null
  }

  function imageFromElement(root) {
    if (!root || typeof root.querySelector !== 'function') return ''
    const image = root.querySelector('img')
    const sources = [...(root.querySelectorAll?.('source[srcset]') || [])]
    const candidates = [
      image?.currentSrc ||
      image?.src ||
      '',
      image?.getAttribute?.('data-src') ||
      '',
      image?.getAttribute?.('src') ||
      '',
      ...sources.map(source => source?.getAttribute?.('srcset') || ''),
    ]
      .map(raw => absoluteUrl(String(raw || '').split(/\s+/)[0]))
      .filter(Boolean)
    return candidates.find(url => /^https?:\/\//i.test(url)) || candidates[0] || ''
  }

  function linkFromElement(root) {
    if (!root || typeof root.querySelector !== 'function') return ''
    const link = root.querySelector('a[href*="/shop/product/"][href*="ID="]') || root.querySelector('a[href*="ID="]')
    return absoluteUrl(link?.href || link?.getAttribute?.('href') || '')
  }

  function productIdFromUrl(value) {
    const text = compact(value)
    const match = text.match(/[?&]ID=(\d+)/i) || text.match(/product-thumbnail-(\d+)/i)
    return match ? match[1] : ''
  }

  function normalizeProduct(raw, sourceUrl = DEFAULT_SOURCE_URL) {
    const productUrl = absoluteUrl(raw.productUrl || raw.url || raw.href || '', sourceUrl)
    const productId = compact(raw.productId || raw.id || productIdFromUrl(productUrl) || productIdFromUrl(raw.thumbnailId))
    const productName = compact(raw.productName || raw.name || raw.title || raw.alt || '')
    const brand = compact(raw.brand || inferBrandFromCombinedName(raw.combinedName, productName) || '未识别品牌')
    const pricingText = compact(raw.pricingText || raw.priceText || raw.text || '')
    const priceDetails = parsePriceDetails(`${pricingText} ${raw.originalPrice || ''} ${raw.salePrice || ''} ${raw.discountPercent || ''}`)
    const originalPrice = raw.originalPrice != null ? parseMoney(raw.originalPrice) : priceDetails.originalPrice
    const salePrice = raw.salePrice != null ? parseMoney(raw.salePrice) : priceDetails.salePrice
    const discountPercent = raw.discountPercent != null ? Number(raw.discountPercent) : priceDetails.discountPercent
    const finalName = productName || compact(raw.combinedName || '').replace(new RegExp(`^${escapeRegExp(brand)}\\s+`, 'i'), '')
    return {
      productId,
      brand,
      productName: finalName,
      category: raw.category || inferCategory(`${brand} ${finalName}`),
      age: raw.age || inferAge(`${brand} ${finalName}`),
      originalPrice,
      salePrice,
      discountPercent: Number.isFinite(discountPercent) ? Math.round(discountPercent) : null,
      imageUrl: absoluteUrl(raw.imageUrl || raw.image || ''),
      productUrl,
      sourceUrl,
    }
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function inferBrandFromCombinedName(combinedName, productName) {
    const combined = compact(combinedName)
    const name = compact(productName)
    if (!combined || !name || combined === name) return ''
    if (combined.endsWith(name)) return compact(combined.slice(0, -name.length))
    return ''
  }

  function extractProductFromElement(container, sourceUrl = DEFAULT_SOURCE_URL) {
    if (!container) return null
    const thumb = container.querySelector?.('[id^="product-thumbnail-"]') || container
    const link = linkFromElement(container)
    const linkNode = container.querySelector?.('a[href*="/shop/product/"][href*="ID="]') || null
    const combinedName = nodeText(container, '.brand-and-name') || compact(linkNode?.title || linkNode?.getAttribute?.('title') || '')
    const brand = nodeText(container, '.product-brand')
    const productName = nodeText(container, '.product-name') || compact(linkNode?.title || '')
    const pricingText = nodeText(container, '.pricing') || compact(container.innerText || container.textContent || '')
    return normalizeProduct({
      productId: productIdFromUrl(thumb?.id || link),
      thumbnailId: thumb?.id || '',
      brand,
      productName,
      combinedName,
      pricingText,
      imageUrl: imageFromElement(container),
      productUrl: link,
    }, sourceUrl)
  }

  function extractProductsFromDocument(doc = document, options = {}) {
    const sourceUrl = options.sourceUrl || DEFAULT_SOURCE_URL
    const includeSponsored = boolParam(options.includeSponsored ?? options.include_sponsored_items, false)
    const skipNonShoe = boolParam(options.skipNonShoe ?? options.skip_non_shoe_items, true)
    const maxProducts = toInt(options.maxProducts ?? options.max_products, 120, 1, 500)
    const thumbs = [...(doc.querySelectorAll?.('[id^="product-thumbnail-"]') || [])]
    const products = []
    for (const thumb of thumbs) {
      const container = closestProductContainer(thumb)
      if (!container) continue
      if (!includeSponsored && typeof container.closest === 'function' && container.closest('.brand-showcase, .monetization-brand')) {
        continue
      }
      const product = extractProductFromElement(container, sourceUrl)
      if (!isUsableProduct(product, skipNonShoe)) continue
      products.push(product)
      if (products.length >= maxProducts) break
    }
    return dedupeProducts(products)
  }

  function isUsableProduct(product, skipNonShoe = true) {
    if (!product || !compact(product.productName) || !compact(product.brand)) return false
    if (skipNonShoe && product.category === NON_SHOE_CATEGORY) return false
    return true
  }

  function splitHtmlProductCards(html) {
    const text = String(html || '')
    const cards = []
    const liPattern = /<li\b[^>]*(?:data-product[_-]id=|class=["'][^"']*(?:productThumbnail|product-thumbnail-container)[^"']*)[^>]*>[\s\S]*?<\/li>/gi
    for (const match of text.matchAll(liPattern)) cards.push(match[0])
    if (cards.length) return cards
    const divPattern = /<div\b[^>]*(?:id=["']product-thumbnail-\d+["']|class=["'][^"']*product-thumbnail-container[^"']*)[^>]*>[\s\S]*?(?=<div\b[^>]*(?:id=["']product-thumbnail-\d+["']|class=["'][^"']*product-thumbnail-container)|$)/gi
    for (const match of text.matchAll(divPattern)) cards.push(match[0])
    return cards
  }

  function extractProductFromHtmlCard(cardHtml, sourceUrl = DEFAULT_SOURCE_URL) {
    const html = String(cardHtml || '')
    const href = extractAttr(html.match(/<a\b[\s\S]*?<\/a>/i)?.[0] || html, 'href')
    const imgTag = html.match(/<img\b[\s\S]*?>/i)?.[0] || ''
    const sourceTag = html.match(/<source\b[\s\S]*?srcset=["'][^"']+["'][\s\S]*?>/i)?.[0] || ''
    const brand = extractClassText(html, 'productBrand|product-brand')
    const productName =
      extractClassText(html, 'productName|product-name') ||
      extractAttr(html.match(/<a\b[\s\S]*?<\/a>/i)?.[0] || html, 'title') ||
      extractAttr(imgTag, 'alt')
    const combinedName = stripTags(html.match(/<a\b[\s\S]*?<\/a>/i)?.[0] || '')
    const imageUrl = [
      extractAttr(imgTag, 'src'),
      extractAttr(imgTag, 'data-src'),
      extractAttr(sourceTag, 'srcset').split(/\s+/)[0],
    ].map(raw => absoluteUrl(raw, sourceUrl)).find(url => /^https?:\/\//i.test(url)) || ''
    return normalizeProduct({
      productId:
        extractAttr(html, 'data-product_id') ||
        extractAttr(html, 'data-product-id') ||
        productIdFromUrl(html) ||
        productIdFromUrl(href),
      brand,
      productName,
      combinedName,
      pricingText: stripTags(html),
      productUrl: href,
      imageUrl,
    }, sourceUrl)
  }

  function extractProductsFromHtml(html, sourceUrl = DEFAULT_SOURCE_URL, options = {}) {
    if (typeof DOMParser !== 'undefined') {
      try {
        const doc = new DOMParser().parseFromString(String(html || ''), 'text/html')
        const products = extractProductsFromDocument(doc, { ...options, sourceUrl, includeSponsored: true })
        if (products.length) return products
      } catch (error) {
        // Regex fallback below handles compact SSR fixtures and tests.
      }
    }
    const skipNonShoe = boolParam(options.skipNonShoe ?? options.skip_non_shoe_items, false)
    const products = splitHtmlProductCards(html)
      .map(card => extractProductFromHtmlCard(card, sourceUrl))
      .filter(product => isUsableProduct(product, skipNonShoe))
    return dedupeProducts(products)
  }

  function dedupeProducts(products) {
    const seen = new Set()
    const deduped = []
    for (const product of products || []) {
      const key = compact(product.productId || product.productUrl || `${product.brand}|${product.productName}|${product.salePrice}`)
      if (!key || seen.has(key)) continue
      seen.add(key)
      deduped.push(product)
    }
    return deduped
  }

  function formatMoney(value) {
    if (value == null || !Number.isFinite(Number(value))) return ''
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(value)).replace(/\u00a0/g, ' ')
    } catch (error) {
      return `$${Number(value).toFixed(2)}`
    }
  }

  function formatPriceBand(values) {
    const prices = values
      .map(value => (value == null ? null : Number(value)))
      .filter(value => Number.isFinite(value))
      .sort((a, b) => a - b)
    if (!prices.length) return ''
    const min = prices[0]
    const max = prices[prices.length - 1]
    if (Math.abs(min - max) < 0.001) return formatMoney(min)
    return `${formatMoney(min)} - ${formatMoney(max)}`
  }

  function formatDiscountBand(values) {
    const discounts = values
      .map(value => (value == null ? null : Number(value)))
      .filter(value => Number.isFinite(value))
      .sort((a, b) => a - b)
    if (!discounts.length) return ''
    const min = discounts[0]
    const max = discounts[discounts.length - 1]
    if (Math.abs(min - max) < 0.001) return `-${Math.round(max)}%`
    return `-${Math.round(min)}% 至 -${Math.round(max)}%`
  }

  function summarizeUnique(values, limit = 8) {
    const unique = []
    for (const value of values.map(compact).filter(Boolean)) {
      if (!unique.includes(value)) unique.push(value)
      if (unique.length >= limit) break
    }
    return unique.join(' / ')
  }

  function summarizeUrls(values, limit = 6) {
    const unique = []
    for (const value of values.map(compact).filter(Boolean)) {
      if (!unique.includes(value)) unique.push(value)
      if (unique.length >= limit) break
    }
    return unique.join('\n')
  }

  function groupBy(products, keyFn) {
    const groups = new Map()
    for (const product of products) {
      const key = compact(keyFn(product)) || '未识别'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(product)
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  }

  function categoryPriceBandSummary(products) {
    return groupBy(products, product => product.category)
      .map(([category, items]) => `${category}: ${formatPriceBand(items.map(item => item.salePrice)) || '无价格'}`)
      .join('；')
  }

  function commonSummaryFields(products, sourceUrl) {
    return {
      '产品宽度': products.length,
      '年龄维度': summarizeUnique(products.map(item => item.age), 12),
      '销售价格带': formatPriceBand(products.map(item => item.originalPrice)),
      '折扣力度': formatDiscountBand(products.map(item => item.discountPercent)),
      '折扣后价格带': formatPriceBand(products.map(item => item.salePrice)),
      '代表产品': summarizeUnique(products.map(item => item.productName), 5),
      '产品图片': summarizeUrls(products.map(item => item.imageUrl), 8),
      '商品链接': summarizeUrls(products.map(item => item.productUrl), 8),
      '来源 URL': sourceUrl,
    }
  }

  function buildBrandRows(products, sourceUrl = DEFAULT_SOURCE_URL) {
    return groupBy(products, product => product.brand).map(([brand, items]) => ({
      __sheet_name: BRAND_SHEET,
      '品牌': brand,
      ...commonSummaryFields(items, sourceUrl),
      '品类': summarizeUnique(items.map(item => item.category), 12),
      '品类价格带': categoryPriceBandSummary(items),
    }))
  }

  function buildCategoryRows(products, sourceUrl = DEFAULT_SOURCE_URL) {
    return groupBy(products, product => product.category).map(([category, items]) => ({
      __sheet_name: CATEGORY_SHEET,
      '品类': category,
      ...commonSummaryFields(items, sourceUrl),
      '品牌': summarizeUnique(items.map(item => item.brand), 15),
    }))
  }

  function buildDetailRows(products, sourceUrl = DEFAULT_SOURCE_URL) {
    return products.map(product => ({
      __sheet_name: DETAIL_SHEET,
      '品牌': product.brand,
      '品类': product.category,
      '年龄维度': product.age,
      '产品名称': product.productName,
      '销售价格': formatMoney(product.originalPrice),
      '折扣力度': product.discountPercent == null ? '' : `-${Math.round(product.discountPercent)}%`,
      '折扣后价格': formatMoney(product.salePrice),
      '产品图片': product.imageUrl,
      '商品链接': product.productUrl,
      "Macy's 商品ID": product.productId,
      '来源 URL': sourceUrl,
    }))
  }

  function buildResearchRows(products, sourceUrl = DEFAULT_SOURCE_URL) {
    const cleanProducts = dedupeProducts(products).filter(product => isUsableProduct(product, false))
    return [
      ...buildBrandRows(cleanProducts, sourceUrl),
      ...buildCategoryRows(cleanProducts, sourceUrl),
      ...buildDetailRows(cleanProducts, sourceUrl),
    ]
  }

  async function fetchText(url, fetchImpl = fetch) {
    const response = await fetchImpl(url, {
      credentials: 'include',
      cache: 'no-store',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })
    if (!response) throw new Error(`Macy's 请求失败：${url}`)
    if (typeof response === 'string') return response
    if (response.ok === false) throw new Error(`Macy's 请求失败(${response.status || 'unknown'})：${url}`)
    if (typeof response.text === 'function') return response.text()
    return String(response)
  }

  async function scrollPageForProducts(maxScrolls = 6, delayMs = 450) {
    if (typeof window === 'undefined' || typeof document === 'undefined' || typeof window.scrollTo !== 'function') return
    let previousCount = 0
    for (let index = 0; index < maxScrolls; index += 1) {
      const currentCount = document.querySelectorAll?.('[id^="product-thumbnail-"]').length || 0
      window.scrollTo(0, document.body?.scrollHeight || document.documentElement?.scrollHeight || 0)
      await sleep(delayMs)
      const nextCount = document.querySelectorAll?.('[id^="product-thumbnail-"]').length || 0
      if (nextCount === currentCount && nextCount === previousCount) break
      previousCount = nextCount
    }
    window.scrollTo(0, 0)
  }

  function isCurrentMacysPage(sourceUrl) {
    if (typeof location === 'undefined') return false
    try {
      return new URL(location.href).hostname.endsWith('macys.com') &&
        new URL(sourceUrl).hostname.endsWith('macys.com')
    } catch (error) {
      return false
    }
  }

  async function collectResearchRows(options = {}, fetchTextImpl = fetchText) {
    const sourceUrl = compact(options.category_url || options.categoryUrl || DEFAULT_SOURCE_URL)
    const maxProducts = toInt(options.max_products ?? options.maxProducts, 120, 1, 500)
    const includeSponsored = boolParam(options.include_sponsored_items ?? options.includeSponsoredItems, false)
    const skipNonShoe = boolParam(options.skip_non_shoe_items ?? options.skipNonShoeItems, true)
    const maxScrolls = toInt(options.max_scrolls ?? options.maxScrolls, 6, 0, 20)
    const scrollDelayMs = toInt(options.scroll_delay_ms ?? options.scrollDelayMs, 450, 0, 5000)

    let products = []
    if (typeof document !== 'undefined' && isCurrentMacysPage(sourceUrl)) {
      if (maxScrolls > 0) await scrollPageForProducts(maxScrolls, scrollDelayMs)
      products = extractProductsFromDocument(document, {
        sourceUrl,
        maxProducts,
        includeSponsored,
        skipNonShoe,
      })
    }

    if (!products.length) {
      const html = await fetchTextImpl(sourceUrl)
      products = extractProductsFromHtml(html, sourceUrl, {
        maxProducts,
        includeSponsored,
        skipNonShoe,
      }).slice(0, maxProducts)
    }

    if (!products.length) {
      throw new Error("未解析到 Macy's 儿童鞋商品，请确认页面已完整加载，或关闭地区/反爬拦截后重试")
    }
    return buildResearchRows(products, sourceUrl)
  }

  function complete(data, meta = {}) {
    return {
      success: true,
      data,
      meta: {
        has_more: false,
        action: 'complete',
        shared: {
          ...shared,
          total_rows: data.length,
          source_url: compact(params.category_url || DEFAULT_SOURCE_URL),
          generated_at: new Date().toISOString(),
          ...meta.shared,
        },
        ...meta,
      },
    }
  }

  if (testExports && typeof testExports === 'object') {
    Object.assign(testExports, {
      DEFAULT_SOURCE_URL,
      BRAND_SHEET,
      CATEGORY_SHEET,
      DETAIL_SHEET,
      NON_SHOE_CATEGORY,
      parseMoney,
      parsePriceDetails,
      inferAge,
      inferCategory,
      extractProductsFromHtml,
      extractProductsFromDocument,
      buildResearchRows,
      buildBrandRows,
      buildCategoryRows,
      buildDetailRows,
      collectResearchRows,
      formatMoney,
      formatPriceBand,
      formatDiscountBand,
    })
    return complete([])
  }

  try {
    const rows = await collectResearchRows(params)
    const brandRows = rows.filter(row => row.__sheet_name === BRAND_SHEET).length
    const categoryRows = rows.filter(row => row.__sheet_name === CATEGORY_SHEET).length
    const detailRows = rows.filter(row => row.__sheet_name === DETAIL_SHEET).length
    return complete(rows, {
      notify_title: `Macy's 儿童鞋调研 ${detailRows} 个商品`,
      notify_body: `已汇总品牌维度 ${brandRows} 行、品类维度 ${categoryRows} 行，并保留 ${detailRows} 行产品明细。`,
    })
  } catch (error) {
    return {
      success: false,
      error: error?.message || String(error),
      meta: {
        has_more: false,
        shared: {
          ...shared,
          source_url: compact(params.category_url || DEFAULT_SOURCE_URL),
        },
      },
    }
  }
})()
