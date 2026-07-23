import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/semir-cloud-drive/shein-image-package-download.js')
const MANIFEST_PATH = path.resolve('adapters/semir-cloud-drive/manifest.yaml')

async function loadExports(fetchHandler = async () => ({ ok: true, json: async () => ({}) })) {
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
    fetch: fetchHandler,
    URL,
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
    Error,
    encodeURIComponent,
    decodeURIComponent,
  }
  context.globalThis = context
  await vm.runInNewContext(source, context, { filename: SCRIPT_PATH })
  return exportsBox
}

function response(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }
}

test('parseCloudPath accepts configured Semir mount paths and copied folder URLs', async () => {
  const helpers = await loadExports()
  const configured = helpers.parseCloudPath(
    '森马云盘-海外业务中心-数字业务部//0-balabala+minibla视觉/3-海外（♦️运营用）/3-主图1340x1785/',
  )
  const copiedUrl = helpers.parseCloudPath(
    'https://fmp.semirapp.com/web/index#/home/file/mount/1874?path=0-balabala%2Bminibla%E8%A7%86%E8%A7%89%2F3-%E6%B5%B7%E5%A4%96',
  )

  assert.equal(configured.mountName, '海外业务中心-数字业务部')
  assert.equal(configured.relativePath, '0-balabala+minibla视觉/3-海外（♦️运营用）/3-主图1340x1785')
  assert.equal(copiedUrl.mountId, '1874')
  assert.equal(copiedUrl.relativePath, '0-balabala+minibla视觉/3-海外')
})

test('normalizeStyleCodes accepts pasted separators and removes duplicates', async () => {
  const helpers = await loadExports()
  assert.deepEqual(
    [...helpers.normalizeStyleCodes('208326120201\n208326102001，208326120201 231326108202')],
    ['208326120201', '208326102001', '231326108202'],
  )
})

test('selectStyleFolder uses exact in-scope folders and prefers the shallowest path', async () => {
  const helpers = await loadExports()
  const selected = helpers.selectStyleFolder([
    {
      dir: 1,
      filename: '208326120201',
      fullpath: '目标范围/季度/品牌/208326120201',
    },
    {
      dir: 1,
      filename: '208326120201',
      fullpath: '目标范围/季度/品牌/历史/208326120201',
    },
    {
      dir: 1,
      filename: '20832612020100312',
      fullpath: '目标范围/季度/品牌/208326120201/20832612020100312',
    },
    {
      dir: 1,
      filename: '208326120201',
      fullpath: '其他范围/208326120201',
    },
  ], '208326120201', '目标范围')

  assert.equal(selected.matchCount, 2)
  assert.equal(selected.folder.fullpath, '目标范围/季度/品牌/208326120201')
})

test('buildSheinPackagePlan recursively downloads every file under exact style folders', async () => {
  const searchBodies = []
  const infoPaths = []
  const root = '0-balabala+minibla视觉/3-海外（♦️运营用）/3-主图1340x1785/1-巴拉/208326120201'
  const colorFolder = `${root}/20832612020100312`

  const helpers = await loadExports(async (url, init = {}) => {
    const parsed = new URL(String(url), 'https://fmp.semirapp.com')
    if (parsed.pathname === '/fengcloud/1/account/mount') {
      return response({ list: [{ mount_id: '1874', org_name: '海外业务中心-数字业务部' }] })
    }
    if (parsed.pathname === '/fengcloud/2/file/search') {
      searchBodies.push(String(init.body || ''))
      return response({
        total: 3,
        list: [
          { dir: '1', filename: '208326120201', fullpath: root },
          { dir: '1', filename: '20832612020100312', fullpath: colorFolder },
          { dir: '0', filename: '20832612020100312_1.jpg', fullpath: `${colorFolder}/20832612020100312_1.jpg` },
        ],
      })
    }
    if (parsed.pathname === '/fengcloud/1/file/ls') {
      const fullpath = parsed.searchParams.get('fullpath')
      if (fullpath === root) {
        return response({
          total: 2,
          list: [
            { dir: '1', filename: '20832612020100312', fullpath: colorFolder },
            { dir: '0', filename: 'cover.txt', fullpath: `${root}/cover.txt`, filesize: 8 },
          ],
        })
      }
      if (fullpath === colorFolder) {
        return response({
          total: 2,
          list: [
            { dir: '0', filename: '20832612020100312_1.jpg', fullpath: `${colorFolder}/20832612020100312_1.jpg`, filesize: 101 },
            { dir: '0', filename: '20832612020100312_2.jpg', fullpath: `${colorFolder}/20832612020100312_2.jpg`, filesize: 102 },
          ],
        })
      }
    }
    if (parsed.pathname === '/fengcloud/2/file/info') {
      const fullpath = parsed.searchParams.get('fullpath')
      infoPaths.push(fullpath)
      return response({ uri: `https://download.example/${encodeURIComponent(path.basename(fullpath))}` })
    }
    throw new Error(`unexpected fetch: ${parsed.pathname}`)
  })

  const plan = await helpers.buildSheinPackagePlan({
    cloud_path: '海外业务中心-数字业务部//0-balabala+minibla视觉/3-海外（♦️运营用）/3-主图1340x1785/',
    style_codes: '208326120201',
  })

  assert.equal(plan.rows.length, 3)
  assert.equal(plan.downloadItems.length, 3)
  assert.equal(plan.rows.every(row => row['款号'] === '208326120201'), true)
  assert.deepEqual(
    [...plan.rows.map(row => row['ZIP内路径'])],
    [
      '208326120201/cover.txt',
      '208326120201/20832612020100312/20832612020100312_1.jpg',
      '208326120201/20832612020100312/20832612020100312_2.jpg',
    ],
  )
  assert.equal(plan.downloadItems.every(item => item.no_proxy === true), true)
  assert.equal(searchBodies[0].includes('keyword=208326120201'), true)
  assert.equal(infoPaths.length, 3)
})

test('finalizeRows maps successful and failed downloads without shifting prefailed rows', async () => {
  const helpers = await loadExports()
  const rows = helpers.finalizeRows([
    { '款号': 'A', '下载结果': '未找到款号文件夹', '本地文件': '' },
    { '款号': 'B', '下载结果': '', '本地文件': '', '备注': '' },
    { '款号': 'C', '下载结果': '', '本地文件': '', '备注': '' },
  ], {
    items: [
      { success: true, path: '/tmp/b.jpg' },
      { success: false, path: '/tmp/c.jpg', error: 'network error' },
    ],
  })

  assert.equal(rows[0]['下载结果'], '未找到款号文件夹')
  assert.equal(rows[1]['下载结果'], '已下载')
  assert.equal(rows[1]['本地文件'], '/tmp/b.jpg')
  assert.equal(rows[2]['下载结果'], '下载失败')
  assert.equal(rows[2]['备注'], 'network error')
})

test('Semir manifest exposes SHEIN image package download with the requested default path', () => {
  const manifest = fs.readFileSync(MANIFEST_PATH, 'utf8')
  assert.match(manifest, /id: shein_image_package_download/)
  assert.match(manifest, /script: shein-image-package-download\.js/)
  assert.match(manifest, /name: SHEIN 图包下载/)
  assert.match(manifest, /海外业务中心-数字业务部\/\/0-balabala\+minibla视觉\/3-海外（♦️运营用）\/3-主图1340x1785\//)
  assert.match(manifest, /filename: "SHEIN图包下载结果_\{timestamp\}\.xlsx"/)
})
