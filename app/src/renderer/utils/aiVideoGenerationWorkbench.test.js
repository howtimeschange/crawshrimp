import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createSSRApp, effectScope, nextTick, ssrContextKey } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createServer } from 'vite'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

let vite
let Workbench

before(async () => {
  vite = await createServer({
    root: appRoot,
    appType: 'custom',
    server: { middlewareMode: true },
  })
  Workbench = (await vite.ssrLoadModule('/src/renderer/views/AiVideoGenerationWorkbench.vue')).default
})

after(async () => {
  await vite?.close()
})

async function setupWorkbench(cs = {}, { localStorage, onOpenSettings, windowOverrides } = {}) {
  globalThis.window = {
    cs,
    innerWidth: 1440,
    localStorage: localStorage || {
      getItem() { return null },
      setItem() {},
    },
    ...(windowOverrides || {}),
  }
  globalThis.document = { activeElement: null }

  let bindings
  const CapturingWorkbench = {
    ...Workbench,
    setup(props, context) {
      bindings = Workbench.setup(props, context)
      return bindings
    },
  }
  await renderToString(createSSRApp(CapturingWorkbench, { onOpenSettings }))
  return bindings
}

function setupLiveWorkbench(cs = {}) {
  globalThis.window = {
    cs,
    innerWidth: 1440,
    localStorage: { getItem() { return null }, setItem() {}, removeItem() {} },
    addEventListener() {},
    removeEventListener() {},
    setInterval() { return 1 },
    clearInterval() {},
  }
  globalThis.document = { activeElement: null }
  const scope = effectScope()
  const app = createSSRApp({ render: () => null })
  app.provide(ssrContextKey, { modules: new Set() })
  let bindings
  const originalWarn = console.warn
  console.warn = (...args) => {
    if (!args.some(value => String(value).includes('Lifecycle injection APIs can only be used'))) {
      originalWarn(...args)
    }
  }
  try {
    app.runWithContext(() => {
      scope.run(() => {
        bindings = Workbench.setup({}, {
          emit() {},
          expose() {},
          attrs: {},
          slots: {},
        })
      })
    })
  } finally {
    console.warn = originalWarn
  }
  return { workbench: bindings, stop: () => scope.stop() }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function focusable(name) {
  return {
    name,
    disabled: false,
    hidden: false,
    tabIndex: 0,
    focus() { globalThis.__focusedWorkbenchElement = this },
    getAttribute() { return null },
    closest() { return null },
  }
}

test('switching to HappyHorse T2V resets the default ratio to 16:9', async () => {
  const workbench = await setupWorkbench()

  assert.equal(workbench.form.ratio, '9:16')
  workbench.selectProvider('happyhorse')

  assert.equal(workbench.happyHorseMode.value, 't2v')
  assert.equal(workbench.form.ratio, '16:9')
})

test('adding multiple HappyHorse images in one selection applies the R2V default ratio', async () => {
  const workbench = await setupWorkbench()
  workbench.selectProvider('happyhorse')

  workbench.addAssetItems([
    { fileToken: 'image-token-1', name: 'one.jpg' },
    { fileToken: 'image-token-2', name: 'two.jpg' },
  ])

  assert.equal(workbench.happyHorseMode.value, 'r2v')
  assert.equal(workbench.form.ratio, '9:16')
})

test('archive-failed jobs can only retry archiving, never provider generation', async () => {
  const workbench = await setupWorkbench()
  const job = {
    id: 'job-archive-failed',
    status: 'failed',
    displayStatus: '待归档',
    currentRun: { archiveStatus: 'archive_failed' },
  }

  assert.equal(workbench.canRetryArchive(job), true)
  assert.equal(workbench.canRetry(job), false)
})

test('provider retry requires an explicitly retryable error and blocks unknown submit results', async () => {
  const workbench = await setupWorkbench()
  const unknownSubmit = {
    id: 'job-unknown-submit',
    status: 'failed',
    currentRun: { error: { code: 'UNKNOWN_SUBMIT_RESULT', retryable: false } },
  }
  const retryableFailure = {
    id: 'job-retryable',
    status: 'failed',
    currentRun: { error: { code: 'PROVIDER_TIMEOUT', retryable: true } },
  }

  assert.equal(workbench.canRetry(unknownSubmit), false)
  assert.equal(workbench.canRetry(retryableFailure), true)
})

test('needs-config jobs remain editable and retryable after credentials are configured', async () => {
  const workbench = await setupWorkbench()
  const job = {
    id: 'job-needs-config',
    status: 'needs_config',
    provider: 'seedance',
    currentRun: {
      error: { code: 'CREDENTIAL_MISSING', retryable: false },
    },
  }
  workbench.config.value = {
    providers: {
      seedance: { configured: false, cliReady: true },
      happyhorse: { configured: true, cliReady: true },
    },
  }

  assert.equal(workbench.canEdit(job), true)
  assert.equal(workbench.canRetry(job), false)

  workbench.config.value.providers.seedance.configured = true
  assert.equal(workbench.canRetry(job), true)

  workbench.config.value.providers.seedance.cliReady = false
  assert.equal(workbench.canRetry(job), false)
})

test('unready provider configuration exposes the existing settings recovery event', async () => {
  let openSettingsCalls = 0
  const workbench = await setupWorkbench({}, {
    onOpenSettings() { openSettingsCalls += 1 },
  })
  workbench.config.value = {
    providers: {
      seedance: { configured: false, cliReady: true },
      happyhorse: { configured: true, cliReady: true },
    },
  }

  assert.match(workbench.configHint.value, /凭据未配置/)
  workbench.openVideoSettings()
  assert.equal(openSettingsCalls, 1)

  workbench.config.value.providers.seedance.configured = true
  assert.equal(workbench.configHint.value, '')

  const source = fs.readFileSync(
    path.join(appRoot, 'src/renderer/views/AiVideoGenerationWorkbench.vue'),
    'utf8',
  )
  assert.match(source, /v-if="configHint"[\s\S]*@click="openVideoSettings"/)
})

test('KeepAlive activation refreshes state and deactivation stops background polling', async () => {
  const calls = []
  let intervalId = 0
  const cleared = []
  const workbench = await setupWorkbench({
    async getAiVideoConfig() {
      calls.push('config')
      return { providers: {}, defaultOutputDirToken: 'fresh-output', defaultOutputDirName: '输出' }
    },
    async getSavedAiVideoDirectory() {
      calls.push('directory')
      return { directoryToken: 'fresh-input', name: '图库' }
    },
    async listAiVideoJobs() {
      calls.push('jobs')
      return { data: { jobs: [] } }
    },
  }, {
    windowOverrides: {
      setInterval() { intervalId += 1; return intervalId },
      clearInterval(id) { cleared.push(id) },
    },
  })

  await workbench.activateWorkbench()
  assert.deepEqual(calls, ['config', 'directory', 'jobs'])
  assert.equal(workbench.pollTimer.value, 1)

  workbench.deactivateWorkbench()
  assert.equal(workbench.pollTimer.value, null)
  assert.deepEqual(cleared, [1])

  const source = fs.readFileSync(
    path.join(appRoot, 'src/renderer/views/AiVideoGenerationWorkbench.vue'),
    'utf8',
  )
  assert.match(source, /onActivated\(activateWorkbench\)/)
  assert.match(source, /onDeactivated\(deactivateWorkbench\)/)
})

test('deactivation during an in-flight refresh cannot restart background polling', async () => {
  const configRequest = deferred()
  let startedIntervals = 0
  const workbench = await setupWorkbench({
    getAiVideoConfig() { return configRequest.promise },
    async getSavedAiVideoDirectory() { return null },
    async listAiVideoJobs() { return { data: { jobs: [] } } },
  }, {
    windowOverrides: {
      setInterval() { startedIntervals += 1; return startedIntervals },
      clearInterval() {},
    },
  })

  const activation = workbench.activateWorkbench()
  workbench.deactivateWorkbench()
  configRequest.resolve({ providers: {} })
  await activation

  assert.equal(startedIntervals, 0)
  assert.equal(workbench.pollTimer.value, null)
})

test('four-second polling keeps job reloads single-flight', async () => {
  const jobsRequest = deferred()
  let listCalls = 0
  let pollCallback
  const workbench = await setupWorkbench({
    listAiVideoJobs() {
      listCalls += 1
      return jobsRequest.promise
    },
  }, {
    windowOverrides: {
      setInterval(callback) {
        pollCallback = callback
        return 1
      },
      clearInterval() {},
    },
  })
  workbench.jobs.value = [{ id: 'job-running', status: 'running' }]
  workbench.startPolling()

  pollCallback()
  pollCallback()

  assert.equal(listCalls, 1)
  jobsRequest.resolve({ data: { jobs: [] } })
  await jobsRequest.promise
  await nextTick()
})

test('secure picker and output-folder IPC failures are surfaced inline', async () => {
  const workbench = await setupWorkbench({
    async selectAiVideoImages() { throw new Error('图片选择失败') },
    async selectAiVideoDirectory({ scope }) { throw new Error(`${scope} 目录选择失败`) },
    async openAiVideoDirectory() { throw new Error('输出目录打开失败') },
  })

  await workbench.chooseImages()
  assert.equal(workbench.formError.value, '图片选择失败')

  await workbench.chooseOutputDir()
  assert.equal(workbench.formError.value, 'output 目录选择失败')

  await workbench.chooseLibraryRoot()
  assert.equal(workbench.libraryError.value, 'input 目录选择失败')

  workbench.form.outputDirToken = 'output-directory-token'
  await workbench.openOutputFolder()
  assert.equal(workbench.formError.value, '输出目录打开失败')
})

test('only queued jobs not yet submitted to the provider can be cancelled', async () => {
  const workbench = await setupWorkbench()

  assert.equal(workbench.canCancelQueuedJob({
    id: 'job-local-queue',
    status: 'queued',
    currentRun: { providerTaskId: null },
  }), true)
  assert.equal(workbench.canCancelQueuedJob({
    id: 'job-provider-queue',
    status: 'queued',
    currentRun: { providerTaskId: 'provider-task-1' },
  }), false)
  assert.equal(workbench.canCancelQueuedJob({
    id: 'job-running',
    status: 'running',
    currentRun: { providerTaskId: null },
  }), false)
})

test('queued cancellation reuses record deletion and refuses submitted jobs', async () => {
  const deleted = []
  let reloads = 0
  const workbench = await setupWorkbench({
    async deleteAiVideoJobRecord(jobId) {
      deleted.push(jobId)
      return { ok: true }
    },
    async listAiVideoJobs() {
      reloads += 1
      return { data: { jobs: [] } }
    },
  })

  await workbench.cancelQueuedJob({
    id: 'job-already-submitted',
    status: 'queued',
    currentRun: { providerTaskId: 'provider-task-2' },
  })
  await workbench.cancelQueuedJob({
    id: 'job-still-local',
    status: 'queued',
    currentRun: { providerTaskId: '' },
  })

  assert.deepEqual(deleted, ['job-still-local'])
  assert.equal(reloads, 1)
})

test('deleting a job waits for an explicit record-only or local-file choice', async () => {
  const deleted = []
  const workbench = await setupWorkbench({
    async deleteAiVideoJobRecord(jobId, options) {
      deleted.push([jobId, options])
      return { ok: true }
    },
    async listAiVideoJobs() { return { data: { jobs: [] } } },
  })
  const job = { id: 'job-delete-confirmed', status: 'completed', title: '成片任务' }

  workbench.requestDeleteJob(job)
  assert.equal(workbench.pendingDeleteJob.value?.id, job.id)
  assert.deepEqual(deleted, [])

  await workbench.confirmDeleteJob()
  assert.deepEqual(deleted, [[job.id, { deleteLocalFile: false }]])
  assert.equal(workbench.pendingDeleteJob.value, null)

  workbench.requestDeleteJob(job)
  await workbench.confirmDeleteJob(true)
  assert.deepEqual(deleted, [
    [job.id, { deleteLocalFile: false }],
    [job.id, { deleteLocalFile: true }],
  ])
})

test('provider retry is single-flight per job', async () => {
  const pending = deferred()
  let retryCalls = 0
  const workbench = await setupWorkbench({
    retryAiVideoJob() {
      retryCalls += 1
      return pending.promise
    },
    async listAiVideoJobs() { return { data: { jobs: [] } } },
  })
  const job = { id: 'job-failed', status: 'failed' }

  const first = workbench.retryJob(job)
  const second = workbench.retryJob(job)
  assert.equal(retryCalls, 1)

  pending.resolve({ data: { job: { ...job, status: 'queued' } } })
  await Promise.all([first, second])
  assert.equal(retryCalls, 1)
})

test('reusing a job blocks silent HappyHorse mode changes when an input capability is unavailable', async () => {
  const workbench = await setupWorkbench()
  const job = {
    id: 'job-missing-i2v-input',
    status: 'failed',
    provider: 'happyhorse',
    model: 'happyhorse-1.1-i2v',
    prompt: 'keep the original first-frame mode',
    outputDirToken: 'output-directory-token',
    assets: [{ name: 'deleted-first-frame.jpg', role: 'first_frame' }],
    parameters: { resolution: '720P', duration: 5, watermark: false },
  }

  workbench.reuseParams(job)

  assert.equal(workbench.resolvedModelId.value, 'happyhorse-1.1-t2v')
  assert.equal(workbench.validateLocal(), false)
  assert.match(workbench.errors.assets, /参考图.*不可用/)
})

test('reusing a valid job clears stale missing-asset errors from the previous job', async () => {
  const workbench = await setupWorkbench()
  const baseJob = {
    status: 'failed',
    provider: 'happyhorse',
    model: 'happyhorse-1.1-i2v',
    prompt: '保持图生模式',
    outputDirToken: 'output-directory-token',
    parameters: { resolution: '720P', duration: 5, watermark: false },
  }

  const missingInputJob = {
    ...baseJob,
    id: 'job-missing-input',
    assets: [{ name: 'missing.jpg', role: 'first_frame' }],
  }
  workbench.reuseParams(missingInputJob)
  assert.match(workbench.formError.value, /参考图不可用/)
  workbench.validateLocal()
  assert.match(workbench.errors.assets, /参考图.*不可用/)
  workbench.reuseParams(missingInputJob)

  workbench.reuseParams({
    ...baseJob,
    id: 'job-valid-input',
    assets: [{ fileToken: 'valid-image-token', name: 'valid.jpg', role: 'first_frame' }],
  })

  assert.equal(workbench.formError.value, '')
  assert.equal(workbench.errors.assets, '')
})

test('reusing HappyHorse R2V preserves its custom ratio after watcher flush', async () => {
  const { workbench, stop } = setupLiveWorkbench()

  try {
    workbench.reuseParams({
      id: 'job-custom-r2v-ratio',
      status: 'failed',
      provider: 'happyhorse',
      model: 'happyhorse-1.1-r2v',
      prompt: '保留历史横屏比例',
      outputDirToken: 'output-directory-token',
      assets: [
        { fileToken: 'r2v-image-1', name: 'one.jpg' },
        { fileToken: 'r2v-image-2', name: 'two.jpg' },
      ],
      parameters: { ratio: '16:9', resolution: '1080P', duration: 8, watermark: true },
    })
    await nextTick()

    assert.equal(workbench.resolvedModelId.value, 'happyhorse-1.1-r2v')
    assert.equal(workbench.form.ratio, '16:9')
    assert.equal(workbench.form.resolution, '1080P')
    assert.equal(workbench.form.duration, 8)
  } finally {
    stop()
  }
})

test('explicit generation saves the edited draft before starting its first run', async () => {
  const calls = []
  const workbench = await setupWorkbench({
    async updateAiVideoJob(jobId, payload) {
      calls.push(['update', jobId, payload])
      return { data: { job: { id: jobId, status: 'draft', ...payload } } }
    },
    async retryAiVideoJob(jobId, payload) {
      calls.push(['retry', jobId, payload])
      return { data: { job: { id: jobId, status: 'queued' } } }
    },
    async createAiVideoJob(payload) {
      calls.push(['create', payload])
      throw new Error('editing a draft must not create another job')
    },
    async listAiVideoJobs() { return { data: { jobs: [] } } },
  })
  workbench.editingDraftJobId.value = 'job-draft-edit'
  workbench.form.prompt = '编辑完成后显式生成'
  workbench.form.outputDirToken = 'directory-token-output'
  workbench.form.assets = [{ fileToken: 'image-token', name: '商品图.png' }]

  await workbench.submitJob()

  assert.deepEqual(calls.map(call => call.slice(0, 2)), [
    ['update', 'job-draft-edit'],
    ['retry', 'job-draft-edit'],
  ])
  assert.equal(calls[0][2].outputDirToken, 'directory-token-output')
  assert.equal(calls[0][2].assets[0].fileToken, 'image-token')
  assert.equal(JSON.stringify(calls[0][2]).includes('localPath'), false)
  assert.equal(workbench.editingDraftJobId.value, '')
})

test('image selection stores opaque file tokens and sends no local paths', async () => {
  let selectCalls = 0
  const workbench = await setupWorkbench({
    async selectAiVideoImages() {
      selectCalls += 1
      return {
        items: [
          { fileToken: 'file-token-1', name: 'look-1.png', size: 123 },
          { fileToken: 'file-token-2', name: 'look-2.png', size: 456 },
        ],
      }
    },
    async getAiVideoMediaUrl(fileToken) {
      return { ok: true, media_url: `crawshrimp-media://local/${fileToken}` }
    },
  })

  await workbench.chooseImages()
  assert.equal(selectCalls, 1)
  assert.deepEqual(
    workbench.form.assets.map(({ fileToken, name }) => ({ fileToken, name })),
    [
      { fileToken: 'file-token-1', name: 'look-1.png' },
      { fileToken: 'file-token-2', name: 'look-2.png' },
    ],
  )
  const payload = workbench.buildAssetsPayload()
  assert.deepEqual(payload.map(({ fileToken }) => fileToken), ['file-token-1', 'file-token-2'])
  assert.equal(JSON.stringify(payload).includes('localPath'), false)
  assert.equal(JSON.stringify(payload).includes('/Users/'), false)
})

test('model selection uses the current model card as an expandable dropdown', async () => {
  const source = fs.readFileSync(
    path.join(appRoot, 'src/renderer/views/AiVideoGenerationWorkbench.vue'),
    'utf8',
  )
  assert.doesNotMatch(source, /<label class="avg-model-select-label"[^>]*>视频模型<\/label>/)
  assert.doesNotMatch(source, /id="avg-video-model-select"/)
  assert.doesNotMatch(source, /class="avg-model-select"/)
  assert.match(source, /<button[^>]*class="avg-model-select-current"[^>]*type="button"/)
  assert.match(source, /:aria-expanded="modelPickerOpen"/)
  assert.match(source, /role="listbox"/)
  assert.match(source, /v-for="model in modelOptions"/)
  assert.match(source, /@click="selectProvider\(model\.id\)"/)
  assert.match(source, /<img class="avg-provider-mark" :src="activeMeta\.mark"/)
  assert.match(source, /<img class="avg-provider-mark" :src="model\.mark"/)
  assert.match(source, /import volcengineMark from '\.\.\/assets\/ai-video-generation\/volcengine-mark\.png'/)
  assert.match(source, /import aliyunMark from '\.\.\/assets\/ai-video-generation\/aliyun-mark\.png'/)
  assert.match(source, /const modelPickerOpen = ref\(false\)/)
  assert.match(source, /function toggleModelPicker\(\)/)
  assert.doesNotMatch(source, /v-model="form\.provider"/)
})

test('provider-specific media sections keep advanced URL inputs collapsed by default', async () => {
  const source = fs.readFileSync(
    path.join(appRoot, 'src/renderer/views/AiVideoGenerationWorkbench.vue'),
    'utf8',
  )
  assert.match(source, /v-if="showPromptInput"/)
  assert.match(source, /<section v-if="!isPixVerse" class="avg-section">/)
  assert.match(source, /<details class="avg-advanced-panel">/)
  assert.match(source, /Kling 素材 URL/)
  assert.match(source, /URL \/ oss URL 输入/)
  assert.doesNotMatch(source, /<details[^>]*open/)
})

test('Semir Bailian gateway hides local cost estimate', async () => {
  const workbench = await setupWorkbench()
  workbench.config.value = {
    providers: {
      happyhorse: {
        configured: true,
        cliReady: true,
        pricingEstimateAvailable: false,
      },
    },
  }

  workbench.selectProvider('happyhorse')
  assert.equal(workbench.costEstimate.value.known, true)
  assert.equal(workbench.showCostEstimate.value, false)
})

test('switching video models clears model-specific media inputs', async () => {
  const workbench = await setupWorkbench()

  workbench.selectProvider('pixverse-motioncontrol')
  workbench.form.pixverseImageUrl = 'https://example.com/character.png'
  workbench.form.pixverseVideoUrl = 'https://example.com/motion.mp4'
  workbench.addAssetItems({ fileToken: 'pix-image-token', name: 'character.png', role: 'image_url' })

  workbench.selectProvider('kling-v3')
  workbench.setKlingMediaUrl('first_frame', 'oss://dashscope-instant/demo/start.jpg')

  assert.equal(workbench.form.pixverseImageUrl, '')
  assert.equal(workbench.form.pixverseVideoUrl, '')
  assert.deepEqual(workbench.form.assets, [])
  assert.deepEqual(workbench.form.klingMedia, [
    { type: 'first_frame', url: 'oss://dashscope-instant/demo/start.jpg' },
  ])

  workbench.selectProvider('seedance')
  assert.deepEqual(workbench.form.klingMedia, [])
})

test('PixVerse local image and video are submitted as opaque assets', async () => {
  const selected = [
    { fileToken: 'pix-image-token', name: 'character.png', kind: 'image', mimeType: 'image/png' },
    { fileToken: 'pix-video-token', name: 'motion.mp4', kind: 'video', mimeType: 'video/mp4' },
  ]
  const workbench = await setupWorkbench({
    async selectAiVideoMedia(options) {
      return { items: [options.mediaKind === 'video' ? selected[1] : selected[0]] }
    },
    async getAiVideoMediaUrl(fileToken) {
      return { ok: true, media_url: `crawshrimp-media://local/${fileToken}` }
    },
  })

  workbench.selectProvider('pixverse-motioncontrol')
  await workbench.choosePixverseAsset('image')
  await workbench.choosePixverseAsset('video')

  assert.equal(workbench.pixverseImageAsset.value.fileToken, 'pix-image-token')
  assert.equal(workbench.pixverseVideoAsset.value.fileToken, 'pix-video-token')
  assert.deepEqual(workbench.buildAssetsPayload(), [
    { role: 'image_url', sourceType: 'local_file', fileToken: 'pix-image-token', sortOrder: 0 },
    { role: 'video_url', sourceType: 'local_file', fileToken: 'pix-video-token', sortOrder: 1 },
  ])
  assert.equal(workbench.buildParameters().imageUrl, '')
  assert.equal(workbench.buildParameters().videoUrl, '')
})

test('Kling Omni local videos get feature and base roles by default', async () => {
  const workbench = await setupWorkbench()
  workbench.selectProvider('kling-omni')
  workbench.addAssetItems([
    { fileToken: 'feature-video-token', name: 'feature.mp4', kind: 'video', mimeType: 'video/mp4' },
    { fileToken: 'base-video-token', name: 'base.mov', kind: 'video', mimeType: 'video/quicktime' },
  ])

  assert.deepEqual(workbench.form.assets.map(asset => asset.role), ['feature', 'base'])
  assert.deepEqual(workbench.buildAssetsPayload(), [
    { role: 'feature', sourceType: 'local_file', fileToken: 'feature-video-token', sortOrder: 0 },
    { role: 'base', sourceType: 'local_file', fileToken: 'base-video-token', sortOrder: 1 },
  ])
})

test('Kling URL media is included in parameters without local paths', async () => {
  const workbench = await setupWorkbench()
  workbench.selectProvider('kling-v3')
  workbench.setKlingMediaUrl('first_frame', 'oss://dashscope-instant/demo/start.jpg')
  workbench.setKlingMediaUrl('last_frame', 'https://example.com/end.jpg')

  const params = workbench.buildParameters()
  assert.deepEqual(params.media, [
    { type: 'first_frame', url: 'oss://dashscope-instant/demo/start.jpg' },
    { type: 'last_frame', url: 'https://example.com/end.jpg' },
  ])
  assert.equal(JSON.stringify(params).includes('/Users/'), false)
})

test('output selection stores an opaque directory token separately from its display name', async () => {
  let receivedOptions
  const workbench = await setupWorkbench({
    async selectAiVideoDirectory(options) {
      receivedOptions = options
      return { directoryToken: 'directory-token-output', name: '抓虾 AI 视频', scope: 'output' }
    },
  })

  await workbench.chooseOutputDir()

  assert.equal(receivedOptions.scope, 'output')
  assert.equal(workbench.form.outputDirToken, 'directory-token-output')
  assert.equal(workbench.outputDirectoryName.value, '抓虾 AI 视频')
  assert.equal(workbench.form.outputDirToken.includes('/'), false)
})

test('activation refreshes default output capability without overwriting a user selection', async () => {
  let configVersion = 0
  const workbench = await setupWorkbench({
    async getAiVideoConfig() {
      configVersion += 1
      return {
        providers: {},
        defaultOutputDirToken: `default-output-token-${configVersion}`,
        defaultOutputDirName: '抓虾AI生视频',
      }
    },
    async selectAiVideoDirectory() {
      return { directoryToken: 'manual-output-token', name: '手动输出', scope: 'output' }
    },
  })

  await workbench.loadConfig()
  assert.equal(workbench.form.outputDirToken, 'default-output-token-1')
  assert.equal(workbench.outputDirectorySource.value, 'default')

  await workbench.loadConfig()
  assert.equal(workbench.form.outputDirToken, 'default-output-token-2')

  await workbench.chooseOutputDir()
  assert.equal(workbench.form.outputDirToken, 'manual-output-token')
  assert.equal(workbench.outputDirectorySource.value, 'manual')

  await workbench.loadConfig()
  assert.equal(workbench.form.outputDirToken, 'manual-output-token')
  assert.equal(workbench.outputDirectoryName.value, '手动输出')
})

test('config refresh does not replace a reused job output capability', async () => {
  const workbench = await setupWorkbench({
    async getAiVideoConfig() {
      return {
        providers: {},
        defaultOutputDirToken: 'default-output-token',
        defaultOutputDirName: '默认输出',
      }
    },
  })
  workbench.reuseParams({
    id: 'job-reused-output',
    provider: 'seedance',
    model: 'doubao-seedance-2-0-260128',
    prompt: '复用输出目录',
    outputDirToken: 'job-output-token',
    outputDirName: '历史输出',
    assets: [],
    parameters: { ratio: '9:16', resolution: '720p', duration: 5 },
  })

  await workbench.loadConfig()

  assert.equal(workbench.form.outputDirToken, 'job-output-token')
  assert.equal(workbench.outputDirectoryName.value, '历史输出')
  assert.equal(workbench.outputDirectorySource.value, 'job')
})

test('reference library scans an input directory token and keeps file tokens', async () => {
  const listCalls = []
  const workbench = await setupWorkbench({
    async selectAiVideoDirectory(options) {
      assert.equal(options.scope, 'input')
      return { directoryToken: 'directory-token-input', name: '夏装素材', scope: 'input' }
    },
    async listAiVideoDirectory(directoryToken, options) {
      listCalls.push({ directoryToken, options })
      return {
        items: [
          { fileToken: 'library-file-1', name: 'look.jpg', relativePath: 'SKU/look.jpg', size: 10 },
        ],
      }
    },
    async getAiVideoMediaUrl(fileToken) {
      return { ok: true, media_url: `crawshrimp-media://local/${fileToken}` }
    },
  })

  await workbench.chooseLibraryRoot()

  assert.equal(workbench.libraryDirectoryToken.value, 'directory-token-input')
  assert.equal(workbench.libraryDirectoryName.value, '夏装素材')
  assert.equal(listCalls.length, 1)
  assert.equal(listCalls[0].directoryToken, 'directory-token-input')
  assert.equal(workbench.libraryItems.value[0].fileToken, 'library-file-1')
  assert.equal(JSON.stringify(workbench.libraryItems.value).includes('localPath'), false)
})

test('reference library restores a fresh input capability from main storage', async () => {
  const requestedScopes = []
  const scannedTokens = []
  const workbench = await setupWorkbench({
    async getSavedAiVideoDirectory(scope) {
      requestedScopes.push(scope)
      return { directoryToken: 'fresh-directory-token', name: '持久图库', scope: 'input' }
    },
    async listAiVideoDirectory(directoryToken) {
      scannedTokens.push(directoryToken)
      return { ok: true, items: [] }
    },
  })

  await workbench.restoreSavedLibraryDirectory()
  await workbench.openImageLibrary()

  assert.deepEqual(requestedScopes, ['input'])
  assert.deepEqual(scannedTokens, ['fresh-directory-token'])
  assert.equal(workbench.libraryDirectoryToken.value, 'fresh-directory-token')
  assert.equal(workbench.libraryDirectoryName.value, '持久图库')
})

test('legacy renderer-stored library capabilities are deleted during migration', async () => {
  const removed = []
  const workbench = await setupWorkbench({}, {
    localStorage: {
      getItem() { return null },
      setItem() { throw new Error('capabilities must not be persisted in renderer storage') },
      removeItem(key) { removed.push(key) },
    },
  })

  workbench.clearLegacyLibraryCapabilities()

  assert.deepEqual(removed.sort(), [
    'crawshrimp.ai-video.reference-library-capability',
    'crawshrimp.ai-video.reference-library-root',
    'crawshrimp.bala-ai-video.workspace-directory-token',
  ].sort())
})

test('expired library capabilities are refreshed once and rescanned', async () => {
  const scannedTokens = []
  const workbench = await setupWorkbench({
    async getSavedAiVideoDirectory() {
      return { directoryToken: 'refreshed-directory-token', name: '恢复图库', scope: 'input' }
    },
    async listAiVideoDirectory(directoryToken) {
      scannedTokens.push(directoryToken)
      if (directoryToken === 'expired-directory-token') {
        const error = new Error('AI 视频 capability 已过期')
        error.code = 'PATH_CAPABILITY_EXPIRED'
        throw error
      }
      return { ok: true, items: [] }
    },
  })

  await workbench.scanLibrary('expired-directory-token')

  assert.deepEqual(scannedTokens, ['expired-directory-token', 'refreshed-directory-token'])
  assert.equal(workbench.libraryDirectoryToken.value, 'refreshed-directory-token')
  assert.equal(workbench.libraryError.value, '')
})

test('a late library scan cannot overwrite a newer directory selection', async () => {
  const firstScan = deferred()
  const secondScan = deferred()
  const workbench = await setupWorkbench({
    listAiVideoDirectory(directoryToken) {
      return directoryToken === 'directory-token-a' ? firstScan.promise : secondScan.promise
    },
  })

  const first = workbench.scanLibrary('directory-token-a')
  const second = workbench.scanLibrary('directory-token-b')
  secondScan.resolve({
    ok: true,
    items: [{ fileToken: 'file-token-b', name: 'b.jpg', relativePath: 'B/b.jpg', size: 2 }],
  })
  await second
  firstScan.resolve({
    ok: true,
    items: [{ fileToken: 'file-token-a', name: 'a.jpg', relativePath: 'A/a.jpg', size: 1 }],
  })
  await first

  assert.deepEqual(workbench.libraryItems.value.map(item => item.name), ['b.jpg'])
  assert.equal(workbench.libraryLoading.value, false)
  assert.equal(workbench.libraryError.value, '')
})

test('new library scans and close release stale preview caches but retain selected assets', async () => {
  const workbench = await setupWorkbench({
    async readAiVideoImageThumbnail(fileToken) {
      return { ok: true, data_url: `data:image/jpeg;base64,${fileToken}` }
    },
    async listAiVideoDirectory(directoryToken) {
      if (directoryToken === 'directory-generation-1') {
        return {
          ok: true,
          items: [
            { fileToken: 'library-stale-token', name: 'stale.jpg', relativePath: 'stale.jpg', size: 1 },
            { fileToken: 'library-selected-token', name: 'selected.jpg', relativePath: 'selected.jpg', size: 2 },
          ],
        }
      }
      return {
        ok: true,
        items: [{ fileToken: 'library-current-token', name: 'current.jpg', relativePath: 'current.jpg', size: 3 }],
      }
    },
  })

  await workbench.scanLibrary('directory-generation-1')
  await new Promise(resolve => setTimeout(resolve, 0))
  workbench.form.assets = [{ fileToken: 'library-selected-token', name: 'selected.jpg' }]
  workbench.imagePreviewUrls['thumb:library-stale-token'] = 'data:image/jpeg;base64,STALE'
  workbench.imagePreviewUrls['thumb:library-selected-token'] = 'data:image/jpeg;base64,SELECTED'
  workbench.mediaUrlCache['thumb:library-stale-token'] = 'data:image/jpeg;base64,STALE'
  workbench.mediaUrlCache['thumb:library-selected-token'] = 'data:image/jpeg;base64,SELECTED'

  await workbench.scanLibrary('directory-generation-2')

  assert.equal(workbench.imagePreviewUrls['thumb:library-stale-token'], undefined)
  assert.equal(workbench.mediaUrlCache['thumb:library-stale-token'], undefined)
  assert.equal(workbench.imagePreviewUrls['thumb:library-selected-token'], 'data:image/jpeg;base64,SELECTED')

  workbench.imagePreviewUrls['thumb:library-current-token'] = 'data:image/jpeg;base64,CURRENT'
  workbench.mediaUrlCache['thumb:library-current-token'] = 'data:image/jpeg;base64,CURRENT'
  workbench.closeImageLibrary()

  assert.equal(workbench.imagePreviewUrls['thumb:library-current-token'], undefined)
  assert.equal(workbench.mediaUrlCache['thumb:library-current-token'], undefined)
  assert.equal(workbench.imagePreviewUrls['thumb:library-selected-token'], 'data:image/jpeg;base64,SELECTED')
})

test('activation lifecycle requests a fresh saved library capability', () => {
  const source = fs.readFileSync(
    path.join(appRoot, 'src/renderer/views/AiVideoGenerationWorkbench.vue'),
    'utf8',
  )
  const activated = source.slice(source.indexOf('async function activateWorkbench()'), source.indexOf('function deactivateWorkbench()'))
  assert.match(activated, /await restoreSavedLibraryDirectory\(\)/)
})

test('grid previews prefer bounded thumbnails and limit concurrent loads', async () => {
  let active = 0
  let maxActive = 0
  let mediaCalls = 0
  let thumbnailCalls = 0
  const workbench = await setupWorkbench({
    async getAiVideoMediaUrl(fileToken) {
      mediaCalls += 1
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active -= 1
      return { ok: true, media_url: `crawshrimp-media://local/${fileToken}` }
    },
    async readAiVideoImageThumbnail() {
      thumbnailCalls += 1
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active -= 1
      return { ok: true, data_url: 'data:image/jpeg;base64,AAAA' }
    },
  })
  const tokens = Array.from({ length: 6 }, (_, index) => `opaque-${index}.jpg`)

  const urls = await Promise.all(tokens.map(fileToken => workbench.ensureImagePreview(fileToken)))

  assert.equal(thumbnailCalls, tokens.length)
  assert.equal(mediaCalls, 0)
  assert.ok(maxActive <= 3, `expected at most 3 concurrent previews, saw ${maxActive}`)
  assert.ok(urls.every(url => url.startsWith('data:image/jpeg;base64,')))
})

test('completed detail video loads from the run output media token', async () => {
  const requested = []
  const workbench = await setupWorkbench({
    async getAiVideoMediaUrl(fileToken) {
      requested.push(fileToken)
      return { ok: true, media_url: `crawshrimp-media://local/${fileToken}` }
    },
  })
  const job = {
    id: 'job-completed',
    status: 'completed',
    currentRun: { output: { localVideoToken: 'video-token-1' } },
  }
  workbench.detailJob.value = job

  await workbench.loadDetailVideo(job)

  assert.deepEqual(requested, ['video-token-1'])
  assert.equal(workbench.detailVideoSrc.value, 'crawshrimp-media://local/video-token-1')
})

test('playing a completed card loads only that card video without opening its details', async () => {
  const requested = []
  const workbench = await setupWorkbench({
    async getAiVideoMediaUrl(fileToken) {
      requested.push(fileToken)
      return { ok: true, media_url: `crawshrimp-media://local/${fileToken}` }
    },
  })
  const job = {
    id: 'job-inline-video',
    status: 'completed',
    currentRun: { output: { localVideoToken: 'inline-video-token' } },
  }

  await workbench.playInlineVideo(job)

  assert.deepEqual(requested, ['inline-video-token'])
  assert.equal(workbench.inlinePlayingJobId.value, job.id)
  assert.equal(workbench.inlineVideoSrc[job.id], 'crawshrimp-media://local/inline-video-token')
  assert.equal(workbench.detailJob.value, null)
})

test('opening a completed video delegates its media capability to token-only IPC', async () => {
  const opened = []
  let legacyCalls = 0
  const workbench = await setupWorkbench({
    async openAiVideoFile(fileToken) {
      opened.push(fileToken)
      return { ok: true }
    },
    async openFile() {
      legacyCalls += 1
      return { ok: true }
    },
  })

  await workbench.openLocalFile('video-capability-token')

  assert.deepEqual(opened, ['video-capability-token'])
  assert.equal(legacyCalls, 0)
})

test('archive retry is single-flight per run', async () => {
  const pending = deferred()
  let archiveCalls = 0
  const workbench = await setupWorkbench({
    retryAiVideoArchive() {
      archiveCalls += 1
      return pending.promise
    },
    async listAiVideoJobs() { return { data: { jobs: [] } } },
  })
  const job = { id: 'job-archive', currentRunId: 'run-archive' }

  const first = workbench.retryArchive(job)
  const second = workbench.retryArchive(job)
  assert.equal(archiveCalls, 1)
  assert.equal(workbench.isRetryingArchive(job), true)

  pending.resolve({ ok: true })
  await Promise.all([first, second])
  assert.equal(archiveCalls, 1)
  assert.equal(workbench.isRetryingArchive(job), false)
})

test('late media resolution cannot replace the currently opened job video', async () => {
  const firstMedia = deferred()
  const secondMedia = deferred()
  const workbench = await setupWorkbench({
    getAiVideoMediaUrl(fileToken) {
      return fileToken === 'video-token-a' ? firstMedia.promise : secondMedia.promise
    },
  })
  const firstJob = {
    id: 'job-a',
    status: 'completed',
    currentRun: { output: { localVideoToken: 'video-token-a' } },
  }
  const secondJob = {
    id: 'job-b',
    status: 'completed',
    currentRun: { output: { localVideoToken: 'video-token-b' } },
  }

  workbench.detailJob.value = firstJob
  const firstLoad = workbench.loadDetailVideo(firstJob)
  workbench.detailJob.value = secondJob
  const secondLoad = workbench.loadDetailVideo(secondJob)

  secondMedia.resolve({ ok: true, media_url: 'crawshrimp-media://local/video-token-b' })
  await secondLoad
  firstMedia.resolve({ ok: true, media_url: 'crawshrimp-media://local/video-token-a' })
  await firstLoad

  assert.equal(workbench.detailVideoSrc.value, 'crawshrimp-media://local/video-token-b')
  assert.equal(workbench.detailVideoLoading.value, false)
})

test('an open running detail loads its video when polling reports completion', async () => {
  const completedJob = {
    id: 'job-polling',
    status: 'completed',
    currentRun: { output: { localVideoToken: 'video-token-completed' } },
  }
  const workbench = await setupWorkbench({
    async listAiVideoJobs() { return { data: { jobs: [completedJob] } } },
    async getAiVideoMediaUrl(fileToken) {
      return { ok: true, media_url: `crawshrimp-media://local/${fileToken}` }
    },
  })
  workbench.detailJob.value = { id: 'job-polling', status: 'running', currentRun: { output: {} } }

  await workbench.reloadJobs()

  assert.equal(workbench.detailJob.value.status, 'completed')
  assert.equal(workbench.detailVideoSrc.value, 'crawshrimp-media://local/video-token-completed')
})

test('a late jobs response cannot roll the queue back to an older snapshot', async () => {
  const firstList = deferred()
  const secondList = deferred()
  let calls = 0
  const workbench = await setupWorkbench({
    listAiVideoJobs() {
      calls += 1
      return calls === 1 ? firstList.promise : secondList.promise
    },
  })

  const first = workbench.reloadJobs()
  const second = workbench.reloadJobs()
  secondList.resolve({ data: { jobs: [{ id: 'job-race', status: 'completed' }] } })
  await second
  firstList.resolve({ data: { jobs: [{ id: 'job-race', status: 'running' }] } })
  await first

  assert.equal(workbench.jobs.value[0].status, 'completed')
})

test('polling does not reset an open video when only its short-lived capability rotates', async () => {
  const mediaRequests = []
  const previousJob = {
    id: 'job-stable-video',
    status: 'completed',
    currentRunId: 'run-stable-video',
    currentRun: {
      id: 'run-stable-video',
      output: { localVideoToken: 'video-token-old', videoFileName: 'output.mp4' },
    },
  }
  const refreshedJob = {
    ...previousJob,
    currentRun: {
      ...previousJob.currentRun,
      output: { localVideoToken: 'video-token-new', videoFileName: 'output.mp4' },
    },
  }
  const workbench = await setupWorkbench({
    async listAiVideoJobs() { return { data: { jobs: [refreshedJob] } } },
    async getAiVideoMediaUrl(fileToken) {
      mediaRequests.push(fileToken)
      return { ok: true, media_url: `crawshrimp-media://local/${fileToken}` }
    },
  })
  workbench.detailJob.value = previousJob
  workbench.detailVideoSrc.value = 'crawshrimp-media://local/video-token-old'

  await workbench.reloadJobs()

  assert.deepEqual(mediaRequests, [])
  assert.equal(workbench.detailVideoSrc.value, 'crawshrimp-media://local/video-token-old')
  assert.equal(workbench.detailJob.value.currentRun.output.localVideoToken, 'video-token-new')
})

test('a missing detail URL is restored with the latest capability even for the same video', async () => {
  const mediaRequests = []
  const previousJob = {
    id: 'job-missing-video-url',
    status: 'completed',
    currentRunId: 'run-missing-video-url',
    currentRun: {
      id: 'run-missing-video-url',
      output: { localVideoToken: 'video-token-expired', videoFileName: 'output.mp4' },
    },
  }
  const refreshedJob = {
    ...previousJob,
    currentRun: {
      ...previousJob.currentRun,
      output: { localVideoToken: 'video-token-fresh', videoFileName: 'output.mp4' },
    },
  }
  const workbench = await setupWorkbench({
    async listAiVideoJobs() { return { data: { jobs: [refreshedJob] } } },
    async getAiVideoMediaUrl(fileToken) {
      mediaRequests.push(fileToken)
      return { ok: true, media_url: `crawshrimp-media://local/${fileToken}` }
    },
  })
  workbench.detailJob.value = previousJob
  workbench.detailVideoSrc.value = ''

  await workbench.reloadJobs()

  assert.deepEqual(mediaRequests, ['video-token-fresh'])
  assert.equal(workbench.detailVideoSrc.value, 'crawshrimp-media://local/video-token-fresh')
})

test('video playback error refreshes its capability once then shows a visible fallback', async () => {
  let listCalls = 0
  const mediaRequests = []
  const previousJob = {
    id: 'job-playback-recovery',
    status: 'completed',
    currentRunId: 'run-playback-recovery',
    currentRun: {
      id: 'run-playback-recovery',
      output: { localVideoToken: 'video-token-expired', videoFileName: 'output.mp4' },
    },
  }
  const refreshedJob = {
    ...previousJob,
    currentRun: {
      ...previousJob.currentRun,
      output: { localVideoToken: 'video-token-refreshed', videoFileName: 'output.mp4' },
    },
  }
  const workbench = await setupWorkbench({
    async listAiVideoJobs() {
      listCalls += 1
      return { data: { jobs: [refreshedJob] } }
    },
    async getAiVideoMediaUrl(fileToken) {
      mediaRequests.push(fileToken)
      return { ok: true, media_url: `crawshrimp-media://local/${fileToken}` }
    },
  })
  workbench.detailJob.value = previousJob
  workbench.detailVideoSrc.value = 'crawshrimp-media://local/video-token-expired'
  workbench.mediaUrlCache['video-token-expired'] = 'crawshrimp-media://local/video-token-expired'

  await workbench.handleDetailVideoPlaybackError()

  assert.equal(listCalls, 1)
  assert.deepEqual(mediaRequests, ['video-token-refreshed'])
  assert.equal(workbench.detailVideoSrc.value, 'crawshrimp-media://local/video-token-refreshed')
  assert.equal(workbench.detailVideoError.value, '')

  await workbench.handleDetailVideoPlaybackError()

  assert.equal(listCalls, 1)
  assert.deepEqual(mediaRequests, ['video-token-refreshed'])
  assert.equal(workbench.detailVideoSrc.value, '')
  assert.match(workbench.detailVideoError.value, /播放失败.*打开本地文件/)

  const source = fs.readFileSync(
    path.join(appRoot, 'src/renderer/views/AiVideoGenerationWorkbench.vue'),
    'utf8',
  )
  assert.match(source, /<video[\s\S]*@error="handleDetailVideoPlaybackError"/)
})

test('poster cache refreshes when a completed job gains a poster token', async () => {
  const workbench = await setupWorkbench({
    async getAiVideoMediaUrl(fileToken) {
      return { ok: true, media_url: `crawshrimp-media://local/${fileToken}` }
    },
  })
  const running = {
    id: 'job-cover',
    status: 'running',
    assets: [{ fileToken: 'input-cover.jpg', name: 'input.jpg' }],
    currentRun: { output: {} },
  }
  const completed = {
    ...running,
    status: 'completed',
    currentRun: { output: { localPosterToken: 'poster-cover.jpg' } },
  }

  await workbench.ensureJobCover(running)
  assert.equal(workbench.jobCoverSrc(running), 'crawshrimp-media://local/input-cover.jpg')
  await workbench.ensureJobCover(completed)

  assert.equal(workbench.jobCoverSrc(completed), 'crawshrimp-media://local/poster-cover.jpg')
})

test('poster cover stays rendered when polling only rotates its capability', async () => {
  const mediaRequests = []
  const previousJob = {
    id: 'job-stable-poster',
    status: 'completed',
    currentRunId: 'run-stable-poster',
    currentRun: {
      id: 'run-stable-poster',
      output: { localPosterToken: 'poster-token-old', posterFileName: 'poster.jpg' },
    },
  }
  const refreshedJob = {
    ...previousJob,
    currentRun: {
      ...previousJob.currentRun,
      output: { localPosterToken: 'poster-token-new', posterFileName: 'poster.jpg' },
    },
  }
  const workbench = await setupWorkbench({
    async getAiVideoMediaUrl(fileToken) {
      mediaRequests.push(fileToken)
      return { ok: true, media_url: `crawshrimp-media://local/${fileToken}` }
    },
  })

  await workbench.ensureJobCover(previousJob)
  await workbench.ensureJobCover(refreshedJob)

  assert.deepEqual(mediaRequests, ['poster-token-old'])
  assert.equal(workbench.jobCoverSrc(refreshedJob), 'crawshrimp-media://local/poster-token-old')
})

test('reference fallback cover stays rendered when only its capability rotates', async () => {
  const mediaRequests = []
  const previousJob = {
    id: 'job-stable-reference-cover',
    status: 'failed',
    assets: [{
      id: 'asset-stable-reference',
      fileToken: 'reference-token-old',
      name: 'look.jpg',
      sizeBytes: 1234,
      sha256: 'stable-image-digest',
    }],
    currentRun: { id: 'run-stable-reference-cover', output: {} },
  }
  const refreshedJob = {
    ...previousJob,
    assets: [{
      ...previousJob.assets[0],
      fileToken: 'reference-token-new',
    }],
  }
  const workbench = await setupWorkbench({
    async getAiVideoMediaUrl(fileToken) {
      mediaRequests.push(fileToken)
      return { ok: true, media_url: `crawshrimp-media://local/${fileToken}` }
    },
  })

  await workbench.ensureJobCover(previousJob)
  await workbench.ensureJobCover(refreshedJob)

  assert.deepEqual(mediaRequests, ['reference-token-old'])
  assert.equal(workbench.jobCoverSrc(refreshedJob), 'crawshrimp-media://local/reference-token-old')
})

test('detail modal traps Tab focus inside its enabled controls', async () => {
  const workbench = await setupWorkbench()
  const first = focusable('close')
  const last = focusable('last action')
  workbench.detailJob.value = { id: 'job-modal', status: 'failed', currentRun: { error: {} } }
  workbench.modalRef.value = {
    querySelectorAll() { return [first, last] },
    focus() { globalThis.__focusedWorkbenchElement = this },
  }
  let prevented = 0

  workbench.onKeydown({
    key: 'Tab',
    shiftKey: false,
    target: last,
    preventDefault() { prevented += 1 },
  })

  assert.equal(globalThis.__focusedWorkbenchElement, first)
  assert.equal(prevented, 1)
})

test('opening the reference library focuses its first item or directory picker', async () => {
  const firstLibraryItem = focusable('first library item')
  const directoryPicker = focusable('directory picker')
  const workbench = await setupWorkbench({
    async listAiVideoDirectory() {
      return { items: [{ fileToken: 'library-image-token', name: 'look.jpg' }] }
    },
  })
  const libraryTrigger = focusable('library trigger')
  if (workbench.libraryModalRef) {
    workbench.libraryModalRef.value = {
      querySelector(selector) {
        return selector === '[data-library-token]' ? firstLibraryItem : directoryPicker
      },
    }
  }
  workbench.libraryDirectoryToken.value = 'library-directory-token'

  await workbench.openImageLibrary({ currentTarget: libraryTrigger })
  await nextTick()

  assert.equal(globalThis.__focusedWorkbenchElement, firstLibraryItem)

  workbench.closeImageLibrary()
  await nextTick()
  workbench.libraryDirectoryToken.value = ''
  await workbench.openImageLibrary({ currentTarget: libraryTrigger })
  await nextTick()

  assert.equal(globalThis.__focusedWorkbenchElement, directoryPicker)
})

test('reference library traps Tab and Shift+Tab inside its dialog', async () => {
  const workbench = await setupWorkbench()
  const first = focusable('library first')
  const last = focusable('library last')
  if (workbench.libraryModalRef) {
    workbench.libraryModalRef.value = {
      querySelectorAll() { return [first, last] },
      focus() { globalThis.__focusedWorkbenchElement = this },
    }
  }
  workbench.libraryOpen.value = true
  let prevented = 0

  workbench.onKeydown({
    key: 'Tab',
    shiftKey: false,
    target: last,
    preventDefault() { prevented += 1 },
  })
  assert.equal(globalThis.__focusedWorkbenchElement, first)

  workbench.onKeydown({
    key: 'Tab',
    shiftKey: true,
    target: first,
    preventDefault() { prevented += 1 },
  })

  assert.equal(globalThis.__focusedWorkbenchElement, last)
  assert.equal(prevented, 2)
})

test('Escape closes the reference library and restores focus to its trigger', async () => {
  const workbench = await setupWorkbench()
  const libraryTrigger = focusable('library trigger')

  await workbench.openImageLibrary({ currentTarget: libraryTrigger })
  assert.equal(workbench.libraryOpen.value, true)
  let prevented = 0

  workbench.onKeydown({
    key: 'Escape',
    preventDefault() { prevented += 1 },
  })
  await nextTick()

  assert.equal(workbench.libraryOpen.value, false)
  assert.equal(prevented, 1)
  assert.equal(globalThis.__focusedWorkbenchElement?.name, libraryTrigger.name)
})

test('closing a detail opened from history restores focus to the visible history trigger', async () => {
  const workbench = await setupWorkbench()
  const historyTrigger = focusable('history trigger')
  const hiddenHistoryItem = focusable('hidden history item')
  workbench.openHistoryDrawer({ currentTarget: historyTrigger })
  globalThis.document.activeElement = hiddenHistoryItem

  workbench.openHistoryItem(
    { id: 'job-from-history', status: 'failed', currentRun: { error: {} } },
    { currentTarget: hiddenHistoryItem },
  )
  workbench.closeDetail()
  await nextTick()

  assert.equal(workbench.openHistory.value, false)
  assert.equal(globalThis.__focusedWorkbenchElement?.name, historyTrigger.name)
})

test('modal and history surfaces make background and hidden drawer controls inert', () => {
  const source = fs.readFileSync(
    path.join(appRoot, 'src/renderer/views/AiVideoGenerationWorkbench.vue'),
    'utf8',
  )

  assert.match(source, /class="avg-page-head"\s+:inert="backgroundInert \|\| undefined"/)
  assert.match(source, /class="avg-main"\s+:inert="backgroundInert \|\| undefined"/)
  assert.match(source, /class="avg-drawer"[\s\S]*?:inert="openHistory \? undefined : true"/)
})

test('video task covers use a fixed 3:4 portrait frame', () => {
  const source = fs.readFileSync(
    path.join(appRoot, 'src/renderer/views/AiVideoGenerationWorkbench.vue'),
    'utf8',
  )

  assert.match(source, /\.avg-thumb\s*\{[\s\S]*?aspect-ratio:\s*3\s*\/\s*4;/)
  assert.doesNotMatch(source, /\.avg-thumb\s*\{[\s\S]*?height:\s*168px;/)
})

test('task cards omit duplication and keep actions in one horizontal row', () => {
  const source = fs.readFileSync(
    path.join(appRoot, 'src/renderer/views/AiVideoGenerationWorkbench.vue'),
    'utf8',
  )

  assert.doesNotMatch(source, /复制为新任务|duplicateJob|canDuplicate|duplicateAiVideoJob/)
  assert.match(source, /@click\.stop="requestDeleteJob\(job\)"/)
  assert.match(source, /@click="confirmDeleteJob\(false\)"[\s\S]*?仅删除记录/)
  assert.match(source, /@click="confirmDeleteJob\(true\)"[\s\S]*?删除本地文件/)
  assert.match(source, /\.avg-task-actions\s*\{[\s\S]*?flex-wrap:\s*nowrap;/)
  assert.match(source, /\.avg-task-actions\s*\{[\s\S]*?overflow-x:\s*auto;/)
})
