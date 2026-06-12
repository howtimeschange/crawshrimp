import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/temu/single-product-reviews.js')
const PRODUCT_URL = 'https://www.temu.com/de-en/-girls-fashion-sandals-kids-lightweight-sports-sandals-breathable-non-slip--with-closed-toe-suitable-for-outdoor--g-605693750906920.html?_oak_mp_inf=x'
const SECOND_PRODUCT_URL = 'https://www.temu.com/de-en/-boys-sports-sandals-kids-wading-shoes-g-606106067809179.html?_oak_mp_inf=y'

class FakeElement {
  constructor(options = {}) {
    this.tagName = String(options.tagName || 'DIV').toUpperCase()
    this.className = String(options.className || '')
    this._text = String(options.text || '')
    this._attrs = new Map(Object.entries(options.attributes || {}))
    this._children = []
    this._selectors = new Map()
    this._rect = options.rect || { left: 0, top: 0, width: 120, height: 32 }
    this._scrollIntoViewRect = options.scrollIntoViewRect || null
    this._style = options.style || { display: 'block', visibility: 'visible', overflowY: 'visible' }
    this.scrollTop = options.scrollTop || 0
    this.scrollHeight = options.scrollHeight || this._rect.height
    this.clientHeight = options.clientHeight || this._rect.height
  }

  get innerText() {
    return [this._text, ...this._children.map(child => child.innerText)].filter(Boolean).join(' ')
  }
  get textContent() { return this.innerText }
  get children() { return this._children }

  appendChild(child) {
    this._children.push(child)
    return this
  }

  setSelector(selector, items) {
    this._selectors.set(selector, Array.isArray(items) ? items : [])
    return this
  }

  querySelectorAll(selector) {
    if (this._selectors.has(selector)) return this._selectors.get(selector)
    const selectors = String(selector || '').split(',').map(item => item.trim()).filter(Boolean)
    const matches = []
    const visit = node => {
      for (const child of node._children || []) {
        if (selectors.some(part => child.matchesSelector?.(part))) matches.push(child)
        visit(child)
      }
    }
    visit(this)
    return matches
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  matchesSelector(selector) {
    const part = String(selector || '').trim()
    if (!part) return false
    if (part === '*') return true
    const tagAttr = part.match(/^([a-z0-9]+)?\[([^=\]~*^$|]+)([*^$|~]?=)?["']?([^"'\]]*)["']?\]$/i)
    if (tagAttr) {
      const [, tag, name, op, expected] = tagAttr
      if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false
      const value = this.getAttribute(name)
      if (value == null) return false
      if (!op) return true
      if (op === '=') return value === expected
      if (op === '*=') return value.includes(expected)
      return false
    }
    if (part.startsWith('.')) return this.className.split(/\s+/).includes(part.slice(1))
    const attr = part.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/)
    if (attr) {
      const value = this.getAttribute(attr[1])
      return attr[2] == null ? value != null : value === attr[2]
    }
    return this.tagName.toLowerCase() === part.toLowerCase()
  }

  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null
  }

  getBoundingClientRect() {
    return {
      left: this._rect.left || 0,
      top: this._rect.top || 0,
      width: this._rect.width || 0,
      height: this._rect.height || 0,
      right: (this._rect.left || 0) + (this._rect.width || 0),
      bottom: (this._rect.top || 0) + (this._rect.height || 0),
    }
  }

  scrollIntoView() {
    if (this._scrollIntoViewRect) this._rect = this._scrollIntoViewRect
  }
  click() {}
}

class FakeDocument {
  constructor(bodyText = '') {
    this.body = new FakeElement({ tagName: 'body', text: bodyText })
    this._selectors = new Map()
    this.title = 'Temu product'
  }

  setSelector(selector, items) {
    this._selectors.set(selector, Array.isArray(items) ? items : [])
    return this
  }

  querySelectorAll(selector) {
    if (this._selectors.has(selector)) return this._selectors.get(selector)
    return []
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
}

async function runScript({
  params = {},
  shared = {},
  phase = 'main',
  page = 1,
  href = PRODUCT_URL,
  fetchImpl,
  document = new FakeDocument(),
  rawData,
  initialProps,
  timeoutImpl,
} = {}) {
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8')
  const locationUrl = new URL(href)
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_SHARED__: shared,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_PAGE__: page,
      location: locationUrl,
      rawData,
      __INITIAL_PROPS__: initialProps,
    },
    document,
    location: locationUrl,
    innerWidth: 1200,
    innerHeight: 900,
    rawData,
    __INITIAL_PROPS__: initialProps,
    fetch: fetchImpl || (async () => { throw new Error('fetch not mocked') }),
    console,
    setTimeout: timeoutImpl || ((callback, ms, ...args) => {
      Promise.resolve().then(() => callback(...args))
      return { ms }
    }),
    clearTimeout,
    getComputedStyle: el => el?._style || { display: 'block', visibility: 'visible', overflowY: 'visible' },
    URL,
    URLSearchParams,
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    encodeURIComponent,
    decodeURIComponent,
  }
  context.globalThis = context
  context.window.fetch = (...args) => context.fetch(...args)
  context.window.getComputedStyle = context.getComputedStyle
  context.window.innerWidth = 1200
  context.window.innerHeight = 900
  return await vm.runInNewContext(source, context, { filename: SCRIPT_PATH })
}

