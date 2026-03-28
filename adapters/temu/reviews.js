;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = window.__CRAWSHRIMP_PAGE__ || 1
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const shopUrl = String(params.shop_url || '').trim()
  const mode = String(params.mode || 'new').trim().toLowerCase()

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

  async function waitForCards(timeout = 10000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (document.querySelectorAll('div._9WTBQrvq').length > 0) return true
      await sleep(400)
    }
    return false
  }

  function clickReviewsTab() {
    for (const el of document.querySelectorAll('h2._2kIA1PhC')) {
      const t = el.innerText.trim()
      if (t === '评价' || t.toLowerCase() === 'reviews') {
        el.click()
        return true
      }
    }
    return false
  }

  function goToFirstPage() {
    const p1 = document.querySelector('li.temu-pagination-item-1')
    if (p1) {
      p1.click()
      return true
    }
    return false
  }

  function hasNextPage() {
    const nextEl = document.querySelector('li.temu-pagination-next')
    return !!(
      nextEl &&
      nextEl.getAttribute('aria-disabled') !== 'true' &&
      !nextEl.classList.contains('temu-pagination-disabled')
    )
  }

  function clickNextPage() {
    const nextEl = document.querySelector('li.temu-pagination-next')
    if (!nextEl) return false
    if (nextEl.getAttribute('aria-disabled') === 'true' || nextEl.classList.contains('temu-pagination-disabled')) {
      return false
    }
    nextEl.click()
    return true
  }

  async function waitUserChange(oldUser, timeout = 10000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      await sleep(400)
      const newUser = document.querySelector('div._9WTBQrvq .XTEkYdlM')?.innerText.trim() || ''
      if (newUser && newUser !== oldUser) return true
    }
    return false
  }

  function scrapeCards() {
    const results = []
    const cards = document.querySelectorAll('div._9WTBQrvq')

    for (const card of cards) {
      const r = {}
      r.username = card.querySelector('.XTEkYdlM')?.innerText.trim() || ''

      const metaEl = card.querySelector('._1tSRIohB')
      const ariaLabel = metaEl ? (metaEl.getAttribute('aria-label') || '').replace(/\u00a0/g, ' ').trim() : ''
      r.country = ''
      r.purchaseDate = ''
      if (ariaLabel) {
        const enB = ariaLabel.match(/^in\s+(.+?)\s+on\s+(.+)$/i)
        if (enB) {
          r.country = enB[1].trim()
          r.purchaseDate = enB[2].trim()
        } else {
          const cnOrEnA = ariaLabel.match(/(?:来自|From)\s*([^\u00b7\s·]+)/i)
          r.country = cnOrEnA ? cnOrEnA[1].trim() : ''
          const dM = ariaLabel.match(/[\u00b7·]\s*(.+)$/)
          r.purchaseDate = dM ? dM[1].trim() : ''
        }
      }

      const starEl = card.querySelector('._7JDNQb0g._1uEtAYnT,[aria-label*="out of"],[aria-label*="stars"],[aria-label*="星（满分"]')
      r.stars = ''
      if (starEl) {
        const sl = starEl.getAttribute('aria-label') || ''
        const sm = sl.match(/^([0-9.]+)/) || sl.match(/Rated\s+([0-9.]+)/i)
        if (sm) r.stars = sm[1]
        else {
          const words = ['one', 'two', 'three', 'four', 'five']
          for (let wi = 0; wi < words.length; wi++) {
            if (sl.toLowerCase().includes(words[wi])) {
              r.stars = String(wi + 1)
              break
            }
          }
        }
      }

      let specEl = card.querySelector('._2QI6iM-X,._2Y-spytg,._35Cqvk-G')
      if (!specEl) {
        for (const el of card.querySelectorAll('*')) {
          const lt = el.children.length === 0 ? el.innerText?.trim() : ''
          if (
            lt &&
            (
              lt.startsWith('购买：') ||
              lt.startsWith('Purchased:') ||
              lt.startsWith('Color:') ||
              lt.startsWith('Style:') ||
              lt.startsWith('规格：') ||
              lt.startsWith('Overall fit:')
            )
          ) {
            specEl = el
            break
          }
        }
      }
      r.spec = specEl?.innerText.trim() || ''

      const leafTexts = []
      for (const el of card.querySelectorAll('*')) {
        const t = el.children.length === 0 ? el.innerText?.trim() : ''
        if (!t || t.length <= 10) continue
        if (t === r.username || t === r.spec) continue
        if (t.startsWith('购买于') || t.startsWith('Purchased on')) continue
        if (/^[0-9.]+星/.test(t) || /^[0-9.]+ out of/i.test(t) || /^Rated [0-9]/i.test(t)) continue
        if (/^已售/.test(t) || /^Sold\s/i.test(t)) continue
        leafTexts.push(t)
      }

      const translated = leafTexts.filter(x => !x.startsWith('Review before translation:'))
      r.reviewText = translated.sort((a, b) => b.length - a.length)[0] || ''
      const origArr = leafTexts.filter(x => x.startsWith('Review before translation:'))
      r.reviewOriginal = origArr[0] ? origArr[0].replace('Review before translation:', '').trim() : ''

      const imgs = [...card.querySelectorAll('img')]
        .map(img => img.src)
        .filter(src => src && !src.includes('avatar.') && !src.includes('/flags/') && !src.includes('aimg.kwcdn'))
      r.images = imgs.join('|')

      if (r.username || r.reviewText) results.push({
        '用户名': r.username,
        '来源国家': r.country,
        '购买日期': r.purchaseDate,
        '购买规格': r.spec,
        '评价内容': r.reviewText,
        '原文': r.reviewOriginal,
        '星级': r.stars,
        '评价图片': r.images,
      })
    }

    return results
  }

  try {
    if (phase === 'main') {
      if (!shopUrl) return { success: false, error: '缺少店铺链接 shop_url' }
      if (page === 1) return nextPhase('ensure_target', 0)
      return nextPhase('turn_page', 0)
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
      if (!navOk) {
        if (isUnavailableStore()) {
          return { success: false, error: '当前 Temu 店铺页显示“店铺不可用”，无法进入 Reviews 页面' }
        }
        return { success: false, error: '未找到 Temu 店铺导航区域，请确认店铺链接正确' }
      }
      return nextPhase('prepare_page1', 200)
    }

    if (phase === 'prepare_page1') {
      const clicked = clickReviewsTab()
      if (!clicked) {
        if (isUnavailableStore()) {
          return { success: false, error: '当前 Temu 店铺页显示“店铺不可用”，无法进入 Reviews 页面' }
        }
        return { success: false, error: '未找到评价/Reviews 标签' }
      }
      await sleep(2000)
      goToFirstPage()
      await sleep(1200)
      const ok = await waitForCards(10000)
      if (!ok) return { success: false, error: '未找到评价内容，请确认店铺页面存在 Reviews 数据' }
      return nextPhase('collect', 200)
    }

    if (phase === 'turn_page') {
      const ok = await waitForCards(10000)
      if (!ok) return { success: false, error: '评价列表未加载' }
      if (!hasNextPage()) return complete([], false)
      const firstUser = document.querySelector('div._9WTBQrvq .XTEkYdlM')?.innerText.trim() || ''
      clickNextPage()
      const changed = await waitUserChange(firstUser, 10000)
      if (!changed) return { success: false, error: '评价列表翻页失败' }
      return nextPhase('collect', 200)
    }

    if (phase === 'collect') {
      const ok = await waitForCards(10000)
      if (!ok) return { success: false, error: '评价列表未加载' }
      const data = scrapeCards()
      return complete(data, hasNextPage())
    }

    return { success: false, error: `未知 phase: ${phase}` }
  } catch (e) {
    return { success: false, error: e.message }
  }
})()
