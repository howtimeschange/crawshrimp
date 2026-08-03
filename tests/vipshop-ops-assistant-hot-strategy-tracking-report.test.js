import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function loadExports(options = {}) {
  const scriptPath = path.resolve('adapters/vipshop-ops-assistant/hot-strategy-tracking-report.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const exportsBox = {}
  const bodyText = options.bodyText || '品牌 统计日期 日 2026-07-01 对比日期 日 2026-06-30 商品粒度 款号'
  const href = options.href || 'https://compass.vip.com/frontend/index.html#/product/details'
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: options.params || {},
      __CRAWSHRIMP_PHASE__: '__exports__',
      __CRAWSHRIMP_SHARED__: {},
      __CRAWSHRIMP_EXPORTS__: exportsBox,
    },
    document: { body: { innerText: bodyText } },
    location: { href },
    fetch: async () => {
      throw new Error('fetch should not run in helper export tests')
    },
    console,
    setTimeout,
    clearTimeout,
    Date,
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
  }
  context.globalThis = context
  await vm.runInNewContext(source, context, { filename: scriptPath })
  return exportsBox
}

async function runAuthCheck(href, bodyText) {
  const scriptPath = path.resolve('adapters/vipshop-ops-assistant/auth_check.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const url = new URL(href)
  const context = {
    window: {},
    document: { body: { innerText: bodyText } },
    location: { href, hostname: url.hostname },
    URL,
    console,
    Date,
    Math,
    JSON,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Promise,
  }
  context.globalThis = context
  return vm.runInNewContext(source, context, { filename: scriptPath })
}

async function runReportScript(options = {}) {
  const scriptPath = path.resolve('adapters/vipshop-ops-assistant/hot-strategy-tracking-report.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const href = options.href || 'https://e.vip.com/upgrade.html#/promotion/tmax/sptg/report-goods'
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: options.params || {},
      __CRAWSHRIMP_PHASE__: options.phase || 'marketing_reports',
      __CRAWSHRIMP_SHARED__: options.shared || {},
    },
    document: {
      body: {
        innerText: options.bodyText || '唯品会营销平台 Target-Max T-max 商品打爆 报表',
      },
    },
    location: { href },
    fetch: options.fetch,
    console,
    setTimeout,
    clearTimeout,
    Date,
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
  }
  context.globalThis = context
  return vm.runInNewContext(source, context, { filename: scriptPath })
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data),
  }
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('builds verified compass goods detail payload and phase order', async () => {
  const helpers = await loadExports()

  assert.equal(helpers.firstExecutionPhase(['compass_sales_detail', 'bct_gift']), 'compass_sales')
  assert.equal(helpers.nextPhaseAfterCompass(['compass_sales_detail', 'bct_gift']), 'bct_reports')
  assert.equal(helpers.firstExecutionPhase(['vipdirect_ads']), 'marketing_reports')

  assert.deepEqual(plain(helpers.extractCompassDateRange({ start_date: '2026-07-01', end_date: '2026-07-31' })), {
    startDt: '20260701',
    endDt: '20260731',
    source: '参数',
  })
  assert.deepEqual(plain(helpers.buildGoodsDetailPayload(2, 300, { startDt: '20260701', endDt: '20260731' }, {
    brand_store_sn: '10004119',
  })), {
    brandStoreSn: '10004119',
    dtType: 0,
    calType: 1,
    startDt: '20260701',
    endDt: '20260731',
    queryHll: false,
    pageNo: 2,
    pageSize: 300,
    dimType: 0,
    channelType: 1,
  })
})

