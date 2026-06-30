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

async function loadExports(fetchImpl = async () => jsonResponse({})) {
  const scriptPath = path.resolve('adapters/tmall-ops-assistant/tmall-packaging-upload.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const exportsBox = {}
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: {},
      __CRAWSHRIMP_PHASE__: '__exports__',
      __CRAWSHRIMP_SHARED__: {},
      __CRAWSHRIMP_EXPORTS__: exportsBox,
    },
    document: {},
    location: { href: 'https://fmp.semirapp.com/web/index#/home/file', hash: '#/home/file' },
    fetch: fetchImpl,
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

async function runScript({ phase, shared = {}, params = {}, documentOverride = {}, locationOverride = {} }) {
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
    },
    document: documentOverride,
    location,
    fetch: async () => jsonResponse({}),
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
    image('208126140007_800x800_主图01.jpg'),
    image('208126140007_800x800_主图02.jpg'),
    image('208126140007_800x800_微详情01.jpg'),
    image('208126140007_800x800_微详情02.jpg'),
    image('208126140007_750x1000_主图01.jpg'),
    image('208126140007_750x1000_主图02.jpg'),
    image('208126140007_750x1000_微详情01.jpg'),
    image('208126140007_750x1000_微详情02.jpg'),
    image('208126140007_750x1000_微详情03.jpg'),
    image('208126140007_800x1200_商品竖图.jpg'),
    image('详情_001.jpg'),
    image('详情_002.jpg'),
  ])

  assert.equal(plan.byCategory.main_1x1.length, 2)
  assert.equal(plan.byCategory.micro_1x1.length, 2)
  assert.equal(plan.byCategory.main_3x4.length, 2)
  assert.equal(plan.byCategory.micro_3x4.length, 3)
  assert.equal(plan.byCategory.vertical.length, 1)
  assert.equal(plan.byCategory.pc_detail.length, 2)
  assert.deepEqual(plan.missing, [])
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
  assert.deepEqual(plan.missing, [])
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
  const { result } = await runScript({
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

test('buildAnchoredPcDetailModules preserves first image and size anchor while replacing middle detail images', async () => {
  const helpers = await loadExports()
  const modules = [
    {
      id: 30,
      name: '促销专区',
      content: [
        '<p><img src="https://img.example/top.jpg"/></p>',
        '<div data-title="想要的信息看这里">产品信息</div>',
        '<p><img src="https://img.example/old-product-1.jpg"/></p>',
        '<p><img src="https://img.example/old-product-2.jpg"/></p>',
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
  assert.match(result.modules[0].content, /top\.jpg/)
  assert.match(result.modules[0].content, /new-detail-1\.jpg/)
  assert.match(result.modules[0].content, /new-detail-2\.jpg/)
  assert.match(result.modules[0].content, /尺码表/)
  assert.match(result.modules[0].content, /size\.jpg/)
  assert.match(result.modules[0].content, /model\.jpg/)
  assert.doesNotMatch(result.modules[0].content, /old-product-1\.jpg/)
  assert.doesNotMatch(result.modules[0].content, /old-product-2\.jpg/)
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
      content: '<p><img src="https://img.example/top.jpg"/></p>',
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
      content: '<p><img src="https://img.example/top.jpg"/></p>',
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

test('buildAnchoredPcDetailModules preserves lower anchor block title inside the same module', async () => {
  const helpers = await loadExports()
  const result = helpers.buildAnchoredPcDetailModules([
    {
      id: 30,
      name: '促销专区',
      content: [
        '<p><img src="https://img.example/top.jpg"/></p>',
        '<div data-title="想要的信息看这里"><p><img src="https://img.example/old-info.jpg"/></p></div>',
        '<div data-title="品牌故事"><p><img src="https://img.example/story.jpg"/></p></div>',
      ].join(''),
      custom: false,
    },
  ], ['https://img.example/new-detail.jpg'])

  assert.equal(result.ok, true)
  assert.equal(result.stopAnchorKind, 'lower_preserve')
  assert.match(result.modules[0].content, /top\.jpg/)
  assert.match(result.modules[0].content, /new-detail\.jpg/)
  assert.match(result.modules[0].content, /品牌故事/)
  assert.match(result.modules[0].content, /story\.jpg/)
  assert.doesNotMatch(result.modules[0].content, /old-info\.jpg/)
})

test('buildAnchoredPcDetailHtml replaces old text PC detail when textual anchors are present', async () => {
  const helpers = await loadExports()
  const result = helpers.buildAnchoredPcDetailHtml([
    '<p>童装销售额全亚洲第一<img src="https://img.example/top.jpg"/></p>',
    '<p>想要的信息看这里</p>',
    '<p><img src="https://img.example/old-info.jpg"/></p>',
    '<p>尺码表</p>',
    '<p><img src="https://img.example/size.jpg"/></p>',
  ].join(''), ['https://img.example/new-detail.jpg'])

  assert.equal(result.ok, true)
  assert.equal(result.target, 'tmDescription')
  assert.match(result.html, /top\.jpg/)
  assert.match(result.html, /new-detail\.jpg/)
  assert.match(result.html, /尺码表/)
  assert.match(result.html, /size\.jpg/)
  assert.doesNotMatch(result.html, /old-info\.jpg/)
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
      content: '<p><img src="https://img.example/top.jpg"/></p><p>产品信息</p><p><img src="https://img.example/old.jpg"/></p><p>尺码表</p><p><img src="https://img.example/size.jpg"/></p>',
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
    descContainer: { detail: '<wapDesc></wapDesc>', other: 'keep' },
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
            { dir: '0', filename: '208123140211_800x800_主图01.jpg' },
            { dir: '0', filename: '208123140211_800x800_主图02.jpg' },
            { dir: '0', filename: '208123140211_800x800_微详情01.jpg' },
            { dir: '0', filename: '208123140211_800x800_微详情02.jpg' },
            { dir: '0', filename: '208123140211_750x1000_主图01.jpg' },
            { dir: '0', filename: '208123140211_750x1000_主图02.jpg' },
            { dir: '0', filename: '208123140211_750x1000_微详情01.jpg' },
            { dir: '0', filename: '208123140211_750x1000_微详情02.jpg' },
            { dir: '0', filename: '208123140211_750x1000_微详情03.jpg' },
            { dir: '0', filename: '208123140211_800x1200_商品竖图.jpg' },
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

test('collectPackagingAssets includes product vertical images from guide material folders', async () => {
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
            { dir: '0', filename: '750_1000（天猫）1.jpg' },
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
  assert.match(plan.byCategory.vertical[0].fullpath, /导购素材\/商品竖图/)
})

test('collectPackagingAssets accepts flat season style folders under 01 product packaging', async () => {
  const configuredPath = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2026Q1/正春包装/鞋品/208425107212'
  const rootFolder = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2025Q4/婴幼童/208425107212'
  const mainFolder = `${rootFolder}/主图`
  const microFolder = `${rootFolder}/微详情`
  const detailFolder = `${rootFolder}/images`
  const optimizedFolder = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2025Q4/羽绒优化/208425107212-优化'
  const helpers = await loadExports(async (url, init = {}) => {
    const requestUrl = new URL(String(url), 'https://fmp.semirapp.com')
    if (requestUrl.pathname === '/fengcloud/2/file/search') {
      assert.equal(init.method, 'POST')
      return jsonResponse({
        total: 3,
        count: 3,
        list: [
          { dir: '1', filename: '208425107212', fullpath: rootFolder },
          { dir: '1', filename: '208425107212-优化', fullpath: optimizedFolder },
          { dir: '0', ext: 'jpg', filename: '208425107212_01.jpg', fullpath: `${detailFolder}/208425107212_01.jpg` },
        ],
      })
    }
    if (requestUrl.pathname === '/fengcloud/1/file/ls') {
      const fullpath = requestUrl.searchParams.get('fullpath') || ''
      if (fullpath === configuredPath) return jsonResponse({ total: 0, list: [] })
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
          total: 11,
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
            { dir: '0', filename: '750_10001.jpg' },
            { dir: '0', filename: '750_10002.jpg' },
            { dir: '0', filename: '750_10003.jpg' },
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
      if (fullpath === optimizedFolder) return jsonResponse({ total: 0, list: [] })
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
  assert.equal(plan.searchScope, 'mount_packaging_search')
  assert.equal(plan.byCategory.main_1x1.length, 2)
  assert.equal(plan.byCategory.micro_1x1.length, 2)
  assert.equal(plan.byCategory.main_3x4.length, 2)
  assert.equal(plan.byCategory.micro_3x4.length, 3)
  assert.equal(plan.byCategory.vertical.length, 1)
  assert.equal(plan.byCategory.pc_detail.length, 2)
  assert.equal(plan.byCategory.pc_detail.every(item => String(item.fullpath || '').includes('/images/')), true)
  assert.equal(plan.byCategory.pc_detail.some(item => String(item.fullpath || '').includes('208425107212-优化')), false)
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
          { dir: '1', filename: '208425107212', fullpath: rootFolder },
          { dir: '1', filename: '208425107212-优化', fullpath: optimizedFolder },
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

  assert.equal(plan.byCategory.pc_detail.length, 3)
  assert.equal(plan.byCategory.pc_detail.every(item => String(item.fullpath || '').includes('/羽绒优化/208425107212-优化/images/')), true)
  assert.equal(plan.items.some(item => String(item.fullpath || '').includes('208425107212-00311')), false)
})
