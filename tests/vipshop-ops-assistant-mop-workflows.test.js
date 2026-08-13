import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  }
}

async function loadExports(scriptName, options = {}) {
  const scriptPath = path.resolve('adapters/vipshop-ops-assistant', scriptName)
  const source = fs.readFileSync(scriptPath, 'utf8')
  const exportsBox = {}
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: options.params || {},
      __CRAWSHRIMP_PHASE__: '__exports__',
      __CRAWSHRIMP_SHARED__: {},
      __CRAWSHRIMP_EXPORTS__: exportsBox,
    },
    document: options.document || { body: { innerText: '', textContent: '' } },
    location: { href: options.href || 'https://nov-admin.vip.com/admin/index.html#/normal/normalMerchandise' },
    fetch: options.fetch || (async () => {
      throw new Error('fetch should not run in helper export tests')
    }),
    URL,
    Blob: globalThis.Blob,
    FormData: globalThis.FormData,
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
    encodeURIComponent,
  }
  context.globalThis = context
  await vm.runInNewContext(source, context, { filename: scriptPath })
  return exportsBox
}

async function runScript(scriptName, options = {}) {
  const scriptPath = path.resolve('adapters/vipshop-ops-assistant', scriptName)
  const source = fs.readFileSync(scriptPath, 'utf8')
  const documentBase = {
    body: {
      innerText: options.bodyText || '',
      textContent: options.bodyText || '',
      appendChild() {},
    },
    querySelectorAll: () => [],
  }
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: options.params || {},
      __CRAWSHRIMP_PHASE__: options.phase || 'main',
      __CRAWSHRIMP_SHARED__: options.shared || {},
      __CRAWSHRIMP_EXPORTS__: null,
    },
    document: options.document || documentBase,
    location: { href: options.href || 'https://nov-admin.vip.com/admin/index.html#/normal/normalMerchandise' },
    fetch: options.fetch,
    URL,
    Blob: globalThis.Blob,
    FormData: globalThis.FormData,
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
    encodeURIComponent,
  }
  context.globalThis = context
  return vm.runInNewContext(source, context, { filename: scriptPath })
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

async function runVipshopAuthCheck(options = {}) {
  const scriptPath = path.resolve('adapters/vipshop-ops-assistant/auth_check.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const context = {
    location: {
      href: options.href || 'https://nov-admin.vip.com/admin/index.html#/normal/normalMerchandise',
      hostname: options.hostname || 'nov-admin.vip.com',
    },
    document: {
      body: {
        innerText: options.bodyText || '运营专场管理后台',
      },
    },
  }
  context.window = context
  context.globalThis = context
  return vm.runInNewContext(source, context, { filename: scriptPath })
}

test('Vipshop auth check accepts logged-in nov-admin operations console', async () => {
  const result = await runVipshopAuthCheck()

  assert.equal(result.meta.logged_in, true)
  assert.equal(result.data[0].href, 'https://nov-admin.vip.com/admin/index.html#/normal/normalMerchandise')
})

test('MOP online status statistics computes online/offline counts and ratios', async () => {
  const helpers = await loadExports('MOP-vipshop-online-status-statistics.js')
  const rows = [
    { 商品状态: '上架中' },
    { 商品状态: '部分上架' },
    { 商品状态: '已下架' },
    { 商品状态: '审核驳回/可编辑' },
    { 商品状态: '未知' },
  ]

  const counts = helpers.countStatus(rows)
  const previous = helpers.parsePreviousCounts({
    previous_file: {
      rows: [
        { 商品状态: '在售' },
        { 商品状态: '下线' },
      ],
    },
  })
  const summary = helpers.buildSummaryRows(counts, previous, { pages: 2 })[0]
  const resultRows = helpers.buildResultRows(
    [{ __sheet_name: '商品状态明细', 商品ID: '1', 商品状态: '上架中' }],
    [summary],
  )
  const numericCounts = helpers.countStatus([
    { skuStatus: 0 },
    { skuStatus: 1 },
    { skuStatus: 2 },
  ])

  assert.deepEqual(plain(counts), { total: 5, online: 2, offline: 2, other: 1 })
  assert.deepEqual(plain(numericCounts), { total: 3, online: 2, offline: 1, other: 0 })
  assert.equal(previous.online, 1)
  assert.equal(previous.offline, 1)
  assert.equal(helpers.formatRatio(2, 1), '100.00%')
  assert.equal(summary.上线数量环比, '100.00%')
  assert.match(summary.__notify_body, /本次商品上线数量：2/)
  assert.equal(resultRows[0].__sheet_name, '商品状态明细')
  assert.equal(resultRows.at(-1).__sheet_name, '执行摘要')
})

