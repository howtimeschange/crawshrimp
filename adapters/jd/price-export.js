;(async () => {
  /**
   * 京东店铺价格导出
   * 
   * 流程：
   *   page=1  解析 shop_url → 构造 advance_search URL → 导航 → 抓第1页
   *   page=N  直接抓当前页（由上一页 meta.next_url 驱动翻页导航）
   *
   * 价格抓取策略：
   *   1. 滚动触发懒加载
   *   2. 读取 li.jSubObject 里 span.jdNum 的价格
   *   3. 对仍无价格的 SKU，调用 p.3.cn/prices/mgets API 补查
   */

  const params   = window.__CRAWSHRIMP_PARAMS__ || {}
  const page     = window.__CRAWSHRIMP_PAGE__ || 1
  const shopUrl  = params.shop_url || ''
  const pageSize = parseInt(params.page_size || '60')

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

  // ── 解析 shop_id / vendor_id ────────────────────────────────────
  function parseShopId(url) {
    const m1 = url.match(/index-(\d+)/)
    if (m1) return m1[1]
    const m2 = url.match(/shop_id=(\d+)/)
    if (m2) return m2[1]
    const m3 = url.match(/\/(\d{9,12})(?:[/?]|$)/)
    if (m3) return m3[1]
    return null
  }

  // ── 构造搜索页 URL ───────────────────────────────────────────────
  function buildSearchUrl(shopId, pageNo, size) {
    // advance_search URL 格式（vendor_id 通常与 shop_id 相同，或需从页面读取）
    // 先用 shop_id 同值作为 vendor_id，大多数店铺可用
    return `https://mall.jd.com/advance_search-${shopId}-${shopId}-${shopId}-0-0-0-1-${pageNo}-${size}.html`
  }

  // ── 等待商品列表加载 ─────────────────────────────────────────────
  async function waitForProducts(timeout = 20000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const n = document.querySelectorAll('li.jSubObject').length
      if (n > 0) { await sleep(3000); return n }  // 保守等 3s 让价格 JS 渲染
      await sleep(800)
    }
    return 0
  }

  // ── 第一页：导航到店铺商品列表 ──────────────────────────────────
  if (page === 1) {
    const shopId = parseShopId(shopUrl)
    if (!shopId) {
      return { success: false, error: '无法从链接中解析店铺 ID，请检查 URL 格式' }
    }

    const searchUrl = buildSearchUrl(shopId, 1, pageSize)
    if (!location.href.includes('advance_search')) {
      location.href = searchUrl
      await sleep(5000)
    }

    const n = await waitForProducts(20000)
    if (n === 0) {
      return { success: false, error: '商品列表加载超时，请确认已登录 JD 且店铺地址正确' }
    }
  }

  // ── 分段滚动，触发懒加载 ─────────────────────────────────────────
  const totalHeight = document.body.scrollHeight
  for (let i = 1; i <= 8; i++) {
    window.scrollTo(0, (totalHeight / 8) * i)
    await sleep(200)
  }
  window.scrollTo(0, 0)
  await sleep(800)

  // ── 等价格元素填充 ───────────────────────────────────────────────
  for (let i = 0; i < 10; i++) {
    const filled = [...document.querySelectorAll('span.jdNum')].filter(el => el.innerText.trim()).length
    if (filled > 0) break
    await sleep(500)
  }

  // ── 抓取当前页商品 ───────────────────────────────────────────────
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

  if (items.length === 0) {
    return { success: true, data: [], meta: { has_more: false } }
  }

  // ── 对空价格 SKU 用 p.3.cn API 补查 ─────────────────────────────
  const missingSkus = items.filter(i => !i.price).map(i => i.skuId)
  if (missingSkus.length > 0) {
    const priceMap = await new Promise(resolve => {
      const map = {}
      const skuParam = missingSkus.map(id => 'J_' + id).join(',')
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
        item.price         = priceMap[item.skuId].price || null
        item.originalPrice = item.originalPrice || priceMap[item.skuId].originalPrice || null
        item.priceSource   = 'api'
      }
    })
  }

  // ── 下一页链接 ───────────────────────────────────────────────────
  const nextLink = [...document.querySelectorAll('a')].find(a => a.innerText.trim() === '下一页')
  const nextUrl  = nextLink?.href || null

  // 如果有下一页，提前导航（让下次调用时页面已加载）
  if (nextUrl) {
    location.href = nextUrl
    // 不等待，直接返回。js_runner 下次调用（page+1）时会 waitForProducts
    await sleep(1000)
  }

  // ── 转换为标准 data 格式 ─────────────────────────────────────────
  const data = items.map(item => ({
    'SKU ID':   item.skuId,
    '商品名称': item.name,
    '页面价':   item.price   ? parseFloat(item.price)         : '',
    '吊牌价':   item.originalPrice ? parseFloat(item.originalPrice) : '',
    '价格来源': item.priceSource === 'api' ? 'API补查' : '列表页',
    '商品链接': item.href,
  }))

  const withPrice = items.filter(i => i.price).length
  return {
    success: true,
    data,
    meta: {
      has_more:   !!nextUrl,
      page:       page,
      count:      items.length,
      with_price: withPrice,
      missing:    items.length - withPrice,
    }
  }
})()
