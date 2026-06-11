import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/mop-ops-assistant/kol-material-img2video-batch.js')
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8')
const SEARCH_RECOMMEND_SCRIPT_PATH = path.resolve('adapters/mop-ops-assistant/search-recommend-material-publish.js')
const SEARCH_RECOMMEND_SCRIPT_SOURCE = fs.readFileSync(SEARCH_RECOMMEND_SCRIPT_PATH, 'utf8')
const CATALOG_SCRIPT_PATH = path.resolve('adapters/mop-ops-assistant/export-video-template-catalog.js')
const CATALOG_SCRIPT_SOURCE = fs.readFileSync(CATALOG_SCRIPT_PATH, 'utf8')
const MANIFEST_PATH = path.resolve('adapters/mop-ops-assistant/manifest.yaml')

async function runAdapter({ params = {}, phase = 'main', shared = {}, contextExtra = {} } = {}) {
  const windowObject = {
    __CRAWSHRIMP_PARAMS__: params,
    __CRAWSHRIMP_PHASE__: phase,
    __CRAWSHRIMP_SHARED__: shared,
    ...(contextExtra.exportsBox ? { __CRAWSHRIMP_EXPORTS__: contextExtra.exportsBox } : {}),
  }
  if (contextExtra.windowExtras) Object.assign(windowObject, contextExtra.windowExtras)
  const context = {
    window: windowObject,
    document: contextExtra.document || {},
    location: { href: 'https://qn.taobao.com/home.htm/material-center/video-production/img2video' },
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
    parseInt,
    parseFloat,
    isNaN,
    Error,
    FileReader: contextExtra.FileReader,
  }
  context.globalThis = context
  return await vm.runInNewContext(SCRIPT_SOURCE, context, { filename: SCRIPT_PATH })
}

async function loadExports() {
  const exportsBox = {}
  await runAdapter({ phase: '__exports__', contextExtra: { exportsBox } })
  return exportsBox
}

async function runSearchRecommendAdapter({ params = {}, phase = 'main', shared = {}, contextExtra = {} } = {}) {
  const windowObject = {
    __CRAWSHRIMP_PARAMS__: params,
    __CRAWSHRIMP_PHASE__: phase,
    __CRAWSHRIMP_SHARED__: shared,
    ...(contextExtra.exportsBox ? { __CRAWSHRIMP_EXPORTS__: contextExtra.exportsBox } : {}),
  }
  if (contextExtra.windowExtras) Object.assign(windowObject, contextExtra.windowExtras)
  const context = {
    window: windowObject,
    document: contextExtra.document || {},
    location: { href: 'https://qn.taobao.com/home.htm/material-center/material-management?tab=recommend' },
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
    parseInt,
    parseFloat,
    isNaN,
    Error,
    encodeURIComponent,
    decodeURIComponent,
    FileReader: contextExtra.FileReader,
  }
  context.globalThis = context
  return await vm.runInNewContext(SEARCH_RECOMMEND_SCRIPT_SOURCE, context, { filename: SEARCH_RECOMMEND_SCRIPT_PATH })
}

async function loadSearchRecommendExports() {
  const exportsBox = {}
  await runSearchRecommendAdapter({ phase: '__exports__', contextExtra: { exportsBox } })
  return exportsBox
}

async function runCatalogScript({ params = {}, mtopHandler } = {}) {
  const calls = []
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      lib: {
        mtop: {
          async request(payload) {
            calls.push(payload)
            return mtopHandler ? mtopHandler(payload) : { ret: ['SUCCESS::调用成功'], data: { result: [] } }
          },
        },
      },
    },
    document: {},
    location: { href: 'https://qn.taobao.com/home.htm/material-center/video-production/img2video' },
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
    parseInt,
    parseFloat,
    isNaN,
    Error,
  }
  context.globalThis = context
  const result = await vm.runInNewContext(CATALOG_SCRIPT_SOURCE, context, { filename: CATALOG_SCRIPT_PATH })
  return { result, calls }
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function validRow(overrides = {}) {
  return {
    商品ID: '728857154429',
    素材图片: '/Users/test/KOL/728857154429/01.jpg;/Users/test/KOL/728857154429/02.jpg',
    比例: '3:4',
    提示词: '突出上身效果',
    ...overrides,
  }
}

function validSearchRecommendRow(overrides = {}) {
  return {
    商品ID: '1051467606993',
    素材图片: '/Users/test/搜推/1051467606993/01.jpg;/Users/test/搜推/1051467606993/02.jpg;/Users/test/搜推/1051467606993/03.jpg',
    添加标题: '亚麻连衣裙穿搭',
    内容描述: '清爽亚麻质感搭配简洁版型，日常通勤和周末出游都很适合，突出自然垂坠和轻盈气质。',
    备注: '第一批',
    ...overrides,
  }
}

