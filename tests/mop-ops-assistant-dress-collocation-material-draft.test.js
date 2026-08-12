import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/mop-ops-assistant/dress-collocation-material-draft.js')
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8')
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
    location: contextExtra.location || { href: 'https://qn.taobao.com/home.htm/qianniu_dress_collocation/create?id=409527360556' },
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
    URL,
    URLSearchParams,
    Event: contextExtra.Event || class Event {
      constructor(type) {
        this.type = type
      }
    },
    FileReader: contextExtra.FileReader,
    Image: contextExtra.Image,
    fetch: contextExtra.fetch,
  }
  context.globalThis = context
  return await vm.runInNewContext(SCRIPT_SOURCE, context, { filename: SCRIPT_PATH })
}

async function loadExports(contextExtra = {}) {
  const exportsBox = {}
  await runAdapter({ phase: '__exports__', contextExtra: { ...contextExtra, exportsBox } })
  return exportsBox
}

test('normalizes user-provided product IDs and current draft id', async () => {
  const helpers = await loadExports()
  const job = helpers.normalizeJob({
    product_ids: '1057386891909\n1060933035333\n1057386891909',
    title: 'MOP桑蚕丝混纺牛仔套装',
    description: '莫代尔棉桑蚕丝牛仔叠穿马甲套装，为造型增添丹宁的率性质感',
    material_images: [{ path: '/tmp/look.png' }],
  })
  assert.deepEqual(Array.from(job.productIds), ['1057386891909', '1060933035333'])
  assert.equal(job.draftId, '409527360556')
  assert.equal(helpers.validateJob(job).length, 0)
})

test('safe 3:4 plan keeps the complete foreground image instead of center-cropping', async () => {
  const helpers = await loadExports()
  const wide = helpers.buildSafeThreeFourPlan(1600, 900)
  assert.equal(wide.targetWidth, 750)
  assert.equal(wide.targetHeight, 1000)
  assert.equal(wide.mode, 'contain-with-soft-background')
  assert.equal(wide.preservesFullSubject, true)
  assert.equal(wide.drawWidth, 750)
  assert.ok(wide.pads.top > 0)

  const tall = helpers.buildSafeThreeFourPlan(750, 1400)
  assert.equal(tall.drawHeight, 1000)
  assert.ok(tall.pads.left > 0)
  assert.equal(tall.preservesFullSubject, true)
})

test('plan mode reports draft-only safe crop without requesting upload', async () => {
  const result = await runAdapter({
    params: {
      execute_mode: 'plan',
      product_ids: '1057386891909\n1060933035333',
      title: 'MOP桑蚕丝混纺牛仔套装',
      description: '莫代尔棉桑蚕丝牛仔叠穿马甲套装，为造型增添丹宁的率性质感',
      material_images: ['/tmp/look.png'],
    },
  })
  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.data[0].执行结果, '预检通过')
  assert.match(result.data[0].备注, /保存草稿，不发布/)
})

test('publish plan mode reports real publish intent without submitting', async () => {
  const document = {
    querySelectorAll(selector) {
      if (selector === 'img') return []
      return []
    },
    body: { appendChild() {}, innerText: '' },
    documentElement: {},
  }
  const result = await runAdapter({
    params: {
      execute_mode: 'live_publish',
      product_ids: '1057386891909\n1060933035333',
      title: 'MOP桑蚕丝混纺牛仔套装',
      description: '莫代尔棉桑蚕丝牛仔叠穿马甲套装，为造型增添丹宁的率性质感',
      material_images: ['/tmp/look.png'],
    },
    contextExtra: { document },
  })
  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'prepare_image_files')
  assert.equal(result.meta.next_phase, 'api_upload_materials')
  assert.equal(result.meta.shared.job.executeMode, 'live_publish')
})

