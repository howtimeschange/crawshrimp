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
    this._rect = options.rect || { x: 0, y: 0, width: 120, height: 32 }
    this._selectors = new Map()
    this.__clickRequest = options.clickRequest || null
  }

  get innerText() { return this._text }
  get textContent() { return this._text }
  get value() { return String(this._attrs.get('value') || '') }
  set value(next) { this._attrs.set('value', String(next ?? '')) }

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

  removeAttribute(name) {
    this._attrs.delete(name)
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
  dispatchEvent() { return true }
  click() {
    if (!this.__clickRequest || typeof this.__runtimeFetch !== 'function') return true
    this.__runtimeFetch(this.__clickRequest.url, this.__clickRequest.init || {})
    return true
  }
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

async function runScript({ phase = 'main', page = 1, params = {}, shared = {}, document, fetchImpl }) {
  const scriptPath = path.resolve('adapters/shein-helper/commodity-quality.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      __CRAWSHRIMP_PAGE__: page,
    },
    document,
    location: { href: 'https://sso.geiwohuo.com/#/pqmp/commoditiesQuality/list' },
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
    Event: class Event {
      constructor(type, init = {}) {
        this.type = type
        Object.assign(this, init)
      }
    },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
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

function monthToken(offset = 0) {
  const date = new Date()
  date.setDate(1)
  date.setMonth(date.getMonth() + offset)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function buildCaptureShared({ payload = {}, count = 2 } = {}) {
  return {
    captureResult: {
      matches: [
        {
          url: 'https://sso.geiwohuo.com/pqmp-api-prefix/pqmp/quality_analysis/new_list?page_num=1&page_size=10',
          responseUrl: 'https://sso.geiwohuo.com/pqmp-api-prefix/pqmp/quality_analysis/new_list?page_num=1&page_size=10',
          method: 'POST',
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/json; charset=utf-8',
            'x-gw-auth': 'token',
          },
          postData: JSON.stringify(payload),
          body: JSON.stringify({
            code: '0',
            msg: 'OK',
            info: {
              data: [],
              meta: { count },
            },
          }),
        },
      ],
    },
  }
}

test('commodity quality prepare_template inherits current list request and applies batch SKC filter', async () => {
  const document = new FakeDocument('商品质量')
  const result = await runScript({
    phase: 'prepare_template',
    params: { filter_skc: 'sk-a\nsk-b' },
    shared: buildCaptureShared({
      payload: {
        sType: 2,
        spu_name_list: ['old-spu'],
        goods_quality_level_list: ['B2'],
        alert_type_list: [4],
        optimize_status_list: [1],
      },
      count: 12,
    }),
    document,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'prepare_list_shards')
  const template = result.meta.shared.list_template
  assert.equal(template.endpoint, '/pqmp-api-prefix/pqmp/quality_analysis/new_list')
  assert.deepEqual(template.payload.skc_name_list, ['sk-a', 'sk-b'])
  assert.equal(template.payload.sType, 1)
  assert.equal(Object.hasOwn(template.payload, 'spu_name_list'), false)
  assert.deepEqual(template.payload.goods_quality_level_list, ['B2'])
  assert.equal(template.filter_summary.includes('SKC=2项'), true)
  assert.equal(template.filter_summary.includes('质量等级=B2'), true)
})

test('commodity quality prepare_template applies batch SPU filter', async () => {
  const document = new FakeDocument('商品质量')
  const result = await runScript({
    phase: 'prepare_template',
    params: { filter_spu: 'spu-a\nspu-b' },
    shared: buildCaptureShared({
      payload: { sType: 1, skc_name_list: ['old-skc'] },
      count: 8,
    }),
    document,
  })

  assert.equal(result.success, true)
  const template = result.meta.shared.list_template
  assert.equal(template.payload.sType, 2)
  assert.deepEqual(template.payload.spu_name_list, ['spu-a', 'spu-b'])
  assert.equal(Object.hasOwn(template.payload, 'skc_name_list'), false)
  assert.equal(template.filter_summary.includes('SPU=2项'), true)
})

test('commodity quality prepare_list_shards splits full export below ES 10000 pagination limit', async () => {
  const document = new FakeDocument('商品质量')
  const countByPayload = new Map([
    [JSON.stringify({}), 20363],
    [JSON.stringify({ goods_quality_level_list: [0] }), 10290],
    [JSON.stringify({ goods_quality_level_list: [12] }), 238],
    [JSON.stringify({ goods_quality_level_list: [13] }), 302],
    [JSON.stringify({ goods_quality_level_list: [14] }), 787],
    [JSON.stringify({ goods_quality_level_list: [15] }), 8746],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [0] }), 8454],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [4] }), 78],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [7] }), 3],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [10] }), 534],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [17] }), 90],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [67] }), 3],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [87] }), 646],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [107] }), 2],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [220] }), 4],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [227] }), 1],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [228] }), 449],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [232] }), 25],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [236] }), 1],
  ])
  const fetchCalls = []
  const fetchImpl = async (url, init = {}) => {
    fetchCalls.push({ url, init })
    const requestPayload = JSON.parse(init.body || '{}')
    const count = countByPayload.get(JSON.stringify(requestPayload))
    assert.notEqual(count, undefined, `unexpected probe payload ${JSON.stringify(requestPayload)}`)
    return {
      status: 200,
      async text() {
        return JSON.stringify({
          code: '0',
          msg: 'OK',
          info: { data: count > 0 ? [{}] : [], meta: { count } },
        })
      },
    }
  }

  const result = await runScript({
    phase: 'prepare_list_shards',
    shared: {
      list_template: {
        endpoint: '/pqmp-api-prefix/pqmp/quality_analysis/new_list',
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        payload: {},
        filter_summary: '',
      },
      list_page: 1,
      detail_queue: [],
    },
    document,
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'collect_list_page')
  assert.equal(result.meta.shared.total_rows, 20363)
  assert.equal(result.meta.shared.list_shards.length, 17)
  assert.equal(result.meta.shared.list_shards.every(shard => shard.total_rows <= 10000), true)
  assert.deepEqual(result.meta.shared.list_shards[0].payload, {
    goods_quality_level_list: [0],
    product_level_list: [0],
  })
  assert.equal(result.meta.shared.total_batches, 114)
  assert.equal(fetchCalls.length, 19)
})

