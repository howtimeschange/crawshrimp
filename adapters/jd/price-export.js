;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = window.__CRAWSHRIMP_PAGE__ || 1
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const shopUrl = String(params.shop_url || '').trim()
  const pageSize = parseInt(params.page_size || '60', 10) || 60

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

  function nextPhase(name, sleepMs = 800, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'next_phase', next_phase: name, sleep_ms: sleepMs, shared: newShared }
    }
  }

  function complete(data, hasMore = false, newShared = shared) {
    return {
      success: true,
      data,
      meta: { action: 'complete', has_more: hasMore, shared: newShared }
    }
  }

  function parseShopId(url) {
    const m1 = url.match(/index-(\d+)/)
    if (m1) return m1[1]
    const m2 = url.match(/shop_id=(\d+)/)
    if (m2) return m2[1]
    const m3 = url.match(/\/(\d{9,12})(?:[/?]|$)/)
    if (m3) return m3[1]
    return null
  }

  function buildSearchUrl(shopId, pageNo, size) {
    return `https://mall.jd.com/advance_search-${shopId}-${shopId}-${shopId}-0-0-0-1-${pageNo}-${size}.html`
  }

  async function waitForProducts(timeout = 20000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const n = document.querySelectorAll('li.jSubObject').length
      if (n > 0) {
        await sleep(1500)
        return n
      }
      await sleep(600)
    }
    return 0
  }

  async function warmUpList() {
    const totalHeight = Math.max(
      document.body?.scrollHeight || 0,
      document.documentElement?.scrollHeight || 0
    )
    for (let i = 1; i <= 8; i++) {
      window.scrollTo(0, (totalHeight / 8) * i)
      await sleep(180)
    }
    window.scrollTo(0, 0)
    await sleep(600)

    for (let i = 0; i < 10; i++) {
      const filled = [...document.querySelectorAll('span.jdNum')].filter(el => el.innerText.trim()).length
      if (filled > 0) return
      await sleep(400)
    }
  }

  async function fillMissingPrices(items) {
    const missingSkus = items.filter(i => !i.price).map(i => i.skuId)
    if (!missingSkus.length) return

    const priceMap = await new Promise(resolve => {
      const map = {}
      const skuParam = missingSkus.map(id => `J_${id}`).join(',')
      const xhr = new XMLHttpRequest()
      xhr.open('GET', `https://p.3.cn/prices/mgets?skuIds=${skuParam}&type=1&area=1_72_2799_0`, true)
      xhr.timeout = 8000
      xhr.onload = () => {
        try {
          JSON.parse(xhr.responseText).forEach(item => {
            map[item.id.replace('J_', '')] = { price: item.p, originalPrice: item.op || item.m }
          })
        } catch (e) {}
        resolve(map)
      }
      xhr.onerror = xhr.ontimeout = () => resolve(map)
      xhr.send()
    })

    items.forEach(item => {
      if (!item.price && priceMap[item.skuId]) {
        item.price = priceMap[item.skuId].price || null
        item.originalPrice = item.originalPrice || priceMap[item.skuId].originalPrice || null
        item.priceSource = 'api'
      }
    })
  }

  async function scrapeItems() {
    await warmUpList()

    const items = []
    document.querySelectorAll('li.jSubObject').forEach(li => {
      const priceEl = li.querySelector('span.jdNum')
      if (!priceEl) return
      const skuId = priceEl.getAttribute('jdprice') || ''
      if (!skuId) return

      const price = priceEl.innerText.trim().replace(/[^0-9.]/g, '') || null
      const prePrice = (priceEl.getAttribute('preprice') || '').replace(/[^0-9.]/g, '') || null
      const descEl = li.querySelector('.jDesc a')
      const name = descEl ? descEl.innerText.trim() : ''
      const linkEl = li.querySelector('a[href*="item.jd.com"]')
      const href = linkEl ? linkEl.href.split('?')[0] : `https://item.jd.com/${skuId}.html`

      items.push({ skuId, name, price, originalPrice: prePrice, href, priceSource: 'list' })
    })

    await fillMissingPrices(items)
    return items
  }

  function hasNextPage() {
    const nextLink = [...document.querySelectorAll('a')].find(a => a.innerText.trim() === '下一页')
    return !!(nextLink && nextLink.href)
  }

  try {
    if (phase === 'main') {
      return nextPhase('ensure_target', 0, { shopId: '', page })
    }

    if (phase === 'ensure_target') {
      const shopId = parseShopId(shopUrl)
      if (!shopId) {
        return { success: false, error: '无法从链接中解析店铺 ID，请检查 URL 格式' }
      }

      const searchUrl = buildSearchUrl(shopId, page, pageSize)
      if (location.href !== searchUrl) {
        location.href = searchUrl
        return nextPhase('ensure_target', 1800, { shopId, page })
      }

      const n = await waitForProducts(20000)
      if (n === 0) {
        return { success: false, error: '商品列表加载超时，请确认店铺地址正确或页面可访问' }
      }
      return nextPhase('collect', 200, { shopId, page })
    }

    if (phase === 'collect') {
      const items = await scrapeItems()
      const data = items.map(item => ({
        'SKU ID': item.skuId,
        '商品名称': item.name,
        '页面价': item.price ? parseFloat(item.price) : '',
        '吊牌价': item.originalPrice ? parseFloat(item.originalPrice) : '',
        '价格来源': item.priceSource === 'api' ? 'API补查' : '列表页',
        '商品链接': item.href,
      }))
      return complete(data, hasNextPage())
    }

    return { success: false, error: `未知 phase: ${phase}` }
  } catch (e) {
    return { success: false, error: e.message }
  }
})()
