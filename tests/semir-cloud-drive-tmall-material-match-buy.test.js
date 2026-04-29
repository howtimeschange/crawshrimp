import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function loadExports(options = {}) {
  const scriptPath = path.resolve('adapters/semir-cloud-drive/tmall-material-match-buy.js')
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
    location: { href: 'https://fmp.semirapp.com/web/index#/home/file', hash: '#/home/file' },
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

function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }
}

test('normalizeMatchBuyJobs reads style code and target ID columns', async () => {
  const helpers = await loadExports()
  const result = helpers.normalizeMatchBuyJobs([
    { '款号': '109326124011', '对应ID': '1018757615139' },
    { '货号': '109326124012', '商品ID': '1018757615140' },
    { '款号': '', '对应ID': 'missing-code' },
  ])

  assert.equal(result.jobs.length, 2)
  assert.equal(result.invalidRows.length, 1)
  assert.equal(result.jobs[0].style_code, '109326124011')
  assert.equal(result.jobs[0].target_id, '1018757615139')
  assert.equal(result.invalidRows[0]['执行结果'], '参数缺失')
  assert.equal(result.invalidRows[0]['下载结果'], '已跳过')
})

test('matchesMatchBuyImageName accepts only 3-series image stems', async () => {
  const helpers = await loadExports()

  assert.equal(helpers.matchesMatchBuyImageName('3 .jpg'), true)
  assert.equal(helpers.matchesMatchBuyImageName('3.jpg'), true)
  assert.equal(helpers.matchesMatchBuyImageName('3-1.jpg'), true)
  assert.equal(helpers.matchesMatchBuyImageName('3-12.jpeg'), true)
  assert.equal(helpers.matchesMatchBuyImageName('03.jpg'), false)
  assert.equal(helpers.matchesMatchBuyImageName('3-a.jpg'), false)
  assert.equal(helpers.matchesMatchBuyImageName('4.jpg'), false)
})

test('normalizeUploadTimeRange and isItemWithinUploadTimeRange use cloud timestamp fields', async () => {
  const helpers = await loadExports()
  const range = helpers.normalizeUploadTimeRange({ start: '2026-04-01', end: '2026-04-30' })

  assert.equal(
    helpers.isItemWithinUploadTimeRange({ filename: '3.jpg', last_dateline: 1776268800 }, range),
    true,
  )
  assert.equal(
    helpers.isItemWithinUploadTimeRange({ filename: '3.jpg', create_dateline: 1774972800 }, range),
    true,
  )
  assert.equal(
    helpers.isItemWithinUploadTimeRange({ filename: '3.jpg', last_dateline: 1777564800 }, range),
    false,
  )
  assert.equal(
    helpers.isItemWithinUploadTimeRange({ filename: '3.jpg' }, range),
    false,
  )
})

test('collectMatchBuyAssets expands style folders and filters 3-series images by upload time', async () => {
  const fetchCalls = []
  const helpers = await loadExports({
    fetch: async (url) => {
      const textUrl = String(url)
      fetchCalls.push(textUrl)
      if (textUrl.includes('/fengcloud/2/file/search')) {
        return jsonResponse({
          total: 2,
          list: [
            {
              dir: '1',
              filename: '109326124011-88601',
              fullpath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q2/模拍/牛仔/第二波/109326124011-88601',
            },
            {
              dir: '0',
              ext: 'jpg',
              filename: '109326124011-direct.jpg',
              fullpath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q2/模拍/109326124011-direct.jpg',
            },
          ],
        })
      }
      if (textUrl.includes('/fengcloud/1/file/ls')) {
        return jsonResponse({
          count: 5,
          list: [
            {
              dir: '0',
              ext: 'jpg',
              filename: '3 .jpg',
              fullpath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q2/模拍/牛仔/第二波/109326124011-88601/3 .jpg',
              last_dateline: 1776268800,
            },
            {
              dir: '0',
              ext: 'jpg',
              filename: '3.jpg',
              fullpath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q2/模拍/牛仔/第二波/109326124011-88601/3.jpg',
              create_dateline: 1774972800,
            },
            {
              dir: '0',
              ext: 'jpg',
              filename: '3-1.jpg',
              fullpath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q2/模拍/牛仔/第二波/109326124011-88601/3-1.jpg',
              last_dateline: 1777564800,
            },
            {
              dir: '0',
              ext: 'jpg',
              filename: '4.jpg',
              fullpath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q2/模拍/牛仔/第二波/109326124011-88601/4.jpg',
              last_dateline: 1776268800,
            },
            {
              dir: '1',
              filename: '子目录',
              fullpath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q2/模拍/牛仔/第二波/109326124011-88601/子目录',
            },
          ],
        })
      }
      return jsonResponse({})
    },
  })

  const result = await helpers.collectMatchBuyAssets(
    '109326124011',
    {
      mountId: '3283',
      relativePath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q2/模拍',
    },
    {
      uploadTimeRange: helpers.normalizeUploadTimeRange({ start: '2026-04-01', end: '2026-04-30' }),
      folderScanDepth: 2,
    },
  )

  assert.equal(result.folderCount, 1)
  assert.deepEqual([...result.items.map(item => item.filename)], ['3 .jpg', '3.jpg'])
  assert.equal(fetchCalls.some(url => url.includes('/fengcloud/1/file/ls')), true)
})