test('commodity quality prepare_list_shards discovers missing product level shards', async () => {
  const document = new FakeDocument('商品质量')
  const baseCounts = new Map([
    [JSON.stringify({}), 20363],
    [JSON.stringify({ goods_quality_level_list: [0] }), 10291],
    [JSON.stringify({ goods_quality_level_list: [12] }), 238],
    [JSON.stringify({ goods_quality_level_list: [13] }), 302],
    [JSON.stringify({ goods_quality_level_list: [14] }), 787],
    [JSON.stringify({ goods_quality_level_list: [15] }), 8745],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [0] }), 8454],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [4] }), 78],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [7] }), 3],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [10] }), 534],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [17] }), 90],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [67] }), 3],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [87] }), 646],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [107] }), 2],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [220] }), 4],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [227] }), 1],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [228] }), 449],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [232] }), 25],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [236] }), 1],
    [JSON.stringify({ goods_quality_level_list: [0], product_level_list: [299] }), 1],
  ])
  const fetchCalls = []
  const fetchImpl = async (url, init = {}) => {
    fetchCalls.push({ url, init })
    const requestPayload = JSON.parse(init.body || '{}')
    const key = JSON.stringify(requestPayload)
    const count = baseCounts.has(key) ? baseCounts.get(key) : 0
    return {
      status: 200,
      async text() {
        return JSON.stringify({
          code: '0',
          msg: 'OK',
          info: { data: count > 0 ? [{}] : [], meta: { count } },
        })
      },
    }
  }

  const result = await runScript({
    phase: 'prepare_list_shards',
    shared: {
      list_template: {
        endpoint: '/pqmp-api-prefix/pqmp/quality_analysis/new_list',
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        payload: {},
        filter_summary: '',
      },
      list_page: 1,
      detail_queue: [],
    },
    document,
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'collect_list_page')
  assert.equal(result.meta.shared.list_shards.some(shard => shard.payload?.product_level_list?.[0] === 299), true)
  assert.equal(result.meta.shared.total_rows, 20363)
  assert.equal(result.meta.shared.list_shards.every(shard => shard.total_rows <= 10000), true)
})

