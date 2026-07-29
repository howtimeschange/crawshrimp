import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/temu/wash-label-create-and-download.js')
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

const PENDING_TARGET = {
  productId: 6903495115,
  productSkuId: 76096921633,
  productSkcId: 77387807574,
  labelCode: 63511149186,
  skcExtCode: '209225117208',
  skuExtCode: '9950019805299',
  labelType: 3,
  cosmeticLabelStatus: 1,
  needCosmeticLabel: true,
}

class FakeElement {
  constructor(options = {}) {
    this.tagName = String(options.tagName || 'DIV').toUpperCase()
    this._text = String(options.text || '')
    this._rect = options.rect || { left: 0, top: 0, width: 160, height: 32 }
    this._style = { display: 'block', visibility: 'visible', ...options.style }
  }

  get innerText() { return this._text }
  get textContent() { return this._text }

  getClientRects() {
    return this._style.display === 'none' || this._style.visibility === 'hidden' ? [] : [this._rect]
  }

  getBoundingClientRect() { return this._rect }
  querySelectorAll() { return [] }
  querySelector() { return null }
  click() {}
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

  querySelectorAll(selector) { return this._selectors.get(selector) || [] }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
}

function makePageItem(target = READY_TARGET) {
  return {
    productId: target.productId,
    productName: '测试商品',
    labelCodeVO: {
      productSkuId: target.productSkuId,
      productSkcId: target.productSkcId,
      labelCode: target.labelCode,
      skcExtCode: target.skcExtCode,
      skuExtCode: target.skuExtCode,
    },
    labelRequirement: {
      labelType: target.labelType,
      cosmeticLabelStatus: target.cosmeticLabelStatus,
      needCosmeticLabel: target.needCosmeticLabel,
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
  webpackRequire.m = { 45689: () => {} }
  const chunks = []
  chunks.push = payload => {
    payload[2](webpackRequire)
    return 1
  }
  return chunks
}

function baseDocument() {
  return new FakeDocument().setSelector('[class*="account-info_accountInfo"]', [
    new FakeElement({ text: 'balabala Official Shop' }),
  ])
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
      execute_mode: 'dry_run',
      allow_save: false,
      download_after_save: true,
      skip_already_made: true,
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

const EXCEL_TARGET = {
  style: '209225117208',
  color: '酒红60904',
  skc: '20922511720860904',
  representativeSize: '110',
  skuCode: '20922511720860904110',
  skuNo: '9950019805299',
  composition: '棉95% 氨纶5%',
  compositionSource: 'current_row',
  productLine: '童装',
  sizeCount: 8,
  status: 'ready',
  outputFilename: '20922511720860904110-9950019805299.pdf',
}

function careQueryResponse(overrides = {}) {
  return {
    res: {
      productId: PENDING_TARGET.productId,
      productSkuId: PENDING_TARGET.productSkuId,
      productSkcId: PENDING_TARGET.productSkcId,
      size: '110',
      manufacturerNameOptions: ['Zhejiang Semir Garment Co.,Ltd.'],
      manufacturerAddressOptions: ['No.98, Nanhui Road, Louqiao Industrial Park, Ouhai District, Wenzhou/Zhejiang, China'],
      showTrackingLabel: true,
      materialInfoList: [{ name: '棉', proportion: '95' }],
      materialI18nInfoList: [{ lan: 'en', propValue: 'Cotton', proportion: '95' }],
      ...overrides,
    },
  }
}

test('Crawshrimp main phase always enters Excel preparation for create workflow', async () => {
  const result = await runAdapter({ phase: 'main' })

  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'excel_prepare')
})

test('Excel preparation selects SKC representative and carries composition context', async () => {
  const result = await runAdapter({
    phase: 'excel_prepare',
    params: {
      input_file: {
        rows: [{
          款号: '209225117208',
          颜色: '酒红60904',
          尺码: '110',
          SKC: '20922511720860904',
          SKU编码: '20922511720860904110',
          SKU货号: '9950019805299',
          洗唛成分: '棉95% 氨纶5%',
          产品线: '童装',
        }],
      },
    },
  })

  assert.equal(result.meta.next_phase, 'api_lookup_excel_target')
  assert.equal(result.meta.shared.workflowMode, 'excel_representative_skc_create_and_download')
  assert.equal(result.meta.shared.total_rows, 1)
  assert.equal(result.meta.shared.excelTargets[0].composition, '棉95% 氨纶5%')
  assert.equal(result.meta.shared.excelTargets[0].outputFilename, '20922511720860904110-9950019805299.pdf')
})

test('pending TEMU wash label enters care query instead of being skipped', async () => {
  const result = await runAdapter({
    phase: 'api_lookup_excel_target',
    shared: {
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      currentExcelTargetIndex: 0,
    },
    postImpl: async ({ requestPath, payload }) => {
      assert.equal(requestPath, '/visage-agent-seller/labelcode/pageQuery')
      assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
        page: 1,
        pageSize: 50,
        skuExtCodes: ['9950019805299'],
      })
      return { res: { total: 1, pageItems: [makePageItem(PENDING_TARGET)] } }
    },
  })

  assert.equal(result.meta.next_phase, 'api_care_query')
  assert.equal(result.meta.shared.apiTarget.productSkuId, PENDING_TARGET.productSkuId)
  assert.equal(result.meta.shared.apiTarget.excelSkuCode, '20922511720860904110')
  assert.equal(result.meta.shared.temuRowStatus, 'TEMU待制作')
})

