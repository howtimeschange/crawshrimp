import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  }
}

async function loadExports(params = {}, fetchImpl = async () => jsonResponse({ code: '200', data: [] }), documentOverrides = {}, windowOverrides = {}) {
  const scriptPath = path.resolve('adapters/vipshop-ops-assistant/vipshop-package-main-image-replace.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const exportsBox = {}
  const documentBase = { body: { innerText: '' } }
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: '__exports__',
      __CRAWSHRIMP_SHARED__: {},
      __CRAWSHRIMP_EXPORTS__: exportsBox,
      ...windowOverrides,
    },
    document: { ...documentBase, ...documentOverrides },
    location: { href: 'https://nov-admin.vip.com/admin/index.html#/normal/normalMerchandise' },
    fetch: fetchImpl,
    URL,
    Blob: globalThis.Blob,
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

async function runScript({ params = {}, shared = {}, phase = 'main', fetchImpl, locationHref = 'https://nov-admin.vip.com/admin/index.html#/normal/normalMerchandise', bodyText = '', documentOverrides = {}, windowOverrides = {} }) {
  const scriptPath = path.resolve('adapters/vipshop-ops-assistant/vipshop-package-main-image-replace.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const documentBase = { title: '', body: { innerText: bodyText, textContent: bodyText } }
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      __CRAWSHRIMP_EXPORTS__: null,
      ...windowOverrides,
    },
    document: { ...documentBase, ...documentOverrides },
    location: { href: locationHref },
    fetch: fetchImpl,
    URL,
    Blob: globalThis.Blob,
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

function image(fullpath, width, height) {
  return {
    path: fullpath,
    filename: path.basename(fullpath),
    ext: path.extname(fullpath).slice(1),
    width,
    height,
  }
}

function product(overrides = {}) {
  return {
    vendorProductId: '1469658525260218368',
    sn: '201326108015',
    title: '柔软百搭婴幼宝宝儿童长裤女童',
    status: '11',
    shareDetailPic: true,
    itemSkuAttr: [
      { colourGSN: '20132610801588201', colourName: '牛仔中蓝', sizeAttr: [], colourImages: [], squareImages: [] },
      {
        colourGSN: '20132610801500311',
        colourName: '白色调',
        imageGroupIdStr: '1469658525260218374',
        sizeAttr: [{ name: '120cm', vendorSkuId: '950540996386041369', barCode: '6914678390308' }],
        colourImages: [{ imageIndex: 5, imageSize: '420x531' }],
        squareImages: [{ imageIndex: 1, imageSize: '1200x1200' }, { imageIndex: 50, imageSize: '950x1200' }],
      },
    ],
    ...overrides,
  }
}

test('normalizes 款号+货号 rows and reports duplicate or invalid rows', async () => {
  const helpers = await loadExports()
  const parsed = helpers.normalizePackageMainJobs({
    sheets: {
      '1-包装需上传明细表': {
        rows: [
          { __row_number: 2, 款号: '201326108015', 货号: '20132610801500311' },
          { __row_number: 3, 商品款号: '200326108106', 商品货号: '20032610810600488' },
          { __row_number: 4, 款号: '201326108015', 货号: '20132610801500311' },
          { __row_number: 5, 款号: '201326108015' },
        ],
      },
    },
  }, { execute_mode: 'plan' })

  assert.equal(parsed.totalRows, 4)
  assert.equal(parsed.jobs.length, 2)
  assert.equal(parsed.invalidRows.length, 2)
  assert.deepEqual(plain(parsed.jobs.map(job => [job.rowNo, job.styleCode, job.goodsCode])), [
    [2, '201326108015', '20132610801500311'],
    [3, '200326108106', '20032610810600488'],
  ])
  assert.equal(parsed.invalidRows[0].执行结果, '跳过重复')
  assert.equal(parsed.invalidRows[1].执行结果, '预检失败')
})

test('normalizes Vipshop upload function UI into internal operation scope', async () => {
  const helpers = await loadExports()
  const rows = [{ 款号: '201326108015', 货号: '20132610801500311' }]

  assert.deepEqual(plain(helpers.normalizeVipshopUploadScope({})), ['package', 'main_image'])
  assert.deepEqual(plain(helpers.normalizeVipshopUploadScope({ upload_scope: ['full'] })), ['package', 'main_image'])
  assert.deepEqual(plain(helpers.normalizeVipshopUploadScope({ upload_scope: ['main_image'] })), ['main_image'])
  assert.deepEqual(plain(helpers.normalizeVipshopUploadScope({ upload_scope: ['只传打标图'] })), ['main_image'])
  assert.deepEqual(plain(helpers.normalizeVipshopUploadScope({ upload_scope: ['package'] })), ['package'])
  assert.deepEqual(plain(helpers.normalizeVipshopUploadScope({ upload_scope: ['detail_image'] })), ['package'])
  assert.deepEqual(plain(helpers.normalizeVipshopUploadScope({ upload_scope: ['只传打标图', '只传包装图（商详页+商品展示345）'] })), ['package', 'main_image'])
  assert.deepEqual(plain(helpers.normalizeVipshopUploadScope({ operation_scope: ['main_image'] })), ['main_image'])

  const parsed = helpers.normalizePackageMainJobs({ rows }, { execute_mode: 'plan', upload_scope: ['package'] })
  assert.deepEqual(plain(parsed.jobs[0].operationScope), ['package'])
})

test('classifies Vipshop package and main-image assets by full goods code', async () => {
  const helpers = await loadExports()
  const plan = helpers.classifyVipshopAssets({
    styleCode: '201326108015',
    goodsCode: '20132610801500311',
  }, [
    image('/root/20132610801500311/主图/20132610801500311_1200_1200(唯品).jpg', 1200, 1200),
    image('/root/20132610801500311/主图/20132610801500311_950_1200(唯品).jpg', 950, 1200),
    image('/root/20132610801500311/微详情/20132610801500311_1200x1200_02.jpg', 1200, 1200),
    image('/root/20132610801500311/images/201326108015_01.jpg', 750, 1200),
    image('/root/20132610801500311/images/效果预览.jpg', 750, 3000),
    image('/root/20132610801500310/主图/20132610801500310_1200_1200.jpg', 1200, 1200),
  ])

  assert.equal(plan.goodsMatched, 5)
  assert.equal(plan.groups.mainSquare.length, 1)
  assert.equal(plan.groups.listImage.length, 1)
  assert.equal(plan.groups.packageMicroSquare.length, 1)
  assert.equal(plan.groups.detailSlices.length, 1)
  assert.ok(plan.groups.unmatched.some(item => item.reason === '疑似整张预览或源文件，详情切片跳过'))
})

test('uses the Vipshop packaging visual root as default cloud path', async () => {
  const helpers = await loadExports()
  const parsed = helpers.normalizePackageMainJobs({
    rows: [{ 款号: '201326108015', 货号: '20132610801500311' }],
  }, { execute_mode: 'plan' })

  assert.equal(
    parsed.jobs[0].cloudPath,
    '巴拉巴拉品牌事业部-市场系统//品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/',
  )
  assert.equal(
    helpers.defaultSemirCloudPath(),
    '巴拉巴拉品牌事业部-市场系统//品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/',
  )
})

test('initializes progress shared state for Vipshop package main-image replacement runs', async () => {
  const result = await runScript({
    params: {
      execute_mode: 'plan',
      input_file: {
        rows: [
          { __row_number: 2, 款号: '201326108015', 货号: '20132610801500311' },
          { __row_number: 3, 款号: '200326108106', 货号: '20032610810600488' },
        ],
      },
    },
    fetchImpl: async () => {
      throw new Error('main phase should not call network before navigation')
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'collect_cloud_assets')
  assert.equal(result.meta.shared.total_rows, 2)
  assert.equal(result.meta.shared.search_total_codes, 2)
  assert.equal(result.meta.shared.search_completed_codes, 0)
  assert.equal(result.meta.shared.detail_total_targets, 0)
  assert.equal(result.meta.shared.current_exec_no, 1)
  assert.equal(result.meta.shared.current_row_no, 2)
  assert.equal(result.meta.shared.current_buyer_id, '20132610801500311')
})

test('uses an independent Semir root and path features for Vipshop main/list images', async () => {
  const helpers = await loadExports()
  const parsed = helpers.normalizePackageMainJobs({
    rows: [{ 款号: '201326108015', 货号: '20132610801500311' }],
  }, { execute_mode: 'plan' })
  const job = parsed.jobs[0]

  assert.equal(job.cloudPath, '巴拉巴拉品牌事业部-市场系统//品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/')
  assert.equal(job.mainImageCloudPath, '巴拉巴拉品牌事业部-市场系统//品牌视觉部/')
  assert.deepEqual(plain(job.mainImagePathFeatures), ['主图打标', '京东唯品', '回图/唯品'])
  assert.equal(helpers.defaultVipshopMainImageCloudRoot(), '巴拉巴拉品牌事业部-市场系统//品牌视觉部/')
  assert.equal(
    helpers.pathMatchesMainImagePathFeatures('品牌视觉部/巴拉供应商/小仙/主图打标(京东唯品)/2027/999/回图/唯品/20132610801500311_1200x1200.jpg'),
    true,
  )
  assert.equal(
    helpers.pathMatchesMainImagePathFeatures('品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2026Q3/201326108015/20132610801500311_1200x1200.jpg'),
    false,
  )
})

test('row-level Vipshop package and marked-image cloud paths override form defaults', async () => {
  const helpers = await loadExports()
  const parsed = helpers.normalizePackageMainJobs({
    rows: [{
      款号: '201326108015',
      货号: '20132610801500311',
      包装图云盘主路径: '包装挂载//包装行路径/201326108015',
      打标图云盘根路径: '打标挂载//打标行路径/回图/唯品',
    }],
  }, {
    execute_mode: 'plan',
    cloud_path: '包装挂载//外部默认包装/000000000000',
    main_image_cloud_root: '打标挂载//外部默认打标',
  })

  assert.equal(parsed.jobs[0].cloudPath, '包装挂载//包装行路径/201326108015')
  assert.equal(parsed.jobs[0].mainImageCloudPath, '打标挂载//打标行路径/回图/唯品')
})

test('collects color-specific 1200 and 950 images from Vipshop main-image cloud path features', async () => {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), body: String(options.body || '') })
    const parsedUrl = new URL(String(url), 'https://fmp.semirapp.com')
    if (parsedUrl.pathname === '/fengcloud/1/account/mount') {
      return jsonResponse([{ name: '巴拉巴拉品牌事业部-市场系统', id: '1863' }])
    }
    if (parsedUrl.pathname === '/fengcloud/2/file/search') {
      const body = new URLSearchParams(String(options.body || ''))
      const keyword = body.get('keyword')
      const items = ['201326108015', '20132610801500311'].includes(keyword) ? [
        image('品牌视觉部/巴拉供应商/小仙/主图打标（京东唯品）/2027/999/回图/唯品/201326108015/20132610801500311_1200x1200.jpg', 1200, 1200),
        image('品牌视觉部/巴拉供应商/小仙/主图打标（京东唯品）/2027/999/回图/唯品/201326108015/20132610801500311_950x1200.jpg', 950, 1200),
        image('品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2026Q3/201326108015/20132610801500311_1200x1200.jpg', 1200, 1200),
      ] : []
      return jsonResponse({ total: items.length, list: items })
    }
    if (parsedUrl.pathname === '/fengcloud/2/file/info') {
      const fullpath = parsedUrl.searchParams.get('fullpath')
      return jsonResponse({ uri: `https://download.example/${encodeURIComponent(fullpath || '')}` })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const helpers = await loadExports({
    cloud_download_dir: '/tmp/vipshop-cloud-export',
    __task_run_id: 77,
  }, fetchImpl)
  const job = {
    styleCode: '201326108015',
    goodsCode: '20132610801500311',
    operationScope: ['main_image'],
    mainImageCloudPath: '巴拉巴拉品牌事业部-市场系统//品牌视觉部/',
    mainImagePathFeatures: helpers.normalizeMainImagePathFeatures(),
    folderScanDepth: 5,
  }

  const sources = await helpers.resolveVipshopCloudSources(job)
  const plan = await helpers.buildVipshopDownloadPlan(job, sources)

  assert.equal(sources.packageSource, null)
  assert.equal(sources.mainImageSource.relativePath, '品牌视觉部')
  assert.equal(plan.downloadItems.length, 2)
  assert.equal(
    plan.downloadItems[0].target_dir,
    '/tmp/vipshop-cloud-export/下载素材/run_77/201326108015_20132610801500311',
  )
  assert.match(plan.downloadItems[0].target_relative_path, /^0[12]_打标商品/)
  assert.deepEqual(plain(plan.downloadItems.map(item => item.filename).sort()), [
    '201326108015_20132610801500311__list_image__2__20132610801500311_950x1200.jpg',
    '201326108015_20132610801500311__main_square__1__20132610801500311_1200x1200.jpg',
  ])
  assert.equal(plan.plan.plan.groups.mainSquare[0].file.includes('/2027/999/回图/唯品/'), true)
  assert.equal(plan.plan.plan.groups.listImage[0].file.includes('/2027/999/回图/唯品/'), true)
  assert.equal(plan.plan.plan.groups.mainSquare.some(item => item.file.includes('服饰产品包装')), false)
  assert.equal(calls.some(call => call.url.includes('/fengcloud/1/file/ls')), false)
})

test('accepts Vipshop marked main images under return need-upload folders', async () => {
  const helpers = await loadExports()
  const job = {
    styleCode: '208926166212',
    goodsCode: '20892616621200454',
    mainImagePathFeatures: helpers.normalizeMainImagePathFeatures(),
  }
  const sourceConfig = {
    relativePath: '品牌视觉部',
    pathFeatures: helpers.normalizeMainImagePathFeatures(),
  }
  const main = image('品牌视觉部/巴拉供应商/小仙/主图打标（京东唯品）/2026/326/回图/第六批/需传/home+用品/20892616621200454-1200.jpg', 1200, 1200)
  const list = image('品牌视觉部/巴拉供应商/小仙/主图打标（京东唯品）/2026/326/回图/第六批/需传/home+用品/20892616621200454-950.jpg', 950, 1200)
  const plan = helpers.classifyVipshopAssets(job, [main, list])

  assert.equal(helpers.itemMatchesMainImageSource(main, job, sourceConfig), true)
  assert.equal(helpers.itemMatchesMainImageSource(list, job, sourceConfig), true)
  assert.equal(plan.groups.mainSquare.length, 1)
  assert.equal(plan.groups.listImage.length, 1)
})

test('prefers Vipshop package roots over logistics search hits', async () => {
  const helpers = await loadExports()
  const roots = helpers.collectStyleRootCandidates([
    {
      filename: '20132610801500311.jpg',
      fullpath: '品牌传播部/内容营销素材/2026/326物流图片-已编码/20132610801500311.jpg',
      ext: 'jpg',
      update_time: '2026-08-03',
    },
    {
      filename: '201326108015_01.jpg',
      fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/平拍原图/326包装图/幼童/7.27/201326108015/images/201326108015_01.jpg',
      ext: 'jpg',
      update_time: '2026-07-27',
    },
    {
      filename: '201326108015-00311.jpg',
      fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/平拍原图/全域/3p/幼童/201326108015 2-已写/201326108015-00311.jpg',
      ext: 'jpg',
      update_time: '2026-07-20',
    },
  ], '201326108015')

  assert.equal(
    roots[0].path,
    '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/平拍原图/326包装图/幼童/7.27/201326108015',
  )
  assert.equal(roots.some(root => root.path.includes('物流')), false)
  assert.equal(
    helpers.styleRootPathFromFullpath('巴拉货控/2026年巴拉秋/平拍原图/全域/3p/幼童/201326108015 2-已写/201326108015-00311.jpg', '201326108015'),
    '',
  )
})

test('matches hyphenated goods-code main images and keeps style-level detail slices', async () => {
  const helpers = await loadExports()
  const plan = helpers.classifyVipshopAssets({
    styleCode: '201326108015',
    goodsCode: '20132610801500311',
  }, [
    image('/全域/3p/幼童/201326108015 2-已写/201326108015-00311_1200x1200.jpg', 1200, 1200),
    image('/全域/3p/幼童/201326108015 2-已写/201326108015-00311_950x1200.jpg', 950, 1200),
    image('/326包装图/幼童/7.27/201326108015/images/201326108015_01.jpg', 750, 1200),
    image('/326包装图/幼童/7.27/201326108015/images/201326108015_02.jpg', 750, 1200),
  ])

  assert.equal(plan.goodsMatched, 2)
  assert.equal(plan.groups.mainSquare.length, 1)
  assert.equal(plan.groups.listImage.length, 1)
  assert.equal(plan.groups.detailSlices.length, 2)
  assert.equal(plan.groups.detailSlices[0].sourceMatch, '款号')
})

test('precheck note separates goods-code matches from additional style candidates', async () => {
  const helpers = await loadExports()
  const assetPlan = helpers.classifyVipshopAssets({
    styleCode: '209426108201',
    goodsCode: '20942610820190001',
    operationScope: ['main_image'],
  }, [
    image('/唯品/20942610820190001-1200.jpg', 1200, 1200),
    image('/唯品/20942610820190001-950.jpg', 950, 1200),
    image('/唯品/20942610820140627-1200.jpg', 1200, 1200),
    image('/唯品/20942610820140627-950.jpg', 950, 1200),
  ])
  const rows = helpers.buildJobPlanRows(
    { styleCode: '209426108201', goodsCode: '20942610820190001', operationScope: ['main_image'], executeMode: 'plan' },
    { merchandiseNo: 'M1', vendorSpuId: 'V1', name: 'test product' },
    product({ sn: '209426108201', itemSkuAttr: [{ colourGSN: '20942610820190001', colourName: '黑色调', squareImages: [] }] }),
    { colourGSN: '20942610820190001', colourName: '黑色调' },
    assetPlan,
  )

  assert.match(rows[0].备注, /素材按完整货号匹配 2 个/)
  assert.match(rows[0].备注, /另有款号候选 2 个/)
  assert.doesNotMatch(rows[0].备注, /未找到完整货号素材/)
})

test('verifies Vipshop readback image URLs across vpimg CDN host rewrites', async () => {
  const helpers = await loadExports()
  const uploadUrl = 'http://a.vpimg2.com/upload/merchandise/pdcvis/104218/2026/0804/183/6388ec27-669e-48dd-a14e-e421b29b9031.jpg'
  const readbackProduct = product({
    itemSkuAttr: [{
      colourGSN: '20942610820140627',
      colourName: '军绿-锁温贴身',
      squareImages: [{
        imageIndex: 1,
        imageUrl: 'http://a.vpimg4.com/upload/merchandise/pdcvis/104218/2026/0804/183/6388ec27-669e-48dd-a14e-e421b29b9031.jpg',
        imageSize: '1200x1200',
      }],
    }],
  })

  assert.equal(
    helpers.normalizeVipshopReadbackImageUrl(uploadUrl),
    '/upload/merchandise/pdcvis/104218/2026/0804/183/6388ec27-669e-48dd-a14e-e421b29b9031.jpg',
  )
  assert.equal(helpers.verifyImageUrlInDetail(uploadUrl, readbackProduct), true)
  assert.equal(
    helpers.verifyImageUrlInDetail(
      'http://a.vpimg2.com/upload/merchandise/pdcvis/104218/2026/0804/183/not-the-upload.jpg',
      readbackProduct,
    ),
    false,
  )
})

test('verifies Vipshop readback slots when saved URLs are rewritten', async () => {
  const helpers = await loadExports()
  const readbackProduct = product({
    itemSkuAttr: [{
      colourGSN: '20832610001501315',
      squareImages: [
        {
          imageIndex: 1,
          imageSize: '1200x1200',
          imageUrl: 'http://a.vpimg4.com/upload/merchandise/pdcvis/104218/2026/0820/30/saved-main.jpg',
        },
        {
          imageIndex: 50,
          imageSize: '950x1200',
          imageUrl: 'http://a.vpimg4.com/upload/merchandise/pdcvis/104218/2026/0820/116/saved-list.jpg',
        },
      ],
    }],
  })

  assert.equal(helpers.verifyUploadRecordPersistedInDetail({
    imageUrl: 'http://a.vpimg2.com/upload/merchandise/pdcvis/104218/2026/0820/61/upload-main.jpg',
    imageIndex: 1,
    usageKey: 'main_square',
    asset: { targetGoodsCode: '20832610001501315' },
  }, readbackProduct), true)
  assert.equal(helpers.verifyUploadRecordPersistedInDetail({
    imageUrl: 'http://a.vpimg2.com/upload/merchandise/pdcvis/104218/2026/0820/66/upload-list.jpg',
    imageIndex: 50,
    usageKey: 'list_image',
    asset: { targetGoodsCode: '20832610001501315' },
  }, readbackProduct), true)
  assert.equal(helpers.verifyUploadRecordPersistedInDetail({
    imageUrl: 'http://a.vpimg2.com/upload/merchandise/pdcvis/104218/2026/0820/66/upload-list.jpg',
    imageIndex: 50,
    usageKey: 'list_image',
    asset: { targetGoodsCode: '20832610001500317' },
  }, readbackProduct), false)
})

test('does not count unsaved PDC page state as Vipshop readback success', async () => {
  const uploadUrl = 'http://a.vpimg2.com/upload/merchandise/pdcvis/104218/2026/0820/59/not-persisted.jpg'
  const editable = {
    info: {
      vendorProductId: '2263980907443499008',
      itemSkuAttr: [{
        colourGSN: '20832610420530505',
        squareMainImages: [{ imageIndex: 1, imageUrl: uploadUrl }],
      }],
    },
    saveAndApprove() {},
  }
  const helpers = await loadExports({}, undefined, {
    body: { innerText: '', textContent: '' },
    querySelectorAll: () => [{ __vue__: editable }],
  })

  assert.equal(
    helpers.verifyImageUrlInDetail(uploadUrl, {}, {
      vendorProductId: '2263980907443499008',
      job: { goodsCode: '20832610420530505' },
    }),
    false,
  )
})

test('syncs Vipshop color bucket replacements into the composite page image array', async () => {
  const helpers = await loadExports()
  const newSquare = 'http://a.vpimg2.com/upload/merchandise/pdcvis/104218/2026/0820/59/new-square.jpg'
  const newList = 'http://a.vpimg2.com/upload/merchandise/pdcvis/104218/2026/0820/190/new-list.jpg'
  const color = {
    colourGSN: '20832610420530505',
    squareMainImages: [{ imageIndex: 1, index: 0, imageUrl: 'http://a.vpimg4.com/old-square.jpg' }],
    squareImages: [],
    listImages: [{ imageIndex: 50, index: 0, imageUrl: 'http://a.vpimg4.com/old-list.jpg' }],
    listPics: [{ imageIndex: 50, index: 0, imageUrl: '' }],
    $images: [
      { imageIndex: 1, index: 0, imageUrl: 'http://a.vpimg4.com/old-square.jpg' },
      { imageIndex: 50, index: 10, imageUrl: 'http://a.vpimg4.com/old-list.jpg' },
    ],
  }

  helpers.applyMainSquareRecordsToColors([color], [{
    imageUrl: newSquare,
    asset: { targetGoodsCode: '20832610420530505', filename: 'main.jpg' },
  }], '20832610420530505')
  helpers.applyListImageRecordsToColors([color], [{
    imageUrl: newList,
    asset: { targetGoodsCode: '20832610420530505', filename: 'list.jpg' },
  }], '20832610420530505')

  assert.equal(color.squareMainImages[0].imageUrl, newSquare)
  assert.equal(color.listImages[0].imageUrl, newList)
  assert.equal(color.listPics[0].imageUrl, newList)
  assert.equal(color.$images.find(item => item.imageIndex === 1).imageUrl, newSquare)
  assert.equal(color.$images.find(item => item.imageIndex === 50).imageUrl, newList)
})

test('preflights Vipshop page-owned save payload before submitting live uploads', async () => {
  const squareUrl = 'http://a.vpimg2.com/upload/merchandise/pdcvis/104218/2026/0820/59/new-square.jpg'
  const listUrl = 'http://a.vpimg2.com/upload/merchandise/pdcvis/104218/2026/0820/190/new-list.jpg'
  const detailModules = [
    { name: 'joinedHorseRacing', value: '1' },
    { name: '增值税特殊管理', value: '1' },
    { name: '是否有防盗扣', value: '否' },
    { name: '洗涤说明', value: '请根据产品面料特性进行清洗养护，具体方法可参考产品水洗唛/标签', washDescError: true },
    { name: '活动卖点', value: '' },
  ]
  const customModule = {
    $children: [],
    $options: { name: 'custom-module', methods: {} },
    custommodule: detailModules,
    $forceUpdateCalled: 0,
    $forceUpdate() {
      this.$forceUpdateCalled += 1
    },
  }
  const editable = {
    $children: [],
    $options: { name: 'goods-form', methods: {} },
    info: {
      vendorProductId: '2263980907443499008',
      sn: '208326104205',
      itemSkuAttr: [{
        colourGSN: '20832610420530505',
        sizeAttr: [],
        squareMainImages: [{ imageIndex: 1, index: 0, imageUrl: squareUrl }],
        listImages: [{ imageIndex: 50, index: 0, imageUrl: listUrl }],
        detailImages: [],
        list_5_7: [],
        transparentImages: [],
        hangTagWashingMarkImgs: { imgs: [] },
        tagImage: { imgs: [] },
      }],
    },
    editdata: {
      itemDetailModules: detailModules,
    },
    opts: {},
    saveAndApprove() {},
    getSaveItemSkuAttr(productVo) {
      return productVo.itemSkuAttr.map(color => ({
        ...color,
        squareImages: [...color.squareMainImages, ...color.listImages],
        colourImages: [...color.detailImages, ...color.list_5_7, ...color.transparentImages],
      }))
    },
    getSaveImages() {
      return { itemImages: [], squareImages: [], giftImagesMap: null }
    },
    copySaveImages() {},
  }
  const helpers = await loadExports({}, undefined, {
    body: { innerText: '', textContent: '' },
    querySelectorAll: () => [{ __vue__: editable }, { __vue__: customModule }],
  })

  const preview = helpers.buildPdcSavePayloadPreview({
    vendorProductId: '2263980907443499008',
  }, [
    { imageUrl: squareUrl },
    { imageUrl: listUrl },
  ])

  assert.equal(preview.ok, true)
  assert.equal(preview.expectedCount, 2)
  assert.equal(preview.foundCount, 2)
  assert.deepEqual(editable.editdata.itemDetailModules.map(item => item.name), ['joinedHorseRacing', '增值税特殊管理', '是否有防盗扣'])
  assert.deepEqual(customModule.custommodule.map(item => item.name), ['joinedHorseRacing', '增值税特殊管理', '是否有防盗扣'])
  assert.equal(customModule.$forceUpdateCalled, 1)
  assert.deepEqual(plain(preview.itemDetailModules.removed.map(item => [item.name, item.reason])), [
    ['洗涤说明', '未申请自定义模块'],
    ['活动卖点', '模块名或内容为空'],
  ])
  assert.doesNotThrow(() => helpers.assertPdcSavePayloadContainsUploads({
    vendorProductId: '2263980907443499008',
  }, [
    { imageUrl: squareUrl },
    { imageUrl: listUrl },
  ]))
  assert.throws(
    () => helpers.assertPdcSavePayloadContainsUploads({ vendorProductId: '2263980907443499008' }, [{ imageUrl: 'http://a.vpimg2.com/not-in-payload.jpg' }]),
    /保存 payload 预检失败/,
  )

  const emptyPageHelpers = await loadExports({}, undefined, {
    body: { innerText: '', textContent: '' },
    querySelectorAll: () => [],
  })
  assert.throws(
    () => emptyPageHelpers.assertPdcSavePayloadContainsUploads({ vendorProductId: '2263980907443499008' }, [{ imageUrl: squareUrl }]),
    /PDC 编辑组件未进入可保存状态/,
  )
})

test('sanitizes Vipshop custom detail modules that block save', async () => {
  const helpers = await loadExports()
  const result = helpers.sanitizePdcCustomDetailModules([
    { name: 'joinedHorseRacing', value: '1' },
    { name: '短视频url', value: 'https://example.com/video.mp4' },
    { name: '商品名中心词', value: 'T恤' },
    { name: '活动卖点', value: '' },
    { name: '活动卖点', value: '舒适透气' },
    { name: '活动卖点', value: '重复卖点' },
    { name: '', value: '没有模块名' },
    { name: '是否有防盗扣', value: '否' },
  ])

  assert.deepEqual(plain(result.modules.map(item => `${item.name}:${item.value}`)), [
    'joinedHorseRacing:1',
    '活动卖点:舒适透气',
    '是否有防盗扣:否',
  ])
  assert.deepEqual(plain(result.removed.map(item => [item.name, item.reason])), [
    ['短视频url', '未申请自定义模块'],
    ['商品名中心词', '未申请自定义模块'],
    ['活动卖点', '模块名或内容为空'],
    ['活动卖点', '模块名重复'],
    ['', '模块名或内容为空'],
  ])
})

test('detects stale Vipshop PDC Vue state after hash navigation', async () => {
  const helpers = await loadExports()
  assert.equal(helpers.pdcEditStateMismatchReason(
    { vendorProductId: '1038438858843860992' },
    { vendorProductId: '5358235333758246912' },
  ), '编辑页商品ID未切换完成：当前 1038438858843860992，目标 5358235333758246912')
  assert.equal(helpers.pdcEditStateMismatchReason(
    { vendorProductId: '5358235333758246912' },
    { vendorProductId: '5358235333758246912' },
  ), '')
})

test('matches Vipshop main/list image pairs named by full goods code and size suffix', async () => {
  const helpers = await loadExports()
  const plan = helpers.classifyVipshopAssets({
    styleCode: '208326100079',
    goodsCode: '20832610007900300',
  }, [
    image('/测试/20832610007900300-1-950.jpg', 950, 1200),
    image('/测试/20832610007900300-1-1200.jpg', 1200, 1200),
    image('/测试/20832610007900300-2-950.jpg', 950, 1200),
    image('/测试/20832610007900300-2-1200.jpg', 1200, 1200),
    image('/测试/20832610007900301-1-1200.jpg', 1200, 1200),
  ])

  assert.equal(plan.groups.mainSquare.length, 2)
  assert.equal(plan.groups.listImage.length, 2)
  assert.ok(plan.groups.mainSquare.every(item => item.sourceMatch === '货号'))
  assert.ok(plan.groups.listImage.every(item => item.sourceMatch === '货号'))
})

test('downloads all color-specific Vipshop marked main/list images under one style', async () => {
  const helpers = await loadExports()
  const plan = helpers.classifyVipshopAssets({
    styleCode: '209426108201',
    goodsCode: '20942610820140627',
    operationScope: ['main_image'],
  }, [
    image('/主图打标（京东唯品）/2026/426/回图/唯品/20942610820100102-1200.jpg', 1200, 1200),
    image('/主图打标（京东唯品）/2026/426/回图/唯品/20942610820100102-950.jpg', 950, 1200),
    image('/主图打标（京东唯品）/2026/426/回图/唯品/20942610820140627-1200.jpg', 1200, 1200),
    image('/主图打标（京东唯品）/2026/426/回图/唯品/20942610820140627-950.jpg', 950, 1200),
    image('/主图打标（京东唯品）/2026/426/回图/唯品/20942610820190001-1200.jpg', 1200, 1200),
    image('/主图打标（京东唯品）/2026/426/回图/唯品/20942610820190001-950.jpg', 950, 1200),
  ])
  const entries = helpers.selectedVipshopAssetEntries({
    styleCode: '209426108201',
    goodsCode: '20942610820140627',
    operationScope: ['main_image'],
  }, plan)

  assert.deepEqual(plain(plan.groups.mainSquareAllColors.map(item => item.targetGoodsCode).sort()), [
    '20942610820100102',
    '20942610820140627',
    '20942610820190001',
  ])
  assert.deepEqual(plain(plan.groups.listImageAllColors.map(item => item.targetGoodsCode).sort()), [
    '20942610820100102',
    '20942610820140627',
    '20942610820190001',
  ])
  assert.deepEqual(plain(entries.map(item => `${item.targetGoodsCode}:${item.usageKey}:${item.imageIndex}`).sort()), [
    '20942610820100102:list_image:50',
    '20942610820100102:main_square:1',
    '20942610820140627:list_image:50',
    '20942610820140627:main_square:1',
    '20942610820190001:list_image:50',
    '20942610820190001:main_square:1',
  ])
  assert.equal(helpers.extractStyleGoodsCodeFromItem(image('/唯品/20942610820140627-1200.jpg', 1200, 1200), '209426108201'), '20942610820140627')
})

test('keeps downloaded detail slices classified by original Semir filename', async () => {
  const helpers = await loadExports()
  const plan = helpers.classifyVipshopAssets({
    styleCode: '201326108015',
    goodsCode: '20132610801500311',
  }, [
    {
      localPath: '/tmp/201326108015_20132610801500311__detail_slice__5__201326108015_01.jpg',
      filename: '201326108015_20132610801500311__detail_slice__5__201326108015_01.jpg',
      originalFilename: '201326108015_01.jpg',
      fullpath: '201326108015_01.jpg',
      ext: 'jpg',
    },
    {
      localPath: '/tmp/201326108015_20132610801500311__detail_slice__6__201326108015_02.jpg',
      filename: '201326108015_20132610801500311__detail_slice__6__201326108015_02.jpg',
      originalFilename: '201326108015_02.jpg',
      fullpath: '201326108015_02.jpg',
      ext: 'jpg',
    },
  ])

  assert.equal(plan.groups.detailSlices.length, 2)
  assert.deepEqual(plain(plan.groups.detailSlices.map(item => item.sequence)), [1, 2])
})

test('skips goods-code hits under a different style folder and prefers own flat-shot root', async () => {
  const helpers = await loadExports()
  const plan = helpers.classifyVipshopAssets({
    styleCode: '201326108015',
    goodsCode: '20132610801500311',
  }, [
    image('/巴拉货控/模拍原图/全域/5P/幼童/201326105002-齐6.25/m(1)201326108015-00311.jpg', 5000, 5000),
    image('/巴拉货控/平拍原图/全域/3p/幼童/201326108015 2-已写/201326108015-00311.jpg', 5000, 5000),
    image('/巴拉货控/平拍原图/全域/3p/幼童/201326108015 2-已写/201326108015-00311-1.jpg', 5000, 5000),
  ])

  assert.equal(plan.groups.mainSquare[0].file, '/巴拉货控/平拍原图/全域/3p/幼童/201326108015 2-已写/201326108015-00311.jpg')
  assert.ok(plan.groups.unmatched.some(item => item.reason === '命中货号但位于其它款号文件夹，已跳过'))
  assert.equal(
    helpers.hasOtherStyleFolder({ fullpath: '/巴拉货控/模拍原图/201326105002/m(1)201326108015-00311.jpg', ext: 'jpg' }, '201326108015'),
    true,
  )
})

test('does not use style-level package artwork as color-specific main/list images', async () => {
  const helpers = await loadExports()
  const plan = helpers.classifyVipshopAssets({
    styleCode: '201326108015',
    goodsCode: '20132610801500311',
  }, [
    image('/326包装图/幼童/7.27/201326108015/201326108015.jpg', 750, 8389),
    image('/326包装图/幼童/7.27/201326108015/1200_12001.jpg', 1200, 1200),
    image('/326包装图/幼童/7.27/201326108015/1200_12002.jpg', 1200, 1200),
    image('/326包装图/幼童/7.27/201326108015/950_1200(唯品).jpg', 950, 1200),
  ])
  const entries = helpers.selectedVipshopAssetEntries({
    styleCode: '201326108015',
    goodsCode: '20132610801500311',
    operationScope: ['package', 'main_image'],
  }, plan)

  assert.equal(entries.some(item => item.usageKey === 'main_square'), false)
  assert.equal(entries.some(item => item.usageKey === 'list_image'), false)
  assert.deepEqual(plain(entries.filter(item => item.usageKey === 'package_micro_square').map(item => item.imageIndex)), [])
})

test('uses style-folder micro detail images as Vipshop display positions 3 to 5', async () => {
  const helpers = await loadExports()
  const plan = helpers.classifyVipshopAssets({
    styleCode: '201326108015',
    goodsCode: '20132610801500311',
  }, [
    image('/01-产品包装/2026Q3/婴幼/o2o/201326108015/微详情/1200_12001.jpg', 1200, 1200),
    image('/01-产品包装/2026Q3/婴幼/o2o/201326108015/微详情/1200_12002.jpg', 1200, 1200),
    image('/01-产品包装/2026Q3/婴幼/o2o/201326108015/微详情/1200_12003.jpg', 1200, 1200),
    image('/01-产品包装/2026Q3/婴幼/o2o/201326108015/源文件/1200_12004.jpg', 1200, 1200),
  ])
  const entries = helpers.selectedVipshopAssetEntries({
    styleCode: '201326108015',
    goodsCode: '20132610801500311',
    operationScope: ['package'],
  }, plan)

  assert.equal(plan.groups.packageMicroSquare.length, 3)
  assert.deepEqual(plain(entries.filter(item => item.usageKey === 'package_micro_square').map(item => item.imageIndex)), [3, 4, 15])
})

test('skips too-short Vipshop detail tail slices before upload', async () => {
  const helpers = await loadExports()
  const plan = helpers.classifyVipshopAssets({
    styleCode: '204326141002',
    goodsCode: '20432614100200377',
  }, [
    image('/01-产品包装/2026Q3/鞋品/204326141002/images/204326141002_01.jpg', 750, 982),
    image('/01-产品包装/2026Q3/鞋品/204326141002/images/204326141002_10.jpg', 750, 102),
  ])
  const entries = helpers.selectedVipshopAssetEntries({
    styleCode: '204326141002',
    goodsCode: '20432614100200377',
    operationScope: ['package'],
  }, plan)

  assert.deepEqual(plain(plan.groups.detailSlices.map(item => item.filename)), ['204326141002_01.jpg'])
  assert.ok(plan.groups.unmatched.some(item => item.filename === '204326141002_10.jpg' && item.reason === '商详切片高度过小，疑似无产品尾图，已跳过'))
  assert.deepEqual(plain(entries.filter(item => item.usageKey === 'detail_slice').map(item => item.imageIndex)), [601])
  assert.match(
    helpers.validateInjectedVipshopAsset({ usageKey: 'detail_slice', filename: '204326141002_10.jpg' }, { width: 750, height: 102 }),
    /商详切片高度过小/,
  )
})

test('applies package micro display images to every Vipshop color at display positions 3 to 5', async () => {
  const helpers = await loadExports()
  const colors = [
    {
      colourGSN: '20942610820190001',
      squareImages: [
        { imageIndex: 1, imageUrl: 'old-main-black' },
        { imageIndex: 3, imageUrl: 'old-black-3' },
        { imageIndex: 4, imageUrl: 'old-black-4' },
        { imageIndex: 15, imageUrl: 'old-black-15' },
        { imageIndex: 16, imageUrl: 'old-black-16' },
      ],
    },
    {
      colourGSN: '20942610820140627',
      squareImages: [
        { imageIndex: 1, imageUrl: 'old-main-green' },
        { imageIndex: 3, imageUrl: 'old-green-3' },
        { imageIndex: 4, imageUrl: 'old-green-4' },
        { imageIndex: 15, imageUrl: 'old-green-15' },
      ],
    },
  ]
  const records = [
    { imageUrl: 'micro-1', asset: { filename: '1200_12001.jpg', width: 1200, height: 1200 } },
    { imageUrl: 'micro-2', asset: { filename: '1200_12002.jpg', width: 1200, height: 1200 } },
    { imageUrl: 'micro-3', asset: { filename: '1200_12003.jpg', width: 1200, height: 1200 } },
  ]

  assert.equal(helpers.applyPackageMicroSquareRecordsToColors(colors, records), 2)
  assert.deepEqual(plain(colors.map(color => color.squareImages.map(item => [item.imageIndex, item.imageUrl]))), [
    [[1, 'old-main-black'], [3, 'micro-1'], [4, 'micro-2'], [15, 'micro-3'], [16, 'old-black-3'], [17, 'old-black-4'], [18, 'old-black-15'], [19, 'old-black-16']],
    [[1, 'old-main-green'], [3, 'micro-1'], [4, 'micro-2'], [15, 'micro-3'], [16, 'old-green-3'], [17, 'old-green-4'], [18, 'old-green-15']],
  ])
})

test('limits package micro display images to matching 12-digit style inside merged link', async () => {
  const helpers = await loadExports()
  const colors = [
    { colourGSN: '20892616621200388', squareImages: [{ imageIndex: 1, imageUrl: 'old-212-a' }, { imageIndex: 3, imageUrl: 'old-212-a-3' }] },
    { colourGSN: '20892616621200454', squareImages: [{ imageIndex: 1, imageUrl: 'old-212-b' }, { imageIndex: 3, imageUrl: 'old-212-b-3' }] },
    { colourGSN: '20892616621300355', squareImages: [{ imageIndex: 1, imageUrl: 'old-213-a' }, { imageIndex: 3, imageUrl: 'old-213-a-3' }] },
  ]
  const records = [
    { imageUrl: 'micro-1', asset: { filename: '1200_12001.jpg', width: 1200, height: 1200 } },
    { imageUrl: 'micro-2', asset: { filename: '1200_12002.jpg', width: 1200, height: 1200 } },
    { imageUrl: 'micro-3', asset: { filename: '1200_12003.jpg', width: 1200, height: 1200 } },
  ]
  const targetColors = helpers.findStateColorsByStyleCode({ editData: { itemSkuAttr: colors } }, '208926166212')

  assert.deepEqual(plain(helpers.goodsCodesFromColors(targetColors)), ['20892616621200388', '20892616621200454'])
  assert.equal(helpers.applyPackageMicroSquareRecordsToColors(targetColors, records), 2)
  assert.deepEqual(plain(colors.map(color => color.squareImages.map(item => [item.imageIndex, item.imageUrl]))), [
    [[1, 'old-212-a'], [3, 'micro-1'], [4, 'micro-2'], [15, 'micro-3'], [16, 'old-212-a-3']],
    [[1, 'old-212-b'], [3, 'micro-1'], [4, 'micro-2'], [15, 'micro-3'], [16, 'old-212-b-3']],
    [[1, 'old-213-a'], [3, 'old-213-a-3']],
  ])
})

test('applies marked main and list images by target goods code', async () => {
  const helpers = await loadExports()
  const colors = [
    {
      colourGSN: '20942610820190001',
      squareImages: [
        { imageIndex: 1, imageUrl: 'old-black-main' },
        { imageIndex: 3, imageUrl: 'old-black-detail-a' },
        { imageIndex: 4, imageUrl: 'old-black-detail-b' },
      ],
      listImages: [],
    },
    {
      colourGSN: '20942610820140627',
      squareImages: [
        { imageIndex: 1, imageUrl: 'old-green-main' },
        { imageIndex: 3, imageUrl: 'old-green-detail-a' },
      ],
      listImages: [],
    },
  ]
  const mainRecords = [
    { imageUrl: 'black-main', asset: { targetGoodsCode: '20942610820190001', filename: '20942610820190001-1200.jpg', width: 1200, height: 1200 } },
    { imageUrl: 'green-main', asset: { targetGoodsCode: '20942610820140627', filename: '20942610820140627-1200.jpg', width: 1200, height: 1200 } },
  ]
  const listRecords = [
    { imageUrl: 'black-list', asset: { targetGoodsCode: '20942610820190001', filename: '20942610820190001-950.jpg', width: 950, height: 1200 } },
    { imageUrl: 'green-list', asset: { targetGoodsCode: '20942610820140627', filename: '20942610820140627-950.jpg', width: 950, height: 1200 } },
  ]

  assert.equal(helpers.applyMainSquareRecordsToColors(colors, mainRecords), 2)
  assert.equal(helpers.applyListImageRecordsToColors(colors, listRecords), 2)
  assert.deepEqual(plain(colors.map(color => color.squareImages.map(item => [item.imageIndex, item.imageUrl]))), [
    [[1, 'black-main'], [2, 'old-black-main'], [3, 'old-black-detail-a'], [4, 'old-black-detail-b']],
    [[1, 'green-main'], [2, 'old-green-main'], [3, 'old-green-detail-a']],
  ])
  assert.deepEqual(plain(colors.map(color => color.listImages.map(item => [item.imageIndex, item.imageUrl]))), [
    [[50, 'black-list']],
    [[50, 'green-list']],
  ])
})

test('merged cloud sources do not promote package-source flat shots into main/list images', async () => {
  const infoCalls = []
  const fetchImpl = async (url, options = {}) => {
    const parsedUrl = new URL(String(url), 'https://fmp.semirapp.com')
    if (parsedUrl.pathname === '/fengcloud/2/file/search') {
      const body = new URLSearchParams(String(options.body || ''))
      const mountId = body.get('mount_id')
      const keyword = body.get('keyword')
      const packageItems = ['201326108015', '20132610801500311'].includes(keyword) ? [
        image('品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2026Q3/婴幼/o2o/201326108015/微详情/1200_12001.jpg', 1200, 1200),
        image('品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2026Q3/婴幼/o2o/201326108015/微详情/1200_12002.jpg', 1200, 1200),
        image('品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2026Q3/婴幼/o2o/201326108015/微详情/1200_12003.jpg', 1200, 1200),
        image('品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2026Q3/婴幼/o2o/201326108015/images/201326108015_01.jpg', 750, 1200),
        image('巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/平拍原图/全域/3p/幼童/201326108015 2-已写/201326108015-00311.jpg', 5000, 5000),
        image('巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/平拍原图/全域/3p/幼童/201326108015 2-已写/201326108015-00311-1.jpg', 5000, 5000),
      ] : []
      const items = mountId === 'pkg' ? packageItems : []
      return jsonResponse({ total: items.length, list: items })
    }
    if (/\/fengcloud\/\d\/file\/(?:ls|list)$/.test(parsedUrl.pathname)) {
      return jsonResponse({ total: 0, list: [] })
    }
    if (parsedUrl.pathname === '/fengcloud/2/file/info') {
      infoCalls.push({
        mountId: parsedUrl.searchParams.get('mount_id'),
        fullpath: parsedUrl.searchParams.get('fullpath'),
      })
      return jsonResponse({ uri: `https://download.example/${encodeURIComponent(parsedUrl.searchParams.get('fullpath') || '')}` })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const helpers = await loadExports({}, fetchImpl)
  const job = {
    styleCode: '201326108015',
    goodsCode: '20132610801500311',
    operationScope: ['package', 'main_image'],
    folderScanDepth: 5,
  }
  const result = await helpers.buildVipshopDownloadPlan(job, {
    packageSource: {
      mountId: 'pkg',
      mountName: '包装源',
      relativePath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新',
      rawPath: '包装源//巴拉货控/02 产品上新模块/2-2 巴拉产品上新',
      candidateSources: [],
      restrictSearchToRelativePath: false,
      searchOnly: true,
      purpose: 'package',
    },
    mainImageSource: {
      mountId: 'main',
      mountName: '主图源',
      relativePath: '品牌视觉部',
      rawPath: '主图源//品牌视觉部',
      candidateSources: [],
      restrictSearchToRelativePath: true,
      searchOnly: true,
      purpose: 'main_image',
      pathFeatures: helpers.normalizeMainImagePathFeatures(),
    },
  })

  assert.equal(result.plan.plan.groups.mainSquare.length, 0)
  assert.equal(result.plan.plan.groups.listImage.length, 0)
  assert.equal(result.plan.plan.groups.packageMicroSquare.length, 3)
  assert.equal(result.plan.plan.groups.detailSlices.length, 1)
  assert.deepEqual(plain(result.downloadItems.map(item => item.filename).sort()), [
    '201326108015_20132610801500311__detail_slice__4__201326108015_01.jpg',
    '201326108015_20132610801500311__package_micro_square__1__1200_12001.jpg',
    '201326108015_20132610801500311__package_micro_square__2__1200_12002.jpg',
    '201326108015_20132610801500311__package_micro_square__3__1200_12003.jpg',
  ])
  assert.equal(infoCalls.every(call => call.mountId === 'pkg'), true)
  assert.equal(infoCalls.some(call => String(call.fullpath).includes('平拍原图')), false)
})

test('does not treat generic package files in a goods folder as main/list images', async () => {
  const helpers = await loadExports()
  const plan = helpers.classifyVipshopAssets({
    styleCode: '201326108015',
    goodsCode: '20132610801500311',
  }, [
    image('/326包装图/幼童/7.27/20132610801500311/1200_1200(唯品).jpg', 1200, 1200),
    image('/326包装图/幼童/7.27/20132610801500311/950_1200(唯品).jpg', 950, 1200),
    image('/326包装图/幼童/7.27/20132610801500311/images/201326108015_01.jpg', 750, 1200),
  ])

  assert.equal(plan.groups.mainSquare.length, 0)
  assert.equal(plan.groups.listImage.length, 0)
  assert.equal(plan.groups.packageMicroSquare.length, 0)
  assert.equal(plan.groups.detailSlices.length, 1)
})

test('classifies downloaded package assets by source path without artifact-dir code leakage', async () => {
  const helpers = await loadExports()
  const artifactDir = 'artifacts/vipshop-package-only-201326108015-200326108106-live'
  const downloaded = [
    {
      fullpath: '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2026Q3/婴幼/o2o/201326108015/微详情/1200_12001.jpg',
      localPath: `${artifactDir}/201326108015_20132610801500311__package_micro_square__1__1200_12001.jpg`,
      path: `${artifactDir}/201326108015_20132610801500311__package_micro_square__1__1200_12001.jpg`,
      filename: '201326108015_20132610801500311__package_micro_square__1__1200_12001.jpg',
      originalFilename: '1200_12001.jpg',
      width: 1200,
      height: 1200,
    },
    {
      fullpath: '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2026Q3/婴幼/o2o/201326108015/images/201326108015_01.jpg',
      localPath: `${artifactDir}/201326108015_20132610801500311__detail_slice__4__201326108015_01.jpg`,
      path: `${artifactDir}/201326108015_20132610801500311__detail_slice__4__201326108015_01.jpg`,
      filename: '201326108015_20132610801500311__detail_slice__4__201326108015_01.jpg',
      originalFilename: '201326108015_01.jpg',
      width: 750,
      height: 830,
    },
    {
      fullpath: '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2026Q3/婴幼/o2o/200326108106/微详情/1200_12001.jpg',
      localPath: `${artifactDir}/200326108106_20032610810600488__package_micro_square__1__1200_12001.jpg`,
      path: `${artifactDir}/200326108106_20032610810600488__package_micro_square__1__1200_12001.jpg`,
      filename: '200326108106_20032610810600488__package_micro_square__1__1200_12001.jpg',
      originalFilename: '1200_12001.jpg',
      width: 1200,
      height: 1200,
    },
  ]

  const plan = helpers.classifyVipshopAssets({
    styleCode: '201326108015',
    goodsCode: '20132610801500311',
  }, downloaded)
  const entries = helpers.selectedVipshopAssetEntries({
    styleCode: '201326108015',
    goodsCode: '20132610801500311',
    operationScope: ['package'],
  }, plan)

  assert.deepEqual(plain(plan.groups.packageMicroSquare.map(item => item.filename)), [
    '201326108015_20132610801500311__package_micro_square__1__1200_12001.jpg',
  ])
  assert.deepEqual(plain(plan.groups.detailSlices.map(item => item.filename)), [
    '201326108015_20132610801500311__detail_slice__4__201326108015_01.jpg',
  ])
  assert.deepEqual(plain(entries.map(item => item.path).sort()), [
    `${artifactDir}/201326108015_20132610801500311__detail_slice__4__201326108015_01.jpg`,
    `${artifactDir}/201326108015_20132610801500311__package_micro_square__1__1200_12001.jpg`,
  ])
  assert.equal(plan.groups.unmatched.some(item => item.filename.startsWith('200326108106_')), false)
})

test('coalesces detail-slice uploads for goods under the same product and style', async () => {
  const helpers = await loadExports()
  const contexts = [
    {
      vendorProductId: '2190515940616200193',
      merged: false,
      job: { styleCode: '200326108106', goodsCode: '20032610810620410' },
      assets: [
        { usageKey: 'main_square', scope: 'main_image' },
        { usageKey: 'list_image', scope: 'main_image' },
        { usageKey: 'package_micro_square', scope: 'package' },
        { usageKey: 'detail_slice', scope: 'package' },
      ],
    },
    {
      vendorProductId: '2190515940616200193',
      merged: false,
      job: { styleCode: '200326108106', goodsCode: '20032610810600488' },
      assets: [
        { usageKey: 'main_square', scope: 'main_image' },
        { usageKey: 'list_image', scope: 'main_image' },
        { usageKey: 'package_micro_square', scope: 'package' },
        { usageKey: 'detail_slice', scope: 'package' },
      ],
    },
  ]

  const coalesced = helpers.coalesceLiveDetailContexts(contexts)

  assert.equal(coalesced[0].detailShareRole, 'primary')
  assert.deepEqual(plain(coalesced[0].detailSharedGoodsCodes), ['20032610810620410', '20032610810600488'])
  assert.deepEqual(plain(coalesced[0].assets.map(asset => asset.usageKey)), [
    'main_square',
    'list_image',
    'package_micro_square',
    'detail_slice',
  ])
  assert.equal(coalesced[1].detailShareRole, 'shared_skip')
  assert.equal(coalesced[1].detailSharedFromGoodsCode, '20032610810620410')
  assert.deepEqual(plain(coalesced[1].assets.map(asset => asset.usageKey)), [
    'main_square',
    'list_image',
  ])
  assert.equal(coalesced[0].forceColorSpecificDetail, false)
  assert.equal(coalesced[1].forceColorSpecificDetail, false)
})

test('coalesces all-color marked main/list uploads for goods under the same product and style', async () => {
  const helpers = await loadExports()
  const contexts = [
    {
      vendorProductId: '5649561937431629827',
      merged: false,
      job: { styleCode: '209426108201', goodsCode: '20942610820190001' },
      assets: [
        { usageKey: 'main_square', scope: 'main_image', targetGoodsCode: '20942610820190001' },
        { usageKey: 'list_image', scope: 'main_image', targetGoodsCode: '20942610820190001' },
        { usageKey: 'main_square', scope: 'main_image', targetGoodsCode: '20942610820140627' },
        { usageKey: 'list_image', scope: 'main_image', targetGoodsCode: '20942610820140627' },
      ],
    },
    {
      vendorProductId: '5649561937431629827',
      merged: false,
      job: { styleCode: '209426108201', goodsCode: '20942610820140627' },
      assets: [
        { usageKey: 'main_square', scope: 'main_image', targetGoodsCode: '20942610820190001' },
        { usageKey: 'list_image', scope: 'main_image', targetGoodsCode: '20942610820190001' },
        { usageKey: 'main_square', scope: 'main_image', targetGoodsCode: '20942610820140627' },
        { usageKey: 'list_image', scope: 'main_image', targetGoodsCode: '20942610820140627' },
      ],
    },
  ]

  const coalesced = helpers.coalesceLiveDetailContexts(contexts)

  assert.equal(coalesced[0].assets.length, 4)
  assert.equal(coalesced[1].assets.length, 0)
  assert.equal(coalesced[1].styleSharedFromGoodsCode, '20942610820190001')
})

test('keeps separate detail-slice uploads for different styles inside one product', async () => {
  const helpers = await loadExports()
  const contexts = [
    {
      vendorProductId: 'merged-product',
      merged: false,
      job: { styleCode: '200326108106', goodsCode: '20032610810600488' },
      assets: [{ usageKey: 'detail_slice', scope: 'package' }],
    },
    {
      vendorProductId: 'merged-product',
      merged: false,
      job: { styleCode: '201326108015', goodsCode: '20132610801500311' },
      assets: [{ usageKey: 'detail_slice', scope: 'package' }],
    },
  ]

  const coalesced = helpers.coalesceLiveDetailContexts(contexts)

  assert.equal(coalesced[0].detailShareRole, 'single')
  assert.equal(coalesced[1].detailShareRole, 'single')
  assert.equal(coalesced[0].assets.length, 1)
  assert.equal(coalesced[1].assets.length, 1)
  assert.equal(coalesced[0].merged, true)
  assert.equal(coalesced[1].merged, true)
  assert.equal(coalesced[0].forceColorSpecificDetail, true)
  assert.equal(coalesced[1].forceColorSpecificDetail, true)
})

test('marks mixed product color prefixes as merged even when backend sn matches requested style', async () => {
  const helpers = await loadExports()
  const mixedProduct = product({
    sn: '208926166212',
    itemSkuAttr: [
      { colourGSN: '20892616621200388', colourName: '米白' },
      { colourGSN: '20892616621200454', colourName: '蓝色' },
      { colourGSN: '20892616621300355', colourName: '粉色' },
    ],
  })
  const coalesced = helpers.coalesceLiveDetailContexts([{
    vendorProductId: 'mixed-product',
    merged: false,
    product: mixedProduct,
    job: { styleCode: '208926166212', goodsCode: '20892616621200388' },
    assets: [{ usageKey: 'detail_slice', scope: 'package' }],
  }])

  assert.deepEqual(plain(helpers.productStylePrefixes(mixedProduct)), ['208926166212', '208926166213'])
  assert.equal(helpers.hasMixedStylePrefixes(mixedProduct), true)
  assert.equal(helpers.isMergedStyle({ styleCode: '208926166212' }, mixedProduct), true)
  assert.equal(coalesced[0].merged, true)
  assert.equal(coalesced[0].forceColorSpecificDetail, true)
  assert.equal(coalesced[0].detailShareRole, 'single')
})

test('validates injected Vipshop image dimensions before live upload', async () => {
  const helpers = await loadExports()

  assert.equal(helpers.validateInjectedVipshopAsset({ usageKey: 'main_square' }, { width: 1200, height: 1200 }), '')
  assert.match(
    helpers.validateInjectedVipshopAsset({ usageKey: 'main_square', filename: 'bad.jpg' }, { width: 950, height: 1200 }),
    /主图要求1200x1200/,
  )
  assert.equal(helpers.validateInjectedVipshopAsset({ usageKey: 'list_image' }, { width: 950, height: 1200 }), '')
  assert.match(
    helpers.validateInjectedVipshopAsset({ usageKey: 'list_image' }, { width: 1200, height: 1200 }),
    /商品列表图要求950x1200/,
  )
})

test('builds Vipshop image upload fields like the official PDC upload component', async () => {
  const helpers = await loadExports()

  assert.deepEqual(plain(helpers.buildVipshopImageUploadFields(601, 1)), {
    type: '601',
    vendorType: '1',
  })
})

test('Vipshop OCR anchors detect wanted-info tail and balaOne head image', async () => {
  const helpers = await loadExports()
  const anchors = helpers.buildVipshopDetailAnchorsFromOcrResults([
    { globalIndex: 0, imageUrl: 'https://img.example/balaone.jpg', filename: 'head.jpg' },
    { globalIndex: 1, imageUrl: 'https://img.example/old-01.jpg' },
    { globalIndex: 2, imageUrl: 'https://img.example/wanted.jpg' },
  ], [
    { globalIndex: 0, text: 'BALA ONE 线上专属', confidence: 88 },
    { globalIndex: 2, text: '想要的信息看这里 商品信息', confidence: 91 },
  ])

  assert.equal(anchors.ocrStatus, 'recognized')
  assert.equal(anchors.stopImageIndex, 2)
  assert.equal(anchors.stopAnchorKind, 'wanted_info')
  assert.equal(anchors.balaOneImageIndex, 0)
  assert.equal(anchors.fixedTopAnchorKind, 'balaone_head')
})

test('anchored Vipshop detail replacement preserves wanted-info image and later tail only', async () => {
  const helpers = await loadExports()
  const result = helpers.buildAnchoredVipshopDetailImages([
    { imageUrl: 'https://img.example/old-01.jpg', imageIndex: 601 },
    { imageUrl: 'https://img.example/old-02.jpg', imageIndex: 602 },
    { imageUrl: 'https://img.example/wanted-info.jpg', imageIndex: 603 },
    { imageUrl: 'https://img.example/wash.jpg', imageIndex: 604 },
  ], [
    { imageUrl: 'https://img.example/new-01.jpg', filename: '201326108015_01.jpg' },
    { imageUrl: 'https://img.example/new-02.jpg', filename: '201326108015_02.jpg' },
  ], {
    ocrStatus: 'recognized',
    stopImageIndex: 2,
    stopAnchorKind: 'wanted_info',
    matchedText: '想要的信息看这里',
  })

  assert.equal(result.ok, true)
  assert.deepEqual(plain(result.images.map(item => item.imageUrl)), [
    'https://img.example/new-01.jpg',
    'https://img.example/new-02.jpg',
    'https://img.example/wanted-info.jpg',
    'https://img.example/wash.jpg',
  ])
  assert.deepEqual(plain(result.images.map(item => item.imageIndex)), [601, 602, 603, 604])
  assert.match(result.note, /保留锚点及之后2张/)
})

test('anchored Vipshop detail replacement removes old images before wanted-info even when uploaded slice count is shorter', async () => {
  const helpers = await loadExports()
  const existing = [
    ...Array.from({ length: 13 }, (_, index) => ({
      imageUrl: `https://img.example/old-before-wanted-${index + 1}.jpg`,
      imageIndex: 601 + index,
    })),
    { imageUrl: 'https://img.example/wanted-info.jpg', imageIndex: 614 },
    { imageUrl: 'https://img.example/size-chart.jpg', imageIndex: 615 },
  ]
  const uploaded = Array.from({ length: 8 }, (_, index) => ({
    imageUrl: `https://img.example/new-detail-${index + 1}.jpg`,
    filename: `208926166212_0${index + 1}.jpg`,
  }))
  const result = helpers.buildAnchoredVipshopDetailImages(existing, uploaded, {
    ocrStatus: 'recognized',
    stopImageIndex: 13,
    stopAnchorKind: 'wanted_info',
    matchedText: '想要的信息看这里！',
  })

  assert.equal(result.ok, true)
  assert.deepEqual(plain(result.images.map(item => item.imageUrl)), [
    ...uploaded.map(item => item.imageUrl),
    'https://img.example/wanted-info.jpg',
    'https://img.example/size-chart.jpg',
  ])
  assert.equal(result.images.some(item => /old-before-wanted/.test(item.imageUrl)), false)
  assert.deepEqual(plain(result.images.map(item => item.imageIndex)), [601, 602, 603, 604, 605, 606, 607, 608, 609, 610])
})

test('Vipshop detail OCR requires wanted-info anchor by default', async () => {
  const helpers = await loadExports()
  const anchors = helpers.buildVipshopDetailAnchorsFromOcrResults([
    { globalIndex: 0, imageUrl: 'https://img.example/old-01.jpg' },
    { globalIndex: 1, imageUrl: 'https://img.example/lower.jpg' },
  ], [
    { globalIndex: 1, text: '去自由探索世界吧 模特展示', confidence: 86 },
  ])

  assert.equal(anchors.ocrStatus, 'no_stop_anchor')
  assert.equal(anchors.stopImageIndex, undefined)
  assert.equal(anchors.stopAnchorKind, undefined)
})

test('anchored Vipshop detail replacement places uploaded balaOne image first', async () => {
  const helpers = await loadExports()
  const result = helpers.buildAnchoredVipshopDetailImages([
    { imageUrl: 'https://img.example/old-01.jpg', imageIndex: 601 },
    { imageUrl: 'https://img.example/wanted-info.jpg', imageIndex: 602 },
  ], [
    { imageUrl: 'https://img.example/new-01.jpg', filename: '201326108015_01.jpg' },
    { imageUrl: 'https://img.example/new-balaone.jpg', filename: 'balaone头图.jpg' },
  ], {
    ocrStatus: 'recognized',
    stopImageIndex: 1,
    stopAnchorKind: 'wanted_info',
  })

  assert.equal(result.ok, true)
  assert.deepEqual(plain(result.images.map(item => item.imageUrl)), [
    'https://img.example/new-balaone.jpg',
    'https://img.example/new-01.jpg',
    'https://img.example/wanted-info.jpg',
  ])
  assert.equal(result.uploadedHasBalaOne, true)
})

test('anchored Vipshop detail replacement preserves existing balaOne head when package has none', async () => {
  const helpers = await loadExports()
  const result = helpers.buildAnchoredVipshopDetailImages([
    { imageUrl: 'https://img.example/old-balaone.jpg', imageIndex: 601, filename: 'old-balaone.jpg' },
    { imageUrl: 'https://img.example/old-01.jpg', imageIndex: 602 },
    { imageUrl: 'https://img.example/wanted-info.jpg', imageIndex: 603 },
  ], [
    { imageUrl: 'https://img.example/new-01.jpg', filename: '201326108015_01.jpg' },
  ], {
    ocrStatus: 'recognized',
    stopImageIndex: 2,
    stopAnchorKind: 'wanted_info',
    balaOneImageIndex: 0,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(plain(result.images.map(item => item.imageUrl)), [
    'https://img.example/old-balaone.jpg',
    'https://img.example/new-01.jpg',
    'https://img.example/wanted-info.jpg',
  ])
  assert.equal(result.preserveExistingBalaOne, true)
})

test('anchored Vipshop detail replacement blocks when OCR stop anchor is missing', async () => {
  const helpers = await loadExports()
  const result = helpers.buildAnchoredVipshopDetailImages([
    { imageUrl: 'https://img.example/old-01.jpg', imageIndex: 601 },
  ], [
    { imageUrl: 'https://img.example/new-01.jpg', filename: '201326108015_01.jpg' },
  ], {
    ocrStatus: 'no_stop_anchor',
  })

  assert.equal(result.ok, false)
  assert.match(result.note, /已阻断详情图替换/)
})

test('Vipshop tesseract runtime config uses its own bundled OCR assets by default', async () => {
  const helpers = await loadExports()
  const config = helpers.tesseractRuntimeConfig({})

  assert.equal(config.scriptUrl, 'http://127.0.0.1:18765/adapter-assets/vipshop-ops-assistant/vendor/tesseract/tesseract.min.js')
  assert.equal(config.workerPath, 'http://127.0.0.1:18765/adapter-assets/vipshop-ops-assistant/vendor/tesseract/worker.min.js')
  assert.equal(config.corePath, 'http://127.0.0.1:18765/adapter-assets/vipshop-ops-assistant/vendor/tesseract/tesseract-core-lstm.wasm.js')
  assert.equal(config.langPath, 'http://127.0.0.1:18765/adapter-assets/vipshop-ops-assistant/vendor/tesseract/lang')
  assert.equal(config.lang, 'chi_sim')
})

test('Vipshop OCR runtime dependency probe covers worker, wasm, and language assets', async () => {
  const helpers = await loadExports()
  const urls = helpers.tesseractRuntimeDependencyUrls(helpers.tesseractRuntimeConfig({}))

  assert.deepEqual(plain(urls.map(item => item.name)), ['script', 'worker', 'core-js', 'core-wasm', 'lang-chi_sim'])
  assert.equal(urls.find(item => item.name === 'core-wasm').url, 'http://127.0.0.1:18765/adapter-assets/vipshop-ops-assistant/vendor/tesseract/tesseract-core-lstm.wasm')
  assert.equal(urls.find(item => item.name === 'lang-chi_sim').url, 'http://127.0.0.1:18765/adapter-assets/vipshop-ops-assistant/vendor/tesseract/lang/chi_sim.traineddata.gz')
})

test('Vipshop OCR runtime probe summary reports the concrete failed dependency', async () => {
  const helpers = await loadExports()
  const note = helpers.summarizeTesseractRuntimeProbe([
    { name: 'script', ok: true, url: 'http://127.0.0.1:18765/adapter-assets/vipshop-ops-assistant/vendor/tesseract/tesseract.min.js' },
    {
      name: 'worker',
      ok: false,
      status: 403,
      url: 'http://127.0.0.1:18765/adapter-assets/vipshop-ops-assistant/vendor/tesseract/worker.min.js',
      error: 'Failed to fetch',
    },
  ])

  assert.match(note, /OCR依赖预检失败/)
  assert.match(note, /worker HTTP 403 Failed to fetch tesseract\/worker\.min\.js/)
})

test('Vipshop OCR runtime load failure includes dependency probe details', async () => {
  const helpers = await loadExports({}, async url => ({
    ok: false,
    status: String(url).includes('tesseract.min.js') ? 404 : 200,
    headers: { get: () => '' },
    body: { cancel: async () => {} },
    text: async () => '',
  }))

  await assert.rejects(
    () => helpers.runTesseractOcrForImages([{ src: 'https://img.example/detail.jpg', globalIndex: 0 }], {}),
    /OCR运行时加载失败.*script HTTP 404.*tesseract\/tesseract\.min\.js/,
  )
})

test('Vipshop OCR runtime prefetches worker script into a same-page blob by default', async () => {
  const params = {}
  const fetchedUrls = []
  const helpers = await loadExports(params, async url => {
    fetchedUrls.push(String(url))
    if (String(url).includes('tesseract.min.js')) {
      return {
        ok: true,
        status: 200,
        text: async () => `window.Tesseract = {
          createWorker: async (lang, count, options) => {
            window.__CRAWSHRIMP_PARAMS__.__createdWorkerOptions = options
            return { recognize: async () => ({ data: { text: 'OK', confidence: 99 } }), terminate: async () => {} }
          }
        }`,
      }
    }
    return {
      ok: true,
      status: 200,
      text: async () => `/* worker ${url} */`,
    }
  })

  const ocr = await helpers.runTesseractOcrForImages([{ src: 'https://img.example/detail.jpg', globalIndex: 0 }], {})

  assert.equal(ocr.ok, true)
  assert.ok(fetchedUrls.some(url => url === 'http://127.0.0.1:18765/adapter-assets/vipshop-ops-assistant/vendor/tesseract/worker.min.js'))
  assert.match(params.__createdWorkerOptions.workerPath, /^blob:/)
  assert.equal(params.__createdWorkerOptions.workerBlobURL, false)
})

test('Vipshop detail OCR defaults to page OCR before host fallback', async () => {
  const detailImages = [
    { imageUrl: 'https://img.example/detail-01.jpg', imageIndex: 601 },
    { imageUrl: 'https://img.example/detail-02.jpg', imageIndex: 602 },
  ]
  const editable = {
    info: { sn: '204326141002', itemSkuAttr: [{ colourGSN: '20432614100200377', detailImages }] },
    opts: { detailImages },
    saveAndApprove() {},
  }
  const fetchedUrls = []
  const result = await runScript({
    phase: 'detect_vipshop_detail_ocr_anchors',
    params: {},
    shared: {
      live_index: 0,
      live_contexts: [{
        vendorProductId: '3108687302839656448',
        vendorType: 1,
        job: { rowNo: 2, styleCode: '204326141002', goodsCode: '20432614100200377', operationScope: ['package'] },
        assets: [{ usageKey: 'detail_slice', scope: 'package', path: '/tmp/detail.jpg' }],
        product: { sn: '204326141002', itemSkuAttr: [{ colourGSN: '20432614100200377' }] },
      }],
    },
    fetchImpl: async url => {
      fetchedUrls.push(String(url))
      if (String(url).includes('tesseract.min.js')) {
        return {
          ok: true,
          status: 200,
          text: async () => `window.Tesseract = {
          createWorker: async () => ({
              recognize: async source => ({
                data: {
                  text: '想要的信息看这里',
                  confidence: 90
                }
              }),
              terminate: async () => {}
            })
          }`,
        }
      }
      return {
        ok: true,
        status: 200,
        blob: async () => new Blob(['image']),
        text: async () => `/* ${url} */`,
      }
    },
    documentOverrides: {
      body: { innerText: '', textContent: '' },
      querySelectorAll: selector => (String(selector) === '*' ? [{ __vue__: editable }] : []),
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'process_live_job')
  assert.equal(result.meta.shared.current_detail_ocr_result.engine, 'tesseract.js')
  assert.equal(result.meta.shared.current_detail_page_ocr_error, undefined)
  assert.equal(result.meta.shared.current_detail_host_ocr_requested, undefined)
  assert.ok(fetchedUrls.some(url => url.includes('/vendor/tesseract/tesseract.min.js')))
})

test('Vipshop detail OCR falls back to host only after page OCR runtime load failure', async () => {
  const detailImages = [
    { imageUrl: 'https://img.example/detail-01.jpg', imageIndex: 601 },
    { imageUrl: 'https://img.example/detail-02.jpg', imageIndex: 602 },
  ]
  const editable = {
    info: { sn: '204326141002', itemSkuAttr: [{ colourGSN: '20432614100200377', detailImages }] },
    opts: { detailImages },
    saveAndApprove() {},
  }
  const result = await runScript({
    phase: 'detect_vipshop_detail_ocr_anchors',
    params: {},
    shared: {
      live_index: 0,
      live_contexts: [{
        vendorProductId: '3108687302839656448',
        vendorType: 1,
        job: { rowNo: 2, styleCode: '204326141002', goodsCode: '20432614100200377', operationScope: ['package'] },
        assets: [{ usageKey: 'detail_slice', scope: 'package', path: '/tmp/detail.jpg' }],
        product: { sn: '204326141002', itemSkuAttr: [{ colourGSN: '20432614100200377' }] },
      }],
    },
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      headers: { get: () => '' },
      body: { cancel: async () => {} },
      text: async () => '',
    }),
    documentOverrides: {
      body: { innerText: '', textContent: '' },
      querySelectorAll: selector => (String(selector) === '*' ? [{ __vue__: editable }] : []),
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'recognize_ocr_images')
  assert.equal(result.meta.next_phase, 'detect_vipshop_detail_ocr_anchors_from_host')
  assert.match(result.meta.shared.current_detail_page_ocr_error, /OCR运行时加载失败/)
  assert.equal(result.meta.shared.current_detail_host_ocr_requested, true)
  assert.deepEqual(plain(result.meta.items.map(item => [item.url, item.imageIndex])), [
    ['https://img.example/detail-01.jpg', 601],
    ['https://img.example/detail-02.jpg', 602],
  ])
})

test('Vipshop OCR runtime failure can request host-side OCR fallback', async () => {
  const helpers = await loadExports()
  const result = helpers.recognizeOcrImages([
    { src: 'https://img.example/detail-01.jpg', globalIndex: 0, imageIndex: 601 },
    { src: 'https://img.example/detail-02.jpg', globalIndex: 1, imageIndex: 602 },
  ], 'after_host_ocr', {
    shared_key: 'current_detail_host_ocr_result',
    lang: 'chi_sim',
    timeout_seconds: 25,
    retry_attempts: 2,
  }, {
    current_store: '宿主端OCR识别商详保留锚点：VP-1',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'recognize_ocr_images')
  assert.equal(result.meta.next_phase, 'after_host_ocr')
  assert.equal(result.meta.shared_key, 'current_detail_host_ocr_result')
  assert.equal(result.meta.lang, 'chi_sim')
  assert.equal(result.meta.timeout_seconds, 25)
  assert.equal(result.meta.retry_attempts, 2)
  assert.deepEqual(plain(result.meta.items.map(item => [item.url, item.globalIndex, item.imageIndex])), [
    ['https://img.example/detail-01.jpg', 0, 601],
    ['https://img.example/detail-02.jpg', 1, 602],
  ])
})

test('Vipshop host-side OCR results build anchors with host source', async () => {
  const helpers = await loadExports()
  const anchors = helpers.buildVipshopDetailAnchorsFromOcrResults([
    { src: 'https://img.example/detail-01.jpg', globalIndex: 0 },
    { src: 'https://img.example/detail-02.jpg', globalIndex: 1 },
  ], [
    { globalIndex: 0, text: '商品卖点介绍' },
    { globalIndex: 1, text: '想要的信息看这里', confidence: 88 },
  ], {
    source: 'tesseract_ocr_host',
  })

  assert.equal(anchors.ocrStatus, 'recognized')
  assert.equal(anchors.source, 'tesseract_ocr_host')
  assert.equal(anchors.stopImageIndex, 1)
  assert.equal(anchors.stopAnchorKind, 'wanted_info')
})

test('visible alert confirm recognizes 确认 buttons', async () => {
  const exportsBox = {}
  const confirmButton = {
    offsetWidth: 80,
    offsetHeight: 32,
    getClientRects: () => [1],
    innerText: '确认',
    textContent: '确认',
    className: 'btn btn-primary',
    clicked: false,
    click() { this.clicked = true },
  }
  const footerButton = {
    offsetWidth: 110,
    offsetHeight: 32,
    getClientRects: () => [1],
    innerText: '取消提交审核',
    textContent: '取消提交审核',
    className: 'btn btn-primary',
    clicked: false,
    click() { this.clicked = true },
  }
  const dialog = {
    offsetWidth: 600,
    offsetHeight: 120,
    getClientRects: () => [1],
    innerText: '您确认要发布商品？发布后将提交商务审核，无法修改\n取消确认',
    textContent: '您确认要发布商品？发布后将提交商务审核，无法修改\n取消确认',
    querySelectorAll: () => [confirmButton],
  }
  const scriptPath = path.resolve('adapters/vipshop-ops-assistant/vipshop-package-main-image-replace.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: {},
      __CRAWSHRIMP_PHASE__: '__exports__',
      __CRAWSHRIMP_SHARED__: {},
      __CRAWSHRIMP_EXPORTS__: exportsBox,
    },
    document: {
      body: { innerText: '您确认要发布商品？发布后将提交商务审核，无法修改' },
      querySelectorAll: selector => {
        if (/bootbox|modal|role|message-box/.test(String(selector))) return [dialog]
        return []
      },
    },
    location: { href: 'https://vis.vip.com/portal-iframe.php#!/app-v/pdc-vue/product/edit/1/1' },
    fetch: async () => jsonResponse({ code: '200' }),
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

  assert.equal(exportsBox.clickVisibleAlertConfirm(/发布商品/), true)
  assert.equal(confirmButton.clicked, true)
  assert.equal(footerButton.clicked, false)
})

test('visible alert confirm does not click page footer submit buttons without a dialog', async () => {
  const exportsBox = {}
  const footerButton = {
    offsetWidth: 110,
    offsetHeight: 32,
    getClientRects: () => [1],
    innerText: '取消提交审核',
    textContent: '取消提交审核',
    className: 'btn btn-primary',
    clicked: false,
    click() { this.clicked = true },
  }
  const scriptPath = path.resolve('adapters/vipshop-ops-assistant/vipshop-package-main-image-replace.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: {},
      __CRAWSHRIMP_PHASE__: '__exports__',
      __CRAWSHRIMP_SHARED__: {},
      __CRAWSHRIMP_EXPORTS__: exportsBox,
    },
    document: {
      body: { innerText: '商品管理列表 编辑 取消提交审核' },
      querySelectorAll: () => [],
    },
    location: { href: 'https://vis.vip.com/portal-iframe.php#!/app-v/pdc-vue/product/edit/1/1' },
    fetch: async () => jsonResponse({ code: '200' }),
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

  assert.equal(exportsBox.clickVisibleAlertConfirm(/取消提交审核/), false)
  assert.equal(footerButton.clicked, false)
})

test('matches target color by colourGSN and marks 拼款 only when backend sn differs', async () => {
  const helpers = await loadExports()
  const detail = product()
  const color = helpers.findTargetColor(detail, '20132610801500311')

  assert.equal(color.colourName, '白色调')
  assert.equal(helpers.styleCodePrefix('20892616621200388'), '208926166212')
  assert.equal(helpers.isMergedStyle({ styleCode: '201326108015' }, detail), false)
  assert.equal(helpers.isMergedStyle({ styleCode: '209999999999' }, detail), true)
  assert.deepEqual(plain(helpers.buildMerchandiseQueryPayload(['20132610801500311'], 2, 50)), {
    pageNo: 2,
    pageSize: 50,
    param: { msnSet: ['20132610801500311'] },
  })
  assert.equal(
    helpers.buildPdcProductListPayload('20232610812520510', 3, 20, 1),
    'snList=20232610812520510&barcodeList=&categoryIds=&brandSn=&vendorType=1&pageNo=3&pageSize=20&order=0',
  )
  assert.equal(helpers.buildProductDetailPayload('1469658525260218368', 1), 'vendorProductId=1469658525260218368&vendorType=1')
})

test('main phase performs read-only API dry-run and returns replacement rows', async () => {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, body: options.body, contentType: options.headers?.['Content-Type'] })
    if (String(url).includes('/normal/normalMerchandiseQuery')) {
      const payload = JSON.parse(options.body)
      assert.deepEqual(payload.param.msnSet, ['20132610801500311', '20032610810600488'])
      return jsonResponse({
        code: '200',
        data: [
          {
            merchandiseNo: '6922036534956567941',
            name: '柔软百搭婴幼宝宝儿童长裤女童',
            msn: '20132610801500311',
            osn: '201326108015',
            vendorSpuId: '1469658525260218368',
            prodSpuId: 'SPU-20049AB8800800B7',
          },
          {
            merchandiseNo: '6922036535078350213',
            name: '婴幼宝宝儿童裤子男童运动裤',
            msn: '20032610810600488',
            osn: '200326108106',
            vendorSpuId: '2190515940616200193',
            prodSpuId: 'SPU-20049AB8802000AF',
          },
        ],
        total: 2,
      })
    }
    if (String(url).includes('/product/queryVendorProductByVpIdForVc')) {
      assert.match(options.headers?.['Content-Type'], /application\/x-www-form-urlencoded/)
      assert.match(options.body, /vendorProductId=/)
      if (String(options.body).includes('2190515940616200193')) {
        return jsonResponse({ code: 200, result: product({
          vendorProductId: '2190515940616200193',
          sn: '200326108106',
          title: '婴幼宝宝儿童裤子男童运动裤',
          status: '13',
          itemSkuAttr: [{
            colourGSN: '20032610810600488',
            colourName: '蓝色调',
            sizeAttr: [],
            colourImages: [],
            squareImages: [],
          }],
        }) })
      }
      return jsonResponse({ code: 200, result: product() })
    }
    throw new Error(`unexpected fetch ${url}`)
  }

  const result = await runScript({
    phase: 'query_vipshop',
    params: {
      execute_mode: 'plan',
      material_root_files: [
        image('/pkg/20132610801500311/主图/20132610801500311_1200x1200.jpg', 1200, 1200),
        image('/pkg/20132610801500311/主图/20132610801500311_950x1200.jpg', 950, 1200),
        image('/pkg/20132610801500311/微详情/20132610801500311_1200x1200_02.jpg', 1200, 1200),
        image('/pkg/20132610801500311/images/201326108015_01.jpg', 750, 1200),
      ],
    },
    shared: {
      jobs: [
        { rowNo: 2, styleCode: '201326108015', goodsCode: '20132610801500311', executeMode: 'plan', operationScope: ['package', 'main_image'] },
        { rowNo: 3, styleCode: '200326108106', goodsCode: '20032610810600488', executeMode: 'plan', operationScope: ['package', 'main_image'] },
      ],
      result_rows: [],
      total_input_rows: 2,
      total_jobs: 2,
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.shared.total_jobs, 2)
  assert.equal(calls.filter(call => String(call.url).includes('normalMerchandiseQuery')).length, 1)
  assert.equal(calls.filter(call => String(call.url).includes('queryVendorProductByVpIdForVc')).length, 2)

  const rows = result.data
  assert.equal(rows[0].__sheet_name, '执行摘要')
  assert.equal(rows[0].汇总类型, '总览')
  assert.match(rows[0]['失败原因/读回结果'], /总款色 2/)
  assert.ok(rows.some(row =>
    row.__sheet_name === '执行摘要' &&
    row.汇总类型 === '预检通过款号' &&
    row.货号 === '20132610801500311' &&
    row.最终结果 === '预检通过' &&
    row.计划替换图片数 > 0
  ))
  assert.ok(rows.some(row =>
    row.__sheet_name === '执行摘要' &&
    row.汇总类型 === '失败款号' &&
    row.货号 === '20032610810600488' &&
    row.最终结果 === '失败' &&
    row.处理建议.includes('补齐')
  ))
  assert.ok(rows.some(row => row.货号 === '20132610801500311' && row.图片用途 === '主图-商品图片1200x1200' && row.执行结果 === '计划替换'))
  assert.ok(rows.some(row => row.货号 === '20132610801500311' && row.图片用途 === '包装-商品详情切片' && row.图片索引 === '601'))
  assert.ok(rows.some(row => row.__sheet_name === '包装主图替换计划' && row.货号 === '20032610810600488' && row.备注.includes('取消提交审核')))
})

test('query phase falls back to PDC product list when old merchandise query misses goods code', async () => {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), body: String(options.body || ''), contentType: options.headers?.['Content-Type'] })
    if (String(url).includes('/normal/normalMerchandiseQuery')) {
      const payload = JSON.parse(options.body)
      assert.deepEqual(payload.param.msnSet, [
        '20842613320200311',
        '20232610812520510',
        '20842610321210501',
      ])
      return jsonResponse({
        code: '200',
        total: 1,
        data: [{
          merchandiseNo: '6922065779670516997',
          name: '新疆棉连体衣',
          msn: '20842613320200311',
          osn: '208426133202',
          vendorSpuId: '5637177038309171200',
          prodSpuId: 'SPU-OLD-HIT',
        }],
      })
    }
    if (String(url).includes('/product/getListForVc')) {
      assert.match(options.headers?.['Content-Type'], /application\/x-www-form-urlencoded/)
      const body = new URLSearchParams(String(options.body || ''))
      const code = body.get('snList')
      if (code === '20232610812520510') {
        return jsonResponse({
          code: 200,
          msg: '成功',
          result: {
            total: 1,
            list: [{
              vendorProductId: '3198477845265240066',
              title: '巴拉巴拉童装裤子男童束脚裤中大童长裤2026秋新款儿童工装裤',
              sn: '202326108125',
              status: '审核通过',
              statusCode: 13,
              colorImageInfo: [{ name: '冷灰20510', count: 6 }],
            }],
          },
        })
      }
      if (code === '20842610321210501') {
        return jsonResponse({ code: 200, msg: '成功', result: { total: 0, list: [] } })
      }
      throw new Error(`unexpected PDC list lookup ${code}`)
    }
    if (String(url).includes('/product/queryVendorProductByVpIdForVc')) {
      const body = new URLSearchParams(String(options.body || ''))
      const vendorProductId = body.get('vendorProductId')
      if (vendorProductId === '3198477845265240066') {
        return jsonResponse({ code: 200, result: product({
          vendorProductId,
          sn: '202326108125',
          title: '巴拉巴拉童装裤子男童束脚裤中大童长裤2026秋新款儿童工装裤',
          status: '13',
          itemSkuAttr: [{
            colourGSN: '20232610812520510',
            colourName: '冷灰20510',
            imageGroupIdStr: '3198477845265240068',
            sizeAttr: [],
            colourImages: [],
            squareImages: [],
          }],
        }) })
      }
      if (vendorProductId === '5637177038309171200') {
        return jsonResponse({ code: 200, result: product({
          vendorProductId,
          sn: '208426133202',
          title: '新疆棉连体衣',
          status: '13',
          itemSkuAttr: [{
            colourGSN: '20842613320200311',
            colourName: '白色调00311',
            imageGroupIdStr: '5637177038309171201',
            sizeAttr: [],
            colourImages: [],
            squareImages: [],
          }],
        }) })
      }
      throw new Error(`unexpected product detail ${vendorProductId}`)
    }
    throw new Error(`unexpected fetch ${url}`)
  }

  const result = await runScript({
    phase: 'query_vipshop',
    params: { execute_mode: 'plan' },
    shared: {
      jobs: [
        { rowNo: 2, styleCode: '208426133202', goodsCode: '20842613320200311', executeMode: 'plan', operationScope: ['precheck_only'] },
        { rowNo: 3, styleCode: '202326108125', goodsCode: '20232610812520510', executeMode: 'plan', operationScope: ['precheck_only'] },
        { rowNo: 4, styleCode: '208426103212', goodsCode: '20842610321210501', executeMode: 'plan', operationScope: ['precheck_only'] },
      ],
      result_rows: [],
      total_input_rows: 3,
      total_jobs: 3,
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(calls.filter(call => call.url.includes('/normal/normalMerchandiseQuery')).length, 1)
  assert.deepEqual(
    calls
      .filter(call => call.url.includes('/product/getListForVc'))
      .map(call => new URLSearchParams(call.body).get('snList')),
    ['20232610812520510', '20842610321210501'],
  )
  assert.deepEqual(
    calls
      .filter(call => call.url.includes('/product/queryVendorProductByVpIdForVc'))
      .map(call => new URLSearchParams(call.body).get('vendorProductId'))
      .sort(),
    ['3198477845265240066', '5637177038309171200'],
  )

  const detailRows = result.data.filter(row => row.__sheet_name === '包装主图替换计划')
  assert.ok(detailRows.some(row =>
    row.货号 === '20232610812520510' &&
    row.V_SPU === '3198477845265240066' &&
    row.后台款号 === '202326108125' &&
    row.目标颜色 === '冷灰20510' &&
    row.执行结果 === '预检通过' &&
    row.接口路径.includes('/product/getListForVc')
  ))
  assert.ok(detailRows.some(row =>
    row.货号 === '20842610321210501' &&
    row.执行结果 === '未找到商品' &&
    row.备注.includes('PDC 商品资料页均未命中')
  ))
})

test('execution summary lists live successes and merchandise lookup failures by goods code', async () => {
  const result = await runScript({
    phase: 'verify_live_job',
    params: { execute_mode: 'live' },
    shared: {
      result_rows: [
        {
          __sheet_name: '包装主图替换计划',
          表格行号: 2,
          款号: '208426133202',
          货号: '20842613320200311',
          商品ID: '6922065779670516997',
          商品状态: '已提交审核',
          目标颜色: '白色调00311',
          图片用途: '商品资料预检',
          执行结果: '预检通过',
          备注: '当前状态需先取消提交审核/撤回后才能编辑',
        },
        {
          __sheet_name: '包装主图替换计划',
          表格行号: 2,
          款号: '208426133202',
          货号: '20842613320200311',
          图片用途: '包装-商品详情切片',
          执行结果: '已下载',
        },
        {
          __sheet_name: '包装主图替换计划',
          表格行号: 2,
          款号: '208426133202',
          货号: '20842613320200311',
          图片用途: '包装-商品详情切片',
          执行结果: '计划替换',
        },
        {
          __sheet_name: '包装主图替换计划',
          表格行号: 3,
          款号: '202326108125',
          货号: '20232610812520510',
          图片用途: '商品资料预检',
          执行结果: '未找到商品',
          备注: '按完整货号查询唯品会商品资料未命中',
        },
      ],
      live_rows: [
        {
          __sheet_name: '包装主图替换计划',
          表格行号: 2,
          款号: '208426133202',
          货号: '20842613320200311',
          商品ID: '6922065779670516997',
          商品状态: '已提交审核',
          目标颜色: '白色调00311',
          图片用途: '包装-商品详情切片',
          执行结果: '已上传待保存',
          备注: 'http://a.vpimg2.com/upload/example.jpg',
        },
        {
          __sheet_name: '包装主图替换计划',
          表格行号: 2,
          款号: '208426133202',
          货号: '20842613320200311',
          商品ID: '6922065779670516997',
          商品状态: '已提交审核',
          目标颜色: '白色调00311',
          图片用途: '线上替换',
          执行结果: '保存并提交审核成功',
          备注: '读回状态=审核通过；已读回 1 个新图URL',
        },
      ],
      live_contexts: [],
      live_index: 0,
    },
    fetchImpl: async () => {
      throw new Error('fetch should not be called')
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.deepEqual(
    plain(
    result.data
      .filter(row => row.__sheet_name === '执行摘要' && row.汇总类型 !== '总览')
      .map(row => [row.汇总类型, row.货号, row.最终结果, row.已下载素材数, row.计划替换图片数, row.已上传图片数, row.处理建议]),
    ),
    [
      ['成功款号', '20842613320200311', '成功', 1, 1, 1, ''],
      ['失败款号', '20232610812520510', '失败', 0, 0, 0, '检查唯品后台完整货号是否存在，或确认货号/色号后重跑'],
    ],
  )
  assert.match(result.data[0]['失败原因/读回结果'], /成功 1；失败 1/)
})

test('live mode follows execute_mode without legacy allow_live gate', async () => {
  const result = await runScript({
    params: {
      execute_mode: 'live',
      use_semir_cloud: false,
      input_file: { rows: [{ 款号: '201326108015', 货号: '20132610801500311' }] },
    },
    fetchImpl: async () => {
      throw new Error('live mode should not call network before query phase')
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'navigate_nov_admin')
  assert.equal(result.meta.shared.live_blocked, undefined)
  assert.equal(result.meta.shared.execute_mode, 'live')
})

test('Semir cloud login page waits for user login for 500 seconds without calling APIs', async () => {
  let fetchCalled = false
  const result = await runScript({
    phase: 'collect_cloud_assets',
    locationHref: 'https://fmp.semirapp.com/web/index#/home/file',
    bodyText: 'SEMIR 森马云盘 森马员工登录 前往统一认证中心登录 其他用户登录',
    shared: {
      jobs: [{ rowNo: 2, styleCode: '200326108106', goodsCode: '20032610810620410', operationScope: ['package'] }],
      job_index: 0,
    },
    fetchImpl: async () => {
      fetchCalled = true
      throw new Error('login page should wait before hitting cloud APIs')
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'collect_cloud_assets')
  assert.equal(result.meta.sleep_ms, 5000)
  assert.equal(result.meta.shared.semir_login_wait_attempts, 1)
  assert.match(result.meta.shared.current_store, /5\/500秒/)
  assert.equal(fetchCalled, false)
})

test('Semir cloud 40106 login timeout waits instead of failing lookup', async () => {
  const result = await runScript({
    phase: 'collect_cloud_assets',
    locationHref: 'https://fmp.semirapp.com/web/index#/home/file',
    shared: {
      jobs: [{ rowNo: 2, styleCode: '200326108106', goodsCode: '20032610810620410', operationScope: ['package'] }],
      job_index: 0,
    },
    fetchImpl: async () => jsonResponse({ code: '40106', msg: '登录超时' }),
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'collect_cloud_assets')
  assert.equal(result.meta.shared.semir_login_wait_attempts, 1)
  assert.match(result.meta.shared.semir_login_wait_error, /登录态不可用/)
  assert.match(result.meta.shared.current_store, /5\/500秒/)
})

test('Semir folder JSON with 40106 in file data is not treated as login timeout', async () => {
  const root = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/2026Q4/幼童/208426100202'
  const fetchImpl = async (url, options = {}) => {
    const parsedUrl = new URL(String(url), 'https://fmp.semirapp.com')
    if (parsedUrl.pathname === '/fengcloud/1/account/mount') {
      return jsonResponse([{ name: '巴拉巴拉品牌事业部-市场系统', mount_id: '1863' }])
    }
    if (parsedUrl.pathname === '/fengcloud/2/file/search') {
      const body = new URLSearchParams(String(options.body || ''))
      const keyword = body.get('keyword')
      const items = keyword === '208426100202'
        ? [{ dir: 1, filename: '208426100202', fullpath: root, mount_id: '1863' }]
        : []
      return jsonResponse({ total: items.length, list: items })
    }
    if (parsedUrl.pathname === '/fengcloud/1/file/ls') {
      const fullpath = parsedUrl.searchParams.get('fullpath')
      if (fullpath === root) {
        return jsonResponse({
          count: 1,
          list: [{ dir: 1, filename: '源文件', fullpath: `${root}/源文件`, mount_id: '1863' }],
        })
      }
      if (fullpath === `${root}/源文件`) {
        return jsonResponse({
          count: 1,
          list: [{
            dir: 0,
            filename: '细节.psd',
            fullpath: `${root}/源文件/细节.psd`,
            filesize: 544010693,
            filehash: 'de0424b719261939994eaca81070d0fb6c754760',
            mount_id: '1863',
          }],
        })
      }
      return jsonResponse({ count: 0, list: [] })
    }
    throw new Error(`unexpected fetch ${url}`)
  }

  const result = await runScript({
    phase: 'collect_cloud_assets',
    locationHref: 'https://fmp.semirapp.com/web/index#/home/file',
    shared: {
      jobs: [{
        rowNo: 23,
        styleCode: '208426100202',
        goodsCode: '20842610020200331',
        operationScope: ['package'],
        cloudPath: '巴拉巴拉品牌事业部-市场系统//品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装/',
        folderScanDepth: 5,
      }],
      job_index: 0,
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'navigate_nov_admin')
  assert.equal(result.meta.shared.semir_login_wait_attempts, undefined)
  assert.equal(result.meta.shared.result_rows[0].执行结果, '未匹配到图片')
})
