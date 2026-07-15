import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function loadExports(params = {}) {
  const scriptPath = path.resolve('adapters/bala-ai-video-assistant/bala-ai-face-background-generate.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
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
  }
  context.globalThis = context
  await vm.runInNewContext(source, context, { filename: scriptPath })
  return exportsBox
}

test('normalizes selected source images and model ids', async () => {
  const helpers = await loadExports()

  assert.deepEqual(
    Array.from(helpers.normalizeSourceImagePaths({ paths: ['/tmp/a.jpg', ' ', '/tmp/b.png'] })),
    ['/tmp/a.jpg', '/tmp/b.png'],
  )
  assert.deepEqual(
    Array.from(helpers.normalizeModelRefIds('100女/标准.jpg\n73女/微笑.jpg，100男/正脸.jpg')),
    ['100女/标准.jpg', '73女/微笑.jpg', '100男/正脸.jpg'],
  )
})

test('buildPlanRows summarizes directory scan fallback and background prompt', async () => {
  const helpers = await loadExports()

  const rows = helpers.buildPlanRows({
    source_images: { paths: [] },
    material_root: '/Users/demo/巴拉AI视频素材',
    material_root_files: {
      paths: [
        { path: '/Users/demo/208326102205/01_模拍原图/a.jpg', relativePath: '208326102205/01_模拍原图/a.jpg' },
        { path: '/Users/demo/208326102205/02_商品细节图/b.jpg', relativePath: '208326102205/02_商品细节图/b.jpg' },
      ],
    },
    model_groups: ['100女', '100男'],
    background_prompt: '换成马尔代夫的海边',
  })

  assert.equal(rows.length, 1)
  assert.equal(rows[0]['素材图片数'], 2)
  assert.equal(rows[0]['素材目录'], '/Users/demo/巴拉AI视频素材')
  assert.equal(rows[0]['模特分组'], '100女、100男')
  assert.equal(rows[0]['背景Prompt'], '换成马尔代夫的海边')
  assert.equal(rows[0]['执行结果'], '待后端创建AI生图任务')
})

test('buildPlanRows reports missing background prompt before backend work', async () => {
  const helpers = await loadExports()

  const rows = helpers.buildPlanRows({
    operation_type: 'background_swap',
    source_images: { paths: ['/tmp/a.jpg'] },
    model_groups: ['100女'],
    background_prompt: '',
  })

  assert.equal(rows[0]['执行结果'], '缺少背景Prompt')
})

test('buildPlanRows validates four AI operation types independently', async () => {
  const helpers = await loadExports()

  const faceRows = helpers.buildPlanRows({
    operation_type: 'face_swap',
    source_images: { paths: ['/tmp/source.jpg'] },
    model_ref_ids: '100女/标准.jpg',
    background_prompt: '',
  })
  assert.equal(faceRows[0]['操作类型'], 'AI换脸')
  assert.equal(faceRows[0]['指定模特图'], '100女/标准.jpg')
  assert.equal(faceRows[0]['执行结果'], '待后端创建AI生图任务')

  const backgroundRows = helpers.buildPlanRows({
    operation_type: 'background_swap',
    source_images: { paths: ['/tmp/source.jpg'] },
    model_groups: [],
    background_prompt: '换成马尔代夫的海边',
  })
  assert.equal(backgroundRows[0]['操作类型'], 'AI换背景')
  assert.equal(backgroundRows[0]['背景Prompt'], '换成马尔代夫的海边')
  assert.equal(backgroundRows[0]['执行结果'], '待后端创建AI生图任务')

  const outfitRows = helpers.buildPlanRows({
    operation_type: 'outfit_swap',
    source_images: { paths: ['/tmp/model.jpg'] },
    garment_images: { paths: ['/tmp/garment.jpg'] },
    outfit_reference_images: { paths: ['/tmp/outfit.jpg'] },
    variant_reference_images: { paths: ['/tmp/variant.jpg'] },
    prompt_extra: '保留童装版型和颜色',
  })
  assert.equal(outfitRows[0]['操作类型'], 'AI换装')
  assert.equal(outfitRows[0]['服装图文件'], '/tmp/garment.jpg')
  assert.equal(outfitRows[0]['搭配参考图文件'], '/tmp/outfit.jpg')
  assert.equal(outfitRows[0]['同款不同色参考图文件'], '/tmp/variant.jpg')

  const poseRows = helpers.buildPlanRows({
    operation_type: 'pose_swap',
    source_images: { paths: ['/tmp/model.jpg'] },
    pose_prompt: '让模特自然侧身行走',
  })
  assert.equal(poseRows[0]['操作类型'], 'AI换姿势')
  assert.equal(poseRows[0]['姿势Prompt'], '让模特自然侧身行走')

  const invalidRows = helpers.buildPlanRows({
    operation_type: 'background_swap',
    source_images: { paths: ['/tmp/source.jpg'] },
    background_prompt: '',
  })
  assert.equal(invalidRows[0]['执行结果'], '缺少背景Prompt')
})
