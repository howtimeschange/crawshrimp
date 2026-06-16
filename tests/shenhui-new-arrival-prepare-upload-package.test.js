import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function loadExports(options = {}) {
  const scriptPath = path.resolve('adapters/shenhui-new-arrival/prepare-upload-package.js')
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

async function runScript(options = {}) {
  const scriptPath = path.resolve('adapters/shenhui-new-arrival/prepare-upload-package.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: options.params || {},
      __CRAWSHRIMP_PHASE__: options.phase || 'init',
      __CRAWSHRIMP_SHARED__: options.shared || {},
      __CRAWSHRIMP_EXPORTS__: null,
    },
    document: {},
    location: options.location || { href: 'https://fmp.semirapp.com/web/index#/home/file', hash: '#/home/file' },
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
  return vm.runInNewContext(source, context, { filename: scriptPath })
}

function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }
}

test('matches assets when the style code is only present in the parent folder', async () => {
  const helpers = await loadExports()
  const image = {
    dir: '0',
    ext: 'jpg',
    filename: 'balaBR05106-72904_P.jpg',
    fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/模拍原图/期货/1P/幼童服装/208226103201--新回图齐1.28已选/balaBR05106-72904_P.jpg',
  }
  const folder = {
    dir: '1',
    filename: '208226103201--新回图齐1.28已选',
    fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/模拍原图/期货/1P/幼童服装/208226103201--新回图齐1.28已选',
  }

  assert.equal(helpers.matchesAssetItemForCode(image, '208226103201'), true)
  assert.equal(helpers.matchesFolderItemForCode(folder, '208226103201'), true)
})

test('matches style folders when plus sign separates the code from status notes', async () => {
  const helpers = await loadExports()
  const folder = {
    dir: '1',
    filename: '208326105004+AI已回5.27-导购新回齐6.3-已选',
    fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/模拍原图/期货/1P/中童/208326105004+AI已回5.27-导购新回齐6.3-已选',
  }

  assert.equal(helpers.matchesFolderItemForCode(folder, '208326105004'), true)
})

test('collectCandidateAssets uses search results as folder locators instead of direct image hits', async () => {
  const fetchCalls = []
  const helpers = await loadExports({
    fetch: async (url) => {
      fetchCalls.push(String(url))
      if (String(url).includes('/fengcloud/2/file/search')) {
        return jsonResponse({
          total: 2,
          list: [
            {
              dir: '0',
              ext: 'jpg',
              filename: '208226103201-single-hit.jpg',
              fullpath: '模拍原图/期货/1P/幼童服装/208226103201-single-hit.jpg',
            },
            {
              dir: '1',
              filename: '208226103201--新回图齐1.28已选',
              fullpath: '模拍原图/期货/1P/幼童服装/208226103201--新回图齐1.28已选',
            },
          ],
        })
      }
      if (String(url).includes('/fengcloud/1/file/ls')) {
        return jsonResponse({
          count: 1,
          list: [{
            dir: '0',
            ext: 'jpg',
            filename: 'balaBR05106-72904_P.jpg',
            fullpath: '模拍原图/期货/1P/幼童服装/208226103201--新回图齐1.28已选/balaBR05106-72904_P.jpg',
          }],
        })
      }
      return jsonResponse({})
    },
  })

  const result = await helpers.collectCandidateAssets(
    '208226103201',
    { mountId: 'm1', relativePath: '模拍原图/期货/1P/幼童服装' },
    { folderScanDepth: 1 },
  )

  assert.equal(result.folderCount, 1)
  assert.deepEqual([...result.items.map(item => item.filename)], ['balaBR05106-72904_P.jpg'])
  assert.equal(fetchCalls.some(url => url.includes('/fengcloud/1/file/ls')), true)
  assert.equal(fetchCalls.some(url => url.includes('current=1') && url.includes('order=filename+asc')), true)
})

