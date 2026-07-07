import { describe, expect, it } from 'vitest'
import worker from '../worker/index'
import { sha256Hex } from '../worker/security/tokens'

interface UserRow { id: number; email: string; name: string; status: string }
interface RoleRow { id: number; role_key: string; name: string }
interface UserRoleRow { user_id: number; role_id: number }
interface SessionRow { user_id: number; session_hash: string; expires_at: string; revoked_at: string | null }
interface BatchRow { id: number; batch_uid: string; status: string }
interface AssetRow { id: number; asset_uid: string; batch_uid: string; kind: string; status: string; prompt_template_version_id: number | null; parent_asset_uid: string | null }
interface PromptVersionRow { id: number; template_id: number; version_no: number; snapshot_json: string }
interface DispatchJobRow { id: number; job_uid: string; batch_uid: string; job_type: string; status: string; assigned_machine_id: string | null }
interface State {
  users: UserRow[]
  roles: RoleRow[]
  userRoles: UserRoleRow[]
  sessions: SessionRow[]
  batches: BatchRow[]
  assets: AssetRow[]
  promptVersions: PromptVersionRow[]
  dispatchJobs: DispatchJobRow[]
}

class FakeD1Statement {
  private params: unknown[] = []
  constructor(private readonly state: State, private readonly sql: string) {}
  bind(...params: unknown[]): FakeD1Statement {
    this.params = params
    return this
  }
  async first<T>(): Promise<T | null> {
    const sql = normalizeSql(this.sql)
    if (sql.includes('from sessions') && sql.includes('join users')) {
      const session = this.state.sessions.find((row) => row.session_hash === String(this.params[0]) && !row.revoked_at && row.expires_at > String(this.params[1]))
      return (session ? this.state.users.find((user) => user.id === session.user_id && user.status === 'active') ?? null : null) as T | null
    }
    return null
  }
  async all<T>(): Promise<{ results: T[] }> {
    const sql = normalizeSql(this.sql)
    if (sql.includes('from roles') && sql.includes('join user_roles')) {
      const userId = Number(this.params[0])
      return { results: this.state.userRoles.filter((row) => row.user_id === userId).map((row) => this.state.roles.find((role) => role.id === row.role_id)).filter(Boolean) as T[] }
    }
    if (sql.includes('from ai_image_batches')) return { results: this.state.batches as T[] }
    if (sql.includes('from ai_image_assets')) return { results: this.state.assets as T[] }
    if (sql.includes('from prompt_template_versions')) return { results: this.state.promptVersions as T[] }
    if (sql.includes('from dispatch_jobs')) return { results: this.state.dispatchJobs as T[] }
    return { results: [] }
  }
  async run(): Promise<D1Result> {
    return { success: true, meta: { changes: 1 } } as D1Result
  }
}

class FakeD1Database {
  constructor(private readonly state: State) {}
  prepare(sql: string): FakeD1Statement {
    return new FakeD1Statement(this.state, sql)
  }
}

function fakeEnv(state: State) {
  return { DB: new FakeD1Database(state) as unknown as D1Database, ASSETS: {} as R2Bucket, SESSION_TTL_SECONDS: '604800' }
}

function fetchWorker(request: Request, env: ReturnType<typeof fakeEnv>): Promise<Response> {
  return (worker.fetch as unknown as (request: Request, env: ReturnType<typeof fakeEnv>) => Promise<Response>)(request, env)
}

