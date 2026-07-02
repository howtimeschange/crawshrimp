import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/mop-ops-assistant/cloud-folder-download.js')
const MANIFEST_PATH = path.resolve('adapters/mop-ops-assistant/manifest.yaml')

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
    location: { href: 'https://fmp.semirapp.com/web/index#/home/file' },
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
  }
  context.globalThis = context
  await vm.runInNewContext(source, context, { filename: SCRIPT_PATH })
  return exportsBox
}

test('buildRelationshipRows splits plus-delimited folder names into style columns', async () => {
  const helpers = await loadExports()
  const rows = helpers.buildRelationshipRows([
    {
      filename: '653100C4202Z+653100C2003Z(2)',
      fullpath: 'MOP品牌/MOP_26 模拍图/26ss/1月拍摄电商专供0121/653100C4202Z+653100C2003Z(2)',
    },
    {
      filename: '655232N5124YS68+656939D1213Y152+603912525049932',
      fullpath: 'MOP品牌/MOP_26 模拍图/26ss/1月拍摄电商专供0121/655232N5124YS68+656939D1213Y152+603912525049932',
    },
  ])

  assert.equal(rows.length, 2)
  assert.equal(rows[0].__sheet_name, '搭配关系')
  assert.equal(rows[0]['文件夹名'], '653100C4202Z+653100C2003Z(2)')
  assert.equal(rows[0]['款号1'], '653100C4202Z')
  assert.equal(rows[0]['款号2'], '653100C2003Z')
  assert.equal(rows[0]['搭配款数'], 2)
  assert.equal(rows[1]['款号3'], '603912525049932')
  assert.equal(rows[1]['搭配款数'], 3)
})

test('parseCloudPath accepts copied Semir cloud drive folder URLs', async () => {
  const helpers = await loadExports()
  const parsed = helpers.parseCloudPath(
    'https://fmp.semirapp.com/web/index#/home/file/mount/2022?path=MOP%E5%93%81%E7%89%8C%2FMOP_26%20%E6%A8%A1%E6%8B%8D%E5%9B%BE%2F26ss%2F1%E6%9C%88%E6%8B%8D%E6%91%84%E7%94%B5%E5%95%86%E4%B8%93%E4%BE%9B0121',
  )

  assert.equal(parsed.mountId, '2022')
  assert.equal(parsed.mountName, '')
  assert.equal(parsed.relativePath, 'MOP品牌/MOP_26 模拍图/26ss/1月拍摄电商专供0121')
})

test('buildCloudFolderPlan relationship_only only exports folder relationship rows', async () => {
  const calls = []
  const fileLsFullpaths = []
  const helpers = await loadExports(async (url) => {
    const parsed = new URL(String(url), 'https://fmp.semirapp.com')
    calls.push(parsed.pathname)
    if (parsed.pathname === '/fengcloud/1/account/mount') {
      return { ok: true, json: async () => ({ list: [{ mount_id: '2022', org_name: '品牌电商项目部' }] }) }
    }
    if (parsed.pathname === '/fengcloud/1/file/ls') {
      fileLsFullpaths.push(parsed.searchParams.get('fullpath'))
      return {
        ok: true,
        json: async () => ({
          list: [
            {
              dir: 1,
              filename: '653100C4202Z+653100C2003Z',
              fullpath: 'MOP品牌/MOP_26 模拍图/26ss/1月拍摄电商专供0121/653100C4202Z+653100C2003Z',
            },
          ],
          total: 1,
        }),
      }
    }
    throw new Error(`unexpected fetch ${parsed.pathname}`)
  })

  const plan = await helpers.buildCloudFolderPlan({
    task_mode: 'relationship_only',
    cloud_path: '品牌电商项目部//MOP品牌/MOP_26 模拍图/26ss/1月拍摄电商专供0121/',
  })

  assert.equal(plan.relationshipRows.length, 1)
  assert.equal(plan.detailRows.length, 0)
  assert.equal(plan.downloadItems.length, 0)
  assert.equal(calls.includes('/fengcloud/2/file/info'), false)
  assert.deepEqual(fileLsFullpaths, ['MOP品牌/MOP_26 模拍图/26ss/1月拍摄电商专供0121'])
})

