import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function loadExports() {
  const scriptPath = path.resolve('adapters/semir-cloud-drive/batch-image-download.js')
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
    location: { href: 'https://fmp.semirapp.com/web/index#/home/file' },
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

test('parseCloudPath splits mount and relative path', async () => {
  const helpers = await loadExports()
  const result = helpers.parseCloudPath('巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/')

  assert.equal(result.mountName, '巴拉营运BU-商品')
  assert.equal(result.relativePath, '巴拉货控/02 产品上新模块/2-2 巴拉产品上新')
  assert.equal(result.relativePrefix, '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/')
})

test('buildFolderHashRoute points to the configured cloud folder', async () => {
  const helpers = await loadExports()
  const result = helpers.buildFolderHashRoute('2023', '巴拉货控/02 产品上新模块/2-2 巴拉产品上新')
  assert.equal(
    result,
    '#/home/file/mount/2023?path=%E5%B7%B4%E6%8B%89%E8%B4%A7%E6%8E%A7%2F02%20%E4%BA%A7%E5%93%81%E4%B8%8A%E6%96%B0%E6%A8%A1%E5%9D%97%2F2-2%20%E5%B7%B4%E6%8B%89%E4%BA%A7%E5%93%81%E4%B8%8A%E6%96%B0',
  )
})

test('buildSearchHashRoute matches the top-right file search route', async () => {
  const helpers = await loadExports()
  const result = helpers.buildSearchHashRoute('2023', '208226111002')
  assert.equal(
    result,
    '#/home/file/mount/2023/search?keyword=208226111002&mount_id=2023&scope=%5B%22filename%22%2C+%22tag%22%5D',
  )
})

test('normalizeCodes keeps line boundaries and removes duplicates', async () => {
  const helpers = await loadExports()
  const result = helpers.normalizeCodes('208226111002\n208226111002-00316；208226111002')
  assert.deepEqual(Array.from(result), ['208226111002', '208226111002-00316'])
})

test('filterSearchResults keeps only in-scope image files for spu query', async () => {
  const helpers = await loadExports()
  const items = [
    { dir: '0', ext: 'jpg', filename: '208226111002.jpg', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/A/208226111002.jpg' },
    { dir: '0', ext: 'jpg', filename: '208226111002-00316.jpg', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/B/208226111002-00316.jpg' },
    { dir: '0', ext: 'jpg', filename: '208226111002-00316.jpg', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/B2/208226111002-00316.jpg' },
    { dir: '0', ext: 'jpg', filename: '208226111002-60035.jpg', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/B3/208226111002-60035.jpg' },
    { dir: '0', ext: 'jpg', filename: '208226111002_01.jpg', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/C/208226111002_01.jpg' },
    { dir: '0', ext: 'jpg', filename: '208226111002-00316-1.jpg', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/C2/208226111002-00316-1.jpg' },
    { dir: '0', ext: 'jpg', filename: '208226111002-AI.jpg', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/C3/208226111002-AI.jpg' },
    { dir: '0', ext: 'pdf', filename: '货号208226111002 尺码表.pdf', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/D/货号208226111002 尺码表.pdf' },
    { dir: '0', ext: 'mp4', filename: '208226111002-AI.mp4', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/E/208226111002-AI.mp4' },
    { dir: '1', ext: '', filename: '208226111002', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/F/208226111002' },
    { dir: '0', ext: 'jpg', filename: '208226111002.jpg', fullpath: '巴拉货控/杂七杂八/208226111002.jpg' },
  ]

  const result = helpers.filterSearchResults(items, '208226111002', '巴拉货控/02 产品上新模块/2-2 巴拉产品上新')

  assert.deepEqual(
    Array.from(result, item => item.filename),
    ['208226111002-00316.jpg', '208226111002-60035.jpg'],
  )
})

test('filterSearchResults can keep duplicate filenames when configured', async () => {
  const helpers = await loadExports()
  const items = [
    { dir: '0', ext: 'jpg', filename: '208226111002-00316.jpg', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/A/208226111002-00316.jpg' },
    { dir: '0', ext: 'jpg', filename: '208226111002-00316.jpg', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/B/208226111002-00316.jpg' },
  ]

  const result = helpers.filterSearchResults(
    items,
    '208226111002',
    '巴拉货控/02 产品上新模块/2-2 巴拉产品上新',
    { duplicateMode: 'all' },
  )

  assert.deepEqual(
    Array.from(result, item => item.fullpath),
    [
      '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/A/208226111002-00316.jpg',
      '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/B/208226111002-00316.jpg',
    ],
  )
})

test('filterSearchResults keeps exact skc only and ignores trailing numeric suffix variants', async () => {
  const helpers = await loadExports()
  const items = [
    { dir: '0', ext: 'jpg', filename: '208226111002-00316.jpg', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/A/208226111002-00316.jpg' },
    { dir: '0', ext: 'jpg', filename: '208226111002-00316.jpg', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/A2/208226111002-00316.jpg' },
    { dir: '0', ext: 'jpg', filename: '208226111002-00316-1.jpg', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/B/208226111002-00316-1.jpg' },
    { dir: '0', ext: 'jpg', filename: '208226111002-00316_01.jpg', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/C/208226111002-00316_01.jpg' },
    { dir: '0', ext: 'jpg', filename: '208226111002-003160.jpg', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/D/208226111002-003160.jpg' },
  ]

  const result = helpers.filterSearchResults(items, '208226111002-00316', '巴拉货控/02 产品上新模块/2-2 巴拉产品上新')

  assert.deepEqual(
    Array.from(result, item => item.filename),
    ['208226111002-00316.jpg'],
  )
})

test('finalizeCodeRows maps runtime download results back to rows', async () => {
  const helpers = await loadExports()
  const rows = [
    {
      '输入编码': '208226111002-00316',
      '文件名': '208226111002-00316.jpg',
      '云盘路径': 'A/208226111002-00316.jpg',
      '下载结果': '',
      '本地文件': '',
      '备注': '',
    },
    {
      '输入编码': '208226111002-00316',
      '文件名': '208226111002-00316-1.jpg',
      '云盘路径': 'B/208226111002-00316-1.jpg',
      '下载结果': '',
      '本地文件': '',
      '备注': '',
    },
  ]
  const result = helpers.finalizeCodeRows(rows, {
    items: [
      { success: true, path: '/tmp/a.jpg' },
      { success: false, error: 'HTTP 403' },
    ],
  })

  assert.equal(result[0]['下载结果'], '已下载')
  assert.equal(result[0]['本地文件'], '/tmp/a.jpg')
  assert.equal(result[1]['下载结果'], '下载失败')
  assert.equal(result[1]['备注'], 'HTTP 403')
})
