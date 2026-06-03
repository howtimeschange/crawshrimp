import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

class FakeElement {
  constructor({
    tagName = 'DIV',
    value = '',
    placeholder = '',
    id = '',
    text = '',
    className = '',
    attrs = {},
  } = {}) {
    this.tagName = tagName
    this.value = value
    this.placeholder = placeholder
    this.id = id
    this.innerText = text
    this.textContent = text
    this.className = className
    this.attrs = attrs
  }

  getAttribute(name) {
    if (name === 'placeholder') return this.placeholder
    if (name === 'id') return this.id
    if (name === 'class') return this.className
    return this.attrs[name] || ''
  }

  querySelectorAll() {
    return []
  }
}

class FakeDocument {
  constructor({ bodyText = '', inputs = [], selectors = {} } = {}) {
    this.readyState = 'complete'
    this.body = new FakeElement({ tagName: 'BODY', text: bodyText })
    this._inputs = inputs
    this._selectors = selectors
  }

  querySelectorAll(selector) {
    if (selector === 'input') return this._inputs
    if (this._selectors[selector]) return this._selectors[selector]
    if (/input/.test(selector)) return this._inputs
    return []
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
}

function input(value, placeholder = '', id = '') {
  return new FakeElement({
    tagName: 'INPUT',
    value,
    placeholder,
    id,
  })
}

async function runAdapter(scriptName, {
  phase = 'main',
  params = {},
  shared = {},
  href = 'https://csp.aliexpress.com/m_apps/csp-sycm-new/productRank?channelId=125417',
  bodyText = '',
  inputs = [],
  mtopImpl = null,
  Date: DateCtor = Date,
} = {}) {
  const scriptPath = path.resolve('adapters/aliexpress-ops-assistant', scriptName)
  const source = fs.readFileSync(scriptPath, 'utf8')
  const location = {
    href,
    get search() {
      try { return new URL(this.href).search } catch { return '' }
    },
    get pathname() {
      try { return new URL(this.href).pathname } catch { return '' }
    },
    get hostname() {
      try { return new URL(this.href).hostname } catch { return '' }
    },
    assign(next) { this.href = String(next || '') },
  }
  const document = new FakeDocument({ bodyText, inputs })
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      location,
      lib: mtopImpl ? { mtop: { request: mtopImpl } } : {},
      scrollTo() {},
    },
    document,
    location,
    URL,
    URLSearchParams,
    console,
    setTimeout: (callback, ms, ...args) => {
      Promise.resolve().then(() => callback(...args))
      return { ms }
    },
    clearTimeout() {},
    Date: DateCtor,
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
    Promise,
    Error,
    encodeURIComponent,
    decodeURIComponent,
  }
  context.globalThis = context
  return await vm.runInNewContext(source, context, { filename: scriptPath })
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
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

