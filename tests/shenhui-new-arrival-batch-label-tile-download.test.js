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
      __CRAWSHRIMP_SHARED__: options.shared || {},
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

async function runPhase(phase, shared = {}, fetchImpl = async () => jsonResponse({}), options = {}) {
  const context = {
    window: { __CRAWSHRIMP_PHASE__: phase, __CRAWSHRIMP_SHARED__: shared, __CRAWSHRIMP_PARAMS__: options.params || {} },
    location: { href: options.href || 'https://fmp.semirapp.com/web/index#/home/file', hash: '#/home/file' },
    document: {}, fetch: fetchImpl, URLSearchParams, navigator: { userAgent: 'test' },
    console, setTimeout, clearTimeout,
  }
  return vm.runInNewContext(fs.readFileSync(SCRIPT_PATH, 'utf8'), context, { filename: SCRIPT_PATH })
}

const expiredResponse = () => ({ ok: false, status: 401, text: async () => '{"error_code":40106,"error_msg":"登录超时"}' })

test('real incident whitespace pairs receive unique paths including Windows case and earlier batches', async () => {
  const helpers = await loadExports({
    shared: { result_rows: [{ __runtime_filename: '208127104005__hang_tag__still__IMG_9828 拷贝.jpg' }] },
    fetch: async () => jsonResponse({ uri: 'https://example.test/image' }),
  })
  const rows = [], downloads = []
  const names = [9828, 9829, 9830, 9831, 9833, 9835].flatMap(n => [`IMG_${n}  拷贝.jpg`, `IMG_${n} 拷贝.jpg`])
  names.push('img_9828 拷贝.JPG', 'IMG_9828 拷贝_2.jpg')
  await helpers.addDownloadRows('208127104005', { still: { mountId: '1' } }, rows, downloads, 'hang_tag',
    names.map(filename => ({ filename, fullpath: `folder/${filename}`, __source_type: 'still' })))
  assert.equal(downloads.length, names.length)
  assert.equal(new Set(downloads.map(item => item.filename.toLowerCase())).size, names.length)
  assert.ok(downloads.every(item => item.filename.toLowerCase() !== '208127104005__hang_tag__still__img_9828 拷贝.jpg'))
  assert.deepEqual(Array.from(rows, row => row.__runtime_filename), Array.from(downloads, item => item.filename))
})

test('single file link failure is recorded and remaining files still download', async () => {
  let calls = 0
  const helpers = await loadExports({ fetch: async () => {
    calls += 1
    if (calls === 2) return { ok: false, status: 500, text: async () => 'file unavailable' }
    return jsonResponse({ uri: 'https://example.test/image' })
  } })
  const rows = [], downloads = []
  await helpers.addDownloadRows('123', { still: { mountId: '1' } }, rows, downloads, 'hang_tag',
    ['one.jpg', 'bad.jpg', 'three.jpg'].map(filename => ({ filename, fullpath: filename, __source_type: 'still' })))
  assert.equal(calls, 3)
  assert.equal(downloads.length, 2)
  assert.equal(rows[1]['下载结果'], '获取下载链接失败')
  const final = helpers.finalizeRows(rows, { items: [
    { success: false, error: 'HTTP 404' }, { success: true, path: '/three.jpg' },
  ] })
  assert.deepEqual(Array.from(final, row => row['下载结果']), ['下载失败', '获取下载链接失败', '已下载'])
  assert.equal(final[2]['本地文件'], '/three.jpg')
})

test('auth errors escape file and folder catches instead of marking assets missing', async () => {
  const helpers = await loadExports({ fetch: async () => expiredResponse() })
  await assert.rejects(helpers.listFolderItems('1', 'folder'), { code: 'CLOUD_AUTH_EXPIRED' })
  await assert.rejects(helpers.addDownloadRows('123', { still: { mountId: '1' } }, [], [], 'hang_tag',
    [{ filename: 'one.jpg', fullpath: 'one.jpg', __source_type: 'still' }]), { code: 'CLOUD_AUTH_EXPIRED' })
})

