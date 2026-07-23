import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/bala-ai-video-assistant/short-video-batch-upload.js')
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8')

async function runAdapter({ params = {}, phase = 'main', shared = {}, exportsBox = null, contextExtra = {} } = {}) {
  const windowObject = {
    __CRAWSHRIMP_PARAMS__: params,
    __CRAWSHRIMP_PHASE__: phase,
    __CRAWSHRIMP_SHARED__: shared,
    ...(exportsBox ? { __CRAWSHRIMP_EXPORTS__: exportsBox } : {}),
    ...(contextExtra.window || {}),
  }
  const context = {
    window: windowObject,
    document: contextExtra.document || {},
    location: contextExtra.location || { href: 'https://huodong.taobao.com/wow/z/guang/gg_publish/gg-video' },
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
    URL,
    URLSearchParams,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    Error,
    encodeURIComponent,
    decodeURIComponent,
  }
  context.globalThis = context
  return await vm.runInNewContext(SCRIPT_SOURCE, context, { filename: SCRIPT_PATH })
}

async function loadExports(contextExtra = {}) {
  const exportsBox = {}
  await runAdapter({ phase: '__exports__', exportsBox, contextExtra })
  return exportsBox
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function inputRow(overrides = {}) {
  return {
    款号: '208326133201',
    ID: '1027640116164',
    视频标题: '新生儿贴身衣，认准新疆棉A类',
    视频描述: '新手妈妈看过来，给新生儿挑贴身衣，面料真的不能将就。这套小云朵连体衣柔软透气，贴身穿更放心。',
    参与活动: '',
    '定时/日': '2026-07-30 00:00:00',
    '定时/具体时间': '18:00:00',
    上传情况: '',
    内容ID: '',
    ...overrides,
  }
}

test('short video upload parses the reference template and Shanghai schedule', async () => {
  const helpers = await loadExports()
  const parsed = helpers.normalizeJobs({
    input_file: { rows: [inputRow()] },
    video_override_path: '/Users/test/6ec7e3d213229297.mp4',
    publish_guang: true,
    publish_recommend: true,
    bind_product: true,
  })

  assert.equal(parsed.invalidRows.length, 0)
  assert.equal(parsed.jobs.length, 1)
  assert.equal(parsed.jobs[0].style_code, '208326133201')
  assert.equal(parsed.jobs[0].item_id, '1027640116164')
  assert.equal(parsed.jobs[0].video_path, '/Users/test/6ec7e3d213229297.mp4')
  assert.equal(parsed.jobs[0].schedule_at, 1785405600000)
  assert.equal(helpers.parseScheduleTimestamp('2026/07/30', '18:00'), 1785405600000)
})

test('short video upload matches one video by exact style-code stem', async () => {
  const helpers = await loadExports()
  const pathValue = helpers.matchVideoPath('208326133201', {
    video_dir_files: {
      paths: [
        '/Users/test/videos/208326133201.mp4',
        '/Users/test/videos/208326133202.mp4',
      ],
    },
  })

  assert.equal(pathValue, '/Users/test/videos/208326133201.mp4')
})

test('short video upload plan mode returns all three planned entry states', async () => {
  const result = await runAdapter({
    params: {
      execute_mode: 'plan',
      input_file: { rows: [inputRow()] },
      video_override_path: '/Users/test/6ec7e3d213229297.mp4',
      publish_guang: true,
      publish_recommend: true,
      bind_product: true,
    },
  })

  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].上传情况, '预检通过')
  assert.equal(result.data[0].光合发布状态, '计划发布')
  assert.equal(result.data[0].搜推素材状态, '计划发布')
  assert.equal(result.data[0].商品视频绑定状态, '计划替换宝贝展示并提交')
  assert.match(result.data[0].备注, /1785405600000/)
})

test('short video upload blocks invalid title and missing video before live changes', async () => {
  const helpers = await loadExports()
  const parsed = helpers.normalizeJobs({
    input_file: { rows: [inputRow({ 视频标题: '这是一个明显超过二十个汉字限制的搜推素材标题不能发布' })] },
  })

  assert.equal(parsed.jobs.length, 0)
  assert.equal(parsed.invalidRows.length, 1)
  assert.equal(parsed.invalidRows[0].上传情况, '预检失败')
  assert.match(parsed.invalidRows[0].备注, /20字限制/)
})

