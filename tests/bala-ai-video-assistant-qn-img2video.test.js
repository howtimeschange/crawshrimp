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

function directVideoJob(overrides = {}) {
  return {
    index: 1,
    template: null,
    templateId: '',
    templateName: '',
    generationMode: 'img2video',
    ratio: '3:4',
    prompt: '儿童模特自然展示上衣细节',
    styleCode: '208326103207',
    materialRefs: [
      {
        ref: 'https://img.example/208326103207-1.png',
        url: 'https://img.example/208326103207-1.png',
        source: 'remote',
        name: '208326103207-1.png',
        styleCode: '208326103207',
      },
    ],
    ...overrides,
  }
}

function domDescendants(node) {
  const output = []
  for (const child of node?.children || []) {
    output.push(child)
    output.push(...domDescendants(child))
  }
  return output
}

function makeDomElement({ tagName = 'div', text = '', attrs = {}, dataset = {}, children = [] } = {}) {
  const element = {
    tagName: String(tagName || 'div').toUpperCase(),
    innerText: text,
    textContent: text,
    dataset,
    children,
    parentElement: null,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null
    },
    querySelector(selector) {
      const target = String(selector || '').toLowerCase()
      return domDescendants(element).find(child => String(child?.tagName || '').toLowerCase() === target) || null
    },
    querySelectorAll() {
      return domDescendants(element)
    },
  }
  if (attrs.src) element.src = attrs.src
  if (attrs.href) element.href = attrs.href
  if (attrs.currentSrc) element.currentSrc = attrs.currentSrc
  for (const child of children) child.parentElement = element
  return element
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

test('builds upgraded batch software-manager payload when no itemId is available', async () => {
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

  assert.equal(payload.api, 'mtop.taobao.qn.copilot.video.batch.generate')
  const batchParam = JSON.parse(payload.data.batchParam)
  assert.equal(batchParam.length, 1)
  const item = JSON.parse(batchParam[0])
  assert.equal(item.funcType, 'model_img2video')
  assert.equal(item.ratio, '3:4')
  assert.equal(item.videoQualityLevel, 'standard')
  assert.equal(item.targetDuration, 15)
  assert.equal(item.globalPrompt, '儿童模特自然展示上衣细节')
  assert.deepEqual(JSON.parse(item.clips), [
    {
      modelUrl: 'https://img.example/uploaded-a.png',
      prompt: '儿童模特自然展示上衣细节',
    },
    {
      modelUrl: 'https://img.example/uploaded-b.png',
      prompt: '儿童模特自然展示上衣细节',
    },
  ])
  assert.equal(item.itemVO, '{}')
  assert.equal(payload.fallback.api, 'mtop.taobao.qn.copilot.image.generate.video.submit')
  assert.equal(payload.fallback.data.itemVO, '{}')
})

test('builds upgraded batch payload without binding itemId even when provided', async () => {
  const helpers = await loadExports()
  const job = {
    template: null,
    templateId: '',
    generationMode: 'img2video',
    styleCode: '208326102205',
    prompt: '儿童模特自然展示上衣细节',
    ratio: '3:4',
    itemId: '1075843020447',
    productId: '1075843020448',
  }

  const payload = helpers.buildGenerationPayload(job, [
    { ref: '/tmp/a.png', url: 'https://img.example/uploaded-a.png', itemId: '1075843020449' },
  ])

  assert.equal(payload.api, 'mtop.taobao.qn.copilot.video.batch.generate')
  const batchParam = JSON.parse(payload.data.batchParam)
  assert.equal(batchParam.length, 1)
  const item = JSON.parse(batchParam[0])
  assert.equal(item.funcType, 'model_img2video')
  assert.equal(item.ratio, '3:4')
  assert.equal(item.videoQualityLevel, 'standard')
  assert.equal(item.targetDuration, 15)
  assert.equal(item.globalPrompt, '儿童模特自然展示上衣细节')
  assert.deepEqual(JSON.parse(item.clips), [
    {
      modelUrl: 'https://img.example/uploaded-a.png',
      prompt: '儿童模特自然展示上衣细节',
    },
  ])
  assert.equal(item.itemVO, '{}')
  assert.equal(payload.fallback.api, 'mtop.taobao.qn.copilot.image.generate.video.submit')
  assert.deepEqual(JSON.parse(payload.fallback.data.clips), [
    {
      modelUrl: 'https://img.example/uploaded-a.png',
      prompt: '儿童模特自然展示上衣细节',
    },
  ])
  assert.equal(payload.fallback.data.itemVO, '{}')
})