test('builds VipDirect report payload and normalizes 24-hour ad metrics', async () => {
  const helpers = await loadExports()
  const dateRange = helpers.extractVipDirectDateRange({
    vipdirect_start_date: '2026-07-19',
    vipdirect_end_date: '2026-08-02',
  })
  const payload = helpers.buildVipDirectReportPayload(2, 20, dateRange, { advertiserId: 'ADV1' }, {})

  assert.equal(dateRange.source, '参数')
  assert.equal(dateRange.startYmd, '20260719')
  assert.equal(dateRange.endYmd, '20260802')
  assert.equal(dateRange.startMs, 1784390400000)
  assert.equal(dateRange.endMs, 1785600000000)
  assert.equal(payload.layer, 'ALL')
  assert.deepEqual(plain(payload.reportChannelTypes), ['VSM'])
  assert.deepEqual(plain(payload.dealType), ['RTB'])
  assert.deepEqual(plain(payload.advertiserIds), ['ADV1'])
  assert.equal(payload.pageIndex, 2)
  assert.equal(payload.pageCount, 20)
  assert.ok(payload.columnList.includes('LIKE_CNT_1D'))
  assert.ok(payload.columnList.includes('GOODS_ROI_IN_24HOUR'))

  const row = helpers.normalizeVipDirectAdsRow({
    dateString: '2026.08.02',
    reportChannelTypeTitle: '唯直达',
    campaignTitle: '唯直达计划',
    adTitle: '搜索广告',
    statistics: {
      impressionCount: 340533,
      clickCount: 5243,
      cost: 295802,
      clickRate: 0.0154,
      costPerMille: 869,
      costPerClick: 56,
      appUV: 4205,
      miniappUV: 457,
      detailUV1d: 4855,
      brandUV: 5010,
      likeCnt1d: 324,
      addcartCnt1d: 1517,
      costPerAddcart1d: 195,
      bookCustomerIn24Hour: 264,
      bookOrdersIn24Hour: 298,
      bookSalesIn24Hour: 3179565,
      bookRoiIn24Hour: 10.749,
      customerIn24Hour: 236,
      salesIn24Hour: 2538813,
      roiIn24Hour: 8.5828,
      goodsLikeCnt1d: 96,
      goodsAddcartCnt1d: 400,
      goodsCostPerAddcart1d: 740,
      goodsBookCustomerIn24Hour: 72,
      goodsBookOrdersIn24Hour: 73,
      goodsBookSalesIn24Hour: 584619,
      goodsBookRoiIn24Hour: 1.9769,
      goodsCustomerIn24Hour: 67,
      goodsSalesIn24Hour: 494752,
      goodsRoiIn24Hour: 1.6726,
    },
  }, { advertiserTitle: '巴拉巴拉balabala' }, payload)

  assert.equal(row.__sheet_name, '唯直达投放效果')
  assert.equal(row.报表来源, '唯直达投放效果')
  assert.equal(row.数据分组, '汇总')
  assert.equal(row.品牌名称, '巴拉巴拉balabala')
  assert.equal(row.统计日期, '2026-08-02')
  assert.equal(row.花费, '2958.02')
  assert.equal(row.点击率, '1.54%')
  assert.equal(row['24小时收藏数(商家)'], '324')
  assert.equal(row['24小时下单客户数(商家)'], '264')
  assert.equal(row['24小时订单额(商家)'], '31795.65')
  assert.equal(row['24小时成交ROI(商家)'], '8.5828')
  assert.equal(row['24小时收藏数(商品)'], '96')
  assert.equal(row['24小时订单额(商品)'], '5846.19')
  assert.equal(row['24小时成交ROI(商品)'], '1.6726')
})

