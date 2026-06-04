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
  phase = 'main',
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
  }
  context.globalThis = context
  context.window.fetch = (...args) => context.fetch(...args)
  return vm.runInNewContext(source, context, { filename: scriptPath })
}

async function runSignupWorkflow(options = {}) {
  let phase = options.phase || 'main'
  let shared = { ...(options.shared || {}) }
  const data = []

  for (let index = 0; index < 2000; index += 1) {
    const result = await runScript({
      ...options,
      phase,
      shared,
    })
    if (result.data?.length) data.push(...result.data)
    const meta = result.meta || {}
    if (meta.shared) shared = meta.shared
    const action = meta.action || 'complete'
    if (action === 'next_phase') {
      phase = meta.next_phase
      continue
    }
    if (action === 'complete' && meta.has_more) {
      continue
    }
    return {
      ...result,
      data,
      meta: {
        ...meta,
        shared,
      },
    }
  }

  throw new Error(`signup workflow did not complete, last phase=${phase}`)
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
    setTimeout,
    clearTimeout,
  }
  context.globalThis = context
  context.window.fetch = (...args) => context.fetch(...args)
  return vm.runInNewContext(source, context, { filename: scriptPath })
}

async function runOrderReplayWorkflow(options = {}) {
  let phase = options.phase || 'main'
  let shared = { ...(options.shared || {}) }
  const data = []

  for (let index = 0; index < 2000; index += 1) {
    const result = await runOrderReplayScript({
      ...options,
      phase,
      shared,
    })
    if (result.data?.length) data.push(...result.data)
    const meta = result.meta || {}
    if (meta.shared) shared = meta.shared
    const action = meta.action || 'complete'
    if (action === 'next_phase') {
      phase = meta.next_phase
      continue
    }
    return {
      ...result,
      data,
      meta: {
        ...meta,
        shared,
      },
    }
  }

  throw new Error(`workflow did not complete, last phase=${phase}`)
}