function createJsonResponse(payload, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return payload },
    async text() { return JSON.stringify(payload) },
    clone() { return this },
    headers: { get() { return 'application/json' } },
  }
}

function createSeeAllDocument() {
  const seeAll = new FakeElement({
    tagName: 'div',
    text: 'See all reviews',
    attributes: { role: 'button' },
    rect: { left: 220, top: 420, width: 220, height: 42 },
  })
  const document = new FakeDocument('111 reviews 4,9 All reviews are from verified purchases See all reviews')
  document.setSelector('button,a,[role="button"],div,span', [seeAll])
  return document
}

function createPageScrollerSeeAllDocument() {
  const pageScroller = new FakeElement({
    tagName: 'div',
    text: 'Full product page',
    rect: { left: 0, top: 0, width: 1185, height: 900 },
    style: { display: 'block', visibility: 'visible', overflowY: 'auto' },
    scrollHeight: 7349,
    clientHeight: 900,
  })
  const seeAll = new FakeElement({
    tagName: 'div',
    text: 'See all reviews',
    attributes: { role: 'button' },
    rect: { left: 220, top: 1420, width: 220, height: 42 },
    scrollIntoViewRect: { left: 220, top: 420, width: 220, height: 42 },
  })
  const document = new FakeDocument('111 reviews 4,9 All reviews are from verified purchases See all reviews')
  document.setSelector('*', [pageScroller])
  document.setSelector('button,a,[role="button"],div,span', [seeAll])
  return document
}

function createDialogDocument() {
  const scroller = new FakeElement({
    tagName: 'div',
    text: 'All reviews are from verified purchases Recommended Most recent',
    rect: { left: 300, top: 160, width: 620, height: 592 },
    style: { display: 'block', visibility: 'visible', overflowY: 'auto' },
    scrollHeight: 3293,
    clientHeight: 592,
  })
  const dialog = new FakeElement({
    tagName: 'div',
    text: 'Item reviews All reviews are from verified purchases',
    attributes: { role: 'dialog' },
    rect: { left: 280, top: 120, width: 640, height: 706 },
  })
  dialog.setSelector('*', [scroller])
  const document = new FakeDocument('Item reviews All reviews are from verified purchases')
  document.setSelector('[role="dialog"]', [dialog])
  return document
}

function createDomCard({ name = 'bu***er', country = 'Germany', date = 'Jun 10, 2026', content = 'Great quality', index = 1 } = {}) {
  const card = new FakeElement({ className: '_9WTBQrvq', text: `${name} in on ${date} Purchased: Ivory White Overall fit: True to size ${content}` })
  card
    .appendChild(new FakeElement({
      className: '_3OHJMKy5',
      text: `${name} in on ${date}`,
      attributes: { 'aria-label': `in ${country} on ${date}` },
    }))
    .appendChild(new FakeElement({ className: '_21WXPU_9', attributes: { 'aria-label': '5 out of five stars' } }))
    .appendChild(new FakeElement({ className: '_2Zm74do1 N4fQ1-w3', text: `${content} ${index}` }))
  return card
}

function createReviewItems(goodsId, prefix, count, page = 1) {
  return Array.from({ length: count }, (_, index) => ({
    review_id: `${prefix}-${index + 1}`,
    comment: `review ${prefix} ${index + 1}`,
    score: 5,
    goods_id: goodsId,
    name: `bu***${index + 1}`,
    time: 1781102454 - (page * 100 + index),
    concat_rich_text: { aria_label: 'in Germany on Jun 10, 2026' },
  }))
}

function createCapturedMatch(goodsId, page, count, total = count, hasMore = false) {
  return {
    url: `https://www.temu.com/de-en/api/bg/engels/reviews/list?goods_id=${goodsId}&page=${page}&size=10&need_max_size=true`,
    status: 200,
    mimeType: 'application/json',
    body: JSON.stringify({
      data: createReviewItems(goodsId, `PAGE-${page}`, count, page),
      total,
      has_more: hasMore,
    }),
  }
}

