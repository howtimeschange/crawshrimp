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
    this._value = String(options.value || '')
    this._attrs = new Map(Object.entries(options.attributes || {}))
    this._rect = options.rect || { x: 0, y: 0, width: 120, height: 32 }
    this._selectors = new Map()
    this._style = options.style || { color: 'rgb(20, 23, 55)' }
    this.__clickRequest = options.clickRequest || null
  }

  get innerText() { return this._text }
  get textContent() { return this._text }
  get value() { return this._value }
  set value(next) { this._value = String(next ?? '') }

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

  getClientRects() {
    return this._rect.width && this._rect.height ? [this._rect] : []
  }

  getBoundingClientRect() {
    const { x, y, width, height } = this._rect
    return { left: x, top: y, width, height, right: x + width, bottom: y + height }
  }

  scrollIntoView() {}
  focus() {}
  click() {
    if (!this.__clickRequest || typeof this.__runtimeFetch !== 'function') return true
    this.__runtimeFetch(this.__clickRequest.url, this.__clickRequest.init || {})
    return true
  }
  dispatchEvent() { return true }
}

class FakeDocument {
  constructor(bodyText = '') {
    this._selectors = new Map()
    this.body = new FakeElement({
      tagName: 'body',
      text: bodyText,
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
    })
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

async function runScript({ phase = 'main', page = 1, params = {}, shared = {}, document, fetchImpl, styleMap = new Map() }) {
  const scriptPath = path.resolve('adapters/shein-helper/merchandise-details.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      __CRAWSHRIMP_PAGE__: page,
    },
    document,
    location: { href: 'https://sso.geiwohuo.com/#/sbn/merchandise/details' },
    fetch: fetchImpl || (async () => { throw new Error('fetch not mocked') }),
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
    getComputedStyle: el => styleMap.get(el) || el?._style || { visibility: 'visible', display: 'block', color: 'rgb(20, 23, 55)' },
  }
  context.globalThis = context
  context.window.fetch = (...args) => context.fetch(...args)
  const bindRuntimeFetch = element => {
    if (!element || typeof element !== 'object') return
    element.__runtimeFetch = (...args) => context.fetch(...args)
    if (element._selectors instanceof Map) {
      for (const items of element._selectors.values()) {
        for (const item of items || []) bindRuntimeFetch(item)
      }
    }
  }
  bindRuntimeFetch(document)
  bindRuntimeFetch(document?.body)
  return await vm.runInNewContext(source, context, { filename: scriptPath })
}

test('merchandise details main phase captures current tab request from pager', async () => {
  const prev = new FakeElement({
    tagName: 'button',
    className: 'soui-pagination-button-item soui-button-disabled',
    rect: { x: 1406, y: 857, width: 26, height: 26 },
  })
  const current = new FakeElement({
    tagName: 'button',
    text: '1',
    className: 'soui-pagination-button-item',
    rect: { x: 1440, y: 857, width: 26, height: 26 },
  })
  const next = new FakeElement({
    tagName: 'button',
    className: 'soui-pagination-button-item',
    rect: { x: 1763, y: 857, width: 26, height: 26 },
    clickRequest: {
      url: '/sbn/new_goods/get_diagnose_list',
      init: {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          areaCd: 'cn',
          dt: '20260419',
          countrySite: ['shein-all'],
          groupType: 'total',
          startDate: '20260419',
          endDate: '20260419',
          pageNum: 2,
          pageSize: 10,
        }),
      },
    },
  })
  const skc = new FakeElement({ tagName: 'div', text: 'SKC列表', className: 'soui-tabs-tab' })
  const spu = new FakeElement({ tagName: 'div', text: 'SPU列表', className: 'soui-tabs-tab' })
  const styleMap = new Map([
    [skc, { visibility: 'visible', display: 'block', color: 'rgb(20, 23, 55)' }],
    [spu, { visibility: 'visible', display: 'block', color: 'rgb(25, 122, 250)' }],
  ])
  const document = new FakeDocument('商品分析 共19766条')
    .setSelector('button', [prev, current, next])
    .setSelector('[class*="soui-tabs-tab"]', [skc, spu])

  const fetchImpl = async (url, init = {}) => ({
    url: String(url),
    async json() {
      return {
        code: '0',
        info: {
          data: [],
          meta: { count: 19766 },
        },
      }
    },
    async text() {
      return JSON.stringify({
        code: '0',
        info: {
          data: [],
          meta: { count: 19766 },
        },
      })
    },
    clone() {
      return this
    },
  })

  const result = await runScript({ document, styleMap, fetchImpl })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'prepare_template')
  assert.equal(result.meta.shared.capture_source, 'pager')
  assert.equal(result.meta.shared.current_dimension, 'SPU列表')
  assert.ok(result.meta.shared.captureResult.matches.some(match => /get_diagnose_list/.test(String(match.responseUrl || ''))))
})

