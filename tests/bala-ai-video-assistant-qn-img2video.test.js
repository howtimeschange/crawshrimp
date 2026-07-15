import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/bala-ai-video-assistant/qn-img2video-batch.js')
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8')

async function loadExports(params = {}) {
  const exportsBox = {}
  const windowValue = {
    __CRAWSHRIMP_PARAMS__: params,
    __CRAWSHRIMP_PHASE__: '__exports__',
    __CRAWSHRIMP_SHARED__: {},
    __CRAWSHRIMP_EXPORTS__: exportsBox,
  }
  const context = {
    window: windowValue,
    console,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    JSON,
    Date,
    Math,
    Set,
    Map,
    parseInt,
    Error,
  }
  context.globalThis = context
  await vm.runInNewContext(SCRIPT_SOURCE, context, { filename: SCRIPT_PATH })
  return exportsBox
}

async function runScript({ params = {}, phase = 'main', shared = {}, windowOverrides = {} } = {}) {
  const windowValue = {
    __CRAWSHRIMP_PARAMS__: params,
    __CRAWSHRIMP_PHASE__: phase,
    __CRAWSHRIMP_SHARED__: shared,
    ...windowOverrides,
  }
  const context = {
    window: windowValue,
    console,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    JSON,
    Date,
    Math,
    Set,
    Map,
    parseInt,
    Error,
  }
  context.globalThis = context
  return await vm.runInNewContext(SCRIPT_SOURCE, context, { filename: SCRIPT_PATH })
}

function actionTemplate(overrides = {}) {
  return {
    templateId: 'tpl-action-001',
    name: '领口',
    type: 'action',
    ratio: '3:4',
    duration: 13,
    provider: 'content',
    coverUrl: 'https://img.example/cover.png',
    videoUrl: 'https://video.example/preview.mp4',
    inputImages: JSON.stringify([
      { code: '7', slotName: '模特全身', require: true, imageUrl: 'https://img.example/slot.png' },
    ]),
    ...overrides,
  }
}

function multiSlotTemplate(overrides = {}) {
  return {
    templateId: 'tpl-multi-001',
    name: '正反面',
    type: 'frame',
    ratio: '3:4',
    duration: 15,
    provider: 'content',
    videoUrl: 'https://video.example/multi.mp4',
    inputImages: JSON.stringify([
      { code: '0', slotName: '正面', require: true },
      { code: '1', slotName: '背面', require: true },
    ]),
    ...overrides,
  }
}

test('checkboxEnabled handles booleans, strings, arrays, and defaults', async () => {
  const helpers = await loadExports()

  assert.equal(helpers.checkboxEnabled(undefined, true), true)
  assert.equal(helpers.checkboxEnabled(undefined, false), false)
  assert.equal(helpers.checkboxEnabled(true, false), true)
  assert.equal(helpers.checkboxEnabled(false, true), false)
  assert.equal(helpers.checkboxEnabled('true', false), true)
  assert.equal(helpers.checkboxEnabled('false', true), false)
  assert.equal(helpers.checkboxEnabled(['enabled'], false), true)
  assert.equal(helpers.checkboxEnabled(['false'], true), false)

  const shared = helpers.buildRunShared([], {
    download_videos: ['enabled'],
    poll_timeout_minutes: 1,
    poll_interval_seconds: 5,
  })
  assert.equal(shared.download_videos, true)
})

test('waits for the newly opened software-manager page runtime before reading templates', async () => {
  const result = await runScript({ params: { execute_mode: 'plan' } })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'main')
  assert.equal(result.meta.sleep_ms, 1000)
  assert.equal(result.meta.shared.page_ready_attempts, 1)
})

test('preserves readable software-manager errors when the page rejects with a plain object', async () => {
  const result = await runScript({
    params: { execute_mode: 'plan' },
    windowOverrides: {
      lib: {
        mtop: {
          request: async () => {
            throw { data: { errorMsg: '商品数据无效' }, ret: ['FAIL_SYS_INVALID_DATA'] }
          },
        },
      },
    },
  })

  assert.equal(result.success, false)
  assert.match(result.error, /商品数据无效/)
})

