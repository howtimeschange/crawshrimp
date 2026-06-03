import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

class FakeStorage {
  constructor(initial = {}) {
    this._map = new Map(Object.entries(initial).map(([key, value]) => [String(key), String(value)]))
  }

  get length() { return this._map.size }
  key(index) { return Array.from(this._map.keys())[index] || null }
  getItem(key) { return this._map.has(String(key)) ? this._map.get(String(key)) : null }
  setItem(key, value) { this._map.set(String(key), String(value)) }
  removeItem(key) { this._map.delete(String(key)) }
}

class FakeElement {
  constructor(text = '', attrs = {}) {
    this.innerText = text
    this.textContent = text
    Object.assign(this, attrs)
  }
}

class FakeDocument {
  constructor(bodyText = '', cookie = '', selectors = {}) {
    this.body = new FakeElement(bodyText)
    this.cookie = cookie
    this.selectors = selectors
  }

  querySelectorAll(selector) { return this.selectors[selector] || [] }
  querySelector() { return null }
}

function buildAccountInfo(region = 'US', shopId = '7496042382582647544') {
  return JSON.stringify({
    value: {
      data: {
        global_seller: {
          global_seller_id: shopId,
          global_seller_name: 'balabalakids',
        },
        shop: {
          shop_id: shopId,
          shop_name: 'balabalakids',
          region,
        },
      },
    },
  })
}

async function runScript(scriptName, {
  phase = 'main',
  page = 1,
  params = {},
  shared = {},
  href,
  fetchImpl,
  localStorage = {},
  sessionStorage = {},
  windowProps = {},
  navigator = {
    language: 'zh-CN',
    platform: 'MacIntel',
    appCodeName: 'Mozilla',
    userAgent: 'Mozilla/5.0 Test',
    onLine: true,
  },
  screen = { width: 1512, height: 982 },
  performance,
  Date: DateCtor = Date,
  bodyText = '',
  cookie = 'oec_seller_id_unified_seller_env=7496042382582647544; global_seller_id_unified_seller_env=7496042382582647544',
  document: documentImpl,
} = {}) {
  const scriptPath = path.resolve('adapters/tiktok-ops-assistant', scriptName)
  const source = fs.readFileSync(scriptPath, 'utf8')
  const locationUrl = new URL(href || 'https://seller.us.tiktokshopglobalselling.com/product/rating?shop_region=US&shop_id=7496042382582647544')
  const storage = new FakeStorage({
    ecom_seller_base_account_info: buildAccountInfo('US'),
    'ecom-seller-affiliate-selected-shop-region': 'US',
    ...localStorage,
  })
  const win = {
    __CRAWSHRIMP_PARAMS__: params,
    __CRAWSHRIMP_PHASE__: phase,
    __CRAWSHRIMP_PAGE__: page,
    __CRAWSHRIMP_SHARED__: shared,
    location: locationUrl,
    localStorage: storage,
    sessionStorage: new FakeStorage(sessionStorage),
    navigator,
    screen,
    performance,
  }
  Object.assign(win, windowProps)
  const context = {
    window: win,
    document: documentImpl || new FakeDocument(bodyText, cookie),
    location: locationUrl,
    localStorage: storage,
    sessionStorage: win.sessionStorage,
    navigator,
    screen,
    performance,
    fetch: fetchImpl || (async () => { throw new Error('fetch not mocked') }),
    console,
    setTimeout: (callback, ms, ...args) => {
      Promise.resolve().then(() => callback(...args))
      return { ms }
    },
    clearTimeout,
    URL,
    URLSearchParams,
    JSON,
    Math,
    Date: DateCtor,
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
  win.fetch = (...args) => context.fetch(...args)
  return await vm.runInNewContext(source, context, { filename: scriptPath })
}

function createJsonResponse(payload, status = 200, responseUrl = 'https://example.test/api?msToken=x&X-Bogus=y') {
  return {
    status,
    ok: status >= 200 && status < 300,
    url: responseUrl,
    async json() { return payload },
    async text() { return JSON.stringify(payload) },
    clone() { return this },
    headers: { get() { return '' } },
  }
}

function fixedDateClass(isoText) {
  const RealDate = Date
  return class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate(isoText)
      return new RealDate(...args)
    }
    static now() { return new RealDate(isoText).getTime() }
    static UTC(...args) { return RealDate.UTC(...args) }
    static parse(value) { return RealDate.parse(value) }
  }
}

test('product rating collects selected star filters across selected regions', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'))
    calls.push({
      url: String(url),
      headers: init.headers,
      body,
    })
    const region = init.headers['X-Tt-Oec-Region'] || init.headers['x-tt-oec-region']
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: {
        total: region === 'US' ? 2 : 1,
        list: [
          {
            main_review_id: `${region}-R-${body.page}`,
            star_level: body.star_level[0],
            review_text: `${region} review`,
            reply_text: region === 'US' ? 'thanks' : '',
            reply_count: region === 'US' ? 1 : 0,
            product_info: {
              product_name: `${region} shoe`,
              product_id: `${region}-P`,
              sku_id: `${region}-SKU`,
              sku_specification: 'pink, toddler',
              img: { url_list: [`https://img.example/${region}.jpg`] },
            },
            order_id: `${region}-O`,
            user_name: `${region} buyer`,
            can_reply: true,
            is_marked: false,
            has_imgs: true,
            review_time: '1778094950283',
            reply_time: region === 'US' ? '1778094960000' : '0',
            review_images: [{ url_list: [`https://review.example/${region}.jpg`] }],
          },
        ],
      },
      next_cursor: body.page < (region === 'US' ? 2 : 1) ? String(body.page * body.size) : '',
    })
  }

  let result = await runScript('product-rating.js', {
    params: {
      shop_regions: ['US', 'GB'],
      star_levels: ['1', '4'],
      page_size: 1,
      max_pages_per_region: 5,
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'main')
  assert.equal(result.meta.has_more, true)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].区域, 'US')
  assert.equal(result.data[0].评分, 1)
  assert.equal(result.data[0].评价原文, 'US review')
  assert.equal(result.data[0].商品ID, 'US-P')
  assert.equal(result.data[0].评价图片, 'https://review.example/US.jpg')
  assert.deepEqual(calls[0].body.star_level, [1, 4])
  assert.equal(calls[0].body.page, 1)
  assert.equal(calls[0].headers['X-Tt-Oec-Region'], 'US')

  result = await runScript('product-rating.js', {
    params: {
      shop_regions: ['US', 'GB'],
      star_levels: ['1', '4'],
      page_size: 1,
      max_pages_per_region: 5,
    },
    shared: result.meta.shared,
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.has_more, true)
  assert.equal(result.data[0].区域, 'US')
  assert.equal(result.data[0].页码, 2)
  assert.equal(calls[1].body.page, 2)

  result = await runScript('product-rating.js', {
    params: {
      shop_regions: ['US', 'GB'],
      star_levels: ['1', '4'],
      page_size: 1,
      max_pages_per_region: 5,
    },
    shared: result.meta.shared,
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.match(result.meta.shared.target_url, /^https:\/\/seller\.eu\.tiktokshopglobalselling\.com\/product\/rating/)
  assert.match(result.meta.shared.target_url, /shop_region=GB/)

  result = await runScript('product-rating.js', {
    href: result.meta.shared.target_url,
    params: {
      shop_regions: ['US', 'GB'],
      star_levels: ['1', '4'],
      page_size: 1,
      max_pages_per_region: 5,
    },
    shared: result.meta.shared,
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.has_more, false)
  assert.equal(result.data[0].区域, 'GB')
  assert.equal(calls[2].headers['X-Tt-Oec-Region'], 'GB')
})

test('product rating prefers global seller cookie over oec cookie when URL has no shop_id', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push(String(url))
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: {
        total: 1,
        list: [
          {
            main_review_id: 'R-global-shop',
            star_level: 5,
            review_text: 'ok',
            product_info: { product_id: 'P-global-shop' },
            review_time: '1778094950283',
          },
        ],
      },
    })
  }

  const result = await runScript('product-rating.js', {
    href: 'https://seller.us.tiktokshopglobalselling.com/product/rating?shop_region=US',
    cookie: 'oec_seller_id_unified_seller_env=8648408801229380344; global_seller_id_unified_seller_env=7496042382582647544',
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].店铺ID, '7496042382582647544')
  assert.match(calls[0], /oec_seller_id=7496042382582647544/)
  assert.doesNotMatch(calls[0], /oec_seller_id=8648408801229380344/)
})