test('single product reviews normalizes Temu engels review API rows', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    if (String(url).includes('/reviews/info')) {
      return createJsonResponse({
        data: {
          goods_info: {
            goods_id: '605693750906920',
            goods_name: 'Balabala Girls Fashion Sandals',
            thumb_url: 'https://img.kwcdn.com/product.jpg',
          },
          score: 5,
          review_num_text: '6 reviews',
          review_count: 6,
        },
      })
    }
    return createJsonResponse({
      data: [
        {
          review_id: '74643775175013275',
          comment: 'суперские',
          review_lang: { translate_comment: 'awesome' },
          score: 5,
          goods_id: '605693750906920',
          sku_id: '105297163106553',
          specs: '[{"spec_key":"Color","spec_value":"Pink Green 40301"},{"spec_key":"Size","spec_value":"Label size: CN 28(EU 28)"}]',
          time: 1781102454,
          time_ms: 1781102454486,
          concat_time_lang: 'on Jun 10, 2026',
          concat_rich_text: { aria_label: 'in Poland on Jun 10, 2026' },
          name: 'al***ka',
          avatar: 'https://avatar-eu.kwcdn.com/avatar.png',
          pictures: [{ url: 'https://rewimg-eu.kwcdn.com/review-image/a.jpeg' }],
          goods_specific_review_level_info: { level: 2, text: 'True to size' },
        },
      ],
      total: 1,
      has_more: false,
    })
  }

  const result = await runScript({
    params: { product_url: PRODUCT_URL, page_size: 10, max_pages: 3 },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.shared.goods_id, '605693750906920')
  assert.equal(result.meta.shared.total_reviews, 1)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].商品ID, '605693750906920')
  assert.equal(result.data[0].商品标题, 'Balabala Girls Fashion Sandals')
  assert.equal(result.data[0].评价ID, '74643775175013275')
  assert.equal(result.data[0].买家昵称, 'al***ka')
  assert.equal(result.data[0].评分, 5)
  assert.equal(result.data[0].评价内容, 'awesome')
  assert.equal(result.data[0].评价原文, 'суперские')
  assert.equal(result.data[0].评价国家, 'Poland')
  assert.equal(result.data[0].评价时间, '2026-06-10')
  assert.equal(result.data[0].规格, 'Color: Pink Green 40301; Size: Label size: CN 28(EU 28)')
  assert.equal(result.data[0].合身情况, 'True to size')
  assert.equal(result.data[0].评价图片, 'https://rewimg-eu.kwcdn.com/review-image/a.jpeg')
  assert.equal(result.data[0].数据来源, 'engels/reviews/list')
  assert.ok(calls.some(url => url.includes('/de-en/api/bg/engels/reviews/info')))
  assert.ok(calls.some(url => url.includes('/de-en/api/bg/engels/reviews/list')))
  assert.ok(calls.some(url => url.includes('goods_id=605693750906920')))
})

