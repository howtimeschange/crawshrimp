import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function loadExports() {
  const scriptPath = path.resolve('adapters/tmall-ops-assistant/tmall-material-test.js')
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
    location: { href: 'https://myseller.taobao.com/home.htm/material-center/material-test/common_test' },
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
    Promise,
  }
  context.globalThis = context
  await vm.runInNewContext(source, context, { filename: scriptPath })
  return exportsBox
}

async function loadDataExportExports(href = 'https://myseller.taobao.com/home.htm/material-center/material-test/common_test') {
  const scriptPath = path.resolve('adapters/tmall-ops-assistant/tmall-material-test-data-export.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const exportsBox = {}
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: {},
      __CRAWSHRIMP_PHASE__: '__exports__',
      __CRAWSHRIMP_SHARED__: {},
      __CRAWSHRIMP_EXPORTS__: exportsBox,
      location: { href },
    },
    document: {},
    location: { href },
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
    Promise,
  }
  context.globalThis = context
  await vm.runInNewContext(source, context, { filename: scriptPath })
  return exportsBox
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('manifest removes the independent material-test probe task', () => {
  const manifest = fs.readFileSync(path.resolve('adapters/tmall-ops-assistant/manifest.yaml'), 'utf8')

  assert.doesNotMatch(manifest, /id: tmall_material_test_pipeline/)
  assert.doesNotMatch(manifest, /name: 天猫素材测图探路/)
  assert.doesNotMatch(manifest, /script: tmall-material-test\.js/)
})

test('Semir image candidates only accept showcase/yz(1) main and SKC-coded detail references', async () => {
  const helpers = await loadExports()
  const ranked = helpers.rankSemirMaterialCandidates([
    { filename: '208326121203.psd', ext: 'psd', fullpath: '平拍原图/208326121203/208326121203.psd' },
    { filename: 'ys-1.jpg', ext: 'jpg', fullpath: '模拍原图/已选/208326121203/ys-1.jpg' },
    { filename: '主图原图.jpg', ext: 'jpg', fullpath: '模拍原图/208326121203/主图原图.jpg' },
    { filename: '橱窗1+海报.jpg', ext: 'jpg', fullpath: '模拍原图/已选/208326121203/橱窗1+海报.jpg' },
    { filename: 'yz(1)-.jpg', ext: 'jpg', fullpath: '模拍原图/已选/208326121203/yz(1)-.jpg' },
    { filename: '货号208326121203 尺码表.pdf', ext: 'pdf', fullpath: '制单/货号208326121203 尺码表.pdf' },
    { filename: '208326121203-00482蓝灰正面.jpg', ext: 'jpg', fullpath: '平铺图/208326121203-00482蓝灰正面.jpg' },
    { filename: '208326121203_01.jpg', ext: 'jpg', fullpath: '平拍原图/208326121203/images/208326121203_01.jpg' },
  ], { styleCode: '208326121203', skcCode: '208326121203-00482', limit: 5 })

  assert.deepEqual(plain(ranked.map(item => item.filename)), [
    '橱窗1+海报.jpg',
    'yz(1)-.jpg',
    '208326121203-00482蓝灰正面.jpg',
  ])
  assert.equal(ranked[0].role, 'origin_showcase1')
  assert.equal(ranked[1].role, 'origin_yz1')
  assert.equal(ranked[2].role, 'detail_skc_flat')
  assert.equal(helpers.isMainReferenceName('ys-1.jpg'), false)
  assert.equal(helpers.isMainReferenceName('yz(1)-.jpg'), true)
  assert.equal(helpers.isMainReferenceName('yz(1)-AI(2).jpg'), true)
  assert.equal(helpers.isMainReferenceName('yz(1)AI版.jpg'), true)
  assert.equal(helpers.isMainReferenceName('橱窗1-AI版.jpg'), true)
  assert.equal(helpers.isMainReferenceName('橱窗10.jpg'), false)
  assert.equal(helpers.isSkcDetailReferenceName('208326121203_01.jpg', '208326121203-00482'), false)
})

test('Semir folder scan starts from the containing selected folder for style-matched files', async () => {
  const helpers = await loadExports()
  const selectedFolder = '巴拉营运BU-商品/巴拉货控/2026年巴拉秋/208326108101-AI已回齐5.19-已选'
  const paths = helpers.folderPathsFromSearchItem({
    filename: '208326108101-00442.jpg',
    ext: 'jpg',
    fullpath: `${selectedFolder}/208326108101-00442.jpg`,
  }, '208326108101')

  assert.equal(paths.includes(selectedFolder), true)
  assert.equal(paths.includes(`${selectedFolder}/208326108101-00442.jpg`), false)

  const broadPaths = helpers.folderPathsFromSearchItem({
    filename: '208326108101-00442.jpg',
    ext: 'jpg',
    fullpath: '巴拉营运BU-商品/巴拉货控/2026年巴拉秋/平拍混放/208326108101-00442.jpg',
  }, '208326108101')
  assert.deepEqual(plain(broadPaths), [])
})