test('live mode prepares local image before API-first upload', async () => {
  const document = {
    querySelectorAll(selector) {
      if (selector === 'img') return []
      return []
    },
    body: { appendChild() {}, innerText: '' },
    documentElement: {},
  }
  const result = await runAdapter({
    params: {
      execute_mode: 'live',
      product_ids: '1057386891909\n1060933035333',
      title: 'MOP桑蚕丝混纺牛仔套装',
      description: '莫代尔棉桑蚕丝牛仔叠穿马甲套装，为造型增添丹宁的率性质感',
      material_images: ['/tmp/look.png'],
    },
    contextExtra: { document },
  })
  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'prepare_image_files')
  assert.equal(result.meta.next_phase, 'api_upload_materials')
  assert.equal(result.meta.items.length, 1)
  assert.equal(result.meta.items[0].path, '/tmp/look.png')
})

test('API upload phase posts prepared data URL through current qn target', async () => {
  const result = await runAdapter({
    phase: 'api_upload_materials',
    shared: {
      job: {
        productIds: ['1057386891909', '1060933035333'],
        title: 'MOP桑蚕丝混纺牛仔套装',
        description: '莫代尔棉桑蚕丝牛仔叠穿马甲套装，为造型增添丹宁的率性质感',
        materialRefs: ['/tmp/look.png'],
        draftId: '409527360556',
        anchors: [],
      },
      prepared_image_files: {
        ok: true,
        items: [{
          success: true,
          sourcePath: '/tmp/look.png',
          path: '/tmp/look-3x4-safe.jpg',
          name: 'look-3x4-safe.jpg',
          mime: 'image/jpeg',
          dataUrl: 'data:image/jpeg;base64,AAAA',
          width: 750,
          height: 1000,
          cropStatus: 'matched',
          preservesFullSubject: true,
        }],
      },
    },
  })
  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'cdp_target_eval')
  assert.equal(result.meta.next_phase, 'apply_api_upload_result')
  assert.equal(result.meta.shared_key, 'api_upload_result')
  assert.deepEqual(Array.from(result.meta.target_url_contains), ['qn.taobao.com'])
  assert.match(result.meta.expression, /stream-upload\.taobao\.com\/api\/upload\.api/)
  assert.match(result.meta.expression, /FormData/)
  assert.match(result.meta.expression, /credentials: 'include'/)
})

test('API upload result is accepted as the real local material', async () => {
  const result = await runAdapter({
    phase: 'apply_api_upload_result',
    shared: {
      job: {
        productIds: ['1057386891909', '1060933035333'],
        title: 'MOP桑蚕丝混纺牛仔套装',
        description: '莫代尔棉桑蚕丝牛仔叠穿马甲套装，为造型增添丹宁的率性质感',
        materialRefs: ['/tmp/look.png'],
        draftId: '409527360556',
        anchors: [],
      },
      prepared_image_files: {
        ok: true,
        items: [{
          success: true,
          sourcePath: '/tmp/look.png',
          path: '/tmp/look-3x4-safe.jpg',
          width: 750,
          height: 1000,
          cropStatus: 'matched',
          preservesFullSubject: true,
        }],
      },
      api_upload_result: {
        ok: true,
        value: {
          ok: true,
          uploaded: [{
            ref: '/tmp/look.png',
            url: 'https://img.alicdn.com/imgextra/i1/2652460556/O1CN01api.jpg',
            width: 750,
            height: 1000,
            cropStatus: 'matched',
            fileId: '123',
            source: 'local-upload-api-stream-upload',
          }],
          errors: [],
        },
      },
    },
  })
  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'save_draft')
  assert.equal(result.meta.shared.materials[0].source, 'local-upload-api-stream-upload')
  assert.equal(result.meta.shared.materials[0].url, 'https://img.alicdn.com/imgextra/i1/2652460556/O1CN01api.jpg')
})

