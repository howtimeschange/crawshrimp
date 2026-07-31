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

const LATEST_CARE_TEXT = [
  'Maximum washing temperature 30°C',
  'Do not bleach',
  'Line drying in the shade',
  'Iron at maximum sole-plate temperature of 110°C without steam',
  'Do not dry clean',
].join('\n')

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

const ENTERPRISE_TARGET = {
  inputMode: 'enterprise_code',
  style: '',
  color: '',
  skc: '',
  representativeSize: '',
  skuCode: '',
  skuNo: '9950019805206',
  enterpriseCode: '9950019805206',
  composition: '',
  compositionSource: 'scm_or_manual',
  productLine: '',
  sizeCount: 1,
  status: 'ready',
  outputFilename: '',
}

const SCM_ROWS = [
  {
    ORDER_NO: 'XM241115000025',
    BRAND: '20',
    BRAND_DISPLAY: '巴拉巴拉',
    P_MAT_CODE: '209225117208',
    P_MAT_NAME: '测试童装',
    SKC_CODE: '20922511720810101',
    F1: '10101',
    F1_DISPLAY: '本白10101',
    C_COMPONENT: '面料：95%棉 5%氨纶 （配料除外）',
    E_COMPONENT: 'Fabric:95% COTTON 5% ELASTANE(Except accessories)',
    H_STATUS: 100,
    SKC_RESULT: 0,
    SKC_REMARK: LATEST_CARE_TEXT,
    SKC_FILE_URL1: 'https://scmobsprd.semirapp.com/SF_DYNA/ATTACH/label.pdf',
    SKC_FILE_URL2: '',
    LAST_MODIFIED_TIME: '2026-07-31 09:00:00',
    TREE_LEVEL: '2',
  },
  {
    ORDER_NO: 'XM241115000025',
    BRAND: '20',
    BRAND_DISPLAY: '巴拉巴拉',
    P_MAT_CODE: '209225117208',
    P_MAT_NAME: '测试童装',
    SKC_CODE: '20922511720860904',
    F1: '60904',
    F1_DISPLAY: '酒红60904',
    C_COMPONENT: '面料：95%棉 5%氨纶 （配料除外）',
    E_COMPONENT: 'Fabric:95% COTTON 5% ELASTANE(Except accessories)',
    H_STATUS: 100,
    SKC_RESULT: 0,
    SKC_REMARK: '',
    SKC_FILE_URL1: 'https://scmobsprd.semirapp.com/SF_DYNA/ATTACH/label2.pdf',
    SKC_FILE_URL2: '',
    LAST_MODIFIED_TIME: '2026-07-31 09:00:00',
    TREE_LEVEL: '2',
  },
]

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

test('enterprise-code preparation does not require Excel and deduplicates codes', async () => {
  const result = await runAdapter({
    phase: 'excel_prepare',
    params: {
      enterprise_codes: '9950019805206\n20922511720810101110-9950019805206.pdf\n9950019805299',
      max_skc: 0,
    },
  })

  assert.equal(result.meta.next_phase, 'api_lookup_excel_target')
  assert.equal(result.meta.shared.workflowMode, 'enterprise_code_create_and_download')
  assert.equal(result.meta.shared.total_rows, 2)
  assert.equal(result.meta.shared.workflowSummary.exactDuplicateCodesRemoved, 1)
  assert.deepEqual(
    Array.from(result.meta.shared.excelTargets.map(item => item.enterpriseCode)),
    ['9950019805206', '9950019805299'],
  )
})

test('pending TEMU wash label requests SCM lookup before care query', async () => {
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

  assert.equal(result.meta.next_phase, 'scm_lookup_target')
  assert.equal(result.meta.shared.apiTarget.productSkuId, PENDING_TARGET.productSkuId)
  assert.equal(result.meta.shared.apiTarget.excelSkuCode, '20922511720860904110')
  assert.equal(result.meta.shared.temuRowStatus, 'TEMU待制作')
})

test('enterprise code lookup queries TEMU by enterprise code and then requests SCM lookup', async () => {
  const result = await runAdapter({
    phase: 'api_lookup_excel_target',
    shared: {
      excelTargets: [ENTERPRISE_TARGET],
      excelTarget: ENTERPRISE_TARGET,
      currentExcelTargetIndex: 0,
    },
    postImpl: async ({ requestPath, payload }) => {
      assert.equal(requestPath, '/visage-agent-seller/labelcode/pageQuery')
      assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
        page: 1,
        pageSize: 50,
        skuExtCodes: ['9950019805206'],
      })
      return { res: { total: 1, pageItems: [makePageItem({ ...PENDING_TARGET, skuExtCode: '9950019805206' })] } }
    },
  })

  assert.equal(result.meta.next_phase, 'scm_lookup_target')
  assert.equal(result.meta.shared.apiTarget.enterpriseCode, '9950019805206')
  assert.equal(result.meta.shared.apiTarget.excelStyle, '209225117208')
  assert.equal(result.meta.shared.apiTarget.outputFilename, '209225117208-9950019805206.pdf')
})