test('care query for pending label falls back to configured TEMU label dimensions', async () => {
  const apiTarget = { ...PENDING_TARGET, ...EXCEL_TARGET, excelStyle: EXCEL_TARGET.style }
  const result = await runAdapter({
    phase: 'api_care_query',
    shared: { apiTarget, excelTargets: [EXCEL_TARGET], excelTarget: EXCEL_TARGET },
    postImpl: async ({ requestPath }) => {
      assert.equal(requestPath, '/visage-agent-seller/labelcode/care/query')
      return careQueryResponse()
    },
  })

  assert.equal(result.meta.next_phase, 'prepare_care_payload')
  assert.equal(result.meta.shared.careLabel.width, 35)
  assert.equal(result.meta.shared.careLabel.len, 235)
  assert.equal(result.meta.shared.careInitial.manufacturerNameOptions[0], 'Zhejiang Semir Garment Co.,Ltd.')
})

test('dry-run prepares pilot payload with confirmed TEMU symbol enums and never saves', async () => {
  const apiTarget = { ...PENDING_TARGET, excelStyle: EXCEL_TARGET.style, outputFilename: EXCEL_TARGET.outputFilename }
  const result = await runAdapter({
    phase: 'prepare_care_payload',
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      careInitial: careQueryResponse().res,
      careLabel: { width: 35, len: 235, padding: 10, size: '110' },
    },
  })

  assert.equal(result.meta.next_phase, 'advance_excel_target')
  assert.equal(result.data[0].结果, 'create_payload_ready')
  assert.match(result.data[0].原因, /dry_run/)
  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.carePayloadSummary.careSymbols)), {
    washing: 13,
    bleaching: 3,
    drying: 8,
    ironing: 3,
    dryCleaning: 5,
  })
  assert.equal(result.meta.shared.carePayload.manufacturerAddressPg, 'No.98, Nanhui Road, Louqiao Industrial Park, Ouhai District, Wenzhou/Zhejiang, China')
})

test('create mode is still blocked unless allow_save is explicitly true', async () => {
  const apiTarget = { ...PENDING_TARGET, excelStyle: EXCEL_TARGET.style }
  const result = await runAdapter({
    phase: 'prepare_care_payload',
    params: { execute_mode: 'create_and_download', allow_save: false },
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      careInitial: careQueryResponse().res,
    },
  })

  assert.equal(result.meta.next_phase, 'advance_excel_target')
  assert.equal(result.data[0].结果, 'create_payload_ready')
  assert.match(result.data[0].原因, /allow_save/)
})

