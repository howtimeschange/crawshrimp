import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

class FakeElement {
  constructor(options = {}) {
    this.tagName = String(options.tagName || 'DIV').toUpperCase()
    this.className = String(options.className || '')
    this._text = String(options.text || '')
    this._attrs = new Map(Object.entries(options.attributes || {}))
    this.dataset = options.dataset || {}
    this.href = options.href || ''
    this.src = options.src || ''
    this._rect = options.rect || { x: 0, y: 0, width: 120, height: 32 }
  }

  get innerText() { return this._text }
  get textContent() { return this._text }

  getAttribute(name) {
    if (name === 'href') return this.href || this._attrs.get(name) || null
    if (name === 'src') return this.src || this._attrs.get(name) || null
    return this._attrs.has(name) ? this._attrs.get(name) : null
  }

  getClientRects() {
    return this._rect.width && this._rect.height ? [this._rect] : []
  }

  getBoundingClientRect() {
    const { x, y, width, height } = this._rect
    return { left: x, top: y, width, height, right: x + width, bottom: y + height }
  }

  querySelectorAll() { return [] }
  querySelector() { return null }
  click() {}
}

class FakeDocument {
  constructor(bodyText = '') {
    this._selectors = new Map()
    this.readyState = 'complete'
    this.body = new FakeElement({
      tagName: 'body',
      text: bodyText,
      rect: { x: 0, y: 0, width: 1280, height: 4000 },
    })
    this.body.scrollHeight = 4000
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

async function runScript({ phase = 'main', page = 1, params = {}, shared = {}, document, locationHref, windowProps = {} }) {
  const scriptPath = path.resolve('adapters/shein-helper/store-search-products.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const location = {
    href: locationHref || 'https://us.shein.com/Store/example-sc-1.html',
    assign(next) { this.href = String(next || '') },
  }
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      __CRAWSHRIMP_PAGE__: page,
      scrollTo() {},
      innerHeight: 900,
      ...windowProps,
    },
    document: document || new FakeDocument('PRODUCT LIST'),
    location,
    console,
    setTimeout,
    clearTimeout,
    URL,
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
    decodeURIComponent,
  }
  context.globalThis = context
  return await vm.runInNewContext(source, context, { filename: scriptPath })
}

function detailRawData() {
  return {
    modules: {
      productInfo: {
        goods_id: '10001',
        goods_sn: 'sk-detail-real',
        goods_name: 'Detail Product Name',
        productRelationID: 'spu-real',
        cat_id: '2057',
        cate_name: 'Kids Shoes',
        stock: '12',
        is_on_sale: '1',
        goods_img: '//img.example/detail.jpg',
      },
      priceInfo: {
        salePrice: { amount: '19.99', amountWithSymbol: '$19.99', usdAmount: '19.99', usdAmountWithSymbol: '$19.99' },
        retailPrice: { amount: '29.99', amountWithSymbol: '$29.99', usdAmount: '29.99', usdAmountWithSymbol: '$29.99' },
        unitDiscount: '33',
      },
      saleAttr: {
        mainSaleAttribute: {
          info: [
            { goods_id: '10001', goods_sn: 'sk-detail-real', attr_name: 'Color', attr_value: 'Red' },
          ],
        },
        multiLevelSaleAttribute: {
          goods_id: '10001',
          goods_sn: 'sk-detail-real',
          sku_list: [
            {
              sku_code: 'sku-size-1',
              priceInfo: {
                salePrice: { amount: '19.99', amountWithSymbol: '$19.99', usdAmount: '19.99', usdAmountWithSymbol: '$19.99' },
              },
              sku_sale_attr: [{ attr_name: 'Size', attr_value_name: 'EUR28' }],
            },
          ],
        },
      },
      storeInfo: {
        store_code: '7859875567',
        title: 'Balabala Flagship Store',
      },
    },
  }
}

function detailHtml(rawData = detailRawData()) {
  const raw = JSON.stringify(rawData)
  return `<!doctype html><html><body><script>
    window.gbRawData = ${raw};
  </script></body></html>`
}

