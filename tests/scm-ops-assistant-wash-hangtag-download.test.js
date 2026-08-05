import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/scm-ops-assistant/wash-hangtag-batch-download.js')
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8')

const SAMPLE_ROW = {
  VENDOR_NAME: '展鑫',
  LAST_MODIFIED_TIME: '2026-05-07 21:41:58',
  BRAND_DISPLAY: '巴拉巴拉',
  LAST_MODIFIED_BY: '郭平芳',
  P_MAT_NAME: '儿童针织衫',
  ORDER_NO: 'XM260507000074',
  PO_NO: 'PO26042300111,PO26042300112',
  SEASONS_DISPLAY: '426',
  VENDOR_CODE: '0003001757',
  SKC_FILE_URL1: 'https://scmobsprd.semirapp.com/SF_DYNA/ATTACH/208426103215洗唛1778160962524_627.jpg',
  SKC_FILE_URL2: 'https://scmobsprd.semirapp.com/SF_DYNA/ATTACH/PRC1403650-展鑫2084261032151778160931479_2444.pdf',
  F1_DISPLAY: '灰色调00322',
  F1: '00322',
  P_MAT_CODE: '208426103215',
  SKC_CODE: '20842610321500322',
  C_COMPONENT: '成分主面料:100%聚酯纤维',
  E_COMPONENT: 'Composition:Main fabric:61.2%Cotton',
  PUR_GRP_DISPLAY: '毛织',
  H_STATUS: 100,
  STATUS: 0,
  ID: '1249879116575191040',
}

async function loadExports() {
  const exportsBox = {}
  const context = {
    window: {
      __CRAWSHRIMP_EXPORTS__: exportsBox,
      __CRAWSHRIMP_PHASE__: '__exports__',
      __CRAWSHRIMP_PARAMS__: {},
      __CRAWSHRIMP_SHARED__: {},
    },
    document: {
      querySelectorAll() { return [] },
      querySelector() { return null },
    },
    location: { href: 'https://scm.semir.com/scm-quality-mgm/index/scm-qc-wash-appr-index', hostname: 'scm.semir.com' },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
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
    URL,
    console,
  }
  context.globalThis = context
  await vm.runInNewContext(SCRIPT_SOURCE, context, { filename: SCRIPT_PATH })
  return exportsBox
}

async function runScript({ phase = 'main', params = {}, shared = {}, documentOverride = null, extraContext = {} } = {}) {
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
    },
    document: documentOverride || {
      querySelectorAll() { return [] },
      querySelector() { return null },
    },
    location: { href: 'https://scm.semir.com/scm-quality-mgm/index/scm-qc-wash-appr-index', hostname: 'scm.semir.com' },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
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
    URL,
    console,
    ...extraContext,
  }
  context.globalThis = context
  return await vm.runInNewContext(SCRIPT_SOURCE, context, { filename: SCRIPT_PATH })
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('normalizes pasted style codes and removes spreadsheet .0 suffixes', async () => {
  const helpers = await loadExports()

  assert.deepEqual(plain(helpers.normalizeStyleCodes('款号:208426103215\n208426103215，204326141005.0 326FY-BS-507')), [
    '208426103215',
    '204326141005',
    '326FY-BS-507',
  ])
})

test('maps SCM q-table rows to download and composition fields', async () => {
  const helpers = await loadExports()
  const record = helpers.normalizeScmRecord(SAMPLE_ROW, '208426103215')

  assert.equal(record.styleCode, '208426103215')
  assert.equal(record.skc, '20842610321500322')
  assert.equal(record.washUrl, SAMPLE_ROW.SKC_FILE_URL1)
  assert.equal(record.hangtagUrl, SAMPLE_ROW.SKC_FILE_URL2)
  assert.equal(record.chineseComponent, '成分主面料:100%聚酯纤维')
  assert.equal(record.englishComponent, 'Composition:Main fabric:61.2%Cotton')
  assert.equal(record.completed, true)
})

test('builds SCM download items under style folders with Referer headers', async () => {
  const helpers = await loadExports()
  const record = helpers.normalizeScmRecord(SAMPLE_ROW, '208426103215')
  const plan = helpers.buildDownloadPlan('208426103215', [record], '/tmp/SCM洗唛吊牌_20260805', 5)

  assert.equal(plan.downloadItems.length, 2)
  assert.equal(plan.plannedRows.length, 2)
  assert.equal(plan.plannedRows[0].__download_index, 5)
  assert.equal(plan.plannedRows[1].__download_index, 6)
  assert.equal(plan.downloadItems[0].target_dir, '/tmp/SCM洗唛吊牌_20260805')
  assert.equal(plan.downloadItems[0].target_relative_path, '208426103215/洗唛文件/208426103215洗唛1778160962524_627.jpg')
  assert.equal(plan.downloadItems[1].target_relative_path, '208426103215/吊牌文件/PRC1403650-展鑫2084261032151778160931479_2444.pdf')
  assert.match(plan.downloadItems[0].url, /208426103215%E6%B4%97%E5%94%9B1778160962524_627\.jpg/)
  assert.match(plan.downloadItems[1].url, /PRC1403650-%E5%B1%95%E9%91%AB2084261032151778160931479_2444\.pdf/)
  assert.equal(plan.plannedRows[0].源文件URL, SAMPLE_ROW.SKC_FILE_URL1)
  assert.equal(plan.downloadItems[0].headers.Referer, 'https://scm.semir.com/scm-quality-mgm/index/scm-qc-wash-appr-index')
})