test('API upload result routes publish mode to publish_content phase', async () => {
  const result = await runAdapter({
    phase: 'apply_api_upload_result',
    shared: {
      job: {
        productIds: ['1057386891909', '1060933035333'],
        title: 'MOP桑蚕丝混纺牛仔套装',
        description: '莫代尔棉桑蚕丝牛仔叠穿马甲套装，为造型增添丹宁的率性质感',
        materialRefs: ['/tmp/look.png'],
        draftId: '409527360556',
        executeMode: 'live_publish',
        anchors: [],
      },
      prepared_image_files: {
        ok: true,
        items: [{
          success: true,
          sourcePath: '/tmp/look.png',
          path: '/tmp/look-3x4-safe.jpg',
          width: 750,
          height: 1000,
          cropStatus: 'matched',
          preservesFullSubject: true,
        }],
      },
      api_upload_result: {
        ok: true,
        value: {
          ok: true,
          uploaded: [{
            ref: '/tmp/look.png',
            url: 'https://img.alicdn.com/imgextra/i1/2652460556/O1CN01api.jpg',
            width: 750,
            height: 1000,
            cropStatus: 'matched',
            fileId: '123',
            source: 'local-upload-api-stream-upload',
          }],
          errors: [],
        },
      },
    },
  })
  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'publish_content')
})

test('open selector phase prefers anchor dialog replace image button when dialog is already open', async () => {
  const replaceButton = {
    tagName: 'BUTTON',
    innerText: '更换搭配图片',
    textContent: '更换搭配图片',
    getAttribute(name) { return name === 'role' ? null : '' },
    getBoundingClientRect() { return { x: 409, y: 655, width: 116, height: 36 } },
  }
  const addCard = {
    tagName: 'DIV',
    innerText: '添加搭配图',
    textContent: '添加搭配图',
    getAttribute() { return '' },
    getBoundingClientRect() { return { x: 1047, y: 368, width: 128, height: 183 } },
  }
  const document = {
    querySelectorAll(selector) {
      if (selector === 'button,[role=button],a') return [replaceButton]
      if (selector === 'button,[role=button],a,div,span') return [addCard, replaceButton]
      return []
    },
    body: { innerText: '' },
    documentElement: {},
  }
  const result = await runAdapter({
    phase: 'open_material_selector',
    shared: {
      job: {
        productIds: ['1057386891909', '1060933035333'],
        title: 'MOP桑蚕丝混纺牛仔套装',
        description: '莫代尔棉桑蚕丝牛仔叠穿马甲套装，为造型增添丹宁的率性质感',
        materialRefs: ['/tmp/look.png'],
        draftId: '409527360556',
        anchors: [],
      },
    },
    contextExtra: { document },
  })
  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'cdp_clicks')
  assert.equal(result.meta.next_phase, 'open_local_upload_panel')
  assert.equal(result.meta.clicks.length, 1)
  assert.equal(result.meta.clicks[0].x, 467)
  assert.equal(result.meta.clicks[0].y, 673)
})

test('draftScu payload updates draft fields and never publishes', async () => {
  const helpers = await loadExports()
  const job = helpers.normalizeJob({
    product_ids: '1057386891909\n1060933035333',
    title: 'MOP桑蚕丝混纺牛仔套装',
    description: '莫代尔棉桑蚕丝牛仔叠穿马甲套装，为造型增添丹宁的率性质感',
    material_images: ['/tmp/look.png'],
    draft_id: '409527360556',
  })
  const payload = helpers.buildDraftScuPayload(
    {
      scuId: '409527360556',
      status: 0,
      normalImgList: [{ imgUrl: 'https://img.alicdn.com/old.jpg', anchors: [] }],
      itemList: [{ itemId: '1057386891909', coverUrl: 'https://gw.alicdn.com/a.jpg', title: '桑蚕丝牛仔马甲' }],
      displayChannels: [1, 6, 7],
    },
    job,
    [{ url: 'https://img.alicdn.com/imgextra/look.jpg', width: 750, height: 1000 }],
  )
  const text = JSON.stringify(payload)
  assert.match(text, /409527360556/)
  assert.match(text, /1057386891909/)
  assert.match(text, /1060933035333/)
  assert.match(text, /https:\/\/img\.alicdn\.com\/imgextra\/look\.jpg/)
  assert.equal(payload.displayType, 3)
  assert.equal(payload.normalImgList[0].imgUrl, 'https://img.alicdn.com/imgextra/look.jpg')
  assert.doesNotMatch(text, /publish|发布内容|发布成功/)
})

