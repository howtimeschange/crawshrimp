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
const TEMU_HAND_WASH_40_LABEL = 'Hand wash, maximum temperature 40℃'
const TEMU_LOW_IRON_LABEL = 'Iron at maximal sole plate temperature 120℃, steam may cause irreversible damage'

const ROW_MANUFACTURER_NAME = 'Custom Template Garment Co.,Ltd.'
const ROW_MANUFACTURER_ADDRESS = 'No.1 Template Road, Wenzhou/Zhejiang, China'

class FakeElement {
  constructor(options = {}) {
    this.tagName = String(options.tagName || 'DIV').toUpperCase()
    this._text = String(options.text || '')
    this._rect = options.rect || { left: 0, top: 0, width: 160, height: 32 }
    this._style = { display: 'block', visibility: 'visible', ...options.style }
    this._attrs = { ...options.attrs }
  }

  get innerText() { return this._text }
  get textContent() { return this._text }

  getClientRects() {
    return this._style.display === 'none' || this._style.visibility === 'hidden' ? [] : [this._rect]
  }

  getBoundingClientRect() { return this._rect }
  querySelectorAll() { return [] }
  querySelector() { return null }
  getAttribute(name) { return this._attrs?.[name] ?? null }
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

test('Excel preparation creates style targets and carries wash-label config', async () => {
  const result = await runAdapter({
    phase: 'excel_prepare',
    params: {
      input_file: {
        rows: [{
          款号: '209225117208',
          制造商名称: ROW_MANUFACTURER_NAME,
          制造商地址: ROW_MANUFACTURER_ADDRESS,
          生产日期: '2024-10-18',
          批次号: 'PC241018',
          洗水唛宽度mm: '35mm',
          洗水唛长度mm: '230',
          上下预留mm: '10',
        }],
      },
    },
  })

  assert.equal(result.meta.next_phase, 'api_lookup_excel_target')
  assert.equal(result.meta.shared.workflowMode, 'excel_style_code_create_and_download')
  assert.equal(result.meta.shared.total_rows, 1)
  assert.equal(result.meta.shared.progress_kind, 'temu_ai_wash_label')
  assert.equal(result.meta.shared.wash_label_stage, 'expand_style')
  assert.equal(result.meta.shared.style_total, 1)
  assert.equal(result.meta.shared.style_completed, 0)
  assert.equal(result.meta.shared.style_current, '209225117208')
  assert.equal(result.meta.shared.sku_total, 0)
  assert.equal(result.meta.shared.sku_completed, 0)
  assert.match(result.meta.shared.current_store, /AI洗唛制作 \/ 展开款号 1\/1/)
  assert.equal(result.meta.shared.excelTargets[0].inputMode, 'style_code')
  assert.equal(result.meta.shared.excelTargets[0].style, '209225117208')
  assert.equal(result.meta.shared.excelTargets[0].skuNo, '')
  assert.equal(result.meta.shared.excelTargets[0].compositionSource, 'scm_or_manual')
  assert.equal(result.meta.shared.excelTargets[0].manufacturerName, ROW_MANUFACTURER_NAME)
  assert.equal(result.meta.shared.excelTargets[0].manufacturerAddress, ROW_MANUFACTURER_ADDRESS)
  assert.equal(result.meta.shared.excelTargets[0].productionDate, '2024-10-18')
  assert.equal(result.meta.shared.excelTargets[0].batchNumber, 'PC241018')
  assert.equal(result.meta.shared.excelTargets[0].labelWidthMm, 35)
  assert.equal(result.meta.shared.excelTargets[0].labelLengthMm, 230)
  assert.equal(result.meta.shared.excelTargets[0].labelPaddingMm, 10)
  assert.equal(result.meta.shared.excelTargets[0].outputFilename, '')
})

test('Excel preparation accepts xlsx date-time cells for production date', async () => {
  const result = await runAdapter({
    phase: 'excel_prepare',
    params: {
      input_file: {
        rows: [{
          款号: '208326105215',
          生产日期: '2026-07-01 00:00:00',
          批次号: 'PC241016',
          洗水唛宽度mm: 45,
          洗水唛长度mm: 270,
          上下预留mm: 10,
        }],
      },
    },
  })

  assert.equal(result.meta.next_phase, 'api_lookup_excel_target')
  assert.equal(result.meta.shared.excelTargets[0].status, 'ready')
  assert.equal(result.meta.shared.excelTargets[0].reason, '')
  assert.equal(result.meta.shared.excelTargets[0].productionDate, '2026-07-01')
  assert.equal(result.meta.shared.excelTargets[0].labelLengthMm, 270)
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

test('style-code preparation creates a style-first workflow without Excel', async () => {
  const result = await runAdapter({
    phase: 'excel_prepare',
    params: {
      style_codes: '208326104207\n208326104207\n208226117107',
      max_skc: 0,
    },
  })

  assert.equal(result.meta.next_phase, 'api_lookup_excel_target')
  assert.equal(result.meta.shared.workflowMode, 'style_code_create_and_download')
  assert.equal(result.meta.shared.total_rows, 2)
  assert.equal(result.meta.shared.workflowSummary.exactDuplicateStylesRemoved, 1)
  assert.deepEqual(
    Array.from(result.meta.shared.excelTargets.map(item => item.style)),
    ['208326104207', '208226117107'],
  )
})

test('pending TEMU wash label requests SCM lookup before care query', async () => {
  const excelTarget = {
    ...EXCEL_TARGET,
    manufacturerName: ROW_MANUFACTURER_NAME,
    manufacturerAddress: ROW_MANUFACTURER_ADDRESS,
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
        skuExtCodes: ['9950019805299'],
      })
      return { res: { total: 1, pageItems: [makePageItem(PENDING_TARGET)] } }
    },
  })

  assert.equal(result.meta.next_phase, 'scm_lookup_target')
  assert.equal(result.meta.shared.apiTarget.productSkuId, PENDING_TARGET.productSkuId)
  assert.equal(result.meta.shared.apiTarget.excelSkuCode, '20922511720860904110')
  assert.equal(result.meta.shared.apiTarget.excelManufacturerName, ROW_MANUFACTURER_NAME)
  assert.equal(result.meta.shared.apiTarget.excelManufacturerAddress, ROW_MANUFACTURER_ADDRESS)
  assert.equal(result.meta.shared.temuRowStatus, 'TEMU待制作')
})

test('style-code lookup expands a款号 into SKU targets and records print-only rows', async () => {
  const styleTarget = {
    inputMode: 'style_code',
    style: '208326104207',
    skc: '208326104207',
    skuNo: '',
    manufacturerName: ROW_MANUFACTURER_NAME,
    manufacturerAddress: ROW_MANUFACTURER_ADDRESS,
    productionDate: '2024-10-18',
    batchNumber: 'PC241018',
    labelWidthMm: 45,
    labelLengthMm: 230,
    labelPaddingMm: 10,
    status: 'ready',
  }
  const printOnlyTarget = {
    ...PENDING_TARGET,
    productSkuId: 70000000001,
    productSkcId: 70000000002,
    labelCode: 70000000003,
    skcExtCode: '208326104207',
    skuExtCode: '6900137783170',
    labelType: 0,
    cosmeticLabelStatus: 0,
    needCosmeticLabel: false,
  }
  const result = await runAdapter({
    phase: 'api_lookup_excel_target',
    shared: {
      excelTargets: [styleTarget],
      excelTarget: styleTarget,
      currentExcelTargetIndex: 0,
    },
    postImpl: async ({ requestPath, payload }) => {
      assert.equal(requestPath, '/visage-agent-seller/labelcode/pageQuery')
      assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
        page: 1,
        pageSize: 200,
        skcExtCodes: ['208326104207'],
      })
      return {
        res: {
          total: 3,
          pageItems: [
            makePageItem({ ...PENDING_TARGET, skcExtCode: '208326104207', skuExtCode: '6900137783171' }),
            makePageItem({ ...READY_TARGET, skcExtCode: '208326104207', skuExtCode: '6900137783172' }),
            makePageItem(printOnlyTarget),
          ],
        },
      }
    },
  })

  assert.equal(result.meta.next_phase, 'api_lookup_excel_target')
  assert.equal(result.meta.shared.excelTargets.length, 2)
  assert.equal(result.meta.shared.excelTarget.inputMode, 'style_sku')
  assert.equal(result.meta.shared.excelTarget.skuNo, '6900137783171')
  assert.equal(result.meta.shared.progress_kind, 'temu_ai_wash_label')
  assert.equal(result.meta.shared.wash_label_stage, 'sku')
  assert.equal(result.meta.shared.style_total, 1)
  assert.equal(result.meta.shared.style_completed, 1)
  assert.equal(result.meta.shared.style_current, '208326104207')
  assert.equal(result.meta.shared.sku_total, 2)
  assert.equal(result.meta.shared.sku_completed, 0)
  assert.equal(result.meta.shared.sku_current, '6900137783171')
  assert.equal(result.meta.shared.sku_skipped, 1)
  assert.match(result.meta.shared.current_store, /AI洗唛制作 \/ 制作 SKU 1\/2/)
  assert.equal(result.meta.shared.excelTarget.excelManufacturerName, ROW_MANUFACTURER_NAME)
  assert.equal(result.meta.shared.excelTarget.excelProductionDate, '2024-10-18')
  assert.equal(result.meta.shared.excelTarget.excelBatchNumber, 'PC241018')
  assert.equal(result.meta.shared.excelTarget.excelLabelWidthMm, 45)
  assert.equal(result.meta.shared.excelTarget.excelLabelLengthMm, 230)
  assert.equal(result.meta.shared.excelTarget.excelLabelPaddingMm, 10)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].结果, 'print_only_skipped')
  assert.equal(result.data[0].TEMU需要洗水唛, false)
})

