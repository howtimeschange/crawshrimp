import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/temu/wash-label-official-pdf-download.js')
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8')

const READY_TARGET = {
  productId: 6903495115,
  productSkuId: 50588044853,
  productSkcId: 36970100333,
  labelCode: 78660415473,
  skcExtCode: '209225117208',
  skuExtCode: '9950019805206',
  labelType: 3,
  cosmeticLabelStatus: 2,
  needCosmeticLabel: true,
}

class FakeElement {
  constructor(options = {}) {
    this.tagName = String(options.tagName || 'DIV').toUpperCase()
    this._text = String(options.text || '')
    this._attrs = { ...(options.attrs || {}) }
    this._rect = options.rect || { left: 0, top: 0, width: 160, height: 32 }
    this._style = {
      display: 'block',
      visibility: 'visible',
      ...options.style,
    }
    this._selectors = new Map()
    this.clicked = 0
    this.toggleChecked = !!options.toggleChecked
    this.disabled = !!options.disabled
  }

  get innerText() { return this._text }
  get textContent() { return this._text }

  getClientRects() {
    if (this._style.display === 'none' || this._style.visibility === 'hidden') return []
    return this._rect.width && this._rect.height ? [this._rect] : []
  }

  getBoundingClientRect() {
    return {
      left: this._rect.left,
      top: this._rect.top,
      width: this._rect.width,
      height: this._rect.height,
      right: this._rect.left + this._rect.width,
      bottom: this._rect.top + this._rect.height,
    }
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null
  }

  setSelector(selector, elements) {
    this._selectors.set(selector, Array.isArray(elements) ? elements : [])
    return this
  }

  querySelectorAll(selector) {
    return this._selectors.get(selector) || []
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  click() {
    this.clicked += 1
    if (this.toggleChecked) {
      this._attrs['data-checked'] = this._attrs['data-checked'] === 'true' ? 'false' : 'true'
    }
  }

  scrollIntoView() {}
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement({ tagName: 'body', text: '' })
    this._selectors = new Map()
  }

  setSelector(selector, elements) {
    this._selectors.set(selector, Array.isArray(elements) ? elements : [])
    return this
  }

  querySelectorAll(selector) {
    return this._selectors.get(selector) || []
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
}

function makePageItem(target = READY_TARGET, overrides = {}) {
  const merged = { ...target, ...overrides }
  return {
    productId: merged.productId,
    productName: merged.productName || '测试商品',
    labelCodeVO: {
      productSkuId: merged.productSkuId,
      productSkcId: merged.productSkcId,
      labelCode: merged.labelCode,
      skcExtCode: merged.skcExtCode,
      skuExtCode: merged.skuExtCode,
    },
    labelRequirement: {
      labelType: merged.labelType,
      cosmeticLabelStatus: merged.cosmeticLabelStatus,
      needCosmeticLabel: merged.needCosmeticLabel,
    },
  }
}

function createWebpackChunks(postImpl) {
  const requestModule = {
    b: async (ResponseClass, requestPath, payload, options) => (
      await postImpl({ ResponseClass, requestPath, payload, options })
    ),
  }
  const webpackRequire = moduleId => {
    if (String(moduleId) === '45689') return requestModule
    throw new Error(`unknown module ${moduleId}`)
  }
  webpackRequire.m = {
    45689: () => {},
  }
  const chunks = []
  chunks.push = payload => {
    payload[2](webpackRequire)
    return 1
  }
  return chunks
}

function baseDocument() {
  const document = new FakeDocument()
  document.setSelector('[class*="account-info_accountInfo"]', [
    new FakeElement({ text: 'balabala Official Shop' }),
  ])
  return document
}

async function runAdapter({
  phase,
  shared = {},
  params = {},
  document = baseDocument(),
  postImpl = async () => ({ res: {} }),
} = {}) {
  const window = {
    __CRAWSHRIMP_PARAMS__: {
      store_name: 'balabala Official Shop',
      max_downloads: 0,
      timeout_seconds: 60,
      ...params,
    },
    __CRAWSHRIMP_PHASE__: phase,
    __CRAWSHRIMP_SHARED__: shared,
    chunkLoadingGlobal_temu_sca_goods: createWebpackChunks(postImpl),
  }
  const context = {
    window,
    document,
    location: { href: 'https://agentseller.temu.com/goods/label' },
    getComputedStyle: element => element?._style || { display: 'block', visibility: 'visible' },
    console,
    Promise,
    Date,
    Math,
    Number,
    String,
    Boolean,
    RegExp,
    Array,
    Object,
    Map,
    Set,
    JSON,
  }
  context.globalThis = context
  return await vm.runInNewContext(SCRIPT_SOURCE, context, { filename: SCRIPT_PATH })
}

test('Crawshrimp main phase enters the initialization flow', async () => {
  const result = await runAdapter({ phase: 'main' })

  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'api_scan')
})

