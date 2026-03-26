;(async () => {
  const params  = window.__CRAWSHRIMP_PARAMS__ || {}
  const page    = window.__CRAWSHRIMP_PAGE__ || 1
  const shopUrl = params.shop_url || ''

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

  // ── 第一页：导航 + 点「商品/Items」tab + 加载全量 ─────────────
  if (page === 1) {
    if (shopUrl) {
      const curPath = location.pathname + location.search
      const tgtPath = new URL(shopUrl).pathname + new URL(shopUrl).search
      if (!curPath.startsWith(tgtPath.slice(0, 30))) {
        location.href = shopUrl
        await sleep(4000)
      }
    }

    // 等待 nav 渲染
    let waited = 0
    while (document.querySelectorAll('h2._2kIA1PhC').length === 0 && waited < 8000) {
      await sleep(500); waited += 500
    }

    // 点「商品/Items」tab
    let clicked = false
    for (const el of document.querySelectorAll('h2._2kIA1PhC')) {
      const t = el.innerText.trim()
      if (t === '商品' || t === 'Items') { el.click(); clicked = true; break }
    }
    await sleep(2000)

    // 获取总数
    function getGoodsTotal() {
      const containers = document.querySelectorAll('._17RAYb2C._2vH-84kZ')
      for (const c of containers) {
        const text = c.innerText
        if (text.includes('商品') || text.includes('Items')) {
          const numEl = c.querySelector('._2VVwJmfY')
          if (numEl) return parseInt(numEl.innerText.trim().replace(/,/g, '')) || 0
        }
      }
      const countEl = document.querySelector('._25EQ1kor')
      if (countEl) {
        const m = countEl.innerText.trim().match(/^(\d[\d,]*)/)
        if (m) return parseInt(m[1].replace(/,/g, ''))
      }
      return 0
    }

    const total = getGoodsTotal()
    let cur = document.querySelectorAll('div._6q6qVUF5._1UrrHYym').length

    // 点「查看更多/See more」直到全量
    if (total > cur) {
      let noChangeCount = 0
      let prevCount = cur
      for (let i = 0; i < 50; i++) {
        // 找商品列表区域的 See more 按钮
        const btn = document.querySelector('[aria-label="See more items"][role="button"]') ||
          document.querySelector('[aria-label="查看更多商品"][role="button"]')
        if (!btn) break

        btn.scrollIntoView({ block: 'center' })
        btn.click()
        await sleep(1500)

        cur = document.querySelectorAll('div._6q6qVUF5._1UrrHYym').length
        if (cur >= total) break
        if (cur === prevCount) {
          noChangeCount++
          if (noChangeCount >= 3) break
        } else {
          noChangeCount = 0
        }
        prevCount = cur
      }
    }
  }

  // ── 抓取商品数据（分批，每次 page 抓 50 条）────────────────────
  const BATCH = 50
  const offset = (page - 1) * BATCH
  const cards = document.querySelectorAll('div._6q6qVUF5._1UrrHYym')
  const total = cards.length

  if (offset >= total) {
    return { success: true, data: [], meta: { has_more: false } }
  }

  const end = Math.min(offset + BATCH, total)
  const results = []

  for (let i = offset; i < end; i++) {
    const card = cards[i]
    const r = {}

    // 链接
    const linkEl = card.querySelector('a[href*="-g-"]')
    r['商品链接'] = linkEl?.href || ''

    // 名称
    r['商品名称'] = card.getAttribute('data-tooltip-title') || ''
    if (!r['商品名称'] && linkEl) {
      r['商品名称'] = linkEl.innerText.trim()
        .replace(/在新标签页中打开。/g, '')
        .replace(/Open in a new tab\./gi, '')
        .trim().split('\n')[0]
    }

    // 主图
    const mainImg = card.querySelector('img[data-js-main-img="true"]') ||
      card.querySelector('img[src*="kwcdn.com/product"]')
    r['商品图片'] = mainImg?.src || ''

    // 价格（收集 ¥/$/€/£ 格式的价格）
    const prices = []
    for (const el of card.querySelectorAll('*')) {
      const txt = el.children.length === 0 ? el.innerText?.trim() : ''
      if (txt && (txt.match(/^[A-Z]{0,3}\$[\d.]+$/) || txt.match(/^[¥€£][\d,.]+$/))) {
        if (!prices.includes(txt)) prices.push(txt)
      }
    }
    r['价格'] = prices[0] || ''
    r['原价'] = prices[1] || ''

    // 销量
    r['销量'] = ''
    const soldEls = card.querySelectorAll('._2XgTiMJi')
    for (const el of soldEls) {
      const t = el.innerText.trim()
      if (t.startsWith('已售') || /^[Ss]old/i.test(t) || /^\d+.*(?:件|sold)/i.test(t)) {
        r['销量'] = t.replace(/^已售/, '').replace(/^[Ss]old\s*/i, '').replace(/sold$/i, '')
        break
      }
    }
    if (!r['销量']) {
      for (const el of card.querySelectorAll('*')) {
        const t = el.children.length === 0 ? el.innerText?.trim() : ''
        if (t && (t.match(/^[\d.万千,]+件$/) || t.toLowerCase().match(/^[\d,]+\s*sold/))) {
          r['销量'] = t; break
        }
      }
    }

    // 评分
    r['评分'] = ''
    for (const el of card.querySelectorAll('*')) {
      const t = el.children.length === 0 ? el.innerText?.trim() : ''
      if (t && (t.match(/^[1-5]星/) || t.match(/^[1-5]\s*star/i))) {
        r['评分'] = t; break
      }
    }

    // goods_id
    const tooltip = card.getAttribute('data-tooltip') || ''
    const m1 = tooltip.match(/goodContainer-(\d+)/)
    r['goods_id'] = m1 ? m1[1] : (r['商品链接'].match(/g-(\d+)\.html/) || ['',''])[1]

    if (r['商品名称'] || r['商品链接']) results.push(r)
  }

  return {
    success: true,
    data: results,
    meta: { has_more: end < total }
  }
})()