test('SCM lookup phase evaluates the logged-in SCM tab without copying credentials', async () => {
  const result = await runAdapter({
    phase: 'scm_lookup_target',
    shared: {
      apiTarget: { ...PENDING_TARGET, ...ENTERPRISE_TARGET, excelStyle: '209225117208' },
      excelTargets: [ENTERPRISE_TARGET],
      excelTarget: ENTERPRISE_TARGET,
    },
  })

  assert.equal(result.meta.action, 'cdp_target_eval')
  assert.equal(result.meta.next_phase, 'verify_scm_lookup')
  assert.equal(result.meta.shared_key, 'scmLookupResult')
  assert.deepEqual(Array.from(result.meta.target_url_contains), ['scm.semir.com'])
  assert.match(result.meta.expression, /scm-qc-wash-appr-index/)
  assert.match(result.meta.expression, /input_0_P_MAT_CODE/)
  assert.match(result.meta.expression, /innerText \|\| value\.textContent/)
  assert.doesNotMatch(result.meta.expression, /cookie|localStorage|sf-token|Anti-Content/i)
})

test('SCM lookup result attaches completed composition evidence before care query', async () => {
  const apiTarget = { ...PENDING_TARGET, ...ENTERPRISE_TARGET, excelStyle: '209225117208' }
  const result = await runAdapter({
    phase: 'verify_scm_lookup',
    shared: {
      apiTarget,
      excelTargets: [ENTERPRISE_TARGET],
      excelTarget: ENTERPRISE_TARGET,
      scmLookupResult: {
        ok: true,
        value: {
          ok: true,
          source: 'scm_qc_wash_appr_page_component',
          rows: SCM_ROWS,
          recordsTotal: 2,
        },
      },
    },
  })

  assert.equal(result.meta.next_phase, 'api_care_query')
  assert.equal(result.meta.shared.apiTarget.excelComposition, '面料：95%棉 5%氨纶 （配料除外）')
  assert.equal(result.meta.shared.apiTarget.excelCompositionSource, 'scm_qc_wash_appr_page')
  assert.equal(result.meta.shared.apiTarget.scmOrderNo, 'XM241115000025')
  assert.equal(result.meta.shared.apiTarget.scmColorCode, '10101')
  assert.equal(result.meta.shared.apiTarget.scmCareInstructionText, LATEST_CARE_TEXT.replace(/\s+/g, ' ').trim())
})

test('SCM lookup failure continues with fixed care symbols instead of failing the item', async () => {
  const apiTarget = { ...PENDING_TARGET, ...ENTERPRISE_TARGET, excelStyle: '209225117208' }
  const result = await runAdapter({
    phase: 'verify_scm_lookup',
    shared: {
      apiTarget,
      excelTargets: [ENTERPRISE_TARGET],
      excelTarget: ENTERPRISE_TARGET,
      scmLookupAttempts: 12,
      scmLookupResult: {
        ok: false,
        error: 'SCM login expired',
      },
    },
  })

  assert.equal(result.meta.next_phase, 'api_care_query')
  assert.equal(result.data.length, 0)
  assert.equal(result.meta.shared.scmLookupStatus, 'SCM查询失败，使用固定洗护符号')
  assert.equal(result.meta.shared.apiTarget.scmLookupFailedReason, 'SCM login expired')
})

test('SCM evidence without composition still continues for care-symbol mapping', async () => {
  const apiTarget = { ...PENDING_TARGET, ...ENTERPRISE_TARGET, excelStyle: '209225117208' }
  const rowsWithoutComposition = SCM_ROWS.map(row => ({
    ...row,
    C_COMPONENT: '',
    E_COMPONENT: '',
  }))
  const result = await runAdapter({
    phase: 'verify_scm_lookup',
    shared: {
      apiTarget,
      excelTargets: [ENTERPRISE_TARGET],
      excelTarget: ENTERPRISE_TARGET,
      scmLookupResult: {
        ok: true,
        value: {
          ok: true,
          source: 'scm_qc_wash_appr_page_component',
          rows: rowsWithoutComposition,
          recordsTotal: 2,
        },
      },
    },
  })

  assert.equal(result.meta.next_phase, 'api_care_query')
  assert.equal(result.data.length, 0)
  assert.equal(result.meta.shared.apiTarget.excelComposition, '')
  assert.equal(result.meta.shared.apiTarget.scmCareInstructionText, LATEST_CARE_TEXT.replace(/\s+/g, ' ').trim())
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

test('care query infers SKU code from SCM SKC plus TEMU size for enterprise filename', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    excelStyle: '209225117208',
    excelSkc: '20922511720810101',
    excelSkuNo: '9950019805206',
    enterpriseCode: '9950019805206',
    outputFilename: '209225117208-9950019805206.pdf',
  }
  const result = await runAdapter({
    phase: 'api_care_query',
    shared: { apiTarget, excelTargets: [ENTERPRISE_TARGET], excelTarget: ENTERPRISE_TARGET },
    postImpl: async () => careQueryResponse({ size: '110' }),
  })

  assert.equal(result.meta.next_phase, 'prepare_care_payload')
  assert.equal(result.meta.shared.apiTarget.excelSkuCode, '20922511720810101110')
  assert.equal(result.meta.shared.apiTarget.outputFilename, '20922511720810101110-9950019805206.pdf')
})

