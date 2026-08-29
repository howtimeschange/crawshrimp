import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/shenhui-new-arrival/batch-label-tile-download.js')

async function loadExports(options = {}) {
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8')
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
    navigator: { userAgent: 'node-test' },
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
  await vm.runInNewContext(source, context, { filename: SCRIPT_PATH })
  return exportsBox
}

function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }
}

test('selectLabelItems prefers yq1 and yq2 over descriptive label filenames', async () => {
  const helpers = await loadExports()
  const items = [
    {
      dir: '0',
      ext: 'jpg',
      filename: '208426108223吊牌.jpg',
      fullpath: '平拍原图/208426108223/208426108223吊牌.jpg',
    },
    {
      dir: '0',
      ext: 'jpg',
      filename: 'yq1.jpg',
      fullpath: '平拍原图/208426108223/yq1.jpg',
    },
    {
      dir: '0',
      ext: 'jpg',
      filename: '208426108223洗唛.jpg',
      fullpath: '平拍原图/208426108223/208426108223洗唛.jpg',
    },
    {
      dir: '0',
      ext: 'jpg',
      filename: 'yq2.jpg',
      fullpath: '平拍原图/208426108223/yq2.jpg',
    },
    {
      dir: '0',
      ext: 'pdf',
      filename: '208426108223(1).pdf',
      fullpath: '平拍原图/208426108223/208426108223(1).pdf',
    },
  ]

  assert.deepEqual(
    Array.from(helpers.selectLabelItems(items, 'hang_tag', '208426108223').map(item => item.filename)),
    ['yq1.jpg'],
  )
  assert.deepEqual(
    Array.from(helpers.selectLabelItems(items, 'wash_label', '208426108223').map(item => item.filename)),
    ['yq2.jpg'],
  )
})

test('selectLabelItems does not treat code-only PDF as wash label without explicit marker', async () => {
  const helpers = await loadExports()
  const items = [
    {
      dir: '0',
      ext: 'pdf',
      filename: '135冬季57更新K228044901合格证-balaOne线上专属208426107013四月天.pdf',
      fullpath: '平拍原图/208426107013/135冬季57更新K228044901合格证-balaOne线上专属208426107013四月天.pdf',
    },
    {
      dir: '0',
      ext: 'pdf',
      filename: '20842610701311781059940298_3301.pdf',
      fullpath: '平拍原图/208426107013/20842610701311781059940298_3301.pdf',
    },
  ]

  assert.equal(helpers.isCodeOnlyWashPdfItem(items[1], '208426107013'), true)
  assert.equal(helpers.isCodeOnlyWashPdfItem(items[0], '208426107013'), false)
  assert.deepEqual(
    Array.from(helpers.selectLabelItems(items, 'hang_tag', '208426107013').map(item => item.filename)),
    ['135冬季57更新K228044901合格证-balaOne线上专属208426107013四月天.pdf'],
  )
  assert.deepEqual(
    Array.from(helpers.selectLabelItems(items, 'wash_label', '208426107013').map(item => item.filename)),
    [],
  )
})

test('label tile plan preserves label filenames and filters waste markers', async () => {
  const helpers = await loadExports()
  const items = [
    {
      dir: '0',
      ext: 'jpg',
      filename: '208426108223吊牌.jpg',
      fullpath: '平拍原图/208426108223/208426108223吊牌.jpg',
    },
    {
      dir: '0',
      ext: 'jpg',
      filename: '208426108223无水洗废图.jpg',
      fullpath: '平拍原图/208426108223/208426108223无水洗废图.jpg',
    },
    {
      dir: '0',
      ext: 'jpg',
      filename: '208426108223平铺图.jpg',
      fullpath: '平拍原图/208426108223/208426108223无吊牌/208426108223平铺图.jpg',
    },
  ]

  assert.equal(helpers.hasWasteLabelMarker(items[1]), true)
  assert.equal(helpers.inferLabelKind(items[1], '208426108223'), '')
  assert.deepEqual(
    Array.from(helpers.selectLabelItems(items, 'hang_tag', '208426108223').map(item => item.filename)),
    ['208426108223吊牌.jpg'],
  )
  assert.equal(
    helpers.buildPackageFilename('208426108223', 'hang_tag', items[0]),
    '208426108223吊牌.jpg',
  )
  assert.deepEqual(
    Array.from(helpers.selectTileItems([], items, '208426108223').items.map(item => item.filename)),
    [],
  )
})

