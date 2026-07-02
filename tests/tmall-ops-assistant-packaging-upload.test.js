import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => JSON.stringify(payload),
  }
}

async function loadExports(fetchImpl = async () => jsonResponse({}), params = {}) {
  const scriptPath = path.resolve('adapters/tmall-ops-assistant/tmall-packaging-upload.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const exportsBox = {}
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: '__exports__',
      __CRAWSHRIMP_SHARED__: {},
      __CRAWSHRIMP_EXPORTS__: exportsBox,
    },
    document: { cookie: '_tb_token_=test-token' },
    location: { href: 'https://fmp.semirapp.com/web/index#/home/file', hash: '#/home/file' },
    fetch: fetchImpl,
    FormData: globalThis.FormData,
    Blob: globalThis.Blob,
    File: globalThis.File,
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

async function runScript({ phase, shared = {}, params = {}, documentOverride = {}, locationOverride = {}, windowOverride = {}, fetchImpl = async () => jsonResponse({}) }) {
  const scriptPath = path.resolve('adapters/tmall-ops-assistant/tmall-packaging-upload.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const location = {
    href: 'https://fmp.semirapp.com/web/index#/home/file',
    hash: '#/home/file',
    ...locationOverride,
  }
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      __CRAWSHRIMP_EXPORTS__: null,
      ...windowOverride,
    },
    document: documentOverride,
    location,
    fetch: fetchImpl,
    FormData: globalThis.FormData,
    Blob: globalThis.Blob,
    File: globalThis.File,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
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
  const result = await vm.runInNewContext(source, context, { filename: scriptPath })
  return { result, location }
}

function fakeElement(text, { left = 80, className = '', onClick = () => {} } = {}) {
  return {
    innerText: text,
    textContent: text,
    className,
    tagName: 'DIV',
    disabled: false,
    value: '',
    ownerDocument: {
      defaultView: {
        MouseEvent: class MouseEvent {},
        PointerEvent: class PointerEvent {},
      },
    },
    getAttribute(name) {
      if (name === 'aria-selected') return className.includes('selected') || className.includes('active') ? 'true' : ''
      return ''
    },
    getBoundingClientRect() {
      return { width: 180, height: 32, left, top: 120 }
    },
    scrollIntoView() {},
    dispatchEvent() {},
    click() {
      onClick()
    },
  }
}

function fakeDocument(elements = []) {
  return {
    querySelectorAll() {
      return elements
    },
  }
}

