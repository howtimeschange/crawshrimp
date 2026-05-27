;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const NEW_SHEET = '上新SKU宽度'
  const BANNER_SHEET = '首页主推与促销'

  const MARKETS = Object.freeze({
    us: {
      key: 'us',
      label: '美国站',
      localePath: 'us/en',
      categoriesUrl: 'https://www.zara.com/us/en/categories?ajax=true',
      currency: 'USD',
      locale: 'en-US',
    },
    br: {
      key: 'br',
      label: '巴西站',
      localePath: 'br/pt',
      categoriesUrl: 'https://www.zara.com/br/pt/categories?ajax=true',
      currency: 'BRL',
      locale: 'pt-BR',
    },
  })

  const SECTION_LABELS = Object.freeze({
    WOMAN: '女装',
    MAN: '男装',
    KID: '童装',
  })

  const FAMILY_NAME_MAP = Object.freeze([
    [/VESTIDO|DRESS|ROBE/i, '连衣裙/裙装'],
    [/FALDA|SAIA|SKIRT/i, '半身裙'],
    [/BERMUDA|SHORT/i, '短裤/百慕大'],
    [/PANT|TROUSER|CAL[ÇC]A|JEAN/i, '裤装/牛仔'],
    [/CAMISA|SHIRT|BLOUSE|BLUSA/i, '衬衫/上衣'],
    [/CAMISETA|T-?SHIRT|TEE/i, 'T恤'],
    [/SWEATER|KNIT|JERSEY|TRICOT|MALHA/i, '针织/毛衫'],
    [/BLAZER|SUIT|ALFAIATARIA/i, '西装/通勤'],
    [/JACKET|COAT|CHAQUETA|CASACO|JAQUETA/i, '外套/夹克'],
    [/SHOE|SAPATO|CAL[ÇC]ADO|SANDAL|BOOT|SNEAKER/i, '鞋履'],
    [/BAG|BOLSA/i, '包袋'],
    [/ACCESS|ACESS[ÓO]RIO|BELT|HAT|CAP/i, '配饰'],
    [/PERFUME|FRAGRANCE|BEAUTY/i, '香水/美妆'],
    [/SWIM|PRAIA|BIKINI/i, '泳装/度假'],
  ])

  const STYLE_RULES = Object.freeze([
    {
      label: '牛仔休闲',
      patterns: [/DENIM|JEANS|Z1975|MID-BLUE|BLUE DENIM|VAQUERO/i],
    },
    {
      label: '度假/夏日',
      patterns: [/SUMMER|VACATION|PRAIA|BEACH|SWIM|BIKINI|LINEN|CROCHET|BERMUDA|SHORT/i],
    },
    {
      label: '通勤/正式',
      patterns: [/BLAZER|SUIT|FORMAL|TAILOR|ALFAIATARIA|SHIRT|CAMISA|OFFICE/i],
    },
    {
      label: '基础/日常',
      patterns: [/BASIC|COTTON|DAILY|REGULAR|THE NEW|CAMISETA|T-?SHIRT|TEE/i],
    },
    {
      label: '派对/礼服',
      patterns: [/PARTY|OCCASION|EVENING|SATIN|LACE|VESTIDO|DRESS|CEREMONY|OCASI/i],
    },
    {
      label: '运动/户外',
      patterns: [/\b(?:SPORT|ATHLETICZ|GYM|SKI|ACTIVE|MOVE|RUNNING)\b/i],
    },
    {
      label: '童趣/IP',
      patterns: [/DISNEY|HELLO KITTY|TOY STORY|PEANUTS|FIFA|KPOP|K-POP|DEMON|CHARACTER|KIDS CLUB/i],
    },
    {
      label: '鞋包配饰',
      patterns: [/SHOE|SAPATO|CAL[ÇC]ADO|BAG|BOLSA|ACCESS|ACESS[ÓO]RIO|BELT|HAT|CAP/i],
    },
  ])

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

  function normalizeLookupText(value) {
    return compact(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  }

  function parseSiteScope(value) {
    const text = normalizeLookupText(value || 'all')
    if (!text || text === 'all' || text === '全部') return ['us', 'br']
    const keys = text.split(/[,，|/\s]+/).filter(Boolean)
    const normalized = keys
      .map(key => {
        if (key === 'usa' || key === 'unitedstates' || key === 'america' || key === '美国站') return 'us'
        if (key === 'brazil' || key === 'brasil' || key === '巴西站') return 'br'
        return key
      })
      .filter(key => MARKETS[key])
    return normalized.length ? [...new Set(normalized)] : ['us', 'br']
  }

  function parseSectionScope(value) {
    const text = normalizeLookupText(value || 'all')
    if (!text || text === 'all' || text === '全部') return ['WOMAN', 'MAN', 'KID']
    const keys = text.split(/[,，|/\s]+/).filter(Boolean)
    const normalized = keys
      .map(key => {
        if (['woman', 'women', 'womens', 'mulher', '女装'].includes(key)) return 'WOMAN'
        if (['man', 'men', 'mens', 'homem', '男装'].includes(key)) return 'MAN'
        if (['kid', 'kids', 'infantil', 'children', '童装'].includes(key)) return 'KID'
        return key.toUpperCase()
      })
      .filter(key => SECTION_LABELS[key])
    return normalized.length ? [...new Set(normalized)] : ['WOMAN', 'MAN', 'KID']
  }

  function parseZaraPayload(input) {
    if (input && typeof input === 'object') return input
    const text = String(input || '').trim()
    if (!text) return {}
    return JSON.parse(text)
  }

  async function fetchJson(url, fetchImpl = fetch) {
    const maxAttempts = toInt(params.fetch_retries, 3, 1, 5)
    let lastError = null
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          credentials: 'include',
          cache: 'no-store',
          headers: {
            accept: 'application/json, text/plain, */*',
            'x-requested-with': 'XMLHttpRequest',
          },
        })
        if (!response) throw new Error(`Zara 请求失败：${url}`)
        if (response.ok === false) {
          const status = Number(response.status || 0)
          if (status === 404 && /\/products\?ajax=true/i.test(url)) return { productGroups: [] }
          throw new Error(`Zara 请求失败(${status || 'unknown'})：${url}`)
        }
        if (typeof response.json === 'function') return parseZaraPayload(await response.json())
        if (typeof response.text === 'function') return parseZaraPayload(await response.text())
        return parseZaraPayload(response)
      } catch (error) {
        lastError = error
        if (attempt < maxAttempts) await sleep(350 * attempt)
      }
    }
    throw lastError || new Error(`Zara 请求失败：${url}`)
  }

  function visibleSubcategories(category) {
    return (category?.subcategories || []).filter(item => !isSkippableCategory(item))
  }

  function belongsToSection(category, sectionName) {
    return !category?.sectionName || !sectionName || category.sectionName === sectionName
  }

  function isExcludedVerticalPath(path) {
    return path.slice(1).some(item =>
      /\b(?:BEAUTY|PERFUMES?|ZARA HOME|HOME|PROJECTS|PROJETOS|JOIN LIFE|PRE-OWNED|PREOWNED|NEWSLETTER|STORES|CAREERS)\b/i.test(compact(item?.name)),
    )
  }

  function isSkippableCategory(category) {
    const name = compact(category?.name)
    if (!name) return true
    if (category?.attributes?.isDivider || category?.attributes?.isLineBreak || category?.attributes?.isTitle) return true
    if (/^DIVIDER_|^[-–—]$|NEWSLETTER|STORES|CAREERS|DOWNLOAD APP|BAIXAR APP/i.test(name)) return true
    return false
  }

  function isGenericCategoryLabel(value) {
    return /^(?:VIEW ALL|VER TUDO|COLLECTION|COLE[ÇC][AÃ]O|EDITORIAL|LOOKBOOK)$/i.test(compact(value))
  }

  function isNewArrivalCategory(category) {
    const text = `${compact(category?.name)} ${compact(category?.key)} ${compact(category?.seo?.keyword)}`
    if (/NEWSLETTER|PRE-OWNED|PROJECTS|PROJETOS/i.test(text)) return false
    return /\b(?:NEW ARRIVALS|NOVIDADES|THE NEW|NEW IN|NEWS|NEW DROP)\b/i.test(text) ||
      /(?:^|[-_])(?:new|news|novelty)(?:[-_]|$)|novidades/i.test(text)
  }

  function isPromotionCategory(category) {
    const text = `${compact(category?.name)} ${compact(category?.key)} ${compact(category?.seo?.keyword)}`
    return /SPECIAL PRICES|SPECIAL OFFERS|SALE|PROMO|DISCOUNT|DESCONTO|OFERTA/i.test(text)
  }

  function walkCategories(root, visit, path = []) {
    if (!root || typeof root !== 'object') return
    const nextPath = isSkippableCategory(root) ? path : [...path, root]
    if (!isSkippableCategory(root) && visit(root, nextPath) === false) return
    for (const child of root.subcategories || []) walkCategories(child, visit, nextPath)
  }

  function sectionRoots(categoriesPayload, selectedSections) {
    const selected = new Set(selectedSections)
    return (parseZaraPayload(categoriesPayload).categories || [])
      .filter(category => selected.has(category.sectionName) && !isSkippableCategory(category))
  }

  function collectProductCandidateCategories(category, sectionName = '') {
    const candidates = []
    function collect(node) {
      if (!node || isSkippableCategory(node) || isPromotionCategory(node) || !belongsToSection(node, sectionName)) return
      const children = visibleSubcategories(node).filter(child => !isPromotionCategory(child) && belongsToSection(child, sectionName))
      if (!children.length) {
        if (!isGenericCategoryLabel(node.name)) candidates.push(node)
        return
      }
      const meaningfulChildren = children.filter(child => !isGenericCategoryLabel(child.name))
      if (!meaningfulChildren.length && !isGenericCategoryLabel(node.name)) {
        candidates.push(node)
        return
      }
      for (const child of children) collect(child)
    }
    collect(category)
    return candidates
  }

  function collectPromotionProductCandidateCategories(category, sectionName = '') {
    const candidates = []
    function collect(node) {
      if (!node || isSkippableCategory(node) || !belongsToSection(node, sectionName)) return
      const children = visibleSubcategories(node).filter(child => belongsToSection(child, sectionName))
      if (!children.length) {
        candidates.push(node)
        return
      }
      for (const child of children) collect(child)
    }
    for (const child of visibleSubcategories(category).filter(child => belongsToSection(child, sectionName))) collect(child)
    return candidates.length ? candidates : [category]
  }

  function categoryPathLabel(path) {
    return path
      .map(item => compact(item?.name))
      .filter(Boolean)
      .join(' > ')
  }

  function categoryPageUrl(market, category) {
    const keyword = compact(category?.seo?.keyword)
    const seoCategoryId = compact(category?.seo?.seoCategoryId)
    if (keyword && seoCategoryId) {
      return `https://www.zara.com/${market.localePath}/${encodeURIComponent(keyword)}-l${seoCategoryId}.html`
    }
    return productApiUrl(market, category?.id)
  }

  function productApiUrl(market, categoryId) {
    return `https://www.zara.com/${market.localePath}/category/${categoryId}/products?ajax=true`
  }

  function collectNewArrivalTargets(categoriesPayload, market, selectedSections, maxTargetsPerSection = 12) {
    const roots = sectionRoots(categoriesPayload, selectedSections)
    const targets = []
    const seen = new Set()
    for (const root of roots) {
      let rootCount = 0
      walkCategories(root, (category, path) => {
        if (category !== root && !belongsToSection(category, root.sectionName)) return false
        if (isExcludedVerticalPath(path)) return false
        if (category === root || !isNewArrivalCategory(category)) return undefined
        const branchPath = categoryPathLabel(path)
        const leafCategories = collectProductCandidateCategories(category, root.sectionName)
        for (const leaf of leafCategories.length ? leafCategories : [category]) {
          const key = `${market.key}|${root.sectionName}|${leaf.id}`
          if (!leaf.id || seen.has(key)) continue
          seen.add(key)
          targets.push({
            market,
            sectionName: root.sectionName,
            sectionLabel: SECTION_LABELS[root.sectionName] || root.name,
            branchName: compact(category.name),
            categoryName: compact(leaf.name),
            categoryId: leaf.id,
            category: leaf,
            sourceUrl: categoryPageUrl(market, leaf),
            productUrl: productApiUrl(market, leaf.id),
            evidence: branchPath,
          })
          rootCount += 1
          if (rootCount >= maxTargetsPerSection) return false
        }
        return false
      })
    }
    return targets
  }

  function collectPromotionTargets(categoriesPayload, market, selectedSections, maxTargetsPerSection = 6) {
    const roots = sectionRoots(categoriesPayload, selectedSections)
    const targets = []
    const seen = new Set()
    for (const root of roots) {
      let rootCount = 0
      walkCategories(root, (category, path) => {
        if (category !== root && !belongsToSection(category, root.sectionName)) return false
        if (isExcludedVerticalPath(path)) return false
        if (category === root || !isPromotionCategory(category)) return undefined
        const leafCategories = collectPromotionProductCandidateCategories(category, root.sectionName)
        const candidates = leafCategories.length ? leafCategories : [category]
        for (const leaf of candidates) {
          const key = `${market.key}|${root.sectionName}|${leaf.id}`
          if (!leaf.id || seen.has(key)) continue
          seen.add(key)
          targets.push({
            market,
            sectionName: root.sectionName,
            sectionLabel: SECTION_LABELS[root.sectionName] || root.name,
            branchName: compact(category.name),
            categoryName: compact(leaf.name),
            categoryId: leaf.id,
            category: leaf,
            sourceUrl: categoryPageUrl(market, leaf),
            productUrl: productApiUrl(market, leaf.id),
            evidence: categoryPathLabel(path),
          })
          rootCount += 1
          if (rootCount >= maxTargetsPerSection) return false
        }
        return false
      })
    }
    return targets
  }

  function walkObjects(root, visit, seen = new Set()) {
    if (!root || typeof root !== 'object' || seen.has(root)) return
    seen.add(root)
    if (visit(root) === false) return
    if (Array.isArray(root)) {
      for (const item of root) walkObjects(item, visit, seen)
      return
    }
    for (const value of Object.values(root)) walkObjects(value, visit, seen)
  }

  function isProductLike(value) {
    if (!value || typeof value !== 'object') return false
    if (!(value.type === 'Product' || value.kind || value.price != null) || !(value.id || value.reference)) return false
    if (value.price == null) return false
    if (/^look\b/i.test(compact(value.name)) && !compact(value.familyName || value.subfamilyName)) return false
    return Boolean(compact(value.familyName || value.subfamilyName))
  }

  function extractProducts(productPayload) {
    const products = []
    const seen = new Set()
    walkObjects(parseZaraPayload(productPayload), obj => {
      if (!Array.isArray(obj.commercialComponents)) return undefined
      for (const product of obj.commercialComponents) {
        if (!isProductLike(product)) continue
        const key = compact(product.id || product.reference || `${product.name}|${product.price}`)
        if (!key || seen.has(key)) continue
        seen.add(key)
        products.push(product)
      }
      return undefined
    })
    return products
  }

  function parseZaraPrice(value) {
    if (value == null || value === '') return null
    const numeric = Number(String(value).replace(/[^\d.-]/g, ''))
    if (!Number.isFinite(numeric)) return null
    return numeric / 100
  }

  function formatMoney(value, market) {
    if (value == null || !Number.isFinite(Number(value))) return ''
    try {
      return new Intl.NumberFormat(market.locale, {
        style: 'currency',
        currency: market.currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(value)).replace(/\u00a0/g, ' ')
    } catch (error) {
      const symbol = market.currency === 'BRL' ? 'R$' : '$'
      return `${symbol} ${Number(value).toFixed(2)}`
    }
  }

  function formatPriceBandFromProducts(products, market) {
    const prices = products
      .map(product => parseZaraPrice(product.price))
      .filter(value => value != null)
      .sort((a, b) => a - b)
    if (!prices.length) return ''
    const min = prices[0]
    const max = prices[prices.length - 1]
    if (Math.abs(min - max) < 0.001) return formatMoney(min, market)
    return `${formatMoney(min, market)} - ${formatMoney(max, market)}`
  }

  function translateFamilyName(value) {
    const source = compact(value) || '未识别品类'
    for (const [pattern, label] of FAMILY_NAME_MAP) {
      if (pattern.test(source)) return `${label} (${source})`
    }
    return source
  }

  function productText(product, target = {}) {
    return [
      product?.name,
      product?.familyName,
      product?.subfamilyName,
      product?.sectionName,
    ].map(compact).filter(Boolean).join(' ')
  }

  function inferProductStyle(products, target = {}) {
    const scores = new Map()
    const examples = new Map()
    for (const product of products) {
      const text = productText(product, target)
      for (const rule of STYLE_RULES) {
        if (!rule.patterns.some(pattern => pattern.test(text))) continue
        scores.set(rule.label, (scores.get(rule.label) || 0) + 1)
        if (!examples.has(rule.label)) examples.set(rule.label, compact(product.name || product.familyName || target.categoryName))
      }
    }
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1])
    if (!ranked.length) {
      const sample = products.slice(0, 3).map(product => compact(product.name)).filter(Boolean).join(' / ')
      return { style: '待人工确认', evidence: sample }
    }
    const style = ranked.slice(0, 2).map(([label]) => label).join(' / ')
    const evidence = ranked.slice(0, 2)
      .map(([label, count]) => `${label}:${count}款${examples.get(label) ? `(${examples.get(label)})` : ''}`)
      .join('；')
    return { style, evidence }
  }

  function groupProductsByFamily(products) {
    const groups = new Map()
    for (const product of products) {
      const family = compact(product.familyName || product.subfamilyName || '未识别品类')
      if (!groups.has(family)) groups.set(family, [])
      groups.get(family).push(product)
    }
    return [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  }

  function productSummaryNames(products, limit = 3) {
    const names = []
    const seen = new Set()
    for (const product of products) {
      const name = compact(product.name)
      if (!name || seen.has(name)) continue
      seen.add(name)
      names.push(name)
      if (names.length >= limit) break
    }
    return names.join(' / ')
  }

  function buildNewArrivalRows(target, products) {
    const rows = []
    for (const [family, familyProducts] of groupProductsByFamily(products)) {
      const style = inferProductStyle(familyProducts, target)
      rows.push({
        __sheet_name: NEW_SHEET,
        '站点': target.market.label,
        '频道': target.sectionLabel,
        '上新入口': target.categoryName === target.branchName ? target.branchName : `${target.branchName} / ${target.categoryName}`,
        '品类': translateFamilyName(family),
        'SKU 宽度': familyProducts.length,
        '价格带': formatPriceBandFromProducts(familyProducts, target.market),
        '代表商品': productSummaryNames(familyProducts),
        '产品风格': style.style,
        '风格证据': style.evidence,
        '来源 URL': target.sourceUrl,
      })
    }
    return rows
  }

  function collectNewThemeRows(categoriesPayload, market, selectedSections) {
    const rows = []
    for (const root of sectionRoots(categoriesPayload, selectedSections)) {
      const branchSubjects = []
      const branchEvidence = []
      walkCategories(root, (category, path) => {
        if (category !== root && !belongsToSection(category, root.sectionName)) return false
        if (isExcludedVerticalPath(path)) return false
        if (category === root || !isNewArrivalCategory(category)) return undefined
        const subjects = visibleSubcategories(category)
          .map(item => compact(item.name))
          .filter(name => name && !isGenericCategoryLabel(name) && !isPromotionCategory({ name }))
        const usableSubjects = subjects.length ? subjects : [compact(category.name)].filter(Boolean)
        for (const subject of usableSubjects) {
          if (!branchSubjects.includes(subject)) branchSubjects.push(subject)
        }
        branchEvidence.push(categoryPathLabel(path))
        return false
      })
      if (!branchSubjects.length) continue
      rows.push({
        __sheet_name: BANNER_SHEET,
        '站点': market.label,
        '频道': SECTION_LABELS[root.sectionName] || root.name,
        'Banner 类型': '上新主题',
        '上新主体': summarizeList(branchSubjects, 10),
        '促销折扣': '',
        '价格带': '',
        '来源 URL': `https://www.zara.com/${market.localePath}/`,
        '证据': summarizeList(branchEvidence, 4),
      })
    }
    return rows
  }

  function summarizeList(values, limit = 8) {
    const unique = []
    for (const value of values.map(compact).filter(Boolean)) {
      if (!unique.includes(value)) unique.push(value)
    }
    if (unique.length <= limit) return unique.join(' / ')
    return `${unique.slice(0, limit).join(' / ')} / 等 ${unique.length} 项`
  }

  function extractDiscountPercent(product) {
    const candidates = [
      product?.displayDiscountPercentage,
      product?.discountPercentage,
      product?.discountLabel,
    ].map(compact).filter(Boolean)
    for (const value of candidates) {
      const match = value.match(/-?\d+(?:\.\d+)?/)
      if (match) return Math.abs(Number(match[0]))
    }
    const oldPrice = parseZaraPrice(product?.oldPrice)
    const price = parseZaraPrice(product?.price)
    if (oldPrice && price && oldPrice > price) return Math.round((1 - price / oldPrice) * 100)
    return null
  }

  function formatDiscountBand(products) {
    const discounts = products
      .map(extractDiscountPercent)
      .filter(value => value != null && Number.isFinite(value))
      .sort((a, b) => a - b)
    if (!discounts.length) return ''
    const min = discounts[0]
    const max = discounts[discounts.length - 1]
    if (Math.abs(min - max) < 0.001) return `-${Math.round(max)}%`
    return `-${Math.round(min)}% 至 -${Math.round(max)}%`
  }

  function buildPromotionRow(target, products) {
    return {
      __sheet_name: BANNER_SHEET,
      '站点': target.market.label,
      '频道': target.sectionLabel,
      'Banner 类型': '促销折扣',
      '上新主体': target.categoryName === target.branchName ? target.branchName : `${target.branchName} / ${target.categoryName}`,
      '促销折扣': formatDiscountBand(products) || '存在促销入口，折扣需人工复核',
      '价格带': formatPriceBandFromProducts(products, target.market),
      '来源 URL': target.sourceUrl,
      '证据': target.evidence,
    }
  }

  async function collectResearchRows(options = {}, fetchJsonImpl = fetchJson) {
    const siteKeys = parseSiteScope(options.site_scope ?? options.siteScope ?? 'all')
    const selectedSections = parseSectionScope(options.section_scope ?? options.sectionScope ?? 'all')
    const includeHomepageBanners = boolParam(options.include_homepage_banners ?? options.includeHomepageBanners, true)
    const includePromotionDiscount = boolParam(options.include_promotion_discount ?? options.includePromotionDiscount, true)
    const maxNewCategories = toInt(options.max_new_categories ?? options.maxNewCategories, 12, 1, 80)
    const maxPromoCategories = toInt(options.max_promo_categories ?? options.maxPromoCategories, 6, 1, 40)
    const requestDelayMs = toInt(options.request_delay_ms ?? options.requestDelayMs, 200, 0, 10000)

    const rows = []
    for (const siteKey of siteKeys) {
      const market = MARKETS[siteKey]
      const categoriesPayload = await fetchJsonImpl(market.categoriesUrl)
      if (includeHomepageBanners) {
        rows.push(...collectNewThemeRows(categoriesPayload, market, selectedSections))
      }

      const newTargets = collectNewArrivalTargets(categoriesPayload, market, selectedSections, maxNewCategories)
      for (const target of newTargets) {
        const products = extractProducts(await fetchJsonImpl(target.productUrl))
        if (products.length) rows.push(...buildNewArrivalRows(target, products))
        if (requestDelayMs > 0) await sleep(requestDelayMs)
      }

      if (includeHomepageBanners && includePromotionDiscount) {
        const promoTargets = collectPromotionTargets(categoriesPayload, market, selectedSections, maxPromoCategories)
        for (const target of promoTargets) {
          const products = extractProducts(await fetchJsonImpl(target.productUrl))
          rows.push(buildPromotionRow(target, products))
          if (requestDelayMs > 0) await sleep(requestDelayMs)
        }
      }
    }
    if (!rows.length) throw new Error('未解析到 Zara 上新或促销数据，请缩小频道范围后重试')
    return rows
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
          selected_sites: parseSiteScope(params.site_scope || 'all').join(','),
          selected_sections: parseSectionScope(params.section_scope || 'all').join(','),
          source_url: 'https://www.zara.com/',
          generated_at: new Date().toISOString(),
          ...meta.shared,
        },
        ...meta,
      },
    }
  }

  if (testExports && typeof testExports === 'object') {
    Object.assign(testExports, {
      MARKETS,
      SECTION_LABELS,
      NEW_SHEET,
      BANNER_SHEET,
      parseSiteScope,
      parseSectionScope,
      isNewArrivalCategory,
      isPromotionCategory,
      collectNewArrivalTargets,
      collectPromotionTargets,
      extractProducts,
      parseZaraPrice,
      formatPriceBandFromProducts,
      translateFamilyName,
      inferProductStyle,
      formatDiscountBand,
      collectNewThemeRows,
      collectResearchRows,
      productApiUrl,
    })
    return complete([])
  }

  try {
    const rows = await collectResearchRows(params)
    const newRows = rows.filter(row => row.__sheet_name === NEW_SHEET).length
    const bannerRows = rows.filter(row => row.__sheet_name === BANNER_SHEET).length
    return complete(rows, {
      notify_title: `Zara 上新与促销调研 ${rows.length} 行`,
      notify_body: `已汇总上新 SKU 宽度 ${newRows} 行，首页/导航主推与促销 ${bannerRows} 行。`,
    })
  } catch (error) {
    return {
      success: false,
      error: error?.message || String(error),
      meta: {
        has_more: false,
        shared: {
          ...shared,
          source_url: 'https://www.zara.com/',
        },
      },
    }
  }
})()