test('buildMatchBuyPlan names package files by corresponding ID with Chinese counters', async () => {
  const helpers = await loadExports({
    fetch: async (url) => {
      const textUrl = String(url)
      if (textUrl.includes('/fengcloud/2/file/search')) {
        return jsonResponse({
          total: 1,
          list: [{
            dir: '1',
            filename: '109326124011-88601',
            fullpath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q2/模拍/109326124011-88601',
          }],
        })
      }
      if (textUrl.includes('/fengcloud/1/file/ls')) {
        return jsonResponse({
          count: 2,
          list: [
            {
              dir: '0',
              ext: 'jpg',
              filename: '3.jpg',
              fullpath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q2/模拍/109326124011-88601/3.jpg',
              last_dateline: 1776268800,
            },
            {
              dir: '0',
              ext: 'jpg',
              filename: '3-1.jpg',
              fullpath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q2/模拍/109326124011-88601/3-1.jpg',
              last_dateline: 1776268800,
            },
          ],
        })
      }
      if (textUrl.includes('/fengcloud/2/file/info')) {
        return jsonResponse({ uri: `https://download.example/${encodeURIComponent(textUrl)}` })
      }
      return jsonResponse({})
    },
  })

  const plan = await helpers.buildMatchBuyPlan(
    { style_code: '109326124011', target_id: '1018757615139', row_no: 2 },
    {
      mountId: '3283',
      relativePath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q2/模拍',
    },
    1,
    1,
    {
      uploadTimeRange: helpers.normalizeUploadTimeRange({ start: '2026-04-01', end: '2026-04-30' }),
      folderScanDepth: 1,
    },
  )

  assert.equal(plan.rows.length, 2)
  assert.equal(plan.downloadItems.length, 2)
  assert.equal(plan.rows[0]['文件名'], '1018757615139（1）.jpg')
  assert.equal(plan.rows[1]['文件名'], '1018757615139（2）.jpg')
  assert.equal(plan.rows[0]['__package_filename'], '1018757615139（1）.jpg')
  assert.equal(plan.downloadItems[0].filename.endsWith('.jpg'), true)
})

test('finalizeRows does not consume download results for skipped input rows', async () => {
  const helpers = await loadExports()
  const rows = [
    {
      '表格行号': 2,
      '款号': '',
      '对应ID': 'missing-code',
      '下载结果': '已跳过',
      '本地文件': '',
      '执行结果': '参数缺失',
      '备注': '缺少款号',
    },
    {
      '表格行号': 3,
      '款号': '109326124011',
      '对应ID': '1018757615139',
      '文件名': '1018757615139（1）.jpg',
      '下载结果': '',
      '本地文件': '',
      '执行结果': '',
      '备注': '',
    },
  ]

  const result = helpers.finalizeRows(rows, {
    items: [{ success: true, path: '/tmp/1018757615139-1.jpg' }],
  })

  assert.equal(result[0]['下载结果'], '已跳过')
  assert.equal(result[0]['本地文件'], '')
  assert.equal(result[1]['下载结果'], '已下载')
  assert.equal(result[1]['本地文件'], '/tmp/1018757615139-1.jpg')
})