test('style-code expansion honors max downloads after SKU expansion', async () => {
  const styleTarget = {
    inputMode: 'style_code',
    style: '208326101201',
    skc: '208326101201',
    status: 'ready',
  }
  const result = await runAdapter({
    phase: 'api_lookup_excel_target',
    params: { max_downloads: 1 },
    shared: {
      excelTargets: [styleTarget],
      excelTarget: styleTarget,
      currentExcelTargetIndex: 0,
    },
    postImpl: async ({ requestPath, payload }) => {
      assert.equal(requestPath, '/visage-agent-seller/labelcode/pageQuery')
      assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
        page: 1,
        pageSize: 200,
        skcExtCodes: ['208326101201'],
      })
      return {
        res: {
          total: 3,
          pageItems: [
            makePageItem({ ...PENDING_TARGET, skcExtCode: '208326101201', skuExtCode: '6942749192292', productSkuId: 6942749192292 }),
            makePageItem({ ...PENDING_TARGET, skcExtCode: '208326101201', skuExtCode: '6942749192285', productSkuId: 6942749192285 }),
            makePageItem({ ...PENDING_TARGET, skcExtCode: '208326101201', skuExtCode: '6942749192278', productSkuId: 6942749192278 }),
          ],
        },
      }
    },
  })

  assert.equal(result.meta.next_phase, 'api_lookup_excel_target')
  assert.equal(result.meta.shared.excelTargets.length, 1)
  assert.equal(result.meta.shared.excelTarget.skuNo, '6942749192292')
  assert.equal(result.meta.shared.styleQueryDerivedTargets, 3)
  assert.equal(result.meta.shared.styleQuerySelectedTargets, 1)
  assert.equal(result.meta.shared.styleQuerySkuLimit, 1)
  assert.equal(result.meta.shared.sku_total, 1)
  assert.match(result.meta.shared.current_store, /AI洗唛制作 \/ 制作 SKU 1\/1/)
})

test('style expansion recomputes SKU progress total from actual queue', async () => {
  const firstStyleSkuTargets = Array.from({ length: 18 }, (_, index) => ({
    ...PENDING_TARGET,
    skcExtCode: '208326104202',
    skuExtCode: `69427491939${String(index).padStart(2, '0')}`,
    productSkuId: 1000 + index,
  }))
  const pendingStyleTarget = {
    inputMode: 'style_code',
    style: '208326105215',
    skc: '208326105215',
    status: 'ready',
  }
  const secondStyleSkuTargets = Array.from({ length: 18 }, (_, index) => ({
    ...PENDING_TARGET,
    skcExtCode: '208326105215',
    skuExtCode: `69146783110${String(index).padStart(2, '0')}`,
    productSkuId: 2000 + index,
  }))

  const result = await runAdapter({
    phase: 'api_lookup_excel_target',
    shared: {
      excelTargets: [
        ...firstStyleSkuTargets.map(record => ({
          ...record,
          inputMode: 'style_sku',
          style: '208326104202',
          skc: record.skcExtCode,
          skuNo: record.skuExtCode,
          enterpriseCode: record.skuExtCode,
          status: 'ready',
        })),
        pendingStyleTarget,
      ],
      excelTarget: pendingStyleTarget,
      currentExcelTargetIndex: 18,
      style_total: 2,
      style_completed: 1,
      sku_total: 35,
      sku_completed: 18,
    },
    postImpl: async ({ requestPath, payload }) => {
      assert.equal(requestPath, '/visage-agent-seller/labelcode/pageQuery')
      assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
        page: 1,
        pageSize: 200,
        skcExtCodes: ['208326105215'],
      })
      return {
        res: {
          total: 18,
          pageItems: secondStyleSkuTargets.map(record => makePageItem(record)),
        },
      }
    },
  })

  assert.equal(result.meta.next_phase, 'api_lookup_excel_target')
  assert.equal(result.meta.shared.excelTargets.length, 36)
  assert.equal(result.meta.shared.sku_total, 36)
  assert.equal(result.meta.shared.sku_completed, 18)
  assert.equal(result.meta.shared.total_rows, 36)
  assert.equal(result.meta.shared.current_exec_no, 19)
  assert.match(result.meta.shared.current_store, /AI洗唛制作 \/ 制作 SKU 19\/36/)
  assert.equal(result.meta.shared.excelTarget.skuNo, '6914678311000')
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
  assert.equal(result.meta.shared.apiTarget.outputFilename, '76096921633-9950019805206.pdf')
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
  assert.equal(result.meta.open_url_if_missing, 'https://scm.semir.com/scm-quality-mgm/index/scm-qc-wash-appr-index')
  assert.equal(result.meta.open_wait_ms, 2000)
  assert.match(result.meta.expression, /scm-qc-wash-appr-index/)
  assert.match(result.meta.expression, /input_0_P_MAT_CODE/)
  assert.match(result.meta.expression, /innerText \|\| value\.textContent/)
  assert.doesNotMatch(result.meta.expression, /cookie|localStorage|sf-token|Anti-Content/i)
})

test('SCM login page waits up to the manual login window before falling back', async () => {
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
          ok: false,
          retry: true,
          loginRequired: true,
          reason: 'scm_login_required',
          currentUrl: 'https://scm.semir.com/selfcare/login',
          title: '统一身份认证 登录',
        },
      },
    },
  })

  assert.equal(result.meta.next_phase, 'scm_lookup_target')
  assert.equal(result.meta.sleep_ms, 5000)
  assert.equal(result.meta.shared.scmLookupAttempts, 1)
  assert.equal(result.meta.shared.scmLookupLoginRequired, true)
  assert.match(result.meta.shared.scmLookupStatus, /等待 SCM 登录 5\/500s/)
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
        error: 'SCM component crashed',
      },
    },
  })

  assert.equal(result.meta.next_phase, 'api_care_query')
  assert.equal(result.data.length, 0)
  assert.equal(result.meta.shared.scmLookupStatus, 'SCM查询失败，使用固定洗护符号')
  assert.equal(result.meta.shared.apiTarget.scmLookupFailedReason, 'SCM component crashed')
})