test('API scan starts unfiltered and discovers downloadable wash labels from API-owned fields', async () => {
  let observedRequest = null
  const pending = makePageItem(READY_TARGET, {
    productSkuId: 59045625798,
    labelCode: 92688097345,
    cosmeticLabelStatus: 1,
  })
  const result = await runAdapter({
    phase: 'api_scan',
    postImpl: async request => {
      observedRequest = request
      return { res: { total: 400, pageItems: [makePageItem(), pending] } }
    },
  })

  assert.equal(observedRequest.requestPath, '/visage-agent-seller/labelcode/pageQuery')
  assert.deepEqual(JSON.parse(JSON.stringify(observedRequest.payload)), {
    page: 1,
    pageSize: 200,
  })
  assert.equal(observedRequest.options.skipCheck, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'api_scan')
  assert.equal(result.meta.shared.scanTotalRecords, 400)
  assert.equal(result.meta.shared.scanTotalPages, 2)
  assert.equal(result.meta.shared.scanNextPage, 2)
  assert.equal(result.meta.shared.apiTargets.length, 1)
  assert.equal(result.meta.shared.apiTargets[0].skcExtCode, READY_TARGET.skcExtCode)
  assert.equal(result.meta.shared.apiTargets[0].skuExtCode, READY_TARGET.skuExtCode)
})

test('API scan completes every page, deduplicates identities, and enters the first target', async () => {
  const second = {
    ...READY_TARGET,
    productId: 7000000001,
    productSkuId: 50000000001,
    productSkcId: 30000000001,
    labelCode: 70000000001,
    skcExtCode: '209225117209',
    skuExtCode: '9950019805207',
  }
  const result = await runAdapter({
    phase: 'api_scan',
    shared: {
      scanTotalRecords: 400,
      scanTotalPages: 2,
      scanNextPage: 2,
      apiTargets: [READY_TARGET],
    },
    postImpl: async ({ payload }) => {
      assert.equal(payload.page, 2)
      assert.equal(payload.pageSize, 200)
      return { res: { total: 400, pageItems: [makePageItem(), makePageItem(second)] } }
    },
  })

  assert.equal(result.meta.next_phase, 'api_care_query')
  assert.equal(result.meta.shared.apiTargets.length, 2)
  assert.equal(result.meta.shared.currentTargetIndex, 0)
  assert.equal(result.meta.shared.apiTarget.labelCode, READY_TARGET.labelCode)
  assert.equal(result.meta.shared.apiTargets[0].outputFilename, '209225117208-9950019805206.pdf')
  assert.equal(result.meta.shared.apiTargets[1].outputFilename, '209225117209-9950019805207.pdf')
})

