const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

class FakeElement {
  constructor({ tagName = 'DIV', text = '', className = '', rect = { x: 0, y: 0, width: 100, height: 32 } } = {}) {
    this.tagName = tagName
    this.innerText = text
    this.textContent = text
    this.className = className
    this.children = []
    this.style = {}
    this.href = ''
    this.download = ''
    this._rect = rect
  }

  appendChild(child) {
    this.children.push(child)
    return child
  }

  querySelectorAll() {
    return []
  }

  querySelector() {
    return null
  }

  getBoundingClientRect() {
    const { x, y, width, height } = this._rect
    return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }
  }

  getClientRects() {
    return this._rect.width && this._rect.height ? [this.getBoundingClientRect()] : []
  }

  scrollIntoView() {}
  click() {}
}

class FakeDocument {
  constructor(bodyText = '首页 商业分析 当前店铺 所有店铺 统计时间 今日实时 今天至17:00 (GMT+08) 订单类型 已确定订单 导出数据') {
    this.body = new FakeElement({ tagName: 'BODY', text: bodyText, rect: { x: 0, y: 0, width: 1512, height: 982 } })
    this._bySelector = {
      '.shop-select': [new FakeElement({ text: '所有店铺', className: 'shop-select' })],
      '.bi-date-input': [new FakeElement({ text: '统计时间 今日实时 今天至17:00 (GMT+08)', className: 'bi-date-input' })],
      '.order-type-select': [new FakeElement({ text: '订单类型 已确定订单', className: 'order-type-select' })],
    }
  }

  createElement(tagName) {
    return new FakeElement({ tagName, rect: { x: 16, y: 16, width: 120, height: 32 } })
  }

  querySelectorAll(selector) {
    return this._bySelector[selector] || []
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
}

class FakeStorage {
  constructor(initial = {}) {
    this._map = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]))
  }

  getItem(key) {
    return this._map.get(String(key)) || null
  }

  setItem(key, value) {
    this._map.set(String(key), String(value))
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

async function runScript({
  phase = 'main',
  params = {},
  shared = {},
  href = 'https://seller.shopee.cn/datacenter/home?ADTAG=sidebar&cnsc_shop_id=804286917',
  fetchImpl,
  Date: DateCtor = Date,
} = {}) {
  const scriptPath = path.resolve('adapters/shopee-plus-v2/business-analysis.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const document = new FakeDocument()
  const location = new URL(href)
  const sessionStorage = new FakeStorage({
    'datacenter.cnscHomeDateRange': JSON.stringify({
      startTime: '2026-06-02T16:00:00.000Z',
      endTime: '2026-06-03T09:00:00.000Z',
      shortcut: 1,
      dateLabel: '今日实时',
    }),
  })
  const localStorage = new FakeStorage({
    'datacenter.orderType': 'confirmed',
  })
  const objectUrls = []
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      location,
      document,
      localStorage,
      sessionStorage,
    },
    document,
    location,
    localStorage,
    sessionStorage,
    fetch: fetchImpl || (async () => { throw new Error('fetch not mocked') }),
    Blob,
    URL: class URLWithBlob extends URL {
      static createObjectURL(blob) {
        objectUrls.push(blob)
        return `blob:mock-${objectUrls.length}`
      }
      static revokeObjectURL() {}
    },
    console,
    setTimeout,
    clearTimeout,
    Date: DateCtor,
    Math,
    JSON,
    String,
    Number,
    Boolean,
    RegExp,
    Array,
    Object,
    Map,
    Set,
    encodeURIComponent,
    decodeURIComponent,
    btoa: value => Buffer.from(String(value), 'binary').toString('base64'),
    atob: value => Buffer.from(String(value), 'base64').toString('binary'),
  }
  context.globalThis = context
  const result = await vm.runInNewContext(source, context, { filename: scriptPath })
  return { result, document, objectUrls }
}

function binaryResponse(bytes, filename = 'allshops-1704994-shopee-stats.20260603-20260603.xlsx') {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        const key = String(name || '').toLowerCase()
        if (key === 'content-type') return 'application/vnd.ms-excel'
        if (key === 'content-disposition') return `attachment; filename=${filename}`
        return ''
      },
    },
    async arrayBuffer() {
      return Uint8Array.from(bytes).buffer
    },
  }
}

test('business analysis inherits Shopee page date filter and prepares runtime artifact download', async () => {
  const calls = []
  const { result, document, objectUrls } = await runScript({
    Date: fixedDateClass('2026-06-03T09:40:00.000Z'),
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init })
      return binaryResponse([0x50, 0x4b, 0x03, 0x04])
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'download_urls')
  assert.equal(result.meta.next_phase, 'after_download')
  assert.equal(calls.length, 1)
  assert.equal(
    calls[0].url,
    '/api/mydata/cnsc/merchant/v2/dashboard/export/?period=real_time&start_time=1780416000&end_time=1780477200',
  )
  assert.equal(calls[0].init.credentials, 'include')
  assert.equal(objectUrls.length, 0)
  assert.equal(document.body.children.length, 0)
  assert.equal(result.meta.items[0].filename, 'Shopee商业分析_所有店铺_2026-06-03~2026-06-03.xlsx')
  assert.match(result.meta.items[0].url, /^data:application%2Fvnd\.ms-excel;base64,UEsDBA==$/)
  assert.equal(result.meta.items[0].source_url, calls[0].url)
  assert.equal(result.meta.shared.date_range, '2026-06-03 ~ 2026-06-03')
  assert.equal(result.meta.shared.time_range_label, '今日实时')
  assert.equal(result.meta.shared.order_type, 'confirmed')
})

test('business analysis custom date range uses day period and stable output filename', async () => {
  const calls = []
  const { result } = await runScript({
    params: {
      time_range: 'custom',
      date_range: { start: '2026-05-01', end: '2026-05-31' },
    },
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init })
      return binaryResponse([0x50, 0x4b, 0x03, 0x04], 'custom.xlsx')
    },
  })

  assert.equal(result.success, true)
  assert.equal(calls[0].url, '/api/mydata/cnsc/merchant/v2/dashboard/export/?period=day&start_time=1777564800&end_time=1780243200')
  assert.equal(result.meta.items[0].filename, 'Shopee商业分析_所有店铺_2026-05-01~2026-05-31.xlsx')
  assert.equal(result.meta.shared.date_range, '2026-05-01 ~ 2026-05-31')
})

test('business analysis accepts TaskRunner inline custom_start and custom_end params', async () => {
  const calls = []
  const { result } = await runScript({
    params: {
      time_range: 'custom',
      custom_start: '2026-05-03',
      custom_end: '2026-05-09',
    },
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init })
      return binaryResponse([0x50, 0x4b, 0x03, 0x04], 'custom-inline.xlsx')
    },
  })

  assert.equal(result.success, true)
  assert.equal(calls[0].url, '/api/mydata/cnsc/merchant/v2/dashboard/export/?period=day&start_time=1777737600&end_time=1778342400')
  assert.equal(result.meta.shared.date_range, '2026-05-03 ~ 2026-05-09')
})

test('business analysis rejects non-spreadsheet export responses before creating artifact download', async () => {
  const { result, document } = await runScript({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return String(name || '').toLowerCase() === 'content-type' ? 'text/html' : ''
        },
      },
      async arrayBuffer() {
        return new TextEncoder().encode('<html>login</html>').buffer
      },
    }),
  })

  assert.equal(result.success, false)
  assert.match(result.error, /不是有效 Excel 文件/)
  assert.equal(document.body.children.length, 0)
})
