;(async () => {
  const params   = window.__CRAWSHRIMP_PARAMS__ || {}
  const page     = window.__CRAWSHRIMP_PAGE__ || 1
  const shopUrl  = params.shop_url || ''

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

  // ── 第一页：导航 + 点评价 tab + 回第1页 ─────────────────────
  if (page === 1) {
    if (shopUrl) {
      if (location.href !== shopUrl && !location.href.includes(new URL(shopUrl).pathname.slice(0, 30))) {
        location.href = shopUrl
        await sleep(4000)
      }
    }

    // 等待 nav 渲染
    let waited = 0
    while (document.querySelectorAll('h2._2kIA1PhC').length === 0 && waited < 8000) {
      await sleep(500); waited += 500
    }

    // 点「评价/Reviews」tab
    const navItems = document.querySelectorAll('h2._2kIA1PhC')
    let clicked = false
    for (const el of navItems) {
      const t = el.innerText.trim()
      if (t === '评价' || t.toLowerCase() === 'reviews') { el.click(); clicked = true; break }
    }
    await sleep(2000)

    // 跳回第1页
    const p1 = document.querySelector('li.temu-pagination-item-1')
    if (p1) { p1.click(); await sleep(1500) }
  }

  // ── 抓取当前页评价 ────────────────────────────────────────────
  const cards = document.querySelectorAll('div._9WTBQrvq')
  if (cards.length === 0 && page === 1) {
    return { success: false, error: '未找到评价内容，请确认已打开正确的 Temu 店铺页面' }
  }

  const results = []
  for (const card of cards) {
    const r = {}

    // 用户名
    r.username = card.querySelector('.XTEkYdlM')?.innerText.trim() || ''

    // 国家 + 购买日期
    const metaEl = card.querySelector('._1tSRIohB')
    const ariaLabel = metaEl ? (metaEl.getAttribute('aria-label') || '').replace(/\u00a0/g, ' ').trim() : ''
    r.country = ''; r.purchaseDate = ''
    if (ariaLabel) {
      const enB = ariaLabel.match(/^in\s+(.+?)\s+on\s+(.+)$/i)
      if (enB) {
        r.country = enB[1].trim(); r.purchaseDate = enB[2].trim()
      } else {
        const cnOrEnA = ariaLabel.match(/(?:来自|From)\s*([^\u00b7\s·]+)/i)
        r.country = cnOrEnA ? cnOrEnA[1].trim() : ''
        const dM = ariaLabel.match(/[\u00b7·]\s*(.+)$/)
        r.purchaseDate = dM ? dM[1].trim() : ''
      }
    }

    // 星级
    const starEl = card.querySelector('._7JDNQb0g._1uEtAYnT,[aria-label*="out of"],[aria-label*="stars"],[aria-label*="星（满分"]')
    r.stars = ''
    if (starEl) {
      const sl = starEl.getAttribute('aria-label') || ''
      const sm = sl.match(/^([0-9.]+)/) || sl.match(/Rated\s+([0-9.]+)/i)
      if (sm) r.stars = sm[1]
      else {
        const words = ['one','two','three','four','five']
        for (let wi = 0; wi < words.length; wi++) {
          if (sl.toLowerCase().includes(words[wi])) { r.stars = String(wi + 1); break }
        }
      }
    }

    // 购买规格
    let specEl = card.querySelector('._2QI6iM-X,._2Y-spytg,._35Cqvk-G')
    if (!specEl) {
      for (const el of card.querySelectorAll('*')) {
        const lt = el.children.length === 0 ? el.innerText?.trim() : ''
        if (lt && (lt.startsWith('购买：') || lt.startsWith('Purchased:') ||
            lt.startsWith('Color:') || lt.startsWith('Style:') ||
            lt.startsWith('规格：') || lt.startsWith('Overall fit:'))) {
          specEl = el; break
        }
      }
    }
    r.spec = specEl?.innerText.trim() || ''

    // 评价正文（翻译版）+ 原文
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

    // 评价图片（排除头像/国旗）
    const imgs = [...card.querySelectorAll('img')]
      .map(img => img.src)
      .filter(src => src && !src.includes('avatar.') && !src.includes('/flags/') && !src.includes('aimg.kwcdn'))
    r.images = imgs.join('|')

    if (r.username || r.reviewText) results.push(r)
  }

  // 判断是否有下一页
  const nextEl = document.querySelector('li.temu-pagination-next')
  const hasMore = nextEl &&
    nextEl.getAttribute('aria-disabled') !== 'true' &&
    !nextEl.classList.contains('temu-pagination-disabled')

  if (hasMore) {
    // 记录第一条用户名，翻页
    const firstUser = document.querySelector('div._9WTBQrvq .XTEkYdlM')?.innerText.trim() || ''
    nextEl.click()

    // 等待翻页完成（用户名变化）
    const t0 = Date.now()
    while (Date.now() - t0 < 10000) {
      await sleep(400)
      const newUser = document.querySelector('div._9WTBQrvq .XTEkYdlM')?.innerText.trim() || ''
      if (newUser && newUser !== firstUser) break
    }
  }

  const data = results.map(r => ({
    '用户名': r.username,
    '来源国家': r.country,
    '购买日期': r.purchaseDate,
    '购买规格': r.spec,
    '评价内容': r.reviewText,
    '原文': r.reviewOriginal,
    '星级': r.stars,
    '评价图片': r.images,
  }))

  return { success: true, data, meta: { has_more: !!hasMore } }
})()