test('MOP info-table workflow builds CSV download item and validates Semir target path', async () => {
  const helpers = await loadExports('MOP-vipshop-info-table-download-upload.js')
  const row = helpers.normalizeInfoRow({
    merchandiseNo: '6922036534956567941',
    osn: '201326108015',
    msn: '20132610801500311',
    name: '柔软百搭婴幼宝宝儿童长裤女童',
    marketPrice: '199',
    vipshopPrice: '129',
    skuStatus: 1,
  })
  const item = helpers.buildDownloadItem([row], {
    output_filename: '唯品商品信息表8-12月',
    local_download_dir: '/tmp/mop',
  }, '20260812_120000')

  assert.equal(row.商品状态, '上架中')
  assert.equal(item.filename, '唯品商品信息表8-12月.csv')
  assert.equal(item.target_relative_path, '唯品商品信息表8-12月.csv')
  assert.match(decodeURIComponent(item.url), /商品ID,款号,货号/)
  assert.equal(
    helpers.normalizeCloudPath('品牌电商项目部//MOP品牌/4.运营/02-唯品/历史资料/'),
    '品牌电商项目部/MOP品牌/4.运营/02-唯品/历史资料/',
  )
  assert.equal(
    helpers.buildSemirFolderUrl({
      mountId: 'm1',
      relativePath: 'MOP品牌/4.运营/02-唯品',
    }),
    'https://fmp.semirapp.com/web/index#/home/file/mount/m1?path=MOP%E5%93%81%E7%89%8C%2F4.%E8%BF%90%E8%90%A5%2F02-%E5%94%AF%E5%93%81',
  )
  assert.equal(helpers.currentSemirDirectoryLooksLikeTarget({
    fullPath: '品牌电商项目部//MOP品牌/4.运营/02-唯品/历史资料/唯品每日商品货表汇总/2026/8月-12月/',
  }), false)
  assert.equal(
    helpers.semirRelativeFilePath({
      relativePath: 'MOP品牌/4.运营/02-唯品',
    }, '唯品商品信息表8-12月.csv'),
    'MOP品牌/4.运营/02-唯品/唯品商品信息表8-12月.csv',
  )
  const uploadMeta = helpers.buildSemirUploadMeta({
    mountId: 'm1',
    relativePath: 'MOP品牌/4.运营/02-唯品',
  }, 'dummy-token', '唯品商品信息表8-12月.csv', { semir_chunk_size: 1024 }, true)
  const formData = helpers.buildSemirUploadFormData(uploadMeta, new Blob(['hello']), '唯品商品信息表8-12月.csv')
  assert.equal(uploadMeta.filefield, 'file')
  assert.equal(uploadMeta.mount_id, 'm1')
  assert.equal(uploadMeta.path, 'MOP品牌/4.运营/02-唯品')
  assert.equal(uploadMeta.token, 'dummy-token')
  assert.equal(uploadMeta.overwrite, '0')
  assert.equal(formData.get('mount_id'), 'm1')
  assert.equal(formData.get('path'), 'MOP品牌/4.运营/02-唯品')
  assert.ok(formData.get('file'))

  const exportsWithFetch = await loadExports('MOP-vipshop-info-table-download-upload.js', {
    document: { body: { innerText: '品牌电商项目部 MOP品牌 2026 8月-12月 上传', textContent: '' } },
    fetch: async url => {
      assert.equal(String(url), '/fengcloud/1/account/mount')
      return jsonResponse([{ mount_id: 'm1', org_name: '品牌电商项目部' }])
    },
  })
  const target = await exportsWithFetch.resolveSemirTarget('品牌电商项目部//MOP品牌/4.运营/02-唯品/')
  assert.equal(target.mountId, 'm1')
  assert.equal(target.relativePath, 'MOP品牌/4.运营/02-唯品')
  assert.equal(exportsWithFetch.currentSemirDirectoryLooksLikeTarget({
    fullPath: '品牌电商项目部//MOP品牌/4.运营/02-唯品/历史资料/唯品每日商品货表汇总/2026/8月-12月/',
  }), true)
})

