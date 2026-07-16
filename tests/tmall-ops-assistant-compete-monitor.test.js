import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function loadExports() {
  const scriptPath = path.resolve('adapters/tmall-ops-assistant/tmall-compete-paid-monitor.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const exportsBox = {}
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: {},
      __CRAWSHRIMP_PHASE__: '__exports__',
      __CRAWSHRIMP_SHARED__: {},
      __CRAWSHRIMP_EXPORTS__: exportsBox,
      location: {
        href: 'https://dmp.taobao.com/index_new.html#!/compete/compete-situation',
      },
    },
    location: {
      href: 'https://dmp.taobao.com/index_new.html#!/compete/compete-situation',
    },
    document: {},
    performance: {
      getEntriesByType: () => [],
    },
    fetch: async () => ({ ok: true, text: async () => '{}' }),
    URL,
    URLSearchParams,
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

test('compete paid monitor exposes default Bala monitor list and three-shop batches', async () => {
  const helpers = await loadExports()

  assert.equal(helpers.DEFAULT_MONITOR_SHOPS.length, 10)
  assert.deepEqual(plain(helpers.DEFAULT_MONITOR_SHOPS.map(item => [item.shopName, item.position])), [
    ['巴拉巴拉官方旗舰', '本品'],
    ['davebella旗舰店', '常规竞争'],
    ['左西旗舰店', '常规竞争'],
    ['moodytiger旗舰店', '常规竞争'],
    ['anta安踏童装旗舰店', '销售头部'],
    ['FILA童装旗舰店', '销售头部'],
    ['泰兰尼斯童鞋旗舰店', '销售头部'],
    ['贝肽斯官方旗舰店', '同比高增'],
    ['班喜迪旗舰店', '同比高增'],
    ['子瑞巴巴旗舰店', '同比高增'],
  ])

  assert.deepEqual(plain(helpers.chunkArray([1, 2, 3, 4, 5, 6, 7], 3)), [
    [1, 2, 3],
    [4, 5, 6],
    [7],
  ])
  const parsedNamesOnly = helpers.parseMonitorShopRows('左西旗舰店\ndavebella旗舰店\n自定义旗舰店')
  assert.deepEqual(plain(parsedNamesOnly.map(({ shopName, position, isSelf }) => ({ shopName, position, isSelf }))), [
    { shopName: '左西旗舰店', position: '常规竞争', isSelf: false },
    { shopName: 'davebella旗舰店', position: '常规竞争', isSelf: false },
    { shopName: '自定义旗舰店', position: '', isSelf: false },
  ])
  assert.deepEqual(plain(parsedNamesOnly[1].aliases), ['戴维贝拉旗舰店'])
  assert.deepEqual(plain(helpers.parseMonitorShopRows('店铺名称\t店铺定位\n左西旗舰店\t手动定位')), [
    { shopName: '左西旗舰店', position: '手动定位', isSelf: false },
  ])
})

test('compete paid monitor parses desensitized range values as midpoints', async () => {
  const helpers = await loadExports()

  assert.equal(helpers.parseMetricNumber('10%-20%'), 0.15)
  assert.equal(helpers.parseMetricNumber('5-8元'), 6.5)
  assert.equal(helpers.parseMetricNumber('1,000-2,000'), 1500)
  assert.equal(helpers.parseMetricNumber('100万-200万'), 1500000)
  assert.equal(helpers.parseMetricNumber('1亿-2亿'), 150000000)
})

test('compete paid monitor does not fallback to unrelated followed shops', async () => {
  const helpers = await loadExports()
  const followedList = [{
    competitorName: '江博士官方旗舰店',
    competitorInfo: {
      shop_name: '江博士官方旗舰店',
      shop_id: 123,
      token: 'wrong-token',
    },
  }]

  assert.equal(helpers.findBestShopMatch(followedList, { shopName: '左西旗舰店' }), null)
  assert.equal(
    helpers.findBestShopMatch(followedList, { shopName: '左西旗舰店' }, { allowFirstFallback: true }).shopName,
    '江博士官方旗舰店',
  )
})

test('compete paid monitor defaults to selected page dates', async () => {
  const helpers = await loadExports()
  const reference = new Date(2026, 6, 16)
  const pageText = '分析周期  2026-07-09 至 昨日  对比周期  2026-07-02 至 2026-07-08  竞争控比分析'

  assert.deepEqual(plain(helpers.resolveDateRanges({}, reference, pageText)), {
    beginDate: '2026-07-09',
    endDate: '2026-07-15',
    peerBeginDate: '2026-07-02',
    peerEndDate: '2026-07-08',
    mode: 'page_current',
    weekLabel: '2026-07-09~2026-07-08',
  })
  assert.deepEqual(plain(helpers.resolveDateRanges({ analysis_end_date: '2026-07-14' }, reference, pageText)), {
    beginDate: '2026-07-09',
    endDate: '2026-07-14',
    peerBeginDate: '2026-07-02',
    peerEndDate: '2026-07-08',
    mode: 'page_current_with_overrides',
    weekLabel: '2026-07-09~2026-07-08',
  })
})

test('compete paid monitor can still resolve weekly split dates as fallback', async () => {
  const helpers = await loadExports()
  const reference = new Date(2026, 6, 16)

  assert.deepEqual(plain(helpers.resolveDateRanges({ stat_week_mode: 'current_week' }, reference)), {
    beginDate: '2026-07-13',
    endDate: '2026-07-15',
    peerBeginDate: '2026-07-16',
    peerEndDate: '2026-07-19',
    mode: 'current_week',
    weekLabel: '2026-07-13~2026-07-19',
  })
  assert.deepEqual(plain(helpers.resolveDateRanges({ stat_week_mode: 'last_completed_week' }, reference)), {
    beginDate: '2026-07-06',
    endDate: '2026-07-08',
    peerBeginDate: '2026-07-09',
    peerEndDate: '2026-07-12',
    mode: 'last_completed_week',
    weekLabel: '2026-07-06~2026-07-12',
  })
  assert.deepEqual(plain(helpers.resolveDateRanges({}, reference, '页面没有日期')), {
    beginDate: '2026-07-06',
    endDate: '2026-07-08',
    peerBeginDate: '2026-07-09',
    peerEndDate: '2026-07-12',
    mode: 'fallback_last_completed_week',
    weekLabel: '2026-07-06~2026-07-12',
  })
  assert.deepEqual(plain(helpers.resolveDateRanges({
    analysis_start_date: '20260701',
    analysis_end_date: '20260703',
    compare_start_date: '2026-07-04',
    compare_end_date: '2026/07/07',
  }, reference)), {
    beginDate: '2026-07-01',
    endDate: '2026-07-03',
    peerBeginDate: '2026-07-04',
    peerEndDate: '2026-07-07',
    mode: 'custom',
    weekLabel: '2026-07-01~2026-07-07',
  })
})

test('compete paid monitor computes promotion and tool formulas', async () => {
  const helpers = await loadExports()
  const dateRanges = helpers.resolveDateRanges({
    analysis_start_date: '2026-07-13',
    analysis_end_date: '2026-07-15',
    compare_start_date: '2026-07-16',
    compare_end_date: '2026-07-19',
  }, new Date(2026, 6, 16))
  const shops = [{ shopName: '巴拉巴拉官方旗舰', position: '本品', token: 'self-token', status: '已解析' }]
  const metricIndex = {
    'self-token': {
      'baseAd.click': { base: 100 },
      'baseAd.clickCost': { base: 2 },
      'baseAd.roi1d': { base: 3 },
      'baseShop.alipayCnt': { base: 10 },
      'baseShop.averageOrderValue': { base: 50 },
    },
  }

  const summary = helpers.buildSummaryRows(shops, metricIndex, dateRanges)
  assert.equal(summary[0].投放费用, 200)
  assert.equal(summary[0].估算成交GMV, 500)
  assert.equal(summary[0].投放费比, 0.4)
  assert.equal(summary[0].付费成交GMV, 600)
  assert.equal(summary[0].付费渗透率, 1.2)

  const tools = helpers.buildToolRows(
    shops,
    metricIndex,
    { 'self-token': { 关键词推广: 50 } },
    { 'self-token': { 关键词推广: 0.25 } },
    dateRanges,
  )
  assert.equal(tools[0].工具名称, '关键词推广')
  assert.equal(tools[0].分工具费用, 50)
  assert.equal(tools[0].分工具PPC, 1)

  const missingRateTools = helpers.buildToolRows(
    shops,
    metricIndex,
    { 'self-token': { 超级直播: 80 } },
    { 'self-token': {} },
    dateRanges,
  )
  assert.equal(missingRateTools[0].分工具费用, '')
  assert.equal(missingRateTools[0].分工具PPC, '')
})

test('tmall manifest declares compete paid monitor task with multi-sheet output', () => {
  const manifest = fs.readFileSync(path.resolve('adapters/tmall-ops-assistant/manifest.yaml'), 'utf8')

  assert.match(manifest, /version: 0\.1\.3/)
  assert.match(manifest, /id: tmall_compete_paid_monitor/)
  assert.match(manifest, /name: 天猫-竞品付费投放数据监控/)
  assert.match(manifest, /script: tmall-compete-paid-monitor\.js/)
  assert.match(manifest, /https:\/\/dmp\.taobao\.com\/index_new\.html/)
  assert.match(manifest, /sheet_key: __sheet_name/)
  assert.match(manifest, /name: 工具汇总/)
  assert.match(manifest, /name: 店铺解析/)
})