test('duplicate API-derived SKU filenames get a label-code suffix instead of overwriting', async () => {
  const duplicate = {
    ...READY_TARGET,
    productSkuId: 50588044854,
    labelCode: 78660415474,
  }
  const result = await runAdapter({
    phase: 'api_scan',
    params: { max_downloads: 2 },
    postImpl: async () => ({
      res: {
        total: 2,
        pageItems: [makePageItem(), makePageItem(duplicate)],
      },
    }),
  })

  assert.equal(result.meta.next_phase, 'api_care_query')
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.meta.shared.apiTargets.map(item => item.outputFilename))),
    [
      '209225117208-9950019805206-78660415473.pdf',
      '209225117208-9950019805206-78660415474.pdf',
    ],
  )
})

test('max_downloads limits a test run but zero remains full-batch mode', async () => {
  const second = {
    ...READY_TARGET,
    productSkuId: 50588044854,
    labelCode: 78660415474,
    skuExtCode: '9950019805207',
  }
  const result = await runAdapter({
    phase: 'api_scan',
    params: { max_downloads: 1 },
    postImpl: async () => ({
      res: {
        total: 400,
        pageItems: [makePageItem(), makePageItem(second)],
      },
    }),
  })

  assert.equal(result.meta.next_phase, 'api_care_query')
  assert.equal(result.meta.shared.apiTargets.length, 1)
  assert.equal(result.meta.shared.scanStoppedByLimit, true)
})

test('Excel mode deduplicates workbook rows and selects representative SKC targets', async () => {
  const rows = [
    {
      款号: '209225117208',
      颜色: '本白10101',
      尺码: '110',
      SKC: '20922511720810101',
      SKU编码: '20922511720810101110',
      SKU货号: '9950019805206',
      洗唛成分: '棉100%',
      产品线: '童装',
    },
    {
      款号: '209225117208',
      颜色: '本白10101',
      尺码: '110',
      SKC: '20922511720810101',
      SKU编码: '20922511720810101110',
      SKU货号: '9950019805206',
      洗唛成分: '棉100%',
      产品线: '童装',
    },
    {
      款号: '209225117208',
      颜色: '本白10101',
      尺码: '120',
      SKC: '20922511720810101',
      SKU编码: '20922511720810101120',
      SKU货号: '9950019805207',
      洗唛成分: '',
      产品线: '童装',
    },
    {
      款号: '209225117208',
      颜色: '酒红60904',
      尺码: '110',
      SKC: '20922511720860904',
      SKU编码: '20922511720860904110',
      SKU货号: '9950019805299',
      洗唛成分: '棉100%',
      产品线: '童装',
    },
  ]
  const result = await runAdapter({
    phase: 'excel_prepare',
    params: {
      input_file: { rows },
      pilot_style: '209225117208',
    },
  })

  assert.equal(result.meta.next_phase, 'api_lookup_excel_target')
  assert.equal(result.meta.shared.workflowMode, 'excel_representative_skc_download')
  assert.equal(result.meta.shared.workflowSummary.exactDuplicateRowsRemoved, 1)
  assert.equal(result.meta.shared.workflowSummary.selectedSkc, 2)
  assert.equal(result.meta.shared.workflowSummary.readyRows, 3)
  assert.equal(result.meta.shared.excelTargets.length, 2)
  assert.equal(result.meta.shared.excelTargets[0].skuCode, '20922511720810101110')
  assert.equal(result.meta.shared.excelTargets[0].skuNo, '9950019805206')
  assert.equal(result.meta.shared.excelTargets[0].outputFilename, '20922511720810101110-9950019805206.pdf')
})

