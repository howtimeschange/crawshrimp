import { describe, expect, it } from 'vitest'
import worker from '../worker/index'
import { sha256Hex } from '../worker/security/tokens'

interface UserRow {
  id: number
  email: string
  name: string
  status: string
}

interface RoleRow {
  id: number
  role_key: string
  name: string
}

interface UserRoleRow {
  user_id: number
  role_id: number
}

interface SessionRow {
  user_id: number
  session_hash: string
  expires_at: string
  revoked_at: string | null
}

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

interface MachineTokenRow {
  id: number
  machine_id: string
  token_hash: string
  token_version: number
  status: string
  issued_by: number | null
  issued_at: string
  last_used_at: string | null
  revoked_at: string | null
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

interface FakeState {
  users: UserRow[]
  roles: RoleRow[]
  userRoles: UserRoleRow[]
  sessions: SessionRow[]
  machines: MachineRow[]
  machineTokens: MachineTokenRow[]
  batches: BatchRow[]
  styles: StyleRow[]
  assets: AssetRow[]
  audits: unknown[]
}

class FakeD1Statement {
  private params: unknown[] = []

  constructor(
    private readonly state: FakeState,
    private readonly sql: string,
  ) {}

  bind(...params: unknown[]): FakeD1Statement {
    this.params = params
    return this
  }

  async first<T>(): Promise<T | null> {
    const normalized = normalizeSql(this.sql)
    if (normalized.includes('from sessions') && normalized.includes('join users')) {
      const sessionHash = String(this.params[0])
      const now = String(this.params[1])
      const session = this.state.sessions.find((row) => row.session_hash === sessionHash && !row.revoked_at && row.expires_at > now)
      if (!session) return null
      return (this.state.users.find((user) => user.id === session.user_id && user.status === 'active') ?? null) as T | null
    }
    if (normalized.includes('from machine_tokens') && normalized.includes('join task_machines')) {
      const tokenHash = String(this.params[0])
      const token = this.state.machineTokens.find((row) => row.token_hash === tokenHash && row.status === 'active' && !row.revoked_at)
      if (!token) return null
      const machine = this.state.machines.find((row) => row.machine_id === token.machine_id)
      return (machine ? { ...machine, token_hash: token.token_hash } : null) as T | null
    }
    if (normalized.includes('from ai_image_batches') && normalized.includes('where batch_uid = ?')) {
      return (this.state.batches.find((row) => row.batch_uid === String(this.params[0])) ?? null) as T | null
    }
    if (normalized.includes('from ai_image_styles') && normalized.includes('where batch_uid = ?') && normalized.includes('style_code = ?')) {
      return (this.state.styles.find((row) => row.batch_uid === String(this.params[0]) && row.style_code === String(this.params[1]) && row.item_id === String(this.params[2])) ?? null) as T | null
    }
    if (normalized.includes('select count(*) as count from ai_image_styles')) {
      return { count: this.state.styles.filter((row) => row.batch_uid === String(this.params[0])).length } as T
    }
    if (normalized.includes('select count(*) as count from ai_image_assets')) {
      return { count: this.state.assets.filter((row) => row.batch_uid === String(this.params[0]) && row.kind === 'ai').length } as T
    }
    return null
  }

  async all<T>(): Promise<{ results: T[] }> {
    const normalized = normalizeSql(this.sql)
    if (normalized.includes('from roles') && normalized.includes('join user_roles')) {
      const userId = Number(this.params[0])
      return {
        results: this.state.userRoles
          .filter((userRole) => userRole.user_id === userId)
          .map((userRole) => this.state.roles.find((role) => role.id === userRole.role_id))
          .filter((role): role is RoleRow => Boolean(role)) as T[],
      }
    }
    if (normalized.includes('from ai_image_styles') && !normalized.includes('join')) {
      return { results: this.state.styles.filter((row) => row.batch_uid === String(this.params[0])) as T[] }
    }
    if (normalized.includes('from ai_image_assets')) {
      return { results: this.state.assets.filter((row) => row.batch_uid === String(this.params[0])) as T[] }
    }
    if (normalized.includes('from ai_image_batches')) {
      return { results: this.state.batches as T[] }
    }
    return { results: [] }
  }

