import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/mop-ops-assistant/kol-material-img2video-batch.js')
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8')
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
  assert.match(parsed.invalidRows[0].备注, /商品ID必填/)
  assert.match(parsed.invalidRows[1].备注, /扩展名不支持/)
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
  assert.equal(manifestText.includes('file: templates/kol-material-img2video-template.xlsx'), true)
  assert.equal(manifestText.includes('id: export_video_template_catalog'), false)
  assert.equal(manifestText.includes('模板ID'), false)
  assert.equal(manifestText.includes('生成模式'), false)
  assert.equal(fs.existsSync(path.resolve('adapters/mop-ops-assistant/templates/kol-material-img2video-template.xlsx')), true)
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