describe('dashboard routes', () => {
  it('returns batch status totals and image funnel counts', async () => {
    const { state, viewerCookie } = await baseState()
    const response = await fetchWorker(new Request('https://example.test/api/dashboard/summary', { headers: { cookie: viewerCookie } }), fakeEnv(state))
    const body = await response.json() as { batch_totals_by_status: Record<string, number>; image_funnel: Record<string, number> }
    expect(response.status).toBe(200)
    expect(body.batch_totals_by_status).toEqual({ pending_review: 1, ready_to_submit: 2 })
    expect(body.image_funnel).toEqual({ generated: 6, approved: 3, rejected: 1, regenerated: 1, submitted: 2 })
  })

  it('returns prompt template approval rates', async () => {
    const { state, viewerCookie } = await baseState()
    const response = await fetchWorker(new Request('https://example.test/api/dashboard/prompt-performance', { headers: { cookie: viewerCookie } }), fakeEnv(state))
    const body = await response.json() as { prompt_templates: Array<{ template_id: number; generated: number; approved: number; approval_rate: number }> }
    expect(response.status).toBe(200)
    expect(body.prompt_templates).toEqual([
      { template_id: 10, version_id: 100, generated: 4, approved: 3, rejected: 1, approval_rate: 0.75 },
      { template_id: 11, version_id: 101, generated: 2, approved: 0, rejected: 0, approval_rate: 0 },
    ])
  })

  it('returns machine success and failure counts from dispatch jobs', async () => {
    const { state, viewerCookie } = await baseState()
    const response = await fetchWorker(new Request('https://example.test/api/dashboard/machine-performance', { headers: { cookie: viewerCookie } }), fakeEnv(state))
    const body = await response.json() as { machines: Array<{ machine_id: string; succeeded: number; failed: number }> }
    expect(response.status).toBe(200)
    expect(body.machines).toEqual([
      { machine_id: 'machine-1', succeeded: 2, failed: 1 },
      { machine_id: 'machine-2', succeeded: 1, failed: 2 },
    ])
  })
})

async function baseState(): Promise<{ state: State; viewerCookie: string }> {
  const viewerSession = 'sess_dashboard_viewer'
  const state: State = {
    users: [{ id: 1, email: 'viewer@example.com', name: 'Viewer', status: 'active' }],
    roles: [{ id: 1, role_key: 'viewer', name: 'Viewer' }],
    userRoles: [{ user_id: 1, role_id: 1 }],
    sessions: [{ user_id: 1, session_hash: await sha256Hex(viewerSession), expires_at: '2999-01-01T00:00:00.000Z', revoked_at: null }],
    batches: [
      { id: 1, batch_uid: 'batch-1', status: 'pending_review' },
      { id: 2, batch_uid: 'batch-2', status: 'ready_to_submit' },
      { id: 3, batch_uid: 'batch-3', status: 'ready_to_submit' },
    ],
    assets: [
      asset(1, 'ai-1', 'batch-1', 'approved', 100, null),
      asset(2, 'ai-2', 'batch-1', 'approved', 100, 'ai-old-2'),
      asset(3, 'ai-3', 'batch-1', 'rejected', 100, null),
      asset(4, 'ai-4', 'batch-2', 'approved', 100, null),
      asset(5, 'ai-5', 'batch-2', 'submitted', 101, null),
      asset(6, 'ai-6', 'batch-3', 'submitted', 101, null),
    ],
    promptVersions: [
      { id: 100, template_id: 10, version_no: 1, snapshot_json: '{}' },
      { id: 101, template_id: 11, version_no: 1, snapshot_json: '{}' },
    ],
    dispatchJobs: [
      job(1, 'job-1', 'machine-1', 'succeeded'),
      job(2, 'job-2', 'machine-1', 'succeeded'),
      job(3, 'job-3', 'machine-1', 'terminal_failed'),
      job(4, 'job-4', 'machine-2', 'succeeded'),
      job(5, 'job-5', 'machine-2', 'retryable_failed'),
      job(6, 'job-6', 'machine-2', 'terminal_failed'),
    ],
  }
  return { state, viewerCookie: `cs_session=${viewerSession}` }
}

function asset(id: number, assetUid: string, batchUid: string, status: string, versionId: number, parentAssetUid: string | null): AssetRow {
  return { id, asset_uid: assetUid, batch_uid: batchUid, kind: 'ai', status, prompt_template_version_id: versionId, parent_asset_uid: parentAssetUid }
}

function job(id: number, jobUid: string, machineId: string, status: string): DispatchJobRow {
  return { id, job_uid: jobUid, batch_uid: 'batch-1', job_type: 'submit_tmall_material_test', status, assigned_machine_id: machineId }
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase()
}