test('product rating uses page api host and region local seller id for EU regions', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({
      url: String(url),
      credentials: init.credentials,
      headers: init.headers,
      body: JSON.parse(String(init.body || '{}')),
    })
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: {
        total: 1,
        list: [
          {
            main_review_id: 'FR-R-local-shop',
            star_level: 4,
            review_text: 'bonjour',
            product_info: { product_id: 'FR-P' },
            review_time: '1778094950283',
          },
        ],
      },
    })
  }

  const result = await runScript('product-rating.js', {
    href: 'https://seller.eu.tiktokshopglobalselling.com/product/rating?shop_region=FR&shop_id=7496042382582647544',
    params: { shop_regions: ['FR'] },
    cookie: 's_v_web_id=verify-cookie; oec_seller_id_unified_seller_env=7496042382582647544; global_seller_id_unified_seller_env=7496042382582647544',
    performance: {
      getEntriesByType(type) {
        assert.equal(type, 'resource')
        return [
          {
            name: 'https://api16-normal-no1a.tiktokshopglobalselling.com/api/v1/review/biz_backend/list?locale=zh-CN',
          },
        ]
      },
    },
    windowProps: {
      __SELLER_USER_STORE__: {
        localSellerId: '8648408801229380344',
        regions: {
          '8648342506223999736': 'DE',
          '8648654692630895352': 'ES',
          '8648408801229380344': 'FR',
          '8648409206136478456': 'GB',
          '8648654349935155960': 'IT',
          '7496042382582647544': 'US',
        },
      },
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.data[0].区域, 'FR')
  assert.equal(result.data[0].店铺ID, '8648408801229380344')
  assert.equal(calls[0].credentials, 'include')
  assert.equal(calls[0].headers['X-Tt-Oec-Region'], 'FR')
  assert.equal(calls[0].body.page, 1)
  const requestUrl = new URL(calls[0].url)
  assert.equal(requestUrl.origin, 'https://api16-normal-no1a.tiktokshopglobalselling.com')
  assert.equal(requestUrl.searchParams.get('oec_seller_id'), '8648408801229380344')
  assert.equal(requestUrl.searchParams.get('fp'), 'verify-cookie')
  assert.equal(requestUrl.searchParams.get('screen_width'), '1512')
  assert.equal(requestUrl.searchParams.get('screen_height'), '982')
  assert.equal(requestUrl.searchParams.get('browser_language'), 'zh-CN')
  assert.equal(requestUrl.searchParams.get('browser_platform'), 'MacIntel')
  assert.equal(requestUrl.searchParams.get('browser_name'), 'Mozilla')
  assert.equal(requestUrl.searchParams.get('browser_version'), 'Mozilla/5.0 Test')
})

test('product rating uses same-origin seller API for US even when stale api16 entries exist', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), credentials: init.credentials })
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: {
        total: 1,
        list: [
          {
            main_review_id: 'US-R-same-origin',
            star_level: 5,
            review_text: 'same origin ok',
            product_info: { product_id: 'US-P' },
            review_time: '1778094950283',
          },
        ],
      },
    })
  }

  const result = await runScript('product-rating.js', {
    href: 'https://seller.us.tiktokshopglobalselling.com/product/rating?shop_region=US',
    params: { shop_regions: ['US'] },
    performance: {
      getEntriesByType() {
        return [
          {
            name: 'https://api16-normal-useast5.tiktokshopglobalselling.com/api/v1/review/biz_backend/list?locale=zh-CN',
          },
        ]
      },
    },
    windowProps: {
      __SELLER_USER_STORE__: {
        localSellerId: '7496042382582647544',
        regions: { '7496042382582647544': 'US' },
      },
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.data[0].区域, 'US')
  assert.equal(result.data[0].店铺ID, '7496042382582647544')
  const requestUrl = new URL(calls[0].url)
  assert.equal(requestUrl.origin, 'https://seller.us.tiktokshopglobalselling.com')
  assert.equal(requestUrl.searchParams.get('oec_seller_id'), '7496042382582647544')
  assert.equal(calls[0].credentials, 'include')
})

test('product rating paces long pagination through next phase', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'))
    calls.push(body)
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: {
        total: 3015,
        list: Array.from({ length: body.page === 61 ? 15 : 50 }, (_, index) => ({
          main_review_id: `US-R-${body.page}-${index}`,
          star_level: 5,
          review_text: `review ${body.page}-${index}`,
          product_info: { product_id: `US-P-${index}` },
          review_time: '1778094950283',
        })),
      },
    })
  }

  const result = await runScript('product-rating.js', {
    href: 'https://seller.us.tiktokshopglobalselling.com/product/rating?shop_region=US',
    params: { shop_regions: ['US'], page_size: 50, max_pages_per_region: 200 },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'main')
  assert.equal(result.meta.sleep_ms, 900)
  assert.equal(result.meta.has_more, true)
  assert.equal(result.data.length, 50)
  assert.equal(result.meta.shared.page_no, 2)
  assert.equal(result.meta.shared.total_rows, 50)
  assert.deepEqual(calls[0], { page: 1, size: 20 })
})

test('product rating caps page size at 20 to avoid TikTok short pages', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'))
    calls.push(body)
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: {
        total: 3015,
        list: Array.from({ length: 20 }, (_, index) => ({
          main_review_id: `US-R-${index}`,
          star_level: 5,
          review_text: `review ${index}`,
          product_info: { product_id: `US-P-${index}` },
          review_time: '1778094950283',
        })),
      },
    })
  }

  const result = await runScript('product-rating.js', {
    href: 'https://seller.us.tiktokshopglobalselling.com/product/rating?shop_region=US',
    params: { shop_regions: ['US'], page_size: 50, max_pages_per_region: 200 },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.data.length, 20)
  assert.equal(result.meta.shared.page_size, 20)
  assert.deepEqual(calls[0], { page: 1, size: 20 })
})

