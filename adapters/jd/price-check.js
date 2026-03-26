;(async () => {
  /**
   * 京东破价巡检
   *
   * 与 price-export.js 共享同样的抓取逻辑，
   * 额外对每个 SKU 做破价判断：
   *   current_price / original_price < threshold/100  → 破价
   *
   * 输出 data 只包含破价 SKU（violations），方便 notifier 直接使用。
   * meta.total_checked / meta.violations_count 汇总。
   */

  const params    = window.__CRAWSHRIMP_PARAMS__ || {}
  const page      = window.__CRAWSHRIMP_PAGE__ || 1
  const shopUrl   = params.shop_url || ''
  const threshold = (parseFloat(params.threshold) || 50) / 100   // 0~1

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

  function parseShopId(url) {
    const m1 = url.match(/index-(\d+)/)
    if (m1) return m1[1]
    const m2 = url.match(/shop_id=(\d+)/)
    if (m2) return m2[1]
    const m3 = url.match(/\/(\d{9,12})(?:[/?]|$)/)
    if (m3) return m3[1]
    return null
  }

  function buildSearchUrl(shopId, pageNo, size = 60) {
    return `https://mall.jd.com/advance_search-${shopId}-${shopId}-${shopId}-0-0-0-1-${pageNo}-${size}.html`
  }

  async function waitForProducts(timeout = 20000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (document.querySelectorAll('li.jSubObject').length > 0) { await sleep(3000); return true }
      await sleep(800)
    }
    return false
  }

  // ── 第一页导航 ───────────────────────────────────────────────────
  if (page === 1) {
    const shopId = parseShopId(shopUrl)
    if (!shopId) return { success: false, error: '无法解析店铺 ID' }

    if (!location.href.includes('advance_search')) {
      location.href = buildSearchUrl(shopId, 1, 60)
      await sleep(5000)
    }
    const ok = await waitForProducts(20000)
    if (!ok) return { success: false, error: '商品列表加载超时，请确认已登录 JD' }
  }

  // ── 滚动触发懒加载 + 等价格渲染 ─────────────────────────────────
  const totalHeight = document.body.scrollHeight
  for (let i = 1; i <= 8; i++) { window.scrollTo(0, (totalHeight / 8) * i); await sleep(200) }
  window.scrollTo(0, 0); await sleep(800)
  for (let i = 0; i < 10; i++) {
    if ([...document.querySelectorAll('span.jdNum')].filter(el => el.innerText.trim()).length > 0) break
    await sleep(500)
  }

  // ── 抓取 + API 补价（同 price-export.js）────────────────────────
  const items = []
  document.querySelectorAll('li.jSubObject').forEach(li => {
    const priceEl = li.querySelector('span.jdNum')
    if (!priceEl) return
    const skuId = priceEl.getAttribute('jdprice') || ''
    if (!skuId) return
    const price     = priceEl.innerText.trim().replace(/[^0-9.]/g, '') || null
    const prePrice  = (priceEl.getAttribute('preprice') || '').replace(/[^0-9.]/g, '') || null
    const descEl    = li.querySelector('.jDesc a')
    const name      = descEl?.innerText.trim() || ''
    const linkEl    = li.querySelector('a[href*="item.jd.com"]')
    const href      = linkEl ? linkEl.href.split('?')[0] : `https://item.jd.com/${skuId}.html`
    items.push({ skuId, name, price, originalPrice: prePrice, href })
  })

  if (items.length > 0) {
    const missingSkus = items.filter(i => !i.price).map(i => i.skuId)
    if (missingSkus.length > 0) {
      const priceMap = await new Promise(resolve => {
        const map = {}
        const skuParam = missingSkus.map(id => 'J_' + id).join(',')
        const xhr = new XMLHttpRequest()
        xhr.open('GET', `https://p.3.cn/prices/mgets?skuIds=${skuParam}&type=1&area=1_72_2799_0`, true)
        xhr.timeout = 8000
        xhr.onload = () => {
          try { JSON.parse(xhr.responseText).forEach(item => { map[item.id.replace('J_', '')] = { price: item.p, originalPrice: item.op || item.m } }) } catch(e) {}
          resolve(map)
        }
        xhr.onerror = xhr.ontimeout = () => resolve(map)
        xhr.send()
      })
      items.forEach(item => {
        if (!item.price && priceMap[item.skuId]) {
          item.price = priceMap[item.skuId].price || null
          item.originalPrice = item.originalPrice || priceMap[item.skuId].originalPrice || null
        }
      })
    }
  }

  // ── 破价判断 ─────────────────────────────────────────────────────
  const violations = []
  for (const item of items) {
    const cur  = item.price         ? parseFloat(item.price)         : null
    const orig = item.originalPrice ? parseFloat(item.originalPrice) : null
    if (cur === null || orig === null || orig <= 0) continue
    const ratio = cur / orig
    if (ratio < threshold) {
      violations.push({
        'SKU ID':     item.skuId,
        '商品名称':   item.name,
        '页面价':     cur,
        '吊牌价':     orig,
        '折扣':       `${(ratio * 100).toFixed(1)}%`,
        '阈值':       `${(threshold * 100).toFixed(0)}%`,
        '商品链接':   item.href,
      })
    }
  }

  // ── 下一页 ───────────────────────────────────────────────────────
  const nextLink = [...document.querySelectorAll('a')].find(a => a.innerText.trim() === '下一页')
  const nextUrl  = nextLink?.href || null
  if (nextUrl) { location.href = nextUrl; await sleep(1000) }

  return {
    success: true,
    data: violations,
    meta: {
      has_more:          !!nextUrl,
      total_checked:     items.length,
      violations_count:  violations.length,
      threshold_pct:     Math.round(threshold * 100),
    }
  }
})()