test('normalizes local, remote, and directory images with AI result priority', async () => {
  const helpers = await loadExports()
  const refs = helpers.normalizeImageRefs({
    material_root_files: {
      paths: [
        { path: '/tmp/pkg/208326100202/01_模拍原图/source.jpg', relativePath: '208326100202/01_模拍原图/source.jpg' },
        { path: '/tmp/pkg/208326100202/AI生成图/208326100202-ai-1.png', relativePath: '208326100202/AI生成图/208326100202-ai-1.png' },
      ],
    },
    image_urls: 'https://img.example/remote.png',
    image_limit: 3,
  })

  assert.equal(refs.length, 3)
  assert.equal(refs[0].source, 'remote')
  assert.equal(refs[1].name, '208326100202-ai-1.png')
  assert.equal(refs[1].styleCode, '208326100202')
})

test('keeps every injected file when different paths share the same basename', async () => {
  const helpers = await loadExports()
  assert.equal(typeof helpers.groupInjectedFilesByName, 'function')

  const first = { name: '1.jpg', marker: 'first' }
  const second = { name: '1.jpg', marker: 'second' }
  const grouped = helpers.groupInjectedFilesByName([first, second])

  assert.deepEqual(Array.from(grouped.get('1.jpg')), [first, second])
})

test('builds one video job per image and matches templates by id or keyword', async () => {
  const helpers = await loadExports()
  const refs = [
    { ref: '/tmp/208326100202-ai-1.png', path: '/tmp/208326100202-ai-1.png', source: 'local', name: '208326100202-ai-1.png', styleCode: '208326100202' },
    { ref: '/tmp/208326100202-ai-2.png', path: '/tmp/208326100202-ai-2.png', source: 'local', name: '208326100202-ai-2.png', styleCode: '208326100202' },
  ]
  const jobs = helpers.buildJobs(refs, [actionTemplate(), multiSlotTemplate()], {
    template_id: 'tpl-action-001',
    group_mode: 'one_image_per_video',
  })

  assert.equal(jobs.length, 2)
  assert.equal(jobs[0].templateId, 'tpl-action-001')
  assert.equal(jobs[0].materialRefs.length, 1)

  const matched = helpers.buildJobs(refs, [actionTemplate(), multiSlotTemplate()], {
    template_match: '正反面',
    group_mode: 'all_images_one_video',
  })
  assert.equal(matched.length, 1)
  assert.equal(matched[0].templateId, 'tpl-multi-001')
  assert.equal(matched[0].materialRefs.length, 2)
})

test('rejects an explicit missing template id instead of silently choosing another template', async () => {
  const helpers = await loadExports()
  const refs = [
    { ref: '/tmp/a.png', path: '/tmp/a.png', source: 'local', name: 'a.png' },
  ]

  assert.throws(
    () => helpers.buildJobs(refs, [actionTemplate(), multiSlotTemplate()], { template_id: 'missing-template' }),
    /missing-template|指定模板|未找到/,
  )
})

test('builds direct software-manager jobs without silently selecting a template', async () => {
  const helpers = await loadExports()
  const refs = [
    { ref: '/tmp/208326102205-ai-1.png', path: '/tmp/208326102205-ai-1.png', source: 'local', name: '208326102205-ai-1.png', styleCode: '208326102205' },
    { ref: '/tmp/208326102205-ai-2.png', path: '/tmp/208326102205-ai-2.png', source: 'local', name: '208326102205-ai-2.png', styleCode: '208326102205' },
  ]

  const jobs = helpers.buildJobs(refs, [actionTemplate()], {
    template_id: '',
    template_match: '',
    group_mode: 'one_image_per_video',
    ratio: '9:16',
    prompt: '儿童模特自然展示上衣细节',
  })

  assert.equal(jobs.length, 2)
  assert.equal(jobs[0].template, null)
  assert.equal(jobs[0].templateId, '')
  assert.equal(jobs[0].generationMode, 'img2video')
  assert.equal(jobs[0].ratio, '9:16')
  assert.equal(jobs[0].styleCode, '208326102205')
})

test('builds direct software-manager payload for jobs without a template', async () => {
  const helpers = await loadExports()
  const job = {
    template: null,
    templateId: '',
    generationMode: 'img2video',
    styleCode: '208326102205',
    prompt: '儿童模特自然展示上衣细节',
    ratio: '3:4',
  }

  const payload = helpers.buildGenerationPayload(job, [
    { ref: '/tmp/a.png', url: 'https://img.example/uploaded-a.png' },
    { ref: '/tmp/b.png', url: 'https://img.example/uploaded-b.png' },
  ])

  assert.equal(payload.api, 'mtop.taobao.qn.copilot.image.generate.video.submit')
  assert.equal(payload.data.funcType, 'model_img2video')
  assert.equal(payload.data.ratio, '3:4')
  assert.deepEqual(JSON.parse(payload.data.clips), [
    {
      modelUrl: 'https://img.example/uploaded-a.png',
      prompt: '儿童模特自然展示上衣细节',
    },
    {
      modelUrl: 'https://img.example/uploaded-b.png',
      prompt: '儿童模特自然展示上衣细节',
    },
  ])
  assert.equal(payload.data.itemVO, '{}')
})

