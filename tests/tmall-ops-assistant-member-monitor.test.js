import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function loadExports() {
  const scriptPath = path.resolve('adapters/tmall-ops-assistant/tmall-compete-member-monitor.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const exportsBox = {}
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: {},
      __CRAWSHRIMP_PHASE__: '__exports__',
      __CRAWSHRIMP_SHARED__: {},
      __CRAWSHRIMP_EXPORTS__: exportsBox,
    },
    location: {
      href: 'https://market.m.taobao.com/app/sj/member-center-rax/pages/pages_index_index?wh_weex=true&source=ShopSelfUse&sellerId=1745656365',
      hostname: 'market.m.taobao.com',
    },
    document: {
      title: '会员中心',
      readyState: 'complete',
      body: { innerText: '会员中心' },
      documentElement: { clientWidth: 400, scrollHeight: 3460, clientHeight: 857 },
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
  await vm.runInNewContext(source, context, { filename: scriptPath })
  return exportsBox
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
    helpers.buildScreenshotFilename({ shopName: '左西/旗舰店', sellerId: '1710394567' }),
    '左西_旗舰店_1710394567_会员中心_fullpage.png',
  )
})

test('tmall manifest declares compete member monitor screenshot task', () => {
  const manifest = fs.readFileSync(path.resolve('adapters/tmall-ops-assistant/manifest.yaml'), 'utf8')

  assert.match(manifest, /version: 0\.1\.3/)
  assert.match(manifest, /id: tmall_compete_member_monitor/)
  assert.match(manifest, /name: 天猫-竞品会员页面监控/)
  assert.match(manifest, /script: tmall-compete-member-monitor\.js/)
  assert.match(manifest, /type: file_excel/)
  assert.match(manifest, /截图文件/)
})