  async run(): Promise<D1Result> {
    const normalized = normalizeSql(this.sql)
    if (normalized.startsWith('update machine_tokens set last_used_at')) {
      const token = this.state.machineTokens.find((row) => row.token_hash === String(this.params[1]))
      if (token) token.last_used_at = String(this.params[0])
      return result(token ? 1 : 0)
    }
    if (normalized.startsWith('insert into ai_image_batches')) {
      const batchUid = String(this.params[0])
      const existing = this.state.batches.find((row) => row.batch_uid === batchUid)
      if (existing) {
        existing.local_instance_uid = String(this.params[1])
        existing.local_run_id = String(this.params[2])
        existing.title = String(this.params[3])
        existing.prompt_library_id = numberOrNull(this.params[5])
        existing.prompt_version_set_json = String(this.params[6])
        existing.source_machine_id = stringOrNull(this.params[7])
        existing.created_by = numberOrNull(this.params[8])
        existing.updated_at = String(this.params[10])
        return result(1, existing.id)
      }
      const id = this.state.batches.length + 1
      this.state.batches.push({
        id,
        batch_uid: batchUid,
        local_instance_uid: String(this.params[1]),
        local_run_id: String(this.params[2]),
        title: String(this.params[3]),
        status: String(this.params[4]),
        prompt_library_id: numberOrNull(this.params[5]),
        prompt_version_set_json: String(this.params[6]),
        source_machine_id: stringOrNull(this.params[7]),
        created_by: numberOrNull(this.params[8]),
        created_at: String(this.params[9]),
        updated_at: String(this.params[10]),
      })
      return result(1, id)
    }
    if (normalized.startsWith('insert into ai_image_styles')) {
      const batchUid = String(this.params[0])
      const styleCode = String(this.params[1])
      const itemId = String(this.params[2])
      const existing = this.state.styles.find((row) => row.batch_uid === batchUid && row.style_code === styleCode && row.item_id === itemId)
      if (existing) {
        existing.skc_code = String(this.params[3])
        existing.category = String(this.params[4])
        existing.gender = String(this.params[5])
        existing.status = String(this.params[6])
        existing.missing_prompt_reason = String(this.params[7])
        existing.source_summary_json = String(this.params[8])
        return result(1, existing.id)
      }
      const id = this.state.styles.length + 1
      this.state.styles.push({
        id,
        batch_uid: batchUid,
        style_code: styleCode,
        item_id: itemId,
        skc_code: String(this.params[3]),
        category: String(this.params[4]),
        gender: String(this.params[5]),
        status: String(this.params[6]),
        missing_prompt_reason: String(this.params[7]),
        source_summary_json: String(this.params[8]),
        review_summary_json: '{}',
        submit_summary_json: '{}',
      })
      return result(1, id)
    }
    if (normalized.startsWith('insert into ai_image_assets')) {
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
    if (normalized.startsWith('update ai_image_batches set status')) {
      const batch = this.state.batches.find((row) => row.batch_uid === String(this.params[1]))
      if (!batch) return result(0)
      batch.status = 'pending_review'
      batch.updated_at = String(this.params[0])
      return result(1)
    }
    if (normalized.startsWith('insert into audit_logs')) {
      this.state.audits.push({ action: String(this.params[2]), resource_type: String(this.params[3]), resource_id: String(this.params[4]) })
      return result(1)
    }
    return result(1)
  }
}

class FakeD1Database {
  constructor(private readonly state: FakeState) {}