test('Semir main image candidates must also live under the current style path', async () => {
  const helpers = await loadExports()
  const ranked = helpers.rankSemirMaterialCandidates([
    { filename: 'yz(1)AI.jpg', ext: 'jpg', fullpath: '模拍原图/已选/208326105205-已选/yz(1)AI.jpg' },
    { filename: 'yz(1)-AI(2).jpg', ext: 'jpg', fullpath: '模拍原图/已选/208326108101-已选/yz(1)-AI(2).jpg' },
  ], { styleCode: '208326108101', limit: 5 })

  assert.deepEqual(plain(ranked.map(item => item.fullpath)), [
    '模拍原图/已选/208326108101-已选/yz(1)-AI(2).jpg',
  ])
})

test('Semir detail reference can infer SKC as style code plus five digit color code', async () => {
  const helpers = await loadExports()
  const ranked = helpers.rankSemirMaterialCandidates([
    { filename: '208326121203-20841.jpg', ext: 'jpg', fullpath: '模拍原图/208326121203-已选/208326121203-20841.jpg' },
    { filename: '208326121203-20841-1.jpg', ext: 'jpg', fullpath: '平拍原图/208326121203/208326121203-20841-1.jpg' },
    { filename: '208326121203-208410.jpg', ext: 'jpg', fullpath: '平拍原图/208326121203/208326121203-208410.jpg' },
  ], { styleCode: '208326121203', limit: 5 })

  assert.deepEqual(plain(ranked.map(item => item.filename)), [
    '208326121203-20841-1.jpg',
    '208326121203-20841.jpg',
  ])
  assert.equal(ranked[0].skcCode, '208326121203-20841')
})

test('builds Tmall MTop payloads for 3:4 search image-test task flow', async () => {
  const helpers = await loadExports()
  const materials = helpers.buildThreeFourMaterialPayloads([
    'https://img.alicdn.com/imgextra/origin.jpg',
    'https://img.alicdn.com/imgextra/ai-01.jpg',
  ])

  assert.deepEqual(plain(materials), [
    { sourceType: 4, picUrl: 'https://img.alicdn.com/imgextra/origin.jpg', size: '3:4' },
    { sourceType: 4, picUrl: 'https://img.alicdn.com/imgextra/ai-01.jpg', size: '3:4' },
  ])

  assert.deepEqual(plain(helpers.buildCreateTaskPayload('1060862679580', ['common_search'])), {
    source: 'qn',
    itemId: '1060862679580',
    imageTestSources: '["COMMON_SEARCH"]',
  })
  assert.deepEqual(plain(helpers.buildBatchAddPayload('task-1', '1060862679580', materials, 'common_search')), {
    experimentTaskId: 'task-1',
    itemId: '1060862679580',
    source: 'common_search',
    materials: JSON.stringify(materials),
  })
  assert.deepEqual(plain(helpers.buildOnlinePayload('1060862679580', [
    { experimentTaskId: 'task-1', source: 'common_search' },
  ])), {
    source: 'qn',
    itemId: '1060862679580',
    taskStatusList: '[{"experimentTaskId":"task-1","source":"common_search"}]',
  })
})