test('SCM login wait falls back after the 500s manual login window is exhausted', async () => {
  const apiTarget = { ...PENDING_TARGET, ...ENTERPRISE_TARGET, excelStyle: '209225117208' }
  const result = await runAdapter({
    phase: 'verify_scm_lookup',
    shared: {
      apiTarget,
      excelTargets: [ENTERPRISE_TARGET],
      excelTarget: ENTERPRISE_TARGET,
      scmLookupAttempts: 100,
      scmLookupResult: {
        ok: true,
        value: {
          ok: false,
          retry: true,
          loginRequired: true,
          reason: 'scm_login_required',
          currentUrl: 'https://scm.semir.com/selfcare/login',
        },
      },
    },
  })

  assert.equal(result.meta.next_phase, 'api_care_query')
  assert.equal(result.meta.shared.scmLookupStatus, 'SCM登录等待超时，使用固定洗护符号')
  assert.match(result.meta.shared.scmLookupLastError, /SCM登录等待超时/)
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

test('SCM evidence without mappable remark downloads wash attachment for AI recognition', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    ...ENTERPRISE_TARGET,
    excelStyle: '209225117208',
    excelSkc: '20922511720860904',
  }
  const result = await runAdapter({
    phase: 'verify_scm_lookup',
    params: {
      ai_wash_instruction_recognition: true,
    },
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

  assert.equal(result.meta.action, 'download_urls')
  assert.equal(result.meta.next_phase, 'verify_scm_attachment_download')
  assert.equal(result.meta.shared_key, 'scmAttachmentDownload')
  assert.equal(result.meta.items[0].url, 'https://scmobsprd.semirapp.com/SF_DYNA/ATTACH/label2.pdf')
  assert.equal(result.meta.items[0].no_proxy, true)
  assert.equal(result.meta.items[0].headers.Referer, 'https://scm.semir.com/scm-quality-mgm/index/scm-qc-wash-appr-index')
  assert.match(result.meta.items[0].headers.Accept, /application\/pdf/)
  assert.equal(result.meta.items[0].expected_magic, '%PDF-')
  assert.equal(result.meta.items[0].validate_signature, true)
  assert.match(result.meta.items[0].target_relative_path, /scm-wash-attachments\/209225117208-60904-XM241115000025-wash-attachment\.pdf/)
  assert.equal(result.meta.shared.apiTarget.scmCareInstructionSource, 'missing_structured_wash_instruction')
})

test('SCM attachment recognition downloads wash image instead of hangtag file', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    ...ENTERPRISE_TARGET,
    excelStyle: '209225117208',
    excelSkc: '20922511720860904',
  }
  const rows = SCM_ROWS.map(row => ({
    ...row,
    SKC_REMARK: '',
    SKC_FILE_URL1: row.SKC_CODE === '20922511720860904'
      ? 'https://scmobsprd.semirapp.com/SF_DYNA/ATTACH/wash-label.jpg'
      : row.SKC_FILE_URL1,
    SKC_FILE_URL2: row.SKC_CODE === '20922511720860904'
      ? 'https://scmobsprd.semirapp.com/SF_DYNA/ATTACH/hangtag.pdf'
      : row.SKC_FILE_URL2,
  }))
  const result = await runAdapter({
    phase: 'verify_scm_lookup',
    params: {
      ai_wash_instruction_recognition: true,
    },
    shared: {
      apiTarget,
      excelTargets: [ENTERPRISE_TARGET],
      excelTarget: ENTERPRISE_TARGET,
      scmLookupResult: {
        ok: true,
        value: {
          ok: true,
          source: 'scm_qc_wash_appr_page_component',
          rows,
          recordsTotal: 2,
        },
      },
    },
  })

  assert.equal(result.meta.action, 'download_urls')
  assert.equal(result.meta.items[0].url, 'https://scmobsprd.semirapp.com/SF_DYNA/ATTACH/wash-label.jpg')
  assert.notEqual(result.meta.items[0].url, 'https://scmobsprd.semirapp.com/SF_DYNA/ATTACH/hangtag.pdf')
  assert.equal(result.meta.items[0].headers.Referer, 'https://scm.semir.com/scm-quality-mgm/index/scm-qc-wash-appr-index')
  assert.equal(Object.hasOwn(result.meta.items[0], 'expected_magic'), false)
  assert.match(result.meta.items[0].target_relative_path, /scm-wash-attachments\/209225117208-60904-XM241115000025-wash-attachment\.jpg/)
})

test('downloaded SCM wash attachment requests backend AI/OCR recognition', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    excelStyle: '209225117208',
    scmOrderNo: 'XM241115000025',
    scmWashFile: 'https://scmobsprd.semirapp.com/SF_DYNA/ATTACH/label2.pdf',
  }
  const result = await runAdapter({
    phase: 'verify_scm_attachment_download',
    params: {
      ai_wash_instruction_model_id: 'qwen3.8-max-preview',
      ai_wash_instruction_fallback_models: 'gpt-5.6-terra, gemini-3.5-flash',
    },
    shared: {
      apiTarget,
      excelTargets: [ENTERPRISE_TARGET],
      excelTarget: ENTERPRISE_TARGET,
      scmAttachmentDownload: {
        ok: true,
        items: [{
          success: true,
          path: '/tmp/scm-label2.pdf',
          filename: 'label2.pdf',
          url: 'https://scmobsprd.semirapp.com/SF_DYNA/ATTACH/label2.pdf',
        }],
      },
    },
  })

  assert.equal(result.meta.action, 'recognize_wash_care_media')
  assert.equal(result.meta.next_phase, 'verify_scm_attachment_recognition')
  assert.equal(result.meta.shared_key, 'scmAttachmentRecognition')
  assert.equal(result.meta.items[0].path, '/tmp/scm-label2.pdf')
  assert.equal(result.meta.model_id, 'qwen3.8-max-preview')
  assert.deepEqual(Array.from(result.meta.fallback_model_ids), ['gpt-5.6-terra', 'gemini-3.5-flash'])
  assert.equal(result.meta.shared.scmAttachmentRecognitionStatus, 'recognizing')
})

test('AI-recognized SCM wash instruction is attached before TEMU care query', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    excelStyle: '209225117208',
    scmCareInstructionSource: 'missing_structured_wash_instruction',
  }
  const result = await runAdapter({
    phase: 'verify_scm_attachment_recognition',
    shared: {
      apiTarget,
      excelTargets: [ENTERPRISE_TARGET],
      excelTarget: ENTERPRISE_TARGET,
      scmAttachmentRecognition: {
        ok: true,
        source: 'scm_wash_attachment_multimodal',
        instructionText: '手洗，不可漂白，平坦，熨烫，不可干洗',
        careSymbols: {
          washing: 13,
          bleaching: 3,
          drying: 8,
          ironing: 4,
          dryCleaning: 5,
        },
      },
    },
  })

  assert.equal(result.meta.next_phase, 'api_care_query')
  assert.equal(result.meta.shared.apiTarget.scmCareInstructionText, '手洗，不可漂白，平坦，熨烫，不可干洗')
  assert.equal(result.meta.shared.apiTarget.scmCareInstructionSource, 'scm_wash_attachment_multimodal')
  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.apiTarget.scmCareSymbols)), {
    washing: 13,
    bleaching: 3,
    drying: 8,
    ironing: 4,
    dryCleaning: 5,
  })
  assert.equal(result.meta.shared.apiTarget.scmAttachmentRecognitionStatus, 'recognized')
  assert.equal(result.meta.shared.scmWashInstructionByStyle['209225117208'].ok, true)
  assert.equal(result.meta.shared.scmWashInstructionByStyle['209225117208'].instructionText, '手洗，不可漂白，平坦，熨烫，不可干洗')
  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.scmWashInstructionByStyle['209225117208'].careSymbols)), {
    washing: 13,
    bleaching: 3,
    drying: 8,
    ironing: 4,
    dryCleaning: 5,
  })
})

test('same style reuses one recognized SCM wash attachment result', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    ...ENTERPRISE_TARGET,
    excelStyle: '209225117208',
    excelSkc: '20922511720860904',
  }
  const rows = SCM_ROWS.map(row => ({
    ...row,
    SKC_REMARK: '',
    SKC_FILE_URL1: 'https://scmobsprd.semirapp.com/SF_DYNA/ATTACH/wash-label.jpg',
    SKC_FILE_URL2: 'https://scmobsprd.semirapp.com/SF_DYNA/ATTACH/hangtag.pdf',
  }))
  const result = await runAdapter({
    phase: 'verify_scm_lookup',
    params: {
      ai_wash_instruction_recognition: true,
    },
    shared: {
      apiTarget,
      excelTargets: [ENTERPRISE_TARGET],
      excelTarget: ENTERPRISE_TARGET,
      scmWashInstructionByStyle: {
        209225117208: {
          ok: true,
          instructionText: '手洗，不可漂白，平坦，熨烫，不可干洗',
          careSymbols: {
            washing: 13,
            bleaching: 3,
            drying: 8,
            ironing: 4,
            dryCleaning: 5,
          },
          source: 'scm_wash_attachment_multimodal',
          status: 'recognized',
        },
      },
      scmLookupResult: {
        ok: true,
        value: {
          ok: true,
          source: 'scm_qc_wash_appr_page_component',
          rows,
          recordsTotal: 2,
        },
      },
    },
  })

  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'api_care_query')
  assert.equal(result.meta.shared.apiTarget.scmCareInstructionText, '手洗，不可漂白，平坦，熨烫，不可干洗')
  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.apiTarget.scmCareSymbols)), {
    washing: 13,
    bleaching: 3,
    drying: 8,
    ironing: 4,
    dryCleaning: 5,
  })
  assert.equal(result.meta.shared.apiTarget.scmCareInstructionSource, 'scm_wash_attachment_multimodal')
  assert.equal(result.meta.shared.apiTarget.scmAttachmentRecognitionStatus, 'recognized_reused')
  assert.equal(result.meta.shared.scmLookupStatus, 'SCM查询成功，复用同款洗唛附件识别结果')
})

test('AI wash attachment recognition failure continues with fixed fallback', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    excelStyle: '209225117208',
    scmCareInstructionSource: 'missing_structured_wash_instruction',
  }
  const result = await runAdapter({
    phase: 'verify_scm_attachment_recognition',
    shared: {
      apiTarget,
      excelTargets: [ENTERPRISE_TARGET],
      excelTarget: ENTERPRISE_TARGET,
      scmAttachmentRecognition: {
        ok: false,
        error: '未识别到完整洗护说明',
      },
    },
  })

  assert.equal(result.meta.next_phase, 'api_care_query')
  assert.equal(result.meta.shared.scmLookupStatus, 'SCM洗唛附件识别失败，使用固定洗护符号')
  assert.equal(result.meta.shared.apiTarget.scmAttachmentRecognitionStatus, 'recognition_failed')
  assert.equal(result.meta.shared.apiTarget.scmAttachmentRecognitionError, '未识别到完整洗护说明')
  assert.equal(result.meta.shared.scmWashInstructionByStyle['209225117208'].ok, false)
  assert.equal(result.meta.shared.scmWashInstructionByStyle['209225117208'].status, 'recognition_failed')
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
  assert.equal(result.meta.shared.careLabel.width, 45)
  assert.equal(result.meta.shared.careLabel.len, 230)
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
  assert.equal(result.meta.shared.apiTarget.outputFilename, '76096921633-9950019805299.pdf')
})