test('single product reviews navigates to provided product page before collection', async () => {
  let fetchCalled = false
  const result = await runScript({
    href: 'https://www.temu.com/de-en',
    params: { product_url: PRODUCT_URL },
    fetchImpl: async () => {
      fetchCalled = true
      return createJsonResponse({})
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'main')
  assert.equal(result.meta.shared.goods_id, '605693750906920')
  assert.equal(result.meta.shared.product_url, PRODUCT_URL)
  assert.equal(fetchCalled, false)
})

test('single product reviews collects multiple product links sequentially', async () => {
  const productUrls = `${PRODUCT_URL}\n${SECOND_PRODUCT_URL}`
  const fetchImpl = async (url) => {
    const goodsId = new URL(String(url)).searchParams.get('goods_id')
    return createJsonResponse({
      data: [
        {
          review_id: `REVIEW-${goodsId}`,
          comment: `review for ${goodsId}`,
          score: 5,
          goods_id: goodsId,
          name: 'li***er',
        },
      ],
      total: 1,
      has_more: false,
    })
  }

  const first = await runScript({
    href: PRODUCT_URL,
    params: { product_url: productUrls, page_size: 10, max_pages: 3 },
    fetchImpl,
  })

  assert.equal(first.success, true)
  assert.equal(first.meta.action, 'complete')
  assert.equal(first.meta.has_more, true)
  assert.equal(first.meta.shared.product_index, 1)
  assert.equal(first.data.length, 1)
  assert.equal(first.data[0].商品ID, '605693750906920')
  assert.equal(first.data[0].商品链接, PRODUCT_URL)

  const second = await runScript({
    href: SECOND_PRODUCT_URL,
    params: { product_url: productUrls, page_size: 10, max_pages: 3 },
    shared: first.meta.shared,
    fetchImpl,
  })

  assert.equal(second.success, true)
  assert.equal(second.meta.action, 'complete')
  assert.equal(second.meta.has_more, false)
  assert.equal(second.meta.shared.product_index, 1)
  assert.equal(second.meta.shared.total_products, 2)
  assert.equal(second.data.length, 1)
  assert.equal(second.data[0].商品ID, '606106067809179')
  assert.equal(second.data[0].商品链接, SECOND_PRODUCT_URL)
})

test('single product reviews retries busy product API without mixing similar-item reviews', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    if (String(url).includes('/reviews/similar/list')) {
      return createJsonResponse({
        data: [
          {
            review_id: 'SIMILAR-1',
            goods_id: '606106067809179',
            comment: 'similar item review',
            score: 5,
          },
        ],
      })
    }
    return createJsonResponse({ success: false, error_code: 40002, error_msg: 'System busy！' }, 429)
  }

  const result = await runScript({
    params: { product_url: PRODUCT_URL, max_busy_retries: 1 },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'main')
  assert.equal(result.meta.shared.busy_retry_count, 1)
  assert.equal(result.data.length, 0)
  assert.equal(calls.some(url => url.includes('/reviews/similar/list')), false)
})

test('single product reviews uses similar API only after strict target goods filtering', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    if (String(url).includes('/reviews/list')) {
      return createJsonResponse({ success: false, error_code: 40002, error_msg: 'System busy！' }, 429)
    }
    if (String(url).includes('/reviews/info')) {
      return createJsonResponse({ success: false, error_code: 40002, error_msg: 'System busy！' }, 429)
    }
    if (String(url).includes('/reviews/similar/list')) {
      return createJsonResponse({
        data: [
          {
            review_id: 'TARGET-1',
            comment: 'target goods review from similar endpoint',
            score: 5,
            goods_id: '605693750906920',
            name: 'ta***et',
          },
          {
            review_id: 'OTHER-1',
            comment: 'other goods review must be ignored',
            score: 5,
            goods_id: '606106067809179',
            name: 'ot***er',
          },
        ],
        total: 2,
        has_more: false,
      })
    }
    return createJsonResponse({})
  }

  const result = await runScript({
    params: { product_url: PRODUCT_URL, max_busy_retries: 0 },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].评价ID, 'TARGET-1')
  assert.equal(result.data[0].商品ID, '605693750906920')
  assert.equal(result.data[0].数据来源, 'engels/reviews/similar/list')
  assert.equal(calls.some(url => url.includes('/reviews/similar/list')), true)
})

test('single product reviews still uses list API when optional info API is busy', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    if (String(url).includes('/reviews/info')) {
      return createJsonResponse({ success: false, error_code: 40002, error_msg: 'System busy！' }, 429)
    }
    return createJsonResponse({
      data: [
        {
          review_id: 'LIST-ONLY-1',
          comment: 'list endpoint still works',
          score: 5,
          goods_id: '605693750906920',
          name: 'li***er',
        },
      ],
      total: 1,
      has_more: false,
    })
  }

  const result = await runScript({
    params: { product_url: PRODUCT_URL, max_busy_retries: 0 },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].评价ID, 'LIST-ONLY-1')
  assert.equal(result.data[0].数据来源, 'engels/reviews/list')
  assert.equal(result.meta.shared.api_busy, false)
  assert.ok(calls.some(url => url.includes('/reviews/info')))
  assert.ok(calls.some(url => url.includes('/reviews/list')))
})

