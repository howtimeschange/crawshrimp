import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function runAmazonLabelScript(params = {}, phase = '__exports__', shared = {}, exportsBox = null) {
  const scriptPath = path.resolve('adapters/amazon-ops-assistant/amazon-label-batch-process.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      ...(exportsBox ? { __CRAWSHRIMP_EXPORTS__: exportsBox } : {}),
    },
    document: {},
    location: { href: 'about:blank' },
    console,
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
  return vm.runInNewContext(source, context, { filename: scriptPath })
}

async function loadExports() {
  const exportsBox = {}
  await runAmazonLabelScript({}, '__exports__', {}, exportsBox)
  return exportsBox
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('normalizes mapping rows using FNSKU, SKU, and label name headers', async () => {
  const helpers = await loadExports()
  const rows = helpers.normalizeMappingRows({
    rows: [
      { FNSKU: ' X004QZEQZV ', SKU: 9950020568060, 标签名称: '9950020568060+X004QZEQZV' },
      { FNSKU: '', SKU: '', 标签名称: '' },
    ],
  })

  assert.deepEqual(plain(rows), [
    {
      fnsku: 'X004QZEQZV',
      sku: '9950020568060',
      labelName: '9950020568060+X004QZEQZV',
      error: '',
    },
  ])
})

test('amazon label task returns PDF placeholders with backend metadata', async () => {
  const result = await runAmazonLabelScript({
    mapping_file: {
      rows: [
        { FNSKU: 'X004QZEQZV', SKU: '9950020568060', 标签名称: '9950020568060+X004QZEQZV' },
      ],
    },
    label_pdf: {
      paths: ['/tmp/products.pdf', '/tmp/not-a-pdf.txt'],
    },
  }, 'init')

  assert.equal(result.success, true)
  assert.equal(result.meta.has_more, false)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].PDF文件, 'products.pdf')
  assert.equal(result.data[0].匹配结果, '等待后端拆分')
  assert.equal(result.data[0].__pdf_path, '/tmp/products.pdf')
  assert.deepEqual(plain(result.data[0].__mapping_rows), [
    {
      fnsku: 'X004QZEQZV',
      sku: '9950020568060',
      labelName: '9950020568060+X004QZEQZV',
      error: '',
    },
  ])
})

test('amazon label task fails fast on invalid mapping rows', async () => {
  const result = await runAmazonLabelScript({
    mapping_file: {
      rows: [
        { FNSKU: 'X004QZEQZV', SKU: '9950020568060', 标签名称: '' },
      ],
    },
    label_pdf: {
      paths: ['/tmp/products.pdf'],
    },
  }, 'init')

  assert.equal(result.success, false)
  assert.match(result.error, /缺少标签名称/)
})
