import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

class FakeClassList {
  constructor(values = []) {
    this.values = new Set(values)
  }

  contains(value) {
    return this.values.has(value)
  }
}

class FakeElement {
  constructor(options = {}) {
    this.tagName = String(options.tagName || 'DIV').toUpperCase()
    this._text = String(options.text || '')
    this._attrs = new Map(Object.entries(options.attributes || {}))
    this._selectors = new Map()
    this.children = options.children || []
    this.classList = new FakeClassList(options.classes || [])
    this.href = options.href || this._attrs.get('href') || ''
    this.src = options.src || this._attrs.get('src') || ''
    this.scrollIntoView = options.scrollIntoView || (() => {})
    this._click = options.click || null
  }

  get innerText() { return this._text }
  get textContent() { return this._text }
  get innerHTML() { return this._html || this._text }
  get className() { return [...this.classList.values].join(' ') }

  setSelector(selector, items) {
    this._selectors.set(selector, Array.isArray(items) ? items : [])
    return this
  }

  querySelectorAll(selector) {
    return this._selectors.get(selector) || []
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null
  }

  click() {
    if (this._click) return this._click()
    this.clicked = true
    return undefined
  }
}

class FakeDocument {
  constructor(bodyText = '', options = {}) {
    this._selectors = new Map()
    this.title = options.title || ''
    this.body = new FakeElement({ tagName: 'body', text: bodyText })
    this.body._html = options.html || bodyText
  }

  setSelector(selector, items) {
    this._selectors.set(selector, Array.isArray(items) ? items : [])
    return this
  }

  querySelectorAll(selector) {
    return this._selectors.get(selector) || []
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
}

function reviewCard(options = {}) {
  const card = new FakeElement({
    tagName: 'div',
    attributes: {
      id: options.id || '',
      'data-hook': 'review',
    },
  })
  card.setSelector('[data-hook="review-title"], .review-title, a.review-title', [
    new FakeElement({ tagName: 'span', text: options.title || '' }),
  ])
  card.setSelector('[data-hook="review-body"], .review-text, .review-text-content', [
    new FakeElement({ tagName: 'span', text: options.body || '' }),
  ])
  card.setSelector('[data-hook="review-star-rating"], [data-hook="cmps-review-star-rating"], .review-rating', [
    new FakeElement({ tagName: 'i', text: options.ratingText || '', attributes: { 'aria-label': options.ratingLabel || '' } }),
  ])
  card.setSelector('[data-hook="review-date"], .review-date', [
    new FakeElement({ tagName: 'span', text: options.date || '' }),
  ])
  card.setSelector('.a-profile-name', [
    new FakeElement({ tagName: 'span', text: options.author || '' }),
  ])
  card.setSelector('[data-hook="format-strip"], .review-format-strip, .a-size-mini.a-color-secondary', [
    new FakeElement({ tagName: 'span', text: options.variant || '' }),
  ])
  card.setSelector('[data-hook="helpful-vote-statement"], .cr-vote-text', [
    new FakeElement({ tagName: 'span', text: options.helpful || '' }),
  ])
  card.setSelector('[data-hook="avp-badge"], .avp-badge', options.verified ? [
    new FakeElement({ tagName: 'span', text: 'Verified Purchase' }),
  ] : [])
  card.setSelector('img.review-image-tile, [data-hook="review-image-tile"] img, .review-image-tile-section img', (options.images || []).map(src => new FakeElement({
    tagName: 'img',
    attributes: { src },
    src,
  })))
  return card
}

async function runScript({
  params = {},
  document = new FakeDocument(),
  href = 'https://www.amazon.com/',
  shared = {},
  phase = '__exports__',
  exportsBox = null,
} = {}) {
  const scriptPath = path.resolve('adapters/amazon-ops-assistant/amazon-reviews-full-export.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const locationUrl = new URL(href)
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_SHARED__: shared,
      __CRAWSHRIMP_PHASE__: phase,
      ...(exportsBox ? { __CRAWSHRIMP_EXPORTS__: exportsBox } : {}),
      location: locationUrl,
    },
    document,
    location: locationUrl,
    console,
    setTimeout: (callback) => {
      Promise.resolve().then(callback)
      return 1
    },
    clearTimeout: () => {},
    URL,
    URLSearchParams,
    Date,
    Math,
    JSON,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Set,
    Map,
  }
  context.globalThis = context
  return await vm.runInNewContext(source, context, { filename: scriptPath })
}

