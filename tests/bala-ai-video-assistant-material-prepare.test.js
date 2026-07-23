import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function loadExports(options = {}) {
  const scriptPath = path.resolve('adapters/bala-ai-video-assistant/semir-video-material-prepare.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const exportsBox = {}
  const windowValue = {
    __CRAWSHRIMP_PARAMS__: {},
    __CRAWSHRIMP_PHASE__: '__exports__',
    __CRAWSHRIMP_SHARED__: {},
    __CRAWSHRIMP_EXPORTS__: exportsBox,
    ...(options.windowOverride || {}),
  }
  const context = {
    window: windowValue,
    document: {},
    location: { href: 'https://fmp.semirapp.com/web/index#/home/file', hash: '#/home/file' },
    navigator: { userAgent: 'unit-test' },
    fetch: options.fetch || (async () => jsonResponse({})),
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

test('material preparation defaults downloaded images to a 10MB compression threshold', async () => {
  const helpers = await loadExports()

  assert.equal(helpers.normalizeMaxImageMb(undefined), 10)
  assert.equal(helpers.normalizeMaxImageMb(''), 10)
  assert.equal(helpers.normalizeMaxImageMb('invalid'), 10)
  assert.equal(helpers.normalizeMaxImageMb(8), 8)
})

test('pickBestFolder prefers latest selected model folder and ignores packaging folders', async () => {
  const helpers = await loadExports()
  const root = '巴拉货控/02 产品上新模块/2-2 巴拉产品上新'
  const folders = [
    {
      dir: '1',
      filename: '208326102205',
      fullpath: `${root}/2026年巴拉秋/平拍原图/326包装图/幼童/208326102205`,
      last_dateline: '1782107482',
    },
    {
      dir: '1',
      filename: '208326102205-可选5.20-已选5.20',
      fullpath: `${root}/2026年巴拉秋/模拍原图/期货/0P/幼童/208326102205-可选5.20-已选5.20`,
      last_dateline: '1779000000',
    },
    {
      dir: '1',
      filename: '208326102205-可选5.27-已选5.27',
      fullpath: `${root}/2026年巴拉秋/模拍原图/期货/0P/幼童/208326102205-可选5.27-已选5.27`,
      last_dateline: '1779881553',
    },
  ]

  const result = helpers.pickBestFolder(folders, 'model', '208326102205', root)

  assert.equal(result.selected.filename, '208326102205-可选5.27-已选5.27')
  assert.equal(result.usedFallback, false)
})

test('pickBestFolder prefers detail folders marked as written over packaging exact-code folders', async () => {
  const helpers = await loadExports()
  const root = '巴拉货控/02 产品上新模块/2-2 巴拉产品上新'
  const folders = [
    {
      dir: '1',
      filename: '208326102205',
      fullpath: `${root}/2026年巴拉秋/平拍原图/326包装图/幼童/208326102205`,
      last_dateline: '1782107482',
    },
    {
      dir: '1',
      filename: '208326102205 5-已写',
      fullpath: `${root}/2026年巴拉秋/平拍原图/0p/幼童/208326102205 5-已写`,
      last_dateline: '1777012678',
    },
  ]

  const result = helpers.pickBestFolder(folders, 'detail', '208326102205', root)

  assert.equal(result.selected.filename, '208326102205 5-已写')
})

test('classifyVideoAsset filters white-background model and label-like detail assets', async () => {
  const helpers = await loadExports()

  assert.equal(
    helpers.classifyVideoAsset('model', {
      dir: '0',
      filename: '208326102205-00413.jpg',
      fullpath: '模拍原图/208326102205-已选/208326102205-00413.jpg',
    }).keep,
    false,
  )
  assert.equal(
    helpers.classifyVideoAsset('model', {
      dir: '0',
      filename: '2026-5-13 bala3965 AI换头.jpg',
      fullpath: '模拍原图/208326102205-已选/2026-5-13 bala3965 AI换头.jpg',
    }).action,
    '保留AI模拍图',
  )
  assert.equal(
    helpers.classifyVideoAsset('detail', {
      dir: '0',
      filename: '合格证 208326102205.jpg',
      fullpath: '平拍原图/208326102205 5-已写/合格证 208326102205.jpg',
    }).keep,
    false,
  )
})

test('buildCodePlan selects model and detail folders then builds organized download queue', async () => {
  const root = '巴拉货控/02 产品上新模块/2-2 巴拉产品上新'
  const helpers = await loadExports({
    fetch: async (url) => {
      const textUrl = String(url)
      if (textUrl.includes('/fengcloud/2/file/search')) {
        return jsonResponse({
          total: 2,
          list: [
            {
              dir: '1',
              filename: '208326102205-可选5.27-已选5.27',
              fullpath: `${root}/2026年巴拉秋/模拍原图/期货/0P/幼童/208326102205-可选5.27-已选5.27`,
              last_dateline: '1779881553',
            },
            {
              dir: '1',
              filename: '208326102205 5-已写',
              fullpath: `${root}/2026年巴拉秋/平拍原图/0p/幼童/208326102205 5-已写`,
              last_dateline: '1777012678',
            },
          ],
        })
      }
      if (textUrl.includes('/fengcloud/1/file/ls')) {
        const decoded = decodeURIComponent(textUrl)
        if (decoded.includes('模拍原图')) {
          return jsonResponse({
            total: 2,
            list: [
              {
                dir: 0,
                filename: '2026-5-13 bala3965 AI换头.jpg',
                fullpath: `${root}/2026年巴拉秋/模拍原图/期货/0P/幼童/208326102205-可选5.27-已选5.27/2026-5-13 bala3965 AI换头.jpg`,
                filehash: 'model-hash',
                filesize: String(21 * 1024 * 1024),
              },
              {
                dir: 0,
                filename: '208326102205-00413.jpg',
                fullpath: `${root}/2026年巴拉秋/模拍原图/期货/0P/幼童/208326102205-可选5.27-已选5.27/208326102205-00413.jpg`,
                filehash: 'white-hash',
              },
            ],
          })
        }
        return jsonResponse({
          total: 1,
          list: [{
            dir: 0,
            filename: 'IMG_1295.jpg',
            fullpath: `${root}/2026年巴拉秋/平拍原图/0p/幼童/208326102205 5-已写/IMG_1295.jpg`,
            filehash: 'detail-hash',
          }],
        })
      }
      if (textUrl.includes('/fengcloud/2/file/info')) {
        return jsonResponse({ uri: `https://download.example/${encodeURIComponent(textUrl)}` })
      }
      return jsonResponse({})
    },
  })

  const plan = await helpers.buildCodePlan(
    '208326102205',
    { mountId: '2023', relativePath: root },
    1,
    1,
    { folderScanDepth: 1, duplicateMode: 'first_per_hash', maxImageMb: 20 },
  )

  assert.equal(plan.downloadItems.length, 2)
  assert.equal(plan.downloadItems[0].target_relative_path.includes('208326102205/01_模拍原图/'), true)
  assert.equal(plan.downloadItems[1].target_relative_path.includes('208326102205/02_商品细节图/'), true)
  assert.equal(plan.rows.some(row => row['处理动作'] === '已过滤' && /白底/.test(row['备注'])), true)
  assert.equal(plan.rows.find(row => row['素材来源'] === '模拍图' && row['下载结果'] === '')['压缩结果'], '待压缩')
})