test('MOP info-table main phase returns a data-url download action before web upload', async () => {
  const calls = []
  const result = await runScript('MOP-vipshop-info-table-download-upload.js', {
    params: { output_filename: 'mop-info', page_size: 20 },
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), body: options.body })
      return jsonResponse({
        code: '200',
        data: [{
          merchandiseNo: '1',
          osn: '201326108015',
          msn: '20132610801500311',
          name: '商品',
          skuStatus: 1,
        }],
        total: 1,
      })
    },
  })

  assert.equal(result.meta.action, 'download_urls')
  assert.equal(result.meta.items[0].filename, 'mop-info.csv')
  assert.equal(result.meta.next_phase, 'open_semir_cloud')
  assert.equal(result.meta.shared.total_rows, 1)
  assert.deepEqual(JSON.parse(calls[0].body), { pageNo: 1, pageSize: 20, param: {} })
})

test('MOP Vipshop query payload uses current page field names for style and goods filters', async () => {
  const online = await loadExports('MOP-vipshop-online-status-statistics.js')
  const info = await loadExports('MOP-vipshop-info-table-download-upload.js')
  const newArrival = await loadExports('MOP-vipshop-new-arrival-material-check.js')

  assert.deepEqual(plain(online.buildMerchandiseQueryPayload(1, 20, {
    style_codes: '201326108015',
    goods_codes: '20132610801500311',
  })), {
    pageNo: 1,
    pageSize: 20,
    param: { msnSet: ['20132610801500311'], osn: ['201326108015'] },
  })
  assert.deepEqual(plain(info.buildMerchandiseQueryPayload(1, 20, {
    style_codes: '201326108015',
  })), {
    pageNo: 1,
    pageSize: 20,
    param: { osn: ['201326108015'] },
  })
  assert.deepEqual(plain(newArrival.buildMerchandiseQueryPayloadForJobs([
    { styleCode: '201326108015', goodsCode: '' },
  ], 1, 20)), {
    pageNo: 1,
    pageSize: 20,
    param: { osn: ['201326108015'] },
  })
})