test('product rating retries transient internal error before failing the run', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'))
    calls.push(body)
    if (calls.length === 1) {
      return createJsonResponse({ code: 500, message: 'internal error' })
    }
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: {
        total: 1,
        list: [
          {
            main_review_id: 'US-R-retry-ok',
            star_level: 5,
            review_text: 'retry ok',
            product_info: { product_id: 'US-P' },
            review_time: '1778094950283',
          },
        ],
      },
    })
  }

  const result = await runScript('product-rating.js', {
    href: 'https://seller.us.tiktokshopglobalselling.com/product/rating?shop_region=US',
    params: {
      shop_regions: ['US'],
      page_size: 50,
      request_retries: 1,
      retry_delay_ms: 1,
      page_delay_ms: 1,
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].评价ID, 'US-R-retry-ok')
  assert.equal(calls.length, 2)
})

test('product rating redirects bare US seller page to selected EU region URL before fetching', async () => {
  const result = await runScript('product-rating.js', {
    href: 'https://seller.us.tiktokshopglobalselling.com/product/rating',
    params: { shop_regions: ['FR'] },
    fetchImpl: async () => { throw new Error('should navigate before fetch') },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'main')
  assert.match(result.meta.shared.target_url, /^https:\/\/seller\.eu\.tiktokshopglobalselling\.com\/product\/rating/)
  assert.match(result.meta.shared.target_url, /shop_region=FR/)
  assert.match(result.meta.shared.target_url, /shop_id=7496042382582647544/)
})

test('product rating reports non JSON API body with response text instead of parser error', async () => {
  const result = await runScript('product-rating.js', {
    href: 'https://seller.eu.tiktokshopglobalselling.com/product/rating?shop_region=FR&shop_id=7496042382582647544',
    params: { shop_regions: ['FR'] },
    fetchImpl: async () => ({
      status: 404,
      ok: false,
      async json() { throw new SyntaxError('Unexpected token N') },
      async text() { return 'No matching route' },
      headers: { get() { return 'text/plain' } },
    }),
  })

  assert.equal(result.success, false)
  assert.match(result.error, /商品评分接口返回非 JSON/)
  assert.match(result.error, /No matching route/)
})

test('creator video task plans browser downloads then emits rows with download results', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'))
    calls.push({ url: String(url), body })
    assert.equal(body.params.detail_list_type, 3)
    assert.equal(body.params.video_list_params[0].page_param.page_size, 2)
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: {
        video_list_segments: [
          {
            total: 2,
            time_descriptor: {
              start_time: 1777449600,
              end_time: 1778054400,
              timezone_offset: -28800,
              granularity_type: 1,
            },
            video_performances: [
              {
                video_info: {
                  item_id: '7619062455813131550',
                  title: '#ad sandals',
                  create_time: '1773951224000',
                  cover: { thumb_url_list: ['https://cover.example/1.jpg'] },
                  play_info: {
                    id: 'v15044gf0000d6u5gdvog65imto4jbgg',
                    play_urls: [
                      'https://v16m-default.tiktokcdn-us.com/video-a.mp4?mime_type=video_mp4',
                      'https://api16-normal-useast5.tiktokv.us/aweme/v1/play/?item_id=7619062455813131550',
                    ],
                    duration: 22600,
                    width: 1080,
                    height: 1920,
                  },
                },
                creator_base: {
                  oec_id: '7494014102087828932',
                  handle_name: 'heatherstansberryy',
                  nick_name: 'Heather Stansberry',
                  follower_cnt: '41211',
                },
                product_base: {
                  id: '1730710259238277880',
                  title: 'Balabala sandals',
                  cover: { thumb_url_list: ['https://product.example/1.jpg'] },
                },
                categories: [{ category_name: '儿童时尚' }, { category_name: '男童鞋' }],
                video_metrics: {
                  video_gmv: { amount_formatted: '$1,517.56', amount: '1517.56' },
                  video_items_sold_cnt: { value: '55' },
                  video_refunded_gmv: { amount_formatted: '$29.90', amount: '29.9' },
                  video_refunded_items_cnt: { value: '1' },
                  video_orders_cnt: { value: '52' },
                  video_average_order_value: { amount_formatted: '$29.18', amount: '29.18' },
                  video_average_gmv_per_buyer: { amount_formatted: '$29.18', amount: '29.18' },
                  video_estimated_commission: { amount_formatted: '$126.08', amount: '126.08' },
                },
              },
            ],
          },
        ],
      },
    })
  }

  const first = await runScript('creator-video-download.js', {
    href: 'https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis?shop_region=US&shop_id=7496042382582647544',
    params: {
      shop_regions: ['US'],
      page_size: 2,
      max_pages_per_region: 1,
      download_concurrency: 2,
    },
    fetchImpl,
  })

  assert.equal(first.success, true)
  assert.equal(first.meta.action, 'download_urls')
  assert.equal(first.meta.items.length, 1)
  assert.equal(first.meta.items[0].browser_session, undefined)
  assert.equal(first.meta.items[0].no_proxy, true)
  assert.equal(first.meta.items[0].headers.Referer, 'https://affiliate.tiktokshopglobalselling.com/')
  assert.match(first.meta.items[0].headers['User-Agent'], /Mozilla\/5\.0/)
  assert.equal(first.meta.items[0].url, 'https://v16m-default.tiktokcdn-us.com/video-a.mp4?mime_type=video_mp4')
  assert.equal(first.meta.items[0].filename, '55件_US_heatherstansberryy_7619062455813131550_1730710259238277880_2026-03-19_12-13-44.mp4')
  assert.equal(first.meta.concurrency, 2)
  assert.equal(first.meta.shared.pendingRows[0].视频ID, '7619062455813131550')
  assert.equal(first.meta.shared.pendingRows[0].达人ID, '7494014102087828932')
  assert.equal(first.meta.shared.pendingRows[0].商品ID, '1730710259238277880')
  assert.equal(first.meta.shared.pendingRows[0].计划文件名, '55件_US_heatherstansberryy_7619062455813131550_1730710259238277880_2026-03-19_12-13-44.mp4')
  assert.equal(first.meta.shared.search_total_codes, 2)
  assert.equal(first.meta.shared.search_completed_codes, 1)
  assert.equal(first.meta.shared.current_store, 'TikTok达人视频下载 / US')

  const second = await runScript('creator-video-download.js', {
    phase: 'after_download',
    href: 'https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis?shop_region=US&shop_id=7496042382582647544',
    params: {
      shop_regions: ['US'],
      page_size: 2,
      max_pages_per_region: 1,
    },
    shared: {
      ...first.meta.shared,
      downloadResults: {
        ok: true,
        items: [
          {
            success: true,
            filename: '55件_US_heatherstansberryy_7619062455813131550_1730710259238277880_2026-03-19_12-13-44.mp4',
            path: '/tmp/tiktok/55件_US_heatherstansberryy_7619062455813131550_1730710259238277880_2026-03-19_12-13-44.mp4',
            bytes: 1234,
          },
        ],
      },
    },
    fetchImpl,
  })

  assert.equal(second.success, true)
  assert.equal(second.meta.action, 'complete')
  assert.equal(second.meta.has_more, false)
  assert.equal(second.data.length, 1)
  assert.equal(second.data[0].下载结果, '已下载')
  assert.equal(second.data[0].本地文件, '/tmp/tiktok/55件_US_heatherstansberryy_7619062455813131550_1730710259238277880_2026-03-19_12-13-44.mp4')
  assert.equal(second.data[0].联盟视频归因GMV, '$1,517.56')
})