test('publish phase calls preCheck then createScu and reads back published content', async () => {
  const document = {
    body: { innerText: '发布成功 MOP桑蚕丝混纺牛仔套装' },
    documentElement: {},
    querySelector() { return null },
    querySelectorAll() { return [] },
  }
  const fetchCalls = []
  const fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options })
    if (String(url).includes('/queryById')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          success: true,
          data: {
            scuId: String(url).includes('509') ? '509000001' : '409527360556',
            title: 'MOP桑蚕丝混纺牛仔套装',
            name: 'MOP桑蚕丝混纺牛仔套装',
            description: '莫代尔棉桑蚕丝牛仔叠穿马甲套装，为造型增添丹宁的率性质感',
            normalImgList: [{ imgUrl: 'https://img.alicdn.com/imgextra/i1/2652460556/O1CN01new.png' }],
            itemList: [{ itemId: '1057386891909' }, { itemId: '1060933035333' }],
          },
        }),
      }
    }
    if (String(url).includes('/preCheck')) {
      return { ok: true, text: async () => JSON.stringify({ success: true, data: { success: true } }) }
    }
    if (String(url).includes('/createScu')) {
      return { ok: true, text: async () => JSON.stringify({ success: true, data: { success: true, data: '509000001' } }) }
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const result = await runAdapter({
    phase: 'publish_content',
    shared: {
      job: {
        productIds: ['1057386891909', '1060933035333'],
        title: 'MOP桑蚕丝混纺牛仔套装',
        description: '莫代尔棉桑蚕丝牛仔叠穿马甲套装，为造型增添丹宁的率性质感',
        materialRefs: ['/tmp/look.png'],
        draftId: '409527360556',
        executeMode: 'live_publish',
        anchors: [],
      },
      materials: [{
        ref: 'look.png',
        url: 'https://img.alicdn.com/imgextra/i1/2652460556/O1CN01new.png',
        width: 750,
        height: 1000,
        cropStatus: 'matched',
        source: 'local-upload-api-stream-upload',
      }],
    },
    contextExtra: { document, fetch },
  })
  assert.equal(result.success, true)
  assert.equal(result.data[0].执行结果, '发布成功')
  assert.equal(result.data[0].发布内容ID, '509000001')
  assert.match(result.data[0].备注, /payload=createScu/)
  assert.ok(fetchCalls.some(call => String(call.url).includes('/api/collocate/preCheck')))
  const createCall = fetchCalls.find(call => String(call.url).includes('/api/collocate/createScu'))
  assert.ok(createCall)
  assert.match(String(createCall.options.body), /skipSameItemCheck/)
  assert.ok(fetchCalls.some(call => String(call.url).includes('/api/collocate/queryById?scuId=509000001')))
})

test('publish phase records platform business failure without claiming success', async () => {
  const fetch = async (url) => {
    if (String(url).includes('/queryById')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          success: true,
          data: {
            scuId: '409527360556',
            title: 'MOP桑蚕丝混纺牛仔套装',
            description: '莫代尔棉桑蚕丝牛仔叠穿马甲套装，为造型增添丹宁的率性质感',
            normalImgList: [{ imgUrl: 'https://img.alicdn.com/imgextra/i1/2652460556/O1CN01new.png' }],
            itemList: [{ itemId: '1057386891909' }, { itemId: '1060933035333' }],
          },
        }),
      }
    }
    if (String(url).includes('/preCheck')) {
      return { ok: true, text: async () => JSON.stringify({ success: true, data: null }) }
    }
    if (String(url).includes('/createScu')) {
      return { ok: true, text: async () => JSON.stringify({ success: false, data: null, message: '商品：1057386891909不在架', errorCode: '000002' }) }
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const result = await runAdapter({
    phase: 'publish_content',
    shared: {
      job: {
        productIds: ['1057386891909', '1060933035333'],
        title: 'MOP桑蚕丝混纺牛仔套装',
        description: '莫代尔棉桑蚕丝牛仔叠穿马甲套装，为造型增添丹宁的率性质感',
        materialRefs: ['/tmp/look.png'],
        draftId: '409527360556',
        executeMode: 'live_publish',
        anchors: [],
      },
      materials: [{
        ref: 'look.png',
        url: 'https://img.alicdn.com/imgextra/i1/2652460556/O1CN01new.png',
        width: 750,
        height: 1000,
        source: 'local-upload-api-stream-upload',
      }],
    },
    contextExtra: {
      fetch,
      document: { body: { innerText: '' }, querySelectorAll() { return [] }, querySelector() { return null }, documentElement: {} },
    },
  })
  assert.equal(result.success, true)
  assert.equal(result.data[0].执行结果, '发布失败')
  assert.equal(result.data[0].发布内容ID, '')
  assert.match(result.data[0].备注, /1057386891909不在架/)
})