test('downloadable wash label is resaved from template before export in create-and-download mode', async () => {
  const apiTarget = {
    ...READY_TARGET,
    excelStyle: EXCEL_TARGET.style,
    excelLabelWidthMm: 45,
    excelLabelLengthMm: 270,
    excelLabelPaddingMm: 10,
  }
  const result = await runAdapter({
    phase: 'api_care_query',
    params: { execute_mode: 'create_and_download', allow_save: true },
    shared: { apiTarget, excelTargets: [EXCEL_TARGET], excelTarget: EXCEL_TARGET },
    postImpl: async ({ requestPath }) => {
      assert.equal(requestPath, '/visage-agent-seller/labelcode/care/query')
      return careQueryResponse({
        productId: READY_TARGET.productId,
        productSkuId: READY_TARGET.productSkuId,
        productSkcId: READY_TARGET.productSkcId,
        len: 230,
        width: 30,
      })
    },
  })

  assert.equal(result.meta.next_phase, 'prepare_care_payload')
  assert.equal(result.meta.shared.resaveExistingWashLabel, true)
  assert.equal(result.meta.shared.temuRowStatus, '已制作，按模板重新保存后导出')
})

test('create-and-download mode does not skip existing PDFs before template verification', async () => {
  const apiTarget = {
    ...READY_TARGET,
    excelStyle: EXCEL_TARGET.style,
    excelLabelWidthMm: 45,
    excelLabelLengthMm: 270,
    excelLabelPaddingMm: 10,
  }
  const result = await runAdapter({
    phase: 'api_care_query',
    params: { execute_mode: 'create_and_download', allow_save: true, output_dir: '/tmp/temu-wash-labels' },
    shared: { apiTarget, excelTargets: [EXCEL_TARGET], excelTarget: EXCEL_TARGET },
    postImpl: async () => careQueryResponse({
      productId: READY_TARGET.productId,
      productSkuId: READY_TARGET.productSkuId,
      productSkcId: READY_TARGET.productSkcId,
      len: 270,
      width: 45,
    }),
  })

  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'prepare_care_payload')
  assert.equal(result.meta.shared.resaveExistingWashLabel, true)
})

test('existing official PDF check skips duplicate create and download on resume', async () => {
  const target = { ...READY_TARGET, outputFilename: '50588044853-9950019805206.pdf' }
  const result = await runAdapter({
    phase: 'verify_existing_official_pdf',
    shared: {
      apiValidated: true,
      apiTarget: target,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      existingOfficialPdfCheck: {
        ok: true,
        items: [{
          success: true,
          path: '/tmp/temu-wash-labels/50588044853-9950019805206.pdf',
          filename: '50588044853-9950019805206.pdf',
          bytes: 712785,
          signatureValidated: true,
        }],
      },
    },
  })

  assert.equal(result.meta.next_phase, 'advance_excel_target')
  assert.equal(result.data[0].结果, 'resume_existing_pdf_skipped')
  assert.equal(result.data[0].文件路径, '/tmp/temu-wash-labels/50588044853-9950019805206.pdf')
  assert.equal(result.data[0].来源, 'local_resume_pdf')
  assert.equal(result.meta.shared.officialDownloadReceived, true)
})

test('dry-run prepares AI defaults without manufacturer fields and never saves', async () => {
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
    drying: 4,
    ironing: 3,
    dryCleaning: 5,
  })
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsSource, 'missing_scm_care_instruction_text')
  assert.equal(result.meta.shared.carePayload.manufacturerName, '')
  assert.equal(result.meta.shared.carePayloadSummary.manufacturerNameSource, 'blank_blank_not_filled')
  assert.equal(result.meta.shared.carePayload.manufacturerAddressPg, '')
  assert.equal(result.meta.shared.carePayloadSummary.manufacturerAddressSource, 'blank_blank_not_filled')
  assert.equal(result.meta.shared.carePayload.productionDate, '2024-10-01')
  assert.equal(result.meta.shared.carePayload.batchNumber, 'PC241016')
})

test('dry-run uses manufacturer name and address from Excel target when provided', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    excelStyle: EXCEL_TARGET.style,
    outputFilename: EXCEL_TARGET.outputFilename,
    excelManufacturerName: ROW_MANUFACTURER_NAME,
    excelManufacturerAddress: ROW_MANUFACTURER_ADDRESS,
  }
  const result = await runAdapter({
    phase: 'prepare_care_payload',
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      careInitial: careQueryResponse({
        manufacturerNameOptions: [ROW_MANUFACTURER_NAME],
        manufacturerAddressOptions: [ROW_MANUFACTURER_ADDRESS],
      }).res,
      careLabel: { width: 35, len: 235, padding: 10, size: '110' },
    },
  })

  assert.equal(result.meta.shared.carePayload.manufacturerName, ROW_MANUFACTURER_NAME)
  assert.equal(result.meta.shared.carePayload.manufacturerAddressPg, ROW_MANUFACTURER_ADDRESS)
  assert.equal(result.meta.shared.carePayloadSummary.manufacturerNameSource, 'excel_exact_temu_option')
  assert.equal(result.meta.shared.carePayloadSummary.manufacturerAddressSource, 'excel_exact_temu_option')
  assert.equal(result.data[0].制造商名称, ROW_MANUFACTURER_NAME)
  assert.equal(result.data[0].制造商地址, ROW_MANUFACTURER_ADDRESS)
})

test('dry-run uses wash-label dimensions from Excel target when provided', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    excelStyle: EXCEL_TARGET.style,
    outputFilename: EXCEL_TARGET.outputFilename,
    excelLabelWidthMm: 35,
    excelLabelLengthMm: 230,
    excelLabelPaddingMm: 12,
  }
  const result = await runAdapter({
    phase: 'prepare_care_payload',
    params: {
      label_width_mm: 45,
      label_length_mm: 260,
      label_padding_mm: 8,
    },
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      careInitial: careQueryResponse({
        width: 45,
        len: 260,
        padding: 8,
      }).res,
      careLabel: { width: 45, len: 260, padding: 8, size: '110' },
    },
  })

  assert.equal(result.meta.shared.carePayload.width, 35)
  assert.equal(result.meta.shared.carePayload.len, 230)
  assert.equal(result.meta.shared.carePayload.padding, 12)
  assert.equal(result.meta.shared.carePayloadSummary.widthSource, 'excel')
  assert.equal(result.meta.shared.carePayloadSummary.lengthSource, 'excel')
  assert.equal(result.meta.shared.carePayloadSummary.paddingSource, 'excel')
  assert.equal(result.data[0].洗水唛宽度mm, 35)
  assert.equal(result.data[0].洗水唛长度mm, 230)
  assert.equal(result.data[0].上下预留mm, 12)
})

test('production date is normalized to the first day of the selected month', async () => {
  const apiTarget = { ...PENDING_TARGET, excelStyle: EXCEL_TARGET.style, outputFilename: EXCEL_TARGET.outputFilename }
  const result = await runAdapter({
    phase: 'prepare_care_payload',
    params: {
      production_date: '2026-06-18',
    },
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      careInitial: careQueryResponse().res,
      careLabel: { width: 35, len: 235, padding: 10, size: '110' },
    },
  })

  assert.equal(result.meta.shared.carePayload.productionDate, '2026-06-01')
  assert.equal(result.meta.shared.carePayloadSummary.productionDate, '2026-06-01')
  assert.equal(result.meta.shared.carePayloadSummary.productionDateSource, 'param')
})

test('production date from Excel target keeps the exact template date', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    excelStyle: EXCEL_TARGET.style,
    outputFilename: EXCEL_TARGET.outputFilename,
    excelProductionDate: '2024-10-18',
    excelBatchNumber: 'PC241018',
  }
  const result = await runAdapter({
    phase: 'prepare_care_payload',
    params: {
      production_date: '2026-06-18',
      batch_number: 'PC260618',
    },
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      careInitial: careQueryResponse().res,
      careLabel: { width: 45, len: 230, padding: 10, size: '110' },
    },
  })

  assert.equal(result.meta.shared.carePayload.productionDate, '2024-10-18')
  assert.equal(result.meta.shared.carePayload.batchNumber, 'PC241018')
  assert.equal(result.meta.shared.carePayloadSummary.productionDateSource, 'excel')
  assert.equal(result.meta.shared.carePayloadSummary.batchNumberSource, 'excel')
})

