const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

class FakeElement {
  constructor(text = '') {
    this.innerText = text
    this.textContent = text
  }
}

class FakeDocument {
  constructor(bodyText = '森马官方旗舰店') {
    this.body = new FakeElement(bodyText)
    this.title = '活动广场'
    this.cookie = ''
  }

  querySelectorAll() { return [] }
  querySelector() { return null }
}

async function runScript({
  params = {},
  shared = {},
  fetchImpl,
  href = 'https://fxg.jinritemai.com/ffa/merchant/campaign-square?list_tab=access&f_tab=0',
  document = new FakeDocument(),
  Date: DateCtor = Date,
} = {}) {
  const scriptPath = path.resolve('adapters/doudian-ops-assistant/mixed-fund-signup-monitor.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const location = new URL(href)
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_SHARED__: shared,
      __CRAWSHRIMP_PHASE__: 'main',
      location,
    },
    document,
    location,
    fetch: fetchImpl || (async () => { throw new Error('fetch not mocked') }),
    console,
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
  context.window.fetch = (...args) => context.fetch(...args)
  return vm.runInNewContext(source, context, { filename: scriptPath })
}

async function runOrderReplayScript({
  params = {},
  shared = {},
  phase = 'main',
  fetchImpl,
  href = 'https://fxg.jinritemai.com/ffa/morder/order/list',
  document = new FakeDocument(),
  Date: DateCtor = Date,
} = {}) {
  const scriptPath = path.resolve('adapters/doudian-ops-assistant/mixed-fund-order-replay.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const location = new URL(href)
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_SHARED__: shared,
      __CRAWSHRIMP_PHASE__: phase,
      location,
    },
    document,
    location,
    fetch: fetchImpl || (async () => { throw new Error('fetch not mocked') }),
    console,
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
    parseFloat,
    parseInt,
  }
  context.globalThis = context
  context.window.fetch = (...args) => context.fetch(...args)
  return vm.runInNewContext(source, context, { filename: scriptPath })
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload },
    async text() { return JSON.stringify(payload) },
    clone() { return this },
    headers: { get() { return 'application/json' } },
  }
}

function textResponse(text, contentType = 'text/csv; charset=utf-8', status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return JSON.parse(text) },
    async text() { return text },
    clone() { return this },
    headers: { get(name) { return /content-type/i.test(name) ? contentType : '' } },
  }
}

function activityFeedPayload() {
  return {
    code: 0,
    msg: 'success',
    data: {
      total: 2,
      data: [
        {
          sub_act_num: 3,
          feed_act: {
            main_act: {
              main_act: {
                activity_id: '7611436032944275738',
                activity_name: '【混资货品补贴-长周期】商家灵活出资，平台至高5倍对补',
                start_time: 1772294400,
                end_time: 1866902399,
              },
            },
          },
          sub_acts: [
            {
              activity_id: '7611436032944275738',
              activity_name: '【混资货品补贴-长周期】商家灵活出资，平台至高5倍对补',
            },
            {
              activity_id: '7631472587859837230',
              activity_name: '【高客单商品必报】优质用户混资货补',
            },
            {
              activity_id: '7535005095579222310',
              activity_name: '【平台最高出资15%】商家最高出资10%（25-26年）',
            },
          ],
        },
        {
          sub_act_num: 2,
          feed_act: {
            main_act: {
              main_act: {
                activity_id: '7627772015895036170',
                activity_name: '🔥全品类爆发！推荐卡全资活动报名入口',
                start_time: 1772985600,
                end_time: 1798732799,
              },
            },
          },
          sub_acts: [
            {
              activity_id: '7627772015895036170',
              activity_name: '🔥全品类爆发！推荐卡全资活动报名入口',
            },
            {
              activity_id: '7610636843016552714',
              activity_name: '🔥全品类爆发！推荐卡混资活动报名入口',
            },
          ],
        },
      ],
    },
  }
}

