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

async function runScript({
  params = {},
  shared = {},
  phase = 'main',
  href = 'https://dmp.taobao.com/index_new.html#!/compete/compete-situation',
  bodyText = '',
  documentImpl,
  fetchImpl,
} = {}) {
  const scriptPath = path.resolve('adapters/tmall-ops-assistant/tmall-compete-paid-monitor.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const location = new URL(href)
  const document = documentImpl || {
    body: {
      innerText: bodyText,
      textContent: bodyText,
    },
  }
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      location,
    },
    location,
    document,
    performance: {
      getEntriesByType: () => [],
    },
    fetch: fetchImpl || (async () => ({ ok: true, text: async () => '{}' })),
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
  return vm.runInNewContext(source, context, { filename: scriptPath })
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function makeFakeMagixDateDocument() {
  const elementsById = new Map()
  const controls = []
  const metrics = {
    directValueWrites: 0,
    directTextWrites: 0,
  }

  function makeControl(code, start, end) {
    const parentId = `form_comp_${code}`
    let parentData = { start, end }
    const childState = { start, end }
    const childView = {
      updater: {
        get(key) {
          if (key === 'contentInfo') {
            return {
              dates: {
                startStr: childState.start,
                endStr: childState.end,
                formatter: 'YYYY-MM-DD',
              },
            }
          }
          return undefined
        },
      },
    }
    const parentView = {
      updater: {
        get(key) {
          if (key === 'data') return parentData
          if (key === 'adcConfig') return { code }
          return undefined
        },
        set(next) {
          if (next?.data) parentData = next.data
        },
      },
      handleUpdate({ data }) {
        parentData = data
        childState.start = data.start
        childState.end = data.end
      },
    }
    const parent = {
      id: parentId,
      vframe: { $v: parentView },
      getAttribute(name) {
        return name === 'data-brix-anchor' ? code : ''
      },
      querySelector(selector) {
        return selector === '.mxgc-calendar-rangepicker' ? control : null
      },
      get innerText() {
        return `${code} ${childState.start} 至 ${childState.end}`
      },
      get textContent() {
        return this.innerText
      },
    }
    const control = {
      id: `mx_${code}`,
      className: 'mxgc-calendar-rangepicker',
      vframe: { pId: parentId, $v: childView },
      get value() {
        return JSON.stringify({
          start: childState.start,
          end: childState.end,
          vs: false,
          dates: {
            startStr: childState.start,
            endStr: childState.end,
            formatter: 'YYYY-MM-DD',
          },
        })
      },
      set value(_) {
        metrics.directValueWrites += 1
        throw new Error('direct value mutation is not allowed')
      },
      get innerText() {
        return `calendar ${childState.start} 至 ${childState.end}`
      },
      set innerText(_) {
        metrics.directTextWrites += 1
        throw new Error('direct text mutation is not allowed')
      },
      get textContent() {
        return this.innerText
      },
      set textContent(_) {
        metrics.directTextWrites += 1
        throw new Error('direct text mutation is not allowed')
      },
      getAttribute(name) {
        if (name === 'mx-change') return `input({'code': '${code}'})`
        return ''
      },
      closest() {
        return parent
      },
      querySelector() {
        return null
      },
      querySelectorAll() {
        return []
      },
    }
    elementsById.set(parentId, parent)
    controls.push(control)
    return control
  }

  makeControl('date', '2026-07-09', '2026-07-15')
  makeControl('datePeer', '2026-07-02', '2026-07-08')

  return {
    body: {
      get innerText() {
        return '分析周期 2026-07-09 至 昨日 对比周期 2026-07-02 至 2026-07-08'
      },
      get textContent() {
        return this.innerText
      },
    },
    __controls: controls,
    __metrics: metrics,
    getElementById(id) {
      return elementsById.get(id) || null
    },
    querySelectorAll(selector) {
      if (selector === '.mxgc-calendar-rangepicker') return controls
      if (selector.includes('[id*="form_comp"]')) return Array.from(elementsById.values())
      return []
    },
  }
}

test('compete paid monitor treats DMP base page as recoverable competition route', async () => {
  const helpers = await loadExports()

  assert.equal(helpers.isDmpIndexPage('https://dmp.taobao.com/index_new.html?spm=x'), true)
  assert.equal(helpers.hasCompetitionRoute('https://dmp.taobao.com/index_new.html?spm=x'), false)
  assert.equal(
    helpers.hasCompetitionRoute('https://dmp.taobao.com/index_new.html?spm=x#!/compete/compete-situation'),
    true,
  )
  assert.match(
    helpers.targetCompetitionHref('https://dmp.taobao.com/index_new.html?spm=x'),
    /#!\/compete\/compete-situation$/,
  )

  const result = await runScript({
    href: 'https://dmp.taobao.com/index_new.html?spm=x',
  })
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'prepare')
  assert.equal(result.meta.shared.current_store, '打开竞争态势分析页面')
})