test('Excel mode queries TEMU by representative SKU货号 and preserves Excel filename fields', async () => {
  const excelTarget = {
    style: '209225117208',
    color: '本白10101',
    skc: '20922511720810101',
    representativeSize: '110',
    skuCode: '20922511720810101110',
    skuNo: '9950019805206',
    sizeCount: 8,
    status: 'ready',
    outputFilename: '20922511720810101110-9950019805206.pdf',
  }
  const result = await runAdapter({
    phase: 'api_lookup_excel_target',
    shared: {
      excelTargets: [excelTarget],
      excelTarget,
      currentExcelTargetIndex: 0,
    },
    postImpl: async ({ requestPath, payload }) => {
      assert.equal(requestPath, '/visage-agent-seller/labelcode/pageQuery')
      assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
        page: 1,
        pageSize: 50,
        skuExtCodes: ['9950019805206'],
      })
      return { res: { total: 1, pageItems: [makePageItem()] } }
    },
  })

  assert.equal(result.meta.next_phase, 'api_care_query')
  assert.equal(result.meta.shared.apiTarget.excelSkuCode, '20922511720810101110')
  assert.equal(result.meta.shared.apiTarget.excelSkuNo, '9950019805206')
  assert.equal(result.meta.shared.apiTarget.outputFilename, '20922511720810101110-9950019805206.pdf')
  assert.equal(result.meta.shared.apiMadeWashLabelCount, 1)
})

test('Excel mode records TEMU pending labels without entering edit or save flow', async () => {
  const excelTarget = {
    style: '209225117208',
    color: '酒红60904',
    skc: '20922511720860904',
    representativeSize: '110',
    skuCode: '20922511720860904110',
    skuNo: '9950019805299',
    sizeCount: 8,
    status: 'ready',
    outputFilename: '20922511720860904110-9950019805299.pdf',
  }
  const pending = makePageItem({
    ...READY_TARGET,
    productSkuId: 76096921633,
    productSkcId: 77387807574,
    labelCode: 63511149186,
    skuExtCode: '9950019805299',
    cosmeticLabelStatus: 1,
  })
  const result = await runAdapter({
    phase: 'api_lookup_excel_target',
    shared: {
      excelTargets: [excelTarget],
      excelTarget,
      currentExcelTargetIndex: 0,
    },
    postImpl: async () => ({ res: { total: 1, pageItems: [pending] } }),
  })

  assert.equal(result.meta.next_phase, 'advance_excel_target')
  assert.equal(result.data[0].结果, 'needs_temu_creation')
  assert.equal(result.data[0].TEMU行状态, 'TEMU待制作')
  assert.match(result.data[0].原因, /未自动进入制作/)
  assert.equal(result.data[0].SKU编码, '20922511720860904110')
  assert.equal(result.data[0].SKU货号, '9950019805299')
})

test('page API failure stops safely without leaking auth-like values', async () => {
  const result = await runAdapter({
    phase: 'api_scan',
    shared: { apiScanAttempts: 2 },
    postImpl: async () => {
      throw new Error('Unauthorized Anti-Content=do-not-leak')
    },
  })

  assert.equal(result.meta.action, 'complete')
  assert.equal(result.data[0].结果, 'batch_scan_failed')
  assert.match(result.data[0].原因, /页面 API 批量扫描失败/)
  assert.doesNotMatch(result.data[0].API错误, /do-not-leak/)
  assert.match(result.data[0].API错误, /\[redacted\]/)
})

test('care API reads back the exact label dimensions before any export action', async () => {
  const result = await runAdapter({
    phase: 'api_care_query',
    shared: {
      apiValidated: true,
      apiTargets: [READY_TARGET],
      apiTarget: READY_TARGET,
      currentTargetIndex: 0,
      scanTotalRecords: 400,
    },
    postImpl: async ({ requestPath, payload }) => {
      assert.equal(requestPath, '/visage-agent-seller/labelcode/care/query')
      assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
        productId: READY_TARGET.productId,
        productSkuId: READY_TARGET.productSkuId,
      })
      return {
        res: {
          productId: READY_TARGET.productId,
          productSkuId: READY_TARGET.productSkuId,
          productSkcId: READY_TARGET.productSkcId,
          width: 35,
          len: 235,
          padding: 10,
          size: '110',
        },
      }
    },
  })

  assert.equal(result.meta.next_phase, 'prepare_search')
  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.careLabel)), {
    productId: READY_TARGET.productId,
    productSkuId: READY_TARGET.productSkuId,
    productSkcId: READY_TARGET.productSkcId,
    width: 35,
    len: 235,
    padding: 10,
    size: '110',
  })
})