test('deal analysis inherits page filters and exports overview/trend rows for dataworks sync', async () => {
  const calls = []
  const result = await runAdapter('deal-analysis.js', {
    href: 'https://csp.aliexpress.com/m_apps/sycm/MakeBargainAnalysis?channelId=125417',
    Date: fixedDateClass('2026-06-03T10:20:30.000Z'),
    params: { time_range: 'page' },
    inputs: [
      input('2026-06-01', '请选择日期'),
      input('', '', 'indicators'),
      input('2026-06-01', '请选择日期'),
      input('2026-06-01', '请选择日期'),
    ],
    bodyText: 'Semir Official Store\n成交分析\n核心指标\n全部\n半托管\n非半托管\n最近一天\n全部国家',
    mtopImpl(request, success) {
      calls.push(request)
      if (request.data.serviceKey === 'tradeOverviewCard') {
        success({
          ret: ['SUCCESS::调用成功'],
          data: {
            dataSource: [
              { key: 'payAmt', label: '支付金额', value: 18811.33, cycleLabel: '较前1日', cycleData: 7.5362, lineLabel: '周同比', lineData: 4.2461 },
              { key: 'divPayableTaxAmt', label: '税费', value: 109.91, cycleLabel: '较前1日', cycleData: 6.7076, lineLabel: '周同比', lineData: 2.385 },
              { key: 'payBuyerCnt', label: '支付买家数', value: 574, cycleLabel: '较前1日', cycleData: 7.3188, lineLabel: '周同比', lineData: 4.125 },
              { key: 'vstPayRate', label: '支付转化率', value: 0.0418, cycleLabel: '较前1日', cycleData: 7.0385, lineLabel: '周同比', lineData: 1.6125 },
              { key: 'avgPayAmt', label: '客单价', value: 32.77, cycleLabel: '较前1日', cycleData: 0.026, lineLabel: '周同比', lineData: 0.0234 },
              { key: 'payOldBuyerCntRate', label: '支付老买家占比', value: 0.5871, cycleLabel: '较前1日', cycleData: 0.3067, lineLabel: '周同比', lineData: 0.1336 },
              { key: 'payOrderCnt', label: '支付订单数', value: 647, cycleLabel: '较前1日', cycleData: 7.4026, lineLabel: '周同比', lineData: 4.1349 },
              { key: 'payItemQty', label: '支付件数', value: 1096, cycleLabel: '较前1日', cycleData: 10.7849, lineLabel: '周同比', lineData: 5.3721 },
            ],
            success: true,
          },
        })
        return
      }
      if (request.data.serviceKey === 'tradeTrend') {
        success({
          ret: ['SUCCESS::调用成功'],
          data: {
            dataSource: [
              { statDate: '2026-05-31', key: 'payAmt', label: '支付金额', value: 8060.58 },
              { statDate: '2026-06-01', key: 'payAmt', label: '支付金额', value: 18811.33 },
              { statDate: '2026-06-01', key: 'payAmtAvg', label: '同行同层平均', value: 974.31 },
            ],
          },
        })
        return
      }
      throw new Error(`unexpected serviceKey ${request.data.serviceKey}`)
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].api, 'mtop.aliexpress.dps.query')
  assert.equal(calls[0].type, 'POST')
  assert.equal(calls[0].valueType, 'original')
  assert.equal(calls[0].data.channelId, '125417')
  assert.equal(calls[0].data.serviceKey, 'tradeOverviewCard')
  assert.equal(calls[0].data.statDate, '2026-06-01')
  assert.equal(calls[0].data.dateType, 'recent1')
  assert.equal(calls[0].data.bizType, 'ALL')
  assert.equal(calls[0].data.params, JSON.stringify({ countryId: 'AllCountries' }))
  assert.equal(calls[1].data.serviceKey, 'tradeTrend')

  assert.equal(result.data.length, 11)
  assert.deepEqual(plain(result.data[0]), {
    平台名称: 'AliExpress',
    店铺名称: 'Semir Official Store',
    channelId: '125417',
    数据类型: '核心指标',
    统计日期: '2026-06-01',
    统计日期范围: '2026-06-01 ~ 2026-06-01',
    时间筛选: '最近一天',
    国家: '全部国家',
    国家编码: 'AllCountries',
    业务模式: '全部',
    业务模式编码: 'ALL',
    指标分组: '支付',
    指标编码: 'payAmt',
    指标名称: '支付金额',
    指标值: 18811.33,
    环比标签: '较前1日',
    环比值: 7.5362,
    同比标签: '周同比',
    同比值: 4.2461,
    抓取时间: '2026-06-03 18:20:30',
  })
  assert.deepEqual(plain(result.data[8]), {
    平台名称: 'AliExpress',
    店铺名称: 'Semir Official Store',
    channelId: '125417',
    数据类型: '趋势明细',
    统计日期: '2026-05-31',
    统计日期范围: '2026-06-01 ~ 2026-06-01',
    时间筛选: '最近一天',
    国家: '全部国家',
    国家编码: 'AllCountries',
    业务模式: '全部',
    业务模式编码: 'ALL',
    指标分组: '支付',
    指标编码: 'payAmt',
    指标名称: '支付金额',
    指标值: 8060.58,
    环比标签: '',
    环比值: '',
    同比标签: '',
    同比值: '',
    抓取时间: '2026-06-03 18:20:30',
  })
  assert.equal(result.meta.shared.total_rows, 11)
})

test('product ranking paginates until all rows under inherited filters are exported', async () => {
  const calls = []
  const rows = Array.from({ length: 3 }, (_, index) => ({
    statDate: '2026-06-01 00:00:00',
    itemId: 1005000000000000 + index,
    rank: index + 1,
    title: `Semir item ${index + 1}`,
    imageUrl: `https://img.example/${index + 1}.jpg`,
    detailPageUrl: `https://www.aliexpress.com/item/${1005000000000000 + index}.html`,
    minPrice: 'USD 10.00',
    maxPrice: 'USD 20.00',
    cateLeafName: 'T恤',
    cateLeafPathName: '男装->上衣，T恤',
    payAmt: 100 - index,
    divPayableTaxAmt: index,
    uv: 50 + index,
    newVisitorCnt: 20 + index,
    payBuyerCnt: 5 + index,
    payPerBuyerAmt: 12.34,
    chainRatioText: '较前1日',
    payAmtChainRatio: 0.12,
    uvChainRatio: -0.05,
  }))
  const makeMtop = (request, success) => {
    calls.push(request)
    assert.equal(request.api, 'mtop.aliexpress.seller.business.advice.table.query')
    const current = Number(request.data.current || 1)
    const pageSize = Number(request.data.pageSize || 2)
    success({
      ret: ['SUCCESS::调用成功'],
      data: {
        dataSource: rows.slice((current - 1) * pageSize, current * pageSize),
        recordCount: rows.length,
        pageInfo: { current, pageSize, total: rows.length },
      },
    })
  }

  const first = await runAdapter('product-ranking.js', {
    href: 'https://csp.aliexpress.com/m_apps/csp-sycm-new/productRank?channelId=125417',
    params: { time_range: 'page', page_size: 2 },
    inputs: [
      input('', '', 'country'),
      input('', '', 'platform'),
      input('', '', 'category'),
      input('2026-06-01', '开始日期'),
      input('2026-06-01', '结束日期'),
      input('', '', 'bizType'),
      input('', '', 'firstOnline30d'),
      input('', '请输入商品ID', 'itemId'),
    ],
    bodyText: 'Semir Official Store\n商品分析\n支付榜\n国家\n全部国家\n平台\n所有平台\n类目\n所有类目\n业务模式\n全部业务模式\n商品筛选\n全部商品',
    mtopImpl: makeMtop,
  })

  assert.equal(first.success, true)
  assert.equal(first.meta.action, 'next_phase')
  assert.equal(first.meta.has_more, true)
  assert.equal(first.data.length, 2)
  assert.equal(calls[0].data.current, 1)
  assert.equal(calls[0].data.pageSize, 2)
  assert.equal(calls[0].data.rankType, 'pay_amt')
  assert.equal(calls[0].data.country, 'AllCountries')
  assert.equal(calls[0].data.platform, 'ALL')
  assert.equal(calls[0].data.bizType, 'ALL')
  assert.equal(calls[0].data.firstOnline30d, false)
  assert.equal(calls[0].data.statDate, new Date(2026, 5, 1).getTime())
  assert.equal(first.data[0].商品ID, '1005000000000000')
  assert.equal(first.data[0].商品名称, 'Semir item 1')
  assert.equal(first.data[0].支付金额, 100)
  assert.equal(first.data[0].支付金额环比, '12.00%')
  assert.equal(first.meta.shared.total_rows, 3)
  assert.equal(first.meta.shared.current_exec_no, 2)

  const second = await runAdapter('product-ranking.js', {
    params: { time_range: 'page', page_size: 2 },
    shared: first.meta.shared,
    inputs: [
      input('2026-06-01', '开始日期'),
      input('2026-06-01', '结束日期'),
    ],
    mtopImpl: makeMtop,
  })

  assert.equal(second.success, true)
  assert.equal(second.meta.action, 'complete')
  assert.equal(second.data.length, 1)
  assert.equal(calls[1].data.current, 2)
  assert.equal(second.data[0].排行, 3)
  assert.equal(second.meta.shared.completed_count, 3)
})

test('product ranking uses AliExpress page enum values for visitor rank and seven day page range', async () => {
  const calls = []
  const result = await runAdapter('product-ranking.js', {
    href: 'https://csp.aliexpress.com/m_apps/csp-sycm-new/productRank?channelId=125417',
    params: {
      rank_type: 'visitor',
      biz_type: 'choice',
      first_online_30d: true,
      page_size: 10,
    },
    inputs: [
      input('2026-05-26', '开始日期'),
      input('2026-06-01', '结束日期'),
    ],
    bodyText: 'Semir Official Store\n商品分析\n访客榜\n业务模式\n已加入半托管\n商品筛选\n30天内上架新品',
    mtopImpl(request, success) {
      calls.push(request)
      success({
        ret: ['SUCCESS::调用成功'],
        data: {
          dataSource: [
            {
              statDate: '2026-06-01 00:00:00',
              itemId: 1005000000000099,
              rank: 1,
              title: 'Visitor ranked item',
              cateLeafName: 'T恤',
              uv: 88,
            },
          ],
          recordCount: 1,
        },
      })
    },
  })

  assert.equal(result.success, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].data.rankType, 'item_uv')
  assert.equal(calls[0].data.dateType, 'recent7')
  assert.equal(calls[0].data.bizType, 'choice')
  assert.equal(calls[0].data.firstOnline30d, true)
  assert.equal(result.data[0].榜单类型, '访客榜')
  assert.equal(result.data[0].时间筛选, '最近7天')
  assert.equal(result.data[0].业务模式, '已加入半托管')
  assert.equal(result.data[0].商品筛选, '30天内上架新品')
})