function kocListing(root = '/Users/test/koc4') {
  const entries = [
    'MOP655137Z4106Z+656939D1213Y+655130Z4110Z/图片/主图/AHOYECHO/03.jpg',
    'MOP655137Z4106Z+656939D1213Y+655130Z4110Z/图片/主图/AHOYECHO/01.jpg',
    'MOP655137Z4106Z+656939D1213Y+655130Z4110Z/图片/主图/AHOYECHO/02.jpg',
    'MOP655137Z4106Z+656939D1213Y+655130Z4110Z/图片/主图/Bella/01.jpg',
    'MOP655137Z4106Z+656939D1213Y+655130Z4110Z/图片/主图/Bella/02.jpg',
    'MOP655137Z4106Z+656939D1213Y+655130Z4110Z/图片/买家秀&逛逛/Tobiko/ignore-buyer-show.jpg',
    'MOP655137Z4106Z+656939D1213Y+655130Z4110Z/视频/主图/AHOYECHO/ignore-video-folder.jpg',
    'MOP655137Z4106Z+656939D1213Y+655130Z4110Z/视频/主图/AHOYECHO/ignore-video.mp4',
    'MOP连衣裙套装655230Q5904Z/图片/主图/Sia/01.jpg',
    'MOP连衣裙套装655230Q5904Z/图片/主图/Sia/02.png',
    'MOP连衣裙套装655230Q5904Z/图片(1)/主图/Sia/03.webp',
    'MOP连衣裙套装655230Q5904Z/图片/主图/Tina/01.jpg',
    'MOP连衣裙套装655230Q5904Z/图片/主图/Tina/02.jpg',
    'MOP连衣裙套装655230Q5904Z/图片/主图/Tina/03.jpg',
  ]
  return {
    root,
    paths: entries.map((relativePath, index) => ({
      path: `${root}/${relativePath}`,
      relativePath,
      mtimeMs: index + 1,
      size: 1000 + index,
    })),
  }
}

function frameTemplate(overrides = {}) {
  return {
    templateId: 'tpl-frame-001',
    name: 'KOL 走秀双图',
    type: 'frame',
    provider: 'content',
    description: '走秀展示',
    inputImages: JSON.stringify([
      { code: 0, name: '模特图', required: true },
      { code: 1, name: '细节图', required: true },
    ]),
    ...overrides,
  }
}

function actionTemplate(overrides = {}) {
  return {
    templateId: 'tpl-action-001',
    name: '单图动作模板',
    type: 'action',
    provider: 'content',
    description: '人物自然转身',
    inputImages: JSON.stringify([{ code: 0, name: '首图', required: true }]),
    ...overrides,
  }
}

test('normalizes jobs from Excel rows and selected image names', async () => {
  const helpers = await loadExports()
  const parsed = helpers.normalizeJobs([
    {
      商品ID: 'https://item.taobao.com/item.htm?id=741042967594',
      素材图片: '',
      素材张数: '',
    },
  ], {
    materialImages: {
      paths: [
        '/Users/test/KOL/741042967594_02.jpg',
        '/Users/test/KOL/741042967594_01.jpg',
        '/Users/test/KOL/other.jpg',
      ],
    },
    mainCategory: '女装/女士精品',
  })

  assert.equal(parsed.invalidRows.length, 0)
  assert.equal(parsed.jobs.length, 1)
  assert.equal(parsed.jobs[0].productId, '741042967594')
  assert.equal(parsed.jobs[0].materialSource, '手动选择素材图片')
  assert.deepEqual(plain(parsed.jobs[0].materialRefs), [
    '/Users/test/KOL/741042967594_01.jpg',
    '/Users/test/KOL/741042967594_02.jpg',
  ])
})

test('builds material paths from root folder and count convention', async () => {
  const helpers = await loadExports()
  const parsed = helpers.normalizeJobs([
    { 商品ID: '728857154429', 素材张数: '3' },
  ], {
    materialRoot: '/Users/test/KOL素材',
    defaultMaterialCount: 2,
  })

  assert.equal(parsed.invalidRows.length, 0)
  assert.deepEqual(plain(parsed.jobs[0].materialRefs), [
    '/Users/test/KOL素材/728857154429/01.jpg',
    '/Users/test/KOL素材/728857154429/02.jpg',
    '/Users/test/KOL素材/728857154429/03.jpg',
  ])
  assert.equal(parsed.jobs[0].materialSource, '素材根目录')
})

test('uses KOC main image package listing by merchant code before root convention', async () => {
  const helpers = await loadExports()
  const listing = kocListing()
  const grouped = helpers.groupKocMainImagesByMerchantCode(listing, listing.root)

  assert.equal(grouped['655137Z4106Z'].length, 5)
  assert.equal(grouped['656939D1213Y'].length, 5)
  assert.equal(grouped['655230Q5904Z'].length, 6)
  assert.equal(grouped['655137Z4106Z'].some(path => path.includes('买家秀')), false)
  assert.equal(grouped['655137Z4106Z'].some(path => path.includes('/视频/')), false)

  const groupDetails = helpers.groupKocMainImageGroupsByMerchantCode(listing, listing.root)
  assert.deepEqual(plain(groupDetails['656939D1213Y'].map(group => group.creator)), ['AHOYECHO', 'Bella'])

  const parsed = helpers.normalizeJobs([
    { 商品ID: '', 商家编码: '656939D1213Y', 素材张数: '2' },
  ], {
    materialRoot: listing.root,
    materialRootFiles: listing,
    defaultMaterialCount: 3,
  })

  assert.equal(parsed.invalidRows.length, 0, JSON.stringify(parsed.invalidRows))
  assert.equal(parsed.jobs.length, 2)
  assert.equal(parsed.jobs[0].materialSource, '达人图包主图')
  assert.equal(parsed.jobs[0].creator, 'AHOYECHO')
  assert.equal(parsed.jobs[1].creator, 'Bella')
  assert.deepEqual(plain(parsed.jobs[0].materialRefs), [
    `${listing.root}/MOP655137Z4106Z+656939D1213Y+655130Z4110Z/图片/主图/AHOYECHO/03.jpg`,
    `${listing.root}/MOP655137Z4106Z+656939D1213Y+655130Z4110Z/图片/主图/AHOYECHO/01.jpg`,
  ])
  assert.deepEqual(plain(parsed.jobs[1].materialRefs), [
    `${listing.root}/MOP655137Z4106Z+656939D1213Y+655130Z4110Z/图片/主图/Bella/01.jpg`,
    `${listing.root}/MOP655137Z4106Z+656939D1213Y+655130Z4110Z/图片/主图/Bella/02.jpg`,
  ])
})