test('creator video download queue sorts by sold count descending', async () => {
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'))
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: {
        video_list_segments: [
          {
            total: 2,
            time_descriptor: body.params.video_list_params[0].time_descriptor,
            video_performances: [
              {
                video_info: {
                  item_id: 'low-video',
                  title: 'low sold count',
                  create_time: '1773951224000',
                  play_info: {
                    id: 'play-low',
                    play_urls: ['https://v16m-default.tiktokcdn-us.com/low.mp4?mime_type=video_mp4'],
                  },
                },
                creator_base: { oec_id: 'creator-low', handle_name: 'lowcreator' },
                product_base: { id: 'low-product', title: 'Low product' },
                video_metrics: { video_items_sold_cnt: { value: '7' } },
              },
              {
                video_info: {
                  item_id: 'high-video',
                  title: 'high sold count',
                  create_time: '1773951224000',
                  play_info: {
                    id: 'play-high',
                    play_urls: ['https://v16m-default.tiktokcdn-us.com/high.mp4?mime_type=video_mp4'],
                  },
                },
                creator_base: { oec_id: 'creator-high', handle_name: 'highcreator' },
                product_base: { id: 'high-product', title: 'High product' },
                video_metrics: { video_items_sold_cnt: { value: '120' } },
              },
            ],
          },
        ],
      },
    })
  }

  const first = await runScript('creator-video-download.js', {
    href: 'https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis?shop_region=US&shop_id=7496042382582647544',
    params: { shop_regions: ['US'], page_size: 20, max_pages_per_region: 1 },
    fetchImpl,
  })

  assert.equal(first.success, true)
  assert.equal(first.meta.action, 'download_urls')
  assert.deepEqual(Array.from(first.meta.shared.pendingRows, row => row.视频ID), ['high-video', 'low-video'])
  assert.deepEqual(Array.from(first.meta.shared.pendingRows, row => row.视频归因成交件数), ['120', '7'])
  assert.deepEqual(Array.from(first.meta.items, item => item.url), [
    'https://v16m-default.tiktokcdn-us.com/high.mp4?mime_type=video_mp4',
    'https://v16m-default.tiktokcdn-us.com/low.mp4?mime_type=video_mp4',
  ])
  assert.equal(first.meta.items[0].filename, '120件_US_highcreator_high-video_high-product_2026-03-19_12-13-44.mp4')
  assert.equal(first.meta.items[1].filename, '7件_US_lowcreator_low-video_low-product_2026-03-19_12-13-44.mp4')

  const second = await runScript('creator-video-download.js', {
    phase: 'after_download',
    href: 'https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis?shop_region=US&shop_id=7496042382582647544',
    shared: {
      ...first.meta.shared,
      downloadResults: {
        ok: true,
        items: [
          {
            success: true,
            filename: first.meta.items[0].filename,
            path: `/tmp/tiktok/${first.meta.items[0].filename}`,
            bytes: 120,
          },
          {
            success: true,
            filename: first.meta.items[1].filename,
            path: `/tmp/tiktok/${first.meta.items[1].filename}`,
            bytes: 7,
          },
        ],
      },
    },
    fetchImpl,
  })

  assert.equal(second.success, true)
  assert.deepEqual(Array.from(second.data, row => row.视频ID), ['high-video', 'low-video'])
  assert.deepEqual(Array.from(second.data, row => row.本地文件), [
    '/tmp/tiktok/120件_US_highcreator_high-video_high-product_2026-03-19_12-13-44.mp4',
    '/tmp/tiktok/7件_US_lowcreator_low-video_low-product_2026-03-19_12-13-44.mp4',
  ])
})

test('creator video task completes probe stage across multiple pages before starting downloads', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'))
    const pageNo = body.params.video_list_params[0].page_param.page_no
    calls.push(pageNo)
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: {
        video_list_segments: [
          {
            total: 2,
            time_descriptor: body.params.video_list_params[0].time_descriptor,
            video_performances: [
              {
                video_info: {
                  item_id: `761906245581313155${pageNo}`,
                  title: `page-${pageNo}`,
                  create_time: '1773951224000',
                  cover: { thumb_url_list: [`https://cover.example/${pageNo}.jpg`] },
                  play_info: {
                    id: `play-${pageNo}`,
                    play_urls: [`https://v16m-default.tiktokcdn-us.com/video-${pageNo}.mp4?mime_type=video_mp4`],
                    duration: 22600,
                    width: 1080,
                    height: 1920,
                  },
                },
                creator_base: {
                  oec_id: `creator-${pageNo}`,
                  handle_name: `handle-${pageNo}`,
                  nick_name: `Creator ${pageNo}`,
                  follower_cnt: '100',
                },
                product_base: {
                  id: `product-${pageNo}`,
                  title: `Product ${pageNo}`,
                },
                categories: [{ category_name: '儿童时尚' }],
                video_metrics: {
                  video_gmv: { amount_formatted: '$10.00', amount: '10' },
                },
              },
            ],
          },
        ],
      },
    })
  }

  const first = await runScript('creator-video-download.js', {
    href: 'https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis?shop_region=US&shop_id=7496042382582647544',
    params: {
      shop_regions: ['US'],
      page_size: 1,
      max_pages_per_region: 5,
      download_concurrency: 2,
    },
    fetchImpl,
  })

  assert.equal(first.success, true)
  assert.equal(first.meta.action, 'next_phase')
  assert.equal(first.meta.next_phase, 'main')
  assert.equal(first.meta.shared.pendingRows.length, 1)
  assert.equal(first.meta.shared.pendingDownloads.length, 1)
  assert.equal(first.meta.shared.search_total_codes, 2)
  assert.equal(first.meta.shared.search_completed_codes, 1)
  assert.equal(first.meta.shared.current_exec_no, 1)
  assert.equal(first.meta.shared.total_rows, 2)
  assert.equal(first.meta.shared.page_no, 2)

  const second = await runScript('creator-video-download.js', {
    phase: 'main',
    href: 'https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis?shop_region=US&shop_id=7496042382582647544',
    params: {
      shop_regions: ['US'],
      page_size: 1,
      max_pages_per_region: 5,
      download_concurrency: 2,
    },
    shared: first.meta.shared,
    fetchImpl,
  })

  assert.equal(second.success, true)
  assert.equal(second.meta.action, 'download_urls')
  assert.deepEqual(calls, [1, 2])
  assert.equal(second.meta.items.length, 2)
  assert.equal(second.meta.shared.pendingRows.length, 2)
  assert.equal(second.meta.shared.pendingDownloads.length, 2)
  assert.equal(second.meta.shared.search_total_codes, 2)
  assert.equal(second.meta.shared.search_completed_codes, 2)
  assert.equal(second.meta.shared.current_exec_no, 2)
  assert.equal(second.meta.shared.total_rows, 2)
})

