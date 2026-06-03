const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

class FakeElement {
  constructor(text = '') {
    this.innerText = text
    this.textContent = text
    this.value = ''
  }

  querySelectorAll() {
    return []
  }
}

class FakeDocument {
  constructor(bodyText = 'Business Advisor Dashboard Yesterday Last 7 days Last 30 days Export') {
    this.body = new FakeElement(bodyText)
  }

  querySelectorAll() {
    return []
  }
}

class FakeStorage {
  constructor(initial = {}) {
    this._map = new Map(Object.entries(initial).map(([key, value]) => [String(key), String(value)]))
  }

  getItem(key) {
    return this._map.has(String(key)) ? this._map.get(String(key)) : null
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
  href = 'https://sellercenter.lazada.com.ph/ba/dashboard?dateRange=2026-06-02%7C2026-06-02&dateType=recent1',
  Date: DateCtor = Date,
  windowProps = {},
  bodyText,
  fetchImpl,
} = {}) {
  const scriptPath = path.resolve('adapters/lazada-plus-v1/business-advisor.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const location = new URL(href)
  const document = new FakeDocument(bodyText)
  const sessionStorage = new FakeStorage()
  const localStorage = new FakeStorage()
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      __venture__: 'PH',
      sellerId: '500165481070',
      location,
      document,
      localStorage,
      sessionStorage,
      ...windowProps,
    },
    document,
    location,
    localStorage,
    sessionStorage,
    console,
    setTimeout,
    clearTimeout,
    fetch: fetchImpl,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    TextDecoder,
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
    URL,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
  }
  context.globalThis = context
  return vm.runInNewContext(source, context, { filename: scriptPath })
}

function excelResponse(bytes, headers = {}) {
  const headerMap = new Map(Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)]))
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return headerMap.get(String(name || '').toLowerCase()) || ''
      },
    },
    async arrayBuffer() {
      return Uint8Array.from(bytes).buffer
    },
  }
}

test('business advisor inherits Lazada page date filter and prepares official Excel download', async () => {
  const result = await runScript()

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'download_urls')
  assert.equal(result.meta.next_phase, 'after_download')
  assert.equal(result.meta.items.length, 1)
  assert.equal(result.meta.items[0].label, 'Lazada 生意参谋 / PH')
  assert.equal(
    result.meta.items[0].url,
    'https://sellercenter.lazada.com.ph/ba/sycm/lazada/dashboard/key/overview/sycmExportV2.json?dateRange=2026-06-02%7C2026-06-02&dateType=recent1&venture=PH&sellerId=500165481070',
  )
  assert.equal(result.meta.items[0].filename, 'Lazada生意参谋_PH_2026-06-02~2026-06-02.xls')
  assert.equal(result.meta.items[0].browser_session, true)
  assert.equal(result.meta.shared.date_range, '2026-06-02 ~ 2026-06-02')
  assert.equal(result.meta.shared.date_type, 'recent1')
  assert.equal(result.meta.shared.time_range_label, '昨天')
  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.countries)), ['PH'])
})