test('mixed fund signup monitor collects activity summaries and applied product details through Douyin APIs', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const parsedBody = init.body ? JSON.parse(String(init.body)) : {}
    calls.push({ url: String(url), body: parsedBody })

    if (String(url).includes('/mmc/activity/seller_activity_feed')) {
      return jsonResponse(activityFeedPayload())
    }

    if (String(url).includes('/mmc/apply/all_product_list')) {
      const activityId = parsedBody.activity_id
      const totals = {
        '7611436032944275738': 2,
        '7631472587859837230': 1,
        '7535005095579222310': 0,
        '7627772015895036170': 0,
        '7610636843016552714': 3,
      }
      const total = totals[activityId] || 0
      const product = total > 0
        ? [{
            is_applied: true,
            applied_product_info: {
              activity_id: activityId,
              item_id: `${activityId}-ITEM`,
              item_name: `${activityId}-报名商品`,
              shop_id: '1332411',
              apply_success_at: 1780530000,
              status: 200,
              bargain_status: 3,
              item_info: {
                product_id: `${activityId}-P`,
                product_name: `${activityId}-商品名称`,
                product_img: 'https://img.example/item.jpg',
                outer_id: 'SEMIR-SKU',
              },
            },
          }]
        : []
      return jsonResponse({
        code: 0,
        msg: 'success',
        data: {
          total,
          product_list: product,
        },
      })
    }

    throw new Error(`unexpected fetch: ${url}`)
  }

  const result = await runScript({
    params: { include_details: true },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.has_more, false)
  assert.equal(result.meta.shared.activity_count, 2)
  assert.equal(result.meta.shared.sub_activity_count, 5)
  assert.equal(result.meta.shared.applied_product_total, 6)
  assert.equal(result.data.filter(row => row.__sheet_name === '报名汇总').length, 5)
  assert.equal(result.data.filter(row => row.__sheet_name === '报名商品明细').length, 3)

  const highValue = result.data.find(row => row.活动ID === '7631472587859837230' && row.__sheet_name === '报名汇总')
  assert.equal(highValue.父活动名称, '【混资货品补贴-长周期】商家灵活出资，平台至高5倍对补')
  assert.equal(highValue.活动名称, '【高客单商品必报】优质用户混资货补')
  assert.equal(highValue.报名商品数, 1)
  assert.equal(highValue.品牌, '森马')
  assert.equal(highValue.店铺名称, '森马官方旗舰店')

  const detail = result.data.find(row => row.活动ID === '7610636843016552714' && row.__sheet_name === '报名商品明细')
  assert.equal(detail.活动名称, '🔥全品类爆发！推荐卡混资活动报名入口')
  assert.equal(detail.商品ID, '7610636843016552714-ITEM')
  assert.equal(detail.报名状态, '已报名')

  const productCalls = calls.filter(call => call.url.includes('/mmc/apply/all_product_list'))
  assert.equal(productCalls.length, 5)
  assert.equal(productCalls[0].body.size, 50)
  assert.equal(productCalls[0].body.filter_condition.filter_applied, true)
})

