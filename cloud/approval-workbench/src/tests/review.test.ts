import { describe, expect, it } from 'vitest'
import worker from '../worker/index'
import { sha256Hex } from '../worker/security/tokens'

interface UserRow { id: number; email: string; name: string; status: string }
interface RoleRow { id: number; role_key: string; name: string }
interface UserRoleRow { user_id: number; role_id: number }
interface SessionRow { user_id: number; session_hash: string; expires_at: string; revoked_at: string | null }
interface MachineRow {
  id: number
  machine_id: string
  machine_name: string
  owner_user_id: number | null
  app_version: string
  fingerprint_hash: string
  capabilities_json: string
  auth_status: string
  health: string
  current_job_id: string | null
  last_seen_at: string | null
  registered_at: string
  updated_at: string
}
interface BatchRow {
  id: number
  batch_uid: string
  local_instance_uid: string
  local_run_id: string
  title: string
  status: string
  prompt_library_id: number | null
  prompt_version_set_json: string
  source_machine_id: string | null
  created_by: number | null
  created_at: string
  updated_at: string
}
interface StyleRow {
  id: number
  batch_uid: string
  style_code: string
  item_id: string
  skc_code: string
  category: string
  gender: string
  status: string
  missing_prompt_reason: string
  source_summary_json: string
  review_summary_json: string
  submit_summary_json: string
}
interface AssetRow {
  id: number
  asset_uid: string
  batch_uid: string
  style_id: number
  kind: string
  status: string
  object_key: string
  filename: string
  content_hash: string
  prompt_template_version_id: number | null
  prompt_text: string
  parent_asset_uid: string | null
  generation_job_id: string | null
  meta_json: string
  created_at: string
  updated_at: string
}
interface ApprovalEventRow { id: number; batch_uid: string; style_id: number | null; asset_uid: string | null; event_type: string; actor: string; payload_json: string; created_at: string }
interface DispatchJobRow {
  id: number
  job_uid: string
  batch_uid: string
  job_type: string
  status: string
  requested_by: number | null
  assigned_machine_id: string | null
  required_capabilities_json: string
  priority: number
  attempt_count: number
  max_attempts: number
  idempotency_key: string
  lease_id: string | null
  lease_expires_at: string | null
  payload_json: string
  result_json: string
  created_at: string
  updated_at: string
}
interface GenerationRequestRow {
  id: number
  request_uid: string
  batch_uid: string
  style_id: number
  source_asset_uid: string
  reference_asset_uids_json: string
  prompt_template_version_id: number | null
  prompt_text: string
  status: string
  dispatch_job_uid: string
  created_by: number | null
  created_at: string
  updated_at: string
}
interface State {
  users: UserRow[]
  roles: RoleRow[]
  userRoles: UserRoleRow[]
  sessions: SessionRow[]
  machines: MachineRow[]
  batches: BatchRow[]
  styles: StyleRow[]
  assets: AssetRow[]
  approvalEvents: ApprovalEventRow[]
  dispatchJobs: DispatchJobRow[]
  generationRequests: GenerationRequestRow[]
  audits: Array<{ action: string; payload_json: string }>
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
    if (sql.includes('from ai_image_batches') && sql.includes('where batch_uid = ?')) return (this.state.batches.find((row) => row.batch_uid === String(this.params[0])) ?? null) as T | null
    if (sql.includes('from ai_image_styles') && sql.includes('where id = ? and batch_uid = ?')) return (this.state.styles.find((row) => row.id === Number(this.params[0]) && row.batch_uid === String(this.params[1])) ?? null) as T | null
    if (sql.includes('from ai_image_assets') && sql.includes('where asset_uid = ?')) return (this.state.assets.find((row) => row.asset_uid === String(this.params[0])) ?? null) as T | null
    if (sql.includes('from task_machines') && sql.includes('where machine_id = ?')) return (this.state.machines.find((row) => row.machine_id === String(this.params[0])) ?? null) as T | null
    if (sql.includes('from dispatch_jobs') && sql.includes('where job_type = ? and idempotency_key = ?')) return (this.state.dispatchJobs.find((row) => row.job_type === String(this.params[0]) && row.idempotency_key === String(this.params[1])) ?? null) as T | null
    if (sql.includes('from dispatch_jobs') && sql.includes("job_type = 'submit_tmall_material_test'")) {
      const batchUid = String(this.params[0])
      const active = this.state.dispatchJobs.find((row) => row.batch_uid === batchUid && row.job_type === 'submit_tmall_material_test' && ['queued', 'leased', 'running', 'uploading_results', 'cancel_requested'].includes(row.status))
      return (active ? { id: active.id } : null) as T | null
    }
    return null
  }
  async all<T>(): Promise<{ results: T[] }> {
    const sql = normalizeSql(this.sql)
    if (sql.includes('from roles') && sql.includes('join user_roles')) {
      const userId = Number(this.params[0])
      return { results: this.state.userRoles.filter((row) => row.user_id === userId).map((row) => this.state.roles.find((role) => role.id === row.role_id)).filter(Boolean) as T[] }
    }
    if (sql.includes('from ai_image_styles')) return { results: this.state.styles.filter((row) => row.batch_uid === String(this.params[0])) as T[] }
    if (sql.includes('from ai_image_assets')) return { results: this.state.assets.filter((row) => row.batch_uid === String(this.params[0])) as T[] }
    if (sql.includes('from approval_events')) return { results: this.state.approvalEvents.filter((row) => row.batch_uid === String(this.params[0])) as T[] }
    if (sql.includes('from dispatch_jobs') && sql.includes('batch_uid = ?')) return { results: this.state.dispatchJobs.filter((row) => row.batch_uid === String(this.params[0])) as T[] }
    return { results: [] }
  }
  async run(): Promise<D1Result> {
    const sql = normalizeSql(this.sql)
    if (sql.startsWith('update ai_image_assets set status')) {
      const asset = this.state.assets.find((row) => row.asset_uid === String(this.params[2]) && row.batch_uid === String(this.params[3]) && row.kind === 'ai')
      if (!asset) return result(0)
      asset.status = String(this.params[0])
      asset.updated_at = String(this.params[1])
      return result(1)
    }
    if (sql.startsWith('update ai_image_styles set status')) {
      const style = this.state.styles.find((row) => row.id === Number(this.params[2]) && row.batch_uid === String(this.params[3]))
      if (!style) return result(0)
      style.status = String(this.params[0])
      style.review_summary_json = String(this.params[1])
      return result(1)
    }
    if (sql.startsWith('update ai_image_batches set status')) {
      const batch = this.state.batches.find((row) => row.batch_uid === String(this.params[2]))
      if (!batch) return result(0)
      batch.status = String(this.params[0])
      batch.updated_at = String(this.params[1])
      return result(1)
    }
    if (sql.startsWith('insert into ai_image_assets')) {
      const assetUid = String(this.params[0])
      const existing = this.state.assets.find((row) => row.asset_uid === assetUid)
      if (existing) {
        existing.batch_uid = String(this.params[1])
        existing.style_id = Number(this.params[2])
        existing.kind = String(this.params[3])
        existing.status = String(this.params[4])
        existing.object_key = String(this.params[5])
        existing.filename = String(this.params[6])
        existing.content_hash = String(this.params[7])
        existing.prompt_template_version_id = numberOrNull(this.params[8])
        existing.prompt_text = String(this.params[9])
        existing.parent_asset_uid = stringOrNull(this.params[10])
        existing.generation_job_id = stringOrNull(this.params[11])
        existing.meta_json = String(this.params[12])
        existing.updated_at = String(this.params[14])
        return result(1, existing.id)
      }
      const id = this.state.assets.length + 1
      this.state.assets.push({
        id,
        asset_uid: assetUid,
        batch_uid: String(this.params[1]),
        style_id: Number(this.params[2]),
        kind: String(this.params[3]),
        status: String(this.params[4]),
        object_key: String(this.params[5]),
        filename: String(this.params[6]),
        content_hash: String(this.params[7]),
        prompt_template_version_id: numberOrNull(this.params[8]),
        prompt_text: String(this.params[9]),
        parent_asset_uid: stringOrNull(this.params[10]),
        generation_job_id: stringOrNull(this.params[11]),
        meta_json: String(this.params[12]),
        created_at: String(this.params[13]),
        updated_at: String(this.params[14]),
      })
      return result(1, id)
    }
    if (sql.startsWith('insert into approval_events')) {
      const id = this.state.approvalEvents.length + 1
      this.state.approvalEvents.push({ id, batch_uid: String(this.params[0]), style_id: numberOrNull(this.params[1]), asset_uid: stringOrNull(this.params[2]), event_type: String(this.params[3]), actor: String(this.params[4]), payload_json: String(this.params[5]), created_at: String(this.params[6]) })
      return result(1, id)
    }
    if (sql.startsWith('insert into dispatch_jobs')) {
      const jobType = String(this.params[2])
      const idempotencyKey = String(this.params[9])
      const existing = this.state.dispatchJobs.find((row) => row.job_type === jobType && row.idempotency_key === idempotencyKey)
      if (existing) return result(0, existing.id)
      const id = this.state.dispatchJobs.length + 1
      this.state.dispatchJobs.push({
        id,
        job_uid: String(this.params[0]),
        batch_uid: String(this.params[1]),
        job_type: jobType,
        status: String(this.params[3]),
        requested_by: numberOrNull(this.params[4]),
        assigned_machine_id: stringOrNull(this.params[5]),
        required_capabilities_json: String(this.params[6]),
        priority: Number(this.params[7]),
        attempt_count: 0,
        max_attempts: Number(this.params[8]),
        idempotency_key: idempotencyKey,
        lease_id: null,
        lease_expires_at: null,
        payload_json: String(this.params[10]),
        result_json: '{}',
        created_at: String(this.params[11]),
        updated_at: String(this.params[12]),
      })
      return result(1, id)
    }
    if (sql.startsWith('insert into ai_generation_requests')) {
      const id = this.state.generationRequests.length + 1
      this.state.generationRequests.push({
        id,
        request_uid: String(this.params[0]),
        batch_uid: String(this.params[1]),
        style_id: Number(this.params[2]),
        source_asset_uid: String(this.params[3]),
        reference_asset_uids_json: String(this.params[4]),
        prompt_template_version_id: numberOrNull(this.params[5]),
        prompt_text: String(this.params[6]),
        status: String(this.params[7]),
        dispatch_job_uid: String(this.params[8]),
        created_by: numberOrNull(this.params[9]),
        created_at: String(this.params[10]),
        updated_at: String(this.params[11]),
      })
      return result(1, id)
    }
    if (sql.startsWith('insert into audit_logs')) {
      this.state.audits.push({ action: String(this.params[2]), payload_json: String(this.params[5]) })
      return result(1)
    }
    return result(1)
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

describe('review routes', () => {
  it('lets reviewers change AI asset decisions and appends approval events', async () => {
    const { state, reviewerCookie } = await baseState()
    const env = fakeEnv(state)
    for (const decision of ['approved', 'rejected', 'pending']) {
      const response = await fetchWorker(decisionRequest('asset-ai-1', decision, reviewerCookie), env)
      expect(response.status).toBe(200)
      expect(state.assets.find((asset) => asset.asset_uid === 'asset-ai-1')?.status).toBe(decision)
    }
    expect(state.approvalEvents.map((event) => event.event_type)).toEqual(['asset.approved', 'asset.rejected', 'asset.pending'])
  })

  it('blocks review decision changes while a submit job is active', async () => {
    const { state, reviewerCookie } = await baseState()
    state.assets.find((asset) => asset.asset_uid === 'asset-ai-1')!.status = 'approved'
    state.dispatchJobs.push(dispatchJob({
      job_uid: 'job-submit-active',
      batch_uid: 'batch-1',
      job_type: 'submit_tmall_material_test',
      status: 'leased',
      assigned_machine_id: 'machine-1',
      lease_id: 'lease-submit',
    }))

    const response = await fetchWorker(decisionRequest('asset-ai-1', 'rejected', reviewerCookie), fakeEnv(state))
    const body = await response.json() as { error: string }

    expect(response.status).toBe(409)
    expect(body.error).toContain('submit job')
    expect(state.assets.find((asset) => asset.asset_uid === 'asset-ai-1')?.status).toBe('approved')
    expect(state.approvalEvents).toHaveLength(0)
  })

  it('does not let viewers change review decisions', async () => {
    const { state, viewerCookie } = await baseState()
    const response = await fetchWorker(decisionRequest('asset-ai-1', 'approved', viewerCookie), fakeEnv(state))
    expect(response.status).toBe(403)
    expect(state.assets.find((asset) => asset.asset_uid === 'asset-ai-1')?.status).toBe('pending')
    expect(state.approvalEvents).toHaveLength(0)
  })

  it('builds a submit plan with source assets and only approved AI assets', async () => {
    const { state, reviewerCookie } = await baseState()
    state.assets.find((asset) => asset.asset_uid === 'asset-ai-1')!.status = 'approved'
    state.assets.find((asset) => asset.asset_uid === 'asset-ai-2')!.status = 'rejected'
    const response = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-1/submit-plan', { headers: { cookie: reviewerCookie } }), fakeEnv(state))
    const body = await response.json() as { submit_plan: { assets: AssetRow[] } }
    expect(response.status).toBe(200)
    expect(body.submit_plan.assets.map((asset) => asset.asset_uid)).toEqual(['asset-source-1', 'asset-ai-1'])
    expect(body.submit_plan.assets.filter((asset) => asset.kind === 'ai').map((asset) => asset.asset_uid)).toEqual(['asset-ai-1'])
  })

  it('marks a batch ready only when each non-skipped style has an approved AI asset', async () => {
    const { state, reviewerCookie } = await baseState()
    state.assets.find((asset) => asset.asset_uid === 'asset-ai-1')!.status = 'approved'
    let response = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-1/mark-ready', { method: 'POST', headers: { cookie: reviewerCookie } }), fakeEnv(state))
    expect(response.status).toBe(409)
    state.assets.find((asset) => asset.asset_uid === 'asset-ai-3')!.status = 'approved'
    response = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-1/mark-ready', { method: 'POST', headers: { cookie: reviewerCookie } }), fakeEnv(state))
    expect(response.status).toBe(200)
    expect(state.batches[0].status).toBe('ready_to_submit')
  })

  it('rejects manual asset creation for a nonexistent style_id in the route batch', async () => {
    const { state, reviewerCookie } = await baseState()
    const response = await fetchWorker(manualAssetRequest(reviewerCookie, 999, 'manual-missing-style'), fakeEnv(state))
    expect(response.status).toBe(400)
    expect(state.assets.some((asset) => asset.asset_uid === 'manual-missing-style')).toBe(false)
    expect(state.approvalEvents).toHaveLength(0)
  })

  it('rejects manual asset creation for a style_id from another batch', async () => {
    const { state, reviewerCookie } = await baseState()
    state.styles.push({ id: 4, batch_uid: 'batch-2', style_code: 'style-other', item_id: 'item-other', skc_code: 'skc-other', category: 'cat', gender: 'girl', status: 'pending_review', missing_prompt_reason: '', source_summary_json: '{}', review_summary_json: '{}', submit_summary_json: '{}' })
    const response = await fetchWorker(manualAssetRequest(reviewerCookie, 4, 'manual-cross-batch'), fakeEnv(state))
    expect(response.status).toBe(400)
    expect(state.assets.some((asset) => asset.asset_uid === 'manual-cross-batch')).toBe(false)
    expect(state.approvalEvents).toHaveLength(0)
  })

  it('creates a planned manual asset for a style_id in the route batch', async () => {
    const { state, reviewerCookie } = await baseState()
    const response = await fetchWorker(manualAssetRequest(reviewerCookie, 2, 'manual-valid-style'), fakeEnv(state))
    expect(response.status).toBe(201)
    expect(state.assets.find((asset) => asset.asset_uid === 'manual-valid-style')).toMatchObject({
      batch_uid: 'batch-1',
      style_id: 2,
      kind: 'ai',
      status: 'planned',
      filename: 'manual.jpg',
    })
    expect(state.approvalEvents.map((event) => event.event_type)).toEqual(['asset.manual_create'])
  })

  it('creates manual source uploads as planned even if the client asks for uploaded', async () => {
    const { state, reviewerCookie } = await baseState()
    const response = await fetchWorker(manualAssetRequest(reviewerCookie, 2, 'manual-source-planned', 'source', 'uploaded'), fakeEnv(state))

    expect(response.status).toBe(201)
    expect(state.assets.find((asset) => asset.asset_uid === 'manual-source-planned')).toMatchObject({
      kind: 'source',
      status: 'planned',
    })
  })

  it('creates one idempotent regeneration job per selected rejected asset', async () => {
    const { state, reviewerCookie } = await baseState()
    state.assets.push(asset(99, 'asset-reference-planned', 1, 'reference', 'planned', '', null))
    const request = new Request('https://example.test/api/ai-image-batches/batch-1/regenerate', {
      method: 'POST',
      headers: { cookie: reviewerCookie },
      body: JSON.stringify({ asset_uids: ['asset-ai-2'] }),
    })
    const first = await fetchWorker(request, fakeEnv(state))
    const firstBody = await first.json() as { jobs: DispatchJobRow[] }
    const second = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-1/regenerate', {
      method: 'POST',
      headers: { cookie: reviewerCookie },
      body: JSON.stringify({ asset_uids: ['asset-ai-2'] }),
    }), fakeEnv(state))
    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(state.dispatchJobs).toHaveLength(1)
    expect(state.dispatchJobs[0]).toMatchObject({
      job_type: 'regenerate_ai_image',
      idempotency_key: `regenerate_ai_image:batch-1:asset-ai-2:${await sha256Hex('Prompt 2')}`,
    })
    expect(JSON.parse(state.dispatchJobs[0].required_capabilities_json)).toEqual(['regenerate_ai_image'])
    const payload = JSON.parse(state.dispatchJobs[0].payload_json)
    expect(payload).toMatchObject({
      batch_uid: 'batch-1',
      style_id: 1,
      rejected_asset_uid: 'asset-ai-2',
      prompt_text: 'Prompt 2',
      reference_asset_uids: ['asset-source-1'],
      parent_asset_uid: 'asset-ai-2',
    })
    expect(payload.asset_uid).toMatch(/^regen-/)
    expect(payload.asset_uid).not.toBe('asset-ai-2')
    expect(firstBody.jobs[0].job_uid).toBe(state.dispatchJobs[0].job_uid)
  })

  it('passes per-asset prompt overrides into regeneration payloads', async () => {
    const { state, reviewerCookie } = await baseState()
    const response = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-1/regenerate', {
      method: 'POST',
      headers: { cookie: reviewerCookie },
      body: JSON.stringify({ asset_uids: ['asset-ai-2'], prompt_overrides: { 'asset-ai-2': 'override prompt' } }),
    }), fakeEnv(state))

    expect(response.status).toBe(201)
    expect(JSON.parse(state.dispatchJobs[0].payload_json)).toMatchObject({
      prompt_text: 'override prompt',
      original_prompt_text: 'Prompt 2',
    })
  })

  it('creates a distinct normal regeneration job when the prompt override changes', async () => {
    const { state, reviewerCookie } = await baseState()

    const first = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-1/regenerate', {
      method: 'POST',
      headers: { cookie: reviewerCookie },
      body: JSON.stringify({ asset_uids: ['asset-ai-2'], prompt_overrides: { 'asset-ai-2': 'first prompt' } }),
    }), fakeEnv(state))
    const second = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-1/regenerate', {
      method: 'POST',
      headers: { cookie: reviewerCookie },
      body: JSON.stringify({ asset_uids: ['asset-ai-2'], prompt_overrides: { 'asset-ai-2': 'second prompt' } }),
    }), fakeEnv(state))
    const repeatSecond = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-1/regenerate', {
      method: 'POST',
      headers: { cookie: reviewerCookie },
      body: JSON.stringify({ asset_uids: ['asset-ai-2'], prompt_overrides: { 'asset-ai-2': 'second prompt' } }),
    }), fakeEnv(state))

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(repeatSecond.status).toBe(200)
    expect(state.dispatchJobs).toHaveLength(2)
    expect(state.dispatchJobs.map((job) => job.idempotency_key)).toEqual([
      `regenerate_ai_image:batch-1:asset-ai-2:${await sha256Hex('first prompt')}`,
      `regenerate_ai_image:batch-1:asset-ai-2:${await sha256Hex('second prompt')}`,
    ])
    expect(state.dispatchJobs.map((job) => JSON.parse(job.payload_json).prompt_text)).toEqual(['first prompt', 'second prompt'])
  })

  it('rejected asset batch rerun creates one job per rejected AI asset with prompt-hash idempotency', async () => {
    const { state, reviewerCookie } = await baseState()
    state.assets.find((asset) => asset.asset_uid === 'asset-ai-3')!.status = 'rejected'

    const response = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-1/regenerate-rejected', {
      method: 'POST',
      headers: { cookie: reviewerCookie },
      body: JSON.stringify({ prompt_overrides: { 'asset-ai-2': 'override prompt' } }),
    }), fakeEnv(state))

    expect(response.status).toBe(201)
    expect(state.dispatchJobs.map((job) => job.job_type)).toEqual(['regenerate_ai_image', 'regenerate_ai_image'])
    expect(state.dispatchJobs.map((job) => job.idempotency_key)).toEqual([
      'regenerate_ai_image:batch-1:asset-ai-2:cb79718d18e173d5c2ea554c080c41c94a6bd5394e5b6d7348355056231304c0',
      'regenerate_ai_image:batch-1:asset-ai-3:9b1adf0c46edaef90badf75c98cab9558bbf1085684b1b36d4c852d01e8c2251',
    ])
    const payload = JSON.parse(state.dispatchJobs[0].payload_json)
    expect(payload).toMatchObject({
      rejected_asset_uid: 'asset-ai-2',
      prompt_text: 'override prompt',
      original_prompt_text: 'Prompt 2',
      parent_asset_uid: 'asset-ai-2',
    })
    expect(payload.asset_uid).toMatch(/^regen-/)
    expect(payload.asset_uid).not.toBe('asset-ai-2')
  })

  it('online generation from a style creates a generate_ai_image job and request row', async () => {
    const { state, reviewerCookie } = await baseState()
    state.machines[0].capabilities_json = '["generate_ai_image","submit_tmall_material_test"]'

    const response = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-1/generate', {
      method: 'POST',
      headers: { cookie: reviewerCookie },
      body: JSON.stringify({
        style_id: 1,
        source_asset_uid: 'asset-source-1',
        reference_asset_uids: ['asset-source-1'],
        prompt_template_version_id: 31,
        prompt_text: 'fresh prompt',
        model: 'gpt-image-2',
        size: '1024x1024',
        quality: 'high',
        output_format: 'jpeg',
        count: 3,
        machine_id: 'machine-1',
      }),
    }), fakeEnv(state))

    expect(response.status).toBe(201)
    expect(state.dispatchJobs[0]).toMatchObject({
      job_type: 'generate_ai_image',
      assigned_machine_id: 'machine-1',
    })
    expect(JSON.parse(state.dispatchJobs[0].required_capabilities_json)).toEqual(['generate_ai_image'])
    expect(JSON.parse(state.dispatchJobs[0].payload_json)).toMatchObject({
      batch_uid: 'batch-1',
      style_id: 1,
      source_asset_uid: 'asset-source-1',
      reference_asset_uids: ['asset-source-1'],
      prompt_template_version_id: 31,
      prompt_text: 'fresh prompt',
      model: 'gpt-image-2',
      size: '1024x1024',
      quality: 'high',
      output_format: 'jpg',
      count: 3,
      machine_id: 'machine-1',
    })
    expect(state.dispatchJobs[0].payload_json).not.toMatch(/api_key|webhook_secret|Authorization|data:image/i)
    expect(state.generationRequests[0]).toMatchObject({
      batch_uid: 'batch-1',
      style_id: 1,
      source_asset_uid: 'asset-source-1',
      prompt_template_version_id: 31,
      prompt_text: 'fresh prompt',
      status: 'queued',
      dispatch_job_uid: state.dispatchJobs[0].job_uid,
    })
    expect(state.generationRequests[0].reference_asset_uids_json).not.toMatch(/api_key|webhook_secret|Authorization|data:image/i)
    expect(JSON.stringify(state.audits)).not.toMatch(/api_key|webhook_secret|Authorization|data:image/i)
  })

  it('rejects unsupported or unsafe online generation parameters', async () => {
    const { state, reviewerCookie } = await baseState()
    const cases: Array<[string, Record<string, unknown>]> = [
      ['unsupported model', { model: 'dall-e-3' }],
      ['invalid size', { size: '10000x1' }],
      ['invalid ratio', { size: '2:3' }],
      ['invalid quality', { quality: 'ultra' }],
      ['invalid format', { output_format: 'tiff' }],
      ['count too small', { count: 0 }],
      ['count too large', { count: 9 }],
      ['secret field', { api_key: 'sk-secret' }],
      ['data url prompt', { prompt_text: 'use data:image/png;base64,abc' }],
    ]

    for (const [label, override] of cases) {
      const response = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-1/generate', {
        method: 'POST',
        headers: { cookie: reviewerCookie },
        body: JSON.stringify({
          style_id: 1,
          source_asset_uid: 'asset-source-1',
          prompt_text: 'fresh prompt',
          model: 'gpt-image-2',
          size: '1:1',
          quality: 'auto',
          output_format: 'png',
          count: 1,
          ...override,
        }),
      }), fakeEnv(state))

      expect(response.status, label).toBe(400)
    }
    expect(state.dispatchJobs).toHaveLength(0)
    expect(state.generationRequests).toHaveLength(0)
  })

  it('online generation idempotency includes template version and target machine choices', async () => {
    const { state, reviewerCookie } = await baseState()
    state.machines[0].capabilities_json = '["generate_ai_image","submit_tmall_material_test"]'
    state.machines.push({ ...state.machines[0], id: 2, machine_id: 'machine-2', machine_name: 'Machine 2' })
    const basePayload = {
      style_id: 1,
      source_asset_uid: 'asset-source-1',
      reference_asset_uids: ['asset-source-1'],
      prompt_text: 'fresh prompt',
      machine_id: 'machine-1',
    }

    const first = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-1/generate', {
      method: 'POST',
      headers: { cookie: reviewerCookie },
      body: JSON.stringify({ ...basePayload, prompt_template_version_id: 31 }),
    }), fakeEnv(state))
    const differentTemplate = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-1/generate', {
      method: 'POST',
      headers: { cookie: reviewerCookie },
      body: JSON.stringify({ ...basePayload, prompt_template_version_id: 32 }),
    }), fakeEnv(state))
    const differentMachine = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-1/generate', {
      method: 'POST',
      headers: { cookie: reviewerCookie },
      body: JSON.stringify({ ...basePayload, prompt_template_version_id: 31, machine_id: 'machine-2' }),
    }), fakeEnv(state))
    const repeatFirst = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-1/generate', {
      method: 'POST',
      headers: { cookie: reviewerCookie },
      body: JSON.stringify({ ...basePayload, prompt_template_version_id: 31 }),
    }), fakeEnv(state))

    expect(first.status).toBe(201)
    expect(differentTemplate.status).toBe(201)
    expect(differentMachine.status).toBe(201)
    expect(repeatFirst.status).toBe(200)
    expect(state.dispatchJobs).toHaveLength(3)
    expect(new Set(state.dispatchJobs.map((job) => job.idempotency_key)).size).toBe(3)
    expect(state.dispatchJobs.map((job) => job.assigned_machine_id)).toEqual(['machine-1', 'machine-1', 'machine-2'])
    expect(state.generationRequests).toHaveLength(3)
  })

  it('online generation persists prompt override in job payload', async () => {
    const { state, reviewerCookie } = await baseState()

    const response = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-1/generate', {
      method: 'POST',
      headers: { cookie: reviewerCookie },
      body: JSON.stringify({
        style_id: 1,
        source_asset_uid: 'asset-source-1',
        prompt_text: 'manual override prompt',
      }),
    }), fakeEnv(state))

    expect(response.status).toBe(201)
    expect(JSON.parse(state.dispatchJobs[0].payload_json).prompt_text).toBe('manual override prompt')
    expect(state.generationRequests[0].prompt_text).toBe('manual override prompt')
  })

  it('does not let viewers create generation or rerun jobs', async () => {
    const { state, viewerCookie } = await baseState()
    const generate = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-1/generate', {
      method: 'POST',
      headers: { cookie: viewerCookie },
      body: JSON.stringify({ style_id: 1, source_asset_uid: 'asset-source-1', prompt_text: 'prompt' }),
    }), fakeEnv(state))
    const rerun = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-1/regenerate-rejected', {
      method: 'POST',
      headers: { cookie: viewerCookie },
      body: JSON.stringify({}),
    }), fakeEnv(state))

    expect(generate.status).toBe(403)
    expect(rerun.status).toBe(403)
    expect(state.dispatchJobs).toHaveLength(0)
  })

  it('requires jobs:submit, an active selected machine, and recomputes stale batch status for submit jobs', async () => {
    const { state, reviewerCookie, operatorCookie } = await baseState()
    state.assets.find((asset) => asset.asset_uid === 'asset-ai-1')!.status = 'approved'
    state.assets.find((asset) => asset.asset_uid === 'asset-ai-3')!.status = 'approved'
    state.assets.push(asset(99, 'asset-source-planned', 1, 'source', 'planned', '', null))
    let response = await fetchWorker(submitRequest(reviewerCookie, 'machine-1'), fakeEnv(state))
    expect(response.status).toBe(403)
    response = await fetchWorker(submitRequest(operatorCookie, 'missing-machine'), fakeEnv(state))
    expect(response.status).toBe(400)
    expect(state.batches[0].status).toBe('ready_to_submit')
    state.machines[0].last_seen_at = '2026-01-01T00:00:00.000Z'
    response = await fetchWorker(submitRequest(operatorCookie, 'machine-1'), fakeEnv(state))
    expect(response.status).toBe(409)
    state.machines[0].last_seen_at = '2999-01-01T00:00:00.000Z'
    response = await fetchWorker(submitRequest(operatorCookie, 'machine-1'), fakeEnv(state))
    expect(response.status).toBe(201)
    expect(state.dispatchJobs[0]).toMatchObject({ job_type: 'submit_tmall_material_test', assigned_machine_id: 'machine-1' })
    expect(JSON.parse(state.dispatchJobs[0].required_capabilities_json)).toEqual(['submit_tmall_material_test'])
    expect(JSON.parse(state.dispatchJobs[0].payload_json).submit_plan.assets.map((asset: AssetRow) => asset.asset_uid)).toEqual(['asset-source-1', 'asset-source-2', 'asset-ai-1', 'asset-ai-3'])
  })

  it('blocks repeat submit after the batch has already been submitted', async () => {
    const { state, operatorCookie } = await baseState()
    state.batches[0].status = 'submitted'
    state.assets.find((asset) => asset.asset_uid === 'asset-ai-1')!.status = 'approved'
    state.assets.find((asset) => asset.asset_uid === 'asset-ai-3')!.status = 'approved'

    const response = await fetchWorker(submitRequest(operatorCookie, 'machine-1'), fakeEnv(state))
    const body = await response.json() as { error: string }

    expect(response.status).toBe(409)
    expect(body.error).toContain('already been submitted')
    expect(state.dispatchJobs).toHaveLength(0)
  })

  it('blocks submit when any non-skipped style has no approved AI asset even if batch status is stale ready_to_submit', async () => {
    const { state, operatorCookie } = await baseState()
    state.batches[0].status = 'ready_to_submit'
    state.assets.find((asset) => asset.asset_uid === 'asset-ai-1')!.status = 'approved'
    state.assets.find((asset) => asset.asset_uid === 'asset-ai-3')!.status = 'rejected'

    const response = await fetchWorker(submitRequest(operatorCookie, 'machine-1'), fakeEnv(state))
    const body = await response.json() as { error: string }

    expect(response.status).toBe(409)
    expect(body.error).toContain('every non-skipped style')
    expect(state.dispatchJobs).toHaveLength(0)
  })
})

