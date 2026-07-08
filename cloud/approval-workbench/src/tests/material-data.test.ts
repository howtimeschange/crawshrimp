import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { parseMaterialTestWorkbookData, percentToDecimal } from '../app/materialDataImport'
import {
  createMaterialTestSchedule,
  createMaterialTestCrawlJob,
  dispatchDueMaterialTestSchedules,
  getMaterialTestSummary,
  importMaterialTestData,
  listMaterialTestImages,
} from '../worker/material-data-routes'
import { sha256Hex } from '../worker/security/tokens'

interface State {
  users: Array<{ id: number; email: string; name: string; status: string }>
  roles: Array<{ id: number; role_key: string; name: string }>
  userRoles: Array<{ user_id: number; role_id: number }>
  sessions: Array<{ user_id: number; session_hash: string; expires_at: string; revoked_at: string | null }>
  overviewRows: Record<string, unknown>[]
  detailRows: Record<string, unknown>[]
  jobs: Record<string, unknown>[]
  schedules: Record<string, unknown>[]
  machines: Array<{ machine_id: string; auth_status: string; capabilities_json: string }>
  batchCalls: number[]
  runCalls: number
}

class FakeD1Statement {
  private params: unknown[] = []
  constructor(private readonly state: State, private readonly sql: string) {}
  bind(...params: unknown[]) {
    this.params = params
    return this
  }
  async first<T>(): Promise<T | null> {
    const sql = normalizeSql(this.sql)
    if (sql.includes('from machine_tokens') && sql.includes('join task_machines')) {
      return {
        id: 1,
        machine_id: 'machine-1',
        machine_name: 'machine',
        owner_user_id: null,
        app_version: 'test',
        fingerprint_hash: 'fp',
        capabilities_json: JSON.stringify(['crawl_tmall_material_test_data']),
        auth_status: 'active',
        health: 'online_idle',
        current_job_id: null,
        last_seen_at: null,
        registered_at: '2026-07-08T00:00:00.000Z',
        updated_at: '2026-07-08T00:00:00.000Z',
        token_hash: String(this.params[0] || ''),
      } as T
    }
    if (sql.includes('from sessions') && sql.includes('join users')) {
      const session = this.state.sessions.find((row) => row.session_hash === String(this.params[0]) && !row.revoked_at)
      return (session ? this.state.users.find((user) => user.id === session.user_id) ?? null : null) as T | null
    }
    if (sql.includes('from material_test_image_metrics') && sql.includes('count(distinct item_id)')) {
      const detail = this.state.detailRows
      const exposure = sum(detail, 'search_impressions')
      return {
        total_items: new Set(detail.map((row) => row.item_id)).size,
        total_materials: new Set(detail.map((row) => `${row.material_id}|${row.material_url}`)).size,
        total_search_exposure: exposure,
        total_search_clicks: sum(detail, 'search_clicks'),
      } as T
    }
    if (sql.includes('from material_test_task_overviews') && sql.includes('best_image_count')) {
      return { best_image_count: this.state.overviewRows.filter((row) => String(row.best_material || '')).length } as T
    }
    if (sql.includes('from material_test_image_metrics') && sql.includes('order by imported_at desc')) {
      const latest = this.state.detailRows.at(-1)
      return (latest ? { source_filename: latest.source_filename, imported_at: latest.imported_at } : null) as T | null
    }
    if (sql.includes('from dispatch_jobs') && sql.includes('where job_uid')) {
      return (this.state.jobs.find((job) => job.job_uid === this.params[0]) ?? null) as T | null
    }
    if (sql.includes('from dispatch_jobs') && sql.includes('idempotency_key')) {
      return (this.state.jobs.find((job) => job.job_type === 'crawl_tmall_material_test_data' && job.idempotency_key === this.params[0]) ?? null) as T | null
    }
    if (sql.includes('from material_test_crawl_schedules') && sql.includes('where schedule_uid')) {
      return (this.state.schedules.find((schedule) => schedule.schedule_uid === this.params[0]) ?? null) as T | null
    }
    if (sql.includes('from task_machines')) {
      return (this.state.machines.find((machine) => machine.machine_id === String(this.params[0])) ?? null) as T | null
    }
    return null
  }
  async all<T>(): Promise<{ results: T[] }> {
    const sql = normalizeSql(this.sql)
    if (sql.includes('from roles') && sql.includes('join user_roles')) {
      const userId = Number(this.params[0])
      return { results: this.state.userRoles.filter((row) => row.user_id === userId).map((row) => this.state.roles.find((role) => role.id === row.role_id)).filter(Boolean) as T[] }
    }
    if (sql.includes('from material_test_image_metrics')) {
      let rows = [...this.state.detailRows]
      const statisticType = filterValueFor(sql, 'statistic_type', this.params)
      const statisticDate = filterValueFor(sql, 'statistic_date', this.params)
      const imageType = filterValueFor(sql, 'image_type', this.params)
      if (statisticType) rows = rows.filter((row) => row.statistic_type === statisticType)
      if (statisticDate) rows = rows.filter((row) => row.statistic_date === statisticDate)
      if (imageType) rows = rows.filter((row) => row.image_type === imageType)
      return { results: rows as T[] }
    }
    if (sql.includes('from material_test_crawl_schedules')) {
      return { results: this.state.schedules.filter((row) => row.status === 'active') as T[] }
    }
    return { results: [] }
  }
  async run(): Promise<D1Result> {
    this.state.runCalls += 1
    return this.execute()
  }
  async execute(): Promise<D1Result> {
    const sql = normalizeSql(this.sql)
    if (sql.startsWith('insert into material_test_task_overviews')) {
      this.state.overviewRows.push({
        item_id: this.params[5],
        task_id: this.params[7],
        statistic_type: this.params[11],
        best_material: this.params[12],
        source_filename: this.params[1],
        imported_at: this.params[15],
      })
    } else if (sql.startsWith('insert into material_test_image_metrics')) {
      this.state.detailRows.push({
        id: this.state.detailRows.length + 1,
        style_code: this.params[4],
        item_id: this.params[5],
        task_id: this.params[7],
        statistic_type: this.params[11],
        statistic_date: this.params[12],
        image_type: this.params[13],
        material_id: this.params[14],
        material_url: this.params[17],
        search_impressions: this.params[18],
        search_clicks: this.params[19],
        search_ctr: this.params[20],
        detail_clicks: this.params[22],
        detail_add_to_cart: this.params[24],
        detail_pay_conversion_rate: this.params[26],
        source_filename: this.params[1],
        imported_at: this.params[30],
      })
    } else if (sql.startsWith('insert into dispatch_jobs')) {
      if (!this.state.jobs.some((job) => job.job_type === this.params[2] && job.idempotency_key === this.params[9])) this.state.jobs.push({
        id: this.state.jobs.length + 1,
        job_uid: this.params[0],
        batch_uid: this.params[1],
        job_type: this.params[2],
        status: this.params[3],
        requested_by: this.params[4],
        assigned_machine_id: this.params[5],
        required_capabilities_json: this.params[6],
        priority: this.params[7],
        attempt_count: 0,
        max_attempts: this.params[8],
        idempotency_key: this.params[9],
        lease_id: null,
        lease_expires_at: null,
        payload_json: this.params[10],
        result_json: '{}',
        created_at: this.params[11],
        updated_at: this.params[12],
      })
    } else if (sql.startsWith('insert into material_test_crawl_schedules')) {
      this.state.schedules.push({
        schedule_uid: this.params[0],
        label: this.params[1],
        statistic_type: this.params[2],
        schedule_time: this.params[3],
        timezone: this.params[4],
        status: this.params[5],
        target_machine_id: this.params[6],
        payload_json: this.params[7],
        created_by: this.params[8],
      })
    }
    return { success: true, meta: { changes: 1 } } as D1Result
  }
}