test('assigns KOC creator packages to duplicate merchant rows in order', async () => {
  const helpers = await loadExports()
  const listing = kocListing()
  const parsed = helpers.normalizeJobs([
    { 商品ID: '', 商家编码: '656939D1213Y', 素材张数: '2', 提示词: '第一条提示词' },
    { 商品ID: '', 商家编码: '656939D1213Y', 素材张数: '2', 提示词: '第二条提示词' },
  ], {
    materialRoot: listing.root,
    materialRootFiles: listing,
    defaultMaterialCount: 3,
  })

  assert.equal(parsed.invalidRows.length, 0, JSON.stringify(parsed.invalidRows))
  assert.equal(parsed.jobs.length, 2)
  assert.equal(parsed.jobs[0].creator, 'AHOYECHO')
  assert.equal(parsed.jobs[0].prompt, '第一条提示词')
  assert.equal(parsed.jobs[1].creator, 'Bella')
  assert.equal(parsed.jobs[1].prompt, '第二条提示词')
  assert.deepEqual(plain(parsed.jobs[0].materialRefs), [
    `${listing.root}/MOP655137Z4106Z+656939D1213Y+655130Z4110Z/图片/主图/AHOYECHO/03.jpg`,
    `${listing.root}/MOP655137Z4106Z+656939D1213Y+655130Z4110Z/图片/主图/AHOYECHO/01.jpg`,
  ])
  assert.deepEqual(plain(parsed.jobs[1].materialRefs), [
    `${listing.root}/MOP655137Z4106Z+656939D1213Y+655130Z4110Z/图片/主图/Bella/01.jpg`,
    `${listing.root}/MOP655137Z4106Z+656939D1213Y+655130Z4110Z/图片/主图/Bella/02.jpg`,
  ])
})

test('assigns KOC package by explicit creator column when duplicate rows are out of order', async () => {
  const helpers = await loadExports()
  const listing = kocListing()
  const parsed = helpers.normalizeJobs([
    { 商品ID: '', 商家编码: '656939D1213Y', 达人: 'Bella', 素材张数: '2', 提示词: '指定 Bella' },
  ], {
    materialRoot: listing.root,
    materialRootFiles: listing,
    defaultMaterialCount: 3,
  })

  assert.equal(parsed.invalidRows.length, 0, JSON.stringify(parsed.invalidRows))
  assert.equal(parsed.jobs.length, 1)
  assert.equal(parsed.jobs[0].creator, 'Bella')
  assert.equal(parsed.jobs[0].prompt, '指定 Bella')
  assert.deepEqual(plain(parsed.jobs[0].materialRefs), [
    `${listing.root}/MOP655137Z4106Z+656939D1213Y+655130Z4110Z/图片/主图/Bella/01.jpg`,
    `${listing.root}/MOP655137Z4106Z+656939D1213Y+655130Z4110Z/图片/主图/Bella/02.jpg`,
  ])
})

test('splits whitespace separated absolute image paths from spreadsheet cells', async () => {
  const helpers = await loadExports()
  const parsed = helpers.normalizeJobs([
    {
      商品ID: '1038526750348',
      素材图片: '/Users/test/KOL/a.jpg /Users/test/KOL/b.jpg https://img.example/c.png',
    },
  ])

  assert.equal(parsed.invalidRows.length, 0, JSON.stringify(parsed.invalidRows))
  assert.deepEqual(plain(parsed.jobs[0].materialRefs), [
    '/Users/test/KOL/a.jpg',
    '/Users/test/KOL/b.jpg',
    'https://img.example/c.png',
  ])
})

test('extracts upload URL from nested page helper response', async () => {
  const helpers = await loadExports()

  assert.equal(
    helpers.findFirstRemoteUrl({ success: true, object: { url: 'https://img.alicdn.com/imgextra/test.jpg' } }),
    'https://img.alicdn.com/imgextra/test.jpg',
  )
  assert.equal(
    helpers.findFirstRemoteUrl({ data: { result: { fullUrl: '//img.alicdn.com/imgextra/no-protocol.jpg' } } }),
    'https://img.alicdn.com/imgextra/no-protocol.jpg',
  )
})

test('reports invalid rows when product id or material images are missing', async () => {
  const helpers = await loadExports()
  const parsed = helpers.normalizeJobs([
    { 商品ID: '', 素材图片: '/tmp/material.jpg' },
    { 商品ID: '728857154429', 素材图片: '/tmp/material.txt' },
  ])

  assert.equal(parsed.jobs.length, 0)
  assert.equal(parsed.invalidRows.length, 2)
  assert.match(parsed.invalidRows[0].备注, /商品ID或商家编码必填/)
  assert.match(parsed.invalidRows[1].备注, /扩展名不支持/)
})

test('accepts merchant code when product id is empty and groups selected KOL images by merchant code', async () => {
  const helpers = await loadExports()
  const parsed = helpers.normalizeJobs([
    { 商品ID: '', 商家编码: '46X096070266', 素材张数: '' },
  ], {
    materialImages: {
      paths: [
        '/Users/test/KOL/46X096070266_02.jpg',
        '/Users/test/KOL/46X096070266_01.jpg',
        '/Users/test/KOL/other.jpg',
      ],
    },
  })

  assert.equal(parsed.invalidRows.length, 0, JSON.stringify(parsed.invalidRows))
  assert.equal(parsed.jobs.length, 1)
  assert.equal(parsed.jobs[0].productId, '')
  assert.equal(parsed.jobs[0].merchantCode, '46X096070266')
  assert.equal(parsed.jobs[0].materialSource, '手动选择素材图片')
  assert.deepEqual(plain(parsed.jobs[0].materialRefs), [
    '/Users/test/KOL/46X096070266_01.jpg',
    '/Users/test/KOL/46X096070266_02.jpg',
  ])
})

