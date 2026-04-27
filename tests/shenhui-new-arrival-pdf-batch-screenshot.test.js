import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function runPdfScript(params = {}, phase = '__exports__', shared = {}, exportsBox = null) {
  const scriptPath = path.resolve('adapters/shenhui-new-arrival/pdf-batch-screenshot.js')
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
  await runPdfScript({}, '__exports__', {}, exportsBox)
  return exportsBox
}

test('normalizePdfInputs accepts batch-selected pdf paths and ignores non-pdf files', async () => {
  const helpers = await loadExports()
  const files = helpers.normalizePdfInputs({
    paths: [
      '/tmp/208226103201-label.pdf',
      '/tmp/not-pdf.jpg',
      '/tmp/208226103202-label.PDF',
    ],
  })

  assert.deepEqual([...files.map(item => item.filename)], ['208226103201-label.pdf', '208226103202-label.PDF'])
})

test('pdf screenshot task returns rows for backend screenshot finalizer', async () => {
  const result = await runPdfScript({
    wash_pdf_files: {
      paths: ['/tmp/208226103201-wash.pdf'],
    },
    tag_pdf_files: {
      paths: ['/tmp/208226103201-tag.pdf'],
    },
  }, 'init')

  assert.equal(result.success, true)
  assert.equal(result.meta.has_more, false)
  assert.equal(result.data.length, 2)
  assert.equal(result.data[0]['PDF文件'], '208226103201-wash.pdf')
  assert.equal(result.data[0]['PDF类型'], '洗唛')
  assert.equal(result.data[0]['处理动作'], '等待后端截图')
  assert.equal(result.data[0].__pdf_path, '/tmp/208226103201-wash.pdf')
  assert.equal(result.data[0].__pdf_type, 'wash_label')
  assert.equal(result.data[1]['PDF文件'], '208226103201-tag.pdf')
  assert.equal(result.data[1]['PDF类型'], '吊牌/合格证')
  assert.equal(result.data[1].__pdf_type, 'hang_tag')
})

test('pdf screenshot task keeps legacy single input for compatibility', async () => {
  const result = await runPdfScript({
    pdf_files: {
      paths: ['/tmp/208226103201-吊牌.pdf'],
    },
  }, 'init')

  assert.equal(result.success, true)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].__pdf_type, 'hang_tag')
})