test('buildCloudFolderPlan selected_styles downloads only folders matching requested style codes', async () => {
  const fileInfoPaths = []
  const helpers = await loadExports(async (url) => {
    const parsed = new URL(String(url), 'https://fmp.semirapp.com')
    const fullpath = parsed.searchParams.get('fullpath') || ''
    if (parsed.pathname === '/fengcloud/1/account/mount') {
      return { ok: true, json: async () => ({ list: [{ mount_id: '2022', org_name: '品牌电商项目部' }] }) }
    }
    if (parsed.pathname === '/fengcloud/2/file/info') {
      fileInfoPaths.push(fullpath)
      return { ok: true, json: async () => ({ uri: `https://download.example/${path.basename(fullpath)}` }) }
    }
    if (parsed.pathname === '/fengcloud/1/file/ls') {
      if (fullpath.endsWith('/653100C4202Z+653100C2003Z')) {
        return {
          ok: true,
          json: async () => ({
            list: [
              {
                dir: 0,
                filename: 'matched.jpg',
                fullpath: `${fullpath}/matched.jpg`,
              },
            ],
            total: 1,
          }),
        }
      }
      if (fullpath.endsWith('/653124B2108Z100')) {
        throw new Error('unmatched folder should not be listed')
      }
      return {
        ok: true,
        json: async () => ({
          list: [
            {
              dir: 1,
              filename: '653100C4202Z+653100C2003Z',
              fullpath: 'MOP品牌/MOP_26 模拍图/26ss/1月拍摄电商专供0121/653100C4202Z+653100C2003Z',
            },
            {
              dir: 1,
              filename: '653124B2108Z100',
              fullpath: 'MOP品牌/MOP_26 模拍图/26ss/1月拍摄电商专供0121/653124B2108Z100',
            },
          ],
          total: 2,
        }),
      }
    }
    throw new Error(`unexpected fetch ${parsed.pathname}`)
  })

  const plan = await helpers.buildCloudFolderPlan({
    task_mode: 'selected_styles',
    style_codes: '653100C4202Z\nNOT_FOUND',
    cloud_path: '品牌电商项目部//MOP品牌/MOP_26 模拍图/26ss/1月拍摄电商专供0121/',
    export_folder: '/tmp/mop-export',
    package_name: 'MOP指定款号',
  })

  assert.equal(plan.relationshipRows.length, 2)
  assert.equal(plan.downloadItems.length, 1)
  assert.equal(plan.downloadItems[0].target_dir, '/tmp/mop-export/MOP指定款号')
  assert.equal(plan.downloadItems[0].target_dir_unique, true)
  assert.equal(plan.downloadItems[0].target_relative_path, '653100C4202Z+653100C2003Z/matched.jpg')
  assert.equal(plan.detailRows.some(row => row['顶层文件夹'] === '653124B2108Z100'), false)
  assert.equal(plan.detailRows.some(row => row['顶层文件夹'] === 'NOT_FOUND' && row['下载结果'] === '未找到匹配文件夹'), true)
  assert.deepEqual(fileInfoPaths, [
    'MOP品牌/MOP_26 模拍图/26ss/1月拍摄电商专供0121/653100C4202Z+653100C2003Z/matched.jpg',
  ])
})