test('skips template instruction rows and empty rows from workbook helper area', async () => {
  const helpers = await loadExports()
  const parsed = helpers.normalizeJobs([
    validRow(),
    { 商品ID: '说明' },
    { 商品ID: '现在脚本按千牛页面的“选商品 + 图片生成展示视频”逻辑提交，不再选择或指定模板。' },
    { 填写说明: '素材图片不是必填；如果留空，请在运行界面选择素材根目录。' },
    {},
  ])

  assert.equal(parsed.invalidRows.length, 0)
  assert.equal(parsed.jobs.length, 1)
  assert.equal(parsed.jobs[0].productId, '728857154429')
})

test('formats MTop object errors into readable messages', async () => {
  const helpers = await loadExports()
  const message = helpers.describeError({
    data: { errorCode: '5000', errorMsg: 'model images is null' },
    ret: ['FAIL_BIZ_5000::model images is null'],
    traceId: 'trace-001',
  })

  assert.match(message, /model images is null/)
  assert.match(message, /errorCode=5000/)
  assert.match(message, /traceId=trace-001/)
})

test('builds display video payload with item and material images', async () => {
  const helpers = await loadExports()
  const job = helpers.normalizeJobs([validRow()]).jobs[0]
  const materials = [{ ref: 'local.jpg', url: 'https://img.example/local.jpg' }]
  const img2VideoPayload = helpers.buildImg2VideoPayload(job, { itemId: job.productId, title: '测试商品' }, materials)

  assert.equal(img2VideoPayload.api, 'mtop.taobao.qn.copilot.image.generate.video.submit')
  assert.equal(img2VideoPayload.data.funcType, 'model_img2video')
  assert.equal(img2VideoPayload.data.selectFirstLastFrame, 'false')
  assert.equal(JSON.parse(img2VideoPayload.data.itemVO).itemId, job.productId)
  assert.equal(JSON.parse(img2VideoPayload.data.clips)[0].modelUrl, 'https://img.example/local.jpg')
})

test('ignores old template fields and always prepares display video jobs', async () => {
  const helpers = await loadExports()
  const parsed = helpers.normalizeJobs([validRow({
    生成模式: 'template',
    模板ID: 'tpl-legacy',
    模板主题: '旧模板',
    槽位映射: '0=/Users/test/KOL/728857154429/model.jpg',
  })])

  assert.equal(parsed.invalidRows.length, 0)
  assert.equal(parsed.jobs[0].mode, 'img2video')
  assert.equal(parsed.jobs[0].templateId, '')
  assert.deepEqual(plain(parsed.jobs[0].slotMapping), [])
  assert.deepEqual(plain(parsed.jobs[0].materialRefs), [
    '/Users/test/KOL/728857154429/01.jpg',
    '/Users/test/KOL/728857154429/02.jpg',
  ])
})

test('plan mode returns preview rows and does not require page APIs', async () => {
  const result = await runAdapter({
    params: {
      execute_mode: 'plan',
      input_file: { rows: [validRow()] },
    },
  })

  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].执行结果, '预检通过')
  assert.match(result.data[0].备注, /计划使用 2 张素材/)
})

test('live main phase prepares jobs and process_row injects current row image refs', async () => {
  const appended = []
  const document = {
    querySelector(selector) {
      return appended.find(item => item.id === selector.replace(/^#/, '')) || null
    },
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        style: {},
        attrs: {},
        setAttribute(key, value) { this.attrs[key] = value },
      }
    },
    body: {
      appendChild(input) {
        appended.push(input)
      },
    },
    documentElement: {
      appendChild(input) {
        appended.push(input)
      },
    },
  }

  const result = await runAdapter({
    params: {
      execute_mode: 'live',
      input_file: { rows: [validRow()] },
    },
    contextExtra: { document },
  })

  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'process_row')

  const processResult = await runAdapter({
    phase: 'process_row',
    shared: result.meta.shared,
    contextExtra: { document },
  })

  assert.equal(processResult.success, true, JSON.stringify(processResult))
  assert.equal(processResult.meta.action, 'inject_files')
  assert.equal(processResult.meta.next_phase, 'process_row')
  assert.equal(processResult.meta.items[0].selector, '#crawshrimp-mop-kol-material-input')
  assert.deepEqual(plain(processResult.meta.items[0].files), [
    '/Users/test/KOL/728857154429/01.jpg',
    '/Users/test/KOL/728857154429/02.jpg',
  ])
  assert.equal(appended[0].multiple, true)
})