test('merchandise details collect_page replays captured API with pageSize 200', async () => {
  const document = new FakeDocument('商品分析')
  const fetchCalls = []
  const pageItems = Array.from({ length: 200 }, (_, index) => ({
    goodsName: `商品A-${index + 1}`,
    imageUrl: `https://img.example/${index + 1}.jpg`,
    spu: `SPU-${index + 1}`,
    promCampaign: { promTag: '营销中', promInfIng: [{ promNm: '活动A' }], promInfReady: [] },
    c1dSaleCnt: 12,
    c1dOrderCnt: 8,
    c1dGoodsUvAgg: 345,
    payUserCnt: 7,
    c1dReturnOrderCnt: 1,
    c1dCartPv: 2,
    c1dCartUvAgg: 3,
    cartUvRate: 0.12,
    payUvRate: 0.05,
    clickRate: 0.33,
    c1dSaleAmt: 199.5,
    c1dBadRate: 0.02,
    newCate1Nm: '儿童',
    newCate2Nm: '女童',
    newCate3Nm: '上衣',
    newCate4Nm: 'T恤',
    layerNm35dFlag: '1',
  }))
  const fetchImpl = async (url, init = {}) => {
    fetchCalls.push({ url, init })
    return {
      status: 200,
      async text() {
        return JSON.stringify({
          code: '0',
          info: {
            data: pageItems,
            meta: { count: 350 },
          },
        })
      },
    }
  }

  const shared = {
    api_template: {
      endpoint: '/sbn/new_goods/get_diagnose_list',
      dimension: 'SPU列表',
      payload: {
        areaCd: 'cn',
        dt: '20260419',
        countrySite: ['shein-all'],
        startDate: '20260419',
        endDate: '20260419',
        groupType: 'total',
        pageNum: 2,
        pageSize: 10,
      },
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'Origin-Url': 'https://sso.geiwohuo.com/#/sbn/merchandise',
        'x-gw-auth': 'token',
        'x-sbn-front-version': 'front-version',
        'x-bbl-route': '',
      },
      filter_summary: '站点=shein-all; 统计日期=20260419',
      filter_payload: {
        areaCd: 'cn',
        dt: '20260419',
        countrySite: ['shein-all'],
        startDate: '20260419',
        endDate: '20260419',
      },
    },
  }

  const result = await runScript({
    phase: 'collect_page',
    page: 1,
    shared,
    document,
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.has_more, true)
  assert.equal(result.data.length, 200)
  assert.equal(result.data[0].__sheet_name, 'SPU列表')
  assert.equal(result.data[0]['商品字段/商品名称'], '商品A-1')
  assert.equal(result.data[0]['商品字段/SPU'], 'SPU-1')
  assert.equal(result.data[0]['商品字段/标签'], '')
  assert.equal(result.data[0]['商品基本信息/活动标签'], '活动中')
  assert.equal(result.data[0]['交易/销量'], 12)
  assert.equal(result.data[0]['交易/支付订单数'], 8)
  assert.equal(result.data[0].筛选摘要, '站点=shein-all; 统计日期=20260419')
  assert.equal(Object.hasOwn(result.data[0], '商品'), false)
  assert.equal(Object.hasOwn(result.data[0], '商品基本信息'), false)
  assert.equal(result.meta.shared.total_rows, 350)
  assert.equal(result.meta.shared.total_batches, 2)
  assert.equal(result.meta.shared.current_exec_no, 200)
  assert.equal(result.meta.shared.batch_no, 1)

  const requestPayload = JSON.parse(fetchCalls[0].init.body)
  assert.equal(requestPayload.pageNum, 1)
  assert.equal(requestPayload.pageSize, 200)
})

test('merchandise details SKC rows split product fields from live payload shape', async () => {
  const document = new FakeDocument('商品分析')
  const fetchImpl = async () => ({
    status: 200,
    async text() {
      return JSON.stringify({
        code: '0',
        info: {
          data: [
            {
              goodsName: '100%纯棉儿童字母印花T恤柔软透气轻便短袖休闲夏季上衣2-6岁',
              imgUrl: 'https://img.example/skc.jpg',
              spu: 'a2603031033519377',
              skc: 'sa260303103351937770319',
              skuSupplierNo: '23022611720710501',
              newGoodsTag: '2',
              layerNm: '备货款A',
              onsaleFlag: '1',
              saleFlag: '1',
              promCampaign: {
                promTag: '其他,营销中',
                promInfIng: [{ promNm: '活动A' }],
                promInfReady: [{ promNm: '活动B' }],
              },
              saleCnt: 23,
              payOrderCnt: 20,
              goodsUv: 572,
              payUv: 18,
              pcsOrderCnt: 8,
              pcsQty: 273,
              newCate1Nm: '婴儿',
              newCate2Nm: '婴童（男）服装',
              newCate3Nm: '婴童（男）上衣',
              newCate4Nm: '',
              layerNm35dFlag: '1',
            },
          ],
          meta: { count: 1 },
        },
      })
    },
  })

  const shared = {
    api_template: {
      endpoint: '/sbn/new_goods/get_skc_diagnose_list',
      dimension: 'SKC列表',
      payload: {
        areaCd: 'cn',
        dt: '20260419',
        countrySite: ['shein-all'],
        startDate: '20260419',
        endDate: '20260419',
        pageNum: 1,
        pageSize: 10,
      },
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
      },
      filter_summary: '站点=shein-all; 统计日期=20260419',
      filter_payload: {
        areaCd: 'cn',
        dt: '20260419',
        countrySite: ['shein-all'],
        startDate: '20260419',
        endDate: '20260419',
      },
    },
  }

  const result = await runScript({
    phase: 'collect_page',
    page: 1,
    shared,
    document,
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].__sheet_name, 'SKC列表')
  assert.equal(result.data[0]['商品字段/商品名称'], '100%纯棉儿童字母印花T恤柔软透气轻便短袖休闲夏季上衣2-6岁')
  assert.equal(result.data[0]['商品字段/SKC'], 'sa260303103351937770319')
  assert.equal(result.data[0]['商品字段/SPU'], 'a2603031033519377')
  assert.equal(result.data[0]['商品字段/货号'], '23022611720710501')
  assert.equal(result.data[0]['商品字段/品类'], '婴儿 / 婴童（男）服装 / 婴童（男）上衣')
  assert.equal(result.data[0]['商品字段/标签'], '新品畅销 / 备货款A / 在售 / 上架')
  assert.equal(result.data[0]['商品基本信息/活动标签'], '活动中 / 即将开始活动')
  assert.equal(result.data[0]['商品基本信息/是否35天转备货'], '是')
  assert.equal(Object.hasOwn(result.data[0], '商品'), false)
  assert.equal(Object.hasOwn(result.data[0], '商品基本信息'), false)
})