test('collectCandidateAssets falls back to the same source class when the exact path has no style folder', async () => {
  const helpers = await loadExports({
    fetch: async (url) => {
      const textUrl = String(url)
      if (textUrl.includes('/fengcloud/2/file/search')) {
        return jsonResponse({
          total: 2,
          list: [
            {
              dir: '0',
              ext: 'jpg',
              filename: '208226102001-direct-hit.jpg',
              fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/模拍原图/期货/1P/幼童服装/208226102001-direct-hit.jpg',
            },
            {
              dir: '1',
              filename: '208226102001-新回图齐2.6-已选2.9',
              fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/模拍原图/期货/2P/幼童/208226102001-新回图齐2.6-已选2.9',
            },
          ],
        })
      }
      if (textUrl.includes('/fengcloud/1/file/ls')) {
        assert.equal(decodeURIComponent(textUrl).includes('/期货/2P/幼童/'), true)
        return jsonResponse({
          count: 1,
          list: [{
            dir: '0',
            ext: 'jpg',
            filename: 'balaBR05106-72904_P.jpg',
            fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/模拍原图/期货/2P/幼童/208226102001-新回图齐2.6-已选2.9/balaBR05106-72904_P.jpg',
          }],
        })
      }
      return jsonResponse({})
    },
  })

  const relativePath = '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/模拍原图/期货/1P/幼童服装'
  const result = await helpers.collectCandidateAssets(
    '208226102001',
    {
      mountId: 'm1',
      relativePath,
      broadRelativePath: helpers.deriveBroadSourcePrefix(relativePath, 'model'),
    },
    { folderScanDepth: 1, sourceType: 'model' },
  )

  assert.equal(result.usedFallbackScope, true)
  assert.equal(result.folderCount, 1)
  assert.deepEqual([...result.items.map(item => item.filename)], ['balaBR05106-72904_P.jpg'])
})

test('collectCandidateAssets uses direct asset hits when no style folder can be listed', async () => {
  const helpers = await loadExports({
    fetch: async (url) => {
      const textUrl = String(url)
      if (textUrl.includes('/fengcloud/2/file/search')) {
        return jsonResponse({
          total: 2,
          list: [
            {
              dir: '0',
              ext: 'jpg',
              filename: 'balaBR05106-72904_P.jpg',
              fullpath: '模拍原图/期货/1P/幼童服装/208226103201--新回图齐1.28已选/balaBR05106-72904_P.jpg',
            },
            {
              dir: '0',
              ext: 'jpg',
              filename: 'balaBR05106-72905_P.jpg',
              fullpath: '模拍原图/期货/1P/幼童服装/208226103201--新回图齐1.28已选/balaBR05106-72905_P.jpg',
            },
          ],
        })
      }
      return jsonResponse({})
    },
  })

  const result = await helpers.collectCandidateAssets(
    '208226103201',
    { mountId: 'm1', relativePath: '模拍原图/期货/1P/幼童服装' },
    { folderScanDepth: 2, sourceType: 'model' },
  )

  assert.equal(result.folderCount, 0)
  assert.equal(result.directAssetCount, 2)
  assert.equal(result.usedDirectAssetFallback, true)
  assert.deepEqual([...result.items.map(item => item.filename)], ['balaBR05106-72904_P.jpg', 'balaBR05106-72905_P.jpg'])
})

test('collectCandidateAssets ignores model package folders named packaging', async () => {
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
              filename: '208226103201--新回图齐1.28已选',
              fullpath: '模拍原图/期货/1P/幼童服装/208226103201--新回图齐1.28已选',
            },
            {
              dir: '1',
              filename: '包装',
              fullpath: '模拍原图/期货/1P/幼童服装/208226103201--新回图齐1.28已选/包装',
            },
          ],
        })
      }
      if (textUrl.includes('/fengcloud/1/file/ls')) {
        assert.equal(decodeURIComponent(textUrl).includes('/包装'), false)
        return jsonResponse({
          count: 2,
          list: [
            {
              dir: '1',
              filename: '包装',
              fullpath: '模拍原图/期货/1P/幼童服装/208226103201--新回图齐1.28已选/包装',
            },
            {
              dir: '0',
              ext: 'jpg',
              filename: 'balaBR05106-72904_P.jpg',
              fullpath: '模拍原图/期货/1P/幼童服装/208226103201--新回图齐1.28已选/balaBR05106-72904_P.jpg',
            },
          ],
        })
      }
      return jsonResponse({})
    },
  })

  const result = await helpers.collectCandidateAssets(
    '208226103201',
    { mountId: 'm1', relativePath: '模拍原图/期货/1P/幼童服装' },
    { folderScanDepth: 2, sourceType: 'model' },
  )

  assert.equal(result.folderCount, 1)
  assert.deepEqual([...result.items.map(item => item.filename)], ['balaBR05106-72904_P.jpg'])
  assert.equal(fetchCalls.some(url => decodeURIComponent(url).includes('/包装')), false)
})

