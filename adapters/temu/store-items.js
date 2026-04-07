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

  function textOf(el) {
    return String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim()
  }

  function lowerText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
  }

  function randInt(min, max) {
    const lo = Math.ceil(Math.min(min, max))
    const hi = Math.floor(Math.max(min, max))
    return Math.floor(lo + Math.random() * (hi - lo + 1))
  }

  function withJitter(baseMs, spread = 0.25) {
    const base = Math.max(0, Number(baseMs) || 0)
    const delta = Math.round(base * Math.max(0, spread))
    return Math.max(0, base + randInt(-delta, delta))
  }

  async function sleepJitter(baseMs, spread = 0.25) {
    await sleep(withJitter(baseMs, spread))
  }

  function hasClassFragment(el, fragment) {
    return String(el?.className || '').includes(fragment)
  }

  function matchesExplorePicks(text) {
    return /Explore\s+Temu'?s\s+picks/i.test(textOf(text))
  }

  function matchesTopPicks(text) {
    return /Top picks for you/i.test(textOf(text))
  }

  function getGoodsSectionTitle(section) {
    if (!section) return ''
    const headingSelectors = ['._3ZhYwOCn', '._1V9kNqzx', 'h1', 'h2', 'h3']
    for (const sel of headingSelectors) {
      for (const el of section.querySelectorAll(sel)) {
        const text = textOf(el)
        if (text) return text
      }
    }
    return ''
  }

  function isExcludedGoodsSection(section) {
    return matchesExplorePicks(section) || matchesTopPicks(section)
  }

  function getStoreSections() {
    const sections = []
    for (const section of document.querySelectorAll('div.js-goods-list')) {
      if (isExcludedGoodsSection(section)) break
      sections.push(section)
    }
    return sections
  }

  function isExplorePicksCard(card) {
    const section = card?.closest('div.js-goods-list')
    return !!(section && matchesExplorePicks(getGoodsSectionTitle(section)))
  }

  function isExcludedGoodsCard(card) {
    const section = card?.closest('div.js-goods-list')
    return !!(section && isExcludedGoodsSection(section))
  }

  function getStoreCards() {
    const cards = []
    const seen = new Set()
    for (const section of getStoreSections()) {
      for (const card of section.querySelectorAll('div._6q6qVUF5._1UrrHYym')) {
        if (seen.has(card)) continue
        seen.add(card)
        cards.push(card)
      }
    }
    return cards
  }

  function getCardCount() {
    return getStoreCards().length
  }

  function isVisible(el) {
    if (!el) return false
    const style = window.getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.pointerEvents !== 'none' &&
      rect.width > 0 &&
      rect.height > 0
    )
  }

  function detectCaptchaState() {
    const bodyText = lowerText(document.body?.innerText || '')
    const titleText = lowerText(document.title || '')

    const textPatterns = [
      /验证码/,
      /安全验证/,
      /人机验证/,
      /滑块验证/,
      /请完成验证/,
      /验证后继续/,
      /captcha/,
      /security check/,
      /verify you are human/,
      /human verification/,
      /one more step/,
      /just a moment/,
      /checking your browser/,
      /access denied/,
      /blocked for security reasons/,
    ]

    for (const pattern of textPatterns) {
      if (pattern.test(bodyText) || pattern.test(titleText)) {
        return { present: true, reason: `text:${pattern.source}` }
      }
    }

    const selectors = [
      'iframe[src*="captcha"]',
      'iframe[src*="challenge"]',
      'iframe[src*="verify"]',
      'iframe[src*="recaptcha"]',
      'iframe[src*="hcaptcha"]',
      '[id*="captcha"]',
      '[class*="captcha"]',
      '[id*="challenge"]',
      '[class*="challenge"]',
      'input[name*="captcha"]',
      'form[action*="captcha"]',
    ]

    for (const sel of selectors) {
      try {
        if (document.querySelector(sel)) {
          return { present: true, reason: `selector:${sel}` }
        }
      } catch (e) {}
    }

    return { present: false, reason: '' }
  }

  function pauseForCaptcha(resumePhase, sharedState, sleepMs = 2800) {
    const captcha = detectCaptchaState()
    if (!captcha.present) return null
    return nextPhase('wait_verification', sleepMs, {
      ...sharedState,
      pause_reason: 'captcha',
      captcha_reason: captcha.reason,
      resume_phase: resumePhase,
      captcha_wait_rounds: Number(sharedState?.captcha_wait_rounds || 0),
    })
  }

  function clickLike(el) {
    if (!el) return false
    try { el.scrollIntoView({ block: 'center', inline: 'center' }) } catch (e) {}
    try { el.focus?.() } catch (e) {}
    try { el.click?.() } catch (e) {}
    for (const ev of ['pointerenter', 'pointerdown', 'pointerup']) {
      try {
        if (typeof PointerEvent !== 'undefined') {
          el.dispatchEvent(new PointerEvent(ev, { bubbles: true, cancelable: true }))
        }
      } catch (e) {}
    }
    for (const ev of ['mouseenter', 'mousedown', 'mouseup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true }))
      } catch (e) {}
    }
    return true
  }

  function parseDisplayedCount(raw, unit = '') {
    const text = String(raw || '').trim()
    if (!text) return 0

    if (unit) {
      const scaleMap = { k: 1e3, m: 1e6, b: 1e9 }
      const num = parseFloat(text.replace(/,/g, '.'))
      if (!Number.isFinite(num)) return 0
      return Math.round(num * (scaleMap[String(unit).toLowerCase()] || 1))
    }

    const num = parseInt(text.replace(/,/g, ''), 10)
    return Number.isFinite(num) ? num : 0
  }

  function extractLargestItemCount(text) {
    const matches = []
    const patterns = [
      /(\d+(?:[.,]\d+)?)\s*([KkMmBb])?\+?\s*(?:items|商品)\b/gi,
      /(?:items|商品)\s*(\d+(?:[.,]\d+)?)\s*([KkMmBb])?\+?/gi,
      /(\d[\d,]*)\s*(?:items|商品)\b/gi,
      /(?:items|商品)\s*(\d[\d,]*)/gi,
    ]

    for (const pattern of patterns) {
      for (const match of String(text || '').matchAll(pattern)) {
        const n = parseDisplayedCount(match[1] || '', match[2] || '')
        if (Number.isFinite(n) && n > 0) matches.push(n)
      }
    }

    return matches.length ? Math.max(...matches) : 0
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
      if (getCardCount() > 0) return true
      await sleep(500)
    }
    return false
  }

  function clickItemsTab() {
    for (const el of document.querySelectorAll('h2._2kIA1PhC')) {
      const t = el.innerText.trim()
      if (t === '商品' || t === 'Items') {
        clickLike(el)
        return true
      }
    }
    return false
  }

  function getGoodsTotal() {
    const sources = [
      document.body,
      ...document.querySelectorAll('._17RAYb2C._2vH-84kZ, ._25EQ1kor'),
    ].map(textOf)

    let total = 0
    for (const text of sources) {
      total = Math.max(total, extractLargestItemCount(text))
    }
    return total
  }

  function findSeeMoreButton() {
    if (detectCaptchaState().present) return null
    const selectors = ['button', '[role="button"]', 'a']
    const isMoreLabel = value => {
      const label = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
      return (
        label.includes('see more') ||
        label.includes('show more') ||
        label.includes('load more') ||
        label.includes('查看更多') ||
        label.includes('加载更多') ||
        label.includes('更多商品')
      )
    }

    const candidates = []
    for (const section of getStoreSections()) {
      const sectionTop = section.getBoundingClientRect().top
      const sectionTitle = getGoodsSectionTitle(section)
      for (const sel of selectors) {
        for (const el of section.querySelectorAll(sel)) {
          const label = String(el.getAttribute('aria-label') || el.innerText || el.textContent || '')
            .replace(/\s+/g, ' ')
            .trim()
          if (!label || !isMoreLabel(label)) continue
          if (el.matches('[disabled], [aria-disabled="true"]')) continue
          if (!isVisible(el)) continue
          candidates.push({
            el,
            sectionTop,
            buttonTop: el.getBoundingClientRect().top,
            sectionTitle,
            label,
          })
        }
      }
    }

    if (!candidates.length) return null
    candidates.sort((a, b) => b.sectionTop - a.sectionTop || b.buttonTop - a.buttonTop)
    return candidates[0].el || null
  }

  async function waitForCardGrowth(prevCount, timeout = 15000) {
    const t0 = Date.now()
    let lastCount = prevCount
    while (Date.now() - t0 < timeout) {
      const cur = getCardCount()
      if (cur > prevCount) return cur
      if (cur !== lastCount) lastCount = cur
      if (Date.now() - t0 > 4000) {
        try { window.scrollTo(0, document.body.scrollHeight) } catch (e) {}
      }
      await sleep(500)
    }
    return getCardCount()
  }

  function extractImageUrl(card) {
    const imageEl =
      card.querySelector('img[data-js-main-img="true"]') ||
      card.querySelector('img[src]') ||
      card.querySelector('img[data-src]') ||
      card.querySelector('img[data-original]')

    const src =
      imageEl?.currentSrc ||
      imageEl?.src ||
      imageEl?.getAttribute('src') ||
      imageEl?.getAttribute('data-src') ||
      imageEl?.getAttribute('data-original') ||
      ''
    if (src) return src

    const imageContainer = card.querySelector('.goods-image-container-external')
    if (imageContainer) {
      const bgEl =
        imageContainer.querySelector('[style*="background-image"]') ||
        imageContainer.querySelector('[style*="background"]')
      const styleText = String(bgEl?.getAttribute('style') || imageContainer.getAttribute('style') || '')
      const m = styleText.match(/background-image:\s*url\((['"]?)(.*?)\1\)/i) || styleText.match(/url\((['"]?)(.*?)\1\)/i)
      if (m && m[2]) return m[2]
    }

    return ''
  }

  function extractCardLabels(card, titleText) {
    const labels = []
    const push = value => {
      const t = String(value || '').replace(/Open in new tab\./gi, '').replace(/\s+/g, ' ').trim()
      if (!t) return
      if (!labels.includes(t)) labels.push(t)
    }

    const imageText = textOf(card.children[0])
    if (imageText && imageText.length <= 40) {
      push(imageText)
    }

    const titleBlockText = textOf(card.children[1])
    if (titleBlockText) {
      const cleaned = titleBlockText.replace(/Open in new tab\./gi, '').replace(/\s+/g, ' ').trim()
      if (titleText && cleaned.includes(titleText)) {
        const prefix = cleaned.slice(0, cleaned.indexOf(titleText)).replace(/\s+/g, ' ').trim()
        if (prefix) push(prefix)
      } else {
        for (const known of ['Quick look', 'Top pick', 'Selection']) {
          if (cleaned.startsWith(`${known} `) || cleaned === known) {
            push(known)
          }
        }
      }
    }

    return labels.join(' | ')
  }

  function extractPriceRemark(card) {
    const priceBlock = [...card.children].find(el => hasClassFragment(el, '_2Rn65ox1')) || null
    const txt = textOf(priceBlock)
    if (/Lowest recent price/i.test(txt)) return 'Lowest recent price'
    if (/^RRP\b/i.test(txt)) return 'RRP'
    return ''
  }

  function extractRatingInfo(card) {
    const ratingBlock = [...card.children].find(el => hasClassFragment(el, '_2aMrMQeS')) || null
    const txt = textOf(ratingBlock)

    let rating = ''
    const ratingMatch = txt.match(/([0-9]+(?:[.,][0-9]+)?)\s*(?:out of five stars|out of 5 stars|stars?|星)/i)
    if (ratingMatch) {
      rating = ratingMatch[1].replace(',', '.')
    }

    let reviewCount = ''
    const reviewMatch = txt.match(/([0-9][\d.,KkMm+]*?)\s*(?:reviews?|review|评价|评论|ratings?)/i)
    if (reviewMatch) {
      reviewCount = reviewMatch[1].replace(/\s+/g, '')
    }

    return { rating, reviewCount }
  }

  function loadMoreStep(sharedState) {
    const captchaPause = pauseForCaptcha('load_more', sharedState, 3000)
    if (captchaPause) return captchaPause

    const total = getGoodsTotal()
    const cur = getCardCount()
    const stagnantRounds = Number(sharedState?.stagnantRounds || 0)
    const lastCount = Number(sharedState?.lastCount || 0)
    const clickCount = Number(sharedState?.clickCount || 0)

    if (total > 0 && cur >= total) {
      return {
        next: 'collect_batch',
        sleepMs: withJitter(500, 0.25),
        shared: {
          ...sharedState,
          stagnantRounds: 0,
          lastCount: cur,
          load_done: true,
        },
      }
    }

    let nextStagnantRounds = stagnantRounds
    if (cur > lastCount) {
      nextStagnantRounds = 0
    } else if (clickCount > 0 || stagnantRounds > 0) {
      nextStagnantRounds += 1
    }

    if (nextStagnantRounds >= 5) {
      return {
        next: 'collect_batch',
        sleepMs: withJitter(700, 0.25),
        shared: {
          ...sharedState,
          stagnantRounds: nextStagnantRounds,
          lastCount: cur,
          load_done: true,
        },
      }
    }

    const btn = findSeeMoreButton()
    if (!btn) {
      try { window.scrollTo(0, document.body.scrollHeight) } catch (e) {}
      return {
        next: 'load_more',
        sleepMs: withJitter(1900 + nextStagnantRounds * 650, 0.35),
        shared: {
          ...sharedState,
          stagnantRounds: nextStagnantRounds,
          lastCount: cur,
          clickCount,
        },
      }
    }

    try {
      const rect = btn.getBoundingClientRect()
      const targetTop = Math.max(0, window.scrollY + rect.top - Math.round(window.innerHeight * 0.55) + randInt(-90, 90))
      window.scrollTo({ top: targetTop, behavior: 'auto' })
    } catch (e) {}

    clickLike(btn)

    return {
      next: 'load_more',
      sleepMs: withJitter(Math.max(4200, 3200 + nextStagnantRounds * 650), 0.35),
      shared: {
        ...sharedState,
        stagnantRounds: nextStagnantRounds,
        lastCount: cur,
        clickCount: clickCount + 1,
      },
    }
  }

  function scrapeBatch(offset, end) {
    const cards = getStoreCards()
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

      r['商品图片'] = extractImageUrl(card)
      r['商品角标'] = extractCardLabels(card, r['商品名称'])

      const prices = []
      for (const el of card.querySelectorAll('*')) {
        const txt = el.children.length === 0 ? el.innerText?.trim() : ''
        if (txt && (txt.match(/^[A-Z]{0,3}\$[\d.]+$/) || txt.match(/^[¥€£][\d,.]+$/))) {
          if (!prices.includes(txt)) prices.push(txt)
        }
      }
      r['价格'] = prices[0] || ''
      r['原价'] = prices[1] || ''
      r['价格备注'] = extractPriceRemark(card)

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

      const ratingInfo = extractRatingInfo(card)
      r['评分'] = ratingInfo.rating
      r['评价数'] = ratingInfo.reviewCount

      const brandBlock = [...card.children].find(el => hasClassFragment(el, '_3UD214NZ')) || null
      r['品牌/店铺标签'] = textOf(brandBlock)

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
      const captchaPause = pauseForCaptcha('ensure_target', shared, 3000)
      if (captchaPause) return captchaPause
      const navOk = await waitForNav(10000)
      const cardsOk = await waitForCards(2000)
      if (!navOk && !cardsOk && !isUnavailableStore()) {
        return { success: false, error: '未找到 Temu 店铺导航区域，请确认店铺链接正确' }
      }
      return nextPhase('prepare_page1', 200)
    }

    if (phase === 'prepare_page1') {
      const captchaPause = pauseForCaptcha('prepare_page1', shared, 3000)
      if (captchaPause) return captchaPause

      const clicked = clickItemsTab()
      if (clicked) await sleep(1200)
      const captchaAfterClick = pauseForCaptcha('prepare_page1', shared, 3000)
      if (captchaAfterClick) return captchaAfterClick
      let ok = false
      const waitStart = Date.now()
      while (Date.now() - waitStart < 12000) {
        const captchaDuringWait = pauseForCaptcha('prepare_page1', shared, 3000)
        if (captchaDuringWait) return captchaDuringWait
        if (getCardCount() > 0) {
          ok = true
          break
        }
        await sleep(500)
      }
      if (!ok) {
        if (isUnavailableStore()) {
          return { success: false, error: '当前 Temu 店铺页显示“店铺不可用”，无法抓取商品列表' }
        }
        return { success: false, error: '未找到商品卡片，请确认店铺页面存在商品数据' }
      }
      const nextShared = {
        ...shared,
        itemsTabClicked: true,
        lastCount: getCardCount(),
        stagnantRounds: 0,
        clickCount: 0,
      }
      return nextPhase('load_more', clicked ? 2200 : 400, nextShared)
    }

    if (phase === 'wait_verification') {
      const captcha = detectCaptchaState()
      const rounds = Number(shared.captcha_wait_rounds || 0) + 1
      if (captcha.present) {
        return nextPhase('wait_verification', withJitter(rounds < 3 ? 3200 : 5200, 0.35), {
          ...shared,
          pause_reason: 'captcha',
          captcha_reason: captcha.reason,
          captcha_wait_rounds: rounds,
        })
      }

      const resumePhase = String(shared.resume_phase || 'load_more')
      return nextPhase(resumePhase, 500, {
        ...shared,
        pause_reason: '',
        captcha_reason: '',
        captcha_wait_rounds: 0,
        resume_phase: '',
      })
    }

    if (phase === 'load_more') {
      const step = loadMoreStep(shared)
      return nextPhase(step.next, step.sleepMs, step.shared)
    }

    if (phase === 'collect_batch') {
      const captchaPause = pauseForCaptcha('collect_batch', shared, 3000)
      if (captchaPause) return captchaPause

      const ok = await waitForCards(12000)
      if (!ok) return { success: false, error: '商品卡片未加载' }
      const total = getCardCount()
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