test('dry-run prepares DingTalk SOP fixed payload when the SOP profile is selected', async () => {
  const apiTarget = { ...PENDING_TARGET, excelStyle: EXCEL_TARGET.style, outputFilename: EXCEL_TARGET.outputFilename }
  const result = await runAdapter({
    phase: 'prepare_care_payload',
    params: {
      fixed_care_symbols_profile: 'dingtalk_sop',
    },
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      careInitial: careQueryResponse().res,
      careLabel: { width: 45, len: 230, padding: 10, size: '110' },
    },
  })

  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.carePayloadSummary.careSymbols)), {
    washing: 13,
    bleaching: 3,
    drying: 4,
    ironing: 3,
    dryCleaning: 5,
  })
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsLabels.washing, TEMU_HAND_WASH_40_LABEL)
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsLabels.drying, 'Line drying')
})

test('dry-run maps DingTalk SOP wash-care wording to TEMU symbol enums', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    excelStyle: EXCEL_TARGET.style,
    outputFilename: EXCEL_TARGET.outputFilename,
    scmCareInstructionText: '手洗，不可漂白，悬挂晾晒，可熨烫，不可干洗',
  }
  const result = await runAdapter({
    phase: 'prepare_care_payload',
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      careInitial: careQueryResponse().res,
      careLabel: { width: 45, len: 230, padding: 10, size: '110' },
    },
  })

  assert.equal(result.meta.next_phase, 'advance_excel_target')
  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.carePayloadSummary.careSymbols)), {
    washing: 13,
    bleaching: 3,
    drying: 4,
    ironing: 3,
    dryCleaning: 5,
  })
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsLabels.washing, TEMU_HAND_WASH_40_LABEL)
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsLabels.drying, 'Line drying')
})

test('dry-run maps SOP flat-drying wording from PDF evidence', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    excelStyle: EXCEL_TARGET.style,
    outputFilename: EXCEL_TARGET.outputFilename,
    scmCareInstructionText: '手洗，不可漂白，平坦，熨烫，不可干洗',
  }
  const result = await runAdapter({
    phase: 'prepare_care_payload',
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      careInitial: careQueryResponse().res,
    },
  })

  assert.equal(result.meta.shared.carePayloadSummary.careSymbols.drying, 8)
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsLabels.drying, 'Flat drying')
})

test('SCM flat-drying and low-temperature ironing map to TEMU calibrated symbols', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    excelStyle: EXCEL_TARGET.style,
    outputFilename: EXCEL_TARGET.outputFilename,
    scmCareInstructionText: '手洗，不可漂白，平摊晾干，低温熨烫，不可干洗',
  }
  const result = await runAdapter({
    phase: 'prepare_care_payload',
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      careInitial: careQueryResponse().res,
    },
  })

  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.carePayloadSummary.careSymbols)), {
    washing: 13,
    bleaching: 3,
    drying: 8,
    ironing: 3,
    dryCleaning: 5,
  })
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsSource, 'scm_instruction_mapping')
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsLabels.drying, 'Flat drying')
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsLabels.ironing, TEMU_LOW_IRON_LABEL)
})

test('SCM flat-drying and do-not-iron map without falling back to defaults', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    excelStyle: EXCEL_TARGET.style,
    outputFilename: EXCEL_TARGET.outputFilename,
    scmCareInstructionText: '手洗，不可漂白，平摊晾干，不可熨烫，不可干洗',
  }
  const result = await runAdapter({
    phase: 'prepare_care_payload',
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      careInitial: careQueryResponse().res,
    },
  })

  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.carePayloadSummary.careSymbols)), {
    washing: 13,
    bleaching: 3,
    drying: 8,
    ironing: 4,
    dryCleaning: 5,
  })
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsSource, 'scm_instruction_mapping')
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsLabels.drying, 'Flat drying')
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsLabels.ironing, 'Do not iron')
})

test('AI-recognized TEMU care symbols drive save payload before text fallback', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    excelStyle: EXCEL_TARGET.style,
    outputFilename: EXCEL_TARGET.outputFilename,
    scmCareInstructionText: '手洗，不可漂白，平坦，熨烫，不可干洗',
    scmCareSymbols: {
      washing: 13,
      bleaching: 3,
      drying: 8,
      ironing: 4,
      dryCleaning: 5,
    },
  }
  const result = await runAdapter({
    phase: 'prepare_care_payload',
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      careInitial: careQueryResponse().res,
    },
  })

  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.carePayloadSummary.careSymbols)), {
    washing: 13,
    bleaching: 3,
    drying: 8,
    ironing: 4,
    dryCleaning: 5,
  })
  assert.equal(result.meta.shared.carePayload.drying, 8)
  assert.equal(result.meta.shared.carePayload.ironing, 4)
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsSource, 'scm_attachment_ai_care_symbols')
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsLabels.drying, 'Flat drying')
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsLabels.ironing, 'Do not iron')
  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.carePayloadSummary.careSymbolsStandardIds)), {
    washing: 'W01',
    bleaching: 'B03',
    drying: 'D03',
    ironing: 'I04',
    dryCleaning: 'P05',
  })
})

test('partial AI care symbols are completed with latest SCM text mapping', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    excelStyle: EXCEL_TARGET.style,
    outputFilename: EXCEL_TARGET.outputFilename,
    scmCareInstructionText: '手洗，不可漂白，平摊晾干，低温熨烫，不可干洗',
    scmCareSymbols: {
      washing: 13,
      bleaching: 3,
      drying: 8,
      dryCleaning: 5,
    },
  }
  const result = await runAdapter({
    phase: 'prepare_care_payload',
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      careInitial: careQueryResponse().res,
    },
  })

  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.carePayloadSummary.careSymbols)), {
    washing: 13,
    bleaching: 3,
    drying: 8,
    ironing: 3,
    dryCleaning: 5,
  })
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsSource, 'scm_attachment_ai_care_symbols_partial_fallback:ironing')
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsLabels.drying, 'Flat drying')
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsLabels.ironing, TEMU_LOW_IRON_LABEL)
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsStandardIds.ironing, 'I07')
})

test('SCM partial mapping preserves mapped fields when one care symbol is unknown', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    excelStyle: EXCEL_TARGET.style,
    outputFilename: EXCEL_TARGET.outputFilename,
    scmCareInstructionText: '手洗，不可漂白，平摊晾干，未知熨烫方式，不可干洗',
  }
  const result = await runAdapter({
    phase: 'prepare_care_payload',
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      careInitial: careQueryResponse().res,
    },
  })

  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.carePayloadSummary.careSymbols)), {
    washing: 13,
    bleaching: 3,
    drying: 8,
    ironing: 3,
    dryCleaning: 5,
  })
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsSource, 'scm_instruction_mapping_partial_fallback:ironing')
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsLabels.drying, 'Flat drying')
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

test('dry-run maps LZH manual calibration TEMU field wording to symbol enums', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    excelStyle: EXCEL_TARGET.style,
    outputFilename: EXCEL_TARGET.outputFilename,
    scmCareInstructionText: [
      '最高洗涤温度 40°C 手洗   hand wash, maximum temperature 40 ℃',
      '不可漂白 / do not bleach',
      '在阴凉处悬挂晾干 / line drying in the shade',
      '熨斗底板最高温度120℃，蒸汽熨烫可能造成不可回复的损伤 / iron at a maximal sole plate temperature of 120 ℃, steam iron may cause irreversible damage',
      '不可干洗，不可专业干洗 / do not dry clean, No professional dry cleaning allowed',
    ].join('\n'),
  }
  const result = await runAdapter({
    phase: 'prepare_care_payload',
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      careInitial: careQueryResponse().res,
    },
  })

  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.carePayloadSummary.careSymbols)), {
    washing: 13,
    bleaching: 3,
    drying: 5,
    ironing: 3,
    dryCleaning: 5,
  })
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsSource, 'scm_instruction_mapping')
  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.carePayloadSummary.careSymbolsStandardIds)), {
    washing: 'W01',
    bleaching: 'B03',
    drying: 'D05',
    ironing: 'I07',
    dryCleaning: 'P05',
  })
})

test('dry-run maps LZH 30C normal wash and flat drying calibration wording', async () => {
  const apiTarget = {
    ...PENDING_TARGET,
    excelStyle: EXCEL_TARGET.style,
    outputFilename: EXCEL_TARGET.outputFilename,
    scmCareInstructionText: [
      '最高洗涤温度30℃ 常规程序 / maximum temperature 30 ℃, normal process',
      '不可漂白 / do not bleach',
      '平摊晾干 / flat drying',
      '不可熨烫 / do not iron',
      '不可干洗，不可专业干洗 / do not dry clean, No professional dry cleaning allowed',
    ].join('\n'),
  }
  const result = await runAdapter({
    phase: 'prepare_care_payload',
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      careInitial: careQueryResponse().res,
    },
  })

  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.carePayloadSummary.careSymbols)), {
    washing: 10,
    bleaching: 3,
    drying: 8,
    ironing: 4,
    dryCleaning: 5,
  })
  assert.equal(result.meta.shared.carePayloadSummary.careSymbolsSource, 'scm_instruction_mapping')
  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.shared.carePayloadSummary.careSymbolsStandardIds)), {
    washing: 'W03',
    bleaching: 'B03',
    drying: 'D03',
    ironing: 'I04',
    dryCleaning: 'P05',
  })
})

