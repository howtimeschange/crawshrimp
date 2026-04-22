import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function loadExports() {
  const scriptPath = path.resolve('adapters/semir-cloud-drive/batch-ai-generate.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const exportsBox = {}
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: {},
      __CRAWSHRIMP_PHASE__: '__exports__',
      __CRAWSHRIMP_SHARED__: {},
      __CRAWSHRIMP_EXPORTS__: exportsBox,
    },
    document: {},
    location: { href: 'https://fmp.semirapp.com/web/index#/home/file', pathname: '/web/index' },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
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
  }
  context.globalThis = context
  await vm.runInNewContext(source, context, { filename: scriptPath })
  return exportsBox
}

test('normalizeAiJobs supports combined and split code columns', async () => {
  const helpers = await loadExports()
  const result = helpers.normalizeAiJobs([
    {
      '款号/款色号': '208226111002-00316',
      'Prompt': '做图 A',
      '性别': '女',
      '岁段': '婴童',
    },
    {
      '款号': '208226111030',
      '款色号': '00316',
      '提示词': '做图 B',
      '品类': '羽绒服',
    },
  ], '豆包')

  assert.equal(result.invalidRows.length, 0)
  assert.equal(result.jobs.length, 2)
  assert.equal(result.jobs[0].input_code, '208226111002-00316')
  assert.equal(result.jobs[1].input_code, '208226111030-00316')
  assert.match(result.jobs[0].prompt_final, /商品属性：性别=女；岁段=婴童/)
  assert.match(result.jobs[1].prompt_final, /商品属性：品类=羽绒服/)
})

test('normalizeAiJobs emits invalid rows when code or prompt is missing', async () => {
  const helpers = await loadExports()
  const result = helpers.normalizeAiJobs([
    { '款号': '208226111002' },
    { 'Prompt': '只有 prompt' },
  ], 'Gemini')

  assert.equal(result.jobs.length, 0)
  assert.equal(result.invalidRows.length, 2)
  assert.equal(result.invalidRows[0]['执行结果'], '参数缺失')
  assert.equal(result.invalidRows[1]['AI站点'], 'Gemini')
})

test('resolveProviderConfig keeps known defaults and honors override url', async () => {
  const helpers = await loadExports()
  const doubao = helpers.resolveProviderConfig('doubao')
  const gemini = helpers.resolveProviderConfig('gemini')

  assert.equal(doubao.providerName, '豆包')
  assert.equal(doubao.entryUrl, 'https://www.doubao.com/chat/create-image')
  assert.equal(gemini.providerName, 'Gemini')
  assert.equal(gemini.entryUrl, 'https://gemini.google.com/app')
})

test('buildSourceMap keeps only successful downloaded source files', async () => {
  const helpers = await loadExports()
  const result = helpers.buildSourceMap([
    {
      '输入编码': '208226111002',
      '文件名': '208226111002-00316.jpg',
      '云盘路径': 'A/208226111002-00316.jpg',
      '下载结果': '已下载',
      '本地文件': '/tmp/a.jpg',
    },
    {
      '输入编码': '208226111002',
      '文件名': '208226111002-60035.jpg',
      '云盘路径': 'A/208226111002-60035.jpg',
      '下载结果': '下载失败',
      '本地文件': '/tmp/b.jpg',
    },
  ])

  assert.equal(result['208226111002'].count, 1)
  assert.equal(result['208226111002'].items[0].local_path, '/tmp/a.jpg')
})

test('filterSearchResults reuses semir code-matching rules for sku images', async () => {
  const helpers = await loadExports()
  const items = [
    { dir: '0', ext: 'jpg', filename: '208226111002-00316.jpg', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/A/208226111002-00316.jpg' },
    { dir: '0', ext: 'jpg', filename: '208226111002-00316-1.jpg', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/B/208226111002-00316-1.jpg' },
    { dir: '0', ext: 'jpg', filename: '208226111002-60035.jpg', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/C/208226111002-60035.jpg' },
  ]

  const result = helpers.filterSearchResults(
    items,
    '208226111002',
    '巴拉货控/02 产品上新模块/2-2 巴拉产品上新',
  )

  assert.deepEqual(
    Array.from(result, item => item.filename),
    ['208226111002-00316.jpg', '208226111002-60035.jpg'],
  )
})

test('buildExecutionQueue expands one code into one AI job per source image', async () => {
  const helpers = await loadExports()
  const jobs = [
    {
      row_no: 2,
      input_code: '208226111002',
      code_type: 'spu',
      prompt_base: '做图 A',
      prompt_final: '做图 A\n\n商品属性：性别=女',
      metadata_text: '性别=女',
    },
  ]
  const sourceMap = {
    '208226111002': {
      count: 2,
      items: [
        {
          filename: '208226111002-00316.jpg',
          cloud_path: 'A/208226111002-00316.jpg',
          local_path: '/tmp/208226111002-00316.jpg',
        },
        {
          filename: '208226111002-60035.jpg',
          cloud_path: 'A/208226111002-60035.jpg',
          local_path: '/tmp/208226111002-60035.jpg',
        },
      ],
    },
  }

  const queue = helpers.buildExecutionQueue(jobs, sourceMap, '豆包')

  assert.equal(queue.execJobs.length, 2)
  assert.equal(queue.resultRows.length, 2)
  assert.equal(queue.execJobs[0].source_item.filename, '208226111002-00316.jpg')
  assert.equal(queue.execJobs[1].source_item.filename, '208226111002-60035.jpg')
  assert.equal(queue.resultRows[0]['素材图数量'], 1)
  assert.equal(queue.resultRows[0]['素材图文件'], '208226111002-00316.jpg')
  assert.equal(queue.resultRows[1]['素材图文件'], '208226111002-60035.jpg')
})

test('isDoubaoGenerationReady ignores create-image template wall and waits for result page output', async () => {
  const helpers = await loadExports()

  assert.equal(
    helpers.isDoubaoGenerationReady({
      resultPage: false,
      urlChangedAfterSubmit: false,
      generatedImageCount: 30,
      saveButtonCount: 0,
    }),
    false,
  )

  assert.equal(
    helpers.isDoubaoGenerationReady({
      resultPage: true,
      urlChangedAfterSubmit: true,
      generatedImageCount: 1,
      saveButtonCount: 0,
    }),
    true,
  )

  assert.equal(
    helpers.isDoubaoGenerationReady({
      resultPage: true,
      urlChangedAfterSubmit: true,
      generatedImageCount: 0,
      saveButtonCount: 1,
    }),
    true,
  )
})