test('creator video task applies product id filter to request and result rows', async () => {
  const calls = []
  const targetProductId = '1730710259238277880'
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'))
    calls.push(body)
    assert.equal(body.params.video_list_params[0].filter.product_id, targetProductId)
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: {
        video_list_segments: [
          {
            total: 1,
            time_descriptor: body.params.video_list_params[0].time_descriptor,
            video_performances: [
              {
                video_info: {
                  item_id: '7619062455813131550',
                  title: '#ad sandals',
                  create_time: '1773951224000',
                  cover: { thumb_url_list: ['https://cover.example/1.jpg'] },
                  play_info: {
                    id: 'v15044gf0000d6u5gdvog65imto4jbgg',
                    play_urls: [
                      'https://v16m-default.tiktokcdn-us.com/video-a.mp4?mime_type=video_mp4',
                    ],
                    duration: 22600,
                    width: 1080,
                    height: 1920,
                  },
                },
                creator_base: {
                  oec_id: '7494014102087828932',
                  handle_name: 'heatherstansberryy',
                  nick_name: 'Heather Stansberry',
                  follower_cnt: '41211',
                },
                product_base: {
                  id: targetProductId,
                  title: 'Balabala sandals',
                },
                categories: [{ category_name: '儿童时尚' }],
                video_metrics: {
                  video_gmv: { amount_formatted: '$1,517.56', amount: '1517.56' },
                },
              },
            ],
          },
        ],
      },
    })
  }

  const result = await runScript('creator-video-download.js', {
    href: 'https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis?shop_region=US&shop_id=7496042382582647544',
    params: {
      shop_regions: ['US'],
      product_id: targetProductId,
      page_size: 20,
      max_pages_per_region: 1,
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'download_urls')
  assert.equal(calls.length, 1)
  assert.equal(result.meta.shared.pendingRows.length, 1)
  assert.equal(result.meta.shared.pendingRows[0].商品ID, targetProductId)
  assert.equal(result.meta.shared.pendingRows[0].视频ID, '7619062455813131550')
})

test('creator video task sends publish date filter and trusts API result rows', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'))
    calls.push(body)
    assert.deepEqual(body.params.video_list_params[0].filter.video_post_date, {
      start_time: 1777968000,
      end_time: 1778227200,
      timezone_offset: -28800,
    })
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: {
        video_list_segments: [
          {
            total: 2,
            time_descriptor: body.params.video_list_params[0].time_descriptor,
            video_performances: [
              {
                video_info: {
                  item_id: 'in-range-video',
                  title: '#ad in range',
                  create_time: '1778057820000',
                  cover: { thumb_url_list: ['https://cover.example/in-range.jpg'] },
                  play_info: {
                    id: 'play-in-range',
                    play_urls: ['https://v16m-default.tiktokcdn-us.com/in-range.mp4?mime_type=video_mp4'],
                    duration: 1000,
                    width: 1080,
                    height: 1920,
                  },
                },
                creator_base: {
                  oec_id: 'creator-in-range',
                  handle_name: 'creatorinrange',
                },
                product_base: {
                  id: 'product-in-range',
                  title: 'Product in range',
                },
                video_metrics: {
                  video_gmv: { amount_formatted: '$10.00', amount: '10' },
                },
              },
              {
                video_info: {
                  item_id: 'out-of-range-video',
                  title: '#ad out of range',
                  create_time: '1777885020000',
                  cover: { thumb_url_list: ['https://cover.example/out-of-range.jpg'] },
                  play_info: {
                    id: 'play-out-of-range',
                    play_urls: ['https://v16m-default.tiktokcdn-us.com/out-of-range.mp4?mime_type=video_mp4'],
                    duration: 1000,
                    width: 1080,
                    height: 1920,
                  },
                },
                creator_base: {
                  oec_id: 'creator-out-of-range',
                  handle_name: 'creatoroutofrange',
                },
                product_base: {
                  id: 'product-out-of-range',
                  title: 'Product out of range',
                },
                video_metrics: {
                  video_gmv: { amount_formatted: '$5.00', amount: '5' },
                },
              },
            ],
          },
        ],
      },
    })
  }

  const result = await runScript('creator-video-download.js', {
    href: 'https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis?shop_region=US&shop_id=7496042382582647544',
    params: {
      shop_regions: ['US'],
      publish_date_range: { start: '2026-05-05', end: '2026-05-07' },
      page_size: 20,
      max_pages_per_region: 1,
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'download_urls')
  assert.equal(calls.length, 1)
  assert.equal(result.meta.shared.pendingRows.length, 2)
  assert.equal(result.meta.shared.pendingRows[0].视频ID, 'in-range-video')
  assert.equal(result.meta.shared.pendingRows[1].视频ID, 'out-of-range-video')
  assert.equal(result.meta.items.length, 2)
  assert.equal(result.meta.items[0].filename, '0件_US_creatorinrange_in-range-video_product-in-range_2026-05-06_00-57-00.mp4')
})

test('creator video publish date range accepts local T-2 through the full day', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'))
    calls.push(body)
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: {
        video_list_segments: [
          {
            total: 0,
            time_descriptor: body.params.video_list_params[0].time_descriptor,
            video_performances: [],
          },
        ],
      },
    })
  }

  const result = await runScript('creator-video-download.js', {
    href: 'https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis?shop_region=US&shop_id=7496042382582647544',
    Date: fixedDateClass('2026-05-12T16:00:00.000Z'),
    params: {
      shop_regions: ['US'],
      publish_date_range: { start: '2026-05-10', end: '2026-05-11' },
      page_size: 20,
      max_pages_per_region: 1,
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].params.video_list_params[0].filter.video_post_date, {
    start_time: 1778400000,
    end_time: 1778572800,
    timezone_offset: -28800,
  })
})

test('creator video custom statistic date and publish date reject dates after local T-2', async () => {
  const common = {
    href: 'https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis?shop_region=US&shop_id=7496042382582647544',
    fetchImpl: async () => { throw new Error('should reject before fetch') },
    Date: fixedDateClass('2026-05-12T16:00:00.000Z'),
  }

  const statisticResult = await runScript('creator-video-download.js', {
    ...common,
    params: {
      shop_regions: ['US'],
      max_pages_per_region: 1,
      time_range: 'custom',
      date_range: { start: '2026-04-29', end: '2026-05-12' },
    },
  })
  const publishResult = await runScript('creator-video-download.js', {
    ...common,
    params: {
      shop_regions: ['US'],
      max_pages_per_region: 1,
      publish_date_range: { start: '2026-05-10', end: '2026-05-12' },
    },
  })

  assert.equal(statisticResult.success, false)
  assert.match(statisticResult.error, /最晚只能选择到 2026-05-11/)
  assert.equal(publishResult.success, false)
  assert.match(publishResult.error, /最晚只能选择到 2026-05-11/)
})