class FakeD1Database {
  constructor(private readonly state: State) {}
  prepare(sql: string): FakeD1Statement {
    return new FakeD1Statement(this.state, sql)
  }
  async batch(statements: FakeD1Statement[]): Promise<D1Result[]> {
    this.state.batchCalls.push(statements.length)
    return Promise.all(statements.map((statement) => statement.execute()))
  }
}

describe('material test data import', () => {
  it('parses the real workbook headers and percent strings', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
      { 记录类型: '概览', 表格行号: 2, 款号: '208326', 商品ID: '1001', 商品标题: 'title', 任务ID: 'T1', 测试状态: '完成', 测试渠道: '搜索', 测试素材数: 2, 最优素材: 'M1', 执行结果: '成功', 备注: '' },
    ]), '概览')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
      { 记录类型: '明细', 表格行号: 2, 款号: '208326', 商品ID: '1001', 商品标题: 'title', 任务ID: 'T1', 测试状态: '完成', 测试渠道: '搜索', 测试素材数: 2, 统计口径: 'ACCUMULATE_30_DAYS', 统计日期: '2026-07-01', 图片类型: '主图', 素材ID: 'M1', 素材比例: '1:1', 素材占比: '7.79%', 素材URL: 'https://img.test/1.jpg', 搜索曝光: '1,000', 搜索点击: 77, 搜索点击率: '7.79%', 详情曝光: 500, 详情点击: 40, 详情点击率: '8%', 详情加购: 12, 详情支付转化: 3, 详情支付转化率: '2.50%', 数据下载链接: '', 执行结果: '成功', 备注: '' },
    ]), '明细')

    const parsed = parseMaterialTestWorkbookData(workbook, 'export.xlsx')

    expect(percentToDecimal('7.79%')).toBeCloseTo(0.0779)
    expect(parsed.overview_rows).toHaveLength(1)
    expect(parsed.detail_rows[0].statistic_date).toBe('20260701')
    expect(parsed.detail_rows[0].search_ctr).toBeCloseTo(0.0779)
    expect(parsed.detail_rows[0].detail_pay_conversion_rate).toBeCloseTo(0.025)
  })

  it('imports rows in bounded D1 batches, returns summary, lists images, and creates crawl jobs', async () => {
    const state = await baseState()
    state.jobs.push(jobRow({ job_uid: 'job-import', assigned_machine_id: 'machine-1', lease_id: 'lease-import', status: 'running' }))
    const env = { DB: new FakeD1Database(state) as unknown as D1Database, ASSETS: {} as R2Bucket, SESSION_TTL_SECONDS: '604800' }
    const detailRows = Array.from({ length: 1001 }, (_, index) => ({
      style_code: '208326',
      item_id: `100${index}`,
      task_id: 'T1',
      statistic_type: 'ACCUMULATE_30_DAYS',
      statistic_date: '20260630',
      image_type: '主图',
      material_id: `M${index}`,
      material_url: `https://img.test/${index}.jpg`,
      search_impressions: 1000,
      search_clicks: 77,
      search_ctr: 0.077,
      detail_clicks: 40,
      detail_add_to_cart: 12,
      detail_pay_conversion_rate: 0.025,
    }))
    const importResponse = await importMaterialTestData(new Request('https://example.test/api/material-test/import', {
      method: 'POST',
      headers: { authorization: 'Bearer machine-secret' },
      body: JSON.stringify({
        job_uid: 'job-import',
        lease_id: 'lease-import',
        source: { filename: 'export.xlsx' },
        overview_rows: [{ style_code: '208326', item_id: '1001', task_id: 'T1', statistic_type: 'ACCUMULATE_30_DAYS', best_material: 'M1' }],
        detail_rows: detailRows,
      }),
    }), env)
    expect(importResponse.status).toBe(200)
    expect(await importResponse.json()).toMatchObject({ overview_rows: 1, detail_rows: 1001 })
    expect(state.batchCalls).toEqual([1, 500, 500, 1])
    expect(state.runCalls).toBeLessThan(10)

    const summary = await getMaterialTestSummary(new Request('https://example.test/api/material-test/summary', { headers: { cookie: 'cs_session=sess_material' } }), env)
    expect(summary.status).toBe(200)
    expect(await summary.json()).toMatchObject({ total_items: 1001, total_materials: 1001, total_search_exposure: 1001000, weighted_search_ctr: 0.077, best_image_count: 1 })

    const images = await listMaterialTestImages(new Request('https://example.test/api/material-test/images', { headers: { cookie: 'cs_session=sess_material' } }), env)
    expect((await images.json() as { images: unknown[] }).images).toHaveLength(1001)
    const dateFilteredImages = await listMaterialTestImages(new Request('https://example.test/api/material-test/images?date=2026-06-30', { headers: { cookie: 'cs_session=sess_material' } }), env)
    expect((await dateFilteredImages.json() as { images: unknown[] }).images).toHaveLength(1001)

    const crawl = await createMaterialTestCrawlJob(new Request('https://example.test/api/material-test/crawl-jobs', {
      method: 'POST',
      headers: { cookie: 'cs_session=sess_material' },
      body: JSON.stringify({ idempotency_key: 'crawl:test' }),
    }), env)
    expect(crawl.status).toBe(201)
    expect(state.jobs.find((job) => job.status === 'queued')).toMatchObject({ batch_uid: 'material-test', job_type: 'crawl_tmall_material_test_data' })
  })

  it('rejects machine imports without a matching active crawl lease', async () => {
    const state = await baseState()
    const env = { DB: new FakeD1Database(state) as unknown as D1Database, ASSETS: {} as R2Bucket, SESSION_TTL_SECONDS: '604800' }
    const missingLease = await importMaterialTestData(new Request('https://example.test/api/material-test/import', {
      method: 'POST',
      headers: { authorization: 'Bearer machine-secret' },
      body: JSON.stringify({ source: { filename: 'export.xlsx' }, overview_rows: [], detail_rows: [] }),
    }), env)
    expect(missingLease.status).toBe(400)

    state.jobs.push(jobRow({ job_uid: 'job-submit', job_type: 'submit_tmall_material_test', assigned_machine_id: 'machine-1', lease_id: 'lease-submit', status: 'running' }))
    const wrongType = await importMaterialTestData(new Request('https://example.test/api/material-test/import', {
      method: 'POST',
      headers: { authorization: 'Bearer machine-secret' },
      body: JSON.stringify({ job_uid: 'job-submit', lease_id: 'lease-submit', source: { filename: 'export.xlsx' }, overview_rows: [], detail_rows: [] }),
    }), env)
    expect(wrongType.status).toBe(403)
  })

  it('creates distinct immediate crawl jobs unless an explicit idempotency key is supplied', async () => {
    const state = await baseState()
    const env = { DB: new FakeD1Database(state) as unknown as D1Database, ASSETS: {} as R2Bucket, SESSION_TTL_SECONDS: '604800' }
    const requestBody = { machine_id: 'machine-1', run_params: { statistic_type: 'ACCUMULATE_30_DAYS' } }
    const first = await createMaterialTestCrawlJob(new Request('https://example.test/api/material-test/crawl-jobs', {
      method: 'POST',
      headers: { cookie: 'cs_session=sess_material' },
      body: JSON.stringify(requestBody),
    }), env)
    const second = await createMaterialTestCrawlJob(new Request('https://example.test/api/material-test/crawl-jobs', {
      method: 'POST',
      headers: { cookie: 'cs_session=sess_material' },
      body: JSON.stringify(requestBody),
    }), env)
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(state.jobs.filter((job) => job.status === 'queued')).toHaveLength(2)

    const explicitA = await createMaterialTestCrawlJob(new Request('https://example.test/api/material-test/crawl-jobs', {
      method: 'POST',
      headers: { cookie: 'cs_session=sess_material' },
      body: JSON.stringify({ ...requestBody, idempotency_key: 'crawl:dedupe' }),
    }), env)
    const explicitB = await createMaterialTestCrawlJob(new Request('https://example.test/api/material-test/crawl-jobs', {
      method: 'POST',
      headers: { cookie: 'cs_session=sess_material' },
      body: JSON.stringify({ ...requestBody, idempotency_key: 'crawl:dedupe' }),
    }), env)
    expect(explicitA.status).toBe(201)
    expect(explicitB.status).toBe(200)
    expect(state.jobs.filter((job) => job.idempotency_key === 'crawl:dedupe')).toHaveLength(1)
  })

  it('validates schedule time and dispatches due schedule occurrences once per bucket', async () => {
    const state = await baseState()
    const env = { DB: new FakeD1Database(state) as unknown as D1Database, ASSETS: {} as R2Bucket, SESSION_TTL_SECONDS: '604800' }
    const invalid = await createMaterialTestSchedule(new Request('https://example.test/api/material-test/schedules', {
      method: 'POST',
      headers: { cookie: 'cs_session=sess_material' },
      body: JSON.stringify({ schedule_time: '24:60' }),
    }), env)
    expect(invalid.status).toBe(400)
    const invalidStatus = await createMaterialTestSchedule(new Request('https://example.test/api/material-test/schedules', {
      method: 'POST',
      headers: { cookie: 'cs_session=sess_material' },
      body: JSON.stringify({ schedule_time: '09:30', status: 'pending' }),
    }), env)
    expect(invalidStatus.status).toBe(400)
    const invalidTimezone = await createMaterialTestSchedule(new Request('https://example.test/api/material-test/schedules', {
      method: 'POST',
      headers: { cookie: 'cs_session=sess_material' },
      body: JSON.stringify({ schedule_time: '09:30', timezone: 'Mars/Base' }),
    }), env)
    expect(invalidTimezone.status).toBe(400)

    const valid = await createMaterialTestSchedule(new Request('https://example.test/api/material-test/schedules', {
      method: 'POST',
      headers: { cookie: 'cs_session=sess_material' },
      body: JSON.stringify({ schedule_uid: 'sched-1', schedule_time: '09:30', machine_id: 'machine-1', payload: { page_size: 50 } }),
    }), env)
    expect(valid.status).toBe(201)
    const first = await dispatchDueMaterialTestSchedules(env, new Date('2026-07-08T01:30:00.000Z'))
    const second = await dispatchDueMaterialTestSchedules(env, new Date('2026-07-08T01:35:00.000Z'))
    expect(first).toEqual({ checked: 1, enqueued: 1 })
    expect(second).toEqual({ checked: 1, enqueued: 0 })
    const queued = state.jobs.find((job) => String(job.idempotency_key).includes('schedule:sched-1:2026-07-08:09:30'))
    expect(queued).toMatchObject({ assigned_machine_id: 'machine-1', job_type: 'crawl_tmall_material_test_data' })
  })

  it('rejects schedules for inactive machines or machines without material crawl capability', async () => {
    const state = await baseState()
    state.machines.push({ machine_id: 'machine-paused', auth_status: 'paused', capabilities_json: JSON.stringify(['crawl_tmall_material_test_data']) })
    state.machines.push({ machine_id: 'machine-submit', auth_status: 'active', capabilities_json: JSON.stringify(['submit_tmall_material_test']) })
    const env = { DB: new FakeD1Database(state) as unknown as D1Database, ASSETS: {} as R2Bucket, SESSION_TTL_SECONDS: '604800' }

    const inactive = await createMaterialTestSchedule(new Request('https://example.test/api/material-test/schedules', {
      method: 'POST',
      headers: { cookie: 'cs_session=sess_material' },
      body: JSON.stringify({ schedule_time: '09:30', machine_id: 'machine-paused' }),
    }), env)
    const incapable = await createMaterialTestSchedule(new Request('https://example.test/api/material-test/schedules', {
      method: 'POST',
      headers: { cookie: 'cs_session=sess_material' },
      body: JSON.stringify({ schedule_time: '09:30', machine_id: 'machine-submit' }),
    }), env)

    expect(inactive.status).toBe(400)
    expect(incapable.status).toBe(400)
    expect(state.schedules).toHaveLength(0)
  })
})