test('dry-run prepares fixed payload with latest TEMU symbol enums and never saves', async () => {
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
    washing: 10,
    bleaching: 3,
    drying: 5,
    ironing: 3,
    dryCleaning: 5,
  })
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsSource, 'missing_scm_care_instruction_text')
  assert.equal(result.meta.shared.carePayload.manufacturerAddressPg, 'No.98, Nanhui Road, Louqiao Industrial Park, Ouhai District, Wenzhou/Zhejiang, China')
})

test('dry-run maps SCM wash-care text to TEMU symbol enums', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    excelStyle: EXCEL_TARGET.style,
    outputFilename: EXCEL_TARGET.outputFilename,
    scmCareInstructionText: LATEST_CARE_TEXT,
  }
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
  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.carePayloadSummary.careSymbols)), {
    washing: 10,
    bleaching: 3,
    drying: 5,
    ironing: 3,
    dryCleaning: 5,
  })
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsSource, 'scm_instruction_mapping')
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsLabels.drying, 'Line drying in the shade')
})

test('dry-run reports the minimum label length used to keep the QR code visible', async () => {
  const apiTarget = { ...PENDING_TARGET, excelStyle: EXCEL_TARGET.style, outputFilename: EXCEL_TARGET.outputFilename }
  const result = await runAdapter({
    phase: 'prepare_care_payload',
    params: { label_length_mm: 235 },
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      careInitial: careQueryResponse({ len: 180, width: 35, padding: 10 }).res,
      careLabel: { width: 35, len: 180, padding: 10, size: '110' },
    },
  })

  assert.equal(result.meta.shared.carePayload.len, 235)
  assert.equal(result.meta.shared.carePayloadSummary.lengthStrategy, 'minimum_for_full_qr')
  assert.equal(result.data[0].洗水唛长度mm, 235)
  assert.equal(result.data[0].洗水唛尺码, '110')
})

test('dry-run keeps SCM composition as evidence and preserves TEMU material payload', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    excelStyle: '209225117208',
    excelSkuCode: '20922511720810101110',
    excelSkuNo: '9950019805206',
    enterpriseCode: '9950019805206',
    excelComposition: '面料：95%棉 5%氨纶 （配料除外）',
    excelEnglishComposition: 'Fabric:95% COTTON 5% ELASTANE(Except accessories)',
    excelCompositionSource: 'scm_qc_wash_appr_page',
    outputFilename: '20922511720810101110-9950019805206.pdf',
  }
  const result = await runAdapter({
    phase: 'prepare_care_payload',
    params: {
      scm_composition_mode: 'safe_simple',
      care_symbols_mode: 'scm_confirmed_json',
      care_symbols_json: '{"washing":10,"bleaching":3,"drying":5,"ironing":3,"dryCleaning":5}',
    },
    shared: {
      apiTarget,
      excelTargets: [ENTERPRISE_TARGET],
      excelTarget: ENTERPRISE_TARGET,
      careInitial: careQueryResponse({
        materialInfoList: [{ name: '旧成分', proportion: '100' }],
        materialI18nInfoList: [{ lan: 'en', propValue: 'OLD', proportion: '100' }],
      }).res,
      careLabel: { width: 35, len: 235, padding: 10, size: '110' },
    },
  })

  assert.equal(result.meta.next_phase, 'advance_excel_target')
  assert.equal(result.meta.shared.carePayloadSummary.compositionMode, 'scm_evidence_only_not_written')
  assert.match(result.meta.shared.carePayloadSummary.compositionModeReason, /成分不回填/)
  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.carePayload.materialInfoList)), [
    { name: '旧成分', proportion: '100' },
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.carePayload.materialI18nInfoList)), [
    { lan: 'en', propValue: 'OLD', proportion: '100' },
  ])
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
