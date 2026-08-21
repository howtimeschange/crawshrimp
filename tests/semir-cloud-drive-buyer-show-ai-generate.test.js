import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function loadExports(options = {}) {
  const scriptPath = path.resolve('adapters/semir-cloud-drive/buyer-show-ai-generate.js')
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
    location: { href: 'https://fmp.semirapp.com/web/index#/home/file', hash: '' },
    fetch: options.fetch || (async () => ({ ok: true, json: async () => ({}) })),
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

test('normalizeBuyerShowRows reads business Excel headers and keeps unique folder name', async () => {
  const helpers = await loadExports()
  const result = helpers.normalizeBuyerShowRows([
    {
      '订单号': 'ORD-1',
      '款色号': '208326102205-00316',
      '尺码': '120',
      '唯一值': 'ORD-1208326102205-00316',
      'AI素材库路径': '巴拉搜索渠道-淘系//1-官方旗舰店/买家秀图库/冬季/上装/女/',
      'AI图包文件夹命名': '图包 A',
      '存放地址': '巴拉搜索渠道-淘系//AI后买家秀图包/',
    },
  ])

  assert.equal(result.invalidRows.length, 0)
  assert.equal(result.jobs.length, 1)
  assert.equal(result.jobs[0]['表格行号'], 2)
  assert.equal(result.jobs[0]['货号'], '208326102205')
  assert.equal(result.jobs[0]['唯一值'], 'ORD-1208326102205-00316')
})

test('joined style-color codes keep display value while exposing Semir hyphen variants', async () => {
  const helpers = await loadExports()
  const result = helpers.normalizeBuyerShowRows([
    {
      '订单号': '1',
      '款色号': '20842610420180915',
      '尺码': '100',
      '唯一值': '120842610420180915',
      'AI素材库路径': '巴拉搜索渠道-淘系//买家秀图库/冬季/套装/男/',
    },
  ])

  assert.equal(result.invalidRows.length, 0)
  assert.equal(result.jobs[0]['款色号'], '20842610420180915')
  assert.equal(result.jobs[0]['货号'], '208426104201')
  assert.equal(helpers.hyphenatedStyleColorCode('20842610420180915'), '208426104201-80915')
  assert.deepEqual(
    Array.from(helpers.styleColorSearchCodes('20842610420180915')),
    ['20842610420180915', '208426104201-80915', '208426104201'],
  )
})

test('normalizeBuyerShowRows reports missing required columns', async () => {
  const helpers = await loadExports()
  const result = helpers.normalizeBuyerShowRows([
    { '款色号': '208326102205-00316' },
    { 'AI素材库路径': '巴拉搜索渠道-淘系//买家秀图库/' },
  ])

  assert.equal(result.jobs.length, 0)
  assert.equal(result.invalidRows.length, 2)
  assert.equal(result.invalidRows[0]['生图结果'], '参数缺失')
  assert.match(result.invalidRows[0]['备注'], /缺少 AI素材库路径/)
  assert.match(result.invalidRows[1]['备注'], /缺少款色号/)
})

test('filterModelShotItems keeps image files in buyer-show folder and removes flat/package assets', async () => {
  const helpers = await loadExports()
  const items = [
    { dir: '0', ext: 'jpg', filename: 'look-01.jpg', fullpath: 'root/男/look-01.jpg' },
    { dir: '0', ext: 'jpg', filename: '208326102205-00316-平铺.jpg', fullpath: 'root/男/208326102205-00316-平铺.jpg' },
    { dir: '0', ext: 'png', filename: '包装图.png', fullpath: 'root/男/包装图.png' },
    { dir: '1', ext: '', filename: 'child', fullpath: 'root/男/child' },
    { dir: '0', ext: 'jpg', filename: 'other.jpg', fullpath: 'elsewhere/other.jpg' },
  ]

  const result = helpers.filterModelShotItems(items, 'root/男')

  assert.equal(JSON.stringify(result.map(item => item.filename)), JSON.stringify(['look-01.jpg']))
})

test('collectModelShotItems scans child folders when model path is a category folder', async () => {
  const helpers = await loadExports()
  const root = 'root/冬季/上装/羽绒服/男'
  const child = `${root}/黑色90001`
  const tree = {
    [root]: [
      { dir: '1', ext: '', filename: '黑色90001', fullpath: child },
      { dir: '1', ext: '', filename: '白色00311', fullpath: `${root}/白色00311` },
    ],
    [child]: [
      { dir: '0', ext: 'jpg', filename: '买家秀-01.jpg', fullpath: `${child}/买家秀-01.jpg` },
      { dir: '0', ext: 'jpg', filename: '平铺-01.jpg', fullpath: `${child}/平铺-01.jpg` },
    ],
    [`${root}/白色00311`]: [
      { dir: '0', ext: 'png', filename: '买家秀-02.png', fullpath: `${root}/白色00311/买家秀-02.png` },
    ],
  }

  const result = await helpers.collectModelShotItems('2018', root, {
    maxItems: 1,
    scanDepth: 1,
    listItems: async (mountId, pathValue) => tree[pathValue] || [],
  })

  assert.equal(result.scannedFolders, 3)
  assert.equal(result.scannedImages, 3)
  assert.equal(JSON.stringify(result.items.map(item => item.filename)), JSON.stringify(['买家秀-01.jpg']))
})

test('full batch scan defaults do not truncate category folders early', async () => {
  const helpers = await loadExports()

  assert.equal(helpers.normalizeModelFolderScanDepth(''), 4)
  assert.equal(helpers.normalizeModelScanMaxFolders(''), 500)
  assert.equal(helpers.normalizeModelFileInfoBatchSize(''), 5)
})

test('usage record mode ignore keeps duplicate style-color model rows for full stability runs', async () => {
  const helpers = await loadExports({
    fetch: async (url) => {
      if (String(url).includes('/fengcloud/2/file/info')) {
        return {
          ok: true,
          json: async () => ({ uri: `https://download.example/${encodeURIComponent(String(url))}.jpg` }),
        }
      }
      return { ok: true, json: async () => ({}) }
    },
  })
  const job = {
    '表格行号': 2,
    '款色号': '208326102205-00316',
    '货号': '208326102205',
    '唯一值': 'ORD-1',
    'AI素材库路径': '巴拉搜索渠道-淘系//买家秀图库/冬季/上装/女/',
  }
  const modelPath = '买家秀图库/冬季/上装/女/model-01.jpg'
  const sharedBase = {
    flat_config: { relativePath: '平铺图库' },
    flat_mount: { mountId: 'flat-mount', mountName: '巴拉营运BU-商品' },
    mount_cache: { '巴拉搜索渠道-淘系': { mountId: 'model-mount', mountName: '巴拉搜索渠道-淘系' } },
    active_job_plan: {
      job_index: 0,
      style_color_code: '208326102205-00316',
      model_items: [{ dir: '0', ext: 'jpg', filename: 'model-01.jpg', fullpath: modelPath }],
      model_scan: { scannedFolders: 1, scannedItems: 1, scannedImages: 1, truncated: false },
      flat_item: { dir: '0', ext: 'jpg', filename: '208326102205-00316.jpg', fullpath: '平铺图库/208326102205-00316.jpg' },
      flat_search_count: 1,
    },
    batch_seen_usage: [`208326102205-00316::${modelPath}`],
    model_file_info_batch_size: 5,
  }

  const ignored = await helpers.collectJobRows(job, { ...sharedBase, usage_record_mode: 'ignore' }, 1, 1)
  const enforced = await helpers.collectJobRows(job, { ...sharedBase, usage_record_mode: 'enforce' }, 1, 1)

  assert.equal(helpers.shouldEnforceUsageRecordMode('ignore'), false)
  assert.equal(ignored.rows.length, 1)
  assert.equal(ignored.rows[0]['生图结果'], '待生成')
  assert.equal(ignored.downloadItems.length, 2)
  assert.equal(enforced.rows.length, 1)
  assert.equal(enforced.rows[0]['生图结果'], '已跳过')
  assert.match(enforced.rows[0]['备注'], /同款色号/)
})

test('filterFlatReferenceItems prefers exact款色号 reference inside configured library', async () => {
  const helpers = await loadExports()
  const items = [
    { dir: '0', ext: 'jpg', filename: '208326102205.jpg', fullpath: 'flat/208326102205.jpg' },
    { dir: '0', ext: 'jpg', filename: '208326102205-00316_1.jpg', fullpath: 'flat/208326102205-00316_1.jpg' },
    { dir: '0', ext: 'jpg', filename: '208326102205-00316.jpg', fullpath: 'flat/208326102205-00316.jpg' },
    { dir: '0', ext: 'jpg', filename: '208326102205-00316-平铺.jpg', fullpath: '挂载点/商品中台/flat/208326102205-00316-平铺.jpg' },
    { dir: '0', ext: 'jpg', filename: '208326102205-00316-模拍.jpg', fullpath: 'flat/208326102205-00316-模拍.jpg' },
    { dir: '0', ext: 'jpg', filename: '208326102205-00316.jpg', fullpath: 'other/208326102205-00316.jpg' },
  ]

  const result = helpers.filterFlatReferenceItems(items, '208326102205-00316', 'flat')

  assert.equal(
    JSON.stringify(result.map(item => item.filename)),
    JSON.stringify(['208326102205-00316.jpg', '208326102205-00316_1.jpg', '208326102205-00316-平铺.jpg', '208326102205.jpg']),
  )
})

test('filterFlatReferenceItems matches cloud files named with 12-plus-5 hyphen style code', async () => {
  const helpers = await loadExports()
  const items = [
    { dir: '0', ext: 'jpg', filename: '208426104201.jpg', fullpath: 'flat/208426104201.jpg' },
    { dir: '0', ext: 'jpg', filename: '20842610420180915.jpg', fullpath: 'flat/20842610420180915.jpg' },
    { dir: '0', ext: 'jpg', filename: '208426104201-80915.jpg', fullpath: '商品中台/flat/208426104201-80915.jpg' },
  ]

  const result = helpers.filterFlatReferenceItems(items, '20842610420180915', 'flat')

  assert.equal(
    JSON.stringify(result.map(item => item.filename)),
    JSON.stringify(['208426104201-80915.jpg', '20842610420180915.jpg', '208426104201.jpg']),
  )
})

test('finalizeRowsWithDownloads maps model and flat download indexes back to row fields', async () => {
  const helpers = await loadExports()
  const rows = [
    {
      '模拍下载结果': '',
      '平铺下载结果': '',
      '__model_download_index': 1,
      '__ref_download_index': 0,
    },
  ]
  const result = helpers.finalizeRowsWithDownloads(rows, {
    items: [
      { success: true, path: '/tmp/flat.jpg' },
      { success: false, error: 'HTTP 403' },
    ],
  })

  assert.equal(result[0]['模拍下载结果'], '下载失败')
  assert.equal(result[0]['平铺下载结果'], '已下载')
  assert.equal(result[0]['平铺本地文件'], '/tmp/flat.jpg')
  assert.match(result[0]['备注'], /HTTP 403/)
})