test('live KOL process_row resolves product id from merchant code before submitting', async () => {
  const helpers = await loadExports()
  const calls = []
  const result = await runAdapter({
    params: {
      execute_mode: 'live',
      input_file: {
        rows: [{ 商家编码: '46X096070266', 素材图片: 'https://img.example/kol-01.jpg' }],
      },
    },
    contextExtra: {
      windowExtras: {
        lib: {
          mtop: {
            async request(payload) {
              calls.push(payload)
              if (payload.api === 'mtop.tmall.sell.pc.manage.async') {
                return {
                  ret: ['SUCCESS::调用成功'],
                  data: {
                    result: JSON.stringify({
                      success: true,
                      data: {
                        table: {
                          dataSource: [{
                            itemId: '871556935889',
                            itemDesc: {
                              img: '//img.example/item.jpg',
                              desc: [
                                { text: '测试羽绒服', copyText: '测试羽绒服' },
                                { text: 'ID:871556935889', copyText: '871556935889' },
                                { text: ' 编码:46X096070266' },
                              ],
                            },
                          }],
                        },
                      },
                    }),
                  },
                }
              }
              if (payload.api === 'mtop.taobao.qianniu.shop.item.search') {
                return { ret: ['SUCCESS::调用成功'], data: { result: { list: [{ itemId: '871556935889', title: '测试羽绒服' }] } } }
              }
              if (payload.api === 'mtop.taobao.qn.copilot.item.material.get') {
                return { ret: ['SUCCESS::调用成功'], data: { result: { itemPics: [] } } }
              }
              return { ret: ['SUCCESS::调用成功'], data: { result: {} } }
            },
          },
        },
      },
    },
  })

  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(result.meta.next_phase, 'process_row')
  const processResult = await runAdapter({
    phase: 'process_row',
    shared: result.meta.shared,
    contextExtra: {
      windowExtras: {
        lib: {
          mtop: {
            async request(payload) {
              calls.push(payload)
              if (payload.api === 'mtop.tmall.sell.pc.manage.async') {
                return {
                  ret: ['SUCCESS::调用成功'],
                  data: {
                    result: JSON.stringify({
                      success: true,
                      data: {
                        table: {
                          dataSource: [{
                            itemId: '871556935889',
                            itemDesc: {
                              img: '//img.example/item.jpg',
                              desc: [
                                { text: '测试羽绒服', copyText: '测试羽绒服' },
                                { text: 'ID:871556935889', copyText: '871556935889' },
                                { text: ' 编码:46X096070266' },
                              ],
                            },
                          }],
                        },
                      },
                    }),
                  },
                }
              }
              if (payload.api === 'mtop.taobao.qianniu.shop.item.search') {
                return { ret: ['SUCCESS::调用成功'], data: { result: { list: [{ itemId: '871556935889', title: '测试羽绒服' }] } } }
              }
              if (payload.api === 'mtop.taobao.qn.copilot.item.material.get') {
                return { ret: ['SUCCESS::调用成功'], data: { result: { itemPics: [] } } }
              }
              return { ret: ['SUCCESS::调用成功'], data: { result: {} } }
            },
          },
        },
      },
    },
  })

  assert.equal(processResult.success, true, JSON.stringify(processResult))
  assert.equal(processResult.meta.next_phase, 'submit_job')
  assert.equal(processResult.meta.shared.active_job.productId, '871556935889')
  assert.equal(processResult.meta.shared.active_job.merchantCode, '46X096070266')
  assert.equal(calls.some(call => call.api === 'mtop.tmall.sell.pc.manage.async'), true)
  assert.equal(JSON.parse(calls.find(call => call.api === 'mtop.tmall.sell.pc.manage.async').data.jsonBody).filter.queryOuterId, '46X096070266')
  assert.equal(helpers.buildOutputRow(processResult.meta.shared.active_job, { status: '预览' }).商家编码, '46X096070266')
})

test('template catalog export calls mtop and flattens slot details', async () => {
  const { result, calls } = await runCatalogScript({
    params: { main_category: '女装/女士精品' },
    mtopHandler(payload) {
      if (payload.api.includes('seller.category')) {
        return { ret: ['SUCCESS::调用成功'], data: { result: { mainCateName: '女装/女士精品' } } }
      }
      if (payload.api.includes('video.template.list')) {
        return {
          ret: ['SUCCESS::调用成功'],
          data: {
            result: [frameTemplate({
              category: JSON.stringify({
                tagCategory: { name: '节日主题风', children: [{ name: '新年穿搭' }] },
                bizCategory: { name: '女装/女士精品', children: [{ name: '连衣裙' }] },
              }),
              coverUrl: 'https://img.example/cover.png',
              videoUrl: 'https://video.example/demo.mp4',
            })],
          },
        }
      }
      return { ret: ['SUCCESS::调用成功'], data: { result: [] } }
    },
  })

  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].模板ID, 'tpl-frame-001')
  assert.equal(result.data[0].封面URL, 'https://img.example/cover.png')
  assert.match(result.data[0].槽位说明, /0:模特图/)
  assert.match(result.data[0].分类, /节日主题风/)
  assert.equal(calls.some(call => call.api === 'mtop.taobao.qn.copilot.video.template.list'), true)
})

test('manifest exposes simplified display video workbook only', () => {
  const manifestText = fs.readFileSync(MANIFEST_PATH, 'utf8')
  assert.equal(manifestText.includes('id: kol_material_img2video_batch'), true)
  assert.equal(manifestText.includes('id: search_recommend_material_publish'), true)
  assert.equal(manifestText.includes('file: templates/kol-material-img2video-template.xlsx'), true)
  assert.equal(manifestText.includes('file: templates/search-recommend-material-template.xlsx'), true)
  assert.equal(manifestText.includes('id: export_video_template_catalog'), false)
  assert.equal(manifestText.includes('模板ID'), false)
  assert.equal(manifestText.includes('生成模式'), false)
  assert.equal(fs.existsSync(path.resolve('adapters/mop-ops-assistant/templates/kol-material-img2video-template.xlsx')), true)
  assert.equal(fs.existsSync(path.resolve('adapters/mop-ops-assistant/templates/search-recommend-material-template.xlsx')), true)
})