test('API auth payload and login redirect are recognized', async () => {
  for (const response of [jsonResponse({ error_code: 40106 }), jsonResponse({ error_code: 401060 }),
    { ok: true, redirected: true, url: 'https://sso.example/login' },
    { ok: true, headers: { get: () => 'text/html' } }]) {
    const helpers = await loadExports({ fetch: async () => response })
    await assert.rejects(helpers.fetchJson('/fengcloud/1/account/mount'), { code: 'CLOUD_AUTH_EXPIRED' })
  }
})

test('expired session preserves completed rows and resumes the interrupted phase after login', async () => {
  const prior = { '输入款号': 'first', '下载结果': '已下载', '本地文件': '/first.jpg' }
  const shared = { target_codes: ['first', 'second'], code_index: 1, current_code: 'second',
    result_rows: [prior], source_configs: { still: { mountId: '1' } }, download_completed_files: 1 }
  const expired = await runPhase('collect_code', shared, async () => expiredResponse())
  assert.equal(expired.meta.action, 'reload_page')
  assert.equal(expired.meta.next_phase, 'wait_cloud_login')
  assert.equal(expired.meta.shared.code_index, 1)
  assert.deepEqual(expired.meta.shared.result_rows, [prior])
  const waiting = await runPhase('wait_cloud_login', expired.meta.shared, async () => { throw Error('must not fetch SSO') }, { href: 'https://sso.example/login' })
  assert.equal(waiting.meta.next_phase, 'wait_cloud_login')
  const resumed = await runPhase('wait_cloud_login', waiting.meta.shared, async () => jsonResponse([{ mount_id: '1' }]))
  assert.equal(resumed.meta.next_phase, 'collect_code')
  assert.equal(resumed.meta.shared.download_completed_files, 1)
  assert.deepEqual(resumed.meta.shared.result_rows, [prior])
  const timedOut = await runPhase('wait_cloud_login', { ...expired.meta.shared, auth_wait_started_at: Date.now() - 600001 })
  assert.equal(timedOut.meta.action, 'complete')
  assert.equal(timedOut.data.length, 2)
  assert.equal(timedOut.data[0], prior)
  assert.equal(timedOut.data[1]['下载结果'], '登录中断，未完成')
})

test('repeated auth rejection is bounded and a failed style does not stop the next style', async () => {
  const shared = { target_codes: ['bad', 'next'], code_index: 0, current_code: 'bad', result_rows: [],
    source_configs: { still: { mountId: '1' } } }
  const rejected = await runPhase('collect_code', { ...shared, auth_recovery_attempts: 2 }, async () => expiredResponse())
  assert.equal(rejected.meta.action, 'complete')
  assert.equal(rejected.data.length, 2)
  const failed = await runPhase('collect_code', shared, async () => { throw Error('search network failed') })
  assert.equal(failed.meta.next_phase, 'plan_code')
  assert.equal(failed.meta.shared.code_index, 1)
  assert.equal(failed.meta.shared.result_rows[0]['下载结果'], '处理失败，已跳过')
  const next = await runPhase('plan_code', failed.meta.shared)
  assert.equal(next.meta.shared.current_code, 'next')
})

test('failed image download preserves successes and advances to next code', async () => {
  const result = await runPhase('finalize_code_download', {
    target_codes: ['one', 'two'], code_index: 0, current_code: 'one', result_rows: [],
    pending_code_rows: [{ '文件名': 'bad.jpg' }, { '文件名': 'good.jpg' }],
    last_code_download_result: { items: [{ success: false, error: '404' }, { success: true, path: '/good.jpg' }] },
  })
  assert.equal(result.meta.next_phase, 'plan_code')
  assert.equal(result.meta.shared.code_index, 1)
  assert.equal(result.meta.shared.download_failed_files, 1)
  assert.equal(result.meta.shared.download_success_files, 1)
  assert.equal(result.meta.shared.result_rows[1]['本地文件'], '/good.jpg')
})

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

