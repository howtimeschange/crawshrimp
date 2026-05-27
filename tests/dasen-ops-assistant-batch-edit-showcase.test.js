import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/dasen-ops-assistant/batch-edit-showcase.js')
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8')

async function runAdapter({ params = {}, phase = 'main', shared = {}, contextExtra = {} } = {}) {
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      ...(contextExtra.exportsBox ? { __CRAWSHRIMP_EXPORTS__: contextExtra.exportsBox } : {}),
    },
    document: contextExtra.document || {},
    location: { href: 'https://ai.semir.com/console/studio/showcase/?tab=plaza&restore=1' },
    localStorage: contextExtra.localStorage || {
      getItem: () => JSON.stringify({
        state: {
          authData: {
            oauth2Token: { access_token: 'token-for-test' },
          },
        },
      }),
    },
    fetch: contextExtra.fetch || (async () => ({ ok: true, json: async () => ({ code: 200, data: [] }) })),
    FormData: contextExtra.FormData || class FormData {
      constructor() { this.items = [] }
      append(key, value) { this.items.push([key, value]) }
    },
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
    parseInt,
    parseFloat,
    isNaN,
    Error,
  }
  context.globalThis = context
  return await vm.runInNewContext(SCRIPT_SOURCE, context, { filename: SCRIPT_PATH })
}