test('classifySopAsset applies the deep-draw SOP filtering and yq naming rules', async () => {
  const helpers = await loadExports()

  const packaging = helpers.classifySopAsset('model', {
    ext: 'jpg',
    filename: '208226103201包装图.jpg',
    fullpath: '模拍原图/208226103201包装图.jpg',
  })
  assert.equal(packaging.role, 'skip')
  assert.equal(packaging.keep, false)
  assert.equal(packaging.action, '已过滤')
  assert.equal(packaging.reason, '模特图包包装图按 SOP 删除')
  assert.equal(packaging.packageFilename, '')

  const whiteBackground = helpers.classifySopAsset('model', {
    ext: 'jpg',
    filename: '208226103201-00313.jpg',
    fullpath: '模拍原图/208226103201/208226103201-00313.jpg',
  })
  assert.equal(whiteBackground.keep, false)
  assert.equal(whiteBackground.reason, '模特图包白底图按命名规则删除')

  const prefixedWhiteBackground = helpers.classifySopAsset('model', {
    ext: 'jpg',
    filename: 'm(1).208226169001-00341 (2).jpg',
    fullpath: '模拍原图/208226169001/m(1).208226169001-00341 (2).jpg',
  })
  assert.equal(prefixedWhiteBackground.keep, false)
  assert.equal(prefixedWhiteBackground.reason, '模特图包白底图按命名规则删除')

  const mLeadingModelImage = helpers.classifySopAsset('model', {
    ext: 'jpg',
    filename: 'M208226103201-detail.jpg',
    fullpath: '模拍原图/208226103201/M208226103201-detail.jpg',
  })
  assert.equal(helpers.isModelMLeadingImageFilename('m208226103201-look.jpg'), true)
  assert.equal(mLeadingModelImage.keep, false)
  assert.equal(mLeadingModelImage.reason, '模特图包 m 开头图片按规则删除')

  const model = helpers.classifySopAsset('model', {
    ext: 'jpg',
    filename: 'balaBR05106-72904_P.jpg',
    fullpath: '模拍原图/208226103201/balaBR05106-72904_P.jpg',
  })
  assert.equal(model.keep, true)
  assert.equal(model.role, 'image')
  assert.equal(model.packageFilename, 'balaBR05106-72904_P.jpg')

  const stillPsd = helpers.classifySopAsset('still', {
    ext: 'psd',
    filename: 'NB9A7238.psd',
    fullpath: '平拍原图/NB9A7238.psd',
  })
  assert.equal(stillPsd.keep, false)
  assert.match(stillPsd.reason, /\.psd/)

  const stillWash = helpers.classifySopAsset('still', {
    ext: 'jpg',
    filename: '208226103201水洗.jpg',
    fullpath: '平拍原图/208226103201水洗.jpg',
  })
  assert.equal(stillWash.keep, true)
  assert.equal(stillWash.role, 'yq')
  assert.equal(stillWash.packageFilename, 'yq.jpg')

  const stillPdf = helpers.classifySopAsset('still', {
    ext: 'pdf',
    filename: '208226103201吊牌.pdf',
    fullpath: '平拍原图/208226103201吊牌.pdf',
  })
  assert.equal(stillPdf.keep, true)
  assert.equal(stillPdf.role, 'pdf_yq')
  assert.equal(stillPdf.packageFilename, '208226103201吊牌.pdf')
  assert.equal(stillPdf.pdfType, 'hang_tag')

  const stillWashPdf = helpers.classifySopAsset('still', {
    ext: 'pdf',
    filename: '208226103201洗唛.pdf',
    fullpath: '平拍原图/208226103201洗唛.pdf',
  })
  assert.equal(stillWashPdf.keep, true)
  assert.equal(stillWashPdf.role, 'pdf_yq')
  assert.equal(stillWashPdf.pdfType, 'wash_label')

  const sizePdf = helpers.classifySopAsset('still', {
    ext: 'pdf',
    filename: '208226103201尺码表.pdf',
    fullpath: '平拍原图/208226103201尺码表.pdf',
  })
  assert.equal(sizePdf.keep, false)
  assert.equal(sizePdf.role, 'skip')
  assert.match(sizePdf.reason, /非洗唛\/吊牌 PDF/)
})