test('isShoeCodePlan classifies each code from matched item paths instead of global source scope', async () => {
  const helpers = await loadExports()
  const apparelItems = [
    {
      dir: '0',
      ext: 'jpg',
      filename: '202426107128-20047.jpg',
      fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉冬/平拍原图/全域/7p/中童-已写/202426107128-已写/202426107128-20047.jpg',
    },
    {
      dir: '0',
      ext: 'jpg',
      filename: 'yq1.jpg',
      fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉冬/平拍原图/全域/7p/中童-已写/202426107128-已写/yq1.jpg',
    },
  ]
  const shoeItems = [
    {
      dir: '0',
      ext: 'jpg',
      filename: '204426140121-00414.jpg',
      fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉冬/平拍原图/全域/7p/鞋品/204426140121-已写/00414/36/204426140121-00414.jpg',
    },
  ]
  const shoeScopedSourceConfigs = {
    still: {
      relativePath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉冬/平拍原图/全域/7p/鞋品',
      broadRelativePath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉冬/平拍原图/全域/7p/鞋品',
    },
  }

  assert.equal(helpers.isShoeCodePlan(shoeScopedSourceConfigs, apparelItems), false)
  assert.equal(helpers.isShoeCodePlan({}, shoeItems), true)
})

test('light-supply SKU layout prefers highest resolution without inventing colors; white fallback stays scoped', async () => {
  const h = await loadExports()
  const code = '2084261412A7'
  const base = `冬/轻供/鞋品/幸福玛丽/${code}/`
  const item = p => ({ filename: p.split('/').at(-1), fullpath: base + p, dir: 0 })
  const items = ['sku/800/31.jpg', 'sku/1200/31.jpg', 'sku/1200/32.jpg', '白底/1200.jpg', '详情/1200.jpg'].map(item)
  assert.deepEqual(Array.from(h.selectShoeStyleColorItems(items, code), x => x.filename), ['31.jpg', '32.jpg'])
  assert.equal(h.selectShoeStyleColorItems(items, code + '-00301').length, 0)
  assert.equal(h.selectShoeStyleColorItems(items, '2084261412A9').length, 0)
  const white = ['白底/800.jpg', '白底/1200.jpg', '详情/1200.jpg'].map(item)
  assert.deepEqual(Array.from(h.selectShoeStyleColorItems(white, code), x => x.fullpath), [base + '白底/1200.jpg'])
  assert.equal(h.selectShoeStyleColorItems(items.map(x => ({ ...x, fullpath: x.fullpath.replace('/轻供/', '/期货/') })), code).length, 0)
})

test('UUID labels only enter OCR from the exact light-supply style root', async () => {
  const h = await loadExports(), code = '2084261412A7'
  const filename = 'daf0269c-5d45-414f-aba3-f2f31bfa6dd3.png'
  const root = `冬/轻供/鞋品/幸福玛丽/${code}/`
  const item = { filename, fullpath: root + filename, dir: 0 }
  const selected = h.selectShoeLabelItems([item, { ...item, fullpath: root + '详情/' + filename }], code)
  assert.equal(selected.length, 1)
  assert.equal(selected[0].__shoe_label_candidate_kind, 'light_supply_ocr')
  assert.equal(selected[0].__shoe_color_code, '')
  assert.equal(h.selectShoeLabelItems([item], code + '-00301').length, 0)
  assert.equal(h.selectShoeLabelItems([item], '2084261412A9').length, 0)
})

