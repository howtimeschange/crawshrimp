import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function loadExports() {
  const exportsBox = {}
  await runScript({
    phase: '__exports__',
    exportsBox,
  })
  return exportsBox
}

async function runScript(options = {}) {
  const scriptPath = path.resolve('adapters/tmall-ops-assistant/tmall-compete-member-monitor.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const exportsBox = options.exportsBox || {}
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: options.params || {},
      __CRAWSHRIMP_PHASE__: options.phase || 'main',
      __CRAWSHRIMP_SHARED__: options.shared || {},
      __CRAWSHRIMP_EXPORTS__: exportsBox,
      innerHeight: 857,
    },
    location: {
      href: 'https://market.m.taobao.com/app/sj/member-center-rax/pages/pages_index_index?wh_weex=true&source=ShopSelfUse&sellerId=1745656365',
      hostname: 'market.m.taobao.com',
      reload() {},
      ...(options.location || {}),
    },
    document: {
      title: '会员中心',
      readyState: 'complete',
      body: { innerText: '会员中心' },
      documentElement: { clientWidth: 400, scrollHeight: 3460, clientHeight: 857 },
      ...(options.document || {}),
    },
    URL,
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
  return await vm.runInNewContext(source, context, { filename: scriptPath })
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('member monitor normalizes Excel rows and skips requirement notes', async () => {
  const helpers = await loadExports()
  const rows = [
    {
      竞品店铺: '安踏童装旗舰店',
      'seller ID': 1745656365,
      '会员中心-完整链接': 'https://market.m.taobao.com/app/sj/member-center-rax/pages/pages_index_index?wh_weex=true&source=ShopSelfUse&sellerId=1745656365',
    },
    {
      竞品店铺: 'FILA童装',
      'seller ID': 2960684901,
      '会员中心-完整链接': '',
      会员中心固定链接: 'https://market.m.taobao.com/app/sj/member-center-rax/pages/pages_index_index?wh_weex=true&source=ShopSelfUse&sellerId=',
    },
    {
      竞品店铺: '需求',
      'seller ID': '登录手机号',
      '会员中心-完整链接': '',
    },
  ]

  const result = helpers.normalizeMemberRows(rows)

  assert.deepEqual(plain(result.rows.map(item => [item.shopName, item.sellerId])), [
    ['安踏童装旗舰店', '1745656365'],
    ['FILA童装', '2960684901'],
  ])
  assert.equal(result.rows[1].url, `${helpers.MEMBER_BASE_URL}2960684901`)
  assert.equal(result.invalidRows.length, 1)
  assert.equal(result.invalidRows[0].执行结果, '已跳过')
})

test('member monitor parses pasted URL lines and builds safe screenshot names', async () => {
  const helpers = await loadExports()
  const rows = helpers.parseMemberUrlLines('左西旗舰店 https://market.m.taobao.com/app/sj/member-center-rax/pages/pages_index_index?wh_weex=true&source=ShopSelfUse&sellerId=1710394567')
  const normalized = helpers.normalizeMemberRows(rows)

  assert.equal(normalized.rows.length, 1)
  assert.equal(normalized.rows[0].shopName, '左西旗舰店')
  assert.equal(normalized.rows[0].sellerId, '1710394567')
  assert.equal(
    helpers.buildScreenshotFilename({ shopName: '左西/旗舰店', sellerId: '1710394567' }, '2026-07-16'),
    '2026-07-16_左西_旗舰店_1710394567_会员中心_fullpage.png',
  )
  assert.equal(helpers.buildScreenshotFolderName({}, '2026-07-16'), '2026-07-16_竞品会员页面监控')
  assert.equal(helpers.buildScreenshotFolderName({ screenshot_folder_name: '7月复盘/会员监控' }, '2026-07-16'), '7月复盘_会员监控')
  assert.equal(
    helpers.buildScreenshotRelativePath(normalized.rows[0], '2026-07-16', '2026-07-16_竞品会员页面监控'),
    '2026-07-16_竞品会员页面监控/2026-07-16_左西旗舰店_1710394567_会员中心_fullpage.png',
  )
})

test('member monitor keeps every submitted valid member URL including duplicates', async () => {
  const helpers = await loadExports()
  const rows = helpers.parseMemberUrlLines([
    '安踏童装旗舰店 https://market.m.taobao.com/app/sj/member-center-rax/pages/pages_index_index?wh_weex=true&source=ShopSelfUse&sellerId=1745656365',
    '安踏童装旗舰店 https://market.m.taobao.com/app/sj/member-center-rax/pages/pages_index_index?wh_weex=true&source=ShopSelfUse&sellerId=1745656365',
    'FILA童装旗舰店 https://market.m.taobao.com/app/sj/member-center-rax/pages/pages_index_index?wh_weex=true&source=ShopSelfUse&sellerId=2960684901',
    '左西旗舰店 https://market.m.taobao.com/app/sj/member-center-rax/pages/pages_index_index?wh_weex=true&source=ShopSelfUse&sellerId=1710394567',
  ].join('\n'))

  const normalized = helpers.normalizeMemberRows(rows, { limit: 1 })

  assert.deepEqual(plain(normalized.rows.map(item => item.sellerId)), [
    '1745656365',
    '1745656365',
    '2960684901',
    '1710394567',
  ])
  assert.equal(
    helpers.buildScreenshotFilename(normalized.rows[1], '2026-07-16'),
    '2026-07-16_安踏童装旗舰店_1745656365_会员中心_fullpage_2.png',
  )
})

test('member monitor stores screenshots in a dated batch folder', async () => {
  const target = {
    rowNo: 2,
    shopName: '安踏童装旗舰店',
    sellerId: '1745656365',
    url: 'https://market.m.taobao.com/app/sj/member-center-rax/pages/pages_index_index?wh_weex=true&source=ShopSelfUse&sellerId=1745656365',
  }
  const result = await runScript({
    phase: 'wait_page',
    params: {
      capture_settle_seconds: 3,
    },
    shared: {
      queue: [target],
      cursor: 0,
      current_target: target,
      capture_date: '2026-07-16',
      screenshot_folder_name: '7月复盘_会员监控',
      output_dir: '/Users/xingyicheng/Downloads',
      wait_attempts: 0,
    },
    document: {
      title: '安踏童装会员中心',
      readyState: 'complete',
      body: { innerText: '会员中心 已配置官方旗舰店 新会员入会礼包 本月会员权益' },
      documentElement: { clientWidth: 400, scrollHeight: 3600, clientHeight: 857 },
    },
  })

  assert.equal(result.meta.action, 'capture_screenshot')
  assert.equal(result.meta.filename, '2026-07-16_安踏童装旗舰店_1745656365_会员中心_fullpage.png')
  assert.equal(
    result.meta.target_relative_path,
    '7月复盘_会员监控/2026-07-16_安踏童装旗舰店_1745656365_会员中心_fullpage.png',
  )
  assert.equal(result.meta.target_dir, '/Users/xingyicheng/Downloads')
})

test('member monitor throttles batch screenshots and stops on risk prompts', async () => {
  const helpers = await loadExports()

  assert.deepEqual(plain(helpers.normalizePacing({
    pacing_min_seconds: 12,
    pacing_max_seconds: 4,
    cooldown_every: 3,
    cooldown_seconds: 90,
  })), {
    minSeconds: 12,
    maxSeconds: 12,
    cooldownEvery: 3,
    cooldownSeconds: 90,
  })
  assert.equal(helpers.computePacingDelayMs({
    pacing_min_seconds: 8,
    pacing_max_seconds: 8,
    cooldown_every: 2,
    cooldown_seconds: 120,
  }, 2), 128000)
  assert.equal(helpers.computePacingDelayMs({
    pacing_min_seconds: 0,
    pacing_max_seconds: 0,
    cooldown_every: 0,
    cooldown_seconds: 120,
  }, 2), 0)
  assert.equal(helpers.captureSettleMs({ capture_settle_seconds: 4 }), 4000)
  assert.match(
    helpers.detectBlockReason('market.m.taobao.com', '访问过于频繁，请稍后再试'),
    /安全验证或访问频率限制/,
  )
  assert.match(helpers.detectBlockReason('login.taobao.com', '扫码登录'), /登录态/)
  assert.match(helpers.detectPageErrorReason('服务溜了小差，请刷新试试'), /平台繁忙/)

  const skipped = helpers.buildStoppedRows([{ rowNo: 2, shopName: '安踏童装', sellerId: '1745656365', url: 'u' }], 0, 'stop')
  assert.equal(skipped[0].执行结果, '已跳过')
  assert.equal(skipped[0].备注, 'stop')
})

test('tmall manifest declares compete member monitor screenshot task', () => {
  const manifest = fs.readFileSync(path.resolve('adapters/tmall-ops-assistant/manifest.yaml'), 'utf8')

  assert.match(manifest, /version: 0\.1\.3/)
  assert.match(manifest, /id: tmall_compete_member_monitor/)
  assert.match(manifest, /name: 天猫-竞品会员页面监控/)
  assert.match(manifest, /script: tmall-compete-member-monitor\.js/)
  assert.match(manifest, /type: file_excel/)
  assert.doesNotMatch(manifest, /screenshot_limit|截图数量上限/)
  assert.match(manifest, /screenshot_folder_name/)
  assert.match(manifest, /当前抓取日期_竞品会员页面监控/)
  assert.match(manifest, /pacing_min_seconds/)
  assert.match(manifest, /cooldown_seconds/)
  assert.match(manifest, /capture_settle_seconds/)
  assert.match(manifest, /截图文件/)
})