test('buildCloudFolderPlan recursively lists folder files and prepares download rows', async () => {
  const calls = []
  const payloads = new Map([
    [
      '/fengcloud/1/account/mount',
      { list: [{ mount_id: '2022', org_name: '品牌电商项目部' }] },
    ],
    [
      '/fengcloud/1/file/ls?fullpath=MOP%E5%93%81%E7%89%8C%2FMOP_26+%E6%A8%A1%E6%8B%8D%E5%9B%BE%2F26ss%2F1%E6%9C%88%E6%8B%8D%E6%91%84%E7%94%B5%E5%95%86%E4%B8%93%E4%BE%9B0121',
      {
        list: [
          {
            dir: 1,
            filename: '653100C4202Z+653100C2003Z',
            fullpath: 'MOP品牌/MOP_26 模拍图/26ss/1月拍摄电商专供0121/653100C4202Z+653100C2003Z',
          },
        ],
        total: 1,
      },
    ],
    [
      '/fengcloud/1/file/ls?fullpath=MOP%E5%93%81%E7%89%8C%2FMOP_26+%E6%A8%A1%E6%8B%8D%E5%9B%BE%2F26ss%2F1%E6%9C%88%E6%8B%8D%E6%91%84%E7%94%B5%E5%95%86%E4%B8%93%E4%BE%9B0121%2F653100C4202Z%2B653100C2003Z',
      {
        list: [
          {
            dir: 0,
            filename: 'look-01.jpg',
            ext: 'jpg',
            fullpath: 'MOP品牌/MOP_26 模拍图/26ss/1月拍摄电商专供0121/653100C4202Z+653100C2003Z/look-01.jpg',
          },
          {
            dir: 1,
            filename: '视频',
            fullpath: 'MOP品牌/MOP_26 模拍图/26ss/1月拍摄电商专供0121/653100C4202Z+653100C2003Z/视频',
          },
        ],
        total: 2,
      },
    ],
    [
      '/fengcloud/1/file/ls?fullpath=MOP%E5%93%81%E7%89%8C%2FMOP_26+%E6%A8%A1%E6%8B%8D%E5%9B%BE%2F26ss%2F1%E6%9C%88%E6%8B%8D%E6%91%84%E7%94%B5%E5%95%86%E4%B8%93%E4%BE%9B0121%2F653100C4202Z%2B653100C2003Z%2F%E8%A7%86%E9%A2%91',
      {
        list: [
          {
            dir: 0,
            filename: 'runway.mp4',
            ext: 'mp4',
            fullpath: 'MOP品牌/MOP_26 模拍图/26ss/1月拍摄电商专供0121/653100C4202Z+653100C2003Z/视频/runway.mp4',
          },
        ],
        total: 1,
      },
    ],
  ])

  const helpers = await loadExports(async (url) => {
    const parsed = new URL(String(url), 'https://fmp.semirapp.com')
    calls.push(`${parsed.pathname}?${parsed.searchParams.toString()}`)
    if (parsed.pathname === '/fengcloud/2/file/info') {
      return {
        ok: true,
        json: async () => ({ uri: `https://download.example/${path.basename(parsed.searchParams.get('fullpath'))}` }),
      }
    }
    const fullpath = parsed.searchParams.get('fullpath')
    const key = fullpath
      ? `${parsed.pathname}?fullpath=${new URLSearchParams({ fullpath }).toString().replace('fullpath=', '')}`
      : parsed.pathname
    const payload = payloads.get(key)
    if (!payload) throw new Error(`unexpected fetch ${key}`)
    return { ok: true, json: async () => payload }
  })

  const plan = await helpers.buildCloudFolderPlan({
    task_mode: 'full_download',
    cloud_path: '品牌电商项目部//MOP品牌/MOP_26 模拍图/26ss/1月拍摄电商专供0121/',
  })

  assert.equal(calls.some(call => call.startsWith('/fengcloud/1/file/ls')), true)
  assert.equal(plan.relationshipRows.length, 1)
  assert.equal(plan.downloadItems.length, 2)
  assert.deepEqual(
    JSON.parse(JSON.stringify(plan.detailRows.map(row => [row.__sheet_name, row['顶层文件夹'], row['文件名'], row['本地目录内路径']]))),
    [
      ['下载明细', '653100C4202Z+653100C2003Z', 'look-01.jpg', '653100C4202Z+653100C2003Z/look-01.jpg'],
      ['下载明细', '653100C4202Z+653100C2003Z', 'runway.mp4', '653100C4202Z+653100C2003Z/视频/runway.mp4'],
    ],
  )
})

test('MOP manifest declares cloud folder download task on Semir cloud drive', async () => {
  const manifest = fs.readFileSync(MANIFEST_PATH, 'utf8')
  assert.match(manifest, /id: cloud_folder_download/)
  assert.match(manifest, /id: task_mode/)
  assert.match(manifest, /script: cloud-folder-download\.js/)
  assert.match(manifest, /entry_url: https:\/\/fmp\.semirapp\.com\/web\/index#\/home\/file/)
  assert.match(manifest, /sheet_key: __sheet_name/)
  assert.match(manifest, /MOP云盘文件夹下载与搭配关系_\{timestamp\}\.xlsx/)
})