test('commodity quality collect_list_page advances to next shard instead of requesting over ES page limit', async () => {
  const document = new FakeDocument('商品质量')
  const fetchCalls = []
  const fetchImpl = async (url, init = {}) => {
    fetchCalls.push({ url, init })
    assert.equal(String(url), '/pqmp-api-prefix/pqmp/quality_analysis/new_list?page_num=50&page_size=200')
    assert.deepEqual(JSON.parse(init.body), { goods_quality_level_list: [0], product_level_list: [0] })
    return {
      status: 200,
      async text() {
        return JSON.stringify({
          code: '0',
          msg: 'OK',
          info: {
            data: [{ skc_info: { skc_name: 'last-skc' }, spu_info: { spu_name: 'last-spu' }, refund_cnt: 0 }],
            meta: { count: 10000 },
          },
        })
      },
    }
  }

  const result = await runScript({
    phase: 'collect_list_page',
    shared: {
      list_template: {
        endpoint: '/pqmp-api-prefix/pqmp/quality_analysis/new_list',
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        payload: {},
        filter_summary: '',
        total_rows: 10238,
        total_batches: 52,
      },
      list_shards: [
        {
          label: '质量等级=0 / 商品层次=0',
          payload: { goods_quality_level_list: [0], product_level_list: [0] },
          total_rows: 10000,
          total_batches: 50,
        },
        {
          label: '质量等级=12',
          payload: { goods_quality_level_list: [12] },
          total_rows: 238,
          total_batches: 2,
        },
      ],
      active_shard_index: 0,
      list_page: 50,
      detail_queue: [],
    },
    document,
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.has_more, true)
  assert.equal(result.meta.shared.active_shard_index, 1)
  assert.equal(result.meta.shared.list_page, 1)
  assert.equal(result.meta.shared.current_exec_no, 10000)
  assert.equal(result.meta.shared.batch_no, 50)
  assert.equal(fetchCalls.length, 1)
})

test('commodity quality collect_list_page maps live payload and queues return details', async () => {
  const document = new FakeDocument('商品质量')
  const fetchCalls = []
  const fetchImpl = async (url, init = {}) => {
    fetchCalls.push({ url, init })
    return {
      status: 200,
      async text() {
        return JSON.stringify({
          code: '0',
          msg: 'OK',
          info: {
            data: [
              {
                skc_info: {
                  skc_name: 'sk25050817072795161',
                  skc_code: 'O74tax64lqk0',
                  product_name_multi: 'Tween Girl半身裙',
                  main_image_thumbnail: { image_url: 'https://img.example/skc.jpg' },
                },
                spu_info: {
                  spu_name: 'k250508170727',
                  spu_code: 'P74tax63r7kn',
                  product_name_multi: 'Tween Girl半身裙',
                },
                category_name: '儿童/女童（大）服装/女童（大）半身裙',
                product_grade: '备货款A',
                on_sale_status: 2,
                sales_volume7_days: 49,
                goods_quality_level: 'B2',
                goods_quality_level_type: 15,
                od_risk_level: 1,
                quality_level_change_desc: '质量变差',
                bad_eval_cnt: 5,
                bad_eval_rate: 0.0909,
                same_cate_bad_eval_rate: 0.0274,
                bad_label_text: '材质质感差 100.0%',
                quality_return_volume: 14,
                return_volume: 41,
                quality_return_rate: 0.0697,
                same_cate_quality_return_rate: 0.0089,
                refund_cnt: 24,
                last_score: 7,
                is_show_customer_return_reason: 1,
              },
            ],
            meta: { count: 1 },
          },
        })
      },
    }
  }

  const result = await runScript({
    phase: 'collect_list_page',
    shared: {
      list_template: {
        endpoint: '/pqmp-api-prefix/pqmp/quality_analysis/new_list',
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        payload: { sType: 1, skc_name_list: ['sk25050817072795161'] },
        filter_summary: 'SKC=1项',
      },
      list_page: 1,
      detail_queue: [],
    },
    document,
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'collect_detail_page')
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].__sheet_name, '质量列表')
  assert.equal(result.data[0].商品名称, 'Tween Girl半身裙')
  assert.equal(result.data[0].SKC, 'sk25050817072795161')
  assert.equal(result.data[0].SPU, 'k250508170727')
  assert.equal(result.data[0]['品退数/品退率'], '14 / 6.97%')
  assert.equal(result.data[0]['差评数/差评率'], '5 / 9.09%')
  assert.equal(Object.hasOwn(result.data[0], '操作'), false)
  assert.equal(result.meta.shared.detail_queue.length, 1)
  assert.equal(result.meta.shared.detail_queue[0].skc, 'sk25050817072795161')
  assert.equal(result.meta.shared.detail_queue[0].months.length, 12)
  assert.equal(result.meta.shared.detail_queue[0].months[0], monthToken())
  assert.equal(result.meta.shared.detail_queue[0].months[1], monthToken(-1))
  assert.equal(result.meta.shared.total_rows, 1)
  assert.equal(result.meta.shared.list_total_rows, 1)
  assert.equal(result.meta.shared.list_completed_rows, 1)
  assert.equal(result.meta.shared.detail_total_targets, 1)
  assert.equal(result.meta.shared.detail_completed_targets, 0)

  const requestPayload = JSON.parse(fetchCalls[0].init.body)
  assert.equal(requestPayload.page_num, undefined)
  assert.equal(String(fetchCalls[0].url), '/pqmp-api-prefix/pqmp/quality_analysis/new_list?page_num=1&page_size=200')
  assert.deepEqual(requestPayload.skc_name_list, ['sk25050817072795161'])
})

