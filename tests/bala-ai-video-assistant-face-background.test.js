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
    source_images: { paths: ['/tmp/a.jpg'] },
    model_groups: ['100女'],
    background_prompt: '',
  })

  assert.equal(rows[0]['执行结果'], '缺少背景Prompt')
})