test('one care-query failure is recorded and continues to the next batch target', async () => {
  const result = await runAdapter({
    phase: 'api_care_query',
    shared: {
      apiTargets: [READY_TARGET, { ...READY_TARGET, productSkuId: 50588044854 }],
      apiTarget: READY_TARGET,
      currentTargetIndex: 0,
      careQueryAttempts: 2,
    },
    postImpl: async () => {
      throw new Error('care unavailable')
    },
  })

  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'advance_target')
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].结果, 'official_download_failed')
  assert.match(result.data[0].原因, /详情 API 查询失败/)
})

test('DOM export targets the row whose labelCode and SKU ids match the current API record', async () => {
  const wrongExport = new FakeElement({ tagName: 'a', text: '导出' })
  const wrongRow = new FakeElement({
    tagName: 'tr',
    text: '已制作 洗水唛 导出 92688097345 24192957009 59045625798 9950019805206',
  }).setSelector('a,button,[role="button"]', [wrongExport])

  const targetExport = new FakeElement({ tagName: 'a', text: '导出' })
  const targetRow = new FakeElement({
    tagName: 'tr',
    text: '已制作 洗水唛 导出 78660415473 36970100333 50588044853 9950019805206',
  }).setSelector('a,button,[role="button"]', [targetExport])

  const document = baseDocument().setSelector('tr', [wrongRow, targetRow])
  const result = await runAdapter({
    phase: 'verify_search',
    document,
    shared: {
      apiValidated: true,
      apiTargets: [READY_TARGET],
      apiTarget: READY_TARGET,
      currentTargetIndex: 0,
      careLabel: { width: 35, len: 235, padding: 10, size: '110' },
    },
  })

  assert.equal(result.meta.next_phase, 'prepare_export')
  assert.equal(targetExport.clicked, 1)
  assert.equal(wrongExport.clicked, 0)
  assert.match(result.meta.shared.matchedRowText, /78660415473/)
})

test('export modal is forced to PDF-only and uses the API-derived filename', async () => {
  const pdf = new FakeElement({
    tagName: 'label',
    text: 'PDF',
    attrs: { 'data-checked': 'true' },
    toggleChecked: true,
  })
  const png = new FakeElement({
    tagName: 'label',
    text: 'PNG',
    attrs: { 'data-checked': 'true' },
    toggleChecked: true,
  })
  const confirm = new FakeElement({
    tagName: 'button',
    text: '确认无误，导出',
    rect: { left: 400, top: 300, width: 160, height: 40 },
  })
  const modal = new FakeElement({ text: '确认导出吗？ PDF PNG' })
    .setSelector('label[data-testid="beast-core-checkbox"]', [pdf, png])
    .setSelector('button', [confirm])
  const document = baseDocument().setSelector('[data-testid="beast-core-modal"]', [modal])
  const target = { ...READY_TARGET, outputFilename: '209225117208-9950019805206.pdf' }
  const shared = {
    apiValidated: true,
    apiTargets: [target],
    apiTarget: target,
    currentTargetIndex: 0,
    careLabel: { width: 35, len: 235, padding: 10, size: '110' },
  }

  const prepared = await runAdapter({ phase: 'prepare_export', document, shared })
  assert.equal(prepared.meta.next_phase, 'verify_export_options')
  assert.equal(pdf.getAttribute('data-checked'), 'true')
  assert.equal(png.getAttribute('data-checked'), 'false')

  const verified = await runAdapter({ phase: 'verify_export_options', document, shared })
  assert.equal(verified.meta.action, 'download_clicks')
  assert.equal(verified.meta.items.length, 1)
  assert.equal(verified.meta.items[0].filename, '209225117208-9950019805206.pdf')
  assert.equal(verified.meta.items[0].expected_magic, '%PDF-')
  assert.equal(verified.meta.items[0].capture_blob_download, true)
  assert.equal(verified.meta.items[0].source, 'temu_official_download')
  assert.equal(verified.meta.next_phase, 'verify_download')
})

