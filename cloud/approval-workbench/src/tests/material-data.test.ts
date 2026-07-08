import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { parseMaterialTestWorkbookData, percentToDecimal } from '../app/materialDataImport'
import {
  createMaterialTestCrawlJob,
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
    if (sql.includes('from dispatch_jobs')) {
      return (this.state.jobs.find((job) => job.job_type === 'crawl_tmall_material_test_data' && job.idempotency_key === this.params[0]) ?? null) as T | null
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
      return { results: this.state.detailRows as T[] }
    }
    return { results: [] }
  }
  async run(): Promise<D1Result> {
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
      this.state.jobs.push({
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
    }
    return { success: true, meta: { changes: 1 } } as D1Result
  }
}

class FakeD1Database {
  constructor(private readonly state: State) {}
  prepare(sql: string): FakeD1Statement {
    return new FakeD1Statement(this.state, sql)
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
    expect(parsed.detail_rows[0].search_ctr).toBeCloseTo(0.0779)
    expect(parsed.detail_rows[0].detail_pay_conversion_rate).toBeCloseTo(0.025)
  })

  it('imports rows, returns summary, lists images, and creates crawl jobs', async () => {
    const state = await baseState()
    const env = { DB: new FakeD1Database(state) as unknown as D1Database, ASSETS: {} as R2Bucket, SESSION_TTL_SECONDS: '604800' }
    const importResponse = await importMaterialTestData(new Request('https://example.test/api/material-test/import', {
      method: 'POST',
      headers: { authorization: 'Bearer machine-secret' },
      body: JSON.stringify({
        source: { filename: 'export.xlsx' },
        overview_rows: [{ style_code: '208326', item_id: '1001', task_id: 'T1', statistic_type: 'ACCUMULATE_30_DAYS', best_material: 'M1' }],
        detail_rows: [{ style_code: '208326', item_id: '1001', task_id: 'T1', statistic_type: 'ACCUMULATE_30_DAYS', statistic_date: '2026-07-01', image_type: '主图', material_id: 'M1', material_url: 'https://img.test/1.jpg', search_impressions: 1000, search_clicks: 77, search_ctr: 0.077, detail_clicks: 40, detail_add_to_cart: 12, detail_pay_conversion_rate: 0.025 }],
      }),
    }), env)
    expect(importResponse.status).toBe(200)
    expect(await importResponse.json()).toMatchObject({ overview_rows: 1, detail_rows: 1 })

    const summary = await getMaterialTestSummary(new Request('https://example.test/api/material-test/summary', { headers: { cookie: 'cs_session=sess_material' } }), env)
    expect(summary.status).toBe(200)
    expect(await summary.json()).toMatchObject({ total_items: 1, total_materials: 1, total_search_exposure: 1000, weighted_search_ctr: 0.077, best_image_count: 1 })

    const images = await listMaterialTestImages(new Request('https://example.test/api/material-test/images', { headers: { cookie: 'cs_session=sess_material' } }), env)
    expect((await images.json() as { images: unknown[] }).images).toHaveLength(1)

    const crawl = await createMaterialTestCrawlJob(new Request('https://example.test/api/material-test/crawl-jobs', {
      method: 'POST',
      headers: { cookie: 'cs_session=sess_material' },
      body: JSON.stringify({ idempotency_key: 'crawl:test' }),
    }), env)
    expect(crawl.status).toBe(201)
    expect(state.jobs[0]).toMatchObject({ batch_uid: 'material-test', job_type: 'crawl_tmall_material_test_data', status: 'queued' })
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
  }
}

function sum(rows: Record<string, unknown>[], field: string): number {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0)
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase()
}