test('submit phase calls display video MTop API and records task id', async () => {
  const helpers = await loadExports()
  const job = helpers.normalizeJobs([validRow({ 素材图片: 'https://img.example/01.jpg;https://img.example/02.jpg' })]).jobs[0]
  const activeJob = {
    ...job,
    item: { itemId: job.productId, title: '测试商品' },
    resolvedMaterials: [
      { ref: 'https://img.example/01.jpg', url: 'https://img.example/01.jpg', source: 'remote' },
      { ref: 'https://img.example/02.jpg', url: 'https://img.example/02.jpg', source: 'remote' },
    ],
  }
  const calls = []
  const shared = {
    ...helpers.buildRunShared([job], { executeMode: 'live' }),
    active_job: activeJob,
  }

  const result = await runAdapter({
    phase: 'submit_job',
    shared,
    contextExtra: {},
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.shared.results[0].执行结果, '提交失败')
  assert.match(result.meta.shared.results[0].备注, /MTop 客户端/)

  const windowObject = {
    __CRAWSHRIMP_PARAMS__: {},
    __CRAWSHRIMP_PHASE__: 'submit_job',
    __CRAWSHRIMP_SHARED__: shared,
    lib: {
      mtop: {
        async request(payload) {
          calls.push(payload)
          return { ret: ['SUCCESS::调用成功'], data: { result: { task: { id: 'task-001' } } } }
        },
      },
    },
  }
  const context = {
    window: windowObject,
    document: {},
    location: { href: 'https://qn.taobao.com/home.htm/material-center/video-production/img2video' },
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
    parseInt,
    parseFloat,
    isNaN,
    Error,
  }
  context.globalThis = context
  const submitResult = await vm.runInNewContext(SCRIPT_SOURCE, context, { filename: SCRIPT_PATH })

  assert.equal(submitResult.success, true, JSON.stringify(submitResult))
  assert.equal(submitResult.meta.action, 'next_phase')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].api, 'mtop.taobao.qn.copilot.image.generate.video.submit')
  assert.equal(submitResult.meta.shared.results[0].提交任务ID, 'task-001')
  assert.equal(submitResult.meta.shared.results[0].执行结果, '提交成功')
})

test('search recommend normalizes rows from root folder and validates required fields', async () => {
  const helpers = await loadSearchRecommendExports()
  const parsed = helpers.normalizeJobs([
    { 商品ID: 'https://item.taobao.com/item.htm?id=1051467606993', 素材张数: '3', 添加标题: '短标', 内容描述: '短描述', 裁剪比例: '1:1' },
    { 商品ID: '776047586897', 素材图片: '/tmp/01.jpg;/tmp/02.jpg;/tmp/03.jpg', 添加标题: '超长标题超长标题超长标题超长标题超长标题啊', 内容描述: '描述'.repeat(501) },
  ], {
    materialRoot: '/Users/test/搜推素材',
    defaultMaterialCount: 3,
  })

  assert.equal(parsed.jobs.length, 1)
  assert.equal(parsed.jobs[0].productId, '1051467606993')
  assert.equal(parsed.jobs[0].materialSource, '素材根目录')
  assert.deepEqual(plain(parsed.jobs[0].materialRefs), [
    '/Users/test/搜推素材/1051467606993/01.jpg',
    '/Users/test/搜推素材/1051467606993/02.jpg',
    '/Users/test/搜推素材/1051467606993/03.jpg',
  ])
  assert.equal(parsed.jobs[0].title, '短标')
  assert.equal(parsed.jobs[0].description, '短描述')
  assert.equal(parsed.jobs[0].cropRatio, '1:1')
  assert.equal(parsed.invalidRows.length, 1)
  assert.match(parsed.invalidRows[0].备注, /添加标题最多 20 个字符/)
  assert.match(parsed.invalidRows[0].备注, /内容描述最多 1000 个字符/)
})

test('search recommend accepts merchant code and builds root material paths by merchant code', async () => {
  const helpers = await loadSearchRecommendExports()
  const parsed = helpers.normalizeJobs([
    { 商家编码: '455133A2114Z', 素材张数: '3', 添加标题: '短标', 内容描述: '短描述' },
  ], {
    materialRoot: '/Users/test/搜推素材',
    defaultMaterialCount: 3,
  })

  assert.equal(parsed.invalidRows.length, 0, JSON.stringify(parsed.invalidRows))
  assert.equal(parsed.jobs.length, 1)
  assert.equal(parsed.jobs[0].productId, '')
  assert.equal(parsed.jobs[0].merchantCode, '455133A2114Z')
  assert.deepEqual(plain(parsed.jobs[0].materialRefs), [
    '/Users/test/搜推素材/455133A2114Z/01.jpg',
    '/Users/test/搜推素材/455133A2114Z/02.jpg',
    '/Users/test/搜推素材/455133A2114Z/03.jpg',
  ])
  assert.equal(parsed.jobs[0].materialSource, '素材根目录')
})

test('search recommend uses KOC main image package listing by merchant code', async () => {
  const helpers = await loadSearchRecommendExports()
  const listing = kocListing()
  const parsed = helpers.normalizeJobs([
    { 商家编码: '655230Q5904Z', 素材张数: '3', 添加标题: '短标', 内容描述: '短描述' },
  ], {
    materialRoot: listing.root,
    materialRootFiles: listing,
    defaultMaterialCount: 3,
  })

  assert.equal(parsed.invalidRows.length, 0, JSON.stringify(parsed.invalidRows))
  assert.equal(parsed.jobs.length, 2)
  assert.equal(parsed.jobs[0].materialSource, '达人图包主图')
  assert.equal(parsed.jobs[0].creator, 'Sia')
  assert.equal(parsed.jobs[1].creator, 'Tina')
  assert.deepEqual(plain(parsed.jobs[0].materialRefs), [
    `${listing.root}/MOP连衣裙套装655230Q5904Z/图片/主图/Sia/01.jpg`,
    `${listing.root}/MOP连衣裙套装655230Q5904Z/图片/主图/Sia/02.png`,
    `${listing.root}/MOP连衣裙套装655230Q5904Z/图片(1)/主图/Sia/03.webp`,
  ])
  assert.deepEqual(plain(parsed.jobs[1].materialRefs), [
    `${listing.root}/MOP连衣裙套装655230Q5904Z/图片/主图/Tina/01.jpg`,
    `${listing.root}/MOP连衣裙套装655230Q5904Z/图片/主图/Tina/02.jpg`,
    `${listing.root}/MOP连衣裙套装655230Q5904Z/图片/主图/Tina/03.jpg`,
  ])
})