test('commodity quality collect_detail_page scans prior months for batch SKC searches', async () => {
  const document = new FakeDocument('商品质量')
  const fetchCalls = []
  const fetchImpl = async (url, init = {}) => {
    fetchCalls.push({ url, init })
    const requestPayload = JSON.parse(init.body || '{}')
    const month = requestPayload.month
    const rows = month === '2026-04'
      ? [
          {
            return_order_id: '1XX2C0266Q',
            return_order_time: '2026-04-04 04:22:03',
            country_site: 'SHEIN美国站',
            quality_flag: 0,
            sku: 'I9b0bu1jd26x-白色调-12Y',
            return_reason_nm: '未妥投退回',
          },
        ]
      : []
    return {
      status: 200,
      async text() {
        return JSON.stringify({
          code: '0',
          msg: 'OK',
          info: {
            data: rows,
            meta: rows.length ? { count: rows.length } : {},
          },
        })
      },
    }
  }

  const result = await runScript({
    phase: 'collect_detail_page',
    shared: {
      detail_queue: [
        {
          skc: 'sk25082245199392241',
          spu: 'k250822451993',
          product_name: '儿童套装',
          month: '2026-05',
          months: ['2026-05', '2026-04'],
          return_volume: 1,
          quality_return_volume: 0,
          quality_return_rate: 0,
          same_cate_quality_return_rate: 0.004,
        },
      ],
      detail_index: 0,
      detail_page: 1,
      detail_month_index: 0,
      detail_template: {
        endpoint: '/pqmp-api-prefix/pqmp/quality_analysis/get_customer_return_reason',
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        payload: {},
      },
    },
    document,
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].SKC, 'sk25082245199392241')
  assert.equal(result.data[0].退货月份, '2026-04')
  assert.equal(result.data[0].序号, '1XX2C0266Q')
  assert.equal(fetchCalls.length, 2)
  assert.deepEqual(fetchCalls.map(call => JSON.parse(call.init.body).month), ['2026-05', '2026-04'])
  assert.equal(result.meta.shared.detail_index, 1)
  assert.equal(result.meta.shared.detail_month_index, 0)
  assert.equal(result.meta.shared.detail_records_collected, 1)
})

