import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/dasen-ops-assistant/batch-create-showcase.js')
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
    location: { href: 'https://ai.semir.com/console/studio/showcase/create/' },
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
    ],
    deptRows: [
      { deptId: 1, name: '数字中心', path: '数字中心' },
      { deptId: 2, name: '其他产研部', path: '数字中心 / 其他产研部', parentId: 1 },
      { deptId: 3, name: '海外业务产研组', path: '数字中心 / 其他产研部 / 海外业务产研组', parentId: 2 },
    ],
  }
}

function apiClient({ skillName = 'WPS自动生成PPT' } = {}) {
  return {
    async request(pathname, options = {}) {
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
      if (pathname.includes('dept/tree')) return []
      if (pathname.includes('case/save')) return { id: 'case-001' }
      return []
    },
  }
}

function validRow(overrides = {}) {
  return {
    案例名称: '客服自动回复案例',
    封面图路径: '/Users/test/Desktop/cover.png',
    案例类型: '销售',
    使用链接: 'https://ai.semir.com/console/studio/demo',
    下载链接: '',
    所属AI纵队: '电商运营',
    所属部门: '数字中心 / 其他产研部 / 海外业务产研组',
    案例描述: '用于提升客服回复效率的案例',
    案例说明: '案例背景\n应用方式',
    案例开发者: '邢易成',
    涉及技能: 'WPS自动生成PPT',
    可复用岗位: '电商运营|客服',
    使用频次: '30',
    价值分类: '提效',
    原工时: '2',
    现工时: '0.5',
    亮点1描述: '处理效率提升',
    亮点1指标: '75%',
    对比1之前: '人工逐条回复',
    对比1之后: 'AI 自动生成回复',
    操作文档路径: '/Users/test/Desktop/manual.pdf',
    视频路径: '/Users/test/Desktop/demo.mp4',
    钉钉联系人: '15500000000',
    ...overrides,
  }
}

test('normalizes showcase rows with category, department, developer, skill, and payload fields', async () => {
  const helpers = await loadExports()
  const parsed = await helpers.normalizeShowcaseRows([validRow({ 操作文档路径: '', 视频路径: '' })], {
    catalogs: catalogs(),
    apiClient: apiClient(),
  })

  assert.equal(parsed.invalidRows.length, 0)
  assert.equal(parsed.jobs.length, 1)
  const job = parsed.jobs[0]
  assert.equal(job.categoryCode, 'PL6')
  assert.equal(job.aiTeam, '电商运营')
  assert.equal(job.dingDeptId, 3)
  assert.equal(job.dingDeptIdChain, '3,2,1')
  assert.deepEqual(plain(job.developerIds), ['xingyicheng'])
  assert.deepEqual(plain(job.skillIds), ['2058752504616763394'])
  assert.equal(job.instructionsHtml, '<p>案例背景</p><p>应用方式</p>')
  assert.deepEqual(plain(job.valueTypes), ['提效'])

  const payload = helpers.buildCasePayload({
    ...job,
    uploaded: {
      icon: 'https://cdn.example/cover.png',
      documents: [{ name: 'manual.pdf', url: 'https://cdn.example/manual.pdf' }],
      videos: [],
    },
  })
  assert.equal(payload.categoryCode, 'PL6')
  assert.equal(payload.status, 1)
  assert.equal(payload.efficiency.economizeTime, 1.5)
  assert.deepEqual(plain(payload.developerIds), ['xingyicheng'])
  assert.deepEqual(plain(payload.skillIds), ['2058752504616763394'])
  assert.equal(payload.icon, 'https://cdn.example/cover.png')
})

test('allows zero current hours for fully automated efficiency cases', async () => {
  const helpers = await loadExports()
  const parsed = await helpers.normalizeShowcaseRows([validRow({ 现工时: '0' })], {
    catalogs: catalogs(),
    apiClient: apiClient(),
  })

  assert.equal(parsed.invalidRows.length, 0)
  assert.equal(parsed.jobs.length, 1)

  const payload = helpers.buildCasePayload({
    ...parsed.jobs[0],
    uploaded: {
      icon: 'https://cdn.example/cover.png',
      documents: [],
      videos: [],
    },
  })
  assert.equal(payload.efficiency.currentTime, 0)
  assert.equal(payload.efficiency.economizeTime, 2)
})