test('upload helper falls back to page ImageSpaceUploader when global upload shortcut is absent', async () => {
  const document = {
    createElement() {
      return { style: {}, remove() { this.removed = true } }
    },
    body: { appendChild() {} },
    documentElement: {},
  }
  class ImageSpaceUploader {
    constructor(options) {
      this.options = options
      this.handlers = {}
    }
    on(event, handler) {
      this.handlers[event] = handler
    }
    addBase64File(dataUrl, name) {
      this.dataUrl = dataUrl
      this.name = name
    }
    start() {
      this.handlers.FileSuccess?.({ url: 'https://img.alicdn.com/imgextra/i1/mock.jpg', fileId: 'mock' })
      this.handlers.UploadComplete?.([{ url: 'https://img.alicdn.com/imgextra/i1/mock.jpg' }])
    }
    destroy() {
      this.destroyed = true
    }
  }
  const helpers = await loadExports({
    document,
    windowExtras: { ImageSpaceUploader },
  })
  const uploaded = await helpers.uploadDataUrlWithPageHelper('data:image/jpeg;base64,AAAA', 'look_3x4_safe.jpg')
  assert.equal(uploaded.url, 'https://img.alicdn.com/imgextra/i1/mock.jpg')
})

test('save phase refuses to reuse an existing compliant image when local upload was requested', async () => {
  const events = []
  const textarea1 = {
    value: '',
    disabled: false,
    dispatchEvent(event) { events.push(['title', event.type, this.value]) },
    getBoundingClientRect() { return { top: 10 } },
  }
  const textarea2 = {
    value: '',
    disabled: false,
    dispatchEvent(event) { events.push(['desc', event.type, this.value]) },
    getBoundingClientRect() { return { top: 20 } },
  }
  const image = {
    naturalWidth: 750,
    naturalHeight: 1000,
    currentSrc: 'https://img.alicdn.com/imgextra/i1/2652460556/mock.jpg',
    src: 'https://img.alicdn.com/imgextra/i1/2652460556/mock.jpg',
    alt: '打点底图',
    className: 'TaggedImageLite_backgroundImg__hrDtI',
    getBoundingClientRect() { return { x: 10, y: 10, width: 120, height: 160 } },
  }
  const saveButton = {
    disabled: false,
    innerText: '保存草稿',
    textContent: '保存草稿',
    click() { this.clicked = true },
    scrollIntoView() {},
    getBoundingClientRect() { return { x: 1, y: 2, width: 120, height: 36 } },
  }
  const document = {
    body: {
      innerText: 'MOP桑蚕丝混纺牛仔套装 莫代尔棉桑蚕丝牛仔叠穿马甲套装，为造型增添丹宁的率性质感 1057386891909 1060933035333 草稿',
      appendChild() {},
    },
    documentElement: {},
    querySelector(selector) {
      if (selector === '#crawshrimp-mop-dress-collocation-input') {
        return { files: [{ name: 'look.png' }] }
      }
      return null
    },
    querySelectorAll(selector) {
      if (selector === 'img') return [image]
      if (selector === 'textarea') return [textarea1, textarea2]
      if (selector === 'button,[role=button],a') return [saveButton]
      if (selector === 'input[type=file], input') return []
      return []
    },
  }
  const result = await runAdapter({
    phase: 'save_draft',
    shared: {
      job: {
        productIds: ['1057386891909', '1060933035333'],
        title: 'MOP桑蚕丝混纺牛仔套装',
        description: '莫代尔棉桑蚕丝牛仔叠穿马甲套装，为造型增添丹宁的率性质感',
        materialRefs: ['/tmp/look.png'],
        draftId: '409527360556',
        anchors: [],
      },
    },
    contextExtra: { document },
  })
  assert.equal(result.success, false)
  assert.match(result.error, /真实图片上传\/保存未完成/)
  assert.equal(saveButton.clicked, undefined)
  assert.equal(events.length, 0)
})