test('marketing reports phase reads VipDirect through ck report API', async () => {
  const calls = []
  const result = await runReportScript({
    params: {
      report_scope: ['vipdirect_ads'],
      vipdirect_start_date: '2026-07-19',
      vipdirect_end_date: '2026-08-02',
      page_size: 20,
    },
    bodyText: '唯品会营销平台 唯直达 数据报表 投放效果',
    href: 'https://e.vip.com/upgrade.html#/promotion/insite/search/report',
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), headers: options.headers || {}, body: options.body || '' })
      if (String(url).includes('/user/current')) {
        return jsonResponse({
          data: {
            advertiserId: 'ADV1',
            permissions: ['report:read:own'],
            advertiser: { title: '巴拉巴拉balabala' },
          },
        })
      }
      if (String(url).includes('/ck/report/table')) {
        assert.equal(options.headers.advid, 'ADV1')
        const payload = JSON.parse(options.body)
        assert.equal(payload.layer, 'ALL')
        assert.deepEqual(payload.reportChannelTypes, ['VSM'])
        assert.deepEqual(payload.dealType, ['RTB'])
        assert.equal(payload.pageIndex, 1)
        assert.equal(payload.pageCount, 20)
        return jsonResponse({
          data: {
            reports: [
              {
                dateString: '2026.08.02',
                reportChannelTypeTitle: '唯直达',
                statistics: {
                  cost: 295802,
                  impressionCount: 340533,
                  clickCount: 5243,
                  likeCnt1d: 324,
                  bookCustomerIn24Hour: 264,
                  bookSalesIn24Hour: 3179565,
                  roiIn24Hour: 8.5828,
                  goodsLikeCnt1d: 96,
                  goodsBookCustomerIn24Hour: 72,
                  goodsBookSalesIn24Hour: 584619,
                  goodsRoiIn24Hour: 1.6726,
                },
              },
            ],
          },
          pageInfo: { totalElements: 1 },
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.shared.vipdirect_ads_rows, 1)
  assert.equal(result.data.length, 2)
  assert.equal(result.data[0].__sheet_name, '执行摘要')
  assert.match(result.data[0].备注, /唯直达投放效果 2026-07-19-2026-08-02/)
  assert.equal(result.data[1].__sheet_name, '唯直达投放效果')
  assert.equal(result.data[1]['24小时订单额(商家)'], '31795.65')
  assert.equal(result.data[1]['24小时成交ROI(商品)'], '1.6726')
  assert.ok(calls.some(call => call.url.includes('/ck/report/table')))
})

test('builds T-max goods report URL and normalizes hot-goods metrics', async () => {
  const helpers = await loadExports()
  const dateRange = helpers.extractTmaxDateRange({
    tmax_start_date: '2026-07-19',
    tmax_end_date: '2026-08-02',
  })
  const url = helpers.buildTmaxGoodsReportUrl(2, 500, dateRange, {
    tmax_goods_name: '儿童内裤',
  })

  assert.equal(dateRange.source, '参数')
  assert.equal(dateRange.startYmd, '20260719')
  assert.equal(dateRange.endYmd, '20260802')
  assert.match(url, /^\/spugoods\/report\/table\?/)
  assert.match(url, /pi=2/)
  assert.match(url, /pc=500/)
  assert.match(url, /columns=1%2C2%2C3%2C4%2C73/)
  assert.match(url, /msList=3%2C4%2C5/)
  assert.match(url, /goodsName=%E5%84%BF%E7%AB%A5%E5%86%85%E8%A3%A4/)

  const row = helpers.normalizeTmaxGoodsRow({
    spuId: '5211305238098509825',
    goodsId: '汇总',
    adsTitle: '新-home+用品',
    goodsName: '100%纯棉儿童内裤',
    campaignId: 'C1001',
    adId: 'A1001',
    deliveryChannel: 106,
    bidPrice: 1000,
    actionPrice: 1200,
    actionType: 7,
    chargeType: 0,
    statistics: {
      impressionCount: 99635,
      clickCount: 2552,
      cost: 270627,
      goodsLikeCnt1d: 12,
      goodsAddcartCnt1d: 682,
      goodsCostPerAddcart1d: 397,
      goodsBookSalesIn24Hour: 123456,
      goodsRoiIn24Hour: 4.56,
    },
  }, { advertiserTitle: '巴拉巴拉balabala' })

  assert.equal(row.__sheet_name, 'T-max效果')
  assert.equal(row.报表来源, 'T-max效果数据')
  assert.equal(row.数据分组, '商品打爆')
  assert.equal(row.品牌名称, '巴拉巴拉balabala')
  assert.equal(row.商品ID, '5211305238098509825')
  assert.equal(row.货号, '')
  assert.equal(row.收藏数, '12')
  assert.equal(row.加购数, '682')
  assert.equal(row.加购成本, '3.97')
  assert.equal(row.销售额, '1234.56')
  assert.equal(row.ROI, '4.56')
  assert.equal(row.活动成本, '2706.27')
})

test('marketing reports phase reads T-max hot goods through page-owned API', async () => {
  const calls = []
  const result = await runReportScript({
    params: {
      report_scope: ['tmax_goods'],
      tmax_start_date: '2026-07-19',
      tmax_end_date: '2026-08-02',
      page_size: 20,
    },
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), headers: options.headers || {} })
      if (String(url).includes('/user/current')) {
        return jsonResponse({
          data: {
            advertiserId: 'ADV1',
            permissions: ['vip:tmax:hot:goods:whitelist'],
            advertiser: { title: '巴拉巴拉balabala' },
          },
        })
      }
      if (String(url).includes('/spugoods/report/table')) {
        assert.equal(options.headers.advid, 'ADV1')
        return jsonResponse({
          data: [
            {
              spuId: 'SPU1',
              goodsId: '汇总',
              adsTitle: '新-鞋品',
              goodsName: '儿童运动鞋',
              campaignId: 'C1',
              statistics: {
                impressionCount: 10,
                clickCount: 2,
                cost: 300,
                goodsLikeCnt1d: 1,
                goodsAddcartCnt1d: 3,
                goodsCostPerAddcart1d: 100,
                goodsBookSalesIn24Hour: 900,
                goodsRoiIn24Hour: 3,
              },
            },
          ],
          pageInfo: { totalElements: 1 },
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.shared.tmax_goods_rows, 1)
  assert.equal(result.data.length, 2)
  assert.equal(result.data[0].__sheet_name, '执行摘要')
  assert.match(result.data[0].备注, /T-max商品打爆 2026-07-19-2026-08-02/)
  assert.equal(result.data[1].__sheet_name, 'T-max效果')
  assert.equal(result.data[1].加购成本, '1.00')
  assert.equal(result.data[1].销售额, '9.00')
  assert.ok(calls.some(call => call.url.includes('/spugoods/report/table?')))
})

test('normalizes compass sales rows and preserves unlisted custom metrics', async () => {
  const helpers = await loadExports()
  const row = helpers.normalizeCompassSalesRow({
    merchandiseNo: '6920833544972266067',
    goodsNo: '461108W1002V805',
    osn: '461108W1002V',
    goodsName: 'Balabala 儿童外套',
    dt: '20260701',
    brandStoreSn: '10004119',
    brandStoreName: '巴拉巴拉Balabala',
    firstCateName: '童装',
    minVipshopPrice: '129',
    minPayPrice: '99',
    goodsActureAmt: '1200.50',
    goodsActureNum: '11',
    userNum: '9',
    uv: '88',
    customAllSelectedMetric: 'keep-me',
  })

  assert.equal(row.__sheet_name, '魔方罗盘销售明细')
  assert.equal(row.报表来源, '魔方罗盘销售明细')
  assert.equal(row.款号, '461108W1002V')
  assert.equal(row.货号, '461108W1002V805')
  assert.equal(row.统计日期, '2026-07-01')
  assert.equal(row.销售额, '1200.50')
  assert.equal(row.商详UV, '88')
  assert.equal(row['源字段/customAllSelectedMetric'], 'keep-me')
})

test('selects BCT brand and builds lifecycle toolbox list payload', async () => {
  const helpers = await loadExports()
  const brand = helpers.selectBctBrand({
    data: {
      vendorCode: '104218',
      brands: [
        { brandSn: 10009999, brandName: '其他品牌', id: 141 },
        { brandSn: 10004119, brandName: '巴拉巴拉Balabala', id: 142 },
      ],
    },
  }, '巴拉巴拉')

  assert.deepEqual(plain(brand), {
    brandSn: '10004119',
    brandName: '巴拉巴拉Balabala',
    vendorCode: '104218',
    vendorId: 142,
    matchedBy: '品牌关键词',
  })

  const payload = helpers.buildBctToolboxPayload('lifecycle', 3, 300, brand, {
    bct_activity_start: '2026-07-01',
    bct_activity_end: '2026-07-31',
    bct_coupon_nos: 'C001\nC002',
    bct_status_list: '1,2',
  })

  assert.equal(payload.vendorId, 142)
  assert.equal(payload.pageNum, 3)
  assert.equal(payload.pageSize, 300)
  assert.deepEqual(plain(payload.taskTypeList), [13, 14, 15, 16, 17, 18, 19, 20, 23, 25, 32, 34, 35, 36])
  assert.deepEqual(plain(payload.couponNos), ['C001', 'C002'])
  assert.deepEqual(plain(payload.statusList), [1, 2])
  assert.equal(payload.startTimeBegin, '2026-07-01 00:00:00')
  assert.equal(payload.startTimeEnd, '2026-07-31 23:59:59')
})

test('normalizes BCT lifecycle and scene rows with task labels', async () => {
  const helpers = await loadExports()
  const brand = { brandSn: '10004119', brandName: '巴拉巴拉Balabala', vendorCode: '104218', vendorId: 142 }
  const lifecycle = helpers.normalizeBctTaskRow({
    id: 'L1001',
    taskName: '首单礼金测试',
    uspGroupName: '新客人群',
    taskType: 13,
    status: 2,
    startTime: '2026-07-01 00:00:00',
    endTime: '2026-07-31 23:59:59',
    createTime: '2026-06-30 12:00:00',
    couponNo: 'COUPON1',
    userNum: '20',
    buyTotal: '1999.00',
    orderNum: '18',
    activityCost: '200.00',
    roi: '9.99',
  }, 'lifecycle', brand)
  const scene = helpers.normalizeBctTaskRow({ id: 'S1001', taskName: '购物车挽回', taskType: 22, status: 3 }, 'scene', brand)

  assert.equal(lifecycle.__sheet_name, '中台礼金')
  assert.equal(lifecycle.运营方式, '首单礼金')
  assert.equal(lifecycle.活动状态, '进行中')
  assert.equal(lifecycle.销售额, '1999.00')
  assert.equal(lifecycle.ROI, '9.99')
  assert.equal(scene.__sheet_name, '中台购物车跨品类券')
  assert.equal(scene.运营方式, '购物车挽回')
  assert.equal(scene.活动状态, '已结束')
})

test('marketing preflight rows document VipDirect and T-max login-gated exports', async () => {
  const helpers = await loadExports()
  const rows = helpers.buildMarketingPreflightRows({
    report_scope: ['vipdirect_ads', 'tmax_goods'],
  }, 'https://passport.vip.com/login', '扫码登录')

  assert.equal(rows.length, 2)
  assert.equal(rows[0].__sheet_name, '唯直达投放效果')
  assert.match(rows[0].备注, /24小时收藏数/)
  assert.match(rows[0].备注, /24小时成交ROI/)
  assert.equal(rows[0].执行结果, '需要营销平台登录')
  assert.equal(rows[1].__sheet_name, 'T-max效果')
  assert.match(rows[1].备注, /商品打爆/)
  assert.match(rows[1].备注, /加购成本/)
})

test('auth check treats BCT strategy-effect page as an authenticated Vipshop surface', async () => {
  const bct = await runAuthCheck(
    'https://bct.vip.com/vendor_new_v2/index.html#/frontend/strategyEffect/list?tab=userLifecycle',
    '策略效果 用户运营赋能 用户生命周期运营 场景营销',
  )
  const login = await runAuthCheck('https://passport.vip.com/login', '扫码登录 账号登录 password captcha')

  assert.equal(bct.data[0].logged_in, true)
  assert.equal(login.data[0].logged_in, false)
})