test('buildCodePlan downloads model-path tile first and appends 有模拍 to filename', async () => {
  const helpers = await loadExports({
    fetch: async (url) => {
      const textUrl = String(url)
      const decoded = decodeURIComponent(textUrl)
      if (textUrl.includes('/fengcloud/2/file/search')) {
        return jsonResponse({
          total: 2,
          list: [
            {
              dir: '1',
              filename: '208426108223--模拍已选',
              fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/模拍原图/期货/1P/幼童服装/208426108223--模拍已选',
            },
            {
              dir: '1',
              filename: '208426108223--平拍已写',
              fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/平拍原图/2P/婴幼童/幼童-2.5已写/208426108223--平拍已写',
            },
          ],
        })
      }
      if (textUrl.includes('/fengcloud/1/file/ls') && decoded.includes('模拍原图')) {
        return jsonResponse({
          count: 3,
          list: [
            {
              dir: '0',
              ext: 'jpg',
              filename: '208426108223-00316.jpg',
              fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/模拍原图/期货/1P/幼童服装/208426108223--模拍已选/208426108223-00316.jpg',
            },
            {
              dir: '0',
              ext: 'jpg',
              filename: 'm(1).208426103211-01315.jpg',
              fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/模拍原图/期货/1P/幼童服装/208426108223--模拍已选/m(1).208426103211-01315.jpg',
            },
            {
              dir: '0',
              ext: 'jpg',
              filename: 'bala-model-look.jpg',
              fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/模拍原图/期货/1P/幼童服装/208426108223--模拍已选/bala-model-look.jpg',
            },
          ],
        })
      }
      if (textUrl.includes('/fengcloud/1/file/ls') && decoded.includes('平拍原图')) {
        return jsonResponse({
          count: 3,
          list: [
            {
              dir: '0',
              ext: 'jpg',
              filename: 'yq1.jpg',
              fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/平拍原图/2P/婴幼童/幼童-2.5已写/208426108223--平拍已写/yq1.jpg',
            },
            {
              dir: '0',
              ext: 'jpg',
              filename: 'yq2.jpg',
              fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/平拍原图/2P/婴幼童/幼童-2.5已写/208426108223--平拍已写/yq2.jpg',
            },
            {
              dir: '0',
              ext: 'jpg',
              filename: '208426108223平铺图.jpg',
              fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/平拍原图/2P/婴幼童/幼童-2.5已写/208426108223--平拍已写/208426108223平铺图.jpg',
            },
          ],
        })
      }
      if (textUrl.includes('/fengcloud/2/file/info')) {
        return jsonResponse({ uri: `https://download.example/${encodeURIComponent(decoded)}` })
      }
      return jsonResponse({})
    },
  })

  const modelRelativePath = '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/模拍原图/期货/1P/幼童服装'
  const stillRelativePath = '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/平拍原图/2P/婴幼童/幼童-2.5已写'
  const plan = await helpers.buildCodePlan(
    '208426108223',
    {
      model: {
        mountId: 'm1',
        relativePath: modelRelativePath,
        broadRelativePath: helpers.deriveBroadSourcePrefix(modelRelativePath, 'model'),
      },
      still: {
        mountId: 'm1',
        relativePath: stillRelativePath,
        broadRelativePath: helpers.deriveBroadSourcePrefix(stillRelativePath, 'still'),
      },
    },
    { folderScanDepth: 1 },
  )

  const tileRows = plan.rows.filter(row => row['素材类型'] === '平铺图')
  assert.equal(tileRows.length, 1)
  assert.equal(tileRows[0]['素材来源'], '模拍路径')
  assert.equal(tileRows[0]['文件名'], '208426108223-00316_有模拍.jpg')
  assert.equal(tileRows.some(row => row['云盘路径'].includes('208426103211')), false)
  assert.equal(tileRows[0]['模拍路径命中'], '是')
  assert.equal(plan.rows.find(row => row['素材类型'] === '吊牌')['匹配策略'], '优先命中 yq1')
  assert.equal(plan.rows.find(row => row['素材类型'] === '吊牌')['文件名'], 'yq1.jpg')
  assert.equal(plan.rows.find(row => row['素材类型'] === '洗唛')['匹配策略'], '优先命中 yq2')
  assert.equal(plan.rows.find(row => row['素材类型'] === '洗唛')['文件名'], 'yq2.jpg')
  assert.equal(plan.downloadItems.length, 3)
})