test('merchandise details prepare_template keeps per-dimension captures and applies custom date range', async () => {
  const document = new FakeDocument('商品分析')
  const shared = {
    current_dimension: 'SPU列表',
    dimension_captures: {
      SKC列表: {
        matches: [
          {
            url: 'https://sso.geiwohuo.com/sbn/new_goods/get_skc_diagnose_list',
            responseUrl: 'https://sso.geiwohuo.com/sbn/new_goods/get_skc_diagnose_list',
            method: 'POST',
            headers: {
              Accept: 'application/json, text/plain, */*',
              'Content-Type': 'application/json',
              'x-gw-auth': 'skc-token',
            },
            postData: JSON.stringify({
              areaCd: 'cn',
              dt: '20260419',
              countrySite: ['shein-all'],
              startDate: '20260419',
              endDate: '20260419',
              pageNum: 1,
              pageSize: 10,
            }),
            body: JSON.stringify({
              code: '0',
              info: {
                data: [],
                meta: { count: 320 },
              },
            }),
          },
        ],
      },
      SPU列表: {
        matches: [
          {
            url: 'https://sso.geiwohuo.com/sbn/new_goods/get_diagnose_list',
            responseUrl: 'https://sso.geiwohuo.com/sbn/new_goods/get_diagnose_list',
            method: 'POST',
            headers: {
              Accept: 'application/json, text/plain, */*',
              'Content-Type': 'application/json',
              'x-gw-auth': 'spu-token',
            },
            postData: JSON.stringify({
              areaCd: 'cn',
              dt: '20260419',
              countrySite: ['shein-all'],
              startDate: '20260419',
              endDate: '20260419',
              groupType: 'total',
              pageNum: 1,
              pageSize: 10,
            }),
            body: JSON.stringify({
              code: '0',
              info: {
                data: [],
                meta: { count: 180 },
              },
            }),
          },
        ],
      },
    },
  }

  const result = await runScript({
    phase: 'prepare_template',
    params: {
      dimension_scope: 'both',
      time_mode: 'custom',
      custom_date_range: { start: '2026-04-10', end: '2026-04-15' },
    },
    shared,
    document,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'collect_page')
  assert.equal(result.meta.shared.api_templates.length, 2)
  assert.equal(result.meta.shared.api_templates[0].dimension, 'SKC列表')
  assert.equal(result.meta.shared.api_templates[0].endpoint, '/sbn/new_goods/get_skc_diagnose_list')
  assert.equal(result.meta.shared.api_templates[1].dimension, 'SPU列表')
  assert.equal(result.meta.shared.api_templates[1].endpoint, '/sbn/new_goods/get_diagnose_list')
  assert.equal(result.meta.shared.api_templates[0].headers['x-gw-auth'], 'skc-token')
  assert.equal(result.meta.shared.api_templates[1].headers['x-gw-auth'], 'spu-token')
  assert.equal(result.meta.shared.api_templates[0].payload.startDate, '20260410')
  assert.equal(result.meta.shared.api_templates[0].payload.endDate, '20260415')
  assert.equal(result.meta.shared.api_templates[0].payload.dt, '20260415')
  assert.equal(result.meta.shared.api_templates[1].payload.startDate, '20260410')
  assert.equal(result.meta.shared.api_templates[1].payload.endDate, '20260415')
  assert.equal(result.meta.shared.api_templates[1].payload.dt, '20260415')
  assert.equal(result.meta.shared.total_rows, 0)
  assert.equal(result.meta.shared.total_batches, 0)
  assert.equal(result.meta.shared.active_template_index, 0)
  assert.equal(result.meta.shared.local_page, 1)
})