async function baseState(): Promise<{ state: State; reviewerCookie: string; viewerCookie: string; operatorCookie: string }> {
  const reviewerSession = 'sess_reviewer_task6'
  const viewerSession = 'sess_viewer_task6'
  const operatorSession = 'sess_operator_task6'
  const state: State = {
    users: [
      { id: 1, email: 'reviewer@example.com', name: 'Reviewer', status: 'active' },
      { id: 2, email: 'viewer@example.com', name: 'Viewer', status: 'active' },
      { id: 3, email: 'operator@example.com', name: 'Operator', status: 'active' },
    ],
    roles: [
      { id: 1, role_key: 'reviewer', name: 'Reviewer' },
      { id: 2, role_key: 'viewer', name: 'Viewer' },
      { id: 3, role_key: 'operator', name: 'Operator' },
    ],
    userRoles: [{ user_id: 1, role_id: 1 }, { user_id: 2, role_id: 2 }, { user_id: 3, role_id: 3 }],
    sessions: [
      { user_id: 1, session_hash: await sha256Hex(reviewerSession), expires_at: '2999-01-01T00:00:00.000Z', revoked_at: null },
      { user_id: 2, session_hash: await sha256Hex(viewerSession), expires_at: '2999-01-01T00:00:00.000Z', revoked_at: null },
      { user_id: 3, session_hash: await sha256Hex(operatorSession), expires_at: '2999-01-01T00:00:00.000Z', revoked_at: null },
    ],
    machines: [
      { id: 1, machine_id: 'machine-1', machine_name: 'Machine 1', owner_user_id: null, app_version: '1.0.0', fingerprint_hash: 'fp', capabilities_json: '["submit_tmall_material_test"]', auth_status: 'active', health: 'online_idle', current_job_id: null, last_seen_at: '2999-01-01T00:00:00.000Z', registered_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
    batches: [{ id: 1, batch_uid: 'batch-1', local_instance_uid: 'local-1', local_run_id: 'run-1', title: 'Batch 1', status: 'pending_review', prompt_library_id: 1, prompt_version_set_json: '[]', source_machine_id: null, created_by: 1, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }],
    styles: [
      { id: 1, batch_uid: 'batch-1', style_code: 'style-1', item_id: 'item-1', skc_code: 'skc-1', category: 'cat', gender: 'girl', status: 'pending_review', missing_prompt_reason: '', source_summary_json: '{}', review_summary_json: '{}', submit_summary_json: '{}' },
      { id: 2, batch_uid: 'batch-1', style_code: 'style-2', item_id: 'item-2', skc_code: 'skc-2', category: 'cat', gender: 'girl', status: 'pending_review', missing_prompt_reason: '', source_summary_json: '{}', review_summary_json: '{}', submit_summary_json: '{}' },
      { id: 3, batch_uid: 'batch-1', style_code: 'style-3', item_id: 'item-3', skc_code: 'skc-3', category: 'cat', gender: 'girl', status: 'skipped', missing_prompt_reason: 'missing prompt', source_summary_json: '{}', review_summary_json: '{}', submit_summary_json: '{}' },
    ],
    assets: [
      asset(1, 'asset-source-1', 1, 'source', 'uploaded', '', null),
      asset(2, 'asset-ai-1', 1, 'ai', 'pending', 'Prompt 1', 'asset-source-1'),
      asset(3, 'asset-ai-2', 1, 'ai', 'rejected', 'Prompt 2', 'asset-source-1'),
      asset(4, 'asset-source-2', 2, 'source', 'uploaded', '', null),
      asset(5, 'asset-ai-3', 2, 'ai', 'pending', 'Prompt 3', 'asset-source-2'),
    ],
    approvalEvents: [],
    dispatchJobs: [],
    generationRequests: [],
    audits: [],
  }
  return {
    state,
    reviewerCookie: `cs_session=${reviewerSession}`,
    viewerCookie: `cs_session=${viewerSession}`,
    operatorCookie: `cs_session=${operatorSession}`,
  }
}

function asset(id: number, assetUid: string, styleId: number, kind: string, status: string, promptText: string, parentAssetUid: string | null): AssetRow {
  return {
    id,
    asset_uid: assetUid,
    batch_uid: 'batch-1',
    style_id: styleId,
    kind,
    status,
    object_key: `batches/batch-1/${kind}/${assetUid}.jpg`,
    filename: `${assetUid}.jpg`,
    content_hash: '',
    prompt_template_version_id: kind === 'ai' ? 100 + id : null,
    prompt_text: promptText,
    parent_asset_uid: parentAssetUid,
    generation_job_id: null,
    meta_json: '{}',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

function dispatchJob(overrides: Partial<DispatchJobRow>): DispatchJobRow {
  return {
    id: 1,
    job_uid: 'job-1',
    batch_uid: 'batch-1',
    job_type: 'regenerate_ai_image',
    status: 'queued',
    requested_by: 1,
    assigned_machine_id: null,
    required_capabilities_json: JSON.stringify(['regenerate_ai_image']),
    priority: 50,
    attempt_count: 0,
    max_attempts: 1,
    idempotency_key: 'job-1',
    lease_id: null,
    lease_expires_at: null,
    payload_json: '{}',
    result_json: '{}',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function decisionRequest(assetUid: string, decision: string, cookie: string): Request {
  return new Request(`https://example.test/api/ai-image-batches/batch-1/assets/${assetUid}/decision`, {
    method: 'PATCH',
    headers: { cookie },
    body: JSON.stringify({ decision, note: `mark ${decision}` }),
  })
}

function submitRequest(cookie: string, machineId: string): Request {
  return new Request('https://example.test/api/ai-image-batches/batch-1/submit', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ machine_id: machineId }),
  })
}

function manualAssetRequest(cookie: string, styleId: number, assetUid: string, kind = 'ai', status = 'approved'): Request {
  return new Request('https://example.test/api/ai-image-batches/batch-1/manual-assets', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({
      style_id: styleId,
      asset_uid: assetUid,
      kind,
      filename: 'manual.jpg',
      status,
      prompt_text: 'Manual prompt',
    }),
  })
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase()
}

function result(changes: number, lastRowId = 0): D1Result {
  return { success: true, meta: { changes, last_row_id: lastRowId } } as D1Result
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}