test('documents Tmall picture-center upload endpoints for material-test selector', async () => {
  const helpers = await loadExports()

  assert.equal(
    helpers.buildMaterialSelectorUrl({ aspectRatio: '1:1', max: 5 }),
    'https://market.m.taobao.com/app/crs-qn/sucai-selector-ng/index?type=pic&mime=png%2Cjpg&needCrop=true&handleId=pic_space&picMaxSize=20MB&needClose=true&minWidth=undefined&bizScene=material_test&max=5&aspectRatio=1%3A1',
  )

  assert.deepEqual(plain(helpers.buildPictureCenterUploadPlan({ folderId: '0', originSize: false })), {
    mode: 'stream_upload',
    endpoint: 'https://stream-upload.taobao.com/api/upload.api',
    method: 'POST',
    query: {
      appkey: 'tu',
      folderId: '0',
      watermark: false,
      picCompress: true,
      _input_charset: 'utf-8',
    },
    multipartFields: ['file', '_tb_token_', 'name', 'water', 'ua(optional)'],
    responseMap: {
      fileId: 'object.fileId',
      folderId: 'object.folderId',
      fullUrl: 'object.url',
      pixel: 'object.pix',
      size: 'object.size',
      quality: 'object.quality',
    },
  })

  assert.deepEqual(plain(helpers.buildPictureCenterMultipartUploadPlan({
    fileName: '208326121203-测试图.jpg',
    fileSize: 25 * 1024 * 1024,
    sha256: '<sha256>',
    pixel: '1440x1920',
    dirId: '0',
  })), {
    mode: 'multipart_mtop',
    config: {
      api: 'mtop.taobao.mediacenter.pc.image.upload.config',
      data: { bizCode: 'tu' },
    },
    init: {
      api: 'mtop.taobao.mediacenter.pc.image.upload.init',
      data: {
        sha256: '<sha256>',
        bizCode: 'tu',
        fileSize: 26214400,
        fileName: '208326121203-测试图.jpg',
        dirId: '0',
        clientType: 1,
        pixel: '1440x1920',
        fileType: 'jpg',
      },
    },
    uploadPart: {
      method: 'PUT',
      contentType: 'application/octet-stream',
      urlSource: 'init.model.uploadUrlList[].url',
      etagSource: 'ETag response header',
    },
    complete: {
      api: 'mtop.taobao.mediacenter.pc.image.upload.complete',
      type: 'POST',
      data: {
        bizCode: 'tu',
        uploadId: '<uploadId>',
        clientType: '1',
        partList: '<JSON.stringify(partList.map(JSON.stringify))>',
      },
    },
    responseMap: {
      fileId: 'model.imageUploadDTO.fileId',
      fullUrl: 'model.imageUploadDTO.url',
      pixel: 'model.imageUploadDTO.pixel',
      quality: 'model.imageUploadDTO.quality',
    },
  })
})

test('blocks live picture upload helper unless explicitly enabled', async () => {
  const helpers = await loadExports()

  await assert.rejects(
    helpers.uploadDataUrlWithPageHelper('data:image/png;base64,AA==', 'probe.png'),
    /allow_live_upload=true.*stream-upload\.taobao\.com\/api\/upload\.api/,
  )
})

test('flattens material-test list rows and data-download rows for reporting', async () => {
  const helpers = await loadExports()
  const listRows = helpers.normalizeTmallTaskRows([
    {
      domainId: '1027696084846',
      head: { itemTitle: '女童帽子', itemStatusName: '出售中' },
      columns: {
        test_data: {
          dataList: [{
            imageTestSource: 'common_search',
            experimentTaskId: 'task-1027',
            testStatus: 1,
            testStartTime: 1782042672000,
            bestTestImage: { imageUrl: '//img.alicdn.com/best.jpg' },
            testImageMetrics: { '3:4': [{ imageId: 'm1', imageUrl: '//img.alicdn.com/a.jpg', percent: 10 }] },
          }],
        },
      },
    },
  ])

  assert.equal(listRows[0].商品ID, '1027696084846')
  assert.equal(listRows[0].测试渠道, '搜索测图')
  assert.equal(listRows[0].任务ID, 'task-1027')
  assert.equal(listRows[0].测试状态, '测试中')
  assert.equal(listRows[0].最优素材, 'https://img.alicdn.com/best.jpg')

  const reportRows = helpers.normalizeDownloadDataRows([
    {
      statisticDate: '2026-06-30',
      itemId: '1027696084846',
      imageType: '测试图',
      materialId: 'm1',
      materialRatio: '3:4',
      materialUrl: '//img.alicdn.com/a.jpg',
      searchExposure: 1000,
      searchClick: 56,
      detailExposure: 200,
      detailClick: 12,
      detailPayConversion: 3,
    },
  ], 'DAILY')

  assert.equal(reportRows[0].搜索点击率, '5.60%')
  assert.equal(reportRows[0].详情点击率, '6.00%')
  assert.equal(reportRows[0].详情支付转化率, '1.50%')
  assert.equal(reportRows[0].素材URL, 'https://img.alicdn.com/a.jpg')
})

