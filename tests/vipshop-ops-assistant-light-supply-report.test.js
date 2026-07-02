import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function loadExports(bodyText = '统计日期 日 2026-07-01 对比日期 日 2026-06-30') {
  const scriptPath = path.resolve('adapters/vipshop-ops-assistant/light-supply-goods-report.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const exportsBox = {}
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: {},
      __CRAWSHRIMP_PHASE__: '__exports__',
      __CRAWSHRIMP_SHARED__: {},
      __CRAWSHRIMP_EXPORTS__: exportsBox,
    },
    document: { body: { innerText: bodyText } },
    location: { href: 'https://compass.vip.com/frontend/index.html#/product/details' },
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

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('buildMatchLookup keeps only target category styles with normalized style codes', async () => {
  const helpers = await loadExports()
  const lookup = helpers.buildMatchLookup({
    rows: [
      { 大货款号: ' 461108w1002v ', 类别: '轻供' },
      { 大货款号: '45X087A4230Q', 类别: '自营' },
      { 大货款号: '', 类别: '轻供' },
    ],
  }, '轻供')

  assert.equal(lookup.totalRows, 3)
  assert.equal(lookup.targetRows, 1)
  assert.equal(lookup.invalidRows, 1)
  assert.equal(lookup.categoryByStyle.get('461108W1002V'), '轻供')
  assert.equal(helpers.shouldKeepRow({ osn: '461108W1002V' }, lookup), true)
  assert.equal(helpers.shouldKeepRow({ osn: '45X087A4230Q' }, lookup), false)
})

test('infers style from osn first, then strips color suffix from goods sku fields', async () => {
  const helpers = await loadExports()

  assert.equal(helpers.inferStyleCode({ osn: '461108W1002V', goodsNo: 'bad' }), '461108W1002V')
  assert.equal(helpers.inferStyleCode({ msn: '45X087A4230Q720' }), '45X087A4230Q')
  assert.equal(helpers.inferStyleCode({ goodsNo: '461108W1002V805' }), '461108W1002V')
})

test('normalizes Vipshop rows into Chinese report columns', async () => {
  const helpers = await loadExports()
  const lookup = helpers.buildMatchLookup({ rows: [{ 大货款号: '461108W1002V', 类别: '轻供' }] }, '轻供')
  const row = helpers.normalizeGoodsDetailRow({
    merchandiseNo: '6920833544972266067',
    goodsNo: '461108W1002V805',
    osn: '461108W1002V',
    goodsName: 'MOP 男士休闲裤',
    dt: '20260701',
    brandStoreSn: '10029492',
    brandStoreName: "MARC O'POLO",
    firstCateName: '男装',
    secCateName: '男下装',
    thirdCateName: '男式休闲裤',
    minVipshopPrice: '559',
    minPayPrice: '379',
    goodsActureAmt: '1342.75',
    goodsActureNum: '4',
    userNum: '4',
    uv: '54',
    onSellLeavingNum: '132',
    merTypeList: ['高价值商品-A类'],
  }, lookup)

  assert.deepEqual(plain({
    sheet: row.__sheet_name,
    source: row.报表来源,
    category: row.区分,
    style: row.款号,
    sku: row.货号,
    dt: row.统计日期,
    uv: row.商详UV,
    endpoint: row.数据来源接口,
  }), {
    sheet: '商品明细-轻供',
    source: '商品明细',
    category: '轻供',
    style: '461108W1002V',
    sku: '461108W1002V805',
    dt: '2026-07-01',
    uv: '54',
    endpoint: '/product/detail/getGoodsList',
  })
})

test('extracts compass statistic date from page text unless explicit params override it', async () => {
  const helpers = await loadExports('品牌 统计日期 日 2026-07-01 分天查看 对比日期 日 2026-06-30 商品粒度 款号')

  assert.deepEqual(plain(helpers.extractCompassDateRange({})), {
    startDt: '20260701',
    endDt: '20260701',
    source: '页面统计日期',
  })
  assert.deepEqual(plain(helpers.extractCompassDateRange({ start_date: '2026-06-01', end_date: '2026-06-30' })), {
    startDt: '20260601',
    endDt: '20260630',
    source: '参数',
  })
})

test('builds verified Vipshop API payload shapes', async () => {
  const helpers = await loadExports()

  assert.deepEqual(plain(helpers.buildMerchandiseInfoPayload(2, 500)), {
    pageNo: 2,
    pageSize: 500,
    param: {},
  })
  assert.deepEqual(plain(helpers.buildGoodsDetailPayload(3, 500, { startDt: '20260701', endDt: '20260701' })), {
    brandStoreSn: 'all',
    dtType: 0,
    calType: 1,
    startDt: '20260701',
    endDt: '20260701',
    queryHll: false,
    pageNo: 3,
    pageSize: 500,
    dimType: 0,
    channelType: 1,
  })
})