test('commodity quality collect_detail_page exports customer return rows and continues pagination', async () => {
  const document = new FakeDocument('商品质量')
  const fetchCalls = []
  const fetchImpl = async (url, init = {}) => {
    fetchCalls.push({ url, init })
    return {
      status: 200,
      async text() {
        return JSON.stringify({
          code: '0',
          msg: 'OK',
          info: {
            data: [
              {
                return_order_id: '1Y33C03SMF',
                return_order_time: '2026-05-01 08:35:34',
                country_site: 'SHEIN沙特阿拉伯站',
                quality_flag: 0,
                sku: 'I74tax65162p-粉红-12Y',
                return_reason_nm: 'COD未妥投退回',
              },
              {
                return_order_id: '1Y6AM0XLVS',
                return_order_time: '2026-05-06 21:42:18',
                country_site: 'SHEIN美国站',
                quality_flag: 1,
                sku: 'I74tax64v5d2-粉红-8Y',
                return_reason_nm: '尺码偏小',
              },
            ],
            meta: { count: 250 },
          },
        })
      },
    }
  }

  const result = await runScript({
    phase: 'collect_detail_page',
    shared: {
      detail_queue: [
        {
          skc: 'sk25050817072795161',
          spu: 'k250508170727',
          product_name: 'Tween Girl半身裙',
          month: '2026-05',
          return_volume: 41,
          quality_return_volume: 14,
          quality_return_rate: 0.0697,
          same_cate_quality_return_rate: 0.0089,
        },
      ],
      detail_index: 0,
      detail_page: 1,
      detail_template: {
        endpoint: '/pqmp-api-prefix/pqmp/quality_analysis/get_customer_return_reason',
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        payload: { month: '2026-05', skc: 'template-skc' },
      },
    },
    document,
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'collect_detail_page')
  assert.equal(result.data.length, 2)
  assert.equal(result.data[0].__sheet_name, '客退详情')
  assert.equal(result.data[0].SKC, 'sk25050817072795161')
  assert.equal(result.data[0].SPU, 'k250508170727')
  assert.equal(result.data[0].商品名称, 'Tween Girl半身裙')
  assert.equal(result.data[0].序号, '1Y33C03SMF')
  assert.equal(result.data[0].是否品退, '否')
  assert.equal(result.data[1].是否品退, '是')
  assert.equal(result.meta.shared.detail_page, 2)
  assert.equal(result.meta.shared.current_store, '客退详情 sk25050817072795161 1/2')
  assert.equal(result.meta.shared.detail_total_targets, 1)
  assert.equal(result.meta.shared.detail_completed_targets, 0)
  assert.equal(result.meta.shared.detail_current_target_index, 1)
  assert.equal(result.meta.shared.detail_current_target, 'sk25050817072795161')
  assert.equal(result.meta.shared.detail_current_page, 1)
  assert.equal(result.meta.shared.detail_total_pages, 2)
  assert.equal(result.meta.shared.detail_records_collected, 2)

  assert.equal(String(fetchCalls[0].url), '/pqmp-api-prefix/pqmp/quality_analysis/get_customer_return_reason?page_num=1&page_size=200')
  const requestPayload = JSON.parse(fetchCalls[0].init.body)
  assert.equal(requestPayload.skc, 'sk25050817072795161')
  assert.equal(requestPayload.month, '2026-05')
  assert.equal(requestPayload.page_num, undefined)
})

test('commodity quality main resumes customer return detail phase after list collection is done', async () => {
  const document = new FakeDocument('商品质量')
  const result = await runScript({
    phase: 'main',
    shared: {
      list_done: true,
      list_template: {
        endpoint: '/pqmp-api-prefix/pqmp/quality_analysis/new_list',
        method: 'POST',
        headers: {},
        payload: { sType: 1, skc_name_list: ['sk25050817072795161'] },
      },
      detail_queue: [
        { skc: 'sk25050817072795161', month: '2026-05' },
        { skc: 'sk25050817072795162', month: '2026-05' },
      ],
      detail_index: 0,
      detail_page: 2,
    },
    document,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'collect_detail_page')
  assert.equal(result.meta.shared.detail_page, 2)
})

test('commodity quality collect_detail_page batches multiple queued SKCs in one phase', async () => {
  const document = new FakeDocument('商品质量')
  const fetchCalls = []
  const fetchImpl = async (url, init = {}) => {
    fetchCalls.push({ url, init })
    const requestPayload = JSON.parse(init.body)
    return {
      status: 200,
      async text() {
        return JSON.stringify({
          code: '0',
          msg: 'OK',
          info: {
            data: [
              {
                return_order_id: `order-${requestPayload.skc}`,
                return_order_time: '2026-05-01 08:35:34',
                country_site: 'SHEIN美国站',
                quality_flag: 1,
                sku: `sku-${requestPayload.skc}`,
                return_reason_nm: '尺码偏小',
              },
            ],
            meta: { count: 1 },
          },
        })
      },
    }
  }

  const result = await runScript({
    phase: 'collect_detail_page',
    shared: {
      detail_queue: [
        { skc: 'sk-a', spu: 'spu-a', product_name: 'A', month: '2026-05' },
        { skc: 'sk-b', spu: 'spu-b', product_name: 'B', month: '2026-05' },
      ],
      detail_index: 0,
      detail_page: 1,
      detail_template: {
        endpoint: '/pqmp-api-prefix/pqmp/quality_analysis/get_customer_return_reason',
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        payload: {},
      },
    },
    document,
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.has_more, false)
  assert.equal(result.data.length, 2)
  assert.equal(result.data.map(row => row.SKC).join(','), 'sk-a,sk-b')
  assert.equal(fetchCalls.length, 2)
  assert.equal(result.meta.shared.detail_index, 2)
  assert.equal(result.meta.shared.current_store, '客退详情抓取完成')
  assert.equal(result.meta.shared.detail_total_targets, 2)
  assert.equal(result.meta.shared.detail_completed_targets, 2)
  assert.equal(result.meta.shared.detail_current_target_index, 2)
  assert.equal(result.meta.shared.detail_current_target, '')
  assert.equal(result.meta.shared.detail_records_collected, 2)
})