test('save phase calls TEMU care create only with explicit double opt-in', async () => {
  const apiTarget = { ...PENDING_TARGET, excelStyle: EXCEL_TARGET.style }
  let observed = null
  const result = await runAdapter({
    phase: 'save_care_label',
    params: { execute_mode: 'create_and_download', allow_save: true },
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      carePayload: {
        productSkuId: PENDING_TARGET.productSkuId,
        productSkcId: PENDING_TARGET.productSkcId,
        productId: PENDING_TARGET.productId,
        manufacturerName: 'Zhejiang Semir Garment Co.,Ltd.',
        manufacturerAddressPg: 'No.98, Nanhui Road, Louqiao Industrial Park, Ouhai District, Wenzhou/Zhejiang, China',
        batchNumber: 'PC260601',
        productionDate: '2026-06-01',
        washing: 13,
        bleaching: 3,
        drying: 8,
        ironing: 3,
        dryCleaning: 5,
        len: 235,
        width: 35,
        padding: 10,
        ukfrInfo: {},
        ingLangs: ['en'],
      },
    },
    postImpl: async request => {
      observed = request
      return { res: {} }
    },
  })

  assert.equal(observed.requestPath, '/visage-agent-seller/labelcode/care/create')
  assert.equal(observed.payload.productSkuId, PENDING_TARGET.productSkuId)
  assert.equal(observed.payload.productionDate, '2026-06-01')
  assert.equal(result.meta.next_phase, 'post_save_lookup')
})

test('post-save lookup waits until TEMU reports downloadable and preserves Excel filename', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    excelStyle: EXCEL_TARGET.style,
    excelSkuCode: EXCEL_TARGET.skuCode,
    excelSkuNo: EXCEL_TARGET.skuNo,
    outputFilename: EXCEL_TARGET.outputFilename,
  }
  const result = await runAdapter({
    phase: 'post_save_lookup',
    params: { execute_mode: 'create_and_download', allow_save: true },
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      carePayloadSummary: { width: 35, len: 235, padding: 10 },
    },
    postImpl: async () => ({ res: { total: 1, pageItems: [makePageItem({ ...PENDING_TARGET, cosmeticLabelStatus: 2 })] } }),
  })

  assert.equal(result.meta.next_phase, 'api_care_query')
  assert.equal(result.meta.shared.apiTarget.outputFilename, '20922511720860904110-9950019805299.pdf')
  assert.equal(result.meta.shared.apiTarget.cosmeticLabelStatus, 2)
})

test('download verification prefers the successful signed fallback item', async () => {
  const target = { ...READY_TARGET, outputFilename: '20922511720810101110-9950019805206.pdf' }
  const result = await runAdapter({
    phase: 'verify_download',
    shared: {
      apiValidated: true,
      apiTarget: target,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      currentExcelTargetIndex: 0,
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

  assert.equal(result.meta.next_phase, 'advance_excel_target')
  assert.equal(result.data[0].结果, 'official_download_received')
  assert.equal(result.data[0].文件路径, '/tmp/official.pdf')
  assert.equal(result.data[0].文件大小, 712785)
  assert.equal(result.data[0].PDF签名已校验, true)
})

test('download verification accepts legacy runner success with a path', async () => {
  const target = { ...READY_TARGET, outputFilename: '20922511720810101110-9950019805206.pdf' }
  const result = await runAdapter({
    phase: 'verify_download',
    shared: {
      apiValidated: true,
      apiTarget: target,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      currentExcelTargetIndex: 0,
      careLabel: { width: 35, len: 235, padding: 10, size: '110' },
      downloadResult: {
        items: [{
          success: true,
          path: '/tmp/legacy-runner.pdf',
          filename: '20922511720810101110-9950019805206.pdf',
          matchedBy: 'expected_name',
        }],
      },
    },
  })

  assert.equal(result.data[0].结果, 'official_download_received')
  assert.equal(result.data[0].文件路径, '/tmp/legacy-runner.pdf')
  assert.equal(result.data[0].PDF签名已校验, true)
})