test('dry-run reports the configured label length used for TEMU save payload', async () => {
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
  assert.equal(result.meta.shared.carePayloadSummary.lengthStrategy, 'param_configured')
  assert.equal(result.data[0].洗水唛长度mm, 235)
  assert.equal(result.data[0].洗水唛尺码, '110')
})

test('payload uses template dimensions and forces tracking label display', async () => {
  const apiTarget = {
    ...READY_TARGET,
    excelStyle: EXCEL_TARGET.style,
    excelLabelWidthMm: 45,
    excelLabelLengthMm: 270,
    excelLabelPaddingMm: 10,
  }
  const result = await runAdapter({
    phase: 'prepare_care_payload',
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      careInitial: careQueryResponse({
        productId: READY_TARGET.productId,
        productSkuId: READY_TARGET.productSkuId,
        productSkcId: READY_TARGET.productSkcId,
        showTrackingLabel: false,
        len: 230,
        width: 30,
      }).res,
      careLabel: { width: 30, len: 230, padding: 10, size: '90' },
    },
  })

  assert.equal(result.meta.shared.carePayload.showTrackingLabel, true)
  assert.equal(result.meta.shared.carePayload.len, 270)
  assert.equal(result.meta.shared.carePayload.width, 45)
  assert.equal(result.meta.shared.carePayload.padding, 10)
  assert.equal(result.meta.shared.carePayloadSummary.len, 270)
  assert.equal(result.meta.shared.carePayloadSummary.lengthSource, 'excel')
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

test('save phase calls TEMU care edit when resaving an already made wash label', async () => {
  const apiTarget = { ...READY_TARGET, excelStyle: EXCEL_TARGET.style }
  let observed = null
  const result = await runAdapter({
    phase: 'save_care_label',
    params: { execute_mode: 'create_and_download', allow_save: true },
    shared: {
      apiTarget,
      resaveExistingWashLabel: true,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      carePayload: {
        productSkuId: READY_TARGET.productSkuId,
        productSkcId: READY_TARGET.productSkcId,
        productId: READY_TARGET.productId,
        manufacturerName: 'Zhejiang Semir Garment Co.,Ltd.',
        manufacturerAddressPg: 'No.98, Nanhui Road, Louqiao Industrial Park, Ouhai District, Wenzhou/Zhejiang, China',
        batchNumber: 'PC241016',
        productionDate: '2026-07-01',
        washing: 13,
        bleaching: 3,
        drying: 4,
        ironing: 3,
        dryCleaning: 5,
        len: 270,
        width: 45,
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

  assert.equal(observed.requestPath, '/visage-agent-seller/labelcode/care/edit')
  assert.equal(observed.payload.productSkuId, READY_TARGET.productSkuId)
  assert.equal(observed.payload.productionDate, '2026-07-01')
  assert.equal(observed.payload.len, 270)
  assert.equal(result.meta.next_phase, 'post_save_lookup')
  assert.equal(result.meta.shared.saveEndpoint, '/visage-agent-seller/labelcode/care/edit')
  assert.equal(result.meta.shared.temuRowStatus, '已调用编辑保存')
})

test('save phase can resave an already made wash label before export', async () => {
  const apiTarget = { ...READY_TARGET, excelStyle: EXCEL_TARGET.style }
  let observed = null
  const result = await runAdapter({
    phase: 'save_care_label',
    params: { execute_mode: 'create_and_download', allow_save: true },
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      resaveExistingWashLabel: true,
      carePayload: {
        productSkuId: READY_TARGET.productSkuId,
        productSkcId: READY_TARGET.productSkcId,
        productId: READY_TARGET.productId,
        showTrackingLabel: true,
        washing: 13,
        bleaching: 3,
        drying: 8,
        ironing: 3,
        dryCleaning: 5,
        len: 270,
        width: 45,
        padding: 10,
        ukfrInfo: {},
        ingLangs: ['en'],
      },
    },
    postImpl: async request => {
      observed = request
      return { res: { success: true } }
    },
  })

  assert.equal(observed.requestPath, '/visage-agent-seller/labelcode/care/edit')
  assert.equal(observed.payload.productSkuId, READY_TARGET.productSkuId)
  assert.equal(result.meta.next_phase, 'post_save_lookup')
})

test('post-save lookup waits until TEMU reports downloadable and uses page SKU filename', async () => {
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
  assert.equal(result.meta.shared.apiTarget.outputFilename, '76096921633-9950019805299.pdf')
  assert.equal(result.meta.shared.apiTarget.cosmeticLabelStatus, 2)
})

test('saved template fields must match TEMU care query before download', async () => {
  const apiTarget = {
    ...READY_TARGET,
    excelStyle: EXCEL_TARGET.style,
    excelLabelWidthMm: 45,
    excelLabelLengthMm: 270,
    excelLabelPaddingMm: 10,
  }
  const result = await runAdapter({
    phase: 'api_care_query',
    params: { execute_mode: 'create_and_download', allow_save: true },
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      saveResult: { success: true },
      carePayloadSummary: {
        manufacturerName: 'Zhejiang Semir Garment Co.,Ltd.',
        manufacturerAddressPg: 'No.98, Nanhui Road, Louqiao Industrial Park, Ouhai District, Wenzhou/Zhejiang, China',
        productionDate: '2026-07-01',
        batchNumber: 'PC241016',
        width: 45,
        len: 290,
        padding: 10,
      },
    },
    postImpl: async ({ requestPath }) => {
      assert.equal(requestPath, '/visage-agent-seller/labelcode/care/query')
      return careQueryResponse({
        productId: READY_TARGET.productId,
        productSkuId: READY_TARGET.productSkuId,
        productSkcId: READY_TARGET.productSkcId,
        manufacturerName: 'Zhejiang Semir Garment Co.,Ltd.',
        manufacturerAddressPg: 'No.98, Nanhui Road, Louqiao Industrial Park, Ouhai District, Wenzhou/Zhejiang, China',
        productionDate: '2026-07-01',
        batchNumber: 'PC241016',
        width: 45,
        len: 290,
        padding: 10,
      })
    },
  })

  assert.equal(result.meta.next_phase, 'prepare_search')
  assert.equal(result.meta.shared.savedTemplateFieldsVerified, true)
  assert.equal(result.meta.shared.carePayloadSummary.len, 290)
  assert.equal(result.meta.shared.savedTemplateFieldMismatchSummary, '')
})

test('saved template field mismatch is corrected by resaving before download', async () => {
  const apiTarget = {
    ...READY_TARGET,
    excelStyle: EXCEL_TARGET.style,
    excelLabelWidthMm: 45,
    excelLabelLengthMm: 270,
    excelLabelPaddingMm: 10,
  }
  const result = await runAdapter({
    phase: 'api_care_query',
    params: { execute_mode: 'create_and_download', allow_save: true },
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      saveResult: { success: true },
      carePayloadSummary: {
        manufacturerName: 'Zhejiang Semir Garment Co.,Ltd.',
        manufacturerAddressPg: 'No.98, Nanhui Road, Louqiao Industrial Park, Ouhai District, Wenzhou/Zhejiang, China',
        productionDate: '2026-07-01',
        batchNumber: 'PC241016',
        width: 45,
        len: 270,
        padding: 10,
      },
    },
    postImpl: async ({ requestPath }) => {
      assert.equal(requestPath, '/visage-agent-seller/labelcode/care/query')
      return careQueryResponse({
        productId: READY_TARGET.productId,
        productSkuId: READY_TARGET.productSkuId,
        productSkcId: READY_TARGET.productSkcId,
        manufacturerName: 'Zhejiang Semir Garment Co.,Ltd.',
        manufacturerAddressPg: 'No.98, Nanhui Road, Louqiao Industrial Park, Ouhai District, Wenzhou/Zhejiang, China',
        productionDate: '2024-10-01',
        batchNumber: 'PC241016',
        width: 45,
        len: 230,
        padding: 10,
      })
    },
  })

  assert.equal(result.meta.next_phase, 'prepare_care_payload')
  assert.equal(result.meta.shared.saveResult, null)
  assert.equal(result.meta.shared.resaveExistingWashLabel, true)
  assert.equal(result.meta.shared.templateFieldCorrectionAttempts, 1)
  assert.equal(result.meta.shared.savedTemplateFieldsVerified, false)
  assert.match(result.meta.shared.savedTemplateFieldMismatchSummary, /生产日期/)
  assert.match(result.meta.shared.savedTemplateFieldMismatchSummary, /洗水唛长度mm/)
  assert.match(result.meta.shared.temuRowStatus, /保存接口修正 1\/3/)
})

test('saved template field mismatch records final failure without auto retry after correction limit', async () => {
  const apiTarget = {
    ...READY_TARGET,
    excelStyle: EXCEL_TARGET.style,
    excelLabelWidthMm: 45,
    excelLabelLengthMm: 270,
    excelLabelPaddingMm: 10,
  }
  const result = await runAdapter({
    phase: 'api_care_query',
    params: { execute_mode: 'create_and_download', allow_save: true },
    shared: {
      apiTarget,
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      saveResult: { success: true },
      templateFieldCorrectionAttempts: 3,
      carePayloadSummary: {
        manufacturerName: 'Zhejiang Semir Garment Co.,Ltd.',
        manufacturerAddressPg: 'No.98, Nanhui Road, Louqiao Industrial Park, Ouhai District, Wenzhou/Zhejiang, China',
        productionDate: '2026-07-01',
        batchNumber: 'PC241016',
        width: 45,
        len: 270,
        padding: 10,
      },
    },
    postImpl: async ({ requestPath }) => {
      assert.equal(requestPath, '/visage-agent-seller/labelcode/care/query')
      return careQueryResponse({
        productId: READY_TARGET.productId,
        productSkuId: READY_TARGET.productSkuId,
        productSkcId: READY_TARGET.productSkcId,
        manufacturerName: 'Zhejiang Semir Garment Co.,Ltd.',
        manufacturerAddressPg: 'No.98, Nanhui Road, Louqiao Industrial Park, Ouhai District, Wenzhou/Zhejiang, China',
        productionDate: '2024-10-01',
        batchNumber: 'PC241016',
        width: 45,
        len: 230,
        padding: 10,
      })
    },
  })

  assert.equal(result.meta.next_phase, 'advance_excel_target')
  assert.equal(result.meta.shared.excelTargets.length, 1)
  assert.equal(result.meta.shared.failedSkuRetryAttempts, undefined)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].结果, 'saved_template_fields_mismatch')
  assert.match(result.data[0].保存字段差异, /生产日期/)
  assert.match(result.data[0].保存字段差异, /洗水唛长度mm/)
})