async function runAuthCheck({
  href = 'https://fxg.jinritemai.com/ffa/merchant/campaign-square',
  bodyText = '子活动详情 活动广场',
  cookie = '',
} = {}) {
  const scriptPath = path.resolve('adapters/doudian-ops-assistant/auth_check.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const location = new URL(href)
  const context = {
    window: {},
    document: {
      body: new FakeElement(bodyText),
      cookie,
    },
    location,
    console,
    String,
    RegExp,
  }
  context.globalThis = context
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

test('doudian mixed fund manifest hides keyword/export-probe options and uses line-list custom entrances', () => {
  const manifest = fs.readFileSync(path.resolve('adapters/doudian-ops-assistant/manifest.yaml'), 'utf8')

  assert.equal(manifest.includes('id: activity_keywords'), false)
  assert.equal(manifest.includes('label: 活动关键词'), false)
  assert.equal(manifest.includes('id: activity_scope'), false)
  assert.equal(manifest.includes('label: 活动范围'), false)
  assert.equal(manifest.includes('value: official_export_api'), false)
  assert.equal(manifest.includes('label: 自动创建官方导出任务'), false)
  assert.equal(manifest.includes('value: api'), false)
  assert.equal(manifest.includes('label: 订单列表 API 探查'), false)
  assert.equal((manifest.match(/id: custom_activities/g) || []).length, 2)
  assert.equal((manifest.match(/type: line_list/g) || []).length, 0)
  assert.equal((manifest.match(/ui_variant: line_list/g) || []).length, 2)
  assert.equal(manifest.includes('id: start_date'), false)
  assert.equal(manifest.includes('id: end_date'), false)
  assert.equal((manifest.match(/id: date_range/g) || []).length, 1)
  assert.match(manifest, /label: 数据时间范围/)
  assert.match(manifest, /复制链接或[者]?活动ID/)
})

test('mixed fund order replay accepts date range picker params for replay period', async () => {
  const rows = [
    {
      店铺名称: '森马官方旗舰店',
      主订单编号: 'SO-DATE-RANGE',
      子订单编号: 'IO-DATE-RANGE',
      下单时间: '2026-06-03 10:00:00',
      商品ID: 'P-DATE-RANGE',
      商品名称: '日期筛选商品',
      商家编码: 'SEMIR-DATE-RANGE',
      成交金额: '88.88',
      平台优惠: '平台老朋友惊喜券',
    },
  ]

  const result = await runOrderReplayScript({
    params: {
      order_file: { rows, filename: '官方订单导出.csv' },
      date_range: { start: '2026-06-01', end: '2026-06-30' },
      surprise_coupon_activity: 'mall_long_term',
    },
  })

  assert.equal(result.success, true)
  const overall = result.data.find(row => row.__sheet_name === '复盘总览')
  assert.equal(overall.数据周期, '2026-06-01 至 2026-06-30')
  assert.equal(result.meta.shared.mixed_fund_rows, 1)
})

test('mixed fund signup monitor accepts custom entrance rows as one-link line list', async () => {
  const customActivityId = '8888888888888888888'
  const detailCalls = []
  const result = await runSignupWorkflow({
    params: {
      custom_activities: [
        `https://fxg.jinritemai.com/ffa/merchant/child-campaign-detail?id=${customActivityId}&from=operation_seller_link`,
      ],
      include_details: true,
      detail_pages_per_step: 1,
    },
    fetchImpl: async (url, options = {}) => {
      if (String(url).includes('/mmc/activity/seller_activity_feed')) {
        return jsonResponse({ code: 0, data: { total: 0, data: [] } })
      }
      if (String(url).includes('/mmc/apply/all_product_list')) {
        const parsedBody = JSON.parse(options.body)
        detailCalls.push(parsedBody.activity_id)
        return jsonResponse({
          code: 0,
          data: {
            total: 1,
            list: [{
              product_id: 'P-LINK',
              product_name: '链接清单商品',
              shop_id: 'S1',
              apply_success_time: 1767225600,
              status_desc: '已报名',
            }],
          },
        })
      }
      throw new Error(`unexpected url ${url}`)
    },
  })

  assert.equal(result.meta.shared.target_activity_ids, customActivityId)
  assert.deepEqual(detailCalls, [customActivityId])
  const summary = result.data.find(row => row.__sheet_name === '报名汇总')
  assert.equal(summary.活动ID, customActivityId)
  assert.equal(summary.活动链接, `https://fxg.jinritemai.com/ffa/merchant/child-campaign-detail?id=${customActivityId}&from=operation_seller_link`)
})

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
              status_for_business: 8,
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

  const result = await runSignupWorkflow({
    params: { include_details: true },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.has_more, false)
  assert.equal(result.meta.shared.activity_count, 3)
  assert.equal(result.meta.shared.sub_activity_count, 4)
  assert.equal(result.meta.shared.applied_product_total, 6)
  assert.equal(result.data.filter(row => row.__sheet_name === '报名汇总').length, 4)
  assert.equal(result.data.filter(row => row.__sheet_name === '报名商品明细').length, 3)
  assert.equal(result.data.some(row => row.活动ID === '7535005095579222310'), false)
  assert.equal(result.data.some(row => row.活动ID === '7554013743270347034'), true)

  const highValue = result.data.find(row => row.活动ID === '7631472587859837230' && row.__sheet_name === '报名汇总')
  assert.equal(highValue.父活动名称, '【混资货品补贴-长周期】商家灵活出资，平台至高5倍对补')
  assert.equal(highValue.活动名称, '【高客单商品必报】优质用户混资货补')
  assert.equal(highValue.报名商品数, 1)
  assert.equal(highValue.品牌, '森马')
  assert.equal(highValue.店铺名称, '森马官方旗舰店')

  const detail = result.data.find(row => row.活动ID === '7610636843016552714' && row.__sheet_name === '报名商品明细')
  assert.equal(detail.活动名称, '🔥全品类爆发！推荐卡混资活动报名入口')
  assert.equal(detail.商品ID, '7610636843016552714-ITEM')
  assert.equal(detail.报名状态, '报名成功')

  const productCalls = calls.filter(call => call.url.includes('/mmc/apply/all_product_list'))
  assert.equal(productCalls.length, 7)
  assert.equal(productCalls[0].body.size, 50)
  assert.equal(productCalls[0].body.product_cond.status_type, 1)
  assert.deepEqual(productCalls[0].body.product_cond.status_list, [8])
  assert.equal(productCalls[0].body.product_cond.only_bargain, undefined)
  assert.equal(productCalls[0].body.filter_condition.filter_applied, false)
  assert.equal(productCalls[0].body.filter_condition.filter_not_applied, true)
  assert.equal(productCalls[0].body.filter_condition.need_product_stock_warning_info, true)
})

test('mixed fund signup monitor defaults to current four mixed-fund entrances and fetches details to the API end', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const parsedBody = init.body ? JSON.parse(String(init.body)) : {}
    calls.push({ url: String(url), body: parsedBody })

    if (String(url).includes('/mmc/activity/seller_activity_feed')) {
      return jsonResponse(activityFeedPayload())
    }

    if (String(url).includes('/mmc/apply/all_product_list')) {
      const activityId = parsedBody.activity_id
      const page = Number(parsedBody.page || 1)
      const totals = {
        '7611436032944275738': 1,
        '7631472587859837230': 1,
        '7554013743270347034': 3,
        '7610636843016552714': 1,
        '7535005095579222310': 9,
      }
      const total = totals[activityId] || 0
      const product = page <= total
        ? [{
            applied_product_info: {
              activity_id: activityId,
              item_id: `${activityId}-ITEM-${page}`,
              item_name: `${activityId}-报名商品${page}`,
              shop_id: '1332411',
              apply_success_at: 1780530000,
              status: 200,
              item_info: {
                product_id: `${activityId}-P-${page}`,
                outer_id: `SEMIR-SKU-${page}`,
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

  const result = await runSignupWorkflow({
    params: { include_details: true, detail_page_size: 1, detail_pages_per_step: 1 },
    fetchImpl,
  })

  assert.equal(result.success, true)
  const summaryIds = result.data
    .filter(row => row.__sheet_name === '报名汇总')
    .map(row => row.活动ID)
    .sort()
  assert.equal(summaryIds.join(','), '7554013743270347034,7610636843016552714,7611436032944275738,7631472587859837230')
  assert.equal(result.meta.shared.sub_activity_count, 4)
  assert.equal(result.data.some(row => row.活动ID === '7535005095579222310'), false)

  const longTerm = result.data.find(row => row.__sheet_name === '报名汇总' && row.活动ID === '7554013743270347034')
  assert.equal(longTerm.活动名称, '必报！抖音商城混资券长期报名入口【商家出资5%】')
  assert.equal(longTerm.优惠券名称, '平台惊喜XX折券')
  assert.match(longTerm.活动链接, /7554013743270347034/)

  const longTermDetails = result.data.filter(row => row.__sheet_name === '报名商品明细' && row.活动ID === '7554013743270347034')
  assert.equal(longTermDetails.length, 3)

  const longTermPages = calls
    .filter(call => call.url.includes('/mmc/apply/all_product_list') && call.body.activity_id === '7554013743270347034')
    .map(call => Number(call.body.page))
  assert.deepEqual(longTermPages, [1, 2, 3])
})

test('mixed fund signup monitor uses custom activity list to add and delete entrances', async () => {
  const calls = []
  const customActivityId = '8888888888888888888'
  const fetchImpl = async (url, init = {}) => {
    const parsedBody = init.body ? JSON.parse(String(init.body)) : {}
    calls.push({ url: String(url), body: parsedBody })

    if (String(url).includes('/mmc/activity/seller_activity_feed')) {
      return jsonResponse(activityFeedPayload())
    }

    if (String(url).includes('/mmc/apply/all_product_list')) {
      assert.equal(parsedBody.activity_id, customActivityId)
      return jsonResponse({
        code: 0,
        msg: 'success',
        data: {
          total: 1,
          product_list: [
            {
              applied_product_info: {
                activity_id: customActivityId,
                item_id: 'P-CUSTOM-SIGNUP',
                item_name: '自定义活动报名商品',
                outer_id: 'SKU-CUSTOM-SIGNUP',
                shop_id: '1332411',
                apply_success_at: 1780530000,
                status_for_business: 8,
              },
            },
          ],
        },
      })
    }

    throw new Error(`unexpected fetch: ${url}`)
  }

  const result = await runSignupWorkflow({
    params: {
      include_details: true,
      activity_scope: 'custom',
      custom_activities: `${customActivityId} | 自定义商城混资入口 | 7777777777777777777 | 自定义父活动 | 平台自定义券 | https://fxg.jinritemai.com/ffa/merchant/child-campaign-detail?id=${customActivityId}`,
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.shared.sub_activity_count, 1)
  assert.equal(result.meta.shared.target_activity_ids, customActivityId)
  assert.equal(result.data.some(row => row.活动ID === '7631472587859837230'), false)

  const summary = result.data.find(row => row.__sheet_name === '报名汇总')
  assert.equal(summary.活动ID, customActivityId)
  assert.equal(summary.活动名称, '自定义商城混资入口')
  assert.equal(summary.父活动名称, '自定义父活动')
  assert.equal(summary.优惠券名称, '平台自定义券')

  const productCallIds = calls
    .filter(call => call.url.includes('/mmc/apply/all_product_list'))
    .map(call => call.body.activity_id)
  assert.deepEqual(Array.from(new Set(productCallIds)), [customActivityId])
})

test('mixed fund signup monitor batches detail API pages to avoid long single evaluations', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const parsedBody = init.body ? JSON.parse(String(init.body)) : {}
    calls.push({ url: String(url), body: parsedBody })
    if (String(url).includes('/mmc/activity/seller_activity_feed')) {
      return jsonResponse(activityFeedPayload())
    }
    if (String(url).includes('/mmc/apply/all_product_list')) {
      const activityId = parsedBody.activity_id
      const page = Number(parsedBody.page || 1)
      const total = activityId === '7631472587859837230' ? 3 : 0
      const product = page <= total
        ? [{
            applied_product_info: {
              item_id: `${activityId}-ITEM-${page}`,
              item_name: `报名商品${page}`,
              apply_success_at: 1780530000,
              status_for_business: 8,
            },
          }]
        : []
      return jsonResponse({
        code: 0,
        msg: 'success',
        data: { total, product_list: product },
      })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  const first = await runScript({
    params: { include_details: true, detail_page_size: 1, detail_pages_per_step: 1 },
    fetchImpl,
  })

  assert.equal(first.success, true)
  assert.equal(first.meta.has_more, true)
  assert.equal(first.meta.shared.activity_index, 0)
  assert.equal(first.meta.shared.product_page, 2)
  assert.equal(first.data.filter(row => row.__sheet_name === '报名商品明细').length, 1)

  const second = await runScript({
    params: { include_details: true, detail_page_size: 1, detail_pages_per_step: 1 },
    shared: first.meta.shared,
    fetchImpl,
  })

  assert.equal(second.success, true)
  assert.equal(second.meta.has_more, true)
  assert.equal(second.meta.shared.product_page, 3)
  const highValueCalls = calls
    .filter(call => call.url.includes('/mmc/apply/all_product_list') && call.body.activity_id === '7631472587859837230')
    .map(call => Number(call.body.page))
  assert.deepEqual(highValueCalls, [1, 2])
})

test('mixed fund signup monitor reads concrete shop name instead of navigation labels', async () => {
  const fetchImpl = async (url, init = {}) => {
    if (String(url).includes('/mmc/activity/seller_activity_feed')) return jsonResponse(activityFeedPayload())
    if (String(url).includes('/mmc/apply/all_product_list')) {
      return jsonResponse({ code: 0, msg: 'success', data: { total: 0, product_list: [] } })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  const result = await runSignupWorkflow({
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

test('mixed fund order replay attributes mixed fund orders through Douyin order detail API without export files', async () => {
  const calls = []
  const fetchImpl = async url => {
    calls.push(String(url))

    if (String(url).includes('/api/order/searchlist')) {
      return jsonResponse({
        code: 0,
        data: [
          {
            shop_order_id: 'SO-DETAIL-1',
            create_time: 1780473600,
            pay_amount: 11223,
            promotion_amount: 0,
            total_price: 12900,
            b_type_desc: '抖音',
            c_biz_desc: '小店自卖',
            product_item: [
              {
                item_order_id: 'IO-DETAIL-1',
                product_id: 'P-DETAIL',
                product_name: '森马详情接口商品',
                merchant_sku_code: 'SEMIR-DETAIL',
                combo_amount: 12900,
                pay_amount: 11223,
              },
            ],
          },
          {
            shop_order_id: 'SO-DETAIL-2',
            create_time: 1780477200,
            pay_amount: 6900,
            promotion_amount: 0,
            b_type_desc: '抖音',
            c_biz_desc: '小店自卖',
            product_item: [
              {
                item_order_id: 'IO-DETAIL-2',
                product_id: 'P-NORMAL',
                product_name: '普通商品',
                merchant_sku_code: 'SEMIR-NORMAL',
                pay_amount: 6900,
              },
            ],
          },
        ],
        total: 2,
      })
    }

    if (String(url).includes('/api/order/detail')) {
      return jsonResponse({
        code: 0,
        data: {
          order: {
            shop_order_id: 'SO-DETAIL-1',
            order_id: 'SO-DETAIL-1',
            create_time: 1780473600,
            pay_amount: 11223,
            b_type_desc: '抖音',
            c_biz_desc: '小店自卖',
            promotion_detail: {
              shop_discount: [
                {
                  amount: -638,
                  type_desc: '平台折扣券',
                  name: '平台惊喜8.7折券',
                  amount_desc: '-￥6.38',
                },
              ],
              platform_discount: [
                {
                  amount: -1039,
                  type_desc: '平台折扣券',
                  name: '平台惊喜8.7折券',
                  amount_desc: '-￥10.39',
                },
              ],
              kol_discount: [],
              third_discount: null,
            },
            product_item: [
              {
                item_order_id: 'IO-DETAIL-1',
                product_id: 'P-DETAIL',
                product_name: '森马详情接口商品',
                merchant_sku_code: 'SEMIR-DETAIL',
                pay_amount: 11223,
              },
            ],
          },
          promotion_detail: {
            platform_discount: [
              {
                amount: -1039,
                type_desc: '平台折扣券',
                name: '平台惊喜8.7折券',
                amount_desc: '-￥10.39',
              },
            ],
          },
          promotion: [
            {
              label: '平台惊喜8.7折券',
              value: '-¥10.39',
              extra_info_map: { activity_creator_desc: '平台优惠' },
            },
          ],
        },
      })
    }

    throw new Error(`unexpected fetch: ${url}`)
  }

  const result = await runOrderReplayWorkflow({
    params: {
      data_source: 'detail_api',
      auto_signup_match: [],
      page_size: 10,
      surprise_coupon_activity: 'mall_long_term',
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.shared.data_source, 'detail_api')
  assert.equal(result.meta.shared.order_rows, 2)
  assert.equal(result.meta.shared.detail_api_orders, 1)
  assert.equal(result.meta.shared.mixed_fund_rows, 1)
  assert.equal(result.meta.shared.coupon_fields_present, true)
  assert.equal(result.meta.shared.traffic_fields_present, false)
  assert.match(result.meta.shared.field_note, /订单详情 API 已返回平台优惠/)

  const detail = result.data.find(row => row.__sheet_name === '混资订单明细')
  assert.equal(detail.订单号, 'SO-DETAIL-1')
  assert.equal(detail.子订单号, 'IO-DETAIL-1')
  assert.equal(detail.商品ID, 'P-DETAIL')
  assert.equal(detail.成交金额, 112.23)
  assert.match(detail.平台优惠, /平台惊喜8.7折券/)
  assert.equal(detail.匹配活动ID, '7554013743270347034')
  assert.match(detail.匹配依据, /平台惊喜.*默认归属/)
  assert.equal(detail.流量来源, '小店自卖')
  assert.equal(detail.流量类型, '抖音')

  const overall = result.data.find(row => row.__sheet_name === '复盘总览')
  assert.equal(overall.全店引导成交金额, 181.23)
  assert.equal(overall.混资成交金额, 112.23)
  assert.match(overall.备注, /订单详情 API 已返回平台优惠/)
  assert.equal(calls.filter(url => url.includes('/api/order/searchlist')).length, 1)
  assert.equal(calls.filter(url => url.includes('/api/order/detail')).length, 1)
})

test('mixed fund order replay defaults to one-flow detail API when no data source is selected', async () => {
  const calls = []
  const fetchImpl = async url => {
    calls.push(String(url))

    if (String(url).includes('/api/order/searchlist')) {
      return jsonResponse({
        code: 0,
        data: [
          {
            shop_order_id: 'SO-DEFAULT-DETAIL',
            create_time: 1780473600,
            pay_amount: 9900,
            promotion_amount: 1000,
            total_price: 10900,
            product_item: [
              {
                item_order_id: 'IO-DEFAULT-DETAIL',
                product_id: 'P-DEFAULT',
                product_name: '默认详情商品',
                merchant_sku_code: 'SEMIR-DEFAULT',
                pay_amount: 9900,
              },
            ],
          },
        ],
        total: 1,
      })
    }

    if (String(url).includes('/api/order/detail')) {
      return jsonResponse({
        code: 0,
        data: {
          order: {
            shop_order_id: 'SO-DEFAULT-DETAIL',
            create_time: 1780473600,
            pay_amount: 9900,
            promotion_detail: {
              platform_discount: [
                {
                  type_desc: '平台优惠券',
                  name: '平台老朋友惊喜券',
                  amount_desc: '-￥10.00',
                },
              ],
            },
            product_item: [
              {
                item_order_id: 'IO-DEFAULT-DETAIL',
                product_id: 'P-DEFAULT',
                product_name: '默认详情商品',
                merchant_sku_code: 'SEMIR-DEFAULT',
                pay_amount: 9900,
              },
            ],
          },
        },
      })
    }

    throw new Error(`unexpected fetch: ${url}`)
  }

  const result = await runOrderReplayWorkflow({
    params: {
      auto_signup_match: [],
      page_size: 10,
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.shared.data_source, 'detail_api')
  assert.equal(result.meta.shared.mixed_fund_rows, 1)
  assert.equal(calls.some(url => url.includes('/api/order/detail')), true)
})

test('mixed fund order replay one-flow collects signup products before detail attribution', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const parsedBody = init.body ? JSON.parse(String(init.body)) : {}
    calls.push({ url: String(url), body: parsedBody })

    if (String(url).includes('/mmc/activity/seller_activity_feed')) {
      return jsonResponse(activityFeedPayload())
    }

    if (String(url).includes('/mmc/apply/all_product_list')) {
      const activityId = parsedBody.activity_id
      const productList = activityId === '7610636843016552714'
        ? [
            {
              applied_product_info: {
                activity_id: activityId,
                item_id: 'P-ONEFLOW-RECOMMEND',
                item_name: '推荐卡报名商品',
                outer_id: 'SEMIR-ONEFLOW',
                shop_id: '1332411',
                apply_success_at: 1780530000,
                status: 200,
              },
            },
          ]
        : []
      return jsonResponse({
        code: 0,
        msg: 'success',
        data: {
          total: productList.length,
          product_list: productList,
        },
      })
    }

    if (String(url).includes('/api/order/searchlist')) {
      return jsonResponse({
        code: 0,
        data: [
          {
            shop_order_id: 'SO-ONEFLOW-1',
            create_time: 1780473600,
            pay_amount: 18800,
            promotion_amount: 1200,
            total_price: 20000,
            product_item: [
              {
                item_order_id: 'IO-ONEFLOW-1',
                product_id: 'P-ONEFLOW-RECOMMEND',
                product_name: '推荐卡报名商品',
                merchant_sku_code: 'SEMIR-ONEFLOW',
                pay_amount: 18800,
              },
            ],
          },
        ],
        total: 1,
      })
    }

    if (String(url).includes('/api/order/detail')) {
      return jsonResponse({
        code: 0,
        data: {
          order: {
            shop_order_id: 'SO-ONEFLOW-1',
            create_time: 1780473600,
            pay_amount: 18800,
            promotion_detail: {
              platform_discount: [
                {
                  type_desc: '平台折扣券',
                  name: '平台惊喜8.5折券',
                  amount_desc: '-￥12.00',
                },
              ],
            },
            product_item: [
              {
                item_order_id: 'IO-ONEFLOW-1',
                product_id: 'P-ONEFLOW-RECOMMEND',
                product_name: '推荐卡报名商品',
                merchant_sku_code: 'SEMIR-ONEFLOW',
                pay_amount: 18800,
              },
            ],
          },
        },
      })
    }

    throw new Error(`unexpected fetch: ${url}`)
  }

  const result = await runOrderReplayWorkflow({
    params: {
      data_source: 'detail_api',
      auto_signup_match: ['true'],
      include_signup_snapshot: ['true'],
      page_size: 10,
      detail_page_size: 50,
      surprise_coupon_activity: 'mall_long_term',
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.shared.signup_auto_collected, true)
  assert.equal(result.meta.shared.signup_match_rows, 1)
  assert.equal(result.meta.shared.surprise_signup_matched_rows, 1)

  const detail = result.data.find(row => row.__sheet_name === '混资订单明细')
  assert.equal(detail.匹配活动ID, '7610636843016552714')
  assert.equal(detail.匹配依据, '平台惊喜折券 + 报名商品匹配')

  const signupDetail = result.data.find(row => row.__sheet_name === '报名商品明细')
  assert.equal(signupDetail.活动ID, '7610636843016552714')
  assert.equal(signupDetail.商品ID, 'P-ONEFLOW-RECOMMEND')
  const signupProductCall = calls.find(call => call.url.includes('/mmc/apply/all_product_list'))
  assert.deepEqual(signupProductCall.body.product_cond.status_list, [8])
  assert.equal(signupProductCall.body.product_cond.only_bargain, undefined)
  assert.equal(signupProductCall.body.filter_condition.filter_applied, false)
  assert.equal(signupProductCall.body.filter_condition.filter_not_applied, true)
  const signupActivityIds = Array.from(new Set(
    calls
      .filter(call => call.url.includes('/mmc/apply/all_product_list'))
      .map(call => call.body.activity_id)
  )).sort()
  assert.deepEqual(signupActivityIds, [
    '7554013743270347034',
    '7610636843016552714',
    '7611436032944275738',
    '7631472587859837230',
  ])
  assert.equal(signupActivityIds.includes('7535005095579222310'), false)
  assert.equal(calls.some(call => call.url.includes('/mmc/activity/seller_activity_feed')), true)
  assert.equal(calls.some(call => call.url.includes('/api/order/detail')), true)
})

test('mixed fund order replay one-flow paginates signup activities and products to the real end', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const parsedBody = init.body ? JSON.parse(String(init.body)) : {}
    calls.push({ url: String(url), body: parsedBody })

    if (String(url).includes('/mmc/activity/seller_activity_feed')) {
      const page = Number(parsedBody.page || 1)
      if (page === 1) {
        return jsonResponse({
          code: 0,
          data: {
            total: 2,
            data: [
              {
                sub_acts: [
                  {
                    activity_id: '7610636843016552714',
                    activity_name: '🔥全品类爆发！推荐卡混资活动报名入口',
                  },
                ],
              },
            ],
          },
        })
      }
      if (page === 2) {
        return jsonResponse({
          code: 0,
          data: {
            total: 2,
            data: [
              {
                sub_acts: [
                  {
                    activity_id: '7554013743270347034',
                    activity_name: '必报！抖音商城混资券长期报名入口【商家出资5%】',
                  },
                ],
              },
            ],
          },
        })
      }
      return jsonResponse({ code: 0, data: { total: 2, data: [] } })
    }

    if (String(url).includes('/mmc/apply/all_product_list')) {
      const activityId = parsedBody.activity_id
      const page = Number(parsedBody.page || 1)
      if (activityId === '7610636843016552714') {
        const productList = page <= 3
          ? [
              {
                applied_product_info: {
                  activity_id: activityId,
                  item_id: `P-PAGED-${page}`,
                  item_name: `推荐卡报名商品${page}`,
                  outer_id: `SKU-PAGED-${page}`,
                  status: 200,
                },
              },
            ]
          : []
        return jsonResponse({ code: 0, data: { total: 3, product_list: productList } })
      }
      return jsonResponse({ code: 0, data: { total: 0, product_list: [] } })
    }

    if (String(url).includes('/api/order/searchlist')) {
      return jsonResponse({
        code: 0,
        data: [
          {
            shop_order_id: 'SO-PAGED-SIGNUP',
            create_time: 1777622400,
            pay_amount: 10000,
            promotion_amount: 1000,
            total_price: 11000,
            product_item: [
              {
                item_order_id: 'IO-PAGED-SIGNUP',
                product_id: 'P-PAGED-3',
                product_name: '推荐卡报名商品3',
                merchant_sku_code: 'SKU-PAGED-3',
                pay_amount: 10000,
              },
            ],
          },
        ],
        total: 1,
      })
    }

    if (String(url).includes('/api/order/detail')) {
      return jsonResponse({
        code: 0,
        data: {
          order: {
            shop_order_id: 'SO-PAGED-SIGNUP',
            create_time: 1777622400,
            pay_amount: 10000,
            promotion_detail: {
              platform_discount: [
                {
                  name: '平台惊喜8.5折券',
                  type_desc: '平台折扣券',
                },
              ],
            },
            product_item: [
              {
                item_order_id: 'IO-PAGED-SIGNUP',
                product_id: 'P-PAGED-3',
                product_name: '推荐卡报名商品3',
                merchant_sku_code: 'SKU-PAGED-3',
                pay_amount: 10000,
              },
            ],
          },
        },
      })
    }

    throw new Error(`unexpected fetch: ${url}`)
  }

  const result = await runOrderReplayWorkflow({
    params: {
      data_source: 'detail_api',
      auto_signup_match: ['true'],
      include_signup_snapshot: ['true'],
      activity_keywords: '混资',
      start_date: '2026-05-01',
      end_date: '2026-05-31',
      page_size: 20,
      detail_page_size: 1,
      surprise_coupon_activity: 'mall_long_term',
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.shared.signup_sub_activity_count, 4)
  assert.equal(result.meta.shared.signup_auto_detail_rows, 3)
  assert.equal(result.meta.shared.signup_match_rows, 3)
  assert.equal(result.meta.shared.surprise_signup_matched_rows, 1)

  const detail = result.data.find(row => row.__sheet_name === '混资订单明细')
  assert.equal(detail.匹配活动ID, '7610636843016552714')
  assert.equal(detail.匹配依据, '平台惊喜折券 + 报名商品匹配')

  const activityPages = calls
    .filter(call => call.url.includes('/mmc/activity/seller_activity_feed'))
    .map(call => Number(call.body.page))
  assert.deepEqual(activityPages, [1, 2])

  const productPages = calls
    .filter(call => call.url.includes('/mmc/apply/all_product_list') && call.body.activity_id === '7610636843016552714')
    .map(call => Number(call.body.page))
  assert.deepEqual(productPages, [1, 2, 3])
})

test('mixed fund order replay fetches all order pages and all promoted order details within date range', async () => {
  const calls = []
  const fetchImpl = async url => {
    const textUrl = String(url)
    calls.push(textUrl)
    const parsed = new URL(textUrl, 'https://fxg.jinritemai.com')

    if (textUrl.includes('/api/order/searchlist')) {
      const page = Number(parsed.searchParams.get('page') || 0)
      assert.equal(parsed.searchParams.get('create_time_start'), '1777564800')
      assert.equal(parsed.searchParams.get('create_time_end'), '1780243199')
      const order = page < 3
        ? {
            shop_order_id: `SO-MAY-${page + 1}`,
            create_time: 1777622400 + page,
            pay_amount: 10000 + page,
            promotion_amount: 100,
            total_price: 11000 + page,
            product_item: [
              {
                item_order_id: `IO-MAY-${page + 1}`,
                product_id: `P-MAY-${page + 1}`,
                product_name: `5月商品${page + 1}`,
                merchant_sku_code: `SKU-MAY-${page + 1}`,
                pay_amount: 10000 + page,
              },
            ],
          }
        : null
      return jsonResponse({
        code: 0,
        data: order ? [order] : [],
        total: 3,
      })
    }

    if (textUrl.includes('/api/order/detail')) {
      const id = parsed.searchParams.get('order_id')
      const index = Number(id.replace('SO-MAY-', ''))
      return jsonResponse({
        code: 0,
        data: {
          order: {
            shop_order_id: id,
            create_time: 1777622400 + index,
            pay_amount: 10000 + index,
            promotion_detail: {
              platform_discount: [
                {
                  name: '平台老朋友惊喜券',
                  type_desc: '平台优惠券',
                },
              ],
            },
            product_item: [
              {
                item_order_id: `IO-MAY-${index}`,
                product_id: `P-MAY-${index}`,
                product_name: `5月商品${index}`,
                merchant_sku_code: `SKU-MAY-${index}`,
                pay_amount: 10000 + index,
              },
            ],
          },
        },
      })
    }

    throw new Error(`unexpected fetch: ${url}`)
  }

  const result = await runOrderReplayWorkflow({
    params: {
      data_source: 'detail_api',
      auto_signup_match: [],
      start_date: '2026-05-01',
      end_date: '2026-05-31',
      page_size: 1,
      order_window_days: 31,
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.shared.order_rows, 3)
  assert.equal(result.meta.shared.detail_api_orders, 3)
  assert.equal(result.meta.shared.mixed_fund_rows, 3)
  assert.equal(calls.filter(url => url.includes('/api/order/searchlist')).length, 3)
  assert.equal(calls.filter(url => url.includes('/api/order/detail')).length, 3)
})

test('mixed fund order replay scans date-range orders without signup product filters while using signup for attribution', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const textUrl = String(url)
    const parsedBody = init.body ? JSON.parse(String(init.body)) : {}
    calls.push({ url: textUrl, body: parsedBody })
    const parsed = new URL(textUrl, 'https://fxg.jinritemai.com')

    if (textUrl.includes('/mmc/activity/seller_activity_feed')) {
      return jsonResponse({
        code: 0,
        data: {
          total: 1,
          data: [
            {
              sub_acts: [
                {
                  activity_id: '7610636843016552714',
                  activity_name: '🔥全品类爆发！推荐卡混资活动报名入口',
                },
              ],
            },
          ],
        },
      })
    }

    if (textUrl.includes('/mmc/apply/all_product_list')) {
      return jsonResponse({
        code: 0,
        data: {
          total: 1,
          product_list: [
            {
              applied_product_info: {
                activity_id: parsedBody.activity_id,
                item_id: 'P-MATCH',
                item_name: '报名商品',
                outer_id: 'SKU-MATCH',
                status: 200,
              },
            },
            {
              applied_product_info: {
                activity_id: parsedBody.activity_id,
                item_id: 'P-ALSO',
                item_name: '另一个报名商品',
                outer_id: 'SKU-ALSO',
                status: 200,
              },
            },
          ],
        },
      })
    }

    if (textUrl.includes('/api/order/searchlist')) {
      assert.equal(parsed.searchParams.get('product'), null)
      assert.equal(parsed.searchParams.get('art_no'), null)
      return jsonResponse({
        code: 0,
        data: [
          {
            shop_order_id: 'SO-MATCH',
            create_time: 1777622400,
            pay_amount: 9000,
            total_price: 10000,
            product_item: [
              {
                item_order_id: 'IO-MATCH',
                product_id: 'P-MATCH',
                product_name: '报名商品',
                merchant_sku_code: 'SKU-MATCH',
                pay_amount: 9000,
                combo_amount: 10000,
              },
              {
                item_order_id: 'IO-ALSO',
                product_id: 'P-ALSO',
                product_name: '另一个报名商品',
                merchant_sku_code: 'SKU-ALSO',
                pay_amount: 9000,
                combo_amount: 10000,
              },
            ],
          },
          {
            shop_order_id: 'SO-SKIP',
            create_time: 1777622401,
            pay_amount: 8000,
            total_price: 10000,
            product_item: [
              {
                item_order_id: 'IO-SKIP',
                product_id: 'P-SKIP',
                product_name: '未报名商品',
                merchant_sku_code: 'SKU-SKIP',
                pay_amount: 8000,
                combo_amount: 10000,
              },
            ],
          },
        ],
        total: 2,
      })
    }

    if (textUrl.includes('/api/order/detail')) {
      const id = parsed.searchParams.get('order_id')
      if (id === 'SO-SKIP') {
        return jsonResponse({
          code: 0,
          data: {
            order: {
              shop_order_id: id,
              create_time: 1777622401,
              pay_amount: 8000,
              promotion_detail: {
                shop_discount: [
                  {
                    name: '店铺满减',
                    type_desc: '商家优惠',
                  },
                ],
                platform_discount: [],
              },
              product_item: [
                {
                  item_order_id: 'IO-SKIP',
                  product_id: 'P-SKIP',
                  product_name: '未报名商品',
                  merchant_sku_code: 'SKU-SKIP',
                  pay_amount: 8000,
                },
              ],
            },
          },
        })
      }
      assert.equal(id, 'SO-MATCH')
      return jsonResponse({
        code: 0,
        data: {
          order: {
            shop_order_id: id,
            create_time: 1777622400,
            pay_amount: 9000,
            promotion_detail: {
              platform_discount: [
                {
                  name: '平台惊喜8.5折券',
                  type_desc: '平台折扣券',
                },
              ],
            },
            product_item: [
              {
                item_order_id: 'IO-MATCH',
                product_id: 'P-MATCH',
                product_name: '报名商品',
                merchant_sku_code: 'SKU-MATCH',
                pay_amount: 9000,
              },
            ],
          },
        },
      })
    }

    throw new Error(`unexpected fetch: ${url}`)
  }

  const result = await runOrderReplayWorkflow({
    params: {
      data_source: 'detail_api',
      auto_signup_match: ['true'],
      include_signup_snapshot: ['true'],
      activity_keywords: '混资',
      start_date: '2026-05-01',
      end_date: '2026-05-31',
      page_size: 50,
      detail_page_size: 50,
      order_window_days: 31,
      surprise_coupon_activity: 'mall_long_term',
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.shared.order_rows, 3)
  assert.equal(result.meta.shared.order_search_item_count, 0)
  assert.equal(result.meta.shared.detail_api_orders, 2)
  assert.equal(result.meta.shared.mixed_fund_rows, 1)
  assert.equal(calls.filter(call => call.url.includes('/api/order/detail')).length, 2)

  const overall = result.data.find(row => row.__sheet_name === '复盘总览')
  assert.equal(overall.全店引导成交金额, 170)
  assert.equal(overall.混资成交金额, 90)
})

test('mixed fund order replay uses custom activity list for signup attribution in one-flow', async () => {
  const calls = []
  const customActivityId = '8888888888888888888'
  const fetchImpl = async (url, init = {}) => {
    const textUrl = String(url)
    const parsedBody = init.body ? JSON.parse(String(init.body)) : {}
    calls.push({ url: textUrl, body: parsedBody })
    const parsed = new URL(textUrl, 'https://fxg.jinritemai.com')

    if (textUrl.includes('/mmc/activity/seller_activity_feed')) {
      return jsonResponse(activityFeedPayload())
    }

    if (textUrl.includes('/mmc/apply/all_product_list')) {
      assert.equal(parsedBody.activity_id, customActivityId)
      return jsonResponse({
        code: 0,
        data: {
          total: 1,
          product_list: [
            {
              applied_product_info: {
                activity_id: customActivityId,
                item_id: 'P-CUSTOM-ORDER',
                item_name: '自定义归因商品',
                outer_id: 'SKU-CUSTOM-ORDER',
                status: 200,
              },
            },
          ],
        },
      })
    }

    if (textUrl.includes('/api/order/searchlist')) {
      assert.equal(parsed.searchParams.get('product'), null)
      return jsonResponse({
        code: 0,
        data: [
          {
            shop_order_id: 'SO-CUSTOM-ACTIVITY',
            create_time: 1777622400,
            pay_amount: 12300,
            promotion_amount: 1000,
            total_price: 13300,
            product_item: [
              {
                item_order_id: 'IO-CUSTOM-ACTIVITY',
                product_id: 'P-CUSTOM-ORDER',
                product_name: '自定义归因商品',
                merchant_sku_code: 'SKU-CUSTOM-ORDER',
                pay_amount: 12300,
              },
            ],
          },
        ],
        total: 1,
      })
    }

    if (textUrl.includes('/api/order/detail')) {
      const id = parsed.searchParams.get('order_id')
      return jsonResponse({
        code: 0,
        data: {
          order: {
            shop_order_id: id,
            create_time: 1777622400,
            pay_amount: 12300,
            promotion_detail: {
              platform_discount: [
                {
                  name: '平台惊喜8.5折券',
                  type_desc: '平台折扣券',
                },
              ],
            },
            product_item: [
              {
                item_order_id: 'IO-CUSTOM-ACTIVITY',
                product_id: 'P-CUSTOM-ORDER',
                product_name: '自定义归因商品',
                merchant_sku_code: 'SKU-CUSTOM-ORDER',
                pay_amount: 12300,
              },
            ],
          },
        },
      })
    }

    throw new Error(`unexpected fetch: ${url}`)
  }

  const result = await runOrderReplayWorkflow({
    params: {
      data_source: 'detail_api',
      auto_signup_match: ['true'],
      include_signup_snapshot: ['true'],
      activity_scope: 'custom',
      custom_activities: `${customActivityId} | 自定义商城混资入口 | 7777777777777777777 | 自定义父活动 | 平台自定义券 | https://fxg.jinritemai.com/ffa/merchant/child-campaign-detail?id=${customActivityId}`,
      start_date: '2026-05-01',
      end_date: '2026-05-31',
      page_size: 50,
      detail_page_size: 50,
      surprise_coupon_activity: 'mall_long_term',
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.shared.signup_sub_activity_count, 1)
  assert.equal(result.meta.shared.signup_match_rows, 1)
  assert.equal(result.meta.shared.surprise_signup_matched_rows, 1)
  assert.equal(result.meta.shared.mixed_fund_rows, 1)

  const detail = result.data.find(row => row.__sheet_name === '混资订单明细')
  assert.equal(detail.匹配活动ID, customActivityId)
  assert.equal(detail.匹配活动名称, '自定义商城混资入口')
  assert.equal(detail.匹配依据, '平台惊喜折券 + 报名商品匹配')

  const signupSummary = result.data.find(row => row.__sheet_name === '报名汇总')
  assert.equal(signupSummary.活动ID, customActivityId)
  assert.equal(signupSummary.优惠券名称, '平台自定义券')
})

test('mixed fund order replay matches custom activity coupon names in one-flow', async () => {
  const customActivityId = '8888888888888888888'
  const fetchImpl = async (url, init = {}) => {
    const textUrl = String(url)
    const parsedBody = init.body ? JSON.parse(String(init.body)) : {}
    const parsed = new URL(textUrl, 'https://fxg.jinritemai.com')

    if (textUrl.includes('/mmc/activity/seller_activity_feed')) {
      return jsonResponse(activityFeedPayload())
    }

    if (textUrl.includes('/mmc/apply/all_product_list')) {
      assert.equal(parsedBody.activity_id, customActivityId)
      return jsonResponse({
        code: 0,
        data: {
          total: 0,
          product_list: [],
        },
      })
    }

    if (textUrl.includes('/api/order/searchlist')) {
      assert.equal(parsed.searchParams.get('product'), null)
      return jsonResponse({
        code: 0,
        data: [
          {
            shop_order_id: 'SO-CUSTOM-COUPON',
            create_time: 1777622400,
            pay_amount: 9900,
            promotion_amount: 1000,
            product_item: [
              {
                item_order_id: 'IO-CUSTOM-COUPON',
                product_id: 'P-CUSTOM-COUPON',
                product_name: '自定义券商品',
                merchant_sku_code: 'SKU-CUSTOM-COUPON',
                pay_amount: 9900,
              },
            ],
          },
        ],
        total: 1,
      })
    }

    if (textUrl.includes('/api/order/detail')) {
      const id = parsed.searchParams.get('order_id')
      return jsonResponse({
        code: 0,
        data: {
          order: {
            shop_order_id: id,
            create_time: 1777622400,
            pay_amount: 9900,
            promotion_detail: {
              platform_discount: [
                {
                  name: '平台自定义券',
                  type_desc: '平台券',
                },
              ],
            },
            product_item: [
              {
                item_order_id: 'IO-CUSTOM-COUPON',
                product_id: 'P-CUSTOM-COUPON',
                product_name: '自定义券商品',
                merchant_sku_code: 'SKU-CUSTOM-COUPON',
                pay_amount: 9900,
              },
            ],
          },
        },
      })
    }

    throw new Error(`unexpected fetch: ${url}`)
  }

  const result = await runOrderReplayWorkflow({
    params: {
      data_source: 'detail_api',
      auto_signup_match: ['true'],
      include_signup_snapshot: [],
      activity_scope: 'custom',
      custom_activities: `${customActivityId} | 自定义商城混资入口 | 7777777777777777777 | 自定义父活动 | 平台自定义券 | https://fxg.jinritemai.com/ffa/merchant/child-campaign-detail?id=${customActivityId}`,
      start_date: '2026-05-01',
      end_date: '2026-05-31',
      page_size: 50,
      detail_page_size: 50,
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.shared.signup_sub_activity_count, 1)
  assert.equal(result.meta.shared.signup_match_rows, 0)
  assert.equal(result.meta.shared.mixed_fund_rows, 1)

  const detail = result.data.find(row => row.__sheet_name === '混资订单明细')
  assert.equal(detail.匹配活动ID, customActivityId)
  assert.equal(detail.匹配活动名称, '自定义商城混资入口')
  assert.equal(detail.匹配依据, '自定义优惠券名匹配')
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

test('mixed fund order replay retries transient fetch failures from Douyin APIs', async () => {
  const calls = []
  const fetchImpl = async url => {
    calls.push(String(url))
    if (String(url).includes('/api/order/searchlist') && calls.filter(item => item.includes('/api/order/searchlist')).length === 1) {
      throw new Error('Failed to fetch')
    }
    if (String(url).includes('/api/order/searchlist')) {
      return jsonResponse({
        code: 0,
        data: [
          {
            shop_order_id: 'SO-RETRY',
            create_time: 1780473600,
            pay_amount: 9900,
            promotion_amount: 100,
            total_price: 10900,
            product_item: [
              {
                item_order_id: 'IO-RETRY',
                product_id: 'P-RETRY',
                product_name: '重试商品',
                merchant_sku_code: 'SKU-RETRY',
                pay_amount: 9900,
              },
            ],
          },
        ],
        total: 1,
      })
    }
    if (String(url).includes('/api/order/detail')) {
      return jsonResponse({
        code: 0,
        data: {
          order: {
            shop_order_id: 'SO-RETRY',
            create_time: 1780473600,
            pay_amount: 9900,
            promotion_detail: {
              platform_discount: [
                {
                  name: '平台老朋友惊喜券',
                  type_desc: '平台优惠券',
                },
              ],
            },
            product_item: [
              {
                item_order_id: 'IO-RETRY',
                product_id: 'P-RETRY',
                product_name: '重试商品',
                merchant_sku_code: 'SKU-RETRY',
                pay_amount: 9900,
              },
            ],
          },
        },
      })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  const result = await runOrderReplayWorkflow({
    params: {
      data_source: 'detail_api',
      auto_signup_match: [],
      start_date: '2026-06-03',
      end_date: '2026-06-03',
      page_size: 10,
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.shared.mixed_fund_rows, 1)
  assert.equal(calls.filter(url => url.includes('/api/order/searchlist')).length, 2)
})

test('doudian auth check treats fxg merchant backend pages as logged in', async () => {
  const result = await runAuthCheck({
    href: 'https://fxg.jinritemai.com/ffa/merchant/child-campaign-detail?id=7631472587859837230&applyTab=applied',
    bodyText: '子活动详情 已报名 报名成功 导出列表商品 登录账号',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.logged_in, true)
  assert.equal(result.meta.has_backend_path, true)
})

test('doudian auth check rejects the public shop-entry landing page', async () => {
  const result = await runAuthCheck({
    href: 'https://fxg.jinritemai.com/',
    bodyText: '抖音电商 抖店 618大促 中小新商11大权益 登录抖店 立即0元开店',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.logged_in, false)
  assert.equal(result.meta.has_backend_path, false)
})