test('extracts task IDs from upgraded batch generate responses', async () => {
  const helpers = await loadExports()
  const batchItem = JSON.stringify({
    success: true,
    task: {
      id: 164365688266,
      submitTaskId: 'submit-164365688266',
      status: 0,
    },
  })
  const response = {
    result: {
      batchTask: [batchItem],
    },
  }

  assert.equal(helpers.extractTaskId(response), '164365688266')
  assert.equal(helpers.extractSubmitTaskId(response), 'submit-164365688266')
})

test('extracts readable errors from upgraded batch generate item failures', async () => {
  const helpers = await loadExports()
  const response = {
    result: {
      batchTask: [
        JSON.stringify({
          success: false,
          task: {
            errorMsg: '点数不足',
            status: 2,
          },
        }),
      ],
    },
  }

  assert.equal(helpers.extractTaskId(response), '')
  assert.equal(helpers.firstFailedBatchTaskError(response), '点数不足')
})

test('treats the upgraded software-manager page as upload-ready without legacy helper', async () => {
  const result = await runScript({
    params: {
      execute_mode: 'live',
      material_images: ['/tmp/208326102205-ai-1.png'],
    },
    windowOverrides: {
      Blob: function Blob() {},
      FormData: function FormData() {},
      fetch: async () => ({ blob: async () => ({}) }),
      lib: {
        mtop: {
          request: async request => {
            if (request.api === 'mtop.taobao.qn.copilot.node.aigc.seller.category.get') {
              return { data: { result: { mainCateName: '童装/婴儿装/亲子装' } } }
            }
            if (request.api === 'mtop.taobao.qn.copilot.video.template.list') {
              return { data: { result: [] } }
            }
            return { data: {} }
          },
        },
      },
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'process_row')
  assert.equal(result.meta.shared.jobs.length, 1)
})

test('extracts visible software-manager task IDs and finds the new one', async () => {
  const helpers = await loadExports()
  const ids = helpers.taskIdsFromText('款号 208326103207\n任务ID 159228616426\n任务 ID：162085738211\nTask ID: 162085738211')

  assert.deepEqual(Array.from(ids), ['159228616426', '162085738211'])
  assert.equal(helpers.findNewTaskId(['159228616426'], ids), '162085738211')
})

test('polls visible completed software-manager card before waiting for stale MTop state', async () => {
  const video = makeDomElement({
    tagName: 'video',
    attrs: { src: 'https://cdn.example/video/162359532252.mp4' },
  })
  const card = makeDomElement({
    text: '任务ID 162359532252 展示视频 详情信息',
    children: [video],
  })
  const body = makeDomElement({
    text: '全部任务\n任务ID 162359532252 展示视频 详情信息',
    children: [card],
  })
  const job = directVideoJob({ index: 46, outputDir: '/tmp/qn-video' })

  const result = await runScript({
    phase: 'poll_job',
    shared: {
      jobs: [job],
      job_index: 0,
      results: [],
      active_job: {
        ...job,
        resolvedMaterials: job.materialRefs,
        submitApi: 'mtop.taobao.qn.copilot.image.generate.video.submit',
        taskId: '162359532252',
      },
      active_poll_started_at: Date.now(),
      active_poll_attempts: 0,
      poll_timeout_ms: 600000,
      poll_interval_ms: 20000,
      download_videos: true,
      download_concurrency: 2,
    },
    windowOverrides: {
      document: {
        body,
        querySelectorAll() {
          return [body, ...domDescendants(body)]
        },
      },
      lib: {
        mtop: {
          request: async request => {
            assert.equal(request.api, 'mtop.taobao.qn.copilot.quick.task.get')
            return {
              result: {
                task: {
                  id: '162359532252',
                  status: 0,
                  result: '{}',
                },
              },
            }
          },
        },
      },
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'download_urls')
  assert.equal(result.meta.items[0].url, 'https://cdn.example/video/162359532252.mp4')
  assert.equal(result.meta.concurrency, 2)
  assert.equal(result.meta.shared.active_job.taskState.status, 1)
  assert.equal(result.meta.shared.active_job.taskState.statusText, '页面已生成')
  assert.equal(result.meta.shared.active_job.taskState.source, 'page')
})

test('does not treat an old completed sibling video as the active task result', async () => {
  const job = directVideoJob({ outputDir: '/tmp/qn-video' })
  const currentStatus = makeDomElement({
    text: '任务ID 164441692659 展示视频 详细信息 正在生成所需片段素材...',
  })
  const oldVideo = makeDomElement({
    tagName: 'video',
    attrs: { src: 'https://cdn.example/video/164381738865.mp4' },
  })
  const oldCard = makeDomElement({
    text: '任务ID 164381738865 展示视频 详细信息 已完成',
    children: [oldVideo],
  })
  const grid = makeDomElement({
    text: '任务ID 164441692659 展示视频 详细信息 正在生成所需片段素材... 任务ID 164381738865 展示视频 详细信息 已完成',
    children: [currentStatus, oldCard],
  })
  const body = makeDomElement({
    text: grid.textContent,
    children: [grid],
  })

  const result = await runScript({
    phase: 'poll_job',
    shared: {
      jobs: [job],
      job_index: 0,
      results: [],
      active_job: {
        ...job,
        resolvedMaterials: job.materialRefs,
        submitApi: 'mtop.taobao.qn.copilot.image.generate.video.submit',
        taskId: '164441692659',
      },
      active_poll_started_at: Date.now(),
      active_poll_attempts: 0,
      poll_timeout_ms: 60000,
      poll_interval_ms: 5000,
      download_videos: true,
      download_concurrency: 2,
      output_dir: '/tmp/qn-video',
    },
    windowOverrides: {
      document: {
        body,
        querySelectorAll() {
          return [body, grid, currentStatus, oldCard, oldVideo]
        },
      },
      lib: {
        mtop: {
          request: async request => {
            assert.equal(request.api, 'mtop.taobao.qn.copilot.quick.task.get')
            return {
              result: {
                task: {
                  id: '164441692659',
                  status: 0,
                  result: '{}',
                },
              },
            }
          },
        },
      },
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'poll_job')
  assert.equal(result.meta.shared.active_poll_attempts, 1)
  assert.deepEqual(result.meta.shared.results, [])
})

test('recovers a submit timeout when a new task ID appears immediately on the page', async () => {
  const document = {
    body: {
      innerText: '历史任务\n任务ID 159228616426',
      textContent: '',
    },
  }
  let submitCalls = 0
  const job = directVideoJob()

  const result = await runScript({
    phase: 'process_row',
    shared: {
      jobs: [job],
      job_index: 0,
      results: [],
      poll_timeout_ms: 600000,
      poll_interval_ms: 5000,
      submit_recovery_timeout_ms: 60000,
      submit_recovery_interval_ms: 3000,
      download_videos: true,
    },
    windowOverrides: {
      document,
      lib: {
        mtop: {
          request: async request => {
            if (request.api === 'mtop.taobao.qn.copilot.video.batch.generate') {
              submitCalls += 1
              document.body.innerText = '最新任务\n任务ID 162085738211\n历史任务\n任务ID 159228616426'
              throw { ret: ['FAIL_SYS_SERVICE_TIMEOUT::请求服务超时'], traceId: 'trace-timeout' }
            }
            throw new Error(`unexpected api ${request.api}`)
          },
        },
      },
    },
  })

  assert.equal(submitCalls, 1)
  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'poll_job')
  assert.deepEqual(result.meta.shared.results, [])
  assert.equal(result.meta.shared.active_job.taskId, '162085738211')
  assert.deepEqual(Array.from(result.meta.shared.active_job.preSubmitTaskIds), ['159228616426'])
  assert.match(result.meta.shared.active_job.submitError, /FAIL_SYS_SERVICE_TIMEOUT|请求服务超时/)
  assert.match(result.meta.shared.active_job.submitWarning, /找回任务ID/)
})

test('falls back to legacy direct submit only when the upgraded batch API is unavailable', async () => {
  const job = directVideoJob({ itemId: '1075843020447' })
  const calls = []

  const result = await runScript({
    phase: 'process_row',
    shared: {
      jobs: [job],
      job_index: 0,
      results: [],
      poll_timeout_ms: 600000,
      poll_interval_ms: 5000,
      submit_recovery_timeout_ms: 60000,
      submit_recovery_interval_ms: 3000,
      download_videos: false,
    },
    windowOverrides: {
      document: {
        body: {
          innerText: '',
          textContent: '',
        },
      },
      lib: {
        mtop: {
          request: async request => {
            calls.push(request.api)
            if (request.api === 'mtop.taobao.qn.copilot.video.batch.generate') {
              throw { data: { errorMsg: '接口不存在' }, ret: ['FAIL_SYS_API_NOT_FOUND::接口不存在'] }
            }
            if (request.api === 'mtop.taobao.qn.copilot.image.generate.video.submit') {
              return { data: { result: { task: { id: '162085738211', status: 0 } } } }
            }
            throw new Error(`unexpected api ${request.api}`)
          },
        },
      },
    },
  })

  assert.deepEqual(calls, [
    'mtop.taobao.qn.copilot.video.batch.generate',
    'mtop.taobao.qn.copilot.image.generate.video.submit',
  ])
  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'poll_job')
  assert.equal(result.meta.shared.active_job.taskId, '162085738211')
  assert.equal(result.meta.shared.active_job.submitApi, 'mtop.taobao.qn.copilot.image.generate.video.submit')
})

test('reports upgraded batch item failures with uploaded image evidence', async () => {
  const job = directVideoJob()

  const result = await runScript({
    phase: 'process_row',
    shared: {
      jobs: [job],
      job_index: 0,
      results: [],
      poll_timeout_ms: 600000,
      poll_interval_ms: 5000,
      submit_recovery_timeout_ms: 60000,
      submit_recovery_interval_ms: 3000,
      download_videos: false,
    },
    windowOverrides: {
      document: {
        body: {
          innerText: '',
          textContent: '',
        },
      },
      lib: {
        mtop: {
          request: async request => {
            assert.equal(request.api, 'mtop.taobao.qn.copilot.video.batch.generate')
            return {
              data: {
                result: {
                  batchTask: [
                    JSON.stringify({
                      success: false,
                      task: {
                        errorMsg: '点数不足',
                        status: 2,
                      },
                    }),
                  ],
                },
              },
            }
          },
        },
      },
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'process_row')
  assert.equal(result.meta.shared.job_index, 1)
  assert.equal(result.meta.shared.results.length, 1)
  const [row] = result.meta.shared.results
  assert.equal(row.执行结果, '失败')
  assert.equal(row.任务状态, '提交失败')
  assert.equal(row.提交API, 'mtop.taobao.qn.copilot.video.batch.generate')
  assert.equal(row.上传URL, 'https://img.example/208326103207-1.png')
  assert.match(row.备注, /点数不足/)
})

test('recover_submit_task phase continues polling once the page exposes a new task ID', async () => {
  const job = directVideoJob()

  const result = await runScript({
    phase: 'recover_submit_task',
    shared: {
      jobs: [job],
      job_index: 0,
      results: [],
      active_job: {
        ...job,
        resolvedMaterials: job.materialRefs,
        submitApi: 'mtop.taobao.qn.copilot.image.generate.video.submit',
        taskId: '',
        preSubmitTaskIds: ['159228616426'],
        submitError: 'mtop.taobao.qn.copilot.image.generate.video.submit 返回失败：FAIL_SYS_SERVICE_TIMEOUT::请求服务超时',
        submitWarning: '提交接口超时，正在从页面任务列表找回任务ID',
      },
      submit_recovery_started_at: Date.now(),
      submit_recovery_attempts: 1,
      submit_recovery_timeout_ms: 60000,
      submit_recovery_interval_ms: 3000,
      poll_interval_ms: 5000,
    },
    windowOverrides: {
      document: {
        body: {
          innerText: '任务ID 162085738211\n任务ID 159228616426',
          textContent: '',
        },
      },
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'poll_job')
  assert.equal(result.meta.shared.active_job.taskId, '162085738211')
  assert.equal(result.meta.shared.active_poll_attempts, 0)
  assert.deepEqual(result.meta.shared.results, [])
})

test('recover_submit_task phase finds new task ID from page attributes when body text is stale', async () => {
  const job = directVideoJob()
  const marker = makeDomElement({
    attrs: { 'data-task-id': '162085738211', title: '最新任务' },
    dataset: { taskId: '162085738211' },
  })
  const body = makeDomElement({
    text: '历史任务\n任务ID 159228616426',
    children: [marker],
  })

  const result = await runScript({
    phase: 'recover_submit_task',
    shared: {
      jobs: [job],
      job_index: 0,
      results: [],
      active_job: {
        ...job,
        resolvedMaterials: job.materialRefs,
        submitApi: 'mtop.taobao.qn.copilot.image.generate.video.submit',
        taskId: '',
        preSubmitTaskIds: ['159228616426'],
        submitError: 'mtop.taobao.qn.copilot.image.generate.video.submit 返回失败：FAIL_SYS_SERVICE_TIMEOUT::请求服务超时',
        submitWarning: '提交接口超时，正在从页面任务列表找回任务ID',
      },
      submit_recovery_started_at: Date.now(),
      submit_recovery_attempts: 1,
      submit_recovery_timeout_ms: 60000,
      submit_recovery_interval_ms: 3000,
      poll_interval_ms: 5000,
    },
    windowOverrides: {
      document: {
        body,
        querySelectorAll() {
          return [body, marker]
        },
      },
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'poll_job')
  assert.equal(result.meta.shared.active_job.taskId, '162085738211')
  assert.deepEqual(result.meta.shared.results, [])
})

test('recover_submit_task phase downloads visible completed video at recovery timeout', async () => {
  const job = directVideoJob({ index: 52, outputDir: '/tmp/qn-video' })
  const video = makeDomElement({
    tagName: 'video',
    attrs: { src: 'https://cdn.example/video/163470662368.mp4' },
  })
  const card = makeDomElement({
    text: '任务ID 163470662368 展示视频 视频分镜',
    children: [video],
  })
  const body = makeDomElement({
    text: '任务ID 163470662368 展示视频 视频分镜',
    children: [card],
  })

  const result = await runScript({
    phase: 'recover_submit_task',
    shared: {
      jobs: [job],
      job_index: 0,
      results: [],
      active_job: {
        ...job,
        resolvedMaterials: job.materialRefs,
        submitApi: 'mtop.taobao.qn.copilot.image.generate.video.submit',
        taskId: '',
        preSubmitTaskIds: ['163470662368'],
        submitError: 'mtop.taobao.qn.copilot.image.generate.video.submit 返回失败：FAIL_SYS_SERVICE_TIMEOUT::请求服务超时',
        submitWarning: '提交接口超时，正在从页面任务列表找回任务ID',
      },
      submit_recovery_started_at: Date.now() - 70000,
      submit_recovery_attempts: 1,
      submit_recovery_timeout_ms: 60000,
      submit_recovery_interval_ms: 3000,
      poll_interval_ms: 5000,
      download_videos: true,
      download_concurrency: 2,
      output_dir: '/tmp/qn-video',
    },
    windowOverrides: {
      document: {
        body,
        querySelectorAll() {
          return [body, card, video]
        },
      },
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'download_urls')
  assert.equal(result.meta.next_phase, 'finalize_video_download')
  assert.equal(result.meta.items[0].url, 'https://cdn.example/video/163470662368.mp4')
  assert.equal(result.meta.shared.active_job.taskId, '163470662368')
  assert.equal(result.meta.shared.active_job.taskState.statusText, '页面已生成')
  assert.match(result.meta.shared.active_job.submitWarning, /未发现新的任务ID|页面可见已生成视频/)
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