test('search recommend duplicate merchant rows map to different KOC creators and keep row copy', async () => {
  const helpers = await loadSearchRecommendExports()
  const listing = kocListing()
  const parsed = helpers.normalizeJobs([
    { 商家编码: '655230Q5904Z', 素材张数: '3', 添加标题: '标题一', 内容描述: '描述一'.repeat(20), 裁剪比例: '3:4' },
    { 商家编码: '655230Q5904Z', 素材张数: '3', 添加标题: '标题二', 内容描述: '描述二'.repeat(20), 裁剪比例: '1:1' },
  ], {
    materialRoot: listing.root,
    materialRootFiles: listing,
    defaultMaterialCount: 3,
  })

  assert.equal(parsed.invalidRows.length, 0, JSON.stringify(parsed.invalidRows))
  assert.equal(parsed.jobs.length, 2)
  assert.equal(parsed.jobs[0].creator, 'Sia')
  assert.equal(parsed.jobs[0].title, '标题一')
  assert.equal(parsed.jobs[0].cropRatio, '3:4')
  assert.equal(parsed.jobs[1].creator, 'Tina')
  assert.equal(parsed.jobs[1].title, '标题二')
  assert.equal(parsed.jobs[1].cropRatio, '1:1')
  assert.deepEqual(plain(parsed.jobs[1].materialRefs), [
    `${listing.root}/MOP连衣裙套装655230Q5904Z/图片/主图/Tina/01.jpg`,
    `${listing.root}/MOP连衣裙套装655230Q5904Z/图片/主图/Tina/02.jpg`,
    `${listing.root}/MOP连衣裙套装655230Q5904Z/图片/主图/Tina/03.jpg`,
  ])
})

test('search recommend accepts excel time-like crop ratio values', async () => {
  const helpers = await loadSearchRecommendExports()

  assert.equal(helpers.parseCropRatio('03:04:00'), '3:4')
  assert.equal(helpers.parseCropRatio('01:01:00'), '1:1')
  assert.equal(helpers.parseCropRatio((3 * 60 + 4) / 1440), '3:4')

  const parsed = helpers.normalizeJobs([
    validSearchRecommendRow({ 裁剪比例: '03:04:00' }),
  ])
  assert.equal(parsed.jobs.length, 1)
  assert.equal(parsed.jobs[0].cropRatio, '3:4')
})

test('search recommend auto crops ali cdn material urls with page crop syntax', async () => {
  const helpers = await loadSearchRecommendExports()
  const url = 'https://img.alicdn.com/imgextra/i4/2652460556/O1CN01Hfg7jt1FyhMEbzuCn_!!4611686018427385356-0-item_pic.jpg'
  const cropped = await helpers.autoCropMaterial({ ref: 'remote', url, width: 1440, height: 1440 }, '3:4')

  assert.equal(cropped.cropRatio, '3:4')
  assert.equal(cropped.cropStatus, 'center-cropped')
  assert.equal(cropped.width, 1080)
  assert.equal(cropped.height, 1440)
  assert.match(cropped.url, /~crop,180,0,1080,1440~_!!/)
  assert.equal(cropped.originalUrl, url)
})

test('search recommend plan mode returns preview rows without page APIs', async () => {
  const result = await runSearchRecommendAdapter({
    params: {
      execute_mode: 'plan',
      input_file: { rows: [validSearchRecommendRow()] },
    },
  })

  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].执行结果, '预检通过')
  assert.match(result.data[0].备注, /计划发布 3 张图片/)
})

test('search recommend live process_row injects current row local images', async () => {
  const appended = []
  const document = {
    querySelector(selector) {
      return appended.find(item => item.id === selector.replace(/^#/, '')) || null
    },
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        style: {},
        attrs: {},
        setAttribute(key, value) { this.attrs[key] = value },
      }
    },
    body: {
      appendChild(input) {
        appended.push(input)
      },
    },
    documentElement: {
      appendChild(input) {
        appended.push(input)
      },
    },
  }

  const result = await runSearchRecommendAdapter({
    params: {
      execute_mode: 'live',
      input_file: { rows: [validSearchRecommendRow()] },
    },
    contextExtra: { document },
  })

  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'process_row')

  const processResult = await runSearchRecommendAdapter({
    phase: 'process_row',
    shared: result.meta.shared,
    contextExtra: { document },
  })

  assert.equal(processResult.success, true, JSON.stringify(processResult))
  assert.equal(processResult.meta.action, 'inject_files')
  assert.equal(processResult.meta.next_phase, 'process_row')
  assert.equal(processResult.meta.items[0].selector, '#crawshrimp-mop-search-recommend-material-input')
  assert.deepEqual(plain(processResult.meta.items[0].files), [
    '/Users/test/搜推/1051467606993/01.jpg',
    '/Users/test/搜推/1051467606993/02.jpg',
    '/Users/test/搜推/1051467606993/03.jpg',
  ])
  assert.equal(appended[0].multiple, true)
})

