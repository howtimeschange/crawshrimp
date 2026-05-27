;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const DEFAULT_SOURCE_URL = 'https://www.lojasrenner.com.br/c/infantil/-/N-10xdweq?s_icid=230228_MENU_INF_GERAL'
  const PRICE_ASC_SORT = 'dim.product.purchasable|1||prop.sku.activePrice|0'
  const PRICE_DESC_SORT = 'dim.product.purchasable|1||prop.sku.activePrice|1'
  const DEFAULT_CATEGORY_LABELS = Object.freeze([
    'Bermuda e Short',
    'Blusa e Camiseta',
    'Body',
    'Calçados Infantis',
    'Calça',
    'Camisa',
    'Casaco e Jaqueta',
    'Colete',
    'Conjunto',
    'Macacão e Jardineira',
    'Moda Praia',
    'Pijama e Moda Íntima',
    'Roupas Divertidas',
    'Saia',
    'Short Saia',
    'Vestido',
  ])
  const CATEGORY_NAME_MAP = Object.freeze({
    'Acessórios Infantis': '儿童配饰',
    'Bermuda e Short': '短裤',
    'Blusa e Camiseta': '上衣/T恤',
    'Body': '连体衣',
    'Calçados Infantis': '儿童鞋',
    'Calça': '裤子',
    'Camisa': '衬衫',
    'Casaco e Jaqueta': '外套/夹克',
    'Colete': '马甲',
    'Conjunto': '套装',
    'Macacão e Jardineira': '连体裤/背带裤',
    'Moda Praia': '泳装',
    'Pijama e Moda Íntima': '睡衣/内衣',
    'Roupas Divertidas': '趣味服饰',
    'Saia': '半身裙',
    'Short Saia': '裙裤',
    'Vestido': '裙子',
  })

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

  function normalizeLookupText(value) {
    return compact(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  }

  function parseUrl(raw, fallbackOrigin = 'https://www.lojasrenner.com.br') {
    let text = compact(raw)
    if (!text) return null
    if (text.startsWith('//')) text = `https:${text}`
    try {
      return new URL(text, fallbackOrigin)
    } catch (error) {
      return null
    }
  }

  function normalizeCategoryApiUrl(raw, fallbackOrigin = 'https://www.lojasrenner.com.br') {
    const url = parseUrl(raw || DEFAULT_SOURCE_URL, fallbackOrigin)
    if (!url) return ''
    const normalized = new URL(url.href)
    if (normalized.pathname.startsWith('/react/c/')) {
      // already API-shaped
    } else if (normalized.pathname.startsWith('/c/')) {
      normalized.pathname = `/react${normalized.pathname}`
    } else if (!normalized.pathname.startsWith('/react/')) {
      normalized.pathname = `/react/c${normalized.pathname.startsWith('/') ? normalized.pathname : `/${normalized.pathname}`}`
    }
    normalized.searchParams.set('format', 'json')
    normalized.hash = ''
    return normalized.href
  }

  function buildSortedCategoryApiUrl(raw, direction = 'asc', fallbackOrigin = 'https://www.lojasrenner.com.br') {
    const href = normalizeCategoryApiUrl(raw, fallbackOrigin)
    if (!href) return ''
    const url = new URL(href)
    url.searchParams.delete('No')
    url.searchParams.set('format', 'json')
    url.searchParams.set('Ns', direction === 'desc' ? PRICE_DESC_SORT : PRICE_ASC_SORT)
    return url.href
  }

  function parseRennerPayload(input) {
    if (input && typeof input === 'object') return input
    const text = String(input || '').trim()
    if (!text) return null
    if (text.startsWith('<')) {
      const match = text.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/)
      if (!match) throw new Error('页面中未找到 __NEXT_DATA__，无法解析 Renner 类目数据')
      return JSON.parse(match[1])
    }
    return JSON.parse(text)
  }

  async function fetchPayload(url, fetchImpl = fetch) {
    const maxAttempts = toInt(params.fetch_retries, 3, 1, 5)
    let lastError = null
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          credentials: 'include',
          cache: 'no-store',
          headers: { accept: 'application/json, text/plain, */*' },
        })
        if (!response || response.ok === false) {
          throw new Error(`Renner 请求失败：${url}`)
        }
        if (typeof response.json === 'function') {
          const contentType = compact(response.headers?.get?.('content-type')).toLowerCase()
          if (contentType.includes('application/json')) return parseRennerPayload(await response.json())
        }
        if (typeof response.text === 'function') return parseRennerPayload(await response.text())
        return parseRennerPayload(response)
      } catch (error) {
        lastError = error
        if (attempt < maxAttempts) await sleep(350 * attempt)
      }
    }
    throw lastError || new Error(`Renner 请求失败：${url}`)
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

  function findProductList(payload) {
    const parsed = parseRennerPayload(payload)
    const candidates = []
    walkObjects(parsed, obj => {
      if (obj && Array.isArray(obj.records) && Object.prototype.hasOwnProperty.call(obj, 'totalNumRecs')) {
        candidates.push(obj)
      }
    })
    candidates.sort((a, b) => Number(b.totalNumRecs || 0) - Number(a.totalNumRecs || 0))
    return candidates[0] || null
  }

  function extractCategoryRefinements(payload) {
    const parsed = parseRennerPayload(payload)
    let categoryNavigation = null
    walkObjects(parsed, obj => {
      if (
        obj &&
        Array.isArray(obj.refinements) &&
        (obj.dimensionName === 'product.category' || obj.nameLanguage === 'Categoria')
      ) {
        categoryNavigation = obj
        return false
      }
      return undefined
    })
    return (categoryNavigation?.refinements || [])
      .map(refinement => ({
        sourceLabel: compact(refinement.label),
        apiUrl: normalizeCategoryApiUrl(refinement.navigationState),
      }))
      .filter(item => item.sourceLabel && item.apiUrl)
  }

  function translateCategoryName(sourceLabel, explicitName = '') {
    const label = compact(sourceLabel)
    const name = compact(explicitName)
    if (name) return name
    return CATEGORY_NAME_MAP[label] || label
  }

  function splitCategoryConfig(value) {
    return String(value || '')
      .split(/\r?\n/)
      .map(line => line.replace(/#.*$/, '').trim())
      .filter(Boolean)
  }

  function parseConfiguredCategory(line) {
    const match = line.match(/^(.+?)\s*(?:=|\||\t)\s*(.+)$/)
    if (match) {
      return { outputName: compact(match[1]), target: compact(match[2]) }
    }
    return { outputName: '', target: compact(line) }
  }

  function looksLikeUrlOrPath(value) {
    return /^(?:https?:)?\/\//i.test(compact(value)) || compact(value).startsWith('/')
  }

  function resolveCategoryTargets(configText, sourcePayload, fallbackOrigin = 'https://www.lojasrenner.com.br', maxCategories = 30) {
    const sourceCategories = extractCategoryRefinements(sourcePayload)
    const byLabel = new Map()
    for (const item of sourceCategories) {
      byLabel.set(normalizeLookupText(item.sourceLabel), item)
      byLabel.set(normalizeLookupText(translateCategoryName(item.sourceLabel)), item)
    }

    const configLines = splitCategoryConfig(configText)
    const resolved = []
    if (configLines.length) {
      for (const line of configLines) {
        const configured = parseConfiguredCategory(line)
        const maybeUrl = looksLikeUrlOrPath(configured.target) ? parseUrl(configured.target, fallbackOrigin) : null
        if (maybeUrl && /lojasrenner\.com\.br$/i.test(maybeUrl.hostname)) {
          const sourceLabel = configured.outputName || configured.target
          resolved.push({
            sourceLabel,
            outputName: translateCategoryName(sourceLabel, configured.outputName),
            apiUrl: normalizeCategoryApiUrl(maybeUrl.href, fallbackOrigin),
          })
          continue
        }
        const matched = byLabel.get(normalizeLookupText(configured.target))
        if (!matched) throw new Error(`未在 Renner 页面筛选项中找到品类：${configured.target}`)
        resolved.push({
          sourceLabel: matched.sourceLabel,
          outputName: translateCategoryName(matched.sourceLabel, configured.outputName),
          apiUrl: matched.apiUrl,
        })
      }
    } else {
      const defaultSet = new Set(DEFAULT_CATEGORY_LABELS.map(normalizeLookupText))
      for (const item of sourceCategories) {
        if (!defaultSet.has(normalizeLookupText(item.sourceLabel))) continue
        resolved.push({
          sourceLabel: item.sourceLabel,
          outputName: translateCategoryName(item.sourceLabel),
          apiUrl: item.apiUrl,
        })
      }
    }

    const seen = new Set()
    return resolved
      .filter(item => {
        const key = `${normalizeLookupText(item.outputName)}|${item.apiUrl}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, maxCategories)
  }

  function firstAttribute(record, key) {
    const value = record?.attributes?.[key]
    if (Array.isArray(value)) return value[0]
    return value
  }

  function parsePrice(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    const text = compact(value)
    if (!text) return null
    const normalized = text
      .replace(/[^\d,.-]/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.')
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }

  function firstPriceFromList(list) {
    for (const record of list?.records || []) {
      const price = parsePrice(firstAttribute(record, 'prop.sku.activePrice'))
      if (price != null) return price
    }
    return null
  }

  function formatBrl(value) {
    if (value == null || !Number.isFinite(Number(value))) return ''
    try {
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(value)).replace(/\u00a0/g, ' ')
    } catch (error) {
      return `R$ ${Number(value).toFixed(2).replace('.', ',')}`
    }
  }

  function formatPriceBand(minPrice, maxPrice) {
    if (minPrice == null && maxPrice == null) return ''
    if (minPrice == null) return formatBrl(maxPrice)
    if (maxPrice == null) return formatBrl(minPrice)
    if (Math.abs(Number(minPrice) - Number(maxPrice)) < 0.001) return formatBrl(minPrice)
    return `${formatBrl(minPrice)} - ${formatBrl(maxPrice)}`
  }

  function totalRecords(list) {
    const total = Number(list?.totalNumRecs ?? list?.['endeca:numRecords'])
    if (Number.isFinite(total)) return total
    return Array.isArray(list?.records) ? list.records.length : 0
  }

  async function collectResearchRows(options = {}, fetchPayloadImpl = fetchPayload) {
    const sourceUrl = compact(options.category_url || options.categoryUrl || DEFAULT_SOURCE_URL)
    const maxCategories = toInt(options.max_categories ?? options.maxCategories, 30, 1, 100)
    const requestDelayMs = toInt(options.request_delay_ms ?? options.requestDelayMs, 250, 0, 10000)
    const origin = parseUrl(sourceUrl)?.origin || 'https://www.lojasrenner.com.br'
    const sourcePayload = await fetchPayloadImpl(normalizeCategoryApiUrl(sourceUrl, origin))
    const targets = resolveCategoryTargets(options.category_config || options.categories || '', sourcePayload, origin, maxCategories)
    if (!targets.length) throw new Error('未解析到可抓取的 Renner 儿童鞋服品类')

    const rows = []
    for (const target of targets) {
      const ascPayload = await fetchPayloadImpl(buildSortedCategoryApiUrl(target.apiUrl, 'asc', origin))
      const descPayload = await fetchPayloadImpl(buildSortedCategoryApiUrl(target.apiUrl, 'desc', origin))
      const ascList = findProductList(ascPayload)
      const descList = findProductList(descPayload)
      const minPrice = firstPriceFromList(ascList)
      const maxPrice = firstPriceFromList(descList)
      rows.push({
        '品类': target.outputName,
        'SKC 数量': totalRecords(ascList),
        '价格带': formatPriceBand(minPrice, maxPrice),
      })
      if (requestDelayMs > 0) await sleep(requestDelayMs)
    }
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
      DEFAULT_CATEGORY_LABELS,
      CATEGORY_NAME_MAP,
      normalizeCategoryApiUrl,
      buildSortedCategoryApiUrl,
      parseRennerPayload,
      findProductList,
      extractCategoryRefinements,
      translateCategoryName,
      parseConfiguredCategory,
      looksLikeUrlOrPath,
      resolveCategoryTargets,
      parsePrice,
      firstPriceFromList,
      formatBrl,
      formatPriceBand,
      collectResearchRows,
    })
    return complete([])
  }

  try {
    const rows = await collectResearchRows(params)
    return complete(rows, {
      notify_title: `Renner 儿童鞋服类目调研 ${rows.length} 个品类`,
      notify_body: `已汇总 ${rows.length} 个品类的 SKC 数量和价格带。`,
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