  prepare(sql: string): FakeD1Statement {
    return new FakeD1Statement(this.state, sql)
  }
}

function fakeEnv(state: FakeState) {
  return {
    DB: new FakeD1Database(state) as unknown as D1Database,
    ASSETS: {} as R2Bucket,
    SESSION_TTL_SECONDS: '604800',
  }
}

function fetchWorker(request: Request, env: ReturnType<typeof fakeEnv>): Promise<Response> {
  return (worker.fetch as unknown as (request: Request, env: ReturnType<typeof fakeEnv>) => Promise<Response>)(request, env)
}

async function baseState(): Promise<{ state: FakeState; machineToken: string; reviewerCookie: string; adminCookie: string }> {
  const machineToken = 'csr_machine_test'
  const reviewerSession = 'sess_reviewer'
  const adminSession = 'sess_admin'
  const state: FakeState = {
    users: [
      { id: 1, email: 'admin@example.com', name: 'Admin', status: 'active' },
      { id: 2, email: 'reviewer@example.com', name: 'Reviewer', status: 'active' },
    ],
    roles: [
      { id: 1, role_key: 'admin', name: 'Admin' },
      { id: 2, role_key: 'reviewer', name: 'Reviewer' },
    ],
    userRoles: [
      { user_id: 1, role_id: 1 },
      { user_id: 2, role_id: 2 },
    ],
    sessions: [
      { user_id: 1, session_hash: await sha256Hex(adminSession), expires_at: '2999-01-01T00:00:00.000Z', revoked_at: null },
      { user_id: 2, session_hash: await sha256Hex(reviewerSession), expires_at: '2999-01-01T00:00:00.000Z', revoked_at: null },
    ],
    machines: [
      {
        id: 1,
        machine_id: 'machine-1',
        machine_name: 'Machine 1',
        owner_user_id: null,
        app_version: '1.0.0',
        fingerprint_hash: 'fp',
        capabilities_json: '["ai-image-sync"]',
        auth_status: 'active',
        health: 'online_idle',
        current_job_id: null,
        last_seen_at: null,
        registered_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    machineTokens: [
      {
        id: 1,
        machine_id: 'machine-1',
        token_hash: await sha256Hex(machineToken),
        token_version: 1,
        status: 'active',
        issued_by: null,
        issued_at: '2026-01-01T00:00:00.000Z',
        last_used_at: null,
        revoked_at: null,
      },
    ],
    batches: [],
    styles: [],
    assets: [],
    audits: [],
  }
  return {
    state,
    machineToken,
    reviewerCookie: `cs_session=${reviewerSession}`,
    adminCookie: `cs_session=${adminSession}`,
  }
}

function batchPayload(title = 'July sync') {
  return {
    batch_uid: 'batch-20260707',
    local_instance_uid: 'local-instance-1',
    local_run_id: 'run-1',
    title,
    prompt_library_id: 10,
    prompt_version_set: [{ template_id: 20, version_id: 30 }],
    styles: [
      {
        style_code: '208326140201',
        item_id: '1065477260163',
        skc_code: 'SKC-1',
        category: 'kidswear',
        gender: 'girl',
        source_summary: { source_count: 2 },
        assets: [
          {
            asset_uid: 'asset-source-1',
            kind: 'source',
            filename: 'source.jpg',
            object_key: 'batches/batch-20260707/source/asset-source-1-source.jpg',
            status: 'uploaded',
            meta: { source_path_label: 'source.jpg' },
          },
          {
            asset_uid: 'asset-ai-1',
            kind: 'ai',
            filename: 'ai.jpg',
            object_key: 'batches/batch-20260707/ai/asset-ai-1-ai.jpg',
            status: 'uploaded',
            prompt_template_version_id: 30,
            prompt_text: 'Generate a clean catalog image',
            parent_asset_uid: 'asset-source-1',
            generation_job_id: 'job-1',
            meta: { model: '1xm' },
          },
        ],
      },
    ],
  }
}

describe('batch sync routes', () => {
  it('allows a machine token to create a batch with styles and assets', async () => {
    const { state, machineToken } = await baseState()
    const env = fakeEnv(state)
    const response = await fetchWorker(new Request('https://example.test/api/ai-image-batches/sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${machineToken}` },
      body: JSON.stringify(batchPayload()),
    }), env)

    expect(response.status).toBe(201)
    expect(state.batches[0]).toMatchObject({ batch_uid: 'batch-20260707', status: 'syncing', source_machine_id: 'machine-1' })
    expect(state.styles[0]).toMatchObject({ style_code: '208326140201', item_id: '1065477260163' })
    expect(state.assets.map((asset) => asset.asset_uid)).toEqual(['asset-source-1', 'asset-ai-1'])
  })

  it('prevents a non-admin user session from creating a machine-origin batch', async () => {
    const { state, reviewerCookie } = await baseState()
    const env = fakeEnv(state)
    const response = await fetchWorker(new Request('https://example.test/api/ai-image-batches/sync', {
      method: 'POST',
      headers: { cookie: reviewerCookie },
      body: JSON.stringify({ ...batchPayload(), source_machine_id: 'machine-1' }),
    }), env)

    expect(response.status).toBe(403)
    expect(state.batches).toHaveLength(0)
  })

  it('allows an admin user session to create an explicitly machine-origin batch', async () => {
    const { state, adminCookie } = await baseState()
    const env = fakeEnv(state)
    const response = await fetchWorker(new Request('https://example.test/api/ai-image-batches/sync', {
      method: 'POST',
      headers: { cookie: adminCookie },
      body: JSON.stringify({ ...batchPayload(), source_machine_id: 'machine-override' }),
    }), env)

    expect(response.status).toBe(201)
    expect(state.batches[0]).toMatchObject({ created_by: 1, source_machine_id: 'machine-override' })
  })

  it('changes a valid syncing batch to pending_review on sync-complete', async () => {
    const { state, machineToken } = await baseState()
    const env = fakeEnv(state)
    await fetchWorker(new Request('https://example.test/api/ai-image-batches/sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${machineToken}` },
      body: JSON.stringify(batchPayload()),
    }), env)

    const response = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-20260707/sync-complete', {
      method: 'POST',
      headers: { authorization: `Bearer ${machineToken}` },
    }), env)

    expect(response.status).toBe(200)
    expect(state.batches[0].status).toBe('pending_review')
  })