test('creator video default date range follows current page statistic date picker', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'))
    calls.push(body)
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: {
        video_list_segments: [
          {
            total: 0,
            time_descriptor: body.params.video_list_params[0].time_descriptor,
            video_performances: [],
          },
        ],
      },
    })
  }

  for (const nowIso of ['2026-05-06T21:00:00.000Z', '2026-05-07T10:00:00.000Z']) {
    const result = await runScript('creator-video-download.js', {
      href: 'https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis?shop_region=US&shop_id=7496042382582647544',
      fetchImpl,
      params: { shop_regions: ['US'], max_pages_per_region: 1 },
      Date: fixedDateClass(nowIso),
      document: new FakeDocument('', '', {
        '.m4b-date-picker-range': [
          {
            querySelectorAll(selector) {
              if (selector !== 'input') return []
              return [
                { value: '2026/4/24' },
                { value: '2026/4/30' },
              ]
            },
          },
        ],
      }),
    })
    assert.equal(result.success, true)
  }

  const descriptor = calls[0].params.video_list_params[0].time_descriptor
  assert.equal(descriptor.timezone_offset, -28800)
  assert.equal(descriptor.start_time, 1777017600)
  assert.equal(descriptor.end_time, 1777622400)
  assert.deepEqual(calls[1].params.video_list_params[0].time_descriptor, descriptor)
})

test('creator video quick time range supports last 28 days and previous week in GMT-8', async () => {
  const descriptors = []
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'))
    descriptors.push(body.params.video_list_params[0].time_descriptor)
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: {
        video_list_segments: [
          {
            total: 0,
            time_descriptor: body.params.video_list_params[0].time_descriptor,
            video_performances: [],
          },
        ],
      },
    })
  }

  const common = {
    href: 'https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis?shop_region=US&shop_id=7496042382582647544',
    fetchImpl,
    Date: fixedDateClass('2026-05-08T10:00:00.000Z'),
  }

  await runScript('creator-video-download.js', {
    ...common,
    params: { shop_regions: ['US'], max_pages_per_region: 1, time_range: 'last28' },
  })
  await runScript('creator-video-download.js', {
    ...common,
    params: { shop_regions: ['US'], max_pages_per_region: 1, time_range: 'last_week' },
  })

  assert.deepEqual(descriptors[0], {
    granularity_type: 1,
    timezone_offset: -28800,
    start_time: 1775721600,
    end_time: 1778140800,
  })
  assert.deepEqual(descriptors[1], {
    granularity_type: 1,
    timezone_offset: -28800,
    start_time: 1777276800,
    end_time: 1777881600,
  })
})

test('creator video reuses shared time descriptor during multi-page probe', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'))
    calls.push(body.params.video_list_params[0].time_descriptor)
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: {
        video_list_segments: [
          {
            total: 0,
            time_descriptor: body.params.video_list_params[0].time_descriptor,
            video_performances: [],
          },
        ],
      },
    })
  }

  const sharedDescriptor = {
    granularity_type: 1,
    timezone_offset: -28800,
    start_time: 123,
    end_time: 456,
  }

  const result = await runScript('creator-video-download.js', {
    href: 'https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis?shop_region=US&shop_id=7496042382582647544',
    fetchImpl,
    Date: fixedDateClass('2026-05-08T10:00:00.000Z'),
    params: { shop_regions: ['US'], max_pages_per_region: 1, time_range: 'last28' },
    shared: { time_descriptor: sharedDescriptor },
  })

  assert.equal(result.success, true)
  assert.deepEqual(calls[0], sharedDescriptor)
})

test('creator video custom time range rejects ranges outside the page latest selectable and 90-day limits', async () => {
  const result = await runScript('creator-video-download.js', {
    href: 'https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis?shop_region=US&shop_id=7496042382582647544',
    fetchImpl: async () => { throw new Error('should reject before fetch') },
    Date: fixedDateClass('2026-05-08T10:00:00.000Z'),
    params: {
      shop_regions: ['US'],
      max_pages_per_region: 1,
      time_range: 'custom',
      date_range: { start: '2026-04-29', end: '2026-05-07' },
    },
  })

  assert.equal(result.success, false)
  assert.match(result.error, /最晚只能选择到 2026-05-06/)
})