test('business advisor fetches official Excel in page session before handing artifact to runner', async () => {
  const requests = []
  const result = await runScript({
    fetchImpl: async url => {
      requests.push(String(url))
      return excelResponse(
        [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
        {
          'content-type': 'application/msexcel',
          'content-disposition': 'attachment; filename="Business Advisor - Dashboard - Key Metrics.xls"',
        },
      )
    },
  })

  assert.equal(result.success, true)
  assert.equal(requests.length, 1)
  assert.match(requests[0], /sycmExportV2\.json/)
  assert.equal(result.meta.items[0].filename, 'Lazada生意参谋_PH_2026-06-02~2026-06-02.xls')
  assert.match(result.meta.items[0].url, /^data:application%2Fmsexcel;base64,/)
  assert.equal(result.meta.items[0].source_url, 'https://sellercenter.lazada.com.ph/ba/sycm/lazada/dashboard/key/overview/sycmExportV2.json?dateRange=2026-06-02%7C2026-06-02&dateType=recent1&venture=PH&sellerId=500165481070')
  assert.equal(result.meta.items[0].browser_session, undefined)
})

test('business advisor advances across selected Lazada country hosts', async () => {
  const first = await runScript({
    params: { countries: ['PH', 'SG'], time_range: 'page' },
  })

  assert.equal(first.success, true)
  assert.equal(first.meta.action, 'download_urls')
  assert.equal(first.meta.next_phase, 'after_download')
  assert.equal(first.meta.shared.country_index, 0)

  const afterFirstDownload = await runScript({
    phase: 'after_download',
    params: { countries: ['PH', 'SG'], time_range: 'page' },
    shared: {
      ...first.meta.shared,
      download_result: { items: [{ success: true, path: '/tmp/Lazada生意参谋_PH_2026-06-02~2026-06-02.xls' }] },
    },
  })

  assert.equal(afterFirstDownload.success, true)
  assert.equal(afterFirstDownload.meta.action, 'next_phase')
  assert.equal(afterFirstDownload.meta.next_phase, 'main')
  assert.equal(afterFirstDownload.meta.shared.country_index, 1)

  const nav = await runScript({
    href: 'https://sellercenter.lazada.com.ph/ba/dashboard?dateRange=2026-06-02%7C2026-06-02&dateType=recent1',
    params: { countries: ['PH', 'SG'], time_range: 'page' },
    shared: afterFirstDownload.meta.shared,
  })

  assert.equal(nav.success, true)
  assert.equal(nav.meta.action, 'next_phase')
  assert.match(nav.meta.shared.target_url, /^https:\/\/sellercenter\.lazada\.sg\/ba\/dashboard/)
  assert.match(nav.meta.shared.target_url, /dateRange=2026-06-02%7C2026-06-02/)
  assert.match(nav.meta.shared.target_url, /dateType=recent1/)

  const second = await runScript({
    href: nav.meta.shared.target_url,
    params: { countries: ['PH', 'SG'], time_range: 'page' },
    shared: nav.meta.shared,
    windowProps: {
      __venture__: 'SG',
      sellerId: '600000000001',
    },
  })

  assert.equal(second.success, true)
  assert.equal(second.meta.action, 'download_urls')
  assert.equal(second.meta.items[0].label, 'Lazada 生意参谋 / SG')
  assert.match(second.meta.items[0].url, /^https:\/\/sellercenter\.lazada\.sg\/ba\/sycm\/lazada\/dashboard\/key\/overview\/sycmExportV2\.json/)
  assert.match(second.meta.items[0].url, /venture=SG/)
  assert.match(second.meta.items[0].url, /sellerId=600000000001/)
})

test('business advisor custom date range maps to Lazada custom dashboard query', async () => {
  const result = await runScript({
    href: 'https://sellercenter.lazada.com.ph/ba/dashboard',
    params: {
      time_range: 'custom',
      date_range: { start: '2026-05-01', end: '2026-05-31' },
      countries: ['PH'],
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.items[0].filename, 'Lazada生意参谋_PH_2026-05-01~2026-05-31.xls')
  const url = new URL(result.meta.items[0].url)
  assert.equal(url.searchParams.get('dateRange'), '2026-05-01|2026-05-31')
  assert.equal(url.searchParams.get('dateType'), 'day')
  assert.equal(result.meta.shared.time_range_label, '自定义日期')
})

test('business advisor quick recent30 range uses yesterday as end date', async () => {
  const result = await runScript({
    Date: fixedDateClass('2026-06-03T09:00:00.000Z'),
    href: 'https://sellercenter.lazada.com.ph/ba/dashboard',
    params: { time_range: 'recent30', countries: ['PH'] },
  })

  assert.equal(result.success, true)
  const url = new URL(result.meta.items[0].url)
  assert.equal(url.searchParams.get('dateRange'), '2026-05-04|2026-06-02')
  assert.equal(url.searchParams.get('dateType'), 'recent30')
  assert.equal(result.meta.shared.date_range, '2026-05-04 ~ 2026-06-02')
})
