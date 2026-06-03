const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

class FakeElement {
  constructor(text = '', attrs = {}) {
    this.innerText = text
    this.textContent = text
    Object.assign(this, attrs)
  }

  querySelectorAll(selector) {
    if (selector === 'tr,[role="row"]') return this.rows || []
    return []
  }
}

class FakeDocument {
  constructor({ bodyText = '', tableRows = [] } = {}) {
    this.body = new FakeElement(bodyText)
    this._table = new FakeElement(tableRows.map(row => row.innerText).join('\n'), {
      rows: tableRows,
      getAttribute(name) {
        return name === 'role' ? 'table' : ''
      },
    })
    this.title = 'Balabala · 报告 · 访问随时间变化 · Shopify'
  }

  querySelectorAll(selector) {
    if (selector === '[role="table"], table') return [this._table]
    if (selector === 'button,[role="button"],input,[aria-label]') {
      return [
        new FakeElement('过去 7 天', { getAttribute: name => name === 'aria-label' ? '日期范围控件：过去 7 天' : '' }),
        new FakeElement('2026年年5月19日日-26日日', { getAttribute: name => name === 'aria-label' ? '比较控件：2026年年5月19日日-26日日' : '' }),
      ]
    }
    return []
  }

  querySelector() {
    return null
  }
}

async function runScript({
  params = {},
  shared = {},
  href = 'https://admin.shopify.com/store/balabala-global/analytics/reports/sessions_over_time?ql=FROM+sessions%0ASHOW+online_store_visitors%2C%0A++sessions%0AWHERE+human_or_bot_session+IN+%28%27human%27%2C+%27bot%27%29%0ATIMESERIES+day%0AWITH+TOTALS%2C+PERCENT_CHANGE%0ASINCE+startOfDay%28-7d%29+UNTIL+today%0ACOMPARE+TO+previous_period%0AORDER+BY+day+ASC%0ALIMIT+1000%0AVISUALIZE+sessions+TYPE+line',
  Date: DateCtor = Date,
  document,
} = {}) {
  const scriptPath = path.resolve('adapters/shopify-ops-assistant/traffic-data.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const location = new URL(href)
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: 'main',
      __CRAWSHRIMP_SHARED__: shared,
      location,
    },
    document,
    location,
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
    URL,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
  }
  context.globalThis = context
  return vm.runInNewContext(source, context, { filename: scriptPath })
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

function shopifyReportDocument() {
  const rows = [
    new FakeElement('天 在线商店访客 访问'),
    new FakeElement('5月27日-2026年6月3日 2026年年5月19日日-26日日 变化百分比 72,471 76,437 3% 84,983 89,331 2%'),
    new FakeElement('2026年5月27日 2026年5月19日 9,584 14,192 10,365 14,920'),
    new FakeElement('2026年5月28日 2026年5月20日 10,395 14,560 11,229 15,294'),
  ]
  return new FakeDocument({
    bodyText: [
      'Balabala',
      '访问随时间变化',
      '过去 7 天',
      'USD $',
      '筛选条件 真人或机器人访问 是其中一个 真人 或 机器人',
      rows.map(row => row.innerText).join('\n'),
    ].join('\n'),
    tableRows: rows,
  })
}

test('traffic data inherits Shopify page filters and parses rendered report rows', async () => {
  const result = await runScript({
    document: shopifyReportDocument(),
    Date: fixedDateClass('2026-06-03T11:20:00Z'),
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.shared.shop_key, 'balabala-global')
  assert.equal(result.meta.shared.date_range, '2026-05-27 ~ 2026-06-03')
  assert.equal(result.meta.shared.compare_date_range, '2026-05-19 ~ 2026-05-26')
  assert.equal(result.data.length, 3)
  assert.equal(result.data[0].数据类型, '汇总')
  assert.equal(result.data[0].在线商店访客, '72,471')
  assert.equal(result.data[0].访问, '84,983')
  assert.equal(result.data[0].访问变化, '2%')
  assert.equal(result.data[1].数据类型, '明细')
  assert.equal(result.data[1].统计日期, '2026-05-27')
  assert.equal(result.data[1].对比日期, '2026-05-19')
  assert.equal(result.data[1].在线商店访客, '9,584')
  assert.equal(result.data[1].对比在线商店访客, '14,192')
  assert.equal(result.data[1].访问, '10,365')
  assert.equal(result.data[1].对比访问, '14,920')
  assert.match(result.data[1].ShopifyQL, /FROM sessions/)
  assert.equal(result.data[1].货币, 'USD')
})

test('traffic data redirects to Shopify report when custom date range is selected', async () => {
  const result = await runScript({
    href: 'https://admin.shopify.com/store/balabala-global',
    params: {
      time_range: 'custom',
      date_range: { start: '2026-04-01', end: '2026-04-30' },
    },
    document: shopifyReportDocument(),
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.match(result.meta.shared.target_url, /^https:\/\/admin\.shopify\.com\/store\/balabala-global\/analytics\/reports\/sessions_over_time/)
  assert.match(
    decodeURIComponent(result.meta.shared.target_url).replace(/\+/g, ' '),
    /SINCE 2026-04-01\s+UNTIL 2026-04-30/,
  )
})