test('save phase can use material returned by sucai selector without falling back to old image', async () => {
  const textarea1 = {
    value: '',
    disabled: false,
    dispatchEvent() {},
    getBoundingClientRect() { return { top: 10 } },
  }
  const textarea2 = {
    value: '',
    disabled: false,
    dispatchEvent() {},
    getBoundingClientRect() { return { top: 20 } },
  }
  const document = {
    body: {
      innerText: 'MOP桑蚕丝混纺牛仔套装 莫代尔棉桑蚕丝牛仔叠穿马甲套装，为造型增添丹宁的率性质感 1057386891909 1060933035333 草稿',
      appendChild() {},
    },
    documentElement: {},
    querySelector() { return null },
    querySelectorAll(selector) {
      if (selector === 'textarea') return [textarea1, textarea2]
      if (selector === 'button,[role=button],a') return []
      if (selector === 'img') return []
      return []
    },
  }
  const fetchCalls = []
  const fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options })
    if (String(url).includes('/queryById')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          success: true,
          data: {
            scuId: '409527360556',
            title: 'MOP桑蚕丝混纺牛仔套装',
            name: 'MOP桑蚕丝混纺牛仔套装',
            description: '莫代尔棉桑蚕丝牛仔叠穿马甲套装，为造型增添丹宁的率性质感',
            normalImgList: [{ imgUrl: 'https://img.alicdn.com/imgextra/i1/2652460556/O1CN01new.png' }],
            itemList: [{ itemId: '1057386891909' }, { itemId: '1060933035333' }],
          },
        }),
      }
    }
    return {
      ok: true,
      text: async () => JSON.stringify({ success: true, data: { ok: true } }),
    }
  }
  const result = await runAdapter({
    phase: 'save_draft',
    shared: {
      job: {
        productIds: ['1057386891909', '1060933035333'],
        title: 'MOP桑蚕丝混纺牛仔套装',
        description: '莫代尔棉桑蚕丝牛仔叠穿马甲套装，为造型增添丹宁的率性质感',
        materialRefs: ['/tmp/look.png'],
        draftId: '409527360556',
        anchors: [],
      },
      materials: [{
        ref: 'look.png',
        url: 'https://img.alicdn.com/imgextra/i1/2652460556/O1CN01new.png',
        width: 750,
        height: 1000,
        cropStatus: 'matched',
        source: 'local-upload-sucai-selector',
      }],
    },
    contextExtra: { document, fetch },
  })
  assert.equal(result.success, true)
  assert.equal(result.data[0].执行结果, '草稿保存成功')
  assert.match(result.data[0].备注, /图片URL已读回/)
  assert.ok(fetchCalls.some(call => String(call.url).includes('/api/collocate/draftScu')))
})

test('MOP manifest declares dress collocation draft task', async () => {
  const manifest = fs.readFileSync(MANIFEST_PATH, 'utf8')
  assert.match(manifest, /id: dress_collocation_material_draft/)
  assert.match(manifest, /id: dress_collocation_material_publish/)
  assert.match(manifest, /script: dress-collocation-material-draft\.js/)
  assert.match(manifest, /MOP搭配素材草稿结果_\{timestamp\}\.xlsx/)
  assert.match(manifest, /MOP搭配素材真实发布结果_\{timestamp\}\.xlsx/)
  assert.match(manifest, /只保存草稿，不发布内容/)
  assert.match(manifest, /上传并真实发布/)
})