  it('updates duplicate batch_uid metadata idempotently', async () => {
    const { state, machineToken } = await baseState()
    const env = fakeEnv(state)
    const request = (title: string) => new Request('https://example.test/api/ai-image-batches/sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${machineToken}` },
      body: JSON.stringify(batchPayload(title)),
    })

    expect((await fetchWorker(request('First title'), env)).status).toBe(201)
    expect((await fetchWorker(request('Updated title'), env)).status).toBe(200)

    expect(state.batches).toHaveLength(1)
    expect(state.batches[0].title).toBe('Updated title')
    expect(state.styles).toHaveLength(1)
    expect(state.assets).toHaveLength(2)
  })

  it('returns styles grouped with assets and prompt metadata', async () => {
    const { state, machineToken, reviewerCookie } = await baseState()
    const env = fakeEnv(state)
    await fetchWorker(new Request('https://example.test/api/ai-image-batches/sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${machineToken}` },
      body: JSON.stringify(batchPayload()),
    }), env)

    const response = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-20260707', {
      headers: { cookie: reviewerCookie },
    }), env)
    const body = await response.json() as { batch: BatchRow & { styles: Array<StyleRow & { assets: AssetRow[] }> } }

    expect(response.status).toBe(200)
    expect(body.batch.styles).toHaveLength(1)
    expect(body.batch.styles[0].assets.map((asset) => asset.asset_uid)).toEqual(['asset-source-1', 'asset-ai-1'])
    expect(body.batch.styles[0].assets[1]).toMatchObject({
      prompt_template_version_id: 30,
      prompt_text: 'Generate a clean catalog image',
    })
  })
})

function normalizeSql(sql: string): string {
  return sql.toLowerCase().replace(/\s+/g, ' ').trim()
}

function result(changes: number, lastRowId = 0): D1Result {
  return {
    success: true,
    meta: { changes, last_row_id: lastRowId } as D1Meta & Record<string, unknown>,
    results: [],
  }
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function stringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}