test('product management exports selected status tabs and splits packed product fields', async () => {
  const calls = []
  const makeProduct = (id, name, overrides = {}) => ({
    product_id: id,
    product_name: name,
    image: { url_list: [`https://img.example/${id}.jpg`] },
    product_status_view: {
      product_main_status: overrides.mainStatus ?? 1,
      product_display_status: overrides.displayStatus ?? 1,
    },
    audit_status: overrides.auditStatus ?? 2,
    total_sku_count: 2,
    skus: [
      {
        id: `${id}-SKU-1`,
        seller_sku: `${id}-RED`,
        global_sku_id: `${id}-G-1`,
        base_price: {
          sale_price: '$10.00',
          list_price: '$14.00',
          promotion_price: '$9.00',
        },
        quantities: [
          { type: 'available', quantity: 7, warehouse_name: 'US main' },
          { type: 'total', quantity: 9, warehouse_name: 'US main' },
        ],
        properties: [
          { name: 'Color', value_name: 'Red' },
          { name: 'Size', value_name: '6' },
        ],
      },
      {
        id: `${id}-SKU-2`,
        seller_sku: `${id}-BLUE`,
        global_sku_id: `${id}-G-2`,
        base_price: { sale_price: '$12.00', list_price: '$16.00' },
        quantities: [
          { type: 'available', quantity: 11, warehouse_name: 'US main' },
          { type: 'total', quantity: 13, warehouse_name: 'US main' },
        ],
        properties: [
          { name: 'Color', value_name: 'Blue' },
          { name: 'Size', value_name: '7' },
        ],
      },
    ],
    quantity: { total_available_stock: 18 },
    total_available_stock: 18,
    price_range: { min_price_format: '$10.00', max_price_format: '$12.00' },
    sale_price_ranges: [{ min_price_format: '$10.00', max_price_format: '$12.00' }],
    product_performance: {
      last_28days_pv: '1234',
      last_28days_order: '56',
      last_28days_gmv: '$789.00',
      last_7days_gmv_sequential_value: 0.148,
    },
    categories: [{ local_display_name: 'Shoes' }, { local_display_name: 'Sneakers' }],
    brand: { name: 'Balabala' },
    same_product_count: 3,
    same_product_info_list: [
      { product_id: `${id}-GB`, shop_region: 'GB', product_name: `${name} UK` },
    ],
    product_tier_info: { tier_name: 'Good', issue_count: 2 },
    product_low_stock: { is_low_stock: true },
    edit_time: '1778094950',
    action_list: [{ name: 'edit' }],
    actions: [{ name: 'delete' }],
    ...overrides,
  })
  const fixtures = {
    '2:1': { total: 2, products: [makeProduct('P-100', 'Kids Sneaker Red')] },
    '2:2': { total: 2, products: [makeProduct('P-101', 'Kids Sneaker Blue')] },
    '19:1': {
      total: 1,
      products: [makeProduct('P-900', 'Needs Attention Sneaker', {
        mainStatus: 3,
        displayStatus: 7,
        violation_records_id: 'V-1',
        suspend_reason: { title: 'Image issue' },
      })],
    },
  }
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(String(url))
    calls.push({
      url: parsed,
      credentials: init.credentials,
      headers: init.headers,
    })
    const key = `${parsed.searchParams.get('tab_id')}:${parsed.searchParams.get('page_number')}`
    const fixture = fixtures[key] || { total: 0, products: [] }
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: {
        total_product_count: fixture.total,
        products: fixture.products,
      },
    }, 200, String(url))
  }

  let result = await runScript('product-management.js', {
    href: 'https://seller.us.tiktokshopglobalselling.com/product/manage?shop_region=US&shop_id=7496042382582647544',
    params: {
      shop_regions: ['US'],
      product_statuses: ['active', 'violation'],
      search_content: 'sneaker',
      page_size: 1,
      sku_number: 50,
      max_pages_per_status: 5,
      page_delay_ms: 1,
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].状态Tab, '在售')
  assert.equal(result.data[0].状态TabID, 2)
  assert.equal(result.data[0].商品ID, 'P-100')
  assert.equal(result.data[0].商品标题, 'Kids Sneaker Red')
  assert.equal(result.data[0].商家SKU列表, 'P-100-RED\nP-100-BLUE')
  assert.equal(result.data[0].SKU规格, 'Color=Red; Size=6\nColor=Blue; Size=7')
  assert.equal(result.data[0].销售价, '$10.00\n$12.00')
  assert.equal(result.data[0].价格区间, '$10.00 - $12.00')
  assert.equal(result.data[0].库存总数, 18)
  assert.equal(result.data[0].近7天GMV环比, '14.80%')
  assert.equal(result.data[0].类目, 'Shoes / Sneakers')
  assert.equal(result.data[0].其他店铺数量, 3)
  assert.equal(result.data[0].其他店铺, 'GB:P-100-GB:Kids Sneaker Red UK')
  assert.equal(result.data[0].低库存, '是')
  assert.equal(Object.prototype.hasOwnProperty.call(result.data[0], '操作'), false)
  assert.equal(calls[0].url.pathname, '/api/v1/product/local/products/list')
  assert.equal(calls[0].url.searchParams.get('tab_id'), '2')
  assert.equal(calls[0].url.searchParams.get('page_number'), '1')
  assert.equal(calls[0].url.searchParams.get('page_size'), '1')
  assert.equal(calls[0].url.searchParams.get('sku_number'), '50')
  assert.equal(calls[0].url.searchParams.get('search_content'), 'sneaker')
  assert.equal(calls[0].credentials, 'include')
  assert.equal(calls[0].headers['X-Tt-Oec-Region'], 'US')

  result = await runScript('product-management.js', {
    href: 'https://seller.us.tiktokshopglobalselling.com/product/manage?shop_region=US&shop_id=7496042382582647544',
    params: {
      shop_regions: ['US'],
      product_statuses: ['active', 'violation'],
      search_content: 'sneaker',
      page_size: 1,
      sku_number: 50,
      max_pages_per_status: 5,
      page_delay_ms: 1,
    },
    shared: result.meta.shared,
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.data[0].商品ID, 'P-101')
  assert.equal(calls[1].url.searchParams.get('tab_id'), '2')
  assert.equal(calls[1].url.searchParams.get('page_number'), '2')

  result = await runScript('product-management.js', {
    href: 'https://seller.us.tiktokshopglobalselling.com/product/manage?shop_region=US&shop_id=7496042382582647544',
    params: {
      shop_regions: ['US'],
      product_statuses: ['active', 'violation'],
      search_content: 'sneaker',
      page_size: 1,
      sku_number: 50,
      max_pages_per_status: 5,
      page_delay_ms: 1,
    },
    shared: result.meta.shared,
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.has_more, false)
  assert.equal(result.data[0].状态Tab, '需要关注')
  assert.equal(result.data[0].主状态, '已暂停')
  assert.equal(result.data[0].展示状态, '已冻结')
  assert.equal(result.data[0].违规记录ID, 'V-1')
  assert.equal(result.data[0]['暂停/冻结原因'], 'Image issue')
  assert.equal(calls[2].url.searchParams.get('tab_id'), '19')
  assert.equal(calls[2].url.searchParams.get('page_number'), '1')
})

test('product management treats listing failed display status separately from sold-out', async () => {
  const fetchImpl = async (url) => createJsonResponse({
    code: 0,
    message: 'success',
    data: {
      total_product_count: 1,
      products: [
        {
          product_id: 'P-failed',
          product_name: 'Listing Failed Sneaker',
          product_status_view: {
            product_main_status: 3,
            product_display_status: 8,
          },
          total_available_stock: 12,
          skus: [],
        },
      ],
    },
  }, 200, String(url))

  const result = await runScript('product-management.js', {
    href: 'https://seller.us.tiktokshopglobalselling.com/product/manage?shop_region=US&shop_id=7496042382582647544',
    params: {
      shop_regions: ['US'],
      product_statuses: ['listing-failed'],
      page_size: 20,
      max_pages_per_status: 1,
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.data[0].状态Tab, '审核失败')
  assert.equal(result.data[0].展示状态, '审核失败')
  assert.equal(result.data[0].售罄, '否')
})

test('product management navigates to seller manage page before collecting when started elsewhere', async () => {
  const result = await runScript('product-management.js', {
    href: 'https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis?shop_region=US&shop_id=7496042382582647544',
    params: { shop_regions: ['GB'] },
    fetchImpl: async () => { throw new Error('should navigate before fetch') },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'main')
  assert.match(result.meta.shared.target_url, /^https:\/\/seller\.eu\.tiktokshopglobalselling\.com\/product\/manage/)
  assert.match(result.meta.shared.target_url, /shop_region=GB/)
  assert.match(result.meta.shared.target_url, /shop_id=7496042382582647544/)
})

test('product rating navigates to seller rating page before collecting when started elsewhere', async () => {
  const result = await runScript('product-rating.js', {
    href: 'https://affiliate.tiktokshopglobalselling.com/insights/transaction-analysis?shop_region=US&shop_id=7496042382582647544',
    params: { shop_regions: ['GB'] },
    fetchImpl: async () => { throw new Error('should navigate before fetch') },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'main')
  assert.match(result.meta.shared.target_url, /^https:\/\/seller\.eu\.tiktokshopglobalselling\.com\/product\/rating/)
  assert.match(result.meta.shared.target_url, /shop_region=GB/)
  assert.match(result.meta.shared.target_url, /shop_id=7496042382582647544/)
})

test('creator video task navigates to affiliate analysis page before collecting when started elsewhere', async () => {
  const result = await runScript('creator-video-download.js', {
    href: 'https://seller.us.tiktokshopglobalselling.com/product/rating?shop_region=US&shop_id=7496042382582647544',
    params: { shop_regions: ['FR'] },
    fetchImpl: async () => { throw new Error('should navigate before fetch') },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'main')
  assert.match(result.meta.shared.target_url, /^https:\/\/affiliate\.tiktokshopglobalselling\.com\/insights\/transaction-analysis/)
  assert.match(result.meta.shared.target_url, /shop_region=FR/)
  assert.match(result.meta.shared.target_url, /shop_id=7496042382582647544/)
})

test('product analytics inherits page date range and exports key metrics for dataworks sync', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'))
    calls.push({
      url: String(url),
      credentials: init.credentials,
      headers: init.headers,
      body,
    })
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: [
        {
          intervals: [
            {
              start_date: '2026-05-27',
              end_date: '2026-06-03',
              rows: [
                {
                  values: {
                    attributed_type: 'overview',
                    shop_id: '7496042382582647544',
                    pay_main_order_cnt: '295',
                    product_show_cnt: '751050',
                    product_click_cnt: '23884',
                  },
                },
              ],
            },
          ],
        },
      ],
    })
  }

  const result = await runScript('product-analytics.js', {
    href: 'https://seller.us.tiktokshopglobalselling.com/compass/product-traffic-analysis?shop_region=US&shop_id=7496042382582647544&timeRange=2026-05-27%7C2026-06-03&shortcut=last7days',
    Date: fixedDateClass('2026-05-12T00:00:00.000Z'),
    params: { time_range: 'page' },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.has_more, false)
  assert.equal(calls.length, 1)
  const requestUrl = new URL(calls[0].url)
  assert.equal(requestUrl.pathname, '/api/v2/insights/seller/unified/query/product_key_metric')
  assert.equal(requestUrl.searchParams.get('oec_seller_id'), '7496042382582647544')
  assert.equal(calls[0].credentials, 'include')
  assert.equal(calls[0].headers['Content-Type'], 'application/json')
  assert.deepEqual(calls[0].body.query_condition[0].query_time, {
    start: '2026-05-27',
    end: '2026-06-02',
  })
  assert.deepEqual(calls[0].body.query_condition[0].compare_to_time, {
    start: '2026-05-20',
    end: '2026-05-26',
  })
  assert.deepEqual(calls[0].body.query_condition[0].where_filter.attributed_types.value_list, ['overview'])

  assert.equal(result.data.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(result.data[0])), {
    平台名称: 'TikTok',
    区域: 'US',
    店铺ID: '7496042382582647544',
    店铺名称: 'balabalakids',
    统计日期范围: '2026-05-27 ~ 2026-06-02',
    对比日期范围: '2026-05-20 ~ 2026-05-26',
    抓取时间: '2026-05-12 08:00:00',
    订单数: '295',
    商品曝光次数: '751050',
    商品点击量: '23884',
  })
  assert.equal(result.meta.shared.date_range, '2026-05-27 ~ 2026-06-02')
})

test('product analytics advances across selected TikTok seller regions', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const region = init.headers['X-Tt-Oec-Region'] || init.headers['x-tt-oec-region']
    calls.push({ url: String(url), region })
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: [
        {
          intervals: [
            {
              start_date: '2026-05-27',
              end_date: '2026-06-03',
              rows: [
                {
                  values: {
                    pay_main_order_cnt: region === 'US' ? '295' : '42',
                    product_show_cnt: region === 'US' ? '751050' : '21000',
                    product_click_cnt: region === 'US' ? '23884' : '800',
                  },
                },
              ],
            },
          ],
        },
      ],
    })
  }

  const first = await runScript('product-analytics.js', {
    href: 'https://seller.us.tiktokshopglobalselling.com/compass/product-traffic-analysis?shop_region=US&shop_id=7496042382582647544&timeRange=2026-05-27%7C2026-06-03',
    params: { shop_regions: ['US', 'GB'], time_range: 'page' },
    fetchImpl,
  })

  assert.equal(first.success, true)
  assert.equal(first.meta.action, 'next_phase')
  assert.equal(first.meta.has_more, true)
  assert.equal(first.data[0].区域, 'US')
  assert.equal(first.data[0].订单数, '295')
  assert.equal(first.meta.shared.region_index, 1)

  const nav = await runScript('product-analytics.js', {
    href: 'https://seller.us.tiktokshopglobalselling.com/compass/product-traffic-analysis?shop_region=US&shop_id=7496042382582647544&timeRange=2026-05-27%7C2026-06-03',
    params: { shop_regions: ['US', 'GB'], time_range: 'page' },
    shared: first.meta.shared,
    fetchImpl,
  })

  assert.equal(nav.success, true)
  assert.equal(nav.meta.action, 'next_phase')
  assert.match(nav.meta.shared.target_url, /^https:\/\/seller\.eu\.tiktokshopglobalselling\.com\/compass\/product-traffic-analysis/)
  assert.match(nav.meta.shared.target_url, /shop_region=GB/)

  const second = await runScript('product-analytics.js', {
    href: nav.meta.shared.target_url,
    params: { shop_regions: ['US', 'GB'], time_range: 'page' },
    shared: nav.meta.shared,
    fetchImpl,
  })

  assert.equal(second.success, true)
  assert.equal(second.meta.action, 'complete')
  assert.equal(second.meta.has_more, false)
  assert.equal(second.data[0].区域, 'GB')
  assert.equal(second.data[0].订单数, '42')
  assert.deepEqual(calls.map(call => call.region), ['US', 'GB'])
})

test('product analytics last7 quick range matches seller page end-exclusive date', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'))
    calls.push(body)
    return createJsonResponse({
      code: 0,
      message: 'success',
      data: [
        {
          intervals: [
            {
              start_date: '2026-05-27',
              end_date: '2026-06-03',
              rows: [
                {
                  values: {
                    '7517': '{"value":"295"}',
                    '7459': '{"value":"751050"}',
                    '7582': '{"value":"23884"}',
                  },
                },
              ],
            },
          ],
        },
      ],
    })
  }

  const result = await runScript('product-analytics.js', {
    href: 'https://seller.us.tiktokshopglobalselling.com/compass/product-traffic-analysis?shop_region=US&shop_id=7496042382582647544',
    Date: fixedDateClass('2026-06-03T12:00:00.000Z'),
    params: { time_range: 'last7' },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.deepEqual(calls[0].query_condition[0].query_time, {
    start: '2026-05-27',
    end: '2026-06-02',
  })
  assert.equal(result.data[0].统计日期范围, '2026-05-27 ~ 2026-06-02')
})