function image(filename, fullpath = filename) {
  return {
    dir: '0',
    ext: filename.split('.').pop(),
    filename,
    fullpath: `品牌视觉部/鞋品/208126140007/${fullpath}`,
  }
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('packaging assets are grouped into Tmall upload buckets from names and dimensions', async () => {
  const helpers = await loadExports()
  const plan = helpers.classifyPackagingAssets([
    image('1440_1440(天猫).jpg', '208126140007/主图/1440_1440(天猫).jpg'),
    image('1440_1440(天猫)1.jpg', '208126140007/主图/1440_1440(天猫)1.jpg'),
    image('1440_14401.jpg', '208126140007/微详情/1440_14401.jpg'),
    image('1440_14402.jpg', '208126140007/微详情/1440_14402.jpg'),
    image('1440_1920(天猫).jpg', '208126140007/主图/1440_1920(天猫).jpg'),
    image('1440_1920(天猫)1.jpg', '208126140007/主图/1440_1920(天猫)1.jpg'),
    image('1440_19201.jpg', '208126140007/微详情/1440_19201.jpg'),
    image('1440_19202.jpg', '208126140007/微详情/1440_19202.jpg'),
    image('1440_19203.jpg', '208126140007/微详情/1440_19203.jpg'),
    image('1440_2160(天猫).jpg', '208126140007/主图/1440_2160(天猫).jpg'),
    image('详情_001.jpg'),
    image('详情_002.jpg'),
  ])

  assert.equal(plan.byCategory.main_1x1.length, 2)
  assert.equal(plan.byCategory.micro_1x1.length, 2)
  assert.equal(plan.byCategory.main_3x4.length, 2)
  assert.equal(plan.byCategory.micro_3x4.length, 3)
  assert.equal(plan.byCategory.vertical.length, 1)
  assert.equal(plan.byCategory.pc_detail.length, 2)
  assert.equal(plan.missing.length, 0)
})

test('packaging classifier reads underscore dimensions from Semir packaging filenames', async () => {
  const helpers = await loadExports()
  const plan = helpers.classifyPackagingAssets([
    image('800_800(天猫).jpg', '208126140007/主图/800_800(天猫).jpg'),
    image('800_800(天猫)1.jpg', '208126140007/主图/800_800(天猫)1.jpg'),
    image('1440_14401.jpg', '208126140007/微详情/1440_14401.jpg'),
    image('1440_14402.jpg', '208126140007/微详情/1440_14402.jpg'),
    image('1440_1920(天猫).jpg', '208126140007/主图/1440_1920(天猫).jpg'),
    image('1440_1920(天猫)1.jpg', '208126140007/主图/1440_1920(天猫)1.jpg'),
    image('1440_19201.jpg', '208126140007/微详情/1440_19201.jpg'),
    image('1440_19202.jpg', '208126140007/微详情/1440_19202.jpg'),
    image('1440_19203.jpg', '208126140007/微详情/1440_19203.jpg'),
    image('1440_2160(天猫).jpg', '208126140007/主图/1440_2160(天猫).jpg'),
    image('208126140007_01.jpg', '208126140007/images/208126140007_01.jpg'),
  ])

  assert.equal(plan.byCategory.main_1x1.length, 2)
  assert.equal(plan.byCategory.micro_1x1.length, 2)
  assert.equal(plan.byCategory.main_3x4.length, 2)
  assert.equal(plan.byCategory.micro_3x4.length, 3)
  assert.equal(plan.byCategory.vertical.length, 1)
  assert.deepEqual(plain(plan.byCategory.main_1x1.map(item => item.filename)), ['800_800(天猫).jpg', '800_800(天猫)1.jpg'])
  assert.deepEqual(plain(plan.byCategory.micro_1x1.map(item => item.filename)), ['1440_14401.jpg', '1440_14402.jpg'])
  assert.deepEqual(plain(plan.byCategory.main_3x4.map(item => item.filename)), ['1440_1920(天猫).jpg', '1440_1920(天猫)1.jpg'])
  assert.deepEqual(plain(plan.byCategory.micro_3x4.map(item => item.filename)), ['1440_19201.jpg', '1440_19202.jpg', '1440_19203.jpg'])
  assert.equal(plan.byCategory.vertical[0].filename, '1440_2160(天猫).jpg')
  assert.equal(plan.missing.length, 0)
})

test('packaging classifier caps PC detail images and prefers detail folder assets', async () => {
  const helpers = await loadExports()
  const detailImages = Array.from({ length: 40 }, (_, index) => {
    const seq = String(index + 1).padStart(2, '0')
    return image(
      `208123140211_${seq}.jpg`,
      `2024Q1/2-产品包装/2-详情/轻户外系列/208123140211/jpg/208123140211_${seq}.jpg`,
    )
  })
  const noisyMainImages = Array.from({ length: 30 }, (_, index) => image(
    `750_1000（天猫）${index + 1}.jpg`,
    `2024Q1/2-产品包装/1-主图/创意拍切图/轻户外系列/208123140211/750_1000（天猫）${index + 1}.jpg`,
  ))
  const plan = helpers.classifyPackagingAssets([
    image('800_800(天猫).jpg', '2024Q1/1-主图/主图微详情/208123140211/800_800(天猫).jpg'),
    image('800_800(天猫)1.jpg', '2024Q1/1-主图/主图微详情/208123140211/800_800(天猫)1.jpg'),
    image('1440_14401.jpg', '2024Q1/1-主图/主图微详情/208123140211/1440_14401.jpg'),
    image('1440_14402.jpg', '2024Q1/1-主图/主图微详情/208123140211/1440_14402.jpg'),
    image('1440_1920(天猫).jpg', '2024Q1/1-主图/主图微详情/208123140211/1440_1920(天猫).jpg'),
    image('1440_1920(天猫)1.jpg', '2024Q1/1-主图/主图微详情/208123140211/1440_1920(天猫)1.jpg'),
    image('1440_19201.jpg', '2024Q1/1-主图/主图微详情/208123140211/1440_19201.jpg'),
    image('1440_19202.jpg', '2024Q1/1-主图/主图微详情/208123140211/1440_19202.jpg'),
    image('1440_19203.jpg', '2024Q1/1-主图/主图微详情/208123140211/1440_19203.jpg'),
    image('1440_2160(天猫).jpg', '2024Q1/1-主图/主图微详情/208123140211/1440_2160(天猫).jpg'),
    ...noisyMainImages,
    ...detailImages,
  ])

  assert.equal(plan.byCategory.pc_detail.length, 30)
  assert.equal(plan.byCategory.pc_detail.every(item => String(item.fullpath).includes('/2-详情/')), true)
})

test('packaging classifier keeps optimized package assets eligible after latest-root selection', async () => {
  const helpers = await loadExports()
  const plan = helpers.classifyPackagingAssets([
    image('1440_1440(天猫).jpg', '2025Q4/羽绒优化/208425107212-优化/主图/1440_1440(天猫).jpg'),
    image('1440_1440(天猫)1.jpg', '2025Q4/羽绒优化/208425107212-优化/主图/1440_1440(天猫)1.jpg'),
    image('1440_14401.jpg', '2025Q4/羽绒优化/208425107212-优化/微详情/1440_14401.jpg'),
    image('1440_14402.jpg', '2025Q4/羽绒优化/208425107212-优化/微详情/1440_14402.jpg'),
    image('208425107212_01.jpg', '2025Q4/羽绒优化/208425107212-优化/images/208425107212_01.jpg'),
  ])

  assert.equal(plan.byCategory.main_1x1.every(item => String(item.fullpath || '').includes('208425107212-优化/主图/')), true)
  assert.deepEqual(plain(plan.byCategory.micro_1x1.map(item => item.filename)), ['1440_14401.jpg', '1440_14402.jpg'])
  assert.equal(plan.byCategory.pc_detail[0].fullpath, '品牌视觉部/鞋品/208126140007/2025Q4/羽绒优化/208425107212-优化/images/208425107212_01.jpg')
})

test('parseDimensionFromText accepts x, underscore, and sequence-suffixed dimensions', async () => {
  const helpers = await loadExports()

  assert.deepEqual(plain(helpers.parseDimensionFromText('800x800.jpg')), { width: 800, height: 800 })
  assert.deepEqual(plain(helpers.parseDimensionFromText('800_800(天猫).jpg')), { width: 800, height: 800 })
  assert.deepEqual(plain(helpers.parseDimensionFromText('800_8001.jpg')), { width: 800, height: 800 })
  assert.deepEqual(plain(helpers.parseDimensionFromText('1440_19201.jpg')), { width: 1440, height: 1920 })
})

test('normalizePackagingJobs expands one style row to multiple Tmall item jobs', async () => {
  const helpers = await loadExports()
  const normalized = helpers.normalizePackagingJobs({
    execute_mode: 'upload_draft',
    block_on_style_mismatch: true,
    folder_scan_depth: 4,
    cloud_path: '巴拉巴拉品牌事业部-市场系统//品牌视觉部/鞋品/208126140007/',
    input_file: {
      rows: [
        {
          __row_number: 5,
          款号: '208123140211',
          天猫商品ID: '693886015421, 693886015422',
        },
      ],
    },
  })

  assert.equal(normalized.jobs.length, 2)
  assert.equal(normalized.invalidRows.length, 0)
  assert.equal(normalized.jobs[0].row_no, 5)
  assert.equal(normalized.jobs[0].style_code, '208123140211')
  assert.equal(normalized.jobs[0].item_id, '693886015421')
  assert.equal(normalized.jobs[1].item_id, '693886015422')
  assert.equal(normalized.jobs[0].execute_mode, 'upload_draft')
  assert.equal(normalized.jobs[0].folder_scan_depth, 4)
  assert.match(normalized.jobs[0].cloud_path, /208123140211\/$/)
})

test('normalizeExecuteMode supports full publish and mobile sync mode', async () => {
  const helpers = await loadExports()

  assert.equal(helpers.normalizeExecuteMode('publish_and_sync_mobile'), 'publish_and_sync_mobile')
  assert.equal(helpers.normalizeExecuteMode('full_publish'), 'publish_and_sync_mobile')
  assert.equal(helpers.isTmallUploadMode('publish_and_sync_mobile'), true)
  assert.equal(helpers.isFullPublishMode('publish_and_sync_mobile'), true)
  assert.equal(helpers.isFullPublishMode('upload_draft'), false)
})

test('buildTmallSubmitPayload resolves category id from form category fallback', async () => {
  const helpers = await loadExports()
  const payload = helpers.buildTmallSubmitPayload({
    category: {
      categorySelect: {
        id: 124230010,
        submitId: 124230011,
      },
    },
  }, {
    id: '999412782684',
    _tb_token_: 'token',
  })

  assert.equal(payload.catId, '124230011')
  assert.equal(payload.itemId, '999412782684')
})

test('normalizePackagingJobs accepts common column aliases and records invalid rows', async () => {
  const helpers = await loadExports()
  const normalized = helpers.normalizePackagingJobs({
    cloud_path: '巴拉巴拉品牌事业部-市场系统//品牌视觉部/鞋品/208126140007/',
    input_file: {
      rows: [
        {
          __row_number: 2,
          编码: '208123140211',
          商品ID: 'https://item.taobao.com/item.htm?id=693886015421&skuId=999999999999',
        },
        {
          __row_number: 3,
          款号: '208123140212',
          天猫商品ID: '',
        },
      ],
    },
  })

  assert.equal(normalized.jobs.length, 1)
  assert.equal(normalized.jobs[0].style_code, '208123140211')
  assert.equal(normalized.jobs[0].item_id, '693886015421')
  assert.equal(normalized.jobs[0].row_no, 2)
  assert.equal(normalized.invalidRows.length, 1)
  assert.equal(normalized.invalidRows[0]['表格行号'], 3)
  assert.equal(normalized.invalidRows[0]['执行结果'], '参数错误')
  assert.match(normalized.invalidRows[0]['备注'], /天猫商品ID/)
})

test('deriveJobCloudPath replaces terminal style folder for each table row', async () => {
  const helpers = await loadExports()

  assert.equal(
    helpers.deriveJobCloudPath(
      '巴拉巴拉品牌事业部-市场系统//品牌视觉部/服饰包装组/鞋品/208126140007/',
      '208123140211',
    ),
    '巴拉巴拉品牌事业部-市场系统//品牌视觉部/服饰包装组/鞋品/208123140211/',
  )
  assert.equal(
    helpers.deriveJobCloudPath(
      '巴拉巴拉品牌事业部-市场系统//品牌视觉部/服饰包装组/鞋品/',
      '208123140211',
    ),
    '巴拉巴拉品牌事业部-市场系统//品牌视觉部/服饰包装组/鞋品/',
  )
  assert.equal(
    helpers.deriveJobCloudPath(
      '巴拉巴拉品牌事业部-市场系统//品牌视觉部/服饰包装组/鞋品/208126140007/',
      '208123140211',
      '森马视觉//单行覆盖/208123140211/',
    ),
    '森马视觉//单行覆盖/208123140211/',
  )
})

test('merchantCodeMatchesStyle allows Tmall color suffixes without allowing optimized folder suffixes', async () => {
  const helpers = await loadExports()

  assert.equal(helpers.merchantCodeMatchesStyle('208425107212', '208425107212'), true)
  assert.equal(helpers.merchantCodeMatchesStyle('208425107212-1', '208425107212'), true)
  assert.equal(helpers.merchantCodeMatchesStyle('208425107212-12345', '208425107212'), true)
  assert.equal(helpers.merchantCodeMatchesStyle('208425107212_A1', '208425107212'), true)
  assert.equal(helpers.merchantCodeMatchesStyle('208425107212-优化', '208425107212'), false)
  assert.equal(helpers.merchantCodeMatchesStyle('208425107213-1', '208425107212'), false)
})

test('ensure_cloud_folder clicks the left Semir mount tab before API search even when hash is active', async () => {
  let sidebarClicks = 0
  let titleClicks = 0
  const mountName = '巴拉巴拉品牌事业部-市场系统'
  const { result, location } = await runScript({
    phase: 'ensure_cloud_folder',
    shared: {
      mount_id: '1863',
      mount_name: mountName,
      mount_hash: '#/home/file/mount/1863',
      search_hash: '#/home/file/mount/1863/search?keyword=208123140211&mount_id=1863&scope=%5B%22filename%22%2C+%22tag%22%5D',
      current_job: { style_code: '208123140211' },
    },
    locationOverride: {
      hash: '#/home/file/mount/1863',
    },
    documentOverride: fakeDocument([
      fakeElement(mountName, { left: 360, onClick: () => { titleClicks += 1 } }),
      fakeElement(mountName, { left: 90, onClick: () => { sidebarClicks += 1 } }),
    ]),
  })

  assert.equal(result.meta.next_phase, 'ensure_cloud_folder')
  assert.equal(result.meta.shared.cloud_mount_tab_clicked, true)
  assert.equal(sidebarClicks, 1)
  assert.equal(titleClicks, 0)
})

test('ensure_cloud_folder enters search route after the Semir mount tab is active', async () => {
  const mountName = '巴拉巴拉品牌事业部-市场系统'
  const searchHash = '#/home/file/mount/1863/search?keyword=208123140211&mount_id=1863&scope=%5B%22filename%22%2C+%22tag%22%5D'
  const { result } = await runScript({
    phase: 'ensure_cloud_folder',
    shared: {
      mount_id: '1863',
      mount_name: mountName,
      mount_hash: '#/home/file/mount/1863',
      search_hash: searchHash,
      current_job: { style_code: '208123140211' },
    },
    locationOverride: {
      hash: '#/home/file/mount/1863',
    },
    documentOverride: fakeDocument([
      fakeElement(mountName, { left: 90, className: 'active selected' }),
    ]),
  })

  assert.equal(result.meta.next_phase, 'ensure_cloud_search')
  const next = await runScript({
    phase: result.meta.next_phase,
    shared: result.meta.shared,
    locationOverride: {
      hash: '#/home/file/mount/1863',
    },
    documentOverride: fakeDocument([]),
  })

  assert.equal(next.result.meta.next_phase, 'collect_cloud_assets')
  assert.equal(next.location.hash, searchHash)
})

test('wait_tmall_ready clicks return-old-description switch before continuing on new detail editor', async () => {
  const returnOld = fakeElement('返回旧版图文描述', { left: 1680 })
  const { result } = await runScript({
    phase: 'wait_tmall_ready',
    shared: {
      current_job: { item_id: '999412782684', style_code: '208425107212' },
      current_result_rows: [],
    },
    documentOverride: {
      title: '商家中心',
      body: { innerText: '图文描述 宝贝详情 返回旧版图文描述' },
      querySelectorAll(selector) {
        if (String(selector).includes('input')) return []
        return [returnOld]
      },
    },
    windowOverride: {
      __SELL_STATE__: {
        getState() {
          return {
            getComponentValue(name) {
              if (name === 'mainImagesGroup') return { images: [] }
              if (name === 'threeToFourImages') return []
              if (name === 'guideImageGroup') return { verticalImage: [] }
              if (name === 'modularDesc') return []
              return undefined
            },
            getComponentProps() {
              return {}
            },
            engine: null,
          }
        },
      },
    },
  })

  assert.equal(result.meta.action, 'cdp_clicks')
  assert.equal(result.meta.next_phase, 'wait_tmall_ready')
  assert.equal(result.meta.shared.legacy_switch_attempts, 1)
  assert.match(result.meta.shared.current_store, /切回旧版图文描述 1\/5/)
  assert.equal(result.meta.clicks.length, 1)
})

test('mobile detail editor readiness goes straight to import menu', async () => {
  const { result } = await runScript({
    phase: 'wait_mobile_editor_ready',
    shared: {
      current_job: { item_id: '736290773760', style_code: '208425107212' },
    },
    documentOverride: {
      body: { innerText: '手机详情 导入 完成编辑' },
      querySelectorAll() {
        return []
      },
    },
  })

  assert.equal(result.meta.next_phase, 'open_mobile_import_menu')
  assert.equal(result.meta.shared.current_store, '打开手机端导入菜单')
})

test('mobile detail import falls back to image-text split when full-image generation is absent', async () => {
  const { result } = await runScript({
    phase: 'select_mobile_full_image',
    shared: {
      current_job: { item_id: '736290773760', style_code: '208425107212' },
    },
    documentOverride: fakeDocument([
      fakeElement('图文分离'),
    ]),
  })

  assert.equal(result.meta.action, 'cdp_clicks')
  assert.equal(result.meta.next_phase, 'confirm_mobile_import_pc_detail')
  assert.equal(result.meta.shared.mobile_generate_mode, '图文分离')
  assert.equal(result.meta.clicks.length, 1)
})

test('mobile detail import menu uses CDP hover before opening nested import detail menu', async () => {
  const { result } = await runScript({
    phase: 'open_mobile_import_menu',
    shared: {
      current_job: { item_id: '736290773760', style_code: '208425107212' },
    },
    documentOverride: fakeDocument([
      fakeElement('导入'),
    ]),
  })

  assert.equal(result.meta.action, 'cdp_clicks')
  assert.equal(result.meta.next_phase, 'click_mobile_import_detail')
  assert.equal(result.meta.clicks[0].type, 'move')
})

test('mobile detail finish closes import success dialog before clicking finish edit', async () => {
  const confirm = fakeElement('确认', { left: 820 })
  const finish = fakeElement('完成编辑', { left: 1040 })
  const dialogRoot = {
    innerText: '导入电脑端详情成功! 确认',
    textContent: '导入电脑端详情成功! 确认',
    className: 'next-dialog',
    tagName: 'DIV',
    querySelectorAll() {
      return [confirm]
    },
    getBoundingClientRect() {
      return { width: 320, height: 180, left: 600, top: 360 }
    },
  }
  const { result } = await runScript({
    phase: 'finish_mobile_editor',
    shared: {
      current_job: { item_id: '736290773760', style_code: '208425107212' },
    },
    documentOverride: {
      body: { innerText: '导入电脑端详情成功! 确认 完成编辑' },
      querySelectorAll(selector) {
        if (String(selector).includes('dialog') || String(selector).includes('modal')) return [dialogRoot]
        return [finish, confirm]
      },
    },
  })

  assert.equal(result.meta.action, 'cdp_clicks')
  assert.equal(result.meta.next_phase, 'finish_mobile_editor')
  assert.equal(result.meta.shared.current_store, '关闭导入电脑端详情成功提示')
})

test('buildAnchoredPcDetailModules preserves first image and wanted-info bottom anchor while replacing middle detail images', async () => {
  const helpers = await loadExports()
  const modules = [
    {
      id: 30,
      name: '促销专区',
      content: [
        '<p>童装销售额全亚洲第一<img src="https://img.example/top.jpg"/></p>',
        '<p><img src="https://img.example/old-product-1.jpg"/></p>',
        '<p><img src="https://img.example/old-product-2.jpg"/></p>',
        '<div data-title="想要的信息看这里"><p><img src="https://img.example/wanted-info.jpg"/></p></div>',
        '<h3>尺码表</h3>',
        '<p><img src="https://img.example/size.jpg"/></p>',
        '<p><img src="https://img.example/model.jpg"/></p>',
      ].join(''),
      custom: false,
    },
  ]

  const result = helpers.buildAnchoredPcDetailModules(modules, [
    'https://img.example/new-detail-1.jpg',
    'https://img.example/new-detail-2.jpg',
  ])

  assert.equal(result.ok, true)
  assert.equal(result.mode, 'anchored_replace')
  assert.equal(result.replacedImageCount, 2)
  assert.equal(result.stopAnchorKind, 'wanted_info')
  assert.match(result.modules[0].content, /top\.jpg/)
  assert.match(result.modules[0].content, /new-detail-1\.jpg/)
  assert.match(result.modules[0].content, /new-detail-2\.jpg/)
  assert.match(result.modules[0].content, /wanted-info\.jpg/)
  assert.match(result.modules[0].content, /尺码表/)
  assert.match(result.modules[0].content, /size\.jpg/)
  assert.match(result.modules[0].content, /model\.jpg/)
  assert.doesNotMatch(result.modules[0].content, /old-product-1\.jpg/)
  assert.doesNotMatch(result.modules[0].content, /old-product-2\.jpg/)
})

test('buildAnchoredPcDetailModules preserves images through non-first asia top anchor before wash fallback', async () => {
  const helpers = await loadExports()
  const result = helpers.buildAnchoredPcDetailModules([
    {
      id: 30,
      name: '促销专区',
      content: [
        '<p><img src="https://img.example/pre-brand.jpg"/></p>',
        '<p><img src="https://img.example/campaign.jpg"/></p>',
        '<p><img src="https://img.example/asia-first.jpg"/></p>',
        '<p><img src="https://img.example/old-product-1.jpg"/></p>',
        '<p><img src="https://img.example/old-product-2.jpg"/></p>',
        '<div data-title="不同材质这样洗"><p><img src="https://img.example/wash-anchor.jpg"/></p></div>',
        '<p><img src="https://img.example/brand-story.jpg"/></p>',
      ].join(''),
      custom: false,
    },
  ], [
    'https://img.example/new-detail-1.jpg',
    'https://img.example/new-detail-2.jpg',
  ], {
    visualAnchors: {
      fixedTopImageIndex: 2,
      stopImageIndex: 5,
      stopAnchorKind: 'wash_fallback',
      source: 'tesseract_ocr',
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.fixedTopImageIndex, 2)
  assert.equal(result.replaceStartIndex, 3)
  assert.equal(result.replacedImageCount, 2)
  assert.equal(result.stopAnchorKind, 'wash_fallback')
  assert.match(result.modules[0].content, /pre-brand\.jpg/)
  assert.match(result.modules[0].content, /campaign\.jpg/)
  assert.match(result.modules[0].content, /asia-first\.jpg/)
  assert.match(result.modules[0].content, /new-detail-1\.jpg/)
  assert.match(result.modules[0].content, /new-detail-2\.jpg/)
  assert.match(result.modules[0].content, /不同材质这样洗/)
  assert.match(result.modules[0].content, /wash-anchor\.jpg/)
  assert.match(result.modules[0].content, /brand-story\.jpg/)
  assert.doesNotMatch(result.modules[0].content, /old-product-1\.jpg/)
  assert.doesNotMatch(result.modules[0].content, /old-product-2\.jpg/)
})

test('buildAnchoredPcDetailModules does not preserve first image from generic module name alone', async () => {
  const helpers = await loadExports()
  const result = helpers.buildAnchoredPcDetailModules([
    {
      id: 30,
      name: '促销专区',
      content: [
        '<p><img src="https://img.example/non-asia-top.jpg"/></p>',
        '<p><img src="https://img.example/old-middle.jpg"/></p>',
        '<div data-title="想要的信息看这里"><p><img src="https://img.example/wanted-info.jpg"/></p></div>',
      ].join(''),
      custom: false,
    },
  ], ['https://img.example/new-detail.jpg'])

  assert.equal(result.ok, true)
  assert.equal(result.preserveFirstImage, false)
  assert.equal(result.replacedImageCount, 2)
  assert.match(result.modules[0].content, /new-detail\.jpg/)
  assert.match(result.modules[0].content, /wanted-info\.jpg/)
  assert.doesNotMatch(result.modules[0].content, /non-asia-top\.jpg/)
  assert.doesNotMatch(result.modules[0].content, /old-middle\.jpg/)
})

test('buildAnchoredPcDetailModules blocks unstructured single legacy description', async () => {
  const helpers = await loadExports()
  const result = helpers.buildAnchoredPcDetailModules([
    {
      id: 88,
      name: '旧描述',
      content: '<p><img src="https://img.example/top.jpg"/></p><p><img src="https://img.example/unknown.jpg"/></p>',
      custom: true,
    },
  ], ['https://img.example/new-detail.jpg'])

  assert.equal(result.ok, false)
  assert.equal(result.mode, 'blocked_legacy_visual_anchor_missing')
  assert.match(result.note, /保守模式/)
})

test('buildAnchoredPcDetailModules uses module-level size anchors even when size module has no images', async () => {
  const helpers = await loadExports()
  const result = helpers.buildAnchoredPcDetailModules([
    {
      id: 30,
      name: '促销专区',
      content: '<p>童装销售额全亚洲第一<img src="https://img.example/top.jpg"/></p>',
      custom: false,
    },
    {
      id: -110,
      name: '商品参数',
      content: '<p>参数文字</p>',
      custom: true,
    },
    {
      id: -111,
      name: '商品尺码表',
      content: '<p>尺码表文字</p>',
      custom: true,
    },
    {
      id: -112,
      name: '商品细节',
      content: '<p><img src="https://img.example/later-detail.jpg"/></p>',
      custom: true,
    },
  ], ['https://img.example/new-detail.jpg'])

  assert.equal(result.ok, true)
  assert.equal(result.stopBoundaryType, 'module')
  assert.equal(result.stopAnchorKind, 'size')
  assert.equal(result.preserveFirstImage, true)
  assert.match(result.modules[0].content, /top\.jpg/)
  assert.match(result.modules[0].content, /new-detail\.jpg/)
  assert.equal(result.modules.some(module => module.name === '商品参数'), false)
  assert.equal(result.modules.some(module => module.name === '商品尺码表'), true)
  assert.match(result.modules.find(module => module.name === '商品细节').content, /later-detail\.jpg/)
})

test('buildAnchoredPcDetailModules replaces from first image when no fixed top image is detected', async () => {
  const helpers = await loadExports()
  const result = helpers.buildAnchoredPcDetailModules([
    {
      id: -110,
      name: '商品参数',
      content: '<p><img src="https://img.example/old-param-1.jpg"/></p><p><img src="https://img.example/old-param-2.jpg"/></p>',
      custom: true,
    },
    {
      id: -111,
      name: '商品尺码表',
      content: '<p>尺码表文字</p>',
      custom: true,
    },
  ], ['https://img.example/new-detail.jpg'])

  assert.equal(result.ok, true)
  assert.equal(result.preserveFirstImage, false)
  assert.equal(result.replacedImageCount, 2)
  assert.match(result.modules[0].content, /new-detail\.jpg/)
  assert.doesNotMatch(result.modules[0].content, /old-param-1\.jpg/)
  assert.doesNotMatch(result.modules[0].content, /old-param-2\.jpg/)
  assert.equal(result.modules.some(module => module.name === '商品尺码表'), true)
})

test('buildAnchoredPcDetailModules falls back to lower preserve anchors when size table is absent', async () => {
  const helpers = await loadExports()
  const result = helpers.buildAnchoredPcDetailModules([
    {
      id: 30,
      name: '促销专区',
      content: '<p>童装销售额全亚洲第一<img src="https://img.example/top.jpg"/></p>',
      custom: false,
    },
    {
      id: -110,
      name: '宝贝信息',
      content: '<p><img src="https://img.example/old-info.jpg"/></p>',
      custom: true,
    },
    {
      id: -111,
      name: '吊牌展示',
      content: '<p><img src="https://img.example/tag.jpg"/></p>',
      custom: true,
    },
  ], ['https://img.example/new-detail.jpg'])

  assert.equal(result.ok, true)
  assert.equal(result.stopAnchorKind, 'lower_preserve')
  assert.match(result.modules[0].content, /top\.jpg/)
  assert.match(result.modules[0].content, /new-detail\.jpg/)
  assert.equal(result.modules.some(module => module.name === '宝贝信息'), false)
  assert.match(result.modules.find(module => module.name === '吊牌展示').content, /tag\.jpg/)
})

test('buildAnchoredPcDetailModules preserves wanted-info anchor image inside the same module', async () => {
  const helpers = await loadExports()
  const result = helpers.buildAnchoredPcDetailModules([
    {
      id: 30,
      name: '促销专区',
      content: [
        '<p>童装销售额全亚洲第一<img src="https://img.example/top.jpg"/></p>',
        '<p><img src="https://img.example/old-middle.jpg"/></p>',
        '<div data-title="想要的信息看这里"><p><img src="https://img.example/old-info.jpg"/></p></div>',
        '<div data-title="品牌故事"><p><img src="https://img.example/story.jpg"/></p></div>',
      ].join(''),
      custom: false,
    },
  ], ['https://img.example/new-detail.jpg'])

  assert.equal(result.ok, true)
  assert.equal(result.stopAnchorKind, 'wanted_info')
  assert.match(result.modules[0].content, /top\.jpg/)
  assert.match(result.modules[0].content, /new-detail\.jpg/)
  assert.match(result.modules[0].content, /old-info\.jpg/)
  assert.match(result.modules[0].content, /品牌故事/)
  assert.match(result.modules[0].content, /story\.jpg/)
  assert.doesNotMatch(result.modules[0].content, /old-middle\.jpg/)
})

test('buildAnchoredPcDetailHtml preserves wanted-info and below when textual anchors are present', async () => {
  const helpers = await loadExports()
  const result = helpers.buildAnchoredPcDetailHtml([
    '<p>童装销售额全亚洲第一<img src="https://img.example/top.jpg"/></p>',
    '<p><img src="https://img.example/old-middle.jpg"/></p>',
    '<p>想要的信息看这里<img src="https://img.example/old-info.jpg"/></p>',
    '<p>尺码表</p>',
    '<p><img src="https://img.example/size.jpg"/></p>',
  ].join(''), ['https://img.example/new-detail.jpg'])

  assert.equal(result.ok, true)
  assert.equal(result.target, 'tmDescription')
  assert.equal(result.stopAnchorKind, 'wanted_info')
  assert.match(result.html, /top\.jpg/)
  assert.match(result.html, /new-detail\.jpg/)
  assert.match(result.html, /old-info\.jpg/)
  assert.match(result.html, /尺码表/)
  assert.match(result.html, /size\.jpg/)
  assert.doesNotMatch(result.html, /old-middle\.jpg/)
})

test('buildAnchoredPcDetailHtml blocks image-only old text PC detail without textual anchors', async () => {
  const helpers = await loadExports()
  const result = helpers.buildAnchoredPcDetailHtml([
    '<p><img src="https://img.example/top.jpg"/></p>',
    '<p><img src="https://img.example/old-info.jpg"/></p>',
    '<p><img src="https://img.example/visual-size-table.jpg"/></p>',
  ].join(''), ['https://img.example/new-detail.jpg'])

  assert.equal(result.ok, false)
  assert.equal(result.target, 'tmDescription')
  assert.match(result.note, /旧版文本PC详情/)
  assert.equal(result.html.includes('old-info.jpg'), true)
})

test('buildAnchoredPcDetailHtml can replace legacy image-only middle range when explicitly allowed', async () => {
  const helpers = await loadExports()
  const result = helpers.buildAnchoredPcDetailHtml([
    '<p><img src="https://img.example/top.jpg"/></p>',
    '<p><img src="https://img.example/old-middle-1.jpg"/></p>',
    '<p><img src="https://img.example/old-middle-2.jpg"/></p>',
    '<p><img src="https://img.example/unknown-lower.jpg"/></p>',
  ].join(''), [
    'https://img.example/new-detail-01.jpg',
    'https://img.example/new-detail-02.jpg',
  ], {
    allowLegacyCountImageReplace: true,
  })

  assert.equal(result.ok, true)
  assert.equal(result.target, 'tmDescription')
  assert.equal(result.mode, 'legacy_count_replace')
  assert.match(result.note, /替换中段/)
  assert.match(result.html, /top\.jpg/)
  assert.match(result.html, /new-detail-01\.jpg/)
  assert.match(result.html, /new-detail-02\.jpg/)
  assert.match(result.html, /unknown-lower\.jpg/)
  assert.doesNotMatch(result.html, /old-middle-1\.jpg/)
  assert.doesNotMatch(result.html, /old-middle-2\.jpg/)
})

test('buildAnchoredPcDetailHtml blocks image-only old text detail even when image counts look plausible', async () => {
  const helpers = await loadExports()
  const oldDetailImages = Array.from({ length: 15 }, (_, index) => `<p><img src="https://img.example/old-${String(index + 1).padStart(2, '0')}.jpg"/></p>`)
  const newDetailUrls = Array.from({ length: 15 }, (_, index) => `https://img.example/new-${String(index + 1).padStart(2, '0')}.jpg`)
  const result = helpers.buildAnchoredPcDetailHtml([
    '<p><img src="https://img.example/unknown-top.jpg"/></p>',
    ...oldDetailImages,
    '<p><img src="https://img.example/lower-01.jpg"/></p>',
    '<p><img src="https://img.example/lower-02.jpg"/></p>',
  ].join(''), newDetailUrls)

  assert.equal(result.ok, false)
  assert.equal(result.target, 'tmDescription')
  assert.equal(result.mode, 'blocked_legacy_visual_anchor_missing')
  assert.match(result.html, /unknown-top\.jpg/)
  assert.match(result.html, /old-01\.jpg/)
})

test('buildAnchoredPcDetailHtml can use explicit legacy image count fallback when allowed', async () => {
  const helpers = await loadExports()
  const oldDetailImages = Array.from({ length: 15 }, (_, index) => `<p><img src="https://img.example/old-${String(index + 1).padStart(2, '0')}.jpg"/></p>`)
  const newDetailUrls = Array.from({ length: 15 }, (_, index) => `https://img.example/new-${String(index + 1).padStart(2, '0')}.jpg`)
  const result = helpers.buildAnchoredPcDetailHtml([
    '<p><img src="https://img.example/asia-first.jpg"/></p>',
    ...oldDetailImages,
    '<p><img src="https://img.example/size-recommend.jpg"/></p>',
    '<p><img src="https://img.example/material-wash.jpg"/></p>',
    '<p><img src="https://img.example/brand-story.jpg"/></p>',
  ].join(''), newDetailUrls, {
    allowLegacyImageCountFallback: true,
    visualAnchors: { preserveFirstImage: true },
  })

  assert.equal(result.ok, true)
  assert.equal(result.target, 'tmDescription')
  assert.equal(result.preserveFirstImage, true)
  assert.equal(result.stopAnchorKind, 'legacy_image_count')
  assert.match(result.html, /asia-first\.jpg/)
  assert.match(result.html, /new-01\.jpg/)
  assert.match(result.html, /new-15\.jpg/)
  assert.match(result.html, /size-recommend\.jpg/)
  assert.match(result.html, /material-wash\.jpg/)
  assert.doesNotMatch(result.html, /old-01\.jpg/)
  assert.doesNotMatch(result.html, /old-15\.jpg/)
})

test('buildAnchoredPcDetailHtml accepts explicit visual stop image index for old text detail', async () => {
  const helpers = await loadExports()
  const result = helpers.buildAnchoredPcDetailHtml([
    '<p><img src="https://img.example/asia-first.jpg"/></p>',
    '<p><img src="https://img.example/old-01.jpg"/></p>',
    '<p><img src="https://img.example/old-02.jpg"/></p>',
    '<p><img src="https://img.example/material-wash.jpg"/></p>',
    '<p><img src="https://img.example/brand-story.jpg"/></p>',
  ].join(''), ['https://img.example/new-detail.jpg'], {
    visualAnchors: {
      preserveFirstImage: true,
      stopImageIndex: 3,
      stopAnchorKind: 'lower_preserve',
      source: 'visual_ocr',
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.target, 'tmDescription')
  assert.equal(result.stopAnchorKind, 'visual_lower_preserve')
  assert.match(result.html, /asia-first\.jpg/)
  assert.match(result.html, /new-detail\.jpg/)
  assert.match(result.html, /material-wash\.jpg/)
  assert.match(result.html, /brand-story\.jpg/)
  assert.doesNotMatch(result.html, /old-01\.jpg/)
  assert.doesNotMatch(result.html, /old-02\.jpg/)
})

test('buildPcDetailVisualAnchorsFromOcrResults detects fixed top and wanted-info anchor', async () => {
  const helpers = await loadExports()
  const anchors = helpers.buildPcDetailVisualAnchorsFromOcrResults([
    { globalIndex: 0, src: 'https://img.example/top.jpg' },
    { globalIndex: 1, src: 'https://img.example/old-01.jpg' },
    { globalIndex: 2, src: 'https://img.example/wanted.jpg' },
  ], [
    { globalIndex: 0, text: '童装销售额 全亚洲 第一', confidence: 84 },
    { globalIndex: 2, text: '想要的信息看这里', confidence: 91 },
  ])

  assert.equal(anchors.ocrStatus, 'recognized')
  assert.equal(anchors.preserveFirstImage, true)
  assert.equal(anchors.fixedTopImageIndex, 0)
  assert.equal(anchors.stopImageIndex, 2)
  assert.equal(anchors.stopAnchorKind, 'wanted_info')
  assert.equal(anchors.source, 'tesseract_ocr')
})

test('buildPcDetailVisualAnchorsFromOcrResults treats global award image as fixed top anchor', async () => {
  const helpers = await loadExports()
  const anchors = helpers.buildPcDetailVisualAnchorsFromOcrResults([
    { globalIndex: 0, src: 'https://img.example/award.jpg' },
    { globalIndex: 1, src: 'https://img.example/old-01.jpg' },
    { globalIndex: 2, src: 'https://img.example/wanted.jpg' },
  ], [
    { globalIndex: 0, text: '斩获多项全球大奖 多项国际大奖 以专业定义童鞋标准', confidence: 87 },
    { globalIndex: 2, text: '想要的信息看这里 产品名称', confidence: 91 },
  ])

  assert.equal(anchors.ocrStatus, 'recognized')
  assert.equal(anchors.preserveFirstImage, true)
  assert.equal(anchors.fixedTopImageIndex, 0)
  assert.equal(anchors.fixedTopAnchorKind, 'fixed_top')
  assert.equal(anchors.stopImageIndex, 2)
  assert.equal(anchors.stopAnchorKind, 'wanted_info')
  assert.equal(anchors.source, 'tesseract_ocr')
})

test('buildPcDetailVisualAnchorsFromOcrResults detects non-first fixed top anchor', async () => {
  const helpers = await loadExports()
  const anchors = helpers.buildPcDetailVisualAnchorsFromOcrResults([
    { globalIndex: 0, src: 'https://img.example/pre-brand.jpg' },
    { globalIndex: 1, src: 'https://img.example/campaign.jpg' },
    { globalIndex: 2, src: 'https://img.example/asia-first.jpg' },
    { globalIndex: 3, src: 'https://img.example/old-01.jpg' },
    { globalIndex: 4, src: 'https://img.example/old-02.jpg' },
    { globalIndex: 5, src: 'https://img.example/wash.jpg' },
  ], [
    { globalIndex: 2, text: '童装销售额 全亚洲 第一', confidence: 84 },
    { globalIndex: 5, text: '不同材质这样洗 洗涤小知识', confidence: 88 },
  ])

  assert.equal(anchors.ocrStatus, 'recognized')
  assert.equal(anchors.preserveFirstImage, true)
  assert.equal(anchors.fixedTopImageIndex, 2)
  assert.equal(anchors.stopImageIndex, 5)
  assert.equal(anchors.stopAnchorKind, 'wash_fallback')
})

test('buildPcDetailVisualAnchorsFromOcrResults preserves top marketing promo before wanted-info anchor', async () => {
  const helpers = await loadExports()
  const anchors = helpers.buildPcDetailVisualAnchorsFromOcrResults([
    { globalIndex: 0, src: 'https://img.example/member-gift.jpg' },
    { globalIndex: 1, src: 'https://img.example/old-product.jpg' },
    { globalIndex: 2, src: 'https://img.example/wanted-info.jpg' },
  ], [
    { globalIndex: 0, text: '会员专属礼赠 送IP周边礼盒 送T恤水杯 抢! 千款满300减120 淘金币补贴下单链路', confidence: 79 },
    { globalIndex: 2, text: '想要的信息看这里 产品名称 渔夫帽 尺码表', confidence: 88 },
  ])

  assert.equal(anchors.ocrStatus, 'recognized')
  assert.equal(anchors.preserveFirstImage, true)
  assert.equal(anchors.fixedTopImageIndex, 0)
  assert.equal(anchors.fixedTopAnchorKind, 'marketing_top')
  assert.equal(anchors.stopImageIndex, 2)
  assert.equal(anchors.stopAnchorKind, 'wanted_info')
})

test('buildPcDetailVisualAnchorsFromOcrResults ignores marketing promo after wanted-info anchor', async () => {
  const helpers = await loadExports()
  const anchors = helpers.buildPcDetailVisualAnchorsFromOcrResults([
    { globalIndex: 0, src: 'https://img.example/wanted-info.jpg' },
    { globalIndex: 1, src: 'https://img.example/detail.jpg' },
    { globalIndex: 2, src: 'https://img.example/member-gift.jpg' },
  ], [
    { globalIndex: 0, text: '想要的信息看这里 产品名称 渔夫帽 尺码表', confidence: 88 },
    { globalIndex: 2, text: '会员专属礼赠 淘金币补贴下单链路 抢! 千款满300减120', confidence: 79 },
  ])

  assert.equal(anchors.ocrStatus, 'recognized')
  assert.equal(anchors.preserveFirstImage, false)
  assert.equal(anchors.fixedTopImageIndex, undefined)
  assert.equal(anchors.stopImageIndex, 0)
  assert.equal(anchors.stopAnchorKind, 'wanted_info')
})

test('buildPcDetailVisualAnchorsFromOcrResults uses wash fallback when wanted-info is absent', async () => {
  const helpers = await loadExports()
  const anchors = helpers.buildPcDetailVisualAnchorsFromOcrResults([
    { globalIndex: 0, src: 'https://img.example/top.jpg' },
    { globalIndex: 1, src: 'https://img.example/old-01.jpg' },
    { globalIndex: 2, src: 'https://img.example/wash.jpg' },
  ], [
    { globalIndex: 2, text: '不同材质这样洗 机洗注意事项', confidence: 88 },
  ])

  assert.equal(anchors.ocrStatus, 'recognized')
  assert.equal(anchors.preserveFirstImage, false)
  assert.equal(anchors.stopImageIndex, 2)
  assert.equal(anchors.stopAnchorKind, 'wash_fallback')
})

test('mergePcDetailVisualFallbackAnchors prefers white-black visual fallback over OCR size anchors', async () => {
  const helpers = await loadExports()
  const anchors = helpers.mergePcDetailVisualFallbackAnchors({
    ocrStatus: 'recognized',
    preserveFirstImage: true,
    fixedTopImageIndex: 0,
    stopImageIndex: 8,
    stopAnchorKind: 'size',
    source: 'tesseract_ocr',
  }, {
    stopImageIndex: 5,
    stopAnchorKind: 'white_black_fallback',
    source: 'visual_canvas_white_black',
    confidence: 0.74,
  })

  assert.equal(anchors.stopImageIndex, 5)
  assert.equal(anchors.stopAnchorKind, 'white_black_fallback')
  assert.equal(anchors.fixedTopImageIndex, 0)
  assert.equal(anchors.source, 'visual_canvas_white_black')
})

test('tesseractRuntimeConfig defaults to OCR every original PC detail image', async () => {
  const helpers = await loadExports()
  const config = helpers.tesseractRuntimeConfig({})

  assert.equal(config.maxImages, Infinity)
})

test('tesseractRuntimeConfig defaults to bundled adapter asset URLs', async () => {
  const helpers = await loadExports()
  const config = helpers.tesseractRuntimeConfig({})

  assert.equal(config.scriptUrl, 'http://127.0.0.1:18765/adapter-assets/tmall-ops-assistant/vendor/tesseract/tesseract.min.js')
  assert.equal(config.workerPath, 'http://127.0.0.1:18765/adapter-assets/tmall-ops-assistant/vendor/tesseract/worker.min.js')
  assert.equal(config.corePath, 'http://127.0.0.1:18765/adapter-assets/tmall-ops-assistant/vendor/tesseract')
  assert.equal(config.langPath, 'http://127.0.0.1:18765/adapter-assets/tmall-ops-assistant/vendor/tesseract/lang')
  assert.equal(config.lang, 'chi_sim+eng')
})

test('tesseractRuntimeConfig allows explicit runtime URL overrides', async () => {
  const helpers = await loadExports()
  const config = helpers.tesseractRuntimeConfig({
    tesseract_script_url: 'https://example.test/tesseract.js',
    tesseract_worker_url: 'https://example.test/worker.js',
    tesseract_core_path: 'https://example.test/core',
    tesseract_lang_path: 'https://example.test/lang',
    tesseract_lang: 'eng',
  })

  assert.equal(config.scriptUrl, 'https://example.test/tesseract.js')
  assert.equal(config.workerPath, 'https://example.test/worker.js')
  assert.equal(config.corePath, 'https://example.test/core')
  assert.equal(config.langPath, 'https://example.test/lang')
  assert.equal(config.lang, 'eng')
})

test('wait_tmall_ready routes blocked PC detail probe into OCR anchor detection when enabled', async () => {
  const modularDesc = [{
    id: 88,
    name: '旧描述',
    content: '<p><img src="https://img.example/top.jpg"/></p><p><img src="https://img.example/old.jpg"/></p>',
    custom: true,
  }]
  const state = {
    getComponentValue(name) {
      if (name === 'mainImagesGroup') return { images: [] }
      if (name === 'modularDesc') return modularDesc
      if (name === 'tmDescription') return ''
      return undefined
    },
    getComponentProps() {
      return {}
    },
  }
  const { result } = await runScript({
    phase: 'wait_tmall_ready',
    params: { enable_ocr_anchor_detection: true },
    shared: {
      current_job: { item_id: '1061946933829', style_code: '208425107212', execute_mode: 'upload_draft' },
      current_result_rows: [
        { '下载结果': '已下载', __category: 'pc_detail', '本地文件': '/tmp/detail-01.jpg' },
      ],
    },
    locationOverride: {
      href: 'https://sell.publish.tmall.com/tmall/publish.htm?id=1061946933829',
    },
    documentOverride: {
      title: '商品编辑',
      body: { innerText: '' },
      querySelectorAll() {
        return []
      },
    },
    windowOverride: {
      __SELL_STATE__: {
        getState() {
          return state
        },
      },
    },
  })

  assert.equal(result.meta.next_phase, 'detect_pc_detail_ocr_anchors')
  assert.equal(result.meta.shared.pc_detail_replacement_probe.mode, 'blocked_legacy_visual_anchor_missing')
})

test('wait_tmall_ready routes successful PC detail probes into mandatory OCR before upload', async () => {
  const modularDesc = [{
    id: 30,
    name: '促销专区',
    content: [
      '<p>童装销售额全亚洲第一<img src="https://img.example/top.jpg"/></p>',
      '<p><img src="https://img.example/old-product.jpg"/></p>',
      '<p>不同材质这样洗<img src="https://img.example/wash.jpg"/></p>',
    ].join(''),
    custom: false,
  }]
  const state = {
    getComponentValue(name) {
      if (name === 'mainImagesGroup') return { images: [] }
      if (name === 'modularDesc') return modularDesc
      if (name === 'tmDescription') return ''
      return undefined
    },
    getComponentProps() {
      return {}
    },
  }
  const { result } = await runScript({
    phase: 'wait_tmall_ready',
    params: { enable_ocr_anchor_detection: false },
    shared: {
      current_job: { item_id: '617823532434', style_code: '208325103003', execute_mode: 'upload_draft' },
      current_result_rows: [
        { '下载结果': '已下载', __category: 'pc_detail', '本地文件': '/tmp/detail-01.jpg' },
      ],
    },
    locationOverride: {
      href: 'https://sell.publish.tmall.com/tmall/publish.htm?id=617823532434',
    },
    documentOverride: {
      title: '商品编辑',
      body: { innerText: '' },
      querySelectorAll() {
        return []
      },
    },
    windowOverride: {
      __SELL_STATE__: {
        getState() {
          return state
        },
      },
    },
  })

  assert.equal(result.meta.next_phase, 'detect_pc_detail_ocr_anchors')
  assert.equal(result.meta.shared.pc_detail_replacement_probe.mode, 'anchored_replace')
  assert.equal(result.meta.shared.pc_detail_ocr_attempted, true)
})

test('wait_tmall_ready uses outerId instead of item property style number for mismatch guard', async () => {
  const modularDesc = [{
    id: 30,
    name: '促销专区',
    content: [
      '<p>童装销售额全亚洲第一<img src="https://img.example/top.jpg"/></p>',
      '<p><img src="https://img.example/old-product.jpg"/></p>',
      '<p>不同材质这样洗<img src="https://img.example/wash.jpg"/></p>',
    ].join(''),
    custom: false,
  }]
  const componentValues = {
    outerId: '208425107212',
    itemProp: {
      'p-13021751': { value: '208425107237' },
    },
    mainImagesGroup: { images: [] },
    threeToFourImages: [],
    guideImageGroup: { verticalImage: [] },
    modularDesc,
    tmDescription: '',
  }
  const state = {
    getComponentValue(name) {
      return componentValues[name]
    },
    getComponentProps() {
      return {}
    },
  }
  const { result } = await runScript({
    phase: 'wait_tmall_ready',
    params: { enable_ocr_anchor_detection: false },
    shared: {
      current_job: {
        item_id: '999412782684',
        style_code: '208425107212',
        execute_mode: 'upload_draft',
        block_on_style_mismatch: true,
      },
      current_result_rows: [
        { '下载结果': '已下载', __category: 'pc_detail', '本地文件': '/tmp/detail-01.jpg' },
      ],
    },
    locationOverride: {
      href: 'https://sell.publish.tmall.com/tmall/publish.htm?id=999412782684',
    },
    documentOverride: {
      title: '商品编辑',
      body: { innerText: '' },
      querySelectorAll() {
        return []
      },
    },
    windowOverride: {
      __SELL_STATE__: {
        getState() {
          return state
        },
      },
    },
  })

  assert.equal(result.meta.next_phase, 'detect_pc_detail_ocr_anchors')
  assert.equal(result.meta.shared.tmall_status.merchantCode, '208425107212')
  assert.equal(result.meta.shared.pc_detail_replacement_probe.mode, 'anchored_replace')
})

test('wait_tmall_ready skips return-old click when legacy tmDescription is already available', async () => {
  const returnOld = fakeElement('返回旧版图文描述', { left: 1680 })
  const tmDescription = [
    '<p>童装销售额全亚洲第一<img src="https://img.example/top.jpg"/></p>',
    '<p><img src="https://img.example/old-product.jpg"/></p>',
    '<p>不同材质这样洗<img src="https://img.example/wash.jpg"/></p>',
  ].join('')
  const componentValues = {
    outerId: '208425107212',
    mainImagesGroup: { images: [] },
    threeToFourImages: [],
    guideImageGroup: { verticalImage: [] },
    tmDescription,
  }
  const state = {
    getComponentValue(name) {
      return componentValues[name]
    },
    getComponentProps() {
      return {}
    },
    engine: {
      getModels() {
        return { formValues: { tmDescription } }
      },
    },
  }
  const { result } = await runScript({
    phase: 'wait_tmall_ready',
    params: { enable_ocr_anchor_detection: false },
    shared: {
      current_job: {
        item_id: '999412782684',
        style_code: '208425107212',
        execute_mode: 'upload_draft',
        block_on_style_mismatch: true,
      },
      current_result_rows: [
        { '下载结果': '已下载', __category: 'pc_detail', '本地文件': '/tmp/detail-01.jpg' },
      ],
    },
    locationOverride: {
      href: 'https://sell.publish.tmall.com/tmall/publish.htm?id=999412782684',
    },
    documentOverride: {
      title: '商品编辑',
      body: { innerText: '返回旧版图文描述' },
      querySelectorAll(selector) {
        if (String(selector).includes('input')) return []
        return [returnOld]
      },
    },
    windowOverride: {
      __SELL_STATE__: {
        getState() {
          return state
        },
      },
    },
  })

  assert.equal(result.meta.next_phase, 'detect_pc_detail_ocr_anchors')
  assert.equal(result.meta.shared.pc_detail_replacement_probe.target, 'tmDescription')
})

test('wait_publish_result does not repeatedly confirm loading or hidden Tmall dialogs', async () => {
  let emitted = 0
  const components = {
    riskWarning: {
      getProps: () => ({ visible: true, loading: true }),
      emit: () => { emitted += 1 },
    },
    skuCheckDialog: {
      getProps: () => ({ visible: true, vis: false, loading: true }),
      emit: () => { emitted += 1 },
    },
  }
  const state = {
    getComponentValue(name) {
      if (name === 'mainImagesGroup') return { images: [] }
      if (name === 'threeToFourImages') return []
      if (name === 'guideImageGroup') return { verticalImage: [] }
      if (name === 'modularDesc') return []
      return undefined
    },
    getComponentProps() {
      return {}
    },
    engine: {
      getComponent(name) {
        return components[name] || null
      },
    },
  }
  const { result } = await runScript({
    phase: 'wait_publish_result',
    shared: {
      publish_stage: 'pc',
      publish_wait_attempts: 0,
      current_job: {
        item_id: '999412782684',
        style_code: '208425107212',
      },
      current_result_rows: [],
    },
    locationOverride: {
      href: 'https://sell.publish.tmall.com/tmall/publish.htm?id=999412782684',
    },
    documentOverride: {
      title: '商品编辑',
      body: { innerText: '' },
      querySelectorAll() {
        return []
      },
    },
    windowOverride: {
      __SELL_STATE__: {
        getState() {
          return state
        },
      },
    },
  })

  assert.equal(emitted, 0)
  assert.equal(result.meta.next_phase, 'wait_publish_result')
  assert.equal(result.meta.shared.publish_wait_attempts, 1)
  assert.match(result.meta.shared.current_store, /PC端提交发布等待 1\/12/)
})

test('wait_publish_result cools down after Taobao operation-speed warning', async () => {
  const state = {
    getComponentValue(name) {
      if (name === 'mainImagesGroup') return { images: [] }
      if (name === 'threeToFourImages') return []
      if (name === 'guideImageGroup') return { verticalImage: [] }
      if (name === 'modularDesc') return []
      return undefined
    },
    getComponentProps() {
      return {}
    },
    engine: {
      getComponent() {
        return null
      },
    },
  }
  const { result } = await runScript({
    phase: 'wait_publish_result',
    shared: {
      publish_stage: 'pc',
      publish_wait_attempts: 0,
      current_job: {
        item_id: '999412782684',
        style_code: '208425107212',
      },
      current_result_rows: [],
    },
    locationOverride: {
      href: 'https://sell.publish.tmall.com/tmall/publish.htm?id=999412782684',
    },
    documentOverride: {
      title: '商品编辑',
      body: { innerText: '警告 亲，您的操作速度太快了，请您稍等一会儿再试 确定' },
      querySelectorAll() {
        return []
      },
    },
    windowOverride: {
      __SELL_STATE__: {
        getState() {
          return state
        },
      },
    },
  })

  assert.equal(result.meta.next_phase, 'wait_publish_result')
  assert.equal(result.meta.sleep_ms, 90000)
  assert.equal(result.meta.shared.publish_speed_limit_count, 1)
  assert.match(result.meta.shared.current_store, /淘宝操作频率限制/)
})

test('wait_reopened_tmall_ready re-enters editor from Tmall success page', async () => {
  const edit = fakeElement('编辑商品', { left: 766 })
  edit.tagName = 'A'
  edit.href = 'https://upload.taobao.com/auction/publish/edit.htm?item_num_id=999412782684&auto=false'
  const { result, location } = await runScript({
    phase: 'wait_reopened_tmall_ready',
    shared: {
      tmall_wait_attempts: 0,
      current_job: {
        item_id: '999412782684',
        style_code: '208425107212',
      },
      current_result_rows: [],
    },
    locationOverride: {
      href: 'https://sell.publish.tmall.com/tmall/success.htm?isSuccess=true&primaryId=999412782684',
    },
    documentOverride: {
      title: '商品提交成功',
      body: { innerText: '商品提交成功 商品ID：999412782684 继续发布 查看商品 编辑商品' },
      querySelectorAll() {
        return [edit]
      },
    },
    windowOverride: {},
  })

  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'wait_reopened_tmall_ready')
  assert.equal(location.href, 'https://upload.taobao.com/auction/publish/edit.htm?item_num_id=999412782684&auto=false')
  assert.equal(result.meta.shared.reopened_after_pc_publish, true)
  assert.match(result.meta.shared.current_store, /从成功页进入编辑商品/)
})

test('submit_pc_publish clicks DOM submit before trying API submit', async () => {
  let fetchCalls = 0
  let clicked = 0
  const submit = fakeElement('提交', {
    left: 790,
    className: 'next-btn next-large next-btn-primary',
    onClick: () => { clicked += 1 },
  })
  submit.tagName = 'BUTTON'
  const { result } = await runScript({
    phase: 'submit_pc_publish',
    shared: {
      current_job: {
        item_id: '999412782684',
        style_code: '208425107212',
      },
      current_result_rows: [],
    },
    locationOverride: {
      href: 'https://sell.publish.tmall.com/tmall/publish.htm?id=999412782684',
    },
    documentOverride: {
      title: '商品编辑',
      body: { innerText: '商品发布 提交' },
      querySelectorAll() {
        return [submit]
      },
    },
    fetchImpl: async () => {
      fetchCalls += 1
      return jsonResponse({ success: true })
    },
  })

  assert.equal(clicked, 1)
  assert.equal(fetchCalls, 0)
  assert.equal(result.meta.next_phase, 'wait_publish_result')
  assert.equal(result.meta.shared.last_submit_method, 'dom_click')
})

test('wait_publish_result clicks visible DOM risk confirmation before API confirm', async () => {
  let emitted = 0
  let clicked = 0
  const confirm = fakeElement('确认提交', {
    left: 820,
    className: 'next-btn next-medium next-btn-primary',
    onClick: () => { clicked += 1 },
  })
  confirm.tagName = 'BUTTON'
  const state = {
    getComponentValue(name) {
      if (name === 'mainImagesGroup') return { images: [] }
      if (name === 'threeToFourImages') return []
      if (name === 'guideImageGroup') return { verticalImage: [] }
      if (name === 'modularDesc') return []
      return undefined
    },
    getComponentProps() {
      return {}
    },
    engine: {
      getComponent(name) {
        if (name !== 'riskWarning') return null
        return {
          getProps: () => ({ visible: true, loading: false }),
          emit: () => { emitted += 1 },
        }
      },
    },
  }
  const { result } = await runScript({
    phase: 'wait_publish_result',
    shared: {
      publish_stage: 'pc',
      publish_wait_attempts: 0,
      current_job: {
        item_id: '999412782684',
        style_code: '208425107212',
      },
      current_result_rows: [],
    },
    locationOverride: {
      href: 'https://sell.publish.tmall.com/tmall/publish.htm?id=999412782684',
    },
    documentOverride: {
      title: '商品编辑',
      body: { innerText: '图文详情编辑器升级提示 确认提交 返回修改' },
      querySelectorAll() {
        return [confirm]
      },
    },
    windowOverride: {
      __SELL_STATE__: {
        getState() {
          return state
        },
      },
    },
  })

  assert.equal(clicked, 1)
  assert.equal(emitted, 0)
  assert.equal(result.meta.next_phase, 'wait_publish_result')
  assert.equal(result.meta.shared.last_confirm_method, 'dom_click')
})

test('tmall upload pacing defaults to no per-file delay', async () => {
  const helpers = await loadExports()
  assert.equal(helpers.tmallTimingConfig().uploadBetweenFilesMs, 0)
  const throttled = await loadExports(undefined, { tmall_upload_between_files_ms: 500 })
  assert.equal(throttled.tmallTimingConfig().uploadBetweenFilesMs, 500)
})

test('buildTmallComponentValues creates main images, vertical image, and anchored PC detail replacement', async () => {
  const helpers = await loadExports()
  const values = helpers.buildTmallComponentValues({
    main_1x1: [
      { url: 'https://img.example/1.jpg', width: 800, height: 800, pix: '800x800' },
      { url: 'https://img.example/2.jpg', width: 800, height: 800, pix: '800x800' },
    ],
    micro_1x1: [
      { url: 'https://img.example/3.jpg', width: 800, height: 800, pix: '800x800' },
      { url: 'https://img.example/4.jpg', width: 800, height: 800, pix: '800x800' },
    ],
    main_3x4: [{ url: 'https://img.example/5.jpg' }, { url: 'https://img.example/6.jpg' }],
    micro_3x4: [{ url: 'https://img.example/7.jpg' }, { url: 'https://img.example/8.jpg' }, { url: 'https://img.example/9.jpg' }],
    vertical: [{ url: 'https://img.example/10.jpg' }],
    pc_detail: [{ url: 'https://img.example/detail-1.jpg' }, { url: 'https://img.example/detail-2.jpg' }],
  }, {
    guideImageGroup: { whiteBgImage: [{ url: 'https://img.example/white.jpg' }] },
    modularDesc: [{
      id: 30,
      name: '促销专区',
      content: '<p>童装销售额全亚洲第一<img src="https://img.example/top.jpg"/></p><p>产品信息</p><p><img src="https://img.example/old.jpg"/></p><p>尺码表</p><p><img src="https://img.example/size.jpg"/></p>',
      custom: false,
    }],
  })

  assert.equal(values.mainImagesGroup.images.length, 4)
  assert.equal(values.threeToFourImages.length, 5)
  assert.deepEqual(plain(values.guideImageGroup.verticalImage), [{ url: 'https://img.example/10.jpg' }])
  assert.deepEqual(plain(values.guideImageGroup.whiteBgImage), [{ url: 'https://img.example/white.jpg' }])
  assert.equal(values.modularDesc.length, 1)
  assert.equal(values.pcDetailReplacement.mode, 'anchored_replace')
  assert.match(values.modularDesc[0].content, /top\.jpg/)
  assert.match(values.modularDesc[0].content, /detail-1\.jpg/)
  assert.match(values.modularDesc[0].content, /detail-2\.jpg/)
  assert.match(values.modularDesc[0].content, /尺码表/)
  assert.match(values.modularDesc[0].content, /size\.jpg/)
  assert.doesNotMatch(values.modularDesc[0].content, /old\.jpg/)
})

test('buildTmallComponentValues replaces image slots from left and preserves trailing originals', async () => {
  const helpers = await loadExports()
  const values = helpers.buildTmallComponentValues({
    main_1x1: [
      { url: 'https://img.example/new-main-1.jpg', width: 1440, height: 1440, pix: '1440x1440' },
      { url: 'https://img.example/new-main-2.jpg', width: 1440, height: 1440, pix: '1440x1440' },
    ],
    micro_1x1: [
      { url: 'https://img.example/new-main-3.jpg', width: 1440, height: 1440, pix: '1440x1440' },
    ],
    main_3x4: [{ url: 'https://img.example/new-3x4-1.jpg' }],
    micro_3x4: [{ url: 'https://img.example/new-3x4-2.jpg' }],
    pc_detail: [],
  }, {
    mainImagesGroup: {
      images: [
        { url: 'https://img.example/old-main-1.jpg' },
        { url: 'https://img.example/old-main-2.jpg' },
        { url: 'https://img.example/old-main-3.jpg' },
        { url: 'https://img.example/old-main-4.jpg' },
        { url: 'https://img.example/old-main-5.jpg' },
      ],
      keep: true,
    },
    threeToFourImages: [
      { url: 'https://img.example/old-3x4-1.jpg' },
      { url: 'https://img.example/old-3x4-2.jpg' },
      { url: 'https://img.example/old-3x4-3.jpg' },
    ],
    modularDesc: [{
      id: 1,
      content: '<p><img src="https://img.example/top.jpg"/></p><p>想要的信息看这里</p>',
    }],
  })

  assert.equal(values.mainImagesGroup.keep, true)
  assert.deepEqual(values.mainImagesGroup.images.map(item => item.url), [
    'https://img.example/new-main-1.jpg',
    'https://img.example/new-main-2.jpg',
    'https://img.example/new-main-3.jpg',
    'https://img.example/old-main-4.jpg',
    'https://img.example/old-main-5.jpg',
  ])
  assert.deepEqual(values.threeToFourImages.map(item => item.url), [
    'https://img.example/new-3x4-1.jpg',
    'https://img.example/new-3x4-2.jpg',
    'https://img.example/old-3x4-3.jpg',
  ])
})

test('apply_tmall_draft mirrors component replacements into Tmall formValues model', async () => {
  const componentValues = {
    mainImagesGroup: { images: [{ url: 'https://img.example/old-main.jpg' }] },
    threeToFourImages: [{ url: 'https://img.example/old-3x4.jpg' }],
    guideImageGroup: { whiteBgImage: [{ url: 'https://img.example/white.jpg' }] },
    modularDesc: [{
      id: 1,
      content: '<p><img src="https://img.example/top.jpg"/></p><p>想要的信息看这里</p>',
    }],
  }
  const models = {
    formValues: {
      title: '保留原字段',
    },
  }
  const engine = {
    getModels() {
      return models
    },
    updateModels(patch) {
      if (patch.formValues) models.formValues = patch.formValues
    },
    getComponent(name) {
      return {
        emit(eventName, value) {
          assert.equal(eventName, 'change')
          componentValues[name] = value
        },
      }
    },
  }
  const state = {
    engine,
    getComponentValue(name) {
      return componentValues[name]
    },
    getComponentProps() {
      return {}
    },
  }

  const { result } = await runScript({
    phase: 'apply_tmall_draft',
    shared: {
      jobs: [{ item_id: '736290773760', style_code: '208425107212' }],
      current_job: { item_id: '736290773760', style_code: '208425107212', execute_mode: 'upload_draft' },
      current_result_rows: [{ '下载结果': '已下载', '上传结果': '已上传', '本地文件': '/tmp/main.jpg' }],
      uploaded_by_category: {
        main_1x1: [{ url: 'https://img.example/new-main.jpg', width: 1440, height: 1440, pix: '1440x1440' }],
        main_3x4: [{ url: 'https://img.example/new-3x4.jpg' }],
        vertical: [{ url: 'https://img.example/new-vertical.jpg' }],
        pc_detail: [],
      },
    },
    locationOverride: {
      href: 'https://sell.publish.tmall.com/tmall/publish.htm?id=736290773760',
    },
    documentOverride: {
      title: '商品编辑',
      body: { innerText: '' },
      querySelectorAll() {
        return []
      },
    },
    windowOverride: {
      __SELL_STATE__: {
        getState() {
          return state
        },
      },
    },
  })

  assert.equal(result.meta.action, 'complete')
  assert.equal(models.formValues.title, '保留原字段')
  assert.equal(models.formValues.mainImagesGroup.images[0].url, 'https://img.example/new-main.jpg')
  assert.equal(models.formValues.threeToFourImages[0].url, 'https://img.example/new-3x4.jpg')
  assert.equal(models.formValues.guideImageGroup.verticalImage[0].url, 'https://img.example/new-vertical.jpg')
  assert.equal(componentValues.mainImagesGroup.images[0].url, 'https://img.example/new-main.jpg')
  assert.match(result.meta.shared.applied_components.mainImagesGroup.method, /form_model/)
})

test('buildTmallComponentValues applies visual anchors to modularDesc replacements', async () => {
  const helpers = await loadExports()
  const values = helpers.buildTmallComponentValues({
    pc_detail: [{ url: 'https://img.example/detail-1.jpg' }],
  }, {
    modularDesc: [{
      id: 30,
      name: '促销专区',
      content: [
        '<p><img src="https://img.example/asia-first.jpg"/></p>',
        '<p><img src="https://img.example/old-middle.jpg"/></p>',
        '<p><img src="https://img.example/white-black-anchor.jpg"/></p>',
        '<p><img src="https://img.example/brand-story.jpg"/></p>',
      ].join(''),
      custom: false,
    }],
    pcDetailVisualAnchors: {
      preserveFirstImage: true,
      stopImageIndex: 2,
      stopAnchorKind: 'white_black_fallback',
      source: 'visual_similarity',
    },
  })

  assert.equal(values.pcDetailReplacement.ok, true)
  assert.equal(values.pcDetailReplacement.stopAnchorKind, 'white_black_fallback')
  assert.equal(values.pcDetailReplacement.preserveFirstImage, true)
  assert.match(values.modularDesc[0].content, /asia-first\.jpg/)
  assert.match(values.modularDesc[0].content, /detail-1\.jpg/)
  assert.match(values.modularDesc[0].content, /white-black-anchor\.jpg/)
  assert.match(values.modularDesc[0].content, /brand-story\.jpg/)
  assert.doesNotMatch(values.modularDesc[0].content, /old-middle\.jpg/)
})

test('buildTmallComponentValues writes old text PC detail through tmDescription fallback', async () => {
  const helpers = await loadExports()
  const values = helpers.buildTmallComponentValues({
    pc_detail: [{ url: 'https://img.example/detail-1.jpg' }],
  }, {
    tmDescription: [
      '<p>童装销售额全亚洲第一<img src="https://img.example/top.jpg"/></p>',
      '<p>产品信息</p>',
      '<p><img src="https://img.example/old.jpg"/></p>',
      '<p>尺码表</p>',
      '<p><img src="https://img.example/size.jpg"/></p>',
    ].join(''),
  })

  assert.equal(values.modularDesc, undefined)
  assert.match(values.tmDescription, /detail-1\.jpg/)
  assert.doesNotMatch(values.tmDescription, /old\.jpg/)
  assert.equal(values.pcDetailReplacement.target, 'tmDescription')
})

test('buildTmallSubmitPayload mirrors Tmall submit.htm form fields', async () => {
  const helpers = await loadExports()
  const payload = helpers.buildTmallSubmitPayload({
    title: '测试商品',
    modularDesc: [{ name: '商品参数', content: '<p>PC</p>' }],
  }, {
    id: 693886015421,
    catId: 50012341,
    scUrlDataComp: 'submit-key',
    roleType: 'seller',
    tmSpuPublishType: null,
    scmExtendInfo: { a: 1 },
    _tb_token_: 'token',
  })

  assert.equal(payload.itemId, '693886015421')
  assert.equal(payload.catId, '50012341')
  assert.equal(payload.submitUrlDataKey, 'submit-key')
  assert.equal(payload.roleType, 'seller')
  assert.equal(payload.globalScmExtendInfo, '{"a":1}')
  assert.equal(payload._tb_token_, 'token')
  assert.deepEqual(JSON.parse(payload.jsonBody).modularDesc[0].name, '商品参数')
})

test('buildShenbiMobileValueFromPcModules creates full-image mobile detail from PC modules', async () => {
  const helpers = await loadExports()
  const value = helpers.buildShenbiMobileValueFromPcModules([
    {
      name: '促销专区',
      content: '<p><img src="https://img.example/top.jpg"/></p><p><img src="https://img.example/detail.jpg"/></p>',
    },
    {
      name: '商品尺码表',
      content: '<p><img src="https://img.example/size.jpg"/></p>',
    },
  ], {
    cid: 8,
    descContainer: {
      detail: '<wapDesc></wapDesc>',
      nativeDetail: JSON.stringify({
        data: {
          ID: 'detail_layout_existing',
          type: 'native',
          key: 'sys_list',
          params: { requestMap: '{"see_more":true}' },
          putID: -1,
          children: [{
            ID: 'old',
            type: 'native',
            key: 'detail_container_style7',
            params: {
              childrenStyle: 'sequence',
              picUrl: 'https://img.example/old-mobile-promo.jpg',
            },
            putID: -1,
          }],
        },
      }),
      other: 'keep',
    },
    empty: true,
  }, {
    'https://img.example/detail.jpg': 12345,
  })

  assert.equal(value.cid, 8)
  assert.equal(value.empty, false)
  assert.equal(value.descContainer.other, 'keep')
  assert.match(value.descContainer.detail, /^<wapDesc>/)
  assert.match(value.descContainer.detail, /top\.jpg/)
  assert.match(value.descContainer.detail, /detail\.jpg/)
  assert.match(value.descContainer.detail, /size\.jpg/)
  assert.match(value.descContainer.detail, /size="12345">https:\/\/img\.example\/detail\.jpg/)
  assert.equal(value.descContainer.other, 'keep')
  assert.doesNotMatch(value.descContainer.nativeDetail, /old-mobile-promo\.jpg/)
  assert.match(value.descContainer.nativeDetail, /top\.jpg/)
  assert.match(value.descContainer.nativeDetail, /detail\.jpg/)
  assert.match(value.descContainer.nativeDetail, /size\.jpg/)
})

test('legacy tmDescription urls can rebuild Shenbi mobile native detail', async () => {
  const helpers = await loadExports()
  const html = [
    '<p><img src="https://img.example/top.jpg"/></p>',
    '<p><img src="https://img.example/new-detail.jpg"/></p>',
    '<p><img src="https://img.example/tail.jpg"/></p>',
  ].join('')
  const urls = helpers.pcDetailUrlsFromSource(null, html)
  const value = helpers.buildShenbiMobileValueFromPcUrls(urls, {
    descContainer: {
      detail: '<wapDesc></wapDesc>',
      nativeDetail: JSON.stringify({
        data: {
          ID: 'old-layout',
          type: 'native',
          key: 'sys_list',
          params: { requestMap: '{"see_more":true}' },
          children: [{
            ID: 'old-promo',
            type: 'native',
            key: 'detail_container_style7',
            params: {
              childrenStyle: 'sequence',
              picUrl: 'https://img.example/old-mobile-promo.jpg',
            },
            putID: -1,
          }],
        },
      }),
    },
    empty: true,
  })

  assert.deepEqual(Array.from(urls), [
    'https://img.example/top.jpg',
    'https://img.example/new-detail.jpg',
    'https://img.example/tail.jpg',
  ])
  assert.equal(value.empty, false)
  assert.match(value.descContainer.detail, /top\.jpg/)
  assert.match(value.descContainer.detail, /new-detail\.jpg/)
  assert.match(value.descContainer.detail, /tail\.jpg/)
  assert.doesNotMatch(value.descContainer.nativeDetail, /old-mobile-promo\.jpg/)
  assert.match(value.descContainer.nativeDetail, /top\.jpg/)
  assert.match(value.descContainer.nativeDetail, /new-detail\.jpg/)
  assert.match(value.descContainer.nativeDetail, /tail\.jpg/)
})

test('validateInjectedAsset guards obvious ratio mismatches before upload', async () => {
  const helpers = await loadExports()

  assert.equal(helpers.validateInjectedAsset({ __category: 'main_1x1' }, { width: 800, height: 800 }), '')
  assert.match(
    helpers.validateInjectedAsset({ __category: 'main_1x1' }, { width: 750, height: 1000 }),
    /不是1:1/,
  )
  assert.equal(helpers.validateInjectedAsset({ __category: 'vertical' }, { width: 800, height: 1200 }), '')
})

test('blockingUploadFailureRows detects downloaded images that did not upload cleanly', async () => {
  const helpers = await loadExports()
  const rows = [
    { '下载结果': '已下载', '上传结果': '已上传', '本地文件': '/tmp/ok.jpg' },
    { '下载结果': '已下载', '上传结果': '上传失败', '本地文件': '/tmp/fail.jpg' },
    { '下载结果': '已跳过', '上传结果': '', '本地文件': '' },
  ]

  const failures = helpers.blockingUploadFailureRows(rows)

  assert.equal(failures.length, 1)
  assert.equal(failures[0]['本地文件'], '/tmp/fail.jpg')
})

test('shouldAllowLegacyCountPcDetailReplace only trusts PC detail rows under 01 product packaging', async () => {
  const helpers = await loadExports()
  const productRows = [
    {
      __category: 'pc_detail',
      '下载结果': '已下载',
      '本地文件': '/tmp/detail-01.jpg',
      '云盘路径': '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2025Q4/羽绒优化/208425107212-优化/images/208425107212_01.jpg',
    },
  ]
  const auditRows = [
    {
      __category: 'pc_detail',
      '下载结果': '已下载',
      '本地文件': '/tmp/detail-01.jpg',
      '云盘路径': '品牌视觉部/服饰包装组/巴拉服饰产品包装/04-驻场设计/刘遥/婴幼/425婴幼包装/审核中/208425107212/images/208425107212_01.jpg',
    },
  ]

  assert.equal(helpers.shouldAllowLegacyCountPcDetailReplace(productRows, { execute_mode: 'publish_and_sync_mobile' }), true)
  assert.equal(helpers.shouldAllowLegacyCountPcDetailReplace(auditRows, { execute_mode: 'publish_and_sync_mobile' }), false)
  assert.equal(helpers.shouldAllowLegacyCountPcDetailReplace(productRows, { execute_mode: 'upload_draft' }), false)
})

test('uploadFileToTmall uses Tmall picture-center stream upload endpoint', async () => {
  let seenUrl = ''
  let seenBody = null
  const helpers = await loadExports(async (url, init = {}) => {
    seenUrl = String(url)
    seenBody = init.body
    return jsonResponse({
      success: true,
      object: {
        url: '//img.alicdn.com/imgextra/i1/test/O1CN.jpg',
        fileId: '123',
        pix: '1440x1440',
        size: 1336788,
      },
    })
  })
  const file = new File(['image-bytes'], '1440_1440(天猫).jpg', { type: 'image/jpeg' })

  const url = await helpers.uploadFileToTmall(file, 'main_1x1')

  assert.match(seenUrl, /^https:\/\/stream-upload\.taobao\.com\/api\/upload\.api\?/)
  assert.match(seenUrl, /picCompress=true/)
  assert.equal(seenBody.get('name'), '1440_1440(天猫).jpg')
  assert.equal(seenBody.get('_tb_token_'), 'test-token')
  assert.equal(seenBody.get('water'), 'false')
  assert.equal(seenBody.get('file').name, '1440_1440(天猫).jpg')
  assert.equal(url, 'https://img.alicdn.com/imgextra/i1/test/O1CN.jpg')
})

test('source resolver falls back to visible Semir mounts when configured mount is unavailable', async () => {
  const helpers = await loadExports(async (url, init = {}) => {
    if (String(url) === '/fengcloud/1/account/mount') {
      return jsonResponse({
        list: [
          { mount_id: 2023, org_name: '巴拉营运BU-商品' },
          { mount_id: 3283, org_name: '森马视觉' },
        ],
      })
    }
    if (String(url) === '/fengcloud/2/file/search') {
      assert.equal(init.method, 'POST')
      assert.match(String(init.body), /208126140007/)
      return jsonResponse({
        total: 2,
        list: [
          {
            dir: '1',
            filename: '208126140007',
            fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉春/126包装图/鞋品/12.8/208126140007',
          },
          {
            dir: '0',
            ext: 'jpg',
            filename: '208126140007_01.jpg',
            fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉春/126包装图/鞋品/12.8/208126140007/images/208126140007_01.jpg',
          },
        ],
      })
    }
    return jsonResponse({})
  })

  const source = await helpers.resolvePackagingSourceConfig({
    mountName: '巴拉巴拉品牌事业部-市场系统',
    relativePath: '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2026Q1/正春包装/鞋品/208126140007',
    raw: '巴拉巴拉品牌事业部-市场系统//品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2026Q1/正春包装/鞋品/208126140007/',
  }, {
    style_code: '208126140007',
  })

  assert.equal(source.mountId, '2023')
  assert.equal(source.mountName, '巴拉营运BU-商品')
  assert.match(source.relativePath, /126包装图\/鞋品\/12\.8\/208126140007$/)
  assert.match(source.sourceWarning, /未找到挂载点/)
})

test('collectPackagingAssets falls back to mount-wide packaging search when configured folder misses', async () => {
  const configuredPath = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2026Q1/正春包装/鞋品/208123140211'
  const mainFolder = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2024Q1/产品包装/男中/鞋品产品线/2-产品包装/2023Q1/2-产品包装/1-主图/主图微详情/轻户外系列/208123140211'
  const detailFolder = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2024Q1/产品包装/男中/鞋品产品线/2-产品包装/2023Q1/2-产品包装/2-详情/轻户外系列/208123140211'
  const creativeFolder = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2024Q1/产品包装/男中/鞋品产品线/2-产品包装/2023Q1/1-企划拍摄/2-导购平面/鞋品轻户外/208123140211-00311'
  const colorFolder = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2024Q1/产品包装/男中/鞋品产品线/2-产品包装/2023Q1/2-产品包装/1-主图/导购切图/鞋品轻户外/208123140211-00311'
  const helpers = await loadExports(async (url, init = {}) => {
    const requestUrl = new URL(String(url), 'https://fmp.semirapp.com')
    if (requestUrl.pathname === '/fengcloud/2/file/search') {
      assert.equal(init.method, 'POST')
      assert.match(String(init.body), /size=100/)
      return jsonResponse({
        total: 4,
        count: 4,
        list: [
          { dir: '1', filename: '208123140211', fullpath: mainFolder },
          { dir: '1', filename: '208123140211', fullpath: detailFolder },
          { dir: '1', filename: '208123140211-00311', fullpath: creativeFolder },
          { dir: '1', filename: '208123140211-00311', fullpath: colorFolder },
        ],
      })
    }
    if (requestUrl.pathname === '/fengcloud/1/file/ls') {
      const fullpath = requestUrl.searchParams.get('fullpath') || ''
      if (fullpath === configuredPath) return jsonResponse({ total: 0, list: [] })
      if (fullpath === mainFolder) {
        return jsonResponse({
          total: 10,
          list: [
            { dir: '0', filename: '1440_1440(天猫).jpg' },
            { dir: '0', filename: '1440_1440(天猫)1.jpg' },
            { dir: '0', filename: '1440_14401.jpg' },
            { dir: '0', filename: '1440_14402.jpg' },
            { dir: '0', filename: '1440_1920(天猫).jpg' },
            { dir: '0', filename: '1440_1920(天猫)1.jpg' },
            { dir: '0', filename: '1440_19201.jpg' },
            { dir: '0', filename: '1440_19202.jpg' },
            { dir: '0', filename: '1440_19203.jpg' },
            { dir: '0', filename: '1440_2160(天猫).jpg' },
          ],
        })
      }
      if (fullpath === detailFolder) {
        return jsonResponse({
          total: 2,
          list: [
            { dir: '0', filename: '208123140211_01.gif' },
            { dir: '0', filename: '208123140211_02.gif' },
          ],
        })
      }
      if (fullpath === creativeFolder) {
        throw new Error('creative source folder should not be listed when packaging folders are available')
      }
      if (fullpath === colorFolder) {
        throw new Error('style-color folder should not be listed for style-level packaging upload')
      }
    }
    return jsonResponse({ total: 0, list: [] })
  })

  const plan = await helpers.collectPackagingAssets({
    style_code: '208123140211',
    folder_scan_depth: 1,
  }, {
    mountId: '1863',
    relativePath: configuredPath,
  })

  assert.equal(plan.searchCount, 4)
  assert.equal(plan.folderCount, 2)
  assert.equal(plan.searchScope, 'mount_packaging_search')
  assert.equal(plan.byCategory.main_1x1.length, 2)
  assert.equal(plan.byCategory.micro_1x1.length, 2)
  assert.equal(plan.byCategory.main_3x4.length, 2)
  assert.equal(plan.byCategory.micro_3x4.length, 3)
  assert.equal(plan.byCategory.vertical.length, 1)
  assert.equal(plan.byCategory.pc_detail.length, 2)
  assert.equal(plan.items.some(item => String(item.fullpath || '').includes('1-企划拍摄')), false)
})

test('collectPackagingAssets uses 1440x2160 Tmall main-folder image for product vertical slot', async () => {
  const configuredPath = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2026Q1/正春包装/鞋品/208123140211'
  const mainFolder = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2024Q1/产品包装/男中/鞋品产品线/2-产品包装/2023Q1/2-产品包装/1-主图/创意拍切图/轻户外系列/208123140211'
  const verticalFolder = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2024Q1/产品包装/男中/鞋品产品线/2-产品包装/2023Q1/2-产品包装/导购素材/商品竖图/轻户外系列/208123140211'
  const helpers = await loadExports(async (url, init = {}) => {
    const requestUrl = new URL(String(url), 'https://fmp.semirapp.com')
    if (requestUrl.pathname === '/fengcloud/2/file/search') {
      assert.equal(init.method, 'POST')
      return jsonResponse({
        total: 2,
        count: 2,
        list: [
          { dir: '1', filename: '208123140211', fullpath: mainFolder },
          { dir: '1', filename: '208123140211', fullpath: verticalFolder },
        ],
      })
    }
    if (requestUrl.pathname === '/fengcloud/1/file/ls') {
      const fullpath = requestUrl.searchParams.get('fullpath') || ''
      if (fullpath === configuredPath) return jsonResponse({ total: 0, list: [] })
      if (fullpath === mainFolder) {
        return jsonResponse({
          total: 2,
          list: [
            { dir: '0', filename: '800_800(天猫)1.jpg' },
            { dir: '0', filename: '1440_2160(天猫).jpg' },
          ],
        })
      }
      if (fullpath === verticalFolder) {
        return jsonResponse({
          total: 1,
          list: [
            { dir: '0', filename: '208123140211_800x1200_商品竖图.jpg' },
          ],
        })
      }
    }
    return jsonResponse({ total: 0, list: [] })
  })

  const plan = await helpers.collectPackagingAssets({
    style_code: '208123140211',
    folder_scan_depth: 1,
  }, {
    mountId: '1863',
    relativePath: configuredPath,
  })

  assert.equal(plan.folderCount, 2)
  assert.equal(plan.byCategory.vertical.length, 1)
  assert.match(plan.byCategory.vertical[0].fullpath, /1-主图\/创意拍切图/)
  assert.equal(plan.byCategory.vertical[0].filename, '1440_2160(天猫).jpg')
})

test('collectPackagingAssets accepts flat season style folders under 01 product packaging', async () => {
  const configuredPath = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2026Q1/正春包装/鞋品/208425107212'
  const rootFolder = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2025Q4/婴幼童/208425107212'
  const mainFolder = `${rootFolder}/主图`
  const microFolder = `${rootFolder}/微详情`
  const detailFolder = `${rootFolder}/images`
  const optimizedFolder = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2025Q4/羽绒优化/208425107212-优化'
  const optimizedMainFolder = `${optimizedFolder}/主图`
  const optimizedMicroFolder = `${optimizedFolder}/微详情`
  const optimizedDetailFolder = `${optimizedFolder}/images`
  const auditFolder = '品牌视觉部/服饰包装组/巴拉服饰产品包装/04-驻场设计/刘遥/婴幼/425婴幼包装/审核中/208425107212'
  const helpers = await loadExports(async (url, init = {}) => {
    const requestUrl = new URL(String(url), 'https://fmp.semirapp.com')
    if (requestUrl.pathname === '/fengcloud/2/file/search') {
      assert.equal(init.method, 'POST')
      return jsonResponse({
        total: 4,
        count: 4,
        list: [
          { dir: '1', filename: '208425107212', fullpath: rootFolder, last_dateline: '2025-11-05 15:18:26' },
          { dir: '1', filename: '208425107212', fullpath: auditFolder, last_dateline: '2025-11-08 16:46:44' },
          { dir: '1', filename: '208425107212-优化', fullpath: optimizedFolder, last_dateline: '2025-11-05 13:58:26' },
          { dir: '0', ext: 'jpg', filename: '208425107212_15.jpg', fullpath: `${optimizedDetailFolder}/208425107212_15.jpg`, last_dateline: '2025-11-07 09:25:37' },
        ],
      })
    }
    if (requestUrl.pathname === '/fengcloud/1/file/ls') {
      const fullpath = requestUrl.searchParams.get('fullpath') || ''
      if (fullpath === configuredPath) return jsonResponse({ total: 0, list: [] })
      if (fullpath === auditFolder) throw new Error('审核中目录不应作为产品包装图包列目录')
      if (fullpath === rootFolder) {
        return jsonResponse({
          total: 5,
          list: [
            { dir: '1', filename: '主图' },
            { dir: '1', filename: '微详情' },
            { dir: '1', filename: 'images' },
            { dir: '1', filename: '源文件' },
            { dir: '0', filename: '208425107212.jpg' },
          ],
        })
      }
      if (fullpath === mainFolder) {
        return jsonResponse({
          total: 13,
          list: [
            { dir: '0', filename: '800_800(天猫).jpg' },
            { dir: '0', filename: '800_800(天猫)1.jpg' },
            { dir: '0', filename: '750_1000(天猫）.jpg' },
            { dir: '0', filename: '750_1000(天猫）1.jpg' },
            { dir: '0', filename: '800_1200(天猫).jpg' },
            { dir: '0', filename: '800_1200(天猫)1.jpg' },
            { dir: '0', filename: '1440_1440(天猫).jpg' },
            { dir: '0', filename: '1440_1440(天猫)1.jpg' },
            { dir: '0', filename: '1440_1920(天猫).jpg' },
            { dir: '0', filename: '1440_1920(天猫)1.jpg' },
            { dir: '0', filename: '1440_2160(天猫).jpg' },
            { dir: '0', filename: '950_1200(唯品).jpg' },
            { dir: '0', filename: '1200_1200(唯品).jpg' },
          ],
        })
      }
      if (fullpath === microFolder) {
        return jsonResponse({
          total: 5,
          list: [
            { dir: '0', filename: '800_8001.jpg' },
            { dir: '0', filename: '800_8002.jpg' },
            { dir: '0', filename: '1440_19201.jpg' },
            { dir: '0', filename: '1440_19202.jpg' },
            { dir: '0', filename: '1440_19203.jpg' },
          ],
        })
      }
      if (fullpath === detailFolder) {
        return jsonResponse({
          total: 2,
          list: [
            { dir: '0', filename: '208425107212_01.jpg' },
            { dir: '0', filename: '208425107212_02.jpg' },
          ],
        })
      }
      if (fullpath === `${rootFolder}/源文件`) {
        return jsonResponse({
          total: 1,
          list: [
            { dir: '0', filename: '208425107212.psd' },
          ],
        })
      }
      if (fullpath === optimizedFolder) {
        return jsonResponse({
          total: 3,
          list: [
            { dir: '1', filename: '主图' },
            { dir: '1', filename: '微详情' },
            { dir: '1', filename: 'images' },
          ],
        })
      }
      if (fullpath === optimizedMainFolder) {
        return jsonResponse({
          total: 3,
          list: [
            { dir: '0', filename: '1440_1440(天猫).jpg' },
            { dir: '0', filename: '1440_1440(天猫)1.jpg' },
            { dir: '0', filename: '1440_1920(天猫).jpg' },
          ],
        })
      }
      if (fullpath === optimizedMicroFolder) {
        return jsonResponse({
          total: 5,
          list: [
            { dir: '0', filename: '1440_14401.jpg' },
            { dir: '0', filename: '1440_14402.jpg' },
            { dir: '0', filename: '1440_19201.jpg' },
            { dir: '0', filename: '1440_19202.jpg' },
            { dir: '0', filename: '1440_19203.jpg' },
          ],
        })
      }
      if (fullpath === optimizedDetailFolder) {
        return jsonResponse({
          total: 3,
          list: [
            { dir: '0', filename: '208425107212_01.jpg' },
            { dir: '0', filename: '208425107212_02.jpg' },
            { dir: '0', filename: '208425107212_03.jpg' },
          ],
        })
      }
    }
    return jsonResponse({ total: 0, list: [] })
  })

  const plan = await helpers.collectPackagingAssets({
    style_code: '208425107212',
    folder_scan_depth: 2,
  }, {
    mountId: '1863',
    relativePath: configuredPath,
  })

  assert.equal(plan.folderCount, 2)
  assert.equal(plan.searchScope, 'mount_latest_root')
  assert.equal(plan.selectedStyleRoot, optimizedFolder)
  assert.equal(plan.byCategory.main_1x1.length, 2)
  assert.equal(plan.byCategory.micro_1x1.length, 2)
  assert.equal(plan.byCategory.main_3x4.length, 1)
  assert.equal(plan.byCategory.micro_3x4.length, 3)
  assert.equal(plan.byCategory.vertical.length, 0)
  assert.equal(plan.byCategory.pc_detail.length, 3)
  assert.equal(plan.byCategory.main_1x1.every(item => String(item.fullpath || '').includes('/208425107212-优化/')), true)
  assert.equal(plan.byCategory.pc_detail.every(item => String(item.fullpath || '').includes('/images/')), true)
  assert.equal(plan.byCategory.pc_detail.every(item => String(item.fullpath || '').includes('208425107212-优化')), true)
})

test('collectPackagingAssets prefers explicit optimized packaging folder for PC detail images', async () => {
  const configuredPath = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2026Q1/正春包装/鞋品/208425107212'
  const rootFolder = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2025Q4/婴幼童/208425107212'
  const optimizedFolder = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2025Q4/羽绒优化/208425107212-优化'
  const colorFolder = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2025Q4/婴幼童/208425107212-00311'
  const helpers = await loadExports(async (url, init = {}) => {
    const requestUrl = new URL(String(url), 'https://fmp.semirapp.com')
    if (requestUrl.pathname === '/fengcloud/2/file/search') {
      assert.equal(init.method, 'POST')
      return jsonResponse({
        total: 3,
        count: 3,
        list: [
          { dir: '1', filename: '208425107212', fullpath: rootFolder, dateline: '2025-08-22 16:57:03' },
          { dir: '1', filename: '208425107212-优化', fullpath: optimizedFolder, dateline: '2025-11-05 15:18:26' },
          { dir: '1', filename: '208425107212-00311', fullpath: colorFolder },
        ],
      })
    }
    if (requestUrl.pathname === '/fengcloud/1/file/ls') {
      const fullpath = requestUrl.searchParams.get('fullpath') || ''
      if (fullpath === configuredPath) return jsonResponse({ total: 0, list: [] })
      if (fullpath === rootFolder) {
        return jsonResponse({
          total: 3,
          list: [
            { dir: '1', filename: '主图' },
            { dir: '1', filename: '微详情' },
            { dir: '1', filename: 'images' },
          ],
        })
      }
      if (fullpath === `${rootFolder}/主图`) {
        return jsonResponse({
          total: 5,
          list: [
            { dir: '0', filename: '800_800(天猫).jpg' },
            { dir: '0', filename: '800_800(天猫)1.jpg' },
            { dir: '0', filename: '750_1000(天猫）.jpg' },
            { dir: '0', filename: '750_1000(天猫）1.jpg' },
            { dir: '0', filename: '800_1200(天猫).jpg' },
          ],
        })
      }
      if (fullpath === `${rootFolder}/微详情`) {
        return jsonResponse({
          total: 5,
          list: [
            { dir: '0', filename: '800_8001.jpg' },
            { dir: '0', filename: '800_8002.jpg' },
            { dir: '0', filename: '750_10001.jpg' },
            { dir: '0', filename: '750_10002.jpg' },
            { dir: '0', filename: '750_10003.jpg' },
          ],
        })
      }
      if (fullpath === `${rootFolder}/images`) {
        return jsonResponse({
          total: 2,
          list: [
            { dir: '0', filename: '208425107212_01.jpg' },
            { dir: '0', filename: '208425107212_02.jpg' },
          ],
        })
      }
      if (fullpath === optimizedFolder) {
        return jsonResponse({
          total: 1,
          list: [
            { dir: '1', filename: 'images' },
          ],
        })
      }
      if (fullpath === `${optimizedFolder}/images`) {
        return jsonResponse({
          total: 3,
          list: [
            { dir: '0', filename: '208425107212_01.jpg' },
            { dir: '0', filename: '208425107212_02.jpg' },
            { dir: '0', filename: '208425107212_03.jpg' },
          ],
        })
      }
      if (fullpath === colorFolder) {
        throw new Error('color-suffix folder should not be listed')
      }
    }
    return jsonResponse({ total: 0, list: [] })
  })

  const plan = await helpers.collectPackagingAssets({
    style_code: '208425107212',
    folder_scan_depth: 2,
  }, {
    mountId: '1863',
    relativePath: configuredPath,
  })

  assert.equal(plan.selectedStyleRoot, optimizedFolder)
  assert.equal(plan.byCategory.pc_detail.length, 3)
  assert.equal(plan.byCategory.pc_detail.every(item => String(item.fullpath || '').includes('/羽绒优化/208425107212-优化/images/')), true)
  assert.equal(plan.items.some(item => String(item.fullpath || '').includes('208425107212-00311')), false)
})