test('status-suffixed light-supply styles use transparent or named white images without color inference', async () => {
  const h = await loadExports()
  const code = '2081271412V2'
  const base = `冬/轻供/鞋品/幻视/${code}-已选/`
  const item = name => ({ filename: name.split('/').at(-1), fullpath: base + name, dir: 0 })
  const files = ['透明图/5S7A2057.png', '透明图/5S7A2063.png', '大图/相机白底.jpg', '主图/1.jpg', '1.jpg', '10.jpg'].map(item)
  assert.deepEqual(Array.from(h.selectShoeStyleColorItems(files, code), x => x.filename), ['5S7A2057.png', '5S7A2063.png'])
  assert.ok(h.selectShoeStyleColorItems(files, code).every(x => x.__shoe_color_code === ''))
  assert.deepEqual(Array.from(h.selectShoeStyleColorItems([item('大图/相机白底.jpg'), item('主图/1.jpg')], code), x => x.filename), ['相机白底.jpg'])
  for (const wrong of [code + '0-已选', code + '-00323', code + '-其他', '2081271412V3-已选']) {
    assert.equal(h.selectShoeStyleColorItems(files.map(x => ({ ...x, fullpath: x.fullpath.replace(code + '-已选', wrong) })), code).length, 0)
  }
  assert.equal(h.selectShoeStyleColorItems(files, code + '-00323').length, 0)
})

test('light-supply photographed box candidates stay scoped and need OCR, retain different copies', async () => {
  const h = await loadExports()
  const code = '2081271412V1'
  const base = `冬/轻供/鞋品/幻视/${code}-已选/`
  const item = name => ({ filename: name.split('/').at(-1), fullpath: base + name, dir: 0 })
  const chosen = h.selectShoeLabelItems(['鞋盒.JPG', '鞋盒 - 副本.JPG', '5S7A3390.JPG', '1.jpg', '详情图/5S7A3391.JPG', '大图/5S7A3392.JPG', '鞋盒无标签.JPG'].map(item), code)
  assert.equal(chosen.length, 3)
  assert.ok(chosen.every(x => x.__shoe_label_candidate_kind === 'light_supply_box_ocr' && x.__shoe_color_code === ''))
  const batch = Array.from({ length: 20 }, (_, i) => item(`修片大图/5S7A${3300 + i}.JPG`))
  assert.equal(h.selectLightSupplyBoxCandidates(batch, code).length, 8)
  assert.equal(h.selectLightSupplyBoxCandidates(batch, code)[0].filename, '5S7A3312.JPG')
  assert.equal(h.selectLightSupplyBoxCandidates(batch.map(x => ({ ...x, fullpath: x.fullpath.replace('/轻供/', '/期货/') })), code).length, 0)
})

const incidentModule = '巴拉货控/02 产品上新模块/2-2 巴拉产品上新'
const incidentSeason = `${incidentModule}/2026年巴拉冬`

function incidentSource(type, relativePath = `${incidentSeason}/${type === 'model' ? '模拍原图' : '平拍原图'}`) {
  return { mountId: '2023', relativePath, broadRelativePath: incidentModule }
}

test('October 24 light-supply paths are discovered from standard defaults for all eight missing styles', async () => {
  const apparel = ['208426103181', '208426121099', '208426121298', '208426108197', '208426108196']
  const shoes = ['2084261412W7', '2081271402W9', '2084261412W8']
  for (const code of [...apparel, ...shoes]) {
    const root = apparel.includes(code)
      ? `${incidentSeason}/轻供/中童-红叶/静物图/10.30上市-已写/${code}-静物图 已审核-已写`
      : `${incidentSeason}/轻供/鞋品/10.30上市/幻视/${code}-已选`
    const filename = apparel.includes(code) ? `${code}-00466.jpg` : '1200-1.jpg'
    const asset = { dir: 0, filename, fullpath: `${root}/${apparel.includes(code) ? '' : 'SKU/'}${filename}` }
    const h = await loadExports({ fetch: async url => String(url).includes('/search')
      ? jsonResponse({ total: 1, list: [{ dir: 1, filename: root.split('/').at(-1), fullpath: root }] })
      : jsonResponse({ total: 1, list: [asset] }) })
    const result = await h.collectCandidateAssets(code, incidentSource('still'), { sourceType: 'still', folderScanDepth: 3 })
    assert.equal(result.folderCount, 1, code)
    assert.deepEqual(Array.from(result.items, x => x.fullpath), [asset.fullpath], code)
    assert.equal(result.items[0].__source_type, 'still')
  }
})