test('prepare search closes stale export modal before querying the next SKU', async () => {
  let cancelClicked = false
  const cancelButton = new FakeElement({ tagName: 'button', text: '取消' })
  cancelButton.click = () => { cancelClicked = true }
  const staleModal = new FakeElement({ text: '确认导出吗？ PDF PNG 洗水唛预览 确认无误，导出 取消' })
  staleModal.querySelectorAll = selector => (selector === 'button' ? [cancelButton] : [])
  const document = baseDocument().setSelector('[data-testid="beast-core-modal"]', [staleModal])

  const result = await runAdapter({
    phase: 'prepare_search',
    document,
    shared: {
      apiTarget: { ...READY_TARGET, outputFilename: '50588044853-9950019805206.pdf' },
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
    },
  })

  assert.equal(result.meta.next_phase, 'prepare_search')
  assert.equal(result.meta.shared.exportModalCloseAttempts, 1)
  assert.equal(cancelClicked, true)
})

test('download verification closes export modal with return-to-edit action', async () => {
  let returnClicked = false
  const returnButton = new FakeElement({ tagName: 'button', text: '返回修改' })
  returnButton.click = () => { returnClicked = true }
  const staleModal = new FakeElement({ text: '确认导出吗？ PDF PNG 洗水唛预览 确认无误，导出 返回修改' })
  staleModal.querySelectorAll = selector => (selector === 'button' ? [returnButton] : [])
  const document = baseDocument().setSelector('[data-testid="beast-core-modal"]', [staleModal])

  const result = await runAdapter({
    phase: 'verify_download',
    document,
    shared: {
      apiTarget: { ...READY_TARGET, outputFilename: '50588044853-9950019805206.pdf' },
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      downloadResult: {
        items: [{
          success: true,
          signatureValidated: true,
          path: '/tmp/official.pdf',
          bytes: 712785,
        }],
      },
    },
  })

  assert.equal(result.meta.next_phase, 'verify_download')
  assert.equal(result.meta.shared.exportModalCloseAttempts, 1)
  assert.equal(returnClicked, true)
})

test('prepare search closes stale wash-label edit drawer before querying the next SKU', async () => {
  let cancelClicked = false
  const cancelButton = new FakeElement({ tagName: 'button', text: '取消' })
  cancelButton.click = () => { cancelClicked = true }
  const drawer = new FakeElement({ text: '修改洗水唛 尺寸 (230mm*45mm) 完成并导出 取消' })
  drawer.querySelectorAll = selector => (selector === 'button' ? [cancelButton] : [])
  const document = baseDocument().setSelector('[class*="Drawer_visible"], [class*="Drawer_content"], [class*="drawer-body"], [class*="edit-modal_container"]', [drawer])

  const result = await runAdapter({
    phase: 'prepare_search',
    document,
    shared: {
      apiTarget: { ...READY_TARGET, outputFilename: '50588044853-9950019805206.pdf' },
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
    },
  })

  assert.equal(result.meta.next_phase, 'prepare_search')
  assert.equal(result.meta.shared.editDrawerCloseAttempts, 1)
  assert.equal(cancelClicked, true)
})

test('download flow opens wash-label editor instead of direct list export', async () => {
  let editClicked = false
  let directExportClicked = false
  const editButton = new FakeElement({ tagName: 'a', text: '编辑' })
  editButton.click = () => { editClicked = true }
  const exportButton = new FakeElement({ tagName: 'a', text: '导出' })
  exportButton.click = () => { directExportClicked = true }
  const row = new FakeElement({
    tagName: 'tr',
    text: [
      READY_TARGET.labelCode,
      READY_TARGET.productSkcId,
      READY_TARGET.productSkuId,
      READY_TARGET.skuExtCode,
      '已制作',
      '洗水唛',
      '导出',
      '编辑',
    ].join(' '),
  })
  row.querySelectorAll = selector => (
    selector === 'a,button,[role="button"]' ? [exportButton, editButton] : []
  )
  const document = baseDocument().setSelector('tr', [row])

  const result = await runAdapter({
    phase: 'verify_search',
    document,
    shared: {
      apiTarget: { ...READY_TARGET, outputFilename: '50588044853-9950019805206.pdf' },
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      careLabel: { size: '110' },
    },
  })

  assert.equal(result.meta.next_phase, 'prepare_edit_export')
  assert.equal(result.meta.shared.exportSource, 'wash_label_edit_complete_export')
  assert.equal(editClicked, true)
  assert.equal(directExportClicked, false)
})

test('wash-label editor complete-and-export button opens export preparation phase', async () => {
  let completeClicked = false
  const completeButton = new FakeElement({ tagName: 'button', text: '完成并导出' })
  completeButton.click = () => { completeClicked = true }
  const drawer = new FakeElement({ text: '修改洗水唛 尺寸 (230mm*45mm) 完成并导出 取消' })
  drawer.querySelectorAll = selector => (selector === 'button' ? [completeButton] : [])
  const document = baseDocument().setSelector('[class*="Drawer_visible"], [class*="Drawer_content"], [class*="drawer-body"], [class*="edit-modal_container"]', [drawer])

  const result = await runAdapter({
    phase: 'prepare_edit_export',
    document,
    shared: {
      apiTarget: { ...READY_TARGET, outputFilename: '50588044853-9950019805206.pdf' },
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
    },
  })

  assert.equal(result.meta.next_phase, 'prepare_export')
  assert.equal(result.meta.shared.exportSource, 'wash_label_edit_complete_export')
  assert.equal(result.meta.shared.temuRowStatus, '已从编辑窗口触发完成并导出')
  assert.equal(completeClicked, true)
})

test('safe print fallback starts from template length before export', async () => {
  let sizeEditClicked = false
  const editButton = new FakeElement({ tagName: 'a', text: '修改' })
  const sizeScope = new FakeElement({ text: '*洗水唛尺寸 长：270mm 宽：45mm 修改' })
  editButton.closest = () => sizeScope
  editButton.click = () => { sizeEditClicked = true }
  const completeButton = new FakeElement({ tagName: 'button', text: '完成并导出' })
  const drawer = new FakeElement({ text: '修改洗水唛 尺寸 (270mm*45mm) 已超出安全打印区域 长：270mm 宽：45mm 修改 完成并导出 取消' })
  drawer.querySelectorAll = selector => {
    if (selector === 'a,button,[role="button"]') return [editButton]
    if (selector === 'button') return [completeButton]
    return []
  }
  const document = baseDocument()
    .setSelector('[data-testid="beast-core-modal"], [class*="MDL_outerWrapper"], [class*="MDL_innerWrapper"]', [])
    .setSelector('[class*="Drawer_visible"], [class*="Drawer_content"], [class*="drawer-body"], [class*="edit-modal_container"]', [drawer])

  const result = await runAdapter({
    phase: 'prepare_edit_export',
    document,
    shared: {
      apiTarget: {
        ...READY_TARGET,
        outputFilename: '50588044853-9950019805206.pdf',
        excelLabelLengthMm: 270,
        excelLabelWidthMm: 45,
        excelLabelPaddingMm: 10,
      },
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      carePayloadSummary: { width: 45, len: 270, padding: 10 },
      careLabel: { width: 45, len: 270, padding: 10, size: '90' },
    },
  })

  assert.equal(result.meta.next_phase, 'prepare_edit_export')
  assert.equal(result.meta.shared.safePrintLengthBaseMm, 270)
  assert.equal(result.meta.shared.safePrintPendingLengthMm, 290)
  assert.equal(result.meta.shared.safePrintLengthCoarseSteps, 1)
  assert.equal(sizeEditClicked, true)
})

