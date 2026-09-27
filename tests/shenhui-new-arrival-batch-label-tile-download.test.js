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