test('short video upload extracts publish content id and platform error from captured bodies', async () => {
  const helpers = await loadExports()
  const successCapture = {
    matches: [{
      body: 'mtopjsonp1({"ret":["SUCCESS::调用成功"],"data":{"model":{"contentId":"582345678901"}}})',
    }],
  }
  const failedCapture = {
    matches: [{
      body: '{"ret":["FAIL_BIZ_DUPLICATE::视频重复"],"data":{"message":"内容重复"}}',
    }],
  }

  assert.equal(helpers.extractContentIdFromCapture(successCapture), '582345678901')
  assert.equal(helpers.extractContentId({ ret: ['SUCCESS::调用成功'], data: 1936378810096513 }), '1936378810096513')
  assert.equal(helpers.extractCaptureError(successCapture), '')
  assert.match(helpers.extractCaptureError(failedCapture), /FAIL_BIZ_DUPLICATE|内容重复/)
})

test('short video upload keeps the Excel description and uses API submission paths', async () => {
  const helpers = await loadExports()
  const description = inputRow().视频描述
  const parsed = helpers.normalizeJobs({
    input_file: { rows: [inputRow()] },
    video_override_path: '/Users/test/6ec7e3d213229297.mp4',
  })

  assert.equal(parsed.jobs[0].description, description)
  assert.match(SCRIPT_SOURCE, /setDescriptionEditorValue\(job\.description,\s*scene === 'qn_material_manager'\)/)
  assert.match(SCRIPT_SOURCE, /mtop\.taobao\.media\.guang\.pcPublish\.publish/)
  assert.match(SCRIPT_SOURCE, /mtop\.taobao\.spongebob\.item\.material\.publish/)
  assert.match(SCRIPT_SOURCE, /POST \/tmall\/submit\.htm/)
  assert.match(SCRIPT_SOURCE, /buildDirectPublishRequest/)
  assert.match(SCRIPT_SOURCE, /buildProductSubmitRequest/)
  assert.match(SCRIPT_SOURCE, /pageState\.submit/)
  assert.doesNotMatch(SCRIPT_SOURCE, /capture_click_requests/)
  assert.doesNotMatch(SCRIPT_SOURCE, /button\.click\(\)/)
  assert.doesNotMatch(SCRIPT_SOURCE, /memoizedProps\?\.onClick/)
  assert.doesNotMatch(SCRIPT_SOURCE, /window\.fetch/)
  assert.doesNotMatch(SCRIPT_SOURCE, /captureOfficialPublishRequest/)
  assert.doesNotMatch(SCRIPT_SOURCE, /captureProductSubmitRequest/)
})

test('short video upload produces the platform MD5 publish token without a click handler', async () => {
  const helpers = await loadExports()
  assert.equal(helpers.md5Hex('abc'), '900150983cd24fb0d6963f7d28e17f72')
  assert.equal(helpers.md5Hex('中文'), 'a7bac2239fcdcb3a067903d8077c4a07')
})

test('short video upload builds a product display video without replacing lecture video', async () => {
  const helpers = await loadExports()
  const value = helpers.buildDisplayVideo({
    contentId: 582345678901,
    id: 582345678901,
    snapshot: 'https://img.example.com/cover.jpg',
    aspectRatio: '3:4',
    width: 1248,
    height: 1664,
    playUrl: 'http://cloud.video.taobao.com/play/u/null/p/1/e/6/t/1/582345678901.mp4',
    length: 10,
  })

  assert.deepEqual(plain(value), {
    videoId: 582345678901,
    videoInfo: {
      mainPicUrl: 'https://img.example.com/cover.jpg',
      videoId: 582345678901,
      sceneCode: 'auctionVideos',
      sceneName: 'auctionVideos',
      width: 1248,
      height: 1664,
      videoRadio: '3:4',
      videoRatio: '3:4',
      videoUrl: 'http://cloud.video.taobao.com/play/u/null/p/1/e/6/t/1/582345678901.mp4',
      duration: 10,
    },
    videoType: '宝贝展示',
    status: 0,
    empty: false,
  })
})

test('short video upload finds the product page-owned submit API without a click handler', async () => {
  const pageState = { submit() {} }
  const helpers = await loadExports({
    window: {
      __SELL_STATE__: {
        getState() {
          return {
            engine: {
              _engine: {
                _core: {
                  _pluginCenter: {
                    plugins: [{ app: {} }, { app: { pageState } }],
                  },
                },
              },
            },
          }
        },
      },
    },
  })

  assert.equal(helpers.findSellPageState(), pageState)
  assert.deepEqual(
    plain(helpers.productSubmitErrorMessages({
      formError: {
        title: { message: [{ msg: '商品标题为必填项，不能为空' }] },
      },
    })),
    ['商品标题为必填项，不能为空'],
  )
})
