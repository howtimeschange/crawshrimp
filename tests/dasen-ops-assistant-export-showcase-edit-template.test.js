import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/dasen-ops-assistant/export-showcase-edit-template.js')
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8')

async function runAdapter({ params = {}, fetchMock } = {}) {
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
    },
    localStorage: {
      getItem: () => JSON.stringify({
        state: {
          authData: {
            oauth2Token: { access_token: 'token-for-test' },
          },
        },
      }),
    },
    fetch: fetchMock,
    URLSearchParams,
    console,
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
    Error,
  }
  context.globalThis = context
  return await vm.runInNewContext(SCRIPT_SOURCE, context, { filename: SCRIPT_PATH })
}

function caseDetail(id, name) {
  return {
    id,
    name,
    icon: `https://cdn.example/${id}.png`,
    categoryCode: 'PL6',
    useLink: 'https://ai.semir.com/console/studio/demo',
    aiTeam: '电商运营',
    dingDeptId: 3,
    description: `${name} 描述`,
    useDescription: `<p>${name} 说明</p>`,
    developers: [{ userId: 'xingyicheng', name: '邢易成' }],
    skills: [{ id: '2058752504616763394', name: 'WPS自动生成PPT' }],
    casePosition: [{ name: '电商运营' }],
    frequency: 30,
    efficiency: { originalTime: 2, currentTime: 1, economizeTime: 1 },
    increase: {},
    cost: {},
    other: {},
    indicator: [],
    diff: [],
    document: [],
    video: [],
  }
}

function response(data) {
  return {
    ok: true,
    json: async () => ({ code: 200, data }),
  }
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('exports all list-page cases by paging plaza endpoint and hydrating details', async () => {
  const calls = []
  async function fetchMock(url) {
    calls.push(String(url))
    if (String(url).includes('case/page')) {
      const page = new URL(String(url)).searchParams.get('currentPage')
      if (page === '1') return response({ list: [{ id: '1000000000000000001' }], total: 2 })
      return response({ list: [{ caseId: '1000000000000000002' }], total: 2, lastPage: true })
    }
    if (String(url).includes('case/info')) {
      const id = new URL(String(url)).searchParams.get('id')
      return response(caseDetail(id, id === '1000000000000000001' ? '案例一' : '案例二'))
    }
    return response({})
  }

  const result = await runAdapter({
    params: { export_scope: 'all_published', page_size: 1 },
    fetchMock,
  })

  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(result.data.length, 2)
  assert.deepEqual(plain(result.data.map(row => row.案例ID)), ['1000000000000000001', '1000000000000000002'])
  assert.equal(result.data[0].案例名称, '案例一')
  assert.ok(calls.some(url => url.includes('case/page')))
  assert.equal(calls.some(url => url.includes('case/publish/page')), false)
})

test('selected id export skips list endpoint and parses ids from edit urls', async () => {
  const calls = []
  async function fetchMock(url) {
    calls.push(String(url))
    if (String(url).includes('case/info')) {
      const id = new URL(String(url)).searchParams.get('id')
      return response(caseDetail(id, '指定案例'))
    }
    throw new Error(`unexpected request ${url}`)
  }

  const result = await runAdapter({
    params: {
      export_scope: 'selected_ids',
      case_ids: 'https://ai.semir.com/console/studio/showcase/create/?id=2058913263735545856\n2058913263735545856',
    },
    fetchMock,
  })

  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].案例ID, '2058913263735545856')
  assert.equal(calls.some(url => url.includes('case/page')), false)
})

test('export sanitizes Excel-invalid control characters from detail fields', async () => {
  async function fetchMock(url) {
    if (String(url).includes('case/page')) {
      return response({ list: [{ id: '1000000000000000003' }], total: 1, lastPage: true })
    }
    if (String(url).includes('case/info')) {
      return response({
        ...caseDetail('1000000000000000003', '控制字符案例'),
        useDescription: '<p>说明前\u000b说明后</p>',
        description: '描述前\u0000描述后',
      })
    }
    return response({})
  }

  const result = await runAdapter({
    params: { export_scope: 'all_published' },
    fetchMock,
  })

  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].案例说明.includes('\u000b'), false)
  assert.equal(result.data[0].案例描述.includes('\u0000'), false)
  assert.match(result.data[0].案例说明, /说明前\s+说明后/)
})