test('registers readonly Tmall material-test data export task and builds its payloads', async () => {
  const manifest = fs.readFileSync(path.resolve('adapters/tmall-ops-assistant/manifest.yaml'), 'utf8')
  const helpers = await loadDataExportExports()

  assert.match(manifest, /id: tmall_material_test_data_export/)
  assert.match(manifest, /name: 巴拉-AI测图数据抓取导出/)
  assert.match(manifest, /filename: "巴拉-AI测图数据抓取导出_\{timestamp\}\.xlsx"/)
  assert.match(manifest, /script: tmall-material-test-data-export\.js/)
  assert.match(manifest, /entry_url: https:\/\/qn\.taobao\.com\/home\.htm\/material-center\/material-test\/common_test/)
  assert.match(manifest, /- https:\/\/qn\.taobao\.com\/home\.htm\/material-center\/material-test/)
  assert.match(manifest, /- https:\/\/myseller\.taobao\.com\/home\.htm\/material-center\/material-test/)
  assert.match(manifest, /id: capture_scope/)
  assert.match(manifest, /label: 抓取范围/)
  assert.match(manifest, /value: full\n\s+label: 全量抓取/)
  assert.match(manifest, /value: ids\n\s+label: 指定商品 ID/)
  assert.match(manifest, /value: file\n\s+label: 测图任务\/商品ID表格/)
  assert.match(manifest, /id: input_file[\s\S]*visible_when:\n\s+field: capture_scope\n\s+equals: file/)
  assert.match(manifest, /id: item_ids[\s\S]*visible_when:\n\s+field: capture_scope\n\s+equals: ids/)
  assert.match(manifest, /id: page_size[\s\S]*hidden: true/)
  assert.match(manifest, /sheet_key: __sheet_name/)
  assert.match(manifest, /name: 概览/)
  assert.match(manifest, /name: 明细/)
  assert.match(manifest, /value: "0"\n\s+label: 未测试/)

  const sourceRows = helpers.normalizeSourceRows({
    input_file: {
      rows: [{ 款号: '208326121203', 'ID（用于测图的ID）': '1060862679580', 任务ID: 'task-1' }],
    },
    item_ids: '1060862679580\n1060862679581',
  })
  assert.deepEqual(plain(sourceRows), [
    { 表格行号: 2, 款号: '208326121203', 商品ID: '1060862679580', 任务ID: 'task-1' },
    { 表格行号: '', 款号: '', 商品ID: '1060862679581', 任务ID: '' },
  ])

  assert.equal(helpers.resolveCaptureScope({ capture_scope: 'full', item_ids: '1060862679580' }), 'full')
  assert.deepEqual(plain(helpers.normalizeSourceRows({
    capture_scope: 'full',
    input_file: { rows: [{ 商品ID: '1060862679580' }] },
    item_ids: '1060862679581',
  })), [])
  assert.deepEqual(plain(helpers.normalizeSourceRows({
    capture_scope: 'ids',
    input_file: { rows: [{ 商品ID: '1060862679580' }] },
    item_ids: '1060862679581',
  })), [
    { 表格行号: '', 款号: '', 商品ID: '1060862679581', 任务ID: '' },
  ])
  assert.deepEqual(plain(helpers.normalizeSourceRows({
    capture_scope: 'file',
    input_file: { rows: [{ 款号: '208326121203', 商品ID: '1060862679580' }] },
    item_ids: '1060862679581',
  })), [
    { 表格行号: 2, 款号: '208326121203', 商品ID: '1060862679580', 任务ID: '' },
  ])

  assert.deepEqual(plain(helpers.buildSearchTasksPayload('1060862679580', { testStatus: '1' })), {
    modelCode: 'image_test_mgr',
    params: JSON.stringify({ tabCode: 'all', testChannel: 'common_search', testStatus: '1', itemIdOrName: '1060862679580' }),
    currentPage: 1,
    pageSize: 20,
  })
  assert.deepEqual(plain(helpers.buildSearchTasksPayload('', { testStatus: '1', pageSize: 50 })), {
    modelCode: 'image_test_mgr',
    params: JSON.stringify({ tabCode: 'all', testChannel: 'common_search', testStatus: '1' }),
    currentPage: 1,
    pageSize: 50,
  })
  assert.deepEqual(plain(helpers.buildSearchTasksPayload('1060862679580', { testStatus: '0' })), {
    modelCode: 'image_test_mgr',
    params: JSON.stringify({ tabCode: 'all', testChannel: 'common_search', testStatus: '0', itemIdOrName: '1060862679580' }),
    currentPage: 1,
    pageSize: 20,
  })
  const taskRows = helpers.normalizeTmallTaskRows([{
    domainId: '1060862679580',
    head: { itemTitle: '测试商品' },
    columns: {
      test_data: {
        dataList: [{
          imageTestSource: 'common_search',
          experimentTaskId: 'task-0',
          testStatus: 0,
          bestTestImage: { imageUrl: '//img.alicdn.com/best.jpg' },
          testImageMetrics: {
            '3:4': [{
              imageId: 'material-1',
              imageScale: '3:4',
              imageUrl: '//img.alicdn.com/material.jpg',
              percent: 13,
            }],
          },
        }],
      },
    },
  }], { 款号: '208326121203', 商品ID: '1060862679580' })
  assert.equal(taskRows[0].__sheet_name, '概览')
  assert.equal(taskRows[0].测试状态, '未测试')
  assert.equal(taskRows[0].测试渠道, '搜索测图')
  assert.equal(taskRows[0].测试素材数, 1)
  assert.equal(taskRows[0].__listMaterials[0].__sheet_name, '明细')
  assert.equal(taskRows[0].__listMaterials[0].记录类型, '任务列表素材')
  assert.equal(taskRows[0].__listMaterials[0].素材占比, '13')

  assert.deepEqual(plain(helpers.sourceRowsFromTaskRows([
    { 商品ID: '1060862679580', 商品标题: '测试商品', 任务ID: 'task-1', 测试状态: '测试中', 测试渠道: '搜索测图', 测试素材数: 5 },
    { 商品ID: '1060862679580', 商品标题: '测试商品', 任务ID: 'task-1' },
    { 商品ID: '1060862679581', 商品标题: '测试商品2', 任务ID: 'task-2' },
  ])), [
    { 表格行号: '', 款号: '', 商品ID: '1060862679580', 商品标题: '测试商品', 任务ID: 'task-1', 测试状态: '测试中', 测试渠道: '搜索测图', 测试素材数: 5, 素材URL: '', __listMaterials: [] },
    { 表格行号: '', 款号: '', 商品ID: '1060862679581', 商品标题: '测试商品2', 任务ID: 'task-2', 测试状态: '', 测试渠道: '', 测试素材数: '', 素材URL: '', __listMaterials: [] },
  ])
  const context = new Map([
    ['1060862679580', { 款号: '208326121203', 商品标题: '测试商品', 任务ID: 'task-1', 测试状态: '测试中', 测试渠道: '搜索测图', 测试素材数: 5 }],
  ])
  const detailRows = helpers.normalizeDownloadDataRows([{
    itemId: '1060862679580',
    statisticDate: '20260630',
    materialId: 'material-1',
    materialRatio: '3:4',
    materialUrl: '//img.alicdn.com/material.jpg',
    searchExposure: 200,
    searchClick: 8,
  }], 'ACCUMULATE_30_DAYS', context)
  assert.equal(detailRows[0].__sheet_name, '明细')
  assert.equal(detailRows[0].记录类型, '数据明细')
  assert.equal(detailRows[0].测试状态, '测试中')
  assert.equal(detailRows[0].测试渠道, '搜索测图')

  const fallbackRows = []
  helpers.addNoDetailFallbackRows(fallbackRows, helpers.sourceRowsFromTaskRows(taskRows), new Set())
  assert.equal(fallbackRows[0].__sheet_name, '明细')
  assert.equal(fallbackRows[0].执行结果, '任务列表素材')
  assert.equal(fallbackRows[0].商品ID, '1060862679580')

  assert.deepEqual(plain(helpers.filterTaskRowsForExport([
    { 商品ID: '1060862679580', 测试渠道: '搜索测图', 测试状态: '测试中' },
    { 商品ID: '1060862679580', 测试渠道: 'common_detail', 测试状态: '已暂停' },
  ], { testStatus: '1', testChannel: 'common_search' })), [
    { 商品ID: '1060862679580', 测试渠道: '搜索测图', 测试状态: '测试中' },
  ])
  assert.deepEqual(plain(helpers.chunkArray(['1', '2', '3', '4', '5'], 2)), [
    ['1', '2'],
    ['3', '4'],
    ['5'],
  ])
  assert.deepEqual(plain(helpers.extractDownloadRows({ result: { dataList: [{ itemId: '1060862679580' }] } })), [
    { itemId: '1060862679580' },
  ])
  assert.deepEqual(plain(helpers.buildDownloadDataPayload(['1060862679580'], 'DAILY', '20260601', '20260630')), {
    startDate: '20260601',
    endDate: '20260630',
    itemIds: '["1060862679580"]',
    statisticType: 'DAILY',
  })
})

test('material-test data export supports the current QianNiu material-test URL', async () => {
  const helpers = await loadDataExportExports('https://qn.taobao.com/home.htm/material-center/material-test/common_test?testStatus=1&testChannel=common_search')

  assert.equal(helpers.currentHref(), 'https://qn.taobao.com/home.htm/material-center/material-test/common_test?testStatus=1&testChannel=common_search')
  assert.equal(helpers.isTmallMaterialPage(), true)
})