test('compete paid monitor prepare phase initializes progress shared state', async () => {
  const pageText = '分析周期 2026-07-09 至 昨日 对比周期 2026-07-02 至 2026-07-08'
  const result = await runScript({
    phase: 'prepare',
    href: 'https://dmp.taobao.com/index_new.html#!/compete/compete-situation',
    bodyText: pageText,
    params: {
      shop_list: '巴拉巴拉官方旗舰\n左西旗舰店',
    },
  })

  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'resolve_shops')
  assert.equal(result.meta.shared.current_store, '准备采集参数')
  assert.equal(result.meta.shared.current_exec_no, 1)
  assert.equal(result.meta.shared.monitorShops.length, 2)
  assert.equal(result.meta.shared.dateRanges.beginDate, '2026-07-09')
  assert.ok(result.meta.shared.total_rows >= 3)
})

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
  assert.equal(helpers.findBestShopMatch(
    followedList,
    { shopName: '左西旗舰店' },
    { allowFirstFallback: true },
  ), null)
})

test('compete paid monitor carries a discovered self token into structure collection', async () => {
  const selfShop = {
    shopName: '巴拉巴拉官方旗舰',
    position: '本品',
    isSelf: true,
    status: '已解析',
  }
  const competitor = {
    shopName: '左西旗舰店',
    position: '常规竞争',
    token: 'competitor-token',
    status: '已解析',
  }
  const result = await runScript({
    phase: 'collect_batch',
    shared: {
      dateRanges: {
        beginDate: '2026-07-09',
        endDate: '2026-07-15',
        peerBeginDate: '2026-07-02',
        peerEndDate: '2026-07-08',
        weekLabel: '2026-07-09~2026-07-15',
      },
      selfShop,
      resolvedShops: [selfShop, competitor],
      competitorShops: [competitor],
      batches: [[competitor]],
      structureShops: [competitor],
      totalSteps: 5,
      batchIndex: 0,
      structureIndex: 0,
      logRows: [],
    },
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname
      const payload = pathname.endsWith('/base/control/ratio')
        ? {
            data: {
              click: {
                competitorList: [
                  { competitorId: 'self-token', base: 10 },
                  { competitorId: 'competitor-token', base: 20 },
                ],
              },
            },
          }
        : {}
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(payload),
      }
    },
  })

  assert.deepEqual(plain(result.meta.shared.structureShops.map(shop => ({
    shopName: shop.shopName,
    token: shop.token,
  }))), [
    { shopName: '巴拉巴拉官方旗舰', token: 'self-token' },
    { shopName: '左西旗舰店', token: 'competitor-token' },
  ])
  assert.equal(result.meta.shared.totalSteps, 6)
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
    weekLabel: '2026-07-09~2026-07-15',
  })
  assert.deepEqual(plain(helpers.resolveDateRanges({ analysis_end_date: '2026-07-14' }, reference, pageText)), {
    beginDate: '2026-07-09',
    endDate: '2026-07-14',
    peerBeginDate: '2026-07-02',
    peerEndDate: '2026-07-08',
    mode: 'page_current_with_overrides',
    weekLabel: '2026-07-09~2026-07-14',
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

test('compete paid monitor prepares explicit date ranges for API collection', async () => {
  const helpers = await loadExports()
  const params = {
    analysis_start_date: '2026-07-01',
    analysis_end_date: '2026-07-07',
    compare_start_date: '2026-06-20',
    compare_end_date: '2026-06-27',
  }

  assert.equal(helpers.hasCompleteExplicitDateParams(params), true)
  assert.deepEqual(plain(helpers.explicitDateParams(params)), {
    beginDate: '2026-07-01',
    endDate: '2026-07-07',
    peerBeginDate: '2026-06-20',
    peerEndDate: '2026-06-27',
  })
})

test('compete paid monitor uses explicit dates for APIs without mutating page date controls', async () => {
  const documentImpl = makeFakeMagixDateDocument()
  const result = await runScript({
    phase: 'prepare',
    href: 'https://dmp.taobao.com/index_new.html#!/compete/compete-situation',
    documentImpl,
    params: {
      analysis_start_date: '2026-07-01',
      analysis_end_date: '2026-07-07',
      compare_start_date: '2026-06-20',
      compare_end_date: '2026-06-27',
      shop_list: '巴拉巴拉官方旗舰',
    },
  })

  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.shared.pageDateSync.status, 'api_params_only')
  assert.equal(result.meta.shared.dateRanges.beginDate, '2026-07-01')
  assert.equal(result.meta.shared.dateRanges.endDate, '2026-07-07')
  assert.equal(result.meta.shared.dateRanges.peerBeginDate, '2026-06-20')
  assert.equal(result.meta.shared.dateRanges.peerEndDate, '2026-06-27')
  assert.equal(documentImpl.__metrics.directValueWrites, 0)
  assert.equal(documentImpl.__metrics.directTextWrites, 0)
  assert.deepEqual(documentImpl.__controls.map(control => JSON.parse(control.value)), [
    {
      start: '2026-07-09',
      end: '2026-07-15',
      vs: false,
      dates: {
        startStr: '2026-07-09',
        endStr: '2026-07-15',
        formatter: 'YYYY-MM-DD',
      },
    },
    {
      start: '2026-07-02',
      end: '2026-07-08',
      vs: false,
      dates: {
        startStr: '2026-07-02',
        endStr: '2026-07-08',
        formatter: 'YYYY-MM-DD',
      },
    },
  ])
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