test('mixed fund signup monitor reads concrete shop name instead of navigation labels', async () => {
  const fetchImpl = async (url, init = {}) => {
    if (String(url).includes('/mmc/activity/seller_activity_feed')) return jsonResponse(activityFeedPayload())
    if (String(url).includes('/mmc/apply/all_product_list')) {
      return jsonResponse({ code: 0, msg: 'success', data: { total: 0, product_list: [] } })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  const result = await runScript({
    params: { include_details: [] },
    fetchImpl,
    document: new FakeDocument([
      '反馈',
      '抖店',
      '返回首页',
      '1',
      '4',
      '森马官方旗舰店',
      'AI助手',
      '申请关店',
    ].join('\n')),
  })

  assert.equal(result.success, true)
  const summary = result.data.find(row => row.__sheet_name === '报名汇总')
  assert.equal(summary.店铺名称, '森马官方旗舰店')
  assert.equal(summary.品牌, '森马')
})

test('mixed fund order replay maps platform coupons to activities and aggregates traffic and product metrics', async () => {
  const rows = [
    {
      店铺名称: '森马官方旗舰店',
      主订单编号: 'SO-001',
      子订单编号: 'IO-001',
      下单时间: '2026-06-01 10:00:00',
      商品ID: 'P100',
      商品名称: '森马短袖T恤',
      商家编码: 'SEMIR-T001',
      成交金额: '100.50',
      平台优惠: '平台老朋友惊喜券 - 平台补贴10元',
      流量体裁: '商品卡',
      流量渠道: '商城推荐',
    },
    {
      店铺名称: '森马官方旗舰店',
      主订单编号: 'SO-002',
      子订单编号: 'IO-002',
      下单时间: '2026-06-01 11:00:00',
      商品ID: 'P101',
      商品名称: '森马牛仔裤',
      商家编码: 'SEMIR-J001',
      成交金额: '200',
      平台优惠: '平台新人首单福利券',
      流量体裁: '商品卡',
      流量渠道: '搜索',
    },
    {
      店铺名称: '森马官方旗舰店',
      主订单编号: 'SO-003',
      子订单编号: 'IO-003',
      下单时间: '2026-06-02 09:00:00',
      商品ID: 'P102',
      商品名称: '森马卫衣',
      商家编码: 'SEMIR-W001',
      成交金额: '50',
      平台优惠: '平台惊喜85折券',
      流量体裁: '短视频',
      流量渠道: '短视频推荐',
    },
    {
      店铺名称: '森马官方旗舰店',
      主订单编号: 'SO-004',
      子订单编号: 'IO-004',
      下单时间: '2026-06-02 12:00:00',
      商品ID: 'P100',
      商品名称: '森马短袖T恤',
      商家编码: 'SEMIR-T001',
      成交金额: '80',
      平台优惠: '店铺满减',
      流量体裁: '直播',
      流量渠道: '达人直播间',
    },
  ]

  const result = await runOrderReplayScript({
    params: {
      order_file: { rows, filename: '官方订单导出.csv' },
      start_date: '2026-06-01',
      end_date: '2026-06-02',
      surprise_coupon_activity: 'mall_long_term',
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.shared.order_rows, 4)
  assert.equal(result.meta.shared.mixed_fund_rows, 3)
  assert.equal(result.meta.shared.mixed_fund_amount, 350.5)

  const details = result.data.filter(row => row.__sheet_name === '混资订单明细')
  assert.equal(details.length, 3)
  assert.equal(details.find(row => row.订单号 === 'SO-001').匹配活动名称, '【高客单商品必报】优质用户混资货补')
  assert.equal(details.find(row => row.订单号 === 'SO-002').匹配活动名称, '【混资货品补贴-长周期】商家灵活出资，平台至高5倍对补')
  assert.equal(details.find(row => row.订单号 === 'SO-003').匹配活动ID, '7554013743270347034')

  const overall = result.data.find(row => row.__sheet_name === '复盘总览')
  assert.equal(overall.全店引导成交金额, 430.5)
  assert.equal(overall.混资成交金额, 350.5)
  assert.equal(overall.商品卡成交金额, 300.5)
  assert.equal(overall.商品卡成交占比, 0.8573)

  const activitySummary = result.data.find(row => row.__sheet_name === '活动汇总' && row.活动ID === '7631472587859837230')
  assert.equal(activitySummary.成交订单数, 1)
  assert.equal(activitySummary.成交金额, 100.5)
  assert.equal(activitySummary.商品卡成交金额, 100.5)

  const topChannel = result.data.find(row => row.__sheet_name === '商品卡渠道Top3' && row.排名 === 1)
  assert.equal(topChannel.流量渠道, '搜索')
  assert.equal(topChannel.成交金额, 200)

  const topProduct = result.data.find(row => row.__sheet_name === '成交单品Top3' && row.排名 === 1)
  assert.equal(topProduct.商品ID, 'P101')
  assert.equal(topProduct.成交金额, 200)
})

test('mixed fund order replay normalizes official export field keys for coupon and traffic attribution', async () => {
  const rows = [
    {
      shop_name: '森马官方旗舰店',
      pid: 'SO-FIELD-001',
      order_id: 'IO-FIELD-001',
      create_time: '2026-06-03 10:00:00',
      product_id: 'P-FIELD',
      product_name: '森马官方字段商品',
      sku_code: 'SEMIR-FIELD',
      combo_amount: '88.88',
      platform_discount: '平台老朋友惊喜券',
      content_type: '商品卡',
      compass_entrance_code: '商城推荐',
      c_biz: '商城',
      ad_mark: '自然流量',
    },
  ]

  const result = await runOrderReplayScript({
    params: {
      order_file: { rows, filename: '官方订单导出.csv' },
      start_date: '2026-06-03',
      end_date: '2026-06-03',
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.shared.mixed_fund_rows, 1)
  assert.equal(result.meta.shared.export_fields_present, true)

  const detail = result.data.find(row => row.__sheet_name === '混资订单明细')
  assert.equal(detail.订单号, 'SO-FIELD-001')
  assert.equal(detail.平台优惠, '平台老朋友惊喜券')
  assert.equal(detail.流量体裁, '商品卡')
  assert.equal(detail.流量渠道, '商城推荐')
  assert.equal(detail.流量来源, '商城')
  assert.equal(detail.流量类型, '自然流量')
})

test('mixed fund order replay uses signup monitor product mapping to disambiguate surprise coupons', async () => {
  const orderRows = [
    {
      店铺名称: '森马官方旗舰店',
      主订单编号: 'SO-SURPRISE-001',
      子订单编号: 'IO-SURPRISE-001',
      下单时间: '2026-06-03 12:00:00',
      商品ID: 'P-RECOMMEND',
      商品名称: '森马推荐卡报名商品',
      商家编码: 'SEMIR-REC',
      成交金额: '188',
      平台优惠: '平台惊喜85折券',
      流量体裁: '商品卡',
      流量渠道: '商城推荐',
    },
  ]
  const signupRows = [
    {
      __sheet_name: '报名商品明细',
      活动ID: '7610636843016552714',
      活动名称: '🔥全品类爆发！推荐卡混资活动报名入口',
      商品ID: 'P-RECOMMEND',
      商家编码: 'SEMIR-REC',
      报名状态: '已报名',
    },
  ]

  const result = await runOrderReplayScript({
    params: {
      order_file: { rows: orderRows, filename: '官方订单导出.csv' },
      signup_file: { rows: signupRows, filename: '报名监控.xlsx' },
      surprise_coupon_activity: 'mall_long_term',
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.shared.signup_match_rows, 1)
  assert.equal(result.meta.shared.surprise_signup_matched_rows, 1)
  assert.equal(result.meta.shared.surprise_defaulted_rows, 0)

  const detail = result.data.find(row => row.__sheet_name === '混资订单明细')
  assert.equal(detail.匹配活动ID, '7610636843016552714')
  assert.equal(detail.匹配活动名称, '🔥全品类爆发！推荐卡混资活动报名入口')
  assert.equal(detail.匹配依据, '平台惊喜折券 + 报名商品匹配')
})

test('mixed fund order replay creates a Douyin official export task with attribution fields', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const parsedBody = init.body ? JSON.parse(String(init.body)) : {}
    calls.push({ url: String(url), method: init.method || 'GET', body: parsedBody })

    if (String(url).includes('/order/torder/queryExportFields')) {
      return jsonResponse({
        code: 0,
        msg: 'success',
        data: {
          CUSTOM: [
            {
              type_key: 'order_native_fields',
              type_value: '订单相关字段',
              children_fields: [
                { key: 'pid', value: '主订单编号' },
                { key: 'order_id', value: '子订单编号' },
                { key: 'product_name', value: '选购商品' },
                { key: 'product_id', value: '商品ID' },
                { key: 'sku_code', value: '商家编码' },
                { key: 'combo_amount', value: '商品金额' },
                { key: 'create_time', value: '订单提交时间' },
                { key: 'pay_time', value: '支付完成时间' },
              ],
            },
            {
              type_key: 'amount_fields',
              type_value: '订单金额相关字段',
              children_fields: [
                { key: 'platform_discount', value: '平台优惠' },
              ],
            },
            {
              type_key: 'biz_fields',
              type_value: '业务信息',
              children_fields: [
                { key: 'c_biz', value: '流量来源' },
                { key: 'ad_mark', value: '流量类型' },
                { key: 'content_type', value: '流量体裁' },
                { key: 'compass_entrance_code', value: '流量渠道' },
              ],
            },
          ],
        },
      })
    }

    if (String(url).includes('/order/torder/checkIsAllowExport')) {
      return jsonResponse({
        code: 0,
        msg: 'success',
        data: {
          is_allow: true,
          reject_reason: '',
          need_alert: false,
        },
      })
    }

    if (String(url).includes('/order/torder/export')) {
      return jsonResponse({
        code: 0,
        msg: 'success',
        data: { task_id: 'TASK-MIXED-FUND-1' },
      })
    }

    throw new Error(`unexpected fetch: ${url}`)
  }

  const result = await runOrderReplayScript({
    params: {
      data_source: 'official_export_api',
      start_date: '2026-06-03',
      end_date: '2026-06-03',
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'wait_official_export')
  assert.equal(result.meta.shared.official_export_task_id, 'TASK-MIXED-FUND-1')
  assert.equal(result.meta.shared.official_export_dimension, 'PRODUCT_ORDER')
  assert.deepEqual(Array.from(result.meta.shared.official_export_fields), [
    'pid',
    'order_id',
    'create_time',
    'pay_time',
    'product_id',
    'product_name',
    'sku_code',
    'combo_amount',
    'platform_discount',
    'content_type',
    'compass_entrance_code',
    'c_biz',
    'ad_mark',
  ])

  const exportCall = calls.find(call => call.url.includes('/order/torder/export'))
  assert.equal(exportCall.method, 'POST')
  assert.equal(exportCall.body.report_type, 'CUSTOM')
  assert.equal(exportCall.body.report_dimension, 'PRODUCT_ORDER')
  assert.equal(exportCall.body.file_type, 'csv')
  assert.deepEqual(exportCall.body.custom_export_fields, Array.from(result.meta.shared.official_export_fields))
  assert.equal(exportCall.body.create_time_start, 1780416000)
  assert.equal(exportCall.body.create_time_end, 1780502399)
})

test('mixed fund order replay polls official export and replays downloaded CSV rows', async () => {
  const csv = [
    '主订单编号,子订单编号,订单提交时间,商品ID,选购商品,商家编码,商品金额,平台优惠,流量体裁,流量渠道,流量来源,流量类型',
    'SO-DL-001,IO-DL-001,2026-06-03 15:00:00,P-DL,森马下载商品,SEMIR-DL,66.66,平台新人首单惊喜券,商品卡,搜索,商城,自然流量',
  ].join('\n')

  const fetchImpl = async url => {
    if (String(url).includes('/order/torder/queryDownloadStatus')) {
      return jsonResponse({
        code: 0,
        data: {
          task_list: [
            { task_id: 'TASK-DOWNLOAD-1', status: 2, estimate_finish_time: 0 },
          ],
        },
      })
    }

    if (String(url).includes('/order/torder/exportHistory/downloadfile')) {
      return textResponse(csv)
    }

    throw new Error(`unexpected fetch: ${url}`)
  }

  const result = await runOrderReplayScript({
    phase: 'wait_official_export',
    shared: {
      official_export_task_id: 'TASK-DOWNLOAD-1',
      official_export_fields: [
        'pid',
        'order_id',
        'create_time',
        'product_id',
        'product_name',
        'sku_code',
        'combo_amount',
        'platform_discount',
        'content_type',
        'compass_entrance_code',
        'c_biz',
        'ad_mark',
      ],
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.shared.data_source, 'official_export_api')
  assert.equal(result.meta.shared.mixed_fund_rows, 1)

  const detail = result.data.find(row => row.__sheet_name === '混资订单明细')
  assert.equal(detail.订单号, 'SO-DL-001')
  assert.equal(detail.匹配活动名称, '【混资货品补贴-长周期】商家灵活出资，平台至高5倍对补')
  assert.equal(detail.流量体裁, '商品卡')
  assert.equal(detail.流量渠道, '搜索')
})

test('mixed fund order replay can collect order list rows from Douyin searchlist as a fallback without export fields', async () => {
  const calls = []
  const fetchImpl = async url => {
    calls.push(String(url))
    if (String(url).includes('/api/order/searchlist')) {
      return jsonResponse({
        code: 0,
        data: [
          {
            shop_order_id: 'SO-API-1',
            create_time: 1780473600,
            pay_amount: 12345,
            promotion_amount: 1200,
            promotion_pay_amount: 11145,
            c_biz: '商城推荐',
            product_item: [
              {
                product_id: 'P-API',
                item_order_id: 'IO-API-1',
                product_name: '接口商品',
                merchant_sku_code: 'API-SKU',
              },
            ],
          },
        ],
        total: 1,
      })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  const result = await runOrderReplayScript({
    params: { data_source: 'api', page_size: 10, max_pages: 1 },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.shared.order_rows, 1)
  assert.equal(result.meta.shared.mixed_fund_rows, 0)
  assert.equal(result.meta.shared.export_fields_present, false)
  assert.match(result.meta.shared.field_note, /平台优惠/)
  assert.equal(calls.filter(url => url.includes('/api/order/searchlist')).length, 1)
})