test('MOP info-table web upload waits unless Semir target directory is visible, then uploads via Semir API', async () => {
  const uploadButton = {
    innerText: '上传',
    textContent: '上传',
    getAttribute: () => '',
    getClientRects: () => [{ width: 80, height: 32 }],
    getBoundingClientRect: () => ({ left: 20, top: 40, width: 80, height: 32 }),
  }
  const documentWithUpload = bodyText => ({
    body: { innerText: bodyText, textContent: bodyText },
    querySelectorAll: () => [uploadButton],
  })
  const shared = {
    total_rows: 1,
    info_filename: '唯品商品信息表8-12月.csv',
    semir_cloud_path: '品牌电商项目部/MOP品牌/4.运营/02-唯品/历史资料/唯品每日商品货表汇总/2026/8月-12月/',
    semir_target: {
      mountId: 'm1',
      relativePath: 'MOP品牌/4.运营/02-唯品/历史资料/唯品每日商品货表汇总/2026/8月-12月',
      fullPath: '品牌电商项目部/MOP品牌/4.运营/02-唯品/历史资料/唯品每日商品货表汇总/2026/8月-12月/',
    },
    info_rows: [{ 商品ID: '1', 款号: '10E6622140121', 货号: '10E6622140121-2001', 商品名称: '商品' }],
    download_result: { items: [{ success: true, path: '/tmp/唯品商品信息表8-12月.csv', filename: '唯品商品信息表8-12月.csv' }] },
  }

  const blocked = await runScript('MOP-vipshop-info-table-download-upload.js', {
    phase: 'prepare_web_upload',
    shared,
    href: 'https://fmp.semirapp.com/web/index#/home/file',
    document: documentWithUpload('品牌电商项目部 2026 历史资料 上传'),
  })
  assert.equal(blocked.meta.action, 'next_phase')
  assert.equal(blocked.meta.next_phase, 'prepare_web_upload')
  assert.equal(blocked.meta.shared.semir_directory_wait_attempts, 1)

  const exhausted = await runScript('MOP-vipshop-info-table-download-upload.js', {
    phase: 'prepare_web_upload',
    shared: { ...shared, semir_directory_wait_attempts: 8 },
    href: 'https://fmp.semirapp.com/web/index#/home/file',
    document: documentWithUpload('品牌电商项目部 2026 历史资料 上传'),
  })
  assert.equal(exhausted.meta.action, 'complete')
  assert.equal(exhausted.data[0].网页上传状态, '等待打开目标目录')
  assert.match(exhausted.data[0].备注, /避免传错目录/)

  const calls = []
  const ready = await runScript('MOP-vipshop-info-table-download-upload.js', {
    phase: 'prepare_web_upload',
    shared,
    href: 'https://fmp.semirapp.com/web/index#/home/file',
    document: documentWithUpload('品牌电商项目部 唯品每日商品货表汇总 2026 8月-12月 上传'),
    fetch: async (url, options = {}) => {
      calls.push(String(url))
      if (String(url).startsWith('/web/get_upload')) {
        return jsonResponse({ uploadUrl: 'https://upload.example/web_upload', chunked: false })
      }
      if (String(url) === '/fengcloud/1/account/info') {
        return jsonResponse({ token: 'dummy-token' })
      }
      if (String(url).startsWith('/fengcloud/2/file/exist')) {
        return jsonResponse({ error_code: 40402, error_msg: '文件(夹)不存在或已删除' }, 404)
      }
      if (String(url) === 'https://upload.example/web_upload') {
        assert.equal(options.method, 'POST')
        assert.equal(options.body.get('mount_id'), 'm1')
        assert.equal(options.body.get('path'), 'MOP品牌/4.运营/02-唯品/历史资料/唯品每日商品货表汇总/2026/8月-12月')
        assert.equal(options.body.get('token'), 'dummy-token')
        assert.equal(options.body.get('overwrite'), '0')
        assert.ok(options.body.get('file'))
        return jsonResponse({
          hash: 'hash1',
          filesize: 96,
          fullpath: 'MOP品牌/4.运营/02-唯品/历史资料/唯品每日商品货表汇总/2026/8月-12月/唯品商品信息表8-12月.csv',
          filehash: 'filehash1',
        })
      }
      if (String(url).startsWith('/fengcloud/1/file/ls')) {
        return jsonResponse({ list: [{ filename: '唯品商品信息表8-12月.csv' }] })
      }
      throw new Error(`unexpected fetch ${url}`)
    },
  })
  assert.equal(ready.meta.action, 'complete')
  assert.equal(ready.data[0].网页上传状态, '网页 API 上传完成接口读回')
  assert.match(ready.data[0].备注, /上传字节数/)
  assert.ok(calls.includes('https://upload.example/web_upload'))
})

test('MOP info-table API upload accepts exact Semir folder hash route as directory proof', async () => {
  const shared = {
    total_rows: 1,
    info_filename: '唯品商品信息表8-12月.csv',
    semir_cloud_path: '品牌电商项目部/MOP品牌/4.运营/02-唯品/历史资料/',
    semir_target: {
      mountId: 'm1',
      relativePath: 'MOP品牌/4.运营/02-唯品/历史资料',
      fullPath: '品牌电商项目部/MOP品牌/4.运营/02-唯品/历史资料/',
    },
    info_rows: [{ 商品ID: '1', 款号: '10E6622140121', 货号: '10E6622140121-2001', 商品名称: '商品' }],
    download_result: { items: [{ success: true, path: '/tmp/唯品商品信息表8-12月.csv', filename: '唯品商品信息表8-12月.csv' }] },
  }

  const ready = await runScript('MOP-vipshop-info-table-download-upload.js', {
    phase: 'prepare_web_upload',
    shared,
    href: 'https://fmp.semirapp.com/web/index#/home/file/mount/m1?path=MOP%E5%93%81%E7%89%8C%2F4.%E8%BF%90%E8%90%A5%2F02-%E5%94%AF%E5%93%81%2F%E5%8E%86%E5%8F%B2%E8%B5%84%E6%96%99',
    document: { body: { innerText: '上传', textContent: '上传' }, querySelectorAll: () => [] },
    fetch: async (url, options = {}) => {
      if (String(url).startsWith('/web/get_upload')) return jsonResponse({ uploadUrl: 'https://upload.example/web_upload', chunked: false })
      if (String(url) === '/fengcloud/1/account/info') return jsonResponse({ token: 'dummy-token' })
      if (String(url).startsWith('/fengcloud/2/file/exist')) return jsonResponse({ error_code: 40402 }, 404)
      if (String(url) === 'https://upload.example/web_upload') {
        assert.equal(options.body.get('path'), 'MOP品牌/4.运营/02-唯品/历史资料')
        return jsonResponse({ fullpath: 'MOP品牌/4.运营/02-唯品/历史资料/唯品商品信息表8-12月.csv' })
      }
      if (String(url).startsWith('/fengcloud/1/file/ls')) return jsonResponse({ list: [{ filename: '唯品商品信息表8-12月.csv' }] })
      throw new Error(`unexpected fetch ${url}`)
    },
  })

  assert.equal(ready.meta.action, 'complete')
  assert.equal(ready.data[0].网页上传状态, '网页 API 上传完成接口读回')
})

