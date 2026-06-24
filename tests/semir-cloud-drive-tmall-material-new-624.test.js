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

test('new 6.24 asset rule keeps only 3-1 and static SKC images from the SKC folder', async () => {
  const helpers = await loadExports({
    fetch: async (url) => {
      const textUrl = String(url)
      if (textUrl.includes('/fengcloud/2/file/search')) {
        return jsonResponse({
          total: 1,
          list: [{
            dir: '1',
            filename: '103526124101A-80325',
            fullpath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q3/模特/服饰/AI/6-4/6-04批次 6 套/103526124101A-80325',
          }],
        })
      }
      if (textUrl.includes('/fengcloud/1/file/ls')) {
        return jsonResponse({
          count: 5,
          list: [
            {
              dir: '0',
              ext: 'jpg',
              filename: '3-1.jpg',
              fullpath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q3/模特/服饰/AI/6-4/6-04批次 6 套/103526124101A-80325/3-1.jpg',
              last_dateline: 1780710400,
            },
            {
              dir: '0',
              ext: 'jpg',
              filename: '103526124101A-80325.jpg',
              fullpath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q3/模特/服饰/AI/6-4/6-04批次 6 套/103526124101A-80325/103526124101A-80325.jpg',
              last_dateline: 1780710400,
            },
            {
              dir: '0',
              ext: 'jpg',
              filename: '3.jpg',
              fullpath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q3/模特/服饰/AI/6-4/6-04批次 6 套/103526124101A-80325/3.jpg',
              last_dateline: 1780710400,
            },
            {
              dir: '0',
              ext: 'jpg',
              filename: '3-2.jpg',
              fullpath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q3/模特/服饰/AI/6-4/6-04批次 6 套/103526124101A-80325/3-2.jpg',
              last_dateline: 1780710400,
            },
            {
              dir: '0',
              ext: 'png',
              filename: '103526124101A-80325 拷贝.png',
              fullpath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q3/模特/服饰/AI/6-4/6-04批次 6 套/103526124101A-80325/103526124101A-80325 拷贝.png',
              last_dateline: 1780710400,
            },
          ],
        })
      }
      return jsonResponse({})
    },
  })

  const result = await helpers.collectMatchBuyAssets(
    '103526124101A-80325',
    {
      mountId: '3283',
      relativePath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q3/模特/服饰/AI/6-4/6-04批次 6 套',
    },
    {
      assetRule: 'new_624',
      uploadTimeRange: helpers.normalizeUploadTimeRange({ start: '2026-06-01', end: '2026-06-30' }),
      folderScanDepth: 1,
    },
  )

  assert.equal(result.folderCount, 1)
  assert.deepEqual(
    [...result.items.map(item => item.filename)],
    ['3-1.jpg', '103526124101A-80325.jpg'],
  )
})

test('normalizeNew624Jobs parses copied SKC lines without an Excel file', async () => {
  const helpers = await loadExports()

  const result = helpers.normalizeNew624Jobs('103526124101A-80325\n103526124101A-80325\n 109526101005-00333 \nBADCODE')

  assert.equal(result.jobs.length, 2)
  assert.equal(result.invalidRows.length, 1)
  assert.equal(result.jobs[0].search_code, '103526124101A-80325')
  assert.equal(result.jobs[0].style_code, '103526124101A')
  assert.equal(result.jobs[0].color_code, '80325')
  assert.equal(result.jobs[0].match_dimension, 'skc')
  assert.equal(result.invalidRows[0]['执行结果'], '参数缺失')
  assert.equal(result.invalidRows[0]['备注'], 'SKC 格式应为“款号-色码”')
})

test('new 6.24 plan names full-body image by SKC and keeps still-life filename', async () => {
  const helpers = await loadExports({
    fetch: async (url) => {
      const textUrl = String(url)
      if (textUrl.includes('/fengcloud/2/file/search')) {
        return jsonResponse({
          total: 1,
          list: [{
            dir: '1',
            filename: '103526124101A-80325',
            fullpath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q3/模特/服饰/AI/6-4/6-04批次 6 套/103526124101A-80325',
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
              filename: '3-1.jpg',
              fullpath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q3/模特/服饰/AI/6-4/6-04批次 6 套/103526124101A-80325/3-1.jpg',
              last_dateline: 1780710400,
            },
            {
              dir: '0',
              ext: 'jpg',
              filename: '103526124101A-80325.jpg',
              fullpath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q3/模特/服饰/AI/6-4/6-04批次 6 套/103526124101A-80325/103526124101A-80325.jpg',
              last_dateline: 1780710400,
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
    {
      row_no: 1,
      match_dimension: 'skc',
      style_code: '103526124101A',
      color_code: '80325',
      search_code: '103526124101A-80325',
      target_id: '',
    },
    {
      mountId: '3283',
      relativePath: '01-拍摄企划/01-服饰/00-季度所有图片/2026年/26Q3/模特/服饰/AI/6-4/6-04批次 6 套',
    },
    1,
    1,
    {
      assetRule: 'new_624',
      uploadTimeRange: helpers.normalizeUploadTimeRange({ start: '2026-06-01', end: '2026-06-30' }),
      folderScanDepth: 1,
    },
  )

  assert.equal(plan.rows.length, 2)
  assert.deepEqual(
    [...plan.rows.map(row => row['文件名'])],
    ['103526124101A-80325-全身.jpg', '103526124101A-80325.jpg'],
  )
  assert.deepEqual([...plan.rows.map(row => row['图片类型'])], ['全身', '静物'])
  assert.equal(plan.rows[0]['SKC编码'], '103526124101A-80325')
  assert.equal(plan.rows[0]['__package_filename'], '103526124101A-80325-全身.jpg')
  assert.equal(plan.rows[1]['__package_filename'], '103526124101A-80325.jpg')
  assert.equal(plan.downloadItems.length, 2)
})