function detailApiBody(rawData = detailRawData()) {
  return JSON.stringify({
    code: '0',
    msg: 'ok',
    info: rawData.modules,
  })
}

test('store search collect_list_page builds a deduped detail queue from product cards', async () => {
  const href = 'https://us.shein.com/Example-Product-p-10001.html?mallCode=1&pageListType=4'
  const imageAnchor = new FakeElement({
    tagName: 'a',
    href,
    dataset: {
      id: '10001',
      spu: 'spu-list',
      sku: 'sk-list',
      title: 'List Product Name',
      price: '8.88',
      usOriginPrice: '18.88',
      store_code: '7859875567',
    },
  })
  const titleAnchor = new FakeElement({
    tagName: 'a',
    href,
    text: 'List Product Name',
    dataset: {
      id: '10001',
      spu: 'spu-list',
      sku: 'sk-list',
      title: 'List Product Name',
      price: '8.88',
    },
  })
  const document = new FakeDocument('PRODUCT LIST')
    .setSelector('a[href]', [imageAnchor, titleAnchor])
    .setSelector('button', [])

  const result = await runScript({
    phase: 'collect_list_page',
    document,
    params: { mode: 'current', max_products: 10, max_list_pages: 1, max_scroll_rounds: 0 },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'request_detail_capture')
  assert.equal(result.meta.shared.products.length, 1)
  assert.equal(result.meta.shared.products[0].product_id, '10001')
  assert.equal(result.meta.shared.products[0].list_skc, 'sk-list')
  assert.equal(result.meta.shared.products[0].list_price, '8.88')
})

test('store search collects all configured list pages before detail capture', async () => {
  const pageOneProduct = new FakeElement({
    tagName: 'a',
    href: 'https://us.shein.com/Page-One-p-10001.html?mallCode=1',
    dataset: { id: '10001', sku: 'sk-page-1', title: 'Page One' },
  })
  const pageTwoLink = new FakeElement({
    tagName: 'a',
    href: 'https://us.shein.com/Store/example-sc-1.html?page=2',
    text: '2',
  })
  const pageOneDocument = new FakeDocument('PRODUCT LIST')
    .setSelector('a[href]', [pageOneProduct, pageTwoLink])
    .setSelector('button', [])

  const first = await runScript({
    phase: 'collect_list_page',
    document: pageOneDocument,
    params: { max_list_pages: 2, max_scroll_rounds: 0 },
    locationHref: 'https://us.shein.com/Store/example-sc-1.html?page=1',
  })

  assert.equal(first.success, true)
  assert.equal(first.meta.action, 'next_phase')
  assert.equal(first.meta.next_phase, 'collect_list_page')
  assert.equal(first.meta.shared.products.length, 1)
  assert.equal(first.meta.shared.next_list_url, 'https://us.shein.com/Store/example-sc-1.html?page=2')

  const pageTwoProduct = new FakeElement({
    tagName: 'a',
    href: 'https://us.shein.com/Page-Two-p-10002.html?mallCode=1',
    dataset: { id: '10002', sku: 'sk-page-2', title: 'Page Two' },
  })
  const pageTwoDocument = new FakeDocument('PRODUCT LIST')
    .setSelector('a[href]', [pageTwoProduct])
    .setSelector('button', [])

  const second = await runScript({
    phase: 'collect_list_page',
    document: pageTwoDocument,
    params: { max_list_pages: 2, max_scroll_rounds: 0 },
    shared: first.meta.shared,
    locationHref: 'https://us.shein.com/Store/example-sc-1.html?page=2',
  })

  assert.equal(second.success, true)
  assert.equal(second.meta.action, 'next_phase')
  assert.equal(second.meta.next_phase, 'request_detail_capture')
  assert.equal(second.meta.shared.products.length, 2)
  assert.equal(JSON.stringify(second.meta.shared.products.map(item => item.product_id)), JSON.stringify(['10001', '10002']))
})

test('store search requests detail page capture for the next queued product', async () => {
  const product = {
    product_id: '10001',
    detail_url: 'https://us.shein.com/Example-Product-p-10001.html?mallCode=1',
    list_skc: 'sk-list',
  }

  const result = await runScript({
    phase: 'request_detail_capture',
    shared: { products: [product], detail_index: 0 },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'capture_url_requests')
  assert.equal(result.meta.url, product.detail_url)
  assert.equal(result.meta.shared_key, 'detail_capture')
  assert.equal(result.meta.next_phase, 'process_detail_capture')
  assert.equal(result.meta.matches[0].url_contains, '/bff-api/product/get_goods_detail_realtime_data')
  assert.equal(result.meta.matches[1].url_contains, '-p-10001.html')
})

test('store search exports price from detail gbRawData instead of list card price', async () => {
  const product = {
    product_id: '10001',
    detail_url: 'https://us.shein.com/Example-Product-p-10001.html?mallCode=1',
    list_title: 'List Product Name',
    list_spu: 'spu-list',
    list_skc: 'sk-list',
    list_price: '8.88',
    list_original_price: '18.88',
    store_code: '7859875567',
    source_url: 'https://us.shein.com/Store/example-sc-1.html',
  }

  const result = await runScript({
    phase: 'process_detail_capture',
    shared: {
      products: [product],
      detail_index: 0,
      detail_capture: {
        ok: true,
        matches: [{
          url: product.detail_url,
          responseUrl: product.detail_url,
          status: 200,
          mimeType: 'text/html',
          body: detailHtml(),
        }],
      },
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.has_more, false)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].SKC, 'sk-detail-real')
  assert.equal(result.data[0].SPU, 'spu-real')
  assert.equal(result.data[0].价格, '$19.99')
  assert.equal(result.data[0].价格数值, '19.99')
  assert.equal(result.data[0].列表页价格, '8.88')
  assert.equal(result.data[0].价格来源, '商详页')
  assert.equal(result.data[0].颜色, 'Red')
  assert.equal(result.data[0].尺码价格明细, 'EUR28: $19.99')
})

test('store search can export price from captured realtime detail API response', async () => {
  const product = {
    product_id: '10001',
    detail_url: 'https://us.shein.com/Example-Product-p-10001.html?mallCode=1',
    list_title: 'List Product Name',
    list_skc: 'sk-list',
    list_price: '8.88',
  }

  const result = await runScript({
    phase: 'process_detail_capture',
    shared: {
      products: [product],
      detail_index: 0,
      detail_capture: {
        ok: true,
        matches: [{
          url: 'https://us.shein.com/bff-api/product/get_goods_detail_realtime_data?_ver=1.1.8&_lang=en&goods_id=10001&mallCode=1',
          responseUrl: 'https://us.shein.com/bff-api/product/get_goods_detail_realtime_data?_ver=1.1.8&_lang=en&goods_id=10001&mallCode=1',
          status: 200,
          mimeType: 'application/json',
          body: detailApiBody(),
        }],
      },
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.data[0].SKC, 'sk-detail-real')
  assert.equal(result.data[0].价格, '$19.99')
  assert.equal(result.data[0].价格来源, '商详 API')
})

test('store search expands sibling SKCs from detail sale attributes into the detail queue', async () => {
  const product = {
    product_id: '10001',
    detail_url: 'https://us.shein.com/Example-Product-p-10001.html?mallCode=1',
    list_title: 'List Product Name',
    list_spu: 'spu-list',
    list_skc: 'sk-list',
    source_url: 'https://us.shein.com/Store/example-sc-1.html',
  }
  const raw = detailRawData()
  raw.modules.saleAttr.mainSaleAttribute.info = [
    { goods_id: '10001', goods_sn: 'sk-red', attr_name: 'Color', attr_value: 'Red' },
    { goods_id: '10002', goods_sn: 'sk-blue', attr_name: 'Color', attr_value: 'Blue' },
    { goods_id: '10003', goods_sn: 'sk-green', attr_name: 'Color', attr_value: 'Green' },
  ]

  const result = await runScript({
    phase: 'process_detail_capture',
    shared: {
      products: [product],
      detail_index: 0,
      detail_capture: {
        ok: true,
        matches: [{
          url: product.detail_url,
          responseUrl: product.detail_url,
          status: 200,
          mimeType: 'text/html',
          body: detailHtml(raw),
        }],
      },
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.has_more, true)
  assert.equal(result.meta.shared.detail_index, 1)
  assert.equal(result.meta.shared.products.length, 3)
  assert.equal(JSON.stringify(result.meta.shared.products.map(item => item.product_id)), JSON.stringify(['10001', '10002', '10003']))
  assert.equal(result.meta.shared.products[1].list_skc, 'sk-blue')
  assert.equal(result.meta.shared.products[1].detail_url, 'https://us.shein.com/Example-Product-p-10002.html?mallCode=1')
  assert.equal(result.meta.shared.skc_expanded_total, 2)
  assert.equal(result.data[0].SKC, 'sk-detail-real')
  assert.equal(result.data[0].价格, '$19.99')
})

test('store search pauses for manual verification when detail capture returns protection page', async () => {
  const product = {
    product_id: '10001',
    detail_url: 'https://us.shein.com/Example-Product-p-10001.html?mallCode=1',
    list_title: 'List Product Name',
  }

  const result = await runScript({
    phase: 'process_detail_capture',
    shared: {
      products: [product],
      detail_index: 0,
      detail_capture: {
        ok: true,
        matches: [{
          url: product.detail_url,
          responseUrl: product.detail_url,
          status: 200,
          mimeType: 'text/html',
          body: '<html><title>Security Check</title><body>Please verify you are human</body></html>',
        }],
      },
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'open_manual_verification')
  assert.equal(result.meta.shared.detail_index, 0)
  assert.equal(result.meta.shared.pause_reason, 'captcha')
})

test('store search wait_verification keeps waiting while captcha is visible', async () => {
  const result = await runScript({
    phase: 'wait_verification',
    document: new FakeDocument('Security Check Please verify you are human'),
    shared: { resume_phase: 'process_manual_detail', captcha_wait_rounds: 1 },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'wait_verification')
  assert.equal(result.meta.shared.captcha_wait_rounds, 2)
})

test('store search skips blocked detail after verification wait limit and uses list price fallback', async () => {
  const product = {
    product_id: '10001',
    detail_url: 'https://us.shein.com/Example-Product-p-10001.html?mallCode=1',
    list_title: 'List Product Name',
    list_skc: 'sk-list',
    list_price: '$8.88',
    list_original_price: '$18.88',
    source_url: 'https://us.shein.com/Store/example-sc-1.html',
  }

  const result = await runScript({
    phase: 'wait_verification',
    params: { max_verification_wait_rounds: 2 },
    document: new FakeDocument('Sign In'),
    locationHref: 'https://us.shein.com/user/auth/login?activity_sign=crawler&risk-id=abc&login_force=1',
    shared: {
      products: [product],
      detail_index: 0,
      resume_phase: 'process_manual_detail',
      captcha_wait_rounds: 1,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.has_more, false)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].SKC, 'sk-list')
  assert.equal(result.data[0].价格, '$8.88')
  assert.equal(result.data[0].价格来源, '列表页兜底')
  assert.match(result.data[0].商详抓取状态, /验证\/登录等待超时/)
})

test('store search resumes from current page gbRawData after manual verification', async () => {
  const product = {
    product_id: '10001',
    detail_url: 'https://us.shein.com/Example-Product-p-10001.html?mallCode=1',
    list_title: 'List Product Name',
    list_price: '8.88',
  }

  const result = await runScript({
    phase: 'wait_verification',
    document: new FakeDocument('Detail Product Name SKU: sk-detail-real'),
    shared: {
      products: [product],
      detail_index: 0,
      resume_phase: 'process_manual_detail',
      captcha_wait_rounds: 3,
    },
    windowProps: { gbRawData: detailRawData() },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'process_manual_detail')

  const exported = await runScript({
    phase: 'process_manual_detail',
    shared: {
      products: [product],
      detail_index: 0,
    },
    windowProps: { gbRawData: detailRawData() },
  })

  assert.equal(exported.success, true)
  assert.equal(exported.data.length, 1)
  assert.equal(exported.data[0].SKC, 'sk-detail-real')
  assert.equal(exported.data[0].价格, '$19.99')
  assert.equal(exported.data[0].价格来源, '商详页')
})