test('MOP info-table resolves Semir target by navigating directly to folder route', async () => {
  const result = await runScript('MOP-vipshop-info-table-download-upload.js', {
    phase: 'resolve_semir_target',
    shared: {
      semir_cloud_path: '品牌电商项目部/MOP品牌/4.运营/02-唯品/历史资料/',
    },
    href: 'https://fmp.semirapp.com/web/index#/home/file',
    fetch: async url => {
      assert.equal(String(url), '/fengcloud/1/account/mount')
      return jsonResponse([{ mount_id: 'm1', org_name: '品牌电商项目部' }])
    },
  })

  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'prepare_web_upload')
  assert.equal(
    result.meta.shared.semir_target.relativePath,
    'MOP品牌/4.运营/02-唯品/历史资料',
  )
})

test('MOP info-table upload verification reads back Semir folder API', async () => {
  const result = await runScript('MOP-vipshop-info-table-download-upload.js', {
    phase: 'verify_web_upload',
    shared: {
      total_rows: 1,
      downloaded_filename: '唯品商品信息表8-12月.csv',
      downloaded_path: '/tmp/唯品商品信息表8-12月.csv',
      semir_cloud_path: '品牌电商项目部/MOP品牌/4.运营/02-唯品/历史资料/',
      semir_target: {
        mountId: 'm1',
        relativePath: 'MOP品牌/4.运营/02-唯品/历史资料',
      },
      upload_result: { items: [{ success: true }] },
    },
    href: 'https://fmp.semirapp.com/web/index#/home/file/mount/m1',
    document: { body: { innerText: '', textContent: '' }, querySelectorAll: () => [] },
    fetch: async url => {
      assert.match(String(url), /\/fengcloud\/1\/file\/ls/)
      return jsonResponse({ list: [{ filename: '唯品商品信息表8-12月.csv' }] })
    },
  })

  assert.equal(result.meta.action, 'complete')
  assert.equal(result.data[0].网页上传状态, '网页上传完成接口读回')
  assert.match(result.data[0].备注, /目录接口已读回/)
})

test('MOP new-arrival helpers detect price, forbidden and image-ratio issues', async () => {
  const helpers = await loadExports('MOP-vipshop-new-arrival-material-check.js')
  const parsed = helpers.parseJobs({
    input_file: {
      rows: [
        { __row_number: 2, 款号: '201326108015', 货号: '20132610801500311', 吊牌价: '199' },
        { __row_number: 3, 款号: '201326108015', 货号: '20132610801500311', 吊牌价: '199' },
        { __row_number: 3, 款号: '201326108015', 货号: '20132610801500311', 吊牌价: '199' },
        { __row_number: 4, 款号: '653514A6602Z', '市场价/吊牌价': '890' },
      ],
    },
  })
  const price = helpers.priceIssue(parsed.jobs[0], { marketPrice: '189' })
  const forbidden = helpers.forbiddenIssue({ skuStatusName: '不可售' }, {}, { forbidden_keywords: '不可售 禁售' })
  const main = helpers.mainImageIssue({
    squareImages: [{ imageIndex: 1, imageUrl: 'main', imageSize: '1200x900' }],
  })
  const list = helpers.listImageIssue({
    listImages: [{ imageIndex: 50, imageUrl: 'list', imageSize: '1200x950' }],
  })

  assert.equal(parsed.jobs.length, 2)
  assert.equal(parsed.jobs[1].expectedPrice, 890)
  assert.equal(parsed.invalidRows.length, 0)
  assert.match(price, /市场价与运营表吊牌价不一致/)
  assert.match(forbidden, /疑似涉及禁售/)
  assert.equal(main, '商品展示图不是方图：1200x900')
  assert.equal(list, '商品列表图不是长图：1200x950')
})