test('single product reviews opens all-review dialog when direct list API is busy', async () => {
  const fetchImpl = async () => createJsonResponse({ success: false, error_code: 40002, error_msg: 'System busy！' }, 429)
  const rawData = {
    store: {
      reviewStore: {
        commentList: createReviewItems('605693750906920', 'EMBEDDED', 4),
      },
    },
  }

  const result = await runScript({
    params: { product_url: PRODUCT_URL, max_busy_retries: 0 },
    fetchImpl,
    document: createSeeAllDocument(),
    rawData,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'capture_click_requests')
  assert.equal(result.meta.next_phase, 'parse_dialog_click_capture')
  assert.equal(result.meta.shared_key, 'dialog_click_capture')
  assert.equal(result.meta.include_response_body, true)
  assert.equal(result.meta.min_matches, 1)
  assert.equal(JSON.stringify(result.meta.clicks), JSON.stringify([{ x: 330, y: 441, delay_ms: 120 }]))
  assert.equal(JSON.stringify(result.meta.matches), JSON.stringify([{ url_contains: '/api/bg/engels/reviews/list', method: 'GET', status: 200 }]))
  assert.equal(result.meta.shared.api_busy, true)
  assert.equal(result.meta.shared.goods_id, '605693750906920')
})

test('single product reviews does not treat page scroller as an open all-review dialog', async () => {
  const fetchImpl = async () => createJsonResponse({ success: false, error_code: 40002, error_msg: 'System busy！' }, 429)
  const rawData = {
    store: {
      reviewStore: {
        commentList: createReviewItems('605693750906920', 'EMBEDDED', 4),
      },
    },
  }

  const result = await runScript({
    params: { product_url: PRODUCT_URL, max_busy_retries: 0 },
    fetchImpl,
    document: createPageScrollerSeeAllDocument(),
    rawData,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'capture_click_requests')
  assert.equal(result.meta.next_phase, 'parse_dialog_click_capture')
  assert.equal(result.meta.shared_key, 'dialog_click_capture')
  assert.equal(JSON.stringify(result.meta.clicks), JSON.stringify([{ x: 330, y: 441, delay_ms: 120 }]))
})

test('single product reviews uses already open all-review dialog when direct list API is busy', async () => {
  const fetchImpl = async () => createJsonResponse({ success: false, error_code: 40002, error_msg: 'System busy！' }, 429)
  const rawData = {
    store: {
      reviewStore: {
        commentList: createReviewItems('605693750906920', 'EMBEDDED', 4),
      },
    },
  }

  const result = await runScript({
    params: { product_url: PRODUCT_URL, max_busy_retries: 0 },
    fetchImpl,
    document: createDialogDocument(),
    rawData,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'capture_wheel_requests')
  assert.equal(result.meta.next_phase, 'parse_dialog_wheel_capture')
  assert.equal(result.meta.shared_key, 'dialog_wheel_captures')
  assert.equal(result.meta.shared.api_busy, true)
  assert.equal(result.meta.shared.dialog_no_progress_rounds, 0)
  assert.equal(JSON.stringify(result.meta.wheels), JSON.stringify([
    { x: 610, y: 456, delta_y: 700, delay_ms: 700 },
    { x: 610, y: 456, delta_y: 700, delay_ms: 700 },
    { x: 610, y: 456, delta_y: 700, delay_ms: 700 },
  ]))
})

test('single product reviews prefers open dialog wheel capture over stale see-all button click', async () => {
  const fetchImpl = async () => createJsonResponse({ success: false, error_code: 40002, error_msg: 'System busy！' }, 429)
  const document = createDialogDocument()
  const seeAll = new FakeElement({
    tagName: 'div',
    text: 'See all reviews',
    attributes: { role: 'button' },
    rect: { left: 220, top: 420, width: 220, height: 42 },
  })
  document.setSelector('button,a,[role="button"],div,span', [seeAll])

  const result = await runScript({
    params: { product_url: PRODUCT_URL, max_busy_retries: 0 },
    fetchImpl,
    document,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'capture_wheel_requests')
  assert.equal(result.meta.next_phase, 'parse_dialog_wheel_capture')
  assert.equal(result.meta.shared_key, 'dialog_wheel_captures')
})

test('single product reviews tries dialog API capture before fully loaded dialog DOM fallback', async () => {
  const fetchImpl = async () => createJsonResponse({ success: false, error_code: 40002, error_msg: 'System busy！' }, 429)
  const document = createDialogDocument()
  const cards = Array.from({ length: 111 }, (_, index) => createDomCard({ index: index + 1, content: 'Loaded dialog review' }))
  document.setSelector('div._9WTBQrvq', cards)
  document.setSelector('._9WTBQrvq', cards)
  document.setSelector('[class*="_9WTBQrvq"]', cards)
  document.setSelector('[role="dialog"] ._9WTBQrvq,[role="dialog"] [class*="_9WTBQrvq"]', cards)
  document.body._text = '111 reviews Item reviews All reviews are from verified purchases'

  const result = await runScript({
    params: { product_url: PRODUCT_URL, max_busy_retries: 0 },
    fetchImpl,
    document,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'capture_wheel_requests')
  assert.equal(result.meta.next_phase, 'parse_dialog_wheel_capture')
  assert.equal(result.meta.shared_key, 'dialog_wheel_captures')
  assert.equal(result.data.length, 0)
})

test('single product reviews keeps duplicate-looking loaded dialog DOM cards by position', async () => {
  const fetchImpl = async () => createJsonResponse({ success: false, error_code: 40002, error_msg: 'System busy！' }, 429)
  const document = createDialogDocument()
  const cards = [
    createDomCard({ name: 'same***buyer', date: 'Jun 10, 2026', content: 'duplicate text', index: 1 }),
    createDomCard({ name: 'same***buyer', date: 'Jun 10, 2026', content: 'duplicate text', index: 1 }),
  ]
  document.setSelector('div._9WTBQrvq', cards)
  document.setSelector('._9WTBQrvq', cards)
  document.setSelector('[class*="_9WTBQrvq"]', cards)
  document.setSelector('[role="dialog"] ._9WTBQrvq,[role="dialog"] [class*="_9WTBQrvq"]', cards)
  document.body._text = '2 reviews Item reviews All reviews are from verified purchases'

  const result = await runScript({
    params: { product_url: PRODUCT_URL, max_busy_retries: 0 },
    phase: 'parse_dialog_wheel_capture',
    fetchImpl,
    document,
    shared: {
      product_urls: [PRODUCT_URL],
      product_index: 0,
      total_products: 1,
      goods_id: '605693750906920',
      product_url: PRODUCT_URL,
      api_busy: true,
      api_busy_message: 'System busy！',
      dialog_wheel_captures: {
        ok: false,
        matches: [],
      },
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.data.length, 2)
  assert.equal(result.data[0].评论序号, 1)
  assert.equal(result.data[1].评论序号, 2)
})

test('single product reviews reads country from nested dialog DOM aria label', async () => {
  const fetchImpl = async () => createJsonResponse({ success: false, error_code: 40002, error_msg: 'System busy！' }, 429)
  const document = createDialogDocument()
  const meta = new FakeElement({ className: '_3t3Ev35j', text: 'sn***uk in on Jan 29, 2026' })
  meta
    .appendChild(new FakeElement({ className: 'M-mQ_cI0 pWNP-mkY', attributes: { role: 'link', 'aria-label': 'avatar' } }))
    ._children[0].appendChild(new FakeElement({
      tagName: 'img',
      attributes: { alt: 'avatar', src: 'https://avatar-eu.kwcdn.com/avatar.png' },
    }))
  meta
    .appendChild(new FakeElement({ className: 'XTEkYdlM _3a8V1xkt', text: 'sn***uk' }))
    .appendChild(new FakeElement({
      className: '_1tSRIohB oGEL6d3R',
      text: 'in on Jan 29, 2026',
      attributes: { role: 'text', 'aria-label': 'in Germany on Jan 29, 2026' },
    }))
  const card = new FakeElement({ className: '_9WTBQrvq', text: 'sn***uk in on Jan 29, 2026 Great quality' })
  card
    .appendChild(meta)
    .appendChild(new FakeElement({ className: '_21WXPU_9' }))
    ._children[1].appendChild(new FakeElement({
      className: '_7JDNQb0g _1uEtAYnT',
      attributes: { 'aria-label': '5 out of five stars' },
    }))
  card
    .appendChild(new FakeElement({ className: '_2Y-spytg', text: 'Purchased: Ivory White / Label size: 92' }))
    .appendChild(new FakeElement({ className: '_35Cqvk-G', text: 'Overall fit: Large' }))
    .appendChild(new FakeElement({
      tagName: 'img',
      className: '_17EhhWj_',
      attributes: { alt: 'Reviews image', src: 'https://rewimg-eu.kwcdn.com/review-image/demo.jpeg' },
    }))
    .appendChild(new FakeElement({ className: '_2Zm74do1 N4fQ1-w3', text: 'Great quality' }))
    .appendChild(new FakeElement({ className: 'tbAzrtq-', text: 'Review before translation: Sehr gut' }))
    .appendChild(new FakeElement({
      className: '_5JqQ7LxG',
      text: 'Helpful ( 7 people )',
      attributes: { role: 'button', 'aria-label': '7 people think this review is helpful，click to approve' },
    }))
    .appendChild(new FakeElement({ className: 'purchase-times', text: 'Purchased 2 times' }))
  document.setSelector('div._9WTBQrvq', [card])
  document.setSelector('._9WTBQrvq', [card])
  document.setSelector('[class*="_9WTBQrvq"]', [card])
  document.setSelector('[role="dialog"] ._9WTBQrvq,[role="dialog"] [class*="_9WTBQrvq"]', [card])
  document.body._text = '1 reviews Item reviews All reviews are from verified purchases'

  const result = await runScript({
    params: { product_url: PRODUCT_URL, max_busy_retries: 0 },
    phase: 'parse_dialog_wheel_capture',
    fetchImpl,
    document,
    shared: {
      product_urls: [PRODUCT_URL],
      product_index: 0,
      total_products: 1,
      goods_id: '605693750906920',
      product_url: PRODUCT_URL,
      api_busy: true,
      api_busy_message: 'System busy！',
      dialog_wheel_captures: {
        ok: false,
        matches: [],
      },
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].买家昵称, 'sn***uk')
  assert.equal(result.data[0].评分, '5')
  assert.equal(result.data[0].规格, 'Ivory White / Label size: 92')
  assert.equal(result.data[0].合身情况, 'Large')
  assert.equal(result.data[0].评价内容, 'Great quality')
  assert.equal(result.data[0].评价原文, 'Sehr gut')
  assert.equal(result.data[0].评价国家, 'Germany')
  assert.equal(result.data[0].评价时间原文, 'in Germany on Jan 29, 2026')
  assert.equal(result.data[0].评价图片, 'https://rewimg-eu.kwcdn.com/review-image/demo.jpeg')
  assert.equal(result.data[0].头像, 'https://avatar-eu.kwcdn.com/avatar.png')
  assert.equal(result.data[0].有帮助人数, '7')
  assert.equal(result.data[0].购买次数, '2')
})

test('single product reviews scrolls all-review dialog after parsing first captured page', async () => {
  const firstPage = createCapturedMatch('605693750906920', 1, 10, 25, true)

  const result = await runScript({
    params: { product_url: PRODUCT_URL, page_size: 10, max_pages: 3 },
    phase: 'parse_dialog_click_capture',
    fetchImpl: async () => createJsonResponse({}),
    document: createDialogDocument(),
    shared: {
      product_urls: [PRODUCT_URL],
      product_index: 0,
      total_products: 1,
      goods_id: '605693750906920',
      product_url: PRODUCT_URL,
      api_busy: true,
      api_busy_message: 'System busy！',
      dialog_click_capture: {
        ok: true,
        matches: [firstPage],
      },
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'capture_wheel_requests')
  assert.equal(result.meta.next_phase, 'parse_dialog_wheel_capture')
  assert.equal(result.meta.shared_key, 'dialog_wheel_captures')
  assert.equal(result.meta.shared_append, true)
  assert.equal(result.meta.include_response_body, true)
  assert.equal(result.meta.min_matches, 1)
  assert.equal(result.meta.shared.dialog_reviews.length, 10)
  assert.equal(result.meta.shared.dialog_loaded_pages.length, 1)
  assert.equal(JSON.stringify(result.meta.wheels), JSON.stringify([
    { x: 610, y: 456, delta_y: 700, delay_ms: 700 },
    { x: 610, y: 456, delta_y: 700, delay_ms: 700 },
    { x: 610, y: 456, delta_y: 700, delay_ms: 700 },
  ]))
})

test('single product reviews completes with dialog captured pages before embedded fallback', async () => {
  const firstPage = createCapturedMatch('605693750906920', 1, 10, 15, true)
  const secondPage = createCapturedMatch('605693750906920', 2, 5, 15, false)
  const rawData = {
    store: {
      reviewStore: {
        commentList: createReviewItems('605693750906920', 'EMBEDDED', 4),
      },
    },
  }

  const result = await runScript({
    params: { product_url: PRODUCT_URL, page_size: 10, max_pages: 3 },
    phase: 'parse_dialog_wheel_capture',
    fetchImpl: async () => createJsonResponse({}),
    document: createDialogDocument(),
    rawData,
    shared: {
      product_urls: [PRODUCT_URL],
      product_index: 0,
      total_products: 1,
      goods_id: '605693750906920',
      product_url: PRODUCT_URL,
      api_busy: true,
      api_busy_message: 'System busy！',
      dialog_reviews: createReviewItems('605693750906920', 'PAGE-1', 10, 1),
      dialog_loaded_pages: [1],
      dialog_api_total: 15,
      dialog_wheel_captures: {
        ok: true,
        matches: [secondPage],
      },
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.shared.api_fallback, 'dialog-engels/reviews/list')
  assert.equal(result.meta.shared.total_reviews, 15)
  assert.equal(result.data.length, 15)
  assert.equal(result.data[0].数据来源, 'dialog-engels/reviews/list')
  assert.equal(result.data.some(row => row.评价ID === 'EMBEDDED-1'), false)
})

test('single product reviews completes partial dialog rows after repeated wheel capture without progress', async () => {
  const result = await runScript({
    params: { product_url: PRODUCT_URL, page_size: 10, max_pages: 20 },
    phase: 'parse_dialog_wheel_capture',
    fetchImpl: async () => createJsonResponse({}),
    document: createDialogDocument(),
    shared: {
      product_urls: [PRODUCT_URL],
      product_index: 0,
      total_products: 1,
      goods_id: '605693750906920',
      product_url: PRODUCT_URL,
      api_busy: true,
      api_busy_message: 'System busy！',
      dialog_reviews: createReviewItems('605693750906920', 'PAGE-1', 10, 1),
      dialog_loaded_pages: [1],
      dialog_api_total: 111,
      dialog_last_page_size: 10,
      dialog_no_progress_rounds: 1,
      dialog_wheel_captures: {
        ok: false,
        matches: [],
      },
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.data.length, 10)
  assert.equal(result.meta.shared.api_fallback, 'dialog-engels/reviews/list')
  assert.equal(result.meta.shared.dialog_no_progress_rounds, 2)
})

test('single product reviews uses page embedded review state before DOM fallback', async () => {
  const document = new FakeDocument('visible DOM text should not be used')
  const fetchImpl = async () => createJsonResponse({ success: false, error_code: 40002, error_msg: 'System busy！' }, 429)
  const rawData = {
    store: {
      reviewStore: {
        commentList: [
          {
            reviewId: 'EMBEDDED-1',
            comment: 'суперские',
            reviewLang: { translateComment: 'awesome' },
            score: 5,
            goodsId: '605693750906920',
            skuId: 105297163106553,
            specs: [{ specKey: 'Color', specValue: 'Pink Green 40301' }, { specKey: 'Size', specValue: 'CN 28' }],
            time: 1781102454,
            concatTimeLang: 'on Jun 10, 2026',
            concatRichText: { ariaLabel: 'in Poland on Jun 10, 2026' },
            name: 'al***ka',
            goodsSpecificReviewLevelInfo: { text: 'True to size' },
          },
        ],
      },
    },
  }

  const result = await runScript({
    params: { product_url: PRODUCT_URL, max_busy_retries: 0 },
    fetchImpl,
    document,
    rawData,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.shared.api_busy, true)
  assert.equal(result.meta.shared.api_fallback, 'page-embedded-review-state')
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].评价ID, 'EMBEDDED-1')
  assert.equal(result.data[0].商品ID, '605693750906920')
  assert.equal(result.data[0].SKU_ID, '105297163106553')
  assert.equal(result.data[0].评价内容, 'awesome')
  assert.equal(result.data[0].评价原文, 'суперские')
  assert.equal(result.data[0].评价国家, 'Poland')
  assert.equal(result.data[0].数据来源, 'page-embedded-review-state')
})

test('single product reviews uses current page DOM cards as final fallback for the same goods id', async () => {
  const card = new FakeElement({ className: '_9WTBQrvq', text: 'fl***ku in on May 27, 2026 Really good quality, highly recommend!' })
  card
    .appendChild(new FakeElement({
      className: '_3OHJMKy5',
      text: 'fl***ku in on May 27, 2026',
      attributes: { 'aria-label': 'in Germany on May 27, 2026' },
    }))
    .appendChild(new FakeElement({ className: '_21WXPU_9', attributes: { 'aria-label': '5 out of five stars' } }))
    .appendChild(new FakeElement({ className: '_2Zm74do1 N4fQ1-w3', text: 'Really good quality, highly recommend!' }))

  const document = new FakeDocument('6 reviews 5,0 All reviews are from verified purchases See all reviews')
  document.setSelector('div._9WTBQrvq', [card])
  document.setSelector('._9WTBQrvq', [card])

  const fetchImpl = async () => createJsonResponse({ success: false, error_code: 40002, error_msg: 'System busy！' }, 429)

  const result = await runScript({
    params: { product_url: PRODUCT_URL, max_busy_retries: 0 },
    fetchImpl,
    document,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.shared.api_busy, true)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].商品ID, '605693750906920')
  assert.equal(result.data[0].买家昵称, 'fl***ku')
  assert.equal(result.data[0].评价内容, 'Really good quality, highly recommend!')
  assert.equal(result.data[0].评价时间原文, 'in Germany on May 27, 2026')
  assert.equal(result.data[0].数据来源, 'dom-visible-cards')
})

test('single product reviews DOM fallback excludes similar-item review cards', async () => {
  const ownCard = new FakeElement({ className: '_9WTBQrvq', text: 'fl***ku in on May 27, 2026 Own product review' })
  ownCard
    .appendChild(new FakeElement({ className: '_3OHJMKy5', text: 'fl***ku in on May 27, 2026' }))
    .appendChild(new FakeElement({ className: '_21WXPU_9', attributes: { 'aria-label': '5 out of five stars' } }))
    .appendChild(new FakeElement({ className: '_2Zm74do1 N4fQ1-w3', text: 'Own product review' }))

  const similarCard = new FakeElement({
    className: '_9WTBQrvq',
    text: 'me***l2 in on Jun 6, 2026 Similar review This review is for: Another Balabala product',
  })
  similarCard
    .appendChild(new FakeElement({ className: '_3OHJMKy5', text: 'me***l2 in on Jun 6, 2026' }))
    .appendChild(new FakeElement({ className: '_21WXPU_9', attributes: { 'aria-label': '5 out of five stars' } }))
    .appendChild(new FakeElement({ className: '_2Zm74do1 N4fQ1-w3', text: 'Similar review' }))
    .appendChild(new FakeElement({ tagName: 'a', text: 'This review is for: Another Balabala product' }))

  const document = new FakeDocument('6 reviews 5,0 See all reviews Reviews from similar items')
  document.setSelector('div._9WTBQrvq', [ownCard, similarCard])
  document.setSelector('._9WTBQrvq', [ownCard, similarCard])

  const result = await runScript({
    params: { product_url: PRODUCT_URL, max_busy_retries: 0 },
    fetchImpl: async () => createJsonResponse({ success: false, error_code: 40002, error_msg: 'System busy！' }, 429),
    document,
  })

  assert.equal(result.success, true)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].评价内容, 'Own product review')
})