test('classifySopAsset does not treat style folder status notes as yq markers', async () => {
  const helpers = await loadExports()

  const shoeProduct = helpers.classifySopAsset('still', {
    ext: 'jpg',
    filename: 'GUDG5621.jpg',
    fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/平拍原图/特殊批/鞋品/6.12上市/208326140202 4吊牌已补-已写/00304/29/GUDG5621.jpg',
  })
  assert.equal(shoeProduct.keep, true)
  assert.equal(shoeProduct.role, 'image')
  assert.equal(shoeProduct.packageFilename, 'GUDG5621.jpg')

  const shoeAngle = helpers.classifySopAsset('still', {
    ext: 'png',
    filename: '208326140202-00304+Ai角度图1.png',
    fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/平拍原图/特殊批/鞋品/6.12上市/208326140202 4吊牌已补-已写/00304/29/208326140202-00304+Ai角度图1.png',
  })
  assert.equal(shoeAngle.keep, true)
  assert.equal(shoeAngle.role, 'image')
  assert.equal(shoeAngle.packageFilename, '208326140202-00304+Ai角度图1.png')

  const tagImage = helpers.classifySopAsset('still', {
    ext: 'jpg',
    filename: '商品标签(3)_1 (1).jpg',
    fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/平拍原图/特殊批/鞋品/6.12上市/208326140202 4吊牌已补-已写/00304/29/商品标签(3)_1 (1).jpg',
  })
  assert.equal(tagImage.keep, true)
  assert.equal(tagImage.role, 'yq')
  assert.equal(tagImage.packageFilename, 'yq.jpg')
})

test('classifySopAsset treats lQLP label composites in tag status folders as yq', async () => {
  const helpers = await loadExports()

  const tagComposite = helpers.classifySopAsset('still', {
    ext: 'png',
    filename: 'lQLPJwNKCjsjyT3NAQrNA0-wDefRtyoCp4wJ0LgLV-VkAQ_847_266.png',
    fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/平拍原图/特殊批/鞋品/6.12上市/208326146209 吊牌已补-已写/lQLPJwNKCjsjyT3NAQrNA0-wDefRtyoCp4wJ0LgLV-VkAQ_847_266.png',
  })
  assert.equal(tagComposite.keep, true)
  assert.equal(tagComposite.role, 'yq')
  assert.equal(tagComposite.packageFilename, 'yq.png')

  const regularChatNamedImage = helpers.classifySopAsset('still', {
    ext: 'png',
    filename: 'lQLPJwNKCjsjyT3NAQrNA0-wDefRtyoCp4wJ0LgLV-VkAQ_847_266.png',
    fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/平拍原图/特殊批/鞋品/6.12上市/208326146209/lQLPJwNKCjsjyT3NAQrNA0-wDefRtyoCp4wJ0LgLV-VkAQ_847_266.png',
  })
  assert.equal(regularChatNamedImage.keep, true)
  assert.equal(regularChatNamedImage.role, 'image')
  assert.equal(
    regularChatNamedImage.packageFilename,
    'lQLPJwNKCjsjyT3NAQrNA0-wDefRtyoCp4wJ0LgLV-VkAQ_847_266.png',
  )
})

test('normalizeDownloadConcurrency defaults and clamps the large-image download setting', async () => {
  const helpers = await loadExports()

  assert.equal(helpers.normalizeDownloadConcurrency(''), 8)
  assert.equal(helpers.normalizeDownloadConcurrency('20'), 20)
  assert.equal(helpers.normalizeDownloadConcurrency('0'), 1)
  assert.equal(helpers.normalizeDownloadConcurrency('128'), 32)
})

test('normalizeRetryFailedPlan extracts only retryable failed cloud paths', async () => {
  const helpers = await loadExports()

  const plan = helpers.normalizeRetryFailedPlan({
    rows: [
      { '输入编码': '208226111002', '云盘路径': '模拍/208226111002/a.jpg', '下载结果': '已下载' },
      { '输入编码': '208226111002', '云盘路径': '模拍/208226111002/b.jpg', '下载结果': '下载失败' },
      { '输入编码': '208226111003', '云盘路径': '平拍/208226111003/c.jpg', '下载结果': '获取下载链接失败' },
      { '输入编码': '208226111003', '云盘路径': '', '下载结果': '下载失败' },
      { '输入编码': '208226111004', '云盘路径': '平拍/208226111004/d.psd', '下载结果': '已跳过' },
    ],
  })

  assert.equal(plan.active, true)
  assert.equal(plan.failedCount, 2)
  assert.deepEqual([...plan.codes], ['208226111002', '208226111003'])
  assert.deepEqual([...plan.paths], ['模拍/208226111002/b.jpg', '平拍/208226111003/c.jpg'])
})

test('filterRetryFailedItems keeps only exact failed cloud paths during rerun', async () => {
  const helpers = await loadExports()
  const items = [
    { filename: 'a.jpg', fullpath: '模拍/208226111002/a.jpg' },
    { filename: 'b.jpg', fullpath: '模拍/208226111002/b.jpg' },
  ]

  assert.deepEqual(
    helpers.filterRetryFailedItems(items, ['模拍/208226111002/b.jpg']).map(item => item.filename),
    ['b.jpg'],
  )
  assert.deepEqual(helpers.filterRetryFailedItems(items, []).map(item => item.filename), ['a.jpg', 'b.jpg'])
})