test('plan phase returns preview rows and does not call save or upload', async () => {
  const calls = []
  async function fetchMock(url) {
    calls.push(String(url))
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
      input_file: { rows: [validRow({ 所属部门: '3' })] },
    },
    contextExtra: { fetch: fetchMock },
  })

  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].执行结果, '预检通过')
  assert.equal(calls.some(url => url.includes('case/save')), false)
  assert.equal(calls.some(url => url.includes('file/upload')), false)
})

test('live phase stops before execution when any row fails precheck', async () => {
  const helpers = await loadExports()
  const parsed = await helpers.normalizeShowcaseRows([
    validRow(),
    validRow({ 案例名称: '', 涉及技能: '不存在的技能' }),
  ], {
    catalogs: catalogs(),
    apiClient: apiClient(),
  })

  assert.equal(parsed.jobs.length, 1)
  assert.equal(parsed.invalidRows.length, 1)
  assert.match(parsed.invalidRows[0].备注, /案例名称必填|技能无法/)
})

test('prepare_row requests inject_files for the first local asset', async () => {
  const helpers = await loadExports()
  const parsed = await helpers.normalizeShowcaseRows([validRow({ 操作文档路径: '', 视频路径: '' })], {
    catalogs: catalogs(),
    apiClient: apiClient(),
  })
  const shared = helpers.buildRunShared(parsed.jobs, 600)

  const appended = []
  const document = {
    querySelector(selector) {
      return appended.find(item => item.id === selector.replace(/^#/, '')) || null
    },
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        style: {},
        attrs: {},
        setAttribute(key, value) { this.attrs[key] = value },
      }
    },
    body: {
      appendChild(input) {
        appended.push(input)
      },
    },
    documentElement: {
      appendChild(input) {
        appended.push(input)
      },
    },
  }

  const result = await runAdapter({
    phase: 'prepare_row',
    shared,
    contextExtra: { document },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'inject_files')
  assert.equal(result.meta.next_phase, 'after_upload_file')
  assert.equal(result.meta.items[0].selector, '#crawshrimp-dasen-upload-input')
  assert.deepEqual(plain(result.meta.items[0].files), ['/Users/test/Desktop/cover.png'])
  assert.equal(appended[0].id, 'crawshrimp-dasen-upload-input')
})

test('prepare_row reuses uploaded local asset cache before creating the next case', async () => {
  const helpers = await loadExports()
  const parsed = await helpers.normalizeShowcaseRows([validRow({
    操作文档路径: '',
    视频路径: '',
  })], {
    catalogs: catalogs(),
    apiClient: apiClient(),
  })
  const [uploadItem] = helpers.collectUploadQueue(parsed.jobs[0])
  const shared = {
    ...helpers.buildRunShared(parsed.jobs, 600),
    upload_cache: {
      [helpers.uploadCacheKey(uploadItem)]: {
        name: 'cover.png',
        url: 'https://cdn.example/cover.png',
      },
    },
  }

  const result = await runAdapter({
    phase: 'prepare_row',
    shared,
    contextExtra: {
      document: {
        querySelector: () => {
          throw new Error('should not request file injection for cached asset')
        },
      },
    },
  })

  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'create_case')
  assert.equal(result.meta.shared.jobs[0].uploaded.icon, 'https://cdn.example/cover.png')
})

test('resolveDepartment reports ambiguity for duplicate short names', async () => {
  const helpers = await loadExports()
  const result = helpers.resolveDepartment('海外业务产研组', [
    { id: '1', name: '海外业务产研组', path: 'A / 海外业务产研组', dingDeptIdChain: '1' },
    { id: '2', name: '海外业务产研组', path: 'B / 海外业务产研组', dingDeptIdChain: '2' },
  ])

  assert.match(result.error, /不唯一/)
})