test('export modal waits for the final PDF button to become enabled before clicking', async () => {
  const pdf = new FakeElement({
    tagName: 'label',
    text: 'PDF',
    attrs: { 'data-checked': 'true' },
  })
  const png = new FakeElement({
    tagName: 'label',
    text: 'PNG',
    attrs: { 'data-checked': 'false' },
  })
  const confirm = new FakeElement({
    tagName: 'button',
    text: '确认无误，导出',
    disabled: true,
  })
  const modal = new FakeElement({ text: '确认导出吗？ PDF PNG' })
    .setSelector('label[data-testid="beast-core-checkbox"]', [pdf, png])
    .setSelector('button', [confirm])
  const document = baseDocument().setSelector('[data-testid="beast-core-modal"]', [modal])
  const target = { ...READY_TARGET, outputFilename: '209225117208-9950019805206.pdf' }

  const result = await runAdapter({
    phase: 'verify_export_options',
    document,
    shared: {
      apiTargets: [target],
      apiTarget: target,
      currentTargetIndex: 0,
      exportConfirmAttempts: 3,
    },
  })

  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'verify_export_options')
  assert.equal(result.meta.shared.exportConfirmAttempts, 4)
})

test('export modal falls back to the TEMU pdfUrl blob when preview is rendered but the button stays disabled', async () => {
  const pdf = new FakeElement({
    tagName: 'label',
    text: 'PDF',
    attrs: { 'data-checked': 'true' },
  })
  const png = new FakeElement({
    tagName: 'label',
    text: 'PNG',
    attrs: { 'data-checked': 'false' },
  })
  const confirm = new FakeElement({
    tagName: 'button',
    text: '确认无误，导出',
    disabled: true,
  })
  const canvas = new FakeElement({ tagName: 'canvas' })
  canvas.width = 1050
  canvas.height = 7050
  const modal = new FakeElement({ text: '确认导出吗？ PDF PNG' })
    .setSelector('label[data-testid="beast-core-checkbox"]', [pdf, png])
    .setSelector('button', [confirm])
    .setSelector('canvas', [canvas])
  const document = baseDocument().setSelector('[data-testid="beast-core-modal"]', [modal])
  const target = {
    ...READY_TARGET,
    excelSkuCode: '20922511720810101110',
    excelSkuNo: '9950019805206',
    outputFilename: '20922511720810101110-9950019805206.pdf',
  }

  const result = await runAdapter({
    phase: 'verify_export_options',
    document,
    shared: {
      apiTargets: [target],
      apiTarget: target,
      currentTargetIndex: 0,
      exportConfirmAttempts: 40,
    },
  })

  assert.equal(result.meta.action, 'download_clicks')
  assert.equal(result.meta.items[0].clicks.length, 0)
  assert.equal(result.meta.items[0].filename, '20922511720810101110-9950019805206.pdf')
  assert.ok(result.meta.items[0].page_blob_expression.includes('memoizedProps.pdfUrl'))
  assert.equal(result.meta.shared.exportFallback, 'pdfUrl_blob')
})