test('safe print fallback confirms adjusted length and updates result summary', async () => {
  let confirmed = false
  const lengthInput = new FakeElement({ tagName: 'input' })
  lengthInput.value = '270'
  const widthInput = new FakeElement({ tagName: 'input' })
  widthInput.value = '45'
  const confirmButton = new FakeElement({ tagName: 'button', text: '确认' })
  confirmButton.click = () => { confirmed = true }
  const modal = new FakeElement({ text: '修改洗水唛尺寸 长 mm 宽 mm 确认取消' })
  modal.querySelectorAll = selector => {
    if (selector === 'input') return [lengthInput, widthInput]
    if (selector === 'button') return [confirmButton]
    return []
  }
  const drawer = new FakeElement({ text: '修改洗水唛 尺寸 (270mm*45mm) 已超出安全打印区域 长：270mm 宽：45mm 完成并导出 取消' })
  drawer.querySelectorAll = selector => (selector === 'button' ? [new FakeElement({ tagName: 'button', text: '完成并导出' })] : [])
  const document = baseDocument()
    .setSelector('[data-testid="beast-core-modal"], [class*="MDL_outerWrapper"], [class*="MDL_innerWrapper"]', [modal])
    .setSelector('[class*="Drawer_visible"], [class*="Drawer_content"], [class*="drawer-body"], [class*="edit-modal_container"]', [drawer])

  const result = await runAdapter({
    phase: 'prepare_edit_export',
    document,
    shared: {
      apiTarget: {
        ...READY_TARGET,
        outputFilename: '50588044853-9950019805206.pdf',
        excelLabelLengthMm: 270,
        excelLabelWidthMm: 45,
      },
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      safePrintLengthBaseMm: 270,
      safePrintLengthCoarseSteps: 1,
      safePrintPendingLengthMm: 290,
      safePrintLengthAdjustmentStrategy: '+20mm',
      carePayload: { len: 270, width: 45 },
      carePayloadSummary: { width: 45, len: 270, padding: 10 },
      careLabel: { width: 45, len: 270, padding: 10, size: '90' },
    },
  })

  assert.equal(result.meta.next_phase, 'prepare_edit_export')
  assert.equal(result.meta.shared.carePayload.len, 290)
  assert.equal(result.meta.shared.carePayloadSummary.len, 290)
  assert.equal(result.meta.shared.carePayloadSummary.safePrintLengthAdjusted, true)
  assert.equal(result.meta.shared.carePayloadSummary.safePrintLengthBaseMm, 270)
  assert.equal(lengthInput.value, '290')
  assert.equal(widthInput.value, '45')
  assert.equal(confirmed, true)
})

test('export preparation retries complete-and-export when confirmation modal is delayed', async () => {
  let completeClicks = 0
  const completeButton = new FakeElement({ tagName: 'button', text: '完成并导出' })
  completeButton.click = () => { completeClicks += 1 }
  const drawer = new FakeElement({ text: '修改洗水唛 尺寸 (230mm*45mm) 完成并导出 取消' })
  drawer.querySelectorAll = selector => (selector === 'button' ? [completeButton] : [])
  const document = baseDocument()
    .setSelector('[data-testid="beast-core-modal"]', [])
    .setSelector('[class*="Drawer_visible"], [class*="Drawer_content"], [class*="drawer-body"], [class*="edit-modal_container"]', [drawer])

  const result = await runAdapter({
    phase: 'prepare_export',
    document,
    shared: {
      apiTarget: { ...READY_TARGET, outputFilename: '50588044853-9950019805206.pdf' },
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
      exportModalAttempts: 10,
      temuRowStatus: '已从编辑窗口触发完成并导出',
    },
  })

  assert.equal(result.meta.next_phase, 'prepare_export')
  assert.equal(result.meta.shared.exportModalAttempts, 11)
  assert.equal(result.meta.shared.temuRowStatus, '已重试从编辑窗口触发完成并导出')
  assert.equal(completeClicks, 1)
})

test('official PDF export action writes to configured output directory', async () => {
  let exportClicked = false
  const pdfLabel = new FakeElement({ tagName: 'label', text: 'PDF', attrs: { 'data-checked': 'true' } })
  const pngLabel = new FakeElement({ tagName: 'label', text: 'PNG', attrs: { 'data-checked': 'false' } })
  const exportButton = new FakeElement({ tagName: 'button', text: '确认无误，导出' })
  exportButton.click = () => { exportClicked = true }
  const modal = new FakeElement({ text: '确认导出吗？ PDF PNG 确认无误，导出' })
  modal.querySelectorAll = selector => {
    if (selector === 'label[data-testid="beast-core-checkbox"]') return [pdfLabel, pngLabel]
    if (selector === 'button') return [exportButton]
    return []
  }
  const document = baseDocument().setSelector('[data-testid="beast-core-modal"]', [modal])

  const result = await runAdapter({
    phase: 'verify_export_options',
    params: {
      output_dir: '/tmp/temu-ai-wash-pdfs',
    },
    document,
    shared: {
      apiTarget: { ...READY_TARGET, outputFilename: '50588044853-9950019805206.pdf' },
      excelTargets: [EXCEL_TARGET],
      excelTarget: EXCEL_TARGET,
    },
  })

  assert.equal(result.meta.action, 'download_clicks')
  assert.equal(result.meta.items[0].filename, '50588044853-9950019805206.pdf')
  assert.equal(result.meta.items[0].target_dir, '/tmp/temu-ai-wash-pdfs')
  assert.equal(result.meta.items[0].source, 'temu_official_download')
  assert.equal(result.meta.next_phase, 'verify_download')
  assert.equal(exportClicked, false)
})

test('download verification prefers the successful signed fallback item', async () => {
  const target = { ...READY_TARGET, outputFilename: '50588044853-9950019805206.pdf' }
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
  const target = { ...READY_TARGET, outputFilename: '50588044853-9950019805206.pdf' }
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
          filename: '50588044853-9950019805206.pdf',
          matchedBy: 'expected_name',
        }],
      },
    },
  })

  assert.equal(result.data[0].结果, 'official_download_received')
  assert.equal(result.data[0].文件路径, '/tmp/legacy-runner.pdf')
  assert.equal(result.data[0].PDF签名已校验, true)
})

test('download verification appends failed SKU to retry queue before final failure', async () => {
  const target = { ...READY_TARGET, outputFilename: '50588044853-9950019805206.pdf' }
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
          success: false,
          path: '/tmp/not-ready.pdf',
          error: '浏览器未返回官方 PDF 文件',
        }],
      },
    },
  })

  assert.equal(result.meta.next_phase, 'advance_excel_target')
  assert.equal(result.data.length, 0)
  assert.equal(result.meta.shared.excelTargets.length, 2)
  assert.equal(result.meta.shared.excelTargets[1].autoRetryAttempt, 1)
  assert.equal(result.meta.shared.excelTargets[1].autoRetryReason, '浏览器未返回官方 PDF 文件')
  assert.equal(result.meta.shared.failedSkuRetryAttempts['productSkuId:50588044853'], 1)
  assert.equal(result.meta.shared.sku_retrying, 1)
  assert.equal(result.meta.shared.sku_total, 2)
})

test('download verification records final failure after retry budget is exhausted', async () => {
  const retryTarget = {
    ...EXCEL_TARGET,
    autoRetryAttempt: 2,
    autoRetryReason: '浏览器未返回官方 PDF 文件',
  }
  const target = {
    ...READY_TARGET,
    outputFilename: '50588044853-9950019805206.pdf',
    autoRetryAttempt: 2,
    autoRetryReason: '浏览器未返回官方 PDF 文件',
  }
  const result = await runAdapter({
    phase: 'verify_download',
    shared: {
      apiValidated: true,
      apiTarget: target,
      excelTargets: [retryTarget],
      excelTarget: retryTarget,
      currentExcelTargetIndex: 0,
      failedSkuRetryAttempts: { 'productSkuId:50588044853': 2 },
      careLabel: { width: 35, len: 235, padding: 10, size: '110' },
      downloadResult: {
        items: [{
          success: false,
          path: '/tmp/not-ready.pdf',
          error: '浏览器未返回官方 PDF 文件',
        }],
      },
    },
  })

  assert.equal(result.meta.next_phase, 'advance_excel_target')
  assert.equal(result.data[0].结果, 'official_download_failed')
  assert.equal(result.data[0].自动重试次数, 2)
  assert.equal(result.data[0].是否重试后成功, false)
  assert.equal(result.meta.shared.sku_failed, 1)
})