async function baseState(): Promise<State> {
  const plain = 'sess_material'
  const hash = await sha256Hex(plain)
  return {
    users: [{ id: 1, email: 'admin@example.com', name: 'Admin', status: 'active' }],
    roles: [{ id: 1, role_key: 'admin', name: 'Admin' }],
    userRoles: [{ user_id: 1, role_id: 1 }],
    sessions: [{ user_id: 1, session_hash: hash, expires_at: '2999-01-01T00:00:00.000Z', revoked_at: null }],
    overviewRows: [],
    detailRows: [],
    jobs: [],
    schedules: [],
    machines: [{ machine_id: 'machine-1', auth_status: 'active', capabilities_json: JSON.stringify(['crawl_tmall_material_test_data']) }],
    batchCalls: [],
    runCalls: 0,
  }
}

function jobRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    job_uid: 'job-import',
    batch_uid: 'material-test',
    job_type: 'crawl_tmall_material_test_data',
    status: 'running',
    requested_by: 1,
    assigned_machine_id: 'machine-1',
    required_capabilities_json: JSON.stringify(['crawl_tmall_material_test_data']),
    priority: 60,
    attempt_count: 0,
    max_attempts: 1,
    idempotency_key: 'import-key',
    lease_id: 'lease-import',
    lease_expires_at: '2999-01-01T00:00:00.000Z',
    payload_json: '{}',
    result_json: '{}',
    created_at: '2026-07-08T00:00:00.000Z',
    updated_at: '2026-07-08T00:00:00.000Z',
    ...overrides,
  }
}

function sum(rows: Record<string, unknown>[], field: string): number {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0)
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase()
}

function filterValueFor(sql: string, field: string, params: unknown[]): string {
  const fields = ['statistic_type', 'statistic_date', 'image_type'].filter((candidate) => sql.includes(`${candidate} = ?`))
  const index = fields.indexOf(field)
  return index >= 0 ? String(params[index] || '') : ''
}