test('normalizeSourceTypes defaults to both and supports single image type selections', async () => {
  const helpers = await loadExports()

  assert.deepEqual([...helpers.normalizeSourceTypes('')], ['model', 'still'])
  assert.deepEqual([...helpers.normalizeSourceTypes('all')], ['model', 'still'])
  assert.deepEqual([...helpers.normalizeSourceTypes('model')], ['model'])
  assert.deepEqual([...helpers.normalizeSourceTypes('still')], ['still'])
  assert.deepEqual([...helpers.normalizeSourceTypes('unknown')], ['model', 'still'])
})

test('init only requires the cloud path for the selected image source type', async () => {
  const result = await runScript({
    params: {
      image_source_type: 'model',
      model_cloud_path: '巴拉营运BU-商品//模拍原图/期货/1P/幼童服装/',
      item_codes: '208226103201',
    },
    fetch: async (url) => {
      if (String(url).includes('/fengcloud/1/account/mount')) {
        return jsonResponse({ list: [{ org_name: '巴拉营运BU-商品', mount_id: 'm1' }] })
      }
      return jsonResponse({})
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'ensure_folder')
  assert.deepEqual([...Object.keys(result.meta.shared.source_configs)], ['model'])
  assert.equal(result.meta.shared.source_configs.model.relativePath, '模拍原图/期货/1P/幼童服装')
  assert.equal(result.meta.shared.source_configs.still, undefined)
})

test('buildCodePlan only plans the selected image source types', async () => {
  const helpers = await loadExports({
    fetch: async (url) => {
      const textUrl = String(url)
      if (textUrl.includes('/fengcloud/2/file/search')) {
        return jsonResponse({
          total: 2,
          list: [
            {
              dir: '1',
              filename: '208226103201--模特',
              fullpath: '模拍原图/208226103201--模特',
            },
            {
              dir: '1',
              filename: '208226103201--静物',
              fullpath: '平拍原图/208226103201--静物',
            },
          ],
        })
      }
      if (textUrl.includes('/fengcloud/1/file/ls')) {
        const decoded = decodeURIComponent(textUrl)
        if (decoded.includes('模拍原图')) {
          return jsonResponse({
            count: 1,
            list: [{
              dir: '0',
              ext: 'jpg',
              filename: 'model-look.jpg',
              fullpath: '模拍原图/208226103201--模特/model-look.jpg',
            }],
          })
        }
        return jsonResponse({
          count: 1,
          list: [{
            dir: '0',
            ext: 'jpg',
            filename: 'still-main.jpg',
            fullpath: '平拍原图/208226103201--静物/still-main.jpg',
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
    '208226103201',
    {
      model: { mountId: 'm1', relativePath: '模拍原图' },
      still: { mountId: 'm1', relativePath: '平拍原图' },
    },
    1,
    1,
    { sourceTypes: ['still'], folderScanDepth: 1 },
  )

  assert.deepEqual([...new Set(plan.rows.map(row => row['素材来源']))], ['静物图'])
  assert.equal(plan.downloadItems.length, 1)
  assert.match(plan.downloadItems[0].label, /^静物图 \//)
})

test('finalizeRows maps download results only onto rows that were scheduled for download', async () => {
  const helpers = await loadExports()
  const rows = [
    {
      '输入款号': '208226103201',
      '输入编码': '208226103201',
      '素材来源': '模特图',
      '文件名': 'model.jpg',
      '下载结果': '',
      '备注': '',
    },
    {
      '输入款号': '208226103201',
      '输入编码': '208226103201',
      '素材来源': '静物图',
      '文件名': 'NB9A7238.psd',
      '下载结果': '已跳过',
      '备注': '.psd 文件按 SOP 删除',
    },
    {
      '输入款号': '208226103201',
      '输入编码': '208226103201',
      '素材来源': '静物图',
      '文件名': 'yq.jpg',
      '下载结果': '',
      '备注': '吊牌/水洗图片按 SOP 命名为 yq',
    },
  ]

  const result = helpers.finalizeRows(rows, {
    items: [
      { success: true, path: '/tmp/model.jpg' },
      { success: false, error: 'HTTP 403' },
    ],
  })

  assert.equal(result[0]['下载结果'], '已下载')
  assert.equal(result[0]['本地文件'], '/tmp/model.jpg')
  assert.equal(result[1]['下载结果'], '已跳过')
  assert.equal(result[2]['下载结果'], '下载失败')
  assert.equal(result[2]['备注'], 'HTTP 403')
})