async function loadExports() {
  const exportsBox = {}
  await runAdapter({ phase: '__exports__', contextExtra: { exportsBox } })
  return exportsBox
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function catalogs() {
  return {
    categoryList: [
      { categoryCode: 'PL6', name: '销售' },
      { categoryCode: 'PL11', name: '其他' },
    ],
    aiTeams: [
      { name: '电商运营', value: '电商运营' },
      { name: '客服', value: '客服' },
      { name: '数字中心', value: '数字中心' },
    ],
    deptRows: [
      { deptId: 1, name: '数字中心', path: '数字中心', parentId: '' },
      { deptId: 2, name: '其他产研部', path: '数字中心 / 其他产研部', parentId: 1 },
      { deptId: 3, name: '海外业务产研组', path: '数字中心 / 其他产研部 / 海外业务产研组', parentId: 2 },
    ],
  }
}

function caseDetail(overrides = {}) {
  return {
    id: '2058913263735545856',
    name: '客服自动回复案例',
    icon: 'https://cdn.example/old-cover.png',
    categoryCode: 'PL6',
    useLink: 'https://ai.semir.com/console/studio/old',
    downloadLink: 'https://cdn.example/app.zip',
    aiTeam: '电商运营',
    dingDeptId: 3,
    dingDeptIdChain: '3,2,1',
    description: '用于提升客服回复效率的案例',
    useDescription: '<p>旧说明</p>',
    developers: [{ userId: 'xingyicheng', name: '邢易成' }],
    skills: [{ id: '2058752504616763394', name: 'WPS自动生成PPT' }],
    casePosition: [{ name: '电商运营' }, { name: '客服' }],
    frequency: 30,
    efficiency: { originalTime: 2, currentTime: 0.5, economizeTime: 1.5 },
    increase: {},
    cost: {},
    other: {},
    indicator: [{ description: '处理效率提升', value: '75%' }],
    diff: [{ before: '人工逐条回复', after: 'AI 自动生成回复' }],
    document: [{ name: 'manual.pdf', url: 'https://cdn.example/manual.pdf' }],
    video: [{ name: 'demo.mp4', url: 'https://cdn.example/demo.mp4' }],
    dingtalkLink: '15500000000',
    ...overrides,
  }
}

function apiClient({ detail = caseDetail(), skillName = 'WPS自动生成PPT' } = {}) {
  return {
    calls: [],
    async request(pathname, options = {}) {
      this.calls.push({ pathname, options })
      if (pathname.includes('case/info')) return detail
      if (pathname.includes('member/search')) {
        return [{ userId: 'xingyicheng', userName: '邢易成', phone: '15557105783', dept: '海外业务产研组' }]
      }
      if (pathname.includes('skill/page')) {
        const keyword = String(options.params?.keyword || '')
        if (keyword === skillName || keyword === '2058752504616763394') {
          return [{ id: '2058752504616763394', name: skillName }]
        }
        return []
      }
      if (pathname.includes('case/category')) return catalogs().categoryList
      if (pathname.includes('ai/team')) return catalogs().aiTeams
      if (pathname.includes('dept/tree')) return catalogs().deptRows
      if (pathname.includes('case/update')) return { id: detail.id }
      return []
    },
  }
}

test('batch edit rows overlay provided cells and keep blank cells from online detail', async () => {
  const helpers = await loadExports()
  const client = apiClient()
  const parsed = await helpers.normalizeEditRows([{
    案例ID: '2058913263735545856',
    使用链接: 'https://ai.semir.com/console/studio/new',
    下载链接: '',
    现工时: '0',
  }], {
    catalogs: catalogs(),
    apiClient: client,
  })

  assert.equal(parsed.invalidRows.length, 0, JSON.stringify(parsed.invalidRows))
  assert.equal(parsed.jobs.length, 1)
  const job = parsed.jobs[0]
  assert.equal(job.caseId, '2058913263735545856')
  assert.equal(job.useLink, 'https://ai.semir.com/console/studio/new')
  assert.equal(job.downloadLink, 'https://cdn.example/app.zip')
  assert.equal(job.currentHours, 0)
  assert.deepEqual(plain(job.developerIds), ['xingyicheng'])
  assert.deepEqual(plain(job.skillIds), ['2058752504616763394'])
  assert.ok(job.changedFields.includes('使用链接'))
  assert.ok(job.changedFields.includes('提效指标'))
  assert.equal(job.changedFields.includes('下载链接'), false)
})

test('clear token clears optional files and links during edit normalization', async () => {
  const helpers = await loadExports()
  const parsed = await helpers.normalizeEditRows([{
    案例ID: '2058913263735545856',
    下载链接: '__清空__',
    操作文档路径: '__清空__',
    视频路径: '__清空__',
    钉钉联系人: '__清空__',
  }], {
    catalogs: catalogs(),
    apiClient: apiClient(),
  })

  assert.equal(parsed.invalidRows.length, 0, JSON.stringify(parsed.invalidRows))
  const payload = parsed.jobs[0].nextPayload
  assert.equal(payload.downloadLink, '')
  assert.deepEqual(plain(payload.document), [])
  assert.deepEqual(plain(payload.video), [])
  assert.equal(payload.dingtalkLink, '')
  assert.ok(parsed.jobs[0].changedFields.includes('下载链接'))
  assert.ok(parsed.jobs[0].changedFields.includes('操作文档'))
  assert.ok(parsed.jobs[0].changedFields.includes('视频介绍'))
  assert.ok(parsed.jobs[0].changedFields.includes('钉钉联系人'))
})

test('patched AI team can replace legacy online value that is no longer in catalog', async () => {
  const helpers = await loadExports()
  const parsed = await helpers.normalizeEditRows([{
    案例ID: '2058913263735545856',
    所属AI纵队: '数字中心',
  }], {
    catalogs: catalogs(),
    apiClient: apiClient({ detail: caseDetail({ aiTeam: '其他' }) }),
  })

  assert.equal(parsed.invalidRows.length, 0, JSON.stringify(parsed.invalidRows))
  assert.equal(parsed.jobs.length, 1)
  assert.equal(parsed.jobs[0].aiTeam, '数字中心')
  assert.equal(parsed.jobs[0].basePayload.aiTeam, '其他')
  assert.equal(parsed.jobs[0].nextPayload.aiTeam, '数字中心')
  assert.deepEqual(plain(parsed.jobs[0].changedFields), ['所属AI纵队'])
})

test('updateCase posts merged payload to case update with id', async () => {
  const helpers = await loadExports()
  const client = apiClient()
  const parsed = await helpers.normalizeEditRows([{
    案例ID: '2058913263735545856',
    案例描述: '更新后的案例描述',
  }], {
    catalogs: catalogs(),
    apiClient: client,
  })

  const saved = await helpers.updateCase(parsed.jobs[0], client)
  assert.equal(saved.id, '2058913263735545856')
  const updateCall = client.calls.find(call => call.pathname.includes('case/update'))
  assert.ok(updateCall)
  assert.equal(updateCall.options.body.id, '2058913263735545856')
  assert.equal(updateCall.options.body.description, '更新后的案例描述')
  assert.equal(updateCall.options.body.status, 1)
})

test('plan phase fetches details and never calls update endpoint', async () => {
  const calls = []
  async function fetchMock(url, options = {}) {
    calls.push({ url: String(url), options })
    if (String(url).includes('case/info')) {
      return { ok: true, json: async () => ({ code: 200, data: caseDetail() }) }
    }
    if (String(url).includes('case/category/list')) {
      return { ok: true, json: async () => ({ code: 200, data: catalogs().categoryList }) }
    }
    if (String(url).includes('case/ai/team/list')) {
      return { ok: true, json: async () => ({ code: 200, data: catalogs().aiTeams }) }
    }
    if (String(url).includes('dept/tree')) {
      return { ok: true, json: async () => ({ code: 200, data: catalogs().deptRows }) }
    }
    if (String(url).includes('member/search')) {
      return { ok: true, json: async () => ({ code: 200, data: [{ userId: 'xingyicheng', userName: '邢易成' }] }) }
    }
    if (String(url).includes('skill/page')) {
      return { ok: true, json: async () => ({ code: 200, data: [{ id: '2058752504616763394', name: 'WPS自动生成PPT' }] }) }
    }
    return { ok: true, json: async () => ({ code: 200, data: {} }) }
  }

  const result = await runAdapter({
    params: {
      execute_mode: 'plan',
      input_file: { rows: [{ 案例ID: '2058913263735545856', 使用链接: 'https://ai.semir.com/console/studio/new' }] },
    },
    contextExtra: { fetch: fetchMock },
  })

  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.data[0].执行结果, '预检通过')
  assert.equal(calls.some(call => call.url.includes('case/update')), false)
})

test('update phase skips rows without detected field changes', async () => {
  const helpers = await loadExports()
  const parsed = await helpers.normalizeEditRows([{ 案例ID: '2058913263735545856' }], {
    catalogs: catalogs(),
    apiClient: apiClient(),
  })
  assert.equal(parsed.jobs[0].changedFields.length, 0)

  const result = await runAdapter({
    phase: 'update_case',
    shared: helpers.buildRunShared(parsed.jobs, 600),
    contextExtra: {
      fetch: async () => {
        throw new Error('update endpoint should not be called for no-op rows')
      },
    },
  })

  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.shared.results[0].执行结果, '无需更新')
})