test('MOP new-arrival notification body lists concrete issue styles and reasons', async () => {
  const helpers = await loadExports('MOP-vipshop-new-arrival-material-check.js')
  const priceReason = '市场价与运营表吊牌价不一致：唯品569.00，表格999.00'
  const rows = [
    helpers.buildCheckRow(
      { rowNo: 2, styleCode: '10E6622140121', goodsCode: '10E6622140121-2001', expectedPrice: 999 },
      { marketPrice: '569', vendorSpuId: '99719292612243456' },
      {},
      '图片规格检查/浅灰2001',
      '有问题',
      priceReason,
      { colourGSN: '10E6622140121-2001', colourName: '浅灰2001' },
    ),
    helpers.buildCheckRow(
      { rowNo: 2, styleCode: '10E6622140121', goodsCode: '10E6622140121-2001', expectedPrice: 999 },
      { marketPrice: '569', vendorSpuId: '99719292612243456' },
      {},
      '图片规格检查/白咖色调0115',
      '有问题',
      priceReason,
      { colourGSN: '10E6622140121-0115', colourName: '白咖色调0115' },
    ),
    helpers.buildCheckRow(
      { rowNo: 3, styleCode: 'MOPTESTSTYLE999999', goodsCode: 'MOPTESTGOODS999999-0001', expectedPrice: 88 },
      null,
      null,
      '商品资料查询',
      '失败',
      '唯品商品资料未命中',
    ),
  ]
  const summary = helpers.summarizeRows(rows, {
    totalRows: 3,
    jobs: [{}, {}, {}],
  })
  const body = summary.__notify_body

  assert.match(body, /问题明细/)
  assert.match(body, /第2行 10E6622140121\/10E6622140121-2001：市场价与运营表吊牌价不一致：唯品569\.00，表格999\.00/)
  assert.match(body, /第3行 MOPTESTSTYLE999999\/MOPTESTGOODS999999-0001：唯品商品资料未命中/)
  assert.equal((body.match(/市场价与运营表吊牌价不一致/g) || []).length, 1)
})

test('MOP new-arrival main phase queries Vipshop and PDC then summarizes issues', async () => {
  const result = await runScript('MOP-vipshop-new-arrival-material-check.js', {
    params: {
      input_file: {
        rows: [{ 款号: '201326108015', 货号: '20132610801500311', 吊牌价: '199' }],
      },
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/normal/normalMerchandiseQuery')) {
        assert.deepEqual(JSON.parse(options.body).param.msnSet, ['20132610801500311'])
        return jsonResponse({
          code: '200',
          data: [{
            merchandiseNo: '6922036534956567941',
            name: '柔软百搭婴幼宝宝儿童长裤女童',
            msn: '20132610801500311',
            osn: '201326108015',
            vendorSpuId: '1469658525260218368',
            marketPrice: '189',
            skuStatus: 1,
          }],
          total: 1,
        })
      }
      if (String(url).includes('/product/queryVendorProductByVpIdForVc')) {
        assert.match(options.body, /vendorProductId=1469658525260218368/)
        return jsonResponse({
          code: '200',
          result: {
            vendorProductId: '1469658525260218368',
            sn: '201326108015',
            title: '柔软百搭婴幼宝宝儿童长裤女童',
            status: '12',
            itemSkuAttr: [{
              colourGSN: '20132610801500311',
              colourName: '白色调',
              squareImages: [{ imageIndex: 1, imageUrl: 'main', imageSize: '1200x900' }],
              listImages: [{ imageIndex: 50, imageUrl: 'list', imageSize: '950x1200' }],
            }],
          },
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.data[0].__sheet_name, '上新资料检查明细')
  assert.match(result.data[0].问题说明, /市场价与运营表吊牌价不一致/)
  assert.match(result.data[0].问题说明, /商品展示图不是方图/)
  assert.equal(result.data.at(-1).__sheet_name, '执行摘要')
  assert.equal(result.data.at(-1).问题行数, 1)
  assert.match(result.data.at(-1).__notify_body, /第2行 201326108015\/20132610801500311：市场价与运营表吊牌价不一致/)
})