async function loadExports() {
  const exportsBox = {}
  await runScript({ exportsBox })
  return exportsBox
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('amazon reviews accepts product and product-reviews URLs for the same ASIN', async () => {
  const helpers = await loadExports()
  const queue = helpers.buildInputQueue([
    'https://www.amazon.com/Weestep-Toddler-Little-Lightweight-Sneaker/dp/B0D2CQ62DX',
    'https://www.amazon.com/product-reviews/B0D2CQ62DX/ref=cm_cr_dp_d_show_all_btm?ie=UTF8',
    'amazon.com/dp/B0DPZ5JXZM?psc=1',
  ].join('\n'))

  assert.deepEqual(plain(queue), [
    {
      asin: 'B0D2CQ62DX',
      originalUrl: 'https://www.amazon.com/Weestep-Toddler-Little-Lightweight-Sneaker/dp/B0D2CQ62DX',
      productUrl: 'https://www.amazon.com/dp/B0D2CQ62DX',
      reviewsUrl: 'https://www.amazon.com/product-reviews/B0D2CQ62DX?sortBy=recent',
    },
    {
      asin: 'B0DPZ5JXZM',
      originalUrl: 'amazon.com/dp/B0DPZ5JXZM?psc=1',
      productUrl: 'https://www.amazon.com/dp/B0DPZ5JXZM',
      reviewsUrl: 'https://www.amazon.com/product-reviews/B0DPZ5JXZM?sortBy=recent',
    },
  ])
})

test('amazon reviews parses count text even when Amazon spacing is noisy', async () => {
  const helpers = await loadExports()

  assert.equal(helpers.parseReviewCountText('83 customer reviews'), 83)
  assert.equal(helpers.parseReviewCountText('184 matching customer reviews'), 184)
  assert.equal(helpers.parseReviewCountText('1,242 total ratings, 311 with reviews'), 311)
  assert.equal(helpers.parseReviewCountText('83 cu tomer review'), 83)
  assert.equal(helpers.parseReviewCountText('5 star 88% 4 star 7% 184 matching customer reviews'), 184)
  assert.equal(helpers.parseReviewCountText('5 star 88% 4 star 7%'), 0)
})

test('amazon reviews builds separate targets for sort and star dimensions', async () => {
  const helpers = await loadExports()
  const item = helpers.buildReviewUrls('https://www.amazon.com/dp/B0D6GMXZ6X')

  assert.equal(
    helpers.buildScopedReviewUrl(item, { id: 'all', label: '全部评论', filterByStar: '' }, { id: 'helpful', label: '最有帮助', sortBy: 'helpful' }),
    'https://www.amazon.com/product-reviews/B0D6GMXZ6X?sortBy=helpful',
  )
  assert.equal(
    helpers.buildScopedReviewUrl(item, { id: 'one_star', label: '1星', filterByStar: 'one_star' }, { id: 'helpful', label: '最有帮助', sortBy: 'helpful' }),
    'https://www.amazon.com/product-reviews/B0D6GMXZ6X?sortBy=helpful&filterByStar=one_star',
  )
  assert.equal(
    helpers.buildScopedReviewUrl(item, { id: 'five_star', label: '5星', filterByStar: 'five_star' }, { id: 'recent', label: '最新', sortBy: 'recent' }, { id: 'media_reviews_only', label: '图视频评价', mediaType: 'media_reviews_only' }),
    'https://www.amazon.com/product-reviews/B0D6GMXZ6X?sortBy=recent&filterByStar=five_star&mediaType=media_reviews_only',
  )
  assert.deepEqual(plain(helpers.getNextReviewDimension(0, 0, 5)), { sortIndex: 0, mediaIndex: 1, scopeIndex: 0 })
  assert.deepEqual(plain(helpers.getNextReviewDimension(0, 1, 5)), { sortIndex: 1, mediaIndex: 0, scopeIndex: 0 })
  assert.equal(helpers.getNextReviewDimension(1, 1, 5), null)
})

test('amazon reviews extracts common review-card fields from a reviews page', async () => {
  const helpers = await loadExports()
  const doc = new FakeDocument('Customer reviews')
  doc.setSelector('#productTitle, [data-hook="product-title"], .product-title', [
    new FakeElement({ tagName: 'h1', text: 'Weestep Toddler Little Kid Sneaker' }),
  ])
  doc.setSelector('[data-hook="cr-filter-info-review-rating-count"], .cr-filter-info-review-rating-count', [
    new FakeElement({ tagName: 'span', text: '1,242 total ratings, 311 with reviews' }),
  ])
  doc.setSelector('[data-hook="review"], div.review, li.review', [
    reviewCard({
      id: 'R31V8YH8NGJ3AB',
      title: 'Comfortable and light',
      body: 'My toddler wears these every day.',
      ratingLabel: '5.0 out of 5 stars',
      date: 'Reviewed in the United States on May 12, 2026',
      author: 'Sarah',
      variant: 'Size: 8 Toddler | Color: Pink',
      helpful: '12 people found this helpful',
      verified: true,
      images: ['https://m.media-amazon.com/images/I/review-a.jpg'],
    }),
  ])

  const page = helpers.extractReviewPage(doc, 'https://www.amazon.com/product-reviews/B0D2CQ62DX?pageNumber=1', {
    asin: 'B0D2CQ62DX',
    productUrl: 'https://www.amazon.com/dp/B0D2CQ62DX',
    reviewsUrl: 'https://www.amazon.com/product-reviews/B0D2CQ62DX?sortBy=recent',
  }, 1)

  assert.equal(page.rows.length, 1)
  assert.equal(page.rows[0].ASIN, 'B0D2CQ62DX')
  assert.equal(page.rows[0].商品标题, 'Weestep Toddler Little Kid Sneaker')
  assert.equal(page.rows[0].评价ID, 'R31V8YH8NGJ3AB')
  assert.equal(page.rows[0].评分, '5')
  assert.equal(page.rows[0].买家昵称, 'Sarah')
  assert.equal(page.rows[0].评价标题, 'Comfortable and light')
  assert.equal(page.rows[0].评价内容, 'My toddler wears these every day.')
  assert.equal(page.rows[0].评价国家, 'United States')
  assert.equal(page.rows[0].评价时间, 'May 12, 2026')
  assert.equal(page.rows[0].变体信息, 'Size: 8 Toddler | Color: Pink')
  assert.equal(page.rows[0].VerifiedPurchase, '是')
  assert.equal(page.rows[0].Helpful票数, 12)
  assert.equal(page.rows[0].评价图片, 'https://m.media-amazon.com/images/I/review-a.jpg')
  assert.equal(page.summary.review_count_text, '1,242 total ratings, 311 with reviews')
})

test('amazon reviews clicks show-more until all visible reviews are loaded', async () => {
  const helpers = await loadExports()
  const doc = new FakeDocument('Customer reviews')
  const reviews = [
    reviewCard({ id: 'R-1', title: 'First', body: 'One', ratingLabel: '5.0 out of 5 stars' }),
    reviewCard({ id: 'customer_review-R-1', title: 'First duplicate', body: 'One', ratingLabel: '5.0 out of 5 stars' }),
  ]
  doc.setSelector('[data-hook="review"], div.review, li.review', reviews)
  let nextPage = 2
  const showMore = new FakeElement({
    tagName: 'a',
    text: 'Show 10 more reviews',
    attributes: {
      href: '/product-reviews/B0D2CQ62DX/ref=cm_cr_arp_d_paging_btm_2',
      'data-hook': 'show-more-button',
      'data-reviews-state-param': JSON.stringify({
        shouldAppend: 'true',
        pageNumber: '2',
        nextPageToken: 'abc',
      }),
    },
    href: '/product-reviews/B0D2CQ62DX/ref=cm_cr_arp_d_paging_btm_2',
    click: () => {
      reviews.push(
        reviewCard({ id: `R-${nextPage}`, title: `Page ${nextPage}`, body: `Body ${nextPage}`, ratingLabel: '4.0 out of 5 stars' }),
        reviewCard({ id: `customer_review-R-${nextPage}`, title: `Page ${nextPage} duplicate`, body: `Body ${nextPage}`, ratingLabel: '4.0 out of 5 stars' }),
      )
      if (nextPage >= 3) {
        doc.setSelector('[data-hook="show-more-button"], .cm-cr-show-more a', [])
        return
      }
      nextPage += 1
      showMore._attrs.set('href', `/product-reviews/B0D2CQ62DX/ref=cm_cr_arp_d_paging_btm_${nextPage}`)
      showMore.href = `/product-reviews/B0D2CQ62DX/ref=cm_cr_arp_d_paging_btm_${nextPage}`
      showMore._attrs.set('data-reviews-state-param', JSON.stringify({
        shouldAppend: 'true',
        pageNumber: String(nextPage),
        nextPageToken: `token-${nextPage}`,
      }))
    },
  })
  doc.setSelector('[data-hook="show-more-button"], .cm-cr-show-more a', [
    showMore,
  ])

  const result1 = await helpers.clickShowMoreForNextReviewPage(doc, 5, {
    current_review_page: 1,
    current_item_collected_reviews: 1,
    current_expected_reviews: 3,
  })
  const result2 = await helpers.clickShowMoreForNextReviewPage(doc, 5, {
    current_review_page: 2,
    current_item_collected_reviews: 2,
    current_expected_reviews: 3,
  })
  const extracted = helpers.extractReviewPage(doc, 'https://www.amazon.com/product-reviews/B0D2CQ62DX?sortBy=recent', {
    asin: 'B0D2CQ62DX',
    productUrl: 'https://www.amazon.com/dp/B0D2CQ62DX',
    reviewsUrl: 'https://www.amazon.com/product-reviews/B0D2CQ62DX?sortBy=recent',
  }, 1)

  assert.equal(result1.clicked, true)
  assert.equal(result1.next_page, 2)
  assert.equal(result2.clicked, true)
  assert.equal(result2.next_page, 3)
  assert.equal(result2.has_more_button, false)
  assert.equal(extracted.rows.length, 3)
  assert.deepEqual(plain(extracted.rows.map(row => row.评价ID)), ['R-1', 'R-2', 'R-3'])
})

test('amazon reviews waits through transient show-more button re-render', async () => {
  const helpers = await loadExports()
  const doc = new FakeDocument('Customer reviews')
  const reviews = [
    reviewCard({ id: 'R-1', title: 'First', body: 'One', ratingLabel: '5.0 out of 5 stars' }),
    reviewCard({ id: 'customer_review-R-1', title: 'First duplicate', body: 'One', ratingLabel: '5.0 out of 5 stars' }),
  ]
  doc.setSelector('[data-hook="review"], div.review, li.review', reviews)
  doc.setSelector('[data-hook="cr-filter-info-review-rating-count"], .cr-filter-info-review-rating-count', [
    new FakeElement({ tagName: 'span', text: '3 customer reviews' }),
  ])

  let nextPage = 2
  const showMore = new FakeElement({
    tagName: 'a',
    text: 'Show 10 more reviews',
    attributes: {
      href: '/product-reviews/B0D2CQ62DX/ref=cm_cr_arp_d_paging_btm_2',
      'data-hook': 'show-more-button',
      'data-reviews-state-param': JSON.stringify({
        shouldAppend: 'true',
        pageNumber: '2',
        nextPageToken: 'abc',
      }),
    },
    href: '/product-reviews/B0D2CQ62DX/ref=cm_cr_arp_d_paging_btm_2',
    click: () => {
      doc.setSelector('[data-hook="show-more-button"], .cm-cr-show-more a', [])
      Promise.resolve().then(() => {
        reviews.push(
          reviewCard({ id: `R-${nextPage}`, title: `Page ${nextPage}`, body: `Body ${nextPage}`, ratingLabel: '4.0 out of 5 stars' }),
          reviewCard({ id: `customer_review-R-${nextPage}`, title: `Page ${nextPage} duplicate`, body: `Body ${nextPage}`, ratingLabel: '4.0 out of 5 stars' }),
        )
        if (nextPage >= 3) return
        nextPage += 1
        showMore._attrs.set('href', `/product-reviews/B0D2CQ62DX/ref=cm_cr_arp_d_paging_btm_${nextPage}`)
        showMore.href = `/product-reviews/B0D2CQ62DX/ref=cm_cr_arp_d_paging_btm_${nextPage}`
        showMore._attrs.set('data-reviews-state-param', JSON.stringify({
          shouldAppend: 'true',
          pageNumber: String(nextPage),
          nextPageToken: `token-${nextPage}`,
        }))
        doc.setSelector('[data-hook="show-more-button"], .cm-cr-show-more a', [showMore])
      })
    },
  })
  doc.setSelector('[data-hook="show-more-button"], .cm-cr-show-more a', [showMore])

  const result1 = await helpers.clickShowMoreForNextReviewPage(doc, 5, {
    current_review_page: 1,
    current_item_collected_reviews: 1,
    current_expected_reviews: 3,
  })
  const result2 = await helpers.clickShowMoreForNextReviewPage(doc, 5, {
    current_review_page: 2,
    current_item_collected_reviews: 2,
    current_expected_reviews: 3,
  })

  assert.equal(result1.clicked, true)
  assert.equal(result1.changed, true)
  assert.equal(result2.clicked, true)
  assert.equal(result2.changed, true)
  assert.equal(helpers.getReviewCards(doc).length, 3)
  assert.equal(helpers.getShowMoreButton(doc), null)
})

test('amazon reviews phase machine navigates, collects pages, and dedupes final rows', async () => {
  const start = await runScript({
    params: {
      review_urls: 'https://www.amazon.com/Weestep-Toddler-Little-Lightweight-Sneaker/dp/B0D2CQ62DX',
    },
    phase: 'main',
    href: 'https://www.amazon.com/',
  })

  assert.equal(start.success, true)
  assert.equal(start.meta.action, 'next_phase')
  assert.equal(start.meta.next_phase, 'ensure_reviews_page')
  assert.equal(start.meta.shared.queue[0].reviewsUrl, 'https://www.amazon.com/product-reviews/B0D2CQ62DX?sortBy=recent')

  const ensure = await runScript({
    phase: 'ensure_reviews_page',
    href: 'https://www.amazon.com/',
    shared: start.meta.shared,
  })

  assert.equal(ensure.success, true)
  assert.equal(ensure.meta.action, 'next_phase')
  assert.equal(ensure.meta.next_phase, 'wait_reviews_page')
  assert.equal(ensure.meta.shared.target_url, 'https://www.amazon.com/product-reviews/B0D2CQ62DX?sortBy=recent')
  assert.equal(ensure.meta.shared.total_rows, 1)
  assert.equal(ensure.meta.shared.current_exec_no, 1)

  const doc = new FakeDocument('Customer reviews')
  doc.setSelector('[data-hook="review"], div.review, li.review', [
    reviewCard({ id: 'R-1', title: 'First', body: 'Useful review', ratingLabel: '4.0 out of 5 stars', author: 'A' }),
    reviewCard({ id: 'R-1', title: 'First duplicate', body: 'Useful review', ratingLabel: '4.0 out of 5 stars', author: 'A' }),
  ])
  const collected = await runScript({
    phase: 'collect_reviews_page',
    href: 'https://www.amazon.com/product-reviews/B0D2CQ62DX?sortBy=recent',
    shared: ensure.meta.shared,
    document: doc,
  })

  assert.equal(collected.success, true)
  assert.equal(collected.meta.action, 'complete')
  assert.equal(collected.meta.has_more, false)
  assert.equal(collected.data.length, 1)
  assert.equal(collected.meta.shared.next_review_url, '')
  assert.equal(collected.meta.shared.batch_no, 1)
  assert.equal(collected.meta.shared.detail_completed_targets, 1)
})

test('amazon reviews resumes from a previous export file and emits seed rows once', async () => {
  const previousRows = [
    {
      ASIN: 'B0D2CQ62DX',
      源链接: 'https://www.amazon.com/dp/B0D2CQ62DX',
      商品链接: 'https://www.amazon.com/dp/B0D2CQ62DX',
      评论页链接: 'https://www.amazon.com/product-reviews/B0D2CQ62DX?sortBy=recent',
      页码: '1',
      页内序号: '1',
      评价ID: 'R-OLD',
      买家昵称: 'Old buyer',
      评分: '5',
      评价标题: 'Old review',
      评价内容: 'Already exported',
    },
    {
      ASIN: 'B0UNRELATED',
      评价ID: 'R-OTHER',
      评价标题: 'Other ASIN',
      评价内容: 'Should not seed this run',
    },
  ]
  const start = await runScript({
    params: {
      review_urls: 'https://www.amazon.com/Weestep-Toddler-Little-Lightweight-Sneaker/dp/B0D2CQ62DX',
      resume_reviews_file: { rows: previousRows },
    },
    phase: 'main',
    href: 'https://www.amazon.com/',
  })

  assert.equal(start.success, true)
  assert.equal(start.meta.action, 'next_phase')
  assert.equal(start.data.length, 1)
  assert.equal(start.data[0].评价ID, 'R-OLD')
  assert.equal(start.meta.shared.resume_seed_row_count, 1)
  assert.equal(start.meta.shared.current_item_collected_reviews, 1)
  assert.deepEqual(plain(start.meta.shared.seen_review_keys), ['B0D2CQ62DX|R-OLD'])

  const followupMain = await runScript({
    params: {
      review_urls: 'https://www.amazon.com/Weestep-Toddler-Little-Lightweight-Sneaker/dp/B0D2CQ62DX',
      resume_reviews_file: { rows: previousRows },
    },
    phase: 'main',
    href: 'https://www.amazon.com/product-reviews/B0D2CQ62DX?sortBy=recent',
    shared: start.meta.shared,
  })

  assert.equal(followupMain.success, true)
  assert.equal(followupMain.data.length, 0)
})

test('amazon reviews stops with abort action on automated access block so partial data can export', async () => {
  const start = await runScript({
    params: {
      review_urls: 'https://www.amazon.com/Weestep-Toddler-Little-Lightweight-Sneaker/dp/B0D2CQ62DX',
    },
    phase: 'main',
    href: 'https://www.amazon.com/',
  })
  const doc = new FakeDocument(
    'To discuss automated access to Amazon data please contact api-services-support@amazon.com',
    { title: 'Page Not Found' },
  )

  const blocked = await runScript({
    phase: 'wait_reviews_page',
    href: 'https://www.amazon.com/product-reviews/B0D2CQ62DX?sortBy=recent',
    shared: start.meta.shared,
    document: doc,
  })

  assert.equal(blocked.success, true)
  assert.equal(blocked.meta.action, 'abort')
  assert.match(blocked.meta.reason, /自动化访问限制页/)
  assert.equal(blocked.meta.shared.traffic_limited, true)
})

test('amazon reviews aborts from collect phase when Amazon replaces reviews with a block page', async () => {
  const start = await runScript({
    params: {
      review_urls: 'https://www.amazon.com/Weestep-Toddler-Little-Lightweight-Sneaker/dp/B0D2CQ62DX',
    },
    phase: 'main',
    href: 'https://www.amazon.com/',
  })
  const doc = new FakeDocument(
    'To discuss automated access to Amazon data please contact api-services-support@amazon.com',
    { title: 'Page Not Found' },
  )

  const blocked = await runScript({
    phase: 'collect_reviews_page',
    href: 'https://www.amazon.com/product-reviews/B0D2CQ62DX?sortBy=recent',
    shared: start.meta.shared,
    document: doc,
  })

  assert.equal(blocked.success, true)
  assert.equal(blocked.meta.action, 'abort')
  assert.equal(blocked.meta.shared.stop_reason, 'automated_access_block')
})

test('amazon reviews collects every replaced page before advancing to the next product', async () => {
  const urls = [
    'https://www.amazon.com/SEEKWAY-Barefoot-Water-Shoes-Kids/dp/B0D6GMXZ6X',
    'https://www.amazon.com/ChayChax-Toddler-Buckle-Sandals-Adjustable/dp/B0D9221K6K',
  ].join('\n')
  const start = await runScript({
    params: { review_urls: urls },
    phase: 'main',
    href: 'https://www.amazon.com/',
  })
  const ensure = await runScript({
    phase: 'ensure_reviews_page',
    href: 'https://www.amazon.com/',
    shared: start.meta.shared,
  })

  const makeDoc = (ids, totalText = '4 customer reviews') => {
    const doc = new FakeDocument('Customer reviews')
    doc.setSelector('[data-hook="cr-filter-info-review-rating-count"], .cr-filter-info-review-rating-count', [
      new FakeElement({ tagName: 'span', text: totalText }),
    ])
    doc.setSelector('[data-hook="review"], div.review, li.review', ids.flatMap(id => [
      reviewCard({ id, title: `Title ${id}`, body: `Body ${id}`, ratingLabel: '5.0 out of 5 stars' }),
      reviewCard({ id: `customer_review-${id}`, title: `Duplicate ${id}`, body: `Body ${id}`, ratingLabel: '5.0 out of 5 stars' }),
    ]))
    return doc
  }

  const firstPage = makeDoc(['R-A-1', 'R-A-2'])
  const showMore = new FakeElement({
    tagName: 'a',
    text: 'Show 10 more reviews',
    attributes: {
      href: '/product-reviews/B0D6GMXZ6X/ref=cm_cr_arp_d_paging_btm_2',
      'data-hook': 'show-more-button',
      'data-reviews-state-param': JSON.stringify({ pageNumber: '2', nextPageToken: 'abc' }),
    },
    click: () => {
      firstPage.setSelector('[data-hook="show-more-button"], .cm-cr-show-more a', [])
      firstPage.setSelector('[data-hook="review"], div.review, li.review', [
        reviewCard({ id: 'R-A-3', title: 'Title R-A-3', body: 'Body R-A-3', ratingLabel: '4.0 out of 5 stars' }),
        reviewCard({ id: 'R-A-4', title: 'Title R-A-4', body: 'Body R-A-4', ratingLabel: '4.0 out of 5 stars' }),
      ])
    },
  })
  firstPage.setSelector('[data-hook="show-more-button"], .cm-cr-show-more a', [showMore])

  const firstCollect = await runScript({
    phase: 'collect_reviews_page',
    href: 'https://www.amazon.com/product-reviews/B0D6GMXZ6X?sortBy=recent',
    shared: ensure.meta.shared,
    document: firstPage,
  })
  assert.equal(firstCollect.success, true)
  assert.equal(firstCollect.meta.action, 'next_phase')
  assert.equal(firstCollect.meta.next_phase, 'advance_reviews_page')
  assert.equal(firstCollect.data.length, 2)
  assert.equal(firstCollect.meta.shared.batch_no, 2)
  assert.equal(firstCollect.meta.shared.total_batches, 4)

  const advanced = await runScript({
    phase: 'advance_reviews_page',
    href: 'https://www.amazon.com/product-reviews/B0D6GMXZ6X?sortBy=recent',
    shared: firstCollect.meta.shared,
    document: firstPage,
  })
  assert.equal(advanced.success, true)
  assert.equal(advanced.meta.action, 'next_phase')
  assert.equal(advanced.meta.next_phase, 'collect_reviews_page')
  assert.equal(advanced.data.length, 0)
  assert.equal(advanced.meta.shared.current_review_page, 2)

  const secondCollect = await runScript({
    phase: 'collect_reviews_page',
    href: 'https://www.amazon.com/product-reviews/B0D6GMXZ6X?pageNumber=2&sortBy=recent',
    shared: advanced.meta.shared,
    document: firstPage,
  })
  assert.equal(secondCollect.success, true)
  assert.equal(secondCollect.meta.action, 'complete')
  assert.equal(secondCollect.meta.has_more, true)
  assert.equal(secondCollect.data.length, 2)
  assert.deepEqual(plain(secondCollect.data.map(row => row.评价ID)), ['R-A-3', 'R-A-4'])
  assert.equal(secondCollect.meta.shared.current_index, 1)
  assert.equal(secondCollect.meta.shared.completed_items, 1)
  assert.equal(secondCollect.meta.shared.current_item_collected_reviews, 0)
  assert.equal(secondCollect.meta.shared.target_url, 'https://www.amazon.com/product-reviews/B0D9221K6K?sortBy=recent')
})

test('amazon reviews advances through star buckets when public all-reviews stream stops early', async () => {
  const start = await runScript({
    params: {
      review_urls: 'https://www.amazon.com/Stelle-Water-Shoes-Barefoot-Shoes%EF%BC%88Pink/dp/B0DD79TX7W',
      fetch_mode: 'full',
    },
    phase: 'main',
    href: 'https://www.amazon.com/',
  })

  const shared = {
    ...start.meta.shared,
    current_expected_reviews: 224,
    current_item_collected_reviews: 100,
    collected_reviews: 100,
    completed_items: 0,
    seen_review_keys: Array.from({ length: 100 }, (_, index) => `B0DD79TX7W|R-${index + 1}`),
    current_review_page: 10,
    current_scope_index: 0,
  }
  const doc = new FakeDocument('Customer reviews')
  doc.setSelector('[data-hook="cr-filter-info-review-rating-count"], .cr-filter-info-review-rating-count', [
    new FakeElement({ tagName: 'span', text: '224 customer reviews' }),
  ])
  doc.setSelector('[data-hook="review"], div.review, li.review', [])
  doc.setSelector('[data-hook="show-more-button"], .cm-cr-show-more a', [])

  const advanced = await runScript({
    phase: 'advance_reviews_page',
    href: 'https://www.amazon.com/product-reviews/B0DD79TX7W?pageNumber=10&sortBy=recent',
    shared,
    document: doc,
  })

  assert.equal(advanced.success, true)
  assert.equal(advanced.meta.action, 'complete')
  assert.equal(advanced.meta.has_more, true)
  assert.equal(advanced.meta.shared.current_index, 0)
  assert.equal(advanced.meta.shared.current_scope_index, 1)
  assert.equal(advanced.meta.shared.current_scope_id, 'five_star')
  assert.equal(advanced.meta.shared.completed_items, 0)
  assert.equal(advanced.meta.shared.current_item_collected_reviews, 100)
  assert.equal(advanced.meta.shared.target_url, 'https://www.amazon.com/product-reviews/B0DD79TX7W?sortBy=recent&filterByStar=five_star')
  assert.equal(advanced.meta.shared.pending_click_summary.reason, 'public_page_limit_reached')
})

test('amazon reviews quick mode caps at first 100 reviews and skips extra dimensions', async () => {
  const start = await runScript({
    params: {
      review_urls: [
        'https://www.amazon.com/Stelle-Water-Shoes-Barefoot-Shoes%EF%BC%88Pink/dp/B0DD79TX7W',
        'https://www.amazon.com/SEEKWAY-Barefoot-Water-Shoes-Kids/dp/B0D6GMXZ6X',
      ].join('\n'),
      fetch_mode: 'quick_100',
    },
    phase: 'main',
    href: 'https://www.amazon.com/',
  })

  const shared = {
    ...start.meta.shared,
    current_expected_reviews: 100,
    current_item_collected_reviews: 100,
    collected_reviews: 100,
    completed_items: 0,
    seen_review_keys: Array.from({ length: 100 }, (_, index) => `B0DD79TX7W|R-${index + 1}`),
    current_review_page: 10,
    current_scope_index: 0,
    current_media_index: 0,
    current_sort_index: 0,
  }
  const doc = new FakeDocument('Customer reviews')
  doc.setSelector('[data-hook="cr-filter-info-review-rating-count"], .cr-filter-info-review-rating-count', [
    new FakeElement({ tagName: 'span', text: '224 customer reviews' }),
  ])
  doc.setSelector('[data-hook="review"], div.review, li.review', [])
  doc.setSelector('[data-hook="show-more-button"], .cm-cr-show-more a', [])

  const advanced = await runScript({
    phase: 'advance_reviews_page',
    href: 'https://www.amazon.com/product-reviews/B0DD79TX7W?pageNumber=10&sortBy=recent',
    shared,
    document: doc,
  })

  assert.equal(advanced.success, true)
  assert.equal(advanced.meta.action, 'complete')
  assert.equal(advanced.meta.has_more, true)
  assert.equal(advanced.meta.shared.fetch_mode, 'quick_100')
  assert.equal(advanced.meta.shared.current_index, 1)
  assert.equal(advanced.meta.shared.completed_items, 1)
  assert.equal(advanced.meta.shared.current_scope_index, 0)
  assert.equal(advanced.meta.shared.current_media_index, 0)
  assert.equal(advanced.meta.shared.current_sort_index, 0)
  assert.equal(advanced.meta.shared.detail_dimension_total, 1)
  assert.equal(advanced.meta.shared.target_url, 'https://www.amazon.com/product-reviews/B0D6GMXZ6X?sortBy=recent')
})

test('amazon reviews quick mode never emits more than 100 rows for one ASIN', async () => {
  const start = await runScript({
    params: {
      review_urls: 'https://www.amazon.com/Stelle-Water-Shoes-Barefoot-Shoes%EF%BC%88Pink/dp/B0DD79TX7W',
      fetch_mode: 'quick_100',
    },
    phase: 'main',
    href: 'https://www.amazon.com/',
  })
  const shared = {
    ...start.meta.shared,
    current_expected_reviews: 100,
    current_item_collected_reviews: 95,
    collected_reviews: 95,
    seen_review_keys: Array.from({ length: 95 }, (_, index) => `B0DD79TX7W|R-old-${index + 1}`),
  }
  const doc = new FakeDocument('Customer reviews')
  doc.setSelector('[data-hook="cr-filter-info-review-rating-count"], .cr-filter-info-review-rating-count', [
    new FakeElement({ tagName: 'span', text: '224 customer reviews' }),
  ])
  doc.setSelector('[data-hook="review"], div.review, li.review', Array.from({ length: 10 }, (_, index) => (
    reviewCard({
      id: `R-new-${index + 1}`,
      title: `Quick ${index + 1}`,
      body: `Body ${index + 1}`,
      ratingLabel: '5.0 out of 5 stars',
    })
  )))
  doc.setSelector('[data-hook="show-more-button"], .cm-cr-show-more a', [
    new FakeElement({
      tagName: 'a',
      text: 'Show 10 more reviews',
      attributes: {
        href: '/product-reviews/B0DD79TX7W/ref=cm_cr_arp_d_paging_btm_2',
        'data-hook': 'show-more-button',
      },
    }),
  ])

  const collected = await runScript({
    phase: 'collect_reviews_page',
    href: 'https://www.amazon.com/product-reviews/B0DD79TX7W?sortBy=recent',
    shared,
    document: doc,
  })

  assert.equal(collected.success, true)
  assert.equal(collected.meta.action, 'complete')
  assert.equal(collected.meta.has_more, false)
  assert.equal(collected.data.length, 5)
  assert.equal(collected.meta.shared.current_item_collected_reviews, 100)
  assert.equal(collected.meta.shared.current_expected_reviews, 100)
})

test('amazon reviews keeps product total while traversing scoped star buckets', async () => {
  const start = await runScript({
    params: {
      review_urls: 'https://www.amazon.com/Stelle-Water-Shoes-Barefoot-Shoes%EF%BC%88Pink/dp/B0DD79TX7W',
      fetch_mode: 'full',
    },
    phase: 'main',
    href: 'https://www.amazon.com/',
  })
  const shared = {
    ...start.meta.shared,
    current_expected_reviews: 224,
    current_item_collected_reviews: 100,
    collected_reviews: 100,
    seen_review_keys: Array.from({ length: 100 }, (_, index) => `B0DD79TX7W|R-all-${index + 1}`),
    current_scope_index: 1,
    current_scope_collected_reviews: 0,
    current_scope_expected_reviews: 0,
    target_url: 'https://www.amazon.com/product-reviews/B0DD79TX7W?sortBy=recent&filterByStar=five_star',
  }
  const doc = new FakeDocument('Customer reviews')
  doc.setSelector('[data-hook="cr-filter-info-review-rating-count"], .cr-filter-info-review-rating-count', [
    new FakeElement({ tagName: 'span', text: '184 matching customer reviews' }),
  ])
  doc.setSelector('[data-hook="review"], div.review, li.review', Array.from({ length: 10 }, (_, index) => (
    reviewCard({
      id: `R-five-${index + 1}`,
      title: `Five star ${index + 1}`,
      body: `Body ${index + 1}`,
      ratingLabel: '5.0 out of 5 stars',
    })
  )))
  doc.setSelector('[data-hook="show-more-button"], .cm-cr-show-more a', [
    new FakeElement({
      tagName: 'a',
      text: 'Show 10 more reviews',
      attributes: {
        href: '/product-reviews/B0DD79TX7W/ref=cm_cr_arp_d_paging_btm_2?filterByStar=five_star',
        'data-hook': 'show-more-button',
        'data-reviews-state-param': JSON.stringify({ pageNumber: '2', nextPageToken: 'abc' }),
      },
    }),
  ])

  const collected = await runScript({
    phase: 'collect_reviews_page',
    href: 'https://www.amazon.com/product-reviews/B0DD79TX7W?sortBy=recent&filterByStar=five_star',
    shared,
    document: doc,
  })

  assert.equal(collected.success, true)
  assert.equal(collected.meta.action, 'next_phase')
  assert.equal(collected.meta.next_phase, 'advance_reviews_page')
  assert.equal(collected.data.length, 10)
  assert.equal(collected.meta.shared.current_expected_reviews, 224)
  assert.equal(collected.meta.shared.current_scope_expected_reviews, 184)
  assert.equal(collected.meta.shared.current_scope_collected_reviews, 10)
  assert.equal(collected.meta.shared.total_batches, 224)
  assert.match(collected.data[0].备注, /排序：最新/)
  assert.match(collected.data[0].备注, /筛选范围：5星/)
})

test('amazon reviews advances from recent star buckets into media dimensions before helpful sort', async () => {
  const start = await runScript({
    params: {
      review_urls: 'https://www.amazon.com/SEEKWAY-Barefoot-Water-Shoes-Kids/dp/B0D6GMXZ6X',
      fetch_mode: 'full',
    },
    phase: 'main',
    href: 'https://www.amazon.com/',
  })
  const shared = {
    ...start.meta.shared,
    current_expected_reviews: 225,
    current_item_collected_reviews: 116,
    collected_reviews: 116,
    current_sort_index: 0,
    current_scope_index: 5,
    current_review_page: 2,
    current_scope_collected_reviews: 19,
    current_scope_expected_reviews: 19,
  }
  const doc = new FakeDocument('Customer reviews')
  doc.setSelector('[data-hook="cr-filter-info-review-rating-count"], .cr-filter-info-review-rating-count', [
    new FakeElement({ tagName: 'span', text: '19 matching customer reviews' }),
  ])
  doc.setSelector('[data-hook="review"], div.review, li.review', [])
  doc.setSelector('[data-hook="show-more-button"], .cm-cr-show-more a', [])

  const advanced = await runScript({
    phase: 'advance_reviews_page',
    href: 'https://www.amazon.com/product-reviews/B0D6GMXZ6X?pageNumber=2&sortBy=recent&filterByStar=one_star',
    shared,
    document: doc,
  })

  assert.equal(advanced.success, true)
  assert.equal(advanced.meta.action, 'complete')
  assert.equal(advanced.meta.has_more, true)
  assert.equal(advanced.meta.shared.current_sort_index, 0)
  assert.equal(advanced.meta.shared.current_sort_id, 'recent')
  assert.equal(advanced.meta.shared.current_scope_index, 0)
  assert.equal(advanced.meta.shared.current_item_collected_reviews, 116)
  assert.equal(advanced.meta.shared.current_expected_reviews, 225)
  assert.equal(advanced.meta.shared.current_media_index, 1)
  assert.equal(advanced.meta.shared.current_media_id, 'media_reviews_only')
  assert.equal(advanced.meta.shared.target_url, 'https://www.amazon.com/product-reviews/B0D6GMXZ6X?sortBy=recent&mediaType=media_reviews_only')
})

test('amazon ops manifest exposes reviews full export task with excel output', async () => {
  const manifest = fs.readFileSync(path.resolve('adapters/amazon-ops-assistant/manifest.yaml'), 'utf8')
  assert.match(manifest, /id:\s+amazon_reviews_full_export/)
  assert.match(manifest, /script:\s+amazon-reviews-full-export\.js/)
  assert.match(manifest, /id:\s+fetch_mode/)
  assert.match(manifest, /只取前 100 条（快速）/)
  assert.match(manifest, /全量取（耗时长）/)
  assert.match(manifest, /id:\s+resume_reviews_file/)
  assert.match(manifest, /label:\s+续跑文件（可选）/)
  assert.match(manifest, /id:\s+click_min_delay_ms/)
  assert.match(manifest, /id:\s+item_max_delay_ms/)
  assert.match(manifest, /filename:\s+"亚马逊Reviews全量抓取_\{timestamp\}\.xlsx"/)
  assert.match(manifest, /ASIN/)
  assert.match(manifest, /评价ID/)
})