test('summarizes distinct component pairs and flags conflicts', async () => {
  const helpers = await loadExports()
  const first = helpers.normalizeScmRecord(SAMPLE_ROW, '208426103215')
  const second = helpers.normalizeScmRecord({
    ...SAMPLE_ROW,
    ID: '2',
    SKC_CODE: '20842610321500333',
    C_COMPONENT: '成分主面料:100%棉',
  }, '208426103215')
  const plan = helpers.buildDownloadPlan('208426103215', [first, second], '/tmp/pkg', 0)
  const rows = helpers.buildSummaryRows('208426103215', [first, second], plan.plannedRows, '/tmp/pkg')

  assert.equal(rows.length, 2)
  assert.equal(rows[0].__sheet_name, '成分汇总')
  assert.match(rows[0].备注, /多组中英文成分/)
  assert.equal(rows[0].洗唛文件数, 1)
  assert.equal(rows[0].吊牌文件数, 1)
})

test('finalizes download rows with actual local paths and sizes', async () => {
  const helpers = await loadExports()
  const record = helpers.normalizeScmRecord(SAMPLE_ROW, '208426103215')
  const plan = helpers.buildDownloadPlan('208426103215', [record], '/tmp/pkg', 0)
  const rows = helpers.finalizeRows(plan.plannedRows, {
    items: [
      { success: true, path: '/tmp/pkg/208426103215/洗唛文件/a.jpg', bytes: 430115 },
      { success: false, path: '/tmp/pkg/208426103215/吊牌文件/b.pdf', error: 'HTTP 403' },
    ],
  })

  assert.equal(rows[0].下载结果, '已下载')
  assert.equal(rows[0].本地文件, '/tmp/pkg/208426103215/洗唛文件/a.jpg')
  assert.equal(rows[0].文件大小, 430115)
  assert.equal(rows[1].下载结果, '下载失败')
  assert.equal(rows[1].备注, 'HTTP 403')
})

test('main phase initializes batch progress and package root without style limit', async () => {
  const result = await runScript({
    params: {
      style_codes: '208426103215\n208426103216',
      export_folder: '/tmp/scm-export',
      package_name: '测试包',
      max_styles: 1,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'search_style')
  assert.deepEqual(plain(result.meta.shared.target_style_codes), ['208426103215', '208426103216'])
  assert.equal(result.meta.shared.package_root, '/tmp/scm-export/测试包')
  assert.equal(result.meta.shared.current_buyer_id, '208426103215')
})

test('retired runtime knobs keep internal defaults when old params remain', async () => {
  const downloadResult = await runScript({
    phase: 'search_style',
    params: { download_concurrency: 8 },
    shared: {
      target_style_codes: ['208426103215'],
      current_index: 1,
      package_root: '/tmp/pkg',
      planned_rows: [],
      pending_download_items: [{ url: 'https://example.test/a.jpg', filename: 'a.jpg' }],
    },
  })
  assert.equal(downloadResult.success, true)
  assert.equal(downloadResult.meta.action, 'download_urls')
  assert.equal(downloadResult.meta.concurrency, 4)

  class FakeEvent {
    constructor(type) {
      this.type = type
    }
  }
  class FakeHTMLInputElement {}
  const input = {
    type: 'text',
    value: '',
    dispatchEvent() {},
  }
  const visibleBox = {
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
  }
  const field = {
    ...visibleBox,
    innerText: '款号',
    querySelector: () => input,
  }
  const button = {
    ...visibleBox,
    innerText: '搜索',
    disabled: false,
    dispatchEvent() {},
    scrollIntoView() {},
    focus() {},
    click() {},
  }
  const searchResult = await runScript({
    phase: 'search_style',
    params: { request_delay_ms: 5000 },
    shared: {
      target_style_codes: ['208426103215'],
      current_index: 0,
      package_root: '/tmp/pkg',
      planned_rows: [],
      pending_download_items: [],
    },
    documentOverride: {
      querySelectorAll(selector) {
        if (selector === 'label.q-field, .q-field') return [field]
        if (selector === 'button') return [button]
        return []
      },
      querySelector() { return null },
    },
    extraContext: {
      HTMLInputElement: FakeHTMLInputElement,
      Event: FakeEvent,
      KeyboardEvent: FakeEvent,
      MouseEvent: FakeEvent,
    },
  })
  assert.equal(searchResult.success, true)
  assert.equal(searchResult.meta.next_phase, 'read_style')
  assert.equal(searchResult.meta.sleep_ms, 700)
  assert.equal(input.value, '208426103215')
})