test('successful download reports evidence and continues through the batch', async () => {
  const target = { ...READY_TARGET, outputFilename: '209225117208-9950019805206.pdf' }
  const result = await runAdapter({
    phase: 'verify_download',
    shared: {
      apiValidated: true,
      apiTargets: [target, { ...target, productSkuId: 50588044854 }],
      apiTarget: target,
      currentTargetIndex: 0,
      careLabel: { width: 35, len: 235, padding: 10, size: '110' },
      downloadResult: {
        items: [{
          success: true,
          signatureValidated: true,
          path: '/tmp/209225117208-9950019805206.pdf',
          bytes: 12345,
          matchedBy: 'fallback_any_pdf',
          browserDownloadControl: { method: 'Page.setDownloadBehavior' },
        }],
      },
    },
  })

  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'advance_target')
  assert.equal(result.data[0].结果, 'official_download_received')
  assert.equal(result.data[0].来源, 'temu_official_download')
  assert.equal(result.data[0].SKU编码, READY_TARGET.skcExtCode)
  assert.equal(result.data[0].SKU货号, READY_TARGET.skuExtCode)
  assert.equal(result.data[0].文件名, '209225117208-9950019805206.pdf')
  assert.equal(result.data[0].PDF签名已校验, true)
  assert.equal(result.data[0].页面API已校验, true)
  assert.equal(result.data[0].洗水唛宽度mm, 35)
  assert.equal(result.data[0].洗水唛长度mm, 235)
})

test('download verification prefers a later successful signed item over an earlier failed attempt', async () => {
  const target = { ...READY_TARGET, outputFilename: '209225117208-9950019805206.pdf' }
  const result = await runAdapter({
    phase: 'verify_download',
    shared: {
      apiValidated: true,
      apiTargets: [target],
      apiTarget: target,
      currentTargetIndex: 0,
      careLabel: { width: 35, len: 235, padding: 10, size: '110' },
      downloadResult: {
        items: [
          { success: false, error: 'native download did not report a path' },
          {
            success: true,
            signatureValidated: true,
            path: '/tmp/official.pdf',
            bytes: 712785,
            matchedBy: 'page_blob_expression',
          },
        ],
      },
    },
  })

  assert.equal(result.meta.next_phase, 'advance_target')
  assert.equal(result.data[0].结果, 'official_download_received')
  assert.equal(result.data[0].文件路径, '/tmp/official.pdf')
  assert.equal(result.data[0].文件大小, 712785)
  assert.equal(result.data[0].PDF签名已校验, true)
})

test('download verification accepts legacy runner success with a path', async () => {
  const target = { ...READY_TARGET, outputFilename: '209225117208-9950019805206.pdf' }
  const result = await runAdapter({
    phase: 'verify_download',
    shared: {
      apiValidated: true,
      apiTargets: [target],
      apiTarget: target,
      currentTargetIndex: 0,
      careLabel: { width: 35, len: 235, padding: 10, size: '110' },
      downloadResult: {
        items: [{
          success: true,
          path: '/tmp/legacy-runner.pdf',
          filename: '209225117208-9950019805206.pdf',
          matchedBy: 'expected_name',
        }],
      },
    },
  })

  assert.equal(result.data[0].结果, 'official_download_received')
  assert.equal(result.data[0].文件路径, '/tmp/legacy-runner.pdf')
  assert.equal(result.data[0].PDF签名已校验, true)
})

test('advance_target selects the next API target and completes only after the last one', async () => {
  const second = { ...READY_TARGET, productSkuId: 50588044854, labelCode: 78660415474 }
  const advanced = await runAdapter({
    phase: 'advance_target',
    shared: {
      apiTargets: [READY_TARGET, second],
      apiTarget: READY_TARGET,
      currentTargetIndex: 0,
    },
  })

  assert.equal(advanced.meta.next_phase, 'api_care_query')
  assert.equal(advanced.meta.shared.currentTargetIndex, 1)
  assert.equal(advanced.meta.shared.apiTarget.productSkuId, second.productSkuId)

  const complete = await runAdapter({
    phase: 'advance_target',
    shared: {
      apiTargets: [READY_TARGET, second],
      apiTarget: second,
      currentTargetIndex: 1,
    },
  })
  assert.equal(complete.meta.action, 'complete')
})
