;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = window.__CRAWSHRIMP_PAGE__ || 1
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const shopUrl = String(params.shop_url || '').trim()
  const mode = String(params.mode || 'new').trim().toLowerCase()
  const BATCH = 50

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

  function isSameShopPage() {
    try {
      const target = new URL(shopUrl)
      const current = new URL(location.href)
      const targetMallId = target.searchParams.get('mall_id') || ''
      const currentMallId = current.searchParams.get('mall_id') || ''
      if (targetMallId && currentMallId) return targetMallId === currentMallId
      return current.origin === target.origin && current.pathname === target.pathname
    } catch (e) {
      return !!(shopUrl && location.href.startsWith(shopUrl.slice(0, 30)))
    }
  }

  function isUnavailableStore() {
    return /This store is unavailable|店铺不可用/i.test(document.body?.innerText || '')
  }

  async function waitForNav(timeout = 10000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (document.querySelectorAll('h2._2kIA1PhC').length > 0) return true
      await sleep(500)
    }
    return false
  }

  async function waitForCards(timeout = 12000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (document.querySelectorAll('div._6q6qVUF5._1UrrHYym').length > 0) return true
      await sleep(500)
    }
    return false
  }

  function clickItemsTab() {
    for (const el of document.querySelectorAll('h2._2kIA1PhC')) {
      const t = el.innerText.trim()
      if (t === '商品' || t === 'Items') {
        el.click()
        return true
      }
    }
    return false
  }

  function getGoodsTotal() {
    const containers = document.querySelectorAll('._17RAYb2C._2vH-84kZ')
    for (const c of containers) {
      const text = c.innerText
      if (text.includes('商品') || text.includes('Items')) {
        const numEl = c.querySelector('._2VVwJmfY')
        if (numEl) return parseInt(numEl.innerText.trim().replace(/,/g, ''), 10) || 0
      }
    }
    const countEl = document.querySelector('._25EQ1kor')
    if (countEl) {
      const m = countEl.innerText.trim().match(/^(\d[\d,]*)/)
      if (m) return parseInt(m[1].replace(/,/g, ''), 10)
    }
    return 0
  }

  async function loadAllItems() {
    const total = getGoodsTotal()
    let cur = document.querySelectorAll('div._6q6qVUF5._1UrrHYym').length
    if (total <= cur) return

    let noChangeCount = 0
    let prevCount = cur
    for (let i = 0; i < 60; i++) {
      const btn =
        document.querySelector('[aria-label="See more items"][role="button"]') ||
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

  function scrapeBatch(offset, end) {
    const cards = document.querySelectorAll('div._6q6qVUF5._1UrrHYym')
    const results = []

    for (let i = offset; i < end; i++) {
      const card = cards[i]
      if (!card) continue
      const r = {}

      const linkEl = card.querySelector('a[href*="-g-"]')
      r['商品链接'] = linkEl?.href || ''

      r['商品名称'] = card.getAttribute('data-tooltip-title') || ''
      if (!r['商品名称'] && linkEl) {
        r['商品名称'] = linkEl.innerText.trim()
          .replace(/在新标签页中打开。/g, '')
          .replace(/Open in a new tab\./gi, '')
          .trim()
          .split('\n')[0]
      }

      const mainImg =
        card.querySelector('img[data-js-main-img="true"]') ||
        card.querySelector('img[src*="kwcdn.com/product"]')
      r['商品图片'] = mainImg?.src || ''

      const prices = []
      for (const el of card.querySelectorAll('*')) {
        const txt = el.children.length === 0 ? el.innerText?.trim() : ''
        if (txt && (txt.match(/^[A-Z]{0,3}\$[\d.]+$/) || txt.match(/^[¥€£][\d,.]+$/))) {
          if (!prices.includes(txt)) prices.push(txt)
        }
      }
      r['价格'] = prices[0] || ''
      r['原价'] = prices[1] || ''

      r['销量'] = ''
      for (const el of card.querySelectorAll('._2XgTiMJi')) {
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
            r['销量'] = t
            break
          }
        }
      }

      r['评分'] = ''
      for (const el of card.querySelectorAll('*')) {
        const t = el.children.length === 0 ? el.innerText?.trim() : ''
        if (t && (t.match(/^[1-5]星/) || t.match(/^[1-5]\s*star/i))) {
          r['评分'] = t
          break
        }
      }

      const tooltip = card.getAttribute('data-tooltip') || ''
      const m1 = tooltip.match(/goodContainer-(\d+)/)
      r['goods_id'] = m1 ? m1[1] : ((r['商品链接'].match(/g-(\d+)\.html/) || ['', ''])[1])

      if (r['商品名称'] || r['商品链接']) results.push(r)
    }

    return results
  }

  try {
    if (phase === 'main') {
      if (!shopUrl) return { success: false, error: '缺少店铺链接 shop_url' }
      if (page === 1) return nextPhase('ensure_target', 0)
      return nextPhase('collect_batch', 0)
    }

    if (phase === 'ensure_target') {
      if (location.href.includes('/login.html')) {
        return { success: false, error: '当前 Temu 店铺链接被重定向到登录页，请先完成 Temu 登录或更换可直接访问的店铺链接' }
      }
      if (!isSameShopPage()) {
        location.href = shopUrl
        return nextPhase('ensure_target', mode === 'new' ? 1800 : 1200)
      }
      const navOk = await waitForNav(10000)
      const cardsOk = await waitForCards(2000)
      if (!navOk && !cardsOk && !isUnavailableStore()) {
        return { success: false, error: '未找到 Temu 店铺导航区域，请确认店铺链接正确' }
      }
      return nextPhase('prepare_page1', 200)
    }

    if (phase === 'prepare_page1') {
      const clicked = clickItemsTab()
      if (clicked) await sleep(2000)
      const ok = await waitForCards(12000)
      if (!ok) {
        if (isUnavailableStore()) {
          return { success: false, error: '当前 Temu 店铺页显示“店铺不可用”，无法抓取商品列表' }
        }
        return { success: false, error: '未找到商品卡片，请确认店铺页面存在商品数据' }
      }
      await loadAllItems()
      await sleep(500)
      return nextPhase('collect_batch', 200)
    }

    if (phase === 'collect_batch') {
      const ok = await waitForCards(12000)
      if (!ok) return { success: false, error: '商品卡片未加载' }
      const total = document.querySelectorAll('div._6q6qVUF5._1UrrHYym').length
      const offset = (page - 1) * BATCH
      if (offset >= total) return complete([], false)
      const end = Math.min(offset + BATCH, total)
      const data = scrapeBatch(offset, end)
      return complete(data, end < total)
    }

    return { success: false, error: `未知 phase: ${phase}` }
  } catch (e) {
    return { success: false, error: e.message }
  }
})()