test('selectTileItems keeps one tile per style color and drops unkeyed folder shots when color tiles exist', async () => {
  const helpers = await loadExports()
  assert.equal(helpers.isBacksideStyleColorFilename('208426108223-00422-1.jpg', '208426108223'), true)
  assert.equal(helpers.isBacksideStyleColorFilename('208426108223-00422.jpg', '208426108223'), false)

  const stillItems = [
    {
      dir: '0',
      ext: 'jpg',
      filename: '208426108223-00422.jpg',
      fullpath: '平拍原图/208426108223 已写/208426108223-00422.jpg',
    },
    {
      dir: '0',
      ext: 'jpg',
      filename: '208426108223-00422-1.jpg',
      fullpath: '平拍原图/208426108223 已写/208426108223-00422-1.jpg',
    },
    {
      dir: '0',
      ext: 'png',
      filename: '208426108223-00488 透明图.png',
      fullpath: '平拍原图/208426108223 已写/208426108223-00488 透明图.png',
    },
    {
      dir: '0',
      ext: 'jpg',
      filename: 'IMG_2240.jpg',
      fullpath: '平拍原图/208426108223 已写/IMG_2240.jpg',
    },
  ]

  const selection = helpers.selectTileItems([], stillItems, '208426108223')

  assert.equal(selection.sourceType, 'still')
  assert.deepEqual(
    selection.items.map(item => item.filename).sort(),
    ['208426108223-00422.jpg', '208426108223-00488 透明图.png'].sort(),
  )
})

test('selectTileItems keeps a single folder fallback tile when no style color is available', async () => {
  const helpers = await loadExports()
  const stillItems = [
    {
      dir: '0',
      ext: 'jpg',
      filename: 'IMG_2240.jpg',
      fullpath: '平拍原图/208426108223 已写/IMG_2240.jpg',
    },
    {
      dir: '0',
      ext: 'jpg',
      filename: 'IMG_2241.jpg',
      fullpath: '平拍原图/208426108223 已写/IMG_2241.jpg',
    },
  ]

  const selection = helpers.selectTileItems([], stillItems, '208426108223')

  assert.equal(selection.sourceType, 'still')
  assert.equal(selection.items.length, 1)
  assert.equal(selection.items[0].filename, 'IMG_2240.jpg')
})

test('selectShoeLabelItems keeps only a small OCR candidate tail for unnamed shoe box photos', async () => {
  const helpers = await loadExports()
  const basePath = '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉冬/平拍原图/全域/7p/鞋品/204426141122-已写/00322/36'
  const items = [
    {
      dir: '0',
      ext: 'jpg',
      filename: '204426141122-00322.jpg',
      fullpath: `${basePath}/204426141122-00322.jpg`,
    },
    {
      dir: '0',
      ext: 'jpg',
      filename: 'yk1.jpg',
      fullpath: `${basePath}/yk1.jpg`,
    },
    {
      dir: '0',
      ext: 'jpg',
      filename: 'GUDO6700 拷贝.jpg',
      fullpath: `${basePath}/GUDO6700 拷贝.jpg`,
    },
    ...Array.from({ length: 12 }, (_unused, index) => {
      const number = 6800 + index
      return {
        dir: '0',
        ext: 'jpg',
        filename: `GUDO${number}.jpg`,
        fullpath: `${basePath}/GUDO${number}.jpg`,
      }
    }),
  ]

  const selected = helpers.selectShoeLabelItems(items, '204426141122')

  assert.equal(selected.length, 8)
  assert.deepEqual(
    Array.from(selected, item => item.filename),
    Array.from({ length: 8 }, (_unused, index) => `GUDO${6804 + index}.jpg`),
  )
  assert.equal(selected.every(item => item.__shoe_color_code === '00322'), true)
  assert.equal(selected.every(item => item.__shoe_label_candidate_kind === 'generic_ocr'), true)
})

test('selectShoeLabelItems respects requested shoe color for OCR candidates', async () => {
  const helpers = await loadExports()
  const itemForColor = (color, filename) => ({
    dir: '0',
    ext: 'jpg',
    filename,
    fullpath: `巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉冬/平拍原图/全域/7p/鞋品/204426141129 2-已写/${color}/27/${filename}`,
  })
  const items = [
    itemForColor('00322', 'GUDO7015.jpg'),
    itemForColor('00322', 'GUDO7016.jpg'),
    itemForColor('00415', 'GUDO7035.jpg'),
    itemForColor('00415', 'GUDO7036.jpg'),
  ]

  const selected = helpers.selectShoeLabelItems(items, '204426141129-00322')

  assert.deepEqual(Array.from(selected, item => item.filename), ['GUDO7015.jpg', 'GUDO7016.jpg'])
  assert.equal(selected.every(item => item.__shoe_color_code === '00322'), true)
})