test('buildTemplatePayload uses action template generate API with uploaded image', async () => {
  const helpers = await loadExports()
  const [job] = helpers.buildJobs([
    { ref: '/tmp/a.png', path: '/tmp/a.png', source: 'local', name: 'a.png' },
  ], [actionTemplate()], { template_id: 'tpl-action-001' })
  const payload = helpers.buildTemplatePayload(job, [
    { ref: '/tmp/a.png', url: 'https://img.example/uploaded.png' },
  ])

  assert.equal(payload.api, 'mtop.taobao.qn.copilot.img2video.template.video.generate')
  assert.equal(payload.data.templateId, 'tpl-action-001')
  assert.equal(payload.data.imageUrl, 'https://img.example/uploaded.png')
  assert.equal(payload.data.provider, 'content')
})

test('buildTemplatePayload maps multiple images to non-action template slots', async () => {
  const helpers = await loadExports()
  const [job] = helpers.buildJobs([
    { ref: '/tmp/a.png', path: '/tmp/a.png', source: 'local', name: 'a.png' },
    { ref: '/tmp/b.png', path: '/tmp/b.png', source: 'local', name: 'b.png' },
  ], [multiSlotTemplate()], { template_id: 'tpl-multi-001', group_mode: 'all_images_one_video' })
  const payload = helpers.buildTemplatePayload(job, [
    { ref: '/tmp/a.png', url: 'https://img.example/a.png' },
    { ref: '/tmp/b.png', url: 'https://img.example/b.png' },
  ])

  assert.equal(payload.api, 'mtop.taobao.qn.copilot.video.template.generate')
  assert.deepEqual(JSON.parse(payload.data.inputImages), [
    { code: '0', imageUrl: 'https://img.example/a.png' },
    { code: '1', imageUrl: 'https://img.example/b.png' },
  ])
  assert.match(payload.data.modelImages, /https:\/\/img\.example\/a\.png/)
})

test('extracts completed task video URL and builds download item', async () => {
  const helpers = await loadExports()
  const state = helpers.normalizeTaskState({
    result: {
      task: {
        id: 157,
        status: 1,
        result: JSON.stringify({
          compositeVideo: {
            contentId: '573',
            coverUrl: 'https://img.example/cover.png',
            videoUrl: 'https://video.example/out.mp4',
          },
          videoList: [],
        }),
      },
    },
  })

  assert.equal(state.done, true)
  assert.equal(state.videoUrl, 'https://video.example/out.mp4')
  assert.equal(state.coverUrl, 'https://img.example/cover.png')
  assert.equal(state.contentId, '573')

  const [job] = helpers.buildJobs([
    { ref: '/tmp/208326100202-ai-1.png', path: '/tmp/208326100202-ai-1.png', source: 'local', name: '208326100202-ai-1.png', styleCode: '208326100202' },
  ], [actionTemplate()], { template_id: 'tpl-action-001' })
  const item = helpers.videoDownloadItem({ ...job, taskId: '157' }, state)
  assert.equal(item.url, 'https://video.example/out.mp4')
  assert.match(item.target_relative_path, /208326100202/)
  assert.match(item.filename, /157\.mp4$/)
})

test('catalog rows and preview download mapping preserve local preview path', async () => {
  const helpers = await loadExports()
  const rows = helpers.buildCatalogRows([actionTemplate()], '童装/婴儿装/亲子装', {
    'tpl-action-001': '/tmp/模板预览/tpl-action-001.mp4',
  })

  assert.equal(rows[0].作业类型, '模板预览')
  assert.equal(rows[0].模板预览URL, 'https://video.example/preview.mp4')
  assert.equal(rows[0].模板预览本地文件, '/tmp/模板预览/tpl-action-001.mp4')

  const mapped = helpers.mapPreviewDownloads({
    items: [{ label: '模板预览 tpl-action-001', success: true, path: '/tmp/local.mp4' }],
  })
  assert.equal(mapped['tpl-action-001'], '/tmp/local.mp4')
})