test('search recommend live process_row resolves merchant code before injecting local images', async () => {
  const appended = []
  const calls = []
  const document = {
    querySelector(selector) {
      return appended.find(item => item.id === selector.replace(/^#/, '')) || null
    },
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        style: {},
        attrs: {},
        setAttribute(key, value) { this.attrs[key] = value },
      }
    },
    body: {
      appendChild(input) {
        appended.push(input)
      },
    },
    documentElement: {
      appendChild(input) {
        appended.push(input)
      },
    },
  }

  const result = await runSearchRecommendAdapter({
    params: {
      execute_mode: 'live',
      material_root: '/Users/test/搜推素材',
      input_file: {
        rows: [{ 商家编码: '455133A2114Z', 素材张数: '3', 添加标题: '短标', 内容描述: '短描述' }],
      },
    },
    contextExtra: { document },
  })

  const processResult = await runSearchRecommendAdapter({
    phase: 'process_row',
    shared: result.meta.shared,
    contextExtra: {
      document,
      windowExtras: {
        lib: {
          mtop: {
            async request(payload) {
              calls.push(payload)
              if (payload.api === 'mtop.tmall.sell.pc.manage.async') {
                return {
                  ret: ['SUCCESS::调用成功'],
                  data: {
                    result: JSON.stringify({
                      success: true,
                      data: {
                        table: {
                          dataSource: [{
                            itemId: '895505849990',
                            itemDesc: {
                              img: '//img.example/item.jpg',
                              desc: [
                                { text: '亚麻连衣裙', copyText: '亚麻连衣裙' },
                                { text: 'ID:895505849990', copyText: '895505849990' },
                                { text: ' 编码:455133A2114Z' },
                              ],
                            },
                          }],
                        },
                      },
                    }),
                  },
                }
              }
              return { ret: ['SUCCESS::调用成功'], data: { result: {} } }
            },
          },
        },
      },
    },
  })

  assert.equal(processResult.success, true, JSON.stringify(processResult))
  assert.equal(processResult.meta.action, 'inject_files')
  assert.equal(processResult.meta.next_phase, 'process_row')
  assert.equal(processResult.meta.shared.jobs[0].productId, '895505849990')
  assert.equal(processResult.meta.shared.jobs[0].merchantCode, '455133A2114Z')
  assert.equal(processResult.meta.shared.current_buyer_id, '895505849990')
  assert.deepEqual(plain(processResult.meta.items[0].files), [
    '/Users/test/搜推素材/455133A2114Z/01.jpg',
    '/Users/test/搜推素材/455133A2114Z/02.jpg',
    '/Users/test/搜推素材/455133A2114Z/03.jpg',
  ])
  assert.equal(JSON.parse(calls[0].data.jsonBody).filter.queryOuterId, '455133A2114Z')
})

test('search recommend builds page-matched publish payload', async () => {
  const helpers = await loadSearchRecommendExports()
  const job = helpers.normalizeJobs([validSearchRecommendRow({
    素材图片: 'https://img.example/01.jpg;https://img.example/02.jpg;https://img.example/03.jpg',
  })]).jobs[0]
  const materials = [
    { ref: '01', url: 'https://img.example/01.jpg', width: 1440, height: 1920 },
    { ref: '02', url: 'https://img.example/02.jpg', width: 1440, height: 1920 },
    { ref: '03', url: 'https://img.example/03.jpg', width: 1440, height: 1920 },
  ]
  const payload = helpers.buildPublishPayload(job, {
    itemId: job.productId,
    title: '测试商品标题',
    picUrl: 'https://img.example/item.jpg',
  }, materials, { requestId: 'req-001' })
  const request = JSON.parse(payload.data.request)

  assert.equal(payload.api, 'mtop.taobao.spongebob.item.material.publish')
  assert.equal(request.contentType, 'article')
  assert.equal(request.bizCode, 's_upload_feeds')
  assert.equal(request.ugcScene, 'qn_material_manager')
  assert.equal(request.requestId, 'req-001')
  assert.equal(decodeURIComponent(request.shortTitle), job.title)
  assert.equal(decodeURIComponent(request.title), job.description)
  assert.equal(request.pics.length, 3)
  assert.equal(request.coverPic.url, 'https://img.example/01.jpg')
  assert.equal(request.items[0].itemId, job.productId)
  assert.equal(request.items[0].source, 'selfShop')
  assert.equal(request.publishExtra.is_rcmd_publisher, '1')
  assert.equal(request.publishExtra.post_channel, 'normal')
})

test('search recommend submit phase calls publish API and records content id', async () => {
  const helpers = await loadSearchRecommendExports()
  const job = helpers.normalizeJobs([validSearchRecommendRow({
    素材图片: 'https://img.example/01.jpg;https://img.example/02.jpg;https://img.example/03.jpg',
  })]).jobs[0]
  const activeJob = {
    ...job,
    item: { itemId: job.productId, title: '测试商品标题', picUrl: 'https://img.example/item.jpg' },
    resolvedMaterials: [
      { ref: '01', url: 'https://img.example/01.jpg' },
      { ref: '02', url: 'https://img.example/02.jpg' },
      { ref: '03', url: 'https://img.example/03.jpg' },
    ],
  }
  const calls = []
  const shared = {
    ...helpers.buildRunShared([job], { executeMode: 'live' }),
    active_job: activeJob,
  }

  const result = await runSearchRecommendAdapter({
    phase: 'submit_job',
    shared,
    contextExtra: {
      windowExtras: {
        lib: {
          mtop: {
            async request(payload) {
              calls.push(payload)
              return { ret: ['SUCCESS::调用成功'], data: { contentId: 'content-001' } }
            },
          },
        },
      },
    },
  })

  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].api, 'mtop.taobao.spongebob.item.material.publish')
  assert.equal(result.meta.shared.results[0].执行结果, '发布成功')
  assert.equal(result.meta.shared.results[0].发布内容ID, 'content-001')
})