test('light-supply source aliases distinguish stills, labels and AI models within the owning module', async () => {
  const h = await loadExports()
  const root = `${incidentSeason}/轻供/中童-红叶`
  for (const folder of ['静物图/10.30上市-已写', '电子吊牌洗唛']) {
    const p = `${root}/${folder}/208426103181`
    assert.equal(h.isWithinBroadSourceScope(p, incidentSource('still'), 'still'), true)
    assert.equal(h.isWithinBroadSourceScope(p, incidentSource('model'), 'model'), false)
  }
  const model = `${root}/AI模拍/208426103181-AI模特图-已审核9.15已选9.18`
  assert.equal(h.isWithinBroadSourceScope(model, incidentSource('model'), 'model'), true)
  assert.equal(h.isWithinBroadSourceScope(model, incidentSource('still'), 'still'), false)
  for (const p of [`${root}/尺寸表/208426103181.png`, `${root}/AI视频/208426103181`,
    '巴拉货控/杂七杂八/14 物流图/208426103181.jpg',
    `其他业务/轻供/中童-红叶/静物图/208426103181`,
    `${incidentModule}备份/2026年巴拉冬/轻供/中童-红叶/静物图/208426103181`]) {
    assert.equal(h.isWithinBroadSourceScope(p, incidentSource('still'), 'still'), false, p)
    assert.equal(h.isWithinBroadSourceScope(p, incidentSource('model'), 'model'), false, p)
  }
})

test('explicit light-supply root excludes models and size charts and preserves complete style boundaries', async () => {
  const code = '208426103181'
  const root = `${incidentSeason}/轻供/中童-红叶`
  const paths = [`静物图/${code}-已写/${code}-00422.jpg`, `电子吊牌洗唛/${code}/401_${code}_红叶.pdf`,
    `AI模拍/${code}-已选/${code}-00422.jpg`, `尺寸表/${code}.png`,
    `静物图/${code}9-已写/${code}9-00422.jpg`]
  const h = await loadExports({ fetch: async () => jsonResponse({ total: paths.length, list: paths.map(p => ({
    dir: 0, filename: p.split('/').at(-1), fullpath: `${root}/${p}`,
  })) }) })
  const result = await h.collectCandidateAssets(code, incidentSource('still', root), { sourceType: 'still', folderScanDepth: 0 })
  assert.deepEqual(Array.from(result.items, x => x.fullpath), paths.slice(0, 2).map(p => `${root}/${p}`))
})

test('light-supply numbered supplier PDFs are hang tags, not wash labels inherited from the combined folder', async () => {
  const h = await loadExports()
  for (const [index, code] of ['208426103181', '208426121099', '208426121298', '208426108197', '208426108196'].entries()) {
    const root = `${incidentSeason}/轻供/中童-红叶/电子吊牌洗唛/${code}`
    const pdf = { dir: 0, filename: `${401 + index}_${code}_红叶.pdf`, fullpath: `${root}/${401 + index}_${code}_红叶.pdf` }
    const wash = { dir: 0, filename: 'image.jpeg', fullpath: `${root}/image.jpeg` }
    assert.equal(h.inferLabelKind(pdf, code), 'hang_tag', code)
    assert.deepEqual(Array.from(h.selectLabelItems([pdf, wash], 'hang_tag', code), x => x.filename), [pdf.filename])
    assert.deepEqual(Array.from(h.selectLabelItems([pdf, wash], 'wash_label', code), x => x.filename), ['image.jpeg'])
    assert.equal(h.inferLabelKind({ ...pdf, filename: `${code}洗唛.pdf`, fullpath: `${root}/${code}洗唛.pdf` }, code), 'wash_label')
    assert.equal(h.inferLabelKind({ ...pdf, filename: `${code}吊牌.pdf`, fullpath: `${root}/${code}吊牌.pdf` }, code), 'hang_tag')
    assert.notEqual(h.inferLabelKind({ ...pdf, fullpath: pdf.fullpath.replace(`/电子吊牌洗唛/${code}/`, `/电子吊牌洗唛/${code}9/`) }, code), 'hang_tag')
  }
})
